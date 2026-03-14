/**
 * Mock implementations for ASGARD CRM telephony module testing.
 *
 * Provides factory functions that return instrumented mock objects
 * compatible with the custom test framework (tests/config.js).
 *
 * Every mock tracks its own invocations so assertions can be written
 * against call counts, argument lists, and invocation order.
 */

'use strict';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wraps a plain function so that every call is recorded in `tracker[name]`.
 *
 * @param {string}   name     Method name used as the key in the tracker map.
 * @param {Function} fn       The underlying implementation to execute.
 * @param {Object}   tracker  A reference to the `mock.calls` object.
 * @returns {Function}
 */
function tracked(name, fn, tracker) {
  if (!tracker[name]) {
    tracker[name] = [];
  }
  return function trackedMethod(...args) {
    tracker[name].push(args);
    return fn.apply(this, args);
  };
}

// ---------------------------------------------------------------------------
// 1. createMockMangoService
// ---------------------------------------------------------------------------

/**
 * Creates a mock for MangoService (Mango Office telephony integration).
 *
 * All methods resolve with sensible defaults. Every invocation is recorded
 * in `mock.calls` keyed by method name.
 *
 * @returns {Object} mock MangoService instance
 */
function createMockMangoService() {
  const calls = {};

  const mock = {
    calls,

    sign: tracked('sign', function sign(_json) {
      return 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
    }, calls),

    verifyWebhook: tracked('verifyWebhook', function verifyWebhook(_body, _signature) {
      return true;
    }, calls),

    callback: tracked('callback', async function callback(_from, _to, _options) {
      return { result: { code: 0 } };
    }, calls),

    route: tracked('route', async function route(_callId, _to) {
      return { result: { code: 0 } };
    }, calls),

    transfer: tracked('transfer', async function transfer(_callId, _to) {
      return { result: { code: 0 } };
    }, calls),

    hangup: tracked('hangup', async function hangup(_callId) {
      return { result: { code: 0 } };
    }, calls),

    getRecordingLink: tracked('getRecordingLink', async function getRecordingLink(_recordingId) {
      return 'https://mango-records.example.com/recordings/test-recording-001.mp3';
    }, calls),

    downloadRecording: tracked('downloadRecording', async function downloadRecording(_recordingId) {
      return {
        buffer: Buffer.from('fake-audio'),
        contentType: 'audio/mpeg',
      };
    }, calls),

    getUsers: tracked('getUsers', async function getUsers() {
      return [
        { id: '1001', name: 'Иванов Иван', ext: '101', email: 'ivanov@example.com' },
        { id: '1002', name: 'Петров Петр', ext: '102', email: 'petrov@example.com' },
        { id: '1003', name: 'Сидорова Анна', ext: '103', email: 'sidorova@example.com' },
      ];
    }, calls),

    requestStats: tracked('requestStats', async function requestStats(_dateFrom, _dateTo, _options) {
      return {
        key: 'stats-request-key-001',
      };
    }, calls),

    getStatsResult: tracked('getStatsResult', async function getStatsResult(_key) {
      return {
        stats: [
          {
            date: '2026-03-01',
            incoming: 24,
            outgoing: 18,
            missed: 3,
            avgDuration: 147,
          },
        ],
      };
    }, calls),

    isConfigured: tracked('isConfigured', function isConfigured() {
      return true;
    }, calls),
  };

  return mock;
}

// ---------------------------------------------------------------------------
// 2. createMockSpeechKitService
// ---------------------------------------------------------------------------

/**
 * Creates a mock for SpeechKitService (Yandex SpeechKit / speech-to-text /
 * text-to-speech integration).
 *
 * @returns {Object} mock SpeechKitService instance
 */
function createMockSpeechKitService() {
  const calls = {};

  const mock = {
    calls,

    transcribeFile: tracked('transcribeFile', async function transcribeFile(_filePath, _options) {
      return {
        text: 'Тестовая транскрипция разговора оператора с клиентом по вопросу обслуживания.',
        segments: [
          {
            speaker: 0,
            start: 0,
            end: 5,
            text: 'Здравствуйте, чем могу помочь?',
          },
        ],
      };
    }, calls),

    recognizeShort: tracked('recognizeShort', async function recognizeShort(_buffer, _options) {
      return 'Тестовое распознавание';
    }, calls),

    synthesize: tracked('synthesize', async function synthesize(_text, _options) {
      return Buffer.from('fake-tts-audio');
    }, calls),

    synthesizeCached: tracked('synthesizeCached', async function synthesizeCached(_text, _options) {
      return '/tmp/tts_cache/test.opus';
    }, calls),

    isConfigured: tracked('isConfigured', function isConfigured() {
      return true;
    }, calls),
  };

  return mock;
}

// ---------------------------------------------------------------------------
// 3. createMockAiProvider
// ---------------------------------------------------------------------------

/**
 * Creates a mock for the AI provider used by the call-analyzer subsystem.
 *
 * The default response is a JSON string containing a basic analysis result.
 * Use `mock.setResponse(text)` to override the value returned by `complete()`.
 *
 * @returns {Object} mock AI provider instance
 */
function createMockAiProvider() {
  const calls = {};

  const defaultResponse = JSON.stringify({
    summary: 'Клиент обратился с вопросом по тарифу. Оператор предоставил информацию.',
    sentiment: 'neutral',
    topics: ['тариф', 'информация'],
    quality: {
      score: 8,
      greeting: true,
      closing: true,
      empathy: true,
      resolution: true,
    },
  });

  let currentResponse = defaultResponse;

  const mock = {
    calls,

    /**
     * Override the text returned by `complete()`.
     *
     * @param {string} text  The raw string that `complete()` will resolve to.
     */
    setResponse(text) {
      currentResponse = text;
    },

    complete: tracked('complete', async function complete(_prompt, _options) {
      return currentResponse;
    }, calls),
  };

  return mock;
}

// ---------------------------------------------------------------------------
// 4. createMockDb
// ---------------------------------------------------------------------------

/**
 * Creates a mock for the database client (PostgreSQL-style query interface).
 *
 * By default every query returns `{ rows: [], rowCount: 0 }`.
 * Use `mock.setQueryResult(pattern, result)` to make queries whose SQL
 * contains `pattern` (case-insensitive substring match) return `result`.
 *
 * All executed queries are recorded in `mock.queries`.
 *
 * @returns {Object} mock database instance
 */
function createMockDb() {
  const queries = [];
  const resultMap = []; // Array of { pattern: string, result: object }

  const mock = {
    queries,

    /**
     * Register a canned result for queries whose SQL contains `pattern`.
     *
     * Later registrations take precedence (last match wins) so callers
     * can set a broad fallback first and then add more specific overrides.
     *
     * @param {string} pattern   Substring to match against the SQL text.
     * @param {Object} result    The object to return, e.g. `{ rows: [...], rowCount: 1 }`.
     */
    setQueryResult(pattern, result) {
      resultMap.push({ pattern: pattern.toLowerCase(), result });
    },

    /**
     * Execute a query against the mock database.
     *
     * @param {string}        sql     SQL statement text.
     * @param {Array}         params  Bind parameters.
     * @returns {Promise<Object>}     Query result.
     */
    async query(sql, params) {
      queries.push({ sql, params });

      const sqlLower = (sql || '').toLowerCase();

      // Walk the map in reverse so the most recently registered pattern wins.
      for (let i = resultMap.length - 1; i >= 0; i--) {
        if (sqlLower.includes(resultMap[i].pattern)) {
          return resultMap[i].result;
        }
      }

      return { rows: [], rowCount: 0 };
    },
  };

  return mock;
}

// ---------------------------------------------------------------------------
// 5. createMockNotify
// ---------------------------------------------------------------------------

/**
 * Creates a mock notification function.
 *
 * The returned function behaves like `notify(payload)` and records every
 * invocation in `mock.calls`.
 *
 * @returns {Function & { calls: Array }}
 */
function createMockNotify() {
  const notifyCalls = [];

  function mock(notification) {
    notifyCalls.push(notification);
  }

  mock.calls = notifyCalls;

  return mock;
}

// ---------------------------------------------------------------------------
// 6. createMockAgiChannel
// ---------------------------------------------------------------------------

/**
 * Creates a mock AGI channel for voice-agent / IVR testing.
 *
 * Every command issued through the channel is recorded in `mock.commands`
 * as a plain string for easy assertion (e.g. `"streamFile beep"`).
 *
 * Variable storage is backed by a simple in-memory map so `setVariable` /
 * `getVariable` round-trip correctly.
 *
 * @returns {Object} mock AGI channel
 */
function createMockAgiChannel() {
  const commands = [];
  const variables = {};

  const mock = {
    commands,

    async answer() {
      commands.push('answer');
    },

    async hangup() {
      commands.push('hangup');
    },

    async streamFile(filename, escapeDigits) {
      commands.push(`streamFile ${filename}${escapeDigits ? ' ' + escapeDigits : ''}`);
      return { result: 0 };
    },

    async recordFile(filename, format, escapeDigits, timeout, offsetSamples, beep) {
      const parts = ['recordFile', filename, format];
      if (escapeDigits !== undefined) parts.push(escapeDigits);
      if (timeout !== undefined) parts.push(timeout);
      if (offsetSamples !== undefined) parts.push(offsetSamples);
      if (beep !== undefined) parts.push(beep);
      commands.push(parts.join(' '));
      return { result: 0 };
    },

    async getVariable(name) {
      commands.push(`getVariable ${name}`);
      const value = variables[name];
      return value !== undefined ? { result: 1, value } : { result: 0, value: '' };
    },

    async setVariable(name, value) {
      commands.push(`setVariable ${name} ${value}`);
      variables[name] = value;
    },
  };

  return mock;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  createMockMangoService,
  createMockSpeechKitService,
  createMockAiProvider,
  createMockDb,
  createMockNotify,
  createMockAgiChannel,
};
