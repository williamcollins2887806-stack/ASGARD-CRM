/** Shared XP rank helpers for field gamification / 3D avatars.
 * Level formula matches backend (field-gamification / field-hall): floor(xp/100)+1
 * so Profile avatar, Hall, Leaderboard and ceremony share one rank ladder.
 */
export const XP_PER_LEVEL = 100;

/** @deprecated kept for callers; thresholds unused — level is linear xp/100 */
export const XP_LEVELS = Array.from({ length: 50 }, (_, i) => i * XP_PER_LEVEL);

export const RANKS = [
  { min: 1, max: 2, title: 'Трэль', rune: 'ᚦ', key: 'thrall', color: '#9ca3af' },
  { min: 3, max: 4, title: 'Карл', rune: 'ᚲ', key: 'karl', color: '#a78bfa' },
  { min: 5, max: 7, title: 'Хускарл', rune: 'ᚹ', key: 'huskarl', color: '#60a5fa' },
  { min: 8, max: 11, title: 'Дружинник', rune: 'ᛏ', key: 'druzhina', color: '#34d399' },
  { min: 12, max: 15, title: 'Витязь', rune: 'ᛒ', key: 'vityaz', color: '#f97316' },
  { min: 16, max: 19, title: 'Ярл', rune: 'ᛖ', key: 'jarl', color: '#D4A843' },
  { min: 20, max: Infinity, title: 'Конунг', rune: 'ᛟ', key: 'konung', color: '#ef4444' },
];

export function getLevel(xp = 0) {
  const n = Math.max(0, Math.floor(Number(xp) || 0));
  return Math.max(1, Math.floor(n / XP_PER_LEVEL) + 1);
}

/** Progress inside current level: { current, next, floor, ceil } */
export function getXpProgress(xp = 0) {
  const n = Math.max(0, Math.floor(Number(xp) || 0));
  const level = getLevel(n);
  const floor = (level - 1) * XP_PER_LEVEL;
  const ceil = level * XP_PER_LEVEL;
  return {
    level,
    floor,
    ceil,
    current: n - floor,
    next: ceil - floor,
  };
}

export function getRank(level = 1) {
  const lvl = Math.max(1, parseInt(level, 10) || 1);
  return RANKS.find((r) => lvl >= r.min && lvl <= r.max) || RANKS[0];
}

export function rankIndex(title) {
  const i = RANKS.findIndex((r) => r.title === title);
  return i < 0 ? 0 : i;
}

export function rankStorageKey(employeeId) {
  return `field_last_rank_${employeeId || 'anon'}`;
}
