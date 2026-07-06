import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';

const P = { EMPTY: 0, STR: 1, ELB: 2, TEE: 3, SRC: 5, DRN: 6, RUST: 7, CLOG: 8, BROKEN: 9, ROOT: 10 };
const CONN = [0, 0b1010, 0b1100, 0b1110, 0, 0b0100, 0b1000, 0b1010, 0b1010, 0b1010, 0b1010];
const DIRS = [[-1, 0, 1, 4], [0, 1, 2, 8], [1, 0, 4, 1], [0, -1, 8, 2]];

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

function obstacleLabel(t) {
  if (t === P.RUST) return 'ржавчину';
  if (t === P.CLOG) return 'засор';
  if (t === P.BROKEN) return 'трещину';
  if (t === P.ROOT) return 'корни';
  return 'препятствие';
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
  if (size >= 8) return { maxWidth: 360, gap: 2, icon: 13, obstacle: 9 };
  if (size >= 7) return { maxWidth: 340, gap: 2, icon: 14, obstacle: 9 };
  if (size >= 6) return { maxWidth: 320, gap: 3, icon: 15, obstacle: 10 };
  return { maxWidth: 300, gap: 3, icon: 16, obstacle: 10 };
}

function pipeSVG(cell, idx, connected, flowing) {
  const c = getConns(cell);
  const cx = 50, cy = 50;
  const arms = [{ b: 1, x: 50, y: 12 }, { b: 2, x: 88, y: 50 }, { b: 4, x: 50, y: 88 }, { b: 8, x: 12, y: 50 }];
  const active = arms.filter((d) => c & d.b);
  if (!active.length) return null;
  const cls = flowing ? 'flowing' : connected ? 'connected' : '';
  const paths = active.map((d) =>
    `<line class="pp-body pb-${idx} ${cls}" x1="${cx}" y1="${cy}" x2="${d.x}" y2="${d.y}"/>`
  ).join('');
  return `<svg class="pp-svg" viewBox="0 0 100 100">${paths}<circle class="pp-joint pj-${idx} ${cls}" cx="${cx}" cy="${cy}" r="8"/></svg>`;
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
      const nc = cur % size + dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
      const ni = nr * size + nc;
      if (grid[ni].t === P.EMPTY) continue;
      if (isBlocked(grid[ni])) continue;
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

const CSS = `
.pp-root{--bg:#0b0e1a;--card:#141828;--card2:#1a2040;--gold:#F0C850;--cyan:#38bdf8;--red:#E84057;
  --t1:#fff;--t2:rgba(255,255,255,.7);--t3:rgba(255,255,255,.4);
  background:var(--bg);color:var(--t1);font-family:-apple-system,BlinkMacSystemFont,'SF Pro Round',system-ui,sans-serif;
  height:100dvh;overflow:hidden;display:flex;flex-direction:column;max-width:430px;margin:0 auto;position:relative}
.pp-bg{position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none}
.pp-glow{position:absolute;border-radius:50%;filter:blur(80px);opacity:.25}
.pp-g1{width:300px;height:300px;top:-50px;left:-50px;background:var(--cyan)}
.pp-g2{width:250px;height:250px;bottom:-30px;right:-60px;background:#A56EFF}
.pp-page{position:relative;z-index:5;display:flex;flex-direction:column;height:100%;min-height:0}
.pp-scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch}
.pp-top{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;padding-top:max(env(safe-area-inset-top),10px)}
.pp-back{width:36px;height:36px;border-radius:12px;background:rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center;border:none;cursor:pointer}
.pp-title{font-family:Cinzel,serif;font-size:15px;font-weight:900;letter-spacing:.12em;color:var(--gold)}
.pp-sub{font-size:8px;color:var(--t3);letter-spacing:.16em;text-align:center;margin-top:2px}
.pp-wallet{display:flex;align-items:center;gap:5px;padding:5px 11px;background:linear-gradient(135deg,#2a2008,#1a1505);border:1.5px solid rgba(240,200,80,.28);border-radius:20px}
.pp-bal{font-size:14px;font-weight:800;color:var(--gold)}
.pp-bar{margin:4px 16px;padding:8px 12px;border-radius:16px;background:var(--card);border:1px solid rgba(255,255,255,.04)}
.pp-bar-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
.pp-world{font-size:12px;font-weight:800;color:var(--cyan)}
.pp-lvl{font-family:Cinzel,serif;font-size:13px;font-weight:900;color:var(--gold)}
.pp-star{font-size:16px;opacity:.2;transition:all .3s}
.pp-star.on{opacity:1;filter:drop-shadow(0 0 6px rgba(240,200,80,.6))}
.pp-press-track{height:8px;border-radius:5px;background:rgba(255,255,255,.06);overflow:hidden;margin-top:4px}
.pp-press-fill{height:100%;border-radius:5px;transition:width .15s linear}
.pp-meta{font-size:10px;color:var(--t3);margin-top:4px;display:flex;gap:8px;flex-wrap:wrap}
.pp-hint{margin:4px 16px 6px;padding:7px 12px;border-radius:14px;background:var(--card2);border:1px solid rgba(255,255,255,.06);font-size:11px;color:var(--t2)}
.pp-hint.err{border-color:rgba(232,64,87,.4);color:#fca5a5}
.pp-game{display:flex;align-items:center;justify-content:center;padding:4px 16px 8px}
.pp-frame{position:relative;width:min(100%,320px);aspect-ratio:1;padding:8px;flex-shrink:0;
  background:linear-gradient(180deg,#1a2535,#0d1520);border-radius:20px;border:2px solid rgba(56,189,248,.2);
  box-shadow:0 8px 32px rgba(0,0,0,.45)}
.pp-grid{width:100%;height:100%;display:grid;gap:3px;border-radius:12px}
.pp-cell{position:relative;border-radius:8px;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.04);cursor:pointer;transition:transform .12s,box-shadow .2s;touch-action:manipulation}
.pp-cell:active{transform:scale(.93)}
.pp-cell.conn{border-color:rgba(56,189,248,.35);background:rgba(56,189,248,.06)}
.pp-cell.flow{border-color:rgba(56,189,248,.6);box-shadow:0 0 12px rgba(56,189,248,.25)}
.pp-cell.rust{opacity:.8}
.pp-cell.rust::after{content:'';position:absolute;inset:0;background:repeating-linear-gradient(45deg,transparent,transparent 3px,rgba(180,83,9,.25) 3px,rgba(180,83,9,.25) 6px);border-radius:8px;pointer-events:none}
.pp-cell.clog{opacity:.85}
.pp-cell.clog::after{content:'';position:absolute;inset:0;background:radial-gradient(circle at 50% 50%,rgba(34,197,94,.15),rgba(21,128,61,.35));border-radius:8px;pointer-events:none}
.pp-cell.broken{opacity:.82}
.pp-cell.broken::after{content:'';position:absolute;inset:0;background:repeating-linear-gradient(-45deg,transparent,transparent 2px,rgba(239,68,68,.2) 2px,rgba(239,68,68,.2) 5px);border-radius:8px;pointer-events:none}
.pp-cell.root{opacity:.85}
.pp-cell.root::after{content:'';position:absolute;inset:0;background:radial-gradient(circle at 30% 70%,rgba(34,197,94,.2),rgba(22,101,52,.4));border-radius:8px;pointer-events:none}
.pp-cell.ice{box-shadow:inset 0 0 0 2px rgba(186,230,253,.35)}
.pp-cell.ice::before{content:'❄';position:absolute;top:1px;right:2px;font-size:9px;opacity:.7;pointer-events:none;z-index:3}
.pp-svg{width:100%;height:100%;display:block;pointer-events:none}
.pp-body{stroke:rgba(100,116,139,.85);stroke-width:10;stroke-linecap:round;fill:none;transition:stroke .3s}
.pp-body.connected{stroke:rgba(56,189,248,.9)}
.pp-body.flowing{stroke:var(--cyan);filter:drop-shadow(0 0 6px rgba(56,189,248,.8))}
.pp-joint{fill:rgba(148,163,184,.6)}
.pp-joint.connected,.pp-joint.flowing{fill:#7dd3fc}
.pp-icon{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:16px;pointer-events:none;z-index:2}
.pp-obstacle{position:absolute;bottom:1px;left:2px;font-size:10px;pointer-events:none;z-index:3;line-height:1}
.pp-moves{position:absolute;top:-6px;right:-6px;padding:3px 8px;border-radius:10px;font-size:10px;font-weight:800;background:var(--card2);border:1px solid rgba(255,255,255,.08);z-index:10}
.pp-bottom{flex-shrink:0;background:linear-gradient(180deg,transparent,var(--bg) 20%);padding-top:4px}
.pp-powers{display:flex;gap:6px;padding:0 16px 4px;justify-content:center}
.pp-power{flex:1;max-width:110px;padding:7px 4px;border-radius:12px;text-align:center;background:var(--card);border:1px solid rgba(255,255,255,.05);cursor:pointer;font-size:8px;font-weight:700;color:var(--t3)}
.pp-power.off{opacity:.35;pointer-events:none}
.pp-power-ic{font-size:18px;display:block;margin-bottom:2px}
.pp-actions{padding:4px 16px;padding-bottom:max(env(safe-area-inset-bottom),10px)}
.pp-btn{width:100%;padding:14px;border-radius:16px;border:none;font-size:15px;font-weight:800;color:#fff;cursor:pointer;
  background:linear-gradient(135deg,#0369a1,var(--cyan));box-shadow:0 4px 0 #0c4a6e}
.pp-btn:disabled{opacity:.4;pointer-events:none}
.pp-btn:active:not(:disabled){transform:translateY(3px);box-shadow:0 1px 0 #0c4a6e}
.pp-ov{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.75);backdrop-filter:blur(8px);display:flex;align-items:flex-end;justify-content:center}
.pp-win{width:100%;max-width:430px;background:linear-gradient(180deg,var(--card2),var(--card));border-radius:28px 28px 0 0;padding:20px;padding-bottom:max(env(safe-area-inset-bottom),28px);text-align:center}
.pp-win-title{font-family:Cinzel,serif;font-size:22px;font-weight:900;color:var(--gold);margin:8px 0}
.pp-win-btn{width:100%;margin-top:14px;padding:16px;border-radius:16px;border:none;font-size:16px;font-weight:800;color:#fff;cursor:pointer;background:linear-gradient(135deg,#C8940A,var(--gold));box-shadow:0 5px 0 #8B6914}
.pp-win-link{width:100%;margin-top:8px;padding:12px;border-radius:14px;border:1px solid rgba(56,189,248,.25);background:transparent;font-size:13px;font-weight:700;color:var(--cyan);cursor:pointer}
.pp-bonus{margin-top:10px;padding:10px 14px;border-radius:12px;background:rgba(56,189,248,.08);border:1px solid rgba(56,189,248,.2);font-size:12px;color:var(--cyan);text-align:left}
.pp-loading{flex:1;display:flex;align-items:center;justify-content:center;color:var(--t3);font-size:14px}
`;

export default function PipelineGame() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const gridRef = useRef([]);
  const movesUsedRef = useRef(0);
  const sessionRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [session, setSession] = useState(null);
  const [grid, setGrid] = useState([]);
  const [size, setSize] = useState(5);
  const [movesLeft, setMovesLeft] = useState(0);
  const [hint, setHint] = useState('Поворачивай секции — соедини 💧 со сливом 🏆');
  const [hintErr, setHintErr] = useState(false);
  const [pressure, setPressure] = useState(0);
  const [flowing, setFlowing] = useState(false);
  const [flowPath, setFlowPath] = useState([]);
  const [win, setWin] = useState(null);
  const [powers, setPowers] = useState({ thor: true, heim: true, odin: true });
  const [busy, setBusy] = useState(false);
  const [pressureFactor, setPressureFactor] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setHintErr(false);
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
    } catch {
      setHint('Не удалось загрузить уровень. Проверь связь.');
      setHintErr(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const conn = useMemo(() => bfs(grid, size), [grid, size]);

  const spendMoves = (cost) => {
    movesUsedRef.current += cost;
    setMovesLeft((m) => Math.max(0, m - cost));
  };

  const rotate = (i) => {
    if (busy || flowing || win) return;
    const cell = grid[i];
    if (!cell || [P.EMPTY, P.SRC, P.DRN].includes(cell.t)) return;
    if (isObstacle(cell)) {
      const msg = cell.t === P.RUST ? '🪨 Ржавчина! Используй 🔨 Удар Тора'
        : cell.t === P.CLOG ? '🧱 Засор! Прочисти 🔨 Тором или 🌀 Фрейей'
          : cell.t === P.BROKEN ? '💔 Трещина! Почини 🔨 Тором'
            : '🌿 Корни! Убери 🌀 Фрейей';
      setHint(msg);
      setHintErr(true);
      haptic.error();
      return;
    }
    if (movesLeft <= 0) {
      setHint('Ходы закончились — нажми «Пустить поток» или начни уровень заново');
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
    const next = grid.map((c, idx) => idx === i ? { ...c, r: (c.r + 1) % 4 } : c);
    setGrid(next);
    gridRef.current = next;
    spendMoves(cost);
    setHintErr(false);
    setHint(cell.ice ? '❄ Ледяная труба — поворот стоит 2 хода' : 'Поворачивай секции — соедини 💧 со сливом 🏆');
  };

  const usePower = (type) => {
    if (busy || flowing || win) return;
    if (type === 'thor' && powers.thor) {
      const ri = grid.findIndex((c) => (c.t === P.RUST && !c.rustCleared)
        || (c.t === P.CLOG && !c.clogCleared) || (c.t === P.BROKEN && !c.brokenCleared));
      if (ri >= 0) {
        const was = grid[ri].t;
        const next = grid.map((c, i) => i === ri ? clearObstacle(c, was) : c);
        setGrid(next);
        gridRef.current = next;
        const labels = { [P.RUST]: 'ржавчину', [P.CLOG]: 'засор', [P.BROKEN]: 'трещину' };
        setHint(`Мьёльнir устранил ${labels[was] || 'препятствие'}!`);
      } else setHint('Препятствий нет — береги удар');
      setPowers((p) => ({ ...p, thor: false }));
      haptic.medium();
    } else if (type === 'heim' && powers.heim) {
      const obsIdx = grid.findIndex((c) => (c.t === P.CLOG && !c.clogCleared) || (c.t === P.ROOT && !c.rootCleared));
      if (obsIdx >= 0) {
        const was = grid[obsIdx].t;
        const next = grid.map((c, i) => i === obsIdx ? clearObstacle(c, was) : c);
        setGrid(next);
        gridRef.current = next;
        setHint(was === P.ROOT ? '🌀 Фрейя убрала корни!' : '🌀 Фрейя прочистила засор!');
      } else {
        const { path } = bfs(grid, size);
        setFlowPath(path);
        setTimeout(() => setFlowPath([]), 2000);
        setHint('Фрейя видит путь!');
      }
      setPowers((p) => ({ ...p, heim: false }));
    } else if (type === 'odin' && powers.odin) {
      const blocked = grid.findIndex((c) => isObstacle(c));
      const target = blocked >= 0 ? blocked : grid.findIndex((c) => c.t === P.ELB || c.t === P.STR);
      if (target >= 0) {
        setHint(`Один шепчет: ${obstacleLabel(grid[target].t)} — клетка ${target + 1}`);
      }
      setPowers((p) => ({ ...p, odin: false }));
    }
    setHintErr(false);
  };

  const startFlow = async () => {
    if (busy || flowing || win || !sessionRef.current) return;
    const currentGrid = gridRef.current;
    const { ok, path } = bfs(currentGrid, size);
    if (!ok) {
      setHint('Сначала соедини все трубы!');
      setHintErr(true);
      haptic.error();
      return;
    }
    if (movesUsedRef.current > sessionRef.current.move_limit) {
      setHint('Превышен лимит ходов — попробуй эффективнее');
      setHintErr(true);
      haptic.error();
      return;
    }
    setFlowing(true);
    setBusy(true);
    setHintErr(false);
    haptic.medium();
    const stepMs = Math.max(55, Math.round(100 / pressureFactor));
    for (let s = 0; s <= path.length; s++) {
      setFlowPath(path.slice(0, s));
      setPressure(Math.min(100, (s / Math.max(path.length, 1)) * 100));
      await new Promise((r) => setTimeout(r, stepMs));
    }
    try {
      const payload = {
        session_id: sessionRef.current.session_id,
        cells: currentGrid.map(normalizeCell),
        moves_used: movesUsedRef.current,
      };
      const res = await fieldApi.post('/pipeline/complete', payload);
      setWin(res);
      setPressure(100);
      haptic.success();
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
    } finally {
      setBusy(false);
    }
  };

  const nextLevel = () => {
    haptic.medium();
    load();
  };

  if (loading) {
    return (
      <>
        <style>{CSS}</style>
        <div className="pp-root"><div className="pp-loading">Загрузка Рунопровода…</div></div>
      </>
    );
  }

  const world = session?.world;
  const layout = frameSize(size);

  return (
    <>
      <style>{CSS}</style>
      <div className="pp-root">
        <div className="pp-bg">
          <div className="pp-glow pp-g1" />
          <div className="pp-glow pp-g2" />
        </div>
        <div className="pp-page">
          <div className="pp-scroll">
            <header className="pp-top">
              <button type="button" className="pp-back" onClick={() => navigate(-1)} aria-label="Назад">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="rgba(255,255,255,.7)" strokeWidth="2.2"><path d="M15 18l-6-6 6-6" /></svg>
              </button>
              <div>
                <div className="pp-title">РУНОПРОВОД</div>
                <div className="pp-sub">ГИДРОМЕХАНИК АСГАРДА</div>
              </div>
              <div className="pp-wallet"><span style={{ fontSize: 11, fontWeight: 900, color: '#5a3e00' }}>ᚱ</span><span className="pp-bal">{wallet?.runes ?? '—'}</span></div>
            </header>

            <div className="pp-bar">
              <div className="pp-bar-row">
                <span className="pp-world">{world?.icon} {world?.name}</span>
                <span className="pp-lvl">УР. {session?.level}</span>
                <span>{[0, 1, 2].map((i) => <span key={i} className={`pp-star ${(win?.stars || 0) > i ? 'on' : ''}`}>⭐</span>)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontWeight: 700, color: 'var(--t3)' }}>
                <span>ДАВЛЕНИЕ</span><span style={{ color: 'var(--cyan)' }}>{Math.round(pressure)}%</span>
              </div>
              <div className="pp-press-track">
                <div className="pp-press-fill" style={{
                  width: `${pressure}%`,
                  background: pressure > 85 ? 'linear-gradient(90deg,#991b1b,var(--red))' : pressure > 60 ? 'linear-gradient(90deg,#b45309,#f59e0b)' : 'linear-gradient(90deg,#0369a1,var(--cyan))',
                }} />
              </div>
              {stats && (
                <div className="pp-meta">
                  <span>Сетка: {session?.grid_label || `${size}×${size}`}</span>
                  <span>Ходы: {movesLeft}/{session?.move_limit}</span>
                  <span>Серия: {stats.current_streak}</span>
                  <span>Макс: {stats.max_level}</span>
                </div>
              )}
            </div>

            <div className={`pp-hint ${hintErr ? 'err' : ''}`}>{hint}</div>

            <div className="pp-game">
              <div className="pp-frame" style={{ maxWidth: layout.maxWidth }}>
                <div className="pp-moves">{movesLeft} ход.</div>
                <div className="pp-grid" style={{ gridTemplateColumns: `repeat(${size}, 1fr)`, gridTemplateRows: `repeat(${size}, 1fr)`, gap: layout.gap }}>
                  {grid.map((cell, i) => {
                    const isConn = conn.reachable.has(i);
                    const isFlow = flowPath.includes(i);
                    const isRust = cell.t === P.RUST && !cell.rustCleared;
                    const isClog = cell.t === P.CLOG && !cell.clogCleared;
                    const isBroken = cell.t === P.BROKEN && !cell.brokenCleared;
                    const isRoot = cell.t === P.ROOT && !cell.rootCleared;
                    const isIce = !!cell.ice;
                    let inner = '';
                    if (cell.t === P.SRC) inner = `<div class="pp-icon" style="font-size:${layout.icon}px">💧</div>${pipeSVG(cell, i, isConn, isFlow) || ''}`;
                    else if (cell.t === P.DRN) inner = `<div class="pp-icon" style="font-size:${layout.icon}px">🏆</div>${pipeSVG(cell, i, isConn, isFlow) || ''}`;
                    else if (cell.t !== P.EMPTY) {
                      inner = (pipeSVG(cell, i, isConn, isFlow) || '');
                      if (isRust) inner += `<span class="pp-obstacle" style="font-size:${layout.obstacle}px">🪨</span>`;
                      if (isClog) inner += `<span class="pp-obstacle" style="font-size:${layout.obstacle}px">🧱</span>`;
                      if (isBroken) inner += `<span class="pp-obstacle" style="font-size:${layout.obstacle}px">💔</span>`;
                      if (isRoot) inner += `<span class="pp-obstacle" style="font-size:${layout.obstacle}px">🌿</span>`;
                    }
                    return (
                      <div
                        key={i}
                        className={`pp-cell ${isConn ? 'conn' : ''} ${isFlow ? 'flow' : ''} ${isRust ? 'rust' : ''} ${isClog ? 'clog' : ''} ${isBroken ? 'broken' : ''} ${isRoot ? 'root' : ''} ${isIce ? 'ice' : ''}`}
                        style={cell.t === P.EMPTY ? { opacity: 0.1, pointerEvents: 'none' } : undefined}
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
                { k: 'thor', ic: '🔨', label: 'ТОР', sub: 'ржав/засор/трещ' },
                { k: 'heim', ic: '🌀', label: 'ФРЕЙЯ', sub: 'путь/засор/корни' },
                { k: 'odin', ic: '🧠', label: 'ОДИН', sub: 'подсказка' },
              ].map(({ k, ic, label }) => (
                <button key={k} type="button" className={`pp-power ${powers[k] ? '' : 'off'}`} onClick={() => usePower(k)}>
                  <span className="pp-power-ic">{ic}</span>{label}
                </button>
              ))}
            </div>
            <div className="pp-actions">
              <button type="button" className="pp-btn" disabled={busy || flowing || !!win} onClick={startFlow}>
                {flowing ? '🌊 ПОТОК ИДЁТ…' : '🌊 ПУСТИТЬ ПОТОК'}
              </button>
            </div>
          </div>
        </div>

        {win && (
          <div className="pp-ov" onClick={(e) => e.target.className === 'pp-ov' && setWin(null)}>
            <div className="pp-win">
              <div style={{ fontSize: 56 }}>🌊</div>
              <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--cyan)', letterSpacing: '.1em' }}>ПОТОК ВОССТАНОВЛЕН</div>
              <div className="pp-win-title">УРОВЕНЬ ПРОЙДЕН!</div>
              <div style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 12 }}>
                {world?.name} · Уровень {win.level} · {'⭐'.repeat(win.stars)}
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ padding: '10px 18px', borderRadius: 14, background: 'rgba(165,110,255,.12)', color: '#A56EFF', fontWeight: 800 }}>+{win.total_xp ?? win.xp} XP</div>
                <div style={{ padding: '10px 18px', borderRadius: 14, background: 'rgba(240,200,80,.1)', color: 'var(--gold)', fontWeight: 800 }}>+{win.total_runes ?? win.runes} ᚱ</div>
              </div>
              {(win.bonus_xp > 0 || win.bonus_runes > 0) && (
                <div className="pp-bonus">
                  🎁 Бонусы: {win.bonus_xp > 0 ? `+${win.bonus_xp} XP` : ''}{win.bonus_xp > 0 && win.bonus_runes > 0 ? ' · ' : ''}{win.bonus_runes > 0 ? `+${win.bonus_runes} ᚱ` : ''}
                </div>
              )}
              {win.current_streak >= 3 && (
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--gold)' }}>🔥 Серия {win.current_streak} уровней!</div>
              )}
              <button type="button" className="pp-win-btn" onClick={nextLevel}>СЛЕДУЮЩИЙ УРОВЕНЬ →</button>
              <button type="button" className="pp-win-link" onClick={() => navigate('/field/leaderboard?tab=pipeline')}>🏆 Рейтинг Рунопровода</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
