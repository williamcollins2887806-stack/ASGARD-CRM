/**
 * CustomerQuickCreateModal — inline-форма создания контрагента из tender wizard.
 *
 * Источник: vanilla `promptCreateCustomer` + `openCustomerCreator`
 * (tenders.js:2929-2962) — попап «контрагента нет в базе, создать карточку?».
 *
 * Поля (минимальный набор для быстрого создания на лету):
 *   - ИНН (обязательно, валидируется)
 *   - Название (обязательно)
 *   - КПП, Email, Телефон, Город/адрес — опционально.
 *
 * После успешного создания вызывает `onCreated(customer)` — родитель использует
 * это чтобы подставить контрагента обратно в tender wizard БЕЗ его закрытия.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import {
  Field, TextInput, INNInput, PhoneInput
} from '@/inputs/Inputs';
import {
  emailError, phoneError, innError
} from '@/inputs/validators';
import { toast } from '@/modals/Notifications';
import { createCustomerFromTender } from '../api';

function isValidInn(inn) {
  const v = String(inn || '').replace(/\D/g, '');
  if (v.length !== 10 && v.length !== 12) return false;
  if (v.length === 10) {
    const w = [2, 4, 10, 3, 5, 9, 4, 6, 8];
    const k = (w.reduce((a, wi, i) => a + wi * Number(v[i]), 0) % 11) % 10;
    return k === Number(v[9]);
  }
  const w11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
  const w12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
  const k11 = (w11.reduce((a, wi, i) => a + wi * Number(v[i]), 0) % 11) % 10;
  const k12 = (w12.reduce((a, wi, i) => a + wi * Number(v[i]), 0) % 11) % 10;
  return k11 === Number(v[10]) && k12 === Number(v[11]);
}

export function CustomerQuickCreateModal({ prefill = {}, onCreated }) {
  const { close } = useModal();

  const [form, setForm] = useState({
    inn:            String(prefill.inn || ''),
    name:           String(prefill.name || prefill.full_name || '').trim(),
    full_name:      String(prefill.full_name || '').trim(),
    kpp:            String(prefill.kpp || ''),
    address:        String(prefill.address || ''),
    email:          '',
    phone:          '',
    contact_person: ''
  });
  const [busy, setBusy] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const fieldErrors = {
    inn:   innError(form.inn),
    email: emailError(form.email),
    phone: phoneError(form.phone),
    kpp:   form.kpp && form.kpp.length !== 9 ? 'КПП — 9 цифр' : null
  };
  const hasFieldErr = Object.values(fieldErrors).some(Boolean);

  const save = async () => {
    if (!isValidInn(form.inn)) {
      return toast.warn('ИНН должен быть 10 или 12 цифр');
    }
    if (!form.name.trim()) {
      return toast.warn('Укажите название контрагента');
    }
    if (fieldErrors.email) return toast.warn(fieldErrors.email);
    if (fieldErrors.phone) return toast.warn(fieldErrors.phone);
    if (fieldErrors.kpp)   return toast.warn(fieldErrors.kpp);

    setBusy(true);
    try {
      const res = await createCustomerFromTender({
        inn:            form.inn,
        name:           form.name,
        full_name:      form.full_name,
        kpp:            form.kpp,
        email:          form.email,
        phone:          form.phone,
        address:        form.address,
        contact_person: form.contact_person
      });
      const customer = res?.customer || res || { inn: form.inn, name: form.name };
      toast.success('Контрагент создан');
      window.dispatchEvent(new CustomEvent('asgard:customers:changed'));
      onCreated?.(customer);
      close();
    } catch (e) {
      toast.error('Не удалось создать: ' + (e?.serverMsg || e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon="🏢"
        title="Новый контрагент"
        subtitle="Создаём прямо из мастера тендера"
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="col gap-14">
          <div className="grid-2 gap-10">
            <Field label="ИНН" required help="10 цифр (юр.лицо) или 12 (ИП)" error={fieldErrors.inn}>
              <INNInput value={form.inn} onChange={(v) => set('inn', v)} />
            </Field>
            <Field label="КПП" error={fieldErrors.kpp}>
              <TextInput
                value={form.kpp}
                onChange={(v) => set('kpp', v.replace(/\D/g, '').slice(0, 9))}
                placeholder="9 цифр"
                maxLength={9}
              />
            </Field>
          </div>

          <Field label="Название" required>
            <TextInput
              value={form.name}
              onChange={(v) => set('name', v)}
              placeholder='ООО «Ромашка»'
            />
          </Field>

          <Field label="Полное наименование">
            <TextInput
              value={form.full_name}
              onChange={(v) => set('full_name', v)}
              placeholder='Общество с ограниченной ответственностью «Ромашка»'
            />
          </Field>

          <div className="grid-2 gap-10">
            <Field label="Контактный email" error={fieldErrors.email}>
              <TextInput
                type="email"
                value={form.email}
                onChange={(v) => set('email', v)}
                placeholder="info@example.ru"
              />
            </Field>
            <Field label="Телефон" error={fieldErrors.phone}>
              <PhoneInput value={form.phone} onChange={(v) => set('phone', v)} />
            </Field>
          </div>

          <Field label="Город / адрес">
            <TextInput
              value={form.address}
              onChange={(v) => set('address', v)}
              placeholder="г. Москва, ул…"
            />
          </Field>

          <Field label="Контактное лицо">
            <TextInput
              value={form.contact_person}
              onChange={(v) => set('contact_person', v)}
              placeholder="ФИО · должность"
            />
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy || hasFieldErr} onClick={save}>
          {busy ? 'Создаём…' : '✓ Создать и подставить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
