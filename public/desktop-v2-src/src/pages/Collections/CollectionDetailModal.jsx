/**
 * CollectionDetailModal — карточка подборки со списком сотрудников.
 *
 * Доступно:
 *  - список сотрудников в подборке
 *  - удалить сотрудника
 *  - + добавить сотрудников
 */
import { useState, useEffect, useMemo } from 'react';
import { useModal, ConfirmModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { SearchInput, Checkbox } from '@/inputs/Inputs';
import { EmptyState } from '@/blocks/Blocks';
import { loadCollection, addEmployees, removeEmployee, loadAllEmployees } from './api';

function emit() { window.dispatchEvent(new CustomEvent('asgard:collections:changed')); }

export function CollectionDetailModal({ collectionId, onChanged }) {
  const { close, open } = useModal();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    loadCollection(collectionId)
      .then(setData)
      .catch((e) => toast.error('Не удалось загрузить: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [collectionId]);

  const collection = data?.collection;
  const employees = data?.employees || [];

  const onRemove = (emp) => {
    open(
      <ConfirmModal
        tone="danger"
        title="Убрать из подборки?"
        message={`Сотрудник «${emp.fio || emp.full_name}» будет убран из подборки.`}
        onConfirm={async () => {
          try {
            await removeEmployee(collectionId, emp.id);
            toast.success('Удалён');
            emit();
            refresh();
            onChanged?.();
          } catch (e) {
            toast.error('Не удалось убрать: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const onAddOpen = () => {
    open(
      <AddEmployeesModal
        collectionId={collectionId}
        existingIds={employees.map((e) => e.id)}
        onAdded={() => { refresh(); onChanged?.(); emit(); }}
      />,
      { size: 'wide' }
    );
  };

  return (
    <MCard>
      <MHead
        icon="📋"
        title={collection?.name || '...'}
        subtitle={collection?.description || `${employees.length} сотрудников`}
        accent="gold"
        onClose={close}
      />
      <MBody>
        {loading ? (
          <div className="t-center p-32 c-t3">⏳ Загрузка…</div>
        ) : employees.length === 0 ? (
          <EmptyState
            icon="👤"
            title="Подборка пуста"
            hint="Нажмите «+ Добавить сотрудников» внизу"
            action={null}
          />
        ) : (
          <div className="col gap-6">
            {employees.map((emp) => (
              <div
                key={emp.id}
                style={{
                  padding: '10px 14px',
                  background: 'var(--inner-bg)',
                  borderRadius: 'var(--r-sm)',
                  display: 'grid',
                  gridTemplateColumns: '1fr 110px 90px 40px',
                  gap: 12,
                  alignItems: 'center'
                }}
              >
                <div>
                  <div className="fw-700 fs-13">{emp.fio || emp.full_name || '—'}</div>
                  <div className="fs-11 c-t3">{emp.role_tag || ''} · {emp.city || ''}</div>
                </div>
                <div className="fs-12 c-t2">{emp.phone || ''}</div>
                <div className="fs-12">
                  {emp.rating_avg
                    ? <span className="c-gold">★ {Number(emp.rating_avg).toFixed(1)}</span>
                    : <span style={{ color: 'var(--t-4)' }}>—</span>}
                </div>
                <button
                  className="m-btn ghost py-4 px-8 c-err"
                  onClick={() => onRemove(emp)}
                  title="Убрать"
                >✕</button>
              </div>
            ))}
          </div>
        )}
      </MBody>
      <MFoot align="spread">
        <Btn variant="ghost" onClick={close}>Закрыть</Btn>
        <Btn variant="primary" onClick={onAddOpen}>+ Добавить сотрудников</Btn>
      </MFoot>
    </MCard>
  );
}

function AddEmployeesModal({ collectionId, existingIds, onAdded }) {
  const { close } = useModal();
  const [all, setAll] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLoading(true);
    loadAllEmployees()
      .then((emps) => {
        const exclude = new Set(existingIds);
        setAll(emps.filter((e) => !exclude.has(e.id)));
      })
      .catch(() => setAll([]))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => {
    if (!query.trim()) return all;
    const lq = query.toLowerCase();
    return all.filter((e) =>
      (e.fio || '').toLowerCase().includes(lq) ||
      (e.full_name || '').toLowerCase().includes(lq) ||
      (e.role_tag || '').toLowerCase().includes(lq) ||
      (e.city || '').toLowerCase().includes(lq)
    );
  }, [all, query]);

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const onSave = async () => {
    if (selected.size === 0) {
      toast.error('Выберите хотя бы одного');
      return;
    }
    setBusy(true);
    try {
      const r = await addEmployees(collectionId, Array.from(selected));
      toast.success(`Добавлено: ${r?.added || selected.size}`);
      onAdded?.();
      close();
    } catch (e) {
      toast.error('Не удалось добавить: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon="➕"
        title="Добавить в подборку"
        subtitle={`Выбрано: ${selected.size}`}
        accent="gold"
        onClose={close}
      />
      <MBody style={{ minHeight: 400 }}>
        <div className="mb-10">
          <SearchInput value={query} onChange={setQuery} placeholder="Поиск по ФИО, роли, городу…" />
        </div>
        {loading ? (
          <div className="t-center p-24 c-t3">⏳ Загрузка…</div>
        ) : visible.length === 0 ? (
          <div className="t-center p-24 c-t3">
            {query ? 'Не найдено' : 'Все сотрудники уже в подборке'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 480, overflowY: 'auto' }}>
            {visible.map((emp) => {
              const isOn = selected.has(emp.id);
              return (
                <label
                  key={emp.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    background: isOn ? 'var(--gold-bg)' : 'var(--inner-bg)',
                    border: isOn ? '1px solid var(--gold)' : '1px solid transparent',
                    borderRadius: 'var(--r-sm)',
                    cursor: 'pointer'
                  }}
                >
                  <Checkbox checked={isOn} onChange={() => toggle(emp.id)} />
                  <div className="flex-1">
                    <div className="fw-700 fs-13">{emp.fio || emp.full_name || '—'}</div>
                    <div className="fs-11 c-t3">
                      {emp.role_tag || ''} · {emp.city || ''}{emp.phone ? ' · ' + emp.phone : ''}
                    </div>
                  </div>
                  {emp.rating_avg && (
                    <span style={{ color: 'var(--gold)', fontSize: 12, fontWeight: 700 }}>
                      ★ {Number(emp.rating_avg).toFixed(1)}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        )}
      </MBody>
      <MFoot align="spread">
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" onClick={onSave} disabled={busy || selected.size === 0}>
          {busy ? 'Добавляем…' : `Добавить (${selected.size})`}
        </Btn>
      </MFoot>
    </MCard>
  );
}
