window.AsgardKpiWorksPage=(function(){
  const { $, esc, showModal } = AsgardUI;
  const { stackedBar, divergent, dial } = AsgardCharts;

  function isSafe(){ try{return AsgardSafeMode.isOn();}catch(e){return false;} }

  function money(x){ if(x===null||x===undefined||x==="") return "—"; const n=Number(x); if(isNaN(n)) return esc(String(x)); return n.toLocaleString("ru-RU"); }

  function toDate(d){
    if(!d) return null;
    const s=String(d).trim();
    if(!s) return null;
    const m=s.match(/^\d{4}-\d{2}-\d{2}/);
    if(m){ const [y,mo,da]=m[0].split('-').map(Number); return new Date(Date.UTC(y,mo-1,da,0,0,0)); }
    const dt=new Date(s); return isFinite(dt.getTime())?dt:null;
  }

  function startOfMonth(d){ return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0,0,0)); }
  function addMonths(d, n){ return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+n, 1, 0,0,0)); }

  function mkRange(mode, yearStr, ymStr){
    const now=new Date();
    if(mode==="all") return {start:null, end:null, label:"Всё время"};
    if(mode==="last12"){
      const end = addMonths(startOfMonth(new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1))), 1);
      const start = addMonths(end, -12);
      return {start, end, label:"Последние 12 месяцев"};
    }
    if(mode==="year"){
      const y = Number(yearStr||now.getFullYear());
      const start = new Date(Date.UTC(y,0,1,0,0,0));
      const end = new Date(Date.UTC(y+1,0,1,0,0,0));
      return {start, end, label:`${y} год`};
    }
    // month
    const m = String(ymStr||"").match(/^(\d{4})-(\d{2})$/);
    const y = m ? Number(m[1]) : now.getFullYear();
    const mo = m ? Number(m[2]) : (now.getMonth()+1);
    const start = new Date(Date.UTC(y,mo-1,1,0,0,0));
    const end = new Date(Date.UTC(y,mo,1,0,0,0));
    return {start, end, label:`${String(mo).padStart(2,'0')}.${y}`};
  }

  function inRange(dt, range){
    if(!dt) return false;
    if(!range.start && !range.end) return true;
    const t=dt.getTime();
    if(range.start && t < range.start.getTime()) return false;
    if(range.end && t >= range.end.getTime()) return false;
    return true;
  }

  function diffDays(a,b){
    const da=toDate(a); const db=toDate(b);
    if(!da||!db) return null;
    const ms=db.getTime()-da.getTime();
    return Math.round(ms/(24*3600*1000));
  }

  async function getUsers(){ return (await AsgardDB.all("users")).filter(u=>u.is_active); }
  async function getRefs(){
    const refs = await AsgardDB.get("settings","refs");
    return refs ? JSON.parse(refs.value_json||"{}") : { work_statuses:[] };
  }
  async function getApp(){
    const s=await AsgardDB.get("settings","app");
    return s?JSON.parse(s.value_json||"{}"):{};
  }

  async function render({layout,title}){
    const auth=await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }

    const users=await getUsers();
    const pms=users.filter(u=>u.role==="PM" || (Array.isArray(u.roles) && u.roles.includes("PM")));
    const byId=new Map(users.map(u=>[u.id,u]));
    const refs=await getRefs();
    const app=await getApp();

    const tenders=await AsgardDB.all("tenders");
    const works=await AsgardDB.all("works");

    const now=new Date();
    const yNow=now.getFullYear();
    const ymNow=`${yNow}-${String(now.getMonth()+1).padStart(2,"0")}`;

    const body=`
      ${window.__ASG_SHARED_TABLE_CSS__||""}
      <div class="panel">
        <div class="help">«Ярл • Аналитика Работ» — KPI, статусы и отклонения. Девиз: “Кто ведёт путь — тот отвечает за след.”</div>
        <hr class="hr"/>

        <div class="tools">
          <div class="field"><label>Период</label>
            <select id="f_mode">
              <option value="all">Всё время</option>
              <option value="year">Год</option>
              <option value="month" selected>Месяц</option>
              <option value="last12">Последние 12 месяцев</option>
            </select>
          </div>
          <div class="field" id="box_year" style="display:none"><label>Год</label><select id="f_year">${generateYearOptions(yNow)}</select></div>
          <div class="field" id="box_month"><label>Месяц</label><select id="f_month">${generatePeriodOptions(ymNow)}</select></div>
          <div class="field"><label>РП</label>
            <select id="f_pm"><option value="">Все</option>${pms.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>
          </div>
          <div style="display:flex; gap:10px; flex-wrap:wrap">
            <button class="btn ghost" id="btnGantt">Гантт (все работы)</button>
          </div>
        </div>

        <hr class="hr"/>
        <div class="kpi" id="kpi"></div>


        <div class="chart">
          <h3>KPI РП: план vs факт (всё время / по фильтру)</h3>
          <div class="help">Индикаторы: отклонение себестоимости и срока в процентах (Σфакт vs Σплан). Отрицательное значение = факт лучше плана (зелёная зона справа). Положительное = перерасход/пересрок (красная зона слева).</div>
          <div id="pm_dials" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap:12px"></div>
        </div>

        <hr class="hr"/>
        <div class="chart">
          <h3>Статусы работ по РП (stacked)</h3>
          <div class="help">Счётчик по текущему статусу работ в выбранном периоде.</div>
          <canvas id="c_status" class="asgcanvas" height="360"></canvas>
        </div>

        <hr class="hr"/>
        <div class="chart">
          <h3>Дивергентная диаграмма: Δ срок / Δ себестоимость (по РП)</h3>
          <div class="help">Δ срок = end_fact − end_plan (дни). Δ себестоимость = cost_fact − cost_plan.</div>
          <canvas id="c_div" class="asgcanvas" height="360"></canvas>
        </div>
      </div>
    `;
    await layout(body,{title:title||"Ярл • Аналитика Работ"});

    const kpiBox=$("#kpi");
    const dialBox=$("#pm_dials");
    const cStatus=$("#c_status");
    const cDiv=$("#c_div");

    function pickMode(){
      const mode=$("#f_mode").value;
      $("#box_year").style.display = (mode==="year") ? "block" : "none";
      $("#box_month").style.display = (mode==="month") ? "block" : "none";
    }

    function getRange(){
      const mode=$("#f_mode").value;
      return mkRange(mode, $("#f_year").value, $("#f_month").value);
    }

    function workDateForFilter(w){
      const t = tenders.find(x=>x.id===w.tender_id);
      return toDate(w.start_in_work_date) || toDate(t?.work_start_plan) || toDate(w.created_at) || toDate(t?.created_at);
    }



    function pct(n){
      if(n===null||n===undefined) return null;
      const x=Number(n);
      if(!isFinite(x)) return null;
      return x;
    }

    function safePct(planSum, factSum){
      const p=Number(planSum||0); const f=Number(factSum||0);
      if(!isFinite(p) || p<=0) return null;
      return ((f-p)/p)*100;
    }

    function durDays(startIso, endIso){
      const a=toDate(startIso); const b=toDate(endIso);
      if(!a||!b) return null;
      const ms=b.getTime()-a.getTime();
      const d=Math.round(ms/(24*3600*1000));
      return isFinite(d)?Math.max(0,d):null;
    }

    function apply(){
      const pmId = $("#f_pm").value;
      const range = getRange();

      const wList = works.filter(w=>{
        if(pmId && String(w.pm_id)!==String(pmId)) return false;
        const dt = workDateForFilter(w);
        if(!inRange(dt, range)) return false;
        return true;
      });

      const total = wList.length;
      const got = wList.reduce((s,w)=>s+Number(w.advance_received||0)+Number(w.balance_received||0),0);
      const due = wList.reduce((s,w)=>{
        if(w.contract_value==null) return s;
        const g=Number(w.advance_received||0)+Number(w.balance_received||0);
        return s+Math.max(0, Number(w.contract_value)-g);
      },0);

      const deltas = wList.map(w=>({
        ds: diffDays(w.end_plan, w.end_fact),
        dc: (w.cost_plan!=null && w.cost_fact!=null) ? (Number(w.cost_fact)-Number(w.cost_plan)) : null
      }));
      const dsVals = deltas.map(x=>x.ds).filter(x=>x!=null);
      const dcVals = deltas.map(x=>x.dc).filter(x=>x!=null);
      const avgDelay = dsVals.length ? Math.round(dsVals.reduce((a,b)=>a+b,0)/dsVals.length) : null;
      const avgCostDelta = dcVals.length ? Math.round(dcVals.reduce((a,b)=>a+b,0)/dcVals.length) : null;

      kpiBox.innerHTML = `
        <div class="k"><div class="t">Период</div><div class="v">${esc(range.label)}</div><div class="s">фильтр</div></div>
        <div class="k"><div class="t">Работ</div><div class="v">${total}</div><div class="s">в периоде</div></div>
        <div class="k"><div class="t">Получено (всего)</div><div class="v">${money(Math.round(got))} ₽</div><div class="s">авансы + остатки</div></div>
        <div class="k"><div class="t">Должны</div><div class="v">${money(Math.round(due))} ₽</div><div class="s">остаток к оплате</div></div>
        <div class="k"><div class="t">Средний Δ срок</div><div class="v">${avgDelay==null?"—":avgDelay+" дн"}</div><div class="s">план vs факт</div></div>
        <div class="k"><div class="t">Средний Δ себест</div><div class="v">${avgCostDelta==null?"—":money(avgCostDelta)+" ₽"}</div><div class="s">план vs факт</div></div>
      `;


      // PM KPI dials: percent deltas across works with plan+fact
      const showPms = pmId ? pms.filter(p=>String(p.id)===String(pmId)) : pms;
      const cards = showPms.map(pm=>{
        const items = wList.filter(w=>String(w.pm_id)===String(pm.id));
        const costItems = items.filter(w=>w.cost_plan!=null && w.cost_fact!=null);
        const planCost = costItems.reduce((s,w)=>s+Number(w.cost_plan||0),0);
        const factCost = costItems.reduce((s,w)=>s+Number(w.cost_fact||0),0);
        const costPct = safePct(planCost, factCost);

        const timeItems = items.filter(w=>w.start_in_work_date && w.end_plan && w.end_fact);
        const planDur = timeItems.reduce((s,w)=>{ const d=durDays(w.start_in_work_date, w.end_plan); return s+(d||0); },0);
        const factDur = timeItems.reduce((s,w)=>{ const d=durDays(w.start_in_work_date, w.end_fact); return s+(d||0); },0);
        const timePct = safePct(planDur, factDur);

        const cid1 = `dial_cost_${pm.id}`;
        const cid2 = `dial_time_${pm.id}`;
        return `
          <div class="pill" style="display:grid; gap:10px; padding:12px">
            <div class="who"><b>${esc(pm.name)}</b></div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; align-items:center">
              <div>
                <div class="help" style="margin-bottom:6px">Себестоимость (план→факт)</div>
                <canvas id="${cid1}" class="asgcanvas" style="width:100%; height:150px"></canvas>
              </div>
              <div>
                <div class="help" style="margin-bottom:6px">Срок (план→факт)</div>
                <canvas id="${cid2}" class="asgcanvas" style="width:100%; height:150px"></canvas>
              </div>
            </div>
          </div>`;
      }).join('');
      dialBox.innerHTML = cards || `<div class="help">Нет данных план/факт для расчёта KPI по выбранному фильтру.</div>`;

      // draw dials (skip in Safe Mode)
      if(!isSafe()){
        showPms.forEach(pm=>{
          const items = wList.filter(w=>String(w.pm_id)===String(pm.id));
          const costItems = items.filter(w=>w.cost_plan!=null && w.cost_fact!=null);
          const planCost = costItems.reduce((s,w)=>s+Number(w.cost_plan||0),0);
          const factCost = costItems.reduce((s,w)=>s+Number(w.cost_fact||0),0);
          const costPct = safePct(planCost, factCost);

          const timeItems = items.filter(w=>w.start_in_work_date && w.end_plan && w.end_fact);
          const planDur = timeItems.reduce((s,w)=>{ const d=durDays(w.start_in_work_date, w.end_plan); return s+(d||0); },0);
          const factDur = timeItems.reduce((s,w)=>{ const d=durDays(w.start_in_work_date, w.end_fact); return s+(d||0); },0);
          const timePct = safePct(planDur, factDur);

          const c1 = document.getElementById(`dial_cost_${pm.id}`);
          const c2 = document.getElementById(`dial_time_${pm.id}`);
          if(c1) dial(c1, costPct, {title:'Δ %', subtitle:'себест'});
          if(c2) dial(c2, timePct, {title:'Δ %', subtitle:'срок'});
        });
      }else{
        dialBox.insertAdjacentHTML('afterbegin', `<div class="help">Safe Mode: графики отключены.</div>`);
      }

      // Status list and colors.
      const statusList = (refs.work_statuses||[]).length ? refs.work_statuses.slice() : Array.from(new Set(wList.map(w=>w.work_status||"—")));
      const palette = ["rgba(30,58,138,.85)","rgba(220,38,38,.80)","rgba(15,118,110,.80)","rgba(168,85,247,.75)","rgba(245,158,11,.80)","rgba(51,65,85,.70)"];
      const colorMap = {};
      statusList.forEach((s,i)=>{ colorMap[s] = (app.status_colors?.work||{})[s] || palette[i%palette.length]; });

      // Stacked status by PM.
      const rows = pms.map(pm=>{
        const items = wList.filter(w=>String(w.pm_id)===String(pm.id));
        const segs = statusList.map(st=>({key:st, value: items.filter(w=>(w.work_status||"—")===st).length}));
        return { label: pm.name, segments: segs };
      }).filter(r=>r.segments.some(s=>s.value>0));
      if(!isSafe()) stackedBar(cStatus, rows, { colorMap, legendTitle:"Статусы" });

      // Divergent by PM: averages.
      const dRows = pms.map(pm=>{
        const items = wList.filter(w=>String(w.pm_id)===String(pm.id));
        const ds = items.map(w=>diffDays(w.end_plan, w.end_fact)).filter(x=>x!=null);
        const dc = items.map(w=> (w.cost_plan!=null && w.cost_fact!=null) ? (Number(w.cost_fact)-Number(w.cost_plan)) : null).filter(x=>x!=null);
        const avgDs = ds.length ? (ds.reduce((a,b)=>a+b,0)/ds.length) : null;
        const avgDc = dc.length ? (dc.reduce((a,b)=>a+b,0)/dc.length) : null;
        return { label: pm.name, a: avgDs, b: avgDc };
      }).filter(r=>r.a!=null || r.b!=null);
      if(!isSafe()) divergent(cDiv, dRows, {
        aLabel: "Δ срок (дн)",
        bLabel: "Δ себест (₽)",
        aFmt: (v)=> (v==null?"—":`${Math.round(v)}`),
        bFmt: (v)=> (v==null?"—":money(Math.round(v))),
      });
    }

    pickMode();
    apply();

    $("#f_mode").addEventListener("change", ()=>{ pickMode(); apply(); });
    $("#f_year").addEventListener("input", apply);
    $("#f_month").addEventListener("input", apply);
    $("#f_pm").addEventListener("change", apply);

    $("#btnGantt").addEventListener("click", async ()=>{
      const settings = await (async()=>{ const s=await AsgardDB.get("settings","app"); return s?JSON.parse(s.value_json||"{}"):{}; })();
      const startIso=(settings.gantt_start_iso||"2026-01-01T00:00:00.000Z").slice(0,10);
      const rows = works.map(w=>{
        const t=tenders.find(x=>x.id===w.tender_id);
        const start = w.start_in_work_date || t?.work_start_plan || w.end_plan || "2026-01-01";
        const end = w.end_fact || w.end_plan || t?.work_end_plan || start;
        return {start,end,label:(w.company||t?.customer_name||""),sub:(w.work_title||t?.tender_title||""),barText:w.work_status||"",status:w.work_status||""};
      });
      const html = AsgardGantt.renderBoard({startIso, weeks: 60, rows, getColor:(r)=>(settings.status_colors?.work||{})[r.status]||"#2a6cf1"});
      showModal("Гантт • Все работы", `<div style="max-height:80vh; overflow:auto">${html}</div>`);
    });
  }

  return { render };
})();
