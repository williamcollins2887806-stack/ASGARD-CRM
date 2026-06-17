/**
 * SendConfirmModal — подтверждение отправки заявки подрядчику.
 * Источник: vanilla permit_applications.js → openSendConfirmModal.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Checkbox } from '@/inputs/Inputs';
import { sendApplication } from './api';

export default function SendConfirmModal({ application, onSuccess }) {
  const { close } = useModal();
  const [copyToSelf, setCopyToSelf] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    setBusy(true);
    try {
      await sendApplication(application.id, copyToSelf);
      toast.success('Заявка отправлена');
      onSuccess?.();
      close();
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead icon="✉" title="Отправить заявку подрядчику" accent="gold" onClose={close} />
      <MBody>
        <div className="mb-14">
          <div className="fs-11 c-t3 upper mb-4">Кому</div>
          <div className="fw-600">{application.contractor_email || '—'}</div>
        </div>
        <div className="mb-14">
          <div className="fs-11 c-t3 upper mb-4">Тема</div>
          <div>Заявка на оформление разрешений {application.number || ''} — ООО «Асгард Сервис»</div>
        </div>
        <div className="mb-14">
          <div className="fs-11 c-t3 upper mb-4">Вложение</div>
          <div>{application.number || 'draft'}_реестр.xlsx</div>
        </div>
        <Checkbox checked={copyToSelf} onChange={setCopyToSelf} label="Отправить копию на мой email" />
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close} disabled={busy}>Отмена</Btn>
        <Btn variant="primary" onClick={onSubmit} disabled={busy}>{busy ? 'Отправляем…' : 'Отправить'}</Btn>
      </MFoot>
    </MCard>
  );
}
