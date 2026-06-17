/**
 * Доп. поля анкеты: экстренные контакты + образование + медицина + одежда.
 *
 * Источник: vanilla `employee.js` блоки:
 *   • «Экстренные контакты»  (строки 269–294)
 *   • «Дополнительно»        (строки 296–337) — образование/спец/семья/одежда/мед
 *
 * Endpoint: PUT /api/staff/employees/:id
 *
 * 16.06.2026: миграция V217 добавила 15 колонок в `employees`, EMPLOYEE_COLS
 * allowlist (staff.js:8) расширен — все поля сохраняются.
 */
import { useEffect, useState } from 'react';
import { Btn, Field } from '@/modals/parts';
import { TextInput, PhoneInput, TextareaInput, SelectInput, NumberInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { updateEmployee } from './api';

const MARITAL_OPTIONS = [
  { value: '', label: '— не указано —' },
  { value: 'single',  label: 'Не женат/не замужем' },
  { value: 'married', label: 'Женат/замужем' },
  { value: 'divorced', label: 'Разведён(а)' },
];

const BLOOD_OPTIONS = [
  { value: '',   label: '— не указано —' },
  { value: 'O+', label: 'O(I)+' },
  { value: 'O-', label: 'O(I)−' },
  { value: 'A+', label: 'A(II)+' },
  { value: 'A-', label: 'A(II)−' },
  { value: 'B+', label: 'B(III)+' },
  { value: 'B-', label: 'B(III)−' },
  { value: 'AB+', label: 'AB(IV)+' },
  { value: 'AB-', label: 'AB(IV)−' },
];

export function EmployeeExtraFields({ employee, canEdit, onSaved }) {
  const e = employee || {};
  const [form, setForm] = useState(() => buildInitial(e));
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setForm(buildInitial(e));
    setDirty(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.id, e.updated_at]);

  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      const payload = {};
      Object.entries(form).forEach(([k, v]) => {
        if (typeof v === 'string') payload[k] = v.trim() || null;
        else payload[k] = v ?? null;
      });
      await updateEmployee(employee.id, payload);
      toast.success('Анкета сохранена');
      setDirty(false);
      onSaved?.();
    } catch (err) {
      toast.error('Ошибка: ' + (err?.serverMsg || err?.message || err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="emp-extra">
      <SubSection title="🆘 Экстренные контакты">
        <div className="grid-2 gap-10">
          <Field label="ФИО супруга(и)">
            <TextInput value={form.spouse_name} onChange={(v) => set('spouse_name', v)} disabled={!canEdit} />
          </Field>
          <Field label="Телефон супруга(и)">
            <PhoneInput value={form.spouse_phone} onChange={(v) => set('spouse_phone', v)} disabled={!canEdit} />
          </Field>
          <Field label="ФИО родственника">
            <TextInput value={form.relative_name} onChange={(v) => set('relative_name', v)} disabled={!canEdit} />
          </Field>
          <Field label="Кем приходится">
            <TextInput value={form.relative_relation} onChange={(v) => set('relative_relation', v)} disabled={!canEdit} placeholder="мать/отец/брат…" />
          </Field>
          <Field label="Телефон родственника">
            <PhoneInput value={form.relative_phone} onChange={(v) => set('relative_phone', v)} disabled={!canEdit} />
          </Field>
          <Field label="Доп. телефон">
            <PhoneInput value={form.phone2} onChange={(v) => set('phone2', v)} disabled={!canEdit} />
          </Field>
          <Field label="Telegram">
            <TextInput value={form.telegram} onChange={(v) => set('telegram', v)} disabled={!canEdit} placeholder="@username" />
          </Field>
        </div>
      </SubSection>

      <SubSection title="🎓 Образование и семья">
        <div className="grid-2 gap-10">
          <Field label="Образование">
            <TextInput value={form.education} onChange={(v) => set('education', v)} disabled={!canEdit} placeholder="Среднее / Высшее / …" />
          </Field>
          <Field label="Специальность по диплому">
            <TextInput value={form.specialty} onChange={(v) => set('specialty', v)} disabled={!canEdit} />
          </Field>
          <Field label="Семейное положение">
            <SelectInput
              value={form.marital_status}
              onChange={(v) => set('marital_status', v)}
              options={MARITAL_OPTIONS}
              disabled={!canEdit}
            />
          </Field>
          <Field label="Количество детей">
            <NumberInput
              value={form.children_count}
              onChange={(v) => set('children_count', v)}
              min={0}
              disabled={!canEdit}
            />
          </Field>
        </div>
      </SubSection>

      <SubSection title="🏥 Медицина">
        <div className="grid-2 gap-10">
          <Field label="Группа крови">
            <SelectInput
              value={form.blood_type}
              onChange={(v) => set('blood_type', v)}
              options={BLOOD_OPTIONS}
              disabled={!canEdit}
            />
          </Field>
          <Field label="Рост (см)">
            <NumberInput
              value={form.height}
              onChange={(v) => set('height', v)}
              min={0}
              max={250}
              disabled={!canEdit}
            />
          </Field>
        </div>
        <Field label="Аллергии / мед. ограничения">
          <TextareaInput
            value={form.medical_notes}
            onChange={(v) => set('medical_notes', v)}
            minRows={2}
            maxRows={4}
            disabled={!canEdit}
          />
        </Field>
      </SubSection>

      <SubSection title="👕 Одежда">
        <div className="grid-2 gap-10">
          <Field label="Размер одежды">
            <TextInput value={form.clothing_size} onChange={(v) => set('clothing_size', v)} disabled={!canEdit} placeholder="48-50" />
          </Field>
          <Field label="Размер обуви">
            <TextInput value={form.shoe_size} onChange={(v) => set('shoe_size', v)} disabled={!canEdit} placeholder="43" />
          </Field>
        </div>
      </SubSection>

      {canEdit && (
        <div className="emp-docs-foot">
          <Btn
            variant="primary"
            size="sm"
            disabled={!dirty || busy}
            onClick={save}
          >
            {busy ? 'Сохраняем…' : '💾 Сохранить анкету'}
          </Btn>
        </div>
      )}
    </div>
  );
}

function buildInitial(e) {
  return {
    phone2:             e.phone2 || '',
    telegram:           e.telegram || '',
    spouse_name:        e.spouse_name || '',
    spouse_phone:       e.spouse_phone || '',
    relative_name:      e.relative_name || '',
    relative_relation:  e.relative_relation || '',
    relative_phone:     e.relative_phone || '',
    education:          e.education || '',
    specialty:          e.specialty || '',
    marital_status:     e.marital_status || '',
    children_count:     e.children_count ?? '',
    clothing_size:      e.clothing_size || '',
    shoe_size:          e.shoe_size || '',
    height:             e.height ?? '',
    blood_type:         e.blood_type || '',
    medical_notes:      e.medical_notes || '',
  };
}

function SubSection({ title, children }) {
  return (
    <div className="emp-extra-sub">
      <div className="emp-extra-sub-title">{title}</div>
      <div className="col gap-10">{children}</div>
    </div>
  );
}
