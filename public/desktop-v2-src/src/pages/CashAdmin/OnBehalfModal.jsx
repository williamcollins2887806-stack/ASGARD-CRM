/**
 * Заявка в кассу от бухгалтерии за сотрудника.
 * Деньги и история — на user_id выбранного человека. Директору уходит то же письмо.
 */
import { useState, useEffect, useMemo } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextareaInput, MoneyInput, SelectInput } from '@/inputs/Inputs';
import { positiveAmountError } from '@/inputs/validators';
import { api } from '@/api/client';
import { createRequest } from '../Cash/api';

export default function OnBehalfModal({ onCreated }) {
  const { close } = useModal();
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/api/users?is_active=true&limit=400')
      .then((d) => setUsers(Array.isArray(d?.users) ? d.users : (Array.isArray(d) ? d : [])))
      .catch((e) => toast.error('Не удалось загрузить сотрудников: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  }, []);

  const opts = useMemo(() => [
    { value: '', label: '— Выберите сотрудника —' },
    ...users.map((u) => ({
      value: String(u.id),
      label: `${u.name || u.login || '#' + u.id}${u.role ? ' · ' + u.role : ''}`
    }))
  ], [users]);

  const amountErr = positiveAmountError(amount, 'Сумма');
  const purposeShort = purpose && purpose.trim().length > 0 && purpose.trim().length < 5
    ? 'Цель: минимум 5 символов' : null;

  const onSubmit = async () => {
    if (!userId) { toast.warn('Выберите сотрудника'); return; }
    if (amountErr) { toast.warn(amountErr); return; }
    if (!purpose.trim()) { toast.warn('Укажите, на что нужны деньги'); return; }
    if (purposeShort) { toast.warn(purposeShort); return; }
    setBusy(true);
    try {
      await createRequest({
        for_user_id: Number(userId),
        type: 'office',
        amount: parseFloat(amount),
        purpose: purpose.trim(),
        category: 'other',
        category_other_desc: purpose.trim()
      });
      toast.success('Заявка отправлена директору');
      onCreated?.();
      close();
    } catch (e) {
      toast.error('Не удалось создать: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon="💵"
        title="Запросить за сотрудника"
        subtitle="Директору уйдёт письмо. После согласования можно выдавать — деньги на баланс этого человека."
        accent="gold"
        onClose={close}
      />
      <MBody>
        <Field label="Кто просит / кому выдать" required>
          {loading
            ? <div className="c-t3 fs-13">Загрузка списка…</div>
            : <SelectInput value={userId} onChange={setUserId} options={opts} />}
        </Field>
        <Field label="Сумма" required error={amountErr}>
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        <Field label="На что" required error={purposeShort}>
          <TextareaInput value={purpose} onChange={setPurpose} placeholder="Цель выдачи" minRows={3} />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close} disabled={busy}>Отмена</Btn>
        <Btn variant="primary" onClick={onSubmit} disabled={busy || loading}>
          {busy ? 'Отправляем…' : 'Отправить директору'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
