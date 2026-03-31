/**
 * ASGARD CRM - AI Provider Service
 *
 * Абстракция над AI-провайдерами (Anthropic Claude, OpenAI)
 * Поддерживает обычные запросы и стриминг
 * Автоматический fallback при недоступности основного провайдера
 */

'use strict';

const db = require('./db');

// Конфигурация из переменных окружения (начальные значения)
let AI_PROVIDER = process.env.AI_PROVIDER || 'openai';
let ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
let ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6-20250514';
let OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
let OPENAI_MODEL = process.env.OPENAI_MODEL || 'anthropic/claude-sonnet-4.6';
const AI_MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS || '4096', 10);
const AI_TEMPERATURE = parseFloat(process.env.AI_TEMPERATURE || '0.6');
const AI_TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS || '60000', 10); // 60 sec default

// API endpoints (default: routerai.ru — OpenAI-compatible proxy to Claude)
const ANTHROPIC_URL = process.env.ANTHROPIC_URL || 'https://api.anthropic.com/v1/messages';
let OPENAI_URL = process.env.OPENAI_URL || 'https://routerai.ru/api/v1/chat/completions';

// YandexGPT Pro
let YANDEX_GPT_API_KEY = process.env.YANDEX_GPT_API_KEY || '';
let YANDEX_FOLDER_ID = process.env.YANDEX_FOLDER_ID || '';
const YANDEX_GPT_MODEL = process.env.YANDEX_GPT_MODEL || 'yandexgpt/latest';
const YANDEX_GPT_URL = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';

// DB settings cache
let _dbKeysLoaded = false;

/**
 * Загрузить AI ключи из БД settings (key = 'ai_config')
 * Вызывается один раз при первом запросе
 */
async function _loadKeysFromDB() {
  if (_dbKeysLoaded) return;
  _dbKeysLoaded = true;

  try {
    const result = await db.query("SELECT value_json FROM settings WHERE key = 'ai_config'");
    if (result.rows[0]?.value_json) {
      let parsed = JSON.parse(result.rows[0].value_json);
      // IndexedDB sync может хранить вложенно
      const cfg = parsed.value_json ? JSON.parse(parsed.value_json) : parsed;

      if (cfg.anthropic_api_key && !ANTHROPIC_API_KEY) {
        ANTHROPIC_API_KEY = cfg.anthropic_api_key;
        console.log('[AI Provider] Anthropic API key loaded from DB settings');
      }
      if (cfg.openai_api_key && !OPENAI_API_KEY) {
        OPENAI_API_KEY = cfg.openai_api_key;
        console.log('[AI Provider] OpenAI API key loaded from DB settings');
      }
      if (cfg.provider) AI_PROVIDER = cfg.provider;
      if (cfg.anthropic_model) ANTHROPIC_MODEL = cfg.anthropic_model;
      if (cfg.openai_model) OPENAI_MODEL = cfg.openai_model;
      if (cfg.openai_url) {
        OPENAI_URL = cfg.openai_url;
        console.log('[AI Provider] Custom OpenAI URL:', OPENAI_URL);
      }
    }
  } catch (e) {
    // settings table may not have ai_config key yet — that's fine
  }
}

/**
 * Convert multimodal content blocks to OpenAI format.
 * - 'text' blocks → kept as-is
 * - 'image' blocks → converted to OpenAI image_url format
 * - 'document' blocks (PDF) → skipped (OpenAI doesn't support PDF documents)
 */
function _convertContentForOpenAI(contentArray) {
  if (!Array.isArray(contentArray)) return contentArray;

  const result = [];
  for (const block of contentArray) {
    if (block.type === 'text') {
      result.push(block);
    } else if (block.type === 'image' && block.source?.type === 'base64') {
      result.push({
        type: 'image_url',
        image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` }
      });
    } else if (block.type === 'document') {
      // OpenAI doesn't support PDF documents — skip with warning
      console.warn('[AI Provider] Skipping document block — OpenAI does not support PDF document input');
    }
  }

  // If only text blocks remain, simplify to string
  if (result.length === 1 && result[0].type === 'text') {
    return result[0].text;
  }
  return result.length > 0 ? result : '';
}

/**
 * Получить текущую конфигурацию AI
 * Note: DB keys are loaded lazily in complete() — values here may be stale before first AI call
 */
function getConfig() {
  return {
    provider: AI_PROVIDER,
    model: AI_PROVIDER === 'anthropic' ? ANTHROPIC_MODEL : AI_PROVIDER === 'yandexgpt' ? YANDEX_GPT_MODEL : OPENAI_MODEL,
    maxTokens: AI_MAX_TOKENS,
    temperature: AI_TEMPERATURE,
    hasAnthropicKey: !!ANTHROPIC_API_KEY,
    hasOpenAIKey: !!OPENAI_API_KEY,
    hasYandexKey: !!(YANDEX_GPT_API_KEY && YANDEX_FOLDER_ID)
  };
}

/**
 * Получить текущего провайдера
 */
function getProvider() {
  return AI_PROVIDER;
}

/**
 * Вызов Anthropic Claude API
 */
async function callAnthropic({ system, messages, maxTokens, temperature, stream = false }) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const body = {
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens || AI_MAX_TOKENS,
    temperature: temperature ?? AI_TEMPERATURE,
    system: system || '',
    messages: messages.map(m => ({
      role: m.role,
      content: m.content
    })),
    stream: stream
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), stream ? AI_TIMEOUT_MS * 3 : AI_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2024-10-22',
        'anthropic-beta': 'pdfs-2024-09-25'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') throw new Error(`Anthropic API timeout after ${AI_TIMEOUT_MS}ms`);
    throw err;
  }

  if (!response.ok) {
    clearTimeout(timeoutId);
    const errorText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
  }

  if (stream) {
    // Для стриминга: не очищаем timeout здесь — ответственность вызывающего
    clearTimeout(timeoutId);
    return response;
  }

  clearTimeout(timeoutId);

  const data = await response.json();

  // Извлекаем текст из ответа Claude
  let text = '';
  if (data.content && Array.isArray(data.content)) {
    text = data.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');
  }

  return {
    text: text,
    usage: {
      inputTokens: data.usage?.input_tokens || 0,
      outputTokens: data.usage?.output_tokens || 0
    },
    model: data.model,
    stopReason: data.stop_reason
  };
}

/**
 * Вызов OpenAI API
 */
async function callOpenAI({ system, messages, maxTokens, temperature, stream = false, model = null }) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  // OpenAI использует system message внутри массива messages
  const openaiMessages = [];
  if (system) {
    openaiMessages.push({ role: 'system', content: system });
  }
  openaiMessages.push(...messages.map(m => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : _convertContentForOpenAI(m.content)
  })));

  const body = {
    model: model || OPENAI_MODEL,
    max_tokens: maxTokens || AI_MAX_TOKENS,
    temperature: temperature ?? AI_TEMPERATURE,
    messages: openaiMessages,
    stream: stream
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), stream ? AI_TIMEOUT_MS * 3 : AI_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + OPENAI_API_KEY
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') throw new Error(`OpenAI API timeout after ${AI_TIMEOUT_MS}ms`);
    throw err;
  }

  if (!response.ok) {
    clearTimeout(timeoutId);
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  if (stream) {
    clearTimeout(timeoutId);
    return response;
  }

  clearTimeout(timeoutId);

  const data = await response.json();

  return {
    text: data.choices?.[0]?.message?.content || '',
    usage: {
      inputTokens: data.usage?.prompt_tokens || 0,
      outputTokens: data.usage?.completion_tokens || 0
    },
    model: data.model,
    stopReason: data.choices?.[0]?.finish_reason
  };
}

/**
 * Обычный запрос к AI (возвращает полный ответ)
 *
 * @param {Object} options
 * @param {string} options.system - Системный промпт
 * @param {Array} options.messages - Массив сообщений [{role, content}]
 * @param {number} options.maxTokens - Максимум токенов ответа
 * @param {number} options.temperature - Температура (0-1)
 * @returns {Promise<{text: string, usage: {inputTokens: number, outputTokens: number}, model: string}>}
 */
async function complete({ system, messages, maxTokens, temperature }) {
  await _loadKeysFromDB();
  let provider = AI_PROVIDER;
  const startTime = Date.now();

  // Smart provider selection: if messages contain document blocks (scanned PDFs),
  // prefer Anthropic which supports native PDF document input
  const hasDocumentBlocks = messages.some(m =>
    Array.isArray(m.content) && m.content.some(b => b.type === 'document')
  );
  if (hasDocumentBlocks && ANTHROPIC_API_KEY && provider !== 'anthropic') {
    console.log('[AI Provider] Switching to Anthropic for this request — document blocks require Claude PDF support');
    provider = 'anthropic';
  }

  // Demo mode: if no API keys configured, return a mock response
  if (!ANTHROPIC_API_KEY && !OPENAI_API_KEY && !(YANDEX_GPT_API_KEY && YANDEX_FOLDER_ID)) {
    const lastMsg = messages[messages.length - 1]?.content || '';
    return {
      text: `[Demo] Получено сообщение (${lastMsg.length} символов). AI-провайдер не настроен — работает демо-режим.`,
      usage: { inputTokens: lastMsg.length, outputTokens: 30 },
      model: 'demo',
      provider: 'demo',
      stopReason: 'end_turn',
      durationMs: Date.now() - startTime
    };
  }

  try {
    if (provider === 'anthropic') {
      const result = await callAnthropic({ system, messages, maxTokens, temperature });
      result.provider = 'anthropic';
      result.durationMs = Date.now() - startTime;
      return result;
    } else if (provider === 'openai') {
      const result = await callOpenAI({ system, messages, maxTokens, temperature });
      result.provider = 'openai';
      result.durationMs = Date.now() - startTime;
      return result;
    } else if (provider === 'yandexgpt') {
      const result = await completeYandexGPT({ system, messages, maxTokens, temperature });
      result.durationMs = Date.now() - startTime;
      return result;
    } else {
      throw new Error(`Unknown AI provider: ${provider}`);
    }
  } catch (error) {
    // Попробуем fallback на другого провайдера при 5xx ошибках
    const is5xx = error.message && error.message.includes('5');
    const fallbackProvider = provider === 'anthropic' ? 'openai' : 'anthropic';
    const hasFallbackKey = fallbackProvider === 'anthropic' ? ANTHROPIC_API_KEY : OPENAI_API_KEY;

    if (is5xx && hasFallbackKey) {
      console.warn(`[AI Provider] ${provider} failed, trying fallback to ${fallbackProvider}`);

      try {
        let result;
        if (fallbackProvider === 'anthropic') {
          result = await callAnthropic({ system, messages, maxTokens, temperature });
        } else {
          result = await callOpenAI({ system, messages, maxTokens, temperature });
        }
        result.provider = fallbackProvider;
        result.fallback = true;
        result.durationMs = Date.now() - startTime;
        return result;
      } catch (fallbackError) {
        throw new Error(`Both providers failed. Primary: ${error.message}, Fallback: ${fallbackError.message}`);
      }
    }

    throw error;
  }
}

/**
 * Fake SSE stream для провайдеров без поддержки стриминга (YandexGPT).
 * Возвращает объект с body.getReader() в формате OpenAI SSE.
 */
function _fakeStream(result) {
  const text = result.text || '';
  const usage = result.usage || { inputTokens: 0, outputTokens: 0 };
  // Формируем SSE-данные как OpenAI формат
  const chunks = [];
  // Разбиваем текст на куски ~80 символов для имитации стриминга
  const chunkSize = 80;
  for (let i = 0; i < text.length; i += chunkSize) {
    const piece = text.slice(i, i + chunkSize);
    chunks.push(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
  }
  chunks.push(`data: ${JSON.stringify({ choices: [{ finish_reason: 'stop' }], usage: { prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens } })}\n\n`);
  chunks.push('data: [DONE]\n\n');

  const encoded = new TextEncoder().encode(chunks.join(''));
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    }
  });
  return { body: stream };
}

/**
 * Стриминг запрос к AI (возвращает Response со stream)
 *
 * @param {Object} options
 * @param {string} options.system - Системный промпт
 * @param {Array} options.messages - Массив сообщений [{role, content}]
 * @param {number} options.maxTokens - Максимум токенов ответа
 * @param {number} options.temperature - Температура (0-1)
 * @returns {Promise<Response>} - Raw Response с SSE stream
 */
async function stream({ system, messages, maxTokens, temperature, model }) {
  await _loadKeysFromDB();
  const provider = AI_PROVIDER;

  try {
    if (provider === 'anthropic') {
      return await callAnthropic({ system, messages, maxTokens, temperature, stream: true });
    } else if (provider === 'openai') {
      return await callOpenAI({ system, messages, maxTokens, temperature, stream: true, model });
    } else if (provider === 'yandexgpt') {
      const result = await completeYandexGPT({ system, messages, maxTokens, temperature });
      return _fakeStream(result);
    } else {
      throw new Error(`Unknown AI provider: ${provider}`);
    }
  } catch (error) {
    // Fallback для стриминга
    const is5xx = error.message && error.message.includes('5');
    const fallbackProvider = provider === 'anthropic' ? 'openai' : 'anthropic';
    const hasFallbackKey = fallbackProvider === 'anthropic' ? ANTHROPIC_API_KEY : OPENAI_API_KEY;

    if (is5xx && hasFallbackKey) {
      console.warn(`[AI Provider] ${provider} stream failed, trying fallback to ${fallbackProvider}`);

      if (fallbackProvider === 'anthropic') {
        return await callAnthropic({ system, messages, maxTokens, temperature, stream: true });
      } else {
        return await callOpenAI({ system, messages, maxTokens, temperature, stream: true, model });
      }
    }

    throw error;
  }
}

/**
 * Парсер SSE событий от Anthropic Claude
 * Возвращает async generator
 */
async function* parseAnthropicStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;

        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;

        try {
          const event = JSON.parse(jsonStr);

          if (event.type === 'message_start') {
            inputTokens = event.message?.usage?.input_tokens || 0;
            yield { type: 'start', messageId: event.message?.id };
          } else if (event.type === 'content_block_delta') {
            if (event.delta?.type === 'text_delta') {
              yield { type: 'text', content: event.delta.text };
            }
          } else if (event.type === 'message_delta') {
            outputTokens = event.usage?.output_tokens || 0;
            yield {
              type: 'done',
              stopReason: event.delta?.stop_reason,
              usage: { inputTokens, outputTokens }
            };
          } else if (event.type === 'error') {
            yield { type: 'error', message: event.error?.message || 'Unknown error' };
          }
        } catch (e) {
          // Skip malformed JSON
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Парсер SSE событий от OpenAI
 * Возвращает async generator
 */
async function* parseOpenAIStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;

        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === '[DONE]') {
          if (jsonStr === '[DONE]') {
            yield { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
          }
          continue;
        }

        try {
          const event = JSON.parse(jsonStr);
          const delta = event.choices?.[0]?.delta;

          if (delta?.content) {
            yield { type: 'text', content: delta.content };
          }

          if (event.choices?.[0]?.finish_reason) {
            yield {
              type: 'done',
              stopReason: event.choices[0].finish_reason,
              usage: { inputTokens: 0, outputTokens: 0 }
            };
          }
        } catch (e) {
          // Skip malformed JSON
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Универсальный парсер стрима в зависимости от провайдера
 */
function parseStream(response, provider) {
  const p = provider || AI_PROVIDER;
  if (p === 'anthropic') {
    return parseAnthropicStream(response);
  } else {
    // yandexgpt fake stream и openai используют одинаковый OpenAI SSE формат
    return parseOpenAIStream(response);
  }
}

/**
 * YandexGPT Pro — для аналитических задач (отчёты, анализ звонков/email)
 */
async function completeYandexGPT(options) {
  const { system, messages, maxTokens = 4000, temperature = 0.3 } = options;

  const yMessages = [];
  if (system) yMessages.push({ role: 'system', text: system });
  for (const m of messages) {
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    if (!text || !text.trim()) continue; // YandexGPT rejects empty message text
    yMessages.push({ role: m.role, text });
  }

  const body = {
    modelUri: `gpt://${YANDEX_FOLDER_ID}/${YANDEX_GPT_MODEL}`,
    completionOptions: { stream: false, temperature, maxTokens: String(maxTokens) },
    messages: yMessages
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const res = await fetch(YANDEX_GPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Api-Key ${YANDEX_GPT_API_KEY}`,
        'x-folder-id': YANDEX_FOLDER_ID
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`YandexGPT error ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    const result = data.result;
    const text = result.alternatives?.[0]?.message?.text || '';

    return {
      text,
      usage: {
        inputTokens: parseInt(result.usage?.inputTextTokens || 0),
        outputTokens: parseInt(result.usage?.completionTokens || 0)
      },
      model: YANDEX_GPT_MODEL,
      provider: 'yandexgpt'
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Аналитика — YandexGPT Pro (fallback на default provider)
 * Для: отчётов по звонкам, анализа email, подсказок Мимира
 */
async function completeAnalytics(options) {
  await _loadKeysFromDB();
  if (YANDEX_GPT_API_KEY && YANDEX_FOLDER_ID) {
    try {
      return await completeYandexGPT(options);
    } catch (e) {
      console.warn('[AI] YandexGPT failed, falling back:', e.message);
    }
  }
  return complete(options);
}

module.exports = {
  complete,
  completeAnalytics,
  completeYandexGPT,
  stream,
  parseStream,
  parseAnthropicStream,
  parseOpenAIStream,
  getConfig,
  getProvider
};
