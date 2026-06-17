/**
 * Страница /seals — Реестр печатей.
 * Источник: vanilla `public/assets/js/seals.js` (~527 строк).
 *
 *   ✅ index.jsx               — root + KPI + фильтры + таблица + действия
 *   ✅ api.js                  — CRUD через /api/data/seals,/api/data/seal_transfers
 *   ✅ SealEditModal.jsx       — создание / редактирование
 *   ✅ SealTransferModal.jsx   — передача сотруднику / возврат в офис
 *   ✅ SealHistoryModal.jsx    — журнал передач (+ подтвердить получение)
 *   ✅ seals.css               — стили
 *
 * RBAC: см. ALLOWED_VIEW_ROLES. Удаление — только ADMIN.
 *
 * Действия со строкой:
 *   • 🔄 Передать
 *   • 📋 История
 *   • 🚨 Отметить «утеряна»
 *   • 🏢 Вернуть в офис (если у сотрудника или в transfer)
 *   • ✎  Редактировать
 *   • 🗑  Удалить (ADMIN)
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
  ALLOWED_VIEW_ROLES, SEAL_TYPES, SEAL_STATUSES,
  loadSeals, loadUsers, deleteSeal, markLost, returnToOffice,
  describeType, describeStatus, fmtDate, filterByQuery
} from './api';
import { SealEditModal } from './SealEditModal';
import { SealTransferModal } from './SealTransferModal';
import { SealHistoryModal } from './SealHistoryModal';
import './seals.css';

const TYPE_FILTERS = [{ value: '', label: 'Все типы' }, ...SEAL_TYPES];
const STATUS_FILTERS = [{ value: '', label: 'Все статусы' }, ...SEAL_STATUSES];

export default function SealsPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [seals, setSeals] = useState([]);
  const [users, setUsers] = useState([]);
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
    Promise.all([loadSeals(), loadUsers()])
      .then(([items, us]) => {
        setSeals(items);
        setUsers(us);
      })
      .catch((e) => toast.error('Не удалось загрузить печати: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [user?.id]);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:seals:changed', onChanged);
    return () => window.removeEventListener('asgard:seals:changed', onChanged);
    /* eslint-disable-next-line */
  }, []);

  const usersById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users]);

  const filtered = useMemo(() => {
    let v = seals.slice();
    v = filterByQuery(v, dSearch);
    if (filterType) v = v.filter((s) => s.type === filterType);
    if (filterStatus) v = v.filter((s) => s.status === filterStatus);
    v.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
    return v;
  }, [seals, dSearch, filterType, filterStatus]);

  const kpi = useMemo(() => {
    const c = { total: seals.length, office: 0, employee: 0, transfer: 0, lost: 0 };
    for (const s of seals) {
      if (c[s.status] !== undefined) c[s.status]++;
    }
    return c;
  }, [seals]);

  const onCreate = () => modal.open(<SealEditModal onSaved={refresh} />);
  const onEdit = (seal, e) => {
    e?.stopPropagation?.();
    modal.open(<SealEditModal seal={seal} onSaved={refresh} />);
  };
  const onTransfer = (seal, e) => {
    e?.stopPropagation?.();
    if (seal.status === 'lost') {
      toast.warn('Утерянную печать передавать нельзя — создайте новую');
      return;
    }
    modal.open(
      <SealTransferModal
        seal={seal}
        users={users}
        currentUserId={user?.id}
        onDone={refresh}
      />,
      { size: 'wide' }
    );
  };
  const onHistory = (seal, e) => {
    e?.stopPropagation?.();
    modal.open(
      <SealHistoryModal seal={seal} users={users} currentUserId={user?.id} onChanged={refresh} />,
      { size: 'wide' }
    );
  };
  const onMarkLost = (seal, e) => {
    e?.stopPropagation?.();
    modal.open(
      <ConfirmModal
        title="Отметить как «Утеряна»?"
        message={`Печать «${seal.name}» будет помечена как утерянная. Это серьёзный статус — действие пишется в журнал.`}
        tone="danger"
        okText="🚨 Отметить утерянной"
        onConfirm={async () => {
          try {
            await markLost(seal);
            toast.success('Печать помечена как утерянная');
            window.dispatchEvent(new CustomEvent('asgard:seals:changed'));
            refresh();
          } catch (err) {
            toast.error('Не удалось: ' + (err?.message || err));
          }
        }}
      />
    );
  };
  const onReturnOffice = (seal, e) => {
    e?.stopPropagation?.();
    modal.open(
      <ConfirmModal
        title="Вернуть в офис?"
        message={`Печать «${seal.name}» вернётся в офис, текущий держатель будет очищен.`}
        tone="warn"
        okText="🏢 Вернуть"
        onConfirm={async () => {
          try {
            await returnToOffice(seal);
            toast.success('Печать возвращена в офис');
            window.dispatchEvent(new CustomEvent('asgard:seals:changed'));
            refresh();
          } catch (err) {
            toast.error('Не удалось: ' + (err?.message || err));
          }
        }}
      />
    );
  };
  const onDelete = (seal, e) => {
    e?.stopPropagation?.();
    if (!isAdmin) {
      toast.warn('Удалять печати может только ADMIN');
      return;
    }
    modal.open(
      <ConfirmModal
        title="Удалить печать?"
        message={`Печать «${seal.name}» и её история передач будут удалены. Действие необратимо.`}
        tone="danger"
        okText="Удалить"
        onConfirm={async () => {
          try {
            await deleteSeal(seal.id);
            toast.success('Печать удалена');
            window.dispatchEvent(new CustomEvent('asgard:seals:changed'));
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
        <div className="c-t3">Раздел «Печати» доступен ADMIN, директорам и OFFICE_MANAGER.</div>
      </div>
    );
  }

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Документы"
        title="Реестр печатей"
        subtitle={`${filtered.length} из ${seals.length} в выборке`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="primary" onClick={onCreate}>+ Новая печать</Btn>
          </>
        }
      />

      <div className="seal-kpi">
        <div className="seal-kpi-card">
          <div className="seal-kpi-lab">Всего</div>
          <div className="seal-kpi-val">{kpi.total}</div>
        </div>
        <div className="seal-kpi-card brd-top-ok">
          <div className="seal-kpi-lab">В офисе</div>
          <div className="seal-kpi-val">{kpi.office}</div>
        </div>
        <div className="seal-kpi-card brd-top-info">
          <div className="seal-kpi-lab">У сотрудника</div>
          <div className="seal-kpi-val">{kpi.employee}</div>
        </div>
        <div className="seal-kpi-card" style={{ borderTop: '2px solid var(--amber, var(--warn-t))' }}>
          <div className="seal-kpi-lab">Передаётся</div>
          <div className="seal-kpi-val">{kpi.transfer}</div>
        </div>
        <div className="seal-kpi-card brd-top-err">
          <div className="seal-kpi-lab">Утеряно</div>
          <div className="seal-kpi-val">{kpi.lost}</div>
        </div>
      </div>

      <div className="seal-filter">
        <SearchInput value={search} onChange={setSearch} placeholder="Поиск по названию, инв.№…" />
        <SelectInput value={filterType} onChange={setFilterType} options={TYPE_FILTERS} />
        <SelectInput value={filterStatus} onChange={setFilterStatus} options={STATUS_FILTERS} />
      </div>

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем печати…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="🔖"
          title={search || filterType || filterStatus ? 'Ничего не нашли' : 'Печатей пока нет'}
          hint={search || filterType || filterStatus ? 'Попробуйте изменить фильтры' : 'Создайте первую через «+ Новая печать»'}
          action={null}
        />
      ) : (
        <div className="card card-pad-overflow">
          <div className="ov-x-auto">
            <table className="seal-table">
              <thead>
                <tr>
                  <th>Название</th>
                  <th className="w-180">Тип</th>
                  <th className="w-130">Инв. №</th>
                  <th>Держатель</th>
                  <th className="w-130">Срок до</th>
                  <th className="w-130">Статус</th>
                  <th className="w-240"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <SealRow
                    key={s.id}
                    seal={s}
                    holder={usersById[s.holder_id]}
                    onEdit={onEdit}
                    onTransfer={onTransfer}
                    onHistory={onHistory}
                    onMarkLost={onMarkLost}
                    onReturnOffice={onReturnOffice}
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

function SealRow({
  seal, holder, onEdit, onTransfer, onHistory,
  onMarkLost, onReturnOffice, onDelete, isAdmin
}) {
  const status = describeStatus(seal.status || 'office');
  const type = describeType(seal.type);

  return (
    <tr className="seal-row" onClick={(e) => onEdit(seal, e)}>
      <td className="seal-name">{seal.name || '—'}</td>
      <td>{type.label}</td>
      <td className="seal-dim">{seal.inv_number || '—'}</td>
      <td>
        {holder
          ? holder.name
          : seal.status === 'office'
            ? <span className="c-t3">В офисе</span>
            : '—'}
      </td>
      <td className="seal-dim">
        {seal.is_indefinite ? <span className="c-t3">Бессрочно</span> : fmtDate(seal.return_date)}
      </td>
      <td>
        <StatusBadge tone={status.tone} label={status.label} />
      </td>
      <td className="seal-actions" onClick={(e) => e.stopPropagation()}>
        <Btn size="sm" onClick={(e) => onTransfer(seal, e)} title="Передать">🔄</Btn>
        <Btn size="sm" variant="ghost" onClick={(e) => onHistory(seal, e)} title="История">📋</Btn>
        {(seal.status === 'employee' || seal.status === 'transfer') && (
          <Btn size="sm" variant="ghost" onClick={(e) => onReturnOffice(seal, e)} title="Вернуть в офис">🏢</Btn>
        )}
        {seal.status !== 'lost' && (
          <Btn size="sm" variant="ghost" onClick={(e) => onMarkLost(seal, e)} title="Отметить как утеряна">🚨</Btn>
        )}
        {isAdmin && (
          <Btn size="sm" variant="ghost" onClick={(e) => onDelete(seal, e)} title="Удалить">🗑</Btn>
        )}
      </td>
    </tr>
  );
}
