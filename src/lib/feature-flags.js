'use strict';

/**
 * Фичефлаги Doc Hub (V394, план §12).
 * ═══════════════════════════════════════════════════════════════════════════
 * За флагом `feature_doc_traffic_light` (settings, по умолчанию false):
 *   • светофор 4 цветов, фильтр ?traffic=, новые KPI;
 *   • корректировки СФ/акта (action=correction);
 *   • вкладка «Акты сверки»;
 *   • крон-дайджест, TTL-архивация.
 * НЕ за флагом (применяется всегда): миграции, backfill, новые поля API —
 * они возвращаются, но UI их не показывает, пока флаг выключен.
 *
 * Откат: выключить флаг → система возвращается к старому поведению
 * (старые KPI/light, корректировки закрыты) без потери данных.
 */

const FLAG_KEY = 'feature_doc_traffic_light';

// Кэш на короткое время, чтобы не дёргать settings на каждый запрос.
let _cache = { value: null, at: 0 };
const TTL_MS = 15_000;

/** Включён ли светофор/корректировки/акты (по settings). */
async function isTrafficLightEnabled(db) {
  const now = Date.now();
  if (_cache.value !== null && now - _cache.at < TTL_MS) return _cache.value;
  let enabled = false;
  try {
    const r = await db.query(`SELECT value_json FROM settings WHERE key=$1 LIMIT 1`, [FLAG_KEY]);
    if (r.rows[0]) {
      let v = r.rows[0].value_json;
      try { v = JSON.parse(v); } catch (_) { /* строка как есть */ }
      enabled = v === true || v === 'true' || v === 1 || v === '1';
    }
  } catch (_) { /* нет таблицы/ключа → выключено */ }
  _cache = { value: enabled, at: now };
  return enabled;
}

/** Сбросить кэш (после смены настройки). */
function resetFlagCache() { _cache = { value: null, at: 0 }; }

module.exports = { isTrafficLightEnabled, resetFlagCache, FLAG_KEY };
