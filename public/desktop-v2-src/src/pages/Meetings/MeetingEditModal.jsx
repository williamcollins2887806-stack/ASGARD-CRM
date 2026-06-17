/**
 * MeetingEditModal — создание/редактирование совещания.
 */
import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { Field, TextInput, TextareaInput, DatePicker, MultiSelect } from '@/inputs/Inputs';

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

import { createMeeting, updateMeeting, addParticipants, loadUsers } from './api';

function emit() { window.dispatchEvent(new CustomEvent('asgard:meetings:changed')); }

export function MeetingEditModal({ meeting, onSaved }) {
  const { close } = useModal();
  const isEdit = !!meeting?.id;

  const initialStart = meeting?.start_time ? new Date(meeting.start_time) : new Date(Date.now() + 3600000);
  const initialEnd = meeting?.end_time ? new Date(meeting.end_time) : null;

  const [title, setTitle] = useState(meeting?.title || '');
  const [description, setDescription] = useState(meeting?.description || '');
  const [location, setLocation] = useState(meeting?.location || '');
  const [date, setDate] = useState(toDateStr(initialStart));
  const [timeStart, setTimeStart] = useState(toTimeStr(initialStart));
  const [timeEnd, setTimeEnd] = useState(initialEnd ? toTimeStr(initialEnd) : '');
  const [users, setUsers] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadUsers().then((us) => setUsers(us.filter((u) => u.is_active)));
  }, []);

  // G-4: cross-field — окончание не раньше начала (один день)
  const timeRangeErr = timeStart && timeEnd && timeEnd < timeStart
    ? 'Время окончания раньше времени начала' : null;

  const onSave = async () => {
    if (!title.trim()) { toast.error('Укажите название'); return; }
    if (!date || !timeStart) { toast.error('Укажите дату и время начала'); return; }
    if (timeRangeErr) { toast.error(timeRangeErr); return; }
    setBusy(true);
    try {
      const startISO = new Date(`${date}T${timeStart}:00`).toISOString();
      const endISO = timeEnd ? new Date(`${date}T${timeEnd}:00`).toISOString() : null;
      const payload = {
        title: title.trim(),
        description: description.trim(),
        location: location.trim(),
        start_time: startISO,
        end_time: endISO
      };
      let saved;
      if (isEdit) {
        saved = await updateMeeting(meeting.id, payload);
      } else {
        saved = await createMeeting(payload);
        const newId = saved?.meeting?.id || saved?.id;
        if (newId && participants.length) {
          await addParticipants(newId, participants);
        }
      }
      toast.success(isEdit ? 'Совещание обновлено' : 'Совещание создано');
      emit();
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.message || e));
      setBusy(false);
    }
  };

  const userOptions = users.map((u) => ({ value: String(u.id), label: u.name }));

  return (
    <MCard>
      <MHead
        icon={isEdit ? '✎' : '📅'}
        title={isEdit ? 'Редактировать совещание' : 'Новое совещание'}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="col gap-14">
          <Field label="Название" required>
            <TextInput value={title} onChange={setTitle} placeholder="Совещание по работе…" />
          </Field>
          <Field label="Описание">
            <TextareaInput value={description} onChange={setDescription} placeholder="Повестка, контекст…" />
          </Field>
          <div className="grid-3 gap-10">
            <Field label="Дата" required>
              <DatePicker value={date} onChange={setDate} />
            </Field>
            <Field label="Время начала" required>
              <TimePicker value={timeStart} onChange={setTimeStart} />
            </Field>
            <Field label="Время окончания" error={timeRangeErr}>
              <TimePicker value={timeEnd} onChange={setTimeEnd} />
            </Field>
          </div>
          <Field label="Место">
            <TextInput value={location} onChange={setLocation} placeholder="Переговорная / Zoom / Telegram…" />
          </Field>
          {!isEdit && (
            <Field label="Участники" help="Можно добавить позже в карточке совещания">
              <MultiSelect
                value={participants.map(String)}
                onChange={(vals) => setParticipants(vals.map(Number))}
                options={userOptions}
                placeholder="Выбрать участников…"
              />
            </Field>
          )}
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

function toDateStr(d) {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function toTimeStr(d) {
  if (!d) return '';
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}
