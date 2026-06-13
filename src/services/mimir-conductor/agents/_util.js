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

  // Шаг 1: пробуем строгий JSON.parse
  try { return JSON.parse(json); } catch (_) { /* fall through */ }

  // Шаг 2: relaxed-парс — sonnet иногда оставляет trailing comma,
  // одинарные кавычки или незавершённую строку. Чиним типовые опечатки.
  const cleaned = json
    .replace(/,(\s*[}\]])/g, '$1')                      // trailing comma before } or ]
    .replace(/([{\[,]\s*)'([^']*?)':/g, '$1"$2":')      // single-quoted keys → double
    .replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, ': "$1"') // single-quoted values → double
    .replace(/\bNone\b/g, 'null')                       // Python-стиль
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false');
  try { return JSON.parse(cleaned); } catch (_) { /* fall through */ }

  // Шаг 3: попытка обрезать на последней СБАЛАНСИРОВАННОЙ скобке (sonnet
  // иногда обрывает ответ на середине поля — берём то что есть).
  let depth = 0;
  let bestEnd = -1;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) bestEnd = i; }
  }
  if (bestEnd > 0) {
    try { return JSON.parse(cleaned.slice(0, bestEnd + 1)); } catch (_) { /* fall through */ }
  }

  throw new Error('parseStrictJson: не удалось распарсить JSON ни строгим, ни relaxed-парсером');
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

/**
 * Универсальный helper: AI-вызов + парс JSON с 3 попытками retry и graceful fallback.
 * Используется во всех агентах которые ждут JSON-ответ от LLM (sonnet/opus).
 *
 * @param {Object} aiProvider — модуль ai-provider
 * @param {Object} opts — параметры для aiProvider.completeWithStream
 * @param {Object} retryOpts — { onThought, agentName, maxAttempts=3, retryDelayMs=3000, fallback }
 *   fallback (опц.) — функция возвращающая безопасный объект, если все попытки упали.
 *   Если fallback не задан и все попытки упали — выбрасывается последняя ошибка.
 * @returns {Promise<Object>} распарсенный JSON-объект
 */
async function aiCompleteJson(aiProvider, opts, retryOpts = {}) {
  const { onThought = () => {}, agentName = 'agent', maxAttempts = 3, retryDelayMs = 3000, fallback = null } = retryOpts;
  let lastErr = null;
  const originalSystem = opts.system || '';
  const strictExtra = '\n\nКРИТИЧНО: верни ТОЛЬКО валидный JSON-объект. Без markdown-ограждений (`json), без комментариев, без trailing comma. Все ключи и строки в двойных кавычках. Никаких тегов цитат.';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // temperature=0 для детерминированных просчётов Conductor — 5 одинаковых ранов на одном и том же ТЗ
      const callOpts = { ...opts, system: attempt === 1 ? originalSystem : originalSystem + strictExtra, temperature: opts.temperature ?? 0 };
      const result = await aiProvider.completeWithStream(callOpts);
      if (result._stub || aiProvider.isStubMode()) {
        return { _stub: true, _result: result };
      }
      const parsed = parseStrictJson(result.text);
      if (attempt > 1) onThought(`✓ ${agentName}: JSON распарсен с попытки ${attempt}`);
      return parsed;
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts) {
        onThought(`⚠ ${agentName} (попытка ${attempt}/${maxAttempts}): ${e.message} — повторяю с более строгим промптом`);
        if (retryDelayMs > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
  }
  onThought(`⚠ ${agentName}: все ${maxAttempts} попытки упали — ${lastErr ? lastErr.message : 'unknown'}`);
  if (typeof fallback === 'function') {
    onThought(`→ ${agentName}: применяю детерминированный fallback`);
    return fallback();
  }
  throw lastErr || new Error(`${agentName}: parse failed ${maxAttempts} times`);
}

module.exports = { sha256, parseStrictJson, formatRub, thoughtSink, aiCompleteJson };
