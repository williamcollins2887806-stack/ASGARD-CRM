import { useState, useEffect, useRef } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field, Input, Textarea, Select } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import {
  loadEquipmentCategories, loadObjects, loadWarehouses,
  createEquipmentForm, updateEquipment, CONDITION_META,
  uploadEquipmentPhoto, setEquipmentIcon
} from './api';
import { EquipmentPhotoPanel } from './EquipmentPhotoPanel';

/** Создание/редактирование единицы оборудования (vanilla openForm + старая openEquipmentForm). */
export function EquipmentFormModal({ eq, onSaved }) {
  const { close } = useModal();
  const isEdit = !!eq?.id;

  const [cats, setCats] = useState([]);
  const [_whs, setWhs]   = useState([]);
  const [_objs, setObjs] = useState([]);
  const [data, setData] = useState({
    name:              eq?.name || '',
    category_id:       eq?.category_id ? String(eq.category_id) : '',
    inventory_number:  eq?.inventory_number || '',
    serial_number:     eq?.serial_number || '',
    barcode:           eq?.barcode || '',
    brand:             eq?.brand || '',
    model:             eq?.model || '',
    quantity:          eq?.quantity || 1,
    unit:              eq?.unit || 'шт',
    purchase_price:    eq?.purchase_price || '',
    purchase_date:     eq?.purchase_date ? eq.purchase_date.slice(0, 10) : new Date().toISOString().slice(0, 10),
    useful_life_months: eq?.useful_life_months || 60,
    salvage_value:     eq?.salvage_value || 0,
    auto_write_off:    eq?.auto_write_off !== false,
    warranty_end:      eq?.warranty_end ? eq.warranty_end.slice(0, 10) : '',
    maintenance_interval_days: eq?.maintenance_interval_days || '',
    condition:         eq?.condition || 'good',
    notes:             eq?.notes || ''
  });
  const [saving, setSaving] = useState(false);

  // Photo / icon — отдельный стейт. При редактировании панель сохраняет сразу на сервер.
  // При создании — файл/иконка копятся в pending и отправляются после успешного POST.
  const pendingPhotoRef = useRef({
    photo_url: eq?.photo_url || '',
    custom_icon: eq?.custom_icon || '',
    pending_file: null
  });
  const [photoState, setPhotoState] = useState(pendingPhotoRef.current);

  useEffect(() => {
    Promise.all([
      loadEquipmentCategories(),
      loadWarehouses(),
      loadObjects()
    ]).then(([c, w, o]) => { setCats(c); setWhs(w); setObjs(o); });
  }, []);

  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));

  const handlePhotoChange = (next) => {
    pendingPhotoRef.current = next;
    setPhotoState(next);
  };

  const submit = async () => {
    if (!data.name.trim()) return toast.warn('Укажите наименование');
    const payload = {
      name: data.name.trim(),
      category_id:      data.category_id      || null,
      inventory_number: data.inventory_number || null,
      serial_number:    data.serial_number    || null,
      barcode:          data.barcode          || null,
      brand:            data.brand            || null,
      model:            data.model            || null,
      quantity:         parseFloat(data.quantity) || 1,
      unit:             data.unit             || 'шт',
      purchase_price:   data.purchase_price !== '' ? parseFloat(data.purchase_price) : null,
      purchase_date:    data.purchase_date    || null,
      useful_life_months: parseInt(data.useful_life_months, 10) || 60,
      salvage_value:    parseFloat(data.salvage_value) || 0,
      auto_write_off:   !!data.auto_write_off,
      warranty_end:     data.warranty_end     || null,
      maintenance_interval_days: data.maintenance_interval_days
        ? parseInt(data.maintenance_interval_days, 10)
        : null,
      notes:            data.notes            || null
    };
    if (isEdit) payload.condition = data.condition || null;

    // Photo / icon в payload создания: при isEdit панель уже сохраняет на сервер сама,
    // дублировать в PUT не нужно (PUT поддерживает custom_icon через COALESCE, но
    // photo_url НЕ обновляется в PUT — только через /photo endpoint).
    if (!isEdit) {
      const ps = pendingPhotoRef.current;
      if (ps.custom_icon) payload.custom_icon = ps.custom_icon;
    }

    setSaving(true);
    try {
      let savedId = eq?.id;
      if (isEdit) {
        await updateEquipment(eq.id, payload);
      } else {
        const res = await createEquipmentForm(payload);
        savedId = res?.equipment?.id || res?.id;
      }

      // После создания — если есть pending файл, загружаем его.
      // (Иконка уже сохранена в payload.custom_icon.)
      if (!isEdit && savedId && pendingPhotoRef.current.pending_file) {
        try {
          await uploadEquipmentPhoto(savedId, pendingPhotoRef.current.pending_file);
        } catch (photoErr) {
          // Создание удалось, но фото — нет. Не падаем, предупреждаем.
          toast.warn('Оборудование создано, но фото не загрузилось: ' + (photoErr?.message || photoErr));
        }
      }

      toast.success(isEdit ? 'Оборудование обновлено' : 'Оборудование добавлено');
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
        icon={isEdit ? '✎' : '🛠️'}
        title={isEdit ? 'Редактирование ТМЦ' : 'Новое оборудование'}
        accent="info"
        onClose={close}
      />
      <MBody>
        <Field label="Наименование" required>
          <Input value={data.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </Field>

        <Field label="Фото / Иконка" help={isEdit ? 'Сохраняется сразу при загрузке.' : 'Сохранится после создания.'}>
          <EquipmentPhotoPanel
            eqId={isEdit ? eq.id : 0}
            photoUrl={photoState.photo_url}
            customIcon={photoState.custom_icon}
            onChange={handlePhotoChange}
            compact
          />
        </Field>

        <div className="m-grid-2">
          <Field label="Категория">
            <Select value={data.category_id} onChange={(e) => set('category_id', e.target.value)}>
              <option value="">— без категории —</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{(c.icon || '') + ' ' + c.name}</option>)}
            </Select>
          </Field>
          <Field label="Инв. №">
            <Input value={data.inventory_number} onChange={(e) => set('inventory_number', e.target.value)} placeholder="авто-генерация если пусто" />
          </Field>
        </div>

        <div className="m-grid-2">
          <Field label="Серийный №">
            <Input value={data.serial_number} onChange={(e) => set('serial_number', e.target.value)} />
          </Field>
          <Field label="Штрихкод">
            <Input value={data.barcode} onChange={(e) => set('barcode', e.target.value)} />
          </Field>
        </div>

        <div className="m-grid-2">
          <Field label="Бренд">
            <Input value={data.brand} onChange={(e) => set('brand', e.target.value)} />
          </Field>
          <Field label="Модель">
            <Input value={data.model} onChange={(e) => set('model', e.target.value)} />
          </Field>
        </div>

        <div className="m-grid-2">
          <Field label="Количество">
            <Input type="number" step="0.001" value={data.quantity} onChange={(e) => set('quantity', e.target.value)} />
          </Field>
          <Field label="Ед. изм.">
            <Input value={data.unit} onChange={(e) => set('unit', e.target.value)} />
          </Field>
        </div>

        <div className="m-grid-2">
          <Field label="Цена закупки (₽)">
            <Input type="number" step="0.01" value={data.purchase_price} onChange={(e) => set('purchase_price', e.target.value)} />
          </Field>
          <Field label="Дата закупки">
            <Input type="date" value={data.purchase_date} onChange={(e) => set('purchase_date', e.target.value)} />
          </Field>
        </div>

        <div className="m-grid-2">
          <Field label="Срок полезного использования (мес.)" help="Для амортизации">
            <Input type="number" value={data.useful_life_months} onChange={(e) => set('useful_life_months', e.target.value)} />
          </Field>
          <Field label="Ликвидационная стоимость (₽)" help="Остаток после полной амортизации">
            <Input type="number" step="0.01" value={data.salvage_value} onChange={(e) => set('salvage_value', e.target.value)} />
          </Field>
        </div>

        <Field>
          <label className="row gap-8 fs-13 c-t2">
            <input type="checkbox" checked={!!data.auto_write_off} onChange={(e) => set('auto_write_off', e.target.checked)} />
            <span>Автоматическое списание по истечении срока</span>
          </label>
        </Field>

        <div className="m-grid-2">
          <Field label="Гарантия до">
            <Input type="date" value={data.warranty_end} onChange={(e) => set('warranty_end', e.target.value)} />
          </Field>
          <Field label="Интервал ТО (дней)">
            <Input type="number" value={data.maintenance_interval_days} onChange={(e) => set('maintenance_interval_days', e.target.value)} />
          </Field>
        </div>

        {isEdit && (
          <Field label="Состояние">
            <Select value={data.condition} onChange={(e) => set('condition', e.target.value)}>
              {Object.entries(CONDITION_META).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Примечания">
          <Textarea rows={2} value={data.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={saving} onClick={submit}>
          {saving ? 'Сохраняем…' : (isEdit ? 'Сохранить' : 'Добавить')}
        </Btn>
      </MFoot>
    </MCard>
  );
}
