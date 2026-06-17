import { useState, useEffect, useMemo } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field, Input, Select } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import {
  loadProducts, loadLocations,
  stockReceipt, stockIssue, stockTransfer, stockWriteoff
} from './api';

const TITLES = {
  receipt:  { title: 'Приход',       icon: '📥', accent: 'success' },
  issue:    { title: 'Расход',       icon: '📤', accent: 'info'    },
  transfer: { title: 'Перемещение',  icon: '🔄', accent: 'warn'    },
  writeoff: { title: 'Списание',     icon: '🗑️', accent: 'danger'  }
};

/**
 * Операция со складом — vanilla openStockOp.
 * op: 'receipt' | 'issue' | 'transfer' | 'writeoff'
 */
export function StockOpModal({ op, onSaved }) {
  const { close } = useModal();
  const meta = TITLES[op] || TITLES.receipt;
  const isTransfer = op === 'transfer';
  const isWriteoff = op === 'writeoff';

  const [products, setProducts] = useState([]);
  const [locs, setLocs] = useState([]);
  const [data, setData] = useState({
    product_id: '',
    qty: '',
    unit: 'шт',
    location_id: '',
    from_location_id: '',
    to_location_id: '',
    reason: ''
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      loadProducts().catch(() => []),
      loadLocations(500).catch(() => [])
    ]).then(([p, l]) => { setProducts(p); setLocs(l); });
  }, []);

  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));

  const onProductChange = (id) => {
    const p = products.find((x) => String(x.id) === String(id));
    setData((d) => ({ ...d, product_id: id, unit: p?.unit || d.unit }));
  };

  const productOpts = useMemo(() => products.map((p) => ({
    value: String(p.id),
    label: `${p.name}${p.article ? ' (' + p.article + ')' : ''}`,
    unit: p.unit
  })), [products]);

  const locOpts = useMemo(() => [
    { value: '', label: '— без ячейки —' },
    ...locs.map((l) => ({ value: String(l.id), label: `${l.label || l.zone} · ${l.warehouse_name || ''}` }))
  ], [locs]);

  const submit = async () => {
    const pid = Number(data.product_id);
    const qty = Number(data.qty);
    if (!pid)            return toast.warn('Выберите позицию');
    if (!qty || qty <= 0) return toast.warn('Укажите количество');
    if (isWriteoff && !data.reason.trim()) return toast.warn('Укажите причину списания');

    const body = { product_id: pid, qty, unit: data.unit || 'шт', reason: data.reason || '' };
    if (isTransfer) {
      body.from_location_id = data.from_location_id || null;
      body.to_location_id = data.to_location_id || null;
    } else {
      body.location_id = data.location_id || null;
    }
    setSaving(true);
    try {
      if (op === 'receipt')  await stockReceipt(body);
      else if (op === 'issue')    await stockIssue(body);
      else if (op === 'transfer') await stockTransfer(body);
      else                        await stockWriteoff(body);
      toast.success(meta.title + ' выполнен');
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
      <MHead icon={meta.icon} title={meta.title} accent={meta.accent} onClose={close} />
      <MBody>
        <Field label="Позиция" required>
          <Select value={data.product_id} onChange={(e) => onProductChange(e.target.value)}>
            <option value="">— выберите позицию —</option>
            {productOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>

        <div className="m-grid-2">
          <Field label="Количество" required>
            <Input type="number" min="0" step="any" value={data.qty} onChange={(e) => set('qty', e.target.value)} />
          </Field>
          <Field label="Ед. изм.">
            <Input value={data.unit} onChange={(e) => set('unit', e.target.value)} placeholder="шт" />
          </Field>
        </div>

        {isTransfer ? (
          <div className="m-grid-2">
            <Field label="Откуда (ячейка)">
              <Select value={data.from_location_id} onChange={(e) => set('from_location_id', e.target.value)}>
                {locOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </Field>
            <Field label="Куда (ячейка)">
              <Select value={data.to_location_id} onChange={(e) => set('to_location_id', e.target.value)}>
                {locOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </Field>
          </div>
        ) : (
          <Field label="Ячейка">
            <Select value={data.location_id} onChange={(e) => set('location_id', e.target.value)}>
              {locOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
        )}

        <Field label={isWriteoff ? 'Причина списания' : 'Комментарий'} required={isWriteoff}>
          <Input
            value={data.reason}
            onChange={(e) => set('reason', e.target.value)}
            placeholder={isWriteoff ? 'Сломано / истёк срок / списано по акту' : 'Необязательно'}
          />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={saving} onClick={submit}>
          {saving ? 'Сохраняем…' : 'Применить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
