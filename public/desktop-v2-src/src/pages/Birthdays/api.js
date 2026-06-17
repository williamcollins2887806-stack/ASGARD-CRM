/**
 * Birthdays — API helpers.
 *
 * Backend: на проде нет dedicated /api/birthdays — берём через `/api/users` (офис) и
 * `/api/staff/employees` (рабочие). Считаем «ближайший ДР» на клиенте.
 */
import { api } from '@/api/client';

export async function loadOfficeUsers() {
  // /api/users возвращает {users:[...], total}. Все активные с birth_date.
  const r = await api('/api/users?is_active=true&limit=2000');
  return (r?.users || []).filter((u) => u && u.is_active);
}

export async function loadWorkers() {
  // /api/staff/employees возвращает {employees:[...]} рабочих.
  const r = await api('/api/staff/employees?limit=2000');
  return r?.employees || [];
}

/* ── Утилиты дат для дней рождения ────────────────────────────────── */

function toDateYMD(ymd) {
  const s = String(ymd || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0));
}

function dayKeyLocal(dt) {
  const d = dt instanceof Date ? dt : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

export function nextBirthday(birth_ymd, now = new Date()) {
  const b = toDateYMD(birth_ymd);
  if (!b) return null;
  const mm = b.getUTCMonth() + 1;
  const dd = b.getUTCDate();
  const y = now.getFullYear();
  const thisYear = toDateYMD(`${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`);
  if (!thisYear) return null;
  const today = toDateYMD(dayKeyLocal(now));
  if (!today) return thisYear;
  if (thisYear.getTime() >= today.getTime()) return thisYear;
  return toDateYMD(`${y + 1}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`);
}

export function diffDaysUTC(a, b) {
  if (!a || !b) return null;
  return Math.floor((b.getTime() - a.getTime()) / (24 * 3600 * 1000));
}

/**
 * Возвращает {nearest:[], byMonth:Map<int,[]>} для списка сотрудников.
 * @param items массив сотрудников
 * @param birthField — название поля с датой рождения (для users — 'birth_date')
 * @param getName / getRole — функции-извлекатели для отображения
 */
export function buildBirthdayData(items, birthField, getName, getRole) {
  const todayUTC = toDateYMD(dayKeyLocal(new Date()));
  const rows = [];
  for (const it of items || []) {
    if (!it) continue;
    const bd = it[birthField];
    if (!bd) continue;
    const nb = nextBirthday(bd);
    if (!nb || !todayUTC) continue;
    const days = diffDaysUTC(todayUTC, nb);
    if (days == null) continue;
    rows.push({ it, nb, days });
  }
  rows.sort((a, b) =>
    a.days - b.days ||
    String(getName(a.it) || '').localeCompare(String(getName(b.it) || ''), 'ru')
  );

  const nearest = rows.slice(0, 12);

  const byMonth = new Map();
  for (const r of rows) {
    const bd = toDateYMD(r.it[birthField]);
    if (!bd) continue;
    const m = bd.getUTCMonth() + 1;
    const d = bd.getUTCDate();
    const arr = byMonth.get(m) || [];
    arr.push({
      id: r.it.id,
      d,
      name: getName(r.it),
      role: getRole(r.it),
      birth_date: r.it[birthField],
      raw: r.it,
      days: r.days
    });
    byMonth.set(m, arr);
  }
  for (const arr of byMonth.values()) {
    arr.sort((a, b) => a.d - b.d || String(a.name || '').localeCompare(String(b.name || ''), 'ru'));
  }

  return { nearest, byMonth, total: rows.length };
}

export function isDirectorRole(role) {
  const r = String(role || '');
  return r === 'DIRECTOR' || r.startsWith('DIRECTOR_');
}

export const MONTH_NAMES_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

/* Отправка поздравления — создаём уведомление на пользователя.
   Для сотрудников-рабочих (employees) у нас нет user_id, поздравить через CRM нельзя — поэтому
   функция работает только для офисных пользователей (когда есть users.id). */
export async function congratulate(userId, name, customMessage) {
  if (!userId) throw new Error('Нет user_id — нельзя отправить через CRM');
  const message = customMessage?.trim()
    || `${name}, поздравляем с днём рождения! 🎂`;
  return api('/api/notifications', {
    method: 'POST',
    body: {
      user_id: userId,
      title: '🎂 С днём рождения!',
      message,
      type: 'congrats',
      link: '#/home'
    }
  });
}
