'use strict';

/**
 * ASGARD ND — shared core for electronic work permits (наряды-допуски).
 */

const MASTER_ROLES = new Set(['shift_master', 'senior_master']);
const ISSUED_STATUSES = new Set(['issued', 'active', 'extended', 'closed']);
const EDITABLE_AFTER_ISSUE = new Set(['ppe_text', 'emergency_text']);

function isMasterRole(role) {
  return MASTER_ROLES.has(String(role || ''));
}

async function getActiveAssignment(db, employeeId, workId) {
  const { rows } = await db.query(
    `SELECT ea.*, e.fio
     FROM employee_assignments ea
     JOIN employees e ON e.id = ea.employee_id
     WHERE ea.employee_id = $1 AND ea.work_id = $2 AND ea.is_active = true
     ORDER BY ea.id DESC LIMIT 1`,
    [employeeId, workId]
  );
  return rows[0] || null;
}

async function assertMasterOnWork(db, employeeId, workId) {
  const a = await getActiveAssignment(db, employeeId, workId);
  if (!a || !isMasterRole(a.field_role)) {
    const err = new Error('Требуется роль мастера на этой работе');
    err.statusCode = 403;
    throw err;
  }
  return a;
}

async function logEvent(db, permitId, eventType, { userId = null, employeeId = null, payload = {} } = {}) {
  await db.query(
    `INSERT INTO nd_events (permit_id, event_type, actor_user_id, actor_employee_id, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [permitId, eventType, userId, employeeId, JSON.stringify(payload || {})]
  );
}

async function pushInbox(db, employeeIds, { permitId, kind, title, body }) {
  const ids = [...new Set((employeeIds || []).filter(Boolean))];
  for (const empId of ids) {
    await db.query(
      `INSERT INTO nd_inbox (employee_id, permit_id, kind, title, body) VALUES ($1,$2,$3,$4,$5)`,
      [empId, permitId || null, kind, title, body || null]
    );
  }
}

async function nextPermitNumber(dbOrClient, workId) {
  // Prefer transaction client so advisory_xact_lock actually holds.
  const run = async (q) => {
    await q(`SELECT pg_advisory_xact_lock($1)`, [2000000000 + Number(workId)]);
    const { rows: w } = await q(
      `SELECT COALESCE(work_number, id::text) AS wn FROM works WHERE id = $1`,
      [workId]
    );
    const wn = String((w[0] && w[0].wn) || workId).replace(/\s+/g, '');
    const year = new Date().getFullYear();
    const { rows: seq } = await q(
      `SELECT COALESCE(MAX(
         NULLIF(substring(number from '(\\d+)$'), '')::int
       ), 0)::int AS c
       FROM nd_permits
       WHERE work_id = $1
         AND number LIKE $2`,
      [workId, `НД-${wn}-${year}-%`]
    );
    const n = (seq[0]?.c || 0) + 1;
    return `НД-${wn}-${year}-${String(n).padStart(3, '0')}`;
  };

  if (dbOrClient && typeof dbOrClient.transaction === 'function') {
    return dbOrClient.transaction(async (client) => run(client.query.bind(client)));
  }
  if (dbOrClient && typeof dbOrClient.query === 'function') {
    // Already inside a transaction client
    return run(dbOrClient.query.bind(dbOrClient));
  }
  throw new Error('nextPermitNumber: invalid db handle');
}

async function loadPermitFull(db, permitId) {
  const { rows } = await db.query(
    `SELECT p.*,
            ft.title AS form_title, ft.legal_basis, ft.template_ready, ft.schema_json,
            w.work_title, w.work_number, w.object_name, w.address, w.city, w.customer_name,
            cu.name AS created_by_name,
            ie.fio AS issued_by_name
     FROM nd_permits p
     JOIN nd_form_templates ft ON ft.id = p.form_template_id
     JOIN works w ON w.id = p.work_id
     LEFT JOIN users cu ON cu.id = p.created_by_user_id
     LEFT JOIN employees ie ON ie.id = p.issued_by_employee_id
     WHERE p.id = $1`,
    [permitId]
  );
  if (!rows[0]) return null;
  const permit = rows[0];
  const [crew, equipment, risks, acks, daily, extensions, closures] = await Promise.all([
    db.query(`SELECT * FROM nd_permit_crew WHERE permit_id = $1 ORDER BY sort_order, id`, [permitId]),
    db.query(`SELECT * FROM nd_permit_equipment WHERE permit_id = $1 ORDER BY sort_order, id`, [permitId]),
    db.query(`SELECT * FROM nd_permit_risks WHERE permit_id = $1 ORDER BY sort_order, id`, [permitId]),
    db.query(
      `SELECT a.*, e.fio FROM nd_acks a JOIN employees e ON e.id = a.employee_id
       WHERE a.permit_id = $1 ORDER BY a.ack_at`,
      [permitId]
    ),
    db.query(`SELECT * FROM nd_daily WHERE permit_id = $1 ORDER BY work_date DESC`, [permitId]),
    db.query(`SELECT * FROM nd_extensions WHERE permit_id = $1 ORDER BY id DESC`, [permitId]),
    db.query(
      `SELECT c.*, r.risk_title FROM nd_risk_closures c
       JOIN nd_permit_risks r ON r.id = c.permit_risk_id
       WHERE r.permit_id = $1`,
      [permitId]
    ),
  ]);
  permit.crew = crew.rows;
  permit.equipment = equipment.rows;
  permit.risks = risks.rows.map((r) => {
    const cl = closures.rows.find((c) => c.permit_risk_id === r.id);
    return { ...r, closure: cl || null };
  });
  permit.acks = acks.rows;
  permit.daily = daily.rows;
  permit.extensions = extensions.rows;
  return permit;
}

async function replaceCrew(db, permitId, crew) {
  await db.query(`DELETE FROM nd_permit_crew WHERE permit_id = $1`, [permitId]);
  const list = Array.isArray(crew) ? crew : [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const fio = String(c.fio || '').trim();
    if (!fio) continue;
    await db.query(
      `INSERT INTO nd_permit_crew (permit_id, employee_id, fio, profession, role_in_permit, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [permitId, c.employee_id || null, fio, c.profession || null, c.role_in_permit || 'member', i]
    );
  }
}

async function replaceEquipment(db, permitId, equipment) {
  await db.query(`DELETE FROM nd_permit_equipment WHERE permit_id = $1`, [permitId]);
  const list = Array.isArray(equipment) ? equipment : [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const name = String(e.name || '').trim();
    if (!name) continue;
    await db.query(
      `INSERT INTO nd_permit_equipment (permit_id, equipment_id, name, qty, note, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [permitId, e.equipment_id || null, name, e.qty || '1', e.note || null, i]
    );
  }
}

async function replaceRisks(db, permitId, risks) {
  await db.query(
    `DELETE FROM nd_risk_closures WHERE permit_risk_id IN (SELECT id FROM nd_permit_risks WHERE permit_id = $1)`,
    [permitId]
  );
  await db.query(`DELETE FROM nd_permit_risks WHERE permit_id = $1`, [permitId]);
  const list = Array.isArray(risks) ? risks : [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    const title = String(r.risk_title || r.title || '').trim();
    if (!title) continue;
    const measureTitles = Array.isArray(r.measure_titles) ? r.measure_titles : [];
    const measureIds = Array.isArray(r.measure_ids)
      ? r.measure_ids.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      : [];
    const { rows } = await db.query(
      `INSERT INTO nd_permit_risks (permit_id, risk_id, risk_title, measure_ids, measure_titles, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [permitId, r.risk_id || null, title, measureIds, measureTitles, i]
    );
    await db.query(
      `INSERT INTO nd_risk_closures (permit_risk_id, is_closed) VALUES ($1, false)`,
      [rows[0].id]
    );
  }
}

async function notifyWorkMasters(db, workId, permitId, title, body, kind) {
  const { rows } = await db.query(
    `SELECT DISTINCT employee_id FROM employee_assignments
     WHERE work_id = $1 AND is_active = true AND field_role = ANY($2)`,
    [workId, [...MASTER_ROLES]]
  );
  await pushInbox(
    db,
    rows.map((r) => r.employee_id),
    { permitId, kind, title, body }
  );
}

async function notifyPermitCrew(db, permitId, title, body, kind) {
  const { rows } = await db.query(
    `SELECT DISTINCT employee_id FROM nd_permit_crew WHERE permit_id = $1 AND employee_id IS NOT NULL`,
    [permitId]
  );
  await pushInbox(
    db,
    rows.map((r) => r.employee_id),
    { permitId, kind, title, body }
  );
}

module.exports = {
  MASTER_ROLES,
  ISSUED_STATUSES,
  EDITABLE_AFTER_ISSUE,
  isMasterRole,
  getActiveAssignment,
  assertMasterOnWork,
  logEvent,
  pushInbox,
  nextPermitNumber,
  loadPermitFull,
  replaceCrew,
  replaceEquipment,
  replaceRisks,
  notifyWorkMasters,
  notifyPermitCrew,
};
