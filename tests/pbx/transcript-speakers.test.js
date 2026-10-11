'use strict';
/**
 * Контракт субтитров: таймкоды, нормализация спикера, подписи сторон, тема.
 *
 * Инциденты 11.10.2026:
 *   1) «NaN:NaN» — fmtDuration получал строковый таймкод "00:00" (RouterAI).
 *   2) «везде Клиент» — UI считал speaker==0 → Менеджер, иначе Клиент, а
 *      диаризация отдаёт "SPEAKER_00" (строка) → всё уходило в «Клиент».
 *   3) Список звонков чёрный на светлой теме — .ph-dp--ios background:#000.
 *
 * Usage: node tests/pbx/transcript-speakers.test.js
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

console.log('transcript-speakers');

// ── fmtDuration / parseSec ──
const tel = read('public/assets/js/telephony.js');

test('T1', 'fmtDuration использует parseSec (число и строка "MM:SS")', () => {
  assert.ok(/function parseSec\(/.test(tel), 'нет parseSec');
  assert.ok(/function fmtDuration\([\s\S]{0,120}parseSec\(sec\)/.test(tel), 'fmtDuration не зовёт parseSec');
});

test('T2', 'parseSec разбирает "MM:SS" и числа', () => {
  // Проверяем по телу: строковый формат mm:ss и parseFloat
  const i = tel.indexOf('function parseSec');
  const blk = tel.slice(i, i + 500);
  assert.ok(/\\d\+\):\(\\d\+/.test(blk) || /\^\(\\d\+\)/.test(blk), 'нет разбора mm:ss');
  assert.ok(/parseFloat/.test(blk), 'нет parseFloat для чисел');
});

// ── normalizeSpeaker ──
test('T3', 'normalizeSpeaker разбирает "SPEAKER_00" и числа, иначе null', () => {
  assert.ok(/function normalizeSpeaker\(/.test(tel), 'нет normalizeSpeaker');
  const i = tel.indexOf('function normalizeSpeaker');
  const blk = tel.slice(i, i + 600);
  assert.ok(/SPEAKER\[_\\s-\]/.test(blk), 'нет разбора SPEAKER_NN');
  assert.ok(/\^\\d\+\$/.test(blk), 'нет разбора числовой строки');
  assert.ok(/return null/.test(blk), 'нет нейтрального фолбэка (null)');
});

test('T4', 'в UI нет жёсткого «иначе Клиент»', () => {
  assert.ok(!/speaker === 0 \|\| speaker === '0'\) \? 'Менеджер' : 'Клиент'/.test(tel),
    'остался старый маппинг Менеджер/Клиент');
});

test('T5', 'сегменты рендерят подписи из данных звонка, а не «Клиент»', () => {
  const i = tel.indexOf('segs.forEach(function(seg)');
  const blk = tel.slice(i, i + 1600);
  assert.ok(/normalizeSpeaker\(seg\)/.test(blk), 'speaker не нормализуется');
  assert.ok(/call\.manager_name/.test(blk), 'нет ФИО оператора в подписи');
  assert.ok(/call\.caller_company \|\| call\.caller_name/.test(blk), 'нет имени клиента в подписи');
  assert.ok(/data-start=/.test(blk) && /startAttr/.test(blk), 'таймкод не нормализован через parseSec');
});

// ── API identity ──
test('T6', 'GET /calls/:id подмешивает caller_name/caller_company', () => {
  const js = read('src/routes/telephony.js');
  const i = js.indexOf("fastify.get('/calls/:id'");
  const blk = js.slice(i, i + 2600);
  assert.ok(/enrichCallRows\(db, \[call\]\)/.test(blk), 'нет enrichCallRows в карточке');
  assert.ok(/call\.caller_name =/.test(blk), 'caller_name не проставляется');
  assert.ok(/call\.caller_company =/.test(blk), 'caller_company не проставляется');
});

// ── Тема списка звонков ──
test('T7', 'список звонков theme-aware (нет #000 / #38383A / #3A3A3C)', () => {
  const css = read('public/assets/css/phone.css');
  const i = css.indexOf('.ph-dp--ios {');
  const blk = css.slice(i, i + 4200);
  assert.ok(/\.ph-dp--ios \{[\s\S]{0,120}var\(--hg-panel/.test(blk), '.ph-dp--ios не использует --hg-panel');
  assert.ok(!/background:\s*#000;/.test(blk), 'остался #000 фон');
  assert.ok(!/#38383A/.test(blk), 'остались тёмные границы #38383A');
  assert.ok(!/#3A3A3C/.test(blk), 'остался тёмный аватар #3A3A3C');
  assert.ok(!/text-shadow:\s*0 0 2px #000/.test(blk), 'остался text-shadow под чёрное');
  assert.ok(/var\(--hg-elev/.test(blk), 'аватар не привязан к --hg-elev');
  assert.ok(/var\(--hg-text/.test(blk), 'текст не привязан к --hg-text');
});

test('T8', 'CSS субтитров имеет классы --2/--3/--u', () => {
  const css = read('public/assets/css/telephony-page.css');
  assert.ok(/transcript-seg-speaker--2/.test(css), 'нет --2');
  assert.ok(/transcript-seg-speaker--3/.test(css), 'нет --3');
  assert.ok(/transcript-seg-speaker--u/.test(css), 'нет нейтрального --u');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
