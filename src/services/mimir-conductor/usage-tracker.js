'use strict';

/**
 * Usage Tracker — аккумулятор токенов/стоимости для текущего agent_run.
 *
 * Использует AsyncLocalStorage (Node.js) — контекст «течёт» сквозь async-вызовы
 * автоматически. tool-executor.callAgent оборачивает impl.run(...) в als.run(...),
 * ai-provider.complete() после каждого ответа вызывает addUsage(result.usage),
 * tool-executor читает getUsage() и передаёт в finishAgentRun.
 *
 * Зачем: все 30 агентов Conductor шлют запросы через aiProvider.complete(), но
 * результаты {usage} никогда не собирались в agent_run — input_tokens/output_tokens/
 * cost_rub оставались 0 у всех агентов и у run в целом. Этот модуль починяет учёт
 * без правки 30 файлов агентов — точка инжекции одна (callAgent в tool-executor).
 */

const { AsyncLocalStorage } = require('node:async_hooks');
const als = new AsyncLocalStorage();

/**
 * Запустить fn в контексте, в котором будет накапливаться usage.
 * @returns результат fn
 */
function runInContext(initialCtx, fn) {
  const ctx = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    calls: 0,
    ...(initialCtx || {})
  };
  return als.run(ctx, fn);
}

/**
 * Прибавить usage от одного ответа AI-провайдера. Безопасно вне контекста — no-op.
 * Принимает оба формата: camelCase (наш внутренний) и snake_case (сырые поля API).
 */
function addUsage(usage, actualApiId = null) {
  if (!usage) return;
  const ctx = als.getStore();
  if (!ctx) return;
  const inTok = Number(usage.inputTokens ?? usage.input_tokens ?? usage.prompt_tokens) || 0;
  const outTok = Number(usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens) || 0;
  const cReadTok = Number(usage.cacheReadTokens ?? usage.cache_read_input_tokens) || 0;
  const cWriteTok = Number(usage.cacheWriteTokens ?? usage.cache_creation_input_tokens) || 0;
  ctx.inputTokens += inTok;
  ctx.outputTokens += outTok;
  ctx.cacheReadTokens += cReadTok;
  ctx.cacheWriteTokens += cWriteTok;
  ctx.calls += 1;
  // Запоминаем реально использованную модель — последний победитель в fallback цепочке
  if (actualApiId) ctx.actualApiId = actualApiId;
}

/** Получить снимок накопленного usage. Возвращает null если вне контекста. */
function getUsage() {
  const ctx = als.getStore();
  if (!ctx) return null;
  return {
    inputTokens: ctx.inputTokens,
    outputTokens: ctx.outputTokens,
    cacheReadTokens: ctx.cacheReadTokens,
    cacheWriteTokens: ctx.cacheWriteTokens,
    calls: ctx.calls
  };
}

/** Очистить (для нестандартных сценариев — в норме не нужно). */
function resetUsage() {
  const ctx = als.getStore();
  if (!ctx) return;
  ctx.inputTokens = 0;
  ctx.outputTokens = 0;
  ctx.cacheReadTokens = 0;
  ctx.cacheWriteTokens = 0;
  ctx.calls = 0;
}

module.exports = { runInContext, addUsage, getUsage, resetUsage, _als: als };
