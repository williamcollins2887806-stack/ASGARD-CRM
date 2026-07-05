/**
 * ASGARD CRM — Mimir Conductor: конфиг моделей и цен
 * ═══════════════════════════════════════════════════════════════════════════
 * Провайдер: RouterAI (https://routerai.ru/api/v1, OpenAI-compatible).
 *
 * Тиры (см. ai-models.js):
 *   DEFAULT — deepseek/deepseek-v4-pro  (Conductor agents, JSON, email)
 *   FAST    — google/gemini-3.5-flash   (vision, light chat, web-search)
 *   LONG    — x-ai/grok-4.20            (длинные документы)
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const db = require('../db');
const {
  MODEL_DEFAULT,
  MODEL_FAST,
  MODEL_LONG,
  MODEL_EMBED_PRIMARY,
  MODEL_EMBED_FALLBACK,
  FALLBACK_CHAIN,
  calculateRouterAiCostRub,
  normalizeModelId,
} = require('../ai-models');

const DEFAULT_USD_RUB = 90;
const DEFAULT_FALLBACK_CHAIN = FALLBACK_CHAIN.slice();

const models = {
  'opus-4-7': {
    provider: 'routerai',
    api_id: MODEL_DEFAULT,
    anthropic_api_id: 'claude-opus-4-8',
    supports_extended_thinking: true,
    supports_tool_use: true,
    max_context: 1_000_000,
    role: 'Conductor для крупных контрактов (>50M) — DeepSeek V4 Pro',
  },
  'sonnet-4-6': {
    provider: 'routerai',
    api_id: MODEL_DEFAULT,
    anthropic_api_id: 'claude-sonnet-4-6',
    supports_extended_thinking: true,
    supports_tool_use: true,
    max_context: 1_000_000,
    role: 'Conductor для средних + структурированные агенты — DeepSeek V4 Pro',
  },
  'haiku-4-5': {
    provider: 'routerai',
    api_id: MODEL_DEFAULT,
    anthropic_api_id: 'claude-haiku-4-5',
    supports_extended_thinking: false,
    supports_tool_use: true,
    max_context: 1_000_000,
    role: 'Быстрые трансформации, JSON-репайр, классификация — DeepSeek V4 Pro',
  },
  'gpt-5': {
    provider: 'routerai',
    api_id: MODEL_FAST,
    supports_extended_thinking: false,
    supports_tool_use: true,
    max_context: 1_000_000,
    role: 'Чтение чертежей и сканов (vision) — Gemini 3.5 Flash',
  },
  'sonar-opus': {
    provider: 'routerai',
    api_id: MODEL_FAST,
    supports_extended_thinking: false,
    supports_tool_use: false,
    max_context: 1_000_000,
    role: 'Веб-поиск цен — Gemini 3.5 Flash + web plugin',
  },
  'web-search-fast': {
    provider: 'routerai',
    api_id: MODEL_FAST,
    supports_extended_thinking: false,
    supports_tool_use: true,
    max_context: 1_000_000,
    role: 'Быстрый web search в agent loop',
  },
  'yandex-pro': {
    provider: 'routerai',
    api_id: MODEL_DEFAULT,
    supports_extended_thinking: false,
    supports_tool_use: true,
    max_context: 1_000_000,
    role: 'Нормативы РФ (ГЭСН/ФЕР) — DeepSeek V4 Pro',
  },
  'voyage-3': {
    provider: 'routerai',
    api_id: MODEL_EMBED_PRIMARY,
    disabled: false,
    fallback_api_id: MODEL_EMBED_FALLBACK,
    is_embedding: true,
    dimensions: 1024,
    max_context: 32000,
    role: 'Embeddings для RAG — voyage-3-large',
  },
  'deepseek-v4': {
    provider: 'routerai',
    api_id: MODEL_DEFAULT,
    supports_extended_thinking: false,
    supports_tool_use: true,
    max_context: 1_000_000,
    role: 'Монте-Карло + перебор сценариев — DeepSeek V4 Pro',
  },
};

function pickConductorModel(contractValueRub) {
  const v = Number(contractValueRub) || 0;
  if (v >= 50_000_000) return 'opus-4-7';
  return 'sonnet-4-6';
}

function shouldUseThinking(contractValueRub) {
  return (Number(contractValueRub) || 0) >= 1_000_000;
}

function getModel(key) {
  return models[key] || null;
}

async function getUsdToRub() {
  try {
    const r = await db.query("SELECT value_json FROM settings WHERE key = 'usd_rub_rate'");
    if (r.rows[0]?.value_json != null) {
      let raw = r.rows[0].value_json;
      let parsed;
      try { parsed = JSON.parse(raw); } catch (_) { parsed = raw; }
      const num = parseFloat(parsed);
      if (Number.isFinite(num) && num > 0) return num;
    }
  } catch (_) { /* settings может не иметь ключа */ }
  return DEFAULT_USD_RUB;
}

function calculateCostRub(modelKey, usage = {}, usdRub = DEFAULT_USD_RUB, actualApiId = null) {
  const m = models[modelKey];
  if (!m) return 0;
  const inTok = Number(usage.inputTokens ?? usage.input_tokens) || 0;
  const outTok = Number(usage.outputTokens ?? usage.output_tokens) || 0;
  if (inTok === 0 && outTok === 0) return 0;

  const apiId = normalizeModelId(actualApiId || m.api_id);
  if (apiId) {
    return calculateRouterAiCostRub(apiId, usage);
  }

  if (m.price_usd_per_1m_input != null || m.price_usd_per_1m_output != null) {
    const usd =
      (inTok / 1_000_000) * (m.price_usd_per_1m_input || 0) +
      (outTok / 1_000_000) * (m.price_usd_per_1m_output || 0);
    const rub = usd * (Number(usdRub) || DEFAULT_USD_RUB);
    return Math.round(rub * 10000) / 10000;
  }

  return 0;
}

function getFallbackChain(modelKey) {
  const m = models[modelKey];
  if (!m) return DEFAULT_FALLBACK_CHAIN.slice();
  if (Array.isArray(m.fallback_chain) && m.fallback_chain.length) {
    return m.fallback_chain.slice();
  }
  const chain = [];
  if (m.api_id && !m.disabled) chain.push(normalizeModelId(m.api_id));
  for (const id of DEFAULT_FALLBACK_CHAIN) {
    if (!chain.includes(id)) chain.push(id);
  }
  return chain;
}

module.exports = {
  models,
  DEFAULT_USD_RUB,
  DEFAULT_FALLBACK_CHAIN,
  pickConductorModel,
  shouldUseThinking,
  getModel,
  getFallbackChain,
  getUsdToRub,
  calculateCostRub,
};
