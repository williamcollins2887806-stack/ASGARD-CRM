/**
 * /proxies — унитарный реестр доверенностей (без KPI).
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
  ALLOWED_VIEW_ROLES,
  STATUS_FILTERS, TYPE_FILTERS,
  loadProxies, updateProxy, deleteProxy, importRegistry,
  computeStatus, describeStatus, findType,
  fmtDate, filterByQuery, downloadDocx
} from './api';
import { ProxyTypePickerModal } from './ProxyTypePickerModal';
import { ProxyEditModal } from './ProxyEditModal';
import { ProxyExternalModal } from './ProxyExternalModal';
import { ProxyStatusModal, ProxySendModal } from './ProxyActionModals';
import './proxies.css';

export default function ProxiesPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const dSearch = useDebounce(search, 300);
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const isAdmin = user?.role === 'ADMIN';
  const allowed = !user || ALLOWED_VIEW_ROLES.includes(user.role);

  const refresh = () => {
    if (!allowed) return;
    setLoading(true);
    loadProxies()
      .then((items) => {
        setList(items.map((r) => ({ ...r, _status: computeStatus(r) })));
      })
      .catch((e) => toast.error('Не удалось загрузить: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [user?.id]);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:proxies:changed', onChanged);
    return () => window.removeEventListener('asgard:proxies:changed', onChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    let v = filterByQuery(list, dSearch);
    if (filterType) v = v.filter((r) => (r.type_id || findType(r.type).id) === filterType);
    if (filterStatus) v = v.filter((r) => r._status === filterStatus || (filterStatus === 'annulled' && r._status === 'revoked'));
    return v;
  }, [list, dSearch, filterType, filterStatus]);

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

  const onExternal = () => {
    modal.open(<ProxyExternalModal onSaved={refresh} />, { size: 'md' });
  };

  const onEdit = (proxy) => {
    const type = findType(proxy.type_id || proxy.type);
    modal.open(<ProxyEditModal type={type} proxy={proxy} onSaved={refresh} />, { size: 'wide' });
  };

  const onCopy = (proxy, e) => {
    e?.stopPropagation?.();
    const type = findType(proxy.type_id || proxy.type);
    modal.open(
      <ProxyEditModal type={type} copyFrom={proxy} onSaved={refresh} />,
      { size: 'wide' }
    );
  };

  const onDownload = async (proxy, e) => {
    e?.stopPropagation?.();
    try {
      if (proxy.source === 'external' && proxy.external_file_url) {
        window.open(proxy.external_file_url, '_blank');
      } else if (proxy.signed_file_url && e?.shiftKey) {
        window.open(proxy.signed_file_url, '_blank');
      } else {
        await downloadDocx(proxy.id);
      }
      toast.success('Скачано');
    } catch (err) {
      toast.error('Не удалось скачать: ' + (err?.message || err));
    }
  };

  const onAnnul = (proxy, e) => {
    e?.stopPropagation?.();
    modal.open(
      <ConfirmModal
        title="Аннулировать доверенность?"
        message={`Доверенность № ${proxy.number || proxy.id} будет аннулирована.`}
        tone="danger"
        okText="Аннулировать"
        onConfirm={async () => {
          try {
            await updateProxy(proxy.id, { status: 'annulled' });
            toast.success('Аннулирована');
            window.dispatchEvent(new CustomEvent('asgard:proxies:changed'));
            refresh();
          } catch (err) {
            toast.error('Ошибка: ' + (err?.message || err));
          }
        }}
      />
    );
  };

  const onStatus = (proxy, e) => {
    e?.stopPropagation?.();
    modal.open(<ProxyStatusModal proxy={proxy} onDone={refresh} />, { size: 'sm' });
  };

  const onSend = (proxy, e) => {
    e?.stopPropagation?.();
    modal.open(<ProxySendModal proxy={proxy} onDone={refresh} />, { size: 'sm' });
  };

  const onDelete = (proxy, e) => {
    e?.stopPropagation?.();
    if (!isAdmin) {
      toast.warn('Удалять может только ADMIN');
      return;
    }
    modal.open(
      <ConfirmModal
        title="Удалить доверенность?"
        message={`№ ${proxy.number || proxy.id} будет удалена без восстановления.`}
        tone="danger"
        okText="Удалить"
        onConfirm={async () => {
          try {
            await deleteProxy(proxy.id);
            toast.success('Удалено');
            window.dispatchEvent(new CustomEvent('asgard:proxies:changed'));
            refresh();
          } catch (err) {
            toast.error('Ошибка: ' + (err?.message || err));
          }
        }}
      />
    );
  };

  if (!allowed) {
    return (
      <div className="card p-32 t-center">
        <div className="fs-16 fw-700 mb-6">Нет доступа</div>
        <div className="c-t3">Раздел доступен ADMIN, директорам и OFFICE_MANAGER.</div>
      </div>
    );
  }

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Документы"
        title="Доверенности"
        subtitle={loading ? 'Загрузка…' : `${filtered.length} из ${list.length}`}
        actions={
          <>
            {isAdmin && (
              <Btn variant="ghost" onClick={async () => {
                try {
                  const r = await importRegistry();
                  toast.success(`Импорт: +${r.created || 0}, пропуск ${r.skipped || 0}`);
                  refresh();
                } catch (e) {
                  toast.error(e?.message || 'Импорт не удался');
                }
              }}>Импорт Excel</Btn>
            )}
            <Btn variant="ghost" onClick={onExternal}>Прикрепить внешнюю</Btn>
            <Btn variant="primary" onClick={onCreate}>Создать</Btn>
          </>
        }
      />

      <div className="prx-filter">
        <SearchInput value={search} onChange={setSearch} placeholder="Поиск по ФИО, номеру…" />
        <SelectInput value={filterType} onChange={setFilterType} options={TYPE_FILTERS} />
        <SelectInput value={filterStatus} onChange={setFilterStatus} options={STATUS_FILTERS} />
      </div>

      {loading ? (
        <div className="card card-empty">Загружаем…</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={search || filterType || filterStatus ? 'Ничего не нашли' : 'Доверенностей пока нет'}
          hint={search || filterType || filterStatus ? 'Измените фильтры' : 'Создайте первую доверенность'}
          action={<Btn variant="primary" onClick={onCreate}>Создать</Btn>}
        />
      ) : (
        <div className="card card-pad-overflow">
          <div className="ov-x-auto">
            <table className="prx-table">
              <thead>
                <tr>
                  <th>Номер</th>
                  <th>Представитель</th>
                  <th>Тип</th>
                  <th>Выдана</th>
                  <th>До</th>
                  <th>Статус</th>
                  <th>Файлы</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <ProxyRow
                    key={r.id}
                    proxy={r}
                    isAdmin={isAdmin}
                    onEdit={onEdit}
                    onDownload={onDownload}
                    onCopy={onCopy}
                    onAnnul={onAnnul}
                    onStatus={onStatus}
                    onSend={onSend}
                    onDelete={onDelete}
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

function ProxyRow({
  proxy: r, isAdmin,
  onEdit, onDownload, onCopy, onAnnul, onStatus, onSend, onDelete
}) {
  const status = describeStatus(r._status);
  const typeFound = findType(r.type_id || r.type);
  const canAnnul = r._status !== 'annulled' && r._status !== 'expired';

  return (
    <tr className="prx-row" onClick={() => onEdit(r)}>
      <td className="prx-num">{r.number || '—'}</td>
      <td>
        <div>{r.fio || r.employee_name || '—'}</div>
        {r.phone ? <div className="prx-dim">{r.phone}</div> : null}
      </td>
      <td>{typeFound?.label || r.type || '—'}</td>
      <td className="prx-dim">{fmtDate(r.issue_date)}</td>
      <td className="prx-dim">{fmtDate(r.valid_until)}</td>
      <td><StatusBadge tone={status.tone} label={status.label} /></td>
      <td className="prx-files">
        {r.source !== 'external' && <span className="prx-file-dot" title="Бланк CRM">CRM</span>}
        {r.external_file_url && <span className="prx-file-dot is-ext" title="Внешний файл">Внеш</span>}
        {r.signed_file_url && <span className="prx-file-dot is-sign" title="Подписанный скан">Подп</span>}
      </td>
      <td className="prx-actions" onClick={(e) => e.stopPropagation()}>
        <Btn size="sm" variant="ghost" onClick={(e) => onDownload(r, e)} title="Скачать">↓</Btn>
        <Btn size="sm" variant="ghost" onClick={(e) => onCopy(r, e)} title="Копировать">⧉</Btn>
        <Btn size="sm" variant="ghost" onClick={(e) => onSend(r, e)} title="Отправить">✉</Btn>
        <Btn size="sm" variant="ghost" onClick={(e) => onStatus(r, e)} title="Статус">↻</Btn>
        {canAnnul && (
          <Btn size="sm" variant="ghost" onClick={(e) => onAnnul(r, e)} title="Аннулировать">✕</Btn>
        )}
        {isAdmin && (
          <Btn size="sm" variant="ghost" onClick={(e) => onDelete(r, e)} title="Удалить">⌫</Btn>
        )}
      </td>
    </tr>
  );
}

