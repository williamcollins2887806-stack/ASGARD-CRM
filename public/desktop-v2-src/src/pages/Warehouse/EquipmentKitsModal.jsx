/**
 * EquipmentKitsModal — полный CRUD комплектов оборудования (kits).
 *
 * Vanilla: equipment.js:685, warehouse-v2-equipment.js:351.
 * Backend (equipment.js:1670-1898):
 *   GET    /api/equipment/kits                — список (items_count/required_count/assigned_count)
 *   GET    /api/equipment/kits/:id            — кит + items[]
 *   POST   /api/equipment/kits                — создать (с items[])
 *   PUT    /api/equipment/kits/:id            — обновить + полностью пересоздать items[]
 *   DELETE /api/equipment/kits/:id            — soft (is_active=false)
 *   POST   /api/equipment/kits/:id/assemble   — назначить equipment_id на kit_items
 *   POST   /api/equipment/work/:workId/assign — массово назначить equipment_ids[] на работу
 *
 * Kit — это набор оборудования (например «Комплект для ТО Х5» = 3 насоса + 5 шлангов).
 * Используется чтобы РП мог одной заявкой запросить весь комплект.
 *
 * 16.06.2026: полный UI вместо textarea-сырца. SelectInput оборудования,
 * чекбокс required/optional, кнопка «🚀 Применить к работе».
 */
import { useState, useEffect } from 'react';
import { useModal, ConfirmModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field, Pill } from '@/modals/parts';
import { TextInput, TextareaInput, SelectInput, NumberInput, Checkbox } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { api } from '@/api/client';
import {
  loadEquipmentKits, createEquipmentKit, updateEquipmentKit,
  deleteEquipmentKit, loadEquipmentKit, loadEquipment, loadWorksList
} from './api';

export function EquipmentKitsModal() {
  const { close, open } = useModal();
  const [kits, setKits] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    loadEquipmentKits().then(setKits).finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  const onCreate = () => {
    open(<KitEditModal onSaved={refresh} />);
  };

  const onEdit = async (kit) => {
    const full = await loadEquipmentKit(kit.id) || kit;
    open(<KitEditModal kit={full} onSaved={refresh} />);
  };

  const onApply = (kit) => {
    open(<KitApplyModal kit={kit} onApplied={refresh} />);
  };

  const onDelete = (kit) => {
    open(<ConfirmModal
      title={'Удалить комплект «' + (kit.name || kit.title) + '»?'}
      message="Само оборудование останется на месте, комплект — будет удалён."
      confirmText="Удалить"
      confirmTone="rejected"
      onConfirm={async () => {
        try {
          await deleteEquipmentKit(kit.id);
          toast.success('Комплект удалён');
          refresh();
        } catch (e) {
          toast.error('Ошибка: ' + (e?.message || e));
        }
      }}
    />);
  };

  return (
    <MCard className="modal-lg">
      <MHead icon="🧰" title="Комплекты оборудования" subtitle={`${kits.length} комплектов`} onClose={close} />
      <MBody>
        <div className="col gap-10">
          <div className="row-spread">
            <div className="c-t3 fs-12">
              Комплект — набор оборудования. РП заказывает одной заявкой.
            </div>
            <Btn variant="primary" onClick={onCreate}>+ Новый комплект</Btn>
          </div>
          {loading ? (
            <div className="c-t3 p-12">Загружаем…</div>
          ) : kits.length === 0 ? (
            <div className="c-t3 p-12">Комплектов нет — создай первый.</div>
          ) : (
            <div className="col gap-6">
              {kits.map((k) => (
                <div key={k.id} className="p-10 bg-inner r-md row-spread">
                  <div className="col gap-2">
                    <strong>{k.icon || '🧰'} {k.name || k.title || ('Комплект #' + k.id)}</strong>
                    {k.description && <div className="c-t3 fs-12">{k.description}</div>}
                    <div className="c-t3 fs-11 row gap-6">
                      <span>Позиций: {k.items_count ?? 0}</span>
                      {k.required_count > 0 && <Pill tone="info">обязат.: {k.required_count}</Pill>}
                      {k.completeness_pct != null && (
                        <Pill tone={k.completeness_pct >= 100 ? 'approved' : k.completeness_pct >= 50 ? 'question' : 'rejected'}>
                          собран {k.completeness_pct}%
                        </Pill>
                      )}
                      {k.work_type && <span>· тип: {k.work_type}</span>}
                    </div>
                  </div>
                  <div className="row gap-4">
                    <Btn size="sm" variant="primary" onClick={() => onApply(k)} title="Применить комплект к работе">🚀 К работе</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => onEdit(k)}>Правка</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => onDelete(k)}>Удалить</Btn>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </MBody>
      <MFoot align="end">
        <Btn onClick={close}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}

/**
 * Форма правки комплекта. Атрибуты + список позиций (equipment_id, qty, is_required).
 * При сохранении PUT/POST пересоздаёт items[] полностью (backend equipment.js:1810).
 */
function KitEditModal({ kit, onSaved }) {
  const { close } = useModal();
  const isEdit = !!kit?.id;
  const [form, setForm] = useState({
    name: kit?.name || kit?.title || '',
    description: kit?.description || '',
    work_type: kit?.work_type || '',
    icon: kit?.icon || '🧰',
  });
  const [items, setItems] = useState(
    (kit?.items || []).map((it) => ({
      equipment_id: it.equipment_id || null,
      item_name: it.item_name || it.equipment_name || '',
      quantity: it.quantity || 1,
      is_required: it.is_required !== false,
      notes: it.notes || '',
    }))
  );
  const [equipmentList, setEquipmentList] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Загружаем все доступное оборудование для SelectInput. Limit 2000 чтобы избежать
    // обрезки больших каталогов.
    loadEquipment({ limit: 2000 }).then(({ equipment }) => setEquipmentList(equipment || []));
  }, []);

  const equipmentOptions = [
    { value: '', label: '— выберите оборудование —' },
    ...equipmentList.map((eq) => ({
      value: String(eq.id),
      label: `${eq.name}${eq.inventory_number ? ' [' + eq.inventory_number + ']' : ''}`
    }))
  ];

  const addItem = () => {
    setItems((arr) => [...arr, { equipment_id: null, item_name: '', quantity: 1, is_required: true, notes: '' }]);
  };

  const removeItem = (idx) => {
    setItems((arr) => arr.filter((_, i) => i !== idx));
  };

  const setItem = (idx, patch) => {
    setItems((arr) => {
      const next = arr.slice();
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };

  const save = async () => {
    if (!form.name?.trim()) return toast.error('Укажите название');
    const validItems = items
      .filter((it) => it.equipment_id || it.item_name?.trim())
      .map((it) => ({
        equipment_id: it.equipment_id ? Number(it.equipment_id) : null,
        item_name: it.item_name?.trim() || null,
        quantity: Number(it.quantity) || 1,
        is_required: it.is_required !== false,
        notes: it.notes?.trim() || null,
      }));
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        work_type: form.work_type.trim() || null,
        icon: form.icon || '🧰',
        items: validItems,
      };
      if (isEdit) await updateEquipmentKit(kit.id, payload);
      else await createEquipmentKit(payload);
      toast.success(isEdit ? 'Комплект обновлён' : 'Комплект создан');
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-lg">
      <MHead icon="🧰" title={isEdit ? 'Правка комплекта' : 'Новый комплект'} onClose={close} />
      <MBody>
        <div className="col gap-10">
          <div className="grid-2 gap-10">
            <Field label="Название комплекта" required>
              <TextInput value={form.name} onChange={(v) => setForm((s) => ({ ...s, name: v }))} placeholder="Комплект для ТО Х5" />
            </Field>
            <Field label="Тип работы">
              <TextInput value={form.work_type} onChange={(v) => setForm((s) => ({ ...s, work_type: v }))} placeholder="механическая чистка / гидродинамика" />
            </Field>
          </div>
          <Field label="Описание">
            <TextareaInput value={form.description} onChange={(v) => setForm((s) => ({ ...s, description: v }))} minRows={2} maxRows={4} />
          </Field>

          <div className="row-spread mt-6">
            <strong>Позиции комплекта ({items.length})</strong>
            <Btn size="sm" variant="ghost" onClick={addItem}>+ Добавить позицию</Btn>
          </div>

          {items.length === 0 ? (
            <div className="c-t3 p-10 fs-12 t-center bg-inner r-md">
              Позиций нет — нажмите «+ Добавить позицию».
            </div>
          ) : (
            <div className="col gap-6">
              {items.map((it, idx) => (
                <div key={idx} className="p-8 bg-inner r-md">
                  <div className="row gap-8" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ flex: '2 1 240px', minWidth: 200 }}>
                      <Field label={'Позиция #' + (idx + 1) + ' — оборудование'}>
                        <SelectInput
                          value={it.equipment_id ? String(it.equipment_id) : ''}
                          onChange={(v) => setItem(idx, { equipment_id: v ? Number(v) : null })}
                          options={equipmentOptions}
                        />
                      </Field>
                    </div>
                    <div style={{ flex: '1 1 140px', minWidth: 120 }}>
                      <Field label="Свободное имя">
                        <TextInput
                          value={it.item_name}
                          onChange={(v) => setItem(idx, { item_name: v })}
                          placeholder="(если без ID)"
                        />
                      </Field>
                    </div>
                    <div style={{ flex: '0 0 90px' }}>
                      <Field label="Кол-во">
                        <NumberInput
                          value={it.quantity}
                          onChange={(v) => setItem(idx, { quantity: v })}
                          min={1}
                        />
                      </Field>
                    </div>
                    <div style={{ flex: '0 0 130px' }}>
                      <Field label="Тип">
                        <Checkbox
                          checked={it.is_required}
                          onChange={(v) => setItem(idx, { is_required: v })}
                          label={it.is_required ? 'Обязательно' : 'Опционально'}
                        />
                      </Field>
                    </div>
                    <Btn size="sm" variant="ghost" onClick={() => removeItem(idx)} title="Убрать позицию">✕</Btn>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={save}>{busy ? 'Сохраняем…' : (isEdit ? 'Сохранить' : 'Создать')}</Btn>
      </MFoot>
    </MCard>
  );
}

/**
 * Применение комплекта к работе.
 *  • SelectInput работы (из /api/works).
 *  • Берём equipment_id из kit.items, POST /api/equipment/work/:workId/assign.
 *  • Бэк проверяет статус каждой единицы (on_warehouse), вернёт errors[] для занятых.
 */
function KitApplyModal({ kit, onApplied }) {
  const { close } = useModal();
  const [workId, setWorkId] = useState('');
  const [works, setWorks] = useState([]);
  const [kitFull, setKitFull] = useState(kit);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadWorksList().then(setWorks).catch(() => setWorks([]));
    // Подтянуть items если их ещё нет.
    if (!kit.items) {
      loadEquipmentKit(kit.id).then((full) => { if (full) setKitFull({ ...kit, items: full.items || [] }); });
    }
  }, [kit?.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  const items = kitFull?.items || [];
  const equipmentIds = items
    .map((it) => it.equipment_id)
    .filter(Boolean);

  const worksOptions = [
    { value: '', label: '— выберите работу —' },
    ...works.map((w) => ({
      value: String(w.id),
      label: '#' + w.id + ' · ' + (w.work_title || w.customer_name || ('Работа ' + w.id))
    }))
  ];

  const apply = async () => {
    if (!workId) return toast.error('Выберите работу');
    if (equipmentIds.length === 0) {
      return toast.error('В комплекте нет привязанных единиц оборудования (kit_items.equipment_id пустые)');
    }
    setBusy(true);
    try {
      const data = await api(`/api/equipment/work/${workId}/assign`, {
        method: 'POST',
        body: { equipment_ids: equipmentIds }
      });
      const assigned = (data?.assigned || []).length;
      const errors = data?.errors || [];
      if (assigned > 0) {
        toast.success(`Назначено: ${assigned}${errors.length ? ' · ' + errors.length + ' с ошибкой' : ''}`);
      }
      if (errors.length > 0) {
        toast.error('Ошибки: ' + errors.slice(0, 3).join('; ') + (errors.length > 3 ? '…' : ''));
      }
      onApplied?.();
      if (assigned > 0) close();
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead icon="🚀" title="Применить комплект к работе" subtitle={kitFull?.name || ''} onClose={close} />
      <MBody>
        <div className="col gap-10">
          <Field label="Работа" required>
            <SelectInput value={workId} onChange={setWorkId} options={worksOptions} />
          </Field>
          <div className="bg-inner r-md p-10">
            <strong>В комплекте {items.length} позиций</strong>
            <div className="c-t3 fs-12 mt-4">
              Будут назначены: {equipmentIds.length} ед. оборудования с привязанным equipment_id.
              {(items.length - equipmentIds.length) > 0 && (
                <span className="c-amber"> · {items.length - equipmentIds.length} без привязки (пропустим)</span>
              )}
            </div>
            {items.length > 0 && (
              <div className="col gap-4 mt-8">
                {items.slice(0, 8).map((it, idx) => (
                  <div key={idx} className="fs-12 c-t2">
                    {it.equipment_id ? '✓ ' : '○ '}
                    {it.equipment_name || it.item_name || ('Позиция ID ' + it.equipment_id)}
                    {it.quantity > 1 && ' × ' + it.quantity}
                    {it.is_required === false && ' (опц.)'}
                  </div>
                ))}
                {items.length > 8 && <div className="fs-11 c-t3">…ещё {items.length - 8}</div>}
              </div>
            )}
          </div>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy || !workId || equipmentIds.length === 0} onClick={apply}>
          {busy ? 'Применяем…' : 'Применить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
