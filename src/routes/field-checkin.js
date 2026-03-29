/**
 * ASGARD Field — Checkin/Checkout API
 * ═══════════════════════════════════════════════════════════════════════════
 * POST /         — checkin (start shift)
 * POST /checkout — checkout (end shift)
 * POST /manual   — manual checkin by master
 * GET  /today    — today's checkins for project (master/PM)
 */

const FIELD_QUOTES_SHIFT_START = [
  'Slavnoj smeny, voin! Valhalla gorditsya toboj',
  'V boj! Pust etot den budet legendoj',
  'Nadevaj kasku — segodnya my tvorim istoriyu',
  'Shchit podnyat, mech natochon — smena nachalas!',
  'Ty na peredovoj. Asgard za tvoej spinoj',
  'Vremya pokazat, iz chego sdelany voiny!',
  'Runy udachi nachertany. Vperyod!',
  'Bitva za kachestvo nachinaetsya. Ne podvedi!',
];

const FIELD_QUOTES_SHIFT_END = [
  'Dostojnaya bitva! Otdykhaj — ty zasluzhil',
  'Smena okonchena. Skaldy spoyut o tvoikh delakh',
  '{hours}ch na postu — nastoyashchij berserk!',
  'Shchit opushchen. Zavtra — novyj podvig',
  'Molot polozhen. Vosstanavlivaj sily, voin',
  'Odin vidit tvoi trudy. Pokoj zasluzhon',
  'Eshchyo odin den v kopilku slavy!',
  'Rabochij den — pozadi. Rog myoda — vperedi!',
];

function randomQuote(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function roundHours(hours, rule, step) {
  if (!step || step <= 0) step = 0.5;
  if (rule === 'none') return hours;
  const method = rule === 'ceil' ? 'ceil' : rule === 'floor' ? 'floor' : 'round';
  const rounded = Math[method](hours / step) * step;
  return Math.max(0, rounded);
}

async function routes(fastify, options) {
  const db = fastify.db;
  const auth = { preHandler: [fastify.fieldAuthenticate] };

  // Helper: get day_rate from tariff grid
  async function getDayRate(empId, workId) {
    const { rows } = await db.query(`
      SELECT ea.tariff_id, ea.combination_tariff_id,
             tg.rate_per_shift as base_rate,
             ctg.rate_per_shift as combo_rate
      FROM employee_assignments ea
      LEFT JOIN field_tariff_grid tg ON tg.id = ea.tariff_id
      LEFT JOIN field_tariff_grid ctg ON ctg.id = ea.combination_tariff_id
      WHERE ea.employee_id = $1 AND ea.work_id = $2 AND ea.is_active = true
      LIMIT 1
    `, [empId, workId]);

    if (rows.length > 0 && rows[0].base_rate) {
      return parseFloat(rows[0].base_rate) + parseFloat(rows[0].combo_rate || 0);
    }

    // Fallback: employees.day_rate
    const { rows: empRows } = await db.query(
      `SELECT day_rate FROM employees WHERE id = $1`,
      [empId]
    );
    return parseFloat(empRows[0]?.day_rate || 0);
  }

  // Helper: get project settings
  async function getProjectSettings(workId) {
    const { rows } = await db.query(
      `SELECT shift_hours, rounding_rule, rounding_step, schedule_type
       FROM field_project_settings WHERE work_id = $1`,
      [workId]
    );
    return rows[0] || { shift_hours: 11, rounding_rule: 'half_up', rounding_step: 0.5, schedule_type: 'shift' };
  }

  // ─────────────────────────────────────────────────────────────────────
  // POST / — checkin (start shift)
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/', auth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const { work_id, lat, lng, accuracy, note } = req.body || {};

      if (!work_id) {
        return reply.code(400).send({ error: 'Укажите work_id' });
      }

      // Check assignment exists and is active
      const { rows: assignments } = await db.query(`
        SELECT id, field_role FROM employee_assignments
        WHERE employee_id = $1 AND work_id = $2 AND is_active = true
        LIMIT 1
      `, [empId, work_id]);

      if (assignments.length === 0) {
        return reply.code(403).send({ error: 'Нет активно��о назначения на этот проект' });
      }

      const assignmentId = assignments[0].id;

      // Check no active checkin today
      const { rows: existing } = await db.query(
        `SELECT id FROM field_checkins WHERE employee_id = $1 AND work_id = $2 AND date = CURRENT_DATE AND status = 'active' LIMIT 1`,
        [empId, work_id]
      );

      if (existing.length > 0) {
        return reply.code(409).send({ error: 'Вы уже отметились сегодня' });
      }

      // Get day_rate
      const dayRate = await getDayRate(empId, work_id);

      // Insert checkin
      const { rows: inserted } = await db.query(`
        INSERT INTO field_checkins (employee_id, work_id, assignment_id, checkin_at,
          checkin_lat, checkin_lng, checkin_accuracy, checkin_source, date, day_rate, note)
        VALUES ($1, $2, $3, NOW(), $4, $5, $6, 'self', CURRENT_DATE, $7, $8)
        RETURNING id, checkin_at
      `, [empId, work_id, assignmentId, lat || null, lng || null, accuracy || null, dayRate, note || null]);

      const checkin = inserted[0];

      return {
        checkin_id: checkin.id,
        checkin_at: checkin.checkin_at,
        day_rate: dayRate,
        quote: randomQuote(FIELD_QUOTES_SHIFT_START),
      };
    } catch (err) {
      fastify.log.error('[field-checkin] POST / error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /checkout — end shift
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/checkout', auth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const { checkin_id, lat, lng, accuracy, note } = req.body || {};

      if (!checkin_id) {
        return reply.code(400).send({ error: 'Укажите checkin_id' });
      }

      // Find checkin
      const { rows: checkins } = await db.query(
        `SELECT id, employee_id, work_id, checkin_at, day_rate, status FROM field_checkins WHERE id = $1`,
        [checkin_id]
      );

      if (checkins.length === 0) {
        return reply.code(404).send({ error: 'Чекин не найден' });
      }

      const checkin = checkins[0];

      if (checkin.employee_id !== empId) {
        return reply.code(403).send({ error: 'Это не ваш чекин' });
      }

      if (checkin.status !== 'active') {
        return reply.code(409).send({ error: 'Сме��а уже завершена' });
      }

      // Calculate hours
      const settings = await getProjectSettings(checkin.work_id);
      const checkoutAt = new Date();
      const checkinAt = new Date(checkin.checkin_at);
      const hoursWorked = (checkoutAt - checkinAt) / (1000 * 60 * 60);
      const hoursPaid = roundHours(hoursWorked, settings.rounding_rule, parseFloat(settings.rounding_step));
      const shiftHours = parseFloat(settings.shift_hours || 11);
      const dayRate = parseFloat(checkin.day_rate || 0);
      const amountEarned = shiftHours > 0 ? (hoursPaid / shiftHours) * dayRate : 0;

      // Update checkin
      await db.query(`
        UPDATE field_checkins SET
          checkout_at = NOW(), checkout_lat = $2, checkout_lng = $3, checkout_accuracy = $4,
          checkout_source = 'self', hours_worked = $5, hours_paid = $6,
          amount_earned = $7, status = 'completed', updated_at = NOW(), note = COALESCE($8, note)
        WHERE id = $1
      `, [checkin_id, lat || null, lng || null, accuracy || null,
          Math.round(hoursWorked * 100) / 100, hoursPaid,
          Math.round(amountEarned * 100) / 100, note || null]);

      const quote = randomQuote(FIELD_QUOTES_SHIFT_END)
        .replace('{hours}', Math.floor(hoursWorked));

      return {
        hours_worked: Math.round(hoursWorked * 100) / 100,
        hours_paid: hoursPaid,
        amount_earned: Math.round(amountEarned * 100) / 100,
        quote,
      };
    } catch (err) {
      fastify.log.error('[field-checkin] /checkout error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /manual — master manually checks in a worker
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/manual', auth, async (req, reply) => {
    try {
      const masterEmpId = req.fieldEmployee.id;
      const { employee_id, work_id, checkin_at, checkout_at, date, reason } = req.body || {};

      if (!employee_id || !work_id) {
        return reply.code(400).send({ error: 'Укажите employee_id и work_id' });
      }

      // Check master has master role on this project
      const { rows: masterAssign } = await db.query(`
        SELECT field_role FROM employee_assignments
        WHERE employee_id = $1 AND work_id = $2 AND is_active = true
          AND field_role IN ('shift_master', 'senior_master')
        LIMIT 1
      `, [masterEmpId, work_id]);

      if (masterAssign.length === 0) {
        return reply.code(403).send({ error: 'Только мастер может отмечать вручную' });
      }

      // Check worker has assignment
      const { rows: workerAssign } = await db.query(
        `SELECT id FROM employee_assignments WHERE employee_id = $1 AND work_id = $2 AND is_active = true LIMIT 1`,
        [employee_id, work_id]
      );

      if (workerAssign.length === 0) {
        return reply.code(400).send({ error: 'Сотрудник не назначен на этот проект' });
      }

      const checkinDate = date || new Date().toISOString().split('T')[0];
      const checkinTime = checkin_at || new Date().toISOString();
      const dayRate = await getDayRate(employee_id, work_id);

      let hoursWorked = null;
      let hoursPaid = null;
      let amountEarned = null;
      let status = 'active';

      if (checkout_at) {
        const settings = await getProjectSettings(work_id);
        hoursWorked = (new Date(checkout_at) - new Date(checkinTime)) / (1000 * 60 * 60);
        hoursPaid = roundHours(hoursWorked, settings.rounding_rule, parseFloat(settings.rounding_step));
        const shiftHours = parseFloat(settings.shift_hours || 11);
        amountEarned = shiftHours > 0 ? (hoursPaid / shiftHours) * dayRate : 0;
        hoursWorked = Math.round(hoursWorked * 100) / 100;
        amountEarned = Math.round(amountEarned * 100) / 100;
        status = 'completed';
      }

      const { rows: inserted } = await db.query(`
        INSERT INTO field_checkins (employee_id, work_id, assignment_id,
          checkin_at, checkin_source, checkin_by,
          checkout_at, checkout_source, checkout_by,
          hours_worked, hours_paid, day_rate, amount_earned,
          date, status, edit_reason, note)
        VALUES ($1, $2, $3, $4, 'master', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING id, checkin_at, checkout_at
      `, [
        employee_id, work_id, workerAssign[0].id,
        checkinTime, masterEmpId,
        checkout_at || null, checkout_at ? 'master' : null, checkout_at ? masterEmpId : null,
        hoursWorked, hoursPaid, dayRate, amountEarned,
        checkinDate, status, reason || null, reason || null
      ]);

      return {
        checkin_id: inserted[0].id,
        checkin_at: inserted[0].checkin_at,
        checkout_at: inserted[0].checkout_at,
        hours_worked: hoursWorked,
        hours_paid: hoursPaid,
        amount_earned: amountEarned,
      };
    } catch (err) {
      fastify.log.error('[field-checkin] /manual error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /today — today's checkins for a project (master/PM view)
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/today', auth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const workId = parseInt(req.query.work_id);

      if (!workId) {
        return reply.code(400).send({ error: 'Укажите work_id' });
      }

      // Check requester is master or has assignment on project
      const { rows: myAssign } = await db.query(
        `SELECT field_role FROM employee_assignments WHERE employee_id = $1 AND work_id = $2 AND is_active = true LIMIT 1`,
        [empId, workId]
      );

      if (myAssign.length === 0) {
        return reply.code(403).send({ error: 'Нет доступа к проекту' });
      }

      const { rows: checkins } = await db.query(`
        SELECT fc.id, fc.employee_id, fc.checkin_at, fc.checkout_at,
               fc.hours_worked, fc.hours_paid, fc.amount_earned,
               fc.status, fc.checkin_source, fc.shift, fc.note,
               e.fio, e.phone
        FROM field_checkins fc
        JOIN employees e ON e.id = fc.employee_id
        WHERE fc.work_id = $1 AND fc.date = CURRENT_DATE AND fc.status != 'cancelled'
        ORDER BY fc.checkin_at ASC
      `, [workId]);

      // Also get crew who haven't checked in
      const { rows: crew } = await db.query(`
        SELECT ea.employee_id, e.fio, e.phone, ea.field_role
        FROM employee_assignments ea
        JOIN employees e ON e.id = ea.employee_id
        WHERE ea.work_id = $1 AND ea.is_active = true
        ORDER BY ea.field_role DESC, e.fio ASC
      `, [workId]);

      const checkedInIds = new Set(checkins.map(c => c.employee_id));
      const notCheckedIn = crew.filter(c => !checkedInIds.has(c.employee_id));

      return {
        checked_in: checkins,
        not_checked_in: notCheckedIn,
        total_crew: crew.length,
        present_count: checkins.length,
      };
    } catch (err) {
      fastify.log.error('[field-checkin] /today error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });
}

module.exports = routes;
