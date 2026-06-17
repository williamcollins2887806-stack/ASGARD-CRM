import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field, Textarea, Select } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { loadPmUsers, loadWorksList, transferRequestEquipment } from './api';

/** Запрос на передачу оборудования другому РП (vanilla openTransferForm). */
export function EquipmentTransferModal({ eq, onSaved }) {
  const { close } = useModal();
  const [pm, setPm] = useState([]);
  const [works, setWorks] = useState([]);
  const [data, setData] = useState({ holder_id: '', work_id: '', notes: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([loadPmUsers(), loadWorksList()]).then(([p, w]) => { setPm(p); setWorks(w); });
  }, []);

  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));

  const submit = async () => {
    if (!data.holder_id) return toast.warn('Выберите получателя');
    setSaving(true);
    try {
      await transferRequestEquipment({
        equipment_id: eq.id,
        to_user_id: Number(data.holder_id),
        work_id: data.work_id ? Number(data.work_id) : null,
        notes: data.notes || ''
      });
      toast.success('Запрос на передачу создан, ожидает подтверждения склада');
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
      <MHead icon="🔄" title={'Передать: ' + (eq?.name || '')} subtitle={eq?.inventory_number ? '№ ' + eq.inventory_number : null} accent="warn" onClose={close} />
      <MBody>
        <Field label="Кому передать (РП)" required>
          <Select value={data.holder_id} onChange={(e) => set('holder_id', e.target.value)}>
            <option value="">— выберите РП —</option>
            {pm.map((u) => <option key={u.id} value={u.id}>{u.name || u.login}</option>)}
          </Select>
        </Field>
        <Field label="Работа">
          <Select value={data.work_id} onChange={(e) => set('work_id', e.target.value)}>
            <option value="">— без работы —</option>
            {works.map((w) => <option key={w.id} value={w.id}>{(w.work_number || ('#' + w.id)) + ' — ' + (w.work_title || '')}</option>)}
          </Select>
        </Field>
        <Field label="Примечание">
          <Textarea rows={2} value={data.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={saving} onClick={submit}>
          {saving ? 'Отправляем…' : '🔄 Создать передачу'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
