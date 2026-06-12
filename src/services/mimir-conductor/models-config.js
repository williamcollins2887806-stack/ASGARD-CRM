/**
 * ASGARD CRM — Mimir Conductor: конфиг моделей и цен
 * ═══════════════════════════════════════════════════════════════════════════
 * МИГРАЦИЯ 13.06.2026: с routerai.ru на tokenator.top (старый ключ routerai → 401).
 *
 * Tokenator (OpenAI-совместимый прокси, base: https://api.tokenator.top/v1/chat/completions)
 * сейчас держит ТРИ активные модели:
 *   - gpt-5.5         — флагман (×2.2, контекст 1.1M, reasoning встроен, vision)
 *   - gpt-5.4         — следующая (×2)
 *   - gemini-2.5-flash — быстрая/дешёвая (×1.5, контекст 1M)
 * Claude (все варианты opus/sonnet/haiku/fable), Voyage, DeepSeek, Perplexity Sonar,
 * embedding-модели — OFFLINE на момент миграции (503 Model temporarily unavailable).
 *
 * Стратегия:
 *   - Conductor «крупный» (opus-4-7) → gpt-5.5 (reasoning enabled)
 *   - Conductor «средний» (sonnet-4-6) → gpt-5.5 (одна модель = проще отладка)
 *   - Быстрые/Python-обёртки (haiku-4-5) → gemini-2.5-flash
 *   - Vision/чертежи (gpt-5) → gpt-5.5 (vision встроен)
 *   - Web-search цен (sonar-opus, web-search-fast) → gemini-2.5-flash + plugins:[{id:'web'}]
 *     (у токенатора web-поиск включён по умолчанию)
 *   - Embeddings (voyage-3) → disabled, searchNorms возвращает [] (graceful)
 *   - Монте-Карло (deepseek-v4) → gpt-5.5
 *   - YandexGPT (нормативы РФ) — БЕЗ ИЗМЕНЕНИЙ (отдельный провайдер/ключ)
 *
 * Когда у токенатора активируют Claude / embeddings — поменять api_id обратно
 * (embeddings-watch-cron уведомит в Telegram при появлении embeddings).
 *
 * `anthropic_api_id` оставлен в кэше — пригодится при возврате на прямой Anthropic.
 * Tokenator поддерживает Anthropic-формат (/anthropic/v1/messages), но провайдер
 * запросов сейчас 'openai' (унифицированный путь через chat/completions).
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
  // ─── Conductor / рабочие лошадки ──────────────────────────────────────
  // ВСЕ через токенатор (OpenAI-compat). reasoning встроен в gpt-5.5/gpt-5.4 — флаг
  // supports_extended_thinking оставлен true для совместимости с кодом Conductor,
  // который проверяет его при формировании запроса (в гилде verbosity:'max').
  'opus-4-7': {
    provider: 'routerai',                        // тут 'routerai' = унифицированный OpenAI-compat путь (ai-provider.callOpenAI)
    api_id: 'gpt-5.5',                            // tokenator: gpt-5.5 (флагман, ×2.2, контекст 1.1M, reasoning встроен)
    anthropic_api_id: 'claude-opus-4-7',          // кэш — вернётся когда Anthropic снова online на токенаторе
    price_usd_per_1m_input: 2.5,                  // tokenator: ~$2.5/M input (приблизительно по нагрузке ×2.2)
    price_usd_per_1m_output: 10.0,                // tokenator: ~$10/M output
    supports_extended_thinking: true,
    supports_tool_use: true,
    max_context: 1100000,
    role: 'Conductor для крупных контрактов (>50M) — gpt-5.5'
  },
  'sonnet-4-6': {
    provider: 'routerai',
    api_id: 'gpt-5.5',                            // tokenator: gpt-5.5 (одна модель = проще отладка)
    anthropic_api_id: 'claude-sonnet-4-6-20250514',
    price_usd_per_1m_input: 2.5,
    price_usd_per_1m_output: 10.0,
    supports_extended_thinking: true,
    supports_tool_use: true,
    max_context: 1100000,
    role: 'Conductor для средних + структурированные агенты — gpt-5.5'
  },
  'haiku-4-5': {
    provider: 'routerai',
    api_id: 'gemini-2.5-flash',                   // tokenator: быстрая/дешёвая (×1.5, контекст 1M)
    anthropic_api_id: 'claude-haiku-4-5-20251001',
    price_usd_per_1m_input: 0.15,
    price_usd_per_1m_output: 0.60,
    supports_extended_thinking: false,
    supports_tool_use: true,
    max_context: 1000000,
    role: 'Быстрые трансформации, классификация — gemini-2.5-flash'
  },

  // ─── Зрение (чертежи и сканы) ──────────────────────────────────────────
  'gpt-5': {
    provider: 'routerai',
    api_id: 'gpt-5.5',                            // gpt-5.5 поддерживает image_url нативно
    price_usd_per_1m_input: 2.5,
    price_usd_per_1m_output: 10.0,
    supports_extended_thinking: false,
    supports_tool_use: true,
    max_context: 1100000,
    role: 'Чтение чертежей и сканов (vision) — gpt-5.5'
  },

  // ─── Веб-поиск цен ─────────────────────────────────────────────────────
  // У токенатора веб-поиск включён по умолчанию для всех чат-моделей.
  // executeWebSearch() в ai-provider.js передаёт plugins:[{id:'web'}] —
  // токенатор это принимает (поле игнорируется если функция уже включена,
  // либо валидирует и активирует если отключено через настройки ключа).
  'sonar-opus': {
    provider: 'routerai',
    api_id: 'gemini-2.5-flash',                   // быстрый веб-поиск через gemini + web plugin
    price_usd_per_1m_input: 0.15,
    price_usd_per_1m_output: 0.60,
    supports_extended_thinking: false,
    supports_tool_use: false,
    max_context: 1000000,
    role: 'Веб-поиск цен — gemini-2.5-flash + web plugin'
  },
  'web-search-fast': {
    provider: 'routerai',
    api_id: 'gemini-2.5-flash',
    price_usd_per_1m_input: 0.15,
    price_usd_per_1m_output: 0.60,
    supports_extended_thinking: false,
    supports_tool_use: true,
    max_context: 1000000,
    role: 'Быстрый web search в agent loop (фактический исполнитель plugin web)'
  },

  // ─── Нормативы РФ (ГЭСН/ФЕР) — БЕЗ ИЗМЕНЕНИЙ ──────────────────────────
  'yandex-pro': {
    provider: 'yandex',                           // отдельный путь (YANDEX_GPT_API_KEY + FOLDER_ID)
    api_id: 'yandexgpt/latest',
    price_usd_per_1m_input: 0.0,
    price_usd_per_1m_output: 0.0,
    supports_extended_thinking: false,
    supports_tool_use: false,
    max_context: 32000,
    role: 'Нормативы РФ (ГЭСН/ФЕР) — YandexGPT, отдельная инфра'
  },

  // ─── Embeddings для RAG — ВРЕМЕННО DISABLED ────────────────────────────
  // У токенатора (13.06.2026): text-embedding-3-large и voyage-3-large = 503.
  // searchNorms() в rag/norms-index.js graceful-возвращает [] при пустой
  // mimir_norms_index (она пуста на проде). aiProvider.embed() возвращает
  // [null,...] при disabled — код Conductor должен это переваривать.
  // embeddings-watch-cron уведомит в Telegram когда модель снова станет online.
  'voyage-3': {
    provider: 'routerai',
    api_id: null,                                 // ОТКЛЮЧЕНО (см. выше)
    disabled: true,
    fallback_api_id: 'text-embedding-3-large',    // что попробовать, когда снимем disabled
    price_usd_per_1m_input: 0.13,
    price_usd_per_1m_output: 0.0,
    is_embedding: true,
    dimensions: 1024,
    max_context: 32000,
    role: 'Embeddings для RAG (DISABLED — токенатор offline 13.06.2026)'
  },

  // ─── Монте-Карло / перебор сценариев ───────────────────────────────────
  'deepseek-v4': {
    provider: 'routerai',
    api_id: 'gpt-5.5',                            // deepseek offline у токенатора → gpt-5.5
    price_usd_per_1m_input: 2.5,
    price_usd_per_1m_output: 10.0,
    supports_extended_thinking: false,
    supports_tool_use: true,
    max_context: 1100000,
    role: 'Монте-Карло + перебор сценариев — gpt-5.5'
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
