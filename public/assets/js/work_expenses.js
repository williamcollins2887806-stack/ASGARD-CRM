// Stage 13: Расходы по работам
window.AsgardWorkExpenses = (function(){
  const { $, $$, esc, toast, showModal, hideModal } = AsgardUI;

  // 8 категорий расходов по работам
  const EXPENSE_CATEGORIES = [
    { key: 'fot', label: 'ФОТ', color: '#ef4444', icon: '👷' },
    { key: 'logistics', label: 'Логистика', color: '#f59e0b', icon: '🚚' },
    { key: 'accommodation', label: 'Проживание', color: '#8b5cf6', icon: '🏨' },
    { key: 'transfer', label: 'Трансфер', color: '#06b6d4', icon: '🚗' },
    { key: 'chemicals', label: 'Химия', color: '#22c55e', icon: '🧪' },
    { key: 'equipment', label: 'Оборудование', color: '#3b82f6', icon: '🔧' },
    { key: 'subcontract', label: 'Субподряд', color: '#ec4899', icon: '🤝' },
    { key: 'other', label: 'Прочее', color: '#64748b', icon: '📦' }
  ];

  function isoNow(){ return new Date().toISOString(); }
  function money(x){ 
    if(x===null||x===undefined||x==="") return "0"; 
    const n=Number(x); 
    if(isNaN(n)) return "0"; 
    return n.toLocaleString("ru-RU"); 
  }

  // Получить все расходы по работе
  async function getExpensesByWork(workId){
    try {
      return await AsgardDB.byIndex("work_expenses", "work_id", Number(workId));
    } catch(e){
      return [];
    }
  }

  // Сумма расходов по работе
  async function getTotalByWork(workId){
    const expenses = await getExpensesByWork(workId);
    return expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  }

  // Сумма расходов по категориям
  async function getTotalsByCategory(workId){
    const expenses = await getExpensesByWork(workId);
    const totals = {};
    EXPENSE_CATEGORIES.forEach(c => { totals[c.key] = 0; });
    expenses.forEach(e => {
      if(totals[e.category] !== undefined){
        totals[e.category] += Number(e.amount || 0);
      }
    });
    return totals;
  }

  // Добавить расход
  async function addExpense({work_id, category, amount, date, comment, supplier, doc_number, invoice_needed, invoice_received, created_by}){
    const expense = {
      work_id: Number(work_id),
      category: String(category || 'other'),
      amount: Number(amount || 0),
      date: String(date || new Date().toISOString().slice(0,10)),
      comment: String(comment || ''),
      supplier: String(supplier || ''),
      doc_number: String(doc_number || ''),
      invoice_needed: !!invoice_needed,
      invoice_received: !!invoice_received,
      created_by: Number(created_by || 0),
      created_at: isoNow(),
      updated_at: isoNow()
    };
    return await AsgardDB.add("work_expenses", expense);
  }

  // Обновить расход
  async function updateExpense(id, updates){
    const expense = await AsgardDB.get("work_expenses", Number(id));
    if(!expense) throw new Error("Расход не найден");
    Object.assign(expense, updates, { updated_at: isoNow() });
    await AsgardDB.put("work_expenses", expense);
    return expense;
  }

  // Удалить расход
  async function deleteExpense(id){
    await AsgardDB.del("work_expenses", Number(id));
  }

  // ФОТ: добавить строку по сотруднику
  async function addFotEntry({work_id, employee_id, employee_name, base_pay, per_diem, bonus, date_from, date_to, comment, created_by}){
    const total = Number(base_pay || 0) + Number(per_diem || 0) + Number(bonus || 0);
    const expense = {
      work_id: Number(work_id),
      category: 'fot',
      amount: total,
      date: String(date_from || new Date().toISOString().slice(0,10)),
      comment: String(comment || ''),
      supplier: '', // для ФОТ не используется
      doc_number: '',
      invoice_needed: false,
      invoice_received: false,
      created_by: Number(created_by || 0),
      created_at: isoNow(),
      updated_at: isoNow(),
      // Дополнительные поля для ФОТ
      fot_employee_id: Number(employee_id || 0),
      fot_employee_name: String(employee_name || ''),
      fot_base_pay: Number(base_pay || 0),
      fot_per_diem: Number(per_diem || 0),
      fot_bonus: Number(bonus || 0),
      fot_date_from: String(date_from || ''),
      fot_date_to: String(date_to || '')
    };
    return await AsgardDB.add("work_expenses", expense);
  }

  // Модальное окно расходов для карточки работы
  async function openExpensesModal(work, user){
    const expenses = await getExpensesByWork(work.id);
    const totals = await getTotalsByCategory(work.id);
    const grandTotal = Object.values(totals).reduce((a,b) => a+b, 0);

    // Группируем расходы по категориям
    const byCategory = {};
    EXPENSE_CATEGORIES.forEach(c => { byCategory[c.key] = []; });
    expenses.forEach(e => {
      if(byCategory[e.category]) byCategory[e.category].push(e);
    });

    const categoryRows = EXPENSE_CATEGORIES.map(c => {
      const items = byCategory[c.key] || [];
      const total = totals[c.key] || 0;
      const itemsHtml = items.length ? items.map(e => `
        <div class="exp-item" data-id="${e.id}">
          <div class="exp-item-main">
            <span class="exp-date">${esc(e.date || '—')}</span>
            <span class="exp-amount">${money(e.amount)} ₽</span>
            ${e.fot_employee_name ? `<span class="exp-emp">${esc(e.fot_employee_name)}</span>` : ''}
            ${e.supplier ? `<span class="exp-supplier">${esc(e.supplier)}</span>` : ''}
            ${e.comment ? `<span class="exp-comment">${esc(e.comment)}</span>` : ''}
          </div>
          <div class="exp-item-flags">
            ${e.invoice_needed ? (e.invoice_received ? '<span class="badge ok">✓ СФ</span>' : '<span class="badge warn">⏳ СФ</span>') : ''}
            ${e.doc_number ? `<span class="badge">#${esc(e.doc_number)}</span>` : ''}
          </div>
          <div class="exp-item-actions">
            <button class="btn ghost sm" data-edit="${e.id}">✎</button>
            <button class="btn ghost sm red" data-del="${e.id}">✕</button>
          </div>
        </div>
      `).join('') : '<div class="help" style="padding:8px 0">Нет записей</div>';

      return `
        <div class="exp-category" data-cat="${c.key}">
          <div class="exp-cat-header">
            <span class="exp-cat-icon">${c.icon}</span>
            <span class="exp-cat-label">${c.label}</span>
            <span class="exp-cat-total">${money(total)} ₽</span>
            <button class="btn ghost sm" data-add-cat="${c.key}">+ Добавить</button>
            ${c.key === 'fot' ? `<button class="btn ghost sm" data-bonus-cat="${c.key}" style="color:var(--amber)">🏆 Премии</button>` : ''}
          </div>
          <div class="exp-cat-items">${itemsHtml}</div>
        </div>
      `;
    }).join('');

    const html = `
      <style>
        .exp-summary { display:flex; gap:16px; flex-wrap:wrap; margin-bottom:16px; padding:12px; background:rgba(13,20,40,.4); border-radius:12px; }
        .exp-summary-item { flex:1; min-width:150px; }
        .exp-summary-label { font-size:11px; color:var(--muted); text-transform:uppercase; }
        .exp-summary-value { font-size:24px; font-weight:900; color:var(--gold); }
        .exp-mode-toggle { display:flex; gap:4px; background:rgba(13,20,40,.6); padding:4px; border-radius:10px; margin-bottom:16px; }
        .exp-mode-btn { padding:8px 16px; border-radius:8px; border:none; background:transparent; color:var(--muted); font-weight:700; cursor:pointer; }
        .exp-mode-btn.active { background:var(--glass); color:var(--text); }
        .exp-category { margin-bottom:12px; border:1px solid var(--line); border-radius:12px; overflow:hidden; }
        .exp-cat-header { display:flex; align-items:center; gap:10px; padding:10px 14px; background:rgba(13,20,40,.5); }
        .exp-cat-icon { font-size:18px; }
        .exp-cat-label { font-weight:700; flex:1; }
        .exp-cat-total { font-weight:700; color:var(--gold); }
        .exp-cat-items { padding:8px 14px; }
        .exp-item { display:flex; align-items:center; gap:10px; padding:6px 0; border-bottom:1px solid rgba(255,255,255,.05); }
        .exp-item:last-child { border-bottom:none; }
        .exp-item-main { flex:1; display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
        .exp-date { font-size:12px; color:var(--muted); }
        .exp-amount { font-weight:700; }
        .exp-emp { font-size:12px; color:var(--gold); }
        .exp-supplier { font-size:12px; color:var(--muted); }
        .exp-comment { font-size:12px; color:var(--muted); font-style:italic; }
        .exp-item-flags { display:flex; gap:4px; }
        .exp-item-actions { display:flex; gap:4px; }
        .btn.sm { padding:4px 8px; font-size:11px; }
        .badge.ok { background:rgba(34,197,94,.2); color:#22c55e; }
        .badge.warn { background:rgba(245,158,11,.2); color:#f59e0b; }
      </style>

      <div class="exp-summary">
        <div class="exp-summary-item">
          <div class="exp-summary-label">Всего расходов</div>
          <div class="exp-summary-value">${money(grandTotal)} ₽</div>
        </div>
        <div class="exp-summary-item">
          <div class="exp-summary-label">План себестоимости</div>
          <div class="exp-summary-value">${money(work.cost_plan || 0)} ₽</div>
        </div>
        <div class="exp-summary-item">
          <div class="exp-summary-label">Отклонение</div>
          <div class="exp-summary-value" style="color:${grandTotal > Number(work.cost_plan||0) ? '#ef4444' : '#22c55e'}">${grandTotal > Number(work.cost_plan||0) ? '+' : ''}${money(grandTotal - Number(work.cost_plan||0))} ₽</div>
        </div>
      </div>

      <div class="exp-mode-toggle">
        <button class="exp-mode-btn ${work.cost_mode !== 'auto' ? 'active' : ''}" data-mode="manual">Ручной ввод себестоимости</button>
        <button class="exp-mode-btn ${work.cost_mode === 'auto' ? 'active' : ''}" data-mode="auto">Авто (сумма расходов)</button>
      </div>

      <div id="expCategories">${categoryRows}</div>

      <div style="margin-top:16px; display:flex; gap:10px; justify-content:flex-end">
        <button class="btn" id="btnSyncCost">Обновить себестоимость из расходов</button>
      </div>
    `;

    showModal(`Расходы: ${esc(work.work_title || 'Работа #'+work.id)}`, html);

    // Обработчики
    bindExpenseHandlers(work, user);
  }

  function bindExpenseHandlers(work, user){
    // Переключение режима
    $$('.exp-mode-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const mode = btn.dataset.mode;
        work.cost_mode = mode;
        await AsgardDB.put('works', work);
        toast('Режим', mode === 'auto' ? 'Авто-расчёт включён' : 'Ручной режим');
        openExpensesModal(work, user);
      });
    });

    // Добавить расход по категории
    $$('[data-add-cat]').forEach(btn => {
      btn.addEventListener('click', () => {
        const cat = btn.dataset.addCat;
        openAddExpenseModal(work, user, cat);
      });
    });

    // Согласование премий (ФОТ)
    $$('[data-bonus-cat]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (window.AsgardBonusApproval) {
          AsgardBonusApproval.openBonusModal(work.id, () => {
            openExpensesModal(work, user);
          });
        } else {
          toast('Ошибка', 'Модуль премий не загружен', 'err');
        }
      });
    });

    // Редактировать
    $$('[data-edit]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.edit);
        const expense = await AsgardDB.get('work_expenses', id);
        if(expense) openEditExpenseModal(work, user, expense);
      });
    });

    // Удалить
    $$('[data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if(!confirm('Удалить запись расхода?')) return;
        const id = Number(btn.dataset.del);
        await deleteExpense(id);
        toast('Расход', 'Удалено');
        openExpensesModal(work, user);
      });
    });

    // Синхронизировать себестоимость
    const syncBtn = $('#btnSyncCost');
    if(syncBtn) syncBtn.addEventListener('click', async () => {
      const total = await getTotalByWork(work.id);
      work.cost_fact = total;
      await AsgardDB.put('works', work);
      toast('Себестоимость', `Обновлена: ${money(total)} ₽`);
      openExpensesModal(work, user);
    });
  }

  // Модальное окно добавления расхода
  function openAddExpenseModal(work, user, category){
    const cat = EXPENSE_CATEGORIES.find(c => c.key === category) || EXPENSE_CATEGORIES[7];
    const isFot = category === 'fot';

    const html = isFot ? `
      <div class="help">ФОТ: расходы на оплату труда сотрудника</div>
      <hr class="hr"/>
      <div class="formrow">
        <div><label>Сотрудник (имя)</label><input id="exp_emp_name" placeholder="Иванов И.И."/></div>
        <div><label>Оклад/тариф</label><input id="exp_base" type="number" placeholder="0"/></div>
        <div><label>Суточные</label><input id="exp_per_diem" type="number" placeholder="0"/></div>
        <div><label>Премия</label><input id="exp_bonus" type="number" placeholder="0"/></div>
        <div><label>Период с</label><input id="exp_date_from" type="date"/></div>
        <div><label>Период по</label><input id="exp_date_to" type="date"/></div>
        <div style="grid-column:1/-1"><label>Комментарий</label><input id="exp_comment" placeholder="Примечание"/></div>
      </div>
      <div style="margin-top:12px"><button class="btn" id="btnSaveExp">Сохранить</button></div>
    ` : `
      <div class="help">${cat.icon} ${cat.label}</div>
      <hr class="hr"/>
      <div class="formrow">
        <div><label>Дата</label><input id="exp_date" type="date" value="${new Date().toISOString().slice(0,10)}"/></div>
        <div><label>Сумма, ₽</label><input id="exp_amount" type="number" placeholder="0"/></div>
        <div><label>Поставщик</label><input id="exp_supplier" placeholder="Название компании"/></div>
        <div><label>№ документа</label><input id="exp_doc" placeholder="123"/></div>
        <div style="grid-column:1/-1"><label>Комментарий</label><input id="exp_comment" placeholder="Примечание"/></div>
        <div><label><input type="checkbox" id="exp_inv_need" style="width:auto"/> Нужна счёт-фактура</label></div>
        <div><label><input type="checkbox" id="exp_inv_got" style="width:auto"/> СФ получена</label></div>
      </div>
      <div style="margin-top:12px">
        <button class="btn" id="btnSaveExp">Сохранить</button>
        <button class="btn ghost disabled" style="opacity:.5" title="Будет доступно позже">+ Документ</button>
      </div>
    `;

    showModal(`Добавить: ${cat.label}`, html);

    $('#btnSaveExp').addEventListener('click', async () => {
      try {
        if(isFot){
          const name = $('#exp_emp_name').value.trim();
          const base = Number($('#exp_base').value) || 0;
          const perDiem = Number($('#exp_per_diem').value) || 0;
          const bonus = Number($('#exp_bonus').value) || 0;
          if(!name){ toast('ФОТ', 'Укажите имя сотрудника', 'err'); return; }
          if(base + perDiem + bonus <= 0){ toast('ФОТ', 'Укажите сумму', 'err'); return; }
          await addFotEntry({
            work_id: work.id,
            employee_name: name,
            base_pay: base,
            per_diem: perDiem,
            bonus: bonus,
            date_from: $('#exp_date_from').value,
            date_to: $('#exp_date_to').value,
            comment: $('#exp_comment').value,
            created_by: user.id
          });
        } else {
          const amount = Number($('#exp_amount').value) || 0;
          if(amount <= 0){ toast('Расход', 'Укажите сумму', 'err'); return; }
          await addExpense({
            work_id: work.id,
            category: category,
            amount: amount,
            date: $('#exp_date').value,
            comment: $('#exp_comment').value,
            supplier: $('#exp_supplier').value,
            doc_number: $('#exp_doc').value,
            invoice_needed: $('#exp_inv_need').checked,
            invoice_received: $('#exp_inv_got').checked,
            created_by: user.id
          });
        }
        toast('Расход', 'Добавлено');
        openExpensesModal(work, user);
      } catch(e){
        toast('Ошибка', e.message || 'Не удалось сохранить', 'err');
      }
    });
  }

  // Модальное окно редактирования
  function openEditExpenseModal(work, user, expense){
    const cat = EXPENSE_CATEGORIES.find(c => c.key === expense.category) || EXPENSE_CATEGORIES[7];
    const isFot = expense.category === 'fot';

    const html = isFot ? `
      <div class="help">ФОТ: редактирование</div>
      <hr class="hr"/>
      <div class="formrow">
        <div><label>Сотрудник (имя)</label><input id="exp_emp_name" value="${esc(expense.fot_employee_name || '')}"/></div>
        <div><label>Оклад/тариф</label><input id="exp_base" type="number" value="${expense.fot_base_pay || 0}"/></div>
        <div><label>Суточные</label><input id="exp_per_diem" type="number" value="${expense.fot_per_diem || 0}"/></div>
        <div><label>Премия</label><input id="exp_bonus" type="number" value="${expense.fot_bonus || 0}"/></div>
        <div><label>Период с</label><input id="exp_date_from" type="date" value="${expense.fot_date_from || ''}"/></div>
        <div><label>Период по</label><input id="exp_date_to" type="date" value="${expense.fot_date_to || ''}"/></div>
        <div style="grid-column:1/-1"><label>Комментарий</label><input id="exp_comment" value="${esc(expense.comment || '')}"/></div>
      </div>
      <div style="margin-top:12px"><button class="btn" id="btnSaveExp">Сохранить</button></div>
    ` : `
      <div class="help">${cat.icon} ${cat.label}: редактирование</div>
      <hr class="hr"/>
      <div class="formrow">
        <div><label>Дата</label><input id="exp_date" type="date" value="${expense.date || ''}"/></div>
        <div><label>Сумма, ₽</label><input id="exp_amount" type="number" value="${expense.amount || 0}"/></div>
        <div><label>Поставщик</label><input id="exp_supplier" value="${esc(expense.supplier || '')}"/></div>
        <div><label>№ документа</label><input id="exp_doc" value="${esc(expense.doc_number || '')}"/></div>
        <div style="grid-column:1/-1"><label>Комментарий</label><input id="exp_comment" value="${esc(expense.comment || '')}"/></div>
        <div><label><input type="checkbox" id="exp_inv_need" ${expense.invoice_needed ? 'checked' : ''} style="width:auto"/> Нужна счёт-фактура</label></div>
        <div><label><input type="checkbox" id="exp_inv_got" ${expense.invoice_received ? 'checked' : ''} style="width:auto"/> СФ получена</label></div>
      </div>
      <div style="margin-top:12px"><button class="btn" id="btnSaveExp">Сохранить</button></div>
    `;

    showModal(`Редактировать: ${cat.label}`, html);

    $('#btnSaveExp').addEventListener('click', async () => {
      try {
        if(isFot){
          const name = $('#exp_emp_name').value.trim();
          const base = Number($('#exp_base').value) || 0;
          const perDiem = Number($('#exp_per_diem').value) || 0;
          const bonus = Number($('#exp_bonus').value) || 0;
          await updateExpense(expense.id, {
            amount: base + perDiem + bonus,
            fot_employee_name: name,
            fot_base_pay: base,
            fot_per_diem: perDiem,
            fot_bonus: bonus,
            fot_date_from: $('#exp_date_from').value,
            fot_date_to: $('#exp_date_to').value,
            comment: $('#exp_comment').value
          });
        } else {
          await updateExpense(expense.id, {
            date: $('#exp_date').value,
            amount: Number($('#exp_amount').value) || 0,
            supplier: $('#exp_supplier').value,
            doc_number: $('#exp_doc').value,
            comment: $('#exp_comment').value,
            invoice_needed: $('#exp_inv_need').checked,
            invoice_received: $('#exp_inv_got').checked
          });
        }
        toast('Расход', 'Обновлено');
        openExpensesModal(work, user);
      } catch(e){
        toast('Ошибка', e.message || 'Не удалось сохранить', 'err');
      }
    });
  }

  return {
    EXPENSE_CATEGORIES,
    getExpensesByWork,
    getTotalByWork,
    getTotalsByCategory,
    addExpense,
    updateExpense,
    deleteExpense,
    addFotEntry,
    openExpensesModal
  };
})();
