/**
 * ReminderEditModal — создание/редактирование напоминания.
 */
import { useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { api } from '@/api/client';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { Field, TextInput, TextareaInput, SelectInput, DatePicker } from '@/inputs/Inputs';

function TimePicker({ value, onChange }) {
  return (
    <input
      type="time"
      className="inp-text"
      value={value || ''}
      onChange={(e) => onChange?.(e.target.value)}
    />
  );
}


const TYPE_OPTIONS = [
  { value: 'custom',   label: '🔔 Напоминание' },
  { value: 'deadline', label: '⏰ Дедлайн' },
  { value: 'invoice',  label: '💰 Счёт' },
  { value: 'work',     label: '🔧 Работа' },
  { value: 'tender',   label: '📋 Тендер' }
];

const PRIORITY_OPTIONS = [
  { value: 'low',    label: 'Низкий' },
  { value: 'normal', label: 'Обычный' },
  { value: 'high',   label: 'Высокий' },
  { value: 'urgent', label: 'Срочный' }
];

function emit() { window.dispatchEvent(new CustomEvent('asgard:reminders:changed')); }

function toDate(d) { if (!d) return ''; const dt = new Date(d); const y = dt.getFullYear(); const m = String(dt.getMonth() + 1).padStart(2, '0'); const day = String(dt.getDate()).padStart(2, '0'); return `${y}-${m}-${day}`; }
function toTime(d) { if (!d) return ''; const dt = new Date(d); const h = String(dt.getHours()).padStart(2, '0'); const m = String(dt.getMinutes()).padStart(2, '0'); return `${h}:${m}`; }

export function ReminderEditModal({ reminder, onSaved }) {
  const { user } = useAuth();
  const { close } = useModal();
  const isEdit = !!reminder?.id;

  const [title, setTitle] = useState(reminder?.title || '');
  const [description, setDescription] = useState(reminder?.description || '');
  const [type, setType] = useState(reminder?.type || 'custom');
  const [priority, setPriority] = useState(reminder?.priority || 'normal');
  const initDate = reminder?.remind_at ? new Date(reminder.remind_at) : new Date(Date.now() + 3600000);
  const [date, setDate] = useState(toDate(initDate));
  const [time, setTime] = useState(toTime(initDate));
  const [busy, setBusy] = useState(false);

  const onSave = async () => {
    if (!title.trim()) { toast.error('Укажите заголовок'); return; }
    setBusy(true);
    try {
      // Backend хранит дату в reminder_date (а не remind_at, как изначально писал фронт).
      // Без этого фикса дата напоминания молча отбрасывалась generic-роутом /api/data/reminders.
      // type/priority оставляем на случай, если миграция расширит таблицу — generic data-роут
      // сам отфильтрует поля по фактическим колонкам, и неизвестные просто проигнорируются.
      const remindAt = date ? new Date(`${date}T${time || '09:00'}:00`).toISOString() : null;
      const payload = {
        ...reminder,
        title: title.trim(),
        description: description.trim() || null,
        type,
        priority,
        reminder_date: remindAt,
        user_id: reminder?.user_id || user?.id || null,
        updated_at: new Date().toISOString()
      };
      if (isEdit) {
        await api(`/api/data/reminders/${reminder.id}`, { method: 'PUT', body: payload });
        toast.success('Напоминание обновлено');
      } else {
        payload.created_at = new Date().toISOString();
        payload.completed = false;
        payload.dismissed = false;
        await api('/api/data/reminders', { method: 'POST', body: payload });
        toast.success('Напоминание создано');
      }
      emit();
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon={isEdit ? '✎' : '🔔'}
        title={isEdit ? 'Редактировать напоминание' : 'Новое напоминание'}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="col gap-14">
          <Field label="Заголовок" required>
            <TextInput value={title} onChange={setTitle} placeholder="О чём напомнить" />
          </Field>
          <Field label="Описание">
            <TextareaInput value={description} onChange={setDescription} placeholder="Подробности (необязательно)" />
          </Field>
          <div className="grid-2 gap-10">
            <Field label="Тип">
              <SelectInput value={type} onChange={setType} options={TYPE_OPTIONS} />
            </Field>
            <Field label="Приоритет">
              <SelectInput value={priority} onChange={setPriority} options={PRIORITY_OPTIONS} />
            </Field>
          </div>
          <div className="grid-2 gap-10">
            <Field label="Дата">
              <DatePicker value={date} onChange={setDate} />
            </Field>
            <Field label="Время">
              <TimePicker value={time} onChange={setTime} />
            </Field>
          </div>
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" onClick={onSave} disabled={busy}>
          {busy ? 'Сохраняем…' : isEdit ? 'Сохранить' : 'Создать'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
