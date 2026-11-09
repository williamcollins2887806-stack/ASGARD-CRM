'use strict';

/**
 * Crew travel-depart cron
 * ─────────────────────────────────────────────────────────────
 * Правило (МСК, ежедневно 08:10):
 *   Снять с бригады ТОЛЬКО если на ЭТОЙ работе есть и заезд, и отъезд:
 *     1) to_site (travel|ship|helicopter)
 *     2) later from_site (или ship/heli без direction — эвристика B)
 *     3) охлаждение 2 суток (дата этапа и день постановки уже не «вчера»)
 *     4) нет completed day/night смен ПОСЛЕ даты отъезда
 *     5) нет нового to_site после отъезда
 *
 * Без заезда (to_site) — НЕ трогаем (защита от путаницы direction).
 * Просто нет смен без отъезда — НЕ трогаем (это idle-warn).
 * Этапы без work_id — НЕ берём (нельзя привязать к назначению).
 * МЛСП (site_category=mlsp) — НЕ трогаем здесь (закрывает mlsp-stay + assignment).
 *
 * departure_date = дата отъезда.
 */

const cron = require('node-cron');
const { notClosedSql } = require('../helpers/work-status');

const TRAVEL_DEPART_COOLING_DAYS = 2;
const TRAVEL_TYPES = ['travel', 'ship', 'helicopter'];
const DEPART_REASON = 'Авто: отъезд (дорога/корабль/вертолёт)';

const NOT_MLSP = `
  AND NOT EXISTS (
    SELECT 1 FROM field_project_settings fps
    WHERE fps.work_id = ea.work_id AND fps.site_category = 'mlsp'
  )`;

let _task = null;

function ymd(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  if (d instanceof Date && !Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  try { return String(d).slice(0, 10); } catch { return null; }
}

function todayYmdMsk() {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function daysBetween(fromYmd, toYmd) {
  const a = new Date(fromYmd + 'T12:00:00Z');
  const b = new Date(toYmd + 'T12:00:00Z');
  return Math.round((b - a) / 86400000);
}

/** Охлаждение N суток: и день дороги, и день постановки уже не свежие. */
function isTravelDepartCooled(travelYmd, createdYmd, todayYmd, coolingDays) {
  const today = todayYmd || todayYmdMsk();
  const need = coolingDays == null ? TRAVEL_DEPART_COOLING_DAYS : coolingDays;
  if (!travelYmd) return false;
  if (daysBetween(travelYmd, today) < need) return false;
  if (createdYmd && daysBetween(createdYmd, today) < need) return false;
  return true;
}

function start(db, log) {
  if (_task) return;
  _task = cron.schedule('10 8 * * *', () => {
    run(db, log).catch((e) => log.error('[crew-travel-depart] ' + (e && e.message)));
  }, { timezone: 'Europe/Moscow' });
  log.info(`[crew-travel-depart] Started — daily 08:10 MSK (cool ${TRAVEL_DEPART_COOLING_DAYS}d, to_site+from_site)`);
}

function stop() {
  if (_task) { _task.stop(); _task = null; }
}

async function loadActiveAssignments(db) {
  const { rows } = await db.query(`
    SELECT ea.id, ea.employee_id, ea.work_id, ea.date_from,
           COALESCE(e.fio, e.full_name) AS fio,
           w.work_title, w.pm_id
      FROM employee_assignments ea
      JOIN works w ON w.id = ea.work_id
      JOIN employees e ON e.id = ea.employee_id
     WHERE COALESCE(ea.is_active, true) = true
       AND ea.departure_date IS NULL
       AND w.deleted_at IS NULL
       AND ${notClosedSql('w.work_status')}
       ${NOT_MLSP}
     ORDER BY ea.work_id, ea.employee_id
  `);
  return rows;
}

/** Первый заезд (to_site) на этой работе. Без work_id не берём. */
async function findArrival(db, employeeId, workId) {
  const { rows } = await db.query(`
    SELECT fts.id, fts.stage_type, fts.date_from::date AS date_from,
           fts.direction, fts.created_at
      FROM field_trip_stages fts
     WHERE fts.employee_id = $1
       AND fts.work_id = $2
       AND fts.direction = 'to_site'
       AND fts.stage_type = ANY($3::text[])
       AND COALESCE(fts.status, 'active') NOT IN ('rejected', 'cancelled')
     ORDER BY fts.date_from ASC, fts.id ASC
     LIMIT 1
  `, [employeeId, workId, TRAVEL_TYPES]);
  return rows[0] || null;
}

/**
 * Первый остывший отъезд после заезда на этой работе.
 * A) явный from_site
 * B) ship/helicopter без direction (если direction часто NULL вне timesheet-v2)
 */
async function findCooledDeparture(db, employeeId, workId, arrivalYmd, today) {
  const { rows } = await db.query(`
    SELECT fts.id, fts.stage_type, fts.date_from::date AS date_from,
           fts.direction, fts.created_at,
           (fts.created_at AT TIME ZONE 'Europe/Moscow')::date AS created_msk
      FROM field_trip_stages fts
     WHERE fts.employee_id = $1
       AND fts.work_id = $2
       AND fts.stage_type = ANY($3::text[])
       AND COALESCE(fts.status, 'active') NOT IN ('rejected', 'cancelled')
       AND fts.date_from::date >= $4::date
       AND fts.date_from::date < $5::date
       AND (
         fts.direction = 'from_site'
         OR (fts.direction IS NULL AND fts.stage_type IN ('ship', 'helicopter'))
       )
     ORDER BY
       CASE WHEN fts.direction = 'from_site' THEN 0 ELSE 1 END,
       fts.date_from ASC,
       fts.id ASC
  `, [employeeId, workId, TRAVEL_TYPES, arrivalYmd, today]);

  for (const row of rows) {
    const travelDate = ymd(row.date_from);
    const created = ymd(row.created_msk) || ymd(row.created_at);
    if (isTravelDepartCooled(travelDate, created, today, TRAVEL_DEPART_COOLING_DAYS)) {
      return row;
    }
  }
  return null;
}

async function hasShiftAfter(db, employeeId, workId, afterYmd) {
  const { rows } = await db.query(`
    SELECT 1
      FROM field_checkins fc
     WHERE fc.employee_id = $1
       AND fc.work_id = $2
       AND fc.status = 'completed'
       AND fc.shift IN ('day', 'night')
       AND fc.date > $3::date
     LIMIT 1
  `, [employeeId, workId, afterYmd]);
  return rows.length > 0;
}

async function hasToSiteAfter(db, employeeId, workId, afterYmd) {
  const { rows } = await db.query(`
    SELECT 1
      FROM field_trip_stages fts
     WHERE fts.employee_id = $1
       AND fts.work_id = $2
       AND fts.direction = 'to_site'
       AND fts.stage_type = ANY($3::text[])
       AND COALESCE(fts.status, 'active') NOT IN ('rejected', 'cancelled')
       AND fts.date_from::date > $4::date
     LIMIT 1
  `, [employeeId, workId, TRAVEL_TYPES, afterYmd]);
  return rows.length > 0;
}

/**
 * Кандидаты на снятие. Не пишет в БД.
 * @returns {Promise<Array<{assignment_id, employee_id, work_id, fio, work_title, departure_date, stage_id, reason}>>}
 */
async function findCandidates(db, opts = {}) {
  const today = opts.today || todayYmdMsk();
  const active = await loadActiveAssignments(db);
  const out = [];

  for (const a of active) {
    const arrival = await findArrival(db, a.employee_id, a.work_id);
    if (!arrival) continue; // без заезда не трогаем

    const arrivalYmd = ymd(arrival.date_from);
    if (!arrivalYmd) continue;

    const dep = await findCooledDeparture(db, a.employee_id, a.work_id, arrivalYmd, today);
    if (!dep) continue;

    const depYmd = ymd(dep.date_from);
    if (!depYmd) continue;

    // отъезд не раньше заезда (на всякий)
    if (depYmd < arrivalYmd) continue;

    if (await hasShiftAfter(db, a.employee_id, a.work_id, depYmd)) continue;
    if (await hasToSiteAfter(db, a.employee_id, a.work_id, depYmd)) continue;

    out.push({
      assignment_id: a.id,
      employee_id: a.employee_id,
      work_id: a.work_id,
      fio: a.fio,
      work_title: a.work_title,
      pm_id: a.pm_id,
      arrival_date: arrivalYmd,
      departure_date: depYmd,
      stage_id: dep.id,
      stage_type: dep.stage_type,
      direction: dep.direction || null,
      reason: DEPART_REASON
    });
  }
  return out;
}

async function applyDepartures(db, candidates, log) {
  let departed = 0;
  for (const c of candidates) {
    const { rows } = await db.query(`
      UPDATE employee_assignments
         SET departure_date = $2::date,
             departure_reason = COALESCE(departure_reason, $3),
             is_active = false,
             inactivity_auto_departed_at = NOW(),
             updated_at = NOW()
       WHERE id = $1
         AND COALESCE(is_active, true) = true
         AND departure_date IS NULL
       RETURNING id
    `, [c.assignment_id, c.departure_date, c.reason]);

    if (!rows.length) continue;
    departed++;

    log?.info?.(`[crew-travel-depart] auto-depart ${c.fio} work#${c.work_id} dep=${c.departure_date} stage#${c.stage_id}`);

    try {
      await db.query(`
        UPDATE employees
           SET readiness_status = 'unknown', readiness_updated_at = NOW()
         WHERE id = $1 AND COALESCE(readiness_status,'') IN ('on_site','')
      `, [c.employee_id]);
    } catch (_) { /* ignore */ }

    try {
      await db.query(`
        UPDATE site_crew_removal_requests
           SET status = 'cancelled', updated_at = NOW()
         WHERE work_id = $1 AND employee_id = $2 AND status = 'warned'
      `, [c.work_id, c.employee_id]);
    } catch (_) { /* table may not exist */ }
  }
  return departed;
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun] — только список, без UPDATE
 * @param {string} [opts.today] — YYYY-MM-DD (тесты)
 */
async function run(db, log, opts = {}) {
  const dryRun = !!opts.dryRun;
  const candidates = await findCandidates(db, { today: opts.today });

  if (!candidates.length) {
    log?.info?.('[crew-travel-depart] nothing to depart');
    return { dryRun, candidates: [], departed: 0 };
  }

  if (dryRun) {
    log?.info?.(`[crew-travel-depart] dry-run candidates=${candidates.length}`);
    for (const c of candidates) {
      log?.info?.(
        `[crew-travel-depart] WOULD depart ${c.fio} work#${c.work_id} ` +
        `arrival=${c.arrival_date} dep=${c.departure_date} stage#${c.stage_id}`
      );
    }
    return { dryRun: true, candidates, departed: 0 };
  }

  const departed = await applyDepartures(db, candidates, log);
  log?.info?.(`[crew-travel-depart] done departed=${departed}`);
  return { dryRun: false, candidates, departed };
}

module.exports = {
  start,
  stop,
  run,
  findCandidates,
  applyDepartures,
  isTravelDepartCooled,
  daysBetween,
  ymd,
  todayYmdMsk,
  TRAVEL_DEPART_COOLING_DAYS,
  DEPART_REASON,
  TRAVEL_TYPES
};
