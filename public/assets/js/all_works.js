window.AsgardAllWorksPage=(function(){
  const { $, $$, esc, toast, showModal } = AsgardUI;

  function ymNow(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }
  function money(x){ if(x===null||x===undefined||x==="") return "—"; const n=Number(x); if(isNaN(n)) return esc(String(x)); return n.toLocaleString("ru-RU"); }

  async function getUsers(){ return (await AsgardDB.all("users")).filter(u=>u.is_active); }
  async function getSettings(){
    const s = await AsgardDB.get("settings","app");
    return s ? JSON.parse(s.value_json||"{}") : { gantt_start_iso:"2026-01-01T00:00:00.000Z", status_colors:{work:{}} };
  }
  async function getRefs(){
    const refs = await AsgardDB.get("settings","refs");
    return refs ? JSON.parse(refs.value_json||"{}") : { work_statuses:[] };
  }

  async function render({layout,title}){
    const auth=await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }
    const user=auth.user;

    const users = await getUsers();
    const byId = new Map(users.map(u=>[u.id,u]));
    const settings = await getSettings();
    const refs = await getRefs();

    const works = await AsgardDB.all("works");
    const tenders = await AsgardDB.all("tenders");

    let sortKey="id", sortDir=-1;

    const body = `
      ${window.__ASG_SHARED_TABLE_CSS__||""}
      <div class="panel">
        <div class="help">«Свод Контрактов» — все работы по компании. Девиз: “Дело идёт по плану — пока цифры честны.”</div>
        <hr class="hr"/>
        <div class="tools">
          <div class="field"><label>Период</label><select id="f_period">${generatePeriodOptions(ymNow())}</select></div>
          <div class="field"><label>Поиск</label><input id="f_q" placeholder="заказчик / работа"/></div>
          <div class="field"><label>РП</label>
            <select id="f_pm"><option value="">Все</option>${users.filter(u=>u.role==="PM" || (Array.isArray(u.roles) && u.roles.includes("PM"))).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>
          </div>
          <div class="field"><label>Статус</label>
            <select id="f_status"><option value="">Все</option>${(refs.work_statuses||[]).map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join("")}</select>
          </div>
          <div style="display:flex; gap:10px; flex-wrap:wrap">
            <button class="btn ghost" id="btnGantt">Гантт по всем работам</button>
          </div>
        </div>
        <hr class="hr"/>
        <div style="overflow:auto">
          <table class="asg">
            <thead>
              <tr>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="company">Заказчик / Работа</button></th>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="pm_id">РП</button></th>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="work_status">Статус</button></th>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="start_in_work_date">Сроки</button></th>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="contract_value">Деньги</button></th>
              </tr>
            </thead>
            <tbody id="tb"></tbody>
          </table>
        </div>
        <div class="help" id="cnt"></div>
      </div>
    `;
    await layout(body,{title:title||"Свод Контрактов"});

    const tb=$("#tb"), cnt=$("#cnt");

    function norm(s){ return String(s||"").toLowerCase().trim(); }
    function sortBy(key,dir){
      return (a,b)=>{
        const av=(a[key]??""); const bv=(b[key]??"");
        if(typeof av==="number" && typeof bv==="number") return dir*(av-bv);
        return dir*String(av).localeCompare(String(bv),"ru",{sensitivity:"base"});
      };
    }

    function row(w){
      const t = tenders.find(x=>x.id===w.tender_id);
      const pm = byId.get(w.pm_id);
      const st=w.work_status||"";
      const color=(settings.status_colors?.work||{})[st]||"#2a6cf1";
      const got = (Number(w.advance_received||0)+Number(w.balance_received||0))||0;
      const left = (w.contract_value||0) ? Math.max(0, Number(w.contract_value||0)-got) : 0;
      const start = w.start_in_work_date || t?.work_start_plan || "—";
      const end = w.end_fact || w.end_plan || t?.work_end_plan || "—";
      return `<tr>
        <td><b>${esc(w.company||t?.customer_name||"")}</b><div class="help">${esc(w.work_title||t?.tender_title||"")}</div></td>
        <td>${esc(pm?pm.name:"—")}</td>
        <td><span class="pill" style="border-color:${esc(color)}">${esc(st)}</span></td>
        <td>${esc(start)} → ${esc(end)}</td>
        <td><div><b>${money(w.contract_value)}</b> ₽</div><div class="help">получено: ${money(got)} ₽ • должны: ${money(left)} ₽</div></td>
      </tr>`;
    }

    function apply(){
      const per = norm($("#f_period").value);
      const q = norm($("#f_q").value);
      const pm = $("#f_pm").value;
      const st = $("#f_status").value;

      let list = works.filter(w=>{
        const t = tenders.find(x=>x.id===w.tender_id);
        if(per && norm(t?.period||"")!==per) return false;
        if(pm && String(w.pm_id)!==String(pm)) return false;
        if(st && w.work_status!==st) return false;
        if(q){
          const hay = `${w.company||""} ${w.work_title||""} ${(t?.customer_name||"")} ${(t?.tender_title||"")}`.toLowerCase();
          if(!hay.includes(q)) return false;
        }
        return true;
      });

      list.sort(sortBy(sortKey,sortDir));
      tb.innerHTML = list.map(row).join("");
      cnt.textContent = `Показано: ${list.length} из ${works.length}.`;
    }

    apply();
    $("#f_period").addEventListener("input", apply);
    $("#f_q").addEventListener("input", apply);
    $("#f_pm").addEventListener("change", apply);
    $("#f_status").addEventListener("change", apply);

    $$("[data-sort]").forEach(b=>{
      b.addEventListener("click", ()=>{
        const k=b.getAttribute("data-sort");
        if(sortKey===k) sortDir*=-1; else { sortKey=k; sortDir=1; }
        apply();
      });
    });

    $("#btnGantt").addEventListener("click", ()=>{
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