/**
 * Отметить письмо отправленным вручную (вне CRM).
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, TextareaInput, SelectInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { markCorrespondenceSent, today } from './api';

const CHANNEL_OPTIONS = [
  { value: 'manual', label: 'Вручную (почта / курьер)' },
  { value: 'edo', label: 'ЭДО' },
  { value: 'email_external', label: 'Email вне CRM' }
];

export function MarkSentModal({ item, onSaved }) {
  const { close } = useModal();
  const [sentAt, setSentAt] = useState(today());
  const [channel, setChannel] = useState('manual');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await markCorrespondenceSent(item.id, {
        sent_at: sentAt,
        channel,
        note: note.trim() || undefined
      });
      toast.success('Письмо отмечено как отправленное');
      window.dispatchEvent(new CustomEvent('asgard:correspondence:changed'));
      onSaved?.();
      close();
    } catch (e) {
      toast.error(e?.message || 'Не удалось обновить статус');
    } finally {
      setSaving(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon="✉"
        title="Отметить отправленным"
        subtitle={`${item.number || '#' + item.id} · ${item.subject || ''}`}
        onClose={close}
      />
      <MBody>
        <div className="form-grid cols-2">
          <Field label="Дата отправки">
            <TextInput type="date" value={sentAt} onChange={setSentAt} />
          </Field>
          <Field label="Способ">
            <SelectInput value={channel} onChange={setChannel} options={CHANNEL_OPTIONS} />
          </Field>
          <div className="span-2">
            <Field label="Примечание">
              <TextareaInput value={note} onChange={setNote} minRows={2} placeholder="Курьер, ЭДО, комментарий…" />
            </Field>
          </div>
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={saving} onClick={submit}>
          {saving ? 'Сохраняем…' : 'Подтвердить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
