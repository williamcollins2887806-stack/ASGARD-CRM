/**
 * RankUpCeremony — fullscreen congratulations when XP rank increases.
 */
import { useEffect, useRef } from 'react';
import { VikingAvatarLazy } from '@/components/field/VikingAvatar3D';
import { rankStorageKey } from '@/lib/fieldRanks';

function playHorn() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const notes = [196, 247, 294, 392];
    notes.forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.08, now + 0.02 + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.45 + i * 0.15);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(now + i * 0.1);
      o.stop(now + 0.6 + i * 0.15);
    });
    setTimeout(() => ctx.close().catch(() => {}), 2000);
  } catch { /* ignore */ }
}

function spawnParticles(canvas, color) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  const w = canvas.width = canvas.clientWidth * 2;
  const h = canvas.height = canvas.clientHeight * 2;
  const parts = [];
  const hex = color || '#D4A843';
  for (let i = 0; i < 70; i++) {
    parts.push({
      x: w * 0.5 + (Math.random() - 0.5) * 80,
      y: h * 0.42,
      vx: (Math.random() - 0.5) * 14,
      vy: -Math.random() * 12 - 2,
      life: 1,
      decay: 0.008 + Math.random() * 0.012,
      r: 2 + Math.random() * 4,
      color: Math.random() > 0.4 ? hex : '#fff4c8',
    });
  }
  let raf = 0;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    ctx.clearRect(0, 0, w, h);
    parts.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.18;
      p.life -= p.decay;
      if (p.life <= 0) return;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  };
  tick();
  return () => cancelAnimationFrame(raf);
}

export default function RankUpCeremony({
  open,
  rank,
  prevRank,
  assets,
  cosmetics,
  level,
  employeeId,
  onClose,
  haptic,
  welcome: welcomeProp,
}) {
  const canvasRef = useRef(null);
  // Soft welcome only when parent says so (first thrall visit). First visit at higher rank = full pomp.
  const welcome = welcomeProp != null
    ? !!welcomeProp
    : (!prevRank || prevRank === rank?.title);

  useEffect(() => {
    if (!open || !rank) return;
    // Persist immediately on show — closing the tab / skip button won't re-spam next session.
    // Rank-up still only fires when checkRankCeremony sees a higher title than stored.
    markRankSeen(employeeId, rank.title);

    if (!welcome) {
      playHorn();
      haptic?.success?.();
    } else {
      haptic?.light?.();
    }
    let stop = () => {};
    const id = requestAnimationFrame(() => {
      const c = canvasRef.current;
      if (!c) return;
      if (!c.clientWidth || !c.clientHeight) {
        c.style.width = '100%';
        c.style.height = '100%';
      }
      stop = spawnParticles(c, rank.color);
    });
    return () => {
      cancelAnimationFrame(id);
      stop();
    };
  }, [open, rank, welcome, haptic, employeeId]);

  if (!open || !rank) return null;

  const dismiss = () => {
    markRankSeen(employeeId, rank.title);
    onClose?.();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'radial-gradient(ellipse at 50% 30%, #1a1408 0%, #05070c 70%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: 24, gap: 12,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      />

      <div style={{
        position: 'relative', zIndex: 1, textAlign: 'center',
        animation: 'rankCeremonyIn 0.55s ease-out',
      }}>
        <div style={{
          fontSize: 56, lineHeight: 1, color: rank.color,
          textShadow: `0 0 24px ${rank.color}88`,
          marginBottom: 8,
        }}>
          {rank.rune}
        </div>
        <div style={{ fontSize: 12, letterSpacing: 3, color: `${rank.color}aa`, textTransform: 'uppercase', fontWeight: 700 }}>
          {welcome ? 'Добро пожаловать' : 'Новый ранг'}
        </div>
        <h2 style={{
          margin: '6px 0 4px', fontSize: 28, fontWeight: 900, color: '#f8fafc',
          textShadow: `0 0 20px ${rank.color}55`,
        }}>
          {welcome ? `Ты — ${rank.title}` : `Новый ранг: ${rank.title}`}
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: '#94a3b8' }}>
          Уровень {level}
          {prevRank && prevRank !== rank.title ? ` · было: ${prevRank}` : ''}
        </p>
      </div>

      <div style={{ position: 'relative', zIndex: 1, marginTop: 8 }}>
        <VikingAvatarLazy
          assets={assets || {}}
          cosmetics={cosmetics || {}}
          level={level}
          size={Math.min(280, typeof window !== 'undefined' ? window.innerWidth - 64 : 280)}
          interactive={false}
          heroPunch
        />
      </div>

      <button
        type="button"
        onClick={dismiss}
        style={{
          position: 'relative', zIndex: 1, marginTop: 16,
          padding: '14px 36px', borderRadius: 14, border: `1px solid ${rank.color}88`,
          background: `linear-gradient(180deg, ${rank.color}33, ${rank.color}11)`,
          color: '#f8fafc', fontWeight: 800, fontSize: 15, cursor: 'pointer',
          boxShadow: `0 0 28px ${rank.color}44`,
        }}
      >
        В строй!
      </button>

      <style>{`
        @keyframes rankCeremonyIn {
          from { opacity: 0; transform: translateY(16px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}

/** Detect rank-up vs last seen; returns { show, prevTitle } */
export function checkRankCeremony(employeeId, currentRankTitle) {
  if (!currentRankTitle) return { show: false, prevTitle: null };
  let prev = null;
  try {
    prev = localStorage.getItem(rankStorageKey(employeeId));
  } catch {
    prev = null;
  }
  if (!prev) {
    // First visit: soft welcome only for Трэль; higher ranks get full ceremony once
    return { show: true, prevTitle: null, welcome: currentRankTitle === 'Трэль' };
  }
  if (prev === currentRankTitle) return { show: false, prevTitle: prev };
  return { show: true, prevTitle: prev, welcome: false };
}

export function markRankSeen(employeeId, title) {
  try {
    localStorage.setItem(rankStorageKey(employeeId), title);
  } catch { /* */ }
}
