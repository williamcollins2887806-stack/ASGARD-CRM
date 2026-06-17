/**
 * Заявка на ввоз/вывоз ТМЦ — из карточки тендера.
 * Источник: vanilla `public/assets/js/tenders.js → openTmcRequestFromTender (строки 4446..4526)`.
 * Endpoint: POST /api/tmc-requests
 * Поля payload: work_id, title, priority, needed_by, supplier, delivery_address,
 *               items_json (массив позиций), total_sum, notes.
 *
 * Позиции вводятся построчно в формате `наименование|ед.|кол-во|цена`.
 */
import { useState, useMemo } from 'react';
import { api } from '@/api/client';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import {
  Field, TextInput, TextareaInput, SelectInput, DatePicker
} from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';

const PRIORITY_OPTS = [
  { value: 'low',    label: 'Низкий' },
  { value: 'normal', label: 'Обычный' },
  { value: 'high',   label: 'Высокий' },
  { value: 'urgent', label: 'Срочный' }
];

function takeIso(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function parseItems(text) {
  const lines = (text || '').split('\n').map((s) => s.trim()).filter(Boolean);
  return lines.map((line) => {
    const parts = line.split('|');
    const qty = parseFloat(parts[2]) || 0;
    const price = parseFloat(parts[3]) || 0;
    return {
      name: (parts[0] || '').trim(),
      unit: (parts[1] || 'шт.').trim(),
      quantity: qty,
      price,
      total: qty * price
    };
  });
}

function formatMoney(n) {
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

export function TmcRequestModal({ tender }) {
  const { close } = useModal();
  const initialTitle = `ТМЦ — ${tender?.tender_title || tender?.tender_name || ''}`.trim();

  const [title, setTitle] = useState(initialTitle);
  const [priority, setPriority] = useState('normal');
  const [neededBy, setNeededBy] = useState(takeIso(tender?.work_start_plan));
  const [supplier, setSupplier] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [itemsText, setItemsText] = useState('');
  const [notes, setNotes] = useState(tender?.tender_comment_to || '');
  const [busy, setBusy] = useState(false);

  const parsedItems = useMemo(() => parseItems(itemsText), [itemsText]);
  const totalSum = useMemo(() => parsedItems.reduce((s, i) => s + (i.total || 0), 0), [parsedItems]);

  const submit = async () => {
    if (!title.trim()) return toast('Проверка', 'Укажите название заявки', 'warn');
    if (parsedItems.length === 0) return toast('Проверка', 'Добавьте хотя бы одну позицию', 'warn');

    const tenderTag = tender?.id ? `\n[Тендер #${tender.id}: ${tender.tender_title || tender.tender_name || ''}]` : '';

    const body = {
      work_id: tender?.work_id || null,
      title: title.trim(),
      priority,
      needed_by: neededBy || null,
      supplier: supplier.trim(),
      delivery_address: deliveryAddress.trim(),
      items_json: parsedItems,
      total_sum: totalSum,
      notes: (notes || '') + tenderTag
    };

    setBusy(true);
    try {
      await api('/api/tmc-requests', { method: 'POST', body: body });
      toast('Готово', 'Заявка на ТМЦ создана', 'ok');
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-lg">
      <MHead
        icon="📦"
        title="Заявка на ввоз/вывоз ТМЦ"
        subtitle={tender?.id ? `Тендер #${tender.id} · ${tender.customer_name || ''}` : ''}
      />
      <MBody>
        <div className="col gap-14">
          <Field label="Название заявки" required>
            <TextInput value={title} onChange={setTitle} placeholder="Заявка на материалы для…" />
          </Field>

          <div className="grid-2 gap-12">
            <Field label="Приоритет">
              <SelectInput value={priority} onChange={setPriority} options={PRIORITY_OPTS} />
            </Field>
            <Field label="Нужно к дате">
              <DatePicker value={neededBy} onChange={setNeededBy} />
            </Field>
          </div>

          <div className="grid-2 gap-12">
            <Field label="Поставщик">
              <TextInput value={supplier} onChange={setSupplier} placeholder="ООО …" />
            </Field>
            <Field label="Адрес доставки">
              <TextInput value={deliveryAddress} onChange={setDeliveryAddress} placeholder="г. …" />
            </Field>
          </div>

          <Field
            label={`Позиции — формат «наименование|ед.|кол-во|цена», по одной на строку (${parsedItems.length})`}
            help="Пример: Труба 89x6|м.п.|100|1500"
            required
          >
            <TextareaInput
              value={itemsText}
              onChange={setItemsText}
              placeholder={'Труба 89x6|м.п.|100|1500\nЭлектрод ОК 46.00|кг|50|800'}
              minRows={5}
              maxRows={12}
            />
          </Field>

          {parsedItems.length > 0 && (
            <div className="preview-box">
              <div className="preview-box-label">Предпросмотр:</div>
              <table className="preview-table">
                <thead>
                  <tr>
                    <th>Наименование</th>
                    <th>Ед.</th>
                    <th className="t-right">Кол-во</th>
                    <th className="t-right">Цена</th>
                    <th className="t-right">Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedItems.map((it, i) => (
                    <tr key={i}>
                      <td>{it.name || '—'}</td>
                      <td>{it.unit}</td>
                      <td className="t-right">{it.quantity}</td>
                      <td className="t-right">{formatMoney(it.price)}</td>
                      <td className="t-right">{formatMoney(it.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} className="total-label">Итого:</td>
                    <td className="total-cell">{formatMoney(totalSum)} ₽</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <Field label="Примечания">
            <TextareaInput value={notes} onChange={setNotes} minRows={2} maxRows={4} />
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={submit}>
          {busy ? 'Сохраняем…' : '📦 Создать заявку'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

export default TmcRequestModal;
