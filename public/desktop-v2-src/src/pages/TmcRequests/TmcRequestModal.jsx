/**
 * Модалка создания/редактирования заявки на ТМЦ.
 * Источник: vanilla `tmc-requests-page.js` → openForm.
 *
 * Заявка содержит набор позиций (наименование, ед., кол-во, цена).
 * Авто-расчёт суммы.
 */
import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, NumberInput, MoneyInput, SelectInput, DatePicker, TextareaInput, Combobox } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { ConfirmModal } from '@/modals';
import {
  loadDetail, createRequest, updateRequest, setStatus, PRIORITIES,
  loadWorks, fmtMoney, emitChanged
} from './api';

function parseItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v : [];
  } catch (_) {
    return [];
  }
}

const EMPTY_ITEM = { name: '', unit: 'шт.', quantity: 1, price: 0 };

export function TmcRequestModal({ id, onSaved }) {
  const { close, open } = useModal();
  const [data, setData] = useState(null);
  const [works, setWorks] = useState([]);
  const [busy, setBusy] = useState(false);
  const isEdit = !!id;

  const [form, setForm] = useState({
    title: '', work_id: '', priority: 'normal',
    needed_by: '', supplier: '', delivery_address: '', notes: '',
    items: [{ ...EMPTY_ITEM }]
  });

  useEffect(() => {
    loadWorks()
      .then((items) => setWorks(items.map((w) => ({ value: w.id, label: '#' + w.id + ' ' + (w.work_title || w.tender_title || '—') }))))
      .catch(() => setWorks([]));
  }, []);

  useEffect(() => {
    if (!id) return;
    loadDetail(id)
      .then((it) => {
        setData(it);
        const items = parseItems(it.items_json || it.items);
        setForm({
          title: it.title || '',
          work_id: it.work_id || '',
          priority: it.priority || 'normal',
          needed_by: (it.needed_by || '').slice(0, 10),
          supplier: it.supplier || '',
          delivery_address: it.delivery_address || '',
          notes: it.notes || '',
          items: items.length ? items : [{ ...EMPTY_ITEM }]
        });
      })
      .catch((e) => toast.error('Не удалось загрузить: ' + (e?.message || e)));
  }, [id]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setItem = (idx, k, v) => setForm((f) => {
    const items = f.items.slice();
    items[idx] = { ...items[idx], [k]: v };
    return { ...f, items };
  });
  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, { ...EMPTY_ITEM }] }));
  const delItem = (idx) => setForm((f) => {
    const items = f.items.filter((_, i) => i !== idx);
    return { ...f, items: items.length ? items : [{ ...EMPTY_ITEM }] };
  });

  const total = form.items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.price) || 0), 0);
  const itemsClean = form.items
    .filter((it) => (it.name || '').trim() !== '')
    .map((it) => ({
      name: it.name.trim(),
      unit: (it.unit || 'шт.').trim(),
      quantity: Number(it.quantity) || 0,
      price: Number(it.price) || 0,
      total: (Number(it.quantity) || 0) * (Number(it.price) || 0)
    }));

  const isEditable = !isEdit || (data && ['draft', 'submitted'].includes(data.status));

  const save = async () => {
    if (!form.title.trim()) return toast.warn('Укажите название заявки');
    if (!itemsClean.length) return toast.warn('Добавьте хотя бы одну позицию');
    setBusy(true);
    try {
      const body = {
        title:            form.title.trim(),
        work_id:          form.work_id ? Number(form.work_id) : null,
        priority:         form.priority,
        needed_by:        form.needed_by || null,
        supplier:         form.supplier || null,
        delivery_address: form.delivery_address || null,
        notes:            form.notes || null,
        items_json:       itemsClean,
        items:            itemsClean,
        total_sum:        total
      };
      if (isEdit) {
        await updateRequest(id, body);
        toast.success('Заявка обновлена');
      } else {
        await createRequest(body);
        toast.success('Заявка создана');
      }
      emitChanged();
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
      setBusy(false);
    }
  };

  const onSubmit = () => {
    if (!isEdit) return;
    open(
      <ConfirmModal
        tone="success"
        title="Подать заявку?"
        message="Заявка уйдёт на согласование директорам / бухгалтерии."
        confirmLabel="Подать"
        onConfirm={async () => {
          try {
            await setStatus(id, 'submitted');
            toast.success('Заявка подана');
            emitChanged();
            onSaved?.();
            close();
          } catch (e) {
            toast.error('Не удалось: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  return (
    <MCard className="modal-xl">
      <MHead
        icon="📦"
        title={isEdit ? 'Заявка ТМЦ #' + id : 'Новая заявка на ТМЦ'}
        subtitle={isEdit && data?.status ? `Статус: ${data.status}` : 'Товарно-материальные ценности'}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="col gap-14">
          <Field label="Название" required>
            <TextInput
              value={form.title}
              onChange={(v) => set('title', v)}
              placeholder="Заявка на материалы для…"
              disabled={!isEditable}
            />
          </Field>

          <div className="grid-2 gap-10">
            <Field label="Проект (работа)">
              <Combobox
                options={works}
                value={form.work_id}
                onChange={(v) => set('work_id', v)}
                placeholder="Выберите работу"
              />
            </Field>
            <Field label="Приоритет">
              <SelectInput
                value={form.priority}
                onChange={(v) => set('priority', v)}
                options={PRIORITIES.map((p) => ({ value: p.value, label: p.label }))}
              />
            </Field>
          </div>

          <div className="grid-2 gap-10">
            <Field label="Нужно к дате">
              <DatePicker value={form.needed_by} onChange={(v) => set('needed_by', v)} />
            </Field>
            <Field label="Предполагаемый поставщик">
              <TextInput value={form.supplier} onChange={(v) => set('supplier', v)} disabled={!isEditable} />
            </Field>
          </div>

          <Field label="Адрес доставки">
            <TextInput value={form.delivery_address} onChange={(v) => set('delivery_address', v)} disabled={!isEditable} />
          </Field>

          {/* Позиции */}
          <div>
            <div className="row-spread mb-10">
              <div className="fw-600 fs-14">Позиции ({itemsClean.length})</div>
              {isEditable && <Btn size="sm" onClick={addItem}>+ Позиция</Btn>}
            </div>
            <div className="card card-pad-overflow">
              <div className="ov-x-auto">
                <table className="sup-table">
                  <thead>
                    <tr>
                      <th>Наименование</th>
                      <th className="w-80">Ед.</th>
                      <th className="w-100">Кол-во</th>
                      <th className="w-130">Цена</th>
                      <th className="w-130">Сумма</th>
                      {isEditable && <th className="w-60"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {form.items.map((it, idx) => (
                      <tr key={idx}>
                        <td>
                          <TextInput
                            value={it.name}
                            onChange={(v) => setItem(idx, 'name', v)}
                            placeholder="Труба, Электрод…"
                            disabled={!isEditable}
                          />
                        </td>
                        <td>
                          <TextInput value={it.unit} onChange={(v) => setItem(idx, 'unit', v)} disabled={!isEditable} />
                        </td>
                        <td>
                          <NumberInput value={it.quantity} onChange={(v) => setItem(idx, 'quantity', v)} min={0} step={0.01} disabled={!isEditable} />
                        </td>
                        <td>
                          <MoneyInput value={it.price} onChange={(v) => setItem(idx, 'price', v)} disabled={!isEditable} />
                        </td>
                        <td className="fw-600">
                          {fmtMoney((Number(it.quantity) || 0) * (Number(it.price) || 0))}
                        </td>
                        {isEditable && (
                          <td>
                            <Btn size="sm" variant="ghost" onClick={() => delItem(idx)}>✕</Btn>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div style={{ textAlign: 'right', marginTop: 10, fontSize: 14 }}>
              Итого: <strong className="fs-16 c-gold">{fmtMoney(total)}</strong>
            </div>
          </div>

          <Field label="Примечания">
            <TextareaInput value={form.notes} onChange={(v) => set('notes', v)} minRows={2} disabled={!isEditable} />
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <div className="u-flex gap-8">
          {isEditable && (
            <Btn variant="primary" disabled={busy} onClick={save}>
              {busy ? '…' : isEdit ? '💾 Сохранить' : '➕ Создать'}
            </Btn>
          )}
          {isEdit && data && ['draft', 'rework'].includes(data.status) && (
            <Btn variant="primary" disabled={busy} onClick={onSubmit}>📨 Подать</Btn>
          )}
        </div>
      </MFoot>
    </MCard>
  );
}
