/**
 * ASGARD Worker Payments API — Выплаты рабочим
 * ═══════════════════════════════════════════════════════════════
 * CRM endpoints (PM/HEAD_PM/DIRECTOR/BUH/ADMIN):
 *   GET    /                              — список выплат (фильтры)
 *   POST   /                              — создать выплату
 *   PUT    /:id                           — обновить (если pending)
 *   DELETE /:id                           — отменить (status=cancelled)
 *   POST   /bulk-per-diem                 — массовые суточные
 *   POST   /generate-salary/:year/:month  — ведомость из field_checkins
 *   POST   /pay-salary/:year/:month       — массово отметить выплату
 *   GET    /project/:work_id/summary      — сводка по объекту
 *
 * Field endpoints (fieldAuthenticate):
 *   GET    /my                            — мои выплаты
 *   GET    /my/balance                    — мой баланс
 *   POST   /my/:id/confirm               — подтвердить получение
 *
 * Reports endpoints (DIRECTOR/ADMIN/BUH):
 *   GET    /reports/payroll/:year/:month          — сводный табель
 *   GET    /reports/payroll/:year/:month/export   — Excel
 *   GET    /reports/per-diem/:year/:month         — суточные
 *   GET    /reports/labor-costs/:year/:month      — ФОТ по объектам
 *   GET    /reports/worker/:employee_id/year/:year — годовая карточка
 *   GET    /reports/debts                         — задолженности
 *
 * Payroll Grid (PM/CRM):
 *   GET    /reports/payroll-grid/:year/:month         — grid-данные (сетка баллов)
 *   PUT    /reports/payroll-grid/:year/:month/save    — сохранить баллы
 *   GET    /reports/payroll-grid/:year/:month/export  — Excel экспорт сетки
 */

const { getWorkerFinances } = require('../lib/worker-finances');

const MANAGE_ROLES = ['PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'BUH', 'ADMIN'];
const DIRECTOR_ROLES = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'BUH', 'ADMIN'];

async function routes(fastify, options) {
  const db = fastify.db;
  const crmAuth = { preHandler: [fastify.requireRoles(MANAGE_ROLES)] };
  const fieldAuth = { preHandler: [fastify.fieldAuthenticate] };
  const dirAuth = { preHandler: [fastify.requireRoles(DIRECTOR_ROLES)] };

  // Загрузка налоговых ставок из settings (НЕ хардкод)
  async function getPayrollTaxRate() {
    try {
      const { rows } = await db.query("SELECT value_json FROM settings WHERE key = 'payroll_tax_rate' LIMIT 1");
      return rows[0] ? parseFloat(JSON.parse(rows[0].value_json)) / 100 : 0.55;
    } catch (_) { return 0.55; }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CRM ENDPOINTS
  // ═══════════════════════════════════════════════════════════════════

  // ─── GET / — список выплат (фильтры) ──────────────────────────────
  fastify.get('/', crmAuth, async (req, reply) => {
    try {
      const { work_id, employee_id, type, status, pay_year, pay_month, limit: lim, offset: off } = req.query;
      const conditions = [];
      const params = [];
      let idx = 1;

      if (work_id) { conditions.push(`wp.work_id = $${idx++}`); params.push(parseInt(work_id)); }
      if (employee_id) { conditions.push(`wp.employee_id = $${idx++}`); params.push(parseInt(employee_id)); }
      if (type) { conditions.push(`wp.type = $${idx++}`); params.push(type); }
      if (status) { conditions.push(`wp.status = $${idx++}`); params.push(status); }
      if (pay_year) { conditions.push(`wp.pay_year = $${idx++}`); params.push(parseInt(pay_year)); }
      if (pay_month) { conditions.push(`wp.pay_month = $${idx++}`); params.push(parseInt(pay_month)); }

      // PM filter: only own projects (unless director/admin)
      const role = req.user.role;
      if (!DIRECTOR_ROLES.includes(role) && role !== 'HEAD_PM') {
        conditions.push(`(wp.work_id IS NULL OR EXISTS (SELECT 1 FROM works w2 WHERE w2.id = wp.work_id AND w2.pm_id = $${idx++}))`);
        params.push(req.user.id);
      }

      const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
      const limit = Math.min(parseInt(lim) || 500, 2000);
      const offset = parseInt(off) || 0;

      const { rows } = await db.query(`
        SELECT wp.*, e.fio as employee_name, e.phone as employee_phone,
               w.work_title, w.work_number,
               cb.fio as created_by_name,
               pb.fio as paid_by_name
        FROM worker_payments wp
        JOIN employees e ON e.id = wp.employee_id
        LEFT JOIN works w ON w.id = wp.work_id
        LEFT JOIN employees cb ON cb.user_id = wp.created_by
        LEFT JOIN employees pb ON pb.user_id = wp.paid_by
        ${where}
        ORDER BY wp.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `, params);

      const { rows: countRows } = await db.query(
        `SELECT COUNT(*) as total FROM worker_payments wp ${where}`, params
      );

      return { payments: rows, total: parseInt(countRows[0].total) };
    } catch (err) {
      fastify.log.error('[worker-payments] GET / error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─── POST / — создать выплату ──────────────────────────────────────
  fastify.post('/', crmAuth, async (req, reply) => {
    try {
      const userId = req.user.id;
      const {
        employee_id, work_id, type, period_from, period_to,
        pay_month, pay_year, amount, days, rate_per_day,
        total_points, point_value, works_detail,
        payment_method, comment
      } = req.body || {};

      if (!employee_id || !type || !amount) {
        return reply.code(400).send({ error: 'Укажите employee_id, type, amount' });
      }
      if (parseFloat(amount) <= 0 && type !== 'penalty') {
        return reply.code(400).send({ error: 'Сумма должна быть больше 0' });
      }

      const validTypes = ['per_diem', 'salary', 'advance', 'bonus', 'penalty'];
      if (!validTypes.includes(type)) {
        return reply.code(400).send({ error: 'Недопустимый тип: ' + type });
      }

      // Verify employee
      const { rows: emp } = await db.query('SELECT id FROM employees WHERE id = $1', [employee_id]);
      if (emp.length === 0) return reply.code(404).send({ error: 'Сотрудник не найден' });

      // Verify work if provided
      if (work_id) {
        const { rows: work } = await db.query('SELECT id FROM works WHERE id = $1', [work_id]);
        if (work.length === 0) return reply.code(404).send({ error: 'Проект не найден' });
      }

      const { rows: inserted } = await db.query(`
        INSERT INTO worker_payments (
          employee_id, work_id, type, period_from, period_to,
          pay_month, pay_year, amount, days, rate_per_day,
          total_points, point_value, works_detail,
          payment_method, comment, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        RETURNING *
      `, [
        employee_id, work_id || null, type,
        period_from || null, period_to || null,
        pay_month ? parseInt(pay_month) : null,
        pay_year ? parseInt(pay_year) : null,
        parseFloat(amount), days ? parseInt(days) : null,
        rate_per_day ? parseFloat(rate_per_day) : null,
        total_points ? parseFloat(total_points) : null,
        point_value ? parseFloat(point_value) : null,
        works_detail ? JSON.stringify(works_detail) : null,
        payment_method || null, comment || null, userId
      ]);

      return { payment: inserted[0] };
    } catch (err) {
      fastify.log.error('[worker-payments] POST / error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─── PUT /:id — обновить выплату (если pending) ────────────────────
  fastify.put('/:id', crmAuth, async (req, reply) => {
    try {
      const paymentId = parseInt(req.params.id);
      const { rows: existing } = await db.query('SELECT * FROM worker_payments WHERE id = $1', [paymentId]);
      if (existing.length === 0) return reply.code(404).send({ error: 'Выплата не найдена' });
      if (existing[0].status !== 'pending') {
        return reply.code(400).send({ error: 'Можно редактировать только pending выплаты' });
      }

      const allowed = ['amount', 'days', 'rate_per_day', 'total_points', 'point_value',
        'payment_method', 'comment', 'period_from', 'period_to', 'pay_month', 'pay_year',
        'works_detail', 'work_id'];
      const sets = [];
      const params = [];
      let idx = 1;

      for (const key of allowed) {
        if (req.body[key] !== undefined) {
          sets.push(`${key} = $${idx++}`);
          const val = req.body[key];
          params.push(key === 'works_detail' && val ? JSON.stringify(val) : val === '' ? null : val);
        }
      }
      if (sets.length === 0) return reply.code(400).send({ error: 'Нет полей для обновления' });

      sets.push(`updated_at = NOW()`);
      params.push(paymentId);

      const { rows } = await db.query(
        `UPDATE worker_payments SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, params
      );

      return { payment: rows[0] };
    } catch (err) {
      fastify.log.error('[worker-payments] PUT /:id error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─── DELETE /:id — отменить выплату ────────────────────────────────
  fastify.delete('/:id', crmAuth, async (req, reply) => {
    try {
      const paymentId = parseInt(req.params.id);
      const { rows: existing } = await db.query('SELECT * FROM worker_payments WHERE id = $1', [paymentId]);
      if (existing.length === 0) return reply.code(404).send({ error: 'Выплата не найдена' });
      if (existing[0].status === 'cancelled') return reply.code(400).send({ error: 'Уже отменена' });

      await db.query(
        `UPDATE worker_payments SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
        [paymentId]
      );

      return { ok: true };
    } catch (err) {
      fastify.log.error('[worker-payments] DELETE /:id error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─── POST /bulk-per-diem — массовые суточные ──────────────────────
  fastify.post('/bulk-per-diem', crmAuth, async (req, reply) => {
    try {
      const userId = req.user.id;
      const { work_id, employee_ids, period_from, period_to, rate_per_day, payment_method, comment } = req.body || {};

      if (!work_id || !employee_ids || !employee_ids.length || !period_from || !period_to) {
        return reply.code(400).send({ error: 'Укажите work_id, employee_ids, period_from, period_to' });
      }

      const rate = parseFloat(rate_per_day) || 1000;
      const from = new Date(period_from);
      const to = new Date(period_to);
      if (isNaN(from.getTime()) || isNaN(to.getTime()) || to < from) {
        return reply.code(400).send({ error: 'Некорректный период' });
      }

      const days = Math.round((to - from) / (1000 * 60 * 60 * 24)) + 1;
      const amount = days * rate;

      const created = [];
      for (const empId of employee_ids) {
        const { rows } = await db.query(`
          INSERT INTO worker_payments (
            employee_id, work_id, type, period_from, period_to,
            days, rate_per_day, amount, payment_method, comment, created_by, status
          ) VALUES ($1,$2,'per_diem',$3,$4,$5,$6,$7,$8,$9,$10,'pending')
          RETURNING *
        `, [empId, work_id, period_from, period_to, days, rate, amount,
            payment_method || null, comment || null, userId]);
        created.push(rows[0]);
      }

      return { payments: created, count: created.length };
    } catch (err) {
      fastify.log.error('[worker-payments] POST /bulk-per-diem error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─── POST /generate-salary/:year/:month — ведомость из checkins ───
  fastify.post('/generate-salary/:year/:month', crmAuth, async (req, reply) => {
    try {
      const userId = req.user.id;
      const year = parseInt(req.params.year);
      const month = parseInt(req.params.month);
      const pointValue = parseFloat(req.body?.point_value) || 500;
      const workIdFilter = req.body?.work_id ? parseInt(req.body.work_id) : null;

      if (!year || !month || month < 1 || month > 12) {
        return reply.code(400).send({ error: 'Некорректный год/месяц' });
      }

      // Check if already generated
      const { rows: existCheck } = await db.query(
        `SELECT COUNT(*) as cnt FROM worker_payments
         WHERE type = 'salary' AND pay_year = $1 AND pay_month = $2 AND status != 'cancelled'
         ${workIdFilter ? 'AND work_id = $3' : ''}`,
        workIdFilter ? [year, month, workIdFilter] : [year, month]
      );
      if (parseInt(existCheck[0].cnt) > 0) {
        return reply.code(409).send({ error: 'Ведомость за этот период уже сгенерирована' });
      }

      // Aggregate checkins by employee
      const { rows: checkins } = await db.query(`
        SELECT fc.employee_id, fc.work_id, w.work_title,
               COUNT(*) as shift_count,
               SUM(COALESCE(fc.hours_paid, fc.hours_worked, 0)) as total_hours,
               SUM(COALESCE(fc.amount_earned, 0)) as total_earned
        FROM field_checkins fc
        JOIN works w ON w.id = fc.work_id
        WHERE EXTRACT(YEAR FROM fc.date) = $1
          AND EXTRACT(MONTH FROM fc.date) = $2
          AND fc.status = 'active'
          ${workIdFilter ? 'AND fc.work_id = $3' : ''}
        GROUP BY fc.employee_id, fc.work_id, w.work_title
        ORDER BY fc.employee_id
      `, workIdFilter ? [year, month, workIdFilter] : [year, month]);

      if (checkins.length === 0) {
        return reply.code(404).send({ error: 'Нет данных табеля за указанный период' });
      }

      // Group by employee (may have multiple works)
      const byEmployee = {};
      for (const c of checkins) {
        if (!byEmployee[c.employee_id]) {
          byEmployee[c.employee_id] = { totalPoints: 0, worksDetail: [] };
        }
        const points = parseFloat(c.shift_count); // 1 смена = 1 балл
        byEmployee[c.employee_id].totalPoints += points;
        byEmployee[c.employee_id].worksDetail.push({
          work_id: c.work_id,
          work_title: c.work_title,
          days: parseInt(c.shift_count),
          points,
          amount: points * pointValue
        });
      }

      const created = [];
      for (const [empId, data] of Object.entries(byEmployee)) {
        const amount = data.totalPoints * pointValue;
        const primaryWorkId = data.worksDetail.length === 1
          ? data.worksDetail[0].work_id
          : data.worksDetail.sort((a, b) => b.days - a.days)[0].work_id;

        const { rows } = await db.query(`
          INSERT INTO worker_payments (
            employee_id, work_id, type, pay_month, pay_year,
            amount, total_points, point_value, works_detail, created_by
          ) VALUES ($1,$2,'salary',$3,$4,$5,$6,$7,$8,$9)
          RETURNING *
        `, [empId, primaryWorkId, month, year, amount,
            data.totalPoints, pointValue, JSON.stringify(data.worksDetail), userId]);
        created.push(rows[0]);
      }

      return { payments: created, count: created.length, point_value: pointValue };
    } catch (err) {
      fastify.log.error('[worker-payments] POST /generate-salary error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─── POST /pay-salary/:year/:month — массово отметить выплату ─────
  fastify.post('/pay-salary/:year/:month', crmAuth, async (req, reply) => {
    try {
      const userId = req.user.id;
      const year = parseInt(req.params.year);
      const month = parseInt(req.params.month);
      const paymentMethod = req.body?.payment_method || 'transfer';
      const workId = req.body?.work_id ? parseInt(req.body.work_id) : null;

      let query = `
        UPDATE worker_payments
        SET status = 'paid', paid_at = NOW(), paid_by = $1, payment_method = $2, updated_at = NOW()
        WHERE type = 'salary' AND pay_year = $3 AND pay_month = $4 AND status = 'pending'
      `;
      const params = [userId, paymentMethod, year, month];

      if (workId) {
        query += ' AND work_id = $5';
        params.push(workId);
      }

      const result = await db.query(query, params);

      return { ok: true, updated: result.rowCount };
    } catch (err) {
      fastify.log.error('[worker-payments] POST /pay-salary error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─── GET /project/:work_id/summary — сводка по объекту (SSoT) ─────
  fastify.get('/project/:work_id/summary', crmAuth, async (req, reply) => {
    try {
      const workId = parseInt(req.params.work_id, 10);

      // Все рабочие с assignment или чекином на эту работу
      const { rows: empRows } = await db.query(`
        SELECT DISTINCT e.id, e.fio, e.position
        FROM employees e
        LEFT JOIN employee_assignments ea ON ea.employee_id = e.id AND ea.work_id = $1
        LEFT JOIN field_checkins fc ON fc.employee_id = e.id AND fc.work_id = $1
        WHERE ea.work_id = $1 OR fc.work_id = $1
        ORDER BY e.fio
      `, [workId]);

      // Параллельно считаем финансы каждого через SSoT
      const workers = await Promise.all(empRows.map(async (e) => {
        const fin = await getWorkerFinances(db, e.id, { workId, logger: fastify.log });
        if (fin.error === 'per_diem_not_set') {
          return { employee_id: e.id, employee_name: e.fio, position: e.position,
                   error: 'per_diem_not_set', message: fin.message };
        }
        const w = (fin.by_work || [])[0] || {};
        const pdBalance = (w.per_diem_accrued || 0) - (w.per_diem_paid || 0);
        return {
          employee_id: e.id,
          employee_name: e.fio,
          position: e.position,
          is_active: w.is_active || false,
          days_worked: w.days_worked || 0,
          fot_accrued: w.fot || 0,
          per_diem_rate: w.per_diem_rate || 0,
          per_diem_accrued: w.per_diem_accrued || 0,
          per_diem_paid: w.per_diem_paid || 0,
          per_diem_balance: pdBalance,
          salary_paid: w.salary_paid || 0,
          advance_paid: w.advance_paid || 0,
          bonus_paid: w.bonus_paid || 0,
          penalty: w.penalty || 0,
          net_to_pay: (w.fot || 0) + pdBalance + (w.bonus_paid || 0)
                    - (w.penalty || 0) - (w.advance_paid || 0) - (w.salary_paid || 0),
        };
      }));

      // Агрегаты для шапки
      const totals = workers.reduce((acc, w) => {
        if (w.error) return acc;
        acc.fot_accrued += w.fot_accrued;
        acc.per_diem_accrued += w.per_diem_accrued;
        acc.per_diem_paid += w.per_diem_paid;
        acc.per_diem_balance += w.per_diem_balance;
        acc.salary_paid += w.salary_paid;
        acc.advance_paid += w.advance_paid;
        acc.bonus_paid += w.bonus_paid;
        acc.penalty += w.penalty;
        acc.net_to_pay += w.net_to_pay;
        return acc;
      }, { fot_accrued: 0, per_diem_accrued: 0, per_diem_paid: 0, per_diem_balance: 0,
           salary_paid: 0, advance_paid: 0, bonus_paid: 0, penalty: 0, net_to_pay: 0 });

      return { workers, totals };
    } catch (err) {
      fastify.log.error('[worker-payments] GET /project/:id/summary error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // FIELD ENDPOINTS (worker via Field PWA)
  // ═══════════════════════════════════════════════════════════════════

  // ─── GET /my — мои выплаты ─────────────────────────────────────────
  fastify.get('/my', fieldAuth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const { type, limit: lim } = req.query;
      const limit = Math.min(parseInt(lim) || 50, 200);

      let query = `
        SELECT wp.*, w.work_title
        FROM worker_payments wp
        LEFT JOIN works w ON w.id = wp.work_id
        WHERE wp.employee_id = $1 AND wp.status != 'cancelled'
      `;
      const params = [empId];

      if (type) {
        query += ' AND wp.type = $2';
        params.push(type);
      }

      query += ` ORDER BY wp.created_at DESC LIMIT ${limit}`;

      const { rows } = await db.query(query, params);
      return { payments: rows };
    } catch (err) {
      fastify.log.error('[worker-payments] GET /my error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─── GET /my/balance — мой баланс (SSoT: lib/worker-finances.js) ───
  fastify.get('/my/balance', fieldAuth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const year = req.query.year ? parseInt(req.query.year) : undefined;
      const result = await getWorkerFinances(db, empId, { year, logger: fastify.log });
      if (result.error === 'per_diem_not_set') return reply.code(422).send(result);
      if (result.error === 'invalid_year') return reply.code(400).send(result);
      if (result.error) return reply.code(500).send(result);
      return result;
    } catch (err) {
      fastify.log.error('[worker-payments] GET /my/balance error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─── POST /my/:id/confirm — подтвердить получение ──────────────────
  fastify.post('/my/:id/confirm', fieldAuth, async (req, reply) => {
    try {
      const paymentId = parseInt(req.params.id);
      const empId = req.fieldEmployee.id;

      const { rows } = await db.query(
        'SELECT * FROM worker_payments WHERE id = $1 AND employee_id = $2',
        [paymentId, empId]
      );
      if (rows.length === 0) return reply.code(404).send({ error: 'Выплата не найдена' });
      if (rows[0].status !== 'paid') {
        return reply.code(400).send({ error: 'Можно подтвердить только выплаченные (paid)' });
      }

      await db.query(`
        UPDATE worker_payments
        SET confirmed_by_worker = true, confirmed_at = NOW(), status = 'confirmed', updated_at = NOW()
        WHERE id = $1
      `, [paymentId]);

      return { ok: true, status: 'confirmed' };
    } catch (err) {
      fastify.log.error('[worker-payments] POST /my/:id/confirm error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // REPORTS ENDPOINTS (Director/BUH/Admin)
  // ═══════════════════════════════════════════════════════════════════

  // ─── GET /reports/payroll/:year/:month — сводный табель ────────────
  fastify.get('/reports/payroll/:year/:month', dirAuth, async (req, reply) => {
    try {
      const year = parseInt(req.params.year);
      const month = parseInt(req.params.month);

      const { rows } = await db.query(`
        SELECT
          wp.employee_id, e.fio as employee_name,
          wp.work_id, w.work_title,
          SUM(CASE WHEN wp.type = 'salary' THEN wp.amount ELSE 0 END) as salary,
          SUM(CASE WHEN wp.type = 'per_diem' THEN wp.amount ELSE 0 END) as per_diem,
          SUM(CASE WHEN wp.type = 'advance' THEN wp.amount ELSE 0 END) as advance,
          SUM(CASE WHEN wp.type = 'bonus' THEN wp.amount ELSE 0 END) as bonus,
          SUM(CASE WHEN wp.type = 'penalty' THEN wp.amount ELSE 0 END) as penalty,
          SUM(CASE WHEN wp.type = 'salary' THEN COALESCE(wp.total_points, 0) ELSE 0 END) as points,
          SUM(CASE WHEN wp.type = 'salary' THEN COALESCE(wp.days, 0) ELSE 0 END) as shifts,
          MAX(wp.status) as payment_status
        FROM worker_payments wp
        JOIN employees e ON e.id = wp.employee_id
        LEFT JOIN works w ON w.id = wp.work_id
        WHERE wp.pay_year = $1 AND wp.pay_month = $2 AND wp.status != 'cancelled'
        GROUP BY wp.employee_id, e.fio, wp.work_id, w.work_title
        ORDER BY e.fio, w.work_title
      `, [year, month]);

      // Totals
      let totalSalary = 0, totalPerDiem = 0, totalAdvance = 0, totalBonus = 0, totalPenalty = 0;
      for (const r of rows) {
        totalSalary += parseFloat(r.salary);
        totalPerDiem += parseFloat(r.per_diem);
        totalAdvance += parseFloat(r.advance);
        totalBonus += parseFloat(r.bonus);
        totalPenalty += parseFloat(r.penalty);
      }

      return {
        year, month,
        rows,
        totals: {
          salary: totalSalary,
          per_diem: totalPerDiem,
          advance: totalAdvance,
          bonus: totalBonus,
          penalty: totalPenalty,
          fot: totalSalary + totalBonus - totalPenalty,
          tax: Math.round((totalSalary + totalBonus - totalPenalty) * (await getPayrollTaxRate())),
          grand_total: totalSalary + totalPerDiem + totalBonus - totalPenalty
        }
      };
    } catch (err) {
      fastify.log.error('[worker-payments] GET /reports/payroll error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─── GET /reports/per-diem/:year/:month — суточные ─────────────────
  fastify.get('/reports/per-diem/:year/:month', dirAuth, async (req, reply) => {
    try {
      const year = parseInt(req.params.year);
      const month = parseInt(req.params.month);

      const { rows } = await db.query(`
        SELECT wp.*, e.fio as employee_name, w.work_title
        FROM worker_payments wp
        JOIN employees e ON e.id = wp.employee_id
        LEFT JOIN works w ON w.id = wp.work_id
        WHERE wp.type = 'per_diem' AND wp.pay_year = $1 AND wp.pay_month = $2
          AND wp.status != 'cancelled'
        ORDER BY e.fio
      `, [year, month]);

      return { rows };
    } catch (err) {
      fastify.log.error('[worker-payments] GET /reports/per-diem error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─── GET /reports/labor-costs/:year/:month — ФОТ по объектам ───────
  fastify.get('/reports/labor-costs/:year/:month', dirAuth, async (req, reply) => {
    try {
      const year = parseInt(req.params.year);
      const month = parseInt(req.params.month);

      const { rows } = await db.query(`
        SELECT
          wp.work_id, w.work_title, w.work_number,
          SUM(CASE WHEN wp.type = 'salary' THEN wp.amount ELSE 0 END) as salary,
          SUM(CASE WHEN wp.type = 'per_diem' THEN wp.amount ELSE 0 END) as per_diem,
          SUM(CASE WHEN wp.type = 'bonus' THEN wp.amount ELSE 0 END) as bonus,
          SUM(CASE WHEN wp.type = 'penalty' THEN wp.amount ELSE 0 END) as penalty,
          COUNT(DISTINCT wp.employee_id) as worker_count
        FROM worker_payments wp
        LEFT JOIN works w ON w.id = wp.work_id
        WHERE wp.pay_year = $1 AND wp.pay_month = $2 AND wp.status != 'cancelled'
        GROUP BY wp.work_id, w.work_title, w.work_number
        ORDER BY w.work_title
      `, [year, month]);

      // Add tax and totals
      const taxRateLC = await getPayrollTaxRate();
      for (const r of rows) {
        const fot = parseFloat(r.salary) + parseFloat(r.bonus) - parseFloat(r.penalty);
        r.fot = fot;
        r.tax = Math.round(fot * taxRateLC);
        r.full_cost = fot + r.tax + parseFloat(r.per_diem);
      }

      return { rows };
    } catch (err) {
      fastify.log.error('[worker-payments] GET /reports/labor-costs error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─── GET /reports/worker/:employee_id/year/:year — годовая карточка
  fastify.get('/reports/worker/:employee_id/year/:year', dirAuth, async (req, reply) => {
    try {
      const empId = parseInt(req.params.employee_id);
      const year = parseInt(req.params.year);

      const { rows: emp } = await db.query('SELECT id, fio, phone FROM employees WHERE id = $1', [empId]);
      if (emp.length === 0) return reply.code(404).send({ error: 'Сотрудник не найден' });

      const { rows } = await db.query(`
        SELECT
          pay_month,
          SUM(CASE WHEN type = 'salary' THEN amount ELSE 0 END) as salary,
          SUM(CASE WHEN type = 'per_diem' THEN amount ELSE 0 END) as per_diem,
          SUM(CASE WHEN type = 'advance' THEN amount ELSE 0 END) as advance,
          SUM(CASE WHEN type = 'bonus' THEN amount ELSE 0 END) as bonus,
          SUM(CASE WHEN type = 'penalty' THEN amount ELSE 0 END) as penalty
        FROM worker_payments
        WHERE employee_id = $1 AND pay_year = $2 AND status != 'cancelled'
        GROUP BY pay_month
        ORDER BY pay_month
      `, [empId, year]);

      return { employee: emp[0], year, months: rows };
    } catch (err) {
      fastify.log.error('[worker-payments] GET /reports/worker/:id/year/:y error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─── GET /reports/debts — задолженности ────────────────────────────
  fastify.get('/reports/debts', dirAuth, async (req, reply) => {
    try {
      const { rows } = await db.query(`
        SELECT
          wp.employee_id, e.fio as employee_name,
          SUM(CASE WHEN wp.type IN ('salary','per_diem','bonus') THEN wp.amount ELSE 0 END) as earned,
          SUM(CASE WHEN wp.type IN ('advance','penalty') THEN wp.amount ELSE 0 END) as deductions,
          SUM(CASE WHEN wp.status IN ('paid','confirmed') THEN
            CASE WHEN wp.type IN ('salary','per_diem','bonus') THEN wp.amount
                 WHEN wp.type IN ('advance','penalty') THEN -wp.amount ELSE 0 END
          ELSE 0 END) as paid,
          SUM(CASE WHEN wp.status = 'pending' THEN
            CASE WHEN wp.type IN ('salary','per_diem','bonus') THEN wp.amount
                 WHEN wp.type IN ('advance','penalty') THEN -wp.amount ELSE 0 END
          ELSE 0 END) as debt
        FROM worker_payments wp
        JOIN employees e ON e.id = wp.employee_id
        WHERE wp.status != 'cancelled'
        GROUP BY wp.employee_id, e.fio
        HAVING SUM(CASE WHEN wp.status = 'pending' THEN 1 ELSE 0 END) > 0
        ORDER BY SUM(CASE WHEN wp.status = 'pending' THEN
          CASE WHEN wp.type IN ('salary','per_diem','bonus') THEN wp.amount ELSE -wp.amount END
        ELSE 0 END) DESC
      `);

      return { rows };
    } catch (err) {
      fastify.log.error('[worker-payments] GET /reports/debts error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─── GET /reports/payroll/:year/:month/export — Excel ──────────────
  fastify.get('/reports/payroll/:year/:month/export', dirAuth, async (req, reply) => {
    try {
      const ExcelJS = require('exceljs');
      const year = parseInt(req.params.year);
      const month = parseInt(req.params.month);
      const monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
      const mName = monthNames[month - 1] || '';
      const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD5E8F0' } };
      const totalFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
      const boldFont = { bold: true, size: 11 };
      const numFmt = '#,##0.00';

      // ── Fetch all data ──
      const { rows: payroll } = await db.query(`
        SELECT wp.employee_id, e.fio, wp.work_id, w.work_title, w.work_number,
          SUM(CASE WHEN wp.type='salary' THEN wp.amount ELSE 0 END) as salary,
          SUM(CASE WHEN wp.type='per_diem' THEN wp.amount ELSE 0 END) as per_diem,
          SUM(CASE WHEN wp.type='advance' THEN wp.amount ELSE 0 END) as advance,
          SUM(CASE WHEN wp.type='bonus' THEN wp.amount ELSE 0 END) as bonus,
          SUM(CASE WHEN wp.type='penalty' THEN wp.amount ELSE 0 END) as penalty,
          SUM(CASE WHEN wp.type='salary' THEN COALESCE(wp.total_points,0) ELSE 0 END) as points,
          MAX(wp.status) as status
        FROM worker_payments wp
        JOIN employees e ON e.id=wp.employee_id
        LEFT JOIN works w ON w.id=wp.work_id
        WHERE wp.pay_year=$1 AND wp.pay_month=$2 AND wp.status!='cancelled'
        GROUP BY wp.employee_id, e.fio, wp.work_id, w.work_title, w.work_number
        ORDER BY e.fio, w.work_title
      `, [year, month]);

      const { rows: perDiem } = await db.query(`
        SELECT wp.*, e.fio, w.work_title
        FROM worker_payments wp JOIN employees e ON e.id=wp.employee_id LEFT JOIN works w ON w.id=wp.work_id
        WHERE wp.type='per_diem' AND wp.pay_year=$1 AND wp.pay_month=$2 AND wp.status!='cancelled'
        ORDER BY e.fio
      `, [year, month]);

      const { rows: advances } = await db.query(`
        SELECT wp.*, e.fio, w.work_title
        FROM worker_payments wp JOIN employees e ON e.id=wp.employee_id LEFT JOIN works w ON w.id=wp.work_id
        WHERE wp.type='advance' AND wp.pay_year=$1 AND wp.pay_month=$2 AND wp.status!='cancelled'
        ORDER BY e.fio
      `, [year, month]);

      const { rows: laborCosts } = await db.query(`
        SELECT wp.work_id, w.work_title, w.work_number,
          SUM(CASE WHEN wp.type='salary' THEN wp.amount ELSE 0 END) as salary,
          SUM(CASE WHEN wp.type='per_diem' THEN wp.amount ELSE 0 END) as per_diem,
          SUM(CASE WHEN wp.type='bonus' THEN wp.amount ELSE 0 END) as bonus,
          SUM(CASE WHEN wp.type='penalty' THEN wp.amount ELSE 0 END) as penalty,
          COUNT(DISTINCT wp.employee_id) as workers
        FROM worker_payments wp LEFT JOIN works w ON w.id=wp.work_id
        WHERE wp.pay_year=$1 AND wp.pay_month=$2 AND wp.status!='cancelled'
        GROUP BY wp.work_id, w.work_title, w.work_number ORDER BY w.work_title
      `, [year, month]);

      const taxRateExcel = await getPayrollTaxRate();
      const taxPctLabel = Math.round(taxRateExcel * 100);

      const wb = new ExcelJS.Workbook();
      wb.creator = '\u0410\u0421\u0413\u0410\u0420\u0414 CRM';
      wb.created = new Date();

      // ── Sheet 1: Сводный табель ──
      const ws1 = wb.addWorksheet('\u0421\u0432\u043E\u0434\u043D\u044B\u0439 \u0442\u0430\u0431\u0435\u043B\u044C');
      ws1.mergeCells('A1:I1');
      ws1.getCell('A1').value = `\u0421\u0412\u041E\u0414\u041D\u042B\u0419 \u0422\u0410\u0411\u0415\u041B\u042C \u0412\u042B\u041F\u041B\u0410\u0422 \u2014 ${mName} ${year}`;
      ws1.getCell('A1').font = { bold: true, size: 14 };
      ws1.addRow([]);
      const h1 = ws1.addRow(['\u2116', '\u0424\u0418\u041E', '\u041E\u0431\u044A\u0435\u043A\u0442', '\u0411\u0430\u043B\u043B\u044B', '\u0417\u041F', '\u0421\u0443\u0442\u043E\u0447\u043D\u044B\u0435', '\u0410\u0432\u0430\u043D\u0441\u044B', '\u041F\u0440\u0435\u043C./\u0423\u0434\u0435\u0440\u0436.', '\u0418\u0442\u043E\u0433\u043E']);
      h1.font = boldFont;
      h1.eachCell(c => { c.fill = headerFill; c.border = { bottom: { style: 'thin' } }; });
      ws1.getColumn(1).width = 5; ws1.getColumn(2).width = 28; ws1.getColumn(3).width = 25;
      ws1.getColumn(4).width = 10; ws1.getColumn(5).width = 14; ws1.getColumn(6).width = 14;
      ws1.getColumn(7).width = 14; ws1.getColumn(8).width = 14; ws1.getColumn(9).width = 16;

      let t1s=0,t1pd=0,t1a=0,t1bp=0,t1tot=0;
      payroll.forEach((r, i) => {
        const net = parseFloat(r.salary)+parseFloat(r.bonus)-parseFloat(r.penalty)+parseFloat(r.per_diem)-parseFloat(r.advance);
        const row = ws1.addRow([i+1, r.fio, r.work_title||'', parseFloat(r.points), parseFloat(r.salary), parseFloat(r.per_diem), parseFloat(r.advance), parseFloat(r.bonus)-parseFloat(r.penalty), net]);
        [5,6,7,8,9].forEach(c => { row.getCell(c).numFmt = numFmt; });
        t1s+=parseFloat(r.salary); t1pd+=parseFloat(r.per_diem); t1a+=parseFloat(r.advance);
        t1bp+=parseFloat(r.bonus)-parseFloat(r.penalty); t1tot+=net;
      });
      const tot1 = ws1.addRow(['', '\u0418\u0422\u041E\u0413\u041E', '', '', t1s, t1pd, t1a, t1bp, t1tot]);
      tot1.font = boldFont;
      tot1.eachCell(c => { c.fill = totalFill; });
      [5,6,7,8,9].forEach(c => { tot1.getCell(c).numFmt = numFmt; });

      // ── Sheet 2: ФОТ ──
      const ws2 = wb.addWorksheet('\u0424\u041E\u0422');
      ws2.mergeCells('A1:F1');
      ws2.getCell('A1').value = `\u0424\u041E\u041D\u0414 \u041E\u041F\u041B\u0410\u0422\u042B \u0422\u0420\u0423\u0414\u0410 \u2014 ${mName} ${year}`;
      ws2.getCell('A1').font = { bold: true, size: 14 };
      ws2.addRow([]);
      const h2 = ws2.addRow(['\u0424\u0418\u041E', '\u0417\u041F', '\u041F\u0440\u0435\u043C\u0438\u0438', '\u0423\u0434\u0435\u0440\u0436\u0430\u043D\u0438\u044F', '\u0424\u041E\u0422', `\u041D\u0430\u043B\u043E\u0433\u0438 ${taxPctLabel}%`]);
      h2.font = boldFont; h2.eachCell(c => { c.fill = headerFill; });
      ws2.getColumn(1).width = 28; ws2.getColumn(2).width = 14; ws2.getColumn(3).width = 14;
      ws2.getColumn(4).width = 14; ws2.getColumn(5).width = 14; ws2.getColumn(6).width = 14;

      // Group by employee
      const byEmp = {};
      for (const r of payroll) {
        if (!byEmp[r.employee_id]) byEmp[r.employee_id] = { fio: r.fio, salary: 0, bonus: 0, penalty: 0 };
        byEmp[r.employee_id].salary += parseFloat(r.salary);
        byEmp[r.employee_id].bonus += parseFloat(r.bonus);
        byEmp[r.employee_id].penalty += parseFloat(r.penalty);
      }
      let t2s=0, t2b=0, t2p=0;
      for (const e of Object.values(byEmp)) {
        const fot = e.salary + e.bonus - e.penalty;
        const tax = Math.round(fot * taxRateExcel);
        const row = ws2.addRow([e.fio, e.salary, e.bonus, e.penalty, fot, tax]);
        [2,3,4,5,6].forEach(c => { row.getCell(c).numFmt = numFmt; });
        t2s += e.salary; t2b += e.bonus; t2p += e.penalty;
      }
      const fotTotal = t2s + t2b - t2p;
      const tot2 = ws2.addRow(['\u0418\u0422\u041E\u0413\u041E', t2s, t2b, t2p, fotTotal, Math.round(fotTotal * taxRateExcel)]);
      tot2.font = boldFont; tot2.eachCell(c => { c.fill = totalFill; });
      [2,3,4,5,6].forEach(c => { tot2.getCell(c).numFmt = numFmt; });

      // ── Sheet 3: Суточные ──
      const ws3 = wb.addWorksheet('\u0421\u0443\u0442\u043E\u0447\u043D\u044B\u0435');
      ws3.mergeCells('A1:F1');
      ws3.getCell('A1').value = `\u0421\u0423\u0422\u041E\u0427\u041D\u042B\u0415 \u2014 ${mName} ${year}`;
      ws3.getCell('A1').font = { bold: true, size: 14 };
      ws3.addRow([]);
      const h3 = ws3.addRow(['\u0424\u0418\u041E', '\u041E\u0431\u044A\u0435\u043A\u0442', '\u0414\u043D\u0435\u0439', '\u0421\u0442\u0430\u0432\u043A\u0430', '\u041D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u043E', '\u0421\u0442\u0430\u0442\u0443\u0441']);
      h3.font = boldFont; h3.eachCell(c => { c.fill = headerFill; });
      ws3.getColumn(1).width = 28; ws3.getColumn(2).width = 25; ws3.getColumn(3).width = 10;
      ws3.getColumn(4).width = 12; ws3.getColumn(5).width = 14; ws3.getColumn(6).width = 14;

      let t3 = 0;
      for (const p of perDiem) {
        const row = ws3.addRow([p.fio, p.work_title||'', p.days||'', parseFloat(p.rate_per_day)||'', parseFloat(p.amount), p.status]);
        row.getCell(5).numFmt = numFmt;
        t3 += parseFloat(p.amount);
      }
      const tot3 = ws3.addRow(['', '', '', '\u0418\u0422\u041E\u0413\u041E', t3, '']);
      tot3.font = boldFont; tot3.eachCell(c => { c.fill = totalFill; }); tot3.getCell(5).numFmt = numFmt;

      // ── Sheet 4: Авансы ──
      const ws4 = wb.addWorksheet('\u0410\u0432\u0430\u043D\u0441\u044B');
      ws4.mergeCells('A1:E1');
      ws4.getCell('A1').value = `\u0410\u0412\u0410\u041D\u0421\u042B \u2014 ${mName} ${year}`;
      ws4.getCell('A1').font = { bold: true, size: 14 };
      ws4.addRow([]);
      const h4 = ws4.addRow(['\u0424\u0418\u041E', '\u041E\u0431\u044A\u0435\u043A\u0442', '\u0421\u0443\u043C\u043C\u0430', '\u0414\u0430\u0442\u0430', '\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439']);
      h4.font = boldFont; h4.eachCell(c => { c.fill = headerFill; });
      ws4.getColumn(1).width = 28; ws4.getColumn(2).width = 25; ws4.getColumn(3).width = 14;
      ws4.getColumn(4).width = 14; ws4.getColumn(5).width = 30;

      let t4 = 0;
      for (const a of advances) {
        const row = ws4.addRow([a.fio, a.work_title||'', parseFloat(a.amount),
          a.created_at ? new Date(a.created_at).toLocaleDateString('ru-RU') : '', a.comment||'']);
        row.getCell(3).numFmt = numFmt;
        t4 += parseFloat(a.amount);
      }
      const tot4 = ws4.addRow(['', '\u0418\u0422\u041E\u0413\u041E', t4, '', '']);
      tot4.font = boldFont; tot4.eachCell(c => { c.fill = totalFill; }); tot4.getCell(3).numFmt = numFmt;

      // ── Sheet 5: Сводка по объектам ──
      const ws5 = wb.addWorksheet('\u041F\u043E \u043E\u0431\u044A\u0435\u043A\u0442\u0430\u043C');
      ws5.mergeCells('A1:G1');
      ws5.getCell('A1').value = `\u0421\u0412\u041E\u0414\u041A\u0410 \u041F\u041E \u041E\u0411\u042A\u0415\u041A\u0422\u0410\u041C \u2014 ${mName} ${year}`;
      ws5.getCell('A1').font = { bold: true, size: 14 };
      ws5.addRow([]);
      const h5 = ws5.addRow(['\u041E\u0431\u044A\u0435\u043A\u0442', '\u0420\u0430\u0431\u043E\u0447\u0438\u0445', '\u0424\u041E\u0422', '\u041D\u0430\u043B\u043E\u0433\u0438', '\u0421\u0443\u0442\u043E\u0447\u043D\u044B\u0435', '\u041F\u043E\u043B\u043D\u0430\u044F \u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C']);
      h5.font = boldFont; h5.eachCell(c => { c.fill = headerFill; });
      ws5.getColumn(1).width = 30; ws5.getColumn(2).width = 12; ws5.getColumn(3).width = 14;
      ws5.getColumn(4).width = 14; ws5.getColumn(5).width = 14; ws5.getColumn(6).width = 18;

      let t5f=0, t5t=0, t5pd=0, t5fc=0, t5w=0;
      for (const r of laborCosts) {
        const fot = parseFloat(r.salary)+parseFloat(r.bonus)-parseFloat(r.penalty);
        const tax = Math.round(fot * taxRateExcel);
        const pd = parseFloat(r.per_diem);
        const full = fot + tax + pd;
        const row = ws5.addRow([r.work_title||'\u0411\u0435\u0437 \u043E\u0431\u044A\u0435\u043A\u0442\u0430', parseInt(r.workers), fot, tax, pd, full]);
        [3,4,5,6].forEach(c => { row.getCell(c).numFmt = numFmt; });
        t5f+=fot; t5t+=tax; t5pd+=pd; t5fc+=full; t5w+=parseInt(r.workers);
      }
      const tot5 = ws5.addRow(['\u0418\u0422\u041E\u0413\u041E', t5w, t5f, t5t, t5pd, t5fc]);
      tot5.font = boldFont; tot5.eachCell(c => { c.fill = totalFill; });
      [3,4,5,6].forEach(c => { tot5.getCell(c).numFmt = numFmt; });

      // ── Send ──
      const buffer = await wb.xlsx.writeBuffer();
      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      reply.header('Content-Disposition', `attachment; filename="worker_payments_${year}_${month}.xlsx"`);
      return reply.send(Buffer.from(buffer));
    } catch (err) {
      fastify.log.error('[worker-payments] Excel export error:', err);
      return reply.code(500).send({ error: '\u041E\u0448\u0438\u0431\u043A\u0430 \u044D\u043A\u0441\u043F\u043E\u0440\u0442\u0430' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // PAYROLL GRID — Ведомость-сетка (PM / Director / Admin)
  // ═══════════════════════════════════════════════════════════════════

  // ─── GET /reports/payroll-grid/:year/:month — grid-данные ──────────
  fastify.get('/reports/payroll-grid/:year/:month', crmAuth, async (req, reply) => {
    try {
      const year = parseInt(req.params.year);
      const month = parseInt(req.params.month);
      if (!year || !month || month < 1 || month > 12) {
        return reply.code(400).send({ error: 'Некорректный год/месяц' });
      }

      const isDir = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_PM'].includes(req.user.role);

      // Point value from settings
      const pvRes = await db.query("SELECT key, value_json FROM settings WHERE key = 'point_value'");
      const pointValue = pvRes.rows[0] ? parseFloat(JSON.parse(pvRes.rows[0].value_json)) : 500;

      // Period bounds
      const periodFrom = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const periodTo = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      // Fetch checkins
      const worksFilter = isDir
        ? ''
        : 'AND fc.work_id IN (SELECT id FROM works WHERE pm_id = $4)';
      const checkinParams = isDir ? [year, month, ['completed', 'closed', 'confirmed']] : [year, month, ['completed', 'closed', 'confirmed'], req.user.id];

      const { rows: checkins } = await db.query(`
        SELECT fc.employee_id, e.fio, e.full_name, e.position,
               fc.date, fc.amount_earned, fc.day_rate, fc.work_id, w.work_title,
               COALESCE(ftg.point_value, ${pointValue}) as row_point_value
        FROM field_checkins fc
        JOIN employees e ON e.id = fc.employee_id
        JOIN works w ON w.id = fc.work_id
        LEFT JOIN employee_assignments ea ON ea.employee_id = fc.employee_id AND ea.work_id = fc.work_id
        LEFT JOIN field_tariff_grid ftg ON ftg.id = ea.tariff_id
        WHERE EXTRACT(YEAR FROM fc.date) = $1
          AND EXTRACT(MONTH FROM fc.date) = $2
          AND fc.status = ANY($3)
          ${worksFilter}
        ORDER BY e.fio, fc.date
      `, checkinParams);

      // Fetch per-diem
      const pdWorksFilter = isDir
        ? ''
        : 'AND wp.work_id IN (SELECT id FROM works WHERE pm_id = $4)';
      const pdParams = isDir ? [periodFrom, periodTo, ['per_diem']] : [periodFrom, periodTo, ['per_diem'], req.user.id];

      const { rows: perDiemRows } = await db.query(`
        SELECT wp.employee_id, SUM(wp.amount) as per_diem_total, SUM(wp.days) as per_diem_days
        FROM worker_payments wp
        WHERE wp.type = ANY($3) AND wp.status != 'cancelled'
          AND ((wp.period_from >= $1::date AND wp.period_from <= $2::date) OR (wp.period_to >= $1::date AND wp.period_to <= $2::date))
          ${pdWorksFilter}
        GROUP BY wp.employee_id
      `, pdParams);

      const perDiemMap = {};
      for (const pd of perDiemRows) {
        perDiemMap[pd.employee_id] = {
          per_diem_total: parseFloat(pd.per_diem_total) || 0,
          per_diem_days: parseInt(pd.per_diem_days) || 0
        };
      }

      // Group by employee
      const empMap = {};
      const worksSet = {};
      for (const c of checkins) {
        if (!empMap[c.employee_id]) {
          empMap[c.employee_id] = {
            employee_id: c.employee_id,
            fio: c.fio,
            full_name: c.full_name,
            position: c.position,
            days: [],
            total_points: 0,
            total_amount: 0,
            days_count: 0
          };
        }
        const emp = empMap[c.employee_id];
        const pv = parseFloat(c.row_point_value) || pointValue;
        const amount = parseFloat(c.amount_earned) || 0;
        const points = pv > 0 ? Math.round((amount / pv) * 100) / 100 : 0;

        emp.days.push({
          date: c.date,
          points,
          amount,
          work_id: c.work_id,
          work_title: c.work_title
        });
        emp.total_points += points;
        emp.total_amount += amount;
        emp.days_count += 1;

        if (!worksSet[c.work_id]) {
          worksSet[c.work_id] = { id: c.work_id, title: c.work_title };
        }
      }

      // Attach per-diem, convert days array → object {dayNum: points}, round
      const employees = Object.values(empMap).map(emp => {
        const pd = perDiemMap[emp.employee_id] || { per_diem_total: 0, per_diem_days: 0 };
        emp.total_points = Math.round(emp.total_points * 100) / 100;
        emp.total_amount = Math.round(emp.total_amount * 100) / 100;
        emp.per_diem_total = pd.per_diem_total;
        emp.per_diem_days = pd.per_diem_days;
        // Convert days array to object keyed by day number for frontend grid
        const daysObj = {};
        const daysDetailed = [];
        for (const d of emp.days) {
          const dateObj = new Date(d.date);
          const dayNum = dateObj.getDate();
          daysObj[dayNum] = d.points;
          daysDetailed.push({ ...d, day: dayNum });
        }
        emp.days = daysObj;
        emp.days_detailed = daysDetailed;
        emp.id = emp.employee_id; // alias for frontend
        return emp;
      });

      // Load tariff grid for color categories
      let tariffCategories = [];
      try {
        const { rows: tariffs } = await db.query(
          'SELECT id, category, position_name, points, is_active FROM field_tariff_grid WHERE is_active = true ORDER BY points, category'
        );
        // Build color map: group by points → category label
        const catMap = {};
        for (const t of tariffs) {
          const pts = t.points;
          if (!pts || pts === 0) continue;
          if (!catMap[pts]) catMap[pts] = { points: pts, labels: [], category: t.category };
          catMap[pts].labels.push(t.position_name);
          catMap[pts].category = t.category;
        }
        tariffCategories = Object.values(catMap);
      } catch (_) {}

      return {
        employees,
        month_days: lastDay,
        point_value: pointValue,
        year,
        month,
        works: Object.values(worksSet),
        tariff_categories: tariffCategories
      };
    } catch (err) {
      fastify.log.error('[worker-payments] GET /reports/payroll-grid error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─── PUT /reports/payroll-grid/:year/:month/save — сохранение баллов
  fastify.put('/reports/payroll-grid/:year/:month/save', crmAuth, async (req, reply) => {
    try {
      const year = parseInt(req.params.year);
      const month = parseInt(req.params.month);
      if (!year || !month || month < 1 || month > 12) {
        return reply.code(400).send({ error: 'Некорректный год/месяц' });
      }

      const { rows: rowsBody } = req.body || {};
      if (!rowsBody || !Array.isArray(rowsBody) || rowsBody.length === 0) {
        return reply.code(400).send({ error: 'Укажите rows: [{employee_id, days: [{date, points, work_id?}]}]' });
      }

      const isDir = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_PM'].includes(req.user.role);

      // Point value from settings
      const pvRes = await db.query("SELECT key, value_json FROM settings WHERE key = 'point_value'");
      const pointValue = pvRes.rows[0] ? parseFloat(JSON.parse(pvRes.rows[0].value_json)) : 500;

      let updated = 0;

      for (const row of rowsBody) {
        const empId = parseInt(row.employee_id);
        if (!empId || !Array.isArray(row.days)) continue;

        for (const day of row.days) {
          if (!day.date || day.points === undefined || day.points === null) continue;
          const points = parseFloat(day.points);
          const amount = points * pointValue;
          const dayDate = day.date;

          // Get point_value from tariff if available
          let pv = pointValue;
          if (day.work_id) {
            const pvRow = await db.query(`
              SELECT COALESCE(ftg.point_value, $1) as pv
              FROM employee_assignments ea
              LEFT JOIN field_tariff_grid ftg ON ftg.id = ea.tariff_id
              WHERE ea.employee_id = $2 AND ea.work_id = $3
              LIMIT 1
            `, [pointValue, empId, parseInt(day.work_id)]);
            if (pvRow.rows.length > 0) pv = parseFloat(pvRow.rows[0].pv);
          }

          const dayAmount = points * pv;

          // Build works filter
          const worksSubquery = isDir
            ? ''
            : `AND work_id IN (SELECT id FROM works WHERE pm_id = ${parseInt(req.user.id)})`;

          // Try UPDATE existing checkin
          const result = await db.query(`
            UPDATE field_checkins
            SET day_rate = $1, amount_earned = $2, updated_at = NOW()
            WHERE employee_id = $3 AND date = $4::date
              ${worksSubquery}
              ${day.work_id ? 'AND work_id = ' + parseInt(day.work_id) : ''}
          `, [dayAmount, dayAmount, empId, dayDate]);

          if (result.rowCount > 0) {
            updated += result.rowCount;
          } else if (day.work_id) {
            // INSERT new checkin if work_id is provided and no existing record
            await db.query(`
              INSERT INTO field_checkins (employee_id, work_id, date, day_rate, amount_earned, status, created_at, updated_at)
              VALUES ($1, $2, $3::date, $4, $5, 'completed', NOW(), NOW())
              ON CONFLICT DO NOTHING
            `, [empId, parseInt(day.work_id), dayDate, dayAmount, dayAmount]);
            updated += 1;
          }
        }
      }

      return { ok: true, updated };
    } catch (err) {
      fastify.log.error('[worker-payments] PUT /reports/payroll-grid/save error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─── GET /reports/payroll-grid/:year/:month/export — Excel ведомость-сетка
  fastify.get('/reports/payroll-grid/:year/:month/export', crmAuth, async (req, reply) => {
    try {
      const ExcelJS = require('exceljs');
      const year = parseInt(req.params.year);
      const month = parseInt(req.params.month);
      if (!year || !month || month < 1 || month > 12) {
        return reply.code(400).send({ error: 'Некорректный год/месяц' });
      }

      const monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
      const mName = monthNames[month - 1] || '';
      const lastDay = new Date(year, month, 0).getDate();

      const isDir = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_PM'].includes(req.user.role);

      // Point value from settings
      const pvRes = await db.query("SELECT key, value_json FROM settings WHERE key = 'point_value'");
      const pointValue = pvRes.rows[0] ? parseFloat(JSON.parse(pvRes.rows[0].value_json)) : 500;

      const periodFrom = `${year}-${String(month).padStart(2, '0')}-01`;
      const periodTo = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      // Fetch checkins (same logic as GET grid)
      const worksFilter = isDir
        ? ''
        : 'AND fc.work_id IN (SELECT id FROM works WHERE pm_id = $4)';
      const checkinParams = isDir ? [year, month, ['completed', 'closed', 'confirmed']] : [year, month, ['completed', 'closed', 'confirmed'], req.user.id];

      const { rows: checkins } = await db.query(`
        SELECT fc.employee_id, e.fio, e.full_name,
               fc.date, fc.amount_earned, fc.work_id, w.work_title,
               COALESCE(ftg.point_value, ${pointValue}) as row_point_value
        FROM field_checkins fc
        JOIN employees e ON e.id = fc.employee_id
        JOIN works w ON w.id = fc.work_id
        LEFT JOIN employee_assignments ea ON ea.employee_id = fc.employee_id AND ea.work_id = fc.work_id
        LEFT JOIN field_tariff_grid ftg ON ftg.id = ea.tariff_id
        WHERE EXTRACT(YEAR FROM fc.date) = $1
          AND EXTRACT(MONTH FROM fc.date) = $2
          AND fc.status = ANY($3)
          ${worksFilter}
        ORDER BY e.fio, fc.date
      `, checkinParams);

      // Fetch per-diem
      const pdWorksFilter = isDir
        ? ''
        : 'AND wp.work_id IN (SELECT id FROM works WHERE pm_id = $4)';
      const pdParams = isDir ? [periodFrom, periodTo, ['per_diem']] : [periodFrom, periodTo, ['per_diem'], req.user.id];

      const { rows: perDiemRows } = await db.query(`
        SELECT wp.employee_id, SUM(wp.amount) as per_diem_total
        FROM worker_payments wp
        WHERE wp.type = ANY($3) AND wp.status != 'cancelled'
          AND ((wp.period_from >= $1::date AND wp.period_from <= $2::date) OR (wp.period_to >= $1::date AND wp.period_to <= $2::date))
          ${pdWorksFilter}
        GROUP BY wp.employee_id
      `, pdParams);

      const perDiemMap = {};
      for (const pd of perDiemRows) {
        perDiemMap[pd.employee_id] = parseFloat(pd.per_diem_total) || 0;
      }

      // Get PM name for header
      const { rows: pmRows } = await db.query('SELECT fio FROM employees WHERE user_id = $1', [req.user.id]);
      const pmName = pmRows.length > 0 ? pmRows[0].fio : '';

      // Group by employee
      const empMap = {};
      for (const c of checkins) {
        if (!empMap[c.employee_id]) {
          empMap[c.employee_id] = {
            fio: c.fio || c.full_name,
            dayMap: {},     // day_number -> points
            total_points: 0,
            total_amount: 0,
            days_count: 0
          };
        }
        const emp = empMap[c.employee_id];
        const pv = parseFloat(c.row_point_value) || pointValue;
        const amount = parseFloat(c.amount_earned) || 0;
        const points = pv > 0 ? Math.round((amount / pv) * 100) / 100 : 0;
        const dayNum = new Date(c.date).getDate();

        // If multiple checkins on same day — sum points
        if (emp.dayMap[dayNum]) {
          emp.dayMap[dayNum] += points;
        } else {
          emp.dayMap[dayNum] = points;
          emp.days_count += 1;
        }
        emp.total_points += points;
        emp.total_amount += amount;
      }

      // Color fills for point values
      const blueFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB3D9FF' } };   // 6 points
      const greenFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF90EE90' } };   // 10 points
      const brightGreenFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00D26A' } }; // 12 points
      const goldFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD700' } };    // 18 points
      const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD5E8F0' } };
      const totalFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
      const thinBorder = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' }
      };

      function getPointFill(pts) {
        if (pts >= 18) return goldFill;
        if (pts >= 12) return brightGreenFill;
        if (pts >= 10) return greenFill;
        if (pts >= 6) return blueFill;
        return null;
      }

      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'АСГАРД CRM';
      workbook.created = new Date();
      const ws = workbook.addWorksheet('Ведомость');

      // Column count: ФИО + days 1..N + Дней + Баллов + Заработок + Суточные + Итого
      const totalCols = 1 + lastDay + 5;

      // Header row 1: title
      ws.mergeCells(1, 1, 1, totalCols);
      const titleCell = ws.getCell(1, 1);
      titleCell.value = `Ведомость — ${mName} ${year}`;
      titleCell.font = { bold: true, size: 14 };

      // Header row 2: PM + company
      ws.mergeCells(2, 1, 2, Math.floor(totalCols / 2));
      ws.getCell(2, 1).value = `РП: ${pmName}`;
      ws.getCell(2, 1).font = { size: 11 };
      ws.mergeCells(2, Math.floor(totalCols / 2) + 1, 2, totalCols);
      ws.getCell(2, Math.floor(totalCols / 2) + 1).value = 'ООО Асгард Сервис';
      ws.getCell(2, Math.floor(totalCols / 2) + 1).font = { size: 11 };

      // Header row 3: blank
      ws.addRow([]);

      // Header row 4: column titles
      const headerRow = ws.getRow(4);
      headerRow.getCell(1).value = 'ФИО';
      for (let d = 1; d <= lastDay; d++) {
        headerRow.getCell(1 + d).value = d;
      }
      headerRow.getCell(1 + lastDay + 1).value = 'Дней';
      headerRow.getCell(1 + lastDay + 2).value = 'Баллов';
      headerRow.getCell(1 + lastDay + 3).value = 'Заработок';
      headerRow.getCell(1 + lastDay + 4).value = 'Суточные';
      headerRow.getCell(1 + lastDay + 5).value = 'Итого';
      headerRow.font = { bold: true, size: 10 };
      headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
      for (let c = 1; c <= totalCols; c++) {
        headerRow.getCell(c).fill = headerFill;
        headerRow.getCell(c).border = thinBorder;
      }

      // Column widths
      ws.getColumn(1).width = 25;
      for (let d = 1; d <= lastDay; d++) {
        ws.getColumn(1 + d).width = 6;
      }
      ws.getColumn(1 + lastDay + 1).width = 8;
      ws.getColumn(1 + lastDay + 2).width = 10;
      ws.getColumn(1 + lastDay + 3).width = 12;
      ws.getColumn(1 + lastDay + 4).width = 12;
      ws.getColumn(1 + lastDay + 5).width = 12;

      // Data rows
      const daySums = new Array(lastDay).fill(0);
      let sumDays = 0, sumPoints = 0, sumEarned = 0, sumPerDiem = 0, sumTotal = 0;
      let rowIdx = 5;

      const employees = Object.entries(empMap).sort((a, b) => (a[1].fio || '').localeCompare(b[1].fio || ''));

      for (const [empId, emp] of employees) {
        const dataRow = ws.getRow(rowIdx);
        dataRow.getCell(1).value = emp.fio;
        dataRow.getCell(1).border = thinBorder;

        for (let d = 1; d <= lastDay; d++) {
          const cell = dataRow.getCell(1 + d);
          const pts = emp.dayMap[d] || null;
          if (pts !== null) {
            cell.value = pts;
            const fill = getPointFill(pts);
            if (fill) cell.fill = fill;
            daySums[d - 1] += pts;
          }
          cell.border = thinBorder;
          cell.alignment = { horizontal: 'center' };
        }

        const empPerDiem = perDiemMap[parseInt(empId)] || 0;
        const empTotal = emp.total_amount + empPerDiem;

        dataRow.getCell(1 + lastDay + 1).value = emp.days_count;
        dataRow.getCell(1 + lastDay + 2).value = Math.round(emp.total_points * 100) / 100;
        dataRow.getCell(1 + lastDay + 3).value = Math.round(emp.total_amount * 100) / 100;
        dataRow.getCell(1 + lastDay + 3).numFmt = '#,##0.00';
        dataRow.getCell(1 + lastDay + 4).value = empPerDiem;
        dataRow.getCell(1 + lastDay + 4).numFmt = '#,##0.00';
        dataRow.getCell(1 + lastDay + 5).value = Math.round(empTotal * 100) / 100;
        dataRow.getCell(1 + lastDay + 5).numFmt = '#,##0.00';

        for (let c = 1 + lastDay + 1; c <= totalCols; c++) {
          dataRow.getCell(c).border = thinBorder;
          dataRow.getCell(c).alignment = { horizontal: 'center' };
        }

        sumDays += emp.days_count;
        sumPoints += emp.total_points;
        sumEarned += emp.total_amount;
        sumPerDiem += empPerDiem;
        sumTotal += empTotal;
        rowIdx++;
      }

      // Totals row
      const totRow = ws.getRow(rowIdx);
      totRow.getCell(1).value = 'ИТОГО';
      totRow.font = { bold: true, size: 10 };

      for (let d = 1; d <= lastDay; d++) {
        const cell = totRow.getCell(1 + d);
        cell.value = daySums[d - 1] > 0 ? Math.round(daySums[d - 1] * 100) / 100 : null;
        cell.border = thinBorder;
        cell.alignment = { horizontal: 'center' };
      }
      totRow.getCell(1 + lastDay + 1).value = sumDays;
      totRow.getCell(1 + lastDay + 2).value = Math.round(sumPoints * 100) / 100;
      totRow.getCell(1 + lastDay + 3).value = Math.round(sumEarned * 100) / 100;
      totRow.getCell(1 + lastDay + 3).numFmt = '#,##0.00';
      totRow.getCell(1 + lastDay + 4).value = Math.round(sumPerDiem * 100) / 100;
      totRow.getCell(1 + lastDay + 4).numFmt = '#,##0.00';
      totRow.getCell(1 + lastDay + 5).value = Math.round(sumTotal * 100) / 100;
      totRow.getCell(1 + lastDay + 5).numFmt = '#,##0.00';

      for (let c = 1; c <= totalCols; c++) {
        totRow.getCell(c).fill = totalFill;
        totRow.getCell(c).border = thinBorder;
      }

      // Send
      const buf = await workbook.xlsx.writeBuffer();
      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      reply.header('Content-Disposition', `attachment; filename="payroll_${year}_${month}.xlsx"`);
      return reply.send(Buffer.from(buf));
    } catch (err) {
      fastify.log.error('[worker-payments] payroll-grid export error:', err);
      return reply.code(500).send({ error: 'Ошибка экспорта' });
    }
  });
}

module.exports = routes;
