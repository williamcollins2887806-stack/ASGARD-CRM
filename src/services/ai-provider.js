/**
 * ASGARD CRM - AI Provider Service
 *
 * Абстракция над AI-провайдерами (Anthropic Claude, OpenAI)
 * Поддерживает обычные запросы и стриминг
 * Автоматический fallback при недоступности основного провайдера
 */

'use strict';

const db = require('./db');

/**
 * Структурированная ошибка AI-провайдера.
 * Позволяет вызывающему коду понять что именно произошло
 * и показать пользователю человеческое сообщение.
 *
 * code: 'insufficient_funds' | 'rate_limit' | 'auth' | 'bad_request'
 *     | 'provider_error' | 'upstream_error' | 'timeout' | 'network'
 *     | 'empty_response' | 'unknown'
 */
class AIProviderError extends Error {
  constructor({ code, status, providerMessage, body, cause, requestSummary }) {
    const msg = providerMessage || `AI provider error (${code}${status ? ' ' + status : ''})`;
    super(msg);
    this.name = 'AIProviderError';
    this.code = code;
    this.status = status || null;
    this.providerMessage = providerMessage || null;
    this.body = body || null;
    this.cause = cause || null;
    this.requestSummary = requestSummary || null;
  }

  /** Человекочитаемое сообщение для UI (рус.) */
  userMessage() {
    switch (this.code) {
      case 'insufficient_funds':
        return 'Недостаточно средств на балансе AI-провайдера. Обратитесь к администратору для пополнения.';
      case 'rate_limit':
        return 'AI-провайдер временно ограничил запросы (rate limit). Подождите 30–60 секунд и попробуйте снова.';
      case 'auth':
        return 'Ошибка авторизации в AI-провайдере. Проверьте API-ключ в настройках.';
      case 'bad_request':
        return `AI-провайдер отклонил запрос${this.providerMessage ? ': ' + this.providerMessage : ' (некорректный формат)'}.`;
      case 'provider_error':
      case 'upstream_error':
        return 'Сбой на стороне AI-провайдера. Попробуйте через минуту.';
      case 'timeout':
        return 'AI не ответил за отведённое время. Попробуйте ещё раз, при повторе — уменьшите объём документов.';
      case 'network':
        return 'Не удалось связаться с AI-провайдером (сетевая ошибка). Проверьте интернет/прокси.';
      case 'empty_response':
        return 'AI вернул пустой ответ. Возможные причины: сработал контентный фильтр, упёрлись в лимит токенов или провайдер вернул мусор. См. логи сервера.';
      default:
        return this.providerMessage || 'Неизвестная ошибка AI-провайдера. См. логи сервера.';
    }
  }
}

/**
 * Классифицировать HTTP-ответ routerai/OpenAI-compatible в код ошибки.
 * Анализирует и статус, и тело (там часто текстом написано "Недостаточно средств").
 */
function _classifyHttpError(status, bodyText) {
  const t = (bodyText || '').toLowerCase();
  if (status === 402 || /недостаточно средств|insufficient.*(funds|balance|credit)|пополните счет|пополните счёт/i.test(bodyText || '')) {
    return 'insufficient_funds';
  }
  if (status === 401 || status === 403) return 'auth';
  if (status === 429 || /rate.?limit|too many requests/i.test(t)) return 'rate_limit';
  if (status === 400 || status === 422) return 'bad_request';
  if (status >= 500 && status < 600) return 'upstream_error';
  return 'provider_error';
}

/**
 * Попытаться вытащить читаемое сообщение из тела ошибки routerai/OpenAI.
 * Форматы: {"error":"..."} / {"error":{"message":"..."}} / plain text
 */
function _extractProviderMessage(bodyText) {
  if (!bodyText) return null;
  try {
    const j = JSON.parse(bodyText);
    if (typeof j.error === 'string') return j.error;
    if (j.error?.message) return j.error.message;
    if (j.message) return j.message;
  } catch (_) { /* not json */ }
  // обрезаем для UI
  return bodyText.length > 300 ? bodyText.substring(0, 300) + '…' : bodyText;
}

// Конфигурация из переменных окружения (начальные значения)
let AI_PROVIDER = process.env.AI_PROVIDER || 'openai';
let ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
let ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6-20250514';
let OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
let OPENAI_MODEL = process.env.OPENAI_MODEL || 'anthropic/claude-sonnet-4.6';
const AI_MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS || '4096', 10);
const AI_TEMPERATURE = parseFloat(process.env.AI_TEMPERATURE || '0.6');
const AI_TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS || '300000', 10); // 300 sec for Claude Opus 4.6 (thinking takes longer)

// API endpoints (default: routerai.ru — OpenAI-compatible proxy to Claude)
const ANTHROPIC_URL = process.env.ANTHROPIC_URL || 'https://api.anthropic.com/v1/messages';
let OPENAI_URL = process.env.OPENAI_URL || 'https://routerai.ru/api/v1/chat/completions';

// YandexGPT Pro
let YANDEX_GPT_API_KEY = process.env.YANDEX_GPT_API_KEY || '';
let YANDEX_FOLDER_ID = process.env.YANDEX_FOLDER_ID || '';
const YANDEX_GPT_MODEL = process.env.YANDEX_GPT_MODEL || 'qwen3-235b-a22b-fp8/latest';
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
    hasYandexKey: !!(YANDEX_GPT_API_KEY && YANDEX_FOLDER_ID),
    // AP5: для agent tool-calling (прямой доступ к URL и ключу)
    openaiUrl: OPENAI_URL,
    openaiKey: OPENAI_API_KEY
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
async function callOpenAI({ system, messages, maxTokens, temperature, stream = false, model = null, tools = null, plugins = null, verbosity = null, responseFormat = null }) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  // OpenAI использует system message внутри массива messages
  const openaiMessages = [];
  if (system) {
    openaiMessages.push({ role: 'system', content: system });
  }
  openaiMessages.push(...messages.map(m => {
    // AP5: assistant messages с tool_calls и tool results проходят as-is
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content || '' };
    if (m.role === 'assistant' && m.tool_calls) return { role: 'assistant', content: m.content || null, tool_calls: m.tool_calls };
    return {
      role: m.role,
      content: typeof m.content === 'string' ? m.content : _convertContentForOpenAI(m.content)
    };
  }));

  const body = {
    model: model || OPENAI_MODEL,
    max_tokens: maxTokens || AI_MAX_TOKENS,
    temperature: temperature ?? AI_TEMPERATURE,
    messages: openaiMessages,
    stream: stream
  };
  // AP5: tool-calling support
  if (tools && tools.length > 0) body.tools = tools;
  // AP6: routerai plugins (web search, file-parser)
  if (plugins && plugins.length > 0) body.plugins = plugins;
  // AP6: verbosity (для Anthropic моделей через routerai = output_config.effort, "max" = extended thinking)
  if (verbosity) body.verbosity = verbosity;
  // AP6: structured outputs / json_schema
  if (responseFormat) body.response_format = responseFormat;

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
    const reqSummary = {
      model: body.model, has_plugins: !!body.plugins, plugins_ids: body.plugins?.map(p=>p.id),
      verbosity: body.verbosity, has_tools: !!body.tools, max_tokens: body.max_tokens,
      messages_count: body.messages?.length
    };
    if (err.name === 'AbortError') {
      console.error('[AI Provider] TIMEOUT after', AI_TIMEOUT_MS, 'ms. Request:', JSON.stringify(reqSummary));
      throw new AIProviderError({
        code: 'timeout', status: null,
        providerMessage: `OpenAI API timeout after ${AI_TIMEOUT_MS}ms`,
        requestSummary: reqSummary, cause: err
      });
    }
    console.error('[AI Provider] NETWORK error:', err.message, '| Request:', JSON.stringify(reqSummary));
    throw new AIProviderError({
      code: 'network', status: null,
      providerMessage: err.message || 'network error',
      requestSummary: reqSummary, cause: err
    });
  }

  if (!response.ok) {
    clearTimeout(timeoutId);
    const errorText = await response.text();
    const reqSummary = {
      model: body.model, has_plugins: !!body.plugins, plugins_ids: body.plugins?.map(p=>p.id),
      verbosity: body.verbosity, has_tools: !!body.tools, max_tokens: body.max_tokens,
      messages_count: body.messages?.length,
      first_msg_content_type: typeof body.messages?.[0]?.content,
      first_msg_blocks: Array.isArray(body.messages?.[0]?.content) ? body.messages[0].content.map(b=>b.type) : null
    };
    const code = _classifyHttpError(response.status, errorText);
    const providerMessage = _extractProviderMessage(errorText);
    // Структурированный лог
    console.error(`[AI Provider] HTTP ${response.status} (${code}) from routerai`);
    console.error('  provider_message:', providerMessage);
    console.error('  request_summary:', JSON.stringify(reqSummary));
    console.error('  raw_body (first 2000 chars):', errorText.substring(0, 2000));
    throw new AIProviderError({
      code, status: response.status,
      providerMessage, body: errorText.substring(0, 2000),
      requestSummary: reqSummary
    });
  }

  if (stream) {
    clearTimeout(timeoutId);
    return response;
  }

  clearTimeout(timeoutId);

  const data = await response.json();

  // AP6: детальное логирование если ответ подозрительный (пустой content)
  const choice = data.choices?.[0] || {};
  const content = choice.message?.content;
  const hasToolCalls = Array.isArray(choice.message?.tool_calls) && choice.message.tool_calls.length > 0;
  const isEmpty = (!content || (typeof content === 'string' && content.trim().length === 0)) && !hasToolCalls;
  if (isEmpty) {
    console.error('[AI Provider] EMPTY response from routerai (no content & no tool_calls)');
    console.error('  finish_reason:', choice.finish_reason);
    console.error('  model:', data.model);
    console.error('  usage:', JSON.stringify(data.usage));
    console.error('  message keys:', Object.keys(choice.message || {}));
    console.error('  raw choice (first 1500 chars):', JSON.stringify(choice).substring(0, 1500));
    if (data.error) console.error('  data.error:', JSON.stringify(data.error));
    // Не бросаем здесь — оставляем решение caller'у (некоторые сценарии умеют переотправить).
    // Но для удобства caller-а возвращаем флаг _empty.
  }

  // Agent-loop: если Claude вернул tool_calls с пустым content — это значит он просит
  // нас выполнить инструмент. Логируем что именно он хочет вызвать, чтобы понять
  // нужен ли agent loop или достаточно отключить нативные tools (плагины routerai
  // должны выполняться на стороне routerai, не должны приходить как tool_calls).
  if (hasToolCalls && (!content || (typeof content === 'string' && content.trim().length === 0))) {
    console.warn('[AI Provider] Claude вернул tool_calls без content (finish_reason=' + choice.finish_reason + ')');
    console.warn('  tool_calls count:', choice.message.tool_calls.length);
    choice.message.tool_calls.slice(0, 5).forEach((tc, i) => {
      console.warn(`  tool_call[${i}]:`, JSON.stringify({
        id: tc.id,
        type: tc.type,
        function_name: tc.function?.name,
        function_args_sample: typeof tc.function?.arguments === 'string'
          ? tc.function.arguments.substring(0, 300)
          : JSON.stringify(tc.function?.arguments || {}).substring(0, 300)
      }));
    });
    console.warn('  usage:', JSON.stringify(data.usage));
    console.warn('  model:', data.model);
  }

  return {
    text: content || '',
    tool_calls: choice.message?.tool_calls || null, // AP5: tool-calling
    annotations: choice.message?.annotations || null, // AP6: url_citation от web search
    usage: {
      inputTokens: data.usage?.prompt_tokens || 0,
      outputTokens: data.usage?.completion_tokens || 0
    },
    model: data.model,
    stopReason: choice.finish_reason,
    _rawMessage: choice.message // AP5: full message for agent loop
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
async function complete({ system, messages, maxTokens, temperature, tools, plugins, verbosity, responseFormat }) {
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
      const result = await callOpenAI({ system, messages, maxTokens, temperature, tools, plugins, verbosity, responseFormat });
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
          result = await callOpenAI({ system, messages, maxTokens, temperature, tools, plugins, verbosity, responseFormat });
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
 * Yandex Cloud AI — YandexGPT и сторонние модели (Qwen3, Llama и др.)
 * YandexGPT модели → Foundation Models API (gRPC)
 * Сторонние модели → OpenAI-совместимый API
 */
async function completeYandexGPT(options) {
  const { system, messages, maxTokens = 4000, temperature = 0.3 } = options;
  const isNativeYandex = YANDEX_GPT_MODEL.startsWith('yandexgpt');

  if (!isNativeYandex) {
    // OpenAI-совместимый API для Qwen3, Llama и др.
    return _completeYandexOpenAI(options);
  }

  // Foundation Models API для yandexgpt/yandexgpt-32k
  const yMessages = [];
  if (system) yMessages.push({ role: 'system', text: system });
  for (const m of messages) {
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    if (!text || !text.trim()) continue;
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
 * Очистка <think>...</think> блока из ответов Thinking-моделей (Qwen3-*-thinking).
 * Модель возвращает: "<think>\nрассуждения...\n</think>\n\nОтвет"
 * Оставляем только финальный ответ.
 */
function _stripThinkingBlock(text) {
  if (!text) return text;
  // Удаляем <think>...</think> блок (greedy, может быть многострочным)
  const stripped = text.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
  return stripped || text; // Если после очистки пусто — вернуть оригинал
}

/**
 * Yandex Cloud OpenAI-совместимый API для сторонних моделей
 */
const YANDEX_OPENAI_URL = 'https://llm.api.cloud.yandex.net/v1/chat/completions';

async function _completeYandexOpenAI(options) {
  const { system, messages, maxTokens = 4000, temperature = 0.3 } = options;

  const oaiMessages = [];
  if (system) oaiMessages.push({ role: 'system', content: system });
  for (const m of messages) {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    if (!content || !content.trim()) continue;
    oaiMessages.push({ role: m.role, content });
  }

  const body = {
    model: `gpt://${YANDEX_FOLDER_ID}/${YANDEX_GPT_MODEL}`,
    max_tokens: maxTokens,
    temperature,
    messages: oaiMessages
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const res = await fetch(YANDEX_OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Api-Key ${YANDEX_GPT_API_KEY}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Yandex OpenAI API error ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    let text = data.choices?.[0]?.message?.content || '';

    // Thinking-модели (Qwen3-*-thinking) добавляют <think>...</think> блок
    // Очищаем его, оставляя только финальный ответ
    text = _stripThinkingBlock(text);

    return {
      text,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0
      },
      model: YANDEX_GPT_MODEL,
      provider: 'yandexgpt'
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Выполнить web search через routerai plugin 'web' (отдельный мини-запрос).
 * Возвращает структурированный JSON массив с результатами.
 *
 * Используется в agent loop: когда основная модель просит WebSearch tool_call,
 * мы делаем отдельный лёгкий запрос с plugin web, получаем результаты и
 * возвращаем их обратно как tool result.
 *
 * @param {string} query — поисковый запрос
 * @param {Object} opts — { includeDomains?: string[], maxResults?: number }
 * @returns {Promise<string>} — текстовый результат для возврата Claude (краткая сводка + URL)
 */
// AP6: модель для выполнения web search в agent loop.
// КРИТИЧНО: НЕ использовать anthropic/claude-* — они делегируют поиск обратно
// через tool_call WebSearch, получаем бесконечный цикл с пустыми результатами.
// Подтверждено тестом 25.05.2026: gemini-2.5-flash (1.8с, 601 chars), gpt-4.1-mini,
// qwen3-235b реально выполняют plugin 'web' и возвращают текст.
// Выбран gemini-2.5-flash — самая быстрая и дешёвая.
const WEB_SEARCH_MODEL = process.env.WEB_SEARCH_MODEL || 'google/gemini-2.5-flash';

async function executeWebSearch(query, opts = {}) {
  await _loadKeysFromDB();
  if (!OPENAI_API_KEY) {
    return `[web search недоступен: ключ не настроен] Запрос: ${query}`;
  }

  const includeDomains = opts.includeDomains || [];
  const maxResults = opts.maxResults || 5;

  // Используем lite-промпт: просим вернуть только факты + ссылки, без рассуждений
  const systemPrompt = 'Ты — поисковый ассистент. Выполни web search по запросу пользователя и верни ТОЛЬКО краткую сводку фактов с пометкой источников (URL). Без рассуждений, без воды. Если ничего не нашёл — так и напиши.';

  const t0 = Date.now();
  try {
    const result = await callOpenAI({
      system: systemPrompt,
      messages: [{ role: 'user', content: query }],
      model: WEB_SEARCH_MODEL,         // ВАЖНО: gemini, НЕ Claude — Claude делегирует поиск назад
      maxTokens: 1500,
      temperature: 0.1,
      plugins: [{
        id: 'web',
        engine: 'native',
        max_results: maxResults,
        ...(includeDomains.length ? { include_domains: includeDomains } : {})
      }]
    });
    const ms = Date.now() - t0;
    console.log(`[WebSearch] "${query.substring(0, 80)}" → ${result.text?.length || 0} chars, ${ms}ms (model=${WEB_SEARCH_MODEL})`);
    if (result.annotations && result.annotations.length > 0) {
      console.log(`[WebSearch] annotations: ${result.annotations.length} URL citations`);
    }
    return result.text || `[пустой ответ от поиска по "${query}"]`;
  } catch (e) {
    const ms = Date.now() - t0;
    console.warn(`[WebSearch] FAILED "${query.substring(0, 80)}" after ${ms}ms:`, e.message);
    return `[Ошибка поиска: ${e.message}]`;
  }
}

/**
 * Выполнить один tool_call от Claude и вернуть результат для следующей итерации.
 * Сейчас поддерживается только WebSearch — остальные инструменты возвращают
 * сообщение что они не реализованы (Claude обычно после этого даёт ответ без них).
 */
async function _executeToolCall(toolCall, opts = {}) {
  const fnName = toolCall.function?.name || toolCall.name;
  let args = {};
  try {
    args = typeof toolCall.function?.arguments === 'string'
      ? JSON.parse(toolCall.function.arguments)
      : (toolCall.function?.arguments || {});
  } catch (e) {
    return `[Не удалось распарсить аргументы tool_call: ${e.message}]`;
  }

  // WebSearch (Claude native naming) или web_search или web
  if (/^(WebSearch|web_search|web)$/i.test(fnName)) {
    const query = args.query || args.q || args.search_query || JSON.stringify(args);
    return await executeWebSearch(query, {
      includeDomains: opts.includeDomains,
      maxResults: opts.maxResults
    });
  }

  // Неизвестный инструмент
  console.warn(`[AgentLoop] Неподдерживаемый tool_call: ${fnName}, args:`, JSON.stringify(args).substring(0, 200));
  return `[Инструмент "${fnName}" не реализован на сервере. Отвечай тем что есть в исходных данных.]`;
}

/**
 * Agent loop: вызывает complete() в цикле, пока модель не перестанет
 * запрашивать tool_calls (finish_reason !== 'tool_calls').
 *
 * На каждой итерации с tool_calls:
 *   1. Параллельно выполняет все tool_calls (Promise.all)
 *   2. Дописывает в messages: assistant (с tool_calls) + N сообщений role='tool'
 *   3. Повторяет complete()
 *
 * Ограничения: maxIterations (по умолчанию 5), общий бюджет токенов.
 *
 * @param {Object} options — те же что у complete(), плюс:
 *   onProgress?: ({type, iteration, tool_calls?, query?, result_chars?}) => void
 *   maxIterations?: number — по умолчанию 5
 *   webSearchIncludeDomains?: string[] — домены для web search
 * @returns {Promise<Object>} — финальный ответ от complete() (с уже не пустым text)
 */
async function runAgentLoop(options) {
  const {
    onProgress = () => {},
    maxIterations = 5,
    webSearchIncludeDomains = [],
    ...completeOpts
  } = options;

  const messages = [...(completeOpts.messages || [])];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let lastResult = null;

  for (let iter = 0; iter < maxIterations; iter++) {
    onProgress({ type: 'iteration_start', iteration: iter });

    const result = await complete({ ...completeOpts, messages });
    lastResult = result;
    totalInputTokens += result.usage?.inputTokens || 0;
    totalOutputTokens += result.usage?.outputTokens || 0;

    const toolCalls = result.tool_calls || result._rawMessage?.tool_calls;
    const hasTools = Array.isArray(toolCalls) && toolCalls.length > 0;
    const isToolCallsStop = result.stopReason === 'tool_calls' || result.stopReason === 'tool_use';

    // Финальный ответ — нет tool_calls или модель сама остановилась
    if (!hasTools || !isToolCallsStop) {
      console.log(`[AgentLoop] Завершено на итерации ${iter}: stopReason=${result.stopReason}, hasTools=${hasTools}`);
      return {
        ...result,
        usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        agentIterations: iter + 1
      };
    }

    console.log(`[AgentLoop] Итерация ${iter}: модель просит ${toolCalls.length} tool_calls`);
    onProgress({
      type: 'tool_calls',
      iteration: iter,
      tool_calls: toolCalls.map(tc => ({
        name: tc.function?.name,
        query: (() => {
          try {
            return JSON.parse(tc.function?.arguments || '{}').query
              || JSON.parse(tc.function?.arguments || '{}').q
              || null;
          } catch { return null; }
        })()
      }))
    });

    // Добавляем assistant сообщение с tool_calls (как Claude его прислал)
    messages.push({
      role: 'assistant',
      content: result.text || null,
      tool_calls: toolCalls
    });

    // Выполняем все tool_calls параллельно
    const toolResults = await Promise.all(
      toolCalls.map(async (tc) => {
        const content = await _executeToolCall(tc, {
          includeDomains: webSearchIncludeDomains,
          maxResults: 5
        });
        return {
          role: 'tool',
          tool_call_id: tc.id,
          content: typeof content === 'string' ? content : JSON.stringify(content)
        };
      })
    );

    onProgress({
      type: 'tool_results',
      iteration: iter,
      results: toolResults.map(r => ({
        tool_call_id: r.tool_call_id,
        result_chars: r.content.length
      }))
    });

    // Дописываем результаты в messages
    messages.push(...toolResults);
  }

  // Превысили лимит итераций — Claude хотел ещё искать, но мы говорим "хватит".
  // Делаем ФИНАЛЬНЫЙ запрос с явной инструкцией "не вызывай инструменты, дай ответ".
  // Это критично: иначе вернётся пустой content и UI покажет ошибку.
  console.warn(`[AgentLoop] Превышен лимит ${maxIterations} итераций — делаю финальный запрос без tool_calls`);
  onProgress({ type: 'finalization', iteration: maxIterations });

  // Дописываем пользовательское сообщение "достаточно, дай ответ"
  // Перед этим нужно учесть: предыдущий ответ модели был tool_calls,
  // на него ОБЯЗАТЕЛЬНО должен быть tool result. Если он уже добавлен в цикле —
  // мы тут стоим после tool результатов, готовы к финальному user-сообщению.
  messages.push({
    role: 'user',
    content: 'Достаточно поисков. Используя ВСЕ результаты которые ты уже получил выше, составь полный итоговый просчёт. Верни ТОЛЬКО валидный JSON по требуемой схеме, без новых поисков и без вызова инструментов.'
  });

  let finalResult;
  try {
    finalResult = await complete({
      ...completeOpts,
      messages,
      plugins: undefined,   // отключаем plugins → нет искушения снова искать
      tools: undefined
    });
    totalInputTokens += finalResult.usage?.inputTokens || 0;
    totalOutputTokens += finalResult.usage?.outputTokens || 0;
    console.log(`[AgentLoop] Финальный ответ: ${finalResult.text?.length || 0} chars, stopReason=${finalResult.stopReason}`);
  } catch (e) {
    console.error('[AgentLoop] Финальный запрос упал:', e.message);
    return {
      ...lastResult,
      text: lastResult?.text || '',
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
      agentIterations: maxIterations,
      agentExceeded: true,
      finalizationError: e.message
    };
  }

  return {
    ...finalResult,
    usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    agentIterations: maxIterations + 1,
    agentExceeded: true
  };
}

/**
 * Быстрый вызов через нативный YandexGPT Pro (yandexgpt-32k/latest).
 * Для задач где критична скорость отклика (голосовой секретарь).
 * Всегда использует Foundation Models API напрямую, минуя Qwen3.
 */
async function completeFast(options) {
  await _loadKeysFromDB();
  if (!YANDEX_GPT_API_KEY || !YANDEX_FOLDER_ID) {
    return complete(options); // fallback на основной provider
  }

  const { system, messages, maxTokens = 400, temperature = 0.3 } = options;
  const fastModel = 'yandexgpt-32k/latest';

  const yMessages = [];
  if (system) yMessages.push({ role: 'system', text: system });
  for (const m of messages) {
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    if (!text || !text.trim()) continue;
    yMessages.push({ role: m.role, text });
  }

  const body = {
    modelUri: `gpt://${YANDEX_FOLDER_ID}/${fastModel}`,
    completionOptions: { stream: false, temperature, maxTokens: String(maxTokens) },
    messages: yMessages
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30с для скорости

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
      throw new Error(`YandexGPT fast error ${res.status}: ${errText.slice(0, 300)}`);
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
      model: fastModel,
      provider: 'yandexgpt'
    };
  } catch (e) {
    console.warn('[AI] YandexGPT fast failed, falling back to main:', e.message);
    return complete(options);
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
  completeFast,
  completeAnalytics,
  completeYandexGPT,
  stream,
  parseStream,
  parseAnthropicStream,
  parseOpenAIStream,
  getConfig,
  getProvider,
  _loadKeysFromDB, // AP5: agent needs to ensure keys are loaded
  AIProviderError, // экспорт класса для классификации ошибок в caller-ах
  runAgentLoop, // agent-loop с автоматическим выполнением tool_calls (WebSearch)
  executeWebSearch // прямой вызов web search (можно использовать без agent loop)
};
