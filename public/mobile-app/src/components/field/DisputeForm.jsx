/**
 * DisputeForm — модалка создания разногласия по табелю.
 *
 * Props:
 *   workId        — обязательно
 *   workTitle     — для отображения "По работе: X"
 *   defaultMonth  — { year, month } если открыто из карточки месяца
 *   onClose       — () => void
 *   onSubmitted   — (dispute) => void после успешного создания
 */
import { useState } from 'react';
import { fieldApi } from '@/api/fieldClient';

const DISPUTE_TYPES = [
  { value: 'missing_shift',   icon: '📅', label: 'Не отмечена смена',         hint: 'Я работал в этот день, но в табеле смены нет' },
  { value: 'missing_travel',  icon: '🚗', label: 'Не учтена дорога',           hint: 'Не оплачен день переезда / дороги до объекта' },
  { value: 'missing_medical', icon: '🏥', label: 'Не учтён медосмотр',         hint: 'Проходил медосмотр — нет оплаты' },
  { value: 'missing_waiting', icon: '⏳', label: 'Не учтено ожидание/простой', hint: 'Был на объекте в простое — не учли' },
  { value: 'wrong_hours',     icon: '🕐', label: 'Неправильные часы',          hint: 'Часов отмечено меньше, чем работал' },
  { value: 'wrong_amount',    icon: '💰', label: 'Неправильная сумма',         hint: 'Сумма за смену меньше тарифа' },
  { value: 'wrong_per_diem',  icon: '🌙', label: 'Неправильные суточные',      hint: 'Суточные не начислены или меньше ставки' },
  { value: 'other',           icon: '❓', label: 'Другое',                     hint: 'Опишите проблему в комментарии' },
];

export default function DisputeForm({ workId, workTitle, defaultMonth, onClose, onSubmitted }) {
  const [type, setType] = useState('');
  const [date, setDate] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const useDate = Boolean(date);

  async function submit() {
    if (!type) { setError('Выберите тип проблемы'); return; }
    if (comment.trim().length < 10) { setError('Опишите проблему (минимум 10 символов)'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        work_id: workId,
        dispute_type: type,
        worker_comment: comment.trim(),
      };
      if (useDate) {
        payload.dispute_date = date;
      } else if (defaultMonth) {
        payload.dispute_month = defaultMonth.month;
        payload.dispute_year = defaultMonth.year;
      } else {
        const d = new Date();
        payload.dispute_month = d.getMonth() + 1;
        payload.dispute_year = d.getFullYear();
      }
      const resp = await fieldApi.post('/worker/disputes', payload);
      onSubmitted?.(resp.dispute);
      onClose?.();
    } catch (e) {
      setError(e?.message || 'Не удалось отправить');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'var(--bg-elevated, #16161f)',
        borderRadius: '20px 20px 0 0',
        padding: '20px 18px 28px',
        maxHeight: '92vh', overflowY: 'auto',
        animation: 'slideUp 0.25s ease',
      }}>
        <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary, #fff)' }}>
              🚩 Я не согласен
            </div>
            {workTitle && (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary, #6b7280)', marginTop: 3 }}>
                По работе: {workTitle}
              </div>
            )}
            {defaultMonth && !useDate && (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary, #6b7280)', marginTop: 2 }}>
                Месяц: {defaultMonth.month}/{defaultMonth.year}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.06)', border: 'none',
            borderRadius: 8, padding: '6px 10px', color: '#9ca3af',
            cursor: 'pointer', fontSize: 18,
          }}>×</button>
        </div>

        {/* Date (optional) */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, color: 'var(--text-secondary, #a1a1aa)', display: 'block', marginBottom: 6 }}>
            Конкретный день (если знаете) — иначе можно оставить пусто
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.04)', color: 'var(--text-primary, #fff)',
              fontSize: 14,
            }}
          />
        </div>

        {/* Type */}
        <div style={{ fontSize: 12, color: 'var(--text-secondary, #a1a1aa)', marginBottom: 8 }}>
          Что не так? <span style={{ color: '#ef4444' }}>*</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6, marginBottom: 16 }}>
          {DISPUTE_TYPES.map((t) => {
            const selected = type === t.value;
            return (
              <button
                key={t.value}
                onClick={() => setType(t.value)}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '10px 12px', borderRadius: 10,
                  border: `1px solid ${selected ? 'rgba(200,168,75,0.5)' : 'rgba(255,255,255,0.08)'}`,
                  background: selected ? 'rgba(200,168,75,0.1)' : 'rgba(255,255,255,0.03)',
                  cursor: 'pointer', textAlign: 'left', transition: 'all .12s',
                }}
              >
                <span style={{ fontSize: 18, flexShrink: 0 }}>{t.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: selected ? '#c8a84b' : 'var(--text-primary, #fff)' }}>
                    {t.label}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary, #6b7280)', marginTop: 2 }}>
                    {t.hint}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Comment */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, color: 'var(--text-secondary, #a1a1aa)', display: 'block', marginBottom: 6 }}>
            Опишите подробно <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
            placeholder="Например: 12 апреля работал смену с 8:00 до 20:00, но в табеле этого дня нет..."
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.04)', color: 'var(--text-primary, #fff)',
              fontSize: 14, resize: 'vertical', fontFamily: 'inherit',
            }}
          />
          <div style={{ fontSize: 10, color: 'var(--text-tertiary, #6b7280)', marginTop: 4 }}>
            {comment.length} символов (минимум 10)
          </div>
        </div>

        {error && (
          <div style={{
            padding: '10px 12px', borderRadius: 8,
            background: 'rgba(239,68,68,0.1)', color: '#ef4444',
            fontSize: 13, marginBottom: 12,
          }}>{error}</div>
        )}

        {/* Submit */}
        <button
          onClick={submit}
          disabled={submitting}
          style={{
            width: '100%', padding: '14px',
            background: submitting ? 'rgba(255,255,255,0.08)' : 'linear-gradient(135deg, #c8a84b, #e8c560)',
            color: submitting ? '#9ca3af' : '#0d0d12',
            border: 'none', borderRadius: 12,
            fontSize: 15, fontWeight: 800,
            cursor: submitting ? 'wait' : 'pointer',
          }}
        >
          {submitting ? 'Отправляю...' : '🚩 Отправить РП'}
        </button>

        <div style={{ fontSize: 11, color: 'var(--text-tertiary, #6b7280)', marginTop: 10, textAlign: 'center', lineHeight: 1.5 }}>
          РП получит уведомление и рассмотрит ваше обращение.
          <br />Ответ придёт сюда же — в раздел «По месяцам».
        </div>
      </div>
    </div>
  );
}
