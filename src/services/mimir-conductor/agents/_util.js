/**
 * ASGARD CRM — Mimir Conductor: общие утилиты агентов (Сессия 4)
 * ═══════════════════════════════════════════════════════════════════════════
 * Мелкие хелперы, переиспользуемые ядерными агентами: парсинг строгого JSON из
 * ответа LLM, sha256, форматирование рублей, разбор строк "THOUGHT: ..." из
 * текстового потока модели в мысли War Room.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const crypto = require('crypto');

/** sha256-хеш строки (hex). */
function sha256(str) {
  return crypto.createHash('sha256').update(String(str)).digest('hex');
}

/**
 * Извлечь и распарсить строгий JSON из текста ответа LLM.
 * Модели иногда оборачивают JSON в ```json ... ``` или добавляют преамбулу —
 * берём подстроку от первой { до последней }.
 * @param {string} text
 * @returns {Object}
 * @throws если JSON не удалось распарсить
 */
function parseStrictJson(text) {
  if (text == null) throw new Error('parseStrictJson: пустой ответ модели');
  const s = String(text).trim();

  // Снимаем markdown-ограждение, если есть
  let body = s;
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) body = fence[1].trim();

  // Берём от первой { до последней }
  const first = body.indexOf('{');
  const last = body.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error('parseStrictJson: в ответе модели не найден JSON-объект');
  }
  const json = body.slice(first, last + 1);
  return JSON.parse(json);
}

/** Форматирование суммы в рубли: 1 234 567 ₽. */
function formatRub(n) {
  const num = Math.round(Number(n) || 0);
  return num.toLocaleString('ru-RU') + ' ₽';
}

/**
 * Прокинуть строки вида "THOUGHT: <текст>" из текстового потока модели в
 * onThought. Возвращает функцию-обработчик для onText.
 * @param {Function} onThought
 */
function thoughtSink(onThought) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      const m = line.match(/THOUGHT:\s*(.+)/);
      if (m && m[1].trim()) onThought(m[1].trim());
    }
  };
}

module.exports = { sha256, parseStrictJson, formatRub, thoughtSink };
