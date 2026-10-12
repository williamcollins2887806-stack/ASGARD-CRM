'use strict';

/**
 * Персональный доступ к «Общему табелю» (Timesheet v2, mode=global).
 * ═══════════════════════════════════════════════════════════════════════════
 * Механизм: список user_id в settings.timesheet_global_viewer_user_ids (JSON-массив).
 *
 * Это НЕ роль — роль пользователя остаётся прежней (например PM). Грант даёт
 * ТОЛЬКО чтение общего табеля в «полном» директорском профиле (view_profile=full,
 * экспорт Excel, карточка кассы). Запись/закрытие месяца грант НЕ даёт: режим
 * остаётся read-only (ответ помечается granted_readonly=true).
 *
 * Список живёт в БД, а не в коде: состав меняется без деплоя.
 * Кэш 60 c — список правится вручную, но не хочется бить БД на каждый запрос.
 */

const SETTING_KEY = 'timesheet_global_viewer_user_ids';
const CACHE_TTL_MS = 60 * 1000;

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
    // Только строго целые положительные id: `parseInt(1.9)` дало бы 1 —
    // молчаливый грант не тому пользователю. Строки-числа допускаем.
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
    // Нет таблицы/ключа — никого не грантуем. Кэш не отравляем.
    return _cache.ids;
  }
}

/** true, если viewer.id в персональном списке «видящих общий табель». */
async function isGlobalViewerGranted(db, viewer) {
  const id = viewer && parseInt(viewer.id, 10);
  if (!Number.isFinite(id) || id <= 0) return false;
  const ids = await loadIds(db);
  return ids.has(id);
}

function clearCache() { _cache = { at: 0, ids: new Set(), loaded: false }; }

module.exports = { isGlobalViewerGranted, loadIds, parseIds, clearCache, SETTING_KEY };
