// Stage 19: Дашборд руководителя
// Сводная аналитика на одной странице

window.AsgardDashboardPage = (function(){
  const { $, $$, esc, toast } = AsgardUI;
  const { stackedBar, divergent } = AsgardCharts || {};

  function money(x){ 
    if(x === null || x === undefined || x === "") return "—"; 
    const n = Number(x); 
    if(isNaN(n)) return esc(String(x)); 
    return n.toLocaleString("ru-RU") + " ₽"; 
  }

  function shortMoney(x){
    const n = Number(x) || 0;
    if(n >= 1000000) return (n/1000000).toFixed(1) + 'М';
    if(n >= 1000) return (n/1000).toFixed(0) + 'К';
    return n.toFixed(0);
  }

  function pct(a, b){
    if(!b) return '—';
    return Math.round((a / b) * 100) + '%';
  }

  async function render({layout, title}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash = "#/login"; return; }
    const user = auth.user;

    // Только директора и админ
    const allowed = ["ADMIN", "DIRECTOR_COMM", "DIRECTOR_GEN", "DIRECTOR_DEV", "DIRECTOR"];
    if(!allowed.includes(user.role)){
      toast("Доступ", "Дашборд доступен руководителям", "err");
      location.hash = "#/home";
      return;
    }

    // Загружаем все данные
    const [tenders, estimates, works, users, workExpenses, officeExpenses, travelExpenses] = await Promise.all([
      AsgardDB.all('tenders'),
      AsgardDB.all('estimates'),
      AsgardDB.all('works'),
      AsgardDB.all('users'),
      AsgardDB.all('work_expenses').catch(() => []),
      AsgardDB.all('office_expenses').catch(() => []),
      AsgardDB.all('travel_expenses').catch(() => [])
    ]);

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    // Фильтрация по текущему году
    const thisYearTenders = tenders.filter(t => t.year === currentYear);
    const thisYearWorks = works.filter(w => {
      const d = w.work_start_fact || w.work_start_plan;
      return d && new Date(d).getFullYear() === currentYear;
    });

    // KPI расчёты
    const stats = {
      // Тендеры
      tendersTotal: thisYearTenders.length,
      tendersWon: thisYearTenders.filter(t => t.tender_status === 'Клиент согласился').length,
      tendersLost: thisYearTenders.filter(t => t.tender_status === 'Клиент отказался').length,
      tendersInProgress: thisYearTenders.filter(t => !['Клиент согласился', 'Клиент отказался', 'Другое'].includes(t.tender_status)).length,

      // Работы
      worksTotal: thisYearWorks.length,
      worksDone: thisYearWorks.filter(w => w.work_status === 'Работы сдали').length,
      worksActive: thisYearWorks.filter(w => !['Работы сдали'].includes(w.work_status)).length,
      worksProblems: thisYearWorks.filter(w => w.work_status === 'Проблема').length,

      // Деньги
      contractSum: thisYearWorks.reduce((s, w) => s + (Number(w.contract_sum) || 0), 0),
      planSum: thisYearWorks.reduce((s, w) => s + (Number(w.plan_total) || 0), 0),
      factSum: thisYearWorks.reduce((s, w) => s + (Number(w.fact_total) || 0), 0),
      
      // Расходы
      workExpensesSum: workExpenses.filter(e => {
        const d = e.date;
        return d && new Date(d).getFullYear() === currentYear;
      }).reduce((s, e) => s + (Number(e.amount) || 0), 0),
      
      officeExpensesSum: officeExpenses.filter(e => {
        const d = e.date;
        return d && new Date(d).getFullYear() === currentYear;
      }).reduce((s, e) => s + (Number(e.amount) || 0), 0),

      travelExpensesSum: travelExpenses.filter(e => {
        const d = e.date;
        return d && new Date(d).getFullYear() === currentYear;
      }).reduce((s, e) => s + (Number(e.amount) || 0), 0),

      // Пользователи
      usersActive: users.filter(u => u.is_active && !u.is_blocked).length,
      usersBlocked: users.filter(u => u.is_blocked).length
    };

    // Прибыль
    stats.profit = stats.contractSum - stats.factSum;
    stats.profitPlan = stats.contractSum - stats.planSum;
    
    // Конверсия тендеров
    stats.conversionRate = stats.tendersTotal > 0 
      ? Math.round((stats.tendersWon / stats.tendersTotal) * 100) 
      : 0;

    // Данные по месяцам для графиков
    const monthlyData = [];
    const MONTHS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
    
    for(let m = 0; m <= currentMonth; m++){
      const monthWorks = works.filter(w => {
        const d = w.work_start_fact || w.work_start_plan;
        if(!d) return false;
        const dt = new Date(d);
        return dt.getFullYear() === currentYear && dt.getMonth() === m;
      });
      
      const monthTenders = tenders.filter(t => {
        if(t.year !== currentYear) return false;
        const period = t.period || '';
        const match = period.match(/^\d{4}-(\d{2})$/);
        return match && parseInt(match[1]) === m + 1;
      });

      monthlyData.push({
        label: MONTHS[m],
        works: monthWorks.length,
        tenders: monthTenders.length,
        won: monthTenders.filter(t => t.tender_status === 'Клиент согласился').length,
        revenue: monthWorks.reduce((s, w) => s + (Number(w.contract_sum) || 0), 0)
      });
    }

    function renderPage(){
      const body = `
        <style>
          .dash-header { margin-bottom:28px; }
          .dash-header h2 { margin:0 0 8px; font-size:24px; font-weight:900; background:linear-gradient(135deg, var(--red), var(--blue)); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; letter-spacing:0.02em; }
          .dash-period { color:var(--t3); font-size:14px; }

          .dash-grid {
            display:grid;
            grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));
            gap:20px;
            margin-bottom:28px;
          }

          .dash-card {
            position:relative;
            background: var(--bg2);
            border:none;
            border-radius:var(--r-lg);
            padding:24px;
            overflow:hidden;
            transition: all .3s ease;
            box-shadow: var(--shadow-sm);
          }
          .dash-card::before {
            content:'';
            position:absolute;
            top:0; left:0; right:0;
            height:3px;
            background: var(--card-gradient, linear-gradient(90deg, var(--gold), var(--red)));
            opacity:0.7;
          }
          .dash-card:hover {
            box-shadow: var(--shadow-md), 0 0 20px rgba(212,168,67,.08);
            transform:translateY(-2px);
          }

          .dash-card-title { font-size:11px; color:var(--gold); text-transform:uppercase; letter-spacing:1.5px; font-weight:800; margin-bottom:12px; }
          .dash-card-value { font-size:36px; font-weight:900; margin-bottom:4px; font-family:var(--ff-head); }
          .dash-card-sub { font-size:13px; color:var(--t3); }
          .dash-card-icon { position:absolute; right:16px; top:50%; transform:translateY(-50%); font-size:48px; opacity:.1; }

          .dash-card-row { display:flex; gap:16px; margin-top:12px; padding-top:12px; border-top:1px solid rgba(255,255,255,.06); }
          .dash-card-row .mini { flex:1; }
          .dash-card-row .mini-label { font-size:10px; color:var(--gold-dim); text-transform:uppercase; letter-spacing:0.06em; font-weight:700; }
          .dash-card-row .mini-value { font-size:18px; font-weight:800; margin-top:2px; }

          .dash-section { margin-bottom:28px; }
          .dash-section-title { font-size:14px; font-weight:800; color:var(--gold); margin-bottom:14px; text-transform:uppercase; letter-spacing:1.5px; padding-bottom:8px; border-bottom:1px solid rgba(212,168,67,.12); }

          .dash-chart-row { display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:28px; }
          @media(max-width:900px){ .dash-chart-row { grid-template-columns:1fr; } }

          .dash-chart-card {
            background: var(--bg2);
            border:none;
            border-radius:var(--r-lg);
            padding:20px;
            box-shadow: var(--shadow-sm);
            position:relative;
            overflow:hidden;
          }
          .dash-chart-card::before {
            content:'';
            position:absolute;
            top:0; left:0; right:0;
            height:3px;
            background:linear-gradient(90deg, var(--blue), var(--gold));
            opacity:0.5;
          }
          .dash-chart-title { font-size:12px; color:var(--gold); margin-bottom:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; }
          .dash-chart-canvas { width:100%; height:180px; }

          .dash-quick { display:flex; flex-wrap:wrap; gap:10px; }
          .dash-quick a {
            display:flex; align-items:center; gap:8px;
            padding:10px 16px;
            background: var(--bg2);
            border:none;
            border-radius:var(--r-md);
            color:var(--blue-l);
            font-size:13px; font-weight:600;
            transition: all .2s ease;
            text-decoration:none;
            box-shadow: var(--shadow-sm);
          }
          .dash-quick a:hover {
            background: linear-gradient(135deg, rgba(30,77,140,.08), rgba(200,41,59,.04));
            transform:translateY(-2px);
            box-shadow: var(--shadow-md);
            color:var(--gold);
          }

          .dash-alerts {
            background: linear-gradient(135deg, rgba(200,41,59,.06), rgba(200,41,59,.02));
            border:1px solid rgba(200,41,59,.15);
            border-radius:var(--r-lg);
            padding:20px;
            margin-bottom:24px;
          }
          .dash-alerts-title { font-size:12px; color:var(--err-t); font-weight:800; margin-bottom:10px; text-transform:uppercase; letter-spacing:0.06em; }
          .dash-alert-item { display:flex; align-items:center; gap:8px; padding:10px 0; font-size:13px; border-bottom:1px solid rgba(200,41,59,.06); }
          .dash-alert-item:last-child { padding-bottom:0; border-bottom:none; }

          .dash-progress {
            height:8px; background:rgba(255,255,255,.06);
            border-radius:var(--r-full); overflow:hidden; margin-top:8px;
          }
          .dash-progress-bar { height:100%; border-radius:var(--r-full); transition:width .5s ease; }

          .green { color:var(--ok-t); }
          .red { color:var(--err-t); }
          .amber { color:#fbbf24; }
          .blue { color:var(--info-t); }
          .gold { color:var(--gold); }
        </style>

        <div class="panel">
          <div class="dash-header">
            <h2 class="page-title">Дашборд руководителя</h2>
            <div class="dash-period">📅 ${currentYear} год • Данные на ${now.toLocaleDateString('ru-RU')}</div>
          </div>

          ${stats.worksProblems > 0 ? `
            <div class="dash-alerts">
              <div class="dash-alerts-title">⚠️ Требует внимания</div>
              <div class="dash-alert-item">🔴 <strong>${stats.worksProblems}</strong> работ со статусом "Проблема"</div>
              ${stats.usersBlocked > 0 ? `<div class="dash-alert-item">🔒 <strong>${stats.usersBlocked}</strong> заблокированных пользователей</div>` : ''}
            </div>
          ` : ''}

          <div class="dash-grid">
            <!-- Тендеры -->
            <div class="dash-card" style="--card-gradient:linear-gradient(90deg, var(--info), var(--purple))">
              <div class="dash-card-title">Тендеры ${currentYear}</div>
              <div class="dash-card-value blue">${stats.tendersTotal}</div>
              <div class="dash-card-sub">Конверсия: <strong class="green">${stats.conversionRate}%</strong></div>
              <div class="dash-card-icon">📋</div>
              <div class="dash-card-row">
                <div class="mini"><div class="mini-label">Выиграно</div><div class="mini-value green">${stats.tendersWon}</div></div>
                <div class="mini"><div class="mini-label">Проиграно</div><div class="mini-value red">${stats.tendersLost}</div></div>
                <div class="mini"><div class="mini-label">В работе</div><div class="mini-value amber">${stats.tendersInProgress}</div></div>
              </div>
            </div>

            <!-- Работы -->
            <div class="dash-card" style="--card-gradient:linear-gradient(90deg, var(--ok-t), var(--cyan))">
              <div class="dash-card-title">Работы ${currentYear}</div>
              <div class="dash-card-value green">${stats.worksTotal}</div>
              <div class="dash-card-sub">Завершено: <strong>${pct(stats.worksDone, stats.worksTotal)}</strong></div>
              <div class="dash-card-icon">🏗️</div>
              <div class="dash-progress">
                <div class="dash-progress-bar" style="width:${stats.worksTotal ? (stats.worksDone/stats.worksTotal*100) : 0}%; background:linear-gradient(90deg, var(--ok-t), var(--ok-t))"></div>
              </div>
              <div class="dash-card-row">
                <div class="mini"><div class="mini-label">Завершено</div><div class="mini-value green">${stats.worksDone}</div></div>
                <div class="mini"><div class="mini-label">Активные</div><div class="mini-value blue">${stats.worksActive}</div></div>
                <div class="mini"><div class="mini-label">Проблемы</div><div class="mini-value red">${stats.worksProblems}</div></div>
              </div>
            </div>

            <!-- Выручка -->
            <div class="dash-card" style="--card-gradient:linear-gradient(90deg, var(--gold), var(--amber))">
              <div class="dash-card-title">Выручка (контракты)</div>
              <div class="dash-card-value gold">${shortMoney(stats.contractSum)}</div>
              <div class="dash-card-sub">${money(stats.contractSum)}</div>
              <div class="dash-card-icon">💰</div>
            </div>

            <!-- Прибыль -->
            <div class="dash-card" style="--card-gradient:linear-gradient(90deg, ${stats.profit >= 0 ? 'var(--ok-t), var(--ok)' : 'var(--err-t), var(--err-t)'})">
              <div class="dash-card-title">Прибыль (факт)</div>
              <div class="dash-card-value ${stats.profit >= 0 ? 'green' : 'red'}">${shortMoney(stats.profit)}</div>
              <div class="dash-card-sub">План: ${money(stats.profitPlan)}</div>
              <div class="dash-card-icon">${stats.profit >= 0 ? '📈' : '📉'}</div>
            </div>

            <!-- Расходы -->
            <div class="dash-card" style="--card-gradient:linear-gradient(90deg, var(--err-t), var(--orange))">
              <div class="dash-card-title">Расходы (всего)</div>
              <div class="dash-card-value red">${shortMoney(stats.workExpensesSum + stats.officeExpensesSum + stats.travelExpensesSum)}</div>
              <div class="dash-card-icon">💸</div>
              <div class="dash-card-row">
                <div class="mini"><div class="mini-label">По работам</div><div class="mini-value">${shortMoney(stats.workExpensesSum)}</div></div>
                <div class="mini"><div class="mini-label">Офис</div><div class="mini-value">${shortMoney(stats.officeExpensesSum)}</div></div>
                <div class="mini"><div class="mini-label">Командировки</div><div class="mini-value">${shortMoney(stats.travelExpensesSum)}</div></div>
              </div>
            </div>

            <!-- Команда -->
            <div class="dash-card" style="--card-gradient:linear-gradient(90deg, var(--purple), var(--purple))">
              <div class="dash-card-title">Команда</div>
              <div class="dash-card-value" style="color:var(--purple-l)">${stats.usersActive}</div>
              <div class="dash-card-sub">активных сотрудников</div>
              <div class="dash-card-icon">👥</div>
            </div>
          </div>

          <div class="dash-chart-row">
            <div class="dash-chart-card">
              <div class="dash-chart-title">📊 Тендеры по месяцам</div>
              <canvas id="chartTenders" class="dash-chart-canvas"></canvas>
            </div>
            <div class="dash-chart-card">
              <div class="dash-chart-title">📊 Работы по месяцам</div>
              <canvas id="chartWorks" class="dash-chart-canvas"></canvas>
            </div>
          </div>

          <div class="dash-section">
            <div class="dash-section-title">⚡ Быстрые действия</div>
            <div class="dash-quick">
              <a href="#/tenders">📋 Тендеры</a>
              <a href="#/all-works">🏗️ Все работы</a>
              <a href="#/approvals">✓ Согласования</a>
              <a href="#/finances">💰 Финансы</a>
              <a href="#/user-requests">👥 Пользователи</a>
              <a href="#/kpi-works">📈 KPI работ</a>
              <a href="#/kpi-money">💵 KPI деньги</a>
              <a href="#/buh-registry">🧾 Реестр BUH</a>
            </div>
          </div>

          <div class="dash-section">
            <div class="dash-section-title">📥 Экспорт в Excel (CSV)</div>
            <div class="dash-quick">
              <a href="#" id="expDashboard">📊 Сводка</a>
              <a href="#" id="expTenders">📋 Тендеры</a>
              <a href="#" id="expWorks">🏗️ Работы</a>
              <a href="#" id="expWorkExp">💸 Расходы работ</a>
              <a href="#" id="expOfficeExp">🏢 Офис.расходы</a>
              <a href="#" id="expTravel">✈️ Командировки</a>
              <a href="#" id="expUsers">👥 Пользователи</a>
            </div>
          </div>
        </div>
      `;

      layout(body, { title: title || "Дашборд" }).then(() => {
        renderCharts();
        bindExportButtons();
      });
    }

    function bindExportButtons(){
      const toast = AsgardUI.toast;
      
      $('#expDashboard')?.addEventListener('click', async (e) => {
        e.preventDefault();
        const r = await AsgardExport.exportDashboard(currentYear);
        toast('Экспорт', `Сводка выгружена (${r.count} строк)`);
      });
      
      $('#expTenders')?.addEventListener('click', async (e) => {
        e.preventDefault();
        const r = await AsgardExport.exportTenders({ year: currentYear });
        toast('Экспорт', `Тендеры выгружены (${r.count} строк)`);
      });
      
      $('#expWorks')?.addEventListener('click', async (e) => {
        e.preventDefault();
        const r = await AsgardExport.exportWorks({ year: currentYear });
        toast('Экспорт', `Работы выгружены (${r.count} строк)`);
      });
      
      $('#expWorkExp')?.addEventListener('click', async (e) => {
        e.preventDefault();
        const r = await AsgardExport.exportWorkExpenses({ year: currentYear });
        toast('Экспорт', `Расходы выгружены (${r.count} строк)`);
      });
      
      $('#expOfficeExp')?.addEventListener('click', async (e) => {
        e.preventDefault();
        const r = await AsgardExport.exportOfficeExpenses({ year: currentYear });
        toast('Экспорт', `Офис.расходы выгружены (${r.count} строк)`);
      });
      
      $('#expTravel')?.addEventListener('click', async (e) => {
        e.preventDefault();
        const r = await AsgardExport.exportTravelExpenses({ year: currentYear });
        toast('Экспорт', `Командировки выгружены (${r.count} строк)`);
      });
      
      $('#expUsers')?.addEventListener('click', async (e) => {
        e.preventDefault();
        const r = await AsgardExport.exportUsers();
        toast('Экспорт', `Пользователи выгружены (${r.count} строк)`);
      });
    }

    function renderCharts(){
      // График тендеров
      const canvasTenders = $('#chartTenders');
      if(canvasTenders && stackedBar){
        const rows = monthlyData.map(m => ({
          label: m.label,
          parts: [
            { key: 'won', value: m.won, color: 'var(--ok-t)', label: 'Выиграно' },
            { key: 'other', value: m.tenders - m.won, color: 'var(--info)', label: 'Прочие' }
          ]
        }));
        stackedBar(canvasTenders, rows, { legend: true });
      }

      // График работ
      const canvasWorks = $('#chartWorks');
      if(canvasWorks && stackedBar){
        const rows = monthlyData.map(m => ({
          label: m.label,
          parts: [
            { key: 'works', value: m.works, color: 'var(--purple)', label: 'Работы' }
          ]
        }));
        stackedBar(canvasWorks, rows, { legend: true });
      }
    }

    renderPage();
  }

  return { render };
})();
