/**
 * ASGARD CRM — Mimir Conductor: конфиг моделей и цен
 * ═══════════════════════════════════════════════════════════════════════════
 * Сессия 1, Шаг 1.5.
 *
 * ВАЖНО ПРО ПРОВАЙДЕРОВ (уточнение заказчика к плану):
 * Всё идёт через ОДИН прокси routerai.ru (OpenAI-совместимый эндпоинт,
 * переменная OPENAI_URL, ключ OPENAI_API_KEY). Никаких отдельных ключей
 * PERPLEXITY_API_KEY / DEEPSEEK_API_KEY / VOYAGE_API_KEY — все альтернативные
 * модели вызываются тем же OPENAI_URL с указанием конкретного `model` в теле.
 *
 * Поэтому provider у альтернативных моделей = 'routerai' (а не perplexity/voyage/deepseek).
 * `api_id` — точное имя модели в routerai. Где имя неизвестно — стоит TODO и
 * запасной (fallback) вариант, чтобы код не падал.
 *
 * Anthropic-модели можно звать двумя путями:
 *   - через routerai (provider 'routerai', api_id 'anthropic/claude-...') — основной путь;
 *   - напрямую в api.anthropic.com (provider 'anthropic') — когда нужны фичи,
 *     которых нет в routerai (например нативный streaming thinking-блоков).
 * В конфиге для каждой Claude-модели указаны ОБА id: `api_id` (routerai) и
 * `anthropic_api_id` (прямой Anthropic). Какой использовать — решает вызывающий код.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const db = require('../db');

// Курс по умолчанию, если в settings нет usd_rub_rate
const DEFAULT_USD_RUB = 90;

/**
 * Каталог моделей.
 *
 * Поля:
 *   provider                 — 'routerai' | 'anthropic' (для прямых вызовов)
 *   api_id                   — имя модели в routerai (в теле запроса `model`)
 *   anthropic_api_id         — имя модели в api.anthropic.com (для прямого вызова)
 *   price_usd_per_1m_input   — цена за 1M входных токенов, USD
 *   price_usd_per_1m_output  — цена за 1M выходных токенов, USD
 *   supports_extended_thinking
 *   supports_tool_use
 *   max_context
 *   role                     — для документации: чем занимается модель
 */
const models = {
  // ─── Conductor / рабочие лошадки (Claude) ──────────────────────────────
  'opus-4-7': {
    provider: 'routerai',
    api_id: 'anthropic/claude-opus-4.7',        // TODO: уточнить точное имя модели в routerai
    anthropic_api_id: 'claude-opus-4-7',         // TODO: уточнить точное имя у Anthropic
    price_usd_per_1m_input: 15.0,
    price_usd_per_1m_output: 75.0,
    supports_extended_thinking: true,
    supports_tool_use: true,
    max_context: 200000,
    role: 'Conductor для крупных контрактов (>50M)'
  },
  'sonnet-4-6': {
    provider: 'routerai',
    api_id: 'anthropic/claude-sonnet-4.6',       // совпадает с дефолтом OPENAI_MODEL в ai-provider.js
    anthropic_api_id: 'claude-sonnet-4-6-20250514',
    price_usd_per_1m_input: 3.0,
    price_usd_per_1m_output: 15.0,
    supports_extended_thinking: true,
    supports_tool_use: true,
    max_context: 200000,
    role: 'Conductor для средних + структурированные агенты'
  },
  'haiku-4-5': {
    provider: 'routerai',
    api_id: 'anthropic/claude-haiku-4.5',        // TODO: уточнить точное имя модели в routerai
    anthropic_api_id: 'claude-haiku-4-5-20251001',
    price_usd_per_1m_input: 0.25,
    price_usd_per_1m_output: 1.25,
    supports_extended_thinking: false,
    supports_tool_use: true,
    max_context: 200000,
    role: 'Быстрые трансформации, классификация'
  },

  // ─── Зрение (чертежи и сканы) ──────────────────────────────────────────
  'gpt-5': {
    provider: 'routerai',
    api_id: 'openai/gpt-5',                       // TODO: уточнить точное имя модели в routerai
    price_usd_per_1m_input: 1.25,                 // TODO: уточнить тариф gpt-5
    price_usd_per_1m_output: 10.0,                // TODO: уточнить тариф gpt-5
    supports_extended_thinking: false,
    supports_tool_use: true,
    max_context: 256000,
    role: 'Чтение чертежей и сканов (vision)'
  },

  // ─── Веб-поиск цен (Perplexity Sonar через routerai) ───────────────────
  'sonar-opus': {
    provider: 'routerai',
    api_id: 'perplexity/sonar-opus-online',       // TODO: уточнить точное имя модели в routerai
    price_usd_per_1m_input: 5.0,                  // TODO: уточнить тариф sonar
    price_usd_per_1m_output: 5.0,                 // TODO: уточнить тариф sonar
    supports_extended_thinking: false,
    supports_tool_use: false,
    max_context: 127000,
    role: 'Веб-поиск цен'
  },
  // Реально доступная и протестированная модель web-search в ai-provider.js.
  // executeWebSearch() использует именно её (plugin 'web', engine 'native').
  'web-search-fast': {
    provider: 'routerai',
    api_id: 'google/gemini-2.5-flash',
    price_usd_per_1m_input: 0.15,
    price_usd_per_1m_output: 0.60,
    supports_extended_thinking: false,
    supports_tool_use: true,
    max_context: 1000000,
    role: 'Быстрый web search в agent loop (фактический исполнитель plugin web)'
  },

  // ─── Нормативы РФ (ГЭСН/ФЕР) ───────────────────────────────────────────
  'yandex-pro': {
    provider: 'yandex',                           // отдельный путь (YANDEX_GPT_API_KEY + FOLDER_ID)
    api_id: 'yandexgpt/latest',                   // TODO: уточнить — в дефолте сейчас qwen3-235b-a22b-fp8/latest
    price_usd_per_1m_input: 0.0,                  // тарификация Yandex отдельная (рубли/у.е.), считаем приблизительно
    price_usd_per_1m_output: 0.0,                 // TODO: уточнить тариф YandexGPT
    supports_extended_thinking: false,
    supports_tool_use: false,
    max_context: 32000,
    role: 'Нормативы РФ (ГЭСН/ФЕР)'
  },

  // ─── Embeddings для RAG ────────────────────────────────────────────────
  'voyage-3': {
    provider: 'routerai',
    api_id: 'voyage/voyage-3-large',              // TODO: уточнить точное имя embeddings-модели в routerai
    // fallback на OpenAI embeddings, если voyage в routerai недоступен:
    fallback_api_id: 'openai/text-embedding-3-large',
    price_usd_per_1m_input: 0.12,                 // TODO: уточнить тариф voyage
    price_usd_per_1m_output: 0.0,
    is_embedding: true,
    dimensions: 1024,                             // TODO: уточнить размерность voyage-3-large
    max_context: 32000,
    role: 'Embeddings для RAG'
  },

  // ─── Монте-Карло / перебор сценариев ───────────────────────────────────
  'deepseek-v4': {
    provider: 'routerai',
    api_id: 'deepseek/deepseek-chat',             // TODO: уточнить точное имя модели в routerai
    price_usd_per_1m_input: 0.27,                 // TODO: уточнить тариф deepseek
    price_usd_per_1m_output: 1.10,                // TODO: уточнить тариф deepseek
    supports_extended_thinking: false,
    supports_tool_use: true,
    max_context: 128000,
    role: 'Монте-Карло + перебор сценариев'
  }
};

/**
 * Логический выбор Conductor-модели по стоимости контракта.
 * >50M → opus; 1M..50M → sonnet (+thinking); <1M → sonnet (без thinking).
 * Возвращает ключ из `models`.
 */
function pickConductorModel(contractValueRub) {
  const v = Number(contractValueRub) || 0;
  if (v >= 50_000_000) return 'opus-4-7';
  return 'sonnet-4-6';
}

/**
 * Нужен ли extended thinking для данного контракта.
 * <1M → нет (экономим), иначе — да.
 */
function shouldUseThinking(contractValueRub) {
  return (Number(contractValueRub) || 0) >= 1_000_000;
}

/** Получить конфиг модели по ключу (или null). */
function getModel(key) {
  return models[key] || null;
}

/**
 * Текущий курс USD→RUB.
 * Читает settings.usd_rub_rate (value_json — JSON-строка/число), иначе DEFAULT_USD_RUB.
 */
async function getUsdToRub() {
  try {
    const r = await db.query("SELECT value_json FROM settings WHERE key = 'usd_rub_rate'");
    if (r.rows[0]?.value_json != null) {
      let raw = r.rows[0].value_json;
      // value_json может быть '90', '"90"', или '90.5'
      let parsed;
      try { parsed = JSON.parse(raw); } catch (_) { parsed = raw; }
      const num = parseFloat(parsed);
      if (Number.isFinite(num) && num > 0) return num;
    }
  } catch (_) { /* settings может не иметь ключа — это нормально */ }
  return DEFAULT_USD_RUB;
}

/**
 * Рассчитать стоимость вызова в рублях.
 * @param {string} modelKey — ключ из models
 * @param {{inputTokens:number, outputTokens:number}|{input_tokens:number, output_tokens:number}} usage
 *        Принимает оба формата: camelCase (наш внутренний) и snake_case
 *        (как реально приходит в поле `usage` ответа routerai/Anthropic/OpenAI).
 * @param {number} usdRub — курс (если не передан, используется DEFAULT_USD_RUB;
 *                          для точности лучше передавать результат getUsdToRub()).
 * @returns {number} стоимость в рублях (округлено до 4 знаков)
 */
function calculateCostRub(modelKey, usage = {}, usdRub = DEFAULT_USD_RUB) {
  const m = models[modelKey];
  if (!m) return 0;
  // usage может прийти как {inputTokens} (наш код) или {input_tokens} (сырой ответ API)
  const inTok = Number(usage.inputTokens ?? usage.input_tokens) || 0;
  const outTok = Number(usage.outputTokens ?? usage.output_tokens) || 0;
  const usd =
    (inTok / 1_000_000) * (m.price_usd_per_1m_input || 0) +
    (outTok / 1_000_000) * (m.price_usd_per_1m_output || 0);
  const rub = usd * (Number(usdRub) || DEFAULT_USD_RUB);
  return Math.round(rub * 10000) / 10000;
}

module.exports = {
  models,
  DEFAULT_USD_RUB,
  pickConductorModel,
  shouldUseThinking,
  getModel,
  getUsdToRub,
  calculateCostRub
};
