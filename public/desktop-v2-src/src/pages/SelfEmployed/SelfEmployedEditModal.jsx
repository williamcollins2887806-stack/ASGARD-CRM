/**
 * Модалка создания/редактирования самозанятого.
 * Источник vanilla: payroll.js → renderSelfEmployed → showSEModal.
 *
 * Валидация: ИНН СЗ — 12 цифр (бэк это тоже проверяет, возвращает 400).
 *
 * RBAC (payroll.js:370-371): создавать/редактировать СЗ могут
 * ADMIN, BUH, HEAD_PM и DIRECTOR_* . PM сюда не должен попасть —
 * страница уже отсекает чистого PM (открыть модалку ему нельзя).
 */
import { useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, INNInput, PhoneInput, TextareaInput, SelectInput } from '@/inputs/Inputs';
import { emailError, phoneError, isValidInn, innError } from '@/inputs/validators';
import { toast } from '@/modals/Notifications';
import { createSelfEmployed, updateSelfEmployed, NPD_STATUSES } from './api';

export function SelfEmployedEditModal({ existing, onDone }) {
  const { close } = useModal();
  const { user } = useAuth();
  // Двойной запор RBAC — если PM как-то добрался до модалки, submit заблокирован.
  // payroll.js:370 (ADMIN/HEAD_PM), :371 (DIRECTOR_*), :623 (BUH reads/manages).
  const canSave = (
    user?.role === 'ADMIN' ||
    user?.role === 'BUH' ||
    user?.role === 'HEAD_PM' ||
    ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(user?.role)
  );
  const [data, setData] = useState(() => ({
    full_name:      existing?.full_name      || '',
    inn:            existing?.inn            || '',
    phone:          existing?.phone          || '',
    email:          existing?.email          || '',
    bank_name:      existing?.bank_name      || '',
    bik:            existing?.bik            || '',
    account_number: existing?.account_number || '',
    card_number:    existing?.card_number    || '',
    contract_number:existing?.contract_number|| '',
    contract_date:  existing?.contract_date  ? String(existing.contract_date).slice(0, 10) : '',
    npd_status:     existing?.npd_status     || 'active',
    comment:        existing?.comment        || ''
  }));
  const [saving, setSaving] = useState(false);
  const isEdit = !!existing;

  const set = (k, v) => setData((s) => ({ ...s, [k]: v }));

  // G-4: per-field валидация
  const fieldErrors = {
    inn:   innError(data.inn, 'person'),
    email: emailError(data.email),
    phone: phoneError(data.phone),
    bik:   data.bik && data.bik.replace(/\D/g, '').length !== 9 ? 'БИК — 9 цифр' : null,
    account_number: data.account_number && data.account_number.replace(/\D/g, '').length !== 20 ? 'Расч.счёт — 20 цифр' : null
  };
  const hasFieldErr = Object.values(fieldErrors).some(Boolean);

  const submit = async () => {
    if (!canSave) {
      toast('Запрещено', 'Редактирование СЗ доступно только ADMIN, BUH, HEAD_PM и директорам', 'err');
      return;
    }
    if (!data.full_name.trim()) { toast('Ошибка', 'Укажите ФИО', 'err'); return; }
    if (!isValidInn(data.inn, 'person')) {
      toast('Ошибка', 'ИНН СЗ — 12 цифр с правильной контрольной суммой', 'err');
      return;
    }
    if (fieldErrors.email) { toast('Ошибка', fieldErrors.email, 'err'); return; }
    if (fieldErrors.phone) { toast('Ошибка', fieldErrors.phone, 'err'); return; }
    if (fieldErrors.bik)   { toast('Ошибка', fieldErrors.bik, 'err'); return; }
    if (fieldErrors.account_number) { toast('Ошибка', fieldErrors.account_number, 'err'); return; }

    const payload = {
      full_name:      data.full_name.trim(),
      inn:            String(data.inn).replace(/\s/g, ''),
      phone:          data.phone || null,
      email:          data.email || null,
      bank_name:      data.bank_name || null,
      bik:            data.bik || null,
      account_number: data.account_number || null,
      card_number:    data.card_number || null,
      contract_number:data.contract_number || null,
      contract_date:  data.contract_date || null,
      npd_status:     data.npd_status || 'active',
      comment:        data.comment || null
    };

    setSaving(true);
    try {
      if (isEdit) {
        await updateSelfEmployed(existing.id, payload);
      } else {
        await createSelfEmployed(payload);
      }
      toast(isEdit ? 'Сохранено' : 'Добавлено', '', 'ok');
      window.dispatchEvent(new CustomEvent('asgard:self-employed:changed'));
      onDone?.();
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setSaving(false);
    }
  };

  return (
    <MCard className="modal-lg">
      <MHead
        icon={isEdit ? '✎' : '＋'}
        title={isEdit ? 'Редактировать СЗ' : 'Добавить самозанятого'}
        subtitle={isEdit ? `#${existing.id} · ${existing.full_name}` : 'Реестр НПД'}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <Field label="ФИО" required>
          <TextInput value={data.full_name} onChange={(v) => set('full_name', v)} placeholder="Иванов Иван Иванович" />
        </Field>

        <div className="m-grid-2 mt-10" >
          <Field label="ИНН СЗ (12 цифр)" required error={fieldErrors.inn}>
            <INNInput value={data.inn} onChange={(v) => set('inn', v)} kind="person" />
          </Field>
          <Field label="Телефон" error={fieldErrors.phone}>
            <PhoneInput value={data.phone} onChange={(v) => set('phone', v)} />
          </Field>
        </div>

        <div className="m-grid-2 mt-10" >
          <Field label="Email" error={fieldErrors.email}>
            <TextInput type="email" value={data.email} onChange={(v) => set('email', v)} placeholder="email@example.com" />
          </Field>
          <Field label="Статус НПД">
            <SelectInput
              value={data.npd_status}
              onChange={(v) => set('npd_status', v)}
              options={NPD_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
              placeholder="Статус…"
            />
          </Field>
        </div>

        <div className="m-grid-2 mt-10" >
          <Field label="Банк">
            <TextInput value={data.bank_name} onChange={(v) => set('bank_name', v)} placeholder="Тинькофф, Сбербанк…" />
          </Field>
          <Field label="БИК" error={fieldErrors.bik}>
            <TextInput
              value={data.bik}
              onChange={(v) => set('bik', v.replace(/\D/g, '').slice(0, 9))}
              placeholder="044525593"
              inputMode="numeric"
              maxLength={9}
            />
          </Field>
        </div>

        <Field label="Расчётный счёт" help="20 цифр" error={fieldErrors.account_number}>
          <TextInput
            value={data.account_number}
            onChange={(v) => set('account_number', v.replace(/\D/g, '').slice(0, 20))}
            placeholder="40802810…"
            inputMode="numeric"
            maxLength={20}
          />
        </Field>

        <Field label="Номер карты (необязательно)">
          <TextInput value={data.card_number} onChange={(v) => set('card_number', v)} placeholder="2200…" />
        </Field>

        <div className="m-grid-2 mt-10" >
          <Field label="№ ГПХ">
            <TextInput value={data.contract_number} onChange={(v) => set('contract_number', v)} placeholder="2026/123" />
          </Field>
          <Field label="Дата ГПХ">
            <input
              type="date"
              className="m-input"
              value={data.contract_date}
              onChange={(e) => set('contract_date', e.target.value)}
            />
          </Field>
        </div>

        <Field label="Комментарий">
          <TextareaInput value={data.comment} onChange={(v) => set('comment', v)} placeholder="Дополнительно…" minRows={2} maxRows={4} />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={saving || !canSave || hasFieldErr} onClick={submit}>
          {saving ? '…' : isEdit ? 'Сохранить' : 'Добавить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
