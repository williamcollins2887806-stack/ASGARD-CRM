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

function createMockDb(opts) {
  const options = opts || {};
  const queries = [];
  return {
    queries,
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('INSERT INTO pre_tender_requests')) {
        return { rows: [{ id: 999 }] };
      }
      if (sql.includes('INSERT INTO tenders')) {
        return { rows: [{ id: 999 }] };
      }
      if (sql.includes('UPDATE call_history') || sql.includes('UPDATE pre_tender_requests')) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('FROM call_history') && sql.includes('direction')) {
        return { rows: [{ from_number: '79654862200', caller_number: '79654862200', client_number: '79654862200', direction: 'inbound' }] };
      }
      if (sql.includes('FROM pre_tender_requests') && sql.includes('created_at >=')) {
        return { rows: options.existingPt ? [options.existingPt] : [] };
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

test('analyze() при сбое AI пробрасывает retryable-ошибку', async () => {
  const mockAi = { complete: async () => { throw new Error('AI unavailable'); } };
  const mockDb = createMockDb();
  const CallAnalyzer = require('../../src/services/call-analyzer');
  const analyzer = new CallAnalyzer(mockAi, mockDb);

  // Инфра-сбой НЕ подменяется фейковым резюме: пайплайн должен получить
  // retryable-ошибку и повторить анализ (коммит 23f78717, добор ИИ после 402).
  let thrown = null;
  try {
    await analyzer.analyze('Достаточно длинный транскрипт для анализа системы', {});
  } catch (e) {
    thrown = e;
  }
  if (!thrown) throw new Error('Should throw retryable error, not fake summary');
  if (thrown.retryable !== true) throw new Error('Error should be retryable');
  if (thrown.code !== 'provider_error') throw new Error('Expected provider_error, got ' + thrown.code);
});

test('analyze() короткий транскрипт → не целевой', async () => {
  const mockAi = createMockAi('{}');
  const CallAnalyzer = require('../../src/services/call-analyzer');
  const analyzer = new CallAnalyzer(mockAi, createMockDb());

  const result = await analyzer.analyze('Коротко', {});
  if (!result) throw new Error('Should return result for short transcript');
  if (result.is_target !== false) throw new Error('Short transcript should not be target');
});

test('analyze() не-JSON ответ → retryable ошибка парсинга', async () => {
  const mockAi = createMockAi('Это просто текстовый ответ без JSON формата совсем');
  const mockDb = createMockDb();
  const CallAnalyzer = require('../../src/services/call-analyzer');
  const analyzer = new CallAnalyzer(mockAi, mockDb);

  // Ответ без JSON = нераспознанный формат: бросаем retryable, чтобы пайплайн
  // повторил запрос, а не записал мусор в резюме.
  let thrown = null;
  try {
    await analyzer.analyze('Достаточно длинный транскрипт для анализа текста', {});
  } catch (e) {
    thrown = e;
  }
  if (!thrown) throw new Error('Should throw parse error');
  if (thrown.retryable !== true) throw new Error('Parse error should be retryable');
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

test('_parseResponse() бросает retryable при плохом JSON', () => {
  const CallAnalyzer = require('../../src/services/call-analyzer');
  const analyzer = new CallAnalyzer({}, {});
  // Битый JSON — повод повторить запрос, а не записать мусор в резюме.
  let thrown = null;
  try {
    analyzer._parseResponse('не валидный json {{{');
  } catch (e) {
    thrown = e;
  }
  if (!thrown) throw new Error('Should throw parse error');
  if (thrown.retryable !== true) throw new Error('Parse error should be retryable');
});

// ── Создание заявки ──

test('createDraftLead() создаёт запись в pre_tender_requests', async () => {
  const mockDb = createMockDb();
  const CallAnalyzer = require('../../src/services/call-analyzer');
  const analyzer = new CallAnalyzer({}, mockDb);

  const analysis = helpers.generateAiAnalysis();
  const ptId = await analyzer.createDraftLead(analysis, 1, 5);

  if (!ptId) throw new Error('Should return pre_tender ID');
  const insertQuery = mockDb.queries.find(q => q.sql.includes('INSERT INTO pre_tender_requests'));
  if (!insertQuery) throw new Error('Should INSERT into pre_tender_requests');
  const badTender = mockDb.queries.find(q => q.sql.includes('INSERT INTO tenders'));
  if (badTender) throw new Error('Must NOT INSERT into tenders');
});

test('createDraftLead() привязывает к call_history.pre_tender_id', async () => {
  const mockDb = createMockDb();
  const CallAnalyzer = require('../../src/services/call-analyzer');
  const analyzer = new CallAnalyzer({}, mockDb);

  const analysis = helpers.generateAiAnalysis();
  await analyzer.createDraftLead(analysis, 42, 5);

  const updateQuery = mockDb.queries.find(q =>
    q.sql.includes('UPDATE call_history') && q.sql.includes('pre_tender_id')
  );
  if (!updateQuery) throw new Error('Should UPDATE call_history with pre_tender_id');
});

// ── Дедуп: один клиент = одна заявка (06.11.2026) ──

test('createDraftLead() не плодит вторую заявку тому же клиенту', async () => {
  const mockDb = createMockDb({ existingPt: { id: 777, work_title: 'Химическая очистка котла', status: 'new' } });
  const CallAnalyzer = require('../../src/services/call-analyzer');
  const analyzer = new CallAnalyzer({}, mockDb);

  const analysis = helpers.generateAiAnalysis();
  const ptId = await analyzer.createDraftLead(analysis, 101, 5);

  if (ptId !== 777) throw new Error('Should return existing pre_tender id, got ' + ptId);
  const insertQuery = mockDb.queries.find(q => q.sql.includes('INSERT INTO pre_tender_requests'));
  if (insertQuery) throw new Error('Must NOT INSERT a duplicate pre_tender');
  const linkQuery = mockDb.queries.find(q =>
    q.sql.includes('UPDATE call_history') && q.sql.includes('pre_tender_id')
  );
  if (!linkQuery) throw new Error('Should link call to existing pre_tender');
  if (Number(linkQuery.params[0]) !== 777) throw new Error('Should link to existing id 777');
});

test('createDraftLead() дописывает историю звонка в описании заявки', async () => {
  const mockDb = createMockDb({ existingPt: { id: 778, work_title: 'ГДО', status: 'new' } });
  const CallAnalyzer = require('../../src/services/call-analyzer');
  const analyzer = new CallAnalyzer({}, mockDb);

  await analyzer.createDraftLead(helpers.generateAiAnalysis(), 102, 5);

  const appendQuery = mockDb.queries.find(q =>
    q.sql.includes('work_description') && q.sql.includes('chr(10)')
  );
  if (!appendQuery) throw new Error('Should append call summary to work_description');
  if (!String(appendQuery.params[1] || '').startsWith('Звонок ')) {
    throw new Error('Appended line should start with «Звонок »');
  }
});

test('createDraftLead() ищет только «живую» заявку за 30 дней', async () => {
  const mockDb = createMockDb();
  const CallAnalyzer = require('../../src/services/call-analyzer');
  const analyzer = new CallAnalyzer({}, mockDb);

  await analyzer.createDraftLead(helpers.generateAiAnalysis(), 103, 5);

  const dedupQuery = mockDb.queries.find(q =>
    q.sql.includes('FROM pre_tender_requests') && q.sql.includes('created_at >=')
  );
  if (!dedupQuery) throw new Error('Should look up existing pre_tender before insert');
  if (!dedupQuery.sql.includes("'rejected', 'expired'")) {
    throw new Error('Dedup must skip rejected/expired заявки');
  }
  if (!dedupQuery.sql.includes('created_tender_id IS NULL')) {
    throw new Error('Dedup must skip заявки, уже ушедшие в сагу');
  }
  const days = dedupQuery.params[dedupQuery.params.length - 1];
  if (Number(days) !== 30) throw new Error('Dedup window should be 30 days, got ' + days);
});

test('findOpenPreTenderForClient() возвращает null без телефона/ИНН/названия', async () => {
  const mockDb = createMockDb();
  const CallAnalyzer = require('../../src/services/call-analyzer');
  const analyzer = new CallAnalyzer({}, mockDb);

  const found = await analyzer.findOpenPreTenderForClient({ phone: '', inn: null, company: null });
  if (found !== null) throw new Error('Should return null when no identifying data');
});

test('appendCallToPreTender() дописывает строку с датой и резюме', async () => {
  const mockDb = createMockDb();
  const CallAnalyzer = require('../../src/services/call-analyzer');
  const analyzer = new CallAnalyzer({}, mockDb);

  const ok = await analyzer.appendCallToPreTender(555, { summary: 'Уточнил сроки' });
  if (!ok) throw new Error('Should report success');

  const q = mockDb.queries.find(x => x.sql.includes('work_description'));
  if (!q) throw new Error('Should UPDATE work_description');
  if (Number(q.params[0]) !== 555) throw new Error('Wrong pre_tender id');
  if (!String(q.params[1]).includes('Уточнил сроки')) throw new Error('Summary missing in appended line');
});

module.exports = { name: 'Call Analyzer', tests };
