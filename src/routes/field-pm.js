'use strict';

/**
 * PM Panel API — /api/pm/*
 * Доступ: PM, HEAD_PM, ADMIN
 * PM видит только свои объекты (works.pm_id = user.id)
 * ADMIN видит всё
 */

const MONTH_NAMES = ['', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

async function routes(fastify) {
  const db = fastify.db;
  const auth = { preHandler: [fastify.requireRoles(['PM', 'HEAD_PM', 'ADMIN'])] };

  // Хелпер: получить список work_id для текущего PM
  function pmFilter(user) {
    const isAdmin = user.role === 'ADMIN';
    return { isAdmin, userId: user.id };
  }

  function worksSql(isAdmin, userId) {
    return isAdmin
      ? `SELECT id FROM works WHERE deleted_at IS NULL AND work_status NOT IN ('Закрыта', 'Отменена')`
      : `SELECT id FROM works WHERE pm_id = $1 AND deleted_at IS NULL AND work_status NOT IN ('Закрыта', 'Отменена')`;
  }

  // ═══════════════════════════════════════════════════════════════════
  // GET /dashboard — общая сводка для PM
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/dashboard', auth, async (req) => {
    const { isAdmin, userId } = pmFilter(req.user);
    const workParam = isAdmin ? [] : [userId];

    // Активные проекты
    const { rows: works } = await db.query(
      isAdmin
        ? `SELECT id, work_title, city, work_status FROM works WHERE deleted_at IS NULL AND work_status NOT IN ('Закрыта', 'Отменена') ORDER BY created_at DESC LIMIT 20`
        : `SELECT id, work_title, city, work_status FROM works WHERE pm_id = $1 AND deleted_at IS NULL AND work_status NOT IN ('Закрыта', 'Отменена') ORDER BY created_at DESC LIMIT 20`,
      workParam
    );
    const workIds = works.map(w => w.id);

    if (workIds.length === 0) {
      return {
        works: [],
        metrics: { active_workers: 0, checked_in_today: 0, pending_payments_sum: 0, academy_not_passed: 0 },
      };
    }

    const today = new Date().toISOString().slice(0, 10);

    // Рабочие на активных проектах
    const { rows: [workerStats] } = await db.query(`
      SELECT
        COUNT(DISTINCT ea.employee_id) FILTER (WHERE ea.field_role = 'worker') AS active_workers,
        COUNT(DISTINCT fc.employee_id) FILTER (WHERE fc.date = $2 AND fc.status != 'cancelled') AS checked_in_today
      FROM employee_assignments ea
      LEFT JOIN field_checkins fc ON fc.employee_id = ea.employee_id AND fc.work_id = ea.work_id
      WHERE ea.work_id = ANY($1) AND ea.is_active = true
    `, [workIds, today]);

    // Выплаты в статусе pending
    const { rows: [payStats] } = await db.query(`
      SELECT COALESCE(SUM(amount), 0)::numeric AS pending_sum
      FROM worker_payments
      WHERE work_id = ANY($1) AND status = 'pending'
    `, [workIds]);

    // Непройденные тесты Мимира (текущий опубликованный урок)
    const { rows: [lessonRow] } = await db.query(`
      SELECT id FROM academy_lessons WHERE status = 'published' ORDER BY week_number DESC LIMIT 1
    `);
    let academyNotPassed = 0;
    if (lessonRow) {
      const { rows: [aStats] } = await db.query(`
        SELECT COUNT(*) FILTER (WHERE COALESCE(awp.passed, false) = false) AS not_passed
        FROM employee_assignments ea
        LEFT JOIN academy_worker_progress awp ON awp.employee_id = ea.employee_id AND awp.lesson_id = $2
        WHERE ea.work_id = ANY($1) AND ea.is_active = true AND ea.field_role = 'worker'
      `, [workIds, lessonRow.id]);
      academyNotPassed = parseInt(aStats.not_passed) || 0;
    }

    // Черновик Мимира (pending review)
    const { rows: [draftLesson] } = await db.query(`
      SELECT id, title, cover_icon, week_number, created_at FROM academy_lessons
      WHERE status = 'draft' ORDER BY created_at DESC LIMIT 1
    `);

    return {
      works,
      metrics: {
        active_workers: parseInt(workerStats.active_workers) || 0,
        checked_in_today: parseInt(workerStats.checked_in_today) || 0,
        pending_payments_sum: Math.round(parseFloat(payStats.pending_sum) || 0),
        academy_not_passed: academyNotPassed,
      },
      draft_lesson: draftLesson || null,
    };
  });

  // ═══════════════════════════════════════════════════════════════════
  // GET /works — список проектов PM
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/works', auth, async (req) => {
    const { isAdmin, userId } = pmFilter(req.user);
    const { rows } = await db.query(
      isAdmin
        ? `SELECT w.id, w.work_title, w.city, w.work_status, w.address,
             COUNT(DISTINCT ea.employee_id) FILTER (WHERE ea.field_role='worker' AND ea.is_active) AS worker_count,
             COUNT(DISTINCT ea.employee_id) FILTER (WHERE ea.field_role IN ('shift_master','senior_master') AND ea.is_active) AS master_count
           FROM works w
           LEFT JOIN employee_assignments ea ON ea.work_id = w.id
           WHERE w.deleted_at IS NULL
           GROUP BY w.id ORDER BY w.created_at DESC`
        : `SELECT w.id, w.work_title, w.city, w.work_status, w.address,
             COUNT(DISTINCT ea.employee_id) FILTER (WHERE ea.field_role='worker' AND ea.is_active) AS worker_count,
             COUNT(DISTINCT ea.employee_id) FILTER (WHERE ea.field_role IN ('shift_master','senior_master') AND ea.is_active) AS master_count
           FROM works w
           LEFT JOIN employee_assignments ea ON ea.work_id = w.id
           WHERE w.pm_id = $1 AND w.deleted_at IS NULL
           GROUP BY w.id ORDER BY w.created_at DESC`,
      isAdmin ? [] : [userId]
    );
    return { works: rows };
  });

  // ═══════════════════════════════════════════════════════════════════
  // GET /workers?work_id= — рабочие на проекте с сегодняшним статусом
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/workers', auth, async (req) => {
    const { isAdmin, userId } = pmFilter(req.user);
    const { work_id } = req.query;

    let workIds;
    if (work_id) {
      // Проверка что PM имеет доступ к этому объекту
      const { rows: check } = await db.query(
        isAdmin
          ? `SELECT id FROM works WHERE id = $1 AND deleted_at IS NULL`
          : `SELECT id FROM works WHERE id = $1 AND pm_id = $2 AND deleted_at IS NULL`,
        isAdmin ? [work_id] : [work_id, userId]
      );
      if (!check.length) return fastify.httpErrors.forbidden('Нет доступа к объекту');
      workIds = [parseInt(work_id)];
    } else {
      const { rows } = await db.query(
        isAdmin
          ? `SELECT id FROM works WHERE deleted_at IS NULL AND work_status NOT IN ('Закрыта','Отменена')`
          : `SELECT id FROM works WHERE pm_id = $1 AND deleted_at IS NULL AND work_status NOT IN ('Закрыта','Отменена')`,
        isAdmin ? [] : [userId]
      );
      workIds = rows.map(r => r.id);
    }

    if (!workIds.length) return { workers: [] };

    const today = new Date().toISOString().slice(0, 10);

    const { rows } = await db.query(`
      SELECT
        e.id, e.fio, e.phone, e.city,
        ea.id AS assignment_id, ea.work_id, ea.field_role, ea.shift_type,
        ea.per_diem, ea.is_active, ea.departure_date,
        w.work_title, w.city AS work_city,
        ft.points_per_shift, ft.name AS tariff_name,
        fc.id AS checkin_id, fc.status AS checkin_status, fc.shift AS checkin_shift,
        fc.checkin_at, fc.checkout_at, fc.amount_earned,
        gw.balance AS xp,
        awp.passed AS lesson_passed
      FROM employee_assignments ea
      JOIN employees e ON e.id = ea.employee_id
      JOIN works w ON w.id = ea.work_id
      LEFT JOIN field_tariff_grid ft ON ft.id = ea.tariff_id
      LEFT JOIN field_checkins fc ON fc.employee_id = ea.employee_id
        AND fc.work_id = ea.work_id AND fc.date = $2 AND fc.status != 'cancelled'
      LEFT JOIN gamification_wallets gw ON gw.employee_id = e.id AND gw.currency = 'xp'
      LEFT JOIN (
        SELECT awp2.employee_id, awp2.passed FROM academy_worker_progress awp2
        WHERE awp2.lesson_id = (SELECT id FROM academy_lessons WHERE status='published' ORDER BY week_number DESC LIMIT 1)
      ) awp ON awp.employee_id = e.id
      WHERE ea.work_id = ANY($1) AND ea.is_active = true
      ORDER BY ea.field_role DESC, e.fio ASC
    `, [workIds, today]);

    return { workers: rows };
  });

  // ═══════════════════════════════════════════════════════════════════
  // GET /workers/:id — профиль рабочего
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/workers/:id', auth, async (req) => {
    const { isAdmin, userId } = pmFilter(req.user);
    const empId = parseInt(req.params.id);

    // Проверка доступа: рабочий должен быть на проекте PM
    const { rows: accessCheck } = await db.query(
      isAdmin
        ? `SELECT ea.id FROM employee_assignments ea WHERE ea.employee_id = $1 AND ea.is_active = true LIMIT 1`
        : `SELECT ea.id FROM employee_assignments ea
           JOIN works w ON w.id = ea.work_id
           WHERE ea.employee_id = $1 AND w.pm_id = $2 AND ea.is_active = true LIMIT 1`,
      isAdmin ? [empId] : [empId, userId]
    );
    if (!accessCheck.length) return req.server.httpErrors.notFound('Рабочий не найден');

    const [empRes, assignRes, shiftsRes, paymentsRes, achRes, academyRes, spinRes] = await Promise.all([
      // Данные сотрудника
      db.query(`
        SELECT e.id, e.fio, e.phone, e.city, e.grade, e.rating_avg, e.rating_count,
          e.clothing_size, e.shoe_size, e.active_badge, e.active_frame,
          apb.points_balance AS achievement_points, apb.points_earned_total,
          gw_xp.balance AS xp, gw_runes.balance AS runes, gw_silver.balance AS silver
        FROM employees e
        LEFT JOIN achievement_points_balance apb ON apb.employee_id = e.id
        LEFT JOIN gamification_wallets gw_xp ON gw_xp.employee_id = e.id AND gw_xp.currency = 'xp'
        LEFT JOIN gamification_wallets gw_runes ON gw_runes.employee_id = e.id AND gw_runes.currency = 'runes'
        LEFT JOIN gamification_wallets gw_silver ON gw_silver.employee_id = e.id AND gw_silver.currency = 'silver'
        WHERE e.id = $1
      `, [empId]),

      // Назначения (проекты)
      db.query(`
        SELECT ea.id, ea.work_id, ea.field_role, ea.shift_type, ea.per_diem, ea.is_active,
          ea.date_from, ea.date_to, ea.departure_date, ea.departure_reason,
          w.work_title, w.city, w.work_status,
          ft.name AS tariff_name, ft.points_per_shift
        FROM employee_assignments ea
        JOIN works w ON w.id = ea.work_id
        LEFT JOIN field_tariff_grid ft ON ft.id = ea.tariff_id
        WHERE ea.employee_id = $1
        ORDER BY ea.is_active DESC, ea.date_from DESC NULLS LAST
      `, [empId]),

      // Последние 60 смен
      db.query(`
        SELECT fc.id, fc.date, fc.shift, fc.status, fc.amount_earned, fc.hours_worked,
          fc.checkin_at, fc.checkout_at, fc.day_rate, w.work_title
        FROM field_checkins fc
        JOIN works w ON w.id = fc.work_id
        WHERE fc.employee_id = $1
        ORDER BY fc.date DESC LIMIT 60
      `, [empId]),

      // Последние выплаты (3 месяца)
      db.query(`
        SELECT wp.id, wp.type, wp.amount, wp.pay_month, wp.pay_year, wp.status,
          wp.comment, wp.created_at, wp.paid_at, u.name AS paid_by_name,
          w.work_title
        FROM worker_payments wp
        LEFT JOIN users u ON u.id = wp.paid_by
        LEFT JOIN works w ON w.id = wp.work_id
        WHERE wp.employee_id = $1
        ORDER BY wp.created_at DESC LIMIT 50
      `, [empId]),

      // Достижения
      db.query(`
        SELECT ea.achievement_id, ea.earned_at, wa.name, wa.description, wa.icon, wa.rarity
        FROM employee_achievements ea
        JOIN worker_achievements wa ON wa.id = ea.achievement_id
        WHERE ea.employee_id = $1
        ORDER BY ea.earned_at DESC LIMIT 20
      `, [empId]),

      // Прогресс в академии
      db.query(`
        SELECT awp.lesson_id, awp.passed, awp.score, awp.attempts, awp.passed_at,
          awp.runes_earned, awp.xp_earned, al.title, al.cover_icon, al.week_number
        FROM academy_worker_progress awp
        JOIN academy_lessons al ON al.id = awp.lesson_id
        WHERE awp.employee_id = $1
        ORDER BY al.week_number DESC LIMIT 20
      `, [empId]),

      // Последние призы (колесо)
      db.query(`
        SELECT gs.prize_name, gs.prize_tier, gs.prize_value, gs.spin_at
        FROM gamification_spins gs
        WHERE gs.employee_id = $1
        ORDER BY gs.spin_at DESC LIMIT 10
      `, [empId]),
    ]);

    const emp = empRes.rows[0];
    if (!emp) return req.server.httpErrors.notFound();

    return {
      employee: emp,
      assignments: assignRes.rows,
      shifts: shiftsRes.rows,
      payments: paymentsRes.rows,
      achievements: achRes.rows,
      academy: academyRes.rows,
      spins: spinRes.rows,
    };
  });

  // ═══════════════════════════════════════════════════════════════════
  // GET /timesheet?work_id=&year=&month=
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/timesheet', auth, async (req) => {
    const { isAdmin, userId } = pmFilter(req.user);
    const now = new Date();
    const year  = parseInt(req.query.year)  || now.getFullYear();
    const month = parseInt(req.query.month) || (now.getMonth() + 1);
    const workId = req.query.work_id ? parseInt(req.query.work_id) : null;

    // Получаем work_ids PM
    let workIds;
    if (workId) {
      const { rows: check } = await db.query(
        isAdmin ? `SELECT id FROM works WHERE id=$1` : `SELECT id FROM works WHERE id=$1 AND pm_id=$2`,
        isAdmin ? [workId] : [workId, userId]
      );
      if (!check.length) return fastify.httpErrors.forbidden();
      workIds = [workId];
    } else {
      const { rows } = await db.query(
        isAdmin
          ? `SELECT id FROM works WHERE deleted_at IS NULL`
          : `SELECT id FROM works WHERE pm_id=$1 AND deleted_at IS NULL`,
        isAdmin ? [] : [userId]
      );
      workIds = rows.map(r => r.id);
    }
    if (!workIds.length) return { workers: [], days: [], year, month };

    // Дни месяца
    const daysInMonth = new Date(year, month, 0).getDate();
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

    // Рабочие
    const { rows: workers } = await db.query(`
      SELECT DISTINCT ON (e.id) e.id, e.fio, ea.field_role, ea.work_id,
        w.work_title
      FROM employee_assignments ea
      JOIN employees e ON e.id = ea.employee_id
      JOIN works w ON w.id = ea.work_id
      WHERE ea.work_id = ANY($1) AND ea.is_active = true AND ea.field_role = 'worker'
      ORDER BY e.id, ea.is_active DESC
    `, [workIds]);

    if (!workers.length) return { workers: [], days, year, month, month_name: MONTH_NAMES[month] };

    const empIds = workers.map(w => w.id);

    // Чекины за месяц
    const { rows: checkins } = await db.query(`
      SELECT fc.id, fc.employee_id, fc.work_id, fc.date,
        EXTRACT(DAY FROM fc.date)::int AS day,
        fc.shift, fc.status, fc.amount_earned, fc.hours_worked, fc.day_rate,
        fc.checkin_at, fc.checkout_at
      FROM field_checkins fc
      WHERE fc.employee_id = ANY($1)
        AND fc.work_id = ANY($2)
        AND EXTRACT(YEAR FROM fc.date) = $3
        AND EXTRACT(MONTH FROM fc.date) = $4
        AND fc.status != 'cancelled'
      ORDER BY fc.date
    `, [empIds, workIds, year, month]);

    // Строим map: empId → {day → checkin}
    const checkinMap = {};
    for (const c of checkins) {
      if (!checkinMap[c.employee_id]) checkinMap[c.employee_id] = {};
      checkinMap[c.employee_id][c.day] = c;
    }

    const rows = workers.map(w => ({
      ...w,
      checkins: checkinMap[w.id] || {},
      total_shifts: Object.keys(checkinMap[w.id] || {}).length,
      total_earned: Object.values(checkinMap[w.id] || {}).reduce((s, c) => s + parseFloat(c.amount_earned || 0), 0),
    }));

    return { workers: rows, days, year, month, month_name: MONTH_NAMES[month] };
  });

  // ═══════════════════════════════════════════════════════════════════
  // POST /timesheet — добавить смену вручную
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/timesheet', auth, async (req, reply) => {
    const { isAdmin, userId } = pmFilter(req.user);
    const { employee_id, work_id, date, shift = 'day', amount_earned, day_rate, hours_worked = 8, note } = req.body;

    if (!employee_id || !work_id || !date) {
      return reply.code(400).send({ error: 'employee_id, work_id, date обязательны' });
    }

    // Проверка доступа PM к объекту
    const { rows: check } = await db.query(
      isAdmin ? `SELECT id FROM works WHERE id=$1` : `SELECT id FROM works WHERE id=$1 AND pm_id=$2`,
      isAdmin ? [work_id] : [work_id, userId]
    );
    if (!check.length) return reply.code(403).send({ error: 'Нет доступа к объекту' });

    // Найти активное назначение
    const { rows: [assignment] } = await db.query(`
      SELECT id, tariff_id, per_diem FROM employee_assignments
      WHERE employee_id = $1 AND work_id = $2 AND is_active = true LIMIT 1
    `, [employee_id, work_id]);
    if (!assignment) return reply.code(400).send({ error: 'Рабочий не назначен на этот объект' });

    const finalRate = day_rate || 0;
    const finalEarned = amount_earned || 0;

    const { rows: [checkin] } = await db.query(`
      INSERT INTO field_checkins
        (employee_id, work_id, assignment_id, date, shift, status,
         hours_worked, hours_paid, day_rate, amount_earned, note,
         checkin_at, checkin_source, checkin_by)
      VALUES ($1,$2,$3,$4,$5,'completed',$6,$6,$7,$8,$9,
              ($4::date + TIME '08:00')::timestamp,
              'pm_manual', $10)
      RETURNING *
    `, [employee_id, work_id, assignment.id, date, shift,
        hours_worked, finalRate, finalEarned, note || null, req.user.id]);

    return reply.code(201).send({ checkin });
  });

  // ═══════════════════════════════════════════════════════════════════
  // PUT /timesheet/:id — редактировать смену
  // ═══════════════════════════════════════════════════════════════════
  fastify.put('/timesheet/:id', auth, async (req, reply) => {
    const { isAdmin, userId } = pmFilter(req.user);
    const checkinId = parseInt(req.params.id);
    const { amount_earned, hours_worked, day_rate, shift, note } = req.body;

    // Проверка доступа
    const { rows: [existing] } = await db.query(`
      SELECT fc.*, w.pm_id FROM field_checkins fc JOIN works w ON w.id = fc.work_id WHERE fc.id = $1
    `, [checkinId]);
    if (!existing) return reply.code(404).send({ error: 'Смена не найдена' });
    if (!isAdmin && existing.pm_id !== userId) return reply.code(403).send({ error: 'Нет доступа' });

    const { rows: [updated] } = await db.query(`
      UPDATE field_checkins SET
        amount_earned = COALESCE($2, amount_earned),
        hours_worked  = COALESCE($3, hours_worked),
        day_rate      = COALESCE($4, day_rate),
        shift         = COALESCE($5, shift),
        note          = COALESCE($6, note),
        updated_at    = NOW()
      WHERE id = $1
      RETURNING *
    `, [checkinId, amount_earned, hours_worked, day_rate, shift, note]);

    return { checkin: updated };
  });

  // ═══════════════════════════════════════════════════════════════════
  // DELETE /timesheet/:id — отменить смену
  // ═══════════════════════════════════════════════════════════════════
  fastify.delete('/timesheet/:id', auth, async (req, reply) => {
    const { isAdmin, userId } = pmFilter(req.user);
    const checkinId = parseInt(req.params.id);

    const { rows: [existing] } = await db.query(`
      SELECT fc.*, w.pm_id FROM field_checkins fc JOIN works w ON w.id = fc.work_id WHERE fc.id = $1
    `, [checkinId]);
    if (!existing) return reply.code(404).send({ error: 'Смена не найдена' });
    if (!isAdmin && existing.pm_id !== userId) return reply.code(403).send({ error: 'Нет доступа' });

    await db.query(
      `UPDATE field_checkins SET status='cancelled', updated_at=NOW() WHERE id=$1`,
      [checkinId]
    );
    return { ok: true };
  });

  // ═══════════════════════════════════════════════════════════════════
  // GET /payments?work_id=&status=&month=&year=
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/payments', auth, async (req) => {
    const { isAdmin, userId } = pmFilter(req.user);
    const { work_id, status, month, year } = req.query;

    let workIds;
    if (work_id) {
      const { rows: check } = await db.query(
        isAdmin ? `SELECT id FROM works WHERE id=$1` : `SELECT id FROM works WHERE id=$1 AND pm_id=$2`,
        isAdmin ? [work_id] : [work_id, userId]
      );
      if (!check.length) return fastify.httpErrors.forbidden();
      workIds = [parseInt(work_id)];
    } else {
      const { rows } = await db.query(
        isAdmin
          ? `SELECT id FROM works WHERE deleted_at IS NULL`
          : `SELECT id FROM works WHERE pm_id=$1 AND deleted_at IS NULL`,
        isAdmin ? [] : [userId]
      );
      workIds = rows.map(r => r.id);
    }
    if (!workIds.length) return { payments: [] };

    const conditions = ['wp.work_id = ANY($1)'];
    const params = [workIds];
    let idx = 2;
    if (status) { conditions.push(`wp.status = $${idx++}`); params.push(status); }
    if (month)  { conditions.push(`wp.pay_month = $${idx++}`); params.push(parseInt(month)); }
    if (year)   { conditions.push(`wp.pay_year = $${idx++}`);  params.push(parseInt(year)); }

    const { rows } = await db.query(`
      SELECT wp.*, e.fio, e.phone, w.work_title,
        u.name AS created_by_name, pu.name AS paid_by_name
      FROM worker_payments wp
      JOIN employees e ON e.id = wp.employee_id
      LEFT JOIN works w ON w.id = wp.work_id
      LEFT JOIN users u ON u.id = wp.created_by
      LEFT JOIN users pu ON pu.id = wp.paid_by
      WHERE ${conditions.join(' AND ')}
      ORDER BY wp.created_at DESC
      LIMIT 200
    `, params);

    // Сумма по статусам
    const summary = rows.reduce((acc, p) => {
      acc[p.status] = (acc[p.status] || 0) + parseFloat(p.amount);
      return acc;
    }, {});

    return { payments: rows, summary };
  });

  // ═══════════════════════════════════════════════════════════════════
  // POST /payments — создать выплату
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/payments', auth, async (req, reply) => {
    const { isAdmin, userId } = pmFilter(req.user);
    const { employee_id, work_id, type, amount, pay_month, pay_year, comment, payment_method = 'transfer' } = req.body;

    if (!employee_id || !work_id || !type || !amount) {
      return reply.code(400).send({ error: 'employee_id, work_id, type, amount обязательны' });
    }

    const validTypes = ['per_diem', 'salary', 'advance', 'bonus', 'penalty'];
    if (!validTypes.includes(type)) return reply.code(400).send({ error: 'Недопустимый тип выплаты' });
    if (parseFloat(amount) <= 0) return reply.code(400).send({ error: 'Сумма должна быть положительной' });

    const { rows: check } = await db.query(
      isAdmin ? `SELECT id FROM works WHERE id=$1` : `SELECT id FROM works WHERE id=$1 AND pm_id=$2`,
      isAdmin ? [work_id] : [work_id, userId]
    );
    if (!check.length) return reply.code(403).send({ error: 'Нет доступа к объекту' });

    const now = new Date();
    const { rows: [payment] } = await db.query(`
      INSERT INTO worker_payments
        (employee_id, work_id, type, amount, pay_month, pay_year,
         comment, payment_method, status, created_by, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,NOW())
      RETURNING *
    `, [
      employee_id, work_id, type, parseFloat(amount),
      pay_month || (now.getMonth() + 1),
      pay_year  || now.getFullYear(),
      comment || null, payment_method, req.user.id,
    ]);

    return reply.code(201).send({ payment });
  });

  // ═══════════════════════════════════════════════════════════════════
  // PUT /payments/:id/paid — отметить как выплачено
  // ═══════════════════════════════════════════════════════════════════
  fastify.put('/payments/:id/paid', auth, async (req, reply) => {
    const { isAdmin, userId } = pmFilter(req.user);
    const payId = parseInt(req.params.id);
    const { payment_method } = req.body || {};

    const { rows: [existing] } = await db.query(`
      SELECT wp.*, w.pm_id FROM worker_payments wp
      JOIN works w ON w.id = wp.work_id WHERE wp.id = $1
    `, [payId]);
    if (!existing) return reply.code(404).send({ error: 'Выплата не найдена' });
    if (!isAdmin && existing.pm_id !== userId) return reply.code(403).send({ error: 'Нет доступа' });

    const { rows: [updated] } = await db.query(`
      UPDATE worker_payments SET
        status = 'paid', paid_at = NOW(), paid_by = $2,
        payment_method = COALESCE($3, payment_method),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [payId, req.user.id, payment_method || null]);

    return { payment: updated };
  });

  // ═══════════════════════════════════════════════════════════════════
  // DELETE /payments/:id — отменить выплату
  // ═══════════════════════════════════════════════════════════════════
  fastify.delete('/payments/:id', auth, async (req, reply) => {
    const { isAdmin, userId } = pmFilter(req.user);
    const payId = parseInt(req.params.id);

    const { rows: [existing] } = await db.query(`
      SELECT wp.*, w.pm_id FROM worker_payments wp
      JOIN works w ON w.id = wp.work_id WHERE wp.id = $1
    `, [payId]);
    if (!existing) return reply.code(404).send({ error: 'Выплата не найдена' });
    if (!isAdmin && existing.pm_id !== userId) return reply.code(403).send({ error: 'Нет доступа' });
    if (existing.status === 'paid') return reply.code(400).send({ error: 'Нельзя отменить уже выплаченную' });

    await db.query(`UPDATE worker_payments SET status='cancelled', updated_at=NOW() WHERE id=$1`, [payId]);
    return { ok: true };
  });

  // ═══════════════════════════════════════════════════════════════════
  // GET /academy — управление Мимиром
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/academy', auth, async (req) => {
    const { isAdmin, userId } = pmFilter(req.user);
    const workParam = isAdmin ? [] : [userId];

    // Черновики на проверку
    const { rows: drafts } = await db.query(`
      SELECT id, title, cover_icon, cover_color, week_number, estimated_minutes,
        tags, status, generated_by, created_at,
        (SELECT COUNT(*) FROM academy_quiz_questions WHERE lesson_id = academy_lessons.id) AS quiz_count
      FROM academy_lessons WHERE status = 'draft' ORDER BY created_at DESC
    `);

    // Текущий опубликованный урок + статистика прохождения
    const { rows: [currentLesson] } = await db.query(`
      SELECT id, title, cover_icon, week_number, published_at FROM academy_lessons
      WHERE status = 'published' ORDER BY week_number DESC LIMIT 1
    `);

    let progressStats = null;
    if (currentLesson) {
      // work_ids для PM
      const { rows: works } = await db.query(
        isAdmin
          ? `SELECT id FROM works WHERE deleted_at IS NULL AND work_status NOT IN ('Закрыта','Отменена')`
          : `SELECT id FROM works WHERE pm_id=$1 AND deleted_at IS NULL AND work_status NOT IN ('Закрыта','Отменена')`,
        workParam
      );
      const workIds = works.map(w => w.id);

      if (workIds.length) {
        const { rows: [stats] } = await db.query(`
          SELECT
            COUNT(DISTINCT ea.employee_id) AS total_workers,
            COUNT(DISTINCT CASE WHEN awp.passed THEN awp.employee_id END) AS passed,
            COUNT(DISTINCT CASE WHEN awp.read_completed_at IS NOT NULL AND NOT awp.passed THEN awp.employee_id END) AS reading,
            COUNT(DISTINCT CASE WHEN awp.employee_id IS NULL THEN ea.employee_id END) AS not_started
          FROM employee_assignments ea
          LEFT JOIN academy_worker_progress awp ON awp.employee_id = ea.employee_id AND awp.lesson_id = $2
          WHERE ea.work_id = ANY($1) AND ea.is_active = true AND ea.field_role = 'worker'
        `, [workIds, currentLesson.id]);

        // Список кто прошёл / нет
        const { rows: workerProgress } = await db.query(`
          SELECT e.id, e.fio, awp.passed, awp.score, awp.attempts, awp.passed_at, awp.blocked_until
          FROM employee_assignments ea
          JOIN employees e ON e.id = ea.employee_id
          LEFT JOIN academy_worker_progress awp ON awp.employee_id = ea.employee_id AND awp.lesson_id = $2
          WHERE ea.work_id = ANY($1) AND ea.is_active = true AND ea.field_role = 'worker'
          ORDER BY awp.passed DESC NULLS LAST, e.fio
        `, [workIds, currentLesson.id]);

        progressStats = { ...stats, workers: workerProgress };
      }
    }

    // Последние 5 опубликованных уроков
    const { rows: published } = await db.query(`
      SELECT id, title, cover_icon, week_number, published_at,
        (SELECT COUNT(*) FROM academy_worker_progress WHERE lesson_id=academy_lessons.id AND passed) AS passed_count
      FROM academy_lessons WHERE status='published' ORDER BY week_number DESC LIMIT 5
    `);

    return { drafts, current_lesson: currentLesson, progress: progressStats, published };
  });

  // ═══════════════════════════════════════════════════════════════════
  // GET /academy/lesson/:id — детальный просмотр урока
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/academy/lesson/:id', auth, async (req) => {
    const { rows: [lesson] } = await db.query(`
      SELECT * FROM academy_lessons WHERE id = $1
    `, [req.params.id]);
    if (!lesson) return req.server.httpErrors.notFound();

    const { rows: questions } = await db.query(`
      SELECT * FROM academy_quiz_questions WHERE lesson_id = $1 ORDER BY order_index
    `, [lesson.id]);

    return { lesson, questions };
  });

  // ═══════════════════════════════════════════════════════════════════
  // POST /academy/:id/approve — опубликовать урок
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/academy/:id/approve', auth, async (req, reply) => {
    const lessonId = parseInt(req.params.id);

    const { rows: [lesson] } = await db.query(
      `SELECT * FROM academy_lessons WHERE id = $1`, [lessonId]
    );
    if (!lesson) return reply.code(404).send({ error: 'Урок не найден' });
    if (lesson.status !== 'draft') return reply.code(400).send({ error: 'Урок не является черновиком' });

    // Проверка что есть хотя бы 1 вопрос
    const { rows: [qCount] } = await db.query(
      `SELECT COUNT(*) AS cnt FROM academy_quiz_questions WHERE lesson_id = $1`, [lessonId]
    );
    if (parseInt(qCount.cnt) === 0) return reply.code(400).send({ error: 'Нельзя опубликовать урок без вопросов' });

    const { rows: [updated] } = await db.query(`
      UPDATE academy_lessons SET status='published', published_at=NOW() WHERE id=$1 RETURNING id, title, status, published_at
    `, [lessonId]);

    return { lesson: updated };
  });

  // ═══════════════════════════════════════════════════════════════════
  // POST /academy/:id/reject — вернуть на доработку
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/academy/:id/reject', auth, async (req, reply) => {
    const lessonId = parseInt(req.params.id);
    const { comment } = req.body || {};

    const { rows: [lesson] } = await db.query(
      `SELECT * FROM academy_lessons WHERE id = $1`, [lessonId]
    );
    if (!lesson) return reply.code(404).send({ error: 'Урок не найден' });

    // Помечаем как archived (отклонён) — статус 'draft' уже был
    // Добавляем комментарий в поле тегов/мета чтобы Мимир видел
    await db.query(`
      UPDATE academy_lessons SET
        status = 'archived',
        tags = array_append(COALESCE(tags, '{}'), $2),
        published_at = NULL
      WHERE id = $1
    `, [lessonId, comment ? `rejected:${comment.slice(0, 100)}` : 'rejected']);

    return { ok: true, message: 'Урок отклонён, Мимир создаст новый' };
  });

  // ═══════════════════════════════════════════════════════════════════
  // GET /workers/:id/assignments — назначения рабочего
  // PUT /workers/:id/assignments/:aid — изменить назначение
  // POST /workers/:id/remove — убрать с объекта (departure)
  // ═══════════════════════════════════════════════════════════════════
  fastify.put('/workers/:id/assignments/:aid', auth, async (req, reply) => {
    const { isAdmin, userId } = pmFilter(req.user);
    const empId = parseInt(req.params.id);
    const aidId = parseInt(req.params.aid);
    const { shift_type, per_diem, tariff_id } = req.body;

    const { rows: [assignment] } = await db.query(`
      SELECT ea.*, w.pm_id FROM employee_assignments ea
      JOIN works w ON w.id = ea.work_id WHERE ea.id = $1 AND ea.employee_id = $2
    `, [aidId, empId]);
    if (!assignment) return reply.code(404).send({ error: 'Назначение не найдено' });
    if (!isAdmin && assignment.pm_id !== userId) return reply.code(403).send({ error: 'Нет доступа' });

    const { rows: [updated] } = await db.query(`
      UPDATE employee_assignments SET
        shift_type = COALESCE($3, shift_type),
        per_diem   = COALESCE($4, per_diem),
        tariff_id  = COALESCE($5, tariff_id),
        updated_at = NOW()
      WHERE id = $1 AND employee_id = $2
      RETURNING *
    `, [aidId, empId, shift_type, per_diem, tariff_id]);

    return { assignment: updated };
  });

  fastify.post('/workers/:id/remove', auth, async (req, reply) => {
    const { isAdmin, userId } = pmFilter(req.user);
    const empId = parseInt(req.params.id);
    const { work_id, departure_date, departure_reason } = req.body;

    if (!work_id) return reply.code(400).send({ error: 'work_id обязателен' });

    const { rows: check } = await db.query(
      isAdmin ? `SELECT id FROM works WHERE id=$1` : `SELECT id FROM works WHERE id=$1 AND pm_id=$2`,
      isAdmin ? [work_id] : [work_id, userId]
    );
    if (!check.length) return reply.code(403).send({ error: 'Нет доступа' });

    const date = departure_date || new Date().toISOString().slice(0, 10);

    await db.query(`
      UPDATE employee_assignments SET
        is_active = false, departure_date = $3, departure_reason = $4, updated_at = NOW()
      WHERE employee_id = $1 AND work_id = $2 AND is_active = true
    `, [empId, work_id, date, departure_reason || 'Убран РП']);

    return { ok: true };
  });
}

module.exports = routes;
