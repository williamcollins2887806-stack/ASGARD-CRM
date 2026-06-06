import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '@/api/client';

const C = {
  bg: '#0d0d12', card: '#16161f', gold: '#c8a84b',
  green: '#22c55e', red: '#ef4444', amber: '#f59e0b',
  blue: '#3b82f6', rune: '#7b61ff', text: '#e8e8f0', muted: '#6b7280',
};

// ═══════════════════════════════════════════════════════════════
// BLOCK RENDERERS — all 15 types
// ═══════════════════════════════════════════════════════════════

function ChecklistItem({ text }) {
  const [checked, setChecked] = useState(false);
  return (
    <div onClick={() => setChecked(!checked)} style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0',
      borderBottom: '1px solid #ffffff06', cursor: 'pointer',
    }}>
      <div style={{
        width: 20, height: 20, borderRadius: 6, flexShrink: 0, marginTop: 1,
        border: `2px solid ${checked ? C.green : '#ffffff25'}`,
        background: checked ? C.green : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all .2s',
      }}>
        {checked && <span style={{ color: '#000', fontSize: 11, fontWeight: 900 }}>✓</span>}
      </div>
      <span style={{
        fontSize: 14, color: checked ? C.muted : '#c8c8d8', lineHeight: 1.6,
        textDecoration: checked ? 'line-through' : 'none',
      }}>{text}</span>
    </div>
  );
}

function Block({ block }) {
  switch (block.type) {
    // ── Cover (Mimir-style) ──
    case 'cover':
      return (
        <div style={{
          textAlign: 'center', padding: '20px 16px', marginBottom: 16,
          background: `linear-gradient(135deg, ${C.rune}15 0%, transparent 100%)`,
          borderRadius: 16, border: `1px solid ${C.rune}20`,
        }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>{block.icon || '🏛️'}</div>
          <div style={{ fontSize: 18, fontWeight: 900, color: C.text, lineHeight: 1.3 }}>{block.title}</div>
          {block.subtitle && (
            <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>{block.subtitle}</div>
          )}
        </div>
      );

    // ── Intro ──
    case 'intro':
      return (
        <div style={{
          fontSize: 15, color: '#d0d0e0', lineHeight: 1.9, marginBottom: 18,
          paddingLeft: 14, borderLeft: `3px solid ${C.gold}40`,
        }}>
          {block.text}
        </div>
      );

    // ── Text Block (Mimir-style with title) ──
    case 'text_block':
      return (
        <div style={{ marginBottom: 18 }}>
          {block.title && (
            <div style={{ fontSize: 16, fontWeight: 800, color: C.text, marginBottom: 8, lineHeight: 1.3 }}>
              {block.title}
            </div>
          )}
          <div style={{ fontSize: 15, color: '#c8c8d8', lineHeight: 1.8 }}>{block.text}</div>
        </div>
      );

    // ── Icon Grid (Mimir-style) ──
    case 'icon_grid':
      return (
        <div style={{
          background: C.card, border: '1px solid #ffffff0d', borderRadius: 16,
          padding: '16px', margin: '16px 0',
        }}>
          {block.title && (
            <div style={{ fontSize: 14, fontWeight: 800, color: C.gold, marginBottom: 12 }}>
              {block.title}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {(block.items || []).map((item, i) => (
              <div key={i} style={{
                display: 'flex', gap: 10, alignItems: 'flex-start',
                background: '#ffffff06', borderRadius: 12, padding: '10px 12px',
              }}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>{item.icon}</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.text, lineHeight: 1.3 }}>{item.label}</div>
                  {item.desc && (
                    <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.4, marginTop: 2 }}>{item.desc}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      );

    // ── Steps (Mimir-style) ──
    case 'steps':
      return (
        <div style={{
          background: `linear-gradient(135deg, #0d1a0d 0%, ${C.card} 100%)`,
          border: `1px solid ${C.green}20`, borderRadius: 16,
          padding: '16px', margin: '16px 0',
        }}>
          {block.title && (
            <div style={{ fontSize: 14, fontWeight: 800, color: C.green, marginBottom: 12 }}>
              📋 {block.title}
            </div>
          )}
          {(block.items || []).map((step, i) => (
            <div key={i} style={{
              display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10,
            }}>
              <div style={{
                width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                background: C.green + '20', border: `1px solid ${C.green}40`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 800, color: C.green,
              }}>{i + 1}</div>
              <div style={{ fontSize: 14, color: '#c8c8d8', lineHeight: 1.6, paddingTop: 2 }}>{step}</div>
            </div>
          ))}
        </div>
      );

    // ── Fact Card (Mimir-style) ──
    case 'fact_card':
      return (
        <div style={{
          background: `linear-gradient(135deg, #1a1505 0%, ${C.card} 100%)`,
          border: `1px solid ${C.gold}25`, borderRadius: 14,
          padding: '14px 16px', margin: '14px 0',
          display: 'flex', gap: 12, alignItems: 'flex-start',
        }}>
          <span style={{ fontSize: 28, flexShrink: 0 }}>{block.icon || '💡'}</span>
          <div style={{ fontSize: 13, color: '#d8d0b8', lineHeight: 1.7, fontStyle: 'italic' }}>
            {block.text}
          </div>
        </div>
      );

    // ── Heading ──
    case 'heading':
      return (
        <div style={{ fontSize: 18, fontWeight: 900, color: C.text, margin: '24px 0 10px', lineHeight: 1.3 }}>
          {block.text}
        </div>
      );

    // ── Subheading ──
    case 'subheading':
      return (
        <div style={{ fontSize: 15, fontWeight: 800, color: C.gold, margin: '16px 0 8px', lineHeight: 1.3 }}>
          {block.text}
        </div>
      );

    // ── Text ──
    case 'text':
      return (
        <div style={{ fontSize: 15, color: '#c8c8d8', lineHeight: 1.8, marginBottom: 14 }}>
          {block.content || block.text}
        </div>
      );

    // ── List ──
    case 'list':
      return (
        <ul style={{ margin: '0 0 14px', paddingLeft: 20 }}>
          {(block.items || []).map((item, i) => (
            <li key={i} style={{ fontSize: 14, color: '#c8c8d8', lineHeight: 1.7, marginBottom: 6 }}>
              {item}
            </li>
          ))}
        </ul>
      );

    // ── Numbered ──
    case 'numbered':
      return (
        <ol style={{ margin: '0 0 14px', paddingLeft: 22 }}>
          {(block.items || []).map((item, i) => (
            <li key={i} style={{ fontSize: 14, color: '#c8c8d8', lineHeight: 1.7, marginBottom: 6 }}>
              {item}
            </li>
          ))}
        </ol>
      );

    // ── Highlight ──
    case 'highlight':
      return (
        <div style={{
          background: `linear-gradient(135deg, ${C.rune}18 0%, ${C.blue}10 100%)`,
          border: `1px solid ${C.rune}40`, borderLeft: `4px solid ${C.rune}`,
          borderRadius: 14, padding: '14px 16px', margin: '14px 0',
        }}>
          <div style={{ fontSize: 14, color: C.text, lineHeight: 1.7, fontWeight: 600 }}>
            💡 {block.text}
          </div>
        </div>
      );

    // ── Warning ──
    case 'warning': {
      const isDanger = block.level === 'danger';
      const wColor = isDanger ? C.red : C.amber;
      return (
        <div style={{
          background: wColor + '12', border: `1px solid ${wColor}40`,
          borderLeft: `4px solid ${wColor}`,
          borderRadius: 14, padding: '14px 16px', margin: '14px 0',
        }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: wColor, marginBottom: 4 }}>
            {isDanger ? '🚨 ОПАСНО' : '⚠️ ВАЖНО'}
          </div>
          <div style={{ fontSize: 14, color: isDanger ? '#e8c8c8' : '#e8dcc8', lineHeight: 1.7 }}>
            {block.text}
          </div>
        </div>
      );
    }

    // ── Quote ──
    case 'quote':
      return (
        <div style={{
          background: C.gold + '0d', border: `1px solid ${C.gold}30`,
          borderLeft: `3px solid ${C.gold}`,
          borderRadius: 12, padding: '12px 16px', margin: '14px 0',
        }}>
          <div style={{ fontSize: 14, color: C.text, lineHeight: 1.7, fontStyle: 'italic' }}>
            «{block.text}»
          </div>
          {block.author && (
            <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>— {block.author}</div>
          )}
        </div>
      );

    // ── Scenario ──
    case 'scenario':
      return (
        <div style={{
          background: `linear-gradient(135deg, #1a1030 0%, ${C.card} 100%)`,
          border: `1px solid ${C.rune}30`, borderRadius: 14,
          padding: '16px', margin: '16px 0',
        }}>
          <div style={{
            fontSize: 11, fontWeight: 800, color: C.rune,
            textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8,
          }}>
            📋 {block.title || 'Ситуация из практики'}
          </div>
          <div style={{ fontSize: 14, color: '#c8c8d8', lineHeight: 1.7, marginBottom: block.resolution ? 10 : 0 }}>
            {block.text}
          </div>
          {block.resolution && (
            <div style={{
              background: C.green + '0d', border: `1px solid ${C.green}25`,
              borderRadius: 10, padding: '10px 12px', marginTop: 8,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.green, marginBottom: 4 }}>✓ Правильное решение</div>
              <div style={{ fontSize: 13, color: '#c8e8c8', lineHeight: 1.6 }}>{block.resolution}</div>
            </div>
          )}
        </div>
      );

    // ── Checklist ──
    case 'checklist':
      return (
        <div style={{
          background: C.card, borderRadius: 14, padding: '14px 16px',
          margin: '14px 0', border: '1px solid #ffffff0d',
        }}>
          {block.title && (
            <div style={{ fontSize: 13, fontWeight: 800, color: C.gold, marginBottom: 10 }}>
              ✅ {block.title}
            </div>
          )}
          {(block.items || []).map((item, i) => <ChecklistItem key={i} text={item} />)}
        </div>
      );

    // ── Stat ──
    case 'stat':
      return (
        <div style={{
          background: `linear-gradient(135deg, #1a1830 0%, ${C.card} 100%)`,
          border: `1px solid ${C.rune}30`, borderRadius: 14,
          padding: '16px', margin: '14px 0', textAlign: 'center',
        }}>
          <div style={{ fontSize: 36, fontWeight: 900, color: C.rune, lineHeight: 1 }}>{block.value}</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>{block.label}</div>
          {block.source && (
            <div style={{ fontSize: 11, color: '#ffffff25', marginTop: 4 }}>Источник: {block.source}</div>
          )}
        </div>
      );

    // ── Divider ──
    case 'divider':
      return <div style={{ height: 1, background: '#ffffff0a', margin: '20px 0' }} />;

    default:
      if (block.text || block.content) {
        return (
          <div style={{ fontSize: 15, color: '#c8c8d8', lineHeight: 1.8, marginBottom: 14 }}>
            {block.text || block.content}
          </div>
        );
      }
      return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// READING TIMER
// ═══════════════════════════════════════════════════════════════
function ReadingTimer({ seconds, minRequired, onComplete }) {
  const remaining = Math.max(0, minRequired - seconds);
  const pct = Math.min(100, (seconds / minRequired) * 100);
  const done = remaining <= 0;

  return (
    <div style={{
      position: 'sticky', bottom: 0, left: 0, right: 0,
      background: `linear-gradient(180deg, transparent 0%, ${C.bg} 20%)`,
      padding: '20px 16px 16px',
    }}>
      {!done && (
        <div style={{
          background: C.card, border: `1px solid ${C.amber}30`,
          borderRadius: 14, padding: '12px 16px', marginBottom: 10,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: C.amber, fontWeight: 700 }}>
              📖 Читай внимательно
            </span>
            <span style={{ fontSize: 12, color: C.muted }}>
              {Math.ceil(remaining)} сек
            </span>
          </div>
          <div style={{ height: 4, background: '#ffffff0d', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%', background: `linear-gradient(90deg, ${C.gold}, ${C.rune})`,
              borderRadius: 2, width: `${pct}%`, transition: 'width 1s linear',
            }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function OfficeLesson() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData]       = useState(null);
  const [loading, setLoad]    = useState(true);
  const [completing, setComp] = useState(false);
  const [completed, setDone]  = useState(false);
  const [error, setError]     = useState('');
  const [readSeconds, setReadSeconds] = useState(0);
  const timerRef = useRef(null);
  const heartbeatRef = useRef(null);

  useEffect(() => {
    api.get(`/office-academy/lessons/${id}`)
      .then(d => {
        setData(d);
        setDone(!!d.lesson?.read_completed_at);
        setReadSeconds(d.lesson?.read_time_seconds || 0);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoad(false));
  }, [id]);

  // Reading timer — count seconds (only after data loaded)
  useEffect(() => {
    if (loading) return;
    timerRef.current = setInterval(() => {
      setReadSeconds(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [loading]);

  // Heartbeat — send reading time every 30s (only after data loaded)
  useEffect(() => {
    if (loading) return;
    heartbeatRef.current = setInterval(() => {
      api.post(`/office-academy/lessons/${id}/heartbeat`, { seconds: 30 }).catch(() => {});
    }, 30000);
    return () => clearInterval(heartbeatRef.current);
  }, [id, loading]);

  const handleComplete = useCallback(async () => {
    setComp(true);
    try {
      const res = await api.post(`/office-academy/lessons/${id}/complete`);
      if (res.ok === false && res.error === 'read_more') {
        setError(`Прочитай ещё ${res.min_required - res.read_time} секунд`);
      } else {
        setDone(true);
        if (res.attempts_reset) {
          // Refresh data to get new attempt count
          const d = await api.get(`/office-academy/lessons/${id}`);
          setData(d);
        }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setComp(false);
    }
  }, [id]);

  if (loading) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: 36 }}>📖</div>
    </div>
  );

  if (error && !data) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ color: C.red, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
        <div style={{ fontSize: 14 }}>{error}</div>
        <button onClick={() => navigate(-1)} style={{
          marginTop: 16, background: C.card, border: 'none', color: C.muted,
          padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
        }}>← Назад</button>
      </div>
    </div>
  );

  const { lesson, questions = [], retry = {}, pass_threshold = 80 } = data;
  const blocks = lesson.blocks || [];
  const isPassed = lesson.passed;
  const hasQuiz = questions.length > 0;
  const needsReread = retry.needs_reread;
  const attemptsLeft = retry.attempts_left;
  const minReadSeconds = retry.min_read_seconds || 60;
  const canTakeQuiz = !needsReread && completed && readSeconds >= minReadSeconds;

  return (
    <div style={{ minHeight: '100vh', background: C.bg, paddingBottom: 120 }}>
      {/* Cover */}
      <div style={{
        background: `linear-gradient(180deg, ${lesson.cover_color || '#1e1e3a'} 0%, ${C.bg} 100%)`,
        padding: '52px 16px 24px', position: 'relative',
      }}>
        <button onClick={() => navigate('/office-academy')}
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.6)', cursor: 'pointer', fontSize: 14, marginBottom: 16, padding: 0 }}>
          ← Залы Асгарда
        </button>
        <div style={{ fontSize: 56, marginBottom: 12, textAlign: 'center' }}>{lesson.cover_icon}</div>
        <div style={{
          fontSize: 11, color: 'rgba(255,255,255,.5)', textAlign: 'center',
          marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1,
        }}>
          {lesson.saga}
        </div>
        <div style={{ fontSize: 22, fontWeight: 900, color: '#fff', textAlign: 'center', lineHeight: 1.3, marginBottom: 12 }}>
          {lesson.title}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,.5)' }}>⏱ {lesson.estimated_minutes} мин</span>
          {hasQuiz && <span style={{ fontSize: 12, color: 'rgba(255,255,255,.5)' }}>❓ {questions.length} вопросов</span>}
          {isPassed && (
            <span style={{ fontSize: 12, color: C.green, fontWeight: 700 }}>✓ Сдан · {lesson.score}%</span>
          )}
          {!isPassed && hasQuiz && (
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,.5)' }}>
              Проходной: {pass_threshold}%
            </span>
          )}
        </div>
      </div>

      {/* Passed banner */}
      {isPassed && (
        <div style={{
          margin: '0 16px 16px',
          background: C.green + '12', border: `1px solid ${C.green}35`,
          borderRadius: 14, padding: '12px 16px',
        }}>
          <div style={{ fontSize: 14, color: C.green, fontWeight: 700 }}>
            ✓ Свиток пройден · Результат: {lesson.score}%
            {lesson.xp_earned > 0 && ` · ⚡${lesson.xp_earned} XP`}
          </div>
          {lesson.attempts > 1 && (
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
              Попыток: {lesson.attempts}
            </div>
          )}
        </div>
      )}

      {/* Needs re-read banner */}
      {needsReread && (
        <div style={{
          margin: '0 16px 16px',
          background: C.amber + '12', border: `1px solid ${C.amber}35`,
          borderRadius: 14, padding: '14px 16px',
        }}>
          <div style={{ fontSize: 14, color: C.amber, fontWeight: 700, marginBottom: 4 }}>
            📖 Перечитай свиток внимательно
          </div>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
            Ты использовал {lesson.attempts} попытки. Прочитай свиток заново (минимум {minReadSeconds} сек),
            чтобы получить 2 новые попытки на испытание.
          </div>
        </div>
      )}

      {/* Retry info banner */}
      {!isPassed && !needsReread && hasQuiz && attemptsLeft !== undefined && attemptsLeft < 2 && attemptsLeft > 0 && (
        <div style={{
          margin: '0 16px 16px',
          background: C.blue + '12', border: `1px solid ${C.blue}35`,
          borderRadius: 14, padding: '12px 16px',
        }}>
          <div style={{ fontSize: 13, color: C.blue }}>
            ⚔️ Осталось попыток: {attemptsLeft} из {retry.max_attempts}
          </div>
        </div>
      )}

      {/* Body */}
      <div style={{ padding: '16px 18px' }}>
        {blocks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: C.muted }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📝</div>
            <div>Контент свитка ещё не добавлен</div>
          </div>
        ) : (
          blocks.map((b, i) => <Block key={i} block={b} />)
        )}
      </div>

      {/* Tags */}
      {(lesson.tags || []).length > 0 && (
        <div style={{ padding: '0 18px 20px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {lesson.tags.map(tag => (
            <span key={tag} style={{
              fontSize: 11, color: C.muted, background: '#ffffff08',
              border: '1px solid #ffffff10', borderRadius: 20, padding: '3px 10px',
            }}>{tag}</span>
          ))}
        </div>
      )}

      {/* Reading timer (for re-read requirement) */}
      {needsReread && (
        <ReadingTimer seconds={readSeconds} minRequired={minReadSeconds} />
      )}

      {/* Actions */}
      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Mark as read button */}
        {!completed && !isPassed && (
          <button
            onClick={handleComplete}
            disabled={completing || (needsReread && readSeconds < minReadSeconds)}
            style={{
              width: '100%', padding: '16px 0', borderRadius: 16,
              background: needsReread
                ? (readSeconds >= minReadSeconds ? C.gold : '#ffffff10')
                : C.rune,
              color: needsReread
                ? (readSeconds >= minReadSeconds ? '#000' : C.muted)
                : '#fff',
              fontWeight: 800, fontSize: 16, border: 'none',
              cursor: (completing || (needsReread && readSeconds < minReadSeconds)) ? 'not-allowed' : 'pointer',
              opacity: completing ? .7 : 1,
            }}>
            {completing ? 'Сохраняю...'
              : needsReread ? (readSeconds >= minReadSeconds ? '✓ Прочитал заново — дай новые попытки' : `📖 Читай... (${Math.max(0, minReadSeconds - readSeconds)} сек)`)
              : '✓ Отметить прочитанным'}
          </button>
        )}

        {completed && !isPassed && !needsReread && (
          <div style={{
            textAlign: 'center', padding: '12px 0',
            fontSize: 13, color: C.green, fontWeight: 600,
          }}>✓ Свиток прочитан</div>
        )}

        {/* Quiz button */}
        {hasQuiz && !needsReread && (
          <button
            onClick={() => navigate(`/office-academy/${id}/quiz`)}
            disabled={!isPassed && !canTakeQuiz}
            style={{
              width: '100%', padding: '16px 0', borderRadius: 16,
              background: isPassed ? C.card
                : (canTakeQuiz ? `linear-gradient(90deg, ${C.gold}, ${C.amber})` : '#ffffff10'),
              color: isPassed ? C.muted : (canTakeQuiz ? '#000' : C.muted),
              fontWeight: 800, fontSize: 16,
              border: isPassed ? `1px solid ${C.gold}20` : 'none',
              cursor: (!isPassed && !canTakeQuiz) ? 'not-allowed' : 'pointer',
            }}>
            {isPassed
              ? `🔄 Пройти испытание повторно (${lesson.score}%)`
              : canTakeQuiz
                ? `⚔️ Начать испытание (${questions.length} вопросов)`
                : !completed
                  ? '⚔️ Сначала прочитай свиток'
                  : `⚔️ Читай ещё ${Math.max(0, minReadSeconds - readSeconds)} сек`}
          </button>
        )}
      </div>

      {/* Error toast */}
      {error && data && (
        <div style={{
          position: 'fixed', bottom: 20, left: 16, right: 16,
          background: C.red + 'e0', borderRadius: 12, padding: '12px 16px',
          fontSize: 13, color: '#fff', textAlign: 'center', zIndex: 100,
        }}>
          {error}
        </div>
      )}
    </div>
  );
}
