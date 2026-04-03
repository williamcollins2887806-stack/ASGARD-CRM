/**
 * EmployeePicker — Bottom-sheet employee selector for ASGARD mobile
 * 
 * Props:
 *   employees   - Array<{ id, name, position?, role?, avatar? }>
 *   selected    - Array<id> (controlled)
 *   onChange    - (selectedIds: number[]) => void
 *   maxSelect   - number (0 = unlimited, 1 = single-select auto-close)
 *   placeholder - string
 *   title       - string (sheet header)
 *   disabled    - boolean
 *   label       - string (floating label)
 *   maxChips    - number (default 2, then "+N")
 */

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';

// ── Tokens ──────────────────────────────────────────────────
const t = (typeof DS !== 'undefined' && DS.t) || {
  bg1: '#0d1117', bg2: '#161b22', bg3: '#21262d', bg4: '#30363d',
  t1: '#e6edf3', t2: '#8b949e', t3: '#484f58',
  accent: '#5b8def', danger: '#e74c3c',
  radius: '10px', radiusSm: '6px',
  fontSm: '12px', fontBase: '14px', fontLg: '16px',
};

// ── Styles ──────────────────────────────────────────────────
const S = {
  wrapper: { position: 'relative', width: '100%', fontFamily: 'Inter, -apple-system, sans-serif' },
  label: { display: 'block', fontSize: t.fontSm, color: t.t2, marginBottom: 4, fontWeight: 500 },
  trigger: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 12px', background: t.bg3, border: `1px solid ${t.bg4}`,
    borderRadius: t.radiusSm, color: t.t1, minHeight: 42,
    WebkitTapHighlightColor: 'transparent', flexWrap: 'wrap',
  },
  triggerDisabled: { opacity: 0.5, pointerEvents: 'none' },
  placeholder: { color: t.t3, fontSize: t.fontBase },
  chip: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '3px 8px 3px 4px', background: t.bg4, borderRadius: 14,
    fontSize: t.fontSm, maxWidth: 140,
  },
  chipAvatar: { width: 20, height: 20, borderRadius: '50%', objectFit: 'cover', background: t.bg4 },
  chipAvatarPlaceholder: {
    width: 20, height: 20, borderRadius: '50%', background: t.bg4,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 9, fontWeight: 600, color: t.t2,
  },
  chipName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  chipRemove: { padding: 2, lineHeight: 1, fontSize: 10, opacity: 0.6 },
  counter: {
    marginLeft: 'auto', fontSize: t.fontSm, color: t.t2,
    background: t.bg4, padding: '2px 8px', borderRadius: 10,
  },
  // Sheet
  overlay: {
    position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.5)',
    display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
  },
  sheet: {
    background: t.bg2, borderRadius: '16px 16px 0 0', maxHeight: '80vh',
    display: 'flex', flexDirection: 'column', paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  },
  handle: { width: 36, height: 4, borderRadius: 2, background: t.bg4, margin: '8px auto 4px' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px 12px' },
  headerTitle: { fontSize: t.fontLg, fontWeight: 600, color: t.t1 },
  headerClose: { padding: 8, color: t.t2, fontSize: 18, lineHeight: 1 },
  filters: { padding: '0 16px 10px', display: 'flex', gap: 8 },
  searchInput: {
    flex: 1, padding: '10px 12px', background: t.bg3, border: `1px solid ${t.bg4}`,
    borderRadius: t.radiusSm, color: t.t1, fontSize: t.fontBase, outline: 'none', boxSizing: 'border-box',
  },
  roleFilter: {
    padding: '10px 8px', background: t.bg3, border: `1px solid ${t.bg4}`,
    borderRadius: t.radiusSm, color: t.t1, fontSize: t.fontSm, minWidth: 90,
  },
  list: { flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' },
  item: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '10px 16px', minHeight: 52, borderBottom: `1px solid ${t.bg4}`,
  },
  itemSelected: { background: t.bg3 },
  checkbox: {
    width: 22, height: 22, borderRadius: 5, border: `2px solid ${t.t3}`,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, transition: 'all 0.1s',
  },
  checkboxChecked: { background: t.accent, borderColor: t.accent },
  avatar: { width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', background: t.bg4, flexShrink: 0 },
  avatarPlaceholder: {
    width: 36, height: 36, borderRadius: '50%', background: t.bg4,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: t.fontSm, fontWeight: 600, color: t.t2, flexShrink: 0,
  },
  info: { flex: 1, minWidth: 0 },
  name: { fontSize: t.fontBase, fontWeight: 500, color: t.t1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  position: { fontSize: t.fontSm, color: t.t3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  footer: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 16px', borderTop: `1px solid ${t.bg4}`,
  },
  footerCount: { fontSize: t.fontSm, color: t.t2 },
  footerActions: { display: 'flex', gap: 8 },
  btnSecondary: {
    padding: '8px 16px', borderRadius: t.radiusSm, fontSize: t.fontSm, fontWeight: 500,
    background: t.bg3, color: t.t1, border: `1px solid ${t.bg4}`,
  },
  btnPrimary: {
    padding: '8px 20px', borderRadius: t.radiusSm, fontSize: t.fontSm, fontWeight: 500,
    background: t.accent, color: '#fff', border: 'none',
  },
  empty: { padding: 32, textAlign: 'center', color: t.t3, fontSize: t.fontBase },
};

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : name[0].toUpperCase();
}

function shortName(name) {
  const parts = (name || '').split(/\s+/);
  return parts.length >= 2 ? `${parts[0]} ${parts[1][0]}.` : name;
}

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 7l2.8 2.8L11 4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export default function EmployeePicker({
  employees = [],
  selected = [],
  onChange,
  maxSelect = 0,
  placeholder = 'Выберите сотрудников',
  title = 'Выбор сотрудников',
  disabled = false,
  label = '',
  maxChips = 2,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [tempSelected, setTempSelected] = useState([]);
  const searchRef = useRef(null);
  const isSingle = maxSelect === 1;

  const roles = useMemo(() => {
    const set = new Set();
    employees.forEach(e => { if (e.role) set.add(e.role); });
    return Array.from(set).sort();
  }, [employees]);

  const filtered = useMemo(() => {
    let list = employees;
    if (roleFilter) list = list.filter(e => e.role === roleFilter);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(e =>
        (e.name && e.name.toLowerCase().includes(q)) ||
        (e.position && e.position.toLowerCase().includes(q))
      );
    }
    return list;
  }, [employees, query, roleFilter]);

  const selectedEmployees = useMemo(() =>
    selected.map(id => employees.find(e => e.id === id)).filter(Boolean),
    [selected, employees]
  );

  // Open sheet
  const handleOpen = useCallback(() => {
    if (disabled) return;
    setTempSelected([...selected]);
    setQuery('');
    setRoleFilter('');
    setOpen(true);
  }, [disabled, selected]);

  // Toggle in temp selection
  const toggleTemp = useCallback((empId) => {
    setTempSelected(prev => {
      if (prev.includes(empId)) return prev.filter(id => id !== empId);
      if (maxSelect > 0 && prev.length >= maxSelect) return prev;
      return [...prev, empId];
    });
  }, [maxSelect]);

  // Single select
  const handleSingleSelect = useCallback((empId) => {
    setOpen(false);
    if (onChange) onChange([empId]);
  }, [onChange]);

  // Apply multi
  const handleApply = useCallback(() => {
    setOpen(false);
    if (onChange) onChange([...tempSelected]);
  }, [tempSelected, onChange]);

  // Clear
  const handleClear = useCallback(() => {
    setTempSelected([]);
  }, []);

  // Remove chip
  const handleRemoveChip = useCallback((e, empId) => {
    e.stopPropagation();
    const next = selected.filter(id => id !== empId);
    if (onChange) onChange(next);
  }, [selected, onChange]);

  // Body scroll lock
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  // Focus search
  useEffect(() => {
    if (open && searchRef.current) setTimeout(() => searchRef.current?.focus(), 50);
  }, [open]);

  return (
    <div style={S.wrapper}>
      {label && <span style={S.label}>{label}</span>}

      {/* Trigger */}
      <div
        style={{ ...S.trigger, ...(disabled ? S.triggerDisabled : {}) }}
        onClick={handleOpen}
      >
        {selectedEmployees.length === 0 ? (
          <span style={S.placeholder}>{placeholder}</span>
        ) : (
          <>
            {selectedEmployees.slice(0, maxChips).map(emp => (
              <span key={emp.id} style={S.chip}>
                {emp.avatar ? (
                  <img src={emp.avatar} alt="" style={S.chipAvatar} loading="lazy" />
                ) : (
                  <span style={S.chipAvatarPlaceholder}>{getInitials(emp.name)}</span>
                )}
                <span style={S.chipName}>{shortName(emp.name)}</span>
                <span style={S.chipRemove} onClick={(e) => handleRemoveChip(e, emp.id)}>✕</span>
              </span>
            ))}
            {selectedEmployees.length > maxChips && (
              <span style={S.chip}>+{selectedEmployees.length - maxChips}</span>
            )}
          </>
        )}
        {selectedEmployees.length > 0 && (
          <span style={S.counter}>{selectedEmployees.length}</span>
        )}
      </div>

      {/* Bottom Sheet */}
      {open && (
        <div style={S.overlay} onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div style={S.sheet} onClick={(e) => e.stopPropagation()}>
            <div style={S.handle} />

            <div style={S.header}>
              <span style={S.headerTitle}>{title}</span>
              <span style={S.headerClose} onClick={() => setOpen(false)}>✕</span>
            </div>

            {/* Filters */}
            <div style={S.filters}>
              <input
                ref={searchRef}
                style={S.searchInput}
                type="text"
                placeholder="Поиск по имени..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
              />
              {roles.length > 1 && (
                <select
                  style={S.roleFilter}
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                >
                  <option value="">Все</option>
                  {roles.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              )}
            </div>

            {/* List */}
            <div style={S.list}>
              {filtered.length === 0 ? (
                <div style={S.empty}>{query ? 'Никого не найдено' : 'Нет сотрудников'}</div>
              ) : (
                filtered.map(emp => {
                  const isChecked = isSingle
                    ? selected.includes(emp.id)
                    : tempSelected.includes(emp.id);

                  return (
                    <div
                      key={emp.id}
                      style={{ ...S.item, ...(isChecked ? S.itemSelected : {}) }}
                      onClick={() => isSingle ? handleSingleSelect(emp.id) : toggleTemp(emp.id)}
                    >
                      {/* Checkbox (hidden in single mode) */}
                      {!isSingle && (
                        <div style={{ ...S.checkbox, ...(isChecked ? S.checkboxChecked : {}) }}>
                          {isChecked && <CheckIcon />}
                        </div>
                      )}

                      {/* Avatar */}
                      {emp.avatar ? (
                        <img src={emp.avatar} alt="" style={S.avatar} loading="lazy" />
                      ) : (
                        <div style={S.avatarPlaceholder}>{getInitials(emp.name)}</div>
                      )}

                      {/* Info */}
                      <div style={S.info}>
                        <div style={S.name}>{emp.name}</div>
                        {(emp.position || emp.role) && (
                          <div style={S.position}>{emp.position || emp.role}</div>
                        )}
                      </div>

                      {/* Single mode checkmark */}
                      {isSingle && isChecked && (
                        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                          <path d="M4 9l3.5 3.5L14 5" stroke={t.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer (multi only) */}
            {!isSingle && (
              <div style={S.footer}>
                <span style={S.footerCount}>
                  Выбрано: {tempSelected.length}{maxSelect > 0 ? ` / ${maxSelect}` : ''}
                </span>
                <div style={S.footerActions}>
                  <button style={S.btnSecondary} onClick={handleClear}>Сбросить</button>
                  <button style={S.btnPrimary} onClick={handleApply}>Применить</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
