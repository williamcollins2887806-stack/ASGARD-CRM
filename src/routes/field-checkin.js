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
  // Note: no is_active filter — inactive workers still have tariff data
  async function getDayRate(empId, workId) {
    const { rows } = await db.query(`
      SELECT ea.tariff_id, ea.combination_tariff_id,
             tg.rate_per_shift as base_rate,
             ctg.rate_per_shift as combo_rate
      FROM employee_assignments ea
      LEFT JOIN field_tariff_grid tg ON tg.id = ea.tariff_id
      LEFT JOIN field_tariff_grid ctg ON ctg.id = ea.combination_tariff_id
      WHERE ea.employee_id = $1 AND ea.work_id = $2
      ORDER BY ea.is_active DESC
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
      const { work_id, lat, lng, accuracy, note, client_date, client_time, client_local_hour } = req.body || {};

      // Use client local date/time to handle multi-timezone workers (e.g. Kemerovo UTC+7 vs server UTC+3)
      const useDate = /^\d{4}-\d{2}-\d{2}$/.test(client_date) ? client_date : null;
      const useParsedTime = client_time && !isNaN(new Date(client_time)) ? new Date(client_time).toISOString() : null;

      if (!work_id) {
        return reply.code(400).send({ error: 'Укажите work_id' });
      }

      // Check assignment exists and is active
      const { rows: assignments } = await db.query(`
        SELECT id, field_role, shift_type FROM employee_assignments
        WHERE employee_id = $1 AND work_id = $2 AND is_active = true
        LIMIT 1
      `, [empId, work_id]);

      if (assignments.length === 0) {
        return reply.code(403).send({ error: 'Нет активно��о назначения на этот проект' });
      }

      const assignmentId = assignments[0].id;

      // Determine shift type: use assignment setting if set, otherwise auto-detect from worker's local hour
      // Auto-detect: 04:00–15:59 local → day, 16:00–03:59 local → night
      let shiftType = assignments[0].shift_type;
      if (!shiftType) {
        const localHour = (client_local_hour != null && client_local_hour >= 0 && client_local_hour <= 23)
          ? client_local_hour
          : new Date().getHours(); // fallback to server hour
        shiftType = (localHour >= 4 && localHour < 16) ? 'day' : 'night';
        fastify.log.info(`[field-checkin] shift auto-detected: hour=${localHour} → ${shiftType} (emp=${empId})`);
      }

      // Check no existing checkin today (any non-cancelled status)
      const { rows: existing } = await db.query(
        `SELECT id, checkin_at, checkout_at, status FROM field_checkins
         WHERE employee_id = $1 AND work_id = $2
           AND date = COALESCE($3::date, CURRENT_DATE)
           AND status != 'cancelled'
         LIMIT 1`,
        [empId, work_id, useDate]
      );

      if (existing.length > 0) {
        if (existing[0].checkout_at) {
          return reply.code(409).send({ error: 'Смена за сегодня уже завершена' });
        }
        // Active shift exists — return it (double-tap protection)
        return { checkin_id: existing[0].id, checkin_at: existing[0].checkin_at, resumed: true };
      }

      // Auto-close active trip stages (Session 12)
      // При начале смены все незавершённые этапы автоматически закрываются
      try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yStr = yesterday.toISOString().slice(0, 10);
        const { rows: activeStages } = await db.query(
          `SELECT id, date_from, rate_per_day FROM field_trip_stages
           WHERE employee_id = $1 AND work_id = $2 AND status = 'active'`,
          [empId, work_id]
        );
        for (const st of activeStages) {
          const d1 = new Date(st.date_from);
          const d2 = new Date(yStr);
          const days = Math.max(1, Math.round((d2 - d1) / 86400000) + 1);
          const amount = days * parseFloat(st.rate_per_day);
          await db.query(
            `UPDATE field_trip_stages SET date_to = $1, days_count = $2, amount_earned = $3,
             status = 'completed', updated_at = NOW() WHERE id = $4`,
            [yStr, days, amount, st.id]
          );
        }
      } catch (stErr) {
        fastify.log.warn('[field-checkin] auto-close stages error:', stErr.message);
      }

      // Get day_rate
      const dayRate = await getDayRate(empId, work_id);

      // Insert checkin — use client local date/time when provided; set shift from assignment
      const { rows: inserted } = await db.query(`
        INSERT INTO field_checkins (employee_id, work_id, assignment_id, checkin_at,
          checkin_lat, checkin_lng, checkin_accuracy, checkin_source, date, shift, day_rate, note)
        VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()), $5, $6, $7, 'self', COALESCE($8::date, CURRENT_DATE), $9, $10, $11)
        RETURNING id, checkin_at
      `, [empId, work_id, assignmentId, useParsedTime, lat || null, lng || null, accuracy || null, useDate, shiftType, dayRate, note || null]);

      const checkin = inserted[0];

      // Quest progress: early_checkin (before 07:00 local time)
      try {
        const { updateQuestProgress, updateBrigadeQuestProgress } = require('../services/questProgress');
        const localHourNow = client_local_hour ?? new Date().getHours();
        if (localHourNow < 7) {
          updateQuestProgress(db, empId, 'early_checkin').catch(() => {});
          updateBrigadeQuestProgress(db, empId, 'early_checkin').catch(() => {});
        }
      } catch { /* non-critical */ }

      // Quest progress: crew_all_checked_in — check if ALL workers checked in today (triggers for masters)
      try {
        const { updateQuestProgress } = require('../services/questProgress');
        const todayDate = useDate || new Date().toISOString().slice(0, 10);
        // Count active workers (not masters) for this work
        const { rows: [{ total_workers }] } = await db.query(
          `SELECT COUNT(*)::int as total_workers FROM employee_assignments
           WHERE work_id = $1 AND is_active = true AND field_role = 'worker'`, [work_id]
        );
        // Count distinct workers who checked in today
        const { rows: [{ checked_in }] } = await db.query(
          `SELECT COUNT(DISTINCT employee_id)::int as checked_in FROM field_checkins
           WHERE work_id = $1 AND date = $2 AND status IN ('active','completed')`, [work_id, todayDate]
        );
        // If all workers present, trigger quest for all masters on this work
        if (checked_in >= total_workers && total_workers > 0) {
          const { rows: masters } = await db.query(
            `SELECT employee_id FROM employee_assignments
             WHERE work_id = $1 AND is_active = true AND field_role IN ('shift_master','senior_master')`, [work_id]
          );
          for (const m of masters) {
            updateQuestProgress(db, m.employee_id, 'crew_all_checked_in').catch(() => {});
          }
        }
      } catch { /* non-critical */ }

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
      const { checkin_id, lat, lng, accuracy, note, client_time } = req.body || {};

      if (!checkin_id) {
        return reply.code(400).send({ error: 'Укажите checkin_id' });
      }

      // Find checkin with shift type
      const { rows: checkins } = await db.query(
        `SELECT fc.id, fc.employee_id, fc.work_id, fc.checkin_at, fc.day_rate, fc.status,
                fc.shift AS checkin_shift,
                COALESCE(ea.shift_type, fc.shift, 'day') AS shift_type
         FROM field_checkins fc
         LEFT JOIN employee_assignments ea ON ea.id = fc.assignment_id
         WHERE fc.id = $1`,
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

      // Calculate hours — use client local time if provided (multi-timezone support)
      const settings = await getProjectSettings(checkin.work_id);
      const checkoutAt = (client_time && !isNaN(new Date(client_time))) ? new Date(client_time) : new Date();
      const checkinAt = new Date(checkin.checkin_at);
      const hoursWorked = (checkoutAt - checkinAt) / (1000 * 60 * 60);
      const shiftHours = parseFloat(settings.shift_hours || 11);
      const hoursPaid = roundHours(hoursWorked, settings.rounding_rule, parseFloat(settings.rounding_step));
      // Prevent early checkout — two conditions:
      // 1. Must work at least 8 hours
      // 2. Must be within 2 hours of shift end (day=20:00, night=08:00)
      const MIN_CHECKOUT_HOURS = 8;
      if (hoursWorked < MIN_CHECKOUT_HOURS) {
        const remainingMin = Math.ceil((MIN_CHECKOUT_HOURS - hoursWorked) * 60);
        const h = Math.floor(remainingMin / 60);
        const m = remainingMin % 60;
        const label = h > 0 ? `${h}ч ${m}м` : `${m}м`;
        return reply.code(400).send({ error: `Минимум 8 часов. Осталось ~${label}` });
      }
      // Check proximity to shift end (MSK timezone)
      const mskNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
      const mskHour = mskNow.getHours();
      const shiftType = checkin.shift || 'day';
      const shiftEndHour = shiftType === 'night' ? 8 : 20; // 20:00 for day, 08:00 for night
      // Calculate hours until shift end
      let hoursToEnd;
      if (shiftType === 'night') {
        // Night shift: checkin ~20:00, end ~08:00 next day
        hoursToEnd = mskHour >= 20 ? (24 - mskHour + shiftEndHour) : (shiftEndHour - mskHour);
      } else {
        hoursToEnd = shiftEndHour - mskHour;
      }
      if (hoursToEnd > 2 && hoursWorked < shiftHours - 0.5) {
        return reply.code(400).send({ error: `До конца смены ещё ${Math.floor(hoursToEnd)}ч. Закрытие доступно за 2 часа до конца или после ${shiftHours - 0.5}ч работы.` });
      }

      // Determine pay:
      // - Work shifts (day/night): re-fetch current rate from assignment (picks up combo added after checkin)
      // - Non-work shifts (road, standby, waiting, etc.): use stored rate, no combo bonus
      const isWorkShift = ['day', 'night'].includes(checkin.checkin_shift || '');
      let dayRate;
      if (isWorkShift) {
        dayRate = await getDayRate(checkin.employee_id, checkin.work_id);
      } else {
        dayRate = parseFloat(checkin.day_rate || 0);
      }
      const amountEarned = dayRate;

      // Update checkin — also update day_rate to reflect current assignment (combo may have been added)
      await db.query(`
        UPDATE field_checkins SET
          checkout_at = $2, checkout_lat = $3, checkout_lng = $4, checkout_accuracy = $5,
          checkout_source = 'self', hours_worked = $6, hours_paid = $7,
          amount_earned = $8, day_rate = $9, status = 'completed', updated_at = NOW(), note = COALESCE($10, note)
        WHERE id = $1
      `, [checkin_id, checkoutAt.toISOString(), lat || null, lng || null, accuracy || null,
          Math.round(hoursWorked * 100) / 100, hoursPaid,
          Math.round(amountEarned * 100) / 100, dayRate, note || null]);

      const quote = randomQuote(FIELD_QUOTES_SHIFT_END)
        .replace('{hours}', Math.floor(hoursWorked));

      // Achievement check (fire-and-forget, don't block checkout response)
      try {
        const achievementChecker = require('../services/achievementChecker');
        achievementChecker.checkAndGrant(db, req.fieldEmployee.id).catch(() => {});
      } catch { /* achievementChecker not available yet */ }

      // Quest progress hooks (fire-and-forget)
      try {
        const { updateQuestProgress, setQuestProgress, updateBrigadeQuestProgress } = require('../services/questProgress');
        const empId = req.fieldEmployee.id;
        // shift_complete fires on every checkout
        updateQuestProgress(db, empId, 'shift_complete').catch(() => {});
        // Brigade quest: shift_complete
        updateBrigadeQuestProgress(db, empId, 'shift_complete').catch(() => {});
        // total_shifts — same action, permanent quests use this too
        updateQuestProgress(db, empId, 'total_shifts').catch(() => {});
        // hours_min_8 — only if shift was at least 8 hours
        if (hoursWorked >= 8) {
          updateQuestProgress(db, empId, 'hours_min_8').catch(() => {});
        }
        // hours_min_10 — full watch quest
        if (hoursWorked >= 10) {
          updateQuestProgress(db, empId, 'hours_min_10').catch(() => {});
        }
        // night_shift — if this was a night shift
        if (checkin.shift === 'night') {
          updateQuestProgress(db, empId, 'night_shift').catch(() => {});
        }
        // Streak update: calculate consecutive work days & update streak quests
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
        db.query(`
          INSERT INTO gamification_streaks (employee_id, current_streak, longest_streak, last_active_date)
          VALUES ($1, 1, 1, $2::date)
          ON CONFLICT (employee_id) DO UPDATE SET
            current_streak = CASE
              WHEN gamification_streaks.last_active_date = ($2::date - 1) THEN gamification_streaks.current_streak + 1
              WHEN gamification_streaks.last_active_date = $2::date THEN gamification_streaks.current_streak
              ELSE 1
            END,
            longest_streak = GREATEST(gamification_streaks.longest_streak,
              CASE
                WHEN gamification_streaks.last_active_date = ($2::date - 1) THEN gamification_streaks.current_streak + 1
                WHEN gamification_streaks.last_active_date = $2::date THEN gamification_streaks.current_streak
                ELSE 1
              END),
            last_active_date = $2::date,
            updated_at = NOW()
          RETURNING current_streak
        `, [empId, todayStr]).then(({ rows }) => {
          const streak = rows[0]?.current_streak || 1;
          setQuestProgress(db, empId, 'streak', streak).catch(() => {});
        }).catch(() => {});
      } catch { /* non-critical */ }

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
        ON CONFLICT (employee_id, date, work_id) WHERE status != 'cancelled'
          DO UPDATE SET
            assignment_id = EXCLUDED.assignment_id,
            checkin_at = EXCLUDED.checkin_at,
            checkin_source = EXCLUDED.checkin_source,
            checkin_by = EXCLUDED.checkin_by,
            checkout_at = EXCLUDED.checkout_at,
            checkout_source = EXCLUDED.checkout_source,
            checkout_by = EXCLUDED.checkout_by,
            hours_worked = EXCLUDED.hours_worked,
            hours_paid = EXCLUDED.hours_paid,
            day_rate = EXCLUDED.day_rate,
            amount_earned = EXCLUDED.amount_earned,
            status = EXCLUDED.status,
            edit_reason = COALESCE(EXCLUDED.edit_reason, field_checkins.edit_reason),
            note = COALESCE(EXCLUDED.note, field_checkins.note),
            updated_at = NOW()
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
  // PUT /correct/:id — master corrects an existing checkin
  // ─────────────────────────────────────────────────────────────────────
  fastify.put('/correct/:id', auth, async (req, reply) => {
    try {
      const masterEmpId = req.fieldEmployee.id;
      const checkinId = parseInt(req.params.id);
      const { day_rate, amount_earned, hours_worked, hours_paid, note } = req.body || {};

      // Get the checkin to find work_id
      const { rows: checkins } = await db.query(
        'SELECT id, work_id, employee_id FROM field_checkins WHERE id = $1',
        [checkinId]
      );
      if (checkins.length === 0) {
        return reply.code(404).send({ error: 'Чекин не найден' });
      }
      const checkin = checkins[0];

      // Check master has master role on this project
      const { rows: masterAssign } = await db.query(`
        SELECT field_role FROM employee_assignments
        WHERE employee_id = $1 AND work_id = $2 AND is_active = true
          AND field_role IN ('shift_master', 'senior_master')
        LIMIT 1
      `, [masterEmpId, checkin.work_id]);

      if (masterAssign.length === 0) {
        return reply.code(403).send({ error: 'Только мастер может корректировать' });
      }

      const { rows: updated } = await db.query(`
        UPDATE field_checkins SET
          day_rate = COALESCE($2, day_rate),
          amount_earned = COALESCE($3, amount_earned),
          hours_worked = COALESCE($4, hours_worked),
          hours_paid = COALESCE($5, hours_paid),
          note = COALESCE($6, note),
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [checkinId, day_rate, amount_earned, hours_worked, hours_paid, note || null]);

      return { ok: true, checkin: updated[0] };
    } catch (err) {
      fastify.log.error('[field-checkin] /correct error:', err);
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

  // ─────────────────────────────────────────────────────────────────────
  // GET /worker/my-work — current active work for the worker
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/worker/my-work', auth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;

      // 1. Find assignment → active work first, fallback to last completed
      const { rows: workRows } = await db.query(`
        SELECT w.id AS work_id,
               w.title AS work_title,
               w.work_title,
               w.start_in_work_date AS start_date,
               w.end_in_work_date AS end_date,
               w.end_plan,
               w.work_status,
               w.pm_id,
               c.short_name AS customer_name,
               ea.shift_type,
               ea.is_active AS assignment_active
        FROM employee_assignments ea
        JOIN works w ON w.id = ea.work_id
        LEFT JOIN customers c ON c.id = w.customer_id
        WHERE ea.employee_id = $1
        ORDER BY ea.is_active DESC, w.start_in_work_date DESC
        LIMIT 1
      `, [empId]);

      if (workRows.length === 0) {
        return { active: false };
      }

      const work = workRows[0];

      // 2. Find masters — приоритет: мастер СВОЕЙ смены, fallback: любой мастер
      const myShift = work.shift_type || 'day';
      const { rows: masters } = await db.query(`
        SELECT e.fio AS name, e.phone, ea.field_role AS role, ea.shift_type
        FROM employee_assignments ea
        JOIN employees e ON e.id = ea.employee_id
        WHERE ea.work_id = $1
          AND ea.field_role IN ('shift_master', 'senior_master')
          AND ea.is_active = TRUE
        ORDER BY CASE WHEN ea.shift_type = $2 THEN 0 ELSE 1 END, ea.field_role DESC
      `, [work.work_id, myShift]);

      // 3. Find PM
      let pm = null;
      if (work.pm_id) {
        const { rows: pmRows } = await db.query(`
          SELECT name, phone, email FROM users WHERE id = $1
        `, [work.pm_id]);
        if (pmRows.length > 0) {
          pm = { name: pmRows[0].name, phone: pmRows[0].phone || null, email: pmRows[0].email || null };
        }
      }

      // 4. Crew — коллеги той же смены (активные) с телефонами
      const { rows: crew } = await db.query(`
        SELECT e.fio, e.phone, ea.field_role, ea.shift_type
        FROM employee_assignments ea
        JOIN employees e ON e.id = ea.employee_id
        WHERE ea.work_id = $1 AND ea.is_active = TRUE AND ea.employee_id != $2
        ORDER BY ea.field_role DESC, e.fio
      `, [work.work_id, empId]);

      return {
        work_id: work.work_id,
        work_title: work.work_title || work.title,
        customer_name: work.customer_name || null,
        start_date: work.start_date,
        end_date: work.end_date || work.end_plan,
        shift_type: work.shift_type || null,
        work_status: work.work_status || null,
        is_active: work.assignment_active !== false,
        masters,
        pm,
        crew,
      };
    } catch (err) {
      fastify.log.error('[field-checkin] /worker/my-work error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });
}

module.exports = routes;
