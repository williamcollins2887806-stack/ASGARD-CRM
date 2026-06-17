/**
 * NoteModal — добавить заметку к карте.
 */
import { useState } from 'react';
import { MCard, MHead, MBody, MFoot, Btn, Field, Textarea } from '@/modals/parts';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { addCardNote } from './api';

export default function NoteModal({ card, onAdded }) {
  const { close } = useModal();
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const t = body.trim();
    if (t.length < 1) {
      toast.warn('Введите текст заметки');
      return;
    }
    if (t.length > 4000) {
      toast.warn('Заметка ≤ 4000 символов');
      return;
    }
    setSaving(true);
    try {
      await addCardNote(card.id, t);
      toast.success('Заметка сохранена');
      onAdded?.();
      close();
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <MCard>
      <MHead icon="📝" title="Заметка к карте" subtitle={card?.entity?.title || ('Карта #' + card.id)} onClose={close} />
      <MBody>
        <Field label="Текст заметки" required>
          <Textarea
            autoFocus
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            maxLength={4000}
            placeholder="Контекст, договорённости, важные детали…"
          />
        </Field>
        <div className="fs-11 c-t3 t-right">{body.length}/4000</div>
      </MBody>
      <MFoot align="spread">
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" onClick={submit} disabled={saving || body.trim().length < 1}>
          {saving ? '…' : 'Сохранить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
