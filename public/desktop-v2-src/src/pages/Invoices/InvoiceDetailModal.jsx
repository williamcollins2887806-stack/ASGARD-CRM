/**
 * Карточка счёта: реквизиты + лента платежей + действия.
 * GET /api/invoices/:id вернёт { invoice, payments }.
 */
import { useState, useEffect } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { ConfirmModal } from '@/modals';
import { toast, StatusBadge } from '@/modals/Notifications';

import InvoiceEditModal from './InvoiceEditModal';
import PaymentModal     from './PaymentModal';
import { loadInvoice, deleteInvoice, STATUSES, fmtMoney, fmtDate, openPdf } from './api';

const WRITE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'PM', 'BUH'];

function emitChanged() {
  window.dispatchEvent(new CustomEvent('asgard:invoices:changed'));
}

function Row({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '180px 1fr',
      gap: 12,
      padding: '6px 0',
      borderBottom: '1px solid var(--brd-2)',
      fontSize: 13
    }}>
      <div className="c-t3">{label}</div>
      <div className="c-t1">{value}</div>
    </div>
  );
}
function Section({ children }) {
  return (
    <div style={{
      fontSize: 11,
      color: 'var(--t-3)',
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      fontWeight: 700,
      margin: '14px 0 6px'
    }}>{children}</div>
  );
}

export default function InvoiceDetailModal({ invoiceId }) {
  const { user } = useAuth();
  const modal = useModal();
  const { close } = modal;

  const [data,     setData]     = useState(null);
  const [payments, setPayments] = useState([]);
  const [loading,  setLoading]  = useState(true);

  const refresh = () => {
    setLoading(true);
    loadInvoice(invoiceId)
      .then((d) => {
        setData(d.invoice);
        setPayments(d.payments || []);
      })
      .catch((e) => toast.error('Не удалось загрузить счёт: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [invoiceId]);
  useEffect(() => {
    const h = () => refresh();
    window.addEventListener('asgard:invoices:changed', h);
    return () => window.removeEventListener('asgard:invoices:changed', h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  if (loading) {
    return (
      <MCard className="modal-wide">
        <MHead icon="🧾" title="Счёт" subtitle={`#${invoiceId}`} onClose={close} />
        <MBody>
          <div className="t-center p-40 c-t3">⏳ Загружаем…</div>
        </MBody>
      </MCard>
    );
  }
  if (!data) {
    return (
      <MCard className="modal-wide">
        <MHead icon="🧾" title="Счёт не найден" subtitle={`#${invoiceId}`} onClose={close} accent="warn" />
        <MBody>
          <p className="c-t2">Запись не найдена или удалена.</p>
        </MBody>
        <MFoot align="end"><Btn onClick={close}>Закрыть</Btn></MFoot>
      </MCard>
    );
  }

  const inv = data;
  const status = STATUSES[inv.status] || STATUSES.draft;
  const remaining = Math.max(0, Number(inv.total_amount || 0) - Number(inv.paid_amount || 0));
  const canWrite = WRITE_ROLES.includes(user?.role);

  const onEdit = () => {
    modal.open(<InvoiceEditModal invoice={inv} onSaved={refresh} />, { size: 'wide' });
  };
  const onPay = () => {
    if (remaining <= 0) {
      toast.info('Счёт уже полностью оплачен');
      return;
    }
    modal.open(<PaymentModal invoice={inv} onSaved={refresh} />);
  };
  const onDelete = () => {
    modal.open(
      <ConfirmModal
        tone="danger"
        title="Удалить счёт?"
        message={`Удалить счёт № ${inv.invoice_number || inv.id}? Все привязанные платежи также будут удалены.`}
        okText="Удалить"
        cancelText="Отмена"
        onConfirm={async () => {
          try {
            await deleteInvoice(inv.id);
            toast.success('Счёт удалён');
            emitChanged();
            close();
          } catch (e) {
            toast.error('Не удалось удалить: ' + (e?.message || e));
          }
        }}
      />
    );
  };
  const onPdf = () => {
    openPdf(inv.id).catch((e) => toast.error('PDF: ' + (e?.message || e)));
  };

  return (
    <MCard className="modal-wide">
      <MHead
        icon="🧾"
        title={`Счёт № ${inv.invoice_number || inv.id}`}
        subtitle={fmtDate(inv.invoice_date)}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="col gap-18">
          <div className="row gap-14 p-12 bg-inner r-md brd-2">
            <StatusBadge tone={status.tone} label={status.label} />
            <span className="flex-1" />
            <span className="fs-13 c-t3">
              Остаток: <b style={{ color: remaining > 0 ? 'var(--amber)' : 'var(--ok)' }}>{fmtMoney(remaining)}</b>
            </span>
          </div>

          <Section>Основное</Section>
          <Row label="Дата"        value={fmtDate(inv.invoice_date)} />
          <Row label="Контрагент"  value={inv.customer_name} />
          <Row label="ИНН"         value={inv.customer_inn} />
          <Row label="Описание"    value={inv.description} />
          <Row label="Срок оплаты" value={fmtDate(inv.due_date)} />

          <Section>Финансы</Section>
          <Row label="Сумма (без НДС)" value={fmtMoney(inv.amount)} />
          <Row label="НДС, %"          value={inv.vat_pct != null ? `${inv.vat_pct}%` : '—'} />
          <Row label="Итого с НДС"     value={<b className="c-gold">{fmtMoney(inv.total_amount)}</b>} />
          <Row label="Оплачено"        value={<span className="c-ok">{fmtMoney(inv.paid_amount)}</span>} />

          <Section>Платежи ({payments.length})</Section>
          {payments.length === 0 ? (
            <div className="c-t3 fs-13 p-10">Платежей пока нет.</div>
          ) : (
            <div className="inv-payments">
              {payments.map((p) => (
                <div key={p.id} className="inv-payment-row">
                  <span className="date">{fmtDate(p.payment_date)}</span>
                  <span>{p.comment || '—'}</span>
                  <span className="amount">{fmtMoney(p.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </MBody>
      <MFoot align="spread">
        <div className="u-flex gap-8">
          {canWrite && <Btn variant="danger" onClick={onDelete}>🗑 Удалить</Btn>}
        </div>
        <div className="u-flex gap-8">
          <Btn variant="ghost" onClick={onPdf}>📄 PDF</Btn>
          <Btn onClick={close}>Закрыть</Btn>
          {canWrite && remaining > 0 && (
            <Btn variant="primary" onClick={onPay}>💰 Внести оплату</Btn>
          )}
          {canWrite && (
            <Btn onClick={onEdit}>✎ Редактировать</Btn>
          )}
        </div>
      </MFoot>
    </MCard>
  );
}
