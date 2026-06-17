import { useState } from 'react';
import { useModal, ConfirmModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field, Input, Textarea, Select } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { createEvent, updateEvent, deleteEvent, EVENT_TYPES, REMINDER_OPTS } from './api';

/**
 * Модалка создания / редактирования / удаления события.
 */
export function EventModal({ event, defaultDate, onChanged }) {
  const { close, open } = useModal();
  const isEdit = !!event?.id;

  const [data, setData] = useState({
    title:        event?.title || '',
    date:         (event?.date || defaultDate || todayYmd()).slice(0, 10),
    time:         event?.time || '10:00',
    type:         event?.type || 'meeting',
    description:  event?.description || '',
    location:     event?.location || '',
    reminder_minutes: event?.reminder_minutes ?? 30
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));

  const submit = async () => {
    if (!data.title.trim()) {
      toast.warn('Введите название события');
      return;
    }
    if (!data.date) {
      toast.warn('Укажите дату');
      return;
    }
    setSaving(true);
    try {
      const body = {
        title:       data.title.trim(),
        date:        data.date,
        time:        data.time || '10:00',
        type:        data.type,
        description: data.description || '',
        location:    data.location || '',
        reminder_minutes: Number(data.reminder_minutes) || 0
      };
      if (isEdit) {
        await updateEvent(event.id, body);
        toast.success('Событие сохранено');
      } else {
        await createEvent(body);
        toast.success('Событие создано');
      }
      onChanged?.();
      close();
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = () => {
    open(
      <ConfirmModal
        title="Удалить событие?"
        message={event.title || 'Это событие будет удалено навсегда.'}
        tone="danger"
        okText="Удалить"
        onConfirm={async () => {
          try {
            await deleteEvent(event.id);
            toast.success('Событие удалено');
            onChanged?.();
            close();
          } catch (e) {
            toast.error('Ошибка: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  return (
    <MCard>
      <MHead
        icon={isEdit ? '✎' : '＋'}
        title={isEdit ? 'Редактировать событие' : 'Новое событие'}
        subtitle={isEdit ? event.title : 'Заполните название и время'}
        accent="info"
        onClose={close}
      />
      <MBody>
        <Field label="Название" required>
          <Input
            value={data.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Совещание по работе…"
            autoFocus
          />
        </Field>

        <div className="m-grid-2">
          <Field label="Дата" required>
            <Input type="date" value={data.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field label="Время">
            <Input type="time" value={data.time} onChange={(e) => set('time', e.target.value)} />
          </Field>
        </div>

        <div className="m-grid-2">
          <Field label="Тип события">
            <Select value={data.type} onChange={(e) => set('type', e.target.value)}>
              {EVENT_TYPES.map((t) => (
                <option key={t.code} value={t.code}>{t.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Напоминание">
            <Select value={String(data.reminder_minutes)} onChange={(e) => set('reminder_minutes', e.target.value)}>
              {REMINDER_OPTS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Место">
          <Input
            value={data.location}
            onChange={(e) => set('location', e.target.value)}
            placeholder="Адрес или ссылка на Zoom/MAX/Telegram"
          />
        </Field>

        <Field label="Описание">
          <Textarea
            value={data.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Повестка, участники, заметки…"
            rows={3}
          />
        </Field>
      </MBody>
      <MFoot>
        {isEdit && <Btn variant="danger" onClick={onDelete}>Удалить</Btn>}
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={saving} onClick={submit}>
          {saving ? 'Сохраняем…' : (isEdit ? 'Сохранить' : 'Создать')}
        </Btn>
      </MFoot>
    </MCard>
  );
}

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
