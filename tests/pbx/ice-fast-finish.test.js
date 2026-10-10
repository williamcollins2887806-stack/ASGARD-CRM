'use strict';
/**
 * Контракт: принудительное завершение сбора ICE в JsSIP.
 *
 * Причина (замер в живом Chrome 10.10.2026, asgard-crm.ru):
 *   no iceServers   -> complete 135мс (но без srflx/relay -> тишина)
 *   stun:coturn UDP -> все кандидаты за ~100мс, complete ЧЕРЕЗ ~40с
 *   turn:coturn UDP -> то же, complete ~40с
 *   turn:coturn TCP -> complete 218мс
 * JsSIP этой сборки ждёт iceGatheringState === "complete" ДО отправки INVITE,
 * поэтому «Позвонить» висело ~40с. Фикс: session.on('icecandidate') и
 * принудительный ready() из объекта {candidate, ready}.
 *
 * Usage: node tests/pbx/ice-fast-finish.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
let passed = 0;
let failed = 0;
function test(id, name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${id} ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${id} ${name}: ${e.message}`); }
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

console.log('ice-fast-finish');

test('F1', 'bindSession подключает форс-финиш ICE', () => {
  const js = read('public/assets/js/phone_core.js');
  const i = js.indexOf('function bindSession');
  assert.ok(i !== -1, 'нет bindSession');
  const blk = js.slice(i, i + 200);
  assert.ok(/attachIceFastFinish\(session\)/.test(blk), 'bindSession не вызывает attachIceFastFinish');
});

test('F2', 'слушает icecandidate и берёт ready из объекта', () => {
  const js = read('public/assets/js/phone_core.js');
  assert.ok(/session\.on\('icecandidate'/.test(js), 'нет подписки на icecandidate');
  assert.ok(/typeof data\.ready === 'function'/.test(js), 'ready берётся не из data.ready');
  assert.ok(/data\.candidate/.test(js), 'кандидат берётся не из data.candidate');
});

test('F3', 'форс-финиш зовёт ready() и срабатывает один раз', () => {
  const js = read('public/assets/js/phone_core.js');
  assert.ok(/_iceFinish\(\)/.test(js), 'ready() (session._iceFinish) не вызывается');
  const i = js.indexOf('function finish(');
  const blk = js.slice(i, i + 300);
  assert.ok(/if \(done\) return;\s*done = true;/.test(blk), 'нет защиты от повторного finish');
  assert.ok(/clearTimeout\(quietTimer\)/.test(blk), 'quiet-таймер не снимается');
  assert.ok(/clearTimeout\(maxTimer\)/.test(blk), 'max-таймер не снимается');
});

test('F4', 'три условия завершения: relay, тишина, потолок', () => {
  const js = read('public/assets/js/phone_core.js');
  assert.ok(/ICE_RELAY_GRACE_MS = \d+/.test(js), 'нет грейс-периода после relay');
  assert.ok(/ICE_GATHER_GRACE_MS = \d+/.test(js), 'нет грейс-периода после srflx');
  assert.ok(/ICE_GATHER_QUIET_MS = \d+/.test(js), 'нет quiet-порога');
  assert.ok(/ICE_GATHER_MAX_MS = \d+/.test(js), 'нет жёсткого потолка');
  // Потолок обязан быть заметно меньше «родных» 40с Chromium.
  const max = Number((js.match(/ICE_GATHER_MAX_MS = (\d+)/) || [])[1]);
  assert.ok(max > 0 && max <= 5000, `потолок ${max}мс не укладывается в 5с`);
});

test('F5', 'публичный кандидат (relay/srflx) ускоряет финиш', () => {
  const js = read('public/assets/js/phone_core.js');
  const i = js.indexOf("typ === 'relay'");
  assert.ok(i !== -1, "нет обработки relay-кандидата");
  const blk = js.slice(i, i + 260);
  assert.ok(/finishAfter\(ICE_RELAY_GRACE_MS/.test(blk), 'relay не приводит к быстрому finish');
  assert.ok(/typ === 'srflx'/.test(blk), 'srflx (публичный) не ускоряет finish');
});

test('F6', 'TCP-only не выбран как решение (риск тишины за NAT)', () => {
  const js = read('public/assets/js/phone_core.js');
  // В комментарии TCP упомянут как отвергнутая альтернатива, но не как код.
  assert.ok(!/iceServers[^\n]*transport=tcp[^\n]*\}\s*\]\s*;/.test(js),
    'нельзя оставлять только TCP — браузер за NAT не поднимет кандидата');
});

test('F7', 'есть флаг отладки для ICE-событий', () => {
  const js = read('public/assets/js/phone_core.js');
  assert.ok(/window\.ASGARD_PHONE_DEBUG/.test(js), 'нет отладочного флага ASGARD_PHONE_DEBUG');
  assert.ok(/function debugIce/.test(js), 'нет debugIce');
});

test('U1', 'гудок ожидания (ringback) для исходящего', () => {
  const js = read('public/assets/js/phone_ui.js');
  assert.ok(/function startRingback\(\)/.test(js), 'нет startRingback');
  assert.ok(/function stopRingback\(\)/.test(js), 'нет stopRingback');
  assert.ok(/var ringbackTimer = null/.test(js), 'нет ringbackTimer');
  assert.ok(/startRingback\(\)/.test(js), 'startRingback не вызывается');
  assert.ok(/stopRingback\(\)/.test(js), 'stopRingback не вызывается');
});

test('U2', 'гудок стартует только для ИСХОДЯЩЕГО (не для входящего)', () => {
  const js = read('public/assets/js/phone_ui.js');
  const i = js.indexOf('startRingback();');
  const blk = js.slice(Math.max(0, i - 300), i + 60);
  assert.ok(/direction === 'outbound'/.test(blk), 'гудок не привязан к исходящему');
});

test('U3', 'гудок останавливается при ответе и завершении', () => {
  const js = read('public/assets/js/phone_ui.js');
  const conn = js.indexOf("type === 'connected'");
  assert.ok(conn !== -1, 'нет обработки connected');
  assert.ok(/stopRingback\(\);[\s\S]{0,60}renderIncall/.test(js.slice(conn - 40, conn + 200)),
    'гудок не гасится при connected');
  const end = js.indexOf("type === 'ended'");
  assert.ok(/stopRingback\(\)/.test(js.slice(end - 40, end + 120)), 'гудок не гасится при ended');
});

test('U4', 'частота гудка 425 Гц (стандарт), период ~4с', () => {
  const js = read('public/assets/js/phone_ui.js');
  assert.ok(/frequency\.value = 425/.test(js), 'нет 425 Гц');
  assert.ok(/setInterval\(beep, 4000\)/.test(js), 'нет периода 4с');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
