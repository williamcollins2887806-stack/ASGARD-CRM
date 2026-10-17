'use strict';

/**
 * V398 (Часть II): детект согласия директора («Добро») по телу письма.
 * ═══════════════════════════════════════════════════════════════════════════
 * Требование заказчика: директор отвечает словом («Добро»), не кнопкой.
 *
 * ПРИНЦИП (переписан 17.10.2026 после 3-го круга верификатора):
 * blacklist негативов НЕ РАБОТАЕТ — «не платите / не перечисляйте / заморозьте /
 * приостановите / однако не» бесконечны, и каждый обход согласовывал счёт.
 * Теперь — WHITELIST (fail-closed): согласием считается ТОЛЬКО тело, целиком
 * состоящее из разрешённых токенов (короткое и однозначное). Любое иное слово
 * → `needs_manual` (ручное подтверждение кнопкой в CRM, что и так есть).
 *
 * Это осознанно строго: директор, пишущий «Добро» (как в требовании), проходит;
 * директор, пишущий развёрнутый текст с условиями, — подтверждает в CRM.
 */

// Токены, допустимые в теле согласия (после нормализации).
const APPROVE_TOKENS = new Set([
  'добро', 'да', 'ага', 'ок', 'окей', 'okay', 'ok',
  'согласовано', 'согласен', 'согласна', 'согласны',
  'утверждаю', 'утверждено', 'утверждаем',
  'одобряю', 'одобрено', 'одобряем',
  'подтверждаю', 'подтверждено', 'подтверждаем',
  'разрешаю', 'разрешено', 'разрешаем',
  'оплачивайте', 'оплачиваем', 'оплачивать', 'платите', 'платим', 'платить', 'перечислить', 'переведите',
  'можно', 'разрешение', 'даю', 'даем', 'даём', 'подтверждаю', 'ок'
]);
// Вежливые «шумовые» слова, не меняющие смысла.
const FILLER_TOKENS = new Set(['спасибо', 'пожалуйста', 'и', 'это', 'всё', 'все', 'уважением', 'с', 'коллеги', 'коллега', 'на', 'за', 'оплату', 'счёт', 'счет']);
// Платёжные слова: если встречаются ПОСЛЕ подписи/разделителя — это скрытая
// инструкция («Добро\n--\nНе оплачивайте») → отказ.
const PAY_WORDS_RE = /(оплач|оплат|плат|перечисл|перевед|перевод|деньг|счёт|счет|заморо|приостанов)/i;
// Ловушки-ложные согласия.
const FALSE_APPROVE = [/добро\s+пожаловать/i, /доброе\s+(утро|день|вечер|время)/i, /доброй\s+ночи/i, /доброжелательн/i, /добросовестн/i, /добротн/i];

/** Убрать цитаты прежней переписки (чужие письма). Подпись НЕ режем здесь. */
function stripQuotes(text) {
  let s = String(text || '');
  const cutMarkers = [
    /\n\s*-{2,}\s*(исходное|первоначальное)\s+сообщение\s*-{2,}/i,
    /\n\s*_{3,}/,
    /\n\s*>{1,}/,
    /\n\s*От:\s.*\n\s*(Кому|Отправлено):/i,
    /\n\s*От кого:\s/i,
    /\n\s*Отправлено:\s/i,
    /\n\s*(Пересылаю|Пересланное сообщение|Перенаправлено)/i,
    /\n\s*From:\s.*\n\s*(Sent|To):/i,
    /\n\s*On .{0,80}wrote:/i,
    /\n\s*письмо\s+от\s+/i
  ];
  for (const re of cutMarkers) {
    const m = s.split(re);
    if (m.length > 1) s = m[0];
  }
  return s.trim();
}

/** Нормализовать токен: убрать пунктуацию/эмодзи/кавычки. */
function normToken(w) {
  return String(w || '')
    .toLowerCase()
    .replace(/[^\u0430-\u044f\u0451a-z0-9]/gi, '')   // кириллица/латиница/цифры
    .trim();
}

/**
 * Есть ли утвердительное согласие в теле (СТРОГИЙ whitelist).
 * @param {string} body
 * @returns {{approve:boolean, word?:string, reason?:string}}
 */
function detectApproval(body) {
  const whole = String(body || '');
  for (const trap of FALSE_APPROVE) { if (trap.test(whole)) return { approve: false, falsePositive: true }; }

  const cut = stripQuotes(whole);
  if (!cut) return { approve: false };
  // Вопрос — не согласие («Оплачиваем?», «Согласовать?»).
  if (/[?？]/.test(cut)) return { approve: false, reason: 'question' };

  // Защита от скрытой инструкции в подписи/после разделителя: берём всё, что
  // идёт после первой строки из дефисов/подчёркиваний, и если там есть
  // платёжные слова — это не чистое согласие.
  const parts = cut.split(/\n\s*[-_=]{2,}\s*\n?/);
  if (parts.length > 1 && PAY_WORDS_RE.test(parts.slice(1).join('\n'))) {
    return { approve: false, reason: 'instruction_after_separator' };
  }

  // Тело до разделителя подписи.
  const head = parts[0];

  // Разбиваем на токены, отбрасывая пустые.
  const tokens = head.split(/\s+/).map(normToken).filter(Boolean);
  if (!tokens.length) return { approve: false };
  // Длинное тело — не однозначное согласие (fail-closed → ручное подтверждение).
  if (tokens.length > 6) return { approve: false, reason: 'too_long' };

  const unknown = tokens.filter((t) => !APPROVE_TOKENS.has(t) && !FILLER_TOKENS.has(t));
  if (unknown.length) return { approve: false, reason: 'unknown_tokens', unknown: unknown.slice(0, 4) };

  const hit = tokens.find((t) => APPROVE_TOKENS.has(t));
  return hit ? { approve: true, word: hit } : { approve: false, reason: 'no_approve_token' };
}

/** Явный отказ (для отдельного класса). */
function detectRejection(body) {
  const s = String(body || '').toLowerCase();
  const rej = ['отклоняю', 'отклонено', 'отклоняем', 'отказано', 'не согласовано', 'на доработку',
    'верни на', 'вернуть', 'аннулиру', 'пересмотр', 'отменяю', 'отмена'];
  const hit = rej.find((w) => s.includes(w));
  return hit ? { reject: true, word: hit } : { reject: false };
}

module.exports = { stripQuotes, detectApproval, detectRejection, APPROVE_TOKENS, FILLER_TOKENS };
