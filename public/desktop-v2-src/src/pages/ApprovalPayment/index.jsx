/**
 * Страница /approval-payment — очередь оплаты для бухгалтерии CRM 2.0.
 *
 * Источник vanilla: public/assets/js/approval_payment.js (~256 строк, AsgardApprovalPaymentPage).
 *
 *   ✅ pages/ApprovalPayment/index.jsx          ← root + list + cash balance
 *   ✅ pages/ApprovalPayment/api.js             ← endpoints + helpers
 *   ✅ pages/ApprovalPayment/PaymentModal.jsx   ← модалка с двумя методами (ПП / наличные) + комментарии
 *
 * Доступ: только BUH/ADMIN (на бэке проверка через approvalService.isBuh).
 * Endpoint: GET /api/approval/pending-buh → { items, cash_balance }.
 * Действия:
 *   POST /api/approval/:entityType/:id/pay-bank     (через ПП)
 *   POST /api/approval/:entityType/:id/issue-cash   (через кассу — с проверкой баланса)
 *   POST /api/approval/:entityType/:id/rework       (на доработку)
 *   POST /api/approval/:entityType/:id/question     (вопрос)
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn, Pill } from '@/modals/parts';
import { SearchInput } from '@/inputs/Inputs';
import { useDebounce } from '@/api/useListHelpers';

import { PaymentModal } from './PaymentModal';
import {
  loadPending, entityLabel, paymentMeta, fmtMoney, fmtDateTime
} from './api';
import './approval-payment.css';

export default function ApprovalPaymentPage() {
  const { user } = useAuth();
  const modal = useModal();
  const role = user?.role;
  const isAllowed = role === 'BUH' || role === 'ADMIN';

  const [items, setItems] = useState([]);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 300);  // G-11: debounce 300мс

  const refresh = () => {
    setLoading(true);
    loadPending()
      .then((d) => {
        setItems(Array.isArray(d?.items) ? d.items : []);
        setBalance(Number(d?.cash_balance) || 0);
      })
      .catch((e) => {
        if (e?.status === 403) {
          toast('Доступ закрыт', 'Раздел только для бухгалтерии', 'err');
        } else {
          toast('Ошибка', String(e?.message || e), 'err');
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:approval-payment:changed', onChanged);
    return () => window.removeEventListener('asgard:approval-payment:changed', onChanged);
  }, []);

  const visible = useMemo(() => {
    if (!dq.trim()) return items;
    const lq = dq.trim().toLowerCase();
    return items.filter((it) => {
      const lbl = (it.label || '').toLowerCase();
      const ent = entityLabel(it.entity_type).toLowerCase();
      return lbl.includes(lq) || ent.includes(lq) || String(it.id).includes(lq);
    });
  }, [items, dq]);

  if (!isAllowed) {
    return (
      <div className="card p-32 t-center" >
        <div className="fs-32 opacity-half mb-12">🔒</div>
        <div className="fs-16 fw-700 mb-6">Доступ закрыт</div>
        <div className="c-t3">
          Очередь оплаты доступна только бухгалтерии (BUH) и ADMIN.
        </div>
      </div>
    );
  }

  return (
    <div className="col gap-12">
      <div className="ap-head">
        <div>
          <div className="ap-eyebrow">Бухгалтерия</div>
          <h2 className="ap-title">Очередь оплаты</h2>
          <div className="ap-motto">
            Заявки, одобренные директором и ожидающие оплаты. ПП или наличные.
          </div>
          <div className="ap-count">{visible.length} {visible.length === 1 ? 'заявка' : 'заявок'} к обработке</div>
        </div>
        <div className="row gap-8">
          <div className="ap-cash-pill">
            <div className="ap-cash-pill-lab">Баланс кассы</div>
            <div className="ap-cash-pill-val">{fmtMoney(balance)}</div>
          </div>
          <Btn onClick={refresh}>↻ Обновить</Btn>
        </div>
      </div>

      <div className="card ap-filters">
        <div style={{ flex: 1, maxWidth: 420 }}>
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="Поиск по типу, описанию или ID"
          />
        </div>
      </div>

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем очередь…
        </div>
      ) : visible.length === 0 ? (
        <div className="card p-40 t-center" >
          <div className="fs-48 opacity-half mb-12">✅</div>
          <div className="fs-16 fw-700 mb-6">Нет заявок на оплату</div>
          <div className="c-t3">
            Все заявки обработаны. Спасибо за оперативность.
          </div>
        </div>
      ) : (
        <div className="ap-list">
          {visible.map((it) => (
            <PaymentRow
              key={`${it.entity_type}-${it.id}`}
              item={it}
              onOpen={() => modal.open(<PaymentModal item={it} cashBalance={balance} onDone={refresh} />)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PaymentRow({ item, onOpen }) {
  const meta = paymentMeta(item.payment_status);
  const amountValue = item.amount ?? item.total_amount ?? item.requested_amount ?? null;
  return (
    <div
      className="ap-row"
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(); } }}
      role="button"
      tabIndex={0}
      aria-label={`Платёж ${entityLabel(item.entity_type)} #${item.id} — открыть`}
    >
      <div className="ap-row-ic" aria-hidden="true">💸</div>
      <div className="ap-row-main">
        <div className="ap-row-title">
          {entityLabel(item.entity_type)} #{item.id}
        </div>
        {item.label && <div className="ap-row-sub">{item.label}</div>}
        <div className="ap-row-meta">
          {item.updated_at && <span>обновлено: {fmtDateTime(item.updated_at)}</span>}
          {item.requester_name && <><span>·</span><span>от: {item.requester_name}</span></>}
        </div>
      </div>
      {amountValue != null && (
        <div className="ap-row-amount">{fmtMoney(amountValue)}</div>
      )}
      <div className="ap-row-status">
        <Pill tone={meta.tone}>{meta.label}</Pill>
      </div>
      <Btn size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onOpen(); }}>
        Открыть →
      </Btn>
    </div>
  );
}
