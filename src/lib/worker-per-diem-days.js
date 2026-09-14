'use strict';

/**
 * Единый календарь дней суточных (SSoT для per_diem_accrued).
 *
 * Правила:
 *  - любой field_trip_stages (МО/дорога/склад/обучение/корабль/вертолёт/ожидание)
 *    → день суточных (status не cancelled/rejected)
 *  - field_checkins (объект) → день суточных ТОЛЬКО если:
 *      ставка > 0 И fps.per_diem_on_checkins = true (дефолт true)
 *  - Флаг per_diem_on_checkins=false: смены на объекте без суточных
 *    (типично МЛСП / вахта на платформе); этапы дороги/МО/склада — как обычно
 *  - один календарный день = 1× ставка (DISTINCT date)
 *  - work_id может быть NULL (обучение/МО без объекта)
 *
 * Ставка: ea.per_diem → fps.per_diem → settings.per_diem_default → 1000
 * Важно: ставка 0 — валидна («выключено»); не подменять через `|| default`.
 */

const STAGE_TYPES = [
  'warehouse', 'medical', 'travel', 'ship', 'training', 'helicopter', 'waiting',
];

async function loadDefaultPerDiem(db) {
  try {
    const { rows } = await db.query(
      `SELECT value_json FROM settings WHERE key = 'per_diem_default' LIMIT 1`
    );
    if (rows[0]) {
      const v = typeof rows[0].value_json === 'string'
        ? JSON.parse(rows[0].value_json)
        : rows[0].value_json;
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  } catch (_) { /* ignore */ }
  return 1000;
}

/**
 * @param {object} db
 * @param {number} empId
 * @param {object} [opts]
 * @param {number|null} [opts.year]
 * @param {number|null} [opts.month]  1–12; требует year
 * @param {string|null} [opts.from]   YYYY-MM-DD
 * @param {string|null} [opts.to]     YYYY-MM-DD
 * @param {number|null} [opts.workId]
 * @param {boolean} [opts.includeOrphans=true]
 * @param {boolean} [opts.orphansOnly=false]
 */
async function getPerDiemDays(db, empId, opts = {}) {
  const year = opts.year || null;
  const month = opts.month != null ? Number(opts.month) : null;
  const workId = opts.workId != null ? Number(opts.workId) : null;
  const orphansOnly = !!opts.orphansOnly;
  const includeOrphans = opts.includeOrphans !== false;

  const defaultRate = await loadDefaultPerDiem(db);

  const params = [empId];
  let p = 2;
  let yearFilterStage = '';
  let yearFilterCi = '';
  if (opts.from && opts.to) {
    yearFilterStage = `AND d.day BETWEEN $${p}::date AND $${p + 1}::date`;
    yearFilterCi = `AND fc.date BETWEEN $${p}::date AND $${p + 1}::date`;
    params.push(opts.from, opts.to);
    p += 2;
  } else if (year && month >= 1 && month <= 12) {
    yearFilterStage = `AND EXTRACT(YEAR FROM d.day) = $${p} AND EXTRACT(MONTH FROM d.day) = $${p + 1}`;
    yearFilterCi = `AND EXTRACT(YEAR FROM fc.date) = $${p} AND EXTRACT(MONTH FROM fc.date) = $${p + 1}`;
    params.push(year, month);
    p += 2;
  } else if (year) {
    yearFilterStage = `AND EXTRACT(YEAR FROM d.day) = $${p}`;
    yearFilterCi = `AND EXTRACT(YEAR FROM fc.date) = $${p}`;
    params.push(year);
    p += 1;
  }

  let workFilterStage = '';
  let workFilterCi = '';
  if (orphansOnly) {
    workFilterStage = 'AND fts.work_id IS NULL';
    workFilterCi = 'AND FALSE';
  } else if (workId != null && Number.isFinite(workId)) {
    if (includeOrphans) {
      workFilterStage = `AND (fts.work_id = $${p} OR fts.work_id IS NULL)`;
      workFilterCi = `AND fc.work_id = $${p}`;
    } else {
      workFilterStage = `AND fts.work_id = $${p}`;
      workFilterCi = `AND fc.work_id = $${p}`;
    }
    params.push(workId);
  }

  const stageTypesSql = STAGE_TYPES.map((t) => `'${t}'`).join(',');

  const sql = `
    WITH stage_days AS (
      SELECT
        fts.employee_id,
        d.day::date AS day,
        fts.work_id,
        'stage'::text AS source,
        fts.stage_type
      FROM field_trip_stages fts
      CROSS JOIN LATERAL generate_series(
        fts.date_from::date,
        COALESCE(fts.date_to, fts.date_from)::date,
        '1 day'::interval
      ) AS d(day)
      WHERE fts.employee_id = $1
        AND COALESCE(fts.status, 'active') NOT IN ('cancelled', 'rejected')
        AND fts.stage_type IN (${stageTypesSql})
        ${workFilterStage}
        ${yearFilterStage}
    ),
    checkin_days AS (
      SELECT
        fc.employee_id,
        fc.date::date AS day,
        fc.work_id,
        'checkin'::text AS source,
        fc.shift::text AS stage_type
      FROM field_checkins fc
      LEFT JOIN employee_assignments ea ON ea.id = fc.assignment_id
      LEFT JOIN field_project_settings fps ON fps.work_id = fc.work_id
      WHERE fc.employee_id = $1
        AND fc.status = 'completed'
        AND COALESCE(NULLIF(ea.per_diem, 0), NULLIF(fps.per_diem, 0), 0) > 0
        -- Флаг: суточные за смены на объекте (по умолчанию да)
        AND COALESCE(fps.per_diem_on_checkins, true) = true
        ${workFilterCi}
        ${yearFilterCi}
    ),
    unioned AS (
      SELECT * FROM stage_days
      UNION ALL
      SELECT * FROM checkin_days
    ),
    dedup AS (
      SELECT DISTINCT ON (employee_id, day)
        employee_id, day, work_id, source, stage_type
      FROM unioned
      ORDER BY employee_id, day,
        CASE WHEN work_id IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN source = 'stage' THEN 0 ELSE 1 END
    )
    SELECT
      d.day::text AS day,
      d.work_id,
      d.source,
      d.stage_type,
      COALESCE(
        NULLIF((
          SELECT ea.per_diem FROM employee_assignments ea
          WHERE ea.employee_id = d.employee_id
            AND (d.work_id IS NULL OR ea.work_id = d.work_id)
            AND COALESCE(ea.is_active, true) = true
          ORDER BY
            CASE WHEN d.work_id IS NOT NULL AND ea.work_id = d.work_id THEN 0 ELSE 1 END,
            ea.id DESC
          LIMIT 1
        ), 0),
        NULLIF((
          SELECT fps.per_diem FROM field_project_settings fps
          WHERE d.work_id IS NOT NULL AND fps.work_id = d.work_id
          LIMIT 1
        ), 0),
        $DEFAULT_RATE::numeric
      ) AS rate
    FROM dedup d
    ORDER BY d.day
  `.replace(/\$DEFAULT_RATE/g, String(defaultRate));

  const { rows } = await db.query(sql, params);

  function resolveRate(raw) {
    const n = parseFloat(raw);
    return Number.isFinite(n) && n >= 0 ? n : defaultRate;
  }

  const byWork = {};
  for (const r of rows) {
    const key = r.work_id == null ? '__null' : String(r.work_id);
    if (!byWork[key]) {
      byWork[key] = {
        work_id: r.work_id == null ? null : Number(r.work_id),
        days: 0,
        rate: resolveRate(r.rate),
        accrued: 0,
      };
    }
    const rate = resolveRate(r.rate);
    byWork[key].days += 1;
    byWork[key].rate = rate;
    byWork[key].accrued += rate;
  }

  let totalDays = 0;
  let totalAccrued = 0;
  for (const b of Object.values(byWork)) {
    totalDays += b.days;
    totalAccrued += b.accrued;
  }

  return {
    days: rows.map((r) => ({
      day: r.day,
      work_id: r.work_id == null ? null : Number(r.work_id),
      source: r.source,
      stage_type: r.stage_type || null,
      rate: resolveRate(r.rate),
    })),
    by_work: byWork,
    total_days: totalDays,
    total_accrued: totalAccrued,
    default_rate: defaultRate,
  };
}

/**
 * Начисление суточных за календарный месяц по списку сотрудников.
 * Один день = одна ставка (этап бьёт смену). МЛСП-вахта не входит.
 * @returns {Record<number, { accrued: number, days: number }>}
 */
async function getPerDiemAccruedMap(db, empIds, year, month) {
  const ids = (empIds || []).map((x) => Number(x)).filter((n) => Number.isFinite(n));
  const out = {};
  if (!ids.length || !year || !month) return out;

  const defaultRate = await loadDefaultPerDiem(db);
  const y = Number(year);
  const m = Number(month);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const last = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  const stageTypesSql = STAGE_TYPES.map((t) => `'${t}'`).join(',');

  const sql = `
    WITH stage_days AS (
      SELECT
        fts.employee_id,
        d.day::date AS day,
        fts.work_id,
        'stage'::text AS source
      FROM field_trip_stages fts
      CROSS JOIN LATERAL generate_series(
        fts.date_from::date,
        COALESCE(fts.date_to, fts.date_from)::date,
        '1 day'::interval
      ) AS d(day)
      WHERE fts.employee_id = ANY($1::int[])
        AND COALESCE(fts.status, 'active') NOT IN ('cancelled', 'rejected')
        AND fts.stage_type IN (${stageTypesSql})
        AND d.day BETWEEN $2::date AND $3::date
    ),
    checkin_days AS (
      SELECT
        fc.employee_id,
        fc.date::date AS day,
        fc.work_id,
        'checkin'::text AS source
      FROM field_checkins fc
      LEFT JOIN employee_assignments ea ON ea.id = fc.assignment_id
      LEFT JOIN field_project_settings fps ON fps.work_id = fc.work_id
      WHERE fc.employee_id = ANY($1::int[])
        AND fc.status = 'completed'
        AND fc.date BETWEEN $2::date AND $3::date
        AND COALESCE(fps.per_diem_on_checkins, true) = true
        AND COALESCE(NULLIF(ea.per_diem, 0), NULLIF(fps.per_diem, 0), 0) > 0
    ),
    unioned AS (
      SELECT * FROM stage_days
      UNION ALL
      SELECT * FROM checkin_days
    ),
    dedup AS (
      SELECT DISTINCT ON (employee_id, day)
        employee_id, day, work_id, source
      FROM unioned
      ORDER BY employee_id, day,
        CASE WHEN work_id IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN source = 'stage' THEN 0 ELSE 1 END
    )
    SELECT
      d.employee_id,
      COUNT(*)::int AS days,
      SUM(
        COALESCE(
          NULLIF((
            SELECT ea.per_diem FROM employee_assignments ea
            WHERE ea.employee_id = d.employee_id
              AND (d.work_id IS NULL OR ea.work_id = d.work_id)
              AND COALESCE(ea.is_active, true) = true
            ORDER BY
              CASE WHEN d.work_id IS NOT NULL AND ea.work_id = d.work_id THEN 0 ELSE 1 END,
              ea.id DESC
            LIMIT 1
          ), 0),
          NULLIF((
            SELECT fps.per_diem FROM field_project_settings fps
            WHERE d.work_id IS NOT NULL AND fps.work_id = d.work_id
            LIMIT 1
          ), 0),
          $DEFAULT_RATE::numeric
        )
      )::numeric AS accrued
    FROM dedup d
    GROUP BY d.employee_id
  `.replace(/\$DEFAULT_RATE/g, String(defaultRate));

  const { rows } = await db.query(sql, [ids, from, to]);
  for (const r of rows) {
    out[Number(r.employee_id)] = {
      days: Number(r.days) || 0,
      accrued: Math.round(Number(r.accrued) || 0),
    };
  }
  return out;
}

module.exports = {
  getPerDiemDays,
  getPerDiemAccruedMap,
  loadDefaultPerDiem,
  STAGE_TYPES,
};
