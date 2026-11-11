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

check('ТВ: использует общий профиль (три слоя, потолок 720p)', () => {
  /* D-192: локальная копия профиля удалена — теперь из ting_media_profile.js.
     Три слоя (q/h/f) и потолок 720p проверяются там же, на общем модуле. */
  assert(/TingMediaProfile/.test(tv), 'ТВ не использует общий модуль');
  assert(/buildPublishDefaults\(LK,\s*\{\s*maxHeight:\s*720\s*\}\)/.test(tv),
    'ТВ не задаёт потолок 720p');
  const moduleSrc = fs.readFileSync(path.join(root, 'public/assets/js/ting_media_profile.js'), 'utf8');
  const pushes = (moduleSrc.match(/layers\.push/g) || []).length;
  assert(pushes === 3, 'в общем модуле не три слоя, а ' + pushes);
  assert(!/h2160/.test(moduleSrc), 'общий модуль тянет 4K-пресет');
});

check('ТВ: degradationPreference и H264 — в общем модуле', () => {
  const moduleSrc = fs.readFileSync(path.join(root, 'public/assets/js/ting_media_profile.js'), 'utf8');
  assert(/degradationPreference:\s*'maintain-resolution'/.test(moduleSrc),
    'нет maintain-resolution');
  assert(/videoCodec:\s*h264Supported\(\)\s*\?\s*'h264'\s*:\s*'vp8'/.test(moduleSrc),
    'videoCodec не выбирается по поддержке');
  /* Проверяем внутри buildPublishDefaults: мутация именно там, и
     поиск по всему файлу её пропускал (слово встречалось в комментарии). */
  const fnIdx = moduleSrc.indexOf('function buildPublishDefaults(');
  assert(fnIdx > 0, 'buildPublishDefaults не найден');
  const fnBody = moduleSrc.slice(fnIdx, fnIdx + 900);
  assert(/backupCodec:\s*false/.test(fnBody), 'backupCodec не выключен в buildPublishDefaults');
  assert(/degradationPreference:\s*'maintain-resolution'/.test(fnBody),
    'maintain-resolution не в buildPublishDefaults');
  assert(/videoCodec:\s*h264Supported\(\)/.test(fnBody),
    'videoCodec не выбирается в buildPublishDefaults');
  /* Значение не должно попасть внутрь videoEncoding — там только битрейт.
     videoEncoding присваивается после объекта defaults, ищем по всему телу. */
  const vIdx = fnBody.indexOf('defaults.videoEncoding');
  assert(vIdx > 0, 'videoEncoding не присваивается в buildPublishDefaults');
  assert(!/degradationPreference/.test(fnBody.slice(vIdx, vIdx + 120)),
    'degradationPreference попал внутрь videoEncoding');
});

check('ТВ: setPlayoutDelay через общий модуль, в секундах', () => {
  assert(/attachPlayoutDelay/.test(tv), 'ТВ не использует attachPlayoutDelay');
  const moduleSrc = fs.readFileSync(path.join(root, 'public/assets/js/ting_media_profile.js'), 'utf8');
  assert(/setPlayoutDelay\(/.test(moduleSrc), 'модуль не вызывает setPlayoutDelay');
  assert(/typeof sec === 'number' \? sec : 0\.15/.test(moduleSrc),
    'значение задержки не в секундах');
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

check('Сервер: окно действует и на «Начать Тинг» (обход закрыт)', () => {
  /* D-193: раньше start безусловно ставил status='live', и joinWindowFor
     такие комнаты не ограничивал — окно исчезало для всех. */
  const startIdx = server.indexOf("fastify.post('/rooms/:id/start'");
  assert(startIdx > 0, 'start не найден');
  const nextRoute = server.indexOf('fastify.post(', startIdx + 10);
  const seg = server.slice(startIdx, nextRoute > 0 ? nextRoute : startIdx + 4000);
  assert(/joinWindowFor\(room\)/.test(seg), 'start не проверяет окно — обход открыт');
  assert(/ROOM_NOT_OPEN_YET/.test(seg), 'start не возвращает ROOM_NOT_OPEN_YET');
  /* Проверка окна должна идти ДО обновления статуса. */
  const winPos = seg.indexOf('joinWindowFor(room)');
  const updPos = seg.indexOf("status = 'live'");
  assert(winPos > 0 && updPos > 0, 'не найдены проверка окна или UPDATE статуса');
  assert(winPos < updPos, 'окно проверяется ПОСЛЕ установки live — обход остаётся');
});

check('Сервер: окно действует и на CRM-токен (не-хост)', () => {
  const tokIdx = server.indexOf("fastify.post('/rooms/:id/token'");
  assert(tokIdx > 0, 'CRM-токен не найден');
  const nextRoute = server.indexOf('fastify.post(', tokIdx + 10);
  const seg = server.slice(tokIdx, nextRoute > 0 ? nextRoute : tokIdx + 5000);
  assert(/isHostOrDirector/.test(seg), 'нет исключения для хоста/директора');
  assert(/joinWindowFor\(room\)/.test(seg), 'CRM-токен не проверяет окно — обход открыт');
  assert(/ROOM_NOT_OPEN_YET/.test(seg), 'CRM-токен не возвращает ROOM_NOT_OPEN_YET');
});

check('Медиа: единый профиль используется всеми тремя поверхностями', () => {
  /* D-192: три копии разошлись — CRM и гость держали пять слоёв с верхним 4K,
     из-за чего SDK выбрасывал 720p и зритель получал 360p. */
  const crm = fs.readFileSync(path.join(root, 'public/assets/js/ting_page.js'), 'utf8');
  const guest2 = fs.readFileSync(path.join(root, 'public/ting/index.html'), 'utf8');
  const tv2 = fs.readFileSync(path.join(root, 'public/ting-tv/index.html'), 'utf8');
  [['crm', crm], ['guest', guest2], ['tv', tv2]].forEach(([name, src]) => {
    assert(/TingMediaProfile/.test(src), name + ': не использует общий модуль');
    assert(/buildPublishDefaults/.test(src), name + ': не вызывает buildPublishDefaults');
  });
  /* Ни в одном месте не должно остаться 4K в профиле публикации. */
  [['crm', crm], ['guest', guest2], ['tv', tv2]].forEach(([name, src]) => {
    assert(!/h2160\.encoding/.test(src), name + ': в профиле остался 4K-битрейт');
  });
});

check('Медиа: телеметрия подключена в CRM и у гостя', () => {
  const crm = fs.readFileSync(path.join(root, 'public/assets/js/ting_page.js'), 'utf8');
  const guest2 = fs.readFileSync(path.join(root, 'public/ting/index.html'), 'utf8');
  assert(/startMetricsLoop/.test(crm), 'CRM: нет цикла телеметрии');
  assert(/collectStats/.test(crm), 'CRM: не собирает getStats');
  assert(/client-log/.test(crm), 'CRM: не отправляет метрики');
  /* Проверяем не только наличие вызова, но и что отправка НЕ заглушена. */
  assert(/if \(metricsBuffer\.length >= 12\) flushMetrics\(\);/.test(crm),
    'CRM: отправка батча заглушена — метрики не уйдут');
  assert(!/if \(false\)[^\n]*flushMetrics/.test(crm), 'CRM: flushMetrics отключён');
  assert(/startMetricsLoop\(room\);/.test(crm), 'CRM: цикл не запускается после входа');
  assert(/guestStartMetrics\(next\);/.test(guest2), 'гость: цикл не запускается');
  assert(/client-log/.test(guest2), 'гость: не отправляет метрики');
});

check('Медиа: сервер реально пишет метрики в таблицу', () => {
  /* Строгая проверка имени таблицы: `INSERT INTO thing_client_metrics_off`
     содержит искомую подстроку и раньше проходил — мутация «таблица
     переименована» выживала. */
  assert(/INSERT INTO thing_client_metrics\s*\(/.test(server),
    'client-log не делает INSERT в thing_client_metrics (проверьте имя таблицы)');
  assert(/body\.samples/.test(server), 'client-log не принимает samples[]');
  const i = server.indexOf('INSERT INTO thing_client_metrics');
  assert(i > 0, 'INSERT не найден');
  const seg = server.slice(i, i + 500);
  assert(/VALUES \(\$1/.test(seg), 'INSERT без подстановки значений');
  assert(/room_id/.test(seg), 'INSERT без room_id');
});

/* D-195: телеметрия врала нулями. `Number(null) === 0`, поэтому «нет данных»
   превращалось в 0, и отчёт показывал min_height=0 вместо реального. */
check('Медиа: нормализатор не превращает null в 0', () => {
  const i = server.indexOf('const n = (v) => {');
  assert(i > 0, 'нормализатор метрик не найден');
  const seg = server.slice(i, i + 320);
  assert(/v === null \|\| v === undefined/.test(seg),
    'нормализатор не отсекает null/undefined до Number()');
  assert(/Number\.isFinite/.test(seg), 'нормализатор не проверяет конечность');
  /* Поведенческая проверка: извлекаем функцию и прогоняем. */
  // eslint-disable-next-line no-new-func
  const n = new Function('v', seg.slice(seg.indexOf('{') + 1, seg.lastIndexOf('}')) + '; return n(v);');
  assert(n(null) === null, 'n(null) = ' + n(null) + ', ожидалось null');
  assert(n(undefined) === null, 'n(undefined) = ' + n(undefined) + ', ожидалось null');
  assert(n(720) === 720, 'n(720) = ' + n(720));
});

/* D-196: скрипт установки стоит в <head>, кнопка — в <body>. Без ожидания
   DOMContentLoaded обработчик beforeinstallprompt не регистрировался никогда.
   Проверяем ПОВЕДЕНИЕ: извлекаем init-функцию и убеждаемся, что при
   readyState='loading' она подписывается на DOMContentLoaded, а кнопка
   берётся ВНУТРИ (после DOM), а не в момент выполнения скрипта. */
check('PWA: кнопка установки инициализируется после DOM', () => {
  assert(/id="btnInstallApp"/.test(guest), 'нет кнопки установки в разметке');
  assert(/beforeinstallprompt/.test(guest), 'нет обработчика beforeinstallprompt');
  const i = guest.indexOf('function init()');
  assert(i > 0, 'нет init-функции установки');
  const seg = guest.slice(i, i + 1400);
  /* getElementById должен быть ВНУТРИ init, а не на верхнем уровне. */
  assert(/function init\(\)[\s\S]{0,300}getElementById\('btnInstallApp'\)/.test(seg),
    'кнопка берётся не внутри init — при выполнении в <head> будет null');
  /* При loading обязан ждать DOMContentLoaded. */
  assert(/readyState === 'loading'[\s\S]{0,120}addEventListener\('DOMContentLoaded'/.test(guest),
    'нет ожидания DOMContentLoaded — кнопка мертва в <head>');
  /* Иначе — немедленный вызов (скрипт мог выполниться после DOM). */
  assert(/else \{\s*init\(\);\s*\}/.test(guest) || /else init\(\)/.test(guest),
    'нет ветки немедленной инициализации');
});

/* D-195: цикл телеметрии должен гаситься на выходе, иначе он крутится по
   мёртвому PC, копит нули и отправляет их в отчёт. */
check('Медиа: явный publishTrack не обходит потолок 720p', () => {
  /* D-197: CRM и гость собирали пять слоёв вручную и передавали их в
     publishTrack поверх publishDefaults — SDK брал третий кодинг из
     фактического захвата (до 4K), и потолок 720p терялся. Верификатор
     нашёл это как предсуществующий дефект. */
  const crm = fs.readFileSync(path.join(root, 'public/assets/js/ting_page.js'), 'utf8');
  const guest2 = fs.readFileSync(path.join(root, 'public/ting/index.html'), 'utf8');

  /* Ручных пятислойных списков быть не должно ни в одном месте. */
  [['crm', crm], ['guest', guest2]].forEach(([name, src]) => {
    assert(!/videoSimulcastLayers = layers;/.test(src),
      name + ': остался ручной список слоёв в publishTrack');
    assert(!/h1440\)\s*layers\.push|h1440\)\s*opts\.videoSimulcastLayers/.test(src),
      name + ': h1440 всё ещё попадает в публикацию');
  });

  /* На пути publishTrack должен использоваться общий профиль, а не
     самодельный список. Проверяем присваивание именно из profile.layers. */
  const crmPub = crm.indexOf('publishTrack(track, pubOpts)');
  assert(crmPub > 0, 'CRM: publishTrack не найден');
  const crmSeg = crm.slice(Math.max(0, crmPub - 1600), crmPub);
  assert(/pubOpts\.videoSimulcastLayers = profile\.layers;/.test(crmSeg),
    'CRM: publishTrack не берёт слои из общего профиля');

  const guestPub = guest2.indexOf('publishTrack(localTrack');
  assert(guestPub > 0, 'гость: publishTrack не найден');
  const guestSeg = guest2.slice(Math.max(0, guestPub - 1200), guestPub);
  assert(/opts\.videoSimulcastLayers = prof\.layers;/.test(guestSeg),
    'гость: publishTrack не берёт слои из общего профиля');
});

/* D-195: цикл телеметрии должен гаситься на выходе, иначе он крутится по
   мёртвому PC, копит нули и отправляет их в отчёт. */
check('Телеметрия: цикл гасится при выходе (CRM и гость)', () => {
  const crm = fs.readFileSync(path.join(root, 'public/assets/js/ting_page.js'), 'utf8');
  assert(/async function teardownLive/.test(crm), 'teardownLive не найден');
  const tIdx = crm.indexOf('async function teardownLive');
  const tSeg = crm.slice(tIdx, tIdx + 2200);
  assert(/stopMetricsLoop\(\)/.test(tSeg), 'CRM: teardownLive не гасит телеметрию');
  assert(/guestStopMetrics\(\)/.test(guest), 'гость: нет остановки телеметрии');
  /* Проверяем именно обработчик выхода, а не только определение функции. */
  const lIdx = guest.indexOf("document.getElementById('btnLeave')");
  assert(lIdx > 0, 'обработчик выхода не найден');
  const lSeg = guest.slice(lIdx, lIdx + 900);
  assert(/guestStopMetrics\(\)/.test(lSeg), 'гость: выход не гасит телеметрию');
});

console.log('\n=== ' + (n + fails.length) + ' checks, ' + n + ' PASS, ' + fails.length + ' FAIL ===');
if (fails.length) {
  fails.forEach((f) => console.log(' -', f));
  process.exit(1);
}
