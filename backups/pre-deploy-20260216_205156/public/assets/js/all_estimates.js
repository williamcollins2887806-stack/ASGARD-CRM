window.AsgardAllEstimatesPage=(function(){
  const { $, $$, esc, showModal } = AsgardUI;

  function ymNow(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }
  function money(x){ if(x===null||x===undefined||x==="") return "—"; const n=Number(x); if(isNaN(n)) return esc(String(x)); return n.toLocaleString("ru-RU"); }

  function safeParseJSON(s, fallback){
    try{ const v=JSON.parse(s||"{}"); return (v && typeof v==="object")?v:(fallback||{}); }
    catch(_){ return (fallback||{}); }
  }
  function sumCrew(obj){
    if(!obj || typeof obj!=="object") return null;
    let total=0; let any=false;
    for(const k of Object.keys(obj)){
      const n=Number(obj[k]);
      if(Number.isFinite(n)){ total+=n; any=true; }
    }
    return any?total:null;
  }
  function calcView(calc){
    calc = (calc && typeof calc==="object")?calc:{};
    if(calc._type==="asgard_calc_v1"){
      const out=(calc.output&&typeof calc.output==="object")?calc.output:{};
      const dv=(calc.director_view&&typeof calc.director_view==="object")?calc.director_view:{};
      return {
        chemCost: (out.chem && typeof out.chem==="object")?out.chem.cost:null,
        logisticsCost: out.logistics ?? null,
        equipmentCost: out.equipment_total ?? null,
        peopleCount: dv.people ?? out.peopleWork ?? null,
        workDays: dv.work_days ?? out.workDays ?? null,
        director: dv
      };
    }
    if(calc.tkp_total!=null || calc.cost_total!=null || calc.profit_clean!=null){
      const people = calc.people_count ?? sumCrew(calc.crew);
      return {
        chemCost: calc.chemicals_total ?? null,
        logisticsCost: calc.logistics_cost ?? null,
        equipmentCost: calc.equipment_total ?? null,
        peopleCount: people ?? null,
        workDays: calc.work_days ?? null,
        director: { price_tkp_with_vat: calc.tkp_total ?? null, cost_total: calc.cost_total ?? null, net_profit: calc.profit_clean ?? null, people, work_days: calc.work_days ?? null }
      };
    }
    return {
      chemCost: calc.chemistry_cost ?? null,
      logisticsCost: calc.logistics_cost ?? null,
      equipmentCost: calc.equipment_cost ?? null,
      peopleCount: calc.people_count ?? null,
      workDays: calc.work_days ?? null,
      director: (calc.director_view && typeof calc.director_view==="object") ? calc.director_view : null
    };
  }

  async function getUsers(){ return (await AsgardDB.all("users")).filter(u=>u.is_active); }
  async function getSettings(){
    const s = await AsgardDB.get("settings","app");
    return s ? JSON.parse(s.value_json||"{}") : { vat_pct:20 };
  }

  async function render({layout,title}){
    const auth=await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }

    const users=await getUsers();
    const byId=new Map(users.map(u=>[u.id,u]));
    const settings=await getSettings();

    const tenders=await AsgardDB.all("tenders");
    const estimates=await AsgardDB.all("estimates");

    let sortKey="sent_for_approval_at", sortDir=-1;

    const body=`
      ${window.__ASG_SHARED_TABLE_CSS__||""}
      <div class="panel">
        <div class="help">«Свод Расчётов» — все версии просчётов. Девиз: “Счёт точен. Решение крепко. Ошибки не проходят.”</div>
        <hr class="hr"/>
        <div class="tools">
          <div class="field"><label>Период</label><select id="f_period">${generatePeriodOptions(ymNow())}</select></div>
          <div class="field"><label>Поиск</label><input id="f_q" placeholder="заказчик / тендер"/></div>
          <div class="field"><label>РП</label>
            <select id="f_pm"><option value="">Все</option>${users.filter(u=>u.role==="PM" || (Array.isArray(u.roles) && u.roles.includes("PM"))).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>
          </div>
          <div class="field"><label>Статус согласования</label>
            <select id="f_a">
              <option value="">Все</option>
              <option value="draft">draft</option>
              <option value="sent">sent</option>
              <option value="approved">approved</option>
              <option value="rework">rework</option>
              <option value="question">question</option>
            </select>
          </div>
        </div>
        <hr class="hr"/>
        <div style="overflow:auto">
          <table class="asg">
            <thead>
              <tr>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="tender_id">Тендер</button></th>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="pm_id">РП</button></th>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="version_no">Версия</button></th>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="approval_status">Согласование</button></th>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="price_tkp">Цена ТКП</button></th>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="cost_plan">Себест.</button></th>
                <th></th>
              </tr>
            </thead>
            <tbody id="tb"></tbody>
          </table>
        </div>
        <div class="help" id="cnt"></div>
      </div>
    `;
    await layout(body,{title:title||"Свод Расчётов"});

    const tb=$("#tb"), cnt=$("#cnt");

    function norm(s){ return String(s||"").toLowerCase().trim(); }
    function sortBy(key,dir){
      return (a,b)=>{
        const av=(a[key]??""); const bv=(b[key]??"");
        if(typeof av==="number" && typeof bv==="number") return dir*(av-bv);
        return dir*String(av).localeCompare(String(bv),"ru",{sensitivity:"base"});
      };
    }

    function row(e){
      const t=tenders.find(x=>x.id===e.tender_id);
      const pm=byId.get(e.pm_id);
      const priceNoVat = (e.price_tkp!=null) ? Math.round(Number(e.price_tkp)/(1+(Number(settings.vat_pct||0)/100))) : null;
      return `<tr data-id="${e.id}">
        <td><b>${esc(t?.customer_name||"")}</b><div class="help">${esc(t?.tender_title||"")} • period ${esc(t?.period||"")}</div></td>
        <td>${esc(pm?pm.name:"—")}</td>
        <td>#${esc(e.version_no||1)}</td>
        <td><span class="pill">${esc(e.approval_status||"draft")}</span><div class="help">${e.sent_for_approval_at?esc(new Date(e.sent_for_approval_at).toLocaleString("ru-RU")):""}</div></td>
        <td><div><b>${money(e.price_tkp)}</b> ₽</div><div class="help">без НДС: ${priceNoVat==null?"—":money(priceNoVat)} ₽</div></td>
        <td>${money(e.cost_plan)} ₽</td>
        <td><button class="btn" style="padding:6px 10px" data-act="open">Открыть</button></td>
      </tr>`;
    }

    function apply(){
      const per=norm($("#f_period").value);
      const q=norm($("#f_q").value);
      const pm=$("#f_pm").value;
      const a=$("#f_a").value;

      let list=estimates.filter(e=>{
        const t=tenders.find(x=>x.id===e.tender_id);
        if(per && norm(t?.period||"")!==per) return false;
        if(pm && String(e.pm_id)!==String(pm)) return false;
        if(a && (e.approval_status||"draft")!==a) return false;
        if(q){
          const hay = `${t?.customer_name||""} ${t?.tender_title||""}`.toLowerCase();
          if(!hay.includes(q)) return false;
        }
        return true;
      });

      list.sort(sortBy(sortKey,sortDir));
      tb.innerHTML=list.map(row).join("");
      cnt.textContent=`Показано: ${list.length} из ${estimates.length}.`;
    }

    apply();
    $("#f_period").addEventListener("input",apply);
    $("#f_q").addEventListener("input",apply);
    $("#f_pm").addEventListener("change",apply);
    $("#f_a").addEventListener("change",apply);

    $$("[data-sort]").forEach(b=>{
      b.addEventListener("click",()=>{
        const k=b.getAttribute("data-sort");
        if(sortKey===k) sortDir*=-1; else {sortKey=k; sortDir=1;}
        apply();
      });
    });

    tb.addEventListener("click",(e)=>{
      const tr=e.target.closest("tr[data-id]");
      if(!tr) return;
      if(e.target.getAttribute("data-act")==="open") openEst(Number(tr.getAttribute("data-id")));
    });

    async function openEst(id){
      const e = await AsgardDB.get("estimates", id);
      const t = tenders.find(x=>x.id===e.tender_id);
      const pm = byId.get(e.pm_id);
      const calcRaw = safeParseJSON(e.calc_summary_json, {});
      const calc = calcView(calcRaw);
      const html = `
        <div class="help"><b>${esc(t?.customer_name||"")}</b> — ${esc(t?.tender_title||"")}</div>
        <div class="help">РП: ${esc(pm?pm.name:"—")} • версия #${esc(e.version_no||1)} • статус: <b>${esc(e.approval_status||"draft")}</b></div>
        <hr class="hr"/>
        <div class="kpi" style="grid-template-columns:repeat(4,minmax(160px,1fr))">
          <div class="k"><div class="t">Вероятность</div><div class="v">${esc(e.probability_pct||0)}%</div></div>
          <div class="k"><div class="t">Цена ТКП</div><div class="v">${money(e.price_tkp)} ₽</div></div>
          <div class="k"><div class="t">Себест. план</div><div class="v">${money(e.cost_plan)} ₽</div></div>
          <div class="k"><div class="t">Условия оплаты</div><div class="v" style="font-size:14px">${esc(e.payment_terms||"—")}</div></div>
        </div>
        <hr class="hr"/>
        <div class="help"><b>Калькулятор (свод)</b></div>
        <div class="pill"><div class="who">Химия: ${calc.chemCost!=null?money(calc.chemCost):"—"} ₽</div><div class="role">Оборудование: ${calc.equipmentCost!=null?money(calc.equipmentCost):"—"} ₽</div></div>
        <div class="pill"><div class="who">Логистика: ${calc.logisticsCost!=null?money(calc.logisticsCost):"—"} ₽</div><div class="role">Люди/дни: ${esc(String(calc.peopleCount??"—"))} / ${esc(String(calc.workDays??"—"))}</div></div>
        ${calc.director?`
          <div class="row" style="gap:8px; flex-wrap:wrap; margin-top:10px">
            ${calc.director.price_tkp_with_vat!=null?`<span class="badge">ТКП: <b>${money(calc.director.price_tkp_with_vat)}</b> ₽</span>`:""}
            ${calc.director.cost_total!=null?`<span class="badge">Себест.: <b>${money(calc.director.cost_total)}</b> ₽</span>`:""}
            ${calc.director.fot_with_taxes!=null?`<span class="badge">ФОТ+налоги: <b>${money(calc.director.fot_with_taxes)}</b> ₽</span>`:""}
            ${calc.director.net_profit!=null?`<span class="badge">Чистая прибыль: <b>${money(calc.director.net_profit)}</b> ₽</span>`:""}
            ${calc.director.profit_per_person_day!=null?`<span class="badge">Прибыль/чел‑день: <b>${money(calc.director.profit_per_person_day)}</b> ₽</span>`:""}
          </div>
        `:""}
        <hr class="hr"/>
        <div class="help"><b>Комментарий РП</b></div>
        <div class="panel" style="padding:12px">${esc(e.comment||"")||"—"}</div>
        <hr class="hr"/>
        <div class="help"><b>Комментарий директора</b></div>
        <div class="panel" style="padding:12px">${esc(e.approval_comment||"")||"—"}</div>
      `;
      showModal(`Просчёт #${id}`, `<div style="max-height:80vh; overflow:auto">${html}</div>`);
    }
  }

  return { render };
})();