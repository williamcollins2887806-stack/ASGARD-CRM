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

import { createMeeting, updateMeeting, loadUsers } from './api';

function emit() { window.dispatchEvent(new CustomEvent('asgard:meetings:changed')); }

export function MeetingEditModal({ meeting, onSaved }) {
  const { close } = useModal();
  const isEdit = !!meeting?.id;

  const initialStart = meeting?.start_time ? new Date(meeting.start_time) : new Date(Date.now() + 3600000);
  const initialEnd = meeting?.end_time ? new Date(meeting.end_time) : null;

  const [title, setTitle] = useState(meeting?.title || '');
  const [description, setDescription] = useState(meeting?.description || '');
  const [location, setLocation] = useState(meeting?.location || '');
  const [conferenceUrl, setConferenceUrl] = useState(meeting?.conference_url || '');
  // Новое совещание: Тинг по умолчанию, кроме уже вставленного чужого VCS
  const [createThing, setCreateThing] = useState(() => {
    const conf = String(meeting?.conference_url || '').trim();
    if (!conf) return true;
    return /\/ting\//i.test(conf) || /#\/ting\b/i.test(conf);
  });
  const [protocolEnabled, setProtocolEnabled] = useState(() => !!meeting?.protocol_enabled);
  const [guestEmails, setGuestEmails] = useState('');
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
      const conf = conferenceUrl.trim();
      const foreignVcs = !!(conf && !/\/ting\//i.test(conf) && !/#\/ting\b/i.test(conf));
      const payload = {
        title: title.trim(),
        description: description.trim(),
        location: location.trim(),
        conference_url: conf || null,
        start_time: startISO,
        end_time: endISO,
        guests: guestEmails
          .split(/[,;\s]+/)
          .map((e) => e.trim().toLowerCase())
          .filter((e) => e.includes('@'))
          .map((email) => ({ email })),
        send_invites: true,
        participant_ids: participants
      };
      if (!isEdit && createThing && !foreignVcs) {
        payload.create_thing = true;
        payload.protocol_enabled = !!protocolEnabled;
      }
      let saved;
      if (isEdit) {
        saved = await updateMeeting(meeting.id, payload);
      } else {
        saved = await createMeeting(payload);
      }
      const thing = saved?.thing || saved?.data?.thing;
      if (thing?.slug) {
        toast.success(
          (isEdit ? 'Совещание обновлено' : 'Совещание создано')
          + `. Тинг: ${thing.url || '/ting/' + thing.slug}`
        );
      } else {
        toast.success(isEdit ? 'Совещание обновлено' : 'Совещание создано');
      }
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
          <Field label="Ссылка ВКС">
            <TextInput value={conferenceUrl} onChange={setConferenceUrl} placeholder="https://… или галка Тинг" />
          </Field>
          <label className="row gap-8" style={{ alignItems: 'flex-start' }}>
            <input type="checkbox" checked={createThing} onChange={(e) => setCreateThing(e.target.checked)} />
            <span>
              <strong>Тинг-конференция</strong>
              <div className="muted" style={{ fontSize: 12 }}>Создать комнату и подставить ссылку</div>
            </span>
          </label>
          <label className="row gap-8" style={{ alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              checked={protocolEnabled}
              onChange={(e) => setProtocolEnabled(e.target.checked)}
              disabled={!createThing}
            />
            <span>
              <strong>AI-протокол</strong>
              <div className="muted" style={{ fontSize: 12 }}>После записи собрать протокол</div>
            </span>
          </label>
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
          <Field label="Гости (email)">
            <TextInput
              value={guestEmails}
              onChange={setGuestEmails}
              placeholder="guest1@mail.ru, guest2@mail.ru"
            />
          </Field>
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
