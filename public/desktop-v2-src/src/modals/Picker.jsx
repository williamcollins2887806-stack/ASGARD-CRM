import { useState, useMemo } from 'react';
import { useModal } from './ModalProvider';
import { MCard, MHead, MFoot, Btn, Input } from './parts';

/**
 * Picker — выбор одного/нескольких элементов из списка с поиском.
 * items: [{ id, name, role?, meta?, avatar? }]
 */
export function PickerModal({
  title = 'Выбор',
  subtitle,
  icon = '👥',
  accent = 'info',
  items = [],
  multi = false,
  initialSelected = [],
  searchPlaceholder = 'Поиск…',
  onSubmit,
  onClose
}) {
  const { close } = useModal();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(new Set(initialSelected));
  const handleClose = () => { onClose?.(); close(); };

  const filtered = useMemo(() => {
    const lower = q.trim().toLowerCase();
    if (!lower) return items;
    return items.filter((it) => (it.name || '').toLowerCase().includes(lower) || (it.role || '').toLowerCase().includes(lower));
  }, [items, q]);

  const toggle = (id) => {
    if (!multi) {
      onSubmit?.(items.find((x) => x.id === id));
      close();
      return;
    }
    setSel((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <MCard>
      <MHead
        icon={icon}
        title={title}
        subtitle={subtitle || `Найдено: ${filtered.length}` + (multi ? ` · выбрано: ${sel.size}` : '')}
        accent={accent}
        onClose={handleClose}
      />
      <div className="m-picker-search">
        <Input placeholder={searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      <div style={{ flex: 1, overflow: 'auto', maxHeight: 'calc(80vh - 240px)' }}>
        {/* G-1: листбокс с правильной семантикой —
            - single: role="listbox" + aria-multiselectable=false, дочерние role="option"
            - multi: role="group" + дочерние role="checkbox" (т.к. внутри checkbox-семантика, а не listbox)
            aria-label берёт title чтобы скрин-ридер озвучил «список: Сотрудники, 12 элементов». */}
        <div
          className="m-picker-list"
          role={multi ? 'group' : 'listbox'}
          aria-label={title}
          aria-multiselectable={!multi ? false : undefined}
        >
          {filtered.length === 0 ? (
            <div className="p-30 t-center c-t3" role="status">Ничего не найдено</div>
          ) : filtered.map((it) => {
            const selected = sel.has(it.id);
            const initials = (it.name || '?').trim().split(/\s+/).map((s) => s[0]).join('').slice(0, 2).toUpperCase();
            return (
              <div
                key={it.id}
                className={'m-picker-item ' + (selected ? 'selected' : '')}
                onClick={() => toggle(it.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(it.id); } }}
                role={multi ? 'checkbox' : 'option'}
                aria-checked={multi ? selected : undefined}
                aria-selected={!multi ? selected : undefined}
                aria-label={it.name + (it.role ? ', ' + it.role : '')}
                tabIndex={0}
              >
                <div className="ava" aria-hidden="true">{initials}</div>
                <div className="flex-1">
                  <div className="nm">{it.name}</div>
                  {it.role && <div className="ro">{it.role}{it.meta ? ' · ' + it.meta : ''}</div>}
                </div>
                <div className="check" aria-hidden="true">{selected ? '✓' : ''}</div>
              </div>
            );
          })}
        </div>
      </div>
      {multi && (
        <MFoot align="spread">
          <Btn variant="ghost" onClick={handleClose}>Отмена</Btn>
          <Btn variant="primary" disabled={!sel.size} onClick={() => { onSubmit?.(items.filter((x) => sel.has(x.id))); close(); }}>
            Выбрать {sel.size}
          </Btn>
        </MFoot>
      )}
    </MCard>
  );
}
