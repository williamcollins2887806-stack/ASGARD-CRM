/**
 * TasksAdmin — API helpers.
 *
 * Backend: src/routes/tasks.js (RBAC: requirePermission 'tasks_admin').
 *   GET    /api/tasks/all?status=&assignee_id=&creator_id=&limit=&offset= → {tasks:[]}
 *   GET    /api/tasks/stats                                  → агрегаты (текущего пользователя — vanilla смешивает stats и tasks/all)
 *   GET    /api/tasks/:id                                    → {task}
 *   POST   /api/tasks                                        → {task}      (assignee_id, title, description, deadline, priority, creator_comment)
 *   POST   /api/tasks/:id/files (multipart)                  → {files:[]}
 *   PUT    /api/tasks/:id                                    → редактирование (title/description/deadline/priority/creator_comment)
 *   PUT    /api/tasks/:id/status   {status, comment?}        → смена статуса (эскалация / отмена)
 *   PUT    /api/tasks/:id/accept                             → принять
 *   PUT    /api/tasks/:id/start                              → начать
 *   PUT    /api/tasks/:id/complete {comment?}                → завершить
 *   DELETE /api/tasks/:id                                    → удалить
 *   GET    /api/users?is_active=true&limit=500               → исполнители/создатели
 */
import { api } from '@/api/client';

export const TASKS_ADMIN_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_PM', 'HEAD_TO'];

export function canAdminTasks(role) {
  return TASKS_ADMIN_ROLES.includes(role);
}

/**
 * GET /api/tasks/stats — статистика задач (текущего пользователя).
 * В админ-странице не основной источник KPI (мы считаем на клиенте по /all),
 * но используется как fallback / для пользовательской диагностики.
 */
export function loadTasksStats() {
  return api('/api/tasks/stats').catch(() => null);
}

export async function loadAllTasks(filters = {}) {
  const qs = new URLSearchParams();
  if (filters.status)      qs.set('status', filters.status);
  if (filters.assignee_id) qs.set('assignee_id', String(filters.assignee_id));
  if (filters.creator_id)  qs.set('creator_id',  String(filters.creator_id));
  qs.set('limit',  String(filters.limit  || 500));
  qs.set('offset', String(filters.offset || 0));
  const r = await api('/api/tasks/all?' + qs.toString());
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

export function changeTaskStatus(id, status, comment) {
  return api(`/api/tasks/${id}/status`, { method: 'PUT', body: { status, comment: comment || null } });
}

export async function uploadTaskFiles(id, files) {
  const token = (typeof localStorage !== 'undefined') ? localStorage.getItem('asgard_token') : '';
  const form = new FormData();
  Array.from(files).forEach((f) => form.append('files', f, f.name));
  const r = await fetch(`/api/tasks/${id}/files`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: form
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error('HTTP ' + r.status + ': ' + (text || r.statusText));
  }
  return r.json();
}

/* ── Константы статусов / приоритетов (vanilla tasks_admin.js маппинг) ─────────── */

export const STATUS_LABELS = {
  new:         'Новая',
  accepted:    'Принята',
  in_progress: 'В работе',
  done:        'Выполнена',
  overdue:     'Просрочена',
  cancelled:   'Отменена'
};

export const STATUS_CLASS = {
  new:         'st-new',
  accepted:    'st-accepted',
  in_progress: 'st-progress',
  done:        'st-done',
  overdue:     'st-overdue',
  cancelled:   'st-cancelled'
};

export const PRIORITY_LABELS = {
  low:    'Низкий',
  normal: 'Обычный',
  high:   'Высокий',
  urgent: 'Срочно'
};

export const PRIORITY_CLASS = {
  urgent: 'p-urgent',
  high:   'p-high',
  normal: 'p-normal',
  low:    'p-low'
};

/* ── Хелперы ─────────────────────────────────────────────────────────────────── */

export function isOverdue(deadline, status) {
  if (!deadline) return false;
  if (status === 'done' || status === 'cancelled') return false;
  try { return new Date(deadline) < new Date(); } catch { return false; }
}

export function formatDate(val) {
  if (!val) return '';
  try { return new Date(val).toLocaleDateString('ru-RU'); } catch { return ''; }
}

export function formatDateTime(val) {
  if (!val) return '';
  try {
    return new Date(val).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch { return ''; }
}

/* Эффективный статус: если deadline < now и не выполнено — overdue.
   Vanilla показывала отдельный счётчик overdue в KPI. */
export function effectiveStatus(task) {
  if (task.status === 'done' || task.status === 'cancelled') return task.status;
  if (isOverdue(task.deadline, task.status)) return 'overdue';
  return task.status;
}

/* Агрегаты по списку — для KPI (vanilla смешивает stats и /all, мы считаем по /all) */
export function buildKpi(tasks) {
  const k = { total: 0, new: 0, accepted: 0, in_progress: 0, done: 0, overdue: 0, cancelled: 0 };
  for (const t of tasks) {
    k.total += 1;
    const s = effectiveStatus(t);
    if (s === 'new')         k.new += 1;
    else if (s === 'accepted')    k.accepted += 1;
    else if (s === 'in_progress') k.in_progress += 1;
    else if (s === 'done')        k.done += 1;
    else if (s === 'overdue')     k.overdue += 1;
    else if (s === 'cancelled')   k.cancelled += 1;
  }
  k.active = k.accepted + k.in_progress;
  return k;
}

/* Матрица РП × статус — для overview-таблицы */
export function buildAssigneeMatrix(tasks, assigneesById) {
  const rows = new Map();
  for (const t of tasks) {
    const aid = t.assignee_id || 0;
    if (!rows.has(aid)) {
      const u = assigneesById[aid];
      rows.set(aid, {
        assignee_id: aid,
        assignee_name: t.assignee_name || u?.name || u?.login || (aid ? `#${aid}` : '— без исполнителя —'),
        assignee_role: t.assignee_role || u?.role || '',
        new: 0, accepted: 0, in_progress: 0, done: 0, overdue: 0, cancelled: 0, total: 0
      });
    }
    const r = rows.get(aid);
    r.total += 1;
    const s = effectiveStatus(t);
    if (s in r) r[s] += 1;
  }
  return [...rows.values()].sort((a, b) => (b.total - a.total) || a.assignee_name.localeCompare(b.assignee_name));
}
