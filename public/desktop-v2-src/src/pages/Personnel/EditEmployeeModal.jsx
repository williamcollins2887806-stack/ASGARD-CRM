/**
 * Модалка «Редактировать анкету».
 *
 * PUT /api/staff/employees/:id — допустимые поля проверяются на бэке (EMPLOYEE_COLS).
 * Доступ: ADMIN, HR, HR_MANAGER, DIRECTOR_GEN, DIRECTOR_COMM.
 *
 * PII-поля (паспорт, ИНН, СНИЛС, банковские реквизиты) видны только HR/ADMIN/директорам
 * — этот модал уже доступен только им, так что блок «PII» рисуется всегда.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, TextInput, PhoneInput, SelectInput, TextareaInput, DatePicker, Checkbox } from '@/inputs/Inputs';
import {
  emailError, phoneError, innError, dateNotFutureError, lengthInRange
} from '@/inputs/validators';
import { toast } from '@/modals/Notifications';
import { updateEmployee } from './api';

const GENDERS = [
  { value: '',  label: '— не указано —' },
  { value: 'M', label: 'Мужской' },
  { value: 'F', label: 'Женский' },
];
const CONTRACT_TYPES = [
  { value: '', label: '— не указано —' },
  { value: 'official', label: 'Трудовой договор' },
  { value: 'self_employed', label: 'Самозанятость' },
  { value: 'gph', label: 'ГПХ' },
  { value: 'unofficial', label: 'Без оформления' },
];

function emitChanged() {
  window.dispatchEvent(new CustomEvent('asgard:personnel:changed'));
}

function dateOnly(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  return '';
}

export function EditEmployeeModal({ employee, onSaved }) {
  const { close } = useModal();
  const e = employee || {};

  const [form, setForm] = useState({
    fio:               e.fio || '',
    phone:             e.phone || '',
    email:             e.email || '',
    birth_date:        dateOnly(e.birth_date),
    gender:            e.gender || '',
    role_tag:          e.role_tag || '',
    position:          e.position || '',
    grade:             e.grade || '',
    city:              e.city || '',
    address:           e.address || '',
    hire_date:         dateOnly(e.hire_date),
    contract_type:     e.contract_type || '',
    is_self_employed:  !!e.is_self_employed,
    is_officially_employed: !!e.is_officially_employed,
    // PII (HR/ADMIN)
    inn:               e.inn || '',
    snils:             e.snils || '',
    passport_series:   e.passport_series || e.pass_series || '',
    passport_number:   e.passport_number || e.pass_number || '',
    passport_issued:   e.passport_issued || '',
    passport_date:     dateOnly(e.passport_date),
    registration_address: e.registration_address || '',
    bank_name:         e.bank_name || '',
    bik:               e.bik || '',
    account_number:    e.account_number || '',
    card_number:       e.card_number || '',
    // прочее
    salary:            e.salary != null ? String(e.salary) : '',
    day_rate:          e.day_rate != null ? String(e.day_rate) : '',
    notes:             e.notes || '',
    comment:           e.comment || '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // G-4: per-field валидация
  const fieldErrors = {
    fio:        lengthInRange(form.fio, null, 255),
    email:      emailError(form.email),
    phone:      phoneError(form.phone),
    inn:        innError(form.inn),
    birth_date: dateNotFutureError(form.birth_date, 'Дата рождения'),
    hire_date:  dateNotFutureError(form.hire_date, 'Дата приёма'),
    bik:        form.bik && form.bik.length !== 9 ? 'БИК — 9 цифр' : null,
    passport_series: form.passport_series && form.passport_series.length !== 4 ? 'Серия — 4 цифры' : null,
    passport_number: form.passport_number && form.passport_number.length !== 6 ? 'Номер — 6 цифр' : null,
    account_number: form.account_number && form.account_number.length !== 20 ? 'Счёт — 20 цифр' : null,
    salary:     form.salary && Number(form.salary) < 0 ? 'Оклад ≥ 0' : null,
    day_rate:   form.day_rate && Number(form.day_rate) < 0 ? 'Ставка ≥ 0' : null
  };
  const hasFieldErr = Object.values(fieldErrors).some(Boolean);

  const save = async () => {
    if (!form.fio.trim()) {
      toast.warn('ФИО обязательно');
      return;
    }
    for (const k of Object.keys(fieldErrors)) {
      if (fieldErrors[k]) { toast.warn(fieldErrors[k]); return; }
    }
    setBusy(true);
    try {
      const payload = {};
      Object.entries(form).forEach(([k, v]) => {
        if (typeof v === 'string') {
          const s = v.trim();
          payload[k] = s || null;
        } else {
          payload[k] = v;
        }
      });
      // Пустые числа в null
      ['salary', 'day_rate'].forEach((k) => {
        if (payload[k] === '' || payload[k] === null) payload[k] = null;
        else payload[k] = Number(payload[k]);
      });
      await updateEmployee(employee.id, payload);
      toast.success('Анкета сохранена');
      emitChanged();
      onSaved?.();
      close();
    } catch (err) {
      toast.error('Не удалось сохранить: ' + (err?.message || err));
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-wide">
      <MHead
        icon="✎"
        title="Редактировать анкету"
        subtitle={form.fio || '—'}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="col gap-18">
          <Section title="Основное">
            <div className="grid-2-1-1 gap-10">
              <Field label="ФИО" required error={fieldErrors.fio}>
                <TextInput value={form.fio} onChange={(v) => set('fio', v)} />
              </Field>
              <Field label="Дата рождения" error={fieldErrors.birth_date}>
                <DatePicker value={form.birth_date} onChange={(v) => set('birth_date', v || '')} />
              </Field>
              <Field label="Пол">
                <SelectInput value={form.gender} onChange={(v) => set('gender', v)} options={GENDERS} />
              </Field>
            </div>
            <div className="grid-2 gap-10">
              <Field label="Телефон" error={fieldErrors.phone}>
                <PhoneInput value={form.phone} onChange={(v) => set('phone', v)} />
              </Field>
              <Field label="Email" error={fieldErrors.email}>
                <TextInput type="email" value={form.email} onChange={(v) => set('email', v)} placeholder="user@example.ru" />
              </Field>
            </div>
            <div className="grid-2 gap-10">
              <Field label="Город">
                <TextInput value={form.city} onChange={(v) => set('city', v)} placeholder="Москва" />
              </Field>
              <Field label="Адрес проживания">
                <TextInput value={form.address} onChange={(v) => set('address', v)} />
              </Field>
            </div>
          </Section>

          <Section title="Работа">
            <div className="grid-2-1-1 gap-10">
              <Field label="Специальность (role_tag)">
                <TextInput value={form.role_tag} onChange={(v) => set('role_tag', v)} placeholder="Сварщик" />
              </Field>
              <Field label="Должность (position)">
                <TextInput value={form.position} onChange={(v) => set('position', v)} placeholder="welder" />
              </Field>
              <Field label="Разряд">
                <TextInput value={form.grade} onChange={(v) => set('grade', v)} placeholder="3–6" />
              </Field>
            </div>
            <div className="grid-3 gap-10">
              <Field label="Дата приёма">
                <DatePicker value={form.hire_date} onChange={(v) => set('hire_date', v || '')} />
              </Field>
              <Field label="Тип договора">
                <SelectInput value={form.contract_type} onChange={(v) => set('contract_type', v)} options={CONTRACT_TYPES} />
              </Field>
              <Field label="Оклад ₽">
                <TextInput
                  value={form.salary}
                  onChange={(v) => set('salary', v.replace(/[^\d]/g, ''))}
                  placeholder="0"
                  inputMode="numeric"
                />
              </Field>
            </div>
            <div className="u-flex gap-16">
              <Checkbox
                checked={form.is_self_employed}
                onChange={(v) => set('is_self_employed', v)}
                label="Самозанятый"
              />
              <Checkbox
                checked={form.is_officially_employed}
                onChange={(v) => set('is_officially_employed', v)}
                label="Официально трудоустроен"
              />
            </div>
            <Field label="Дневная ставка (опц.)">
              <TextInput
                value={form.day_rate}
                onChange={(v) => set('day_rate', v.replace(/[^\d]/g, ''))}
                placeholder="0"
                inputMode="numeric"
              />
            </Field>
          </Section>

          <Section title="ПII (паспорт, ИНН, СНИЛС)" warn>
            <div className="grid-2 gap-10">
              <Field label="ИНН">
                <TextInput
                  value={form.inn}
                  onChange={(v) => set('inn', v.replace(/\D/g, '').slice(0, 12))}
                  placeholder="10 или 12 цифр"
                  inputMode="numeric"
                />
              </Field>
              <Field label="СНИЛС">
                <TextInput
                  value={form.snils}
                  onChange={(v) => set('snils', v)}
                  placeholder="000-000-000 00"
                />
              </Field>
            </div>
            <div className="grid-3 gap-10">
              <Field label="Паспорт: серия">
                <TextInput
                  value={form.passport_series}
                  onChange={(v) => set('passport_series', v.replace(/\D/g, '').slice(0, 4))}
                  placeholder="0000"
                />
              </Field>
              <Field label="Паспорт: номер">
                <TextInput
                  value={form.passport_number}
                  onChange={(v) => set('passport_number', v.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                />
              </Field>
              <Field label="Дата выдачи">
                <DatePicker value={form.passport_date} onChange={(v) => set('passport_date', v || '')} />
              </Field>
            </div>
            <Field label="Кем выдан">
              <TextInput value={form.passport_issued} onChange={(v) => set('passport_issued', v)} />
            </Field>
            <Field label="Адрес регистрации">
              <TextInput value={form.registration_address} onChange={(v) => set('registration_address', v)} />
            </Field>
          </Section>

          <Section title="Банк (для самозанятых / по ТД)" warn>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
              <Field label="Банк">
                <TextInput value={form.bank_name} onChange={(v) => set('bank_name', v)} placeholder="ПАО Сбербанк" />
              </Field>
              <Field label="БИК">
                <TextInput
                  value={form.bik}
                  onChange={(v) => set('bik', v.replace(/\D/g, '').slice(0, 9))}
                  placeholder="9 цифр"
                />
              </Field>
            </div>
            <div className="grid-2 gap-10">
              <Field label="Расчётный счёт">
                <TextInput
                  value={form.account_number}
                  onChange={(v) => set('account_number', v.replace(/\D/g, '').slice(0, 20))}
                  placeholder="20 цифр"
                />
              </Field>
              <Field label="Карта">
                <TextInput
                  value={form.card_number}
                  onChange={(v) => set('card_number', v.replace(/\D/g, '').slice(0, 19))}
                  placeholder="16 цифр"
                />
              </Field>
            </div>
          </Section>

          <Section title="Заметки">
            <Field label="Примечание">
              <TextareaInput value={form.notes} onChange={(v) => set('notes', v)} minRows={2} maxRows={5} />
            </Field>
            <Field label="Комментарий HR">
              <TextareaInput value={form.comment} onChange={(v) => set('comment', v)} minRows={2} maxRows={5} />
            </Field>
          </Section>
        </div>
      </MBody>
      <MFoot>
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy || !form.fio.trim()} onClick={save}>
          {busy ? 'Сохраняем…' : '💾 Сохранить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

function Section({ title, warn, children }) {
  return (
    <div>
      <div style={{
        fontSize: 11,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        fontWeight: 800,
        color: warn ? 'var(--amber)' : 'var(--t-3)',
        marginBottom: 10,
        paddingBottom: 6,
        borderBottom: '1px solid var(--brd-2)',
      }}>
        {warn ? '🔒 ' : ''}{title}
      </div>
      <div className="col gap-10">
        {children}
      </div>
    </div>
  );
}
