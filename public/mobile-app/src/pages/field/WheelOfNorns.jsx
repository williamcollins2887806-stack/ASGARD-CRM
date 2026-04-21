import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { ArrowLeft, Coins, Zap, Trophy } from 'lucide-react';

// ═══ Web Audio tick sound ═══
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function playTick(freq = 700) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.03);
    osc.connect(gain).connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.03);
  } catch { /* silent */ }
}
function playWin(tier) {
  try {
    const ctx = getAudioCtx();
    const freqs = tier === 'legendary' ? [440, 554, 659, 880, 1047] : tier === 'epic' ? [440, 554, 659, 880] : [440, 554, 659];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.2, ctx.currentTime + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.3);
    });
  } catch { /* silent */ }
}

const TIER_COLORS = { common: '#6b7280', rare: '#3b82f6', epic: '#8b5cf6', legendary: '#ffd700' };
const ITEM_H = 80; // px per drum item
const VISIBLE = 3; // visible items in viewport

export default function WheelOfNorns() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const stripRef = useRef(null);
  const animRef = useRef(null);

  const [wallet, setWallet] = useState({ runes: 0, xp: 0, silver: 0, level: 1 });
  const [prizes, setPrizes] = useState([]);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState(null);
  const [canSpin, setCanSpin] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Viking spring state
  const [vikY, setVikY] = useState(0);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [w, p] = await Promise.all([
        fieldApi.get('/gamification/wallet').catch(() => ({ runes: 0, xp: 0, silver: 0, level: 1 })),
        fieldApi.get('/gamification/prizes').then((d) => d.prizes || []).catch(() => []),
      ]);
      setWallet(w);
      setPrizes(p);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  // Build drum strip items
  const buildStrip = useCallback((winPrize) => {
    const total = 60;
    const winIdx = total - 4;
    const items = [];
    for (let i = 0; i < total; i++) {
      if (i === winIdx) { items.push(winPrize); continue; }
      // Random from prizes pool
      const pool = prizes.length ? prizes : [{ name: '...', icon: '᛭', tier: 'common' }];
      items.push(pool[Math.floor(Math.random() * pool.length)]);
    }
    return { items, winIdx };
  }, [prizes]);

  async function handleSpin() {
    if (spinning || !canSpin) return;

    // Init audio context on user gesture
    getAudioCtx();
    haptic.medium();
    setSpinning(true);
    setResult(null);
    setError(null);

    try {
      const data = await fieldApi.post('/gamification/spin', {});
      const winPrize = data.prize;

      // Build visual strip
      const { items, winIdx } = buildStrip(winPrize);

      // Render strip
      if (stripRef.current) {
        stripRef.current.innerHTML = items.map((p, i) => `
          <div style="height:${ITEM_H}px;display:flex;align-items:center;justify-content:center;gap:8px;
            border-bottom:1px solid rgba(200,168,78,0.15);
            ${i === winIdx ? 'background:rgba(255,215,0,0.1);' : ''}">
            <span style="font-size:28px">${p.icon || '᛭'}</span>
            <span style="color:${TIER_COLORS[p.tier] || '#fff'};font-size:14px;font-weight:600">${p.name}</span>
          </div>
        `).join('');
        stripRef.current.style.transition = 'none';
        stripRef.current.style.transform = `translateY(${ITEM_H}px)`;
      }

      // 3-phase animation
      const targetY = -(winIdx * ITEM_H) + ITEM_H * ((VISIBLE - 1) / 2);
      const startY = ITEM_H;
      const ACCEL = 800, CRUISE = 2500, DECEL = 5000, TOTAL = ACCEL + CRUISE + DECEL;
      const t0 = performance.now();
      let lastIdx = -1;

      function getProgress(elapsed) {
        if (elapsed < ACCEL) { const t = elapsed / ACCEL; return 0.08 * (t * t); }
        if (elapsed < ACCEL + CRUISE) { return 0.08 + 0.52 * ((elapsed - ACCEL) / CRUISE); }
        const t = (elapsed - ACCEL - CRUISE) / DECEL;
        return 0.60 + 0.40 * (1 - Math.pow(1 - t, 4));
      }

      function frame(now) {
        const elapsed = now - t0;
        const progress = Math.min(getProgress(Math.min(elapsed, TOTAL)), 1);
        const currentY = startY + (targetY - startY) * progress;

        if (stripRef.current) {
          stripRef.current.style.transform = `translateY(${currentY}px)`;
        }

        // Tick sound
        const idx = Math.floor(Math.abs(currentY) / ITEM_H);
        if (idx !== lastIdx) {
          lastIdx = idx;
          const phase = elapsed < ACCEL ? 'accel' : elapsed < ACCEL + CRUISE ? 'cruise' : 'decel';
          if (phase === 'decel') {
            const dp = (elapsed - ACCEL - CRUISE) / DECEL;
            playTick(400 + 200 * (1 - dp));
            haptic.light();
          } else {
            playTick(500 + Math.random() * 200);
          }
        }

        // Viking bounce
        const phase = elapsed < ACCEL ? 0 : elapsed < ACCEL + CRUISE ? 1 : 2;
        const bounce = phase === 2 ? Math.sin(elapsed * 0.01) * 4 : Math.sin(elapsed * 0.02) * 2;
        setVikY(bounce);

        if (elapsed < TOTAL) {
          animRef.current = requestAnimationFrame(frame);
        } else {
          // Done!
          playWin(winPrize.tier);
          haptic.success();
          setVikY(0);
          setSpinning(false);
          setResult(winPrize);
          setCanSpin(false); // Daily limit
          loadData(); // Refresh wallet
        }
      }

      animRef.current = requestAnimationFrame(frame);
    } catch (e) {
      setSpinning(false);
      if (e.message.includes('уже использован')) setCanSpin(false);
      setError(e.message);
    }
  }

  useEffect(() => () => { if (animRef.current) cancelAnimationFrame(animRef.current); }, []);

  if (loading) {
    return (
      <div className="p-4 space-y-4 animate-pulse" style={{ backgroundColor: 'var(--bg-primary)' }}>
        <div className="h-12 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />
        <div className="h-64 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />
      </div>
    );
  }

  return (
    <div className="p-4 pb-24" style={{ backgroundColor: 'var(--bg-primary)', minHeight: '100vh' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/field/home')} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
            <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
          </button>
          <h1 className="text-lg font-bold" style={{ color: 'var(--gold)' }}>Колесо Норн</h1>
        </div>
        {/* Wallet badge */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <Coins size={14} style={{ color: 'var(--gold)' }} />
          <span className="text-xs font-bold" style={{ color: 'var(--gold)' }}>{wallet.runes}R</span>
          <Zap size={14} style={{ color: '#8b5cf6' }} />
          <span className="text-xs font-bold" style={{ color: '#8b5cf6' }}>Lv{wallet.level}</span>
        </div>
      </div>

      {error && <div className="mb-3 p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{error}</div>}

      {/* Viking character (simplified) */}
      <div className="flex justify-center mb-4" style={{ transform: `translateY(${vikY}px)`, transition: 'transform 50ms' }}>
        <div className="text-5xl">⚔️</div>
      </div>

      {/* Drum viewport */}
      <div className="relative mx-auto overflow-hidden rounded-2xl" style={{ height: ITEM_H * VISIBLE, maxWidth: 320, backgroundColor: 'var(--bg-elevated)', border: '2px solid var(--gold)', boxShadow: '0 0 20px rgba(200,168,78,0.2)' }}>
        {/* Rune decorations */}
        <div className="absolute top-0 left-2 bottom-0 flex items-center text-xs opacity-30" style={{ color: 'var(--gold)' }}>ᚠ ᚱ</div>
        <div className="absolute top-0 right-2 bottom-0 flex items-center text-xs opacity-30" style={{ color: 'var(--gold)' }}>ᚱ ᚠ</div>

        {/* Center indicator */}
        <div className="absolute left-0 right-0 pointer-events-none" style={{ top: ITEM_H, height: ITEM_H, border: '2px solid var(--gold)', borderRadius: 8, background: 'rgba(255,215,0,0.05)', zIndex: 10 }} />

        {/* Strip */}
        <div ref={stripRef} style={{ willChange: 'transform' }}>
          {/* Initial items rendered by spin() */}
          {!spinning && !result && prizes.slice(0, VISIBLE).map((p, i) => (
            <div key={i} style={{ height: ITEM_H, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderBottom: '1px solid rgba(200,168,78,0.15)' }}>
              <span style={{ fontSize: 28 }}>{p.icon || '᛭'}</span>
              <span style={{ color: TIER_COLORS[p.tier], fontSize: 14, fontWeight: 600 }}>{p.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Spin button */}
      <div className="flex justify-center mt-6">
        <button
          onClick={handleSpin}
          disabled={spinning || !canSpin}
          className="px-8 py-4 rounded-2xl text-lg font-bold text-white disabled:opacity-50 transition-transform active:scale-95"
          style={{ background: canSpin ? 'var(--gold-gradient)' : 'var(--bg-elevated)', color: canSpin ? '#fff' : 'var(--text-tertiary)', boxShadow: canSpin ? '0 4px 20px rgba(200,168,78,0.4)' : 'none' }}
        >
          {spinning ? 'Вращается...' : canSpin ? '᛭ КРУТИТЬ ᛭' : 'Завтра в 06:00'}
        </button>
      </div>

      {/* Win result */}
      {result && (
        <div className="mt-6 rounded-2xl p-5 text-center" style={{ backgroundColor: TIER_COLORS[result.tier] + '15', border: `2px solid ${TIER_COLORS[result.tier]}` }}>
          <span className="text-4xl block mb-2">{result.icon}</span>
          <p className="text-lg font-bold" style={{ color: TIER_COLORS[result.tier] }}>{result.name}</p>
          {result.description && <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{result.description}</p>}
          {result.value > 0 && <p className="text-sm mt-1 font-semibold" style={{ color: 'var(--gold)' }}>+{result.value}</p>}
        </div>
      )}

      {/* Quick links */}
      <div className="grid grid-cols-3 gap-3 mt-6">
        <button onClick={() => navigate('/field/shop')} className="p-3 rounded-xl text-center" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <Coins size={20} className="mx-auto mb-1" style={{ color: 'var(--gold)' }} />
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Магазин</span>
        </button>
        <button onClick={() => navigate('/field/inventory')} className="p-3 rounded-xl text-center" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <Trophy size={20} className="mx-auto mb-1" style={{ color: '#8b5cf6' }} />
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Инвентарь</span>
        </button>
        <button onClick={() => navigate('/field/quests')} className="p-3 rounded-xl text-center" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <Zap size={20} className="mx-auto mb-1" style={{ color: '#f59e0b' }} />
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Квесты</span>
        </button>
      </div>
    </div>
  );
}
