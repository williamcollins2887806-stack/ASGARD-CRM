/**
 * BulkRenewModal — массовое продление выбранных допусков.
 * Источник: vanilla permits.js → openBulkRenewModal.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { bulkRenew } from './api';

export default function BulkRenewModal({ permitIds = [], onSaved }) {
  const { close } = useModal();
  const [issueDate, setIssueDate]   = useState(new Date().toISOString().slice(0, 10));
  const [expiryDate, setExpiryDate] = useState('');
  const [busy, setBusy]             = useState(false);

  const onSubmit = async () => {
    if (!expiryDate) { toast.warn('Укажите дату окончания'); return; }
    setBusy(true);
    try {
      const res = await bulkRenew({
        permit_ids: permitIds,
        issue_date: issueDate,
        expiry_date: expiryDate
      });
      toast.success(`Обновлено ${res.renewed} из ${res.total}`);
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead icon="🔄" title="Массовое продление" accent="gold" onClose={close} />
      <MBody>
        <div className="mb-14">
          Выбрано допусков: <b>{permitIds.length}</b>
        </div>

        <Field label="Дата выдачи">
          <input type="date" className="m-input" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
        </Field>

        <Field label="Действует до" required>
          <input type="date" className="m-input" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close} disabled={busy}>Отмена</Btn>
        <Btn variant="primary" onClick={onSubmit} disabled={busy}>{busy ? '...' : 'Продлить все'}</Btn>
      </MFoot>
    </MCard>
  );
}
