import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field, Input, Select } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { createQuickProduct } from './api';
import { api } from '@/api/client';

/**
 * Быстрое создание новой позиции каталога (vanilla openQuickProduct).
 */
export function QuickProductModal({ onSaved }) {
  const { close } = useModal();
  const [cats, setCats] = useState([]);
  const [data, setData] = useState({ name: '', unit: 'шт', ean: '', category_id: '', is_consumable: false });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api('/api/product-categories').then((d) => setCats(d.items || [])).catch(() => setCats([]));
  }, []);

  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));

  const submit = async () => {
    if (!data.name.trim()) return toast.warn('Введите наименование');
    setSaving(true);
    try {
      const r = await createQuickProduct({
        name: data.name.trim(),
        unit: data.unit.trim() || 'шт',
        ean: data.ean.trim() || null,
        category_id: data.category_id || null,
        created_from: 'manual'
      });
      if (data.is_consumable && r?.item?.id) {
        try {
          await api('/api/products/' + r.item.id, { method: 'PUT', body: { is_consumable: true } });
        } catch { /* noop */ }
      }
      toast.success(r?.existed ? 'Позиция уже была в каталоге' : 'Позиция добавлена');
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
      <MHead icon="➕" title="Новая позиция каталога" accent="info" onClose={close} />
      <MBody>
        <Field label="Наименование" required>
          <Input value={data.name} onChange={(e) => set('name', e.target.value)} placeholder="Например: Перчатки нитриловые M" autoFocus />
        </Field>
        <div className="m-grid-2">
          <Field label="Единица">
            <Input value={data.unit} onChange={(e) => set('unit', e.target.value)} placeholder="шт" />
          </Field>
          <Field label="EAN / штрихкод">
            <Input value={data.ean} onChange={(e) => set('ean', e.target.value)} />
          </Field>
        </div>
        <Field label="Категория">
          <Select value={data.category_id} onChange={(e) => set('category_id', e.target.value)}>
            <option value="">— без категории —</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>{(c.parent_id ? '— ' : '') + (c.name || '')}</option>
            ))}
          </Select>
        </Field>
        <Field>
          <label className="row gap-8 fs-13 c-t2">
            <input
              type="checkbox"
              checked={data.is_consumable}
              onChange={(e) => set('is_consumable', e.target.checked)}
            />
            <span>Расходник (количественный учёт)</span>
          </label>
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={saving} onClick={submit}>
          {saving ? 'Создаём…' : 'Создать'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
