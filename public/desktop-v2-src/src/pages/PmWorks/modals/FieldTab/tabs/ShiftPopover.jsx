/**
 * ShiftPopover — inline-редактор смены табеля.
 *
 * Источник: vanilla `field-tab.js:1521-1595` (функция `_shiftEditor`).
 *
 * Открывается при клике по ячейке дня. Привязан к якорю (td.fieldset)
 * через <Popover>, рендерится в портал → не обрезается overflow родителя.
 *
 * Поля:
 *  • Тип смены (☀ день / 🌙 ночь / ½ полсмены / 🚗 в пути / ⏳ ожидание)
 *  • Часы (auto-fill по типу, можно править вручную)
 *  • Баллы (auto-fill по типу, можно править)
 *  • Заработано (₽) — авто = баллы × point_value, можно править
 *
 * Колбэки:
 *  • onSave({ shift, hours_worked, hours_paid, day_rate, amount_earned, points })
 *  • onDelete() — есть только при редактировании существующей смены
 *  • onClose() — закрыть без сохранения
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Btn, Field } from '@/modals/parts';
import { SHIFT_TYPES, getShiftMeta } from './timesheetUtils';

export function ShiftPopover({
  anchorRef,
  open,
  initial = null,        // { shift, hours_worked, hours_paid, day_rate, amount_earned, points } или null = новая
  pointValue = 500,
  isNew = false,
  date,
  employeeName,
  onSave,
  onDelete,
  onClose
}) {
  const popRef = useRef(null);
  const [pos, setPos] = useState({ top: -9999, left: -9999 });

  // Начальный стейт
  const defShift = initial?.shift || 'day';
  const defMeta = getShiftMeta(defShift);
  const initPoints = initial?.points != null
    ? initial.points
    : (initial?.day_rate != null ? Math.round(parseFloat(initial.day_rate) / pointValue) : defMeta.defaultPts);

  const [shift, setShift] = useState(defShift);
  const [points, setPoints] = useState(initPoints);
  const [hours, setHours] = useState(initial?.hours_worked != null ? initial.hours_worked : defMeta.hours);
  const [amount, setAmount] = useState(initial?.amount_earned != null ? Math.round(initial.amount_earned) : initPoints * pointValue);
  const [userEditedAmount, setUserEditedAmount] = useState(false);
  const [userEditedPoints, setUserEditedPoints] = useState(false);
  const [userEditedHours, setUserEditedHours] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  // Позиционирование (без matchWidth — popover шире ячейки)
  useEffect(() => {
    if (!open) return;
    const recalc = () => {
      const a = anchorRef?.current;
      if (!a) return;
      const r = a.getBoundingClientRect();
      const popW = popRef.current?.offsetWidth || 280;
      const popH = popRef.current?.offsetHeight || 220;
      const margin = 8;
      // Вертикальный flip
      const spaceBelow = window.innerHeight - r.bottom;
      let top = (spaceBelow < popH + 16 && r.top > spaceBelow) ? Math.max(margin, r.top - popH - 6) : r.bottom + 6;
      // Горизонтальное выравнивание по центру ячейки
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

  // ESC + клик снаружи
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose?.(); }
      if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); doSave(); }
    };
    const onMouseDown = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) {
        // Не закрывать если клик по самой ячейке-якорю (двойной toggle защита)
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
  }, [open, onClose, shift, points, hours, amount]);

  // Фокус на инпут баллов при открытии
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 30);
    return () => clearTimeout(t);
  }, [open]);

  // Auto-fill при смене типа смены (если юзер не редактировал поля сам)
  const pickShift = (newShift) => {
    const meta = getShiftMeta(newShift);
    setShift(newShift);
    if (!userEditedPoints) {
      setPoints(meta.defaultPts);
      if (!userEditedAmount) setAmount(meta.defaultPts * pointValue);
    }
    if (!userEditedHours) setHours(meta.hours);
  };

  const onPointsChange = (v) => {
    const n = Math.max(0, Math.min(30, parseInt(v) || 0));
    setUserEditedPoints(true);
    setPoints(n);
    if (!userEditedAmount) setAmount(n * pointValue);
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
    if (points === 0 && !isNew) {
      // 0 баллов = удалить (vanilla parity: editCheckinCell deletes when pts=0)
      if (onDelete) {
        setSaving(true);
        try { await onDelete(); } finally { setSaving(false); }
      }
      return;
    }
    if (points === 0) {
      // Новая смена с 0 баллов — отмена
      onClose?.();
      return;
    }
    setSaving(true);
    try {
      await onSave({
        shift,
        hours_worked: hours,
        hours_paid: hours,
        day_rate: amount,           // bug-compat с vanilla: day_rate = total ₽, НЕ ставка
        amount_earned: amount,
        points
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
        {SHIFT_TYPES.map((st) => (
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
        <Field label="Баллы">
          <input
            ref={inputRef}
            type="number"
            className="m-input"
            value={points}
            min={0}
            max={30}
            step={1}
            onChange={(e) => onPointsChange(e.target.value)}
          />
        </Field>
        <Field label="Заработано ₽">
          <input
            type="text"
            inputMode="numeric"
            className="m-input"
            value={amount.toLocaleString('ru-RU')}
            onChange={(e) => onAmountChange(e.target.value)}
          />
        </Field>
      </div>

      <div className="ft-ts-pop-hint">
        {points > 0 ? <>= {points} × {pointValue.toLocaleString('ru-RU')} ₽ = <b>{(points * pointValue).toLocaleString('ru-RU')} ₽</b></> : 'Введите баллы'}
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
