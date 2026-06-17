/**
 * Модалка сплита позиции — разбить одну закупочную строку на части
 * по разным поставщикам.
 *
 * Сервер требует:
 *   • parts: минимум 2 элемента
 *   • SUM(parts.quantity) == parent.quantity (с точностью 0.001)
 *
 * При успехе родитель помечается как «контейнер» (qty/цена обнуляются),
 * а дети создаются как procurement_items с parent_item_id.
 *
 * Endpoint: POST /api/procurement/:id/items/:itemId/split
 */
import { useState, useEffect, useMemo } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { splitItem, loadSuppliers, money } from '../api';

/** Открыть форму сплита (1:1 с vanilla openSplitForm). */
export function openSplitModal(open, procId, item, onDone) {
  open(<SplitItemModal procId={procId} item={item} onDone={onDone} />);
}
/** Алиас короткого имени (для соответствия vanilla `openSplit`). */
export function SplitModal(props) { return <SplitItemModal {...props} />; }

export function SplitItemModal({ procId, item, onDone }) {
  const { close } = useModal();
  const parentQty = parseFloat(item.quantity) || 0;
  const [suppliers, setSuppliers] = useState([]);
  const [parts, setParts] = useState([
    { id: 1, quantity: '', supplier_id: '', supplier_name: '', unit_price: '', delivery_days: '' },
    { id: 2, quantity: '', supplier_id: '', supplier_name: '', unit_price: '', delivery_days: '' }
  ]);
  const [busy, setBusy] = useState(false);
  const [nextId, setNextId] = useState(3);

  useEffect(() => {
    loadSuppliers().then(setSuppliers).catch(() => setSuppliers([]));
  }, []);

  const sumQty = useMemo(() => parts.reduce((s, p) => s + (parseFloat(p.quantity) || 0), 0), [parts]);
  const matches = Math.abs(sumQty - parentQty) < 0.001;

  const setPart = (id, field, value) => {
    setParts((s) => s.map((p) => p.id === id ? { ...p, [field]: value } : p));
  };
  const onSupplierChange = (id, supId) => {
    const sup = suppliers.find((s) => String(s.id) === String(supId));
    setParts((s) => s.map((p) => p.id === id ? { ...p, supplier_id: supId, supplier_name: sup?.name || '' } : p));
  };
  const addPart = () => {
    setParts((s) => [...s, { id: nextId, quantity: '', supplier_id: '', supplier_name: '', unit_price: '', delivery_days: '' }]);
    setNextId((n) => n + 1);
  };
  const removePart = (id) => {
    setParts((s) => s.length > 2 ? s.filter((p) => p.id !== id) : s);
  };

  const submit = async () => {
    const payload = parts
      .filter((p) => parseFloat(p.quantity) > 0)
      .map((p) => ({
        quantity: parseFloat(p.quantity),
        supplier_id: p.supplier_id ? +p.supplier_id : null,
        supplier_name: p.supplier_name || null,
        unit_price: parseFloat(p.unit_price) || null,
        delivery_days: parseInt(p.delivery_days, 10) || null
      }));
    if (payload.length < 2) { toast.warn('Нужно минимум 2 части'); return; }
    if (Math.abs(payload.reduce((s, p) => s + p.quantity, 0) - parentQty) >= 0.001) {
      toast.error(`Сумма частей должна равняться ${parentQty} ${item.unit}`);
      return;
    }
    setBusy(true);
    try {
      await splitItem(procId, item.id, payload);
      toast.success('Позиция разбита');
      onDone?.();
      close();
    } catch (e) { toast.error(e?.message || 'Ошибка'); setBusy(false); }
  };

  return (
    <MCard>
      <MHead icon="✂️" title="Разбить позицию" subtitle={item.name} accent="gold" onClose={close} />
      <MBody>
        <div className="proc-split-intro">
          Разбить «<b>{item.name}</b>» (всего <b>{parentQty}</b> {item.unit}) между поставщиками.
          Сумма частей должна равняться <b>{parentQty}</b>.
        </div>

        <div className="proc-split-list">
          {parts.map((p) => (
            <div key={p.id} className="proc-split-row">
              <input
                type="number" min="0" step="any" placeholder="кол-во"
                value={p.quantity}
                onChange={(e) => setPart(p.id, 'quantity', e.target.value)}
                className="proc-split-qty"
              />
              <select
                value={p.supplier_id}
                onChange={(e) => onSupplierChange(p.id, e.target.value)}
                className="proc-split-sup-sel"
              >
                <option value="">— поставщик —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <input
                type="number" min="0" step="any" placeholder="цена"
                value={p.unit_price}
                onChange={(e) => setPart(p.id, 'unit_price', e.target.value)}
                className="proc-split-price"
              />
              <input
                type="number" min="0" placeholder="срок,дн"
                value={p.delivery_days}
                onChange={(e) => setPart(p.id, 'delivery_days', e.target.value)}
                className="proc-split-days"
              />
              <button
                className="m-btn ghost proc-split-rmbtn"
                disabled={parts.length <= 2}
                onClick={() => removePart(p.id)}
                title="Удалить часть"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <button className="m-btn ghost proc-split-add" onClick={addPart}>+ Ещё часть</button>

        <div className="proc-split-total">
          Сумма частей:&nbsp;
          <b style={{ color: matches ? 'var(--ok)' : 'var(--err)' }}>{sumQty}</b>
          {' / '}<b>{parentQty}</b>
        </div>
        {parts.some((p) => p.unit_price) && (
          <div className="proc-split-money">
            Итого по ценам: {money(parts.reduce((s, p) => s + (parseFloat(p.quantity) || 0) * (parseFloat(p.unit_price) || 0), 0))}
          </div>
        )}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy || !matches} onClick={submit}>Разбить</Btn>
      </MFoot>
    </MCard>
  );
}
