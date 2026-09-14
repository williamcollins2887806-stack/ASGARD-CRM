'use strict';

/**
 * presence-activity — IN-MEMORY реестр для «живого офиса» + персист времени в crm_presence_daily.
 * Эфемерные: lastSeen/page/act. В БД: активные секунды по heartbeat (видимая вкладка).
 */

const TTL_MS = 30 * 60 * 1000;      // запись живёт 30 мин после последнего heartbeat
const IDLE_MS = 5 * 60 * 1000;      // нет heartbeat > 5 мин → idle (отошёл)
const SELF_ACT_TTL_MS = 60 * 60 * 1000; // самоотметка (кофе/перекур/обед) живёт час, потом сбрасывается

// userId(Number) → { lastSeen:ms, page:string, act:string|null, actAt:ms }
const reg = new Map();

const VALID_ACTS = new Set(['coffee', 'smoke', 'lunch', null, '']);

let _db = null;

function attachDb(db) {
  _db = db || null;
}

function _now() { return Date.now(); }

/** Накопить активные секунды (MSK day). Debounce <25с; gap >2мин → +30с тик. */
function persistTick(userId) {
  if (!_db || !userId) return;
  const id = Number(userId);
  if (!id) return;
  _db.query(`
    INSERT INTO crm_presence_daily (user_id, day, active_seconds, tick_count, first_seen_at, last_seen_at)
    VALUES (
      $1,
      (NOW() AT TIME ZONE 'Europe/Moscow')::date,
      30, 1, NOW(), NOW()
    )
    ON CONFLICT (user_id, day) DO UPDATE SET
      active_seconds = crm_presence_daily.active_seconds +
        CASE
          WHEN crm_presence_daily.last_seen_at > NOW() - INTERVAL '25 seconds' THEN 0
          WHEN crm_presence_daily.last_seen_at > NOW() - INTERVAL '2 minutes'
            THEN LEAST(45, GREATEST(0,
              EXTRACT(EPOCH FROM (NOW() - crm_presence_daily.last_seen_at))::int))
          ELSE 30
        END,
      tick_count = crm_presence_daily.tick_count + 1,
      last_seen_at = NOW()
  `, [id]).catch(() => { /* таблица ещё не накатана / гонка — не валим heartbeat */ });
}

/** heartbeat от клиента: обновить lastSeen + страницу (+ опц. самоотметку act). */
function beat(userId, page, act) {
  const id = Number(userId);
  if (!id) return;
  const cur = reg.get(id) || {};
  cur.lastSeen = _now();
  if (typeof page === 'string') cur.page = page.slice(0, 80);
  if (act !== undefined && VALID_ACTS.has(act)) {
    cur.act = act || null;
    cur.actAt = act ? _now() : 0;
  }
  reg.set(id, cur);
  _sweep();
  persistTick(id);
}

/** Явно установить/снять самоотметку (кнопка ☕/💨/🍖). */
function setSelfAct(userId, act) {
  const id = Number(userId);
  if (!id) return;
  if (!VALID_ACTS.has(act)) return;
  const cur = reg.get(id) || { lastSeen: _now() };
  cur.act = act || null;
  cur.actAt = act ? _now() : 0;
  cur.lastSeen = _now();
  reg.set(id, cur);
}

/** Снимок активности по списку userId. Возвращает { [userId]: {idle, page, selfAct, lastSeen} }. */
function snapshot(userIds) {
  const out = {};
  const now = _now();
  (userIds || []).forEach(uid => {
    const id = Number(uid);
    const r = reg.get(id);
    if (!r) { out[id] = { idle: false, page: null, selfAct: null, lastSeen: null }; return; }
    const selfActFresh = r.act && r.actAt && (now - r.actAt) < SELF_ACT_TTL_MS;
    out[id] = {
      idle: r.lastSeen ? (now - r.lastSeen) > IDLE_MS : false,
      page: r.page || null,
      selfAct: selfActFresh ? r.act : null,
      lastSeen: r.lastSeen || null
    };
  });
  return out;
}

function _sweep() {
  const now = _now();
  for (const [id, r] of reg) {
    if (!r.lastSeen || (now - r.lastSeen) > TTL_MS) reg.delete(id);
  }
}

module.exports = { beat, setSelfAct, snapshot, attachDb, IDLE_MS, _reg: reg };
