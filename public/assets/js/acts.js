/**
 * АСГАРД CRM — Акты выполненных работ (API версия)
 */
window.AsgardActsPage = (function(){
  const { $, $$, esc, toast, showModal, closeModal } = AsgardUI;
  
  let acts = [];
  let works = [];
  let customers = [];

  async function loadData() {
    const auth = await AsgardAuth.getAuth();
    const headers = { 'Authorization': 'Bearer ' + auth.token };
    try {
      const [actsResp, worksResp, custResp] = await Promise.all([
        fetch('/api/acts', { headers }),
        fetch('/api/works', { headers }),
        fetch('/api/customers', { headers })
      ]);
      acts = (await actsResp.json()).acts || [];
      works = (await worksResp.json()).works || [];
      customers = (await custResp.json()).customers || [];
    } catch(e) {
      console.error('Load error:', e);
      acts = []; works = []; customers = [];
    }
  }

  async function saveAct(act) {
    const auth = await AsgardAuth.getAuth();
    const method = act.id ? 'PUT' : 'POST';
    const url = act.id ? '/api/acts/' + act.id : '/api/acts';
    const resp = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + auth.token },
      body: JSON.stringify(act)
    });
    return await resp.json();
  }

  async function render({ layout, title }) {
    await loadData();
    
    const STATUSES = {
      'draft': { label: 'Черновик', color: 'var(--t2)' },
      'sent': { label: 'Отправлен', color: 'var(--info)' },
      'signed': { label: 'Подписан', color: 'var(--ok-t)' },
      'paid': { label: 'Оплачен', color: 'var(--ok)' }
    };
    
    const formatMoney = n => (n||0).toLocaleString('ru-RU') + ' ₽';
    const formatDate = d => d ? new Date(d).toLocaleDateString('ru-RU') : '—';
    
    const html = `
      <div class="acts-page">
        <div class="toolbar" style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
          <input type="text" class="inp" id="searchActs" placeholder="🔍 Поиск..." style="flex:1;min-width:200px"/>
          <select class="inp" id="filterStatus" style="width:150px">
            <option value="">Все статусы</option>
            <option value="draft">Черновик</option>
            <option value="sent">Отправлен</option>
            <option value="signed">Подписан</option>
            <option value="paid">Оплачен</option>
          </select>
          <button class="btn primary" id="btnAddAct">➕ Новый акт</button>
        </div>
        
        <div class="tbl-wrap" style="background:var(--bg-card);border-radius:6px;overflow:hidden">
          <table class="tbl">
            <thead>
              <tr>
                <th>№ акта</th>
                <th>Дата</th>
                <th>Контрагент</th>
                <th>Сумма</th>
                <th>Статус</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody id="actsBody">
              ${acts.map(act => {
                const st = STATUSES[act.status] || STATUSES.draft;
                return `
                  <tr data-id="${act.id}">
                    <td><b>${esc(act.act_number || '—')}</b></td>
                    <td>${formatDate(act.act_date)}</td>
                    <td>${esc(act.customer_name || '—')}</td>
                    <td style="text-align:right">${formatMoney(act.total_amount)}</td>
                    <td><span class="badge" style="background:${st.color}20;color:${st.color};border:1px solid ${st.color}40">${st.label}</span></td>
                    <td>
                      <button class="btn mini" data-action="edit" data-id="${act.id}">✏️</button>
                      <button class="btn mini" data-action="sign" data-id="${act.id}">✍️</button>
                    </td>
                  </tr>
                `;
              }).join('') || '<tr><td colspan="6" style="text-align:center;padding:40px">Актов пока нет</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
    
    await layout(html, { title: title || 'Акты выполненных работ' });
    bindEvents();
  }

  function bindEvents() {
    $('#btnAddAct')?.addEventListener('click', () => openActForm());
    
    $('#actsBody')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = parseInt(btn.dataset.id);
      if (btn.dataset.action === 'edit') openActForm(id);
      if (btn.dataset.action === 'sign') signAct(id);
    });
  }

  async function openActForm(actId = null) {
    const act = actId ? acts.find(a => a.id === actId) : {};
    
    const customerOptions = customers.map(c => 
      `<option value="${c.id}" ${act.customer_id == c.id ? 'selected' : ''}>${esc(c.name)}</option>`
    ).join('');
    
    const workOptions = works.map(w => 
      `<option value="${w.id}" ${act.work_id == w.id ? 'selected' : ''}>${esc(w.work_number || '')} ${esc(w.work_title || w.customer_name || '')}</option>`
    ).join('');
    
    const html = `
      <div class="stack" style="gap:16px">
        <div class="formrow">
          <div>
            <label>Номер акта</label>
            <input class="inp" id="act_number" value="${esc(act.act_number || '')}"/>
          </div>
          <div>
            <label>Дата</label>
            <input class="inp" type="date" id="act_date" value="${act.act_date ? act.act_date.slice(0,10) : new Date().toISOString().slice(0,10)}"/>
          </div>
        </div>
        
        <div>
          <label>Контрагент</label>
          <select class="inp" id="act_customer"><option value="">— Выберите —</option>${customerOptions}</select>
        </div>
        
        <div>
          <label>Привязка к работе</label>
          <select class="inp" id="act_work"><option value="">— Без привязки —</option>${workOptions}</select>
        </div>
        
        <div class="formrow">
          <div>
            <label>Сумма</label>
            <input class="inp" type="number" id="act_amount" value="${act.amount || ''}"/>
          </div>
          <div>
            <label>НДС %</label>
            <input class="inp" type="number" id="act_vat" value="${act.vat_pct || 22}"/>
          </div>
        </div>
        
        <div>
          <label>Примечание</label>
          <textarea class="inp" id="act_notes" rows="2">${esc(act.notes || '')}</textarea>
        </div>
        
        <div class="row" style="gap:10px;justify-content:flex-end">
          <button class="btn ghost" onclick="AsgardUI.closeModal()">Отмена</button>
          <button class="btn primary" id="btnSaveAct">${actId ? 'Сохранить' : 'Создать'}</button>
        </div>
      </div>
    `;
    
    showModal(actId ? '✏️ Редактирование акта' : '➕ Новый акт', html);
    
    $('#btnSaveAct')?.addEventListener('click', async () => {
      const amount = parseFloat($('#act_amount').value) || 0;
      const vatPct = parseFloat($('#act_vat').value) || 20;
      const totalAmount = amount * (1 + vatPct / 100);
      
      const data = {
        id: actId || undefined,
        act_number: $('#act_number').value,
        act_date: $('#act_date').value,
        customer_id: $('#act_customer').value || null,
        customer_name: customers.find(c => c.id == $('#act_customer').value)?.name || '',
        work_id: $('#act_work').value || null,
        amount,
        vat_pct: vatPct,
        total_amount: totalAmount,
        notes: $('#act_notes').value,
        status: act.status || 'draft'
      };
      
      const result = await saveAct(data);
      if (result.success) {
        closeModal();
        toast('Успешно', actId ? 'Акт обновлён' : 'Акт создан', 'ok');
        location.reload();
      } else {
        toast('Ошибка', result.message || 'Не удалось сохранить', 'err');
      }
    });
  }

  async function signAct(actId) {
    const act = acts.find(a => a.id === actId);
    if (!act) return;
    
    if (act.status === 'signed' || act.status === 'paid') {
      toast('Инфо', 'Акт уже подписан', 'ok');
      return;
    }
    
    const data = { ...act, status: 'signed', signed_date: new Date().toISOString().slice(0,10) };
    const result = await saveAct(data);
    
    if (result.success) {
      toast('Подписан', 'Акт отмечен как подписанный', 'ok');
      location.reload();
    } else {
      toast('Ошибка', result.message, 'err');
    }
  }

  return { render };
})();
