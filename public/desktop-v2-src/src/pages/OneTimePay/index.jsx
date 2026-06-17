/**
 * Страница /one-time-pay — Разовые оплаты (такси / топливо / питание / прочее).
 *
 * Источник: vanilla `public/assets/js/payroll.js` (renderOneTimePay, ~250 строк).
 *
 *   ✅ pages/OneTimePay/index.jsx               ← root + табы + список + действия
 *   ✅ pages/OneTimePay/api.js                  ← endpoints + helpers (типы/статусы)
 *   ✅ pages/OneTimePay/OneTimeCreateModal.jsx  ← создание запроса (employee+amount+type+work+reason)
 *
 * Доступ:
 *   ADMIN, PM, HEAD_PM, BUH, DIRECTOR_* — все имеют доступ к странице.
 *   PM создаёт запрос → видит ТОЛЬКО свои (бэк фильтрует по requested_by=user.id).
 *   DIRECTOR_* — согласовывают/отклоняют.
 *   BUH/DIRECTOR_* — отмечают оплаченным.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast, StatusBadge } from '@/modals/Notifications';
import { Btn, Pill } from '@/modals/parts';
import { SearchInput } from '@/inputs/Inputs';
import { TopActionsBar, TabsBar, EmptyState } from '@/blocks/Blocks';
import { ConfirmModal, PromptModal } from '@/modals';
import { useDebounce } from '@/api/useListHelpers';

import { OneTimeCreateModal } from './OneTimeCreateModal';
import {
  loadOneTime, approveOneTime, rejectOneTime, payOneTime,
  STATUS_TABS, statusMeta, typeMeta, fmtMoney, fmtDateTime, filterByQuery
} from './api';

const DIRECTOR_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

export default function OneTimePayPage() {
  const { user } = useAuth();
  const modal = useModal();
  const role = user?.role;
  const isDirector = DIRECTOR_ROLES.includes(role);
  const isBuh = role === 'BUH';
  const canCreate = isDirector || role === 'PM' || role === 'HEAD_PM';
  const hasAccess = canCreate || isBuh;

  const [tab, setTab] = useState('all');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 300);  // G-11: debounce 300мс

  const refresh = () => {
    setLoading(true);
    loadOneTime({ status: tab })
      .then((list) => setItems(Array.isArray(list) ? list : []))
      .catch((e) => toast('Ошибка', String(e?.message || e), 'err'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (hasAccess) refresh(); }, [hasAccess, tab]);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:one-time-pay:changed', onChanged);
    return () => window.removeEventListener('asgard:one-time-pay:changed', onChanged);
    // eslint-disable-next-line
  }, [tab]);

  const visible = useMemo(() => filterByQuery(items, dq), [items, dq]);

  // Подсчёт по табам
  const counts = useMemo(() => {
    const c = { all: items.length };
    STATUS_TABS.forEach((t) => { if (t.id !== 'all') c[t.id] = 0; });
    items.forEach((it) => { if (c[it.status] !== undefined) c[it.status]++; });
    return c;
  }, [items]);

  const tabsForBar = STATUS_TABS.map((t) => ({
    id: t.id,
    label: t.label,
    count: tab === 'all' || t.id === 'all' ? counts[t.id] : undefined
  }));

  if (!hasAccess) {
    return (
      <div className="card p-32 t-center" >
        <div className="fs-32 opacity-half mb-12">🔒</div>
        <div className="fs-16 fw-700 mb-6">Доступ закрыт</div>
        <div className="c-t3">
          Раздел доступен директорам, руководителям проектов и бухгалтерии.
        </div>
      </div>
    );
  }

  const openCreate = () => modal.open(
    <OneTimeCreateModal userRole={role} userId={user?.id} onDone={refresh} />,
    { size: 'wide' }
  );

  const doApprove = (item) => {
    modal.open(
      <ConfirmModal
        title="Согласовать оплату?"
        message={`${fmtMoney(item.amount)} для ${item.employee_name || '—'}. После согласования запись попадёт в реестр выплат.`}
        tone="gold"
        okText="✓ Согласовать"
        onConfirm={async () => {
          try {
            await approveOneTime(item.id);
            toast('Согласовано', '', 'ok');
            window.dispatchEvent(new CustomEvent('asgard:one-time-pay:changed'));
            refresh();
          } catch (e) {
            toast('Ошибка', String(e?.message || e), 'err');
          }
        }}
      />
    );
  };

  const doReject = (item) => {
    modal.open(
      <PromptModal
        title="Отклонить оплату"
        subtitle={`#${item.id} · ${fmtMoney(item.amount)}`}
        label="Причина отклонения"
        placeholder="Опишите почему отклонено…"
        multiline
        required
        accent="danger"
        icon="✕"
        okText="Отклонить"
        onSubmit={async (comment) => {
          try {
            await rejectOneTime(item.id, comment);
            toast('Отклонено', '', 'ok');
            window.dispatchEvent(new CustomEvent('asgard:one-time-pay:changed'));
            refresh();
          } catch (e) {
            toast('Ошибка', String(e?.message || e), 'err');
          }
        }}
      />,
      { size: 'center' }
    );
  };

  const doPay = (item) => {
    modal.open(
      <ConfirmModal
        title="Подтвердить оплату?"
        message={`${fmtMoney(item.amount)} для ${item.employee_name || '—'}. Будет помечено как «Оплачено».`}
        tone="success"
        okText="💵 Оплачено"
        onConfirm={async () => {
          try {
            await payOneTime(item.id);
            toast('Оплачено', '', 'ok');
            window.dispatchEvent(new CustomEvent('asgard:one-time-pay:changed'));
            refresh();
          } catch (e) {
            toast('Ошибка', String(e?.message || e), 'err');
          }
        }}
      />
    );
  };

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Финансы"
        title="Разовые оплаты"
        subtitle={`${visible.length} в выборке · всего ${items.length}`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            {canCreate && <Btn variant="primary" onClick={openCreate}>+ Запросить оплату</Btn>}
          </>
        }
      />

      <TabsBar tabs={tabsForBar} active={tab} onChange={setTab} />

      <div className="card p-12" >
        <div style={{ maxWidth: 420 }}>
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="Поиск по ФИО, причине, работе или ID"
          />
        </div>
      </div>

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем оплаты…
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon="💵"
          title="Нет разовых оплат"
          hint={canCreate ? 'Запросите первую оплату — такси, топливо или прочее.' : 'В этой выборке ничего нет.'}
          action={canCreate ? <Btn variant="primary" onClick={openCreate}>+ Запросить оплату</Btn> : null}
        />
      ) : (
        <div className="col gap-10">
          {visible.map((it) => (
            <OneTimeCard
              key={it.id}
              item={it}
              isDirector={isDirector}
              isBuh={isBuh}
              onApprove={() => doApprove(it)}
              onReject={() => doReject(it)}
              onPay={() => doPay(it)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OneTimeCard({ item, isDirector, isBuh, onApprove, onReject, onPay }) {
  const sMeta = statusMeta(item.status);
  const pt = typeMeta(item.payment_type);
  const canApproveReject = item.status === 'pending' && isDirector;
  const canPay = item.status === 'approved' && (isDirector || isBuh);

  return (
    <div
      className="card"
      style={{
        padding: 14,
        borderLeft: `4px solid var(--${sMeta.tone === 'approved' ? 'ok' : sMeta.tone === 'rejected' ? 'err' : sMeta.tone === 'paid' ? 'ok' : 'amber'})`,
        display: 'flex',
        flexDirection: 'column',
        gap: 8
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="fw-700 fs-15">{item.employee_name || '—'}</span>
          <span style={{ fontWeight: 800, fontSize: 18, color: 'var(--gold)' }}>{fmtMoney(item.amount)}</span>
          <StatusBadge tone={sMeta.tone} label={sMeta.label} />
        </div>
        <Pill>{pt.icon} {pt.label}</Pill>
      </div>

      <div className="fs-12-5 c-t3">
        {item.work_title && <>Работа: <b className="c-t2">{item.work_title}</b> · </>}
        Запросил: <b className="c-t2">{item.requester_name || '—'}</b> ·{' '}
        <span>{fmtDateTime(item.created_at)}</span> · ID #{item.id}
      </div>

      {item.reason && (
        <div className="fs-13 c-t1">{item.reason}</div>
      )}

      {item.director_comment && (
        <div style={{ fontSize: 12.5, color: 'var(--amber)', background: 'var(--inner-bg)', padding: '6px 10px', borderRadius: 'var(--r-sm)' }}>
          Комментарий: {item.director_comment}
        </div>
      )}

      {(canApproveReject || canPay) && (
        <div className="u-flex gap-6 u-wrap">
          {canApproveReject && (
            <>
              <Btn size="sm" variant="success" onClick={onApprove}>✓ Согласовать</Btn>
              <Btn size="sm" variant="danger" onClick={onReject}>✕ Отклонить</Btn>
            </>
          )}
          {canPay && (
            <Btn size="sm" variant="primary" onClick={onPay}>💵 Оплачено</Btn>
          )}
        </div>
      )}
    </div>
  );
}
