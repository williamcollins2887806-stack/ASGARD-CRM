/**
 * Alerts — API helpers.
 *
 * Backend: src/routes/notifications.js — endpoints:
 *   GET    /api/notifications?limit=&is_read=&offset=  →  {notifications:[], unread_count}
 *   PUT    /api/notifications/:id/read                  →  пометить прочитанным
 *   PUT    /api/notifications/read-all                  →  все прочитанные
 *   DELETE /api/notifications/:id                       →  удалить
 */
import { api } from '@/api/client';

/* RBAC — синхронно с vanilla alerts.js строка 4 (isDirRole helper).
 * Уведомления доступны всем ролям, но особое поведение (видеть «системные» рассылки и
 * широковещательные нотификации, фильтр поиска для админов) — у директорских ролей и ADMIN.
 * Литералы ниже нужны, чтобы скрипт rbac-audit видел роли в коде, а не за helper-функцией. */
export const DIRECTOR_ROLES = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
export const ADMIN_VIEW_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

export function isDirectorRole(role) {
  return DIRECTOR_ROLES.includes(role);
}

export function canSeeAdminNotifications(user) {
  return ADMIN_VIEW_ROLES.includes(user?.role);
}

export async function loadNotifications({ is_read, limit = 200, scope } = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (is_read != null) params.set('is_read', is_read ? 'true' : 'false');
  // scope=all — только ADMIN/DIRECTOR_* (бэкенд игнорит для остальных), паритет vanilla alerts.js:56,60.
  if (scope === 'all') params.set('scope', 'all');
  const r = await api('/api/notifications?' + params.toString());
  return {
    notifications: r?.notifications || [],
    unread_count: r?.unread_count ?? 0
  };
}

export function markRead(id) {
  return api(`/api/notifications/${id}/read`, { method: 'PUT' });
}

export function markAllRead() {
  return api('/api/notifications/read-all', { method: 'PUT' });
}

export function deleteNotification(id) {
  return api(`/api/notifications/${id}`, { method: 'DELETE' });
}

/* Группировка по типу для удобства */
const TYPE_LABELS = {
  task:               { label: '📋 Задачи',         icon: '📋' },
  calendar_reminder:  { label: '📅 Календарь',      icon: '📅' },
  approval:           { label: '✅ Согласования',   icon: '✅' },
  congrats:           { label: '🎂 Поздравления',   icon: '🎂' },
  system:             { label: '⚙ Системные',      icon: '⚙' },
  broadcast:          { label: '📢 Рассылки',       icon: '📢' },
  chat_message:       { label: '💬 Сообщения',      icon: '💬' },
  bonus_created:      { label: '💰 Премии',         icon: '💰' },
  bonus_approved:     { label: '💰 Премии',         icon: '💰' },
  bonus_rejected:     { label: '💰 Премии',         icon: '💰' },
  staff_created:      { label: '👥 Кадры',          icon: '👥' },
  staff_approved:     { label: '👥 Кадры',          icon: '👥' },
  staff_rejected:     { label: '👥 Кадры',          icon: '👥' },
  purchase_created:   { label: '🛒 Закупки',        icon: '🛒' },
  purchase_approved:  { label: '🛒 Закупки',        icon: '🛒' },
  tender_handoff:     { label: '📋 Тендеры',        icon: '📋' },
  info:               { label: 'ℹ Информация',     icon: 'ℹ' }
};

const DEFAULT_GROUP = { label: '🔔 Другое', icon: '🔔' };

export function groupByType(items) {
  const groups = new Map();
  for (const n of items) {
    const t = String(n.type || 'info');
    const meta = TYPE_LABELS[t] || DEFAULT_GROUP;
    const key = meta.label;
    const cur = groups.get(key) || { label: meta.label, icon: meta.icon, items: [] };
    cur.items.push(n);
    groups.set(key, cur);
  }
  // Сортируем группы по убыванию количества непрочитанных, затем по числу элементов
  return Array.from(groups.values()).sort((a, b) => {
    const ua = a.items.filter((x) => !x.is_read).length;
    const ub = b.items.filter((x) => !x.is_read).length;
    if (ua !== ub) return ub - ua;
    return b.items.length - a.items.length;
  });
}
