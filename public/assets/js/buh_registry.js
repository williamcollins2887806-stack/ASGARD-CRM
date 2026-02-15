// Stage 14: Роль BUH — Реестр расходов
// Все расходы по работам + офисные расходы
// Фильтры: заказчик, кто внёс, статус счёт-фактуры, год/месяц

window.AsgardBuhRegistryPage = (function(){
  const { $, $$, esc, toast, showModal } = AsgardUI;

  // Категории расходов
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

  function money(x){ 
    if(x===null||x===undefined||x==="") return "0"; 
    const n=Number(x); 
    if(isNaN(n)) return "0"; 
    return n.toLocaleString("ru-RU"); 
  }

  function isoNow(){ return new Date().toISOString(); }

  async function render({layout, title}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }
    const user = auth.user;

    // Проверка роли (BUH, директора, ADMIN)
    const allowedRoles = ["ADMIN", "BUH", "DIRECTOR_COMM", "DIRECTOR_GEN", "DIRECTOR_DEV", "DIRECTOR"];
    if(!allowedRoles.includes(user.role)){
      toast("Доступ", "Раздел доступен бухгалтерии и директорам", "err");
      location.hash = "#/home";
      return;
    }

    // Загружаем данные
    const allExpenses = await AsgardDB.all("work_expenses");
    const works = await AsgardDB.all("works");
    const tenders = await AsgardDB.all("tenders");
    const users = await AsgardDB.all("users");

    const worksMap = new Map(works.map(w => [w.id, w]));
    const tendersMap = new Map(tenders.map(t => [t.id, t]));
    const usersMap = new Map(users.map(u => [u.id, u]));

    // Собираем уникальных заказчиков
    const customersSet = new Set();
    works.forEach(w => {
      const t = tendersMap.get(w.tender_id);
      const name = w.company || t?.customer_name || '';
      if(name) customersSet.add(name);
    });
    const customers = Array.from(customersSet).sort();

    // Уникальные пользователи, которые вносили расходы
    const creatorsSet = new Set();
    allExpenses.forEach(e => {
      if(e.created_by) creatorsSet.add(e.created_by);
    });
    const creators = Array.from(creatorsSet).map(id => usersMap.get(id)).filter(Boolean);

    // Годы для фильтра
    const yearsSet = new Set();
    allExpenses.forEach(e => {
      if(e.date){
        const y = new Date(e.date).getFullYear();
        if(y > 2000) yearsSet.add(y);
      }
    });
    const years = Array.from(yearsSet).sort((a,b) => b - a);
    if(!years.length) years.push(new Date().getFullYear());

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    const body = `
      <style>
        .buh-filters { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:20px; align-items:flex-end; }
        .buh-filter { display:flex; flex-direction:column; gap:4px; min-width:150px; }
        .buh-filter label { font-size:11px; color:var(--muted); text-transform:uppercase; font-weight:700; }
        .buh-filter select, .buh-filter input { padding:8px 12px; border-radius:10px; border:1px solid var(--line); background:var(--glass); color:var(--text); }
        
        .buh-summary { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:14px; margin-bottom:20px; }
        .buh-card { background:var(--bg-elevated); border-radius:var(--radius-lg); padding:16px; }
        .buh-card-label { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:1px; }
        .buh-card-value { font-size:26px; font-weight:900; color:var(--gold); margin-top:6px; }
        .buh-card-sub { font-size:12px; color:var(--muted); margin-top:4px; }
        
        .buh-table { width:100%; border-collapse:collapse; }
        .buh-table th { font-size:11px; color:var(--muted); text-align:left; padding:8px 12px; font-weight:800; text-transform:uppercase; border-bottom:2px solid var(--border); }
        .buh-table td { padding:12px; vertical-align:top; color:var(--text-primary); border-bottom:1px solid var(--border); }
        .buh-table tbody tr:last-child td { border-bottom:none; }
        .buh-table tr:hover td { background:var(--bg-hover); }
        
        .buh-cat-badge { display:inline-flex; align-items:center; gap:4px; padding:4px 8px; border-radius:6px; font-size:12px; font-weight:700; }
        .buh-status { padding:3px 8px; border-radius:6px; font-size:11px; font-weight:700; }
        .buh-status.need { background:rgba(245,158,11,.2); color:#f59e0b; }
        .buh-status.got { background:rgba(34,197,94,.2); color:#22c55e; }
        .buh-status.none { background:rgba(100,116,139,.2); color:#94a3b8; }
        
        .buh-work-status { padding:3px 8px; border-radius:6px; font-size:11px; font-weight:600; }
        .buh-work-closed { background:rgba(34,197,94,.2); color:#22c55e; }
        .buh-work-open { background:rgba(59,130,246,.2); color:#3b82f6; }
        
        .buh-actions { display:flex; gap:6px; }
        .buh-btn { padding:6px 10px; border-radius:8px; border:1px solid var(--line); background:var(--glass); color:var(--text); font-size:12px; cursor:pointer; }
        .buh-btn:hover { border-color:var(--gold); }
        
        .buh-empty { text-align:center; padding:40px; color:var(--muted); }
        
        .buh-pagination { display:flex; gap:8px; justify-content:center; margin-top:20px; }
      </style>

      <div class="panel">
        <div class="help">Реестр расходов по всем работам. Фильтрация по заказчику, исполнителю, статусу СФ, периоду.</div>
        <hr class="hr"/>

        <div class="buh-filters">
          <div class="buh-filter">
            <label>Год</label>
            <select id="f_year">
              <option value="">Все</option>
              ${years.map(y => `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`).join('')}
            </select>
          </div>
          <div class="buh-filter">
            <label>Месяц</label>
            <select id="f_month">
              <option value="">Все</option>
              ${[...Array(12)].map((_, i) => `<option value="${i+1}" ${i+1 === currentMonth ? 'selected' : ''}>${['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'][i]}</option>`).join('')}
            </select>
          </div>
          <div class="buh-filter">
            <label>Заказчик</label>
            <select id="f_customer">
              <option value="">Все</option>
              ${customers.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
            </select>
          </div>
          <div class="buh-filter">
            <label>Кто внёс</label>
            <select id="f_creator">
              <option value="">Все</option>
              ${creators.map(u => `<option value="${u.id}">${esc(u.name || u.login)}</option>`).join('')}
            </select>
          </div>
          <div class="buh-filter">
            <label>Категория</label>
            <select id="f_category">
              <option value="">Все</option>
              ${EXPENSE_CATEGORIES.map(c => `<option value="${c.key}">${c.icon} ${c.label}</option>`).join('')}
            </select>
          </div>
          <div class="buh-filter">
            <label>Статус СФ</label>
            <select id="f_invoice">
              <option value="">Все</option>
              <option value="need">Нужна СФ</option>
              <option value="got">СФ получена</option>
              <option value="none">СФ не нужна</option>
            </select>
          </div>
          <div class="buh-filter">
            <label>&nbsp;</label>
            <button class="btn" id="btnApplyFilter">Применить</button>
          </div>
          <div class="buh-filter">
            <label>&nbsp;</label>
            <button class="btn ghost" id="btnExportCSV">📥 Экспорт CSV</button>
          </div>
        </div>

        <div class="buh-summary" id="buhSummary"></div>

        <div id="buhTable"></div>
      </div>
    `;

    await layout(body, { title: title || "Реестр расходов • BUH" });

    // Функция применения фильтров
    function applyFilters(){
      const fYear = $('#f_year').value;
      const fMonth = $('#f_month').value;
      const fCustomer = $('#f_customer').value;
      const fCreator = $('#f_creator').value;
      const fCategory = $('#f_category').value;
      const fInvoice = $('#f_invoice').value;

      let filtered = allExpenses.slice();

      // Фильтр по году
      if(fYear){
        filtered = filtered.filter(e => {
          if(!e.date) return false;
          return new Date(e.date).getFullYear() === Number(fYear);
        });
      }

      // Фильтр по месяцу
      if(fMonth){
        filtered = filtered.filter(e => {
          if(!e.date) return false;
          return new Date(e.date).getMonth() + 1 === Number(fMonth);
        });
      }

      // Фильтр по заказчику
      if(fCustomer){
        filtered = filtered.filter(e => {
          const w = worksMap.get(e.work_id);
          const t = w ? tendersMap.get(w.tender_id) : null;
          const name = w?.company || t?.customer_name || '';
          return name === fCustomer;
        });
      }

      // Фильтр по создателю
      if(fCreator){
        filtered = filtered.filter(e => String(e.created_by) === fCreator);
      }

      // Фильтр по категории
      if(fCategory){
        filtered = filtered.filter(e => e.category === fCategory);
      }

      // Фильтр по статусу СФ
      if(fInvoice === 'need'){
        filtered = filtered.filter(e => e.invoice_needed && !e.invoice_received);
      } else if(fInvoice === 'got'){
        filtered = filtered.filter(e => e.invoice_received);
      } else if(fInvoice === 'none'){
        filtered = filtered.filter(e => !e.invoice_needed);
      }

      // Сортировка по дате (новые сверху)
      filtered.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

      renderSummary(filtered);
      renderTable(filtered);
    }

    function renderSummary(expenses){
      const total = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
      const count = expenses.length;
      const needInvoice = expenses.filter(e => e.invoice_needed && !e.invoice_received).length;
      const gotInvoice = expenses.filter(e => e.invoice_received).length;

      // Суммы по категориям
      const byCategory = {};
      EXPENSE_CATEGORIES.forEach(c => { byCategory[c.key] = 0; });
      expenses.forEach(e => {
        if(byCategory[e.category] !== undefined){
          byCategory[e.category] += Number(e.amount || 0);
        }
      });

      // Топ-3 категории
      const topCats = EXPENSE_CATEGORIES
        .map(c => ({ ...c, sum: byCategory[c.key] }))
        .sort((a, b) => b.sum - a.sum)
        .slice(0, 3);

      $('#buhSummary').innerHTML = `
        <div class="buh-card">
          <div class="buh-card-label">Всего расходов</div>
          <div class="buh-card-value">${money(total)} ₽</div>
          <div class="buh-card-sub">${count} записей</div>
        </div>
        <div class="buh-card">
          <div class="buh-card-label">Ожидают СФ</div>
          <div class="buh-card-value" style="color:#f59e0b">${needInvoice}</div>
          <div class="buh-card-sub">записей без счёт-фактуры</div>
        </div>
        <div class="buh-card">
          <div class="buh-card-label">СФ получены</div>
          <div class="buh-card-value" style="color:#22c55e">${gotInvoice}</div>
          <div class="buh-card-sub">документов закрыто</div>
        </div>
        ${topCats.map(c => `
          <div class="buh-card">
            <div class="buh-card-label">${c.icon} ${c.label}</div>
            <div class="buh-card-value">${money(c.sum)} ₽</div>
          </div>
        `).join('')}
      `;
    }

    function renderTable(expenses){
      if(!expenses.length){
        $('#buhTable').innerHTML = `<div class="asg-empty"><div class="asg-empty-icon">📭</div><div class="asg-empty-text">Нет данных по выбранным фильтрам</div></div>`;
        return;
      }

      // Показываем первые 100 записей
      const shown = expenses.slice(0, 100);

      const rows = shown.map(e => {
        const w = worksMap.get(e.work_id);
        const t = w ? tendersMap.get(w.tender_id) : null;
        const creator = usersMap.get(e.created_by);
        const cat = EXPENSE_CATEGORIES.find(c => c.key === e.category) || EXPENSE_CATEGORIES[7];

        const customerName = w?.company || t?.customer_name || '—';
        const workTitle = w?.work_title || t?.tender_title || '—';
        const workStatus = w?.work_status || '—';
        const isClosed = workStatus === 'Работы сдали' || workStatus === 'Закрыто';

        let invoiceStatus = '';
        if(e.invoice_received){
          invoiceStatus = '<span class="buh-status got">✓ СФ получена</span>';
        } else if(e.invoice_needed){
          invoiceStatus = '<span class="buh-status need">⏳ Ожидает СФ</span>';
        } else {
          invoiceStatus = '<span class="buh-status none">—</span>';
        }

        // ФОТ детали
        let fotInfo = '';
        if(e.category === 'fot' && e.fot_employee_name){
          fotInfo = `<div class="help" style="margin-top:4px; font-size:11px">
            ${esc(e.fot_employee_name)}: оклад ${money(e.fot_base_pay||0)}, сут. ${money(e.fot_per_diem||0)}, премия ${money(e.fot_bonus||0)}
          </div>`;
        }

        return `
          <tr data-id="${e.id}">
            <td style="white-space:nowrap">${esc(e.date || '—')}</td>
            <td>
              <span class="buh-cat-badge" style="background:${cat.color}22; color:${cat.color}">${cat.icon} ${cat.label}</span>
            </td>
            <td style="font-weight:700; color:var(--gold)">${money(e.amount)} ₽</td>
            <td>
              <div style="font-weight:600">${esc(customerName)}</div>
              <div class="help" style="font-size:11px">${esc(workTitle)}</div>
              ${fotInfo}
            </td>
            <td>
              <span class="buh-work-status ${isClosed ? 'buh-work-closed' : 'buh-work-open'}">${esc(workStatus)}</span>
            </td>
            <td>${esc(e.supplier || '—')}</td>
            <td>${esc(e.doc_number || '—')}</td>
            <td>${invoiceStatus}</td>
            <td>${esc(creator?.name || creator?.login || '—')}</td>
            <td>
              <div class="buh-actions">
                <button class="buh-btn" data-view="${e.id}" title="Просмотр">👁</button>
                ${!isClosed ? `<button class="buh-btn" data-edit="${e.id}" title="Редактировать">✎</button>` : ''}
              </div>
            </td>
          </tr>
        `;
      }).join('');

      $('#buhTable').innerHTML = `
        <table class="buh-table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Категория</th>
              <th>Сумма</th>
              <th>Заказчик / Работа</th>
              <th>Статус работы</th>
              <th>Поставщик</th>
              <th>№ док.</th>
              <th>СФ</th>
              <th>Кто внёс</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        ${expenses.length > 100 ? `<div class="help" style="text-align:center; margin-top:12px">Показано 100 из ${expenses.length} записей. Используйте фильтры для уточнения.</div>` : ''}
      `;

      // Обработчики кнопок
      $$('[data-view]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = Number(btn.dataset.view);
          const exp = allExpenses.find(e => e.id === id);
          if(exp) openViewModal(exp);
        });
      });

      $$('[data-edit]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = Number(btn.dataset.edit);
          const exp = allExpenses.find(e => e.id === id);
          if(exp) openEditModal(exp, () => applyFilters());
        });
      });
    }

    function openViewModal(expense){
      const w = worksMap.get(expense.work_id);
      const t = w ? tendersMap.get(w.tender_id) : null;
      const creator = usersMap.get(expense.created_by);
      const cat = EXPENSE_CATEGORIES.find(c => c.key === expense.category) || EXPENSE_CATEGORIES[7];

      let fotDetails = '';
      if(expense.category === 'fot' && expense.fot_employee_name){
        fotDetails = `
          <hr class="hr"/>
          <div class="help"><b>Детализация ФОТ</b></div>
          <div class="formrow" style="pointer-events:none">
            <div><label>Сотрудник</label><input autocomplete="off" value="${esc(expense.fot_employee_name)}" readonly/></div>
            <div><label>Оклад</label><input autocomplete="off" value="${money(expense.fot_base_pay||0)} ₽" readonly/></div>
            <div><label>Суточные</label><input autocomplete="off" value="${money(expense.fot_per_diem||0)} ₽" readonly/></div>
            <div><label>Премия</label><input autocomplete="off" value="${money(expense.fot_bonus||0)} ₽" readonly/></div>
            <div><label>Период с</label><input autocomplete="off" value="${esc(expense.fot_date_from||'—')}" readonly/></div>
            <div><label>Период по</label><input autocomplete="off" value="${esc(expense.fot_date_to||'—')}" readonly/></div>
          </div>
        `;
      }

      const html = `
        <div class="help">${cat.icon} ${cat.label}</div>
        <hr class="hr"/>
        <div class="formrow" style="pointer-events:none">
          <div><label>Дата</label><input autocomplete="off" value="${esc(expense.date||'—')}" readonly/></div>
          <div><label>Сумма</label><input autocomplete="off" value="${money(expense.amount)} ₽" readonly/></div>
          <div><label>Заказчик</label><input autocomplete="off" value="${esc(w?.company || t?.customer_name || '—')}" readonly/></div>
          <div><label>Работа</label><input autocomplete="off" value="${esc(w?.work_title || t?.tender_title || '—')}" readonly/></div>
          <div><label>Поставщик</label><input autocomplete="off" value="${esc(expense.supplier||'—')}" readonly/></div>
          <div><label>№ документа</label><input autocomplete="off" value="${esc(expense.doc_number||'—')}" readonly/></div>
          <div style="grid-column:1/-1"><label>Комментарий</label><input autocomplete="off" value="${esc(expense.comment||'—')}" readonly/></div>
          <div><label>Нужна СФ</label><input autocomplete="off" value="${expense.invoice_needed ? 'Да' : 'Нет'}" readonly/></div>
          <div><label>СФ получена</label><input autocomplete="off" value="${expense.invoice_received ? 'Да' : 'Нет'}" readonly/></div>
          <div><label>Кто внёс</label><input autocomplete="off" value="${esc(creator?.name || creator?.login || '—')}" readonly/></div>
          <div><label>Создано</label><input autocomplete="off" value="${expense.created_at ? new Date(expense.created_at).toLocaleString('ru-RU') : '—'}" readonly/></div>
        </div>
        ${fotDetails}
      `;

      showModal(`Расход #${expense.id}`, html);
    }

    function openEditModal(expense, onSave){
      const cat = EXPENSE_CATEGORIES.find(c => c.key === expense.category) || EXPENSE_CATEGORIES[7];

      const html = `
        <div class="help">${cat.icon} ${cat.label} — редактирование (только статус СФ)</div>
        <hr class="hr"/>
        <div class="formrow">
          <div><label>Дата</label><input autocomplete="off" value="${esc(expense.date||'')}" readonly style="opacity:.6"/></div>
          <div><label>Сумма</label><input autocomplete="off" value="${money(expense.amount)} ₽" readonly style="opacity:.6"/></div>
          <div><label>Поставщик</label><input autocomplete="off" value="${esc(expense.supplier||'')}" readonly style="opacity:.6"/></div>
          <div><label>№ документа</label><input id="edit_doc" value="${esc(expense.doc_number||'')}"/></div>
        </div>
        <hr class="hr"/>
        <div class="formrow" style="grid-template-columns: repeat(2, auto)">
          <label style="display:flex; gap:8px; align-items:center; cursor:pointer">
            <input type="checkbox" id="edit_inv_need" ${expense.invoice_needed ? 'checked' : ''}/>
            <span>Нужна счёт-фактура</span>
          </label>
          <label style="display:flex; gap:8px; align-items:center; cursor:pointer">
            <input type="checkbox" id="edit_inv_got" ${expense.invoice_received ? 'checked' : ''}/>
            <span>СФ получена</span>
          </label>
        </div>
        <hr class="hr"/>
        <div style="display:flex; gap:10px">
          <button class="btn" id="btnSaveEdit">Сохранить</button>
          <button class="btn ghost" id="btnCancelEdit">Отмена</button>
        </div>
      `;

      showModal(`Редактировать расход #${expense.id}`, html);

      $('#btnCancelEdit')?.addEventListener('click', () => {
        AsgardUI.hideModal();
      });

      $('#btnSaveEdit')?.addEventListener('click', async () => {
        expense.doc_number = $('#edit_doc')?.value?.trim() || '';
        expense.invoice_needed = $('#edit_inv_need')?.checked || false;
        expense.invoice_received = $('#edit_inv_got')?.checked || false;
        expense.updated_at = isoNow();

        await AsgardDB.put('work_expenses', expense);
        toast('Расход', 'Обновлено');
        AsgardUI.hideModal();
        if(onSave) onSave();
      });
    }

    // Экспорт CSV
    function exportCSV(expenses){
      const headers = ['Дата', 'Категория', 'Сумма', 'Заказчик', 'Работа', 'Статус работы', 'Поставщик', '№ документа', 'Комментарий', 'Нужна СФ', 'СФ получена', 'Кто внёс'];
      
      const rows = expenses.map(e => {
        const w = worksMap.get(e.work_id);
        const t = w ? tendersMap.get(w.tender_id) : null;
        const creator = usersMap.get(e.created_by);
        const cat = EXPENSE_CATEGORIES.find(c => c.key === e.category) || EXPENSE_CATEGORIES[7];

        return [
          e.date || '',
          cat.label,
          e.amount || 0,
          w?.company || t?.customer_name || '',
          w?.work_title || t?.tender_title || '',
          w?.work_status || '',
          e.supplier || '',
          e.doc_number || '',
          e.comment || '',
          e.invoice_needed ? 'Да' : 'Нет',
          e.invoice_received ? 'Да' : 'Нет',
          creator?.name || creator?.login || ''
        ];
      });

      const csvContent = [headers, ...rows]
        .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
        .join('\n');

      const BOM = '\uFEFF';
      const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `expenses_${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Экспорт', 'CSV файл скачан');
    }

    // Обработчики
    $('#btnApplyFilter')?.addEventListener('click', applyFilters);
    
    // Фильтры при изменении
    ['f_year', 'f_month', 'f_customer', 'f_creator', 'f_category', 'f_invoice'].forEach(id => {
      $('#' + id)?.addEventListener('change', applyFilters);
    });

    $('#btnExportCSV')?.addEventListener('click', () => {
      // Применяем текущие фильтры для экспорта
      const fYear = $('#f_year').value;
      const fMonth = $('#f_month').value;
      const fCustomer = $('#f_customer').value;
      const fCreator = $('#f_creator').value;
      const fCategory = $('#f_category').value;
      const fInvoice = $('#f_invoice').value;

      let filtered = allExpenses.slice();
      if(fYear) filtered = filtered.filter(e => e.date && new Date(e.date).getFullYear() === Number(fYear));
      if(fMonth) filtered = filtered.filter(e => e.date && new Date(e.date).getMonth() + 1 === Number(fMonth));
      if(fCustomer) filtered = filtered.filter(e => {
        const w = worksMap.get(e.work_id);
        const t = w ? tendersMap.get(w.tender_id) : null;
        return (w?.company || t?.customer_name) === fCustomer;
      });
      if(fCreator) filtered = filtered.filter(e => String(e.created_by) === fCreator);
      if(fCategory) filtered = filtered.filter(e => e.category === fCategory);
      if(fInvoice === 'need') filtered = filtered.filter(e => e.invoice_needed && !e.invoice_received);
      else if(fInvoice === 'got') filtered = filtered.filter(e => e.invoice_received);
      else if(fInvoice === 'none') filtered = filtered.filter(e => !e.invoice_needed);

      filtered.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      exportCSV(filtered);
    });

    // Первоначальная загрузка
    applyFilters();
  }

  return { render };
})();
