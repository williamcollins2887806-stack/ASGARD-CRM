/**
 * Calendar — API helpers (feed + personal CRUD + meetings + availability).
 */
import { api } from '@/api/client';

export const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

export const DAYS_RU_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const DAYS_RU_LONG  = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

export const EVENT_TYPES = [
  { code: 'meeting',  label: 'Совещание',         color: 'var(--blue-l, var(--info))' },
  { code: 'call',     label: 'Звонок',            color: 'var(--purple)' },
  { code: 'visit',    label: 'Встреча с клиентом', color: 'var(--ok)' },
  { code: 'deadline', label: 'Дедлайн',           color: 'var(--red, var(--err))' },
  { code: 'reminder', label: 'Напоминание',       color: 'var(--amber)' },
  { code: 'other',    label: 'Другое',            color: 'var(--t-3)' }
];

export const REMINDER_OPTS = [
  { value: '0',    label: 'Без напоминания' },
  { value: '5',    label: 'За 5 минут' },
  { value: '15',   label: 'За 15 минут' },
  { value: '30',   label: 'За 30 минут' },
  { value: '60',   label: 'За 1 час' },
  { value: '1440', label: 'За 1 день' }
];

export const RECUR_OPTS = [
  { value: 'NONE', label: 'Не повторять' },
  { value: 'DAILY', label: 'Каждый день' },
  { value: 'WEEKLY', label: 'Каждую неделю' },
  { value: 'MONTHLY', label: 'Каждый месяц' }
];

export function eventTypeInfo(code) {
  return EVENT_TYPES.find((t) => t.code === code) || EVENT_TYPES[5];
}

export async function loadEvents({ date_from, date_to } = {}) {
  const p = new URLSearchParams();
  p.set('limit', '500');
  if (date_from) p.set('date_from', date_from);
  if (date_to)   p.set('date_to',   date_to);
  try {
    const r = await api('/api/calendar/feed?' + p.toString());
    return r?.items || r?.events || [];
  } catch {
    const r = await api('/api/calendar?' + p.toString());
    return r?.events || [];
  }
}

export function createEvent(body) {
  return api('/api/calendar', { method: 'POST', body });
}

export function updateEvent(id, body) {
  return api(`/api/calendar/${id}`, { method: 'PUT', body });
}

export function deleteEvent(id) {
  return api(`/api/calendar/${id}`, { method: 'DELETE' });
}

export function createMeeting(body) {
  return api('/api/meetings', { method: 'POST', body });
}

export function updateMeeting(id, body) {
  return api(`/api/meetings/${id}`, { method: 'PUT', body });
}

export function deleteMeeting(id) {
  return api(`/api/meetings/${id}`, { method: 'DELETE' });
}

export function loadUsers() {
  return api('/api/users?limit=500&is_active=true').then((d) => d?.users || []).catch(() => []);
}

export function loadAvailability(userIds, from, to) {
  const q = new URLSearchParams({
    user_ids: userIds.join(','),
    from,
    to
  });
  return api('/api/calendar/availability?' + q.toString());
}

export function findTime(body) {
  return api('/api/calendar/find-time', { method: 'POST', body });
}

export function ymd(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

export function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

export function firstDayOfWeek(year, month) {
  const d = new Date(year, month, 1).getDay();
  return d === 0 ? 6 : d - 1;
}

export function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const shift = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - shift);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function formatHumanDate(d) {
  const x = d instanceof Date ? d : new Date(d);
  try {
    return x.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return ''; }
}

export function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

export function groupByDate(events) {
  const m = {};
  for (const e of events) {
    const key = String(e.date || '').slice(0, 10);
    if (!key) continue;
    (m[key] = m[key] || []).push(e);
  }
  for (const k of Object.keys(m)) {
    m[k].sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
  }
  return m;
}

export function defaultEnd(time) {
  const [h, m] = String(time || '10:00').split(':').map(Number);
  return `${String(Math.min(23, (h || 10) + 1)).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;
}
