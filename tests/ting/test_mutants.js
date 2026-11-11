#!/usr/bin/env node
/**
 * Мутационная проверка тестов: ломаем код и убеждаемся, что тест КРАСНЕЕТ.
 * Если тест зелёный на сломанном коде — он бесполезен.
 *
 * Урок раунда 4: первая версия копировала весь public/ (700 МБ на мутанта) и
 * заменяла ПЕРВОЕ вхождение строки, попадая в чужой обработчик. Теперь:
 *   • копируем только нужные файлы (src/routes/thing.js, public/ting-tv,
 *     public/ting, public/assets/js/ting_page.js, tests/);
 *   • замену делаем по ЯКОРЮ (offset/уникальный контекст), а не «первое вхождение»;
 *   • строки нормализуем по EOL, чтобы не зависеть от CRLF/LF.
 *
 * Run: node tests/ting/test_mutants.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '../..');
const THING = 'src/routes/thing.js';
const TV = 'public/ting-tv/index.html';

const FILES = [
  THING,
  TV,
  'public/ting/index.html',
  'public/assets/js/ting_page.js',
  'public/assets/js/ting_media_profile.js',
  'tests/ting/join_window.behavior.test.js',
  'tests/ting/bitrate_policy.test.js'
];

/**
 * Мутация: заменяем from→to, но только если from встречается РОВНО один раз
 * либо задан anchor (уникальный фрагмент, после которого искать).
 */
const MUTANTS = [
  {
    name: 'окно выключено целиком (return null в publicRoomUnavailable)',
    file: THING,
    from: 'function publicRoomUnavailable(room, reply, opts) {',
    to: 'function publicRoomUnavailable(room, reply, opts) {\n    return null;'
  },
  {
    name: 'joinWindowFor всегда говорит «окно применимо» (instant/живые ломаются)',
    file: THING,
    from: "if (String(room.mode || 'instant') !== 'scheduled') return res;",
    to: "if (false) return res;"
  },
  {
    name: 'живая комната снова блокируется (status-проверка убрана)',
    file: THING,
    from: "if (String(room.status || '') !== 'scheduled') return res;",
    to: 'if (false) return res;'
  },
  {
    name: 'EARLY_JOIN_MS 60 мин → 8 часов',
    file: THING,
    from: 'const EARLY_JOIN_MS = 60 * 60 * 1000;',
    to: 'const EARLY_JOIN_MS = 8 * 60 * 60 * 1000;'
  },
  {
    name: 'skipWindow больше не снимает окно (гость не увидит название)',
    file: THING,
    from: 'if (skipWindow) return null;',
    to: 'if (false) return null;'
  },
  {
    name: 'guest-token получает skipWindow (окно не работает для гостей)',
    file: THING,
    anchor: "fastify.post('/public/:code/guest-token'",
    from: 'publicRoomUnavailable(room, reply);',
    to: 'publicRoomUnavailable(room, reply, { skipWindow: true });'
  },
  {
    name: 'upsert гостя убран (D-183 возвращается)',
    file: THING,
    anchor: "fastify.post('/public/:code/guest-token'",
    from: 'ON CONFLICT (room_id, identity) DO UPDATE SET',
    to: '/* mutated */ SET'
  },
  {
    name: 'rejected не сохраняется (кик обходится)',
    file: THING,
    anchor: "fastify.post('/public/:code/guest-token'",
    from: "WHEN thing_participants.lobby_status = 'rejected' THEN 'rejected'",
    to: "WHEN false THEN 'rejected'"
  },
  {
    name: 'withTimeout гасит поток на успехе (микрофон ломается)',
    file: TV,
    from: "if (timedOut && typeof onLate === 'function') {",
    to: "if (typeof onLate === 'function') {"
  },
  {
    name: 'CAPTURE_RES снова 4K',
    file: TV,
    from: 'if (LK.VideoPresets.h720) return LK.VideoPresets.h720.resolution;',
    to: 'if (LK.VideoPresets.h2160) return LK.VideoPresets.h2160.resolution;'
  },
  {
    name: 'canPlaybackAudio снова вызывается как метод',
    file: TV,
    from: "(typeof r.canPlaybackAudio === 'boolean') ? r.canPlaybackAudio : true",
    to: "typeof r.canPlaybackAudio === 'function' ? r.canPlaybackAudio() : true"
  },
  {
    name: 'join_open всегда true (расхождение с окном)',
    file: THING,
    from: 'join_open: !win.applies || now >= win.opensAt',
    to: 'join_open: true'
  },
  {
    name: 'join_open удалён из метаданных',
    file: THING,
    from: 'join_open: !win.applies || now >= win.opensAt',
    to: 'join_open_unused: true'
  },
  {
    name: 'publicRoomMeta не использует окно (свой расчёт)',
    file: THING,
    anchor: 'function publicRoomMeta(',
    from: 'const win = joinWindowFor(room);',
    to: "const win = { applies: false, opensAt: null, startsAt: null };"
  },
  {
    name: 'opens_at обнулён (поле потеряно)',
    file: THING,
    from: 'opens_at: opensAt ? opensAt.toISOString() : null,',
    to: 'opens_at: null,'
  },
  {
    name: 'scheduled_at обнулён',
    file: THING,
    from: 'scheduled_at: scheduledAt ? scheduledAt.toISOString() : null,',
    to: 'scheduled_at: null,'
  },
  {
    name: 'mode потерян (всегда instant)',
    file: THING,
    anchor: 'function publicRoomMeta(',
    from: "mode: room.mode || 'instant',",
    to: "mode: 'instant',"
  },
  {
    name: 'recording_active всегда true',
    file: THING,
    anchor: 'function publicRoomMeta(',
    from: 'recording_active: !!recordingActive,',
    to: 'recording_active: true,'
  },
  {
    name: 'slug потерян',
    file: THING,
    anchor: 'function publicRoomMeta(',
    from: 'slug: room.slug,',
    to: 'slug: null,'
  },
  {
    name: 'title потерян',
    file: THING,
    anchor: 'function publicRoomMeta(',
    from: 'title: room.title,',
    to: 'title: null,'
  },
  {
    name: 'status потерян',
    file: THING,
    anchor: 'function publicRoomMeta(',
    from: 'status: room.status,',
    to: 'status: null,'
  },
  {
    name: 'dial_code потерян',
    file: THING,
    anchor: 'function publicRoomMeta(',
    from: 'dial_code: room.dial_code || null,',
    to: 'dial_code: null,'
  },
  {
    name: 'lobby_enabled потерян',
    file: THING,
    anchor: 'function publicRoomMeta(',
    from: 'lobby_enabled: room.lobby_enabled,',
    to: 'lobby_enabled: false,'
  },
  {
    name: 'pin_required всегда false',
    file: THING,
    anchor: 'function publicRoomMeta(',
    from: 'pin_required: Boolean(room.pin_code),',
    to: 'pin_required: false,'
  },
  {
    name: 'locked всегда false',
    file: THING,
    anchor: 'function publicRoomMeta(',
    from: 'locked: Boolean(room.locked),',
    to: 'locked: false,'
  },
  {
    name: 'conference_mode всегда meeting',
    file: THING,
    anchor: 'function publicRoomMeta(',
    from: "conference_mode: room.conference_mode || 'meeting',",
    to: "conference_mode: 'meeting',"
  },
  {
    name: 'recording_mode всегда off',
    file: THING,
    anchor: 'function publicRoomMeta(',
    from: "recording_mode: room.recording_mode || 'off',",
    to: "recording_mode: 'off',"
  },
  {
    name: 'recording_active всегда false',
    file: THING,
    anchor: 'function publicRoomMeta(',
    from: 'recording_active: !!recordingActive,',
    to: 'recording_active: false,'
  },
  {
    name: 'allow_guests не проверяется (закрытая комната пускает)',
    file: THING,
    from: 'if (!room.allow_guests) return reply.code(403).send({ error: \'Гости не допущены\' });',
    to: 'if (false) return reply.code(403).send({ error: \'Гости не допущены\' });'
  },
  {
    name: 'завершённая комната не блокируется (410 убран)',
    file: THING,
    anchor: 'function publicRoomUnavailable(room, reply, opts) {',
    from: "if (room.status === 'ended' || room.status === 'cancelled') {",
    to: 'if (false) {'
  },
  {
    name: 'start не проверяет окно (обход через «Начать Тинг»)',
    file: THING,
    anchor: "fastify.post('/rooms/:id/start'",
    from: 'const startWin = joinWindowFor(room);',
    to: 'const startWin = { applies: false, opensAt: null, startsAt: null };'
  },
  {
    name: 'CRM-токен не проверяет окно (сотрудник входит заранее)',
    file: THING,
    anchor: "fastify.post('/rooms/:id/token'",
    from: 'const win = joinWindowFor(room);',
    to: 'const win = { applies: false, opensAt: null, startsAt: null };'
  },
  {
    name: 'общий медиа-модуль тянет 4K-битрейт',
    file: 'public/assets/js/ting_media_profile.js',
    from: 'if (maxHeight >= 720 && presets.h720) top = presets.h720;',
    to: 'if (maxHeight >= 720 && presets.h2160) top = presets.h2160;'
  },
  {
    name: 'общий модуль теряет maintain-resolution',
    file: 'public/assets/js/ting_media_profile.js',
    from: "degradationPreference: 'maintain-resolution',",
    to: ''
  },
  {
    name: 'общий модуль включает backupCodec (два кодека)',
    file: 'public/assets/js/ting_media_profile.js',
    anchor: 'function buildPublishDefaults(',
    from: 'backupCodec: false',
    to: 'backupCodec: true'
  },
  {
    name: 'CRM публикует мимо общего модуля (4 слоя)',
    file: 'public/assets/js/ting_page.js',
    from: 'opts.publishDefaults = window.TingMediaProfile.buildPublishDefaults(LK, { maxHeight: 720 });',
    to: 'opts.publishDefaults = { simulcast: true };'
  },
  {
    name: 'телеметрия не отправляется из CRM',
    file: 'public/assets/js/ting_page.js',
    from: 'if (metricsBuffer.length >= 12) flushMetrics();',
    to: 'if (false) flushMetrics();'
  },
  {
    name: 'сервер не пишет метрики в БД',
    file: THING,
    from: 'INSERT INTO thing_client_metrics',
    to: 'INSERT INTO thing_client_metrics_off'
  }
];

function normalize(s) {
  return s.replace(/\r\n/g, '\n');
}

function copyFiles(dest) {
  FILES.forEach((rel) => {
    const from = path.join(root, rel);
    const to = path.join(dest, rel);
    if (!fs.existsSync(from)) return;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  });
}

function runTest(cwd) {
  /* Гоняем ОБА теста: проверки разделены (окно/поведение — в одном,
     медиа/телеметрия — в другом). Раньше запускался только первый, и
     мутации в медиа-коде «выживали» ложно. */
  const tests = [
    'tests/ting/join_window.behavior.test.js',
    'tests/ting/bitrate_policy.test.js'
  ];
  for (const t of tests) {
    try {
      execFileSync(process.execPath, [path.join(cwd, t)], {
        cwd, stdio: 'pipe', timeout: 45000
      });
    } catch (e) {
      return e.status || 1;
    }
  }
  return 0;
}

let killed = 0;
const survived = [];
const skipped = [];

/* Baseline: на НЕизменённом коде тест обязан быть зелёным. Иначе «убийство»
   мутанта ничего не значит — тест красный всегда (это поймал верификатор). */
const baseSandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ting-mut-base-'));
try {
  copyFiles(baseSandbox);
  const baseCode = runTest(baseSandbox);
  if (baseCode !== 0) {
    console.log('ABORT: baseline КРАСНЫЙ — тест не проходит на исходном коде');
    process.exit(1);
  }
  console.log('PASS   baseline зелёный');
} finally {
  try { fs.rmSync(baseSandbox, { recursive: true, force: true }); } catch (_) { /* */ }
}

MUTANTS.forEach((m, idx) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ting-mut-' + idx + '-'));
  try {
    copyFiles(sandbox);
    const target = path.join(sandbox, m.file);
    const raw = fs.readFileSync(target, 'utf8');
    const src = normalize(raw);

    /* Точка поиска: либо всё содержимое, либо фрагмент после anchor. */
    const searchFrom = m.anchor ? src.indexOf(m.anchor) : 0;
    if (m.anchor && searchFrom < 0) {
      skipped.push(m.name + ' (anchor не найден)');
      console.log('SKIP  ', m.name, '— anchor не найден');
      return;
    }
    const idx2 = src.indexOf(m.from, searchFrom);
    if (idx2 < 0) {
      skipped.push(m.name + ' (фрагмент не найден)');
      console.log('SKIP  ', m.name, '— фрагмент не найден');
      return;
    }
    /* Больше одного вхождения при отсутствии anchor — неоднозначно. */
    if (!m.anchor && src.indexOf(m.from, idx2 + 1) >= 0) {
      skipped.push(m.name + ' (фрагмент неоднозначен)');
      console.log('SKIP  ', m.name, '— фрагмент встречается >1 раза');
      return;
    }

    const mutated = src.slice(0, idx2) + m.to + src.slice(idx2 + m.from.length);
    fs.writeFileSync(target, mutated, 'utf8');
    const code = runTest(sandbox);
    if (code !== 0) {
      killed += 1;
      console.log('KILLED ', m.name);
    } else {
      survived.push(m.name);
      console.log('SURVIVED', m.name, '— тест НЕ поймал дефект');
    }
  } finally {
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (_) { /* */ }
  }
});

const total = killed + survived.length;
console.log('\n=== мутантов: ' + total + ', убито: ' + killed +
  ', выжило: ' + survived.length + ', пропущено: ' + skipped.length + ' ===');
if (skipped.length) skipped.forEach((s) => console.log(' - skip:', s));
if (survived.length) {
  survived.forEach((s) => console.log(' - ВЫЖИЛ:', s));
  process.exit(1);
}
/* SKIP — это тихая деградация покрытия: харнесс может отрапортовать 4/4,
   хотя половина мутаций не применилась (поймал верификатор). */
if (skipped.length) {
  console.log('FAIL: мутации не применились — покрытие неполное, гейт не засчитан');
  process.exit(1);
}
if (killed === 0) {
  console.log('FAIL: ни одна мутация не применена');
  process.exit(1);
}
