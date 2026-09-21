/**
 * email-text.js — общие утилиты извлечения читаемого текста из письма.
 *
 * Появилось при починке D-204: у части писем body_text пуст (Яндекс/Fwd шлют
 * только HTML). Раньше strip-теги жили локально в imap.js, а pre_tender_requests
 * заполнял work_description из body_text — и карточка РП получала пустое описание.
 * Теперь логика одна на оба места.
 */
'use strict';

/**
 * Грубое превращение HTML в читаемый текст (без внешних зависимостей).
 * @param {string} h — HTML
 * @returns {string}
 */
function stripHtml(h) {
  return String(h || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/(div|p|br|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

/**
 * Лучший доступный текст письма: body_text, иначе — очищенный body_html.
 * @param {{body_text?: string, body_html?: string}} email
 * @param {number} [minLen=30] — насколько «пустым» считать body_text
 * @returns {string}
 */
function bestEmailText(email, minLen = 30) {
  const bt = (email?.body_text || '').trim();
  if (bt.length > minLen) return bt;
  return stripHtml(email?.body_html || '');
}

module.exports = { stripHtml, bestEmailText };
