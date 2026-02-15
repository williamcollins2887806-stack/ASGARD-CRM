/**
 * M15: Аналитика руководителей проектов (HEAD_PM)
 * Хроники Руководителей Проектов
 */
window.AsgardPMAnalytics = (function(){
  const { $, $$, esc, toast } = AsgardUI;

  function money(x){
    if(x===null||x===undefined||x==="") return "—";
    const n=Number(x); if(isNaN(n)) return esc(String(x));
    return n.toLocaleString("ru-RU")+" ₽";
  }
  function shortMoney(x){
    const n=Number(x)||0;
    if(n>=1000000) return (n/1000000).toFixed(1)+'М';
    if(n>=1000) return (n/1000).toFixed(0)+'К';
    return n.toFixed(0);
  }
  function pct(a,b){ return b ? Math.round((a/b)*100)+'%' : '—'; }

  function headers(){
    return { 'Content-Type':'application/json', 'Authorization':'Bearer '+(localStorage.getItem('asgard_token')||'') };
  }

  async function render({layout, title}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }
    const user = auth.user;
    const allowed = ["ADMIN","HEAD_PM","DIRECTOR_COMM","DIRECTOR_GEN","DIRECTOR_DEV"];
    if(!allowed.includes(user.role)){
      toast("Доступ","Раздел доступен руководителю технического отдела","err");
      location.hash="#/home"; return;
    }

    const now = new Date();
    const yNow = now.getFullYear();

    const body = `
      ${window.__ASG_SHARED_TABLE_CSS__||""}
      <div class="panel">
        <div class="help">Хроники Руководителей Проектов — KPI, загрузка и аналитика по каждому РП.</div>
        <hr class="hr"/>
        <div class="tools">
          <div class="field"><label>Год</label>
            <select id="f_year">
              <option value="">Все</option>
              ${[yNow, yNow-1, yNow-2].map(y=>`<option value="${y}" ${y===yNow?"selected":""}>${y}</option>`).join("")}
            </select>
          </div>
          <button class="btn ghost" id="btnRefresh">Обновить</button>
        </div>
        <hr class="hr"/>
        <div class="kpi" id="deptKpi" style="grid-template-columns:repeat(6,minmax(130px,1fr))"></div>
        <div class="chart" style="margin-top:16px">
          <h3>KPI по руководителям проектов</h3>
          <table class="asg" id="teamTable">
            <thead><tr>
              <th>РП</th><th>Всего работ</th><th>Активных</th><th>Завершено</th><th>Просрочено</th><th>Контракты</th><th>Прибыль</th>
            </tr></thead>
            <tbody id="teamBody"></tbody>
          </table>
        </div>
        <div class="chart" style="margin-top:16px">
          <h3>Динамика за 12 месяцев</h3>
          <div id="monthBars"></div>
        </div>
      </div>
    `;

    await layout(body, {title, motto:"Кто ведёт корабль — тот отвечает за путь"});
    await loadData();

    const yearSel = $("#f_year");
    if(yearSel) yearSel.onchange = loadData;
    const btnRef = $("#btnRefresh");
    if(btnRef) btnRef.onclick = loadData;
  }

  async function loadData(){
    const year = ($("#f_year")||{}).value || "";
    const qs = year ? `?year=${year}` : "";

    try {
      const resp = await fetch(`/api/works/analytics/team${qs}`, {headers: headers()});
      if(!resp.ok) throw new Error("Ошибка загрузки");
      const data = await resp.json();
      renderDeptKpi(data.department);
      renderTeamTable(data.team);
      renderMonthBars(data.byMonth);
    } catch(e) {
      toast("Ошибка", e.message, "err");
    }
  }

  function renderDeptKpi(dept){
    const el = $("#deptKpi");
    if(!el || !dept) return;
    const total = Number(dept.total)||0;
    const active = Number(dept.active)||0;
    const completed = Number(dept.completed)||0;
    const overdue = Number(dept.overdue)||0;
    el.innerHTML = `
      <div class="k"><div class="t">Всего работ</div><div class="v">${total}</div></div>
      <div class="k"><div class="t">Активных</div><div class="v" style="color:#2196f3">${active}</div></div>
      <div class="k"><div class="t">Завершено</div><div class="v" style="color:#4caf50">${completed}</div></div>
      <div class="k"><div class="t">Просрочено</div><div class="v" style="color:#f44336">${overdue}</div></div>
      <div class="k"><div class="t">Сумма контрактов</div><div class="v">${money(dept.total_contract)}</div></div>
      <div class="k"><div class="t">Общая прибыль</div><div class="v" style="color:#4caf50">${money(dept.total_profit)}</div></div>
    `;
  }

  function renderTeamTable(team){
    const tbody = $("#teamBody");
    if(!tbody) return;
    if(!team || !team.length){
      tbody.innerHTML = '<tr><td colspan="7" class="muted">Нет данных</td></tr>';
      return;
    }
    tbody.innerHTML = team.map(t=>{
      const total = Number(t.total_works)||0;
      const active = Number(t.active)||0;
      const completed = Number(t.completed)||0;
      const overdue = Number(t.overdue)||0;
      const profit = Number(t.profit)||0;
      const profitColor = profit >= 0 ? "#4caf50" : "#f44336";
      return `<tr>
        <td><b>${esc(t.name)}</b><br><span class="muted">${esc(t.role)}</span></td>
        <td>${total}</td>
        <td style="color:#2196f3">${active}</td>
        <td style="color:#4caf50; font-weight:700">${completed}</td>
        <td style="color:#f44336">${overdue}</td>
        <td>${money(t.total_contract)}</td>
        <td style="color:${profitColor}; font-weight:700">${money(profit)}</td>
      </tr>`;
    }).join("");
  }

  function renderMonthBars(byMonth){
    const el = $("#monthBars");
    if(!el || !byMonth) return;
    const max = Math.max(...byMonth.map(m=>Number(m.contract_sum)||0), 1);
    el.innerHTML = byMonth.map(m=>{
      const total = Number(m.total)||0;
      const completed = Number(m.completed)||0;
      const contractSum = Number(m.contract_sum)||0;
      const w = Math.round((contractSum/max)*100);
      return `<div class="barrow">
        <div>${esc(m.month)}</div>
        <div class="bar"><div style="width:${w}%; background:linear-gradient(90deg,#4caf50 ${pct(completed,total)},#2196f3 ${pct(completed,total)}); border-radius:999px"></div></div>
        <div style="text-align:right"><b>${total}</b> работ · ${money(contractSum)}</div>
      </div>`;
    }).join("");
  }

  return { render };
})();
