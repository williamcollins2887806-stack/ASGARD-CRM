/**
 * Global Timesheet API
 * ═══════════════════════════════════════════════════════════════════════════
 * Prefix: /api/timesheet
 *
 * GET  /global/:year/:month         — общий табель за месяц
 * GET  /global/:year/:month/export  — Excel-ссылка (заглушка, формат данных)
 * PUT  /global/entry                — добавить/изменить отметку
 *
 * Просмотр: ADMIN, DIRECTOR_*, TO, HEAD_TO, WAREHOUSE, HR, HR_MANAGER
 * Редактирование: ADMIN/DIRECTOR — всё; TO/HEAD_TO — только 'medical'; WAREHOUSE — только 'warehouse'.
 * HR/HR_MANAGER — только просмотр (редактирование запрещено в PUT /global/entry).
 */

const VIEW_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'TO', 'HEAD_TO', 'WAREHOUSE', 'HR', 'HR_MANAGER'];

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function fmtDate(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d);
}

async function routes(fastify, options) {
  const db = fastify.db;

  // ─── GET /global/:year/:month ─────────────────────────────────────────────
  fastify.get('/global/:year/:month', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async (request, reply) => {
    const year  = parseInt(request.params.year, 10);
    const month = parseInt(request.params.month, 10);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      return reply.code(400).send({ error: 'Bad year/month' });
    }
    const dim = daysInMonth(year, month);
    const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const periodEnd   = `${year}-${String(month).padStart(2, '0')}-${String(dim).padStart(2, '0')}`;

    // Чекины
    const { rows: checkins } = await db.query(`
      SELECT
        fc.employee_id, fc.work_id, fc.date, fc.shift, fc.hours_worked, fc.amount_earned, fc.status,
        e.fio, e.role_tag,
        w.work_title
      FROM field_checkins fc
      LEFT JOIN employees e ON e.id = fc.employee_id
      LEFT JOIN works w     ON w.id = fc.work_id
      WHERE fc.date >= $1 AND fc.date <= $2
        AND COALESCE(fc.status, 'active') != 'cancelled'
    `, [periodStart, periodEnd]);

    // Этапы командировки
    const { rows: stages } = await db.query(`
      SELECT
        fts.employee_id, fts.work_id, fts.date_from, fts.date_to, fts.days_count,
        fts.stage_type, fts.amount_earned, fts.status,
        e.fio, e.role_tag,
        w.work_title
      FROM field_trip_stages fts
      LEFT JOIN employees e ON e.id = fts.employee_id
      LEFT JOIN works w     ON w.id = fts.work_id
      WHERE COALESCE(fts.status, 'active') != 'rejected'
        AND fts.date_from <= $2
        AND COALESCE(fts.date_to, fts.date_from) >= $1
    `, [periodStart, periodEnd]);

    // Собираем employees из обеих таблиц
    const byEmp = {};
    function ensureEmp(id, fio, role) {
      if (!byEmp[id]) {
        byEmp[id] = { employee_id: id, fio, role_tag: role, works: {}, totals: { days: 0, amount: 0 } };
      }
      return byEmp[id];
    }

    for (const c of checkins) {
      const emp = ensureEmp(c.employee_id, c.fio, c.role_tag);
      const wKey = c.work_id || 0;
      if (!emp.works[wKey]) emp.works[wKey] = { work_id: c.work_id, work_title: c.work_title, cells: {} };
      const dStr = fmtDate(c.date);
      emp.works[wKey].cells[dStr] = {
        type: c.shift || 'day',
        amount: Number(c.amount_earned || 0),
        hours: Number(c.hours_worked || 0),
      };
      emp.totals.days  += 1;
      emp.totals.amount += Number(c.amount_earned || 0);
    }

    for (const s of stages) {
      const emp = ensureEmp(s.employee_id, s.fio, s.role_tag);
      const wKey = s.work_id || 0;
      if (!emp.works[wKey]) emp.works[wKey] = { work_id: s.work_id, work_title: s.work_title, cells: {} };
      const from = new Date(s.date_from);
      const to   = s.date_to ? new Date(s.date_to) : from;
      const startMs = Math.max(from.getTime(), new Date(periodStart).getTime());
      const endMs   = Math.min(to.getTime(), new Date(periodEnd).getTime());
      const oneDay  = 24 * 60 * 60 * 1000;
      const dCount  = Math.max(1, Math.round((endMs - startMs) / oneDay) + 1);
      const perDay  = (Number(s.amount_earned || 0)) / Math.max(1, Number(s.days_count || dCount));
      for (let t = startMs; t <= endMs; t += oneDay) {
        const dStr = new Date(t).toISOString().slice(0, 10);
        if (!emp.works[wKey].cells[dStr]) {
          emp.works[wKey].cells[dStr] = {
            type: s.stage_type,
            amount: perDay,
            hours: 0,
          };
          emp.totals.days  += 1;
          emp.totals.amount += perDay;
        }
      }
    }

    const employees = Object.values(byEmp).map(e => ({
      ...e,
      works: Object.values(e.works),
    }));

    return {
      year, month,
      days_in_month: dim,
      employees,
      total: {
        employees: employees.length,
        days: employees.reduce((s, e) => s + e.totals.days, 0),
        amount: employees.reduce((s, e) => s + e.totals.amount, 0),
      },
    };
  });

  // ─── GET /global/:year/:month/export — placeholder ────────────────────────
  fastify.get('/global/:year/:month/export', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async (request, reply) => {
    // Реальный Excel-экспорт реализуется в Сессии 3 (генерация ExcelJS).
    // Сейчас возвращаем структурированный JSON, который фронт может скачать.
    reply.header('Content-Disposition', `attachment; filename="timesheet_${request.params.year}_${request.params.month}.json"`);
    reply.header('Content-Type', 'application/json');
    const yearM = `/global/${request.params.year}/${request.params.month}`;
    const proxy = await fastify.inject({ method: 'GET', url: '/api/timesheet' + yearM, headers: request.headers });
    return reply.code(proxy.statusCode).send(proxy.body);
  });

  // ─── PUT /global/entry — добавить/изменить отметку ────────────────────────
  fastify.put('/global/entry', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async (request, reply) => {
    const role = request.user.role;
    const { employee_id, work_id, date, type, amount, hours, note } = request.body || {};
    if (!employee_id || !date || !type) {
      return reply.code(400).send({ error: 'employee_id, date, type обязательны' });
    }

    // Права редактирования по ролям
    const canAll = role === 'ADMIN' || role.startsWith('DIRECTOR_');
    const canMedical = role === 'TO' || role === 'HEAD_TO';
    const canWarehouse = role === 'WAREHOUSE';

    if (!canAll) {
      if (canMedical && type !== 'medical') {
        return reply.code(403).send({ error: 'ТО может ставить только medical' });
      }
      if (canWarehouse && type !== 'warehouse') {
        return reply.code(403).send({ error: 'Склад может ставить только warehouse' });
      }
      if (!canMedical && !canWarehouse) {
        return reply.code(403).send({ error: 'Недостаточно прав' });
      }
    }

    // Если есть чекин на этот день — менять нельзя
    const { rows: existingCi } = await db.query(`
      SELECT id FROM field_checkins WHERE employee_id = $1 AND date = $2 AND COALESCE(status,'active') != 'cancelled'
      LIMIT 1
    `, [employee_id, date]);
    if (existingCi.length && type !== 'day' && type !== 'night') {
      return reply.code(409).send({ error: 'На эту дату уже есть чекин — изменение невозможно' });
    }

    // day/night → пишем в field_checkins, остальное — в field_trip_stages
    if (type === 'day' || type === 'night') {
      if (!work_id) return reply.code(400).send({ error: 'work_id обязателен для day/night' });
      const { rows: [ci] } = await db.query(`
        INSERT INTO field_checkins
          (employee_id, work_id, date, shift, status, checkin_at, amount_earned, hours_worked, checkin_source, checkin_by, note)
        VALUES ($1, $2, $3, $4, 'active', NOW(), $5, $6, 'admin', $7, $8)
        ON CONFLICT DO NOTHING
        RETURNING *
      `, [employee_id, work_id, date, type, amount || null, hours || null, request.user.id, note || null]);
      return { ok: true, entry: ci, kind: 'checkin' };
    } else {
      const { rows: [st] } = await db.query(`
        INSERT INTO field_trip_stages
          (employee_id, work_id, stage_type, date_from, date_to, days_count, tariff_points, rate_per_day, amount_earned, status, created_by, note)
        VALUES ($1, $2, $3, $4, $4, 1, 0, $5, $6, 'active', $7, $8)
        RETURNING *
      `, [employee_id, work_id || null, type, date, amount || 0, amount || 0, request.user.id, note || null]);
      return { ok: true, entry: st, kind: 'stage' };
    }
  });
}

module.exports = routes;
