/**
 * АСГАРД CRM — Склад 2.0 · вкладка «Оборудование» (поштучный учёт ТМЦ).
 * Полная замена старого equipment.js в едином современном стиле wh2-*.
 * Экспорт: window.WH2Equipment.render(container, ctx) + .openWorkEquipmentModal(work,user).
 * Переиспользует существующие /api/equipment/* (бэкенд не дублируется).
 */
window.WH2Equipment = (function () {
  // Контекст из warehouse-v2.js: { user, api, esc, toast, fmt, UI }
  let api, esc, toast, fmt, UI, _user;

  const S = {
    all: [], filtered: [], kits: [], stats: {},
    view: localStorage.getItem('wh2_eq_view') || 'cards',
    groupBy: localStorage.getItem('wh2_eq_group') || 'category',
    search: '', filters: {}, collapsed: new Set(),
    offset: 0, total: 0, PAGE: 60,
    refs: { categories: [], objects: [], pm: [], works: [], warehouses: [] }, refsLoaded: false,
    pendingPhoto: null, pendingIcon: null, _container: null,
  };

  const STATUS = {
    on_warehouse: { l: 'На складе', c: '#30d158', i: '📦' }, issued: { l: 'Выдано', c: '#4A90D9', i: '👤' },
    in_transit: { l: 'В пути', c: '#ffb020', i: '🚚' }, repair: { l: 'Ремонт', c: '#ff8c42', i: '🔧' },
    broken: { l: 'Сломано', c: '#ff5c5c', i: '❌' }, written_off: { l: 'Списано', c: '#8b93a3', i: '🗑️' },
  };
  const COND = { new: { l: 'Новое', c: '#30d158' }, good: { l: 'Хорошее', c: '#4A90D9' }, satisfactory: { l: 'Удовл.', c: '#ffb020' }, poor: { l: 'Плохое', c: '#ff8c42' }, broken: { l: 'Сломано', c: '#ff5c5c' } };
  const GROUP_OPTS = [{ v: 'category', l: 'По категории' }, { v: 'status', l: 'По статусу' }, { v: 'object', l: 'По объекту' }, { v: 'holder', l: 'По ответственному' }, { v: 'none', l: 'Без группировки' }];
  const ADMIN_ROLES = ['ADMIN', 'WAREHOUSE', 'CHIEF_ENGINEER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
  const PM_ROLES = ['PM', 'HEAD_PM', 'DIRECTOR_DEV', 'DIRECTOR_GEN', 'CHIEF_ENGINEER'];
  const ICONS = ['🛠️','🔧','🔩','⚙️','🔌','⚡','💧','🧪','🌡️','📏','📐','🔬','🧰','🪛','🔨','⛏️','🪜','🧯','🦺','⛑️','🥽','🧤','🥾','📡','🔋','💡','🔦','🪝','⚗️','🧲','🪚','🪓'];

  const isAdmin = () => ADMIN_ROLES.includes(_user && _user.role);
  const isPM = () => PM_ROLES.includes(_user && _user.role) || isAdmin();
  const dt = d => d ? new Date(d).toLocaleDateString('ru-RU') : '—';
  const money = n => (n == null || n === '') ? '—' : Number(n).toLocaleString('ru-RU') + ' ₽';
  const eqIcon = e => e.custom_icon || e.category_icon || '🛠️';
  const optHtml = (list, vKey, lKey, sel) => (list || []).map(o => `<option value="${esc(String(o[vKey]))}"${String(o[vKey]) === String(sel) ? ' selected' : ''}>${esc(o[lKey] || '')}</option>`).join('');
  function hl(text) { if (!S.search || !text) return esc(text || ''); const q = S.search.trim(); if (q.length < 2) return esc(text); try { const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'); return esc(text).replace(re, '<mark class="wh2-eq-hl">$1</mark>'); } catch (_) { return esc(text); } }
  const modal = (title, html) => UI.showModal && UI.showModal({ title, html });
  const close = () => UI.closeModal && UI.closeModal();
  const token = () => localStorage.getItem('asgard_token') || localStorage.getItem('auth_token');
  async function refreshAll() { try { await loadData(false); loadStats(); loadRequests(); } catch (_) {} }
  const inp = (id, ph, val, type) => `<input id="${id}" class="wh2-btn" style="text-align:left;width:100%" placeholder="${esc(ph)}"${type ? ` type="${type}"` : ''}${val != null ? ` value="${esc(String(val))}"` : ''}>`;
  const val = id => { const e = document.getElementById(id); return e ? e.value.trim() : ''; };

  function injectCSS() {
    if (document.getElementById('wh2-eq-css')) return;
    const s = document.createElement('style'); s.id = 'wh2-eq-css';
    s.textContent = `
    .wh2-eq-head{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;align-items:center}
    .wh2-eq-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px}
    .wh2-eq-card{background:var(--bg-card,#161a22);border:1px solid var(--border,#262c38);border-radius:15px;padding:14px;cursor:pointer;transition:.18s;animation:wh2in .3s both;display:flex;flex-direction:column;gap:10px}
    .wh2-eq-card:hover{transform:translateY(-3px);border-color:var(--gold,#D4A843);box-shadow:0 8px 24px rgba(0,0,0,.25)}
    .wh2-eq-card__row{display:flex;gap:12px}
    .wh2-eq-card__ph{width:56px;height:56px;border-radius:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:28px;background:rgba(212,168,67,.1);object-fit:cover}
    .wh2-eq-card__name{font-weight:700;font-size:14px;line-height:1.3;color:var(--t1,#e6e9ef)}
    .wh2-eq-card__inv{font-size:11px;color:var(--t2,#8b93a3);margin-top:2px}
    .wh2-eq-card__meta{font-size:12px;color:var(--t2,#8b93a3);display:flex;flex-direction:column;gap:2px}
    .wh2-eq-card__foot{display:flex;gap:6px;flex-wrap:wrap;border-top:1px solid var(--border,#1e2430);padding-top:10px;margin-top:auto}
    .wh2-eq-act{font-size:12px;font-weight:600;padding:6px 11px;border-radius:9px;border:1px solid var(--border,#262c38);background:var(--bg-input,#10141b);color:var(--t1,#e6e9ef);cursor:pointer;transition:.15s}
    .wh2-eq-act:hover{border-color:var(--gold,#D4A843)}
    .wh2-eq-act--issue{background:rgba(74,144,217,.15);color:#5aa0e0;border-color:transparent}
    .wh2-eq-act--return{background:rgba(48,209,88,.15);color:#30d158;border-color:transparent}
    .wh2-eq-group{margin-bottom:10px}
    .wh2-eq-group__h{display:flex;align-items:center;gap:8px;cursor:pointer;padding:9px 12px;background:var(--bg-card,#161a22);border-radius:10px;border:1px solid var(--border,#262c38);user-select:none}
    .wh2-eq-group__h:hover{border-color:var(--gold,#D4A843)}
    .wh2-eq-group__cnt{margin-left:auto;font-size:12px;color:var(--t2,#8b93a3);background:var(--bg-input,#10141b);padding:2px 9px;border-radius:12px}
    .wh2-eq-group__body{padding:12px 0}
    .wh2-eq-filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
    .wh2-eq-grp-btns{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px}
    .wh2-eq-grp-btn{font-size:12px;padding:6px 12px;border-radius:8px;border:1px solid var(--border,#262c38);background:var(--bg-card,#161a22);color:var(--t2,#8b93a3);cursor:pointer;transition:.15s}
    .wh2-eq-grp-btn--on{background:rgba(212,168,67,.16);color:var(--gold,#D4A843);border-color:var(--gold,#D4A843)}
    .wh2-eq-req{background:var(--bg-card,#161a22);border-left:4px solid #ffb020;border-radius:10px;padding:14px;margin-bottom:16px}
    .wh2-eq-req__item{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border,#1e2430)}
    .wh2-eq-req__item:last-child{border-bottom:none}
    .wh2-eq-kits{margin-top:24px}
    .wh2-eq-kits__grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;margin-top:12px}
    .wh2-eq-kit{background:var(--bg-card,#161a22);border:1px solid var(--border,#262c38);border-radius:13px;padding:15px;cursor:pointer;transition:.15s}
    .wh2-eq-kit:hover{border-color:var(--gold,#D4A843);transform:translateY(-2px)}
    .wh2-eq-kit__bar{height:6px;background:var(--bg-input,#10141b);border-radius:3px;overflow:hidden;margin-top:8px}
    .wh2-eq-kit__fill{height:100%;background:var(--gold,#D4A843);border-radius:3px;transition:width .3s}
    .wh2-eq-hl{background:rgba(212,168,67,.35);color:inherit;border-radius:3px;padding:0 2px}
    .wh2-eq-dtabs{display:flex;gap:4px;border-bottom:1px solid var(--border,#262c38);margin-bottom:14px;flex-wrap:wrap}
    .wh2-eq-dtab{padding:8px 14px;cursor:pointer;border:0;background:none;color:var(--t2,#8b93a3);font-size:13px;font-weight:600;border-bottom:2px solid transparent}
    .wh2-eq-dtab--on{color:var(--gold,#D4A843);border-bottom-color:var(--gold,#D4A843)}
    .wh2-eq-panels{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
    .wh2-eq-panel{background:var(--bg-input,#10141b);border-radius:11px;padding:13px}
    .wh2-eq-panel h4{margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:var(--t2,#8b93a3)}
    .wh2-eq-panel dt{font-size:11px;color:var(--t2,#8b93a3);margin-top:6px}
    .wh2-eq-panel dd{margin:0;font-size:13px;color:var(--t1,#e6e9ef)}
    .wh2-eq-form{display:flex;flex-direction:column;gap:10px;min-width:340px}
    .wh2-eq-form .row{display:flex;gap:10px}
    .wh2-eq-photozone{border:2px dashed var(--border,#262c38);border-radius:12px;padding:24px;text-align:center;cursor:pointer;transition:.15s}
    .wh2-eq-photozone:hover{border-color:var(--gold,#D4A843)}
    .wh2-eq-icons{display:grid;grid-template-columns:repeat(8,1fr);gap:6px;max-height:240px;overflow:auto}
    .wh2-eq-icon{font-size:22px;padding:8px;border-radius:9px;cursor:pointer;text-align:center;background:var(--bg-input,#10141b)}
    .wh2-eq-icon:hover{background:rgba(212,168,67,.2)}
    .wh2-eq-loadmore{display:block;margin:18px auto;padding:10px 24px;border-radius:11px;border:1px solid var(--border,#262c38);background:var(--bg-card,#161a22);color:var(--t1,#e6e9ef);cursor:pointer}
    @media(max-width:480px){.wh2-eq-grid{grid-template-columns:1fr}.wh2-eq-icons{grid-template-columns:repeat(6,1fr)}.wh2-eq-form{min-width:auto}}
    `;
    document.head.appendChild(s);
  }

  // ─────────────────────────── ЗАГРУЗКА ───────────────────────────
  async function loadRefs() {
    if (S.refsLoaded) return;
    const get = (u, k) => api(u).then(d => d[k] || d.items || []).catch(() => []);
    const [cats, objs, whs, works, usersRaw] = await Promise.all([
      get('/api/equipment/categories', 'categories'),
      get('/api/equipment/objects', 'objects'),
      get('/api/equipment/warehouses', 'warehouses'),
      api('/api/works?limit=200').then(d => d.works || d.items || []).catch(() => []),
      api('/api/users?is_active=true').then(d => d.users || []).catch(() => []),
    ]);
    S.refs.categories = cats; S.refs.objects = objs; S.refs.warehouses = whs; S.refs.works = works;
    S.refs.pm = usersRaw.filter(u => ['PM', 'HEAD_PM', 'DIRECTOR_DEV', 'DIRECTOR_GEN', 'CHIEF_ENGINEER', 'HR', 'WAREHOUSE', 'TO', 'HEAD_TO'].includes(u.role));
    S.refsLoaded = true;
  }

  async function loadData(append) {
    if (!append) S.offset = 0;
    const p = new URLSearchParams({ limit: S.PAGE, offset: S.offset });
    if (S.filters.status) p.set('status', S.filters.status);
    if (S.filters.category_id) p.set('category_id', S.filters.category_id);
    if (S.filters.warehouse_id) p.set('warehouse_id', S.filters.warehouse_id);
    const d = await api('/api/equipment?' + p.toString());
    const rows = d.equipment || d.items || (Array.isArray(d) ? d : []);
    S.total = d.total || d.count || rows.length;
    S.all = append ? S.all.concat(rows) : rows;
    applyFilters();
  }

  function applyFilters() {
    const q = (S.search || '').trim().toLowerCase();
    S.filtered = !q ? S.all : S.all.filter(e =>
      [e.name, e.inventory_number, e.serial_number, e.holder_name, e.brand, e.model].some(v => v && String(v).toLowerCase().includes(q)));
    renderContent();
  }

  // ─────────────────────────── ГЛАВНЫЙ РЕНДЕР ───────────────────────────
  async function render(container, ctx) {
    api = ctx.api; esc = ctx.esc; toast = ctx.toast; fmt = ctx.fmt; UI = ctx.UI; _user = ctx.user;
    S.search = ctx.search || ''; S._container = container;
    injectCSS();
    container.innerHTML = `
      <div class="wh2-eq-head">
        ${isAdmin() ? '<button class="wh2-btn wh2-btn--primary" data-eq="add">➕ Оборудование</button>' : ''}
        ${isPM() && !isAdmin() ? '<button class="wh2-btn wh2-btn--primary" data-eq="request">📋 Заявка на выдачу</button>' : ''}
        ${isAdmin() ? '<button class="wh2-btn" data-eq="batches">📋 Заявки</button>' : ''}
        <button class="wh2-btn" data-eq="mine">👤 Моё оборудование</button>
        <button class="wh2-btn" data-eq="qr">🔍 По QR</button>
        <button class="wh2-btn" data-eq="export">📥 Excel</button>
        <span style="flex:1"></span>
        <button class="wh2-btn" data-eq="view">${S.view === 'cards' ? '☰ Таблица' : '▦ Карточки'}</button>
      </div>
      <div class="wh2-kpis" id="wh2-eq-metrics"></div>
      <div class="wh2-eq-filters" id="wh2-eq-filters"></div>
      <div class="wh2-eq-grp-btns" id="wh2-eq-grp"></div>
      <div id="wh2-eq-requests"></div>
      <div id="wh2-eq-content"><div class="wh2-loading">Загрузка оборудования…</div></div>
      <div id="wh2-eq-kits"></div>`;

    container.querySelectorAll('[data-eq]').forEach(b => b.onclick = () => {
      const a = b.dataset.eq;
      if (a === 'add') openForm();
      else if (a === 'request') openRequestCart();
      else if (a === 'batches') openBatchesForWarehouse();
      else if (a === 'mine') openMine();
      else if (a === 'qr') openByQrPrompt();
      else if (a === 'export') doExport();
      else if (a === 'view') { S.view = S.view === 'cards' ? 'table' : 'cards'; localStorage.setItem('wh2_eq_view', S.view); b.textContent = S.view === 'cards' ? '☰ Таблица' : '▦ Карточки'; renderContent(); }
    });

    await loadRefs();
    renderFilters(); renderGroupButtons();
    loadStats(); loadRequests(); loadKits();
    try { await loadData(false); } catch (e) { container.querySelector('#wh2-eq-content').innerHTML = `<div class="wh2-empty"><div class="wh2-empty__i">⚠️</div>${esc(e.message)}</div>`; }
  }

  function renderFilters() {
    const el = S._container.querySelector('#wh2-eq-filters'); if (!el) return;
    el.innerHTML = `
      <select class="wh2-btn" id="wh2-eqf-cat"><option value="">Все категории</option>${optHtml(S.refs.categories, 'id', 'name', S.filters.category_id)}</select>
      <select class="wh2-btn" id="wh2-eqf-status"><option value="">Все статусы</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${S.filters.status === k ? ' selected' : ''}>${v.l}</option>`).join('')}</select>
      <select class="wh2-btn" id="wh2-eqf-wh"><option value="">Все склады</option>${optHtml(S.refs.warehouses, 'id', 'name', S.filters.warehouse_id)}</select>
      ${Object.keys(S.filters).length ? '<button class="wh2-btn" id="wh2-eqf-clear">✕ Сбросить</button>' : ''}`;
    el.querySelector('#wh2-eqf-cat').onchange = e => setFilter('category_id', e.target.value);
    el.querySelector('#wh2-eqf-status').onchange = e => setFilter('status', e.target.value);
    el.querySelector('#wh2-eqf-wh').onchange = e => setFilter('warehouse_id', e.target.value);
    const cl = el.querySelector('#wh2-eqf-clear'); if (cl) cl.onclick = () => { S.filters = {}; renderFilters(); loadData(false); };
  }
  function setFilter(k, v) { if (v) S.filters[k] = v; else delete S.filters[k]; renderFilters(); loadData(false); }

  function renderGroupButtons() {
    const el = S._container.querySelector('#wh2-eq-grp'); if (!el) return;
    el.innerHTML = GROUP_OPTS.map(g => `<button class="wh2-eq-grp-btn ${S.groupBy === g.v ? 'wh2-eq-grp-btn--on' : ''}" data-g="${g.v}">${g.l}</button>`).join('');
    el.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { S.groupBy = b.dataset.g; localStorage.setItem('wh2_eq_group', S.groupBy); renderGroupButtons(); renderContent(); });
  }

  function renderContent() {
    const el = S._container && S._container.querySelector('#wh2-eq-content'); if (!el) return;
    const items = S.filtered;
    if (!items.length) { el.innerHTML = `<div class="wh2-empty"><div class="wh2-empty__i">🛠️</div>Оборудование не найдено.</div>`; return; }
    let html = '';
    if (S.groupBy === 'none') html = renderItems(items);
    else {
      html = groupItems(items, S.groupBy).map(g => {
        const open = !S.collapsed.has(g.key);
        return `<div class="wh2-eq-group"><div class="wh2-eq-group__h" data-grp="${esc(g.key)}"><span>${open ? '▼' : '▶'}</span><b>${esc(g.label)}</b><span class="wh2-eq-group__cnt">${g.items.length}</span></div>${open ? `<div class="wh2-eq-group__body">${renderItems(g.items)}</div>` : ''}</div>`;
      }).join('');
    }
    if (S.all.length < S.total) html += `<button class="wh2-eq-loadmore" id="wh2-eq-more">Показать ещё (${S.all.length} из ${S.total})</button>`;
    el.innerHTML = html;
    el.querySelectorAll('[data-grp]').forEach(h => h.onclick = () => { const k = h.dataset.grp; if (S.collapsed.has(k)) S.collapsed.delete(k); else S.collapsed.add(k); renderContent(); });
    el.querySelectorAll('[data-eqid]').forEach(c => c.onclick = ev => { if (ev.target.closest('[data-act]')) return; openCard(+c.dataset.eqid); });
    el.querySelectorAll('[data-act]').forEach(b => b.onclick = ev => { ev.stopPropagation(); handleAction(b.dataset.act, +b.dataset.id); });
    const more = el.querySelector('#wh2-eq-more'); if (more) more.onclick = async () => { S.offset += S.PAGE; try { await loadData(true); } catch (e) { toast('Ошибка', e.message, 'err'); } };
  }

  function groupItems(items, by) {
    const map = new Map();
    for (const e of items) {
      let key, label;
      if (by === 'category') { key = e.category_id || 'none'; label = e.category_name || 'Без категории'; }
      else if (by === 'status') { key = e.status || 'none'; label = (STATUS[e.status] || {}).l || e.status || '—'; }
      else if (by === 'object') { key = e.current_object_id || 'none'; label = e.object_name || 'Без объекта'; }
      else { key = e.current_holder_id || 'none'; label = e.holder_name || 'На складе'; }
      if (!map.has(key)) map.set(key, { key: String(key), label, items: [] });
      map.get(key).items.push(e);
    }
    return [...map.values()].sort((a, b) => b.items.length - a.items.length);
  }

  const renderItems = items => S.view === 'table' ? renderTable(items) : `<div class="wh2-eq-grid">${items.map(renderCard).join('')}</div>`;

  function renderCard(e) {
    const st = STATUS[e.status] || { l: e.status || '—', c: '#8b93a3' };
    const cond = COND[e.condition];
    const photo = e.photo_url ? `<img class="wh2-eq-card__ph" src="${esc(e.photo_url)}">` : `<div class="wh2-eq-card__ph">${eqIcon(e)}</div>`;
    const acts = [];
    if (e.status === 'on_warehouse' && isAdmin()) acts.push(`<button class="wh2-eq-act wh2-eq-act--issue" data-act="issue" data-id="${e.id}">📤 Выдать</button>`);
    if (e.status === 'issued' && (isAdmin() || e.current_holder_id === _user.id)) acts.push(`<button class="wh2-eq-act wh2-eq-act--return" data-act="return" data-id="${e.id}">📥 Вернуть</button>`);
    if (e.status === 'issued' && isPM()) acts.push(`<button class="wh2-eq-act" data-act="transfer" data-id="${e.id}">🔄</button>`);
    if (isAdmin() && !['repair', 'written_off'].includes(e.status)) acts.push(`<button class="wh2-eq-act" data-act="repair" data-id="${e.id}">🔧</button>`);
    return `<div class="wh2-eq-card" data-eqid="${e.id}">
      <div class="wh2-eq-card__row">${photo}
        <div style="flex:1;min-width:0"><div class="wh2-eq-card__name">${hl(e.name)}</div>
          <div class="wh2-eq-card__inv">${e.inventory_number ? '№ ' + hl(e.inventory_number) : ''}${e.category_name ? ' · ' + esc(e.category_name) : ''}</div></div>
        <span class="wh2-chip" style="background:${st.c}22;color:${st.c};align-self:flex-start">${st.i || ''} ${st.l}</span></div>
      <div class="wh2-eq-card__meta">
        ${e.holder_name ? `<span>👤 ${esc(e.holder_name)}</span>` : ''}
        ${e.object_name ? `<span>📍 ${esc(e.object_name)}</span>` : (e.warehouse_name ? `<span>🏬 ${esc(e.warehouse_name)}</span>` : '')}
        ${e.location_label ? `<span>🗺️ ${esc(e.location_label)}</span>` : ''}
        ${cond ? `<span style="color:${cond.c}">● ${cond.l}</span>` : ''}</div>
      ${acts.length ? `<div class="wh2-eq-card__foot">${acts.join('')}</div>` : ''}</div>`;
  }

  function renderTable(items) {
    return `<table class="wh2-table"><thead><tr><th></th><th>Наименование</th><th>Инв.№</th><th>Категория</th><th>Статус</th><th>Ответственный</th><th>Объект</th></tr></thead><tbody>
      ${items.map(e => { const st = STATUS[e.status] || { l: e.status, c: '#8b93a3' }; return `<tr data-eqid="${e.id}" style="cursor:pointer">
        <td style="font-size:18px">${e.photo_url ? `<img src="${esc(e.photo_url)}" style="width:28px;height:28px;border-radius:6px;object-fit:cover">` : eqIcon(e)}</td>
        <td><b>${hl(e.name)}</b></td><td>${hl(e.inventory_number || '—')}</td><td>${esc(e.category_name || '—')}</td>
        <td><span class="wh2-chip" style="background:${st.c}22;color:${st.c}">${st.l}</span></td>
        <td>${esc(e.holder_name || '—')}</td><td>${esc(e.object_name || e.warehouse_name || '—')}</td></tr>`; }).join('')}</tbody></table>`;
  }

  function handleAction(act, id) {
    const e = S.all.find(x => x.id === id); if (!e) return;
    if (act === 'issue') openIssueForm(e); else if (act === 'return') doReturn(e);
    else if (act === 'transfer') openTransferForm(e); else if (act === 'repair') sendToRepair(e);
  }

  // ─────────────────────────── KPI / ЗАПРОСЫ / КОМПЛЕКТЫ ───────────────────────────
  async function loadStats() {
    const el = S._container.querySelector('#wh2-eq-metrics'); if (!el) return;
    let s = {};
    try { s = await api('/api/equipment/stats/dashboard'); } catch (_) { try { s = await api('/api/equipment/stats/summary'); } catch (_) {} }
    S.stats = s;
    const kpi = (v, l, cls, ic, st) => `<div class="wh2-kpi ${cls || ''}" ${st ? `data-kpi="${st}" style="cursor:pointer"` : ''}><div class="wh2-kpi__i">${ic}</div><div class="wh2-kpi__v">${fmt(v || 0)}</div><div class="wh2-kpi__l">${l}</div></div>`;
    const repairCnt = s.in_repair != null ? s.in_repair : s.repair;
    const bookVal = s.book_value != null ? s.book_value : s.total_book_value;
    el.innerHTML =
      kpi(s.total_items != null ? s.total_items : s.total, 'Всего единиц', 'wh2-kpi--gold', '🛠️') +
      kpi(s.on_warehouse, 'На складе', 'wh2-kpi--ok', '📦', 'on_warehouse') +
      kpi(s.issued, 'Выдано', '', '👤', 'issued') +
      (repairCnt ? kpi(repairCnt, 'В ремонте', '', '🔧', 'repair') : '') +
      (bookVal != null ? `<div class="wh2-kpi"><div class="wh2-kpi__i">💰</div><div class="wh2-kpi__v" style="font-size:19px">${money(bookVal)}</div><div class="wh2-kpi__l">Балансовая стоимость</div></div>` : '');
    el.querySelectorAll('[data-kpi]').forEach(k => k.onclick = () => setFilter('status', k.dataset.kpi));
  }

  async function loadRequests() {
    if (!isAdmin()) return;
    const el = S._container.querySelector('#wh2-eq-requests'); if (!el) return;
    let reqs = [];
    try { const d = await api('/api/equipment/requests?status=pending'); reqs = d.requests || d.items || []; } catch (_) {}
    if (!reqs.length) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="wh2-eq-req"><div style="font-weight:700;margin-bottom:8px">📋 Запросы на оборудование (${reqs.length})</div>
      ${reqs.map(r => `<div class="wh2-eq-req__item"><div style="flex:1"><b>${esc(r.equipment_name || '—')}</b> ${r.inventory_number ? '<span style="opacity:.5">№' + esc(r.inventory_number) + '</span>' : ''}
        <div style="font-size:12px;color:var(--t2,#8b93a3)">${esc(r.requester_name || '')} → ${esc(r.target_holder_name || '')}</div></div>
        <button class="wh2-eq-act wh2-eq-act--return" data-req-ok="${r.id}">✅</button><button class="wh2-eq-act" data-req-no="${r.id}">❌</button></div>`).join('')}</div>`;
    el.querySelectorAll('[data-req-ok]').forEach(b => b.onclick = () => executeTransfer(+b.dataset.reqOk));
    el.querySelectorAll('[data-req-no]').forEach(b => b.onclick = () => rejectRequest(+b.dataset.reqNo));
  }

  async function loadKits() {
    const el = S._container.querySelector('#wh2-eq-kits'); if (!el) return;
    let kits = [];
    try { const d = await api('/api/equipment/kits'); kits = d.kits || d.items || []; } catch (_) {}
    if (!kits.length) { el.innerHTML = ''; return; }
    S.kits = kits;
    el.innerHTML = `<div class="wh2-eq-kits"><div class="wh2-eq-group__h" id="wh2-eq-kits-h"><span id="wh2-eq-kits-arr">▶</span><b>🧰 Комплекты</b><span class="wh2-eq-group__cnt">${kits.length}</span></div><div id="wh2-eq-kits-body" style="display:none"></div></div>`;
    const h = el.querySelector('#wh2-eq-kits-h'), body = el.querySelector('#wh2-eq-kits-body'), arr = el.querySelector('#wh2-eq-kits-arr');
    h.onclick = () => {
      const show = body.style.display === 'none';
      body.style.display = show ? 'block' : 'none'; arr.textContent = show ? '▼' : '▶';
      if (show && !body.dataset.filled) {
        body.dataset.filled = '1';
        body.innerHTML = `<div class="wh2-eq-kits__grid">${kits.map(k => { const pct = k.total_items ? Math.round((k.filled_items || 0) / k.total_items * 100) : 0;
          return `<div class="wh2-eq-kit" data-kit="${k.id}"><div style="font-size:26px">${esc(k.icon || '🧰')}</div><div style="font-weight:700;font-size:13px;margin-top:6px">${esc(k.name)}</div>
            <div style="font-size:11px;color:var(--t2,#8b93a3)">${esc(k.work_type || '')}</div><div class="wh2-eq-kit__bar"><div class="wh2-eq-kit__fill" style="width:${pct}%"></div></div>
            <div style="font-size:11px;color:var(--t2,#8b93a3);margin-top:4px">${k.filled_items || 0}/${k.total_items || 0} собрано</div></div>`; }).join('')}</div>`;
        body.querySelectorAll('[data-kit]').forEach(c => c.onclick = () => openKitDetail(+c.dataset.kit));
      }
    };
  }

  async function openKitDetail(id) {
    modal('Комплект', `<div class="wh2-loading">Загрузка…</div>`);
    let k; try { k = await api('/api/equipment/kits/' + id); k = k.kit || k.item || k; } catch (e) { toast('Ошибка', e.message, 'err'); return; }
    const items = k.items || [];
    const pct = items.length ? Math.round(items.filter(i => i.equipment_id).length / items.length * 100) : 0;
    modal(esc(k.name || 'Комплект'), `<div style="min-width:340px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px"><div style="font-size:36px">${esc(k.icon || '🧰')}</div>
        <div><div style="font-weight:700">${esc(k.name)}</div><div class="wh2-card__sub">${esc(k.work_type || '')} · ${items.length} позиций</div></div></div>
      <div class="wh2-eq-kit__bar" style="margin-bottom:14px"><div class="wh2-eq-kit__fill" style="width:${pct}%"></div></div>
      ${items.map(i => `<div class="wh2-mv"><div style="flex:1">${i.equipment_id ? '✅' : '⬜'} ${esc(i.item_name || i.name || '')} ${i.is_required ? '' : '<span class="wh2-card__sub">(опц.)</span>'}</div><span class="wh2-card__sub">${fmt(i.quantity || 1)} шт</span></div>`).join('')}
    </div>`);
  }

  // ─────────────────────────── КАРТОЧКА ЕДИНИЦЫ ───────────────────────────
  async function openCard(id) {
    modal('Оборудование', `<div class="wh2-loading">Загрузка…</div>`);
    let data; try { data = await api('/api/equipment/' + id); } catch (e) { toast('Ошибка', e.message, 'err'); return; }
    const e = data.equipment || data.item || data, moves = data.movements || [], maint = data.maintenance || [];
    const st = STATUS[e.status] || { l: e.status, c: '#8b93a3' };
    const photo = e.photo_url ? `<img src="${esc(e.photo_url)}" style="width:88px;height:88px;border-radius:14px;object-fit:cover">` : `<div style="width:88px;height:88px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:42px;background:rgba(212,168,67,.1)">${eqIcon(e)}</div>`;
    const foot = [];
    if (e.status === 'on_warehouse' && isAdmin()) foot.push(`<button class="wh2-btn wh2-btn--primary" id="wh2c-issue">📤 Выдать</button>`);
    if (e.status === 'issued' && (isAdmin() || e.current_holder_id === _user.id)) foot.push(`<button class="wh2-btn" id="wh2c-return">📥 Вернуть</button>`);
    if (isAdmin()) foot.push(`<button class="wh2-btn" id="wh2c-edit">✏️ Изменить</button><button class="wh2-btn" id="wh2c-photo">📷 Фото</button>`);
    modal('Оборудование #' + e.id, `<div style="min-width:380px">
      <div style="display:flex;gap:14px;margin-bottom:14px">${photo}<div style="flex:1"><div style="font-weight:700;font-size:17px">${esc(e.name)}</div>
        <div style="font-size:12px;color:var(--t2,#8b93a3);margin:4px 0">${e.inventory_number ? '№ ' + esc(e.inventory_number) : ''}${e.category_name ? ' · ' + esc(e.category_name) : ''}</div>
        <span class="wh2-chip" style="background:${st.c}22;color:${st.c}">${st.i || ''} ${st.l}</span></div></div>
      <div class="wh2-eq-dtabs" id="wh2c-tabs"><button class="wh2-eq-dtab wh2-eq-dtab--on" data-ct="info">Инфо</button>
        <button class="wh2-eq-dtab" data-ct="moves">Перемещения${moves.length ? ' (' + moves.length + ')' : ''}</button>
        <button class="wh2-eq-dtab" data-ct="maint">ТО${maint.length ? ' (' + maint.length + ')' : ''}</button>
        <button class="wh2-eq-dtab" data-ct="qr">QR</button></div>
      <div id="wh2c-body"></div>
      ${foot.length ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;border-top:1px solid var(--border,#262c38);padding-top:14px">${foot.join('')}</div>` : ''}</div>`);
    const body = document.getElementById('wh2c-body');
    const tabs = { info: () => infoTab(e), moves: () => movesTab(moves), maint: () => maintTab(maint), qr: () => qrTab(e) };
    const show = t => { body.innerHTML = tabs[t](); if (t === 'maint') { const ab = body.querySelector('#wh2c-add-maint'); if (ab) ab.onclick = () => openMaintenanceForm(e.id); } };
    show('info');
    document.querySelectorAll('#wh2c-tabs [data-ct]').forEach(b => b.onclick = () => { document.querySelectorAll('#wh2c-tabs [data-ct]').forEach(x => x.classList.remove('wh2-eq-dtab--on')); b.classList.add('wh2-eq-dtab--on'); show(b.dataset.ct); });
    const bind = (sel, fn) => { const x = document.getElementById(sel); if (x) x.onclick = fn; };
    bind('wh2c-issue', () => openIssueForm(e)); bind('wh2c-return', () => doReturn(e)); bind('wh2c-edit', () => openForm(e)); bind('wh2c-photo', () => openPhotoManager(e.id));
  }
  function infoTab(e) {
    const amort = (e.book_value != null || e.accumulated_depreciation != null) ? `<div class="wh2-eq-panel"><h4>Амортизация</h4><dt>Балансовая стоимость</dt><dd>${money(e.book_value)}</dd><dt>Накоплено</dt><dd>${money(e.accumulated_depreciation)}</dd></div>` : '';
    return `<div class="wh2-eq-panels">
      <div class="wh2-eq-panel"><h4>Основное</h4><dt>Серийный №</dt><dd>${esc(e.serial_number || '—')}</dd><dt>Штрихкод</dt><dd>${esc(e.barcode || '—')}</dd><dt>Бренд / модель</dt><dd>${esc(e.brand || '—')} ${esc(e.model || '')}</dd><dt>Кол-во</dt><dd>${fmt(e.quantity || 1)} ${esc(e.unit || 'шт')}</dd></div>
      <div class="wh2-eq-panel"><h4>Местоположение</h4><dt>Склад</dt><dd>${esc(e.warehouse_name || '—')}</dd><dt>Ячейка</dt><dd>${esc(e.location_label || '—')}</dd><dt>Ответственный</dt><dd>${esc(e.holder_name || '—')}</dd><dt>Объект</dt><dd>${esc(e.object_name || '—')}</dd></div>
      <div class="wh2-eq-panel"><h4>Финансы</h4><dt>Стоимость</dt><dd>${money(e.purchase_price)}</dd><dt>Куплено</dt><dd>${dt(e.purchase_date)}</dd></div>
      <div class="wh2-eq-panel"><h4>ТО и гарантия</h4><dt>Гарантия до</dt><dd>${dt(e.warranty_end)}</dd><dt>След. ТО</dt><dd>${dt(e.next_maintenance)}</dd><dt>Поверка</dt><dd>${dt(e.next_calibration)}</dd></div>
      ${amort}${e.notes ? `<div class="wh2-eq-panel" style="grid-column:1/-1"><h4>Примечания</h4><dd>${esc(e.notes)}</dd></div>` : ''}</div>`;
  }
  const movesTab = moves => !moves.length ? `<div class="wh2-empty"><div class="wh2-empty__i">📜</div>Перемещений нет.</div>`
    : `<div style="max-height:400px;overflow:auto">${moves.map(m => `<div class="wh2-mv"><div class="wh2-mv__ic" style="background:rgba(139,147,163,.15)">${(STATUS[m.movement_type] || {}).i || '•'}</div><div style="flex:1"><b>${esc(m.movement_type || '')}</b> <span class="wh2-card__sub">${esc(m.notes || '')}</span></div><span class="wh2-card__sub">${m.created_by_name ? esc(m.created_by_name) + ' · ' : ''}${dt(m.created_at)}</span></div>`).join('')}</div>`;
  const maintTab = maint => `${isAdmin() ? '<button class="wh2-btn" id="wh2c-add-maint" style="margin-bottom:12px">+ Запись ТО</button>' : ''}${!maint.length ? `<div class="wh2-empty"><div class="wh2-empty__i">🔧</div>Записей ТО нет.</div>` : maint.map(m => `<div class="wh2-mv"><div style="flex:1"><b>${esc(m.type || m.maintenance_type || 'ТО')}</b> <span class="wh2-card__sub">${esc(m.description || '')}</span></div><span class="wh2-card__sub">${dt(m.created_at || m.date)}</span></div>`).join('')}`;
  function qrTab(e) { const data = encodeURIComponent(e.qr_uuid || e.inventory_number || ('EQ-' + e.id)); const url = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${data}`; return `<div style="text-align:center;padding:14px"><img src="${url}" style="border-radius:12px;background:#fff;padding:8px"><div class="wh2-card__sub" style="margin-top:10px">${esc(e.qr_uuid || e.inventory_number || '')}</div><a href="${url}&download=1" target="_blank" class="wh2-btn" style="display:inline-block;margin-top:12px">📥 Скачать</a></div>`; }

  // ─────────────────────────── ФОРМА СОЗДАНИЯ/РЕДАКТИРОВАНИЯ ───────────────────────────
  function openForm(e) {
    const ed = !!e; S.pendingPhoto = null; S.pendingIcon = null;
    modal(ed ? 'Изменить оборудование' : 'Новое оборудование', `<div class="wh2-eq-form">
      ${inp('wh2f-name', 'Наименование *', e && e.name)}
      <div class="row"><select id="wh2f-cat" class="wh2-btn" style="text-align:left;flex:1"><option value="">Категория…</option>${optHtml(S.refs.categories, 'id', 'name', e && e.category_id)}</select>
        ${inp('wh2f-inv', 'Инв. №', e && e.inventory_number)}</div>
      <div class="row">${inp('wh2f-serial', 'Серийный №', e && e.serial_number)}${inp('wh2f-barcode', 'Штрихкод', e && e.barcode)}</div>
      <div class="row">${inp('wh2f-brand', 'Бренд', e && e.brand)}${inp('wh2f-model', 'Модель', e && e.model)}</div>
      <div class="row">${inp('wh2f-qty', 'Кол-во', (e && e.quantity) || 1, 'number')}${inp('wh2f-unit', 'Ед.', (e && e.unit) || 'шт')}</div>
      <div class="row">${inp('wh2f-price', 'Стоимость ₽', e && e.purchase_price, 'number')}${inp('wh2f-pdate', 'Дата покупки', e && (e.purchase_date || '').slice(0, 10), 'date')}</div>
      ${ed ? `<select id="wh2f-cond" class="wh2-btn" style="text-align:left"><option value="">Состояние…</option>${Object.entries(COND).map(([k, v]) => `<option value="${k}"${e.condition === k ? ' selected' : ''}>${v.l}</option>`).join('')}</select>` : ''}
      <textarea id="wh2f-notes" class="wh2-btn" style="text-align:left;min-height:60px" placeholder="Примечания">${e && e.notes ? esc(e.notes) : ''}</textarea>
      <button class="wh2-btn wh2-btn--primary" id="wh2f-save">${ed ? 'Сохранить' : 'Создать'}</button></div>`);
    document.getElementById('wh2f-save').onclick = async () => {
      const name = val('wh2f-name'); if (!name) { toast('Внимание', 'Введите наименование', 'warn'); return; }
      const payload = { name, category_id: val('wh2f-cat') || null, inventory_number: val('wh2f-inv') || null, serial_number: val('wh2f-serial') || null,
        barcode: val('wh2f-barcode') || null, brand: val('wh2f-brand') || null, model: val('wh2f-model') || null,
        quantity: parseFloat(val('wh2f-qty')) || 1, unit: val('wh2f-unit') || 'шт', purchase_price: parseFloat(val('wh2f-price')) || null,
        purchase_date: val('wh2f-pdate') || null, notes: val('wh2f-notes') || null };
      if (ed) payload.condition = val('wh2f-cond') || null;
      try {
        const res = ed ? await api('/api/equipment/' + e.id, { method: 'PUT', body: JSON.stringify(payload) })
          : await api('/api/equipment', { method: 'POST', body: JSON.stringify(payload) });
        toast('Готово', ed ? 'Сохранено' : 'Создано', 'ok'); close(); refreshAll();
      } catch (err) { toast('Ошибка', err.message, 'err'); }
    };
  }

  // ─────────────────────────── ОПЕРАЦИИ ───────────────────────────
  function openIssueForm(e) {
    modal('Выдать: ' + esc(e.name), `<div class="wh2-eq-form">
      <select id="wh2i-holder" class="wh2-btn" style="text-align:left"><option value="">Кому выдать…</option>${optHtml(S.refs.pm, 'id', 'name')}</select>
      <select id="wh2i-work" class="wh2-btn" style="text-align:left"><option value="">Работа (необязательно)…</option>${optHtml(S.refs.works, 'id', 'work_title')}</select>
      <select id="wh2i-obj" class="wh2-btn" style="text-align:left"><option value="">Объект (необязательно)…</option>${optHtml(S.refs.objects, 'id', 'name')}</select>
      <textarea id="wh2i-notes" class="wh2-btn" style="text-align:left;min-height:50px" placeholder="Примечание"></textarea>
      <button class="wh2-btn wh2-btn--primary" id="wh2i-save">📤 Выдать</button></div>`);
    document.getElementById('wh2i-save').onclick = async () => {
      const holder_id = val('wh2i-holder'); if (!holder_id) { toast('Внимание', 'Выберите получателя', 'warn'); return; }
      try { await api('/api/equipment/issue', { method: 'POST', body: JSON.stringify({ equipment_id: e.id, holder_id: +holder_id, work_id: val('wh2i-work') || null, object_id: val('wh2i-obj') || null, notes: val('wh2i-notes') || null }) });
        toast('Выдано', '', 'ok'); close(); refreshAll(); } catch (err) { toast('Ошибка', err.message, 'err'); }
    };
  }
  function doReturn(e) {
    askConfirm('Вернуть на склад?', `«${esc(e.name)}» вернётся на склад.`, async () => {
      try { await api('/api/equipment/return', { method: 'POST', body: JSON.stringify({ equipment_id: e.id }) }); toast('Возвращено', '', 'ok'); close(); refreshAll(); }
      catch (err) { toast('Ошибка', err.message, 'err'); }
    });
  }
  function openTransferForm(e) {
    modal('Передать: ' + esc(e.name), `<div class="wh2-eq-form">
      <select id="wh2t-holder" class="wh2-btn" style="text-align:left"><option value="">Кому передать…</option>${optHtml(S.refs.pm, 'id', 'name')}</select>
      <select id="wh2t-work" class="wh2-btn" style="text-align:left"><option value="">Работа…</option>${optHtml(S.refs.works, 'id', 'work_title')}</select>
      <textarea id="wh2t-notes" class="wh2-btn" style="text-align:left;min-height:50px" placeholder="Примечание"></textarea>
      <button class="wh2-btn wh2-btn--primary" id="wh2t-save">🔄 Создать передачу</button></div>`);
    document.getElementById('wh2t-save').onclick = async () => {
      const target_holder_id = val('wh2t-holder'); if (!target_holder_id) { toast('Внимание', 'Выберите получателя', 'warn'); return; }
      try { await api('/api/equipment/transfer-request', { method: 'POST', body: JSON.stringify({ equipment_id: e.id, to_user_id: +target_holder_id, work_id: val('wh2t-work') || null, notes: val('wh2t-notes') || null }) });
        toast('Запрос создан', 'Ожидает подтверждения склада', 'ok'); close(); refreshAll(); } catch (err) { toast('Ошибка', err.message, 'err'); }
    };
  }
  async function executeTransfer(requestId) {
    try { await api('/api/equipment/transfer-execute', { method: 'POST', body: JSON.stringify({ request_id: requestId }) }); toast('Выполнено', '', 'ok'); refreshAll(); }
    catch (e) { toast('Ошибка', e.message, 'err'); }
  }
  function rejectRequest(requestId) {
    askInput('Отклонить запрос', 'Причина отклонения', async (reason) => {
      try { await api('/api/equipment/requests/' + requestId + '/reject', { method: 'POST', body: JSON.stringify({ reason }) }); toast('Отклонено', '', 'ok'); refreshAll(); }
      catch (e) { toast('Ошибка', e.message, 'err'); }
    });
  }
  function sendToRepair(e) {
    askInput('В ремонт: ' + e.name, 'Причина / описание неисправности', async (description) => {
      try { await api('/api/equipment/repair', { method: 'POST', body: JSON.stringify({ equipment_id: e.id, description }) }); toast('В ремонте', '', 'ok'); close(); refreshAll(); }
      catch (err) { toast('Ошибка', err.message, 'err'); }
    });
  }
  function openMaintenanceForm(eqId) {
    modal('Запись ТО', `<div class="wh2-eq-form">
      <select id="wh2m-type" class="wh2-btn" style="text-align:left"><option value="maintenance">Плановое ТО</option><option value="repair">Ремонт</option><option value="calibration">Поверка</option><option value="inspection">Осмотр</option></select>
      <textarea id="wh2m-desc" class="wh2-btn" style="text-align:left;min-height:60px" placeholder="Описание работ"></textarea>
      <div class="row">${inp('wh2m-cost', 'Стоимость ₽', '', 'number')}${inp('wh2m-next', 'След. ТО', '', 'date')}</div>
      ${inp('wh2m-parts', 'Запчасти (через запятую)', '')}
      <button class="wh2-btn wh2-btn--primary" id="wh2m-save">Сохранить</button></div>`);
    document.getElementById('wh2m-save').onclick = async () => {
      const partsRaw = val('wh2m-parts');
      const spare_parts = partsRaw ? partsRaw.split(',').map(s => s.trim()).filter(Boolean) : []; // jsonb-массив
      try { await api('/api/equipment/' + eqId + '/maintenance', { method: 'POST', body: JSON.stringify({ maintenance_type: val('wh2m-type'), description: val('wh2m-desc') || null, cost: parseFloat(val('wh2m-cost')) || null, spare_parts, next_date: val('wh2m-next') || null }) });
        toast('Записано', '', 'ok'); close(); refreshAll(); } catch (e) { toast('Ошибка', e.message, 'err'); }
    };
  }

  // ─────────────────────────── МОЁ / QR / ЗАПРОС / ЭКСПОРТ ───────────────────────────
  async function openMine() {
    modal('Моё оборудование', `<div class="wh2-loading">Загрузка…</div>`);
    let list = [];
    try { const d = await api('/api/equipment/by-holder/' + _user.id); list = d.equipment || d.items || []; } catch (e) { toast('Ошибка', e.message, 'err'); return; }
    modal('Моё оборудование', `<div style="min-width:340px">${!list.length ? `<div class="wh2-empty"><div class="wh2-empty__i">📦</div>За вами ничего не закреплено.</div>`
      : list.map(e => `<div class="wh2-mv"><div style="flex:1"><b>${esc(e.name)}</b> <span class="wh2-card__sub">${e.inventory_number ? '№' + esc(e.inventory_number) : ''}</span></div><button class="wh2-eq-act wh2-eq-act--return" data-mine-ret="${e.id}">📥 Вернуть</button></div>`).join('')}</div>`);
    document.querySelectorAll('[data-mine-ret]').forEach(b => b.onclick = async () => { try { await api('/api/equipment/return', { method: 'POST', body: JSON.stringify({ equipment_id: +b.dataset.mineRet }) }); toast('Возвращено', '', 'ok'); openMine(); refreshAll(); } catch (e) { toast('Ошибка', e.message, 'err'); } });
  }
  function openByQrPrompt() {
    modal('Поиск по QR / инв. номеру', `<div class="wh2-eq-form">${inp('wh2qr-code', 'Код с этикетки (QR / инв.№)')}<button class="wh2-btn wh2-btn--primary" id="wh2qr-go">Найти</button></div>`);
    document.getElementById('wh2qr-go').onclick = async () => {
      const code = val('wh2qr-code'); if (!code) return;
      try { const d = await api('/api/equipment/by-qr/' + encodeURIComponent(code)); const e = d.equipment || d.item; if (e) { close(); openCard(e.id); } else toast('Не найдено', '', 'warn'); }
      catch (e) { toast('Не найдено', 'Проверьте код', 'warn'); }
    };
  }
  // ── ЗАЯВКА НА ВЫДАЧУ: корзина РП (выбор доступного → работа/сроки → отправка) ──
  const cart = []; // [{id,name,inv}]
  async function openRequestCart() {
    modal('Заявка на выдачу', `<div class="wh2-loading">Загрузка доступного оборудования…</div>`);
    let avail = [];
    try { const d = await api('/api/equipment/available-for-request'); avail = d.equipment || []; } catch (e) { toast('Ошибка', e.message, 'err'); }
    drawCart(avail, '');
  }
  function drawCart(avail, filter) {
    const list = filter ? avail.filter(e => (e.name + ' ' + (e.inventory_number || '')).toLowerCase().includes(filter.toLowerCase())) : avail;
    const inCart = id => cart.some(c => c.id === id);
    modal('Заявка на выдачу', `<div style="min-width:380px;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;gap:8px;align-items:center">
        <input id="wh2cart-q" class="wh2-btn" style="text-align:left;flex:1" placeholder="Поиск доступного оборудования…" value="${esc(filter || '')}">
        <span class="wh2-chip" style="background:rgba(212,168,67,.16);color:var(--gold,#D4A843)">🛒 ${cart.length}</span>
      </div>
      <div style="max-height:280px;overflow:auto">
        ${!list.length ? '<div class="wh2-card__sub" style="padding:10px">Нет доступного оборудования</div>' : list.map(e => `
          <div class="wh2-mv"><div style="flex:1"><b>${esc(e.name)}</b> <span class="wh2-card__sub">${e.inventory_number ? '№' + esc(e.inventory_number) : ''}${e.category_name ? ' · ' + esc(e.category_name) : ''}</span></div>
            <button class="wh2-eq-act ${inCart(e.id) ? '' : 'wh2-eq-act--issue'}" data-cart="${e.id}">${inCart(e.id) ? '✓ В корзине' : '+ В корзину'}</button></div>`).join('')}
      </div>
      ${cart.length ? `<div style="border-top:1px solid var(--border,#262c38);padding-top:12px">
        <div style="font-weight:700;margin-bottom:8px">Корзина (${cart.length})</div>
        ${cart.map(c => `<div class="wh2-mv"><div style="flex:1">${esc(c.name)} <span class="wh2-card__sub">${c.inv ? '№' + esc(c.inv) : ''}</span></div><button class="wh2-eq-act" data-uncart="${c.id}">✕</button></div>`).join('')}
        <select id="wh2cart-work" class="wh2-btn" style="text-align:left;width:100%;margin-top:10px"><option value="">Под работу *…</option>${optHtml(S.refs.works, 'id', 'work_title')}</select>
        <div class="row" style="display:flex;gap:10px;margin-top:8px">
          <div style="flex:1"><label class="wh2-card__sub">Когда нужно</label>${inp('wh2cart-from', '', '', 'date')}</div>
          <div style="flex:1"><label class="wh2-card__sub">До (ориентир.)</label>${inp('wh2cart-to', '', '', 'date')}</div>
        </div>
        <textarea id="wh2cart-notes" class="wh2-btn" style="text-align:left;width:100%;min-height:46px;margin-top:8px" placeholder="Комментарий кладовщику"></textarea>
        <button class="wh2-btn wh2-btn--primary" id="wh2cart-send" style="width:100%;margin-top:10px">📤 Отправить заявку кладовщику</button>
      </div>` : '<div class="wh2-card__sub" style="text-align:center;padding:8px">Добавьте оборудование в корзину</div>'}
    </div>`);
    const qEl = document.getElementById('wh2cart-q');
    if (qEl) { qEl.oninput = () => drawCart(avail, qEl.value); qEl.focus(); const v = qEl.value; qEl.setSelectionRange(v.length, v.length); }
    document.querySelectorAll('[data-cart]').forEach(b => b.onclick = () => { const e = avail.find(x => x.id === +b.dataset.cart); if (e && !cart.some(c => c.id === e.id)) cart.push({ id: e.id, name: e.name, inv: e.inventory_number }); drawCart(avail, qEl ? qEl.value : ''); });
    document.querySelectorAll('[data-uncart]').forEach(b => b.onclick = () => { const i = cart.findIndex(c => c.id === +b.dataset.uncart); if (i >= 0) cart.splice(i, 1); drawCart(avail, qEl ? qEl.value : ''); });
    const send = document.getElementById('wh2cart-send');
    if (send) send.onclick = async () => {
      const work_id = val('wh2cart-work'); if (!work_id) { toast('Внимание', 'Выберите работу', 'warn'); return; }
      try {
        const r = await api('/api/equipment/requests/batch', { method: 'POST', body: JSON.stringify({
          equipment_ids: cart.map(c => c.id), work_id: +work_id, needed_from: val('wh2cart-from') || null, needed_to: val('wh2cart-to') || null, notes: val('wh2cart-notes') || null }) });
        toast('Отправлено', `Заявка на ${cart.length} ед. ожидает кладовщика`, 'ok'); cart.length = 0; close();
      } catch (e) {
        if (e.message && e.message.includes('занят')) toast('Занято', 'Часть оборудования уже забрали — обновите список', 'err');
        else toast('Ошибка', e.message, 'err');
        openRequestCart();
      }
    };
  }

  // ── ЭКРАН КЛАДОВЩИКА: заявки на выдачу (подтвердить/отклонить/убрать позицию) ──
  async function openBatchesForWarehouse() {
    modal('Заявки на выдачу', `<div class="wh2-loading">Загрузка заявок…</div>`);
    let batches = [];
    try { const d = await api('/api/equipment/requests/batches?status=pending'); batches = d.batches || []; } catch (e) { toast('Ошибка', e.message, 'err'); }
    if (!batches.length) { modal('Заявки на выдачу', `<div class="wh2-empty" style="min-width:340px"><div class="wh2-empty__i">📋</div>Нет заявок на рассмотрении.</div>`); return; }
    modal('Заявки на выдачу', `<div style="min-width:380px;display:flex;flex-direction:column;gap:14px">
      ${batches.map(b => `<div style="background:var(--bg-input,#10141b);border-radius:12px;padding:14px" data-batch="${b.batch_id}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div><b>${esc(b.requester_name || 'РП')}</b> <span class="wh2-card__sub">→ ${esc(b.work_title || '—')}</span>
            <div class="wh2-card__sub">${b.needed_from ? 'Нужно: ' + dt(b.needed_from) : ''}${b.needed_to ? ' — ' + dt(b.needed_to) : ''}</div></div>
          <span class="wh2-chip" style="background:rgba(255,176,32,.15);color:#ffb020">${b.items_count} ед.</span>
        </div>
        <div style="margin:10px 0">${(b.items || []).map(it => `<div class="wh2-mv" data-bitem="${it.id}"><div style="flex:1">${esc(it.name)} <span class="wh2-card__sub">${it.inv ? '№' + esc(it.inv) : ''}</span></div><button class="wh2-eq-act" data-rm-item="${it.id}" title="Убрать (не готово)">✕</button></div>`).join('')}</div>
        <div style="display:flex;gap:8px">
          <button class="wh2-btn wh2-btn--primary" data-approve="${b.batch_id}" style="flex:1">✅ Подтвердить</button>
          <button class="wh2-btn" data-reject="${b.batch_id}">❌ Отклонить</button>
        </div></div>`).join('')}
    </div>`);
    document.querySelectorAll('[data-rm-item]').forEach(b => b.onclick = async () => {
      try { await api('/api/equipment/requests/item/' + b.dataset.rmItem, { method: 'DELETE' }); toast('Убрано', '', 'ok'); openBatchesForWarehouse(); } catch (e) { toast('Ошибка', e.message, 'err'); }
    });
    document.querySelectorAll('[data-approve]').forEach(b => b.onclick = async () => {
      try { const r = await api('/api/equipment/requests/batch/' + b.dataset.approve + '/approve', { method: 'PUT' });
        toast('Подтверждено', `Забронировано: ${r.approved}${r.conflicts && r.conflicts.length ? ', конфликтов: ' + r.conflicts.length : ''}`, 'ok'); openBatchesForWarehouse(); refreshAll(); } catch (e) { toast('Ошибка', e.message, 'err'); }
    });
    document.querySelectorAll('[data-reject]').forEach(b => b.onclick = () => askInput('Отклонить заявку', 'Причина отклонения', async (reason) => {
      try { await api('/api/equipment/requests/batch/' + b.dataset.reject + '/reject', { method: 'PUT', body: JSON.stringify({ reason }) }); toast('Отклонено', '', 'ok'); openBatchesForWarehouse(); } catch (e) { toast('Ошибка', e.message, 'err'); }
    }));
  }
  async function doExport() {
    const p = new URLSearchParams(); Object.entries(S.filters).forEach(([k, v]) => v && p.set(k, v));
    p.set('token', token());
    window.open('/api/equipment/export/excel?' + p.toString(), '_blank');
  }

  // ─────────────────────────── ФОТО / ИКОНКА ───────────────────────────
  async function openPhotoManager(eqId) {
    modal('Фото / иконка', `<div class="wh2-eq-form">
      <label class="wh2-eq-photozone"><div style="font-size:32px">📷</div><div class="wh2-card__sub">Нажмите, чтобы выбрать фото</div><input type="file" id="wh2ph-file" accept="image/*" style="display:none"></label>
      <button class="wh2-btn" id="wh2ph-icon">😀 Выбрать иконку</button>
      <button class="wh2-btn" id="wh2ph-del" style="color:var(--err-t,#ff5c5c)">🗑️ Удалить фото</button></div>`);
    document.getElementById('wh2ph-file').onchange = async ev => {
      const f = ev.target.files[0]; if (!f) return;
      const fd = new FormData(); fd.append('photo', f);
      try { const r = await fetch('/api/equipment/' + eqId + '/photo', { method: 'POST', headers: { Authorization: 'Bearer ' + token() }, body: fd }); if (!r.ok) throw new Error('Ошибка загрузки'); toast('Фото', 'Загружено', 'ok'); close(); refreshAll(); } catch (e) { toast('Ошибка', e.message, 'err'); }
    };
    document.querySelector('.wh2-eq-photozone').onclick = () => document.getElementById('wh2ph-file').click();
    document.getElementById('wh2ph-icon').onclick = () => openIconPicker(async icon => {
      try { await api('/api/equipment/' + eqId + '/photo', { method: 'POST', body: JSON.stringify({ custom_icon: icon }) }); toast('Иконка', 'Установлена', 'ok'); close(); refreshAll(); } catch (e) { toast('Ошибка', e.message, 'err'); }
    });
    document.getElementById('wh2ph-del').onclick = async () => { try { await api('/api/equipment/' + eqId + '/photo', { method: 'DELETE' }); toast('Удалено', '', 'ok'); close(); refreshAll(); } catch (e) { toast('Ошибка', e.message, 'err'); } };
  }
  function openIconPicker(onSelect) {
    modal('Выберите иконку', `<div class="wh2-eq-icons">${ICONS.map(i => `<div class="wh2-eq-icon" data-ic="${i}">${i}</div>`).join('')}</div>`);
    document.querySelectorAll('[data-ic]').forEach(d => d.onclick = () => onSelect(d.dataset.ic));
  }

  // ─────────────────────────── ПРИВЯЗКА К РАБОТАМ (внешний вызов) ───────────────────────────
  // Гарантируем инициализацию зависимостей при внешнем вызове (из карточки работы),
  // когда вкладка «Оборудование» ещё не открывалась и render() не запускался.
  function ensureDeps() {
    if (!UI) UI = window.AsgardUI || {};
    if (!esc) esc = (UI.esc) || (s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])));
    if (!toast) toast = UI.toast || ((t, m, tp) => console.log(`[${tp}] ${t}: ${m}`));
    if (!fmt) fmt = n => (n == null ? '—' : Number(n).toLocaleString('ru-RU'));
    if (!api) api = async (url, opts = {}) => {
      const t = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token');
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, ...opts });
      const ct = r.headers.get('content-type') || ''; const d = ct.includes('json') ? await r.json() : await r.text();
      if (!r.ok) throw new Error((d && d.error) || ('HTTP ' + r.status)); return d;
    };
  }

  async function openWorkEquipmentModal(work, user) {
    ensureDeps();
    if (user) _user = user;
    const workId = work.id || work, workTitle = work.work_title || work.title || ('#' + workId);
    modal('Оборудование работы', `<div class="wh2-loading">Загрузка…</div>`);
    let assigned = [], available = [];
    try { const [a, b] = await Promise.all([api('/api/equipment/work/' + workId + '/equipment').catch(() => ({ assignments: [] })), api('/api/equipment/available').catch(() => ({ equipment: [] }))]);
      assigned = a.assignments || a.items || []; available = b.equipment || b.items || []; } catch (_) {}
    const render = () => {
      modal('🛠️ ' + esc(workTitle), `<div style="min-width:360px">
        <div style="font-weight:700;margin-bottom:8px">Назначено (${assigned.length})</div>
        ${!assigned.length ? '<div class="wh2-card__sub" style="margin-bottom:12px">Пока ничего</div>' : `<div style="margin-bottom:16px">${assigned.map(a => `<div class="wh2-mv"><div style="flex:1"><b>${esc(a.name || a.equipment_name || '')}</b> <span class="wh2-card__sub">${a.inventory_number ? '№' + esc(a.inventory_number) : ''}</span></div><button class="wh2-eq-act" data-unassign="${a.equipment_id || a.id}">✕</button></div>`).join('')}</div>`}
        <div style="font-weight:700;margin-bottom:8px">Доступно (${available.length})</div>
        <input id="wh2we-search" class="wh2-btn" style="text-align:left;width:100%;margin-bottom:8px" placeholder="Поиск…">
        <div id="wh2we-avail" style="max-height:280px;overflow:auto"></div></div>`);
      const renderAvail = (flt) => {
        const list = (flt ? available.filter(e => (e.name || '').toLowerCase().includes(flt.toLowerCase())) : available);
        document.getElementById('wh2we-avail').innerHTML = !list.length ? '<div class="wh2-card__sub">Нет доступного</div>'
          : list.map(e => `<div class="wh2-mv"><div style="flex:1"><b>${esc(e.name)}</b> <span class="wh2-card__sub">${e.inventory_number ? '№' + esc(e.inventory_number) : ''}</span></div><button class="wh2-eq-act wh2-eq-act--issue" data-assign="${e.id}">+ Назначить</button></div>`).join('');
        document.querySelectorAll('[data-assign]').forEach(b => b.onclick = async () => { try { await api('/api/equipment/work/' + workId + '/assign', { method: 'POST', body: JSON.stringify({ equipment_ids: [+b.dataset.assign] }) }); toast('Назначено', '', 'ok'); openWorkEquipmentModal(work, _user); } catch (e) { toast('Ошибка', e.message, 'err'); } });
      };
      renderAvail('');
      const se = document.getElementById('wh2we-search'); if (se) se.oninput = ev => renderAvail(ev.target.value);
      document.querySelectorAll('[data-unassign]').forEach(b => b.onclick = async () => { try { await api('/api/equipment/work/' + workId + '/unassign', { method: 'POST', body: JSON.stringify({ equipment_ids: [+b.dataset.unassign] }) }); toast('Снято', '', 'ok'); openWorkEquipmentModal(work, _user); } catch (e) { toast('Ошибка', e.message, 'err'); } });
    };
    render();
  }

  // ─────────────────────────── ПОДТВЕРЖДЕНИЯ (вместо confirm/prompt) ───────────────────────────
  function askConfirm(title, msg, onOk) {
    modal(title, `<div style="min-width:300px"><div style="margin-bottom:16px">${esc(msg)}</div><div style="display:flex;gap:8px;justify-content:flex-end"><button class="wh2-btn" id="wh2ac-no">Отмена</button><button class="wh2-btn wh2-btn--primary" id="wh2ac-yes">Да</button></div></div>`);
    document.getElementById('wh2ac-no').onclick = close;
    document.getElementById('wh2ac-yes').onclick = () => onOk();
  }
  function askInput(title, ph, onOk) {
    modal(title, `<div class="wh2-eq-form"><textarea id="wh2ai-val" class="wh2-btn" style="text-align:left;min-height:70px" placeholder="${esc(ph)}"></textarea><button class="wh2-btn wh2-btn--primary" id="wh2ai-ok">Подтвердить</button></div>`);
    document.getElementById('wh2ai-ok').onclick = () => { const v = val('wh2ai-val'); if (!v) { toast('Внимание', 'Заполните поле', 'warn'); return; } onOk(v); };
  }

  return { render, openCard, openWorkEquipmentModal };
})();
