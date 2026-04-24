import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { ArrowLeft, Trophy, Flame, Star, Zap, Shield, Users } from 'lucide-react';

// Norse rank colors
const RANK_BG = { 1: 'rgba(255,215,0,0.18)', 2: 'rgba(192,192,192,0.15)', 3: 'rgba(205,127,50,0.18)' };
const RANK_BORDER = { 1: '#ffd70066', 2: '#c0c0c066', 3: '#cd7f3266' };
const RANK_GLOW = { 1: '0 0 12px rgba(255,215,0,0.35)', 2: '0 0 8px rgba(192,192,192,0.2)', 3: '0 0 8px rgba(205,127,50,0.25)' };

const PODIUM_ICONS = {
  1: <span style={{ fontSize: 18 }}>👑</span>,
  2: <span style={{ fontSize: 18 }}>🥈</span>,
  3: <span style={{ fontSize: 18 }}>🥉</span>,
};

function fmtNum(n) {
  const num = parseInt(n, 10) || 0;
  return num >= 1000 ? (num / 1000).toFixed(1) + 'к' : String(num);
}

function Initials({ fio, rank }) {
  const parts = (fio || '').split(' ').filter(Boolean);
  const initials = parts.map((w) => w[0] || '').join('').slice(0, 2).toUpperCase();
  const isTop3 = rank <= 3;
  return (
    <div
      className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
      style={{
        background: isTop3
          ? 'linear-gradient(135deg, var(--gold, #D4A843), #f59e0b)'
          : 'var(--bg-primary, #1a1a2e)',
        color: isTop3 ? '#000' : 'var(--text-secondary, #9ca3af)',
        border: isTop3 ? '2px solid var(--gold, #D4A843)' : '1px solid var(--border-norse, #2a2a3e)',
        boxShadow: isTop3 ? '0 0 10px rgba(212,168,67,0.4)' : 'none',
      }}
    >
      {initials || '?'}
    </div>
  );
}

function XpBar({ xp }) {
  const xpPerLevel = 100;
  const lvlXp = xp % xpPerLevel;
  const pct = Math.min(100, (lvlXp / xpPerLevel) * 100);
  return (
    <div className="w-full h-1 rounded-full overflow-hidden mt-1" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
      <div
        className="h-full rounded-full"
        style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #7c3aed, #a855f7)' }}
      />
    </div>
  );
}

function PlayerRow({ player, isSelf }) {
  const rank = parseInt(player.rank, 10);
  const isTop3 = rank <= 3;
  const lvl = parseInt(player.level, 10) || 1;

  return (
    <div
      className="rounded-xl p-3 flex items-center gap-3"
      style={{
        backgroundColor: isSelf
          ? 'rgba(212,168,67,0.12)'
          : isTop3
          ? RANK_BG[rank]
          : 'var(--bg-elevated, #1e1e30)',
        border: isSelf
          ? '1.5px solid var(--gold, #D4A843)'
          : isTop3
          ? `1px solid ${RANK_BORDER[rank]}`
          : '1px solid var(--border-norse, #2a2a3e)',
        boxShadow: isSelf ? '0 0 14px rgba(212,168,67,0.25)' : isTop3 ? RANK_GLOW[rank] : 'none',
        transition: 'box-shadow 0.3s',
      }}
    >
      {/* Rank */}
      <div className="w-8 flex items-center justify-center flex-shrink-0">
        {isTop3 ? PODIUM_ICONS[rank] : (
          <span className="text-xs font-bold" style={{ color: 'var(--text-tertiary, #6b7280)' }}>#{rank}</span>
        )}
      </div>

      <Initials fio={player.fio} rank={rank} />

      {/* Name + rank title + xp bar */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold truncate" style={{ color: isSelf ? 'var(--gold, #D4A843)' : 'var(--text-primary, #e2e8f0)' }}>
            {player.fio?.split(' ')[0] || 'Воин'}
          </p>
          <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-tertiary, #6b7280)' }}>
            {player.rank_title?.icon} {player.rank_title?.title}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px]" style={{ color: '#a855f7' }}>Ур. {lvl}</span>
          <span className="text-[10px]" style={{ color: 'var(--text-tertiary, #6b7280)' }}>
            {player.total_shifts} смен
          </span>
        </div>
        <XpBar xp={parseInt(player.xp, 10) || 0} />
      </div>

      {/* Stats */}
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        <div className="flex items-center gap-1">
          <span className="text-sm font-bold" style={{ color: 'var(--gold, #D4A843)' }}>
            {fmtNum(player.runes)}
          </span>
          <span className="text-xs" style={{ color: 'var(--gold, #D4A843)', opacity: 0.7 }}>ᚱ</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium" style={{ color: '#a855f7' }}>
            {fmtNum(player.xp)}
          </span>
          <span className="text-[10px]" style={{ color: '#a855f7', opacity: 0.7 }}>XP</span>
        </div>
      </div>
    </div>
  );
}

export default function FieldLeaderboard() {
  const navigate = useNavigate();
  const [leaders, setLeaders] = useState([]);
  const [myRank, setMyRank] = useState(null);
  const [tab, setTab] = useState('runes'); // 'runes' | 'xp'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const myRef = useRef(null);

  useEffect(() => {
    fieldApi.get('/gamification/leaderboard')
      .then((data) => {
        setLeaders(data?.leaderboard || []);
        setMyRank(data?.my_rank || null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Sort by selected tab
  const sorted = [...leaders].sort((a, b) => {
    if (tab === 'xp') return parseInt(b.xp, 10) - parseInt(a.xp, 10);
    return parseInt(b.runes, 10) - parseInt(a.runes, 10);
  }).map((p, i) => ({ ...p, display_rank: i + 1 }));

  // Current player employee_id from token
  const myId = myRank?.employee_id;
  const myInList = sorted.find((p) => p.employee_id === myId);

  return (
    <div className="pb-24" style={{ backgroundColor: 'var(--bg-primary)', minHeight: '100vh' }}>
      {/* Header */}
      <div className="sticky top-0 z-10 px-4 pt-4 pb-3" style={{ backgroundColor: 'var(--bg-primary)', borderBottom: '1px solid var(--border-norse)' }}>
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => navigate('/field/achievements')} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
            <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
          </button>
          <Trophy size={22} style={{ color: 'var(--gold)' }} />
          <div className="flex-1">
            <h1 className="text-base font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>Зал Чести Асгарда</h1>
            <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Рейтинг воинов</p>
          </div>
          <span className="text-lg">⚡</span>
        </div>

        {/* Tab selector */}
        <div className="flex gap-2">
          <button
            onClick={() => setTab('runes')}
            className="flex-1 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all"
            style={{
              backgroundColor: tab === 'runes' ? 'var(--gold)' : 'var(--bg-elevated)',
              color: tab === 'runes' ? '#000' : 'var(--text-secondary)',
              border: tab === 'runes' ? 'none' : '1px solid var(--border-norse)',
            }}
          >
            <span style={{ fontSize: 14 }}>ᚱ</span> Руны
          </button>
          <button
            onClick={() => setTab('xp')}
            className="flex-1 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all"
            style={{
              backgroundColor: tab === 'xp' ? '#7c3aed' : 'var(--bg-elevated)',
              color: tab === 'xp' ? '#fff' : 'var(--text-secondary)',
              border: tab === 'xp' ? 'none' : '1px solid var(--border-norse)',
            }}
          >
            <Zap size={13} /> XP
          </button>
        </div>
      </div>

      <div className="px-4 pt-3 space-y-2">
        {error && (
          <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{error}</div>
        )}

        {loading ? (
          <div className="space-y-2 animate-pulse">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-16 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="rounded-xl p-10 text-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
            <Users size={40} className="mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
            <p style={{ color: 'var(--text-tertiary)' }}>Пока нет данных</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>Начни зарабатывать руны!</p>
          </div>
        ) : (
          <>
            {/* Top 3 podium if runes tab */}
            {tab === 'runes' && sorted.length >= 3 && (
              <div className="rounded-xl p-4 mb-2" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
                <p className="text-xs font-medium mb-3 text-center" style={{ color: 'var(--text-tertiary)' }}>— Валгалла — Топ 3 —</p>
                <div className="flex items-end justify-center gap-3">
                  {/* 2nd */}
                  <PodiumCard player={sorted[1]} rank={2} isSelf={sorted[1]?.employee_id === myId} />
                  {/* 1st */}
                  <PodiumCard player={sorted[0]} rank={1} isSelf={sorted[0]?.employee_id === myId} tall />
                  {/* 3rd */}
                  <PodiumCard player={sorted[2]} rank={3} isSelf={sorted[2]?.employee_id === myId} />
                </div>
              </div>
            )}

            {/* List */}
            {sorted.map((player) => {
              const isSelf = player.employee_id === myId;
              return (
                <div key={player.employee_id} ref={isSelf ? myRef : null}>
                  <PlayerRow player={player} isSelf={isSelf} />
                </div>
              );
            })}

            {/* My rank if outside top-50 */}
            {!myInList && myRank && (
              <>
                <div className="flex items-center gap-2 py-1">
                  <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border-norse)' }} />
                  <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>ваша позиция</span>
                  <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border-norse)' }} />
                </div>
                <PlayerRow player={{ ...myRank, display_rank: myRank.rank }} isSelf={true} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PodiumCard({ player, rank, isSelf, tall }) {
  if (!player) return <div className="flex-1" />;
  const lvl = parseInt(player.level, 10) || 1;
  const COLORS = { 1: '#ffd700', 2: '#c0c0c0', 3: '#cd7f32' };
  const c = COLORS[rank];
  return (
    <div
      className="flex-1 flex flex-col items-center gap-1 rounded-xl p-2"
      style={{
        backgroundColor: isSelf ? 'rgba(212,168,67,0.15)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${c}44`,
        minHeight: tall ? 110 : 90,
        justifyContent: 'flex-end',
      }}
    >
      <span style={{ fontSize: tall ? 22 : 18 }}>
        {rank === 1 ? '👑' : rank === 2 ? '🥈' : '🥉'}
      </span>
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
        style={{ background: `linear-gradient(135deg, ${c}, ${c}99)`, color: '#000' }}
      >
        {(player.fio || '').split(' ').map((w) => w[0]).join('').slice(0, 2)}
      </div>
      <p className="text-[10px] font-semibold text-center leading-tight w-full truncate px-1" style={{ color: 'var(--text-primary)' }}>
        {player.fio?.split(' ')[0] || ''}
      </p>
      <p className="text-xs font-bold" style={{ color: c }}>{fmtNum(player.runes)} ᚱ</p>
      <p className="text-[9px]" style={{ color: '#a855f7' }}>Ур.{lvl}</p>
    </div>
  );
}
