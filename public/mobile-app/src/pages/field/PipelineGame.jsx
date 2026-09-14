import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { createPipelineBoard3D } from '@/lib/game3d/pipelineBoard3D';
import './pipeline-game.css';

const P = { EMPTY: 0, STR: 1, ELB: 2, TEE: 3, SRC: 5, DRN: 6, RUST: 7, CLOG: 8, BROKEN: 9, ROOT: 10 };
const CONN = [0, 0b1010, 0b1100, 0b1110, 0, 0b0100, 0b1000, 0b1010, 0b1010, 0b1010, 0b1010];
const DIRS = [[-1, 0, 1, 4], [0, 1, 2, 8], [1, 0, 4, 1], [0, -1, 8, 2]];

const TUTORIAL_KEY = 'pipeline_tutorial_v2';
const TUTORIAL_STEPS = [
  { icon: '🔧', title: 'Поворачивай трубы', text: 'Тап по секции — поворот. Соедини 💧 с 🏆 жирным металлическим путём.' },
  { icon: '🌊', title: 'Пусти поток', text: 'Когда путь готов — жми «Пустить поток» и смотри, как бежит вода.' },
  { icon: '⚡', title: 'Силы богов', text: 'Тор чинит, Фрейя показывает путь, Один подсвечивает клетку.' },
];

const GODS = {
  thor: { emoji: '🔨', name: 'ТОР', line: 'Мьёльнир крушит препятствия!' },
  heim: { emoji: '🌀', name: 'ФРЕЙЯ', line: 'Видит истинный путь потока' },
  odin: { emoji: '🧠', name: 'ОДИН', line: 'Шепчет, куда крутить' },
};

function worldClass(name = '') {
  const n = String(name).toUpperCase();
  if (n.includes('УТГАРД')) return 'world-utgard';
  if (n.includes('МИДГАРД')) return 'world-midgard';
  if (n.includes('НИФЛЬ')) return 'world-nifl';
  if (n.includes('МУСПЕЛЬ')) return 'world-muspel';
  if (n.includes('АСГАРД')) return 'world-asgard';
  return 'world-midgard';
}

function rotMask(mask, rot) {
  let m = mask;
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) m = ((m << 1) | (m >> 3)) & 0xf;
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

function isObstacle(cell) {
  return (cell.t === P.RUST && !cell.rustCleared)
    || (cell.t === P.CLOG && !cell.clogCleared)
    || (cell.t === P.BROKEN && !cell.brokenCleared)
    || (cell.t === P.ROOT && !cell.rootCleared);
}

function clearObstacle(cell, wasType) {
  return {
    t: P.STR,
    r: cell.r,
    ice: cell.ice,
    rustCleared: wasType === P.RUST,
    clogCleared: wasType === P.CLOG,
    brokenCleared: wasType === P.BROKEN,
    rootCleared: wasType === P.ROOT,
  };
}

function normalizeCell(c) {
  return {
    t: c.t,
    r: c.r || 0,
    ice: !!c.ice,
    rustCleared: !!c.rustCleared,
    clogCleared: !!c.clogCleared,
    brokenCleared: !!c.brokenCleared,
    rootCleared: !!c.rootCleared,
  };
}

function initCell(c) {
  return {
    ...c,
    r: c.r || 0,
    ice: !!c.ice,
    rustCleared: false,
    clogCleared: false,
    brokenCleared: false,
    rootCleared: false,
  };
}

function frameSize(size) {
  if (size >= 8) return { maxWidth: 360, gap: 2, icon: 15, obstacle: 18 };
  if (size >= 7) return { maxWidth: 344, gap: 2, icon: 16, obstacle: 19 };
  if (size >= 6) return { maxWidth: 328, gap: 3, icon: 17, obstacle: 20 };
  return { maxWidth: 312, gap: 3, icon: 18, obstacle: 22 };
}

/** Толстые металлические трубы (bevel). */
function pipeSVG(cell, connected, flowing) {
  const c = getConns(cell);
  const arms = [{ b: 1, x: 50, y: 8 }, { b: 2, x: 92, y: 50 }, { b: 4, x: 50, y: 92 }, { b: 8, x: 8, y: 50 }];
  const active = arms.filter((d) => c & d.b);
  if (!active.length) return '';
  const cls = flowing ? 'flowing' : connected ? 'connected' : '';
  const lines = (layer) => active.map((d) =>
    `<line class="pp-pipe-${layer} ${cls}" x1="50" y1="50" x2="${d.x}" y2="${d.y}"/>`
  ).join('');
  return `<svg class="pp-svg" viewBox="0 0 100 100">
    ${lines('outer')}${lines('mid')}${lines('inner')}
    <circle class="pp-joint-ring ${cls}" cx="50" cy="50" r="11"/>
    <circle class="pp-joint-core ${cls}" cx="50" cy="50" r="7"/>
  </svg>`;
}

function bfs(grid, size) {
  const src = grid.findIndex((c) => c.t === P.SRC);
  const drn = grid.findIndex((c) => c.t === P.DRN);
  const reachable = new Set();
  const path = [];
  if (src < 0) return { reachable, path, ok: false };
  const q = [src];
  const vis = new Set([src]);
  const parent = new Map();
  while (q.length) {
    const cur = q.shift();
    reachable.add(cur);
    const cc = getConns(grid[cur]);
    for (let d = 0; d < 4; d++) {
      const [dr, dc, mb, tb] = DIRS[d];
      const nr = Math.floor(cur / size) + dr;
      const nc = (cur % size) + dc;
      if (nr < 0 || nc < 0 || nr >= size || nc >= size) continue;
      const ni = nr * size + nc;
      if (grid[ni].t === P.EMPTY || isBlocked(grid[ni])) continue;
      if (!(cc & mb) || !(getConns(grid[ni]) & tb) || vis.has(ni)) continue;
      vis.add(ni);
      parent.set(ni, cur);
      q.push(ni);
    }
  }
  if (reachable.has(drn)) {
    let c = drn;
    while (c !== undefined) { path.unshift(c); c = parent.get(c); }
  }
  return { reachable, path, ok: path.length > 0 };
}

function playTone(freq = 440, dur = 0.08, type = 'sine', gain = 0.08) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!playTone._ctx) playTone._ctx = new Ctx();
    const ctx = playTone._ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.stop(ctx.currentTime + dur);
  } catch { /* silent */ }
}

function useCountUp(target, active, duration = 900) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!active) { setVal(0); return; }
    const end = Number(target) || 0;
    const start = performance.now();
    let raf;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const ease = 1 - (1 - t) ** 3;
      setVal(Math.round(ease * end));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, active, duration]);
  return val;
}

export default function PipelineGame() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const gridRef = useRef([]);
  const movesUsedRef = useRef(0);
  const sessionRef = useRef(null);
  const linkedRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [session, setSession] = useState(null);
  const [grid, setGrid] = useState([]);
  const [size, setSize] = useState(5);
  const [movesLeft, setMovesLeft] = useState(0);
  const [hint, setHint] = useState('Поворачивай секции — соедини 💧 со сливом 🏆');
  const [hintErr, setHintErr] = useState(false);
  const [hintOk, setHintOk] = useState(false);
  const [pressure, setPressure] = useState(0);
  const [flowing, setFlowing] = useState(false);
  const [flowPath, setFlowPath] = useState([]);
  const [ghostPath, setGhostPath] = useState([]);
  const [highlight, setHighlight] = useState(-1);
  const [odinClicks, setOdinClicks] = useState(0);
  const [odinTargetRot, setOdinTargetRot] = useState(null);
  const [flashIdx, setFlashIdx] = useState(-1);
  const [pulseCells, setPulseCells] = useState([]);
  const [win, setWin] = useState(null);
  const [failed, setFailed] = useState(false);
  const [shake, setShake] = useState(false);
  const [linked, setLinked] = useState(false);
  const [boardEnter, setBoardEnter] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  const [godFx, setGodFx] = useState(null);
  const [screenFlash, setScreenFlash] = useState(false);
  const [winStarsOn, setWinStarsOn] = useState(0);
  const [particles, setParticles] = useState([]);
  const [powers, setPowers] = useState({ thor: true, heim: true, odin: true });
  const [busy, setBusy] = useState(false);
  const [pressureFactor, setPressureFactor] = useState(1);
  const [tutStep, setTutStep] = useState(() => {
    try { return localStorage.getItem(TUTORIAL_KEY) ? -1 : 0; } catch { return 0; }
  });
  const srcTapsRef = useRef({ n: 0, t: 0 });
  const drnTapsRef = useRef({ n: 0, t: 0 });
  const [raven, setRaven] = useState(false);
  const [valhalla, setValhalla] = useState(false);
  const boardCanvasRef = useRef(null);
  const boardApiRef = useRef(null);
  const [board3d, setBoard3d] = useState(false);

  const xpShown = useCountUp(win?.total_xp ?? win?.xp ?? 0, !!win, 950);
  const runesShown = useCountUp(win?.total_runes ?? win?.runes ?? 0, !!win, 950);

  const burst = useCallback((count = 14) => {
    const items = Array.from({ length: count }, (_, i) => ({
      id: `${Date.now()}-${i}`,
      left: 35 + Math.random() * 30,
      top: 35 + Math.random() * 30,
      dx: `${(Math.random() - 0.5) * 160}px`,
      dy: `${-50 - Math.random() * 100}px`,
      color: i % 3 === 0 ? '#F0C850' : i % 3 === 1 ? '#38bdf8' : '#a78bfa',
    }));
    setParticles(items);
    setTimeout(() => setParticles([]), 800);
  }, []);

  const playIntro = useCallback(() => {
    setShowIntro(true);
    setBoardEnter(false);
    playTone(280, 0.08, 'triangle', 0.06);
    setTimeout(() => playTone(420, 0.1, 'triangle', 0.07), 120);
    setTimeout(() => {
      setShowIntro(false);
      setBoardEnter(true);
      playTone(560, 0.08, 'sine', 0.05);
    }, 1350);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setHintErr(false);
    setHintOk(false);
    setFailed(false);
    setHighlight(-1);
    setOdinClicks(0);
    setOdinTargetRot(null);
    setGhostPath([]);
    setFlashIdx(-1);
    setPulseCells([]);
    setLinked(false);
    linkedRef.current = false;
    setWinStarsOn(0);
    try {
      const [st, w] = await Promise.all([
        fieldApi.get('/pipeline/stats'),
        fieldApi.get('/gamification/wallet'),
      ]);
      setStats(st);
      setWallet(w);
      const start = await fieldApi.post('/pipeline/start', { level: st.next_level });
      const cells = start.cells.map(initCell);
      setSession(start);
      sessionRef.current = start;
      setGrid(cells);
      gridRef.current = cells;
      setSize(start.size);
      setMovesLeft(start.move_limit);
      movesUsedRef.current = 0;
      setPressureFactor(start.pressure_factor || 1);
      setWin(null);
      setPowers({ thor: true, heim: true, odin: true });
      setPressure(0);
      setFlowing(false);
      setFlowPath([]);
      setHint('Поворачивай секции — соедини 💧 со сливом 🏆');
      setLoading(false);
      playIntro();
    } catch {
      setHint('Не удалось загрузить уровень. Проверь связь.');
      setHintErr(true);
      setLoading(false);
    }
  }, [playIntro]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (loading) return undefined;
    const canvas = boardCanvasRef.current;
    if (!canvas || !board3d) return undefined;
    let alive = true;
    createPipelineBoard3D(canvas).then((api) => {
      if (!alive) {
        api?.dispose?.();
        return;
      }
      if (!api) {
        setBoard3d(false);
        return;
      }
      boardApiRef.current = api;
      api.setState({
        grid: gridRef.current,
        size,
        reachable: new Set(),
        flowPath: [],
        ghostPath: [],
        worldName: sessionRef.current?.world?.name,
      });
    });
    return () => {
      alive = false;
      boardApiRef.current?.dispose?.();
      boardApiRef.current = null;
    };
  }, [board3d, loading, size]);

  useEffect(() => {
    if (movesLeft === 0 && !win && !flowing && !loading && session && !failed) {
      const { ok } = bfs(gridRef.current, size);
      if (!ok) {
        setFailed(true);
        setShake(true);
        setTimeout(() => setShake(false), 400);
      }
    }
  }, [movesLeft, win, flowing, loading, session, failed, size]);

  const conn = useMemo(() => bfs(grid, size), [grid, size]);

  useEffect(() => {
    boardApiRef.current?.setState?.({
      grid,
      size,
      reachable: conn.reachable,
      flowPath,
      ghostPath,
      highlight,
      flashIdx,
      pulseCells,
      worldName: session?.world?.name,
    });
  }, [grid, size, conn.reachable, flowPath, ghostPath, highlight, flashIdx, pulseCells, session]);

  useEffect(() => {
    if (conn.ok && !linkedRef.current && !flowing && !win) {
      linkedRef.current = true;
      setLinked(true);
      setPulseCells(conn.path);
      setHintOk(true);
      setHintErr(false);
      setHint('Путь собран! 🌊 Жми «Пустить поток»');
      haptic.success();
      playTone(480, 0.07, 'triangle', 0.07);
      setTimeout(() => playTone(640, 0.1, 'triangle', 0.07), 90);
      burst(10);
      setTimeout(() => setPulseCells([]), 700);
    } else if (!conn.ok && linkedRef.current) {
      linkedRef.current = false;
      setLinked(false);
      setHintOk(false);
    }
  }, [conn.ok, conn.path, flowing, win, haptic, burst]);

  useEffect(() => {
    if (!win) { setWinStarsOn(0); return; }
    setWinStarsOn(0);
    const stars = win.stars || 1;
    const timers = [];
    for (let i = 1; i <= stars; i++) {
      timers.push(setTimeout(() => {
        setWinStarsOn(i);
        playTone(400 + i * 120, 0.1, 'triangle', 0.08);
        haptic.medium();
      }, 280 * i));
    }
    timers.push(setTimeout(() => burst(22), 200));
    return () => timers.forEach(clearTimeout);
  }, [win, haptic, burst]);

  const spendMoves = (cost) => {
    movesUsedRef.current += cost;
    setMovesLeft((m) => Math.max(0, m - cost));
  };

  const rotate = (i) => {
    if (busy || flowing || win || failed || showIntro) return;
    const cell = grid[i];
    if (cell?.t === P.SRC) {
      const now = Date.now();
      if (now - srcTapsRef.current.t > 1400) srcTapsRef.current.n = 0;
      srcTapsRef.current.t = now;
      srcTapsRef.current.n += 1;
      if (srcTapsRef.current.n >= 5) {
        srcTapsRef.current.n = 0;
        setRaven(true);
        setHint('Ворон Одина пролетел над трубами. Он видел путь.');
        setHintOk(true);
        setHintErr(false);
        playTone(880, 0.12, 'triangle', 0.06);
        setTimeout(() => setRaven(false), 2500);
      }
      return;
    }
    if (cell?.t === P.DRN) {
      const now = Date.now();
      if (now - drnTapsRef.current.t > 1600) drnTapsRef.current.n = 0;
      drnTapsRef.current.t = now;
      drnTapsRef.current.n += 1;
      if (drnTapsRef.current.n >= 4) {
        drnTapsRef.current.n = 0;
        setValhalla(true);
        setHint('Слив Вальгаллы открылся на миг. Трубы запели.');
        setHintOk(true);
        setHintErr(false);
        burst(18);
        playTone(520, 0.1, 'triangle', 0.07);
        setTimeout(() => playTone(780, 0.14, 'triangle', 0.06), 90);
        setTimeout(() => setValhalla(false), 1600);
      }
      return;
    }
    if (!cell || [P.EMPTY, P.DRN].includes(cell.t)) return;
    if (isObstacle(cell)) {
      const msg = cell.t === P.RUST ? '🪨 Ржавчина! Используй 🔨 Тора'
        : cell.t === P.CLOG ? '🧱 Засор! Тор или Фрейя'
          : cell.t === P.BROKEN ? '💔 Трещина! Почини 🔨 Тором'
            : '🌿 Корни! Убери 🌀 Фрейей';
      setHint(msg); setHintErr(true); setHintOk(false);
      haptic.error();
      playTone(180, 0.1, 'sawtooth', 0.04);
      return;
    }
    if (movesLeft <= 0) {
      setFailed(true);
      setHint('Ходы закончились — нажми «Заново»');
      setHintErr(true);
      haptic.error();
      return;
    }
    const cost = cell.ice ? 2 : 1;
    if (movesLeft < cost) {
      setHint(`❄ Ледяная секция — нужно ${cost} хода`);
      setHintErr(true);
      haptic.error();
      return;
    }
    haptic.light();
    playTone(360 + (cell.r || 0) * 40, 0.05, 'square', 0.045);
    const newRot = ((cell.r || 0) + 1) % 4;
    const next = grid.map((c, idx) => (idx === i ? { ...c, r: newRot } : c));
    setGrid(next);
    gridRef.current = next;
    spendMoves(cost);
    setHintErr(false);
    // Подсветка Одина держится, пока клетка не дойдёт до целевого угла
    if (highlight === i && odinTargetRot != null) {
      const left = (odinTargetRot - newRot + 4) % 4;
      if (left === 0) {
        setHighlight(-1);
        setOdinClicks(0);
        setOdinTargetRot(null);
        setHint('Один: клетка верна — продолжай путь');
        setHintOk(true);
      } else {
        setOdinClicks(left);
        setHint(left === 1 ? 'Один: ещё один поворот' : `Один: ещё ${left} поворота`);
        setHintOk(true);
      }
    } else if (highlight !== i) {
      // крутим другую клетку — подсветку Одина не сбрасываем
      if (!cell.ice) setHint('Поворачивай секции — соедини 💧 со сливом 🏆');
      else setHint('❄ Ледяная труба — поворот стоит 2 хода');
    } else {
      setHighlight(-1);
      setOdinClicks(0);
      setOdinTargetRot(null);
      if (!cell.ice) setHint('Поворачивай секции — соедини 💧 со сливом 🏆');
      else setHint('❄ Ледяная труба — поворот стоит 2 хода');
    }
  };

  const flashGod = (type) => {
    setGodFx(type);
    setScreenFlash(true);
    setTimeout(() => setScreenFlash(false), 320);
    setTimeout(() => setGodFx(null), 700);
  };

  const usePower = async (type) => {
    if (busy || flowing || win || failed || !powers[type] || !sessionRef.current || showIntro) return;
    setBusy(true);
    flashGod(type);
    haptic.medium();
    playTone(520, 0.1, 'triangle', 0.07);
    try {
      const res = await fieldApi.post('/pipeline/power', {
        session_id: sessionRef.current.session_id,
        power: type,
        cells: gridRef.current.map(normalizeCell),
      });
      if (Number.isInteger(res.clear_index)) {
        const was = gridRef.current[res.clear_index].t;
        const next = gridRef.current.map((c, i) => (i === res.clear_index ? clearObstacle(c, was) : c));
        setGrid(next);
        gridRef.current = next;
        setFlashIdx(res.clear_index);
        setTimeout(() => setFlashIdx(-1), 500);
        burst(12);
        playTone(660, 0.12, 'triangle', 0.08);
      }
      if (Array.isArray(res.ghost_path) && res.ghost_path.length) {
        setGhostPath(res.ghost_path);
        setFlowPath(res.ghost_path);
        setTimeout(() => { setGhostPath([]); setFlowPath([]); }, 3000);
        playTone(480, 0.14, 'sine', 0.07);
      }
      if (Number.isInteger(res.highlight_index)) {
        setHighlight(res.highlight_index);
        setOdinClicks(res.clicks || 1);
        setOdinTargetRot(Number.isInteger(res.target_rot) ? res.target_rot : null);
        playTone(720, 0.1, 'sine', 0.06);
      }
      setHint(res.message || 'Готово');
      setHintErr(false);
      setHintOk(true);
      if (res.spent !== false) setPowers((p) => ({ ...p, [type]: false }));
    } catch (e) {
      setHint(e?.body?.error || e?.message || 'Сила недоступна');
      setHintErr(true);
      setHintOk(false);
      haptic.error();
    } finally {
      setBusy(false);
    }
  };

  const startFlow = async () => {
    if (busy || flowing || win || !sessionRef.current || showIntro) return;
    const currentGrid = gridRef.current;
    const { ok, path } = bfs(currentGrid, size);
    if (!ok) {
      setHint('Сначала соедини все трубы!');
      setHintErr(true); setHintOk(false);
      setShake(true);
      setTimeout(() => setShake(false), 350);
      haptic.error();
      playTone(160, 0.12, 'sawtooth', 0.05);
      return;
    }
    if (movesUsedRef.current > sessionRef.current.move_limit) {
      setFailed(true);
      setHint('Превышен лимит ходов');
      setHintErr(true);
      haptic.error();
      return;
    }
    setFlowing(true);
    setBusy(true);
    setHintErr(false);
    setFailed(false);
    setShake(true);
    setTimeout(() => setShake(false), 280);
    haptic.medium();
    const stepMs = Math.max(50, Math.round(95 / pressureFactor));
    for (let s = 0; s <= path.length; s++) {
      setFlowPath(path.slice(0, s));
      setPressure(Math.min(100, (s / Math.max(path.length, 1)) * 100));
      if (s > 0) playTone(280 + s * 20, 0.04, 'sine', 0.04);
      await new Promise((r) => setTimeout(r, stepMs));
    }
    try {
      const res = await fieldApi.post('/pipeline/complete', {
        session_id: sessionRef.current.session_id,
        cells: currentGrid.map(normalizeCell),
        moves_used: movesUsedRef.current,
      });
      setWin(res);
      setPressure(100);
      burst(24);
      haptic.success();
      playTone(520, 0.1, 'triangle', 0.09);
      setTimeout(() => playTone(780, 0.14, 'triangle', 0.08), 100);
      const w = await fieldApi.get('/gamification/wallet').catch(() => wallet);
      if (w) setWallet(w);
    } catch (e) {
      const msg = e?.body?.error || e?.message || 'Не удалось завершить уровень';
      setHint(msg);
      setHintErr(true);
      haptic.error();
      setFlowing(false);
      setFlowPath([]);
      setPressure(0);
      if (/лимит|ходы/i.test(msg)) setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const nextLevel = () => { haptic.medium(); load(); };
  const restartLevel = () => { haptic.medium(); playTone(400, 0.06, 'triangle', 0.05); load(); };
  const finishTutorial = () => {
    try { localStorage.setItem(TUTORIAL_KEY, '1'); } catch { /* */ }
    setTutStep(-1);
  };

  const world = session?.world;
  const wCls = worldClass(world?.name);
  const layout = frameSize(size);
  const showTut = !showIntro && tutStep >= 0 && tutStep < TUTORIAL_STEPS.length && (session?.level || 1) <= 3;

  if (loading) {
    return (
      <div className={`pp-root ${wCls}`}>
        <div className="pp-loading">
          <div className="pp-loading-orb" />
          Загрузка Рунопровода…
        </div>
      </div>
    );
  }

  return (
    <div className={`pp-root ${wCls}`}>
      <div className="pp-bg">
        <div className="pp-glow pp-g1" />
        <div className="pp-glow pp-g2" />
        <div className="pp-glow pp-g3" />
        <div className="pp-pattern" />
      </div>
      <div className="pp-fx" aria-hidden>
        {particles.map((p) => (
          <span
            key={p.id}
            className="pp-particle"
            style={{ left: `${p.left}%`, top: `${p.top}%`, background: p.color, '--dx': p.dx, '--dy': p.dy }}
          />
        ))}
      </div>

      <div className="pp-page">
        <div className="pp-scroll">
          <header className="pp-top">
            <button type="button" className="pp-back" onClick={() => navigate(-1)} aria-label="Назад">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="rgba(255,255,255,.75)" strokeWidth="2.2"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div className="pp-title">РУНОПРОВОД</div>
              <div className="pp-sub">ГИДРОМЕХАНИК АСГАРДА</div>
            </div>
            <button type="button" className="pp-restart" onClick={restartLevel} disabled={busy || flowing}>↻ Заново</button>
            <div className="pp-wallet"><span style={{ fontSize: 11, fontWeight: 900, color: '#5a3e00' }}>ᚱ</span><span className="pp-bal">{wallet?.runes ?? '—'}</span></div>
          </header>

          <div className="pp-hud">
            <div className="pp-hud-row">
              <span className="pp-world-pill">{world?.icon || '🌊'} {world?.name || 'МИДГАРД'}</span>
              <span className="pp-lvl">УР. {session?.level}</span>
              <span>{[0, 1, 2].map((i) => <span key={i} className={`pp-star ${(win?.stars || 0) > i ? 'on' : ''}`}>⭐</span>)}</span>
            </div>
            <div className="pp-gauge">
              <div className="pp-gauge-dial" style={{ '--p': pressure }}>
                <span>{Math.round(pressure)}%</span>
              </div>
              <div className="pp-gauge-meta">
                <div><b>Давление потока</b></div>
                <div>
                  Ходы <b>{movesLeft}</b>/{session?.move_limit}
                  {stats ? <> · Серия <b>{stats.current_streak}</b> · Макс <b>{stats.max_level}</b></> : null}
                </div>
              </div>
            </div>
          </div>

          <div className={`pp-hint ${hintErr ? 'err' : ''} ${hintOk ? 'ok' : ''}`}>{hint}</div>

          <div className="pp-game">
            <div
              className={`pp-frame ${boardEnter ? 'enter' : ''} ${shake ? 'shake' : ''} ${linked ? 'linked' : ''} ${failed ? 'fail-vignette' : ''}`}
              style={{ maxWidth: layout.maxWidth }}
            >
              {board3d && <canvas ref={boardCanvasRef} className="pp-board3d" aria-hidden />}
              <div className={`pp-moves ${movesLeft <= 2 ? 'low' : ''}`}>{movesLeft} ход.</div>
              <div
                className={`pp-grid${board3d ? ' is-3d' : ''}`}
                style={{
                  gridTemplateColumns: `repeat(${size}, 1fr)`,
                  gridTemplateRows: `repeat(${size}, 1fr)`,
                  gap: layout.gap,
                }}
              >
                {grid.map((cell, i) => {
                  const isConn = conn.reachable.has(i);
                  const isFlow = flowPath.includes(i);
                  const isFlowHead = flowing && flowPath.length > 0 && i === flowPath[flowPath.length - 1];
                  const isGhost = ghostPath.includes(i);
                  const isRust = cell.t === P.RUST && !cell.rustCleared;
                  const isClog = cell.t === P.CLOG && !cell.clogCleared;
                  const isBroken = cell.t === P.BROKEN && !cell.brokenCleared;
                  const isRoot = cell.t === P.ROOT && !cell.rootCleared;
                  const isIce = !!cell.ice;
                  let inner = '';
                  if (cell.t === P.SRC) {
                    inner = `${pipeSVG(cell, isConn, isFlow)}<div class="pp-icon" style="font-size:${layout.icon}px">💧</div>`;
                  } else if (cell.t === P.DRN) {
                    inner = `${pipeSVG(cell, isConn, isFlow)}<div class="pp-icon" style="font-size:${layout.icon}px">🏆</div>`;
                  } else if (cell.t !== P.EMPTY) {
                    inner = pipeSVG(cell, isConn, isFlow);
                    if (isRust) inner += `<span class="pp-obstacle" style="font-size:${layout.obstacle}px">🪨</span>`;
                    if (isClog) inner += `<span class="pp-obstacle" style="font-size:${layout.obstacle}px">🧱</span>`;
                    if (isBroken) inner += `<span class="pp-obstacle" style="font-size:${layout.obstacle}px">💔</span>`;
                    if (isRoot) inner += `<span class="pp-obstacle" style="font-size:${layout.obstacle}px">🌿</span>`;
                  }
                  if (highlight === i && odinClicks > 0) {
                    inner += `<span class="pp-arrow">${odinClicks === 1 ? '↻' : odinClicks}</span>`;
                  }
                  return (
                    <div
                      key={i}
                      className={[
                        'pp-cell',
                        isConn ? 'conn' : '',
                        isFlow ? 'flow' : '',
                        isFlowHead ? 'flow-head' : '',
                        (cell.t === P.SRC && isConn) ? 'src-live' : '',
                        isGhost ? 'ghost' : '',
                        highlight === i ? 'hl' : '',
                        flashIdx === i ? 'flash' : '',
                        pulseCells.includes(i) ? 'pulse-link' : '',
                        isRust ? 'rust' : '',
                        isClog ? 'clog' : '',
                        isBroken ? 'broken' : '',
                        isRoot ? 'root' : '',
                        isIce ? 'ice' : '',
                      ].filter(Boolean).join(' ')}
                      style={cell.t === P.EMPTY ? { opacity: 0.08, pointerEvents: 'none' } : undefined}
                      onClick={() => rotate(i)}
                      dangerouslySetInnerHTML={{ __html: inner }}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="pp-bottom">
          <div className="pp-powers">
            {[
              { k: 'thor', ic: '🔨', label: 'ТОР', sub: 'Чинит ржав / засор / трещину' },
              { k: 'heim', ic: '🌀', label: 'ФРЕЙЯ', sub: 'Корни + показывает путь' },
              { k: 'odin', ic: '🧠', label: 'ОДИН', sub: 'Подсветит нужную клетку' },
            ].map(({ k, ic, label, sub }) => (
              <button key={k} type="button" className={`pp-power ${powers[k] ? '' : 'off'}`} onClick={() => usePower(k)}>
                <span className="pp-power-ic">{ic}</span>
                <span className="pp-power-name">{label}</span>
                <span className="pp-power-sub">{sub}</span>
              </button>
            ))}
          </div>
          <div className="pp-actions">
            <button type="button" className="pp-btn" disabled={busy || flowing || !!win || failed || showIntro} onClick={startFlow}>
              {flowing ? '🌊 ПОТОК ИДЁТ…' : linked ? '🌊 ПУСТИТЬ ПОТОК!' : '🌊 ПУСТИТЬ ПОТОК'}
            </button>
          </div>
        </div>
      </div>

      {showIntro && (
        <div className="pp-intro">
          <div className="pp-intro-card">
            <div className="pp-intro-icon">{world?.icon || '🌊'}</div>
            <div className="pp-intro-world">{world?.name || 'МИР'}</div>
            <div className="pp-intro-lvl">УРОВЕНЬ {session?.level}</div>
          </div>
        </div>
      )}

      {screenFlash && <div className="pp-screen-flash" />}
      {raven && <div className="pp-raven" aria-hidden>🐦‍⬛</div>}
      {valhalla && <div className="pp-valhalla" aria-hidden />}
      {godFx && GODS[godFx] && (
        <div className="pp-god">
          <div className="pp-god-card">
            <span className="pp-god-emoji">{GODS[godFx].emoji}</span>
            <div className="pp-god-name">{GODS[godFx].name}</div>
            <div className="pp-god-line">{GODS[godFx].line}</div>
          </div>
        </div>
      )}

      {failed && !win && (
        <div className="pp-ov">
          <div className="pp-win fail">
            <div style={{ fontSize: 52 }}>💥</div>
            <div className="pp-win-title" style={{ color: 'var(--red)' }}>ХОДЫ КОНЧИЛИСЬ</div>
            <div style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 8 }}>
              Уровень ещё можно пройти — полный запас ходов ждёт.
            </div>
            <button type="button" className="pp-win-btn" onClick={restartLevel}>↻ ЗАНОВО</button>
            <button type="button" className="pp-win-link" onClick={() => navigate('/field/home')}>В Зал Рабочих</button>
          </div>
        </div>
      )}

      {win && (
        <div className="pp-ov">
          <div className="pp-win">
            <div className="pp-chest" />
            <div style={{ fontSize: 11, fontWeight: 900, color: 'var(--cyan)', letterSpacing: '.14em' }}>ПОТОК ВОССТАНОВЛЕН</div>
            <div className="pp-win-title">УРОВЕНЬ ПРОЙДЕН!</div>
            <div className="pp-star-row">
              {[1, 2, 3].map((i) => (
                <span key={i} className={`pp-star-big ${winStarsOn >= i ? 'on' : ''}`}>⭐</span>
              ))}
            </div>
            <div style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 10 }}>
              {world?.name} · Уровень {win.level}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div className="pp-reward" style={{ background: 'rgba(165,110,255,.16)', color: '#C4B5FD' }}>+{xpShown} XP</div>
              <div className="pp-reward" style={{ background: 'rgba(240,200,80,.14)', color: 'var(--gold)' }}>+{runesShown} ᚱ</div>
            </div>
            {(win.bonus_xp > 0 || win.bonus_runes > 0) && (
              <div className="pp-bonus">
                🎁 Бонусы: {win.bonus_xp > 0 ? `+${win.bonus_xp} XP` : ''}
                {win.bonus_xp > 0 && win.bonus_runes > 0 ? ' · ' : ''}
                {win.bonus_runes > 0 ? `+${win.bonus_runes} ᚱ` : ''}
              </div>
            )}
            {win.current_streak >= 3 && (
              <div style={{ marginTop: 10, fontSize: 13, color: 'var(--gold)', fontWeight: 800 }}>🔥 Серия {win.current_streak} уровней!</div>
            )}
            <button type="button" className="pp-win-btn" onClick={nextLevel}>СЛЕДУЮЩИЙ УРОВЕНЬ →</button>
            <button type="button" className="pp-win-link" onClick={() => navigate('/field/leaderboard?tab=pipeline')}>🏆 Рейтинг Рунопровода</button>
          </div>
        </div>
      )}

      {showTut && (
        <div className="pp-tut">
          <div className="pp-tut-card">
            <div style={{ fontSize: 42, marginBottom: 8 }}>{TUTORIAL_STEPS[tutStep].icon}</div>
            <h3>{TUTORIAL_STEPS[tutStep].title}</h3>
            <p>{TUTORIAL_STEPS[tutStep].text}</p>
            <button
              type="button"
              className="pp-win-btn"
              style={{ marginTop: 0 }}
              onClick={() => {
                if (tutStep >= TUTORIAL_STEPS.length - 1) finishTutorial();
                else setTutStep((s) => s + 1);
              }}
            >
              {tutStep >= TUTORIAL_STEPS.length - 1 ? 'ИГРАТЬ!' : 'ДАЛЬШЕ →'}
            </button>
            <button type="button" className="pp-win-link" onClick={finishTutorial}>Пропустить</button>
          </div>
        </div>
      )}
    </div>
  );
}
