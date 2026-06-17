/**
 * Страница /proxies — Реестр доверенностей.
 * Источник: vanilla `public/assets/js/proxies.js` (~688 строк).
 *
 *   ✅ index.jsx                  — root + KPI + фильтры + таблица + действия
 *   ✅ api.js                     — CRUD через /api/data/proxies + .doc-генератор
 *   ✅ ProxyTypePickerModal.jsx   — выбор шаблона при создании
 *   ✅ ProxyEditModal.jsx         — форма по шаблону (поля + срок + .doc)
 *   ✅ proxies.css                — стили
 *
 * RBAC просмотра: ADMIN, OFFICE_MANAGER, директора.
 * Действия со строкой:
 *   • ✎ Редактировать
 *   • 📄 Скачать .doc
 *   • ⛔ Отозвать (status=revoked) — если ещё активна
 *   • 🗑 Удалить (ADMIN)
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal, ConfirmModal } from '@/modals';
import { toast, StatusBadge } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { useDebounce } from '@/api/useListHelpers';

import {
  ALLOWED_VIEW_ROLES, PROXY_TYPES,
  STATUS_FILTERS, TYPE_FILTERS,
  loadProxies, updateProxy, deleteProxy,
  computeStatus, describeStatus, findTypeByLabel,
  fmtDate, filterByQuery, downloadDoc
} from './api';
import { ProxyTypePickerModal } from './ProxyTypePickerModal';
import { ProxyEditModal } from './ProxyEditModal';
import './proxies.css';

export default function ProxiesPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const dSearch = useDebounce(search, 300);  // G-11: debounce 300мс
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const isAdmin = user?.role === 'ADMIN';
  const allowed = !user || ALLOWED_VIEW_ROLES.includes(user.role);

  const refresh = () => {
    if (!allowed) return;
    setLoading(true);
    loadProxies()
      .then((items) => {
        const enriched = items.map((r) => ({ ...r, _status: computeStatus(r) }));
        setList(enriched);
      })
      .catch((e) => toast.error('Не удалось загрузить доверенности: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [user?.id]);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:proxies:changed', onChanged);
    return () => window.removeEventListener('asgard:proxies:changed', onChanged);
    /* eslint-disable-next-line */
  }, []);

  const filtered = useMemo(() => {
    let v = list.slice();
    v = filterByQuery(v, dSearch);
    if (filterType) v = v.filter((r) => r.type === filterType);
    if (filterStatus) v = v.filter((r) => r._status === filterStatus);
    return v;
  }, [list, dSearch, filterType, filterStatus]);

  const kpi = useMemo(() => {
    let active = 0, expiring = 0, expired = 0, revoked = 0;
    for (const r of list) {
      if (r._status === 'active') active++;
      else if (r._status === 'expiring') expiring++;
      else if (r._status === 'expired') expired++;
      else if (r._status === 'revoked') revoked++;
    }
    return { total: list.length, active, expiring, expired, revoked };
  }, [list]);

  const onCreate = () => {
    modal.open(
      <ProxyTypePickerModal
        onPick={(type) => modal.open(
          <ProxyEditModal type={type} onSaved={refresh} />,
          { size: 'wide' }
        )}
      />,
      { size: 'wide' }
    );
  };

  const onEdit = (proxy) => {
    const type = findTypeByLabel(proxy.type);
    modal.open(<ProxyEditModal type={type} proxy={proxy} onSaved={refresh} />, { size: 'wide' });
  };

  const onDownload = (proxy, e) => {
    e?.stopPropagation?.();
    const type = findTypeByLabel(proxy.type);
    downloadDoc(proxy, type);
    toast.success('Документ скачан');
  };

  const onRevoke = (proxy, e) => {
    e?.stopPropagation?.();
    modal.open(
      <ConfirmModal
        title="Отозвать доверенность?"
        message={`Доверенность № ${proxy.number || proxy.id} (${proxy.fio || '—'}) будет отозвана.`}
        tone="danger"
        okText="⛔ Отозвать"
        onConfirm={async () => {
          try {
            await updateProxy(proxy.id, { status: 'revoked' });
            toast.success('Доверенность отозвана');
            window.dispatchEvent(new CustomEvent('asgard:proxies:changed'));
            refresh();
          } catch (err) {
            toast.error('Не удалось отозвать: ' + (err?.message || err));
          }
        }}
      />
    );
  };

  const onDelete = (proxy, e) => {
    e?.stopPropagation?.();
    if (!isAdmin) {
      toast.warn('Удалять доверенности может только ADMIN');
      return;
    }
    modal.open(
      <ConfirmModal
        title="Удалить доверенность?"
        message={`Доверенность № ${proxy.number || proxy.id} будет удалена без возможности восстановления.`}
        tone="danger"
        okText="Удалить"
        onConfirm={async () => {
          try {
            await deleteProxy(proxy.id);
            toast.success('Доверенность удалена');
            window.dispatchEvent(new CustomEvent('asgard:proxies:changed'));
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
        <div className="c-t3">Раздел «Доверенности» доступен ADMIN, директорам и OFFICE_MANAGER.</div>
      </div>
    );
  }

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Документы"
        title="Реестр доверенностей"
        subtitle={`${filtered.length} из ${list.length} в выборке`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="primary" onClick={onCreate}>+ Создать доверенность</Btn>
          </>
        }
      />

      <div className="prx-kpi">
        <div className="prx-kpi-card">
          <div className="prx-kpi-lab">Всего</div>
          <div className="prx-kpi-val">{kpi.total}</div>
        </div>
        <div className="prx-kpi-card brd-top-ok">
          <div className="prx-kpi-lab">Действуют</div>
          <div className="prx-kpi-val">{kpi.active}</div>
        </div>
        <div className="prx-kpi-card" style={{ borderTop: '2px solid var(--amber, var(--warn-t))' }}>
          <div className="prx-kpi-lab">Истекают (30д)</div>
          <div className="prx-kpi-val">{kpi.expiring}</div>
        </div>
        <div className="prx-kpi-card brd-top-err">
          <div className="prx-kpi-lab">Истекли</div>
          <div className="prx-kpi-val">{kpi.expired}</div>
        </div>
        <div className="prx-kpi-card brd-top-t3">
          <div className="prx-kpi-lab">Отозваны</div>
          <div className="prx-kpi-val">{kpi.revoked}</div>
        </div>
      </div>

      <div className="prx-filter">
        <SearchInput value={search} onChange={setSearch} placeholder="Поиск по ФИО, номеру…" />
        <SelectInput value={filterType} onChange={setFilterType} options={TYPE_FILTERS} />
        <SelectInput value={filterStatus} onChange={setFilterStatus} options={STATUS_FILTERS} />
      </div>

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем доверенности…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="📜"
          title={search || filterType || filterStatus ? 'Ничего не нашли' : 'Доверенностей пока нет'}
          hint={search || filterType || filterStatus ? 'Попробуйте изменить фильтры' : 'Создайте первую через «+ Создать доверенность»'}
          action={null}
        />
      ) : (
        <div className="card card-pad-overflow">
          <div className="ov-x-auto">
            <table className="prx-table">
              <thead>
                <tr>
                  <th className="w-70">#</th>
                  <th className="w-140">Номер</th>
                  <th className="w-200">Тип</th>
                  <th>На кого (ФИО)</th>
                  <th className="w-120">Выдана</th>
                  <th className="w-130">Действует до</th>
                  <th className="w-130">Статус</th>
                  <th className="w-170"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <ProxyRow
                    key={r.id}
                    proxy={r}
                    onEdit={onEdit}
                    onDownload={onDownload}
                    onRevoke={onRevoke}
                    onDelete={onDelete}
                    isAdmin={isAdmin}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ProxyRow({ proxy, onEdit, onDownload, onRevoke, onDelete, isAdmin }) {
  const r = proxy;
  const status = describeStatus(r._status);
  const typeFound = PROXY_TYPES.find((t) => t.label === r.type);
  const icon = typeFound?.icon || '📜';
  const canRevoke = r._status !== 'revoked' && r._status !== 'expired';

  return (
    <tr className="prx-row" onClick={() => onEdit(r)}>
      <td className="prx-dim">{r.id}</td>
      <td className="prx-num">{r.number || '—'}</td>
      <td><span className="mr-6">{icon}</span>{r.type || '—'}</td>
      <td>{r.fio || r.employee_name || '—'}</td>
      <td className="prx-dim">{fmtDate(r.issue_date)}</td>
      <td className="prx-dim">{fmtDate(r.valid_until)}</td>
      <td><StatusBadge tone={status.tone} label={status.label} /></td>
      <td className="prx-actions" onClick={(e) => e.stopPropagation()}>
        <Btn size="sm" variant="ghost" onClick={(e) => onDownload(r, e)} title=".doc">📄</Btn>
        {canRevoke && (
          <Btn size="sm" variant="ghost" onClick={(e) => onRevoke(r, e)} title="Отозвать">⛔</Btn>
        )}
        {isAdmin && (
          <Btn size="sm" variant="ghost" onClick={(e) => onDelete(r, e)} title="Удалить">🗑</Btn>
        )}
      </td>
    </tr>
  );
}
