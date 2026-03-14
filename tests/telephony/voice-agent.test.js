'use strict';

/**
 * ASGARD CRM — Voice Agent Unit Tests
 * Тесты AI-голосового секретаря: сценарии диалога, генерация ответов
 */

const helpers = require('./helpers');

const tests = [];
function test(name, fn) { tests.push({ name: 'VoiceAgent: ' + name, run: fn }); }

function createMockSpeechKit() {
  return {
    isConfigured: () => false,
    synthesizeCached: async () => '/tmp/mock.opus',
    recognizeShort: async () => 'Тестовый текст',
    _calls: []
  };
}

function createMockAi(responseJson) {
  return {
    complete: async () => JSON.stringify(responseJson || {
      text: 'Соединяю с менеджером.',
      action: 'route',
      route_to: '200',
      reason: 'Клиент просит связаться с менеджером'
    })
  };
}

function createMockDb(customerData = null, tenderData = null) {
  return {
    query: async (sql, params) => {
      if (sql.includes('FROM customers')) {
        return { rows: customerData ? [customerData] : [] };
      }
      if (sql.includes('FROM tenders')) {
        return { rows: tenderData ? [tenderData] : [] };
      }
      if (sql.includes('FROM call_history')) {
        return { rows: [] };
      }
      if (sql.includes('FROM settings')) {
        return { rows: [{ value_json: '{"work_hours_start":"09:00","work_hours_end":"18:00"}' }] };
      }
      return { rows: [] };
    }
  };
}

function createMockChannel() {
  const commands = [];
  return {
    commands,
    streamFile: async (path) => { commands.push('streamFile:' + path); },
    recordFile: async () => { commands.push('recordFile'); return '/tmp/test_record'; },
    answer: async () => { commands.push('answer'); },
    hangup: async () => { commands.push('hangup'); }
  };
}

// ── generateResponse ──

test('generateResponse() возвращает route-действие', async () => {
  const VoiceAgent = require('../../src/services/voice-agent');
  const agent = new VoiceAgent(
    createMockSpeechKit(),
    createMockAi({ text: 'Соединяю', action: 'route', route_to: '200' }),
    createMockDb()
  );

  const response = await agent.generateResponse({
    callerNumber: '79161234567',
    clientName: 'Тест',
    isWorkHours: true,
    conversationHistory: [],
    lastClientMessage: 'Позовите менеджера'
  });

  if (!response) throw new Error('Should return response');
  if (response.action !== 'route') throw new Error(`Expected route, got ${response.action}`);
});

test('generateResponse() возвращает record при нерабочем времени', async () => {
  const VoiceAgent = require('../../src/services/voice-agent');
  const agent = new VoiceAgent(
    createMockSpeechKit(),
    createMockAi({ text: 'Оставьте сообщение', action: 'record' }),
    createMockDb()
  );

  const response = await agent.generateResponse({
    callerNumber: '79161234567',
    isWorkHours: false,
    conversationHistory: [],
    lastClientMessage: 'Алло'
  });

  if (!response) throw new Error('Should return response');
  if (response.action !== 'record') throw new Error(`Expected record, got ${response.action}`);
});

test('generateResponse() возвращает null при ошибке AI', async () => {
  const VoiceAgent = require('../../src/services/voice-agent');
  const agent = new VoiceAgent(
    createMockSpeechKit(),
    { complete: async () => { throw new Error('AI error'); } },
    createMockDb()
  );

  const response = await agent.generateResponse({
    callerNumber: '79161234567',
    conversationHistory: [],
    lastClientMessage: 'тест'
  });

  if (response !== null) throw new Error('Should return null on AI error');
});

// ── _parseResponse ──

test('_parseResponse() парсит валидный JSON ответ', () => {
  const VoiceAgent = require('../../src/services/voice-agent');
  const agent = new VoiceAgent({}, {}, {});

  const result = agent._parseResponse('{"text":"Привет","action":"continue"}');
  if (!result) throw new Error('Should parse JSON');
  if (result.text !== 'Привет') throw new Error('Wrong text');
  if (result.action !== 'continue') throw new Error('Wrong action');
});

test('_parseResponse() убирает markdown', () => {
  const VoiceAgent = require('../../src/services/voice-agent');
  const agent = new VoiceAgent({}, {}, {});

  const result = agent._parseResponse('```json\n{"text":"test","action":"hangup"}\n```');
  if (!result) throw new Error('Should parse after stripping markdown');
  if (result.action !== 'hangup') throw new Error('Wrong action');
});

test('_parseResponse() обрабатывает не-JSON как текст', () => {
  const VoiceAgent = require('../../src/services/voice-agent');
  const agent = new VoiceAgent({}, {}, {});

  const result = agent._parseResponse('Просто текст ответа секретаря');
  if (!result) throw new Error('Should return fallback');
  if (result.action !== 'continue') throw new Error('Fallback action should be continue');
  if (!result.text) throw new Error('Should have text');
});

test('_parseResponse() фильтрует невалидные actions', () => {
  const VoiceAgent = require('../../src/services/voice-agent');
  const agent = new VoiceAgent({}, {}, {});

  const result = agent._parseResponse('{"text":"test","action":"invalid_action"}');
  if (!result) throw new Error('Should parse');
  if (result.action !== 'continue') throw new Error('Invalid action should fallback to continue');
});

// ── _buildContext ──

test('_buildContext() находит известного клиента', async () => {
  const VoiceAgent = require('../../src/services/voice-agent');
  const agent = new VoiceAgent(
    createMockSpeechKit(),
    createMockAi(),
    createMockDb(
      { name: 'ООО Тест', inn: '1234567890', contact_person: 'Иванов' },
      { pm_name: 'Петров', mango_extension: '200' }
    )
  );

  const ctx = await agent._buildContext('79161234567');
  if (!ctx.clientName) throw new Error('Should find client name');
  if (ctx.clientName !== 'Иванов') throw new Error(`Expected Иванов, got ${ctx.clientName}`);
  if (!ctx.clientCompany) throw new Error('Should find company');
});

test('_buildContext() возвращает null для неизвестного номера', async () => {
  const VoiceAgent = require('../../src/services/voice-agent');
  const agent = new VoiceAgent(
    createMockSpeechKit(),
    createMockAi(),
    createMockDb()
  );

  const ctx = await agent._buildContext('79999999999');
  if (ctx.clientName !== null) throw new Error('Should be null for unknown number');
});

test('_buildContext() определяет рабочее время', async () => {
  const VoiceAgent = require('../../src/services/voice-agent');
  const agent = new VoiceAgent(createMockSpeechKit(), createMockAi(), createMockDb());

  const ctx = await agent._buildContext('79161234567');
  if (typeof ctx.isWorkHours !== 'boolean') throw new Error('isWorkHours should be boolean');
});

// ── _speak (mock mode) ──

test('_speak() не падает без SpeechKit', async () => {
  const VoiceAgent = require('../../src/services/voice-agent');
  const agent = new VoiceAgent(createMockSpeechKit(), createMockAi(), createMockDb());
  // Не должен бросать исключение
  await agent._speak(null, 'Тестовое сообщение');
});

// ── _listenAndRecognize ──

test('_listenAndRecognize() возвращает null без канала', async () => {
  const VoiceAgent = require('../../src/services/voice-agent');
  const agent = new VoiceAgent(createMockSpeechKit(), createMockAi(), createMockDb());
  const result = await agent._listenAndRecognize(null);
  if (result !== null) throw new Error('Should return null without channel');
});

// ── maxTurns ──

test('maxTurns по умолчанию 4', () => {
  const VoiceAgent = require('../../src/services/voice-agent');
  const agent = new VoiceAgent({}, {}, {});
  if (agent.maxTurns !== 4) throw new Error(`Expected 4, got ${agent.maxTurns}`);
});

module.exports = { name: 'Voice Agent', tests };
