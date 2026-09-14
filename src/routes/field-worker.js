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
const { logError } = require('../lib/log-error');
const { assertPpeSizes } = require('../lib/ppe-sizes');

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

async function loadActivePlannedEngagement(db, employeeId) {
  const { rows } = await db.query(`
    SELECT pe.work_id, pe.planned_from, pe.planned_to, pe.note, pe.inbound_transport,
           w.work_title, pm.name AS pm_name,
           fps.site_category
    FROM employee_planned_engagements pe
    JOIN works w ON w.id = pe.work_id AND w.deleted_at IS NULL
    LEFT JOIN users pm ON pm.id = w.pm_id
    LEFT JOIN field_project_settings fps ON fps.work_id = pe.work_id
    WHERE pe.employee_id = $1 AND pe.status = 'active'
    LIMIT 1
  `, [employeeId]);
  const p = rows[0];
  if (!p) return null;
  return {
    work_id: p.work_id,
    work_title: p.work_title,
    pm_name: p.pm_name,
    planned_from: p.planned_from,
    planned_to: p.planned_to,
    note: p.note,
    inbound_transport: p.inbound_transport || null,
    site_category: p.site_category || null,
  };
}

async function loadMlspStayForEmployee(db, employeeId) {
  try {
    const { getOpenStay, enrichStayRow } = require('../lib/mlsp-stay');
    const open = await getOpenStay(db, employeeId);
    if (open) return enrichStayRow(open);
    const { rows } = await db.query(`
      SELECT * FROM mlsp_stays
      WHERE employee_id = $1
        AND actual_departed_at IS NOT NULL
        AND actual_departed_at >= (CURRENT_DATE - 14)
      ORDER BY id DESC LIMIT 1
    `, [employeeId]);
    return rows[0] ? enrichStayRow(rows[0]) : null;
  } catch (_) {
    return null;
  }
}

async function routes(fastify, options) {
  const db = fastify.db;
  const auth = { preHandler: [fastify.fieldAuthenticate] };

  // 23.06.2026 BUG-FIX (🟡 Payouts-6): единый fallback `point_value` из settings.
  // До фикса field-worker.js при NULL `tariff.point_value` отдавал хардкод 500,
  // а worker-payments.js (РП-сетка, line 1276) читал `settings.point_value` — если
  // в settings стоит 600, фронт у рабочего показывал 500, а РП-табель 600. Это
  // делает обе ветки одинаковыми. Кэш — на время процесса (in-memory, 60 сек).
  let _pvCache = { value: null, until: 0 };
  async function getSettingsPointValue() {
    const now = Date.now();
    if (_pvCache.value !== null && now < _pvCache.until) return _pvCache.value;
    try {
      const { rows } = await db.query(
        "SELECT value_json FROM settings WHERE key = 'point_value' LIMIT 1"
      );
      let v = 500;
      if (rows[0]?.value_json !== undefined) {
        const parsed = parseFloat(JSON.parse(rows[0].value_json));
        if (Number.isFinite(parsed) && parsed > 0) v = parsed;
      }
      _pvCache = { value: v, until: now + 60_000 };
      return v;
    } catch (_) {
      return 500;
    }
  }

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
          (SELECT COUNT(DISTINCT COALESCE(w.object_name, w.city)) FROM employee_assignments ea JOIN works w ON w.id=ea.work_id WHERE ea.employee_id=$1) as cities,
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

      // Cosmetic equipment slots + ammo + 3D asset keys
      const { rows: [cosmetics] } = await db.query(
        `SELECT active_avatar, active_frame, active_badge, active_theme,
                active_helmet, active_weapon, active_armor,
                asset_body, asset_helmet, asset_weapon, asset_armor,
                asset_cape, asset_boots, asset_face_paint
         FROM employees WHERE id=$1`,
        [emp.id]
      );

      // Gamification wallets
      const { rows: wallets } = await db.query(
        'SELECT currency, balance FROM gamification_wallets WHERE employee_id=$1',
        [emp.id]
      );
      const runes = parseInt(wallets.find(w => w.currency === 'runes')?.balance || 0);
      const xp    = parseInt(wallets.find(w => w.currency === 'xp')?.balance    || 0);

      // Worker title (computed from earned achievements count)
      let title = null;
      try {
        const { getWorkerTitle } = require('../services/titleService');
        title = await getWorkerTitle(db, emp.id);
      } catch { /* non-critical */ }

      const planned_engagement = await loadActivePlannedEngagement(db, emp.id);

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
        title,
        planned_engagement,
        // Gamification
        runes,
        xp,
        total_shifts: parseInt(stats.total_shifts || 0),
        // Cosmetics & ammo
        active_avatar: cosmetics?.active_avatar || null,
        active_frame:  cosmetics?.active_frame  || null,
        active_badge:  cosmetics?.active_badge  || null,
        active_theme:  cosmetics?.active_theme  || null,
        active_helmet: cosmetics?.active_helmet || null,
        active_weapon: cosmetics?.active_weapon || null,
        active_armor:  cosmetics?.active_armor  || null,
        assets: {
          body: cosmetics?.asset_body || null,
          helmet: cosmetics?.asset_helmet || null,
          weapon: cosmetics?.asset_weapon || null,
          armor: cosmetics?.asset_armor || null,
          cape: cosmetics?.asset_cape || null,
          boots: cosmetics?.asset_boots || null,
          face_paint: cosmetics?.asset_face_paint || null,
        },
      };
    } catch (err) {
      logError(fastify, '[field-worker] /me error', err, req);
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
               ea.combo_tariff_ids, ea.manual_extra_points,
               ea.departure_date, ea.departure_reason,
               w.work_title, COALESCE(w.object_name, w.city) AS city, w.object_name, w.address, w.pm_id,
               w.contact_person, w.contact_phone,
               fps.shift_hours, fps.schedule_type, fps.site_category,
               fps.rounding_rule, fps.rounding_step, fps.per_diem as project_per_diem,
               COALESCE(fps.per_diem_on_checkins, true) AS per_diem_on_checkins,
               fps.geo_required, fps.object_lat, fps.object_lng, fps.geo_radius_meters
        FROM employee_assignments ea
        JOIN works w ON w.id = ea.work_id
        LEFT JOIN field_project_settings fps ON fps.work_id = ea.work_id
        WHERE ea.employee_id = $1
        ORDER BY
          (COALESCE(ea.is_active, true) AND ea.departure_date IS NULL) DESC,
          COALESCE(ea.departure_date, ea.date_to) DESC NULLS LAST,
          ea.id DESC
        LIMIT 1
      `, [empId]);

      const planned_engagement = await loadActivePlannedEngagement(db, empId);

      if (assignments.length === 0) {
        const mlsp_stay = await loadMlspStayForEmployee(db, empId);
        return { project: null, planned_engagement, mlsp_stay };
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

      {
        const { resolveAssignmentRates } = require('../lib/field-assignment-rate');
        const rates = await resolveAssignmentRates(db, {
          tariff_id: a.tariff_id,
          combination_tariff_id: a.combination_tariff_id,
          combo_tariff_ids: a.combo_tariff_ids,
          manual_extra_points: a.manual_extra_points
        });
        if (!rates.error) {
          dayRate = rates.totalRate || dayRate;
          if (rates.comboRows.length === 1) combination = rates.comboRows[0];
          else if (rates.comboRows.length > 1) {
            combination = {
              id: rates.primaryComboId,
              position_name: rates.comboRows.map((r) => r.position_name).join(' + '),
              points: rates.comboPoints + rates.manualPoints,
              rate_per_shift: rates.comboRate + rates.manualRate
            };
          } else if (rates.manualPoints > 0) {
            combination = {
              id: null,
              position_name: `Доплата +${rates.manualPoints}б`,
              points: rates.manualPoints,
              rate_per_shift: rates.manualRate
            };
          }
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
          AND (ea.departure_date IS NULL OR ea.departure_date > CURRENT_DATE)
        ORDER BY CASE ea.field_role
          WHEN 'senior_master' THEN 1
          WHEN 'shift_master' THEN 2
        END, e.fio
      `, [a.work_id]);
      const masters = masterRows;

      // Today's checkin — also find active shifts started yesterday (night shift cross-midnight)
      let todayCheckin = null;
      const { rows: checkinRows } = await db.query(
        `SELECT id, checkin_at, checkout_at, hours_worked, hours_paid, amount_earned, status
         FROM field_checkins
         WHERE employee_id = $1 AND work_id = $2 AND status != 'cancelled'
           AND (date = CURRENT_DATE OR status = 'active')
         ORDER BY checkin_at DESC
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

      const mlsp_stay = await loadMlspStayForEmployee(db, empId);

      return {
        planned_engagement,
        mlsp_stay,
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
          departure_date: a.departure_date || null,
          departure_reason: a.departure_reason || null,
          mlsp_stay: mlsp_stay && a.site_category === 'mlsp' ? mlsp_stay : (mlsp_stay?.is_open ? mlsp_stay : null),
          day_rate: dayRate,
          per_diem: perDiem,
          /** false = суточные только за этапы (дорога/МО/склад…), не за смены на объекте */
          per_diem_on_checkins: a.per_diem_on_checkins !== false,
          tariff: tariff ? {
            id: tariff.id,
            position_name: tariff.position_name,
            points: tariff.points,
            rate_per_shift: parseFloat(tariff.rate_per_shift),
            // 23.06.2026 BUG-FIX (🟡 Payouts-6): fallback из settings.point_value,
            // а не хардкод 500 — иначе мобилка показывает 500, а РП-сетка — 600.
            point_value: tariff.point_value != null
              ? parseFloat(tariff.point_value)
              : await getSettingsPointValue(),
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
      fastify.log.error({ err, msg: err && err.message, stack: err && err.stack }, '[field-worker] /active-project error');
      return reply.code(500).send({ error: 'Ошибка сервера', detail: err && err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /projects — all projects with totals
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/projects', auth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const { rows } = await db.query(`
        SELECT ea.id AS assignment_id, ea.work_id, ea.field_role, ea.date_from, ea.date_to, ea.is_active,
               ea.tariff_id, ea.per_diem,
               w.work_title, COALESCE(w.object_name, w.city) AS city, w.object_name, w.work_status, w.customer_name,

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

               -- Агрегаты по чекинам этой вахты
               (SELECT COUNT(*) FROM field_checkins fc
                 WHERE fc.employee_id = ea.employee_id
                   AND fc.work_id = ea.work_id
                   AND fc.status = 'completed'
                   AND (
                     fc.assignment_id = ea.id
                     OR (
                       fc.assignment_id IS NULL
                       AND (ea.date_from IS NULL OR fc.date::date >= ea.date_from::date)
                       AND (ea.date_to IS NULL OR fc.date::date <= ea.date_to::date)
                     )
                   )) as shifts_count,
               (SELECT COALESCE(SUM(fc.amount_earned), 0) FROM field_checkins fc
                 WHERE fc.employee_id = ea.employee_id
                   AND fc.work_id = ea.work_id
                   AND fc.status = 'completed'
                   AND (
                     fc.assignment_id = ea.id
                     OR (
                       fc.assignment_id IS NULL
                       AND (ea.date_from IS NULL OR fc.date::date >= ea.date_from::date)
                       AND (ea.date_to IS NULL OR fc.date::date <= ea.date_to::date)
                     )
                   )) as total_earned,

               (SELECT MAX(fc.date) FROM field_checkins fc
                 WHERE fc.employee_id = ea.employee_id
                   AND fc.work_id = ea.work_id
                   AND fc.status = 'completed'
                   AND (
                     fc.assignment_id = ea.id
                     OR (
                       fc.assignment_id IS NULL
                       AND (ea.date_from IS NULL OR fc.date::date >= ea.date_from::date)
                       AND (ea.date_to IS NULL OR fc.date::date <= ea.date_to::date)
                     )
                   )) as last_checkin_date

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
      logError(fastify, '[field-worker] /projects error', err, req);
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
      logError(fastify, '[field-worker] /projects/:id error', err, req);
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
      logError(fastify, '[field-worker] /finances error', err, req);
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
        `SELECT id, tariff_id, combination_tariff_id, combo_tariff_ids, manual_extra_points, per_diem
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
        if (tRows.length > 0) {
          tariffInfo = tRows[0];
          // 23.06.2026 BUG-FIX (🟡 Payouts-6): fallback из settings.point_value
          // вместо хардкода 500 — синхронизация с РП-сеткой (worker-payments.js:1276).
          if (tariffInfo.point_value == null) {
            tariffInfo.point_value = await getSettingsPointValue();
          }
        }
      }

      let comboInfo = null;
      {
        const { resolveAssignmentRates } = require('../lib/field-assignment-rate');
        const rates = await resolveAssignmentRates(db, {
          tariff_id: assignment.tariff_id,
          combination_tariff_id: assignment.combination_tariff_id,
          combo_tariff_ids: assignment.combo_tariff_ids,
          manual_extra_points: assignment.manual_extra_points
        });
        if (!rates.error && (rates.comboRows.length || rates.manualPoints > 0)) {
          if (rates.comboRows.length === 1 && rates.manualPoints === 0) {
            comboInfo = rates.comboRows[0];
          } else {
            comboInfo = {
              position_name: [
                ...rates.comboRows.map((r) => r.position_name),
                rates.manualPoints > 0 ? `Доплата +${rates.manualPoints}б` : null
              ].filter(Boolean).join(' + '),
              points: rates.comboPoints + rates.manualPoints,
              rate_per_shift: rates.comboRate + rates.manualRate
            };
          }
        }
      }

      // Checkin data
      const { rows: checkinAgg } = await db.query(`
        SELECT COUNT(*) as days_worked,
               COALESCE(SUM(hours_paid), 0) as total_hours,
               COALESCE(SUM(amount_earned), 0) as base_amount,
               COALESCE(AVG(day_rate), 0) as avg_day_rate
        FROM field_checkins WHERE employee_id = $1 AND work_id = $2 AND status = 'completed'
      `, [empId, workId]);

      // Per diem — единый хелпер (stages + checkins с rate>0)
      const { getPerDiemDays } = require('../lib/worker-per-diem-days');
      const pd = await getPerDiemDays(db, empId, { workId, includeOrphans: false });
      function _pdRate(v, fallback) {
        const n = parseFloat(v);
        return Number.isFinite(n) && n >= 0 ? n : fallback;
      }
      const assignRate = _pdRate(assignment.per_diem, pd.default_rate);
      const bucket = pd.by_work[String(workId)] || { days: 0, rate: assignRate, accrued: 0 };
      const perDiemRate = _pdRate(bucket.rate, assignRate);
      const perDiemDays = bucket.days || 0;

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
      // Actual payments from worker_payments table (not payroll accruals).
      // 23.06.2026 BUG-FIX (Payouts R1): семантика приведена к SSoT (src/lib/worker-finances.js:55-67).
      //   1) Авансы — ПЛЮС, а не МИНУС. Аванс это выплата рабочему «вперёд», увеличивает то,
      //      что РП уже выдал. До фикса advance шёл с отрицательным знаком → выплата уменьшалась
      //      → детальный экран рабочего в Mobile показывал суммы, отличные от главного экрана.
      //   2) status: ('paid','confirmed') — backend помечает выплату confirmed после подтверждения
      //      бухом, SSoT учитывает оба. До фикса учитывался только 'paid' → confirmed-выплаты
      //      выпадали из итога.
      let totalPaid = 0;
      try {
        const { rows: wpPaid } = await db.query(
          `SELECT COALESCE(SUM(CASE WHEN type IN ('salary','per_diem','bonus','advance') THEN amount
                                     ELSE 0 END), 0) AS paid
             FROM worker_payments
            WHERE employee_id = $1 AND work_id = $2
              AND status IN ('paid','confirmed')`,
          [empId, workId]
        );
        totalPaid = parseFloat(wpPaid[0]?.paid || 0);
      } catch(_) {}

      const baseAmount = parseFloat(checkinAgg[0]?.base_amount || 0);
      const perDiemTotal = parseFloat(bucket.accrued) || (perDiemRate * perDiemDays);

      // Trip stages (Session 12)
      let stagesEarned = 0;
      let stagesBreakdown = [];
      try {
        const { rows: stageRows } = await db.query(`
          SELECT stage_type, SUM(COALESCE(days_approved, days_count)) AS days,
                 AVG(rate_per_day) AS rate, SUM(amount_earned) AS amount
          FROM field_trip_stages
          WHERE employee_id = $1 AND work_id = $2
            AND status IN ('completed','approved','adjusted','active')
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
      logError(fastify, '[field-worker] /finances/:id error', err, req);
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
      logError(fastify, '[field-worker] /crew error', err, req);
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
        SELECT fl.*, w.work_title, COALESCE(w.object_name, w.city) AS city
        FROM field_logistics fl
        LEFT JOIN works w ON w.id = fl.work_id
        WHERE fl.employee_id = $1
          AND (fl.date_to IS NULL OR fl.date_to >= CURRENT_DATE - INTERVAL '7 days')
        ORDER BY fl.date_from ASC NULLS LAST
      `, [empId]);

      return { logistics: rows };
    } catch (err) {
      logError(fastify, '[field-worker] /logistics error', err, req);
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
        SELECT fl.*, w.work_title, COALESCE(w.object_name, w.city) AS city
        FROM field_logistics fl
        LEFT JOIN works w ON w.id = fl.work_id
        WHERE fl.employee_id = $1
        ORDER BY fl.created_at DESC
      `, [empId]);

      return { logistics: rows };
    } catch (err) {
      logError(fastify, '[field-worker] /logistics/history error', err, req);
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
      logError(fastify, '[field-worker] /permits error', err, req);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // Personal self-service — parity with FIELD_SELF_EDIT_KEYS /
  // computeCompleteness (desktop-v2 employeeFormState.js)
  // ═══════════════════════════════════════════════════════════════════
  const PERSONAL_SELECT = `
    id, fio, full_name, phone, phone2, email, telegram, position, role_tag,
    city, address, registration_address, birth_date, gender,
    passport_data, passport_series, passport_number, pass_series, pass_number,
    passport_issued, passport_date, passport_code,
    inn, snils,
    clothing_size, shoe_size, headwear_size, grade,
    spouse_name, spouse_phone,
    relative_name, relative_relation, relative_phone,
    education, specialty, marital_status, children_count,
    blood_type, height, medical_notes,
    bank_name, bik, account_number, card_number,
    is_self_employed, is_active,
    employment_date, dismissal_date,
    naks, naks_expiry, imt_number, imt_expires,
    profile_confirmed_at, created_at
  `;

  /** Mirror FIELD_SELF_EDIT_KEYS — no permits / readiness / HR finance */
  const EDITABLE_FIELDS = new Set([
    'fio', 'phone', 'phone2', 'email', 'telegram',
    'birth_date', 'gender', 'city', 'address', 'registration_address',
    'passport_series', 'passport_number', 'passport_issued', 'passport_date', 'passport_code',
    'inn', 'snils',
    'clothing_size', 'shoe_size', 'headwear_size',
    'spouse_name', 'spouse_phone',
    'relative_name', 'relative_relation', 'relative_phone',
    'education', 'specialty', 'marital_status', 'children_count',
    'blood_type', 'height', 'medical_notes',
    'bank_name', 'bik', 'account_number', 'card_number',
    'is_self_employed',
    'naks', 'naks_expiry', 'imt_number', 'imt_expires',
  ]);

  const PHONE_FIELDS = new Set(['phone', 'phone2', 'spouse_phone', 'relative_phone']);

  function normalizeRuPhoneDigits(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.startsWith('8') && d.length === 11) d = '7' + d.slice(1);
    if (d.length === 10) d = '7' + d;
    if (d.length > 11) d = d.slice(0, 11);
    return d;
  }

  function filled(v) {
    return v != null && String(v).trim() !== '';
  }

  /** Same OR-group logic as computeCompleteness in employeeFormState.js */
  function computeCompleteness(form) {
    const critical = [
      { id: 'fio', ok: filled(form.fio), label: 'ФИО' },
      { id: 'phone', ok: filled(form.phone), label: 'Телефон' },
      { id: 'birth', ok: filled(form.birth_date), label: 'Дата рождения' },
      { id: 'address', ok: filled(form.address) || filled(form.registration_address), label: 'Адрес' },
      {
        id: 'passport',
        ok: filled(form.passport_series || form.pass_series)
          && filled(form.passport_number || form.pass_number),
        label: 'Паспорт',
      },
      { id: 'ppe', ok: filled(form.clothing_size) && filled(form.shoe_size), label: 'СИЗ (одежда+обувь)' },
    ];
    const soft = [
      { id: 'headwear', ok: filled(form.headwear_size), label: 'Каска' },
      { id: 'passport_meta', ok: filled(form.passport_issued) && filled(form.passport_date), label: 'Паспорт: кем/когда' },
      { id: 'passport_code', ok: filled(form.passport_code), label: 'Код подразделения' },
      { id: 'phone2', ok: filled(form.phone2), label: 'Доп. телефон' },
      {
        id: 'emergency',
        ok: (filled(form.spouse_name) && filled(form.spouse_phone))
          || (filled(form.relative_name) && filled(form.relative_phone)),
        label: 'Экстренный контакт',
      },
      { id: 'snils', ok: filled(form.snils), label: 'СНИЛС' },
      { id: 'bank', ok: filled(form.bank_name) && filled(form.bik), label: 'Банк' },
      { id: 'blood', ok: filled(form.blood_type), label: 'Группа крови' },
    ];
    if (form.is_self_employed === true || form.is_self_employed === 'true') {
      soft.unshift({ id: 'inn', ok: filled(form.inn), label: 'ИНН (СЗ)' });
    }

    const criticalGaps = critical.filter((g) => !g.ok).map((g) => g.label);
    const softGaps = soft.filter((g) => !g.ok).map((g) => g.label);
    const done = critical.filter((g) => g.ok).length + soft.filter((g) => g.ok).length;
    const total = critical.length + soft.length;
    const pct = total ? Math.round((done / total) * 100) : 100;
    return { pct, criticalGaps, softGaps, criticalOk: criticalGaps.length === 0 };
  }

  function needsProfileConfirm(profileConfirmedAt) {
    if (!profileConfirmedAt) return true;
    const t = new Date(profileConfirmedAt).getTime();
    if (!Number.isFinite(t)) return true;
    return (Date.now() - t) > 30 * 24 * 60 * 60 * 1000;
  }

  // GET /personal — полные личные данные сотрудника
  fastify.get('/personal', auth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const { rows } = await db.query(
        `SELECT ${PERSONAL_SELECT} FROM employees WHERE id = $1`,
        [empId]
      );
      if (!rows.length) return reply.code(404).send({ error: 'Не найден' });
      const emp = rows[0];
      // Parity: surface series/number from either naming
      if (!emp.passport_series && emp.pass_series) emp.passport_series = emp.pass_series;
      if (!emp.passport_number && emp.pass_number) emp.passport_number = emp.pass_number;
      return { employee: emp };
    } catch (err) {
      logError(fastify, '[field-worker] /personal error', err, req);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // GET /personal/completeness — gaps + monthly confirm flag
  fastify.get('/personal/completeness', auth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const { rows } = await db.query(
        `SELECT ${PERSONAL_SELECT} FROM employees WHERE id = $1`,
        [empId]
      );
      if (!rows.length) return reply.code(404).send({ error: 'Не найден' });
      const emp = rows[0];
      if (!emp.passport_series && emp.pass_series) emp.passport_series = emp.pass_series;
      if (!emp.passport_number && emp.pass_number) emp.passport_number = emp.pass_number;
      const c = computeCompleteness(emp);
      return {
        ...c,
        profile_confirmed_at: emp.profile_confirmed_at || null,
        needsConfirm: needsProfileConfirm(emp.profile_confirmed_at),
      };
    } catch (err) {
      logError(fastify, '[field-worker] /personal/completeness error', err, req);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // POST /personal/confirm — monthly «данные актуальны»
  fastify.post('/personal/confirm', auth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      // body may include { changed: false } — just confirm; edit flow skips this
      const { rows } = await db.query(
        `UPDATE employees SET profile_confirmed_at = NOW(), updated_at = NOW()
         WHERE id = $1
         RETURNING id, profile_confirmed_at`,
        [empId]
      );
      if (!rows.length) return reply.code(404).send({ error: 'Не найден' });
      return { ok: true, profile_confirmed_at: rows[0].profile_confirmed_at };
    } catch (err) {
      logError(fastify, '[field-worker] POST /personal/confirm error', err, req);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // PUT /personal — обновление личных данных (self-service)
  fastify.put('/personal', auth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const updates = req.body || {};

      const filtered = {};
      for (const [key, val] of Object.entries(updates)) {
        if (EDITABLE_FIELDS.has(key) && val !== undefined) {
          filtered[key] = val;
        }
      }

      if (Object.keys(filtered).length === 0) {
        return reply.code(400).send({ error: 'Нет полей для обновления' });
      }

      const ppeErrs = assertPpeSizes(filtered);
      if (ppeErrs.length) {
        return reply.code(400).send({ error: ppeErrs[0], details: ppeErrs });
      }

      if ('gender' in filtered) {
        const g = String(filtered.gender || '').trim().toLowerCase();
        if (['m', 'м', 'male', 'мужской', 'муж'].includes(g)) filtered.gender = 'male';
        else if (['f', 'ж', 'female', 'женский', 'жен'].includes(g)) filtered.gender = 'female';
        else filtered.gender = null;
      }

      if ('is_self_employed' in filtered) {
        const v = filtered.is_self_employed;
        if (v === true || v === 'true' || v === 1 || v === '1') filtered.is_self_employed = true;
        else if (v === false || v === 'false' || v === 0 || v === '0') filtered.is_self_employed = false;
        else if (v === '' || v == null) filtered.is_self_employed = null;
      }

      for (const k of ['children_count', 'height']) {
        if (k in filtered) {
          if (filtered[k] === '' || filtered[k] == null) filtered[k] = null;
          else {
            const n = Number(filtered[k]);
            filtered[k] = Number.isFinite(n) ? n : null;
          }
        }
      }

      for (const k of PHONE_FIELDS) {
        if (k in filtered && filtered[k] != null && filtered[k] !== '') {
          filtered[k] = normalizeRuPhoneDigits(filtered[k]) || null;
        }
      }

      const series = filtered.passport_series != null
        ? String(filtered.passport_series).replace(/\D/g, '').slice(0, 4)
        : null;
      const number = filtered.passport_number != null
        ? String(filtered.passport_number).replace(/\D/g, '').slice(0, 6)
        : null;
      if (filtered.passport_series != null) filtered.passport_series = series || null;
      if (filtered.passport_number != null) filtered.passport_number = number || null;
      if (filtered.passport_code != null && filtered.passport_code !== '') {
        filtered.passport_code = String(filtered.passport_code).replace(/\D/g, '').slice(0, 6) || null;
      }
      if (filtered.snils != null && filtered.snils !== '') {
        filtered.snils = String(filtered.snils).replace(/\D/g, '').slice(0, 11) || null;
      }
      if (filtered.bik != null && filtered.bik !== '') {
        filtered.bik = String(filtered.bik).replace(/\D/g, '').slice(0, 9) || null;
      }
      if (filtered.account_number != null && filtered.account_number !== '') {
        filtered.account_number = String(filtered.account_number).replace(/\D/g, '').slice(0, 20) || null;
      }
      if (filtered.card_number != null && filtered.card_number !== '') {
        filtered.card_number = String(filtered.card_number).replace(/\D/g, '').slice(0, 19) || null;
      }
      if (filtered.blood_type != null && filtered.blood_type !== '') {
        filtered.blood_type = String(filtered.blood_type).trim().slice(0, 40) || null;
      }
      if (filtered.naks != null && filtered.naks !== '') {
        filtered.naks = String(filtered.naks).trim().slice(0, 100) || null;
      }
      if (filtered.imt_number != null && filtered.imt_number !== '') {
        filtered.imt_number = String(filtered.imt_number).trim().slice(0, 100) || null;
      }

      // Passport parity: series+number → passport_data + pass_*
      const finalSeries = filtered.passport_series;
      const finalNumber = filtered.passport_number;
      if (finalSeries && finalNumber) {
        filtered.passport_data = `${finalSeries} ${finalNumber}`;
        filtered.pass_series = finalSeries;
        filtered.pass_number = finalNumber;
      } else if (finalSeries) {
        filtered.pass_series = finalSeries;
      } else if (finalNumber) {
        filtered.pass_number = finalNumber;
      }

      const setClauses = [];
      const params = [];
      let idx = 1;
      // pass_* / passport_data are derived — allow writing even if not in EDITABLE_FIELDS
      const writeKeys = new Set([...Object.keys(filtered)]);
      for (const key of writeKeys) {
        if (!EDITABLE_FIELDS.has(key) && !['passport_data', 'pass_series', 'pass_number'].includes(key)) {
          continue;
        }
        setClauses.push(`${key} = $${idx}`);
        const val = filtered[key];
        params.push(val === '' ? null : val);
        idx++;
      }
      // Self-edit counts as monthly confirm — иначе модалка «Проверь анкету»
      // снова блокирует Home после сохранения (needsConfirm оставался true).
      setClauses.push(`profile_confirmed_at = NOW()`);
      setClauses.push(`updated_at = NOW()`);
      params.push(empId);

      const sql = `UPDATE employees SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING id, fio, phone, email, profile_confirmed_at`;
      const { rows } = await db.query(sql, params);

      if (!rows.length) return reply.code(404).send({ error: 'Не найден' });

      fastify.log.info(`[field-worker] Employee ${empId} updated personal data: ${Object.keys(filtered).join(', ')}`);
      return { ok: true, employee: rows[0], updated_fields: Object.keys(filtered) };
    } catch (err) {
      if (err && err.code === '22001') {
        return reply.code(400).send({
          error: 'Слишком длинное значение в одном из полей. Сократите текст и сохраните снова.',
        });
      }
      logError(fastify, '[field-worker] PUT /personal error', err, req);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // GET /timesheet/:work_id — табель по дням для рабочего
  // Смены (field_checkins) + этапы МО/склад/дорога (field_trip_stages)
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/timesheet/:work_id', auth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const workId = parseInt(req.params.work_id);
      if (!Number.isFinite(workId) || workId <= 0) {
        return reply.code(400).send({ error: 'Некорректный work_id' });
      }

      const { rows: checkins } = await db.query(`
        SELECT date::text AS date, shift, hours_worked, hours_paid,
               day_rate, amount_earned, status, note,
               checkin_at, checkout_at,
               NULL::int AS tariff_points,
               'checkin'::text AS entry_kind
        FROM field_checkins
        WHERE employee_id = $1 AND work_id = $2
          AND COALESCE(status, 'completed') NOT IN ('cancelled')
        ORDER BY date ASC
      `, [empId, workId]);

      let stages = [];
      try {
        const { rows } = await db.query(`
          SELECT date_from::text AS date,
                 stage_type AS shift,
                 NULL::numeric AS hours_worked,
                 NULL::numeric AS hours_paid,
                 rate_per_day AS day_rate,
                 amount_earned,
                 status,
                 note,
                 NULL::timestamptz AS checkin_at,
                 NULL::timestamptz AS checkout_at,
                 tariff_points,
                 'stage'::text AS entry_kind
          FROM field_trip_stages
          WHERE employee_id = $1
            AND (
              work_id = $2
              OR (
                work_id IS NULL
                AND EXISTS (
                  SELECT 1 FROM employee_assignments ea
                  WHERE ea.employee_id = $1 AND ea.work_id = $2
                    AND COALESCE(ea.is_active, true) = true
                )
              )
            )
            AND COALESCE(status, 'active') NOT IN ('cancelled', 'rejected')
          ORDER BY date_from ASC
        `, [empId, workId]);
        stages = rows;
      } catch (_) { /* table may not exist */ }

      // Суточные — единый хелпер (все stage-типы + checkins с rate>0)
      let perDiem = { accrued_days: 0, rate: 0, accrued: 0, paid: 0, pending: 0, days: [] };
      try {
        const { getPerDiemDays } = require('../lib/worker-per-diem-days');
        const pd = await getPerDiemDays(db, empId, { workId, includeOrphans: false });
        const bucketKey = String(workId);
        const bucket = pd.by_work[bucketKey] || { days: 0, rate: pd.default_rate, accrued: 0 };
        const accruedDays = bucket.days || 0;
        const rate = bucket.rate || pd.default_rate;
        const accrued = bucket.accrued || 0;
        const { rows: pay } = await db.query(`
          SELECT
            COALESCE(SUM(amount) FILTER (WHERE status IN ('paid','confirmed')), 0) AS paid,
            COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0) AS pending
          FROM worker_payments
          WHERE employee_id = $1 AND type = 'per_diem'
            AND work_id = $2
        `, [empId, workId]);
        perDiem = {
          accrued_days: accruedDays,
          rate,
          accrued,
          paid: parseFloat(pay[0]?.paid || 0),
          pending: parseFloat(pay[0]?.pending || 0),
          days: pd.days,
        };
      } catch (_) { /* ignore */ }

      const days = [...checkins, ...stages].sort((a, b) => String(a.date).localeCompare(String(b.date)));

      const { rows: workInfo } = await db.query(`
        SELECT w.work_title, w.work_status, ea.shift_type, ea.tariff_points, ea.per_diem
        FROM employee_assignments ea
        JOIN works w ON w.id = ea.work_id
        WHERE ea.employee_id = $1 AND ea.work_id = $2
        LIMIT 1
      `, [empId, workId]);

      const totalEarned = days.reduce((s, c) => s + (parseFloat(c.amount_earned) || 0), 0);
      return {
        work: workInfo[0] || null,
        days,
        per_diem: perDiem,
        summary: {
          total_days: days.length,
          total_earned: totalEarned,
          total_hours: checkins.reduce((s, c) => s + (parseFloat(c.hours_worked) || 0), 0),
          stages_earned: stages.reduce((s, c) => s + (parseFloat(c.amount_earned) || 0), 0),
          checkins_earned: checkins.reduce((s, c) => s + (parseFloat(c.amount_earned) || 0), 0),
        }
      };
    } catch (err) {
      logError(fastify, '[field-worker] /timesheet error', err, req);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // GET /timesheet-orphan — отметки без work_id (обучение/МО) + суточные
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/timesheet-orphan', auth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const { rows: stages } = await db.query(`
        SELECT date_from::text AS date,
               stage_type AS shift,
               NULL::numeric AS hours_worked,
               NULL::numeric AS hours_paid,
               rate_per_day AS day_rate,
               amount_earned,
               status,
               note,
               tariff_points,
               'stage'::text AS entry_kind
        FROM field_trip_stages
        WHERE employee_id = $1
          AND work_id IS NULL
          AND COALESCE(status, 'active') NOT IN ('cancelled', 'rejected')
        ORDER BY date_from ASC
      `, [empId]);

      const { getPerDiemDays } = require('../lib/worker-per-diem-days');
      const pd = await getPerDiemDays(db, empId, { orphansOnly: true });
      const bucket = pd.by_work.__null || { days: 0, rate: pd.default_rate, accrued: 0 };
      const { rows: pay } = await db.query(`
        SELECT
          COALESCE(SUM(amount) FILTER (WHERE status IN ('paid','confirmed')), 0) AS paid,
          COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0) AS pending
        FROM worker_payments
        WHERE employee_id = $1 AND type = 'per_diem' AND work_id IS NULL
      `, [empId]);

      return {
        work: { work_title: 'Без объекта', work_status: '', shift_type: null, tariff_points: null, per_diem: bucket.rate },
        days: stages,
        per_diem: {
          accrued_days: bucket.days,
          rate: bucket.rate,
          accrued: bucket.accrued,
          paid: parseFloat(pay[0]?.paid || 0),
          pending: parseFloat(pay[0]?.pending || 0),
          days: pd.days,
        },
        summary: {
          total_days: stages.length,
          total_earned: stages.reduce((s, c) => s + (parseFloat(c.amount_earned) || 0), 0),
          total_hours: 0,
        },
      };
    } catch (err) {
      logError(fastify, '[field-worker] /timesheet-orphan error', err, req);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // GET /timesheet-month/:year/:month — единый табель рабочего за месяц
  // Смены (field_checkins) + этапы (field_trip_stages, в т.ч. work_id NULL)
  // ═══════════════════════════════════════════════════════════════════
  const MONTH_NAMES_RU = [
    '', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
  ];

  function _parseDateOnlyToUtcMs(value) {
    if (!value) return NaN;
    if (value instanceof Date) {
      return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
    }
    const s = String(value).slice(0, 10);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return NaN;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function _fmtDateUtc(ms) {
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const mon = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${mon}-${dd}`;
  }

  function _normShiftType(shift) {
    if (shift === 'road') return 'travel';
    return shift || 'day';
  }

  function _checkinPoints(row) {
    const type = _normShiftType(row.shift);
    const amount = Number(row.amount_earned || 0);
    const pv = Number(row.point_value || 500);
    const dayRate = Number(row.day_rate || 0);
    if (type === 'day' || type === 'night') {
      if (amount > 0 && pv > 0) return Math.round((amount / pv) * 10) / 10;
      if (dayRate > 0 && pv > 0) return dayRate <= 50 ? dayRate : Math.round((dayRate / pv) * 10) / 10;
      return row.tariff_points != null ? Number(row.tariff_points) : 0;
    }
    if (row.tariff_points != null) return Number(row.tariff_points);
    if (amount > 0 && pv > 0) return Math.round((amount / pv) * 10) / 10;
    return 0;
  }

  /** Подпись объекта для рабочего: объект/город/заказчик, не «Работа из заявки #N». */
  function _workLabelForWorker(row) {
    if (!row || row.work_id == null) return null;
    const objectName = String(row.object_name || '').trim();
    const city = String(row.city || '').trim();
    const customer = String(row.customer_name || '').trim();
    if (objectName && city && objectName.toLowerCase() !== city.toLowerCase()) {
      return `${objectName} · ${city}`;
    }
    if (objectName) return objectName;
    if (city) return city;
    if (customer) return customer;
    const title = String(row.work_title || '').trim();
    if (title && !/^работа из заявки/i.test(title)) return title;
    return 'Объект';
  }

  fastify.get('/timesheet-month/:year/:month', auth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const year = parseInt(req.params.year, 10);
      const month = parseInt(req.params.month, 10);
      if (!Number.isFinite(year) || year < 2000 || year > 2100) {
        return reply.code(400).send({ error: 'Некорректный год' });
      }
      if (!Number.isFinite(month) || month < 1 || month > 12) {
        return reply.code(400).send({ error: 'Некорректный месяц' });
      }

      const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const periodEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      const periodStartMs = _parseDateOnlyToUtcMs(periodStart);
      const periodEndMs = _parseDateOnlyToUtcMs(periodEnd);
      const oneDay = 24 * 60 * 60 * 1000;

      const { rows: checkins } = await db.query(`
        SELECT fc.date::text AS date, fc.shift, fc.hours_worked, fc.hours_paid,
               fc.day_rate, fc.amount_earned, fc.status, fc.work_id,
               fc.entered_by_user_id, fc.checkin_by, fc.checkin_source,
               w.work_title, w.object_name, w.city, w.customer_name,
               (COALESCE(ftg.points, 0) + COALESCE(ctg.points, 0)) AS tariff_points,
               COALESCE(ftg.point_value, 500)::numeric AS point_value,
               u.name AS entered_by_fio_user, u.role AS entered_by_role_user, u.phone AS entered_by_phone_user,
               e_by.fio AS checkin_by_fio, e_by.phone AS checkin_by_phone
        FROM field_checkins fc
        LEFT JOIN works w ON w.id = fc.work_id
        LEFT JOIN employee_assignments ea ON ea.id = fc.assignment_id
        LEFT JOIN field_tariff_grid ftg ON ftg.id = ea.tariff_id
        LEFT JOIN field_tariff_grid ctg ON ctg.id = ea.combination_tariff_id
        LEFT JOIN users u ON u.id = fc.entered_by_user_id
        LEFT JOIN employees e_by ON e_by.id = fc.checkin_by
        WHERE fc.employee_id = $1
          AND fc.date BETWEEN $2::date AND $3::date
          AND COALESCE(fc.status, 'completed') NOT IN ('cancelled')
        ORDER BY fc.date DESC
      `, [empId, periodStart, periodEnd]);

      let stages = [];
      try {
        const { rows } = await db.query(`
          SELECT fts.date_from::text AS date_from,
                 fts.date_to::text AS date_to,
                 fts.days_count,
                 fts.stage_type,
                 fts.rate_per_day,
                 fts.amount_earned,
                 fts.status,
                 fts.tariff_points,
                 fts.work_id,
                 fts.entered_by_user_id,
                 fts.created_by,
                 w.work_title, w.object_name, w.city, w.customer_name,
                 u.name AS entered_by_fio_user, u.role AS entered_by_role_user, u.phone AS entered_by_phone_user
          FROM field_trip_stages fts
          LEFT JOIN works w ON w.id = fts.work_id
          LEFT JOIN users u ON u.id = fts.entered_by_user_id
          WHERE fts.employee_id = $1
            AND fts.date_from <= $3::date
            AND COALESCE(fts.date_to, fts.date_from) >= $2::date
            AND COALESCE(fts.status, 'active') NOT IN ('cancelled', 'rejected')
          ORDER BY fts.date_from DESC
        `, [empId, periodStart, periodEnd]);
        stages = rows;
      } catch (_) { /* table may not exist */ }

      // created_by на этапах → users (batch)
      const stageCreatorIds = [...new Set(
        stages.filter((s) => !s.entered_by_fio_user && s.created_by).map((s) => Number(s.created_by))
      )].filter(Number.isFinite);
      const userById = {};
      if (stageCreatorIds.length) {
        const { rows: urows } = await db.query(
          `SELECT id, name, role, phone FROM users WHERE id = ANY($1::int[])`,
          [stageCreatorIds]
        );
        for (const u of urows) userById[u.id] = u;
      }

      function resolveCheckinAuthor(c) {
        if (c.entered_by_fio_user) {
          return {
            fio: c.entered_by_fio_user,
            role: c.entered_by_role_user || null,
            phone: c.entered_by_phone_user || null,
          };
        }
        if ((c.checkin_source === 'self' || c.checkin_source === 'master') && c.checkin_by) {
          return {
            fio: c.checkin_by_fio || null,
            role: c.checkin_source === 'self' ? 'WORKER' : 'MASTER',
            phone: c.checkin_by_phone || null,
          };
        }
        return { fio: null, role: null, phone: null };
      }

      function resolveStageAuthor(s) {
        if (s.entered_by_fio_user) {
          return {
            fio: s.entered_by_fio_user,
            role: s.entered_by_role_user || null,
            phone: s.entered_by_phone_user || null,
          };
        }
        if (s.created_by && userById[s.created_by]) {
          const u = userById[s.created_by];
          return { fio: u.name || null, role: u.role || null, phone: u.phone || null };
        }
        return { fio: null, role: null, phone: null };
      }

      /** @type {Map<string, object[]>} */
      const byDate = new Map();

      function pushEntry(dateStr, entry) {
        if (!byDate.has(dateStr)) byDate.set(dateStr, []);
        byDate.get(dateStr).push(entry);
      }

      for (const c of checkins) {
        const dateStr = String(c.date).slice(0, 10);
        const type = _normShiftType(c.shift);
        const author = resolveCheckinAuthor(c);
        pushEntry(dateStr, {
          type,
          entry_kind: 'checkin',
          points: _checkinPoints(c),
          amount: Math.round((parseFloat(c.amount_earned) || 0) * 100) / 100,
          work_id: c.work_id || null,
          work_title: _workLabelForWorker(c),
          hours_worked: c.hours_worked != null ? parseFloat(c.hours_worked) : null,
          status: c.status || 'completed',
          entered_by_fio: author.fio,
          entered_by_role: author.role,
          entered_by_phone: author.phone,
        });
      }

      for (const s of stages) {
        const fromMs = _parseDateOnlyToUtcMs(s.date_from);
        const toMs = s.date_to ? _parseDateOnlyToUtcMs(s.date_to) : fromMs;
        if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) continue;
        const startMs = Math.max(fromMs, periodStartMs);
        const endMs = Math.min(toMs, periodEndMs);
        if (endMs < startMs) continue;
        const realDays = Math.max(1, Math.round((toMs - fromMs) / oneDay) + 1);
        const perDayAmt = Number(s.amount_earned || 0) / Math.max(1, Number(s.days_count || realDays));
        const points = s.tariff_points != null ? Number(s.tariff_points) : 0;
        const type = _normShiftType(s.stage_type);
        const workLabel = _workLabelForWorker(s);
        const author = resolveStageAuthor(s);

        for (let t = startMs; t <= endMs; t += oneDay) {
          pushEntry(_fmtDateUtc(t), {
            type,
            entry_kind: 'stage',
            points,
            amount: Math.round(perDayAmt * 100) / 100,
            work_id: s.work_id || null,
            work_title: workLabel,
            hours_worked: null,
            status: s.status || 'active',
            entered_by_fio: author.fio,
            entered_by_role: author.role,
            entered_by_phone: author.phone,
          });
        }
      }

      // Суточные по дням (SSoT)
      const { getPerDiemDays } = require('../lib/worker-per-diem-days');
      const pdAll = await getPerDiemDays(db, empId, { year });
      const pdByDay = new Map();
      for (const d of pdAll.days || []) {
        const day = String(d.day).slice(0, 10);
        if (day < periodStart || day > periodEnd) continue;
        pdByDay.set(day, {
          rate: Number(d.rate),
          source: d.source || null,
          stage_type: d.stage_type || null,
          work_id: d.work_id != null ? Number(d.work_id) : null,
        });
      }

      const days = [...byDate.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([date, entries]) => {
          const day_points = entries.reduce((sum, e) => sum + (Number(e.points) || 0), 0);
          const day_amount = entries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
          const pd = pdByDay.get(date);
          const hasCheckin = entries.some((e) => e.entry_kind === 'checkin');
          let per_diem = null;
          if (pd) {
            const rate = Number.isFinite(pd.rate) && pd.rate >= 0 ? pd.rate : pdAll.default_rate;
            per_diem = {
              accrued: true,
              amount: Math.round(rate * 100) / 100,
              rate,
              source: pd.source,
            };
          } else if (hasCheckin) {
            per_diem = {
              accrued: false,
              amount: 0,
              rate: 0,
              reason: 'not_on_site',
              reason_text: 'Суточные не начисляются на объекте',
            };
          } else {
            per_diem = { accrued: false, amount: 0, rate: 0, reason: 'none', reason_text: null };
          }

          // Контакт: первая отметка с телефоном автора, иначе любой автор
          let contact = null;
          for (const e of entries) {
            if (e.entered_by_phone || e.entered_by_fio) {
              contact = {
                fio: e.entered_by_fio,
                role: e.entered_by_role,
                phone: e.entered_by_phone,
              };
              if (e.entered_by_phone) break;
            }
          }

          return {
            date,
            entries,
            day_points: Math.round(day_points * 10) / 10,
            day_amount: Math.round(day_amount * 100) / 100,
            per_diem,
            contact,
          };
        });

      // Дни только с суточными (без отметок ФОТ) — тоже в календарь
      for (const [day, pd] of pdByDay.entries()) {
        if (byDate.has(day)) continue;
        const rate = Number.isFinite(pd.rate) && pd.rate >= 0 ? pd.rate : pdAll.default_rate;
        days.push({
          date: day,
          entries: [],
          day_points: 0,
          day_amount: 0,
          per_diem: {
            accrued: true,
            amount: Math.round(rate * 100) / 100,
            rate,
            source: pd.source,
          },
          contact: null,
        });
      }
      days.sort((a, b) => b.date.localeCompare(a.date));

      const summary = {
        days_with_marks: days.filter((d) => d.entries.length > 0).length,
        entries_count: days.reduce((s, d) => s + d.entries.length, 0),
        total_points: Math.round(days.reduce((s, d) => s + d.day_points, 0) * 10) / 10,
        total_amount: Math.round(days.reduce((s, d) => s + d.day_amount, 0) * 100) / 100,
        per_diem_days: [...pdByDay.keys()].length,
        per_diem_accrued: Math.round(
          [...pdByDay.values()].reduce((s, pd) => {
            const rate = Number.isFinite(pd.rate) && pd.rate >= 0 ? pd.rate : pdAll.default_rate;
            return s + rate;
          }, 0) * 100
        ) / 100,
      };

      // Выплаты за расчётный месяц (не смешиваем с начислением)
      const { rows: payRows } = await db.query(`
        SELECT type, COALESCE(SUM(amount), 0)::numeric AS amount
        FROM worker_payments
        WHERE employee_id = $1
          AND status IN ('paid', 'confirmed')
          AND COALESCE(pay_year, EXTRACT(YEAR FROM created_at)::int) = $2
          AND COALESCE(pay_month, EXTRACT(MONTH FROM created_at)::int) = $3
        GROUP BY type
      `, [empId, year, month]);
      let salary_paid = 0;
      let per_diem_paid = 0;
      let advance_paid = 0;
      for (const r of payRows) {
        const amt = parseFloat(r.amount) || 0;
        if (r.type === 'salary') salary_paid += amt;
        if (r.type === 'advance') advance_paid += amt;
        if (r.type === 'per_diem') per_diem_paid += amt;
      }

      return {
        year,
        month,
        month_name: MONTH_NAMES_RU[month],
        days,
        summary,
        money: {
          salary_accrued: summary.total_amount,
          salary_paid: Math.round((salary_paid + advance_paid) * 100) / 100,
          per_diem_accrued: summary.per_diem_accrued,
          per_diem_paid: Math.round(per_diem_paid * 100) / 100,
        },
      };
    } catch (err) {
      logError(fastify, '[field-worker] /timesheet-month error', err, req);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TIMESHEET DISPUTES — разногласия рабочего по табелю
  // ═══════════════════════════════════════════════════════════════════════════

  const ALLOWED_DISPUTE_TYPES = [
    'missing_shift', 'missing_travel', 'missing_medical', 'missing_waiting',
    'wrong_hours', 'wrong_amount', 'wrong_per_diem', 'other'
  ];

  // POST /worker/disputes — рабочий создаёт спор
  fastify.post('/disputes', auth, async (req, reply) => {
    const empId = req.fieldEmployee.id;
    const b = req.body || {};

    if (!b.work_id || !Number.isFinite(Number(b.work_id))) {
      return reply.code(400).send({ error: 'work_id обязателен' });
    }
    if (!ALLOWED_DISPUTE_TYPES.includes(b.dispute_type)) {
      return reply.code(400).send({ error: 'Недопустимый тип спора' });
    }
    const comment = String(b.worker_comment || '').trim();
    if (comment.length < 10) {
      return reply.code(400).send({ error: 'Опишите проблему подробнее (минимум 10 символов)' });
    }

    // Хотя бы что-то одно: dispute_date ИЛИ dispute_month+dispute_year
    const dDate = b.dispute_date ? String(b.dispute_date) : null;
    const dMonth = b.dispute_month ? parseInt(b.dispute_month, 10) : null;
    const dYear = b.dispute_year ? parseInt(b.dispute_year, 10) : null;
    if (!dDate && !(dMonth && dYear)) {
      return reply.code(400).send({ error: 'Укажите дату или месяц спора' });
    }

    // Защита от спама: не более 3 открытых споров по одной работе у одного рабочего
    const { rows: [{ cnt }] } = await db.query(
      `SELECT COUNT(*)::int AS cnt FROM timesheet_disputes
       WHERE employee_id = $1 AND work_id = $2 AND status IN ('open','in_review')`,
      [empId, b.work_id]
    );
    if (cnt >= 3) {
      return reply.code(429).send({
        error: 'У вас уже 3 открытых спора по этой работе. Дождитесь ответа РП.'
      });
    }

    // Проверим что рабочий действительно назначен на эту работу
    const { rows: [assigned] } = await db.query(
      `SELECT 1 FROM employee_assignments WHERE employee_id = $1 AND work_id = $2 LIMIT 1`,
      [empId, b.work_id]
    );
    if (!assigned) {
      return reply.code(403).send({ error: 'Вы не назначены на эту работу' });
    }

    const { rows: [dispute] } = await db.query(`
      INSERT INTO timesheet_disputes (
        employee_id, work_id, dispute_date, dispute_month, dispute_year,
        dispute_type, worker_comment
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [empId, b.work_id, dDate, dMonth, dYear, b.dispute_type, comment]);

    // Уведомление РП — найти responsible_pm_id через works → tender
    try {
      const { rows: [w] } = await db.query(
        `SELECT w.work_title, w.pm_id, t.responsible_pm_id, t.tender_title
         FROM works w
         LEFT JOIN tenders t ON t.id = w.tender_id
         WHERE w.id = $1`,
        [b.work_id]
      );
      const pmId = w?.pm_id || w?.responsible_pm_id;
      if (pmId) {
        const { createNotification } = require('../services/notify');
        createNotification(db, {
          user_id: pmId,
          title: '🚩 Новое разногласие по табелю',
          message: `${req.fieldEmployee.fio || 'Рабочий'} не согласен с табелем (${w.work_title || 'работа'})`,
          type: 'dispute',
          link: `#/all-works?id=${b.work_id}&tab=disputes`
        });
      }
    } catch (e) {
      fastify.log.warn('[disputes] notify PM failed: ' + e.message);
    }

    return { ok: true, dispute };
  });

  // GET /worker/disputes — список моих споров
  fastify.get('/disputes', auth, async (req) => {
    const empId = req.fieldEmployee.id;
    const { rows } = await db.query(`
      SELECT d.*, w.work_title, w.customer_name,
             u.name AS pm_name
      FROM timesheet_disputes d
      LEFT JOIN works w ON w.id = d.work_id
      LEFT JOIN users u ON u.id = d.pm_user_id
      WHERE d.employee_id = $1
      ORDER BY d.created_at DESC
      LIMIT 100
    `, [empId]);
    return { disputes: rows };
  });

  // ─── Worker Readiness (Mobile field app) ──────────────────────────────────
  // GET /readiness — мой текущий статус
  fastify.get('/readiness', auth, async (req) => {
    const emp = req.fieldEmployee;
    const { rows: [row] } = await db.query(`
      SELECT readiness_status, readiness_date, readiness_reason, readiness_comment, readiness_updated_at
      FROM employees WHERE id = $1
    `, [emp.id]);
    return { readiness: row || null };
  });

  // GET /readiness/can-update — можно ли обновить сегодня
  fastify.get('/readiness/can-update', auth, async (req) => {
    const emp = req.fieldEmployee;
    // На активном объекте — нельзя обновлять
    const { rows: active } = await db.query(`
      SELECT 1 FROM employee_assignments
      WHERE employee_id = $1 AND COALESCE(is_active, true) = true AND departure_date IS NULL
      LIMIT 1
    `, [emp.id]);
    if (active.length) return { can_update: false, reason: 'on_active_assignment' };

    // Не чаще 1 раза в сутки
    const { rows: [row] } = await db.query(
      `SELECT readiness_updated_at FROM employees WHERE id = $1`,
      [emp.id]
    );
    if (row && row.readiness_updated_at) {
      const last = new Date(row.readiness_updated_at);
      const now  = new Date();
      const sameDay = last.toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
      if (sameDay) return { can_update: false, reason: 'already_updated_today' };
    }
    return { can_update: true };
  });

  // PUT /readiness — обновить статус готовности (1 раз в день)
  fastify.put('/readiness', auth, async (req, reply) => {
    const emp = req.fieldEmployee;

    const { rows: active } = await db.query(`
      SELECT 1 FROM employee_assignments
      WHERE employee_id = $1 AND COALESCE(is_active, true) = true AND departure_date IS NULL
      LIMIT 1
    `, [emp.id]);
    if (active.length) return reply.code(409).send({ error: 'Нельзя обновлять статус на активном объекте' });

    const { rows: [row] } = await db.query(
      `SELECT readiness_status, readiness_updated_at FROM employees WHERE id = $1`,
      [emp.id]
    );
    if (row && row.readiness_updated_at) {
      const sameDay = new Date(row.readiness_updated_at).toISOString().slice(0,10) === new Date().toISOString().slice(0,10);
      if (sameDay) return reply.code(409).send({ error: 'Уже обновляли сегодня' });
    }

    const { status, date, reason, comment } = req.body || {};
    if (!['ready', 'not_ready'].includes(status)) {
      return reply.code(400).send({ error: 'status: ready|not_ready' });
    }
    if (status === 'ready' && !date) return reply.code(400).send({ error: 'Для ready нужна дата' });
    if (status === 'not_ready' && !reason) return reply.code(400).send({ error: 'Для not_ready нужна причина' });

    const oldStatus = row?.readiness_status;
    await db.query(`
      UPDATE employees SET
        readiness_status     = $1,
        readiness_date       = $2,
        readiness_reason     = $3,
        readiness_comment    = $4,
        readiness_updated_at = NOW(),
        updated_at           = NOW()
      WHERE id = $5
    `, [status, status === 'ready' ? date : null, status === 'not_ready' ? reason : null, comment || null, emp.id]);

    await db.query(`
      INSERT INTO worker_readiness_log
        (employee_id, old_status, new_status, readiness_date, reason, comment, source)
      VALUES ($1, $2, $3, $4, $5, $6, 'worker_app')
    `, [emp.id, oldStatus, status, date || null, reason || null, comment || null]);

    return { ok: true };
  });

  // DELETE /worker/disputes/:id — отозвать (только пока open)
  fastify.delete('/disputes/:id', auth, async (req, reply) => {
    const empId = req.fieldEmployee.id;
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'Bad id' });

    const { rows: [d] } = await db.query(
      `SELECT employee_id, status FROM timesheet_disputes WHERE id = $1`,
      [id]
    );
    if (!d) return reply.code(404).send({ error: 'Спор не найден' });
    if (d.employee_id !== empId) return reply.code(403).send({ error: 'Не ваш спор' });
    if (d.status !== 'open') {
      return reply.code(409).send({ error: 'Можно отозвать только пока РП не начал рассмотрение' });
    }

    await db.query(`DELETE FROM timesheet_disputes WHERE id = $1`, [id]);
    return { ok: true };
  });
}

module.exports = routes;
