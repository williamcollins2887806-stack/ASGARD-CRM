import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field, Textarea, Select } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { returnEquipment, CONDITION_META } from './api';

/** Возврат оборудования на склад (vanilla openReturnModal). */
export function EquipmentReturnModal({ eq, onSaved }) {
  const { close } = useModal();
  const [condition, setCondition] = useState(eq?.condition || 'good');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await returnEquipment({
        equipment_id: eq.id,
        condition_after: condition,
        condition,
        notes: notes || ''
      });
      toast.success('Оборудование вернулось на склад');
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
        icon="📥"
        title={'Вернуть на склад: ' + (eq?.name || '')}
        subtitle={[
          eq?.inventory_number ? '№ ' + eq.inventory_number : '',
          eq?.holder_name ? 'У ' + eq.holder_name : ''
        ].filter(Boolean).join(' · ')}
        accent="success"
        onClose={close}
      />
      <MBody>
        <Field label="Состояние при возврате">
          <Select value={condition} onChange={(e) => setCondition(e.target.value)}>
            {Object.entries(CONDITION_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </Field>
        <Field label="Примечание">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Повреждения, недостача комплектации…" />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={saving} onClick={submit}>
          {saving ? 'Возвращаем…' : '📥 Вернуть'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
