'use strict';

/**
 * Timesheet v2 — лок-чекер периода (год+месяц).
 * ═══════════════════════════════════════════════════════════════════════════
 * Используется ручками /api/timesheet/v2/* (PUT /entry, POST /lock, DELETE
 * /lock/:id) ДО любых записей в field_checkins / field_trip_stages, чтобы
 * соблюсти RBAC по локам периода (миграция V232 — payroll_period_locks).
 *
 * Источник правды — TIMESHEET_V2_CONTRACT.md секция «Лок-проверки перед
 * записью» и таблица «scope → роль».
 *
 *   1) global    — ставит DIRECTOR_x (GEN/COMM/DEV), ADMIN, BUH, HR, HR_MANAGER.
 *                  Запирает ВСЕХ (включая PM/WAREHOUSE/TO/OFFICE_MANAGER).
 *                  Снять может только DIRECTOR_x или ADMIN.
 *   2) warehouse — ставит WAREHOUSE. Запирает редактирование клеток type=warehouse.
 *   3) medical   — ставит TO/HEAD_TO. Запирает type=medical/training/ship/helicopter.
 *   4) travel    — ставит OFFICE_MANAGER и HEAD_TO. Запирает type=travel и waiting.
 *   5) pm        — ставит PM/HEAD_PM на СВОЙ user_id. Запирает редактирование
 *                  чекинов PM, где entered_by_user_id = scope_user_id, ИЛИ
 *                  где work.pm_id = scope_user_id (PM «заморозил свой набор»).
 *
 * DIRECTOR_x и ADMIN могут редактировать поверх любого лока (см. контракт,
 * «исключение через отдельный разлок»). Эту проверку делает РУЧКА, не библиотека —
 * библиотека только сообщает «лок есть/нет, кто и когда».
 *
 * Интерфейс: принимает `fastify` (для fastify.db.query / fastify.pg.query)
 * и возвращает throw-аемые ошибки с `statusCode=423` («Locked» — стандарт
 * WebDAV 423, который Fastify прокидывает в HTTP-ответ автоматически).
 */

const ROLE_TO_SCOPE = {
  // Какой scope-лок «персональный» для роли (PM лочит сам себя).
  PM: 'pm',
  HEAD_PM: 'pm',
  WAREHOUSE: 'warehouse',
  TO: 'medical',
  HEAD_TO: 'medical',
  OFFICE_MANAGER: 'travel',
};

const DIRECTORS_AND_ADMIN = new Set([
  'ADMIN',
  'DIRECTOR_GEN',
  'DIRECTOR_COMM',
  'DIRECTOR_DEV',
]);

/** Роли, которым можно обойти чужой pm-лок работы после явного подтверждения. */
const PM_LOCK_OVERRIDE_ROLES = new Set([
  'OFFICE_MANAGER',
  'WAREHOUSE',
  'TO',
  'HEAD_TO',
]);

const TYPE_TO_SCOPE = {
  // Какой scope-лок блокирует редактирование клетки данного типа.
  day: null,        // дневная смена — не отдельный scope, только pm/global
  night: null,      // ночная — то же
  warehouse: 'warehouse',
  medical: 'medical',
  travel: 'travel',
  // V255 (23.06.2026): 'ship' (Корабль) ставит ТО как и МО — лочится medical-локом.
  ship:    'medical',
  training: 'medical',
  helicopter: 'medical',
  // Ожидание ставится в travel-табеле (офис-менеджер, рук ТО) → лочится travel-локом.
  // В global (PM/директора) дополнительно блокирует только period/global-лок.
  waiting: 'travel',
};

function fmtRuPeriod(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return '';
  return `${String(m).padStart(2, '0')}.${y}`;
}

function fmtRuDateTime(v) {
  if (!v) return '';
  try {
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${dd}.${mm}.${yy} ${hh}:${mi}`;
  } catch (_) {
    return '';
  }
}

function lockFio(lock) {
  return (lock && (lock.locked_by_fio || lock.scope_user_fio)) || 'РП';
}

function buildLockMessageRu(reason, lock, year, month) {
  const fio = lockFio(lock);
  const period = fmtRuPeriod(year, month);
  const when = fmtRuDateTime(lock && lock.locked_at);
  const whenSuffix = when ? ` (${when})` : '';
  // Выносим ФИО-вставки из шаблонов: вложенные литералы внутри `${...}` — lint-ошибка.
  const hasFio = fio !== 'РП';
  const fioDash = hasFio ? ` — ${fio}` : '';
  const fioParen = hasFio ? ` (${fio})` : '';
  switch (reason) {
    case 'period_locked_global':
      return period
        ? `Месяц ${period} закрыт глобально${fioDash}${whenSuffix}. Изменение запрещено.`
        : `Месяц закрыт глобально${whenSuffix}. Изменение запрещено.`;
    case 'period_locked_travel':
      return period
        ? `Табель дороги за ${period} закрыт${fioParen}${whenSuffix}. Изменение запрещено.`
        : `Табель дороги закрыт${whenSuffix}. Изменение запрещено.`;
    case 'period_locked_warehouse':
      return period
        ? `Табель склада за ${period} закрыт${fioParen}${whenSuffix}. Изменение запрещено.`
        : `Табель склада закрыт${whenSuffix}. Изменение запрещено.`;
    case 'period_locked_medical':
      return period
        ? `Табель МО за ${period} закрыт${fioParen}${whenSuffix}. Изменение запрещено.`
        : `Табель МО закрыт${whenSuffix}. Изменение запрещено.`;
    case 'period_locked_pm_self':
      return period
        ? `Вы уже закрыли свой месяц ${period}${whenSuffix}. Чтобы править — сначала откройте период.`
        : `Вы уже закрыли свой месяц${whenSuffix}. Чтобы править — сначала откройте период.`;
    case 'period_locked_pm_work':
      return period
        ? `Отметка за ${period} привязана к работе РП ${fio} — он уже закрыл свой месяц${whenSuffix}.`
        : `Отметка привязана к работе РП ${fio} — он уже закрыл свой месяц${whenSuffix}.`;
    default:
      return period
        ? `Период ${period} закрыт${fioParen}${whenSuffix}. Изменение запрещено.`
        : `Период закрыт${whenSuffix}. Изменение запрещено.`;
  }
}

function getDb(fastify) {
  // Поддерживаем оба стиля: fastify.db (как в work-readiness.js) и fastify.pg
  // (как написано в спеке агента). В коде CRM реально используется fastify.db.
  const db = fastify && (fastify.db || fastify.pg);
  if (!db || typeof db.query !== 'function') {
    throw new Error('timesheet-locks: fastify.db/fastify.pg.query недоступен');
  }
  return db;
}

function lockedError(activeLocks, hint, opts = {}) {
  // Возвращаем готовый объект с активными локами в payload — фронту удобно
  // показать «период закрыт ФИО (HEAD_PM) в 14:32».
  //
  // BUG err.code регистр: фронт + ручки (field-pm, field-manage, global-timesheet,
  // worker-payments, timesheet-v2) проверяют 'period_locked' (lower-case) —
  // приводим к lower; также экспонируем обе формы err.lock + err.locks для
  // обратной совместимости (старые catcher'ы читают err.lock; новые — err.locks).
  const list = Array.isArray(activeLocks) ? activeLocks : (activeLocks ? [activeLocks] : []);
  const reason = hint || 'period_locked';
  const lock = list[0] || null;
  const err = new Error(reason);
  err.statusCode = 423;
  err.code = 'period_locked';
  err.reason = reason;
  err.locks = list;
  err.lock = lock;
  err.overridable = !!opts.overridable;
  err.message_ru = opts.message_ru
    || buildLockMessageRu(reason, lock, opts.year, opts.month);
  return err;
}

/**
 * Получить ВСЕ активные локи на (year, month) с ФИО.
 * Возвращает: [{id, scope, scope_user_id, scope_user_fio, locked_at, locked_by, locked_by_fio}, ...]
 */
async function getActiveLocks(fastify, year, month) {
  const db = getDb(fastify);
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    throw Object.assign(new Error('invalid_year_month'), { statusCode: 400 });
  }
  // users.name — каноническое имя в users (НЕ full_name; full_name живёт в employees).
  const { rows } = await db.query(
    `SELECT
        l.id,
        l.scope,
        l.scope_user_id,
        l.locked_at,
        l.locked_by,
        u_scope.name           AS scope_user_fio,
        u_lock.name            AS locked_by_fio,
        u_lock.role            AS locked_by_role,
        l.note
       FROM payroll_period_locks l
       LEFT JOIN users u_scope ON u_scope.id = l.scope_user_id
       LEFT JOIN users u_lock  ON u_lock.id  = l.locked_by
      WHERE l.year = $1 AND l.month = $2 AND l.unlocked_at IS NULL
      ORDER BY l.locked_at ASC`,
    [y, m]
  );
  return rows;
}

/**
 * Бросает 423-ошибку если на (year, month) для viewer стоит активный лок,
 * который мешает запрошенной операции. Не бросает — значит ОК записывать.
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{id:number, role:string}}          viewer   — фактический юзер.
 * @param {{
 *   year:number, month:number,
 *   scope_hint?: 'pm'|'warehouse'|'medical'|'travel'|'global',
 *   type?: string,           // type клетки: day|night|warehouse|medical|travel|waiting
 *   work_id?: number,        // для PM: проверяем «свой» лок если работа моя
 *   employee_id?: number,    // зарезервировано (на будущее: лок персонального)
 *   date?: string,           // YYYY-MM-DD; пока не используется в логике, оставлено для аудита
 *   force_pm_lock?: boolean  // явный обход чужого pm-лока работы (после confirm на UI)
 * }} payload
 * @returns {Promise<{ok:true, locks:Array, pm_lock_overridden?: object|null}>}
 */
async function assertNotLocked(fastify, viewer, payload) {
  if (!viewer || !viewer.id || !viewer.role) {
    throw Object.assign(new Error('viewer required'), { statusCode: 400 });
  }
  const role = String(viewer.role).toUpperCase();
  const { year, month } = payload || {};
  const forcePmLock = !!payload?.force_pm_lock;
  const lockMsgOpts = { year, month };
  const locks = await getActiveLocks(fastify, year, month);

  // Уровень 1: global — лочит всех КРОМЕ DIRECTOR_*/ADMIN. Обход запрещён.
  const globalLock = locks.find((l) => l.scope === 'global');
  if (globalLock && !DIRECTORS_AND_ADMIN.has(role)) {
    throw lockedError([globalLock], 'period_locked_global', {
      ...lockMsgOpts,
      overridable: false,
      message_ru: forcePmLock
        ? `${buildLockMessageRu('period_locked_global', globalLock, year, month)} Обход подтверждением недоступен.`
        : undefined
    });
  }

  // Уровень 2: scope по type клетки (warehouse/medical/travel).
  const typeScope = TYPE_TO_SCOPE[payload?.type];
  if (typeScope) {
    const scopeLock = locks.find((l) => l.scope === typeScope && !l.scope_user_id);
    if (scopeLock && !DIRECTORS_AND_ADMIN.has(role)) {
      const reason = `period_locked_${typeScope}`;
      throw lockedError([scopeLock], reason, {
        ...lockMsgOpts,
        overridable: false,
        message_ru: forcePmLock
          ? `${buildLockMessageRu(reason, scopeLock, year, month)} Обход подтверждением недоступен.`
          : undefined
      });
    }
  }

  // Уровень 3: scope_hint — если ручка прямо говорит «работаем в этом scope»
  // (например, PM лочит сам себя и сразу пытается дописать — должен получить 423).
  if (payload?.scope_hint && payload.scope_hint !== 'pm') {
    const hintLock = locks.find((l) => l.scope === payload.scope_hint && !l.scope_user_id);
    if (hintLock && !DIRECTORS_AND_ADMIN.has(role)) {
      const reason = `period_locked_${payload.scope_hint}`;
      throw lockedError([hintLock], reason, {
        ...lockMsgOpts,
        overridable: false,
        message_ru: forcePmLock
          ? `${buildLockMessageRu(reason, hintLock, year, month)} Обход подтверждением недоступен.`
          : undefined
      });
    }
  }

  // Уровень 4: pm-персональный лок.
  // (а) Если viewer — PM/HEAD_PM, его собственный pm-лок запирает любые правки
  //     этого пользователя (он сам закрыл свой период). Обход запрещён.
  // (б) Если payload.work_id указан и работа принадлежит PM, у которого pm-лок —
  //     никто (кроме DIRECTOR/ADMIN) не должен поверх писать — кроме ролей
  //     PM_LOCK_OVERRIDE_ROLES после явного force_pm_lock (confirm на UI).
  //
  // FIX 8: WORKER-роль исключена из pm-check. Раньше viewer.id для WORKER —
  // это employees.id, а scope_user_id — это users.id. Сравнение шло в обход
  // типов (случайное совпадение → bypass). Рабочий подчиняется global-локу
  // (а его pm-чекин ставит он сам — нет смысла блокировать). Pm-check теперь
  // только для CRM-ролей PM/HEAD_PM (а) и не-WORKER не-DIRECTOR ролей (б).
  if (role === 'WORKER') {
    return { ok: true, locks, pm_lock_overridden: null };
  }

  const pmLocks = locks.filter((l) => l.scope === 'pm');
  if (pmLocks.length) {
    // (а)
    if (ROLE_TO_SCOPE[role] === 'pm') {
      const mine = pmLocks.find((l) => Number(l.scope_user_id) === Number(viewer.id));
      if (mine) {
        throw lockedError([mine], 'period_locked_pm_self', {
          ...lockMsgOpts,
          overridable: false,
          message_ru: forcePmLock
            ? `${buildLockMessageRu('period_locked_pm_self', mine, year, month)} Обход подтверждением недоступен.`
            : undefined
        });
      }
    }
    // (б)
    if (!DIRECTORS_AND_ADMIN.has(role) && payload?.work_id) {
      const db = getDb(fastify);
      const { rows } = await db.query(
        'SELECT pm_id FROM works WHERE id = $1',
        [Number(payload.work_id)]
      );
      const pmId = rows[0]?.pm_id || null;
      if (pmId) {
        const ownerLock = pmLocks.find((l) => Number(l.scope_user_id) === Number(pmId));
        if (ownerLock && Number(pmId) !== Number(viewer.id)) {
          const canOverride = PM_LOCK_OVERRIDE_ROLES.has(role);
          if (forcePmLock && canOverride) {
            return { ok: true, locks, pm_lock_overridden: ownerLock };
          }
          if (forcePmLock && !canOverride) {
            throw lockedError([ownerLock], 'period_locked_pm_work', {
              ...lockMsgOpts,
              overridable: false,
              message_ru: `${buildLockMessageRu('period_locked_pm_work', ownerLock, year, month)} У вашей роли нет права обхода.`
            });
          }
          throw lockedError([ownerLock], 'period_locked_pm_work', {
            ...lockMsgOpts,
            overridable: canOverride
          });
        }
      }
    }
  }

  if (forcePmLock) {
    // force прислали, но pm-work лока нет — не ошибка, просто игнор.
    return { ok: true, locks, pm_lock_overridden: null };
  }

  return { ok: true, locks, pm_lock_overridden: null };
}

module.exports = {
  assertNotLocked,
  getActiveLocks,
  // Экспортируем константы для роутов: чтобы scope/роли не дрейфовали.
  ROLE_TO_SCOPE,
  TYPE_TO_SCOPE,
  DIRECTORS_AND_ADMIN,
  PM_LOCK_OVERRIDE_ROLES,
  buildLockMessageRu,
};
