/**
 * DaData + free text customer cell for registry
 */
import { useState, useRef } from 'react';
import { api } from '@/api/client';

export default function CustomerSuggestCell({ value, inn, onChange }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);

  const search = (q) => {
    clearTimeout(timer.current);
    if (!q || q.length < 2) { setSuggestions([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const d = await api(`/api/customers/suggest?q=${encodeURIComponent(q)}`);
        setSuggestions(d.suggestions || d.items || []);
        setOpen(true);
      } catch { setSuggestions([]); }
    }, 300);
  };

  return (
    <div style={{ position: 'relative', minWidth: 160 }}>
      <input
        className="inp"
        value={value}
        onChange={e => { onChange(e.target.value, inn); search(e.target.value); }}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder="Заказчик"
        style={{ width: '100%' }}
      />
      {inn && <small className="muted">{inn}</small>}
      {open && suggestions.length > 0 && (
        <div className="dropdown-panel" style={{
          position: 'absolute', zIndex: 20, background: 'var(--bg-2)', border: '1px solid var(--border)',
          borderRadius: 8, maxHeight: 180, overflow: 'auto', width: '100%'
        }}>
          {suggestions.map((s, i) => (
            <div
              key={i}
              role="button"
              tabIndex={0}
              style={{ padding: '6px 8px', cursor: 'pointer' }}
              onMouseDown={() => {
                onChange(s.name || s.value, s.inn);
                setOpen(false);
              }}
            >
              {s.name || s.value}{s.inn ? ` · ${s.inn}` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
