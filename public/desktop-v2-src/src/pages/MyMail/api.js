/**
 * API-клиент почтового клиента /my-mail.
 *
 * Источник: vanilla `public/assets/js/my_mail.js` (1776 строк) + backend
 * `src/routes/my-mail.js` (1100+ строк).
 *
 * 2026-06-15 (D-3 финал): полный 3-колоночный почтовый клиент.
 *  - папки: /folders (GET, POST, PUT/:id, DELETE/:id)
 *  - письма: /emails (GET с фильтрами), /emails/:id (GET), /emails/:id (PATCH),
 *            /emails/bulk (POST), /emails/:id/move (POST)
 *  - отправка: /send, /drafts (POST)
 *  - аккаунт: /account (GET, PUT), /sync (POST), /poll (GET)
 *  - вспомогательные: /stats, /contacts
 *  - вложения: /attachments/:id/download
 */
import { api } from '@/api/client';

const BASE = '/api/my-mail';

/* ─────────── СИСТЕМНЫЕ ПАПКИ (fallback для иконок/типов) ─────────── */
export const SYSTEM_FOLDER_TYPES = ['inbox', 'sent', 'drafts', 'spam', 'trash'];

export const FOLDER_ICONS = {
  inbox: '📥',
  sent: '📤',
  drafts: '📝',
  spam: '⚠',
  trash: '🗑',
  archive: '📦',
  custom: '📁'
};

export function folderIcon(type) {
  return FOLDER_ICONS[type] || FOLDER_ICONS.custom;
}

/* ─────────── ПАПКИ ─────────── */
export function loadFolders() {
  return api(BASE + '/folders')
    .then((d) => d?.folders || [])
    .catch(() => []);
}

export function createFolder(name) {
  return api(BASE + '/folders', { method: 'POST', body: { name } });
}

export function renameFolder(id, name) {
  return api(BASE + '/folders/' + id, { method: 'PUT', body: { name } });
}

export function deleteFolder(id) {
  return api(BASE + '/folders/' + id, { method: 'DELETE' });
}

/* ─────────── ПИСЬМА ─────────── */
export function loadMessages(opts = {}) {
  const q = new URLSearchParams();
  q.set('limit', String(opts.limit || 50));
  q.set('offset', String(opts.offset || 0));
  if (opts.folder_id) q.set('folder_id', String(opts.folder_id));
  else if (opts.folder_type) q.set('folder_type', opts.folder_type);
  if (opts.search) q.set('search', opts.search);
  if (opts.is_read !== undefined) q.set('is_read', String(opts.is_read));
  if (opts.is_starred !== undefined) q.set('is_starred', String(opts.is_starred));
  if (opts.is_draft !== undefined) q.set('is_draft', String(opts.is_draft));
  if (opts.is_deleted !== undefined) q.set('is_deleted', String(opts.is_deleted));
  if (opts.direction) q.set('direction', opts.direction);
  if (opts.sort) q.set('sort', opts.sort);
  if (opts.order) q.set('order', opts.order);
  return api(BASE + '/emails?' + q.toString())
    .then((d) => ({ emails: d?.emails || [], total: d?.total || 0 }))
    .catch(() => ({ emails: [], total: 0 }));
}

export function loadMessage(id) {
  return api(BASE + '/emails/' + id);
}

export function patchMessage(id, patch) {
  return api(BASE + '/emails/' + id, { method: 'PATCH', body: patch });
}

export function moveMessage(id, folder_id) {
  return api(BASE + '/emails/' + id + '/move', { method: 'POST', body: { folder_id } });
}

export function bulkAction(ids, action) {
  return api(BASE + '/emails/bulk', { method: 'POST', body: { ids, action } });
}

/* ─────────── ОТПРАВКА ─────────── */
export function sendMessage(body) {
  return api(BASE + '/send', { method: 'POST', body });
}

export function saveDraft(body) {
  return api(BASE + '/drafts', { method: 'POST', body });
}

/* ─────────── АККАУНТ / СИНХРОНИЗАЦИЯ ─────────── */
export function loadAccount() {
  return api(BASE + '/account')
    .then((d) => d || { configured: false })
    .catch(() => ({ configured: false }));
}

export function syncAccount() {
  return api(BASE + '/sync', { method: 'POST' });
}

export function pollAccount() {
  return api(BASE + '/poll').catch(() => ({ unread: 0, lastEmailDate: null }));
}

/* ─────────── СТАТИСТИКА И КОНТАКТЫ ─────────── */
export function loadStats() {
  return api(BASE + '/stats').catch(() => ({ unread: 0, total: 0, folders: [], configured: false }));
}

/**
 * Backend требует ?q=… (минимум 2 символа). Возвращает массив контактов.
 * Для левой панели «Контакты» загружаем всё с запросом 'a' (популярная буква).
 * Бэк отдаёт ≤20 разнообразных контактов из писем и пользователей.
 */
export function loadContacts(q = '') {
  if (!q || q.length < 2) {
    // Загружаем «много» подстановками по часто встречающимся буквам.
    return Promise.all(['a', 'e', 'i', 'o', '@'].map((ch) =>
      api(BASE + '/contacts?q=' + encodeURIComponent(ch))
        .then((d) => d?.contacts || [])
        .catch(() => [])
    )).then((lists) => {
      const seen = new Set();
      const all = [];
      for (const list of lists) {
        for (const c of list) {
          const key = (c.email || '').toLowerCase();
          if (key && !seen.has(key)) { seen.add(key); all.push(c); }
        }
      }
      return all.sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || ''));
    });
  }
  return api(BASE + '/contacts?q=' + encodeURIComponent(q))
    .then((d) => d?.contacts || [])
    .catch(() => []);
}

/* ─────────── ВЛОЖЕНИЯ ─────────── */
export async function openAttachment(messageId, attachId, filename) {
  const url = BASE + '/attachments/' + encodeURIComponent(attachId) + '/download';
  const { openProtected } = await import('@/api/download');
  return openProtected(url, filename || ('attachment_' + attachId));
}

/* ─────────── ШАБЛОНЫ И ИСХОДЯЩИЕ НОМЕРА (legacy, /api/mailbox/*) ─────────── */
export function loadTemplates() {
  return api('/api/mailbox/templates')
    .then((d) => d?.templates || d?.items || [])
    .catch(() => []);
}

export function renderTemplate(id, variables = {}) {
  return api('/api/mailbox/templates/' + id + '/render', {
    method: 'POST',
    body: { variables }
  });
}

export function nextOutgoingNumber(date) {
  const q = date ? '?date=' + encodeURIComponent(date) : '';
  return api('/api/mailbox/next-outgoing-number' + q).catch(() => ({ number: '', preview: true }));
}

/* ─────────── ФОРМАТТЕРЫ ─────────── */
export function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return '—';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const diff = now - d;
  if (diff < 7 * 86400000) return d.toLocaleDateString('ru-RU', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

export function fmtFullDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

export function fmtAddr(addr) {
  if (!addr) return '—';
  if (typeof addr === 'string') return addr;
  if (addr.name) return `${addr.name} <${addr.email || addr.address || ''}>`;
  return addr.email || addr.address || '—';
}

export function fmtFileSize(bytes) {
  const n = Number(bytes);
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + units[i];
}

/* группа писем по дате — для разделителей в списке. */
export function dateGroup(s) {
  if (!s) return 'Ранее';
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return 'Ранее';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);
  if (d >= today) return 'Сегодня';
  if (d >= yesterday) return 'Вчера';
  if (d >= weekAgo) return 'На этой неделе';
  return 'Ранее';
}

/* ─────────── HASH-COLOR для аватарок ─────────── */
const AVATAR_COLORS = [
  '#1E4D8C', '#C8293B', '#D4A843', '#2D7D46', '#7B3FA0',
  '#C75B39', '#2A8E8E', '#6B5B95', '#D14D72', '#4A90D9'
];

export function hashColor(str) {
  let h = 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export function avatarLetter(name, email) {
  if (name && String(name).trim()) return String(name).trim()[0].toUpperCase();
  if (email) return String(email)[0].toUpperCase();
  return '?';
}

/* FOLDERS legacy экспорт оставлен для совместимости со старыми вызовами. */
export const FOLDERS = [
  { value: 'inbox', label: 'Входящие', icon: '📥' },
  { value: 'sent', label: 'Отправленные', icon: '📤' },
  { value: 'drafts', label: 'Черновики', icon: '📝' },
  { value: 'spam', label: 'Спам', icon: '⚠' },
  { value: 'trash', label: 'Корзина', icon: '🗑' }
];
