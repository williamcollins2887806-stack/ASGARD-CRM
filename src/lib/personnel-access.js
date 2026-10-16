'use strict';

/**
 * Доступ к «дружине» (персонал + карточка сотрудника).
 * ═══════════════════════════════════════════════════════════════════════════
 * Зачем: Дима Путков (роль BUH) ведёт выплаты и должен видеть/править
 * получателей НПД в карточке рабочего. По ролям страница `#/personnel` и
 * `#/employee` ему закрыта (там нет BUH), поэтому выдаём ПЕРСОНАЛЬНЫЙ ГРАНТ —
 * как сделано для страницы выплат (src/lib/payouts-access.js, V387).
 *
 * Механизм: settings.personnel_viewer_user_ids (JSON-массив user_id).
 * Список живёт в БД — состав меняется без деплоя. Кэш 60 c.
 *
 * Безопасность: грант даёт доступ ТОЛЬКО к просмотру дружины и правке
 * получателя/остатков. RBAC на тяжёлых ручках (увольнение, оклад и т.п.)
 * остаётся на месте — здесь мы открываем страницу, а не снимаем проверки.
 */

const SETTING_KEY = 'personnel_viewer_user_ids';
const CACHE_TTL_MS = 60 * 1000;

// Роли, которым дружина доступна всегда (без гранта) — как в app.js NAV.
const PERSONNEL_BASE_ROLES = [
  'ADMIN', 'HR', 'HR_MANAGER', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'OFFICE_MANAGER',
  'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV',
];

let _cache = { at: 0, ids: new Set(), loaded: false };

function parseIds(raw) {
  const out = new Set();
  if (raw == null) return out;
  let arr = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch (_) { arr = []; }
  }
  if (!Array.isArray(arr)) return out;
  for (const v of arr) {
    const n = (typeof v === 'number' || typeof v === 'string') ? Number(v) : NaN;
    if (Number.isInteger(n) && n > 0) out.add(n);
  }
  return out;
}

async function loadIds(db, { force = false } = {}) {
  const now = Date.now();
  if (!force && _cache.loaded && (now - _cache.at) < CACHE_TTL_MS) return _cache.ids;
  try {
    const { rows } = await db.query('SELECT value_json FROM settings WHERE key = $1 LIMIT 1', [SETTING_KEY]);
    const ids = parseIds(rows[0] ? rows[0].value_json : null);
    _cache = { at: now, ids, loaded: true };
    return ids;
  } catch (_) {
    return _cache.ids;
  }
}

/** true, если у viewer есть доступ к дружине (по роли или по гранту). */
async function hasPersonnelAccess(db, viewer) {
  const role = viewer && viewer.role;
  if (role && PERSONNEL_BASE_ROLES.includes(role)) return true;
  const id = viewer && parseInt(viewer.id, 10);
  if (!Number.isFinite(id) || id <= 0) return false;
  const ids = await loadIds(db);
  return ids.has(id);
}

async function getPersonnelViewerIds(db) {
  return Array.from(await loadIds(db));
}

function clearCache() { _cache = { at: 0, ids: new Set(), loaded: false }; }

module.exports = {
  hasPersonnelAccess,
  getPersonnelViewerIds,
  loadIds,
  parseIds,
  clearCache,
  PERSONNEL_BASE_ROLES,
  SETTING_KEY,
};
