'use strict';

/**
 * Регрессия 09.10.2026: «Сбросить» в CRM не рвало звонок.
 *
 * Причина: AMI на CoreShowChannels отвечает `Response: Follows` (без списка),
 * а каналы приходят отдельными событиями CoreShowChannel и завершаются
 * CoreShowChannelsComplete. Старый код читал res.List → всегда пусто → 0 снятых
 * каналов. Проверяем сборку списка из событий и снятие по префиксу канала.
 *
 * Usage: node tests/pbx/hangup-all-legs.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const ROOT = path.resolve(__dirname, '../..');
let passed = 0;
let failed = 0;
function test(id, name, fn) {
  return Promise.resolve().then(fn).then(() => {
    passed++; console.log(`  ✓ ${id} ${name}`);
  }).catch((e) => {
    failed++; console.error(`  ✗ ${id} ${name}: ${e.message}`);
  });
}

const src = fs.readFileSync(path.join(ROOT, 'src/pbx/ami-client.js'), 'utf8');
const idxSrc = fs.readFileSync(path.join(ROOT, 'src/pbx/index.js'), 'utf8');
const core = fs.readFileSync(path.join(ROOT, 'public/assets/js/phone_core.js'), 'utf8');

/** Повторяет логику coreShowChannels без сокета: события → список. */
function collect(steps) {
  const em = new EventEmitter();
  const list = [];
  let done = false;
  return new Promise((resolve) => {
    const finish = () => { if (done) return; done = true; em.removeListener('event', onEvent); resolve(list); };
    const onEvent = (msg) => {
      if (msg.Event === 'CoreShowChannel') list.push(msg);
      else if (msg.Event === 'CoreShowChannelsComplete') finish();
    };
    em.on('event', onEvent);
    for (const s of steps) em.emit('event', s);
  });
}

(async () => {
  console.log('hangup-all-legs');

  await test('H1', 'coreShowChannels собирает каналы из событий (не из Follows)', async () => {
    assert.ok(/CoreShowChannel'/.test(src), 'не слушает событие CoreShowChannel');
    assert.ok(/CoreShowChannelsComplete/.test(src), 'нет терминатора CoreShowChannelsComplete');
    const list = await collect([
      { Event: 'CoreShowChannel', Channel: 'PJSIP/79161112233@mango-trunk-0000001', Linkedid: 'U1', Uniqueid: 'C1' },
      { Event: 'CoreShowChannel', Channel: 'PJSIP/webrtc-op-0000002', Linkedid: 'U1', Uniqueid: 'C2' },
      { Event: 'CoreShowChannelsComplete' },
    ]);
    assert.strictEqual(list.length, 2, 'список каналов не собрался');
  });

  await test('H2', 'сброс матчит живой канал по префиксу (dial-string → -0000001)', () => {
    assert.ok(/indexOf\(wantChannel \+ '-'\) === 0/.test(idxSrc), 'нет матча по префиксу канала');
  });

  await test('H3', 'сброс ищет плечи и по pbx_uid (Linkedid/Uniqueid)', () => {
    assert.ok(/linked === uid \|\| unique === uid/.test(idxSrc), 'нет поиска по uid');
  });

  await test('H3b', 'сброс из браузера: плечо WebRTC рвётся по sip_username оператора', () => {
    assert.ok(/sipUser/.test(idxSrc), 'нет резолва sip_username для сброса');
    assert.ok(/'PJSIP\/' \+ sipUser/.test(idxSrc), 'нет матча канала WebRTC по SIP-эндпоинту');
    assert.ok(/body\.user_id && db/.test(idxSrc), 'user_id не используется при сбросе');
  });

  await test('H3c', 'клиент шлёт user_id + direction при сбросе (WebRTC)', () => {
    const hang = core.slice(core.indexOf('hangup: function'), core.indexOf('hangup: function') + 1200);
    assert.ok(/user_id: uid/.test(hang), 'клиент не шлёт user_id');
    assert.ok(/asgard_user/.test(hang), 'нет чтения текущего пользователя');
    assert.ok(/activeSession\.terminate\(\)/.test(hang), 'нет локального BYE (terminate)');
  });

  await test('H4', 'серверный исходящий возвращает pbx_uid для сброса', () => {
    assert.ok(/pbx_uid: OriginateUniqueid/.test(idxSrc), 'originateOutbound не возвращает pbx_uid');
  });

  await test('H5', 'клиент сохраняет channel/pbx_uid серверного исходящего', () => {
    const out = core.slice(core.indexOf('outbound: function'), core.indexOf('outbound: function') + 2200);
    assert.ok(/callMeta\.channel = r\.channel/.test(out), 'клиент не запоминает канал плеча');
    assert.ok(/callMeta\.pbx_uid = r\.pbx_uid/.test(out), 'клиент не запоминает pbx_uid');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
