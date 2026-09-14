/**
 * EditPaymentModal — правка суммы / способа / комментария / даты выплаты.
 * Vanilla: field-tab.js openEditPaymentModal.
 * PUT /api/worker-payments/:id
 */
import { useState } from 'react';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, NumberInput, SelectInput, DatePicker } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { useModal } from '@/modals';
import { updatePayment } from '../../api';

const METHOD_OPTS = [
  { value: 'cash', label: '💵 Наличные' },
  { value: 'card', label: '💳 Карта' },
  { value: 'transfer', label: '🏦 Перевод' },
  { value: 'bank', label: '🏦 Банк компании' },
  { value: 'self', label: '👤 Самозанятый' }
];

function dateValue(p) {
  const raw = p && (p.paid_at || p.period_to || p.created_at);
  if (!raw) return '';
  const s = String(raw);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

export function EditPaymentModal({ payment, onSaved }) {
  const { close } = useModal();
  const [amount, setAmount] = useState(payment?.amount ?? '');
  const [comment, setComment] = useState(payment?.comment || '');
  const [method, setMethod] = useState(payment?.payment_method || 'cash');
  const [date, setDate] = useState(dateValue(payment));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || (amt <= 0 && payment?.type !== 'penalty')) {
      toast('Укажите сумму', '', 'err');
      return;
    }
    setBusy(true);
    try {
      const payload = { amount: amt, comment: String(comment || '').trim(), payment_method: method };
      if (date) payload.paid_at = date;
      await updatePayment(payment.id, payload);
      toast('Сохранено', '', 'ok');
      close();
      onSaved?.();
    } catch (e) {
      toast('Ошибка', e?.message || String(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead title="Редактировать операцию" subtitle={payment?.employee_name || ''} />
      <MBody>
        <div className="col gap-3">
          <Field label="Сумма, ₽">
            <NumberInput value={amount} onChange={setAmount} min={0} step={1} />
          </Field>
          <Field label="Дата">
            <DatePicker value={date} onChange={setDate} />
          </Field>
          <Field label="Способ">
            <SelectInput options={METHOD_OPTS} value={method} onChange={setMethod} />
          </Field>
          <Field label="Комментарий">
            <TextInput value={comment} onChange={setComment} />
          </Field>
        </div>
      </MBody>
      <MFoot align="end">
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn onClick={save} disabled={busy}>{busy ? 'Сохранение…' : 'Сохранить'}</Btn>
      </MFoot>
    </MCard>
  );
}
