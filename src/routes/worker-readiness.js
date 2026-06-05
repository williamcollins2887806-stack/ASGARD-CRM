/**
 * Worker Readiness API
 * ═══════════════════════════════════════════════════════════════════════════
 * Prefix: /api/staff/readiness
 *
 * GET  /                    — список рабочих с группировкой по статусу
 * GET  /stats               — статистика по группам
 * GET  /reasons             — справочник причин неготовности
 * GET  /log/:employee_id    — история изменений статуса
 * PUT  /:employee_id/status — HR обновляет статус (ready/not_ready + дата/причина)
 *
 * Доступ: ADMIN, HR, HR_MANAGER, DIRECTOR_GEN, DIRECTOR_COMM
 */

// READINESS_ROLES — смена статуса готовности (запись). PM сюда НЕ входит (read-only).
const READINESS_ROLES = ['ADMIN', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM'];
// VIEW_ROLES — просмотр списка дружины. PM/HEAD_PM видят всех (свою бригаду — в полевом модуле).
const VIEW_ROLES      = ['ADMIN', 'HR', 'HR_MANAGER', 'PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'TO', 'HEAD_TO'];

const READINESS_REASONS = [
  { key: 'illness',    label: 'Болезнь' },
  { key: 'vacation',   label: 'Отпуск' },
  { key: 'family',     label: 'Семейные обстоятельства' },
  { key: 'training',   label: 'Обучение' },
  { key: 'personal',   label: 'Личные дела' },
  { key: 'legal',      label: 'Юридические вопросы' },
  { key: 'injury',     label: 'Травма на производстве' },
  { key: 'no_contact', label: 'Не выходит на связь' },
  { key: 'refused',    label: 'Отказ без причины' },
  { key: 'other',      label: 'Другое' },
];

async function routes(fastify, options) {
  const db = fastify.db;

  // ─── GET / — список рабочих с группировкой по статусу ─────────────────────
  fastify.get('/', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async (request, reply) => {
    const today = new Date().toISOString().slice(0, 10);

    const { rows: employees } = await db.query(`
      SELECT
        e.id, e.fio, e.phone, e.role_tag, e.position,
        e.rating_avg, e.is_active,
        e.is_self_employed, e.is_officially_employed,
        e.readiness_status, e.readiness_date, e.readiness_reason,
        e.readiness_comment, e.readiness_updated_at,
        e.last_pm_id, e.last_work_id,
        pm.name AS last_pm_name,
        lw.work_title AS last_work_title
      FROM employees e
      LEFT JOIN users pm ON pm.id = e.last_pm_id
      LEFT JOIN works lw ON lw.id = e.last_work_id
      WHERE e.is_active = true
      ORDER BY e.fio
    `);

    if (!employees.length) {
      return { employees: [], groups: { on_site: 0, approved: 0, ready: 0, not_ready: 0, archive: 0 } };
    }

    const empIds = employees.map(e => e.id);

    // Активные назначения на объектах
    const { rows: assignments } = await db.query(`
      SELECT
        ea.employee_id, ea.work_id, ea.field_role,
        ea.departure_date, ea.is_active,
        w.work_title,
        wpm.name AS pm_name
      FROM employee_assignments ea
      LEFT JOIN works w   ON w.id  = ea.work_id
      LEFT JOIN users wpm ON wpm.id = w.pm_id
      WHERE ea.employee_id = ANY($1::int[])
        AND COALESCE(ea.is_active, true) = true
        AND ea.departure_date IS NULL
    `, [empIds]);

    const onSiteByEmp = {};
    for (const a of assignments) {
      if (!onSiteByEmp[a.employee_id]) onSiteByEmp[a.employee_id] = a;
    }

    // Назначения в активных заявках (approved, ещё не added_to_crew)
    const { rows: srAssignments } = await db.query(`
      SELECT
        sra.employee_id, sra.request_id,
        sr.work_id, sr.status_v2,
        w.work_title,
        wpm.name AS pm_name
      FROM staff_request_assignments sra
      JOIN staff_requests sr ON sr.id = sra.request_id
      LEFT JOIN works w   ON w.id  = sr.work_id
      LEFT JOIN users wpm ON wpm.id = w.pm_id
      WHERE sra.employee_id = ANY($1::int[])
        AND sra.status = 'approved'
        AND sr.status_v2 IN ('approved')
    `, [empIds]);

    const approvedByEmp = {};
    for (const a of srAssignments) {
      if (!approvedByEmp[a.employee_id]) approvedByEmp[a.employee_id] = a;
    }

    // Документы — просрочка / скоро истекут
    const { rows: permits } = await db.query(`
      SELECT
        ep.employee_id,
        COUNT(*) FILTER (WHERE ep.expiry_date IS NOT NULL AND ep.expiry_date < CURRENT_DATE)                                            AS expired,
        COUNT(*) FILTER (WHERE ep.expiry_date IS NOT NULL AND ep.expiry_date >= CURRENT_DATE AND ep.expiry_date < CURRENT_DATE + INTERVAL '30 days') AS expiring
      FROM employee_permits ep
      WHERE ep.employee_id = ANY($1::int[])
        AND COALESCE(ep.is_active, true) = true
      GROUP BY ep.employee_id
    `, [empIds]);

    const permitsByEmp = {};
    for (const p of permits) {
      permitsByEmp[p.employee_id] = { expired: Number(p.expired || 0), expiring: Number(p.expiring || 0) };
    }

    // Годовой лимит СЗ
    const { rows: seSum } = await db.query(`
      SELECT employee_id, COALESCE(SUM(transfer_amount), 0) AS transferred_year
      FROM se_transfers
      WHERE employee_id = ANY($1::int[])
        AND year = EXTRACT(YEAR FROM CURRENT_DATE)
        AND status != 'cancelled'
      GROUP BY employee_id
    `, [empIds]);
    const seByEmp = {};
    for (const r of seSum) seByEmp[r.employee_id] = Number(r.transferred_year || 0);

    // Группировка
    const groups = { on_site: 0, approved: 0, ready: 0, not_ready: 0, archive: 0 };
    const enriched = employees.map(e => {
      let effective_status = e.readiness_status || 'unknown';
      let on_site_info = null;
      let approved_info = null;

      if (onSiteByEmp[e.id]) {
        effective_status = 'on_site';
        on_site_info = {
          work_id:    onSiteByEmp[e.id].work_id,
          work_title: onSiteByEmp[e.id].work_title,
          pm_name:    onSiteByEmp[e.id].pm_name,
        };
      } else if (approvedByEmp[e.id]) {
        effective_status = 'approved';
        approved_info = {
          work_id:    approvedByEmp[e.id].work_id,
          work_title: approvedByEmp[e.id].work_title,
          pm_name:    approvedByEmp[e.id].pm_name,
        };
      } else if (e.readiness_status === 'ready') {
        effective_status = (e.readiness_date && e.readiness_date.toISOString
          ? e.readiness_date.toISOString().slice(0,10) > today
          : (typeof e.readiness_date === 'string' && e.readiness_date.slice(0,10) > today))
          ? 'ready_future' : 'ready';
      }

      if (groups[effective_status] !== undefined) groups[effective_status]++;

      return {
        ...e,
        effective_status,
        on_site_info,
        approved_info,
        permits: permitsByEmp[e.id] || { expired: 0, expiring: 0 },
        se_transferred_year: seByEmp[e.id] || 0,
      };
    });

    return { employees: enriched, groups };
  });

  // ─── GET /stats — только цифры по группам ──────────────────────────────────
  fastify.get('/stats', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async () => {
    const { rows } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM employee_assignments ea
          WHERE ea.employee_id = e.id
            AND COALESCE(ea.is_active, true) = true
            AND ea.departure_date IS NULL
        )) AS on_site,
        COUNT(*) FILTER (WHERE e.readiness_status = 'ready' AND (e.readiness_date IS NULL OR e.readiness_date <= CURRENT_DATE)) AS ready,
        COUNT(*) FILTER (WHERE e.readiness_status = 'not_ready') AS not_ready,
        COUNT(*) FILTER (WHERE e.readiness_status = 'archive')   AS archive
      FROM employees e
      WHERE e.is_active = true
    `);
    const r = rows[0] || {};
    return {
      on_site:   Number(r.on_site || 0),
      ready:     Number(r.ready || 0),
      not_ready: Number(r.not_ready || 0),
      archive:   Number(r.archive || 0),
    };
  });

  // ─── GET /reasons — справочник ────────────────────────────────────────────
  fastify.get('/reasons', { preHandler: [fastify.authenticate] }, async () => {
    return { reasons: READINESS_REASONS };
  });

  // ─── GET /log/:employee_id — история ──────────────────────────────────────
  fastify.get('/log/:employee_id', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async (request) => {
    const empId = parseInt(request.params.employee_id, 10);
    const { rows } = await db.query(`
      SELECT
        l.*,
        u.name AS changed_by_name
      FROM worker_readiness_log l
      LEFT JOIN users u ON u.id = l.changed_by
      WHERE l.employee_id = $1
      ORDER BY l.created_at DESC
      LIMIT 100
    `, [empId]);
    return { log: rows };
  });

  // ─── PUT /:employee_id/status — HR обновляет статус ───────────────────────
  fastify.put('/:employee_id/status', { preHandler: [fastify.requireRoles(READINESS_ROLES)] }, async (request, reply) => {
    const empId = parseInt(request.params.employee_id, 10);
    if (!Number.isFinite(empId)) return reply.code(400).send({ error: 'Bad employee_id' });

    const { status, readiness_date, reason, comment } = request.body || {};
    if (!['ready', 'not_ready', 'archive', 'unknown'].includes(status)) {
      return reply.code(400).send({ error: 'Недопустимый статус. Ожидается ready|not_ready|archive|unknown' });
    }
    if (status === 'not_ready' && !reason) {
      return reply.code(400).send({ error: 'Для not_ready обязательна причина' });
    }
    if (status === 'ready' && !readiness_date) {
      return reply.code(400).send({ error: 'Для ready обязательна дата готовности' });
    }
    if (reason && !READINESS_REASONS.find(r => r.key === reason)) {
      return reply.code(400).send({ error: 'Неизвестная причина' });
    }

    const { rows: [existing] } = await db.query(
      'SELECT readiness_status FROM employees WHERE id = $1',
      [empId]
    );
    if (!existing) return reply.code(404).send({ error: 'Сотрудник не найден' });

    const oldStatus = existing.readiness_status;

    await db.query(`
      UPDATE employees SET
        readiness_status     = $1,
        readiness_date       = $2,
        readiness_reason     = $3,
        readiness_comment    = $4,
        readiness_updated_at = NOW(),
        readiness_updated_by = $5,
        updated_at           = NOW()
      WHERE id = $6
    `, [status, status === 'ready' ? readiness_date : null, status === 'not_ready' ? reason : null, comment || null, request.user.id, empId]);

    await db.query(`
      INSERT INTO worker_readiness_log
        (employee_id, old_status, new_status, readiness_date, reason, comment, source, changed_by)
      VALUES ($1, $2, $3, $4, $5, $6, 'hr', $7)
    `, [empId, oldStatus, status, readiness_date || null, reason || null, comment || null, request.user.id]);

    const { rows: [updated] } = await db.query('SELECT * FROM employees WHERE id = $1', [empId]);
    return { employee: updated };
  });
}

module.exports = routes;
