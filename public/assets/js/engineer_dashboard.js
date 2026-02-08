/**
 * M15: Дашборд главного инженера (CHIEF_ENGINEER)
 * Кузница Инженера
 */
window.AsgardEngineerDashboard = (function(){
  const { $, $$, esc, toast } = AsgardUI;

  function money(x){
    if(x===null||x===undefined||x==="") return "—";
    const n=Number(x); if(isNaN(n)) return esc(String(x));
    return n.toLocaleString("ru-RU")+" ₽";
  }

  function headers(){
    return { 'Content-Type':'application/json', 'Authorization':'Bearer '+(localStorage.getItem('asgard_token')||'') };
  }

  function formatDate(iso){
    if(!iso) return "—";
    try {
      return new Date(iso).toLocaleDateString("ru-RU");
    } catch(e) { return "—"; }
  }

  async function render({layout, title}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }
    const user = auth.user;
    const allowed = ["ADMIN","CHIEF_ENGINEER","DIRECTOR_COMM","DIRECTOR_GEN","DIRECTOR_DEV"];
    if(!allowed.includes(user.role)){
      toast("Доступ","Раздел доступен главному инженеру","err");
      location.hash="#/home"; return;
    }

    const body = `
      ${window.__ASG_SHARED_TABLE_CSS__||""}
      <style>
        .pm-card { background:rgba(13,20,40,.40); border:1px solid rgba(42,59,102,.85); border-radius:16px; padding:12px; margin-bottom:12px; }
        .pm-header { display:flex; justify-content:space-between; align-items:center; cursor:pointer; }
        .pm-header:hover { background:rgba(42,59,102,.25); margin:-12px; padding:12px; border-radius:16px; }
        .pm-name { font-weight:700; font-size:16px; }
        .pm-stats { display:flex; gap:16px; color:rgba(184,196,231,.85); font-size:13px; }
        .pm-list { margin-top:12px; display:none; }
        .pm-list.open { display:block; }
        .eq-item { display:flex; gap:12px; padding:8px 0; border-bottom:1px solid rgba(42,59,102,.35); font-size:13px; }
        .eq-item:last-child { border-bottom:none; }
        .maint-item { display:flex; justify-content:space-between; padding:8px; border-bottom:1px solid rgba(42,59,102,.35); }
        .maint-item:last-child { border-bottom:none; }
        .maint-soon { color:#ff9800; }
        .maint-overdue { color:#f44336; font-weight:700; }
      </style>
      <div class="panel">
        <div class="help">Кузница Инженера — контроль оборудования по РП, требующее ТО и движения склада.</div>
        <hr class="hr"/>
        <div class="tools">
          <button class="btn ghost" id="btnRefresh">Обновить</button>
          <a href="#/warehouse" class="btn">Перейти на склад</a>
        </div>
        <hr class="hr"/>
        <div class="kpi" id="summaryKpi" style="grid-template-columns:repeat(5,minmax(140px,1fr))"></div>

        <div class="chart" style="margin-top:16px">
          <h3>Оборудование по РП</h3>
          <div id="pmList"></div>
        </div>

        <div class="chart" style="margin-top:16px">
          <h3>Требуется ТО (ближайшие 30 дней)</h3>
          <div id="maintenanceList"></div>
        </div>

        <div class="chart" style="margin-top:16px">
          <h3>Движения за 30 дней</h3>
          <div id="movementsBars"></div>
        </div>
      </div>
    `;

    await layout(body, {title, motto:"Кузнец знает цену каждого клинка"});
    await loadData();

    const btnRef = $("#btnRefresh");
    if(btnRef) btnRef.onclick = loadData;
  }

  async function loadData(){
    try {
      // Загружаем аналитику по РП
      const respPm = await fetch(`/api/equipment/analytics/by-pm`, {headers: headers()});
      if(!respPm.ok) throw new Error("Ошибка загрузки аналитики");
      const dataPm = await respPm.json();

      // Загружаем общую статистику склада
      const respStats = await fetch(`/api/equipment/stats/summary`, {headers: headers()});
      let stats = {};
      if(respStats.ok) {
        stats = await respStats.json();
      }

      renderSummaryKpi(stats, dataPm);
      renderPmList(dataPm.byPm);
      renderMaintenanceList(dataPm.needsMaintenance);
      renderMovementsBars(dataPm.movements);

    } catch(e) {
      toast("Ошибка", e.message, "err");
    }
  }

  function renderSummaryKpi(stats, dataPm){
    const el = $("#summaryKpi");
    if(!el) return;

    // Суммируем оборудование у РП
    let totalOnHands = 0, totalValue = 0, totalIssued = 0, totalRepair = 0;
    if(dataPm.byPm) {
      for(const pm of dataPm.byPm) {
        totalOnHands += Number(pm.equipment_count)||0;
        totalValue += Number(pm.total_value)||0;
        totalIssued += Number(pm.issued)||0;
        totalRepair += Number(pm.in_repair)||0;
      }
    }

    const total = Number(stats.total)||0;
    const inStock = Number(stats.in_stock)||0;

    el.innerHTML = `
      <div class="k"><div class="t">Всего на складе</div><div class="v">${total}</div></div>
      <div class="k"><div class="t">На складе (доступно)</div><div class="v" style="color:#4caf50">${inStock}</div></div>
      <div class="k"><div class="t">На руках у РП</div><div class="v" style="color:#2196f3">${totalOnHands}</div></div>
      <div class="k"><div class="t">В ремонте</div><div class="v" style="color:#ff9800">${totalRepair}</div></div>
      <div class="k"><div class="t">Стоимость на руках</div><div class="v">${money(totalValue)}</div></div>
    `;
  }

  function renderPmList(byPm){
    const el = $("#pmList");
    if(!el) return;

    if(!byPm || !byPm.length){
      el.innerHTML = '<div class="help">Нет оборудования на руках у РП</div>';
      return;
    }

    el.innerHTML = byPm.map((pm, idx) => {
      const eqList = pm.equipment_list || [];
      return `
        <div class="pm-card" data-idx="${idx}">
          <div class="pm-header" onclick="AsgardEngineerDashboard.togglePm(${idx})">
            <div class="pm-name">${esc(pm.pm_name)}</div>
            <div class="pm-stats">
              <span>${pm.equipment_count} ед.</span>
              <span>${money(pm.total_value)}</span>
              <span style="color:#ff9800">${pm.in_repair||0} в ремонте</span>
            </div>
          </div>
          <div class="pm-list" id="pmEq_${idx}">
            ${eqList.map(eq => `
              <div class="eq-item">
                <div style="flex:1"><b>${esc(eq.name||"—")}</b></div>
                <div style="width:120px">${esc(eq.inventory_number||"—")}</div>
                <div style="width:100px">${esc(eq.status||"—")}</div>
                <div style="width:100px; text-align:right">${money(eq.book_value)}</div>
              </div>
            `).join("")}
          </div>
        </div>
      `;
    }).join("");
  }

  function renderMaintenanceList(items){
    const el = $("#maintenanceList");
    if(!el) return;

    if(!items || !items.length){
      el.innerHTML = '<div class="help">Нет оборудования, требующего ТО в ближайшие 30 дней</div>';
      return;
    }

    const now = new Date();
    el.innerHTML = items.map(item => {
      const date = new Date(item.next_maintenance_date || item.next_maintenance);
      const isOverdue = date < now;
      const cls = isOverdue ? 'maint-overdue' : 'maint-soon';
      return `
        <div class="maint-item">
          <div>
            <b>${esc(item.name||"—")}</b>
            <span class="muted" style="margin-left:8px">${esc(item.inventory_number||"")}</span>
            ${item.holder_name ? `<span class="muted" style="margin-left:8px">→ ${esc(item.holder_name)}</span>` : ""}
          </div>
          <div class="${cls}">${formatDate(item.next_maintenance_date || item.next_maintenance)}</div>
        </div>
      `;
    }).join("");
  }

  function renderMovementsBars(movements){
    const el = $("#movementsBars");
    if(!el) return;

    if(!movements || !movements.length){
      el.innerHTML = '<div class="help">Нет движений за последние 30 дней</div>';
      return;
    }

    // Группируем по типу движения
    const byType = {};
    for(const m of movements) {
      const t = m.movement_type || "unknown";
      if(!byType[t]) byType[t] = 0;
      byType[t] += Number(m.count)||0;
    }

    const types = Object.entries(byType).sort((a,b)=>b[1]-a[1]);
    const max = Math.max(...types.map(t=>t[1]), 1);

    const typeLabels = {
      'issue': 'Выдача',
      'return': 'Возврат',
      'repair': 'Ремонт',
      'write_off': 'Списание',
      'transfer': 'Передача'
    };

    el.innerHTML = types.map(([type, count]) => {
      const w = Math.round((count/max)*100);
      const label = typeLabels[type] || type;
      const color = type === 'issue' ? '#2196f3' :
                    type === 'return' ? '#4caf50' :
                    type === 'repair' ? '#ff9800' :
                    type === 'write_off' ? '#f44336' : '#5c6bc0';
      return `<div class="barrow">
        <div>${esc(label)}</div>
        <div class="bar"><div style="width:${w}%; background:${color}; border-radius:999px"></div></div>
        <div style="text-align:right"><b>${count}</b></div>
      </div>`;
    }).join("");
  }

  function togglePm(idx){
    const el = $(`#pmEq_${idx}`);
    if(el) el.classList.toggle('open');
  }

  return { render, togglePm };
})();
