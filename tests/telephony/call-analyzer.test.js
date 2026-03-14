'use strict';

/**
 * ASGARD CRM — Call Analyzer Unit Tests
 * Тесты ИИ-анализа, парсинга ответов, создания заявок
 */

const helpers = require('./helpers');

const tests = [];
function test(name, fn) { tests.push({ name: 'CallAnalyzer: ' + name, run: fn }); }

function createMockAi(responseText) {
  return {
    complete: async () => responseText,
  };
}

function createMockDb() {
  const queries = [];
  return {
    queries,
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('INSERT INTO tenders')) {
        return { rows: [{ id: 999 }] };
      }
      if (sql.includes('UPDATE call_history')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
  };
}

// ── Анализ транскрипта ──

test('analyze() возвращает структурированный результат', async () => {
  const analysisJson = JSON.stringify({
    is_target: true,
    summary: 'Клиент запрашивает химочистку теплообменника',
    sentiment: 'positive',
    company: 'ТестКомпания',
    contact: 'Иванов И.И.',
    object: 'НПЗ',
    work: 'Химическая очистка',
    urgency: 'normal',
    source: 'Входящий звонок',
    next_steps: ['Подготовить КП'],
    tags: ['химочистка']
  });

  const mockAi = createMockAi(analysisJson);
  const mockDb = createMockDb();
  const CallAnalyzer = require('../../src/services/call-analyzer');
  const analyzer = new CallAnalyzer(mockAi, mockDb);

  // Достаточно длинный транскрипт (>20 символов)
  const result = await analyzer.analyze(
    'Добрый день, нам нужна химическая очистка теплообменника на нашем заводе.',
    { direction: 'inbound', from_number: '79161234567', duration_seconds: 120 }
  );

  if (!result) throw new Error('Result should not be null');
  if (result.is_target !== true) throw new Error(`is_target should be true, got ${result.is_target}`);
  if (!result.summary.includes('химочистку')) throw new Error('Wrong summary');
});

test('analyze() обрабатывает markdown-обёрнутый JSON', async () => {
  const json = '```json\n{"is_target":false,"summary":"Спам","sentiment":"negative"}\n```';
  const mockAi = createMockAi(json);
  const mockDb = createMockDb();
  const CallAnalyzer = require('../../src/services/call-analyzer');
  const analyzer = new CallAnalyzer(mockAi, mockDb);

  const result = await analyzer.analyze('Достаточно длинный транскрипт для анализа тест тест тест', {});
  if (!result) throw new Error('Should parse markdown-wrapped JSON');
  if (result.is_target !== false) throw new Error(`is_target should be false, got ${result.is_target}`);
});

test('analyze() возвращает объект с ошибкой при сбое AI', async () => {
  const mockAi = { complete: async () => { throw new Error('AI unavailable'); } };
  const mockDb = createMockDb();
  const CallAnalyzer = require('../../src/services/call-analyzer');
  const analyzer = new CallAnalyzer(mockAi, mockDb);

  const result = await analyzer.analyze('Достаточно длинный транскрипт для анализа системы', {});
  // При ошибке должен вернуть объект (не null)
  if (!result) throw new Error('Should return error object');
  if (result.sentiment !== 'neutral') throw new Error('Error result should have neutral sentiment');
});

test('analyze() короткий транскрипт → не целевой', async () => {
  const mockAi = createMockAi('{}');
  const CallAnalyzer = require('../../src/services/call-analyzer');
  const analyzer = new CallAnalyzer(mockAi, createMockDb());

  const result = await analyzer.analyze('Коротко', {});
  if (!result) throw new Error('Should return result for short transcript');
  if (result.is_target !== false) throw new Error('Short transcript should not be target');
});

test('analyze() обрабатывает не-JSON ответ как текст', async () => {
  const mockAi = createMockAi('Это просто текстовый ответ без JSON формата совсем');
  const mockDb = createMockDb();
  const CallAnalyzer = require('../../src/services/call-analyzer');
  const analyzer = new CallAnalyzer(mockAi, mockDb);

  const result = await analyzer.analyze('Достаточно длинный транскрипт для анализа текста', {});
  if (!result) throw new Error('Should return fallback result');
});

// ── _parseResponse ──

test('_parseResponse() парсит валидный JSON', () => {
  const CallAnalyzer = require('../../src/services/call-analyzer');
  const analyzer = new CallAnalyzer({}, {});
  const result = analyzer._parseResponse('{"is_target":true,"summary":"test","sentiment":"neutral"}');
  if (!result) throw new Error('Should parse valid JSON');
  if (result.is_target !== true) throw new Error('is_target should be true');
});

test('_parseResponse() убирает markdown-обёртку', () => {
  const CallAnalyzer = require('../../src/services/call-analyzer');
  const analyzer = new CallAnalyzer({}, {});
  const result = analyzer._parseResponse('```json\n{"is_target":false}\n```');
  if (!result) throw new Error('Should parse after stripping markdown');
  if (result.is_target !== false) throw new Error('is_target should be false');
});

test('_parseResponse() возвращает fallback для плохого JSON', () => {
  const CallAnalyzer = require('../../src/services/call-analyzer');
  const analyzer = new CallAnalyzer({}, {});
  const result = analyzer._parseResponse('не валидный json {{{');
  if (!result) throw new Error('Should return fallback');
});

// ── Создание заявки ──

test('createDraftLead() создаёт запись в БД', async () => {
  const mockDb = createMockDb();
  const CallAnalyzer = require('../../src/services/call-analyzer');
  const analyzer = new CallAnalyzer({}, mockDb);

  const analysis = helpers.generateAiAnalysis();
  const leadId = await analyzer.createDraftLead(analysis, 1, 5);

  if (!leadId) throw new Error('Should return lead ID');
  const insertQuery = mockDb.queries.find(q => q.sql.includes('INSERT INTO tenders'));
  if (!insertQuery) throw new Error('Should INSERT into tenders');
});

test('createDraftLead() привязывает к call_history', async () => {
  const mockDb = createMockDb();
  const CallAnalyzer = require('../../src/services/call-analyzer');
  const analyzer = new CallAnalyzer({}, mockDb);

  const analysis = helpers.generateAiAnalysis();
  await analyzer.createDraftLead(analysis, 42, 5);

  const updateQuery = mockDb.queries.find(q =>
    q.sql.includes('UPDATE call_history') && q.sql.includes('lead_id')
  );
  if (!updateQuery) throw new Error('Should UPDATE call_history with lead_id');
});

module.exports = { name: 'Call Analyzer', tests };
