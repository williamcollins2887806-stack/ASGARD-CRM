/**
 * Страница /contracts — Реестр договоров.
 * Источник: vanilla `public/assets/js/contracts.js` (~1332 строк).
 *
 *   ✅ index.jsx              — root + KPI + фильтры + таблица + действия
 *   ✅ api.js                 — CRUD через /api/data/contracts
 *   ✅ ContractEditModal.jsx  — создание / редактирование
 *   ✅ contracts.css          — стили
 *
 * Действия со строкой:
 *   • 👁  Открыть (то же что редактирование, без удаления)
 *   • ✎  Редактировать
 *   • 🗑  Удалить (ADMIN)
 *
 * RBAC просмотра: см. ALLOWED_VIEW_ROLES (PM, HEAD_PM, BUH, OFFICE_MANAGER, директора, ADMIN)
 * RBAC удаления: ADMIN
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal, ConfirmModal } from '@/modals';
import { toast, StatusBadge } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { useDebounce, useListPagination, Pager } from '@/api/useListHelpers';

import {
  ALLOWED_VIEW_ROLES, CONTRACT_TYPES, COMPUTED_STATUSES,
  loadContracts, loadCustomers, deleteContract,
  computeStatus, describeStatus, fmtDate, fmtMoney, filterByQuery
} from './api';
import { ContractEditModal } from './ContractEditModal';
import './contracts.css';

const TYPE_FILTERS = [
  { value: '', label: 'Все типы' },
  ...CONTRACT_TYPES
];
const STATUS_FILTERS = [
  { value: '', label: 'Все статусы' },
  ...COMPUTED_STATUSES.filter((s) => s.value !== 'draft')
];

export default function ContractsPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [list, setList] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // G-11: debounce 300мс — Реестр загружает limit=2000 договоров, без debounce фильтрация на каждый символ тормозит.
  const dSearch = useDebounce(search, 300);
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const isAdmin = user?.role === 'ADMIN';
  const allowed = !user || ALLOWED_VIEW_ROLES.includes(user.role);

  const refresh = () => {
    if (!allowed) return;
    setLoading(true);
    Promise.all([loadContracts(), loadCustomers()])
      .then(([items, custs]) => {
        const enriched = items.map((c) => ({
          ...c,
          _status: computeStatus(c)
        }));
        setList(enriched);
        setCustomers(custs);
      })
      .catch((e) => toast.error('Не удалось загрузить договоры: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [user?.id]);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:contracts:changed', onChanged);
    return () => window.removeEventListener('asgard:contracts:changed', onChanged);
    /* eslint-disable-next-line */
  }, []);

  const customersByInn = useMemo(
    () => Object.fromEntries(customers.map((c) => [String(c.inn), c])),
    [customers]
  );

  const filtered = useMemo(() => {
    let v = list.slice();
    v = filterByQuery(v, dSearch);
    if (filterType) v = v.filter((c) => c.type === filterType);
    if (filterStatus) v = v.filter((c) => c._status === filterStatus);
    v.sort((a, b) => (b.id || 0) - (a.id || 0));
    return v;
  }, [list, dSearch, filterType, filterStatus]);

  // G-11: пагинация (PAGE=25, как в Tenders/PmWorks). До 2000 записей — без пагинации лагает рендер.
  const { setPage, pages, safePage, slice } = useListPagination(filtered, {
    pageSize: 25,
    resetDeps: [dSearch, filterType, filterStatus]
  });

  const kpi = useMemo(() => {
    let active = 0, expiring = 0, expired = 0, terminated = 0, totalSum = 0;
    for (const c of list) {
      if (c._status === 'active') active++;
      else if (c._status === 'expiring') expiring++;
      else if (c._status === 'expired') expired++;
      else if (c._status === 'terminated') terminated++;
      if (c._status === 'active' || c._status === 'expiring') {
        const v = parseFloat(c.amount);
        if (Number.isFinite(v)) totalSum += v;
      }
    }
    return { total: list.length, active, expiring, expired, terminated, totalSum };
  }, [list]);

  const onCreate = () => {
    modal.open(
      <ContractEditModal customers={customers} onSaved={refresh} />,
      { size: 'wide' }
    );
  };
  const onOpen = (c) => {
    modal.open(
      <ContractEditModal contract={c} customers={customers} onSaved={refresh} />,
      { size: 'wide' }
    );
  };
  const onDelete = (c, e) => {
    e?.stopPropagation?.();
    if (!isAdmin) {
      toast.warn('Удалять договоры может только ADMIN');
      return;
    }
    modal.open(
      <ConfirmModal
        title="Удалить договор?"
        message={`Договор № ${c.number || c.id} будет удалён без возможности восстановления.`}
        tone="danger"
        okText="Удалить"
        onConfirm={async () => {
          try {
            await deleteContract(c.id);
            toast.success('Договор удалён');
            refresh();
          } catch (err) {
            toast.error('Не удалось удалить: ' + (err?.message || err));
          }
        }}
      />
    );
  };

  if (!allowed) {
    return (
      <div className="card p-32 t-center" >
        <div className="fs-32 mb-12">🛡</div>
        <div className="fs-16 fw-700 mb-6">Нет доступа</div>
        <div className="c-t3">Раздел «Договоры» доступен ADMIN, директорам, OFFICE_MANAGER, BUH, PM и HEAD_PM.</div>
      </div>
    );
  }

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Документы"
        title="Реестр договоров"
        subtitle={`${filtered.length} из ${list.length} в выборке`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="primary" onClick={onCreate}>+ Новый договор</Btn>
          </>
        }
      />

      <div className="ctr-kpi">
        <div className="ctr-kpi-card">
          <div className="ctr-kpi-lab">Всего</div>
          <div className="ctr-kpi-val">{kpi.total}</div>
        </div>
        <div className="ctr-kpi-card brd-top-ok">
          <div className="ctr-kpi-lab">Действуют</div>
          <div className="ctr-kpi-val">{kpi.active}</div>
        </div>
        <div className="ctr-kpi-card" style={{ borderTop: '2px solid var(--amber, var(--warn-t))' }}>
          <div className="ctr-kpi-lab">Истекают (30д)</div>
          <div className="ctr-kpi-val">{kpi.expiring}</div>
        </div>
        <div className="ctr-kpi-card brd-top-err">
          <div className="ctr-kpi-lab">Истекли</div>
          <div className="ctr-kpi-val">{kpi.expired}</div>
        </div>
        <div className="ctr-kpi-card brd-top-gold">
          <div className="ctr-kpi-lab">Сумма действующих</div>
          <div className="ctr-kpi-val">{fmtMoney(kpi.totalSum)}</div>
        </div>
      </div>

      <div className="ctr-filter">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Поиск по номеру, предмету, контрагенту…"
        />
        <SelectInput value={filterType} onChange={setFilterType} options={TYPE_FILTERS} />
        <SelectInput value={filterStatus} onChange={setFilterStatus} options={STATUS_FILTERS} />
      </div>

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем договоры…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="📄"
          title={search || filterType || filterStatus ? 'Ничего не нашли' : 'Договоров пока нет'}
          hint={search || filterType || filterStatus ? 'Попробуйте изменить фильтры' : 'Создайте первый через «+ Новый договор»'}
          action={null}
        />
      ) : (
        <div className="card card-pad-overflow">
          <div className="ov-x-auto">
            <table className="ctr-table">
              <thead>
                <tr>
                  <th className="w-130">№</th>
                  <th className="w-130">Тип</th>
                  <th>Контрагент</th>
                  <th>Предмет</th>
                  <th className="w-110">Дата</th>
                  <th className="w-130">Срок до</th>
                  <th className="w-140">Сумма</th>
                  <th className="w-130">Статус</th>
                  <th className="w-110"></th>
                </tr>
              </thead>
              <tbody>
                {slice.map((c) => (
                  <ContractRow
                    key={c.id}
                    contract={c}
                    customer={customersByInn[String(c.counterparty_id)]}
                    onOpen={onOpen}
                    onDelete={onDelete}
                    isAdmin={isAdmin}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <Pager safePage={safePage} pages={pages} total={filtered.length} onPage={setPage} />
        </div>
      )}
    </div>
  );
}

function ContractRow({ contract, customer, onOpen, onDelete, isAdmin }) {
  const c = contract;
  const typeLabel = CONTRACT_TYPES.find((t) => t.value === c.type)?.label || c.type || '—';
  const status = describeStatus(c._status);
  const counterpartyName = customer?.name || customer?.full_name || c.counterparty_name || '—';

  return (
    <tr className="ctr-row" onClick={() => onOpen(c)}>
      <td className="ctr-num">{c.number || '—'}</td>
      <td>
        <StatusBadge tone={c.type === 'customer' ? 'approved' : 'sent'} label={typeLabel} />
      </td>
      <td>{counterpartyName}</td>
      <td className="ctr-subject" title={c.subject || ''}>{c.subject || '—'}</td>
      <td className="ctr-dim">{fmtDate(c.start_date)}</td>
      <td className="ctr-dim">
        {c.is_perpetual ? <span className="c-t3">Бессрочный</span> : fmtDate(c.end_date)}
      </td>
      <td className="ctr-dim">{c.amount ? fmtMoney(c.amount) : '—'}</td>
      <td>
        <StatusBadge tone={status.tone} label={status.label} />
      </td>
      <td className="ctr-actions" onClick={(e) => e.stopPropagation()}>
        <Btn size="sm" onClick={() => onOpen(c)} title="Открыть / редактировать">✎</Btn>
        {isAdmin && (
          <Btn size="sm" variant="ghost" onClick={(e) => onDelete(c, e)} title="Удалить">🗑</Btn>
        )}
      </td>
    </tr>
  );
}
