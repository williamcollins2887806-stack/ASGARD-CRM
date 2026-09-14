/**
 * Карточка счёта или акта.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { ConfirmModal } from '@/modals';
import { toast, StatusBadge } from '@/modals/Notifications';
import { ConstructorModal } from './ConstructorModal';
import { SendDocModal } from './SendDocModal';
import PaymentModal from './PaymentModal';
import {
  loadInvoice, loadAct, deleteInvoice, deleteAct, updateAct, updateInvoice,
  WRITE_ROLES, statusMeta, fmtMoney, fmtDate, parseItems,
  openInvoicePdf, openActPdf, downloadDocOffice, emitChanged, displayText
} from './api';
import './billing.css';

function Row({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <div className="bill-kv">
      <div className="c-t3">{label}</div>
      <div className="c-t1">{value}</div>
    </div>
  );
}

export function DetailModal({ kind, id }) {
  const { user } = useAuth();
  const modal = useModal();
  const { close } = modal;
  const isAct = kind === 'act';
  const [row, setRow] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const canWrite = WRITE_ROLES.includes(user?.role);

  const refresh = () => {
    setLoading(true);
    const load = isAct ? loadAct : loadInvoice;
    load(id)
      .then((d) => {
        setRow(d.act || d.invoice || d);
        setPayments(d.payments || []);
      })
      .catch((e) => toast.error('Не удалось загрузить: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, [id, kind]);
  useEffect(() => {
    const h = () => refresh();
    window.addEventListener('asgard:billing:changed', h);
    return () => window.removeEventListener('asgard:billing:changed', h);
  }, [id, kind]);

  if (loading) {
    return (
      <MCard className="modal-wide">
        <MHead icon={isAct ? '📄' : '🧾'} title={isAct ? 'Акт' : 'Счёт'} subtitle={'#' + id} onClose={close} />
        <MBody><div className="t-center p-40 c-t3">⏳ Загружаем…</div></MBody>
      </MCard>
    );
  }
  if (!row) {
    return (
      <MCard className="modal-wide">
        <MHead icon={isAct ? '📄' : '🧾'} title="Не найдено" onClose={close} accent="warn" />
        <MBody><p className="c-t2">Запись удалена или недоступна.</p></MBody>
        <MFoot align="end"><Btn onClick={close}>Закрыть</Btn></MFoot>
      </MCard>
    );
  }

  const st = statusMeta(kind, row.status);
  const number = isAct ? (row.act_number || row.id) : (row.invoice_number || row.id);
  const remaining = Math.max(0, Number(row.total_amount || 0) - Number(row.paid_amount || 0));
  const items = parseItems(row.items_json || row.items);

  const onEdit = () => modal.open(<ConstructorModal kind={kind} editId={row.id} editKind={kind} onSaved={refresh} />, { size: 'full' });
  const onSend = () => modal.open(<SendDocModal kind={kind} doc={row} />);
  const onPdf = () => (isAct ? openActPdf : openInvoicePdf)(row.id).catch((e) => toast.error('PDF: ' + (e?.message || e)));
  const onOffice = (ext) => downloadDocOffice(kind, row.id, ext)
    .catch((e) => toast.error((ext === 'xlsx' ? 'Excel: ' : 'Word: ') + (e?.message || e)));
  const onPay = () => modal.open(<PaymentModal invoice={row} onSaved={refresh} />);

  const onSign = () => {
    modal.open(
      <ConfirmModal
        tone="success"
        icon="✍"
        title="Отметить акт подписанным?"
        message={`Акт № ${number} будет в статусе «Подписан».`}
        okText="Подписать"
        onConfirm={async () => {
          await updateAct(row.id, { status: 'signed', signed_date: row.signed_date || new Date().toISOString().slice(0, 10) });
          toast.success('Акт подписан');
          emitChanged();
          refresh();
        }}
      />
    );
  };
  const onMarkPaid = () => {
    modal.open(
      <ConfirmModal
        tone="gold"
        icon="💰"
        title="Отметить оплаченным?"
        okText="Отметить"
        onConfirm={async () => {
          if (isAct) await updateAct(row.id, { status: 'paid', paid_date: new Date().toISOString().slice(0, 10) });
          else await updateInvoice(row.id, { status: 'paid' });
          toast.success('Отмечено');
          emitChanged();
          refresh();
        }}
      />
    );
  };
  const onDelete = () => {
    modal.open(
      <ConfirmModal
        tone="danger"
        title={isAct ? 'Удалить акт?' : 'Удалить счёт?'}
        message="Действие необратимо."
        okText="Удалить"
        onConfirm={async () => {
          if (isAct) await deleteAct(row.id);
          else await deleteInvoice(row.id);
          toast.success('Удалено');
          emitChanged();
          close();
        }}
      />
    );
  };

  return (
    <MCard className="modal-wide">
      <MHead
        icon={isAct ? '📄' : '🧾'}
        title={`${isAct ? 'Акт' : 'Счёт'} № ${number}`}
        subtitle={fmtDate(row.act_date || row.invoice_date)}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="col gap-16">
          <div className="bill-detail-bar">
            <StatusBadge tone={st.tone} label={st.label} />
            <span className="flex-1" />
            <span className="fs-13 c-t3">
              Итого: <b className="c-gold">{fmtMoney(row.total_amount)}</b>
              {!isAct && remaining > 0 ? <> · остаток <b className="c-amber">{fmtMoney(remaining)}</b></> : null}
            </span>
          </div>

          <Row label="Контрагент" value={displayText(row.customer_name, 'без названия')} />
          <Row label="ИНН" value={row.customer_inn} />
          <Row label="КПП" value={row.customer_kpp} />
          <Row label="Адрес" value={row.customer_address} />
          <Row label="Работа" value={row.work_title || row.work_number} />
          <Row label="Описание" value={row.description} />
          {!isAct && <Row label="Срок оплаты" value={fmtDate(row.due_date)} />}
          {isAct && <Row label="Подписан" value={fmtDate(row.signed_date)} />}

          {items.length > 0 && (
            <div className="bill-items-card">
              <table className="bill-items-table">
                <thead>
                  <tr>
                    <th>Наименование</th>
                    <th>Ед.</th>
                    <th className="num">Кол.</th>
                    <th className="num">Цена</th>
                    <th className="num">Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i}>
                      <td>{it.name || it.description}</td>
                      <td>{it.unit || 'усл.'}</td>
                      <td className="num">{it.qty || it.quantity || 1}</td>
                      <td className="num">{fmtMoney(it.price || 0)}</td>
                      <td className="num">{fmtMoney((Number(it.qty || it.quantity || 1) * Number(it.price || 0)) || it.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Row label="Без НДС" value={fmtMoney(row.amount)} />
          <Row label="НДС" value={row.vat_pct != null ? `${row.vat_pct}%` : '—'} />
          <Row label="Итого" value={<b className="c-gold">{fmtMoney(row.total_amount)}</b>} />
          {!isAct && <Row label="Оплачено" value={<span className="c-ok">{fmtMoney(row.paid_amount)}</span>} />}

          {!isAct && (
            <>
              <div className="bill-eyebrow">Платежи ({payments.length})</div>
              {payments.length === 0 ? (
                <div className="c-t3 fs-13">Платежей пока нет.</div>
              ) : (
                <div className="bill-payments">
                  {payments.map((p) => (
                    <div key={p.id} className="bill-payment-row">
                      <span className="date">{fmtDate(p.payment_date)}</span>
                      <span>{p.comment || '—'}</span>
                      <span className="amount">{fmtMoney(p.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </MBody>
      <MFoot align="spread">
        <div className="u-flex gap-8">
          {canWrite && <Btn variant="danger" onClick={onDelete}>Удалить</Btn>}
        </div>
        <div className="u-flex gap-8">
          <Btn variant="ghost" onClick={onPdf}>PDF</Btn>
          <Btn variant="ghost" onClick={() => onOffice('docx')}>Word</Btn>
          <Btn variant="ghost" onClick={() => onOffice('xlsx')}>Excel</Btn>
          {canWrite && <Btn variant="ghost" onClick={onSend}>Отправить</Btn>}
          {canWrite && isAct && row.status !== 'signed' && row.status !== 'paid' && (
            <Btn variant="success" onClick={onSign}>Подписан</Btn>
          )}
          {canWrite && isAct && (row.status === 'signed' || row.status === 'sent') && (
            <Btn variant="primary" onClick={onMarkPaid}>Оплачен</Btn>
          )}
          {canWrite && !isAct && remaining > 0 && (
            <Btn variant="primary" onClick={onPay}>Оплата</Btn>
          )}
          {canWrite && <Btn onClick={onEdit}>Конструктор</Btn>}
          <Btn onClick={close}>Закрыть</Btn>
        </div>
      </MFoot>
    </MCard>
  );
}
