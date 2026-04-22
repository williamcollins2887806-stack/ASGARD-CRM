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

const { getWorkerFinances } = require('../lib/worker-finances');

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
        `SELECT COUNT(*) as cnt FROM field_checkins WHERE employee_id=$1 AND status='completed' AND EXTRACT(HOUR FROM checkin_at AT TIME ZONE 'Europe/Moscow')*60 + EXTRACT(MINUTE FROM checkin_at AT TIME ZONE 'Europe/Moscow') <= 485`,
        [emp.id]
      );
      stats.on_time = parseInt(onTimeQ.rows[0]?.cnt || 0);

      // consecutive shifts (simplified — count from last gap)
      const consecQ = await db.query(
        `SELECT date FROM field_checkins WHERE employee_id=$1 AND status='completed' ORDER BY date DESC LIMIT 365`,
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

      // Find assignment: active first, fallback to last completed (is_active=false ≠ "no data")
      const { rows: assignments } = await db.query(`
        SELECT ea.id as assignment_id, ea.work_id, ea.field_role, ea.per_diem,
               ea.shift_type, ea.date_from, ea.date_to, ea.role, ea.is_active,
               ea.tariff_id, ea.tariff_points, ea.combination_tariff_id,
               w.work_title, w.city, w.object_name, w.address, w.pm_id,
               w.contact_person, w.contact_phone,
               fps.shift_hours, fps.schedule_type, fps.site_category,
               fps.rounding_rule, fps.rounding_step, fps.per_diem as project_per_diem,
               fps.geo_required, fps.object_lat, fps.object_lng, fps.geo_radius_meters
        FROM employee_assignments ea
        JOIN works w ON w.id = ea.work_id
        LEFT JOIN field_project_settings fps ON fps.work_id = ea.work_id
        WHERE ea.employee_id = $1
        ORDER BY ea.is_active DESC, ea.id DESC
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
          `SELECT id, category, position_name, points, rate_per_shift, point_value FROM field_tariff_grid WHERE id = $1`,
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

      // Get masters (all active shift_master + senior_master)
      const { rows: masterRows } = await db.query(`
        SELECT e.fio, e.phone, ea.field_role AS role
        FROM employee_assignments ea
        JOIN employees e ON e.id = ea.employee_id
        WHERE ea.work_id = $1
          AND ea.field_role IN ('shift_master','senior_master')
          AND ea.is_active = true
        ORDER BY CASE ea.field_role
          WHEN 'senior_master' THEN 1
          WHEN 'shift_master' THEN 2
        END, e.fio
      `, [a.work_id]);
      const masters = masterRows;

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
          is_active: a.is_active,
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
            point_value: parseFloat(tariff.point_value || 500),
            combination: combination ? {
              id: combination.id,
              position_name: combination.position_name,
              points: combination.points,
              rate_per_shift: parseFloat(combination.rate_per_shift),
            } : null,
            total_rate: dayRate,
          } : null,
          pm,
          masters,
          master: masters[0] || null,
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
               w.work_title, w.city, w.object_name, w.work_status, w.customer_name,

               -- PM как объект { fio, phone } или null
               (SELECT row_to_json(pm_row) FROM (
                  SELECT COALESCE(e_pm.fio, u_pm.name) AS fio,
                         COALESCE(e_pm.phone, u_pm.phone) AS phone
                  FROM users u_pm
                  LEFT JOIN employees e_pm ON e_pm.user_id = u_pm.id
                  WHERE u_pm.id = w.pm_id
                  LIMIT 1
               ) pm_row) AS pm,

               -- Masters как массив [{ fio, phone, role }] — senior_master первым
               COALESCE((SELECT json_agg(row_to_json(m_clean)) FROM (
                  SELECT e_m.fio, e_m.phone, ea_m.field_role AS role
                  FROM employee_assignments ea_m
                  JOIN employees e_m ON e_m.id = ea_m.employee_id
                  WHERE ea_m.work_id = ea.work_id
                    AND ea_m.field_role IN ('shift_master','senior_master')
                    AND ea_m.is_active = true
                  ORDER BY CASE ea_m.field_role
                    WHEN 'senior_master' THEN 1
                    WHEN 'shift_master' THEN 2
                    ELSE 3
                  END, e_m.fio
               ) m_clean), '[]'::json) AS masters,

               -- Обратная совместимость
               (SELECT e2.fio FROM employees e2 WHERE e2.user_id = w.pm_id LIMIT 1) as pm_name,

               -- Агрегаты по чекинам
               (SELECT COUNT(*) FROM field_checkins fc
                 WHERE fc.employee_id = ea.employee_id
                   AND fc.work_id = ea.work_id
                   AND fc.status = 'completed') as shifts_count,
               (SELECT COALESCE(SUM(fc.amount_earned), 0) FROM field_checkins fc
                 WHERE fc.employee_id = ea.employee_id
                   AND fc.work_id = ea.work_id
                   AND fc.status = 'completed') as total_earned,

               -- Последний чекин для сортировки
               (SELECT MAX(fc.date) FROM field_checkins fc
                 WHERE fc.employee_id = ea.employee_id
                   AND fc.work_id = ea.work_id
                   AND fc.status = 'completed') as last_checkin_date

        FROM employee_assignments ea
        JOIN works w ON w.id = ea.work_id
        WHERE ea.employee_id = $1
        ORDER BY ea.is_active DESC,
                 last_checkin_date DESC NULLS LAST,
                 ea.date_from DESC NULLS LAST
      `, [empId]);

      // Add badge: completed > active > inactive (left but work continues)
      const projects = rows.map(r => ({
        ...r,
        badge: r.work_status === 'Завершена' ? 'completed'
             : r.is_active ? 'active'
             : 'inactive',
      }));

      return { projects };
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
  // GET /finances — financial summary (SSoT: lib/worker-finances.js)
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/finances', auth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const year = req.query.year ? parseInt(req.query.year) : undefined;
      const result = await getWorkerFinances(db, empId, { year, logger: fastify.log });
      if (result.error === 'per_diem_not_set') return reply.code(422).send(result);
      if (result.error === 'invalid_year') return reply.code(400).send(result);
      if (result.error) return reply.code(500).send(result);
      return result;
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
        `SELECT COUNT(DISTINCT date) as cnt FROM field_checkins WHERE employee_id=$1 AND work_id=$2 AND status = 'completed'`,
        [empId, workId]
      );
      const perDiemDays = parseInt(calDays[0]?.cnt || 0);

      // Payroll items (table may be empty — safe fallback)
      let payrollItems = [];
      try {
        const res = await db.query(`
          SELECT days_worked, day_rate, base_amount, bonus, overtime_amount,
                 penalty, advance_paid, deductions, accrued, payout, comment
          FROM payroll_items WHERE employee_id = $1 AND work_id = $2
          ORDER BY id DESC
        `, [empId, workId]);
        payrollItems = res.rows;
      } catch (_) { /* table may not exist or be empty */ }

      // One-time payments
      let otps = [];
      try {
        const res = await db.query(
          `SELECT amount, reason, status, paid_at FROM one_time_payments WHERE employee_id = $1 AND work_id = $2 ORDER BY id DESC`,
          [empId, workId]
        );
        otps = res.rows;
      } catch (_) { /* table may not exist */ }

      // Advances
      const totalAdvances = payrollItems.reduce((s, p) => s + parseFloat(p.advance_paid || 0), 0);
      const totalBonuses = payrollItems.reduce((s, p) => s + parseFloat(p.bonus || 0), 0);
      const totalPenalties = payrollItems.reduce((s, p) => s + parseFloat(p.penalty || 0), 0);
      // Actual payments from worker_payments table (not payroll accruals)
      let totalPaid = 0;
      try {
        const { rows: wpPaid } = await db.query(
          `SELECT COALESCE(SUM(CASE WHEN type IN ('salary','per_diem','bonus') THEN amount
                                     WHEN type IN ('advance') THEN -amount ELSE 0 END), 0) as paid
           FROM worker_payments WHERE employee_id = $1 AND work_id = $2 AND status = 'paid'`,
          [empId, workId]
        );
        totalPaid = parseFloat(wpPaid[0]?.paid || 0);
      } catch(_) {}

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
  // GET /crew?work_id=X — brigade list (3 groups)
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/crew', auth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const workId = parseInt(req.query.work_id);

      if (!workId) {
        return reply.code(400).send({ error: 'work_id обязателен' });
      }

      // Check requester has (or had) assignment on this work
      const { rows: myAssign } = await db.query(
        `SELECT id FROM employee_assignments WHERE employee_id = $1 AND work_id = $2 LIMIT 1`,
        [empId, workId]
      );
      if (myAssign.length === 0) {
        return reply.code(403).send({ error: 'Нет доступа к этому проекту' });
      }

      // All assignments on this work
      const { rows: allCrew } = await db.query(`
        SELECT ea.employee_id, e.fio, e.phone, ea.field_role, ea.is_active,
               ea.date_from, ea.date_to
        FROM employee_assignments ea
        JOIN employees e ON e.id = ea.employee_id
        WHERE ea.work_id = $1
        ORDER BY CASE ea.field_role
          WHEN 'senior_master' THEN 1
          WHEN 'shift_master' THEN 2
          ELSE 3
        END, e.fio
      `, [workId]);

      // Today's checkins for this work
      const { rows: todayCheckins } = await db.query(`
        SELECT employee_id, status, shift, checkin_at, checkout_at, amount_earned
        FROM field_checkins
        WHERE work_id = $1 AND date = CURRENT_DATE AND status != 'cancelled'
      `, [workId]);

      const checkinMap = {};
      for (const c of todayCheckins) {
        checkinMap[c.employee_id] = c;
      }

      // Split into 3 groups
      const onSite = [];
      const notCheckedIn = [];
      const leftSite = [];

      for (const m of allCrew) {
        const c = checkinMap[m.employee_id];
        const row = {
          employee_id: m.employee_id,
          fio: m.fio,
          phone: (m.phone || '').replace(/_.*$/, ''),
          field_role: m.field_role,
          is_active: m.is_active,
          date_from: m.date_from,
          date_to: m.date_to,
          checkin_status: c ? c.status : null,
          checkin_shift: c ? c.shift : null,
          checkin_at: c ? c.checkin_at : null,
          amount_earned: c ? c.amount_earned : null,
        };

        if (!m.is_active) {
          leftSite.push(row);
        } else if (c) {
          onSite.push(row);
        } else {
          notCheckedIn.push(row);
        }
      }

      // Роль текущего пользователя на этом объекте (для будущих master-actions)
      const myRole = allCrew.find(r => r.employee_id === empId)?.field_role || null;

      return {
        work_id: workId,
        your_role: myRole,
        on_site: onSite,
        not_checked_in: notCheckedIn,
        left_site: leftSite,
        total: allCrew.length,
        on_site_count: onSite.length,
        not_checked_in_count: notCheckedIn.length,
        left_site_count: leftSite.length,
      };
    } catch (err) {
      fastify.log.error('[field-worker] /crew error:', err);
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
  // ═══════════════════════════════════════════════════════════════════
  // GET /permits — все допуски рабочего из employee_permits
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/permits', auth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const { rows } = await db.query(`
        SELECT ep.id, ep.category, ep.doc_number, ep.issuer,
               ep.issue_date, ep.expiry_date, ep.is_active, ep.notes,
               ep.file_url, ep.scan_original_name,
               pt.name AS permit_name, pt.code AS permit_code, pt.category AS permit_category,
               CASE
                 WHEN ep.expiry_date IS NULL THEN 'no_expiry'
                 WHEN ep.expiry_date < CURRENT_DATE THEN 'expired'
                 WHEN ep.expiry_date < CURRENT_DATE + INTERVAL '14 days' THEN 'expiring_14'
                 WHEN ep.expiry_date < CURRENT_DATE + INTERVAL '30 days' THEN 'expiring_30'
                 ELSE 'active'
               END AS status
        FROM employee_permits ep
        LEFT JOIN permit_types pt ON pt.id = ep.type_id
        WHERE ep.employee_id = $1 AND ep.is_active = TRUE
        ORDER BY ep.expiry_date ASC NULLS LAST
      `, [empId]);
      return { permits: rows };
    } catch (err) {
      fastify.log.error('[field-worker] /permits error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // GET /personal — полные личные данные сотрудника
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/personal', auth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const { rows } = await db.query(`
        SELECT id, fio, full_name, phone, email, position, role_tag,
               city, address, birth_date, gender,
               passport_data, passport_number, inn, snils,
               clothing_size, shoe_size, grade,
               is_self_employed, is_active,
               employment_date, dismissal_date,
               naks, naks_expiry, imt_number, imt_expires,
               created_at
        FROM employees WHERE id = $1
      `, [empId]);
      if (!rows.length) return reply.code(404).send({ error: 'Не найден' });
      const emp = rows[0];
      // Mask sensitive PII — show only last 4 digits
      if (emp.passport_number) emp.passport_number = '** **** ' + emp.passport_number.slice(-4);
      if (emp.passport_data) emp.passport_data = emp.passport_data.replace(/\d{2}\s?\d{2}\s?\d{6}/g, (m) => '** ** ****' + m.slice(-2));
      if (emp.inn) emp.inn = '********' + emp.inn.slice(-4);
      if (emp.snils) emp.snils = '***-***-' + emp.snils.slice(-6);
      return { employee: emp };
    } catch (err) {
      fastify.log.error('[field-worker] /personal error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // PUT /personal — обновление личных данных (телефон, адрес, паспорт)
  // Требует подтверждения через модалку на фронте
  // ═══════════════════════════════════════════════════════════════════
  const EDITABLE_FIELDS = new Set([
    'phone', 'email', 'city', 'address',
    'passport_data', 'passport_number', 'inn', 'snils',
    'clothing_size', 'shoe_size',
    'birth_date', 'gender'
  ]);

  fastify.put('/personal', auth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const updates = req.body || {};

      // Фильтруем только разрешённые поля
      const filtered = {};
      for (const [key, val] of Object.entries(updates)) {
        if (EDITABLE_FIELDS.has(key) && val !== undefined) {
          filtered[key] = val;
        }
      }

      if (Object.keys(filtered).length === 0) {
        return reply.code(400).send({ error: 'Нет полей для обновления' });
      }

      // Строим UPDATE
      const setClauses = [];
      const params = [];
      let idx = 1;
      for (const [key, val] of Object.entries(filtered)) {
        setClauses.push(`${key} = $${idx}`);
        params.push(val === '' ? null : val);
        idx++;
      }
      setClauses.push(`updated_at = NOW()`);
      params.push(empId);

      const sql = `UPDATE employees SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING id, fio, phone, email`;
      const { rows } = await db.query(sql, params);

      if (!rows.length) return reply.code(404).send({ error: 'Не найден' });

      fastify.log.info(`[field-worker] Employee ${empId} updated personal data: ${Object.keys(filtered).join(', ')}`);
      return { ok: true, employee: rows[0], updated_fields: Object.keys(filtered) };
    } catch (err) {
      fastify.log.error('[field-worker] PUT /personal error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // GET /timesheet/:work_id — табель по дням для рабочего
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/timesheet/:work_id', auth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const workId = parseInt(req.params.work_id);

      const { rows: checkins } = await db.query(`
        SELECT date, shift, hours_worked, hours_paid,
               day_rate, amount_earned, status, note,
               checkin_at, checkout_at
        FROM field_checkins
        WHERE employee_id = $1 AND work_id = $2
        ORDER BY date ASC
      `, [empId, workId]);

      // Мастер и РП для этого проекта
      const { rows: workInfo } = await db.query(`
        SELECT w.work_title, w.work_status, ea.shift_type, ea.tariff_points, ea.per_diem
        FROM employee_assignments ea
        JOIN works w ON w.id = ea.work_id
        WHERE ea.employee_id = $1 AND ea.work_id = $2
        LIMIT 1
      `, [empId, workId]);

      return {
        work: workInfo[0] || null,
        days: checkins,
        summary: {
          total_days: checkins.length,
          total_earned: checkins.reduce((s, c) => s + (parseFloat(c.amount_earned) || 0), 0),
          total_hours: checkins.reduce((s, c) => s + (parseFloat(c.hours_worked) || 0), 0),
        }
      };
    } catch (err) {
      fastify.log.error('[field-worker] /timesheet error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });
}

module.exports = routes;
