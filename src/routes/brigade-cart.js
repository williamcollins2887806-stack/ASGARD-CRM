'use strict';

/**
 * Brigade cart — экспорт Excel состава / матрицы допусков / конфликты.
 * Prefix: /api/staff/brigade-cart
 * Корзина живёт на клиенте; здесь только серверные действия.
 */

const { buildBrigadeWorkbook, ymd } = require('../lib/brigade-cart-export');

const VIEW_ROLES = [
  'ADMIN', 'HR', 'HR_MANAGER', 'PM', 'HEAD_PM', 'OFFICE_MANAGER',
  'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'TO', 'HEAD_TO'
];
const PDN_ROLES = [
  'ADMIN', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV',
  'OFFICE_MANAGER', 'HEAD_PM', 'TO', 'HEAD_TO'
];

function isDir(role) {
  return role === 'DIRECTOR' || String(role || '').startsWith('DIRECTOR_');
}

function parseIds(raw) {
  if (Array.isArray(raw)) {
    return [...new Set(raw.map((x) => parseInt(x, 10)).filter(Number.isFinite))];
  }
  if (typeof raw === 'string') {
    return [...new Set(raw.split(',').map((x) => parseInt(x.trim(), 10)).filter(Number.isFinite))];
  }
  return [];
}

async function loadCartRows(db, ids) {
  if (!ids.length) return [];
  const { rows } = await db.query(`
    SELECT
      e.id, e.fio, e.phone, e.phone2, e.city, e.address, e.registration_address,
      e.role_tag, e.position, e.readiness_status, e.rating_avg,
      e.clothing_size, e.shoe_size, e.headwear_size, e.height,
      e.pass_series, e.pass_number, e.passport_series, e.passport_number,
      e.inn, e.snils, e.birth_date,
      ea.work_id AS asg_work_id, ea.date_from AS asg_from, ea.departure_date AS asg_dep,
      w.work_title AS asg_title,
      pe.work_id AS plan_work_id, pe.planned_from, pe.planned_to,
      pw.work_title AS plan_title,
      ms.arrived_at AS mlsp_arrived, ms.planned_depart_at AS mlsp_planned,
      ms.actual_departed_at AS mlsp_departed
    FROM employees e
    LEFT JOIN LATERAL (
      SELECT work_id, date_from, departure_date
      FROM employee_assignments
      WHERE employee_id = e.id AND COALESCE(is_active, true) = true AND departure_date IS NULL
      ORDER BY id DESC LIMIT 1
    ) ea ON true
    LEFT JOIN works w ON w.id = ea.work_id AND w.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT work_id, planned_from, planned_to
      FROM employee_planned_engagements
      WHERE employee_id = e.id AND status = 'active'
      ORDER BY id DESC LIMIT 1
    ) pe ON true
    LEFT JOIN works pw ON pw.id = pe.work_id AND pw.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT arrived_at, planned_depart_at, actual_departed_at
      FROM mlsp_stays
      WHERE employee_id = e.id AND actual_departed_at IS NULL
      ORDER BY id DESC LIMIT 1
    ) ms ON true
    WHERE e.id = ANY($1::int[]) AND COALESCE(e.is_active, true) = true
  `, [ids]);

  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId[id] || null).filter(Boolean);
}

async function loadPermitRows(db, ids) {
  if (!ids.length) return [];
  const { rows } = await db.query(`
    SELECT
      ep.employee_id, ep.type_id, ep.expiry_date,
      pt.code, pt.name, pt.category, pt.sort_order
    FROM employee_permits ep
    JOIN permit_types pt ON pt.id = ep.type_id
    WHERE ep.employee_id = ANY($1::int[])
      AND COALESCE(ep.is_active, true) = true
      AND COALESCE(pt.is_active, true) = true
    ORDER BY ep.employee_id, pt.sort_order NULLS LAST, pt.name
  `, [ids]).catch(() => ({ rows: [] }));
  return rows;
}

async function routes(fastify) {
  const db = fastify.db;
  const roleCheck = { preHandler: [fastify.requireRoles(VIEW_ROLES)] };

  // GET /matrix?employee_ids=1,2,3 — матрица допусков только для корзины
  fastify.get('/matrix', roleCheck, async (request) => {
    const ids = parseIds(request.query?.employee_ids);
    if (!ids.length) return { employees: [], types: [], matrix: {} };

    const { rows: employees } = await db.query(
      `SELECT id, fio, position, is_active FROM employees
       WHERE is_active = true AND id = ANY($1::int[])
       ORDER BY fio`,
      [ids]
    );
    const { rows: types } = await db.query(
      `SELECT id, code, name, category, sort_order
       FROM permit_types WHERE is_active = true
       ORDER BY sort_order NULLS LAST, name`
    );
    const { rows: permits } = await db.query(`
      SELECT employee_id, type_id, expiry_date, id
      FROM employee_permits
      WHERE is_active = true AND employee_id = ANY($1::int[])
      ORDER BY expiry_date DESC NULLS LAST
    `, [ids]);

    const today = new Date();
    const matrix = {};
    for (const p of permits) {
      const key = `${p.employee_id}_${p.type_id}`;
      if (matrix[key]) continue;
      let status = 'active';
      let daysLeft = null;
      if (p.expiry_date) {
        daysLeft = Math.ceil((new Date(p.expiry_date) - today) / 86400000);
        if (daysLeft < 0) status = 'expired';
        else if (daysLeft <= 14) status = 'expiring_14';
        else if (daysLeft <= 30) status = 'expiring_30';
      }
      matrix[key] = { expiry_date: p.expiry_date, status, days_left: daysLeft, permit_id: p.id };
    }
    return { employees, types, matrix };
  });

  // POST /conflicts — кто уже на объекте / в плане
  fastify.post('/conflicts', roleCheck, async (request) => {
    const ids = parseIds(request.body?.employee_ids);
    if (!ids.length) return { items: [] };
    const { rows } = await db.query(`
      SELECT
        e.id AS employee_id, e.fio,
        ea.work_id AS on_site_work_id, w.work_title AS on_site_title,
        pe.work_id AS plan_work_id, pe.planned_from, pw.work_title AS plan_title
      FROM employees e
      LEFT JOIN LATERAL (
        SELECT work_id FROM employee_assignments
        WHERE employee_id = e.id AND COALESCE(is_active, true) = true AND departure_date IS NULL
        ORDER BY id DESC LIMIT 1
      ) ea ON true
      LEFT JOIN works w ON w.id = ea.work_id
      LEFT JOIN LATERAL (
        SELECT work_id, planned_from FROM employee_planned_engagements
        WHERE employee_id = e.id AND status = 'active'
        ORDER BY id DESC LIMIT 1
      ) pe ON true
      LEFT JOIN works pw ON pw.id = pe.work_id
      WHERE e.id = ANY($1::int[])
    `, [ids]);

    const items = rows.map((r) => ({
      employee_id: r.employee_id,
      fio: r.fio,
      on_site: r.on_site_work_id ? {
        work_id: r.on_site_work_id,
        work_title: r.on_site_title
      } : null,
      planned: r.plan_work_id ? {
        work_id: r.plan_work_id,
        work_title: r.plan_title,
        planned_from: ymd(r.planned_from)
      } : null,
      conflict: !!(r.on_site_work_id || r.plan_work_id)
    }));
    return { items, conflict_count: items.filter((i) => i.conflict).length };
  });

  // POST /export — печатный Excel состава + допуски (A4)
  fastify.post('/export', roleCheck, async (request, reply) => {
    const ids = parseIds(request.body?.employee_ids);
    const includePdn = !!request.body?.include_pdn;
    const role = request.user.role;
    const canPdn = includePdn && (PDN_ROLES.includes(role) || isDir(role));

    if (!ids.length) return reply.code(400).send({ error: 'Укажите employee_ids' });
    if (ids.length > 200) return reply.code(400).send({ error: 'Максимум 200 человек за раз' });

    const employees = await loadCartRows(db, ids);
    const permitRows = await loadPermitRows(db, ids);
    const userLabel = request.user?.name || request.user?.fio || String(request.user?.id || '');

    const wb = await buildBrigadeWorkbook({
      employees,
      permitRows,
      userLabel,
      includePdn: canPdn
    });

    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const fname = `brigada_${ymd(new Date()) || 'export'}.xlsx`;
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="${fname}"`);
    return reply.send(buf);
  });

  // POST /permits-export — тот же печатный пакет (фокус на допусках)
  fastify.post('/permits-export', roleCheck, async (request, reply) => {
    const ids = parseIds(request.body?.employee_ids);
    if (!ids.length) return reply.code(400).send({ error: 'Укажите employee_ids' });
    if (ids.length > 200) return reply.code(400).send({ error: 'Максимум 200 человек за раз' });

    const employees = await loadCartRows(db, ids);
    const permitRows = await loadPermitRows(db, ids);
    const userLabel = request.user?.name || request.user?.fio || String(request.user?.id || '');

    const wb = await buildBrigadeWorkbook({
      employees,
      permitRows,
      userLabel,
      includePdn: false
    });

    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', 'attachment; filename="brigada_dopuski.xlsx"');
    return reply.send(buf);
  });
}

module.exports = routes;
