import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, PhoneInput, TextareaInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { makeCall } from '../api';

export function MakeCallModal({ defaultPhone, contactName }) {
  const { close } = useModal();
  const [form, setForm] = useState({ to: defaultPhone || '', record: true, comment: '' });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!form.to?.trim()) return toast('Номер', '—', 'warn');
    setBusy(true);
    try {
      await makeCall({ to_number: form.to, record: form.record, comment: form.comment, contact_name: contactName });
      toast('📞 Звоним…', form.to, 'ok');
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-sm">
      <MHead icon="📞" title="Позвонить" subtitle={contactName} onClose={close} />
      <MBody>
        <div className="col gap-10">
          <Field label="Номер" required><PhoneInput value={form.to} onChange={(v) => setForm({ ...form, to: v })} /></Field>
          <Field label="Комментарий" help="О чём планируешь говорить (для записи в карточку)">
            <TextareaInput value={form.comment} onChange={(v) => setForm({ ...form, comment: v })} minRows={2} maxRows={4} />
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={submit}>{busy ? 'Звоним…' : '📞 Позвонить'}</Btn>
      </MFoot>
    </MCard>
  );
}
