import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field, Input, Textarea, Select } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { loadPmUsers, loadObjects, loadWorksList, issueEquipment, CONDITION_META } from './api';

/** Выдача оборудования РП (vanilla openIssueModal). */
export function EquipmentIssueModal({ eq, onSaved }) {
  const { close } = useModal();
  const [pm, setPm]     = useState([]);
  const [works, setWorks] = useState([]);
  const [objs, setObjs] = useState([]);
  const [data, setData] = useState({
    holder_id: '',
    object_id: '',
    work_id: '',
    quantity: eq?.quantity || 1,
    condition: eq?.condition || 'good',
    notes: ''
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([loadPmUsers(), loadObjects(), loadWorksList()]).then(([p, o, w]) => {
      setPm(p); setObjs(o); setWorks(w);
    });
  }, []);

  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));

  const submit = async () => {
    if (!data.holder_id) return toast.warn('Выберите получателя');
    setSaving(true);
    try {
      await issueEquipment({
        equipment_id: eq.id,
        holder_id: Number(data.holder_id),
        object_id: data.object_id ? Number(data.object_id) : null,
        work_id: data.work_id ? Number(data.work_id) : null,
        quantity: parseFloat(data.quantity) || 1,
        condition_after: data.condition,
        notes: data.notes || ''
      });
      toast.success('Оборудование выдано');
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
      <MHead icon="📤" title={'Выдать: ' + (eq?.name || '')} subtitle={eq?.inventory_number ? '№ ' + eq.inventory_number : null} accent="info" onClose={close} />
      <MBody>
        <div className="m-grid-2">
          <Field label="Кому выдать (РП)" required>
            <Select value={data.holder_id} onChange={(e) => set('holder_id', e.target.value)}>
              <option value="">— выберите РП —</option>
              {pm.map((u) => <option key={u.id} value={u.id}>{u.name || u.login}</option>)}
            </Select>
          </Field>
          <Field label="Объект">
            <Select value={data.object_id} onChange={(e) => set('object_id', e.target.value)}>
              <option value="">— не указано —</option>
              {objs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Привязка к работе">
          <Select value={data.work_id} onChange={(e) => set('work_id', e.target.value)}>
            <option value="">— без работы —</option>
            {works.map((w) => <option key={w.id} value={w.id}>{(w.work_number || ('#' + w.id)) + ' — ' + (w.work_title || w.customer_name || '')}</option>)}
          </Select>
        </Field>
        {eq?.is_consumable && (
          <Field label={`Количество (из ${eq.quantity || 1} ${eq.unit || 'шт'})`}>
            <Input type="number" step="0.001" value={data.quantity} max={eq.quantity} onChange={(e) => set('quantity', e.target.value)} />
          </Field>
        )}
        <Field label="Состояние при выдаче">
          <Select value={data.condition} onChange={(e) => set('condition', e.target.value)}>
            {Object.entries(CONDITION_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </Field>
        <Field label="Примечание">
          <Textarea rows={2} value={data.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Комплектация, особые условия…" />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={saving} onClick={submit}>
          {saving ? 'Выдаём…' : '📤 Выдать'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
