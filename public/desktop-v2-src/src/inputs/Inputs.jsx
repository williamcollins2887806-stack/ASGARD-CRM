/**
 * Каталог полей ввода для CRM 2.0.
 *
 * Цель: заменить хаотичные vanilla-инпуты по всему проекту единым
 * визуально-согласованным набором.
 *
 * Что внутри:
 *   • Text / Password / Number / Email / Phone — однострочные
 *   • Textarea (auto-grow)
 *   • Money / INN — спец-форматирование
 *   • Search (с иконкой и clear-кнопкой)
 *   • Select (нативный + кастомный с поиском)
 *   • Combobox (autocomplete)
 *   • MultiSelect / TagInput (chips)
 *   • Radio group / Segmented control
 *   • Checkbox / Switch
 *   • Slider / Range
 *   • DatePicker (popover-календарь)
 *   • TimePicker
 *   • DateRange
 *   • Rating (звёзды)
 *   • Color picker
 *   • FileDrop (drag-drop)
 *   • PersonPicker (карточка с inline-поиском)
 */
import { useState, useRef, useEffect, cloneElement, isValidElement } from 'react';
import { Popover } from './Popover';

/* ─── Базовый wrapper для поля ─── */
export function Field({ label, required, help, error, children, htmlFor, id }) {
  // id для error/help — связываем с инпутом через aria-describedby если родитель пробросил `id`.
  // Если children — единственный React-элемент, прикрепляем aria-invalid и aria-describedby автоматически.
  const fid = id || htmlFor;
  const metaId = fid ? `${fid}-meta` : undefined;
  let childWithA11y = children;
  if (isValidElement(children)) {
    const extra = {};
    if (error && children.props['aria-invalid'] === undefined) extra['aria-invalid'] = true;
    if (metaId && !children.props['aria-describedby']) extra['aria-describedby'] = metaId;
    if (required && children.props['aria-required'] === undefined) extra['aria-required'] = true;
    if (Object.keys(extra).length) childWithA11y = cloneElement(children, extra);
  }
  return (
    <div className={'inp-field ' + (error ? 'has-err' : '')}>
      {label && (
        <label htmlFor={fid}>
          {label}
          {required && <span className="req" aria-hidden="true">*</span>}
          {required && <span className="sr-only"> (обязательно)</span>}
        </label>
      )}
      {childWithA11y}
      {(error || help) && (
        <div className={'inp-meta ' + (error ? 'err' : '')} id={metaId} role={error ? 'alert' : undefined}>
          {error && <span aria-hidden="true">⚠ </span>}
          {error || help}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * Текстовые однострочные
 * ═══════════════════════════════════════════════════════════════════════ */
export function TextInput({ icon, suffix, clearable, value, onChange, error, ...rest }) {
  return (
    <div className={'inp-wrap ' + (error ? 'has-err' : '')}>
      {icon && <span className="inp-icon" aria-hidden="true">{icon}</span>}
      <input
        className="inp-text"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
      {clearable && value && (
        <button type="button" className="inp-clear" onClick={() => onChange?.('')} aria-label="Очистить поле">×</button>
      )}
      {suffix && <span className="inp-suffix" aria-hidden="true">{suffix}</span>}
    </div>
  );
}

/* Password с toggle-eye */
export function PasswordInput({ value, onChange, ...rest }) {
  const [show, setShow] = useState(false);
  return (
    <div className="inp-wrap">
      <span className="inp-icon" aria-hidden="true">🔒</span>
      <input
        type={show ? 'text' : 'password'}
        className="inp-text"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        {...rest}
      />
      <button
        type="button"
        className="inp-suffix-btn"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Скрыть пароль' : 'Показать пароль'}
        aria-pressed={show}
      >
        <span aria-hidden="true">{show ? '🙈' : '👁'}</span>
      </button>
    </div>
  );
}

/* Number с +/- */
export function NumberInput({ value, onChange, min, max, step = 1, ...rest }) {
  const num = Number(value) || 0;
  const inc = () => onChange?.(String(Math.min(max ?? Infinity, num + step)));
  const dec = () => onChange?.(String(Math.max(min ?? -Infinity, num - step)));
  return (
    <div className="inp-wrap">
      <button type="button" className="inp-icon-btn" onClick={dec} aria-label="Уменьшить">−</button>
      <input
        type="number"
        className="inp-text t-center"

        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        {...rest}
      />
      <button type="button" className="inp-icon-btn" onClick={inc} aria-label="Увеличить">+</button>
    </div>
  );
}

/* Money — авто-форматирование */
export function MoneyInput({ value, onChange, currency = '₽', ...rest }) {
  const formatted = value ? Number(value).toLocaleString('ru-RU') : '';
  return (
    <div className="inp-wrap">
      <span className="inp-icon">💰</span>
      <input
        type="text"
        className="inp-text"
        inputMode="numeric"
        value={formatted}
        onChange={(e) => {
          const raw = e.target.value.replace(/\D/g, '');
          onChange?.(raw);
        }}
        {...rest}
      />
      <span className="inp-suffix">{currency}</span>
    </div>
  );
}

/* INN — 10 или 12 цифр + контрольная сумма + валидация */
export function INNInput({ value, onChange, kind = 'any', ...rest }) {
  // G-4: используем общий валидатор с контрольной суммой (validators.js).
  // kind: 'any' (10/12), 'org' (только 10), 'person' (только 12 — для СЗ/ИП).
  // Импорт inline-функцией, чтобы избежать circular deps.
  const d = String(value || '').replace(/\D/g, '');
  const lenOk = kind === 'org' ? d.length === 10
              : kind === 'person' ? d.length === 12
              : d.length === 10 || d.length === 12;
  const ok = !value || (lenOk && innChecksumOk(d));
  const targetLen = kind === 'org' ? 10 : kind === 'person' ? 12 : (d.length > 10 ? 12 : 10);
  return (
    <div className={'inp-wrap ' + (!ok ? 'has-err' : '')}>
      <span className="inp-icon">🏢</span>
      <input
        type="text"
        className="inp-text"
        inputMode="numeric"
        value={value}
        maxLength={kind === 'org' ? 10 : 12}
        onChange={(e) => onChange?.(e.target.value.replace(/\D/g, ''))}
        placeholder={kind === 'org' ? '10 цифр' : kind === 'person' ? '12 цифр' : '10 или 12 цифр'}
        {...rest}
      />
      <span className={'inp-pill ' + (ok && value ? 'ok' : '')}>
        {value ? `${d.length}/${targetLen}` : '—'}
      </span>
    </div>
  );
}

// Inline-проверка ИНН (дубль из validators.js, чтобы не вводить cyclic import).
function innChecksumOk(d) {
  if (d.length === 10) {
    const w = [2, 4, 10, 3, 5, 9, 4, 6, 8];
    const k = (w.reduce((a, wi, i) => a + wi * Number(d[i]), 0) % 11) % 10;
    return k === Number(d[9]);
  }
  if (d.length === 12) {
    const w11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
    const w12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
    const k11 = (w11.reduce((a, wi, i) => a + wi * Number(d[i]), 0) % 11) % 10;
    const k12 = (w12.reduce((a, wi, i) => a + wi * Number(d[i]), 0) % 11) % 10;
    return k11 === Number(d[10]) && k12 === Number(d[11]);
  }
  return false;
}

/* Phone — маска +7 */
export function PhoneInput({ value, onChange, ...rest }) {
  const fmt = (v) => {
    const d = v.replace(/\D/g, '').slice(0, 11);
    if (d.length === 0) return '';
    if (d.length <= 1) return '+7 ';
    if (d.length <= 4) return `+7 (${d.slice(1)}`;
    if (d.length <= 7) return `+7 (${d.slice(1, 4)}) ${d.slice(4)}`;
    if (d.length <= 9) return `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
    return `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
  };
  return (
    <div className="inp-wrap">
      <span className="inp-icon">📞</span>
      <input
        type="tel"
        className="inp-text"
        value={fmt(value || '')}
        onChange={(e) => onChange?.(e.target.value.replace(/\D/g, ''))}
        placeholder="+7 (___) ___-__-__"
        {...rest}
      />
    </div>
  );
}

/* Search — иконка + clear */
export function SearchInput({ value, onChange, placeholder = 'Поиск…', ...rest }) {
  return (
    <div className="inp-wrap" role="search">
      <span className="inp-icon" aria-hidden="true">🔍</span>
      <input
        type="search"
        className="inp-text"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        aria-label={rest['aria-label'] || placeholder}
        {...rest}
      />
      {value && <button type="button" className="inp-clear" onClick={() => onChange?.('')} aria-label="Очистить поиск">×</button>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * Textarea с auto-grow
 * ═══════════════════════════════════════════════════════════════════════ */
export function TextareaInput({ value, onChange, autoGrow = true, minRows = 3, maxRows = 10, ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!autoGrow || !ref.current) return;
    ref.current.style.height = 'auto';
    ref.current.style.height = Math.min(ref.current.scrollHeight, maxRows * 24) + 'px';
  }, [value, autoGrow, maxRows]);
  return (
    <textarea
      ref={ref}
      className="inp-textarea"
      rows={minRows}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      {...rest}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * Select (нативный, но красивый)
 * ═══════════════════════════════════════════════════════════════════════ */
export function SelectInput({ value, onChange, options = [], placeholder = '— выбрать —', ...rest }) {
  return (
    <div className="inp-wrap">
      <select
        className="inp-text inp-select"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        {...rest}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          typeof o === 'string'
            ? <option key={o} value={o}>{o}</option>
            : <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <span className="inp-suffix">▾</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * Combobox — autocomplete с поиском
 * ═══════════════════════════════════════════════════════════════════════ */
export function Combobox({ value, onChange, options = [], placeholder = 'Начните вводить…', renderOption, onQuery, allowFreeText = false, 'aria-label': ariaLabel }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrap = useRef(null);
  // Стабильный id для aria-controls (listbox).
  const listIdRef = useRef('cb-list-' + Math.random().toString(36).slice(2, 8));
  const filtered = onQuery
    ? options
    : (q ? options.filter((o) => (o.label || o).toLowerCase().includes(q.toLowerCase())) : options);
  const display = value ? (options.find((o) => (o.value || o) === value)?.label || value) : '';

  useEffect(() => {
    if (!onQuery || !open) return;
    const t = setTimeout(() => onQuery(q), 250);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open]);

  // Сбрасываем активный индекс при изменении фильтрации
  useEffect(() => { setActiveIdx(-1); }, [q, open]);

  const select = (v, o) => {
    onChange?.(v, o);
    setOpen(false);
    setQ('');
    setActiveIdx(-1);
  };

  // G-1: WAI-ARIA combobox (https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)
  //   - input role="combobox" + aria-controls=list + aria-expanded + aria-autocomplete="list"
  //   - стрелки ↑↓ навигация по списку, Enter выбирает, Esc закрывает, Home/End на края
  //   - aria-activedescendant указывает на «виртуально-фокусированную» опцию (фокус остаётся на input)
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return;
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Home') {
      if (!open) return;
      e.preventDefault();
      setActiveIdx(0);
    } else if (e.key === 'End') {
      if (!open) return;
      e.preventDefault();
      setActiveIdx(filtered.length - 1);
    } else if (e.key === 'Enter') {
      if (open && activeIdx >= 0 && filtered[activeIdx]) {
        e.preventDefault();
        const o = filtered[activeIdx];
        select(o.value || o, o);
      } else if (allowFreeText) {
        select(q, null);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setActiveIdx(-1);
      }
    } else if (e.key === 'Tab') {
      // Tab уводит фокус на следующее поле — popover combobox должен закрыться,
      // иначе он остаётся висеть поверх соседних инпутов (MED-баг найден в ТКП).
      if (open) {
        setOpen(false);
        setActiveIdx(-1);
      }
    }
  };

  const activeOptId = activeIdx >= 0 && filtered[activeIdx]
    ? `${listIdRef.current}-opt-${filtered[activeIdx].value || filtered[activeIdx]}`
    : undefined;

  return (
    <>
      <div className="inp-wrap" ref={wrap} role="combobox" aria-expanded={open} aria-haspopup="listbox" aria-controls={listIdRef.current} aria-owns={listIdRef.current}>
        <span className="inp-icon" aria-hidden="true">🔎</span>
        <input
          type="text"
          className="inp-text"
          value={open ? q : display}
          placeholder={placeholder}
          onFocus={() => { setOpen(true); setQ(''); }}
          onChange={(e) => { setQ(e.target.value); if (allowFreeText) onChange?.(e.target.value, null); }}
          onKeyDown={onKeyDown}
          aria-autocomplete="list"
          aria-controls={listIdRef.current}
          aria-activedescendant={activeOptId}
          aria-label={ariaLabel || placeholder}
        />
        <span className="inp-suffix" aria-hidden="true">▾</span>
      </div>
      <Popover anchorRef={wrap} open={open} onClose={() => setOpen(false)}>
        <div role="listbox" id={listIdRef.current}>
          {filtered.length === 0 ? (
            <div className="inp-pop-empty" role="status">{q ? 'Ничего не найдено' : 'Начни вводить…'}</div>
          ) : filtered.map((o, idx) => {
            const v = o.value || o;
            const l = o.label || o;
            const isActive = idx === activeIdx;
            return (
              <div
                key={v}
                id={`${listIdRef.current}-opt-${v}`}
                className={'inp-pop-i ' + (value === v ? 'sel' : '') + (isActive ? ' active' : '')}
                onClick={() => select(v, o)}
                onMouseEnter={() => setActiveIdx(idx)}
                role="option"
                aria-selected={value === v}
              >
                {renderOption ? renderOption(o) : l}
              </div>
            );
          })}
        </div>
      </Popover>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * MultiSelect — теги/чипы
 * ═══════════════════════════════════════════════════════════════════════ */
export function MultiSelect({ value = [], onChange, options = [], placeholder = 'Выберите…' }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const remove = (v) => onChange?.(value.filter((x) => x !== v));
  const add = (v) => { onChange?.(value.includes(v) ? value : [...value, v]); setQ(''); };
  const filtered = options.filter((o) => {
    const v = o.value || o;
    const l = o.label || o;
    if (value.includes(v)) return false;
    return !q || l.toLowerCase().includes(q.toLowerCase());
  });
  return (
    <>
      <div className={'inp-chips-wrap ' + (open ? 'open' : '')} ref={wrap} onClick={() => setOpen(true)}>
        {value.map((v) => {
          const o = options.find((x) => (x.value || x) === v) || { label: v };
          return (
            <span key={v} className="inp-chip">
              {o.label || v}
              <button type="button" onClick={(e) => { e.stopPropagation(); remove(v); }} aria-label={`Удалить ${o.label || v}`}>×</button>
            </span>
          );
        })}
        <input
          className="inp-chips-input"
          value={q}
          placeholder={value.length ? '' : placeholder}
          onChange={(e) => setQ(e.target.value)}
          aria-label={placeholder || 'Выберите значения'}
          aria-expanded={open}
          aria-haspopup="listbox"
        />
      </div>
      <Popover anchorRef={wrap} open={open && filtered.length > 0} onClose={() => setOpen(false)}>
        <div role="listbox">
          {filtered.map((o) => {
            const v = o.value || o;
            const l = o.label || o;
            return (
              <div
                key={v}
                className="inp-pop-i"
                onClick={(e) => { e.stopPropagation(); add(v); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); add(v); } }}
                role="option"
                aria-selected={false}
                tabIndex={0}
              >{l}</div>
            );
          })}
        </div>
      </Popover>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * Radio Group / Segmented
 * ═══════════════════════════════════════════════════════════════════════ */
export function RadioGroup({ value, onChange, options = [], name, 'aria-label': ariaLabel }) {
  // Arrow keys (вверх/вниз ↑↓) перебирают опции — WCAG 2.1.1 + WAI-ARIA radio pattern.
  // `name` нужен чтобы native input radio сгруппировались (тогда браузер сам делает Arrow).
  const groupName = name || `rg-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <div className="inp-radio" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => {
        const v = o.value || o;
        const l = o.label || o;
        const sel = value === v;
        return (
          <label key={v} className={'inp-radio-i ' + (sel ? 'sel' : '')}>
            <input
              type="radio"
              name={groupName}
              checked={sel}
              onChange={() => onChange?.(v)}
              aria-label={typeof l === 'string' ? l : undefined}
            />
            <span className="dot" aria-hidden="true" />
            <span>{l}</span>
            {o.desc && <span className="desc">{o.desc}</span>}
          </label>
        );
      })}
    </div>
  );
}

export function Segmented({ value, onChange, options = [], 'aria-label': ariaLabel }) {
  // G-1: WAI-ARIA group из toggle-кнопок. Каждая получает aria-pressed.
  return (
    <div className="inp-segmented" role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const v = o.value || o;
        const l = o.label || o;
        const sel = value === v;
        return (
          <button
            key={v}
            type="button"
            className={sel ? 'sel' : ''}
            onClick={() => onChange?.(v)}
            aria-pressed={sel}
          >
            {o.icon && <span aria-hidden="true">{o.icon}</span>}
            <span>{l}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * Checkbox / Switch
 * ═══════════════════════════════════════════════════════════════════════ */
export function Checkbox({ checked, onChange, label, indeterminate, 'aria-label': ariaLabel }) {
  // ref для indeterminate (нет HTML-атрибута — только через JS-свойство DOM-узла)
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <label className={'inp-check ' + (checked ? 'on ' : '') + (indeterminate ? 'ind' : '')}>
      <input
        ref={ref}
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange?.(e.target.checked)}
        aria-label={ariaLabel || (typeof label === 'string' ? label : undefined)}
      />
      <span className="box" aria-hidden="true">{indeterminate ? '–' : checked ? '✓' : ''}</span>
      {label && <span className="lbl">{label}</span>}
    </label>
  );
}

export function Switch({ checked, onChange, label, size = 'md', 'aria-label': ariaLabel }) {
  // role="switch" точнее семантически чем checkbox; aria-checked управляется самим input.
  return (
    <label className={'inp-switch ' + size + (checked ? ' on' : '')}>
      <input
        type="checkbox"
        role="switch"
        checked={!!checked}
        onChange={(e) => onChange?.(e.target.checked)}
        aria-label={ariaLabel || (typeof label === 'string' ? label : undefined)}
        aria-checked={!!checked}
      />
      <span className="track" aria-hidden="true"><span className="thumb" /></span>
      {label && <span className="lbl">{label}</span>}
    </label>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * Slider
 * ═══════════════════════════════════════════════════════════════════════ */
export function Slider({ value, onChange, min = 0, max = 100, step = 1, showValue }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="inp-slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange?.(Number(e.target.value))}
        style={{ '--pct': pct + '%' }}
      />
      {showValue && <div className="inp-slider-val">{value}</div>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * DatePicker — popover-календарь
 * ═══════════════════════════════════════════════════════════════════════ */
const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WEEK_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export function DatePicker({ value, onChange, placeholder = 'дд.мм.гггг' }) {
  const [open, setOpen] = useState(false);
  // Защита от value=null → new Date(null) = 1970-01-01
  const safeViewDate = (v) => v ? new Date(v) : new Date();
  const [view, setView] = useState(safeViewDate(value));
  const wrap = useRef(null);
  // При сбросе value на null — возвращаем view на текущий месяц при следующем открытии
  useEffect(() => { if (!value && open) setView(new Date()); }, [value, open]);

  const today = new Date();
  const y = view.getFullYear(); const m = view.getMonth();
  const firstDay = new Date(y, m, 1);
  const lastDay = new Date(y, m + 1, 0);
  const startWeekday = (firstDay.getDay() + 6) % 7; // Пн=0
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push(new Date(y, m, d));
  while (cells.length % 7) cells.push(null);

  const fmt = (d) => d ? d.toLocaleDateString('ru-RU') : '';
  const same = (a, b) => a && b && a.toDateString() === b.toDateString();
  const sel = value ? new Date(value) : null;

  return (
    <>
      <div className="inp-wrap" ref={wrap}>
        <span className="inp-icon" aria-hidden="true">📅</span>
        <input
          type="text"
          className="inp-text"
          readOnly
          value={fmt(sel)}
          placeholder={placeholder}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => {
            // WCAG 2.1.1: Enter/Space/↓ открывает календарь, Esc закрывает
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
            } else if (e.key === 'Escape' && open) {
              e.preventDefault();
              setOpen(false);
            }
          }}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={placeholder}
        />
        <span className="inp-suffix" aria-hidden="true">▾</span>
      </div>
      <Popover anchorRef={wrap} open={open} onClose={() => setOpen(false)} matchWidth={false} maxHeight={420}>
        <div className="date-pop w-280">
          <div className="dp-h">
            <button onClick={() => setView(new Date(y, m - 1, 1))}>‹</button>
            <span>{MONTHS_RU[m]} {y}</span>
            <button onClick={() => setView(new Date(y, m + 1, 1))}>›</button>
          </div>
          <div className="dp-wd">
            {WEEK_RU.map((w) => <div key={w}>{w}</div>)}
          </div>
          <div className="dp-cells">
            {cells.map((d, i) => d ? (
              <button
                key={i}
                className={'dp-cell ' + (same(d, today) ? 'today ' : '') + (same(d, sel) ? 'sel ' : '')}
                onClick={() => { onChange?.(d.toISOString().slice(0, 10)); setOpen(false); }}
              >{d.getDate()}</button>
            ) : <div key={i} />)}
          </div>
          <div className="dp-foot">
            <button className="dp-link" onClick={() => { onChange?.(new Date().toISOString().slice(0, 10)); setOpen(false); }}>Сегодня</button>
            <button className="dp-link" onClick={() => { onChange?.(null); setOpen(false); }}>Очистить</button>
          </div>
        </div>
      </Popover>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * Rating (звёзды)
 * ═══════════════════════════════════════════════════════════════════════ */
export function Rating({ value = 0, onChange, max = 5 }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="inp-rating">
      {Array.from({ length: max }).map((_, i) => {
        const v = i + 1;
        const on = (hover || value) >= v;
        return (
          <button
            key={i}
            type="button"
            className={'star ' + (on ? 'on' : '')}
            onMouseEnter={() => setHover(v)}
            onMouseLeave={() => setHover(0)}
            onClick={() => onChange?.(v)}
          >★</button>
        );
      })}
      <span className="val">{value}/{max}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * Color picker
 * ═══════════════════════════════════════════════════════════════════════ */
const PALETTE = ['#D4A843', '#C8293B', '#1E4D8C', '#4ADE80', '#F87171', '#60A5FA', '#8B5CF6', '#06B6D4', '#F97316', '#FBBF24', '#0F1F3D', '#FFFFFF'];

export function ColorPicker({ value, onChange }) {
  return (
    <div className="inp-color">
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          className={'inp-color-cell ' + (value === c ? 'sel' : '')}
          style={{ background: c }}
          onClick={() => onChange?.(c)}
        />
      ))}
      <input
        type="color"
        value={value || '#D4A843'}
        onChange={(e) => onChange?.(e.target.value)}
        className="inp-color-native"
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * FileDrop — drag-and-drop файлов
 * ═══════════════════════════════════════════════════════════════════════ */
export function FileDrop({ onFiles, accept = '*', multiple = false, hint = 'Перетащите файл или нажмите' }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(false);
  const [files, setFiles] = useState([]);
  const handle = (list) => {
    const arr = Array.from(list);
    setFiles(arr);
    onFiles?.(arr);
  };
  return (
    <div
      className={'inp-drop ' + (drag ? 'drag' : '') + (files.length ? ' has' : '')}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files); }}
      onClick={() => ref.current?.click()}
    >
      <input ref={ref} type="file" accept={accept} multiple={multiple} hidden onChange={(e) => handle(e.target.files)} />
      <div className="inp-drop-ic">{drag ? '📥' : files.length ? '✓' : '📎'}</div>
      {files.length ? (
        <div className="inp-drop-list">
          {files.map((f, i) => (
            <div key={i} className="inp-drop-file">
              📄 <span className="flex-1">{f.name}</span> <small>{(f.size / 1024).toFixed(0)} КБ</small>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="inp-drop-h">{drag ? 'Отпустите чтобы загрузить' : hint}</div>
          <div className="inp-drop-sub">{accept === '*' ? 'Любой формат' : accept} · до 10 МБ</div>
        </>
      )}
    </div>
  );
}
