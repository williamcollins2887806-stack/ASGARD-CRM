/**
 * BalanceAdjustModal — корректировка баланса кассы.
 * Источник: vanilla cash_admin.js → showBalanceAdjustModal/submitBalanceAdjust.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field, Input } from '@/modals/parts';
import { adjustBalance, fmtMoney } from './api';

export default function BalanceAdjustModal({ currentBalance, onSaved }) {
  const { close } = useModal();
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt === 0) {
      toast.warn('Укажите сумму (положительную для пополнения, отрицательную для списания)');
      return;
    }
    if (!description.trim()) {
      toast.warn('Укажите описание');
      return;
    }
    setBusy(true);
    try {
      await adjustBalance({ amount: amt, description: description.trim() });
      toast.success('Баланс обновлён');
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead icon="💰" title="Корректировка баланса кассы" subtitle="Администрирование кассы" accent="gold" onClose={close} />
      <MBody>
        <div className="cash-alert info mb-14" >
          Текущий баланс: <b className="c-t1">{fmtMoney(currentBalance)}</b>
        </div>

        <Field
          label="Сумма изменения"
          required
          help="Положительная — приход, отрицательная — расход (например: -50000)"
        >
          <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </Field>

        <Field label="Описание" required>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Причина корректировки" />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close} disabled={busy}>Отмена</Btn>
        <Btn variant="primary" onClick={onSubmit} disabled={busy}>{busy ? 'Сохраняем…' : 'Применить'}</Btn>
      </MFoot>
    </MCard>
  );
}
