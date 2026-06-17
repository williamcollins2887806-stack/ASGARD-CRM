/**
 * API-клиент страницы /office-schedule.
 * Источник истины — vanilla `public/assets/js/office_schedule.js`.
 *
 * Endpoint'ы (через универсальный `/api/data/<table>`):
 *   GET    /api/data/staff?limit=500       — список сотрудников расписания
 *   GET    /api/data/staff_plan?limit=10000 — все статусы дней
 *   POST   /api/data/staff_plan            — добавить статус дня
 *   PUT    /api/data/staff_plan/:id        — обновить статус дня
 *   DELETE /api/data/staff_plan/:id        — удалить статус дня
 *   GET    /api/data/users?limit=500       — для seed: добавить новых активных пользователей
 *   POST   /api/data/staff                 — seed: создать запись staff для нового user
 */
import { api } from '@/api/client';

export const STATUS = [
  { code: 'оф', label: 'В офисе',             color: 'var(--blue-l)' },
  { code: 'уд', label: 'Удалёнка',            color: '#0ea5e9' },
  { code: 'об', label: 'На объекте',          color: '#22C55E' },
  { code: 'бн', label: 'На больничном',       color: 'var(--err-t)' },
  { code: 'сс', label: 'За свой счёт',        color: 'var(--amber)' },
  { code: 'км', label: 'Командировка',        color: 'var(--purple)' },
  { code: 'пг', label: 'Встреча/переговоры',  color: 'var(--ok-t)' },
  { code: 'уч', label: 'Учёба',               color: 'var(--ok)' },
  { code: 'ск', label: 'Склад',               color: 'var(--t-2)' },
  { code: 'вх', label: 'Выходной',            color: '#334155' }
];

export const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

const SKIP_LOGIN_PREFIX = 'test_';
const SKIP_ROLES = new Set(['BOT', 'ADMIN', 'FIELD_WORKER']);
const SKIP_LOGINS = new Set(['mimir_bot']);

export function ymd(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const dd = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function isWeekend(dateObj) {
  const gd = dateObj.getDay();
  return gd === 0 || gd === 6;
}

export function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

export async function loadStaff() {
  const d = await api('/api/data/staff?limit=500');
  const list = d.staff || d.items || d.rows || [];
  return list.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru'));
}

export async function loadUsers() {
  const d = await api('/api/data/users?limit=500');
  return d.users || d.items || d.rows || [];
}

export async function loadPlan(_startIso, _endIso) {
  // На бэке /data универсальный CRUD без фильтра по дате — берём всё и режем на клиенте.
  const d = await api('/api/data/staff_plan?limit=10000');
  return d.staff_plan || d.items || d.rows || [];
}

export async function ensureStaffSeed() {
  const [staff, users] = await Promise.all([loadStaff(), loadUsers()]);
  const existing = new Set(staff.map((s) => s.user_id));
  const toAdd = users.filter((u) => {
    if (!u.is_active) return false;
    if (SKIP_ROLES.has(String(u.role || ''))) return false;
    if (SKIP_LOGINS.has(String(u.login || ''))) return false;
    if (String(u.login || '').startsWith(SKIP_LOGIN_PREFIX)) return false;
    return !existing.has(u.id);
  });
  for (const u of toAdd) {
    try {
      await api('/api/data/staff', {
        method: 'POST',
        body: {
          user_id: u.id,
          name: u.name || u.login,
          role_tag: u.role || '',
          created_at: new Date().toISOString()
        }
      });
    } catch (_) { /* игнорируем дубликаты */ }
  }
  // Если что-то добавили — перечитываем
  if (toAdd.length) {
    return loadStaff();
  }
  return staff;
}

export async function upsertPlan(staffId, dateIso, code, allPlans) {
  const existing = (allPlans || []).find(
    (p) => p.staff_id === staffId && ymd(p.date) === dateIso
  );
  if (existing) {
    if (code) {
      return api('/api/data/staff_plan/' + existing.id, {
        method: 'PUT',
        body: { status_code: code, updated_at: new Date().toISOString() }
      });
    }
    return api('/api/data/staff_plan/' + existing.id, { method: 'DELETE' });
  }
  if (code) {
    return api('/api/data/staff_plan', {
      method: 'POST',
      body: {
        staff_id: staffId,
        date: dateIso,
        status_code: code,
        updated_at: new Date().toISOString()
      }
    });
  }
  return null;
}

/* ── Цветовые утилиты (точная копия из vanilla) ─────────────────────────── */
function resolveColor(col) {
  if (!col || !String(col).includes('var(')) return col;
  const el = document.createElement('div');
  el.style.color = col;
  document.body.appendChild(el);
  const resolved = getComputedStyle(el).color;
  el.remove();
  return resolved;
}

function parseToRGB(col) {
  if (!col) return null;
  let c = String(col).trim();
  if (!c) return null;
  if (c.includes('var(')) c = resolveColor(c);
  if (/^rgba?\(/i.test(c)) {
    const m = c.match(/rgba?\(([^)]+)\)/i);
    if (!m) return null;
    const parts = m[1].split(',').map((x) => x.trim());
    const r = parseFloat(parts[0]), g = parseFloat(parts[1]), b = parseFloat(parts[2]);
    if ([r, g, b].some((v) => Number.isNaN(v))) return null;
    return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
  }
  if (c[0] === '#') c = c.slice(1);
  if (c.length === 3) c = c.split('').map((ch) => ch + ch).join('');
  if (c.length !== 6) return null;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return null;
  return { r, g, b };
}

export function toRGBA(col, a) {
  const rgb = parseToRGB(col);
  if (!rgb) return `rgba(148,163,184,${a})`;
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
}

export function isDirectorRole(r) {
  const s = String(r || '');
  return s === 'DIRECTOR' || s.startsWith('DIRECTOR_');
}
