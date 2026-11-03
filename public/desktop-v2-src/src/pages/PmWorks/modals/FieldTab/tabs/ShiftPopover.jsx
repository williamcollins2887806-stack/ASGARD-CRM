/**
 * ShiftPopover — inline-редактор смены табеля.
 *
 * С 01.11.2026: сумма в ₽ (шаг 10), без баллов и без ×pointValue на сохранении.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Btn, Field } from '@/modals/parts';
import { EDITABLE_SHIFT_TYPES, getShiftMeta } from './timesheetUtils';
import { snapRubStep10, fmtMoneyRub } from '@/lib/moneyCompact';

export function ShiftPopover({
  anchorRef,
  open,
  initial = null,        // { shift, hours_worked, hours_paid, day_rate, amount_earned } или null = новая
  isNew = false,
  date,
  employeeName,
  onSave,
  onDelete,
  onClose
}) {
  const popRef = useRef(null);
  const [pos, setPos] = useState({ top: -9999, left: -9999 });

  const defShift = initial?.shift || 'day';
  const defMeta = getShiftMeta(defShift);
  const initAmount = (() => {
    const raw = initial?.amount_earned ?? initial?.day_rate;
    if (raw != null && Number(raw) > 0) return snapRubStep10(raw);
    return snapRubStep10(defMeta.defaultRub || (defMeta.defaultPts || 0) * 500);
  })();

  const [shift, setShift] = useState(defShift);
  const [hours, setHours] = useState(initial?.hours_worked != null ? initial.hours_worked : defMeta.hours);
  const [amount, setAmount] = useState(initAmount);
  const [userEditedAmount, setUserEditedAmount] = useState(false);
  const [userEditedHours, setUserEditedHours] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const recalc = () => {
      const a = anchorRef?.current;
      if (!a) return;
      const r = a.getBoundingClientRect();
      const popW = popRef.current?.offsetWidth || 340;
      const popH = popRef.current?.offsetHeight || 260;
      const margin = 8;
      const spaceBelow = window.innerHeight - r.bottom;
      let top = (spaceBelow < popH + 16 && r.top > spaceBelow) ? Math.max(margin, r.top - popH - 6) : r.bottom + 6;
      let left = r.left + r.width / 2 - popW / 2;
      if (left + popW > window.innerWidth - margin) left = window.innerWidth - popW - margin;
      if (left < margin) left = margin;
      if (top + popH > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - popH - margin);
      setPos({ top, left });
    };
    recalc();
    const onScroll = () => recalc();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', recalc);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', recalc);
    };
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose?.(); }
      if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); doSave(); }
    };
    const onMouseDown = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) {
        if (anchorRef?.current && anchorRef.current.contains(e.target)) return;
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onMouseDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose, shift, hours, amount]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 30);
    return () => clearTimeout(t);
  }, [open]);

  const pickShift = (newShift) => {
    const meta = getShiftMeta(newShift);
    setShift(newShift);
    if (!userEditedAmount) {
      setAmount(snapRubStep10(meta.defaultRub || (meta.defaultPts || 0) * 500));
    }
    if (!userEditedHours) setHours(meta.hours);
  };

  const onHoursChange = (v) => {
    const n = Math.max(0, Math.min(24, parseFloat(v) || 0));
    setUserEditedHours(true);
    setHours(n);
  };
  const onAmountChange = (v) => {
    const n = Math.max(0, parseInt(String(v).replace(/\D/g, '')) || 0);
    setUserEditedAmount(true);
    setAmount(n);
  };

  async function doSave() {
    if (saving) return;
    const rub = snapRubStep10(amount);
    if (rub === 0 && !isNew) {
      if (onDelete) {
        setSaving(true);
        try { await onDelete(); } finally { setSaving(false); }
      }
      return;
    }
    if (rub === 0) {
      onClose?.();
      return;
    }
    setSaving(true);
    try {
      await onSave({
        shift,
        hours_worked: hours,
        hours_paid: hours,
        day_rate: rub,
        amount_earned: rub
      });
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return createPortal(
    <div
      ref={popRef}
      className="ft-ts-pop"
      role="dialog"
      aria-label={isNew ? 'Добавить смену' : 'Редактировать смену'}
      style={{ top: pos.top, left: pos.left }}
    >
      <div className="ft-ts-pop-head">
        <strong>{employeeName}</strong>
        <span className="ft-ts-pop-date">{formatDate(date)}</span>
      </div>

      <div className="ft-ts-pop-shifts" role="radiogroup" aria-label="Тип смены">
        {EDITABLE_SHIFT_TYPES.map((st) => (
          <button
            key={st.value}
            type="button"
            className={'ft-ts-pop-shift' + (shift === st.value ? ' on' : '')}
            onClick={() => pickShift(st.value)}
            title={st.label}
            role="radio"
            aria-checked={shift === st.value}
          >
            <span className="ic" aria-hidden="true">{st.icon}</span>
            <span className="lbl">{st.label}</span>
          </button>
        ))}
      </div>

      <div className="ft-ts-pop-grid">
        <Field label="Часы">
          <input
            type="number"
            className="m-input"
            value={hours}
            min={0}
            max={24}
            step={0.5}
            onChange={(e) => onHoursChange(e.target.value)}
          />
        </Field>
        <Field label="Сумма ₽">
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            className="m-input"
            value={amount.toLocaleString('ru-RU')}
            aria-label="Сумма в рублях"
            onChange={(e) => onAmountChange(e.target.value)}
            onBlur={() => setAmount(snapRubStep10(amount))}
          />
        </Field>
      </div>

      <div className="ft-ts-pop-hint">
        {amount > 0 ? <>К начислению: <b>{fmtMoneyRub(snapRubStep10(amount))}</b> (шаг 10 ₽)</> : 'Введите сумму'}
      </div>

      <div className="ft-ts-pop-foot">
        {!isNew && onDelete && (
          <Btn
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try { await onDelete(); } finally { setSaving(false); }
            }}
            title="Удалить смену"
          >
            🗑 Удалить
          </Btn>
        )}
        <div className="ml-auto" style={{ display: 'flex', gap: 6 }}>
          <Btn variant="ghost" size="sm" disabled={saving} onClick={() => onClose?.()}>Отмена</Btn>
          <Btn variant="primary" size="sm" disabled={saving} onClick={doSave}>
            {saving ? '⏳' : (isNew ? 'Добавить' : 'Сохранить')}
          </Btn>
        </div>
      </div>
    </div>,
    document.body
  );
}

function formatDate(d) {
  if (!d) return '';
  const [y, m, day] = String(d).slice(0, 10).split('-');
  const date = new Date(Number(y), Number(m) - 1, Number(day));
  const dow = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][date.getDay()];
  return `${dow}, ${day}.${m}.${y}`;
}
