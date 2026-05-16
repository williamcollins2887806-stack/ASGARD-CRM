/**
 * FieldLesson.jsx — Читалка Руны
 * Рендерит все типы блоков контента с Viking-стилем
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';

const C = {
  bg: '#0d0d12', card: '#16161f', gold: '#c8a84b',
  rune: '#7b61ff', green: '#22c55e', red: '#ef4444',
  amber: '#f59e0b', text: '#e8e8f0', muted: '#6b7280',
};

// ── Block renderers ──────────────────────────────────────────────────────────

function CoverBlock({ block }) {
  return (
    <div style={{
      background: `linear-gradient(135deg, ${block.color || '#1a1a2e'} 0%, #0d0d12 100%)`,
      padding: '40px 24px 32px', textAlign: 'center', marginBottom: 0,
    }}>
      <div style={{ fontSize: 64, marginBottom: 16, lineHeight: 1 }}>{block.icon}</div>
      <div style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 8 }}>{block.title}</div>
      {block.subtitle && <div style={{ fontSize: 14, color: C.muted }}>{block.subtitle}</div>}
    </div>
  );
}

function IntroBlock({ block }) {
  return (
    <div style={{
      background: `${C.rune}11`, borderLeft: `3px solid ${C.rune}`,
      borderRadius: '0 12px 12px 0', padding: 16, margin: '16px 0',
      fontSize: 15, color: C.text, lineHeight: 1.65,
    }}>
      {block.text}
    </div>
  );
}

function IconGridBlock({ block }) {
  return (
    <div style={{ margin: '16px 0' }}>
      {block.title && (
        <div style={{ fontSize: 13, fontWeight: 700, color: C.gold, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
          {block.title}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {(block.items || []).map((item, i) => (
          <div key={i} style={{
            background: C.card, borderRadius: 12, padding: '12px 10px',
            border: '1px solid #ffffff11',
          }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>{item.icon}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>{item.label}</div>
            <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.45 }}>{item.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WarningBlock({ block }) {
  const isDanger = block.level === 'danger';
  const color = isDanger ? C.red : C.amber;
  const icon = isDanger ? '⛔' : '⚠️';
  return (
    <div style={{
      background: `${color}11`, border: `1px solid ${color}44`,
      borderRadius: 12, padding: 14, margin: '16px 0',
      display: 'flex', gap: 10, alignItems: 'flex-start',
    }}>
      <div style={{ fontSize: 20, flexShrink: 0 }}>{icon}</div>
      <div style={{ fontSize: 14, color, lineHeight: 1.55, fontWeight: isDanger ? 700 : 400 }}>
        {block.text}
      </div>
    </div>
  );
}

function StepsBlock({ block }) {
  return (
    <div style={{ margin: '16px 0' }}>
      {block.title && (
        <div style={{ fontSize: 13, fontWeight: 700, color: C.gold, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
          {block.title}
        </div>
      )}
      {(block.items || []).map((step, i) => (
        <div key={i} style={{
          display: 'flex', gap: 12, marginBottom: 10, alignItems: 'flex-start',
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 14, background: `${C.rune}33`,
            border: `1px solid ${C.rune}66`, color: C.rune,
            fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center',
            justifyContent: 'center', flexShrink: 0,
          }}>
            {i + 1}
          </div>
          <div style={{ fontSize: 14, color: C.text, lineHeight: 1.5, paddingTop: 4 }}>{step}</div>
        </div>
      ))}
    </div>
  );
}

function TextBlock({ block }) {
  return (
    <div style={{ margin: '16px 0' }}>
      {block.title && (
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 8 }}>{block.title}</div>
      )}
      <div style={{ fontSize: 14, color: '#b0b0c0', lineHeight: 1.65 }}>{block.text}</div>
    </div>
  );
}

function FactCard({ block }) {
  return (
    <div style={{
      background: `linear-gradient(135deg, #1a2d3a 0%, ${C.card} 100%)`,
      border: `1px solid #3b82f644`,
      borderRadius: 12, padding: 14, margin: '16px 0',
      display: 'flex', gap: 12, alignItems: 'flex-start',
    }}>
      <div style={{ fontSize: 24, flexShrink: 0 }}>{block.icon}</div>
      <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>{block.text}</div>
    </div>
  );
}

function renderBlock(block, idx) {
  switch (block.type) {
    case 'cover':     return <CoverBlock key={idx} block={block} />;
    case 'intro':     return <IntroBlock key={idx} block={block} />;
    case 'icon_grid': return <IconGridBlock key={idx} block={block} />;
    case 'warning':   return <WarningBlock key={idx} block={block} />;
    case 'steps':     return <StepsBlock key={idx} block={block} />;
    case 'text_block':return <TextBlock key={idx} block={block} />;
    case 'fact_card': return <FactCard key={idx} block={block} />;
    default:          return null;
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FieldLesson() {
  const navigate = useNavigate();
  const { lessonId } = useParams();
  const [lesson, setLesson] = useState(null);
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [readCompleted, setReadCompleted] = useState(false);
  const [completing, setCompleting] = useState(false);
  const startTimeRef = useRef(Date.now());
  const readStartedRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cur] = await Promise.all([
        fieldApi.get('/academy/current-lesson'),
      ]);
      // Find lesson from library
      const lib = await fieldApi.get('/academy/lessons');
      const found = lib.lessons.find(l => l.id === parseInt(lessonId));
      if (found) {
        // Load current-lesson for progress details
        if (cur.lesson?.id === found.id) {
          setLesson({ ...found, blocks: cur.lesson.blocks });
          setProgress(cur.lesson);
          setReadCompleted(!!cur.lesson.read_completed_at);
        } else {
          setLesson(found);
          setReadCompleted(!!found.read_completed_at);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [lessonId]);

  useEffect(() => {
    load();
    // Start read timer
    startTimeRef.current = Date.now();
  }, [load]);

  useEffect(() => {
    // Mark read-start
    if (!readStartedRef.current && lessonId) {
      readStartedRef.current = true;
      fieldApi.post(`/academy/lessons/${lessonId}/read-start`).catch(() => {});
    }
  }, [lessonId]);

  async function handleComplete() {
    if (readCompleted || completing) return;
    const seconds = Math.round((Date.now() - startTimeRef.current) / 1000);
    setCompleting(true);
    try {
      await fieldApi.post(`/academy/lessons/${lessonId}/read-complete`, { time_spent_seconds: seconds });
      setReadCompleted(true);
    } catch (e) {
      alert(e.message || 'Ошибка');
    } finally {
      setCompleting(false);
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: C.gold, fontSize: 32 }}>⚡</div>
      </div>
    );
  }

  if (!lesson) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, padding: '80px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📜</div>
        <div style={{ color: C.muted }}>Руна не найдена</div>
        <button onClick={() => navigate(-1)} style={{ marginTop: 20, color: C.gold, background: 'none', border: 'none', cursor: 'pointer' }}>
          ← Назад
        </button>
      </div>
    );
  }

  const blocks = lesson.blocks || [];

  return (
    <div style={{ minHeight: '100vh', background: C.bg, paddingBottom: 120 }}>
      {/* Back button */}
      <button
        onClick={() => navigate(-1)}
        style={{
          position: 'fixed', top: 48, left: 16, zIndex: 100,
          background: '#00000088', border: 'none', borderRadius: 20,
          padding: '6px 14px', color: C.text, fontSize: 14, cursor: 'pointer',
          backdropFilter: 'blur(8px)',
        }}
      >
        ← Назад
      </button>

      {/* Content blocks */}
      {blocks.map((block, i) => (
        <div key={i} style={block.type !== 'cover' ? { padding: '0 16px' } : {}}>
          {renderBlock(block, i)}
        </div>
      ))}

      {/* Bottom action */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        padding: '16px 16px 32px',
        background: `linear-gradient(transparent, ${C.bg} 30%)`,
      }}>
        {readCompleted ? (
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{
              flex: 1, padding: '13px 0', background: `${C.green}22`,
              border: `1px solid ${C.green}44`, borderRadius: 12,
              color: C.green, fontSize: 14, fontWeight: 700,
              textAlign: 'center',
            }}>
              ✓ Прочитано
            </div>
            <button
              onClick={() => navigate(`/field/academy/quiz/${lessonId}`)}
              style={{
                flex: 2, padding: '13px 0',
                background: `linear-gradient(90deg, ${C.rune}, #9b59b6)`,
                border: 'none', borderRadius: 12, color: '#fff',
                fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}
            >
              ⚔️ Пройти Испытание
            </button>
          </div>
        ) : (
          <button
            onClick={handleComplete}
            disabled={completing}
            style={{
              width: '100%', padding: '14px 0',
              background: completing
                ? '#ffffff22'
                : `linear-gradient(90deg, ${C.gold}, #a87d20)`,
              border: 'none', borderRadius: 12, color: '#000',
              fontSize: 15, fontWeight: 800, cursor: completing ? 'default' : 'pointer',
            }}
          >
            {completing ? 'Сохраняем...' : '✓ Прочитал — к Испытанию'}
          </button>
        )}
      </div>
    </div>
  );
}
