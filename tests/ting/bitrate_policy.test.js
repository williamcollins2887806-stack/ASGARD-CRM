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
  assert(/buildPublishDefaults\(LK,\s*\{\s*maxHeight:\s*720,\s*simulcast:\s*false\s*\}\)/.test(tv),
    'ТВ не задаёт потолок 720p / не выключает simulcast');
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
check('Медиа: потолок 720p — ИНВАРИАНТ захвата, а не список цифр', () => {
  /* D-197e: прошлая версия проверяла чёрный список {3840,2560,1920} и
     пропускала 7680x4320 или 4096x2304. Верификатор показал это мутацией.
     Теперь инвариант: КАЖДОЕ значение ideal в constraints камеры
     не превышает 1280 по ширине и 720 по высоте — на всех поверхностях.
     SDK строит верхний simulcast-слой из ФАКТИЧЕСКОГО захвата
     (`new VideoPreset(width, height, videoEncoding)`), поэтому потолок
     держится ровно настолько, насколько ограничен захват. */
  const crm = fs.readFileSync(path.join(root, 'public/assets/js/ting_page.js'), 'utf8');
  const guest2 = fs.readFileSync(path.join(root, 'public/ting/index.html'), 'utf8');
  const tv2 = fs.readFileSync(path.join(root, 'public/ting-tv/index.html'), 'utf8');

  const MAX_W = 1280;
  const MAX_H = 720;

  /**
   * Найти все объекты-constraints камеры и проверить каждый ideal.
   * Ищем пары `width: { ideal: N }` / `height: { ideal: N }` в пределах
   * одного объекта `{ ... }` — так ловятся ЛЮБЫЕ значения, не только известные.
   */
  function checkCaptureInvariant(name, src) {
    const candidates = [];
    /* Все одиночные ideal-ширины и ideal-высоты в файле. Камера/скриншот
       различаем по контексту: ScreenShare не ограничиваем. */
    const re = /width:\s*\{\s*ideal:\s*(\d+)[^}]*\}|height:\s*\{\s*ideal:\s*(\d+)[^}]*\}/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const value = Number(m[1] || m[2]);
      const isWidth = !!m[1];
      /* Контекст: 220 символов до — если рядом ScreenShare/getDisplayMedia,
         это демонстрация экрана, её потолок другой. */
      const ctx = src.slice(Math.max(0, m.index - 220), m.index + 80);
      if (/ScreenShare|DisplayMedia|screenShare/i.test(ctx)) continue;
      candidates.push({ value, isWidth, ctx: ctx.slice(-90) });
    }
    candidates.forEach((c) => {
      if (c.isWidth && c.value > MAX_W) {
        throw new Error(name + ': ideal width ' + c.value + ' > ' + MAX_W + ' — потолок захвата нарушен');
      }
      if (!c.isWidth && c.value > MAX_H) {
        throw new Error(name + ': ideal height ' + c.value + ' > ' + MAX_H + ' — потолок захвата нарушен');
      }
    });
    return candidates.length;
  }

  const crmCount = checkCaptureInvariant('CRM', crm);
  const guestCount = checkCaptureInvariant('гость', guest2);
  const tvCount = checkCaptureInvariant('ТВ', tv2);
  assert(crmCount > 0, 'CRM: constraints камеры не найдены — проверка ничего не проверила');
  assert(guestCount > 0, 'гость: constraints камеры не найдены');
  /* ТВ использует CAPTURE_RES вместо литералов — проверяем отдельно ниже. */

  /* D-197f: каждый ideal ДОЛЖЕН иметь парный max той же величины.
     Без `max` браузер вправе отдать больше на камере без режима <=720p.
     Проверяем инвариантом: для каждого блока `ideal: N` в захвате камеры
     рядом обязан стоять `max: M`, где M <= N. */
  function checkMaxPairing(name, src) {
    const re = /(width|height):\s*\{\s*ideal:\s*(\d+)([^}]*)\}/g;
    let m;
    let checked = 0;
    while ((m = re.exec(src)) !== null) {
      const ctx = src.slice(Math.max(0, m.index - 220), m.index + 80);
      if (/ScreenShare|DisplayMedia|screenShare/i.test(ctx)) continue;
      const ideal = Number(m[2]);
      const tail = m[3] || '';
      const maxMatch = /max:\s*(\d+)/.exec(tail);
      checked += 1;
      assert(maxMatch, name + ': у ' + m[1] + ' ideal ' + ideal +
        ' нет max — браузер может отдать больше потолка');
      const max = Number(maxMatch[1]);
      assert(max <= ideal, name + ': ' + m[1] + ' max ' + max + ' > ideal ' + ideal);
    }
    return checked;
  }
  const maxPairs = checkMaxPairing('CRM', crm) + checkMaxPairing('гость', guest2);
  assert(maxPairs > 0, 'ни одного парного max не найдено — проверка не сработала');

  /* ТВ: CAPTURE_RES и cameraPresets не должны содержать 1080p/4K.
     Комментарии вырезаем: в них допустимо объяснять, ПОЧЕМУ резерв убран. */
  const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  const capIdx = tv2.indexOf('var CAPTURE_RES');
  assert(capIdx > 0, 'ТВ: CAPTURE_RES не найден');
  const capSeg = stripComments(tv2.slice(capIdx, capIdx + 500));
  assert(!/h1080|h1440|h2160/.test(capSeg),
    'ТВ: CAPTURE_RES содержит резерв 1080p/4K — потолок пробивается');
  const presetsIdx = tv2.indexOf('function cameraPresets');
  assert(presetsIdx > 0, 'ТВ: cameraPresets не найден');
  const presetsSeg = stripComments(tv2.slice(presetsIdx, presetsIdx + 700));
  assert(!/h1080|h1440|h2160/.test(presetsSeg),
    'ТВ: cameraPresets содержит 1080p/4K — резервный пресет пробьёт потолок');

  /* HD-гейты должны иметь ПОРОГ, а не просто существовать. */
  assert(/width\) \|\| 0\) >= 1280/.test(guest2), 'гость: HD-гейт без порога 1280');
  assert(/height\) \|\| 0\) >= 720/.test(guest2), 'гость: HD-гейт без порога 720');
  assert(/w >= 1280/.test(crm), 'CRM: HD-гейт без порога 1280');
  assert(/h >= 720/.test(crm), 'CRM: HD-гейт без порога 720');

  /* Пресет публикации у гостя и CRM тоже не должен подниматься выше 720p:
     захват ограничен, но если пресет потребует 1080p, браузер может отдать
     больше при «ideal» (он не гарантирует точное значение). */
  const guestPreset = guest2.slice(
    guest2.indexOf('var presetOpts = {}'),
    guest2.indexOf('var presetOpts = {}') + 900
  );
  assert(guestPreset.length > 100, 'гость: блок пресета публикации не найден');
  assert(!/h2160|h1440|h1080/.test(stripComments(guestPreset)),
    'гость: пресет публикации просит 1080p/4K');

  const crmPreset = crm.slice(
    crm.indexOf('function cameraConstraintsList'),
    crm.indexOf('function cameraConstraintsList') + 1800
  );
  assert(!/h2160|h1440|h1080/.test(stripComments(crmPreset)),
    'CRM: constraints просят 1080p/4K');
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
  /* Проверяем ВСЕ пути выхода, а не только btnLeave: раньше мутация в ветке
     исчерпания реконнекта выживала, потому что тест смотрел лишь на кнопку. */
  const lIdx = guest.indexOf("document.getElementById('btnLeave')");
  assert(lIdx > 0, 'обработчик выхода не найден');
  const lSeg = guest.slice(lIdx, lIdx + 900);
  assert(/guestStopMetrics\(\)/.test(lSeg), 'гость: выход не гасит телеметрию');

  /* Ветка исчерпания реконнекта: между очисткой chatPollId и show('ended'). */
  const reIdx = guest.indexOf('reconnectAttempts > RECONNECT_MAX');
  const reSeg = reIdx > 0
    ? guest.slice(reIdx, reIdx + 2600)
    : guest.slice(guest.indexOf('if (reconnectAttempts < RECONNECT_MAX)'));
  const cIdx = reSeg.indexOf("if (chatPollId) clearInterval(chatPollId);");
  assert(cIdx > 0, 'ветка исчерпания реконнекта не найдена');
  const after = reSeg.slice(cIdx, cIdx + 700);
  assert(/guestStopMetrics\(\)/.test(after),
    'гость: ветка исчерпания реконнекта не гасит телеметрию');
});

/* ===== Регрессы раунда 3 ===== */

/* participant в LocalTrackPublished: его там нет — ReferenceError рвал
   обработчик и оставлял меню висеть. */
check('CRM: LocalTrackPublished не ссылается на participant', () => {
  const crm = fs.readFileSync(path.join(root, 'public/assets/js/ting_page.js'), 'utf8');
  const i = crm.indexOf('RoomEvent.LocalTrackPublished, (pub)');
  assert(i > 0, 'обработчик LocalTrackPublished не найден');
  const seg = crm.slice(i, i + 1600);
  assert(!/bumpPublicationQuality\(pub,\s*participant\)/.test(seg),
    'в LocalTrackPublished остался participant (ReferenceError)');
  assert(/bumpPublicationQuality\(pub,\s*lp\)/.test(seg),
    'LocalTrackPublished не передаёт localParticipant');
});

/* ТВ: autoplay без play() не стартует в Android WebView — серый «плей». */
check('ТВ: видео стартует явным play() после attach', () => {
  assert(/track\.attach\(video\)/.test(tv), 'attach(video) не найден');
  assert(/video\.play\(\)\.catch/.test(tv), 'нет явного play() — возможен серый плей');
});

/* Микрофон ТВ: опираться на isMicrophoneEnabled нельзя — у трека, созданного
   напрямую, source может быть unknown, и геттер врёт «выключен». */
check('ТВ: микрофон судится по публикации, а не по isMicrophoneEnabled', () => {
  const i = tv.indexOf('function micIsPublishing');
  assert(i > 0, 'micIsPublishing не найден');
  /* Комментарии выкидываем: в них встречаются те же слова, и проверка
     «mute раньше liveness» ложно проходила бы по тексту комментария. */
  const seg = tv.slice(i, i + 1100).replace(/\/\*[\s\S]*?\*\//g, '');
  assert(!/isMicrophoneEnabled === false/.test(seg),
    'micIsPublishing всё ещё отвергает живой трек по isMicrophoneEnabled');
  /* Ищем именно проверку ПУБЛИКАЦИИ: `info.pub.isMuted`. Простой поиск
     'isMuted === true' находил подстроку внутри 'track.isMuted === true',
     и тест ложно проходил при удалённой проверке публикации. */
  const muteIdx = seg.indexOf('info.pub.isMuted === true');
  const trackMuteIdx = seg.indexOf('track.isMuted === true');
  const liveIdx = seg.indexOf('info.live');
  assert(muteIdx > 0, 'micIsPublishing не проверяет isMuted публикации');
  /* Обе проверки обязательны: публикация может не нести isMuted, а трек —
     нести. Одна без другой оставляет путь, где мьют невидим. */
  assert(trackMuteIdx > 0, 'micIsPublishing не проверяет isMuted трека');
  assert(liveIdx > 0, 'micIsPublishing не проверяет живой трек');
  assert(muteIdx < liveIdx, 'проверка isMuted стоит ПОСЛЕ liveness — она мёртвая');
  assert(trackMuteIdx < liveIdx, 'проверка mute трека стоит после liveness');
});

check('ТВ: audioCaptureDefaults с AEC/NS/AGC', () => {
  const i = tv.indexOf('var roomOpts = {');
  assert(i > 0, 'roomOpts не найден');
  const seg = tv.slice(i, i + 900);
  /* Проверяем реальный ключ, а не упоминание: мутация «переименовать ключ»
     должна ловиться. */
  const k = seg.indexOf('audioCaptureDefaults:');
  assert(k > 0, 'в roomOpts нет ключа audioCaptureDefaults');
  const block = seg.slice(k, k + 300);
  assert(/echoCancellation:\s*true/.test(block), 'audioCaptureDefaults без echoCancellation');
  assert(/noiseSuppression:\s*true/.test(block), 'audioCaptureDefaults без noiseSuppression');
  assert(/autoGainControl:\s*true/.test(block), 'audioCaptureDefaults без autoGainControl');
});

check('ТВ: конструктор LocalAudioTrack без выдуманного 3-го аргумента', () => {
  assert(!/new LK\.LocalAudioTrack\(mst, undefined, false\)/.test(tv),
    'третий аргумент конструктора вернулся');
});

/* Гость: без AEC/NS близко стоящие устройства слышат друг друга (писк). */
check('Гость: микрофон публикуется с AEC/NS/AGC', () => {
  assert(!/setMicrophoneEnabled\(localAudio\);/.test(guest),
    'гость публикует микрофон без настроек (писк и эхо)');
  /* КАЖДЫЙ вызов setMicrophoneEnabled обязан нести полный набор флагов —
     иначе одна забытая ветка возвращает эхо. */
  const calls = guest.split('setMicrophoneEnabled(').slice(1);
  assert(calls.length >= 2, 'вызовов setMicrophoneEnabled меньше двух');
  calls.forEach((seg, i) => {
    const body = seg.slice(0, 260);
    assert(/echoCancellation:\s*true/.test(body), 'вызов #' + (i + 1) + ': нет echoCancellation');
    assert(/noiseSuppression:\s*true/.test(body), 'вызов #' + (i + 1) + ': нет noiseSuppression');
    assert(/autoGainControl:\s*true/.test(body), 'вызов #' + (i + 1) + ': нет autoGainControl');
  });
  /* И дефолты комнаты — для путей, которые публикуют через SDK. */
  const i = guest.indexOf('audioCaptureDefaults');
  assert(i > 0, 'у гостя нет audioCaptureDefaults');
  const block = guest.slice(i, i + 260);
  assert(/echoCancellation:\s*true/.test(block), 'audioCaptureDefaults без echoCancellation');
  assert(/noiseSuppression:\s*true/.test(block), 'audioCaptureDefaults без noiseSuppression');
});

/* adaptiveStream запрещает ручную смену качества — на десктопе просим HIGH,
   значит adaptive там должен быть выключен. */
check('Гость: adaptive и ручной HIGH не конфликтуют', () => {
  assert(/adaptiveStream:\s*smallEarly/.test(guest),
    'adaptiveStream не привязан к типу устройства');
  assert(/!smallEarly\s*&&\s*pub/.test(guest),
    'ручной HIGH не защищён от adaptive');
});

/* Размытие/виртуальные фоны отключены: MediaPipe ронял FPS и тёк кадрами. */
check('Эффекты фона удалены (UI и загрузка процессоров)', () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  const crm = strip(fs.readFileSync(path.join(root, 'public/assets/js/ting_page.js'), 'utf8'));
  const g = strip(guest);
  assert(!/TING_BG_PRESETS/.test(crm), 'в CRM остались пресеты фона');
  assert(!/VirtualBackground/.test(crm), 'в CRM остался VirtualBackground');
  assert(!/ting-bg-effects/.test(crm), 'CRM всё ещё грузит бандл эффектов');
  assert(!/guestBgGrid/.test(g), 'у гостя осталась сетка фонов');
  assert(!/data-bg=/.test(g), 'у гостя остались кнопки фонов');
});

/* Плитки галереи ТВ держат 16:9 во всех режимах. Стратегия разная:
   g3 ограничиваем по высоте (ячейка шире кадра), g4/g5 по ширине (уже). */
check('ТВ: галерея 16:9 без растяжения, видео contain', () => {
  const css = fs.readFileSync(path.join(root, 'public/assets/css/ting-tv.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  /* g4/g5: ширина ячейки, высота из aspect-ratio. height:100% здесь сломал бы. */
  const g45 = /\.ttv-stage\.hall-g4[^{]*\{[^}]*aspect-ratio:\s*16\s*\/\s*9[^}]*width:\s*100%[^}]*height:\s*auto/.test(css);
  assert(g45, 'g4/g5 не держат пару width:100% + height:auto');
  assert(!/\.ttv-stage\.hall-g4[^{]*\{[^}]*max-width:\s*100%/.test(css),
    'g4/g5 вернули max-width — он ломает 16:9');
  /* g3: ячейка шире кадра, ограничивает высота. */
  const g3 = /\.ttv-stage\.hall-g3[^{]*\{[^}]*aspect-ratio:\s*16\s*\/\s*9[^}]*height:\s*100%[^}]*width:\s*auto/.test(css);
  assert(g3, 'g3 не ограничивает плитку по высоте');
  assert(/\.ttv-tile video\s*\{[^}]*object-fit:\s*contain/.test(css),
    'видео снова cover — лицо обрезается');
});

/* ===== Раунд 4: ТВ-стабильность ===== */

/* Телеметрия ТВ: раньше её не было вообще, и о телеке знали только по
   жалобам. Проверяем, что отправка существует и помечена surface='tv'. */
check('ТВ: отправляет телеметрию с surface=tv', () => {
  assert(/function tvStartMetrics/.test(tv), 'нет tvStartMetrics');
  assert(/surface:\s*'tv'/.test(tv), 'метрики ТВ не помечены surface=tv');
  assert(/tvStartMetrics\(next\)/.test(tv), 'tvStartMetrics не вызывается при входе');
  assert(/tvStopMetrics\(\)/.test(tv), 'метрики ТВ не гасятся при выходе');
});

/* adaptiveStream: при нём SDK блокирует ручной setVideoQuality. Если
   выключить adaptive, а ручные вызовы не вернуть — плитки будут тянуть
   слой по умолчанию; если вернуть ручные при adaptive — они игнорируются
   с предупреждением. Пара должна быть согласована. */
check('ТВ: adaptiveStream включён и ручных setVideoQuality нет', () => {
  assert(/adaptiveStream:\s*true/.test(tv), 'adaptiveStream не включён на ТВ');
  const code = tv.replace(/\/\*[\s\S]*?\*\//g, '');
  assert(!/\.setVideoQuality\s*\(/.test(code),
    'на ТВ остались ручные setVideoQuality — при adaptive они игнорируются');
});

/* packetsLost — накопительный счётчик. Если слать как есть, в каждой строке
   одно и то же число (было 915 у user_1), и метрика бесполезна. */
check('packets_lost шлётся дельтой, а не накопительно', () => {
  const mod = fs.readFileSync(path.join(root, 'public/assets/js/ting_media_profile.js'), 'utf8');
  assert(/lastPacketsLost/.test(mod), 'нет учёта предыдущего значения packetsLost');
  assert(/s\.packetsLost - prevLost/.test(mod), 'packetsLost не переводится в дельту');
});

/* Эхо: звук удалённого участника идёт из <audio>-sink. Если <video> тоже
   звучит, один голос играет дважды с рассинхроном. Проверяем КОНКРЕТНОЕ
   место создания удалённого видео в TrackSubscribed. */
check('Удалённое видео приглушено (нет двойного звука)', () => {
  const crm = fs.readFileSync(path.join(root, 'public/assets/js/ting_page.js'), 'utf8');
  const i = crm.indexOf('RoomEvent.TrackSubscribed');
  assert(i > 0, 'обработчик TrackSubscribed не найден');
  /* Комментарии выкидываем — иначе проверка читает текст, а не код. */
  const seg = crm.slice(i, i + 1600).replace(/\/\*[\s\S]*?\*\//g, '');
  const vIdx = seg.indexOf('v.playsInline = true');
  assert(vIdx > 0, 'создание видео в TrackSubscribed не найдено');
  const near = seg.slice(vIdx, vIdx + 700);
  assert(/v\.muted = true/.test(near), 'удалённое видео снова звучит — двойной звук');
  assert(!/v\.muted = false/.test(near), 'удалённое видео снова muted=false');
});

/* Модалка выхода: раньше закрывалась только кнопкой. */
check('Модалка выхода закрывается по фону и Escape', () => {
  const crm = fs.readFileSync(path.join(root, 'public/assets/js/ting_page.js'), 'utf8');
  assert(/if \(ev\.target === modal\) \{ closeHostEnd\(\); return; \}/.test(crm),
    'клик по затемнению не закрывает модалку');
  assert(/Escape/.test(crm) && /document\.addEventListener\('keydown', onKey\)/.test(crm),
    'Escape не закрывает модалку');
});

/* Фантомный участник: сверка состава комнаты с плитками. */
check('Реконсиляция плиток с составом комнаты', () => {
  const crm = fs.readFileSync(path.join(root, 'public/assets/js/ting_page.js'), 'utf8');
  assert(/function reconcileTilesWithRoom/.test(crm), 'нет reconcileTilesWithRoom');
  assert(/startRosterReconcileLoop/.test(crm), 'нет периодической сверки');
  assert(/30000/.test(crm), 'сверка не раз в 30 секунд');
});

/* Живой muted-трек не подменяется аватаром: иначе на ноуте «камера
   выключена», хотя видео есть. */
check('trackIsLive отдаёт живой трек даже при isMuted', () => {
  const core = fs.readFileSync(path.join(root, 'public/assets/js/ting_room_core.js'), 'utf8');
  const i = core.indexOf('function trackIsLive');
  assert(i > 0, 'trackIsLive не найден');
  const seg = core.slice(i, i + 700);
  const mediaIdx = seg.indexOf('mediaTrackLive(pub.track)');
  const muteIdx = seg.indexOf('isMuted === true');
  assert(mediaIdx > 0 && muteIdx > 0, 'нет проверок трека/mute');
  assert(mediaIdx < muteIdx, 'mute проверяется ДО трека — живой трек снова гаснет');
});

console.log('\n=== ' + (n + fails.length) + ' checks, ' + n + ' PASS, ' + fails.length + ' FAIL ===');
if (fails.length) {
  fails.forEach((f) => console.log(' -', f));
  process.exit(1);
}
