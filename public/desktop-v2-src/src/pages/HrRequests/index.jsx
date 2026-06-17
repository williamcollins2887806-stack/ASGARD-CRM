/**
 * Страница /hr-requests — «Заявки персонала v2».
 * Источник: vanilla `public/assets/js/hr_requests.js` (911 строк).
 *
 *   ✅ index.jsx              — список заявок + фильтры + create-redirect
 *   ✅ api.js                 — endpoints + helpers
 *   ✅ RequestFormModal.jsx   — PM создаёт/редактирует черновик (+ требуемые допуска)
 *   ✅ PmViewModal.jsx        — PM смотрит заявку, добавляет в бригаду
 *   ✅ HrSplitModal.jsx       — HR подбирает: prog/доступные/назначенные/действия
 *
 * RBAC:
 *   • PM/HEAD_PM — видят /my, создают/редактируют свои
 *   • HR/HR_MANAGER/ADMIN/DIRECTOR_* — видят /pending, утверждают
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast, StatusBadge } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
// v2 BONUS: hotkeys + LS-persist + CSV export (vanilla не имеет)
import { useDebounce, useLocalStorage, useHotkeys, exportToCsv } from '@/api/useListHelpers';

import {
  STATUS_V2 as _STATUS_V2, isPmRole, isHrRole, canView,
  loadMy, loadPending, fmtDate, describeStatus,
} from './api';
import { RequestFormModal } from './RequestFormModal';
import { PmViewModal } from './PmViewModal';
import { HrSplitModal } from './HrSplitModal';
import './hr-requests.css';

const PM_STATUS_OPTS = [
  { value: '',              label: 'Все статусы' },
  { value: 'draft',         label: 'Черновики' },
  { value: 'new',           label: 'Ожидает HR' },
  { value: 'in_progress',   label: 'В работе HR' },
  { value: 'sent_to_pm',    label: 'На согласовании' },
  { value: 'approved',      label: 'Утверждена' },
  { value: 'added_to_crew', label: 'В бригаде' },
  { value: 'rework',        label: 'На доработке' },
];
const HR_STATUS_OPTS = [
  { value: '',              label: 'Все статусы' },
  { value: 'new',           label: 'Ожидает HR' },
  { value: 'in_progress',   label: 'В работе' },
  { value: 'sent_to_pm',    label: 'На согласовании' },
  { value: 'approved',      label: 'Утверждена' },
  { value: 'added_to_crew', label: 'В бригаде' },
];

export default function HrRequestsPage() {
  const { user } = useAuth();
  const modal = useModal();

  const isPM = user && isPmRole(user.role);
  const _isHR = user && isHrRole(user.role);

  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const dSearch = useDebounce(search, 300);  // G-11: debounce 300мс
  // v2 BONUS: запоминаем последний статус-фильтр между сессиями (vanilla сбрасывала)
  const [filterStatus, setFilterStatus] = useLocalStorage('hrr-status', '');
  const [filterWorkId, setFilterWorkId] = useState(null);

  const refresh = () => {
    if (!user) return;
    setLoading(true);
    const loader = isPM ? loadMy() : loadPending();
    loader
      .then(setRequests)
      .catch((e) => toast.error('Не удалось загрузить заявки: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [user?.id, isPM]);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:hr-requests:changed', onChanged);
    return () => window.removeEventListener('asgard:hr-requests:changed', onChanged);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isPM]);

  // Hash-параметры: ?create=1&work_id=X / ?id=Y / ?work_id=X (фильтр)
  useEffect(() => {
    const checkHash = () => {
      const hash = window.location.hash || '';
      const m = (k) => {
        const r = hash.match(new RegExp(`[?&]${k}=([^&]+)`));
        return r ? decodeURIComponent(r[1]) : null;
      };
      const create = m('create');
      const workId = m('work_id');
      const reqId = m('id');

      if (create === '1' && isPM) {
        const wid = workId ? Number(workId) : null;
        modal.open(<RequestFormModal workId={wid} onSaved={refresh} />, { size: 'wide' });
        window.location.hash = '#/hr-requests';
        return;
      }
      if (reqId) {
        const id = Number(reqId);
        if (id) openRequest(id);
        window.location.hash = '#/hr-requests';
        return;
      }
      if (workId) setFilterWorkId(Number(workId));
    };
    checkHash();
    window.addEventListener('hashchange', checkHash);
    return () => window.removeEventListener('hashchange', checkHash);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isPM]);

  const openRequest = (id) => {
    if (isPM) {
      modal.open(<PmViewModal requestId={id} onChanged={refresh} />, { size: 'wide' });
    } else {
      modal.open(<HrSplitModal requestId={id} onChanged={refresh} />, { size: 'wide' });
    }
  };

  const filtered = useMemo(() => {
    let v = requests.slice();
    if (filterStatus) v = v.filter((r) => (r.status_v2 || r.status) === filterStatus);
    if (filterWorkId) v = v.filter((r) => r.work_id === filterWorkId);
    if (dSearch.trim()) {
      const s = dSearch.toLowerCase();
      v = v.filter((r) => {
        const hay = `${r.work_title || ''} ${r.customer_name || ''} ${r.pm_name || ''}`.toLowerCase();
        return hay.includes(s);
      });
    }
    v.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    return v;
  }, [requests, filterStatus, filterWorkId, dSearch]);

  const statusOpts = isPM ? PM_STATUS_OPTS : HR_STATUS_OPTS;

  const onCreate = () => {
    modal.open(<RequestFormModal onSaved={refresh} />, { size: 'wide' });
  };

  // v2 BONUS: CSV-экспорт текущей выборки заявок (vanilla не имеет — HR хотели выгружать
  // реестр в Excel для шапок отчётов).
  const onExportCsv = () => {
    if (!filtered.length) { toast.warn('Нет заявок для экспорта'); return; }
    const ymd = new Date().toISOString().slice(0, 10);
    exportToCsv(`hr-requests-${ymd}.csv`, filtered, [
      { key: 'id', label: 'ID' },
      { key: 'work_title', label: 'Работа' },
      { key: 'customer_name', label: 'Заказчик' },
      { key: 'pm_name', label: 'РП' },
      { key: (r) => (r.positions || []).map((p) => `${p.role_label}: ${p.filled_count || 0}/${p.required_count}`).join('; '), label: 'Состав' },
      { key: (r) => describeStatus(r.status_v2 || r.status).label, label: 'Статус' },
      { key: 'created_at', label: 'Создана', format: fmtDate }
    ]);
    toast.success(`Экспортировано ${filtered.length} заявок`);
  };

  // v2 BONUS: hotkeys — / поиск, Ctrl+N создать (PM), Ctrl+E экспорт.
  useHotkeys({
    '/': () => {
      const inp = document.querySelector('.hr-filter input[type=text]');
      if (inp) inp.focus();
    },
    'mod+n': () => { if (isPM) onCreate(); },
    'mod+e': () => onExportCsv()
  }, [filtered.length, isPM]);

  // Гейт «нет доступа» — ПОСЛЕ всех хуков (Rules of Hooks).
  if (user && !canView(user.role)) {
    return (
      <div className="card p-32 t-center" >
        <div className="fs-32 mb-12">🛡</div>
        <div className="fs-16 fw-700 mb-6">Нет доступа</div>
        <div className="c-t3">Доступ только РП и HR.</div>
      </div>
    );
  }

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker={isPM ? 'РП' : 'HR'}
        title="Заявки персонала"
        subtitle={isPM ? `${filtered.length} заявок · ваши запросы на рабочих` : `${filtered.length} заявок · входящие от РП`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            {/* v2 BONUS: CSV-экспорт (vanilla не имеет) */}
            <Btn variant="ghost" onClick={onExportCsv} title="Экспорт CSV (Ctrl+E)">📥 CSV</Btn>
            {isPM && <Btn onClick={onCreate} title="Создать заявку (Ctrl+N)">📨 Запросить рабочих</Btn>}
          </>
        }
      />

      <div className="hr-filter">
        <SelectInput value={filterStatus} onChange={setFilterStatus} options={statusOpts} />
        <SearchInput value={search} onChange={setSearch} placeholder="Поиск по объекту, заказчику, РП…" />
        {filterWorkId && (
          <Btn variant="ghost" size="sm" onClick={() => setFilterWorkId(null)}>
            ✕ Снять фильтр по работе #{filterWorkId}
          </Btn>
        )}
      </div>

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем заявки…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="📨"
          title={search || filterStatus ? 'Никого не нашли' : 'Заявок пока нет'}
          hint={search || filterStatus ? 'Попробуйте изменить фильтры' : isPM ? 'Создайте первую через «📨 Запросить рабочих»' : 'Заявки от РП появятся здесь'}
          action={null}
        />
      ) : (
        <div className="card card-pad-overflow">
          <div className="ov-x-auto">
            <table className="hr-table">
              <thead>
                <tr>
                  <th className="w-80">#</th>
                  <th>Объект / Заказчик</th>
                  <th>РП</th>
                  <th>Состав</th>
                  <th>Статус</th>
                  <th className="w-110">Дата</th>
                  <th className="w-110"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <RequestRow key={r.id} req={r} onOpen={() => openRequest(r.id)} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function RequestRow({ req, onOpen }) {
  const meta = describeStatus(req.status_v2 || req.status);
  const positions = (req.positions || [])
    .map((p) => `${p.role_label}: ${p.filled_count || 0}/${p.required_count}`)
    .join(', ') || (req.total_required != null ? `${req.total_filled || 0}/${req.total_required}` : '—');

  return (
    <tr className="hr-row" onClick={onOpen}>
      <td className="hr-id">#{req.id}</td>
      <td>
        <div className="hr-work">{req.work_title || '—'}</div>
        {req.customer_name && <div className="hr-customer">{req.customer_name}</div>}
      </td>
      <td className="hr-dim">{req.pm_name || '—'}</td>
      <td className="hr-positions">{positions}</td>
      <td>
        <StatusBadge tone={meta.tone} label={meta.label} />
      </td>
      <td className="hr-dim">{fmtDate(req.created_at)}</td>
      <td onClick={(e) => e.stopPropagation()}>
        <Btn size="sm" onClick={onOpen}>Открыть</Btn>
      </td>
    </tr>
  );
}
