/**
 * Расчёт ставки назначения в бригаде: база + доплата в рублях (с 01.11.2026).
 * Используется POST /crew и вспомогательными хелперами чекина/табеля.
 *
 * Канон: amount_earned / day_rate — всегда рубли. Баллы legacy только для чтения.
 */

const DEFAULT_POINT_VALUE = 500;

/**
 * Округлить до шага 10 ₽ (ставки/доплаты).
 * @param {number|string|null|undefined} value
 * @returns {number}
 */
function snapRubStep10(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n / 10) * 10;
}

/**
 * Валидация: сумма кратна 10 (или 0).
 * @param {number|string|null|undefined} value
 * @returns {boolean}
 */
function isRubStep10(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return false;
  return Math.abs(n * 10 - Math.round(n * 10)) < 1e-9 && Math.round(n) % 10 === 0;
}

/**
 * @param {object} db — pg pool / fastify.db
 * @param {{
 *   tariff_id?: number|null,
 *   combination_tariff_id?: number|null,
 *   combo_tariff_ids?: number[]|null,
 *   manual_extra_points?: number|string|null,
 *   manual_extra_rub?: number|string|null,
 *   day_rate_rub?: number|string|null,
 * }} opts
 */
async function resolveAssignmentRates(db, opts = {}) {
  const tariffId = opts.tariff_id ? Number(opts.tariff_id) : null;
  let comboIds = Array.isArray(opts.combo_tariff_ids)
    ? opts.combo_tariff_ids.map(Number).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  if (!comboIds.length && opts.combination_tariff_id) {
    const one = Number(opts.combination_tariff_id);
    if (Number.isFinite(one) && one > 0) comboIds = [one];
  }
  comboIds = [...new Set(comboIds)];

  let pointValue = DEFAULT_POINT_VALUE;
  let baseRate = 0;
  let basePoints = 0;
  let tariffRow = null;

  if (tariffId) {
    const { rows } = await db.query(
      `SELECT * FROM field_tariff_grid WHERE id = $1 AND is_active = true`,
      [tariffId]
    );
    if (!rows.length) {
      return { error: 'Тариф не найден', tariffId, comboIds };
    }
    tariffRow = rows[0];
    baseRate = parseFloat(tariffRow.rate_per_shift) || 0;
    basePoints = Number(tariffRow.points) || 0;
    if (tariffRow.point_value != null) {
      pointValue = parseFloat(tariffRow.point_value) || DEFAULT_POINT_VALUE;
    }
  }

  // Явная БАЗОВАЯ ставка в ₽ (без доплаты). Доплата — отдельно в manual_extra_rub.
  // Клиент НЕ должен слать итог (база+доплата) в day_rate_rub — иначе DOUBLE.
  let explicitDayRate = null;
  if (opts.day_rate_rub != null && opts.day_rate_rub !== '') {
    const dr = Number(opts.day_rate_rub);
    if (Number.isFinite(dr) && dr >= 0) {
      explicitDayRate = snapRubStep10(dr);
      baseRate = explicitDayRate;
      basePoints = pointValue > 0 ? Math.round((explicitDayRate / pointValue) * 100) / 100 : 0;
    }
  }

  // Доплата в рублях (новый канон). Legacy: manual_extra_points × point_value + combo rates.
  let manualExtraRub = null;
  if (opts.manual_extra_rub != null && opts.manual_extra_rub !== '') {
    const mr = Number(opts.manual_extra_rub);
    if (Number.isFinite(mr) && mr >= 0) manualExtraRub = snapRubStep10(mr);
  }

  let comboRate = 0;
  let comboPoints = 0;
  const comboRows = [];
  if (comboIds.length) {
    const { rows } = await db.query(
      `SELECT * FROM field_tariff_grid
       WHERE id = ANY($1::int[]) AND is_combinable = true AND is_active = true`,
      [comboIds]
    );
    const byId = new Map(rows.map((r) => [Number(r.id), r]));
    for (const id of comboIds) {
      const row = byId.get(id);
      if (!row) continue;
      comboRows.push(row);
      comboRate += parseFloat(row.rate_per_shift) || 0;
      comboPoints += Number(row.points) || 0;
    }
  }

  let manualPoints = 0;
  let manualRate = 0;
  if (manualExtraRub != null) {
    // Новый путь: доплата уже в ₽; combo галочки не добавляем (свёрнуты в доплату)
    manualRate = manualExtraRub;
    manualPoints = pointValue > 0 ? Math.round((manualExtraRub / pointValue) * 100) / 100 : 0;
    comboRate = 0;
    comboPoints = 0;
    comboIds = [];
  } else {
    let manual = Number(opts.manual_extra_points);
    if (!Number.isFinite(manual) || manual < 0) manual = 0;
    manual = Math.round(manual * 100) / 100;
    manualPoints = manual;
    manualRate = manual * pointValue;
  }

  const totalRate = snapRubStep10(baseRate + comboRate + manualRate);
  const totalPoints = Math.round((basePoints + comboPoints + manualPoints) * 100) / 100;
  const primaryComboId = comboIds[0] || null;

  return {
    tariffId,
    tariffRow,
    comboIds,
    comboRows,
    primaryComboId,
    baseRate,
    basePoints,
    comboRate,
    comboPoints,
    manualPoints,
    manualRate,
    manualExtraRub: manualExtraRub != null ? manualExtraRub : snapRubStep10(manualRate + comboRate),
    dayRateRub: totalRate,
    pointValue,
    totalPoints,
    totalRate,
    explicitDayRate
  };
}

/**
 * SQL-фрагмент доплаты в ₽ (prefer manual_extra_rub, fallback legacy points×pv + combo).
 */
function sqlAssignmentExtraRateExpr(eaAlias = 'ea') {
  return `(
    CASE
      WHEN COALESCE(${eaAlias}.manual_extra_rub, 0) > 0 THEN COALESCE(${eaAlias}.manual_extra_rub, 0)
      ELSE (
        COALESCE((
          SELECT SUM(COALESCE(ctg.rate_per_shift, 0))
          FROM unnest(COALESCE(${eaAlias}.combo_tariff_ids, ARRAY[]::int[])) AS cid(id)
          LEFT JOIN field_tariff_grid ctg ON ctg.id = cid.id
        ), 0)
        + CASE
            WHEN COALESCE(cardinality(${eaAlias}.combo_tariff_ids), 0) = 0
                 AND ${eaAlias}.combination_tariff_id IS NOT NULL
            THEN COALESCE((
              SELECT rate_per_shift FROM field_tariff_grid WHERE id = ${eaAlias}.combination_tariff_id
            ), 0)
            ELSE 0
          END
        + COALESCE(${eaAlias}.manual_extra_points, 0) * COALESCE(
            (SELECT point_value FROM field_tariff_grid WHERE id = ${eaAlias}.tariff_id),
            500
          )
      )
    END
  )`;
}

/**
 * Legacy: «баллы доплаты» для старых отчётов (из рублёвой доплаты / 500).
 */
function sqlAssignmentExtraPointsExpr(eaAlias = 'ea') {
  return `(
    CASE
      WHEN COALESCE(${eaAlias}.manual_extra_rub, 0) > 0 THEN
        ROUND(
          COALESCE(${eaAlias}.manual_extra_rub, 0)
          / COALESCE(
              (SELECT point_value FROM field_tariff_grid WHERE id = ${eaAlias}.tariff_id),
              500
            )
        , 2)
      ELSE (
        COALESCE((
          SELECT SUM(COALESCE(ctg.points, 0))
          FROM unnest(COALESCE(${eaAlias}.combo_tariff_ids, ARRAY[]::int[])) AS cid(id)
          LEFT JOIN field_tariff_grid ctg ON ctg.id = cid.id
        ), 0)
        + CASE
            WHEN COALESCE(cardinality(${eaAlias}.combo_tariff_ids), 0) = 0
                 AND ${eaAlias}.combination_tariff_id IS NOT NULL
            THEN COALESCE((
              SELECT points FROM field_tariff_grid WHERE id = ${eaAlias}.combination_tariff_id
            ), 0)
            ELSE 0
          END
        + COALESCE(${eaAlias}.manual_extra_points, 0)
      )
    END
  )`;
}

module.exports = {
  DEFAULT_POINT_VALUE,
  snapRubStep10,
  isRubStep10,
  resolveAssignmentRates,
  sqlAssignmentExtraPointsExpr,
  sqlAssignmentExtraRateExpr
};
