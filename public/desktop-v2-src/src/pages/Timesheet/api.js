/**
 * Timesheet v2 — обёртки fetch для API /api/timesheet/v2/*.
 *
 * Контракт: см. TIMESHEET_V2_CONTRACT.md (источник истины).
 *
 * Endpoints:
 *   GET    /api/timesheet/v2/:year/:month[?work_id=N]   — табель
 *   PUT    /api/timesheet/v2/entry                     — поставить/удалить отметку
 *   GET    /api/timesheet/v2/locks/:year/:month        — статусы закрытия (бейджи)
 *   POST   /api/timesheet/v2/lock                      — закрыть месяц
 *   DELETE /api/timesheet/v2/lock/:id                  — открыть месяц
 *   GET    /api/timesheet/v2/settings/position-points  — баллы по позициям
 *   PUT    /api/timesheet/v2/settings/position-points  — обновить баллы (ADMIN/DIRECTOR_GEN)
 *   GET    /api/timesheet/v2/:year/:month/export?format=xlsx — Excel выгрузка
 *
 * Mode → URL (для роутера, см. App.jsx):
 *   pm        → /my-timesheet            roles=[PM,HEAD_PM]
 *   warehouse → /timesheet-warehouse     roles=[WAREHOUSE]
 *   medical   → /timesheet-medical       roles=[TO,HEAD_TO]
 *   travel    → /timesheet-travel        roles=[OFFICE_MANAGER]
 *   global    → /timesheet               roles=[DIRECTOR_*, ADMIN, BUH, HR, HR_MANAGER]
 */
import { api } from '@/api/client';
import { downloadProtected } from '@/api/download';

const BASE = '/api/timesheet/v2';

/* ═══════════════════ HTTP wrappers ═══════════════════ */

export function getMonth(year, month, opts = {}) {
  const qs = opts.work_id ? `?work_id=${encodeURIComponent(opts.work_id)}` : '';
  return api(`${BASE}/${year}/${month}${qs}`);
}

export function putEntry(data) {
  return api(`${BASE}/entry`, { method: 'PUT', body: data });
}

/**
 * Список работ, которые видит текущий пользователь.
 * Используется для work-picker когда сотрудник не привязан к работе,
 * а тип отметки (day/night/waiting/ship/warehouse) требует work_id.
 *
 * Возвращает массив { id, work_title, city, ... }.
 */
export async function loadWorks() {
  // 1) /api/pm/works — PM/HEAD_PM видит свои работы (бэкенд фильтрует pm_id)
  try {
    const r = await api('/api/pm/works');
    const arr = Array.isArray(r) ? r : (r?.works || r?.items || r?.rows || []);
    if (arr.length) return arr;
  } catch (_) {}
  // 2) /api/works?my=1 — fallback для остальных ролей
  try {
    const r = await api('/api/works?my=1');
    const arr = Array.isArray(r) ? r : (r?.works || r?.items || r?.rows || []);
    if (arr.length) return arr;
  } catch (_) {}
  // 3) последний шанс — /api/works без фильтра (директор/админ)
  try {
    const r = await api('/api/works');
    const arr = Array.isArray(r) ? r : (r?.works || r?.items || r?.rows || []);
    return arr;
  } catch (_) {}
  return [];
}

/**
 * Типы отметок которые требуют work_id (синхрон с backend src/routes/timesheet-v2.js).
 * medical/travel — БЕЗ work_id (межработные этапы).
 */
export const REQUIRE_WORK_ID = new Set(['day', 'night', 'waiting', 'ship', 'warehouse']);

export function lockMonth(data) {
  return api(`${BASE}/lock`, { method: 'POST', body: data });
}

export function unlockMonth(lockId) {
  return api(`${BASE}/lock/${lockId}`, { method: 'DELETE' });
}

export function getLocks(year, month) {
  return api(`${BASE}/locks/${year}/${month}`);
}

/**
 * FIX 1 + FIX 2 — расширенный статус закрытия месяца.
 * Returns:
 *   {
 *     year, month,
 *     pm_locks: [{ user_id, fio, locked, locked_at, lock_id, role }],
 *     scope_locks: { warehouse, medical, travel, global } each
 *       { locked, locked_by_fio, locked_at, lock_id }
 *   }
 */
export function getClosureStatus(year, month) {
  return api(`${BASE}/closure-status/${year}/${month}`);
}

export function getSettings() {
  return api(`${BASE}/settings/position-points`);
}

export function updateSettings(data) {
  return api(`${BASE}/settings/position-points`, { method: 'PUT', body: data });
}

export async function exportXlsx(year, month) {
  const filename = `табель_${year}_${String(month).padStart(2, '0')}.xlsx`;
  return downloadProtected(`${BASE}/${year}/${month}/export?format=xlsx`, filename);
}

/* ═══════════════════ Mode → meta ═══════════════════ */

export const MODES = {
  pm: {
    title: 'Табель моей дружины',
    subtitle: 'Чекины моих рабочих по дням месяца',
    kicker: 'РП',
    icon: '👥',
    lockScope: 'pm',
    editableTypes: ['day', 'night', 'waiting'],
    requireWorkFor: ['day', 'night'],
    columns: { points: 'mine', amount: 'none', perDiem: 'none' }, // суточные скрыты везде
    roles: ['PM', 'HEAD_PM']
  },
  warehouse: {
    title: 'Табель учёта работы на складе',
    subtitle: 'Дни работы рабочих на складе',
    kicker: 'Склад',
    icon: '📦',
    lockScope: 'warehouse',
    editableTypes: ['warehouse'],
    requireWorkFor: [],
    // V255: свои отметки — с баллами, чужие — только иконка.
    columns: { points: 'mine', amount: 'none', perDiem: 'none' },
    roles: ['WAREHOUSE']
  },
  medical: {
    title: 'Табель учёта МО',
    subtitle: 'Медосмотры, обучение и корабль',
    kicker: 'ТО',
    icon: '🏥',
    lockScope: 'medical',
    // V255 (23.06.2026): TO/HEAD_TO теперь могут ставить и «Корабль» (альтернатива
    // дороги за повышенную ставку 12 баллов × 500 ₽).
    editableTypes: ['medical', 'ship'],
    requireWorkFor: [],
    // V255: свои отметки — с баллами, чужие — только иконка.
    columns: { points: 'mine', amount: 'none', perDiem: 'none' },
    roles: ['TO', 'HEAD_TO']
  },
  travel: {
    title: 'Табель учёта дороги',
    subtitle: 'Дни в дороге',
    kicker: 'Логистика',
    icon: '✈️',
    lockScope: 'travel',
    // FIX 4 — OFFICE_MANAGER ставит только 'travel'. 'waiting' исключён по ТЗ.
    editableTypes: ['travel'],
    requireWorkFor: [],
    // V255: свои отметки — с баллами, чужие — только иконка.
    columns: { points: 'mine', amount: 'none', perDiem: 'none' },
    roles: ['OFFICE_MANAGER']
  },
  global: {
    title: 'Общий табель — Табель дружины',
    subtitle: 'Все отметки от всех ролей: чекины, склад, МО, дорога, корабль',
    kicker: 'Дружина',
    icon: '📊',
    lockScope: 'global',
    // V255: добавлен 'ship' (Корабль).
    editableTypes: ['day', 'night', 'warehouse', 'medical', 'travel', 'ship', 'waiting'],
    requireWorkFor: ['day', 'night'],
    columns: { points: 'always', amount: 'show', perDiem: 'none' },
    roles: ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'ADMIN', 'BUH', 'HR', 'HR_MANAGER']
  }
};

/**
 * Приоритет mode'ов при выборе по роли: global > pm > warehouse > medical > travel.
 */
export function inferModeFromRole(role) {
  if (!role) return null;
  const order = ['global', 'pm', 'warehouse', 'medical', 'travel'];
  for (const m of order) {
    if (MODES[m].roles.includes(role)) return m;
  }
  return null;
}

/**
 * Может ли роль закрывать/открывать данный scope.
 */
export function canLockScope(role, scope) {
  if (scope === 'pm') return ['PM', 'HEAD_PM'].includes(role);
  if (scope === 'warehouse') return role === 'WAREHOUSE';
  if (scope === 'medical') return ['TO', 'HEAD_TO'].includes(role);
  if (scope === 'travel') return role === 'OFFICE_MANAGER';
  if (scope === 'global') return ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'ADMIN', 'BUH', 'HR', 'HR_MANAGER'].includes(role);
  return false;
}

/**
 * Любой DIRECTOR_* или ADMIN может снять любой лок.
 */
export function canAnyUnlock(role) {
  return ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(role);
}

/* ═══════════════════ Семантика типов клеток (НЕ цветовая тема) ═══════════════════ */

/**
 * TYPE_META — иконка/название/токен фона для каждого типа клетки.
 * FIX 7: переход на единые токены --ts-*-bg/--ts-*-fg (общие с vanilla).
 * Цвета остаются через CSS-переменные (color-gate безопасно).
 */
export const TYPE_META = {
  day:       { icon: '☀️', label: 'День',     short: 'Д',  bgVar: '--ts-day-bg',       fgVar: '--ts-day-fg',       title: 'Дневная смена' },
  night:     { icon: '🌙', label: 'Ночь',     short: 'Н',  bgVar: '--ts-night-bg',     fgVar: '--ts-night-fg',     title: 'Ночная смена' },
  warehouse: { icon: '📦', label: 'Склад',    short: 'Скл',bgVar: '--ts-warehouse-bg', fgVar: '--ts-warehouse-fg', title: 'Работа на складе' },
  medical:   { icon: '🏥', label: 'Медосмотр',short: 'МО', bgVar: '--ts-medical-bg',   fgVar: '--ts-medical-fg',   title: 'Медосмотр' },
  travel:    { icon: '✈️', label: 'Дорога',   short: 'ДР', bgVar: '--ts-travel-bg',    fgVar: '--ts-travel-fg',    title: 'Дорога' },
  // V255 (23.06.2026): «Корабль» — альтернатива «Дороги» за повышенную ставку
  // (12 баллов × 500 ₽). Цветовые токены делим с travel (color-gate безопасно),
  // отличаемся эмодзи 🚢.
  ship:      { icon: '🚢', label: 'Корабль',  short: 'КР', bgVar: '--ts-ship-bg',      fgVar: '--ts-ship-fg',      title: 'Дорога кораблём' },
  waiting:   { icon: '⏰', label: 'Ожидание', short: 'ОЖ', bgVar: '--ts-waiting-bg',   fgVar: '--ts-waiting-fg',   title: 'Ожидание' }
};

export const TYPE_KEYS = Object.keys(TYPE_META);

/* ═══════════════════ Утилиты ═══════════════════ */

export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

export function monthLabel(year, month) {
  return new Date(year, month - 1).toLocaleString('ru-RU', { month: 'long', year: 'numeric' });
}

export function fmtNum(n) {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(n));
}

export function fmtMoney(n) {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
}

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function toIsoDate(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

// FIX 11 — Единая локализованная карта ролей.
// Используется в tooltip, попап-инфо, бейджах.
export const ROLE_LABELS = {
  PM: 'РП',
  HEAD_PM: 'Старший РП',
  TO: 'ТО',
  HEAD_TO: 'Рук. ТО',
  WAREHOUSE: 'Склад',
  OFFICE_MANAGER: 'Офис',
  DIRECTOR_GEN: 'Директор',
  DIRECTOR_COMM: 'Дир. ком.',
  DIRECTOR_DEV: 'Дир. разв.',
  ADMIN: 'Админ',
  BUH: 'Бухгалтер',
  HR: 'HR',
  HR_MANAGER: 'HR-менеджер',
  WORKER: 'Рабочий'
};

export function roleShort(role) {
  return ROLE_LABELS[role] || role || '';
}

/* ═══════════════════ Группировка по объекту ═══════════════════ */

/**
 * Группирует строки по work_title для global И pm mode (FIX 14: vanilla group в pm).
 * Для warehouse/medical/travel — одна группа без заголовка.
 *
 * Источник work для группировки:
 *   1) emp.primary_work_title / emp.work_title (top-level от backend)
 *   2) Самая частая work_title из days[] (если top-level нет)
 *   3) 'Без объекта'
 */
export function groupEmployees(employees, mode) {
  if (mode !== 'global' && mode !== 'pm') {
    return [{ title: '', items: employees }];
  }
  const groups = new Map();
  for (const e of employees) {
    let key = e.primary_work_title || e.work_title || null;
    if (!key && e.days) {
      // Fallback: соберём самую частую work_title из заполненных дней
      const counts = {};
      for (const d of Object.values(e.days)) {
        if (d?.work_title) counts[d.work_title] = (counts[d.work_title] || 0) + 1;
      }
      const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      key = best ? best[0] : null;
    }
    key = key || 'Без объекта';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  return Array.from(groups.entries()).map(([title, items]) => ({ title, items }));
}

/**
 * FIX 5 — Находим work_id для employee:
 *   1) emp.primary_work_id (если backend заполнил для PM-режима)
 *   2) Последний filled-day с work_id
 *   3) null (нужен выбор в модалке)
 */
export function inferWorkIdForEmployee(emp) {
  if (!emp) return null;
  if (emp.primary_work_id) return Number(emp.primary_work_id);
  if (emp.work_id) return Number(emp.work_id);
  if (emp.days) {
    // Берём самый поздний день с work_id
    const entries = Object.entries(emp.days)
      .filter(([_, v]) => v && v.work_id)
      .sort((a, b) => Number(b[0]) - Number(a[0]));
    if (entries.length) return Number(entries[0][1].work_id);
  }
  return null;
}
