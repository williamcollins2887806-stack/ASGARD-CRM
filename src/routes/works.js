/**
 * Works Routes
 */

// SECURITY: Allowlist of columns for works
const ALLOWED_COLS = new Set([
  'tender_id', 'pm_id', 'work_number', 'work_title', 'work_status',
  'customer_name', 'start_date', 'start_plan', 'end_plan', 'end_fact',
  'created_by', 'created_at', 'updated_at',
  'staff_ids_json', 'cost_plan', 'cost_fact', 'start_fact', 'customer_inn',
  'start_in_work_date',
  'contract_value', 'city', 'address', 'object_name',
  'contact_person', 'contact_phone', 'object_address', 'description', 'notes',
  'priority', 'is_vachta', 'rotation_days', 'hr_comment',
  'advance_pct', 'advance_received', 'balance_received', 'site_id',
  'advance_date_fact', 'payment_date_fact', 'act_signed_date_fact',
  'delay_workdays', 'crew_size', 'comment',
  'closeout_submitted_at', 'closeout_submitted_by', 'closed_at',
  'vat_pct', 'customer_score'
]);

// Маппинг устаревших имён колонок на канонические (обратная совместимость AsgardDB)
const COL_ALIASES = {
  contract_sum: 'contract_value',
  w_adv_pct: 'advance_pct',
  advance_percent: 'advance_pct',
  work_name: 'work_title',
  end_date_plan: 'end_plan',
  start_date_plan: 'start_plan',
  work_start_plan: 'start_plan',
  work_end_plan: 'end_plan',
  responsible_pm_id: 'pm_id',
  status: 'work_status',
  end_date_fact: 'end_fact',
  advance_sum: 'advance_received',
  balance_sum: 'balance_received'
};

function filterData(data) {
  const filtered = {};
  for (const [k, v] of Object.entries(data)) {
    const canonical = COL_ALIASES[k] || k;
    if (ALLOWED_COLS.has(canonical) && v !== undefined) {
      // Каноничное значение имеет приоритет — не перезаписываем если уже есть
      if (!filtered[canonical]) filtered[canonical] = v;
    }
  }
  return filtered;
}

// B6: Валидация дат
const DATE_FIELDS = new Set([
  'start_in_work_date', 'end_plan', 'end_fact', 'start_plan', 'start_fact',
  'advance_date_fact', 'payment_date_fact', 'act_signed_date_fact'
]);

function validateDates(data) {
  for (const [key, value] of Object.entries(data)) {
    if (DATE_FIELDS.has(key) && value !== undefined && value !== null && value !== '') {
      const d = new Date(value);
      if (isNaN(d.getTime())) return `Некорректная дата: ${key} = "${value}"`;
    }
  }
  return null;
}

// B9: State machine — разрешённые переходы статусов (8 статусов)
const STATUS_TRANSITIONS = {
  'Новая':            ['Подготовка'],
  'Подготовка':       ['Мобилизация', 'Новая'],
  'Мобилизация':      ['В работе', 'Подготовка'],
  'В работе':         ['Подписание акта', 'На паузе'],
  'На паузе':         ['В работе'],
  'Подписание акта':  ['Работы сдали'],
  'Работы сдали':     ['Закрыт'],
  'Закрыт':           []
};

function isValidTransition(from, to) {
  if (!from) return true;
  const allowed = STATUS_TRANSITIONS[from];
  if (!allowed) return true; // Неизвестный статус — пропускаем (обратная совместимость)
  return allowed.includes(to);
}

async function routes(fastify, options) {
  const db = fastify.db;
  const { createNotification } = require('../services/notify');

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tender_id, pm_id, status, limit = 100, offset = 0, include_deleted } = request.query;
    const user = request.user;
    let sql = 'SELECT w.*, t.customer_name as customer, u.name as pm_name FROM works w LEFT JOIN tenders t ON w.tender_id = t.id LEFT JOIN users u ON w.pm_id = u.id WHERE w.deleted_at IS NULL';
    const params = [];
    let idx = 1;

    // B2: PM видит только свои работы
    if (user.role === 'PM') {
      sql += ` AND w.pm_id = $${idx}`;
      params.push(user.id);
      idx++;
    }

    if (tender_id) { sql += ` AND w.tender_id = $${idx}`; params.push(tender_id); idx++; }
    if (pm_id) { sql += ` AND w.pm_id = $${idx}`; params.push(pm_id); idx++; }
    if (status) { sql += ` AND w.work_status = $${idx}`; params.push(status); idx++; }
    sql += ` ORDER BY w.id DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);
    const result = await db.query(sql, params);

    // B2: Ограниченные роли — скрываем финансы
    const FINANCE_HIDDEN_ROLES = new Set(['TO', 'HEAD_TO', 'WAREHOUSE', 'OFFICE_MANAGER']);
    if (FINANCE_HIDDEN_ROLES.has(user.role)) {
      const finFields = ['contract_value', 'cost_plan', 'cost_fact', 'advance_received',
        'balance_received', 'advance_pct', 'advance_date_fact', 'payment_date_fact', 'vat_pct'];
      for (const w of result.rows) {
        for (const f of finFields) delete w[f];
      }
    }

    return { works: result.rows };
  });

  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const result = await db.query('SELECT * FROM works WHERE id = $1 AND deleted_at IS NULL', [request.params.id]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Работа не найдена' });
    const expenses = await db.query('SELECT * FROM work_expenses WHERE work_id = $1', [request.params.id]);
    return { work: result.rows[0], expenses: expenses.rows };
  });

  // SECURITY: SQL injection fix + B3 role check + try/catch
  fastify.post('/', { preHandler: [fastify.requireRoles(['ADMIN', 'PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'])] }, async (request, reply) => {
    try {
      const body = request.body || {};
      if (!body.work_title?.trim()) {
        return reply.code(400).send({ error: 'Обязательное поле: work_title' });
      }
      // Truncate overly long title
      if (body.work_title && body.work_title.length > 1000) {
        body.work_title = body.work_title.substring(0, 1000);
      }
      const data = filterData({ ...body, created_by: request.user.id, created_at: new Date().toISOString() });
      // B6: Валидация дат
      const dateError = validateDates(data);
      if (dateError) return reply.code(400).send({ error: dateError });
      const keys = Object.keys(data);
      if (!keys.length) return reply.code(400).send({ error: 'Нет данных' });
      const values = Object.values(data);
      const sql = `INSERT INTO works (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
      const result = await db.query(sql, values);
      const work = result.rows[0];
      // Notify PM about new work
      if (work.pm_id && work.pm_id !== request.user.id) {
        createNotification(db, {
          user_id: work.pm_id,
          title: '🔧 Новая работа',
          message: `${request.user.name || 'Пользователь'} создал работу: ${work.work_title}`,
          type: 'work',
          link: `#/pm-works?id=${work.id}`
        });
      }
      return { work };
    } catch (err) {
      fastify.log.error('Works POST error:', err);
      return reply.code(500).send({ error: 'Ошибка создания работы', detail: err.message });
    }
  });

  fastify.put('/:id', { preHandler: [fastify.requireRoles(['ADMIN', 'PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'])] }, async (request, reply) => {
    const { id } = request.params;
    const oldWork = await db.query('SELECT * FROM works WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!oldWork.rows[0]) return reply.code(404).send({ error: 'Работа не найдена' });
    const data = filterData(request.body);

    // B6: Валидация дат
    const dateError = validateDates(data);
    if (dateError) return reply.code(400).send({ error: dateError });

    // B9: State machine — проверка перехода статуса
    if (data.work_status && data.work_status !== oldWork.rows[0].work_status) {
      const oldStatus = oldWork.rows[0].work_status || '';
      const newStatus = data.work_status;
      if (!isValidTransition(oldStatus, newStatus)) {
        // ADMIN и DIRECTOR_GEN могут обходить
        if (!['ADMIN', 'DIRECTOR_GEN'].includes(request.user.role)) {
          return reply.code(400).send({
            error: `Недопустимый переход статуса: "${oldStatus}" → "${newStatus}"`,
            allowed: STATUS_TRANSITIONS[oldStatus] || []
          });
        }
      }
      // PM не может напрямую поставить "Работы сдали" — только через closeout
      if (newStatus === 'Работы сдали' && request.user.role === 'PM') {
        return reply.code(400).send({ error: 'Используйте endpoint closeout для завершения работы' });
      }
    }

    const updates = [];
    const values = [];
    let idx = 1;
    for (const [key, value] of Object.entries(data)) {
      updates.push(`${key} = $${idx}`); values.push(value); idx++;
    }
    if (!updates.length) return reply.code(400).send({ error: 'Нет данных' });
    updates.push('updated_at = NOW()');
    values.push(id);
    const sql = `UPDATE works SET ${updates.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL RETURNING *`;
    const result = await db.query(sql, values);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найдена' });
    const updated = result.rows[0];
    // Notify PM on status change
    if (data.work_status && oldWork.rows[0] && data.work_status !== oldWork.rows[0].work_status && updated.pm_id && updated.pm_id !== request.user.id) {
      createNotification(db, {
        user_id: updated.pm_id,
        title: `🔧 Работа: ${data.work_status}`,
        message: `Статус работы "${updated.work_title || ''}" изменён: ${oldWork.rows[0].work_status || '?'} → ${data.work_status}`,
        type: 'work',
        link: `#/pm-works?id=${updated.id}`
      });
    }
    // Notify new PM on reassignment
    if (data.pm_id && oldWork.rows[0] && data.pm_id !== oldWork.rows[0].pm_id && data.pm_id !== request.user.id) {
      createNotification(db, {
        user_id: data.pm_id,
        title: '🔧 Работа назначена вам',
        message: `Вам назначена работа: ${updated.work_title || ''}`,
        type: 'work',
        link: `#/pm-works?id=${updated.id}`
      });
    }
    return { work: updated };
  });

  // A1: Soft delete по умолчанию, hard delete только ADMIN с ?hard=true
  // D10/B3: FK CASCADE/SET NULL делают основную работу при hard delete
  fastify.delete('/:id', { preHandler: [fastify.requireRoles(['ADMIN', 'DIRECTOR_GEN'])] }, async (request, reply) => {
    const workId = request.params.id;
    const hard = request.query.hard === 'true';

    try {
      if (!hard) {
        // Soft delete
        const result = await db.query(
          'UPDATE works SET deleted_at = NOW(), deleted_by = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING id',
          [request.user.id, workId]
        );
        if (!result.rows[0]) return reply.code(404).send({ error: 'Работа не найдена или уже удалена' });
        return { message: 'Работа помечена как удалённая', soft: true };
      }

      // Hard delete (только ADMIN)
      if (request.user.role !== 'ADMIN') {
        return reply.code(403).send({ error: 'Полное удаление доступно только ADMIN' });
      }

      // Чистим таблицы без FK CASCADE перед удалением
      const srIds = await db.query('SELECT id FROM staff_requests WHERE work_id = $1', [workId]);
      if (srIds.rows.length) {
        const ids = srIds.rows.map(r => r.id);
        await db.query('DELETE FROM staff_request_messages WHERE staff_request_id = ANY($1)', [ids]);
        await db.query('DELETE FROM staff_replacements WHERE staff_request_id = ANY($1)', [ids]);
      }

      const result = await db.query('DELETE FROM works WHERE id = $1 RETURNING id', [workId]);
      if (!result.rows[0]) return reply.code(404).send({ error: 'Работа не найдена' });
      return { message: 'Работа удалена', soft: false };
    } catch (err) {
      request.log.error(err, 'works delete error');
      return reply.code(500).send({ error: 'Не удалось удалить работу', detail: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // M15: Аналитика РП (для HEAD_PM)
  // ═══════════════════════════════════════════════════════════════

  fastify.get('/analytics/team', {
    preHandler: [fastify.requireRoles(['HEAD_PM', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'])]
  }, async (request, reply) => {
    try {
    const { year } = request.query;

    let whereClause = '1=1';
    const params = [];
    let idx = 1;

    if (year) {
      whereClause += ` AND (EXTRACT(YEAR FROM COALESCE(w.start_fact, w.start_plan, w.start_in_work_date, w.created_at)) = $${idx} OR w.tender_id IN (SELECT id FROM tenders WHERE EXTRACT(YEAR FROM updated_at) = $${idx}))`;
      params.push(parseInt(year));
      idx++;
    }

    // KPI по каждому РП
    const teamKpi = await db.query(`
      SELECT
        u.id,
        u.name,
        u.role,
        u.employment_date,
        COUNT(w.id) as total_works,
        COUNT(w.id) FILTER (WHERE w.work_status NOT IN ('Работы сдали', 'Закрыт')) as active,
        COUNT(w.id) FILTER (WHERE w.work_status = 'Работы сдали') as completed,
        COUNT(w.id) FILTER (WHERE w.end_plan < NOW() AND w.work_status NOT IN ('Работы сдали', 'Закрыт')) as overdue,
        COALESCE(SUM(w.contract_value), 0) as total_contract,
        COALESCE(SUM(w.cost_plan), 0) as total_cost_plan,
        COALESCE(SUM(w.cost_fact), 0) as total_cost_fact,
        COALESCE(SUM(w.contract_value), 0) - COALESCE(SUM(w.cost_fact), 0) as profit,
        COUNT(DISTINCT e.id) as active_estimates
      FROM users u
      LEFT JOIN works w ON w.pm_id = u.id AND w.deleted_at IS NULL AND ${whereClause}
      LEFT JOIN estimates e ON e.pm_id = u.id AND e.approval_status NOT IN ('rejected', 'closed')
      WHERE u.role IN ('PM', 'HEAD_PM', 'DIRECTOR_DEV', 'DIRECTOR_GEN', 'CHIEF_ENGINEER', 'HR') AND u.is_active = true AND EXISTS (SELECT 1 FROM works w2 WHERE w2.pm_id = u.id AND w2.deleted_at IS NULL)
      GROUP BY u.id, u.name, u.role, u.employment_date
      ORDER BY total_contract DESC
    `, params);

    // B4: Общая сводка — отдельный WHERE без хрупкого .replace(/w\./g, '')
    let deptWhere = 'deleted_at IS NULL';
    const deptParams = [];
    let deptIdx = 1;
    if (year) {
      deptWhere += ` AND (EXTRACT(YEAR FROM COALESCE(start_fact, start_plan, start_in_work_date, created_at)) = $${deptIdx} OR tender_id IN (SELECT id FROM tenders WHERE EXTRACT(YEAR FROM updated_at) = $${deptIdx}))`;
      deptParams.push(parseInt(year));
      deptIdx++;
    }
    const deptTotal = await db.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE work_status NOT IN ('Работы сдали', 'Закрыт')) as active,
        COUNT(*) FILTER (WHERE work_status = 'Работы сдали') as completed,
        COUNT(*) FILTER (WHERE end_plan < NOW() AND work_status NOT IN ('Работы сдали', 'Закрыт')) as overdue,
        COALESCE(SUM(contract_value), 0) as total_contract,
        COALESCE(SUM(contract_value), 0) - COALESCE(SUM(cost_fact), 0) as total_profit
      FROM works
      WHERE ${deptWhere}
    `, deptParams);

    // По месяцам
    const byMonth = await db.query(`
      SELECT
        TO_CHAR(COALESCE(w.start_fact, w.start_plan, w.start_in_work_date, w.created_at), 'YYYY-MM') as month,
        COUNT(*) as total,
        COALESCE(SUM(contract_value), 0) as total_contract,
        COUNT(*) FILTER (WHERE work_status = 'Работы сдали') as completed
      FROM works w
      WHERE w.deleted_at IS NULL AND COALESCE(w.start_fact, w.start_plan, w.start_in_work_date, w.created_at) >= NOW() - INTERVAL '12 months'
      GROUP BY TO_CHAR(COALESCE(w.start_fact, w.start_plan, w.start_in_work_date, w.created_at), 'YYYY-MM')
      ORDER BY month
    `);

    return {
      team: teamKpi.rows,
      department: deptTotal.rows[0],
      byMonth: byMonth.rows
    };
    } catch (err) {
      request.log.error(err, 'works analytics/team error');
      return reply.code(500).send({ error: 'Analytics error', details: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // B8: Серверный closeout — закрытие работы с оценками и уведомлениями
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/:id/closeout', {
    preHandler: [fastify.requireRoles(['PM', 'HEAD_PM', 'ADMIN', 'DIRECTOR_GEN'])]
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body || {};

    try {
      const workRes = await db.query('SELECT * FROM works WHERE id = $1 AND deleted_at IS NULL', [id]);
      if (!workRes.rows[0]) return reply.code(404).send({ error: 'Работа не найдена' });
      const work = workRes.rows[0];

      // Проверить статус
      const triggerStatus = body.trigger_status || 'Подписание акта';
      if (work.work_status !== triggerStatus) {
        return reply.code(400).send({
          error: `Closeout доступен только на статусе "${triggerStatus}". Текущий: "${work.work_status}"`
        });
      }

      // Валидировать обязательные поля
      const { end_fact, cost_fact, contract_value } = body;
      if (!end_fact) return reply.code(400).send({ error: 'Обязательное поле: end_fact' });
      if (cost_fact == null || isNaN(Number(cost_fact)) || Number(cost_fact) <= 0) {
        return reply.code(400).send({ error: 'Обязательное поле: cost_fact (> 0)' });
      }
      if (contract_value == null || isNaN(Number(contract_value)) || Number(contract_value) <= 0) {
        return reply.code(400).send({ error: 'Обязательное поле: contract_value (> 0)' });
      }

      // Валидировать оценки сотрудников
      const { employee_ratings, customer_rating } = body;
      if (Array.isArray(employee_ratings)) {
        for (const r of employee_ratings) {
          if (!r.employee_id) return reply.code(400).send({ error: 'Оценка сотрудника: обязательно employee_id' });
          if (!r.score || r.score < 1 || r.score > 10) return reply.code(400).send({ error: `Оценка ${r.employee_id}: score 1-10` });
        }
      }

      if (customer_rating) {
        if (!customer_rating.score || customer_rating.score < 1 || customer_rating.score > 10) {
          return reply.code(400).send({ error: 'Оценка заказчика: score 1-10' });
        }
      }

      // Обновить работу
      const updateRes = await db.query(`
        UPDATE works SET
          work_status = 'Работы сдали',
          end_fact = $1,
          cost_fact = $2,
          contract_value = $3,
          advance_received = COALESCE($4, advance_received),
          balance_received = COALESCE($5, balance_received),
          advance_date_fact = COALESCE($6, advance_date_fact),
          payment_date_fact = COALESCE($7, payment_date_fact),
          act_signed_date_fact = COALESCE($8, act_signed_date_fact),
          closeout_submitted_at = NOW(),
          closeout_submitted_by = $9,
          closed_at = NOW(),
          updated_at = NOW()
        WHERE id = $10 AND deleted_at IS NULL RETURNING *
      `, [
        end_fact, cost_fact, contract_value,
        body.advance_received, body.balance_received,
        body.advance_date_fact, body.payment_date_fact, body.act_signed_date_fact,
        request.user.id, id
      ]);

      // Сохранить оценки сотрудников
      if (Array.isArray(employee_ratings)) {
        for (const r of employee_ratings) {
          await db.query(`
            INSERT INTO employee_reviews (employee_id, work_id, pm_id, rating, score, comment, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $4, $5, NOW(), NOW())
            ON CONFLICT DO NOTHING
          `, [r.employee_id, id, request.user.id, r.score, r.comment || '']);
        }
      }

      // Сохранить оценку заказчика
      if (customer_rating) {
        await db.query(`
          INSERT INTO customer_reviews (work_id, pm_id, rating, score, comment, created_at, updated_at)
          VALUES ($1, $2, $3, $3, $4, NOW(), NOW())
          ON CONFLICT DO NOTHING
        `, [id, request.user.id, customer_rating.score, customer_rating.comment || '']);
      }

      // Уведомить директоров
      const directors = await db.query(
        "SELECT id FROM users WHERE role IN ('DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV') AND is_active = true"
      );
      const profit = Number(contract_value) - Number(cost_fact);
      for (const d of directors.rows) {
        createNotification(db, {
          user_id: d.id,
          title: 'Закрытие контракта',
          message: `${work.customer_name || ''} — ${work.work_title || ''}\nПрибыль: ${Math.round(profit)} руб.`,
          type: 'work',
          link: `#/pm-works?id=${id}`
        });
      }

      // Обновить completed_at
      await db.query('UPDATE works SET completed_at = NOW() WHERE id = $1', [id]);

      // Создать чат при закрытии (fire-and-forget)
      try {
        const { createCloseoutChat } = require('../services/workChat');
        createCloseoutChat(db, parseInt(id), request.user).catch(e =>
          console.error('[WorkChat] createCloseoutChat error:', e.message)
        );
      } catch (e) { console.error('[WorkChat] import error:', e.message); }

      return { work: updateRes.rows[0], message: 'Контракт закрыт' };
    } catch (err) {
      fastify.log.error('Closeout error:', err);
      return reply.code(500).send({ error: 'Ошибка закрытия', detail: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /:id/financial-summary — financial dashboard (НДС, налоги, прибыль)
  // ─────────────────────────────────────────────────────────────────────
  const DIRECTOR_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_PM', 'PM', 'BUH'];
  fastify.get('/:id/financial-summary', { preHandler: [fastify.requireRoles(DIRECTOR_ROLES)] }, async (request, reply) => {
    try {
      const workId = parseInt(request.params.id);

      // Work data (extended)
      const { rows: workRows } = await db.query(
        `SELECT id, work_title, contract_value, vat_pct, cost_fact, cost_plan,
                start_plan, end_plan, start_fact, end_fact,
                started_at, completed_at, start_in_work_date,
                customer_name, customer_inn, pm_id, city, object_name,
                work_status, tender_id, work_number
         FROM works WHERE id = $1 AND deleted_at IS NULL`,
        [workId]
      );
      if (!workRows[0]) return reply.code(404).send({ error: 'Работа не найдена' });
      const work = workRows[0];

      // PM name
      let pmName = null;
      if (work.pm_id) {
        try {
          const pmRes = await db.query('SELECT name FROM users WHERE id = $1', [work.pm_id]);
          pmName = pmRes.rows[0]?.name || null;
        } catch (_) {}
      }

      // Crew: employee assignments with shifts/hours/earned
      let crew = [];
      try {
        const crewRes = await db.query(`
          SELECT e.id, e.full_name, e.position,
                 COUNT(DISTINCT fc.checkin_date) as shifts,
                 COALESCE(SUM(fc.hours_worked), 0) as hours,
                 COALESCE(SUM(fc.earned), 0) as earned
          FROM employee_assignments ea
          JOIN employees e ON e.id = ea.employee_id
          LEFT JOIN field_checkins fc ON fc.employee_id = ea.employee_id AND fc.work_id = $1
          WHERE ea.work_id = $1
          GROUP BY e.id, e.full_name, e.position
          ORDER BY earned DESC
        `, [workId]);
        crew = crewRes.rows;
      } catch (_) {}

      // Tender + Estimate data (for timeline)
      let tenderData = null;
      let estimateData = null;
      if (work.tender_id) {
        try {
          const tRes = await db.query(
            'SELECT id, tender_title, customer_name, created_at, status FROM tenders WHERE id = $1',
            [work.tender_id]
          );
          tenderData = tRes.rows[0] || null;
        } catch (_) {}
        try {
          const eRes = await db.query(
            `SELECT id, title, approval_status, created_at, sent_at
             FROM estimates WHERE tender_id = $1 ORDER BY id DESC LIMIT 1`,
            [work.tender_id]
          );
          estimateData = eRes.rows[0] || null;
        } catch (_) {}
      }

      // Expenses by category
      const { rows: expenses } = await db.query(
        'SELECT id, category, amount, comment, supplier, invoice_needed, invoice_received, doc_number FROM work_expenses WHERE work_id = $1 ORDER BY category, id',
        [workId]
      );

      // Incomes
      const { rows: incomes } = await db.query(
        'SELECT id, type, amount, date, comment, confirmed FROM incomes WHERE work_id = $1 ORDER BY date',
        [workId]
      );

      // Tax rates from settings
      let taxRate = 55;
      let incomeTaxRate = 25;
      let defaultVatPct = 22;
      try {
        const { rows: settingsRows } = await db.query(
          "SELECT key, value_json FROM settings WHERE key IN ('payroll_tax_rate', 'income_tax_rate', 'vat_default_pct')"
        );
        for (const s of settingsRows) {
          const v = parseFloat(JSON.parse(s.value_json));
          if (!v) continue;
          if (s.key === 'payroll_tax_rate') taxRate = v;
          if (s.key === 'income_tax_rate') incomeTaxRate = v;
          if (s.key === 'vat_default_pct') defaultVatPct = v;
        }
      } catch (_) {}

      const vatPct = parseFloat(work.vat_pct) || defaultVatPct;
      const contractValue = parseFloat(work.contract_value) || 0;

      // === Revenue ===
      // НДС начисленный = contract_value * vatPct / (100 + vatPct)
      const vatCharged = Math.round(contractValue * vatPct / (100 + vatPct) * 100) / 100;
      const revenueExVat = Math.round((contractValue - vatCharged) * 100) / 100;

      // === Expense categories with tax logic ===
      // 55% tax (НДФЛ + взносы / обналичка):
      const TAX_CATEGORIES = ['payroll', 'fot', 'cash', 'per_diem', 'subcontract'];
      // VAT deduction (безнал с НДС):
      const VAT_CATEGORIES = ['materials', 'chemicals', 'equipment', 'tickets', 'logistics', 'accommodation', 'transfer', 'other'];

      const catMap = {};
      let totalExpenses = 0;
      let totalVatDeductible = 0;
      let totalTaxBurden = 0;

      for (const exp of expenses) {
        const cat = exp.category || 'other';
        if (!catMap[cat]) {
          catMap[cat] = { category: cat, sum: 0, count: 0, vatDeductible: 0, taxBurden: 0, items: [] };
        }
        const amount = parseFloat(exp.amount) || 0;
        catMap[cat].sum += amount;
        catMap[cat].count++;
        catMap[cat].items.push(exp);
        totalExpenses += amount;

        // VAT deduction for non-cash categories (materials, equipment, etc.)
        if (VAT_CATEGORIES.includes(cat)) {
          // VAT deductible = amount * vatPct / (100 + vatPct)
          const vatDed = Math.round(amount * vatPct / (100 + vatPct) * 100) / 100;
          catMap[cat].vatDeductible += vatDed;
          totalVatDeductible += vatDed;
        }

        // Tax burden for cash-based categories
        if (TAX_CATEGORIES.includes(cat)) {
          const tax = Math.round(amount * taxRate / 100 * 100) / 100;
          catMap[cat].taxBurden += tax;
          totalTaxBurden += tax;
        }
      }

      // Round category totals
      for (const c of Object.values(catMap)) {
        c.sum = Math.round(c.sum * 100) / 100;
        c.vatDeductible = Math.round(c.vatDeductible * 100) / 100;
        c.taxBurden = Math.round(c.taxBurden * 100) / 100;
      }

      // === VAT block ===
      totalVatDeductible = Math.round(totalVatDeductible * 100) / 100;
      const vatPayable = Math.round((vatCharged - totalVatDeductible) * 100) / 100;

      // === Tax block ===
      totalTaxBurden = Math.round(totalTaxBurden * 100) / 100;

      // === Total expenses including taxes ===
      const totalExpensesWithTax = Math.round((totalExpenses + totalTaxBurden) * 100) / 100;

      // === Profit ===
      // Real cost = expenses + tax burden - VAT deductible (input VAT is refunded)
      const profitBeforeTax = Math.round((revenueExVat - totalExpensesWithTax + totalVatDeductible) * 100) / 100;
      const incomeTax = Math.round(profitBeforeTax * incomeTaxRate / 100 * 100) / 100;
      const netProfit = Math.round((profitBeforeTax - incomeTax) * 100) / 100;
      const margin = revenueExVat > 0 ? Math.round(netProfit / revenueExVat * 1000) / 10 : 0;

      // === Payment summary ===
      const today = new Date().toISOString().slice(0, 10);
      const totalIncome = incomes.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
      const confirmedIncome = incomes.filter(i => i.confirmed).reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
      const pendingIncome = Math.round((totalIncome - confirmedIncome) * 100) / 100;
      const receivables = Math.round((contractValue - confirmedIncome) * 100) / 100;
      const paymentPct = contractValue > 0 ? Math.round(confirmedIncome / contractValue * 1000) / 10 : 0;
      const overdueItems = incomes.filter(i => !i.confirmed && i.date && i.date < today);

      // === Timeline ===
      const timeline = {
        start_plan: work.start_plan || null,
        end_plan: work.end_plan || null,
        start_fact: work.start_fact || work.start_in_work_date || null,
        end_fact: work.end_fact || null,
      };

      return {
        work_id: workId,
        work_title: work.work_title,
        contract_value: contractValue,
        vat_pct: vatPct,
        tax_rate: taxRate,

        work_meta: {
          work_number: work.work_number,
          customer_name: work.customer_name,
          customer_inn: work.customer_inn,
          pm_name: pmName,
          pm_id: work.pm_id,
          city: work.city,
          object_name: work.object_name,
          work_status: work.work_status,
          tender_id: work.tender_id,
          completed_at: work.completed_at,
          cost_plan: parseFloat(work.cost_plan) || 0,
          cost_fact: parseFloat(work.cost_fact) || 0,
        },

        crew,
        tender: tenderData,
        estimate: estimateData,

        revenue: {
          with_vat: contractValue,
          ex_vat: revenueExVat,
          vat_charged: vatCharged,
        },

        expenses: {
          categories: Object.values(catMap).sort((a, b) => (b.sum - a.sum)),
          total: Math.round(totalExpenses * 100) / 100,
          total_with_tax: totalExpensesWithTax,
        },

        vat: {
          charged: vatCharged,
          deductible: totalVatDeductible,
          payable: vatPayable,
        },

        taxes: {
          rate: taxRate,
          burden: totalTaxBurden,
        },

        profit: {
          before_tax: profitBeforeTax,
          income_tax_rate: incomeTaxRate,
          income_tax: incomeTax,
          net: netProfit,
          margin: margin,
        },

        timeline: timeline,

        payments: {
          items: incomes,
          total: Math.round(totalIncome * 100) / 100,
          confirmed: Math.round(confirmedIncome * 100) / 100,
          pending: pendingIncome,
          receivables: receivables,
          payment_pct: paymentPct,
          overdue: overdueItems.length,
        },

        // deprecated, use payments
        incomes: {
          items: incomes,
          total: Math.round(totalIncome * 100) / 100,
          confirmed: Math.round(confirmedIncome * 100) / 100,
        },
      };
    } catch (err) {
      fastify.log.error('[works] financial-summary error:', err.message);
      return reply.code(500).send({ error: 'Ошибка расчёта' });
    }
  });

  // B9: Справочник переходов статусов (для фронтенда)
  fastify.get('/statuses/transitions', { preHandler: [fastify.authenticate] }, async () => {
    return { transitions: STATUS_TRANSITIONS };
  });
}

module.exports = routes;
