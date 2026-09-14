/**
 * Модалки вахты МЛСП: Продлить / Съехал / Вернуть.
 * Только офис — рабочий в приложении эти действия не видит.
 */
import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, DatePicker, TextareaInput, SelectInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { extendMlspStay, departMlspStay, reopenMlspStay, patchMlspStay, fmtDate } from './api';

function emitChanged() {
  window.dispatchEvent(new CustomEvent('asgard:personnel:changed'));
}

function todayLocalYmd() {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Moscow',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  } catch {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}

export function ExtendMlspModal({ stay }) {
  const { close } = useModal();
  const min = stay.planned_depart_at ? String(stay.planned_depart_at).slice(0, 10) : '';
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!date) { toast.warn('Укажите новую дату вывоза'); return; }
    if (min && date <= min) { toast.warn('Новая дата должна быть позже текущей плановой'); return; }
    setSaving(true);
    try {
      await extendMlspStay(stay.id, { planned_depart_at: date, note: note.trim() || null });
      toast.success('Вывоз продлён');
      emitChanged();
      close();
    } catch (e) {
      toast.error(e?.message || 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  return (
    <MCard>
      <MHead title={`Продлить — ${stay.fio || ''}`} onClose={close} />
      <MBody>
        <p className="muted fs-13 mb-12">
          Сейчас вывоз: <b>{fmtDate(stay.planned_depart_at)}</b>
          {stay.days_on_platform != null ? ` · на платформе ${stay.days_on_platform} дн.` : ''}
          . Счётчик дней с заезда не сбрасывается.
        </p>
        <Field label="Новая дата вывоза">
          <DatePicker value={date} onChange={(v) => setDate(v || '')} min={min || undefined} />
        </Field>
        <Field label="Заметка (необязательно)">
          <TextareaInput value={note} onChange={setNote} minRows={2} maxRows={3} placeholder="Согласовано с начальником МЛСП…" />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={saving} onClick={save}>{saving ? '…' : 'Продлить'}</Btn>
      </MFoot>
    </MCard>
  );
}

export function DepartMlspModal({ stay }) {
  const { close } = useModal();
  const today = todayLocalYmd();
  const [date, setDate] = useState(today);
  const [transport, setTransport] = useState(stay.transport || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!date) { toast.warn('Укажите дату съезда'); return; }
    if (date > today) { toast.warn('Дата не позже сегодня'); return; }
    setSaving(true);
    try {
      await departMlspStay(stay.id, {
        actual_departed_at: date,
        transport: transport || null,
      });
      toast.success('Отмечен съезд с МЛСП');
      emitChanged();
      close();
    } catch (e) {
      toast.error(e?.message || 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  return (
    <MCard>
      <MHead title={`Съехал — ${stay.fio || ''}`} onClose={close} />
      <MBody>
        <p className="muted fs-13 mb-12">
          Закроет вахту и все активные назначения на работах МЛСП.
        </p>
        <Field label="Дата съезда">
          <DatePicker value={date} onChange={(v) => setDate(v || '')} max={today} />
        </Field>
        <Field label="Чем вывезли">
          <SelectInput
            value={transport}
            onChange={setTransport}
            options={[
              { value: '', label: '— не указано —' },
              { value: 'helicopter', label: 'Вертолёт' },
              { value: 'ship', label: 'Корабль' },
            ]}
          />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={saving} onClick={save}>{saving ? '…' : 'Съехал'}</Btn>
      </MFoot>
    </MCard>
  );
}

export function ReopenMlspModal({ stay }) {
  const { close } = useModal();
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await reopenMlspStay(stay.id);
      toast.success('Вернули на платформу');
      emitChanged();
      close();
    } catch (e) {
      toast.error(e?.message || 'Ошибка');
    } finally {
      setSaving(false);
    }
  };
  return (
    <MCard>
      <MHead title={`Вернуть на платформу — ${stay.fio || ''}`} onClose={close} />
      <MBody>
        <p className="muted fs-13 mb-12">
          Автовыезд {fmtDate(stay.actual_departed_at)}. Откроем stay снова и снимем дату убытия с назначений МЛСП.
        </p>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={saving} onClick={save}>{saving ? '…' : 'Вернуть'}</Btn>
      </MFoot>
    </MCard>
  );
}

/** Селект транспорта вывоза прямо в таблице */
export function TransportSelect({ stay, disabled }) {
  const [val, setVal] = useState(stay.transport || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setVal(stay.transport || ''); }, [stay.id, stay.transport]);
  const onChange = async (v) => {
    setVal(v);
    setBusy(true);
    try {
      await patchMlspStay(stay.id, { transport: v || null });
      emitChanged();
    } catch (e) {
      toast.error(e?.message || 'Не сохранилось');
      setVal(stay.transport || '');
    } finally {
      setBusy(false);
    }
  };
  return (
    <select
      className="prs-mlsp-transport"
      value={val}
      disabled={disabled || busy || !stay.is_open}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Чем вывозим"
    >
      <option value="">—</option>
      <option value="helicopter">Вертолёт</option>
      <option value="ship">Корабль</option>
    </select>
  );
}
