'use strict';

/**
 * Timesheet v2 — единая API-точка табеля (ФИО × дни месяца).
 * Prefix: /api/timesheet/v2
 *
 * Источник правды — TIMESHEET_V2_CONTRACT.md.
 *
 * Endpoints:
 *   GET    /:year/:month                     — табель за месяц (mode из роли)
 *   PUT    /entry                            — добавить/удалить отметку
 *   GET    /locks/:year/:month               — список локов
 *   POST   /lock                             — поставить лок
 *   DELETE /lock/:lockId                     — снять лок
 *   GET    /settings/position-points         — баллы по позициям
 *   PUT    /settings/position-points         — изменить баллы (ADMIN/DIRECTOR_GEN)
 *   GET    /:year/:month/export?format=xlsx  — Excel выгрузка
 */

const ALL_VIEW_ROLES = [
  'ADMIN',
  'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV',
  'BUH', 'HR', 'HR_MANAGER',
  'PM', 'HEAD_PM',
  'WAREHOUSE',
  'TO', 'HEAD_TO',
  'OFFICE_MANAGER',
  'PROC'
];

const GLOBAL_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'BUH', 'HR', 'HR_MANAGER'];
const PM_ROLES = ['PM', 'HEAD_PM'];
const WAREHOUSE_ROLES = ['WAREHOUSE'];
const MEDICAL_ROLES = ['TO', 'HEAD_TO'];
const TRAVEL_ROLES = ['OFFICE_MANAGER'];

const STAGE_TYPES = new Set(['warehouse', 'medical', 'travel', 'waiting']);
const SHIFT_TYPES = new Set(['day', 'night']);

// ───────────────────────────────────────────────────────────────────
// Локальный fallback для assertNotLocked / getActiveLocks
// Используется, пока агент A не доставил src/lib/timesheet-locks.js
// ───────────────────────────────────────────────────────────────────
let lockLib;
try {
  lockLib = require('../lib/timesheet-locks');
} catch (_) {
  lockLib = null;
}

async function tableExists(db, name) {
  const { rows } = await db.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1 LIMIT 1`,
    [name]
  );
  return rows.length > 0;
}

async function getActiveLocks(fastify, year, month) {
  if (lockLib && typeof lockLib.getActiveLocks === 'function') {
    return lockLib.getActiveLocks(fastify, year, month);
  }
  const db = fastify.db;
  if (!(await tableExists(db, 'payroll_period_locks'))) return [];
  const { rows } = await db.query(`
    SELECT l.id, l.year, l.month, l.scope, l.scope_user_id, l.locked_at, l.locked_by,
           u1.name AS locked_by_fio, u1.role AS locked_by_role,
           u2.name AS scope_user_fio
    FROM payroll_period_locks l
    LEFT JOIN users u1 ON u1.id = l.locked_by
    LEFT JOIN users u2 ON u2.id = l.scope_user_id
    WHERE l.year = $1 AND l.month = $2 AND l.unlocked_at IS NULL
    ORDER BY l.scope, l.scope_user_id NULLS FIRST
  `, [year, month]);
  return rows;
}

/**
 * Бросает Error с code='period_locked' если на (year,month) есть лок,
 * перекрывающий действие viewer'а на данных (scope_hint).
 */
async function assertNotLocked(fastify, viewer, ctx) {
  if (lockLib && typeof lockLib.assertNotLocked === 'function') {
    return lockLib.assertNotLocked(fastify, viewer, ctx);
  }
  const db = fastify.db;
  if (!(await tableExists(db, 'payroll_period_locks'))) return;
  const { year, month, scope_hint } = ctx || {};
  if (!year || !month) return;

  const role = viewer && viewer.role;
  const uid = viewer && viewer.id;
  const isPriv = GLOBAL_ROLES.includes(role);

  const locks = await getActiveLocks(fastify, year, month);
  if (!locks.length) return;

  for (const lock of locks) {
    // global перекрывает всех, кроме привилегированных через явный разлок
    if (lock.scope === 'global') {
      if (!isPriv) {
        const err = new Error('period_locked');
        err.code = 'period_locked';
        err.lock = lock;
        throw err;
      }
      continue;
    }
    if (lock.scope === 'pm') {
      // персональный лок РП — блокирует только этого РП
      if (PM_ROLES.includes(role) && Number(lock.scope_user_id) === Number(uid)) {
        const err = new Error('period_locked'); err.code = 'period_locked'; err.lock = lock; throw err;
      }
      continue;
    }
    if (lock.scope === 'warehouse' && WAREHOUSE_ROLES.includes(role)) {
      const err = new Error('period_locked'); err.code = 'period_locked'; err.lock = lock; throw err;
    }
    if (lock.scope === 'medical' && MEDICAL_ROLES.includes(role)) {
      const err = new Error('period_locked'); err.code = 'period_locked'; err.lock = lock; throw err;
    }
    if (lock.scope === 'travel' && TRAVEL_ROLES.includes(role)) {
      const err = new Error('period_locked'); err.code = 'period_locked'; err.lock = lock; throw err;
    }
  }
}

// ───────────────────────────────────────────────────────────────────
// helpers
// ───────────────────────────────────────────────────────────────────

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function fmtDate(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  if (d instanceof Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }
  return String(d);
}

function modeOfRole(role) {
  if (GLOBAL_ROLES.includes(role)) return 'global';
  if (PM_ROLES.includes(role)) return 'pm';
  if (WAREHOUSE_ROLES.includes(role)) return 'warehouse';
  if (MEDICAL_ROLES.includes(role)) return 'medical';
  if (TRAVEL_ROLES.includes(role)) return 'travel';
  return null;
}

function typeAllowedForMode(mode, type) {
  if (mode === 'global') return SHIFT_TYPES.has(type) || STAGE_TYPES.has(type);
  if (mode === 'pm') return type === 'day' || type === 'night' || type === 'waiting';
  if (mode === 'warehouse') return type === 'warehouse';
  if (mode === 'medical') return type === 'medical';
  if (mode === 'travel') return type === 'travel';
  return false;
}

function cellTypeFromShift(shift) {
  return shift === 'night' ? 'night' : 'day';
}

// Загрузка position_points + per_diem_default
async function loadSettings(db) {
  const out = { position_points: {}, per_diem_default: 1000 };
  // position_points
  if (await tableExists(db, 'position_points')) {
    try {
      const { rows } = await db.query(`SELECT type, position, points FROM position_points`);
      for (const r of rows) {
        const key = r.position ? `${r.type}:${r.position}` : r.type;
        out.position_points[key] = Number(r.points);
      }
    } catch (_) { /* schema mismatch */ }
  }
  // fallback значения
  if (!('warehouse:слесарь' in out.position_points)) out.position_points['warehouse:слесарь'] = 10;
  if (!('warehouse:мастер' in out.position_points)) out.position_points['warehouse:мастер'] = 12;
  if (!('medical' in out.position_points)) out.position_points['medical'] = 6;
  if (!('travel' in out.position_points)) out.position_points['travel'] = 6;

  // per_diem_default — берём из settings.value_json (key='per_diem_default') либо MAX(per_diem) по полю
  try {
    const { rows } = await db.query(`SELECT value_json FROM settings WHERE key='per_diem_default' LIMIT 1`);
    if (rows.length) {
      const v = JSON.parse(rows[0].value_json);
      if (Number.isFinite(Number(v))) out.per_diem_default = Number(v);
    }
  } catch (_) {}
  return out;
}

// Точечная оценка баллов для конкретного stage_type/shift
function pointsFor(settings, type, position) {
  if (type === 'day' || type === 'night') return null; // считаются из day_rate
  if (type === 'warehouse') {
    const k = `warehouse:${position || 'слесарь'}`;
    return Number(settings.position_points[k] ?? settings.position_points['warehouse:слесарь'] ?? 10);
  }
  if (type === 'medical') return Number(settings.position_points['medical'] ?? 6);
  if (type === 'travel') return Number(settings.position_points['travel'] ?? 6);
  if (type === 'waiting') return 0;
  return 0;
}

async function routes(fastify) {
  const db = fastify.db;
  const viewAuth = { preHandler: [fastify.requireRoles(ALL_VIEW_ROLES)] };
  const settingsWriteAuth = { preHandler: [fastify.requireRoles(['ADMIN', 'DIRECTOR_GEN'])] };
  const exportAuth = { preHandler: [fastify.requireRoles(GLOBAL_ROLES)] };

  // ────────────────────────────────────────────────────────────────
  // GET /api/timesheet/v2/:year/:month
  // ────────────────────────────────────────────────────────────────
  fastify.get('/:year/:month', viewAuth, async (request, reply) => {
    try {
      const year = parseInt(request.params.year, 10);
      const month = parseInt(request.params.month, 10);
      // FIX 10: год ограничен 2020..currentYear+1
      const _yMaxGet = new Date().getFullYear() + 1;
      if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12 || year < 2020 || year > _yMaxGet) {
        return reply.code(400).send({ error: 'Bad year/month' });
      }
      const dim = daysInMonth(year, month);
      const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
      const periodEnd   = `${year}-${String(month).padStart(2, '0')}-${String(dim).padStart(2, '0')}`;

      const viewer = request.user || {};
      const requestedMode = (request.query && request.query.mode) || null;
      let mode = modeOfRole(viewer.role);
      // FIX #5: глобал-роли (ADMIN/DIRECTOR_*/BUH/HR/HR_MANAGER) могут запросить любой mode явно.
      // Контракт явно относит BUH/HR/HR_MANAGER к global-ролям — раньше override
      // был только для DIRECTOR_*/ADMIN (через узкий isPriv), это устранено.
      if (requestedMode && GLOBAL_ROLES.includes(viewer.role) && ['pm','warehouse','medical','travel','global'].includes(requestedMode)) {
        mode = requestedMode;
      }
      if (!mode) return reply.code(403).send({ error: 'role_not_supported' });

      // ── 1. Список employees по mode ───────────────────────────────
      // PM: все рабочие, имеющие assignment на работы PM, либо чекин/этап в месяце по этим работам
      // global/warehouse/medical/travel: все рабочие с любым чекином/этапом/assignment в месяце
      //
      // PHASE 1A (V239+): добавлены финансовые поля для расчёта выплат:
      //   • is_self_employed/can_exceed_limit + se_*_initial — для НПД-лимита СЗ
      //   • is_officially_employed/official_salary/official_non_burnable/official_status —
      //     для удержания оклада и определения «оплачиваемого отпуска»
      //   • se.inn — через LEFT JOIN на self_employed (snapshot для отчётов)
      // Все поля NULLABLE-safe: для не-СЗ/не-Оф они придут NULL/false.
      let employees;
      if (mode === 'pm') {
        const { rows } = await db.query(`
          SELECT DISTINCT
                 e.id,
                 COALESCE(e.fio, e.full_name) AS fio,
                 e.phone,
                 e.role_tag AS position,
                 COALESCE(e.is_self_employed,       false) AS is_self_employed,
                 COALESCE(e.is_officially_employed, false) AS is_officially_employed,
                 COALESCE(e.can_exceed_limit,       false) AS can_exceed_limit,
                 e.official_salary,
                 e.official_non_burnable,
                 e.official_status,
                 COALESCE(e.se_yearly_used_initial, 0) AS se_yearly_used_initial,
                 e.se_monthly_used_initial,
                 e.se_payee_id,
                 e.city,
                 se.inn AS inn
          FROM employees e
          LEFT JOIN self_employed se ON se.employee_id = e.id AND COALESCE(se.is_active, true) = true
          WHERE e.id IN (
            SELECT ea.employee_id FROM employee_assignments ea
            JOIN works w ON w.id = ea.work_id
            WHERE w.pm_id = $1
              AND (ea.is_active = true OR ea.departure_date IS NULL OR ea.departure_date >= $2::date)
            UNION
            SELECT fc.employee_id FROM field_checkins fc
            JOIN works w ON w.id = fc.work_id
            WHERE w.pm_id = $1 AND fc.status = 'completed'
              AND fc.date BETWEEN $2::date AND $3::date
            UNION
            SELECT fts.employee_id FROM field_trip_stages fts
            JOIN works w ON w.id = fts.work_id
            WHERE w.pm_id = $1 AND COALESCE(fts.status,'active') NOT IN ('rejected','cancelled')
              AND fts.date_from <= $3::date
              AND COALESCE(fts.date_to, fts.date_from) >= $2::date
          )
          ORDER BY fio
        `, [viewer.id, periodStart, periodEnd]);
        employees = rows;
      } else {
        const { rows } = await db.query(`
          SELECT DISTINCT
                 e.id,
                 COALESCE(e.fio, e.full_name) AS fio,
                 e.phone,
                 e.role_tag AS position,
                 COALESCE(e.is_self_employed,       false) AS is_self_employed,
                 COALESCE(e.is_officially_employed, false) AS is_officially_employed,
                 COALESCE(e.can_exceed_limit,       false) AS can_exceed_limit,
                 e.official_salary,
                 e.official_non_burnable,
                 e.official_status,
                 COALESCE(e.se_yearly_used_initial, 0) AS se_yearly_used_initial,
                 e.se_monthly_used_initial,
                 e.se_payee_id,
                 e.city,
                 se.inn AS inn
          FROM employees e
          LEFT JOIN self_employed se ON se.employee_id = e.id AND COALESCE(se.is_active, true) = true
          WHERE e.id IN (
            SELECT fc.employee_id FROM field_checkins fc
            WHERE fc.status = 'completed'
              AND fc.date BETWEEN $1::date AND $2::date
            UNION
            SELECT fts.employee_id FROM field_trip_stages fts
            WHERE COALESCE(fts.status,'active') NOT IN ('rejected','cancelled')
              AND fts.date_from <= $2::date
              AND COALESCE(fts.date_to, fts.date_from) >= $1::date
            UNION
            SELECT ea.employee_id FROM employee_assignments ea
            WHERE ea.is_active = true OR ea.departure_date IS NULL OR ea.departure_date >= $1::date
            UNION
            -- R-fix (20.06.2026): рабочий мог получить премию/штраф БЕЗ смен в месяце.
            -- Раньше Бауков/Шепеткин с премиями за переточку буров не попадали в табель
            -- (нет смен) → их премии не было видно, total_bonus занижен.
            SELECT wp.employee_id FROM worker_payments wp
            WHERE wp.type IN ('bonus','penalty') AND wp.status != 'cancelled'
              AND COALESCE(wp.pay_year,  EXTRACT(YEAR  FROM wp.created_at)::int) = $3::int
              AND COALESCE(wp.pay_month, EXTRACT(MONTH FROM wp.created_at)::int) = $4::int
            UNION
            -- Stage S (20.06.2026): рабочий мог получить ВЫПЛАТУ из поля (суточные/
            -- оклад/аванс/премия) БЕЗ смен в видимом месяце. Без этой строки UNION
            -- его paid_cash/paid_transfer не попадут в total_paid_* у summary и
            -- блок «УЖЕ ВЫПЛАЧЕНО В ПОЛЕ» в дашборде покажет неполную сумму.
            SELECT wp.employee_id FROM worker_payments wp
            WHERE wp.status IN ('paid','confirmed')
              AND wp.type IN ('per_diem','salary','advance','bonus')
              AND COALESCE(wp.pay_year,  EXTRACT(YEAR  FROM wp.created_at)::int) = $3::int
              AND COALESCE(wp.pay_month, EXTRACT(MONTH FROM wp.created_at)::int) = $4::int
            UNION
            -- M3 (20.06.2026): официально устроенные ВСЕГДА в табеле, даже без смен —
            -- компания обязана платить несгораемую часть (по ТК). Без этого их
            -- transfer/cash_payout не попадают в Σ К переводу/Из кассы.
            SELECT id FROM employees WHERE COALESCE(is_officially_employed, false) = true
              AND COALESCE(is_active, true) = true
          )
          ORDER BY fio
        `, [periodStart, periodEnd, year, month]);
        employees = rows;
      }

      // ── 2. Чекины + этапы за месяц ───────────────────────────────
      const empIds = employees.map(e => e.id);
      if (empIds.length === 0) {
        const locks = await getActiveLocks(fastify, year, month);
        const settings = await loadSettings(db);
        const columns = {
          points:  mode === 'pm' ? 'mine' : (mode === 'global' ? 'always' : 'none'),
          amount:  mode === 'global' ? 'show' : 'none',
          perDiem: mode === 'pm' ? 'show' : 'none'
        };
        // PHASE 1A: summary при пустом списке — нулевая сводка для global,
        // null для остальных mode. Лимиты компании всё равно дёргаем (могут быть
        // переводы по СЗ, которых нет в текущей выборке employees).
        let summary = null;
        if (mode === 'global') {
          let monthlyLimit = 350000, yearlyLimit = 2400000;
          try {
            const { rows: lRows } = await db.query(`
              SELECT key, value_json FROM settings
               WHERE key IN ('self_employed_monthly_limit', 'self_employed_yearly_limit')
            `);
            for (const r of lRows) {
              const v = parseFloat(String(r.value_json).replace(/[^\d.\-]/g, ''));
              if (Number.isFinite(v) && v >= 0) {
                if (r.key === 'self_employed_monthly_limit') monthlyLimit = v;
                if (r.key === 'self_employed_yearly_limit')  yearlyLimit  = v;
              }
            }
          } catch (_) {}
          let monthUsedCompany = 0, yearUsedCompany = 0;
          try {
            const { rows: cm } = await db.query(`
              SELECT COALESCE(SUM(transfer_amount), 0)::numeric AS total
                FROM se_transfers
               WHERE year = $1 AND month = $2 AND status != 'cancelled'
            `, [year, month]);
            monthUsedCompany = Number(cm[0]?.total) || 0;
          } catch (_) {}
          try {
            const { rows: cy } = await db.query(`
              SELECT COALESCE(SUM(transfer_amount), 0)::numeric AS total
                FROM se_transfers
               WHERE year = $1 AND status != 'cancelled'
            `, [year]);
            yearUsedCompany = Number(cy[0]?.total) || 0;
          } catch (_) {}
          summary = {
            year, month,
            employees_count: 0,
            days_total: 0,
            by_type: { self_employed: 0, official: 0, cash: 0 },
            total_earned: 0,
            total_transfer: 0,
            total_cash_payout: 0,
            total_cash_return: 0,
            net_cash: 0,
            limits: {
              monthly: monthlyLimit,
              yearly:  yearlyLimit,
              month_used_company: Math.round(monthUsedCompany * 100) / 100,
              year_used_company:  Math.round(yearUsedCompany  * 100) / 100
            }
          };
        }
        return {
          year, month, days_in_month: dim, mode,
          viewer: { id: viewer.id, role: viewer.role, fio: viewer.name || viewer.full_name || viewer.fio || '' },
          employees: [],
          locks,
          settings,
          columns,
          summary
        };
      }

      // FIX 7: добавлен w.pm_id — нужно для is_mine = pm работы == viewer.id
      // (РП видит баллы по СВОИМ работам, не по тому что сам ввёл).
      const { rows: checkins } = await db.query(`
        SELECT fc.id, fc.employee_id, fc.work_id, fc.date, fc.shift,
               fc.amount_earned, fc.day_rate, fc.hours_worked,
               fc.entered_by_user_id, fc.checkin_by, fc.checkin_source,
               fc.created_at,
               u.name AS entered_by_fio_user, u.role AS entered_by_role_user, u.phone AS entered_by_phone_user,
               w.work_title, w.pm_id AS work_pm_id,
               ftg.points AS tariff_points
        FROM field_checkins fc
        LEFT JOIN users u   ON u.id = fc.entered_by_user_id
        LEFT JOIN works w   ON w.id = fc.work_id
        LEFT JOIN employee_assignments ea ON ea.id = fc.assignment_id
        LEFT JOIN field_tariff_grid ftg ON ftg.id = ea.tariff_id
        WHERE fc.status = 'completed'
          AND fc.date BETWEEN $1::date AND $2::date
          AND fc.employee_id = ANY($3::int[])
      `, [periodStart, periodEnd, empIds]);

      // FIX 7: добавлен w.pm_id для is_mine (pm работы)
      const { rows: stages } = await db.query(`
        SELECT fts.id, fts.employee_id, fts.work_id, fts.stage_type,
               fts.date_from, fts.date_to, fts.days_count,
               fts.amount_earned, fts.rate_per_day, fts.tariff_points,
               fts.entered_by_user_id, fts.created_by, fts.source,
               fts.created_at,
               u.name AS entered_by_fio_user, u.role AS entered_by_role_user, u.phone AS entered_by_phone_user,
               w.work_title, w.pm_id AS work_pm_id
        FROM field_trip_stages fts
        LEFT JOIN users u   ON u.id = fts.entered_by_user_id
        LEFT JOIN works w   ON w.id = fts.work_id
        WHERE COALESCE(fts.status,'active') NOT IN ('rejected','cancelled')
          AND fts.date_from <= $2::date
          AND COALESCE(fts.date_to, fts.date_from) >= $1::date
          AND fts.employee_id = ANY($3::int[])
      `, [periodStart, periodEnd, empIds]);

      // per_diem_total за этот конкретный месяц.
      // FIX (18.06.2026): записи worker_payments хранят полные командировки (несколько месяцев)
      // в одной строке с amount за весь период. «Период пересекается» давало double-count
      // (одна 65-дневная командировка попадала в каждый месяц где пересекалась).
      // Теперь фильтр строгий — по pay_year/pay_month «когда зарегистрировано»;
      // если эти поля пусты — fallback на месяц period_from.
      const { rows: perDiemRows } = await db.query(`
        SELECT wp.employee_id, SUM(wp.amount)::numeric AS pd_total
        FROM worker_payments wp
        WHERE wp.type = 'per_diem' AND wp.status != 'cancelled'
          AND wp.employee_id = ANY($3::int[])
          AND wp.period_from <= $2::date  -- безопасная отсечка
          AND COALESCE(wp.pay_year,  EXTRACT(year  FROM wp.period_from)::int) = EXTRACT(year  FROM $1::date)::int
          AND COALESCE(wp.pay_month, EXTRACT(month FROM wp.period_from)::int) = EXTRACT(month FROM $1::date)::int
        GROUP BY wp.employee_id
      `, [periodStart, periodEnd, empIds]);
      const perDiemMap = {};
      for (const p of perDiemRows) perDiemMap[p.employee_id] = Number(p.pd_total) || 0;

      // ── BATCH-резолв FIO для 'self'/'master' источников (FIX #8 + FIX #9) ──
      // FIX #8: раньше resolveEmpFio делал N round-trips (один на каждый чекин).
      //         На 100+ чекинах это становится bottleneck'ом.
      // FIX #9: cross-namespace bypass — раньше fallback на employees мог сработать
      //         для admin/manual-источников при случайном совпадении user.id == employee.id
      //         и вернуть ЧУЖОЕ ФИО. Теперь строго гейтим по checkin_source:
      //           self|master   → ТОЛЬКО employees (checkin_by = employee_id)
      //           manual|pm_manual|admin → ТОЛЬКО users (через entered_by_user_id)
      //         Никаких cross-table fallbacks.
      const empIdsForFio = new Set();
      for (const c of checkins) {
        if (!c.entered_by_fio_user
            && (c.checkin_source === 'self' || c.checkin_source === 'master')
            && c.checkin_by) {
          empIdsForFio.add(Number(c.checkin_by));
        }
      }
      const empFioCache = {};
      const empPhoneCache = {};
      if (empIdsForFio.size > 0) {
        const ids = Array.from(empIdsForFio);
        const { rows: empFioRows } = await db.query(
          `SELECT id, COALESCE(fio, full_name) AS fio, phone FROM employees WHERE id = ANY($1::int[])`,
          [ids]
        );
        for (const r of empFioRows) {
          empFioCache[r.id] = r.fio || null;
          empPhoneCache[r.id] = r.phone || null;
        }
        // отметим missing id'ишники чтобы не дёргать БД повторно
        for (const id of ids) {
          if (!(id in empFioCache)) empFioCache[id] = null;
        }
      }

      // ── BATCH-резолв users.name для stages.created_by (FIX #8) ──
      // Раньше каждый stage с пустым entered_by_user_id, но заполненным created_by
      // делал SELECT users WHERE id=$1 — N round-trips. Собираем уникальные id и
      // делаем один IN-запрос.
      // FIX #9 (для stages): created_by в field_trip_stages исторически = users.id.
      //         Не делаем fallback в employees — это чужой namespace.
      const userIdsForStage = new Set();
      for (const s of stages) {
        if (!s.entered_by_fio_user && s.created_by) {
          userIdsForStage.add(Number(s.created_by));
        }
      }
      const userFioCache = {};
      if (userIdsForStage.size > 0) {
        const ids = Array.from(userIdsForStage);
        const { rows: userRows } = await db.query(
          `SELECT id, name, role, phone FROM users WHERE id = ANY($1::int[])`,
          [ids]
        );
        for (const r of userRows) {
          userFioCache[r.id] = { name: r.name || null, role: r.role || null, phone: r.phone || null };
        }
      }

      const settings = await loadSettings(db);

      // ── 3. Сборка employees → days ──────────────────────────────────
      // PHASE 1A: для каждого emp добавляем сырые «финансовые» поля,
      // на которых ниже посчитаем pay_type/transfer_amount/cash_*/yearly_*/monthly_*.
      const empById = {};
      for (const e of employees) {
        empById[e.id] = {
          id: e.id,
          fio: e.fio || '—',
          phone: e.phone || '',
          position: e.position || '',
          // Q-3 (19.06.2026): город — для Excel-колонки «Город».
          city: e.city || '',
          days: {},
          total_points: 0,
          total_amount: 0,
          per_diem_total: 0,
          // raw HR-поля (используются в расчёте выплат ниже)
          is_self_employed:       !!e.is_self_employed,
          is_officially_employed: !!e.is_officially_employed,
          can_exceed_limit:       !!e.can_exceed_limit,
          official_salary:        e.official_salary != null ? Number(e.official_salary) : null,
          official_non_burnable:  e.official_non_burnable != null ? Number(e.official_non_burnable) : null,
          official_status:        e.official_status || null,
          inn:                    e.is_self_employed ? (e.inn || null) : null,
          // V240: привязка к СЗ-получателю (НПД-выплаты идут на родственника).
          se_payee_id:            e.se_payee_id != null ? Number(e.se_payee_id) : null,
          // initial offsets
          _se_yearly_used_initial:  Number(e.se_yearly_used_initial || 0),
          _se_monthly_used_initial: e.se_monthly_used_initial || null
        };
      }

      // helper: применить projection и положить cell в день D
      // dayKey приходит в ISO ('YYYY-MM-DD'); контракт требует ключ — НОМЕР дня (1-31).
      function placeCell(emp, dayKey, type, raw) {
        // Конверсия ISO → номер дня (string '1'..'31') — контракт TIMESHEET_V2_CONTRACT.md:38-62.
        let numKey = dayKey;
        if (typeof dayKey === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dayKey)) {
          numKey = String(parseInt(dayKey.slice(8, 10), 10));
        } else {
          numKey = String(dayKey);
        }
        if (emp.days[numKey]) return; // первая запись побеждает (как в global-timesheet)
        // raw: { points, amount, entered_by_fio, entered_by_role, entered_by_phone, entered_at, is_mine, work_id, work_title }
        // projection per mode
        let points = raw.points;
        let amount = raw.amount;
        if (mode === 'pm') {
          if (!raw.is_mine) {
            points = null;
          }
          amount = null;
        } else if (mode === 'warehouse' || mode === 'medical' || mode === 'travel') {
          points = null;
          amount = null;
        } else if (mode === 'global') {
          // оставляем числа
        }
        emp.days[numKey] = {
          type,
          points,
          amount,
          entered_by_fio: raw.entered_by_fio || null,
          entered_by_role: raw.entered_by_role || null,
          entered_by_phone: raw.entered_by_phone || null, // FIX #5: «понять кто написал — phone»
          entered_at: raw.entered_at || null,
          is_mine: !!raw.is_mine,
          work_id: raw.work_id || null,
          work_title: raw.work_title || null
        };
      }

      // ── checkins (day/night) ─────────────────────────────────────────
      for (const c of checkins) {
        const emp = empById[c.employee_id];
        if (!emp) continue;
        const dStr = fmtDate(c.date);
        const type = cellTypeFromShift(c.shift);
        const amt = Number(c.amount_earned || 0);
        // FIX #3 (агент 1): баллы = field_tariff_grid.points (через assignment.tariff_id), а
        // НЕ day_rate (это рубли). day_rate перепутали с баллами в старой
        // реализации → global mode total_points показывал ставку, а не баллы.
        // Fallback цепочка: tariff.points → 0 (если тарифа нет — баллы не считаются).
        const points = (c.tariff_points != null) ? Number(c.tariff_points) : 0;
        // resolve entered_by_fio/role/phone (FIX #5 + FIX #8 batch + FIX #9 strict source-gating)
        let fio = c.entered_by_fio_user;
        let role = c.entered_by_role_user;
        let phone = c.entered_by_phone_user || null;
        if (!fio && (c.checkin_source === 'self' || c.checkin_source === 'master') && c.checkin_by) {
          // FIX #9: для 'self'/'master' checkin_by — ВСЕГДА employee.id.
          // НИКОГДА не делаем fallback в users (другой namespace).
          fio = empFioCache[c.checkin_by] || null;
          phone = empPhoneCache[c.checkin_by] || null;
          role = (c.checkin_source === 'self') ? 'WORKER' : 'MASTER';
        }
        // FIX 7: is_mine для PM считается по work.pm_id, а не по entered_by_user_id.
        // ТЗ: «РП видит баллы по СВОИМ работам». Раньше считали только то что PM
        // сам ввёл → если рабочий сам отметился (self-checkin), PM не видел баллов.
        // Для не-pm режимов is_mine = автор записи (для подсветки «своё» в UI).
        const isMine = (mode === 'pm')
          ? (c.work_pm_id != null && Number(c.work_pm_id) === Number(viewer.id))
          : (c.entered_by_user_id && Number(c.entered_by_user_id) === Number(viewer.id));
        placeCell(emp, dStr, type, {
          points,
          amount: amt,
          entered_by_fio: fio,
          entered_by_role: role,
          entered_by_phone: phone,
          entered_at: c.created_at,
          is_mine: !!isMine,
          work_id: c.work_id,
          work_title: c.work_title
        });
        if (mode === 'global') {
          emp.total_amount += amt;
          if (Number.isFinite(points)) emp.total_points += Number(points);
        } else if (mode === 'pm' && isMine) {
          if (Number.isFinite(points)) emp.total_points += Number(points);
        }
      }

      // ── stages (warehouse/medical/travel/waiting) ─────────────────────
      for (const s of stages) {
        const emp = empById[s.employee_id];
        if (!emp) continue;
        const stageType = s.stage_type;
        if (!['warehouse','medical','travel','waiting'].includes(stageType)) continue;

        const fromD = new Date(s.date_from);
        const toD = s.date_to ? new Date(s.date_to) : fromD;
        const startMs = Math.max(fromD.getTime(), new Date(periodStart).getTime());
        const endMs = Math.min(toD.getTime(), new Date(periodEnd).getTime());
        const oneDay = 24 * 60 * 60 * 1000;
        const realDays = Math.max(1, Math.round((toD.getTime() - fromD.getTime()) / oneDay) + 1);
        const perDayAmt = Number(s.amount_earned || 0) / Math.max(1, Number(s.days_count || realDays));
        const perDayPts = pointsFor(settings, stageType, emp.position);

        // FIX #5 (phone) + FIX #8 (batch — без N round-trips) + FIX #9 (strict namespace).
        let fio = s.entered_by_fio_user;
        let role = s.entered_by_role_user;
        let phone = s.entered_by_phone_user || null;
        if (!fio && s.created_by) {
          // FIX #9: created_by для field_trip_stages — ВСЕГДА users.id (не employees).
          // Не делаем fallback в employees при отсутствии — лучше null, чем чужое ФИО.
          const u = userFioCache[s.created_by];
          if (u) {
            fio = u.name;
            role = u.role;
            phone = u.phone;
          }
        }
        // FIX 7: is_mine для PM по work.pm_id (РП «своя работа»), не по author
        const isMine = (mode === 'pm')
          ? (s.work_pm_id != null && Number(s.work_pm_id) === Number(viewer.id))
          : (s.entered_by_user_id && Number(s.entered_by_user_id) === Number(viewer.id));

        for (let t = startMs; t <= endMs; t += oneDay) {
          const dStr = fmtDate(new Date(t));
          placeCell(emp, dStr, stageType, {
            points: perDayPts,
            amount: perDayAmt,
            entered_by_fio: fio,
            entered_by_role: role,
            entered_by_phone: phone,
            entered_at: s.created_at,
            is_mine: !!isMine,
            work_id: s.work_id,
            work_title: s.work_title
          });
          if (mode === 'global') {
            emp.total_amount += perDayAmt;
            if (Number.isFinite(perDayPts)) emp.total_points += Number(perDayPts);
          } else if (mode === 'pm' && isMine) {
            if (Number.isFinite(perDayPts)) emp.total_points += Number(perDayPts);
          }
        }
      }

      // ── per_diem_total ───────────────────────────────────────────────
      // ВАЖНО: на этом шаге заранее сохраняем «настоящий» total_amount в
      // _earned_full — потом мы его обнулим/занулим под mode-проекцию для
      // совместимости с фронтами, но финансовая логика (transfer/cash) ВСЕГДА
      // должна считаться по реально заработанному, а не по тому, что показывает
      // данный mode.
      for (const emp of Object.values(empById)) {
        const pd = perDiemMap[emp.id] || 0;
        // Заморозим реально заработанное ДО проекции
        emp._earned_full = Number(emp.total_amount || 0);
        if (mode === 'global') {
          emp.per_diem_total = null; // бух не видит суточные
        } else if (mode === 'pm') {
          emp.per_diem_total = Number(pd);
        } else {
          emp.per_diem_total = null;
        }
        if (mode === 'pm') {
          emp.total_amount = null;
        } else if (mode === 'warehouse' || mode === 'medical' || mode === 'travel') {
          emp.total_points = null;
          emp.total_amount = null;
        }
        // округление
        if (Number.isFinite(emp.total_points)) emp.total_points = Math.round(emp.total_points * 100) / 100;
        if (Number.isFinite(emp.total_amount)) emp.total_amount = Math.round(emp.total_amount * 100) / 100;
      }

      // ────────────────────────────────────────────────────────────────
      // PHASE 1A: расчёт выплат (pay_type, transfer/cash, СЗ-лимиты, summary)
      //
      // Источник: TIMESHEET_V2_CONTRACT_PHASE1.md, секции «Логика расчёта» и
      // «Блок summary». Считается для ВСЕХ mode (поля приходят на фронт,
      // фронт сам решает что показывать). summary заполняется ТОЛЬКО для global.
      // ────────────────────────────────────────────────────────────────

      // Лимиты СЗ из settings (с дефолтами из admin-system.js):
      //   self_employed_monthly_limit = 350 000
      //   self_employed_yearly_limit  = 2 400 000
      let monthlyLimit = 350000;
      let yearlyLimit  = 2400000;
      try {
        const { rows: lRows } = await db.query(`
          SELECT key, value_json
            FROM settings
           WHERE key IN ('self_employed_monthly_limit', 'self_employed_yearly_limit')
        `);
        for (const r of lRows) {
          const v = parseFloat(String(r.value_json).replace(/[^\d.\-]/g, ''));
          if (Number.isFinite(v) && v >= 0) {
            if (r.key === 'self_employed_monthly_limit') monthlyLimit = v;
            if (r.key === 'self_employed_yearly_limit')  yearlyLimit  = v;
          }
        }
      } catch (_) { /* settings table missing — оставляем дефолты */ }

      // Агрегаты se_transfers (год / месяц) — два батч-SELECT'а.
      // ВАЖНО: только status != 'cancelled' (V143: planned/transferred/returned/completed).
      const transfersYearMap  = {}; // employee_id -> SUM(transfer_amount) за год
      const transfersMonthMap = {}; // employee_id -> SUM(transfer_amount) за месяц
      // Q-2 (19.06.2026): накопление годового лимита НПД через se_monthly_history.
      // Каждый импорт Excel от Озон-Банка (POST /api/staff/se-limits/apply) пишет
      // запись за месяц. yearly_used теперь = SUM(monthly_used) FROM se_monthly_history
      // + SUM(se_transfers за год) + initial offset. Без этого «прошлые месяцы»
      // забывались: бух импортировал каждый новый месяц, а старые сжимались до 0.
      const yearlyHistoryByEmp = {}; // employee_id -> SUM(monthly_used за год) из истории

      // PHASE 1B+ (премии/штрафы): агрегаты worker_payments за период (pay_year/pay_month).
      // По требованию пользователя earned = смены + bonus − penalty, чтобы в табеле
      // (и в payroll-dashboard через ту же формулу) бух/директор видели итоговую
      // сумму, а не голую сумму со смен.
      //   status != 'cancelled' — pending/paid/confirmed/иное всё засчитываем,
      //   потому что premия может быть «начислена но ещё не выплачена», и она
      //   уже должна попасть в earned за свой месяц.
      const bonusMap   = {};   // employee_id -> SUM bonus за месяц
      const penaltyMap = {};   // employee_id -> SUM penalty за месяц
      // B3 (19.06.2026): COALESCE pay_year/pay_month — старые записи без явных
      // pay_year/pay_month падают в bucket по created_at. До этого фикса
      // bonus/penalty без pay_year считались как «не относится к месяцу»
      // → пропадали из earned. Паттерн уже применён для per_diem (строки 456-457).
      try {
        const { rows: bpRows } = await db.query(`
          SELECT employee_id,
            COALESCE(SUM(CASE WHEN type='bonus'   AND status != 'cancelled' THEN amount END), 0)::numeric AS bonus_total,
            COALESCE(SUM(CASE WHEN type='penalty' AND status != 'cancelled' THEN amount END), 0)::numeric AS penalty_total
          FROM worker_payments
          WHERE employee_id = ANY($1::int[])
            AND COALESCE(pay_year,  EXTRACT(YEAR  FROM created_at)::int) = $2
            AND COALESCE(pay_month, EXTRACT(MONTH FROM created_at)::int) = $3
          GROUP BY employee_id
        `, [empIds, year, month]);
        for (const r of bpRows) {
          bonusMap[r.employee_id]   = Number(r.bonus_total)   || 0;
          penaltyMap[r.employee_id] = Number(r.penalty_total) || 0;
        }
      } catch (_) { /* worker_payments не существует — оставляем 0 */ }

      // ────────────────────────────────────────────────────────────────
      // Stage S (20.06.2026): paid-агрегаты per emp за месяц.
      //   paid_cash     — нал из поля (РП в поле выдал нал, status=paid/confirmed)
      //   paid_transfer — переводы/карта/auto (включая NULL → бэкап-логика
      //                   старых записей где payment_method не проставили)
      //   paid_breakdown — разбивка по типам (per_diem/salary/advance/bonus) для
      //                    tooltip-а и Excel-комментария
      //   penalty НЕ суммируется — это удержание, не «выплата»
      // Контракт: TIMESHEET_V2_PAID_CONTRACT.md.
      // Используется для:
      //   • показать «уже выплачено в поле» в дашборде/таблице
      //   • защита от двойной выплаты на стороне фронта/бэка (worker-payments.js)
      //   • cash-coverage cashNeeded = total_cash_payout − total_paid_cash
      // ────────────────────────────────────────────────────────────────
      const paidMap = {};   // employee_id -> { paid_cash, paid_transfer, paid_per_diem, paid_salary, paid_advance, paid_bonus }
      try {
        const { rows: paidRows } = await db.query(`
          SELECT employee_id,
            SUM(CASE WHEN payment_method = 'cash' THEN amount ELSE 0 END)::numeric AS paid_cash,
            SUM(CASE WHEN payment_method IN ('transfer','card','auto')
                      OR payment_method IS NULL THEN amount ELSE 0 END)::numeric AS paid_transfer,
            SUM(CASE WHEN type = 'per_diem' THEN amount ELSE 0 END)::numeric AS paid_per_diem,
            SUM(CASE WHEN type = 'salary'   THEN amount ELSE 0 END)::numeric AS paid_salary,
            SUM(CASE WHEN type = 'advance'  THEN amount ELSE 0 END)::numeric AS paid_advance,
            SUM(CASE WHEN type = 'bonus'    THEN amount ELSE 0 END)::numeric AS paid_bonus
          FROM worker_payments
          WHERE employee_id = ANY($1::int[])
            AND status IN ('paid','confirmed')
            AND type IN ('per_diem','salary','advance','bonus')
            AND COALESCE(pay_year,  EXTRACT(YEAR  FROM created_at)::int) = $2
            AND COALESCE(pay_month, EXTRACT(MONTH FROM created_at)::int) = $3
          GROUP BY employee_id
        `, [empIds, year, month]);
        for (const r of paidRows) {
          paidMap[r.employee_id] = {
            paid_cash:     Number(r.paid_cash)     || 0,
            paid_transfer: Number(r.paid_transfer) || 0,
            paid_per_diem: Number(r.paid_per_diem) || 0,
            paid_salary:   Number(r.paid_salary)   || 0,
            paid_advance:  Number(r.paid_advance)  || 0,
            paid_bonus:    Number(r.paid_bonus)    || 0
          };
        }
      } catch (_) { /* worker_payments не существует — paidMap пуст, поля будут 0 */ }

      // ── Год / месяц только если есть СЗ-сотрудники (иначе пустой запрос
      //    лишним был бы, но и в пустом empIds возврат уже произошёл выше) ──
      //
      // V240: лимиты считаем не только для СЗ-сотрудников в выборке, но и для
      // их payee'ев (родственников-получателей). Payee может НЕ иметь смен в
      // месяце → его нет в empIds, но его лимиты нужны для расчёта transfer
      // у привязанного рабочего.
      const seEmpIds = Object.values(empById)
        .filter(e => e.is_self_employed)
        .map(e => e.id);
      const payeeIdsFromWorkers = Object.values(empById)
        .filter(e => e.se_payee_id)
        .map(e => Number(e.se_payee_id));
      const limitsIds = Array.from(new Set([...seEmpIds, ...payeeIdsFromWorkers]));

      // payeeInfoById: данные о payee (для тех, кого нет в employees-выборке).
      // Содержит: id, fio, can_exceed_limit, se_yearly_used_initial, se_monthly_used_initial.
      const payeeInfoById = {};
      const payeesToLoad = payeeIdsFromWorkers.filter(pid => !empById[pid]);
      if (payeesToLoad.length > 0) {
        try {
          const { rows: pRows } = await db.query(`
            SELECT e.id,
                   COALESCE(e.fio, e.full_name) AS fio,
                   COALESCE(e.can_exceed_limit, false) AS can_exceed_limit,
                   COALESCE(e.se_yearly_used_initial, 0) AS se_yearly_used_initial,
                   e.se_monthly_used_initial,
                   se.inn AS inn
              FROM employees e
              LEFT JOIN self_employed se ON se.employee_id = e.id AND COALESCE(se.is_active, true) = true
             WHERE e.id = ANY($1::int[])
          `, [payeesToLoad]);
          for (const r of pRows) {
            payeeInfoById[r.id] = {
              id: r.id,
              fio: r.fio || '—',
              can_exceed_limit: !!r.can_exceed_limit,
              _se_yearly_used_initial: Number(r.se_yearly_used_initial || 0),
              _se_monthly_used_initial: r.se_monthly_used_initial || null,
              inn: r.inn || null
            };
          }
        } catch (_) {}
      }
      // Также «зеркалим» payee'ев, которые УЖЕ в empById (на случай если payee
      // сам тоже работает и попал в выборку).
      for (const pid of payeeIdsFromWorkers) {
        if (empById[pid] && !payeeInfoById[pid]) {
          payeeInfoById[pid] = {
            id: pid,
            fio: empById[pid].fio,
            can_exceed_limit: empById[pid].can_exceed_limit,
            _se_yearly_used_initial: empById[pid]._se_yearly_used_initial,
            _se_monthly_used_initial: empById[pid]._se_monthly_used_initial,
            inn: empById[pid].inn
          };
        }
      }

      if (limitsIds.length > 0) {
        try {
          const { rows: yRows } = await db.query(`
            SELECT employee_id, COALESCE(SUM(transfer_amount), 0)::numeric AS total
              FROM se_transfers
             WHERE employee_id = ANY($1::int[])
               AND year = $2
               AND status != 'cancelled'
             GROUP BY employee_id
          `, [limitsIds, year]);
          for (const r of yRows) transfersYearMap[r.employee_id] = Number(r.total) || 0;
        } catch (_) { /* se_transfers missing — лимиты будут только initial */ }
        try {
          const { rows: mRows } = await db.query(`
            SELECT employee_id, COALESCE(SUM(transfer_amount), 0)::numeric AS total
              FROM se_transfers
             WHERE employee_id = ANY($1::int[])
               AND year = $2
               AND month = $3
               AND status != 'cancelled'
             GROUP BY employee_id
          `, [limitsIds, year, month]);
          for (const r of mRows) transfersMonthMap[r.employee_id] = Number(r.total) || 0;
        } catch (_) {}
        // Q-2: SUM месячных снимков за весь год из se_monthly_history.
        // Graceful: таблица может отсутствовать в старых БД (миграция V242).
        try {
          const { rows: hRows } = await db.query(`
            SELECT employee_id, COALESCE(SUM(monthly_used), 0)::numeric AS year_history_used
              FROM se_monthly_history
             WHERE employee_id = ANY($1::int[])
               AND year = $2
             GROUP BY employee_id
          `, [limitsIds, year]);
          for (const r of hRows) {
            yearlyHistoryByEmp[r.employee_id] = Number(r.year_history_used) || 0;
          }
        } catch (_) { /* se_monthly_history отсутствует — оставляем 0 */ }
      }

      // Расчёт по каждому сотруднику.
      for (const emp of Object.values(empById)) {
        // PHASE 1B+ финальная формула earned:
        //   earned = (смены: field_checkins + field_trip_stages за месяц)
        //          + bonus  (worker_payments type='bonus'   за месяц, !=cancelled)
        //          − penalty(worker_payments type='penalty' за месяц, !=cancelled)
        //   nonneg: Math.max(0, ...) — отрицательная зарплата невозможна
        const earnedFromShifts = Number(emp._earned_full || 0);
        const bonus   = Number(bonusMap[emp.id]   || 0);
        const penalty = Number(penaltyMap[emp.id] || 0);
        const earned  = Math.max(0, earnedFromShifts + bonus - penalty);

        // По контракту: pay_type / earned / deduct_salary / transfer_amount /
        // cash_payout / cash_return + (для СЗ) yearly/monthly _used/_remaining.
        emp.earned = Math.round(earned * 100) / 100;
        emp.earned_from_shifts = Math.round(earnedFromShifts * 100) / 100;
        emp.bonus   = Math.round(bonus   * 100) / 100;
        emp.penalty = Math.round(penalty * 100) / 100;
        emp.deduct_salary    = 0;
        emp.transfer_amount  = 0;
        emp.cash_payout      = 0;
        emp.cash_return      = 0;
        emp.yearly_used      = null;
        emp.yearly_remaining = null;
        emp.monthly_used     = null;
        emp.monthly_remaining= null;

        if (emp.is_self_employed) {
          // V240: если у рабочего привязан se_payee_id — это «рабочий через
          // получателя». pay_type='self_employed_payee'. Лимиты НПД берём у
          // payee'я (не у самого рабочего). Если payee не загружен (битая
          // ссылка) — деградируем до обычного self_employed.
          let limitsHolder = emp;        // у кого считаем лимиты
          let payeeFio = null;
          let payeeId  = null;
          if (emp.se_payee_id && payeeInfoById[emp.se_payee_id]) {
            limitsHolder = payeeInfoById[emp.se_payee_id];
            payeeFio = limitsHolder.fio || null;
            payeeId  = limitsHolder.id;
            emp.pay_type  = 'self_employed_payee';
            emp.payee_fio = payeeFio;
            emp.payee_id  = payeeId;
          } else {
            emp.pay_type = 'self_employed';
            emp.payee_fio = null;
            emp.payee_id  = null;
          }

          // monthly_used = SUM(se_transfers) + (initial if Y/M совпадает)
          // — считаем по limitsHolder.id (либо emp, либо payee).
          const lid = limitsHolder.id;
          const trYear  = Number(transfersYearMap[lid]  || 0);
          const trMonth = Number(transfersMonthMap[lid] || 0);

          const yrInitial = Number(limitsHolder._se_yearly_used_initial || 0);
          let moInitial = 0;
          const mi = limitsHolder._se_monthly_used_initial;
          if (mi && typeof mi === 'object' &&
              Number(mi.year)  === Number(year)  &&
              Number(mi.month) === Number(month)) {
            const amt = Number(mi.amount || 0);
            if (Number.isFinite(amt)) moInitial = amt;
          }

          // Q-2: накопительный годовой расход = история месячных импортов
          // (Excel от Озон-Банка) + переводы за год + initial offset.
          // se_monthly_history заполняется через POST /api/staff/se-limits/apply.
          const yrHistory = Number(yearlyHistoryByEmp[lid] || 0);
          const yrUsed = yrHistory + trYear + yrInitial;
          const moUsed = trMonth + moInitial;
          const yrRem  = Math.max(0, yearlyLimit  - yrUsed);
          // Базовый месячный остаток (показывается во фронте как monthly_remaining):
          // НЕ затрагивается can_exceed_limit — это «честный» остаток лимита НПД.
          const moRemBase = Math.max(0, monthlyLimit - moUsed);
          // Для расчёта transfer'а используем расширенный остаток, если у
          // ВЛАДЕЛЬЦА ЛИМИТА can_exceed_limit=true (снят месячный потолок).
          let moRemForTransfer = moRemBase;
          if (limitsHolder.can_exceed_limit) {
            moRemForTransfer = Math.max(moRemBase, earned);
          }

          // К переводу: min(earned, месячный_остаток_override, годовой_остаток)
          const transfer = Math.min(earned, moRemForTransfer, yrRem);
          emp.transfer_amount = Math.max(0, transfer);
          emp.cash_payout     = Math.max(0, earned - emp.transfer_amount);
          emp.cash_return     = 0; // (cash_return появится в Этапе 3)

          // INN для отчёта — у payee, если есть привязка.
          if (payeeId && limitsHolder.inn) emp.inn = limitsHolder.inn;

          emp.yearly_used       = Math.round(yrUsed * 100) / 100;
          emp.yearly_remaining  = Math.round(yrRem  * 100) / 100;
          emp.monthly_used      = Math.round(moUsed * 100) / 100;
          // monthly_remaining — базовый остаток (без override), чтобы во фронте
          // не показывать «999 999 999» когда can_exceed_limit=true.
          emp.monthly_remaining = Math.round(moRemBase * 100) / 100;
        }
        else if (emp.is_officially_employed) {
          // Stage U (20.06.2026): официальная выплата = бух vs директор.
          // Бух платит через банк по ТК: несгораемую если задана, иначе полный оклад.
          // Директор доплачивает остаток налом из табельной кассы (премия наличными).
          //   • unpaid_leave: никто не платит (transfer=0, cash=0, deduct=0).
          //   • иначе:
          //       deductSalary    = nonBurnable > 0 ? nonBurnable : salary
          //       transferAmount  = deductSalary           — банк, ответственность бухгалтера
          //       cashPayout      = max(0, earned − deductSalary)  — нал, ответственность директора
          // Edge cases (из контракта TIMESHEET_V2_OFFICIAL_CONTRACT.md):
          //   A: earned=80k, salary=60k, non_b=30k, active → transfer=30k, cash=50k
          //   B: earned=80k, salary=60k, non_b=0,   active → transfer=60k, cash=20k
          //   C: earned=20k, salary=60k, non_b=30k, active → transfer=30k, cash=0
          //   D: earned=0,   salary=60k, non_b=30k, active → transfer=30k, cash=0
          //   E: earned=0,   salary=60k, non_b=30k, unpaid_leave → transfer=0, cash=0
          //   F: earned=0,   salary=60k, non_b=0,   active → transfer=60k, cash=0
          // SSoT с payroll-dashboard.js (/summary, /cash-calc).
          emp.pay_type = 'official';
          const nonBurnable = Number(emp.official_non_burnable || 0);
          const salary      = Number(emp.official_salary || 0);
          let deductSalary, transferAmount, cashPayout;
          if (emp.official_status === 'unpaid_leave') {
            deductSalary = 0; transferAmount = 0; cashPayout = 0;
          } else {
            // Бух платит несгораемую если задана, иначе полный оклад
            deductSalary    = nonBurnable > 0 ? nonBurnable : salary;
            transferAmount  = deductSalary;
            cashPayout      = Math.max(0, earned - deductSalary);
          }
          emp.deduct_salary = deductSalary;
          emp.deduct_official = deductSalary; // alias для UI
          emp.transfer_amount = transferAmount;
          emp.cash_payout = cashPayout;
          emp.pay_responsibility = deductSalary > 0 && cashPayout > 0 ? 'mixed' : (deductSalary > 0 ? 'buh' : 'director');
          emp.cash_return = 0;
        }
        else {
          emp.pay_type        = 'cash';
          emp.transfer_amount = 0;
          emp.cash_payout     = earned;
          emp.cash_return     = 0;
        }

        // Округление денежных полей
        emp.transfer_amount = Math.round(emp.transfer_amount * 100) / 100;
        emp.cash_payout     = Math.round(emp.cash_payout * 100) / 100;
        emp.cash_return     = Math.round(emp.cash_return * 100) / 100;

        // ── Stage S (20.06.2026): paid-агрегаты + remaining ──────────────
        // Берём из paidMap, посчитанного батч-SELECT'ом выше (один запрос на весь
        // месяц по всем emp). cash_payout_remaining/transfer_remaining — сколько
        // ещё ОСТАЛОСЬ выплатить (использует фронт чтобы не показывать
        // «оплачено 100k из 100k» как «надо ещё 100k»).
        // Stage W (баг #7): СЗ-выплаты могут быть на payee (employee_id=payee).
        // Если у рабочего есть se_payee_id — суммируем paidMap[emp] + paidMap[payee],
        // НО только если payee НЕ в выборке (empById) — иначе payee получит свой
        // ряд и total_paid_* удвоится. Если payee есть в empById — он сам отразит
        // свои выплаты в своей строке, и в paid_* рабочего кладём только его emp-paid.
        const paid      = paidMap[emp.id] || null;
        const payeeInSelection = emp.se_payee_id && empById[emp.se_payee_id] ? true : false;
        const payeePaid = (emp.se_payee_id && !payeeInSelection)
          ? (paidMap[emp.se_payee_id] || null) : null;
        const sumPaidTS = (key) => Number(paid?.[key] || 0) + Number(payeePaid?.[key] || 0);
        const paidCash     = sumPaidTS('paid_cash');
        const paidTransfer = sumPaidTS('paid_transfer');
        emp.paid_cash     = Math.round(paidCash     * 100) / 100;
        emp.paid_transfer = Math.round(paidTransfer * 100) / 100;
        emp.paid_total    = Math.round((paidCash + paidTransfer) * 100) / 100;
        emp.paid_breakdown = {
          per_diem: Math.round(sumPaidTS('paid_per_diem') * 100) / 100,
          salary:   Math.round(sumPaidTS('paid_salary')   * 100) / 100,
          advance:  Math.round(sumPaidTS('paid_advance')  * 100) / 100,
          bonus:    Math.round(sumPaidTS('paid_bonus')    * 100) / 100
        };
        emp.cash_payout_remaining = Math.round(Math.max(0, Number(emp.cash_payout)     - paidCash)     * 100) / 100;
        emp.transfer_remaining    = Math.round(Math.max(0, Number(emp.transfer_amount) - paidTransfer) * 100) / 100;

        // INN — только для СЗ (для остальных уже NULL)
        if (!emp.is_self_employed) emp.inn = null;

        // Q3 (19.06.2026): payment_source_label — текстовая колонка «Получает».
        if (emp.pay_type === 'self_employed_payee') {
          emp.payment_source_label = emp.payee_fio ? `через ${emp.payee_fio}` : 'через получателя';
        } else if (emp.pay_type === 'self_employed') {
          emp.payment_source_label = 'сам';
        } else if (emp.pay_type === 'official') {
          emp.payment_source_label = 'оклад';
        } else {
          emp.payment_source_label = 'наличка';
        }

        // Чистим служебные поля
        delete emp._earned_full;
        delete emp._se_yearly_used_initial;
        delete emp._se_monthly_used_initial;
      }

      const locks = await getActiveLocks(fastify, year, month);

      // BUG #6: контракт ждёт data.columns с правилами проекции колонок —
      // фронты (vanilla + desktop-v2 + mobile-app) могут на это опираться.
      const columns = {
        points:  mode === 'pm' ? 'mine' : (mode === 'global' ? 'always' : 'none'),
        amount:  mode === 'global' ? 'show' : 'none',
        perDiem: mode === 'pm' ? 'show' : 'none'
      };

      // ── summary (ТОЛЬКО для global) ───────────────────────────────────
      let summary = null;
      if (mode === 'global') {
        const empArr = employees.map(e => empById[e.id]);
        // company-wide month_used / year_used — отдельные SELECT'ы (не зависят
        // от seEmpIds, чтобы считать «по всем СЗ компании, не только в видимом списке»).
        let monthUsedCompany = 0;
        let yearUsedCompany  = 0;
        try {
          const { rows: cm } = await db.query(`
            SELECT COALESCE(SUM(transfer_amount), 0)::numeric AS total
              FROM se_transfers
             WHERE year = $1 AND month = $2 AND status != 'cancelled'
          `, [year, month]);
          monthUsedCompany = Number(cm[0]?.total) || 0;
        } catch (_) {}
        try {
          const { rows: cy } = await db.query(`
            SELECT COALESCE(SUM(transfer_amount), 0)::numeric AS total
              FROM se_transfers
             WHERE year = $1 AND status != 'cancelled'
          `, [year]);
          yearUsedCompany = Number(cy[0]?.total) || 0;
        } catch (_) {}

        const sum = (fn) => empArr.reduce((s, e) => s + Number(fn(e) || 0), 0);
        const r2 = (x) => Math.round(x * 100) / 100;

        // ── Stage U (20.06.2026): официальный блок (бух vs директор) ──
        // total_official_to_pay_by_buh — сумма deduct_official всех оф-сотрудников
        //   (что бух должен заплатить через банк в этом месяце).
        // total_official_paid_by_buh — что бух уже выплатил из worker_payments
        //   (type='salary' status IN ('paid','confirmed') за этот месяц).
        // total_official_remaining_by_buh — max(0, to_pay − paid).
        // SSoT с payroll-dashboard.js /summary, /cash-calc.
        const officialEmps = empArr.filter(e => e.is_officially_employed);
        const totalOfficialToPay = officialEmps.reduce((s, e) => s + Number(e.deduct_official || 0), 0);
        let totalOfficialPaid = 0;
        if (officialEmps.length > 0) {
          const { rows: bhPaid } = await db.query(`
            SELECT COALESCE(SUM(amount), 0)::numeric AS sum
            FROM worker_payments
            WHERE employee_id = ANY($1::int[])
              AND type = 'salary' AND status IN ('paid','confirmed')
              AND COALESCE(pay_year,  EXTRACT(YEAR  FROM created_at)::int) = $2
              AND COALESCE(pay_month, EXTRACT(MONTH FROM created_at)::int) = $3
          `, [officialEmps.map(e => e.id), year, month]);
          totalOfficialPaid = Number(bhPaid[0]?.sum || 0);
        }

        summary = {
          year, month,
          employees_count: empArr.length,
          days_total: empArr.reduce((s, e) => s + Object.keys(e.days || {}).length, 0),
          by_type: {
            // V240: self_employed_payee (рабочий через получателя) сливаем
            // с обычным self_employed для совместимости со старыми фронтами.
            self_employed: empArr.filter(e => e.pay_type === 'self_employed' || e.pay_type === 'self_employed_payee').length,
            official:      empArr.filter(e => e.pay_type === 'official').length,
            cash:          empArr.filter(e => e.pay_type === 'cash').length
          },
          total_earned:      r2(sum(e => e.earned)),
          total_bonus:       r2(sum(e => e.bonus)),
          total_penalty:     r2(sum(e => e.penalty)),
          total_transfer:    r2(sum(e => e.transfer_amount)),
          total_cash_payout: r2(sum(e => e.cash_payout)),
          total_cash_return: r2(sum(e => e.cash_return)),
          // net_cash = total_cash_return - total_cash_payout
          //   отрицательное = доплатили из кассы; положительное = собрали в кассу
          net_cash: r2(sum(e => Number(e.cash_return || 0) - Number(e.cash_payout || 0))),
          // ── Stage S (20.06.2026): сумма УЖЕ ВЫПЛАЧЕННОГО в поле ──
          // Источник: worker_payments status IN ('paid','confirmed'),
          // type IN ('per_diem','salary','advance','bonus') за месяц.
          //   total_paid_cash     — нал (РП в поле выдал/auto-ФОТ-триггер cash)
          //   total_paid_transfer — переводы + auto + NULL (бэк-совместимость)
          //   total_paid_total    — = paid_cash + paid_transfer
          //   *_remaining         — сколько ОСТАЛОСЬ выплатить (с clamp >= 0)
          // Фронт показывает блок «УЖЕ ВЫПЛАЧЕНО В ПОЛЕ» только если total_paid_total > 0.
          total_paid_cash:              r2(sum(e => e.paid_cash)),
          total_paid_transfer:          r2(sum(e => e.paid_transfer)),
          total_paid_total:             r2(sum(e => e.paid_total)),
          total_cash_needed_remaining:  r2(Math.max(0, sum(e => e.cash_payout)     - sum(e => e.paid_cash))),
          total_transfer_remaining:     r2(Math.max(0, sum(e => e.transfer_amount) - sum(e => e.paid_transfer))),
          // ── Stage U (20.06.2026): официально устроены (бух vs директор) ──
          total_official_count:            officialEmps.length,
          total_official_to_pay_by_buh:    r2(totalOfficialToPay),
          total_official_paid_by_buh:      r2(totalOfficialPaid),
          total_official_remaining_by_buh: r2(Math.max(0, totalOfficialToPay - totalOfficialPaid)),
          limits: {
            monthly: monthlyLimit,
            yearly:  yearlyLimit,
            month_used_company: r2(monthUsedCompany),
            year_used_company:  r2(yearUsedCompany),
            // Q1 (19.06.2026): суммарный остаток лимитов по ВСЕМ СЗ из выборки.
            // Для UI «Доступно X из Y» вместо просто потолка одного СЗ.
            // se_count — количество СЗ, total_monthly_capacity = N_СЗ × 350k.
            se_count: empArr.filter(e => e.pay_type === 'self_employed' || e.pay_type === 'self_employed_payee').length,
            total_monthly_capacity: empArr.filter(e => e.pay_type === 'self_employed' || e.pay_type === 'self_employed_payee').length * monthlyLimit,
            total_yearly_capacity:  empArr.filter(e => e.pay_type === 'self_employed' || e.pay_type === 'self_employed_payee').length * yearlyLimit,
            month_remaining_company: r2(sum(e => (e.pay_type === 'self_employed' || e.pay_type === 'self_employed_payee') ? Number(e.monthly_remaining || 0) : 0)),
            year_remaining_company:  r2(sum(e => (e.pay_type === 'self_employed' || e.pay_type === 'self_employed_payee') ? Number(e.yearly_remaining || 0) : 0))
          }
        };
      }

      return {
        year, month, days_in_month: dim, mode,
        viewer: { id: viewer.id, role: viewer.role, fio: viewer.name || viewer.full_name || viewer.fio || '' },
        employees: employees.map(e => empById[e.id]),
        locks,
        settings,
        columns,
        summary
      };
    } catch (err) {
      fastify.log.error('[timesheet-v2] GET error: ' + (err && err.message));
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ────────────────────────────────────────────────────────────────
  // PUT /api/timesheet/v2/entry
  // ────────────────────────────────────────────────────────────────
  fastify.put('/entry', viewAuth, async (request, reply) => {
    try {
      const viewer = request.user || {};
      const mode = modeOfRole(viewer.role);
      if (!mode) return reply.code(403).send({ error: 'role_not_supported' });

      const body = request.body || {};
      const employee_id = parseInt(body.employee_id, 10);
      const work_id = body.work_id != null ? parseInt(body.work_id, 10) : null;
      const date = body.date;
      const type = body.type;
      const shift = body.shift || null;
      const del = !!body.delete;

      if (!employee_id || !date || !type) {
        return reply.code(400).send({ error: 'employee_id, date, type обязательны' });
      }
      if (!typeAllowedForMode(mode, type)) {
        return reply.code(403).send({ error: `Тип "${type}" не разрешён для роли ${viewer.role}` });
      }

      // FIX #3: строгая валидация date. Раньше parseInt мог дать NaN/мусор и
      // упасть глубже на ::date кастe → 500. Также никто не валидировал
      // диапазон года/месяца/дня — рандом 2099-13-99 уходил в БД.
      const y = parseInt(date.slice(0, 4), 10);
      const m = parseInt(date.slice(5, 7), 10);
      const d = parseInt(date.slice(8, 10), 10);
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(date)) {
        return reply.code(400).send({ error: 'invalid date format (expected YYYY-MM-DD)' });
      }
      // FIX 10: year ограничен 2020 ≤ y ≤ текущий+1. Раньше было ≤2030 —
      // PM мог локнуть/писать 2099 без отлова.
      const _yMax = new Date().getFullYear() + 1;
      if (!Number.isFinite(y) || y < 2020 || y > _yMax) {
        return reply.code(400).send({ error: 'invalid year' });
      }
      if (!Number.isFinite(m) || m < 1 || m > 12) {
        return reply.code(400).send({ error: 'invalid month' });
      }
      if (!Number.isFinite(d) || d < 1 || d > 31) {
        return reply.code(400).send({ error: 'invalid day' });
      }

      try {
        await assertNotLocked(fastify, { id: viewer.id, role: viewer.role }, {
          year: y, month: m, scope_hint: mode, work_id, employee_id, date
        });
      } catch (lockErr) {
        if (lockErr && lockErr.code === 'period_locked') {
          return reply.code(423).send({ error: 'period_locked', lock: lockErr.lock || null });
        }
        throw lockErr;
      }

      // PM: проверка владения работой
      if (mode === 'pm') {
        if (!work_id) return reply.code(400).send({ error: 'work_id обязателен для PM-режима' });
        const { rows: wcheck } = await db.query(`SELECT id, pm_id FROM works WHERE id=$1`, [work_id]);
        if (!wcheck.length) return reply.code(404).send({ error: 'Работа не найдена' });
        if (Number(wcheck[0].pm_id) !== Number(viewer.id) && viewer.role !== 'HEAD_PM') {
          return reply.code(403).send({ error: 'Это не ваша работа' });
        }
      }

      // ── DELETE — мягкое удаление ────────────────────────────────
      if (del) {
        if (SHIFT_TYPES.has(type)) {
          // мягкое удаление чекина
          const { rows: ci } = await db.query(`
            SELECT id, entered_by_user_id, work_id FROM field_checkins
            WHERE employee_id=$1 AND date=$2::date AND status='completed'
            ${work_id ? 'AND work_id=$3' : ''}
            LIMIT 1
          `, work_id ? [employee_id, date, work_id] : [employee_id, date]);
          if (!ci.length) return reply.code(404).send({ error: 'Чекин не найден' });
          // FIX 4: PM IDOR через NULL entered_by_user_id.
          // Раньше `&& ci[0].entered_by_user_id && ...` short-circuit'ил при NULL → PM удалял чужие.
          // Правильно по ТЗ: PM правит/удаляет всё на СВОЕЙ работе (work.pm_id == viewer.id).
          // Этот check уже выполнен выше (mode==='pm' → wcheck pm_id==viewer.id).
          // Доп. ограничение по entered_by_user_id убрано — РП хозяин записей на своей работе.
          await db.query(`UPDATE field_checkins SET status='cancelled', updated_at=NOW() WHERE id=$1`, [ci[0].id]);
          return { ok: true, deleted: true, kind: 'checkin' };
        }
        // stage
        // FIX 5: DELETE stage не фильтровал по work_id — на одной дате этап
        // на work#2 мог быть удалён операцией для work#1. Добавляем фильтр.
        // Если в payload work_id не передан — оставляем «любая работа», т.к. рабочему
        // на дату должно быть только одно из (waiting/medical/travel/warehouse),
        // но дозволяем явный work_id из тела.
        const stParams = work_id
          ? [employee_id, type, date, work_id]
          : [employee_id, type, date];
        const { rows: st } = await db.query(`
          SELECT id, entered_by_user_id, work_id FROM field_trip_stages
          WHERE employee_id=$1 AND stage_type=$2 AND date_from <= $3::date
            AND COALESCE(date_to, date_from) >= $3::date
            AND COALESCE(status,'active') NOT IN ('rejected','cancelled')
            ${work_id ? 'AND work_id=$4' : ''}
          LIMIT 1
        `, stParams);
        if (!st.length) return reply.code(404).send({ error: 'Отметка не найдена' });
        // FIX 4: убран NULL-bypass — PM удаляет всё на своей работе (RBAC выше).
        await db.query(`UPDATE field_trip_stages SET status='cancelled', updated_at=NOW() WHERE id=$1`, [st[0].id]);
        return { ok: true, deleted: true, kind: 'stage' };
      }

      // ── INSERT/UPDATE ───────────────────────────────────────────
      // Один день = одна отметка
      // FIX 6: dupCi/dupSt теперь фильтруют по work_id (если он передан).
      // Без фильтра: если рабочий 12.06 у Андросова work#1 day-shift, а Сидоров
      // ставит ему day-shift 12.06 у work#2 — dupCi возвращал чекин work#1,
      // → Сидоров ловил «уже есть смена» хотя её на его работе нет.
      // UNIQUE-индекс (employee_id, date, work_id) и так разрешает 2 разные работы.
      const dupCiParams = work_id ? [employee_id, date, work_id] : [employee_id, date];
      const { rows: dupCi } = await db.query(`
        SELECT id, entered_by_user_id, work_id FROM field_checkins
        WHERE employee_id=$1 AND date=$2::date AND status='completed'
          ${work_id ? 'AND work_id=$3' : ''}
        LIMIT 1
      `, dupCiParams);
      const dupStParams = work_id ? [employee_id, date, work_id] : [employee_id, date];
      const { rows: dupSt } = await db.query(`
        SELECT id, entered_by_user_id, stage_type, work_id FROM field_trip_stages
        WHERE employee_id=$1
          AND date_from <= $2::date
          AND COALESCE(date_to, date_from) >= $2::date
          AND COALESCE(status,'active') NOT IN ('rejected','cancelled')
          ${work_id ? 'AND work_id=$3' : ''}
        LIMIT 1
      `, dupStParams);

      // FIX 4: PM IDOR через NULL entered_by_user_id.
      // Раньше: `&& dupCi[0].entered_by_user_id && ...` short-circuit'ил на NULL.
      // По ТЗ: PM правит ВСЁ на СВОЕЙ работе (work.pm_id == viewer.id) — это уже
      // проверено выше через wcheck. Доп. ограничение «только то что сам ввёл» убрано:
      // если в записи NULL автор (legacy/self-checkin рабочего) — PM всё равно может править.

      // Settings & employees
      const settings = await loadSettings(db);
      const { rows: empRow } = await db.query(`SELECT role_tag FROM employees WHERE id=$1`, [employee_id]);
      if (!empRow.length) return reply.code(404).send({ error: 'Сотрудник не найден' });
      const position = (empRow[0].role_tag || '').toLowerCase();

      // ── day/night → field_checkins ──────────────────────────────
      if (SHIFT_TYPES.has(type)) {
        if (!work_id) return reply.code(400).send({ error: 'work_id обязателен для day/night' });
        // Найти assignment
        const { rows: assign } = await db.query(`
          SELECT id FROM employee_assignments
          WHERE employee_id=$1 AND work_id=$2
          ORDER BY is_active DESC, id DESC LIMIT 1
        `, [employee_id, work_id]);
        if (!assign.length) return reply.code(400).send({ error: 'Нет назначения на работу' });

        // Запретить дубль stage на эту дату
        if (dupSt.length && !dupCi.length) {
          return reply.code(409).send({ error: 'На эту дату уже есть этап (' + dupSt[0].stage_type + ')' });
        }

        const dayRate = Number(body.amount) || Number(body.day_rate) || 0;
        const amountEarned = Number(body.amount) || Number(body.amount_earned) || dayRate;
        const hoursWorked = Number(body.hours) || 11;

        if (dupCi.length) {
          // UPDATE
          const { rows: upd } = await db.query(`
            UPDATE field_checkins SET
              shift = $2,
              day_rate = $3,
              amount_earned = $4,
              hours_worked = COALESCE($5, hours_worked),
              entered_by_user_id = $6,
              updated_at = NOW()
            WHERE id = $1
            RETURNING id, employee_id, work_id, date, shift, amount_earned, day_rate
          `, [dupCi[0].id, type, dayRate, amountEarned, hoursWorked, viewer.id]);
          return { ok: true, updated: true, kind: 'checkin', entry: upd[0] };
        }

        const { rows: ins } = await db.query(`
          INSERT INTO field_checkins
            (employee_id, work_id, assignment_id, date, shift, status,
             checkin_at, hours_worked, hours_paid, day_rate, amount_earned,
             checkin_source, checkin_by, entered_by_user_id)
          VALUES ($1, $2, $3, $4::date, $5, 'completed',
                  ($4::date + TIME '08:00')::timestamptz, $6, $6, $7, $8,
                  'pm_manual', $9, $9)
          RETURNING id, employee_id, work_id, date, shift, amount_earned, day_rate
        `, [employee_id, work_id, assign[0].id, date, type,
            hoursWorked, dayRate, amountEarned, viewer.id]);
        return reply.code(201).send({ ok: true, created: true, kind: 'checkin', entry: ins[0] });
      }

      // ── warehouse/medical/travel/waiting → field_trip_stages ────
      // запрет дубля чекина
      if (dupCi.length) {
        return reply.code(409).send({ error: 'На эту дату уже есть смена (day/night)' });
      }
      // существующий stage на эту дату того же типа — UPDATE; другого типа — 409
      if (dupSt.length) {
        if (dupSt[0].stage_type !== type) {
          return reply.code(409).send({ error: 'На эту дату уже есть этап (' + dupSt[0].stage_type + ')' });
        }
        await db.query(`
          UPDATE field_trip_stages SET
            entered_by_user_id = $2,
            updated_at = NOW()
          WHERE id = $1
        `, [dupSt[0].id, viewer.id]);
        return { ok: true, updated: true, kind: 'stage', stage_id: dupSt[0].id };
      }

      const pts = pointsFor(settings, type, position);
      // Для warehouse/medical/travel work_id опционален
      const ratePerDay = type === 'waiting' ? 0 : 0; // сумма не считается на этом уровне, придёт из тарифа

      const { rows: ins2 } = await db.query(`
        INSERT INTO field_trip_stages
          (employee_id, work_id, stage_type, date_from, date_to, days_count,
           tariff_points, rate_per_day, amount_earned, status, created_by, entered_by_user_id, source)
        VALUES ($1, $2, $3, $4::date, $4::date, 1, $5, $6, $7, 'active', $8, $8, 'manual')
        RETURNING id, employee_id, work_id, stage_type, date_from, tariff_points
      `, [employee_id, work_id, type, date, pts, ratePerDay, 0, viewer.id]);
      return reply.code(201).send({ ok: true, created: true, kind: 'stage', entry: ins2[0] });
    } catch (err) {
      fastify.log.error('[timesheet-v2] PUT /entry error: ' + (err && err.message));
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ────────────────────────────────────────────────────────────────
  // GET /api/timesheet/v2/locks/:year/:month
  // (DEPRECATED: оставлен как backwards-compat alias под старый массив-формат.
  //  Новые фронты дёргают /closure-status/:y/:m с полной структурой.)
  // ────────────────────────────────────────────────────────────────
  fastify.get('/locks/:year/:month', viewAuth, async (request, reply) => {
    const year = parseInt(request.params.year, 10);
    const month = parseInt(request.params.month, 10);
    // FIX 10: год ограничен 2020..currentYear+1
    const _yMaxLocks = new Date().getFullYear() + 1;
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12 || year < 2020 || year > _yMaxLocks) {
      return reply.code(400).send({ error: 'Bad year/month' });
    }
    const locks = await getActiveLocks(fastify, year, month);
    return { locks };
  });

  // ────────────────────────────────────────────────────────────────
  // GET /api/timesheet/v2/closure-status/:year/:month
  // FIX #1 (Coverage #24): полный «директорский» список — ВСЕ РП компании со
  // статусом «закрыл / не закрыл» месяц + статусы 4 scope-локов
  // (warehouse/medical/travel/global). Структура:
  //   {
  //     year, month,
  //     pm_locks: [{ user_id, fio, locked: bool, locked_at, lock_id }, ...],
  //     scope_locks: {
  //       warehouse: { locked, locked_by_fio, locked_at, lock_id },
  //       medical:   { ... },
  //       travel:    { ... },
  //       global:    { ... }
  //     }
  //   }
  // Реализация: 2 SQL-запроса (О(1) round-trips, без N+1):
  //   1) ВСЕ РП компании LEFT JOIN с активными pm-локами этого месяца.
  //   2) Все активные scope-локи (warehouse/medical/travel/global) одним запросом.
  // ────────────────────────────────────────────────────────────────
  fastify.get('/closure-status/:year/:month', viewAuth, async (request, reply) => {
    try {
      const year = parseInt(request.params.year, 10);
      const month = parseInt(request.params.month, 10);
      if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
        return reply.code(400).send({ error: 'Bad year/month' });
      }

      const hasLocks = await tableExists(db, 'payroll_period_locks');

      // 1) ВСЕ РП компании + статус закрытия их персонального месяца
      // LEFT JOIN ловит активный лок ИЛИ NULL (РП ещё не закрыл).
      const pmLockJoin = hasLocks
        ? `LEFT JOIN payroll_period_locks l
             ON l.scope = 'pm'
            AND l.scope_user_id = u.id
            AND l.year = $1 AND l.month = $2
            AND l.unlocked_at IS NULL`
        : '';
      const pmLockCols = hasLocks
        ? 'l.id AS lock_id, l.locked_at'
        : 'NULL::int AS lock_id, NULL::timestamptz AS locked_at';

      const { rows: pmRows } = await db.query(`
        SELECT u.id AS user_id, u.name AS fio, u.role,
               ${pmLockCols}
          FROM users u
          ${pmLockJoin}
         WHERE u.role IN ('PM','HEAD_PM')
           AND COALESCE(u.is_active, true) = true
         ORDER BY u.name ASC NULLS LAST
      `, hasLocks ? [year, month] : []);

      const pm_locks = pmRows.map(r => ({
        user_id: r.user_id,
        fio: r.fio || '—',
        role: r.role,
        locked: !!r.lock_id,
        locked_at: r.locked_at || null,
        lock_id: r.lock_id || null
      }));

      // 2) Scope-локи (warehouse/medical/travel/global) — один SELECT
      const scope_locks = {
        warehouse: { locked: false, locked_by_fio: null, locked_at: null, lock_id: null },
        medical:   { locked: false, locked_by_fio: null, locked_at: null, lock_id: null },
        travel:    { locked: false, locked_by_fio: null, locked_at: null, lock_id: null },
        global:    { locked: false, locked_by_fio: null, locked_at: null, lock_id: null }
      };

      if (hasLocks) {
        const { rows: scopeRows } = await db.query(`
          SELECT l.id AS lock_id, l.scope, l.locked_at, l.locked_by,
                 u.name AS locked_by_fio, u.role AS locked_by_role
            FROM payroll_period_locks l
            LEFT JOIN users u ON u.id = l.locked_by
           WHERE l.year = $1 AND l.month = $2
             AND l.unlocked_at IS NULL
             AND l.scope IN ('warehouse','medical','travel','global')
             AND l.scope_user_id IS NULL
           ORDER BY l.scope, l.locked_at DESC
        `, [year, month]);
        // первый встреченный по scope — самый свежий (ORDER BY locked_at DESC).
        for (const r of scopeRows) {
          if (!scope_locks[r.scope]) continue;
          if (scope_locks[r.scope].locked) continue; // уже взят первый
          scope_locks[r.scope] = {
            locked: true,
            locked_by_fio: r.locked_by_fio || null,
            locked_by_role: r.locked_by_role || null,
            locked_at: r.locked_at || null,
            lock_id: r.lock_id
          };
        }
      }

      return { year, month, pm_locks, scope_locks };
    } catch (err) {
      fastify.log.error('[timesheet-v2] GET /closure-status error: ' + (err && err.message));
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ────────────────────────────────────────────────────────────────
  // POST /api/timesheet/v2/lock
  // ────────────────────────────────────────────────────────────────
  fastify.post('/lock', viewAuth, async (request, reply) => {
    try {
      const viewer = request.user || {};
      const role = viewer.role;
      const body = request.body || {};
      const scope = body.scope;
      const year = parseInt(body.year, 10);
      const month = parseInt(body.month, 10);
      let scope_user_id = body.scope_user_id != null ? parseInt(body.scope_user_id, 10) : null;

      if (!['pm','warehouse','medical','travel','global'].includes(scope)) {
        return reply.code(400).send({ error: 'bad scope' });
      }
      // FIX 10: год ограничен 2020..currentYear+1. Раньше PM мог локнуть 2099.
      const _yMaxLock = new Date().getFullYear() + 1;
      if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12 || year < 2020 || year > _yMaxLock) {
        return reply.code(400).send({ error: 'Bad year/month' });
      }

      const allowed = (
        (scope === 'pm' && PM_ROLES.includes(role)) ||
        (scope === 'warehouse' && WAREHOUSE_ROLES.includes(role)) ||
        (scope === 'medical' && MEDICAL_ROLES.includes(role)) ||
        (scope === 'travel' && TRAVEL_ROLES.includes(role)) ||
        (scope === 'global' && GLOBAL_ROLES.includes(role))
      );
      if (!allowed) return reply.code(403).send({ error: 'Нельзя ставить лок такой области' });

      if (scope === 'pm') scope_user_id = viewer.id;
      else if (['warehouse','medical','travel','global'].includes(scope)) scope_user_id = null;

      if (!(await tableExists(db, 'payroll_period_locks'))) {
        return reply.code(503).send({ error: 'payroll_period_locks table not ready' });
      }

      // BUG #3: ON CONFLICT по partial unique index (WHERE unlocked_at IS NULL) в
      // Postgres требует точного совпадения WHERE-условия в INFER (риск 500).
      // Решение A: транзакция — SELECT … FOR UPDATE на активный лок, если есть → 409,
      // если нет → INSERT. Без миграции схемы.
      //
      // FIX #7: даже с SELECT FOR UPDATE остаётся теоретическая гонка двух
      // транзакций на одну новую строку (если оба прошли SELECT с .length==0
      // до того, как первый INSERT увидел блокировку — что возможно при
      // CONFLICT-индексе на (year,month,scope,COALESCE(scope_user_id,0))).
      // Постгрес тогда отдаёт 23505 (unique_violation). Ловим его → 409
      // + читаем актуальный активный лок и возвращаем как conflict.
      try {
        const result = await db.transaction(async (client) => {
          const { rows: existing } = await client.query(`
            SELECT id, year, month, scope, scope_user_id, locked_at, locked_by
              FROM payroll_period_locks
             WHERE year = $1 AND month = $2 AND scope = $3
               AND COALESCE(scope_user_id, 0) = COALESCE($4, 0)
               AND unlocked_at IS NULL
             FOR UPDATE
             LIMIT 1
          `, [year, month, scope, scope_user_id]);
          if (existing.length) {
            return { conflict: true, lock: existing[0] };
          }
          const { rows } = await client.query(`
            INSERT INTO payroll_period_locks (year, month, scope, scope_user_id, locked_at, locked_by)
            VALUES ($1, $2, $3, $4, NOW(), $5)
            RETURNING id, year, month, scope, scope_user_id, locked_at, locked_by
          `, [year, month, scope, scope_user_id, viewer.id]);
          return { conflict: false, lock: rows[0] };
        });
        if (result.conflict) {
          return reply.code(409).send({ error: 'lock_already_active', lock: result.lock });
        }
        return reply.code(201).send({ ok: true, lock: result.lock });
      } catch (txErr) {
        // FIX #7: parallel INSERT — UNIQUE constraint сработал → читаем активный лок.
        if (txErr && txErr.code === '23505') {
          try {
            const { rows } = await db.query(`
              SELECT id, year, month, scope, scope_user_id, locked_at, locked_by
                FROM payroll_period_locks
               WHERE year = $1 AND month = $2 AND scope = $3
                 AND COALESCE(scope_user_id, 0) = COALESCE($4, 0)
                 AND unlocked_at IS NULL
               ORDER BY locked_at DESC
               LIMIT 1
            `, [year, month, scope, scope_user_id]);
            return reply.code(409).send({
              error: 'lock_already_active',
              lock: rows[0] || null
            });
          } catch (readErr) {
            fastify.log.error('[timesheet-v2] POST /lock 23505-read error: ' + (readErr && readErr.message));
            return reply.code(409).send({ error: 'lock_already_active', lock: null });
          }
        }
        fastify.log.error('[timesheet-v2] POST /lock tx error: ' + (txErr && txErr.message));
        throw txErr;
      }
    } catch (err) {
      fastify.log.error('[timesheet-v2] POST /lock error: ' + (err && err.message));
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ────────────────────────────────────────────────────────────────
  // DELETE /api/timesheet/v2/lock/:lockId
  // ────────────────────────────────────────────────────────────────
  fastify.delete('/lock/:lockId', viewAuth, async (request, reply) => {
    try {
      const viewer = request.user || {};
      const lockId = parseInt(request.params.lockId, 10);
      if (!Number.isFinite(lockId)) return reply.code(400).send({ error: 'bad lockId' });
      if (!(await tableExists(db, 'payroll_period_locks'))) {
        return reply.code(404).send({ error: 'not found' });
      }
      const { rows } = await db.query(`SELECT * FROM payroll_period_locks WHERE id=$1`, [lockId]);
      if (!rows.length) return reply.code(404).send({ error: 'lock not found' });
      const lock = rows[0];
      if (lock.unlocked_at) return reply.code(409).send({ error: 'lock already removed' });

      const isAdmin = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(viewer.role);
      const isOwner = Number(lock.locked_by) === Number(viewer.id);
      if (!isAdmin && !isOwner) {
        return reply.code(403).send({ error: 'Нет прав снимать чужой лок' });
      }
      await db.query(
        `UPDATE payroll_period_locks SET unlocked_at = NOW(), unlocked_by = $2 WHERE id=$1`,
        [lockId, viewer.id]
      );
      return { ok: true };
    } catch (err) {
      fastify.log.error('[timesheet-v2] DELETE /lock error: ' + (err && err.message));
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ────────────────────────────────────────────────────────────────
  // GET /api/timesheet/v2/settings/position-points
  // ────────────────────────────────────────────────────────────────
  fastify.get('/settings/position-points', viewAuth, async (request, reply) => {
    try {
      const settings = await loadSettings(db);
      const viewer = request.user || {};
      // FIX #6: per_diem_default не должен утекать рядовым ролям (PM, WAREHOUSE,
      // TO, OFFICE_MANAGER). Видят только GLOBAL_ROLES (ADMIN/DIRECTOR_*/BUH/HR/HR_MANAGER).
      const response = { position_points: settings.position_points };
      if (GLOBAL_ROLES.includes(viewer.role)) {
        response.per_diem_default = settings.per_diem_default;
      }
      return response;
    } catch (err) {
      fastify.log.error('[timesheet-v2] GET settings error: ' + (err && err.message));
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ────────────────────────────────────────────────────────────────
  // PUT /api/timesheet/v2/settings/position-points
  // ────────────────────────────────────────────────────────────────
  fastify.put('/settings/position-points', settingsWriteAuth, async (request, reply) => {
    try {
      const body = request.body || {};
      const type = body.type;
      const position = body.position || null;
      const points = parseInt(body.points, 10);
      if (!['warehouse','medical','travel'].includes(type)) {
        return reply.code(400).send({ error: 'bad type' });
      }
      if (!Number.isFinite(points) || points < 0) {
        return reply.code(400).send({ error: 'bad points' });
      }
      if (!(await tableExists(db, 'position_points'))) {
        return reply.code(503).send({ error: 'position_points table not ready' });
      }
      // FIX #4: V231 завёл UNIQUE INDEX на (type, (COALESCE(position, ''))) — это
      // expression-индекс. ON CONFLICT по выражению в Postgres работает только
      // когда INFER-spec ИДЕНТИЧЕН индексу (вкл. скобки/каст). Чтобы не зависеть
      // от точного синтаксиса — делаем явный upsert в транзакции (SELECT-then-
      // UPDATE-или-INSERT). Семантика «один setting на (type,position)» сохранена.
      const viewer = request.user || {};
      const result = await db.transaction(async (client) => {
        const sel = await client.query(`
          SELECT id FROM position_points
           WHERE type = $1 AND COALESCE(position, '') = COALESCE($2, '')
           FOR UPDATE
           LIMIT 1
        `, [type, position]);
        if (sel.rows.length) {
          const upd = await client.query(`
            UPDATE position_points
               SET points = $2, updated_by = $3, updated_at = NOW()
             WHERE id = $1
             RETURNING type, position, points
          `, [sel.rows[0].id, points, viewer.id]);
          return upd.rows[0];
        }
        const ins = await client.query(`
          INSERT INTO position_points (type, position, points, updated_by, updated_at)
          VALUES ($1, $2, $3, $4, NOW())
          RETURNING type, position, points
        `, [type, position, points, viewer.id]);
        return ins.rows[0];
      });
      return { ok: true, row: result };
    } catch (err) {
      fastify.log.error('[timesheet-v2] PUT settings error: ' + (err && err.message));
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ────────────────────────────────────────────────────────────────
  // GET /api/timesheet/v2/:year/:month/export?format=xlsx
  // PHASE 1A: 2 листа («📊 Сводка» + «📋 Табель» с 7 финансовыми колонками).
  // ────────────────────────────────────────────────────────────────
  fastify.get('/:year/:month/export', {
    preHandler: [
      async (request) => {
        if (!request.headers.authorization && request.query && request.query.token) {
          request.headers.authorization = 'Bearer ' + request.query.token;
        }
      },
      fastify.requireRoles(GLOBAL_ROLES)
    ]
  }, async (request, reply) => {
    try {
      const ExcelJS = require('exceljs');
      const year = parseInt(request.params.year, 10);
      const month = parseInt(request.params.month, 10);
      if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
        return reply.code(400).send({ error: 'Bad year/month' });
      }

      // Реюз бизнес-логики через inject (mode=global → summary заполняется)
      const proxy = await fastify.inject({
        method: 'GET',
        url: `/api/timesheet/v2/${year}/${month}?mode=global`,
        headers: request.headers
      });
      if (proxy.statusCode !== 200) {
        return reply.code(proxy.statusCode).send(proxy.body);
      }
      const data = JSON.parse(proxy.body);
      const employees = data.employees || [];
      const dim = data.days_in_month || daysInMonth(year, month);
      const summary = data.summary || null;

      const monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
      const mName = monthNames[month - 1] || '';

      const wb = new ExcelJS.Workbook();
      wb.creator = 'АСГАРД CRM';
      wb.created = new Date();

      // ───── Палитра/стили (общие) ─────
      const FILL_GOLD       = 'FFFFF4D6';   // золотой фон шапок/мерджей
      const FONT_GOLD_DARK  = 'FF7A5C00';   // тёмно-золотой текст шапок
      const FILL_TOTAL      = 'FFFFE9B0';   // фон ИТОГО
      const FILL_ZEBRA      = 'FFFAFAFA';   // зебра (чётные строки)
      const BORDER_GREY     = 'FFBDBDBD';   // тонкая граница
      const FILL_SZ         = 'FFE0F2F1';   // тип СЗ
      const FILL_OF         = 'FFF1F8E9';   // тип Оф
      const FILL_CASH       = 'FFF5F5F5';   // тип Нал
      const FILL_LIMIT_OK   = 'FFC8E6C9';   // зелёный фон лимита (запас >2× месячного)
      const FILL_LIMIT_LOW  = 'FFFFCDD2';   // бледно-красный (запас мало)
      const thin = { style: 'thin', color: { argb: BORDER_GREY } };
      const borderAll = { top: thin, left: thin, bottom: thin, right: thin };

      const goldFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_GOLD } };
      const totalFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_TOTAL } };
      const zebraFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_ZEBRA } };

      // Цифры: округление до целых, формат «1 234 567 ₽»
      const RUB_FMT = '#,##0" ₽";[Red]-#,##0" ₽"';
      const r0 = (x) => (x == null || !Number.isFinite(Number(x))) ? 0 : Math.round(Number(x));

      // ════════════════════════════════════════════════════════════════
      // ЛИСТ 1: 📊 Сводка (первый, виден при открытии)
      // ════════════════════════════════════════════════════════════════
      const wsSum = wb.addWorksheet('📊 Сводка');
      wsSum.getColumn(1).width = 28;
      wsSum.getColumn(2).width = 16;
      wsSum.getColumn(3).width = 4;
      wsSum.getColumn(4).width = 24;
      wsSum.getColumn(5).width = 16;
      wsSum.getColumn(6).width = 4;
      wsSum.getColumn(7).width = 14;

      // A1:G1 — заголовок «ТАБЕЛЬ — Июнь 2026»
      wsSum.mergeCells('A1:G1');
      const sumTitle = wsSum.getCell('A1');
      sumTitle.value = `ТАБЕЛЬ — ${mName} ${year}`;
      sumTitle.font = { bold: true, size: 14, color: { argb: FONT_GOLD_DARK } };
      sumTitle.alignment = { horizontal: 'center', vertical: 'middle' };
      sumTitle.fill = goldFill;
      wsSum.getRow(1).height = 26;

      // Лимиты компании из summary (если нет — дефолты)
      const s = summary || {
        year, month,
        employees_count: 0, days_total: 0,
        by_type: { self_employed: 0, official: 0, cash: 0 },
        total_earned: 0, total_transfer: 0, total_cash_payout: 0, total_cash_return: 0,
        net_cash: 0,
        // Stage S: дефолты для paid-агрегатов чтобы Excel не падал на summary=null
        total_paid_cash: 0, total_paid_transfer: 0, total_paid_total: 0,
        total_cash_needed_remaining: 0, total_transfer_remaining: 0,
        limits: { monthly: 350000, yearly: 2400000, month_used_company: 0, year_used_company: 0 }
      };

      // Строки 3–4: сотрудники + типы
      wsSum.getCell('A3').value = 'Сотрудников:';
      wsSum.getCell('A3').font = { bold: true };
      wsSum.getCell('B3').value = Number(s.employees_count || 0);
      wsSum.getCell('D3').value = 'Чел-дней:';
      wsSum.getCell('D3').font = { bold: true };
      wsSum.getCell('E3').value = Number(s.days_total || 0);

      wsSum.getCell('A4').value = 'Самозанятых:';
      wsSum.getCell('A4').font = { bold: true };
      wsSum.getCell('B4').value = Number(s.by_type?.self_employed || 0);
      wsSum.getCell('D4').value = 'Официальных:';
      wsSum.getCell('D4').font = { bold: true };
      wsSum.getCell('E4').value = Number(s.by_type?.official || 0);
      wsSum.getCell('G4').value = 'Наличка:';
      wsSum.getCell('G4').font = { bold: true };
      // отдельная колонка под цифру наличников
      wsSum.getColumn(8).width = 8;
      wsSum.getCell('H4').value = Number(s.by_type?.cash || 0);

      // A6:G6 — «ВЫПЛАТЫ» merge, золото
      wsSum.mergeCells('A6:G6');
      const wHdr = wsSum.getCell('A6');
      wHdr.value = 'ВЫПЛАТЫ';
      wHdr.font = { bold: true, color: { argb: FONT_GOLD_DARK } };
      wHdr.alignment = { horizontal: 'center', vertical: 'middle' };
      wHdr.fill = goldFill;

      // PHASE 1B+ премии/штрафы: 2 строки после «Заработано всего».
      // Если total_bonus=0 и total_penalty=0 — всё равно выводим (нулём),
      // чтобы порядок и шаблон были стабильны для парсеров.
      // Stage S (20.06.2026): добавлены 3 строки «Выплачено в поле» — нал,
      // переводом, всего. Оранжевый фон (#FFF3E0) — синхронно с колонкой в Табеле.
      const payRows = [
        ['Заработано всего:',         Number(s.total_earned      || 0)],
        ['Премии (всего):',           Number(s.total_bonus       || 0)],
        ['Штрафы (всего):',           Number(s.total_penalty     || 0)],
        ['📤 Выплачено в поле нал:',  Number(s.total_paid_cash     || 0)],
        ['📤 Выплачено переводом:',   Number(s.total_paid_transfer || 0)],
        ['📤 Выплачено всего:',       Number(s.total_paid_total    || 0)],
        ['К переводу на карту:',      Number(s.total_transfer    || 0)],
        ['Из кассы (добор):',         Number(s.total_cash_payout || 0)],
        ['Возврат в кассу от СЗ:',    Number(s.total_cash_return || 0)],
        ['Баланс кассы:',             Number(s.net_cash          || 0)]
      ];
      payRows.forEach(([label, value], idx) => {
        const rowN = 7 + idx;
        const c1 = wsSum.getCell(`A${rowN}`);
        const c2 = wsSum.getCell(`B${rowN}`);
        c1.value = label;
        c2.value = r0(value);
        c2.numFmt = RUB_FMT;
        c2.alignment = { horizontal: 'right' };
        if (idx === payRows.length - 1) c1.font = { bold: true }; // баланс кассы жирным
        // Цветовая подкраска новых строк (премии — зелёный фон, штрафы — розовый,
        // выплачено-блок — нежно-оранжевый #FFF3E0).
        if (idx === 1) { // Премии
          const fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };
          c1.fill = fill; c2.fill = fill;
        } else if (idx === 2) { // Штрафы
          const fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEBEE' } };
          c1.fill = fill; c2.fill = fill;
        } else if (idx >= 3 && idx <= 5) { // Stage S: блок «Выплачено в поле»
          // Подсвечиваем только если есть что показывать (>0) — иначе оставляем без фона
          if (Number(value) > 0) {
            const fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3E0' } };
            c1.fill = fill; c2.fill = fill;
            // Жирная подпись на итоговой строке «Выплачено всего»
            if (idx === 5) c1.font = { bold: true, color: { argb: 'FFE65100' } };
          }
        }
      });

      // A18:G18 — «ЛИМИТЫ САМОЗАНЯТЫХ» (сдвинуто +5 из-за премий/штрафов+выплачено)
      wsSum.mergeCells('A18:G18');
      const limHdr = wsSum.getCell('A18');
      limHdr.value = 'ЛИМИТЫ САМОЗАНЯТЫХ';
      limHdr.font = { bold: true, color: { argb: FONT_GOLD_DARK } };
      limHdr.alignment = { horizontal: 'center', vertical: 'middle' };
      limHdr.fill = goldFill;

      const limRows = [
        ['Годовой лимит:',          Number(s.limits?.yearly             || 0)],
        ['Месячный лимит:',         Number(s.limits?.monthly            || 0)],
        ['Использовано в месяце:',  Number(s.limits?.month_used_company || 0)],
        ['Использовано за год:',    Number(s.limits?.year_used_company  || 0)]
      ];
      limRows.forEach(([label, value], idx) => {
        // Stage S: limRows сдвинуты с 16 на 19 (после блока «Выплачено в поле»).
        const rowN = 19 + idx;
        const c1 = wsSum.getCell(`A${rowN}`);
        const c2 = wsSum.getCell(`B${rowN}`);
        c1.value = label;
        c2.value = r0(value);
        c2.numFmt = RUB_FMT;
        c2.alignment = { horizontal: 'right' };
      });

      // Тонкие границы по всему блоку сводки (расширено с 19 до 22 под Stage S)
      for (let R = 3; R <= 22; R++) {
        for (let C = 1; C <= 8; C++) {
          const cell = wsSum.getRow(R).getCell(C);
          // не рисуем границы по пустым колонкам-промежуткам (3, 6)
          if (C === 3 || C === 6) continue;
          if (cell.value !== null && cell.value !== undefined && cell.value !== '') {
            cell.border = borderAll;
          }
        }
      }

      // ════════════════════════════════════════════════════════════════
      // ЛИСТ 2: 📋 Табель (расширенный, 7 новых колонок справа)
      // ════════════════════════════════════════════════════════════════
      const ws = wb.addWorksheet('📋 Табель');

      // FIX (история): в global per_diem_total всегда null. Бух не видит суточные.
      // Сейчас в export всегда mode=global → не рисуем колонку «Суточные».
      const exportMode = (data && data.mode) || 'global';
      const showPerDiem = exportMode !== 'global';
      // Q-3 (19.06.2026): Excel-колонки «Город» (между ФИО и Должностью) и
      // «Получает» (сразу после «Тип» в финансовом блоке).
      //   Левая часть: ФИО / Город / Должность / День1...Дd
      //     leadCols = 3 (было 2: ФИО + Должность)
      //   Хвост: Баллы + Сумма + (Суточные?)
      //          + 11 финансовых (Тип / Получает / Заработ / 📤 Выплачено / 🎁 Премия /
      //                           ⚠ Штраф / Оклад / Карта / Касса± / Лим.год / Лим.мес)
      // Stage S (20.06.2026): +1 колонка «📤 Выплачено ₽» между «Заработано» и
      // «🎁 Премия» — было 10 финансовых, стало 11.
      const leadCols = 3;
      const baseTrailing = showPerDiem ? 3 : 2;
      const trailingCols = baseTrailing + 11;
      const totalCols = leadCols + dim + trailingCols;

      // Заголовок «ТАБЕЛЬ — Месяц Год»
      ws.mergeCells(1, 1, 1, totalCols);
      const t = ws.getCell(1, 1);
      t.value = `ТАБЕЛЬ — ${mName} ${year}`;
      t.font = { bold: true, size: 14, color: { argb: FONT_GOLD_DARK } };
      t.alignment = { horizontal: 'center', vertical: 'middle' };
      t.fill = goldFill;
      ws.getRow(1).height = 24;

      const hdr = ws.getRow(3);
      hdr.getCell(1).value = 'ФИО';
      hdr.getCell(2).value = 'Город';        // Q-3 (новая)
      hdr.getCell(3).value = 'Должность';
      const DAY_NAMES = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
      for (let d = 1; d <= dim; d++) {
        const dt = new Date(year, month - 1, d);
        const c = hdr.getCell(leadCols + d);
        c.value = `${d}\n${DAY_NAMES[dt.getDay()]}`;
        c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      }
      // Существующие колонки (Баллы / Сумма / Суточные?)
      hdr.getCell(leadCols + dim + 1).value = 'Баллы';
      hdr.getCell(leadCols + dim + 2).value = 'Сумма ₽';
      if (showPerDiem) hdr.getCell(leadCols + dim + 3).value = 'Суточные ₽';

      // Финансовые колонки (после baseTrailing). 11 хвостовых.
      //   «Получает» (Q-3) добавлена СРАЗУ после «Тип».
      //   Stage S (20.06.2026): «📤 Выплачено ₽» добавлена МЕЖДУ «Заработано»
      //   и «🎁 Премия». Цель — бухгалтер видит сколько УЖЕ выплачено в поле
      //   (per_diem/salary/advance/bonus из worker_payments status=paid|confirmed).
      //   Премия/Штраф остаются между «Выплачено» и «Оклад».
      const T_BASE = leadCols + dim + baseTrailing;
      const T = {
        type:        T_BASE + 1,
        payerLabel:  T_BASE + 2,   // Q-3: «Получает»
        earned:      T_BASE + 3,
        paid:        T_BASE + 4,   // Stage S: «📤 Выплачено ₽»
        bonus:       T_BASE + 5,
        penalty:     T_BASE + 6,
        salary:      T_BASE + 7,
        toCard:      T_BASE + 8,
        cashDelta:   T_BASE + 9,
        limYearRem:  T_BASE + 10,
        limMonthRem: T_BASE + 11
      };
      hdr.getCell(T.type).value        = 'Тип';
      hdr.getCell(T.payerLabel).value  = 'Получает';
      hdr.getCell(T.earned).value      = 'Заработано ₽';
      hdr.getCell(T.paid).value        = '📤 Выплачено ₽';
      hdr.getCell(T.bonus).value       = '🎁 Премия ₽';
      hdr.getCell(T.penalty).value     = '⚠ Штраф ₽';
      hdr.getCell(T.salary).value      = 'Оклад ₽';
      hdr.getCell(T.toCard).value      = 'На карту ₽';
      hdr.getCell(T.cashDelta).value   = 'Из кассы ₽';
      hdr.getCell(T.limYearRem).value  = 'Лимит СЗ год ост. ₽';
      hdr.getCell(T.limMonthRem).value = 'Лимит СЗ мес ост. ₽';
      hdr.font = { bold: true, size: 10, color: { argb: FONT_GOLD_DARK } };
      hdr.alignment = { horizontal: 'center' };
      // Золотая заливка ВСЕЙ строки шапки
      for (let C = 1; C <= totalCols; C++) {
        hdr.getCell(C).fill = goldFill;
        hdr.getCell(C).border = borderAll;
      }
      ws.getRow(3).height = 28;

      // Ширины колонок
      ws.getColumn(1).width = 26;   // ФИО
      ws.getColumn(2).width = 16;   // Город (Q-3)
      ws.getColumn(3).width = 16;   // Должность
      for (let d = 1; d <= dim; d++) ws.getColumn(leadCols + d).width = 5;
      ws.getColumn(leadCols + dim + 1).width = 10;
      ws.getColumn(leadCols + dim + 2).width = 14;
      if (showPerDiem) ws.getColumn(leadCols + dim + 3).width = 14;
      ws.getColumn(T.type).width        = 8;
      ws.getColumn(T.payerLabel).width  = 22;   // Q-3 «Получает» — длинные подписи
      ws.getColumn(T.earned).width      = 14;
      ws.getColumn(T.paid).width        = 14;   // Stage S «📤 Выплачено»
      ws.getColumn(T.bonus).width       = 13;
      ws.getColumn(T.penalty).width     = 13;
      ws.getColumn(T.salary).width      = 12;
      ws.getColumn(T.toCard).width      = 13;
      ws.getColumn(T.cashDelta).width   = 13;
      ws.getColumn(T.limYearRem).width  = 17;
      ws.getColumn(T.limMonthRem).width = 17;

      // Заморозка: 3 левые колонки (ФИО / Город / Должность) + строка шапки.
      ws.views = [{ state: 'frozen', xSplit: leadCols, ySplit: 3 }];

      const TYPE_LABEL = { day: 'Д', night: 'Н', warehouse: 'С', medical: 'М', travel: '🚗', waiting: '⏳' };
      const TYPE_FILL  = {
        day: 'FFB8E6B8', night: 'FFADD8E6', warehouse: 'FFFFE4B5',
        medical: 'FFFFB6C1', travel: 'FFFFE066', waiting: 'FFD3D3D3'
      };

      const firstDataRow = 4;
      let rowIdx = firstDataRow;
      const limitMonthly = Number(s.limits?.monthly || 350000);
      for (const emp of employees) {
        const r = ws.getRow(rowIdx);
        const isZebra = ((rowIdx - firstDataRow) % 2) === 1;
        const rowZebraFill = isZebra ? zebraFill : null;

        r.getCell(1).value = emp.fio || '';
        r.getCell(2).value = emp.city || '';      // Q-3: Город (между ФИО и Должностью)
        r.getCell(3).value = emp.position || '';

        for (let d = 1; d <= dim; d++) {
          // Контракт: emp.days[<day-number>] ('1'..'31'), не ISO.
          const cell = (emp.days || {})[String(d)];
          const c = r.getCell(leadCols + d);
          if (cell && cell.type) {
            c.value = cell.points != null ? Number(cell.points) : (TYPE_LABEL[cell.type] || '');
            const fill = TYPE_FILL[cell.type];
            if (fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
            c.alignment = { horizontal: 'center', vertical: 'middle' };
          } else if (rowZebraFill) {
            c.fill = rowZebraFill;
          }
        }

        // Формулы по строке
        const startCol = ws.getColumn(leadCols + 1).letter; // первая колонка дня
        const endCol   = ws.getColumn(leadCols + dim).letter;
        // Баллы = сумма колонок дня
        r.getCell(leadCols + dim + 1).value = { formula: `SUM(${startCol}${rowIdx}:${endCol}${rowIdx})` };
        // Сумма ₽ — фиксированное значение
        r.getCell(leadCols + dim + 2).value = r0(emp.total_amount);
        r.getCell(leadCols + dim + 2).numFmt = RUB_FMT;
        if (showPerDiem) {
          r.getCell(leadCols + dim + 3).value = r0(emp.per_diem_total);
          r.getCell(leadCols + dim + 3).numFmt = RUB_FMT;
        }

        // ── НОВЫЕ КОЛОНКИ ─────────────────────────────────────────────
        // Тип (СЗ/Оф/Нал) — текстом + фон
        const payType = emp.pay_type;
        // V240: «self_employed_payee» (рабочий через СЗ-получателя) визуально
        // эквивалентен self_employed в Excel-выгрузке.
        const isSelfEmployedLike = (payType === 'self_employed' || payType === 'self_employed_payee');
        const typeCell = r.getCell(T.type);
        if (isSelfEmployedLike) {
          typeCell.value = (payType === 'self_employed_payee') ? 'СЗ→' : 'СЗ';
          typeCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_SZ } };
        } else if (payType === 'official') {
          typeCell.value = 'Оф';
          typeCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_OF } };
        } else {
          typeCell.value = 'Нал';
          typeCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_CASH } };
        }
        typeCell.alignment = { horizontal: 'center', vertical: 'middle' };
        typeCell.font = { bold: true };

        // Q-3: «Получает» — текстовый ярлык payment_source_label с фоновой подсказкой.
        //   «сам»       → нежно-зелёный (#E8F5E9), СЗ платит сам себе
        //   «через X»   → нежно-сиреневый (#F3E5F5), СЗ-payee (родственник)
        //   «оклад»     → нежно-голубой (#E3F2FD), официальный
        //   «наличка»   → без фона
        const payerCell = r.getCell(T.payerLabel);
        const payerLabel = emp.payment_source_label || '';
        payerCell.value = payerLabel;
        payerCell.alignment = { horizontal: 'left', vertical: 'middle' };
        if (payerLabel === 'сам') {
          payerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };
        } else if (payerLabel.startsWith('через ')) {
          payerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3E5F5' } };
        } else if (payerLabel === 'оклад') {
          payerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F2FD' } };
        }
        // «наличка» — без фона (по требованию)

        // Заработано ₽
        r.getCell(T.earned).value = r0(emp.earned);
        r.getCell(T.earned).numFmt = RUB_FMT;

        // 📤 Выплачено ₽ (Stage S) — нежно-оранжевый фон #FFF3E0 если >0,
        // прочерк если 0. Tooltip-комментарий — разбивка по типам выплат
        // (per_diem/salary/advance/bonus). Бухгалтер видит сколько РП в поле
        // УЖЕ выдал нал/перевод, не дублируя оплату.
        const empPaid = Number(emp.paid_total || 0);
        if (empPaid > 0) {
          const pcell = r.getCell(T.paid);
          pcell.value  = r0(empPaid);
          pcell.numFmt = RUB_FMT;
          pcell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3E0' } };
          pcell.font   = { color: { argb: 'FFE65100' }, bold: true };
          // Tooltip-комментарий с разбивкой по типам (ExcelJS поддерживает .note).
          const br = emp.paid_breakdown || {};
          const parts = [];
          if (Number(br.per_diem || 0) > 0) parts.push(`суточные: ${r0(br.per_diem)} ₽`);
          if (Number(br.salary   || 0) > 0) parts.push(`оклад: ${r0(br.salary)} ₽`);
          if (Number(br.advance  || 0) > 0) parts.push(`аванс: ${r0(br.advance)} ₽`);
          if (Number(br.bonus    || 0) > 0) parts.push(`премия: ${r0(br.bonus)} ₽`);
          const cashTxt     = Number(emp.paid_cash     || 0) > 0 ? `нал: ${r0(emp.paid_cash)} ₽` : '';
          const transferTxt = Number(emp.paid_transfer || 0) > 0 ? `перевод: ${r0(emp.paid_transfer)} ₽` : '';
          const head = [cashTxt, transferTxt].filter(Boolean).join(' + ');
          if (parts.length || head) {
            pcell.note = (head ? head + '\n' : '') + (parts.length ? 'По типам: ' + parts.join(', ') : '');
          }
        } else {
          r.getCell(T.paid).value = '—';
          r.getCell(T.paid).alignment = { horizontal: 'center' };
        }

        // 🎁 Премия ₽ — зелёный фон если >0, прочерк если 0
        const empBonus = Number(emp.bonus || 0);
        if (empBonus > 0) {
          r.getCell(T.bonus).value = r0(empBonus);
          r.getCell(T.bonus).numFmt = RUB_FMT;
          r.getCell(T.bonus).fill = { type: 'pattern', pattern: 'solid',
                                       fgColor: { argb: 'FFE8F5E9' } };
          r.getCell(T.bonus).font = { color: { argb: 'FF1B5E20' }, bold: true };
        } else {
          r.getCell(T.bonus).value = '—';
          r.getCell(T.bonus).alignment = { horizontal: 'center' };
        }

        // ⚠ Штраф ₽ — розовый фон если >0, прочерк если 0
        const empPenalty = Number(emp.penalty || 0);
        if (empPenalty > 0) {
          r.getCell(T.penalty).value = r0(empPenalty);
          r.getCell(T.penalty).numFmt = RUB_FMT;
          r.getCell(T.penalty).fill = { type: 'pattern', pattern: 'solid',
                                         fgColor: { argb: 'FFFFEBEE' } };
          r.getCell(T.penalty).font = { color: { argb: 'FFC62828' }, bold: true };
        } else {
          r.getCell(T.penalty).value = '—';
          r.getCell(T.penalty).alignment = { horizontal: 'center' };
        }

        // Оклад ₽ (deduct_salary, прочерк для не-оф)
        if (payType === 'official') {
          r.getCell(T.salary).value = r0(emp.deduct_salary);
          r.getCell(T.salary).numFmt = RUB_FMT;
        } else {
          r.getCell(T.salary).value = '—';
          r.getCell(T.salary).alignment = { horizontal: 'center' };
        }

        // На карту ₽ (transfer_amount, прочерк для нал)
        if (payType === 'cash') {
          r.getCell(T.toCard).value = '—';
          r.getCell(T.toCard).alignment = { horizontal: 'center' };
        } else {
          r.getCell(T.toCard).value = r0(emp.transfer_amount);
          r.getCell(T.toCard).numFmt = RUB_FMT;
        }

        // Из кассы ₽ — только cash_payout (доплата налом). Без знака.
        const cashOut = Number(emp.cash_payout || 0);
        if (cashOut > 0) {
          r.getCell(T.cashDelta).value = r0(cashOut);
          r.getCell(T.cashDelta).numFmt = RUB_FMT;
        } else {
          r.getCell(T.cashDelta).value = '—';
          r.getCell(T.cashDelta).alignment = { horizontal: 'center' };
        }

        // Лимит СЗ год ост. + Лимит СЗ мес ост.
        if (isSelfEmployedLike) {
          const yrRem = Number(emp.yearly_remaining || 0);
          const moRem = Number(emp.monthly_remaining || 0);
          const yrCell = r.getCell(T.limYearRem);
          const moCell = r.getCell(T.limMonthRem);
          yrCell.value = r0(yrRem);
          yrCell.numFmt = RUB_FMT;
          moCell.value = r0(moRem);
          moCell.numFmt = RUB_FMT;
          // Подкрашиваем по правилу контракта:
          //   >2× месячного лимита остаток — зелёный, иначе бледно-красный.
          const okGreen = yrRem > 2 * limitMonthly;
          yrCell.fill = { type: 'pattern', pattern: 'solid',
                          fgColor: { argb: okGreen ? FILL_LIMIT_OK : FILL_LIMIT_LOW } };
          // Месячный лимит — той же логикой подкрашиваем (бледно-красный если <30% месячного)
          const moOk = moRem > 0.3 * limitMonthly;
          moCell.fill = { type: 'pattern', pattern: 'solid',
                          fgColor: { argb: moOk ? FILL_LIMIT_OK : FILL_LIMIT_LOW } };
        } else {
          r.getCell(T.limYearRem).value  = '—';
          r.getCell(T.limMonthRem).value = '—';
          r.getCell(T.limYearRem).alignment  = { horizontal: 'center' };
          r.getCell(T.limMonthRem).alignment = { horizontal: 'center' };
        }

        // Зебра по новым/правым колонкам — если в клетке нет своего фона
        if (rowZebraFill) {
          for (const cN of [1, 2, 3, leadCols + dim + 1, leadCols + dim + 2,
                            T.earned, T.paid, T.bonus, T.penalty,
                            T.salary, T.toCard, T.cashDelta]) {
            const c = r.getCell(cN);
            if (!c.fill) c.fill = rowZebraFill;
          }
          if (showPerDiem) {
            const c = r.getCell(leadCols + dim + 3);
            if (!c.fill) c.fill = rowZebraFill;
          }
          // Q-3: «Получает» — зебру не накладываем (цвет=маркер сценария).
        }

        // Тонкие границы по всей строке
        for (let C = 1; C <= totalCols; C++) {
          r.getCell(C).border = borderAll;
        }

        rowIdx++;
      }

      // Итого
      if (employees.length > 0) {
        const tot = ws.getRow(rowIdx);
        // Q-3: ИТОГО:-merge теперь по 3 колонкам (ФИО / Город / Должность).
        ws.mergeCells(rowIdx, 1, rowIdx, leadCols);
        tot.getCell(1).value = 'ИТОГО:';
        tot.getCell(1).font = { bold: true };
        tot.getCell(1).alignment = { horizontal: 'right' };

        const startRow = firstDataRow;
        const endRow = rowIdx - 1;
        // Дни — суммы
        for (let d = 1; d <= dim; d++) {
          const col = ws.getColumn(leadCols + d).letter;
          tot.getCell(leadCols + d).value = { formula: `SUM(${col}${startRow}:${col}${endRow})` };
        }
        // Баллы / Сумма / Суточные?
        const ptsCol = ws.getColumn(leadCols + dim + 1).letter;
        tot.getCell(leadCols + dim + 1).value = { formula: `SUM(${ptsCol}${startRow}:${ptsCol}${endRow})` };
        const amtCol = ws.getColumn(leadCols + dim + 2).letter;
        tot.getCell(leadCols + dim + 2).value = { formula: `SUM(${amtCol}${startRow}:${amtCol}${endRow})` };
        tot.getCell(leadCols + dim + 2).numFmt = RUB_FMT;
        if (showPerDiem) {
          const pdCol = ws.getColumn(leadCols + dim + 3).letter;
          tot.getCell(leadCols + dim + 3).value = { formula: `SUM(${pdCol}${startRow}:${pdCol}${endRow})` };
          tot.getCell(leadCols + dim + 3).numFmt = RUB_FMT;
        }

        // Новые финансовые итоги — SUM по своим колонкам
        const sumCol = (idx) => {
          const col = ws.getColumn(idx).letter;
          tot.getCell(idx).value = { formula: `SUM(${col}${startRow}:${col}${endRow})` };
          tot.getCell(idx).numFmt = RUB_FMT;
        };
        // Тип / Получает — оставляем пустыми (категориальные)
        tot.getCell(T.type).value       = '';
        tot.getCell(T.payerLabel).value = '';
        sumCol(T.earned);
        sumCol(T.paid);          // Stage S: ИТОГО «📤 Выплачено ₽»
        sumCol(T.bonus);
        sumCol(T.penalty);
        sumCol(T.salary);
        sumCol(T.toCard);
        sumCol(T.cashDelta);
        // Лимиты — суммировать остатки бессмысленно (они индивидуальные),
        // оставляем пустыми с прочерком в заголовке.
        tot.getCell(T.limYearRem).value  = '';
        tot.getCell(T.limMonthRem).value = '';

        tot.font = { bold: true };
        // Жёлтая заливка ИТОГО + границы
        for (let C = 1; C <= totalCols; C++) {
          tot.getCell(C).fill = totalFill;
          tot.getCell(C).border = borderAll;
          if (!tot.getCell(C).font) tot.getCell(C).font = { bold: true };
          else tot.getCell(C).font = Object.assign({}, tot.getCell(C).font, { bold: true });
        }
      }

      const buf = await wb.xlsx.writeBuffer();
      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      const fname = encodeURIComponent(`Табель_${mName}_${year}.xlsx`);
      reply.header('Content-Disposition', `attachment; filename*=UTF-8''${fname}`);
      return reply.send(Buffer.from(buf));
    } catch (err) {
      fastify.log.error('[timesheet-v2] export error: ' + (err && err.message));
      return reply.code(500).send({ error: 'Ошибка экспорта' });
    }
  });

  // ────────────────────────────────────────────────────────────────
  // Stage W: GET /api/timesheet/v2/handovers/:y/:m
  //   Список ожидающих передач от рабочих к РП за период.
  //   Источник: se_transfers status='transferred' за месяц.
  //   LEFT JOIN worker_to_pm_handovers — текущий статус передачи.
  // RBAC:
  //   PM → ограничено своими (st.pm_user_id = self)
  //   HEAD_PM/DIRECTOR_*/ADMIN/BUH → все
  // ────────────────────────────────────────────────────────────────
  fastify.get('/handovers/:y/:m', viewAuth, async (request, reply) => {
    try {
      const year = parseInt(request.params.y, 10);
      const month = parseInt(request.params.m, 10);
      if (!Number.isFinite(year) || !Number.isFinite(month)
          || month < 1 || month > 12) {
        return reply.code(400).send({ error: 'Bad year/month' });
      }

      const role = request.user.role;
      const uid = Number(request.user.id);

      // PM (не HEAD_PM) — только свои.
      const params = [year, month];
      let pmFilter = '';
      if (role === 'PM') {
        params.push(uid);
        pmFilter = `AND st.pm_user_id = $3`;
      }

      const { rows } = await db.query(`
        SELECT st.id          AS se_transfer_id,
               st.employee_id AS worker_id,
               COALESCE(e.fio, e.full_name) AS worker_fio,
               st.work_id,
               w.work_title,
               st.year, st.month,
               st.transfer_amount AS expected_amount,
               st.transferred_at,
               st.pm_user_id,
               u.name AS pm_name,
               h.id              AS handover_id,
               h.status          AS handover_status,
               h.received_amount AS handover_received_amount,
               h.received_at     AS handover_received_at,
               h.note            AS handover_note
        FROM se_transfers st
        JOIN employees e ON e.id = st.employee_id
        LEFT JOIN works w ON w.id = st.work_id
        LEFT JOIN users u ON u.id = st.pm_user_id
        LEFT JOIN worker_to_pm_handovers h
               ON h.source_se_transfer_id = st.id
        WHERE st.year = $1 AND st.month = $2
          AND st.status = 'transferred'
          AND COALESCE(st.transfer_amount, 0) > 0
          ${pmFilter}
        ORDER BY (h.status IS NULL) DESC,
                 (h.status = 'pending') DESC,
                 COALESCE(e.fio, e.full_name)
      `, params);

      return {
        year, month,
        handovers: rows.map(r => ({
          se_transfer_id: r.se_transfer_id,
          worker_id: r.worker_id,
          worker_fio: r.worker_fio,
          work_id: r.work_id,
          work_title: r.work_title,
          year: r.year,
          month: r.month,
          expected_amount: Number(r.expected_amount) || 0,
          transferred_at: r.transferred_at,
          pm_user_id: r.pm_user_id,
          pm_name: r.pm_name,
          handover_id: r.handover_id || null,
          handover_status: r.handover_status || null,
          received_amount: r.handover_received_amount != null
            ? Number(r.handover_received_amount) : null,
          received_at: r.handover_received_at,
          note: r.handover_note
        }))
      };
    } catch (err) {
      fastify.log.error({ err }, '[timesheet-v2] /handovers error');
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });
}

module.exports = routes;
// экспортируем assertNotLocked для других модулей (fallback, если timesheet-locks.js нет)
module.exports.assertNotLocked = assertNotLocked;
module.exports.getActiveLocks  = getActiveLocks;
