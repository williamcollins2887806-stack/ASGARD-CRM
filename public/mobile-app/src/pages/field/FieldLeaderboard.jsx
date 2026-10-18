import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { ArrowLeft, Trophy, Flame, Zap, Shield, Users, Star, Swords, Waves, FlaskConical, Crown, Medal } from 'lucide-react';
import './field-screens.css';

/* ═══ CSS keyframes injected once ═══ */
const CSS = `
@keyframes lb-fire { 0%,100%{transform:translateY(0) scale(1);opacity:.9} 50%{transform:translateY(-8px) scale(1.2);opacity:.5} }
@keyframes lb-gold-pulse { 0%,100%{box-shadow:0 0 12px color-mix(in oklab, var(--value) 40%, transparent),0 0 24px color-mix(in oklab, var(--value) 15%, transparent)} 50%{box-shadow:0 0 22px color-mix(in oklab, var(--value) 75%, transparent),0 0 44px color-mix(in oklab, var(--value) 30%, transparent)} }
@keyframes lb-silver-shimmer { 0%{background-position:-200% center} 100%{background-position:200% center} }
@keytml lb-slide-up { from{transform:translateY(20px);opacity:0} to{transform:translateY(0);opacity:1} }
@keyframes lb-slide-up { from{transform:translateY(20px);opacity:0} to{transform:translateY(0);opacity:1} }
@keyframes lb-crown-bob { 0%,100%{transform:translateY(0) rotate(-5deg)} 50%{transform:translateY(-4px) rotate(5deg)} }
@keyframes lb-count-pop { 0%{transform:scale(1)} 50%{transform:scale(1.18)} 100%{transform:scale(1)} }
@keyframes lb-row-in { from{transform:translateX(-16px);opacity:0} to{transform:translateX(0);opacity:1} }
@keyframes lb-bracket-draw { from{stroke-dashoffset:200} to{stroke-dashoffset:0} }
@keyframes lb-champion-glow { 0%,100%{text-shadow:0 0 8px var(--value),0 0 16px var(--value)} 50%{text-shadow:0 0 20px var(--value),0 0 40px var(--value)} }
@keyframes lb-ping { 0%{transform:scale(1);opacity:.8} 100%{transform:scale(2.2);opacity:0} }
`;

/* ═══ Animated counter hook ═══ */
function useCountUp(target, duration = 1100, active = true) {
  const [val, setVal] = useState(0);
  const rafRef = useRef(null);
  useEffect(() => {
    if (!active || !target) return;
    const to = parseInt(target) || 0;
    let start = null;
    function step(ts) {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setVal(Math.round(to * eased));
      if (progress < 1) rafRef.current = requestAnimationFrame(step);
    }
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration, active]);
  return val;
}

/* ═══ Fire particles for #1 ═══ */
function FireParticles() {
  return (
    <div style={{ position: 'absolute', bottom: -2, left: '50%', transform: 'translateX(-50%)', width: 60, height: 30, pointerEvents: 'none', zIndex: 0 }}>
      {[...Array(7)].map((_, i) => (
        <div key={i} style={{
          position: 'absolute',
          bottom: 0,
          left: `${4 + i * 8}px`,
          width: i % 2 === 0 ? 5 : 4,
          height: i % 2 === 0 ? 5 : 4,
          borderRadius: '50%',
          background: ['var(--value)','#FF8C00','#FF4500','var(--value)','#FF6B00','var(--value)','#FF4500'][i],
          animationName: 'lb-fire',
          animationDuration: `${0.7 + i * 0.15}s`,
          animationTimingFunction: 'ease-in-out',
          animationIterationCount: 'infinite',
          animationDelay: `${i * 0.12}s`,
          opacity: 0.85,
        }} />
      ))}
    </div>
  );
}

/* ═══ Rank badge ═══ */
const RANK_COLORS = {
  'Трэль':     'var(--text-secondary)',
  'Карл':      'var(--acc)',
  'Хускарл':   'var(--acc)',
  'Дружинник': 'var(--ok)',
  'Витязь':    'var(--value)',
  'Ярл':       'var(--value)',
  'Конунг':    'var(--danger)',
};

function RankBadge({ title, icon, small }) {
  const c = RANK_COLORS[title] || 'var(--text-secondary)';
  return (
    <span style={{
      fontSize: small ? 9 : 10,
      color: c,
      backgroundColor: `color-mix(in oklab, ${c} 13%, transparent)`,
      border: `1px solid color-mix(in oklab, ${c} 33%, transparent)`,
      borderRadius: 6,
      padding: small ? '1px 4px' : '2px 6px',
      fontWeight: 700,
      whiteSpace: 'nowrap',
      flexShrink: 0,
    }}>
      {icon} {title}
    </span>
  );
}

/* ═══ Avatar initials circle ═══ */
function AvatarCircle({ fio, rank, size = 44, active_avatar }) {
  const parts = (fio || '').trim().split(' ').filter(Boolean);
  const initials = parts.map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
  const isTop = rank <= 3;
  const COLORS = { 1: 'var(--value)', 2: 'var(--text-secondary)', 3: 'var(--value)' };
  const c = COLORS[rank] || null;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.32, fontWeight: 800,
      background: c ? `linear-gradient(135deg, ${c}, color-mix(in oklab, ${c} 67%, transparent))` : 'linear-gradient(135deg, var(--bg-surface-alt), var(--bg-elevated))',
      color: c ? 'var(--bg-primary)' : 'var(--text-secondary)',
      border: c ? `2px solid ${c}` : '1px solid var(--border-norse)',
      boxShadow: isTop ? `0 0 12px color-mix(in oklab, ${c} 40%, transparent)` : 'none',
      position: 'relative',
    }}>
      {initials || '?'}
    </div>
  );
}

/* ═══ XP progress bar ═══ */
function XpBar({ xp }) {
  const pct = Math.min(100, ((parseInt(xp) || 0) % 100));
  return (
    <div style={{ width: '100%', height: 3, borderRadius: 4, background: 'color-mix(in oklab, var(--text-primary) 7%, transparent)', marginTop: 3 }}>
      <div style={{ width: `${pct}%`, height: '100%', borderRadius: 4, background: 'linear-gradient(90deg,var(--acc),var(--acc))', transition: 'width 1s ease' }} />
    </div>
  );
}

/* ═══ Podium card ═══ */
function PodiumCard({ player, rank, isSelf, countersActive, onOpen }) {
  const COLORS = { 1: 'var(--value)', 2: 'var(--text-secondary)', 3: 'var(--value)' };
  const c = COLORS[rank];
  const height = rank === 1 ? 130 : rank === 2 ? 108 : 95;
  const power = useCountUp(player?.warrior_power, 1200, countersActive);

  if (!player) return <div style={{ flex: 1 }} />;
  const firstName = (player.fio || '').split(' ')[0] || '?';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(player.employee_id)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen?.(player.employee_id)}
      style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 6, minHeight: height, justifyContent: 'flex-end',
      position: 'relative', paddingBottom: 6,
      animation: `lb-slide-up ${0.3 + rank * 0.1}s ease both`,
      cursor: 'pointer',
    }}>
      {rank === 1 && (
        <>
          <div style={{ position: 'absolute', top: -10, color: 'var(--value-ink)', animation: 'lb-crown-bob 2s ease-in-out infinite' }}>
            <Crown size={22} strokeWidth={2.2} fill="currentColor" aria-hidden />
          </div>
          <FireParticles />
        </>
      )}
      {rank === 2 && (
        <div style={{ position: 'absolute', top: 0, color: 'var(--text-secondary)' }}>
          <Medal size={18} strokeWidth={2.3} aria-label="2 место" />
        </div>
      )}
      {rank === 3 && (
        <div style={{ position: 'absolute', top: 0, color: 'var(--value-ink)' }}>
          <Medal size={18} strokeWidth={2.3} aria-label="3 место" />
        </div>
      )}

      <AvatarCircle fio={player.fio} rank={rank} size={rank === 1 ? 52 : 42} />

      <div style={{
        width: '100%', borderRadius: 12, padding: '8px 6px',
        background: isSelf ? 'color-mix(in oklab, var(--value) 18%, transparent)' : `color-mix(in oklab, ${c} 9%, transparent)`,
        border: `1.5px solid color-mix(in oklab, ${c} 33%, transparent)`,
        boxShadow: rank === 1 ? undefined : undefined,
        animation: rank === 1 ? 'lb-gold-pulse 2.5s ease-in-out infinite' : 'none',
        textAlign: 'center',
      }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: isSelf ? 'var(--value)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {firstName}
        </p>
        <p style={{ fontSize: 13, fontWeight: 800, color: c, marginTop: 2 }}>
          {power.toLocaleString('ru-RU')} <span style={{ fontSize: 10, opacity: 0.8 }}>⚔️</span>
        </p>
        {player.rank_title && <RankBadge title={player.rank_title.title} icon={player.rank_title.icon} small />}
      </div>

      {/* Pedestal step */}
      <div style={{
        width: '90%', height: rank === 1 ? 18 : rank === 2 ? 12 : 8,
        borderRadius: '6px 6px 0 0',
        background: `linear-gradient(180deg, color-mix(in oklab, ${c} 53%, transparent), color-mix(in oklab, ${c} 27%, transparent))`,
        border: `1px solid color-mix(in oklab, ${c} 40%, transparent)`,
      }} />
    </div>
  );
}

/* ═══ Player row in list ═══ */
function PlayerRow({ player, isSelf, idx, visible, onOpen }) {
  const rank = parseInt(player.rank);
  const isTop3 = rank <= 3;
  const RANK_STEP = { 1: 0, 2: 1, 3: 2 };
  const rt = player.rank_title || {};

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(player.employee_id)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen?.(player.employee_id)}
      style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
      borderRadius: 14,
      backgroundColor: isSelf ? 'color-mix(in oklab, var(--value) 10%, transparent)' : isTop3 ? `color-mix(in oklab, var(--text-primary) 4%, transparent)` : 'color-mix(in oklab, var(--text-primary) 3%, transparent)',
      border: isSelf ? '1.5px solid #D4A84388' : isTop3 ? '1px solid color-mix(in oklab, var(--text-primary) 8%, transparent)' : '1px solid color-mix(in oklab, var(--text-primary) 5%, transparent)',
      boxShadow: isSelf ? '0 0 14px color-mix(in oklab, var(--value) 20%, transparent)' : 'none',
      animationName: visible ? 'lb-row-in' : 'none',
      animationDuration: '0.35s',
      animationTimingFunction: 'ease',
      animationFillMode: 'both',
      animationDelay: `${idx * 0.04}s`,
      position: 'relative',
      overflow: 'hidden',
      cursor: 'pointer',
    }}>
      {/* Left ping for self */}
      {isSelf && (
        <div style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', width: 3, height: '60%', background: 'var(--value)', borderRadius: '0 3px 3px 0' }} />
      )}

      {/* Rank number */}
      <div style={{ width: 28, textAlign: 'center', flexShrink: 0 }}>
        {isTop3
          ? <span style={{ color: rank === 1 ? 'var(--value-ink)' : 'var(--text-secondary)', display: 'inline-flex' }}>
              <Medal size={18} strokeWidth={2.3} aria-label={`${rank} место`} />
            </span>
          : <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>#{rank}</span>
        }
      </div>

      <AvatarCircle fio={player.fio} rank={rank} size={40} />

      {/* Name + rank + xp bar */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: isSelf ? 'var(--value)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>
            {(player.fio || '').split(' ').slice(0, 2).join(' ')}
          </span>
          {player.title_icon && player.title_id !== 'recruit' && (
            <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 8, fontWeight: 700,
              backgroundColor: (player.title_color || 'var(--text-tertiary)') + '20',
              color: player.title_color || 'var(--text-tertiary)' }}>
              {player.title_icon} {player.title_name}
            </span>
          )}
          <RankBadge title={rt.title} icon={rt.icon} small />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Ур.{player.level}</span>
          <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>📅 {player.total_shifts} смен</span>
          {player.streak > 0 && <span style={{ fontSize: 10, color: 'var(--value)' }}>🔥 {player.streak}</span>}
        </div>
        <XpBar xp={player.xp} />
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--value)' }}>
          {parseInt(player.warrior_power || 0).toLocaleString('ru-RU')} <span style={{ fontSize: 10, opacity: 0.7 }}>⚔️</span>
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--value)' }}>
          {parseInt(player.earned_runes || 0).toLocaleString('ru-RU')} <span style={{ fontSize: 9, opacity: 0.7 }}>ᚱ</span>
        </span>
        <span style={{ fontSize: 8, color: 'var(--text-secondary)', marginTop: -2 }}>заработано</span>
      </div>
    </div>
  );
}

/* ═══ Tournament match card ═══ */
function MatchCard({ match, myId, small }) {
  if (!match) return null;
  const { p1, p2, winner_id } = match;

  function PlayerLine({ p, isWinner }) {
    if (!p) return (
      <div style={{ padding: '5px 8px', color: 'var(--text-tertiary)', fontSize: 11, fontStyle: 'italic' }}>TBD</div>
    );
    const isMe = p.employee_id === myId;
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '5px 8px', gap: 6,
        backgroundColor: isWinner ? 'color-mix(in oklab, var(--value) 12%, transparent)' : 'transparent',
        borderLeft: isWinner ? '2px solid var(--value)' : '2px solid transparent',
        borderRadius: isWinner ? '0 6px 6px 0' : 0,
      }}>
        <span style={{ fontSize: small ? 10 : 11, fontWeight: isMe ? 800 : 600, color: isWinner ? 'var(--value)' : 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 70 }}>
          {isMe ? '⚡' : ''}{p.name}
        </span>
        <span style={{ fontSize: small ? 9 : 10, color: isWinner ? 'var(--value)' : 'var(--text-secondary)', fontWeight: 700, flexShrink: 0 }}>
          {(parseInt(p.warrior_power)||0).toLocaleString('ru-RU')}⚔️
        </span>
      </div>
    );
  }

  return (
    <div style={{
      border: '1px solid color-mix(in oklab, var(--text-primary) 8%, transparent)', borderRadius: 8, overflow: 'hidden',
      backgroundColor: 'color-mix(in oklab, var(--text-primary) 3%, transparent)',
      minWidth: small ? 100 : 120,
    }}>
      <PlayerLine p={p1} isWinner={winner_id === p1?.employee_id} />
      <div style={{ height: 1, backgroundColor: 'color-mix(in oklab, var(--text-primary) 6%, transparent)' }} />
      <PlayerLine p={p2} isWinner={winner_id === p2?.employee_id} />
    </div>
  );
}

/* ═══ Full tournament bracket (4 rounds, horizontal scroll) ═══ */
function TournamentBracket({ tournament, myId }) {
  if (!tournament) return null;
  const { rounds, champion, week_start, week_end, status } = tournament;
  const ROUND_LABELS = ['1/8 финала', 'Четверть', 'Полуфинал', 'Финал'];

  // Format week dates
  function fmtDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    return `${dt.getUTCDate()} ${['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'][dt.getUTCMonth()]}`;
  }
  const weekLabel = week_start ? `${fmtDate(week_start)} – ${fmtDate(week_end)}` : '';

  return (
    <div>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--value)', animation: 'lb-champion-glow 3s ease-in-out infinite' }}>
          ⚔️ Битва за Вальхаллу
        </div>
        {weekLabel && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
            {weekLabel} · {status === 'completed' ? '✅ Завершён' : '🔥 Идёт'}
          </div>
        )}
        {champion && (
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--value)', fontWeight: 700 }}>
            👑 {status === 'completed' ? 'Чемпион' : 'Лидирует'}: {champion.name} ({(parseInt(champion.warrior_power)||0).toLocaleString('ru-RU')} ⚔️)
          </div>
        )}
      </div>

      {/* Bracket — horizontal scroll */}
      <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
        <div style={{ display: 'flex', gap: 0, minWidth: 'max-content' }}>
          {rounds.map((round, ri) => (
            <div key={ri} style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ textAlign: 'center', fontSize: 9, fontWeight: 700, color: 'var(--text-secondary)', padding: '0 8px', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {ROUND_LABELS[ri]}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-around', flex: 1, gap: 4, padding: '0 4px' }}>
                {round.map((match, mi) => (
                  <div key={mi} style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                    <MatchCard match={match} myId={myId} small={ri > 0} />
                    {ri < rounds.length - 1 && (
                      <div style={{ color: '#374151', fontSize: 12, padding: '0 2px' }}>→</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <p style={{ fontSize: 10, color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 8 }}>
        Победитель каждого матча — по Силе Воина за текущую неделю
      </p>
    </div>
  );
}

/* ═══ My position banner ═══ */
function MyBanner({ me, total }) {
  if (!me) return null;
  const rank = parseInt(me.rank);
  const nextGap = null; // could compute from leaderboard
  return (
    <div style={{
      padding: '10px 14px', borderRadius: 14, marginBottom: 8,
      background: 'linear-gradient(135deg, color-mix(in oklab, var(--value) 14%, transparent), color-mix(in oklab, var(--value) 6%, transparent))',
      border: '1.5px solid #D4A84388',
      boxShadow: '0 0 16px color-mix(in oklab, var(--value) 15%, transparent)',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ fontSize: 22, lineHeight: 1 }}>⚡</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, color: 'var(--value)', fontWeight: 700 }}>Ваша позиция</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>
          #{rank} из {total} · {me.rank_title?.icon} {me.rank_title?.title} · {me.total_shifts} смен
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--value)' }}>{parseInt(me.warrior_power || 0).toLocaleString('ru-RU')} ⚔️</div>
        <div style={{ fontSize: 11, color: 'var(--value)' }}>{parseInt(me.earned_runes || 0).toLocaleString('ru-RU')} ᚱ заработано</div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{parseInt(me.runes || 0).toLocaleString('ru-RU')} ᚱ в кошельке</div>
      </div>
    </div>
  );
}

/* ═══ Skeleton ═══ */
function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[130, 100, 82, 82, 82, 82, 82].map((h, i) => (
        <div key={i} style={{
          height: h, borderRadius: 14, backgroundColor: 'color-mix(in oklab, var(--text-primary) 4%, transparent)',
          animationName: 'pulse',
          animationDuration: '1.5s',
          animationTimingFunction: 'ease-in-out',
          animationIterationCount: 'infinite',
          animationDelay: `${i * 0.1}s`,
        }} />
      ))}
    </div>
  );
}

/* ═══ Pipeline leaderboard row ═══ */
function PipelineRow({ player, isSelf, idx, visible }) {
  const rank = parseInt(player.rank);
  const RANK_STEP = { 1: 0, 2: 1, 3: 2 };
  const isTop3 = rank <= 3;
  const firstName = (player.fio || '').split(' ')[0] || '?';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
      borderRadius: 14,
      backgroundColor: isSelf ? 'color-mix(in oklab, var(--acc) 10%, transparent)' : isTop3 ? 'color-mix(in oklab, var(--text-primary) 4%, transparent)' : 'color-mix(in oklab, var(--text-primary) 3%, transparent)',
      border: isSelf ? '1.5px solid color-mix(in oklab, var(--acc) 50%, transparent)' : '1px solid color-mix(in oklab, var(--text-primary) 5%, transparent)',
      animationName: visible ? 'lb-row-in' : 'none',
      animationDuration: '0.35s',
      animationTimingFunction: 'ease',
      animationFillMode: 'both',
      animationDelay: `${idx * 0.04}s`,
    }}>
      <div style={{ width: 28, textAlign: 'center', flexShrink: 0 }}>
          {isTop3
            ? <span style={{ color: rank === 1 ? 'var(--value-ink)' : 'var(--text-secondary)', display: 'inline-flex' }}>
                <Medal size={18} strokeWidth={2.3} aria-label={`${rank} место`} />
              </span>
            : <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>#{rank}</span>}
      </div>
      <AvatarCircle fio={player.fio} rank={rank} size={40} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: isSelf ? 'var(--acc)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {firstName}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>уровней: {player.max_level}</span>
          {player.current_streak > 0 && <span style={{ fontSize: 10, color: 'var(--value)' }}>🔥 {player.current_streak}</span>}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--value)' }}>⭐ {player.weekly_stars}</div>
        <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>за неделю</div>
        <div style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>всего {player.total_stars}</div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════ */
export default function FieldLeaderboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const initialTab = tabParam === 'pipeline' || tabParam === 'chemlab' || tabParam === 'tournament' ? tabParam : 'rating';
  const [leaderboard, setLeaderboard] = useState([]);
  const [myRank, setMyRank] = useState(null);
  const [tournament, setTournament] = useState(null);
  const [pipelineBoard, setPipelineBoard] = useState([]);
  const [pipelineMyRank, setPipelineMyRank] = useState(null);
  const [chemlabBoard, setChemlabBoard] = useState([]);
  const [chemlabMyRank, setChemlabMyRank] = useState(null);
  const [tab, setTab] = useState(initialTab);       // 'rating' | 'tournament' | 'pipeline' | 'chemlab'
  const [sortBy, setSortBy] = useState('power');  // 'power' | 'runes' | 'xp' | 'shifts'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [countersActive, setCountersActive] = useState(false);
  const [rowsVisible, setRowsVisible] = useState(false);

  useEffect(() => {
    Promise.all([
      fieldApi.get('/gamification/leaderboard'),
      fieldApi.get('/pipeline/leaderboard').catch(() => ({ leaderboard: [], my_rank: null })),
      fieldApi.get('/chemlab/leaderboard').catch(() => ({ leaderboard: [], my_rank: null })),
    ])
      .then(([data, pipe, chem]) => {
        setLeaderboard(data?.leaderboard || []);
        setMyRank(data?.my_rank || null);
        setTournament(data?.tournament || null);
        setPipelineBoard(pipe?.leaderboard || []);
        setPipelineMyRank(pipe?.my_rank || null);
        setChemlabBoard(chem?.leaderboard || []);
        setChemlabMyRank(chem?.my_rank || null);
        setTimeout(() => setCountersActive(true), 200);
        setTimeout(() => setRowsVisible(true), 400);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const myId = myRank?.employee_id;
  const openHall = (employeeId) => {
    if (!employeeId) return;
    navigate(`/field/hall/${employeeId}`);
  };

  const sorted = [...leaderboard].sort((a, b) => {
    if (sortBy === 'runes')  return parseInt(b.earned_runes) - parseInt(a.earned_runes);
    if (sortBy === 'xp')     return parseInt(b.earned_xp) - parseInt(a.earned_xp);
    if (sortBy === 'shifts') return parseInt(b.total_shifts) - parseInt(a.total_shifts);
    return parseInt(b.warrior_power) - parseInt(a.warrior_power); // 'power' (default)
  }).map((p, i) => ({ ...p, display_rank: i + 1 }));

  const top3 = sorted.slice(0, 3);
  const myInList = sorted.find(p => p.employee_id === myId);

  /* ─── Total counters for header ─── */
  const totalRunesSum = leaderboard.reduce((s, p) => s + (parseInt(p.earned_runes) || 0), 0);
  const totalWorkers = leaderboard.length;
  const totalRunes = useCountUp(totalRunesSum, 1400, countersActive);

  return (
    <div className="fs-root" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
      <div className="fs-scene" aria-hidden><span className="fs-orb fs-orb--a" /><span className="fs-orb fs-orb--b" /></div>
      <style>{CSS}</style>

      {/* ── STICKY HEADER ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 20, padding: '14px 16px 10px',
        paddingTop: 'max(env(safe-area-inset-top), 14px)',
        background: 'color-mix(in oklab, var(--bg-primary) 88%, transparent)',
        WebkitBackdropFilter: 'blur(14px) saturate(1.5)', backdropFilter: 'blur(14px) saturate(1.5)',
        borderBottom: '1px solid var(--border-norse)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <button onClick={() => navigate('/field/achievements')} className="fs-head__btn" aria-label="Назад">
            <ArrowLeft size={20} strokeWidth={2.3} />
          </button>
          <Trophy size={22} color="var(--value)" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>Зал Одина</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              {totalWorkers} воинов · {totalRunes.toLocaleString('ru-RU')} ᚱ выдано суммарно
            </div>
          </div>
          <Zap size={20} color="var(--value)" strokeWidth={2.2} />
        </div>

        {/* Tab selector */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { key: 'rating', label: 'Рейтинг', icon: Swords, color: 'var(--value)' },
            { key: 'pipeline', label: 'Трубы', icon: Waves, color: 'var(--acc)' },
            { key: 'chemlab', label: 'Химцех', icon: FlaskConical, color: 'var(--value)' },
            { key: 'tournament', label: 'Турнир', icon: Trophy, color: 'var(--value)' },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              flex: '1 1 40%', padding: '9px 0', borderRadius: 12, fontSize: 11.5, fontWeight: 700,
              border: 'none', cursor: 'pointer', transition: 'all .2s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              backgroundColor: tab === t.key ? t.color : 'var(--tile-bg)',
              color: tab === t.key ? 'var(--bg-primary)' : 'var(--text-secondary)',
              boxShadow: tab === t.key ? 'var(--tile-shadow)' : 'none',
            }}>
              <t.icon size={14} strokeWidth={2.4} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>

        {error && (
          <div style={{ padding: 12, borderRadius: 12, background: 'color-mix(in oklab, var(--danger) 10%, transparent)', color: 'var(--danger)', fontSize: 13 }}>{error}</div>
        )}

        {loading ? <Skeleton /> : (

          tab === 'pipeline' ? (
            /* ══════════ PIPELINE TAB ══════════ */
            <>
              {pipelineMyRank && (
                <div style={{
                  padding: '10px 14px', borderRadius: 14, marginBottom: 8,
                  background: 'linear-gradient(135deg, color-mix(in oklab, var(--acc) 14%, transparent), color-mix(in oklab, var(--acc) 6%, transparent))',
                  border: '1.5px solid color-mix(in oklab, var(--acc) 40%, transparent)',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}>
                  <div style={{ fontSize: 22 }}>🌊</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: 'var(--acc)', fontWeight: 700 }}>Ваша позиция в Рунопроводе</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>
                      #{pipelineMyRank} · сортировка по ⭐ за неделю
                    </div>
                  </div>
                  <button onClick={() => navigate('/field/pipeline')} style={{
                    padding: '8px 12px', borderRadius: 10, border: 'none', cursor: 'pointer',
                    background: 'var(--acc)', color: 'var(--bg-primary)', fontSize: 11, fontWeight: 800,
                  }}>
                    Играть
                  </button>
                </div>
              )}
              {pipelineBoard.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 48 }}>
                  <span style={{ fontSize: 40 }}>🌊</span>
                  <p style={{ color: 'var(--text-secondary)', marginTop: 10 }}>Пока никто не прошёл уровни</p>
                  <button onClick={() => navigate('/field/pipeline')} style={{
                    marginTop: 12, padding: '10px 20px', borderRadius: 12, border: 'none',
                    background: 'var(--acc)', color: 'var(--bg-primary)', fontWeight: 800, cursor: 'pointer',
                  }}>
                    Быть первым!
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <p style={{ fontSize: 10, color: 'var(--text-secondary)', textAlign: 'center', marginBottom: 4 }}>
                    Недельный рейтинг · ⭐ звёзды за прохождения
                  </p>
                  {pipelineBoard.map((player, idx) => (
                    <PipelineRow key={player.employee_id} player={player} isSelf={false} idx={idx} visible={rowsVisible} />
                  ))}
                </div>
              )}
            </>
          ) : tab === 'chemlab' ? (
            /* ══════════ CHEMLAB TAB ══════════ */
            <>
              {chemlabMyRank && (
                <div style={{
                  padding: '10px 14px', borderRadius: 14, marginBottom: 8,
                  background: 'linear-gradient(135deg, color-mix(in oklab, var(--danger) 16%, transparent), color-mix(in oklab, var(--danger) 6%, transparent))',
                  border: '1.5px solid color-mix(in oklab, var(--danger) 45%, transparent)',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}>
                  <div style={{ fontSize: 22 }}>🧪</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: 'var(--value)', fontWeight: 700 }}>Ваша позиция в Химцехе</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>
                      #{chemlabMyRank} · сортировка по ⭐ за неделю
                    </div>
                  </div>
                  <button onClick={() => navigate('/field/chemlab')} style={{
                    padding: '8px 12px', borderRadius: 10, border: 'none', cursor: 'pointer',
                    background: 'var(--value)', color: 'var(--bg-primary)', fontSize: 11, fontWeight: 800,
                  }}>
                    Играть
                  </button>
                </div>
              )}
              {chemlabBoard.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 48 }}>
                  <span style={{ fontSize: 40 }}>🧪</span>
                  <p style={{ color: 'var(--text-secondary)', marginTop: 10 }}>Пока никто не закрыл наряды</p>
                  <button onClick={() => navigate('/field/chemlab')} style={{
                    marginTop: 12, padding: '10px 20px', borderRadius: 12, border: 'none',
                    background: 'var(--value)', color: 'var(--bg-primary)', fontWeight: 800, cursor: 'pointer',
                  }}>
                    Быть первым!
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <p style={{ fontSize: 10, color: 'var(--text-secondary)', textAlign: 'center', marginBottom: 4 }}>
                    Недельный рейтинг Химцеха · ⭐ за наряды
                  </p>
                  {chemlabBoard.map((player, idx) => (
                    <PipelineRow key={player.employee_id} player={player} isSelf={false} idx={idx} visible={rowsVisible} />
                  ))}
                </div>
              )}
            </>
          ) : tab === 'tournament' ? (
            /* ══════════ TOURNAMENT TAB ══════════ */
            <div style={{
              background: 'color-mix(in oklab, var(--text-primary) 3%, transparent)', borderRadius: 16, padding: 14,
              border: '1px solid color-mix(in oklab, var(--text-primary) 8%, transparent)',
            }}>
              {tournament
                ? <TournamentBracket tournament={tournament} myId={myId} />
                : <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 40 }}>Недостаточно данных для турнира</div>
              }
            </div>
          ) : (
            /* ══════════ RATING TAB ══════════ */
            <>
              {/* ── My position banner ── */}
              <MyBanner me={myRank} total={totalWorkers} />

              {/* ── Podium top-3 ── */}
              {sorted.length >= 3 && (
                <div style={{
                  background: 'linear-gradient(180deg, color-mix(in oklab, var(--value) 6%, transparent) 0%, color-mix(in oklab, var(--text-primary) 3%, transparent) 100%)',
                  borderRadius: 18, padding: '20px 12px 0', border: '1px solid color-mix(in oklab, var(--value) 15%, transparent)',
                  position: 'relative', overflow: 'hidden',
                }}>
                  {/* Rune watermark */}
                  <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', fontSize: 9, letterSpacing: 4, color: 'color-mix(in oklab, var(--value) 15%, transparent)', fontWeight: 700 }}>
                    ᚠ ᚢ ᚦ ᚨ ᚱ ᚲ ᚷ ᚹ
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'color-mix(in oklab, var(--value) 50%, transparent)', textAlign: 'center', marginBottom: 12, letterSpacing: 2 }}>
                    — ВАЛГАЛЛА —
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, justifyContent: 'center' }}>
                    <PodiumCard player={sorted[1]} rank={2} isSelf={sorted[1]?.employee_id === myId} countersActive={countersActive} onOpen={openHall} />
                    <PodiumCard player={sorted[0]} rank={1} isSelf={sorted[0]?.employee_id === myId} countersActive={countersActive} onOpen={openHall} />
                    <PodiumCard player={sorted[2]} rank={3} isSelf={sorted[2]?.employee_id === myId} countersActive={countersActive} onOpen={openHall} />
                  </div>
                </div>
              )}

              {/* ── Sort pills ── */}
              <div style={{ display: 'flex', gap: 6 }}>
                {[
                  { key: 'power',  label: 'Сила',  color: 'var(--value)' },
                  { key: 'runes',  label: 'ᚱ Заработано',   color: 'var(--value)' },
                  { key: 'shifts', label: '📅 Смены', color: 'var(--acc)' },
                ].map(s => (
                  <button key={s.key} onClick={() => setSortBy(s.key)} style={{
                    flex: 1, padding: '6px 0', borderRadius: 10, fontSize: 11, fontWeight: 700,
                    border: `1px solid ${sortBy === s.key ? `color-mix(in oklab, ${s.color} 53%, transparent)` : 'color-mix(in oklab, var(--text-primary) 8%, transparent)'}`,
                    backgroundColor: sortBy === s.key ? `color-mix(in oklab, ${s.color} 13%, transparent)` : 'color-mix(in oklab, var(--text-primary) 3%, transparent)',
                    color: sortBy === s.key ? s.color : 'var(--text-secondary)',
                    cursor: 'pointer', transition: 'all .2s',
                  }}>
                    {s.label}
                  </button>
                ))}
              </div>

              {/* ── Full list ── */}
              {sorted.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 48 }}>
                  <Users size={40} color="#374151" style={{ margin: '0 auto 10px' }} />
                  <p style={{ color: 'var(--text-secondary)' }}>Пока нет данных</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {sorted.map((player, idx) => {
                    const isSelf = player.employee_id === myId;
                    return (
                      <div key={player.employee_id} style={isSelf ? { scrollMarginTop: 100 } : {}}>
                        <PlayerRow player={player} isSelf={isSelf} idx={idx} visible={rowsVisible} onOpen={openHall} />
                      </div>
                    );
                  })}

                  {/* If current player not in top-50 */}
                  {!myInList && myRank && (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                        <div style={{ flex: 1, height: 1, backgroundColor: 'color-mix(in oklab, var(--text-primary) 6%, transparent)' }} />
                        <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>ваша позиция</span>
                        <div style={{ flex: 1, height: 1, backgroundColor: 'color-mix(in oklab, var(--text-primary) 6%, transparent)' }} />
                      </div>
                      <PlayerRow player={myRank} isSelf idx={999} visible={rowsVisible} onOpen={openHall} />
                    </>
                  )}
                </div>
              )}
            </>
          )
        )}
      </div>
    </div>
  );
}
