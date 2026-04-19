/**
 * AsgardSelect — Bottom-sheet select for ASGARD mobile
 * 
 * Uses DS.t.* tokens, Utils.el(), consistent with M.* components.
 * Bottom sheet pattern — NOT native <select>, NOT dropdown.
 * 
 * Props:
 *   options     - Array<{ value, label, disabled? }> or Array<{ group, items: [...] }>
 *   value       - current value (string|number)
 *   onChange    - (value, option) => void
 *   placeholder - string
 *   searchable  - null (auto) | true | false
 *   clearable   - boolean
 *   disabled    - boolean
 *   label       - string (floating label above)
 *   error       - string (validation error text)
 *   fullWidth   - boolean (default true)
 */

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';

// ── Design tokens (inline fallback if DS.t not loaded) ──────
const t = (typeof DS !== 'undefined' && DS.t) || {
  bg1: '#0d1117', bg2: '#161b22', bg3: '#21262d', bg4: '#30363d',
  t1: '#e6edf3', t2: '#8b949e', t3: '#484f58',
  accent: '#5b8def', danger: '#e74c3c',
  radius: '10px', radiusSm: '6px',
  fontSm: '12px', fontBase: '14px', fontLg: '16px',
};

// ── Flat options helper ─────────────────────────────────────
function flatOptions(options) {
  const flat = [];
  for (const opt of options) {
    if (opt.group && Array.isArray(opt.items)) {
      for (const item of opt.items) flat.push({ ...item, _group: opt.group });
    } else {
      flat.push(opt);
    }
  }
  return flat;
}

// ── Styles (no external CSS needed) ─────────────────────────
const S = {
  wrapper: {
    position: 'relative',
    width: '100%',
    fontFamily: 'Inter, -apple-system, sans-serif',
  },
  label: {
    display: 'block',
    fontSize: t.fontSm,
    color: t.t2,
    marginBottom: 4,
    fontWeight: 500,
  },
  trigger: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: '10px 12px',
    background: t.bg3,
    border: `1px solid ${t.bg4}`,
    borderRadius: t.radiusSm,
    color: t.t1,
    fontSize: t.fontBase,
    minHeight: 42,
    WebkitTapHighlightColor: 'transparent',
    userSelect: 'none',
  },
  triggerDisabled: {
    opacity: 0.5,
    pointerEvents: 'none',
  },
  triggerError: {
    borderColor: t.danger,
  },
  value: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  placeholder: {
    color: t.t3,
  },
  arrow: {
    width: 18,
    height: 18,
    flexShrink: 0,
    transition: 'transform 0.15s',
  },
  errorText: {
    fontSize: t.fontSm,
    color: t.danger,
    marginTop: 4,
  },
  // Bottom sheet
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 10000,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
  },
  sheet: {
    background: t.bg2,
    borderRadius: '16px 16px 0 0',
    maxHeight: '70vh',
    display: 'flex',
    flexDirection: 'column',
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    background: t.bg4,
    margin: '8px auto 4px',
  },
  sheetHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 16px 12px',
  },
  sheetTitle: {
    fontSize: t.fontLg,
    fontWeight: 600,
    color: t.t1,
  },
  sheetClose: {
    padding: 8,
    color: t.t2,
    fontSize: 18,
    lineHeight: 1,
  },
  searchWrap: {
    padding: '0 16px 10px',
  },
  searchInput: {
    width: '100%',
    padding: '10px 12px',
    background: t.bg3,
    border: `1px solid ${t.bg4}`,
    borderRadius: t.radiusSm,
    color: t.t1,
    fontSize: t.fontBase,
    outline: 'none',
    boxSizing: 'border-box',
  },
  optionsList: {
    flex: 1,
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
  },
  option: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 16px',
    fontSize: t.fontBase,
    color: t.t1,
    gap: 10,
    minHeight: 44,
    borderBottom: `1px solid ${t.bg4}`,
    transition: 'background 0.1s',
  },
  optionSelected: {
    background: t.bg3,
    fontWeight: 500,
  },
  optionDisabled: {
    opacity: 0.4,
    pointerEvents: 'none',
  },
  groupLabel: {
    padding: '10px 16px 4px',
    fontSize: t.fontSm,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: t.t3,
  },
  checkmark: {
    width: 18,
    height: 18,
    marginLeft: 'auto',
    flexShrink: 0,
  },
  empty: {
    padding: 32,
    textAlign: 'center',
    color: t.t3,
    fontSize: t.fontBase,
  },
};

const ArrowSvg = ({ open }) => (
  <svg style={{ ...S.arrow, transform: open ? 'rotate(180deg)' : 'none' }} viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M5 7l4 4 4-4" stroke={t.t3} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const Checkmark = () => (
  <svg style={S.checkmark} viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 9l3.5 3.5L14 5" stroke={t.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export default function AsgardSelect({
  options = [],
  value,
  onChange,
  placeholder = 'Выберите...',
  searchable = null,
  clearable = false,
  disabled = false,
  label = '',
  error = '',
  fullWidth = true,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef(null);

  const flat = useMemo(() => flatOptions(options), [options]);
  const selected = useMemo(() => flat.find(o => String(o.value) === String(value)), [flat, value]);
  const showSearch = useMemo(() => {
    if (searchable === true) return true;
    if (searchable === false) return false;
    return flat.length >= 7;
  }, [flat, searchable]);

  // Filter
  const filteredOptions = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase();

    return options.reduce((acc, opt) => {
      if (opt.group && Array.isArray(opt.items)) {
        const items = opt.items.filter(i => i.label.toLowerCase().includes(q));
        if (items.length > 0) acc.push({ ...opt, items });
      } else {
        if (opt.label.toLowerCase().includes(q)) acc.push(opt);
      }
      return acc;
    }, []);
  }, [options, query]);

  const handleOpen = useCallback(() => {
    if (disabled) return;
    setOpen(true);
    setQuery('');
  }, [disabled]);

  const handleSelect = useCallback((opt) => {
    if (opt.disabled) return;
    setOpen(false);
    if (onChange) onChange(opt.value, opt);
  }, [onChange]);

  const handleClear = useCallback((e) => {
    e.stopPropagation();
    if (onChange) onChange('', null);
  }, [onChange]);

  // Focus search on open
  useEffect(() => {
    if (open && showSearch && searchRef.current) {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open, showSearch]);

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  const hasFilteredOptions = useMemo(() => {
    return filteredOptions.some(o => o.group ? o.items?.length > 0 : true);
  }, [filteredOptions]);

  return (
    <div style={{ ...S.wrapper, width: fullWidth ? '100%' : 'auto' }}>
      {label && <span style={S.label}>{label}</span>}

      {/* Trigger */}
      <div
        style={{
          ...S.trigger,
          ...(disabled ? S.triggerDisabled : {}),
          ...(error ? S.triggerError : {}),
        }}
        onClick={handleOpen}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span style={{ ...S.value, ...(selected ? {} : S.placeholder) }}>
          {selected ? selected.label : placeholder}
        </span>

        {clearable && value !== '' && value != null && (
          <span onClick={handleClear} style={{ padding: 4, lineHeight: 1 }}>✕</span>
        )}

        <ArrowSvg open={open} />
      </div>

      {error && <div style={S.errorText}>{error}</div>}

      {/* Bottom Sheet */}
      {open && (
        <div
          style={S.overlay}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div style={S.sheet} onClick={(e) => e.stopPropagation()}>
            <div style={S.handle} />

            <div style={S.sheetHeader}>
              <span style={S.sheetTitle}>{label || placeholder}</span>
              <span style={S.sheetClose} onClick={() => setOpen(false)}>✕</span>
            </div>

            {showSearch && (
              <div style={S.searchWrap}>
                <input
                  ref={searchRef}
                  style={S.searchInput}
                  type="text"
                  placeholder="Поиск..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoComplete="off"
                />
              </div>
            )}

            <div style={S.optionsList}>
              {!hasFilteredOptions ? (
                <div style={S.empty}>{query ? 'Ничего не найдено' : 'Нет вариантов'}</div>
              ) : (
                filteredOptions.map((opt, i) => {
                  if (opt.group && Array.isArray(opt.items)) {
                    return (
                      <div key={`g-${i}`}>
                        <div style={S.groupLabel}>{opt.group}</div>
                        {opt.items.map(item => (
                          <div
                            key={item.value}
                            style={{
                              ...S.option,
                              ...(String(item.value) === String(value) ? S.optionSelected : {}),
                              ...(item.disabled ? S.optionDisabled : {}),
                            }}
                            onClick={() => handleSelect(item)}
                          >
                            <span style={{ flex: 1 }}>{item.label}</span>
                            {String(item.value) === String(value) && <Checkmark />}
                          </div>
                        ))}
                      </div>
                    );
                  }
                  return (
                    <div
                      key={opt.value}
                      style={{
                        ...S.option,
                        ...(String(opt.value) === String(value) ? S.optionSelected : {}),
                        ...(opt.disabled ? S.optionDisabled : {}),
                      }}
                      onClick={() => handleSelect(opt)}
                    >
                      <span style={{ flex: 1 }}>{opt.label}</span>
                      {String(opt.value) === String(value) && <Checkmark />}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
