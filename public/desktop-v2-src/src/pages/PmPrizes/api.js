/**
 * API-клиент страницы /pm-prizes — призы воинов: запросы и история.
 * Источник: vanilla `public/assets/js/pm-prizes.js` (~451 строка).
 * Backend: GET/PUT /api/gamification/admin/{pending-deliveries,delivered-history,inventory/:id/deliver}
 *
 *   Роли: ADMIN/PM/HEAD_PM/DIRECTOR_*
 */
import { api } from '@/api/client';

export const STATUS_LABEL = {
  pending: 'Ожидает',
  requested: 'Запрошен',
  ready: 'Готов',
  delivered: 'Выдан',
  confirmed: 'Получен',
};

export const STATUS_TONE = {
  pending: 'default',
  requested: 'amber',
  ready: 'info',
  delivered: 'ok',
  confirmed: 'ok',
};

export const CAT_META = {
  food:       { icon: '🍜', label: 'Еда',         color: 'var(--orange)' },
  merch:      { icon: '🎁', label: 'Мерч',        color: 'var(--gold)' },
  cosmetic:   { icon: '🎮', label: 'Косметика',   color: 'var(--purple)' },
  digital:    { icon: '💎', label: 'Цифровые',    color: 'var(--blue)' },
  privilege:  { icon: '⭐', label: 'Привилегии',  color: 'var(--amber)' },
  spin_prize: { icon: '✨', label: 'Спины',        color: 'var(--purple)' },
};

export function catMeta(cat) {
  return CAT_META[cat] || { icon: '🎁', label: cat || 'Мерч', color: 'var(--gold)' };
}

/** GET /api/gamification/admin/pending-deliveries — { requested, won } */
export function loadPending() {
  return api('/api/gamification/admin/pending-deliveries');
}

/** GET /api/gamification/admin/delivered-history — { history } */
export function loadHistory() {
  return api('/api/gamification/admin/delivered-history');
}

/** PUT /api/gamification/admin/inventory/:id/deliver — выдать */
export function deliverPrize(inventoryId, deliveryNote) {
  return api(`/api/gamification/admin/inventory/${inventoryId}/deliver`, {
    method: 'PUT',
    body: { delivery_note: deliveryNote || undefined },
  });
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return '—'; }
}

export function initials(name) {
  const parts = (name || '').trim().split(/\s+/);
  return parts.map((w) => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';
}
