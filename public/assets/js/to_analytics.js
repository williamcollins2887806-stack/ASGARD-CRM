/**
 * M15: Аналитика тендерного отдела (HEAD_TO)
 * Хроники Тендерного Отдела
 */
window.AsgardTOAnalytics = (function(){
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
    const allowed = ["ADMIN","HEAD_TO","DIRECTOR_COMM","DIRECTOR_GEN","DIRECTOR_DEV"];
    if(!allowed.includes(user.role)){
      toast("Доступ","Раздел доступен руководителю тендерного отдела","err");
      location.hash="#/home"; return;
    }

    const now = new Date();
    const yNow = now.getFullYear();

    const body = `
      ${window.__ASG_SHARED_TABLE_CSS__||""}
      <div class="panel">
        <div class="help">Хроники Тендерного Отдела — KPI, воронка и аналитика по каждому тендерному специалисту.</div>
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
          <h3>KPI по тендерным специалистам</h3>
          <table class="asg" id="teamTable">
            <thead><tr>
              <th>Сотрудник</th><th>Всего</th><th>Выиграно</th><th>Проиграно</th><th>В работе</th><th>Сумма выигр.</th><th>Конверсия</th>
            </tr></thead>
            <tbody id="teamBody"></tbody>
          </table>
        </div>
        <div class="chart" style="margin-top:16px">
          <h3>Воронка по статусам</h3>
          <div id="statusBars"></div>
        </div>
        <div class="chart" style="margin-top:16px">
          <h3>Динамика за 12 месяцев</h3>
          <div id="monthBars"></div>
        </div>
      </div>
    `;

    await layout(body, {title, motto:"Кто ведёт торг — тот правит севером"});
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
      const resp = await fetch(`/api/tenders/analytics/team${qs}`, {headers: headers()});
      if(!resp.ok) throw new Error("Ошибка загрузки");
      const data = await resp.json();
      renderDeptKpi(data.department);
      renderTeamTable(data.team);
      renderStatusBars(data.byStatus);
      renderMonthBars(data.byMonth);
    } catch(e) {
      toast("Ошибка", e.message, "err");
    }
  }

  function renderDeptKpi(dept){
    const el = $("#deptKpi");
    if(!el || !dept) return;
    const total = Number(dept.total)||0;
    const won = Number(dept.won)||0;
    const lost = Number(dept.lost)||0;
    const active = total - won - lost;
    el.innerHTML = `
      <div class="k"><div class="t">Всего тендеров</div><div class="v">${total}</div></div>
      <div class="k"><div class="t">Выиграно</div><div class="v" style="color:#4caf50">${won}</div></div>
      <div class="k"><div class="t">Проиграно</div><div class="v" style="color:#f44336">${lost}</div></div>
      <div class="k"><div class="t">В работе</div><div class="v" style="color:#ff9800">${active}</div></div>
      <div class="k"><div class="t">Сумма выигранных</div><div class="v">${money(dept.won_sum)}</div></div>
      <div class="k"><div class="t">Конверсия</div><div class="v">${pct(won, total)}</div></div>
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
      const total = Number(t.total_tenders)||0;
      const won = Number(t.won)||0;
      const lost = Number(t.lost)||0;
      const active = Number(t.active)||0;
      const conv = pct(won, total);
      return `<tr>
        <td><b>${esc(t.name)}</b><br><span class="muted">${esc(t.role)}</span></td>
        <td>${total}</td>
        <td style="color:#4caf50; font-weight:700">${won}</td>
        <td style="color:#f44336">${lost}</td>
        <td style="color:#ff9800">${active}</td>
        <td>${money(t.won_sum)}</td>
        <td><b>${conv}</b></td>
      </tr>`;
    }).join("");
  }

  function renderStatusBars(byStatus){
    const el = $("#statusBars");
    if(!el || !byStatus) return;
    const max = Math.max(...byStatus.map(s=>Number(s.count)||0), 1);
    el.innerHTML = byStatus.map(s=>{
      const c = Number(s.count)||0;
      const w = Math.round((c/max)*100);
      const color = s.tender_status?.includes("согласился") || s.tender_status?.includes("Выиграли") ? "#4caf50" :
                    s.tender_status?.includes("отказался") || s.tender_status?.includes("Проиграли") ? "#f44336" : "#5c6bc0";
      return `<div class="barrow">
        <div>${esc(s.tender_status||"—")}</div>
        <div class="bar"><div style="width:${w}%; background:${color}; border-radius:999px"></div></div>
        <div style="text-align:right"><b>${c}</b> · ${money(s.sum)}</div>
      </div>`;
    }).join("");
  }

  function renderMonthBars(byMonth){
    const el = $("#monthBars");
    if(!el || !byMonth) return;
    const max = Math.max(...byMonth.map(m=>Number(m.total)||0), 1);
    el.innerHTML = byMonth.map(m=>{
      const total = Number(m.total)||0;
      const won = Number(m.won)||0;
      const w = Math.round((total/max)*100);
      return `<div class="barrow">
        <div>${esc(m.month)}</div>
        <div class="bar"><div style="width:${w}%; background:linear-gradient(90deg,#4caf50 ${pct(won,total)},#5c6bc0 ${pct(won,total)}); border-radius:999px"></div></div>
        <div style="text-align:right"><b>${total}</b> (${won} выигр.)</div>
      </div>`;
    }).join("");
  }

  return { render };
})();
