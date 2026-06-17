/**
 * EmployeeSelectModal — выбор сотрудников для заявки.
 * Источник: vanilla permit_applications.js → openEmployeeSelectModal.
 */
import { useState, useMemo } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { SearchInput, SelectInput } from '@/inputs/Inputs';

export default function EmployeeSelectModal({ employees = [], alreadySelected = [], onConfirm }) {
  const { close } = useModal();
  const [selected, setSelected] = useState(new Set(alreadySelected.map(String)));
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  const roleTags = useMemo(() => {
    const set = new Set();
    employees.forEach((e) => { if (e.role_tag) set.add(e.role_tag); });
    return [...set].sort();
  }, [employees]);

  const filtered = useMemo(() => {
    let v = employees;
    if (roleFilter) v = v.filter((e) => e.role_tag === roleFilter);
    if (query.trim()) {
      const lq = query.trim().toLowerCase();
      v = v.filter((e) => (e.fio || e.full_name || '').toLowerCase().includes(lq));
    }
    return v;
  }, [employees, query, roleFilter]);

  const toggle = (id) => {
    setSelected((s) => {
      const n = new Set(s);
      const k = String(id);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });
  };

  const selectAll = () => setSelected((s) => {
    const n = new Set(s);
    filtered.forEach((e) => n.add(String(e.id)));
    return n;
  });

  const deselectAll = () => setSelected(new Set());

  const onSubmit = () => {
    const selectedEmps = employees.filter((e) => selected.has(String(e.id)));
    onConfirm?.(selectedEmps);
    close();
  };

  const roleOpts = [{ value: '', label: 'Все должности' }, ...roleTags.map((r) => ({ value: r, label: r }))];

  return (
    <MCard>
      <MHead icon="👷" title="Выбрать сотрудников" accent="default" onClose={close} />
      <MBody>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <div className="flex-1 min-w-200">
            <SearchInput value={query} onChange={setQuery} placeholder="Поиск по ФИО…" />
          </div>
          <div className="min-w-180">
            <SelectInput value={roleFilter} onChange={setRoleFilter} options={roleOpts} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <Btn size="sm" variant="ghost" onClick={selectAll}>Выбрать всех</Btn>
          <Btn size="sm" variant="ghost" onClick={deselectAll}>Снять все</Btn>
          <div style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--t-3)' }}>Выбрано: {selected.size}</div>
        </div>

        <div className="pa-emp-selector">
          {filtered.length === 0 ? (
            <div className="p-24 t-center c-t3">Никого не нашли</div>
          ) : filtered.map((e) => {
            const name = e.fio || e.full_name || `ID:${e.id}`;
            return (
              <label key={e.id} className="pa-emp-item" onClick={(ev) => ev.preventDefault()}>
                <input
                  type="checkbox"
                  checked={selected.has(String(e.id))}
                  onChange={() => toggle(e.id)}
                />
                <div className="info">
                  <div className="name">{name}</div>
                  <div className="role">
                    {e.role_tag || ''}{e.phone ? ` · ${e.phone}` : ''}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" onClick={onSubmit}>Добавить выбранных ({selected.size})</Btn>
      </MFoot>
    </MCard>
  );
}
