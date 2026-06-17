/* API для /user-requests — управление пользователями (ADMIN/DIRECTOR_GEN). */
import { api } from '@/api/client';

export const ROLES_LIST = [
  { key: 'TO', label: 'TO — Тендерный отдел' },
  { key: 'PM', label: 'PM — Руководитель проекта' },
  { key: 'HR', label: 'HR — Персонал + PM' },
  { key: 'BUH', label: 'BUH — Бухгалтерия' },
  { key: 'OFFICE_MANAGER', label: 'OFFICE_MANAGER — Офис-менеджер' },
  { key: 'WAREHOUSE', label: 'WAREHOUSE — Кладовщик' },
  { key: 'PROC', label: 'PROC — Закупки' },
  { key: 'DIRECTOR_COMM', label: 'DIRECTOR_COMM — Коммерческий директор' },
  { key: 'DIRECTOR_GEN', label: 'DIRECTOR_GEN — Генеральный директор' },
  { key: 'DIRECTOR_DEV', label: 'DIRECTOR_DEV — Директор разработки + PM' },
  { key: 'HEAD_TO', label: 'HEAD_TO — Рук. тендерного отдела' },
  { key: 'HEAD_PM', label: 'HEAD_PM — Рук. техотдела' },
  { key: 'CHIEF_ENGINEER', label: 'CHIEF_ENGINEER — Главный инженер' },
  { key: 'HR_MANAGER', label: 'HR_MANAGER — HR-менеджер' }
];

export const ALLOWED_PAGE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'DIRECTOR'];
export const MAIL_MANAGE_ROLES = ['ADMIN', 'DIRECTOR_GEN'];

export async function loadUsers() {
  const data = await api('/api/users');
  return data.users || [];
}

export async function createUser(body) {
  return api('/api/users', { method: 'POST', body });
}

export async function updateUser(id, body) {
  return api(`/api/users/${id}`, { method: 'PUT', body });
}

export async function blockUser(id, reason) {
  return api(`/api/users/${id}/block`, { method: 'POST', body: { reason } });
}

export async function unblockUser(id) {
  return api(`/api/users/${id}/unblock`, { method: 'POST' });
}

export async function resetPassword(id) {
  return api(`/api/users/${id}/send-credentials`, { method: 'POST' });
}

export async function getEmailAccount(id) {
  return api(`/api/users/${id}/email-account`);
}
export async function bindEmail(id, body) {
  return api(`/api/users/${id}/email-account`, { method: 'POST', body });
}
export async function updateEmail(id, body) {
  return api(`/api/users/${id}/email-account`, { method: 'PUT', body });
}
export async function deleteEmail(id) {
  return api(`/api/users/${id}/email-account`, { method: 'DELETE' });
}
export async function testEmail(id, body) {
  return api(`/api/users/${id}/email-account/test`, { method: 'POST', body });
}
export async function createYandexBox(id, body) {
  return api(`/api/users/${id}/email-account/create-yandex`, { method: 'POST', body });
}
export async function bindYandexBox(id, body) {
  return api(`/api/users/${id}/email-account/bind-yandex`, { method: 'POST', body });
}

export function timeAgo(d) {
  if (!d) return null;
  const dt = new Date(d);
  const diff = Math.floor((Date.now() - dt.getTime()) / 1000);
  if (diff < 60) return 'только что';
  if (diff < 3600) return Math.floor(diff / 60) + ' мин назад';
  if (diff < 86400) return Math.floor(diff / 3600) + ' ч назад';
  if (diff < 604800) return Math.floor(diff / 86400) + ' дн назад';
  return dt.toLocaleDateString('ru-RU');
}

export function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('ru-RU');
}
