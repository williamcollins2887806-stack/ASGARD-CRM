/**
 * FieldLesson.jsx — Читалка Руны
 * Рендерит все типы блоков контента с Viking-стилем
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Zap, ScrollText, ArrowLeft, Check, Swords, Timer } from 'lucide-react';
import { fieldApi } from '@/api/fieldClient';
import LessonInteractive from '@/components/field/LessonInteractive';
import { Card, IconTile, KeyButton } from '@/components/field/ui';
import './field-screens.css';

const C = {
  bg: 'var(--bg-primary)', card: 'var(--bg-surface)', gold: 'var(--value)',
  rune: 'var(--acc)', green: 'var(--ok)', red: 'var(--danger)',
  amber: 'var(--value)', text: 'var(--text-primary)', muted: 'var(--text-secondary)',
};

/** Совпадает с MIN_READ_SECONDS в src/routes/field-academy.js */
const MIN_READ_SECONDS = 60;

function readStartKey(id) {
  return 'academy_read_start_' + id;
}

// ── Block renderers ──────────────────────────────────────────────────────────

function CoverBlock({ block }) {
  return (
    <div style={{
      background: `linear-gradient(135deg, ${block.color || 'var(--bg-surface)'} 0%, var(--bg-primary) 100%)`,
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
      background: `color-mix(in oklab, ${C.rune} 9%, var(--bg-surface))`, borderLeft: `3px solid ${C.rune}`,
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
            border: '1px solid color-mix(in oklab, var(--text-primary) 7%, transparent)',
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
  return (
    <div style={{
      background: `color-mix(in oklab, ${color} 8%, var(--bg-surface))`,
      border: `1px solid color-mix(in oklab, ${color} 26%, transparent)`,
      borderRadius: 12, padding: 14, margin: '16px 0',
      display: 'flex', gap: 10, alignItems: 'flex-start',
    }}>
      <div style={{ fontSize: 20, flexShrink: 0, lineHeight: 1.2 }} aria-hidden>
        {isDanger ? '⛔' : '⚠️'}
      </div>
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
            width: 28, height: 28, borderRadius: 14,
            background: `color-mix(in oklab, ${C.rune} 16%, transparent)`,
            border: `1px solid color-mix(in oklab, ${C.rune} 34%, transparent)`, color: C.rune,
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
      <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.65 }}>{block.text}</div>
    </div>
  );
}

function FactCard({ block }) {
  return (
    <div style={{
      background: 'color-mix(in oklab, var(--acc) 10%, var(--bg-surface))',
      border: '1px solid color-mix(in oklab, var(--acc) 28%, transparent)',
      borderRadius: 12, padding: 14, margin: '16px 0',
      display: 'flex', gap: 12, alignItems: 'flex-start',
    }}>
      <div style={{ fontSize: 24, flexShrink: 0 }}>{block.icon}</div>
      <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>{block.text}</div>
    </div>
  );
}

/**
 * IllustrationBlock — картинка Руны (сцена с бригадой или схема).
 * {type:'illustration', url, alt, caption, aspect, kind:'scene'|'diagram', badge}
 */
function IllustrationBlock({ block }) {
  return (
    <figure style={{
      margin: '18px 0', borderRadius: 14, overflow: 'hidden',
      border: '1px solid color-mix(in oklab, var(--text-primary) 10%, transparent)', background: '#f4f1ea', position: 'relative',
    }}>
      {block.badge && (
        <span style={{
          position: 'absolute', top: 10, left: 10, zIndex: 2,
          background: '#1a1a2ee6', border: '1px solid #c8a84b77',
          color: C.gold, fontSize: 10, fontWeight: 700,
          padding: '4px 10px', borderRadius: 20, letterSpacing: 0.5,
        }}>{block.badge}</span>
      )}
      <img
        src={block.url}
        alt={block.alt || ''}
        loading="lazy"
        style={{
          width: '100%', display: 'block',
          // ВАЖНО: aspect из данных может прийти как '16 / 9' (с пробелами) —
          // это НЕВАЛИДНЫЙ CSS, браузер его игнорирует и картинка раздувается,
          // «съедая» экран. Нормализуем на клиенте.
          aspectRatio: block.aspect ? String(block.aspect).replace(/\s+/g, '') : undefined,
        }}
      />
      {block.caption && (
        <figcaption style={{
          background: '#141420', padding: '10px 12px', fontSize: 12,
          color: '#e2e2ec', lineHeight: 1.5, borderTop: '1px solid color-mix(in oklab, var(--text-primary) 8%, transparent)',
        }}>
          {block.caption}
        </figcaption>
      )}
    </figure>
  );
}

function renderBlock(block, idx, lessonId) {
  switch (block.type) {
    case 'cover':     return <CoverBlock key={idx} block={block} />;
    case 'intro':     return <IntroBlock key={idx} block={block} />;
    case 'icon_grid': return <IconGridBlock key={idx} block={block} />;
    case 'warning':   return <WarningBlock key={idx} block={block} />;
    case 'steps':     return <StepsBlock key={idx} block={block} />;
    case 'text_block':return <TextBlock key={idx} block={block} />;
    case 'fact_card': return <FactCard key={idx} block={block} />;
    case 'illustration': return <IllustrationBlock key={idx} block={block} />;
    case 'interactive':  return <LessonInteractive key={idx} block={block} lessonId={lessonId} index={idx} />;
    default:          return null;
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FieldLesson() {
  const navigate = useNavigate();
  const { lessonId } = useParams();
  const [lesson, setLesson] = useState(null);
  const [, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [readCompleted, setReadCompleted] = useState(false);
  const [passed, setPassed] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [remainSec, setRemainSec] = useState(MIN_READ_SECONDS);
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
          setPassed(!!cur.lesson.passed || !!found.passed);
        } else {
          setLesson(found);
          setReadCompleted(!!found.read_completed_at);
          setPassed(!!found.passed);
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
  }, [load]);

  useEffect(() => {
    if (!lessonId) return;
    const key = readStartKey(lessonId);
    let start = Number(sessionStorage.getItem(key));
    if (!Number.isFinite(start) || start <= 0) {
      start = Date.now();
      try { sessionStorage.setItem(key, String(start)); } catch { /* */ }
    }
    startTimeRef.current = start;
    const tick = () => {
      const elapsed = Math.round((Date.now() - start) / 1000);
      setRemainSec(Math.max(0, MIN_READ_SECONDS - elapsed));
    };
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [lessonId]);

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
    if (seconds < MIN_READ_SECONDS) {
      setRemainSec(MIN_READ_SECONDS - seconds);
      return;
    }
    setCompleting(true);
    try {
      await fieldApi.post(`/academy/lessons/${lessonId}/read-complete`, { time_spent_seconds: seconds });
      setReadCompleted(true);
      try { sessionStorage.removeItem(readStartKey(lessonId)); } catch { /* */ }
    } catch (e) {
      alert(e.message || 'Ошибка');
    } finally {
      setCompleting(false);
    }
  }

  if (loading) {
    return (
      <div className="fs-root" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Zap size={32} strokeWidth={2.2} style={{ color: C.gold }} />
      </div>
    );
  }

  if (!lesson) {
    return (
      <div className="fs-root" style={{ padding: '80px 20px', textAlign: 'center' }}>
        <IconTile icon={ScrollText} tone="value" size={72} iconSize={34} style={{ margin: '0 auto 16px' }} />
        <div style={{ color: C.muted }}>Руна не найдена</div>
        <KeyButton tone="value" icon={ArrowLeft} className="mt-5" onClick={() => navigate(-1)}>Назад</KeyButton>
      </div>
    );
  }

  const blocks = lesson.blocks || [];

  return (
    <div className="fs-root" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
      <div className="fs-scene" aria-hidden><span className="fs-orb fs-orb--a" /><span className="fs-orb fs-orb--b" /></div>

      {/* Back button */}
      <button
        onClick={() => navigate(-1)}
        aria-label="Назад"
        style={{
          position: 'fixed', top: 'max(env(safe-area-inset-top), 16px)', left: 16, zIndex: 100,
          background: 'color-mix(in oklab, var(--bg-primary) 78%, transparent)',
          WebkitBackdropFilter: 'blur(10px)', backdropFilter: 'blur(10px)',
          border: '1px solid var(--tile-brd)', borderRadius: 20,
          padding: '7px 13px', color: 'var(--text-primary)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700,
        }}
      >
        <ArrowLeft size={16} strokeWidth={2.5} />
        Назад
      </button>

      {/* Content blocks */}
      <div style={{ position: 'relative', zIndex: 5 }}>
        {blocks.map((block, i) => (
          <div key={i} style={block.type !== 'cover' ? { padding: '0 16px' } : {}}>
            {renderBlock(block, i, lessonId)}
          </div>
        ))}
      </div>

      {/* Bottom action */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 20,
        padding: '16px 16px calc(env(safe-area-inset-bottom, 0px) + 18px)',
        background: 'linear-gradient(transparent, var(--bg-primary) 30%)',
      }}>
        {readCompleted ? (
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{
              flex: 1, padding: '13px 0',
              background: 'color-mix(in oklab, var(--ok) 12%, var(--bg-surface))',
              border: '1px solid color-mix(in oklab, var(--ok) 28%, transparent)', borderRadius: 12,
              color: C.green, fontSize: 14, fontWeight: 700,
              textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <Check size={16} strokeWidth={2.6} />
              {passed ? 'Испытание пройдено' : 'Прочитано'}
            </div>
            {!passed && (
              <KeyButton
                tone="accent"
                icon={Swords}
                style={{ flex: 2 }}
                onClick={() => navigate(`/field/academy/quiz/${lessonId}`)}
              >
                Пройти Испытание
              </KeyButton>
            )}
          </div>
        ) : (
          <KeyButton
            tone="value"
            block
            icon={Timer}
            onClick={handleComplete}
            disabled={completing || remainSec > 0}
          >
            {completing
              ? 'Сохраняем...'
              : remainSec > 0
                ? `Читай ещё ${remainSec} сек`
                : 'Прочитал — к Испытанию'}
          </KeyButton>
        )}
      </div>
    </div>
  );
}
