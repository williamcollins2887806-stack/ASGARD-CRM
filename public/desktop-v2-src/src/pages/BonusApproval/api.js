/**
 * API-клиент страницы /bonus-approval.
 * Источник: vanilla `public/assets/js/bonus_approval.js` (576 строк, AsgardBonusApproval).
 *
 * Бэкенд:
 *   GET    /api/data/bonus_requests?limit=...   — список заявок на премии
 *   GET    /api/data/bonus_requests/:id         — одна заявка
 *   POST   /api/data/bonus_requests             — создать (PM)
 *   POST   /api/approval/bonus_requests/:id/approve    — директор согласовывает
 *   POST   /api/approval/bonus_requests/:id/rework     — на доработку (с комментарием)
 *   POST   /api/approval/bonus_requests/:id/question   — вопрос (с комментарием)
 *   POST   /api/approval/bonus_requests/:id/reject     — отклонить (с комментарием)
 *   GET    /api/works?limit=2000                  — список работ
 *   GET    /api/data/employee_assignments?work_id=…  — рабочие на работе
 *   GET    /api/data/employees                   — справочник рабочих
 *   GET    /api/users?role=…                     — список РП
 */
import { api } from '@/api/client';

export const BONUS_STATUSES = {
  draft:    { label: 'Черновик',         tone: 'draft' },
  pending:  { label: 'На согласовании',  tone: 'sent' },
  sent:     { label: 'На согласовании',  tone: 'sent' },
  approved: { label: 'Согласовано',      tone: 'approved' },
  rejected: { label: 'Отклонено',        tone: 'rejected' },
  question: { label: 'Вопрос',           tone: 'question' },
  rework:   { label: 'На доработке',     tone: 'question' }
};

export const STATUS_OPTIONS = [
  { value: '',         label: 'Все статусы' },
  { value: 'pending',  label: 'На согласовании' },
  { value: 'approved', label: 'Согласовано' },
  { value: 'rejected', label: 'Отклонено' },
  { value: 'question', label: 'Вопрос' },
  { value: 'rework',   label: 'На доработке' }
];

export function statusMeta(status) {
  return BONUS_STATUSES[status] || { label: status || '—', tone: 'draft' };
}

/** Список всех заявок на премии (бэк: generic /api/data) */
export function loadRequests() {
  return api('/api/data/bonus_requests?limit=2000&orderBy=created_at&desc=true')
    .then((d) => d.bonus_requests || d.items || [])
    .catch(() => []);
}

/** Список работ для выбора в форме создания заявки */
export function loadWorks() {
  return api('/api/works?limit=2000')
    .then((d) => d.works || d.items || [])
    .catch(() => []);
}

/** Рабочие, назначенные на работу */
export function loadAssignments(workId) {
  return api(`/api/data/employee_assignments?where=${encodeURIComponent(JSON.stringify({ work_id: Number(workId) }))}&limit=2000`)
    .then((d) => d.employee_assignments || d.items || [])
    .catch(() => []);
}

/** Справочник рабочих (employees) */
export function loadEmployees() {
  return api('/api/data/employees?limit=2000')
    .then((d) => d.employees || d.items || [])
    .catch(() => []);
}

/** Создать заявку на премию */
export function createBonusRequest(payload) {
  return api('/api/data/bonus_requests', { method: 'POST', body: payload });
}

/** Действия согласования */
export function approveBonus(id, comment = '') {
  return api(`/api/approval/bonus_requests/${id}/approve`, { method: 'POST', body: { comment } });
}
export function reworkBonus(id, comment) {
  return api(`/api/approval/bonus_requests/${id}/rework`, { method: 'POST', body: { comment } });
}
export function questionBonus(id, comment) {
  return api(`/api/approval/bonus_requests/${id}/question`, { method: 'POST', body: { comment } });
}
export function rejectBonus(id, comment) {
  return api(`/api/approval/bonus_requests/${id}/reject`, { method: 'POST', body: { comment } });
}

/**
 * Отправить telegram-уведомление в подсистему согласований.
 * Эквивалент vanilla bonus_approval.js:257,525 — fetch POST /api/notifications/approval.
 * Поля:
 *   type:     'bonus' (для премий)
 *   action:   'created' | 'approved' | 'rejected' | 'rework' | 'question'
 *   entityId: id заявки
 *   toUserId: id получателя (директор для created, РП для решения)
 *   details:  текст для бота (имена, суммы, причина)
 *
 * Ошибки игнорируем — это вспомогательный канал.
 */
export function notifyApproval({ type = 'bonus', action, entityId, toUserId, details = '' }) {
  return api('/api/notifications/approval', {
    method: 'POST',
    body: { type, action, entityId, toUserId, details }
  }).catch(() => null);
}

/** Безопасно распаковать bonuses из строки/массива/JSONB */
export function parseBonuses(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) || []; } catch { return []; }
  }
  if (typeof raw === 'object') return raw.bonuses || [];
  return [];
}

export function fmtMoney(n) {
  if (n === null || n === undefined || n === '') return '—';
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(num)) + ' ₽';
}

export function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
}

export function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function filterByStatus(items, status) {
  if (!status) return items;
  return items.filter((r) => (r.status || r.approval_status) === status);
}

export function filterByQuery(items, q) {
  if (!q || !q.trim()) return items;
  const lq = q.trim().toLowerCase();
  return items.filter((r) =>
    (r.work_title || '').toLowerCase().includes(lq) ||
    (r.pm_name || '').toLowerCase().includes(lq) ||
    (r.comment || '').toLowerCase().includes(lq) ||
    String(r.id).includes(lq)
  );
}
