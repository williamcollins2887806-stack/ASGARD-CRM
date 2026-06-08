window.AsgardProcurementPage = (function() {
  const UI = window.AsgardUI || {};
  const $ = UI.$ || (s => document.querySelector(s));
  const esc = UI.esc || (s => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])));
  const toast = UI.toast || ((t,m,type) => console.log(`[${type}] ${t}: ${m}`));
  const showModal = UI.showModal || (() => {});
  const closeModal = UI.closeModal || (() => {});

  let currentFilters = {};
  let _user = null;
  let _viewMode = localStorage.getItem('proc_view') || 'kanban'; // 'kanban' | 'table'
  let _groupMode = 'none'; // 'none' | 'category' | 'supplier' — группировка позиций в детали

  const STATUSES = {
    draft:{l:'Черновик',c:'proc-status--draft'},sent_to_proc:{l:'У закупщика',c:'proc-status--sent-to-proc'},
    proc_responded:{l:'Ответ закупщика',c:'proc-status--proc-responded'},pm_approved:{l:'РП согласовал',c:'proc-status--pm-approved'},
    dir_approved:{l:'Директор ✓',c:'proc-status--dir-approved'},dir_rework:{l:'На доработке',c:'proc-status--dir-rework'},
    dir_question:{l:'Вопрос',c:'proc-status--dir-question'},dir_rejected:{l:'Отклонена',c:'proc-status--dir-rejected'},
    paid:{l:'Оплачено',c:'proc-status--paid'},partially_delivered:{l:'Частичная',c:'proc-status--partially-delivered'},
    delivered:{l:'Доставлено',c:'proc-status--delivered'},closed:{l:'Закрыта',c:'proc-status--closed'}
  };

  const badge = s => { const st=STATUSES[s]||{l:s,c:''}; return `<span class="proc-status ${st.c}">${esc(st.l)}</span>`; };
  const money = v => v!=null ? Number(v).toLocaleString('ru-RU')+' ₽' : '—';
  const dt = d => d ? new Date(d).toLocaleDateString('ru-RU') : '—';
  const dtFull = d => d ? new Date(d).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
  function hdr() { const t=localStorage.getItem('asgard_token')||localStorage.getItem('auth_token'); return {'Authorization':'Bearer '+t,'Content-Type':'application/json'}; }
  async function apiFetch(url,opts={}) { const r=await fetch(url,{headers:hdr(),...opts}); if(!r.ok) throw new Error('HTTP '+r.status+': '+url); return r.json(); }
  async function apiPut(url,body) { return apiFetch(url,{method:'PUT',body:JSON.stringify(body||{})}); }
  async function apiPost(url,body) { return apiFetch(url,{method:'POST',body:JSON.stringify(body||{})}); }

  // -- Dashboard --
  async function renderDashboard(el) {
    if (!['PROC','ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'].includes(_user.role)) return;
    try {
      const d = await apiFetch('/api/procurement/dashboard');
      const pendCnt = d.pending_proc?.length||0, overCnt = d.overdue?.length||0, upCnt = d.upcoming?.length||0;
      const paidCnt = (d.counts||[]).find(c=>c.status==='paid')?.cnt||0;
      el.innerHTML = `<div class="proc-dashboard">
        <div class="proc-dash-card proc-dash-card--pending" data-f="sent_to_proc"><div class="proc-dash-card__count">${pendCnt}</div><div class="proc-dash-card__label">На обработке</div></div>
        <div class="proc-dash-card proc-dash-card--overdue" data-f="paid"><div class="proc-dash-card__count">${overCnt}</div><div class="proc-dash-card__label">Просрочено</div></div>
        <div class="proc-dash-card proc-dash-card--upcoming" data-f="paid"><div class="proc-dash-card__count">${upCnt}</div><div class="proc-dash-card__label">Дедлайн &lt;7д</div></div>
        <div class="proc-dash-card" data-f="paid"><div class="proc-dash-card__count">${paidCnt}</div><div class="proc-dash-card__label">Ждут доставку</div></div>
      </div>`;
      el.querySelectorAll('[data-f]').forEach(c=>c.addEventListener('click',()=>{ currentFilters.status=c.dataset.f; refresh(); }));
    } catch(e) { console.warn('[Procurement] dashboard error:', e.message || e); }
  }

  // -- Filters --
  function renderFilters(el) {
    // «+ Новая заявка» убрана намеренно: заявки создаются ТОЛЬКО из карточки работы или из
    // корзины на складе. Закупщик заявки не создаёт — он их отрабатывает. Это реестр/просмотр.
    el.innerHTML = `<div class="proc-toolbar">
      <div class="proc-viewtoggle">
        <button class="proc-vt ${_viewMode==='kanban'?'proc-vt--on':''}" data-vm="kanban">🗂️ Канбан</button>
        <button class="proc-vt ${_viewMode==='table'?'proc-vt--on':''}" data-vm="table">📋 Таблица</button>
      </div>
      <div id="pf-status_w" style="display:${_viewMode==='table'?'inline-block':'none'};min-width:150px"></div>
      <input type="text" id="pf-search" placeholder="Поиск..." style="min-width:200px">
      <span style="flex:1"></span>
      <button class="btn ghost" onclick="window.open('/api/procurement/export/excel')">📥 Excel</button>
      <button class="btn ghost" onclick="window.open('/api/procurement/template/excel')">📄 Шаблон</button>
    </div>`;
    el.querySelectorAll('[data-vm]').forEach(b => b.onclick = () => {
      _viewMode = b.dataset.vm; localStorage.setItem('proc_view', _viewMode);
      el.querySelectorAll('[data-vm]').forEach(x => x.classList.toggle('proc-vt--on', x.dataset.vm === _viewMode));
      el.querySelector('#pf-status_w').style.display = _viewMode === 'table' ? 'inline-block' : 'none';
      refresh();
    });
    el.querySelector('#pf-status_w')?.appendChild(CRSelect.create({ id: 'pf-status', options: [{ value: '', label: 'Все статусы' }, ...Object.entries(STATUSES).map(([k,v])=>({ value: k, label: v.l }))], value: currentFilters.status || '', onChange: v => { currentFilters.status = v; refresh(); } }));
    let tmr; el.querySelector('#pf-search').oninput = e => { clearTimeout(tmr); tmr = setTimeout(()=>{ currentFilters.search=e.target.value; refresh(); },300); };
  }

  // -- Table --
  function renderTable(items, el) {
    if (!items.length) { el.innerHTML='<div style="padding:40px;text-align:center;color:var(--t2)">Заявок нет</div>'; return; }
    el.innerHTML = `<div class="proc-table-wrap"><table class="proc-items-table">
      <thead><tr><th>№</th><th>Дата</th><th>Заявка</th><th>Работа</th><th>РП</th><th>Поз.</th><th>Сумма</th><th>Статус</th></tr></thead>
      <tbody>${items.map(r=>`<tr style="cursor:pointer" data-id="${r.id}">
        <td>${r.id}</td><td>${dt(r.created_at)}</td><td>${esc(r.title||'')}</td><td>${esc(r.work_title||'—')}</td>
        <td>${esc(r.pm_name||'—')}</td><td>${r.items_count||0}</td><td>${money(r.items_total)}</td><td>${badge(r.status)}</td>
      </tr>`).join('')}</tbody></table></div>`;
    el.querySelectorAll('tr[data-id]').forEach(tr=>tr.onclick=()=>openDetail(+tr.dataset.id));
  }

  // -- Detail modal --
  async function openDetail(id) {
    const d = await apiFetch(`/api/procurement/${id}`);
    if (!d.item) { toast('Ошибка','Не найдена','err'); return; }
    const p = d.item, items = d.items||[], payments = d.payments||[], history = d.history||[], invoiceImports = d.invoice_imports||[];
    const actions = getActions(p);
    const isLocked = p.locked;
    const canEditItems = !isLocked && ['PM','HEAD_PM','PROC','ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'].includes(_user.role);
    const isPROC = ['PROC','ADMIN'].includes(_user.role);

    let html = `<div class="proc-detail">
      <div class="proc-detail__header">
        <div><h2 style="margin:0">Заявка #${p.id}</h2><div style="margin-top:4px">${badge(p.status)}</div></div>
        ${isLocked?'<span class="badge" style="background:var(--warn-bg);color:var(--warn-t)">🔒 Заблокирована</span>':''}
        <div style="display:flex;gap:6px;margin-left:auto">
          <button class="btn ghost" id="proc-clone" style="font-size:12px" title="Создать копию этой заявки">🔁 Повторить</button>
          ${items.length?'<button class="btn ghost" id="proc-save-tpl" style="font-size:12px" title="Сохранить как шаблон для постоянных работ">📋 В шаблон</button>':''}
        </div>
      </div>
      <dl class="proc-detail__meta">
        <dt>Работа</dt><dd>${esc(p.work_title||'—')}</dd>
        <dt>Заказчик</dt><dd>${esc(p.customer_name||'—')}</dd>
        <dt>РП</dt><dd>${esc(p.pm_name||'—')}</dd>
        <dt>Закупщик</dt><dd>${esc(p.proc_name||'не назначен')}</dd>
        <dt>Создана</dt><dd>${dtFull(p.created_at)}</dd>
        ${p.delivery_deadline?`<dt>Дедлайн</dt><dd>${dt(p.delivery_deadline)}${p.delivered_at?'':p.delivery_deadline&&new Date(p.delivery_deadline)<new Date()?' <span class="proc-overdue">просрочено</span>':''}</dd>`:''}
        ${p.paid_at?`<dt>Оплачено</dt><dd>${dtFull(p.paid_at)}</dd>`:''}
        ${p.delivered_at?`<dt>Доставлено</dt><dd>${dtFull(p.delivered_at)}</dd>`:''}
        <dt>Сумма</dt><dd><strong>${money(p.total_sum)}</strong></dd>
      </dl>`;

    // Items — родители + дочерние (сплит), опц. группировка
    const parents = items.filter(it => !it.parent_item_id);
    const childrenOf = pid => items.filter(it => it.parent_item_id === pid);
    const statusCell = it => it.item_status==='delivered'
        ? (it.equipment_id
          ? '<span class="proc-eq-badge proc-eq-badge--delivered" onclick="location.hash=\'#/equipment?id='+it.equipment_id+'\'">📦 #'+it.equipment_id+'</span>'
          : '<span class="proc-eq-badge proc-eq-badge--delivered">✅ Принято</span>')
        : it.item_status==='cancelled'
          ? '<span class="proc-eq-badge proc-eq-badge--pending">✕ Отменена</span>'
          : '<span class="proc-eq-badge proc-eq-badge--transit">⏳ Ожидает</span>';
    const rowHtml = (it, idx, isChild) => {
      const kids = isChild ? [] : childrenOf(it.id);
      const isSplit = kids.length > 0;
      return `<tr class="${isChild?'proc-row-child':''}" data-row-id="${it.id}">
        <td>${isChild?'↳':(idx+1)}</td>
        <td>${canEditItems&&!isSplit?`<input class="proc-items-table__input" value="${esc(it.name)}" data-id="${it.id}" data-field="name">`:esc(it.name)}${isSplit?' <span class="proc-kbadge">разбито</span>':''}</td>
        <td>${esc(it.article||'')}</td>
        <td>${esc(it.unit)}</td>
        <td>${canEditItems&&!isSplit?`<input class="proc-items-table__input" type="number" value="${it.quantity}" data-id="${it.id}" data-field="quantity" style="width:64px">`:it.quantity}</td>
        <td>${isPROC&&canEditItems&&!isSplit?`<input class="proc-items-table__input" value="${esc(it.supplier||'')}" data-id="${it.id}" data-field="supplier">`:esc(it.supplier||'—')}${it.supplier_delivery_days?` <span class="proc-kbadge">${it.supplier_delivery_days}д</span>`:''}</td>
        <td>${isSplit?'—':(isPROC&&canEditItems?`<input class="proc-items-table__input" type="number" value="${it.unit_price||''}" data-id="${it.id}" data-field="unit_price" style="width:80px">`:money(it.unit_price))}<div class="proc-hint" data-hint-for="${it.id}"></div></td>
        <td>${money(it.total_price)}</td>
        <td>${statusCell(it)}</td>
        <td>${it.invoice_file_name?`<span class="proc-invoice-badge"><a href="${esc(it.invoice_file_path)}" class="proc-invoice-badge__link" target="_blank">📎 ${esc(it.invoice_file_name)}</a></span>`
          :(isPROC&&canEditItems&&!isSplit?`<button class="btn ghost" style="font-size:11px;padding:2px 6px" onclick="AsgardProcurementPage._attachInvoice(${p.id},${it.id})">📎</button>`:'—')}</td>
        ${canEditItems?`<td style="white-space:nowrap">
          ${!isChild&&!isSplit&&parseFloat(it.quantity)>=2?`<button class="btn ghost" style="font-size:11px;padding:2px 5px" data-split-id="${it.id}" title="Разбить по поставщикам">✂️</button>`:''}
          ${isSplit?`<button class="btn ghost" style="font-size:11px;padding:2px 5px" data-unsplit-id="${it.id}" title="Схлопнуть">⇲</button>`:''}
          ${!isChild?`<button class="btn ghost" style="font-size:11px;padding:2px 5px;color:var(--err)" onclick="AsgardProcurementPage._deleteItem(${p.id},${it.id})">✕</button>`:''}
        </td>`:''}
      </tr>`;
    };
    html += `<div class="proc-detail__section"><div class="proc-detail__section-title">Позиции (${parents.length})</div>`;
    if (parents.length) {
      const thead = `<thead><tr><th>№</th><th>Наименование</th><th>Артикул</th><th>Ед.</th><th>Кол-во</th>
        <th>Поставщик</th><th>Цена</th><th>Сумма</th><th>Статус</th><th>Счёт</th>${canEditItems?'<th></th>':''}</tr></thead>`;
      if (_groupMode && _groupMode !== 'none') {
        // группировка по категории/поставщику
        const keyOf = it => _groupMode==='supplier' ? (it.supplier||'Без поставщика') : (it.category_name||'Без категории');
        const groups = {}; parents.forEach(it => { const k=keyOf(it); (groups[k]=groups[k]||[]).push(it); });
        html += `<table class="proc-items-table">${thead}<tbody>`;
        Object.keys(groups).sort().forEach(g => {
          const sum = groups[g].reduce((s,x)=>s+(parseFloat(x.total_price)||0)+childrenOf(x.id).reduce((s2,c)=>s2+(parseFloat(c.total_price)||0),0),0);
          html += `<tr class="proc-grp-row"><td colspan="7"><b>▸ ${esc(g)}</b> <span style="color:var(--t2)">(${groups[g].length})</span></td><td><b>${money(sum)}</b></td><td colspan="${canEditItems?3:2}"></td></tr>`;
          groups[g].forEach((it,idx)=>{ html+=rowHtml(it,idx,false); childrenOf(it.id).forEach(c=>html+=rowHtml(c,0,true)); });
        });
        html += `</tbody></table>`;
      } else {
        html += `<table class="proc-items-table">${thead}<tbody>`;
        parents.forEach((it,idx)=>{ html+=rowHtml(it,idx,false); childrenOf(it.id).forEach(c=>html+=rowHtml(c,0,true)); });
        html += `</tbody></table>`;
      }
      if (canEditItems) html += `<div style="margin-top:var(--sp-2);display:flex;gap:var(--sp-2);flex-wrap:wrap">
        ${isPROC?`<button class="btn primary" id="proc-invoice">🧾 Загрузить счёт</button>`:''}
        <button class="btn ghost" id="proc-grp" title="Группировка">🗂️ Группировать</button>
        <button class="btn ghost" id="proc-showcase">🛒 Из каталога</button>
        <button class="btn ghost" id="proc-save-items">💾 Сохранить</button>
        <button class="btn ghost" id="proc-add-item">+ Позиция</button>
        <button class="btn ghost" id="proc-add-text">📝 Текстом</button>
        <button class="btn ghost" id="proc-ai-parse">🤖 AI по ТЗ</button>
        <button class="btn ghost" onclick="window.open('/api/procurement/${p.id}/export/excel?group=supplier')">📥 Excel</button>
      </div>`;
    } else {
      html += `<div style="color:var(--t2);padding:var(--sp-3)">Позиций нет</div>`;
      if (canEditItems) html += `<div style="margin-top:var(--sp-2);display:flex;gap:var(--sp-2);flex-wrap:wrap">
        <button class="btn primary" id="proc-showcase">🛒 Из каталога</button>
        <button class="btn ghost" id="proc-add-item">+ Позиция</button>
        <button class="btn ghost" id="proc-add-text">📝 Списком</button>
        <button class="btn ghost" id="proc-ai-parse">🤖 AI по ТЗ</button>
        <button class="btn ghost" id="proc-import-xl">📥 Импорт Excel</button>
      </div>`;
    }
    html += `</div>`;

    // Счета поставщиков (видны бухгалтеру при оплате + всем для контроля)
    if (invoiceImports.length) {
      html += `<div class="proc-detail__section"><div class="proc-detail__section-title">🧾 Счета поставщиков (${invoiceImports.length})</div>`;
      invoiceImports.forEach(iv => {
        html += `<div style="padding:var(--sp-2);border-bottom:1px solid var(--brd);font-size:13px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <b>${esc(iv.supplier_name||'Поставщик')}</b>
          ${iv.total_sum?`<span>${money(iv.total_sum)}</span>`:''}
          ${iv.delivery_days?`<span class="proc-kbadge">${iv.delivery_days}д</span>`:''}
          <span style="color:var(--t2)">${iv.matched_count||0} поз.</span>
          ${iv.file_path?`<a href="${esc(iv.file_path)}" target="_blank" class="proc-invoice-badge__link">📎 ${esc(iv.file_name||'файл')}</a>`:''}
          <span style="color:var(--t3);margin-left:auto">${esc(iv.uploaded_by_name||'')} ${dtFull(iv.created_at)}</span>
        </div>`;
      });
      html += `</div>`;
    }

    // Payments
    if (payments.length) {
      html += `<div class="proc-detail__section"><div class="proc-detail__section-title">Платёжки (${payments.length})</div>`;
      payments.forEach(pay => {
        html += `<div style="padding:var(--sp-2);border-bottom:1px solid var(--brd);font-size:13px">
          ${money(pay.amount)} — ${dt(pay.payment_date)} ${pay.payment_number?'№'+esc(pay.payment_number):''}
          ${pay.original_name?` <a href="${esc(pay.download_url)}" target="_blank">📎 ${esc(pay.original_name)}</a>`:''}
          <span style="color:var(--t3);margin-left:8px">${esc(pay.uploader_name||'')} ${dtFull(pay.created_at)}</span>
        </div>`;
      });
      html += `</div>`;
    }

    // History
    if (history.length) {
      html += `<div class="proc-detail__section"><div class="proc-detail__section-title">История</div><div class="proc-timeline">`;
      history.forEach(h => {
        html += `<div class="proc-timeline__entry">
          <div class="proc-timeline__date">${dtFull(h.created_at)}</div>
          <div class="proc-timeline__text"><span class="proc-timeline__actor">${esc(h.actor_name||'')}</span> — ${esc(h.action)} ${h.comment?`<br><em style="color:var(--t2)">${esc(h.comment)}</em>`:''}</div>
        </div>`;
      });
      html += `</div></div>`;
    }

    // Actions
    if (actions.length) {
      html += `<div class="proc-detail__actions">${actions.map(a=>
        `<button class="btn ${a.css}" data-action="${a.action}">${esc(a.label)}</button>`
      ).join('')}</div>`;
    }

    // Comment
    html += `<div style="margin-top:var(--sp-3)"><textarea id="proc-comment" rows="2" placeholder="Комментарий..." style="width:100%;padding:var(--sp-2);border:1px solid var(--brd);border-radius:var(--r-sm);font-size:13px;resize:vertical"></textarea></div>`;
    html += `</div>`;

    showModal({ title: `Заявка #${p.id}`, html: html });

    // Handlers
    document.querySelectorAll('.proc-detail__actions [data-action]').forEach(btn => {
      btn.onclick = async () => {
        const act = btn.dataset.action;
        const comment = document.getElementById('proc-comment')?.value || '';
        let url = `/api/procurement/${p.id}/${act}`;
        if (act === 'deliver-items') { await openDeliverModal(p.id); return; }
        const r = await apiPut(url, { comment });
        if (r.error) { toast('Ошибка', r.error, 'err'); return; }
        toast('Готово', '', 'ok'); closeModal(); refresh();
      };
    });

    // Save inline edits
    const saveBtn = document.getElementById('proc-save-items');
    if (saveBtn) saveBtn.onclick = async () => {
      const inputs = document.querySelectorAll('.proc-items-table__input[data-id]');
      const changes = {};
      inputs.forEach(inp => {
        const id = inp.dataset.id, field = inp.dataset.field;
        if (!changes[id]) changes[id] = {};
        changes[id][field] = inp.type === 'number' ? (inp.value || null) : inp.value;
      });
      for (const [itemId, body] of Object.entries(changes)) {
        await fetch(`/api/procurement/${p.id}/items/${itemId}`, { method: 'PUT', headers: hdr(), body: JSON.stringify(body) });
      }
      toast('Сохранено', '', 'ok'); openDetail(p.id);
    };

    // Витрина каталога — главный способ добавления позиций
    const showcaseBtn = document.getElementById('proc-showcase');
    if (showcaseBtn) showcaseBtn.onclick = () => openShowcase(p.id);

    // 🧾 Загрузить счёт → авто-матчинг → массово проставить цены
    const invBtn = document.getElementById('proc-invoice');
    if (invBtn) invBtn.onclick = () => openInvoiceModal(p.id);
    // 🗂️ Группировка
    const grpBtn = document.getElementById('proc-grp');
    if (grpBtn) grpBtn.onclick = () => _cycleGroup(p.id);
    // подсказки цен в строке + кнопки сплита
    _attachItemHints(p.id, items, isPROC);
    document.querySelectorAll('[data-split-id]').forEach(b => b.onclick = () => openSplitForm(p.id, +b.dataset.splitId, items.find(x=>x.id===+b.dataset.splitId)));
    document.querySelectorAll('[data-unsplit-id]').forEach(b => b.onclick = async () => {
      if (!confirm('Схлопнуть разбивку позиции?')) return;
      const r = await fetch(`/api/procurement/${p.id}/items/${b.dataset.unsplitId}/split`, { method:'DELETE', headers: hdr() });
      if (r.ok) { toast('Готово','Сплит отменён','ok'); openDetail(p.id); } else toast('Ошибка','Не удалось','err');
    });

    // Add item — с подсказкой цены из базы
    const addBtn = document.getElementById('proc-add-item');
    if (addBtn) addBtn.onclick = async () => {
      const html = `<div style="display:flex;flex-direction:column;gap:var(--sp-2)">
        <label>Наименование<input id="pa-name" placeholder="напр. Цемент М400" style="width:100%;padding:var(--sp-2);border:1px solid var(--brd);border-radius:var(--r-sm)"></label>
        <div style="display:flex;gap:var(--sp-2)">
          <label style="flex:1">Кол-во<input id="pa-qty" type="number" value="1" min="0" step="0.001" style="width:100%;padding:var(--sp-2);border:1px solid var(--brd);border-radius:var(--r-sm)"></label>
          <label style="flex:1">Ед.<input id="pa-unit" value="шт" style="width:100%;padding:var(--sp-2);border:1px solid var(--brd);border-radius:var(--r-sm)"></label>
        </div>
        <div id="pa-hint" style="font-size:13px;color:var(--t2);min-height:18px"></div>
        <button class="btn primary" id="pa-submit">Добавить</button>
      </div>`;
      showModal({ title: '+ Позиция', html: html });
      const nameInp = document.getElementById('pa-name');
      setTimeout(() => nameInp?.focus(), 100);
      // Подсказка цены при вводе названия (debounce)
      let hintTmr;
      nameInp.oninput = () => {
        clearTimeout(hintTmr);
        const val = nameInp.value.trim();
        const hintEl = document.getElementById('pa-hint');
        if (val.length < 3) { hintEl.innerHTML = ''; return; }
        hintTmr = setTimeout(async () => {
          try {
            const h = await apiFetch(`/api/price-records/hint?name=${encodeURIComponent(val)}`);
            if (h && h.last) {
              const d = h.last.recorded_at ? new Date(h.last.recorded_at).toLocaleDateString('ru-RU') : '';
              let s = `💡 В прошлый раз: <strong>${money(h.last.unit_price)}</strong>${h.last.supplier_name?' у '+esc(h.last.supplier_name):''} <span style="color:var(--t3)">(${d})</span>`;
              if (h.stats && h.stats.sample_count >= 3) s += `<br><span style="color:var(--t3)">Рынок: ср. ${money(h.stats.avg_price)}, мин ${money(h.stats.min_price)}</span>`;
              hintEl.innerHTML = s;
            } else { hintEl.innerHTML = '<span style="color:var(--t3)">Нет истории цен по этой позиции</span>'; }
          } catch(e) { hintEl.innerHTML = ''; }
        }, 400);
      };
      document.getElementById('pa-submit').onclick = async () => {
        const name = nameInp.value.trim(); if (!name) { toast('Введите наименование', '', 'err'); return; }
        const quantity = parseFloat(document.getElementById('pa-qty').value) || 1;
        const unit = document.getElementById('pa-unit').value || 'шт';
        await apiPost(`/api/procurement/${p.id}/items`, { name, unit, quantity });
        closeModal(); openDetail(p.id);
      };
    };

    // Add by text (списком)
    const textBtn = document.getElementById('proc-add-text');
    if (textBtn) textBtn.onclick = () => {
      const html = `<div style="display:flex;flex-direction:column;gap:var(--sp-2)">
        <div style="color:var(--t2);font-size:13px">Введите позиции — по одной в строке. Можно указать количество и единицу:</div>
        <div style="color:var(--t3);font-size:12px;line-height:1.6">
          Например:<br>10 мешков цемента<br>арматура 12мм - 5 шт<br>кран манипулятор - 2 смены<br>Кабель ВВГнг 3x2.5
        </div>
        <textarea id="proc-text-input" rows="8" placeholder="Каждая позиция с новой строки..." style="width:100%;padding:var(--sp-2);border:1px solid var(--brd);border-radius:var(--r-sm);font-size:14px;resize:vertical;font-family:inherit"></textarea>
        <button class="btn primary" id="proc-text-submit">Добавить позиции</button>
      </div>`;
      showModal({ title: '📝 Добавить позиции списком', html: html });
      setTimeout(() => document.getElementById('proc-text-input')?.focus(), 100);
      document.getElementById('proc-text-submit').onclick = async () => {
        const text = document.getElementById('proc-text-input')?.value || '';
        if (!text.trim()) { toast('Пусто', 'Введите хотя бы одну позицию', 'err'); return; }
        const r = await apiPost(`/api/procurement/${p.id}/items/import-text`, { text });
        if (r.error) { toast('Ошибка', r.error, 'err'); return; }
        toast('Добавлено', `${r.count} позиций`, 'ok'); closeModal(); openDetail(p.id);
      };
    };

    // AI-разбор ТЗ
    const aiBtn = document.getElementById('proc-ai-parse');
    if (aiBtn) aiBtn.onclick = () => {
      const html = `<div style="display:flex;flex-direction:column;gap:var(--sp-2)">
        <div style="color:var(--t2);font-size:13px">Вставьте техзадание или описание работ — AI выделит позиции для закупки (без цен).</div>
        <textarea id="proc-ai-input" rows="10" placeholder="Вставьте ТЗ сюда..." style="width:100%;padding:var(--sp-2);border:1px solid var(--brd);border-radius:var(--r-sm);font-size:13px;resize:vertical;font-family:inherit"></textarea>
        <div id="proc-ai-status" style="font-size:13px;color:var(--t2);min-height:18px"></div>
        <button class="btn primary" id="proc-ai-submit">🤖 Разобрать ТЗ</button>
      </div>`;
      showModal({ title: '🤖 AI-разбор техзадания', html: html });
      setTimeout(() => document.getElementById('proc-ai-input')?.focus(), 100);
      document.getElementById('proc-ai-submit').onclick = async () => {
        const text = document.getElementById('proc-ai-input')?.value || '';
        if (!text.trim()) { toast('Пусто', 'Вставьте ТЗ', 'err'); return; }
        const btn = document.getElementById('proc-ai-submit'), stEl = document.getElementById('proc-ai-status');
        btn.disabled = true; btn.innerHTML = '<span class="mimir-spinner"></span> AI анализирует...';
        stEl.textContent = 'Это может занять до минуты...';
        try {
          const r = await apiPost(`/api/procurement/${p.id}/items/ai-parse`, { text });
          if (r.error) { toast('Ошибка', r.error, 'err'); btn.disabled = false; btn.textContent = '🤖 Разобрать ТЗ'; return; }
          if (r.count > 0) { toast('Готово', `AI добавил ${r.count} позиций`, 'ok'); closeModal(); openDetail(p.id); }
          else { stEl.textContent = r.message || 'AI не нашёл позиций'; btn.disabled = false; btn.textContent = '🤖 Разобрать ТЗ'; }
        } catch(e) { toast('Ошибка', 'AI недоступен', 'err'); btn.disabled = false; btn.textContent = '🤖 Разобрать ТЗ'; }
      };
    };

    // Clone (повторить заявку)
    const cloneBtn = document.getElementById('proc-clone');
    if (cloneBtn) cloneBtn.onclick = async () => {
      if (!confirm('Создать копию этой заявки со всеми позициями?')) return;
      const r = await apiPost(`/api/procurement/${p.id}/clone`, {});
      if (r.error) { toast('Ошибка', r.error, 'err'); return; }
      toast('Создана копия', '', 'ok'); closeModal(); openDetail(r.item.id);
    };

    // Save as template
    const saveTplBtn = document.getElementById('proc-save-tpl');
    if (saveTplBtn) saveTplBtn.onclick = async () => {
      const name = prompt('Название шаблона:', p.title || 'Шаблон закупки');
      if (!name) return;
      const r = await apiPost(`/api/procurement/templates/from-request/${p.id}`, { name });
      if (r.error) { toast('Ошибка', r.error, 'err'); return; }
      toast('Сохранено как шаблон', name, 'ok');
    };

    // Import Excel
    const impBtn = document.getElementById('proc-import-xl');
    if (impBtn) impBtn.onclick = () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls';
      inp.onchange = async () => {
        const file = inp.files[0]; if (!file) return;
        const fd = new FormData(); fd.append('file', file);
        const t = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token');
        const r = await fetch(`/api/procurement/${p.id}/items/import-excel`, { method: 'POST', body: fd, headers: { 'Authorization': 'Bearer ' + t } });
        const data = await r.json();
        if (data.error) { toast('Ошибка', data.error, 'err'); return; }
        toast('Импортировано', `${data.count} позиций`, 'ok'); openDetail(p.id);
      };
      inp.click();
    };
  }

  // -- WOW Deliver modal --
  const ITEM_ICONS = ['📦','🔩','⚙️','🔧','🛠️','🧱','🪣','🔌','🧰','💡'];
  function _itemIcon(name) { let h=0; for(let i=0;i<name.length;i++) h=((h<<5)-h)+name.charCodeAt(i); return ITEM_ICONS[Math.abs(h)%ITEM_ICONS.length]; }
  function _ding() { try { const ac=new(window.AudioContext||window.webkitAudioContext)();const o=ac.createOscillator();const g=ac.createGain();o.connect(g);g.connect(ac.destination);o.frequency.value=880;o.type='sine';g.gain.value=0.08;o.start();g.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.3);o.stop(ac.currentTime+0.3); } catch(e){} }
  function _spawnParticles(card) {
    for(let i=0;i<8;i++){const p=document.createElement('span');p.className='proc-gold-particle';const a=Math.random()*Math.PI*2;const d=40+Math.random()*60;
    p.style.cssText=`left:50%;top:50%;--dx:${Math.cos(a)*d}px;--dy:${Math.sin(a)*d}px`;card.appendChild(p);setTimeout(()=>p.remove(),1100);}
  }

  async function openDeliverModal(procId) {
    const d = await apiFetch(`/api/procurement/${procId}`);
    const allItems = d.items || [];
    const undelivered = allItems.filter(i => i.item_status !== 'delivered' && i.item_status !== 'cancelled');
    if (!undelivered.length) { toast('Всё доставлено', '', 'info'); return; }

    // Раскладка по ячейкам: подгружаем активные ячейки склада (для позиций на склад).
    let cells = [];
    try { const lc = await apiFetch('/api/warehouse/locations?is_active=true&limit=500'); cells = (lc.items || lc.rows || lc.locations || (Array.isArray(lc) ? lc : []) || []); if (!Array.isArray(cells)) cells = []; } catch (_) { cells = []; }
    const cellOpts = '<option value="">— без ячейки —</option>' + cells.map(c => `<option value="${c.id}">${esc(c.label || ('#' + c.id))}</option>`).join('');

    const selected = new Set(undelivered.map(i => i.id));
    let html = `<div class="proc-deliver">
      <div class="proc-deliver__title">📦 Приёмка позиций <span style="font-size:13px;font-weight:400;color:var(--t2)">${undelivered.length} из ${allItems.length}</span></div>
      <div class="proc-deliver__progress"><div class="proc-deliver__progress-bar" id="dlv-bar"></div></div>
      <div id="dlv-cards">`;
    undelivered.forEach(it => {
      const toWarehouse = (it.delivery_target || 'warehouse') === 'warehouse';
      html += `<div class="proc-deliver-card" data-id="${it.id}">
        <div class="proc-deliver-card__icon">${_itemIcon(it.name)}</div>
        <div class="proc-deliver-card__info">
          <div class="proc-deliver-card__name">${esc(it.name)}</div>
          <div class="proc-deliver-card__meta">
            <span>${it.quantity} ${esc(it.unit)}</span>
            ${it.unit_price ? '<span>'+Number(it.unit_price).toLocaleString('ru-RU')+' ₽</span>' : ''}
            ${it.supplier ? '<span>'+esc(it.supplier)+'</span>' : ''}
          </div>
          ${toWarehouse && cells.length ? `<div class="proc-deliver-card__cell"><span style="font-size:11px;color:var(--t2)">📍 Ячейка:</span> <select class="proc-deliver-card__loc" data-loc="${it.id}">${cellOpts}</select></div>` : ''}
        </div>
        <div class="proc-deliver-card__check checked" data-check="${it.id}">✓</div>
      </div>`;
    });
    html += `</div>
      <div class="proc-deliver__footer">
        <button class="proc-deliver__btn proc-deliver__btn--primary" id="dlv-confirm">✅ Принять выбранные (${undelivered.length})</button>
      </div>
    </div>`;

    showModal({ title: 'Приёмка заявки #' + procId, html: html });

    // Toggle selection
    // Клик по select ячейки не должен переключать выбор карточки.
    document.querySelectorAll('.proc-deliver-card__loc').forEach(sel => { sel.onclick = (e) => e.stopPropagation(); sel.onchange = (e) => e.stopPropagation(); });
    document.querySelectorAll('.proc-deliver-card').forEach(card => {
      card.onclick = (e) => {
        if (card.classList.contains('accepted')) return;
        if (e.target && e.target.classList && e.target.classList.contains('proc-deliver-card__loc')) return;
        const id = +card.dataset.id;
        const ch = card.querySelector('.proc-deliver-card__check');
        if (selected.has(id)) { selected.delete(id); ch.classList.remove('checked'); ch.textContent = ''; }
        else { selected.add(id); ch.classList.add('checked'); ch.textContent = '✓'; }
        const btn = document.getElementById('dlv-confirm');
        if (btn) { btn.textContent = '✅ Принять выбранные (' + selected.size + ')'; btn.disabled = !selected.size; }
      };
    });

    // Confirm delivery
    document.getElementById('dlv-confirm').onclick = async () => {
      const btn = document.getElementById('dlv-confirm');
      btn.disabled = true; btn.innerHTML = '<span class="mimir-spinner"></span> Принимаю...';
      const ids = [...selected];
      let done = 0, eqCreated = 0;
      const bar = document.getElementById('dlv-bar');
      const total = ids.length;

      for (const itemId of ids) {
        const locSel = document.querySelector(`.proc-deliver-card__loc[data-loc="${itemId}"]`);
        const locId = locSel && locSel.value ? parseInt(locSel.value) : null;
        const r = await apiPut(`/api/procurement/${procId}/items/${itemId}/deliver`, locId ? { location_id: locId } : {});
        done++;
        if (bar) bar.style.width = Math.round(done / total * 100) + '%';

        const card = document.querySelector(`.proc-deliver-card[data-id="${itemId}"]`);
        if (card) {
          card.classList.add('accepted');
          card.querySelector('.proc-deliver-card__check').classList.add('checked');
          card.querySelector('.proc-deliver-card__check').textContent = '✓';
          // Если создалось оборудование — golden glow
          if (r.item && r.item.equipment_id) {
            eqCreated++;
            card.classList.add('eq-created');
            _spawnParticles(card);
          }
          _ding();
          await new Promise(ok => setTimeout(ok, 300));
        }
      }

      // Финальный экран
      await new Promise(ok => setTimeout(ok, 400));
      const container = document.querySelector('.proc-deliver');
      if (container) {
        container.innerHTML = `<div class="proc-deliver-done">
          <div class="proc-deliver-done__icon">🎉</div>
          <div class="proc-deliver-done__title">Приёмка завершена!</div>
          <div class="proc-deliver-done__sub">Заявка #${procId} — все позиции приняты на склад</div>
          <div class="proc-deliver-done__stats">
            <div class="proc-deliver-done__stat">
              <div class="proc-deliver-done__stat-val">${done}</div>
              <div class="proc-deliver-done__stat-label">Принято</div>
            </div>
            ${eqCreated ? `<div class="proc-deliver-done__stat">
              <div class="proc-deliver-done__stat-val proc-deliver-done__stat-val--gold">${eqCreated}</div>
              <div class="proc-deliver-done__stat-label">Оборудование</div>
            </div>` : ''}
          </div>
          ${eqCreated ? '<a class="proc-deliver-done__link" href="#/equipment">Перейти на склад →</a>' : ''}
        </div>`;
      }
      refresh();
    };
  }

  // -- Actions matrix --
  function getActions(p) {
    const a = [], s = p.status, r = _user.role;
    if (s==='draft'&&['PM','HEAD_PM'].includes(r)) a.push({label:'Отправить закупщику',action:'send-to-proc',css:'primary'});
    if (s==='sent_to_proc'&&['PROC','ADMIN'].includes(r)) a.push({label:'Ответить РП',action:'proc-respond',css:'primary'});
    if (s==='proc_responded'&&['PM','HEAD_PM'].includes(r)){a.push({label:'Согласовать',action:'pm-approve',css:'primary'});a.push({label:'Вернуть',action:'return-to-proc',css:'ghost'});}
    if (s==='pm_approved'&&['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'].includes(r)){
      a.push({label:'Согласовать',action:'dir-approve',css:'primary'});a.push({label:'Доработка',action:'dir-rework',css:'ghost'});
      a.push({label:'Вопрос',action:'dir-question',css:'ghost'});a.push({label:'Отклонить',action:'dir-reject',css:'danger'});}
    if (s==='dir_approved'&&['BUH','ADMIN'].includes(r)) a.push({label:'Оплачено',action:'mark-paid',css:'primary'});
    if (['paid','partially_delivered'].includes(s)&&['WAREHOUSE','PM','HEAD_PM','ADMIN'].includes(r)) a.push({label:'Принять',action:'deliver-items',css:'primary'});
    if (s==='delivered'&&['PM','HEAD_PM','ADMIN'].includes(r)) a.push({label:'Закрыть',action:'close',css:'ghost'});
    return a;
  }

  // -- Attach invoice --
  function _attachInvoice(procId, itemId) {
    const inp = document.createElement('input'); inp.type='file'; inp.accept='.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx';
    inp.onchange = async () => {
      const file = inp.files[0]; if (!file) return;
      const fd = new FormData(); fd.append('file', file); fd.append('entity_type', 'procurement_items'); fd.append('entity_id', itemId);
      const t = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token');
      const r = await fetch('/api/files', { method: 'POST', body: fd, headers: { 'Authorization': 'Bearer ' + t } });
      const data = await r.json();
      if (data.id) {
        await fetch(`/api/procurement/${procId}/items/${itemId}`, { method: 'PUT', headers: hdr(), body: JSON.stringify({ invoice_doc_id: data.id }) });
        toast('Счёт прикреплён', '', 'ok'); openDetail(procId);
      }
    };
    inp.click();
  }

  // -- Delete item --
  async function _deleteItem(procId, itemId) {
    if (!confirm('Удалить позицию?')) return;
    await fetch(`/api/procurement/${procId}/items/${itemId}`, { method: 'DELETE', headers: hdr() });
    openDetail(procId);
  }

  // -- Create modal --
  // ═══ ВИТРИНА КАТАЛОГА: выбор позиций с остатком/ценой → корзина → bulk в заявку ═══
  const _cart = {}; // product_id|name → {name,unit,article,product_id,available,last_price,need}
  async function openShowcase(procId) {
    let rows = [];
    showModal({ title: '🛒 Каталог закупки', html: `<div style="padding:30px;text-align:center;color:var(--t2)">Загрузка каталога…</div>` });
    try { const d = await apiFetch('/api/products/catalog-procurement?include_equipment=true&limit=400'); rows = d.items || []; }
    catch (e) { toast('Ошибка', e.message, 'err'); return; }
    drawShowcase(procId, rows, '');
  }
  function _cartKey(it) { return it.product_id ? 'p' + it.product_id : 'n:' + (it.name || '').toLowerCase(); }
  function drawShowcase(procId, rows, search) {
    const flt = search ? rows.filter(r => (r.name + ' ' + (r.article || '')).toLowerCase().includes(search.toLowerCase())) : rows;
    const cartArr = Object.values(_cart);
    const inCart = it => !!_cart[_cartKey(it)];
    const money = v => (v == null || v === '') ? '—' : Number(v).toLocaleString('ru-RU') + ' ₽';
    const num = v => Number(v || 0).toLocaleString('ru-RU');
    const html = `<div style="min-width:560px;max-width:760px">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
        <input id="sc-q" placeholder="Поиск по каталогу…" value="${esc(search || '')}" style="flex:1;padding:9px 12px;border:1px solid var(--brd);border-radius:8px">
        <span class="badge" style="background:var(--warn-bg,rgba(200,168,78,.15));padding:4px 10px;border-radius:14px">🛒 ${cartArr.length}</span>
      </div>
      <div style="max-height:320px;overflow:auto;border:1px solid var(--brd);border-radius:8px">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="position:sticky;top:0;background:var(--bg-card,#1a1f29)">
            <th style="text-align:left;padding:8px 10px">Наименование</th><th style="padding:8px">В наличии</th>
            <th style="padding:8px">Посл. цена</th><th style="padding:8px"></th></tr></thead>
          <tbody>${!flt.length ? '<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--t2)">Ничего не найдено</td></tr>' :
        flt.map(it => `<tr style="border-top:1px solid var(--brd)">
            <td style="padding:7px 10px"><b>${esc(it.name)}</b>${it.article ? ' <span style="opacity:.5">' + esc(it.article) + '</span>' : ''}
              <div style="font-size:11px;color:var(--t2)">${esc(it.category_name || '')}${it.source === 'equipment' ? ' · оборудование' : ''}</div></td>
            <td style="padding:7px;text-align:center">${Number(it.available_qty) > 0 ? '<span style="color:var(--ok-t,#30d158)">' + num(it.available_qty) + ' ' + esc(it.unit || 'шт') + '</span>' : '<span style="opacity:.5">нет</span>'}</td>
            <td style="padding:7px;text-align:center">${money(it.last_price)}${it.last_supplier ? '<div style="font-size:10px;color:var(--t2)">' + esc(it.last_supplier) + '</div>' : ''}</td>
            <td style="padding:7px;text-align:right"><button class="btn ${inCart(it) ? 'ghost' : 'primary'}" data-add='${esc(JSON.stringify({ k: _cartKey(it), name: it.name, unit: it.unit, article: it.article, product_id: it.product_id, available: Number(it.available_qty) || 0, last_price: it.last_price }))}' style="font-size:12px;padding:4px 10px">${inCart(it) ? '✓' : '+'}</button></td>
          </tr>`).join('')}</tbody></table>
      </div>
      ${cartArr.length ? `<div style="margin-top:14px;border-top:2px solid var(--brd);padding-top:12px">
        <div style="font-weight:600;margin-bottom:8px">Корзина — укажите сколько нужно (показано: докупить)</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          ${cartArr.map(c => { const toBuy = Math.max(0, (c.need || 1) - (c.available || 0)); return `<tr style="border-top:1px solid var(--brd)">
            <td style="padding:6px 8px">${esc(c.name)}</td>
            <td style="padding:6px"><input data-need="${esc(c.k)}" type="number" min="0" value="${c.need || 1}" style="width:70px;padding:4px;border:1px solid var(--brd);border-radius:6px"> ${esc(c.unit || 'шт')}</td>
            <td style="padding:6px;text-align:center;color:var(--t2)">в наличии ${num(c.available || 0)}</td>
            <td style="padding:6px;text-align:center"><b style="color:${toBuy > 0 ? 'var(--warn,#e0a800)' : 'var(--ok-t,#30d158)'}">докупить ${num(toBuy)}</b></td>
            <td style="padding:6px;text-align:right"><button class="btn ghost" data-rm="${esc(c.k)}" style="font-size:12px;padding:2px 8px">✕</button></td></tr>`; }).join('')}
        </table>
        <button class="btn primary" id="sc-submit" style="margin-top:12px;width:100%">Добавить в заявку (${cartArr.length})</button>
      </div>` : '<div style="margin-top:12px;color:var(--t2);font-size:13px">Отметьте товары из каталога кнопкой «+». Нет нужного — добавьте вручную в заявке.</div>'}
      <div style="margin-top:10px;text-align:center">
        <button class="btn ghost" id="sc-to-detail" style="font-size:13px">Открыть заявку (добавить вручную / текстом / Excel) →</button>
      </div>
    </div>`;
    showModal({ title: '🛒 Каталог закупки', html: html });
    const qEl = document.getElementById('sc-q');
    if (qEl) { qEl.oninput = () => drawShowcase(procId, rows, qEl.value); setTimeout(() => { qEl.focus(); qEl.setSelectionRange(qEl.value.length, qEl.value.length); }, 30); }
    document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { const it = JSON.parse(b.dataset.add); if (_cart[it.k]) delete _cart[it.k]; else _cart[it.k] = { ...it, need: (it.available || 0) + 1 }; drawShowcase(procId, rows, qEl ? qEl.value : ''); });
    document.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { delete _cart[b.dataset.rm]; drawShowcase(procId, rows, qEl ? qEl.value : ''); });
    document.querySelectorAll('[data-need]').forEach(inp => inp.oninput = () => { const c = _cart[inp.dataset.need]; if (c) { c.need = parseFloat(inp.value) || 0; drawShowcase(procId, rows, qEl ? qEl.value : ''); setTimeout(() => { const ni = document.querySelector('[data-need="' + inp.dataset.need + '"]'); if (ni) ni.focus(); }, 20); } });
    const sub = document.getElementById('sc-submit');
    if (sub) sub.onclick = async () => {
      // Заказываем «докупить» = нужно − в наличии (что уже есть — не заказываем).
      const items = Object.values(_cart)
        .map(c => ({ name: c.name, unit: c.unit || 'шт', article: c.article || null, product_id: c.product_id || null, quantity: Math.max(0, (c.need || 0) - (c.available || 0)), unit_price: c.last_price || null }))
        .filter(it => it.quantity > 0);
      if (!items.length) { toast('Всё в наличии', 'Докупать нечего — увеличьте «нужно», если требуется заказать сверх остатка', 'warn'); return; }
      const r = await apiPost(`/api/procurement/${procId}/items/bulk`, { items });
      if (r.error) { toast('Ошибка', r.error, 'err'); return; }
      toast('Добавлено', `${r.count} позиций`, 'ok'); Object.keys(_cart).forEach(k => delete _cart[k]); closeModal(); openDetail(procId);
    };
    const toDetail = document.getElementById('sc-to-detail');
    if (toDetail) toDetail.onclick = () => { closeModal(); openDetail(procId); };
  }

  async function openCreateModal(workId, opts) {
    const autoShowcase = !(opts && opts.autoShowcase === false); // по умолчанию открываем витрину после создания
    let workOpts = [{ value: '', label: '— без работы —' }];
    try {
      const wr = await apiFetch('/api/works?limit=200');
      (wr.works || wr.items || wr.rows || []).forEach(w => {
        workOpts.push({ value: String(w.id), label: w.work_title || '#' + w.id });
      });
    } catch(e) {}

    // Загрузим шаблоны для опции «из шаблона»
    let templates = [];
    try { const tr = await apiFetch('/api/procurement/templates'); templates = tr.items || []; } catch(e) {}
    const tplBlock = templates.length ? `<div class="proc-create-tpl" style="margin-bottom:var(--sp-3);padding:var(--sp-2);background:var(--warn-bg,rgba(200,168,78,0.08));border-radius:var(--r-sm)">
      <label style="display:block;margin-bottom:4px">📋 Создать из шаблона (для постоянных работ)<div id="pc-tpl_w" style="margin-top:4px"></div></label>
      <button class="btn ghost" id="pc-from-tpl" style="margin-top:6px;font-size:13px">Создать из выбранного шаблона →</button>
    </div>` : '';

    const html = `<div class="proc-create-form">
      ${tplBlock}
      <div style="color:var(--t3);font-size:12px;margin-bottom:var(--sp-2)">${templates.length ? '— или создайте новую заявку вручную —' : ''}</div>
      <label>Название<input id="pc-title" value="Заявка на закупку" required></label>
      <label>Работа${workId ? ' <span style="font-size:11px;color:var(--ok-t,#30d158)">(определена автоматически)</span>' : ''}<div id="pc-work_w"></div></label>
      <label>Приоритет<div id="pc-priority_w"></div></label>
      <label>Ценовой сегмент<div id="pc-segment_w"></div></label>
      <label>Лимит бюджета, ₽ (необязательно)<input id="pc-budget" type="number" min="0" placeholder="—"></label>
      <label>Примечание<textarea id="pc-notes" rows="3"></textarea></label>
      <button class="btn primary" id="pc-submit">${autoShowcase ? 'Создать и выбрать товары из каталога →' : 'Создать заявку'}</button>
    </div>`;
    showModal({ title: 'Новая заявка', html: html });
    if (templates.length) {
      document.getElementById('pc-tpl_w')?.appendChild(CRSelect.create({ id: 'pc-tpl', options: [{ value: '', label: '— выберите шаблон —' }, ...templates.map(t => ({ value: String(t.id), label: `${t.name} (${t.items_count||0} поз.)` }))], value: '', dropdownClass: 'z-modal' }));
      const fromTplBtn = document.getElementById('pc-from-tpl');
      if (fromTplBtn) fromTplBtn.onclick = async () => {
        const tplId = CRSelect.getValue('pc-tpl');
        if (!tplId) { toast('Выберите шаблон', '', 'err'); return; }
        const fw = document.getElementById('pc-work-fixed');
        const wid = fw ? (fw.value || null) : (CRSelect.getValue('pc-work') || null);
        const r = await apiPost(`/api/procurement/from-template/${tplId}`, { work_id: wid });
        if (r.error) { toast('Ошибка', r.error, 'err'); return; }
        toast('Создано из шаблона', '', 'ok'); closeModal(); openDetail(r.item.id);
      };
    }
    // Если работа задана из карточки работы — показываем её зафиксированной (не нужно выбирать).
    if (workId) {
      const w = workOpts.find(o => o.value === String(workId));
      const wEl = document.getElementById('pc-work_w');
      if (wEl) wEl.innerHTML = `<div style="padding:9px 12px;background:var(--bg2,rgba(48,209,88,.08));border:1px solid var(--ok-t,#30d158);border-radius:8px;font-weight:600">🔧 ${esc((w && w.label) || ('#' + workId))}</div><input type="hidden" id="pc-work-fixed" value="${workId}">`;
    } else {
      document.getElementById('pc-work_w')?.appendChild(CRSelect.create({ id: 'pc-work', options: workOpts, value: '', searchable: true, dropdownClass: 'z-modal' }));
    }
    document.getElementById('pc-priority_w')?.appendChild(CRSelect.create({ id: 'pc-priority', options: [{ value: 'normal', label: 'Обычный' }, { value: 'high', label: 'Высокий' }, { value: 'urgent', label: 'Срочный' }], value: 'normal', dropdownClass: 'z-modal' }));
    document.getElementById('pc-segment_w')?.appendChild(CRSelect.create({ id: 'pc-segment', options: [{ value: '', label: '— не указан —' }, { value: 'cheap', label: '💰 Подешевле' }, { value: 'medium', label: '⚖️ Средний' }, { value: 'premium', label: '⭐ Премиум' }], value: '', dropdownClass: 'z-modal' }));
    document.getElementById('pc-submit').onclick = async () => {
      const fixedWork = document.getElementById('pc-work-fixed');
      const body = {
        title: document.getElementById('pc-title').value,
        work_id: fixedWork ? (fixedWork.value || null) : (CRSelect.getValue('pc-work') || null),
        priority: CRSelect.getValue('pc-priority') || 'normal',
        price_segment: CRSelect.getValue('pc-segment') || null,
        budget_limit: parseFloat(document.getElementById('pc-budget').value) || null,
        notes: document.getElementById('pc-notes').value || null
      };
      const r = await apiPost('/api/procurement', body);
      if (r.error) { toast('Ошибка', r.error, 'err'); return; }
      toast('Создано', '', 'ok'); closeModal();
      // Витрина каталога сразу — чтобы пользователь видел, как добавлять товары.
      if (autoShowcase) openShowcase(r.item.id); else openDetail(r.item.id);
    };
  }

  // -- Refresh --
  let _tableEl = null;
  async function refresh() {
    if (!_tableEl) return;
    _tableEl.innerHTML = '<div class="proc-skel">' + Array.from({length:4}).map(()=>'<div class="proc-skel-row"></div>').join('') + '</div>';
    const params = new URLSearchParams();
    // в канбане статус-фильтр не применяем (показываем все колонки)
    Object.entries(currentFilters).forEach(([k,v])=>{ if(v && !(k==='status' && _viewMode==='kanban')) params.append(k,v); });
    params.append('limit', '400');
    let d; try { d = await apiFetch('/api/procurement?' + params.toString()); } catch(e){ _tableEl.innerHTML = `<div class="proc-empty">⚠️ ${esc(e.message)}</div>`; return; }
    const items = d.items || [];
    if (_viewMode === 'kanban') renderKanban(items, _tableEl);
    else renderTable(items, _tableEl);
  }

  // -- Kanban --
  // Группы-колонки: объединяем «родственные» статусы в понятные этапы.
  const KANBAN_COLS = [
    { key: 'new',      label: '🆕 Новые',         statuses: ['sent_to_proc'],                 to: null },
    { key: 'work',     label: '🛠️ В работе',       statuses: ['proc_responded'],               to: null },
    { key: 'approve',  label: '⏳ Согласование',   statuses: ['pm_approved','dir_question','dir_rework'], to: null },
    { key: 'paid',     label: '💳 Оплачено',       statuses: ['dir_approved','paid'],          to: null },
    { key: 'delivery', label: '🚚 Доставка',       statuses: ['partially_delivered','delivered'], to: null },
    { key: 'done',     label: '✅ Закрыто',        statuses: ['closed','dir_rejected'],        to: null },
  ];
  const _isUrgent = r => r.priority === 'urgent' || (r.delivery_deadline && new Date(r.delivery_deadline) < new Date(Date.now()+3*864e5));
  function renderKanban(items, el) {
    const byStatus = {};
    items.forEach(r => { (byStatus[r.status] = byStatus[r.status] || []).push(r); });
    const colCards = col => {
      const cards = [];
      col.statuses.forEach(s => (byStatus[s]||[]).forEach(r => cards.push(r)));
      // горящие сверху
      cards.sort((a,b) => (_isUrgent(b)?1:0) - (_isUrgent(a)?1:0));
      return cards;
    };
    el.innerHTML = `<div class="proc-kanban">${KANBAN_COLS.map(col => {
      const cards = colCards(col);
      return `<div class="proc-kcol" data-col="${col.key}">
        <div class="proc-kcol__h">${col.label}<span class="proc-kcol__cnt">${cards.length}</span></div>
        <div class="proc-kcol__body" data-drop="${col.key}">
          ${cards.length ? cards.map(r => _kCard(r)).join('') : '<div class="proc-kcol__empty">пусто</div>'}
        </div></div>`;
    }).join('')}</div>`;
    // открытие карточки
    el.querySelectorAll('.proc-kcard[data-id]').forEach(c => {
      c.onclick = ev => { if (ev.target.closest('[data-nodrag]')) return; openDetail(+c.dataset.id); };
      c.setAttribute('draggable', 'true');
      c.ondragstart = ev => { ev.dataTransfer.setData('text/plain', c.dataset.id + ':' + c.dataset.status); c.classList.add('proc-kcard--drag'); };
      c.ondragend = () => c.classList.remove('proc-kcard--drag');
    });
    // drop-зоны = попытка перехода
    el.querySelectorAll('[data-drop]').forEach(zone => {
      zone.ondragover = ev => { ev.preventDefault(); zone.classList.add('proc-kcol__body--over'); };
      zone.ondragleave = () => zone.classList.remove('proc-kcol__body--over');
      zone.ondrop = async ev => {
        ev.preventDefault(); zone.classList.remove('proc-kcol__body--over');
        const [id, fromStatus] = (ev.dataTransfer.getData('text/plain')||'').split(':');
        const col = KANBAN_COLS.find(c => c.key === zone.dataset.drop);
        await _kanbanMove(+id, fromStatus, col);
      };
    });
  }
  function _kCard(r) {
    const unpriced = r.unpriced_count || 0;
    return `<div class="proc-kcard ${_isUrgent(r)?'proc-kcard--urgent':''}" data-id="${r.id}" data-status="${r.status}">
      <div class="proc-kcard__top"><b>#${r.id}</b> ${esc(r.title||'')}${_isUrgent(r)?' 🔥':''}</div>
      <div class="proc-kcard__work">${esc(r.work_title||'без работы')}</div>
      <div class="proc-kcard__meta">
        <span>👤 ${esc(r.pm_name||'—')}</span>
        <span>📦 ${r.items_count||0}</span>
        <span>${money(r.items_total)}</span>
      </div>
      <div class="proc-kcard__badges">
        ${badge(r.status)}
        ${unpriced>0?`<span class="proc-kbadge proc-kbadge--warn">без цен: ${unpriced}</span>`:''}
        ${r.delivery_deadline?`<span class="proc-kbadge ${new Date(r.delivery_deadline)<new Date()?'proc-kbadge--over':''}">⏱ ${dt(r.delivery_deadline)}</span>`:''}
      </div>
    </div>`;
  }
  // Перетаскивание карточки в колонку = соответствующий переход (только разрешённый роли/статусу).
  async function _kanbanMove(id, fromStatus, col) {
    if (!col || col.statuses.includes(fromStatus)) return; // та же колонка
    const r = _user.role;
    const PM = ['PM','HEAD_PM'].includes(r), PROC = ['PROC','ADMIN'].includes(r), DIR = ['DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','ADMIN'].includes(r), BUH = ['BUH','ADMIN'].includes(r);
    let action = null;
    // карта разрешённых drag-переходов (целевая колонка → действие, из соответствующего статуса)
    if (col.key === 'work'    && fromStatus === 'sent_to_proc'   && PROC) action = 'proc-respond';
    else if (col.key === 'approve' && fromStatus === 'proc_responded' && PM)   action = 'pm-approve';
    else if (col.key === 'paid'    && fromStatus === 'pm_approved'    && DIR)  action = 'dir-approve';
    else if (col.key === 'paid'    && fromStatus === 'dir_approved'   && BUH)  action = 'mark-paid';
    else if (col.key === 'done'    && fromStatus === 'delivered'      && (PM||DIR)) action = 'close';
    if (!action) { toast('Перемещение', 'Этот переход недоступен (роль/статус) — откройте заявку для действий', 'warn'); return; }
    try {
      await apiPut(`/api/procurement/${id}/${action}`, {});
      toast('Готово', 'Статус изменён', 'ok');
      refresh();
    } catch (e) { toast('Ошибка', e.message, 'err'); refresh(); }
  }

  // -- Render --
  async function render({ layout, title }) {
    const ud = await apiFetch('/api/users/me');
    _user = ud.user || ud;
    currentFilters = {};

    await layout('', { title: title || 'Закупки' });
    const layoutEl = document.getElementById('layout');
    layoutEl.innerHTML = '';
    const page = document.createElement('div'); page.className = 'proc-page';
    const dashEl = document.createElement('div');
    const filtEl = document.createElement('div');
    _tableEl = document.createElement('div');
    page.append(dashEl, filtEl, _tableEl);
    layoutEl.appendChild(page);

    await renderDashboard(dashEl);
    renderFilters(filtEl);
    await refresh();
  }

  // ═══ ЗАКУПЩИК: счёт, группировка, подсказки, сплит ═══

  // Цикл группировки: нет → категории → поставщики → нет
  function _cycleGroup(procId) {
    _groupMode = _groupMode === 'none' ? 'category' : _groupMode === 'category' ? 'supplier' : 'none';
    openDetail(procId);
  }

  // Подсказки цен в строках (батч). Под ценой: «посл. 350₽ (ООО А) · ср.рынок 340₽».
  async function _attachItemHints(procId, items, isPROC) {
    const need = items.filter(it => !it.parent_item_id && (it.product_id || it.name));
    if (!need.length) return;
    let res; try { res = await apiPost(`/api/procurement/${procId}/price-hints`, { items: need.map(it => ({ key: 'i' + it.id, product_id: it.product_id || null, name: it.name })) }); } catch (_) { return; }
    const hints = res.hints || {};
    need.forEach(it => {
      const h = hints['i' + it.id]; if (!h || (!h.last && !h.stats)) return;
      const el = document.querySelector(`[data-hint-for="${it.id}"]`); if (!el) return;
      const parts = [];
      if (h.last) parts.push(`посл. ${money(h.last.unit_price)}${h.last.supplier_name ? ' (' + esc(h.last.supplier_name) + ')' : ''}`);
      if (h.stats && h.stats.avg_price) parts.push(`ср.рынок ${money(h.stats.avg_price)}`);
      el.innerHTML = parts.join(' · ') + (isPROC && h.last ? ` <a href="#" class="proc-hint__use" data-use="${it.id}" data-price="${h.last.unit_price}">подставить</a>` : '');
    });
    document.querySelectorAll('.proc-hint__use').forEach(a => a.onclick = (ev) => {
      ev.preventDefault();
      const inp = document.querySelector(`.proc-items-table__input[data-id="${a.dataset.use}"][data-field="unit_price"]`);
      if (inp) { inp.value = a.dataset.price; inp.focus(); }
    });
  }

  // Форма сплита позиции по поставщикам
  async function openSplitForm(procId, itemId, item) {
    if (!item) return;
    const qty = parseFloat(item.quantity) || 0;
    let suppliers = [];
    try { const s = await apiFetch('/api/suppliers?limit=300'); suppliers = s.items || []; } catch (_) {}
    const supOpts = '<option value="">— поставщик —</option>' + suppliers.map(s => `<option value="${s.id}" data-name="${esc(s.name)}">${esc(s.name)}</option>`).join('');
    const partRow = (i) => `<div class="proc-split-row" data-pi="${i}">
      <input type="number" min="0" step="any" class="ps-qty" placeholder="кол-во" style="width:80px">
      <select class="ps-sup" style="flex:1;min-width:120px">${supOpts}</select>
      <input type="number" min="0" step="any" class="ps-price" placeholder="цена" style="width:80px">
      <input type="number" min="0" class="ps-days" placeholder="срок,дн" style="width:80px">
      <button class="btn ghost ps-rm" style="padding:2px 8px">✕</button>
    </div>`;
    const html = `<div style="min-width:480px">
      <div style="font-size:13px;color:var(--t2);margin-bottom:10px">Разбить «<b>${esc(item.name)}</b>» (всего ${qty} ${esc(item.unit)}) между поставщиками. Сумма частей должна равняться ${qty}.</div>
      <div id="ps-rows">${partRow(0)}${partRow(1)}</div>
      <button class="btn ghost" id="ps-add" style="margin-top:8px">+ Ещё часть</button>
      <div id="ps-sum" style="margin-top:10px;font-size:13px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button class="btn ghost" id="ps-cancel">Отмена</button>
        <button class="btn primary" id="ps-submit">Разбить</button>
      </div></div>`;
    showModal({ title: '✂️ Разбить позицию', html });
    let cnt = 2;
    const recalc = () => {
      let s = 0; document.querySelectorAll('.ps-qty').forEach(q => s += parseFloat(q.value) || 0);
      const el = document.getElementById('ps-sum');
      el.innerHTML = `Сумма частей: <b style="color:${Math.abs(s - qty) < 0.001 ? 'var(--ok-t,#30d158)' : 'var(--err)'}">${s}</b> / ${qty}`;
    };
    const bind = () => {
      document.querySelectorAll('.ps-qty').forEach(q => q.oninput = recalc);
      document.querySelectorAll('.ps-rm').forEach(b => b.onclick = () => { if (document.querySelectorAll('.proc-split-row').length > 2) { b.closest('.proc-split-row').remove(); recalc(); } });
      recalc();
    };
    bind();
    document.getElementById('ps-add').onclick = () => { document.getElementById('ps-rows').insertAdjacentHTML('beforeend', partRow(cnt++)); bind(); };
    document.getElementById('ps-cancel').onclick = () => closeModal();
    document.getElementById('ps-submit').onclick = async () => {
      const parts = [];
      document.querySelectorAll('.proc-split-row').forEach(row => {
        const q = parseFloat(row.querySelector('.ps-qty').value) || 0; if (q <= 0) return;
        const sel = row.querySelector('.ps-sup'); const sid = sel.value || null; const sname = sel.selectedOptions[0]?.dataset.name || null;
        parts.push({ quantity: q, supplier_id: sid ? +sid : null, supplier_name: sname, unit_price: parseFloat(row.querySelector('.ps-price').value) || null, delivery_days: parseInt(row.querySelector('.ps-days').value) || null });
      });
      if (parts.length < 2) { toast('Внимание', 'Нужно минимум 2 части', 'warn'); return; }
      const r = await fetch(`/api/procurement/${procId}/items/${itemId}/split`, { method: 'POST', headers: hdr(), body: JSON.stringify({ parts }) });
      const d = await r.json();
      if (!r.ok) { toast('Ошибка', d.error || 'Не удалось разбить', 'err'); return; }
      toast('Готово', 'Позиция разбита', 'ok'); closeModal(); openDetail(procId);
    };
  }

  // Модалка загрузки счёта → парс → авто-матчинг → массово проставить цены
  async function openInvoiceModal(procId) {
    let suppliers = [];
    try { const s = await apiFetch('/api/suppliers?limit=300'); suppliers = s.items || []; } catch (_) {}
    const supOpts = '<option value="">— выберите/впишите —</option>' + suppliers.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    const html = `<div style="min-width:540px" id="inv-root">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:12px">
        <label style="flex:1;min-width:180px">Поставщик<select id="inv-sup" style="width:100%;padding:8px;border:1px solid var(--brd);border-radius:8px">${supOpts}</select></label>
        <label style="min-width:120px">или вписать<input id="inv-supname" placeholder="ООО ..." style="width:100%;padding:8px;border:1px solid var(--brd);border-radius:8px"></label>
        <label style="width:110px">Срок, дней<input id="inv-days" type="number" min="0" placeholder="—" style="width:100%;padding:8px;border:1px solid var(--brd);border-radius:8px"></label>
      </div>
      <div style="font-size:12px;color:var(--t2);margin-bottom:8px">Excel — разбирается сразу. PDF/фото — текст распознаётся в браузере. Столбцы: наименование · артикул · количество · цена.</div>
      <label class="btn primary" style="cursor:pointer;display:inline-block">📎 Выбрать файл счёта<input type="file" id="inv-file" accept=".xlsx,.xls,.pdf,image/*" style="display:none"></label>
      <span id="inv-status" style="font-size:12px;color:var(--gold);margin-left:8px"></span>
      <div id="inv-preview" style="margin-top:12px"></div>
    </div>`;
    showModal({ title: '🧾 Загрузить счёт поставщика', html });
    const setStatus = t => { const s = document.getElementById('inv-status'); if (s) s.textContent = t || ''; };
    document.getElementById('inv-file').onchange = async (ev) => {
      const file = ev.target.files && ev.target.files[0]; if (!file) return;
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      const supId = document.getElementById('inv-sup').value || '';
      const supName = document.getElementById('inv-supname').value.trim() || (document.getElementById('inv-sup').selectedOptions[0]?.textContent !== '— выберите/впишите —' ? document.getElementById('inv-sup').selectedOptions[0]?.textContent : '') || '';
      const days = document.getElementById('inv-days').value || '';
      try {
        let d;
        if (ext === 'xlsx' || ext === 'xls') {
          setStatus('Разбор Excel…');
          const fd = new FormData(); if (supId) fd.append('supplier_id', supId); if (supName) fd.append('supplier_name', supName); if (days) fd.append('delivery_days', days); fd.append('file', file);
          const r = await fetch(`/api/procurement/${procId}/invoice/parse`, { method: 'POST', headers: { Authorization: hdr().Authorization }, body: fd });
          d = await r.json(); if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
        } else {
          // PDF/фото → извлекаем текст в браузере (реюз warehouse extractDocText недоступен здесь — простая загрузка через FormData с конвертацией не делаем; шлём текст если есть)
          setStatus('Распознавание…');
          const text = await _extractText(file, setStatus);
          d = await apiPost(`/api/procurement/${procId}/invoice/parse`, { text, supplier_id: supId || null, supplier_name: supName || null, delivery_days: days || null });
        }
        setStatus('');
        if (d.ai_unavailable) { document.getElementById('inv-preview').innerHTML = `<div class="proc-empty">🤖 ${esc(d.message || 'AI недоступен')}</div>`; return; }
        _drawInvoicePreview(procId, d);
      } catch (e) { setStatus(''); toast('Ошибка', e.message, 'err'); }
    };
  }
  // Извлечение текста из PDF/фото (CDN pdf.js/Tesseract — как на складе)
  function _loadScript(src) { return new Promise((res, rej) => { if (document.querySelector('script[data-pi-lib="' + src + '"]')) return res(); const s = document.createElement('script'); s.src = src; s.async = true; s.dataset.piLib = src; s.onload = () => res(); s.onerror = () => rej(new Error('Не удалось загрузить ' + src)); document.head.appendChild(s); }); }
  async function _extractText(file, onP) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf') {
      await _loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      const pdfjs = window.pdfjsLib; if (!pdfjs) throw new Error('PDF-движок недоступен');
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const buf = await file.arrayBuffer(); const doc = await pdfjs.getDocument({ data: buf }).promise; let text = '';
      for (let pp = 1; pp <= Math.min(doc.numPages, 15); pp++) { onP && onP('Стр ' + pp + '…'); const page = await doc.getPage(pp); const tc = await page.getTextContent(); text += tc.items.map(i => i.str).join(' ') + '\n'; }
      if (text.replace(/\s/g, '').length < 30) throw new Error('PDF без текста — сфотографируйте');
      return text;
    }
    onP && onP('OCR…'); await _loadScript('https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.0/tesseract.min.js');
    if (!window.Tesseract) throw new Error('OCR недоступен');
    const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = e => res(e.target.result); r.onerror = rej; r.readAsDataURL(file); });
    const out = await window.Tesseract.recognize(dataUrl, 'rus+eng');
    return (out && out.data && out.data.text) || '';
  }
  function _drawInvoicePreview(procId, d) {
    const host = document.getElementById('inv-preview'); if (!host) return;
    const matches = d.matches || [], unmatched = d.unmatched || [];
    const itemsOpts = (sel) => '<option value="">— не привязывать —</option>' + (d.items_for_match || []).map(it => `<option value="${it.id}" ${sel === it.id ? 'selected' : ''}>${esc(it.name)}${it.has_price ? ' ✓' : ''}</option>`).join('');
    const confBadge = c => c >= 0.8 ? `<span class="proc-kbadge" style="background:rgba(48,209,88,.16);color:#30d158">${Math.round(c*100)}%</span>` : c >= 0.5 ? `<span class="proc-kbadge proc-kbadge--warn">${Math.round(c*100)}%</span>` : `<span class="proc-kbadge">${Math.round(c*100)}%</span>`;
    let rows = matches.map((m, i) => `<tr data-inv-i="${i}" data-mid="${m.item_id}">
      <td>${esc(m.invoice_name)}</td><td>${confBadge(m.confidence)}</td>
      <td><select class="inv-link" data-i="${i}" style="min-width:160px;padding:4px;border:1px solid var(--brd);border-radius:6px">${itemsOpts(m.item_id)}</select></td>
      <td><input type="number" class="inv-price" data-i="${i}" value="${m.unit_price != null ? m.unit_price : ''}" style="width:80px;padding:4px;border:1px solid var(--brd);border-radius:6px"></td>
    </tr>`).join('');
    // несопоставленные — закупщик может привязать вручную
    rows += unmatched.map((u, i) => { const gi = matches.length + i; return `<tr data-inv-i="${gi}" data-mid="" class="proc-row-new">
      <td>${esc(u.invoice_name)} <span class="proc-kbadge proc-kbadge--warn">не найдено</span></td><td>—</td>
      <td><select class="inv-link" data-i="${gi}" style="min-width:160px;padding:4px;border:1px solid var(--brd);border-radius:6px">${itemsOpts(null)}</select></td>
      <td><input type="number" class="inv-price" data-i="${gi}" value="${u.unit_price != null ? u.unit_price : ''}" style="width:80px;padding:4px;border:1px solid var(--brd);border-radius:6px"></td>
    </tr>`; }).join('');
    host.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px">Сопоставление (${matches.length} авто, ${unmatched.length} вручную)</div>
      <div style="max-height:320px;overflow:auto;border:1px solid var(--brd);border-radius:8px">
        <table class="proc-items-table" style="margin:0"><thead><tr><th>Строка счёта</th><th>%</th><th>Позиция заявки</th><th>Цена</th></tr></thead><tbody>${rows || '<tr><td colspan="4" style="padding:14px;text-align:center;color:var(--t2)">Нет строк</td></tr>'}</tbody></table>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:12px">
        <button class="btn primary" id="inv-apply">✅ Применить цены</button>
      </div>`;
    document.getElementById('inv-apply').onclick = async () => {
      const applyRows = [];
      host.querySelectorAll('tbody tr').forEach(tr => {
        const i = tr.dataset.invI;
        const itemId = host.querySelector(`.inv-link[data-i="${i}"]`)?.value;
        const price = parseFloat(host.querySelector(`.inv-price[data-i="${i}"]`)?.value);
        if (itemId && price > 0) applyRows.push({ item_id: +itemId, unit_price: price });
      });
      if (!applyRows.length) { toast('Внимание', 'Нет строк с привязкой и ценой', 'warn'); return; }
      const r = await fetch(`/api/procurement/${procId}/invoice/${d.import_id}/apply`, { method: 'POST', headers: hdr(), body: JSON.stringify({ rows: applyRows, supplier_id: d.supplier_id, supplier_name: d.supplier_name, delivery_days: d.delivery_days }) });
      const res = await r.json();
      if (!r.ok) { toast('Ошибка', res.error || 'Не удалось', 'err'); return; }
      toast('Готово', `Цены проставлены: ${res.applied}`, 'ok'); closeModal(); openDetail(procId);
    };
  }

  return { render, openDetail, openCreateModal, _attachInvoice, _deleteItem };
})();
