/**
 * Модалка создания / редактирования печати.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import {
  TextInput, TextareaInput, SelectInput, DatePicker
} from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';

import { SEAL_TYPES, createSeal, updateSeal } from './api';

function emit() { window.dispatchEvent(new CustomEvent('asgard:seals:changed')); }

export function SealEditModal({ seal, onSaved }) {
  const { close } = useModal();
  const isEdit = !!seal?.id;

  const [form, setForm] = useState({
    name:         seal?.name || '',
    type:         seal?.type || 'main',
    inv_number:   seal?.inv_number || '',
    purchase_date: (seal?.purchase_date || '').slice(0, 10),
    comment:      seal?.comment || ''
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim()) {
      toast.error('Укажите название печати');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name:          form.name.trim(),
        type:          form.type,
        inv_number:    form.inv_number.trim() || null,
        purchase_date: form.purchase_date || null,
        comment:       form.comment.trim() || null
      };
      if (!isEdit) {
        payload.status = 'office';
        payload.holder_id = null;
      }
      const saved = isEdit ? await updateSeal(seal.id, payload) : await createSeal(payload);
      toast.success(isEdit ? 'Печать обновлена' : 'Печать добавлена');
      emit();
      onSaved?.(saved);
      close();
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.message || e));
      setSaving(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon={isEdit ? '✎' : '🔖'}
        title={isEdit ? 'Редактирование печати' : 'Новая печать'}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="col gap-14">
          <Field label="Название" required>
            <TextInput value={form.name} onChange={(v) => set('name', v)} placeholder="Основная печать ООО «АСГАРД»" />
          </Field>
          <div className="grid-2 gap-10">
            <Field label="Тип">
              <SelectInput value={form.type} onChange={(v) => set('type', v)} options={SEAL_TYPES} />
            </Field>
            <Field label="Инвентарный номер">
              <TextInput value={form.inv_number} onChange={(v) => set('inv_number', v)} placeholder="ИНВ-001" />
            </Field>
          </div>
          <Field label="Дата покупки">
            <DatePicker value={form.purchase_date} onChange={(v) => set('purchase_date', v || '')} />
          </Field>
          <Field label="Комментарий">
            <TextareaInput
              value={form.comment}
              onChange={(v) => set('comment', v)}
              placeholder="Заметки по печати…"
              minRows={2}
              maxRows={5}
            />
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close} disabled={saving}>Отмена</Btn>
        <Btn variant="primary" onClick={save} disabled={saving}>
          {saving ? 'Сохраняем…' : isEdit ? '💾 Сохранить' : '✓ Создать'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
