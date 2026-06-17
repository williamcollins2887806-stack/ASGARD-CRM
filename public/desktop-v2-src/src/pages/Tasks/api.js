/**
 * Tasks — API helpers.
 *
 * Backend: src/routes/tasks.js — endpoints:
 *   GET    /api/tasks/my?status=        →  {tasks:[]}  — мои назначенные
 *   GET    /api/tasks/created?status=   →  {tasks:[]}  — мои поручения (tasks_admin)
 *   POST   /api/tasks                   →  {task}      — создать (tasks_admin: ADMIN/DIRECTOR_*)
 *   PUT    /api/tasks/:id/accept        →  принять
 *   PUT    /api/tasks/:id/start         →  начать
 *   PUT    /api/tasks/:id/complete      →  завершить (+comment)
 *   PUT    /api/tasks/:id               →  редактировать (создателю)
 *   DELETE /api/tasks/:id               →  удалить
 *   GET    /api/tasks/todo              →  {items:[]} — мой todo
 *   POST   /api/tasks/todo              →  добавить
 *   PUT    /api/tasks/todo/:id/toggle   →  отметить
 *   PUT    /api/tasks/todo/:id          →  отредактировать
 *   DELETE /api/tasks/todo/:id          →  удалить
 *   GET    /api/users?is_active=true    →  для выбора исполнителя
 */
import { api } from '@/api/client';

export const DIRECTOR_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

export function isDirector(role) {
  return DIRECTOR_ROLES.includes(role);
}

export async function loadMyTasks({ status } = {}) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const r = await api('/api/tasks/my' + qs);
  return r?.tasks || [];
}

export async function loadCreatedTasks({ status } = {}) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const r = await api('/api/tasks/created' + qs);
  return r?.tasks || [];
}

export async function loadAssignees() {
  const r = await api('/api/users?is_active=true&limit=500');
  return r?.users || [];
}

export function createTask(body) {
  return api('/api/tasks', { method: 'POST', body });
}

export function updateTask(id, body) {
  return api(`/api/tasks/${id}`, { method: 'PUT', body });
}

export function deleteTask(id) {
  return api(`/api/tasks/${id}`, { method: 'DELETE' });
}

export function acceptTask(id) {
  return api(`/api/tasks/${id}/accept`, { method: 'PUT' });
}

export function startTask(id) {
  return api(`/api/tasks/${id}/start`, { method: 'PUT' });
}

export function completeTask(id, comment) {
  return api(`/api/tasks/${id}/complete`, { method: 'PUT', body: { comment: comment || null } });
}

/* ── To-Do list endpoints (личный список задач) ─────────────────── */

export async function loadTodo() {
  const r = await api('/api/tasks/todo');
  return r?.items || [];
}

export function addTodoItem(text) {
  return api('/api/tasks/todo', { method: 'POST', body: { text } });
}

export function toggleTodoItem(id) {
  return api(`/api/tasks/todo/${id}/toggle`, { method: 'PUT', body: {} });
}

export function editTodoItem(id, text) {
  return api(`/api/tasks/todo/${id}`, { method: 'PUT', body: { text } });
}

export function deleteTodoItem(id) {
  return api(`/api/tasks/todo/${id}`, { method: 'DELETE' });
}

/* ── Константы статусов / приоритетов ─────────────────────────── */

export const STATUS_LABELS = {
  new:         'Новая',
  accepted:    'Принята',
  in_progress: 'В работе',
  done:        'Выполнена',
  overdue:     'Просрочена',
  cancelled:   'Отменена',
  pending:     'Ожидает',
  completed:   'Завершена'
};

export const STATUS_CLASS = {
  new:         'st-new',
  accepted:    'st-accepted',
  in_progress: 'st-progress',
  done:        'st-done',
  completed:   'st-done',
  overdue:     'st-overdue',
  cancelled:   'st-cancelled',
  pending:     'st-new'
};

export const PRIORITY_LABELS = {
  low:    'Низкий',
  normal: 'Обычный',
  high:   'Высокий',
  urgent: 'Срочный'
};

export const PRIORITY_CLASS = {
  urgent: 'p-urgent',
  high:   'p-high',
  normal: 'p-normal',
  low:    'p-low'
};

/* ── Хелперы дат ──────────────────────────────────────────────── */

export function isOverdue(deadline) {
  if (!deadline) return false;
  try { return new Date(deadline) < new Date(); } catch { return false; }
}

export function formatDate(val) {
  if (!val) return '';
  try { return new Date(val).toLocaleDateString('ru-RU'); } catch { return ''; }
}

export function formatDateTime(val) {
  if (!val) return '';
  try { return new Date(val).toLocaleString('ru-RU'); } catch { return ''; }
}
