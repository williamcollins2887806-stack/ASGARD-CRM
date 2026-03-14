'use strict';

/**
 * ASGARD CRM — Telephony Test Helpers
 * Утилиты для генерации тестовых данных
 */

let _counter = 0;

function uniqueId() {
  return 'test_' + Date.now() + '_' + (++_counter);
}

function randomPhone() {
  const num = '7' + String(Math.floor(9000000000 + Math.random() * 999999999));
  return num;
}

function randomExtension() {
  return String(100 + Math.floor(Math.random() * 899));
}

function generateCallEvent(overrides = {}) {
  const entryId = overrides.entry_id || uniqueId();
  const callId = overrides.call_id || uniqueId();
  return {
    entry_id: entryId,
    call_id: callId,
    timestamp: Math.floor(Date.now() / 1000),
    seq: 1,
    call_state: 'Appeared',
    location: 'abonent',
    from: { number: randomPhone() },
    to: { number: randomExtension(), line_number: '74951234567' },
    call_direction: 1,
    dct_number: '',
    dct_type: 0,
    disconnect_reason: 0,
    ...overrides
  };
}

function generateSummaryEvent(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    entry_id: uniqueId(),
    call_direction: 1,
    from: { number: randomPhone() },
    to: { number: randomExtension(), line_number: '74951234567' },
    line_number: '74951234567',
    create_ts: now - 120,
    forward_ts: now - 115,
    talk_ts: now - 110,
    end_ts: now,
    entry_result: 1,
    talk_duration: 110,
    is_record: 1,
    recording_id: 'rec_' + uniqueId(),
    disconnect_reason: 1100,
    ...overrides
  };
}

function generateMissedCallSummary(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    entry_id: uniqueId(),
    call_direction: 1,
    from: { number: randomPhone() },
    to: { number: randomExtension() },
    line_number: '74951234567',
    create_ts: now - 10,
    forward_ts: 0,
    talk_ts: 0,
    end_ts: now,
    entry_result: 0,
    talk_duration: 0,
    is_record: 0,
    recording_id: '',
    disconnect_reason: 1110,
    ...overrides
  };
}

function generateCallHistoryRow(overrides = {}) {
  const now = new Date();
  return {
    id: Math.floor(Math.random() * 10000),
    call_id: uniqueId(),
    mango_entry_id: uniqueId(),
    mango_call_id: uniqueId(),
    from_number: randomPhone(),
    to_number: randomExtension(),
    caller_number: randomPhone(),
    called_number: randomExtension(),
    direction: 'inbound',
    call_type: 'inbound',
    status: 'completed',
    duration: 120,
    duration_seconds: 120,
    started_at: now,
    ended_at: new Date(now.getTime() + 120000),
    created_at: now,
    updated_at: now,
    recording_id: null,
    record_path: null,
    transcript: null,
    transcript_status: 'none',
    ai_summary: null,
    ai_is_target: null,
    ai_lead_data: null,
    ai_sentiment: null,
    lead_id: null,
    client_inn: null,
    user_id: null,
    missed_task_id: null,
    webhook_payload: null,
    ...overrides
  };
}

function generateTranscript() {
  return {
    text: 'Добрый день, компания Асгард Сервис. Здравствуйте, нам нужна химическая очистка теплообменника. Да, мы занимаемся такими работами. Можете уточнить объект? Нефтеперерабатывающий завод в Тюмени. Хорошо, я передам информацию менеджеру.',
    segments: [
      { speaker: 0, start: 0, end: 3.5, text: 'Добрый день, компания Асгард Сервис.' },
      { speaker: 1, start: 3.5, end: 8.0, text: 'Здравствуйте, нам нужна химическая очистка теплообменника.' },
      { speaker: 0, start: 8.0, end: 12.0, text: 'Да, мы занимаемся такими работами. Можете уточнить объект?' },
      { speaker: 1, start: 12.0, end: 15.5, text: 'Нефтеперерабатывающий завод в Тюмени.' },
      { speaker: 0, start: 15.5, end: 20.0, text: 'Хорошо, я передам информацию менеджеру.' }
    ]
  };
}

function generateAiAnalysis(overrides = {}) {
  return {
    is_target: true,
    summary: 'Клиент обратился по поводу химической очистки теплообменника на НПЗ в Тюмени.',
    sentiment: 'positive',
    company: 'ООО "НефтеХим"',
    contact: 'Иванов Пётр Сергеевич',
    object: 'НПЗ, Тюмень',
    work: 'Химическая очистка теплообменника',
    equipment_type: 'Теплообменник',
    urgency: 'normal',
    source: 'Входящий звонок',
    next_steps: ['Связаться с клиентом для уточнения объёмов', 'Подготовить КП'],
    tags: ['химочистка', 'теплообменник', 'НПЗ'],
    ...overrides
  };
}

function generateMangoSignature(apiKey, apiSalt, jsonString) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(apiKey + jsonString + apiSalt).digest('hex');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  uniqueId,
  randomPhone,
  randomExtension,
  generateCallEvent,
  generateSummaryEvent,
  generateMissedCallSummary,
  generateCallHistoryRow,
  generateTranscript,
  generateAiAnalysis,
  generateMangoSignature,
  sleep
};
