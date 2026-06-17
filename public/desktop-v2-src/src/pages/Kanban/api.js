/**
 * Kanban — API helpers.
 *
 * Backend: src/routes/tasks.js — endpoints:
 *   GET    /api/tasks/kanban?priority=&assignee_id=    → { columns: {new,in_progress,review,done}, tasks }
 *   PUT    /api/tasks/:id/move                         → перенос в колонку { column, position }
 *   GET    /api/tasks/:id                              → детали задачи { task }
 *   PUT    /api/tasks/:id/acknowledge                  → подтверждение ознакомления
 *   GET    /api/tasks/:id/comments                     → { comments:[] }
 *   POST   /api/tasks/:id/comments                     → { comment }
 *   POST   /api/tasks/:id/watch                        → подписаться (наблюдатель)
 *   DELETE /api/tasks/:id/watch                        → отписаться
 *   GET    /api/users?is_active=true                   → для фильтра «исполнитель»
 */
import { api } from '@/api/client';

/* ── Константы ──────────────────────────────────────────────────────────── */

export const COLUMNS = [
  { id: 'new',         label: 'Новые',       icon: '📥', tone: 'info'   },
  { id: 'in_progress', label: 'В работе',    icon: '🔄', tone: 'orange' },
  { id: 'review',      label: 'На проверке', icon: '👁',  tone: 'purple' },
  { id: 'done',        label: 'Готово',      icon: '✅', tone: 'ok'     }
];

export const PRIORITIES = {
  low:    { label: 'Низкий',   icon: '🟢', cls: 'p-low'    },
  normal: { label: 'Обычный',  icon: '🔵', cls: 'p-normal' },
  high:   { label: 'Высокий',  icon: '🟠', cls: 'p-high'   },
  urgent: { label: 'Срочный',  icon: '🔴', cls: 'p-urgent' }
};

/* ── Endpoints ──────────────────────────────────────────────────────────── */

export async function loadKanban(filters = {}) {
  const qs = new URLSearchParams();
  Object.entries(filters || {}).forEach(([k, v]) => {
    if (v !== '' && v != null) qs.set(k, String(v));
  });
  const r = await api('/api/tasks/kanban' + (qs.toString() ? '?' + qs.toString() : ''));
  // Backend гарантирует columns по KANBAN_COLUMNS, нормализуем на всякий случай
  const columns = {};
  for (const c of COLUMNS) columns[c.id] = (r?.columns?.[c.id] || []);
  return { columns, tasks: r?.tasks || [] };
}

export function moveTask(taskId, column, position = 0) {
  return api(`/api/tasks/${taskId}/move`, { method: 'PUT', body: { column, position } });
}

export async function loadTask(taskId) {
  const r = await api(`/api/tasks/${taskId}`);
  return r?.task || null;
}

export function acknowledgeTask(taskId) {
  return api(`/api/tasks/${taskId}/acknowledge`, { method: 'PUT' });
}

export async function loadComments(taskId) {
  const r = await api(`/api/tasks/${taskId}/comments`);
  return r?.comments || [];
}

export function addComment(taskId, text) {
  return api(`/api/tasks/${taskId}/comments`, { method: 'POST', body: { text } });
}

export function watchTask(taskId) {
  return api(`/api/tasks/${taskId}/watch`, { method: 'POST', body: {} });
}

export function unwatchTask(taskId) {
  return api(`/api/tasks/${taskId}/watch`, { method: 'DELETE' });
}

export async function loadUsers() {
  const r = await api('/api/users?is_active=true&limit=500').catch(() => ({}));
  return r?.users || r?.items || [];
}

/* ── Хелперы ────────────────────────────────────────────────────────────── */

export function initialsOf(name) {
  if (!name) return '??';
  return name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

export function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ru-RU');
}

export function fmtDateTime(s) {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ru-RU');
}

export function deadlineTone(deadline, status) {
  if (!deadline) return null;
  if (status === 'done' || status === 'completed') return null;
  const t = new Date(deadline).getTime();
  if (!Number.isFinite(t)) return null;
  const now = Date.now();
  if (t < now) return 'overdue';
  if (t - now < 24 * 3600 * 1000) return 'soon';
  return null;
}
