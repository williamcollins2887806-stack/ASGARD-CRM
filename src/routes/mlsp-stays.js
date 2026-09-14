'use strict';

/**
 * MLSP stays API — вахта на платформе (45 суток).
 * Prefix: /api/staff/mlsp-stays
 */

const {
  listVisibleStays,
  getOpenStay,
  extendStay,
  departStay,
  reopenAutoStay,
  enrichStayRow,
  logEvent,
  ymd
} = require('../lib/mlsp-stay');
const { buildMlspPeriodExcel } = require('../lib/mlsp-stay-export');

const VIEW_ROLES = [
  'ADMIN', 'HR', 'HR_MANAGER', 'PM', 'HEAD_PM',
  'OFFICE_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV',
  'TO', 'HEAD_TO'
];
const WRITE_ROLES = [
  'ADMIN', 'HR', 'HR_MANAGER', 'OFFICE_MANAGER',
  'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV',
  'PM', 'HEAD_PM'
];

async function assertWriteAccess(db, request, stay) {
  const role = request.user?.role;
  if (!WRITE_ROLES.includes(role)) {
    const err = new Error('Нет прав');
    err.statusCode = 403;
    throw err;
  }
  // PM — только «свои»: активное/недавнее назначение, last_pm_id или план на МЛСП.
  // (Раньше INNER JOIN site_category=mlsp + 14д → 403 при живой вахте в Дружине.)
  if (role === 'PM') {
    const { rows } = await db.query(`
      SELECT 1 WHERE
        EXISTS (
          SELECT 1
          FROM employee_assignments ea
          JOIN works w ON w.id = ea.work_id AND w.deleted_at IS NULL
          WHERE ea.employee_id = $1 AND w.pm_id = $2
            AND (
              (COALESCE(ea.is_active, true) = true AND ea.departure_date IS NULL)
              OR ea.departure_date >= (CURRENT_DATE - 45)
            )
        )
        OR EXISTS (
          SELECT 1 FROM employees e
          WHERE e.id = $1 AND e.last_pm_id = $2
        )
        OR EXISTS (
          SELECT 1
          FROM employee_planned_engagements pe
          JOIN works w ON w.id = pe.work_id AND w.deleted_at IS NULL
          JOIN field_project_settings fps ON fps.work_id = pe.work_id AND fps.site_category = 'mlsp'
          WHERE pe.employee_id = $1 AND pe.status = 'active' AND w.pm_id = $2
        )
      LIMIT 1
    `, [stay.employee_id, request.user.id]);
    if (!rows.length) {
      const err = new Error('Можно править только своих рабочих МЛСП');
      err.statusCode = 403;
      throw err;
    }
  }
}

async function routes(fastify) {
  const db = fastify.db;

  // GET / — visible stays for Дружина filter
  fastify.get('/', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async (request) => {
    const seg = request.query.seg || 'all';
    const q = request.query.q || '';
    const items = await listVisibleStays(db, { seg, q });
    const openCount = items.filter((i) => i.is_open).length;
    return { items, groups: { on_mlsp: openCount, visible: items.length } };
  });

  // GET /summary — counts for badge
  fastify.get('/summary', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async () => {
    const items = await listVisibleStays(db, { seg: 'all' });
    const open = items.filter((i) => i.is_open);
    return {
      on_mlsp: open.length,
      d14: open.filter((i) => i.days_left != null && i.days_left <= 14).length,
      d7: open.filter((i) => i.days_left != null && i.days_left <= 7).length,
      over: open.filter((i) => i.is_overdue).length,
      left: items.filter((i) => !i.is_open).length
    };
  });

  // GET /by-employee/:id — for card / field app
  fastify.get('/by-employee/:id', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async (request, reply) => {
    const empId = parseInt(request.params.id, 10);
    if (!empId) return reply.code(400).send({ error: 'id required' });
    const open = await getOpenStay(db, empId);
    if (open) return { stay: enrichStayRow(open) };
    const { rows } = await db.query(`
      SELECT * FROM mlsp_stays
      WHERE employee_id = $1
      ORDER BY id DESC LIMIT 1
    `, [empId]);
    return { stay: rows[0] ? enrichStayRow(rows[0]) : null };
  });

  // PATCH /:id — transport, arrived_at
  fastify.patch('/:id', { preHandler: [fastify.requireRoles(WRITE_ROLES)] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const { transport, arrived_at, inbound_transport } = request.body || {};
    const { rows: cur } = await db.query(`SELECT * FROM mlsp_stays WHERE id = $1`, [id]);
    if (!cur[0]) return reply.code(404).send({ error: 'Не найдено' });
    try { await assertWriteAccess(db, request, cur[0]); }
    catch (e) { return reply.code(e.statusCode || 403).send({ error: e.message }); }

    if (cur[0].actual_departed_at && (arrived_at || transport !== undefined)) {
      // allow transport tweak on closed? plan says only open for arrived_at
      if (arrived_at) return reply.code(400).send({ error: 'Закрытую вахту нельзя править по заезду' });
    }

    const sets = [];
    const params = [id];
    if (transport !== undefined) {
      if (transport !== null && !['helicopter', 'ship'].includes(transport)) {
        return reply.code(400).send({ error: 'transport: helicopter|ship|null' });
      }
      params.push(transport);
      sets.push(`transport = $${params.length}`);
    }
    if (inbound_transport !== undefined) {
      if (inbound_transport !== null && !['helicopter', 'ship'].includes(inbound_transport)) {
        return reply.code(400).send({ error: 'inbound_transport: helicopter|ship|null' });
      }
      params.push(inbound_transport);
      sets.push(`inbound_transport = $${params.length}`);
    }
    if (arrived_at && !cur[0].actual_departed_at) {
      const arr = ymd(arrived_at);
      params.push(arr);
      sets.push(`arrived_at = $${params.length}::date`);
      // пересчёт плана только если не продлевали (extend_note пуст и план = old+44)
      const oldArr = ymd(cur[0].arrived_at);
      const oldPlan = ymd(cur[0].planned_depart_at);
      const { addDays, ARRIVAL_OFFSET } = require('../lib/mlsp-stay');
      const defaultPlan = addDays(oldArr, ARRIVAL_OFFSET);
      if (!cur[0].extend_note && oldPlan === defaultPlan) {
        params.push(addDays(arr, ARRIVAL_OFFSET));
        sets.push(`planned_depart_at = $${params.length}::date`);
      }
    }
    if (!sets.length) return reply.code(400).send({ error: 'Нечего обновлять' });
    sets.push('updated_at = NOW()');

    const { rows } = await db.query(`
      UPDATE mlsp_stays SET ${sets.join(', ')} WHERE id = $1 RETURNING *
    `, params);

    await logEvent(db, id, 'transport', { transport, arrived_at, inbound_transport }, request.user.id);
    return { stay: enrichStayRow(rows[0]) };
  });

  // POST /:id/extend
  fastify.post('/:id/extend', { preHandler: [fastify.requireRoles(WRITE_ROLES)] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const { planned_depart_at, note } = request.body || {};
    const { rows: cur } = await db.query(`SELECT * FROM mlsp_stays WHERE id = $1`, [id]);
    if (!cur[0]) return reply.code(404).send({ error: 'Не найдено' });
    try { await assertWriteAccess(db, request, cur[0]); }
    catch (e) { return reply.code(e.statusCode || 403).send({ error: e.message }); }
    try {
      const stay = await extendStay(db, id, planned_depart_at, note, request.user.id);
      return { stay: enrichStayRow(stay) };
    } catch (e) {
      return reply.code(400).send({ error: e.message });
    }
  });

  // POST /:id/depart
  fastify.post('/:id/depart', { preHandler: [fastify.requireRoles(WRITE_ROLES)] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const { actual_departed_at, transport, reason } = request.body || {};
    const { rows: cur } = await db.query(`SELECT * FROM mlsp_stays WHERE id = $1`, [id]);
    if (!cur[0]) return reply.code(404).send({ error: 'Не найдено' });
    try { await assertWriteAccess(db, request, cur[0]); }
    catch (e) { return reply.code(e.statusCode || 403).send({ error: e.message }); }
    try {
      const stay = await departStay(db, id, actual_departed_at, 'manual', {
        transport: transport || null,
        reason: reason || 'Съехал с МЛСП',
        actorUserId: request.user.id
      });
      return { stay: enrichStayRow(stay) };
    } catch (e) {
      return reply.code(400).send({ error: e.message });
    }
  });

  // POST /:id/reopen — только auto_travel ≤14д
  fastify.post('/:id/reopen', { preHandler: [fastify.requireRoles(WRITE_ROLES)] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const { rows: cur } = await db.query(`SELECT * FROM mlsp_stays WHERE id = $1`, [id]);
    if (!cur[0]) return reply.code(404).send({ error: 'Не найдено' });
    try { await assertWriteAccess(db, request, cur[0]); }
    catch (e) { return reply.code(e.statusCode || 403).send({ error: e.message }); }
    try {
      const stay = await reopenAutoStay(db, id, request.user.id);
      return { stay: enrichStayRow(stay) };
    } catch (e) {
      return reply.code(400).send({ error: e.message });
    }
  });

  // POST /export — Excel-график перевахтовки за период (один лист)
  fastify.post('/export', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async (request, reply) => {
    const from = ymd(request.body?.from || request.body?.date_from);
    const to = ymd(request.body?.to || request.body?.date_to);
    if (!from || !to) {
      return reply.code(400).send({ error: 'Укажите from и to (YYYY-MM-DD)' });
    }
    if (from > to) {
      return reply.code(400).send({ error: 'Дата «с» не позже даты «по»' });
    }
    const spanDays = Math.round((new Date(to + 'T12:00:00Z') - new Date(from + 'T12:00:00Z')) / 86400000);
    if (spanDays > 366) {
      return reply.code(400).send({ error: 'Максимальный период — 366 дней' });
    }

    let asOf = ymd(request.body?.as_of || request.body?.asOf || request.body?.on_date);
    if (!asOf) asOf = to;
    if (asOf < from || asOf > to) {
      return reply.code(400).send({ error: 'Дата «на» должна быть внутри периода (с … по …)' });
    }

    const { buffer, count } = await buildMlspPeriodExcel(db, from, to, asOf);
    const fname = `perevahtovka_${from}_${to}_na_${asOf}.xlsx`;
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="${fname}"`);
    reply.header('X-Export-Rows', String(count));
    return reply.send(buffer);
  });
}

module.exports = routes;
