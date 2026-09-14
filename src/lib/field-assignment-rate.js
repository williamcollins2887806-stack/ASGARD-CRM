/**
 * Расчёт ставки назначения в бригаде: база + совмещения + ручная доплата.
 * Используется POST /crew и вспомогательными хелперами чекина/табеля.
 */

const DEFAULT_POINT_VALUE = 500;

/**
 * @param {object} db — pg pool / fastify.db
 * @param {{ tariff_id?: number|null, combination_tariff_id?: number|null, combo_tariff_ids?: number[]|null, manual_extra_points?: number|string|null }} opts
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
  // unique preserve order
  comboIds = [...new Set(comboIds)];

  let manual = Number(opts.manual_extra_points);
  if (!Number.isFinite(manual) || manual < 0) manual = 0;
  // до 2 знаков (3.5)
  manual = Math.round(manual * 100) / 100;

  let baseRate = 0;
  let basePoints = 0;
  let pointValue = DEFAULT_POINT_VALUE;
  let tariffRow = null;

  if (tariffId) {
    const { rows } = await db.query(
      `SELECT * FROM field_tariff_grid WHERE id = $1 AND is_active = true`,
      [tariffId]
    );
    if (!rows.length) {
      return { error: 'Тариф не найден', tariffId, comboIds, manual };
    }
    tariffRow = rows[0];
    baseRate = parseFloat(tariffRow.rate_per_shift) || 0;
    basePoints = Number(tariffRow.points) || 0;
    if (tariffRow.point_value != null) pointValue = parseFloat(tariffRow.point_value) || DEFAULT_POINT_VALUE;
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

  const manualRate = manual * pointValue;
  const totalPoints = basePoints + comboPoints + manual;
  const totalRate = baseRate + comboRate + manualRate;
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
    manualPoints: manual,
    manualRate,
    pointValue,
    totalPoints,
    totalRate
  };
}

/**
 * SQL-фрагмент для суммы доплаты по массиву combo_tariff_ids + manual.
 * Использовать в SELECT с алиасом ea для employee_assignments.
 */
function sqlAssignmentExtraPointsExpr(eaAlias = 'ea') {
  return `(
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
  )`;
}

function sqlAssignmentExtraRateExpr(eaAlias = 'ea') {
  return `(
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
  )`;
}

module.exports = {
  DEFAULT_POINT_VALUE,
  resolveAssignmentRates,
  sqlAssignmentExtraPointsExpr,
  sqlAssignmentExtraRateExpr
};
