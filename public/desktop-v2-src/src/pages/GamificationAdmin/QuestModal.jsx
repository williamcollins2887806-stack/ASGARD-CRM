/**
 * QuestModal — создание/редактирование квеста.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, NumberInput, TextareaInput, SelectInput, Checkbox } from '@/inputs/Inputs';

import {
  createQuest, updateQuest, QUEST_TYPES, REWARD_TYPES,
} from './api';

export function QuestModal({ quest, onSaved }) {
  const { close } = useModal();
  const isEdit = !!quest;

  const [form, setForm] = useState({
    name: quest?.name || '',
    description: quest?.description || '',
    quest_type: quest?.quest_type || 'daily',
    icon: quest?.icon || '⚔',
    target_action: quest?.target_action || '',
    target_count: quest?.target_count ?? 1,
    reward_amount: quest?.reward_amount ?? 0,
    reward_type: quest?.reward_type || 'runes',
    is_active: quest?.is_active !== false,
  });
  const [busy, setBusy] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const onSave = async () => {
    if (!form.name.trim()) { toast.error('Укажите название'); return; }
    if (!form.target_action.trim()) { toast.error('Укажите target_action'); return; }

    const body = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      quest_type: form.quest_type,
      icon: form.icon.trim() || undefined,
      target_action: form.target_action.trim(),
      target_count: parseInt(form.target_count) || 1,
      reward_amount: parseInt(form.reward_amount) || 0,
      reward_type: form.reward_type,
      is_active: form.is_active,
    };

    setBusy(true);
    try {
      if (isEdit) {
        await updateQuest(quest.id, body);
        toast.success('Квест обновлён');
      } else {
        await createQuest(body);
        toast.success('Квест создан');
      }
      close();
      onSaved?.();
    } catch (e) {
      toast.error(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon={isEdit ? '✏️' : '⚔'}
        title={isEdit ? 'Редактировать квест' : 'Новый квест'}
        accent={isEdit ? 'default' : 'success'}
        onClose={() => close()}
      />
      <MBody>
        <Field label="Название" required>
          <TextInput value={form.name} onChange={(v) => set('name', v)} placeholder="Выполни 5 объектов за неделю" />
        </Field>
        <Field label="Описание">
          <TextareaInput value={form.description} onChange={(v) => set('description', v)} minRows={2} />
        </Field>

        <div className="ga-shop-form-grid">
          <Field label="Тип квеста">
            <SelectInput
              value={form.quest_type}
              onChange={(v) => set('quest_type', v)}
              options={QUEST_TYPES.map((t) => ({ value: t, label: t }))}
            />
          </Field>
          <Field label="Иконка">
            <TextInput value={form.icon} onChange={(v) => set('icon', v)} placeholder="⚔" />
          </Field>

          <Field label="target_action" required help="например complete_work / earn_runes">
            <TextInput value={form.target_action} onChange={(v) => set('target_action', v)} placeholder="complete_work" />
          </Field>
          <Field label="target_count">
            <NumberInput value={form.target_count} onChange={(v) => set('target_count', v)} min={1} />
          </Field>

          <Field label="Награда (кол-во)">
            <NumberInput value={form.reward_amount} onChange={(v) => set('reward_amount', v)} min={0} />
          </Field>
          <Field label="Тип награды">
            <SelectInput
              value={form.reward_type}
              onChange={(v) => set('reward_type', v)}
              options={REWARD_TYPES.map((t) => ({ value: t, label: t }))}
            />
          </Field>
        </div>

        <Checkbox checked={form.is_active} onChange={(v) => set('is_active', v)} label="Активен" />
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={() => close()}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={onSave}>
          {busy ? 'Сохраняем…' : (isEdit ? '💾 Сохранить' : '✚ Создать')}
        </Btn>
      </MFoot>
    </MCard>
  );
}
