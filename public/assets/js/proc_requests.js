window.AsgardProcRequestsPage=(function(){
  const { $, $$, esc, toast, showModal } = AsgardUI;
  const isDirRole = (r)=> (window.AsgardAuth&&AsgardAuth.isDirectorRole)?AsgardAuth.isDirectorRole(r):(String(r||"")==="DIRECTOR"||String(r||"").startsWith("DIRECTOR_"));

  function isoNow(){ return new Date().toISOString(); }
  function ymNow(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }
  function safeJson(s,def){ try{return JSON.parse(s||"");}catch(_){return def;} }

  async function audit(actorId, entityType, entityId, action, payload){
    await AsgardDB.add("audit_log",{actor_user_id:actorId,entity_type:entityType,entity_id:entityId,action,payload_json:JSON.stringify(payload||{}),created_at:isoNow()});
  }
  async function notify(userId,title,message,link="#/pm-works"){
    await AsgardDB.add("notifications",{user_id:userId,is_read:false,created_at:isoNow(),title,message,link_hash:link});
  }
  async function getUsers(){ return (await AsgardDB.all("users")).filter(u=>u.is_active); }

  async function render({layout,title}){
    const auth=await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }
    const user=auth.user;
    if(!(user.role==="ADMIN" || user.role==="PROC" || isDirRole(user.role))){
      toast("Доступ","Недостаточно прав","err"); location.hash="#/home"; return;
    }

    const users=await getUsers();
    const byId=new Map(users.map(u=>[u.id,u]));

    let sortKey="created_at", sortDir=-1;

    const body = `
      ${window.__ASG_SHARED_TABLE_CSS__||""}
      <div class="panel">
        <div class="help">«Склад Щитов • Закупки» — заявки на химию/оборудование/логистику. Девиз: “Запас крепок, когда список точен.”</div>
        <hr class="hr"/>
        <div class="tools">
          <div class="field"><label>Период</label><select id="f_period">${generatePeriodOptions(ymNow())}</select></div>
          <div class="field"><label>Статус</label>
            <select id="f_status">
              <option value="">Все</option>
              <option value="sent">sent</option>
              <option value="answered">answered</option>
              <option value="approved">approved</option>
              <option value="rework">rework</option>
            </select>
          </div>
          <div class="field"><label>РП</label>
            <select id="f_pm"><option value="">Все</option>${users.filter(u=>u.role==="PM" || (Array.isArray(u.roles) && u.roles.includes("PM"))).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>
          </div>
          <div class="field"><label>Поиск</label><input id="f_q" placeholder="заказчик / работа"/></div>
        </div>
        <hr class="hr"/>
        <div style="overflow:auto">
          <table class="asg">
            <thead>
              <tr>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="created_at">Заявка</button></th>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="pm_id">РП</button></th>
                <th>Состав</th>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="status">Статус</button></th>
                <th></th>
              </tr>
            </thead>
            <tbody id="tb"></tbody>
          </table>
        </div>
        <div class="help" id="cnt"></div>
      </div>
    `;
    await layout(body,{title:title||"Склад Щитов • Закупки"});

    const tb=$("#tb"), cnt=$("#cnt");

    function norm(s){ return String(s||"").toLowerCase().trim(); }
    function sortBy(key,dir){ return (a,b)=>dir*String(a[key]??"").localeCompare(String(b[key]??""),"ru",{sensitivity:"base"}); }

    async function load(){
      const reqs = await AsgardDB.all("purchase_requests");
      const works = await AsgardDB.all("works");
      const tenders = await AsgardDB.all("tenders");

      const per = norm($("#f_period").value);
      const st = $("#f_status").value;
      const pm = $("#f_pm").value;
      const q  = norm($("#f_q").value);

      let list = reqs.filter(r=>{
        if(st && r.status!==st) return false;
        if(pm && String(r.pm_id)!==String(pm)) return false;
        const w=works.find(x=>x.id===r.work_id);
        const t=w?tenders.find(x=>x.id===w.tender_id):null;
        if(per && norm(t?.period||"")!==per) return false;
        if(q){
          const hay = `${w?.company||""} ${w?.work_title||""} ${t?.customer_name||""} ${t?.tender_title||""}`.toLowerCase();
          if(!hay.includes(q)) return false;
        }
        return true;
      });

      list.sort(sortBy(sortKey,sortDir));

      tb.innerHTML = list.map(r=>{
        const w=works.find(x=>x.id===r.work_id);
        const t=w?tenders.find(x=>x.id===w.tender_id):null;
        const pmU=byId.get(r.pm_id);
        const it = safeJson(r.items_json, {});
        const brief = ["chem","eq","log"].map(k=>it[k]?`${k}:${String(it[k]).slice(0,18)}`:null).filter(Boolean).join(" • ") || "—";
        return `<tr data-id="${r.id}">
          <td><b>#${r.id}</b><div class="help">${esc(w?.company||t?.customer_name||"")} — ${esc(w?.work_title||t?.tender_title||"")}</div><div class="help">${r.created_at?esc(new Date(r.created_at).toLocaleString("ru-RU")):""}</div></td>
          <td>${esc(pmU?pmU.name:"—")}</td>
          <td>${esc(brief)}</td>
          <td><span class="pill">${esc(r.status||"sent")}</span></td>
          <td><button class="btn" style="padding:6px 10px" data-act="open">Открыть</button></td>
        </tr>`;
      }).join("");
      cnt.textContent = `Показано: ${list.length} из ${reqs.length}.`;
    }

    await load();
    ["f_period","f_q"].forEach(id=>$("#"+id).addEventListener("input", load));
    ["f_status","f_pm"].forEach(id=>$("#"+id).addEventListener("change", load));
    $$("[data-sort]").forEach(b=>{
      b.addEventListener("click", ()=>{
        const k=b.getAttribute("data-sort");
        if(sortKey===k) sortDir*=-1; else {sortKey=k; sortDir=1;}
        load();
      });
    });

    tb.addEventListener("click",(e)=>{
      const tr=e.target.closest("tr[data-id]"); if(!tr) return;
      if(e.target.getAttribute("data-act")==="open") openReq(Number(tr.getAttribute("data-id")));
    });

    async function openReq(id){
      const req = await AsgardDB.get("purchase_requests", id);
      const w = await AsgardDB.get("works", req.work_id);
      const t = await AsgardDB.get("tenders", w.tender_id);
      const pmU = byId.get(req.pm_id);
      const it = safeJson(req.items_json,{});
      const html = `
        <div class="help"><b>${esc(w.company||t.customer_name||"")}</b> — ${esc(w.work_title||t.tender_title||"")}</div>
        <div class="help">РП: ${esc(pmU?pmU.name:"—")} • work #${w.id} • tender #${t.id}</div>
        <hr class="hr"/>
        <div class="pill"><div class="who"><b>Химия</b></div><div class="role">${esc(it.chem||"—")}</div></div>
        <div class="pill"><div class="who"><b>Оборудование</b></div><div class="role">${esc(it.eq||"—")}</div></div>
        <div class="pill"><div class="who"><b>Логистика</b></div><div class="role">${esc(it.log||"—")}</div></div>
        <hr class="hr"/>
        <div class="formrow">
          <div style="grid-column:1/-1"><label>Комментарий (закупки)</label><input id="pr_comment" value="${esc(req.proc_comment||"")}" placeholder="сроки/наличие/замены"/></div>
        </div>
        <hr class="hr"/>
        <div style="display:flex; gap:10px; flex-wrap:wrap">
          <button class="btn" id="btnSend">Отправить ответ РП</button>
          <button class="btn ghost" id="btnHistory">История</button>
        </div>
      `;
      showModal(`Заявка закупки #${id}`, `<div style="max-height:82vh; overflow:auto">${html}</div>`);

      $("#btnHistory").addEventListener("click", async ()=>{
        const logs = (await AsgardDB.all("audit_log"))
          .filter(l=>l.entity_type==="purchase_request" && l.entity_id===id)
          .sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
        const rows = logs.map(l=>`
          <div class="pill"><div class="who"><b>${esc(l.action)}</b> — ${esc(new Date(l.created_at).toLocaleString("ru-RU"))}</div><div class="role">${esc(l.actor_user_id)}</div></div>
          <div class="help" style="margin:6px 0 10px">${esc(l.payload_json||"")}</div>
        `).join("");
        showModal("История (purchase_request)", rows || `<div class="help">Пусто.</div>`);
      });

      $("#btnSend").addEventListener("click", async ()=>{
        req.proc_comment = $("#pr_comment").value.trim()||"";
        req.status = "answered";
        req.updated_at = isoNow();
        await AsgardDB.put("purchase_requests", req);
        await audit(user.id,"purchase_request",id,"answer",{});
        await notify(req.pm_id,"Ответ закупок", `${w.company||t.customer_name} — ${w.work_title||t.tender_title}`, "#/pm-works");
        toast("Закупки","Ответ отправлен РП");
      });
    }
  }

  return { render };
})();