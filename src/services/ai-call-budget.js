'use strict';
/**
 * ai-call-budget.js — сколько токенов просить под ответ и когда резать текст.
 *
 * ── Зачем ─────────────────────────────────────────────────────────────────
 * Разбор ведомости упирался в потолок ответа, а не в контекст. На тендере 2138
 * (675 позиций в 7 приложениях) 32k токенов не хватало: ответ обрывался в
 * finish_reason=length, позиции терялись на стыках добора (675 → 318 → 172).
 *
 * Контекст модели — 1M токенов, документы 318 тыс. символов = 8 % контекста.
 * Значит проблема была НЕ в размере входа, а в размере выхода и в том, что
 * нарезка включалась по размеру текста, а не по потребности в ответе.
 *
 * ── Как считаем ───────────────────────────────────────────────────────────
 * Вход: ожидаемое число позиций (оценка по строкам таблицы или слово модели).
 * Выход: сколько токенов нужно на JSON с позициями + обвязка.
 *
 * Правило простое: пока расчётный выход меньше предела модели — отдаём всю
 * ведомость одним вызовом; иначе режем на порции, которые точно влезают.
 */

const models = require('./ai-models');

/** Токенов на одну позицию ДВ: name, volume, unit, method, objects, source_ref… */
const TOKENS_PER_POSITION = 50;

/** Обвязка ответа: summary, volume_summary, risks, mtr_suggestions, скобки JSON. */
const RESPONSE_OVERHEAD_TOKENS = 4000;

/** Минимальный запрос выхода: меньше — модель не успеет даже короткий ответ. */
const MIN_OUTPUT_TOKENS = 32_000;

/** Запас под промпт и системный текст при проверке контекста. */
const CONTEXT_SAFETY_TOKENS = 16_000;

/** Сколько символов примерно в одном токене (русский текст + JSON). */
const CHARS_PER_TOKEN = 3.2;

/**
 * Сколько токенов выхода нужно под ожидаемое число позиций.
 * @param {number} expectedPositions
 * @returns {number}
 */
function neededOutputTokens(expectedPositions) {
  const n = Math.max(0, Number(expectedPositions) || 0);
  return Math.round(n * TOKENS_PER_POSITION + RESPONSE_OVERHEAD_TOKENS);
}

/**
 * Лимит выхода для конкретного вызова.
 *
 * @param {object} p
 * @param {number} p.expectedPositions — сколько позиций ждём
 * @param {string} [p.model] — id модели (предел берётся из каталога)
 * @returns {{ limit:number, needed:number, modelCap:number, fitsOneCall:boolean }}
 */
function outputLimit(p) {
  const o = p || {};
  const needed = neededOutputTokens(o.expectedPositions);
  const modelCap = models.maxOutputTokensFor(o.model);
  const limit = Math.min(modelCap, Math.max(MIN_OUTPUT_TOKENS, needed));
  return {
    limit,
    needed,
    modelCap,
    // Один вызов достаточен, если нужный выход не упирается в предел модели.
    fitsOneCall: needed <= modelCap
  };
}

/**
 * Влезает ли текст в контекст модели при заданном выходе.
 *
 * @param {object} p
 * @param {number} p.chars — длина текста в символах
 * @param {number} p.outputTokens — сколько просим на выход
 * @param {number} [p.contextTokens] — контекст модели (по умолчанию 1M)
 * @returns {{ fits:boolean, inputTokens:number, total:number, contextTokens:number }}
 */
function contextFit(p) {
  const o = p || {};
  const inputTokens = Math.ceil((Number(o.chars) || 0) / CHARS_PER_TOKEN);
  const contextTokens = Number(o.contextTokens) || 1_000_000;
  const total = inputTokens + (Number(o.outputTokens) || 0) + CONTEXT_SAFETY_TOKENS;
  return { fits: total <= contextTokens, inputTokens, total, contextTokens };
}

/**
 * Главное решение: отдавать одним вызовом или резать.
 *
 * Нарезка нужна только когда ответ не влезает в предел модели. Размер входа
 * при контексте 1M почти никогда не является причиной — 318 тыс. символов
 * это 8 % контекста.
 *
 * @param {object} p
 * @param {number} p.expectedPositions
 * @param {number} p.chars
 * @param {string} [p.model]
 * @param {number} [p.contextTokens]
 * @returns {{ chunk:boolean, reason:string, output:object, context:object }}
 */
function planCall(p) {
  const o = p || {};
  const output = outputLimit({ expectedPositions: o.expectedPositions, model: o.model });
  const context = contextFit({ chars: o.chars, outputTokens: output.limit, contextTokens: o.contextTokens });

  if (!output.fitsOneCall) {
    return {
      chunk: true,
      reason: `ответ не влезает: нужно ~${output.needed} токенов, предел модели ${output.modelCap}`,
      output,
      context
    };
  }
  if (!context.fits) {
    return {
      chunk: true,
      reason: `вход не влезает в контекст: ~${context.total} при ${context.contextTokens}`,
      output,
      context
    };
  }
  return { chunk: false, reason: 'влезает одним вызовом', output, context };
}

module.exports = {
  TOKENS_PER_POSITION,
  RESPONSE_OVERHEAD_TOKENS,
  MIN_OUTPUT_TOKENS,
  neededOutputTokens,
  outputLimit,
  contextFit,
  planCall
};
