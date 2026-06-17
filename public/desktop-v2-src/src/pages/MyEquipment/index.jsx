/**
 * Страница /my-equipment — Моё оборудование (PM-карточка).
 *
 * Источник: vanilla `public/assets/js/my_equipment.js` (276 строк, AsgardMyEquipment).
 *
 *   ✅ index.jsx             ← root + KPI + поиск + таблица + multi-select
 *   ✅ api.js                ← endpoints + helpers
 *   ✅ ReturnModal.jsx       ← возврат на склад (выбранные позиции)
 *   ✅ TransferModal.jsx     ← запрос на передачу другому РП
 *
 * Доступ: любой залогиненный (бэк отдаёт `/by-holder/:userId` для текущего пользователя).
 * Эта страница для роли PM, но GET доступен всем — кладовщик может тоже посмотреть.
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast, StatusBadge } from '@/modals/Notifications';
import { Btn, Pill } from '@/modals/parts';
import { SearchInput } from '@/inputs/Inputs';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { useDebounce } from '@/api/useListHelpers';

import { ReturnModal } from './ReturnModal';
import { TransferModal } from './TransferModal';
import {
  loadMyEquipment, filterByQuery, conditionMeta, groupByCategory
} from './api';

export default function MyEquipmentPage() {
  const { user } = useAuth();
  const modal = useModal();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 300);  // G-11: debounce 300мс
  const [selected, setSelected] = useState(new Set());

  const refresh = () => {
    if (!user?.id) return;
    setLoading(true);
    loadMyEquipment(user.id)
      .then((list) => {
        setItems(Array.isArray(list) ? list : []);
        setSelected(new Set());
      })
      .catch((e) => toast.error('Не удалось загрузить оборудование: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [user?.id]);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:my-equipment:changed', onChanged);
    return () => window.removeEventListener('asgard:my-equipment:changed', onChanged);
    // eslint-disable-next-line
  }, [user?.id]);

  const visible = useMemo(() => filterByQuery(items, dq), [items, dq]);
  const grouped = useMemo(() => groupByCategory(visible), [visible]);

  const stats = useMemo(() => {
    const total = items.length;
    const issued = items.filter((e) => e.status === 'issued').length;
    const onObject = items.filter((e) => e.current_object_id).length;
    const onWork = items.filter((e) => e.work_id).length;
    const broken = items.filter((e) => e.condition === 'broken').length;
    return { total, issued, onObject, onWork, broken };
  }, [items]);

  const toggleId = (id) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === visible.length && visible.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visible.map((e) => e.id)));
    }
  };

  const selectedItems = useMemo(
    () => items.filter((e) => selected.has(e.id)),
    [items, selected]
  );

  const onReturn = () => {
    if (!selected.size) { toast.warn('Выберите оборудование для возврата'); return; }
    modal.open(
      <ReturnModal
        selectedIds={Array.from(selected)}
        items={selectedItems}
        onDone={() => {
          window.dispatchEvent(new CustomEvent('asgard:my-equipment:changed'));
          refresh();
        }}
      />,
      { size: 'wide' }
    );
  };

  const onTransfer = () => {
    if (!selected.size) { toast.warn('Выберите оборудование для передачи'); return; }
    modal.open(
      <TransferModal
        selectedIds={Array.from(selected)}
        items={selectedItems}
        currentUserId={user?.id}
        onDone={() => {
          window.dispatchEvent(new CustomEvent('asgard:my-equipment:changed'));
          refresh();
        }}
      />,
      { size: 'wide' }
    );
  };

  const subtitle = items.length > 0
    ? `${items.length} ед. на руках · ${stats.onObject} на объектах · ${stats.broken ? `${stats.broken} сломано` : 'всё исправно'}`
    : 'Оборудование, выданное вам, или брошенное на ваши объекты';

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Ресурсы"
        title="Моё оборудование"
        subtitle={subtitle}
        actions={<Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>}
      />

      {/* KPI */}
      {items.length > 0 && (
        <div className="grid-auto-150f gap-10">
          <KpiBox label="Всего" value={String(stats.total)} tone="gold" />
          <KpiBox label="На объектах" value={String(stats.onObject)} tone="ok" />
          <KpiBox label="К работам" value={String(stats.onWork)} tone="info" />
          {stats.broken > 0 && <KpiBox label="Сломано" value={String(stats.broken)} tone="err" />}
        </div>
      )}

      <div className="card p-12 row gap-10 u-wrap">
        <div className="min-w-200" style={{ flex: '1 1 280px' }}>
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="Поиск по названию, инв.№, серийнику, объекту…"
          />
        </div>
        <div className="row gap-6">
          {selected.size > 0 && (
            <Pill tone="gold">Выбрано: {selected.size}</Pill>
          )}
          <Btn
            variant="ghost"
            onClick={onTransfer}
            disabled={!selected.size}
          >
            📤 Запрос на передачу
          </Btn>
          <Btn
            variant="primary"
            onClick={onReturn}
            disabled={!selected.size}
          >
            📥 Вернуть на склад
          </Btn>
        </div>
      </div>

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем оборудование…
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon="📦"
          title={items.length === 0 ? 'У вас нет выданного оборудования' : 'Ничего не найдено'}
          hint={items.length === 0
            ? 'Когда кладовщик передаст оборудование на ваше имя — оно появится здесь.'
            : 'Попробуйте сбросить поиск.'}
          action={q ? <Btn variant="ghost" onClick={() => setQ('')}>Сбросить поиск</Btn> : null}
        />
      ) : (
        <div className="card card-pad-overflow">
          <div className="ov-x-auto">
            <table className="t-list tbl-base">
              <thead>
                <tr className="bg-inner brd-row-2">
                  <th className="pad-cell-lg w-36">
                    <input
                      type="checkbox"
                      checked={visible.length > 0 && selected.size === visible.length}
                      onChange={toggleAll}
                      aria-label="Выбрать все"
                    />
                  </th>
                  <Th>Инв. №</Th>
                  <Th>Наименование</Th>
                  <Th>Категория</Th>
                  <Th>Объект</Th>
                  <Th>Работа</Th>
                  <Th>Состояние</Th>
                </tr>
              </thead>
              <tbody>
                {Array.from(grouped.entries()).map(([categoryName, list]) => (
                  <Group key={categoryName} name={categoryName} count={list.length}>
                    {list.map((e) => {
                      const cond = conditionMeta(e.condition);
                      const isSelected = selected.has(e.id);
                      return (
                        <tr
                          key={e.id}
                          onClick={() => toggleId(e.id)}
                          className="row-hover cur-p tbl-row-brd"
                          style={{ background: isSelected ? 'var(--gold-bg)' : 'transparent' }}
                        >
                          <td className="pad-cell-lg" onClick={(ev) => ev.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleId(e.id)}
                            />
                          </td>
                          <td className="pad-cell-lg">
                            <code className="fs-12 c-t2">{e.inventory_number || '—'}</code>
                          </td>
                          <td className="pad-cell-lg">
                            <div className="fw-600 c-t1">
                              {e.category_icon ? <span className="mr-4">{e.category_icon}</span> : null}
                              {e.name}
                            </div>
                            {e.serial_number && (
                              <div className="fs-11 c-t3 mt-2">
                                S/N: {e.serial_number}
                              </div>
                            )}
                          </td>
                          <td className="pad-cell-lg c-t2">{e.category_name || '—'}</td>
                          <td className="pad-cell-lg c-t2">
                            {e.object_name ? `📍 ${e.object_name}` : '—'}
                          </td>
                          <td className="pad-cell-lg c-t2">
                            {e.work_number ? `📋 ${e.work_number}` : (e.work_id ? `#${e.work_id}` : '—')}
                          </td>
                          <td className="pad-cell-lg">
                            <StatusBadge tone={cond.tone} label={cond.label} />
                          </td>
                        </tr>
                      );
                    })}
                  </Group>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({ children }) {
  return (
    <th className="pad-cell-lg t-left c-t2 fs-13 fw-600 u-nowrap-cell">
      {children}
    </th>
  );
}

function Group({ name, count, children }) {
  return (
    <>
      <tr className="bg-inner">
        <td colSpan={7} className="fs-11 c-t3 upper fw-700 pad-cell-md">
          {name} · {count}
        </td>
      </tr>
      {children}
    </>
  );
}

function KpiBox({ label, value, tone = 'default' }) {
  const cls = tone === 'gold' ? 'tone-gold'
    : tone === 'ok' ? 'tone-ok'
    : tone === 'info' ? 'tone-info'
    : tone === 'err' ? 'tone-err'
    : 'tone-mute';
  return (
    <div className={'kpi-tile ' + cls}>
      <div className="kpi-tile-lbl">{label}</div>
      <div className="kpi-tile-val-lg mt-4">{value}</div>
    </div>
  );
}
