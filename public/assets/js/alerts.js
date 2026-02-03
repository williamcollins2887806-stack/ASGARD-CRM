
window.AsgardAlertsPage=(function(){
  const {$, $$, esc, toast} = AsgardUI;
  const isDirRole = (r)=> (window.AsgardAuth&&AsgardAuth.isDirectorRole)?AsgardAuth.isDirectorRole(r):(r==="DIRECTOR"||String(r||"").startsWith("DIRECTOR_"));

  function isoNow(){ return new Date().toISOString(); }
  function norm(s){ return String(s||"").trim().toLowerCase(); }

  async function render({layout, title}={}){
    const auth=await AsgardAuth.requireUser();
    const user=auth.user;
    const role=user.role;

    const body = `
      <div class="card">
        <div class="row" style="justify-content:space-between; gap:10px; align-items:center">
          <div>
            <div class="kpi"><span class="dot" style="background:#3b82f6"></span> Воронья почта • Уведомления</div>
            <div class="help">Сообщения о передаче, согласовании, ответах персонала и закупок.</div>
          </div>
          <div class="row" style="gap:8px">
            <button class="btn ghost" id="markAll">Отметить всё прочитано</button>
            <button class="btn ghost" id="clearRead">Очистить прочитанные</button>
          </div>
        </div>
        <hr class="hr"/>
        <div class="row" style="gap:10px; flex-wrap:wrap">
          <input id="q" placeholder="Поиск по тексту" style="max-width:360px"/>
          ${ (role==="ADMIN"||isDirRole(role)) ? `
            <select id="scope" style="max-width:260px">
              <option value="me">Только мои</option>
              <option value="all">Все (директор/админ)</option>
            </select>` : `<input type="hidden" id="scope" value="me"/>` }
          <select id="flt" style="max-width:220px">
            <option value="all">Все</option>
            <option value="unread" selected>Непрочитанные</option>
            <option value="read">Прочитанные</option>
          </select>
        </div>
        <div id="list" style="margin-top:12px"></div>
        <div class="help" id="cnt" style="margin-top:10px"></div>
      </div>
    `;

    await layout(body, {title: title||"Уведомления", motto:"Слова слышны. Следы видны. Решения фиксируются."});

    const list=$("#list"), cnt=$("#cnt");

    async function fetchAll(){
      const scope=$("#scope").value;
      const flt=$("#flt").value;
      const q=norm($("#q").value);
      let items=[];
      if(scope==="all" && (role==="ADMIN"||isDirRole(role))){
        items = await AsgardDB.all("notifications");
      }else{
        items = await AsgardDB.byIndex("notifications","user_id", user.id);
      }
      items.sort((a,b)=> String(b.created_at||"").localeCompare(String(a.created_at||"")));
      items = items.filter(n=>{
        if(flt==="unread" && n.is_read) return false;
        if(flt==="read" && !n.is_read) return false;
        if(q && !(norm(n.title).includes(q) || norm(n.message).includes(q))) return false;
        return true;
      });
      return items;
    }

    function card(n){
      const when = n.created_at ? new Date(n.created_at).toLocaleString("ru-RU") : "—";
      const cls = "pill";
      const dot = n.is_read ? `<span class="dot" style="background:#64748b"></span>` : `<span class="dot" style="background:#f59e0b"></span>`;
      const link = n.link_hash || "#/home";
      return `<div class="${cls}" style="gap:10px; align-items:flex-start">
        <div style="margin-top:3px">${dot}</div>
        <div style="flex:1">
          <div class="row" style="justify-content:space-between; gap:10px">
            <div><b>${esc(n.title||"Уведомление")}</b></div>
            <div class="help">${esc(when)}</div>
          </div>
          <div class="help" style="margin-top:6px">${esc(n.message||"")}</div>
          <div class="row" style="gap:8px; margin-top:10px; flex-wrap:wrap">
            <a class="btn" style="padding:6px 10px" href="${esc(link)}" data-open="${n.id}">Открыть</a>
            <button class="btn ghost" style="padding:6px 10px" data-toggle="${n.id}">${n.is_read?"Пометить непроч.":"Пометить прочит."}</button>
            ${(role==="ADMIN"||isDirRole(role)) ? `<button class="btn ghost" style="padding:6px 10px" data-del="${n.id}">Удалить</button>` : ``}
          </div>
        </div>
      </div>`;
    }

    async function renderList(){
      const items=await fetchAll();
      list.innerHTML = items.length ? items.map(card).join("") : `<div class="help">Пока нет уведомлений по выбранному фильтру.</div>`;
      cnt.textContent = `Показано: ${items.length}`;
      // handlers
      $$("[data-toggle]").forEach(b=>b.addEventListener("click", async ()=>{
        const id=Number(b.getAttribute("data-toggle"));
        const n=await AsgardDB.get("notifications", id);
        if(!n) return;
        n.is_read = !n.is_read;
        await AsgardDB.put("notifications", n);
        await renderList();
      }));
      $$("[data-del]").forEach(b=>b.addEventListener("click", async ()=>{
        const id=Number(b.getAttribute("data-del"));
        const ok = await AsgardConfirm.open({title:"Подтверждение", body:"Удалить уведомление?", okText:"Удалить", cancelText:"Отмена", danger:true});
        if(!ok) return;
        await AsgardDB.del("notifications", id);
        await renderList();
      }));
      $$("[data-open]").forEach(a=>a.addEventListener("click", async ()=>{
        const id=Number(a.getAttribute("data-open"));
        const n=await AsgardDB.get("notifications", id);
        if(n && !n.is_read){
          n.is_read=true;
          await AsgardDB.put("notifications", n);
        }
      }));
    }

    $("#q").addEventListener("input", ()=>renderList());
    $("#flt").addEventListener("change", ()=>renderList());
    if($("#scope")) $("#scope").addEventListener("change", ()=>renderList());

    $("#markAll").addEventListener("click", async ()=>{
      const scope=$("#scope").value;
      let items=[];
      if(scope==="all" && (role==="ADMIN"||isDirRole(role))){
        items = await AsgardDB.all("notifications");
      }else{
        items = await AsgardDB.byIndex("notifications","user_id", user.id);
      }
      let c=0;
      for(const n of items){
        if(!n.is_read){ n.is_read=true; await AsgardDB.put("notifications", n); c++; }
      }
      toast(`Готово: ${c}`);
      await renderList();
    });

    $("#clearRead").addEventListener("click", async ()=>{
      const scope=$("#scope").value;
      let items=[];
      if(scope==="all" && (role==="ADMIN"||isDirRole(role))){
        items = await AsgardDB.all("notifications");
      }else{
        items = await AsgardDB.byIndex("notifications","user_id", user.id);
      }
      let c=0;
      for(const n of items){
        if(n.is_read){ await AsgardDB.del("notifications", n.id); c++; }
      }
      toast(`Удалено: ${c}`);
      await renderList();
    });

    await renderList();
  }

  return {render};
})();
