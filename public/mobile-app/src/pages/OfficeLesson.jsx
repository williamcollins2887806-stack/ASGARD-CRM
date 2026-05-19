import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '@/api/client';

const C = {
  bg: '#0d0d12', card: '#16161f', gold: '#c8a84b',
  green: '#22c55e', red: '#ef4444', amber: '#f59e0b',
  blue: '#3b82f6', rune: '#7b61ff', text: '#e8e8f0', muted: '#6b7280',
};

// ── Block renderers ────────────────────────────────────────────────
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
      <span style={{ fontSize: 14, color: checked ? C.muted : '#c8c8d8', lineHeight: 1.6, textDecoration: checked ? 'line-through' : 'none' }}>
        {text}
      </span>
    </div>
  );
}

function Block({ block }) {
  switch (block.type) {
    case 'heading':
      return (
        <div style={{ fontSize: 18, fontWeight: 900, color: C.text, margin: '24px 0 10px', lineHeight: 1.3 }}>
          {block.text}
        </div>
      );
    case 'subheading':
      return (
        <div style={{ fontSize: 15, fontWeight: 800, color: C.gold, margin: '16px 0 8px', lineHeight: 1.3 }}>
          {block.text}
        </div>
      );
    case 'text':
      return (
        <div style={{ fontSize: 15, color: '#c8c8d8', lineHeight: 1.8, marginBottom: 14 }}>
          {block.content}
        </div>
      );
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
    case 'highlight':
      return (
        <div style={{
          background: `linear-gradient(135deg, ${C.rune}18 0%, ${C.blue}10 100%)`,
          border: `1px solid ${C.rune}40`,
          borderRadius: 14, padding: '14px 16px', margin: '14px 0',
          borderLeft: `4px solid ${C.rune}`,
        }}>
          <div style={{ fontSize: 14, color: C.text, lineHeight: 1.7, fontWeight: 600 }}>
            💡 {block.text}
          </div>
        </div>
      );
    case 'warning':
      return (
        <div style={{
          background: C.red + '12',
          border: `1px solid ${C.red}40`,
          borderLeft: `4px solid ${C.red}`,
          borderRadius: 14, padding: '14px 16px', margin: '14px 0',
        }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.red, marginBottom: 4 }}>⚠️ ВАЖНО</div>
          <div style={{ fontSize: 14, color: '#e8c8c8', lineHeight: 1.7 }}>{block.text}</div>
        </div>
      );
    case 'quote':
      return (
        <div style={{
          background: C.gold + '0d',
          border: `1px solid ${C.gold}30`,
          borderLeft: `3px solid ${C.gold}`,
          borderRadius: 12, padding: '12px 16px', margin: '14px 0',
        }}>
          <div style={{ fontSize: 14, color: C.text, lineHeight: 1.7, fontStyle: 'italic' }}>
            "{block.text}"
          </div>
          {block.author && (
            <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>— {block.author}</div>
          )}
        </div>
      );
    case 'scenario':
      return (
        <div style={{
          background: 'linear-gradient(135deg, #1a1030 0%, #16161f 100%)',
          border: `1px solid ${C.rune}30`,
          borderRadius: 14, padding: '16px', margin: '16px 0',
        }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.rune, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
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
    case 'checklist':
      return (
        <div style={{ background: C.card, borderRadius: 14, padding: '14px 16px', margin: '14px 0', border: '1px solid #ffffff0d' }}>
          {block.title && (
            <div style={{ fontSize: 13, fontWeight: 800, color: C.gold, marginBottom: 10 }}>
              ✅ {block.title}
            </div>
          )}
          {(block.items || []).map((item, i) => <ChecklistItem key={i} text={item} />)}
        </div>
      );
    case 'stat':
      return (
        <div style={{
          background: 'linear-gradient(135deg, #1a1830 0%, #16161f 100%)',
          border: `1px solid ${C.rune}30`,
          borderRadius: 14, padding: '16px', margin: '14px 0',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 36, fontWeight: 900, color: C.rune, lineHeight: 1 }}>{block.value}</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>{block.label}</div>
          {block.source && <div style={{ fontSize: 11, color: '#ffffff25', marginTop: 4 }}>Источник: {block.source}</div>}
        </div>
      );
    case 'divider':
      return <div style={{ height: 1, background: '#ffffff0a', margin: '20px 0' }} />;
    default:
      return null;
  }
}

export default function OfficeLesson() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData]       = useState(null);
  const [loading, setLoad]    = useState(true);
  const [completing, setComp] = useState(false);
  const [completed, setDone]  = useState(false);
  const [error, setError]     = useState('');

  useEffect(() => {
    api.get(`/office-academy/lessons/${id}`)
      .then(d => {
        setData(d);
        setDone(!!d.lesson?.read_completed_at);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoad(false));
  }, [id]);

  async function handleComplete() {
    setComp(true);
    try {
      await api.post(`/office-academy/lessons/${id}/complete`);
      setDone(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setComp(false);
    }
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: 36 }}>📖</div>
    </div>
  );

  if (error) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ color: C.red, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
        <div style={{ fontSize: 14 }}>{error}</div>
        <button onClick={() => navigate(-1)} style={{ marginTop: 16, background: C.card, border: 'none', color: C.muted, padding: '8px 16px', borderRadius: 8, cursor: 'pointer' }}>← Назад</button>
      </div>
    </div>
  );

  const { lesson, questions = [] } = data;
  const blocks = lesson.blocks || [];
  const isPassed = lesson.passed;
  const hasQuiz = questions.length > 0;

  return (
    <div style={{ minHeight: '100vh', background: C.bg, paddingBottom: 100 }}>
      {/* Cover */}
      <div style={{
        background: `linear-gradient(180deg, ${lesson.cover_color || '#1e1e3a'} 0%, ${C.bg} 100%)`,
        padding: '52px 16px 24px', position: 'relative',
      }}>
        <button onClick={() => navigate(-1)}
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.6)', cursor: 'pointer', fontSize: 14, marginBottom: 16, padding: 0 }}>
          ← Назад
        </button>
        <div style={{ fontSize: 48, marginBottom: 12, textAlign: 'center' }}>{lesson.cover_icon}</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', textAlign: 'center', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
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
        </div>
      </div>

      {/* Progress banner */}
      {isPassed && (
        <div style={{
          margin: '0 16px 16px',
          background: C.green + '12', border: `1px solid ${C.green}35`,
          borderRadius: 14, padding: '12px 16px',
        }}>
          <div style={{ fontSize: 14, color: C.green, fontWeight: 700 }}>
            ✓ Урок пройден · Результат: {lesson.score}%
          </div>
          {lesson.attempts > 1 && (
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
              Попыток: {lesson.attempts}
            </div>
          )}
        </div>
      )}

      {/* Body */}
      <div style={{ padding: '16px 18px' }}>
        {blocks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: C.muted }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📝</div>
            <div>Контент урока ещё не добавлен</div>
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

      {/* Actions */}
      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!completed && (
          <button
            onClick={handleComplete}
            disabled={completing}
            style={{
              width: '100%', padding: '16px 0', borderRadius: 16,
              background: C.rune, color: '#fff', fontWeight: 800, fontSize: 16,
              border: 'none', cursor: completing ? 'not-allowed' : 'pointer',
              opacity: completing ? .7 : 1,
            }}>
            {completing ? 'Сохраняю...' : '✓ Отметить прочитанным'}
          </button>
        )}

        {completed && (
          <div style={{
            textAlign: 'center', padding: '12px 0',
            fontSize: 13, color: C.green, fontWeight: 600,
          }}>✓ Прочитан</div>
        )}

        {hasQuiz && (
          <button
            onClick={() => navigate(`/office-academy/${id}/quiz`)}
            style={{
              width: '100%', padding: '16px 0', borderRadius: 16,
              background: isPassed ? C.card : C.gold,
              color: isPassed ? C.muted : '#000',
              fontWeight: 800, fontSize: 16,
              border: isPassed ? `1px solid ${C.gold}20` : 'none',
              cursor: 'pointer',
            }}>
            {isPassed ? `🔄 Пройти тест повторно (${lesson.score}%)` : '📝 Пройти тест'}
          </button>
        )}
      </div>
    </div>
  );
}
