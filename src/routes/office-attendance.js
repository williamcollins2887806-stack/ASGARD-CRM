'use strict';

/**
 * API учёта часов офиса по СКУД.
 * Prefix: /api/office-attendance
 *
 * Чтение: ADMIN, DIRECTORS, OFFICE_MANAGER, HR, HR_MANAGER, HEAD_PM, HEAD_TO,
 *         BUH (нужен для начисления), плюс любой сотрудник по СЕБЕ (/me).
 * Запись: ADMIN, DIRECTORS, OFFICE_MANAGER.
 *
 * Ручная загрузка файла здесь — аварийный путь. Рабочий режим: письмо на ящик
 * CRM → src/services/skud-mail-intake.js, страховка — skud-mail-cron.js.
 */

const officeHours = require('../services/office-hours');
const skudImport = require('../services/skud-import');
const skudPeople = require('../services/skud-people');
const crmActivity = require('../services/crm-activity');
const { hhmmWallClock, wallClockStamp, isoFromWallClock } = require('../lib/msk');

const DIRECTOR_ROLES = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const READ_ROLES = [
  'ADMIN', ...DIRECTOR_ROLES, 'OFFICE_MANAGER',
  'HR', 'HR_MANAGER', 'HEAD_PM', 'HEAD_TO', 'BUH', 'CHIEF_ENGINEER'
];
const WRITE_ROLES = ['ADMIN', ...DIRECTOR_ROLES, 'OFFICE_MANAGER'];
const REPORTS_ROLES = ['ADMIN', ...DIRECTOR_ROLES, 'OFFICE_MANAGER', 'HR', 'HR_MANAGER', 'BUH'];

/** Полный обзор чужих часов (дашборд компании). Остальные роли — только себя. */
function canReadAllHours(role) {
  return READ_ROLES.includes(role);
}

function pad2(n) { return String(n).padStart(2, '0'); }

/** Минуты → часы с одним знаком: 475 → 7.9. */
function h(minutes) {
  return Math.round((Number(minutes) || 0) / 6) / 10;
}

/** Минуты → «7:55». */
function hm(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  return `${Math.floor(m / 60)}:${pad2(m % 60)}`;
}

module.exports = async function (fastify, options) {
  const db = fastify.db;

  // ───────────────────────────────────────────────────────────────────
  // POST /import — ручная (аварийная) загрузка файла отчёта
  // ───────────────────────────────────────────────────────────────────
  fastify.post('/import', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    let data;
    try {
      data = await request.file();
    } catch (e) {
      return reply.code(400).send({ error: 'file_required', message: 'Загрузите файл отчёта (.xls/.xlsx/.zip)' });
    }
    if (!data) {
      return reply.code(400).send({ error: 'file_required', message: 'Загрузите файл отчёта (.xls/.xlsx/.zip)' });
    }

    const allowOverlap = String(request.query.allow_overlap || '') === '1';
    let buffer;
    try {
      buffer = await data.toBuffer();
    } catch (e) {
      return reply.code(400).send({ error: 'file_too_large', message: 'Не удалось прочитать файл: ' + e.message });
    }

    try {
      const result = await skudImport.importSkudReport(db, {
        buffer,
        filename: data.filename,
        source: 'manual',
        importedBy: request.user.id,
        allowPeriodOverlap: allowOverlap
      });
      if (result.skipped) {
        return reply.code(409).send({
          error: result.skipped,
          message: result.message,
          import_id: result.importId,
          period: result.periodFrom ? { from: result.periodFrom, to: result.periodTo } : null,
          conflict_period: result.conflictPeriod || null
        });
      }
      return { ok: true, ...result };
    } catch (e) {
      if (e instanceof skudImport.ImportError) {
        return reply.code(e.statusCode || 400).send({ error: e.code, message: e.message });
      }
      request.log.error(e);
      return reply.code(500).send({ error: 'import_failed', message: e.message });
    }
  });

  // ───────────────────────────────────────────────────────────────────
  // GET /imports — история импортов
  // ───────────────────────────────────────────────────────────────────
  fastify.get('/imports', {
    preHandler: [fastify.requireRoles(READ_ROLES)]
  }, async (request) => {
    const limit = Math.min(200, Math.max(1, parseInt(request.query.limit || '50', 10) || 50));
    const { rows } = await db.query(
      `SELECT si.id, si.period_from::text AS period_from, si.period_to::text AS period_to,
              si.file_name, si.sha256, si.rows_total, si.rows_used,
              si.people_total, si.people_mapped, si.unmatched_json,
              si.source, si.email_id, si.imported_by,
              si.imported_at, si.deleted_at,
              u.name AS imported_by_name
         FROM skud_imports si
         LEFT JOIN users u ON u.id = si.imported_by
        ORDER BY si.id DESC LIMIT $1`,
      [limit]
    );
    return {
      ok: true,
      imports: rows.map((r) => ({
        ...r,
        unmatched: r.unmatched_json || [],
        unmatched_json: undefined
      }))
    };
  });

  // ───────────────────────────────────────────────────────────────────
  // DELETE /imports/:id — откат импорта
  // ───────────────────────────────────────────────────────────────────
  fastify.delete('/imports/:id', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad_id' });
    try {
      const res = await skudImport.revertImport(db, id, request.user.id);
      return { ok: true, ...res };
    } catch (e) {
      if (e instanceof skudImport.ImportError) {
        return reply.code(e.statusCode || 400).send({ error: e.code, message: e.message });
      }
      request.log.error(e);
      return reply.code(500).send({ error: 'revert_failed', message: e.message });
    }
  });

  // ───────────────────────────────────────────────────────────────────
  // GET /day?staff_id&date — раскрытие дня: проходы, интервалы, часы СРМ
  // РП/обычный сотрудник — только свой день; полный доступ — READ_ROLES.
  // ───────────────────────────────────────────────────────────────────
  fastify.get('/day', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const staffId = parseInt(request.query.staff_id, 10);
    const date = String(request.query.date || '').slice(0, 10);
    if (!Number.isFinite(staffId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.code(400).send({ error: 'staff_id и date обязательны' });
    }

    const settings = await officeHours.loadSettings(db);
    const { rows: st } = await db.query(
      `SELECT s.id AS staff_id, s.user_id, COALESCE(NULLIF(btrim(u.name),''), s.name) AS name,
              u.role, s.name AS staff_name
         FROM staff s LEFT JOIN users u ON u.id = s.user_id
        WHERE s.id = $1`,
      [staffId]
    );
    if (!st.length) return reply.code(404).send({ error: 'staff_not_found' });
    const staff = st[0];
    if (!canReadAllHours(request.user.role) && Number(staff.user_id) !== Number(request.user.id)) {
      return reply.code(403).send({
        error: 'forbidden',
        message: 'Смотреть чужие дни может только руководитель или офис-менеджер'
      });
    }

    const { rows: hoursRows } = await db.query(
      `SELECT office_minutes, open_ended, skud_missing, first_in, last_out, segments,
              manual_minutes, manual_reason, import_id
         FROM office_hours_daily WHERE staff_id = $1 AND date = $2::date`,
      [staffId, date]
    );
    const day = hoursRows[0] || null;

    const { rows: planRows } = await db.query(
      `SELECT status_code, note, updated_at FROM staff_plan
        WHERE staff_id = $1 AND date = $2::date ORDER BY id DESC LIMIT 1`,
      [staffId, date]
    );
    const plan = planRows[0] || null;

    const { rows: punches } = await db.query(
      `SELECT to_char(ts,'HH24:MI:SS') AS time, direction, event, device
         FROM skud_punches sp
         JOIN skud_imports si ON si.id = sp.import_id AND si.deleted_at IS NULL
        WHERE sp.raw_person IN (
                SELECT raw_name FROM skud_person_map WHERE staff_id = $1 AND matched_by <> 'skip'
              )
          AND sp.date = $2::date
        ORDER BY sp.ts`,
      [staffId, date]
    );

    const { rows: flags } = await db.query(
      `SELECT id, reason, prev_status, new_status, resolved_at, resolved_status,
              resolved_comment, created_at
         FROM office_presence_flags WHERE staff_id = $1 AND date = $2::date`,
      [staffId, date]
    );

    const crm = await officeHours.crmMinutesForDay(db, staff.user_id, date, settings);
    const calendar = await officeHours.loadCalendar(db, date, date);
    const norm = officeHours.dayNormMinutes(date, calendar, settings, staffId);

    const officeMinutes = day && day.manual_minutes != null
      ? Number(day.manual_minutes)
      : Number(day ? day.office_minutes : 0);
    let officeSegments = [];
    if (day && day.segments) {
      try {
        officeSegments = typeof day.segments === 'string' ? JSON.parse(day.segments) : day.segments;
      } catch (_) { officeSegments = []; }
    }

    const credit = officeHours.creditDay({
      date,
      statusCode: plan ? plan.status_code : null,
      officeMinutes,
      crmMinutes: crm.minutes,
      crmSessions: crm.sessions || [],
      officeSegments,
      crmHasData: crm.hasData,
      skudMissing: !day,
      normMinutes: norm
    });

    return {
      ok: true,
      date,
      staff: {
        staff_id: staff.staff_id,
        user_id: staff.user_id,
        name: staff.name || staff.staff_name,
        role: staff.role || ''
      },
      status: plan ? plan.status_code : null,
      status_note: plan ? plan.note : null,
      norm_minutes: norm,
      norm_text: hm(norm),
      office_minutes: officeMinutes,
      office_text: hm(officeMinutes),
      manual: day && day.manual_minutes != null
        ? { minutes: day.manual_minutes, reason: day.manual_reason }
        : null,
      open_ended: !!(day && day.open_ended),
      skud_missing: !day,
      segments: day ? (day.segments || []) : [],
      punches,
      crm: { minutes: crm.minutes, text: hm(crm.minutes), sessions: crm.sessions, has_data: crm.hasData },
      credit,
      flags
    };
  });

  // ───────────────────────────────────────────────────────────────────
  // GET /month?year&month — дашборд графика офиса
  // Админ/директор/ОМ/HR… — вся компания.
  // РП и остальные — только СВОЯ строка + личный дашборд (scope=self).
  // Иначе РП получал 403 и в графике не было ни цифр, ни дашборда.
  // ───────────────────────────────────────────────────────────────────
  fastify.get('/month', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    // Месяц по умолчанию — из МОСКОВСКОЙ даты, а не из локальной зоны процесса.
    // Иначе в первые часы после смены месяца «неделя» уходила в чужой месяц
    // (верификатор 03.11.2026, P3-3).
    const todayIsoMsk = officeHours.isoOf(new Date());
    const year = parseInt(request.query.year || todayIsoMsk.slice(0, 4), 10);
    const month = parseInt(request.query.month || todayIsoMsk.slice(5, 7), 10);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      return reply.code(400).send({ error: 'bad_year_month' });
    }

    const fullAccess = canReadAllHours(request.user && request.user.role);
    const range = officeHours.monthRange(year, month);
    const settings = await officeHours.loadSettings(db);
    const calendar = await officeHours.loadCalendar(db, range.from, range.to);

    // Кто в графике офиса
    const { rows: staffAll } = await db.query(`
      SELECT s.id AS staff_id, s.user_id,
             COALESCE(NULLIF(btrim(u.name), ''), s.name) AS name,
             u.role
        FROM staff s
        LEFT JOIN users u ON u.id = s.user_id
       WHERE COALESCE(s.is_active, true) = true
         AND (u.id IS NULL OR (
               COALESCE(u.is_active, true) = true
               AND COALESCE(u.role, '') NOT IN ('BOT', 'ADMIN', 'FIELD_WORKER')
               AND LOWER(u.login) NOT LIKE 'test_%'
               AND LOWER(COALESCE(u.name, '')) NOT LIKE 'test %'
               AND LOWER(COALESCE(u.name, '')) NOT LIKE 'тест %'
         ))
       ORDER BY COALESCE(NULLIF(btrim(u.name), ''), s.name)`);
    let staffRows = staffAll;
    if (!fullAccess) {
      const uid = Number(request.user.id);
      staffRows = staffAll.filter((s) => Number(s.user_id) === uid);
      if (!staffRows.length) {
        // Аккаунт без строки staff — пустой ответ, не 403: график всё равно рисуется.
        const emptySum = {
          norm_minutes: 0, credited_minutes: 0, office_minutes: 0, crm_minutes: 0, delta_minutes: 0,
          norm_hours: 0, credited_hours: 0, delta_hours: 0, office_hours: 0, crm_hours: 0
        };
        return {
          ok: true,
          scope: 'self',
          year,
          month,
          period: range,
          settings: {
            norm_hours_per_day: settings.norm_hours_per_day,
            norm_hours_per_week: settings.norm_hours_per_week,
            crm_activity_since: settings.crm_activity_since,
            merge_gap_min: settings.merge_gap_min,
            crm_session_gap_min: settings.crm_session_gap_min
          },
          me: {
            staff_id: null, name: null,
            month: { ...emptySum },
            week: { from: null, to: null, ...emptySum },
            flags: { total: 0, open: 0 }
          },
          week: { from: null, to: null, ...emptySum },
          company: { ...emptySum, flags_total: 0, flags_open: 0 },
          people: []
        };
      }
    }

    const { rows: planRows } = await db.query(
      `SELECT DISTINCT ON (staff_id, date) staff_id, date::text AS date, status_code
         FROM staff_plan
        WHERE date >= $1::date AND date <= $2::date
          AND status_code IS NOT NULL AND btrim(status_code) <> ''
        ORDER BY staff_id, date, id DESC`,
      [range.from, range.to]
    );
    const planMap = new Map();
    planRows.forEach((r) => planMap.set(`${r.staff_id}|${String(r.date).slice(0, 10)}`, r.status_code));

    const { rows: hoursRows } = await db.query(
      `SELECT staff_id, date::text AS date, office_minutes, open_ended, skud_missing,
              manual_minutes, segments
         FROM office_hours_daily
        WHERE date >= $1::date AND date <= $2::date`,
      [range.from, range.to]
    );
    const hoursMap = new Map();
    hoursRows.forEach((r) => hoursMap.set(`${r.staff_id}|${String(r.date).slice(0, 10)}`, r));

    // Часы СРМ за месяц одним запросом: считаем по всем сотрудникам сразу,
    // иначе получается N×M запросов.
    const userIds = staffRows.map((s) => s.user_id).filter(Boolean);
    const crmMap = await loadCrmMonth(db, userIds, range.from, range.to, settings);

    const { rows: flagRows } = await db.query(
      `SELECT staff_id, COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE resolved_at IS NULL)::int AS open
         FROM office_presence_flags
        WHERE date >= $1::date AND date <= $2::date
        GROUP BY staff_id`,
      [range.from, range.to]
    );
    const flagMap = new Map(flagRows.map((r) => [r.staff_id, { total: r.total, open: r.open }]));

    const people = staffRows.map((s) => {
      const days = [];
      let iso = range.from;
      while (iso <= range.to) {
        const key = `${s.staff_id}|${iso}`;
        const plan = planMap.get(key) || null;
        const hr = hoursMap.get(key) || null;
        const crmDay = s.user_id
          ? (crmMap.get(`${s.user_id}|${iso}`) || { minutes: 0, hasData: false, sessions: [] })
          : { minutes: 0, hasData: false, sessions: [] };
        const officeMinutes = hr && hr.manual_minutes != null ? Number(hr.manual_minutes) : Number(hr ? hr.office_minutes : 0);
        const officeSegments = parseSegments(hr && hr.segments);
        const norm = officeHours.dayNormMinutes(iso, calendar, settings, s.staff_id);
        const credit = officeHours.creditDay({
          date: iso,
          statusCode: plan,
          officeMinutes,
          crmMinutes: crmDay.minutes,
          crmSessions: crmDay.sessions || [],
          officeSegments,
          crmHasData: crmDay.hasData,
          skudMissing: !hr,
          normMinutes: norm
        });
        days.push({
          ...credit,
          open_ended: !!(hr && hr.open_ended),
          skud_missing: !hr,
          has_crm_data: crmDay.hasData
        });
        iso = officeHours.addDays(iso, 1);
      }
      const flags = flagMap.get(s.staff_id) || { total: 0, open: 0 };
      return {
        staff_id: s.staff_id,
        user_id: s.user_id,
        name: s.name,
        role: s.role || '',
        days,
        month: officeHours.summarizeDays(days),
        flags
      };
    });

    // Итоги по компании: только люди, у кого вообще есть норма в этом месяце.
    const company = people.reduce((acc, p) => {
      acc.norm_minutes += p.month.norm_minutes;
      acc.credited_minutes += p.month.credited_minutes;
      acc.office_minutes += p.month.office_minutes;
      acc.crm_minutes += p.month.crm_minutes;
      acc.delta_minutes += p.month.delta_minutes;
      acc.flags_total += p.flags.total;
      acc.flags_open += p.flags.open;
      return acc;
    }, {
      norm_minutes: 0, credited_minutes: 0, office_minutes: 0,
      crm_minutes: 0, delta_minutes: 0, flags_total: 0, flags_open: 0
    });

    // Текущая неделя — отдельным блоком (заказчик просил «за неделю»).
    const todayIso = officeHours.isoOf(new Date());
    const monday = officeHours.mondayOf(todayIso);
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const iso = officeHours.addDays(monday, i);
      if (iso > range.to || iso < range.from) continue;
      weekDays.push(iso);
    }
    const week = people.reduce((acc, p) => {
      const wd = p.days.filter((d) => weekDays.includes(d.date));
      if (!wd.length) return acc;
      const s = officeHours.summarizeDays(wd);
      acc.norm_minutes += s.norm_minutes;
      acc.credited_minutes += s.credited_minutes;
      acc.office_minutes += s.office_minutes;
      acc.crm_minutes += s.crm_minutes;
      acc.delta_minutes += s.delta_minutes;
      return acc;
    }, { norm_minutes: 0, credited_minutes: 0, office_minutes: 0, crm_minutes: 0, delta_minutes: 0 });

    // Личный блок — всегда, даже у админа/директора с полным обзором.
    // Иначе непонятно: цифры сверху — «по всем» или «по мне».
    const myUid = Number(request.user && request.user.id);
    let mePerson = people.find((p) => Number(p.user_id) === myUid) || null;
    if (!mePerson && fullAccess && Number.isFinite(myUid)) {
      // Админ часто исключён из staff-выборки (роль ADMIN) — ищем отдельно.
      const { rows: myStaff } = await db.query(
        `SELECT s.id AS staff_id, s.user_id,
                COALESCE(NULLIF(btrim(u.name), ''), s.name) AS name, u.role
           FROM staff s LEFT JOIN users u ON u.id = s.user_id
          WHERE s.user_id = $1
          ORDER BY s.id LIMIT 1`,
        [myUid]
      );
      if (myStaff.length) {
        const s = myStaff[0];
        const myCrm = s.user_id
          ? await loadCrmMonth(db, [s.user_id], range.from, range.to, settings)
          : new Map();
        const days = [];
        let iso = range.from;
        while (iso <= range.to) {
          const key = `${s.staff_id}|${iso}`;
          const plan = planMap.get(key) || null;
          const hr = hoursMap.get(key) || null;
          const crmDay = s.user_id
            ? (myCrm.get(`${s.user_id}|${iso}`) || { minutes: 0, hasData: false, sessions: [] })
            : { minutes: 0, hasData: false, sessions: [] };
          const officeMinutes = hr && hr.manual_minutes != null
            ? Number(hr.manual_minutes)
            : Number(hr ? hr.office_minutes : 0);
          const norm = officeHours.dayNormMinutes(iso, calendar, settings, s.staff_id);
          const credit = officeHours.creditDay({
            date: iso,
            statusCode: plan,
            officeMinutes,
            crmMinutes: crmDay.minutes,
            crmSessions: crmDay.sessions || [],
            officeSegments: parseSegments(hr && hr.segments),
            crmHasData: crmDay.hasData,
            skudMissing: !hr,
            normMinutes: norm
          });
          days.push({
            ...credit,
            open_ended: !!(hr && hr.open_ended),
            skud_missing: !hr,
            has_crm_data: crmDay.hasData
          });
          iso = officeHours.addDays(iso, 1);
        }
        mePerson = {
          staff_id: s.staff_id,
          user_id: s.user_id,
          name: s.name,
          role: s.role || '',
          days,
          month: officeHours.summarizeDays(days),
          flags: flagMap.get(s.staff_id) || { total: 0, open: 0 }
        };
      }
    }
    const meMonth = mePerson ? mePerson.month : {
      norm_minutes: 0, credited_minutes: 0, office_minutes: 0, crm_minutes: 0, delta_minutes: 0
    };
    const meWeekDays = mePerson
      ? mePerson.days.filter((d) => weekDays.includes(d.date))
      : [];
    const meWeek = meWeekDays.length
      ? officeHours.summarizeDays(meWeekDays)
      : { norm_minutes: 0, credited_minutes: 0, office_minutes: 0, crm_minutes: 0, delta_minutes: 0 };

    const packHours = (obj) => ({
      ...obj,
      norm_hours: h(obj.norm_minutes),
      credited_hours: h(obj.credited_minutes),
      delta_hours: h(obj.delta_minutes),
      office_hours: h(obj.office_minutes),
      crm_hours: h(obj.crm_minutes)
    });

    return {
      ok: true,
      // company = все, кого видит роль; self = только я (РП и др.)
      scope: fullAccess ? 'company' : 'self',
      year, month,
      period: range,
      settings: {
        norm_hours_per_day: settings.norm_hours_per_day,
        norm_hours_per_week: settings.norm_hours_per_week,
        crm_activity_since: settings.crm_activity_since,
        merge_gap_min: settings.merge_gap_min,
        crm_session_gap_min: settings.crm_session_gap_min
      },
      // Всегда личные цифры текущего пользователя
      me: {
        staff_id: mePerson ? mePerson.staff_id : null,
        name: mePerson ? mePerson.name : null,
        month: packHours(meMonth),
        week: {
          from: weekDays[0] || null,
          to: weekDays[weekDays.length - 1] || null,
          ...packHours(meWeek)
        },
        flags: mePerson ? mePerson.flags : { total: 0, open: 0 }
      },
      week: {
        from: weekDays[0] || null,
        to: weekDays[weekDays.length - 1] || null,
        ...packHours(week)
      },
      company: {
        ...company,
        ...packHours(company)
      },
      people
    };
  });

  // ───────────────────────────────────────────────────────────────────
  // GET /me?from&to[&staff_id] — личный отчёт сотрудника
  //   staff_id — только для офис-менеджера/директора: посмотреть день
  //   конкретного человека (иначе каждый видит лишь себя).
  // ───────────────────────────────────────────────────────────────────
  fastify.get('/me', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const userId = request.user && request.user.id;
    if (!userId) return reply.code(401).send({ error: 'no_user' });

    const settings = await officeHours.loadSettings(db);
    const todayIso = officeHours.isoOf(new Date());
    let from = String(request.query.from || '').slice(0, 10);
    let to = String(request.query.to || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) from = officeHours.mondayOf(todayIso);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) to = officeHours.addDays(from, 6);
    if (to < from) return reply.code(400).send({ error: 'bad_range' });

    // Чужой staff_id — только управленческим ролям.
    const requestedStaffId = parseInt(request.query.staff_id, 10);
    let staffId;
    if (Number.isFinite(requestedStaffId)) {
      const role = request.user.role;
      const canViewOthers = ['ADMIN', ...DIRECTOR_ROLES, 'OFFICE_MANAGER', 'HR', 'HR_MANAGER']
        .includes(role);
      if (!canViewOthers) {
        return reply.code(403).send({ error: 'forbidden', message: 'Смотреть чужие дни может только руководитель или офис-менеджер' });
      }
      const { rows: own } = await db.query(`SELECT id FROM staff WHERE id = $1`, [requestedStaffId]);
      if (!own.length) return reply.code(404).send({ error: 'staff_not_found' });
      staffId = requestedStaffId;
    } else {
      const { rows: st } = await db.query(
        `SELECT id AS staff_id FROM staff WHERE user_id = $1 ORDER BY id LIMIT 1`, [userId]
      );
      if (!st.length) {
        return reply.code(404).send({
          error: 'no_staff_row',
          message: 'Для вашего аккаунта нет строки в графике офиса'
        });
      }
      staffId = st[0].staff_id;
    }

    // Для /me нужен users.id владельца строки staff (часы СРМ лежат по нему).
    const { rows: owner } = await db.query(`SELECT user_id FROM staff WHERE id = $1`, [staffId]);
    const ownerUserId = (owner[0] && owner[0].user_id) || null;

    const calendar = await officeHours.loadCalendar(db, from, to);
    const { rows: planRows } = await db.query(
      `SELECT DISTINCT ON (date) date::text AS date, status_code FROM staff_plan
        WHERE staff_id = $1 AND date >= $2::date AND date <= $3::date
        ORDER BY date, id DESC`,
      [staffId, from, to]
    );
    const planMap = new Map(planRows.map((r) => [String(r.date).slice(0, 10), r.status_code]));

    const { rows: hoursRows } = await db.query(
      `SELECT date::text AS date, office_minutes, open_ended, manual_minutes, segments
         FROM office_hours_daily
        WHERE staff_id = $1 AND date >= $2::date AND date <= $3::date`,
      [staffId, from, to]
    );
    const hoursMap = new Map(hoursRows.map((r) => [String(r.date).slice(0, 10), r]));

    const crmRange = await crmActivity.activityRange(db, ownerUserId, from, to);

    const { rows: flagRows } = await db.query(
      `SELECT date::text AS date, reason, resolved_at, resolved_status
         FROM office_presence_flags
        WHERE staff_id = $1 AND date >= $2::date AND date <= $3::date`,
      [staffId, from, to]
    );
    const flagMap = new Map(flagRows.map((r) => [String(r.date).slice(0, 10), r]));

    const days = [];
    let iso = from;
    while (iso <= to) {
      const plan = planMap.get(iso) || null;
      const hr = hoursMap.get(iso) || null;
      const crmDay = crmRange[iso] || { totalMinutes: 0, sessions: [] };
      const officeMinutes = hr && hr.manual_minutes != null ? Number(hr.manual_minutes) : Number(hr ? hr.office_minutes : 0);
      const norm = officeHours.dayNormMinutes(iso, calendar, settings, staffId);
      const credit = officeHours.creditDay({
        date: iso,
        statusCode: plan,
        officeMinutes,
        crmMinutes: crmDay.totalMinutes || 0,
        crmSessions: crmDay.sessions || [],
        officeSegments: parseSegments(hr && hr.segments),
        crmHasData: (crmDay.sessions || []).length > 0,
        skudMissing: !hr,
        normMinutes: norm
      });
      days.push({
        ...credit,
        status_text: statusLabel(plan),
        office_text: hm(officeMinutes),
        crm_text: hm(crmDay.totalMinutes || 0),
        crm_remote_text: hm(credit.crm_remote_minutes || 0),
        norm_text: hm(norm),
        credited_text: hm(credit.credited_minutes),
        open_ended: !!(hr && hr.open_ended),
        flag: flagMap.get(iso) || null
      });
      iso = officeHours.addDays(iso, 1);
    }

    const summary = officeHours.summarizeDays(days);

    // Неделя и месяц отдельно: заказчик просил «за месяц столько, за неделю столько».
    const monthRange = officeHours.monthRange(
      parseInt(todayIso.slice(0, 4), 10),
      parseInt(todayIso.slice(5, 7), 10)
    );
    const monthSummary = await summarizeStaffPeriod(db, staffId, ownerUserId, monthRange.from, monthRange.to, settings, calendar, crmActivity);

    return {
      ok: true,
      staff_id: staffId,
      from, to,
      settings: {
        norm_hours_per_day: settings.norm_hours_per_day,
        norm_hours_per_week: settings.norm_hours_per_week,
        crm_activity_since: settings.crm_activity_since
      },
      summary,
      summary_text: shortfallText(summary),
      month: monthSummary,
      month_text: shortfallText(monthSummary),
      days
    };
  });

  // ───────────────────────────────────────────────────────────────────
  // GET /self-check?date — «сколько учтено сегодня и из чего»
  // ───────────────────────────────────────────────────────────────────
  fastify.get('/self-check', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const userId = request.user && request.user.id;
    if (!userId) return reply.code(401).send({ error: 'no_user' });
    const date = String(request.query.date || officeHours.isoOf(new Date())).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply.code(400).send({ error: 'bad_date' });

    const settings = await officeHours.loadSettings(db);
    const crm = await officeHours.crmMinutesForDay(db, userId, date, settings);
    const last = (crm.sessions || [])[crm.sessions.length - 1] || null;

    return {
      ok: true,
      date,
      crm_minutes: crm.minutes,
      crm_text: hm(crm.minutes),
      sessions: crm.sessions,
      has_data: crm.hasData,
      last_activity: last ? last.to : null,
      message: crm.hasData
        ? `Сегодня учтено ${hm(crm.minutes)} в ${crm.sessions.length} сессиях, последняя активность в ${last.to}`
        : 'Сегодня активности в СРМ ещё не было',
      since: settings.crm_activity_since
    };
  });

  // ───────────────────────────────────────────────────────────────────
  // GET /unmatched — ФИО из СКУД без привязки (простой список)
  // ───────────────────────────────────────────────────────────────────
  fastify.get('/unmatched', {
    preHandler: [fastify.requireRoles(REPORTS_ROLES)]
  }, async () => {
    const items = await skudPeople.pendingMappings(db);
    return { ok: true, count: items.length, items };
  });

  // ───────────────────────────────────────────────────────────────────
  // GET /pending-map — данные для баннера офис-менеджеру
  // ───────────────────────────────────────────────────────────────────
  fastify.get('/pending-map', {
    preHandler: [fastify.requireRoles(REPORTS_ROLES)]
  }, async () => {
    const items = await skudPeople.pendingMappings(db);
    return { ok: true, count: items.length, items };
  });

  // ───────────────────────────────────────────────────────────────────
  // POST /map — привязка ФИО к сотруднику (или «в CRM нет»)
  // ───────────────────────────────────────────────────────────────────
  fastify.post('/map', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const body = request.body || {};
    const rawName = String(body.raw_name || '').trim();
    if (!rawName) return reply.code(400).send({ error: 'raw_name_required' });

    const skip = body.skip === true;
    let staffId = null;
    let userId = null;

    if (!skip) {
      staffId = parseInt(body.staff_id, 10);
      if (!Number.isFinite(staffId)) return reply.code(400).send({ error: 'staff_id_required' });
      const { rows } = await db.query(`SELECT id, user_id FROM staff WHERE id = $1`, [staffId]);
      if (!rows.length) return reply.code(404).send({ error: 'staff_not_found' });
      userId = rows[0].user_id || null;
    }

    await skudPeople.upsertMapping(db, {
      rawName,
      staffId,
      userId,
      matchedBy: skip ? 'skip' : 'manual',
      confidence: 1,
      createdBy: request.user.id
    });

    // Пересчёт: часы этого ФИО должны лечь на сотрудника за все периоды.
    const recount = skip ? { written: 0 } : await recountPerson(db, rawName, staffId);

    // ВАЖНО (верификатор 03.11.2026, P1-4): после привязки нужно заново
    // прогнать детектор ложных «оф». Иначе получалось абсурдное состояние:
    // часы человека пересчитаны и проходы есть, а день всё ещё «нп» и он
    // обязан отвечать на вопрос «где ты был». Порядок обязателен —
    // сначала часы, потом детектор, иначе тот снова увидит 0 минут.
    let reopened = 0;
    if (!skip) {
      reopened = await reopenUnconfirmedDays(db, staffId);
      await db.query(
        `UPDATE office_presence_flags
            SET resolved_at = NOW(),
                resolved_status = 'оф',
                resolved_comment = COALESCE(resolved_comment, 'авто: часы подтверждены после привязки ФИО СКУД')
          WHERE staff_id = $1 AND resolved_at IS NULL
            AND EXISTS (
              SELECT 1 FROM office_hours_daily oh
               WHERE oh.staff_id = office_presence_flags.staff_id
                 AND oh.date = office_presence_flags.date
                 AND COALESCE(oh.manual_minutes, oh.office_minutes) > 0
            )`,
        [staffId]
      );
    }

    return {
      ok: true, raw_name: rawName, staff_id: staffId, skipped: skip,
      recounted_days: recount.written, restored_days: reopened
    };
  });

  // ───────────────────────────────────────────────────────────────────
  // GET /reports-status?month — приходил ли отчёт за каждый день
  // ───────────────────────────────────────────────────────────────────
  fastify.get('/reports-status', {
    preHandler: [fastify.requireRoles(REPORTS_ROLES)]
  }, async (request, reply) => {
    const todayIsoMsk = officeHours.isoOf(new Date());
    const year = parseInt(request.query.year || todayIsoMsk.slice(0, 4), 10);
    const month = parseInt(request.query.month || todayIsoMsk.slice(5, 7), 10);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      return reply.code(400).send({ error: 'bad_year_month' });
    }
    const range = officeHours.monthRange(year, month);
    const settings = await officeHours.loadSettings(db);
    const calendar = await officeHours.loadCalendar(db, range.from, range.to);

    const { rows } = await db.query(
      `SELECT id, period_from::text AS period_from, period_to::text AS period_to,
              imported_at, source, file_name
         FROM skud_imports
        WHERE deleted_at IS NULL
          AND period_from <= $2::date AND period_to >= $1::date
        ORDER BY period_from`,
      [range.from, range.to]
    );

    const todayIso = officeHours.isoOf(new Date());
    const days = [];
    let iso = range.from;
    while (iso <= range.to) {
      const cover = rows.find((r) => r.period_from <= iso && r.period_to >= iso);
      const isFuture = iso > todayIso;
      const working = officeHours.isWorkingDay(iso, calendar);
      days.push({
        date: iso,
        is_working: working,
        is_future: isFuture,
        status: cover ? 'ok' : (isFuture ? 'future' : (working ? 'missing' : 'dayoff')),
        import_id: cover ? cover.id : null,
        imported_at: cover ? cover.imported_at : null,
        source: cover ? cover.source : null
      });
      iso = officeHours.addDays(iso, 1);
    }

    const missing = days.filter((d) => d.status === 'missing');
    return {
      ok: true,
      year, month, period: range,
      days,
      missing_count: missing.length,
      missing_dates: missing.map((d) => d.date),
      last_import_at: rows.length ? rows[rows.length - 1].imported_at : null,
      notify_roles: settings.notify_roles || ['OFFICE_MANAGER']
    };
  });

  // ───────────────────────────────────────────────────────────────────
  // GET /flags?year&month — снятые ложные «оф»
  // Полный доступ — все; остальные роли — только свои флаги (иначе 403
  // и модалка «Снятые отметки» у РП писала «Не удалось загрузить»).
  // ───────────────────────────────────────────────────────────────────
  fastify.get('/flags', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    // Никогда не 403 для аутентифицированного пользователя: self-scope вместо запрета.
    // Иначе РП видит Failed to load resource 403 в консоли и пустую модалку.
    const todayIsoMsk = officeHours.isoOf(new Date());
    const year = parseInt(request.query.year || todayIsoMsk.slice(0, 4), 10);
    const month = parseInt(request.query.month || todayIsoMsk.slice(5, 7), 10);
    const range = officeHours.monthRange(year, month);
    const onlyOpen = String(request.query.open || '') === '1';
    const fullAccess = canReadAllHours(request.user && request.user.role);

    const params = [range.from, range.to];
    let selfFilter = '';
    if (!fullAccess) {
      params.push(Number(request.user.id));
      selfFilter = `AND s.user_id = $${params.length}`;
    }

    try {
      const { rows } = await db.query(
        `SELECT f.id, f.staff_id, f.date::text AS date, f.reason,
                f.prev_status, f.new_status, f.resolved_at, f.resolved_status,
                f.resolved_comment, f.created_at,
                COALESCE(NULLIF(btrim(u.name), ''), s.name) AS name,
                u.role,
                (SELECT COUNT(*)::int FROM office_presence_flags f2
                  WHERE f2.staff_id = f.staff_id AND f2.resolved_at IS NULL) AS open_for_person
           FROM office_presence_flags f
           LEFT JOIN staff s ON s.id = f.staff_id
           LEFT JOIN users u ON u.id = s.user_id
          WHERE f.date >= $1::date AND f.date <= $2::date
            ${onlyOpen ? 'AND f.resolved_at IS NULL' : ''}
            ${selfFilter}
          ORDER BY f.date DESC, name`,
        params
      );

      return {
        ok: true,
        scope: fullAccess ? 'company' : 'self',
        year, month,
        count: rows.length,
        open_count: rows.filter((r) => !r.resolved_at).length,
        flags: rows
      };
    } catch (err) {
      request.log.error({ err }, '[office-attendance] GET /flags');
      // Таблица ещё не накатили / schema-drift — пустой ответ, не 403/500 в UI.
      return reply.code(200).send({
        ok: true,
        scope: fullAccess ? 'company' : 'self',
        year, month,
        count: 0,
        open_count: 0,
        flags: [],
        degraded: true,
        message: 'Список отметок временно недоступен'
      });
    }
  });

  // ───────────────────────────────────────────────────────────────────
  // PUT /adjust — ручная правка часов с обязательной причиной
  // ───────────────────────────────────────────────────────────────────
  fastify.put('/adjust', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const b = request.body || {};
    const staffId = parseInt(b.staff_id, 10);
    const date = String(b.date || '').slice(0, 10);
    if (!Number.isFinite(staffId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.code(400).send({ error: 'staff_id и date обязательны' });
    }
    const reason = String(b.reason || '').trim();
    if (reason.length < 5) {
      return reply.code(400).send({ error: 'reason_required', message: 'Причина обязательна (минимум 5 символов)' });
    }
    const clear = b.minutes === null || b.minutes === '';
    const minutes = clear ? null : Math.max(0, Math.round(Number(b.minutes)));
    if (!clear && !Number.isFinite(minutes)) {
      return reply.code(400).send({ error: 'bad_minutes' });
    }

    await db.query(
      `INSERT INTO office_hours_daily (staff_id, date, office_minutes, manual_minutes, manual_reason, updated_at)
       VALUES ($1, $2::date, $3, $4, $5, NOW())
       ON CONFLICT (staff_id, date) DO UPDATE SET
         -- Отмена правки возвращает часы из импорта СКУД, а не ноль: строка
         -- остаётся (на неё опираются segments/first_in/last_out), но
         -- office_minutes пересобирается из фактических проходов. Раньше
         -- «откат» оставлял часы правки навсегда — верификатор 05.11.2026.
         office_minutes = CASE WHEN $4::int IS NULL
           THEN COALESCE((
             SELECT SUM(GREATEST(0, COALESCE((seg->>'minutes')::int, 0)))
               FROM jsonb_array_elements(office_hours_daily.segments) seg
           ), 0)
           ELSE EXCLUDED.office_minutes END,
         manual_minutes = EXCLUDED.manual_minutes,
         manual_reason  = EXCLUDED.manual_reason,
         updated_at     = NOW()`,
      [staffId, date, clear ? 0 : minutes, minutes, reason]
    );

    // Аудит: правка часов — это изменение факта, должно быть видно.
    try {
      const { writeAudit } = require('../lib/crm-audit');
      await writeAudit(db, {
        actorUserId: request.user.id,
        entityType: 'office_hours_daily',
        entityId: staffId,
        action: 'manual_adjust',
        payload: { date, minutes, reason }
      });
    } catch (_) { /* аудит не должен валить правку */ }

    return { ok: true, staff_id: staffId, date, minutes, reason };
  });

  // ───────────────────────────────────────────────────────────────────
  // PUT /settings — белый список отправителя, пороги нормы
  // ───────────────────────────────────────────────────────────────────
  fastify.put('/settings', {
    preHandler: [fastify.requireRoles(['ADMIN', ...DIRECTOR_ROLES, 'OFFICE_MANAGER'])]
  }, async (request, reply) => {
    const b = request.body || {};
    const current = await officeHours.loadSettings(db);
    const next = { ...current };

    if (b.merge_gap_min != null) {
      const v = parseInt(b.merge_gap_min, 10);
      if (!Number.isFinite(v) || v < 0 || v > 480) return reply.code(400).send({ error: 'bad_merge_gap_min' });
      next.merge_gap_min = v;
    }
    if (b.norm_hours_per_day != null) {
      const v = Number(b.norm_hours_per_day);
      if (!Number.isFinite(v) || v <= 0 || v > 24) return reply.code(400).send({ error: 'bad_norm_hours_per_day' });
      next.norm_hours_per_day = v;
    }
    if (b.norm_hours_per_week != null) {
      const v = Number(b.norm_hours_per_week);
      if (!Number.isFinite(v) || v <= 0 || v > 168) return reply.code(400).send({ error: 'bad_norm_hours_per_week' });
      next.norm_hours_per_week = v;
    }
    if (b.crm_session_gap_min != null) {
      const v = parseInt(b.crm_session_gap_min, 10);
      if (!Number.isFinite(v) || v < 1 || v > 240) return reply.code(400).send({ error: 'bad_crm_session_gap_min' });
      next.crm_session_gap_min = v;
    }
    if (b.crm_max_day_minutes != null) {
      const v = parseInt(b.crm_max_day_minutes, 10);
      if (!Number.isFinite(v) || v < 60 || v > 24 * 60) return reply.code(400).send({ error: 'bad_crm_max_day_minutes' });
      next.crm_max_day_minutes = v;
    }
    if (b.mail_from != null) next.mail_from = String(b.mail_from).slice(0, 500);
    if (b.notify_roles != null && Array.isArray(b.notify_roles)) {
      next.notify_roles = b.notify_roles.map(String).slice(0, 10);
    }
    if (b.norm_overrides != null && typeof b.norm_overrides === 'object') {
      next.norm_overrides = b.norm_overrides;
    }

    await db.query(
      `INSERT INTO settings (key, value_json, updated_at) VALUES ('skud', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value_json = $1, updated_at = NOW()`,
      [JSON.stringify(next)]
    );

    return { ok: true, settings: next };
  });

  // ───────────────────────────────────────────────────────────────────
  // GET /settings — текущие настройки контура
  // ───────────────────────────────────────────────────────────────────
  fastify.get('/settings', {
    preHandler: [fastify.requireRoles(READ_ROLES)]
  }, async () => {
    const settings = await officeHours.loadSettings(db);
    return { ok: true, settings };
  });

  // ───────────────────────────────────────────────────────────────────
  // POST /mail-scan — «проверить почту сейчас» (страховочный cron вручную)
  // ───────────────────────────────────────────────────────────────────
  fastify.post('/mail-scan', {
    preHandler: [fastify.requireRoles(['ADMIN', ...DIRECTOR_ROLES, 'OFFICE_MANAGER'])]
  }, async (request, reply) => {
    try {
      const skudMailCron = require('../services/skud-mail-cron');
      const res = await skudMailCron.scanOnce(db, request.log, {
        lookbackDays: Math.min(90, Math.max(1, parseInt(request.query.days || '14', 10) || 14))
      });
      return { ok: true, ...res };
    } catch (e) {
      request.log.error(e);
      return reply.code(500).send({ error: 'scan_failed', message: e.message });
    }
  });
};

// ─────────────────────────────────────────────────────────────────────
// Вспомогательное
// ─────────────────────────────────────────────────────────────────────

const STATUS_LABELS = {
  'оф': 'В офисе', 'уд': 'Удалёнка', 'об': 'На объекте', 'км': 'Командировка',
  'пг': 'Встреча/переговоры', 'уч': 'Учёба', 'ск': 'Склад', 'бн': 'Больничный',
  'сс': 'За свой счёт', 'вх': 'Выходной', 'отп': 'Отпуск', 'нп': 'Не подтверждён'
};

function statusLabel(code) {
  return code ? (STATUS_LABELS[code] || code) : '—';
}

/** jsonb segments из office_hours_daily → массив окон (одна реализация на модуль). */
const parseSegments = officeHours.parseSegments;

/** Текст недоработки для личного отчёта. */
function shortfallText(summary) {
  const delta = summary.delta_minutes;
  if (!summary.norm_minutes) return 'Норма за период не начислялась.';
  if (delta >= 0) return `Норма выполнена (зачёт ${summary.credited_hours} ч из ${summary.norm_hours} ч).`;
  const abs = Math.abs(delta / 60);
  const hh = Math.floor(abs);
  const mm = Math.round((abs - hh) * 60);
  return `Недоработка ${hh} ч ${mm ? mm + ' мин' : ''} (зачёт ${summary.credited_hours} ч из ${summary.norm_hours} ч).`;
}

/**
 * Часы СРМ за месяц пачкой: один запрос на всех сотрудников.
 * Возвращает Map(`${userId}|${date}` → {minutes, hasData}).
 */
async function loadCrmMonth(db, userIds, fromIso, toIso, settings) {
  const out = new Map();
  if (!userIds.length) return out;

  const { rows } = await db.query(
    `SELECT user_id, (minute_ts::date)::text AS date, minute_ts, hits
       FROM crm_activity_token
      WHERE user_id = ANY($1::int[])
        AND minute_ts >= $2::date
        AND minute_ts <  $3::date + INTERVAL '1 day'
      ORDER BY user_id, minute_ts`,
    [userIds, fromIso, toIso]
  );

  const gap = Number(settings.crm_session_gap_min) || crmActivity.DEFAULT_SESSION_GAP_MIN;
  const cap = Number(settings.crm_max_day_minutes) || crmActivity.DEFAULT_MAX_DAY_MINUTES;

  const grouped = new Map();
  for (const r of rows) {
    const key = `${r.user_id}|${String(r.date).slice(0, 10)}`;
    if (!grouped.has(key)) grouped.set(key, []);
    // Локальные компоненты «наивного» timestamp-а, не UTC (см. lib/msk.js).
    const minute = hhmmWallClock(r.minute_ts);
    if (!minute) continue;
    grouped.get(key).push({ minute, hits: Number(r.hits || 0) });
  }
  for (const [key, minutes] of grouped) {
    const res = crmActivity.buildSessions(minutes, { gapMin: gap, maxDayMinutes: cap });
    out.set(key, {
      minutes: res.totalMinutes,
      hasData: res.sessions.length > 0,
      sessions: res.sessions || []
    });
  }
  return out;
}

/**
 * Вернуть «оф» дням, которые были сняты как ложные, но после привязки ФИО
 * получили реальные часы СКУД.
 *
 * Зачем отдельная функция: статус «нп» ставится детектором, и после привязки
 * ФИО он бы остался навсегда — человек отвечал бы на вопрос по дню, где
 * проходы на самом деле есть (верификатор 03.11.2026, P1-4).
 */
async function reopenUnconfirmedDays(db, staffId) {
  const { rows } = await db.query(
    `SELECT sp.id, sp.date::text AS date
       FROM staff_plan sp
       JOIN office_hours_daily oh
         ON oh.staff_id = sp.staff_id
        AND oh.date = sp.date
        AND COALESCE(oh.manual_minutes, oh.office_minutes) > 0
      WHERE sp.staff_id = $1
        AND sp.status_code = 'нп'
        AND NOT EXISTS (
          SELECT 1 FROM office_presence_flags f
           WHERE f.staff_id = sp.staff_id AND f.date = sp.date AND f.resolved_at IS NOT NULL
        )`,
    [staffId]
  );
  for (const r of rows) {
    await db.query(
      `UPDATE staff_plan SET status_code = 'оф', updated_at = NOW() WHERE id = $1`,
      [r.id]
    );
  }
  return rows.length;
}

/**
 * Пересчёт часов одного ФИО после ручной привязки.
 * Берём все импортированные прохождения этого ФИО и переписываем office_hours_daily.
 */
async function recountPerson(db, rawName, staffId) {
  const { rows } = await db.query(
    `SELECT sp.date::text AS date, sp.ts, sp.direction
       FROM skud_punches sp
       JOIN skud_imports si ON si.id = sp.import_id AND si.deleted_at IS NULL
      WHERE sp.raw_person = $1
      ORDER BY sp.date, sp.ts`,
    [rawName]
  );
  if (!rows.length) return { written: 0 };

  const settings = await officeHours.loadSettings(db);
  const byDate = new Map();
  for (const r of rows) {
    const date = String(r.date).slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(r);
  }

  let written = 0;
  for (const [date, evs] of byDate) {
    // Пересобираем интервалы тем же алгоритмом, что и парсер, чтобы ручная
    // привязка давала ровно те же часы, что дал бы автоимпорт.
    let inside = false;
    let openedAt = null;
    const raw = [];
    for (const e of evs) {
      const ts = new Date(e.ts).getTime();
      if (e.direction === 'вход') {
        if (inside) continue;
        inside = true; openedAt = ts;
      } else {
        if (!inside) continue;
        inside = false;
        if (openedAt != null && ts > openedAt) raw.push({ from: openedAt, to: ts });
        openedAt = null;
      }
    }
    let openEnded = false;
    if (openedAt != null) {
      const lastTs = new Date(evs[evs.length - 1].ts).getTime();
      if (lastTs > openedAt) raw.push({ from: openedAt, to: lastTs });
      openEnded = true;
    }
    const gapMs = (Number(settings.merge_gap_min) || 60) * 60000;
    const merged = [];
    for (const iv of raw) {
      const prev = merged[merged.length - 1];
      if (prev && iv.from - prev.to <= gapMs) prev.to = Math.max(prev.to, iv.to);
      else merged.push({ ...iv });
    }
    const minutes = merged.reduce((s, x) => s + Math.round((x.to - x.from) / 60000), 0);
    // Время из отчёта — «настенное» (как в СКУД). Колонки first_in/last_out —
    // timestamp без зоны: пишем локальные компоненты. А jsonb segments
    // ОБЯЗАН быть в том же формате, что у парсера (ISO), иначе интерфейс
    // читает его через getUTCHours() и получает сдвиг −3 ч
    // (верификатор 03.11.2026, остаток P1-5).
    const segments = merged.map((x) => ({
      from: isoFromWallClock(x.from),
      to: isoFromWallClock(x.to),
      minutes: Math.round((x.to - x.from) / 60000)
    }));
    const firstIn = merged.length ? merged[0].from : null;
    const lastOut = merged.length ? merged[merged.length - 1].to : null;

    await db.query(
      `INSERT INTO office_hours_daily
         (staff_id, date, office_minutes, open_ended, first_in, last_out, segments, skud_missing, updated_at)
       VALUES ($1, $2::date, $3, $4, $5::timestamp, $6::timestamp, $7::jsonb, false, NOW())
       ON CONFLICT (staff_id, date) DO UPDATE SET
         office_minutes = EXCLUDED.office_minutes,
         open_ended     = EXCLUDED.open_ended,
         first_in       = EXCLUDED.first_in,
         last_out       = EXCLUDED.last_out,
         segments       = EXCLUDED.segments,
         skud_missing   = false,
         updated_at     = NOW()`,
      [
        staffId, date, minutes, openEnded,
        firstIn ? wallClockStamp(firstIn) : null,
        lastOut ? wallClockStamp(lastOut) : null,
        JSON.stringify(segments)
      ]
    );
    written += 1;
  }
  return { written };
}

/**
 * Свод по сотруднику за произвольный период (для блока «месяц» в личном отчёте).
 */
async function summarizeStaffPeriod(db, staffId, userId, fromIso, toIso, settings, _calendar, crmActivitySvc) {
  const calendar = await officeHours.loadCalendar(db, fromIso, toIso);
  const { rows: planRows } = await db.query(
    `SELECT DISTINCT ON (date) date::text AS date, status_code FROM staff_plan
      WHERE staff_id = $1 AND date >= $2::date AND date <= $3::date
      ORDER BY date, id DESC`,
    [staffId, fromIso, toIso]
  );
  const planMap = new Map(planRows.map((r) => [String(r.date).slice(0, 10), r.status_code]));

  const { rows: hoursRows } = await db.query(
    `SELECT date::text AS date, office_minutes, manual_minutes, segments FROM office_hours_daily
      WHERE staff_id = $1 AND date >= $2::date AND date <= $3::date`,
    [staffId, fromIso, toIso]
  );
  const hoursMap = new Map(hoursRows.map((r) => [String(r.date).slice(0, 10), r]));

  const crmRange = await crmActivitySvc.activityRange(db, userId, fromIso, toIso);

  const days = [];
  let iso = fromIso;
  while (iso <= toIso) {
    const plan = planMap.get(iso) || null;
    const hr = hoursMap.get(iso) || null;
    const crmDay = crmRange[iso] || { totalMinutes: 0, sessions: [] };
    const officeMinutes = hr && hr.manual_minutes != null ? Number(hr.manual_minutes) : Number(hr ? hr.office_minutes : 0);
    days.push(officeHours.creditDay({
      date: iso,
      statusCode: plan,
      officeMinutes,
      crmMinutes: crmDay.totalMinutes || 0,
      crmSessions: crmDay.sessions || [],
      officeSegments: parseSegments(hr && hr.segments),
      crmHasData: (crmDay.sessions || []).length > 0,
      skudMissing: !hr,
      normMinutes: officeHours.dayNormMinutes(iso, calendar, settings, staffId)
    }));
    iso = officeHours.addDays(iso, 1);
  }
  return { ...officeHours.summarizeDays(days), from: fromIso, to: toIso };
}

module.exports.STATUS_LABELS = STATUS_LABELS;
module.exports._hm = hm;
module.exports._h = h;
module.exports._shortfallText = shortfallText;
