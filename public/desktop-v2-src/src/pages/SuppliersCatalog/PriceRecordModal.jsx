/**
 * Модалка ручного добавления цены в базу.
 * Источник: vanilla `suppliers-page.js` → openPriceCreateModal.
 */
import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, SelectInput, MoneyInput, TextareaInput, Combobox } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { SOURCES, createPriceRecord, loadSuppliers } from './api';

export function PriceRecordModal({ onSaved }) {
  const { close } = useModal();
  const [form, setForm] = useState({
    item_name: '', unit_price: '', unit: '', supplier_id: null, source: 'manual', source_url: '', notes: ''
  });
  const [suppliers, setSuppliers] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadSuppliers({ is_active: 'true' })
      .then((items) => setSuppliers(items.map((s) => ({ value: s.id, label: s.name }))))
      .catch(() => setSuppliers([]));
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.item_name.trim()) return toast.warn('Укажите наименование');
    const price = Number(form.unit_price);
    if (!price || price <= 0) return toast.warn('Укажите цену больше 0');
    setBusy(true);
    try {
      await createPriceRecord({
        item_name:   form.item_name.trim(),
        unit_price:  price,
        unit:        form.unit || null,
        supplier_id: form.supplier_id || null,
        source:      form.source || 'manual',
        source_url:  form.source_url || null,
        notes:       form.notes || null
      });
      toast.success('Цена добавлена');
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-wide">
      <MHead icon="💰" title="Добавить цену вручную" accent="gold" onClose={close} />
      <MBody>
        <div className="col gap-12">
          <Field label="Наименование товара" required>
            <TextInput value={form.item_name} onChange={(v) => set('item_name', v)} placeholder="Труба 89×6" />
          </Field>

          <div className="grid-2 gap-10">
            <Field label="Цена за единицу" required>
              <MoneyInput value={form.unit_price} onChange={(v) => set('unit_price', v)} />
            </Field>
            <Field label="Единица измерения">
              <TextInput value={form.unit} onChange={(v) => set('unit', v)} placeholder="шт, кг, м.п." />
            </Field>
          </div>

          <Field label="Поставщик">
            <Combobox
              options={suppliers}
              value={form.supplier_id}
              onChange={(v) => set('supplier_id', v)}
              placeholder="Выберите поставщика (необязательно)"
            />
          </Field>

          <Field label="Источник">
            <SelectInput value={form.source} onChange={(v) => set('source', v)} options={SOURCES.filter((s) => s.value !== 'procurement')} />
          </Field>

          <Field label="Ссылка на источник">
            <TextInput type="url" value={form.source_url} onChange={(v) => set('source_url', v)} placeholder="https://…" />
          </Field>

          <Field label="Примечание">
            <TextareaInput value={form.notes} onChange={(v) => set('notes', v)} minRows={2} />
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={save}>{busy ? '…' : '✓ Сохранить'}</Btn>
      </MFoot>
    </MCard>
  );
}
