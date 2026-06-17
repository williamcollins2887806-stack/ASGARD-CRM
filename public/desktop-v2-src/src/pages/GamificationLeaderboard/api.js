/**
 * API-клиент страницы /gamification-leaderboard (Зал Одина — Рейтинг рабочих).
 * Источник: vanilla `public/assets/js/gamification-leaderboard.js` (~366 строк).
 * Backend: src/routes/gamification-admin.js (prefix /api/gamification/admin).
 */
import { api } from '@/api/client';

export const RANK_COLORS = {
  'Трэль': 'var(--t-3)',
  'Карл': 'var(--purple)',
  'Хускарл': 'var(--blue)',
  'Дружинник': 'var(--ok)',
  'Витязь': 'var(--orange)',
  'Ярл': 'var(--gold)',
  'Конунг': 'var(--err)',
};

export const PODIUM_COLORS = ['var(--gold)', 'var(--t-3)', 'var(--orange)'];
export const MEDALS = ['🥇', '🥈', '🥉'];

/** GET /api/gamification/admin/leaderboard — топ воинов + турнир */
export function loadLeaderboard() {
  return api('/api/gamification/admin/leaderboard');
}

/** Числовой форматер RU */
export function fmt(n) {
  return (parseInt(n) || 0).toLocaleString('ru-RU');
}

/** Сортировка воинов по выбранному метрику */
export function sortByMetric(items, sortBy) {
  const arr = [...items];
  arr.sort((a, b) => {
    if (sortBy === 'xp') return parseInt(b.earned_xp || 0) - parseInt(a.earned_xp || 0);
    if (sortBy === 'shifts') return parseInt(b.total_shifts || 0) - parseInt(a.total_shifts || 0);
    if (sortBy === 'monthly') return parseInt(b.monthly_runes || 0) - parseInt(a.monthly_runes || 0);
    return parseInt(b.earned_runes || 0) - parseInt(a.earned_runes || 0);
  });
  return arr;
}

/** Извлечь значение метрики */
export function valueOf(p, sortBy) {
  if (sortBy === 'xp') return parseInt(p.earned_xp || 0);
  if (sortBy === 'shifts') return parseInt(p.total_shifts || 0);
  if (sortBy === 'monthly') return parseInt(p.monthly_runes || 0);
  return parseInt(p.earned_runes || 0);
}

/** Лейбл значения метрики */
export function labelOf(p, sortBy) {
  if (sortBy === 'xp') return fmt(p.earned_xp) + ' XP';
  if (sortBy === 'shifts') return fmt(p.total_shifts) + ' смен';
  return fmt(p.earned_runes) + ' ᚱ';
}

/** Инициалы из ФИО */
export function initials(name) {
  const parts = (name || '').trim().split(/\s+/);
  return parts.map((w) => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';
}
