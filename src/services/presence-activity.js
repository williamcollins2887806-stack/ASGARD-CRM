'use strict';

/**
 * presence-activity — лёгкий IN-MEMORY реестр активности офисных сотрудников для «живого офиса».
 * Эфемерные данные (НЕ пишем в БД): последний heartbeat, текущая страница, самоотметка действия.
 *
 * Источник для #/command-map (Фаза 3): idle-детект (нет heartbeat N минут → «отошёл»),
 * текущая страница, самостатус ☕/💨/🍖. Онлайн/офлайн по-прежнему из SSE (sse.getOnlineUserIds).
 *
 * Память ограничена: чистим записи старше TTL. Один процесс (systemd single-instance) — Map достаточно.
 */

const TTL_MS = 30 * 60 * 1000;      // запись живёт 30 мин после последнего heartbeat
const IDLE_MS = 5 * 60 * 1000;      // нет heartbeat > 5 мин → idle (отошёл)
const SELF_ACT_TTL_MS = 60 * 60 * 1000; // самоотметка (кофе/перекур/обед) живёт час, потом сбрасывается

// userId(Number) → { lastSeen:ms, page:string, act:string|null, actAt:ms }
const reg = new Map();

const VALID_ACTS = new Set(['coffee', 'smoke', 'lunch', null, '']);

function _now() { return Date.now(); }

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

module.exports = { beat, setSelfAct, snapshot, IDLE_MS, _reg: reg };
