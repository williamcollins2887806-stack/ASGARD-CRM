import { useState, useEffect, useMemo, useRef } from 'react';
import { useModal, ConfirmModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import {
  loadCart, updateCartItem, removeCartItem, clearCart,
  cartManualSearch, addCartItems, cartPreviewSubmit, submitCart,
  loadWorksList, fmt, money
} from './api';
import { validateFile, MAX_FILE_SIZE } from '@/api/upload';

/**
 * Корзина закупки (drawer справа + предпросмотр + submit).
 * Vanilla: openCartDrawer / _renderDrawer / submitCart / openSubmitPreview / _openManualPanel / _openExcelPanel.
 */
export function CartDrawer({ open, onClose, onChanged }) {
  const modal = useModal();
  const [cart, setCart]   = useState({ id: null, warehouse_id: null, items: [] });
  const [works, setWorks] = useState([]);
  const [busy, setBusy]   = useState(false);
  const [manualOpen, setManualOpen]   = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [previewWork, setPreviewWork] = useState('');
  const [changedItems, setChangedItems] = useState(new Map());

  const reload = () => loadCart().then((d) => {
    setCart({ id: d.cart?.id || null, warehouse_id: d.cart?.warehouse_id || null, items: d.items || [] });
  });

  useEffect(() => {
    if (open) {
      reload();
      loadWorksList().then(setWorks);
    } else {
      setManualOpen(false); setPreviewOpen(false); setChangedItems(new Map());
    }
  }, [open]);

  const splits = useMemo(() => {
    let res = 0, buy = 0;
    for (const it of cart.items) {
      const need = parseFloat(it.need_qty) || 0;
      if (it.item_type === 'equipment') { res += need; continue; }
      if (it.is_new_position) { buy += need; continue; }
      const av = Math.max(0, parseFloat(it.available_qty) || 0);
      const r = Math.min(need, av);
      res += r;
      buy += (need - r);
    }
    return { reserve: res, buy };
  }, [cart.items]);

  const onUpdateQty = async (id, qty) => {
    try {
      const d = await updateCartItem(id, { need_qty: qty });
      setCart({ id: d.cart?.id, warehouse_id: d.cart?.warehouse_id, items: d.items || [] });
      onChanged?.();
    } catch (e) {
      toast.error('Корзина: ' + (e?.message || e));
    }
  };

  const onUpdateWork = async (id, workId) => {
    try {
      await updateCartItem(id, { work_id: workId || null });
      onChanged?.();
    } catch (e) {
      toast.error('Корзина: ' + (e?.message || e));
    }
  };

  const onRemove = async (id) => {
    try {
      const d = await removeCartItem(id);
      setCart({ id: d.cart?.id, warehouse_id: d.cart?.warehouse_id, items: d.items || [] });
      onChanged?.();
    } catch (e) {
      toast.error('Корзина: ' + (e?.message || e));
    }
  };

  const onRefresh = async () => {
    await reload();
    setChangedItems(new Map());
    toast.success('Остатки обновлены');
  };

  const onOpenPreview = async () => {
    try {
      const d = await cartPreviewSubmit();
      setPreviewData(d);
      setPreviewOpen(true);
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
    }
  };

  const onSubmit = async (fromPreview, globalWorkId) => {
    setBusy(true);
    try {
      const res = await submitCart({ global_work_id: globalWorkId || null, confirmed: true });
      if (res.status === 409 && res.data?.error === 'stock_changed') {
        await reload();
        const m = new Map();
        (res.data.changed || []).forEach((ch) => m.set(ch.cart_item_id, ch));
        setChangedItems(m);
        toast.warn('Остатки изменились — проверьте выделенные позиции');
        setPreviewOpen(false);
        return;
      }
      if (res.status === 409 && res.data?.error === 'equipment_taken') {
        toast.error('Оборудование занято: ' + ((res.data.taken || []).join(', ')));
        return;
      }
      if (!res.ok) {
        toast.error('Ошибка: ' + (res.data?.error || 'не удалось отправить'));
        return;
      }
      // успех
      const r = res.data || {};
      toast.success(`Зарезервировано: ${(r.reservations || []).length}${r.procurement_id ? ' · Закупка #' + r.procurement_id : ''}`);
      setPreviewOpen(false);
      setCart({ id: null, warehouse_id: cart.warehouse_id, items: [] });
      onClose?.();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const onClear = () => {
    modal.open(
      <ConfirmModal
        title="Очистить корзину?"
        message={`В корзине ${cart.items.length} позиций. Они будут убраны.`}
        tone="danger"
        okText="Очистить"
        onConfirm={async () => {
          try {
            await clearCart();
            await reload();
            toast.success('Корзина очищена');
            onChanged?.();
          } catch (e) {
            toast.error('Ошибка: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  if (!open) return null;

  return (
    <>
      <div className={'wh-cart-ov wh-cart-ov--open'} onClick={onClose} aria-hidden="true" />
      <aside className={'wh-cart-dr wh-cart-dr--open'} role="dialog" aria-modal="true" aria-label="Корзина закупки">
        <div className="wh-cart-dr__hd">
          <h3>🛒 Корзина закупки</h3>
          <Btn size="sm" variant="ghost" onClick={onRefresh} title="Обновить остатки" aria-label="Обновить остатки">↻</Btn>
          {cart.items.length > 0 && (
            <Btn size="sm" variant="ghost" onClick={onClear} title="Очистить корзину" aria-label="Очистить корзину">🗑</Btn>
          )}
          <Btn size="sm" variant="ghost" onClick={onClose} title="Закрыть" aria-label="Закрыть корзину">✕</Btn>
        </div>

        <div className="wh-cart-dr__body">
          {cart.items.length === 0 ? (
            <div className="wh-empty">
              <div className="wh-empty__ic">🛒</div>
              <div className="wh-empty__ttl">Корзина пуста</div>
              <div className="wh-cart-empty-hint">
                Отметьте позиции кнопкой «+ В корзину» в каталоге или оборудовании.
              </div>
            </div>
          ) : (
            cart.items.map((it) => (
              <CartRow
                key={it.id}
                item={it}
                works={works}
                changed={changedItems.get(it.id)}
                onUpdateQty={onUpdateQty}
                onUpdateWork={onUpdateWork}
                onRemove={onRemove}
              />
            ))
          )}

          {/* Subpanels */}
          <div className="wh-cart-subpanels">
            <Btn size="sm" variant="ghost" onClick={() => setManualOpen((s) => !s)}>
              ＋ Добавить вручную
            </Btn>
            <ExcelImportButton
              warehouseId={cart.warehouse_id}
              onImported={(d) => { setCart({ id: d.cart?.id, warehouse_id: d.cart?.warehouse_id, items: d.items || [] }); }}
            />
          </div>
          {manualOpen && (
            <ManualPanel
              warehouseId={cart.warehouse_id}
              onAdded={(d) => { setCart({ id: d.cart?.id, warehouse_id: d.cart?.warehouse_id, items: d.items || [] }); }}
            />
          )}

          {previewOpen && (
            <PreviewBlock
              data={previewData}
              works={works}
              workValue={previewWork}
              onChangeWork={setPreviewWork}
              onCancel={() => setPreviewOpen(false)}
              onConfirm={() => onSubmit(true, previewWork)}
              busy={busy}
            />
          )}
        </div>

        {cart.items.length > 0 && !previewOpen && (
          <div className="wh-cart-dr__ft">
            <div className="wh-cart-tot">
              <div className="wh-cart-tot__c">
                <div className="wh-cart-tot__v c-t1">{cart.items.length}</div>
                <div className="wh-cart-tot__l">позиций</div>
              </div>
              <div className="wh-cart-tot__c">
                <div className="wh-cart-tot__v c-ok">{fmt(splits.reserve)}</div>
                <div className="wh-cart-tot__l">в резерв</div>
              </div>
              <div className="wh-cart-tot__c">
                <div className="wh-cart-tot__v c-amber">{fmt(splits.buy)}</div>
                <div className="wh-cart-tot__l">в закупку</div>
              </div>
            </div>
            <div className="wh-cart-actions">
              <Btn variant="ghost" onClick={onOpenPreview} style={{ flex: 1 }}>
                👁 Предпросмотр
              </Btn>
              <Btn variant="primary" disabled={busy} onClick={() => onSubmit(false, '')} style={{ flex: 2 }}>
                {busy ? 'Отправка…' : 'Отправить заявку →'}
              </Btn>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

function CartRow({ item, works, changed, onUpdateQty, onUpdateWork, onRemove }) {
  const need = parseFloat(item.need_qty) || 1;
  const avail = item.is_new_position ? null : (parseFloat(item.available_qty) || 0);
  const toBuy = avail == null ? need : Math.max(0, need - avail);
  const isEq = item.item_type === 'equipment';

  return (
    <div className={'wh-cart-it ' + (changed ? 'wh-cart-it--changed' : '')}>
      <div className="wh-cart-it__main">
        <div className="wh-cart-it__nm">
          {item.name}
          {item.is_new_position && <span className="wh-chip wh-chip--draft wh-cart-it__chip-ml">🆕</span>}
          {isEq && <span className="wh-chip wh-chip--ok wh-cart-it__chip-ml">оборудование</span>}
        </div>
        <div className="wh-cart-it__sub">
          {isEq ? 'единица оборудования' : (
            <>На складе: <strong>{avail != null ? fmt(avail) : '—'}</strong> · посл. цена {money(item.is_new_position ? item.manual_price : item.last_price)}</>
          )}
        </div>
        {!isEq && !item.is_new_position && (
          <div className="wh-cart-it__buyhint" style={{ color: toBuy > 0 ? 'var(--amber)' : 'var(--ok)' }}>
            {toBuy > 0 ? '🛒 докупить ' + fmt(toBuy) : '✅ есть в наличии — зарезервируется'}
          </div>
        )}
        <select
          value={item.work_id || ''}
          onChange={(e) => onUpdateWork(item.id, e.target.value)}
          className="m-select wh-cart-it__work"
        >
          <option value="">— без работы —</option>
          {works.map((w) => (
            <option key={w.id} value={w.id}>{w.work_title || ('#' + w.id)}</option>
          ))}
        </select>
        {changed && (
          <div className="wh-cart-it__changed-warn">
            ⚠️ Остаток изменился: было {fmt(changed.snapshot_available)}, сейчас {fmt(changed.new_available)}
          </div>
        )}
      </div>

      {/* Stepper */}
      {isEq ? (
        <span className="wh-stp wh-stp--qty wh-stp--equip">
          <span className="wh-cart-stp-equip-label">1 ед.</span>
        </span>
      ) : (
        <span className="wh-stp wh-stp--qty">
          <button className="wh-stp__b" onClick={() => onUpdateQty(item.id, Math.max(1, need - 1))} title="−">−</button>
          <input
            className="wh-stp__n"
            type="number"
            min="1"
            value={need}
            onChange={(e) => {
              const v = Math.max(1, Math.floor(parseFloat(e.target.value) || 1));
              onUpdateQty(item.id, v);
            }}
          />
          <button className="wh-stp__b" onClick={() => onUpdateQty(item.id, need + 1)} title="+">+</button>
        </span>
      )}

      <button className="wh-cart-x" onClick={() => onRemove(item.id)} title="Убрать">✕</button>
    </div>
  );
}

/**
 * Загрузка Excel с позициями в корзину (vanilla _openExcelPanel).
 * POST /api/warehouse-cart/parse-excel → matched + new positions
 * Затем POST /api/warehouse-cart/items с распознанными позициями.
 */
function ExcelImportButton({ warehouseId, onImported }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // G-5: размер/тип Excel.
    try {
      validateFile(file, { maxSize: MAX_FILE_SIZE, accept: '.xlsx,.xls' });
    } catch (vErr) {
      toast.error(vErr?.message || 'Файл не подходит'); return;
    }
    setBusy(true);
    try {
      const token = localStorage.getItem('asgard_token') || '';
      const form = new FormData();
      form.append('file', file);
      const r = await fetch('/api/warehouse-cart/parse-excel', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: form
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || ('HTTP ' + r.status));
      const rows = d.rows || [];
      if (!rows.length) { toast.warn('В файле не найдено позиций'); return; }
      const items = rows.map((x) => x.matched
        ? { item_type: 'consumable', product_id: x.product_id, need_qty: x.quantity || 1, source: 'excel' }
        : {
            item_type: 'new_position',
            custom_name: x.name,
            need_qty: x.quantity || 1,
            manual_price: x.unit_price,
            supplier_name: x.supplier_name,
            source: 'excel'
          });
      const added = await addCartItems({ warehouse_id: warehouseId, items });
      onImported?.(added);
      toast.success(`Импортировано: ${rows.length} (сопоставлено: ${rows.filter((r) => r.matched).length})`);
    } catch (err) {
      toast.error('Ошибка: ' + (err?.message || err));
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  return (
    <>
      <input
        ref={ref}
        type="file"
        accept=".xlsx,.xls"
        className="wh-cart-hidden-file"
        onChange={onPick}
      />
      <Btn size="sm" variant="ghost" onClick={() => ref.current?.click()} disabled={busy}>
        {busy ? '📎 Загружаю…' : '📎 Excel'}
      </Btn>
    </>
  );
}

function ManualPanel({ warehouseId, onAdded }) {
  const [q, setQ] = useState('');
  const [matches, setMatches] = useState([]);
  const [empty, setEmpty] = useState(false);
  const [newPrice, setNewPrice] = useState('');
  const [newQty, setNewQty]     = useState(1);

  useEffect(() => {
    const v = q.trim();
    if (v.length < 2) { setMatches([]); setEmpty(false); return; }
    const t = setTimeout(async () => {
      try {
        const d = await cartManualSearch(v);
        setMatches(d.matches || []);
        setEmpty(!(d.matches || []).length);
      } catch { /* noop */ }
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  const pickExisting = async (m) => {
    try {
      const d = await addCartItems({
        warehouse_id: warehouseId,
        items: [{ item_type: 'consumable', product_id: m.id, need_qty: 1, source: 'manual' }]
      });
      onAdded?.(d);
      toast.success('Добавлено: ' + m.name);
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
    }
  };

  const addNew = async () => {
    const name = q.trim();
    if (!name) return toast.warn('Введите название');
    try {
      const d = await addCartItems({
        warehouse_id: warehouseId,
        items: [{
          item_type: 'new_position',
          custom_name: name,
          need_qty: parseFloat(newQty) || 1,
          manual_price: newPrice !== '' ? parseFloat(newPrice) : null,
          source: 'manual'
        }]
      });
      onAdded?.(d);
      toast.success('Новая позиция добавлена');
      setQ(''); setNewPrice(''); setNewQty(1); setMatches([]);
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
    }
  };

  return (
    <div className="wh-cart-manual">
      <div className="wh-cart-manual-title">Добавить вручную</div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Название или артикул…"
        className="wh-cart-manual-input"
      />
      {matches.length > 0 && (
        <div className="wh-cart-manual-list">
          {matches.map((m) => (
            <div
              key={m.id}
              onClick={() => pickExisting(m)}
              className="cart-suggestion wh-cart-manual-row"
            >
              <div className="wh-cart-manual-row-main">
                <strong>{m.name}</strong>
                {m.article && <span className="wh-cart-manual-row-art">{m.article}</span>}
                <div className="wh-cart-manual-row-sub">
                  на складе {fmt(m.available_qty)} · {money(m.last_price)}
                </div>
              </div>
              <span className="wh-eq-act wh-eq-act--issue">+</span>
            </div>
          ))}
        </div>
      )}
      {empty && (
        <div className="wh-cart-manual-add">
          <div className="wh-cart-manual-tip">
            Такого в каталоге нет — добавим как новую позицию.
          </div>
          <div className="wh-cart-manual-newrow">
            <input
              type="number"
              min="0"
              placeholder="Цена ₽"
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              className="wh-cart-manual-price"
            />
            <input
              type="number"
              min="1"
              value={newQty}
              onChange={(e) => setNewQty(e.target.value)}
              className="wh-cart-manual-qty"
            />
            <Btn size="sm" variant="primary" onClick={addNew}>Добавить новую</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewBlock({ data, works, workValue, onChangeWork, onCancel, onConfirm, busy }) {
  if (!data) return null;
  const section = (title, rows, render) => {
    if (!rows || !rows.length) return null;
    return (
      <div className="wh-cart-preview-section">
        <div className="wh-cart-preview-section-title">{title}</div>
        <table className="wh-table">
          <tbody>{rows.map(render)}</tbody>
        </table>
      </div>
    );
  };
  return (
    <div className="wh-cart-preview">
      <div className="wh-cart-preview-title">👁 Предпросмотр разбивки</div>
      {section('🔒 Зарезервируется со склада', data.reserve_lines, (l, i) => (
        <tr key={'r' + i}>
          <td><strong>{l.name}</strong></td>
          <td className="t-right">{fmt(l.reserve_qty)} {l.unit || 'шт'}</td>
        </tr>
      ))}
      {section('🛍️ Уйдёт в закупку (дефицит)', data.procure_lines, (l, i) => (
        <tr key={'p' + i}>
          <td>
            <strong>{l.name}</strong>
            {l.is_new_position && <span className="wh-chip wh-chip--draft wh-cart-it__chip-ml">🆕</span>}
          </td>
          <td className="t-right">{fmt(l.deficit_qty)} {l.unit || 'шт'}</td>
          <td className="t-right">{money(l.last_price)}</td>
        </tr>
      ))}
      {section('🔧 Оборудование (резерв)', data.equipment_lines, (l, i) => (
        <tr key={'e' + i}>
          <td><strong>{l.name}</strong></td>
          <td className="t-right">{l.available > 0 ? 'на складе' : 'занято/нет'}</td>
        </tr>
      ))}
      {(!data.reserve_lines?.length && !data.procure_lines?.length && !data.equipment_lines?.length) && (
        <div className="wh-empty"><div className="wh-empty__ic">📭</div>Нечего отправлять</div>
      )}
      <div className="wh-cart-preview-work">
        <label className="wh-cart-preview-work-label">Привязать все резервы к работе (опц.):</label>
        <select
          value={workValue}
          onChange={(e) => onChangeWork(e.target.value)}
          className="m-select wh-cart-preview-work-select"
        >
          <option value="">— без привязки —</option>
          {works.map((w) => (
            <option key={w.id} value={w.id}>{w.work_title || ('#' + w.id)}</option>
          ))}
        </select>
      </div>
      <div className="row-end gap-8">
        <Btn variant="ghost" onClick={onCancel}>← Назад</Btn>
        <Btn variant="primary" disabled={busy} onClick={onConfirm}>
          {busy ? 'Отправка…' : '✓ Подтвердить и отправить'}
        </Btn>
      </div>
    </div>
  );
}
