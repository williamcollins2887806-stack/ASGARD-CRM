'use strict';

/**
 * Регрессии 09.10.2026 (вечер):
 *  1) «Звонок доходит, но ни я ни меня не слышат» — медиа не сходилось:
 *     transport-ws слушает 127.0.0.1, ICE-кандидаты уходили как loopback.
 *     Лечится external_media/signaling_address у транспорта +
 *     [ice_host_candidates] 127.0.0.1 => <публичный>,include_local_address.
 *  2) 500 в консоли при переводе звонка, хотя это штатный «нет канала».
 *  3) Список перевода включал рабочих (FIELD_WORKER) без ЛК.
 *  4) Дубли строк: PBX-строка создавалась раньше, чем строка Mango-вебхука.
 *
 * Usage: node tests/pbx/audio-transfer-guards.test.js
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

console.log('audio-transfer-guards');

test('G1', 'transport-ws объявляет публичные media/signaling адреса', () => {
  const c = read('ops/asterisk/pjsip_asgard_webrtc.conf');
  const blk = c.slice(c.indexOf('[transport-ws]'), c.indexOf('[webrtc-template]'));
  assert.ok(/external_media_address=/.test(blk), 'нет external_media_address');
  assert.ok(/external_signaling_address=/.test(blk), 'нет external_signaling_address');
  assert.ok(!/external_media_address=127\.0\.0\.1/.test(blk), 'нельзя публиковать loopback');
});

test('G2', 'rtp.conf задаёт ICE host candidate override (сниппет в репо)', () => {
  const s = read('ops/asterisk/rtp.conf.snippet');
  assert.ok(/\[ice_host_candidates\]/.test(s), 'нет секции ice_host_candidates');
  assert.ok(/192\.168\.0\.135 => 92\.242\.61\.184/.test(s),
    'override должен подменять реальный адрес интерфейса (ens3), иначе браузер получает приватный кандидат');
  assert.ok(/include_local_address/.test(s), 'нет include_local_address (нужен и локальный кандидат)');
});

test('G3', 'CMD отдаёт статус обработчика, а не всегда 500', () => {
  const js = read('src/pbx/index.js');
  assert.ok(/send\(err\.statusCode \|\| 500/.test(js), 'статус ошибки теряется — фронт видит 500 вместо 409');
});

test('G4', 'перевод без канала → 409 (GSM-путь), а не 500', () => {
  const js = read('src/routes/telephony-pbx.js');
  assert.ok(/channel required/i.test(js), 'нет распознавания «channel required»');
  assert.ok(/isNoChannel \? 409/.test(js), 'нет ответа 409');
});

test('G5', 'список перевода без рабочих и служебных ролей', () => {
  const js = read('src/routes/telephony-pbx.js');
  const i = js.indexOf("'/transfer/staff'");
  const blk = js.slice(i, i + 1200);
  assert.ok(/role <> ALL\(\$1::text\[\]\)/.test(blk), 'нет фильтра по ролям');
  assert.ok(/TEL_DENY_ROLES/.test(blk), 'не исключены BOT/FIELD_WORKER');
});

test('G6', 'дедуп строк переживает гонку с вебхуком Mango', () => {
  const js = read('src/pbx/recording.js');
  assert.ok(/ГОНКА/.test(js), 'нет пояснения про гонку');
  assert.ok(/for \(let i = 0; i < \d+ && match\.rowCount === 0/.test(js), 'нет повторов поиска существующей строки');
});

test('G7', 'дедуп не создаёт дубль, если строка нашлась с задержкой', () => {
  const js = read('src/pbx/recording.js');
  assert.ok(/if \(match\.rowCount === 0\) \{[\s\S]{0,200}INSERT INTO call_history/.test(js),
    'INSERT выполняется до проверки результата повторного поиска');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
