/**
 * Витрина каталога — выбор позиций с остатком/последней ценой → корзина → bulk в заявку.
 *
 * Источник: openShowcase + drawShowcase в vanilla.
 *
 * Endpoint:
 *   GET  '/api/products/catalog-procurement?include_equipment=true&limit=400'
 *        → items[] с available_qty, last_price, last_supplier
 *   POST /api/procurement/:id/items/bulk { items: [{name, unit, article, product_id, quantity, unit_price}] }
 *
 * Логика «докупить»: quantity заказа = max(0, need − available).
 * Если всё в наличии (need == available) — позиция в bulk не уходит.
 */
import { useState, useEffect, useMemo } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { loadCatalogShowcase, bulkItems, money } from '../api';

const cartKey = (it) => it.product_id ? `p${it.product_id}` : `n:${(it.name || '').toLowerCase()}`;

/** Открыть витрину каталога (1:1 с vanilla openShowcase). */
export function openShowcaseModal(open, procId, onDone) {
  open(<ShowcaseModal procId={procId} onDone={onDone} />);
}

export function ShowcaseModal({ procId, onDone }) {
  const { close } = useModal();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState({}); // {key: {k, name, unit, article, product_id, available, last_price, need}}
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    loadCatalogShowcase({ includeEquipment: true, limit: 400 })
      .then(setRows)
      .catch((e) => toast.error('Не удалось загрузить каталог: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const lq = search.trim().toLowerCase();
    return rows.filter((r) => (r.name + ' ' + (r.article || '')).toLowerCase().includes(lq));
  }, [rows, search]);

  const toggleCart = (it) => {
    const k = cartKey(it);
    setCart((s) => {
      if (s[k]) { const n = { ...s }; delete n[k]; return n; }
      return {
        ...s,
        [k]: {
          k,
          name: it.name,
          unit: it.unit || 'шт',
          article: it.article || null,
          product_id: it.product_id || null,
          available: Number(it.available_qty) || 0,
          last_price: it.last_price,
          need: (Number(it.available_qty) || 0) + 1
        }
      };
    });
  };
  const setNeed = (k, v) => {
    setCart((s) => {
      const c = s[k]; if (!c) return s;
      return { ...s, [k]: { ...c, need: parseFloat(v) || 0 } };
    });
  };
  const removeFromCart = (k) => {
    setCart((s) => { const n = { ...s }; delete n[k]; return n; });
  };

  const cartArr = Object.values(cart);

  const submit = async () => {
    const items = cartArr
      .map((c) => ({
        name: c.name,
        unit: c.unit || 'шт',
        article: c.article || null,
        product_id: c.product_id || null,
        quantity: Math.max(0, (c.need || 0) - (c.available || 0)),
        unit_price: c.last_price || null
      }))
      .filter((it) => it.quantity > 0);
    if (!items.length) {
      toast.warn('Докупать нечего — увеличьте «нужно», если требуется заказать сверх остатка');
      return;
    }
    setBusy(true);
    try {
      const r = await bulkItems(procId, items);
      toast.success(`Добавлено: ${r.count} позиций`);
      onDone?.();
      close();
    } catch (e) { toast.error(e?.message || 'Ошибка'); setBusy(false); }
  };

  const num = (v) => Number(v || 0).toLocaleString('ru-RU');

  return (
    <MCard className="modal-lg">
      <MHead icon="🛒" title="Каталог закупки" accent="gold" onClose={close} />
      <MBody>
        <div className="proc-showcase">
          <div className="proc-showcase__search">
            <input
              className="m-input proc-showcase-search-input"
              placeholder="Поиск по каталогу…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
            <span className="proc-kbadge">🛒 {cartArr.length}</span>
          </div>

          <div className="proc-showcase__list">
            <table>
              <thead>
                <tr>
                  <th>Наименование</th>
                  <th className="proc-showcase-th-center">В наличии</th>
                  <th className="proc-showcase-th-center">Посл. цена</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={4} className="proc-showcase-loading-row">
                    ⏳ Загрузка каталога…
                  </td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={4} className="proc-showcase-loading-row">
                    Ничего не найдено
                  </td></tr>
                ) : filtered.map((it) => {
                  const inCart = !!cart[cartKey(it)];
                  return (
                    <tr key={cartKey(it)}>
                      <td>
                        <b>{it.name}</b>
                        {it.article && <span className="proc-showcase-name-article">{it.article}</span>}
                        <div className="proc-showcase-name-sub">
                          {it.category_name || ''}{it.source === 'equipment' ? ' · оборудование' : ''}
                        </div>
                      </td>
                      <td className="proc-showcase-cell-center">
                        {Number(it.available_qty) > 0
                          ? <span className="c-ok">{num(it.available_qty)} {it.unit || 'шт'}</span>
                          : <span className="proc-showcase-name-article">нет</span>}
                      </td>
                      <td className="proc-showcase-cell-center">
                        {money(it.last_price)}
                        {it.last_supplier && (
                          <div className="proc-showcase-supplier">{it.last_supplier}</div>
                        )}
                      </td>
                      <td className="proc-showcase-cell-right">
                        <button
                          className={'m-btn proc-showcase-pickbtn ' + (inCart ? 'ghost' : 'primary')}
                          onClick={() => toggleCart(it)}
                        >
                          {inCart ? '✓' : '+'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {cartArr.length > 0 && (
            <div className="proc-showcase__cart">
              <div className="proc-showcase-cart-title">
                Корзина — укажите сколько нужно (показано: докупить)
              </div>
              <table className="proc-showcase-cart-table">
                <tbody>
                  {cartArr.map((c) => {
                    const toBuy = Math.max(0, (c.need || 0) - (c.available || 0));
                    return (
                      <tr key={c.k} className="proc-showcase-cart-row">
                        <td>{c.name}</td>
                        <td>
                          <input
                            type="number" min="0"
                            className="proc-items-table__input proc-showcase-cart-qty"
                            value={c.need || 0}
                            onChange={(e) => setNeed(c.k, e.target.value)}
                          />
                          {' '}<span className="proc-showcase-unit">{c.unit || 'шт'}</span>
                        </td>
                        <td className="proc-showcase-cell-center proc-showcase-unit">
                          в наличии {num(c.available || 0)}
                        </td>
                        <td className="proc-showcase-cell-center">
                          <b style={{ color: toBuy > 0 ? 'var(--amber)' : 'var(--ok)' }}>
                            докупить {num(toBuy)}
                          </b>
                        </td>
                        <td className="proc-showcase-cell-right">
                          <button
                            className="m-btn ghost proc-showcase-rmbtn"
                            onClick={() => removeFromCart(c.k)}
                          >✕</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {cartArr.length === 0 && !loading && (
            <div className="proc-showcase-empty-hint">
              Отметьте товары из каталога кнопкой «+». Нет нужного — добавьте вручную в заявке.
            </div>
          )}
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn variant="ghost" onClick={close}>Закрыть</Btn>
        <div className="proc-showcase-foot-actions">
          <Btn variant="ghost" onClick={() => { close(); onDone?.(); }}>
            Открыть заявку (добавить вручную / Excel) →
          </Btn>
          {cartArr.length > 0 && (
            <Btn variant="primary" disabled={busy} onClick={submit}>
              Добавить в заявку ({cartArr.length})
            </Btn>
          )}
        </div>
      </MFoot>
    </MCard>
  );
}
