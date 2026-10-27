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
const path = require('path');
const { pickTransferChannels, pickPartnerChannel } = require('../../src/pbx/index');
const ROOT = path.resolve(__dirname, '../..');

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

test('T4', 'клиентский channel (входящий) — это АБОНЕНТ, не оператор', () => {
  // РЕГРЕССИЯ 27.10.2026 (инцидент Путков→Тумаева): SSE входящего отдаёт
  // agi_channel = PJSIP/mango-trunk-* (плечо КЛИЕНТА), а sip_username даёт
  // канал оператора. Раньше код считал явный channel каналом оператора и
  // redirect уводил в [transfer] ОПЕРАТОРА, а клиент получал Hangup.
  const list = [
    { Channel: 'PJSIP/u3465-00000046', Linkedid: '1793100990.129', Uniqueid: '1793100990.129' },
    { Channel: 'PJSIP/mango-trunk-00000045', Linkedid: '1793100990.129', Uniqueid: '1793100990.128' },
  ];
  const r = pickTransferChannels(list, {
    channel: 'PJSIP/mango-trunk-00000045',
    uid: '1793100990.129',
    sipUser: 'u3465',
  });
  assert.strictEqual(r.operatorChannel, 'PJSIP/u3465-00000046',
    'оператор должен определиться по sip_username, а не по клиентскому channel');
  assert.strictEqual(r.transferChannel, 'PJSIP/mango-trunk-00000045',
    'переводим плечо АБОНЕНТА');
  assert.notStrictEqual(r.transferChannel, r.operatorChannel,
    'перевод собственного канала оператора = потеря клиента');
});

test('T4b', 'исходящий: явный channel оператора распознаётся как оператор', () => {
  // Обратный случай: исходящий из CRM звонит локальный ua.call —
  // channel = PJSIP/u<id>, и он ДОЛЖЕН считаться каналом оператора.
  const list = [
    { Channel: 'PJSIP/u3474-00000050', Linkedid: '1793101459.147', Uniqueid: '1793101459.147' },
    { Channel: 'PJSIP/mango-trunk-00000051', Linkedid: '1793101459.147', Uniqueid: '1793101459.146' },
  ];
  const r = pickTransferChannels(list, {
    channel: 'PJSIP/u3474-00000050',
    uid: '1793101459.147',
    sipUser: 'u3474',
  });
  assert.strictEqual(r.operatorChannel, 'PJSIP/u3474-00000050');
  assert.strictEqual(r.transferChannel, 'PJSIP/mango-trunk-00000051',
    'исходящий переводим на плечо абонента');
});

test('T4d', 'оператор в режиме mobile: транк НЕ принимается за оператора', () => {
  // РЕГРЕССИЯ (найдено верификатором 27.10.2026): у оператора с
  // receive_mode='mobile' его собственное плечо тоже идёт через mango-trunk
  // (Dial(PJSIP/<моб>@mango-trunk)). Раньше такое плечо опознавалось как
  // «оператор», и перевод переворачивался: переводился оператор, клиент рвался.
  const list = [
    { Channel: 'PJSIP/mango-trunk-00000045', Linkedid: 'L', Uniqueid: 'L1' },
    { Channel: 'PJSIP/79168888934@mango-trunk-00000047', Linkedid: 'L', Uniqueid: 'L2' },
  ];
  const r = pickTransferChannels(list, {
    channel: 'PJSIP/mango-trunk-00000045',
    uid: 'L',
    sipUser: 'u3460',
  });
  assert.strictEqual(r.transferChannel, 'PJSIP/mango-trunk-00000045',
    'переводить нужно плечо КЛИЕНТА, а не мобильное плечо оператора');
  assert.notStrictEqual(r.transferChannel, r.operatorChannel,
    'нельзя переводить собственное плечо оператора');
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

// ── Каскад перевода (12.10.2026): браузер → мобильный → ret, без блокировки ──
const fsx = require('fs');
const idx = fsx.readFileSync(path.join(ROOT, 'src/pbx/index.js'), 'utf8');

test('C1', 'каскад: цепочка [webRTC, mobile] для «В СРМ», мобильный сразу для «На мобильный»', () => {
  assert.ok(/TRANSFER_BROWSER_SEC/.test(idx) && /TRANSFER_MOBILE_SEC/.test(idx), 'нет констант таймаутов');
  assert.ok(/targets = \[webTarget, mobTarget\]\.filter\(Boolean\)/.test(idx), 'нет каскада webRTC→mobile');
  assert.ok(/targets = \[mobTarget\]\.filter\(Boolean\)/.test(idx), 'нет прямого мобильного для target_mode=mobile');
});

test('C2', 'блокировка 409 target_offline убрана (каскад вместо запрета)', () => {
  assert.ok(!/send\(409, \{[\s\S]{0,200}target_offline/.test(idx), 'остался 409-блок перевода');
  assert.ok(!/Звонок не переведён/.test(idx), 'остался текст блокировки');
});

test('C3', 'таймауты каскада из TRANSFER_*_SEC, а не из ring_sec', () => {
  assert.ok(/dialVars\.ringTimeout = first\?\.targetType === 'mobile' \? TRANSFER_MOBILE_SEC : TRANSFER_BROWSER_SEC/.test(idx),
    'таймаут первого плеча не из TRANSFER_*_SEC');
  assert.ok(/dialVars\.fallbackTimeout = second\?\.targetType === 'mobile'/.test(idx),
    'таймаут фолбэка не из TRANSFER_*_SEC');
});

test('C4', 'фронт не ловит target_offline (его больше нет)', () => {
  const core = fsx.readFileSync(path.join(ROOT, 'public/assets/js/phone_core.js'), 'utf8');
  assert.ok(!/target_offline/.test(core), 'осталась обработка target_offline в UI');
});

test('C5', 'applyLineTaken не рвёт активный разговор (перехват линии)', () => {
  const core = fsx.readFileSync(path.join(ROOT, 'public/assets/js/phone_core.js'), 'utf8');
  assert.ok(/keptCall/.test(core), 'нет флага сохранения разговора при перехвате');
  assert.ok(/line_released/.test(core), 'нет события о том, что разговор оставлен');
  assert.ok(/var inCall = /.test(core), 'нет проверки «идёт разговор»');
  // Перехват во время разговора НЕ должен звать terminate()
  const body = core.slice(core.indexOf('applyLineTaken: function'), core.indexOf('goOffline: function'));
  const keptBranch = body.slice(0, body.indexOf('if (activeSession)'));
  assert.ok(!/terminate\(\)/.test(keptBranch),
    'ветка «идёт разговор» всё ещё рвёт сессию через terminate()');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
