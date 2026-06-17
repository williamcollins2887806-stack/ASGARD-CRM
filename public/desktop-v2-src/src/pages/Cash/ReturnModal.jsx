/**
 * ReturnModal — возврат остатка/погашение долга.
 * Источник: vanilla cash.js → showReturnModal/submitReturn.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, MoneyInput } from '@/inputs/Inputs';
import { returnRemainder, fmtMoney } from './api';

export default function ReturnModal({ requestId, remainder = 0, isLoan = false, onSaved }) {
  const { close } = useModal();
  const [amount, setAmount] = useState(String(remainder));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.warn('Сумма должна быть больше 0');
      return;
    }
    if (amt > remainder) {
      toast.warn(`Остаток ${fmtMoney(remainder)} — нельзя вернуть больше`);
      return;
    }
    setBusy(true);
    try {
      await returnRemainder(requestId, { amount: amt, note: note.trim() || null });
      toast.success(isLoan ? 'Платёж по долгу зарегистрирован' : 'Возврат зарегистрирован');
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon={isLoan ? '🪙' : '💵'}
        title={isLoan ? 'Погасить долг' : 'Вернуть остаток'}
        subtitle="Касса"
        accent="default"
        onClose={close}
      />
      <MBody>
        <div className="cash-alert info mb-14" >
          Остаток к возврату: <b className="c-t1">{fmtMoney(remainder)}</b>
        </div>

        <Field label="Сумма" required>
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>

        <Field label="Комментарий">
          <TextInput value={note} onChange={setNote} placeholder="Необязательно" />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close} disabled={busy}>Отмена</Btn>
        <Btn variant="success" onClick={onSubmit} disabled={busy}>
          {busy ? '...' : isLoan ? 'Погасить' : 'Вернуть'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
