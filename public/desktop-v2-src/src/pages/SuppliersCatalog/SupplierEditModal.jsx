/**
 * Модалка создания/редактирования поставщика.
 * Источник логики: vanilla `suppliers-page.js` → openSupplierCreateModal + form в openSupplierDetail.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, INNInput, PhoneInput, NumberInput, SelectInput, TextareaInput, Switch } from '@/inputs/Inputs';
import { emailError, phoneError, innError, urlError } from '@/inputs/validators';
import { toast } from '@/modals/Notifications';
import { CATEGORIES, createSupplier, updateSupplier, emitChanged } from './api';

export function SupplierEditModal({ supplier, onSaved }) {
  const { close } = useModal();
  const isEdit = !!supplier?.id;

  const [form, setForm] = useState({
    name:      supplier?.name || '',
    inn:       supplier?.inn || '',
    kpp:       supplier?.kpp || '',
    ogrn:      supplier?.ogrn || '',
    phone:     supplier?.phone || '',
    email:     supplier?.email || '',
    website:   supplier?.website || '',
    address:   supplier?.address || '',
    category:  supplier?.category || 'materials',
    rating:    supplier?.rating || '',
    notes:     supplier?.notes || '',
    is_active: supplier?.is_active !== false
  });
  const [busy, setBusy] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // G-4: per-field валидация
  const fieldErrors = {
    inn:     innError(form.inn),
    kpp:     form.kpp && form.kpp.length !== 9 ? 'КПП — 9 цифр' : null,
    ogrn:    form.ogrn && form.ogrn.length !== 13 && form.ogrn.length !== 15 ? 'ОГРН — 13/15 цифр' : null,
    email:   emailError(form.email),
    phone:   phoneError(form.phone),
    website: urlError(form.website),
    rating:  form.rating && (Number(form.rating) < 0 || Number(form.rating) > 5) ? 'Рейтинг 0-5' : null
  };
  const hasFieldErr = Object.values(fieldErrors).some(Boolean);

  const save = async () => {
    if (!form.name.trim()) {
      return toast.warn('Укажите название поставщика');
    }
    if (fieldErrors.inn)     return toast.warn(fieldErrors.inn);
    if (fieldErrors.kpp)     return toast.warn(fieldErrors.kpp);
    if (fieldErrors.ogrn)    return toast.warn(fieldErrors.ogrn);
    if (fieldErrors.email)   return toast.warn(fieldErrors.email);
    if (fieldErrors.phone)   return toast.warn(fieldErrors.phone);
    if (fieldErrors.website) return toast.warn(fieldErrors.website);
    setBusy(true);
    try {
      const body = {
        name:      form.name.trim(),
        inn:       form.inn || null,
        kpp:       form.kpp || null,
        ogrn:      form.ogrn || null,
        phone:     form.phone || null,
        email:     form.email || null,
        website:   form.website || null,
        address:   form.address || null,
        category:  form.category || 'other',
        rating:    form.rating ? Number(form.rating) : null,
        notes:     form.notes || null,
        is_active: !!form.is_active
      };
      let result;
      if (isEdit) {
        result = await updateSupplier(supplier.id, body);
        toast.success('Поставщик обновлён');
      } else {
        result = await createSupplier(body);
        toast.success('Поставщик создан');
      }
      emitChanged();
      onSaved?.(result?.item);
      close();
    } catch (e) {
      toast.error((isEdit ? 'Не удалось обновить: ' : 'Не удалось создать: ') + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-wide">
      <MHead
        icon={isEdit ? '✎' : '➕'}
        title={isEdit ? 'Редактировать поставщика' : 'Новый поставщик'}
        subtitle={isEdit ? `ID #${supplier?.id}` : 'Контрагент для закупок'}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="col gap-14">
          <Field label="Название" required>
            <TextInput
              value={form.name}
              onChange={(v) => set('name', v)}
              placeholder='ООО «Снабторг»'
            />
          </Field>

          <div className="grid-3 gap-10">
            <Field label="ИНН" error={fieldErrors.inn}>
              <INNInput value={form.inn} onChange={(v) => set('inn', v)} />
            </Field>
            <Field label="КПП" error={fieldErrors.kpp}>
              <TextInput
                value={form.kpp}
                onChange={(v) => set('kpp', v.replace(/\D/g, '').slice(0, 9))}
                placeholder="9 цифр"
              />
            </Field>
            <Field label="ОГРН" error={fieldErrors.ogrn}>
              <TextInput
                value={form.ogrn}
                onChange={(v) => set('ogrn', v.replace(/\D/g, '').slice(0, 15))}
                placeholder="13 или 15 цифр"
              />
            </Field>
          </div>

          <div className="grid-2 gap-10">
            <Field label="Телефон" error={fieldErrors.phone}>
              <PhoneInput value={form.phone} onChange={(v) => set('phone', v)} />
            </Field>
            <Field label="Email" error={fieldErrors.email}>
              <TextInput
                type="email"
                value={form.email}
                onChange={(v) => set('email', v)}
                placeholder="info@example.ru"
              />
            </Field>
          </div>

          <div className="grid-2 gap-10">
            <Field label="Сайт" error={fieldErrors.website}>
              <TextInput
                value={form.website}
                onChange={(v) => set('website', v)}
                placeholder="https://example.ru"
              />
            </Field>
            <Field label="Категория">
              <SelectInput
                value={form.category}
                onChange={(v) => set('category', v)}
                options={CATEGORIES}
              />
            </Field>
          </div>

          <Field label="Адрес">
            <TextInput
              value={form.address}
              onChange={(v) => set('address', v)}
              placeholder="г. Москва, ул…"
            />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'end' }}>
            <Field label="Рейтинг (1-5)">
              <NumberInput
                value={form.rating}
                onChange={(v) => set('rating', v)}
                min={0}
                max={5}
              />
            </Field>
            <Field label="Активен">
              <Switch
                checked={form.is_active}
                onChange={(v) => set('is_active', v)}
                label={form.is_active ? 'Поставщик активен' : 'Неактивен'}
              />
            </Field>
          </div>

          <Field label="Примечание">
            <TextareaInput
              value={form.notes}
              onChange={(v) => set('notes', v)}
              placeholder="Заметки по поставщику"
              minRows={2}
              maxRows={6}
            />
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={save}>
          {busy ? 'Сохраняем…' : isEdit ? '💾 Сохранить' : '✓ Создать'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
