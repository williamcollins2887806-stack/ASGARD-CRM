/**
 * Модалка внесения оплаты по счёту.
 * POST /api/invoices/:id/payments — бекенд сам обновит paid_amount и status.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field as FieldM } from '@/modals/parts';
import { TextInput, MoneyInput, TextareaInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { addPayment, fmtMoney } from './api';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function emitChanged() {
  window.dispatchEvent(new CustomEvent('asgard:invoices:changed'));
}

export default function PaymentModal({ invoice, onSaved }) {
  const { close } = useModal();
  const total     = Number(invoice.total_amount || 0);
  const paid      = Number(invoice.paid_amount  || 0);
  const remaining = Math.max(0, total - paid);

  const [amount,  setAmount]  = useState(String(remaining));
  const [date,    setDate]    = useState(todayISO());
  const [comment, setComment] = useState('');
  const [busy,    setBusy]    = useState(false);

  const save = async () => {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.warn('Сумма платежа должна быть положительной');
      return;
    }
    setBusy(true);
    try {
      await addPayment(invoice.id, {
        amount: amt,
        payment_date: date,
        comment: comment.trim() || undefined
      });
      toast.success('Платёж внесён');
      emitChanged();
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Не удалось внести платёж: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon="💰"
        title="Внести оплату"
        subtitle={`Счёт № ${invoice.invoice_number || invoice.id}`}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="col gap-14">
          <div className="inv-pay-info">
            <div className="k">Сумма счёта</div>
            <div className="v accent">{fmtMoney(total)}</div>
            <div className="k">Уже оплачено</div>
            <div className="v ok">{fmtMoney(paid)}</div>
            <div className="k">Остаток</div>
            <div className={'v ' + (remaining > 0 ? 'warn' : 'ok')}>{fmtMoney(remaining)}</div>
          </div>

          <FieldM label="Сумма платежа" required>
            <MoneyInput value={amount} onChange={setAmount} />
          </FieldM>

          <FieldM label="Дата платежа" required>
            <TextInput type="date" value={date} onChange={setDate} />
          </FieldM>

          <FieldM label="Комментарий">
            <TextareaInput value={comment} onChange={setComment} placeholder="Например: п/п №12345 от 14.06.2026" minRows={2} maxRows={5} />
          </FieldM>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={save}>
          {busy ? 'Сохраняем…' : '💾 Внести платёж'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
