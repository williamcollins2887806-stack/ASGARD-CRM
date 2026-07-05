'use strict';

/**
 * ASGARD CRM — единый реестр моделей RouterAI.
 * Все AI-вызовы идут через https://routerai.ru/api/v1 (OpenAI-compatible).
 *
 * Тиры (июль 2026):
 *   DEFAULT — deepseek/deepseek-v4-pro  (1M, дешёвый JSON)
 *   FAST    — google/gemini-3.5-flash   (1M, vision/light chat)
 *   LONG    — x-ai/grok-4.20            (2M, длинные письма/лекции)
 */

const ROUTERAI_BASE_URL = 'https://routerai.ru/api/v1';
const ROUTERAI_CHAT_URL = `${ROUTERAI_BASE_URL}/chat/completions`;

const MODEL_DEFAULT = 'deepseek/deepseek-v4-pro';
const MODEL_FAST = 'google/gemini-3.5-flash';
const MODEL_LONG = 'x-ai/grok-4.20';
const MODEL_EMBED_PRIMARY = 'voyage/voyage-3-large';
const MODEL_EMBED_FALLBACK = 'text-embedding-3-large';

const FALLBACK_CHAIN = [MODEL_DEFAULT, MODEL_FAST, MODEL_LONG];

/** Цены RouterAI, ₽ за 1M токенов (каталог routerai.ru, июль 2026). */
const ROUTERAI_PRICES = {
  [MODEL_DEFAULT]: { input: 61, output: 123 },
  [MODEL_FAST]: { input: 150, output: 903 },
  [MODEL_LONG]: { input: 118, output: 237 },
  'openai/gpt-5.5': { input: 508, output: 3052 },
  [MODEL_EMBED_PRIMARY]: { input: 13, output: 0 },
  [MODEL_EMBED_FALLBACK]: { input: 13, output: 0 },
};

/** Legacy bare IDs → RouterAI (переходный период для старых UI/DB записей). */
const LEGACY_MODEL_MAP = {
  'gpt-5.5': MODEL_DEFAULT,
  'gpt-5.4': MODEL_FAST,
  'grok-4.20-fast': MODEL_LONG,
  'grok-4.20': MODEL_LONG,
  'gemini-2.5-flash': MODEL_FAST,
  'gemini-3.5-flash': MODEL_FAST,
  'deepseek-v4-pro': MODEL_DEFAULT,
};

/** Токен-бюджеты для letter-context-builder (оставляем запас под output/reasoning). */
const LETTER_CONTEXT_BUDGETS = {
  [MODEL_DEFAULT]: 480_000,
  [MODEL_FAST]: 480_000,
  [MODEL_LONG]: 900_000,
};

const CHAT_MODELS = [
  {
    id: MODEL_DEFAULT,
    label: 'DeepSeek V4 Pro',
    short_hint: '🧠 Думающая, с данными CRM',
    description: 'Дешёвая модель с 1M контекстом. Видит БД, помнит диалог, JSON-ответы.',
    capabilities: {
      knows_crm_data: true,
      uses_chat_history: true,
      pros: ['Самая дешёвая 1M', 'Хороший JSON', 'Conductor + email + hints'],
      cons: ['Без vision', 'Медленнее Grok на длинных текстах'],
    },
    system_mode: 'full',
    default: true,
  },
  {
    id: MODEL_FAST,
    label: 'Gemini 3.5 Flash',
    short_hint: '⚡ Быстрая, vision/OCR',
    description: '1M контекст, multimodal. Light-чат, OCR, быстрые вопросы.',
    capabilities: {
      knows_crm_data: false,
      uses_chat_history: false,
      pros: ['Vision/OCR', 'Быстрый ответ', 'structured_outputs'],
      cons: ['Light mode — без полного CRM-контекста', 'Дороже DeepSeek на output'],
    },
    system_mode: 'light',
  },
  {
    id: MODEL_LONG,
    label: 'Grok 4.20',
    short_hint: '🚀 2M контекст, письма',
    description: '2M контекст для длинных писем, переписки и академии.',
    capabilities: {
      knows_crm_data: true,
      uses_chat_history: true,
      pros: ['2M контекст', 'Длинные документы', 'Быстрый стрим'],
      cons: ['Дороже DeepSeek', 'Может уступать в SQL/русском'],
    },
    system_mode: 'full',
  },
];

/** UI-модели для composer писем (те же 3 тира). */
const LETTER_AI_MODELS = [
  { id: MODEL_DEFAULT, label: 'DeepSeek V4 Pro', hint: '1M · дешёвая JSON · ×1.0', default: true },
  { id: MODEL_FAST, label: 'Gemini 3.5 Flash', hint: '1M · vision/light · быстрая', default: false },
  { id: MODEL_LONG, label: 'Grok 4.20', hint: '2M · длинные письма', default: false },
];

function normalizeModelId(id) {
  if (!id || typeof id !== 'string') return MODEL_DEFAULT;
  const trimmed = id.trim();
  if (LEGACY_MODEL_MAP[trimmed]) return LEGACY_MODEL_MAP[trimmed];
  return trimmed;
}

function getRouterAiPrice(apiId) {
  return ROUTERAI_PRICES[apiId] || ROUTERAI_PRICES[MODEL_DEFAULT];
}

function calculateRouterAiCostRub(apiId, usage = {}) {
  const prices = getRouterAiPrice(apiId);
  const inTok = Number(usage.inputTokens ?? usage.input_tokens) || 0;
  const outTok = Number(usage.outputTokens ?? usage.output_tokens) || 0;
  if (inTok === 0 && outTok === 0) return 0;
  const rub =
    (inTok / 1_000_000) * prices.input +
    (outTok / 1_000_000) * prices.output;
  return Math.round(rub * 10000) / 10000;
}

function getLetterContextBudget(modelId) {
  const norm = normalizeModelId(modelId);
  return LETTER_CONTEXT_BUDGETS[norm] || LETTER_CONTEXT_BUDGETS[MODEL_DEFAULT];
}

function getChatModelsForUi() {
  return CHAT_MODELS.map((m) => ({
    id: m.id,
    label: m.label,
    short_hint: m.short_hint || '',
    description: m.description,
    capabilities: m.capabilities || {},
    system_mode: m.system_mode,
    default: !!m.default,
    requires_usd_balance: false,
  }));
}

function getChatModel(id) {
  const norm = normalizeModelId(id);
  return CHAT_MODELS.find((m) => m.id === norm) || null;
}

function getDefaultChatModel() {
  return CHAT_MODELS.find((m) => m.default) || CHAT_MODELS[0];
}

module.exports = {
  ROUTERAI_BASE_URL,
  ROUTERAI_CHAT_URL,
  MODEL_DEFAULT,
  MODEL_FAST,
  MODEL_LONG,
  MODEL_EMBED_PRIMARY,
  MODEL_EMBED_FALLBACK,
  FALLBACK_CHAIN,
  ROUTERAI_PRICES,
  LEGACY_MODEL_MAP,
  LETTER_CONTEXT_BUDGETS,
  CHAT_MODELS,
  LETTER_AI_MODELS,
  normalizeModelId,
  getRouterAiPrice,
  calculateRouterAiCostRub,
  getLetterContextBudget,
  getChatModelsForUi,
  getChatModel,
  getDefaultChatModel,
};
