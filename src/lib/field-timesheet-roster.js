'use strict';

/**
 * Roster для полевого табеля работы за период [dateFrom, dateTo].
 *
 * Включение (OR):
 *   on_site  — активное назначение без убытия
 *   was_on   — интервал назначения пересекает период
 *              (COALESCE(date_from,created_at) ≤ to AND (departure IS NULL OR departure ≥ from))
 *   marks    — чекин / этап на этой работе в периоде
 *   planned  — активный план привлечения, период плана пересекает (или без дат)
 *
 * Уехал в августе → в августе was_on, в сентябре нет (если нет отметок).
 */

function defaultMonthBoundsMsk() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const y = get('year');
  const m = get('month');
  const last = new Date(Number(y), Number(m), 0).getDate();
  return {
    from: `${y}-${m}-01`,
    to: `${y}-${m}-${String(last).padStart(2, '0')}`
  };
}

/**
 * @param {import('pg').Pool} db
 * @param {number} workId
 * @param {string|null} dateFrom YYYY-MM-DD
 * @param {string|null} dateTo YYYY-MM-DD
 * @returns {Promise<Array<{
 *   employee_id: number,
 *   fio: string,
 *   roster_reasons: string[],
 *   planned_info: null|{planned_from, planned_to, note, inbound_transport},
 *   is_planned_only: boolean
 * }>>}
 */
async function loadFieldTimesheetRoster(db, workId, dateFrom, dateTo) {
  let from = dateFrom ? String(dateFrom).slice(0, 10) : null;
  let to = dateTo ? String(dateTo).slice(0, 10) : null;
  if (!from || !to) {
    const b = defaultMonthBoundsMsk();
    from = from || b.from;
    to = to || b.to;
  }
  if (from > to) {
    const t = from;
    from = to;
    to = t;
  }

  let hasPlanned = true;
  try {
    await db.query(`SELECT 1 FROM employee_planned_engagements LIMIT 0`);
  } catch (_) {
    hasPlanned = false;
  }

  const plannedUnion = hasPlanned ? `
      UNION

      SELECT pe.employee_id, 'planned'
      FROM employee_planned_engagements pe
      JOIN employees e ON e.id = pe.employee_id
      WHERE pe.work_id = $1
        AND pe.status = 'active'
        AND COALESCE(e.is_active, true) = true
        AND (pe.planned_from IS NULL OR pe.planned_from <= $3::date)
        AND (pe.planned_to IS NULL OR pe.planned_to >= $2::date)
  ` : '';

  const plannedLateral = hasPlanned ? `
    LEFT JOIN LATERAL (
      SELECT planned_from, planned_to, note, inbound_transport
      FROM employee_planned_engagements
      WHERE employee_id = e.id AND work_id = $1 AND status = 'active'
      ORDER BY id DESC
      LIMIT 1
    ) pe ON true
  ` : `
    LEFT JOIN LATERAL (
      SELECT NULL::date AS planned_from, NULL::date AS planned_to,
             NULL::text AS note, NULL::text AS inbound_transport
    ) pe ON true
  `;

  const { rows } = await db.query(`
    WITH reasons AS (
      SELECT ea.employee_id, 'on_site'::text AS reason
      FROM employee_assignments ea
      JOIN employees e ON e.id = ea.employee_id
      WHERE ea.work_id = $1
        AND COALESCE(e.is_active, true) = true
        AND COALESCE(ea.is_active, true) = true
        AND ea.departure_date IS NULL

      UNION

      SELECT ea.employee_id, 'was_on'
      FROM employee_assignments ea
      JOIN employees e ON e.id = ea.employee_id
      WHERE ea.work_id = $1
        AND COALESCE(e.is_active, true) = true
        AND COALESCE(ea.date_from, ea.created_at)::date <= $3::date
        AND (ea.departure_date IS NULL OR ea.departure_date >= $2::date)

      UNION

      SELECT fc.employee_id, 'marks'
      FROM field_checkins fc
      JOIN employees e ON e.id = fc.employee_id
      WHERE fc.work_id = $1
        AND fc.status <> 'cancelled'
        AND COALESCE(e.is_active, true) = true
        AND fc.date BETWEEN $2::date AND $3::date

      UNION

      SELECT fts.employee_id, 'marks'
      FROM field_trip_stages fts
      JOIN employees e ON e.id = fts.employee_id
      WHERE fts.work_id = $1
        AND COALESCE(e.is_active, true) = true
        AND COALESCE(fts.status, 'active') NOT IN ('rejected', 'cancelled')
        AND fts.date_from <= $3::date
        AND COALESCE(fts.date_to, fts.date_from) >= $2::date
      ${plannedUnion}
    )
    SELECT
      e.id AS employee_id,
      COALESCE(e.fio, e.full_name) AS fio,
      array_agg(DISTINCT r.reason ORDER BY r.reason) AS roster_reasons,
      pe.planned_from,
      pe.planned_to,
      pe.note AS plan_note,
      pe.inbound_transport
    FROM reasons r
    JOIN employees e ON e.id = r.employee_id
    ${plannedLateral}
    GROUP BY e.id, e.fio, e.full_name,
             pe.planned_from, pe.planned_to, pe.note, pe.inbound_transport
    ORDER BY fio
  `, [workId, from, to]);

  return rows.map((row) => {
    const reasons = Array.isArray(row.roster_reasons) ? row.roster_reasons.filter(Boolean) : [];
    const hasPlan = reasons.includes('planned') || row.planned_from || row.planned_to || row.plan_note;
    const isPlannedOnly = reasons.length > 0
      && reasons.every((r) => r === 'planned');
    return {
      employee_id: row.employee_id,
      fio: row.fio,
      roster_reasons: reasons,
      planned_info: hasPlan ? {
        planned_from: row.planned_from ? String(row.planned_from).slice(0, 10) : null,
        planned_to: row.planned_to ? String(row.planned_to).slice(0, 10) : null,
        note: row.plan_note || null,
        inbound_transport: row.inbound_transport || null
      } : null,
      is_planned_only: isPlannedOnly
    };
  });
}

module.exports = {
  loadFieldTimesheetRoster,
  defaultMonthBoundsMsk
};
