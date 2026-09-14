/**
 * Модалка добавления/редактирования одного контакта контрагента.
 * Сохраняет через PUT /api/customers/:inn (массив contacts JSONB).
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, TextInput, PhoneInput, Checkbox } from '@/inputs/Inputs';
import { emailError, phoneError } from '@/inputs/validators';
import { toast } from '@/modals/Notifications';
import { updateCustomer } from './api';
import {
  initialContacts, contactsPayload, emitCustomersChanged
} from './contactsHelpers';

const EMPTY = { name: '', position: '', phone: '', phone2: '', email: '', is_primary: false };

export function CustomerContactEditModal({ customer, contactIndex = null, onSaved }) {
  const { close } = useModal();
  const isEdit = contactIndex != null && contactIndex >= 0;

  const [form, setForm] = useState(() => {
    if (!isEdit) {
      const all = initialContacts(customer);
      return { ...EMPTY, is_primary: all.length === 0 };
    }
    const c = initialContacts(customer)[contactIndex] || EMPTY;
    return { ...c };
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const errEmail = form.email ? emailError(form.email) : null;
  const errPhone = form.phone ? phoneError(form.phone) : null;
  const errPhone2 = form.phone2 ? phoneError(form.phone2) : null;
  const hasErr = !!(errEmail || errPhone || errPhone2);

  const save = async () => {
    if (!form.name.trim()) return toast.warn('Укажите ФИО контакта');
    if (hasErr) return toast.warn(errEmail || errPhone || errPhone2);

    const entry = {
      name:       form.name.trim(),
      position:   form.position.trim(),
      phone:      form.phone.trim(),
      phone2:     form.phone2.trim(),
      email:      form.email.trim(),
      is_primary: !!form.is_primary
    };

    let all = initialContacts(customer);

    if (isEdit) {
      all = all.map((c, i) => {
        if (i === contactIndex) return entry;
        if (entry.is_primary) return { ...c, is_primary: false };
        return c;
      });
    } else {
      if (entry.is_primary) {
        all = all.map((c) => ({ ...c, is_primary: false }));
      }
      all = [...all, entry];
    }

    setBusy(true);
    try {
      await updateCustomer(customer.inn, contactsPayload(all));
      toast.success(isEdit ? 'Контакт обновлён' : 'Контакт добавлен');
      close();
      onSaved?.();
      emitCustomersChanged();
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon="👤"
        title={isEdit ? 'Редактировать контакт' : 'Новый контакт'}
        subtitle={customer?.name || customer?.inn}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="col gap-12">
          <Field label="ФИО" required>
            <TextInput
              value={form.name}
              onChange={(v) => set('name', v)}
              placeholder="Иванов Иван Иванович"
              data-autofocus
            />
          </Field>
          <Field label="Должность">
            <TextInput
              value={form.position}
              onChange={(v) => set('position', v)}
              placeholder="Главный инженер"
            />
          </Field>
          <div className="grid-2 gap-10">
            <Field label="Телефон 1" error={errPhone}>
              <PhoneInput value={form.phone} onChange={(v) => set('phone', v)} />
            </Field>
            <Field label="Телефон 2" error={errPhone2}>
              <PhoneInput value={form.phone2} onChange={(v) => set('phone2', v)} />
            </Field>
          </div>
          <Field label="Email" error={errEmail}>
            <TextInput
              type="email"
              value={form.email}
              onChange={(v) => set('email', v)}
              placeholder="ivanov@example.ru"
            />
          </Field>
          <Checkbox
            checked={form.is_primary}
            onChange={(v) => set('is_primary', v)}
            label="Главное контактное лицо"
          />
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy || hasErr} onClick={save}>
          {busy ? '…' : isEdit ? '💾 Сохранить' : '✓ Добавить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
