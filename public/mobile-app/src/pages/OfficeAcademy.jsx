import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';

const C = {
  bg: '#0d0d12', card: '#16161f', gold: '#c8a84b',
  green: '#22c55e', red: '#ef4444', amber: '#f59e0b',
  blue: '#3b82f6', rune: '#7b61ff', text: '#e8e8f0', muted: '#6b7280',
};

const TRACK_LABELS = {
  pm:          'Проектный менеджмент',
  hr:          'HR и кадровое дело',
  finance:     'Финансы и учёт',
  procurement: 'Закупки и снабжение',
  management:  'Управление',
  all:         'Общий курс',
};

const TRACK_COLORS = {
  pm:          '#3b82f6',
  hr:          '#22c55e',
  finance:     '#f59e0b',
  procurement: '#ef4444',
  management:  '#8b5cf6',
  all:         '#6b7280',
};

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function PassBadge({ passed, score }) {
  if (!passed) return null;
  return (
    <span style={{
      fontSize: 10, fontWeight: 800, color: C.green,
      background: C.green + '18', border: `1px solid ${C.green}40`,
      borderRadius: 6, padding: '2px 7px',
    }}>✓ {score}%</span>
  );
}

function LessonCard({ lesson, onClick }) {
  const tc = TRACK_COLORS[lesson.track] || C.muted;
  const isPassed = lesson.passed;
  const isReading = lesson.read_started_at && !lesson.read_completed_at;
  const isNew = !lesson.read_started_at;

  return (
    <div onClick={onClick} style={{
      background: `linear-gradient(135deg, ${lesson.cover_color || '#1e1e3a'} 0%, #16161f 100%)`,
      border: `1px solid ${isPassed ? C.green + '40' : '#ffffff12'}`,
      borderRadius: 18, padding: '16px', marginBottom: 12, cursor: 'pointer',
      position: 'relative', overflow: 'hidden',
    }}>
      {isNew && lesson.is_mandatory && (
        <div style={{
          position: 'absolute', top: 12, right: 12,
          background: C.red, borderRadius: 20, padding: '2px 8px',
          fontSize: 9, fontWeight: 800, color: '#fff', textTransform: 'uppercase',
        }}>Обязательный</div>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{
          fontSize: 36, width: 52, height: 52, display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: '#ffffff0a', borderRadius: 14, flexShrink: 0,
        }}>
          {lesson.cover_icon}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 10, fontWeight: 700, color: tc,
              background: tc + '18', border: `1px solid ${tc}35`,
              borderRadius: 6, padding: '2px 6px', flexShrink: 0,
            }}>{TRACK_LABELS[lesson.track] || lesson.track}</span>
            {isPassed && <PassBadge passed score={lesson.score} />}
          </div>

          <div style={{ fontSize: 15, fontWeight: 800, color: C.text, lineHeight: 1.3, marginBottom: 4 }}>
            {lesson.title}
          </div>

          {lesson.saga && (
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>{lesson.saga}</div>
          )}

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: C.muted }}>⏱ {lesson.estimated_minutes} мин</span>
            {isReading && <span style={{ fontSize: 11, color: C.amber, fontWeight: 700 }}>📖 Читаю...</span>}
            {lesson.read_completed_at && !isPassed && (
              <span style={{ fontSize: 11, color: C.blue }}>✓ Прочитан · Тест не сдан</span>
            )}
            {isPassed && lesson.attempts > 1 && (
              <span style={{ fontSize: 11, color: C.muted }}>{lesson.attempts} попытки</span>
            )}
            {lesson.release_date && (
              <span style={{ fontSize: 11, color: C.muted }}>{fmtDate(lesson.release_date)}</span>
            )}
          </div>
        </div>

        <div style={{ color: C.muted, fontSize: 18, flexShrink: 0, alignSelf: 'center' }}>›</div>
      </div>
    </div>
  );
}

export default function OfficeAcademy() {
  const navigate = useNavigate();
  const [data, setData]     = useState(null);
  const [loading, setLoad]  = useState(true);
  const [tab, setTab]       = useState('lessons'); // lessons | leaderboard

  useEffect(() => {
    setLoad(true);
    api.get('/office-academy/lessons')
      .then(setData)
      .finally(() => setLoad(false));
  }, []);

  if (loading) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: 36, color: C.rune }}>🏛️</div>
    </div>
  );

  const { lessons = [], total = 0, passed = 0, mandatory_pending = 0 } = data || {};
  const pct = total > 0 ? Math.round(passed / total * 100) : 0;

  return (
    <div style={{ minHeight: '100vh', background: C.bg, paddingBottom: 80 }}>
      {/* Header */}
      <div style={{
        padding: '52px 16px 16px',
        background: 'linear-gradient(180deg, #1a0d2e 0%, transparent 100%)',
      }}>
        <button onClick={() => navigate(-1)}
          style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 14, marginBottom: 10, padding: 0 }}>
          ← Назад
        </button>
        <div style={{ fontSize: 24, fontWeight: 900, color: C.text }}>🏛️ Академия Асгарда</div>
        <div style={{ fontSize: 13, color: C.muted, marginTop: 3 }}>Профессиональное обучение офисных сотрудников</div>
      </div>

      <div style={{ padding: '0 16px' }}>
        {/* Stats strip */}
        <div style={{
          background: C.card, borderRadius: 16, padding: '14px 16px', marginBottom: 16,
          border: '1px solid #ffffff0d',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: C.text }}>{passed}</div>
              <div style={{ fontSize: 11, color: C.muted }}>сдано</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: C.text }}>{total}</div>
              <div style={{ fontSize: 11, color: C.muted }}>всего</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: mandatory_pending > 0 ? C.red : C.green }}>
                {mandatory_pending}
              </div>
              <div style={{ fontSize: 11, color: C.muted }}>обяз. осталось</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: pct >= 80 ? C.green : pct >= 40 ? C.amber : C.text }}>
                {pct}%
              </div>
              <div style={{ fontSize: 11, color: C.muted }}>прогресс</div>
            </div>
          </div>
          <div style={{ height: 4, background: '#ffffff0d', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: C.rune, borderRadius: 2, width: `${pct}%`, transition: 'width .4s' }} />
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {[
            { id: 'lessons', label: '📚 Уроки' },
            { id: 'leaderboard', label: '🏆 Рейтинг' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, padding: '9px 0', borderRadius: 12,
              border: tab === t.id ? `1px solid ${C.rune}60` : '1px solid #ffffff0d',
              background: tab === t.id ? C.rune + '18' : 'transparent',
              color: tab === t.id ? C.rune : C.muted,
              fontWeight: tab === t.id ? 700 : 400, fontSize: 13, cursor: 'pointer',
            }}>{t.label}</button>
          ))}
        </div>

        {tab === 'lessons' && (
          <>
            {mandatory_pending > 0 && (
              <div style={{
                background: C.red + '12', border: `1px solid ${C.red}35`,
                borderRadius: 14, padding: '12px 14px', marginBottom: 14,
                fontSize: 13, color: C.red,
              }}>
                ⚠️ {mandatory_pending} обязательных {mandatory_pending === 1 ? 'урок не сдан' : 'урока не сдано'}
              </div>
            )}

            {lessons.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: C.muted }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📚</div>
                <div style={{ fontSize: 14 }}>Уроки для вашей роли пока не опубликованы</div>
              </div>
            ) : (
              lessons.map(l => (
                <LessonCard
                  key={l.id}
                  lesson={l}
                  onClick={() => navigate(`/office-academy/${l.id}`)}
                />
              ))
            )}
          </>
        )}

        {tab === 'leaderboard' && (
          <LeaderboardTab navigate={navigate} />
        )}
      </div>
    </div>
  );
}

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
      {leaderboard.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: C.muted }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🏆</div>
          <div style={{ fontSize: 14 }}>Никто ещё не сдал ни одного урока</div>
        </div>
      ) : leaderboard.map((u, i) => (
        <div key={u.id} style={{
          background: i < 3 ? `linear-gradient(135deg, ${['#1a1505','#0f1520','#1a0f05'][i]} 0%, #16161f 100%)` : C.card,
          border: `1px solid ${i === 0 ? C.gold + '40' : i === 1 ? '#94a3b820' : i === 2 ? C.amber + '20' : '#ffffff0d'}`,
          borderRadius: 14, padding: '12px 14px', marginBottom: 8,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ fontSize: i < 3 ? 22 : 14, width: 28, textAlign: 'center', color: i < 3 ? 'inherit' : C.muted, fontWeight: 700 }}>
            {i < 3 ? medals[i] : `${i + 1}`}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{u.fio}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{u.role}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: i === 0 ? C.gold : C.text }}>{u.lessons_passed}</div>
            <div style={{ fontSize: 10, color: C.muted }}>уроков · ⌀{u.avg_score}%</div>
          </div>
        </div>
      ))}
    </div>
  );
}
