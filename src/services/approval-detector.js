'use strict';

/**
 * V398 (Часть II): детект согласия директора («Добро») по телу письма.
 * ═══════════════════════════════════════════════════════════════════════════
 * Требование заказчика: директор НЕ жмёт кнопку — он отвечает словом в письме.
 * Значит нужно надёжно отличить СОГЛАСИЕ от:
 *   • цитаты прежнего письма («…директор сказал добро…» в цитате);
 *   • отрицания («не добро», «не оплачивайте», «пока не оплачивайте», «отклоняю»);
 *   • вопроса («согласовать?», «оплачиваем?»).
 *
 * ВАЖНО (исправлено 17.10.2026 после верификатора): раньше негации искались
 * ТОЧНОЙ подстрокой из списка — «Пока не оплачивайте» давало approve=true
 * (нашлось «оплачивайте»), живой эксплойт согласовал счёт. Теперь негация
 * проверяется в ОКРЕСТНОСТИ конкретного слова, а вопрос — по «?» рядом.
 * При неоднозначности НЕ считаем согласием (ложное согласование недопустимо).
 */

// Утвердительные маркеры согласия (регистронезависимо, по границам слова).
const APPROVE_WORDS = [
  'добро', 'согласовано', 'согласен', 'согласна', 'утверждаю', 'утверждено',
  'одобряю', 'одобрено', 'оплачивайте', 'оплачиваем', 'подтверждаю',
  'разрешаю', 'даю добро', 'можно оплачивать', 'ок на оплату'
];

// Негативные токены: если они в окне ПЕРЕД утвердительным словом — это не согласие.
const NEG_TOKENS = [
  'не', 'ни', 'нельзя', 'невозможно', 'отказ', 'отклон', 'против', 'отмен',
  'отлож', 'запрещ', 'запрет', 'стоп', 'погод', 'позже', 'потом', 'доработ',
  'верни', 'вернуть', 'воздерж', 'снимаю', 'аннулир', 'пересмотр', 'пока'
];

// Вопрос-хинты (плюс проверка «?» рядом со словом).
const QUESTION_HINTS = ['согласовать?', 'согласуем?', 'оплачивать ли', 'можно ли', 'надо ли', 'не так ли'];

// Слова-ловушки: «добро» внутри них НЕ согласие.
const FALSE_APPROVE = [/добро\s+пожаловать/i, /доброе\s+(утро|день|вечер|время)/i, /доброй\s+ночи/i, /доброжелательн/i, /добросовестн/i, /добротн/i];

/** Убрать цитаты прежней переписки и подпись. */
function stripQuotes(text) {
  let s = String(text || '');
  const cutMarkers = [
    /\n\s*-{2,}\s*(исходное|первоначальное)\s+сообщение\s*-{2,}/i,
    /\n\s*_{3,}/,                                // разделитель Outlook
    /\n\s*>{1,}/,                                // строка цитаты
    /\n\s*От:\s.*\n\s*(Кому|Отправлено):/i,      // Outlook RU
    /\n\s*От кого:\s/i,
    /\n\s*Отправлено:\s/i,
    /\n\s*(Пересылаю|Пересланное сообщение|Перенаправлено)/i,
    /\n\s*From:\s.*\n\s*(Sent|To):/i,            // англ. блок
    /\n\s*On .{0,80}wrote:/i,
    /\n\s*письмо\s+от\s+/i,
    /\n\s*--\s*(\n|$)/                           // подпись
  ];
  for (const re of cutMarkers) {
    const m = s.split(re);
    if (m.length > 1) s = m[0];
  }
  return s.trim();
}

/** Есть ли негативный токен в окне ПЕРЕД позицией pos. */
function negativeBefore(s, pos, window = 48) {
  const from = Math.max(0, pos - window);
  const ctx = s.slice(from, pos);
  return NEG_TOKENS.some((t) => new RegExp('(^|[^а-яё])' + t, 'i').test(ctx));
}

/**
 * Есть ли негативный токен ПОСЛЕ слова (в пределах того же предложения).
 * Ловит «Добро, но не оплачивайте», «Согласовано… однако отложим».
 */
function negativeAfter(s, pos, len, window = 60) {
  const to = Math.min(s.length, pos + len + window);
  const ctx = s.slice(pos + len, to);
  const stop = ctx.search(/[.!]\s|[\n]/);
  const seg = stop >= 0 ? ctx.slice(0, stop) : ctx;
  // «но»/«однако» + негатив; либо прямой негатив.
  return NEG_TOKENS.some((t) => new RegExp('(^|[^а-яё])' + t, 'i').test(seg));
}

/** Есть ли «?» после слова (в пределах предложения) — значит вопрос. */
function questionAfter(s, pos, len, window = 24) {
  const to = Math.min(s.length, pos + len + window);
  const ctx = s.slice(pos + len, to);
  const stop = ctx.search(/[.!]\s|[\n]/);
  const seg = stop >= 0 ? ctx.slice(0, stop) : ctx;
  return seg.includes('?');
}

/**
 * Есть ли утвердительное согласие в теле.
 * @param {string} body
 * @returns {{approve:boolean, word?:string, negative?:boolean, question?:boolean}}
 */
function detectApproval(body) {
  const s = stripQuotes(body).toLowerCase();
  if (!s) return { approve: false };
  for (const trap of FALSE_APPROVE) { if (trap.test(s)) return { approve: false, falsePositive: true }; }
  const qHit = QUESTION_HINTS.find((q) => s.includes(q));
  if (qHit) return { approve: false, question: true, word: qHit };

  for (const w of APPROVE_WORDS) {
    const re = new RegExp('(^|[^а-яё])(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')([^а-яё]|$)', 'gi');
    let m;
    while ((m = re.exec(s)) !== null) {
      const pos = m.index + m[1].length;
      // Негация перед словом, негатив после (в том же предложении) или вопрос — не согласие.
      if (negativeBefore(s, pos)) continue;
      if (negativeAfter(s, pos, w.length)) continue;
      if (questionAfter(s, pos, w.length)) continue;
      return { approve: true, word: w };
    }
  }
  return { approve: false };
}

/** Явный отказ (для отдельного класса, не путать с «не согласие»). */
function detectRejection(body) {
  const s = stripQuotes(body).toLowerCase();
  const rej = ['отклоняю', 'отклонено', 'отклоняем', 'отказано', 'не согласовано', 'на доработку', 'верни на', 'вернуть', 'аннулиру', 'пересмотр'];
  const hit = rej.find((w) => s.includes(w));
  return hit ? { reject: true, word: hit } : { reject: false };
}

module.exports = { stripQuotes, detectApproval, detectRejection, APPROVE_WORDS, NEG_TOKENS };
