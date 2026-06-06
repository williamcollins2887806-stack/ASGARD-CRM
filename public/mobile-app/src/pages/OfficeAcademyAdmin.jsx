import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';

const C = {
  bg: '#0d0d12', card: '#16161f', gold: '#c8a84b',
  green: '#22c55e', red: '#ef4444', amber: '#f59e0b',
  blue: '#3b82f6', rune: '#7b61ff', text: '#e8e8f0', muted: '#6b7280',
};

const TRACK_LABELS = {
  pm: '⚙️ PM', hr: '👥 HR', finance: '💰 Финансы',
  procurement: '📦 Закупки', management: '🏛️ Управление', all: '📚 Общие',
};

const STATUS_META = {
  draft:     { label: 'Черновик',    color: C.amber, icon: '📝' },
  published: { label: 'Опубликован', color: C.green, icon: '✅' },
  archived:  { label: 'Архив',       color: C.muted, icon: '📦' },
};

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)',
  display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000,
};

// ── Lesson Preview Modal ────────────────────────────────────────
function PreviewModal({ lessonId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoad] = useState(true);

  useEffect(() => {
    api.get(`/office-academy/admin/lessons/${lessonId}/preview`)
      .then(setData)
      .finally(() => setLoad(false));
  }, [lessonId]);

  if (loading) return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ background: C.bg, borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 480, padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 28 }}>⏳</div>
      </div>
    </div>
  );

  const { lesson, questions = [] } = data || {};
  if (!lesson) return null;
  const blocks = lesson.blocks || [];

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.bg, borderRadius: '16px 16px 0 0', width: '100%',
        maxWidth: 480, maxHeight: '90vh', overflowY: 'auto', border: '1px solid #ffffff15',
      }}>
        {/* Header */}
        <div style={{
          background: `linear-gradient(135deg, ${lesson.cover_color || '#1e1e3a'} 0%, ${C.card} 100%)`,
          borderRadius: '16px 16px 0 0', padding: '20px 16px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>{lesson.cover_icon}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', textTransform: 'uppercase', letterSpacing: 1 }}>
            {lesson.saga}
          </div>
          <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', marginTop: 4 }}>{lesson.title}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginTop: 6 }}>
            {TRACK_LABELS[lesson.track]} · ⏱ {lesson.estimated_minutes} мин · {questions.length} вопросов
          </div>
        </div>

        {/* Content blocks */}
        <div style={{ padding: '16px', maxHeight: '40vh', overflowY: 'auto' }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.gold, marginBottom: 10, textTransform: 'uppercase' }}>
            📖 Контент ({blocks.length} блоков)
          </div>
          {blocks.length === 0 ? (
            <div style={{ fontSize: 13, color: C.muted, textAlign: 'center', padding: 20 }}>Контент пуст</div>
          ) : blocks.map((b, i) => (
            <div key={i} style={{
              background: '#ffffff06', borderRadius: 8, padding: '8px 10px', marginBottom: 6,
              fontSize: 12, color: C.muted, lineHeight: 1.5,
            }}>
              <span style={{ color: C.rune, fontWeight: 700 }}>[{b.type}]</span>{' '}
              {b.title || b.text || b.content || (b.items ? `${b.items.length} элементов` : '—')}
            </div>
          ))}
        </div>

        {/* Questions */}
        <div style={{ padding: '0 16px 16px', maxHeight: '30vh', overflowY: 'auto' }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.gold, marginBottom: 10, textTransform: 'uppercase' }}>
            ❓ Вопросы ({questions.length})
          </div>
          {questions.map((q, i) => {
            const opts = Array.isArray(q.options) ? q.options : [];
            const correctIdx = opts.findIndex(o => o.is_correct);
            return (
              <div key={q.id} style={{
                background: '#ffffff06', borderRadius: 8, padding: '10px 12px', marginBottom: 8,
              }}>
                <div style={{ fontSize: 12, color: C.text, lineHeight: 1.5, marginBottom: 6 }}>
                  <span style={{ color: C.muted }}>{i + 1}.</span> {q.question_text}
                </div>
                {opts.map((opt, oi) => (
                  <div key={oi} style={{
                    fontSize: 11, color: oi === correctIdx ? C.green : C.muted,
                    padding: '2px 0', paddingLeft: 12,
                  }}>
                    {oi === correctIdx ? '✓' : '○'} {opt.text}
                  </div>
                ))}
                {q.correct_explanation && (
                  <div style={{ fontSize: 11, color: C.blue, marginTop: 4, fontStyle: 'italic' }}>
                    💡 {q.correct_explanation}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ padding: '0 16px 16px' }}>
          <button onClick={onClose} style={{
            width: '100%', padding: '12px 0', borderRadius: 12,
            background: C.card, border: `1px solid ${C.rune}40`,
            color: C.rune, fontWeight: 700, fontSize: 14, cursor: 'pointer',
          }}>Закрыть превью</button>
        </div>
      </div>
    </div>
  );
}

// ── Approve Modal ───────────────────────────────────────────────
function ApproveModal({ lesson, onClose, onSave }) {
  const [status, setStatus]       = useState(lesson.status === 'draft' ? 'published' : lesson.status);
  const [mandatory, setMandatory] = useState(!!lesson.is_mandatory);
  const [releaseDate, setDate]    = useState(lesson.release_date ? lesson.release_date.split('T')[0] : '');
  const [saving, setSaving]       = useState(false);
  const [msg, setMsg]             = useState('');

  async function save() {
    setSaving(true);
    try {
      const body = { status, is_mandatory: mandatory };
      if (releaseDate) body.release_date = releaseDate;
      await api.patch(`/office-academy/admin/lessons/${lesson.id}`, body);
      onSave();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#1a1a2e', borderRadius: '20px 20px 0 0',
        padding: '20px 16px 40px', width: '100%', maxWidth: 480,
      }}>
        <div style={{ width: 36, height: 4, background: '#ffffff20', borderRadius: 2, margin: '0 auto 20px' }} />
        <div style={{ fontSize: 16, fontWeight: 800, color: C.text, marginBottom: 4 }}>
          {lesson.cover_icon} {lesson.title}
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 20 }}>
          {TRACK_LABELS[lesson.track]} · Месяц #{lesson.month_number}
          {' · '}{lesson.questions_count} вопросов · {lesson.passed_count} прошли
        </div>

        <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Статус</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {['draft', 'published', 'archived'].map(s => {
            const meta = STATUS_META[s];
            return (
              <button key={s} onClick={() => setStatus(s)} style={{
                flex: 1, padding: '9px 0', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${status === s ? meta.color + '60' : '#ffffff10'}`,
                background: status === s ? meta.color + '18' : 'transparent',
                color: status === s ? meta.color : C.muted,
              }}>{meta.icon} {meta.label}</button>
            );
          })}
        </div>

        <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Тип урока</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button onClick={() => setMandatory(true)} style={{
            flex: 1, padding: '9px 0', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            border: `1px solid ${mandatory ? C.red + '60' : '#ffffff10'}`,
            background: mandatory ? C.red + '18' : 'transparent',
            color: mandatory ? C.red : C.muted,
          }}>⚠️ Обязательный</button>
          <button onClick={() => setMandatory(false)} style={{
            flex: 1, padding: '9px 0', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            border: `1px solid ${!mandatory ? C.green + '60' : '#ffffff10'}`,
            background: !mandatory ? C.green + '18' : 'transparent',
            color: !mandatory ? C.green : C.muted,
          }}>📖 Необязательный</button>
        </div>

        <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Дата публикации</div>
        <input type="date" value={releaseDate} onChange={e => setDate(e.target.value)} style={{
          width: '100%', background: C.card, border: '1px solid #ffffff15', borderRadius: 10,
          padding: '10px 12px', color: C.text, fontSize: 14, marginBottom: 20, boxSizing: 'border-box',
        }} />

        {msg && <div style={{ color: C.red, fontSize: 12, marginBottom: 12, textAlign: 'center' }}>{msg}</div>}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={save} disabled={saving} style={{
            flex: 2, padding: '14px 0', borderRadius: 14,
            background: status === 'published' ? C.green : C.rune,
            color: status === 'published' ? '#000' : '#fff',
            fontWeight: 800, fontSize: 15, border: 'none', cursor: 'pointer',
            opacity: saving ? .7 : 1,
          }}>
            {saving ? '...' : status === 'published' ? '✅ Опубликовать' : 'Сохранить'}
          </button>
          <button onClick={onClose} style={{
            flex: 1, padding: '14px 0', borderRadius: 14, background: '#ffffff0d',
            color: C.muted, fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer',
          }}>Отмена</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN ADMIN PAGE
// ═══════════════════════════════════════════════════════════════
export default function OfficeAcademyAdmin() {
  const navigate = useNavigate();
  const [lessons, setLessons]     = useState([]);
  const [loading, setLoad]        = useState(true);
  const [tab, setTab]             = useState('draft');
  const [modal, setModal]         = useState(null);
  const [previewId, setPreview]   = useState(null);
  const [msg, setMsg]             = useState('');
  const [bulking, setBulking]     = useState(false);

  const load = () => {
    setLoad(true);
    api.get('/office-academy/admin/drafts')
      .then(d => setLessons(d.lessons || []))
      .catch(e => setMsg(e.message))
      .finally(() => setLoad(false));
  };

  useEffect(() => { load(); }, []);

  function saved() {
    setModal(null);
    setMsg('✅ Сохранено');
    load();
    setTimeout(() => setMsg(''), 3000);
  }

  const filtered = lessons.filter(l => l.status === tab);
  const counts = {
    draft:     lessons.filter(l => l.status === 'draft').length,
    published: lessons.filter(l => l.status === 'published').length,
    archived:  lessons.filter(l => l.status === 'archived').length,
  };

  // Unique draft months for bulk publish
  const draftMonths = [...new Set(lessons.filter(l => l.status === 'draft').map(l => l.month_number))].sort((a, b) => b - a);

  async function handleBulkPublish(monthNumber) {
    if (!confirm(`Опубликовать все черновики за месяц #${monthNumber}?`)) return;
    setBulking(true);
    try {
      const res = await api.post('/office-academy/admin/bulk-publish', { month_number: monthNumber });
      setMsg(`🚀 Опубликовано: ${res.published} свитков`);
      load();
      setTimeout(() => setMsg(''), 4000);
    } catch (e) {
      setMsg('❌ ' + e.message);
    } finally {
      setBulking(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ padding: '52px 16px 16px', background: 'linear-gradient(180deg, #0d0d2e 0%, transparent 100%)' }}>
        <button onClick={() => navigate('/office-academy')}
          style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 14, marginBottom: 10, padding: 0 }}>
          ← Залы Асгарда
        </button>
        <div style={{ fontSize: 22, fontWeight: 900, color: C.text }}>⚙️ Управление Академией</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>Проверка и публикация свитков от Мимира</div>
      </div>

      <div style={{ padding: '0 16px' }}>
        {msg && (
          <div style={{
            background: msg.startsWith('❌') ? C.red + '12' : C.green + '12',
            border: `1px solid ${msg.startsWith('❌') ? C.red : C.green}35`,
            borderRadius: 12, padding: '10px 14px', marginBottom: 12,
            fontSize: 13, color: msg.startsWith('❌') ? C.red : C.green, textAlign: 'center',
          }}>{msg}</div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {[
            { id: 'draft',     label: 'Черновики', color: C.amber },
            { id: 'published', label: 'Активные',  color: C.green },
            { id: 'archived',  label: 'Архив',     color: C.muted },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, padding: '8px 4px', borderRadius: 10, cursor: 'pointer',
              border: `1px solid ${tab === t.id ? t.color + '60' : '#ffffff0d'}`,
              background: tab === t.id ? t.color + '18' : 'transparent',
              color: tab === t.id ? t.color : C.muted,
              fontWeight: tab === t.id ? 700 : 400, fontSize: 12,
            }}>
              {t.label}
              {counts[t.id] > 0 && (
                <span style={{
                  marginLeft: 4, background: t.color + '30',
                  borderRadius: 10, padding: '1px 5px', fontSize: 10, fontWeight: 800,
                }}>{counts[t.id]}</span>
              )}
            </button>
          ))}
        </div>

        {/* Bulk publish */}
        {tab === 'draft' && draftMonths.length > 0 && (
          <div style={{ marginBottom: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {draftMonths.map(m => {
              const count = lessons.filter(l => l.status === 'draft' && l.month_number === m).length;
              return (
                <button key={m} onClick={() => handleBulkPublish(m)} disabled={bulking} style={{
                  padding: '8px 14px', borderRadius: 10,
                  background: C.green + '18', border: `1px solid ${C.green}40`,
                  color: C.green, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  opacity: bulking ? .6 : 1,
                }}>
                  🚀 Месяц #{m} ({count} шт)
                </button>
              );
            })}
          </div>
        )}

        {/* Lesson cards */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>
            <div style={{ fontSize: 28 }}>⏳</div>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: C.muted }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>{tab === 'draft' ? '✅' : '📭'}</div>
            <div style={{ fontSize: 14 }}>
              {tab === 'draft' ? 'Нет черновиков на проверке' : 'Нет свитков'}
            </div>
          </div>
        ) : (
          filtered.map(l => {
            const sm = STATUS_META[l.status];
            return (
              <div key={l.id} style={{
                background: C.card,
                border: `1px solid ${l.status === 'draft' ? C.amber + '30' : '#ffffff0d'}`,
                borderRadius: 16, padding: '14px 16px', marginBottom: 10,
              }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{
                    fontSize: 28, width: 44, height: 44, display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    background: l.cover_color || '#1e1e3a', borderRadius: 12, flexShrink: 0,
                  }}>{l.cover_icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4, lineHeight: 1.3 }}>
                      {l.title}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: sm.color,
                        background: sm.color + '18', borderRadius: 6, padding: '1px 6px',
                      }}>{sm.icon} {sm.label}</span>
                      <span style={{
                        fontSize: 10, color: C.muted, background: '#ffffff08',
                        borderRadius: 6, padding: '1px 6px',
                      }}>{TRACK_LABELS[l.track]}</span>
                      {l.is_mandatory && (
                        <span style={{ fontSize: 10, color: C.red, background: C.red + '15', borderRadius: 6, padding: '1px 6px' }}>
                          Обяз.
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted }}>
                      #{l.month_number}
                      {l.generated_by === 'mimir' ? ' · 🤖 Мимир' : ' · ✍️ Ручной'}
                      {' · '}{l.questions_count} вопр.
                      {l.passed_count > 0 && ` · ✓ ${l.passed_count}`}
                      {l.release_date && ` · ${fmtDate(l.release_date)}`}
                    </div>
                  </div>
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button onClick={() => setPreview(l.id)} style={{
                    flex: 1, padding: '8px 0', borderRadius: 10,
                    background: C.rune + '15', border: `1px solid ${C.rune}30`,
                    color: C.rune, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  }}>👁️ Превью</button>
                  <button onClick={() => setModal(l)} style={{
                    flex: 1, padding: '8px 0', borderRadius: 10,
                    background: l.status === 'draft' ? C.green + '15' : C.card,
                    border: `1px solid ${l.status === 'draft' ? C.green + '30' : '#ffffff0d'}`,
                    color: l.status === 'draft' ? C.green : C.muted,
                    fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  }}>{l.status === 'draft' ? '✅ Проверить' : '✏️ Изменить'}</button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modals */}
      {previewId && <PreviewModal lessonId={previewId} onClose={() => setPreview(null)} />}
      {modal && <ApproveModal lesson={modal} onClose={() => setModal(null)} onSave={saved} />}
    </div>
  );
}
