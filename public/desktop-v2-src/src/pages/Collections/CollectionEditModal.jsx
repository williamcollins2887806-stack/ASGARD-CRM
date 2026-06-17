/**
 * CollectionEditModal — создание/редактирование подборки.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { Field, TextInput, TextareaInput } from '@/inputs/Inputs';
import { createCollection, updateCollection } from './api';

function emit() { window.dispatchEvent(new CustomEvent('asgard:collections:changed')); }

export function CollectionEditModal({ collection, onSaved }) {
  const { close } = useModal();
  const isEdit = !!collection?.id;

  const [name, setName] = useState(collection?.name || '');
  const [description, setDescription] = useState(collection?.description || '');
  const [busy, setBusy] = useState(false);

  const onSave = async () => {
    if (!name.trim()) {
      toast.error('Укажите название');
      return;
    }
    setBusy(true);
    try {
      if (isEdit) {
        await updateCollection(collection.id, { name: name.trim(), description: description.trim() });
        toast.success('Подборка обновлена');
      } else {
        await createCollection({ name: name.trim(), description: description.trim() });
        toast.success('Подборка создана');
      }
      emit();
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon={isEdit ? '✎' : '📋'}
        title={isEdit ? 'Редактирование подборки' : 'Новая подборка'}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="col gap-14">
          <Field label="Название" required>
            <TextInput value={name} onChange={setName} placeholder="Например: Опытные мастера" />
          </Field>
          <Field label="Описание">
            <TextareaInput value={description} onChange={setDescription} placeholder="Краткое описание подборки" />
          </Field>
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" onClick={onSave} disabled={busy}>
          {busy ? 'Сохраняем…' : isEdit ? 'Сохранить' : 'Создать'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
