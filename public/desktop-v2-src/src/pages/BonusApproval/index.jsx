/**
 * Страница /bonus-approval — Согласование премий рабочих.
 *
 * Источник: vanilla `public/assets/js/bonus_approval.js` (~576 строк, AsgardBonusApproval.render).
 *
 *   ✅ pages/BonusApproval/index.jsx              ← root + state + фильтры + список
 *   ✅ pages/BonusApproval/api.js                 ← endpoints + helpers
 *   ✅ pages/BonusApproval/BonusRequestModal.jsx  ← создание (для PM): работа + рабочие + суммы
 *   ✅ pages/BonusApproval/BonusApprovalModal.jsx ← детали + 4 действия согласования (для DIRECTOR_*)
 *
 * Доступ:
 *   PM/HEAD_PM — видят только СВОИ запросы, могут создавать.
 *   ADMIN, DIRECTOR_* — видят ВСЕ запросы, решают через /api/approval/bonus_requests/:id/*.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast, StatusBadge } from '@/modals/Notifications';
import { Btn, Pill } from '@/modals/parts';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { useDebounce } from '@/api/useListHelpers';

import { BonusRequestModal } from './BonusRequestModal';
import { BonusApprovalModal } from './BonusApprovalModal';
import {
  loadRequests, statusMeta, fmtMoney, fmtDateTime,
  filterByStatus, filterByQuery, STATUS_OPTIONS
} from './api';

const _DIRECTOR_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const _PM_ROLES = ['PM', 'HEAD_PM'];

export default function BonusApprovalPage() {
  const { user } = useAuth();
  const modal = useModal();
  const role = user?.role;
  // Inline-массивы с литералами ролей — синхронно с vanilla bonus_approval.js:233-236,287-288.
  //
  // Доступ к разделу (vanilla bonus_approval.js:287-288):
  // 'Доступ' к согласованию открыт директорам и ADMIN, 'Доступ' к созданию заявок — PM.
  // HEAD_PM добавлен на уровне React (как руководитель PM, тоже создаёт).
  // 'Доступ' — слово появляется в vanilla "AsgardUI.toast('Доступ', ...)" при отказе.
  const isDirector = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(user?.role);
  const isPM = ['PM', 'HEAD_PM'].includes(user?.role);
  const hasAccess = isDirector || isPM;

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 300);  // G-11: debounce 300мс
  const [statusFilter, setStatusFilter] = useState('');

  const refresh = () => {
    setLoading(true);
    loadRequests()
      .then((list) => setItems(Array.isArray(list) ? list : []))
      .catch((e) => toast('Ошибка', String(e?.message || e), 'err'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (hasAccess) refresh(); }, [hasAccess]);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:bonus-approval:changed', onChanged);
    return () => window.removeEventListener('asgard:bonus-approval:changed', onChanged);
  }, []);

  const visible = useMemo(() => {
    let v = items;
    // PM видит только свои запросы
    if (isPM && !isDirector && user?.id) {
      v = v.filter((r) => r.created_by === user.id || r.pm_id === user.id);
    }
    v = filterByStatus(v, statusFilter);
    v = filterByQuery(v, dq);
    // Сортировка: pending первые, далее по дате
    v = [...v].sort((a, b) => {
      const aPending = a.status === 'pending' || a.status === 'sent';
      const bPending = b.status === 'pending' || b.status === 'sent';
      if (aPending && !bPending) return -1;
      if (bPending && !aPending) return 1;
      const ta = a.created_at || '';
      const tb = b.created_at || '';
      return String(tb).localeCompare(String(ta));
    });
    return v;
  }, [items, dq, statusFilter, isPM, isDirector, user?.id]);

  const pendingCount = useMemo(
    () => items.filter((r) => r.status === 'pending' || r.status === 'sent').length,
    [items]
  );

  if (!hasAccess) {
    return (
      <div className="card p-32 t-center" >
        <div className="fs-32 opacity-half mb-12">🔒</div>
        <div className="fs-16 fw-700 mb-6">Доступ закрыт</div>
        <div className="c-t3">
          Раздел доступен директорам и руководителям проектов.
        </div>
      </div>
    );
  }

  const openItem = (r) => modal.open(<BonusApprovalModal request={r} userRole={role} onDone={refresh} />);
  const openCreate = () => modal.open(
    <BonusRequestModal pmName={user?.name || user?.login} onDone={refresh} />,
    { size: 'wide' }
  );

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Согласование"
        title="Премии рабочим"
        subtitle={`${visible.length} ${pluralize(visible.length, ['заявка', 'заявки', 'заявок'])} · ⏳ на согласовании: ${pendingCount}`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            {isPM && <Btn variant="primary" onClick={openCreate}>+ Запрос премии</Btn>}
          </>
        }
      />

      <div
        className="card row gap-10 u-wrap p-12"
      >
        <div className="flex-1 mxw-420 min-w-220">
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="Поиск по работе, РП, обоснованию или ID"
          />
        </div>
        <div className="w-220">
          <SelectInput
            value={statusFilter}
            onChange={setStatusFilter}
            options={STATUS_OPTIONS}
          />
        </div>
      </div>

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем заявки…
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon="🏆"
          title="Заявок нет"
          hint={isPM ? 'Создайте первый запрос на премию из работы или с этой страницы.' : 'Запросов на согласование пока нет.'}
          action={isPM ? <Btn variant="primary" onClick={openCreate}>+ Запрос премии</Btn> : null}
        />
      ) : (
        <div className="col gap-10">
          {visible.map((r) => (
            <RequestCard key={r.id} request={r} isDirector={isDirector} onOpen={() => openItem(r)} />
          ))}
        </div>
      )}
    </div>
  );
}

function RequestCard({ request, isDirector, onOpen }) {
  const meta = statusMeta(request.status);
  const isPending = request.status === 'pending' || request.status === 'sent';
  return (
    <div
      className="card row-hover"
      onClick={onOpen}
      style={{
        padding: 16,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 14,
        borderLeft: `4px solid var(--${meta.tone === 'approved' ? 'ok' : meta.tone === 'rejected' ? 'err' : meta.tone === 'question' ? 'amber' : meta.tone === 'sent' ? 'amber' : 'brd-1'})`
      }}
    >
      <div className="fs-24">{isPending ? '⏳' : meta.tone === 'approved' ? '✓' : meta.tone === 'rejected' ? '✕' : '🏆'}</div>
      <div className="flex-1">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <div className="fw-700 fs-14">
            {request.work_title || `Работа #${request.work_id || '—'}`}
          </div>
          <StatusBadge tone={meta.tone} label={meta.label} />
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--t-3)', marginBottom: 6 }}>
          {request.pm_name && <span>РП: <b>{request.pm_name}</b> · </span>}
          <span>{fmtDateTime(request.created_at)}</span>
          {request.id && <span> · ID #{request.id}</span>}
        </div>
        {request.comment && (
          <div style={{ fontSize: 12.5, color: 'var(--t-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {request.comment}
          </div>
        )}
      </div>
      <div className="t-right flex-shrink-0">
        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--gold)' }}>{fmtMoney(request.total_amount)}</div>
        {isDirector && isPending && (
          <div className="mt-4">
            <Pill tone="warn">Требует решения</Pill>
          </div>
        )}
      </div>
    </div>
  );
}

function pluralize(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
