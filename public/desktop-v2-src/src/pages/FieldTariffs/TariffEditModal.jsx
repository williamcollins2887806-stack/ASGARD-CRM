/**
 * Модалка создания/редактирования тарифа полевого модуля.
 *
 * Поля: category, position_name, points, rate_per_shift, is_combinable,
 *       requires_approval, notes (см. field-manage.js POST/PUT /tariffs).
 *
 * Алиас TariffModal оставлен для совместимости с возможными vanilla-ссылками
 * (по аналогии с MailSettings/AccountEditModal).
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

export { TariffEditModal as TariffModal };

export function TariffEditModal({ tariff, onSaved }) {
  const { close } = useModal();
  const isEdit = !!tariff?.id;

  const t = tariff || {};
  const [category, setCategory] = useState(t.category || 'ground');
  const [positionName, setPositionName] = useState(t.position_name || '');
  const [points, setPoints] = useState(t.points ?? 12);
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
    const ptsNum = Number(points);
    const rateNum = Number(rate);
    if (!Number.isFinite(ptsNum) || ptsNum < 0) {
      toast.warn('Баллы должны быть числом ≥ 0');
      return;
    }
    if (!Number.isFinite(rateNum) || rateNum < 0) {
      toast.warn('Ставка должна быть числом ≥ 0');
      return;
    }

    setSaving(true);
    const body = {
      category,
      position_name: name,
      points: ptsNum,
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

  // «Подставить ставку из баллов» — Ставка = Баллы × 500 (по комментарию vanilla).
  const onSyncRate = () => {
    const ptsNum = Number(points);
    if (Number.isFinite(ptsNum) && ptsNum >= 0) {
      setRate(ptsNum * DEFAULT_POINT_VALUE);
    }
  };

  return (
    <MCard>
      <MHead
        icon={isEdit ? '✎' : '＋'}
        title={isEdit ? 'Редактирование тарифа' : 'Новый тариф'}
        subtitle={isEdit ? tariff.position_name : 'Категория, баллы, ставка, флаги'}
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
          <Field label="Баллы" required help="1 балл = 500 ₽">
            <NumberInput value={points} onChange={setPoints} min={0} max={1000} step={1} />
          </Field>
          <Field label="Ставка ₽/смена" required>
            <NumberInput value={rate} onChange={setRate} min={0} max={1000000} step={100} />
          </Field>
          <div>
            <Btn variant="ghost" size="sm" onClick={onSyncRate}>
              ↻ Ставка из баллов
            </Btn>
          </div>
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
