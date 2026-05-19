import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';

const C = {
  bg: '#0d0d12', card: '#16161f', gold: '#c8a84b',
  green: '#22c55e', red: '#ef4444', amber: '#f59e0b',
  blue: '#3b82f6', rune: '#7b61ff', text: '#e8e8f0', muted: '#6b7280',
};

const TRACK_LABELS = {
  pm: 'PM', hr: 'HR', finance: 'Финансы',
  procurement: 'Закупки', management: 'Управление', all: 'Все',
};

const TRACK_COLORS = {
  pm: '#3b82f6', hr: '#22c55e', finance: '#f59e0b',
  procurement: '#ef4444', management: '#8b5cf6', all: '#6b7280',
};

const STATUS_META = {
  draft:     { label: 'Черновик',    color: '#f59e0b' },
  published: { label: 'Опубликован', color: '#22c55e' },
  archived:  { label: 'Архив',       color: '#6b7280' },
};

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

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
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 1000,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#1a1a2e', borderRadius: '20px 20px 0 0',
        padding: '20px 16px 40px', width: '100%', maxWidth: 480,
      }}>
        <div style={{ width: 36, height: 4, background: '#ffffff20', borderRadius: 2, margin: '0 auto 20px' }} />
        <div style={{ fontSize: 16, fontWeight: 800, color: C.text, marginBottom: 4 }}>
          {lesson.cover_icon} {lesson.title}
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 20 }}>
          Месяц {lesson.month_number} · {TRACK_LABELS[lesson.track] || lesson.track}
          {' · '}{lesson.questions_count} вопросов · {lesson.passed_count} прошли
        </div>

        <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Статус</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {['draft', 'published', 'archived'].map(s => (
            <button key={s} onClick={() => setStatus(s)} style={{
              flex: 1, padding: '9px 0', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              border: `1px solid ${status === s ? STATUS_META[s].color + '60' : '#ffffff10'}`,
              background: status === s ? STATUS_META[s].color + '18' : 'transparent',
              color: status === s ? STATUS_META[s].color : C.muted,
            }}>{STATUS_META[s].label}</button>
          ))}
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
            border: `1px solid ${!mandatory ? C.blue + '60' : '#ffffff10'}`,
            background: !mandatory ? C.blue + '18' : 'transparent',
            color: !mandatory ? C.blue : C.muted,
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

export default function OfficeAcademyAdmin() {
  const navigate = useNavigate();
  const [lessons, setLessons] = useState([]);
  const [loading, setLoad]    = useState(true);
  const [tab, setTab]         = useState('draft');
  const [modal, setModal]     = useState(null);
  const [msg, setMsg]         = useState('');

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
    setMsg('Сохранено');
    load();
    setTimeout(() => setMsg(''), 3000);
  }

  const filtered = lessons.filter(l => l.status === tab);
  const counts = {
    draft:     lessons.filter(l => l.status === 'draft').length,
    published: lessons.filter(l => l.status === 'published').length,
    archived:  lessons.filter(l => l.status === 'archived').length,
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, paddingBottom: 40 }}>
      <div style={{ padding: '52px 16px 16px', background: 'linear-gradient(180deg, #0d0d2e 0%, transparent 100%)' }}>
        <button onClick={() => navigate(-1)}
          style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 14, marginBottom: 10, padding: 0 }}>
          ← Назад
        </button>
        <div style={{ fontSize: 22, fontWeight: 900, color: C.text }}>🔧 Академия — Управление</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>Проверка и публикация уроков от Мимира</div>
      </div>

      <div style={{ padding: '0 16px' }}>
        {msg && (
          <div style={{
            background: C.green + '12', border: `1px solid ${C.green}35`,
            borderRadius: 12, padding: '10px 14px', marginBottom: 12,
            fontSize: 13, color: C.green, textAlign: 'center',
          }}>{msg}</div>
        )}

        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
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

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>
            <div style={{ fontSize: 28 }}>⏳</div>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: C.muted }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>{tab === 'draft' ? '✅' : '📭'}</div>
            <div style={{ fontSize: 14 }}>
              {tab === 'draft' ? 'Нет черновиков на проверке' : 'Нет уроков'}
            </div>
          </div>
        ) : (
          filtered.map(l => {
            const tc = TRACK_COLORS[l.track] || C.muted;
            return (
              <div key={l.id} style={{
                background: C.card,
                border: `1px solid ${l.status === 'draft' ? C.amber + '30' : '#ffffff0d'}`,
                borderRadius: 14, padding: '14px 16px', marginBottom: 10,
              }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ fontSize: 28, flexShrink: 0 }}>{l.cover_icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>
                      {l.title}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: tc,
                        background: tc + '18', border: `1px solid ${tc}35`,
                        borderRadius: 6, padding: '1px 5px',
                      }}>{TRACK_LABELS[l.track] || l.track}</span>
                      {l.is_mandatory && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: C.red, background: C.red + '15', borderRadius: 6, padding: '1px 5px' }}>
                          Обязательный
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted }}>
                      Месяц {l.month_number}
                      {l.generated_by === 'mimir' ? ' · 🤖 Мимир' : ' · ✍️ Ручной'}
                      {' · '}{l.questions_count} вопросов
                      {l.passed_count > 0 && ` · ✓ ${l.passed_count} прошли`}
                      {l.release_date && ` · ${fmtDate(l.release_date)}`}
                    </div>
                  </div>
                  <button onClick={() => setModal(l)} style={{
                    padding: '7px 12px', borderRadius: 10, flexShrink: 0,
                    border: `1px solid ${l.status === 'draft' ? C.amber + '50' : '#ffffff15'}`,
                    background: l.status === 'draft' ? C.amber + '15' : '#ffffff08',
                    color: l.status === 'draft' ? C.amber : C.muted,
                    fontWeight: 700, fontSize: 12, cursor: 'pointer',
                  }}>
                    {l.status === 'draft' ? 'Проверить' : 'Изменить'}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {modal && <ApproveModal lesson={modal} onClose={() => setModal(null)} onSave={saved} />}
    </div>
  );
}
