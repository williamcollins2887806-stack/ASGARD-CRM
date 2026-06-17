/**
 * Модалка «➕ ТО / ремонт / поверка / осмотр» для оборудования.
 *
 * Источник: vanilla `warehouse-v2-equipment.js:openMaintenanceForm` (503-514).
 * POST /api/equipment/:id/maintenance — { maintenance_type, description, cost, spare_parts, next_date }.
 *
 * Поля (1:1 с vanilla):
 *   • тип: maintenance / repair / calibration / inspection
 *   • описание работ (textarea)
 *   • стоимость ₽ (необязательно)
 *   • след. ТО (date, необязательно)
 *   • запчасти через запятую → массив
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field, Input, Textarea, Select } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { equipmentAddMaintenance } from './api';

const MAINT_TYPES = [
  { value: 'maintenance', label: 'Плановое ТО' },
  { value: 'repair',      label: 'Ремонт' },
  { value: 'calibration', label: 'Поверка' },
  { value: 'inspection',  label: 'Осмотр' }
];

export function EquipmentMaintenanceModal({ eq, onSaved }) {
  const { close } = useModal();
  const [form, setForm] = useState({
    maintenance_type: 'maintenance',
    description: '',
    cost: '',
    next_date: '',
    spare_parts: ''
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  const submit = async () => {
    setSaving(true);
    try {
      const partsRaw = (form.spare_parts || '').trim();
      const spare_parts = partsRaw
        ? partsRaw.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
      await equipmentAddMaintenance(eq.id, {
        maintenance_type: form.maintenance_type,
        description: form.description.trim() || null,
        cost: form.cost ? parseFloat(form.cost) : null,
        spare_parts,
        next_date: form.next_date || null
      });
      toast.success('Запись ТО сохранена');
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon="🔧"
        title={'ТО: ' + (eq?.name || '')}
        subtitle={eq?.inventory_number ? '№ ' + eq.inventory_number : ''}
        accent="warn"
        onClose={close}
      />
      <MBody>
        <Field label="Тип работ">
          <Select value={form.maintenance_type} onChange={(e) => set('maintenance_type', e.target.value)}>
            {MAINT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </Field>
        <Field label="Описание работ">
          <Textarea
            rows={3}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Что сделано, проблемы, итоги…"
          />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Стоимость, ₽">
            <Input
              type="number"
              min="0"
              step="any"
              value={form.cost}
              onChange={(e) => set('cost', e.target.value)}
              placeholder="—"
            />
          </Field>
          <Field label="Следующее ТО">
            <Input
              type="date"
              value={form.next_date}
              onChange={(e) => set('next_date', e.target.value)}
            />
          </Field>
        </div>
        <Field label="Запчасти (через запятую)" help="Например: фильтр, прокладка, манжета">
          <Input
            value={form.spare_parts}
            onChange={(e) => set('spare_parts', e.target.value)}
            placeholder="—"
          />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={saving} onClick={submit}>
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
