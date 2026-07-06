/**
 * Рунопровод — генерация уровней и валидация прохождения
 * Маски: N=1 E=2 S=4 W=8
 */
const crypto = require('crypto');

const P = { EMPTY: 0, STR: 1, ELB: 2, TEE: 3, SRC: 5, DRN: 6, RUST: 7, CLOG: 8, BROKEN: 9, ROOT: 10 };
// EMPTY STR  ELB  TEE  -   SRC DRN RUST CLOG BRK ROOT
const CONN = [0, 0b1010, 0b1100, 0b1110, 0, 0b0100, 0b1000, 0b1010, 0b1010, 0b1010, 0b1010];
const DIRS = [
  [-1, 0, 1, 4],
  [0, 1, 2, 8],
  [1, 0, 4, 1],
  [0, -1, 8, 2],
];
const BIT = [1, 2, 4, 8];

const WORLDS = [
  { min: 1, name: 'УТГАРД', icon: '🌱' },
  { min: 26, name: 'МИДГАРД', icon: '🌊' },
  { min: 51, name: 'НИФЛЬХЕЙМ', icon: '❄️' },
  { min: 76, name: 'МУСПЕЛЬХЕЙМ', icon: '🔥' },
  { min: 101, name: 'АСГАРД', icon: '⚡' },
];

const BLOCKED = new Set([P.RUST, P.CLOG, P.BROKEN, P.ROOT]);
const ROTATABLE = new Set([P.STR, P.ELB, P.TEE, P.RUST, P.CLOG, P.BROKEN, P.ROOT]);
const OBSTACLE_CLEAR = {
  [P.RUST]: 'rustCleared',
  [P.CLOG]: 'clogCleared',
  [P.BROKEN]: 'brokenCleared',
  [P.ROOT]: 'rootCleared',
};

function rotMask(mask, rot) {
  let m = mask;
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) {
    m = ((m << 1) | (m >> 3)) & 0xf;
  }
  return m;
}

function getConns(cell) {
  if (!cell || cell.t === P.EMPTY) return 0;
  if (cell.t === P.RUST && !cell.rustCleared) return 0;
  if (cell.t === P.CLOG && !cell.clogCleared) return 0;
  if (cell.t === P.BROKEN && !cell.brokenCleared) return 0;
  if (cell.t === P.ROOT && !cell.rootCleared) return 0;
  return rotMask(CONN[cell.t] || 0, cell.r || 0);
}

function isBlocked(cell) {
  if (!cell) return true;
  if (cell.t === P.RUST && !cell.rustCleared) return true;
  if (cell.t === P.CLOG && !cell.clogCleared) return true;
  if (cell.t === P.BROKEN && !cell.brokenCleared) return true;
  if (cell.t === P.ROOT && !cell.rootCleared) return true;
  return false;
}

function worldForLevel(level) {
  let w = WORLDS[0];
  for (const item of WORLDS) {
    if (level >= item.min) w = item;
  }
  return w;
}

function seededRng(seed) {
  let h = crypto.createHash('sha256').update(String(seed)).digest();
  let i = 0;
  return () => {
    if (i >= h.length - 4) {
      h = crypto.createHash('sha256').update(h).digest();
      i = 0;
    }
    const v = h.readUInt32BE(i);
    i += 4;
    return v / 0x100000000;
  };
}

function idx(size, r, c) {
  return r * size + c;
}

function inBounds(size, r, c) {
  return r >= 0 && r < size && c >= 0 && c < size;
}

function gridSizeForLevel(levelNum) {
  if (levelNum <= 5) return 5;
  if (levelNum <= 20) return 6;
  if (levelNum <= 50) return 7;
  return 8;
}

function minPathLength(levelNum, size) {
  const baseBySize = { 5: 6, 6: 8, 7: 10, 8: 12 };
  const base = baseBySize[size] || 8;
  const bonus = Math.floor(levelNum / 6) + (levelNum >= 80 ? 3 : levelNum >= 50 ? 2 : 0);
  return Math.min(size * size - 6, base + bonus);
}

function requiredMinRotations(levelNum) {
  if (levelNum <= 3) return 5;
  if (levelNum <= 10) return 6 + Math.floor(levelNum / 3);
  if (levelNum <= 25) return 9 + Math.floor(levelNum / 5);
  if (levelNum <= 50) return 11 + Math.floor(levelNum / 22);
  if (levelNum <= 80) return 13 + Math.floor((levelNum - 50) / 12);
  return 15 + Math.floor((levelNum - 80) / 15);
}

function requiredWrongCells(levelNum) {
  if (levelNum <= 3) return 4;
  if (levelNum <= 10) return 5;
  if (levelNum <= 50) return 5 + Math.floor(levelNum / 18);
  return 7 + Math.floor(levelNum / 35);
}

function pressureForLevel(levelNum) {
  if (levelNum >= 101) return 1.65;
  if (levelNum >= 76) return 1.5;
  if (levelNum >= 51) return 1.35;
  if (levelNum >= 26) return 1.15;
  return 1;
}

function pipeForDirs(inDir, outDir) {
  const mask = inDir | outDir;
  if (mask === (2 | 8) || mask === (1 | 4)) return { t: P.STR, r: mask === (2 | 8) ? 0 : 1 };
  if ([1 | 2, 2 | 4, 4 | 8, 8 | 1].includes(mask)) {
    const base = 0b1100;
    for (let r = 0; r < 4; r++) {
      if (rotMask(base, r) === mask) return { t: P.ELB, r };
    }
  }
  return { t: P.STR, r: 0 };
}

function rotationForMask(type, targetMask) {
  for (let r = 0; r < 4; r++) {
    if (rotMask(CONN[type], r) === targetMask) return r;
  }
  return 0;
}

/** Поворот строго НЕ в решение (1–3 клика до правильного) */
function scrambleRotation(correctR, rand, preferHard = false) {
  const offsets = preferHard ? [2, 3, 3, 2] : [1, 2, 3, 2, 3, 1];
  const off = offsets[Math.floor(rand() * offsets.length)];
  return (correctR + off) % 4;
}

function generatePath(size, rand, minLen) {
  const startEdge = Math.floor(rand() * 4);
  let r = 0;
  let c = 0;
  let prevDir = -1;
  if (startEdge === 0) { r = 0; c = Math.floor(rand() * size); prevDir = 1; }
  else if (startEdge === 1) { r = Math.floor(rand() * size); c = size - 1; prevDir = 8; }
  else if (startEdge === 2) { r = size - 1; c = Math.floor(rand() * size); prevDir = 4; }
  else { r = Math.floor(rand() * size); c = 0; prevDir = 2; }

  const path = [{ r, c, inDir: prevDir }];
  const visited = new Set([idx(size, r, c)]);

  while (true) {
    const options = [];
    for (let d = 0; d < 4; d++) {
      const [dr, dc, , opp] = DIRS[d];
      const nr = r + dr;
      const nc = c + dc;
      if (!inBounds(size, nr, nc)) continue;
      const ni = idx(size, nr, nc);
      if (visited.has(ni)) continue;
      options.push({ nr, nc, outDir: BIT[d], nextIn: opp, dir: d });
    }
    if (!options.length) break;

    // Предпочитаем повороты (сложнее), не ранний выход
    const turns = options.filter((o) => {
      const back = (o.outDir === 1 && prevDir === 4) || (o.outDir === 4 && prevDir === 1)
        || (o.outDir === 2 && prevDir === 8) || (o.outDir === 8 && prevDir === 2);
      return !back;
    });
    const pool = turns.length ? turns : options;
    const pick = pool[Math.floor(rand() * pool.length)];

    path.push({ r: pick.nr, c: pick.nc, inDir: pick.nextIn, outDir: path[path.length - 1].outDir || null });
    path[path.length - 2].outDir = pick.outDir;
    r = pick.nr;
    c = pick.nc;
    prevDir = pick.nextIn;
    visited.add(idx(size, r, c));

    const canStop = path.length >= minLen && options.length > 1 && rand() > 0.82;
    if (canStop) break;
    if (path.length >= size * 2 + 4) break;
  }

  const last = path[path.length - 1];
  let outDir = 0;
  for (let d = 0; d < 4; d++) {
    const [dr, dc] = DIRS[d];
    const nr = last.r + dr;
    const nc = last.c + dc;
    if (!inBounds(size, nr, nc)) {
      outDir = BIT[d];
      break;
    }
  }
  last.outDir = outDir;
  return path;
}

function placeObstacle(cells, path, size, type, rand, used = new Set()) {
  const candidates = path.slice(1, -1)
    .map((n) => idx(size, n.r, n.c))
    .filter((pi) => !used.has(pi) && cells[pi].t !== P.SRC && cells[pi].t !== P.DRN);
  if (!candidates.length) return false;
  const pi = candidates[Math.floor(rand() * candidates.length)];
  used.add(pi);
  cells[pi] = { t: type, r: cells[pi].r, ice: cells[pi].ice };
  return true;
}

/** Расписание препятствий по уровню */
function obstacleSchedule(levelNum) {
  const list = [];
  if (levelNum >= 5 && levelNum % 5 === 0) list.push(P.RUST);
  if (levelNum >= 8 && levelNum % 4 === 0) list.push(P.CLOG);
  if (levelNum >= 12 && levelNum % 6 === 0) list.push(P.BROKEN);
  if (levelNum >= 18 && levelNum % 7 === 0) list.push(P.ROOT);
  if (levelNum >= 30 && levelNum % 9 === 0) list.push(P.CLOG);
  if (levelNum >= 40 && levelNum % 11 === 0) list.push(P.BROKEN);
  if (levelNum >= 55 && levelNum % 5 === 2) list.push(P.ROOT);
  if (levelNum >= 70 && levelNum % 6 === 1) list.push(P.RUST);
  // 80+ — чаще и по два типа
  if (levelNum >= 80) {
    if (levelNum % 3 === 0) list.push(P.CLOG);
    if (levelNum % 4 === 1) list.push(P.BROKEN);
    if (levelNum % 5 === 2) list.push(P.ROOT);
    if (levelNum % 7 === 0) list.push(P.RUST);
  }
  if (levelNum >= 100 && levelNum % 2 === 0) list.push(P.BROKEN);
  return list;
}

function solutionFlagsForType(type) {
  return {
    rustCleared: type === P.RUST,
    clogCleared: type === P.CLOG,
    brokenCleared: type === P.BROKEN,
    rootCleared: type === P.ROOT,
  };
}

function emptySolutionCell() {
  return {
    t: P.EMPTY, r: 0, ice: false,
    rustCleared: false, clogCleared: false, brokenCleared: false, rootCleared: false,
  };
}

function analyzeDifficulty(cells, solution, size, pathSet) {
  let minRotations = 0;
  let wrongPathCells = 0;

  for (const i of pathSet) {
    const c = cells[i];
    const s = solution[i];
    if ([P.SRC, P.DRN].includes(s.t)) continue;
    if (BLOCKED.has(c.t)) {
      wrongPathCells++;
      continue;
    }
    const clicks = (s.r - (c.r || 0) + 4) % 4;
    if (clicks > 0) {
      wrongPathCells++;
      minRotations += c.ice ? clicks * 2 : clicks;
    }
  }

  return {
    minRotations,
    wrongPathCells,
    alreadySolved: isConnected(cells, size),
    pathLen: pathSet.size,
  };
}

function scrambleGrid(cells, solution, rand, levelNum) {
  const preferHard = levelNum >= 10;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const s = solution[i];
    if ([P.EMPTY, P.SRC, P.DRN].includes(c.t)) continue;
    if (BLOCKED.has(c.t)) {
      c.r = scrambleRotation(s.r, rand, true);
      continue;
    }
    c.r = scrambleRotation(s.r, rand, preferHard);
  }

  // Перемешать ложные трубы
  for (let i = 0; i < cells.length; i++) {
    if (!ROTATABLE.has(cells[i].t) || BLOCKED.has(cells[i].t)) continue;
    if (solution[i].t === P.EMPTY || [P.SRC, P.DRN].includes(solution[i].t)) {
      if (cells[i].t !== P.EMPTY && cells[i].t !== solution[i].t) {
        cells[i].r = Math.floor(rand() * 4);
      }
    }
  }
}

function fallbackLevel(levelNum) {
  const size = gridSizeForLevel(levelNum);
  const n = size * size;
  const cells = Array(n).fill(null).map(() => ({ t: P.EMPTY, r: 0 }));
  const pathIdx = size === 5
    ? [2, 3, 4, 9, 14, 19, 24]
    : size === 6
      ? [2, 3, 4, 10, 16, 22, 23, 24, 29, 34]
      : size === 7
        ? [3, 4, 5, 12, 19, 26, 33, 34, 35, 40, 45]
        : [3, 4, 5, 12, 19, 26, 33, 40, 41, 42, 49, 56];
  const specs = pathIdx.map((_, i) => {
    if (i === 0) return { t: P.SRC, r: 2 };
    if (i === pathIdx.length - 1) return { t: P.DRN, r: 1 };
    return { t: i % 2 ? P.ELB : P.STR, r: i % 3 };
  });
  pathIdx.forEach((pi, i) => { cells[pi] = { ...specs[i] }; });
  const decoyTypes = [P.STR, P.ELB, P.TEE];
  for (let i = 0; i < n; i++) {
    if (cells[i].t !== P.EMPTY) continue;
    cells[i] = { t: decoyTypes[i % 3], r: (i * 5 + 1) % 4 };
  }
  const pathNodes = pathIdx.map((pi) => ({ r: Math.floor(pi / size), c: pi % size }));
  const rand = seededRng(`fallback:${levelNum}`);
  const usedObstacles = new Set();
  for (const obsType of obstacleSchedule(levelNum)) {
    placeObstacle(cells, pathNodes, size, obsType, rand, usedObstacles);
  }
  const pathSet = new Set(pathIdx);
  const solution = Array(n).fill(null).map(() => emptySolutionCell());
  pathIdx.forEach((pi, i) => {
    if (BLOCKED.has(cells[pi].t)) {
      solution[pi] = { t: P.STR, r: cells[pi].r, ice: false, ...solutionFlagsForType(cells[pi].t) };
    } else {
      solution[pi] = { ...specs[i], ice: false, ...solutionFlagsForType(0) };
    }
  });
  scrambleGrid(cells, solution, rand, Math.max(levelNum, 10));
  const diff = analyzeDifficulty(cells, solution, size, pathSet);
  return {
    size,
    level: levelNum,
    world: worldForLevel(levelNum),
    cells,
    solution,
    moveLimit: Math.max(diff.minRotations + 2, requiredMinRotations(levelNum) + 2),
    pressureFactor: pressureForLevel(levelNum),
  };
}

function buildLevel(levelNum, employeeId, attempt) {
  const size = gridSizeForLevel(levelNum);
  const rand = seededRng(`${levelNum}:${employeeId}:pipeline:v4:${attempt}`);
  const minLen = minPathLength(levelNum, size);
  const path = generatePath(size, rand, minLen);
  if (path.length < minLen - 1) return null;

  const cells = Array(size * size).fill(null).map(() => ({ t: P.EMPTY, r: 0 }));
  const pathSet = new Set();

  path.forEach((node, i) => {
    const pi = idx(size, node.r, node.c);
    pathSet.add(pi);
    if (i === 0) {
      cells[pi] = { t: P.SRC, r: rotationForMask(P.SRC, node.outDir) };
    } else if (i === path.length - 1) {
      cells[pi] = { t: P.DRN, r: rotationForMask(P.DRN, node.inDir) };
    } else {
      const p = pipeForDirs(node.inDir, node.outDir);
      cells[pi] = { t: p.t, r: p.r };
    }
  });

  // Ложные трубы — плотнее, с тройниками
  const decoyChance = levelNum >= 80 ? 0.85 : levelNum >= 50 ? 0.78 : levelNum >= 20 ? 0.68 : levelNum >= 8 ? 0.58 : 0.48;
  for (let i = 0; i < size * size; i++) {
    if (cells[i].t !== P.EMPTY) continue;
    if (rand() > decoyChance) continue;
    const roll = rand();
    let t = P.STR;
    if (roll > 0.55) t = P.ELB;
    if (roll > 0.82 && levelNum >= 6) t = P.TEE;
    cells[i] = { t, r: Math.floor(rand() * 4) };
  }

  const usedObstacles = new Set();
  for (const obsType of obstacleSchedule(levelNum)) {
    placeObstacle(cells, path, size, obsType, rand, usedObstacles);
  }

  const iceCount = levelNum >= 100 ? 3 : levelNum >= 60 ? 2 : levelNum >= 20 ? 1 : 0;
  const inner = path.slice(1, -1);
  for (let ic = 0; ic < iceCount && inner.length; ic++) {
    const pool = inner.filter((n) => {
      const pi = idx(size, n.r, n.c);
      return !cells[pi].ice && !BLOCKED.has(cells[pi].t);
    });
    if (!pool.length) break;
    const iceNode = pool[Math.floor(rand() * pool.length)];
    cells[idx(size, iceNode.r, iceNode.c)].ice = true;
  }

  const solution = cells.map((c, i) => {
    if (!pathSet.has(i)) return emptySolutionCell();
    if (BLOCKED.has(c.t)) {
      return { t: P.STR, r: c.r, ice: !!c.ice, ...solutionFlagsForType(c.t) };
    }
    return { t: c.t, r: c.r, ice: !!c.ice, ...solutionFlagsForType(0) };
  });

  scrambleGrid(cells, solution, rand, levelNum);

  const diff = analyzeDifficulty(cells, solution, size, pathSet);
  const needRot = requiredMinRotations(levelNum);
  const needWrong = requiredWrongCells(levelNum);

  if (diff.alreadySolved) return null;
  if (diff.minRotations < needRot) return null;
  if (diff.wrongPathCells < needWrong) return null;

  const buffer = levelNum <= 10 ? 3 : levelNum <= 30 ? 2 : levelNum <= 80 ? 1 : 0;
  const obstacleExtra = usedObstacles.size;
  const moveLimit = diff.minRotations + buffer + obstacleExtra + (diff.minRotations > 15 ? 1 : 0);
  const pressureFactor = pressureForLevel(levelNum);

  return {
    size,
    level: levelNum,
    world: worldForLevel(levelNum),
    cells,
    solution,
    moveLimit,
    pressureFactor,
  };
}

function generateLevel(levelNum, employeeId) {
  const maxAttempts = levelNum >= 50 ? 80 : 40;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const level = buildLevel(levelNum, employeeId, attempt);
    if (level && isConnected(level.solution, level.size)) return level;
  }
  return fallbackLevel(levelNum);
}

function findEnds(grid, size) {
  let src = -1;
  let drn = -1;
  grid.forEach((c, i) => {
    if (c.t === P.SRC) src = i;
    if (c.t === P.DRN) drn = i;
  });
  return { src, drn };
}

function isConnected(grid, size) {
  const { src, drn } = findEnds(grid, size);
  if (src < 0 || drn < 0) return false;
  const q = [src];
  const vis = new Set([src]);
  while (q.length) {
    const cur = q.shift();
    if (cur === drn) return true;
    const cc = getConns(grid[cur]);
    for (let d = 0; d < 4; d++) {
      const [dr, dc, mb, tb] = DIRS[d];
      const nr = Math.floor(cur / size) + dr;
      const nc = cur % size + dc;
      if (!inBounds(size, nr, nc)) continue;
      const ni = idx(size, nr, nc);
      if (grid[ni].t === P.EMPTY) continue;
      if (isBlocked(grid[ni])) continue;
      if (!(cc & mb) || !(getConns(grid[ni]) & tb) || vis.has(ni)) continue;
      vis.add(ni);
      q.push(ni);
    }
  }
  return false;
}

function normalizeCell(init, submitted) {
  const base = {
    t: submitted.t,
    r: submitted.r,
    ice: !!submitted.ice,
    rustCleared: !!submitted.rustCleared,
    clogCleared: !!submitted.clogCleared,
    brokenCleared: !!submitted.brokenCleared,
    rootCleared: !!submitted.rootCleared,
  };
  if (init.t === P.RUST && submitted.t === P.STR && submitted.rustCleared) {
    return { ...base, t: P.STR, rustCleared: true };
  }
  if (init.t === P.CLOG && submitted.t === P.STR && submitted.clogCleared) {
    return { ...base, t: P.STR, clogCleared: true };
  }
  if (init.t === P.BROKEN && submitted.t === P.STR && submitted.brokenCleared) {
    return { ...base, t: P.STR, brokenCleared: true };
  }
  if (init.t === P.ROOT && submitted.t === P.STR && submitted.rootCleared) {
    return { ...base, t: P.STR, rootCleared: true };
  }
  return base;
}

function isObstacleRepair(init, submitted) {
  if (init.t === P.RUST && submitted.t === P.STR && submitted.rustCleared) return true;
  if (init.t === P.CLOG && submitted.t === P.STR && submitted.clogCleared) return true;
  if (init.t === P.BROKEN && submitted.t === P.STR && submitted.brokenCleared) return true;
  if (init.t === P.ROOT && submitted.t === P.STR && submitted.rootCleared) return true;
  return false;
}

function validateSubmission(initial, submitted, size, moveLimit, movesUsed) {
  if (!initial || !submitted || initial.length !== submitted.length) {
    return { ok: false, error: 'Некорректная сетка' };
  }
  if (movesUsed > moveLimit) {
    return { ok: false, error: 'Превышен лимит ходов' };
  }

  for (let i = 0; i < initial.length; i++) {
    const a = initial[i];
    const b = submitted[i];
    const rustOk = a.t === P.RUST && b.t === P.STR && b.rustCleared;
    const clogOk = a.t === P.CLOG && b.t === P.STR && b.clogCleared;
    const brokenOk = a.t === P.BROKEN && b.t === P.STR && b.brokenCleared;
    const rootOk = a.t === P.ROOT && b.t === P.STR && b.rootCleared;
    if (a.t !== b.t && !rustOk && !clogOk && !brokenOk && !rootOk) {
      return { ok: false, error: 'Подмена секций' };
    }
    if ([P.SRC, P.DRN, P.EMPTY].includes(a.t) && (a.t !== b.t || a.r !== b.r)) {
      return { ok: false, error: 'Источник или слив изменены' };
    }
    if (a.ice && !b.ice) {
      return { ok: false, error: 'Подмена секций' };
    }
  }

  const norm = submitted.map((c, i) => normalizeCell(initial[i], c));

  if (!isConnected(norm, size)) {
    return { ok: false, error: 'Поток не соединён' };
  }

  const stars = movesUsed <= moveLimit - 4 ? 3 : movesUsed <= moveLimit - 1 ? 2 : 1;
  return { ok: true, stars, grid: norm };
}

function computeRewards(levelNum, stars, dailyLevels, dailyXp, dailyRunes) {
  let baseXp = levelNum <= 10 ? 4 : levelNum <= 30 ? 8 : 12;
  let baseRunes = levelNum <= 10 ? 1 : levelNum <= 30 ? 2 : 3;
  if (stars === 3) { baseXp = Math.round(baseXp * 1.5); baseRunes = Math.round(baseRunes * 1.5); }
  else if (stars === 2) { baseXp = Math.round(baseXp * 1.2); }

  let mult = 1;
  if (dailyLevels >= 20) mult = 0.25;
  else if (dailyLevels >= 10) mult = 0.5;

  let xp = Math.round(baseXp * mult);
  let runes = Math.round(baseRunes * mult);

  const xpCap = 200;
  const runeCap = 30;
  xp = Math.min(xp, Math.max(0, xpCap - dailyXp));
  runes = Math.min(runes, Math.max(0, runeCap - dailyRunes));

  return { xp, runes };
}

module.exports = {
  P,
  generateLevel,
  isConnected,
  validateSubmission,
  computeRewards,
  worldForLevel,
  rotMask,
  getConns,
  isBlocked,
  analyzeDifficulty,
};
