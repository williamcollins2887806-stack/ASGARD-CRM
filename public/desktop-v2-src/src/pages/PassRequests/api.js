/**
 * API-клиент страницы /pass-requests — Заявки на пропуск.
 *
 * Backend: `src/routes/pass_requests.js`, prefix `/api/pass-requests`.
 *
 * Endpoints:
 *   GET    /api/pass-requests                   — список
 *   GET    /api/pass-requests/:id               — детали
 *   POST   /api/pass-requests                   — создать
 *   PUT    /api/pass-requests/:id               — обновить
 *   DELETE /api/pass-requests/:id               — удалить (только draft, ADMIN)
 *   PUT    /api/pass-requests/:id/status        — сменить статус
 *   GET    /api/pass-requests/:id/pdf           — PDF (через blob + Authorization header)
 *
 * Связано:
 *   GET /api/works?limit=2000           — список работ (привязка)
 *   GET /api/staff/employees?limit=2000 — список рабочих
 *   GET /api/customers?limit=1000       — заказчики (для name)
 */
import { api } from '@/api/client';

export const WRITE_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN'];

export const STATUS_MAP = {
  draft:     { label: 'Черновик', tone: 'draft' },
  submitted: { label: 'Подана',   tone: 'sent' },
  approved:  { label: 'Одобрена', tone: 'approved' },
  rejected:  { label: 'Отклонена', tone: 'rejected' },
  issued:    { label: 'Выдан',    tone: 'paid' },
  expired:   { label: 'Просрочен', tone: 'rework' }
};

export const STATUS_FILTERS = [
  { value: '',          label: 'Все статусы' },
  { value: 'draft',     label: 'Черновики' },
  { value: 'submitted', label: 'Поданы' },
  { value: 'approved',  label: 'Одобрены' },
  { value: 'rejected',  label: 'Отклонены' },
  { value: 'issued',    label: 'Выданы' },
  { value: 'expired',   label: 'Просрочены' }
];

export function describeStatus(code) {
  return STATUS_MAP[code] || STATUS_MAP.draft;
}

export function getToken() {
  try { return localStorage.getItem('asgard_token') || ''; } catch { return ''; }
}

export function loadList() {
  return api('/api/pass-requests?limit=2000').then(
    (d) => d.items || d.rows || []
  );
}

export function loadOne(id) {
  return api('/api/pass-requests/' + id).then((d) => d.item || d);
}

export function createRequest(payload) {
  return api('/api/pass-requests', { method: 'POST', body: payload }).then((d) => d.item || d);
}

export function updateRequest(id, payload) {
  return api('/api/pass-requests/' + id, { method: 'PUT', body: payload }).then((d) => d.item || d);
}

export function changeStatus(id, status) {
  return api(`/api/pass-requests/${id}/status`, {
    method: 'PUT',
    body: { status }
  }).then((d) => d.item || d);
}

export function deleteRequest(id) {
  return api('/api/pass-requests/' + id, { method: 'DELETE' });
}

export function loadWorks() {
  return api('/api/works?limit=2000').then((d) => d.works || d.items || []);
}

export function loadEmployees() {
  return api('/api/staff/employees?limit=2000').then(
    (d) => (d.employees || d.items || d.rows || []).map((e) => ({
      id: e.id,
      name: e.full_name || e.fio || e.name || [e.last_name, e.first_name].filter(Boolean).join(' ') || ('Сотрудник #' + e.id),
      passport: e.passport || '',
      position: e.position || ''
    }))
  );
}

export function loadCustomers() {
  return api('/api/customers?limit=1000').then(
    (d) => d.customers || d.items || []
  );
}

export async function downloadPdf(id) {
  const { openProtected } = await import('@/api/download');
  return openProtected(`/api/pass-requests/${id}/pdf`, `pass_request_${id}.pdf`);
}

export function fmtDate(s) {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString('ru-RU'); }
  catch { return String(s).slice(0, 10); }
}

export function fmtDateRange(from, to) {
  const a = fmtDate(from);
  const b = fmtDate(to);
  if (a === '—' && b === '—') return '—';
  return a + ' — ' + b;
}

export function filterByQuery(list, q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return list;
  return list.filter((r) =>
    String(r.object_name || '').toLowerCase().includes(s) ||
    String(r.contact_person || '').toLowerCase().includes(s) ||
    String(r.notes || '').toLowerCase().includes(s) ||
    String(r.work_title || '').toLowerCase().includes(s)
  );
}
