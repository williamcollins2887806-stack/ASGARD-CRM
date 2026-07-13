/**
 * Отправка финализированного письма по email из CRM.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, TextareaInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { sendLetterEmail } from './api';

export function SendEmailModal({ item, onSaved }) {
  const { close } = useModal();
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState(item.subject ? `Исх. ${item.number || ''}: ${item.subject}` : '');
  const [bodyText, setBodyText] = useState('Добрый день!\n\nНаправляем письмо во вложении.\n\nС уважением.');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const emails = to.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
    if (!emails.length) {
      toast.warn('Укажите email получателя');
      return;
    }
    setSaving(true);
    try {
      await sendLetterEmail(item.id, {
        to: emails.length === 1 ? emails[0] : emails,
        subject: subject.trim() || item.subject,
        body_text: bodyText
      });
      toast.success('Письмо отправлено');
      window.dispatchEvent(new CustomEvent('asgard:correspondence:changed'));
      onSaved?.();
      close();
    } catch (e) {
      toast.error(e?.message || 'Не удалось отправить');
    } finally {
      setSaving(false);
    }
  };

  return (
    <MCard className="modal-lg">
      <MHead
        icon="📧"
        title="Отправить email"
        subtitle={item.number || 'Исх. письмо'}
        onClose={close}
      />
      <MBody>
        <div className="form-grid cols-1">
          <Field label="Кому (email)" required>
            <TextInput value={to} onChange={setTo} placeholder="client@example.com" />
          </Field>
          <Field label="Тема">
            <TextInput value={subject} onChange={setSubject} />
          </Field>
          <Field label="Текст письма">
            <TextareaInput value={bodyText} onChange={setBodyText} minRows={5} />
          </Field>
          <div className="fs-12 c-t3">К письму будут приложены PDF и DOCX бланка.</div>
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={saving} onClick={submit}>
          {saving ? 'Отправляем…' : 'Отправить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
