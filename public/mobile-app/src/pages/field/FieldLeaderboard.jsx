import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { ArrowLeft, Trophy, Flame, Zap, Sword, Shield, Users, Star } from 'lucide-react';

/* ═══ CSS keyframes injected once ═══ */
const CSS = `
@keyframes lb-fire { 0%,100%{transform:translateY(0) scale(1);opacity:.9} 50%{transform:translateY(-8px) scale(1.2);opacity:.5} }
@keyframes lb-gold-pulse { 0%,100%{box-shadow:0 0 12px rgba(212,168,67,.4),0 0 24px rgba(212,168,67,.15)} 50%{box-shadow:0 0 22px rgba(212,168,67,.75),0 0 44px rgba(212,168,67,.3)} }
@keyframes lb-silver-shimmer { 0%{background-position:-200% center} 100%{background-position:200% center} }
@keytml lb-slide-up { from{transform:translateY(20px);opacity:0} to{transform:translateY(0);opacity:1} }
@keyframes lb-slide-up { from{transform:translateY(20px);opacity:0} to{transform:translateY(0);opacity:1} }
@keyframes lb-crown-bob { 0%,100%{transform:translateY(0) rotate(-5deg)} 50%{transform:translateY(-4px) rotate(5deg)} }
@keyframes lb-count-pop { 0%{transform:scale(1)} 50%{transform:scale(1.18)} 100%{transform:scale(1)} }
@keyframes lb-row-in { from{transform:translateX(-16px);opacity:0} to{transform:translateX(0);opacity:1} }
@keyframes lb-bracket-draw { from{stroke-dashoffset:200} to{stroke-dashoffset:0} }
@keyframes lb-champion-glow { 0%,100%{text-shadow:0 0 8px #FFD700,0 0 16px #FFD700} 50%{text-shadow:0 0 20px #FFD700,0 0 40px #fbbf24} }
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
          background: ['#FFD700','#FF8C00','#FF4500','#FFD700','#FF6B00','#FFD700','#FF4500'][i],
          animation: `lb-fire ${0.7 + i * 0.15}s ease-in-out infinite`,
          animationDelay: `${i * 0.12}s`,
          opacity: 0.85,
        }} />
      ))}
    </div>
  );
}

/* ═══ Rank badge ═══ */
const RANK_COLORS = {
  'Трэль':     '#9ca3af',
  'Карл':      '#a78bfa',
  'Хускарл':   '#60a5fa',
  'Дружинник': '#34d399',
  'Витязь':    '#f97316',
  'Ярл':       '#D4A843',
  'Конунг':    '#ef4444',
};

function RankBadge({ title, icon, small }) {
  const c = RANK_COLORS[title] || '#9ca3af';
  return (
    <span style={{
      fontSize: small ? 9 : 10,
      color: c,
      backgroundColor: `${c}22`,
      border: `1px solid ${c}55`,
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
  const COLORS = { 1: '#FFD700', 2: '#C0C0C0', 3: '#CD7F32' };
  const c = COLORS[rank] || null;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.32, fontWeight: 800,
      background: c ? `linear-gradient(135deg, ${c}, ${c}aa)` : 'linear-gradient(135deg, #1e1e3a, #2a2a4a)',
      color: c ? '#000' : '#9ca3af',
      border: c ? `2px solid ${c}` : '1px solid #2a2a4a',
      boxShadow: isTop ? `0 0 12px ${c}66` : 'none',
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
    <div style={{ width: '100%', height: 3, borderRadius: 4, background: 'rgba(255,255,255,0.07)', marginTop: 3 }}>
      <div style={{ width: `${pct}%`, height: '100%', borderRadius: 4, background: 'linear-gradient(90deg,#7c3aed,#a855f7)', transition: 'width 1s ease' }} />
    </div>
  );
}

/* ═══ Podium card ═══ */
function PodiumCard({ player, rank, isSelf, countersActive }) {
  const COLORS = { 1: '#FFD700', 2: '#C0C0C0', 3: '#CD7F32' };
  const c = COLORS[rank];
  const height = rank === 1 ? 130 : rank === 2 ? 108 : 95;
  const runes = useCountUp(player?.earned_runes, 1200, countersActive);

  if (!player) return <div style={{ flex: 1 }} />;
  const firstName = (player.fio || '').split(' ')[0] || '?';

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 6, minHeight: height, justifyContent: 'flex-end',
      position: 'relative', paddingBottom: 6,
      animation: `lb-slide-up ${0.3 + rank * 0.1}s ease both`,
    }}>
      {rank === 1 && (
        <>
          <div style={{ fontSize: 22, position: 'absolute', top: -8, animation: 'lb-crown-bob 2s ease-in-out infinite' }}>👑</div>
          <FireParticles />
        </>
      )}
      {rank === 2 && <div style={{ fontSize: 18, position: 'absolute', top: 0 }}>🥈</div>}
      {rank === 3 && <div style={{ fontSize: 18, position: 'absolute', top: 0 }}>🥉</div>}

      <AvatarCircle fio={player.fio} rank={rank} size={rank === 1 ? 52 : 42} />

      <div style={{
        width: '100%', borderRadius: 12, padding: '8px 6px',
        background: isSelf ? 'rgba(212,168,67,0.18)' : `${c}18`,
        border: `1.5px solid ${c}55`,
        boxShadow: rank === 1 ? undefined : undefined,
        animation: rank === 1 ? 'lb-gold-pulse 2.5s ease-in-out infinite' : 'none',
        textAlign: 'center',
      }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: isSelf ? '#D4A843' : '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {firstName}
        </p>
        <p style={{ fontSize: 13, fontWeight: 800, color: c, marginTop: 2 }}>
          {runes.toLocaleString('ru-RU')} <span style={{ fontSize: 10, opacity: 0.8 }}>ᚱ</span>
        </p>
        {player.rank_title && <RankBadge title={player.rank_title.title} icon={player.rank_title.icon} small />}
      </div>

      {/* Pedestal step */}
      <div style={{
        width: '90%', height: rank === 1 ? 18 : rank === 2 ? 12 : 8,
        borderRadius: '6px 6px 0 0',
        background: `linear-gradient(180deg, ${c}88, ${c}44)`,
        border: `1px solid ${c}66`,
      }} />
    </div>
  );
}

/* ═══ Player row in list ═══ */
function PlayerRow({ player, isSelf, idx, visible }) {
  const rank = parseInt(player.rank);
  const isTop3 = rank <= 3;
  const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const rt = player.rank_title || {};

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
      borderRadius: 14,
      backgroundColor: isSelf ? 'rgba(212,168,67,0.1)' : isTop3 ? `rgba(255,255,255,0.04)` : 'rgba(255,255,255,0.025)',
      border: isSelf ? '1.5px solid #D4A84388' : isTop3 ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(255,255,255,0.05)',
      boxShadow: isSelf ? '0 0 14px rgba(212,168,67,0.2)' : 'none',
      animation: visible ? `lb-row-in 0.35s ease both` : 'none',
      animationDelay: `${idx * 0.04}s`,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Left ping for self */}
      {isSelf && (
        <div style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', width: 3, height: '60%', background: '#D4A843', borderRadius: '0 3px 3px 0' }} />
      )}

      {/* Rank number */}
      <div style={{ width: 28, textAlign: 'center', flexShrink: 0 }}>
        {isTop3
          ? <span style={{ fontSize: 18 }}>{MEDAL[rank]}</span>
          : <span style={{ fontSize: 12, fontWeight: 700, color: '#6b7280' }}>#{rank}</span>
        }
      </div>

      <AvatarCircle fio={player.fio} rank={rank} size={40} />

      {/* Name + rank + xp bar */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: isSelf ? '#D4A843' : '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>
            {(player.fio || '').split(' ').slice(0, 2).join(' ')}
          </span>
          <RankBadge title={rt.title} icon={rt.icon} small />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: '#6b7280' }}>Ур.{player.level}</span>
          <span style={{ fontSize: 10, color: '#6b7280' }}>📅 {player.total_shifts} смен</span>
          {player.streak > 0 && <span style={{ fontSize: 10, color: '#f97316' }}>🔥 {player.streak}</span>}
        </div>
        <XpBar xp={player.xp} />
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: '#D4A843' }}>
          {parseInt(player.earned_runes || 0).toLocaleString('ru-RU')} <span style={{ fontSize: 10, opacity: 0.7 }}>ᚱ</span>
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#a855f7' }}>
          {parseInt(player.earned_xp || 0).toLocaleString('ru-RU')} <span style={{ fontSize: 9, opacity: 0.7 }}>XP</span>
        </span>
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
      <div style={{ padding: '5px 8px', color: '#4b5563', fontSize: 11, fontStyle: 'italic' }}>TBD</div>
    );
    const isMe = p.employee_id === myId;
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '5px 8px', gap: 6,
        backgroundColor: isWinner ? 'rgba(212,168,67,0.12)' : 'transparent',
        borderLeft: isWinner ? '2px solid #D4A843' : '2px solid transparent',
        borderRadius: isWinner ? '0 6px 6px 0' : 0,
      }}>
        <span style={{ fontSize: small ? 10 : 11, fontWeight: isMe ? 800 : 600, color: isWinner ? '#D4A843' : '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 70 }}>
          {isMe ? '⚡' : ''}{p.name}
        </span>
        <span style={{ fontSize: small ? 9 : 10, color: isWinner ? '#D4A843' : '#6b7280', fontWeight: 700, flexShrink: 0 }}>
          {p.monthly_runes}ᚱ
        </span>
      </div>
    );
  }

  return (
    <div style={{
      border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, overflow: 'hidden',
      backgroundColor: 'rgba(255,255,255,0.03)',
      minWidth: small ? 100 : 120,
    }}>
      <PlayerLine p={p1} isWinner={winner_id === p1?.employee_id} />
      <div style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
      <PlayerLine p={p2} isWinner={winner_id === p2?.employee_id} />
    </div>
  );
}

/* ═══ Full tournament bracket (4 rounds, horizontal scroll) ═══ */
function TournamentBracket({ tournament, myId }) {
  if (!tournament) return null;
  const { rounds, month, week, champion } = tournament;
  const ROUND_LABELS = ['1/8 финала', 'Четверть', 'Полуфинал', 'Финал'];

  return (
    <div>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#D4A843', animation: 'lb-champion-glow 3s ease-in-out infinite' }}>
          ⚔️ Битва за Вальхаллу
        </div>
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
          {month} · Неделя {week}/4
        </div>
        {champion && (
          <div style={{ marginTop: 6, fontSize: 12, color: '#D4A843', fontWeight: 700 }}>
            👑 Лидирует: {champion.name} ({champion.monthly_runes}ᚱ за месяц)
          </div>
        )}
      </div>

      {/* Bracket — horizontal scroll */}
      <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
        <div style={{ display: 'flex', gap: 0, minWidth: 'max-content' }}>
          {rounds.map((round, ri) => {
            const matchCount = round.length;
            // vertical spacing: each match takes equal space
            return (
              <div key={ri} style={{ display: 'flex', flexDirection: 'column' }}>
                {/* Round header */}
                <div style={{ textAlign: 'center', fontSize: 9, fontWeight: 700, color: '#6b7280', padding: '0 8px', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {ROUND_LABELS[ri]}
                </div>
                {/* Matches */}
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-around', flex: 1, gap: 4, padding: '0 4px' }}>
                  {round.map((match, mi) => (
                    <div key={mi} style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                      <MatchCard match={match} myId={myId} small={ri > 0} />
                      {ri < rounds.length - 1 && (
                        <div style={{ display: 'flex', alignItems: 'center', color: '#374151', fontSize: 12, padding: '0 2px' }}>→</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p style={{ fontSize: 10, color: '#4b5563', textAlign: 'center', marginTop: 8 }}>
        Лидер каждого матча — по рунам за текущий месяц
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
      background: 'linear-gradient(135deg, rgba(212,168,67,0.14), rgba(212,168,67,0.06))',
      border: '1.5px solid #D4A84388',
      boxShadow: '0 0 16px rgba(212,168,67,0.15)',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ fontSize: 22, lineHeight: 1 }}>⚡</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, color: '#D4A843', fontWeight: 700 }}>Ваша позиция</div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>
          #{rank} из {total} · {me.rank_title?.icon} {me.rank_title?.title} · {me.total_shifts} смен
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#D4A843' }}>{parseInt(me.earned_runes || 0).toLocaleString('ru-RU')} ᚱ</div>
        <div style={{ fontSize: 11, color: '#a855f7' }}>{parseInt(me.earned_xp || 0)} XP</div>
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
          height: h, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)',
          animation: 'pulse 1.5s ease-in-out infinite',
          animationDelay: `${i * 0.1}s`,
        }} />
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════ */
export default function FieldLeaderboard() {
  const navigate = useNavigate();
  const [leaderboard, setLeaderboard] = useState([]);
  const [myRank, setMyRank] = useState(null);
  const [tournament, setTournament] = useState(null);
  const [tab, setTab] = useState('rating');       // 'rating' | 'tournament'
  const [sortBy, setSortBy] = useState('runes');  // 'runes' | 'xp' | 'shifts'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [countersActive, setCountersActive] = useState(false);
  const [rowsVisible, setRowsVisible] = useState(false);

  useEffect(() => {
    fieldApi.get('/gamification/leaderboard')
      .then((data) => {
        setLeaderboard(data?.leaderboard || []);
        setMyRank(data?.my_rank || null);
        setTournament(data?.tournament || null);
        setTimeout(() => setCountersActive(true), 200);
        setTimeout(() => setRowsVisible(true), 400);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const myId = myRank?.employee_id;

  const sorted = [...leaderboard].sort((a, b) => {
    if (sortBy === 'xp')    return parseInt(b.earned_xp) - parseInt(a.earned_xp);
    if (sortBy === 'shifts') return parseInt(b.total_shifts) - parseInt(a.total_shifts);
    return parseInt(b.earned_runes) - parseInt(a.earned_runes);
  }).map((p, i) => ({ ...p, display_rank: i + 1 }));

  const top3 = sorted.slice(0, 3);
  const myInList = sorted.find(p => p.employee_id === myId);

  /* ─── Total counters for header ─── */
  const totalRunesSum = leaderboard.reduce((s, p) => s + (parseInt(p.earned_runes) || 0), 0);
  const totalWorkers = leaderboard.length;
  const totalRunes = useCountUp(totalRunesSum, 1400, countersActive);

  return (
    <div style={{ backgroundColor: '#080d1f', minHeight: '100vh', paddingBottom: 100 }}>
      <style>{CSS}</style>

      {/* ── STICKY HEADER ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 20, padding: '14px 16px 10px',
        background: 'linear-gradient(180deg, #080d1f 70%, rgba(8,13,31,0))',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <button onClick={() => navigate('/field/achievements')} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 10, padding: 8, cursor: 'pointer', display: 'flex' }}>
            <ArrowLeft size={20} color="#9ca3af" />
          </button>
          <Trophy size={22} color="#D4A843" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#e2e8f0' }}>Зал Одина</div>
            <div style={{ fontSize: 10, color: '#6b7280' }}>
              {totalWorkers} воинов · {totalRunes.toLocaleString('ru-RU')} ᚱ выдано суммарно
            </div>
          </div>
          <span style={{ fontSize: 20 }}>⚡</span>
        </div>

        {/* Tab selector */}
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { key: 'rating', label: '⚔️ Рейтинг' },
            { key: 'tournament', label: '🏆 Турнир' },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              flex: 1, padding: '8px 0', borderRadius: 12, fontSize: 12, fontWeight: 700,
              border: 'none', cursor: 'pointer', transition: 'all .2s',
              backgroundColor: tab === t.key ? '#D4A843' : 'rgba(255,255,255,0.06)',
              color: tab === t.key ? '#000' : '#9ca3af',
            }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>

        {error && (
          <div style={{ padding: 12, borderRadius: 12, background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: 13 }}>{error}</div>
        )}

        {loading ? <Skeleton /> : (

          tab === 'tournament' ? (
            /* ══════════ TOURNAMENT TAB ══════════ */
            <div style={{
              background: 'rgba(255,255,255,0.03)', borderRadius: 16, padding: 14,
              border: '1px solid rgba(255,255,255,0.08)',
            }}>
              {tournament
                ? <TournamentBracket tournament={tournament} myId={myId} />
                : <div style={{ textAlign: 'center', color: '#6b7280', padding: 40 }}>Недостаточно данных для турнира</div>
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
                  background: 'linear-gradient(180deg, rgba(212,168,67,0.06) 0%, rgba(255,255,255,0.025) 100%)',
                  borderRadius: 18, padding: '20px 12px 0', border: '1px solid rgba(212,168,67,0.15)',
                  position: 'relative', overflow: 'hidden',
                }}>
                  {/* Rune watermark */}
                  <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', fontSize: 9, letterSpacing: 4, color: 'rgba(212,168,67,0.15)', fontWeight: 700 }}>
                    ᚠ ᚢ ᚦ ᚨ ᚱ ᚲ ᚷ ᚹ
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(212,168,67,0.5)', textAlign: 'center', marginBottom: 12, letterSpacing: 2 }}>
                    — ВАЛГАЛЛА —
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, justifyContent: 'center' }}>
                    <PodiumCard player={sorted[1]} rank={2} isSelf={sorted[1]?.employee_id === myId} countersActive={countersActive} />
                    <PodiumCard player={sorted[0]} rank={1} isSelf={sorted[0]?.employee_id === myId} countersActive={countersActive} />
                    <PodiumCard player={sorted[2]} rank={3} isSelf={sorted[2]?.employee_id === myId} countersActive={countersActive} />
                  </div>
                </div>
              )}

              {/* ── Sort pills ── */}
              <div style={{ display: 'flex', gap: 6 }}>
                {[
                  { key: 'runes', label: 'ᚱ Руны', color: '#D4A843' },
                  { key: 'xp',    label: '⚡ XP',   color: '#a855f7' },
                  { key: 'shifts',label: '📅 Смены', color: '#60a5fa' },
                ].map(s => (
                  <button key={s.key} onClick={() => setSortBy(s.key)} style={{
                    flex: 1, padding: '6px 0', borderRadius: 10, fontSize: 11, fontWeight: 700,
                    border: `1px solid ${sortBy === s.key ? s.color + '88' : 'rgba(255,255,255,0.08)'}`,
                    backgroundColor: sortBy === s.key ? `${s.color}22` : 'rgba(255,255,255,0.03)',
                    color: sortBy === s.key ? s.color : '#6b7280',
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
                  <p style={{ color: '#6b7280' }}>Пока нет данных</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {sorted.map((player, idx) => {
                    const isSelf = player.employee_id === myId;
                    return (
                      <div key={player.employee_id} style={isSelf ? { scrollMarginTop: 100 } : {}}>
                        <PlayerRow player={player} isSelf={isSelf} idx={idx} visible={rowsVisible} />
                      </div>
                    );
                  })}

                  {/* If current player not in top-50 */}
                  {!myInList && myRank && (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                        <div style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
                        <span style={{ fontSize: 10, color: '#4b5563' }}>ваша позиция</span>
                        <div style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
                      </div>
                      <PlayerRow player={myRank} isSelf idx={999} visible={rowsVisible} />
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
