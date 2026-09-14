'use strict';

/**
 * MLSP stay (вахта) — непрерывное пребывание на платформе, 45 суток на отрезок.
 * Один открытый stay на человека. Не путать с employee_assignments.departure_date.
 *
 * 2026-09-01: вахта режется дорогой домой (from_site). Назначение на работу
 * снимает только ручной «Съехал». Август Горшков/Романов — ждать табель.
 *
 * Заезд: первая completed смена day/night на работе site_category='mlsp'
 *        после даты последнего съезда (не по updated_at смены — иначе бэкфилл
 *        не откроет новую вахту по старым отметкам).
 * Плановый вывоз: arrived_at + 44 (день заезда = 1, вывоз в день 45).
 * Автозакрытие stay:
 *   A) явный from_site (travel|ship|helicopter), охлаждение 1 сутки
 *      (и дата этапа, и день создания отметки < сегодня) — даже если потом
 *      снова были смены: stay закрывается, следующая смена открывает новый.
 *   B) ship/helicopter без direction после последней смены, без возврата,
 *      то же охлаждение 1 сутки.
 * Этапы без work_id (ставит Хосе) учитываем; если work_id задан — только МЛСП.
 * to_site никогда не закрывает вахту.
 */

const STAY_DAYS = 45;
const ARRIVAL_OFFSET = STAY_DAYS - 1; // +44
const HOME_SPLIT_COOLING_DAYS = 1;
/** @deprecated с 2026-09-01: охлаждение 1 сутки вместо 5 idle; оставлено для старых текстов */
const AUTO_DEPART_IDLE_DAYS = HOME_SPLIT_COOLING_DAYS;
const VISIBLE_AFTER_DEPART_DAYS = 14;
const NOTIFY_DAYS = [14, 7];

function ymd(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  if (d instanceof Date && !Number.isNaN(d.getTime())) {
    // node-pg DATE часто даёт локальную полночь — toISOString уезжает на −1 день в MSK+.
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  try { return String(d).slice(0, 10); } catch { return null; }
}

/** Календарная дата сегодня по МСК (не UTC). */
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

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromYmd, toYmd) {
  const a = new Date(fromYmd + 'T12:00:00Z');
  const b = new Date(toYmd + 'T12:00:00Z');
  return Math.round((b - a) / 86400000);
}

/**
 * Охлаждение 1 сутки: и день дороги, и день постановки отметки уже не сегодня.
 * Если клетку поставили ошибочно и сняли в тот же день — cron ещё не закрыл вахту.
 */
function isHomeRoadCooled(travelYmd, createdYmd, todayYmd) {
  const today = todayYmd || todayYmdMsk();
  if (!travelYmd) return false;
  if (daysBetween(travelYmd, today) < HOME_SPLIT_COOLING_DAYS) return false;
  if (createdYmd && daysBetween(createdYmd, today) < HOME_SPLIT_COOLING_DAYS) return false;
  return true;
}

async function logEvent(db, stayId, eventType, payload, actorUserId) {
  await db.query(`
    INSERT INTO mlsp_stay_events (stay_id, event_type, payload, actor_user_id)
    VALUES ($1, $2, $3::jsonb, $4)
  `, [stayId, eventType, JSON.stringify(payload || {}), actorUserId || null]);
}

async function isMlspWork(db, workId) {
  if (!workId) return false;
  const { rows } = await db.query(`
    SELECT 1 FROM field_project_settings
    WHERE work_id = $1 AND site_category = 'mlsp'
    LIMIT 1
  `, [workId]);
  return rows.length > 0;
}

/** MIN(date) completed day/night на МЛСП после последнего съезда (новая вахта).
 *  Основной критерий — календарная дата смены > actual_departed_at,
 *  иначе бэкфилл (закрыли stay задним числом) не видит июльские смены.
 *  Same-day re-entry: смена в день съезда, записанная после закрытия stay. */
async function firstMlspShiftDate(db, employeeId) {
  const { rows } = await db.query(`
    SELECT MIN(fc.date)::date AS first_shift
    FROM field_checkins fc
    JOIN field_project_settings fps ON fps.work_id = fc.work_id
    LEFT JOIN LATERAL (
      SELECT MAX(s.actual_departed_at) AS last_dep,
             MAX(s.updated_at) AS last_upd
      FROM mlsp_stays s
      WHERE s.employee_id = $1 AND s.actual_departed_at IS NOT NULL
    ) last ON true
    WHERE fc.employee_id = $1
      AND fc.status = 'completed'
      AND fc.shift IN ('day', 'night')
      AND fps.site_category = 'mlsp'
      AND (
        last.last_dep IS NULL
        OR fc.date > last.last_dep
        OR (
          fc.date = last.last_dep
          AND fc.updated_at > last.last_upd
        )
      )
  `, [employeeId]);
  return ymd(rows[0]?.first_shift);
}

async function getOpenStay(db, employeeId) {
  const { rows } = await db.query(`
    SELECT * FROM mlsp_stays
    WHERE employee_id = $1 AND actual_departed_at IS NULL
    ORDER BY id DESC LIMIT 1
  `, [employeeId]);
  return rows[0] || null;
}

/**
 * Если на МЛСП-работе появилась смена и нет открытого stay — открыть.
 * Безопасно вызывать после любого INSERT checkin (игнор если не МЛСП / уже есть stay).
 */
async function ensureOpenStay(db, employeeId, workId, opts = {}) {
  if (!employeeId) return null;
  try {
    if (workId && !(await isMlspWork(db, workId))) return null;

    const open = await getOpenStay(db, employeeId);
    if (open) {
      // подтянуть inbound_transport если пусто
      if (!open.inbound_transport) {
        await maybeFillInboundTransport(db, open);
      }
      return open;
    }

    // если workId не передан — всё равно ищем первую смену МЛСП
    if (workId && !(await isMlspWork(db, workId))) return null;

    const first = await firstMlspShiftDate(db, employeeId);
    if (!first) return null;

    const planned = addDays(first, ARRIVAL_OFFSET);

    // inbound из плана
    let inbound = null;
    try {
      const { rows: pe } = await db.query(`
        SELECT pe.inbound_transport
        FROM employee_planned_engagements pe
        JOIN field_project_settings fps ON fps.work_id = pe.work_id
        WHERE pe.employee_id = $1 AND pe.status = 'active' AND fps.site_category = 'mlsp'
        ORDER BY pe.id DESC LIMIT 1
      `, [employeeId]);
      inbound = pe[0]?.inbound_transport || null;
    } catch (_) { /* column may not exist yet mid-migration */ }

    const { rows: ins } = await db.query(`
      INSERT INTO mlsp_stays (employee_id, arrived_at, planned_depart_at, inbound_transport)
      SELECT $1, $2::date, $3::date, $4
      WHERE NOT EXISTS (
        SELECT 1 FROM mlsp_stays s
        WHERE s.employee_id = $1 AND s.actual_departed_at IS NULL
      )
      RETURNING *
    `, [employeeId, first, planned, inbound]);

    let stay = ins[0] || await getOpenStay(db, employeeId);
    if (!stay) return null;
    if (!ins[0]) return stay; // already existed (race)

    await logEvent(db, stay.id, 'opened', {
      source: opts.source || 'ensure',
      arrived_at: first,
      planned_depart_at: planned,
      work_id: workId || null
    }, opts.actorUserId || null);

    await maybeFillInboundTransport(db, stay);
    return stay;
  } catch (e) {
    // не роняем постановку смены
    if (opts.log) opts.log.warn?.({ err: e }, '[mlsp-stay] ensureOpenStay failed');
    return null;
  }
}

async function maybeFillInboundTransport(db, stay) {
  if (!stay || stay.inbound_transport) return stay;
  const { rows } = await db.query(`
    SELECT fts.stage_type
    FROM field_trip_stages fts
    LEFT JOIN field_project_settings fps ON fps.work_id = fts.work_id
    WHERE fts.employee_id = $1
      AND fts.stage_type IN ('ship', 'helicopter')
      AND COALESCE(fts.status, 'active') NOT IN ('rejected', 'cancelled')
      AND COALESCE(fts.direction, 'to_site') = 'to_site'
      AND fts.date_from <= $2::date
      AND (fts.work_id IS NULL OR fps.site_category = 'mlsp')
    ORDER BY fts.date_from ASC, fts.id ASC
    LIMIT 1
  `, [stay.employee_id, stay.arrived_at]);
  const st = rows[0]?.stage_type;
  const mapped = st === 'ship' ? 'ship' : (st === 'helicopter' ? 'helicopter' : null);
  if (!mapped) return stay;
  const { rows: upd } = await db.query(`
    UPDATE mlsp_stays SET inbound_transport = $2, updated_at = NOW()
    WHERE id = $1 AND inbound_transport IS NULL
    RETURNING *
  `, [stay.id, mapped]);
  return upd[0] || stay;
}

/**
 * Закрыть все активные assignments на работах МЛСП для сотрудника.
 * Тот же смысл, что field-manage departure.
 */
async function closeMlspAssignments(db, employeeId, departureDate, reason) {
  const dep = ymd(departureDate) || new Date().toISOString().slice(0, 10);
  const { rows } = await db.query(`
    UPDATE employee_assignments ea
       SET departure_date = $2::date,
           departure_reason = COALESCE($3, ea.departure_reason),
           is_active = false,
           updated_at = NOW()
      FROM field_project_settings fps
     WHERE ea.work_id = fps.work_id
       AND fps.site_category = 'mlsp'
       AND ea.employee_id = $1
       AND COALESCE(ea.is_active, true) = true
       AND ea.departure_date IS NULL
    RETURNING ea.id, ea.work_id
  `, [employeeId, dep, reason || null]);

  try {
    await db.query(`
      UPDATE employees
         SET readiness_status = 'unknown', readiness_updated_at = NOW()
       WHERE id = $1 AND COALESCE(readiness_status,'') IN ('on_site','')
    `, [employeeId]);
  } catch (_) { /* ignore */ }

  for (const r of rows) {
    try {
      await db.query(`
        UPDATE site_crew_removal_requests
           SET status = 'cancelled', updated_at = NOW()
         WHERE work_id = $1 AND employee_id = $2 AND status = 'warned'
      `, [r.work_id, employeeId]);
    } catch (_) { /* table may not exist */ }
  }
  return rows;
}

/**
 * Вернуть assignments, закрытые автовыездом (по дате и reason).
 */
async function reopenMlspAssignments(db, employeeId, departedAt) {
  const dep = ymd(departedAt);
  const { rows } = await db.query(`
    UPDATE employee_assignments ea
       SET departure_date = NULL,
           departure_reason = NULL,
           is_active = true,
           inactivity_warned_at = NULL,
           inactivity_auto_departed_at = NULL,
           updated_at = NOW()
      FROM field_project_settings fps
     WHERE ea.work_id = fps.work_id
       AND fps.site_category = 'mlsp'
       AND ea.employee_id = $1
       AND ea.departure_date = $2::date
       AND COALESCE(ea.departure_reason, '') LIKE 'Авто: выезд с МЛСП%'
    RETURNING ea.id, ea.work_id
  `, [employeeId, dep]);
  return rows;
}

async function departStay(db, stayId, actualDepartedAt, source, opts = {}) {
  const dep = ymd(actualDepartedAt);
  if (!dep) throw new Error('actual_departed_at required');
  const today = todayYmdMsk();
  if (source === 'manual' && dep > today) throw new Error('Дата вывоза не позже сегодня');

  const { rows } = await db.query(`
    UPDATE mlsp_stays
       SET actual_departed_at = $2::date,
           departed_source = $3,
           transport = COALESCE($4, transport),
           updated_at = NOW()
     WHERE id = $1 AND actual_departed_at IS NULL
     RETURNING *
  `, [stayId, dep, source, opts.transport || null]);
  const stay = rows[0];
  if (!stay) throw new Error('Stay не найден или уже закрыт');

  const closeAssignments = opts.closeAssignments === true || source === 'manual';
  const reason = source === 'manual'
    ? (opts.reason || 'Съехал с МЛСП')
    : (opts.reason || 'Авто: дорога домой (вахта закрыта, назначение не снимаем)');

  const closed = closeAssignments
    ? await closeMlspAssignments(db, stay.employee_id, dep, reason)
    : [];
  await logEvent(db, stay.id, 'departed', {
    source,
    actual_departed_at: dep,
    transport: stay.transport,
    closed_assignments: closed.map((c) => c.id),
    assignments_untouched: !closeAssignments
  }, opts.actorUserId || null);

  return stay;
}

async function extendStay(db, stayId, plannedDepartAt, note, actorUserId) {
  const next = ymd(plannedDepartAt);
  if (!next) throw new Error('planned_depart_at required');

  const { rows: cur } = await db.query(`SELECT * FROM mlsp_stays WHERE id = $1`, [stayId]);
  const stay = cur[0];
  if (!stay) throw new Error('Stay не найден');
  if (stay.actual_departed_at) throw new Error('Stay уже закрыт');
  if (next <= ymd(stay.planned_depart_at)) {
    throw new Error('Новая дата вывоза должна быть позже текущей плановой');
  }

  const today = todayYmdMsk();
  const daysLeft = daysBetween(today, next);
  const clear14 = daysLeft > 14;
  const clear7 = daysLeft > 7;

  const { rows: upd } = await db.query(`
    UPDATE mlsp_stays
       SET planned_depart_at = $2::date,
           extend_note = COALESCE($3, extend_note),
           notify_14_sent_at = CASE WHEN $4 THEN NULL ELSE notify_14_sent_at END,
           notify_7_sent_at  = CASE WHEN $5 THEN NULL ELSE notify_7_sent_at END,
           updated_at = NOW()
     WHERE id = $1
     RETURNING *
  `, [stayId, next, note || null, clear14, clear7]);

  await logEvent(db, stayId, 'extended', {
    from: ymd(stay.planned_depart_at),
    to: next,
    note: note || null,
    cleared_notify_14: clear14,
    cleared_notify_7: clear7
  }, actorUserId || null);

  return upd[0];
}

async function reopenAutoStay(db, stayId, actorUserId) {
  const { rows: cur } = await db.query(`SELECT * FROM mlsp_stays WHERE id = $1`, [stayId]);
  const stay = cur[0];
  if (!stay) throw new Error('Stay не найден');
  if (!stay.actual_departed_at) throw new Error('Stay уже открыт');
  if (stay.departed_source !== 'auto_travel') {
    throw new Error('Вернуть можно только автовыезд');
  }
  const today = todayYmdMsk();
  if (daysBetween(ymd(stay.actual_departed_at), today) > VISIBLE_AFTER_DEPART_DAYS) {
    throw new Error('Срок возврата истёк (14 дней)');
  }
  // не открывать второй stay
  const other = await getOpenStay(db, stay.employee_id);
  if (other && other.id !== stay.id) throw new Error('Уже есть открытая вахта');

  const { rows: upd } = await db.query(`
    UPDATE mlsp_stays
       SET actual_departed_at = NULL,
           departed_source = NULL,
           updated_at = NOW()
     WHERE id = $1
     RETURNING *
  `, [stayId]);

  await reopenMlspAssignments(db, stay.employee_id, stay.actual_departed_at);
  await logEvent(db, stayId, 'reopen', { previous_departed_at: ymd(stay.actual_departed_at) }, actorUserId || null);
  return upd[0];
}

async function firstMlspShiftAfter(db, employeeId, afterDate) {
  const { rows } = await db.query(`
    SELECT MIN(fc.date)::date AS first_shift
    FROM field_checkins fc
    JOIN field_project_settings fps ON fps.work_id = fc.work_id
    WHERE fc.employee_id = $1
      AND fc.status = 'completed'
      AND fc.shift IN ('day', 'night')
      AND fps.site_category = 'mlsp'
      AND fc.date > $2::date
  `, [employeeId, afterDate]);
  return ymd(rows[0]?.first_shift);
}

async function lastMlspShiftOnOrAfter(db, employeeId, fromDate, beforeDate) {
  const { rows } = await db.query(`
    SELECT MAX(fc.date)::date AS last_shift
    FROM field_checkins fc
    JOIN field_project_settings fps ON fps.work_id = fc.work_id
    WHERE fc.employee_id = $1
      AND fc.status = 'completed'
      AND fc.shift IN ('day', 'night')
      AND fps.site_category = 'mlsp'
      AND fc.date >= $2::date
      AND ($3::date IS NULL OR fc.date < $3::date)
  `, [employeeId, fromDate, beforeDate || null]);
  return ymd(rows[0]?.last_shift);
}

/** Первая остывшая дорога домой (явный from_site) внутри окна вахты. */
async function findCooledFromSite(db, employeeId, arrived, windowEndExclusive, today) {
  const { rows } = await db.query(`
    SELECT fts.id, fts.stage_type, fts.date_from::date AS date_from,
           fts.direction, fts.created_at
    FROM field_trip_stages fts
    LEFT JOIN field_project_settings fps ON fps.work_id = fts.work_id
    WHERE fts.employee_id = $1
      AND fts.direction = 'from_site'
      AND fts.stage_type IN ('travel', 'ship', 'helicopter')
      AND COALESCE(fts.status, 'active') NOT IN ('rejected', 'cancelled')
      AND (fts.work_id IS NULL OR fps.site_category = 'mlsp')
      AND fts.date_from::date >= $2::date
      AND fts.date_from::date < $3::date
      AND fts.date_from::date < $4::date
      AND COALESCE((fts.created_at AT TIME ZONE 'Europe/Moscow')::date, '1900-01-01'::date) < $4::date
    ORDER BY fts.date_from ASC, fts.id ASC
    LIMIT 1
  `, [employeeId, arrived, windowEndExclusive, today]);
  return rows[0] || null;
}

function transportOfStage(stage) {
  if (!stage) return null;
  if (stage.stage_type === 'ship') return 'ship';
  if (stage.stage_type === 'helicopter') return 'helicopter';
  return null;
}

async function openMissingStays(db, log) {
  let opened = 0;
  const { rows: needOpen } = await db.query(`
    SELECT DISTINCT fc.employee_id
    FROM field_checkins fc
    JOIN field_project_settings fps ON fps.work_id = fc.work_id
    LEFT JOIN LATERAL (
      SELECT MAX(s.actual_departed_at) AS last_dep,
             MAX(s.updated_at) AS last_upd
      FROM mlsp_stays s
      WHERE s.employee_id = fc.employee_id AND s.actual_departed_at IS NOT NULL
    ) last ON true
    WHERE fc.status = 'completed'
      AND fc.shift IN ('day', 'night')
      AND fps.site_category = 'mlsp'
      AND NOT EXISTS (
        SELECT 1 FROM mlsp_stays s
        WHERE s.employee_id = fc.employee_id AND s.actual_departed_at IS NULL
      )
      AND (
        last.last_dep IS NULL
        OR fc.date > last.last_dep
        OR (fc.date = last.last_dep AND fc.updated_at > last.last_upd)
      )
  `);
  for (const r of needOpen) {
    const s = await ensureOpenStay(db, r.employee_id, null, { source: 'reconcile', log });
    if (s) opened++;
  }
  return opened;
}

async function autoDepartOpenStays(db, log) {
  let n = 0;
  const { rows: openStays } = await db.query(`
    SELECT * FROM mlsp_stays WHERE actual_departed_at IS NULL
  `);
  for (const stay of openStays) {
    try {
      const result = await tryAutoDepart(db, stay, log);
      if (result) n++;
    } catch (e) {
      log?.warn?.({ err: e }, `[mlsp-stay] auto-depart fail stay#${stay.id}`);
    }
  }
  return n;
}

/**
 * Закрытые stay, внутри которых была дорога домой и потом снова смена:
 * режем на два отрезка (как должно было быть сразу).
 */
async function backfillClosedStaySplits(db, log) {
  let split = 0;
  for (let pass = 0; pass < 8; pass++) {
    const { rows: stays } = await db.query(`
      SELECT * FROM mlsp_stays
      WHERE actual_departed_at IS NOT NULL
      ORDER BY employee_id, arrived_at, id
    `);
    let n = 0;
    for (const stay of stays) {
      try {
        if (await splitClosedStayIfNeeded(db, stay, log)) n++;
      } catch (e) {
        log?.warn?.({ err: e }, `[mlsp-stay] backfill split fail stay#${stay.id}`);
      }
    }
    split += n;
    if (!n) break;
  }
  return split;
}

async function splitClosedStayIfNeeded(db, stay, log) {
  const arrived = ymd(stay.arrived_at);
  const departed = ymd(stay.actual_departed_at);
  if (!arrived || !departed) return false;
  const today = todayYmdMsk();
  const home = await findCooledFromSite(db, stay.employee_id, arrived, departed, today);
  if (!home) return false;
  const homeDate = ymd(home.date_from);
  const nextShift = await firstMlspShiftAfter(db, stay.employee_id, homeDate);
  if (!nextShift || nextShift >= departed) return false;

  const origDeparted = departed;
  const origSource = stay.departed_source || 'auto_travel';
  const origTransport = stay.transport || null;

  await db.query(`
    UPDATE mlsp_stays
       SET actual_departed_at = $2::date,
           departed_source = 'auto_travel',
           transport = COALESCE($3, transport),
           updated_at = NOW()
     WHERE id = $1
  `, [stay.id, homeDate, transportOfStage(home)]);

  await logEvent(db, stay.id, 'departed', {
    source: 'auto_travel',
    actual_departed_at: homeDate,
    split_from: origDeparted,
    assignments_untouched: true,
    backfill: true
  }, null);

  const planned = addDays(nextShift, ARRIVAL_OFFSET);
  const { rows: ins } = await db.query(`
    INSERT INTO mlsp_stays (
      employee_id, arrived_at, planned_depart_at, actual_departed_at,
      departed_source, transport, created_at, updated_at
    ) VALUES ($1, $2::date, $3::date, $4::date, $5, $6, NOW(), NOW())
    RETURNING *
  `, [stay.employee_id, nextShift, planned, origDeparted, origSource, origTransport]);
  const neu = ins[0];
  if (neu) {
    await logEvent(db, neu.id, 'opened', {
      source: 'backfill_split',
      arrived_at: nextShift,
      planned_depart_at: planned,
      split_from_stay_id: stay.id
    }, null);
    if (origDeparted) {
      await logEvent(db, neu.id, 'departed', {
        source: origSource,
        actual_departed_at: origDeparted,
        inherited: true,
        backfill: true
      }, null);
    }
    await maybeFillInboundTransport(db, neu);
  }

  log?.info?.(`[mlsp-stay] backfill split stay#${stay.id} emp#${stay.employee_id} ${arrived}→${homeDate} + ${nextShift}→${origDeparted}`);
  return true;
}

/**
 * Reconcile: бэкфилл разрезов закрытых вахт; затем цикл
 * «закрыть по from_site → открыть новую по первой смене».
 */
async function reconcileStays(db, log) {
  const splitClosed = await backfillClosedStaySplits(db, log);
  let opened = 0;
  let autoDeparted = 0;
  for (let pass = 0; pass < 8; pass++) {
    const d = await autoDepartOpenStays(db, log);
    const o = await openMissingStays(db, log);
    autoDeparted += d;
    opened += o;
    if (!d && !o) break;
  }
  return { opened, autoDeparted, splitClosed };
}

async function tryAutoDepart(db, stay, log) {
  const arrived = ymd(stay.arrived_at);
  if (!arrived) return null;
  const today = todayYmdMsk();

  // A) явный from_site внутри текущей вахты — режем, даже если потом вернулись
  const home = await findCooledFromSite(db, stay.employee_id, arrived, today, today);
  if (home) {
    const travelDate = ymd(home.date_from);
    await departStay(db, stay.id, travelDate, 'auto_travel', {
      transport: transportOfStage(home),
      closeAssignments: false,
      reason: 'Авто: дорога домой (вахта закрыта, назначение не снимаем)',
      log
    });
    log?.info?.(`[mlsp-stay] home-split emp#${stay.employee_id} dep=${travelDate} stage#${home.id}`);
    return true;
  }

  // B) вывоз ship/helicopter без direction после последней смены, без возврата
  const lastShift = await lastMlspShiftOnOrAfter(db, stay.employee_id, arrived, null);
  if (!lastShift) return null;

  const { rows: travelRows } = await db.query(`
    SELECT fts.id, fts.stage_type, fts.date_from::date AS date_from, fts.direction
    FROM field_trip_stages fts
    LEFT JOIN field_project_settings fps ON fps.work_id = fts.work_id
    WHERE fts.employee_id = $1
      AND fts.stage_type IN ('ship', 'helicopter')
      AND COALESCE(fts.status, 'active') NOT IN ('rejected', 'cancelled')
      AND fts.direction IS NULL
      AND (fts.work_id IS NULL OR fps.site_category = 'mlsp')
      AND fts.date_from::date >= $2::date
      AND fts.date_from::date >= $3::date
      AND fts.date_from::date < $4::date
      AND COALESCE((fts.created_at AT TIME ZONE 'Europe/Moscow')::date, '1900-01-01'::date) < $4::date
    ORDER BY fts.date_from ASC, fts.id ASC
    LIMIT 1
  `, [stay.employee_id, lastShift, arrived, today]);
  const travel = travelRows[0];
  if (!travel) return null;

  const travelDate = ymd(travel.date_from);
  const after = await firstMlspShiftAfter(db, stay.employee_id, travelDate);
  if (after) return null;

  await departStay(db, stay.id, travelDate, 'auto_travel', {
    transport: transportOfStage(travel),
    closeAssignments: false,
    reason: 'Авто: вывоз (судно/вертолёт), назначение не снимаем',
    log
  });
  log?.info?.(`[mlsp-stay] auto-depart emp#${stay.employee_id} dep=${travelDate}`);
  return true;
}

function enrichStayRow(row, todayYmd) {
  const today = todayYmd || todayYmdMsk();
  const arrived = ymd(row.arrived_at);
  const planned = ymd(row.planned_depart_at);
  const departed = ymd(row.actual_departed_at);
  const daysOn = arrived ? daysBetween(arrived, departed || today) + 1 : null;
  const daysLeft = (!departed && planned) ? daysBetween(today, planned) : null;
  return {
    ...row,
    arrived_at: arrived,
    planned_depart_at: planned,
    actual_departed_at: departed,
    days_on_platform: daysOn,
    days_left: daysLeft,
    is_overdue: !departed && daysLeft != null && daysLeft < 0,
    is_open: !departed
  };
}

/**
 * Visible rows for Дружина filter:
 * open always; closed ≤14d after depart unless newer stay exists.
 */
async function listVisibleStays(db, opts = {}) {
  const today = todayYmdMsk();
  const { rows } = await db.query(`
    SELECT s.*,
           COALESCE(e.fio, e.full_name) AS fio,
           e.phone, e.role_tag, e.position, e.city
    FROM mlsp_stays s
    JOIN employees e ON e.id = s.employee_id
    WHERE COALESCE(e.is_active, true) = true
      AND COALESCE(e.is_se_payee, false) = false
      AND (
        s.actual_departed_at IS NULL
        OR (
          s.actual_departed_at >= ($2::date - $1::int)
          AND NOT EXISTS (
            SELECT 1 FROM mlsp_stays s2
            WHERE s2.employee_id = s.employee_id
              AND s2.id > s.id
          )
        )
      )
    ORDER BY
      CASE WHEN s.actual_departed_at IS NULL THEN 0 ELSE 1 END,
      s.planned_depart_at ASC NULLS LAST,
      e.fio
  `, [VISIBLE_AFTER_DEPART_DAYS, today]);

  const empIds = rows.map((r) => r.employee_id);
  const worksByEmp = {};
  if (empIds.length) {
    const { rows: works } = await db.query(`
      SELECT ea.employee_id, ea.work_id, w.work_title, w.pm_id, pm.name AS pm_name,
             ea.is_active, ea.departure_date
      FROM employee_assignments ea
      JOIN works w ON w.id = ea.work_id AND w.deleted_at IS NULL
      JOIN field_project_settings fps ON fps.work_id = ea.work_id AND fps.site_category = 'mlsp'
      LEFT JOIN users pm ON pm.id = w.pm_id
      WHERE ea.employee_id = ANY($1::int[])
        AND (
          (COALESCE(ea.is_active, true) = true AND ea.departure_date IS NULL)
          OR ea.departure_date >= (CURRENT_DATE - $2::int)
        )
      ORDER BY ea.id DESC
    `, [empIds, VISIBLE_AFTER_DEPART_DAYS]);
    for (const w of works) {
      if (!worksByEmp[w.employee_id]) worksByEmp[w.employee_id] = [];
      worksByEmp[w.employee_id].push({
        work_id: w.work_id,
        work_title: w.work_title,
        pm_id: w.pm_id,
        pm_name: w.pm_name,
        is_active: w.is_active !== false && !w.departure_date
      });
    }
  }

  let items = rows.map((r) => {
    const en = enrichStayRow(r, today);
    en.works = worksByEmp[r.employee_id] || [];
    return en;
  });

  if (opts.seg === 'open' || opts.seg === 'all' || !opts.seg) {
    // default: all visible
  }
  if (opts.seg === 'd14') {
    items = items.filter((i) => i.is_open && i.days_left != null && i.days_left <= 14);
  } else if (opts.seg === 'd7') {
    items = items.filter((i) => i.is_open && i.days_left != null && i.days_left <= 7);
  } else if (opts.seg === 'over') {
    items = items.filter((i) => i.is_overdue);
  } else if (opts.seg === 'left') {
    items = items.filter((i) => !i.is_open);
  } else if (opts.seg === 'on_platform') {
    items = items.filter((i) => i.is_open);
  }

  if (opts.q) {
    const q = String(opts.q).toLowerCase().trim();
    items = items.filter((i) =>
      (i.fio || '').toLowerCase().includes(q) ||
      (i.phone || '').includes(q)
    );
  }

  return items;
}

async function loadNotifyUserIds(db) {
  const { rows } = await db.query(`
    SELECT value_json FROM settings WHERE key = 'mlsp_stay_notify_user_ids' LIMIT 1
  `);
  let ids = [];
  try {
    const raw = rows[0]?.value_json;
    ids = typeof raw === 'string' ? JSON.parse(raw) : (raw || []);
  } catch { ids = []; }
  if (!Array.isArray(ids)) ids = [];
  return ids.map((x) => parseInt(x, 10)).filter(Boolean);
}

module.exports = {
  STAY_DAYS,
  ARRIVAL_OFFSET,
  AUTO_DEPART_IDLE_DAYS,
  HOME_SPLIT_COOLING_DAYS,
  VISIBLE_AFTER_DEPART_DAYS,
  NOTIFY_DAYS,
  ymd,
  todayYmdMsk,
  addDays,
  daysBetween,
  isHomeRoadCooled,
  ensureOpenStay,
  getOpenStay,
  firstMlspShiftDate,
  isMlspWork,
  departStay,
  extendStay,
  reopenAutoStay,
  closeMlspAssignments,
  reconcileStays,
  tryAutoDepart,
  backfillClosedStaySplits,
  listVisibleStays,
  enrichStayRow,
  loadNotifyUserIds,
  logEvent
};
