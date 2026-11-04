'use strict';

/**
 * crm-activity — честный учёт времени, проведённого в СРМ.
 *
 * ПОЧЕМУ НЕ presence-activity. Старый счётчик (src/services/presence-activity.js)
 * прибавляет 30 секунд НА КАЖДЫЙ тик, но любой разрыв больше 2 минут превращает
 * в те же 30 секунд. Замер на проде 03.11.2026: за октябрь 304 человеко-дня,
 * из них 211 меньше 0.5 ч, 8 ч и больше — 3 дня, средний «день» 0.69 ч.
 * Считать норму по такому источнику нельзя.
 *
 * КАК СЧИТАЕМ ТЕПЕРЬ. На каждый API-запрос ставим отметку «эта минута была»,
 * затем склеиваем минуты в СЕССИИ: разрыв ≤ 15 минут — та же сессия, каждая
 * сессия считается от первой минуты до последней включительно.
 *
 * Почему не «штука запросов × 30 сек»: клиент может открыть вкладку и уйти,
 * автообновление будет долбить сервер. Ограничение crm_max_day_minutes (12 ч)
 * отсекает совсем патологические случаи, а 15-минутный разрыв — обычная
 * пауза (обед, совещание), её не режем в ноль.
 */

const { mskMinuteStr, hhmmWallClock, pad2 } = require('../lib/msk');

/**
 * Пути, которые НЕ означают «человек работает».
 *
 * ВАЖНО (верификатор 03.11.2026): здесь могут быть только ТОЧНЫЕ адреса
 * SSE/пульса, а не префиксы целых модулей. Первая версия содержала
 * `/api/tkp/`, `/api/tkp-quick/`, `/api/chat-groups/` — под ними 84 роута,
 * из которых стримов всего 4. Реальная работа в ТКП и чатах перестала
 * считаться активностью и давала ложную недоработку.
 */
const NOISE_PREFIXES = [
  '/api/daily-presence/heartbeat',
  '/api/daily-presence/self-act',
  '/api/chat-groups/presence/',   // пульс присутствия, не сообщения
  '/api/sse',
  '/api/events',
  // Catch-up поллинг SSE каждые 30 сек, работает и при скрытой вкладке
  // (huginn_sse.js SAFETY_POLL_MS). Без этой строки забытая вкладка набирала
  // ровно потолок 12 ч «работы» без единого действия человека — а creditDay
  // для статуса «уд» берёт crm_minutes напрямую
  // (верификатор 03.11.2026, P2).
  '/api/chat-groups/events',
  '/api/auth/me',
  '/api/push/badge-count',
  '/api/push/vapid-key',
  '/api/push/subscribe',
  '/api/push/unsubscribe',
  '/api/notifications/unread-count',
  '/api/office-attendance/tick',

  // Стримы (text/event-stream) — соединение открыто, действий человека нет.
  '/api/mimir/chat-stream',
  '/api/mimir/auto-estimate',
  '/api/mimir/auto-estimate-answer',
  '/api/mimir-conductor/conductor/events',
  '/api/admin-system/logs/stream'
];

/**
 * Суффиксы стримов: путь заканчивается на них — держит SSE.
 * Точечно закрывает /api/tkp/:id/autofill, /api/tkp-quick/.../calculate,
 * /api/tkp-quick/.../chat, /api/chat-groups/:id/mimir-stream и подобные,
 * не глуша остальные ручки этих модулей.
 */
const NOISE_SUFFIXES = ['/stream', '-stream', '/autofill', '/calculate', '/mimir-stream'];

/**
 * Шаблоны SSE-ручек, которые не ловятся ни префиксом, ни суффиксом.
 * `/api/tkp-quick/sessions/<uid>/chat` — стрим, но `…/chat` есть и у обычных
 * POST-ручек чата, поэтому нужен точный шаблон, а не суффикс.
 */
const NOISE_PATTERNS = [
  /^\/api\/tkp-quick\/sessions\/[^/]+\/chat$/i
];

/** По умолчанию: разрыв внутри сессии. */
const DEFAULT_SESSION_GAP_MIN = 15;
/** Потолок «рабочего дня» в СРМ — защита от забытой вкладки с автообновлением. */
const DEFAULT_MAX_DAY_MINUTES = 12 * 60;

/** Минутный буфер в памяти: `${userId}|${YYYY-MM-DDTHH:mm}` → hits. */
let buffer = new Map();
let flushTimer = null;
let dbRef = null;
let shuttingDown = false;

const FLUSH_INTERVAL_MS = 30 * 1000;

/**
 * Текущая минута в московском времени.
 * Возвращает { day: 'YYYY-MM-DD', minute: 'YYYY-MM-DDTHH:mm' }.
 */
function mskMinute(nowMs) {
  const minute = mskMinuteStr(nowMs);
  return { day: minute.slice(0, 10), minute };
}

/** Шумный путь — не активность человека. */
function isNoisePath(url) {
  const path = String(url || '').split('?')[0];
  if (!path.startsWith('/api/')) return true;
  for (const p of NOISE_PREFIXES) {
    if (path === p || path.startsWith(p)) return true;
  }
  for (const sfx of NOISE_SUFFIXES) {
    if (path.endsWith(sfx)) return true;
  }
  for (const re of NOISE_PATTERNS) {
    if (re.test(path)) return true;
  }
  return false;
}

/** Отметка активности. Должна быть максимально дешёвой: только Map.set. */
function tick(userId, url, nowMs) {
  const id = Number(userId);
  if (!id || !Number.isFinite(id)) return false;
  if (isNoisePath(url)) return false;
  const { minute } = mskMinute(nowMs);
  const key = `${id}|${minute}`;
  buffer.set(key, (buffer.get(key) || 0) + 1);
  return true;
}

/** Сброс буфера в БД. Идемпотентен: повторный вызов при пустом буфере — no-op. */
async function flush() {
  const db = dbRef;
  if (!db || !buffer.size) return { written: 0 };
  const snapshot = buffer;
  buffer = new Map();

  const rows = [];
  for (const [key, hits] of snapshot) {
    const sep = key.indexOf('|');
    const userId = Number(key.slice(0, sep));
    const minute = key.slice(sep + 1);
    if (!userId || !minute) continue;
    rows.push([userId, minute, hits]);
  }
  if (!rows.length) return { written: 0 };

  try {
    // Оптом, одним запросом: 12 параметров на строку — режем по 500 строк.
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const values = [];
      const params = [];
      chunk.forEach(([userId, minute, hits], idx) => {
        const b = idx * 3;
        values.push(`($${b + 1}, $${b + 2}::timestamp, $${b + 3})`);
        params.push(userId, minute.replace('T', ' '), hits);
      });
      await db.query(
        `INSERT INTO crm_activity_token (user_id, minute_ts, hits)
         VALUES ${values.join(',')}
         ON CONFLICT (user_id, minute_ts)
         DO UPDATE SET hits = crm_activity_token.hits + EXCLUDED.hits`,
        params
      );
    }
    return { written: rows.length };
  } catch (e) {
    // Не теряем данные: возвращаем несохранённое обратно в буфер.
    for (const [key, hits] of snapshot) {
      buffer.set(key, (buffer.get(key) || 0) + hits);
    }
    throw e;
  }
}

function start(db, opts = {}) {
  dbRef = db || null;
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    if (shuttingDown) return;
    flush().catch((e) => {
      // Таблица ещё не накатана или БД моргнула — не валим сервер.
      if (process.env.NODE_ENV !== 'test') {
        console.warn('[crm-activity] flush failed: ' + e.message);
      }
    });
  }, opts.intervalMs || FLUSH_INTERVAL_MS);
  if (flushTimer.unref) flushTimer.unref();
}

async function stop() {
  shuttingDown = true;
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  try { await flush(); } catch (_) { /* ignore on shutdown */ }
}

/** Тестовый сброс состояния. */
function _reset() {
  buffer = new Map();
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  dbRef = null;
  shuttingDown = false;
}

/** Минуты активности за день: [{ minute: 'HH:mm', hits }] по возрастанию. */
function minutesFromRows(rows) {
  return rows.map((r) => ({
    minute: hhmmWallClock(r.minute_ts),
    hits: Number(r.hits || 0),
    date: r.date ? String(r.date).slice(0, 10) : null
  })).filter((x) => x.minute);
}

/**
 * Группировка минут в сессии. Чистая функция — тестируется без БД.
 * @param {Array<{minute:string, hits:number}>} minutes — по возрастанию
 * @param {{gapMin?:number, maxDayMinutes?:number}} opts
 * @returns {{sessions:Array<{from:string,to:string,minutes:number,hits:number}>, totalMinutes:number}}
 */
function buildSessions(minutes, opts = {}) {
  const gapMin = opts.gapMin == null ? DEFAULT_SESSION_GAP_MIN : Number(opts.gapMin);
  const maxDay = opts.maxDayMinutes == null ? DEFAULT_MAX_DAY_MINUTES : Number(opts.maxDayMinutes);

  const toMinOfDay = (hhmm) => {
    const [h, m] = String(hhmm).split(':').map(Number);
    return h * 60 + m;
  };
  const toHHMM = (minOfDay) => `${pad2(Math.floor(minOfDay / 60))}:${pad2(minOfDay % 60)}`;

  const points = (minutes || [])
    .map((x) => ({ min: toMinOfDay(x.minute), hits: Number(x.hits || 0) }))
    .filter((x) => Number.isFinite(x.min))
    .sort((a, b) => a.min - b.min);

  const sessions = [];
  let cur = null;
  for (const p of points) {
    if (cur && p.min - cur.last <= gapMin) {
      cur.last = p.min;
      cur.hits += p.hits;
      continue;
    }
    if (cur) sessions.push(cur);
    cur = { first: p.min, last: p.min, hits: p.hits };
  }
  if (cur) sessions.push(cur);

  let total = 0;
  const out = sessions.map((s) => {
    // Сессия из одной минуты = 1 минута, а не gapMin: иначе «открыл и закрыл»
    // превращалось бы в 15 минут присутствия (миражи).
    const len = s.last - s.first + 1;
    total += len;
    return { from: toHHMM(s.first), to: toHHMM(s.last), minutes: len, hits: s.hits };
  });

  if (total > maxDay) {
    // Обрезаем хвост: оставляем первые сессии, пока не выбрали потолок.
    let left = maxDay;
    const trimmed = [];
    for (const s of out) {
      if (left <= 0) break;
      if (s.minutes <= left) {
        trimmed.push(s);
        left -= s.minutes;
      } else {
        trimmed.push({ ...s, to: toHHMM(toMinOfDay(s.from) + left - 1), minutes: left });
        left = 0;
      }
    }
    return { sessions: trimmed, totalMinutes: maxDay, capped: true };
  }
  return { sessions: out, totalMinutes: total, capped: false };
}

/** Активность за один день по сотруднику (users.id). */
async function activityForDay(db, userId, dayIso) {
  const { rows } = await db.query(
    `SELECT minute_ts, hits
       FROM crm_activity_token
      WHERE user_id = $1
        AND minute_ts >= $2::date
        AND minute_ts <  $2::date + INTERVAL '1 day'
      ORDER BY minute_ts`,
    [userId, dayIso]
  );
  const minutes = minutesFromRows(rows);
  return buildSessions(minutes);
}

/** Активность за диапазон дат: { 'YYYY-MM-DD': {sessions, totalMinutes} }. */
async function activityRange(db, userId, fromIso, toIso) {
  const { rows } = await db.query(
    `SELECT (minute_ts::date)::text AS date, minute_ts, hits
       FROM crm_activity_token
      WHERE user_id = $1
        AND minute_ts >= $2::date
        AND minute_ts <  $3::date + INTERVAL '1 day'
      ORDER BY minute_ts`,
    [userId, fromIso, toIso]
  );
  const byDay = new Map();
  for (const r of rows) {
    const date = String(r.date).slice(0, 10);
    if (!byDay.has(date)) byDay.set(date, []);
    byDay.get(date).push(r);
  }
  const out = {};
  for (const [date, dayRows] of byDay) {
    out[date] = buildSessions(minutesFromRows(dayRows));
  }
  return out;
}

/** Есть ли вообще данные за дату (для честного «нет данных до выкатки»). */
async function hasDataForDay(db, dayIso) {
  const { rows } = await db.query(
    `SELECT 1 FROM crm_activity_token
      WHERE minute_ts >= $1::date AND minute_ts < $1::date + INTERVAL '1 day'
      LIMIT 1`,
    [dayIso]
  );
  return rows.length > 0;
}

module.exports = {
  tick,
  flush,
  start,
  stop,
  activityForDay,
  activityRange,
  hasDataForDay,
  buildSessions,
  mskMinute,
  isNoisePath,
  NOISE_PREFIXES,
  DEFAULT_SESSION_GAP_MIN,
  DEFAULT_MAX_DAY_MINUTES,
  _reset,
  _buffer: () => buffer
};
