import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field, Input, Select } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { loadWarehouses, bulkCreateLocations } from './api';

/** Генерация сетки ячеек — vanilla openBulkModal. */
export function BulkLocationsModal({ onSaved }) {
  const { close } = useModal();
  const [whs, setWhs] = useState([]);
  const [data, setData] = useState({
    warehouse_id: '',
    zone: 'A',
    racks: '1,2,3',
    shelves: '1,2,3',
    cells: '1,2,3,4'
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadWarehouses().then((arr) => {
      setWhs(arr);
      if (arr[0]) setData((d) => ({ ...d, warehouse_id: String(arr[0].id) }));
    });
  }, []);

  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));

  const submit = async () => {
    if (!data.warehouse_id) return toast.warn('Выберите склад');
    const split = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
    const body = {
      warehouse_id: Number(data.warehouse_id),
      zone: data.zone.trim() || 'A',
      racks: split(data.racks),
      shelves: split(data.shelves),
      cells: split(data.cells)
    };
    setSaving(true);
    try {
      const r = await bulkCreateLocations(body);
      toast.success(`Создано ячеек: ${r.created || 0}${r.skipped ? ', пропущено: ' + r.skipped : ''}`);
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
      <MHead icon="🗺️" title="Генерация сетки ячеек" accent="info" onClose={close} />
      <MBody>
        <Field label="Склад" required>
          <Select value={data.warehouse_id} onChange={(e) => set('warehouse_id', e.target.value)}>
            <option value="">— выберите склад —</option>
            {whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </Field>
        <Field label="Зона">
          <Input value={data.zone} onChange={(e) => set('zone', e.target.value)} placeholder="A" />
        </Field>
        <Field label="Стеллажи (через запятую)" help="Например: 1,2,3">
          <Input value={data.racks} onChange={(e) => set('racks', e.target.value)} />
        </Field>
        <Field label="Полки (через запятую)">
          <Input value={data.shelves} onChange={(e) => set('shelves', e.target.value)} />
        </Field>
        <Field label="Ячейки (через запятую)">
          <Input value={data.cells} onChange={(e) => set('cells', e.target.value)} />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={saving} onClick={submit}>
          {saving ? 'Создаём…' : 'Создать сетку'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
