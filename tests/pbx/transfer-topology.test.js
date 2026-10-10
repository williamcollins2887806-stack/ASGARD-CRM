'use strict';
/**
 * Контракт перевода звонка: blind-перевод обязан переносить ПЛЕЧО АБОНЕНТА,
 * а не канал оператора.
 *
 * Инцидент 10.10.2026: перевод на Андросова обрывал вызов у обоих. Причина —
 * redirect вешался на канал оператора (PJSIP/u3474), и перевод «на себя»
 * делал Dial(PJSIP/u3474) самому себе → busy → fail → Hangup.
 *
 * Usage: node tests/pbx/transfer-topology.test.js
 */
const assert = require('assert');
const { pickTransferChannels, pickPartnerChannel } = require('../../src/pbx/index');

let passed = 0;
let failed = 0;
function test(id, name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${id} ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${id} ${name}: ${e.message}`); }
}

console.log('transfer-topology');

test('T1', 'канал оператора находится по sip_username', () => {
  const list = [
    { Channel: 'PJSIP/u3474-00000006', Linkedid: '1791651852.9', Uniqueid: '1791651852.9' },
    { Channel: 'PJSIP/mango-trunk-00000007', Linkedid: '1791651852.9', Uniqueid: '1791651852.7' },
  ];
  const r = pickTransferChannels(list, { uid: '1791651852.9', sipUser: 'u3474' });
  assert.strictEqual(r.operatorChannel, 'PJSIP/u3474-00000006', 'не найден канал оператора');
});

test('T2', 'переводится ПАРТНЁР (абонент), а не канал оператора', () => {
  const list = [
    { Channel: 'PJSIP/u3474-00000006', Linkedid: '1791651852.9', Uniqueid: '1791651852.9' },
    { Channel: 'PJSIP/mango-trunk-00000007', Linkedid: '1791651852.9', Uniqueid: '1791651852.7' },
  ];
  const r = pickTransferChannels(list, { uid: '1791651852.9', sipUser: 'u3474' });
  assert.strictEqual(r.partnerChannel, 'PJSIP/mango-trunk-00000007');
  assert.strictEqual(r.transferChannel, 'PJSIP/mango-trunk-00000007',
    'redirect должен идти на плечо абонента, иначе Dial самому себе');
  assert.notStrictEqual(r.transferChannel, r.operatorChannel, 'нельзя переводить свой же канал');
});

test('T3', 'Local/-каналы пропускаются (служебные)', () => {
  const list = [
    { Channel: 'PJSIP/u3474-00000006', Linkedid: 'X' },
    { Channel: 'Local/confirm@from-internal-00000001;1', Linkedid: 'X' },
    { Channel: 'PJSIP/mango-trunk-00000007', Linkedid: 'X' },
  ];
  const r = pickTransferChannels(list, { uid: 'X', sipUser: 'u3474' });
  assert.strictEqual(r.transferChannel, 'PJSIP/mango-trunk-00000007');
});

test('T4', 'клиентский channel берётся первым (GSM-путь)', () => {
  const list = [{ Channel: 'PJSIP/other-00000001', Linkedid: 'Z' }];
  const r = pickTransferChannels(list, { channel: 'PJSIP/u3474-00000009', uid: 'Z', sipUser: 'u3474' });
  assert.strictEqual(r.operatorChannel, 'PJSIP/u3474-00000009', 'явный channel имеет приоритет');
});

test('T5', 'нет партнёра → падаем на канал оператора (не null)', () => {
  const list = [{ Channel: 'PJSIP/u3474-00000006', Linkedid: 'X' }];
  const r = pickTransferChannels(list, { uid: 'X', sipUser: 'u3474' });
  assert.strictEqual(r.partnerChannel, null);
  assert.strictEqual(r.transferChannel, 'PJSIP/u3474-00000006', 'должен остаться хоть какой-то канал');
});

test('T6', 'чужой канал с тем же Linkedid исключается как «оператор»', () => {
  // Если явно передан канал оператора, партнёр ищется по Linkedid именно его.
  const list = [
    { Channel: 'PJSIP/u100-00000001', Linkedid: 'A' },
    { Channel: 'PJSIP/u3474-00000006', Linkedid: 'B' },
    { Channel: 'PJSIP/mango-trunk-00000007', Linkedid: 'B' },
  ];
  const r = pickTransferChannels(list, { channel: 'PJSIP/u3474-00000006' });
  assert.strictEqual(r.partnerChannel, 'PJSIP/mango-trunk-00000007', 'партнёр должен быть из моста оператора (B)');
});

test('T7', 'пустой список не бросает (нет фантомного перевода)', () => {
  const r = pickTransferChannels([], { uid: 'X', sipUser: 'u3474' });
  assert.strictEqual(r.operatorChannel, null);
  assert.strictEqual(r.transferChannel, null);
});

test('T8', 'pickPartnerChannel не возвращает сам канал оператора', () => {
  const list = [{ Channel: 'PJSIP/u3474-00000006', Linkedid: 'X' }];
  const p = pickPartnerChannel(list, 'PJSIP/u3474-00000006', list[0]);
  assert.strictEqual(p, null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
