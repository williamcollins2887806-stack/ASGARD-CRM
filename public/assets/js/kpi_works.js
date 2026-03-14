/**
 * ASGARD CRM — KPI по работам
 * Аналитика: себестоимость, сроки, конверсия, общий балл
 */

window.AsgardKpiWorksPage=(function(){
  const { $, esc, showModal } = AsgardUI;
  const { stackedBar, divergent, dial, scoreRing } = AsgardCharts;

  function isSafe(){ try{return AsgardSafeMode.isOn();}catch(e){return false;} }
  function money(x){ if(x===null||x===undefined||x==="") return "\u2014"; const n=Number(x); if(isNaN(n)) return esc(String(x)); return n.toLocaleString("ru-RU"); }

  function safeNumber(value){ const n = Number(value); return Number.isFinite(n) ? n : 0; }

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
    if(mode==="all") return {start:null, end:null, label:"\u0412\u0441\u0451 \u0432\u0440\u0435\u043c\u044f"};
    if(mode==="last12"){
      const end = addMonths(startOfMonth(new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1))), 1);
      const start = addMonths(end, -12);
      return {start, end, label:"\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0435 12 \u043c\u0435\u0441\u044f\u0446\u0435\u0432"};
    }
    if(mode==="year"){
      const y = Number(yearStr||now.getFullYear());
      const start = new Date(Date.UTC(y,0,1,0,0,0));
      const end = new Date(Date.UTC(y+1,0,1,0,0,0));
      return {start, end, label:`${y} \u0433\u043e\u0434`};
    }
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
    return Math.round((db.getTime()-da.getTime())/(24*3600*1000));
  }

  async function getUsers(){ return (await AsgardDB.all("users")).filter(u=>u.is_active && u.name && u.name.trim()); }
  async function getRefs(){
    const refs = await AsgardDB.get("settings","refs");
    return refs ? JSON.parse(refs.value_json||"{}") : { work_statuses:[] };
  }
  async function getApp(){
    const s=await AsgardDB.get("settings","app");
    return s?JSON.parse(s.value_json||"{}"):{};
  }

  function generateYearOptions(currentYear) {
    let html = '';
    for (let y = currentYear; y >= currentYear - 5; y--) {
      html += `<option value="${y}"${y === currentYear ? ' selected' : ''}>${y}</option>`;
    }
    return html;
  }

  function generatePeriodOptions(currentYm) {
    const now = new Date();
    let html = '';
    for (let i = 0; i < 24; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
      html += `<option value="${val}"${val === currentYm ? ' selected' : ''}>${label}</option>`;
    }
    return html;
  }

  function safePct(plan, fact){
    const p=Number(plan||0); const f=Number(fact||0);
    if(!isFinite(p) || p<=0) return null;
    return ((f-p)/p)*100;
  }

  function durDays(a, b){
    const da=toDate(a); const db=toDate(b);
    if(!da||!db) return null;
    const d=Math.round((db.getTime()-da.getTime())/(24*3600*1000));
    return isFinite(d)?Math.max(0,d):null;
  }

  // Deviation % -> score 0-100 (0% dev = 100, >=100% dev = 0)
  function deviationToScore(pct){
    if(pct===null || pct===undefined) return null;
    return Math.max(0, Math.round(100 - Math.abs(pct)));
  }

  // Conversion rate -> normalized score (30% conv = 100 score)
  function conversionToScore(rate){
    if(rate===null || rate===undefined) return null;
    return Math.min(100, Math.round(rate * (100/30)));
  }

  function calcCombined(costScore, timeScore, convScore){
    const vals = [];
    if(costScore!==null && costScore!==undefined) vals.push({s:costScore,w:0.35});
    if(timeScore!==null && timeScore!==undefined) vals.push({s:timeScore,w:0.35});
    if(convScore!==null && convScore!==undefined) vals.push({s:convScore,w:0.30});
    if(vals.length === 0) return null;
    const totalW = vals.reduce((a,v)=>a+v.w,0);
    return Math.round(vals.reduce((a,v)=>a+v.s*v.w,0) / totalW);
  }

  function scoreColor(s){
    if(s===null||s===undefined) return 'var(--text-muted)';
    if(s >= 75) return 'var(--success, #22c55e)';
    if(s >= 50) return 'var(--warning, #f59e0b)';
    if(s >= 25) return '#f97316';
    return 'var(--danger, #dc2626)';
  }

  function scoreGrade(s){
    if(s===null) return '\u2014';
    if(s >= 90) return 'S';
    if(s >= 75) return 'A';
    if(s >= 60) return 'B';
    if(s >= 45) return 'C';
    if(s >= 30) return 'D';
    return 'F';
  }

  async function render({layout,title}){
    const auth=await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }

    const users=await getUsers();
    const byId=new Map(users.map(u=>[u.id,u]));
    const refs=await getRefs();
    const app=await getApp();

    const tenders=await AsgardDB.all("tenders");
    const works=await AsgardDB.all("works");

    /* PM = users with role PM + anyone assigned as pm_id on works */
    const pmById=new Map();
    users.filter(u=>u.role==="PM" || (Array.isArray(u.roles) && u.roles.includes("PM"))).forEach(u=>pmById.set(u.id,u));
    works.forEach(w=>{ if(w.pm_id && byId.has(w.pm_id) && !pmById.has(w.pm_id)) pmById.set(w.pm_id, byId.get(w.pm_id)); });
    const pms=[...pmById.values()];

    const now=new Date();
    const yNow=now.getFullYear();
    const ymNow=`${yNow}-${String(now.getMonth()+1).padStart(2,"0")}`;

    const body=`
      ${window.__ASG_SHARED_TABLE_CSS__||""}
      <style>
        .kpi-pm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:var(--sp-4)}
        .kpi-pm-card{background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:20px;cursor:pointer;transition:all .2s;position:relative;overflow:hidden}
        .kpi-pm-card:hover{border-color:var(--primary,#D4AF37);box-shadow:0 4px 16px rgba(0,0,0,.15);transform:translateY(-2px)}
        .kpi-pm-head{display:flex;align-items:center;gap:14px;margin-bottom:12px}
        .kpi-pm-avatar{width:40px;height:40px;border-radius:50%;background:var(--bg-hover);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:var(--text-primary);flex-shrink:0}
        .kpi-pm-avatar img{width:40px;height:40px;border-radius:50%;object-fit:cover}
        .kpi-pm-name{font-weight:600;font-size:14px;line-height:1.3}
        .kpi-pm-sub{font-size:11px;color:var(--text-muted)}
        .kpi-pm-bars{display:grid;gap:6px;margin-top:12px}
        .kpi-bar-row{display:grid;grid-template-columns:80px 1fr 44px;align-items:center;gap:6px;font-size:11px}
        .kpi-bar-label{color:var(--text-muted);text-transform:uppercase;letter-spacing:.03em}
        .kpi-bar-track{height:5px;border-radius:3px;background:rgba(42,59,102,.2);overflow:hidden}
        .kpi-bar-fill{height:100%;border-radius:3px;transition:width .4s ease}
        .kpi-bar-val{text-align:right;font-weight:600;font-size:12px}
        .kpi-grade{position:absolute;top:10px;right:12px;font-size:20px;font-weight:800;opacity:.12;letter-spacing:-1px}
        .kpi-detail-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:16px}
        .kpi-detail-card{text-align:center;padding:16px;background:var(--bg-hover);border-radius:10px}
        .kpi-detail-card h4{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);margin-bottom:8px}
        .kpi-detail-value{font-size:24px;font-weight:700;margin:4px 0}
        .kpi-detail-hint{font-size:11px;color:var(--text-muted);margin-top:2px}
        .kpi-funnel{display:flex;align-items:center;gap:8px;justify-content:center;margin:8px 0;font-size:14px}
        .kpi-funnel-num{font-weight:700;font-size:18px}
        .kpi-funnel-arrow{color:var(--text-muted);font-size:18px}
        .kpi-combined-row{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;font-size:13px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)}
        /* ═══ MOBILE_KPI_PREMIUM ═══ */
        @media(max-width:768px){
          .kpi-pm-grid{grid-template-columns:1fr !important;gap:10px !important}
          .kpi-pm-card{padding:14px !important;border-radius:14px !important}
          .kpi-pm-head{gap:10px !important;margin-bottom:8px !important}
          .kpi-pm-avatar{width:36px !important;height:36px !important;font-size:14px !important}
          .kpi-pm-name{font-size:14px !important}
          .kpi-pm-sub{font-size:10px !important}
          .kpi-bar-row{grid-template-columns:60px 1fr 40px !important;font-size:10px !important}
          .kpi-detail-grid{grid-template-columns:1fr 1fr !important;gap:8px !important}
          .kpi-detail-card{padding:10px !important;border-radius:10px !important}
          .kpi-detail-card h4{font-size:9px !important}
          .kpi-detail-value{font-size:18px !important}
          .kpi-funnel{font-size:12px !important}
          .kpi-funnel-num{font-size:15px !important}
          .kpi-combined-row{font-size:11px !important;gap:6px !important}
        }
      </style>
      <div class="kpi-works-page">
        <div class="panel" style="margin-bottom:var(--sp-6);">
          <div class="tools">
            <div class="field"><label>\u041f\u0435\u0440\u0438\u043e\u0434</label>
              <select id="f_mode">
                <option value="all">\u0412\u0441\u0451 \u0432\u0440\u0435\u043c\u044f</option>
                <option value="year">\u0413\u043e\u0434</option>
                <option value="month" selected>\u041c\u0435\u0441\u044f\u0446</option>
                <option value="last12">\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0435 12 \u043c\u0435\u0441\u044f\u0446\u0435\u0432</option>
              </select>
            </div>
            <div class="field" id="box_year" style="display:none"><label>\u0413\u043e\u0434</label><select id="f_year">${generateYearOptions(yNow)}</select></div>
            <div class="field" id="box_month"><label>\u041c\u0435\u0441\u044f\u0446</label><select id="f_month">${generatePeriodOptions(ymNow)}</select></div>
            <div class="field"><label>\u0420\u041f</label>
              <select id="f_pm"><option value="">\u0412\u0441\u0435</option>${pms.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>
            </div>
            <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end">
              <button class="btn ghost mini" id="btnGantt">\u0413\u0430\u043d\u0442\u0442</button>
            </div>
          </div>
        </div>

        <div class="kpi" id="kpi"></div>

        <div class="chart">
          <h3>KPI \u0420\u041f \u2014 \u041e\u0431\u0449\u0438\u0439 \u0440\u0435\u0439\u0442\u0438\u043d\u0433</h3>
          <p class="help">\u041a\u043b\u0438\u043a\u043d\u0438\u0442\u0435 \u043d\u0430 \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0443 \u0420\u041f \u0434\u043b\u044f \u043f\u043e\u0434\u0440\u043e\u0431\u043d\u043e\u0433\u043e \u0440\u0430\u0437\u0431\u043e\u0440\u0430. \u0411\u0430\u043b\u043b = \u0441\u0435\u0431\u0435\u0441\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u044c (35%) + \u0441\u0440\u043e\u043a\u0438 (35%) + \u043a\u043e\u043d\u0432\u0435\u0440\u0441\u0438\u044f (30%)</p>
          <div id="pm_dials" class="kpi-pm-grid"></div>
        </div>

        <div class="chart">
          <h3>\u0421\u0442\u0430\u0442\u0443\u0441\u044b \u0440\u0430\u0431\u043e\u0442 \u043f\u043e \u0420\u041f</h3>
          <p class="help">\u0421\u0447\u0451\u0442\u0447\u0438\u043a \u043f\u043e \u0442\u0435\u043a\u0443\u0449\u0435\u043c\u0443 \u0441\u0442\u0430\u0442\u0443\u0441\u0443 \u0440\u0430\u0431\u043e\u0442.</p>
          <div id="c_status"></div>
        </div>

        <div class="chart">
          <h3>\u0414\u0438\u0432\u0435\u0440\u0433\u0435\u043d\u0442\u043d\u0430\u044f: \u0394 \u0441\u0440\u043e\u043a / \u0394 \u0441\u0435\u0431\u0435\u0441\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u044c</h3>
          <p class="help">\u0394 \u0441\u0440\u043e\u043a = end_fact \u2212 end_plan (\u0434\u043d\u0438). \u0394 \u0441\u0435\u0431\u0435\u0441\u0442. = cost_fact \u2212 cost_plan.</p>
          <canvas id="c_div" class="asgcanvas" height="360"></canvas>
        </div>
      </div>
    `;
    await layout(body,{title:title||"\u042f\u0440\u043b \u2022 \u0410\u043d\u0430\u043b\u0438\u0442\u0438\u043a\u0430 \u0420\u0430\u0431\u043e\u0442"});

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

    function tenderDateForFilter(t){
      return toDate(t.created_at);
    }

    const tenderIdsWithWork = new Set(works.map(w=>w.tender_id).filter(Boolean));

    function calcPmKpi(pm, wList, range){
      const items = wList.filter(w=>String(w.pm_id)===String(pm.id));

      // 1. Cost
      const costItems = items.filter(w=>w.cost_plan!=null && w.cost_fact!=null);
      const planCost = costItems.reduce((s,w)=>s+safeNumber(w.cost_plan),0);
      const factCost = costItems.reduce((s,w)=>s+safeNumber(w.cost_fact),0);
      const costPct = safePct(planCost, factCost);
      const costS = deviationToScore(costPct);

      // 2. Time
      const timeItems = items.filter(w=>w.start_in_work_date && w.end_plan && w.end_fact);
      const planDur = timeItems.reduce((s,w)=>{ const d=durDays(w.start_in_work_date, w.end_plan); return s+(d||0); },0);
      const factDur = timeItems.reduce((s,w)=>{ const d=durDays(w.start_in_work_date, w.end_fact); return s+(d||0); },0);
      const timePct = safePct(planDur, factDur);
      const timeS = deviationToScore(timePct);

      // 3. Conversion
      const pmTenders = tenders.filter(t=>{
        const pmMatch = String(t.pm_id)===String(pm.id) || String(t.responsible_pm_id)===String(pm.id);
        if(!pmMatch) return false;
        return inRange(tenderDateForFilter(t), range);
      });
      const pmTendersWon = pmTenders.filter(t=>tenderIdsWithWork.has(t.id));
      const convRate = pmTenders.length > 0 ? (pmTendersWon.length / pmTenders.length) * 100 : null;
      const convS = conversionToScore(convRate);

      // 4. Combined
      const combined = calcCombined(costS, timeS, convS);

      return {
        pm, items,
        costPct, costScore: costS, planCost, factCost, costItemsCnt: costItems.length,
        timePct, timeScore: timeS, planDur, factDur, timeItemsCnt: timeItems.length,
        convRate, convScore: convS, totalTenders: pmTenders.length, wonTenders: pmTendersWon.length,
        combined
      };
    }

    function showPmDetail(kpi){
      const { pm, costPct, costScore, planCost, factCost, costItemsCnt,
              timePct, timeScore, planDur, factDur, timeItemsCnt,
              convRate, convScore, totalTenders, wonTenders,
              combined, items } = kpi;

      const everyNth = convRate > 0 ? Math.round(100/convRate) : null;

      const html = `
        <div style="text-align:center;margin-bottom:16px">
          <div style="font-size:44px;font-weight:800;color:${scoreColor(combined)}">${combined!==null?combined:'\u2014'}</div>
          <div style="font-size:13px;color:var(--text-muted)">\u041e\u0431\u0449\u0438\u0439 KPI \u2022 \u0413\u0440\u0435\u0439\u0434 <b>${scoreGrade(combined)}</b></div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${items.length} \u0440\u0430\u0431\u043e\u0442 \u0432 \u043f\u0435\u0440\u0438\u043e\u0434\u0435</div>
        </div>

        <div class="kpi-detail-grid">
          <div class="kpi-detail-card">
            <h4>\u0421\u0435\u0431\u0435\u0441\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u044c</h4>
            <canvas id="md_cost_dial" class="asgcanvas" style="width:100%;height:120px"></canvas>
            <div class="kpi-detail-value" style="color:${scoreColor(costScore)}">${costScore!==null?costScore+'/100':'\u2014'}</div>
            <div class="kpi-detail-hint">\u0394: ${costPct!==null?Math.round(costPct)+'%':'\u043d/\u0434'}</div>
            <div class="kpi-detail-hint">\u041f\u043b\u0430\u043d ${money(Math.round(planCost))}\u20bd / \u0424\u0430\u043a\u0442 ${money(Math.round(factCost))}\u20bd</div>
            <div class="kpi-detail-hint">\u0420\u0430\u0431\u043e\u0442: ${costItemsCnt}</div>
          </div>

          <div class="kpi-detail-card">
            <h4>\u0421\u0440\u043e\u043a\u0438</h4>
            <canvas id="md_time_dial" class="asgcanvas" style="width:100%;height:120px"></canvas>
            <div class="kpi-detail-value" style="color:${scoreColor(timeScore)}">${timeScore!==null?timeScore+'/100':'\u2014'}</div>
            <div class="kpi-detail-hint">\u0394: ${timePct!==null?Math.round(timePct)+'%':'\u043d/\u0434'}</div>
            <div class="kpi-detail-hint">\u041f\u043b\u0430\u043d ${planDur} \u0434\u043d / \u0424\u0430\u043a\u0442 ${factDur} \u0434\u043d</div>
            <div class="kpi-detail-hint">\u0420\u0430\u0431\u043e\u0442: ${timeItemsCnt}</div>
          </div>

          <div class="kpi-detail-card">
            <h4>\u041a\u043e\u043d\u0432\u0435\u0440\u0441\u0438\u044f</h4>
            <div style="margin:12px 0">
              <div class="kpi-funnel">
                <span class="kpi-funnel-num">${totalTenders}</span>
                <span class="kpi-funnel-arrow">\u2192</span>
                <span class="kpi-funnel-num" style="color:var(--success,#22c55e)">${wonTenders}</span>
              </div>
              <div style="font-size:11px;color:var(--text-muted)">\u0442\u0435\u043d\u0434\u0435\u0440\u043e\u0432 \u2192 \u0434\u043e\u0433\u043e\u0432\u043e\u0440\u043e\u0432</div>
            </div>
            <div class="kpi-detail-value" style="color:${scoreColor(convScore)}">${convRate!==null?Math.round(convRate)+'%':'\u2014'}</div>
            <div class="kpi-detail-hint">\u0411\u0430\u043b\u043b: ${convScore!==null?convScore+'/100':'\u2014'}</div>
            ${everyNth ? `<div class="kpi-detail-hint">\u041a\u0430\u0436\u0434\u044b\u0439 ${everyNth}-\u0439 \u0442\u0435\u043d\u0434\u0435\u0440 = \u0434\u043e\u0433\u043e\u0432\u043e\u0440</div>` : ''}
          </div>
        </div>

        <div class="kpi-combined-row">
          <span>\u0421\u0435\u0431\u0435\u0441\u0442. <b>${costScore!==null?costScore:'\u2014'}</b>\u00d70.35</span>
          <span>+</span>
          <span>\u0421\u0440\u043e\u043a\u0438 <b>${timeScore!==null?timeScore:'\u2014'}</b>\u00d70.35</span>
          <span>+</span>
          <span>\u041a\u043e\u043d\u0432. <b>${convScore!==null?convScore:'\u2014'}</b>\u00d70.30</span>
          <span>=</span>
          <span style="font-size:18px;font-weight:700;color:${scoreColor(combined)}"><b>${combined!==null?combined:'\u2014'}</b></span>
        </div>
      `;

      showModal(`KPI \u2022 ${esc(pm.name)}`, `<div style="max-width:680px">${html}</div>`);

      setTimeout(()=>{
        if(!isSafe()){
          const c1 = document.getElementById('md_cost_dial');
          const c2 = document.getElementById('md_time_dial');
          if(c1) dial(c1, costPct, {title:'\u0394 %', subtitle:'\u0441\u0435\u0431\u0435\u0441\u0442', height:120});
          if(c2) dial(c2, timePct, {title:'\u0394 %', subtitle:'\u0441\u0440\u043e\u043a', height:120});
        }
      }, 100);
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
      const got = wList.reduce((s,w)=>s+safeNumber(w.advance_received)+safeNumber(w.balance_received),0);
      const due = wList.reduce((s,w)=>{
        if(w.contract_value==null) return s;
        const g=safeNumber(w.advance_received)+safeNumber(w.balance_received);
        return s+Math.max(0, safeNumber(w.contract_value)-g);
      },0);

      const deltas = wList.map(w=>({
        ds: diffDays(w.end_plan, w.end_fact),
        dc: (w.cost_plan!=null && w.cost_fact!=null) ? (safeNumber(w.cost_fact)-safeNumber(w.cost_plan)) : null
      }));
      const dsVals = deltas.map(x=>x.ds).filter(x=>x!=null);
      const dcVals = deltas.map(x=>x.dc).filter(x=>x!=null);
      const avgDelay = dsVals.length ? Math.round(dsVals.reduce((a,b)=>a+b,0)/dsVals.length) : null;
      const avgCostDelta = dcVals.length ? Math.round(dcVals.reduce((a,b)=>a+b,0)/dcVals.length) : null;

      const filteredTenders = tenders.filter(t=>{
        if(pmId && String(t.pm_id)!==String(pmId) && String(t.responsible_pm_id)!==String(pmId)) return false;
        return inRange(tenderDateForFilter(t), range);
      });
      const filteredWon = filteredTenders.filter(t=>tenderIdsWithWork.has(t.id));
      const globalConv = filteredTenders.length > 0 ? Math.round((filteredWon.length/filteredTenders.length)*100) : null;

      kpiBox.innerHTML = `
        <div class="k"><div class="t">\u041f\u0435\u0440\u0438\u043e\u0434</div><div class="v" style="font-size:16px">${esc(range.label)}</div><div class="s">\u0444\u0438\u043b\u044c\u0442\u0440</div></div>
        <div class="k"><div class="t">\u0420\u0430\u0431\u043e\u0442</div><div class="v">${total}</div><div class="s">\u0432 \u043f\u0435\u0440\u0438\u043e\u0434\u0435</div></div>
        <div class="k"><div class="t">\u041f\u043e\u043b\u0443\u0447\u0435\u043d\u043e</div><div class="v" style="font-size:16px">${money(Math.round(got))} \u20bd</div><div class="s">\u0430\u0432\u0430\u043d\u0441\u044b + \u043e\u0441\u0442\u0430\u0442\u043a\u0438</div></div>
        <div class="k"><div class="t">\u0414\u043e\u043b\u0436\u043d\u044b</div><div class="v" style="font-size:16px;${due > 0 ? 'color:var(--danger)' : ''}">${money(Math.round(due))} \u20bd</div><div class="s">\u043e\u0441\u0442\u0430\u0442\u043e\u043a</div></div>
        <div class="k"><div class="t">\u041a\u043e\u043d\u0432\u0435\u0440\u0441\u0438\u044f</div><div class="v" style="color:${globalConv!==null&&globalConv>=20?'var(--success)':'var(--warning)'}">${globalConv!==null?globalConv+'%':'\u2014'}</div><div class="s">${filteredWon.length} \u0438\u0437 ${filteredTenders.length}</div></div>
        <div class="k"><div class="t">\u0421\u0440. \u0394 \u0441\u0440\u043e\u043a</div><div class="v" style="${avgDelay && avgDelay > 0 ? 'color:var(--danger)' : avgDelay && avgDelay < 0 ? 'color:var(--success)' : ''}">${avgDelay==null?"\u2014":avgDelay+" \u0434\u043d"}</div><div class="s">\u043f\u043b\u0430\u043d vs \u0444\u0430\u043a\u0442</div></div>
      `;

      // PM KPI cards
      const showPms = pmId ? pms.filter(p=>String(p.id)===String(pmId)) : pms;
      const pmKpis = showPms.map(pm=>calcPmKpi(pm, wList, range)).sort((a,b)=>(b.combined||0)-(a.combined||0));

      const cards = pmKpis.map(kpi=>{
        const { pm, items, costScore, timeScore, convScore, convRate, combined } = kpi;
        const initials = (pm.name||'').split(' ').map(w=>w[0]).join('').slice(0,2);
        const avatar = pm.photo_url ? `<img src="${esc(pm.photo_url)}" alt=""/>` : esc(initials);
        return `
          <div class="kpi-pm-card" data-pm="${pm.id}">
            <div class="kpi-grade">${scoreGrade(combined)}</div>
            <div class="kpi-pm-head">
              <div class="kpi-pm-avatar">${avatar}</div>
              <div>
                <div class="kpi-pm-name">${esc(pm.name)}</div>
                <div class="kpi-pm-sub">${items.length} \u0440\u0430\u0431\u043e\u0442 \u2022 ${kpi.totalTenders} \u0442\u0435\u043d\u0434.</div>
              </div>
            </div>
            <div style="text-align:center;margin:4px 0">
              <div style="font-size:32px;font-weight:800;color:${scoreColor(combined)}">${combined!==null?combined:'\u2014'}</div>
              <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">\u041e\u0431\u0449\u0438\u0439 KPI</div>
            </div>
            <div class="kpi-pm-bars">
              <div class="kpi-bar-row">
                <span class="kpi-bar-label">\u0421\u0435\u0431\u0435\u0441\u0442.</span>
                <div class="kpi-bar-track"><div class="kpi-bar-fill" style="width:${costScore||0}%;background:${scoreColor(costScore)}"></div></div>
                <span class="kpi-bar-val" style="color:${scoreColor(costScore)}">${costScore!==null?costScore:'\u2014'}</span>
              </div>
              <div class="kpi-bar-row">
                <span class="kpi-bar-label">\u0421\u0440\u043e\u043a\u0438</span>
                <div class="kpi-bar-track"><div class="kpi-bar-fill" style="width:${timeScore||0}%;background:${scoreColor(timeScore)}"></div></div>
                <span class="kpi-bar-val" style="color:${scoreColor(timeScore)}">${timeScore!==null?timeScore:'\u2014'}</span>
              </div>
              <div class="kpi-bar-row">
                <span class="kpi-bar-label">\u041a\u043e\u043d\u0432\u0435\u0440\u0441.</span>
                <div class="kpi-bar-track"><div class="kpi-bar-fill" style="width:${convScore||0}%;background:${scoreColor(convScore)}"></div></div>
                <span class="kpi-bar-val" style="color:${scoreColor(convScore)}">${convRate!==null?Math.round(convRate)+'%':'\u2014'}</span>
              </div>
            </div>
          </div>`;
      }).join('');

      dialBox.innerHTML = cards || `<div style="text-align:center; padding:24px; color:var(--text-muted)">\u041d\u0435\u0442 \u0434\u0430\u043d\u043d\u044b\u0445 \u0434\u043b\u044f KPI.</div>`;

      // Click to open detail modal
      dialBox.querySelectorAll('.kpi-pm-card').forEach(card=>{
        card.addEventListener('click', ()=>{
          const id = Number(card.dataset.pm);
          const kpi = pmKpis.find(k=>k.pm.id===id);
          if(kpi) showPmDetail(kpi);
        });
      });

      // Stacked status bar
      const statusList = (refs.work_statuses||[]).length ? refs.work_statuses.slice() : Array.from(new Set(wList.map(w=>w.work_status||"\u2014")));
      const palette = ["rgba(59,130,246,.85)","rgba(220,38,38,.80)","rgba(15,118,110,.80)","rgba(168,85,247,.75)","rgba(245,158,11,.80)","rgba(51,65,85,.70)"];
      const colorMap = {};
      statusList.forEach((s,i)=>{ colorMap[s] = (app.status_colors?.work||{})[s] || palette[i%palette.length]; });

      const rows = pms.map(pm=>{
        const items = wList.filter(w=>String(w.pm_id)===String(pm.id));
        const segs = statusList.map(st=>({key:st, value: items.filter(w=>(w.work_status||"\u2014")===st).length}));
        const total = segs.reduce((s,p)=>s+p.value,0);
        return { label: pm.name, segments: segs, total };
      }).filter(r=>r.total>0).sort((a,b)=>b.total-a.total);
      const maxTotal = Math.max(1,...rows.map(r=>r.total));
      let sH = '<div style="display:flex;flex-wrap:wrap;gap:14px;margin-bottom:18px">';
      statusList.forEach(st=>{ sH += '<div style="display:flex;align-items:center;gap:6px;font-size:12px"><span style="display:inline-block;width:12px;height:12px;border-radius:4px;background:'+(colorMap[st]||'#666')+'"></span>'+esc(st)+'</div>'; });
      sH += '</div><div style="display:grid;gap:10px">';
      rows.forEach(r=>{
        const barW = Math.max(10,Math.round((r.total/maxTotal)*100));
        let segH = '';
        r.segments.forEach(seg=>{
          if(seg.value<=0) return;
          const pct = Math.max(2, Math.round((seg.value/r.total)*100));
          segH += '<div title="'+esc(seg.key)+': '+seg.value+'" style="width:'+pct+'%;min-width:4px;background:'+(colorMap[seg.key]||'#666')+';height:100%;display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;font-weight:700;overflow:hidden">'+(seg.value>=2?seg.value:'')+'</div>';
        });
        sH += '<div style="display:grid;grid-template-columns:170px 1fr 40px;align-items:center;gap:12px">';
        sH += '<div style="font-size:13px;color:var(--text-primary,#e0e0e0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+esc(r.label)+'">'+esc(r.label)+'</div>';
        sH += '<div style="display:flex;gap:2px;height:28px;width:'+barW+'%;border-radius:6px;overflow:hidden;background:rgba(255,255,255,.05)">'+segH+'</div>';
        sH += '<div style="font-size:14px;font-weight:700;color:var(--text-muted,#999);text-align:right">'+r.total+'</div>';
        sH += '</div>';
      });
      sH += '</div>';
      if(rows.length===0) sH = '<div style="text-align:center;padding:24px;color:var(--text-muted)">Нет данных</div>';
      cStatus.innerHTML = sH;

      // Divergent chart
      const dRows = pms.map(pm=>{
        const items = wList.filter(w=>String(w.pm_id)===String(pm.id));
        const ds = items.map(w=>diffDays(w.end_plan, w.end_fact)).filter(x=>x!=null);
        const dc = items.map(w=> (w.cost_plan!=null && w.cost_fact!=null) ? (safeNumber(w.cost_fact)-safeNumber(w.cost_plan)) : null).filter(x=>x!=null);
        const avgDs = ds.length ? (ds.reduce((a,b)=>a+b,0)/ds.length) : null;
        const avgDc = dc.length ? (dc.reduce((a,b)=>a+b,0)/dc.length) : null;
        return { label: pm.name, a: avgDs, b: avgDc };
      }).filter(r=>r.a!=null || r.b!=null);
      { const old=cDiv.parentElement.querySelector('.div-nodata'); if(old) old.remove(); }
      if(dRows.length===0){
        cDiv.style.display='none';
        cDiv.parentElement.insertAdjacentHTML('beforeend','<div class="div-nodata" style="text-align:center;padding:32px;color:var(--text-muted);font-size:14px">Нет данных. Для отображения графика заполните поля <b>end_plan</b>, <b>end_fact</b>, <b>cost_plan</b>, <b>cost_fact</b> в работах.</div>');
      } else { cDiv.style.display=''; }
      if(!isSafe() && dRows.length>0) divergent(cDiv, dRows, {
        aLabel: "\u0394 \u0441\u0440\u043e\u043a (\u0434\u043d)",
        bLabel: "\u0394 \u0441\u0435\u0431\u0435\u0441\u0442 (\u20bd)",
        aFmt: (v)=> (v==null?"\u2014":`${Math.round(v)}`),
        bFmt: (v)=> (v==null?"\u2014":money(Math.round(v))),
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
        return {start,end,label:(w.customer_name||t?.customer_name||""),sub:(w.work_title||t?.tender_title||""),barText:w.work_status||"",status:w.work_status||""};
      });
      const html = AsgardGantt.renderBoard({startIso, weeks: 60, rows, getColor:(r)=>(settings.status_colors?.work||{})[r.status]||"#2a6cf1"});
      showModal("\u0413\u0430\u043d\u0442\u0442 \u2022 \u0412\u0441\u0435 \u0440\u0430\u0431\u043e\u0442\u044b", `<div style="max-height:80vh; overflow:auto">${html}</div>`);
    });
  }

  return { render };
})();
