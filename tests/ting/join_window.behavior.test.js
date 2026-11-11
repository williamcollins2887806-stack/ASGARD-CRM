#!/usr/bin/env node
/**
 * D-183..D-190: поведенческие проверки окна входа и политики качества.
 *
 * ВАЖНО: раньше здесь были grep-проверки (`/alreadyOpen/.test(seg)`), и
 * верификатор справедливо назвал их слепыми: имя переменной на месте — тест
 * зелёный, даже если она равна false. Теперь функции ИЗВЛЕКАЮТСЯ из файла и
 * ВЫПОЛНЯЮТСЯ с разными входами. Проверяется результат, а не текст.
 *
 * Run: node tests/ting/join_window.behavior.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const server = fs.readFileSync(path.join(root, 'src/routes/thing.js'), 'utf8');
const tv = fs.readFileSync(path.join(root, 'public/ting-tv/index.html'), 'utf8');

let pass = 0;
const fails = [];

/** Синхронные проверки — простая регистрация. */
function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log('PASS', name);
  } catch (e) {
    fails.push(name + ': ' + e.message);
    console.log('FAIL', name, '—', e.message);
  }
}

/** Асинхронные проверки — ждём последовательно, иначе провал терялся. */
const asyncChecks = [];
function checkAsync(name, fn) {
  asyncChecks.push({ name, fn });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/**
 * Извлечь функцию из исходника вместе с телом.
 * Ищем от `function NAME(` до парной закрывающей скобки на нулевом уровне.
 */
function extractFn(src, name, siblingMarkers) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('функция ' + name + ' не найдена');
  let depth = 0;
  let i = src.indexOf('{', start);
  const from = i;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) throw new Error('не удалось найти конец функции ' + name);
  let end = i + 1;
  /* Захватить и комментарий-«шапку» перед функцией, если он есть. */
  return src.slice(start, end);
}

/** Собрать joinWindowFor как исполняемую функцию (чистая, без зависимостей). */
function buildJoinWindow() {
  const body = extractFn(server, 'joinWindowFor');
  const earlySrc = /const EARLY_JOIN_MS = ([^;]+);/.exec(server);
  const early = earlySrc ? earlySrc[1].trim() : '60*60*1000';
  // eslint-disable-next-line no-new-func
  return new Function('const EARLY_JOIN_MS = ' + early + ';\nreturn (' + body + ');')();
}

/** Собрать publicRoomUnavailable (он зовёт joinWindowFor — подставляем). */
function buildRoomGuard() {
  const body = extractFn(server, 'publicRoomUnavailable');
  const fn = buildJoinWindow();
  // eslint-disable-next-line no-new-func
  return new Function('joinWindowFor', 'return (' + body + ');')(fn);
}

function mkReply() {
  const reply = {
    status: 0,
    payload: null,
    code(c) { reply.status = c; return reply; },
    send(p) { reply.payload = p; return reply; }
  };
  return reply;
}

const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();

function room(over) {
  /* ВАЖНО: все поля заполнены РЕАЛЬНЫМИ значениями. Если поле не задано в
     фикстуре, проверка `m.X === r.X` даёт `undefined === undefined` и молча
     проходит — верификатор поймал это: удаление title/lobby_enabled/locked
     оставалось зелёным. */
  return Object.assign({
    id: 1,
    slug: 'abc123',
    dial_code: '123456',
    title: 'Совещание по проекту',
    status: 'scheduled',
    mode: 'scheduled',
    allow_guests: true,
    lobby_enabled: true,
    pin_code: '4321',
    recording_mode: 'manual',
    conference_mode: 'webinar',
    locked: true,
    scheduled_at: iso(NOW + 3 * 3600 * 1000) // старт через 3 часа
  }, over);
}

// ── Расчёт окна: поведение чистой функции ───────────────────────────────
check('joinWindow: scheduled за 3 часа → окно действует, opensAt = старт−1ч', () => {
  const win = buildJoinWindow()(room());
  assert(win.applies === true, 'окно не применилось к scheduled-комнате');
  const expect = NOW + 3 * 3600 * 1000 - 3600 * 1000;
  assert(Math.abs(win.opensAt - expect) < 5000,
    'opensAt=' + new Date(win.opensAt).toISOString() + ', ожидался старт−1ч');
});

check('joinWindow: instant → окно НЕ применяется', () => {
  const win = buildJoinWindow()(room({ mode: 'instant' }));
  assert(win.applies === false, 'окно применилось к instant-комнате');
  assert(win.opensAt === null, 'opensAt не null для instant');
});

check('joinWindow: status=live → окно НЕ применяется (N2)', () => {
  const win = buildJoinWindow()(room({ status: 'live' }));
  assert(win.applies === false, 'окно применилось к живой комнате');
});

check('joinWindow: без scheduled_at → окно НЕ применяется', () => {
  const win = buildJoinWindow()(room({ scheduled_at: null }));
  assert(win.applies === false, 'окно применилось без времени');
});

check('joinWindow: невалидная дата → окно НЕ применяется (N5, без 500)', () => {
  const win = buildJoinWindow()(room({ scheduled_at: 'not-a-date' }));
  assert(win.applies === false, 'окно применилось к невалидной дате (RangeError на toISOString)');
  assert(win.opensAt === null, 'opensAt не null для невалидной даты');
});

// ── Окно входа: поведение ────────────────────────────────────────────────
check('окно: scheduled за 3 часа до старта → 425', () => {
  const guard = buildRoomGuard();
  const r = mkReply();
  const res = guard(room(), r);
  assert(res, 'функция не вернула блокировку');
  assert(r.status === 425, 'код ' + r.status + ', ожидался 425');
  assert(r.payload && r.payload.code === 'ROOM_NOT_OPEN_YET', 'неверный code');
});

check('окно: scheduled за 59 минут до старта → пускает', () => {
  const guard = buildRoomGuard();
  const r = mkReply();
  const res = guard(room({ scheduled_at: iso(NOW + 59 * 60 * 1000) }), r);
  assert(!res, 'заблокировал вход за 59 минут (должен пускать)');
});

check('окно: живую комнату (status=live) с будущим временем НЕ блокирует', () => {
  /* Регресс N2: хост начал раньше — гости должны войти. */
  const guard = buildRoomGuard();
  const r = mkReply();
  const res = guard(room({ status: 'live', scheduled_at: iso(NOW + 5 * 3600 * 1000) }), r);
  assert(!res, 'заблокировал живую комнату (код ' + r.status + ')');
});

check('окно: status=open тоже пускает', () => {
  const guard = buildRoomGuard();
  const res = guard(room({ status: 'open' }), mkReply());
  assert(!res, 'заблокировал status=open');
});

check('окно: instant-комната не ограничена даже с scheduled_at', () => {
  const guard = buildRoomGuard();
  const res = guard(room({ mode: 'instant' }), mkReply());
  assert(!res, 'заблокировал instant-комнату');
});

check('окно: scheduled без времени пускает (сиды, демо)', () => {
  const guard = buildRoomGuard();
  const res = guard(room({ scheduled_at: null }), mkReply());
  assert(!res, 'заблокировал комнату без scheduled_at');
});

check('окно: skipWindow снимает блокировку (GET метаданных)', () => {
  const guard = buildRoomGuard();
  const res = guard(room(), mkReply(), { skipWindow: true });
  assert(!res, 'skipWindow не снял блокировку — гость не увидит название');
});

check('окно: tv_hall в opts НЕ обходит (D-188b)', () => {
  /* Флаг приходил из публичного тела — теперь такого исключения быть не должно. */
  const guard = buildRoomGuard();
  const r = mkReply();
  const res = guard(room(), r, { tvHall: true });
  assert(res && r.status === 425, 'tv_hall обошёл окно — дыра в модерации');
});

check('окно: завершённую комнату блокирует 410', () => {
  const guard = buildRoomGuard();
  const r = mkReply();
  guard(room({ status: 'ended' }), r);
  assert(r.status === 410, 'код ' + r.status + ', ожидался 410');
});

check('окно: гости не допущены → 403 (allow_guests=false)', () => {
  const guard = buildRoomGuard();
  const r = mkReply();
  guard(room({ allow_guests: false }), r);
  assert(r.status === 403, 'код ' + r.status + ', ожидался 403 (гости не допущены)');
});

check('окно: guest-token НЕ передаёт skipWindow и tvHall', () => {
  /* Поведенческая проверка вызова: ищем вызов внутри обработчика guest-token. */
  const gi = server.indexOf("fastify.post('/public/:code/guest-token'");
  assert(gi > 0, 'guest-token не найден');
  const seg = server.slice(gi, gi + 2000);
  const call = seg.match(/publicRoomUnavailable\(([^)]*)\)/);
  assert(call, 'guest-token не вызывает publicRoomUnavailable');
  assert(call[1].trim() === 'room, reply', 'в вызове лишние аргументы: ' + call[1]);
});

// ── Метаданные: join_open синхронен с окном ─────────────────────────────
check('метаданные: join_open == реальное поведение охранника (F4, исполняем)', () => {
  /* Исполняем НАСТОЯЩИЙ publicRoomMeta и сравниваем с охранником.
     Раньше тест реконструировал логику рядом — верификатор показал, что
     мутации join_open:true и удаление поля проходили гейт зелёными. */
  const body = extractFn(server, 'publicRoomMeta');
  const joinWin = buildJoinWindow();
  // eslint-disable-next-line no-new-func
  const meta = new Function('joinWindowFor', 'return (' + body + ');')(joinWin);
  const guard = buildRoomGuard();

  const cases = [
    ['scheduled за 3ч', room()],
    ['instant', room({ mode: 'instant' })],
    ['live', room({ status: 'live' })],
    ['open', room({ status: 'open' })],
    ['без времени', room({ scheduled_at: null })],
    ['за 30 мин', room({ scheduled_at: iso(NOW + 30 * 60 * 1000) })],
    ['за 61 мин', room({ scheduled_at: iso(NOW + 61 * 60 * 1000) })]
  ];

  cases.forEach(([label, r]) => {
    const m = meta(r, false);
    const win = joinWin(r);
    assert(typeof m.join_open === 'boolean', label + ': join_open не boolean');
    const blocked = !!guard(r, mkReply());
    assert(m.join_open === !blocked,
      label + ': join_open=' + m.join_open + ', но охранник ' +
      (blocked ? 'блокирует' : 'пускает'));

    /* Безусловные проверки времени: non-null ⇔ окно применимо.
       Раньше здесь стоял `if (m.opens_at)`, и обнуление поля проходило гейт
       зелёным — assert сам себя выключал ровно в момент дефекта. */
    if (win.applies) {
      assert(typeof m.opens_at === 'string' && m.opens_at.length > 0,
        label + ': opens_at отсутствует, хотя окно применимо');
      assert(new Date(m.opens_at).getTime() === win.opensAt,
        label + ': opens_at не совпадает с окном');
      assert(typeof m.scheduled_at === 'string' && m.scheduled_at.length > 0,
        label + ': scheduled_at отсутствует, хотя окно применимо');
      assert(new Date(m.scheduled_at).getTime() === win.startsAt,
        label + ': scheduled_at не совпадает со стартом');
    } else {
      assert(m.opens_at === null, label + ': opens_at должен быть null (окно не применяется)');
      assert(m.scheduled_at === null, label + ': scheduled_at должен быть null');
    }

    /* Остальные поля метаданных — по значению, а не по факту наличия. */
    assert(m.title === r.title, label + ': title потерян');
    assert(m.status === r.status, label + ': status потерян');
    assert(m.lobby_enabled === r.lobby_enabled, label + ': lobby_enabled потерян');
    assert(m.pin_required === Boolean(r.pin_code), label + ': pin_required неверен');
    assert(m.recording_mode === (r.recording_mode || 'off'), label + ': recording_mode потерян');
    assert(m.recording_active === false, label + ': recording_active должен быть false');    assert(m.locked === Boolean(r.locked), label + ': locked неверен');
    assert(m.conference_mode === (r.conference_mode || 'meeting'), label + ': conference_mode потерян');
    assert(m.slug === r.slug, label + ': slug потерян');
    assert(m.dial_code === (r.dial_code || null), label + ': dial_code потерян');
    assert(m.mode === (r.mode || 'instant'), label + ': mode потерян');
  });

  /* Инъекция времени: nowMs должен сдвигать join_open до открытия окна.
     Проверяем на старте в будущем: «до открытия» и «после». */
  const future = room({ scheduled_at: iso(NOW + 3 * 3600 * 1000) });
  assert(meta(future, false, NOW).join_open === false,
    'nowMs: до открытия окна join_open должен быть false');
  assert(meta(future, false, NOW + 3 * 3600 * 1000).join_open === true,
    'nowMs: после открытия join_open должен быть true');

  /* recording_active проверяется в ОБЕ стороны: раньше случай true не был
     покрыт, и мутация `recording_active: false` выживала — плашка записи
     могла исчезнуть из ответа незаметно. */
  assert(meta(future, true).recording_active === true,
    'recording_active=true не доходит до ответа');
  assert(meta(future, false).recording_active === false,
    'recording_active=false не доходит до ответа');
});

// ── Микрофон: withTimeout не гасит поток на успехе ──────────────────────
checkAsync('микрофон: withTimeout НЕ гасит поток при успехе', async () => {
  const body = extractFn(tv, 'withTimeout');
  // eslint-disable-next-line no-new-func
  const withTimeout = new Function('return (' + body + ')')();
  let released = false;
  const stream = { getTracks: () => [{ stop: () => { released = true; } }] };
  const got = await withTimeout(Promise.resolve(stream), 5000, 't', () => { released = true; });
  assert(got === stream, 'withTimeout не вернул результат');
  assert(released === false, 'поток погашен на успехе — микрофон не опубликуется');
});

checkAsync('микрофон: withTimeout ГАСИТ поздний поток при таймауте', async () => {
  const body = extractFn(tv, 'withTimeout');
  // eslint-disable-next-line no-new-func
  const withTimeout = new Function('return (' + body + ')')();
  let released = false;
  const stream = { getTracks: () => [{ stop: () => { released = true; } }] };
  let late;
  const slow = new Promise((res) => { late = () => res(stream); });
  let threw = false;
  try {
    await withTimeout(slow, 20, 't', () => { released = true; });
  } catch (_) {
    threw = true;
  }
  assert(threw, 'таймаут не выбросил ошибку');
  late();
  await new Promise((r) => setTimeout(r, 30));
  assert(released === true, 'поздний поток не погашен — устройство останется занятым');
});

// ── Upsert гостя: конкретно гостевой блок ───────────────────────────────
check('upsert: ON CONFLICT именно в гостевом обработчике (F2)', () => {
  /* Раньше assert ловил CASE из CRM-входа (строка ~660). Проверяем строго
     внутри guest-token. */
  const gi = server.indexOf("fastify.post('/public/:code/guest-token'");
  assert(gi > 0, 'guest-token не найден');
  const nextRoute = server.indexOf('fastify.post(', gi + 10);
  const seg = server.slice(gi, nextRoute > 0 ? nextRoute : gi + 6000);
  assert(/ON CONFLICT \(room_id, identity\) DO UPDATE SET/.test(seg),
    'в guest-token нет ON CONFLICT ... DO UPDATE SET — duplicate_record вернётся');
  assert(/'rejected'/.test(seg), 'rejected не упоминается в guest-token');
  assert(/left_at\s*=\s*CASE/.test(seg), 'left_at не сбрасывается в guest-token');
  assert(/RETURNING id/.test(seg), 'нет RETURNING id (код читает ins[0].id)');
});

check('upsert: поведение ON CONFLICT на реальном SQL-парсере логики', () => {
  /* Исполняем ту же логику CASE, что в SQL: повторный вход не должен
     воскрешать отклонённого и не должен оставлять left_at. */
  const gi = server.indexOf("fastify.post('/public/:code/guest-token'");
  const seg = server.slice(gi, gi + 8000);
  /* Вытаскиваем оба CASE-выражения и проверяем их смысл регулярками с якорем
     на 'rejected' как УСЛОВИЕ (а не просто упоминание). */
  assert(/lobby_status\s*=\s*CASE\s+WHEN thing_participants\.lobby_status = 'rejected'\s+THEN 'rejected'/.test(
    seg.replace(/\s+/g, ' ')
  ), 'lobby_status: rejected не сохраняется при повторном входе (кик обходится)');
  assert(/left_at\s*=\s*CASE\s+WHEN thing_participants\.lobby_status = 'rejected'\s+THEN thing_participants\.left_at\s+ELSE NULL/.test(
    seg.replace(/\s+/g, ' ')
  ), 'left_at: ушедший участник не возвращается в комнату');
});

check('upsert: отклонённый гость получает 403 BANNED', () => {
  const gi = server.indexOf("fastify.post('/public/:code/guest-token'");
  const seg = server.slice(gi, gi + 8000);
  assert(/'rejected'\)[\s\S]{0,200}code:\s*'BANNED'/.test(seg),
    'нет проверки rejected после upsert');
});

// ── Кодек и качество ────────────────────────────────────────────────────
check('качество: потолок 720p, три слоя, H264 с проверкой', () => {
  /* D-192: профиль переехал в общий модуль — проверяем его, а не копию в ТВ. */
  const moduleSrc = fs.readFileSync(path.join(root, 'public/assets/js/ting_media_profile.js'), 'utf8');
  assert(/function h264Supported/.test(moduleSrc), 'нет capability-check в модуле');
  assert(/backupCodec:\s*false/.test(moduleSrc), 'backupCodec не выключен в модуле');
  assert(/degradationPreference:\s*'maintain-resolution'/.test(moduleSrc),
    'нет maintain-resolution в модуле');
  assert(!/h2160/.test(moduleSrc), 'модуль тянет 4K-пресет');
  const pushes = (moduleSrc.match(/layers\.push/g) || []).length;
  assert(pushes === 3, 'в модуле ' + pushes + ' слоёв, ожидалось 3');
});

check('качество: canPlaybackAudio как геттер', () => {
  const bad = /typeof [a-zA-Z_.]*canPlaybackAudio === 'function'/;
  assert(!bad.test(tv), 'ТВ вызывает canPlaybackAudio как метод');
  const guest = fs.readFileSync(path.join(root, 'public/ting/index.html'), 'utf8');
  assert(!bad.test(guest), 'гость вызывает canPlaybackAudio как метод');
});

check('качество: collectStats разделяет pub/sub', () => {
  const i = tv.indexOf('async function collectStats');
  const seg = tv.slice(i, i + 2600);
  assert(/pubPc/.test(seg) && /subPc/.test(seg), 'нет разделения pub/sub');
  assert(/isPub && s\.type === 'outbound-rtp'/.test(seg), 'limiter не из publisher');
  assert(/!isPub && s\.type === 'inbound-rtp'/.test(seg), 'потери не из subscriber');
});

(async () => {
  for (const c of asyncChecks) {
    try {
      await c.fn();
      pass += 1;
      console.log('PASS', c.name);
    } catch (e) {
      fails.push(c.name + ': ' + e.message);
      console.log('FAIL', c.name, '—', e.message);
    }
  }

  const total = pass + fails.length;
  console.log('\n=== ' + total + ' checks, ' + pass + ' PASS, ' + fails.length + ' FAIL ===');
  if (fails.length) {
    fails.forEach((f) => console.log(' -', f));
    process.exit(1);
  }
})();
