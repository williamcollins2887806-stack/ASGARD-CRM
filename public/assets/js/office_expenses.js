// Stage 15: OFFICE_MANAGER — Офисные расходы
// 10 категорий + workflow согласования с директорами

window.AsgardOfficeExpensesPage = (function(){
  const { $, $$, esc, toast, showModal } = AsgardUI;

  // 10 категорий офисных расходов
  const CATEGORIES = [
    { key: 'rent', label: 'Аренда офиса', color: '#ef4444', icon: '🏢' },
    { key: 'utilities', label: 'Коммунальные', color: '#f59e0b', icon: '💡' },
    { key: 'office_supplies', label: 'Канцелярия', color: '#8b5cf6', icon: '📎' },
    { key: 'communication', label: 'Связь и интернет', color: '#06b6d4', icon: '📡' },
    { key: 'transport', label: 'Транспорт/такси', color: '#22c55e', icon: '🚕' },
    { key: 'household', label: 'Хозтовары', color: '#3b82f6', icon: '🧹' },
    { key: 'office_equipment', label: 'Оборудование офиса', color: '#ec4899', icon: '🖥️' },
    { key: 'software', label: 'ПО и подписки', color: '#a855f7', icon: '💿' },
    { key: 'representation', label: 'Представительские', color: '#14b8a6', icon: '🎁' },
    { key: 'other', label: 'Прочее', color: '#64748b', icon: '📦' }
  ];

  // Статусы согласования
  const STATUSES = {
    draft: { label: 'Черновик', color: '#64748b' },
    pending: { label: 'На согласовании', color: '#f59e0b' },
    approved: { label: 'Согласовано', color: '#22c55e' },
    rejected: { label: 'Отклонено', color: '#ef4444' }
  };

  const MONTHS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

  function money(x){ 
    if(x===null||x===undefined||x==="") return "0"; 
    const n=Number(x); 
    if(isNaN(n)) return "0"; 
    return n.toLocaleString("ru-RU"); 
  }

  function isoNow(){ return new Date().toISOString(); }
  function today(){ return new Date().toISOString().slice(0,10); }

  function getCatInfo(key){
    return CATEGORIES.find(c => c.key === key) || { label: key, icon: '📦', color: '#64748b' };
  }

  async function render({layout, title}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash = "#/login"; return; }
    const user = auth.user;

    // Проверка роли
    const allowedRoles = ["ADMIN", "OFFICE_MANAGER", "DIRECTOR_COMM", "DIRECTOR_GEN", "DIRECTOR_DEV", "DIRECTOR"];
    if(!allowedRoles.includes(user.role)){
      toast("Доступ", "Раздел доступен офис-менеджеру и директорам", "err");
      location.hash = "#/home";
      return;
    }

    const isManager = user.role === "OFFICE_MANAGER" || user.role === "ADMIN";
    const isDirector = user.role.startsWith("DIRECTOR") || user.role === "ADMIN";

    // Загрузка данных
    let expenses = [];
    try { expenses = await AsgardDB.all("office_expenses"); } catch(e){}
    const users = await AsgardDB.all("users");
    const usersMap = new Map(users.map(u => [u.id, u]));

    // Текущий год/месяц
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    // Фильтры
    let filters = {
      year: currentYear,
      month: '',
      category: '',
      status: ''
    };

    function filterExpenses(){
      return expenses.filter(e => {
        const date = e.date ? new Date(e.date) : null;
        if(!date) return false;
        if(filters.year && date.getFullYear() !== Number(filters.year)) return false;
        if(filters.month !== '' && date.getMonth() !== Number(filters.month)) return false;
        if(filters.category && e.category !== filters.category) return false;
        if(filters.status && e.status !== filters.status) return false;
        return true;
      }).sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')));
    }

    function calcTotals(list){
      const totals = { all: 0, byCategory: {}, byMonth: Array(12).fill(0) };
      CATEGORIES.forEach(c => { totals.byCategory[c.key] = 0; });
      
      list.forEach(e => {
        const amt = Number(e.amount || 0);
        totals.all += amt;
        if(totals.byCategory[e.category] !== undefined){
          totals.byCategory[e.category] += amt;
        }
        const date = e.date ? new Date(e.date) : null;
        if(date && date.getFullYear() === Number(filters.year)){
          totals.byMonth[date.getMonth()] += amt;
        }
      });
      return totals;
    }

    function renderPage(){
      const filtered = filterExpenses();
      const totals = calcTotals(filtered);
      const pending = expenses.filter(e => e.status === 'pending').length;

      const body = `
        <style>
          .oexp-header { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:20px; }
          .oexp-kpi { display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:12px; margin-bottom:20px; }
          .oexp-kpi-card { background:rgba(13,20,40,.5); border:1px solid var(--line); border-radius:14px; padding:14px; text-align:center; }
          .oexp-kpi-label { font-size:11px; color:var(--muted); text-transform:uppercase; }
          .oexp-kpi-value { font-size:24px; font-weight:900; color:var(--gold); margin-top:4px; }
          .oexp-kpi-sub { font-size:11px; color:var(--muted); }
          
          .oexp-filters { display:flex; flex-wrap:wrap; gap:12px; margin-bottom:20px; padding:14px; background:rgba(13,20,40,.4); border-radius:12px; align-items:flex-end; }
          .oexp-filter { display:flex; flex-direction:column; gap:4px; }
          .oexp-filter label { font-size:11px; color:var(--muted); text-transform:uppercase; }
          .oexp-filter select { padding:8px 12px; border-radius:8px; border:1px solid var(--line); background:var(--glass); color:var(--text); }
          
          .oexp-cats { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px; margin-bottom:20px; }
          .oexp-cat { background:rgba(13,20,40,.4); border:1px solid var(--line); border-radius:12px; padding:12px; display:flex; align-items:center; gap:10px; }
          .oexp-cat-icon { font-size:24px; }
          .oexp-cat-info { flex:1; }
          .oexp-cat-label { font-size:12px; color:var(--muted); }
          .oexp-cat-value { font-size:16px; font-weight:700; color:var(--gold); }
          
          .oexp-table { width:100%; border-collapse:separate; border-spacing:0 6px; }
          .oexp-table th { font-size:11px; color:var(--muted); font-weight:700; text-align:left; padding:8px 10px; text-transform:uppercase; }
          .oexp-table td { padding:10px; background:rgba(13,20,40,.4); border:1px solid var(--line); }
          .oexp-table tr td:first-child { border-radius:10px 0 0 10px; }
          .oexp-table tr td:last-child { border-radius:0 10px 10px 0; }
          .oexp-table tr:hover td { background:rgba(59,130,246,.1); }
          
          .oexp-status { display:inline-block; padding:3px 8px; border-radius:6px; font-size:11px; font-weight:700; }
          .oexp-status.draft { background:rgba(100,116,139,.2); color:#94a3b8; }
          .oexp-status.pending { background:rgba(245,158,11,.2); color:#f59e0b; }
          .oexp-status.approved { background:rgba(34,197,94,.2); color:#22c55e; }
          .oexp-status.rejected { background:rgba(239,68,68,.2); color:#ef4444; }
          
          .oexp-amount { font-weight:700; color:var(--gold); }
          .oexp-cat-badge { font-size:12px; }
          .oexp-date { color:var(--muted); font-size:12px; }
          
          .oexp-actions { display:flex; gap:4px; }
          .oexp-btn { padding:4px 8px; border-radius:6px; border:1px solid var(--line); background:var(--glass); color:var(--text); font-size:11px; cursor:pointer; }
          .oexp-btn:hover { border-color:var(--gold); }
          .oexp-btn.green { border-color:#22c55e; color:#22c55e; }
          .oexp-btn.red { border-color:#ef4444; color:#ef4444; }
          
          .oexp-empty { text-align:center; padding:40px; color:var(--muted); }
        </style>

        <div class="panel">
          <div class="oexp-header">
            <div>
              <div class="help"><b>Офисные расходы</b> — управление и согласование</div>
            </div>
            ${isManager ? `<button class="btn" id="btnAddExpense">+ Добавить расход</button>` : ''}
          </div>

          <div class="oexp-kpi">
            <div class="oexp-kpi-card">
              <div class="oexp-kpi-label">Всего за ${filters.year}</div>
              <div class="oexp-kpi-value">${money(totals.all)} ₽</div>
              <div class="oexp-kpi-sub">${filtered.length} записей</div>
            </div>
            <div class="oexp-kpi-card">
              <div class="oexp-kpi-label">Среднее/месяц</div>
              <div class="oexp-kpi-value">${money(Math.round(totals.all / 12))} ₽</div>
            </div>
            <div class="oexp-kpi-card">
              <div class="oexp-kpi-label">На согласовании</div>
              <div class="oexp-kpi-value" style="color:${pending > 0 ? '#f59e0b' : '#22c55e'}">${pending}</div>
            </div>
            <div class="oexp-kpi-card">
              <div class="oexp-kpi-label">Согласовано</div>
              <div class="oexp-kpi-value">${expenses.filter(e => e.status === 'approved').length}</div>
            </div>
          </div>

          <div class="oexp-cats">
            ${CATEGORIES.map(cat => `
              <div class="oexp-cat">
                <div class="oexp-cat-icon">${cat.icon}</div>
                <div class="oexp-cat-info">
                  <div class="oexp-cat-label">${cat.label}</div>
                  <div class="oexp-cat-value">${money(totals.byCategory[cat.key] || 0)} ₽</div>
                </div>
              </div>
            `).join('')}
          </div>

          <div class="oexp-filters">
            <div class="oexp-filter">
              <label>Год</label>
              <select id="f_year">
                ${[currentYear, currentYear-1, currentYear-2].map(y => 
                  `<option value="${y}" ${filters.year == y ? 'selected' : ''}>${y}</option>`
                ).join('')}
              </select>
            </div>
            <div class="oexp-filter">
              <label>Месяц</label>
              <select id="f_month">
                <option value="">Все</option>
                ${MONTHS.map((m, i) => `<option value="${i}" ${filters.month === String(i) ? 'selected' : ''}>${m}</option>`).join('')}
              </select>
            </div>
            <div class="oexp-filter">
              <label>Категория</label>
              <select id="f_category">
                <option value="">Все</option>
                ${CATEGORIES.map(c => `<option value="${c.key}" ${filters.category === c.key ? 'selected' : ''}>${c.icon} ${c.label}</option>`).join('')}
              </select>
            </div>
            <div class="oexp-filter">
              <label>Статус</label>
              <select id="f_status">
                <option value="">Все</option>
                ${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}" ${filters.status === k ? 'selected' : ''}>${v.label}</option>`).join('')}
              </select>
            </div>
          </div>

          ${filtered.length ? `
            <table class="oexp-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Категория</th>
                  <th>Сумма</th>
                  <th>Описание</th>
                  <th>Статус</th>
                  <th>Кто внёс</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${filtered.slice(0, 50).map(e => {
                  const cat = getCatInfo(e.category);
                  const st = STATUSES[e.status] || STATUSES.draft;
                  const creator = usersMap.get(Number(e.created_by));
                  const canEdit = isManager && (e.status === 'draft' || e.status === 'rejected');
                  const canApprove = isDirector && e.status === 'pending';
                  
                  return `
                    <tr data-id="${e.id}">
                      <td class="oexp-date">${esc(e.date || '—')}</td>
                      <td class="oexp-cat-badge">${cat.icon} ${cat.label}</td>
                      <td class="oexp-amount">${money(e.amount)} ₽</td>
                      <td>${esc(e.comment || e.supplier || '—')}</td>
                      <td><span class="oexp-status ${e.status || 'draft'}">${st.label}</span></td>
                      <td>${esc(creator?.name || '—')}</td>
                      <td>
                        <div class="oexp-actions">
                          <button class="oexp-btn" data-view="${e.id}">👁</button>
                          ${canEdit ? `<button class="oexp-btn" data-edit="${e.id}">✎</button>` : ''}
                          ${canEdit ? `<button class="oexp-btn" data-submit="${e.id}">📤</button>` : ''}
                          ${canApprove ? `<button class="oexp-btn green" data-approve="${e.id}">✓</button>` : ''}
                          ${canApprove ? `<button class="oexp-btn red" data-reject="${e.id}">✕</button>` : ''}
                        </div>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
            ${filtered.length > 50 ? `<div class="help" style="text-align:center">Показано 50 из ${filtered.length}</div>` : ''}
          ` : `
            <div class="oexp-empty">
              <div style="font-size:48px; margin-bottom:12px">🏢</div>
              <div>Нет офисных расходов по выбранным фильтрам</div>
              ${isManager ? `<button class="btn" style="margin-top:16px" id="btnAddExpense2">+ Добавить первый расход</button>` : ''}
            </div>
          `}
        </div>
      `;

      layout(body, { title: title || "Офисные расходы" }).then(bindEvents);
    }

    function bindEvents(){
      // Фильтры
      $('#f_year')?.addEventListener('change', e => { filters.year = e.target.value; renderPage(); });
      $('#f_month')?.addEventListener('change', e => { filters.month = e.target.value; renderPage(); });
      $('#f_category')?.addEventListener('change', e => { filters.category = e.target.value; renderPage(); });
      $('#f_status')?.addEventListener('change', e => { filters.status = e.target.value; renderPage(); });

      // Добавить расход
      $('#btnAddExpense')?.addEventListener('click', () => openAddModal());
      $('#btnAddExpense2')?.addEventListener('click', () => openAddModal());

      // Просмотр
      $$('[data-view]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.view);
          const exp = await AsgardDB.get('office_expenses', id);
          if(exp) openViewModal(exp);
        });
      });

      // Редактирование
      $$('[data-edit]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.edit);
          const exp = await AsgardDB.get('office_expenses', id);
          if(exp) openEditModal(exp);
        });
      });

      // Отправить на согласование
      $$('[data-submit]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.submit);
          const exp = await AsgardDB.get('office_expenses', id);
          if(exp){
            exp.status = 'pending';
            exp.submitted_at = isoNow();
            exp.updated_at = isoNow();
            await AsgardDB.put('office_expenses', exp);
            // Уведомление директорам
            await notifyDirectors('Офисный расход на согласовании', 
              `${getCatInfo(exp.category).label}: ${money(exp.amount)} ₽`, 
              '#/office-expenses');
            toast('Расход', 'Отправлено на согласование');
            expenses = await AsgardDB.all('office_expenses');
            renderPage();
          }
        });
      });

      // Согласовать
      $$('[data-approve]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.approve);
          const exp = await AsgardDB.get('office_expenses', id);
          if(exp){
            exp.status = 'approved';
            exp.approved_by = user.id;
            exp.approved_at = isoNow();
            exp.updated_at = isoNow();
            await AsgardDB.put('office_expenses', exp);
            toast('Расход', 'Согласовано ✓');
            expenses = await AsgardDB.all('office_expenses');
            renderPage();
          }
        });
      });

      // Отклонить
      $$('[data-reject]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.reject);
          const reason = prompt('Причина отклонения:');
          if(reason === null) return;
          const exp = await AsgardDB.get('office_expenses', id);
          if(exp){
            exp.status = 'rejected';
            exp.rejected_by = user.id;
            exp.rejected_at = isoNow();
            exp.reject_reason = reason;
            exp.updated_at = isoNow();
            await AsgardDB.put('office_expenses', exp);
            toast('Расход', 'Отклонено');
            expenses = await AsgardDB.all('office_expenses');
            renderPage();
          }
        });
      });
    }

    async function notifyDirectors(title, message, linkHash){
      const directors = users.filter(u => 
        u.role === 'DIRECTOR_COMM' || u.role === 'DIRECTOR_GEN' || u.role === 'DIRECTOR_DEV' || u.role === 'DIRECTOR'
      );
      for(const d of directors){
        await AsgardDB.add('notifications', {
          user_id: d.id,
          title,
          message,
          link_hash: linkHash,
          is_read: false,
          created_at: isoNow()
        });
      }
    }

    function openAddModal(){
      const html = `
        <div class="formrow">
          <div><label>Дата</label><input id="exp_date" type="date" value="${today()}"/></div>
          <div><label>Категория</label>
            <select id="exp_category">
              ${CATEGORIES.map(c => `<option value="${c.key}">${c.icon} ${c.label}</option>`).join('')}
            </select>
          </div>
          <div><label>Сумма, ₽</label><input id="exp_amount" type="number" placeholder="0"/></div>
          <div><label>Поставщик</label><input id="exp_supplier" placeholder="Название"/></div>
          <div><label>№ документа</label><input id="exp_doc" placeholder="123"/></div>
          <div style="grid-column:1/-1"><label>Комментарий</label><input id="exp_comment" placeholder="Описание расхода"/></div>
          <div><label><input type="checkbox" id="exp_inv_need" style="width:auto"/> Нужна СФ</label></div>
          <div><label><input type="checkbox" id="exp_inv_got" style="width:auto"/> СФ получена</label></div>
          <div style="grid-column:1/-1">
            <label><input type="checkbox" id="exp_has_contract" style="width:auto"/> Есть договор</label>
            <div id="contractBlock" style="display:none;margin-top:8px">
              <input id="exp_contract_id" type="hidden"/>
              <div id="contractInfo" style="padding:8px;background:var(--bg-elevated);border-radius:8px;display:none"></div>
              <button type="button" class="btn mini ghost" id="btnSelectContract" style="margin-top:6px">Выбрать договор</button>
            </div>
          </div>
        </div>
        <hr class="hr"/>
        <div style="display:flex; gap:10px">
          <button class="btn" id="btnSaveDraft">Сохранить черновик</button>
          <button class="btn ghost" id="btnSaveSubmit">Сохранить и отправить</button>
        </div>
      `;
      showModal('Новый офисный расход', html);

      // Обработчик галочки договора
      const contractCheck = $('#exp_has_contract');
      const contractBlock = $('#contractBlock');
      if(contractCheck && contractBlock){
        contractCheck.addEventListener('change', () => {
          contractBlock.style.display = contractCheck.checked ? 'block' : 'none';
        });
      }
      
      // Выбор договора
      $('#btnSelectContract')?.addEventListener('click', async () => {
        const supplier = $('#exp_supplier')?.value?.trim();
        if(!supplier){
          toast('Договор', 'Сначала укажите поставщика', 'warn');
          return;
        }
        // Ищем контрагента в базе
        const customers = await AsgardDB.getAll('customers') || [];
        const found = customers.find(c => c.name?.toLowerCase().includes(supplier.toLowerCase()));
        if(!found){
          toast('Договор', 'Контрагент не найден. Добавьте его в справочник.', 'warn');
          return;
        }
        if(window.AsgardContractsPage){
          AsgardContractsPage.openContractSelector(found.id, 'supplier', (contract) => {
            $('#exp_contract_id').value = contract.id;
            $('#contractInfo').innerHTML = `<strong>${contract.number}</strong><br><small>${contract.subject || 'Без предмета'}</small>`;
            $('#contractInfo').style.display = 'block';
          });
        }
      });

      const save = async (submit) => {
        const amount = Number($('#exp_amount')?.value || 0);
        if(amount <= 0){ toast('Расход', 'Укажите сумму', 'err'); return; }

        const expense = {
          date: $('#exp_date')?.value || today(),
          category: $('#exp_category')?.value || 'other',
          amount,
          supplier: $('#exp_supplier')?.value?.trim() || '',
          doc_number: $('#exp_doc')?.value?.trim() || '',
          comment: $('#exp_comment')?.value?.trim() || '',
          contract_id: $('#exp_contract_id')?.value || null,
          invoice_needed: $('#exp_inv_need')?.checked || false,
          invoice_received: $('#exp_inv_got')?.checked || false,
          status: submit ? 'pending' : 'draft',
          created_by: user.id,
          created_at: isoNow(),
          updated_at: isoNow()
        };

        if(submit) expense.submitted_at = isoNow();

        await AsgardDB.add('office_expenses', expense);

        if(submit){
          await notifyDirectors('Офисный расход на согласовании', 
            `${getCatInfo(expense.category).label}: ${money(expense.amount)} ₽`, 
            '#/office-expenses');
        }

        toast('Расход', submit ? 'Создан и отправлен' : 'Черновик сохранён');
        expenses = await AsgardDB.all('office_expenses');
        renderPage();
      };

      $('#btnSaveDraft')?.addEventListener('click', () => save(false));
      $('#btnSaveSubmit')?.addEventListener('click', () => save(true));
    }

    function openEditModal(expense){
      const html = `
        <div class="formrow">
          <div><label>Дата</label><input id="exp_date" type="date" value="${expense.date || ''}"/></div>
          <div><label>Категория</label>
            <select id="exp_category">
              ${CATEGORIES.map(c => `<option value="${c.key}" ${expense.category === c.key ? 'selected' : ''}>${c.icon} ${c.label}</option>`).join('')}
            </select>
          </div>
          <div><label>Сумма, ₽</label><input id="exp_amount" type="number" value="${expense.amount || 0}"/></div>
          <div><label>Поставщик</label><input id="exp_supplier" value="${esc(expense.supplier || '')}"/></div>
          <div><label>№ документа</label><input id="exp_doc" value="${esc(expense.doc_number || '')}"/></div>
          <div style="grid-column:1/-1"><label>Комментарий</label><input id="exp_comment" value="${esc(expense.comment || '')}"/></div>
          <div><label><input type="checkbox" id="exp_inv_need" ${expense.invoice_needed ? 'checked' : ''} style="width:auto"/> Нужна СФ</label></div>
          <div><label><input type="checkbox" id="exp_inv_got" ${expense.invoice_received ? 'checked' : ''} style="width:auto"/> СФ получена</label></div>
        </div>
        ${expense.reject_reason ? `<div class="help" style="color:#ef4444; margin-top:10px">Причина отклонения: ${esc(expense.reject_reason)}</div>` : ''}
        <hr class="hr"/>
        <div style="display:flex; gap:10px">
          <button class="btn" id="btnSave">Сохранить</button>
          <button class="btn ghost" id="btnSaveSubmit">Сохранить и отправить</button>
        </div>
      `;
      showModal('Редактировать расход', html);

      const save = async (submit) => {
        const amount = Number($('#exp_amount')?.value || 0);
        if(amount <= 0){ toast('Расход', 'Укажите сумму', 'err'); return; }

        expense.date = $('#exp_date')?.value || today();
        expense.category = $('#exp_category')?.value || 'other';
        expense.amount = amount;
        expense.supplier = $('#exp_supplier')?.value?.trim() || '';
        expense.doc_number = $('#exp_doc')?.value?.trim() || '';
        expense.comment = $('#exp_comment')?.value?.trim() || '';
        expense.invoice_needed = $('#exp_inv_need')?.checked || false;
        expense.invoice_received = $('#exp_inv_got')?.checked || false;
        expense.updated_at = isoNow();

        if(submit){
          expense.status = 'pending';
          expense.submitted_at = isoNow();
          expense.reject_reason = '';
        }

        await AsgardDB.put('office_expenses', expense);

        if(submit){
          await notifyDirectors('Офисный расход на согласовании', 
            `${getCatInfo(expense.category).label}: ${money(expense.amount)} ₽`, 
            '#/office-expenses');
        }

        toast('Расход', submit ? 'Обновлён и отправлен' : 'Сохранено');
        expenses = await AsgardDB.all('office_expenses');
        renderPage();
      };

      $('#btnSave')?.addEventListener('click', () => save(false));
      $('#btnSaveSubmit')?.addEventListener('click', () => save(true));
    }

    function openViewModal(expense){
      const cat = getCatInfo(expense.category);
      const st = STATUSES[expense.status] || STATUSES.draft;
      const creator = usersMap.get(Number(expense.created_by));
      const approver = expense.approved_by ? usersMap.get(Number(expense.approved_by)) : null;
      const rejector = expense.rejected_by ? usersMap.get(Number(expense.rejected_by)) : null;

      const html = `
        <div class="formrow">
          <div><label>Дата</label><div class="help">${esc(expense.date || '—')}</div></div>
          <div><label>Категория</label><div class="help">${cat.icon} ${cat.label}</div></div>
          <div><label>Сумма</label><div class="help" style="font-weight:700; color:var(--gold)">${money(expense.amount)} ₽</div></div>
          <div><label>Статус</label><div class="help"><span class="oexp-status ${expense.status}">${st.label}</span></div></div>
        </div>
        <hr class="hr"/>
        <div class="formrow">
          <div><label>Поставщик</label><div class="help">${esc(expense.supplier || '—')}</div></div>
          <div><label>№ документа</label><div class="help">${esc(expense.doc_number || '—')}</div></div>
          <div><label>СФ нужна</label><div class="help">${expense.invoice_needed ? 'Да' : 'Нет'}</div></div>
          <div><label>СФ получена</label><div class="help">${expense.invoice_received ? 'Да' : 'Нет'}</div></div>
        </div>
        <hr class="hr"/>
        <div class="formrow">
          <div style="grid-column:1/-1"><label>Комментарий</label><div class="help">${esc(expense.comment || '—')}</div></div>
        </div>
        <hr class="hr"/>
        <div class="help" style="font-size:11px">
          Создал: ${esc(creator?.name || '—')} | ${expense.created_at ? new Date(expense.created_at).toLocaleString('ru-RU') : '—'}
          ${approver ? `<br>Согласовал: ${esc(approver.name)} | ${new Date(expense.approved_at).toLocaleString('ru-RU')}` : ''}
          ${rejector ? `<br>Отклонил: ${esc(rejector.name)} | Причина: ${esc(expense.reject_reason || '—')}` : ''}
        </div>
      `;
      showModal(`Расход #${expense.id}`, html);
    }

    renderPage();
  }

  return { render, CATEGORIES };
})();
