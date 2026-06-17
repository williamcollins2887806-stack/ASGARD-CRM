/**
 * Help — API helpers для модуля «Помощь коллеги».
 *
 * Backend: src/routes/tasks.js (расширен миграцией V212):
 *   POST   /api/tasks                     {task_kind:'help', assignee_id, watcher_ids[], title, ...}
 *   GET    /api/tasks/help/inbox          мои help-задачи (assignee)
 *   GET    /api/tasks/help/outbox         мои help-задачи (creator)
 *   GET    /api/tasks/help/watching       где я наблюдатель
 *   GET    /api/tasks/help/stats          счётчики
 *   GET    /api/tasks/:id                 деталь
 *   POST   /api/tasks/:id/files           upload
 *   PUT    /api/tasks/:id/accept          assignee
 *   PUT    /api/tasks/:id/complete        assignee, {comment}
 *   PUT    /api/tasks/:id/decline         assignee, {reason} → status=declined
 *   PUT    /api/tasks/:id/redirect        assignee, {new_assignee_id, reason} — 1 раз
 *   PUT    /api/tasks/:id/reassign        creator, {new_assignee_id} — только если declined
 *   PUT    /api/tasks/:id/escalate        creator → HEAD_* отдела assignee
 *   POST   /api/tasks/:id/watchers/bulk   {user_ids[]}
 *   GET    /api/tasks/:id/comments
 *   POST   /api/tasks/:id/comments        {text}
 */
import { api } from '@/api/client';

export const STATUS_LABELS = {
  new:         'Новая',
  accepted:    'Принята',
  in_progress: 'В работе',
  done:        'Завершена',
  declined:    'Отказ',
  overdue:     'Просрочена',
  cancelled:   'Отменена'
};

export const STATUS_CLASS = {
  new:         'help-st-new',
  accepted:    'help-st-accepted',
  in_progress: 'help-st-progress',
  done:        'help-st-done',
  declined:    'help-st-declined',
  overdue:     'help-st-overdue',
  cancelled:   'help-st-cancelled'
};

export const PRIORITY_LABELS = {
  low:    'Низкий',
  normal: 'Обычно',
  high:   '⚠️ Важно',
  urgent: '🔥 Горит'
};

export const PRIORITY_CLASS = {
  urgent: 'help-p-urgent',
  high:   'help-p-high',
  normal: 'help-p-normal',
  low:    'help-p-low'
};

export const DEADLINE_PRESETS = [
  { key: '2h',  label: '🔥 2 часа',  ms: 2 * 3600 * 1000 },
  { key: 'today', label: '📅 Сегодня к 18:00', resolve: () => {
    const d = new Date(); d.setHours(18,0,0,0);
    return d > new Date() ? d.toISOString() : new Date(Date.now() + 24*3600*1000).toISOString();
  }},
  { key: 'tomorrow', label: '⏰ Завтра 12:00', resolve: () => {
    const d = new Date(); d.setDate(d.getDate()+1); d.setHours(12,0,0,0); return d.toISOString();
  }},
  { key: '3d', label: '📆 3 дня', ms: 3 * 24 * 3600 * 1000 },
  { key: 'week', label: '🗓 Неделя', ms: 7 * 24 * 3600 * 1000 }
];

export const DECLINE_REASONS = [
  'Сильно загружен срочной работой',
  'Не моя зона ответственности — лучше обратиться к коллеге',
  'Не хватает информации для выполнения',
  'Сейчас в отпуске / на объекте',
  'Срочнее другие задачи'
];

/* ── Загрузка списков ────────────────────────────────────────── */
export async function loadInbox({ status } = {}) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const r = await api('/api/tasks/help/inbox' + qs);
  return r?.tasks || [];
}
export async function loadOutbox({ status } = {}) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const r = await api('/api/tasks/help/outbox' + qs);
  return r?.tasks || [];
}
export async function loadWatching() {
  const r = await api('/api/tasks/help/watching');
  return r?.tasks || [];
}
export async function loadStats() {
  return await api('/api/tasks/help/stats');
}
export async function loadTask(id) {
  return await api(`/api/tasks/${id}`);
}
export async function loadComments(id) {
  const r = await api(`/api/tasks/${id}/comments`);
  return r?.comments || [];
}

export async function loadActiveUsers() {
  const r = await api('/api/users?is_active=true&limit=500');
  return r?.users || [];
}

/* ── Действия ─────────────────────────────────────────────────── */
export function createHelpTask(body) {
  return api('/api/tasks', { method: 'POST', body: { ...body, task_kind: 'help' } });
}
export function uploadFiles(taskId, formData) {
  return api(`/api/tasks/${taskId}/files`, { method: 'POST', body: formData, raw: true });
}
export function acceptTask(id)   { return api(`/api/tasks/${id}/accept`,   { method: 'PUT' }); }
export function completeTask(id, comment) {
  return api(`/api/tasks/${id}/complete`, { method: 'PUT', body: { comment: comment || null } });
}
export function declineTask(id, reason) {
  return api(`/api/tasks/${id}/decline`,  { method: 'PUT', body: { reason } });
}
export function redirectTask(id, new_assignee_id, reason) {
  return api(`/api/tasks/${id}/redirect`, { method: 'PUT', body: { new_assignee_id, reason } });
}
export function reassignTask(id, new_assignee_id) {
  return api(`/api/tasks/${id}/reassign`, { method: 'PUT', body: { new_assignee_id } });
}
export function escalateTask(id) {
  return api(`/api/tasks/${id}/escalate`, { method: 'PUT', body: {} });
}
export function addWatchersBulk(id, user_ids) {
  return api(`/api/tasks/${id}/watchers/bulk`, { method: 'POST', body: { user_ids } });
}
export function addComment(id, text) {
  return api(`/api/tasks/${id}/comments`, { method: 'POST', body: { text } });
}

/* ── Phase 8: Templates / Ratings / Analytics / AI-suggest ─── */
export async function loadTemplates() {
  const r = await api('/api/tasks/help/templates');
  return r?.templates || [];
}
export function createTemplate(body)       { return api('/api/tasks/help/templates', { method: 'POST', body }); }
export function updateTemplate(id, body)   { return api(`/api/tasks/help/templates/${id}`, { method: 'PUT', body }); }
export function deleteTemplate(id)         { return api(`/api/tasks/help/templates/${id}`, { method: 'DELETE' }); }
export function useTemplate(id, overrides) { return api(`/api/tasks/help/templates/${id}/use`, { method: 'POST', body: overrides || {} }); }

export function rateTask(taskId, stars, thanks_text) {
  return api(`/api/tasks/${taskId}/rate`, { method: 'POST', body: { stars, thanks_text } });
}
export async function loadRating(taskId) {
  const r = await api(`/api/tasks/${taskId}/rating`);
  return r?.rating || null;
}

export async function loadAnalytics(period = '30d') {
  return await api(`/api/tasks/help/analytics?period=${encodeURIComponent(period)}`);
}

export async function aiSuggestAssignee(description, title) {
  return await api('/api/tasks/help/ai-suggest', { method: 'POST', body: { description, title } });
}

/* ── Хелперы ──────────────────────────────────────────────────── */
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
  try { return new Date(val).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }); } catch { return ''; }
}
export function timeLeft(deadline) {
  if (!deadline) return null;
  const diff = new Date(deadline) - new Date();
  if (diff < 0) {
    const past = Math.floor(-diff / 3600000);
    return { overdue: true, label: past < 24 ? `просрочено ${past}ч назад` : `просрочено ${Math.floor(past/24)}д назад` };
  }
  const h = Math.floor(diff / 3600000);
  if (h < 1)   return { hot: true, label: `${Math.max(1, Math.floor(diff/60000))} мин` };
  if (h < 24)  return { hot: h < 4, label: `${h} ч` };
  return { label: `${Math.floor(h/24)} д` };
}

/* «Отдел» = role (CRM пока не имеет department в users) */
export const ROLE_LABELS = {
  ADMIN: 'Администратор',
  PM: 'РП', HEAD_PM: 'Глава РП',
  TO: 'Технический отдел', HEAD_TO: 'Глава ТО',
  PROC: 'Закупки', BUH: 'Бухгалтерия',
  HR: 'Кадры', HR_MANAGER: 'Глава кадров',
  WAREHOUSE: 'Склад',
  CHIEF_ENGINEER: 'Гл. инженер',
  OFFICE_MANAGER: 'Офис-менеджер',
  DIRECTOR_GEN: 'Ген. директор',
  DIRECTOR_COMM: 'Ком. директор',
  DIRECTOR_DEV: 'Дир. развития'
};
export const DEPARTMENT_FILTERS = [
  { key: '',           label: '🌐 Все' },
  { key: 'PM,HEAD_PM', label: '👷 РП' },
  { key: 'TO,HEAD_TO', label: '🛠 ТО' },
  { key: 'PROC',       label: '🛒 Закупки' },
  { key: 'BUH',        label: '💰 Бухгалтерия' },
  { key: 'HR,HR_MANAGER', label: '👥 Кадры' },
  { key: 'WAREHOUSE',  label: '🏭 Склад' },
  { key: 'OFFICE_MANAGER', label: '🏢 Офис' },
  { key: 'CHIEF_ENGINEER', label: '⚙️ Инженер' },
  { key: 'DIRECTOR_GEN,DIRECTOR_COMM,DIRECTOR_DEV', label: '🛡 Руководство' }
];
