'use strict';

/**
 * V398 (Часть II): детект согласия директора («Добро») по телу письма.
 * ═══════════════════════════════════════════════════════════════════════════
 * Требование заказчика: директор НЕ жмёт кнопку — он отвечает словом в письме.
 * Значит нужно надёжно отличить СОГЛАСИЕ от:
 *   • цитаты прежнего письма («…директор сказал добро…» в цитате);
 *   • отрицания («не добро», «не согласовано», «отклоняю», «против»);
 *   • вопроса («согласовать?», «надо ли оплачивать?»).
 *
 * Правило: сначала убираем цитаты и подписи, затем ищем утвердительное слово,
 * и лишь при явном согласии без отрицания рядом — возвращаем true.
 * При неоднозначности НЕ считаем согласием (ложное согласование недопустимо).
 */

// Утвердительные маркеры согласия (регистронезависимо, по границам слова).
const APPROVE_WORDS = [
  'добро', 'согласовано', 'согласен', 'согласна', 'утверждаю', 'утверждено',
  'одобряю', 'одобрено', 'оплачивайте', 'оплачиваем', 'можно оплачивать',
  'подтверждаю', 'да, оплачиваем', 'ок на оплату'
];
// Отрицания: если рядом (в той же строке) — согласием НЕ считаем.
const NEGATIONS = [
  'не добро', 'не согласовано', 'не согласен', 'не согласна', 'не утверждаю',
  'не одобрено', 'не подтверждаю', 'отклоняю', 'отклонено', 'отказано', 'против',
  'не оплачивать', 'нельзя оплачивать', 'отложить', 'на доработку'
];
// Вопросы: «согласовать?» — не согласие.
const QUESTION_HINTS = ['согласовать?', 'согласуем?', 'оплачивать ли', 'можно ли', 'надо ли'];

/** Убрать цитаты прежней переписки и подпись. */
function stripQuotes(text) {
  let s = String(text || '');
  // Ящики режут цитаты по этим маркерам.
  const cutMarkers = [
    /\n\s*-{2,}\s*(исходное|первоначальное)\s+сообщение\s*-{2,}/i,
    /\n\s*>{1,}/,                              // строка цитаты
    /\n\s*От:\s.*\n\s*Кому:/i,                // Outlook-блок
    /\n\s*From:\s.*\n\s*Sent:/i,              // англ. блок
    /\n\s*письмо\s+от\s+/i,
    /\n\s*--\s*\n/                             // подпись
  ];
  for (const re of cutMarkers) {
    const m = s.split(re);
    if (m.length > 1) s = m[0];
  }
  return s.trim();
}

/**
 * Есть ли утвердительное согласие в теле.
 * @param {string} body
 * @returns {{approve:boolean, word?:string, negative?:boolean, question?:boolean}}
 */
function detectApproval(body) {
  const s = stripQuotes(body).toLowerCase();
  if (!s) return { approve: false };
  const negHit = NEGATIONS.find((n) => s.includes(n));
  if (negHit) return { approve: false, negative: true, word: negHit };
  const qHit = QUESTION_HINTS.find((q) => s.includes(q));
  if (qHit) return { approve: false, question: true, word: qHit };
  const hit = APPROVE_WORDS.find((w) => {
    // «добро» как отдельное слово (не в «доброжелательный», не в «доброе утро»).
    const re = new RegExp('(^|[^а-яё])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^а-яё]|$)', 'i');
    return re.test(s);
  });
  return hit ? { approve: true, word: hit } : { approve: false };
}

/** Явный отказ (для отдельного класса, не путать с «не согласие»). */
function detectRejection(body) {
  const s = stripQuotes(body).toLowerCase();
  const rej = ['отклоняю', 'отклонено', 'отказано', 'не согласовано', 'отказ', 'на доработку', 'верни', 'вернуть'];
  const hit = rej.find((w) => s.includes(w));
  return hit ? { reject: true, word: hit } : { reject: false };
}

module.exports = { stripQuotes, detectApproval, detectRejection, APPROVE_WORDS, NEGATIONS };
