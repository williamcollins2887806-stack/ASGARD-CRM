/**
 * АСГАРД CRM — Склад 2.0 (WMS)
 * Каталог номенклатуры • Наличие • Ячейки (адресное хранение) • Движения.
 * Современный фронт: KPI-шапка, мгновенный поиск, карточки/таблицы, drawer-операции.
 * Работает поверх /api/products, /api/stock, /api/warehouse/locations.
 */
window.AsgardWarehouseV2 = (function () {
  const UI = window.AsgardUI || {};
  const esc = UI.esc || (s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])));
  const toast = UI.toast || ((t, m, tp) => console.log(`[${tp}] ${t}: ${m}`));

  let _user = null, _root = null, _tab = 'equipment';
  let _cats = [], _whs = [];
  const fmt = n => (n == null ? '—' : Number(n).toLocaleString('ru-RU'));

  function hdr() { const t = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token'); return { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' }; }
  async function api(url, opts = {}) {
    const r = await fetch(url, { headers: hdr(), ...opts });
    const ct = r.headers.get('content-type') || '';
    const d = ct.includes('json') ? await r.json() : await r.text();
    if (!r.ok) throw new Error((d && d.error) || ('HTTP ' + r.status));
    return d;
  }
  // как api, но не бросает на не-2xx — возвращает {status, data} (для submit с 409)
  async function rawApi(url, opts = {}) {
    const r = await fetch(url, { headers: hdr(), ...opts });
    const ct = r.headers.get('content-type') || '';
    const d = ct.includes('json') ? await r.json() : await r.text();
    return { status: r.status, ok: r.ok, data: d };
  }

  // ════════════════════ КОРЗИНА СКЛАДА (маркетплейс) ════════════════════
  // _cart — источник правды на странице; LS — для мгновенных ✓ до ответа сервера.
  let _cart = { id: null, warehouse_id: null, items: [] };
  function _cartLSKey() { return 'asgard_wh_cart_' + ((_user && _user.id) || 'anon'); }
  function _cartLoadFromLS() {
    try { const raw = localStorage.getItem(_cartLSKey()); if (raw) { const a = JSON.parse(raw); if (Array.isArray(a)) _cart.items = a; } } catch (_) {}
  }
  function _cartSaveLS() {
    try { localStorage.setItem(_cartLSKey(), JSON.stringify(_cart.items.map(i => ({ product_id: i.product_id, equipment_id: i.equipment_id, id: i.id })))); } catch (_) {}
  }
  async function _cartSync() {
    try { const d = await api('/api/warehouse-cart'); _cart.id = d.cart ? d.cart.id : null; _cart.warehouse_id = d.cart ? d.cart.warehouse_id : null; _cart.items = d.items || []; _cartSaveLS(); _updateCartBadge(); }
    catch (_) {}
  }
  function isInCart(productId, equipmentId) {
    return _cart.items.some(i => (productId && i.product_id === productId) || (equipmentId && i.equipment_id === equipmentId));
  }
  function _updateCartBadge() {
    const b = document.getElementById('wh2-cart-badge'); if (b) { const n = _cart.items.length; b.textContent = n; b.style.display = n ? '' : 'none'; }
    _updateFab();
  }
  // Обновить FAB (счётчик + разбивка резерв/закупка). Определён здесь, чтобы вызывался отовсюду.
  function _updateFab() {
    const fab = document.getElementById('wh2-cart-fab'); if (!fab) return;
    const cnt = fab.querySelector('.wh2-fab__cnt');
    const split = fab.querySelector('.wh2-fab__split');
    const n = _cart.items.length;
    if (cnt) {
      const prev = cnt.textContent;
      cnt.textContent = n; cnt.style.display = n ? '' : 'none';
      if (n && prev !== String(n)) { cnt.classList.remove('wh2-fab__cnt--pop'); void cnt.offsetWidth; cnt.classList.add('wh2-fab__cnt--pop'); }
    }
    // разбивка: резерв = Σ min(need,available) по расходникам; закупка = остальное
    let res = 0, buy = 0;
    for (const it of _cart.items) {
      const need = parseFloat(it.need_qty) || 0;
      if (it.item_type === 'equipment') { res += need; continue; }
      if (it.is_new_position) { buy += need; continue; }
      const av = Math.max(0, parseFloat(it.available_qty) || 0);
      const r = Math.min(need, av); res += r; buy += (need - r);
    }
    if (split) {
      split.style.display = n ? '' : 'none';
      split.innerHTML = `<span><b>${n}</b> поз.</span><span class="res">✅ <b>${fmt(res)}</b> резерв</span><span class="buy">🛒 <b>${fmt(buy)}</b> закупка</span>`;
    }
  }
  // Анимация полёта в корзину
  function _flyToCart(fromEl) {
    try {
      const fab = document.querySelector('.wh2-fab__btn'); if (!fab || !fromEl) return;
      const a = fromEl.getBoundingClientRect(), b = fab.getBoundingClientRect();
      const fly = document.createElement('div'); fly.className = 'wh2-fly'; fly.textContent = '🛒';
      fly.style.left = a.left + a.width / 2 - 17 + 'px'; fly.style.top = a.top + a.height / 2 - 17 + 'px';
      document.body.appendChild(fly);
      requestAnimationFrame(() => { fly.style.left = b.left + b.width / 2 - 17 + 'px'; fly.style.top = b.top + b.height / 2 - 17 + 'px'; fly.style.opacity = '0.2'; fly.style.transform = 'scale(.4)'; });
      setTimeout(() => fly.remove(), 650);
    } catch (_) {}
  }
  async function addToCart(payload) {
    try {
      const d = await api('/api/warehouse-cart/items', { method: 'POST', body: JSON.stringify(payload) });
      _cart.id = d.cart ? d.cart.id : null; _cart.warehouse_id = d.cart ? d.cart.warehouse_id : null; _cart.items = d.items || [];
      _cartSaveLS(); _updateCartBadge();
      return true;
    } catch (e) { toast('Корзина', e.message, 'err'); return false; }
  }
  async function removeFromCart(cartItemId) {
    try {
      const d = await api('/api/warehouse-cart/items/' + cartItemId, { method: 'DELETE' });
      _cart.id = d.cart ? d.cart.id : null; _cart.items = d.items || [];
      _cartSaveLS(); _updateCartBadge();
    } catch (e) { toast('Корзина', e.message, 'err'); }
  }
  // убрать из корзины по equipment_id (для кнопки на карточке/строке оборудования)
  async function removeByEquipment(equipmentId) {
    const it = _cart.items.find(i => i.equipment_id === equipmentId);
    if (it) await removeFromCart(it.id);
  }
  // текущее кол-во позиции в корзине (0 если нет)
  function qtyOf(productId, equipmentId) {
    const it = _cart.items.find(i => (productId && i.product_id === productId) || (equipmentId && i.equipment_id === equipmentId));
    return it ? (parseFloat(it.need_qty) || 0) : 0;
  }
  function _cartItemOf(productId, equipmentId) {
    return _cart.items.find(i => (productId && i.product_id === productId) || (equipmentId && i.equipment_id === equipmentId));
  }
  async function updateQty(cartItemId, qty) {
    try {
      const d = await api('/api/warehouse-cart/items/' + cartItemId, { method: 'PUT', body: JSON.stringify({ need_qty: qty }) });
      _cart.id = d.cart ? d.cart.id : null; _cart.items = d.items || [];
      _cartSaveLS(); _updateCartBadge();
    } catch (e) { toast('Корзина', e.message, 'err'); }
  }

  // ── Степпер (Ozon-стиль): «+ В корзину» ⇄ [−][N][+] ──
  // kind: 'consumable'|'equipment'; id: product_id|equipment_id
  function cartStepper(kind, id) {
    const eq = kind === 'equipment';
    const q = qtyOf(eq ? null : id, eq ? id : null);
    const da = eq ? `data-step-eqid="${id}"` : `data-step-pid="${id}"`;
    if (!q) return `<button class="wh2-stp wh2-stp--add" ${da} data-step-add="1" title="В корзину закупки">+ В корзину</button>`;
    return `<span class="wh2-stp wh2-stp--qty" ${da}>
      <button class="wh2-stp__b" data-step-dec="1" title="−">−</button>
      <input class="wh2-stp__n" type="number" min="1" step="1" value="${q}" data-step-inp="1">
      <button class="wh2-stp__b" data-step-inc="1" title="+">+</button>
    </span>`;
  }
  // Перерисовать ОДИН степпер по месту (после изменения)
  function _refreshStepper(el) {
    const pid = el.getAttribute('data-step-pid'), eqid = el.getAttribute('data-step-eqid');
    const wrap = document.createElement('div');
    wrap.innerHTML = cartStepper(eqid ? 'equipment' : 'consumable', +(eqid || pid));
    const fresh = wrap.firstElementChild;
    el.replaceWith(fresh); _bindStepper(fresh);
  }
  // Навесить обработчики на один степпер-элемент
  function _bindStepper(el) {
    const pid = el.getAttribute('data-step-pid'); const eqid = el.getAttribute('data-step-eqid');
    const isEq = !!eqid; const id = +(eqid || pid);
    const stop = ev => ev.stopPropagation();
    if (el.classList.contains('wh2-stp--add')) {
      el.onclick = async ev => { stop(ev);
        const ok = await addToCart({ warehouse_id: _cart.warehouse_id, items: [{ item_type: isEq ? 'equipment' : 'consumable', [isEq ? 'equipment_id' : 'product_id']: id, need_qty: 1, source: 'catalog' }] });
        if (ok) { _flyToCart(el); navigator.vibrate && navigator.vibrate(8); _refreshStepper(el); }
      };
      return;
    }
    const item = _cartItemOf(isEq ? null : id, isEq ? id : null); if (!item) { _refreshStepper(el); return; }
    el.querySelector('[data-step-dec]').onclick = async ev => { stop(ev);
      const cur = qtyOf(isEq ? null : id, isEq ? id : null);
      if (cur <= 1) { await removeFromCart(item.id); _refreshStepper(el); }
      else { await updateQty(item.id, cur - 1); _refreshStepper(el); }
    };
    el.querySelector('[data-step-inc]').onclick = async ev => { stop(ev);
      const cur = qtyOf(isEq ? null : id, isEq ? id : null);
      if (isEq) { toast('Оборудование', 'Единица оборудования добавляется поштучно', 'warn'); return; }
      await updateQty(item.id, cur + 1); _refreshStepper(el);
    };
    const inp = el.querySelector('[data-step-inp]');
    inp.onclick = stop;
    let t; inp.oninput = () => { clearTimeout(t); t = setTimeout(async () => {
      const v = Math.max(1, Math.floor(parseFloat(inp.value) || 1));
      if (isEq && v > 1) { inp.value = 1; toast('Оборудование', 'Поштучно', 'warn'); return; }
      await updateQty(item.id, v); _updateFab();
    }, 450); };
  }

  // ── Стили (инжект один раз) ───────────────────────────────────────────────
  function injectCSS() {
    if (document.getElementById('wh2-css')) return;
    const s = document.createElement('style'); s.id = 'wh2-css';
    s.textContent = `
    .wh2{padding:18px 22px;max-width:1400px;margin:0 auto}
    .wh2-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:20px}
    .wh2-kpi{background:var(--bg-card,#161a22);border:1px solid var(--border,#262c38);border-radius:16px;padding:16px 18px;position:relative;overflow:hidden;transition:.2s}
    .wh2-kpi:hover{transform:translateY(-2px);border-color:var(--gold,#D4A843)}
    .wh2-kpi__v{font-size:30px;font-weight:800;line-height:1;letter-spacing:-.5px}
    .wh2-kpi__l{font-size:12px;color:var(--t2,#8b93a3);margin-top:8px;text-transform:uppercase;letter-spacing:.4px}
    .wh2-kpi__i{position:absolute;right:14px;top:14px;font-size:24px;opacity:.5}
    .wh2-kpi--warn .wh2-kpi__v{color:var(--err-t,#ff5c5c)}
    .wh2-kpi--gold .wh2-kpi__v{color:var(--gold,#D4A843)}
    .wh2-kpi--ok .wh2-kpi__v{color:var(--ok-t,#30d158)}
    .wh2-tabs{display:flex;gap:6px;border-bottom:1px solid var(--border,#262c38);margin-bottom:18px;flex-wrap:wrap}
    .wh2-tab{padding:11px 18px;cursor:pointer;border:0;background:none;color:var(--t2,#8b93a3);font-size:14px;font-weight:600;border-bottom:2px solid transparent;transition:.15s;border-radius:8px 8px 0 0}
    .wh2-tab:hover{color:var(--t1,#e6e9ef);background:var(--bg-hover,#1c212b)}
    .wh2-tab--active{color:var(--gold,#D4A843);border-bottom-color:var(--gold,#D4A843)}
    .wh2-toolbar{display:flex;gap:10px;align-items:center;margin-bottom:16px;flex-wrap:wrap}
    .wh2-search{flex:1;min-width:220px;position:relative}
    .wh2-search input{width:100%;padding:11px 14px 11px 38px;background:var(--bg-input,#10141b);border:1px solid var(--border,#262c38);border-radius:11px;color:var(--t1,#e6e9ef);font-size:14px;outline:none;transition:.15s}
    .wh2-search input:focus{border-color:var(--gold,#D4A843);box-shadow:0 0 0 3px rgba(212,168,67,.12)}
    .wh2-search::before{content:'🔍';position:absolute;left:12px;top:50%;transform:translateY(-50%);opacity:.5;font-size:14px}
    .wh2-btn{padding:11px 16px;border-radius:11px;border:1px solid var(--border,#262c38);background:var(--bg-card,#161a22);color:var(--t1,#e6e9ef);font-size:13px;font-weight:600;cursor:pointer;transition:.15s;white-space:nowrap}
    .wh2-btn:hover{border-color:var(--gold,#D4A843)}
    .wh2-btn--primary{background:var(--gold,#D4A843);color:#1a1408;border-color:var(--gold,#D4A843)}
    .wh2-btn--primary:hover{filter:brightness(1.08)}
    .wh2-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
    .wh2-card{background:var(--bg-card,#161a22);border:1px solid var(--border,#262c38);border-radius:15px;padding:16px;cursor:pointer;transition:.18s;display:flex;flex-direction:column;gap:8px;animation:wh2in .3s ease both;position:relative}
    @keyframes wh2in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
    /* корзина */
    .wh2-cart-toggle{position:absolute;top:10px;right:10px;z-index:3;width:30px;height:30px;border-radius:9px;border:1px solid var(--border,#262c38);background:var(--bg2,#0f1217);color:var(--t1,#e8eaed);font-size:18px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.15s;line-height:1}
    .wh2-cart-toggle:hover{border-color:var(--gold,#D4A843);transform:scale(1.08)}
    .wh2-cart-toggle--active{background:var(--ok-t,#30d158);border-color:var(--ok-t,#30d158);color:#04210d}
    .wh2-cart-badge{display:inline-flex;align-items:center;justify-content:center;min-width:19px;height:19px;padding:0 5px;margin-left:7px;border-radius:10px;background:#ff3b30;color:#fff;font-size:11px;font-weight:800}
    .wh2-cart-row{display:flex;gap:10px;align-items:center;padding:10px;border-bottom:1px solid var(--border,#262c38)}
    .wh2-cart-row--changed{background:rgba(224,168,0,.10);border-left:3px solid var(--warn,#e0a800)}
    .wh2-cart-change-alert{font-size:12px;color:var(--warn,#e0a800);margin-top:3px}
    .wh2-row-new{background:rgba(224,168,0,.08)}
    .wh2-mk-hint{font-size:12px;color:var(--t2);background:var(--bg2,#0f1217);border:1px dashed var(--border,#262c38);border-radius:8px;padding:8px 10px;margin-bottom:8px}
    .wh2-card:hover{transform:translateY(-3px);border-color:var(--gold,#D4A843);box-shadow:0 8px 24px rgba(0,0,0,.25)}
    .wh2-card__top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
    .wh2-card__name{font-weight:700;font-size:15px;color:var(--t1,#e6e9ef);line-height:1.3}
    .wh2-card__sub{font-size:12px;color:var(--t2,#8b93a3)}
    .wh2-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:20px;font-size:11px;font-weight:700}
    .wh2-chip--draft{background:rgba(255,160,0,.15);color:#ffb020}
    .wh2-chip--cons{background:rgba(74,144,217,.15);color:#5aa0e0}
    .wh2-chip--ok{background:rgba(48,209,88,.15);color:#30d158}
    .wh2-chip--warn{background:rgba(255,92,92,.15);color:#ff5c5c}
    .wh2-avail{display:flex;align-items:baseline;gap:6px;margin-top:auto;padding-top:8px;border-top:1px solid var(--border,#262c38)}
    .wh2-avail__n{font-size:22px;font-weight:800;color:var(--ok-t,#30d158)}
    .wh2-avail__n--zero{color:var(--t2,#8b93a3)}
    .wh2-empty{text-align:center;padding:60px 20px;color:var(--t2,#8b93a3)}
    .wh2-empty__i{font-size:48px;opacity:.4;margin-bottom:12px}
    .wh2-table{width:100%;border-collapse:collapse;font-size:13px}
    .wh2-table th{text-align:left;padding:10px 12px;color:var(--t2,#8b93a3);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.4px;border-bottom:1px solid var(--border,#262c38)}
    .wh2-table td{padding:11px 12px;border-bottom:1px solid var(--border,#1e2430);color:var(--t1,#e6e9ef)}
    .wh2-table tr:hover td{background:var(--bg-hover,#1c212b)}
    .wh2-cellmap{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px}
    .wh2-cell{background:var(--bg-card,#161a22);border:1px solid var(--border,#262c38);border-radius:12px;padding:12px;cursor:pointer;transition:.15s;text-align:center}
    .wh2-cell:hover{border-color:var(--gold,#D4A843);transform:scale(1.03)}
    .wh2-cell--full{border-color:var(--ok-t,#30d158)}
    .wh2-cell__lbl{font-weight:800;font-size:15px;color:var(--gold,#D4A843)}
    .wh2-cell__cnt{font-size:11px;color:var(--t2,#8b93a3);margin-top:4px}
    .wh2-mv{display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid var(--border,#1e2430)}
    .wh2-mv__ic{width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}
    .wh2-loading{text-align:center;padding:50px;color:var(--t2)}

    /* ═══════════ MARKETPLACE UI 2.0 ═══════════ */
    /* Степпер «+ / −N+» (Ozon-стиль) */
    .wh2-stp{display:inline-flex;align-items:center;gap:0;height:34px;border-radius:10px;overflow:hidden;user-select:none;flex-shrink:0}
    .wh2-stp--add{padding:0 14px;background:linear-gradient(135deg,#e7bd54,#D4A843);color:#1a1408;font-weight:800;font-size:13px;cursor:pointer;border:none;transition:.16s;box-shadow:0 2px 8px rgba(212,168,67,.25);white-space:nowrap}
    .wh2-stp--add:hover{filter:brightness(1.07);transform:translateY(-1px);box-shadow:0 4px 14px rgba(212,168,67,.35)}
    .wh2-stp--add:active{transform:scale(.94)}
    .wh2-stp--qty{border:1.5px solid var(--gold,#D4A843);background:var(--bg2,#0f1217)}
    .wh2-stp__b{width:32px;height:100%;border:none;background:transparent;color:var(--gold,#D4A843);font-size:18px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.12s;line-height:1}
    .wh2-stp__b:hover{background:rgba(212,168,67,.16)}
    .wh2-stp__b:active{transform:scale(.85)}
    .wh2-stp__n{width:42px;height:100%;border:none;background:transparent;color:var(--t1,#e8eaed);font-size:14px;font-weight:800;text-align:center;outline:none;-moz-appearance:textfield}
    .wh2-stp__n::-webkit-outer-spin-button,.wh2-stp__n::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
    .wh2-stp__n:focus{background:rgba(212,168,67,.10)}

    /* FAB корзины (угол, вместо Мимира на складе) */
    .wh2-fab{position:fixed;bottom:24px;right:24px;z-index:600;display:flex;flex-direction:column;align-items:flex-end;gap:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
    .wh2-fab__btn{position:relative;width:64px;height:64px;border-radius:50%;border:none;cursor:pointer;background:linear-gradient(135deg,#e7bd54,#D4A843);color:#1a1408;font-size:28px;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 22px rgba(212,168,67,.4),0 2px 6px rgba(0,0,0,.3);transition:.2s}
    .wh2-fab__btn:hover{transform:translateY(-3px) scale(1.05);box-shadow:0 10px 30px rgba(212,168,67,.5)}
    .wh2-fab__btn:active{transform:scale(.92)}
    .wh2-fab__cnt{position:absolute;top:-4px;right:-4px;min-width:24px;height:24px;padding:0 6px;border-radius:13px;background:#ff3b30;color:#fff;font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;border:2.5px solid var(--bg1,#0d0d0f);box-shadow:0 2px 6px rgba(0,0,0,.3)}
    .wh2-fab__cnt--pop{animation:wh2pop .4s cubic-bezier(.34,1.56,.64,1)}
    @keyframes wh2pop{0%{transform:scale(1)}40%{transform:scale(1.5)}100%{transform:scale(1)}}
    .wh2-fab__split{background:var(--bg-card,#161a22);border:1px solid var(--border,#262c38);border-radius:13px;padding:9px 13px;font-size:12px;color:var(--t1,#e6e9ef);box-shadow:0 6px 20px rgba(0,0,0,.35);display:flex;gap:12px;white-space:nowrap;animation:wh2in .25s ease both}
    .wh2-fab__split b{font-weight:800}
    .wh2-fab__split .res{color:var(--ok-t,#30d158)}
    .wh2-fab__split .buy{color:var(--warn,#e0a800)}

    /* Drawer корзины (выезжает справа, blur-фон) */
    .wh2-cart-ov{position:fixed;inset:0;z-index:700;background:rgba(8,10,14,.45);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);opacity:0;transition:opacity .26s ease}
    .wh2-cart-ov--open{opacity:1}
    .wh2-cart-dr{position:fixed;top:0;right:0;bottom:0;z-index:701;width:min(720px,66vw);background:var(--bg1,#0d0d0f);border-left:1px solid var(--border,#262c38);box-shadow:-12px 0 40px rgba(0,0,0,.4);display:flex;flex-direction:column;transform:translateX(100%);transition:transform .28s cubic-bezier(.4,0,.2,1)}
    .wh2-cart-dr--open{transform:translateX(0)}
    .wh2-cart-dr__hd{display:flex;align-items:center;gap:12px;padding:18px 22px;border-bottom:1px solid var(--border,#262c38)}
    .wh2-cart-dr__hd h3{margin:0;font-size:19px;font-weight:800;flex:1}
    .wh2-cart-dr__body{flex:1;overflow-y:auto;padding:8px 22px}
    .wh2-cart-dr__ft{border-top:1px solid var(--border,#262c38);padding:16px 22px;background:var(--bg-card,#13161d)}
    .wh2-cart-it{display:flex;gap:12px;align-items:center;padding:14px 0;border-bottom:1px solid var(--border,#1e2430)}
    .wh2-cart-it--changed{background:rgba(224,168,0,.08);border-left:3px solid var(--warn,#e0a800);padding-left:10px;border-radius:8px}
    .wh2-cart-it__nm{font-weight:700;font-size:14.5px}
    .wh2-cart-it__sub{font-size:12px;color:var(--t2,#8b93a3);margin-top:2px}
    .wh2-cart-x{width:30px;height:30px;border-radius:8px;border:1px solid var(--border,#262c38);background:transparent;color:var(--err-t,#ff5c5c);cursor:pointer;font-size:14px;flex-shrink:0;transition:.15s}
    .wh2-cart-x:hover{background:rgba(255,92,92,.12);border-color:var(--err-t,#ff5c5c)}
    .wh2-cart-tot{display:flex;gap:18px;margin-bottom:12px;flex-wrap:wrap}
    .wh2-cart-tot__c{flex:1;min-width:120px;background:var(--bg2,#0f1217);border:1px solid var(--border,#262c38);border-radius:11px;padding:10px 13px}
    .wh2-cart-tot__v{font-size:20px;font-weight:800;line-height:1}
    .wh2-cart-tot__l{font-size:11px;color:var(--t2);margin-top:3px;text-transform:uppercase;letter-spacing:.3px}
    .wh2-iconbtn{width:38px;height:38px;border-radius:10px;border:1px solid var(--border,#262c38);background:var(--bg-card,#161a22);color:var(--t1,#e6e9ef);cursor:pointer;font-size:16px;transition:.15s;display:flex;align-items:center;justify-content:center}
    .wh2-iconbtn:hover{border-color:var(--gold,#D4A843);transform:rotate(-25deg)}
    .wh2-iconbtn--x:hover{transform:none;color:var(--err-t,#ff5c5c)}

    /* Скелетоны */
    .wh2-skel{background:linear-gradient(90deg,rgba(255,255,255,.03) 25%,rgba(255,255,255,.08) 37%,rgba(255,255,255,.03) 63%);background-size:400% 100%;animation:wh2sh 1.3s ease infinite;border-radius:10px}
    @keyframes wh2sh{0%{background-position:100% 0}100%{background-position:-100% 0}}
    .wh2-skel-card{height:150px;border-radius:15px}

    /* Фильтр-чипы */
    .wh2-chips{display:flex;gap:7px;flex-wrap:wrap;align-items:center}
    .wh2-fchip{padding:7px 14px;border-radius:20px;border:1px solid var(--border,#262c38);background:var(--bg-card,#161a22);color:var(--t2,#8b93a3);font-size:13px;font-weight:600;cursor:pointer;transition:.15s;white-space:nowrap}
    .wh2-fchip:hover{border-color:var(--gold,#D4A843);color:var(--t1,#e6e9ef)}
    .wh2-fchip--active{background:var(--gold,#D4A843);color:#1a1408;border-color:var(--gold,#D4A843)}

    /* Поиск + автоподсказки */
    .wh2-search input{padding-right:34px}
    .wh2-search__clear{position:absolute;right:10px;top:50%;transform:translateY(-50%);width:20px;height:20px;border-radius:50%;border:none;background:var(--border,#262c38);color:var(--t1);cursor:pointer;font-size:12px;display:none;align-items:center;justify-content:center}
    .wh2-ac{position:absolute;top:calc(100% + 6px);left:0;right:0;z-index:40;background:var(--bg-card,#161a22);border:1px solid var(--border,#262c38);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.4);max-height:320px;overflow-y:auto;animation:wh2in .15s ease both}
    .wh2-ac__i{display:flex;gap:10px;align-items:center;padding:10px 13px;cursor:pointer;transition:.12s;border-bottom:1px solid var(--border,#1e2430)}
    .wh2-ac__i:last-child{border-bottom:none}
    .wh2-ac__i:hover{background:var(--bg-hover,#1c212b)}
    .wh2-ac__nm{font-weight:600;font-size:13.5px}
    .wh2-ac__meta{font-size:11.5px;color:var(--t2)}

    /* fly-to-cart */
    .wh2-fly{position:fixed;z-index:9999;width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#e7bd54,#D4A843);display:flex;align-items:center;justify-content:center;font-size:17px;pointer-events:none;box-shadow:0 4px 14px rgba(212,168,67,.5);transition:all .62s cubic-bezier(.3,.7,.4,1)}

    /* Мобильно */
    @media(max-width:768px){
      .wh2{padding:12px}
      .wh2-kpis{grid-template-columns:1fr 1fr;gap:10px}
      .wh2-cart-dr{width:100vw}
      .wh2-fab{bottom:16px;right:16px}
      .wh2-fab__btn{width:58px;height:58px;font-size:25px}
      .wh2-stp{height:38px}
      .wh2-stp__b{width:36px;font-size:20px}
      .wh2-cards{grid-template-columns:1fr}
      .wh2-chips{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:4px}
    }
    `;
    document.head.appendChild(s);
  }

  const MOVE_META = {
    receipt: { i: '📥', c: 'rgba(48,209,88,.15)', l: 'Приход' },
    issue: { i: '📤', c: 'rgba(74,144,217,.15)', l: 'Расход' },
    transfer: { i: '🔄', c: 'rgba(212,168,67,.15)', l: 'Перемещение' },
    writeoff: { i: '🗑️', c: 'rgba(255,92,92,.15)', l: 'Списание' },
    return: { i: '↩️', c: 'rgba(48,209,88,.12)', l: 'Возврат' },
    found: { i: '✨', c: 'rgba(255,176,32,.15)', l: 'Находка' },
    adjust: { i: '⚖️', c: 'rgba(139,147,163,.15)', l: 'Корректировка' }
  };

  // ── Загрузка справочников ──────────────────────────────────────────────────
  async function loadRefs() {
    try { const c = await api('/api/product-categories'); _cats = c.items || []; } catch (_) { _cats = []; }
    try { const w = await api('/api/equipment/warehouses'); _whs = w.warehouses || []; } catch (_) { _whs = []; }
  }

  // ════════════════════ МОДАЛКА КОРЗИНЫ ════════════════════
  let _works = [];
  async function _loadWorks() {
    if (_works.length) return _works;
    try { const w = await api('/api/works?limit=300'); _works = (w.works || w.items || w.rows || []).map(x => ({ id: x.id, title: x.work_title || ('#' + x.id) })); } catch (_) { _works = []; }
    return _works;
  }
  function _workOptions(sel) {
    return '<option value="">— без работы —</option>' + _works.map(w => `<option value="${w.id}" ${String(sel) === String(w.id) ? 'selected' : ''}>${esc(w.title)}</option>`).join('');
  }
  const _money = v => (v == null || v === '') ? '—' : Number(v).toLocaleString('ru-RU') + ' ₽';
  // скелетон-карточки на время загрузки
  function _skelCards(n) { return `<div class="wh2-cards">${Array.from({ length: n || 8 }).map(() => '<div class="wh2-skel wh2-skel-card"></div>').join('')}</div>`; }
  function _skelRows(n) { return `<div style="display:flex;flex-direction:column;gap:8px">${Array.from({ length: n || 6 }).map(() => '<div class="wh2-skel" style="height:46px"></div>').join('')}</div>`; }
  // красивое пустое состояние с кнопкой действия
  function _emptyState(icon, title, hint, btnLabel, btnId) {
    return `<div class="wh2-empty"><div class="wh2-empty__i">${icon}</div>
      <div style="font-size:16px;font-weight:700;color:var(--t1)">${esc(title)}</div>
      ${hint ? `<div style="margin-top:6px;max-width:380px;margin-left:auto;margin-right:auto">${esc(hint)}</div>` : ''}
      ${btnLabel ? `<button class="wh2-btn wh2-btn--primary" id="${btnId}" style="margin-top:14px">${esc(btnLabel)}</button>` : ''}</div>`;
  }

  // ── DRAWER КОРЗИНЫ (выезжает справа, blur-фон) ──
  async function openCartDrawer() {
    await _loadWorks();
    if (!document.getElementById('wh2-cart-drawer')) {
      const ov = document.createElement('div'); ov.id = 'wh2-cart-overlay'; ov.className = 'wh2-cart-ov';
      const dr = document.createElement('div'); dr.id = 'wh2-cart-drawer'; dr.className = 'wh2-cart-dr';
      document.body.appendChild(ov); document.body.appendChild(dr);
      ov.onclick = () => closeCartDrawer();
    }
    _renderDrawer();
    requestAnimationFrame(() => {
      document.getElementById('wh2-cart-overlay').classList.add('wh2-cart-ov--open');
      document.getElementById('wh2-cart-drawer').classList.add('wh2-cart-dr--open');
    });
    _cartSync().then(() => { if (document.getElementById('wh2-cart-drawer')) _renderDrawer(); });
  }
  function closeCartDrawer() {
    const ov = document.getElementById('wh2-cart-overlay'), dr = document.getElementById('wh2-cart-drawer');
    if (ov) ov.classList.remove('wh2-cart-ov--open');
    if (dr) dr.classList.remove('wh2-cart-dr--open');
    setTimeout(() => { if (ov) ov.remove(); if (dr) dr.remove(); }, 300);
  }
  function _renderDrawer() {
    const dr = document.getElementById('wh2-cart-drawer'); if (!dr) return;
    const items = _cart.items;
    // итоги-разбивка
    let res = 0, buy = 0;
    items.forEach(it => { const need = parseFloat(it.need_qty) || 0;
      if (it.item_type === 'equipment') { res += need; return; }
      if (it.is_new_position) { buy += need; return; }
      const av = Math.max(0, parseFloat(it.available_qty) || 0); const r = Math.min(need, av); res += r; buy += (need - r);
    });
    const body = !items.length
      ? `<div class="wh2-empty"><div class="wh2-empty__i">🛒</div><div style="font-size:16px;font-weight:700;color:var(--t1)">Корзина пуста</div>
         <div style="margin-top:6px">Отметьте позиции кнопкой «+ В корзину» в каталоге или оборудовании.</div></div>`
      : items.map(it => {
        const need = parseFloat(it.need_qty) || 1;
        const avail = it.is_new_position ? null : (parseFloat(it.available_qty) || 0);
        const toBuy = avail == null ? need : Math.max(0, need - avail);
        const isEq = it.item_type === 'equipment';
        const stepper = isEq
          ? `<span class="wh2-stp wh2-stp--qty" style="border-color:var(--ok-t,#30d158)"><span class="wh2-stp__b" style="cursor:default;color:var(--ok-t,#30d158);width:auto;padding:0 10px;font-size:12px">1 ед.</span></span>`
          : `<span class="wh2-stp wh2-stp--qty"><button class="wh2-stp__b" data-dr-dec="${it.id}">−</button><input class="wh2-stp__n" type="number" min="1" value="${need}" data-dr-need="${it.id}"><button class="wh2-stp__b" data-dr-inc="${it.id}">+</button></span>`;
        return `<div class="wh2-cart-it" data-cid="${it.id}">
          <div style="flex:1;min-width:0">
            <div class="wh2-cart-it__nm">${esc(it.name)}${it.is_new_position ? ' <span class="wh2-chip" style="background:rgba(224,168,0,.2);color:#e0a800">🆕</span>' : ''}${isEq ? ' <span class="wh2-chip wh2-chip--ok">оборуд.</span>' : ''}</div>
            <div class="wh2-cart-it__sub">${isEq ? 'единица оборудования' : ('На складе: <b style="color:var(--t1)">' + (avail != null ? fmt(avail) : '—') + '</b> · посл. цена ' + _money(it.is_new_position ? it.manual_price : it.last_price))}</div>
            ${!isEq && !it.is_new_position ? `<div class="wh2-cart-it__sub" style="color:${toBuy > 0 ? 'var(--warn,#e0a800)' : 'var(--ok-t,#30d158)'}">${toBuy > 0 ? '🛒 докупить ' + fmt(toBuy) : '✅ есть в наличии — зарезервируется'}</div>` : ''}
            <select data-dr-work="${it.id}" style="margin-top:6px;max-width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:8px;background:var(--bg2,#0f1217);color:inherit;font-size:12px">${_workOptions(it.work_id)}</select>
            <div class="wh2-cart-change-alert" data-changed="${it.id}" style="display:none"></div>
          </div>
          ${stepper}
          <button class="wh2-cart-x" data-dr-rm="${it.id}" title="Убрать">✕</button>
        </div>`;
      }).join('');
    dr.innerHTML = `
      <div class="wh2-cart-dr__hd">
        <h3>🛒 Корзина закупки</h3>
        <button class="wh2-iconbtn" id="wh2-dr-refresh" title="Обновить остатки">↻</button>
        <button class="wh2-iconbtn wh2-iconbtn--x" id="wh2-dr-close" title="Закрыть">✕</button>
      </div>
      <div class="wh2-cart-dr__body">
        ${body}
        ${items.length ? `<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
          <button class="wh2-btn" id="wh2-cart-manual">＋ Добавить вручную</button>
          <button class="wh2-btn" id="wh2-cart-excel">📎 Загрузить Excel</button>
        </div>` : `<div style="display:flex;gap:8px;margin-top:14px;justify-content:center">
          <button class="wh2-btn" id="wh2-cart-manual">＋ Добавить вручную</button>
          <button class="wh2-btn" id="wh2-cart-excel">📎 Excel</button>
        </div>`}
        <div id="wh2-cart-sub" style="margin-top:12px"></div>
      </div>
      ${items.length ? `<div class="wh2-cart-dr__ft">
        <div class="wh2-cart-tot">
          <div class="wh2-cart-tot__c"><div class="wh2-cart-tot__v">${items.length}</div><div class="wh2-cart-tot__l">позиций</div></div>
          <div class="wh2-cart-tot__c"><div class="wh2-cart-tot__v" style="color:var(--ok-t,#30d158)">${fmt(res)}</div><div class="wh2-cart-tot__l">в резерв</div></div>
          <div class="wh2-cart-tot__c"><div class="wh2-cart-tot__v" style="color:var(--warn,#e0a800)">${fmt(buy)}</div><div class="wh2-cart-tot__l">в закупку</div></div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="wh2-btn" id="wh2-cart-preview" style="flex:1">👁 Предпросмотр</button>
          <button class="wh2-btn wh2-btn--primary" id="wh2-cart-submit" style="flex:2">Отправить заявку →</button>
        </div>
      </div>` : ''}`;
    _bindDrawer();
  }
  function _bindDrawer() {
    const $ = id => document.getElementById(id);
    $('wh2-dr-close').onclick = () => closeCartDrawer();
    $('wh2-dr-refresh').onclick = async () => { const b = $('wh2-dr-refresh'); b.style.transition = 'transform .5s'; b.style.transform = 'rotate(360deg)'; await _cartSync(); _renderDrawer(); toast('Обновлено', 'Актуальные остатки', 'ok'); };
    document.querySelectorAll('[data-dr-dec]').forEach(b => b.onclick = async () => { const id = +b.dataset.drDec; const it = _cart.items.find(i => i.id === id); if (!it) return; const cur = parseFloat(it.need_qty) || 1; if (cur <= 1) await removeFromCart(id); else await updateQty(id, cur - 1); _renderDrawer(); });
    document.querySelectorAll('[data-dr-inc]').forEach(b => b.onclick = async () => { const id = +b.dataset.drInc; const it = _cart.items.find(i => i.id === id); if (!it) return; await updateQty(id, (parseFloat(it.need_qty) || 1) + 1); _renderDrawer(); });
    document.querySelectorAll('[data-dr-need]').forEach(inp => { let t; inp.oninput = () => { clearTimeout(t); t = setTimeout(async () => { await updateQty(+inp.dataset.drNeed, Math.max(1, Math.floor(parseFloat(inp.value) || 1))); _renderDrawer(); }, 450); }; });
    document.querySelectorAll('[data-dr-work]').forEach(sel => sel.onchange = async () => { await api('/api/warehouse-cart/items/' + sel.dataset.drWork, { method: 'PUT', body: JSON.stringify({ work_id: sel.value || null }) }).catch(() => {}); });
    document.querySelectorAll('[data-dr-rm]').forEach(b => b.onclick = async () => { await removeFromCart(+b.dataset.drRm); _renderDrawer(); });
    const mb = $('wh2-cart-manual'); if (mb) mb.onclick = () => _openManualPanel();
    const xb = $('wh2-cart-excel'); if (xb) xb.onclick = () => _openExcelPanel();
    const pb = $('wh2-cart-preview'); if (pb) pb.onclick = () => openSubmitPreview();
    const sb = $('wh2-cart-submit'); if (sb) sb.onclick = () => submitCart({});
  }
  // совместимость: старые вызовы openCartModal/_redrawCart → drawer
  function openCartModal() { return openCartDrawer(); }
  function _redrawCart() { _renderDrawer(); }

  // ── Добавить вручную ──
  function _openManualPanel() {
    const sub = document.getElementById('wh2-cart-sub'); if (!sub) return;
    sub.innerHTML = `<div style="border:1px solid var(--border);border-radius:10px;padding:12px">
      <div style="font-weight:600;margin-bottom:6px">Добавить вручную</div>
      <input id="wh2-man-q" placeholder="Название или артикул…" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:7px;background:var(--bg2,#0f1217);color:inherit">
      <div id="wh2-man-sug" style="margin-top:6px"></div>
      <div id="wh2-man-new" style="display:none;margin-top:8px;border-top:1px dashed var(--border);padding-top:8px">
        <div class="wh2-mk-hint">Такого в каталоге нет — добавим как новую позицию.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <input id="wh2-man-price" type="number" min="0" placeholder="Цена ₽" style="width:90px;padding:7px;border:1px solid var(--border);border-radius:7px;background:var(--bg2,#0f1217);color:inherit">
          <input id="wh2-man-qty" type="number" min="1" value="1" style="width:70px;padding:7px;border:1px solid var(--border);border-radius:7px;background:var(--bg2,#0f1217);color:inherit">
          <select id="wh2-man-seg" style="padding:7px;border:1px solid var(--border);border-radius:7px;background:var(--bg2,#0f1217);color:inherit"><option value="">сегмент</option><option value="cheap">💰 дешевле</option><option value="medium">⚖️ средний</option><option value="premium">⭐ премиум</option></select>
          <button class="wh2-btn wh2-btn--primary" id="wh2-man-addnew">Добавить новую</button>
        </div>
      </div>
      <button class="wh2-btn" id="wh2-man-cancel" style="margin-top:8px">Закрыть</button>
    </div>`;
    const q = document.getElementById('wh2-man-q'); let t;
    let lastName = '';
    q.oninput = () => { clearTimeout(t); lastName = q.value.trim(); t = setTimeout(async () => {
      if (lastName.length < 2) { document.getElementById('wh2-man-sug').innerHTML = ''; document.getElementById('wh2-man-new').style.display = 'none'; return; }
      let d; try { d = await api('/api/warehouse-cart/add-manual', { method: 'POST', body: JSON.stringify({ name: lastName }) }); } catch (_) { return; }
      const sug = document.getElementById('wh2-man-sug');
      if (d.matches && d.matches.length) {
        sug.innerHTML = d.matches.map(m => `<div class="wh2-cart-row" style="cursor:pointer;padding:7px" data-pick='${esc(JSON.stringify({ id: m.id, name: m.name }))}'>
          <div style="flex:1"><b>${esc(m.name)}</b>${m.article ? ' <span style="opacity:.5">' + esc(m.article) + '</span>' : ''}<div style="font-size:12px;color:var(--t2)">на складе ${fmt(m.available_qty)} · ${_money(m.last_price)}</div></div><span class="wh2-btn" style="padding:3px 9px">+</span></div>`).join('');
        document.getElementById('wh2-man-new').style.display = 'none';
        sug.querySelectorAll('[data-pick]').forEach(el => el.onclick = async () => {
          const m = JSON.parse(el.dataset.pick);
          await addToCart({ warehouse_id: _cart.warehouse_id, items: [{ item_type: 'consumable', product_id: m.id, need_qty: 1, source: 'manual' }] });
          _redrawCart();
        });
      } else {
        sug.innerHTML = '';
        document.getElementById('wh2-man-new').style.display = '';
      }
    }, 400); };
    document.getElementById('wh2-man-addnew').onclick = async () => {
      const name = lastName || q.value.trim(); if (!name) { toast('Внимание', 'Введите название', 'warn'); return; }
      await addToCart({ warehouse_id: _cart.warehouse_id, items: [{ item_type: 'new_position', custom_name: name,
        need_qty: parseFloat(document.getElementById('wh2-man-qty').value) || 1,
        manual_price: parseFloat(document.getElementById('wh2-man-price').value) || null,
        price_segment: document.getElementById('wh2-man-seg').value || null, source: 'manual' }] });
      _redrawCart();
    };
    document.getElementById('wh2-man-cancel').onclick = () => { sub.innerHTML = ''; };
  }

  // ── Прикрепить Excel ──
  function _openExcelPanel() {
    const sub = document.getElementById('wh2-cart-sub'); if (!sub) return;
    sub.innerHTML = `<div style="border:1px solid var(--border);border-radius:10px;padding:12px">
      <div style="font-weight:600;margin-bottom:6px">Загрузить Excel</div>
      <div class="wh2-mk-hint">Первая строка — заголовки. Ожидаемые столбцы: <b>название</b> · <b>поставщик</b> · <b>количество</b> · <b>цена</b> (артикул/ед. — опционально).</div>
      <label class="wh2-btn" style="cursor:pointer;display:inline-block">📎 Выбрать файл<input type="file" id="wh2-xl-file" accept=".xlsx,.xls" style="display:none"></label>
      <span id="wh2-xl-status" style="font-size:12px;color:var(--gold);margin-left:8px"></span>
      <div id="wh2-xl-preview" style="margin-top:8px"></div>
      <button class="wh2-btn" id="wh2-xl-cancel" style="margin-top:8px">Закрыть</button>
    </div>`;
    document.getElementById('wh2-xl-cancel').onclick = () => { sub.innerHTML = ''; };
    let parsedRows = [];
    document.getElementById('wh2-xl-file').onchange = async (ev) => {
      const file = ev.target.files && ev.target.files[0]; if (!file) return;
      const st = document.getElementById('wh2-xl-status'); st.textContent = 'Разбор…';
      try {
        const fd = new FormData(); fd.append('file', file);
        const t = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token');
        const r = await fetch('/api/warehouse-cart/parse-excel', { method: 'POST', headers: { Authorization: 'Bearer ' + t }, body: fd });
        const d = await r.json(); if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
        parsedRows = d.rows || []; st.textContent = '';
        const prev = document.getElementById('wh2-xl-preview');
        prev.innerHTML = `<div style="max-height:200px;overflow:auto;border:1px solid var(--border);border-radius:8px">
          ${parsedRows.map((x, i) => `<div class="wh2-cart-row ${x.is_new_position ? 'wh2-row-new' : ''}" style="padding:7px">
            <div style="flex:1"><b>${esc(x.name)}</b>${x.is_new_position ? ' <span class="wh2-chip" style="background:rgba(224,168,0,.2);color:#e0a800">🆕</span>' : ''}<div style="font-size:12px;color:var(--t2)">${x.matched ? 'на складе ' + fmt(x.available_qty) + ' · ' + _money(x.last_price) : 'нет в каталоге'}</div></div>
            <input type="number" min="1" value="${x.quantity || 1}" data-xl-q="${i}" style="width:60px;padding:5px;border:1px solid var(--border);border-radius:6px;background:var(--bg2,#0f1217);color:inherit">
            <input type="number" min="0" value="${x.unit_price != null ? x.unit_price : ''}" placeholder="цена" data-xl-p="${i}" style="width:80px;padding:5px;border:1px solid var(--border);border-radius:6px;background:var(--bg2,#0f1217);color:inherit">
          </div>`).join('')}</div>
          <button class="wh2-btn wh2-btn--primary" id="wh2-xl-add" style="margin-top:8px;width:100%">Добавить в корзину (${parsedRows.length})</button>`;
        document.getElementById('wh2-xl-add').onclick = async () => {
          prev.querySelectorAll('[data-xl-q]').forEach(inp => { parsedRows[+inp.dataset.xlQ].quantity = parseFloat(inp.value) || 1; });
          prev.querySelectorAll('[data-xl-p]').forEach(inp => { parsedRows[+inp.dataset.xlP].unit_price = inp.value === '' ? null : parseFloat(inp.value); });
          const items = parsedRows.map(x => x.matched
            ? { item_type: 'consumable', product_id: x.product_id, need_qty: x.quantity, source: 'excel' }
            : { item_type: 'new_position', custom_name: x.name, need_qty: x.quantity, manual_price: x.unit_price, supplier_name: x.supplier_name, source: 'excel' });
          await addToCart({ warehouse_id: _cart.warehouse_id, items });
          _redrawCart();
        };
      } catch (e) { st.textContent = ''; toast('Ошибка', e.message, 'err'); }
    };
  }

  // ── Предпросмотр разбивки ──
  async function openSubmitPreview() {
    let d; try { d = await api('/api/warehouse-cart/preview-submit', { method: 'POST', body: JSON.stringify({}) }); } catch (e) { toast('Ошибка', e.message, 'err'); return; }
    const sec = (title, rows, body) => rows.length ? `<div style="margin-bottom:12px"><div style="font-weight:700;margin-bottom:6px">${title}</div>
      <table class="wh2-table" style="margin:0"><tbody>${body}</tbody></table></div>` : '';
    const html = `<div style="min-width:460px;max-width:680px">
      ${sec('🔒 Зарезервируется со склада', d.reserve_lines, d.reserve_lines.map(l => `<tr><td><b>${esc(l.name)}</b></td><td style="text-align:right">${fmt(l.reserve_qty)} ${esc(l.unit || 'шт')}</td></tr>`).join(''))}
      ${sec('🛍️ Уйдёт в закупку (дефицит)', d.procure_lines, d.procure_lines.map(l => `<tr><td><b>${esc(l.name)}</b>${l.is_new_position ? ' <span class="wh2-chip" style="background:rgba(224,168,0,.2);color:#e0a800">🆕</span>' : ''}</td><td style="text-align:right">${fmt(l.deficit_qty)} ${esc(l.unit || 'шт')}</td><td style="text-align:right">${_money(l.last_price)}</td></tr>`).join(''))}
      ${sec('🔧 Оборудование (резерв)', d.equipment_lines, d.equipment_lines.map(l => `<tr><td><b>${esc(l.name)}</b></td><td style="text-align:right">${l.available > 0 ? 'на складе' : 'занято/нет'}</td></tr>`).join(''))}
      ${(!d.reserve_lines.length && !d.procure_lines.length && !d.equipment_lines.length) ? '<div class="wh2-empty">Нечего отправлять</div>' : ''}
      <div style="margin:12px 0"><label style="font-size:13px;color:var(--t2)">Привязать все резервы к работе (опц.):</label>
        <select id="wh2-prev-work" style="width:100%;margin-top:4px;padding:8px;border:1px solid var(--border);border-radius:7px;background:var(--bg2,#0f1217);color:inherit">${_workOptions('')}</select></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="wh2-btn" id="wh2-prev-back">← Назад</button>
        <button class="wh2-btn wh2-btn--primary" id="wh2-prev-submit">✓ Подтвердить и отправить</button>
      </div></div>`;
    UI.showModal && UI.showModal({ title: '👁 Предпросмотр разбивки', html });
    document.getElementById('wh2-prev-back').onclick = () => { UI.closeModal && UI.closeModal(); };
    document.getElementById('wh2-prev-submit').onclick = () => submitCart({ global_work_id: document.getElementById('wh2-prev-work').value || null, fromPreview: true });
  }

  // ── Отправка корзины ──
  async function submitCart(opts) {
    const body = { global_work_id: (opts && opts.global_work_id) || null, confirmed: true };
    const sb = document.getElementById('wh2-cart-submit') || document.getElementById('wh2-prev-submit');
    if (sb) { sb.disabled = true; sb.textContent = 'Отправка…'; }
    let res; try { res = await rawApi('/api/warehouse-cart/submit', { method: 'POST', body: JSON.stringify(body) }); } catch (e) { if (sb) { sb.disabled = false; } toast('Ошибка', e.message, 'err'); return; }
    if (res.status === 409 && res.data && res.data.error === 'stock_changed') {
      // закрыть превью (если был) → обновить корзину → подсветить
      if (opts && opts.fromPreview) UI.closeModal && UI.closeModal();
      await _cartSync(); _renderDrawer();
      (res.data.changed || []).forEach(ch => {
        const row = document.querySelector('.wh2-cart-it[data-cid="' + ch.cart_item_id + '"]');
        if (row) { row.classList.add('wh2-cart-it--changed'); const al = row.querySelector('[data-changed="' + ch.cart_item_id + '"]'); if (al) { al.style.display = ''; al.textContent = `⚠️ Остаток изменился: было ${fmt(ch.snapshot_available)}, сейчас ${fmt(ch.new_available)}`; } }
      });
      toast('Остатки изменились', 'Проверьте выделенные позиции и скорректируйте количество', 'warn');
      return;
    }
    if (res.status === 409 && res.data && res.data.error === 'equipment_taken') {
      if (sb) { sb.disabled = false; sb.textContent = 'Отправить заявку →'; }
      toast('Оборудование занято', 'Уже забрали: ' + (res.data.taken || []).join(', '), 'err'); return;
    }
    if (!res.ok) { if (sb) { sb.disabled = false; sb.textContent = 'Отправить заявку →'; } toast('Ошибка', (res.data && res.data.error) || 'Не удалось отправить', 'err'); return; }
    // успех
    _cart = { id: null, warehouse_id: _cart.warehouse_id, items: [] };
    try { localStorage.removeItem(_cartLSKey()); } catch (_) {}
    _updateCartBadge();
    if (opts && opts.fromPreview) UI.closeModal && UI.closeModal();
    closeCartDrawer();
    const r = res.data;
    toast('Отправлено', `Зарезервировано: ${(r.reservations || []).length} · ${r.procurement_id ? 'Закупка #' + r.procurement_id : 'без закупки'}`, 'ok');
    refresh();
  }

  // ════════════════════ ВКЛАДКА: РАСХОДНИКИ (каталог + наличие в одном) ════════════════════
  async function renderConsumables(container, search) {
    container.innerHTML = `
      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        <button class="wh2-btn" id="wh2-cons-import">📄 Загрузить накладную/счёт</button>
        <button class="wh2-btn" data-cop="receipt">📥 Приход</button>
        <button class="wh2-btn" data-cop="issue">📤 Расход</button>
        <button class="wh2-btn" data-cop="transfer">🔄 Перемещение</button>
        <button class="wh2-btn" data-cop="writeoff">🗑️ Списание</button>
        <span style="flex:1"></span>
        <button class="wh2-btn" id="wh2-cview-table">☰ Таблицей</button>
      </div>
      <div style="font-size:12px;color:var(--t2);margin:-8px 0 12px">Жмите «+ В корзину» на позициях → корзина 🛒 в углу справа-снизу → отправьте одной заявкой (наличие зарезервируется, дефицит уйдёт в закупку).</div>
      <div id="wh2-cons-body"></div>`;
    container.querySelectorAll('[data-cop]').forEach(b => b.onclick = () => openStockOp(b.dataset.cop));
    const importBtn = container.querySelector('#wh2-cons-import');
    if (importBtn) importBtn.onclick = () => openCatalogImport();
    const tableBtn = container.querySelector('#wh2-cview-table');
    let tableMode = false;
    const draw = () => tableMode ? renderStock(container.querySelector('#wh2-cons-body'), search) : renderCatalog(container.querySelector('#wh2-cons-body'), search);
    if (tableBtn) tableBtn.onclick = () => { tableMode = !tableMode; tableBtn.textContent = tableMode ? '▦ Карточки' : '☰ Таблицей'; draw(); };
    draw();
  }

  // ════════════════════ КАТАЛОГ-КАРТОЧКИ (используется внутри «Расходники») ════════════════════
  async function renderCatalog(container, search) {
    container.innerHTML = _skelCards(8);
    let prods = [];
    try { const d = await api('/api/products?limit=200' + (search ? '&search=' + encodeURIComponent(search) : '')); prods = d.items || []; }
    catch (e) { container.innerHTML = `<div class="wh2-empty"><div class="wh2-empty__i">⚠️</div>${esc(e.message)}</div>`; return; }
    if (!prods.length) {
      container.innerHTML = search
        ? _emptyState('🔍', 'Ничего не найдено', 'По запросу «' + search + '» позиций нет. Измените поиск или добавьте новую позицию.', null, null)
        : _emptyState('📭', 'Каталог расходников пуст', 'Загрузите накладную/счёт или добавьте позиции вручную — каталог наполнится.', '📄 Загрузить накладную/счёт', 'wh2-empty-import');
      const ib = document.getElementById('wh2-empty-import'); if (ib) ib.onclick = () => openCatalogImport();
      return;
    }
    const CAT_ICON = c => { c = (c || '').toLowerCase();
      if (c.includes('сиз') || c.includes('защит')) return '🦺';
      if (c.includes('хими') || c.includes('расходн')) return '🧪';
      if (c.includes('метиз') || c.includes('крепёж') || c.includes('крепеж')) return '🔩';
      if (c.includes('электр')) return '⚡'; if (c.includes('сантех')) return '🚿';
      if (c.includes('насос') || c.includes('оборуд')) return '⚙️'; if (c.includes('шланг') || c.includes('рукав')) return '🪢';
      if (c.includes('инструм')) return '🛠️'; if (c.includes('строит')) return '🧱'; if (c.includes('аренд')) return '🚜';
      return '📦'; };
    const AV_COLORS = ['#D4A843', '#4A90D9', '#30d158', '#ff8c42', '#a56eff', '#5ac8d8'];
    container.innerHTML = `<div class="wh2-cards">${prods.map((p, idx) => `
      <div class="wh2-card" data-pid="${p.id}" style="animation-delay:${Math.min(idx * 0.03, 0.4)}s">
        <div class="wh2-card__top">
          <div style="display:flex;gap:11px;align-items:flex-start;flex:1;min-width:0">
            ${p.photo_url
              ? `<img src="${esc(p.photo_url)}" style="width:42px;height:42px;border-radius:12px;flex-shrink:0;object-fit:cover">`
              : (window.AsgardGoodsIcon && (p.icon_path || p.icon_slug)
                ? `<div style="width:48px;height:48px;border-radius:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:${AV_COLORS[idx % AV_COLORS.length]}22">${window.AsgardGoodsIcon.placeholder({ slug: p.icon_slug, path: p.icon_path, size: 36, alt: p.name })}</div>`
                : `<div style="width:42px;height:42px;border-radius:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:22px;background:${AV_COLORS[idx % AV_COLORS.length]}22">${CAT_ICON(p.category_name)}</div>`)}
            <div style="min-width:0">
              <div class="wh2-card__name">${esc(p.name)}</div>
              <div class="wh2-card__sub">${esc(p.category_name || 'Без категории')}${p.article ? ' • ' + esc(p.article) : ''}</div>
            </div>
          </div>
          ${p.is_draft ? '<span class="wh2-chip wh2-chip--draft">черновик</span>' : ''}
        </div>
        <div class="wh2-card__sub" style="display:flex;gap:6px;align-items:center">
          ${p.is_consumable ? '<span class="wh2-chip wh2-chip--cons">расходник</span>' : '<span class="wh2-chip wh2-chip--ok">учётная ед.</span>'}
          ${p.ean ? '<span style="opacity:.6">EAN ' + esc(p.ean) + '</span>' : ''}
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:auto;padding-top:8px;border-top:1px solid var(--border,#262c38)">
          <div class="wh2-avail" data-avail="${p.id}" style="flex:1;border:none;padding:0;margin:0"><span class="wh2-card__sub">наличие…</span></div>
          ${cartStepper('consumable', p.id)}
        </div>
      </div>`).join('')}</div>`;
    container.querySelectorAll('.wh2-card[data-pid]').forEach(c => c.onclick = () => openProduct(+c.dataset.pid));
    // степперы на карточках
    container.querySelectorAll('.wh2-stp[data-step-pid]').forEach(el => _bindStepper(el));
    // SVG-иконки каталога — inline fetch (для наследования --icon-ink/--icon-accent)
    if (window.AsgardGoodsIcon) window.AsgardGoodsIcon.hydrate(container);
    // подгрузка наличия по каждой позиции (лениво, параллельно)
    prods.forEach(async p => {
      try {
        const a = await api('/api/stock/availability/' + p.id);
        const el = container.querySelector(`[data-avail="${p.id}"]`); if (!el) return;
        const z = !a.total;
        el.innerHTML = `<span class="wh2-avail__n ${z ? 'wh2-avail__n--zero' : ''}">${fmt(a.total)}</span>
          <span class="wh2-card__sub">${z ? 'нет на складе' : (a.slots[0] ? esc(a.slots[0].location_label || a.slots[0].warehouse_name || '') : '')}</span>`;
      } catch (_) {}
    });
  }

  async function openProduct(pid) {
    let card;
    try { card = await api('/api/stock/product/' + pid + '/card'); }
    catch (e) { toast('Ошибка', e.message, 'err'); return; }
    const p = card.item, slots = card.slots || [], moves = card.movements || [], lp = card.last_price;
    const photo = p.photo_url
      ? `<img src="${esc(p.photo_url)}" style="width:96px;height:96px;border-radius:14px;object-fit:cover;border:1px solid var(--border,#262c38)">`
      : `<div style="width:96px;height:96px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:44px;background:rgba(212,168,67,.12)">📦</div>`;
    UI.showModal && UI.showModal({
      title: esc(p.name),
      html: `<div style="display:flex;flex-direction:column;gap:16px;min-width:380px">
        <div style="display:flex;gap:14px">
          <label style="cursor:pointer;position:relative" title="Загрузить фото">
            ${photo}
            <input type="file" id="wh2-photo" accept="image/*" style="display:none">
            <span style="position:absolute;bottom:-4px;right:-4px;background:var(--gold,#D4A843);color:#1a1408;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:13px">📷</span>
          </label>
          <div style="flex:1;display:flex;flex-direction:column;gap:8px">
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              ${p.is_draft ? '<span class="wh2-chip wh2-chip--draft">черновик</span>' : ''}
              ${p.is_consumable ? '<span class="wh2-chip wh2-chip--cons">расходник</span>' : '<span class="wh2-chip wh2-chip--ok">учётная единица</span>'}
            </div>
            <div class="wh2-card__sub">${esc(p.category_name || 'Без категории')} • ${esc(p.unit)}${p.article ? ' • арт. ' + esc(p.article) : ''}${p.ean ? ' • EAN ' + esc(p.ean) : ''}</div>
            <div><b style="font-size:28px;color:${card.total ? 'var(--ok-t,#30d158)' : 'var(--t2,#8b93a3)'}">${fmt(card.total)}</b> <span class="wh2-card__sub">${esc(p.unit)} в наличии</span></div>
            ${lp ? `<div class="wh2-card__sub">💰 посл. цена: <b>${fmt(lp.unit_price)} ₽</b>${lp.supplier_name ? ' · ' + esc(lp.supplier_name) : ''}</div>` : ''}
          </div>
        </div>
        ${slots.length ? `<div><div class="wh2-card__sub" style="margin-bottom:6px;font-weight:600">Где лежит</div>
          <table class="wh2-table"><tbody>${slots.map(s => `<tr><td>${esc(s.warehouse_name || '—')}</td><td><b style="color:var(--gold,#D4A843)">${esc(s.location_label || 'без ячейки')}</b></td><td style="text-align:right">${fmt(s.quantity)} ${esc(s.unit)}</td></tr>`).join('')}</tbody></table></div>` : ''}
        ${moves.length ? `<div><div class="wh2-card__sub" style="margin-bottom:6px;font-weight:600">Последние движения</div>
          ${moves.slice(0, 6).map(m => { const meta = MOVE_META[m.movement_type] || { i: '•', l: m.movement_type }; return `<div class="wh2-mv" style="padding:7px 0"><div class="wh2-mv__ic" style="background:${meta.c || 'rgba(139,147,163,.15)'};width:28px;height:28px;font-size:14px">${meta.i}</div><div style="flex:1"><span style="font-size:13px">${meta.l} ${fmt(m.qty)} ${esc(m.unit)}</span>${m.reason ? ` <span class="wh2-card__sub">· ${esc(m.reason)}</span>` : ''}</div><span class="wh2-card__sub">${new Date(m.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}</span></div>`; }).join('')}</div>` : ''}
        ${p.is_draft ? `<button class="wh2-btn wh2-btn--primary" id="wh2-confirm-draft">✅ Подтвердить позицию (снять черновик)</button>` : ''}
      </div>`
    });
    // загрузка фото
    const photoInput = document.getElementById('wh2-photo');
    if (photoInput) photoInput.onchange = async () => {
      const f = photoInput.files[0]; if (!f) return;
      const fd = new FormData(); fd.append('photo', f);
      try {
        const t = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token');
        const r = await fetch('/api/stock/product/' + pid + '/photo', { method: 'POST', headers: { Authorization: 'Bearer ' + t }, body: fd });
        if (!r.ok) throw new Error('Не удалось загрузить'); toast('Фото', 'Загружено', 'ok'); openProduct(pid);
      } catch (e) { toast('Ошибка', e.message, 'err'); }
    };
    const cb = document.getElementById('wh2-confirm-draft');
    if (cb) cb.onclick = async () => { try { await api('/api/stock/products/' + pid + '/confirm', { method: 'PUT' }); toast('Готово', 'Позиция подтверждена', 'ok'); UI.closeModal && UI.closeModal(); refresh(); } catch (e) { toast('Ошибка', e.message, 'err'); } };
  }

  function openQuickProduct() {
    const catsOpts = _cats.map(c => `<option value="${c.id}">${esc((c.parent_id ? '— ' : '') + c.name)}</option>`).join('');
    UI.showModal && UI.showModal({
      title: '➕ Новая позиция каталога',
      html: `<div style="display:flex;flex-direction:column;gap:12px">
        <input id="wh2-qp-name" class="wh2-btn" style="text-align:left" placeholder="Наименование *">
        <div style="display:flex;gap:10px">
          <input id="wh2-qp-unit" class="wh2-btn" style="text-align:left;flex:1" placeholder="Ед. (шт)" value="шт">
          <input id="wh2-qp-ean" class="wh2-btn" style="text-align:left;flex:1" placeholder="EAN/штрихкод">
        </div>
        <select id="wh2-qp-cat" class="wh2-btn" style="text-align:left"><option value="">Категория…</option>${catsOpts}</select>
        <label style="font-size:13px;color:var(--t2);display:flex;gap:8px;align-items:center"><input type="checkbox" id="wh2-qp-cons"> Расходник (количественный учёт)</label>
        <button class="wh2-btn wh2-btn--primary" id="wh2-qp-save">Создать</button>
      </div>`
    });
    document.getElementById('wh2-qp-save').onclick = async () => {
      const name = document.getElementById('wh2-qp-name').value.trim();
      if (!name) { toast('Внимание', 'Введите наименование', 'warn'); return; }
      try {
        const body = { name, unit: document.getElementById('wh2-qp-unit').value.trim() || 'шт', ean: document.getElementById('wh2-qp-ean').value.trim() || null, category_id: document.getElementById('wh2-qp-cat').value || null, created_from: 'manual' };
        const r = await api('/api/stock/quick-product', { method: 'POST', body: JSON.stringify(body) });
        if (document.getElementById('wh2-qp-cons').checked && r.item) await api('/api/products/' + r.item.id, { method: 'PUT', body: JSON.stringify({ is_consumable: true }) }).catch(() => {});
        toast(r.existed ? 'Найдено' : 'Создано', r.existed ? 'Позиция уже была в каталоге' : 'Позиция добавлена', 'ok');
        UI.closeModal && UI.closeModal(); refresh();
      } catch (e) { toast('Ошибка', e.message, 'err'); }
    };
  }

  // ════════════════════ ВКЛАДКА: НАЛИЧИЕ ════════════════════
  async function renderStock(container, search) {
    container.innerHTML = _skelRows(7);
    let rows = [];
    try { const d = await api('/api/stock?limit=500' + (search ? '&search=' + encodeURIComponent(search) : '')); rows = d.items || []; }
    catch (e) { container.innerHTML = `<div class="wh2-empty"><div class="wh2-empty__i">⚠️</div>${esc(e.message)}</div>`; return; }
    if (!rows.length) { container.innerHTML = _emptyState(search ? '🔍' : '📦', search ? 'Ничего не найдено' : 'Нет остатков', search ? 'Измените поиск.' : 'Оприходуйте расходники через «📥 Приход».', null, null); return; }
    container.innerHTML = `<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        <button class="wh2-btn" data-op="receipt">📥 Приход</button>
        <button class="wh2-btn" data-op="issue">📤 Расход</button>
        <button class="wh2-btn" data-op="transfer">🔄 Перемещение</button>
        <button class="wh2-btn" data-op="writeoff">🗑️ Списание</button>
      </div>
      <table class="wh2-table"><thead><tr>
      <th>Позиция</th><th>Склад</th><th>Ячейка</th><th>Остаток</th><th>Мин.</th><th></th><th>🛒</th></tr></thead><tbody>
      ${rows.map(r => {
        const low = r.min_stock_level > 0 && Number(r.quantity) <= Number(r.min_stock_level);
        const icon = window.AsgardGoodsIcon && (r.icon_path || r.icon_slug)
          ? window.AsgardGoodsIcon.placeholder({ slug: r.icon_slug, path: r.icon_path, size: 32, alt: r.product_name })
          : '';
        return `<tr>
          <td><span style="display:inline-flex;align-items:center;gap:8px">${icon}<b>${esc(r.product_name)}</b></span>${r.article ? ' <span style="opacity:.5">' + esc(r.article) + '</span>' : ''}</td>
          <td>${esc(r.warehouse_name || '—')}</td><td>${esc(r.location_label || '—')}</td>
          <td><b style="color:${low ? 'var(--err-t,#ff5c5c)' : 'var(--ok-t,#30d158)'}">${fmt(r.quantity)}</b> ${esc(r.unit)}</td>
          <td>${r.min_stock_level > 0 ? fmt(r.min_stock_level) : '—'}</td>
          <td>${low ? '<span class="wh2-chip wh2-chip--warn">низкий</span>' : ''}</td>
          <td>${r.product_id ? cartStepper('consumable', r.product_id) : ''}</td>
        </tr>`;
      }).join('')}</tbody></table>`;
    container.querySelectorAll('[data-op]').forEach(b => b.onclick = () => openStockOp(b.dataset.op));
    container.querySelectorAll('.wh2-stp[data-step-pid]').forEach(el => _bindStepper(el));
    if (window.AsgardGoodsIcon) window.AsgardGoodsIcon.hydrate(container);
  }

  // Операция со складом (приход/расход/перемещение/списание) — drawer-форма
  const OP_TITLES = { receipt: '📥 Приход', issue: '📤 Расход', transfer: '🔄 Перемещение', writeoff: '🗑️ Списание' };
  async function openStockOp(op) {
    let prods = [], locs = [];
    try { prods = (await api('/api/products?limit=300')).items || []; } catch (_) {}
    try { locs = (await api('/api/warehouse/locations?limit=500')).items || []; } catch (_) {}
    const prodOpts = prods.map(p => `<option value="${p.id}" data-unit="${esc(p.unit)}">${esc(p.name)}${p.article ? ' (' + esc(p.article) + ')' : ''}</option>`).join('');
    const locOpts = `<option value="">— без ячейки —</option>` + locs.map(l => `<option value="${l.id}">${esc(l.label || l.zone)} · ${esc(l.warehouse_name || '')}</option>`).join('');
    const isTransfer = op === 'transfer';
    UI.showModal && UI.showModal({
      title: OP_TITLES[op],
      html: `<div style="display:flex;flex-direction:column;gap:12px;min-width:340px">
        <select id="wh2-op-prod" class="wh2-btn" style="text-align:left">${prodOpts}</select>
        <div style="display:flex;gap:10px">
          <input id="wh2-op-qty" type="number" min="0" step="any" class="wh2-btn" style="text-align:left;flex:1" placeholder="Количество">
          <input id="wh2-op-unit" class="wh2-btn" style="text-align:left;width:90px" placeholder="ед" value="шт">
        </div>
        ${isTransfer ? `<select id="wh2-op-from" class="wh2-btn" style="text-align:left"><option value="">Откуда (ячейка)</option>${locOpts}</select>
          <select id="wh2-op-to" class="wh2-btn" style="text-align:left"><option value="">Куда (ячейка)</option>${locOpts}</select>`
          : `<select id="wh2-op-loc" class="wh2-btn" style="text-align:left">${locOpts}</select>`}
        ${op === 'writeoff' ? `<input id="wh2-op-reason" class="wh2-btn" style="text-align:left" placeholder="Причина списания *">` : `<input id="wh2-op-reason" class="wh2-btn" style="text-align:left" placeholder="Комментарий (необязательно)">`}
        <button class="wh2-btn wh2-btn--primary" id="wh2-op-save">Применить</button>
      </div>`
    });
    const prodEl = document.getElementById('wh2-op-prod');
    const unitEl = document.getElementById('wh2-op-unit');
    const syncUnit = () => { const o = prodEl.selectedOptions[0]; if (o && o.dataset.unit) unitEl.value = o.dataset.unit; };
    prodEl.onchange = syncUnit; syncUnit();
    document.getElementById('wh2-op-save').onclick = async () => {
      const product_id = +prodEl.value, qty = parseFloat(document.getElementById('wh2-op-qty').value), unit = unitEl.value.trim() || 'шт';
      const reason = document.getElementById('wh2-op-reason').value.trim();
      if (!product_id || !qty || qty <= 0) { toast('Внимание', 'Выберите позицию и количество', 'warn'); return; }
      if (op === 'writeoff' && !reason) { toast('Внимание', 'Укажите причину списания', 'warn'); return; }
      let body = { product_id, qty, unit, reason };
      if (isTransfer) { body.from_location_id = document.getElementById('wh2-op-from').value || null; body.to_location_id = document.getElementById('wh2-op-to').value || null; }
      else body.location_id = document.getElementById('wh2-op-loc').value || null;
      try { await api('/api/stock/' + op, { method: 'POST', body: JSON.stringify(body) }); toast('Готово', OP_TITLES[op] + ' выполнен', 'ok'); UI.closeModal && UI.closeModal(); refresh(); }
      catch (e) { toast('Ошибка', e.message, 'err'); }
    };
  }

  // ════════════════════ ВКЛАДКА: ЯЧЕЙКИ ════════════════════
  async function renderLocations(container) {
    container.innerHTML = `<div class="wh2-loading">Загрузка ячеек…</div>`;
    let locs = [];
    try { const d = await api('/api/warehouse/locations?limit=1000'); locs = d.items || []; }
    catch (e) { container.innerHTML = `<div class="wh2-empty"><div class="wh2-empty__i">⚠️</div>${esc(e.message)}</div>`; return; }
    if (!locs.length) { container.innerHTML = `<div class="wh2-empty"><div class="wh2-empty__i">🗺️</div>Ячейки не заданы.<br><button class="wh2-btn wh2-btn--primary" id="wh2-bulk" style="margin-top:14px">Сгенерировать сетку ячеек</button></div>`; bindBulk(container); return; }
    container.innerHTML = `<div class="wh2-cellmap">${locs.map(l => `
      <div class="wh2-cell ${l.stock_lines > 0 || l.unit_count > 0 ? 'wh2-cell--full' : ''}">
        <div class="wh2-cell__lbl">${esc(l.label || l.zone)}</div>
        <div class="wh2-cell__cnt">${esc(l.warehouse_name || '')}</div>
        <div class="wh2-cell__cnt">${(+l.stock_lines || 0) + (+l.unit_count || 0)} поз.</div>
      </div>`).join('')}</div>`;
  }
  function openBulkModal() {
      const whOpts = _whs.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('');
      UI.showModal && UI.showModal({
        title: '🗺️ Генерация ячеек',
        html: `<div style="display:flex;flex-direction:column;gap:12px">
          <select id="wh2-bk-wh" class="wh2-btn" style="text-align:left">${whOpts}</select>
          <input id="wh2-bk-zone" class="wh2-btn" style="text-align:left" placeholder="Зона (A)" value="A">
          <input id="wh2-bk-racks" class="wh2-btn" style="text-align:left" placeholder="Стеллажи через запятую: 1,2,3">
          <input id="wh2-bk-shelves" class="wh2-btn" style="text-align:left" placeholder="Полки: 1,2,3">
          <input id="wh2-bk-cells" class="wh2-btn" style="text-align:left" placeholder="Ячейки: 1,2,3,4">
          <button class="wh2-btn wh2-btn--primary" id="wh2-bk-save">Создать сетку</button>
        </div>`
      });
      document.getElementById('wh2-bk-save').onclick = async () => {
        const split = v => v.split(',').map(x => x.trim()).filter(Boolean);
        try {
          const body = { warehouse_id: +document.getElementById('wh2-bk-wh').value, zone: document.getElementById('wh2-bk-zone').value.trim() || 'A',
            racks: split(document.getElementById('wh2-bk-racks').value), shelves: split(document.getElementById('wh2-bk-shelves').value), cells: split(document.getElementById('wh2-bk-cells').value) };
          const r = await api('/api/warehouse/locations/bulk', { method: 'POST', body: JSON.stringify(body) });
          toast('Готово', `Создано ячеек: ${r.created} (пропущено ${r.skipped})`, 'ok');
          UI.closeModal && UI.closeModal(); refresh();
        } catch (e) { toast('Ошибка', e.message, 'err'); }
      };
  }
  function bindBulk(container) {
    const b = container.querySelector('#wh2-bulk'); if (!b) return;
    b.onclick = openBulkModal;
  }

  // ════════════════════ ВКЛАДКА: ДВИЖЕНИЯ ════════════════════
  async function renderMovements(container) {
    container.innerHTML = `<div class="wh2-loading">Загрузка журнала…</div>`;
    let rows = [];
    try { const d = await api('/api/stock/movements?limit=100'); rows = d.items || []; }
    catch (e) { container.innerHTML = `<div class="wh2-empty"><div class="wh2-empty__i">⚠️</div>${esc(e.message)}</div>`; return; }
    if (!rows.length) { container.innerHTML = `<div class="wh2-empty"><div class="wh2-empty__i">📜</div>Движений пока нет.</div>`; return; }
    container.innerHTML = rows.map(m => {
      const meta = MOVE_META[m.movement_type] || { i: '•', c: 'rgba(139,147,163,.15)', l: m.movement_type };
      const route = m.from_loc || m.to_loc ? `${esc(m.from_loc || m.from_wh_name || '')}${m.from_loc && m.to_loc ? ' → ' : ''}${esc(m.to_loc || m.to_wh_name || '')}` : '';
      return `<div class="wh2-mv">
        <div class="wh2-mv__ic" style="background:${meta.c}">${meta.i}</div>
        <div style="flex:1"><b>${esc(m.product_name)}</b> <span class="wh2-card__sub">${meta.l} • ${fmt(m.qty)} ${esc(m.unit)}${route ? ' • ' + route : ''}</span>
          ${m.reason ? `<div class="wh2-card__sub">${esc(m.reason)}</div>` : ''}</div>
        <div class="wh2-card__sub">${m.created_by_name ? esc(m.created_by_name) + ' • ' : ''}${new Date(m.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
      </div>`;
    }).join('');
  }

  // ── Шапка KPI ───────────────────────────────────────────────────────────
  async function renderKPIs(el) {
    let catCount = 0, lowCount = 0, locCount = 0, stockLines = 0;
    try { const c = await api('/api/products?limit=1'); } catch (_) {}
    try { const low = await api('/api/stock/low'); lowCount = (low.items || []).length; } catch (_) {}
    try { const loc = await api('/api/warehouse/locations?limit=1'); } catch (_) {}
    // Точные счётчики: каталог и ячейки берём отдельными лёгкими запросами
    try { const all = await api('/api/products?limit=500'); catCount = (all.items || []).length; } catch (_) {}
    try { const l = await api('/api/warehouse/locations?limit=2000'); locCount = (l.items || []).length; } catch (_) {}
    try { const s = await api('/api/stock?limit=1000'); stockLines = (s.items || []).length; } catch (_) {}
    el.innerHTML = `
      <div class="wh2-kpi wh2-kpi--gold"><div class="wh2-kpi__i">📚</div><div class="wh2-kpi__v">${fmt(catCount)}</div><div class="wh2-kpi__l">Позиций в каталоге</div></div>
      <div class="wh2-kpi wh2-kpi--ok"><div class="wh2-kpi__i">📦</div><div class="wh2-kpi__v">${fmt(stockLines)}</div><div class="wh2-kpi__l">Строк наличия</div></div>
      <div class="wh2-kpi ${lowCount ? 'wh2-kpi--warn' : ''}"><div class="wh2-kpi__i">⚠️</div><div class="wh2-kpi__v">${fmt(lowCount)}</div><div class="wh2-kpi__l">Ниже минимума</div></div>
      <div class="wh2-kpi"><div class="wh2-kpi__i">🗺️</div><div class="wh2-kpi__v">${fmt(locCount)}</div><div class="wh2-kpi__l">Ячеек хранения</div></div>`;
  }

  // ── Перерисовка активной вкладки ──────────────────────────────────────────
  let _searchVal = '';
  async function refresh() {
    const body = _root.querySelector('#wh2-body');
    const toolbar = _root.querySelector('#wh2-toolbar');
    // toolbar зависит от вкладки. На «Оборудование» поиск и кнопки рисует сам модуль.
    const addBtn = toolbar.querySelector('#wh2-add');
    addBtn.style.display = (_tab === 'consumables' || _tab === 'locations') ? '' : 'none';
    if (_tab === 'consumables') addBtn.textContent = '➕ Позиция';
    toolbar.style.display = (_tab === 'equipment' || _tab === 'incoming' || _tab === 'movements') ? 'none' : '';
    renderKPIs(_root.querySelector('#wh2-kpis'));
    if (_tab === 'consumables') return renderConsumables(body, _searchVal);
    if (_tab === 'equipment') {
      // Полноценный блок оборудования вынесен в warehouse-v2-equipment.js (window.WH2Equipment).
      if (window.WH2Equipment) {
        if (WH2Equipment.setCartCallbacks) WH2Equipment.setCartCallbacks({ isInCart, addToCart, removeFromCart, removeByEquipment, getWarehouseId: () => _cart.warehouse_id });
        return window.WH2Equipment.render(body, { user: _user, api, esc, toast, fmt, UI, search: _searchVal });
      }
      body.innerHTML = `<div class="wh2-empty"><div class="wh2-empty__i">🛠️</div>Модуль оборудования не загружен.</div>`;
      return;
    }
    if (_tab === 'incoming') return renderIncoming(body);
    if (_tab === 'locations') return renderLocations(body);
    if (_tab === 'movements') return renderMovements(body);
  }

  // ════════════════════ ВКЛАДКА: ПРИЁМКА (входящие закупки онлайн) ════════════════════
  const PI_STATUS = {
    pending: { l: 'Ожидает', c: '#8b93a3' }, ordered: { l: 'Заказано', c: '#ffb020' },
    shipped: { l: 'В пути', c: '#4A90D9' }, delivered: { l: 'Доставлено', c: '#30d158' },
    partially_delivered: { l: 'Частично', c: '#ffb020' },
  };
  async function renderIncoming(container) {
    container.innerHTML = `<div class="wh2-loading">Загрузка входящих поставок…</div>`;
    let data;
    try { data = await api('/api/stock/incoming?target=all'); }
    catch (e) { container.innerHTML = `<div class="wh2-empty"><div class="wh2-empty__i">⚠️</div>${esc(e.message)}</div>`; return; }
    const rows = data.items || [], sm = data.summary || {};
    if (!rows.length) { container.innerHTML = `<div class="wh2-empty"><div class="wh2-empty__i">🚚</div>Входящих поставок нет.</div>`; return; }
    const wh = rows.filter(r => r.delivery_target === 'warehouse');
    const obj = rows.filter(r => r.delivery_target === 'object');
    const dt = d => d ? new Date(d).toLocaleDateString('ru-RU') : '—';
    const overdue = d => d && new Date(d) < new Date() ? 'color:var(--err-t,#ff5c5c);font-weight:700' : '';
    const row = r => {
      const st = PI_STATUS[r.item_status] || { l: r.item_status, c: '#8b93a3' };
      const deadline = r.delivery_deadline || r.needed_by;
      return `<tr>
        <td><b>${esc(r.name)}</b>${r.article ? ' <span style="opacity:.5">' + esc(r.article) + '</span>' : ''}</td>
        <td>${fmt(r.quantity)} ${esc(r.unit || 'шт')}</td>
        <td><span class="wh2-chip" style="background:${st.c}22;color:${st.c}">${st.l}</span></td>
        <td>${esc(r.work_title || r.object_name || '—')}</td>
        <td style="${overdue(deadline)}">${dt(deadline)}</td>
        <td>${esc(r.proc_name || '—')}</td></tr>`;
    };
    container.innerHTML = `
      <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
        <div class="wh2-kpi wh2-kpi--blue" style="flex:1;min-width:150px"><div class="wh2-kpi__i">🚚</div><div class="wh2-kpi__v">${fmt(sm.to_warehouse_in_transit || 0)}</div><div class="wh2-kpi__l">В пути на склад</div></div>
        <div class="wh2-kpi wh2-kpi--ok" style="flex:1;min-width:150px"><div class="wh2-kpi__i">📦</div><div class="wh2-kpi__v">${fmt(sm.to_warehouse_delivered || 0)}</div><div class="wh2-kpi__l">Доставлено на склад</div></div>
        <div class="wh2-kpi" style="flex:1;min-width:150px"><div class="wh2-kpi__i">📍</div><div class="wh2-kpi__v">${fmt(sm.to_object || 0)}</div><div class="wh2-kpi__l">Напрямую на объект</div></div>
      </div>
      ${wh.length ? `<div style="font-weight:700;margin:8px 0">🏬 На склад (приёмка кладовщиком)</div>
        <table class="wh2-table"><thead><tr><th>Позиция</th><th>Кол-во</th><th>Статус</th><th>Работа/объект</th><th>Срок</th><th>Закупщик</th></tr></thead><tbody>${wh.map(row).join('')}</tbody></table>` : ''}
      ${obj.length ? `<div style="font-weight:700;margin:18px 0 8px">📍 Напрямую на объект (мимо склада — для информации)</div>
        <table class="wh2-table"><thead><tr><th>Позиция</th><th>Кол-во</th><th>Статус</th><th>Работа/объект</th><th>Срок</th><th>Закупщик</th></tr></thead><tbody>${obj.map(row).join('')}</tbody></table>` : ''}`;
  }

  // ════════════════════ УПД/счёт/Excel/фото → КАТАЛОГ ════════════════════
  // Загрузил документ мимо СРМ → распарсили → предпросмотр/редактирование → позиции
  // в каталог (products) / оборудование (equipment) + цены (price_records) + поставщик.
  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector('script[data-ci-lib="' + src + '"]')) return res();
      const s = document.createElement('script'); s.src = src; s.async = true;
      s.dataset.ciLib = src; s.onload = () => res(); s.onerror = () => rej(new Error('Не удалось загрузить ' + src));
      document.head.appendChild(s);
    });
  }
  // Извлечение текста из PDF (pdf.js) или изображения (Tesseract.js) — для AI-разбора.
  async function extractDocText(file, onProgress) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf') {
      onProgress && onProgress('Чтение PDF…');
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      const pdfjs = window.pdfjsLib;
      if (!pdfjs) throw new Error('PDF-движок недоступен');
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const buf = await file.arrayBuffer();
      const doc = await pdfjs.getDocument({ data: buf }).promise;
      let text = '';
      for (let p = 1; p <= Math.min(doc.numPages, 15); p++) {
        onProgress && onProgress('Страница ' + p + '/' + doc.numPages + '…');
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        text += tc.items.map(i => i.str).join(' ') + '\n';
      }
      // PDF без текстового слоя (скан) → попробуем OCR первой страницы как картинку.
      if (text.replace(/\s/g, '').length < 30) throw new Error('PDF без текста (скан). Сфотографируйте или приложите Excel.');
      return text;
    }
    // изображение → OCR
    onProgress && onProgress('Загрузка OCR…');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.0/tesseract.min.js');
    if (!window.Tesseract) throw new Error('OCR-движок недоступен');
    onProgress && onProgress('Распознавание текста…');
    const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = e => res(e.target.result); r.onerror = rej; r.readAsDataURL(file); });
    const out = await window.Tesseract.recognize(dataUrl, 'rus+eng');
    const text = (out && out.data && out.data.text) || '';
    if (text.replace(/\s/g, '').length < 10) throw new Error('Не удалось распознать текст на фото');
    return text;
  }

  let _ciItems = [], _ciImportId = null, _ciSupplier = '';
  function openCatalogImport() {
    UI.showModal && UI.showModal({
      title: '📄 Загрузить накладную / счёт / УПД',
      html: `<div style="display:flex;flex-direction:column;gap:14px" id="wh2-ci-root">
        <div style="font-size:13px;color:var(--t2)">Excel — разбирается сразу. PDF / фото — через AI (текст распознаётся в браузере).</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <select id="wh2-ci-doctype" class="wh2-btn" style="text-align:left">
            <option value="invoice">Счёт</option>
            <option value="upd">УПД</option>
            <option value="quote">КП</option>
            <option value="other">Накладная / другое</option>
          </select>
          <label class="wh2-btn wh2-btn--primary" style="cursor:pointer;margin:0">
            📎 Выбрать файл<input type="file" id="wh2-ci-file" accept=".xlsx,.xls,.pdf,image/*" style="display:none">
          </label>
          <span id="wh2-ci-fname" style="font-size:13px;color:var(--t2)"></span>
        </div>
        <div id="wh2-ci-status" style="font-size:13px;color:var(--gold)"></div>
        <div id="wh2-ci-preview"></div>
      </div>`
    });
    const fileInput = document.getElementById('wh2-ci-file');
    const fnameEl = document.getElementById('wh2-ci-fname');
    const statusEl = document.getElementById('wh2-ci-status');
    const previewEl = document.getElementById('wh2-ci-preview');
    _ciItems = []; _ciImportId = null; _ciSupplier = '';
    const setStatus = (t) => { if (statusEl) statusEl.textContent = t || ''; };

    fileInput.onchange = async () => {
      const file = fileInput.files && fileInput.files[0]; if (!file) return;
      fnameEl.textContent = file.name; previewEl.innerHTML = '';
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      const docType = document.getElementById('wh2-ci-doctype').value;
      try {
        if (ext === 'xlsx' || ext === 'xls') {
          setStatus('Разбор Excel…');
          const fd = new FormData(); fd.append('source_doc', docType); fd.append('file', file);
          const t = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token');
          const r = await fetch('/api/catalog-import/excel', { method: 'POST', headers: { 'Authorization': 'Bearer ' + t }, body: fd });
          const d = await r.json(); if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
          _ciImportId = d.import && d.import.id; _ciItems = d.items || []; _ciSupplier = (d.import && d.import.supplier_name) || '';
        } else {
          const text = await extractDocText(file, setStatus);
          setStatus('AI разбирает документ…');
          const d = await api('/api/catalog-import/ai', { method: 'POST', body: JSON.stringify({ text, source_doc: docType }) });
          if (d.ai_unavailable) { setStatus(''); previewEl.innerHTML = `<div class="wh2-empty"><div class="wh2-empty__i">🤖</div>${esc(d.message || 'AI временно недоступен')}</div>`; return; }
          _ciImportId = d.import && d.import.id; _ciItems = d.items || []; _ciSupplier = d.supplier || '';
        }
        setStatus('');
        if (!_ciItems.length) { previewEl.innerHTML = `<div class="wh2-empty"><div class="wh2-empty__i">📭</div>Позиции не найдены. Попробуйте другой файл.</div>`; return; }
        drawCiPreview(previewEl);
      } catch (e) { setStatus(''); toast('Ошибка', e.message, 'err'); fileInput.value = ''; fnameEl.textContent = ''; }
    };
  }

  function drawCiPreview(host) {
    const rows = _ciItems.map((it, i) => `<tr data-i="${i}">
      <td><input class="wh2-ci-in" data-f="name" style="width:100%;min-width:160px" value="${esc(it.name || '')}"></td>
      <td><input class="wh2-ci-in" data-f="article" style="width:90px" value="${esc(it.article || '')}"></td>
      <td><input class="wh2-ci-in" data-f="quantity" type="number" step="any" style="width:70px" value="${it.quantity != null ? it.quantity : 1}"></td>
      <td><input class="wh2-ci-in" data-f="unit" style="width:60px" value="${esc(it.unit || 'шт')}"></td>
      <td><input class="wh2-ci-in" data-f="unit_price" type="number" step="any" style="width:90px" value="${it.unit_price != null ? it.unit_price : ''}"></td>
      <td style="text-align:center"><input type="checkbox" class="wh2-ci-eq" ${it.is_equipment ? 'checked' : ''}></td>
      <td style="text-align:center"><button class="wh2-btn" data-del="${i}" style="padding:2px 8px">✕</button></td>
    </tr>`).join('');
    host.innerHTML = `
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
        <input id="wh2-ci-supplier" class="wh2-btn" style="text-align:left;flex:1;min-width:200px" placeholder="Поставщик (для цен)" value="${esc(_ciSupplier || '')}">
        <span style="font-size:12px;color:var(--t2)">Позиций: ${_ciItems.length}</span>
      </div>
      <div style="max-height:340px;overflow:auto;border:1px solid var(--border,#262c38);border-radius:12px">
      <table class="wh2-table" style="margin:0"><thead><tr>
        <th>Наименование</th><th>Артикул</th><th>Кол-во</th><th>Ед.</th><th>Цена ₽</th><th title="Оборудование (поштучно в equipment)">Обор.</th><th></th>
      </tr></thead><tbody id="wh2-ci-tbody">${rows}</tbody></table></div>
      <div style="display:flex;gap:10px;margin-top:14px;justify-content:flex-end">
        <button class="wh2-btn" id="wh2-ci-cancel">Отмена</button>
        <button class="wh2-btn wh2-btn--primary" id="wh2-ci-apply">✅ Добавить в каталог</button>
      </div>`;
    // Синхронизация инпутов в _ciItems
    const syncRow = (tr) => {
      const i = parseInt(tr.dataset.i); const it = _ciItems[i]; if (!it) return;
      tr.querySelectorAll('.wh2-ci-in').forEach(inp => {
        const f = inp.dataset.f;
        it[f] = (f === 'quantity' || f === 'unit_price') ? (inp.value === '' ? null : parseFloat(inp.value)) : inp.value;
      });
      it.is_equipment = tr.querySelector('.wh2-ci-eq').checked;
    };
    host.querySelectorAll('#wh2-ci-tbody tr').forEach(tr => {
      tr.querySelectorAll('.wh2-ci-in, .wh2-ci-eq').forEach(inp => inp.onchange = () => syncRow(tr));
    });
    host.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      host.querySelectorAll('#wh2-ci-tbody tr').forEach(syncRow);
      _ciItems.splice(parseInt(b.dataset.del), 1);
      drawCiPreview(host);
    });
    document.getElementById('wh2-ci-cancel').onclick = () => { UI.closeModal && UI.closeModal(); };
    document.getElementById('wh2-ci-apply').onclick = async () => {
      host.querySelectorAll('#wh2-ci-tbody tr').forEach(syncRow);
      const items = _ciItems.filter(it => it.name && String(it.name).trim());
      if (!items.length) { toast('Внимание', 'Нет позиций для добавления', 'warn'); return; }
      const supplier = (document.getElementById('wh2-ci-supplier').value || '').trim();
      const btn = document.getElementById('wh2-ci-apply'); btn.disabled = true; btn.textContent = 'Добавляю…';
      try {
        const d = await api('/api/catalog-import/' + _ciImportId + '/apply', {
          method: 'POST', body: JSON.stringify({ items, supplier_name: supplier || null })
        });
        toast('Готово', `В каталог: ${d.to_catalog || 0} • в оборудование: ${d.to_equipment || 0} • цен: ${d.prices || 0}`, 'ok');
        UI.closeModal && UI.closeModal(); refresh();
      } catch (e) { btn.disabled = false; btn.textContent = '✅ Добавить в каталог'; toast('Ошибка', e.message, 'err'); }
    };
  }

  async function render({ layout, title }) {
    injectCSS();
    try { const ud = await api('/api/users/me'); _user = ud.user || ud; } catch (_) { _user = {}; }
    _cartLoadFromLS();          // мгновенные ✓ из localStorage
    _cartSync();                // актуализируем с сервера (async, не блокирует рендер)
    await loadRefs();
    if (layout) await layout('', { title: title || 'Склад 2.0' });
    const host = document.getElementById('layout') || document.getElementById('main-content') || document.body;
    host.innerHTML = '';
    _root = document.createElement('div'); _root.className = 'wh2';
    _root.innerHTML = `
      <div class="wh2-kpis" id="wh2-kpis"></div>
      <div class="wh2-tabs" id="wh2-tabs">
        <button class="wh2-tab wh2-tab--active" data-tab="equipment">🛠️ Оборудование</button>
        <button class="wh2-tab" data-tab="consumables">🧰 Расходники</button>
        <button class="wh2-tab" data-tab="incoming">🚚 Приёмка</button>
        <button class="wh2-tab" data-tab="locations">🗺️ Ячейки</button>
        <button class="wh2-tab" data-tab="movements">📜 Движения</button>
      </div>
      <div class="wh2-toolbar" id="wh2-toolbar">
        <div class="wh2-search"><input id="wh2-q" placeholder="Поиск по наименованию или артикулу…" autocomplete="off"><button class="wh2-search__clear" id="wh2-q-clear" title="Очистить">✕</button><div class="wh2-ac" id="wh2-ac" style="display:none"></div></div>
        <button class="wh2-btn wh2-btn--primary" id="wh2-add">➕ Позиция</button>
      </div>
      <div id="wh2-body"></div>`;
    host.appendChild(_root);

    _root.querySelectorAll('.wh2-tab').forEach(t => t.onclick = () => {
      _root.querySelectorAll('.wh2-tab').forEach(x => x.classList.remove('wh2-tab--active'));
      t.classList.add('wh2-tab--active'); _tab = t.dataset.tab; _searchVal = '';
      const q = _root.querySelector('#wh2-q'); q.value = ''; _hideAc(); _root.querySelector('#wh2-q-clear').style.display = 'none'; refresh();
    });
    let deb;
    const qEl = _root.querySelector('#wh2-q'); const clEl = _root.querySelector('#wh2-q-clear');
    qEl.oninput = e => {
      const v = e.target.value.trim(); _searchVal = v; clEl.style.display = v ? 'flex' : 'none';
      clearTimeout(deb); deb = setTimeout(() => { refresh(); _searchAutocomplete(v); }, 280);
    };
    qEl.onblur = () => setTimeout(_hideAc, 180);
    clEl.onclick = () => { qEl.value = ''; _searchVal = ''; clEl.style.display = 'none'; _hideAc(); refresh(); qEl.focus(); };
    _root.querySelector('#wh2-add').onclick = () => { if (_tab === 'locations') openBulkModal(); else openQuickProduct(); };

    _mountFab();        // FAB корзины в углу + скрыть Мимира на складе
    _updateCartBadge();
    refresh();
  }

  // ── Поиск с автоподсказками ──
  function _hideAc() { const ac = document.getElementById('wh2-ac'); if (ac) ac.style.display = 'none'; }
  async function _searchAutocomplete(q) {
    const ac = document.getElementById('wh2-ac'); if (!ac) return;
    if (!q || q.length < 2 || !['consumables', 'equipment'].includes(_tab)) { _hideAc(); return; }
    let items = [];
    try {
      if (_tab === 'equipment') {
        const d = await api('/api/equipment?limit=6&search=' + encodeURIComponent(q));
        items = (d.equipment || d.items || []).map(e => ({ name: e.name, meta: (e.inventory_number ? '№ ' + e.inventory_number : '') + (e.category_name ? ' · ' + e.category_name : ''), ic: '🛠️' }));
      } else {
        const d = await api('/api/products?limit=6&search=' + encodeURIComponent(q));
        items = (d.items || []).map(p => ({ name: p.name, meta: (p.article ? p.article + ' · ' : '') + (p.category_name || ''), ic: '📦' }));
      }
    } catch (_) { _hideAc(); return; }
    if (!items.length) { _hideAc(); return; }
    ac.innerHTML = items.map(i => `<div class="wh2-ac__i" data-acname="${esc(i.name)}"><span style="font-size:16px">${i.ic}</span><div style="flex:1;min-width:0"><div class="wh2-ac__nm">${esc(i.name)}</div>${i.meta ? '<div class="wh2-ac__meta">' + esc(i.meta) + '</div>' : ''}</div></div>`).join('');
    ac.style.display = '';
    ac.querySelectorAll('[data-acname]').forEach(el => el.onmousedown = () => {
      const q2 = el.getAttribute('data-acname'); const inp = document.getElementById('wh2-q');
      inp.value = q2; _searchVal = q2; _hideAc(); document.getElementById('wh2-q-clear').style.display = 'flex'; refresh();
    });
  }

  // ── FAB корзины (угол), замена Мимира на складе ──
  let _fabHashHandler = null;
  function _mountFab() {
    if (document.getElementById('wh2-cart-fab')) return;
    // прячем Мимир-виджет пока мы на складе
    const mimir = document.getElementById('mimirWidget'); if (mimir) mimir.style.display = 'none';
    const fab = document.createElement('div'); fab.id = 'wh2-cart-fab'; fab.className = 'wh2-fab';
    fab.innerHTML = `<div class="wh2-fab__split" style="display:none"></div>
      <button class="wh2-fab__btn" title="Корзина закупки">🛒<span class="wh2-fab__cnt" style="display:none">0</span></button>`;
    document.body.appendChild(fab);
    fab.querySelector('.wh2-fab__btn').onclick = () => openCartDrawer();
    _updateFab();
    // восстановить Мимира и убрать FAB при уходе со страницы склада
    _fabHashHandler = () => {
      if (!location.hash.includes('/warehouse')) {
        const m = document.getElementById('mimirWidget'); if (m) m.style.display = '';
        const f = document.getElementById('wh2-cart-fab'); if (f) f.remove();
        const dr = document.getElementById('wh2-cart-overlay'); if (dr) dr.remove();
        const d2 = document.getElementById('wh2-cart-drawer'); if (d2) d2.remove();
        window.removeEventListener('hashchange', _fabHashHandler); _fabHashHandler = null;
      }
    };
    window.addEventListener('hashchange', _fabHashHandler);
  }

  return { render };
})();
