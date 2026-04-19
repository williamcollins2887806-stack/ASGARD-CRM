/**
 * ASGARD Field — Trip Stages API (Session 12)
 * ═══════════════════════════════════════════════════════════════
 * Этапы командировки: медосмотр, дорога, ожидание, склад, выходной
 *
 * PM (CRM auth):
 *   POST /                              — создать этап вручную
 *   GET  /project/:work_id              — все этапы проекта
 *   GET  /project/:work_id/calendar     — календарная сетка
 *   GET  /employee/:employee_id/work/:work_id — этапы сотрудника
 *   PUT  /:id/approve                   — подтвердить этап
 *   PUT  /:id/reject                    — отклонить этап
 *   PUT  /:id                           — редактировать этап
 *   DELETE /:id                         — удалить этап
 *   POST /bulk                          — массовое создание
 *
 * Master (Field auth, shift_master/senior_master):
 *   GET  /my-crew/:work_id              — этапы бригады
 *   POST /on-behalf                     — создать этап за рабочего
 *   PUT  /on-behalf/:id                 — обновить этап рабочего
 *   POST /request-correction            — запросить корректировку у РП
 *
 * Worker (Field auth):
 *   GET  /my/:work_id                   — мои этапы
 *   POST /my/start                      — начать этап
 *   POST /my/end                        — завершить этап
 *   GET  /my/current/:work_id           — текущий активный этап
 */

const { createNotification } = require('../services/notify');

const STAGE_TYPES = ['medical', 'travel', 'waiting', 'warehouse', 'day_off', 'object'];

const STAGE_LABELS = {
  medical: 'Медосмотр',
  travel: 'Дорога',
  waiting: 'Ожидание',
  warehouse: 'Склад',
  day_off: 'Выходной',
  object: 'Объект',
};

const PM_ROLES = ['PM', 'HEAD_PM', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

async function routes(fastify, options) {
  const db = fastify.db;
  const crmAuth = { preHandler: [fastify.requireRoles(PM_ROLES)] };
  const fieldAuth = { preHandler: [fastify.fieldAuthenticate] };

  // ── Helpers ────────────────────────────────────────────────────

  function calcDays(dateFrom, dateTo) {
    if (!dateTo) return 1;
    const d1 = new Date(dateFrom);
    const d2 = new Date(dateTo);
    return Math.max(1, Math.round((d2 - d1) / 86400000) + 1);
  }

  async function findTariff(stageType, workId) {
    let q;
    if (stageType === 'medical') {
      q = await db.query(`SELECT id, points, rate_per_shift FROM field_tariff_grid WHERE category='special' AND position_name ILIKE '%осмотр%' LIMIT 1`);
    } else if (stageType === 'travel') {
      q = await db.query(`SELECT id, points, rate_per_shift FROM field_tariff_grid WHERE category='special' AND position_name ILIKE '%Дорога%' LIMIT 1`);
    } else if (stageType === 'waiting' || stageType === 'day_off') {
      q = await db.query(`SELECT id, points, rate_per_shift FROM field_tariff_grid WHERE category='special' AND position_name ILIKE '%Выходной%' LIMIT 1`);
    } else if (stageType === 'warehouse') {
      // Тариф склада — если есть назначение с тарифом склада, используем его
      if (workId) {
        q = await db.query(`SELECT id, points, rate_per_shift FROM field_tariff_grid WHERE category='warehouse' ORDER BY points ASC LIMIT 1`);
      } else {
        q = await db.query(`SELECT id, points, rate_per_shift FROM field_tariff_grid WHERE category='warehouse' LIMIT 1`);
      }
    }

    if (q && q.rows.length > 0) {
      return { id: q.rows[0].id, points: q.rows[0].points, rate: parseFloat(q.rows[0].rate_per_shift) };
    }

    // Fallback по умолчанию — 6 баллов, 3000₽
    const defaults = { medical: { p: 7, r: 3500 }, travel: { p: 6, r: 3000 }, waiting: { p: 6, r: 3000 }, day_off: { p: 6, r: 3000 }, warehouse: { p: 10, r: 5000 }, object: { p: 11, r: 5500 } };
    const d = defaults[stageType] || { p: 6, r: 3000 };
    return { id: null, points: d.p, rate: d.r };
  }

  async function insertStage(params) {
    const { employee_id, work_id, assignment_id, stage_type, date_from, date_to, tariff_id, tariff_points, rate_per_day, details, logistics_id, source, source_employee_id, status, note, created_by } = params;
    const days = calcDays(date_from, date_to);
    const amount = days * rate_per_day;

    const { rows } = await db.query(`
      INSERT INTO field_trip_stages
        (employee_id, work_id, assignment_id, stage_type, date_from, date_to, days_count,
         tariff_id, tariff_points, rate_per_day, amount_earned, details, logistics_id,
         source, source_employee_id, status, note, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING *
    `, [employee_id, work_id, assignment_id || null, stage_type, date_from, date_to || null, days,
        tariff_id || null, tariff_points, rate_per_day, amount, details ? JSON.stringify(details) : '{}',
        logistics_id || null, source || 'pm', source_employee_id || null, status || 'active',
        note || null, created_by || null]);

    return rows[0];
  }

  async function isMaster(empId, workId) {
    const { rows } = await db.query(
      `SELECT field_role FROM employee_assignments WHERE employee_id=$1 AND work_id=$2 AND is_active=true AND field_role IN ('shift_master','senior_master') LIMIT 1`,
      [empId, workId]
    );
    return rows.length > 0;
  }

  async function getCrewIds(masterEmpId, workId) {
    // Все рабочие на проекте — мастер видит всех в своей смене
    const { rows } = await db.query(
      `SELECT employee_id FROM employee_assignments WHERE work_id=$1 AND is_active=true`,
      [workId]
    );
    return rows.map(r => r.employee_id);
  }

  // ═══════════════════════════════════════════════════════════════
  // PM ENDPOINTS (CRM auth)
  // ═══════════════════════════════════════════════════════════════

  // POST / — создать этап вручную
  fastify.post('/', crmAuth, async (req, reply) => {
    try {
      const userId = req.user.id;
      const { employee_id, work_id, stage_type, date_from, date_to, tariff_id, details, note } = req.body || {};

      if (!employee_id || !work_id || !stage_type || !date_from) {
        return reply.code(400).send({ error: 'Укажите employee_id, work_id, stage_type, date_from' });
      }
      if (!STAGE_TYPES.includes(stage_type)) {
        return reply.code(400).send({ error: 'Неизвестный тип этапа: ' + stage_type });
      }

      let tariff;
      if (tariff_id) {
        const { rows } = await db.query(`SELECT id, points, rate_per_shift FROM field_tariff_grid WHERE id=$1`, [tariff_id]);
        if (rows.length === 0) return reply.code(400).send({ error: 'Тариф не найден' });
        tariff = { id: rows[0].id, points: rows[0].points, rate: parseFloat(rows[0].rate_per_shift) };
      } else {
        tariff = await findTariff(stage_type, work_id);
      }

      const stage = await insertStage({
        employee_id, work_id, stage_type, date_from, date_to,
        tariff_id: tariff.id, tariff_points: tariff.points, rate_per_day: tariff.rate,
        details, source: 'pm', status: 'planned', note, created_by: userId,
      });

      return { stage };
    } catch (err) {
      if (err.code === '23505') return reply.code(409).send({ error: 'Этап такого типа уже существует на эту дату' });
      fastify.log.error('[field-stages] POST / error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // GET /project/:work_id — все этапы проекта
  fastify.get('/project/:work_id', crmAuth, async (req, reply) => {
    try {
      const workId = parseInt(req.params.work_id);
      const { rows } = await db.query(`
        SELECT s.*, e.fio, tg.position_name AS tariff_name
        FROM field_trip_stages s
        JOIN employees e ON e.id = s.employee_id
        LEFT JOIN field_tariff_grid tg ON tg.id = s.tariff_id
        WHERE s.work_id = $1
        ORDER BY e.fio, s.date_from
      `, [workId]);

      // Группировка по сотрудникам
      const byEmployee = {};
      for (const r of rows) {
        if (!byEmployee[r.employee_id]) {
          byEmployee[r.employee_id] = { employee_id: r.employee_id, fio: r.fio, stages: [], total_days: 0, total_earned: 0 };
        }
        byEmployee[r.employee_id].stages.push(r);
        if (r.status !== 'rejected') {
          byEmployee[r.employee_id].total_days += r.days_approved || r.days_count || 0;
          byEmployee[r.employee_id].total_earned += parseFloat(r.amount_earned || 0);
        }
      }

      return { employees: Object.values(byEmployee), total_stages: rows.length };
    } catch (err) {
      fastify.log.error('[field-stages] GET /project/:id error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // GET /project/:work_id/calendar — календарная сетка
  fastify.get('/project/:work_id/calendar', crmAuth, async (req, reply) => {
    try {
      const workId = parseInt(req.params.work_id);
      const dateFrom = req.query.date_from;
      const dateTo = req.query.date_to;

      if (!dateFrom || !dateTo) {
        return reply.code(400).send({ error: 'Укажите date_from и date_to' });
      }

      const { rows } = await db.query(`
        SELECT s.employee_id, e.fio, s.stage_type, s.status, s.date_from, s.date_to, s.source,
               s.days_count, s.rate_per_day, s.amount_earned, s.details
        FROM field_trip_stages s
        JOIN employees e ON e.id = s.employee_id
        WHERE s.work_id = $1
          AND s.date_from <= $3::date
          AND COALESCE(s.date_to, s.date_from) >= $2::date
          AND s.status != 'rejected'
        ORDER BY e.fio, s.date_from
      `, [workId, dateFrom, dateTo]);

      // Также объектные смены
      const { rows: checkins } = await db.query(`
        SELECT employee_id, date, 'object' AS stage_type, status
        FROM field_checkins
        WHERE work_id = $1 AND date >= $2::date AND date <= $3::date AND status != 'cancelled'
      `, [workId, dateFrom, dateTo]);

      // Собрать сотрудников
      const empMap = {};
      for (const r of rows) {
        if (!empMap[r.employee_id]) empMap[r.employee_id] = { employee_id: r.employee_id, fio: r.fio, days: {} };
        // Раскрыть диапазон дат
        const dEnd = r.date_to ? new Date(r.date_to) : new Date(r.date_from);
        const cur = new Date(r.date_from);
        while (cur <= dEnd) {
          const ds = cur.toISOString().slice(0, 10);
          empMap[r.employee_id].days[ds] = { type: r.stage_type, status: r.status, source: r.source };
          cur.setDate(cur.getDate() + 1);
        }
      }

      for (const c of checkins) {
        const ds = c.date instanceof Date ? c.date.toISOString().slice(0, 10) : String(c.date).slice(0, 10);
        if (!empMap[c.employee_id]) {
          // Найти fio
          const { rows: eRows } = await db.query(`SELECT fio FROM employees WHERE id=$1`, [c.employee_id]);
          empMap[c.employee_id] = { employee_id: c.employee_id, fio: eRows[0]?.fio || '?', days: {} };
        }
        empMap[c.employee_id].days[ds] = { type: 'object', status: c.status, source: 'checkin' };
      }

      return { employees: Object.values(empMap), date_from: dateFrom, date_to: dateTo };
    } catch (err) {
      fastify.log.error('[field-stages] GET /calendar error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // GET /employee/:employee_id/work/:work_id — этапы сотрудника
  fastify.get('/employee/:employee_id/work/:work_id', crmAuth, async (req, reply) => {
    try {
      const empId = parseInt(req.params.employee_id);
      const workId = parseInt(req.params.work_id);

      const { rows } = await db.query(`
        SELECT s.*, tg.position_name AS tariff_name
        FROM field_trip_stages s
        LEFT JOIN field_tariff_grid tg ON tg.id = s.tariff_id
        WHERE s.employee_id = $1 AND s.work_id = $2
        ORDER BY s.date_from
      `, [empId, workId]);

      return { stages: rows };
    } catch (err) {
      fastify.log.error('[field-stages] GET /employee/:eid/work/:wid error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // PUT /:id/approve — подтвердить этап
  fastify.put('/:id/approve', crmAuth, async (req, reply) => {
    try {
      const stageId = parseInt(req.params.id);
      const userId = req.user.id;
      const { days_approved, adjustment_note } = req.body || {};

      const { rows: existing } = await db.query(`SELECT * FROM field_trip_stages WHERE id=$1`, [stageId]);
      if (existing.length === 0) return reply.code(404).send({ error: 'Этап не найден' });

      const stage = existing[0];
      let newStatus = 'approved';
      let daysAppr = stage.days_count;
      let amountEarned = parseFloat(stage.amount_earned);

      if (days_approved != null && days_approved !== stage.days_count) {
        newStatus = 'adjusted';
        daysAppr = days_approved;
        amountEarned = daysAppr * parseFloat(stage.rate_per_day);
      }

      const { rows } = await db.query(`
        UPDATE field_trip_stages
        SET status=$1, days_approved=$2, amount_earned=$3, approved_by=$4, approved_at=NOW(),
            adjustment_note=$5, updated_at=NOW()
        WHERE id=$6
        RETURNING *
      `, [newStatus, daysAppr, amountEarned, userId, adjustment_note || null, stageId]);

      return { stage: rows[0] };
    } catch (err) {
      fastify.log.error('[field-stages] PUT /:id/approve error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // PUT /:id/reject — отклонить этап
  fastify.put('/:id/reject', crmAuth, async (req, reply) => {
    try {
      const stageId = parseInt(req.params.id);
      const userId = req.user.id;
      const { adjustment_note } = req.body || {};

      const { rows } = await db.query(`
        UPDATE field_trip_stages
        SET status='rejected', amount_earned=0, approved_by=$1, approved_at=NOW(),
            adjustment_note=$2, updated_at=NOW()
        WHERE id=$3
        RETURNING *
      `, [userId, adjustment_note || 'Отклонено', stageId]);

      if (rows.length === 0) return reply.code(404).send({ error: 'Этап не найден' });
      return { stage: rows[0] };
    } catch (err) {
      fastify.log.error('[field-stages] PUT /:id/reject error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // PUT /:id — редактировать этап
  fastify.put('/:id', crmAuth, async (req, reply) => {
    try {
      const stageId = parseInt(req.params.id);
      const { date_from, date_to, details, note, stage_type } = req.body || {};

      const { rows: existing } = await db.query(`SELECT * FROM field_trip_stages WHERE id=$1`, [stageId]);
      if (existing.length === 0) return reply.code(404).send({ error: 'Этап не найден' });

      const stage = existing[0];
      if (['approved', 'adjusted'].includes(stage.status)) {
        return reply.code(400).send({ error: 'Нельзя редактировать подтверждённый этап' });
      }

      const newFrom = date_from || stage.date_from;
      const newTo = date_to !== undefined ? date_to : stage.date_to;
      const newType = stage_type || stage.stage_type;
      const days = calcDays(newFrom, newTo);
      const amount = days * parseFloat(stage.rate_per_day);

      const { rows } = await db.query(`
        UPDATE field_trip_stages
        SET date_from=COALESCE($1, date_from), date_to=$2, stage_type=$3,
            details=COALESCE($4, details), note=COALESCE($5, note),
            days_count=$6, amount_earned=$7, updated_at=NOW()
        WHERE id=$8
        RETURNING *
      `, [date_from || null, newTo || null, newType,
          details ? JSON.stringify(details) : null, note || null,
          days, amount, stageId]);

      return { stage: rows[0] };
    } catch (err) {
      fastify.log.error('[field-stages] PUT /:id error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // DELETE /:id — удалить этап
  fastify.delete('/:id', crmAuth, async (req, reply) => {
    try {
      const stageId = parseInt(req.params.id);

      const { rows: existing } = await db.query(`SELECT status FROM field_trip_stages WHERE id=$1`, [stageId]);
      if (existing.length === 0) return reply.code(404).send({ error: 'Этап не найден' });

      if (existing[0].status !== 'planned') {
        return reply.code(400).send({ error: 'Удалить можно только запланированный этап' });
      }

      await db.query(`DELETE FROM field_trip_stages WHERE id=$1`, [stageId]);
      return { ok: true };
    } catch (err) {
      fastify.log.error('[field-stages] DELETE /:id error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // POST /bulk — массовое создание
  fastify.post('/bulk', crmAuth, async (req, reply) => {
    try {
      const userId = req.user.id;
      const { employee_ids, work_id, stage_type, date_from, date_to, details } = req.body || {};

      if (!employee_ids?.length || !work_id || !stage_type || !date_from) {
        return reply.code(400).send({ error: 'Укажите employee_ids, work_id, stage_type, date_from' });
      }
      if (!STAGE_TYPES.includes(stage_type)) {
        return reply.code(400).send({ error: 'Неизвестный тип этапа' });
      }

      const tariff = await findTariff(stage_type, work_id);
      const created = [];

      for (const empId of employee_ids) {
        try {
          const stage = await insertStage({
            employee_id: empId, work_id, stage_type, date_from, date_to,
            tariff_id: tariff.id, tariff_points: tariff.points, rate_per_day: tariff.rate,
            details, source: 'pm', status: 'planned', created_by: userId,
          });
          created.push(stage);
        } catch (e) {
          if (e.code !== '23505') throw e; // пропустить дубликаты
        }
      }

      return { created_count: created.length, stages: created };
    } catch (err) {
      fastify.log.error('[field-stages] POST /bulk error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // MASTER ENDPOINTS (Field auth)
  // ═══════════════════════════════════════════════════════════════

  // GET /my-crew/:work_id — этапы бригады
  fastify.get('/my-crew/:work_id', fieldAuth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const workId = parseInt(req.params.work_id);

      if (!(await isMaster(empId, workId))) {
        return reply.code(403).send({ error: 'Только мастер может просматривать бригаду' });
      }

      const crewIds = await getCrewIds(empId, workId);
      if (crewIds.length === 0) return { employees: [] };

      const { rows } = await db.query(`
        SELECT s.*, e.fio
        FROM field_trip_stages s
        JOIN employees e ON e.id = s.employee_id
        WHERE s.work_id = $1 AND s.employee_id = ANY($2)
        ORDER BY e.fio, s.date_from
      `, [workId, crewIds]);

      const byEmployee = {};
      for (const r of rows) {
        if (!byEmployee[r.employee_id]) {
          byEmployee[r.employee_id] = { employee_id: r.employee_id, fio: r.fio, stages: [], total_days: 0, total_earned: 0 };
        }
        byEmployee[r.employee_id].stages.push(r);
        if (r.status !== 'rejected') {
          byEmployee[r.employee_id].total_days += r.days_approved || r.days_count || 0;
          byEmployee[r.employee_id].total_earned += parseFloat(r.amount_earned || 0);
        }
      }

      return { employees: Object.values(byEmployee) };
    } catch (err) {
      fastify.log.error('[field-stages] GET /my-crew/:id error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // POST /on-behalf — мастер создаёт этап за рабочего
  fastify.post('/on-behalf', fieldAuth, async (req, reply) => {
    try {
      const masterEmpId = req.fieldEmployee.id;
      const { employee_id, work_id, stage_type, date_from, date_to, details, note } = req.body || {};

      if (!employee_id || !work_id || !stage_type || !date_from) {
        return reply.code(400).send({ error: 'Укажите employee_id, work_id, stage_type, date_from' });
      }

      if (!(await isMaster(masterEmpId, work_id))) {
        return reply.code(403).send({ error: 'Только мастер может отмечать за рабочего' });
      }

      // Проверить что рабочий в бригаде
      const crewIds = await getCrewIds(masterEmpId, work_id);
      if (!crewIds.includes(employee_id)) {
        return reply.code(403).send({ error: 'Сотрудник не в вашей бригаде' });
      }

      if (!STAGE_TYPES.includes(stage_type) || stage_type === 'object') {
        return reply.code(400).send({ error: 'Недопустимый тип этапа' });
      }

      const tariff = await findTariff(stage_type, work_id);
      const stage = await insertStage({
        employee_id, work_id, stage_type, date_from, date_to,
        tariff_id: tariff.id, tariff_points: tariff.points, rate_per_day: tariff.rate,
        details, source: 'master', source_employee_id: masterEmpId,
        status: 'active', note, created_by: masterEmpId,
      });

      return { stage };
    } catch (err) {
      if (err.code === '23505') return reply.code(409).send({ error: 'Этап уже существует на эту дату' });
      fastify.log.error('[field-stages] POST /on-behalf error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // PUT /on-behalf/:id — мастер обновляет этап
  fastify.put('/on-behalf/:id', fieldAuth, async (req, reply) => {
    try {
      const masterEmpId = req.fieldEmployee.id;
      const stageId = parseInt(req.params.id);
      const { date_to, details, note, photo_filename } = req.body || {};

      const { rows: existing } = await db.query(`SELECT * FROM field_trip_stages WHERE id=$1`, [stageId]);
      if (existing.length === 0) return reply.code(404).send({ error: 'Этап не найден' });

      const stage = existing[0];
      if (!(await isMaster(masterEmpId, stage.work_id))) {
        return reply.code(403).send({ error: 'Только мастер может обновлять этапы бригады' });
      }

      const newTo = date_to || stage.date_to;
      const days = calcDays(stage.date_from, newTo);
      const amount = days * parseFloat(stage.rate_per_day);
      const newStatus = date_to ? 'completed' : stage.status;

      const { rows } = await db.query(`
        UPDATE field_trip_stages
        SET date_to=COALESCE($1, date_to), details=COALESCE($2, details), note=COALESCE($3, note),
            photo_filename=COALESCE($4, photo_filename), days_count=$5, amount_earned=$6,
            status=$7, updated_at=NOW()
        WHERE id=$8
        RETURNING *
      `, [date_to || null, details ? JSON.stringify(details) : null, note || null,
          photo_filename || null, days, amount, newStatus, stageId]);

      return { stage: rows[0] };
    } catch (err) {
      fastify.log.error('[field-stages] PUT /on-behalf/:id error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // POST /request-correction — мастер запрашивает корректировку
  fastify.post('/request-correction', fieldAuth, async (req, reply) => {
    try {
      const masterEmpId = req.fieldEmployee.id;
      const { stage_id, requested_days, note } = req.body || {};

      if (!stage_id || !note) {
        return reply.code(400).send({ error: 'Укажите stage_id и note' });
      }

      const { rows: stageRows } = await db.query(`
        SELECT s.*, e.fio AS emp_fio
        FROM field_trip_stages s
        JOIN employees e ON e.id = s.employee_id
        WHERE s.id = $1
      `, [stage_id]);
      if (stageRows.length === 0) return reply.code(404).send({ error: 'Этап не найден' });

      const stage = stageRows[0];
      if (!(await isMaster(masterEmpId, stage.work_id))) {
        return reply.code(403).send({ error: 'Только мастер может запрашивать корректировку' });
      }

      // Найти ФИО мастера
      const { rows: masterRows } = await db.query(`SELECT fio FROM employees WHERE id=$1`, [masterEmpId]);
      const masterFio = masterRows[0]?.fio || 'Мастер';

      // Отправить уведомление РП
      const { rows: workRows } = await db.query(`SELECT pm_id FROM works WHERE id=$1`, [stage.work_id]);
      if (workRows[0]?.pm_id) {
        await createNotification(db, {
          user_id: workRows[0].pm_id,
          title: 'Запрос корректировки этапа',
          message: `Мастер ${masterFio} просит скорректировать этап "${STAGE_LABELS[stage.stage_type]}" для ${stage.emp_fio}: ${note}`,
          link: '/works/' + stage.work_id,
          type: 'field_correction',
        });
      }

      return { ok: true, message: 'Запрос отправлен РП' };
    } catch (err) {
      fastify.log.error('[field-stages] POST /request-correction error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // WORKER ENDPOINTS (Field auth)
  // ═══════════════════════════════════════════════════════════════

  // GET /my/:work_id — мои этапы
  fastify.get('/my/:work_id', fieldAuth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const workId = parseInt(req.params.work_id);

      const { rows } = await db.query(`
        SELECT s.*, tg.position_name AS tariff_name
        FROM field_trip_stages s
        LEFT JOIN field_tariff_grid tg ON tg.id = s.tariff_id
        WHERE s.employee_id = $1 AND s.work_id = $2
        ORDER BY s.date_from
      `, [empId, workId]);

      // Итоги
      let totalDays = 0, totalEarned = 0;
      for (const r of rows) {
        if (r.status !== 'rejected') {
          totalDays += r.days_approved || r.days_count || 0;
          totalEarned += parseFloat(r.amount_earned || 0);
        }
      }

      return { stages: rows, total_days: totalDays, total_earned: totalEarned };
    } catch (err) {
      fastify.log.error('[field-stages] GET /my/:id error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // POST /my/start — начать этап
  fastify.post('/my/start', fieldAuth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const { work_id, stage_type, details } = req.body || {};

      if (!work_id || !stage_type) {
        return reply.code(400).send({ error: 'Укажите work_id и stage_type' });
      }

      // Рабочий не может создать object, waiting, day_off
      if (['object', 'waiting', 'day_off'].includes(stage_type)) {
        return reply.code(400).send({ error: 'Этот тип этапа создаётся только мастером или РП' });
      }
      if (!STAGE_TYPES.includes(stage_type)) {
        return reply.code(400).send({ error: 'Неизвестный тип этапа' });
      }

      const today = new Date().toISOString().slice(0, 10);

      // Проверка дубликата
      const { rows: dup } = await db.query(
        `SELECT id FROM field_trip_stages WHERE employee_id=$1 AND work_id=$2 AND stage_type=$3 AND date_from=$4 AND status != 'rejected'`,
        [empId, work_id, stage_type, today]
      );
      if (dup.length > 0) {
        return reply.code(409).send({ error: 'Этап такого типа уже начат сегодня' });
      }

      const tariff = await findTariff(stage_type, work_id);
      const stage = await insertStage({
        employee_id: empId, work_id, stage_type, date_from: today,
        tariff_id: tariff.id, tariff_points: tariff.points, rate_per_day: tariff.rate,
        details, source: 'self', status: 'active', created_by: empId,
      });

      return { stage };
    } catch (err) {
      if (err.code === '23505') return reply.code(409).send({ error: 'Этап уже существует на сегодня' });
      fastify.log.error('[field-stages] POST /my/start error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // POST /my/end — завершить этап
  fastify.post('/my/end', fieldAuth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const { stage_id, photo_filename, note } = req.body || {};

      if (!stage_id) return reply.code(400).send({ error: 'Укажите stage_id' });

      const { rows: existing } = await db.query(
        `SELECT * FROM field_trip_stages WHERE id=$1 AND employee_id=$2`,
        [stage_id, empId]
      );
      if (existing.length === 0) return reply.code(404).send({ error: 'Этап не найден' });

      const stage = existing[0];
      if (stage.status !== 'active') {
        return reply.code(400).send({ error: 'Можно завершить только активный этап' });
      }

      // Для медосмотра фото обязательно
      if (stage.stage_type === 'medical' && !photo_filename && !stage.photo_filename) {
        return reply.code(400).send({ error: 'Для медосмотра необходимо фото заключения' });
      }

      const today = new Date().toISOString().slice(0, 10);
      const days = calcDays(stage.date_from, today);
      const amount = days * parseFloat(stage.rate_per_day);

      const { rows } = await db.query(`
        UPDATE field_trip_stages
        SET date_to=$1, days_count=$2, amount_earned=$3, status='completed',
            photo_filename=COALESCE($4, photo_filename), note=COALESCE($5, note), updated_at=NOW()
        WHERE id=$6
        RETURNING *
      `, [today, days, amount, photo_filename || null, note || null, stage_id]);

      return { stage: rows[0] };
    } catch (err) {
      fastify.log.error('[field-stages] POST /my/end error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // GET /my/current/:work_id — текущий активный этап
  fastify.get('/my/current/:work_id', fieldAuth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const workId = parseInt(req.params.work_id);

      const { rows } = await db.query(`
        SELECT s.*, tg.position_name AS tariff_name
        FROM field_trip_stages s
        LEFT JOIN field_tariff_grid tg ON tg.id = s.tariff_id
        WHERE s.employee_id = $1 AND s.work_id = $2 AND s.status = 'active'
        ORDER BY s.date_from DESC
        LIMIT 1
      `, [empId, workId]);

      return rows.length > 0 ? rows[0] : null;
    } catch (err) {
      fastify.log.error('[field-stages] GET /my/current/:id error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });
}

module.exports = routes;
