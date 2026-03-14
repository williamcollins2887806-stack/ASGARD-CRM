window.AsgardPmConsentsPage = (function(){
  const { $, esc, toast } = AsgardUI;
  const isDirRole = (r)=> (window.AsgardAuth&&AsgardAuth.isDirectorRole)?AsgardAuth.isDirectorRole(r):(r==="DIRECTOR"||String(r||"").startsWith("DIRECTOR_"));
  function isoNow(){ return new Date().toISOString(); }

  async function audit(actorId, entityType, entityId, action, payload){
    try{
      await AsgardDB.add("audit_log", { actor_user_id: actorId, entity_type: entityType, entity_id: entityId, action, payload_json: JSON.stringify(payload||{}), created_at: isoNow() });
    }catch(e){}
  }

  async function render({layout, title}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }
    const user = auth.user;

    if(user.role!=="PM" && !(Array.isArray(user.roles)&&user.roles.includes("PM")) && user.role!=="ADMIN" && !isDirRole(user.role)){
      toast("Доступ","Недостаточно прав","err");
      location.hash="#/home";
      return;
    }

    let cons = [];
    try{ cons = await AsgardDB.all("pm_consents"); }catch(e){ cons=[]; }
    cons = (cons||[]).filter(c=>Number(c.pm_id)===Number(user.id) || user.role==="ADMIN" || isDirRole(user.role));
    cons.sort((a,b)=>String(b.created_at||"").localeCompare(String(a.created_at||"")));

    const body = `
      <div class="panel">
        <div class="help">Запросы согласия РП (override по пересечению сроков). В офлайн-режиме уведомления приходят при открытии приложения.</div>
        <hr class="hr"/>
        <div style="overflow:auto">
          <table class="asg">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Тип</th>
                <th>Статус</th>
                <th>Тендер/работа</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="tb"></tbody>
          </table>
        </div>
      </div>
    `;

    await layout(body, {title: title||"Согласия РП"});

    const tb=$("#tb");

    async function row(c){
      const t = c.tender_id ? await AsgardDB.get("tenders", c.tender_id) : null;
      const ttxt = t ? `<b>${esc(t.customer_name||"")}</b><div class="help">${esc(t.tender_title||"")}</div>` : "—";
      const dt = c.created_at ? new Date(c.created_at).toLocaleString("ru-RU") : "";
      const st = esc(c.status||"");
      const type = esc(c.type||"");
      const actions = (c.status==="pending" && Number(c.pm_id)===Number(user.id)) ? `
        <button class="btn" style="padding:6px 10px" data-act="approve" data-id="${c.id}">Согласен</button>
        <button class="btn ghost" style="padding:6px 10px" data-act="decline" data-id="${c.id}">Не согласен</button>
      ` : `<span class="help">—</span>`;
      return `<tr>
        <td>${esc(dt)}</td>
        <td>${type}</td>
        <td>${st}</td>
        <td>${ttxt}</td>
        <td style="white-space:nowrap">${actions}</td>
      </tr>`;
    }

    const rows = [];
    for(const c of cons){ rows.push(await row(c)); }
    tb.innerHTML = rows.join("") || `<tr><td colspan="5" class="help">Нет запросов.</td></tr>`;

    tb.addEventListener("click", async (e)=>{
      const act = e.target.getAttribute("data-act");
      const id = Number(e.target.getAttribute("data-id")||0);
      if(!act || !id) return;
      const c = await AsgardDB.get("pm_consents", id);
      if(!c || c.status!=="pending"){ toast("Согласие","Запрос уже обработан","warn"); await render({layout,title}); return; }
      if(Number(c.pm_id)!==Number(user.id)){ toast("Согласие","Это не ваш запрос","err"); return; }

      c.status = (act==="approve") ? "approved" : "declined";
      c.decided_at = isoNow();
      c.decided_by_user_id = user.id;
      await AsgardDB.put("pm_consents", c);
      await audit(user.id,"pm_consent",id, act==="approve"?"approve":"decline", {});
      toast("Согласие", act==="approve"?"Согласовано":"Отклонено");
      await render({layout,title});
    });
  }

  return { render };
})();