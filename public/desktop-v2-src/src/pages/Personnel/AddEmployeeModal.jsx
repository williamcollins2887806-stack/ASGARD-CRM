/**
 * Модалка «+ Добавить рабочего».
 * Источник: vanilla `personnel.js` openAddModal.
 *
 * POST /api/staff/employees — { fio*, phone, birth_date, role_tag, grade, city, notes }
 * Доступ: ADMIN, HR, HR_MANAGER, DIRECTOR_GEN, DIRECTOR_COMM
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, TextInput, PhoneInput, SelectInput, TextareaInput, DatePicker } from '@/inputs/Inputs';
import { phoneError, dateNotFutureError } from '@/inputs/validators';
import { toast } from '@/modals/Notifications';
import { createEmployee } from './api';

// Должность влияет на баллы в табеле (склад 10б vs 12б).
// Слесарь — базовая ставка, мастер — повышенная, РП — руководитель (не попадает в табель).
const SPECIALTIES = [
  'слесарь',
  'мастер',
  'РП',
];

function emitChanged() {
  window.dispatchEvent(new CustomEvent('asgard:personnel:changed'));
}

export function AddEmployeeModal({ onSaved }) {
  const { close } = useModal();
  const [form, setForm] = useState({
    fio: '',
    phone: '',
    birth_date: '',
    role_tag: '',
    grade: '',
    city: '',
    notes: '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // G-4: per-field валидация
  const fieldErrors = {
    phone:      phoneError(form.phone),
    birth_date: dateNotFutureError(form.birth_date, 'Дата рождения')
  };
  const hasFieldErr = Object.values(fieldErrors).some(Boolean);

  const save = async () => {
    if (!form.fio.trim()) {
      toast.warn('ФИО обязательно');
      return;
    }
    if (fieldErrors.phone)      { toast.warn(fieldErrors.phone); return; }
    if (fieldErrors.birth_date) { toast.warn(fieldErrors.birth_date); return; }
    setBusy(true);
    try {
      const payload = {};
      Object.entries(form).forEach(([k, v]) => {
        const s = typeof v === 'string' ? v.trim() : v;
        if (s) payload[k] = s;
      });
      const emp = await createEmployee(payload);
      toast.success(`${form.fio} добавлен`);
      emitChanged();
      onSaved?.(emp);
      close();
    } catch (e) {
      toast.error('Не удалось добавить: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-wide">
      <MHead icon="➕" title="Новый рабочий" subtitle="Базовая анкета — детали можно дополнить позже" accent="gold" onClose={close} />
      <MBody>
        <div className="col gap-12">
          <Field label="ФИО" required>
            <TextInput
              value={form.fio}
              onChange={(v) => set('fio', v)}
              placeholder="Фамилия Имя Отчество"
            />
          </Field>

          <div className="grid-2 gap-10">
            <Field label="Телефон" error={fieldErrors.phone}>
              <PhoneInput value={form.phone} onChange={(v) => set('phone', v)} />
            </Field>
            <Field label="Дата рождения" error={fieldErrors.birth_date}>
              <DatePicker value={form.birth_date} onChange={(v) => set('birth_date', v || '')} />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 1fr', gap: 10 }}>
            <Field label="Должность" hint="Слесарь — базовая ставка (склад 10б). Мастер — повышенная (склад 12б). РП — руководитель.">
              <SelectInput
                value={form.role_tag || 'слесарь'}
                onChange={(v) => set('role_tag', v)}
                options={[
                  { value: 'слесарь', label: '🔧 Слесарь' },
                  { value: 'мастер',  label: '👷 Мастер' },
                  { value: 'РП',      label: '👑 РП (руководитель)' },
                ]}
              />
            </Field>
            <Field label="Разряд">
              <TextInput
                value={form.grade}
                onChange={(v) => set('grade', v)}
                placeholder="3–6"
              />
            </Field>
            <Field label="Город">
              <TextInput
                value={form.city}
                onChange={(v) => set('city', v)}
                placeholder="Москва"
              />
            </Field>
          </div>

          <Field label="Примечание">
            <TextareaInput
              value={form.notes}
              onChange={(v) => set('notes', v)}
              placeholder="Доп. информация…"
              minRows={2}
              maxRows={5}
            />
          </Field>
        </div>
      </MBody>
      <MFoot>
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy || !form.fio.trim() || hasFieldErr} onClick={save}>
          {busy ? 'Сохраняем…' : '✓ Создать'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
