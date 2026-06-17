/**
 * API-клиент страницы /gamification-admin (Управление геймификацией).
 * Источник: vanilla `public/assets/js/gamification-crud.js` (~616 строк).
 * Backend:
 *   /api/gamification/crud/{shop-items,prizes,quests,winners}
 *   /api/gamification/admin/dashboard
 *
 *   Роли: ADMIN/DIRECTOR_GEN/OFFICE_MANAGER/HR
 */
import { api } from '@/api/client';

export const TIER_COLORS = {
  common: 'var(--ok)',
  rare: 'var(--blue)',
  epic: 'var(--purple)',
  legendary: 'var(--gold)',
};

export const TIER_LABELS = {
  common: 'Обычный',
  rare: 'Редкий',
  epic: 'Эпик',
  legendary: 'Легенда',
};

export const CAT_LABELS = {
  merch: 'Мерч',
  digital: 'Цифровое',
  privilege: 'Привилегия',
  cosmetic: 'Косметика',
  food: 'Еда',
};

export const CAT_OPTIONS = ['food', 'merch', 'digital', 'privilege', 'cosmetic'];
export const TIER_OPTIONS = ['common', 'rare', 'epic', 'legendary'];

export const DELIVERY_LABELS = {
  pending: '⏳ Ожидает',
  ready: '📦 Готово к выдаче',
  delivered: '✅ Выдано',
};
export const DELIVERY_TONE = {
  pending: 'amber',
  ready: 'info',
  delivered: 'ok',
};

export const QUEST_TYPES = ['daily', 'weekly', 'seasonal', 'permanent'];
export const REWARD_TYPES = ['runes', 'xp'];

/** Dashboard для шапки. */
export function loadDashboard() {
  return api('/api/gamification/admin/dashboard');
}

/** Товары магазина. */
export function loadShopItems() {
  return api('/api/gamification/crud/shop-items');
}
export function createShopItem(body) {
  return api('/api/gamification/crud/shop-items', { method: 'POST', body });
}
export function updateShopItem(id, body) {
  return api(`/api/gamification/crud/shop-items/${id}`, { method: 'PUT', body });
}
export function deactivateShopItem(id) {
  return api(`/api/gamification/crud/shop-items/${id}`, { method: 'DELETE' });
}

/** Призы рулетки. */
export function loadPrizes() {
  return api('/api/gamification/crud/prizes');
}
export function togglePrize(id) {
  return api(`/api/gamification/crud/prizes/${id}/toggle`, { method: 'PUT', body: {} });
}

/** Квесты. */
export function loadQuests() {
  return api('/api/gamification/crud/quests');
}
export function createQuest(body) {
  return api('/api/gamification/crud/quests', { method: 'POST', body });
}
export function updateQuest(id, body) {
  return api(`/api/gamification/crud/quests/${id}`, { method: 'PUT', body });
}
export function deactivateQuest(id) {
  return api(`/api/gamification/crud/quests/${id}`, { method: 'DELETE' });
}

/** Победители. */
export function loadWinners(filter = {}) {
  const p = new URLSearchParams();
  if (filter.status) p.set('status', filter.status);
  if (filter.from) p.set('from', filter.from);
  if (filter.to) p.set('to', filter.to);
  return api('/api/gamification/crud/winners?' + p.toString());
}
export function markDelivery(fulfillmentId, status, note) {
  return api(`/api/gamification/crud/winners/delivery/${fulfillmentId}`, {
    method: 'PUT',
    body: { status, delivery_note: note },
  });
}

/** Форматирование. */
export function fmt(n) {
  if (n == null || n === '') return '—';
  return Number(n).toLocaleString('ru-RU');
}

export function fmtDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return '—'; }
}
