import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';

// ── Palette ─────────────────────────────────────────────────────
const C = {
  bg: '#0d0d12', card: '#16161f', gold: '#c8a84b',
  green: '#22c55e', red: '#ef4444', amber: '#f59e0b',
  blue: '#3b82f6', rune: '#7b61ff', text: '#e8e8f0', muted: '#6b7280',
  darkPurple: '#1a0d2e',
};

const TRACK_META = {
  pm:          { label: 'Проектный менеджмент', icon: '⚙️', color: '#3b82f6' },
  hr:          { label: 'HR и кадры',           icon: '👥', color: '#22c55e' },
  finance:     { label: 'Финансы',              icon: '💰', color: '#f59e0b' },
  procurement: { label: 'Закупки',              icon: '📦', color: '#ef4444' },
  management:  { label: 'Управление',           icon: '🏛️', color: '#8b5cf6' },
  all:         { label: 'Общие знания',          icon: '📚', color: '#6b7280' },
};

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

// ── Rank Badge ──────────────────────────────────────────────────
function RankBadge({ rank, size = 'normal' }) {
  if (!rank) return null;
  const s = size === 'large';
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: s ? 8 : 5,
      background: rank.color + '18', border: `1px solid ${rank.color}40`,
      borderRadius: s ? 14 : 8, padding: s ? '8px 14px' : '3px 8px',
    }}>
      <span style={{ fontSize: s ? 22 : 14 }}>{rank.icon}</span>
      <span style={{ fontSize: s ? 15 : 11, fontWeight: 800, color: rank.color }}>{rank.name}</span>
    </div>
  );
}

// ── Streak Badge ────────────────────────────────────────────────
function StreakBadge({ streak }) {
  if (!streak || streak < 1) return null;
  const color = streak >= 4 ? C.gold : streak >= 2 ? C.amber : C.muted;
  return (
    <span style={{
      fontSize: 11, fontWeight: 800, color,
      background: color + '18', border: `1px solid ${color}40`,
      borderRadius: 8, padding: '3px 8px',
    }}>🔥 {streak} мес</span>
  );
}

// ── Progress Widget ─────────────────────────────────────────────
function ProgressWidget({ data, stats }) {
  const { total = 0, passed = 0, mandatory_pending = 0, rank } = data || {};
  const pct = total > 0 ? Math.round(passed / total * 100) : 0;
  const totalXp = stats?.total_xp || data?.total_xp || 0;
  const streak = stats?.streak || 0;

  return (
    <div style={{
      background: `linear-gradient(135deg, ${C.darkPurple} 0%, ${C.card} 100%)`,
      border: `1px solid ${C.rune}25`, borderRadius: 20, padding: '18px 16px',
      marginBottom: 16,
    }}>
      {/* Rank + Streak row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <RankBadge rank={rank} size="large" />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <StreakBadge streak={streak} />
          <span style={{
            fontSize: 11, fontWeight: 800, color: C.rune,
            background: C.rune + '18', border: `1px solid ${C.rune}40`,
            borderRadius: 8, padding: '3px 8px',
          }}>⚡ {totalXp} XP</span>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        {[
          { v: passed, l: 'сдано', c: C.green },
          { v: total, l: 'всего', c: C.text },
          { v: mandatory_pending, l: 'обяз.', c: mandatory_pending > 0 ? C.red : C.green },
          { v: `${pct}%`, l: 'прогресс', c: pct >= 80 ? C.green : pct >= 40 ? C.amber : C.text },
        ].map((s, i) => (
          <div key={i} style={{ textAlign: 'center', flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 900, color: s.c }}>{s.v}</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div style={{ height: 6, background: '#ffffff0d', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 3, width: `${pct}%`, transition: 'width .6s ease',
          background: `linear-gradient(90deg, ${C.gold}, ${C.rune})`,
        }} />
      </div>
    </div>
  );
}

// ── Track Filter ────────────────────────────────────────────────
function TrackFilter({ tracks, active, onChange }) {
  return (
    <div style={{
      display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 14,
      WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none',
    }}>
      <button onClick={() => onChange(null)} style={{
        flexShrink: 0, padding: '6px 12px', borderRadius: 20,
        border: !active ? `1px solid ${C.rune}60` : '1px solid #ffffff0d',
        background: !active ? C.rune + '20' : 'transparent',
        color: !active ? C.rune : C.muted, fontSize: 12, fontWeight: 700, cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}>Все</button>
      {tracks.map(t => {
        const meta = TRACK_META[t] || { label: t, icon: '📖', color: C.muted };
        const isActive = active === t;
        return (
          <button key={t} onClick={() => onChange(t)} style={{
            flexShrink: 0, padding: '6px 12px', borderRadius: 20,
            border: isActive ? `1px solid ${meta.color}60` : '1px solid #ffffff0d',
            background: isActive ? meta.color + '20' : 'transparent',
            color: isActive ? meta.color : C.muted, fontSize: 12, fontWeight: 700,
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}>{meta.icon} {meta.label}</button>
        );
      })}
    </div>
  );
}

// ── Search Bar ──────────────────────────────────────────────────
function SearchBar({ value, onChange }) {
  return (
    <div style={{ position: 'relative', marginBottom: 14 }}>
      <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: C.muted }}>🔍</span>
      <input
        type="text" value={value} onChange={e => onChange(e.target.value)}
        placeholder="Поиск свитка..."
        style={{
          width: '100%', padding: '10px 12px 10px 36px', borderRadius: 12,
          background: C.card, border: '1px solid #ffffff0d', color: C.text,
          fontSize: 13, outline: 'none', boxSizing: 'border-box',
        }}
      />
    </div>
  );
}

// ── Lesson Card ─────────────────────────────────────────────────
function LessonCard({ lesson, onClick }) {
  const tc = TRACK_META[lesson.track]?.color || C.muted;
  const isPassed = lesson.passed;
  const isReading = lesson.read_started_at && !lesson.read_completed_at;
  const isNew = !lesson.read_started_at;
  const needsReread = lesson.attempts >= 2 && !isPassed && !lesson.read_completed_at;

  return (
    <div onClick={onClick} style={{
      background: `linear-gradient(135deg, ${lesson.cover_color || '#1e1e3a'} 0%, ${C.card} 100%)`,
      border: `1px solid ${isPassed ? C.green + '40' : needsReread ? C.amber + '40' : '#ffffff12'}`,
      borderRadius: 18, padding: '16px', marginBottom: 12, cursor: 'pointer',
      position: 'relative', overflow: 'hidden',
      transition: 'transform .15s, box-shadow .15s',
    }}>
      {/* Mandatory badge */}
      {isNew && lesson.is_mandatory && (
        <div style={{
          position: 'absolute', top: 12, right: 12,
          background: C.red, borderRadius: 20, padding: '2px 8px',
          fontSize: 9, fontWeight: 800, color: '#fff', textTransform: 'uppercase',
        }}>⚠️ Обязательный</div>
      )}

      {/* Needs re-read badge */}
      {needsReread && (
        <div style={{
          position: 'absolute', top: 12, right: 12,
          background: C.amber, borderRadius: 20, padding: '2px 8px',
          fontSize: 9, fontWeight: 800, color: '#000', textTransform: 'uppercase',
        }}>📖 Перечитай</div>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {/* Icon */}
        <div style={{
          fontSize: 32, width: 52, height: 52, display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: '#ffffff0a', borderRadius: 14, flexShrink: 0,
        }}>
          {lesson.cover_icon}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Track + Pass badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 10, fontWeight: 700, color: tc,
              background: tc + '18', border: `1px solid ${tc}35`,
              borderRadius: 6, padding: '2px 6px', flexShrink: 0,
            }}>{TRACK_META[lesson.track]?.label || lesson.track}</span>
            {isPassed && (
              <span style={{
                fontSize: 10, fontWeight: 800, color: C.green,
                background: C.green + '18', border: `1px solid ${C.green}40`,
                borderRadius: 6, padding: '2px 7px',
              }}>✓ {lesson.score}%</span>
            )}
            {lesson.xp_earned > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 700, color: C.rune,
                background: C.rune + '15', borderRadius: 6, padding: '2px 6px',
              }}>⚡{lesson.xp_earned}</span>
            )}
          </div>

          {/* Title */}
          <div style={{ fontSize: 15, fontWeight: 800, color: C.text, lineHeight: 1.3, marginBottom: 4 }}>
            {lesson.title}
          </div>

          {/* Saga */}
          {lesson.saga && (
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>{lesson.saga}</div>
          )}

          {/* Meta row */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: C.muted }}>⏱ {lesson.estimated_minutes} мин</span>
            {isReading && !needsReread && (
              <span style={{ fontSize: 11, color: C.amber, fontWeight: 700 }}>📖 Читаю...</span>
            )}
            {lesson.read_completed_at && !isPassed && !needsReread && (
              <span style={{ fontSize: 11, color: C.blue }}>✓ Прочитан · Тест не сдан</span>
            )}
            {needsReread && (
              <span style={{ fontSize: 11, color: C.amber, fontWeight: 700 }}>⚔️ Перечитай для новых попыток</span>
            )}
            {isPassed && lesson.attempts > 1 && (
              <span style={{ fontSize: 11, color: C.muted }}>
                {lesson.attempts} {lesson.attempts < 5 ? 'попытки' : 'попыток'}
              </span>
            )}
          </div>
        </div>

        <div style={{ color: C.muted, fontSize: 18, flexShrink: 0, alignSelf: 'center' }}>›</div>
      </div>
    </div>
  );
}

// ── Section Header ──────────────────────────────────────────────
function SectionHeader({ icon, title, color, count }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, marginTop: 18,
    }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span style={{ fontSize: 13, fontWeight: 800, color, letterSpacing: 0.3 }}>{title}</span>
      {count > 0 && (
        <span style={{
          fontSize: 10, fontWeight: 800, color: '#fff',
          background: color, borderRadius: 10, padding: '1px 7px', minWidth: 18, textAlign: 'center',
        }}>{count}</span>
      )}
    </div>
  );
}

// ── Leaderboard Tab ─────────────────────────────────────────────
function LeaderboardTab() {
  const [data, setData] = useState(null);
  const [loading, setLoad] = useState(true);

  useEffect(() => {
    api.get('/office-academy/leaderboard')
      .then(setData)
      .finally(() => setLoad(false));
  }, []);

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>
      <div style={{ fontSize: 28 }}>⏳</div>
    </div>
  );

  const { leaderboard = [] } = data || {};
  const medals = ['🥇', '🥈', '🥉'];

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }}>
          🏆 Зал Славы Асгарда
        </div>
      </div>
      {leaderboard.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: C.muted }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🏆</div>
          <div style={{ fontSize: 14 }}>Зал Славы пуст — стань первым!</div>
        </div>
      ) : leaderboard.map((u, i) => (
        <div key={u.id} style={{
          background: i < 3
            ? `linear-gradient(135deg, ${['#1a1505','#0f1520','#1a0f05'][i]} 0%, ${C.card} 100%)`
            : C.card,
          border: `1px solid ${i === 0 ? C.gold + '40' : i === 1 ? '#94a3b820' : i === 2 ? C.amber + '20' : '#ffffff0d'}`,
          borderRadius: 14, padding: '12px 14px', marginBottom: 8,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ fontSize: i < 3 ? 22 : 14, width: 28, textAlign: 'center', color: i < 3 ? 'inherit' : C.muted, fontWeight: 700 }}>
            {i < 3 ? medals[i] : `${i + 1}`}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{u.fio}</span>
              {u.rank && <span style={{ fontSize: 12 }}>{u.rank.icon}</span>}
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{u.role}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: i === 0 ? C.gold : C.text }}>{u.lessons_passed}</div>
            <div style={{ fontSize: 10, color: C.muted }}>
              уроков · ⌀{u.avg_score ?? '—'}% · ⚡{u.total_xp || 0}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Stats Tab ───────────────────────────────────────────────────
function StatsTab() {
  const [stats, setStats] = useState(null);
  const [loading, setLoad] = useState(true);

  useEffect(() => {
    api.get('/office-academy/stats')
      .then(setStats)
      .finally(() => setLoad(false));
  }, []);

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>
      <div style={{ fontSize: 28 }}>⏳</div>
    </div>
  );

  if (!stats) return null;

  const { ranks = [] } = stats;

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
          📊 Мой путь в Асгарде
        </div>
        <RankBadge rank={stats.rank} size="large" />
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
        {[
          { icon: '📜', v: stats.lessons_passed || 0, l: 'Свитков сдано', c: C.green },
          { icon: '🎯', v: `${stats.avg_score || 0}%`, l: 'Средний балл', c: C.gold },
          { icon: '⚡', v: stats.total_xp || 0, l: 'Опыт (XP)', c: C.rune },
          { icon: '🔥', v: `${stats.streak || 0} мес`, l: 'Стрик', c: stats.streak >= 2 ? C.gold : C.muted },
        ].map((s, i) => (
          <div key={i} style={{
            background: C.card, border: '1px solid #ffffff0d', borderRadius: 14,
            padding: '14px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>{s.icon}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: s.c }}>{s.v}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* Rank progression */}
      <div style={{
        background: C.card, border: '1px solid #ffffff0d', borderRadius: 16, padding: '16px',
      }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 12 }}>
          🏛️ Путь к мастерству
        </div>
        {[...ranks].reverse().map((r, i) => {
          const isActive = stats.rank?.name === r.name;
          const achieved = (stats.lessons_passed || 0) >= r.min;
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
              borderBottom: i < ranks.length - 1 ? '1px solid #ffffff08' : 'none',
              opacity: achieved ? 1 : 0.4,
            }}>
              <span style={{ fontSize: 20, width: 28, textAlign: 'center' }}>{r.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{
                  fontSize: 13, fontWeight: isActive ? 800 : 600,
                  color: isActive ? r.color : achieved ? C.text : C.muted,
                }}>
                  {r.name} {isActive && '← ты здесь'}
                </div>
                <div style={{ fontSize: 11, color: C.muted }}>{r.min}+ свитков</div>
              </div>
              {achieved && <span style={{ fontSize: 14, color: C.green }}>✓</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════
export default function OfficeAcademy() {
  const navigate = useNavigate();
  const [data, setData]         = useState(null);
  const [stats, setStats]       = useState(null);
  const [loading, setLoad]      = useState(true);
  const [tab, setTab]           = useState('lessons');
  const [trackFilter, setTrack] = useState(null);
  const [search, setSearch]     = useState('');

  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    setLoad(true);
    setLoadError('');
    Promise.all([
      api.get('/office-academy/lessons'),
      api.get('/office-academy/stats').catch(() => null),
    ]).then(([d, s]) => {
      setData(d);
      setStats(s);
    }).catch(e => {
      setLoadError(e.message || 'Ошибка загрузки');
    }).finally(() => setLoad(false));
  }, []);

  // Derive available tracks from lessons
  const availableTracks = useMemo(() => {
    if (!data?.lessons) return [];
    const set = new Set(data.lessons.map(l => l.track));
    return ['pm', 'hr', 'finance', 'procurement', 'management', 'all'].filter(t => set.has(t));
  }, [data]);

  // Filter + search lessons
  const filteredLessons = useMemo(() => {
    let list = data?.lessons || [];
    if (trackFilter) list = list.filter(l => l.track === trackFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(l =>
        l.title.toLowerCase().includes(q) ||
        (l.saga || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [data, trackFilter, search]);

  // Split into sections
  const sections = useMemo(() => {
    const mandatory = filteredLessons.filter(l => l.is_mandatory && !l.passed);
    const needsReread = filteredLessons.filter(l => l.attempts >= 2 && !l.passed && !l.read_completed_at);
    const newLessons = filteredLessons.filter(l => !l.read_started_at && !mandatory.includes(l));
    const inProgress = filteredLessons.filter(l => l.read_started_at && !l.passed && !needsReread.includes(l) && !mandatory.includes(l));
    const completed = filteredLessons.filter(l => l.passed);
    const optional = filteredLessons.filter(l => !l.is_mandatory && !l.passed && !newLessons.includes(l) && !inProgress.includes(l) && !needsReread.includes(l));
    return { mandatory, needsReread, newLessons, inProgress, completed, optional };
  }, [filteredLessons]);

  if (loading) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>🏛️</div>
        <div style={{ fontSize: 13, color: C.muted }}>Загружаю Залы Асгарда...</div>
      </div>
    </div>
  );

  if (loadError) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ textAlign: 'center', color: C.red }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
        <div style={{ fontSize: 14, marginBottom: 16 }}>{loadError}</div>
        <button onClick={() => window.location.reload()} style={{
          background: C.card, border: `1px solid ${C.red}40`, color: C.red,
          padding: '8px 20px', borderRadius: 10, cursor: 'pointer', fontSize: 13,
        }}>Попробовать снова</button>
      </div>
    </div>
  );

  const { total = 0, passed = 0, mandatory_pending = 0 } = data || {};

  return (
    <div style={{ minHeight: '100vh', background: C.bg, paddingBottom: 80 }}>
      {/* Header */}
      <div style={{
        padding: '52px 16px 16px',
        background: `linear-gradient(180deg, ${C.darkPurple} 0%, transparent 100%)`,
      }}>
        <button onClick={() => navigate(-1)}
          style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 14, marginBottom: 10, padding: 0 }}>
          ← Назад
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 28 }}>🏛️</span>
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, color: C.text }}>Залы Асгарда</div>
            <div style={{ fontSize: 12, color: C.gold, fontWeight: 600 }}>Путь к мастерству</div>
          </div>
        </div>
      </div>

      <div style={{ padding: '0 16px' }}>
        {/* Progress Widget */}
        <ProgressWidget data={data} stats={stats} />

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {[
            { id: 'lessons',     label: '📚 Свитки' },
            { id: 'leaderboard', label: '🏆 Зал Славы' },
            { id: 'stats',       label: '📊 Мой путь' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, padding: '9px 0', borderRadius: 12,
              border: tab === t.id ? `1px solid ${C.rune}60` : '1px solid #ffffff0d',
              background: tab === t.id ? C.rune + '18' : 'transparent',
              color: tab === t.id ? C.rune : C.muted,
              fontWeight: tab === t.id ? 700 : 400, fontSize: 12, cursor: 'pointer',
            }}>{t.label}</button>
          ))}
        </div>

        {/* Lessons Tab */}
        {tab === 'lessons' && (
          <>
            {/* Track filter */}
            {availableTracks.length > 1 && (
              <TrackFilter tracks={availableTracks} active={trackFilter} onChange={setTrack} />
            )}

            {/* Search */}
            <SearchBar value={search} onChange={setSearch} />

            {/* Mandatory alert */}
            {mandatory_pending > 0 && !trackFilter && !search && (
              <div style={{
                background: C.red + '12', border: `1px solid ${C.red}35`,
                borderRadius: 14, padding: '12px 14px', marginBottom: 14,
                fontSize: 13, color: C.red, display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ fontSize: 18 }}>⚠️</span>
                <span>
                  {mandatory_pending} обязательн{mandatory_pending === 1 ? 'ый свиток не сдан' : mandatory_pending < 5 ? 'ых свитка не сдано' : 'ых свитков не сдано'}
                </span>
              </div>
            )}

            {filteredLessons.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: C.muted }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📚</div>
                <div style={{ fontSize: 14 }}>
                  {search ? 'Ничего не найдено' : 'Свитки для вашей роли пока не опубликованы'}
                </div>
              </div>
            ) : (
              <>
                {/* Needs re-read section */}
                {sections.needsReread.length > 0 && (
                  <>
                    <SectionHeader icon="📖" title="Перечитай свиток" color={C.amber} count={sections.needsReread.length} />
                    {sections.needsReread.map(l => (
                      <LessonCard key={l.id} lesson={l} onClick={() => navigate(`/office-academy/${l.id}`)} />
                    ))}
                  </>
                )}

                {/* Mandatory section */}
                {sections.mandatory.length > 0 && (
                  <>
                    <SectionHeader icon="🔴" title="Обязательные свитки" color={C.red} count={sections.mandatory.length} />
                    {sections.mandatory.map(l => (
                      <LessonCard key={l.id} lesson={l} onClick={() => navigate(`/office-academy/${l.id}`)} />
                    ))}
                  </>
                )}

                {/* In progress */}
                {sections.inProgress.length > 0 && (
                  <>
                    <SectionHeader icon="📖" title="В процессе" color={C.amber} count={sections.inProgress.length} />
                    {sections.inProgress.map(l => (
                      <LessonCard key={l.id} lesson={l} onClick={() => navigate(`/office-academy/${l.id}`)} />
                    ))}
                  </>
                )}

                {/* New lessons */}
                {sections.newLessons.length > 0 && (
                  <>
                    <SectionHeader icon="🟡" title="Новые свитки" color={C.gold} count={sections.newLessons.length} />
                    {sections.newLessons.map(l => (
                      <LessonCard key={l.id} lesson={l} onClick={() => navigate(`/office-academy/${l.id}`)} />
                    ))}
                  </>
                )}

                {/* Optional */}
                {sections.optional.length > 0 && (
                  <>
                    <SectionHeader icon="🟢" title="Свитки мудрости" color={C.green} count={sections.optional.length} />
                    {sections.optional.map(l => (
                      <LessonCard key={l.id} lesson={l} onClick={() => navigate(`/office-academy/${l.id}`)} />
                    ))}
                  </>
                )}

                {/* Completed */}
                {sections.completed.length > 0 && (
                  <>
                    <SectionHeader icon="✅" title="Пройденные" color={C.green} count={sections.completed.length} />
                    {sections.completed.map(l => (
                      <LessonCard key={l.id} lesson={l} onClick={() => navigate(`/office-academy/${l.id}`)} />
                    ))}
                  </>
                )}
              </>
            )}
          </>
        )}

        {tab === 'leaderboard' && <LeaderboardTab />}
        {tab === 'stats' && <StatsTab />}
      </div>
    </div>
  );
}
