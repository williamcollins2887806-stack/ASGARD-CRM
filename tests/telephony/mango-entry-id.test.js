'use strict';

const { assert } = require('../config');
const {
  entryIdAliases,
  firstRecordingId,
  isRecordingComplete,
} = require('../../src/lib/mango-entry-id');

const tests = [];
function test(name, fn) { tests.push({ name: 'Mango ids: ' + name, run: fn }); }

test('aliases include numeric and base64 of digits', async () => {
  const numeric = '27776069024';
  const b64 = Buffer.from(numeric, 'utf8').toString('base64');
  const fromNum = entryIdAliases(numeric);
  const fromB64 = entryIdAliases(b64);
  assert(fromNum.includes(numeric) && fromNum.includes(b64), 'numeric → both forms');
  assert(fromB64.includes(numeric) && fromB64.includes(b64), 'base64 → both forms');
});

test('opaque entry_id is kept as-is (not digits after decode)', async () => {
  const raw = 'MToxMjM0NTY3ODkwOjE3MDk0MDAwMDA';
  const aliases = entryIdAliases(raw);
  assert(aliases.length === 1 && aliases[0] === raw, 'opaque id has no numeric alias');
});

test('empty entry_id → no aliases', async () => {
  assert(entryIdAliases(null).length === 0, 'null');
  assert(entryIdAliases('').length === 0, 'empty');
});

test('firstRecordingId accepts string and array', async () => {
  assert(firstRecordingId('rec-1') === 'rec-1', 'string');
  assert(firstRecordingId(['rec-a', 'rec-b']) === 'rec-a', 'array');
  assert(firstRecordingId([]) === null, 'empty array');
  assert(firstRecordingId({ recording_id: ['x'] }) === 'x', 'nested');
});

test('isRecordingComplete: code 1000, Completed, Started, sparse', async () => {
  assert(isRecordingComplete({ completion_code: 1000, recording_id: 'r' }) === true, 'code 1000');
  assert(isRecordingComplete({ recording_state: 'Completed', recording_id: 'r' }) === true, 'Completed');
  assert(isRecordingComplete({ recording_state: 'Started', recording_id: 'r' }) === false, 'Started');
  assert(isRecordingComplete({ recording_id: 'r' }) === true, 'sparse with id');
  assert(isRecordingComplete({}) === false, 'empty');
});

test('fetcher day windows pick recent days', async () => {
  const RecordingFetcher = require('../../src/services/recording-fetcher');
  const fetcher = new RecordingFetcher({ query: async () => ({ rows: [] }) }, {
    info() {}, warn() {}, error() {},
  });
  const pending = [
    { created_at: '2026-09-07T10:00:00' },
    { created_at: '2026-09-07T18:00:00' },
    { created_at: '2026-09-05T10:00:00' },
    { created_at: '2026-08-01T10:00:00' },
  ];
  const wins = fetcher._dayWindows(pending, 2);
  assert(wins.length === 2, 'maxDays=2');
  assert(wins[0].key === '2026-09-07', 'newest first, got ' + wins[0].key);
  assert(wins[1].key === '2026-09-05', 'second day');
});

test('fetcher lookup matches base64 alias', async () => {
  const RecordingFetcher = require('../../src/services/recording-fetcher');
  const fetcher = new RecordingFetcher({ query: async () => ({ rows: [] }) }, {
    info() {}, warn() {}, error() {},
  });
  const map = fetcher._buildEntryMap([{ id: 42, mango_entry_id: '27776069024' }]);
  const b64 = Buffer.from('27776069024', 'utf8').toString('base64');
  assert(fetcher._lookupCall(map, b64) === 42, 'lookup via base64');
  assert(fetcher._lookupCall(map, '27776069024') === 42, 'lookup via numeric');
});

module.exports = { name: 'Mango entry/recording ids', tests };
