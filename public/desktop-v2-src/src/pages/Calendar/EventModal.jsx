import { useState, useEffect } from 'react';
import { useModal, ConfirmModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field, Input, Textarea, Select } from '@/modals/parts';
import { MultiSelect } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import {
  createEvent, updateEvent, deleteEvent,
  createMeeting, updateMeeting, deleteMeeting,
  loadUsers, loadAvailability, findTime,
  EVENT_TYPES, REMINDER_OPTS, RECUR_OPTS, defaultEnd, ymd, addDays
} from './api';

const MEETING_TYPES = new Set(['meeting', 'call', 'visit']);

/**
 * Модалка создания / редактирования события или Outlook-встречи.
 */
export function EventModal({ event, defaultDate, onChanged }) {
  const { close, open } = useModal();
  const isEdit = !!event?.id;
  const isMeeting = event?.source === 'meeting' || !!event?.meeting_id;

  const [tab, setTab] = useState('main');
  const [data, setData] = useState({
    title:        event?.title || '',
    date:         (event?.date || defaultDate || todayYmd()).toString().slice(0, 10),
    time:         String(event?.time || '10:00').slice(0, 5),
    end_time:     String(event?.end_time || defaultEnd(event?.time || '10:00')).slice(0, 5),
    type:         event?.type || 'meeting',
    description:  event?.description || '',
    location:     event?.location || '',
    conference_url: event?.conference_url || '',
    reminder_minutes: event?.reminder_minutes ?? 30,
    recurrence_rule: event?.recurrence_rule || 'NONE',
    send_invites: true
  });
  const [participantIds, setParticipantIds] = useState([]);
  const [guests, setGuests] = useState([{ name: '', email: '' }]);
  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [slots, setSlots] = useState([]);
  const [plannerBusy, setPlannerBusy] = useState(false);
  const [plFrom, setPlFrom] = useState(data.date);
  const [plTo, setPlTo] = useState(ymd(addDays(new Date(data.date), 7)));
  const [plDur, setPlDur] = useState(60);
  const [availSummary, setAvailSummary] = useState([]);

  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));

  useEffect(() => {
    loadUsers().then((us) => setUsers((us || []).filter((u) => u.is_active !== false)));
  }, []);

  useEffect(() => {
    if (!isMeeting || !event?.meeting_id) return;
    import('@/api/client').then(({ api }) => {
      api(`/api/meetings/${event.meeting_id}`).then((det) => {
        setParticipantIds((det.participants || []).map((p) => p.user_id).filter(Boolean));
        const g = (det.guests || []).map((x) => ({ name: x.name || '', email: x.email || '' }));
        if (g.length) setGuests(g);
      }).catch(() => {});
    });
  }, [isMeeting, event?.meeting_id]);

  const userOptions = users.map((u) => ({ value: String(u.id), label: u.name || u.login }));

  const cleanGuests = () => guests
    .map((g) => ({ email: g.email.trim().toLowerCase(), name: g.name.trim() || null }))
    .filter((g) => g.email.includes('@'));

  const submit = async () => {
    if (!data.title.trim()) { toast.warn('Введите название события'); return; }
    if (!data.date) { toast.warn('Укажите дату'); return; }
    setSaving(true);
    try {
      const guestsClean = cleanGuests();
      const asMeeting = MEETING_TYPES.has(data.type) &&
        (participantIds.length > 0 || guestsClean.length > 0 || isMeeting);

      if (asMeeting) {
        const payload = {
          title: data.title.trim(),
          description: data.description || '',
          location: data.location || null,
          conference_url: data.conference_url || null,
          start_time: `${data.date}T${data.time || '10:00'}:00`,
          end_time: `${data.date}T${data.end_time || defaultEnd(data.time)}:00`,
          participant_ids: participantIds,
          guests: guestsClean,
          send_invites: !!data.send_invites,
          notify_before_minutes: Number(data.reminder_minutes) || 15,
          recurrence_rule: data.recurrence_rule
        };
        if (isMeeting && event.meeting_id) {
          await updateMeeting(event.meeting_id, payload);
          toast.success('Встреча сохранена');
        } else {
          await createMeeting(payload);
          toast.success('Встреча создана, приглашения отправлены');
        }
      } else {
        const body = {
          title: data.title.trim(),
          date: data.date,
          time: data.time || '10:00',
          end_time: data.end_time || null,
          type: data.type,
          description: data.description || '',
          location: data.location || data.conference_url || '',
          reminder_minutes: Number(data.reminder_minutes) || 0,
          recurrence: data.recurrence_rule === 'NONE' ? null : data.recurrence_rule
        };
        if (isEdit && !isMeeting) {
          await updateEvent(event.id, body);
          toast.success('Событие сохранено');
        } else {
          await createEvent(body);
          toast.success('Событие создано');
        }
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
        message={event.title || 'Событие будет удалено. Участникам уйдёт отмена.'}
        tone="danger"
        okText="Удалить"
        onConfirm={async () => {
          try {
            if (isMeeting && event.meeting_id) await deleteMeeting(event.meeting_id);
            else await deleteEvent(event.id);
            toast.success('Удалено');
            onChanged?.();
            close();
          } catch (e) {
            toast.error('Ошибка: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const runFindTime = async () => {
    if (!participantIds.length) {
      toast.warn('Сначала выберите участников');
      return;
    }
    setPlannerBusy(true);
    try {
      const avail = await loadAvailability(participantIds, plFrom, plTo);
      const summary = participantIds.map((id) => {
        const blocks = avail.users?.[id] || [];
        const u = users.find((x) => x.id === id);
        return {
          id,
          name: u?.name || `#${id}`,
          kinds: [...new Set(blocks.map((b) => b.kind))].join(', ') || 'свободен',
          busy: blocks.length > 0
        };
      });
      setAvailSummary(summary);

      const found = await findTime({
        user_ids: participantIds,
        duration_minutes: plDur,
        window_from: `${plFrom}T00:00:00+03:00`,
        window_to: `${plTo}T23:59:59+03:00`,
        allow_missing: 0
      });
      setSlots(found.slots || []);
      if (!(found.slots || []).length) toast.warn('Общих окон не найдено');
    } catch (e) {
      toast.error(e?.message || String(e));
    } finally {
      setPlannerBusy(false);
    }
  };

  const applySlot = (slot) => {
    const fmt = (iso) => {
      const f = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Moscow',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
      });
      const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
      return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
    };
    const a = fmt(slot.start);
    const b = fmt(slot.end);
    setData((d) => ({ ...d, date: a.date, time: a.time, end_time: b.time }));
    setTab('main');
    toast.success('Время подставлено');
  };

  return (
    <MCard>
      <MHead
        icon={isEdit ? '✎' : '＋'}
        title={isEdit ? 'Редактировать событие' : 'Новое событие'}
        subtitle="Встреча с участниками, гостями и ICS"
        accent="info"
        onClose={close}
      />
      <MBody>
        <div className="row gap-8 mb-12">
          <Btn variant={tab === 'main' ? 'primary' : 'ghost'} onClick={() => setTab('main')}>Встреча</Btn>
          <Btn variant={tab === 'planner' ? 'primary' : 'ghost'} onClick={() => setTab('planner')}>Подбор времени</Btn>
        </div>

        {tab === 'main' ? (
          <>
            <Field label="Название" required>
              <Input value={data.title} onChange={(e) => set('title', e.target.value)} placeholder="ВКС ТАБЕЛЬ" autoFocus />
            </Field>

            <div className="m-grid-3">
              <Field label="Дата" required>
                <Input type="date" value={data.date} onChange={(e) => set('date', e.target.value)} />
              </Field>
              <Field label="Начало">
                <Input type="time" value={data.time} onChange={(e) => set('time', e.target.value)} />
              </Field>
              <Field label="Конец">
                <Input type="time" value={data.end_time} onChange={(e) => set('end_time', e.target.value)} />
              </Field>
            </div>

            <div className="m-grid-3">
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
              <Field label="Повтор">
                <Select value={data.recurrence_rule} onChange={(e) => set('recurrence_rule', e.target.value)}>
                  {RECUR_OPTS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="m-grid-2">
              <Field label="Место">
                <Input value={data.location} onChange={(e) => set('location', e.target.value)} placeholder="Переговорная" />
              </Field>
              <Field label="Ссылка ВКС">
                <Input value={data.conference_url} onChange={(e) => set('conference_url', e.target.value)} placeholder="https://…" />
              </Field>
            </div>

            <Field label="Участники (CRM)">
              <MultiSelect
                value={participantIds.map(String)}
                onChange={(vals) => setParticipantIds(vals.map(Number))}
                options={userOptions}
                placeholder="Выбрать сотрудников…"
              />
            </Field>

            <Field label="Гости (email)">
              <div className="col gap-8">
                {guests.map((g, i) => (
                  <div key={i} className="m-grid-2 gap-8" style={{ alignItems: 'end' }}>
                    <Input
                      value={g.name}
                      onChange={(e) => {
                        const next = [...guests];
                        next[i] = { ...next[i], name: e.target.value };
                        setGuests(next);
                      }}
                      placeholder="Имя"
                    />
                    <div className="row gap-8">
                      <Input
                        value={g.email}
                        onChange={(e) => {
                          const next = [...guests];
                          next[i] = { ...next[i], email: e.target.value };
                          setGuests(next);
                        }}
                        placeholder="guest@company.ru"
                      />
                      <Btn variant="ghost" onClick={() => setGuests(guests.filter((_, j) => j !== i))}>✕</Btn>
                    </div>
                  </div>
                ))}
                <Btn variant="ghost" onClick={() => setGuests([...guests, { name: '', email: '' }])}>+ Гость</Btn>
              </div>
            </Field>

            <Field label="Описание">
              <Textarea value={data.description} onChange={(e) => set('description', e.target.value)} rows={3} />
            </Field>

            <label className="row gap-8" style={{ alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={!!data.send_invites}
                onChange={(e) => set('send_invites', e.target.checked)}
              />
              <span>Отправить приглашения (email + ICS)</span>
            </label>
          </>
        ) : (
          <>
            <div className="m-grid-3">
              <Field label="Окно с">
                <Input type="date" value={plFrom} onChange={(e) => setPlFrom(e.target.value)} />
              </Field>
              <Field label="по">
                <Input type="date" value={plTo} onChange={(e) => setPlTo(e.target.value)} />
              </Field>
              <Field label="Минут">
                <Input type="number" value={plDur} onChange={(e) => setPlDur(Number(e.target.value) || 60)} />
              </Field>
            </div>
            <Btn variant="primary" disabled={plannerBusy} onClick={runFindTime}>
              {plannerBusy ? 'Ищем…' : 'Найти общее время'}
            </Btn>
            <div className="col gap-6 mt-12">
              {availSummary.map((a) => (
                <div key={a.id} className="c-t2 fs-12">
                  <b>{a.name}</b>: {a.kinds}
                </div>
              ))}
            </div>
            <div className="col gap-6 mt-12">
              {slots.slice(0, 12).map((s) => (
                <Btn key={s.start} variant="ghost" onClick={() => applySlot(s)}>
                  {new Date(s.start).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}
                  {' – '}
                  {new Date(s.end).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })}
                </Btn>
              ))}
            </div>
          </>
        )}
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
