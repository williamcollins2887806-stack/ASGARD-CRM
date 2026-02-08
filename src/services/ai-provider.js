/**
 * ASGARD CRM - AI Provider Service
 *
 * Абстракция над AI-провайдерами (Anthropic Claude, OpenAI)
 * Поддерживает обычные запросы и стриминг
 * Автоматический fallback при недоступности основного провайдера
 */

'use strict';

// Конфигурация из переменных окружения
const AI_PROVIDER = process.env.AI_PROVIDER || 'anthropic';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const AI_MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS || '4096', 10);
const AI_TEMPERATURE = parseFloat(process.env.AI_TEMPERATURE || '0.6');

// API endpoints
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * Получить текущую конфигурацию AI
 */
function getConfig() {
  return {
    provider: AI_PROVIDER,
    model: AI_PROVIDER === 'anthropic' ? ANTHROPIC_MODEL : OPENAI_MODEL,
    maxTokens: AI_MAX_TOKENS,
    temperature: AI_TEMPERATURE,
    hasAnthropicKey: !!ANTHROPIC_API_KEY,
    hasOpenAIKey: !!OPENAI_API_KEY
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

  const response = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
  }

  if (stream) {
    return response;
  }

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
async function callOpenAI({ system, messages, maxTokens, temperature, stream = false }) {
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
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
  })));

  const body = {
    model: OPENAI_MODEL,
    max_tokens: maxTokens || AI_MAX_TOKENS,
    temperature: temperature ?? AI_TEMPERATURE,
    messages: openaiMessages,
    stream: stream
  };

  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + OPENAI_API_KEY
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  if (stream) {
    return response;
  }

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
  const provider = AI_PROVIDER;
  const startTime = Date.now();

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
 * Стриминг запрос к AI (возвращает Response со stream)
 *
 * @param {Object} options
 * @param {string} options.system - Системный промпт
 * @param {Array} options.messages - Массив сообщений [{role, content}]
 * @param {number} options.maxTokens - Максимум токенов ответа
 * @param {number} options.temperature - Температура (0-1)
 * @returns {Promise<Response>} - Raw Response с SSE stream
 */
async function stream({ system, messages, maxTokens, temperature }) {
  const provider = AI_PROVIDER;

  try {
    if (provider === 'anthropic') {
      return await callAnthropic({ system, messages, maxTokens, temperature, stream: true });
    } else if (provider === 'openai') {
      return await callOpenAI({ system, messages, maxTokens, temperature, stream: true });
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
        return await callOpenAI({ system, messages, maxTokens, temperature, stream: true });
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
  if (provider === 'anthropic' || AI_PROVIDER === 'anthropic') {
    return parseAnthropicStream(response);
  } else {
    return parseOpenAIStream(response);
  }
}

module.exports = {
  complete,
  stream,
  parseStream,
  parseAnthropicStream,
  parseOpenAIStream,
  getConfig,
  getProvider
};
