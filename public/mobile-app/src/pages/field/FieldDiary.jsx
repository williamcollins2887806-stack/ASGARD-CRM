import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import {
  ArrowLeft, BookOpen, Star, Edit3, Check, ChevronDown, Moon, Sun, Laugh, Smile, Meh, Frown, Angry, NotebookPen,
} from 'lucide-react';
import { Card, IconTile, KeyButton, Chip, Segmented, EmptyState, BottomSheet, SectionLabel } from '@/components/field/ui';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { formatMoney } from '@/lib/utils';
import './field-screens.css';

const MOODS = [
  { id: 'great',   Icon: Laugh, label: 'Отлично',   color: 'var(--ok)' },
  { id: 'good',    Icon: Smile, label: 'Хорошо',    color: 'var(--ok)' },
  { id: 'neutral', Icon: Meh,   label: 'Нейтрально', color: 'var(--value)' },
  { id: 'tired',   Icon: Frown, label: 'Устал',      color: 'var(--value)' },
  { id: 'hard',    Icon: Angry, label: 'Тяжело',     color: 'var(--danger-ink)' },
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
          aria-label={`Оценка ${n}`}
          style={{
            color: n <= rating ? 'var(--value-ink)' : 'var(--text-tertiary)',
            lineHeight: 1, background: 'none', border: 'none',
            cursor: onRate ? 'pointer' : 'default', padding: 0,
            opacity: n <= rating ? 1 : 0.35,
          }}>
          <Star size={size} strokeWidth={2.2} fill={n <= rating ? 'currentColor' : 'none'} />
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
    <BottomSheet open onClose={onClose} title="Запись в дневник">
      <div className="space-y-4 pb-2">
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {fmt(shift.date)} · {shift.work_title || shift.object_name || ''}
        </p>

        {/* Mood */}
        <div>
          <SectionLabel>Как прошла смена?</SectionLabel>
          <div className="flex gap-2 flex-wrap">
            {MOODS.map((m) => (
              <button key={m.id}
                onClick={() => { haptic.light(); setMood(mood === m.id ? null : m.id); }}
                className="flex flex-col items-center px-3 py-2 rounded-xl transition-all"
                style={{
                  backgroundColor: mood === m.id ? `color-mix(in oklab, ${m.color} 13%, transparent)` : 'var(--bg-surface-alt)',
                  border: `1.5px solid ${mood === m.id ? m.color : 'var(--tile-brd)'}`,
                }}>
                <m.Icon size={22} strokeWidth={2.2} style={{ color: mood === m.id ? m.color : 'var(--text-tertiary)' }} />
                <span style={{ fontSize: 9, color: mood === m.id ? m.color : 'var(--text-tertiary)', marginTop: 2 }}>{m.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Rating */}
        <div>
          <SectionLabel>Оценка смены</SectionLabel>
          <Stars rating={rating} onRate={(n) => { haptic.light(); setRating(n === rating ? 0 : n); }} size={28} />
        </div>

        {/* Text */}
        <div>
          <SectionLabel>Заметки</SectionLabel>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Что запомнилось? Что было сложно? Что хорошего произошло..."
            rows={4}
            className="w-full rounded-xl p-3 text-sm resize-none"
            style={{
              backgroundColor: 'var(--bg-surface-alt)',
              border: '1px solid var(--tile-brd)',
              color: 'var(--text-primary)',
              outline: 'none',
            }}
          />
          <p className="text-xs mt-1 text-right" style={{ color: 'var(--text-tertiary)' }}>{text.length}/500</p>
        </div>

        <KeyButton tone="value" block icon={Check} onClick={save} disabled={saving}>
          {saving ? 'Сохраняю...' : 'Сохранить запись'}
        </KeyButton>
      </div>
    </BottomSheet>
  );
}

function ShiftCard({ shift, onEdit }) {
  const haptic = useHaptic();
  const mood = MOODS.find((m) => m.id === shift.diary_mood);
  const hasDiary = shift.diary_text || shift.diary_mood || shift.diary_rating;

  return (
    <Card variant="raised" className="overflow-hidden" style={{
      borderColor: hasDiary ? `color-mix(in oklab, ${mood?.color || 'var(--value)'} 25%, transparent)` : undefined,
    }}>
      {/* Shift header */}
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-2">
          {shift.shift === 'night'
            ? <IconTile icon={Moon} tone="neutral" size={32} />
            : <IconTile icon={Sun} tone="value" size={32} />}
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{fmt(shift.date)}</p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {shift.work_title || shift.object_name || shift.city || '—'}
              {shift.hours_worked ? ` · ${Math.round(shift.hours_worked * 10) / 10}ч` : ''}
              {shift.amount_earned ? ` · ${formatMoney(shift.amount_earned)}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {mood && <mood.Icon size={20} strokeWidth={2.2} style={{ color: mood.color }} aria-label={mood.label} />}
          {shift.diary_rating > 0 && (
            <Stars rating={shift.diary_rating} size={13} />
          )}
          <button onClick={() => { haptic.light(); onEdit(shift); }}
            className="p-1.5 rounded-lg" aria-label="Редактировать запись"
            style={{ backgroundColor: hasDiary ? 'var(--bg-surface-alt)' : 'color-mix(in oklab, var(--value) 13%, transparent)',
              color: hasDiary ? 'var(--text-tertiary)' : 'var(--value-ink)' }}>
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
          className="w-full px-3 pb-3 text-xs text-left flex items-center gap-1.5"
          style={{ color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer' }}>
          <NotebookPen size={12} strokeWidth={2.4} aria-hidden />
          Добавить запись о смене...
        </button>
      )}
    </Card>
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
      <div className="fs-root p-4" style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}>
        <SkeletonList count={5} />
      </div>
    );
  }

  return (
    <div className="fs-root" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
      <div className="fs-scene" aria-hidden><span className="fs-orb fs-orb--a" /><span className="fs-orb fs-orb--b" /></div>

      <div className="fs-content space-y-3">
        {/* Header */}
        <div className="fs-head">
          <button onClick={() => navigate('/field/profile')} className="fs-head__btn" aria-label="Назад">
            <ArrowLeft size={20} strokeWidth={2.3} />
          </button>
          <IconTile icon={BookOpen} tone="value" size={42} />
          <div>
            <h1 className="fs-head__title">Дневник смен</h1>
            <p className="fs-head__sub">{total} смен · {withNotes} с записями</p>
          </div>
        </div>

        {/* Filter */}
        <Segmented
          items={[{ value: 'all', label: 'Все смены' }, { value: 'with_notes', label: 'С записями' }]}
          value={filter}
          onChange={(v) => { haptic.light(); setFilter(v); }}
        />

        {/* Shifts */}
        {displayed.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title={filter === 'with_notes' ? 'Нет смен с записями' : 'Нет завершённых смен'}
            description="Нажми карандаш у любой смены, чтобы добавить запись"
          />
        ) : (
          displayed.map((s) => (
            <ShiftCard key={s.id} shift={s} onEdit={setEditing} />
          ))
        )}

        {/* Load more */}
        {filter === 'all' && shifts.length < total && (
          <KeyButton
            tone="neutral"
            block
            icon={ChevronDown}
            onClick={() => { haptic.light(); load(shifts.length, true); }}
            disabled={loadingMore}
          >
            {loadingMore ? 'Загружаю...' : `Ещё смены (${total - shifts.length})`}
          </KeyButton>
        )}
      </div>

      {/* Edit sheet */}
      {editing && (
        <DiaryModal shift={editing} onClose={() => setEditing(null)} onSave={handleSave} />
      )}
    </div>
  );
}
