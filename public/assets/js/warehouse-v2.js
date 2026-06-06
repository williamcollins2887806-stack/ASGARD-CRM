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

  let _user = null, _root = null, _tab = 'catalog';
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
    .wh2-card{background:var(--bg-card,#161a22);border:1px solid var(--border,#262c38);border-radius:15px;padding:16px;cursor:pointer;transition:.18s;display:flex;flex-direction:column;gap:8px;animation:wh2in .3s ease both}
    @keyframes wh2in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
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

  // ════════════════════ ВКЛАДКА: КАТАЛОГ ════════════════════
  async function renderCatalog(container, search) {
    container.innerHTML = `<div class="wh2-loading">Загрузка каталога…</div>`;
    let prods = [];
    try { const d = await api('/api/products?limit=200' + (search ? '&search=' + encodeURIComponent(search) : '')); prods = d.items || []; }
    catch (e) { container.innerHTML = `<div class="wh2-empty"><div class="wh2-empty__i">⚠️</div>${esc(e.message)}</div>`; return; }
    if (!prods.length) { container.innerHTML = `<div class="wh2-empty"><div class="wh2-empty__i">📭</div>В каталоге пусто. Добавьте первую позицию.</div>`; return; }
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
              : `<div style="width:42px;height:42px;border-radius:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:22px;background:${AV_COLORS[idx % AV_COLORS.length]}22">${CAT_ICON(p.category_name)}</div>`}
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
        <div class="wh2-avail" data-avail="${p.id}"><span class="wh2-card__sub">наличие…</span></div>
      </div>`).join('')}</div>`;
    container.querySelectorAll('.wh2-card[data-pid]').forEach(c => c.onclick = () => openProduct(+c.dataset.pid));
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
    container.innerHTML = `<div class="wh2-loading">Загрузка остатков…</div>`;
    let rows = [];
    try { const d = await api('/api/stock?limit=500' + (search ? '&search=' + encodeURIComponent(search) : '')); rows = d.items || []; }
    catch (e) { container.innerHTML = `<div class="wh2-empty"><div class="wh2-empty__i">⚠️</div>${esc(e.message)}</div>`; return; }
    if (!rows.length) { container.innerHTML = `<div class="wh2-empty"><div class="wh2-empty__i">📦</div>Нет остатков. Оприходуйте расходники.</div>`; return; }
    container.innerHTML = `<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        <button class="wh2-btn" data-op="receipt">📥 Приход</button>
        <button class="wh2-btn" data-op="issue">📤 Расход</button>
        <button class="wh2-btn" data-op="transfer">🔄 Перемещение</button>
        <button class="wh2-btn" data-op="writeoff">🗑️ Списание</button>
      </div>
      <table class="wh2-table"><thead><tr>
      <th>Позиция</th><th>Склад</th><th>Ячейка</th><th>Остаток</th><th>Мин.</th><th></th></tr></thead><tbody>
      ${rows.map(r => {
        const low = r.min_stock_level > 0 && Number(r.quantity) <= Number(r.min_stock_level);
        return `<tr>
          <td><b>${esc(r.product_name)}</b>${r.article ? ' <span style="opacity:.5">' + esc(r.article) + '</span>' : ''}</td>
          <td>${esc(r.warehouse_name || '—')}</td><td>${esc(r.location_label || '—')}</td>
          <td><b style="color:${low ? 'var(--err-t,#ff5c5c)' : 'var(--ok-t,#30d158)'}">${fmt(r.quantity)}</b> ${esc(r.unit)}</td>
          <td>${r.min_stock_level > 0 ? fmt(r.min_stock_level) : '—'}</td>
          <td>${low ? '<span class="wh2-chip wh2-chip--warn">низкий</span>' : ''}</td>
        </tr>`;
      }).join('')}</tbody></table>`;
    container.querySelectorAll('[data-op]').forEach(b => b.onclick = () => openStockOp(b.dataset.op));
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
    // toolbar зависит от вкладки
    if (_tab === 'catalog') toolbar.querySelector('#wh2-add').style.display = '';
    else if (_tab === 'locations') toolbar.querySelector('#wh2-add').style.display = '';
    else toolbar.querySelector('#wh2-add').style.display = 'none';
    renderKPIs(_root.querySelector('#wh2-kpis'));
    if (_tab === 'catalog') return renderCatalog(body, _searchVal);
    if (_tab === 'stock') return renderStock(body, _searchVal);
    if (_tab === 'equipment') {
      // Полноценный блок оборудования вынесен в warehouse-v2-equipment.js (window.WH2Equipment).
      if (window.WH2Equipment) return window.WH2Equipment.render(body, { user: _user, api, esc, toast, fmt, UI, search: _searchVal });
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

  async function render({ layout, title }) {
    injectCSS();
    try { const ud = await api('/api/users/me'); _user = ud.user || ud; } catch (_) { _user = {}; }
    await loadRefs();
    if (layout) await layout('', { title: title || 'Склад 2.0' });
    const host = document.getElementById('layout') || document.getElementById('main-content') || document.body;
    host.innerHTML = '';
    _root = document.createElement('div'); _root.className = 'wh2';
    _root.innerHTML = `
      <div class="wh2-kpis" id="wh2-kpis"></div>
      <div class="wh2-tabs" id="wh2-tabs">
        <button class="wh2-tab wh2-tab--active" data-tab="catalog">📚 Каталог</button>
        <button class="wh2-tab" data-tab="stock">📦 Наличие</button>
        <button class="wh2-tab" data-tab="equipment">🛠️ Оборудование</button>
        <button class="wh2-tab" data-tab="incoming">🚚 Приёмка</button>
        <button class="wh2-tab" data-tab="locations">🗺️ Ячейки</button>
        <button class="wh2-tab" data-tab="movements">📜 Движения</button>
      </div>
      <div class="wh2-toolbar" id="wh2-toolbar">
        <div class="wh2-search"><input id="wh2-q" placeholder="Поиск по наименованию или артикулу…"></div>
        <button class="wh2-btn wh2-btn--primary" id="wh2-add">➕ Позиция</button>
      </div>
      <div id="wh2-body"></div>`;
    host.appendChild(_root);

    _root.querySelectorAll('.wh2-tab').forEach(t => t.onclick = () => {
      _root.querySelectorAll('.wh2-tab').forEach(x => x.classList.remove('wh2-tab--active'));
      t.classList.add('wh2-tab--active'); _tab = t.dataset.tab; _searchVal = '';
      _root.querySelector('#wh2-q').value = ''; refresh();
    });
    let deb;
    _root.querySelector('#wh2-q').oninput = e => { clearTimeout(deb); _searchVal = e.target.value.trim(); deb = setTimeout(refresh, 280); };
    _root.querySelector('#wh2-add').onclick = () => { if (_tab === 'locations') openBulkModal(); else openQuickProduct(); };

    refresh();
  }

  return { render };
})();
