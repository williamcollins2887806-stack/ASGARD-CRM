/**
 * FieldProfile.jsx — WOW Viking Character Card
 * Полноростовой персонаж, уровень, руны, снаряжение
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield, ChevronDown, ChevronUp,
  LogOut, Sun, Moon, Edit3, Check, X, Briefcase, Award, Sparkles, ClipboardList, Calendar,
} from 'lucide-react';
import { fieldApi } from '@/api/fieldClient';
import { useFieldAuthStore } from '@/stores/fieldAuthStore';
import { useHaptic } from '@/hooks/useHaptic';
import { VikingAvatarLazy } from '@/components/field/VikingAvatar3D';
import RankUpCeremony, { checkRankCeremony } from '@/components/field/RankUpCeremony';
import { getLevel, getRank, getXpProgress, rankIndex } from '@/lib/fieldRanks';
import { BottomSheet } from '@/components/shared/BottomSheet';
import {
  formatRuPhoneDisplay, normalizeRuPhoneDigits,
  formatSnilsDisplay, formatPassportCodeDisplay, digitsOf,
  phoneError, snilsError, passportSeriesError, passportNumberError, passportCodeError,
} from '@/lib/ruMasks';
import { ppeSizeOptions } from '@/lib/ppeSizes';

/* ═══════════════════════════════════════════════════════════════════
   CSS ANIMATIONS
═══════════════════════════════════════════════════════════════════ */
const ANIM_CSS = `
@keyframes runeOrbit {
  from { transform: translate(-50%,-50%) rotate(0deg); }
  to   { transform: translate(-50%,-50%) rotate(360deg); }
}
/* box-shadow only — CSS filter on WebGL parent blanks the canvas on mobile */
@keyframes goldPulse {
  0%,100% { box-shadow: 0 0 16px rgba(240,200,80,.25), 0 0 32px rgba(240,200,80,.1); }
  50%     { box-shadow: 0 0 28px rgba(240,200,80,.55), 0 0 56px rgba(240,200,80,.22); }
}
@keyframes rankGlow {
  0%,100% { text-shadow: 0 0 6px rgba(240,200,80,.3); }
  50%     { text-shadow: 0 0 16px rgba(240,200,80,.95), 0 0 32px rgba(240,200,80,.5); }
}
@keyframes badgePop {
  0%  { transform: scale(0) rotate(-20deg); opacity:0; }
  65% { transform: scale(1.3) rotate(6deg); opacity:1; }
  100%{ transform: scale(1) rotate(0deg);  opacity:1; }
}
@keyframes runeFloat {
  0%,100%{ opacity:.14; transform:translateY(0) rotate(0deg); }
  50%    { opacity:.28; transform:translateY(-12px) rotate(25deg); }
}
@keyframes statSlide {
  from { opacity:0; transform:translateY(8px); }
  to   { opacity:1; transform:translateY(0); }
}
@keyframes characterReveal {
  from { opacity:0; transform:translateY(12px) scale(.96); }
  to   { opacity:1; transform:translateY(0) scale(1); }
}
@keyframes xpFill {
  from { width:0; }
}
@keyframes iceFrost {
  0%,100%{ box-shadow: 0 0 12px rgba(140,200,255,.4), 0 0 28px rgba(100,160,255,.12); }
  50%    { box-shadow: 0 0 22px rgba(140,200,255,.85), 0 0 48px rgba(100,160,255,.35); }
}
@keyframes fireFrost {
  0%,100%{ box-shadow: 0 0 12px rgba(255,120,30,.4), 0 0 28px rgba(255,80,0,.12); }
  50%    { box-shadow: 0 0 22px rgba(255,80,0,.85), 0 0 48px rgba(255,120,30,.4); }
}
`;

/* ═══════════════════════════════════════════════════════════════════
   UTILS
═══════════════════════════════════════════════════════════════════ */
function fmtPlanPeriod(from, to) {
  const fmt = (d) => (d ? new Date(d).toLocaleDateString('ru-RU') : null);
  const f = fmt(from);
  const t = fmt(to);
  if (f && t) return `с ${f} по ${t}`;
  if (f) return `с ${f}`;
  if (t) return `по ${t}`;
  return 'дата уточняется';
}

function getInitials(fio) {
  if (!fio) return '??';
  return fio.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}
function shortFio(fio) {
  if (!fio) return '';
  const p = fio.trim().split(/\s+/).filter(Boolean);
  if (p.length >= 3) return `${p[0]} ${p[1]} ${p[2][0]}.`;
  if (p.length === 2) return `${p[0]} ${p[1]}`;
  return p[0];
}
function formatPhone(p) {
  if (!p) return '';
  const d = p.replace(/\D/g, '').replace(/^8/, '7');
  return d.length === 11 ? `+${d[0]} (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7,9)}-${d.slice(9,11)}` : p;
}
function expiryStatus(ds) {
  if (!ds) return 'unknown';
  const diff = new Date(ds) - new Date();
  return diff < 0 ? 'expired' : diff < 30*86400000 ? 'expiring' : 'active';
}
const EXP_COLORS = {
  active:   {bg:'#16a34a22',color:'#16a34a',label:'Действует'},
  expiring: {bg:'#ca8a0422',color:'#ca8a04',label:'Истекает'},
  expired:  {bg:'#dc262622',color:'#dc2626',label:'Просрочен'},
  unknown:  {bg:'#71717a22',color:'#71717a',label:''},
};

/* ═══════════════════════════════════════════════════════════════════
   BADGE SVGs (40×40)
═══════════════════════════════════════════════════════════════════ */
const BADGE_SVGS = {
  'Бейдж "Берсерк"': `<svg viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="19" fill="#150808" stroke="#cc2222" stroke-width="1.5"/><line x1="20" y1="5" x2="20" y2="35" stroke="#6a3820" stroke-width="2.5" stroke-linecap="round"/><path d="M13 9 L19 7 L19 18 L13 20Z" fill="#cc2222"/><path d="M27 9 L21 7 L21 18 L27 20Z" fill="#aa1818"/><path d="M14 20 Q20 24 26 20 Q20 28 14 20Z" fill="#cc2222"/><text x="20" y="37" text-anchor="middle" font-size="4" fill="#cc4444" font-family="sans-serif" font-weight="700" letter-spacing=".3">БЕРСЕРК</text></svg>`,
  'Бейдж "Скальд"': `<svg viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="19" fill="#141208" stroke="#F0C850" stroke-width="1.5"/><path d="M12 8 Q20 5 28 8 Q30 22 20 28 Q10 22 12 8Z" fill="#1e1a0a" stroke="#C8940A" stroke-width=".8"/><path d="M15 14 L25 14" stroke="#F0C850" stroke-width="1" stroke-linecap="round"/><path d="M14 18 L26 18" stroke="#F0C850" stroke-width="1" stroke-linecap="round"/><path d="M16 22 L24 22" stroke="#F0C850" stroke-width="1" stroke-linecap="round"/><circle cx="27" cy="11" r="3" fill="#1e1a0a" stroke="#F0C850" stroke-width=".8"/><line x1="27" y1="14" x2="27" y2="24" stroke="#F0C850" stroke-width="1"/><circle cx="27" cy="24" r="2.5" fill="#F0C850"/><text x="20" y="37" text-anchor="middle" font-size="4" fill="#C8A800" font-family="sans-serif" font-weight="700" letter-spacing=".3">СКАЛЬД</text></svg>`,
  'Эффект "Молния"': `<svg viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="19" fill="#08081a" stroke="#F0C850" stroke-width="1.5"/><path d="M22 4 L16 20 L22 20 L18 36 L26 17 L20 17 Z" fill="#F0C850" stroke="#ff6a00" stroke-width=".5"/><circle cx="20" cy="20" r="15" fill="none" stroke="rgba(240,200,80,.15)" stroke-width=".5"/><text x="20" y="37" text-anchor="middle" font-size="4" fill="#C8A800" font-family="sans-serif" font-weight="700" letter-spacing=".3">МОЛНИЯ</text></svg>`,
  'Бейдж "Страж"': `<svg viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="19" fill="#0a1220" stroke="#60a5fa" stroke-width="1.5"/><path d="M20 6 L32 12 V22 C32 30 20 35 20 35 C20 35 8 30 8 22 V12 Z" fill="#1e3a5f" stroke="#60a5fa" stroke-width="1.2"/><path d="M20 14 L26 17 V23 C26 27 20 30 20 30 C20 30 14 27 14 23 V17 Z" fill="#60a5fa" opacity=".85"/><text x="20" y="37" text-anchor="middle" font-size="4" fill="#93c5fd" font-family="sans-serif" font-weight="700">СТРАЖ</text></svg>`,
  'Бейдж "Ярл"': `<svg viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="19" fill="#1a1408" stroke="#F0C850" stroke-width="1.5"/><path d="M10 18 L14 10 L20 14 L26 10 L30 18 L28 26 L12 26 Z" fill="#D4A843"/><circle cx="20" cy="18" r="3" fill="#1a1408"/><text x="20" y="37" text-anchor="middle" font-size="4" fill="#F0C850" font-family="sans-serif" font-weight="700">ЯРЛ</text></svg>`,
  badge_berserk: null, // filled below via alias
  badge_skald: null,
  badge_guard: null,
  badge_jarl: null,
  paint_lightning: null,
};
BADGE_SVGS.badge_berserk = BADGE_SVGS['Бейдж "Берсерк"'];
BADGE_SVGS.badge_skald = BADGE_SVGS['Бейдж "Скальд"'];
BADGE_SVGS.badge_guard = BADGE_SVGS['Бейдж "Страж"'];
BADGE_SVGS.badge_jarl = BADGE_SVGS['Бейдж "Ярл"'];
BADGE_SVGS.paint_lightning = BADGE_SVGS['Эффект "Молния"'];
BADGE_SVGS['Эффект "Молния"'] = BADGE_SVGS['Эффект "Молния"'];

function resolveBadgeSvg(activeBadge, assetKey) {
  if (!activeBadge && !assetKey) return null;
  // Face-paint wrongly stored as badge — ignore
  const name = normalizeCosmeticName(activeBadge || '');
  if (/раскраск|краск|paint_/i.test(name) || /раскраск/i.test(assetKey || '')) return null;
  if (BADGE_SVGS[name]) return BADGE_SVGS[name];
  if (assetKey && BADGE_SVGS[assetKey]) return BADGE_SVGS[assetKey];
  // Generic fallback so any equipped badge still shows
  if (name) {
    const short = name.replace(/^Бейдж\s*[«"']?/i, '').replace(/[»"'].*$/, '').slice(0, 8).toUpperCase() || '★';
    return `<svg viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="19" fill="#141828" stroke="#F0C850" stroke-width="1.5"/><text x="20" y="23" text-anchor="middle" font-size="7" fill="#F0C850" font-family="sans-serif" font-weight="800">${short}</text></svg>`;
  }
  return null;
}

function resolveFrameStyle(activeFrame, assetKey) {
  const s = `${activeFrame || ''} ${assetKey || ''}`.toLowerCase();
  if (s.includes('fire') || s.includes('огонь') || s.includes('тор')) return { kind: 'fire', color: '#ff8c30' };
  if (s.includes('ice') || s.includes('лёд') || s.includes('лед') || s.includes('мороз')) return { kind: 'ice', color: '#88ccff' };
  if (activeFrame || assetKey) return { kind: 'gold', color: '#F0C850' };
  return null;
}

function resolveThemeStyle(activeTheme, assetKey) {
  const s = `${activeTheme || ''} ${assetKey || ''}`.toLowerCase();
  if (s.includes('fire') || s.includes('огонь') || s.includes('красн')) {
    return { accent: '#ff6030', bg: 'linear-gradient(180deg,#150808 0%,#1e0c0c 50%,#0a0606 100%)', anim: 'fireFrost' };
  }
  if (s.includes('ice') || s.includes('лёд') || s.includes('лед') || s.includes('мороз')) {
    return { accent: '#88ccff', bg: 'linear-gradient(180deg,#080e1a 0%,#0e1828 50%,#060c14 100%)', anim: 'iceFrost' };
  }
  if (s.includes('dark') || s.includes('тёмн') || s.includes('темн') || s.includes('berserk') || s.includes('берсерк')) {
    return { accent: '#F0C850', bg: 'linear-gradient(180deg,#0a0a0a 0%,#100808 50%,#080808 100%)', anim: 'goldPulse' };
  }
  return {
    accent: '#F0C850',
    bg: 'linear-gradient(180deg,#0a0e1a 0%,#111827 60%,#0a0a0a 100%)',
    anim: 'goldPulse',
  };
}

function normalizeCosmeticName(s) {
  if (!s || typeof s !== 'string') return '';
  return s
    .trim()
    .replace(/\u00A0/g, ' ')
    .replace(/[«»""„]/g, '"')
    .replace(/\s+/g, ' ');
}


/* ═══════════════════════════════════════════════════════════════════
   RUNE ORBIT RING — animates around character card
═══════════════════════════════════════════════════════════════════ */
const FRAME_RUNES = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛈᛇᛉᛊ'.split('');

function RuneOrbitRing({ size, color = '#F0C850' }) {
  const R = size * 0.48;
  const C = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{
        position: 'absolute', top: '50%', left: '50%',
        animation: 'runeOrbit 18s linear infinite',
        pointerEvents: 'none',
      }}>
      <defs>
        <filter id="rGlo" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="1.8" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      {FRAME_RUNES.map((r, i) => {
        const a = (i / FRAME_RUNES.length) * Math.PI * 2 - Math.PI / 2;
        return (
          <text key={i} x={C + R * Math.cos(a)} y={C + R * Math.sin(a)}
            textAnchor="middle" dominantBaseline="middle"
            fontSize="13" fontFamily="serif" fill={color}
            filter="url(#rGlo)" opacity={0.85}>
            {r}
          </text>
        );
      })}
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   XP PROGRESS BAR (animated on mount)
═══════════════════════════════════════════════════════════════════ */
function XpBar({ xpCurrent, xpNext, level }) {
  const barRef = useRef(null);
  const pct = xpNext ? Math.min((xpCurrent / xpNext) * 100, 100) : 100;
  useEffect(() => {
    if (!barRef.current) return;
    barRef.current.style.width = '0%';
    const t = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        barRef.current.style.transition = 'width 1.4s cubic-bezier(.25,.46,.45,.94)';
        barRef.current.style.width = `${pct}%`;
      });
    });
    return () => cancelAnimationFrame(t);
  }, [pct]);

  return (
    <div style={{ width: '100%', padding: '0 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,.45)', letterSpacing: .5 }}>
          XP {xpCurrent.toLocaleString('ru-RU')} / {xpNext?.toLocaleString('ru-RU') || '—'}
        </span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,.45)' }}>
          Ур.{level} → Ур.{level + 1}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
        <div ref={barRef} style={{
          height: '100%', borderRadius: 3, width: '0%',
          background: 'linear-gradient(90deg, #F0C850, #ff8c00)',
          boxShadow: '0 0 8px rgba(240,200,80,.5)',
        }} />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   STAT PILL
═══════════════════════════════════════════════════════════════════ */
function StatPill({ icon, value, label, delay = 0 }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2, animation:`statSlide .5s ease ${delay}s both` }}>
      <div style={{ display:'flex', alignItems:'baseline', gap:3 }}>
        <span style={{ fontSize:14, color:'#F0C850', fontFamily:'serif' }}>{icon}</span>
        <span style={{ fontSize:18, fontWeight:800, color:'#fff', letterSpacing:-.5 }}>{value}</span>
      </div>
      <span style={{ fontSize:10, color:'rgba(255,255,255,.38)', textTransform:'uppercase', letterSpacing:.8 }}>{label}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   VIKING HERO CARD — the WOW section
═══════════════════════════════════════════════════════════════════ */
function VikingHeroCard({ profile, runes, xp, level, totalShifts, cosmetics, title, assets }) {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const rank = getRank(level);

  const theme = resolveThemeStyle(cosmetics?.active_theme, assets?.theme || null);
  const frame = resolveFrameStyle(cosmetics?.active_frame, assets?.frame || null);
  const badgeSvg = resolveBadgeSvg(cosmetics?.active_badge, assets?.badge || null);

  const accent = theme.accent;
  const bg = theme.bg;
  const frameAnim = theme.anim;

  const { current: xpCurrent, next: xpNext } = getXpProgress(xp);

  const hasFrame  = !!frame;
  const hasBadge  = !!badgeSvg;

  const PORTRAIT_W = 300;
  const ORBIT_SZ   = PORTRAIT_W + 48;

  return (
    <div style={{ background: bg, borderRadius: '0 0 28px 28px', overflow: 'hidden', position: 'relative', paddingBottom: 28 }}>
      {/* Floating background runes */}
      {['ᚠ','ᚢ','ᚨ','ᚱ','ᛟ'].map((r, i) => (
        <div key={i} style={{
          position: 'absolute', fontSize: 20, color: `${accent}22`,
          top: `${8 + i * 16}%`, ...(i % 2 === 0 ? { left: `${4 + i * 3}%` } : { right: `${4 + i * 3}%` }),
          animation: `runeFloat ${5 + i * 1.4}s ease-in-out ${i * 0.7}s infinite`,
          pointerEvents: 'none', fontFamily: 'serif', userSelect: 'none',
        }}>{r}</div>
      ))}

      {/* Character portrait section */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 32, gap: 0 }}>
        {/* Portrait + orbit container */}
        <div style={{ position: 'relative', width: ORBIT_SZ, height: ORBIT_SZ, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {hasFrame && <RuneOrbitRing size={ORBIT_SZ} color={frame.color} />}

          <div style={{
            borderRadius: 22,
            overflow: 'hidden',
            animation: `${frameAnim} 3s ease-in-out infinite`,
            /* static glow lives in keyframes — do not put filter here (kills WebGL) */
            boxShadow: hasFrame
              ? `0 0 24px ${accent}60, 0 0 50px ${accent}20`
              : undefined,
          }}>
            <VikingAvatarLazy
              assets={assets || profile?.assets || {}}
              cosmetics={cosmetics || {}}
              level={level}
              size={PORTRAIT_W}
              interactive
            />
          </div>

          {/* Badge — profile chrome (not on 3D mesh). Bottom-right of portrait. */}
          {hasBadge && (
            <div
              title="Бейдж профиля"
              style={{
                position: 'absolute',
                right: 8,
                bottom: 18,
                width: 56,
                height: 56,
                borderRadius: 14,
                background: 'rgba(10,14,24,.88)',
                border: `1.5px solid ${accent}`,
                boxShadow: `0 0 16px ${accent}55, 0 4px 12px rgba(0,0,0,.45)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 4,
                zIndex: 4,
                animation: 'badgePop .5s cubic-bezier(.34,1.56,.64,1) .9s both',
              }}
            >
              <div style={{ width: 48, height: 48 }} dangerouslySetInnerHTML={{ __html: badgeSvg }} />
            </div>
          )}
        </div>

        {/* Name */}
        <h1 style={{ color: '#fff', fontSize: 19, fontWeight: 800, marginTop: 6, textAlign: 'center', padding: '0 16px', lineHeight: 1.2 }}>
          {profile?.fio || 'Воин Асгарда'}
        </h1>
        <p style={{ color: 'rgba(255,255,255,.45)', fontSize: 12, marginTop: 3 }}>
          {[profile?.position, profile?.city].filter(Boolean).join(' · ')}
        </p>

        {/* Rank badge */}
        <div style={{
          marginTop: 10, display: 'flex', alignItems: 'center', gap: 7,
          background: `${accent}18`, border: `1px solid ${accent}40`,
          borderRadius: 20, padding: '6px 14px',
        }}>
          <span style={{ fontSize: 17, fontFamily: 'serif', color: accent, animation: 'rankGlow 2.5s ease-in-out infinite' }}>
            {rank.rune}
          </span>
          <span style={{ fontSize: 14, fontWeight: 800, color: accent, letterSpacing: .5 }}>{rank.title}</span>
          <span style={{ fontSize: 11, color: `${accent}80` }}>· Ур.{level}</span>
        </div>

        {/* Title badge — earned from achievements */}
        {title && (
          <div style={{
            marginTop: 6, display: 'flex', alignItems: 'center', gap: 6,
            background: `${title.color}15`, border: `1px solid ${title.color}50`,
            borderRadius: 20, padding: '4px 12px',
          }}>
            <span style={{ fontSize: 13 }}>{title.icon}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: title.color }}>{title.name}</span>
            {title.next_title && (
              <span style={{ fontSize: 10, color: `${title.color}70` }}>
                · +{title.next_title.needed} до {title.next_title.name}
              </span>
            )}
          </div>
        )}

        {/* Stats */}
        <div style={{ display: 'flex', gap: 24, marginTop: 16, marginBottom: 10 }}>
          <StatPill icon="ᚱ" value={runes.toLocaleString('ru-RU')} label="рун" delay={0.1} />
          <div style={{ width: 1, background: 'rgba(255,255,255,.1)', alignSelf: 'stretch' }} />
          <StatPill icon="⚡" value={xp.toLocaleString('ru-RU')} label="XP" delay={0.2} />
          <div style={{ width: 1, background: 'rgba(255,255,255,.1)', alignSelf: 'stretch' }} />
          <StatPill icon="🗡" value={totalShifts} label="смен" delay={0.3} />
        </div>

        {/* XP progress bar */}
        <XpBar xpCurrent={xpCurrent} xpNext={xpNext} level={level} />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   EQUIPMENT SLOTS PANEL
═══════════════════════════════════════════════════════════════════ */
const APPEARANCE_SLOTS = [
  { key: 'active_avatar', label: 'Аватар', rune: 'ᚠ' },
  { key: 'active_frame',  label: 'Рамка',  rune: 'ᚢ' },
  { key: 'active_badge',  label: 'Бейдж',  rune: 'ᚦ' },
  { key: 'active_theme',  label: 'Тема',   rune: 'ᚨ' },
];
const AMMO_SLOTS = [
  { key: 'active_helmet', label: 'Шлем',   rune: 'ᛏ' },
  { key: 'active_weapon', label: 'Оружие', rune: 'ᛒ' },
  { key: 'active_armor',  label: 'Броня',  rune: 'ᛖ' },
];

function SlotGrid({ slots, cosmetics, navigate, haptic }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${slots.length},1fr)`, gap: 8, padding: '8px 12px' }}>
      {slots.map(slot => {
        const val = cosmetics?.[slot.key];
        // Extract name from quotes: "Рогатый" or «Рогатый» or just trim
        const shortName = val
          ? (val.match(/["""«]([^"""»]+)["""»]/) || [])[1] || val.replace(/^[^\s]+\s/, '').replace(/^["«]|["»]$/g, '').trim() || val
          : null;
        return (
          <button key={slot.key}
            onClick={() => { haptic.light(); navigate('/field/inventory'); }}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              padding: '10px 4px', borderRadius: 12,
              background: val ? 'rgba(240,200,80,.07)' : 'var(--bg-primary)',
              border: `1px solid ${val ? 'rgba(240,200,80,.28)' : 'var(--border-norse)'}`,
              cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
            }}>
            <span style={{ fontSize: 20 }}>{val ? '✨' : slot.rune}</span>
            <span style={{ fontSize: 9, color: 'var(--text-tertiary)', textAlign: 'center' }}>{slot.label}</span>
            <span style={{
              fontSize: 8, color: val ? 'var(--gold)' : 'rgba(255,255,255,.18)',
              textAlign: 'center', maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {shortName || '—'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function EquipmentSlots({ cosmetics, navigate, haptic }) {
  const allSlots = [...APPEARANCE_SLOTS, ...AMMO_SLOTS];
  const count = allSlots.filter(s => cosmetics?.[s.key]).length;
  return (
    <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid var(--border-norse)', backgroundColor: 'var(--bg-elevated)' }}>
      {/* Header */}
      <div style={{ padding: '12px 16px 8px', borderBottom: '1px solid var(--border-norse)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={15} color="var(--gold)" />
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-tertiary)' }}>
            Снаряжение
          </span>
        </div>
        {count > 0 && (
          <span style={{ fontSize: 11, color: 'var(--gold)', fontWeight: 600 }}>{count}/7 надето</span>
        )}
      </div>

      {/* Row 1: Appearance (4 slots) */}
      <div style={{ padding: '4px 0 0', borderBottom: '1px solid var(--border-norse)' }}>
        <p style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: .8, padding: '4px 12px 0' }}>Образ</p>
        <SlotGrid slots={APPEARANCE_SLOTS} cosmetics={cosmetics} navigate={navigate} haptic={haptic} />
      </div>

      {/* Row 2: Ammo (3 slots) */}
      <div style={{ padding: '4px 0 0' }}>
        <p style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: .8, padding: '4px 12px 0' }}>Амуниция</p>
        <SlotGrid slots={AMMO_SLOTS} cosmetics={cosmetics} navigate={navigate} haptic={haptic} />
      </div>

      {/* CTA */}
      <button
        onClick={() => { haptic.medium(); navigate('/field/inventory'); }}
        style={{
          width: 'calc(100% - 24px)', margin: '4px 12px 12px', padding: '11px 0', borderRadius: 12,
          background: 'linear-gradient(135deg,rgba(240,200,80,.12),rgba(240,200,80,.04))',
          border: '1px solid rgba(240,200,80,.25)',
          color: 'var(--gold)', fontSize: 13, fontWeight: 600,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}>
        <Sparkles size={14} /> Настроить образ
      </button>
    </div>
  );
}

/* удалено: ACHIEVEMENTS (заменено динамической загрузкой из API) */

/* ═══════════════════════════════════════════════════════════════════
   SKELETON
═══════════════════════════════════════════════════════════════════ */
function Skeleton() {
  return (
    <div style={{ background: 'linear-gradient(180deg,#0a0e1a,#111827)', borderRadius: '0 0 28px 28px', padding: '32px 24px 28px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 120, height: 170, borderRadius: 16, background: 'rgba(255,255,255,.06)', animation: 'statSlide 1s ease infinite alternate' }} />
        <div style={{ width: 160, height: 16, borderRadius: 8, background: 'rgba(255,255,255,.06)' }} />
        <div style={{ width: 100, height: 12, borderRadius: 6, background: 'rgba(255,255,255,.04)' }} />
        <div style={{ display: 'flex', gap: 20, marginTop: 8 }}>
          {[1,2,3].map(i=><div key={i} style={{ width: 50, height: 32, borderRadius: 8, background: 'rgba(255,255,255,.05)' }} />)}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════ */
export default function FieldProfile() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const employee = useFieldAuthStore((s) => s.employee);
  const [profile, setProfile] = useState(null);
  const [permits, setPermits] = useState([]);
  const [personal, setPersonal] = useState(null);
  const [workData, setWorkData] = useState(null);
  const [achievementsData, setAchievementsData] = useState(null);
  const [seasonalData, setSeasonalData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [personalOpen, setPersonalOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editData, setEditData] = useState({});
  const [editErrors, setEditErrors] = useState({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [darkMode, setDarkMode] = useState(() => document.documentElement.classList.contains('dark'));
  const [rankCeremony, setRankCeremony] = useState(null);
  const ceremonyShownRef = useRef(false);

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  const loadProfile = useCallback(async () => {
    const maxAttempts = 4;
    let me = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        me = await fieldApi.get('/worker/me');
        break;
      } catch {
        if (attempt < maxAttempts) await delay(400 * attempt);
      }
    }
    if (me) setProfile(me);
    setLoading(false);
    if (!me) return;

    const [perms, pers, proj, achs, seas] = await Promise.all([
      fieldApi.get('/worker/permits').catch(() => []),
      fieldApi.get('/worker/personal').catch(() => null),
      fieldApi.get('/worker/active-project').catch(() => null),
      fieldApi.get('/achievements/').catch(() => null),
      fieldApi.get('/seasonal/').catch(() => null),
    ]);
    setPermits(Array.isArray(perms) ? perms : perms?.permits || []);
    setPersonal(pers?.employee || pers);
    setWorkData(proj?.project || proj);
    if (achs) setAchievementsData(achs);
    if (seas) setSeasonalData(seas);
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') loadProfile();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [loadProfile]);

  useEffect(() => {
    if (!profile || ceremonyShownRef.current) return;
    try {
      if (sessionStorage.getItem('field_rank_ceremony_session')) return;
    } catch { /* */ }
    const lvl = getLevel(profile.xp || 0);
    const rank = getRank(lvl);
    const empId = profile.id || employee?.id;
    const chk = checkRankCeremony(empId, rank.title);
    if (!chk.show) return;
    if (chk.prevTitle && rankIndex(rank.title) <= rankIndex(chk.prevTitle)) return;
    ceremonyShownRef.current = true;
    try { sessionStorage.setItem('field_rank_ceremony_session', '1'); } catch { /* */ }
    setRankCeremony({ rank, prevTitle: chk.prevTitle, level: lvl, welcome: !!chk.welcome });
  }, [profile, employee?.id]);

  const toggleTheme = () => {
    haptic.light();
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  };
  const handleLogout = () => {
    haptic.heavy();
    useFieldAuthStore.getState().logout();
    navigate('/field-login');
  };
  const startEdit = () => {
    haptic.light();
    setEditErrors({});
    setSaveError('');
    setEditData(buildEditForm(personal || {}));
    setEditOpen(true);
  };
  const cancelEdit = () => {
    setEditOpen(false);
    setEditData({});
    setEditErrors({});
    setSaveError('');
  };
  const saveEdit = async () => {
    haptic.medium();
    const errs = validatePersonalForm(editData);
    setEditErrors(errs);
    if (Object.values(errs).some(Boolean)) {
      setSaveError('Исправь ошибки в форме');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const payload = buildPersonalPayload(editData);
      const res = await fieldApi.put('/worker/personal', payload);
      setPersonal({ ...(personal || {}), ...payload, ...(res?.employee || {}) });
      setEditOpen(false);
      haptic.success();
    } catch (e) {
      setSaveError(e?.message || 'Не удалось сохранить');
      haptic.error();
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Skeleton />;

  const runes  = profile?.runes  || 0;
  const xp     = profile?.xp     || 0;
  const level  = getLevel(xp);
  const totalShifts = profile?.total_shifts || 0;
  const cosmetics = {
    active_avatar: profile?.active_avatar,
    active_frame:  profile?.active_frame,
    active_badge:  profile?.active_badge,
    active_theme:  profile?.active_theme,
    active_helmet: profile?.active_helmet,
    active_weapon: profile?.active_weapon,
    active_armor:  profile?.active_armor,
  };

  return (
    <>
      <style>{ANIM_CSS}</style>
      {rankCeremony && (
        <RankUpCeremony
          open
          rank={rankCeremony.rank}
          prevRank={rankCeremony.prevTitle}
          level={rankCeremony.level}
          assets={profile?.assets || {}}
          cosmetics={cosmetics}
          employeeId={profile?.id || employee?.id}
          haptic={haptic}
          welcome={!!rankCeremony.welcome}
          onClose={() => setRankCeremony(null)}
        />
      )}
      <div className="pb-24" style={{ backgroundColor: 'var(--bg-primary)', minHeight: '100%' }}>

        {/* ═══ HERO CARD ══════════════════════════════════════════════ */}
        <VikingHeroCard
          profile={profile} runes={runes} xp={xp} level={level}
          totalShifts={totalShifts} cosmetics={cosmetics}
          assets={profile?.assets || {}}
          title={profile?.title || achievementsData?.title || null}
        />

        <div className="space-y-3 p-4 pt-3">

          {/* ═══ EQUIPMENT SLOTS ══════════════════════════════════════ */}
          <EquipmentSlots cosmetics={cosmetics} navigate={navigate} haptic={haptic} />

          {/* ═══ ACTIVE WORK ══════════════════════════════════════════ */}
          <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
            <div className="flex items-center gap-2 mb-3">
              <Briefcase size={15} style={{ color: 'var(--gold)' }} />
              <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Моя работа</span>
            </div>
            {workData && (workData.work_title || workData.title) ? (
              <div className="space-y-2">
                <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{workData.work_title || workData.title}</p>
                {(workData.date_from || workData.date_to) && (
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    📅 {workData.date_from ? new Date(workData.date_from).toLocaleDateString('ru-RU') : ''} — {workData.date_to ? new Date(workData.date_to).toLocaleDateString('ru-RU') : '...'}
                  </p>
                )}
                {workData.shift_type && (
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {workData.shift_type === 'night' ? '🌙 Ночная' : '☀️ Дневная'} смена
                  </p>
                )}
                {workData.masters?.length > 0 && (
                  <div className="pt-2 mt-2 space-y-1" style={{ borderTop: '1px solid var(--border-norse)' }}>
                    <p className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>👷 Мастера</p>
                    {workData.masters.map((m, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{shortFio(m.fio)}</span>
                        {m.phone && (
                          <a href={`tel:${m.phone.replace(/[^\d+]/g, '')}`} className="px-3 py-1 rounded-lg text-xs font-medium"
                            style={{ background: 'linear-gradient(135deg,var(--gold),#b8860b)', color: '#fff' }}>📞 Звонок</a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {workData.pm?.fio && (
                  <div className="pt-2 mt-1 space-y-1" style={{ borderTop: '1px solid var(--border-norse)' }}>
                    <p className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>👔 РП</p>
                    <div className="flex items-center justify-between">
                      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{shortFio(workData.pm.fio)}</span>
                      {workData.pm.phone && (
                        <a href={`tel:${workData.pm.phone.replace(/[^\d+]/g, '')}`} className="px-3 py-1 rounded-lg text-xs font-medium"
                          style={{ background: 'linear-gradient(135deg,var(--gold),#b8860b)', color: '#fff' }}>📞 Звонок</a>
                      )}
                    </div>
                  </div>
                )}
                <div className="flex gap-2 mt-2">
                  <button onClick={() => navigate('/field/timesheet')} className="flex-1 py-2.5 rounded-lg text-sm font-medium text-center"
                    style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}>
                    📋 Табель
                  </button>
                  <button onClick={() => navigate('/field/diary')} className="flex-1 py-2.5 rounded-lg text-sm font-medium text-center"
                    style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--gold)' }}>
                    📖 Дневник
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-center py-2" style={{ color: 'var(--text-tertiary)' }}>Нет активной работы</p>
            )}
          </div>

          {/* ═══ ПЛАНИРУЕМОЕ ПРИВЛЕЧЕНИЕ ═══════════════════════════════ */}
          {profile?.planned_engagement && (
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid rgba(74,144,217,0.35)' }}>
              <div className="flex items-center gap-2 mb-3">
                <ClipboardList size={15} style={{ color: '#4A90D9' }} />
                <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#4A90D9' }}>
                  Планируемое привлечение
                </span>
              </div>
              <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                {profile.planned_engagement.work_title}
              </p>
              {profile.planned_engagement.pm_name && (
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                  РП: {profile.planned_engagement.pm_name}
                </p>
              )}
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                <Calendar size={11} className="inline mr-1" style={{ verticalAlign: '-1px' }} />
                {fmtPlanPeriod(profile.planned_engagement.planned_from, profile.planned_engagement.planned_to)}
              </p>
              <p className="text-xs mt-2 italic" style={{ color: 'var(--text-tertiary)' }}>
                Это план, не назначение. Смена начнётся после выезда на объект.
              </p>
            </div>
          )}

          {/* ═══ ACHIEVEMENTS ═════════════════════════════════════════ */}
          <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Award size={15} style={{ color: 'var(--gold)' }} />
                <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Подвиги</span>
                {achievementsData && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full font-bold"
                    style={{ background: 'color-mix(in srgb, var(--gold) 20%, transparent)', color: 'var(--gold)' }}>
                    {achievementsData.earned_count}/{achievementsData.total_count}
                  </span>
                )}
              </div>
              <button onClick={() => navigate('/field/achievements')}
                className="text-xs font-medium"
                style={{ color: 'var(--gold)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                Все →
              </button>
            </div>

            {!achievementsData ? (
              <div className="grid grid-cols-4 gap-2">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="aspect-square rounded-lg animate-pulse"
                    style={{ backgroundColor: 'var(--bg-primary)' }} />
                ))}
              </div>
            ) : (
              <>
                {/* Прогресс-бар + Титул */}
                <div className="mb-3">
                  {/* Title progress strip */}
                  {achievementsData.title && (
                    <div className="flex items-center gap-2 mb-2 p-2 rounded-lg"
                      style={{ backgroundColor: achievementsData.title.color + '12', border: `1px solid ${achievementsData.title.color}30` }}>
                      <span style={{ fontSize: 16 }}>{achievementsData.title.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold" style={{ color: achievementsData.title.color }}>{achievementsData.title.name}</span>
                          {achievementsData.title.next_title && (
                            <span style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>
                              → {achievementsData.title.next_title.name} за {achievementsData.title.next_title.needed} подв.
                            </span>
                          )}
                        </div>
                        {achievementsData.title.next_title && (
                          <div className="h-1 rounded-full overflow-hidden mt-1" style={{ background: 'var(--bg-primary)' }}>
                            <div className="h-full rounded-full"
                              style={{
                                width: `${Math.min(100, ((achievementsData.title.earned_count - achievementsData.title.min) / (achievementsData.title.next_title.min - achievementsData.title.min)) * 100)}%`,
                                backgroundColor: achievementsData.title.color,
                              }} />
                          </div>
                        )}
                      </div>
                      <span style={{ fontSize: 9, color: 'var(--text-tertiary)', flexShrink: 0 }}>
                        🎡 -{achievementsData.title.pity_guarantee > 0 ? 50 - achievementsData.title.pity_guarantee : 0} к пити
                      </span>
                    </div>
                  )}

                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
                    <div className="h-full rounded-full transition-all"
                      style={{
                        width: `${achievementsData.total_count > 0 ? (achievementsData.earned_count / achievementsData.total_count * 100) : 0}%`,
                        background: 'linear-gradient(90deg, var(--gold), #f59e0b)',
                      }} />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                      {achievementsData.earned_count} получено
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                      {achievementsData.points || 0} очков
                    </span>
                  </div>
                </div>

                {/* Последние полученные (до 8) */}
                {(() => {
                  const earned = (achievementsData.achievements || []).filter(a => a.earned)
                    .sort((a, b) => new Date(b.earned_at) - new Date(a.earned_at))
                    .slice(0, 8);
                  const inProgress = (achievementsData.achievements || [])
                    .filter(a => !a.earned && a.current > 0)
                    .sort((a, b) => (b.current / b.threshold) - (a.current / a.threshold))
                    .slice(0, Math.max(0, 8 - earned.length));
                  const display = [...earned, ...inProgress].slice(0, 8);

                  return (
                    <div className="grid grid-cols-4 gap-2">
                      {display.map(a => {
                        const tierColor = { cup: '#cd7f32', medal: '#c0c0c0', order: '#ffd700', legend: '#8b5cf6' }[a.tier] || '#6b7280';
                        return (
                          <button key={a.id}
                            onClick={() => { haptic.light(); navigate('/field/achievements'); }}
                            className="flex flex-col items-center gap-1 p-2 rounded-lg"
                            style={{
                              backgroundColor: 'var(--bg-primary)',
                              border: `1px solid ${a.earned ? tierColor + '50' : 'transparent'}`,
                              opacity: a.earned ? 1 : 0.5,
                              filter: a.earned ? 'none' : 'grayscale(0.6)',
                            }}>
                            <span style={{ fontSize: 22 }}>{a.icon}</span>
                            <span className="text-center leading-tight line-clamp-2"
                              style={{ color: 'var(--text-secondary)', fontSize: '0.55rem' }}>{a.name}</span>
                            {!a.earned && a.current > 0 && (
                              <div className="w-full h-0.5 rounded-full overflow-hidden" style={{ background: 'var(--border-norse)' }}>
                                <div className="h-full rounded-full"
                                  style={{ width: `${(a.current / a.threshold) * 100}%`, background: tierColor }} />
                              </div>
                            )}
                          </button>
                        );
                      })}
                      {display.length === 0 && (
                        <div className="col-span-4 text-center py-3"
                          style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
                          Начни работать — первый подвиг уже ждёт
                        </div>
                      )}
                    </div>
                  );
                })()}
              </>
            )}
          </div>

          {/* ═══ SEASONAL CHALLENGES TEASER ═══════════════════════════ */}
          {seasonalData?.active?.length > 0 && (() => {
            const ch = seasonalData.active[0];
            const pct = ch.tasks_total > 0 ? Math.round((ch.tasks_done / ch.tasks_total) * 100) : 0;
            return (
              <button
                onClick={() => { haptic.light(); navigate('/field/seasonal'); }}
                className="w-full text-left rounded-xl p-4 space-y-2"
                style={{ backgroundColor: 'var(--bg-elevated)', border: `1px solid ${ch.color}40`,
                  background: `linear-gradient(135deg, ${ch.color}12 0%, var(--bg-elevated) 60%)` }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{ch.icon}</span>
                    <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                      Сезон: {ch.season_name}
                    </span>
                    {ch.fully_completed && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                        style={{ backgroundColor: ch.color + '25', color: ch.color }}>✓</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1" style={{ color: ch.color }}>
                    <span className="text-xs font-bold">{pct}%</span>
                    <Sparkles size={12} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span style={{ color: 'var(--text-tertiary)' }}>{ch.tasks_done}/{ch.tasks_total} заданий</span>
                    <span style={{ color: 'var(--text-tertiary)' }}>⏳ {ch.days_left}д</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)' }}>
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: ch.color }} />
                  </div>
                </div>
                <p className="text-xs" style={{ color: ch.color + 'cc' }}>
                  Награда: {ch.reward_label || (
                    `${ch.reward_value} ${ch.reward_type === 'runes' ? 'рун' : ch.reward_type === 'xp' ? 'XP' : 'очков'}`
                  )}
                </p>
              </button>
            );
          })()}

          {/* ═══ PERMITS ══════════════════════════════════════════════ */}
          {permits.length > 0 && (
            <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
              <div className="flex items-center gap-2 mb-1">
                <Shield size={16} style={{ color: 'var(--gold)' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Допуски и удостоверения</span>
              </div>
              {permits.map((p, i) => {
                const st = expiryStatus(p.expiry_date || p.valid_until);
                const ec = EXP_COLORS[st];
                return (
                  <div key={i} className="flex items-start justify-between gap-2 py-2 border-t" style={{ borderColor: 'var(--border-norse)' }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{p.name || p.title || p.permit_name}</p>
                      {p.doc_number && <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>№ {p.doc_number}</p>}
                      {(p.expiry_date || p.valid_until) && <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>до {new Date(p.expiry_date || p.valid_until).toLocaleDateString('ru-RU')}</p>}
                    </div>
                    {ec.label && <span className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: ec.bg, color: ec.color }}>{ec.label}</span>}
                  </div>
                );
              })}
            </div>
          )}

          {/* ═══ PERSONAL DATA ════════════════════════════════════════ */}
          <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
            <button className="w-full flex items-center justify-between p-4"
              onClick={() => { haptic.light(); setPersonalOpen(!personalOpen); }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Личные данные</span>
              {personalOpen ? <ChevronUp size={18} style={{ color: 'var(--text-tertiary)' }} /> : <ChevronDown size={18} style={{ color: 'var(--text-tertiary)' }} />}
            </button>
            {personalOpen && (
              <div className="px-4 pb-4 space-y-3">
                {personal ? (
                  PERSONAL_GROUPS.map((group) => {
                    const rows = group.fields
                      .map((f) => ({ f, val: formatPersonalViewValue(personal, f) }))
                      .filter((r) => r.val != null && r.val !== '');
                    if (!rows.length) return null;
                    return (
                      <div key={group.id} className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-widest pt-1"
                          style={{ color: 'var(--text-tertiary)' }}>{group.title}</p>
                        {rows.map(({ f, val }) => (
                          <div key={f.key}>
                            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{f.label}</p>
                            <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{val}</p>
                          </div>
                        ))}
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Данные не заполнены</p>
                )}
                <button
                  className="flex items-center gap-1 mt-2 text-sm font-medium"
                  style={{ color: 'var(--gold)' }}
                  onClick={startEdit}
                >
                  <Edit3 size={14} /> Исправить данные
                </button>
              </div>
            )}
          </div>

          <PersonalEditSheet
            open={editOpen}
            editData={editData}
            setEditData={setEditData}
            editErrors={editErrors}
            saveError={saveError}
            saving={saving}
            onClose={cancelEdit}
            onSave={saveEdit}
          />

          {/* ═══ THEME TOGGLE ═════════════════════════════════════════ */}
          <button className="w-full flex items-center justify-between rounded-xl p-4"
            style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }} onClick={toggleTheme}>
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{darkMode ? 'Тёмная тема' : 'Светлая тема'}</span>
            {darkMode ? <Moon size={18} style={{ color: 'var(--gold)' }} /> : <Sun size={18} style={{ color: 'var(--gold)' }} />}
          </button>

          {/* ═══ LOGOUT ═══════════════════════════════════════════════ */}
          <button className="w-full flex items-center justify-center gap-2 rounded-xl p-4 font-medium text-sm"
            style={{ backgroundColor: '#dc262615', color: '#dc2626', border: '1px solid #dc262630' }} onClick={handleLogout}>
            <LogOut size={18} /> Выйти из аккаунта
          </button>

          <p className="text-center text-xs py-2" style={{ color: 'var(--text-tertiary)' }}>ASGARD Field v2.0.0</p>
        </div>
      </div>
    </>
  );
}

const PERSONAL_GROUPS = [
  {
    id: 'contacts',
    title: 'Контакты',
    fields: [
      { key: 'fio', label: 'ФИО' },
      { key: 'phone', label: 'Телефон', mask: 'phone' },
      { key: 'phone2', label: 'Доп. телефон', mask: 'phone' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'telegram', label: 'Telegram' },
      { key: 'birth_date', label: 'Дата рождения', type: 'date' },
      { key: 'gender', label: 'Пол', type: 'gender' },
      { key: 'city', label: 'Город' },
      { key: 'address', label: 'Адрес' },
      { key: 'registration_address', label: 'Адрес регистрации' },
    ],
  },
  {
    id: 'documents',
    title: 'Документы',
    fields: [
      { key: 'passport_series', label: 'Серия паспорта', mask: 'passport_series' },
      { key: 'passport_number', label: 'Номер паспорта', mask: 'passport_number' },
      { key: 'passport_issued', label: 'Кем выдан' },
      { key: 'passport_date', label: 'Дата выдачи', type: 'date' },
      { key: 'passport_code', label: 'Код подразделения', mask: 'passport_code' },
      { key: 'inn', label: 'ИНН', mask: 'digits', maxLen: 12 },
      { key: 'snils', label: 'СНИЛС', mask: 'snils' },
      { key: 'is_self_employed', label: 'Самозанятый', type: 'bool' },
      { key: 'naks', label: 'НАКС' },
      { key: 'naks_expiry', label: 'НАКС до', type: 'date' },
      { key: 'imt_number', label: 'Удостоверение ИТР' },
      { key: 'imt_expires', label: 'ИТР до', type: 'date' },
    ],
  },
  {
    id: 'ppe',
    title: 'СИЗ',
    fields: [
      { key: 'clothing_size', label: 'Размер одежды', type: 'ppe_size' },
      { key: 'shoe_size', label: 'Размер обуви', type: 'ppe_size' },
      { key: 'headwear_size', label: 'Размер каски', type: 'ppe_size' },
      { key: 'blood_type', label: 'Группа крови', maxLen: 40 },
      { key: 'height', label: 'Рост', type: 'number' },
      { key: 'medical_notes', label: 'Мед. заметки' },
    ],
  },
  {
    id: 'emergency',
    title: 'Экстренные контакты',
    fields: [
      { key: 'spouse_name', label: 'Супруг(а)' },
      { key: 'spouse_phone', label: 'Телефон супруга(и)', mask: 'phone' },
      { key: 'relative_name', label: 'Родственник' },
      { key: 'relative_relation', label: 'Кем приходится' },
      { key: 'relative_phone', label: 'Телефон родственника', mask: 'phone' },
    ],
  },
  {
    id: 'bank',
    title: 'Банк',
    fields: [
      { key: 'bank_name', label: 'Банк' },
      { key: 'bik', label: 'БИК', mask: 'digits', maxLen: 9 },
      { key: 'account_number', label: 'Счёт', mask: 'digits', maxLen: 20 },
      { key: 'card_number', label: 'Карта', mask: 'digits', maxLen: 19 },
    ],
  },
  {
    id: 'education',
    title: 'Образование и семья',
    fields: [
      { key: 'education', label: 'Образование' },
      { key: 'specialty', label: 'Специальность' },
      { key: 'marital_status', label: 'Семейное положение' },
      { key: 'children_count', label: 'Детей', type: 'number' },
    ],
  },
];

function dateOnly(v) {
  if (!v) return '';
  return String(v).slice(0, 10);
}

function buildEditForm(p) {
  const form = {};
  for (const g of PERSONAL_GROUPS) {
    for (const f of g.fields) {
      let v = p[f.key];
      if (f.key === 'passport_series') v = p.passport_series || p.pass_series || '';
      if (f.key === 'passport_number') v = p.passport_number || p.pass_number || '';
      if (f.type === 'date') v = dateOnly(v);
      if (f.type === 'bool') {
        if (v === true || v === 'true') v = 'true';
        else if (v === false || v === 'false') v = 'false';
        else v = '';
      }
      if (f.mask === 'phone') v = normalizeRuPhoneDigits(v || '') || (v || '');
      if (f.mask === 'snils' || f.mask === 'passport_code' || f.mask === 'passport_series' || f.mask === 'passport_number' || f.mask === 'digits') {
        v = digitsOf(v || '');
        if (f.maxLen) v = v.slice(0, f.maxLen);
        if (f.mask === 'passport_series') v = v.slice(0, 4);
        if (f.mask === 'passport_number') v = v.slice(0, 6);
        if (f.mask === 'passport_code') v = v.slice(0, 6);
        if (f.mask === 'snils') v = v.slice(0, 11);
      }
      form[f.key] = v == null ? '' : v;
    }
  }
  return form;
}

function formatPersonalViewValue(personal, f) {
  let val = personal[f.key];
  if (f.key === 'passport_series') val = personal.passport_series || personal.pass_series;
  if (f.key === 'passport_number') val = personal.passport_number || personal.pass_number;
  if (val == null || val === '') return null;
  if (f.type === 'bool') return val === true || val === 'true' ? 'Да' : (val === false || val === 'false' ? 'Нет' : String(val));
  if (f.type === 'gender') {
    const g = String(val).toLowerCase();
    if (g === 'male' || g === 'm' || g === 'м') return 'Мужской';
    if (g === 'female' || g === 'f' || g === 'ж') return 'Женский';
    return val;
  }
  if (f.type === 'date' && val) {
    try {
      return new Date(val).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch {
      return String(val).slice(0, 10);
    }
  }
  if (f.mask === 'phone') return formatRuPhoneDisplay(val) || val;
  if (f.mask === 'snils') return formatSnilsDisplay(val) || val;
  if (f.mask === 'passport_code') return formatPassportCodeDisplay(val) || val;
  return String(val);
}

function validatePersonalForm(form) {
  return {
    phone: phoneError(form.phone),
    phone2: phoneError(form.phone2),
    spouse_phone: phoneError(form.spouse_phone),
    relative_phone: phoneError(form.relative_phone),
    snils: snilsError(form.snils),
    passport_series: passportSeriesError(form.passport_series),
    passport_number: passportNumberError(form.passport_number),
    passport_code: passportCodeError(form.passport_code),
    bik: form.bik && digitsOf(form.bik).length !== 9 ? 'БИК — 9 цифр' : null,
    account_number: form.account_number && digitsOf(form.account_number).length !== 20 ? 'Счёт — 20 цифр' : null,
  };
}

function buildPersonalPayload(form) {
  const payload = {};
  for (const g of PERSONAL_GROUPS) {
    for (const f of g.fields) {
      let v = form[f.key];
      if (typeof v === 'string') v = v.trim();
      if (f.mask === 'phone') v = normalizeRuPhoneDigits(v) || null;
      if (f.mask === 'snils' || f.mask === 'passport_code' || f.mask === 'passport_series' || f.mask === 'passport_number' || f.mask === 'digits') {
        v = digitsOf(v);
        if (f.maxLen) v = v.slice(0, f.maxLen);
        if (f.mask === 'passport_series') v = v.slice(0, 4);
        if (f.mask === 'passport_number') v = v.slice(0, 6);
        if (f.mask === 'passport_code') v = v.slice(0, 6);
        if (f.mask === 'snils') v = v.slice(0, 11);
      }
      if (f.type === 'bool') {
        if (v === 'true') v = true;
        else if (v === 'false') v = false;
        else v = null;
      }
      if (f.type === 'number') {
        if (v === '' || v == null) v = null;
        else v = Number(v);
      }
      if (f.maxLen && typeof v === 'string') v = v.slice(0, f.maxLen);
      payload[f.key] = v === '' ? null : v;
    }
  }
  return payload;
}

function fieldDisplayValue(f, editData) {
  const raw = editData[f.key] ?? '';
  if (f.mask === 'phone') return formatRuPhoneDisplay(raw);
  if (f.mask === 'snils') return formatSnilsDisplay(raw);
  if (f.mask === 'passport_code') return formatPassportCodeDisplay(raw);
  if (f.type === 'date') return dateOnly(raw);
  return raw;
}

function onFieldChange(f, raw, editData, setEditData) {
  let v = raw;
  if (f.mask === 'phone') v = normalizeRuPhoneDigits(raw);
  else if (f.mask === 'snils' || f.mask === 'passport_code' || f.mask === 'passport_series' || f.mask === 'passport_number' || f.mask === 'digits') {
    v = digitsOf(raw);
    if (f.maxLen) v = v.slice(0, f.maxLen);
    if (f.mask === 'passport_series') v = v.slice(0, 4);
    if (f.mask === 'passport_number') v = v.slice(0, 6);
    if (f.mask === 'passport_code') v = v.slice(0, 6);
    if (f.mask === 'snils') v = v.slice(0, 11);
  } else if (f.maxLen) {
    v = String(raw).slice(0, f.maxLen);
  }
  setEditData({ ...editData, [f.key]: v });
}

function PersonalEditSheet({ open, editData, setEditData, editErrors, saveError, saving, onClose, onSave }) {
  const inputStyle = {
    backgroundColor: 'var(--bg-primary)',
    border: '1px solid var(--border-norse)',
    color: 'var(--text-primary)',
  };
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Исправить данные"
      maxHeight="90vh"
      footer={(
        <div className="flex gap-2">
          <button
            className="flex-1 flex items-center justify-center gap-1 rounded-xl py-3 text-sm font-semibold"
            style={{ backgroundColor: 'var(--gold)', color: 'var(--bg-primary)', opacity: saving ? 0.7 : 1 }}
            onClick={onSave}
            disabled={saving}
          >
            <Check size={16} /> {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
          <button
            className="flex-1 flex items-center justify-center gap-1 rounded-xl py-3 text-sm font-semibold"
            style={{ border: '1px solid var(--border-norse)', color: 'var(--text-secondary)' }}
            onClick={onClose}
            disabled={saving}
          >
            <X size={16} /> Отмена
          </button>
        </div>
      )}
    >
      <div className="space-y-4 pb-2">
        {saveError && (
          <p className="text-sm rounded-lg px-3 py-2"
            style={{
              color: 'var(--danger, #dc2626)',
              background: 'color-mix(in srgb, var(--danger, #dc2626) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--danger, #dc2626) 30%, transparent)',
            }}>
            {saveError}
          </p>
        )}
        {PERSONAL_GROUPS.map((group) => (
          <div key={group.id} className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: 'var(--gold)' }}>{group.title}</p>
            {group.fields.map((f) => {
              const err = editErrors?.[f.key];
              return (
                <div key={f.key}>
                  <label className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{f.label}</label>
                  {f.type === 'bool' ? (
                    <select
                      className="w-full rounded-lg px-3 py-2.5 text-sm mt-0.5 outline-none"
                      style={inputStyle}
                      value={editData[f.key] || ''}
                      onChange={(e) => setEditData({ ...editData, [f.key]: e.target.value })}
                    >
                      <option value="">—</option>
                      <option value="true">Да</option>
                      <option value="false">Нет</option>
                    </select>
                  ) : f.type === 'gender' ? (
                    <select
                      className="w-full rounded-lg px-3 py-2.5 text-sm mt-0.5 outline-none"
                      style={inputStyle}
                      value={editData[f.key] || ''}
                      onChange={(e) => setEditData({ ...editData, [f.key]: e.target.value })}
                    >
                      <option value="">—</option>
                      <option value="male">Мужской</option>
                      <option value="female">Женский</option>
                    </select>
                  ) : f.type === 'ppe_size' ? (
                    <select
                      className="w-full rounded-lg px-3 py-2.5 text-sm mt-0.5 outline-none"
                      style={{
                        ...inputStyle,
                        borderColor: err ? 'var(--danger, #dc2626)' : 'var(--border-norse)',
                      }}
                      value={editData[f.key] || ''}
                      onChange={(e) => setEditData({ ...editData, [f.key]: e.target.value })}
                    >
                      {ppeSizeOptions(f.key, editData[f.key]).map((o) => (
                        <option key={o.value || '__empty'} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="w-full rounded-lg px-3 py-2.5 text-sm mt-0.5 outline-none"
                      style={{
                        ...inputStyle,
                        borderColor: err ? 'var(--danger, #dc2626)' : 'var(--border-norse)',
                      }}
                      type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : 'text'}
                      inputMode={f.mask === 'phone' || f.mask === 'digits' || f.mask === 'snils' || f.mask?.startsWith('passport') ? 'numeric' : undefined}
                      maxLength={f.maxLen || undefined}
                      value={fieldDisplayValue(f, editData)}
                      onChange={(e) => onFieldChange(f, e.target.value, editData, setEditData)}
                    />
                  )}
                  {err && (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--danger, #dc2626)' }}>{err}</p>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </BottomSheet>
  );
}
