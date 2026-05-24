/**
 * FieldAcademyLibrary.jsx — Летопись (архив всех Рун)
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';

const C = {
  bg: '#0d0d12', card: '#16161f', gold: '#c8a84b',
  rune: '#7b61ff', green: '#22c55e', red: '#ef4444',
  amber: '#f59e0b', text: '#e8e8f0', muted: '#6b7280',
};

const TAG_LABELS = {
  safety: '⛑️ ТБ', ppe: '🧤 СИЗ', height: '🏔️ Высота', fire: '🔥 Пожар',
  gas: '☣️ Газ', confined: '🕳️ Замкнутые', electrical: '⚡ Электро',
  helicopter: '🚁 Вертолёт', basiet: '✈️ БАСИЕТ',
  knowledge: '📚 Знания', materials: '🏛️ Материалы', history: '📜 История',
  health: '💊 Здоровье', law: '⚖️ Закон', tool: '🔧 Инструмент',
};

function LessonCard({ lesson, navigate }) {
  const isPassed = lesson.passed;
  const isRead = !!lesson.read_completed_at;
  const isOptional = lesson.is_mandatory === false; // явный false (true либо undefined = обязательная по умолчанию)

  let statusIcon = '🔒';
  let statusColor = C.muted;
  let statusText = 'Не начата';

  if (isPassed) {
    statusIcon = '✓';
    statusColor = C.green;
    statusText = `${lesson.score}%`;
  } else if (isRead) {
    statusIcon = '⚔️';
    statusColor = C.amber;
    statusText = 'Прочитана';
  } else if (!isRead && lesson.attempts > 0) {
    // read_completed_at was reset after 2 failed attempts
    statusIcon = '❌';
    statusColor = C.red;
    statusText = 'Перечитай';
  }

  return (
    <div
      onClick={() => navigate(`/field/academy/lesson/${lesson.id}`)}
      style={{
        background: C.card, borderRadius: 14, padding: '14px 16px',
        border: `1px solid ${isPassed ? C.green + '44' : '#ffffff11'}`,
        marginBottom: 10, cursor: 'pointer', display: 'flex', gap: 14, alignItems: 'center',
      }}
    >
      <div style={{
        width: 52, height: 52, borderRadius: 14,
        background: `${lesson.cover_color || '#1a1a2e'}cc`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 28, flexShrink: 0,
      }}>
        {lesson.cover_icon}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 2, display: 'flex', gap: 6, alignItems: 'center' }}>
          <span>{lesson.saga} · Неделя {lesson.week_number}</span>
          {isOptional && (
            <span style={{
              fontSize: 9, color: C.green, background: `${C.green}22`,
              padding: '1px 6px', borderRadius: 6, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: 0.5,
            }}>
              По желанию
            </span>
          )}
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {lesson.title}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {(lesson.tags || []).slice(0, 2).map(tag => (
            <span key={tag} style={{
              fontSize: 10, color: C.muted, background: '#ffffff08',
              padding: '2px 6px', borderRadius: 8,
            }}>
              {TAG_LABELS[tag] || tag}
            </span>
          ))}
          <span style={{ fontSize: 12, color: C.muted }}>~{lesson.estimated_minutes} мин</span>
        </div>
      </div>

      <div style={{ textAlign: 'center', flexShrink: 0 }}>
        <div style={{ fontSize: 20, marginBottom: 2, color: statusColor }}>{statusIcon}</div>
        <div style={{ fontSize: 11, color: statusColor, fontWeight: 700 }}>{statusText}</div>
        {lesson.runes_earned > 0 && (
          <div style={{ fontSize: 10, color: C.rune, marginTop: 2 }}>+{lesson.runes_earned}🔮</div>
        )}
      </div>
    </div>
  );
}

export default function FieldAcademyLibrary() {
  const navigate = useNavigate();
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('catchup'); // catchup | all | passed | unread

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fieldApi.get('/academy/lessons');
      setLessons(data.lessons || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Догнать = обязательные несданные с прошедшим release_monday,
  // отсортировать по week_number ↑ (то есть от старых к новым)
  const today = new Date().toISOString().split('T')[0];
  const catchupLessons = lessons
    .filter(l => l.is_mandatory !== false && !l.passed && l.release_monday && l.release_monday <= today)
    .sort((a, b) => a.week_number - b.week_number);

  const filtered = filter === 'catchup'
    ? catchupLessons
    : lessons.filter(l => {
        if (filter === 'passed') return l.passed;
        if (filter === 'unread') return !l.read_completed_at;
        return true;
      });

  const passedCount = lessons.filter(l => l.passed).length;
  const totalCount = lessons.length;

  return (
    <div style={{ minHeight: '100vh', background: C.bg, paddingBottom: 80 }}>
      {/* Header */}
      <div style={{ padding: '48px 16px 20px', background: 'linear-gradient(180deg, #1a0d2e 0%, transparent 100%)' }}>
        <button
          onClick={() => navigate('/field/academy')}
          style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 14, marginBottom: 16, padding: 0 }}
        >
          ← Назад
        </button>
        <div style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 4 }}>📚 Летопись</div>
        <div style={{ fontSize: 13, color: C.muted }}>
          Пройдено {passedCount} из {totalCount} Рун
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, overflowX: 'auto', paddingBottom: 4 }}>
          {[
            { key: 'catchup', label: `Что догнать${catchupLessons.length ? ` (${catchupLessons.length})` : ''}`, accent: catchupLessons.length > 0 ? C.red : null },
            { key: 'all', label: 'Все' },
            { key: 'unread', label: 'Не прочитаны' },
            { key: 'passed', label: 'Пройденные' },
          ].map(tab => {
            const isActive = filter === tab.key;
            const baseColor = tab.accent && !isActive ? tab.accent : null;
            return (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                style={{
                  padding: '6px 14px', borderRadius: 20,
                  border: baseColor ? `1px solid ${baseColor}66` : 'none',
                  background: isActive ? C.rune : '#ffffff11',
                  color: isActive ? '#fff' : (baseColor || C.muted),
                  fontSize: 13, fontWeight: isActive || baseColor ? 700 : 400,
                  cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ padding: '0 16px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: C.gold, fontSize: 32 }}>⚡</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>
            {filter === 'catchup'
              ? '🎉 Все обязательные руны сданы. Можно работать спокойно!'
              : 'Нет Рун в этом разделе'}
          </div>
        ) : (
          filtered.map(lesson => (
            <LessonCard key={lesson.id} lesson={lesson} navigate={navigate} />
          ))
        )}
      </div>
    </div>
  );
}
