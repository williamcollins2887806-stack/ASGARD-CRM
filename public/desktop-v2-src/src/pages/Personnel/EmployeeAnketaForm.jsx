/**
 * Секции анкеты рабочего (edit-in-place).
 * Использует единый form state из employeeFormState.js
 */
import { Field } from '@/modals/parts';
import {
  TextInput, PhoneInput, SnilsInput, PassportCodeInput,
  SelectInput, TextareaInput, DatePicker, Checkbox, NumberInput,
} from '@/inputs/Inputs';
import { formatMoney as fmtMoneyFallback } from '@/lib/money';
import {
  ROLE_TAGS, GENDERS, CONTRACT_TYPES, OFFICIAL_STATUSES,
  MARITAL_OPTIONS, BLOOD_OPTIONS,
} from './employeeFormState';
import { ppeSizeSelectOptions } from '@/lib/ppeSizes';
import { PayeeSelector } from './PayeeSelector';
import { getPassportAgeValidity, passportStatusClass } from '@/lib/passportValidity';
import { birthAgeHelp } from '@/lib/birthDate';

function dateOnly(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  return '';
}

function labelOfficial(code) {
  return OFFICIAL_STATUSES.find((x) => x.value === code)?.label || code || '—';
}

function FormSection({ title, warn, children }) {
  return (
    <div className="emp-form-section">
      <div className={'emp-form-section-title' + (warn ? ' emp-form-section-title--warn' : '')}>
        {warn ? '🔒 ' : ''}{title}
      </div>
      <div className="col gap-10">{children}</div>
    </div>
  );
}

export function EmployeeAnketaForm({
  form,
  set,
  fieldErrors = {},
  canEdit,
  canEditFinance,
  employee,
  section, // contacts | documents | ppe | work | notes | null=all editable anketa parts
}) {
  const e = employee || {};
  const disabled = !canEdit;
  const show = (id) => !section || section === id;

  const roleSelectValue = ROLE_TAGS.includes(form.role_tag)
    ? form.role_tag
    : (form.role_tag ? '__other__' : 'слесарь');

  return (
    <div className="emp-anketa col gap-18">
      {show('contacts') && (
        <>
          <FormSection title="Основное">
            <div className="grid-2-1-1 gap-10">
              <Field label="ФИО" required error={fieldErrors.fio}>
                <TextInput value={form.fio} onChange={(v) => set('fio', v)} disabled={disabled} />
              </Field>
              <Field
                label="Дата рождения"
                error={fieldErrors.birth_date}
                help={fieldErrors.birth_date ? null : birthAgeHelp(form.birth_date)}
              >
                <DatePicker value={form.birth_date} onChange={(v) => set('birth_date', v || '')} disabled={disabled} />
              </Field>
              <Field label="Пол">
                <SelectInput value={form.gender} onChange={(v) => set('gender', v)} options={GENDERS} disabled={disabled} />
              </Field>
            </div>
            <div className="grid-2 gap-10">
              <Field label="Телефон" error={fieldErrors.phone}>
                <PhoneInput value={form.phone} onChange={(v) => set('phone', v)} disabled={disabled} />
              </Field>
              <Field label="Email" error={fieldErrors.email}>
                <TextInput type="email" value={form.email} onChange={(v) => set('email', v)} placeholder="user@example.ru" disabled={disabled} />
              </Field>
            </div>
            <div className="grid-2 gap-10">
              <Field label="Город">
                <TextInput value={form.city} onChange={(v) => set('city', v)} disabled={disabled} />
              </Field>
              <Field label="Адрес проживания">
                <TextInput value={form.address} onChange={(v) => set('address', v)} disabled={disabled} />
              </Field>
            </div>
            <Field label="Адрес регистрации">
              <TextInput value={form.registration_address} onChange={(v) => set('registration_address', v)} disabled={disabled} />
            </Field>
          </FormSection>

          <FormSection title="Экстренные контакты">
            <div className="grid-2 gap-10">
              <Field label="ФИО супруга(и)">
                <TextInput value={form.spouse_name} onChange={(v) => set('spouse_name', v)} disabled={disabled} />
              </Field>
              <Field label="Телефон супруга(и)" error={fieldErrors.spouse_phone}>
                <PhoneInput value={form.spouse_phone} onChange={(v) => set('spouse_phone', v)} disabled={disabled} />
              </Field>
              <Field label="ФИО родственника">
                <TextInput value={form.relative_name} onChange={(v) => set('relative_name', v)} disabled={disabled} />
              </Field>
              <Field label="Кем приходится">
                <TextInput value={form.relative_relation} onChange={(v) => set('relative_relation', v)} disabled={disabled} placeholder="мать/отец/брат…" />
              </Field>
              <Field label="Телефон родственника" error={fieldErrors.relative_phone}>
                <PhoneInput value={form.relative_phone} onChange={(v) => set('relative_phone', v)} disabled={disabled} />
              </Field>
              <Field label="Доп. телефон" error={fieldErrors.phone2}>
                <PhoneInput value={form.phone2} onChange={(v) => set('phone2', v)} disabled={disabled} />
              </Field>
              <Field label="Telegram">
                <TextInput value={form.telegram} onChange={(v) => set('telegram', v)} disabled={disabled} placeholder="@username" />
              </Field>
            </div>
          </FormSection>

          <FormSection title="Образование и семья">
            <div className="grid-2 gap-10">
              <Field label="Образование">
                <TextInput value={form.education} onChange={(v) => set('education', v)} disabled={disabled} />
              </Field>
              <Field label="Специальность по диплому">
                <TextInput value={form.specialty} onChange={(v) => set('specialty', v)} disabled={disabled} />
              </Field>
              <Field label="Семейное положение">
                <SelectInput value={form.marital_status} onChange={(v) => set('marital_status', v)} options={MARITAL_OPTIONS} disabled={disabled} />
              </Field>
              <Field label="Количество детей">
                <NumberInput value={form.children_count} onChange={(v) => set('children_count', v)} min={0} disabled={disabled} />
              </Field>
            </div>
          </FormSection>
        </>
      )}

      {show('documents') && (
        <FormSection title="Документы" warn>
          {(() => {
            const pv = getPassportAgeValidity(form.birth_date, form.passport_date);
            return (
              <div className={`emp-pass-banner ${passportStatusClass(pv.status)}`}>
                <strong>{pv.label}</strong>
                <span>{pv.hint}</span>
                <span className="emp-pass-banner-note">В РФ паспорт меняют в 20 и 45 лет (+90 дней после дня рождения).</span>
              </div>
            );
          })()}
          <div className="grid-2 gap-10">
            <Field label="СНИЛС" error={fieldErrors.snils}>
              <SnilsInput value={form.snils} onChange={(v) => set('snils', v)} disabled={disabled} />
            </Field>
            <Field label="ИНН" error={fieldErrors.inn} help="10 или 12 цифр">
              <TextInput
                value={form.inn}
                onChange={(v) => set('inn', String(v).replace(/\D/g, '').slice(0, 12))}
                placeholder="123456789012"
                inputMode="numeric"
                disabled={disabled}
              />
            </Field>
          </div>
          <div className="grid-3 gap-10">
            <Field label="Паспорт: серия" error={fieldErrors.passport_series}>
              <TextInput
                value={form.passport_series}
                onChange={(v) => set('passport_series', String(v).replace(/\D/g, '').slice(0, 4))}
                placeholder="0000"
                disabled={disabled}
              />
            </Field>
            <Field label="Паспорт: номер" error={fieldErrors.passport_number}>
              <TextInput
                value={form.passport_number}
                onChange={(v) => set('passport_number', String(v).replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                disabled={disabled}
              />
            </Field>
            <Field label="Дата выдачи">
              <DatePicker value={form.passport_date} onChange={(v) => set('passport_date', v || '')} disabled={disabled} />
            </Field>
          </div>
          <Field label="Кем выдан">
            <TextInput value={form.passport_issued} onChange={(v) => set('passport_issued', v)} disabled={disabled} />
          </Field>
          <Field label="Код подразделения" error={fieldErrors.passport_code}>
            <PassportCodeInput value={form.passport_code} onChange={(v) => set('passport_code', v)} disabled={disabled} />
          </Field>
          <div className="grid-2 gap-10">
            <Field label="Военный билет">
              <TextInput value={form.military_id} onChange={(v) => set('military_id', v)} disabled={disabled} placeholder="№, категория" />
            </Field>
            <Field label="Водительское удостоверение">
              <TextInput value={form.driver_license} onChange={(v) => set('driver_license', v)} disabled={disabled} placeholder="Категории, срок" />
            </Field>
          </div>
          <Field label="Ссылка на папку документов">
            <TextInput value={form.docs_url} onChange={(v) => set('docs_url', v)} disabled={disabled} placeholder="https://…" />
          </Field>
          {form.docs_url && (
            <a className="m-btn ghost" href={form.docs_url} target="_blank" rel="noreferrer">Открыть папку документов</a>
          )}
          <div className="grid-2 gap-10">
            <Field label="НАКС">
              <TextInput value={form.naks} onChange={(v) => set('naks', v)} disabled={disabled} />
            </Field>
            <Field label="НАКС до">
              <DatePicker value={form.naks_expiry} onChange={(v) => set('naks_expiry', v || '')} disabled={disabled} />
            </Field>
            <Field label="Удостоверение ИТР">
              <TextInput value={form.imt_number} onChange={(v) => set('imt_number', v)} disabled={disabled} />
            </Field>
            <Field label="ИТР до">
              <DatePicker value={form.imt_expires} onChange={(v) => set('imt_expires', v || '')} disabled={disabled} />
            </Field>
          </div>
        </FormSection>
      )}

      {show('ppe') && (
        <>
          <FormSection title="СИЗ — размеры">
            <div className="grid-2 gap-10">
              <Field label="Размер одежды">
                <SelectInput
                  value={form.clothing_size}
                  onChange={(v) => set('clothing_size', v)}
                  options={ppeSizeSelectOptions('clothing_size', form.clothing_size)}
                  disabled={disabled}
                />
              </Field>
              <Field label="Размер обуви">
                <SelectInput
                  value={form.shoe_size}
                  onChange={(v) => set('shoe_size', v)}
                  options={ppeSizeSelectOptions('shoe_size', form.shoe_size)}
                  disabled={disabled}
                />
              </Field>
              <Field label="Головной убор (каска)">
                <SelectInput
                  value={form.headwear_size}
                  onChange={(v) => set('headwear_size', v)}
                  options={ppeSizeSelectOptions('headwear_size', form.headwear_size)}
                  disabled={disabled}
                />
              </Field>
            </div>
          </FormSection>
          <FormSection title="Медицина">
            <div className="grid-2 gap-10">
              <Field label="Группа крови">
                <SelectInput value={form.blood_type} onChange={(v) => set('blood_type', v)} options={BLOOD_OPTIONS} disabled={disabled} />
              </Field>
              <Field label="Рост (см)">
                <NumberInput value={form.height} onChange={(v) => set('height', v)} min={0} max={250} disabled={disabled} />
              </Field>
            </div>
            <Field label="Аллергии / мед. ограничения">
              <TextareaInput value={form.medical_notes} onChange={(v) => set('medical_notes', v)} minRows={2} maxRows={4} disabled={disabled} />
            </Field>
          </FormSection>
        </>
      )}

      {show('work') && (
        <>
          <FormSection title="Работа">
            <div className="grid-2-1-1 gap-10">
              <Field label="Специальность" hint="Слесарь=10б, мастер=12б. РП — не в табеле как рабочий.">
                <SelectInput
                  value={roleSelectValue}
                  onChange={(v) => {
                    if (v === '__other__') return;
                    set('role_tag', v);
                  }}
                  options={[
                    { value: 'слесарь', label: 'Слесарь' },
                    { value: 'сварщик', label: 'Сварщик' },
                    { value: 'альпинист', label: 'Альпинист' },
                    { value: 'мастер', label: 'Мастер' },
                    { value: 'РП', label: 'РП (руководитель)' },
                    ...(form.role_tag && !ROLE_TAGS.includes(form.role_tag)
                      ? [{ value: '__other__', label: `${form.role_tag} (нестандарт)` }]
                      : [{ value: '__other__', label: 'Другое…' }]),
                  ]}
                  disabled={disabled}
                />
              </Field>
              {roleSelectValue === '__other__' && (
                <Field label="Своя специальность">
                  <TextInput value={form.role_tag} onChange={(v) => set('role_tag', v)} disabled={disabled} />
                </Field>
              )}
              <Field label="Должность (position)">
                <TextInput value={form.position} onChange={(v) => set('position', v)} disabled={disabled} />
              </Field>
              <Field label="Разряд">
                <TextInput value={form.grade} onChange={(v) => set('grade', v)} disabled={disabled} placeholder="3–6" />
              </Field>
            </div>
            <div className="grid-3 gap-10">
              <Field label="Дата приёма">
                <DatePicker value={form.hire_date} onChange={(v) => set('hire_date', v || '')} disabled={disabled} />
              </Field>
              <Field label="Тип договора">
                <SelectInput value={form.contract_type} onChange={(v) => set('contract_type', v)} options={CONTRACT_TYPES} disabled={disabled} />
              </Field>
              <Field label="Оклад ₽" error={fieldErrors.salary}>
                <TextInput
                  value={form.salary}
                  onChange={(v) => set('salary', String(v).replace(/[^\d]/g, ''))}
                  inputMode="numeric"
                  disabled={disabled}
                />
              </Field>
            </div>
            <Field label="Дневная ставка" error={fieldErrors.day_rate}>
              <TextInput
                value={form.day_rate}
                onChange={(v) => set('day_rate', String(v).replace(/[^\d]/g, ''))}
                inputMode="numeric"
                disabled={disabled}
              />
            </Field>
          </FormSection>

          <FormSection title="Самозанятый">
            <Field label="Является самозанятым (плательщик НПД)">
              <Checkbox
                checked={form.is_self_employed}
                onChange={(v) => set('is_self_employed', v)}
                label="Плательщик НПД"
                disabled={disabled || form.is_officially_employed}
              />
            </Field>
            <Field
              label="Выплаты идут не на меня"
              help="На родственника-СЗ. У получателя свои НПД-лимиты."
            >
              <Checkbox
                checked={form.use_payee}
                onChange={(v) => {
                  set('use_payee', v);
                  if (!v) {
                    set('se_payee_id', null);
                    set('se_payee_fio', '');
                    set('se_payee_phone', '');
                    set('se_payee_inn', '');
                  }
                }}
                label="Выплаты на родственника-СЗ"
                disabled={disabled}
              />
            </Field>
            {form.use_payee && canEditFinance && (
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
            {canEditFinance ? (
              <>
                <Field label="Разрешить превышение месячного лимита (350k)">
                  <Checkbox
                    checked={form.can_exceed_limit}
                    onChange={(v) => set('can_exceed_limit', v)}
                    label="Снять месячный лимит"
                    disabled={disabled}
                  />
                </Field>
                <Field label="За год уже потрачено ₽">
                  <TextInput
                    value={form.se_yearly_used_initial}
                    onChange={(v) => set('se_yearly_used_initial', String(v).replace(/[^\d]/g, ''))}
                    inputMode="numeric"
                    disabled={disabled}
                  />
                </Field>
                <Field label="За текущий месяц (опц.)">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 8 }}>
                    <TextInput value={form.se_monthly_year} onChange={(v) => set('se_monthly_year', String(v).replace(/\D/g, '').slice(0, 4))} placeholder="год" disabled={disabled} />
                    <TextInput value={form.se_monthly_month} onChange={(v) => set('se_monthly_month', String(v).replace(/\D/g, '').slice(0, 2))} placeholder="мес" disabled={disabled} />
                    <TextInput value={form.se_monthly_amount} onChange={(v) => set('se_monthly_amount', String(v).replace(/[^\d]/g, ''))} placeholder="сумма" disabled={disabled} />
                  </div>
                </Field>
              </>
            ) : (
              <div className="c-t3 emp-finance-readonly">
                <div><b>Месячный лимит:</b> {e.can_exceed_limit ? 'снят' : 'действует (350 000 ₽)'}</div>
                <div><b>За год:</b> {fmtMoneyFallback(e.se_yearly_used_initial)}</div>
              </div>
            )}
          </FormSection>

          <FormSection title="Официально устроен">
            <Field label="По трудовому договору">
              <Checkbox
                checked={form.is_officially_employed}
                onChange={(v) => set('is_officially_employed', v)}
                label="Официально устроен"
                disabled={disabled || form.is_self_employed}
              />
            </Field>
            {canEditFinance ? (
              <>
                <div className="grid-2 gap-10">
                  <Field label="Оклад ₽">
                    <TextInput value={form.official_salary} onChange={(v) => set('official_salary', String(v).replace(/[^\d]/g, ''))} disabled={disabled} />
                  </Field>
                  <Field label="Несгораемая часть ₽">
                    <TextInput value={form.official_non_burnable} onChange={(v) => set('official_non_burnable', String(v).replace(/[^\d]/g, ''))} disabled={disabled} />
                  </Field>
                </div>
                <div className="grid-2 gap-10">
                  <Field label="Дата приёма (ТД)">
                    <DatePicker value={form.official_hire_date} onChange={(v) => set('official_hire_date', v || '')} disabled={disabled} />
                  </Field>
                  <Field label="Статус занятости">
                    <SelectInput value={form.official_status} onChange={(v) => set('official_status', v)} options={OFFICIAL_STATUSES} disabled={disabled} />
                  </Field>
                </div>
                {form.official_status === 'unpaid_leave' && (
                  <div className="grid-2 gap-10">
                    <Field label="Отпуск с">
                      <DatePicker value={form.official_leave_from} onChange={(v) => set('official_leave_from', v || '')} disabled={disabled} />
                    </Field>
                    <Field label="по">
                      <DatePicker value={form.official_leave_to} onChange={(v) => set('official_leave_to', v || '')} disabled={disabled} />
                    </Field>
                  </div>
                )}
              </>
            ) : (
              <div className="c-t3 emp-finance-readonly">
                <div><b>Оклад:</b> {e.official_salary != null ? fmtMoneyFallback(e.official_salary) : '—'}</div>
                <div><b>Статус:</b> {labelOfficial(e.official_status)}</div>
                <div><b>Приём:</b> {dateOnly(e.official_hire_date) || '—'}</div>
              </div>
            )}
          </FormSection>

          <FormSection title="Банк" warn>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
              <Field label="Банк">
                <TextInput value={form.bank_name} onChange={(v) => set('bank_name', v)} disabled={disabled} />
              </Field>
              <Field label="БИК" error={fieldErrors.bik}>
                <TextInput value={form.bik} onChange={(v) => set('bik', String(v).replace(/\D/g, '').slice(0, 9))} disabled={disabled} />
              </Field>
            </div>
            <div className="grid-2 gap-10">
              <Field label="Расчётный счёт" error={fieldErrors.account_number}>
                <TextInput value={form.account_number} onChange={(v) => set('account_number', String(v).replace(/\D/g, '').slice(0, 20))} disabled={disabled} />
              </Field>
              <Field label="Карта">
                <TextInput value={form.card_number} onChange={(v) => set('card_number', String(v).replace(/\D/g, '').slice(0, 19))} disabled={disabled} />
              </Field>
            </div>
          </FormSection>
        </>
      )}

      {show('notes') && (
        <FormSection title="Заметки">
          <Field label="Примечание">
            <TextareaInput value={form.notes} onChange={(v) => set('notes', v)} minRows={2} maxRows={5} disabled={disabled} />
          </Field>
          <Field label="Комментарий HR">
            <TextareaInput value={form.comment} onChange={(v) => set('comment', v)} minRows={2} maxRows={5} disabled={disabled} />
          </Field>
        </FormSection>
      )}
    </div>
  );
}
