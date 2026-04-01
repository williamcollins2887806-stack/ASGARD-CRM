/**
 * ASGARD Field — Worker API
 * ═══════════════════════════════════════════════════════════════════════════
 * GET /me                — profile + achievements
 * GET /active-project    — current active project
 * GET /projects          — all projects history
 * GET /projects/:work_id — project details + timesheet
 * GET /finances          — financial summary
 * GET /finances/:work_id — finances for specific project
 * GET /logistics         — current logistics (tickets, hotels)
 * GET /logistics/history — all logistics history
 */

const FIELD_ACHIEVEMENTS = [
  { id: 'first_shift',    icon: '🔥', name: 'Пе��вая смена',    desc: 'Отработал первый день', check: s => s.total_shifts >= 1 },
  { id: 'iron_warrior',   icon: '⚡', name: 'Желез��ый воин',   desc: '10 смен без пропусков', check: s => s.consecutive >= 10 },
  { id: 'veteran',        icon: '🏆', name: 'Ветеран Асгарда', desc: '50+ смен в компании', check: s => s.total_shifts >= 50 },
  { id: 'chronicler',     icon: '📷', name: 'Летописец',       desc: '100+ фото в отчётах', check: s => s.photos >= 100 },
  { id: 'punctual',       icon: '⏰', name: 'Пунктуальный',    desc: '20 смен вовремя', check: s => s.on_time >= 20 },
  { id: 'berserker',      icon: '🛡', name: 'Бер��ерк',         desc: '5 смен по 12+ часов', check: s => s.long_shifts >= 5 },
  { id: 'traveler',       icon: '🗺', name: 'Странник',         desc: '5+ городов работы', check: s => s.cities >= 5 },
  { id: 'mentor',         icon: '🎓', name: 'Наставник',       desc: 'Стал мастером смены', check: s => s.was_master >= 1 },
];

async function routes(fastify, options) {
  const db = fastify.db;
  const auth = { preHandler: [fastify.fieldAuthenticate] };

  // ──────────────────────────────────────────────────────────────────���──
  // GET /me — profile + achievements
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/me', auth, async (req, reply) => {
    try {
      const emp = req.fieldEmployee;

      // Calculate achievement stats
      const statsQ = await db.query(`
        SELECT
          (SELECT COUNT(*) FROM field_checkins WHERE employee_id=$1 AND status='completed') as total_shifts,
          (SELECT COUNT(*) FROM field_photos WHERE employee_id=$1) as photos,
          (SELECT COUNT(DISTINCT w.city) FROM employee_assignments ea JOIN works w ON w.id=ea.work_id WHERE ea.employee_id=$1) as cities,
          (SELECT COUNT(*) FROM field_checkins WHERE employee_id=$1 AND status='completed' AND hours_worked >= 12) as long_shifts,
          (SELECT COUNT(*) FROM employee_assignments WHERE employee_id=$1 AND field_role IN ('shift_master','senior_master')) as was_master
      `, [emp.id]);

      const stats = statsQ.rows[0] || {};
      // on_time: checkins before 08:05
      const onTimeQ = await db.query(
        `SELECT COUNT(*) as cnt FROM field_checkins WHERE employee_id=$1 AND status='completed' AND EXTRACT(HOUR FROM checkin_at)*60 + EXTRACT(MINUTE FROM checkin_at) <= 485`,
        [emp.id]
      );
      stats.on_time = parseInt(onTimeQ.rows[0]?.cnt || 0);

      // consecutive shifts (simplified — count from last gap)
      const consecQ = await db.query(
        `SELECT date FROM field_checkins WHERE employee_id=$1 AND status='completed' ORDER BY date DESC LIMIT 30`,
        [emp.id]
      );
      let consecutive = 0;
      if (consecQ.rows.length > 0) {
        consecutive = 1;
        for (let i = 1; i < consecQ.rows.length; i++) {
          const d1 = new Date(consecQ.rows[i - 1].date);
          const d2 = new Date(consecQ.rows[i].date);
          const diff = (d1 - d2) / (1000 * 60 * 60 * 24);
          if (diff <= 1) consecutive++;
          else break;
        }
      }
      stats.consecutive = consecutive;

      const achievements = FIELD_ACHIEVEMENTS.map(a => ({
        id: a.id,
        icon: a.icon,
        name: a.name,
        desc: a.desc,
        earned: a.check(stats),
      }));

      return {
        id: emp.id,
        fio: emp.fio,
        phone: emp.phone,
        city: emp.city,
        position: emp.position,
        role_tag: emp.role_tag,
        is_self_employed: emp.is_self_employed,
        naks: emp.naks,
        naks_expiry: emp.naks_expiry,
        imt_number: emp.imt_number,
        imt_expires: emp.imt_expires,
        permits: emp.permits,
        clothing_size: emp.clothing_size,
        shoe_size: emp.shoe_size,
        phone_verified: emp.phone_verified,
        day_rate: emp.day_rate,
        achievements,
      };
    } catch (err) {
      fastify.log.error('[field-worker] /me error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /active-project — current active project with details
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/active-project', auth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;

      // Find active assignment
      const { rows: assignments } = await db.query(`
        SELECT ea.id as assignment_id, ea.work_id, ea.field_role, ea.per_diem,
               ea.shift_type, ea.date_from, ea.date_to, ea.role,
               ea.tariff_id, ea.tariff_points, ea.combination_tariff_id,
               w.work_title, w.city, w.object_name, w.address, w.pm_id,
               w.contact_person, w.contact_phone,
               fps.shift_hours, fps.schedule_type, fps.site_category,
               fps.rounding_rule, fps.rounding_step, fps.per_diem as project_per_diem,
               fps.geo_required, fps.object_lat, fps.object_lng, fps.geo_radius_meters
        FROM employee_assignments ea
        JOIN works w ON w.id = ea.work_id
        LEFT JOIN field_project_settings fps ON fps.work_id = ea.work_id
        WHERE ea.employee_id = $1 AND ea.is_active = true
        ORDER BY ea.id DESC
        LIMIT 1
      `, [empId]);

      if (assignments.length === 0) {
        return { project: null };
      }

      const a = assignments[0];

      // Get tariff info
      let tariff = null;
      let combination = null;
      let dayRate = req.fieldEmployee.day_rate || 0;

      if (a.tariff_id) {
        const { rows: tRows } = await db.query(
          `SELECT id, category, position_name, points, rate_per_shift FROM field_tariff_grid WHERE id = $1`,
          [a.tariff_id]
        );
        if (tRows.length > 0) {
          tariff = tRows[0];
          dayRate = parseFloat(tariff.rate_per_shift);
        }
      }

      if (a.combination_tariff_id) {
        const { rows: cRows } = await db.query(
          `SELECT id, position_name, points, rate_per_shift FROM field_tariff_grid WHERE id = $1`,
          [a.combination_tariff_id]
        );
        if (cRows.length > 0) {
          combination = cRows[0];
          dayRate += parseFloat(combination.rate_per_shift);
        }
      }

      const perDiem = parseFloat(a.per_diem || a.project_per_diem || 0);

      // Get PM info (users -> employees via user_id)
      let pm = null;
      if (a.pm_id) {
        const { rows: pmRows } = await db.query(
          `SELECT e.fio, e.phone FROM employees e WHERE e.user_id = $1 LIMIT 1`,
          [a.pm_id]
        );
        if (pmRows.length > 0) {
          pm = { fio: pmRows[0].fio, phone: pmRows[0].phone };
        } else {
          // Fallback: try users table
          const { rows: uRows } = await db.query(
            `SELECT login as fio, phone FROM users WHERE id = $1 LIMIT 1`,
            [a.pm_id]
          );
          if (uRows.length > 0) pm = { fio: uRows[0].fio, phone: uRows[0].phone };
        }
      }

      // Get master info
      let master = null;
      const { rows: masterRows } = await db.query(`
        SELECT e.fio, e.phone FROM employee_assignments ea
        JOIN employees e ON e.id = ea.employee_id
        WHERE ea.work_id = $1 AND ea.field_role IN ('shift_master','senior_master')
          AND ea.is_active = true AND ea.employee_id != $2
        LIMIT 1
      `, [a.work_id, empId]);
      if (masterRows.length > 0) {
        master = { fio: masterRows[0].fio, phone: masterRows[0].phone };
      }

      // Today's checkin
      let todayCheckin = null;
      const { rows: checkinRows } = await db.query(
        `SELECT id, checkin_at, checkout_at, hours_worked, hours_paid, amount_earned, status
         FROM field_checkins WHERE employee_id = $1 AND work_id = $2 AND date = CURRENT_DATE AND status != 'cancelled'
         LIMIT 1`,
        [empId, a.work_id]
      );
      if (checkinRows.length > 0) {
        todayCheckin = checkinRows[0];
      }

      // Today earnings
      let todayEarnings = 0;
      if (todayCheckin && todayCheckin.status === 'completed') {
        todayEarnings = parseFloat(todayCheckin.amount_earned || 0) + perDiem;
      }

      return {
        project: {
          work_id: a.work_id,
          work_title: a.work_title,
          city: a.city,
          object_name: a.object_name,
          address: a.address,
          assignment_id: a.assignment_id,
          field_role: a.field_role,
          shift_type: a.shift_type,
          date_from: a.date_from,
          date_to: a.date_to,
          schedule_type: a.schedule_type || 'shift',
          shift_hours: parseFloat(a.shift_hours || 11),
          rounding_rule: a.rounding_rule || 'half_up',
          rounding_step: parseFloat(a.rounding_step || 0.5),
          site_category: a.site_category || 'ground',
          geo_required: a.geo_required || false,
          object_lat: a.object_lat,
          object_lng: a.object_lng,
          geo_radius_meters: a.geo_radius_meters || 500,
          day_rate: dayRate,
          per_diem: perDiem,
          tariff: tariff ? {
            id: tariff.id,
            position_name: tariff.position_name,
            points: tariff.points,
            rate_per_shift: parseFloat(tariff.rate_per_shift),
            combination: combination ? {
              id: combination.id,
              position_name: combination.position_name,
              points: combination.points,
              rate_per_shift: parseFloat(combination.rate_per_shift),
            } : null,
            total_rate: dayRate,
          } : null,
          pm,
          master,
          today_checkin: todayCheckin,
          today_earnings: todayEarnings,
        },
      };
    } catch (err) {
      fastify.log.error('[field-worker] /active-project error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /projects — all projects with totals
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/projects', auth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const { rows } = await db.query(`
        SELECT ea.work_id, ea.field_role, ea.date_from, ea.date_to, ea.is_active,
               ea.tariff_id, ea.per_diem,
               w.work_title, w.city, w.object_name,
               (SELECT e2.fio FROM employees e2 WHERE e2.user_id = w.pm_id LIMIT 1) as pm_name,
               (SELECT COUNT(*) FROM field_checkins fc
                WHERE fc.employee_id = ea.employee_id AND fc.work_id = ea.work_id AND fc.status = 'completed') as shifts_count,
               (SELECT COALESCE(SUM(fc.amount_earned), 0) FROM field_checkins fc
                WHERE fc.employee_id = ea.employee_id AND fc.work_id = ea.work_id AND fc.status = 'completed') as total_earned
        FROM employee_assignments ea
        JOIN works w ON w.id = ea.work_id
        WHERE ea.employee_id = $1
        ORDER BY ea.is_active DESC, ea.date_from DESC NULLS LAST
      `, [empId]);

      return { projects: rows };
    } catch (err) {
      fastify.log.error('[field-worker] /projects error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /projects/:work_id — timesheet for specific project
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/projects/:work_id', auth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const workId = parseInt(req.params.work_id);

      // Verify assignment exists
      const { rows: aRows } = await db.query(
        `SELECT id FROM employee_assignments WHERE employee_id = $1 AND work_id = $2 LIMIT 1`,
        [empId, workId]
      );
      if (aRows.length === 0) {
        return reply.code(403).send({ error: 'Нет доступа к этому проекту' });
      }

      const { rows: checkins } = await db.query(`
        SELECT date, checkin_at, checkout_at, hours_worked, hours_paid,
               day_rate, amount_earned, status, shift, note
        FROM field_checkins WHERE employee_id = $1 AND work_id = $2
        ORDER BY date DESC
      `, [empId, workId]);

      const { rows: workInfo } = await db.query(
        `SELECT work_title, city, object_name FROM works WHERE id = $1`,
        [workId]
      );

      return {
        work: workInfo[0] || null,
        timesheet: checkins,
      };
    } catch (err) {
      fastify.log.error('[field-worker] /projects/:id error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /finances — financial summary
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/finances', auth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;

      // Current active project finances
      const { rows: activeAssignments } = await db.query(`
        SELECT ea.work_id, w.work_title, ea.per_diem,
               ea.tariff_id, ea.combination_tariff_id
        FROM employee_assignments ea
        JOIN works w ON w.id = ea.work_id
        WHERE ea.employee_id = $1 AND ea.is_active = true
        ORDER BY ea.id DESC LIMIT 1
      `, [empId]);

      let currentProject = null;

      if (activeAssignments.length > 0) {
        const ap = activeAssignments[0];
        const workId = ap.work_id;

        // Earnings from checkins
        const { rows: earnQ } = await db.query(`
          SELECT COALESCE(SUM(amount_earned), 0) as earned,
                 COUNT(*) as days_worked,
                 COALESCE(SUM(hours_paid), 0) as total_hours
          FROM field_checkins WHERE employee_id = $1 AND work_id = $2 AND status = 'completed'
        `, [empId, workId]);

        // Per diem: calendar days on project
        const { rows: calDays } = await db.query(`
          SELECT COUNT(DISTINCT date) as cal_days
          FROM field_checkins WHERE employee_id = $1 AND work_id = $2 AND status != 'cancelled'
        `, [empId, workId]);

        const perDiemRate = parseFloat(ap.per_diem || 0);
        const perDiemTotal = perDiemRate * parseInt(calDays[0]?.cal_days || 0);

        // Advances
        const { rows: advQ } = await db.query(
          `SELECT COALESCE(SUM(advance_paid), 0) as advances FROM payroll_items WHERE employee_id = $1 AND work_id = $2`,
          [empId, workId]
        );

        const earned = parseFloat(earnQ[0]?.earned || 0);
        const advances = parseFloat(advQ[0]?.advances || 0);

        currentProject = {
          work_id: workId,
          work_title: ap.work_title,
          earned_total: earned,
          per_diem_total: perDiemTotal,
          advances_paid: advances,
          to_pay: earned + perDiemTotal - advances,
          days_worked: parseInt(earnQ[0]?.days_worked || 0),
          total_hours: parseFloat(earnQ[0]?.total_hours || 0),
        };
      }

      // All-time totals
      const { rows: allTime } = await db.query(`
        SELECT COALESCE(SUM(amount_earned), 0) as total_earned
        FROM field_checkins WHERE employee_id = $1 AND status = 'completed'
      `, [empId]);

      const { rows: allPaid } = await db.query(
        `SELECT COALESCE(SUM(payout), 0) as total_paid FROM payroll_items WHERE employee_id = $1`,
        [empId]
      );

      const { rows: allOTP } = await db.query(
        `SELECT COALESCE(SUM(amount), 0) as total_otp FROM one_time_payments WHERE employee_id = $1 AND status = 'paid'`,
        [empId]
      );

      const totalEarned = parseFloat(allTime[0]?.total_earned || 0);
      const totalPaid = parseFloat(allPaid[0]?.total_paid || 0) + parseFloat(allOTP[0]?.total_otp || 0);

      return {
        current_project: currentProject,
        all_time: {
          total_earned: totalEarned,
          total_paid: totalPaid,
          total_pending: totalEarned - totalPaid,
        },
      };
    } catch (err) {
      fastify.log.error('[field-worker] /finances error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /finances/:work_id — detailed finances for project
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/finances/:work_id', auth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const workId = parseInt(req.params.work_id);

      // Verify access
      const { rows: aRows } = await db.query(
        `SELECT id, tariff_id, combination_tariff_id, per_diem
         FROM employee_assignments WHERE employee_id = $1 AND work_id = $2 LIMIT 1`,
        [empId, workId]
      );
      if (aRows.length === 0) {
        return reply.code(403).send({ error: 'Нет доступа к этому проекту' });
      }

      const assignment = aRows[0];

      // Tariff info
      let tariffInfo = null;
      if (assignment.tariff_id) {
        const { rows: tRows } = await db.query(
          `SELECT position_name, points, rate_per_shift, point_value FROM field_tariff_grid WHERE id = $1`,
          [assignment.tariff_id]
        );
        if (tRows.length > 0) tariffInfo = tRows[0];
      }

      let comboInfo = null;
      if (assignment.combination_tariff_id) {
        const { rows: cRows } = await db.query(
          `SELECT position_name, points, rate_per_shift FROM field_tariff_grid WHERE id = $1`,
          [assignment.combination_tariff_id]
        );
        if (cRows.length > 0) comboInfo = cRows[0];
      }

      // Checkin data
      const { rows: checkinAgg } = await db.query(`
        SELECT COUNT(*) as days_worked,
               COALESCE(SUM(hours_paid), 0) as total_hours,
               COALESCE(SUM(amount_earned), 0) as base_amount,
               COALESCE(AVG(day_rate), 0) as avg_day_rate
        FROM field_checkins WHERE employee_id = $1 AND work_id = $2 AND status = 'completed'
      `, [empId, workId]);

      // Per diem
      const perDiemRate = parseFloat(assignment.per_diem || 0);
      const { rows: calDays } = await db.query(
        `SELECT COUNT(DISTINCT date) as cnt FROM field_checkins WHERE employee_id=$1 AND work_id=$2 AND status != 'cancelled'`,
        [empId, workId]
      );
      const perDiemDays = parseInt(calDays[0]?.cnt || 0);

      // Payroll items
      const { rows: payrollItems } = await db.query(`
        SELECT days_worked, day_rate, base_amount, bonus, overtime_amount,
               penalty, advance_paid, deductions, accrued, payout, comment
        FROM payroll_items WHERE employee_id = $1 AND work_id = $2
        ORDER BY id DESC
      `, [empId, workId]);

      // One-time payments
      const { rows: otps } = await db.query(
        `SELECT amount, reason, status, paid_at FROM one_time_payments WHERE employee_id = $1 AND work_id = $2 ORDER BY id DESC`,
        [empId, workId]
      );

      // Advances
      const totalAdvances = payrollItems.reduce((s, p) => s + parseFloat(p.advance_paid || 0), 0);
      const totalBonuses = payrollItems.reduce((s, p) => s + parseFloat(p.bonus || 0), 0);
      const totalPenalties = payrollItems.reduce((s, p) => s + parseFloat(p.penalty || 0), 0);
      const totalPaid = payrollItems.reduce((s, p) => s + parseFloat(p.payout || 0), 0);

      const baseAmount = parseFloat(checkinAgg[0]?.base_amount || 0);
      const perDiemTotal = perDiemRate * perDiemDays;

      // Trip stages (Session 12)
      let stagesEarned = 0;
      let stagesBreakdown = [];
      try {
        const { rows: stageRows } = await db.query(`
          SELECT stage_type, SUM(COALESCE(days_approved, days_count)) AS days,
                 AVG(rate_per_day) AS rate, SUM(amount_earned) AS amount
          FROM field_trip_stages
          WHERE employee_id = $1 AND work_id = $2 AND status IN ('completed','approved','adjusted')
          GROUP BY stage_type ORDER BY stage_type
        `, [empId, workId]);
        for (const r of stageRows) {
          const amt = parseFloat(r.amount || 0);
          stagesEarned += amt;
          stagesBreakdown.push({ type: r.stage_type, days: parseInt(r.days || 0), rate: parseFloat(r.rate || 0), amount: amt });
        }
      } catch (_) { /* table may not exist yet */ }

      const totalEarned = baseAmount + perDiemTotal + totalBonuses - totalPenalties + stagesEarned;

      return {
        tariff: tariffInfo,
        combination: comboInfo,
        days_worked: parseInt(checkinAgg[0]?.days_worked || 0),
        total_hours: parseFloat(checkinAgg[0]?.total_hours || 0),
        day_rate: parseFloat(checkinAgg[0]?.avg_day_rate || 0),
        base_amount: baseAmount,
        per_diem_rate: perDiemRate,
        per_diem_days: perDiemDays,
        per_diem_total: perDiemTotal,
        bonuses: totalBonuses,
        penalties: totalPenalties,
        stages_earned: stagesEarned,
        stages_breakdown: stagesBreakdown,
        total_earned: totalEarned,
        advances_paid: totalAdvances,
        total_paid: totalPaid,
        remaining: totalEarned - totalPaid,
        payroll_items: payrollItems,
        one_time_payments: otps,
      };
    } catch (err) {
      fastify.log.error('[field-worker] /finances/:id error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /logistics — current logistics (tickets, hotels)
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/logistics', auth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const { rows } = await db.query(`
        SELECT fl.*, w.work_title, w.city
        FROM field_logistics fl
        JOIN works w ON w.id = fl.work_id
        WHERE fl.employee_id = $1
          AND (fl.date_to IS NULL OR fl.date_to >= CURRENT_DATE - INTERVAL '7 days')
        ORDER BY fl.date_from ASC NULLS LAST
      `, [empId]);

      return { logistics: rows };
    } catch (err) {
      fastify.log.error('[field-worker] /logistics error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /logistics/history — all logistics history
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/logistics/history', auth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const { rows } = await db.query(`
        SELECT fl.*, w.work_title, w.city
        FROM field_logistics fl
        JOIN works w ON w.id = fl.work_id
        WHERE fl.employee_id = $1
        ORDER BY fl.created_at DESC
      `, [empId]);

      return { logistics: rows };
    } catch (err) {
      fastify.log.error('[field-worker] /logistics/history error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });
}

module.exports = routes;
