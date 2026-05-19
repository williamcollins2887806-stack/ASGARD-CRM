import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { ArrowLeft, BookOpen, Star, Edit3, Check, X, ChevronDown } from 'lucide-react';

const MOODS = [
  { id: 'great',   emoji: '😄', label: 'Отлично',   color: '#22c55e' },
  { id: 'good',    emoji: '🙂', label: 'Хорошо',    color: '#84cc16' },
  { id: 'neutral', emoji: '😐', label: 'Нейтрально', color: '#f59e0b' },
  { id: 'tired',   emoji: '😔', label: 'Устал',      color: '#f97316' },
  { id: 'hard',    emoji: '😤', label: 'Тяжело',     color: '#ef4444' },
];

function fmt(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });
}

function Stars({ rating, onRate, size = 18 }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} onClick={() => onRate && onRate(n)}
          style={{ color: n <= rating ? '#fbbf24' : 'var(--border-norse)', fontSize: size, lineHeight: 1, background: 'none', border: 'none', cursor: onRate ? 'pointer' : 'default', padding: 0 }}>
          ★
        </button>
      ))}
    </div>
  );
}

function DiaryModal({ shift, onClose, onSave }) {
  const haptic = useHaptic();
  const [text, setText] = useState(shift.diary_text || '');
  const [mood, setMood] = useState(shift.diary_mood || null);
  const [rating, setRating] = useState(shift.diary_rating || 0);
  const [saving, setSaving] = useState(false);

  async function save() {
    haptic.medium(); setSaving(true);
    try {
      await fieldApi.patch(`/checkin/diary/${shift.id}`, { text, mood, rating });
      onSave({ ...shift, diary_text: text, diary_mood: mood, diary_rating: rating });
    } catch { /* silent */ }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="w-full rounded-t-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto"
        style={{ backgroundColor: 'var(--bg-elevated)' }} onClick={(e) => e.stopPropagation()}>

        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>Запись в дневник</h3>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {fmt(shift.date)} · {shift.work_title || shift.object_name || ''}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-tertiary)' }}>
            <X size={18} />
          </button>
        </div>

        {/* Mood */}
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-tertiary)' }}>КАК ПРОШЛА СМЕНА?</p>
          <div className="flex gap-2 flex-wrap">
            {MOODS.map((m) => (
              <button key={m.id}
                onClick={() => { haptic.light(); setMood(mood === m.id ? null : m.id); }}
                className="flex flex-col items-center px-3 py-2 rounded-xl transition-all"
                style={{
                  backgroundColor: mood === m.id ? m.color + '20' : 'var(--bg-primary)',
                  border: `1.5px solid ${mood === m.id ? m.color : 'var(--border-norse)'}`,
                }}>
                <span style={{ fontSize: 22 }}>{m.emoji}</span>
                <span style={{ fontSize: 9, color: mood === m.id ? m.color : 'var(--text-tertiary)', marginTop: 2 }}>{m.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Rating */}
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-tertiary)' }}>ОЦЕНКА СМЕНЫ</p>
          <Stars rating={rating} onRate={(n) => { haptic.light(); setRating(n === rating ? 0 : n); }} size={28} />
        </div>

        {/* Text */}
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-tertiary)' }}>ЗАМЕТКИ</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Что запомнилось? Что было сложно? Что хорошего произошло..."
            rows={4}
            className="w-full rounded-xl p-3 text-sm resize-none"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-norse)',
              color: 'var(--text-primary)',
              outline: 'none',
            }}
          />
          <p className="text-xs mt-1 text-right" style={{ color: 'var(--text-tertiary)' }}>{text.length}/500</p>
        </div>

        <button onClick={save} disabled={saving}
          className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2"
          style={{ background: 'linear-gradient(135deg, var(--gold), #b8860b)', color: '#fff' }}>
          {saving ? 'Сохраняю...' : <><Check size={16} /> Сохранить запись</>}
        </button>
      </div>
    </div>
  );
}

function ShiftCard({ shift, onEdit }) {
  const haptic = useHaptic();
  const mood = MOODS.find((m) => m.id === shift.diary_mood);
  const hasDiary = shift.diary_text || shift.diary_mood || shift.diary_rating;

  return (
    <div className="rounded-xl overflow-hidden" style={{
      backgroundColor: 'var(--bg-elevated)',
      border: hasDiary ? `1px solid ${mood?.color || 'var(--gold)'}40` : '1px solid var(--border-norse)',
    }}>
      {/* Shift header */}
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 16 }}>{shift.shift === 'night' ? '🌙' : '☀️'}</span>
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{fmt(shift.date)}</p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {shift.work_title || shift.object_name || shift.city || '—'}
              {shift.hours_worked ? ` · ${Math.round(shift.hours_worked * 10) / 10}ч` : ''}
              {shift.amount_earned ? ` · ${Math.round(shift.amount_earned).toLocaleString('ru-RU')}₽` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {mood && <span style={{ fontSize: 20 }}>{mood.emoji}</span>}
          {shift.diary_rating > 0 && (
            <Stars rating={shift.diary_rating} size={13} />
          )}
          <button onClick={() => { haptic.light(); onEdit(shift); }}
            className="p-1.5 rounded-lg"
            style={{ backgroundColor: hasDiary ? 'var(--bg-primary)' : 'var(--gold)' + '20',
              color: hasDiary ? 'var(--text-tertiary)' : 'var(--gold)' }}>
            <Edit3 size={14} />
          </button>
        </div>
      </div>

      {/* Diary text */}
      {shift.diary_text && (
        <div className="px-3 pb-3">
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
            {shift.diary_text}
          </p>
        </div>
      )}

      {/* Empty hint */}
      {!hasDiary && (
        <button onClick={() => { haptic.light(); onEdit(shift); }}
          className="w-full px-3 pb-3 text-xs text-left"
          style={{ color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer' }}>
          ✏️ Добавить запись о смене...
        </button>
      )}
    </div>
  );
}

export default function FieldDiary() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('all'); // all | with_notes

  const load = useCallback(async (offset = 0, append = false) => {
    try {
      if (offset === 0) setLoading(true); else setLoadingMore(true);
      const res = await fieldApi.get(`/checkin/diary?limit=20&offset=${offset}`);
      if (append) setShifts((p) => [...p, ...(res.shifts || [])]);
      else setShifts(res.shifts || []);
      setTotal(res.total || 0);
    } catch { /* silent */ }
    finally { setLoading(false); setLoadingMore(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleSave(updated) {
    setShifts((prev) => prev.map((s) => s.id === updated.id ? updated : s));
    setEditing(null);
  }

  const displayed = filter === 'with_notes'
    ? shifts.filter((s) => s.diary_text || s.diary_mood || s.diary_rating)
    : shifts;

  const withNotes = shifts.filter((s) => s.diary_text || s.diary_mood || s.diary_rating).length;

  if (loading) {
    return (
      <div className="p-4 space-y-3 animate-pulse">
        <div className="h-12 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-20 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />
        ))}
      </div>
    );
  }

  return (
    <div className="p-4 pb-24 space-y-3" style={{ backgroundColor: 'var(--bg-primary)', minHeight: '100vh' }}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/field/profile')} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
        </button>
        <BookOpen size={22} style={{ color: 'var(--gold)' }} />
        <div>
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Дневник смен</h1>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{total} смен · {withNotes} с записями</p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {[['all', 'Все смены'], ['with_notes', 'С записями']].map(([val, label]) => (
          <button key={val} onClick={() => { haptic.light(); setFilter(val); }}
            className="px-3 py-1.5 rounded-full text-xs font-medium"
            style={{
              backgroundColor: filter === val ? 'var(--gold)' : 'var(--bg-elevated)',
              color: filter === val ? '#fff' : 'var(--text-secondary)',
            }}>
            {label}
          </button>
        ))}
      </div>

      {/* Shifts */}
      {displayed.length === 0 ? (
        <div className="text-center py-16">
          <span className="text-4xl">📖</span>
          <p className="mt-3 font-medium" style={{ color: 'var(--text-secondary)' }}>
            {filter === 'with_notes' ? 'Нет смен с записями' : 'Нет завершённых смен'}
          </p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>
            Нажми ✏️ на любой смене чтобы добавить запись
          </p>
        </div>
      ) : (
        displayed.map((s) => (
          <ShiftCard key={s.id} shift={s} onEdit={setEditing} />
        ))
      )}

      {/* Load more */}
      {filter === 'all' && shifts.length < total && (
        <button onClick={() => { haptic.light(); load(shifts.length, true); }}
          disabled={loadingMore}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm"
          style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-norse)' }}>
          <ChevronDown size={16} className={loadingMore ? 'animate-spin' : ''} />
          {loadingMore ? 'Загружаю...' : `Ещё смены (${total - shifts.length})`}
        </button>
      )}

      {/* Edit modal */}
      {editing && (
        <DiaryModal shift={editing} onClose={() => setEditing(null)} onSave={handleSave} />
      )}
    </div>
  );
}
