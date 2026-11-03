/**
 * Модалка создания/редактирования тарифа полевого модуля.
 * С 01.11.2026: ставка в ₽; points пишется как rate/500 для legacy-совместимости.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, NumberInput, Switch } from '@/inputs/Inputs';

import {
  CATEGORY_OPTIONS,
  DEFAULT_POINT_VALUE,
  createTariff,
  updateTariff,
} from './api';
import { snapRubStep10 } from '@/lib/moneyCompact';

export { TariffEditModal as TariffModal };

export function TariffEditModal({ tariff, onSaved }) {
  const { close } = useModal();
  const isEdit = !!tariff?.id;

  const t = tariff || {};
  const [category, setCategory] = useState(t.category || 'ground');
  const [positionName, setPositionName] = useState(t.position_name || '');
  const [rate, setRate] = useState(t.rate_per_shift ?? 6000);
  const [isCombinable, setIsCombinable] = useState(!!t.is_combinable);
  const [requiresApproval, setRequiresApproval] = useState(!!t.requires_approval);
  const [notes, setNotes] = useState(t.notes || '');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const name = positionName.trim();
    if (!name) {
      toast.warn('Укажите должность');
      return;
    }
    const rateNum = snapRubStep10(rate);
    if (!Number.isFinite(rateNum) || rateNum < 0) {
      toast.warn('Ставка должна быть числом ≥ 0');
      return;
    }

    setSaving(true);
    const body = {
      category,
      position_name: name,
      // legacy: points ≈ rate/500, чтобы старые отчёты не ломались
      points: Math.round(rateNum / DEFAULT_POINT_VALUE),
      rate_per_shift: rateNum,
      point_value: DEFAULT_POINT_VALUE,
      is_combinable: isCombinable,
      requires_approval: requiresApproval,
      notes: notes.trim() || null,
    };

    try {
      if (isEdit) await updateTariff(tariff.id, body);
      else        await createTariff(body);
      toast.success(isEdit ? 'Тариф обновлён' : 'Тариф создан');
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon={isEdit ? '✎' : '＋'}
        title={isEdit ? 'Редактирование тарифа' : 'Новый тариф'}
        subtitle={isEdit ? tariff.position_name : 'Категория, ставка ₽, флаги'}
        onClose={close}
      />
      <MBody>
        <div className="ft-formgrid">
          <Field label="Категория" required>
            <select
              className="m-select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <div className="span-2">
            <Field label="Должность" required>
              <TextInput
                value={positionName}
                onChange={setPositionName}
                placeholder="Слесарь полный функционал"
              />
            </Field>
          </div>
          <Field label="Ставка ₽/смена" required help="Шаг 10 ₽">
            <NumberInput value={rate} onChange={setRate} min={0} max={1000000} step={10} />
          </Field>
          <div className="span-2 row gap-16">
            <Switch
              checked={isCombinable}
              onChange={setIsCombinable}
              label="Комбинируется с другой ролью"
            />
            <Switch
              checked={requiresApproval}
              onChange={setRequiresApproval}
              label="Требует согласования"
            />
          </div>
          <div className="span-2">
            <Field label="Заметки">
              <TextInput
                value={notes}
                onChange={setNotes}
                placeholder="Необязательно"
              />
            </Field>
          </div>
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" onClick={submit} disabled={saving}>
          {saving ? 'Сохраняем…' : isEdit ? 'Сохранить' : 'Создать'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
