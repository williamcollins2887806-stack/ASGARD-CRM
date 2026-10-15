'use strict';

/**
 * plainText — срезает markdown-разметку из текста для каналов, которые её
 * не рендерят (web-push, Telegram-уведомление, SMS).
 *
 * Зачем: генераторы Мимира отдают markdown (`**Отчёт по звонкам**`, `# заголовок`,
 * `[текст](url)`, списки, таблицы). В чате Huginn его рендерит renderAiMarkdown,
 * но push/OS-notification показывают сырые звёздочки и пайпы (класс дефекта:
 * «**текст**» в мобильных уведомлениях Мимира, 15.10.2026).
 *
 * Не трогает сам текст сообщения в БД — только копию для доставки.
 */

/**
 * @param {string} input — исходный текст (может содержать markdown)
 * @returns {string} — плоский текст без разметки
 */
function toPlainText(input) {
  if (input == null) return '';
  let s = String(input);

  // Код-блоки: ```lang\n...``` → содержимое (для пуша — просто текст)
  s = s.replace(/```[^\n]*\n([\s\S]*?)```/g, (_, code) => code.trim());
  // Инлайн-код `x` → x
  s = s.replace(/`([^`\n]+)`/g, '$1');
  // Картинки ![alt](url) → alt ; ссылки [текст](url) → текст
  s = s.replace(/!\[([^\]]*)\]\([^)\s]+\)/g, '$1');
  s = s.replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, '$1');
  // Заголовки ATX в начале строки: ### Заголовок → Заголовок
  s = s.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '');
  // Жирный/курсив. Два прохода нужны для вложенности: `**a *b* c**` —
  // первый проход снимает внутренний курсив, второй — внешний жирный.
  // ВАЖНО: `*x*` снимается только на границе слова и без пробелов внутри,
  // иначе ломается арифметика/размеры: «2*3*4» → «2*3*4», а не «234».
  const INLINE_FENCE = /(^|[\s([{«"'.,;:!?])/;
  const INLINE_TAIL = /(?=[\s)\]}»"'.,;:!?]|$)/;
  for (let pass = 0; pass < 2; pass++) {
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '$1');
    s = s.replace(/__([^_\n]+)__/g, '$1');
    const before = s;
    s = s.replace(new RegExp(INLINE_FENCE.source + '\\*([^\\s*](?:[^*\\n]*[^\\s*])?)\\*' + INLINE_TAIL.source, 'g'), '$1$2');
    s = s.replace(new RegExp(INLINE_FENCE.source + '_([^\\s_](?:[^_\\n]*[^\\s_])?)_' + INLINE_TAIL.source, 'g'), '$1$2');
    if (s === before) break;
  }
  // Зачёркнутый ~~x~~ → x (ровно двойные тильды, не трогаем одиночные)
  s = s.replace(/~~([^~\n]+)~~/g, '$1');
  // Цитата > x → x
  s = s.replace(/^[ \t]{0,3}>[ \t]?/gm, '');
  // Маркеры списка: - x / * x / + x → x ; 1. x → x
  s = s.replace(/^[ \t]*[-*+][ \t]+/gm, '');
  s = s.replace(/^[ \t]*\d+\.[ \t]+/gm, '');
  // Горизонтальная линия --- / *** / ___ → пустая строка
  s = s.replace(/^[ \t]*([-*_])\1{2,}[ \t]*$/gm, '');
  // Разделители таблиц: |---|---| → убрать строку целиком
  s = s.replace(/^[ \t]*\|?[ \t:|-]{3,}\|?[ \t]*$/gm, '');
  // Пайпы таблиц → пробел-разделитель
  s = s.replace(/[ \t]*\|[ \t]*/g, '  ');
  // NB: остаточные одиночные `*` НЕ вырезаем — `50% * 2` и `2*3` это не markdown.

  // Схлопнуть пробелы, сохранив переводы строк (макс. одна пустая между абзацами)
  s = s.replace(/[ \t]{2,}/g, ' ');
  s = s.replace(/[ \t]+$/gm, '');
  s = s.replace(/\n{3,}/g, '\n\n');

  return s.trim();
}

/**
 * Короткая версия для пуш-тела: плоский текст, одна строка, обрезка по лимиту.
 * @param {string} input
 * @param {number} [maxLen=140] — предел длины (OS-уведомление обрезает ~200)
 */
function toPlainPreview(input, maxLen = 140) {
  const flat = toPlainText(input).replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const limit = Number(maxLen) > 0 ? Number(maxLen) : 140;
  return flat.length > limit ? flat.slice(0, limit - 1).trimEnd() + '…' : flat;
}

module.exports = { toPlainText, toPlainPreview };
