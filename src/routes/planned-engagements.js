/**
 * Planned engagements — планируемое привлечение рабочих на проект.
 * Prefix: /api/staff/planned-engagements
 */
const VIEW_ROLES = ['ADMIN', 'HR', 'HR_MANAGER', 'PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'TO', 'HEAD_TO', 'OFFICE_MANAGER'];
const EDIT_ROLES = ['ADMIN', 'HR', 'HR_MANAGER', 'PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'TO', 'HEAD_TO', 'OFFICE_MANAGER'];

async function getActiveOnSiteWorkId(db, employeeId) {
  const r = await db.query(`
    SELECT work_id FROM employee_assignments
    WHERE employee_id = $1 AND COALESCE(is_active, true) = true AND departure_date IS NULL
    ORDER BY id DESC LIMIT 1
  `, [employeeId]);
  return r.rows[0]?.work_id || null;
}

async function writePlanLog(db, employeeId, comment, userId) {
  const { rows: [emp] } = await db.query('SELECT readiness_status FROM employees WHERE id = $1', [employeeId]);
  if (!emp) return;
  await db.query(`
    INSERT INTO worker_readiness_log
      (employee_id, old_status, new_status, comment, source, changed_by)
    VALUES ($1, $2, $2, $3, 'hr', $4)
  `, [employeeId, emp.readiness_status, comment, userId]);
}

async function routes(fastify) {
  const db = fastify.db;

  // GET / — активные планы (фильтр work_id, pm_id)
  fastify.get('/', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async (request) => {
    const workId = request.query.work_id ? parseInt(request.query.work_id, 10) : null;
    const pmId = request.query.pm_id ? parseInt(request.query.pm_id, 10) : null;
    const isPm = ['PM', 'HEAD_PM'].includes(request.user.role);
    const filterPmId = isPm && !['ADMIN', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'TO', 'HEAD_TO', 'OFFICE_MANAGER'].includes(request.user.role)
      ? request.user.id
      : pmId;

    const params = [];
    let where = `pe.status = 'active' AND e.is_active = true`;
    if (workId) {
      params.push(workId);
      where += ` AND pe.work_id = $${params.length}`;
    }
    if (filterPmId) {
      params.push(filterPmId);
      where += ` AND w.pm_id = $${params.length}`;
    }

    const { rows } = await db.query(`
      SELECT
        pe.*,
        e.fio, e.phone, e.role_tag, e.position, e.readiness_status,
        w.work_title, w.pm_id AS work_pm_id,
        pm.name AS pm_name,
        cb.name AS created_by_name
      FROM employee_planned_engagements pe
      JOIN employees e ON e.id = pe.employee_id
      JOIN works w ON w.id = pe.work_id AND w.deleted_at IS NULL
      LEFT JOIN users pm ON pm.id = w.pm_id
      LEFT JOIN users cb ON cb.id = pe.created_by
      WHERE ${where}
      ORDER BY w.work_title, e.fio
    `, params);
    return { items: rows };
  });

  // GET /by-project — группировка по проектам
  fastify.get('/by-project', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async (request) => {
    const pmId = request.query.pm_id ? parseInt(request.query.pm_id, 10) : null;
    const isPmOnly = ['PM', 'HEAD_PM'].includes(request.user.role)
      && !['ADMIN', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'TO', 'HEAD_TO', 'OFFICE_MANAGER'].includes(request.user.role);
    const filterPmId = isPmOnly ? request.user.id : pmId;

    const params = [];
    let pmClause = '';
    if (filterPmId) {
      params.push(filterPmId);
      pmClause = ` AND w.pm_id = $${params.length}`;
    }

    const { rows: plans } = await db.query(`
      SELECT
        pe.id AS plan_id, pe.employee_id, pe.work_id, pe.planned_from, pe.planned_to, pe.note,
        e.fio, e.phone, e.role_tag, e.position, e.readiness_status,
        w.work_title, w.pm_id AS work_pm_id,
        pm.name AS pm_name
      FROM employee_planned_engagements pe
      JOIN employees e ON e.id = pe.employee_id
      JOIN works w ON w.id = pe.work_id AND w.deleted_at IS NULL
      LEFT JOIN users pm ON pm.id = w.pm_id
      WHERE pe.status = 'active' AND e.is_active = true${pmClause}
      ORDER BY w.work_title, e.fio
    `, params);

    const empIds = [...new Set(plans.map((p) => p.employee_id))];
    const onSiteByEmp = {};
    if (empIds.length) {
      const { rows: assignments } = await db.query(`
        SELECT ea.employee_id, ea.work_id, w.work_title, pm.name AS pm_name
        FROM employee_assignments ea
        JOIN works w ON w.id = ea.work_id
        LEFT JOIN users pm ON pm.id = w.pm_id
        WHERE ea.employee_id = ANY($1::int[])
          AND COALESCE(ea.is_active, true) = true AND ea.departure_date IS NULL
      `, [empIds]);
      for (const a of assignments) {
        if (!onSiteByEmp[a.employee_id]) onSiteByEmp[a.employee_id] = a;
      }
    }

    const byWork = new Map();
    for (const p of plans) {
      if (!byWork.has(p.work_id)) {
        byWork.set(p.work_id, {
          work_id: p.work_id,
          work_title: p.work_title,
          pm_id: p.work_pm_id,
          pm_name: p.pm_name,
          workers: [],
        });
      }
      const onSite = onSiteByEmp[p.employee_id] || null;
      byWork.get(p.work_id).workers.push({
        employee_id: p.employee_id,
        fio: p.fio,
        phone: p.phone,
        role_tag: p.role_tag,
        position: p.position,
        readiness_status: p.readiness_status,
        planned_from: p.planned_from,
        planned_to: p.planned_to,
        note: p.note,
        plan_id: p.plan_id,
        on_site_info: onSite ? {
          work_id: onSite.work_id,
          work_title: onSite.work_title,
          pm_name: onSite.pm_name,
        } : null,
      });
    }

    return { projects: [...byWork.values()] };
  });

  // PUT /employees/:id — установить/обновить план
  fastify.put('/employees/:id', { preHandler: [fastify.requireRoles(EDIT_ROLES)] }, async (request, reply) => {
    const empId = parseInt(request.params.id, 10);
    const { work_id, planned_from, planned_to, note, inbound_transport } = request.body || {};
    if (!Number.isFinite(empId)) return reply.code(400).send({ error: 'Bad employee_id' });
    if (!work_id) return reply.code(400).send({ error: 'work_id обязателен' });

    const hasInbound = Object.prototype.hasOwnProperty.call(request.body || {}, 'inbound_transport');
    let inbound = hasInbound ? inbound_transport : undefined;
    if (hasInbound && inbound !== null && !['helicopter', 'ship'].includes(inbound)) {
      return reply.code(400).send({ error: 'inbound_transport: helicopter|ship|null' });
    }

    const workId = parseInt(work_id, 10);
    const { rows: [emp] } = await db.query('SELECT id, fio, readiness_status FROM employees WHERE id = $1 AND is_active = true', [empId]);
    if (!emp) return reply.code(404).send({ error: 'Сотрудник не найден' });

    const { rows: [work] } = await db.query(`
      SELECT w.id, w.work_title, w.pm_id FROM works w
      WHERE w.id = $1 AND w.deleted_at IS NULL
    `, [workId]);
    if (!work) return reply.code(404).send({ error: 'Работа не найдена' });

    const onSiteWorkId = await getActiveOnSiteWorkId(db, empId);
    if (onSiteWorkId === workId) {
      const { rows: [onSite] } = await db.query(`
        SELECT w.work_title, u.name AS pm_name
        FROM works w
        LEFT JOIN users u ON u.id = w.pm_id
        WHERE w.id = $1
      `, [onSiteWorkId]);
      const title = (onSite?.work_title || work.work_title || ('#' + onSiteWorkId)).trim();
      const pm = onSite?.pm_name ? ` (РП: ${onSite.pm_name})` : '';
      const fio = emp.fio || 'Рабочий';
      return reply.code(409).send({
        error: `«${fio}» уже на объекте «${title}»${pm}. План на этот же проект не нужен — он уже в бригаде. Чтобы перевести — оформите отъезд с текущего объекта.`,
        code: 'already_on_site',
        current_work_id: onSiteWorkId,
        current_work_title: title,
        current_pm_name: onSite?.pm_name || null
      });
    }

    const warnings = [];
    if (onSiteWorkId && planned_from) {
      const { rows: [asg] } = await db.query(`
        SELECT departure_date, date_to FROM employee_assignments
        WHERE employee_id = $1 AND work_id = $2 AND COALESCE(is_active, true) = true AND departure_date IS NULL
        ORDER BY id DESC LIMIT 1
      `, [empId, onSiteWorkId]);
      if (asg?.departure_date && String(planned_from) < String(asg.departure_date).slice(0, 10)) {
        warnings.push('planned_from раньше даты убытия с текущего объекта');
      }
    }

    const { rows: [existing] } = await db.query(`
      SELECT id FROM employee_planned_engagements WHERE employee_id = $1 AND status = 'active'
    `, [empId]);

    let plan;
    if (existing) {
      const upd = await db.query(`
        UPDATE employee_planned_engagements SET
          work_id = $1, planned_from = $2, planned_to = $3, note = $4,
          inbound_transport = CASE WHEN $5::boolean THEN $6 ELSE inbound_transport END,
          updated_at = NOW(), created_by = COALESCE(created_by, $7)
        WHERE id = $8 RETURNING *
      `, [workId, planned_from || null, planned_to || null, note || null, hasInbound, hasInbound ? inbound : null, request.user.id, existing.id]);
      plan = upd.rows[0];
      await writePlanLog(db, empId, `planned_set: ${work.work_title} (work_id=${workId})`, request.user.id);
    } else {
      const ins = await db.query(`
        INSERT INTO employee_planned_engagements
          (employee_id, work_id, planned_from, planned_to, note, inbound_transport, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
      `, [empId, workId, planned_from || null, planned_to || null, note || null, hasInbound ? inbound : null, request.user.id]);
      plan = ins.rows[0];
      await writePlanLog(db, empId, `planned_set: ${work.work_title} (work_id=${workId})`, request.user.id);
    }

    return {
      plan,
      work_title: work.work_title,
      current_on_site: !!onSiteWorkId,
      warnings,
    };
  });

  // POST /bulk — массовое планируемое привлечение из корзины
  // body: { work_id, planned_from, planned_to, note, employee_ids, mode: 'all'|'free_only' }
  fastify.post('/bulk', { preHandler: [fastify.requireRoles(EDIT_ROLES)] }, async (request, reply) => {
    const body = request.body || {};
    const workId = parseInt(body.work_id, 10);
    const mode = body.mode === 'free_only' ? 'free_only' : 'all';
    const ids = [...new Set((Array.isArray(body.employee_ids) ? body.employee_ids : [])
      .map((x) => parseInt(x, 10)).filter(Number.isFinite))];
    const planned_from = body.planned_from || null;
    const planned_to = body.planned_to || null;
    const note = body.note || null;

    if (!Number.isFinite(workId)) return reply.code(400).send({ error: 'work_id обязателен' });
    if (!ids.length) return reply.code(400).send({ error: 'employee_ids обязателен' });
    if (ids.length > 100) return reply.code(400).send({ error: 'Максимум 100 человек за раз' });

    const { rows: [work] } = await db.query(`
      SELECT w.id, w.work_title, w.pm_id FROM works w
      WHERE w.id = $1 AND w.deleted_at IS NULL
    `, [workId]);
    if (!work) return reply.code(404).send({ error: 'Работа не найдена' });

    const assigned = [];
    const skipped = [];

    for (const empId of ids) {
      const { rows: [emp] } = await db.query(
        'SELECT id, fio FROM employees WHERE id = $1 AND is_active = true',
        [empId]
      );
      if (!emp) {
        skipped.push({ id: empId, reason: 'not_found', message: 'Сотрудник не найден' });
        continue;
      }

      const onSiteWorkId = await getActiveOnSiteWorkId(db, empId);
      const { rows: [existingPlan] } = await db.query(`
        SELECT id, work_id FROM employee_planned_engagements
        WHERE employee_id = $1 AND status = 'active'
      `, [empId]);

      const isConflict = !!(onSiteWorkId || existingPlan);
      if (mode === 'free_only' && isConflict) {
        let reason = 'busy';
        let message = 'занят';
        if (onSiteWorkId) {
          const { rows: [w] } = await db.query('SELECT work_title FROM works WHERE id = $1', [onSiteWorkId]);
          reason = 'on_site';
          message = `уже на объекте «${w?.work_title || onSiteWorkId}»`;
        } else if (existingPlan) {
          const { rows: [w] } = await db.query('SELECT work_title FROM works WHERE id = $1', [existingPlan.work_id]);
          reason = 'planned';
          message = `уже план на «${w?.work_title || existingPlan.work_id}»`;
        }
        skipped.push({ id: empId, fio: emp.fio, reason, message });
        continue;
      }

      if (onSiteWorkId === workId) {
        skipped.push({
          id: empId,
          fio: emp.fio,
          reason: 'already_on_site',
          message: `уже на этом объекте «${work.work_title}»`
        });
        continue;
      }

      if (existingPlan) {
        await db.query(`
          UPDATE employee_planned_engagements SET
            work_id = $1, planned_from = $2, planned_to = $3, note = $4,
            updated_at = NOW(), created_by = COALESCE(created_by, $5)
          WHERE id = $6
        `, [workId, planned_from, planned_to, note, request.user.id, existingPlan.id]);
      } else {
        await db.query(`
          INSERT INTO employee_planned_engagements
            (employee_id, work_id, planned_from, planned_to, note, created_by)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [empId, workId, planned_from, planned_to, note, request.user.id]);
      }
      await writePlanLog(db, empId, `planned_set_bulk: ${work.work_title} (work_id=${workId})`, request.user.id);
      assigned.push({ id: empId, fio: emp.fio });
    }

    return {
      ok: true,
      work_id: workId,
      work_title: work.work_title,
      mode,
      assigned,
      skipped,
      assigned_count: assigned.length,
      skipped_count: skipped.length
    };
  });

  // DELETE /employees/:id — снять с плана
  fastify.delete('/employees/:id', { preHandler: [fastify.requireRoles(EDIT_ROLES)] }, async (request, reply) => {
    const empId = parseInt(request.params.id, 10);
    if (!Number.isFinite(empId)) return reply.code(400).send({ error: 'Bad employee_id' });

    const { rows: [plan] } = await db.query(`
      SELECT pe.*, w.work_title FROM employee_planned_engagements pe
      LEFT JOIN works w ON w.id = pe.work_id
      WHERE pe.employee_id = $1 AND pe.status = 'active'
    `, [empId]);
    if (!plan) return reply.code(404).send({ error: 'Активный план не найден' });

    await db.query(`
      UPDATE employee_planned_engagements SET
        status = 'cancelled', cancelled_at = NOW(), cancelled_by = $1, updated_at = NOW()
      WHERE id = $2
    `, [request.user.id, plan.id]);

    await writePlanLog(db, empId, `planned_clear: ${plan.work_title || ''} (work_id=${plan.work_id})`, request.user.id);
    return { ok: true };
  });
}

module.exports = routes;
