/**
 * ASGARD CRM — Расчёты с рабочими (Payroll API)
 * Фаза 4: требования №29-34
 *
 * Ведомости, строки начислений, реестр выплат,
 * ставки, самозанятые, разовые оплаты, аналитика
 */

const ExcelJS = require('exceljs');

// ─── Роли с доступом ─────────────────────────────────────
const DIRECTOR_ROLES = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const PAYROLL_ROLES = ['ADMIN', ...DIRECTOR_ROLES, 'PM', 'HEAD_PM', 'BUH'];
const APPROVE_ROLES = ['ADMIN', ...DIRECTOR_ROLES];
const PAY_ROLES = ['ADMIN', ...DIRECTOR_ROLES, 'BUH'];

function hasRole(user, roles) {
  if (user.role === 'ADMIN') return true;
  if (user.role === 'HEAD_PM' && roles.includes('PM')) return true;
  return roles.includes(user.role);
}

// ─── Хелпер: пересчёт итогов ведомости ──────────────────
async function recalcSheetTotals(db, sheetId) {
  const result = await db.query(`
    SELECT
      COALESCE(SUM(accrued), 0) as total_accrued,
      COALESCE(SUM(bonus), 0) as total_bonus,
      COALESCE(SUM(penalty + deductions), 0) as total_penalty,
      COALESCE(SUM(advance_paid), 0) as total_advance_paid,
      COALESCE(SUM(payout), 0) as total_payout,
      COUNT(*) as workers_count
    FROM payroll_items WHERE sheet_id = $1
  `, [sheetId]);
  const r = result.rows[0];
  await db.query(`
    UPDATE payroll_sheets SET
      total_accrued = $2, total_bonus = $3, total_penalty = $4,
      total_advance_paid = $5, total_payout = $6, workers_count = $7,
      updated_at = NOW()
    WHERE id = $1
  `, [sheetId, r.total_accrued, r.total_bonus, r.total_penalty,
      r.total_advance_paid, r.total_payout, r.workers_count]);
}

// ─── Хелпер: расчёт пересечения дней ────────────────────
function calcWorkingDays(periodFrom, periodTo, assignFrom, assignTo) {
  const start = new Date(Math.max(new Date(periodFrom), new Date(assignFrom)));
  const end = new Date(Math.min(
    new Date(periodTo),
    assignTo ? new Date(assignTo) : new Date(periodTo)
  ));
  if (start > end) return 0;
  const diffMs = end - start;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
}

// ─── Хелпер: расчёт строки начисления ───────────────────
function calcItemAmounts(item) {
  const daysWorked = Number(item.days_worked) || 0;
  const dayRate = Number(item.day_rate) || 0;
  const bonus = Number(item.bonus) || 0;
  const overtimeHours = Number(item.overtime_hours) || 0;
  const overtimeRate = Number(item.overtime_rate) || dayRate * 1.5;
  const penalty = Number(item.penalty) || 0;
  const advancePaid = Number(item.advance_paid) || 0;
  const deductions = Number(item.deductions) || 0;

  const baseAmount = daysWorked * dayRate;
  const overtimeAmount = overtimeHours * overtimeRate;
  const accrued = baseAmount + bonus + overtimeAmount;
  const payout = accrued - penalty - advancePaid - deductions;

  return { baseAmount, overtimeAmount, accrued, payout: Math.max(0, payout) };
}

async function routes(fastify, options) {
  const db = fastify.db;

  // ═══════════════════════════════════════════════════════════
  // ВЕДОМОСТИ (sheets)
  // ═══════════════════════════════════════════════════════════

  // GET /sheets — список ведомостей
  fastify.get('/sheets', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const user = req.user;
    if (!hasRole(user, PAYROLL_ROLES)) return reply.code(403).send({ error: 'Нет доступа' });

    const { work_id, status, period_from, period_to, limit = 50, offset = 0 } = req.query;
    let where = [];
    let params = [];
    let idx = 1;

    if (work_id) { where.push(`ps.work_id = $${idx++}`); params.push(work_id); }
    if (status) { where.push(`ps.status = $${idx++}`); params.push(status); }
    if (period_from) { where.push(`ps.period_to >= $${idx++}`); params.push(period_from); }
    if (period_to) { where.push(`ps.period_from <= $${idx++}`); params.push(period_to); }

    // PM видит только свои
    if (user.role === 'PM' || user.role === 'HEAD_PM') {
      where.push(`(ps.created_by = $${idx} OR w.pm_id = $${idx})`);
      params.push(user.id);
      idx++;
    }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const countQ = await db.query(
      `SELECT COUNT(*) FROM payroll_sheets ps LEFT JOIN works w ON ps.work_id = w.id ${whereClause}`,
      params
    );

    params.push(Number(limit), Number(offset));
    const q = await db.query(`
      SELECT ps.*,
        w.work_title, w.customer_name,
        u.name as creator_name
      FROM payroll_sheets ps
      LEFT JOIN works w ON ps.work_id = w.id
      LEFT JOIN users u ON ps.created_by = u.id
      ${whereClause}
      ORDER BY ps.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `, params);

    return { sheets: q.rows, total: Number(countQ.rows[0].count) };
  });

  // GET /sheets/:id — детали ведомости
  fastify.get('/sheets/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const user = req.user;
    if (!hasRole(user, PAYROLL_ROLES)) return reply.code(403).send({ error: 'Нет доступа' });

    const { id } = req.params;
    const sheetQ = await db.query(`
      SELECT ps.*, w.work_title, w.customer_name, w.pm_id,
        u1.name as creator_name, u2.name as approver_name
      FROM payroll_sheets ps
      LEFT JOIN works w ON ps.work_id = w.id
      LEFT JOIN users u1 ON ps.created_by = u1.id
      LEFT JOIN users u2 ON ps.approved_by = u2.id
      WHERE ps.id = $1
    `, [id]);

    if (!sheetQ.rows.length) return reply.code(404).send({ error: 'Ведомость не найдена' });
    const sheet = sheetQ.rows[0];

    // PM проверка доступа
    if ((user.role === 'PM' || user.role === 'HEAD_PM') && sheet.created_by !== user.id && sheet.pm_id !== user.id) {
      return reply.code(403).send({ error: 'Нет доступа к этой ведомости' });
    }

    const itemsQ = await db.query(`
      SELECT pi.*, e.fio as emp_fio, e.is_self_employed as emp_se
      FROM payroll_items pi
      LEFT JOIN employees e ON pi.employee_id = e.id
      WHERE pi.sheet_id = $1
      ORDER BY pi.id
    `, [id]);

    const paymentsQ = await db.query(`
      SELECT * FROM payment_registry WHERE sheet_id = $1 ORDER BY id
    `, [id]);

    return { sheet, items: itemsQ.rows, payments: paymentsQ.rows };
  });

  // POST /sheets — создать ведомость
  fastify.post('/sheets', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const user = req.user;
    if (!hasRole(user, ['ADMIN', ...DIRECTOR_ROLES, 'PM', 'HEAD_PM'])) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    const { work_id, title, period_from, period_to, comment } = req.body;
    if (!period_from || !period_to) return reply.code(400).send({ error: 'Укажите период' });

    // PM: проверка что работа его
    if (work_id && (user.role === 'PM' || user.role === 'HEAD_PM')) {
      const wk = await db.query('SELECT pm_id, created_by FROM works WHERE id = $1', [work_id]);
      if (wk.rows.length && wk.rows[0].pm_id !== user.id && wk.rows[0].created_by !== user.id) {
        return reply.code(403).send({ error: 'Это не ваша работа' });
      }
    }

    // Автогенерация заголовка
    let autoTitle = title;
    if (!autoTitle && work_id) {
      const wk = await db.query('SELECT work_title, customer_name FROM works WHERE id = $1', [work_id]);
      if (wk.rows.length) {
        const d = new Date(period_from);
        const months = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
        autoTitle = `Ведомость ${months[d.getMonth()]} ${d.getFullYear()} — ${wk.rows[0].customer_name || wk.rows[0].work_title}`;
      }
    }
    if (!autoTitle) autoTitle = `Ведомость ${period_from} — ${period_to}`;

    const q = await db.query(`
      INSERT INTO payroll_sheets (work_id, title, period_from, period_to, comment, created_by, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'draft')
      RETURNING *
    `, [work_id || null, autoTitle, period_from, period_to, comment || null, user.id]);

    return { sheet: q.rows[0] };
  });

  // PUT /sheets/:id — обновить черновик
  fastify.put('/sheets/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const user = req.user;
    const { id } = req.params;

    const check = await db.query('SELECT status, created_by FROM payroll_sheets WHERE id = $1', [id]);
    if (!check.rows.length) return reply.code(404).send({ error: 'Не найдено' });
    if (check.rows[0].status !== 'draft' && check.rows[0].status !== 'rework') {
      return reply.code(400).send({ error: 'Редактирование доступно только для черновиков и доработки' });
    }

    const { title, period_from, period_to, comment } = req.body;
    const q = await db.query(`
      UPDATE payroll_sheets SET
        title = COALESCE($2, title),
        period_from = COALESCE($3, period_from),
        period_to = COALESCE($4, period_to),
        comment = COALESCE($5, comment),
        updated_at = NOW()
      WHERE id = $1 RETURNING *
    `, [id, title, period_from, period_to, comment]);

    return { sheet: q.rows[0] };
  });

  // PUT /sheets/:id/submit — отправить на согласование
  fastify.put('/sheets/:id/submit', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const user = req.user;
    const { id } = req.params;

    const check = await db.query('SELECT status FROM payroll_sheets WHERE id = $1', [id]);
    if (!check.rows.length) return reply.code(404).send({ error: 'Не найдено' });
    if (check.rows[0].status !== 'draft' && check.rows[0].status !== 'rework') {
      return reply.code(400).send({ error: 'Можно отправить только черновик или доработку' });
    }

    await recalcSheetTotals(db, id);

    const q = await db.query(`
      UPDATE payroll_sheets SET status = 'pending', updated_at = NOW()
      WHERE id = $1 RETURNING *
    `, [id]);

    // Уведомление директорам
    const directors = await db.query(
      `SELECT id FROM users WHERE role IN ('ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV') AND is_active = true`
    );
    const sheet = q.rows[0];
    for (const dir of directors.rows) {
      await db.query(`
        INSERT INTO notifications (user_id, title, message, type, entity_id, link_hash, is_read, created_at)
        VALUES ($1, $2, $3, 'payroll_approval', $4, $5, false, NOW())
      `, [dir.id, 'Ведомость на согласование',
          `${sheet.title} — к выплате ${Number(sheet.total_payout).toLocaleString('ru-RU')} ₽`,
          id, '#/payroll-sheet?id=' + id]);
    }

    return { sheet };
  });

  // PUT /sheets/:id/approve — согласовать
  fastify.put('/sheets/:id/approve', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const user = req.user;
    if (!hasRole(user, APPROVE_ROLES)) return reply.code(403).send({ error: 'Нет доступа' });

    const { id } = req.params;
    const check = await db.query('SELECT status, created_by FROM payroll_sheets WHERE id = $1', [id]);
    if (!check.rows.length) return reply.code(404).send({ error: 'Не найдено' });
    if (check.rows[0].status !== 'pending') return reply.code(400).send({ error: 'Ведомость не на согласовании' });

    const q = await db.query(`
      UPDATE payroll_sheets SET status = 'approved', approved_by = $2, approved_at = NOW(), updated_at = NOW()
      WHERE id = $1 RETURNING *
    `, [id, user.id]);

    // Уведомление создателю
    await db.query(`
      INSERT INTO notifications (user_id, title, message, type, entity_id, link_hash, is_read, created_at)
      VALUES ($1, 'Ведомость согласована', $2, 'payroll_approved', $3, $4, false, NOW())
    `, [check.rows[0].created_by, q.rows[0].title, id, '#/payroll-sheet?id=' + id]);

    return { sheet: q.rows[0] };
  });

  // PUT /sheets/:id/rework — возврат на доработку
  fastify.put('/sheets/:id/rework', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const user = req.user;
    if (!hasRole(user, APPROVE_ROLES)) return reply.code(403).send({ error: 'Нет доступа' });

    const { id } = req.params;
    const { director_comment } = req.body;

    const check = await db.query('SELECT status, created_by FROM payroll_sheets WHERE id = $1', [id]);
    if (!check.rows.length) return reply.code(404).send({ error: 'Не найдено' });
    if (check.rows[0].status !== 'pending') return reply.code(400).send({ error: 'Ведомость не на согласовании' });

    const q = await db.query(`
      UPDATE payroll_sheets SET status = 'rework', director_comment = $2, updated_at = NOW()
      WHERE id = $1 RETURNING *
    `, [id, director_comment || '']);

    await db.query(`
      INSERT INTO notifications (user_id, title, message, type, entity_id, link_hash, is_read, created_at)
      VALUES ($1, 'Ведомость на доработку', $2, 'payroll_rework', $3, $4, false, NOW())
    `, [check.rows[0].created_by, director_comment || 'Требуется доработка', id, '#/payroll-sheet?id=' + id]);

    return { sheet: q.rows[0] };
  });

  // PUT /sheets/:id/pay — оплата
  fastify.put('/sheets/:id/pay', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const user = req.user;
    if (!hasRole(user, PAY_ROLES)) return reply.code(403).send({ error: 'Нет доступа' });

    const { id } = req.params;
    const check = await db.query('SELECT * FROM payroll_sheets WHERE id = $1', [id]);
    if (!check.rows.length) return reply.code(404).send({ error: 'Не найдено' });
    if (check.rows[0].status !== 'approved') return reply.code(400).send({ error: 'Ведомость не согласована' });

    const sheet = check.rows[0];

    await db.query(`
      UPDATE payroll_sheets SET status = 'paid', paid_by = $2, paid_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [id, user.id]);

    // Создание записей payment_registry для каждого item
    const items = await db.query('SELECT * FROM payroll_items WHERE sheet_id = $1', [id]);
    let paymentsCreated = 0;

    for (const item of items.rows) {
      if (Number(item.payout) <= 0) continue;

      // Получаем банковские реквизиты
      const emp = await db.query(
        'SELECT inn, bank_name, bik, account_number FROM employees WHERE id = $1',
        [item.employee_id]
      );
      const empData = emp.rows[0] || {};

      await db.query(`
        INSERT INTO payment_registry
          (sheet_id, employee_id, employee_name, amount, payment_type, payment_method,
           inn, bank_name, bik, account_number, status, created_by)
        VALUES ($1, $2, $3, $4, 'salary', $5, $6, $7, $8, $9, 'pending', $10)
      `, [id, item.employee_id, item.employee_name, item.payout,
          item.payment_method || 'card',
          empData.inn, empData.bank_name, empData.bik, empData.account_number,
          user.id]);
      paymentsCreated++;
    }

    // Создание записей work_expenses (ФОТ)
    if (sheet.work_id) {
      for (const item of items.rows) {
        if (Number(item.payout) <= 0) continue;
        await db.query(`
          INSERT INTO work_expenses (work_id, category, amount, date,
            fot_employee_id, fot_employee_name, comment, created_by, created_at)
          VALUES ($1, 'fot', $2, $3, $4, $5, $6, $7, NOW())
        `, [sheet.work_id, item.payout, sheet.period_to, item.employee_id,
            item.employee_name, 'Ведомость #' + id, user.id]);
      }
    }

    // Уведомление создателю
    await db.query(`
      INSERT INTO notifications (user_id, title, message, type, entity_id, link_hash, is_read, created_at)
      VALUES ($1, 'Ведомость оплачена', $2, 'payroll_paid', $3, $4, false, NOW())
    `, [sheet.created_by, sheet.title, id, '#/payroll-sheet?id=' + id]);

    const updatedSheet = await db.query('SELECT * FROM payroll_sheets WHERE id = $1', [id]);
    return { sheet: updatedSheet.rows[0], payments_created: paymentsCreated };
  });

  // DELETE /sheets/:id — удалить черновик
  fastify.delete('/sheets/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { id } = req.params;
    const check = await db.query('SELECT status FROM payroll_sheets WHERE id = $1', [id]);
    if (!check.rows.length) return reply.code(404).send({ error: 'Не найдено' });
    if (check.rows[0].status !== 'draft') return reply.code(400).send({ error: 'Можно удалить только черновик' });

    await db.query('DELETE FROM payroll_sheets WHERE id = $1', [id]);
    return { deleted: true };
  });

  // ═══════════════════════════════════════════════════════════
  // СТРОКИ НАЧИСЛЕНИЙ (items)
  // ═══════════════════════════════════════════════════════════

  // GET /items — строки ведомости
  fastify.get('/items', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { sheet_id } = req.query;
    if (!sheet_id) return reply.code(400).send({ error: 'Укажите sheet_id' });

    const q = await db.query(`
      SELECT pi.*, e.fio as emp_fio, e.is_self_employed as emp_se, e.phone as emp_phone
      FROM payroll_items pi
      LEFT JOIN employees e ON pi.employee_id = e.id
      WHERE pi.sheet_id = $1
      ORDER BY pi.id
    `, [sheet_id]);

    return { items: q.rows };
  });

  // POST /items — добавить строку
  fastify.post('/items', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const user = req.user;
    const b = req.body;
    if (!b.sheet_id || !b.employee_id) return reply.code(400).send({ error: 'sheet_id и employee_id обязательны' });

    // Проверяем статус ведомости
    const sheetCheck = await db.query('SELECT status, work_id FROM payroll_sheets WHERE id = $1', [b.sheet_id]);
    if (!sheetCheck.rows.length) return reply.code(404).send({ error: 'Ведомость не найдена' });
    if (sheetCheck.rows[0].status !== 'draft' && sheetCheck.rows[0].status !== 'rework') {
      return reply.code(400).send({ error: 'Добавление возможно только в черновик/доработку' });
    }

    // Получаем данные работника
    const emp = await db.query('SELECT fio, is_self_employed, day_rate as emp_day_rate FROM employees WHERE id = $1', [b.employee_id]);
    if (!emp.rows.length) return reply.code(404).send({ error: 'Работник не найден' });

    const dayRate = Number(b.day_rate) || Number(emp.rows[0].emp_day_rate) || 0;
    const amounts = calcItemAmounts({ ...b, day_rate: dayRate });

    // Получаем роль на работе
    let roleOnWork = b.role_on_work || null;
    if (!roleOnWork && sheetCheck.rows[0].work_id) {
      const assign = await db.query(
        'SELECT role_on_work FROM employee_assignments WHERE employee_id = $1 AND work_id = $2 ORDER BY id DESC LIMIT 1',
        [b.employee_id, sheetCheck.rows[0].work_id]
      );
      if (assign.rows.length) roleOnWork = assign.rows[0].role_on_work;
    }

    const q = await db.query(`
      INSERT INTO payroll_items
        (sheet_id, employee_id, employee_name, work_id, role_on_work,
         days_worked, day_rate, base_amount, bonus, overtime_hours, overtime_amount,
         penalty, penalty_reason, advance_paid, deductions, deductions_reason,
         accrued, payout, payment_method, is_self_employed, comment)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      RETURNING *
    `, [
      b.sheet_id, b.employee_id, emp.rows[0].fio, sheetCheck.rows[0].work_id, roleOnWork,
      b.days_worked || 0, dayRate, amounts.baseAmount,
      b.bonus || 0, b.overtime_hours || 0, amounts.overtimeAmount,
      b.penalty || 0, b.penalty_reason || null,
      b.advance_paid || 0, b.deductions || 0, b.deductions_reason || null,
      amounts.accrued, amounts.payout,
      b.payment_method || 'card', emp.rows[0].is_self_employed || false,
      b.comment || null
    ]);

    await recalcSheetTotals(db, b.sheet_id);
    return { item: q.rows[0] };
  });

  // PUT /items/:id — обновить строку
  fastify.put('/items/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { id } = req.params;
    const b = req.body;

    const check = await db.query(`
      SELECT pi.sheet_id, ps.status FROM payroll_items pi
      JOIN payroll_sheets ps ON pi.sheet_id = ps.id
      WHERE pi.id = $1
    `, [id]);
    if (!check.rows.length) return reply.code(404).send({ error: 'Не найдено' });
    if (check.rows[0].status !== 'draft' && check.rows[0].status !== 'rework') {
      return reply.code(400).send({ error: 'Редактирование доступно только в черновике/доработке' });
    }

    const amounts = calcItemAmounts(b);

    const q = await db.query(`
      UPDATE payroll_items SET
        days_worked = COALESCE($2, days_worked),
        day_rate = COALESCE($3, day_rate),
        base_amount = $4,
        bonus = COALESCE($5, bonus),
        overtime_hours = COALESCE($6, overtime_hours),
        overtime_amount = $7,
        penalty = COALESCE($8, penalty),
        penalty_reason = COALESCE($9, penalty_reason),
        advance_paid = COALESCE($10, advance_paid),
        deductions = COALESCE($11, deductions),
        deductions_reason = COALESCE($12, deductions_reason),
        accrued = $13,
        payout = $14,
        payment_method = COALESCE($15, payment_method),
        comment = COALESCE($16, comment),
        updated_at = NOW()
      WHERE id = $1 RETURNING *
    `, [id,
      b.days_worked, b.day_rate, amounts.baseAmount,
      b.bonus, b.overtime_hours, amounts.overtimeAmount,
      b.penalty, b.penalty_reason,
      b.advance_paid, b.deductions, b.deductions_reason,
      amounts.accrued, amounts.payout,
      b.payment_method, b.comment
    ]);

    await recalcSheetTotals(db, check.rows[0].sheet_id);
    return { item: q.rows[0] };
  });

  // DELETE /items/:id
  fastify.delete('/items/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { id } = req.params;
    const check = await db.query(`
      SELECT pi.sheet_id, ps.status FROM payroll_items pi
      JOIN payroll_sheets ps ON pi.sheet_id = ps.id WHERE pi.id = $1
    `, [id]);
    if (!check.rows.length) return reply.code(404).send({ error: 'Не найдено' });
    if (check.rows[0].status !== 'draft' && check.rows[0].status !== 'rework') {
      return reply.code(400).send({ error: 'Удаление доступно только в черновике/доработке' });
    }

    await db.query('DELETE FROM payroll_items WHERE id = $1', [id]);
    await recalcSheetTotals(db, check.rows[0].sheet_id);
    return { deleted: true };
  });

  // POST /items/auto-fill — автозаполнение
  fastify.post('/items/auto-fill', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { sheet_id } = req.body;
    if (!sheet_id) return reply.code(400).send({ error: 'sheet_id обязателен' });

    const sheet = await db.query('SELECT * FROM payroll_sheets WHERE id = $1', [sheet_id]);
    if (!sheet.rows.length) return reply.code(404).send({ error: 'Ведомость не найдена' });
    const s = sheet.rows[0];
    if (s.status !== 'draft' && s.status !== 'rework') {
      return reply.code(400).send({ error: 'Автозаполнение доступно только в черновике/доработке' });
    }
    if (!s.work_id) return reply.code(400).send({ error: 'Автозаполнение доступно только для ведомостей с привязкой к работе' });

    // Назначенные на работу
    const assignments = await db.query(`
      SELECT ea.*, e.fio, e.is_self_employed, e.day_rate as emp_day_rate
      FROM employee_assignments ea
      JOIN employees e ON ea.employee_id = e.id
      WHERE ea.work_id = $1
        AND ea.date_from <= $3
        AND (ea.date_to >= $2 OR ea.date_to IS NULL)
    `, [s.work_id, s.period_from, s.period_to]);

    // Уже добавленные
    const existing = await db.query(
      'SELECT employee_id FROM payroll_items WHERE sheet_id = $1',
      [sheet_id]
    );
    const existingIds = new Set(existing.rows.map(r => r.employee_id));

    let filled = 0;
    let skipped = 0;
    const newItems = [];

    for (const a of assignments.rows) {
      if (existingIds.has(a.employee_id)) { skipped++; continue; }

      // Ставка: employee_rates → employees.day_rate → 0
      let dayRate = 0;
      const rateQ = await db.query(`
        SELECT day_rate FROM employee_rates
        WHERE employee_id = $1 AND effective_from <= $2
          AND (effective_to IS NULL OR effective_to >= $3)
        ORDER BY effective_from DESC LIMIT 1
      `, [a.employee_id, s.period_to, s.period_from]);
      if (rateQ.rows.length) {
        dayRate = Number(rateQ.rows[0].day_rate);
      } else if (a.emp_day_rate) {
        dayRate = Number(a.emp_day_rate);
      }

      // Подсчёт рабочих дней через employee_plan
      let daysWorked = 0;
      const planQ = await db.query(`
        SELECT COUNT(DISTINCT date) as cnt FROM employee_plan
        WHERE employee_id = $1 AND kind = 'work' AND work_id = $2
          AND date BETWEEN $3 AND $4
      `, [a.employee_id, s.work_id, s.period_from, s.period_to]);
      if (planQ.rows[0] && Number(planQ.rows[0].cnt) > 0) {
        daysWorked = Number(planQ.rows[0].cnt);
      } else {
        // Fallback: расчёт пересечения дат
        daysWorked = calcWorkingDays(s.period_from, s.period_to, a.date_from, a.date_to);
      }

      // Бонус из согласованных bonus_requests
      let bonus = 0;
      try {
        const bonusQ = await db.query(`
          SELECT amount FROM bonus_requests
          WHERE work_id = $1 AND status = 'approved'
            AND employees_json::text LIKE $2
        `, [s.work_id, '%' + a.employee_id + '%']);
        // Простая проверка: если рабочий упоминается в json
        for (const br of bonusQ.rows) {
          bonus += Number(br.amount) || 0;
        }
      } catch (e) { /* bonus_requests может не содержать employees_json */ }

      const baseAmount = daysWorked * dayRate;
      const accrued = baseAmount + bonus;
      const payout = accrued;

      const ins = await db.query(`
        INSERT INTO payroll_items
          (sheet_id, employee_id, employee_name, work_id, role_on_work,
           days_worked, day_rate, base_amount, bonus, accrued, payout,
           is_self_employed, payment_method)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        RETURNING *
      `, [sheet_id, a.employee_id, a.fio, s.work_id, a.role_on_work,
          daysWorked, dayRate, baseAmount, bonus, accrued, payout,
          a.is_self_employed || false,
          a.is_self_employed ? 'self_employed' : 'card']);

      newItems.push(ins.rows[0]);
      filled++;
    }

    await recalcSheetTotals(db, sheet_id);
    return { filled, skipped, items: newItems };
  });

  // POST /items/recalc — пересчёт всех строк
  fastify.post('/items/recalc', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { sheet_id } = req.body;
    if (!sheet_id) return reply.code(400).send({ error: 'sheet_id обязателен' });

    const items = await db.query('SELECT * FROM payroll_items WHERE sheet_id = $1', [sheet_id]);
    for (const item of items.rows) {
      const amounts = calcItemAmounts(item);
      await db.query(`
        UPDATE payroll_items SET
          base_amount = $2, overtime_amount = $3, accrued = $4, payout = $5, updated_at = NOW()
        WHERE id = $1
      `, [item.id, amounts.baseAmount, amounts.overtimeAmount, amounts.accrued, amounts.payout]);
    }

    await recalcSheetTotals(db, sheet_id);

    const updatedItems = await db.query('SELECT * FROM payroll_items WHERE sheet_id = $1 ORDER BY id', [sheet_id]);
    const updatedSheet = await db.query('SELECT * FROM payroll_sheets WHERE id = $1', [sheet_id]);
    return { sheet: updatedSheet.rows[0], items: updatedItems.rows };
  });

  // ═══════════════════════════════════════════════════════════
  // РЕЕСТР ВЫПЛАТ (payments)
  // ═══════════════════════════════════════════════════════════

  // GET /payments
  fastify.get('/payments', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const user = req.user;
    if (!hasRole(user, PAYROLL_ROLES)) return reply.code(403).send({ error: 'Нет доступа' });

    const { sheet_id, status, employee_id, payment_method, date_from, date_to, limit = 100, offset = 0 } = req.query;
    let where = [];
    let params = [];
    let idx = 1;

    if (sheet_id) { where.push(`pr.sheet_id = $${idx++}`); params.push(sheet_id); }
    if (status) { where.push(`pr.status = $${idx++}`); params.push(status); }
    if (employee_id) { where.push(`pr.employee_id = $${idx++}`); params.push(employee_id); }
    if (payment_method) { where.push(`pr.payment_method = $${idx++}`); params.push(payment_method); }
    if (date_from) { where.push(`pr.created_at >= $${idx++}`); params.push(date_from); }
    if (date_to) { where.push(`pr.created_at <= $${idx++}`); params.push(date_to + 'T23:59:59'); }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const countQ = await db.query(`SELECT COUNT(*) FROM payment_registry pr ${whereClause}`, params);

    params.push(Number(limit), Number(offset));
    const q = await db.query(`
      SELECT pr.*, ps.title as sheet_title
      FROM payment_registry pr
      LEFT JOIN payroll_sheets ps ON pr.sheet_id = ps.id
      ${whereClause}
      ORDER BY pr.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `, params);

    return { payments: q.rows, total: Number(countQ.rows[0].count) };
  });

  // PUT /payments/:id/status
  fastify.put('/payments/:id/status', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const user = req.user;
    if (!hasRole(user, PAY_ROLES)) return reply.code(403).send({ error: 'Нет доступа' });

    const { id } = req.params;
    const { status, bank_ref, payment_order_number, comment } = req.body;

    const validTransitions = {
      pending: ['processing', 'paid', 'cancelled'],
      processing: ['paid', 'failed', 'cancelled']
    };

    const check = await db.query('SELECT status FROM payment_registry WHERE id = $1', [id]);
    if (!check.rows.length) return reply.code(404).send({ error: 'Не найдено' });
    if (!validTransitions[check.rows[0].status]?.includes(status)) {
      return reply.code(400).send({ error: 'Недопустимый переход статуса' });
    }

    const paidAt = status === 'paid' ? 'NOW()' : 'paid_at';
    const q = await db.query(`
      UPDATE payment_registry SET
        status = $2,
        bank_ref = COALESCE($3, bank_ref),
        payment_order_number = COALESCE($4, payment_order_number),
        comment = COALESCE($5, comment),
        paid_at = ${status === 'paid' ? 'NOW()' : 'paid_at'},
        updated_at = NOW()
      WHERE id = $1 RETURNING *
    `, [id, status, bank_ref, payment_order_number, comment]);

    return { payment: q.rows[0] };
  });

  // GET /payments/export — Excel-экспорт
  fastify.get('/payments/export', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const user = req.user;
    if (!hasRole(user, PAY_ROLES)) return reply.code(403).send({ error: 'Нет доступа' });

    const { sheet_id } = req.query;
    let payments, sheetData;

    if (sheet_id) {
      sheetData = await db.query('SELECT * FROM payroll_sheets WHERE id = $1', [sheet_id]);
      payments = await db.query(`
        SELECT pr.*, e.inn as emp_inn, e.bank_name as emp_bank, e.bik as emp_bik,
               e.account_number as emp_account, e.is_self_employed as emp_se,
               se.contract_number as se_contract
        FROM payment_registry pr
        LEFT JOIN employees e ON pr.employee_id = e.id
        LEFT JOIN self_employed se ON e.id = se.employee_id
        WHERE pr.sheet_id = $1
        ORDER BY pr.id
      `, [sheet_id]);
    } else {
      payments = await db.query(`
        SELECT pr.*, e.inn as emp_inn, e.bank_name as emp_bank, e.bik as emp_bik,
               e.account_number as emp_account, e.is_self_employed as emp_se,
               se.contract_number as se_contract
        FROM payment_registry pr
        LEFT JOIN employees e ON pr.employee_id = e.id
        LEFT JOIN self_employed se ON e.id = se.employee_id
        WHERE pr.status IN ('pending', 'processing')
        ORDER BY pr.id
      `, []);
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'АСГАРД CRM';
    wb.created = new Date();

    const sheetTitle = sheetData?.rows[0]?.title || 'Реестр выплат';
    const periodFrom = sheetData?.rows[0]?.period_from || '';
    const periodTo = sheetData?.rows[0]?.period_to || '';

    // Лист 1: Трудовые
    const labor = payments.rows.filter(p => !p.emp_se);
    const ws1 = wb.addWorksheet('Реестр выплат (трудовые)');

    // Шапка
    ws1.mergeCells('A1:H1');
    ws1.getCell('A1').value = 'РЕЕСТР НА ВЫПЛАТУ ЗАРАБОТНОЙ ПЛАТЫ';
    ws1.getCell('A1').font = { bold: true, size: 14 };
    ws1.mergeCells('A2:H2');
    ws1.getCell('A2').value = 'ООО «АСГАРД СЕРВИС»';
    ws1.getCell('A2').font = { bold: true, size: 12 };
    ws1.mergeCells('A3:H3');
    ws1.getCell('A3').value = `Ведомость: ${sheetTitle}`;
    ws1.mergeCells('A4:H4');
    ws1.getCell('A4').value = `Период: ${periodFrom} — ${periodTo}    Дата формирования: ${new Date().toLocaleDateString('ru-RU')}`;

    const headers = ['№', 'ФИО', 'ИНН', 'Банк', 'БИК', 'Р/С', 'Сумма', 'Назначение платежа'];
    const headerRow = ws1.addRow(headers);
    headerRow.font = { bold: true, size: 11 };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD5E8F0' } };
    headerRow.eachCell(c => { c.border = { bottom: { style: 'thin' } }; });

    ws1.getColumn(1).width = 5;
    ws1.getColumn(2).width = 30;
    ws1.getColumn(3).width = 15;
    ws1.getColumn(4).width = 20;
    ws1.getColumn(5).width = 12;
    ws1.getColumn(6).width = 25;
    ws1.getColumn(7).width = 15;
    ws1.getColumn(8).width = 40;

    let totalLabor = 0;
    labor.forEach((p, i) => {
      const row = ws1.addRow([
        i + 1, p.employee_name, p.emp_inn || p.inn || '',
        p.emp_bank || p.bank_name || '', p.emp_bik || p.bik || '',
        p.emp_account || p.account_number || '', Number(p.amount),
        `Заработная плата за ${periodFrom ? new Date(periodFrom).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }) : ''}`
      ]);
      row.getCell(7).numFmt = '#,##0.00 "₽"';
      row.getCell(7).alignment = { horizontal: 'right' };
      totalLabor += Number(p.amount);
    });

    const totalRow1 = ws1.addRow(['', 'ИТОГО', '', '', '', '', totalLabor, '']);
    totalRow1.font = { bold: true, size: 12 };
    totalRow1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    totalRow1.getCell(7).numFmt = '#,##0.00 "₽"';

    // Лист 2: Самозанятые
    const se = payments.rows.filter(p => p.emp_se);
    if (se.length) {
      const ws2 = wb.addWorksheet('Самозанятые (ГПХ)');
      ws2.mergeCells('A1:H1');
      ws2.getCell('A1').value = 'РЕЕСТР НА ВЫПЛАТУ ПО ДОГОВОРАМ ГПХ (самозанятые)';
      ws2.getCell('A1').font = { bold: true, size: 14 };

      const hdr2 = ws2.addRow(['№', 'ФИО', 'ИНН', 'Номер ГПХ', 'Банк', 'Р/С', 'Сумма', 'Назначение']);
      hdr2.font = { bold: true, size: 11 };
      hdr2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD5E8F0' } };

      ws2.getColumn(1).width = 5;
      ws2.getColumn(2).width = 30;
      ws2.getColumn(3).width = 15;
      ws2.getColumn(4).width = 20;
      ws2.getColumn(5).width = 20;
      ws2.getColumn(6).width = 25;
      ws2.getColumn(7).width = 15;
      ws2.getColumn(8).width = 40;

      let totalSE = 0;
      se.forEach((p, i) => {
        const row = ws2.addRow([
          i + 1, p.employee_name, p.emp_inn || p.inn || '',
          p.se_contract || '', p.emp_bank || p.bank_name || '',
          p.emp_account || p.account_number || '', Number(p.amount),
          `Оплата по ГПХ ${p.se_contract ? '№' + p.se_contract : ''}`
        ]);
        row.getCell(7).numFmt = '#,##0.00 "₽"';
        totalSE += Number(p.amount);
      });

      const totalRow2 = ws2.addRow(['', 'ИТОГО', '', '', '', '', totalSE, '']);
      totalRow2.font = { bold: true, size: 12 };
      totalRow2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
      totalRow2.getCell(7).numFmt = '#,##0.00 "₽"';
    }

    const buffer = await wb.xlsx.writeBuffer();
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="payroll_${sheet_id || 'all'}_${Date.now()}.xlsx"`);
    return reply.send(Buffer.from(buffer));
  });

  // ═══════════════════════════════════════════════════════════
  // СТАВКИ (rates)
  // ═══════════════════════════════════════════════════════════

  // GET /rates
  fastify.get('/rates', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { employee_id } = req.query;
    if (!employee_id) return reply.code(400).send({ error: 'employee_id обязателен' });
    const q = await db.query(
      'SELECT * FROM employee_rates WHERE employee_id = $1 ORDER BY effective_from DESC',
      [employee_id]
    );
    return { rates: q.rows };
  });

  // GET /rates/current
  fastify.get('/rates/current', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { employee_id } = req.query;
    if (!employee_id) return reply.code(400).send({ error: 'employee_id обязателен' });
    const q = await db.query(
      'SELECT * FROM employee_rates WHERE employee_id = $1 AND effective_to IS NULL ORDER BY effective_from DESC LIMIT 1',
      [employee_id]
    );
    return { rate: q.rows[0] || null };
  });

  // POST /rates
  fastify.post('/rates', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const user = req.user;
    const b = req.body;
    if (!b.employee_id || !b.day_rate) return reply.code(400).send({ error: 'employee_id и day_rate обязательны' });

    const effectiveFrom = b.effective_from || new Date().toISOString().slice(0, 10);

    // Закрываем предыдущую ставку
    await db.query(`
      UPDATE employee_rates SET effective_to = $1
      WHERE employee_id = $2 AND effective_to IS NULL
    `, [new Date(new Date(effectiveFrom).getTime() - 86400000).toISOString().slice(0, 10), b.employee_id]);

    const q = await db.query(`
      INSERT INTO employee_rates (employee_id, role_tag, day_rate, shift_rate, overtime_rate, effective_from, comment, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [b.employee_id, b.role_tag || null, b.day_rate, b.shift_rate || null,
        b.overtime_rate || null, effectiveFrom, b.comment || null, user.id]);

    // Обновляем day_rate в employees
    await db.query('UPDATE employees SET day_rate = $1 WHERE id = $2', [b.day_rate, b.employee_id]);

    return { rate: q.rows[0] };
  });

  // PUT /rates/:id
  fastify.put('/rates/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { id } = req.params;
    const b = req.body;
    const q = await db.query(`
      UPDATE employee_rates SET
        role_tag = COALESCE($2, role_tag),
        day_rate = COALESCE($3, day_rate),
        shift_rate = COALESCE($4, shift_rate),
        overtime_rate = COALESCE($5, overtime_rate),
        comment = COALESCE($6, comment)
      WHERE id = $1 RETURNING *
    `, [id, b.role_tag, b.day_rate, b.shift_rate, b.overtime_rate, b.comment]);
    if (!q.rows.length) return reply.code(404).send({ error: 'Не найдено' });
    return { rate: q.rows[0] };
  });

  // ═══════════════════════════════════════════════════════════
  // САМОЗАНЯТЫЕ (self-employed)
  // ═══════════════════════════════════════════════════════════

  // GET /self-employed
  fastify.get('/self-employed', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { is_active, search } = req.query;
    let where = [];
    let params = [];
    let idx = 1;

    if (is_active !== undefined) { where.push(`se.is_active = $${idx++}`); params.push(is_active === 'true'); }
    if (search) {
      where.push(`(se.full_name ILIKE $${idx} OR se.inn ILIKE $${idx})`);
      params.push('%' + search + '%');
      idx++;
    }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const q = await db.query(`
      SELECT se.*, e.fio as emp_fio
      FROM self_employed se
      LEFT JOIN employees e ON se.employee_id = e.id
      ${whereClause}
      ORDER BY se.full_name
    `, params);

    return { items: q.rows };
  });

  // POST /self-employed
  fastify.post('/self-employed', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const b = req.body;
    if (!b.full_name || !b.inn) return reply.code(400).send({ error: 'ФИО и ИНН обязательны' });
    if (!/^\d{12}$/.test(b.inn)) return reply.code(400).send({ error: 'ИНН должен содержать 12 цифр' });

    const q = await db.query(`
      INSERT INTO self_employed
        (employee_id, full_name, inn, phone, email, bank_name, bik, corr_account,
         account_number, card_number, npd_status, npd_registered_at,
         contract_number, contract_date, contract_end_date, comment)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING *
    `, [
      b.employee_id || null, b.full_name, b.inn, b.phone || null, b.email || null,
      b.bank_name || null, b.bik || null, b.corr_account || null,
      b.account_number || null, b.card_number || null,
      b.npd_status || 'active', b.npd_registered_at || null,
      b.contract_number || null, b.contract_date || null, b.contract_end_date || null,
      b.comment || null
    ]);

    // Обновляем employees если привязан
    if (b.employee_id) {
      await db.query(
        'UPDATE employees SET is_self_employed = true, inn = $1 WHERE id = $2',
        [b.inn, b.employee_id]
      );
    }

    return { item: q.rows[0] };
  });

  // PUT /self-employed/:id
  fastify.put('/self-employed/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { id } = req.params;
    const b = req.body;
    if (b.inn && !/^\d{12}$/.test(b.inn)) return reply.code(400).send({ error: 'ИНН должен содержать 12 цифр' });

    const q = await db.query(`
      UPDATE self_employed SET
        full_name = COALESCE($2, full_name),
        inn = COALESCE($3, inn),
        phone = COALESCE($4, phone),
        email = COALESCE($5, email),
        bank_name = COALESCE($6, bank_name),
        bik = COALESCE($7, bik),
        corr_account = COALESCE($8, corr_account),
        account_number = COALESCE($9, account_number),
        card_number = COALESCE($10, card_number),
        npd_status = COALESCE($11, npd_status),
        contract_number = COALESCE($12, contract_number),
        contract_date = COALESCE($13, contract_date),
        contract_end_date = COALESCE($14, contract_end_date),
        comment = COALESCE($15, comment),
        is_active = COALESCE($16, is_active),
        updated_at = NOW()
      WHERE id = $1 RETURNING *
    `, [id, b.full_name, b.inn, b.phone, b.email,
        b.bank_name, b.bik, b.corr_account, b.account_number, b.card_number,
        b.npd_status, b.contract_number, b.contract_date, b.contract_end_date,
        b.comment, b.is_active]);

    if (!q.rows.length) return reply.code(404).send({ error: 'Не найдено' });
    return { item: q.rows[0] };
  });

  // GET /self-employed/:id/payments
  fastify.get('/self-employed/:id/payments', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { id } = req.params;
    const seQ = await db.query('SELECT employee_id FROM self_employed WHERE id = $1', [id]);
    if (!seQ.rows.length) return reply.code(404).send({ error: 'Не найдено' });
    const empId = seQ.rows[0].employee_id;

    const payments = await db.query(`
      SELECT pr.amount, pr.payment_type, pr.status, pr.paid_at, pr.created_at,
             ps.title as sheet_title
      FROM payment_registry pr
      LEFT JOIN payroll_sheets ps ON pr.sheet_id = ps.id
      WHERE pr.employee_id = $1
      ORDER BY pr.created_at DESC
    `, [empId]);

    const oneTime = await db.query(`
      SELECT amount, payment_type, status, paid_at, reason, created_at
      FROM one_time_payments WHERE employee_id = $1
      ORDER BY created_at DESC
    `, [empId]);

    const allPayments = [...payments.rows, ...oneTime.rows];
    const totalPaid = allPayments
      .filter(p => p.status === 'paid')
      .reduce((s, p) => s + Number(p.amount), 0);

    return { payments: allPayments, total_paid: totalPaid };
  });

  // ═══════════════════════════════════════════════════════════
  // РАЗОВЫЕ ОПЛАТЫ (one-time)
  // ═══════════════════════════════════════════════════════════

  // GET /one-time
  fastify.get('/one-time', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const user = req.user;
    const { status, work_id, employee_id, payment_type, limit = 50, offset = 0 } = req.query;
    let where = [];
    let params = [];
    let idx = 1;

    if (status) { where.push(`otp.status = $${idx++}`); params.push(status); }
    if (work_id) { where.push(`otp.work_id = $${idx++}`); params.push(work_id); }
    if (employee_id) { where.push(`otp.employee_id = $${idx++}`); params.push(employee_id); }
    if (payment_type) { where.push(`otp.payment_type = $${idx++}`); params.push(payment_type); }

    // PM видит только свои запросы
    if (user.role === 'PM' || user.role === 'HEAD_PM') {
      where.push(`otp.requested_by = $${idx++}`);
      params.push(user.id);
    }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const countQ = await db.query(`SELECT COUNT(*) FROM one_time_payments otp ${whereClause}`, params);

    params.push(Number(limit), Number(offset));
    const q = await db.query(`
      SELECT otp.*, w.work_title, u.name as requester_name
      FROM one_time_payments otp
      LEFT JOIN works w ON otp.work_id = w.id
      LEFT JOIN users u ON otp.requested_by = u.id
      ${whereClause}
      ORDER BY otp.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `, params);

    return { items: q.rows, total: Number(countQ.rows[0].count) };
  });

  // POST /one-time
  fastify.post('/one-time', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const user = req.user;
    const b = req.body;
    if (!b.employee_id || !b.amount || !b.reason) {
      return reply.code(400).send({ error: 'employee_id, amount и reason обязательны' });
    }

    const emp = await db.query('SELECT fio FROM employees WHERE id = $1', [b.employee_id]);
    const empName = emp.rows[0]?.fio || 'Неизвестно';

    const q = await db.query(`
      INSERT INTO one_time_payments
        (employee_id, employee_name, work_id, amount, reason, payment_method,
         payment_type, comment, receipt_url, requested_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `, [b.employee_id, empName, b.work_id || null, b.amount, b.reason,
        b.payment_method || 'card', b.payment_type || 'one_time',
        b.comment || null, b.receipt_url || null, user.id]);

    // Уведомление директорам
    const directors = await db.query(
      `SELECT id FROM users WHERE role IN ('ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV') AND is_active = true`
    );
    for (const dir of directors.rows) {
      await db.query(`
        INSERT INTO notifications (user_id, title, message, type, entity_id, link_hash, is_read, created_at)
        VALUES ($1, 'Запрос разовой оплаты', $2, 'one_time_payment', $3, '#/one-time-pay', false, NOW())
      `, [dir.id, `${user.name} запрашивает ${b.amount} ₽ для ${empName}: ${b.reason}`, q.rows[0].id]);
    }

    return { item: q.rows[0] };
  });

  // PUT /one-time/:id/approve
  fastify.put('/one-time/:id/approve', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const user = req.user;
    if (!hasRole(user, APPROVE_ROLES)) return reply.code(403).send({ error: 'Нет доступа' });

    const { id } = req.params;
    const { director_comment } = req.body || {};

    const check = await db.query('SELECT * FROM one_time_payments WHERE id = $1', [id]);
    if (!check.rows.length) return reply.code(404).send({ error: 'Не найдено' });
    if (check.rows[0].status !== 'pending') return reply.code(400).send({ error: 'Не на согласовании' });

    const q = await db.query(`
      UPDATE one_time_payments SET
        status = 'approved', approved_by = $2, approved_at = NOW(),
        director_comment = $3, updated_at = NOW()
      WHERE id = $1 RETURNING *
    `, [id, user.id, director_comment || null]);

    // Создать запись в payment_registry
    const item = check.rows[0];
    const emp = await db.query('SELECT inn, bank_name, bik, account_number FROM employees WHERE id = $1', [item.employee_id]);
    const empData = emp.rows[0] || {};

    await db.query(`
      INSERT INTO payment_registry
        (employee_id, employee_name, amount, payment_type, payment_method,
         inn, bank_name, bik, account_number, status, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10)
    `, [item.employee_id, item.employee_name, item.amount, item.payment_type,
        item.payment_method, empData.inn, empData.bank_name, empData.bik,
        empData.account_number, user.id]);

    // Уведомление запросившему
    await db.query(`
      INSERT INTO notifications (user_id, title, message, type, entity_id, link_hash, is_read, created_at)
      VALUES ($1, 'Разовая оплата согласована', $2, 'one_time_approved', $3, '#/one-time-pay', false, NOW())
    `, [item.requested_by, `${item.amount} ₽ для ${item.employee_name} — согласовано`, id]);

    return { item: q.rows[0] };
  });

  // PUT /one-time/:id/reject
  fastify.put('/one-time/:id/reject', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const user = req.user;
    if (!hasRole(user, APPROVE_ROLES)) return reply.code(403).send({ error: 'Нет доступа' });

    const { id } = req.params;
    const { director_comment } = req.body;

    const check = await db.query('SELECT * FROM one_time_payments WHERE id = $1', [id]);
    if (!check.rows.length) return reply.code(404).send({ error: 'Не найдено' });
    if (check.rows[0].status !== 'pending') return reply.code(400).send({ error: 'Не на согласовании' });

    const q = await db.query(`
      UPDATE one_time_payments SET
        status = 'rejected', director_comment = $2, updated_at = NOW()
      WHERE id = $1 RETURNING *
    `, [id, director_comment || '']);

    await db.query(`
      INSERT INTO notifications (user_id, title, message, type, entity_id, link_hash, is_read, created_at)
      VALUES ($1, 'Разовая оплата отклонена', $2, 'one_time_rejected', $3, '#/one-time-pay', false, NOW())
    `, [check.rows[0].requested_by, director_comment || 'Отклонено', id]);

    return { item: q.rows[0] };
  });

  // PUT /one-time/:id/pay
  fastify.put('/one-time/:id/pay', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const user = req.user;
    if (!hasRole(user, PAY_ROLES)) return reply.code(403).send({ error: 'Нет доступа' });

    const { id } = req.params;
    const check = await db.query('SELECT status FROM one_time_payments WHERE id = $1', [id]);
    if (!check.rows.length) return reply.code(404).send({ error: 'Не найдено' });
    if (check.rows[0].status !== 'approved') return reply.code(400).send({ error: 'Оплата не согласована' });

    const q = await db.query(`
      UPDATE one_time_payments SET status = 'paid', paid_at = NOW(), updated_at = NOW()
      WHERE id = $1 RETURNING *
    `, [id]);

    return { item: q.rows[0] };
  });

  // ═══════════════════════════════════════════════════════════
  // АНАЛИТИКА (stats)
  // ═══════════════════════════════════════════════════════════

  fastify.get('/stats', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const user = req.user;
    if (!hasRole(user, ['ADMIN', ...DIRECTOR_ROLES, 'BUH'])) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    const { year, month } = req.query;
    const currentYear = year || new Date().getFullYear();

    // Общие итоги
    const totals = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'paid' THEN total_accrued ELSE 0 END), 0) as total_accrued,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN total_payout ELSE 0 END), 0) as total_paid,
        COALESCE(SUM(CASE WHEN status IN ('pending','approved') THEN total_payout ELSE 0 END), 0) as total_pending,
        COUNT(*) as sheets_count
      FROM payroll_sheets
      WHERE EXTRACT(YEAR FROM period_from) = $1
    `, [currentYear]);

    // Уникальные рабочие
    const workersQ = await db.query(`
      SELECT COUNT(DISTINCT pi.employee_id) as cnt
      FROM payroll_items pi
      JOIN payroll_sheets ps ON pi.sheet_id = ps.id
      WHERE EXTRACT(YEAR FROM ps.period_from) = $1
    `, [currentYear]);

    // Средняя ставка
    const avgRate = await db.query(`
      SELECT COALESCE(AVG(day_rate), 0) as avg_rate
      FROM employee_rates WHERE effective_to IS NULL
    `);

    // По месяцам
    const byMonth = await db.query(`
      SELECT
        EXTRACT(MONTH FROM period_from) as month,
        SUM(total_accrued) as accrued,
        SUM(CASE WHEN status = 'paid' THEN total_payout ELSE 0 END) as paid
      FROM payroll_sheets
      WHERE EXTRACT(YEAR FROM period_from) = $1
      GROUP BY EXTRACT(MONTH FROM period_from)
      ORDER BY month
    `, [currentYear]);

    // По работам (топ-10)
    const byWork = await db.query(`
      SELECT ps.work_id, w.work_title, w.customer_name,
        SUM(ps.total_accrued) as accrued,
        SUM(CASE WHEN ps.status = 'paid' THEN ps.total_payout ELSE 0 END) as paid
      FROM payroll_sheets ps
      LEFT JOIN works w ON ps.work_id = w.id
      WHERE ps.work_id IS NOT NULL AND EXTRACT(YEAR FROM ps.period_from) = $1
      GROUP BY ps.work_id, w.work_title, w.customer_name
      ORDER BY accrued DESC LIMIT 10
    `, [currentYear]);

    // Топ работников
    const topWorkers = await db.query(`
      SELECT pi.employee_id, pi.employee_name,
        SUM(pi.payout) as total_earned
      FROM payroll_items pi
      JOIN payroll_sheets ps ON pi.sheet_id = ps.id
      WHERE ps.status = 'paid' AND EXTRACT(YEAR FROM ps.period_from) = $1
      GROUP BY pi.employee_id, pi.employee_name
      ORDER BY total_earned DESC LIMIT 10
    `, [currentYear]);

    return {
      total_accrued: Number(totals.rows[0].total_accrued),
      total_paid: Number(totals.rows[0].total_paid),
      total_pending: Number(totals.rows[0].total_pending),
      sheets_count: Number(totals.rows[0].sheets_count),
      workers_count: Number(workersQ.rows[0].cnt),
      avg_day_rate: Math.round(Number(avgRate.rows[0].avg_rate)),
      by_month: byMonth.rows,
      by_work: byWork.rows,
      top_workers: topWorkers.rows
    };
  });
}

module.exports = routes;
