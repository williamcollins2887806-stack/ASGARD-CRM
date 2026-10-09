'use strict';

/**
 * Инцидент 09.10.2026: «он ответил и звонок сразу сбросился».
 *
 * Причина: WebRTC-эндпоинты разрешали opus, транк Mango принимает g722/alaw/ulaw,
 * а в сборке Asterisk нет codec_opus.so → «opus -> ulaw: No Translation Path».
 * При ответе Asterisk не может свести плечи:
 *   channel.c: Unable to find a codec translation path: (opus) -> (ulaw)
 *   app_dial.c: Had to drop call ... not compatible with PJSIP/mango-trunk
 *
 * Контракт: набор кодеков WebRTC ⊆ набор кодеков транка (транскодинг не нужен).
 *
 * Usage: node tests/pbx/codec-compat.test.js
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

function parseAllow(conf, sectionRe) {
  const block = conf.slice(conf.indexOf(sectionRe));
  const m = /^allow=(.+)$/m.exec(block);
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
}

console.log('codec-compat');

test('C1', 'webrtc-шаблон НЕ разрешает opus (нет codec_opus.so)', () => {
  const conf = read('ops/asterisk/pjsip_asgard_webrtc.conf');
  const allow = parseAllow(conf, '[webrtc-template]');
  assert.ok(allow.length > 0, 'не найден allow= в webrtc-template');
  assert.ok(!allow.includes('opus'),
    'opus вернулся: без codec_opus.so звонок будет рваться сразу после ответа');
});

test('C2', 'второй сниппет webrtc тоже без opus', () => {
  const conf = read('ops/asterisk/pjsip_webrtc.conf.snippet');
  const allow = parseAllow(conf, '[webrtc-template]');
  assert.ok(!allow.includes('opus'), 'opus в pjsip_webrtc.conf.snippet');
});

test('C3', 'кодеки WebRTC ⊆ кодеки транка (транскодинг не нужен)', () => {
  const webrtc = parseAllow(read('ops/asterisk/pjsip_asgard_webrtc.conf'), '[webrtc-template]');
  const trunk = parseAllow(read('ops/asterisk/pjsip_asgard_trunks.conf'), '[mango-trunk]\ntype=endpoint');
  assert.ok(trunk.length > 0, 'не найден allow= у mango-trunk');
  const extra = webrtc.filter((c) => !trunk.includes(c));
  assert.deepStrictEqual(extra, [],
    `кодеки ${extra.join(',')} есть у WebRTC, но нет на транке — нужен транскодер`);
});

test('C4', 'в конфиге зафиксирована причина (opus/трансляция)', () => {
  const conf = read('ops/asterisk/pjsip_asgard_webrtc.conf');
  assert.ok(/opus/.test(conf), 'нет пояснения, почему opus исключён');
  assert.ok(/Translation Path|трансляц/i.test(conf), 'нет ссылки на отсутствие пути трансляции');
});

test('C5', 'README документирует инцидент с кодеками', () => {
  const r = read('ops/asterisk/README.md');
  assert.ok(/codec_opus/.test(r), 'README не упоминает codec_opus');
  assert.ok(/drop call|сразу после ответа/i.test(r), 'README не описывает симптом');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
