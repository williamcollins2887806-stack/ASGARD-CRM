// Stage 12: Финансовая аналитика (Расходы/Поступления) — как в Сбере/МТС
window.AsgardFinancesPage = (function(){
  const { $, $$, esc, toast, showModal } = AsgardUI;

  const MONTHS_SHORT = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  const MONTHS_FULL = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

  // Категории расходов по работам
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

  // Категории офисных расходов
  const OFFICE_EXPENSE_CATEGORIES = [
    { key: 'rent', label: 'Аренда офиса', color: '#ef4444', icon: '🏢' },
    { key: 'utilities', label: 'Коммунальные', color: '#f59e0b', icon: '💡' },
    { key: 'office_supplies', label: 'Канцелярия', color: '#8b5cf6', icon: '📎' },
    { key: 'communication', label: 'Связь и интернет', color: '#06b6d4', icon: '📡' },
    { key: 'transport', label: 'Транспорт/такси', color: '#22c55e', icon: '🚕' },
    { key: 'household', label: 'Хозтовары', color: '#3b82f6', icon: '🧹' },
    { key: 'office_equipment', label: 'Оборудование офиса', color: '#ec4899', icon: '🖥️' },
    { key: 'software', label: 'ПО и подписки', color: '#a855f7', icon: '💿' },
    { key: 'representation', label: 'Представительские', color: '#14b8a6', icon: '🎁' },
    { key: 'other_office', label: 'Прочее', color: '#64748b', icon: '📦' }
  ];

  function money(x){ 
    if(x===null||x===undefined||x==="") return "0"; 
    const n=Number(x); 
    if(isNaN(n)) return "0"; 
    return n.toLocaleString("ru-RU"); 
  }

  function moneyShort(x){
    const n = Number(x||0);
    if(n >= 1000000) return (n/1000000).toFixed(1).replace('.0','') + 'М';
    if(n >= 1000) return (n/1000).toFixed(0) + 'К';
    return n.toFixed(0);
  }

  async function render({layout, title}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }
    const user = auth.user;

    // Проверка роли (директора, BUH, ADMIN)
    const isDirRole = (r)=> r==="ADMIN" || r==="BUH" || String(r||"").startsWith("DIRECTOR");
    if(!isDirRole(user.role)){
      toast("Доступ","Раздел доступен директорам и бухгалтерии","err");
      location.hash="#/home";
      return;
    }

    const currentYear = new Date().getFullYear();
    let selectedYear = currentYear;
    let mode = 'expenses'; // 'expenses' или 'income'
    let selectedMonth = null; // null = обзор года, 0-11 = конкретный месяц

    const works = await AsgardDB.all("works");
    const tenders = await AsgardDB.all("tenders");

    // Собираем данные по расходам и доходам
    function collectData(year){
      const data = {
        expenses: { months: Array(12).fill(0), categories: {}, byMonth: [] },
        income: { months: Array(12).fill(0), categories: {}, byMonth: [] }
      };

      // Инициализация категорий
      EXPENSE_CATEGORIES.forEach(c => { data.expenses.categories[c.key] = 0; });
      for(let i=0; i<12; i++){
        data.expenses.byMonth[i] = {};
        EXPENSE_CATEGORIES.forEach(c => { data.expenses.byMonth[i][c.key] = 0; });
      }

      // Собираем данные по работам
      works.forEach(w => {
        const t = tenders.find(x => x.id === w.tender_id);
        
        // Доходы (поступления) — по дате получения аванса или остатка
        const advanceDate = w.advance_date_fact ? new Date(w.advance_date_fact) : null;
        const paymentDate = w.payment_date_fact ? new Date(w.payment_date_fact) : null;
        
        if(advanceDate && advanceDate.getFullYear() === year){
          const m = advanceDate.getMonth();
          data.income.months[m] += Number(w.advance_received || 0);
        }
        if(paymentDate && paymentDate.getFullYear() === year){
          const m = paymentDate.getMonth();
          data.income.months[m] += Number(w.balance_received || 0);
        }

        // Расходы — по факт.себестоимости, распределяем по месяцу начала работ
        const startDate = w.start_in_work_date ? new Date(w.start_in_work_date) : 
                         (t?.work_start_plan ? new Date(t.work_start_plan) : null);
        
        if(startDate && startDate.getFullYear() === year){
          const m = startDate.getMonth();
          const cost = Number(w.cost_fact || w.cost_plan || 0);
          data.expenses.months[m] += cost;
          
          // Распределяем по категориям (пока упрощённо — всё в ФОТ)
          // В будущем здесь будут реальные данные из expenses store
          data.expenses.byMonth[m]['fot'] += cost * 0.5;
          data.expenses.byMonth[m]['logistics'] += cost * 0.15;
          data.expenses.byMonth[m]['accommodation'] += cost * 0.1;
          data.expenses.byMonth[m]['chemicals'] += cost * 0.1;
          data.expenses.byMonth[m]['equipment'] += cost * 0.05;
          data.expenses.byMonth[m]['other'] += cost * 0.1;
        }
      });

      // Суммируем категории за год
      for(let i=0; i<12; i++){
        EXPENSE_CATEGORIES.forEach(c => {
          data.expenses.categories[c.key] += data.expenses.byMonth[i][c.key];
        });
      }

      return data;
    }

    function renderPage(){
      const data = collectData(selectedYear);
      const currentData = mode === 'expenses' ? data.expenses : data.income;
      const totalYear = currentData.months.reduce((a,b) => a+b, 0);
      const maxMonth = Math.max(...currentData.months, 1);

      const body = `
        <style>
          .fin-header { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:20px; }
          .fin-tabs { display:flex; gap:4px; background:rgba(13,20,40,.6); padding:4px; border-radius:14px; }
          .fin-tab { padding:10px 20px; border-radius:12px; border:none; background:transparent; color:var(--muted); font-weight:700; cursor:pointer; transition:all .2s; }
          .fin-tab:hover { color:var(--text); }
          .fin-tab.active { background:linear-gradient(135deg, rgba(59,130,246,.3), rgba(220,38,38,.2)); color:var(--text); }
          .fin-year-nav { display:flex; align-items:center; gap:12px; }
          .fin-year { font-size:28px; font-weight:900; color:var(--gold); min-width:100px; text-align:center; }
          .fin-arrow { width:40px; height:40px; border-radius:12px; border:1px solid var(--line); background:var(--glass); color:var(--text); font-size:18px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all .2s; }
          .fin-arrow:hover { border-color:var(--gold); background:rgba(242,208,138,.1); }
          .fin-arrow:disabled { opacity:.3; cursor:not-allowed; }
          
          .fin-summary { display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:16px; margin-bottom:24px; }
          .fin-card { background:rgba(13,20,40,.5); border:1px solid var(--line); border-radius:18px; padding:20px; }
          .fin-card-label { font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:1px; margin-bottom:8px; }
          .fin-card-value { font-size:32px; font-weight:900; color:var(--gold); }
          .fin-card-sub { font-size:13px; color:var(--muted); margin-top:4px; }
          
          .fin-chart-container { background:rgba(13,20,40,.4); border:1px solid var(--line); border-radius:20px; padding:24px; margin-bottom:24px; }
          .fin-chart-title { font-size:16px; font-weight:800; margin-bottom:20px; display:flex; align-items:center; gap:10px; }
          .fin-chart-title .back-btn { padding:6px 12px; border-radius:8px; border:1px solid var(--line); background:var(--glass); color:var(--text); font-size:12px; cursor:pointer; }
          .fin-chart-title .back-btn:hover { border-color:var(--gold); }
          
          .fin-bars { display:flex; align-items:flex-end; justify-content:space-between; height:220px; gap:8px; padding:0 10px; }
          .fin-bar-wrap { flex:1; display:flex; flex-direction:column; align-items:center; gap:8px; cursor:pointer; transition:all .2s; }
          .fin-bar-wrap:hover { transform:translateY(-4px); }
          .fin-bar-wrap:hover .fin-bar { filter:brightness(1.2); }
          .fin-bar { width:100%; max-width:50px; border-radius:8px 8px 4px 4px; transition:all .3s ease; position:relative; }
          .fin-bar-value { position:absolute; top:-24px; left:50%; transform:translateX(-50%); font-size:11px; font-weight:700; color:var(--text); white-space:nowrap; opacity:0; transition:opacity .2s; }
          .fin-bar-wrap:hover .fin-bar-value { opacity:1; }
          .fin-bar-label { font-size:11px; color:var(--muted); font-weight:600; }
          
          .fin-pie-container { display:flex; gap:24px; align-items:center; flex-wrap:wrap; }
          .fin-pie { width:200px; height:200px; position:relative; }
          .fin-pie-center { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); text-align:center; }
          .fin-pie-total { font-size:18px; font-weight:900; color:var(--gold); }
          .fin-pie-label { font-size:11px; color:var(--muted); }
          
          .fin-legend { flex:1; min-width:280px; }
          .fin-legend-item { display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid rgba(255,255,255,.05); }
          .fin-legend-item:last-child { border-bottom:none; }
          .fin-legend-color { width:12px; height:12px; border-radius:4px; flex-shrink:0; }
          .fin-legend-icon { font-size:18px; }
          .fin-legend-label { flex:1; font-size:13px; color:var(--text); }
          .fin-legend-value { font-size:14px; font-weight:700; color:var(--gold); }
          .fin-legend-pct { font-size:12px; color:var(--muted); margin-left:8px; }

          .fin-month-detail { margin-top:20px; }
          .fin-month-title { font-size:20px; font-weight:900; color:var(--text); margin-bottom:16px; }
        </style>

        <div class="panel">
          <div class="fin-header">
            <div class="fin-tabs">
              <button class="fin-tab ${mode==='expenses'?'active':''}" data-mode="expenses">📤 Расходы</button>
              <button class="fin-tab ${mode==='income'?'active':''}" data-mode="income">📥 Поступления</button>
              <button class="btn ghost" id="btnImportBank" style="margin-left:auto">📄 Импорт выписки</button>
            </div>
            <div class="fin-year-nav">
              <button class="fin-arrow" id="prevYear" ${selectedYear <= 2020 ? 'disabled' : ''}>◀</button>
              <div class="fin-year">${selectedYear}</div>
              <button class="fin-arrow" id="nextYear" ${selectedYear >= currentYear ? 'disabled' : ''}>▶</button>
            </div>
          </div>

          <div class="fin-summary">
            <div class="fin-card">
              <div class="fin-card-label">${mode==='expenses'?'Расходы за год':'Поступления за год'}</div>
              <div class="fin-card-value">${money(Math.round(totalYear))} ₽</div>
              <div class="fin-card-sub">${selectedYear} год</div>
            </div>
            <div class="fin-card">
              <div class="fin-card-label">Среднее в месяц</div>
              <div class="fin-card-value">${money(Math.round(totalYear/12))} ₽</div>
              <div class="fin-card-sub">за ${selectedYear}</div>
            </div>
            <div class="fin-card">
              <div class="fin-card-label">Максимум</div>
              <div class="fin-card-value">${money(Math.round(maxMonth))} ₽</div>
              <div class="fin-card-sub">${MONTHS_SHORT[currentData.months.indexOf(maxMonth)]} ${selectedYear}</div>
            </div>
          </div>

          ${selectedMonth === null ? renderYearChart(currentData, maxMonth) : renderMonthDetail(data, selectedMonth)}
        </div>
      `;

      layout(body, {title: title || "Деньги • Аналитика"}).then(bindEvents);
    }

    function renderYearChart(currentData, maxMonth){
      const barColor = mode === 'expenses' ? 
        'linear-gradient(180deg, #ef4444, #dc2626)' : 
        'linear-gradient(180deg, #22c55e, #16a34a)';

      return `
        <div class="fin-chart-container">
          <div class="fin-chart-title">
            ${mode==='expenses'?'📊 Расходы по месяцам':'📊 Поступления по месяцам'}
            <span class="help" style="margin-left:auto">Нажмите на столбик для детализации</span>
          </div>
          <div class="fin-bars">
            ${currentData.months.map((val, i) => {
              const h = maxMonth > 0 ? Math.max(4, (val / maxMonth) * 180) : 4;
              return `
                <div class="fin-bar-wrap" data-month="${i}">
                  <div class="fin-bar" style="height:${h}px; background:${barColor};">
                    <div class="fin-bar-value">${moneyShort(val)}</div>
                  </div>
                  <div class="fin-bar-label">${MONTHS_SHORT[i]}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        ${mode === 'expenses' ? renderCategoriesPie(currentData) : ''}
      `;
    }

    function renderCategoriesPie(currentData){
      const total = Object.values(currentData.categories).reduce((a,b) => a+b, 0);
      if(total === 0) return '<div class="help">Нет данных по категориям расходов.</div>';

      // SVG круговая диаграмма
      let currentAngle = 0;
      const segments = EXPENSE_CATEGORIES.filter(c => currentData.categories[c.key] > 0).map(c => {
        const value = currentData.categories[c.key];
        const pct = value / total;
        const angle = pct * 360;
        const startAngle = currentAngle;
        currentAngle += angle;
        return { ...c, value, pct, startAngle, angle };
      });

      function polarToCartesian(cx, cy, r, angle){
        const rad = (angle - 90) * Math.PI / 180;
        return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
      }

      function describeArc(cx, cy, r, startAngle, endAngle){
        const start = polarToCartesian(cx, cy, r, endAngle);
        const end = polarToCartesian(cx, cy, r, startAngle);
        const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
        return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
      }

      const svgPaths = segments.map(s => {
        if(s.angle >= 359.9){
          // Полный круг
          return `<circle cx="100" cy="100" r="80" fill="none" stroke="${s.color}" stroke-width="32"/>`;
        }
        return `<path d="${describeArc(100, 100, 80, s.startAngle, s.startAngle + s.angle)}" 
                      fill="none" stroke="${s.color}" stroke-width="32" stroke-linecap="butt"/>`;
      }).join('');

      return `
        <div class="fin-chart-container">
          <div class="fin-chart-title">📈 Структура расходов за ${selectedYear}</div>
          <div class="fin-pie-container">
            <div class="fin-pie">
              <svg viewBox="0 0 200 200" style="transform:rotate(-90deg)">
                ${svgPaths}
              </svg>
              <div class="fin-pie-center">
                <div class="fin-pie-total">${moneyShort(total)}</div>
                <div class="fin-pie-label">Всего</div>
              </div>
            </div>
            <div class="fin-legend">
              ${segments.map(s => `
                <div class="fin-legend-item">
                  <div class="fin-legend-color" style="background:${s.color}"></div>
                  <div class="fin-legend-icon">${s.icon}</div>
                  <div class="fin-legend-label">${s.label}</div>
                  <div class="fin-legend-value">${money(Math.round(s.value))} ₽</div>
                  <div class="fin-legend-pct">${(s.pct*100).toFixed(1)}%</div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    }

    function renderMonthDetail(data, monthIndex){
      const monthData = mode === 'expenses' ? data.expenses : data.income;
      const monthValue = monthData.months[monthIndex];
      const monthCategories = mode === 'expenses' ? monthData.byMonth[monthIndex] : null;

      let categoriesHtml = '';
      if(mode === 'expenses' && monthCategories){
        const total = Object.values(monthCategories).reduce((a,b) => a+b, 0);
        
        // Мини пай-чарт для месяца
        let currentAngle = 0;
        const segments = EXPENSE_CATEGORIES.filter(c => monthCategories[c.key] > 0).map(c => {
          const value = monthCategories[c.key];
          const pct = total > 0 ? value / total : 0;
          const angle = pct * 360;
          const startAngle = currentAngle;
          currentAngle += angle;
          return { ...c, value, pct, startAngle, angle };
        });

        function polarToCartesian(cx, cy, r, angle){
          const rad = (angle - 90) * Math.PI / 180;
          return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
        }

        function describeArc(cx, cy, r, startAngle, endAngle){
          const start = polarToCartesian(cx, cy, r, endAngle);
          const end = polarToCartesian(cx, cy, r, startAngle);
          const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
          return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
        }

        const svgPaths = segments.map(s => {
          if(s.angle >= 359.9){
            return `<circle cx="100" cy="100" r="80" fill="none" stroke="${s.color}" stroke-width="32"/>`;
          }
          return `<path d="${describeArc(100, 100, 80, s.startAngle, s.startAngle + s.angle)}" 
                        fill="none" stroke="${s.color}" stroke-width="32" stroke-linecap="butt"/>`;
        }).join('');

        categoriesHtml = `
          <div class="fin-pie-container" style="margin-top:20px">
            <div class="fin-pie">
              <svg viewBox="0 0 200 200" style="transform:rotate(-90deg)">
                ${svgPaths || '<circle cx="100" cy="100" r="80" fill="none" stroke="#64748b" stroke-width="32"/>'}
              </svg>
              <div class="fin-pie-center">
                <div class="fin-pie-total">${moneyShort(total)}</div>
                <div class="fin-pie-label">Всего</div>
              </div>
            </div>
            <div class="fin-legend">
              ${segments.length ? segments.map(s => `
                <div class="fin-legend-item">
                  <div class="fin-legend-color" style="background:${s.color}"></div>
                  <div class="fin-legend-icon">${s.icon}</div>
                  <div class="fin-legend-label">${s.label}</div>
                  <div class="fin-legend-value">${money(Math.round(s.value))} ₽</div>
                  <div class="fin-legend-pct">${(s.pct*100).toFixed(1)}%</div>
                </div>
              `).join('') : '<div class="help">Нет данных</div>'}
            </div>
          </div>
        `;
      }

      return `
        <div class="fin-chart-container">
          <div class="fin-chart-title">
            <button class="back-btn" id="backToYear">← Назад к году</button>
            ${MONTHS_FULL[monthIndex]} ${selectedYear}
          </div>
          
          <div class="fin-summary" style="margin-top:16px">
            <div class="fin-card">
              <div class="fin-card-label">${mode==='expenses'?'Расходы за месяц':'Поступления за месяц'}</div>
              <div class="fin-card-value">${money(Math.round(monthValue))} ₽</div>
            </div>
          </div>

          ${categoriesHtml}
        </div>
      `;
    }

    function bindEvents(){
      // Переключение режима
      $$('.fin-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          mode = tab.dataset.mode;
          selectedMonth = null;
          renderPage();
        });
      });

      // Навигация по годам
      const prevBtn = $('#prevYear');
      const nextBtn = $('#nextYear');
      if(prevBtn) prevBtn.addEventListener('click', () => {
        if(selectedYear > 2020){
          selectedYear--;
          selectedMonth = null;
          renderPage();
        }
      });
      if(nextBtn) nextBtn.addEventListener('click', () => {
        if(selectedYear < currentYear){
          selectedYear++;
          selectedMonth = null;
          renderPage();
        }
      });

      // Клик на столбик месяца
      $$('.fin-bar-wrap').forEach(bar => {
        bar.addEventListener('click', () => {
          selectedMonth = parseInt(bar.dataset.month);
          renderPage();
        });
      });

      // Кнопка назад
      const backBtn = $('#backToYear');
      if(backBtn) backBtn.addEventListener('click', () => {
        selectedMonth = null;
        renderPage();
      });
      
      // Кнопка импорта выписки
      const importBtn = $('#btnImportBank');
      if(importBtn) importBtn.addEventListener('click', async () => {
        if(!window.AsgardBankImport){
          toast('Ошибка', 'Модуль импорта не загружен', 'err');
          return;
        }
        const data = await AsgardBankImport.openImportModal();
        if(data && data.length){
          const count = await AsgardBankImport.importTransactions(data, user.id);
          toast('Импорт', `Загружено ${count} операций`, 'ok');
          renderPage();
        }
      });
    }

    renderPage();
  }

  return { render, EXPENSE_CATEGORIES, OFFICE_EXPENSE_CATEGORIES };
})();
