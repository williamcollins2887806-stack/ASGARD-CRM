/**
 * RejectModal — отклонить заявку (со вежливым автоответом).
 */
import { useState } from 'react';
import { MCard, MHead, MBody, MFoot, Btn, Field, Textarea } from '@/modals/parts';
import { Checkbox } from '@/inputs/Inputs';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { reject } from './api';

export default function RejectModal({ application, onRejected }) {
  const { close } = useModal();
  const [reason, setReason] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await reject(application.id, reason.trim(), sendEmail);
      toast.success('Заявка отклонена');
      onRejected?.();
      close();
    } catch (e) {
      toast.error('Не удалось отклонить: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon="✕"
        title={`Отклонить заявку №${application.id}`}
        subtitle={application.subject || '(без темы)'}
        accent="danger"
        onClose={close}
      />
      <MBody>
        <Field label="Причина (для внутреннего журнала и текста письма)">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            maxLength={500}
            placeholder="Например: не наш профиль работ"
          />
        </Field>
        <Checkbox
          checked={sendEmail}
          onChange={setSendEmail}
          label="Отправить заказчику вежливый отказ по email"
        />
      </MBody>
      <MFoot align="spread">
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" onClick={submit} disabled={saving}>
          {saving ? '…' : 'Отклонить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
