/**
 * Модалка «Редактировать анкету».
 *
 * PUT /api/staff/employees/:id — допустимые поля проверяются на бэке (EMPLOYEE_COLS).
 * Доступ: ADMIN, HR, HR_MANAGER, DIRECTOR_GEN, DIRECTOR_COMM.
 *
 * PII-поля (паспорт, ИНН, СНИЛС, банковские реквизиты) видны только HR/ADMIN/директорам
 * — этот модал уже доступен только им, так что блок «PII» рисуется всегда.
 */
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, TextInput, PhoneInput, SelectInput, TextareaInput, DatePicker, Checkbox } from '@/inputs/Inputs';
import {
  emailError, phoneError, innError, dateNotFutureError, lengthInRange
} from '@/inputs/validators';
import { toast } from '@/modals/Notifications';
import { updateEmployee, searchPayees, createPayee } from './api';

const OFFICIAL_STATUSES = [
  { value: 'active',        label: 'Активен' },
  { value: 'unpaid_leave',  label: 'Отпуск без сохранения' },
  { value: 'maternity',     label: 'Декрет' },
  { value: 'sick_leave',    label: 'Больничный' },
  { value: 'fired',         label: 'Уволен' },
];

const FINANCE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'BUH'];

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

function fmtMoneyFallback(v) {
  if (v == null || v === '') return '0';
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('ru-RU');
}

function labelOfficial(code) {
  const o = OFFICIAL_STATUSES.find((x) => x.value === code);
  return o ? o.label : (code || '—');
}

export function EditEmployeeModal({ employee, onSaved }) {
  const { close } = useModal();
  const { user } = useAuth();
  const canEditFinance = !!(user && FINANCE_ROLES.includes(user.role));
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
    // Самозанятый — финансовая часть (правит ADMIN/DIRECTOR_GEN/BUH)
    can_exceed_limit:  !!e.can_exceed_limit,
    se_yearly_used_initial:  e.se_yearly_used_initial != null ? String(e.se_yearly_used_initial) : '0',
    se_monthly_year:   e.se_monthly_used_initial?.year   != null ? String(e.se_monthly_used_initial.year)   : '',
    se_monthly_month:  e.se_monthly_used_initial?.month  != null ? String(e.se_monthly_used_initial.month)  : '',
    se_monthly_amount: e.se_monthly_used_initial?.amount != null ? String(e.se_monthly_used_initial.amount) : '',
    // Официально устроен — финансовая часть
    official_salary:        e.official_salary != null ? String(e.official_salary) : '',
    official_non_burnable:  e.official_non_burnable != null ? String(e.official_non_burnable) : '',
    official_hire_date:     dateOnly(e.official_hire_date),
    official_status:        e.official_status || 'active',
    official_leave_from:    dateOnly(e.official_leave_from),
    official_leave_to:      dateOnly(e.official_leave_to),
    // V240: получатель НПД-выплат (родственник-СЗ)
    use_payee:              !!e.se_payee_id,
    se_payee_id:            e.se_payee_id || null,
    se_payee_fio:           e.se_payee_fio || '',
    se_payee_phone:         e.se_payee_phone || '',
    se_payee_inn:           e.se_payee_inn || '',
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
    // Взаимоисключение СЗ ↔ Официально
    if (form.is_self_employed && form.is_officially_employed) {
      toast.warn('Нельзя одновременно «Самозанятый» и «Официально устроен»');
      return;
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
      // Финансовые поля (СЗ + Официально) — пишутся только если у юзера есть права
      if (canEditFinance) {
        const yi = Number(form.se_yearly_used_initial || 0);
        payload.se_yearly_used_initial = Number.isFinite(yi) && yi >= 0 ? yi : 0;
        const monY = Number(form.se_monthly_year);
        const monM = Number(form.se_monthly_month);
        const monA = Number(form.se_monthly_amount);
        payload.se_monthly_used_initial =
          (monY && monM && monA && monM >= 1 && monM <= 12 && monA >= 0)
            ? { year: monY, month: monM, amount: monA }
            : null;
        payload.can_exceed_limit = !!form.can_exceed_limit;
        payload.official_salary       = form.official_salary       ? Number(form.official_salary)       : null;
        payload.official_non_burnable = form.official_non_burnable ? Number(form.official_non_burnable) : null;
        payload.official_hire_date    = form.official_hire_date    || null;
        payload.official_status       = form.official_status       || 'active';
        payload.official_leave_from   = form.official_status === 'unpaid_leave' ? (form.official_leave_from || null) : null;
        payload.official_leave_to     = form.official_status === 'unpaid_leave' ? (form.official_leave_to   || null) : null;
        // вспомогательные поля формы — не нужны бэку
        delete payload.se_monthly_year;
        delete payload.se_monthly_month;
        delete payload.se_monthly_amount;
      } else {
        // viewer без прав — финансовые поля не отправляем (чтобы не перетереть null'ами)
        delete payload.se_yearly_used_initial;
        delete payload.se_monthly_year;
        delete payload.se_monthly_month;
        delete payload.se_monthly_amount;
        delete payload.can_exceed_limit;
        delete payload.official_salary;
        delete payload.official_non_burnable;
        delete payload.official_hire_date;
        delete payload.official_status;
        delete payload.official_leave_from;
        delete payload.official_leave_to;
      }
      // V240: получатель НПД-выплат.
      // use_payee=true → выплаты идут на payee, сам рабочий не СЗ.
      // use_payee=false → se_payee_id = null (отвязка).
      // Вспомогательные поля формы не отправляем.
      if (form.use_payee && form.se_payee_id) {
        payload.se_payee_id = Number(form.se_payee_id);
        payload.is_self_employed = false;
      } else {
        payload.se_payee_id = null;
      }
      delete payload.use_payee;
      delete payload.se_payee_fio;
      delete payload.se_payee_phone;
      delete payload.se_payee_inn;

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
              <Field label="Должность" hint="Влияет на баллы за склад (слесарь=10б, мастер=12б). РП — руководитель, не попадает в табель как рабочий.">
                <SelectInput
                  value={['слесарь','мастер','РП'].includes(form.role_tag) ? form.role_tag : (form.role_tag ? '__other__' : 'слесарь')}
                  onChange={(v) => set('role_tag', v === '__other__' ? form.role_tag : v)}
                  options={[
                    { value: 'слесарь', label: '🔧 Слесарь' },
                    { value: 'мастер',  label: '👷 Мастер' },
                    { value: 'РП',      label: '👑 РП (руководитель)' },
                    ...(form.role_tag && !['слесарь','мастер','РП'].includes(form.role_tag)
                      ? [{ value: '__other__', label: `⚠ ${form.role_tag} (нестандарт)` }]
                      : []),
                  ]}
                />
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
            <Field label="Дневная ставка (опц.)">
              <TextInput
                value={form.day_rate}
                onChange={(v) => set('day_rate', v.replace(/[^\d]/g, ''))}
                placeholder="0"
                inputMode="numeric"
              />
            </Field>
          </Section>

          <Section title="💼 Самозанятый">
            <Field
              label="Является самозанятым (плательщик НПД)"
              help={form.is_officially_employed ? 'Снимите «Официально устроен», чтобы включить' : null}
            >
              <Checkbox
                checked={form.is_self_employed}
                onChange={(v) => set('is_self_employed', v)}
                label="Плательщик НПД"
                aria-label="Является самозанятым"
              />
            </Field>
            <Field label="ИНН" help="12 цифр">
              <TextInput
                value={form.inn}
                onChange={(v) => set('inn', v.replace(/\D/g, '').slice(0, 12))}
                placeholder="123456789012"
                inputMode="numeric"
              />
            </Field>

            {/* V240: получатель НПД-выплат (родственник-СЗ) */}
            <div style={{
              borderTop: '1px dashed var(--brd-2)',
              paddingTop: 12,
              marginTop: 4,
            }}>
              <div style={{
                fontSize: 11,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                fontWeight: 700,
                color: 'var(--t-3)',
                marginBottom: 8,
              }}>
                — Получатель НПД-выплат —
              </div>
              <Field
                label="Выплаты идут не на меня"
                help="На родственника-СЗ (жена/брат/отец). У получателя свои НПД-лимиты."
              >
                <Checkbox
                  checked={form.use_payee}
                  onChange={(v) => {
                    set('use_payee', v);
                    if (!v) {
                      // Снятие чекбокса → отвязываем
                      set('se_payee_id', null);
                      set('se_payee_fio', '');
                      set('se_payee_phone', '');
                      set('se_payee_inn', '');
                    }
                  }}
                  label="Выплаты на родственника-СЗ"
                  aria-label="Выплаты идут не на меня"
                />
              </Field>
              {form.use_payee && (
                <PayeeSelector
                  payeeId={form.se_payee_id}
                  payeeFio={form.se_payee_fio}
                  payeePhone={form.se_payee_phone}
                  payeeInn={form.se_payee_inn}
                  canCreate={canEditFinance}
                  onPick={(p) => {
                    set('se_payee_id', p ? Number(p.id) : null);
                    set('se_payee_fio', p?.fio || '');
                    set('se_payee_phone', p?.phone || '');
                    set('se_payee_inn', p?.inn || '');
                  }}
                  onUnlink={() => {
                    set('use_payee', false);
                    set('se_payee_id', null);
                    set('se_payee_fio', '');
                    set('se_payee_phone', '');
                    set('se_payee_inn', '');
                  }}
                />
              )}
            </div>

            {canEditFinance ? (
              <>
                <Field
                  label="Разрешить превышение месячного лимита (350k)"
                  help="При выключенном — переводы свыше 350 000 ₽/мес автоматически блокируются. Годовой лимит 2,4 млн ₽ это не отменяет."
                >
                  <Checkbox
                    checked={form.can_exceed_limit}
                    onChange={(v) => set('can_exceed_limit', v)}
                    label="Снять месячный лимит"
                    aria-label="Разрешить превышение месячного лимита"
                  />
                </Field>
                <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 2, marginBottom: 4 }}>
                  Стартовый offset лимита (для переноса со старой системы):
                </div>
                <Field
                  label="За год уже потрачено ₽"
                  help="Сумма, которая ушла самозанятому ВНЕ CRM с начала года. Например: в апреле перевели 400 000 — ставь 400 000."
                >
                  <TextInput
                    value={form.se_yearly_used_initial}
                    onChange={(v) => set('se_yearly_used_initial', v.replace(/[^\d]/g, ''))}
                    placeholder="0"
                    inputMode="numeric"
                  />
                </Field>
                <Field
                  label="За текущий месяц (опц.)"
                  help="Заполни, только если в этом конкретном месяце уже были переводы вне CRM. Иначе оставь пусто."
                >
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 8 }}>
                    <TextInput
                      value={form.se_monthly_year}
                      onChange={(v) => set('se_monthly_year', v.replace(/[^\d]/g, '').slice(0, 4))}
                      placeholder="год"
                      inputMode="numeric"
                    />
                    <TextInput
                      value={form.se_monthly_month}
                      onChange={(v) => set('se_monthly_month', v.replace(/[^\d]/g, '').slice(0, 2))}
                      placeholder="месяц 1–12"
                      inputMode="numeric"
                    />
                    <TextInput
                      value={form.se_monthly_amount}
                      onChange={(v) => set('se_monthly_amount', v.replace(/[^\d]/g, ''))}
                      placeholder="сумма ₽"
                      inputMode="numeric"
                    />
                  </div>
                </Field>
              </>
            ) : (
              <div className="c-t3" style={{ fontSize: 12, lineHeight: 1.5, padding: 8, border: '1px dashed var(--brd-2)', borderRadius: 6 }}>
                <div><b>Месячный лимит:</b> {e.can_exceed_limit ? 'снят (разрешено превышение)' : 'действует (350 000 ₽)'}</div>
                <div><b>За год уже потрачено:</b> {fmtMoneyFallback(e.se_yearly_used_initial)} ₽</div>
                {e.se_monthly_used_initial && (
                  <div>
                    <b>Месячный offset:</b> {e.se_monthly_used_initial.year}-{String(e.se_monthly_used_initial.month).padStart(2, '0')} → {fmtMoneyFallback(e.se_monthly_used_initial.amount)} ₽
                  </div>
                )}
                <div style={{ marginTop: 4, opacity: 0.7 }}>Изменить может только бухгалтер/директор/админ.</div>
              </div>
            )}
          </Section>

          <Section title="🏢 Официально устроен">
            <Field
              label="Является официально устроенным (по ТД)"
              help={form.is_self_employed ? 'Снимите «Самозанятый», чтобы включить' : null}
            >
              <Checkbox
                checked={form.is_officially_employed}
                onChange={(v) => set('is_officially_employed', v)}
                label="По трудовому договору"
                aria-label="Является официально устроенным"
              />
            </Field>
            {canEditFinance ? (
              <>
                <div className="grid-2 gap-10">
                  <Field label="Оклад ₽" help="Месячный оклад по ТД">
                    <TextInput
                      value={form.official_salary}
                      onChange={(v) => set('official_salary', v.replace(/[^\d]/g, ''))}
                      placeholder="0"
                      inputMode="numeric"
                    />
                  </Field>
                  <Field
                    label="Несгораемая часть ₽"
                    help={
                      <>
                        Минимум который компания платит даже если рабочий не отработал.
                        <br />
                        Пример: оклад 60 000 ₽, несгораемая 30 000 ₽. Если рабочий заработал 0 — компания всё равно платит 30 000 ₽.
                      </>
                    }
                  >
                    <TextInput
                      value={form.official_non_burnable}
                      onChange={(v) => set('official_non_burnable', v.replace(/[^\d]/g, ''))}
                      placeholder="0"
                      inputMode="numeric"
                    />
                  </Field>
                </div>
                <div className="grid-2 gap-10">
                  <Field label="Дата приёма" help="По трудовому договору">
                    <DatePicker
                      value={form.official_hire_date}
                      onChange={(v) => set('official_hire_date', v || '')}
                    />
                  </Field>
                  <Field label="Статус занятости">
                    <SelectInput
                      value={form.official_status}
                      onChange={(v) => set('official_status', v)}
                      options={OFFICIAL_STATUSES}
                    />
                  </Field>
                </div>
                {form.official_status === 'unpaid_leave' && (
                  <div className="grid-2 gap-10">
                    <Field label="Отпуск с" help="Без сохранения заработной платы">
                      <DatePicker
                        value={form.official_leave_from}
                        onChange={(v) => set('official_leave_from', v || '')}
                      />
                    </Field>
                    <Field label="по">
                      <DatePicker
                        value={form.official_leave_to}
                        onChange={(v) => set('official_leave_to', v || '')}
                      />
                    </Field>
                  </div>
                )}
              </>
            ) : (
              <div className="c-t3" style={{ fontSize: 12, lineHeight: 1.5, padding: 8, border: '1px dashed var(--brd-2)', borderRadius: 6 }}>
                <div><b>Оклад:</b> {e.official_salary != null ? fmtMoneyFallback(e.official_salary) + ' ₽' : '—'}</div>
                <div><b>Несгораемая часть:</b> {e.official_non_burnable != null ? fmtMoneyFallback(e.official_non_burnable) + ' ₽' : '—'}</div>
                <div><b>Дата приёма:</b> {e.official_hire_date ? dateOnly(e.official_hire_date) : '—'}</div>
                <div><b>Статус:</b> {labelOfficial(e.official_status)}</div>
                {e.official_status === 'unpaid_leave' && (e.official_leave_from || e.official_leave_to) && (
                  <div><b>Отпуск:</b> {dateOnly(e.official_leave_from) || '—'} — {dateOnly(e.official_leave_to) || '—'}</div>
                )}
                <div style={{ marginTop: 4, opacity: 0.7 }}>Изменить может только бухгалтер/директор/админ.</div>
              </div>
            )}
          </Section>

          <Section title="ПII (паспорт, СНИЛС)" warn>
            <div className="grid-2 gap-10">
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

/* ═══════════════════════════════════════════════════════════════════════
 * PayeeSelector (V240) — поиск/создание родственника-получателя НПД-выплат.
 *   - Поиск debounced 300мс по /api/staff/payees?search=Q
 *   - Если payeeId задан — показываем «карточку» с ФИО + кнопками Открепить/Открыть
 *   - Поиск дополнительный (можно сменить выбранного payee)
 *   - «+ Создать» — мини-форма (ФИО/телефон/ИНН) → POST /api/staff/payees
 *   - canCreate=false (не FIN_ROLES) → кнопка скрыта
 * ═══════════════════════════════════════════════════════════════════════ */
function PayeeSelector({ payeeId, payeeFio, payeePhone, payeeInn, canCreate, onPick, onUnlink }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newForm, setNewForm] = useState({ fio: '', phone: '', inn: '' });
  const [savingNew, setSavingNew] = useState(false);
  const wrapRef = useRef(null);

  // Debounce поиск
  useEffect(() => {
    if (!q || q.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const items = await searchPayees(q.trim(), 20);
        if (!cancelled) {
          setResults(items || []);
          setOpen(true);
        }
      } catch (_) {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  // Клик вне → закрыть выпадайку
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const handlePick = (p) => {
    onPick?.(p);
    setQ('');
    setResults([]);
    setOpen(false);
  };

  const openCardHash = () => {
    if (!payeeId) return;
    location.hash = '#/employee?id=' + Number(payeeId);
  };

  const submitCreate = async () => {
    const fio = (newForm.fio || '').trim();
    if (!fio) { toast.warn('ФИО обязательно'); return; }
    setSavingNew(true);
    try {
      const created = await createPayee({
        fio,
        phone: (newForm.phone || '').trim() || null,
        inn:   (newForm.inn || '').trim() || null,
      });
      if (!created || !created.id) {
        toast.error('Сервер не вернул id получателя');
      } else {
        onPick?.({
          id: created.id,
          fio: created.fio || fio,
          phone: created.phone || newForm.phone || '',
          inn: created.inn || newForm.inn || '',
        });
        toast.success('Получатель создан');
        setCreating(false);
        setNewForm({ fio: '', phone: '', inn: '' });
      }
    } catch (err) {
      toast.error('Не удалось создать: ' + (err?.message || err));
    } finally {
      setSavingNew(false);
    }
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', marginTop: 8 }}>
      {/* Текущий payee — мягкая зелёная плашка */}
      {payeeId && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 12px',
          background: '#E8F5E9',
          color: '#1b5e20',
          borderRadius: 8,
          marginBottom: 10,
          flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 18 }} aria-hidden="true">👤</span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 600 }}>{payeeFio || ('id=' + payeeId)}</div>
            <div style={{ fontSize: 11, opacity: 0.75 }}>
              {['id=' + payeeId, payeePhone, payeeInn ? 'ИНН ' + payeeInn : null]
                .filter(Boolean).join(' · ')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Btn size="sm" onClick={onUnlink}>Открепить</Btn>
            <Btn size="sm" onClick={openCardHash}>Открыть карточку</Btn>
          </div>
        </div>
      )}

      {/* Поиск (всегда видимый, чтобы можно было сменить выбранного) */}
      <div style={{ position: 'relative' }}>
        <TextInput
          value={q}
          onChange={setQ}
          placeholder={payeeId ? 'Сменить получателя…' : 'Поиск по ФИО или телефону…'}
          aria-label="Поиск получателя НПД"
        />
        {open && (
          <div style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            background: 'var(--bg-1)',
            border: '1px solid var(--brd-2)',
            borderRadius: 8,
            marginTop: 4,
            maxHeight: 280,
            overflowY: 'auto',
            zIndex: 10,
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          }}>
            {loading && (
              <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--t-3)' }}>Ищем…</div>
            )}
            {!loading && results.length === 0 && (
              <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--t-3)' }}>
                Никого не нашли. {canCreate ? 'Попробуйте создать нового.' : ''}
              </div>
            )}
            {!loading && results.map((p) => (
              <div
                key={p.id}
                onClick={() => handlePick(p)}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--brd-2)',
                  fontSize: 13,
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-2)'}
                onMouseLeave={(e) => e.currentTarget.style.background = ''}
              >
                <div style={{ fontWeight: 600 }}>
                  {p.fio || '—'}
                  {p.linked_count != null && (
                    <span style={{ fontSize: 11, color: 'var(--t-3)', marginLeft: 6 }}>
                      (привязано: {p.linked_count})
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--t-3)' }}>
                  id={p.id}
                  {p.phone ? ' · ' + p.phone : ''}
                  {p.inn ? ' · ИНН ' + p.inn : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Кнопка создания — только FIN_ROLES */}
      {canCreate && !creating && (
        <div style={{ marginTop: 8 }}>
          <Btn size="sm" onClick={() => setCreating(true)}>+ Создать нового получателя</Btn>
        </div>
      )}

      {/* Мини-форма создания */}
      {creating && (
        <div style={{
          marginTop: 10,
          padding: 12,
          border: '1px dashed var(--brd-2)',
          borderRadius: 8,
          background: 'var(--bg-2)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t-3)', marginBottom: 8, textTransform: 'uppercase' }}>
            + Новый получатель НПД
          </div>
          <div className="col gap-10">
            <Field label="ФИО" required>
              <TextInput
                value={newForm.fio}
                onChange={(v) => setNewForm((f) => ({ ...f, fio: v }))}
                placeholder="Иванов Иван Иванович"
              />
            </Field>
            <Field label="Телефон">
              <PhoneInput
                value={newForm.phone}
                onChange={(v) => setNewForm((f) => ({ ...f, phone: v }))}
              />
            </Field>
            <Field label="ИНН (опц.)" help="12 цифр">
              <TextInput
                value={newForm.inn}
                onChange={(v) => setNewForm((f) => ({ ...f, inn: v.replace(/\D/g, '').slice(0, 12) }))}
                placeholder="123456789012"
                inputMode="numeric"
              />
            </Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <Btn size="sm" onClick={() => { setCreating(false); setNewForm({ fio: '', phone: '', inn: '' }); }}>
                Отмена
              </Btn>
              <Btn size="sm" variant="primary" disabled={savingNew || !newForm.fio.trim()} onClick={submitCreate}>
                {savingNew ? 'Создаём…' : 'Создать'}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
