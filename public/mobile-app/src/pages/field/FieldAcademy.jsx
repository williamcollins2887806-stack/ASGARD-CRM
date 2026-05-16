/**
 * FieldAcademy.jsx — Чертоги Мимира
 * Главная страница академии: текущая Руна + факт дня + статистика
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';

const COLORS = {
  bg: '#0d0d12',
  card: '#16161f',
  gold: '#c8a84b',
  rune: '#7b61ff',
  green: '#22c55e',
  red: '#ef4444',
  amber: '#f59e0b',
  text: '#e8e8f0',
  muted: '#6b7280',
};

const RANK_COLORS = {
  'Новобранец': '#6b7280',
  'Дружинник':  '#3b82f6',
  'Хирдман':    '#8b5cf6',
  'Ярл':        '#c8a84b',
};

function RankBadge({ rank, icon }) {
  const color = RANK_COLORS[rank] || '#6b7280';
  return (
    <span style={{
      background: `${color}22`,
      border: `1px solid ${color}55`,
      color,
      borderRadius: 20,
      padding: '2px 10px',
      fontSize: 12,
      fontWeight: 700,
    }}>
      {icon} {rank}
    </span>
  );
}

function StreakBadge({ streak }) {
  if (!streak) return null;
  const color = streak >= 4 ? COLORS.gold : streak >= 2 ? COLORS.amber : COLORS.muted;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, color }}>
      <span style={{ fontSize: 16 }}>🔥</span>
      <span style={{ fontSize: 13, fontWeight: 700 }}>{streak} {streak === 1 ? 'неделя' : streak < 5 ? 'недели' : 'недель'}</span>
    </div>
  );
}

function DailyFactCard({ fact, onView }) {
  const [viewed, setViewed] = useState(fact?.viewed || false);

  function handleView() {
    if (!viewed && fact) {
      setViewed(true);
      onView(fact.id);
    }
  }

  if (!fact) return null;

  const catColors = {
    construction: '#f59e0b', history: '#8b5cf6', health: '#22c55e',
    tool: '#3b82f6', law: '#6b7280', science: '#06b6d4',
    geography: '#10b981', viking: '#c8a84b', general: '#6b7280',
  };
  const catColor = catColors[fact.category] || COLORS.muted;

  return (
    <div onClick={handleView} style={{
      background: `linear-gradient(135deg, #1a1a2e 0%, #16161f 100%)`,
      border: `1px solid ${catColor}44`,
      borderRadius: 16,
      padding: 16,
      marginBottom: 16,
      cursor: 'pointer',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: 0, right: 0, width: 80, height: 80,
        background: `radial-gradient(circle, ${catColor}22 0%, transparent 70%)`,
      }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ fontSize: 32, lineHeight: 1 }}>{fact.icon}</div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: catColor, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
              Факт дня
            </span>
            {viewed && <span style={{ fontSize: 10, color: COLORS.muted }}>✓ просмотрено</span>}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text, marginBottom: 4 }}>{fact.title}</div>
          <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.5 }}>{fact.body}</div>
        </div>
      </div>
    </div>
  );
}

function CurrentLessonCard({ lesson, navigate }) {
  if (!lesson) {
    return (
      <div style={{
        background: COLORS.card, borderRadius: 16, padding: 20,
        border: '1px solid #ffffff11', textAlign: 'center',
        marginBottom: 16,
      }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>📖</div>
        <div style={{ color: COLORS.muted, fontSize: 14 }}>Нет активной Руны на этой неделе</div>
      </div>
    );
  }

  const isPassed = lesson.passed;
  const canQuiz = lesson.can_take_quiz;
  const isBlocked = lesson.is_blocked;
  const attemptsLeft = lesson.attempts_left || 0;
  const deadline = lesson.deadline ? new Date(lesson.deadline) : null;
  const daysLeft = deadline ? Math.ceil((deadline - Date.now()) / 86400000) : null;

  const statusColor = isPassed ? COLORS.green : isBlocked ? COLORS.red : daysLeft <= 1 ? COLORS.red : COLORS.gold;
  const statusText = isPassed
    ? `✓ Пройдено — ${lesson.score}%`
    : isBlocked
      ? '⛔ Перечитай Руну'
      : !lesson.read_completed_at
        ? '📖 Нужно прочитать'
        : `⚔️ Пройди Испытание (${attemptsLeft} попытки)`;

  return (
    <div style={{
      background: `linear-gradient(135deg, ${lesson.cover_color || '#1a1a2e'} 0%, #0d0d12 100%)`,
      borderRadius: 16, padding: 20, marginBottom: 16,
      border: `1px solid ${isPassed ? COLORS.green + '44' : COLORS.gold + '33'}`,
      cursor: 'pointer',
    }} onClick={() => navigate(`/field/academy/lesson/${lesson.id}`)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 11, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
            Руна недели · {lesson.saga}
          </div>
          <div style={{ fontSize: 24, marginBottom: 4 }}>{lesson.cover_icon}</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: COLORS.text, marginBottom: 8 }}>{lesson.title}</div>
        </div>
        {isPassed && (
          <div style={{
            width: 48, height: 48, borderRadius: 24,
            background: `${COLORS.green}22`, border: `2px solid ${COLORS.green}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, flexShrink: 0,
          }}>✓</div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: statusColor, fontWeight: 600 }}>{statusText}</span>
        {daysLeft !== null && !isPassed && (
          <span style={{ fontSize: 12, color: daysLeft <= 1 ? COLORS.red : COLORS.muted }}>
            {daysLeft <= 0 ? 'Сегодня дедлайн!' : `${daysLeft}д до дедлайна`}
          </span>
        )}
      </div>

      {lesson.read_completed_at && !isPassed && !isBlocked && (
        <button
          onClick={(e) => { e.stopPropagation(); navigate(`/field/academy/quiz/${lesson.id}`); }}
          style={{
            marginTop: 12, width: '100%', padding: '10px 0',
            background: `linear-gradient(90deg, ${COLORS.rune}, #9b59b6)`,
            border: 'none', borderRadius: 10, color: '#fff',
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}
        >
          ⚔️ Начать Испытание
        </button>
      )}

      {!lesson.read_completed_at && (
        <button
          onClick={(e) => { e.stopPropagation(); navigate(`/field/academy/lesson/${lesson.id}`); }}
          style={{
            marginTop: 12, width: '100%', padding: '10px 0',
            background: `linear-gradient(90deg, ${COLORS.gold}, #a87d20)`,
            border: 'none', borderRadius: 10, color: '#000',
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}
        >
          📖 Читать Руну
        </button>
      )}

      {isBlocked && (
        <div style={{ marginTop: 12, fontSize: 12, color: COLORS.red, textAlign: 'center' }}>
          Перечитай Руну — потом снова Испытание
        </div>
      )}
    </div>
  );
}

function StatsRow({ stats }) {
  if (!stats) return null;
  const pct = stats.lessons_total > 0 ? Math.round((stats.lessons_passed / stats.lessons_total) * 100) : 0;

  return (
    <div style={{
      background: COLORS.card, borderRadius: 16, padding: 16,
      border: '1px solid #ffffff11', marginBottom: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>Твой путь</span>
        <RankBadge rank={stats.rank} icon={stats.rank_icon} />
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        {[
          { label: 'Рун пройдено', value: `${stats.lessons_passed}/${stats.lessons_total}`, icon: '📜' },
          { label: 'Средний балл', value: `${stats.avg_score}%`, icon: '🎯' },
          { label: 'Руны заработано', value: stats.runes_total, icon: '🔮' },
        ].map((s) => (
          <div key={s.label} style={{ flex: 1, background: '#ffffff08', borderRadius: 10, padding: '10px 8px', textAlign: 'center' }}>
            <div style={{ fontSize: 18 }}>{s.icon}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: COLORS.text }}>{s.value}</div>
            <div style={{ fontSize: 10, color: COLORS.muted }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: COLORS.muted }}>Прогресс</span>
        <span style={{ fontSize: 12, color: COLORS.gold }}>{pct}%</span>
      </div>
      <div style={{ height: 6, background: '#ffffff11', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: `linear-gradient(90deg, ${COLORS.gold}, ${COLORS.rune})`, borderRadius: 3, transition: 'width 0.5s' }} />
      </div>

      {stats.streak > 0 && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #ffffff11' }}>
          <StreakBadge streak={stats.streak} />
        </div>
      )}
    </div>
  );
}

export default function FieldAcademy() {
  const navigate = useNavigate();
  const [lesson, setLesson] = useState(null);
  const [fact, setFact] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, f, s] = await Promise.all([
        fieldApi.get('/academy/current-lesson'),
        fieldApi.get('/academy/daily-fact'),
        fieldApi.get('/academy/stats'),
      ]);
      setLesson(l.lesson);
      setFact(f.fact);
      setStats(s);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleFactView(factId) {
    try { await fieldApi.post(`/academy/daily-fact/${factId}/view`); } catch {}
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: COLORS.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: COLORS.gold, fontSize: 32 }}>⚡</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: COLORS.bg, paddingBottom: 100 }}>
      {/* Header */}
      <div style={{
        padding: '48px 20px 20px',
        background: 'linear-gradient(180deg, #1a0d2e 0%, transparent 100%)',
      }}>
        <div style={{ fontSize: 11, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 4 }}>
          ᚱ ЧЕРТОГИ МИМИРА
        </div>
        <div style={{ fontSize: 24, fontWeight: 900, color: COLORS.text }}>
          Академия воина
        </div>
        <div style={{ fontSize: 13, color: COLORS.muted, marginTop: 4 }}>
          Знание — лучшая броня
        </div>
      </div>

      <div style={{ padding: '0 16px' }}>
        {/* Daily Fact */}
        {fact && <DailyFactCard fact={fact} onView={handleFactView} />}

        {/* Current Lesson */}
        <CurrentLessonCard lesson={lesson} navigate={navigate} />

        {/* Stats */}
        <StatsRow stats={stats} />

        {/* Library button */}
        <button
          onClick={() => navigate('/field/academy/library')}
          style={{
            width: '100%', padding: '14px 0',
            background: 'transparent', border: `1px solid ${COLORS.gold}44`,
            borderRadius: 12, color: COLORS.gold,
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          📚 Летопись — все Руны
        </button>
      </div>
    </div>
  );
}
