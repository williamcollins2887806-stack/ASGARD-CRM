/**
 * Worker Title Service
 * ═══════════════════════════════════════════════════════════════
 * Titles are computed on-the-fly from earned achievement count.
 * No separate DB table — derived from employee_achievements.
 *
 * Title progression:
 *   Новобранец  →  Воин  →  Ярл  →  Хёвдинг  →  Легенда
 *
 * Benefits:
 *   - Displayed on profile card and leaderboard
 *   - Reduces pity guarantee threshold in WheelOfNorns
 *     (fewer spins needed to guarantee a rare prize)
 */

const TITLES = [
  {
    id: 'recruit',
    name: 'Новобранец',
    icon: '🪓',
    color: '#9ca3af',
    min: 0,
    pity_reduction: 0,   // standard: guarantee at 50 spins
    description: 'Только начинаешь свой путь воина Асгарда',
  },
  {
    id: 'warrior',
    name: 'Воин',
    icon: '⚔️',
    color: '#60a5fa',
    min: 5,
    pity_reduction: 5,   // guarantee at 45 spins
    description: 'Доказал себя в первых сражениях',
  },
  {
    id: 'jarl',
    name: 'Ярл',
    icon: '🛡️',
    color: '#34d399',
    min: 15,
    pity_reduction: 10,  // guarantee at 40 spins
    description: 'Опытный воин, которому доверяют',
  },
  {
    id: 'chieftain',
    name: 'Хёвдинг',
    icon: '👑',
    color: '#f59e0b',
    min: 30,
    pity_reduction: 18,  // guarantee at 32 spins
    description: 'Вождь, ведущий за собой бригаду',
  },
  {
    id: 'legend',
    name: 'Легенда',
    icon: '⚡',
    color: '#8b5cf6',
    min: 50,
    pity_reduction: 25,  // guarantee at 25 spins
    description: 'Имя вписано в саги Асгарда навеки',
  },
];

const BASE_PITY = 50;

/**
 * Get title object for given earned achievement count.
 */
function getTitle(earnedCount) {
  let title = TITLES[0];
  for (const t of TITLES) {
    if (earnedCount >= t.min) title = t;
  }
  return title;
}

/**
 * Get the next title tier (null if already at max).
 */
function getNextTitle(earnedCount) {
  const current = getTitle(earnedCount);
  const idx = TITLES.findIndex((t) => t.id === current.id);
  return TITLES[idx + 1] || null;
}

/**
 * Get pity guarantee threshold for a given title.
 * Higher title = fewer spins needed to guarantee rare.
 */
function getPityGuarantee(titleId) {
  const t = TITLES.find((t) => t.id === titleId);
  return BASE_PITY - (t?.pity_reduction || 0);
}

/**
 * Get full title info for a worker from DB (counts earned achievements).
 */
async function getWorkerTitle(db, employeeId) {
  const { rows: [row] } = await db.query(
    'SELECT COUNT(*)::int as cnt FROM employee_achievements WHERE employee_id = $1',
    [employeeId]
  );
  const count = row?.cnt || 0;
  const title = getTitle(count);
  const next = getNextTitle(count);
  return {
    ...title,
    earned_count: count,
    next_title: next ? { name: next.name, icon: next.icon, color: next.color, min: next.min, needed: next.min - count } : null,
    pity_guarantee: getPityGuarantee(title.id),
  };
}

module.exports = { TITLES, BASE_PITY, getTitle, getNextTitle, getPityGuarantee, getWorkerTitle };
