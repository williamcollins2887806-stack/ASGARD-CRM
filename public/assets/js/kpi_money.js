// Stage 25: KPI Деньги — реальные источники данных
// Расходы: work_expenses + office_expenses + travel_expenses
// Поступления: incomes store
// RBAC: DIRECTOR_*/ADMIN — всё, BUH — всё, OFFICE_MANAGER — офис+travel, PM — свои

window.AsgardKpiMoneyPage = (function(){
  const { $, $$, esc, toast, showModal } = AsgardUI;

  // === Константы ===
  const MONTHS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  const DIRECTOR_ROLES = ['DIRECTOR_COMM', 'DIRECTOR_GEN', 'DIRECTOR_DEV'];
  
  const EXPENSE_CATEGORIES = {
    fot: { label: 'ФОТ', color: '#3b82f6' },
    materials: { label: 'Материалы', color: '#22c55e' },
    chemistry: { label: 'Химия', color: '#f59e0b' },
    equipment: { label: 'Оборудование', color: '#8b5cf6' },
    transport: { label: 'Транспорт', color: '#ef4444' },
    accommodation: { label: 'Проживание', color: '#06b6d4' },
    tickets: { label: 'Билеты', color: '#ec4899' },
    daily: { label: 'Суточные', color: '#84cc16' },
    office: { label: 'Офис', color: '#f97316' },
    other: { label: 'Прочее', color: '#64748b' }
  };

  const INCOME_TYPES = {
    advance: { label: 'Аванс', color: '#22c55e' },
    postpay: { label: 'Постоплата', color: '#3b82f6' },
    other: { label: 'Прочее', color: '#f59e0b' }
  };

  // === Утилиты ===
  function money(x){ 
    if(x===null||x===undefined||x==="") return "—"; 
    const n=Number(x); 
    if(isNaN(n)) return esc(String(x)); 
    return n.toLocaleString("ru-RU") + ' ₽'; 
  }

  function isoNow(){ return new Date().toISOString(); }

  function isDirector(user){
    if(!user) return false;
    if(user.role === 'ADMIN') return true;
    if(DIRECTOR_ROLES.includes(user.role)) return true;
    if(Array.isArray(user.roles)){
      return user.roles.some(r => DIRECTOR_ROLES.includes(r) || r === 'ADMIN');
    }
    return false;
  }

  function isBuh(user){
    if(!user) return false;
    return user.role === 'BUH' || user.role === 'ACCOUNTANT' || 
           (Array.isArray(user.roles) && (user.roles.includes('BUH') || user.roles.includes('ACCOUNTANT')));
  }

  function isOfficeManager(user){
    if(!user) return false;
    return user.role === 'OFFICE_MANAGER' || 
           (Array.isArray(user.roles) && user.roles.includes('OFFICE_MANAGER'));
  }

  function isPM(user){
    if(!user) return false;
    return user.role === 'PM' || 
           (Array.isArray(user.roles) && user.roles.includes('PM'));
  }

  function getMonth(dateStr){
    if(!dateStr) return null;
    const m = String(dateStr).match(/^(\d{4})-(\d{2})/);
    return m ? parseInt(m[2], 10) : null;
  }

  function getYear(dateStr){
    if(!dateStr) return null;
    const m = String(dateStr).match(/^(\d{4})/);
    return m ? parseInt(m[1], 10) : null;
  }

  // === Загрузка данных ===
  async function loadAllExpenses(year, user){
    const [workExp, officeExp, travelExp, works] = await Promise.all([
      AsgardDB.all('work_expenses'),
      AsgardDB.all('office_expenses'),
      AsgardDB.all('travel_expenses'),
      AsgardDB.all('works')
    ]);

    const worksMap = new Map(works.map(w => [w.id, w]));
    const allExpenses = [];

    const filterYear = (date) => getYear(date) === year;

    const shouldCount = (exp) => {
      if(exp.requires_approval && exp.approval_status !== 'approved') return false;
      if(exp.status === 'rejected' || exp.status === 'rework') return false;
      return true;
    };

    // Work expenses
    for(const exp of workExp){
      if(!filterYear(exp.date) || !shouldCount(exp)) continue;
      const work = worksMap.get(exp.work_id);
      
      if(isPM(user) && !isDirector(user) && !isBuh(user)){
        if(!work || work.pm_id !== user.id) continue;
      }

      allExpenses.push({
        source: 'work',
        id: exp.id,
        date: exp.date,
        category: exp.category || 'other',
        amount: Number(exp.amount) || 0,
        counterparty: work?.customer_name || '—',
        work_id: exp.work_id,
        work_name: work ? `${work.customer_name} — ${work.title || ''}` : `Работа #${exp.work_id}`,
        comment: exp.comment || '',
        status: exp.approval_status || exp.status || 'approved',
        created_by: exp.created_by
      });
    }

    // Office expenses
    if(isDirector(user) || isBuh(user) || isOfficeManager(user)){
      for(const exp of officeExp){
        if(!filterYear(exp.date) || !shouldCount(exp)) continue;
        allExpenses.push({
          source: 'office',
          id: exp.id,
          date: exp.date,
          category: exp.category || 'office',
          amount: Number(exp.amount) || 0,
          counterparty: exp.vendor || 'Офис',
          work_id: null,
          work_name: 'Офисные расходы',
          comment: exp.description || exp.comment || '',
          status: exp.status || 'approved',
          created_by: exp.created_by
        });
      }
    }

    // Travel expenses
    if(isDirector(user) || isBuh(user) || isOfficeManager(user)){
      for(const exp of travelExp){
        if(!filterYear(exp.date) || !shouldCount(exp)) continue;
        const work = exp.work_id ? worksMap.get(exp.work_id) : null;
        
        if(isPM(user) && !isDirector(user) && !isBuh(user) && !isOfficeManager(user)){
          if(work && work.pm_id !== user.id) continue;
        }

        allExpenses.push({
          source: 'travel',
          id: exp.id,
          date: exp.date,
          category: exp.expense_type === 'accommodation' ? 'accommodation' : 'tickets',
          amount: Number(exp.amount) || 0,
          counterparty: exp.provider || work?.customer_name || '—',
          work_id: exp.work_id,
          work_name: work ? `${work.customer_name}` : (exp.work_id ? `Работа #${exp.work_id}` : 'Командировка'),
          comment: exp.comment || '',
          status: exp.status || 'approved',
          created_by: exp.created_by
        });
      }
    }

    return allExpenses;
  }

  async function loadAllIncomes(year, user){
    const [incomes, works] = await Promise.all([
      AsgardDB.all('incomes'),
      AsgardDB.all('works')
    ]);

    const worksMap = new Map(works.map(w => [w.id, w]));
    const result = [];

    for(const inc of incomes){
      if(getYear(inc.date) !== year) continue;
      
      const work = inc.work_id ? worksMap.get(inc.work_id) : null;

      if(isPM(user) && !isDirector(user) && !isBuh(user)){
        if(work && work.pm_id !== user.id) continue;
        if(!work && !isOfficeManager(user)) continue;
      }

      result.push({
        id: inc.id,
        date: inc.date,
        type: inc.type || 'other',
        amount: Number(inc.amount) || 0,
        counterparty: inc.counterparty || work?.customer_name || '—',
        work_id: inc.work_id,
        work_name: work ? `${work.customer_name} — ${work.title || ''}` : (inc.counterparty || '—'),
        comment: inc.comment || '',
        confirmed: inc.confirmed !== false,
        created_by: inc.created_by
      });
    }

    return result;
  }

  function aggregateByMonth(items, year){
    const monthly = {};
    for(let m = 1; m <= 12; m++) monthly[m] = 0;

    for(const item of items){
      const month = getMonth(item.date);
      if(month && monthly[month] !== undefined){
        monthly[month] += item.amount;
      }
    }

    return monthly;
  }

  function aggregateByCategory(items, categoryField = 'category'){
    const byCategory = {};
    for(const item of items){
      const cat = item[categoryField] || 'other';
      byCategory[cat] = (byCategory[cat] || 0) + item.amount;
    }
    return byCategory;
  }

  async function render({layout, title}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash = "#/welcome"; return; }
    const user = auth.user;

    const canView = isDirector(user) || isBuh(user) || isOfficeManager(user) || isPM(user);
    if(!canView){
      toast("Доступ", "Раздел недоступен для вашей роли", "err");
      location.hash = "#/welcome";
      return;
    }

    const currentYear = new Date().getFullYear();
    let selectedYear = currentYear;
    let mode = 'expenses';
    let cache = {};

    async function loadData(year){
      if(cache[year]) return cache[year];
      const [expenses, incomes] = await Promise.all([
        loadAllExpenses(year, user),
        loadAllIncomes(year, user)
      ]);
      cache[year] = { expenses, incomes };
      return cache[year];
    }

    const body = `
      <div class="page-card">
        <div class="row" style="gap:15px; flex-wrap:wrap; align-items:center; margin-bottom:20px">
          <div class="tabs" id="modeTabs">
            <button class="tab active" data-mode="expenses">💸 Расходы</button>
            <button class="tab" data-mode="incomes">💰 Поступления</button>
          </div>
          <div style="flex:1"></div>
          <select id="yearSelect" style="padding:8px 16px; border-radius:8px; background:var(--card); border:1px solid var(--border); color:var(--text)">
            ${[currentYear, currentYear-1, currentYear-2].map(y => 
              `<option value="${y}" ${y===selectedYear?'selected':''}>${y}</option>`
            ).join('')}
          </select>
          ${(isDirector(user) || isBuh(user)) ? `
            <button class="btn" id="btnAddIncome">+ Поступление</button>
          ` : ''}
        </div>

        <div id="chartContainer" style="height:300px; margin-bottom:20px"></div>

        <div id="summaryCards" class="kpi-cards"></div>

        <div class="help" style="margin-top:15px; text-align:center">
          Клик по столбцу месяца → детализация
        </div>
      </div>
    `;

    await layout(body, { title: title || 'KPI • Деньги' });

    const style = document.createElement('style');
    style.textContent = `
      .tabs { display: flex; gap: 0; background: var(--card); border-radius: 10px; overflow: hidden; border: 1px solid var(--border); }
      .tabs .tab { padding: 10px 20px; border: none; background: transparent; color: var(--muted); cursor: pointer; font-weight: 600; transition: all 0.2s; }
      .tabs .tab.active { background: var(--gold); color: var(--bg); }
      .tabs .tab:hover:not(.active) { background: rgba(212,175,55,0.1); }
      .kpi-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 15px; }
      .kpi-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; text-align: center; }
      .kpi-card .label { font-size: 12px; color: var(--muted); margin-bottom: 5px; }
      .kpi-card .value { font-size: 24px; font-weight: 700; color: var(--gold); }
      .kpi-card .sub { font-size: 11px; color: var(--muted); margin-top: 5px; }
      .chart-bar { cursor: pointer; transition: opacity 0.2s; }
      .chart-bar:hover { opacity: 0.8; }
    `;
    document.head.appendChild(style);

    async function renderChart(){
      const data = await loadData(selectedYear);
      const items = mode === 'expenses' ? data.expenses : data.incomes;
      const monthly = aggregateByMonth(items, selectedYear);

      const container = $('#chartContainer');
      const maxVal = Math.max(...Object.values(monthly), 1);

      let html = `<svg viewBox="0 0 1000 280" style="width:100%; height:100%">`;
      
      for(let i = 0; i <= 4; i++){
        const y = 250 - (i * 50);
        const val = Math.round(maxVal * i / 4);
        html += `<line x1="50" y1="${y}" x2="980" y2="${y}" stroke="rgba(255,255,255,0.1)" stroke-dasharray="4"/>`;
        html += `<text x="45" y="${y+4}" fill="#94a3b8" font-size="11" text-anchor="end">${(val/1000000).toFixed(1)}М</text>`;
      }

      for(let m = 1; m <= 12; m++){
        const val = monthly[m];
        const h = maxVal > 0 ? (val / maxVal) * 200 : 0;
        const x = 50 + (m - 1) * 77 + 10;
        const y = 250 - h;
        const color = mode === 'expenses' ? '#ef4444' : '#22c55e';

        html += `<rect class="chart-bar" data-month="${m}" x="${x}" y="${y}" width="55" height="${h}" fill="${color}" rx="4"/>`;
        html += `<text x="${x + 27}" y="270" fill="#94a3b8" font-size="12" text-anchor="middle">${MONTHS[m-1]}</text>`;
        
        if(val > 0){
          html += `<text x="${x + 27}" y="${y - 8}" fill="white" font-size="11" text-anchor="middle">${(val/1000).toFixed(0)}К</text>`;
        }
      }

      html += `</svg>`;
      container.innerHTML = html;

      container.querySelectorAll('.chart-bar').forEach(bar => {
        bar.addEventListener('click', () => {
          const month = parseInt(bar.dataset.month);
          openMonthModal(month, selectedYear, data, mode);
        });
      });

      const total = Object.values(monthly).reduce((a, b) => a + b, 0);
      const avgMonth = total / 12;
      const maxMonth = Math.max(...Object.values(monthly));
      const maxMonthIdx = Object.entries(monthly).find(([k, v]) => v === maxMonth)?.[0];

      const cardsHtml = `
        <div class="kpi-card">
          <div class="label">${mode === 'expenses' ? 'Всего расходов' : 'Всего поступлений'}</div>
          <div class="value">${money(total)}</div>
          <div class="sub">за ${selectedYear} год</div>
        </div>
        <div class="kpi-card">
          <div class="label">Среднее в месяц</div>
          <div class="value">${money(avgMonth)}</div>
        </div>
        <div class="kpi-card">
          <div class="label">Максимум</div>
          <div class="value">${money(maxMonth)}</div>
          <div class="sub">${MONTHS[maxMonthIdx - 1] || ''}</div>
        </div>
        <div class="kpi-card">
          <div class="label">Операций</div>
          <div class="value">${items.length}</div>
        </div>
      `;
      $('#summaryCards').innerHTML = cardsHtml;
    }

    function openMonthModal(month, year, data, mode){
      const items = mode === 'expenses' ? data.expenses : data.incomes;
      const monthItems = items.filter(i => getMonth(i.date) === month);
      
      const total = monthItems.reduce((a, b) => a + b.amount, 0);
      const categoryField = mode === 'expenses' ? 'category' : 'type';
      const byCategory = aggregateByCategory(monthItems, categoryField);
      const categories = mode === 'expenses' ? EXPENSE_CATEGORIES : INCOME_TYPES;

      const pieData = Object.entries(byCategory)
        .filter(([k, v]) => v > 0)
        .sort((a, b) => b[1] - a[1]);

      let pieHtml = '';
      if(pieData.length > 0){
        let startAngle = 0;
        pieHtml = `<svg viewBox="0 0 200 200" style="width:200px; height:200px">`;
        for(const [cat, amount] of pieData){
          const angle = (amount / total) * 360;
          const endAngle = startAngle + angle;
          const catInfo = categories[cat] || { color: '#64748b', label: cat };
          
          const largeArc = angle > 180 ? 1 : 0;
          const x1 = 100 + 80 * Math.cos((startAngle - 90) * Math.PI / 180);
          const y1 = 100 + 80 * Math.sin((startAngle - 90) * Math.PI / 180);
          const x2 = 100 + 80 * Math.cos((endAngle - 90) * Math.PI / 180);
          const y2 = 100 + 80 * Math.sin((endAngle - 90) * Math.PI / 180);
          
          pieHtml += `<path d="M100,100 L${x1},${y1} A80,80 0 ${largeArc},1 ${x2},${y2} Z" fill="${catInfo.color}" opacity="0.8"/>`;
          startAngle = endAngle;
        }
        pieHtml += `</svg>`;
      }

      const legendHtml = pieData.map(([cat, amount]) => {
        const catInfo = categories[cat] || { color: '#64748b', label: cat };
        const pct = total > 0 ? ((amount / total) * 100).toFixed(1) : 0;
        return `
          <div style="display:flex; align-items:center; gap:8px; margin:4px 0">
            <span style="width:12px; height:12px; border-radius:2px; background:${catInfo.color}"></span>
            <span style="flex:1">${catInfo.label}</span>
            <span style="font-weight:600">${pct}%</span>
            <span style="color:var(--muted); font-size:12px">${money(amount)}</span>
          </div>
        `;
      }).join('');

      const tableHtml = monthItems.length > 0 ? `
        <div style="max-height:300px; overflow:auto; margin-top:20px">
          <table class="asg" style="font-size:13px">
            <thead>
              <tr>
                <th>Дата</th>
                <th>${mode === 'expenses' ? 'Категория' : 'Тип'}</th>
                <th>Проект/Контрагент</th>
                <th>Сумма</th>
                <th>Комментарий</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              ${monthItems.map(item => {
                const catInfo = categories[item[categoryField]] || { label: item[categoryField], color: '#64748b' };
                return `
                  <tr>
                    <td>${item.date || '—'}</td>
                    <td><span style="display:inline-block; width:8px; height:8px; border-radius:2px; background:${catInfo.color}; margin-right:6px"></span>${catInfo.label}</td>
                    <td>${esc(item.work_name || item.counterparty || '—')}</td>
                    <td style="font-weight:600; color:${mode === 'expenses' ? '#ef4444' : '#22c55e'}">${money(item.amount)}</td>
                    <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${esc(item.comment || '—')}</td>
                    <td>${item.status === 'approved' || item.confirmed ? '✓' : item.status || '—'}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      ` : '<div class="help" style="text-align:center; padding:20px">Нет операций за этот месяц</div>';

      const html = `
        <div style="display:flex; gap:30px; flex-wrap:wrap">
          <div style="flex:1; min-width:200px">
            <h4 style="margin:0 0 10px; color:var(--gold)">${mode === 'expenses' ? '📊 Расходы по категориям' : '📊 Поступления по типам'}</h4>
            ${pieHtml}
          </div>
          <div style="flex:1; min-width:200px">
            <h4 style="margin:0 0 10px; color:var(--gold)">Детализация</h4>
            ${legendHtml}
            <hr style="margin:15px 0; border-color:var(--border)"/>
            <div style="font-size:18px; font-weight:700; color:var(--gold)">Итого: ${money(total)}</div>
          </div>
        </div>
        ${tableHtml}
      `;

      showModal(`${MONTHS[month - 1]} ${year} — ${mode === 'expenses' ? 'Расходы' : 'Поступления'}`, html);
    }

    function openAddIncomeModal(){
      const html = `
        <div class="formrow">
          <div>
            <label>Дата</label>
            <input type="date" id="inc_date" value="${new Date().toISOString().slice(0,10)}"/>
          </div>
          <div>
            <label>Тип</label>
            <select id="inc_type">
              <option value="advance">Аванс</option>
              <option value="postpay">Постоплата</option>
              <option value="other">Прочее</option>
            </select>
          </div>
          <div>
            <label>Сумма, ₽</label>
            <input type="number" id="inc_amount" min="0" step="0.01" placeholder="0"/>
          </div>
        </div>
        <div class="formrow">
          <div>
            <label>Контрагент</label>
            <input id="inc_counterparty" placeholder="ООО Рога и Копыта"/>
          </div>
          <div>
            <label>Работа (опционально)</label>
            <select id="inc_work">
              <option value="">— Не привязано —</option>
            </select>
          </div>
        </div>
        <div class="formrow">
          <div style="grid-column:1/-1">
            <label>Комментарий</label>
            <input id="inc_comment" placeholder="Примечание..."/>
          </div>
        </div>
        <hr class="hr"/>
        <button class="btn primary" id="btnSaveIncome">💾 Сохранить</button>
      `;

      showModal('Добавить поступление', html);

      AsgardDB.all('works').then(works => {
        const select = $('#inc_work');
        works.forEach(w => {
          const opt = document.createElement('option');
          opt.value = w.id;
          opt.textContent = `#${w.id} ${w.customer_name || ''} — ${w.title || ''}`.slice(0, 60);
          select.appendChild(opt);
        });
      });

      $('#btnSaveIncome')?.addEventListener('click', async () => {
        const amount = parseFloat($('#inc_amount')?.value);
        if(!amount || amount <= 0){
          toast('Ошибка', 'Укажите сумму', 'err');
          return;
        }

        const income = {
          date: $('#inc_date')?.value || new Date().toISOString().slice(0,10),
          type: $('#inc_type')?.value || 'other',
          amount: amount,
          counterparty: $('#inc_counterparty')?.value?.trim() || '',
          work_id: $('#inc_work')?.value ? parseInt($('#inc_work').value) : null,
          comment: $('#inc_comment')?.value?.trim() || '',
          confirmed: true,
          created_by: user.id,
          created_at: isoNow()
        };

        await AsgardDB.add('incomes', income);
        delete cache[selectedYear];
        
        toast('Поступление', 'Добавлено');
        AsgardUI.hideModal();
        renderChart();
      });
    }

    $('#modeTabs')?.addEventListener('click', (e) => {
      if(e.target.classList.contains('tab')){
        $$('#modeTabs .tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        mode = e.target.dataset.mode;
        renderChart();
      }
    });

    $('#yearSelect')?.addEventListener('change', (e) => {
      selectedYear = parseInt(e.target.value);
      renderChart();
    });

    $('#btnAddIncome')?.addEventListener('click', openAddIncomeModal);

    renderChart();
  }

  return { render };
})();
