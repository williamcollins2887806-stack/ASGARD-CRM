import { useState, useEffect, useMemo } from 'react';
import { useModal } from '@/modals';
import { Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import {
  loadProducts, loadStock, loadProductAvailability,
  removeCartItem, updateCartItem,
  canUseCart, isAdmin, fmt, categoryIcon
} from './api';
import { StockOpModal } from './StockOpModal';
import { QuickProductModal } from './QuickProductModal';
import { ProductDetailModal } from './ProductDetailModal';
import { CatalogImportModal } from './CatalogImportModal';
import { GoodsIcon } from '@/components/GoodsIcon';

/**
 * Вкладка «Расходники» (vanilla renderConsumables → renderCatalog/renderStock).
 * Каталог карточек + переключатель «Таблицей» (наличие) + 4 операции склада.
 */
export function ConsumablesTab({ search, user, cart, onAdd, onRefreshCart, onChanged }) {
  const modal = useModal();
  const [tableMode, setTableMode]   = useState(false);
  const [products, setProducts]     = useState([]);
  const [stock, setStock]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [availabilities, setAvails] = useState({});

  const admin = isAdmin(user?.role);
  const cartEnabled = canUseCart(user?.role);

  const refresh = () => {
    setLoading(true);
    if (tableMode) {
      loadStock(search).then(setStock).finally(() => setLoading(false));
    } else {
      loadProducts(search).then(setProducts).finally(() => setLoading(false));
    }
  };

  useEffect(refresh, [search, tableMode]);

  // Lazy availability load
  useEffect(() => {
    if (tableMode || !products.length) return;
    let cancelled = false;
    Promise.all(products.slice(0, 50).map(async (p) => {
      try {
        const a = await loadProductAvailability(p.id);
        return [p.id, a];
      } catch { return [p.id, { total: 0, slots: [] }]; }
    })).then((pairs) => {
      if (cancelled) return;
      setAvails(Object.fromEntries(pairs));
    });
    return () => { cancelled = true; };
  }, [products, tableMode]);

  const cartItemFor = useMemo(() => {
    const m = new Map();
    for (const it of cart?.items || []) {
      if (it.product_id) m.set(it.product_id, it);
    }
    return m;
  }, [cart]);

  const handleOp = (op) => {
    modal.open(<StockOpModal op={op} onSaved={() => { refresh(); onChanged?.(); }} />);
  };

  const handleQuickAdd = () => {
    modal.open(<QuickProductModal onSaved={() => { refresh(); onChanged?.(); }} />);
  };

  const openProductDetail = (pid) => {
    modal.open(<ProductDetailModal productId={pid} onChanged={() => { refresh(); onChanged?.(); }} />);
  };

  return (
    <div>
      <div className="row gap-8 mb-14 u-wrap">
        <Btn size="sm" variant="ghost" onClick={() => modal.open(<CatalogImportModal onSaved={() => { refresh(); onChanged?.(); }} />)}>
          📄 Загрузить накладную/счёт
        </Btn>
        {admin && (
          <>
            <Btn size="sm" variant="ghost" onClick={() => handleOp('receipt')}>📥 Приход</Btn>
            <Btn size="sm" variant="ghost" onClick={() => handleOp('issue')}>📤 Расход</Btn>
            <Btn size="sm" variant="ghost" onClick={() => handleOp('transfer')}>🔄 Перемещение</Btn>
            <Btn size="sm" variant="ghost" onClick={() => handleOp('writeoff')}>🗑️ Списание</Btn>
          </>
        )}
        <Btn size="sm" variant="primary" onClick={handleQuickAdd}>➕ Позиция</Btn>
        <span className="flex-1" />
        <Btn size="sm" variant="ghost" onClick={() => setTableMode((s) => !s)}>
          {tableMode ? '▦ Карточки' : '☰ Таблицей'}
        </Btn>
      </div>

      {cartEnabled && !tableMode && (
        <div className="fs-12 c-t3 mb-10">
          Жмите «+ В корзину» на позициях → корзина 🛒 в углу справа-снизу → отправьте одной заявкой
          (наличие зарезервируется, дефицит уйдёт в закупку).
        </div>
      )}

      {loading ? (
        <div className="wh-loading">⏳ Загрузка…</div>
      ) : tableMode ? (
        stock.length === 0 ? (
          <div className="wh-empty">
            <div className="wh-empty__ic">📦</div>
            <div className="wh-empty__ttl">{search ? 'Ничего не нашли' : 'Нет остатков'}</div>
            <div>{search ? 'Измените запрос' : 'Оприходуйте расходники через «📥 Приход».'}</div>
          </div>
        ) : (
          <StockTable
            rows={stock}
            cartItemFor={cartItemFor}
            cartEnabled={cartEnabled}
            cart={cart}
            onAdd={onAdd}
            onRefreshCart={onRefreshCart}
          />
        )
      ) : (
        products.length === 0 ? (
          <div className="wh-empty">
            <div className="wh-empty__ic">📭</div>
            <div className="wh-empty__ttl">{search ? 'Ничего не нашли' : 'Каталог расходников пуст'}</div>
            <div>{search ? `По запросу «${search}» позиций нет` : 'Загрузите накладную/счёт или добавьте позиции вручную.'}</div>
          </div>
        ) : (
          <CatalogCards
            products={products}
            availabilities={availabilities}
            cartItemFor={cartItemFor}
            cartEnabled={cartEnabled}
            cart={cart}
            onAdd={onAdd}
            onRefreshCart={onRefreshCart}
            onOpen={openProductDetail}
          />
        )
      )}
    </div>
  );
}

function CatalogCards({ products, availabilities, cartItemFor, cartEnabled, cart, onAdd, onRefreshCart, onOpen }) {
  return (
    <div className="wh-cards">
      {products.map((p) => {
        const a = availabilities[p.id];
        const inCart = cartItemFor.get(p.id);
        return (
          <div
            key={p.id}
            className="wh-card"
            onClick={() => onOpen?.(p.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(p.id); } }}
            role="button"
            tabIndex={0}
            aria-label={`Расходник: ${p.name}`}
          >
            <div className="wh-card__top">
              {(p.icon_path || p.icon_slug)
                ? (
                  <div className="wh-card__ic" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <GoodsIcon
                      slug={p.icon_slug}
                      path={p.icon_path}
                      size={36}
                      alt={p.name}
                      fallback={<span>{categoryIcon(p.category_name)}</span>}
                    />
                  </div>
                )
                : <div className="wh-card__ic">{categoryIcon(p.category_name)}</div>}
              <div className="flex-1">
                <div className="wh-card__nm">{p.name}</div>
                <div className="wh-card__sub">
                  {p.category_name || 'Без категории'}
                  {p.article && ` • ${p.article}`}
                </div>
              </div>
              {p.is_draft && <span className="wh-chip wh-chip--draft">черновик</span>}
            </div>
            <div className="wh-card__chips">
              {p.is_consumable
                ? <span className="wh-chip wh-chip--cons">расходник</span>
                : <span className="wh-chip wh-chip--ok">учётная ед.</span>}
              {p.ean && <span style={{ fontSize: 11, opacity: 0.6 }}>EAN {p.ean}</span>}
            </div>
            <div className="wh-card__avail">
              {a == null ? (
                <span className="wh-card__sub">наличие…</span>
              ) : (
                <>
                  <span className={'wh-avail-n' + (a.total ? '' : ' wh-avail-n--zero')}>{fmt(a.total)}</span>
                  <span className="wh-card__sub">
                    {a.total ? (a.slots?.[0] ? (a.slots[0].location_label || a.slots[0].warehouse_name || '') : '') : 'нет на складе'}
                  </span>
                </>
              )}
              {cartEnabled && (
                <Stepper
                  pid={p.id}
                  item={inCart}
                  cart={cart}
                  onAdd={onAdd}
                  onRefreshCart={onRefreshCart}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StockTable({ rows, cartItemFor, cartEnabled, cart, onAdd, onRefreshCart }) {
  return (
    <div className="wh-table-wrap">
      <div className="ov-x-auto">
        <table className="wh-table">
          <thead>
            <tr>
              <th>Позиция</th>
              <th>Склад</th>
              <th>Ячейка</th>
              <th>Остаток</th>
              <th>Мин.</th>
              <th></th>
              {cartEnabled && <th>🛒</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const low = r.min_stock_level > 0 && Number(r.quantity) <= Number(r.min_stock_level);
              const inCart = r.product_id ? cartItemFor.get(r.product_id) : null;
              return (
                <tr key={r.product_id ? r.product_id + '-' + i : i}>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      {(r.icon_path || r.icon_slug) && (
                        <GoodsIcon slug={r.icon_slug} path={r.icon_path} size={32} alt={r.product_name} />
                      )}
                      <strong>{r.product_name}</strong>
                    </span>
                    {r.article && <span className="ml-6 op-half">{r.article}</span>}
                  </td>
                  <td>{r.warehouse_name || '—'}</td>
                  <td>{r.location_label || '—'}</td>
                  <td><strong style={{ color: low ? 'var(--err)' : 'var(--ok)' }}>{fmt(r.quantity)}</strong> {r.unit}</td>
                  <td>{r.min_stock_level > 0 ? fmt(r.min_stock_level) : '—'}</td>
                  <td>{low && <span className="wh-chip wh-chip--err">низкий</span>}</td>
                  {cartEnabled && (
                    <td>{r.product_id && <Stepper pid={r.product_id} item={inCart} cart={cart} onAdd={onAdd} onRefreshCart={onRefreshCart} />}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stepper({ pid, item, cart, onAdd, onRefreshCart }) {
  if (!item) {
    return (
      <button
        className="wh-stp wh-stp--add"
        onClick={(e) => {
          e.stopPropagation();
          onAdd({
            warehouse_id: cart?.warehouse_id,
            items: [{ item_type: 'consumable', product_id: pid, need_qty: 1, source: 'catalog' }]
          });
        }}
      >+ В корзину</button>
    );
  }
  const need = parseFloat(item.need_qty) || 1;
  const change = async (delta) => {
    const v = need + delta;
    try {
      if (v < 1) await removeCartItem(item.id);
      else       await updateCartItem(item.id, { need_qty: v });
      onRefreshCart?.();
    } catch (e) {
      toast.error('Корзина: ' + (e?.message || e));
    }
  };
  return (
    <span className="wh-stp wh-stp--qty" onClick={(e) => e.stopPropagation()}>
      <button className="wh-stp__b" onClick={() => change(-1)}>−</button>
      <input
        className="wh-stp__n"
        type="number"
        min="1"
        value={need}
        onChange={async (e) => {
          const v = Math.max(1, Math.floor(parseFloat(e.target.value) || 1));
          try { await updateCartItem(item.id, { need_qty: v }); onRefreshCart?.(); } catch { /* noop */ }
        }}
      />
      <button className="wh-stp__b" onClick={() => change(1)}>+</button>
    </span>
  );
}
