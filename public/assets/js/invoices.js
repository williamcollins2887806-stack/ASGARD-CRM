/**
 * АСГАРД CRM — Счета и оплаты (API версия)
 */
window.AsgardInvoicesPage = (function(){
  const { $, $$, esc, toast, showModal, closeModal, showDrawer, hideDrawer } = AsgardUI;
  
  let invoices = [];
  let works = [];
  let customers = [];

  async function loadData() {
    const auth = await AsgardAuth.getAuth();
    const headers = { 'Authorization': 'Bearer ' + auth.token };
    try {
      const [invResp, worksResp, custResp] = await Promise.all([
        fetch('/api/invoices', { headers }),
        fetch('/api/works', { headers }),
        fetch('/api/customers', { headers })
      ]);
      invoices = (await invResp.json()).invoices || [];
      works = (await worksResp.json()).works || [];
      customers = (await custResp.json()).customers || [];
    } catch(e) {
      console.error('Load error:', e);
      invoices = []; works = []; customers = [];
    }
  }

  async function saveInvoice(invoice) {
    const auth = await AsgardAuth.getAuth();
    const method = invoice.id ? 'PUT' : 'POST';
    const url = invoice.id ? '/api/invoices/' + invoice.id : '/api/invoices';
    const resp = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + auth.token },
      body: JSON.stringify(invoice)
    });
    return await resp.json();
  }

  async function render({ layout, title }) {
    await loadData();
    
    const STATUSES = {
      'pending': { label: 'Ожидает', color: 'var(--amber)' },
      'partial': { label: 'Частично', color: 'var(--info)' },
      'paid': { label: 'Оплачен', color: 'var(--ok-t)' },
      'cancelled': { label: 'Отменён', color: 'var(--err-t)' }
    };
    
    const formatMoney = n => AsgardUI.money(n) + ' ₽';
    const formatDate = d => d ? new Date(d).toLocaleDateString('ru-RU') : '—';
    
    const html = `
      <div class="invoices-page">
        <div class="toolbar" style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
          <input type="text" class="inp" id="searchInv" placeholder="🔍 Поиск..." style="flex:1;min-width:200px"/>
          <select class="inp" id="filterStatus" style="width:150px">
            <option value="">Все статусы</option>
            <option value="pending">Ожидает</option>
            <option value="partial">Частично</option>
            <option value="paid">Оплачен</option>
          </select>
          <button class="btn primary" id="btnAddInvoice">➕ Новый счёт</button>
        </div>
        
        <div class="tbl-wrap" style="background:var(--bg-card);border-radius:6px;overflow:hidden">
          <table class="tbl zebra">
            <thead>
              <tr>
                <th>№ счёта</th>
                <th>Дата</th>
                <th>Контрагент</th>
                <th>Сумма</th>
                <th>Оплачено</th>
                <th>Статус</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody id="invoicesBody">
              ${invoices.map(inv => {
                const st = STATUSES[inv.status] || STATUSES.pending;
                return `
                  <tr data-id="${inv.id}">
                    <td><b>${esc(inv.invoice_number || '—')}</b></td>
                    <td>${formatDate(inv.invoice_date)}</td>
                    <td>${esc(inv.customer_name || '—')}</td>
                    <td style="text-align:right">${formatMoney(inv.total_amount)}</td>
                    <td style="text-align:right">${formatMoney(inv.paid_amount)}</td>
                    <td><span class="badge" style="background:${st.color}20;color:${st.color};border:1px solid ${st.color}40">${st.label}</span></td>
                    <td>
                      <button class="btn mini" data-action="edit" data-id="${inv.id}">✏️</button>
                      <button class="btn mini" data-action="pay" data-id="${inv.id}">💰</button>
                    </td>
                  </tr>
                `;
              }).join('') || '<tr><td colspan="7" style="text-align:center;padding:40px">Счетов пока нет</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
    
    await layout(html, { title: title || 'Счета и оплаты' });
    bindEvents();
  }

  function bindEvents() {
    $('#btnAddInvoice')?.addEventListener('click', () => openInvoiceForm());

    $('#invoicesBody')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (btn) {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        if (btn.dataset.action === 'edit') openInvoiceForm(id);
        if (btn.dataset.action === 'pay') openPaymentForm(id);
        return;
      }
      // Row click → open drawer card
      const row = e.target.closest('tr[data-id]');
      if (row) {
        const id = parseInt(row.dataset.id);
        viewInvoice(id);
      }
    });
  }

  function viewInvoice(invoiceId) {
    const inv = invoices.find(i => i.id === invoiceId);
    if (!inv) return;

    const STATUSES = {
      'pending': { label: 'Ожидает', cls: 'status-yellow' },
      'partial': { label: 'Частично', cls: 'status-blue' },
      'paid': { label: 'Оплачен', cls: 'status-green' },
      'cancelled': { label: 'Отменён', cls: 'status-red' }
    };
    const st = STATUSES[inv.status] || STATUSES.pending;
    const formatMoney = n => AsgardUI.money(n) + ' ₽';
    const formatDate = d => d ? new Date(d).toLocaleDateString('ru-RU') : '—';
    const remaining = (inv.total_amount || 0) - (inv.paid_amount || 0);

    const html = `
      <div class="drawer-section">Основные данные</div>
      <div class="drawer-field">
        <span class="drawer-field-label">Статус</span>
        <span class="drawer-field-value"><span class="status ${st.cls}">${st.label}</span></span>
      </div>
      <div class="drawer-field">
        <span class="drawer-field-label">Дата</span>
        <span class="drawer-field-value">${formatDate(inv.invoice_date)}</span>
      </div>
      <div class="drawer-field">
        <span class="drawer-field-label">Контрагент</span>
        <span class="drawer-field-value">${esc(inv.customer_name || '—')}</span>
      </div>

      <div class="drawer-section">Финансы</div>
      <div class="drawer-field">
        <span class="drawer-field-label">Сумма</span>
        <span class="drawer-field-value">${formatMoney(inv.total_amount)}</span>
      </div>
      <div class="drawer-field">
        <span class="drawer-field-label">Оплачено</span>
        <span class="drawer-field-value" style="color:var(--success)">${formatMoney(inv.paid_amount)}</span>
      </div>
      <div class="drawer-field">
        <span class="drawer-field-label">Остаток</span>
        <span class="drawer-field-value" style="color:${remaining > 0 ? 'var(--warning)' : 'var(--success)'}">${formatMoney(remaining)}</span>
      </div>

      ${inv.notes ? `
        <div class="drawer-section">Примечание</div>
        <div style="font-size:13px;color:var(--text-secondary);line-height:1.5">${esc(inv.notes)}</div>
      ` : ''}

      <div style="display:flex;gap:8px;margin-top:24px">
        <button class="btn primary" id="drawerEditInv" style="flex:1">✏️ Редактировать</button>
        <button class="btn gold" id="drawerPayInv" style="flex:1">💰 Внести оплату</button>
      </div>
    `;

    showDrawer({
      title: 'Счёт №' + (inv.invoice_number || inv.id),
      html: html,
      width: 'normal',
      onMount: () => {
        $('#drawerEditInv')?.addEventListener('click', () => { hideDrawer(); openInvoiceForm(invoiceId); });
        $('#drawerPayInv')?.addEventListener('click', () => { hideDrawer(); openPaymentForm(invoiceId); });
      }
    });
  }

  async function openInvoiceForm(invoiceId = null) {
    const inv = invoiceId ? invoices.find(i => i.id === invoiceId) : {};
    
    const customerOptions = customers.map(c => 
      `<option value="${c.id}" ${inv.customer_id == c.id ? 'selected' : ''}>${esc(c.name)}</option>`
    ).join('');
    
    const workOptions = works.map(w => 
      `<option value="${w.id}" ${inv.work_id == w.id ? 'selected' : ''}>${esc(w.work_number || '')} ${esc(w.work_title || w.customer_name || '')}</option>`
    ).join('');
    
    const html = `
      <div class="stack" style="gap:16px">
        <div class="formrow">
          <div>
            <label>Номер счёта</label>
            <input class="inp" id="inv_number" value="${esc(inv.invoice_number || '')}"/>
          </div>
          <div>
            <label>Дата</label>
            <input class="inp" type="date" id="inv_date" value="${inv.invoice_date ? inv.invoice_date.slice(0,10) : new Date().toISOString().slice(0,10)}"/>
          </div>
        </div>
        
        <div>
          <label>Контрагент</label>
          <select class="inp" id="inv_customer"><option value="">— Выберите —</option>${customerOptions}</select>
        </div>
        
        <div>
          <label>Привязка к работе</label>
          <select class="inp" id="inv_work"><option value="">— Без привязки —</option>${workOptions}</select>
        </div>
        
        <div class="formrow">
          <div>
            <label>Сумма</label>
            <input class="inp" type="number" id="inv_amount" value="${inv.amount || ''}"/>
          </div>
          <div>
            <label>НДС %</label>
            <input class="inp" type="number" id="inv_vat" value="${inv.vat_pct || 22}"/>
          </div>
        </div>
        
        <div>
          <label>Примечание</label>
          <textarea class="inp" id="inv_notes" rows="2">${esc(inv.notes || '')}</textarea>
        </div>
        
        <div class="row" style="gap:10px;justify-content:flex-end">
          <button class="btn ghost" onclick="AsgardUI.closeModal()">Отмена</button>
          <button class="btn primary" id="btnSaveInv">${invoiceId ? 'Сохранить' : 'Создать'}</button>
        </div>
      </div>
    `;
    
    showModal(invoiceId ? '✏️ Редактирование счёта' : '➕ Новый счёт', html);
    
    $('#btnSaveInv')?.addEventListener('click', async () => {
      const amount = parseFloat($('#inv_amount').value) || 0;
      const vatPct = parseFloat($('#inv_vat').value) || 20;
      const totalAmount = amount * (1 + vatPct / 100);
      
      const data = {
        id: invoiceId || undefined,
        invoice_number: $('#inv_number').value,
        invoice_date: $('#inv_date').value,
        customer_id: $('#inv_customer').value || null,
        customer_name: customers.find(c => c.id == $('#inv_customer').value)?.name || '',
        work_id: $('#inv_work').value || null,
        amount,
        vat_pct: vatPct,
        total_amount: totalAmount,
        notes: $('#inv_notes').value,
        status: inv.status || 'pending'
      };
      
      const result = await saveInvoice(data);
      if (result.success) {
        closeModal();
        toast('Успешно', invoiceId ? 'Счёт обновлён' : 'Счёт создан', 'ok');
        location.reload();
      } else {
        toast('Ошибка', result.message || 'Не удалось сохранить', 'err');
      }
    });
  }

  async function openPaymentForm(invoiceId) {
    const inv = invoices.find(i => i.id === invoiceId);
    if (!inv) return;
    
    const remaining = (inv.total_amount || 0) - (inv.paid_amount || 0);
    
    const html = `
      <div class="stack" style="gap:16px">
        <div style="padding:12px;background:var(--bg);border-radius:6px">
          <div>Счёт: <b>${esc(inv.invoice_number)}</b></div>
          <div>Сумма: <b>${(inv.total_amount||0).toLocaleString('ru-RU')} ₽</b></div>
          <div>Оплачено: <b>${(inv.paid_amount||0).toLocaleString('ru-RU')} ₽</b></div>
          <div>Остаток: <b style="color:var(--accent)">${remaining.toLocaleString('ru-RU')} ₽</b></div>
        </div>
        
        <div>
          <label>Сумма платежа</label>
          <input class="inp" type="number" id="pay_amount" value="${remaining}"/>
        </div>
        
        <div>
          <label>Дата платежа</label>
          <input class="inp" type="date" id="pay_date" value="${new Date().toISOString().slice(0,10)}"/>
        </div>
        
        <div class="row" style="gap:10px;justify-content:flex-end">
          <button class="btn ghost" onclick="AsgardUI.closeModal()">Отмена</button>
          <button class="btn primary" id="btnSavePay">💰 Внести оплату</button>
        </div>
      </div>
    `;
    
    showModal('💰 Внесение оплаты', html);
    
    $('#btnSavePay')?.addEventListener('click', async () => {
      const payAmount = parseFloat($('#pay_amount').value) || 0;
      const newPaid = (inv.paid_amount || 0) + payAmount;
      const newStatus = newPaid >= inv.total_amount ? 'paid' : 'partial';
      
      const data = { ...inv, paid_amount: newPaid, status: newStatus };
      const result = await saveInvoice(data);
      
      if (result.success) {
        closeModal();
        toast('Оплата', 'Платёж внесён', 'ok');
        location.reload();
      } else {
        toast('Ошибка', result.message, 'err');
      }
    });
  }

  return { render };
})();
