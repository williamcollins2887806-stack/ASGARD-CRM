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

// ── Этап B: стерео-склейка и третий спикер ──
test('B1', 'mergeStereo: проверка обеих дорожек + amerge + -shortest + fallback', () => {
  const js = read('src/pbx/recording.js');
  const i = js.indexOf('function mergeStereo');
  assert.ok(i !== -1, 'нет mergeStereo');
  const blk = js.slice(i, i + 2600);
  assert.ok(/spawnSync\('ffprobe'/.test(blk), 'нет проверки валидности дорожек (ffprobe)');
  assert.ok(/-shortest/.test(blk), 'amerge без -shortest теряет конец длинной дорожки');
  assert.ok(/pan=stereo\|c0=c0\|c1=c0/.test(blk), 'нет fallback одной дорожки в стерео');
  assert.ok(/inbound/.test(blk) && /outbound/.test(blk), 'нет нормализации L/R по направлению');
});

test('B2', 'dialplan пишет раздельные дорожки r()/t()', () => {
  const dp = read('ops/asterisk/extensions_asgard.conf');
  assert.ok(/MonBase|MONBASE/.test(dp), 'нет ASGARD_MONBASE');
  assert.ok(/-r\.wav/.test(dp) && /-t\.wav/.test(dp), 'нет дорожек r/t');
  assert.ok(/r\(\/var\/spool\/asterisk\/recordings\/\$\{ASGARD_MONBASE\}-r\.wav\)/.test(dp), 'нет r() дорожки');
  assert.ok(/t\(\/var\/spool\/asterisk\/recordings\/\$\{ASGARD_MONBASE\}-t\.wav\)/.test(dp), 'нет t() дорожки');
  // Флаг b обязателен (защита от MOH/ringback в записи). Опции Asterisk —
  // БЕЗ запятых между ними: b+r(...)+t(...) в одном поле options.
  assert.ok(/,br\(/.test(dp), 'нет ,br( — флаг b и r() в одном поле опций');
  assert.ok(!/,b,r\(/.test(dp), 'запятая между опциями ломает MixMonitor (r попадает в команду)');
});

test('B3', 'finalizeRecording использует стерео-путь и не теряет relUrl', () => {
  const js = read('src/pbx/recording.js');
  assert.ok(/mergeStereo\(rPath, tPath, stereoOut, direction\)/.test(js), 'нет вызова mergeStereo');
  assert.ok(/effDestPath/.test(js) && /effRelUrl/.test(js), 'нет effective путей');
  assert.ok(/return \{ destPath: effDestPath, relUrl: effRelUrl \}/.test(js), 'return не отдаёт стерео-путь');
});

test('B4', 'transcribeStereoChannels: без startTime-сортировки, секунды, offset по каналам', () => {
  const js = read('src/services/speechkit.js');
  const i = js.indexOf('transcribeStereoChannels');
  const blk = js.slice(i, i + 3200);
  assert.ok(!/a\.startTime \|\| 0\) - \(b\.startTime/.test(blk), 'осталась сортировка по несуществующему startTime');
  assert.ok(/const toSec =/.test(blk), 'нет нормализации таймкодов в секунды');
  assert.ok(/speaker: speakerIdx/.test(blk), 'speaker не числом');
});

test('B5', 'pipeline: стерео-путь только для реального стерео (ffprobe channels>=2)', () => {
  const js = read('src/services/call-pipeline.js');
  assert.ok(/stream=channels/.test(js), 'нет проверки числа каналов');
  assert.ok(/channels'[\s\S]{0,80}>= 2/.test(js) || />= 2/.test(js), 'нет условия channels>=2');
  assert.ok(/isStereo && typeof this\.speechKit\.transcribeStereoChannels/.test(js),
    'стерео-путь не защищён проверкой каналов');
});

test('B6', 'pipeline: разметка третьего спикера по времени перевода + мёртвая зона', () => {
  const js = read('src/services/call-pipeline.js');
  assert.ok(/_markTransferSpeakers/.test(js), 'нет _markTransferSpeakers');
  const i = js.indexOf('async _markTransferSpeakers');
  const blk = js.slice(i, i + 3600);
  assert.ok(/transfer_blind[\s\S]{0,60}transfer_consult/.test(blk), 'не читает переводы из pbx_call_legs');
  assert.ok(/DEAD_ZONE = 1/.test(blk), 'нет мёртвой зоны ±1 с');
  assert.ok(/seg\.speaker = idx/.test(blk), 'нет динамического индекса спикера');
});

test('B7', 'перевод персистится в pbx_call_legs (role transfer_*)', () => {
  const js = read('src/pbx/index.js');
  const i = js.indexOf("url.pathname === '/call/transfer'");
  const blk = js.slice(i, i + 9000);
  assert.ok(/INSERT INTO pbx_call_legs/.test(blk), 'перевод не пишется в pbx_call_legs');
  assert.ok(/transfer_blind|transfer_consult/.test(blk), 'неверная role перевода');
});

test('B8', 'GET /calls/:id отдаёт transfers (массив) с ФИО', () => {
  const js = read('src/routes/telephony.js');
  assert.ok(/call\.transfers = tr\.rows\.map/.test(js), 'нет массива transfers');
  assert.ok(/to_name/.test(js), 'нет ФИО получателя перевода');
});

// ── Громкость входящего звука ──
test('V1', 'core: усиление входящего через WebAudio GainNode (volume>1 невозможен в <audio>)', () => {
  const js = read('public/assets/js/phone_core.js');
  assert.ok(/function wireRemoteGain/.test(js), 'нет wireRemoteGain');
  const i = js.indexOf('function wireRemoteGain');
  const blk = js.slice(i, i + 1400);
  assert.ok(/createGain\(\)/.test(blk), 'нет GainNode');
  assert.ok(/createMediaStreamSource\(stream\)/.test(blk), 'нет источника из потока');
  assert.ok(/remoteGain\.gain\.value = remoteVolume/.test(blk), 'gain не применяется');
  assert.ok(/remoteAudio\.volume = 0/.test(blk), 'двойное воспроизведение (элемент не заглушён)');
});

test('V2', 'core: setVolume/getVolume + персистентность', () => {
  const js = read('public/assets/js/phone_core.js');
  assert.ok(/setVolume: function/.test(js), 'нет setVolume');
  assert.ok(/getVolume: function/.test(js), 'нет getVolume');
  assert.ok(/localStorage\.setItem\('asgard_phone_volume'/.test(js), 'громкость не сохраняется');
  assert.ok(/Math\.min\(3,/.test(js), 'нет ограничения максимума 3x');
});

test('V3', 'UI: регулятор громкости в панели разговора', () => {
  const js = read('public/assets/js/phone_ui.js');
  assert.ok(/id="phVolRange"/.test(js), 'нет слайдера громкости');
  assert.ok(/AsgardPhone\.setVolume/.test(js), 'слайдер не связан с API');
  const css = read('public/assets/css/phone.css');
  assert.ok(/\.ph-dp-vol-range/.test(css), 'нет CSS слайдера');
});

// ── 11.10.2026: путь r/t, фильтр сирот, цель офлайн, маска ──
test('F1', 'stereo merge ищет r/t рядом с моно (подкаталог YYYY/MM)', () => {
  const js = read('src/pbx/recording.js');
  const i = js.indexOf('let effDestPath = destPath;');
  const blk = js.slice(i, i + 1800);
  assert.ok(/path\.dirname\(sourcePath\)/.test(blk), 'не ищет дорожки рядом с исходником');
  assert.ok(/yyyy, mm/.test(blk), 'нет fallback на YYYY/MM');
});

test('F2', 'журнал скрывает сирот (Mango-плечи без записи)', () => {
  const js = read('src/routes/telephony.js');
  const i = js.indexOf("fastify.get('/calls',");
  const blk = js.slice(i, i + 2600);
  assert.ok(/ch\.call_type = 'missed'/.test(blk), 'фильтр не сохраняет пропущенные');
  assert.ok(/recording_url, ''\) <> ''/.test(blk), 'фильтр не учитывает запись');
  assert.ok(/transcript_status IN \('done', 'processing', 'pending'\)/.test(blk), 'фильтр не учитывает транскрипт');
});

test('F3', 'перевод на офлайн-цель не рвёт звонок (проверка доступности)', () => {
  const idx = read('src/pbx/index.js');
  assert.ok(/isEndpointAvailable/.test(idx), 'нет проверки доступности цели');
  const i = idx.indexOf('isEndpointAvailable');
  const blk = idx.slice(i, i + 900);
  assert.ok(/target_offline/.test(blk), 'нет reason target_offline');
  assert.ok(/send\(409/.test(blk), 'нет ответа 409 вместо сброса');
  const ami = read('src/pbx/ami-client.js');
  assert.ok(/async isEndpointAvailable/.test(ami), 'нет метода в AMI-клиенте');
  assert.ok(/PJSIPShowContacts/.test(ami), 'AMI не запрашивает контакты');
});

test('F4', 'маска: печать в конец ставит каретку в конец (+79|, не +7|9)', () => {
  const js = read('public/assets/js/phone_mask.js');
  const i = js.indexOf('function mask(el)');
  const blk = js.slice(i, i + 900);
  assert.ok(/wasAtEnd/.test(blk), 'нет определения «печать в конец»');
  assert.ok(/pos = after\.length/.test(blk), 'каретка не ставится в конец при печати');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
