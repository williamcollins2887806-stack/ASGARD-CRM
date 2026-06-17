/**
 * ReminderModal — поставить напоминание (`personal_kanban_card_reminders`).
 * Cron `personal-kanban-reminders-cron.js` берёт is_done=false AND fired_at IS NULL.
 */
import { useState, useMemo } from 'react';
import { MCard, MHead, MBody, MFoot, Btn, Field, Input, Textarea } from '@/modals/parts';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { addCardReminder } from './api';

function inOneHourLocal() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  // YYYY-MM-DDTHH:MM в локальном времени (для <input type=datetime-local>).
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ReminderModal({ card, onAdded }) {
  const { close } = useModal();
  const [when, setWhen] = useState(() => inOneHourLocal());
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const isValid = useMemo(() => {
    if (!when) return false;
    const t = new Date(when).getTime();
    return Number.isFinite(t) && t > Date.now() - 60000;
  }, [when]);

  const submit = async () => {
    if (!isValid) {
      toast.warn('Дата напоминания в прошлом');
      return;
    }
    setSaving(true);
    try {
      // Backend ожидает ISO-строку → отдаём `new Date(when).toISOString()`.
      await addCardReminder(card.id, {
        remind_at: new Date(when).toISOString(),
        message: message.trim() || null
      });
      toast.success('Напоминание поставлено');
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
      <MHead icon="⏰" title="Напоминание" subtitle={card?.entity?.title || ('Карта #' + card.id)} onClose={close} />
      <MBody>
        <Field label="Когда" required help="Локальное время">
          <Input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </Field>
        <Field label="Текст напоминания (необязательно)">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Что нужно сделать"
          />
        </Field>
      </MBody>
      <MFoot align="spread">
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" onClick={submit} disabled={saving || !isValid}>
          {saving ? '…' : 'Поставить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
