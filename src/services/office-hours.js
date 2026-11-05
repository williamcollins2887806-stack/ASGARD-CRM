'use strict';

/**
 * office-hours — нормы труда и зачёт часов в графике офиса.
 *
 * ЛОГИКА ЗАЧЁТА (обновление 04.11.2026):
 *   Рабочий день (оф / уд / об / …) → СКУД + СРМ вне окон офиса.
 *   Пример: 2 ч в офисе, потом дома 5 ч в СРМ → зачёт 7 ч.
 *   Минуты СРМ, пока человек по СКУД в офисе, НЕ считаем (иначе двойной учёт:
 *   ноут в офисе тоже пишет crm_activity_token).
 *   бн/сс/вх/отп → 0, день выпадает из нормы.
 *   нп → ждём ответа, в норму не идёт.
 *
 * НОРМА. 8 ч в рабочий день, из производственного календаря work_calendar
 * (праздники и переносы РФ). Сокращённый день (31.12 и т.п.) — 7 ч, если в
 * календаре помечено. Индивидуальные переопределения — settings.skud.norm_overrides.
 */

const crmActivity = require('./crm-activity');
const { hhmmWallClock, MSK_OFFSET_MIN } = require('../lib/msk');

/** Статусы, которые «зачитываются» из часов СРМ. */
const CRM_STATUSES = new Set(['уд', 'об', 'км', 'пг', 'уч', 'ск']);
/** Статусы, которые не входят в норму вовсе (законное отсутствие). */
const EXCLUDED_STATUSES = new Set(['бн', 'сс', 'вх', 'отп']);
/** «В офисе» — единственный статус, подтверждаемый СКУД. */
const OFFICE_STATUS = 'оф';
/** Снятая отметка: ждёт ответа сотрудника, норма не зачитывается. */
const UNCONFIRMED_STATUS = 'нп';
/** Статусы, доступные для ответа на гейт (всё, кроме оф/нп). */
const DISPUTE_ALLOWED = ['уд', 'об', 'км', 'пг', 'уч', 'ск', 'бн', 'сс', 'вх'];

const DEFAULTS = {
  merge_gap_min: 60,
  norm_hours_per_day: 8,
  norm_hours_per_week: 40,
  norm_overrides: {},
  crm_session_gap_min: 15,
  crm_max_day_minutes: 12 * 60,
  crm_activity_since: null,
  mail_from: '',
  import_cron: '10 6 * * *',
  notify_roles: ['OFFICE_MANAGER']
};

function pad2(n) { return String(n).padStart(2, '0'); }

/**
 * ISO-дата из Date/строки.
 *
 * Для строки — как есть (уже дата без зоны). Для Date — МОСКОВСКАЯ дата:
 * сервер живёт в MSK, и `getUTC*` в первые три часа после полуночи 1-го числа
 * давал предыдущий день. Из-за этого блок «неделя» в /month, /me, /flags и
 * /reports-status уезжал в прошлый месяц (верификатор 03.11.2026, P3-3).
 */
function isoOf(value) {
  if (!value) return null;
  if (typeof value === 'string') return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const msk = new Date(value.getTime() + MSK_OFFSET_MIN * 60000);
    return `${msk.getUTCFullYear()}-${pad2(msk.getUTCMonth() + 1)}-${pad2(msk.getUTCDate())}`;
  }
  return null;
}

function addDays(iso, n) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86400000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** Понедельник недели, в которую попадает дата. */
function mondayOf(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = вс
  const shift = dow === 0 ? -6 : 1 - dow;
  return addDays(iso, shift);
}

function dowOf(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Настройки контура. Читаются из settings.skud с фолбэком на дефолты. */
async function loadSettings(db) {
  const { rows } = await db.query(`SELECT value_json FROM settings WHERE key = 'skud' LIMIT 1`);
  let cfg = {};
  if (rows[0]) {
    try { cfg = JSON.parse(rows[0].value_json) || {}; } catch (_) { cfg = {}; }
  }
  return { ...DEFAULTS, ...cfg };
}

/**
 * Производственный календарь за диапазон: { 'YYYY-MM-DD': {isWorking, kind, hours} }.
 * Если записи нет — считаем сб/вс нерабочими, остальное рабочим.
 */
async function loadCalendar(db, fromIso, toIso) {
  const { rows } = await db.query(
    `SELECT to_char(date,'YYYY-MM-DD') AS date, is_working, kind, title
       FROM work_calendar
      WHERE date >= $1::date AND date <= $2::date`,
    [fromIso, toIso]
  );
  const map = {};
  rows.forEach((r) => {
    map[r.date] = {
      isWorking: r.is_working !== false,
      kind: r.kind || '',
      title: r.title || ''
    };
  });
  return map;
}

/** Рабочий ли день. calendar может быть пустым — тогда правило сб/вс. */
function isWorkingDay(iso, calendar) {
  const c = calendar && calendar[iso];
  if (c) {
    if (c.kind === 'working') return true;
    return c.isWorking !== false;
  }
  const dow = dowOf(iso);
  return dow !== 0 && dow !== 6;
}

/** Норма дня в минутах (0 — нерабочий день). */
function dayNormMinutes(iso, calendar, settings, staffId) {
  if (!isWorkingDay(iso, calendar)) return 0;
  const overrides = (settings && settings.norm_overrides) || {};
  const personal = staffId != null ? Number(overrides[String(staffId)]) : NaN;
  if (Number.isFinite(personal) && personal > 0) return Math.round(personal * 60);
  const perDay = Number(settings && settings.norm_hours_per_day);
  const hours = Number.isFinite(perDay) && perDay > 0 ? perDay : DEFAULTS.norm_hours_per_day;
  return Math.round(hours * 60);
}

function hhmmToMinOfDay(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
}

/**
 * Окно присутствия СКУД → [fromMin, toMin) в минутах суток.
 * segments пишутся ISO с UTC-компонентами = настенные часы МСК (см. isoFromWallClock).
 */
function officeSegmentRange(seg) {
  if (!seg) return null;
  const parseIso = (v) => {
    if (v == null) return null;
    if (typeof v === 'string' && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(v.trim())) {
      // наивная 'YYYY-MM-DD HH:mm:ss' — берём HH:mm из строки
      return hhmmToMinOfDay(v);
    }
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return hhmmToMinOfDay(v);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  };
  const from = parseIso(seg.from);
  if (from == null) return null;
  if (seg.minutes != null && Number.isFinite(Number(seg.minutes))) {
    return { from, to: from + Math.max(0, Math.round(Number(seg.minutes))) };
  }
  const to = parseIso(seg.to);
  if (to == null || to <= from) return null;
  return { from, to };
}

/**
 * Минуты СРМ вне окон офиса. Пересечение с СКУД вычитаем.
 * @param {Array<{from:string,to:string,minutes?:number}>} sessions
 * @param {Array<{from:string,to:string,minutes?:number}>} segments
 */
function crmMinutesOutsideOffice(sessions, segments) {
  const list = Array.isArray(sessions) ? sessions : [];
  if (!list.length) return 0;
  const office = (Array.isArray(segments) ? segments : [])
    .map(officeSegmentRange)
    .filter(Boolean);
  let total = 0;
  for (const s of list) {
    const a0 = hhmmToMinOfDay(s.from);
    const a1 = hhmmToMinOfDay(s.to);
    if (a0 == null || a1 == null || a1 < a0) continue;
    // сессия СРМ — включительно [from, to], длина last-first+1
    let len = Number.isFinite(Number(s.minutes))
      ? Math.max(0, Math.round(Number(s.minutes)))
      : (a1 - a0 + 1);
    if (!office.length) {
      total += len;
      continue;
    }
    // half-open для пересечения: CRM [a0, a1+1)
    const crmEnd = a0 + len;
    for (const o of office) {
      const from = Math.max(a0, o.from);
      const to = Math.min(crmEnd, o.to);
      if (to > from) len -= (to - from);
    }
    total += Math.max(0, len);
  }
  return total;
}

/**
 * Зачёт дня. Возвращает готовую к показу структуру.
 *
 * @param {object} p
 * @param {string} p.date
 * @param {string|null} p.statusCode
 * @param {number} p.officeMinutes
 * @param {number} p.crmMinutes              — всего минут СРМ за день
 * @param {Array}  [p.crmSessions]           — сессии СРМ {from,to,minutes}
 * @param {Array}  [p.officeSegments]        — окна СКУД
 * @param {number} [p.crmRemoteMinutes]      — уже посчитанные минуты СРМ вне офиса
 * @param {boolean} p.crmHasData
 * @param {boolean} p.skudMissing
 * @param {number} p.normMinutes
 */
function creditDay(p) {
  // Нормализуем код: невидимые символы, регистр и пробелы не должны менять
  // поведение — «ОФ», « оф », «оф\u200B» обязаны вести себя как «оф».
  const rawStatus = p.statusCode || null;
  const status = rawStatus == null
    ? null
    : String(rawStatus)
        .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD\u180E]/g, '')
        .trim()
        .toLowerCase() || null;
  const office = Math.max(0, Math.round(Number(p.officeMinutes) || 0));
  const crm = Math.max(0, Math.round(Number(p.crmMinutes) || 0));
  const norm = Math.max(0, Math.round(Number(p.normMinutes) || 0));

  let remoteCrm;
  if (p.crmRemoteMinutes != null) {
    remoteCrm = Math.max(0, Math.round(Number(p.crmRemoteMinutes) || 0));
  } else if (Array.isArray(p.crmSessions) && p.crmSessions.length) {
    remoteCrm = crmMinutesOutsideOffice(p.crmSessions, p.officeSegments);
  } else if (office > 0) {
    // Есть офис, но нет сессий СРМ с временем — пересечение не посчитать.
    // Не прибавляем «голый» crm: иначе двойной учёт за работу в офисе.
    remoteCrm = 0;
  } else {
    remoteCrm = crm;
  }

  const out = {
    date: p.date,
    status,
    norm_minutes: norm,
    office_minutes: office,
    crm_minutes: crm,
    crm_remote_minutes: remoteCrm,
    credited_minutes: 0,
    source: 'none',
    counts_in_norm: norm > 0,
    warn: null
  };

  if (!norm) {
    out.source = 'dayoff';
    return out;
  }

  if (status === UNCONFIRMED_STATUS) {
    out.source = 'unconfirmed';
    out.counts_in_norm = false;
    out.warn = 'not_confirmed';
    return out;
  }

  if (EXCLUDED_STATUSES.has(status)) {
    out.source = 'excluded';
    out.counts_in_norm = false;
    return out;
  }

  const applyHybrid = (sourceWhenOnlyOffice, sourceWhenOnlyCrm, sourceHybrid) => {
    out.credited_minutes = office + remoteCrm;
    if (office > 0 && remoteCrm > 0) out.source = sourceHybrid;
    else if (office > 0) out.source = sourceWhenOnlyOffice;
    else if (remoteCrm > 0) out.source = sourceWhenOnlyCrm;
    else out.source = sourceWhenOnlyOffice;
  };

  if (status === OFFICE_STATUS) {
    if (!office) {
      out.warn = p.skudMissing ? 'skud_missing' : 'no_punches';
      if (p.skudMissing) {
        out.source = 'skud_missing';
        out.counts_in_norm = false;
        return out;
      }
      // «оф» без прохода: СРМ вне офиса не зачитываем — иначе ложный «оф»
      // (детектор как раз ищет такие дни) получит часы и спрячется.
      out.source = 'skud';
      out.credited_minutes = 0;
      return out;
    }
    applyHybrid('skud', 'crm', 'hybrid');
    return out;
  }

  if (CRM_STATUSES.has(status)) {
    if (!p.crmHasData && !crm && !office) {
      out.source = 'no_crm_data';
      out.counts_in_norm = false;
      out.warn = 'no_crm_data';
      return out;
    }
    // Удалёнка/объект: если человек ещё и зашёл в офис — офис + СРМ вне него.
    applyHybrid('skud', 'crm', 'hybrid');
    return out;
  }

  if (!status) {
    if (office > 0 || remoteCrm > 0) {
      applyHybrid('skud_no_status', 'crm_no_status', 'hybrid_no_status');
      out.warn = 'no_status';
      return out;
    }
    if (p.skudMissing && !p.crmHasData) {
      out.source = 'no_data';
      out.counts_in_norm = false;
      out.warn = 'no_data';
      return out;
    }
    out.source = 'no_status';
    out.warn = p.skudMissing ? 'skud_missing' : 'no_status';
    return out;
  }

  out.source = 'unknown_status';
  out.warn = 'unknown_status';
  return out;
}

/** Свод по диапазону: минуты, дельта к норме, часы. */
function summarizeDays(days) {
  let norm = 0;
  let credited = 0;
  let office = 0;
  let crm = 0;
  let counted = 0;
  for (const d of days) {
    office += d.office_minutes;
    crm += d.crm_minutes;
    if (d.counts_in_norm) {
      norm += d.norm_minutes;
      credited += Math.min(d.credited_minutes, d.norm_minutes);
      counted += 1;
    }
  }
  return {
    norm_minutes: norm,
    credited_minutes: credited,
    office_minutes: office,
    crm_minutes: crm,
    delta_minutes: credited - norm,    // отрицательное = недоработка
    days_counted: counted,
    norm_hours: Math.round(norm / 6) / 10,
    credited_hours: Math.round(credited / 6) / 10,
    delta_hours: Math.round((credited - norm) / 6) / 10,
    office_hours: Math.round(office / 6) / 10,
    crm_hours: Math.round(crm / 6) / 10
  };
}

/**
 * Пересчёт office_hours_daily по одному импорту.
 * Пишет часы и интервалы, не трогает staff_plan (это делает detectFalseOffice).
 *
 * @param {object} db
 * @param {object} p
 * @param {number} p.importId
 * @param {string} p.periodFrom
 * @param {string} p.periodTo
 * @param {Array} p.people — результат парсера: [{rawName, days:[{date, minutes, openEnded, firstIn, lastOut, segments}]}]
 * @param {Map<string, number>} p.nameToStaff — 'ФИО' → staff.id
 */
async function applyImportHours(db, p) {
  let written = 0;
  for (const person of p.people || []) {
    const staffId = p.nameToStaff.get(person.rawName);
    if (!staffId) continue;
    for (const day of person.days || []) {
      await db.query(
        `INSERT INTO office_hours_daily
           (staff_id, date, office_minutes, open_ended, first_in, last_out, segments, import_id, updated_at)
         VALUES ($1, $2::date, $3, $4, $5::timestamp, $6::timestamp, $7::jsonb, $8, NOW())
         ON CONFLICT (staff_id, date) DO UPDATE SET
           office_minutes = EXCLUDED.office_minutes,
           open_ended     = EXCLUDED.open_ended,
           first_in       = EXCLUDED.first_in,
           last_out       = EXCLUDED.last_out,
           segments       = EXCLUDED.segments,
           import_id      = EXCLUDED.import_id,
           skud_missing   = false,
           updated_at     = NOW()`,
        [
          staffId, day.date, day.minutes, !!day.openEnded,
          day.firstIn || null, day.lastOut || null,
          JSON.stringify(day.segments || []), p.importId
        ]
      );
      written += 1;
    }
  }
  return { written };
}

/**
 * Детектор ложных отметок «в офисе».
 *
 * Правило (заказчик, 03.11.2026): если статус «оф» стоит, а СКУД за этот день
 * проходов не зафиксировал В ПОКРЫТОМ ИМПОРТОМ ПЕРИОДЕ — отметка снимается,
 * ставится «нп», человек обязан ответить при следующем входе.
 * Строго, без исключений: снимается и отметка, поставленная офис-менеджером —
 * если пропуск не сработал, офис-менеджер поправит день после ответа сотрудника.
 *
 * Дни ВНЕ покрытия импортов не трогаем: отчёта за них ещё не было, судить не по чему.
 *
 * @returns {{checked:number, flagged:number, cleared:number, flaggedDays:Array}}
 */
async function detectFalseOffice(db, p) {
  const { rows } = await db.query(
    `SELECT sp.id, sp.staff_id, sp.date::text AS date, sp.status_code,
            COALESCE(oh.office_minutes, 0) AS office_minutes,
            oh.manual_minutes
       FROM staff_plan sp
       LEFT JOIN office_hours_daily oh
              ON oh.staff_id = sp.staff_id AND oh.date = sp.date
      WHERE sp.date >= $1::date AND sp.date <= $2::date
        AND lower(regexp_replace(btrim(sp.status_code), '[\u200B-\u200D\u2060\uFEFF\u00AD\u180E]', '', 'g')) = 'оф'`,
    [p.periodFrom, p.periodTo]
  );

  const flagged = [];
  for (const row of rows) {
    // Ручную правку офис-менеджера уважаем: он вписал часы руками, значит
    // подтвердил присутствие (верификатор 03.11.2026, P2-1). Иначе его правка
    // через минуту снова сносилась бы детектором.
    const effective = row.manual_minutes != null
      ? Number(row.manual_minutes)
      : Number(row.office_minutes);
    if (effective > 0) continue;
    flagged.push(row);
  }

  let cleared = 0;
  for (const row of flagged) {
    // Снимаем отметку и ставим «не подтверждён».
    await db.query(
      `UPDATE staff_plan SET status_code = $2, updated_at = NOW() WHERE id = $1`,
      [row.id, UNCONFIRMED_STATUS]
    );
    // Флаг дня: один на (staff_id, date). Повторный импорт не плодит дубли
    // и не сбрасывает уже данный ответ сотрудника.
    await db.query(
      `INSERT INTO office_presence_flags
         (staff_id, user_id, date, reason, prev_status, new_status, import_id)
       SELECT $1, s.user_id, $2::date, 'skud_no_punch', 'оф', $3, $4
         FROM staff s WHERE s.id = $1
       ON CONFLICT (staff_id, date) DO UPDATE SET
         import_id   = EXCLUDED.import_id,
         prev_status = 'оф',
         new_status  = EXCLUDED.new_status
       WHERE office_presence_flags.resolved_at IS NULL`,
      [row.staff_id, row.date, UNCONFIRMED_STATUS, p.importId || null]
    );
    cleared += 1;
  }

  return { checked: rows.length, flagged: flagged.length, cleared, flaggedDays: flagged };
}

/**
 * Автопостановка «оф» там, где СКУД видел человека, а статуса нет.
 * Решение заказчика: был в офисе — отметка ставится автоматически.
 */
async function autoFillOfficeStatus(db, p) {
  const { rows } = await db.query(
    `SELECT oh.staff_id, oh.date::text AS date
       FROM office_hours_daily oh
      WHERE oh.date >= $1::date AND oh.date <= $2::date
        AND oh.office_minutes > 0
        AND NOT EXISTS (
          SELECT 1 FROM staff_plan sp
           WHERE sp.staff_id = oh.staff_id AND sp.date = oh.date
             AND sp.status_code IS NOT NULL AND btrim(sp.status_code) <> ''
        )`,
    [p.periodFrom, p.periodTo]
  );

  let created = 0;
  for (const row of rows) {
    await db.query(
      `INSERT INTO staff_plan (staff_id, date, status_code, note, created_at, updated_at)
       VALUES ($1, $2::date, 'оф', 'авто по СКУД', NOW(), NOW())`,
      [row.staff_id, row.date]
    );
    created += 1;
  }
  return { created };
}

/** Часы СРМ за день по users.id (с учётом настроек). */
async function crmMinutesForDay(db, userId, dayIso, settings) {
  if (!userId) return { minutes: 0, hasData: false, sessions: [] };
  const res = await crmActivity.activityForDay(db, userId, dayIso);
  const gap = Number(settings && settings.crm_session_gap_min) || crmActivity.DEFAULT_SESSION_GAP_MIN;
  const cap = Number(settings && settings.crm_max_day_minutes) || crmActivity.DEFAULT_MAX_DAY_MINUTES;
  // activityForDay уже собрал сессии с дефолтным порогом; пересобираем, если настройка иная.
  let result = res;
  if (gap !== crmActivity.DEFAULT_SESSION_GAP_MIN || cap !== crmActivity.DEFAULT_MAX_DAY_MINUTES) {
    const { rows } = await db.query(
      `SELECT minute_ts, hits FROM crm_activity_token
        WHERE user_id = $1 AND minute_ts >= $2::date AND minute_ts < $2::date + INTERVAL '1 day'
        ORDER BY minute_ts`,
      [userId, dayIso]
    );
    const minutes = rows.map((r) => ({
      // hhmmWallClock берёт локальные компоненты: pg отдаёт «наивный»
      // timestamp без зоны, и UTC-часы дали бы сдвиг на 3 часа.
      minute: hhmmWallClock(r.minute_ts),
      hits: Number(r.hits || 0)
    })).filter((x) => x.minute);
    result = crmActivity.buildSessions(minutes, { gapMin: gap, maxDayMinutes: cap });
  }
  return {
    minutes: result.totalMinutes,
    hasData: (result.sessions || []).length > 0,
    sessions: result.sessions || []
  };
}

/** Границы месяца. */
function monthRange(year, month) {
  const from = `${year}-${pad2(month)}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from, to: `${year}-${pad2(month)}-${pad2(lastDay)}`, daysInMonth: lastDay };
}

module.exports = {
  loadSettings,
  loadCalendar,
  isWorkingDay,
  dayNormMinutes,
  creditDay,
  summarizeDays,
  applyImportHours,
  detectFalseOffice,
  autoFillOfficeStatus,
  crmMinutesForDay,
  crmMinutesOutsideOffice,
  officeSegmentRange,
  monthRange,
  mondayOf,
  isoOf,
  addDays,
  dowOf,
  CRM_STATUSES,
  EXCLUDED_STATUSES,
  OFFICE_STATUS,
  UNCONFIRMED_STATUS,
  DISPUTE_ALLOWED,
  DEFAULTS
};
