/**
 * RenewModal — продлить допуск (создаёт новый на основе старого).
 * Источник: vanilla permits.js → openRenewModal.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput } from '@/inputs/Inputs';
import { renewPermit, getTypeById } from './api';

export default function RenewModal({ permit, types = [], onSaved }) {
  const { close } = useModal();
  const type = getTypeById(types, permit.type_id);

  let suggestedExpiry = '';
  if (type.validity_months) {
    const d = new Date();
    d.setMonth(d.getMonth() + type.validity_months);
    suggestedExpiry = d.toISOString().slice(0, 10);
  }

  const [issueDate, setIssueDate]   = useState(new Date().toISOString().slice(0, 10));
  const [expiryDate, setExpiryDate] = useState(suggestedExpiry);
  const [docNumber, setDocNumber]   = useState(permit.doc_number || '');
  const [issuer, setIssuer]         = useState(permit.issuer || '');
  const [busy, setBusy]             = useState(false);

  const onSubmit = async () => {
    if (!expiryDate) { toast.warn('Укажите дату окончания'); return; }
    setBusy(true);
    try {
      await renewPermit(permit.id, {
        issue_date: issueDate,
        expiry_date: expiryDate,
        doc_number: docNumber.trim() || null,
        issuer: issuer.trim() || null
      });
      toast.success('Допуск продлён (создан новый)');
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead icon="🔄" title="Продление допуска" accent="gold" onClose={close} />
      <MBody>
        <div className="mb-14">
          <div className="fw-700 c-t1">{permit.employee_name || 'Сотрудник'}</div>
          <div className="fs-13 c-t3">{type.name}</div>
        </div>

        <div className="grid-2 gap-12">
          <Field label="Дата выдачи нового">
            <input type="date" className="m-input" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </Field>
          <Field label="Действует до" required>
            <input type="date" className="m-input" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
          </Field>
        </div>

        <div className="grid-2 gap-12 mt-12">
          <Field label="Новый номер">
            <TextInput value={docNumber} onChange={setDocNumber} />
          </Field>
          <Field label="Кем выдано">
            <TextInput value={issuer} onChange={setIssuer} />
          </Field>
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close} disabled={busy}>Отмена</Btn>
        <Btn variant="primary" onClick={onSubmit} disabled={busy}>{busy ? '...' : 'Продлить'}</Btn>
      </MFoot>
    </MCard>
  );
}
