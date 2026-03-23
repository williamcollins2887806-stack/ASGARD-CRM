window.AsgardProcurementPage = (function() {
  const UI = window.AsgardUI || {};
  const $ = UI.$ || (s => document.querySelector(s));
  const esc = UI.esc || (s => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])));
  const toast = UI.toast || ((t,m,type) => console.log(`[${type}] ${t}: ${m}`));
  const showModal = UI.showModal || (() => {});
  const closeModal = UI.closeModal || (() => {});

  let currentFilters = {};
  let _user = null;

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
  async function apiFetch(url,opts={}) { const r=await fetch(url,{headers:hdr(),...opts}); return r.json(); }
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
    } catch(e) { console.error(e); }
  }

  // -- Filters --
  function renderFilters(el) {
    el.innerHTML = `<div class="proc-toolbar">
      <select id="pf-status"><option value="">Все статусы</option>${Object.entries(STATUSES).map(([k,v])=>`<option value="${k}">${v.l}</option>`).join('')}</select>
      <input type="text" id="pf-search" placeholder="Поиск..." style="min-width:200px">
      <button class="btn primary" id="pf-create">+ Новая заявка</button>
      <button class="btn ghost" onclick="window.open('/api/procurement/export/excel')">📥 Excel</button>
      <button class="btn ghost" onclick="window.open('/api/procurement/template/excel')">📄 Шаблон</button>
    </div>`;
    el.querySelector('#pf-status').value = currentFilters.status || '';
    el.querySelector('#pf-status').onchange = e => { currentFilters.status = e.target.value; refresh(); };
    let tmr; el.querySelector('#pf-search').oninput = e => { clearTimeout(tmr); tmr = setTimeout(()=>{ currentFilters.search=e.target.value; refresh(); },300); };
    el.querySelector('#pf-create').onclick = () => openCreateModal();
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
    const p = d.item, items = d.items||[], payments = d.payments||[], history = d.history||[];
    const actions = getActions(p);
    const isLocked = p.locked;
    const canEditItems = !isLocked && [...['PM','HEAD_PM'],...['PROC','ADMIN']].includes(_user.role);
    const isPROC = ['PROC','ADMIN'].includes(_user.role);

    let html = `<div class="proc-detail">
      <div class="proc-detail__header">
        <div><h2 style="margin:0">Заявка #${p.id}</h2><div style="margin-top:4px">${badge(p.status)}</div></div>
        ${isLocked?'<span class="badge" style="background:var(--warn-bg);color:var(--warn-t)">🔒 Заблокирована</span>':''}
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

    // Items
    html += `<div class="proc-detail__section"><div class="proc-detail__section-title">Позиции (${items.length})</div>`;
    if (items.length) {
      html += `<table class="proc-items-table"><thead><tr><th>№</th><th>Наименование</th><th>Артикул</th><th>Ед.</th><th>Кол-во</th>
        <th>Поставщик</th><th>Цена</th><th>Сумма</th><th>Статус</th><th>Счёт</th>${canEditItems?'<th></th>':''}</tr></thead><tbody>`;
      items.forEach((it,idx) => {
        html += `<tr>
          <td>${idx+1}</td>
          <td>${canEditItems?`<input class="proc-items-table__input" value="${esc(it.name)}" data-id="${it.id}" data-field="name">`:esc(it.name)}</td>
          <td>${esc(it.article||'')}</td>
          <td>${esc(it.unit)}</td>
          <td>${canEditItems?`<input class="proc-items-table__input" type="number" value="${it.quantity}" data-id="${it.id}" data-field="quantity" style="width:70px">`:it.quantity}</td>
          <td>${isPROC&&canEditItems?`<input class="proc-items-table__input" value="${esc(it.supplier||'')}" data-id="${it.id}" data-field="supplier">`:esc(it.supplier||'—')}</td>
          <td>${isPROC&&canEditItems?`<input class="proc-items-table__input" type="number" value="${it.unit_price||''}" data-id="${it.id}" data-field="unit_price" style="width:90px">`:money(it.unit_price)}</td>
          <td>${money(it.total_price)}</td>
          <td>${it.item_status==='delivered'
            ? (it.equipment_id
              ? '<span class="proc-eq-badge proc-eq-badge--delivered" onclick="location.hash=\'#/equipment?id='+it.equipment_id+'\'">📦 #'+it.equipment_id+'</span>'
              : '<span class="proc-eq-badge proc-eq-badge--delivered">✅ Принято</span>')
            : it.item_status==='cancelled'
              ? '<span class="proc-eq-badge proc-eq-badge--pending">✕ Отменена</span>'
              : '<span class="proc-eq-badge proc-eq-badge--transit">⏳ Ожидает</span>'}</td>
          <td>${it.invoice_file_name?`<span class="proc-invoice-badge"><a href="${esc(it.invoice_file_path)}" class="proc-invoice-badge__link" target="_blank">📎 ${esc(it.invoice_file_name)}</a></span>`
            :(isPROC&&canEditItems?`<button class="btn ghost" style="font-size:11px;padding:2px 6px" onclick="AsgardProcurementPage._attachInvoice(${p.id},${it.id})">📎</button>`:'—')}</td>
          ${canEditItems?`<td><button class="btn ghost" style="font-size:11px;padding:2px 6px;color:var(--err)" onclick="AsgardProcurementPage._deleteItem(${p.id},${it.id})">✕</button></td>`:''}
        </tr>`;
      });
      html += `</tbody></table>`;
      if (canEditItems) html += `<div style="margin-top:var(--sp-2);display:flex;gap:var(--sp-2)">
        <button class="btn ghost" id="proc-save-items">💾 Сохранить изменения</button>
        <button class="btn ghost" id="proc-add-item">+ Позиция</button>
        <button class="btn ghost" id="proc-import-xl">📥 Импорт Excel</button>
      </div>`;
    } else {
      html += `<div style="color:var(--t2);padding:var(--sp-3)">Позиций нет</div>`;
      if (canEditItems) html += `<button class="btn primary" id="proc-add-item">+ Добавить позицию</button>`;
    }
    html += `</div>`;

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

    // Add item
    const addBtn = document.getElementById('proc-add-item');
    if (addBtn) addBtn.onclick = async () => {
      const name = prompt('Наименование:'); if (!name) return;
      await apiPost(`/api/procurement/${p.id}/items`, { name, unit: 'шт', quantity: 1 });
      openDetail(p.id);
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

    const selected = new Set(undelivered.map(i => i.id));
    let html = `<div class="proc-deliver">
      <div class="proc-deliver__title">📦 Приёмка позиций <span style="font-size:13px;font-weight:400;color:var(--t2)">${undelivered.length} из ${allItems.length}</span></div>
      <div class="proc-deliver__progress"><div class="proc-deliver__progress-bar" id="dlv-bar"></div></div>
      <div id="dlv-cards">`;
    undelivered.forEach(it => {
      html += `<div class="proc-deliver-card" data-id="${it.id}">
        <div class="proc-deliver-card__icon">${_itemIcon(it.name)}</div>
        <div class="proc-deliver-card__info">
          <div class="proc-deliver-card__name">${esc(it.name)}</div>
          <div class="proc-deliver-card__meta">
            <span>${it.quantity} ${esc(it.unit)}</span>
            ${it.unit_price ? '<span>'+Number(it.unit_price).toLocaleString('ru-RU')+' ₽</span>' : ''}
            ${it.supplier ? '<span>'+esc(it.supplier)+'</span>' : ''}
          </div>
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
    document.querySelectorAll('.proc-deliver-card').forEach(card => {
      card.onclick = (e) => {
        if (card.classList.contains('accepted')) return;
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
        const r = await apiPut(`/api/procurement/${procId}/items/${itemId}/deliver`, {});
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
  async function openCreateModal(workId) {
    let worksHtml = '<option value="">— без работы —</option>';
    try {
      const wr = await apiFetch('/api/works?limit=200');
      (wr.items || wr.rows || []).forEach(w => {
        worksHtml += `<option value="${w.id}" ${w.id==workId?'selected':''}>${esc(w.work_title||'#'+w.id)}</option>`;
      });
    } catch(e) {}

    const html = `<div class="proc-create-form">
      <label>Название<input id="pc-title" value="Заявка на закупку" required></label>
      <label>Работа<select id="pc-work">${worksHtml}</select></label>
      <label>Приоритет<select id="pc-priority"><option value="normal">Обычный</option><option value="high">Высокий</option><option value="urgent">Срочный</option></select></label>
      <label>Примечание<textarea id="pc-notes" rows="3"></textarea></label>
      <button class="btn primary" id="pc-submit">Создать</button>
    </div>`;
    showModal({ title: 'Новая заявка', html: html });
    document.getElementById('pc-submit').onclick = async () => {
      const body = {
        title: document.getElementById('pc-title').value,
        work_id: document.getElementById('pc-work').value || null,
        priority: document.getElementById('pc-priority').value,
        notes: document.getElementById('pc-notes').value || null
      };
      const r = await apiPost('/api/procurement', body);
      if (r.error) { toast('Ошибка', r.error, 'err'); return; }
      toast('Создано', '', 'ok'); closeModal(); openDetail(r.item.id);
    };
  }

  // -- Refresh --
  let _tableEl = null;
  async function refresh() {
    const params = new URLSearchParams();
    Object.entries(currentFilters).forEach(([k,v])=>{ if(v) params.append(k,v); });
    const d = await apiFetch('/api/procurement?' + params.toString());
    if (_tableEl) renderTable(d.items || [], _tableEl);
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

  return { render, openDetail, _attachInvoice, _deleteItem };
})();
