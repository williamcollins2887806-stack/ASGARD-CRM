#!/usr/bin/env node
/**
 * D-184 / D-189 / D-190: политика качества видео и общие инварианты.
 * Проверки ОКНА ВХОДА живут в join_window.behavior.test.js — они там
 * поведенческие (функции исполняются), а не текстовые.
 *
 * Run: node tests/ting/bitrate_policy.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const tv = fs.readFileSync(path.join(root, 'public/ting-tv/index.html'), 'utf8');
const guest = fs.readFileSync(path.join(root, 'public/ting/index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'src/routes/thing.js'), 'utf8');

let n = 0;
const fails = [];
function check(name, fn) {
  try {
    fn();
    n += 1;
    console.log('PASS', name);
  } catch (e) {
    fails.push(name + ': ' + e.message);
    console.log('FAIL', name, '—', e.message);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

check('ТВ: потолок захвата 720p (нет h2160/h1440 в CAPTURE_RES)', () => {
  const i = tv.indexOf('var CAPTURE_RES');
  assert(i > 0, 'CAPTURE_RES не найден');
  const seg = tv.slice(i, i + 700);
  assert(!/h2160/.test(seg), 'CAPTURE_RES всё ещё берёт h2160');
  assert(!/h1440/.test(seg), 'CAPTURE_RES всё ещё берёт h1440');
  assert(/h720/.test(seg), 'CAPTURE_RES не использует h720 как потолок');
});

check('ТВ: cameraPresets не предлагает 4K/1440', () => {
  const i = tv.indexOf('function cameraPresets');
  assert(i > 0, 'cameraPresets не найден');
  const seg = tv.slice(i, i + 600);
  assert(!/h2160/.test(seg), 'cameraPresets всё ещё содержит h2160');
  assert(!/h1440/.test(seg), 'cameraPresets всё ещё содержит h1440');
});

check('ТВ: ровно три слоя simulcast (SDK публикует максимум q/h/f)', () => {
  const i = tv.indexOf('var layers = []');
  assert(i > 0, 'блок layers не найден');
  const seg = tv.slice(i, i + 400);
  const pushes = (seg.match(/layers\.push/g) || []).length;
  assert(pushes === 3, 'слоёв ' + pushes + ', ожидалось 3');
});

check('ТВ: degradationPreference в publish-опциях, НЕ в videoEncoding', () => {
  assert(/degradationPreference:\s*'maintain-resolution'/.test(tv),
    'degradationPreference не задан как maintain-resolution');
  const i = tv.indexOf('videoEncoding:');
  assert(i > 0, 'videoEncoding не найден');
  const near = tv.slice(i, i + 200);
  assert(!/degradationPreference/.test(near),
    'degradationPreference попал внутрь videoEncoding');
});

check('ТВ: H264 только при поддержке + backupCodec выключен', () => {
  assert(/function h264Supported\(\)/.test(tv), 'нет capability-check h264Supported');
  assert(/RTCRtpSender\.getCapabilities/.test(tv), 'capability-check не использует getCapabilities');
  assert(/videoCodec:\s*h264Supported\(\)\s*\?\s*'h264'\s*:\s*'vp8'/.test(tv),
    'videoCodec не выбирается по поддержке');
  assert(/backupCodec:\s*false/.test(tv), 'backupCodec не выключен (два кодека параллельно)');
});

check('ТВ: setPlayoutDelay на треке в СЕКУНДАХ, не опция Room', () => {
  assert(/track\.setPlayoutDelay\(/.test(tv), 'setPlayoutDelay не вызывается на треке');
  assert(!/playoutDelay:\s*\{/.test(tv), 'playoutDelay всё ещё передаётся как опция Room');
  const i = tv.indexOf('playoutDelaySec:');
  assert(i > 0, 'playoutDelaySec не найден');
  const seg = tv.slice(i, i + 40);
  assert(/0\.\d+/.test(seg), 'значение задержки не в секундах: ' + seg);
});

check('ТВ: микрофон публикуется из getUserMedia + LocalAudioTrack', () => {
  const i = tv.indexOf('async function publishMicOnce');
  assert(i > 0, 'publishMicOnce не найден');
  const seg = tv.slice(i, i + 4000);
  assert(/getUserMedia\(/.test(seg), 'нет getUserMedia в публикации микрофона');
  assert(/LocalAudioTrack/.test(seg), 'нет LocalAudioTrack');
  assert(/publishTrack\(/.test(seg), 'нет publishTrack');
});

check('ТВ: canPlaybackAudio читается как геттер, не как метод', () => {
  const bad = /typeof [a-zA-Z_.]*canPlaybackAudio === 'function'/;
  assert(!bad.test(tv), 'ТВ вызывает canPlaybackAudio как метод');
  assert(!bad.test(guest), 'гость вызывает canPlaybackAudio как метод');
});

check('ТВ: collectStats разделяет publisher и subscriber', () => {
  const i = tv.indexOf('async function collectStats');
  assert(i > 0, 'collectStats не найден');
  const seg = tv.slice(i, i + 2600);
  assert(/pubPc/.test(seg) && /subPc/.test(seg), 'нет разделения pub/sub PC');
  assert(/isPub && s\.type === 'outbound-rtp'/.test(seg),
    'qualityLimitationReason не привязан к publisher');
  assert(/!isPub && s\.type === 'inbound-rtp'/.test(seg),
    'потери/фризы не привязаны к subscriber');
});

check('Сервер: окно входа считается одной функцией joinWindowFor', () => {
  /* Инвариант: охранник и метаданные берут окно из одного места.
     Метаданные теперь собирает publicRoomMeta, который зовёт joinWindowFor. */
  assert(/function joinWindowFor\(room\)/.test(server), 'нет joinWindowFor');
  const guardIdx = server.indexOf('function publicRoomUnavailable');
  const guardSeg = server.slice(guardIdx, guardIdx + 2500);
  assert(/joinWindowFor\(room\)/.test(guardSeg), 'охранник не использует joinWindowFor');
  const metaFnIdx = server.indexOf('function publicRoomMeta(');
  assert(metaFnIdx > 0, 'нет publicRoomMeta');
  const metaFnSeg = server.slice(metaFnIdx, metaFnIdx + 900);
  assert(/joinWindowFor\(room\)/.test(metaFnSeg), 'publicRoomMeta не использует joinWindowFor');
  const routeIdx = server.indexOf("fastify.get('/public/:code'");
  const routeSeg = server.slice(routeIdx, routeIdx + 2000);
  assert(/publicRoomMeta\(room, recordingActive\)/.test(routeSeg),
    'обработчик метаданных не вызывает publicRoomMeta');
});

check('Сервер: guest-token через ON CONFLICT с сохранением rejected', () => {
  const gi = server.indexOf("fastify.post('/public/:code/guest-token'");
  assert(gi > 0, 'guest-token не найден');
  const nextRoute = server.indexOf('fastify.post(', gi + 10);
  const seg = server.slice(gi, nextRoute > 0 ? nextRoute : gi + 6000);
  assert(/ON CONFLICT \(room_id, identity\) DO UPDATE SET/.test(seg),
    'нет ON CONFLICT — duplicate_record вернётся');
  assert(/'rejected'/.test(seg), 'rejected не упоминается в guest-token');
  assert(/RETURNING id/.test(seg), 'нет RETURNING id');
});

console.log('\n=== ' + (n + fails.length) + ' checks, ' + n + ' PASS, ' + fails.length + ' FAIL ===');
if (fails.length) {
  fails.forEach((f) => console.log(' -', f));
  process.exit(1);
}
