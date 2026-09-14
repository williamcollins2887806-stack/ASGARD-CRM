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
  /** Демо/E2E имена каталога → короткое «Позиция #id» или обрезка. */
  function humanCatalogName(name, id) {
    const t = String(name || '').trim();
    if (!t) return id != null ? ('Позиция #' + id) : '—';
    if (/FALLBACK|E2E|Gallery\+|FULL-BIZ|\d{10,}/i.test(t)) {
      return id != null ? ('Позиция #' + id) : (t.length > 36 ? t.slice(0, 33) + '…' : t);
    }
    if (/^STORY\b/i.test(t)) {
      const rest = t.replace(/^STORY\s*/i, '').trim();
      return rest || (id != null ? ('Позиция #' + id) : '—');
    }
    return t.length > 72 ? t.slice(0, 69) + '…' : t;
  }

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
    let s = document.getElementById('wh2-css');
    if (!s) { s = document.createElement('style'); s.id = 'wh2-css'; document.head.appendChild(s); }
    s.textContent = `
    .wh2{padding:18px 22px;max-width:1400px;margin:0 auto}
    .wh2-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:14px}
    .wh2-kpi{background:var(--bg-card,#161a22);border:1px solid var(--border,#262c38);border-radius:14px;padding:14px 16px;position:relative;overflow:hidden;transition:.2s}
    .wh2-kpi::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:rgba(255,255,255,.12)}
    .wh2-kpi--gold::before{background:#c9a84c}.wh2-kpi--ok::before{background:#30d158}.wh2-kpi--warn::before{background:#e0a800}
    .wh2-kpi__i{display:none}
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
    /* ── Витрина карточек (media-first) ── */
    .wh2-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px}
    .wh2-card{background:var(--bg-card,#161a22);border:1px solid transparent;border-radius:16px;padding:0;cursor:pointer;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease;display:flex;flex-direction:column;gap:0;animation:wh2in .3s ease both;position:relative;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.18)}
    @keyframes wh2in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
    .wh2-card:hover{transform:translateY(-4px);border-color:rgba(212,168,67,.45);box-shadow:0 14px 32px rgba(0,0,0,.32)}
    .wh2-card__media{position:relative;aspect-ratio:1/1;background:linear-gradient(165deg,rgba(212,168,67,.08),rgba(255,255,255,.03) 45%,rgba(0,0,0,.12));display:flex;align-items:stretch;justify-content:stretch;overflow:hidden;flex-shrink:0}
    .wh2-card__media--t0{background:linear-gradient(160deg,rgba(212,168,67,.16),rgba(255,255,255,.04) 50%,rgba(0,0,0,.1))}
    .wh2-card__media--t1{background:linear-gradient(160deg,rgba(74,144,217,.18),rgba(255,255,255,.04) 50%,rgba(0,0,0,.1))}
    .wh2-card__media--t2{background:linear-gradient(160deg,rgba(48,209,88,.14),rgba(255,255,255,.04) 50%,rgba(0,0,0,.1))}
    .wh2-card__media--t3{background:linear-gradient(160deg,rgba(255,140,66,.16),rgba(255,255,255,.04) 50%,rgba(0,0,0,.1))}
    .wh2-card__media--t4{background:linear-gradient(160deg,rgba(165,110,255,.16),rgba(255,255,255,.04) 50%,rgba(0,0,0,.1))}
    .wh2-card__media--t5{background:linear-gradient(160deg,rgba(90,200,216,.16),rgba(255,255,255,.04) 50%,rgba(0,0,0,.1))}
    .wh2-card__media img{width:100%;height:100%;object-fit:cover;display:block;border:0;border-radius:0}
    /* full-bleed: SVG — scale+crop; emoji — почти на всю media */
    .wh2-card__media .goods-icon{position:absolute!important;left:50%!important;top:50%!important;width:128%!important;height:128%!important;max-width:none!important;max-height:none!important;transform:translate(-50%,-50%)!important;border-radius:0!important;box-shadow:none!important;border:0!important;background:transparent!important;display:block!important;padding:0!important;margin:0!important}
    .wh2-card__media .goods-icon svg{width:100%!important;height:100%!important;display:block}
    .wh2-card__media-fallback{position:absolute;inset:-8%;display:flex;align-items:center;justify-content:center;font-size:clamp(150px,82%,220px);line-height:1;opacity:.98;user-select:none;filter:drop-shadow(0 8px 18px rgba(0,0,0,.28));pointer-events:none}
    .wh2-card__badge{position:absolute;left:10px;top:10px;z-index:2;padding:5px 10px;border-radius:999px;background:rgba(12,14,18,.82);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:#fff;font-size:12px;font-weight:800;letter-spacing:.01em;box-shadow:0 2px 8px rgba(0,0,0,.35)}
    .wh2-card__badge--zero{opacity:.7;font-weight:700}
    .wh2-card__tag{position:absolute;top:10px;right:10px;z-index:2}
    .wh2-card__caption{position:absolute;left:0;right:0;bottom:0;z-index:2;padding:48px 12px 12px;background:linear-gradient(180deg,transparent 0%,rgba(8,10,14,.5) 40%,rgba(8,10,14,.92) 100%);color:#fff;display:flex;flex-direction:column;gap:3px;justify-content:flex-end}
    .wh2-card__caption-title{font-weight:700;font-size:13.5px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .wh2-card__caption-sub{font-weight:500;font-size:11.5px;opacity:.82;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .wh2-card__body{padding:10px 12px 12px;display:flex;flex-direction:column;gap:0;flex:0 0 auto;min-height:0}
    .wh2-card__name{font-weight:700;font-size:14.5px;color:var(--t1,#e6e9ef);line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.7em}
    .wh2-card__sub{font-size:12px;color:var(--t2,#8b93a3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .wh2-card__foot{display:flex;align-items:center;gap:8px;margin-top:0;padding-top:0;border-top:none}
    .wh2-card__top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
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
    .wh2-page-tip{font-size:12px;line-height:1.45;color:var(--t2,#9aa6b8);margin:0 0 12px;padding:8px 12px;border-radius:10px;border:1px solid rgba(201,168,76,.22);background:rgba(201,168,76,.06)}
    .wh2-page-tip b{color:var(--gold,#c9a84c);font-weight:700}
    /* ── превью отправки корзины ── */
    .wh2-prev{min-width:min(640px,92vw);max-width:720px;width:100%}
    .wh2-prev__kicker{font-size:12px;color:var(--t2,#8b93a3);margin:0 0 12px;line-height:1.45}
    .wh2-prev__chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}
    .wh2-prev__chip{display:inline-flex;align-items:baseline;gap:6px;padding:8px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);font-size:12px;color:var(--t2,#8b93a3)}
    .wh2-prev__chip b{font-size:16px;font-weight:800;color:var(--t1,#e6e9ef);letter-spacing:-.02em}
    .wh2-prev__chip--ok{border-color:rgba(48,209,88,.35);background:rgba(48,209,88,.08)}
    .wh2-prev__chip--ok b{color:#30d158}
    .wh2-prev__chip--buy{border-color:rgba(201,168,76,.4);background:rgba(201,168,76,.1)}
    .wh2-prev__chip--buy b{color:#e0c078}
    .wh2-prev__sec{margin:0 0 12px;border:1px solid rgba(255,255,255,.08);border-radius:12px;overflow:hidden;background:rgba(0,0,0,.18);max-height:200px;overflow-y:auto}
    .wh2-prev__sec-h{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 12px;font-size:12px;font-weight:700;color:var(--t1,#e6e9ef);border-bottom:1px solid rgba(255,255,255,.06);background:rgba(22,26,34,.96)}
    .wh2-prev__sec--ok .wh2-prev__sec-h{border-left:3px solid #30d158}
    .wh2-prev__sec--buy .wh2-prev__sec-h{border-left:3px solid #c9a84c}
    .wh2-prev__sec-h span{font-weight:600;color:var(--t2,#8b93a3);font-size:11px}
    .wh2-prev__row{display:grid;grid-template-columns:minmax(0,1fr) 72px 88px;gap:10px;align-items:center;padding:7px 12px;border-bottom:1px solid rgba(255,255,255,.05);font-size:13px}
    .wh2-prev__row:last-child{border-bottom:0}
    .wh2-prev__row:nth-child(even){background:rgba(255,255,255,.02)}
    .wh2-prev__name{font-weight:600;color:var(--t1,#e6e9ef);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .wh2-prev__name .wh2-chip{margin-left:6px;vertical-align:middle}
    .wh2-prev__qty,.wh2-prev__price{text-align:right;font-variant-numeric:tabular-nums;color:var(--t2,#9aa6b8);white-space:nowrap}
    .wh2-prev__price{color:var(--t1,#e6e9ef);font-weight:600}
    .wh2-prev__work{margin:10px 0 4px;padding:12px;border-radius:12px;border:1px solid rgba(201,168,76,.28);background:rgba(201,168,76,.06)}
    .wh2-prev__work label{display:block;font-size:12px;font-weight:700;color:var(--t1,#e6e9ef);margin-bottom:6px}
    .wh2-prev__work select{width:100%;padding:10px 12px;border:1px solid var(--border,#262c38);border-radius:9px;background:var(--bg2,#0f1217);color:inherit;font-size:13px}
    .wh2-prev__work-hint{font-size:11px;color:var(--t3,#7a8699);margin-top:6px;line-height:1.35}
    .wh2-prev__foot{display:flex;gap:10px;justify-content:flex-end;margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,.08);position:sticky;bottom:0;background:var(--bg1,#161b24);z-index:2}
    .wh2-prev__foot .wh2-btn{min-height:40px;padding:10px 16px}
    .wh2-prev__empty{padding:18px;text-align:center;color:var(--t2);font-size:13px}
    .wh2-recv-hero{margin:0 0 12px;padding:14px 16px;border:1px solid rgba(255,255,255,.08);border-radius:14px;background:linear-gradient(135deg,rgba(201,168,76,.1),rgba(16,20,28,.55) 45%,rgba(43,171,98,.05));display:flex;gap:16px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;position:relative;overflow:hidden}
    .wh2-recv-hero::before{content:'';position:absolute;inset:0 auto 0 0;width:3px;background:linear-gradient(180deg,#c9a84c,#2bab62)}
    .wh2-recv-hero__copy{flex:1;min-width:220px}
    .wh2-recv-hero__kicker{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#c9a84c;font-weight:700;margin-bottom:4px}
    .wh2-recv-hero__title{font-size:15px;font-weight:700;color:var(--t1,#e6e9ef);line-height:1.35;margin-bottom:8px;max-width:640px;letter-spacing:-.01em}
    .wh2-recv-steps{margin:0;padding:0;font-size:12px;line-height:1.45;color:var(--t2,#8b93a3);list-style:none;display:flex;flex-wrap:wrap;gap:6px}
    .wh2-recv-steps li{margin:0;padding:5px 10px;display:flex;gap:6px;align-items:center;border:1px solid rgba(255,255,255,.07);border-radius:999px;background:rgba(0,0,0,.18);color:var(--t2,#8b93a3)}
    .wh2-recv-steps li.on{border-color:rgba(201,168,76,.45);background:rgba(201,168,76,.12);color:var(--t1,#e6e9ef);font-weight:600}
    .wh2-recv-steps li b{color:#c9a84c;font-variant-numeric:tabular-nums;min-width:1.1em}
    .wh2-recv-steps__act{color:inherit;font-weight:inherit}
    .wh2-recv-hero__cta{flex-shrink:0;align-self:center;min-height:40px;padding:10px 16px}
    .wh2-recv-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:12px}
    @media(max-width:900px){.wh2-recv-kpis{grid-template-columns:1fr}}
    .wh2-recv-kpi{padding:14px 14px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:linear-gradient(165deg,rgba(255,255,255,.03),var(--bg1,#161b24));position:relative;overflow:hidden;box-shadow:0 1px 0 rgba(255,255,255,.04) inset}
    .wh2-recv-kpi::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:rgba(255,255,255,.12)}
    .wh2-recv-kpi__v{font-size:24px;font-weight:800;letter-spacing:-.03em;line-height:1;color:var(--t1,#e6e9ef)}
    .wh2-recv-kpi__l{margin-top:6px;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--t2,#8b93a3);font-weight:600}
    .wh2-recv-kpi--blue .wh2-recv-kpi__v{color:#7eb0ff}
    .wh2-recv-kpi--blue::before{background:linear-gradient(180deg,#7eb0ff,#2563eb)}
    .wh2-recv-kpi--ok .wh2-recv-kpi__v{color:#30d158}
    .wh2-recv-kpi--ok::before{background:linear-gradient(180deg,#30d158,#2bab62)}
    .wh2-recv-kpi--muted .wh2-recv-kpi__v{color:var(--t2,#8b93a3);font-size:20px}
    .wh2-recv-sec{margin:14px 0 6px;padding:12px 14px 10px;border:1px solid rgba(255,255,255,.07);border-radius:14px;background:rgba(16,20,28,.4)}
    .wh2-recv-sec__t{font-weight:700;margin:0 0 10px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--t2,#8b93a3)}
    .wh2-recv-sec .wh2-table td,.wh2-recv-sec .wh2-table th{padding:8px 10px;font-size:13px}
    .wh2-recv-sec .wh2-table-wrap{border-radius:10px;overflow:hidden;border:1px solid rgba(255,255,255,.06)}
    .wh2-recv-sec .wh2-table tbody tr:hover td{background:rgba(255,255,255,.025)}
    .wh2-recv-grp .wh2-table td,.wh2-recv-grp .wh2-table th{padding:7px 10px}
    .wh2-recv-grp .wh2-table tbody tr:nth-child(even) td{background:rgba(255,255,255,.018)}
    .wh2-recv-grp .wh2-table tbody tr:hover td{background:rgba(201,168,76,.06)}
    .wh2-chip--status{display:inline-flex;align-items:center;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:650;letter-spacing:.02em;background:color-mix(in srgb,var(--st,#8b93a3) 18%,transparent);color:var(--st,#8b93a3);border:1px solid color-mix(in srgb,var(--st,#8b93a3) 35%,transparent)}
    .wh2-recv-grp{margin:0 0 12px;border:1px solid rgba(255,255,255,.06);border-radius:12px;overflow:hidden;background:rgba(255,255,255,.015)}
    .wh2-recv-grp__h{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.07);margin-bottom:0;border-left:3px solid rgba(201,168,76,.55);background:rgba(201,168,76,.05)}
    .wh2-recv-grp__h>span:first-child{font-size:13px;font-weight:700;color:var(--t1,#e6e9ef)}
    .wh2-recv-grp__h .mut{font-size:11px;color:var(--t2,#8b93a3);white-space:nowrap;display:inline-flex;align-items:center;gap:8px}
    .wh2-recv-grp__cnt{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:20px;padding:0 7px;border-radius:10px;background:rgba(201,168,76,.18);border:1px solid rgba(201,168,76,.35);color:#e0c078;font-size:11px;font-weight:700}
    .wh2-btn--sm{padding:4px 10px;font-size:11px;border-radius:8px;line-height:1.2}
    .wh2-link{color:var(--gold,#c9a84c);font-size:11px;text-decoration:none;border-bottom:1px dotted rgba(201,168,76,.45)}
    .wh2-link:hover{border-bottom-style:solid}
    .wh2-recv-grp .wh2-table-wrap{border:0;border-radius:0}
    .wh2-st-wait{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.02em;background:rgba(201,168,76,.16);color:#e0c078;border:1px solid rgba(201,168,76,.4);box-shadow:0 0 0 1px rgba(201,168,76,.08)}
    .wh2-st-wait::before{content:'';width:6px;height:6px;border-radius:50%;background:#c9a84c;box-shadow:0 0 8px rgba(201,168,76,.7)}
    .wh2-br-flow{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:0 0 14px}
    .wh2-br-flow__step{display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.02);font-size:12px;color:var(--t2,#8b93a3);font-weight:600;line-height:1.3}
    .wh2-br-flow__step span{display:inline-flex;width:24px;height:24px;flex-shrink:0;align-items:center;justify-content:center;border-radius:50%;background:rgba(201,168,76,.16);color:#c9a84c;font-weight:800;font-size:11px}
    .wh2-br-flow__step--on{border-color:rgba(201,168,76,.45);background:rgba(201,168,76,.1);color:var(--t1,#e6e9ef)}
    .wh2-br-flow__step--on span{background:rgba(201,168,76,.28)}
    @media(max-width:720px){.wh2-br-flow{grid-template-columns:1fr}}
    .wh2-panel.wh2-br-panel{border-radius:16px;border:1px solid rgba(255,255,255,.08);padding:16px 18px;background:rgba(16,20,28,.55)}
    .wh2-br-panel .wh2-panel__t{font-size:16px;letter-spacing:-.01em;margin-bottom:12px}
    .wh2-br-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:12px;margin-top:10px}
    @media(max-width:900px){.wh2-br-grid{grid-template-columns:1fr}}
    .wh2-br-box{padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.02)}
    .wh2-br-box__t{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--t2,#8b93a3);font-weight:700;margin:0 0 10px}
    .wh2-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:20px;font-size:11px;font-weight:700}
    .wh2-chip--draft{background:rgba(255,160,0,.15);color:#ffb020}
    .wh2-chip--cons{background:rgba(74,144,217,.15);color:#5aa0e0}
    .wh2-chip--ok{background:rgba(48,209,88,.15);color:#30d158}
    .wh2-chip--warn{background:rgba(255,92,92,.15);color:#ff5c5c}
    .wh2-avail{display:flex;align-items:baseline;gap:6px;flex:1;min-width:0}
    .wh2-avail__n{font-size:20px;font-weight:800;color:var(--ok-t,#30d158)}
    .wh2-avail__n--zero{color:var(--t2,#8b93a3)}
    .wh2-empty{text-align:center;padding:60px 20px;color:var(--t2,#8b93a3)}
    .wh2-empty__i{font-size:48px;opacity:.4;margin-bottom:12px}
    .wh2-prod-hero{display:flex;gap:18px;align-items:flex-start}
    .wh2-prod-hero__ph{width:168px;height:168px;border-radius:16px;object-fit:cover;border:1px solid var(--border,#262c38);background:linear-gradient(165deg,rgba(212,168,67,.1),rgba(255,255,255,.04));flex-shrink:0;display:flex;align-items:stretch;justify-content:stretch;font-size:72px;overflow:hidden;position:relative;padding:0}
    .wh2-prod-hero__ph img{width:100%;height:100%;object-fit:cover;border:0;border-radius:0}
    .wh2-prod-hero__ph .goods-icon{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;border-radius:0!important;box-shadow:none!important;background:transparent!important;border:0!important}
    .wh2-prod-hero__ph .goods-icon svg{width:100%!important;height:100%!important}
    .wh2-cart-it__ph{width:64px;height:64px;border-radius:14px;object-fit:cover;flex-shrink:0;background:var(--bg2,#0f1217);display:flex;align-items:center;justify-content:center;font-size:34px;overflow:hidden;position:relative}
    .wh2-cart-it__ph img{width:100%;height:100%;object-fit:cover;border:0}
    .wh2-cart-it__ph .goods-icon{width:100%!important;height:100%!important;border-radius:0!important;box-shadow:none!important;background:transparent!important;border:0!important}
    html[data-theme="light"] .wh2-card{border-color:transparent;box-shadow:0 2px 14px rgba(40,36,28,.07)}
    html[data-theme="light"] .wh2-card:hover{box-shadow:0 12px 28px rgba(40,36,28,.14);border-color:rgba(184,146,46,.45)}
    html[data-theme="light"] .wh2-card__media{background:linear-gradient(165deg,#f3eee3,#e9e1d2 55%,#e2d9c8)}
    html[data-theme="light"] .wh2-card__media--t0{background:linear-gradient(160deg,#f5ebd0,#ebe3d2)}
    html[data-theme="light"] .wh2-card__media--t1{background:linear-gradient(160deg,#dde9f4,#ebe3d2)}
    html[data-theme="light"] .wh2-card__media--t2{background:linear-gradient(160deg,#dcefe4,#ebe3d2)}
    html[data-theme="light"] .wh2-card__media--t3{background:linear-gradient(160deg,#f3e6da,#ebe3d2)}
    html[data-theme="light"] .wh2-card__media--t4{background:linear-gradient(160deg,#ebe2f3,#ebe3d2)}
    html[data-theme="light"] .wh2-card__media--t5{background:linear-gradient(160deg,#dceef1,#ebe3d2)}
    html[data-theme="light"] .wh2-card__media .goods-icon{background:transparent!important}
    html[data-theme="light"] .wh2-card__caption{background:linear-gradient(180deg,transparent 0%,rgba(40,36,28,.22) 38%,rgba(40,36,28,.68) 100%)}
    html[data-theme="light"] .wh2-card__badge{background:rgba(255,255,255,.94);color:#1a1408;box-shadow:0 2px 8px rgba(40,36,28,.12)}
    html[data-theme="light"] .wh2-card__body{background:var(--bg-card,#fff)}
    html[data-theme="light"] .wh2-prod-hero__ph{background:linear-gradient(165deg,#f3eee3,#ebe3d2);border-color:rgba(40,36,28,.1)}
    html[data-theme="light"] .wh2-prod-hero__ph .goods-icon{background:transparent!important;border-radius:0!important;box-shadow:none!important}
    html[data-theme="light"] .wh2-skel{background:linear-gradient(90deg,rgba(0,0,0,.04) 25%,rgba(0,0,0,.08) 37%,rgba(0,0,0,.04) 63%);background-size:400% 100%}
    html[data-theme="light"] .wh2-cart-ov{background:rgba(40,36,28,.35)}
    html[data-theme="light"] .wh2-fab__cnt{border-color:var(--bg1,#f5f1e8)}
    .wh2-table{width:100%;border-collapse:collapse;font-size:13px}
    .wh2-table th{text-align:left;padding:10px 12px;color:var(--t2,#8b93a3);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.4px;border-bottom:1px solid var(--border,#262c38)}
    .wh2-table td{padding:11px 12px;border-bottom:1px solid var(--border,#1e2430);color:var(--t1,#e6e9ef)}
    .wh2-table tr:hover td{background:var(--bg-hover,#1c212b)}
    .wh2-cellmap{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
    .wh2-cell{background:var(--bg-card,#161a22);border:1px solid var(--border,#262c38);border-radius:14px;padding:16px 14px;cursor:pointer;transition:.15s;text-align:center;min-height:110px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;box-shadow:0 2px 8px rgba(0,0,0,.12)}
    .wh2-cell:hover{border-color:var(--gold,#D4A843);transform:translateY(-2px);box-shadow:0 8px 20px rgba(0,0,0,.22)}
    .wh2-cell--full{border-color:rgba(48,209,88,.55);background:linear-gradient(165deg,rgba(48,209,88,.08),var(--bg-card,#161a22))}
    .wh2-cell__lbl{font-weight:800;font-size:17px;color:var(--gold,#D4A843)}
    .wh2-cell__cnt{font-size:12px;color:var(--t2,#8b93a3);margin-top:2px}
    .wh2-mv{display:flex;align-items:center;gap:12px;padding:14px 14px;margin-bottom:8px;border:1px solid var(--border,#262c38);border-radius:14px;background:var(--bg-card,#161a22);box-shadow:0 2px 8px rgba(0,0,0,.1)}
    .wh2-mv__ic{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}
    .wh2-cell__ico{font-size:28px;line-height:1;margin-bottom:4px;opacity:.9}
    html[data-theme="light"] .wh2-cart-dr{background:var(--bg1,#f7f3ea);border-left-color:rgba(40,36,28,.1);box-shadow:-12px 0 40px rgba(40,36,28,.18)}
    html[data-theme="light"] .wh2-cart-dr__ft{background:rgba(255,255,255,.85)}
    html[data-theme="light"] .wh2-cart-tot__c{background:#fff;border-color:rgba(40,36,28,.1)}
    html[data-theme="light"] .wh2-cart-it__ph{background:#ebe3d2}
    html[data-theme="light"] .wh2-fab__split{background:#fff;border-color:rgba(40,36,28,.1);box-shadow:0 6px 20px rgba(40,36,28,.12)}
    html[data-theme="light"] .wh2-cell{border-color:rgba(40,36,28,.1)}
    html[data-theme="light"] .wh2-mv{border-color:rgba(40,36,28,.1);background:#fff}
    html[data-theme="light"] .wh2-btn{background:#fff;border-color:rgba(40,36,28,.12)}
    .wh2-loading{text-align:center;padding:50px;color:var(--t2)}
    .wh2-inp{padding:8px 10px;border-radius:8px;border:1px solid var(--border,#262c38);background:var(--bg-input,#10141b);color:var(--t1,#e6e9ef);font-size:13px;outline:none;min-width:0}
    .wh2-inp:focus{border-color:var(--gold,#D4A843)}
    .wh2-panel{background:var(--bg-card,#161a22);border:1px solid var(--border,#262c38);border-radius:14px;padding:14px;margin-bottom:12px}
    .wh2-panel__t{font-weight:700;font-size:14px;margin:0 0 10px}
    .wh2-ops-nav{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:0 0 14px;padding:6px;border-radius:14px;border:1px solid rgba(255,255,255,.08);background:rgba(12,16,22,.72)}
    .wh2-ops-nav__pri{display:inline-flex;gap:2px;flex-wrap:wrap;align-items:center;flex:1;min-width:0;padding:2px;border-radius:11px;background:rgba(0,0,0,.28)}
    .wh2-ops-nav__sec{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-left:auto}
    .wh2-ops-nav__pri .wh2-btn{border:0;background:transparent;border-radius:9px;padding:9px 12px;color:var(--t2,#8b93a3);box-shadow:none}
    .wh2-ops-nav__pri .wh2-btn:hover{color:var(--t1,#e6e9ef);background:rgba(255,255,255,.04)}
    .wh2-ops-nav__pri .wh2-btn--on,.wh2-ops-nav__pri .wh2-btn--primary{background:rgba(201,168,76,.2)!important;color:#e8c878!important;border:0!important;box-shadow:inset 0 0 0 1px rgba(201,168,76,.35)}
    .wh2-ops-nav .wh2-btn--on{border-color:rgba(201,168,76,.55);background:rgba(201,168,76,.14);color:#e0c078}
    .wh2-ops-empty{padding:28px 18px;border:1px dashed rgba(255,255,255,.1);border-radius:12px;color:var(--t2,#8b93a3);font-size:13px;text-align:center;line-height:1.45}
    .wh2-ops-step{font-size:11px;color:var(--t2,#8b93a3);text-transform:uppercase;letter-spacing:.3px}
    .wh2-ops-step b{color:var(--gold,#D4A843)}
    .wh2-map-host{margin:0 -10px -8px;border-radius:18px;overflow:hidden}
    .wh2-ops-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
    .wh2-dir-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-top:8px}
    .wh2-dir-card{background:var(--bg-card,#161a22);border:1px solid var(--border,#262c38);border-radius:14px;padding:14px}
    .wh2-dir-card h4{margin:0 0 10px;font-size:13px;color:var(--t2,#8b93a3);text-transform:uppercase;letter-spacing:.4px}
    .wh2-dir-card table{margin:0}
    .wh2-miss{border:1px solid rgba(255,92,92,.35);background:rgba(255,92,92,.06);border-radius:12px;padding:12px;margin-top:10px}
    .wh2-miss h4{margin:0 0 8px;color:var(--err-t,#ff5c5c);font-size:14px}
    .wh2-chk{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border,#1e2430);font-size:13px}
    .wh2-chk:last-child{border-bottom:0}

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
    .wh2-skel-card{height:310px;border-radius:16px}

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
      .wh2-cards{grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}
      .wh2-card__media .goods-icon{width:100%!important;height:100%!important}
      .wh2-card__media-fallback{font-size:72px}
      .wh2-prod-hero{flex-direction:column}
      .wh2-prod-hero__ph{width:100%;height:200px}
      .wh2-chips{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:4px}
    }
    `;
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
  function _itemGlyph(name, isEq) {
    const n = String(name || '').toLowerCase();
    if (/нивел|лазер|уровень/.test(n)) return '📡';
    if (/тепловиз|термо/.test(n)) return '🌡️';
    if (/перфор|дрель|шуруп/.test(n)) return '🔩';
    if (/генератор|дгу|бензо/.test(n)) return '⚡';
    if (/ушм|болгар|шлиф/.test(n)) return '⚙️';
    if (/свар|инвертор|электрод|проволок/.test(n)) return '🔥';
    if (/перчат|сиз|каск/.test(n)) return '🦺';
    if (/спрей|хими/.test(n)) return '🧪';
    if (/диск|отрез|инструм/.test(n)) return '🛠️';
    return isEq ? '🛠️' : '📦';
  }
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
  // Пока открыта Excel/ручная панель — не перерисовывать drawer целиком:
  // иначе _cartSync().then(_renderDrawer) сносит #wh2-cart-sub во время parse.
  let _cartPanelBusy = false;
  async function openCartDrawer() {
    await _loadWorks();
    if (!document.getElementById('wh2-cart-drawer')) {
      const ov = document.createElement('div'); ov.id = 'wh2-cart-overlay'; ov.className = 'wh2-cart-ov';
      const dr = document.createElement('div'); dr.id = 'wh2-cart-drawer'; dr.className = 'wh2-cart-dr';
      document.body.appendChild(ov); document.body.appendChild(dr);
      ov.onclick = () => closeCartDrawer();
    }
    if (!_cartPanelBusy) _renderDrawer();
    requestAnimationFrame(() => {
      document.getElementById('wh2-cart-overlay')?.classList.add('wh2-cart-ov--open');
      document.getElementById('wh2-cart-drawer')?.classList.add('wh2-cart-dr--open');
    });
    _cartSync().then(() => {
      if (_cartPanelBusy) return;
      if (document.getElementById('wh2-cart-drawer')) _renderDrawer();
    });
  }
  function closeCartDrawer() {
    _cartPanelBusy = false;
    const ov = document.getElementById('wh2-cart-overlay'), dr = document.getElementById('wh2-cart-drawer');
    if (ov) ov.classList.remove('wh2-cart-ov--open');
    if (dr) dr.classList.remove('wh2-cart-dr--open');
    setTimeout(() => { if (ov) ov.remove(); if (dr) dr.remove(); }, 300);
  }
  function _renderDrawer() {
    if (_cartPanelBusy) return;
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
          <div class="wh2-cart-it__ph">${it.photo_url ? `<img src="${esc(it.photo_url)}" alt="">` : _itemGlyph(it.name, isEq)}</div>
          <div style="flex:1;min-width:0">
            <div class="wh2-cart-it__nm">${esc(humanCatalogName(it.name, it.product_id || it.equipment_id))}${it.is_new_position ? ' <span class="wh2-chip" style="background:rgba(224,168,0,.2);color:#e0a800">🆕</span>' : ''}${isEq ? ' <span class="wh2-chip wh2-chip--ok">оборуд.</span>' : ''}</div>
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
        <div class="wh2-page-tip">Соберите позиции → при необходимости <b>Excel</b> → <b>Отправить заявку</b>. Что есть на складе уйдёт в резерв, остальное — в закупку.</div>
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
    const sb = $('wh2-cart-submit'); if (sb) sb.onclick = () => {
      toast('Предпросмотр', 'Сначала откройте «Предпросмотр» — укажите работу, объект и дату', 'warn');
      openSubmitPreview();
    };
  }
  // совместимость: старые вызовы openCartModal/_redrawCart → drawer
  function openCartModal() { return openCartDrawer(); }
  function _redrawCart() { _renderDrawer(); }

  // ── Добавить вручную ──
  function _openManualPanel() {
    _cartPanelBusy = true;
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
          _cartPanelBusy = false; _redrawCart();
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
      _cartPanelBusy = false; _redrawCart();
    };
    document.getElementById('wh2-man-cancel').onclick = () => { _cartPanelBusy = false; sub.innerHTML = ''; };
  }

  // ── Прикрепить Excel ──
  function _openExcelPanel() {
    _cartPanelBusy = true;
    const sub = document.getElementById('wh2-cart-sub'); if (!sub) return;
    const actBadge = (act) => {
      const map = {
        reserve: { bg: 'rgba(46,160,67,.22)', fg: 'var(--ok,#2ea043)', t: '✅ со склада' },
        reserve_and_procure: { bg: 'rgba(224,168,0,.22)', fg: 'var(--gold)', t: '⚡ частично + закупка' },
        procure: { bg: 'rgba(88,140,220,.22)', fg: '#7eb0ff', t: '🛒 закупка' },
        procure_new: { bg: 'rgba(224,168,0,.28)', fg: '#e0a800', t: '🆕 новая закупка' },
        reserve_equipment: { bg: 'rgba(46,160,67,.22)', fg: 'var(--ok,#2ea043)', t: '🔧 оборудование → резерв' },
        procure_equipment: { bg: 'rgba(88,140,220,.22)', fg: '#7eb0ff', t: '🔧 оборудование → заявка' }
      };
      const m = map[act] || { bg: 'rgba(128,128,128,.2)', fg: 'var(--t2)', t: act || '?' };
      return `<span class="wh2-chip" style="background:${m.bg};color:${m.fg};font-weight:600">${m.t}</span>`;
    };
    sub.innerHTML = `<div style="border:1px solid var(--border);border-radius:10px;padding:12px">
      <div style="font-weight:600;margin-bottom:6px">Загрузить Excel</div>
      <div class="wh2-page-tip">1) скачайте шаблон → 2) заполните → 3) выберите файл → 4) проверьте превью → 5) кнопку добавления в корзину.</div>
      <div class="wh2-mk-hint">Колонки: <b>Наименование</b> · Артикул · <b>Количество</b> · Ед.изм · Цена · Поставщик · Примечание.
        <a href="/templates/wms-cart-excel-template.xlsx" download style="color:var(--gold);margin-left:6px">⬇ Скачать шаблон</a></div>
      <label class="wh2-btn" style="cursor:pointer;display:inline-block">📎 Выбрать файл<input type="file" id="wh2-xl-file" accept=".xlsx,.xls" style="display:none"></label>
      <span id="wh2-xl-status" style="font-size:12px;color:var(--gold);margin-left:8px"></span>
      <div id="wh2-xl-preview" style="margin-top:8px"></div>
      <button class="wh2-btn" id="wh2-xl-cancel" style="margin-top:8px">Закрыть</button>
    </div>`;
    document.getElementById('wh2-xl-cancel').onclick = () => { _cartPanelBusy = false; sub.innerHTML = ''; };
    let parsedRows = [];
    let xlAiPending = false;
    const doAddFromExcel = async () => {
      const livePrev = document.getElementById('wh2-xl-preview');
      if (!livePrev || !parsedRows.length) { toast('Excel', 'Нет разобранных строк', 'warn'); return; }
      const btn = document.getElementById('wh2-xl-add');
      if (btn) { btn.disabled = true; btn.textContent = 'Добавляем…'; }
      livePrev.querySelectorAll('[data-xl-q]').forEach(inp => { parsedRows[+inp.dataset.xlQ].quantity = parseFloat(inp.value) || 1; });
      livePrev.querySelectorAll('[data-xl-p]').forEach(inp => { parsedRows[+inp.dataset.xlP].unit_price = inp.value === '' ? null : parseFloat(inp.value); });
      const items = parsedRows.map(x => {
        if (x.match_kind === 'equipment' && x.equipment_id) {
          return { item_type: 'equipment', equipment_id: x.equipment_id, need_qty: x.quantity || 1, source: 'excel' };
        }
        if (x.matched && x.product_id) {
          return { item_type: 'consumable', product_id: x.product_id, need_qty: x.quantity, source: 'excel' };
        }
        return { item_type: 'new_position', custom_name: x.name, need_qty: x.quantity, manual_price: x.unit_price, supplier_name: x.supplier_name, source: 'excel' };
      });
      const ok = await addToCart({ warehouse_id: _cart.warehouse_id || 1, items });
      _cartPanelBusy = false;
      if (ok) _redrawCart();
      else if (btn) { btn.disabled = false; btn.textContent = 'Добавить в корзину (' + parsedRows.length + ')'; }
    };
    // делегирование: AI-перерисовка превью не срывает клик по «Добавить»
    sub.onclick = (ev) => {
      if (ev.target && ev.target.id === 'wh2-xl-add') {
        ev.preventDefault();
        doAddFromExcel();
      }
    };
    const renderXlPreview = (sugMap, opts) => {
      const prev = document.getElementById('wh2-xl-preview');
      const stLive = document.getElementById('wh2-xl-status');
      if (!prev) return;
      const matching = !!(opts && opts.matching);
      prev.innerHTML = `<div style="max-height:280px;overflow:auto;border:1px solid var(--border);border-radius:8px">
          ${parsedRows.map((x, i) => {
            const s = sugMap[i];
            const act = (s && s.recommended_action) || x._ai_action || (x.match_kind === 'equipment' ? 'reserve_equipment' : (x.matched ? (x.available_qty > 0 ? 'reserve' : 'procure') : 'procure_new'));
            const kindChip = x.match_kind === 'equipment'
              ? ' <span class="wh2-chip" style="background:rgba(88,140,220,.25);color:#7eb0ff">🔧 оборудование</span>'
              : (x.is_new_position ? ' <span class="wh2-chip" style="background:rgba(224,168,0,.2);color:#e0a800">🆕</span>' : '');
            const alts = (s && s.alternatives || x.candidates || []).slice(0, 5);
            const stockLine = x.match_kind === 'equipment'
              ? (x.available_qty > 0 ? 'свободно на складе' : 'занято / нет')
              : (x.matched ? ('на складе ' + fmt(x.available_qty) + ' · ' + _money(x.last_price || (s && s.alternatives && s.alternatives[0] && s.alternatives[0].last_price))) : 'нет в каталоге');
            return `<div class="wh2-cart-row ${x.is_new_position ? 'wh2-row-new' : ''}" style="padding:7px;align-items:flex-start">
            <div style="flex:1"><b>${esc(x.name)}</b>${kindChip}
              <div style="font-size:12px;color:var(--t2);margin-top:3px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">
                <span>${stockLine}</span>${actBadge(act)}
              </div>
              ${alts.length ? `<div style="font-size:11px;color:var(--t2);margin-top:4px">альтернативы: ${alts.map(a => {
                const k = a.kind === 'equipment' ? '🔧 ' : '';
                const badge = a.action ? ' · ' + ({ reserve: 'склад', reserve_and_procure: 'частично', procure: 'закупка', reserve_equipment: 'об.резерв', procure_equipment: 'об.заявка' }[a.action] || a.action) : '';
                return k + esc(a.name) + ' (' + fmt(a.available_qty) + badge + ')';
              }).join('; ')}</div>` : ''}
            </div>
            <input type="number" min="1" value="${x.quantity || 1}" data-xl-q="${i}" style="width:60px;padding:5px;border:1px solid var(--border);border-radius:6px;background:var(--bg2,#0f1217);color:inherit">
            <input type="number" min="0" value="${x.unit_price != null ? x.unit_price : ''}" placeholder="цена" data-xl-p="${i}" style="width:80px;padding:5px;border:1px solid var(--border);border-radius:6px;background:var(--bg2,#0f1217);color:inherit">
          </div>`;
          }).join('')}</div>
          <button type="button" class="wh2-btn wh2-btn--primary" id="wh2-xl-add" style="margin-top:8px;width:100%" ${matching ? 'data-matching="1"' : ''}>Добавить в корзину (${parsedRows.length})</button>`;
      if (stLive) stLive.textContent = matching ? 'Уточняем матчинг…' : '';
    };
    document.getElementById('wh2-xl-file').onchange = async (ev) => {
      const file = ev.target.files && ev.target.files[0]; if (!file) return;
      _cartPanelBusy = true;
      const st = document.getElementById('wh2-xl-status'); if (st) st.textContent = 'Разбор…';
      try {
        const fd = new FormData(); fd.append('file', file);
        const t = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token');
        const r = await fetch('/api/warehouse-cart/parse-excel', { method: 'POST', headers: { Authorization: 'Bearer ' + t }, body: fd });
        const d = await r.json(); if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
        parsedRows = d.rows || [];
        xlAiPending = true;
        renderXlPreview({}, { matching: true });
        let ai = null;
        try {
          ai = await api('/api/warehouse-cart/suggest-ai', { method: 'POST', body: JSON.stringify({ rows: parsedRows }) });
        } catch (_) { ai = null; }
        const sugMap = {};
        (ai && ai.suggestions || []).forEach((s, i) => { sugMap[i] = s; });
        parsedRows.forEach((x, i) => {
          const s = sugMap[i]; if (!s) return;
          if (s.product_id) {
            x.matched = true; x.match_kind = 'product'; x.product_id = s.product_id; x.equipment_id = null;
            x.is_new_position = false; x.available_qty = s.available_qty;
          } else if (s.equipment_id) {
            x.matched = true; x.match_kind = 'equipment'; x.equipment_id = s.equipment_id; x.product_id = null;
            x.is_new_position = false; x.available_qty = s.available_qty;
          } else if (s.is_new_position) {
            x.matched = false; x.is_new_position = true; x.product_id = null; x.equipment_id = null;
          }
          x._ai_action = s.recommended_action;
        });
        xlAiPending = false;
        renderXlPreview(sugMap, { matching: false });
        const st3 = document.getElementById('wh2-xl-status');
        if (st3) st3.textContent = ai && ai.ai_used ? 'AI ✓' : 'готово';
      } catch (e) {
        xlAiPending = false;
        const stErr = document.getElementById('wh2-xl-status');
        if (stErr) stErr.textContent = '';
        toast('Ошибка', e.message, 'err');
      }
    };
  }

  // ── Предпросмотр разбивки ──
  async function openSubmitPreview() {
    try { await _cartSync(); } catch (_) {}
    let d; try { d = await api('/api/warehouse-cart/preview-submit', { method: 'POST', body: JSON.stringify({}) }); } catch (e) { toast('Ошибка', e.message, 'err'); return; }
    await _loadWorks();
    const cartWorks = [...new Set((_cart.items || []).map((it) => it.work_id).filter(Boolean))];
    const preWork = cartWorks.length === 1 ? String(cartWorks[0]) : '';
    const reserve = d.reserve_lines || [];
    const procure = d.procure_lines || [];
    const equip = d.equipment_lines || [];
    const procureSum = procure.reduce((s, l) => s + (Number(l.last_price) || 0) * (Number(l.deficit_qty) || 0), 0);
    const rows = (list, kind) => list.map((l) => {
      const qty = kind === 'reserve' ? l.reserve_qty : (kind === 'equip' ? 1 : l.deficit_qty);
      const qtyTxt = kind === 'equip'
        ? (l.available > 0 ? 'на складе' : 'занято')
        : `${fmt(qty)} ${esc(l.unit || 'шт')}`;
      const price = kind === 'procure' ? _money(l.last_price) : '—';
      const best = kind === 'procure' && l.product_id
        ? ` <span class="wh2-prev__sup-acts">
            <button type="button" class="wh2-chip wh2-prev__best" data-cid="${l.cart_item_id||''}" data-pid="${l.product_id}" data-best="${l.best_price!=null?l.best_price:''}" data-sup="${esc(l.best_supplier||'')}" title="Подставить минимальную цену из базы">Подставить лучшую${l.best_price!=null?' · '+_money(l.best_price):''}</button>
            <button type="button" class="wh2-chip wh2-prev__pick" data-cid="${l.cart_item_id||''}" data-pid="${l.product_id}" title="Выбрать другого поставщика">Выбрать поставщика</button>
          </span>`
        : '';
      const picked = kind === 'procure' && l.supplier_picked
        ? ` <span class="wh2-chip" title="Выбрано вручную">${esc(l.last_supplier||'поставщик')} · ${_money(l.last_price)}</span>`
        : '';
      const neu = l.is_new_position ? ' <span class="wh2-chip" style="background:rgba(224,168,0,.2);color:#e0a800">новая</span>' : '';
      const pid = l.product_id ? ` <button type="button" class="wh2-prev__plink" data-pid="${l.product_id}" title="Открыть в каталоге">↗</button>` : '';
      return `<div class="wh2-prev__row"><div class="wh2-prev__name" title="${esc(l.name)}">${esc(humanCatalogName(l.name, l.product_id || l.equipment_id))}${neu}${pid}${picked}${best}</div><div class="wh2-prev__qty">${qtyTxt}</div><div class="wh2-prev__price">${price}</div></div>`;
    }).join('');
    // Enrich procure lines with supplier-compare (best = min)
    for (const l of procure.slice(0, 12)) {
      if (!l.product_id) continue;
      try {
        const cmp = await api('/api/price-records/supplier-compare?product_id=' + l.product_id + '&days=180');
        const rowsCmp = cmp.items || cmp.suppliers || cmp.rows || [];
        if (rowsCmp.length) {
          let best = rowsCmp[0];
          for (const r of rowsCmp) {
            const p = Number(r.min_price != null ? r.min_price : r.unit_price);
            const bp = Number(best.min_price != null ? best.min_price : best.unit_price);
            if (p > 0 && (!(bp > 0) || p < bp)) best = r;
          }
          l.best_price = Number(best.min_price != null ? best.min_price : best.unit_price) || null;
          l.best_supplier = best.supplier_name || best.name || '';
          l._compare = rowsCmp;
        }
      } catch (_) {}
    }
    const sec = (cls, title, list, kind, right) => list.length
      ? `<div class="wh2-prev__sec ${cls}"><div class="wh2-prev__sec-h">${title}<span>${right}</span></div>${rows(list, kind)}</div>`
      : '';
    const html = `<div class="wh2-prev">
      <p class="wh2-prev__kicker">Резерв и сборка создаются сразу. Закупка уходит РП как черновик — отправка закупщику только после проверки. Лучшую цену не подставляем молча: нажмите «Подставить лучшую» или «Выбрать поставщика».</p>
      <div class="wh2-prev__chips">
        <div class="wh2-prev__chip wh2-prev__chip--ok"><b>${reserve.length}</b> со склада</div>
        <div class="wh2-prev__chip wh2-prev__chip--buy"><b>${procure.length}</b> в закупку</div>
        ${equip.length ? `<div class="wh2-prev__chip"><b>${equip.length}</b> оборуд.</div>` : ''}
        ${procure.length ? `<div class="wh2-prev__chip"><b>${_money(procureSum)}</b> оценка закупки</div>` : ''}
      </div>
      ${sec('wh2-prev__sec--ok', 'Со склада (резерв)', reserve, 'reserve', reserve.length + ' поз.')}
      ${sec('wh2-prev__sec--buy', 'В закупку (дефицит)', procure, 'procure', procure.length + ' поз.')}
      ${sec('', 'Оборудование', equip, 'equip', equip.length + ' шт.')}
      ${(!reserve.length && !procure.length && !equip.length) ? '<div class="wh2-prev__empty">Нечего отправлять — корзина пуста или всё уже ушло.</div>' : ''}
      <div class="wh2-prev__work">
        <label for="wh2-prev-work">Работа (для сборки и заявки)</label>
        <select id="wh2-prev-work">${_workOptions(preWork)}</select>
        <div class="wh2-prev__work-hint">Без работы резерв не попадёт в сборку, заявка останется «без объекта».</div>
        <div class="wh2-prev__dest" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
          <div>
            <label for="wh2-prev-dest">Объект / куда везти</label>
            <input id="wh2-prev-dest" type="text" placeholder="Напр. Цех №3" autocomplete="off" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--border,rgba(255,255,255,.12));background:var(--bg2,rgba(0,0,0,.2));color:inherit"/>
          </div>
          <div>
            <label for="wh2-prev-date">Плановая дата</label>
            <input id="wh2-prev-date" type="date" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--border,rgba(255,255,255,.12));background:var(--bg2,rgba(0,0,0,.2));color:inherit"/>
          </div>
        </div>
        <div class="wh2-prev__work-hint">Объект и дата нужны кладовщику и попадут в мониторинг готовности РП.</div>
      </div>
      <div class="wh2-prev__foot">
        <button type="button" class="wh2-btn" id="wh2-prev-back">← Назад</button>
        <button type="button" class="wh2-btn wh2-btn--primary" id="wh2-prev-submit">Подтвердить и отправить</button>
      </div>
    </div>`;
    async function applySupplierPick(cartItemId, price, supplier) {
      if (!cartItemId) { toast('Корзина', 'Нет id позиции', 'warn'); return; }
      try {
        await api('/api/warehouse-cart/items/' + cartItemId, {
          method: 'PUT',
          body: JSON.stringify({ manual_price: price, supplier_name: supplier || null })
        });
        toast('Поставщик', (supplier || 'лучший') + ' · ' + _money(price), 'ok');
        UI.closeModal && UI.closeModal();
        await openSubmitPreview();
      } catch (e) { toast('Ошибка', e.message || 'Не сохранено', 'err'); }
    }
    async function openSupplierPicker(pid, cartItemId, preloaded) {
      let items = preloaded || [];
      if (!items.length) {
        try {
          const cmp = await api('/api/price-records/supplier-compare?product_id=' + pid + '&days=180');
          items = cmp.items || [];
        } catch (e) { toast('Сравнение', e.message || 'Нет данных', 'err'); return; }
      }
      if (!items.length) { toast('Сравнение', 'Нет предложений в базе цен', 'warn'); return; }
      const sorted = items.slice().sort((a, b) => (Number(a.min_price) || 1e18) - (Number(b.min_price) || 1e18));
      const listHtml = `<div class="proc-pay-modal wh2-sup-pick" data-sup-pick="1" style="max-width:480px">
        <p class="proc-pay-modal__hint">Выберите поставщика — цена попадёт в черновик заявки. Лучшая сверху.</p>
        <div style="display:flex;flex-direction:column;gap:8px;max-height:360px;overflow:auto">
          ${sorted.map((r, i) => {
            const p = Number(r.min_price != null ? r.min_price : r.avg_price);
            const nm = r.supplier_name || r.name || '—';
            return `<button type="button" class="btn ghost" data-pick-sup="${esc(nm)}" data-pick-price="${p}" style="text-align:left;display:flex;justify-content:space-between;gap:12px;padding:10px 12px">
              <span>${i === 0 ? '<b>Лучшая · </b>' : ''}${esc(nm)} <span style="color:var(--t3);font-size:11px">(${r.offers || 1} оф.)</span></span>
              <b>${_money(p)}</b>
            </button>`;
          }).join('')}
        </div>
      </div>`;
      if (UI.showModal) {
        UI.showModal({
          title: 'Выбор поставщика',
          html: listHtml,
          onMount: () => {
            document.querySelectorAll('[data-pick-sup]').forEach(b => {
              b.onclick = () => applySupplierPick(cartItemId, +b.dataset.pickPrice, b.dataset.pickSup);
            });
          }
        });
        document.querySelectorAll('[data-pick-sup]').forEach(b => {
          b.onclick = () => applySupplierPick(cartItemId, +b.dataset.pickPrice, b.dataset.pickSup);
        });
      }
    }
    const bindPrev = () => {
      const back = document.getElementById('wh2-prev-back');
      const go = document.getElementById('wh2-prev-submit');
      if (back) back.onclick = () => { UI.closeModal && UI.closeModal(); };
      if (go) go.onclick = () => {
        const workId = (document.getElementById('wh2-prev-work') || {}).value || null;
        const destination = ((document.getElementById('wh2-prev-dest') || {}).value || '').trim();
        const planned_date = (document.getElementById('wh2-prev-date') || {}).value || null;
        if (!workId) { toast('Работа', 'Выберите работу для сборки и заявки', 'warn'); return; }
        if (!destination) { toast('Объект', 'Укажите объект / куда везти', 'warn'); return; }
        if (!planned_date) { toast('Дата', 'Укажите плановую дату', 'warn'); return; }
        submitCart({ global_work_id: workId, destination, planned_date, object_name: destination, fromPreview: true });
      };
      document.querySelectorAll('.wh2-prev__plink[data-pid]').forEach(b => {
        b.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); openProduct(+b.dataset.pid); };
      });
      document.querySelectorAll('.wh2-prev__best').forEach(b => {
        b.onclick = (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          const price = b.dataset.best !== '' ? Number(b.dataset.best) : null;
          if (!(price > 0)) { toast('База цен', 'Нет лучшей цены — откройте выбор поставщика', 'warn'); return; }
          applySupplierPick(+b.dataset.cid, price, b.dataset.sup || null);
        };
      });
      document.querySelectorAll('.wh2-prev__pick').forEach(b => {
        b.onclick = (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          const line = procure.find(x => +x.product_id === +b.dataset.pid);
          openSupplierPicker(+b.dataset.pid, +b.dataset.cid, line && line._compare);
        };
      });
    };
    if (UI.showModal) {
      UI.showModal({ title: 'Предпросмотр перед отправкой', html, wide: true, onMount: bindPrev });
      bindPrev();
    } else {
      toast('Превью', 'Модалка недоступна — отправьте напрямую', 'warn');
    }
  }

  // ── Отправка корзины ──
  async function submitCart(opts) {
    const body = {
      global_work_id: (opts && opts.global_work_id) || null,
      destination: (opts && opts.destination) || null,
      planned_date: (opts && opts.planned_date) || null,
      object_name: (opts && opts.object_name) || (opts && opts.destination) || null,
      confirmed: true
    };
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
    toast('Готово', `Резерв: ${(r.reservations || []).length}${r.assembly_id ? ' · Сборка #' + r.assembly_id : ''}${r.procurement_id ? ' · Заявка #' + r.procurement_id + ' на проверке (черновик)' : ''}`, 'ok');
    if (r.procurement_id && window.AsgardProcurementPage && typeof AsgardProcurementPage.openDetail === 'function') {
      setTimeout(() => AsgardProcurementPage.openDetail(r.procurement_id), 400);
    }
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
    const CAT_ICON = (c, name) => {
      const s = ((c || '') + ' ' + (name || '')).toLowerCase();
      if (s.includes('сиз') || s.includes('защит') || s.includes('перчат') || s.includes('каск')) return '🧤';
      if (s.includes('хими') || s.includes('спрей') || s.includes('антипригар')) return '🧪';
      if (s.includes('электрод')) return '⚡';
      if (s.includes('проволок')) return '🧵';
      if (s.includes('метиз') || s.includes('крепёж') || s.includes('крепеж')) return '🔩';
      if (s.includes('электр') || s.includes('кабель')) return '⚡';
      if (s.includes('сантех')) return '🚿';
      if (s.includes('насос') || s.includes('оборуд')) return '⚙️';
      if (s.includes('шланг') || s.includes('рукав')) return '🪢';
      if (s.includes('инструм') || s.includes('диск') || s.includes('отрез')) return '💿';
      if (s.includes('строит') || s.includes('цемент')) return '🧱';
      if (s.includes('аренд')) return '🚜';
      return '📦';
    };
    container.innerHTML = `<div class="wh2-cards">${prods.map((p, idx) => {
      const media = p.photo_url
        ? `<img src="${esc(p.photo_url)}" alt="" loading="lazy">`
        : (window.AsgardGoodsIcon && (p.icon_path || p.icon_slug)
          ? window.AsgardGoodsIcon.placeholder({ slug: p.icon_slug, path: p.icon_path, size: 160, alt: p.name })
          : `<span class="wh2-card__media-fallback" aria-hidden="true">${CAT_ICON(p.category_name, p.name)}</span>`);
      return `
      <div class="wh2-card" data-pid="${p.id}" style="animation-delay:${Math.min(idx * 0.03, 0.4)}s">
        <div class="wh2-card__media wh2-card__media--t${idx % 6}">
          ${media}
          ${p.is_draft ? '<span class="wh2-card__tag"><span class="wh2-chip wh2-chip--draft">черновик</span></span>' : ''}
          <span class="wh2-card__badge wh2-card__badge--zero" data-badge="${p.id}">…</span>
          <div class="wh2-card__caption">
            <div class="wh2-card__caption-title">${esc(humanCatalogName(p.name, p.id))}</div>
            <div class="wh2-card__caption-sub">${esc(p.category_name || 'Без категории')}${p.article ? ' · ' + esc(p.article) : ''}</div>
          </div>
        </div>
        <div class="wh2-card__body">
          <div class="wh2-card__foot">
            <div class="wh2-avail" data-avail="${p.id}"><span class="wh2-card__sub">наличие…</span></div>
            ${cartStepper('consumable', p.id)}
          </div>
        </div>
      </div>`;
    }).join('')}</div>`;
    container.querySelectorAll('.wh2-card[data-pid]').forEach(c => c.onclick = (ev) => {
      if (ev.target.closest('.wh2-stp')) return;
      openProduct(+c.dataset.pid);
    });
    container.querySelectorAll('.wh2-stp[data-step-pid]').forEach(el => _bindStepper(el));
    if (window.AsgardGoodsIcon) window.AsgardGoodsIcon.hydrate(container);
    prods.forEach(async p => {
      try {
        const a = await api('/api/stock/availability/' + p.id);
        const el = container.querySelector(`[data-avail="${p.id}"]`); if (!el) return;
        const badge = container.querySelector(`[data-badge="${p.id}"]`);
        const z = !a.total;
        const unit = p.unit || 'шт';
        const loc = z ? '' : (a.slots[0] ? esc(a.slots[0].location_label || a.slots[0].warehouse_name || '') : '');
        el.innerHTML = `<span class="wh2-avail__n ${z ? 'wh2-avail__n--zero' : ''}">${fmt(a.total)}</span>
          <span class="wh2-card__sub">${z ? 'нет' : loc}</span>`;
        if (badge) {
          badge.textContent = z ? 'нет' : (fmt(a.total) + ' ' + unit);
          badge.classList.toggle('wh2-card__badge--zero', z);
        }
      } catch (_) {}
    });
  }

  async function openProduct(pid) {
    let card;
    try { card = await api('/api/stock/product/' + pid + '/card'); }
    catch (e) { toast('Ошибка', e.message, 'err'); return; }
    const p = card.item, slots = card.slots || [], moves = card.movements || [], lp = card.last_price;
    const CAT_ICON = (c, name) => {
      const s = ((c || '') + ' ' + (name || '')).toLowerCase();
      if (s.includes('сиз') || s.includes('защит') || s.includes('перчат') || s.includes('каск')) return '🧤';
      if (s.includes('хими') || s.includes('спрей') || s.includes('антипригар')) return '🧪';
      if (s.includes('электрод')) return '⚡';
      if (s.includes('проволок')) return '🧵';
      if (s.includes('метиз') || s.includes('крепёж') || s.includes('крепеж')) return '🔩';
      if (s.includes('электр') || s.includes('кабель')) return '⚡';
      if (s.includes('сантех')) return '🚿';
      if (s.includes('шланг') || s.includes('рукав')) return '🪢';
      if (s.includes('инструм') || s.includes('диск') || s.includes('отрез')) return '💿';
      if (s.includes('строит') || s.includes('цемент')) return '🧱';
      return '📦';
    };
    const photoInner = p.photo_url
      ? `<img src="${esc(p.photo_url)}" alt="">`
      : (window.AsgardGoodsIcon && (p.icon_path || p.icon_slug)
        ? window.AsgardGoodsIcon.placeholder({ slug: p.icon_slug, path: p.icon_path, size: 120, alt: p.name })
        : `<span style="font-size:72px;line-height:1">${CAT_ICON(p.category_name, p.name)}</span>`);
    UI.showModal && UI.showModal({
      title: esc(humanCatalogName(p.name, p.id)),
      html: `<div style="display:flex;flex-direction:column;gap:16px;min-width:min(420px,92vw)">
        <div class="wh2-prod-hero">
          <label class="wh2-prod-hero__ph" style="cursor:pointer;position:relative" title="Загрузить фото">
            ${photoInner}
            <input type="file" id="wh2-photo" accept="image/*" style="display:none">
            <span style="position:absolute;bottom:8px;right:8px;background:var(--gold,#D4A843);color:#1a1408;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 2px 8px rgba(0,0,0,.25)">📷</span>
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
    if (window.AsgardGoodsIcon) {
      const modalRoot = document.querySelector('.cr-m-overlay--visible #modalBody, .cr-m-overlay--visible .cr-m-body, .cr-m-overlay--visible') || document.body;
      window.AsgardGoodsIcon.hydrate(modalRoot);
    }
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
          <td><span style="display:inline-flex;align-items:center;gap:8px">${icon}<b>${esc(humanCatalogName(r.product_name, r.product_id))}</b></span>${r.article ? ' <span style="opacity:.5">' + esc(r.article) + '</span>' : ''}</td>
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
    if (!locs.length) {
      container.innerHTML = _emptyState('🗺️', 'Ячейки не заданы', 'Сгенерируйте сетку стеллажей — так удобнее принимать и выдавать расходники.', 'Сгенерировать сетку ячеек', 'wh2-bulk');
      bindBulk(container); return;
    }
    container.innerHTML = `<div class="wh2-cellmap">${locs.map(l => {
      const filled = (+l.stock_lines || 0) + (+l.unit_count || 0);
      return `
      <div class="wh2-cell ${filled > 0 ? 'wh2-cell--full' : ''}">
        <div class="wh2-cell__ico" aria-hidden="true">${filled > 0 ? '📦' : '🗂️'}</div>
        <div class="wh2-cell__lbl">${esc(l.label || l.zone)}</div>
        <div class="wh2-cell__cnt">${esc(l.warehouse_name || '')}</div>
        <div class="wh2-cell__cnt">${filled} поз.</div>
      </div>`;
    }).join('')}</div>`;
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
    if (!rows.length) {
      container.innerHTML = _emptyState('📜', 'Движений пока нет', 'Приходы, расходы и перемещения расходников появятся здесь после складских операций.', null, null);
      return;
    }
    container.innerHTML = `<div style="display:flex;flex-direction:column;gap:0">${rows.map(m => {
      const meta = MOVE_META[m.movement_type] || { i: '•', c: 'rgba(139,147,163,.15)', l: m.movement_type };
      const route = m.from_loc || m.to_loc ? `${esc(m.from_loc || m.from_wh_name || '')}${m.from_loc && m.to_loc ? ' → ' : ''}${esc(m.to_loc || m.to_wh_name || '')}` : '';
      return `<div class="wh2-mv">
        <div class="wh2-mv__ic" style="background:${meta.c}">${meta.i}</div>
        <div style="flex:1;min-width:0"><div style="font-weight:700;font-size:14px;line-height:1.3">${esc(m.product_name)}</div>
          <div class="wh2-card__sub" style="margin-top:3px">${meta.l} • ${fmt(m.qty)} ${esc(m.unit)}${route ? ' • ' + route : ''}</div>
          ${m.reason ? `<div class="wh2-card__sub">${esc(m.reason)}</div>` : ''}</div>
        <div class="wh2-card__sub" style="text-align:right;flex-shrink:0">${m.created_by_name ? esc(m.created_by_name) + '<br>' : ''}${new Date(m.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
      </div>`;
    }).join('')}</div>`;
  }

  // ── Шапка KPI ───────────────────────────────────────────────────────────
  async function renderKPIs(el) {
    let catCount = 0, lowCount = 0, locCount = 0, stockLines = 0;
    try { const c = await api('/api/products?limit=1'); } catch (_) {}
    try { const low = await api('/api/stock/low'); lowCount = (low.items || []).length; } catch (_) {}
    try { const loc = await api('/api/warehouse/locations?limit=1'); } catch (_) {}
    // Точные счётчики: каталог и ячейки берём отдельными лёгкими запросами
    try {
      const all = await api('/api/products?limit=1');
      catCount = all.total != null ? +all.total : (all.items || []).length;
    } catch (_) {}
    try {
      if (!catCount) {
        const all = await api('/api/products?limit=5000');
        catCount = all.total != null ? +all.total : (all.items || []).length;
      }
    } catch (_) {}
    try { const l = await api('/api/warehouse/locations?limit=2000'); locCount = (l.items || []).length; } catch (_) {}
    try { const s = await api('/api/stock?limit=1000'); stockLines = (s.items || []).length; } catch (_) {}
    el.innerHTML = `
      <div class="wh2-kpi wh2-kpi--gold"><div class="wh2-kpi__v">${fmt(catCount)}</div><div class="wh2-kpi__l">Позиций в каталоге</div></div>
      <div class="wh2-kpi wh2-kpi--ok"><div class="wh2-kpi__v">${fmt(stockLines)}</div><div class="wh2-kpi__l">Строк наличия</div></div>
      <div class="wh2-kpi ${lowCount ? 'wh2-kpi--warn' : ''}"><div class="wh2-kpi__v">${fmt(lowCount)}</div><div class="wh2-kpi__l">Ниже минимума</div></div>
      <div class="wh2-kpi"><div class="wh2-kpi__v">${fmt(locCount)}</div><div class="wh2-kpi__l">Ячеек хранения</div></div>`;
  }

  // ── Перерисовка активной вкладки ──────────────────────────────────────────
  let _searchVal = '';
  async function refresh() {
    const body = _root.querySelector('#wh2-body');
    const toolbar = _root.querySelector('#wh2-toolbar');
    // toolbar зависит от вкладки. На «Оборудование» поиск и кнопки рисует сам модуль.
    const addBtn = toolbar.querySelector('#wh2-add');
    addBtn.style.display = (_tab === 'consumables' || _tab === 'locations') ? '' : 'none';
    if (_tab === 'consumables') addBtn.textContent = '+ Позиция';
    else if (_tab === 'locations') addBtn.textContent = 'Сетка ячеек';
    toolbar.style.display = (['equipment', 'incoming', 'movements', 'map', 'ops', 'unpick', 'inventory', 'director', 'writeoffs', 'assemblies', 'sheet', 'monitor'].includes(_tab)) ? 'none' : '';
    const searchWrap = toolbar.querySelector('.wh2-search');
    if (searchWrap) searchWrap.style.display = (_tab === 'locations') ? 'none' : '';
    const kpis = _root.querySelector('#wh2-kpis');
    if (kpis) kpis.style.display = (_tab === 'map' || _tab === 'incoming' || _tab === 'ops' || _tab === 'assemblies' || _tab === 'sheet' || _tab === 'monitor') ? 'none' : '';
    const tabs = _root.querySelector('#wh2-tabs');
    if (tabs) tabs.style.marginBottom = (_tab === 'map') ? '10px' : '';
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
    if (_tab === 'map') return renderMapTab(body);
    if (_tab === 'ops') return renderOpsTab(body);
    if (_tab === 'unpick') return renderUnpickTab(body);
    if (_tab === 'inventory') return renderInventoryTab(body);
    if (_tab === 'writeoffs') return renderWriteoffTab(body);
    if (_tab === 'director') return renderDirectorTab(body);
    if (_tab === 'assemblies' || _tab === 'sheet' || _tab === 'monitor') {
      if (!window.WH2Asm) {
        body.innerHTML = `<div class="wh2-empty"><div class="wh2-empty__i">📦</div>Модуль сборок не загружен.</div>`;
        return;
      }
      const q = _parseWhHash();
      return window.WH2Asm.render(body, _tab, {
        api, user: _user, toast, esc, id: q.id ? +q.id : null
      });
    }
  }

  function _parseWhHash() {
    const h = String(location.hash || '');
    const qi = h.indexOf('?');
    const out = { tab: null, id: null };
    if (qi < 0) return out;
    try {
      const sp = new URLSearchParams(h.slice(qi + 1));
      out.tab = sp.get('tab');
      out.id = sp.get('id');
    } catch (_) {}
    return out;
  }

  // ════════════════════ ВКЛАДКА: ПРИЁМКА (входящие закупки онлайн) ════════════════════
  async function renderMapTab(body) {
    try { localStorage.setItem('asgard_v2_banner_dismissed', '1'); } catch (_) {}
    document.querySelectorAll('.asgard-v2-banner, [data-v2-banner], .crm-v2-banner').forEach((el) => {
      try { el.remove(); } catch (_) { el.style.display = 'none'; }
    });
    body.innerHTML = `<div id="wh2-map-host" class="wh2-map-host"></div>`;
    const host = body.querySelector('#wh2-map-host');
    if (!window.AsgardWarehouseMap) {
      host.innerHTML = `<div class="wh2-empty"><div class="wh2-empty__i">🗺️</div>Модуль карты не загружен (warehouse-map.js).</div>`;
      return;
    }
    const canEdit = ['ADMIN', 'WAREHOUSE', 'CHIEF_ENGINEER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(_user && _user.role);
    try {
      await AsgardWarehouseMap.mount(host, {
        warehouseId: _cart.warehouse_id || (_whs[0] && _whs[0].id) || null,
        editMode: false,
        api: {
          get: (u) => api(u),
          post: (u, b) => api(u, { method: 'POST', body: JSON.stringify(b || {}) }),
          put: (u, b) => api(u, { method: 'PUT', body: JSON.stringify(b || {}) }),
          del: (u) => api(u, { method: 'DELETE' })
        }
      });
      if (!canEdit) {/* view-only: edit button still present but write API will 403 */}
    } catch (e) {
      host.innerHTML = `<div class="wh2-empty"><div class="wh2-empty__i">⚠️</div>${esc(e.message)}</div>`;
    }
  }

  async function resolvePlaceId(raw) {
    const v = String(raw || '').trim();
    if (!v) return null;
    let id = parseInt(v, 10);
    if (id && String(id) === v) return id;
    try {
      const p = await api('/api/warehouse-map/by-place/' + encodeURIComponent(v));
      return p.items && p.items[0] && p.items[0].id;
    } catch (_) { return null; }
  }

  function renderLocHistoryHtml(h, locId) {
    const sim = (h.similar || []).map(s =>
      `<button type="button" class="wh2-btn" data-sim-code="${esc(s.place_code || s.label || s.id)}" style="padding:4px 8px;font-size:12px">
        ${esc(s.place_code || s.label || ('#' + s.id))}${s.stock_qty > 0 ? ' · ' + fmt(s.stock_qty) : ''}</button>`).join(' ');
    return `<div class="wh2-miss">
      <h4>📍 Место #${locId} — история</h4>
      <div style="font-size:13px;line-height:1.55">
        <b>Остаток:</b> ${(h.stock || []).map(s => esc(s.name) + ' × ' + s.quantity).join(', ') || '—'}<br>
        <b>Оборудование:</b> ${(h.equipment || []).map(e => esc(e.name)).join(', ') || '—'}<br>
        <b>Движения:</b> ${(h.movements || []).slice(0, 6).map(m => esc(m.product_name || '') + ' ' + fmt(m.qty) + ' (' + esc(m.movement_type || '') + ')').join('; ') || '—'}<br>
        <b>Операции:</b> ${(h.op_items || []).slice(0, 8).map(i => esc(i.session_type) + '/' + esc(i.status)).join('; ') || '—'}
      </div>
      ${sim ? `<div style="margin-top:10px"><div style="font-size:12px;color:var(--t2);margin-bottom:6px">Похожие ячейки:</div><div style="display:flex;gap:6px;flex-wrap:wrap">${sim}</div></div>` : ''}
    </div>`;
  }

  async function renderOpsTab(body) {
    body.innerHTML = `<div class="wh2-ops-nav">
      <div class="wh2-ops-nav__pri">
        <button class="wh2-btn wh2-btn--primary" id="wh2-ops-receive">Массовая приёмка</button>
        <button class="wh2-btn" id="wh2-ops-putaway">Раскладка</button>
        <button class="wh2-btn" id="wh2-ops-pick">Пикинг</button>
        <button class="wh2-btn" id="wh2-ops-xdock">На паллет сборки</button>
        <button class="wh2-btn" id="wh2-ops-sitebulk">ОПО списком</button>
      </div>
      <div class="wh2-ops-nav__sec">
        <button class="wh2-btn" id="wh2-ops-refresh">Обновить</button>
      </div>
    </div>
    <div id="wh2-ops-panel"></div>
    <div id="wh2-ops-list"></div>
    <div id="wh2-ops-detail" style="margin-top:14px"></div>`;
    const listEl = body.querySelector('#wh2-ops-list');
    const detail = body.querySelector('#wh2-ops-detail');
    const panel = body.querySelector('#wh2-ops-panel');
    const whId = _cart.warehouse_id || (_whs[0] && _whs[0].id);
    const TYPE_RU = { receive: 'Приёмка', putaway: 'Раскладка', pick: 'Пикинг', unpick: 'Снятие', inventory: 'Инвентаризация' };
    function fmtOpened(iso) {
      if (!iso) return '—';
      try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return String(iso).slice(0, 16);
        return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      } catch (_) { return String(iso).slice(0, 16); }
    }
    function humanTitle(s) {
      const t = String(s.title || '').trim();
      if (!t || /^B-(receive|putaway|pick|unpick)/i.test(t) || /^E2E\b/i.test(t) || /-\d{10,}$/.test(t) || /\d{10,}/.test(t)) {
        return (TYPE_RU[s.session_type] || 'Сессия') + ' #' + s.id;
      }
      return t || ((TYPE_RU[s.session_type] || 'Сессия') + ' #' + s.id);
    }
    function markOpsNav(id) {
      body.querySelectorAll('.wh2-ops-nav .wh2-btn').forEach((b) => {
        b.classList.toggle('wh2-btn--on', !!id && b.id === id);
      });
      const recv = body.querySelector('#wh2-ops-receive');
      if (recv) recv.classList.toggle('wh2-btn--primary', !id || id === 'wh2-ops-receive');
    }

    async function load() {
      const d = await api('/api/warehouse-ops/sessions?status=open' + (whId ? '&warehouse_id=' + whId : ''));
      const items = d.items || [];
      if (!items.length) {
        listEl.innerHTML = `<div class="wh2-ops-empty">Нет открытых сессий.<br>Начните с массовой приёмки или раскладки.</div>`;
        return;
      }
      listEl.innerHTML = `<div class="wh2-table-wrap"><table class="wh2-table"><thead><tr><th>№</th><th>Тип</th><th>Название</th><th>Открыта</th><th></th></tr></thead><tbody>
        ${items.map(s => `<tr><td>${s.id}</td><td>${esc(TYPE_RU[s.session_type] || s.session_type)}</td><td>${esc(humanTitle(s))}</td><td>${esc(fmtOpened(s.opened_at))}</td>
        <td><button class="wh2-btn" data-sid="${s.id}">Открыть</button></td></tr>`).join('')}
      </tbody></table></div>`;
      listEl.querySelectorAll('[data-sid]').forEach(b => b.onclick = () => openSession(b.getAttribute('data-sid')));
    }

    async function showMissingPanel(outEl, placeRaw, itemId, sessionId) {
      try {
        const locId = await resolvePlaceId(placeRaw);
        if (!locId) throw new Error('Место не найдено — сначала укажите код места');
        const h = await api('/api/warehouse-ops/locations/' + locId + '/history');
        outEl.innerHTML = renderLocHistoryHtml(h, locId) + `
          <div class="wh2-ops-actions" style="margin-top:10px">
            <button class="wh2-btn" id="wh2-miss-escalate" style="border-color:var(--err-t,#ff5c5c);color:var(--err-t,#ff5c5c)">Эскалировать (факт 0)</button>
            <button class="wh2-btn" id="wh2-miss-wo">Списание → вкладка</button>
            <button class="wh2-btn" id="wh2-miss-close">Скрыть</button>
          </div>`;
        outEl.querySelectorAll('[data-sim-code]').forEach(b => b.onclick = () => {
          const code = b.getAttribute('data-sim-code');
          const placeInp = detail.querySelector(`[data-place="${itemId}"]`);
          if (placeInp) placeInp.value = code;
          toast('Место', 'Подставлено: ' + code, 'ok');
        });
        const escBtn = outEl.querySelector('#wh2-miss-escalate');
        if (escBtn && itemId) escBtn.onclick = async () => {
          try {
            await api('/api/warehouse-ops/items/' + itemId + '/confirm', {
              method: 'POST', body: JSON.stringify({ place_code: placeRaw, fact_qty: 0, reason_code: 'missing', notes: 'нет на полке', device: 'crm' })
            });
            toast('Эскалация', 'Строка с variance (факт 0)', 'warn');
            openSession(sessionId);
          } catch (e) { toast('Ошибка', e.message, 'err'); }
        };
        const wo = outEl.querySelector('#wh2-miss-wo');
        if (wo) wo.onclick = () => {
          const tab = _root.querySelector('.wh2-tab[data-tab="writeoffs"]');
          if (tab) tab.click();
        };
        const cl = outEl.querySelector('#wh2-miss-close');
        if (cl) cl.onclick = () => { outEl.innerHTML = ''; };
      } catch (e) { outEl.innerHTML = `<div style="color:var(--err-t)">${esc(e.message)}</div>`; }
    }

    function bindConfirmRow(tr, it, sessionId, missOut) {
      const iid = it.id;
      const placeEl = tr.querySelector(`[data-place="${iid}"]`);
      const step2 = tr.querySelector(`[data-step2="${iid}"]`);
      const stepLbl = tr.querySelector(`[data-steplbl="${iid}"]`);
      const nextBtn = tr.querySelector(`[data-next="${iid}"]`);
      const confBtn = tr.querySelector(`[data-confirm="${iid}"]`);
      const missBtn = tr.querySelector(`[data-miss="${iid}"]`);
      const unlockBtn = tr.querySelector(`[data-unlock="${iid}"]`);

      if (nextBtn) nextBtn.onclick = async () => {
        const place = (placeEl && placeEl.value || '').trim();
        if (!place) return toast('Место', 'Сначала скан / код места', 'warn');
        try {
          await api('/api/warehouse-ops/items/' + iid + '/lock', { method: 'POST', body: JSON.stringify({ device: 'crm' }) });
          if (step2) step2.style.display = '';
          if (nextBtn) nextBtn.style.display = 'none';
          if (stepLbl) stepLbl.innerHTML = 'Шаг <b>2/2</b> — факт';
          const qty = tr.querySelector(`[data-qty="${iid}"]`);
          if (qty && (qty.value === '' || qty.value == null) && it.planned_qty != null) qty.value = it.planned_qty;
          toast('Место', 'Строка заблокирована за вами', 'ok');
        } catch (e) { toast('Ошибка', e.message, 'err'); }
      };
      if (confBtn) confBtn.onclick = async () => {
        const place = (placeEl && placeEl.value || '').trim();
        if (!place) return toast('Место', 'Нужен код места', 'warn');
        if (step2 && step2.style.display === 'none') {
          // шаг 1→2: lock + показать поле факта (план уже prefilled)
          try {
            await api('/api/warehouse-ops/items/' + iid + '/lock', { method: 'POST', body: JSON.stringify({ device: 'crm' }) });
          } catch (e) { /* уже locked нами — ок */ }
          step2.style.display = '';
          if (nextBtn) nextBtn.style.display = 'none';
          if (stepLbl) stepLbl.innerHTML = 'Шаг <b>2/2</b> — факт';
          const qtyEl = tr.querySelector(`[data-qty="${iid}"]`);
          if (qtyEl && (qtyEl.value === '' || qtyEl.value == null) && it.planned_qty != null) qtyEl.value = it.planned_qty;
          toast('Шаг 2', 'Укажите факт и нажмите «Подтвердить» ещё раз', 'ok');
          return;
        }
        const payload = { place_code: place, device: 'crm' };
        const eq = tr.querySelector(`[data-eq="${iid}"]`);
        const qty = tr.querySelector(`[data-qty="${iid}"]`);
        if (eq) payload.equipment_qr = (eq.value || '').trim();
        if (qty) {
          const fv = qty.value === '' ? null : parseFloat(qty.value);
          payload.fact_qty = fv;
          if (fv === 0) {
            await showMissingPanel(missOut, place, iid, sessionId);
            return;
          }
        }
        try {
          await api('/api/warehouse-ops/items/' + iid + '/confirm', { method: 'POST', body: JSON.stringify(payload) });
          toast('OK', 'Строка подтверждена', 'ok');
          openSession(sessionId);
        } catch (e) { toast('Ошибка', e.message, 'err'); }
      };
      if (missBtn) missBtn.onclick = async () => {
        const place = (placeEl && placeEl.value || '').trim();
        await showMissingPanel(missOut, place, iid, sessionId);
      };
      if (unlockBtn) unlockBtn.onclick = async () => {
        try {
          await api('/api/warehouse-ops/items/' + iid + '/unlock', { method: 'POST', body: '{}' });
          toast('Разблок', 'Строка свободна', 'ok'); openSession(sessionId);
        } catch (e) { toast('Ошибка', e.message, 'err'); }
      };
    }

    function confirmCellHtml(it) {
      if (!['pending', 'locked', 'variance'].includes(it.status)) return '—';
      const step2 = it.status === 'locked' || it.status === 'variance';
      const iid = it.id;
      return `<div class="wh2-ops-row">
        <div class="wh2-ops-step" data-steplbl="${iid}">Шаг <b>${step2 ? '2/2' : '1/2'}</b> — ${step2 ? 'факт (кол-во / QR)' : 'скан места'}</div>
        <input class="wh2-inp" data-place="${iid}" placeholder="скан / код места" value="${esc(it.place_code || it.target_place_code || it.location_label || '')}">
        <div data-step2="${iid}" style="${step2 ? '' : 'display:none'}">
          ${it.track_type === 'piece'
            ? `<input class="wh2-inp" data-eq="${iid}" placeholder="QR единицы оборудования" style="width:100%">`
            : `<input class="wh2-inp" data-qty="${iid}" type="number" step="any" placeholder="кол-во / вес" value="${it.planned_qty != null ? it.planned_qty : ''}" style="width:100%">`}
        </div>
        <div class="wh2-ops-actions">
          ${step2 ? '' : `<button class="wh2-btn wh2-btn--primary" data-next="${iid}">Далее →</button>`}
          <button class="wh2-btn wh2-btn--primary" data-confirm="${iid}">Подтвердить</button>
          <button class="wh2-btn" data-miss="${iid}">Нет на полке</button>
          ${it.status === 'locked' ? `<button class="wh2-btn" data-unlock="${iid}">Снять блок</button>` : ''}
        </div>
      </div>`;
    }

    async function openSession(id) {
      const d = await api('/api/warehouse-ops/sessions/' + id);
      const items = d.items || [];
      const sessType = d.session.session_type;
      detail.innerHTML = `<div class="wh2-panel">
        <h3 class="wh2-panel__t">Сессия #${id} · ${esc(TYPE_RU[sessType] || sessType)}${d.session.document_ref ? ' · ' + esc(d.session.document_ref) : ''}</h3>
        ${sessType === 'pick' ? `<div class="proc-next-banner" style="margin-bottom:12px"><div class="proc-next-banner__t">Маршрут пикинга</div><div class="proc-next-banner__s">1) Скан ячейки (стеллаж/полка) → 2) факт кол-ва → подтвердить. Собранное кладите на паллет/коробку сборки (кнопка «На паллет сборки» или DnD в ведомости). Бирка и упак. лист — в карточке сборки.</div></div>` : ''}
        ${sessType === 'putaway' ? `<div class="proc-next-banner" style="margin-bottom:12px"><div class="proc-next-banner__t">Куда класть</div><div class="proc-next-banner__s">Скан целевой ячейки → подтвердите кол-во. Подсказка putaway доступна из приёмки.</div></div>` : ''}
        <div style="margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap">
          <input id="wh2-hist-loc" class="wh2-inp" placeholder="ID / код места → история">
          <button class="wh2-btn" id="wh2-hist-go">История места</button>
        </div>
        <div id="wh2-hist-out"></div>
        <div id="wh2-miss-out"></div>
        <div class="wh2-table-wrap"><table class="wh2-table"><thead><tr>
          <th>#</th><th>Тип</th><th>Позиция</th><th>План</th><th>Факт</th><th>Статус</th><th>Подтверждение</th>
        </tr></thead><tbody>
        ${items.map(it => `<tr data-iid="${it.id}">
          <td>${it.line_no}</td><td>${esc(it.track_type)}</td><td>${esc(it.item_name || '—')}</td>
          <td>${it.planned_qty != null ? fmt(it.planned_qty) : '—'}</td>
          <td>${it.fact_qty != null ? fmt(it.fact_qty) : '—'}</td>
          <td>${esc(it.status)}</td>
          <td>${confirmCellHtml(it)}</td>
        </tr>`).join('')}
        </tbody></table></div>
        <button class="wh2-btn" id="wh2-ops-close" style="margin-top:10px">Закрыть сессию</button>
      </div>`;

      const missOut = detail.querySelector('#wh2-miss-out');
      detail.querySelectorAll('tr[data-iid]').forEach(tr => {
        const it = items.find(x => String(x.id) === String(tr.getAttribute('data-iid')));
        if (it) bindConfirmRow(tr, it, id, missOut);
      });

      const histGo = detail.querySelector('#wh2-hist-go');
      if (histGo) histGo.onclick = async () => {
        const v = (detail.querySelector('#wh2-hist-loc') || {}).value || '';
        const out = detail.querySelector('#wh2-hist-out');
        try {
          const locId = await resolvePlaceId(v);
          if (!locId) throw new Error('Место не найдено');
          const h = await api('/api/warehouse-ops/locations/' + locId + '/history');
          out.innerHTML = renderLocHistoryHtml(h, locId);
          out.querySelectorAll('[data-sim-code]').forEach(b => b.onclick = () => {
            const code = b.getAttribute('data-sim-code');
            toast('Место', code, 'ok');
            const histInp = detail.querySelector('#wh2-hist-loc');
            if (histInp) histInp.value = code;
          });
        } catch (e) { out.innerHTML = `<div style="color:var(--err-t)">${esc(e.message)}</div>`; }
      };
      const cl = detail.querySelector('#wh2-ops-close');
      if (cl) cl.onclick = async () => {
        try {
          await api('/api/warehouse-ops/sessions/' + id + '/close', { method: 'POST', body: '{}' });
          toast('Сессия', 'Закрыта', 'ok'); detail.innerHTML = ''; load();
        } catch (e) { toast('Ошибка', e.message, 'err'); }
      };
    }

    async function createSession(type, items, extra) {
      if (!whId) return toast('Склад', 'Нет warehouse_id', 'err');
      try {
        const d = await api('/api/warehouse-ops/sessions', {
          method: 'POST', body: JSON.stringify({
            warehouse_id: whId, session_type: type,
            title: (extra && extra.title) || (TYPE_RU[type] || type) + ' ' + new Date().toLocaleString('ru-RU'),
            document_ref: (extra && extra.document_ref) || null,
            assembly_id: (extra && extra.assembly_id) || null,
            items: items || []
          })
        });
        // lock all pending rows for concurrent safety
        for (const it of (d.items || [])) {
          try { await api('/api/warehouse-ops/items/' + it.id + '/lock', { method: 'POST', body: JSON.stringify({ device: 'crm' }) }); } catch (_) {}
        }
        toast('Сессия', '#' + d.session.id + (d.items && d.items.length ? ` · ${d.items.length} строк` : ''), 'ok');
        panel.innerHTML = ''; load(); openSession(d.session.id);
      } catch (e) { toast('Ошибка', e.message, 'err'); }
    }

    function openBulkReceivePanel() {
      if (!whId) return toast('Склад', 'Нет warehouse_id', 'err');
      markOpsNav('wh2-ops-receive');
      let lines = [];
      panel.innerHTML = `<div class="wh2-panel wh2-br-panel">
        <div class="wh2-panel__t">Массовая приёмка по СФ / УПД</div>
        <div class="wh2-br-flow">
          <div class="wh2-br-flow__step wh2-br-flow__step--on"><span>1</span> Файл / вставка / штрихкод</div>
          <div class="wh2-br-flow__step"><span>2</span> Проверка матчинга каталога</div>
          <div class="wh2-br-flow__step"><span>3</span> Сессия приёмки → раскладка</div>
        </div>
        <div class="wh2-mk-hint">Загрузите Excel/PDF/фото накладной, вставьте строки (<code>название;кол-во;ед</code>) или сканируйте штрихкод.</div>
        <div class="wh2-br-grid">
          <div class="wh2-br-box">
            <div class="wh2-br-box__t">Документ и файл</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
              <select id="wh2-br-doctype" class="wh2-inp"><option value="upd">УПД</option><option value="invoice">Счёт / СФ</option><option value="other">Накладная</option></select>
              <input id="wh2-br-docref" class="wh2-inp" placeholder="№ документа" style="min-width:140px;flex:1">
            </div>
            <label class="wh2-btn wh2-btn--primary" style="cursor:pointer;margin:0;display:inline-flex">Загрузить файл<input type="file" id="wh2-br-file" accept=".xlsx,.xls,.pdf,image/*" style="display:none"></label>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center">
              <input id="wh2-br-barcode" class="wh2-inp" placeholder="Скан штрихкода / артикула" style="flex:1;min-width:160px">
              <button class="wh2-btn" id="wh2-br-scanadd">+ по штрихкоду</button>
            </div>
          </div>
          <div class="wh2-br-box">
            <div class="wh2-br-box__t">Вставка строк</div>
            <textarea id="wh2-br-paste" class="wh2-inp" rows="5" placeholder="название;кол-во;ед&#10;Кабель ВВГ 3×2.5;100;м" style="width:100%;resize:vertical;font-family:inherit;min-height:110px"></textarea>
            <button class="wh2-btn" id="wh2-br-parse" style="margin-top:8px">Разобрать вставку</button>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin:12px 0 0;flex-wrap:wrap">
          <button class="wh2-btn wh2-btn--primary" id="wh2-br-create">Создать сессию приёмки</button>
          <button class="wh2-btn" id="wh2-br-cancel">Отмена</button>
          <span id="wh2-br-st" style="font-size:12px;color:var(--gold);align-self:center"></span>
        </div>
        <div id="wh2-br-preview" style="margin-top:12px"></div>
      </div>`;

      const st = panel.querySelector('#wh2-br-st');
      const setSt = t => { st.textContent = t || ''; };

      function drawPreview() {
        const host = panel.querySelector('#wh2-br-preview');
        if (!lines.length) { host.innerHTML = `<div class="wh2-empty" style="padding:20px">Позиций пока нет</div>`; return; }
        host.innerHTML = `<table class="wh2-table"><thead><tr><th></th><th>Наименование</th><th>Арт.</th><th>Кол-во</th><th>Ед.</th><th>product_id</th><th></th></tr></thead><tbody>
          ${lines.map((l, i) => `<tr>
            <td><input type="checkbox" data-br-on="${i}" ${l.include !== false ? 'checked' : ''}></td>
            <td><input class="wh2-inp" data-br-name="${i}" value="${esc(l.name || '')}" style="width:100%;min-width:140px"></td>
            <td><input class="wh2-inp" data-br-art="${i}" value="${esc(l.article || '')}" style="width:80px"></td>
            <td><input class="wh2-inp" data-br-qty="${i}" type="number" step="any" value="${l.quantity != null ? l.quantity : 1}" style="width:70px"></td>
            <td><input class="wh2-inp" data-br-unit="${i}" value="${esc(l.unit || 'шт')}" style="width:55px"></td>
            <td style="font-size:12px;color:var(--t2)">${l.product_id ? '#' + l.product_id : (l.matched === false ? 'не найден' : '…')}</td>
            <td><button class="wh2-btn" data-br-del="${i}" style="padding:2px 8px">✕</button></td>
          </tr>`).join('')}
        </tbody></table>`;
        host.querySelectorAll('[data-br-del]').forEach(b => b.onclick = () => { syncLines(); lines.splice(+b.getAttribute('data-br-del'), 1); drawPreview(); });
      }

      function syncLines() {
        panel.querySelectorAll('[data-br-name]').forEach(inp => {
          const i = +inp.getAttribute('data-br-name'); if (!lines[i]) return;
          lines[i].name = inp.value;
          const a = panel.querySelector(`[data-br-art="${i}"]`); if (a) lines[i].article = a.value;
          const q = panel.querySelector(`[data-br-qty="${i}"]`); if (q) lines[i].quantity = parseFloat(q.value) || 1;
          const u = panel.querySelector(`[data-br-unit="${i}"]`); if (u) lines[i].unit = u.value || 'шт';
          const c = panel.querySelector(`[data-br-on="${i}"]`); if (c) lines[i].include = c.checked;
        });
      }

      async function matchLine(l) {
        const q = (l.article || l.name || '').trim();
        if (!q) return l;
        try {
          let d = await api('/api/products?limit=5&search=' + encodeURIComponent(q));
          let hit = (d.items || [])[0];
          if (!hit && l.name) {
            d = await api('/api/products/search?q=' + encodeURIComponent(l.name));
            hit = (d.items || [])[0];
          }
          if (hit) { l.product_id = hit.id; l.unit = l.unit || hit.unit || 'шт'; l.matched = true; }
          else l.matched = false;
        } catch (_) { l.matched = false; }
        return l;
      }

      async function ingestItems(rawItems) {
        setSt('Матчинг каталога…');
        const mapped = [];
        for (const it of rawItems) {
          const l = { name: it.name, article: it.article || '', quantity: it.quantity != null ? it.quantity : 1, unit: it.unit || 'шт', include: true };
          await matchLine(l);
          mapped.push(l);
        }
        lines = lines.concat(mapped);
        setSt(''); drawPreview();
      }

      panel.querySelector('#wh2-br-cancel').onclick = () => { panel.innerHTML = ''; };
      panel.querySelector('#wh2-br-parse').onclick = async () => {
        const text = panel.querySelector('#wh2-br-paste').value || '';
        const parsed = text.split(/\r?\n/).map(row => row.trim()).filter(Boolean).map(row => {
          const parts = row.split(/[;\t|]/).map(x => x.trim());
          return { name: parts[0], quantity: parseFloat(parts[1]) || 1, unit: parts[2] || 'шт', article: parts[3] || '' };
        });
        if (!parsed.length) return toast('Вставка', 'Нет строк', 'warn');
        await ingestItems(parsed);
      };
      panel.querySelector('#wh2-br-scanadd').onclick = async () => {
        const code = (panel.querySelector('#wh2-br-barcode').value || '').trim();
        if (!code) return;
        const l = { name: code, article: code, quantity: 1, unit: 'шт', include: true };
        await matchLine(l);
        if (!l.product_id) l.name = code;
        else {
          try {
            const p = await api('/api/products/' + l.product_id);
            if (p.item) { l.name = p.item.name; l.unit = p.item.unit || l.unit; }
          } catch (_) {}
        }
        lines.push(l);
        panel.querySelector('#wh2-br-barcode').value = '';
        drawPreview();
        panel.querySelector('#wh2-br-barcode').focus();
      };
      panel.querySelector('#wh2-br-barcode').onkeydown = (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); panel.querySelector('#wh2-br-scanadd').click(); }
      };
      panel.querySelector('#wh2-br-file').onchange = async () => {
        const file = panel.querySelector('#wh2-br-file').files && panel.querySelector('#wh2-br-file').files[0];
        if (!file) return;
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        const docType = panel.querySelector('#wh2-br-doctype').value;
        try {
          if (ext === 'xlsx' || ext === 'xls') {
            setSt('Разбор Excel…');
            const fd = new FormData(); fd.append('source_doc', docType); fd.append('file', file);
            const t = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token');
            const r = await fetch('/api/catalog-import/excel', { method: 'POST', headers: { Authorization: 'Bearer ' + t }, body: fd });
            const d = await r.json(); if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
            await ingestItems(d.items || []);
          } else {
            const text = await extractDocText(file, setSt);
            setSt('AI разбирает документ…');
            const d = await api('/api/catalog-import/ai', { method: 'POST', body: JSON.stringify({ text, source_doc: docType }) });
            if (d.ai_unavailable) { setSt(''); toast('AI', d.message || 'недоступен', 'warn'); return; }
            await ingestItems(d.items || []);
          }
        } catch (e) { setSt(''); toast('Ошибка', e.message, 'err'); }
      };
      panel.querySelector('#wh2-br-create').onclick = async () => {
        syncLines();
        const selected = lines.filter(l => l.include !== false && l.name);
        if (!selected.length) return toast('Приёмка', 'Нет позиций', 'warn');
        const items = selected.map(l => ({
          track_type: 'consumable',
          product_id: l.product_id || null,
          planned_qty: l.quantity || 1,
          unit: l.unit || 'шт',
          meta_json: { name: l.name, article: l.article || null }
        }));
        await createSession('receive', items, {
          title: 'Приёмка ' + new Date().toLocaleString('ru-RU'),
          document_ref: (panel.querySelector('#wh2-br-docref').value || '').trim() || null
        });
      };
      drawPreview();
    }

    async function openCrossDockPanel() {
      if (!whId) return toast('Склад', 'Нет warehouse_id', 'err');
      panel.innerHTML = `<div class="wh2-panel"><div class="wh2-panel__t">Сразу на паллет assembly (cross-dock)</div>
        <div class="wh2-mk-hint">Выберите открытую сборку — позиция пойдёт на паллет без раскладки на полку.</div>
        <div id="wh2-xd-list" class="wh2-loading">Загрузка сборок…</div>
        <div style="margin-top:10px"><button class="wh2-btn" id="wh2-xd-cancel">Отмена</button></div></div>`;
      panel.querySelector('#wh2-xd-cancel').onclick = () => { panel.innerHTML = ''; };
      try {
        const d = await api('/api/assembly?limit=40');
        const asms = (d.items || []).filter(a => !['closed', 'returned'].includes(a.status));
        const host = panel.querySelector('#wh2-xd-list');
        if (!asms.length) { host.innerHTML = `<div class="wh2-empty">Нет активных сборок</div>`; return; }
        host.innerHTML = `<table class="wh2-table"><thead><tr><th>ID</th><th>Название</th><th>Статус</th><th>Поз.</th><th></th></tr></thead><tbody>
          ${asms.map(a => `<tr>
            <td>#${a.id}</td><td>${esc(a.title || a.work_title || '—')}</td><td>${esc(a.status)}</td>
            <td>${a.items_count || 0}</td>
            <td><button class="wh2-btn wh2-btn--primary" data-xd="${a.id}">Выбрать</button></td>
          </tr>`).join('')}
        </tbody></table>`;
        host.querySelectorAll('[data-xd]').forEach(b => b.onclick = async () => {
          const asmId = parseInt(b.getAttribute('data-xd'), 10);
          try {
            const sug = await api('/api/warehouse-map/suggest-putaway?warehouse_id=' + whId);
            const d2 = await api('/api/warehouse-ops/putaway-from-receive', {
              method: 'POST', body: JSON.stringify({
                warehouse_id: whId, cross_dock: true, assembly_id: asmId,
                title: 'Cross-dock ASM #' + asmId,
                items: [{ track_type: 'consumable', planned_qty: 1, meta_json: { cross_dock_pallet: true, suggest: (sug.suggestions || [])[0] || null } }]
              })
            });
            for (const it of (d2.items || [])) {
              try { await api('/api/warehouse-ops/items/' + it.id + '/lock', { method: 'POST', body: JSON.stringify({ device: 'crm' }) }); } catch (_) {}
            }
            toast('Cross-dock', 'Сессия #' + d2.session.id, 'ok');
            panel.innerHTML = ''; load(); openSession(d2.session.id);
          } catch (e) { toast('Ошибка', e.message, 'err'); }
        });
      } catch (e) {
        panel.querySelector('#wh2-xd-list').innerHTML = `<div class="wh2-empty">${esc(e.message)}</div>`;
      }
    }

    async function openSiteBulkPanel() {
      panel.innerHTML = `<div class="wh2-panel"><div class="wh2-panel__t">📋 ОПО: отметить получение на объекте</div>
        <div class="wh2-mk-hint">Сборка в пути / собрана / принята — отметьте позиции чекбоксами (без телефона полевика).</div>
        <div id="wh2-sb-asms" class="wh2-loading">Загрузка…</div>
        <div id="wh2-sb-items" style="margin-top:12px"></div>
        <button class="wh2-btn" id="wh2-sb-cancel" style="margin-top:10px">Закрыть</button></div>`;
      panel.querySelector('#wh2-sb-cancel').onclick = () => { panel.innerHTML = ''; };
      try {
        const d = await api('/api/assembly?limit=40');
        const asms = (d.items || []).filter(a => a.type === 'mobilization' && ['in_transit', 'packed', 'received', 'packing'].includes(a.status));
        const host = panel.querySelector('#wh2-sb-asms');
        if (!asms.length) { host.innerHTML = `<div class="wh2-empty">Нет подходящих сборок</div>`; return; }
        host.innerHTML = `<table class="wh2-table"><thead><tr><th>ID</th><th>Название</th><th>Статус</th><th></th></tr></thead><tbody>
          ${asms.map(a => `<tr><td>#${a.id}</td><td>${esc(a.title || '')}</td><td>${esc(a.status)}</td>
            <td><button class="wh2-btn" data-sb="${a.id}">Позиции</button></td></tr>`).join('')}
        </tbody></table>`;
        host.querySelectorAll('[data-sb]').forEach(b => b.onclick = async () => {
          const asmId = b.getAttribute('data-sb');
          const det = await api('/api/assembly/' + asmId);
          const items = det.items || [];
          const box = panel.querySelector('#wh2-sb-items');
          box.innerHTML = `<div style="font-weight:600;margin-bottom:8px">Сборка #${asmId}</div>
            <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
              <button class="wh2-btn" id="wh2-sb-all">Выбрать все непринятые</button>
              <button class="wh2-btn wh2-btn--primary" id="wh2-sb-go">Отметить выбранные</button>
            </div>
            ${(items.length ? items.map(it => `<label class="wh2-chk">
              <input type="checkbox" data-sbi="${it.id}" ${it.received ? 'disabled' : 'checked'}>
              <span>${esc(it.name || '')} · ${fmt(it.quantity)} ${esc(it.unit || 'шт')}${it.received ? ' <span class="wh2-chip wh2-chip--ok">получено</span>' : ''}</span>
            </label>`).join('') : '<div class="wh2-empty">Нет позиций</div>')}`;
          const allBtn = box.querySelector('#wh2-sb-all');
          if (allBtn) allBtn.onclick = () => box.querySelectorAll('[data-sbi]:not(:disabled)').forEach(c => { c.checked = true; });
          box.querySelector('#wh2-sb-go').onclick = async () => {
            const ids = [...box.querySelectorAll('[data-sbi]:checked')].map(c => parseInt(c.getAttribute('data-sbi'), 10));
            if (!ids.length) return toast('ОПО', 'Ничего не выбрано', 'warn');
            try {
              const r = await api('/api/warehouse-ops/site-receipt-bulk', {
                method: 'POST', body: JSON.stringify({ assembly_id: parseInt(asmId, 10), item_ids: ids, note: 'ОПО без телефона' })
              });
              toast('ОПО', 'Отмечено: ' + (r.updated || 0), 'ok');
              b.click();
            } catch (e) { toast('Ошибка', e.message, 'err'); }
          };
        });
      } catch (e) {
        panel.querySelector('#wh2-sb-asms').innerHTML = `<div class="wh2-empty">${esc(e.message)}</div>`;
      }
    }

    body.querySelector('#wh2-ops-putaway').onclick = () => { markOpsNav('wh2-ops-putaway'); createSession('putaway', []); };
    body.querySelector('#wh2-ops-pick').onclick = () => { markOpsNav('wh2-ops-pick'); createSession('pick', []); };
    body.querySelector('#wh2-ops-receive').onclick = openBulkReceivePanel;
    body.querySelector('#wh2-ops-xdock').onclick = () => { markOpsNav('wh2-ops-xdock'); openCrossDockPanel(); };
    body.querySelector('#wh2-ops-sitebulk').onclick = () => { markOpsNav('wh2-ops-sitebulk'); openSiteBulkPanel(); };
    body.querySelector('#wh2-ops-refresh').onclick = () => { markOpsNav(null); panel.innerHTML = ''; load(); };
    await load();
  }

  async function renderUnpickTab(body) {
    const d = await api('/api/warehouse-ops/unpick-queue');
    const items = d.items || [];
    body.innerHTML = `<div class="proc-pay-modal" style="max-width:960px;box-shadow:none;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:18px">
      <div class="proc-pay-modal__kicker">Склад · возврат на полку</div>
      <h3 style="margin:4px 0 8px;font-size:18px">Убрать с паллета → на полку</h3>
      <p class="proc-pay-modal__hint" style="margin:0 0 14px">Позиции после демоба или отмены сборки. Укажите ячейку и нажмите «Убрать на полку».</p>
      ${!items.length ? `<div class="wh2-empty"><div class="wh2-empty__i">↩</div>
        <div style="font-size:16px;font-weight:700;color:var(--t1)">Очередь пуста</div>
        <div style="margin-top:8px;max-width:420px;margin-left:auto;margin-right:auto;color:var(--t2);font-size:13px;line-height:1.45">
          Когда появится возврат с паллета — он будет здесь. Пока можно открыть сборки или операции.
        </div>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:14px;flex-wrap:wrap">
          <button class="wh2-btn wh2-btn--primary" id="wh2-unpick-asm">К сборкам</button>
          <button class="wh2-btn" id="wh2-unpick-ops">К операциям</button>
        </div>
      </div>` : `
      <div class="wh2-table-wrap"><table class="wh2-table"><thead><tr><th>Сборка</th><th>Позиция</th><th>Паллет</th><th>Куда</th><th></th></tr></thead><tbody>
      ${items.map(it => `<tr>
        <td>#${it.assembly_id} ${esc(it.assembly_title || '')}</td>
        <td>${esc(it.name || it.equipment_name || it.product_name || '')}</td>
        <td>${it.pallet_number != null ? 'P' + it.pallet_number : '—'}</td>
        <td><input data-loc="${it.id}" placeholder="код ячейки" style="width:120px" value="${it.unpick_to_location_id || ''}"></td>
        <td><button class="wh2-btn wh2-btn--primary" data-unpick="${it.id}" data-ai="${it.assembly_id}">Убрать на полку</button></td>
      </tr>`).join('')}
      </tbody></table></div>`}
    </div>`;
    const goAsm = body.querySelector('#wh2-unpick-asm');
    if (goAsm) goAsm.onclick = () => { location.hash = '#/warehouse-v2?tab=assemblies'; };
    const goOps = body.querySelector('#wh2-unpick-ops');
    if (goOps) goOps.onclick = () => {
      const tab = _root.querySelector('.wh2-tab[data-tab="ops"]');
      if (tab) tab.click();
    };
    body.querySelectorAll('[data-unpick]').forEach(btn => btn.onclick = async () => {
      const aiId = btn.getAttribute('data-unpick');
      const asmId = btn.getAttribute('data-ai');
      const place = (body.querySelector(`[data-loc="${aiId}"]`) || {}).value;
      const whId = _cart.warehouse_id || (_whs[0] && _whs[0].id);
      try {
        const sess = await api('/api/warehouse-ops/sessions', {
          method: 'POST', body: JSON.stringify({
            warehouse_id: whId, session_type: 'unpick', assembly_id: parseInt(asmId, 10),
            title: 'Возврат на полку #' + aiId,
            items: [{ assembly_item_id: parseInt(aiId, 10), track_type: 'consumable', planned_qty: 1, meta_json: { place_hint: place } }]
          })
        });
        const itemId = sess.items[0] && sess.items[0].id;
        if (itemId && place) {
          await api('/api/warehouse-ops/items/' + itemId + '/confirm', {
            method: 'POST', body: JSON.stringify({ place_code: place, fact_qty: 1, device: 'crm' })
          });
        }
        toast('На полку', 'Готово', 'ok'); renderUnpickTab(body);
      } catch (e) { toast('Ошибка', e.message, 'err'); }
    });
  }

  async function renderInventoryTab(body) {
    const whId = _cart.warehouse_id || (_whs[0] && _whs[0].id);
    const INV_STATUS_RU = { open: 'Открыта', review: 'На проверке', closed: 'Закрыта' };
    function fmtInvDate(iso) {
      if (!iso) return '—';
      try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return String(iso).slice(0, 16);
        return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      } catch (_) { return String(iso).slice(0, 16); }
    }
    function humanInvTitle(s) {
      const t = String(s.title || '').trim();
      if (!t || /^E-?inv/i.test(t) || /^E2E\s*inventory/i.test(t) || /-\d{10,}$/.test(t)) {
        return 'Инвентаризация #' + s.id;
      }
      return t;
    }
    body.innerHTML = `<div class="wh2-toolbar" style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <button class="wh2-btn wh2-btn--primary" id="wh2-inv-new">Новая инвентаризация</button>
      <button class="wh2-btn" id="wh2-inv-ref">Обновить</button>
    </div>
    <div id="wh2-inv-list"></div>
    <div id="wh2-inv-detail" style="margin-top:14px"></div>`;
    const listEl = body.querySelector('#wh2-inv-list');
    const detail = body.querySelector('#wh2-inv-detail');
    async function load() {
      const d = await api('/api/warehouse-ops/inventory' + (whId ? ('?warehouse_id=' + whId) : ''));
      const items = d.items || [];
      listEl.innerHTML = !items.length
        ? `<div class="wh2-empty">Нет сессий инвентаризации.<br><span style="opacity:.75">Нажмите «Новая инвентаризация», чтобы начать сверку.</span></div>`
        : `<div class="wh2-table-wrap"><table class="wh2-table"><thead><tr><th>№</th><th>Название</th><th>Статус</th><th>Открыта</th><th></th></tr></thead><tbody>
        ${items.map(s => `<tr><td>${s.id}</td><td>${esc(humanInvTitle(s))}</td><td>${esc(INV_STATUS_RU[s.status] || s.status)}</td><td>${esc(fmtInvDate(s.opened_at))}</td>
          <td>${s.status === 'open' || s.status === 'review' ? `<button class="wh2-btn" data-invid="${s.id}">Строки</button>` : '—'}</td></tr>`).join('')}
        </tbody></table></div>`;
      listEl.querySelectorAll('[data-invid]').forEach(b => b.onclick = () => openInv(b.getAttribute('data-invid')));
    }
    async function openInv(id) {
      detail.innerHTML = `<div class="proc-pay-modal" style="max-width:720px;box-shadow:none;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:18px">
        <div class="proc-pay-modal__kicker">Склад · инвентаризация</div>
        <h3 style="margin:4px 0 8px;font-size:18px">Сессия #${id}</h3>
        <p class="proc-pay-modal__hint" style="margin:0 0 14px">Запишите факт по месту. При нулевом факте укажите причину.</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:12px">
          <label class="proc-pay-modal__label">Место (код ячейки)
            <input id="wh2-inv-place" class="wh2-inp" placeholder="A-01-02 или id">
          </label>
          <label class="proc-pay-modal__label">Тип учёта
            <select id="wh2-inv-track" class="wh2-inp"><option value="consumable">Расходник</option><option value="piece">Оборудование</option></select>
          </label>
          <label class="proc-pay-modal__label">ID позиции
            <input id="wh2-inv-pid" class="wh2-inp" placeholder="номенклатура / оборудование" inputmode="numeric">
          </label>
          <label class="proc-pay-modal__label">Ожидалось
            <input id="wh2-inv-exp" class="wh2-inp" type="number" step="any" placeholder="по учёту">
          </label>
          <label class="proc-pay-modal__label">Факт
            <input id="wh2-inv-fact" class="wh2-inp" type="number" step="any" placeholder="насчитано">
          </label>
          <label class="proc-pay-modal__label">Причина (если факт 0)
            <input id="wh2-inv-reason" class="wh2-inp" placeholder="например: не найдено">
          </label>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="wh2-btn wh2-btn--primary" id="wh2-inv-addline">Записать строку</button>
          <button class="wh2-btn" id="wh2-inv-close">Закрыть сессию</button>
        </div>
        <div id="wh2-inv-msg" style="margin-top:8px;font-size:13px;color:var(--t2)"></div>
      </div>`;
      detail.querySelector('#wh2-inv-addline').onclick = async () => {
        const place = detail.querySelector('#wh2-inv-place').value.trim();
        const track = detail.querySelector('#wh2-inv-track').value;
        const idRaw = detail.querySelector('#wh2-inv-pid').value.trim();
        let location_id = parseInt(place, 10) || null;
        if (!location_id && place) {
          const p = await api('/api/warehouse-map/by-place/' + encodeURIComponent(place));
          location_id = p.items && p.items[0] && p.items[0].id;
        }
        const payload = {
          location_id, track_type: track,
          expected_qty: detail.querySelector('#wh2-inv-exp').value === '' ? null : parseFloat(detail.querySelector('#wh2-inv-exp').value),
          fact_qty: detail.querySelector('#wh2-inv-fact').value === '' ? null : parseFloat(detail.querySelector('#wh2-inv-fact').value),
          reason_code: detail.querySelector('#wh2-inv-reason').value || null
        };
        if (track === 'piece') payload.equipment_id = parseInt(idRaw, 10) || null;
        else payload.product_id = parseInt(idRaw, 10) || null;
        try {
          const r = await api('/api/warehouse-ops/inventory/' + id + '/lines', { method: 'POST', body: JSON.stringify(payload) });
          detail.querySelector('#wh2-inv-msg').textContent = `Строка #${r.line.id}: ${r.line.status} (Δ ${r.line.variance_qty != null ? r.line.variance_qty : '—'})`;
          toast('Инвентаризация', r.line.status, 'ok');
        } catch (e) { toast('Ошибка', e.message, 'err'); }
      };
      detail.querySelector('#wh2-inv-close').onclick = async () => {
        try {
          await api('/api/warehouse-ops/inventory/' + id + '/close', { method: 'POST', body: '{}' });
          toast('OK', 'Сессия закрыта', 'ok'); detail.innerHTML = ''; load();
        } catch (e) { toast('Ошибка', e.message, 'err'); }
      };
    }
    body.querySelector('#wh2-inv-new').onclick = async () => {
      if (!whId) return toast('Склад', 'Нет warehouse_id', 'err');
      try {
        const r = await api('/api/warehouse-ops/inventory', { method: 'POST', body: JSON.stringify({ warehouse_id: whId, title: 'Инвентаризация ' + new Date().toLocaleDateString('ru-RU') }) });
        toast('OK', 'Сессия #' + r.session.id, 'ok'); await load(); openInv(r.session.id);
      } catch (e) { toast('Ошибка', e.message, 'err'); }
    };
    body.querySelector('#wh2-inv-ref').onclick = load;
    await load();
  }

  async function renderWriteoffTab(body) {
    const whVal = _cart.warehouse_id || (_whs[0] && _whs[0].id) || '';
    body.innerHTML = `<div class="proc-pay-modal" style="max-width:720px;box-shadow:none;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:18px">
      <div class="proc-pay-modal__kicker">Склад · списание</div>
      <h3 style="margin:4px 0 8px;font-size:18px">Выдача и списание расходников</h3>
      <p class="proc-pay-modal__hint" style="margin:0 0 14px">Укажите позицию, место и количество. Для списания обязательна причина.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
        <label class="proc-pay-modal__label">ID позиции (номенклатура)
          <input id="wh2-wo-pid" class="wh2-inp" placeholder="например 1420" inputmode="numeric">
        </label>
        <label class="proc-pay-modal__label">Склад (ID)
          <input id="wh2-wo-wh" class="wh2-inp" placeholder="склад" value="${whVal}">
        </label>
        <label class="proc-pay-modal__label">Место (код ячейки)
          <input id="wh2-wo-loc" class="wh2-inp" placeholder="A-01-02 или id">
        </label>
        <label class="proc-pay-modal__label">Количество
          <input id="wh2-wo-qty" class="wh2-inp" type="number" step="any" placeholder="">
        </label>
        <label class="proc-pay-modal__label" style="grid-column:1/-1">Причина списания
          <input id="wh2-wo-reason" class="wh2-inp" placeholder="бой, брак, инвентаризация…">
        </label>
      </div>
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        <button class="wh2-btn wh2-btn--primary" id="wh2-wo-issue">Выдать со склада</button>
        <button class="wh2-btn wh2-btn--primary" id="wh2-wo-off">Списать</button>
        <button class="wh2-btn" id="wh2-wo-hist">История места</button>
      </div>
      <div id="wh2-wo-out" style="margin-top:12px"></div>
    </div>`;
    body.querySelector('#wh2-wo-issue').onclick = async () => {
      try {
        const location_id = await resolvePlaceId(body.querySelector('#wh2-wo-loc').value.trim());
        await api('/api/stock/issue', { method: 'POST', body: JSON.stringify({
          product_id: parseInt(body.querySelector('#wh2-wo-pid').value, 10),
          warehouse_id: parseInt(body.querySelector('#wh2-wo-wh').value, 10),
          location_id, qty: parseFloat(body.querySelector('#wh2-wo-qty').value),
          reason: body.querySelector('#wh2-wo-reason').value || 'issue'
        }) });
        toast('Выдача', 'Готово', 'ok');
      } catch (e) { toast('Ошибка', e.message, 'err'); }
    };
    body.querySelector('#wh2-wo-off').onclick = async () => {
      try {
        const location_id = await resolvePlaceId(body.querySelector('#wh2-wo-loc').value.trim());
        const reason = body.querySelector('#wh2-wo-reason').value;
        if (!reason) return toast('Списание', 'Укажите причину', 'warn');
        await api('/api/stock/writeoff', { method: 'POST', body: JSON.stringify({
          product_id: parseInt(body.querySelector('#wh2-wo-pid').value, 10),
          warehouse_id: parseInt(body.querySelector('#wh2-wo-wh').value, 10),
          location_id, qty: parseFloat(body.querySelector('#wh2-wo-qty').value), reason
        }) });
        toast('Списание', 'Готово', 'ok');
      } catch (e) { toast('Ошибка', e.message, 'err'); }
    };
    body.querySelector('#wh2-wo-hist').onclick = async () => {
      const out = body.querySelector('#wh2-wo-out');
      try {
        const location_id = await resolvePlaceId(body.querySelector('#wh2-wo-loc').value.trim());
        if (!location_id) throw new Error('Место не найдено');
        const h = await api('/api/warehouse-ops/locations/' + location_id + '/history');
        out.innerHTML = renderLocHistoryHtml(h, location_id);
      } catch (e) { out.textContent = e.message; }
    };
  }

  async function renderDirectorTab(body) {
    try {
      const d = await api('/api/warehouse-ops/director-summary');
      const ASM_RU = {
        draft: 'Черновик', confirmed: 'Подтверждена', packing: 'Сборка', packed: 'Собрано',
        in_transit: 'В пути', received: 'Принято', returned: 'Возврат', closed: 'Закрыта'
      };
      const OP_RU = { receive: 'Приёмка', putaway: 'Раскладка', pick: 'Пикинг', unpick: 'Снятие', inventory: 'Инвентаризация' };
      const INV_RU = { open: 'Открыта', review: 'На проверке', closed: 'Закрыта' };
      const MAP_RU = {
        shelf_light: 'Лёгкие стеллажи', shelf_pallet: 'Паллетные', floor_zone: 'Зоны пола',
        clothing: 'Спецодежда', aisle: 'Проходы', door: 'Двери', column: 'Колонны',
        machine: 'Станок', workbench: 'Верстак', assembly_pallet: 'Паллет сборки',
        scrap: 'Брак', rack: 'Стеллаж', pallet: 'Паллет', bin: 'Ячейка',
        zone: 'Зона', staging: 'Зона комплектации', quarantine: 'Карантин'
      };
      const rows = (arr, labelFn) => (arr || []).length
        ? `<table class="wh2-table"><thead><tr><th>Статус</th><th style="text-align:right">Кол-во</th></tr></thead><tbody>
            ${arr.map(r => `<tr><td>${esc(labelFn(r))}</td><td style="text-align:right;font-weight:700">${fmt(r.n)}</td></tr>`).join('')}
          </tbody></table>`
        : `<div style="color:var(--t2);font-size:13px">нет данных</div>`;
      body.innerHTML = `
        <div class="wh2-kpis">
          <div class="wh2-kpi wh2-kpi--warn"><div class="wh2-kpi__v">${fmt(d.unpick_queue)}</div><div class="wh2-kpi__l">Очередь снятия</div></div>
          <div class="wh2-kpi wh2-kpi--gold"><div class="wh2-kpi__v">${fmt((d.assemblies || []).reduce((s, a) => s + (a.n || 0), 0))}</div><div class="wh2-kpi__l">Активные сборки</div></div>
          <div class="wh2-kpi"><div class="wh2-kpi__v">${fmt((d.open_sessions || []).reduce((s, a) => s + (a.n || 0), 0))}</div><div class="wh2-kpi__l">Открытые WMS-сессии</div></div>
          <div class="wh2-kpi wh2-kpi--ok"><div class="wh2-kpi__v">${fmt((d.map_fill || []).reduce((s, a) => s + (a.n || 0), 0))}</div><div class="wh2-kpi__l">Объектов на карте</div></div>
        </div>
        <div class="wh2-dir-grid">
          <div class="wh2-dir-card"><h4>Сборки (статусы)</h4>${rows(d.assemblies, a => ASM_RU[a.status] || a.status)}</div>
          <div class="wh2-dir-card"><h4>Открытые сессии операций</h4>${rows(d.open_sessions, a => OP_RU[a.session_type] || a.session_type)}</div>
          <div class="wh2-dir-card"><h4>Инвентаризации</h4>${rows(d.inventory, a => INV_RU[a.status] || a.status)}</div>
          <div class="wh2-dir-card"><h4>Карта — заполнение</h4>${rows(d.map_fill, a => MAP_RU[a.object_type] || a.object_type)}</div>
        </div>
        <div class="wh2-panel" style="margin-top:14px">
          <div class="wh2-panel__t">Быстрые переходы</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="wh2-btn" data-goto="ops">📦 Операции</button>
            <button class="wh2-btn" data-goto="unpick">↩ Убрать</button>
            <button class="wh2-btn" data-goto="inventory">📋 Инвентаризация</button>
            <button class="wh2-btn" data-goto="writeoffs">📉 Списания</button>
            <button class="wh2-btn" data-goto="map">🗺️ Карта</button>
          </div>
        </div>`;
      body.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => {
        const tab = _root.querySelector('.wh2-tab[data-tab="' + b.getAttribute('data-goto') + '"]');
        if (tab) tab.click();
      });
    } catch (e) {
      body.innerHTML = `<div class="wh2-empty">${esc(e.message)}</div>`;
    }
  }

  // ════════════════════ ВКЛАДКА: ПРИЁМКА (входящие закупки онлайн) ════════════════════
  const PI_STATUS = {
    pending: { l: 'Ожидает', c: '#c9a84c' }, ordered: { l: 'Заказано', c: '#ffb020' },
    shipped: { l: 'В пути', c: '#4A90D9' }, delivered: { l: 'Доставлено', c: '#30d158' },
    partially_delivered: { l: 'Частично', c: '#ffb020' },
  };
  async function renderIncoming(container) {
    container.innerHTML = `<div class="wh2-loading">Загрузка входящих поставок…</div>`;
    let data;
    try { data = await api('/api/stock/incoming?target=all'); }
    catch (e) { container.innerHTML = `<div class="wh2-empty"><div class="wh2-empty__i">⚠️</div>${esc(e.message)}</div>`; return; }
    const rows = data.items || [], sm = data.summary || {};
    if (!rows.length) {
      container.innerHTML = _emptyState('', 'Входящих поставок нет', 'Здесь появятся позиции из заявок на закупку, которые едут на склад или напрямую на объект.', null, null);
      return;
    }
    const wh = rows.filter(r => r.delivery_target === 'warehouse');
    const obj = rows.filter(r => r.delivery_target === 'object');
    const pendingWh = wh.filter(r => !r.item_status || r.item_status === 'pending' || r.item_status === 'ordered' || r.item_status === 'shipped').length;
    const dt = d => d ? new Date(d).toLocaleDateString('ru-RU') : '—';
    const overdue = d => d && new Date(d) < new Date() ? 'color:var(--err-t,#ff5c5c);font-weight:700' : '';
    const softName = (n, id) => {
      const t = String(n || '').trim();
      if (!t) return '—';
      // демо/фолбэк-имена → читаемые позиции каталога
      const CATALOG = [
        'Анкер клиновой М12', 'Болт М10×60 DIN933', 'Гайка М10 DIN934', 'Шайба 10 DIN125',
        'Хомут червячный 20–32', 'Дюбель нейлон 8×60', 'Саморез 4.2×75', 'Изолента ПВХ 19 мм',
        'Скотч армированный', 'Кабель-канал 25×16'
      ];
      if (/^(A-FALLBACK|WMS-A-SAFE|WMS-A-FALLBACK|SCENARIO)-/i.test(t)) {
        const n = parseInt((t.match(/(\d{3,})/) || ['0', '0'])[1], 10) || t.length;
        return CATALOG[Math.abs(n) % CATALOG.length];
      }
      return humanCatalogName(t, id != null ? id : undefined);
    };
    const row = r => {
      const st = PI_STATUS[r.item_status] || { l: r.item_status, c: '#8b93a3' };
      const deadline = r.delivery_deadline || r.needed_by;
      const title = softName(r.name, r.product_id || r.id);
      const wait = !r.item_status || r.item_status === 'pending';
      const stHtml = wait
        ? `<span class="wh2-st-wait">${esc(st.l)}</span>`
        : `<span class="wh2-chip wh2-chip--status" style="--st:${st.c}">${esc(st.l)}</span>`;
      return `<tr>
        <td><b title="${esc(r.name || '')}">${esc(title)}</b>${r.article ? ' <span style="opacity:.5">' + esc(r.article) + '</span>' : ''}</td>
        <td>${fmt(r.quantity)} ${esc(r.unit || 'шт')}</td>
        <td>${stHtml}</td>
        <td style="${overdue(deadline)}">${dt(deadline)}</td></tr>`;
    };
    const groupTable = (list) => {
      const byProc = new Map();
      list.forEach((r) => {
        const k = r.procurement_id != null ? ('p:' + r.procurement_id) : ('w:' + (r.work_title || r.object_name || 'Без работы'));
        if (!byProc.has(k)) byProc.set(k, []);
        byProc.get(k).push(r);
      });
      return [...byProc.entries()].map(([, items]) => {
        const head = items[0];
        const work = head.work_title || head.object_name || 'Без работы';
        const proc = head.proc_name || '—';
        const pid = head.procurement_id;
        const label = pid ? `Заявка #${pid} · ${work}` : work;
        return `<div class="wh2-recv-grp">
          <div class="wh2-recv-grp__h">
            <span>${esc(label)}</span>
            <span class="mut" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              ${esc(proc)} <span class="wh2-recv-grp__cnt">${items.length}</span>
              <button type="button" class="wh2-btn wh2-btn--sm wh2-recv-grp__go" data-recv-go="1">Принять</button>
              ${pid ? `<a class="wh2-link" href="#/procurement?id=${pid}">Карточка</a>` : ''}
            </span>
          </div>
          <div class="wh2-table-wrap"><table class="wh2-table"><thead><tr><th>Позиция</th><th>Кол-во</th><th>Статус</th><th>Срок</th></tr></thead><tbody>${items.map(row).join('')}</tbody></table></div>
        </div>`;
      }).join('');
    };
    container.innerHTML = `
      <div class="wh2-recv-hero">
        <div class="wh2-recv-hero__copy">
          <div class="wh2-recv-hero__kicker">Приёмка на склад</div>
          <div class="wh2-recv-hero__title">Три шага: увидеть поставку → принять по документу → разложить на полки</div>
          <ol class="wh2-recv-steps">
            <li class="on"><b>1</b> Поставки ниже</li>
            <li><b>2</b> Массовая приёмка</li>
            <li><b>3</b> Раскладка / WMS</li>
          </ol>
        </div>
        <button type="button" class="wh2-btn wh2-btn--primary wh2-recv-hero__cta" id="wh2-incoming-goto-recv">К приёмке</button>
      </div>
      <div class="wh2-page-tip">Список ниже — что едет/приехало. Чтобы принять по документу, жмите <b>К приёмке</b> (или вкладка Операции → Массовая приёмка).</div>
      <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap" class="wh2-recv-kpis">
        <div class="wh2-recv-kpi wh2-recv-kpi--blue"><div class="wh2-recv-kpi__v">${fmt(pendingWh || sm.to_warehouse_in_transit || 0)}</div><div class="wh2-recv-kpi__l">К приёмке на склад</div></div>
        <div class="wh2-recv-kpi wh2-recv-kpi--ok"><div class="wh2-recv-kpi__v">${fmt(sm.to_warehouse_delivered || 0)}</div><div class="wh2-recv-kpi__l">Доставлено на склад</div></div>
        <div class="wh2-recv-kpi"><div class="wh2-recv-kpi__v">${fmt(obj.length || sm.to_object || 0)}</div><div class="wh2-recv-kpi__l">Напрямую на объект</div></div>
      </div>
      ${wh.length ? `<div class="wh2-recv-sec"><div class="wh2-recv-sec__t">На склад (приёмка кладовщиком)</div>${groupTable(wh)}</div>` : ''}
      ${obj.length ? `<div class="wh2-recv-sec"><div class="wh2-recv-sec__t">Напрямую на объект (мимо склада — для информации)</div>${groupTable(obj)}</div>` : ''}`;
    const goto = container.querySelector('#wh2-incoming-goto-recv');
    const goRecv = () => {
      const tab = _root.querySelector('.wh2-tab[data-tab="ops"]');
      if (tab) tab.click();
      setTimeout(() => { const b = document.getElementById('wh2-ops-receive'); if (b) b.click(); }, 400);
    };
    if (goto) goto.onclick = goRecv;
    container.querySelectorAll('[data-recv-go]').forEach((b) => { b.onclick = goRecv; });
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
      <div style="border:1px solid var(--border,#262c38);border-radius:12px">
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
        <button class="wh2-tab wh2-tab--active" data-tab="equipment">Оборудование</button>
        <button class="wh2-tab" data-tab="consumables">Расходники</button>
        <button class="wh2-tab" data-tab="assemblies">Сборки</button>
        <button class="wh2-tab" data-tab="monitor">Готовность</button>
        <button class="wh2-tab" data-tab="map">Карта</button>
        <button class="wh2-tab" data-tab="incoming">Приёмка</button>
        <button class="wh2-tab" data-tab="ops">Операции</button>
        <button class="wh2-tab" data-tab="unpick">Убрать</button>
        <button class="wh2-tab" data-tab="inventory">Инвентаризация</button>
        <button class="wh2-tab" data-tab="writeoffs">Списания</button>
        <button class="wh2-tab" data-tab="locations">Ячейки</button>
        <button class="wh2-tab" data-tab="movements">Движения</button>
        <button class="wh2-tab" data-tab="director">Директор</button>
      </div>
      <div class="wh2-toolbar" id="wh2-toolbar">
        <div class="wh2-search"><input id="wh2-q" placeholder="Поиск по наименованию или артикулу…" autocomplete="off"><button class="wh2-search__clear" id="wh2-q-clear" title="Очистить">✕</button><div class="wh2-ac" id="wh2-ac" style="display:none"></div></div>
        <button class="wh2-btn wh2-btn--primary" id="wh2-add">+ Позиция</button>
      </div>
      <div id="wh2-body"></div>`;
    host.appendChild(_root);

    // deep-link ?tab=&id=
    const hq = _parseWhHash();
    if (hq.tab && ['equipment','consumables','assemblies','sheet','monitor','map','incoming','ops','unpick','inventory','writeoffs','locations','movements','director'].includes(hq.tab)) {
      _tab = hq.tab === 'sheet' ? 'sheet' : hq.tab;
    }
    // роли: Готовность видна PM/DIR; Сборки — WH и PM
    const role = (_user && _user.role) || '';
    const showMonitor = ['PM','HEAD_PM','ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'].includes(role);
    const showAsm = ['WAREHOUSE','ADMIN','PM','HEAD_PM','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'].includes(role);
    _root.querySelectorAll('.wh2-tab').forEach((t) => {
      if (t.dataset.tab === 'monitor' && !showMonitor) t.style.display = 'none';
      if (t.dataset.tab === 'assemblies' && !showAsm) t.style.display = 'none';
    });
    _root.querySelectorAll('.wh2-tab').forEach((t) => {
      t.classList.toggle('wh2-tab--active', t.dataset.tab === _tab || (_tab === 'sheet' && t.dataset.tab === 'assemblies'));
    });

    _root.querySelectorAll('.wh2-tab').forEach(t => t.onclick = () => {
      _root.querySelectorAll('.wh2-tab').forEach(x => x.classList.remove('wh2-tab--active'));
      t.classList.add('wh2-tab--active'); _tab = t.dataset.tab; _searchVal = '';
      if (window.WH2Asm) { try { WH2Asm.setMonitorId(null); } catch (_) {} }
      try { location.hash = '#/warehouse-v2?tab=' + _tab; } catch (_) {}
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
    window.AsgardWarehouseCart = {
      open: () => openCartDrawer(),
      openExcel: async () => {
        await openCartDrawer();
        await new Promise(r => setTimeout(r, 300));
        const b = document.getElementById('wh2-cart-excel');
        if (b) b.click();
      }
    };
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

  return { render, openProduct, openSubmitPreview, showSubmitPreview: openSubmitPreview, humanCatalogName };
})();
