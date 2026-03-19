window.AsgardCustomersPage = (function(){
    let currentPage = 1, pageSize = window.AsgardPagination ? AsgardPagination.getPageSize() : 20;
  const { $, $$, esc, toast, showModal, money } = AsgardUI;

  // DaData autocomplete helper
  function dadataAutocomplete(inputEl, type, onSelect) {
    let timer = null;
    const dropdown = document.createElement('div');
    dropdown.className = 'dadata-suggest-dropdown';
    dropdown.style.cssText = 'position:absolute;z-index:9999;background:var(--bg2,#1e1e2e);border:1px solid var(--line,#333);border-radius:8px;max-height:220px;overflow-y:auto;display:none;width:100%;box-shadow:0 4px 12px rgba(0,0,0,0.3)';
    inputEl.parentElement.style.position = 'relative';
    inputEl.parentElement.appendChild(dropdown);

    inputEl.addEventListener('input', () => {
      clearTimeout(timer);
      const q = inputEl.value.trim();
      if (q.length < 3) { dropdown.style.display = 'none'; return; }
      timer = setTimeout(async () => {
        try {
          const auth = await AsgardAuth.getAuth();
          const r = await fetch('/api/customers/suggest?q=' + encodeURIComponent(q) + '&type=' + type, {
            headers: { 'Authorization': 'Bearer ' + auth.token }
          });
          const data = await r.json();
          if (!data.suggestions?.length) { dropdown.style.display = 'none'; return; }
          dropdown.innerHTML = data.suggestions.map((s, i) =>
            '<div class="dadata-suggest-item" data-idx="' + i + '" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--line,#333);font-size:13px">' +
            '<div style="font-weight:600">' + (s.name||'') + '</div>' +
            '<div style="color:var(--text-muted,#888);font-size:11px">\u0418\u041d\u041d ' + (s.inn||'') + (s.address ? ' \u2022 ' + s.address.slice(0,60) : '') + '</div>' +
            '</div>'
          ).join('');
          dropdown.style.display = 'block';
          dropdown.querySelectorAll('.dadata-suggest-item').forEach(el => {
            el.addEventListener('mouseenter', () => el.style.background = 'var(--bg-hover,#2a2a3e)');
            el.addEventListener('mouseleave', () => el.style.background = '');
            el.addEventListener('click', () => {
              const idx = parseInt(el.dataset.idx);
              onSelect(data.suggestions[idx]);
              dropdown.style.display = 'none';
            });
          });
        } catch(e) { dropdown.style.display = 'none'; }
      }, 300);
    });

    document.addEventListener('click', (e) => {
      if (!inputEl.contains(e.target) && !dropdown.contains(e.target)) dropdown.style.display = 'none';
    });
  }


  const V = AsgardValidate;

  function isoNow(){ return new Date().toISOString(); }
  function normInn(v){ return String(v||"").replace(/\D/g,""); }
  async function getCustomerByInn(inn){
    inn = normInn(inn);
    if(!inn) return null;
    return await AsgardDB.get("customers", inn);
  }

  // Lookup company info by INN via DaData API
  async function lookupByInn(inn){
    inn = normInn(inn);
    if(inn.length !== 10 && inn.length !== 12) {
      throw new Error("ИНН должен быть 10 или 12 цифр");
    }
    const auth = await AsgardAuth.getAuth();
    if(!auth?.token) throw new Error("Требуется авторизация");

    const resp = await fetch('/api/customers/lookup/' + inn, {
      headers: { 'Authorization': 'Bearer ' + auth.token }
    });
    if(!resp.ok) {
      const err = await resp.json().catch(()=>({ error: 'Ошибка запроса' }));
      throw new Error(err.error || 'Ошибка поиска');
    }
    return await resp.json();
  }

  async function upsertCustomer(rec){
    const inn = normInn(rec.inn);
    if(!(inn.length===10 || inn.length===12)) throw new Error("ИНН должен быть 10 или 12 цифр");
    const cur = await AsgardDB.get("customers", inn);
    const now = isoNow();
    const out = Object.assign({}, cur||{}, rec, {
      inn,
      name: String(rec.name||"").trim(),
      full_name: String(rec.full_name||"").trim(),
      kpp: String(rec.kpp||"").trim(),
      ogrn: String(rec.ogrn||"").trim(),
      address: String(rec.address||"").trim(),
      contacts_json: String(rec.contacts_json||"").trim(),
      email: String(rec.email||"").trim(),
      phone: String(rec.phone||"").trim(),
      comment: String(rec.comment||"").trim(),
      updated_at: now,
      created_at: (cur && cur.created_at) ? cur.created_at : now
    });

    // ИСПРАВЛЕНО: было "c" - теперь "out"
    if(!/^([0-9]{10}|[0-9]{12})$/.test(String(out.inn||"").trim())){ 
      toast("Валидация","ИНН должен быть 10 или 12 цифр","err"); 
      return; 
    }
    if(V.isBlank(out.full_name) && V.isBlank(out.name)){ 
      toast("Валидация","Укажите наименование (краткое или полное)","err"); 
      return; 
    }
    
    await AsgardDB.put("customers", out);
    return inn;
  }

  function parseContactsJson(txt){
    const raw = String(txt||"").trim();
    if(!raw) return [];
    try{
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    }catch(_){
      return [];
    }
  }

  function contactsTemplate(contacts){
    const rows = (contacts||[]).map((c,i)=>`
      <div class="pill" style="gap:10px; flex-wrap:wrap">
        <div style="min-width:200px"><b>${esc(c.name||"")}</b><div class="help">${esc(c.role||"")}</div></div>
        <div class="help" style="min-width:220px">${esc(c.phone||"")}</div>
        <div class="help" style="min-width:240px">${esc(c.email||"")}</div>
        <div style="flex:1 1 260px" class="help">${esc(c.comment||"")}</div>
        <button class="btn ghost" data-del-contact="${i}" style="padding:6px 10px">Удалить</button>
      </div>
    `).join("");
    return rows || '<div class="help">Контактов пока нет.</div>';
  }

  async function renderList({layout, title}={}){
    const auth = await AsgardAuth.requireUser();
    if(!auth) return;
    const list = (await AsgardDB.all("customers")||[]).sort((a,b)=>(a.name||"").localeCompare(b.name||""));
    const html = `
      ${window.__ASG_SHARED_TABLE_CSS__||""}
      <div class="tools">
        <div class="field"><label>Поиск</label><input id="q" placeholder="ИНН / название" /></div>
        <div style="flex:1"></div>
        <button class="btn" id="btnNew">+ Контрагент</button>
      </div>
      <table class="asg">
        <thead><tr><th>ИНН</th><th>Название</th><th>Реквизиты</th><th>Контакты</th><th></th></tr></thead>
        <tbody id="tb"></tbody>
      </table>
    `;
    await layout('<div class="content"><div class="card">'+html+'</div></div>', { title, motto: "Храни имена и печати — и договор будет крепок." });

    function row(c){
      const req = [c.kpp?'КПП '+c.kpp:'', c.ogrn?'ОГРН '+c.ogrn:''].filter(Boolean).join(' · ');
      const con = [c.phone||'', c.email||''].filter(Boolean).join(' · ');
      return '<tr><td><b>'+esc(c.inn||'')+'</b></td><td>'+esc(c.name||c.full_name||'')+'</td><td class="help">'+esc(req||'—')+'</td><td class="help">'+esc(con||'—')+'</td><td><a class="btn ghost" href="#/customer?inn='+encodeURIComponent(c.inn||'')+'">Открыть</a></td></tr>';
    }

    const tb = $("#tb");
    function renderTable(q=""){
      const qq = String(q||"").trim().toLowerCase();
      const out = !qq ? list : list.filter(c=> String(c.inn||"").toLowerCase().includes(qq) || String(c.name||"").toLowerCase().includes(qq));
      const paged_customers = window.AsgardPagination ? AsgardPagination.paginate(out, currentPage, pageSize) : out;
      tb.innerHTML = paged_customers.map(row).join("");
      if (window.AsgardPagination) {
        let pgEl = document.getElementById("customers_pagination");
        if (!pgEl) { pgEl = document.createElement("div"); pgEl.id = "customers_pagination"; tb.closest("table").after(pgEl); }
        pgEl.innerHTML = AsgardPagination.renderControls(out.length, currentPage, pageSize);
        AsgardPagination.attachHandlers("customers_pagination",
          (p) => { currentPage = p; renderTable(document.getElementById("q")?.value || ""); },
          (s) => { pageSize = s; currentPage = 1; renderTable(document.getElementById("q")?.value || ""); }
        );
      }
      if (!tb.innerHTML.trim()) tb.innerHTML = '<tr><td colspan="5" class="help">Пусто.</td></tr>';
    }
    renderTable("");
    $("#q").addEventListener("input", (e)=>renderTable(e.target.value));
    $("#btnNew").addEventListener("click", ()=>{ location.hash = "#/customer?inn=&new=1"; });
  }

  async function renderCard({layout, title, query}={}){
    const auth = await AsgardAuth.requireUser();
    if(!auth) return;
    const innQ = normInn(query?.inn||"");
    const isNew = String(query?.new||"") === "1";

    let c = innQ ? await getCustomerByInn(innQ) : null;
    if(!c && (isNew || innQ)){
      c = { inn: innQ, name:"", full_name:"", kpp:"", ogrn:"", address:"", phone:"", email:"", comment:"", contacts_json:"" };
    }
    const contacts = parseContactsJson(c?.contacts_json||"");

    const html = `
      <div class="tools" style="margin-bottom:10px">
        <a class="btn ghost" href="#/customers">← К списку</a>
        <div style="flex:1"></div>
        <button class="btn" id="btnSave">Сохранить</button>
        ${c?.inn && !isNew ? '<button class="btn ghost" id="btnDel">Удалить</button>' : ''}
      </div>
      <div class="formrow">
        <div style="display:flex;gap:8px;align-items:flex-end">
          <div style="flex:1">
            <label>ИНН</label>
            <input id="inn" placeholder="10/12 цифр" value="${esc(c?.inn||'')}" ${c?.inn && !isNew ? 'disabled' : ''}/>
          </div>
          ${!c?.inn || isNew ? '<button class="btn ghost" id="btnLookup" style="height:38px" title="Найти по ИНН">🔍</button>' : ''}
        </div>
        <div style="grid-column:1/-1"><label>Название (краткое)</label><input id="name" value="${esc(c?.name||'')}"/></div>
        <div style="grid-column:1/-1"><label>Наименование полное</label><input id="full" value="${esc(c?.full_name||'')}"/></div>
        <div><label>КПП</label><input id="kpp" value="${esc(c?.kpp||'')}"/></div>
        <div><label>ОГРН</label><input id="ogrn" value="${esc(c?.ogrn||'')}"/></div>
        <div style="grid-column:1/-1"><label>Адрес</label><input id="addr" value="${esc(c?.address||'')}"/></div>
        <div><label>Телефон</label><input id="phone" value="${esc(c?.phone||'')}"/></div>
        <div><label>Email</label><input id="email" value="${esc(c?.email||'')}"/></div>
        <div style="grid-column:1/-1"><label>Комментарий</label><input id="comment" value="${esc(c?.comment||'')}"/></div>
      </div>
      <hr class="hr"/>
      <div class="help"><b>Контактные лица</b></div>
      <div id="contactsBox" style="margin-top:10px">${contactsTemplate(contacts)}</div>
      <div class="row" style="gap:10px;margin-top:10px"><button class="btn ghost" id="btnAddContact">+ Контакт</button></div>
    `;

    await layout('<div class="content"><div class="card">'+html+'</div></div>', { title, motto:"Храни имена и печати." });

    function refreshContactsBox(){
      $("#contactsBox").innerHTML = contactsTemplate(contacts);
      $$("[data-del-contact]").forEach(b=>{
        b.addEventListener("click", ()=>{
          const i = Number(b.getAttribute("data-del-contact"));
          if(i>=0 && i<contacts.length) contacts.splice(i,1);
          refreshContactsBox();
        });
      });
    }
    refreshContactsBox();

    $("#btnAddContact").addEventListener("click", ()=>{
      showModal({ title:"Добавить контакт", html: '<div class="formrow"><div><label>ФИО</label><input id="c_name"/></div><div><label>Должность</label><input id="c_role"/></div><div><label>Телефон</label><input id="c_phone"/></div><div><label>Email</label><input id="c_email"/></div></div><div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn ghost" id="c_cancel">Отмена</button><button class="btn" id="c_ok">Добавить</button></div>',
        onMount: ({back})=>{
          $("#c_cancel",back).onclick = ()=>AsgardUI.hideModal();
          $("#c_ok",back).onclick = ()=>{
            const obj = { name: $("#c_name",back).value.trim(), role: $("#c_role",back).value.trim(), phone: $("#c_phone",back).value.trim(), email: $("#c_email",back).value.trim() };
            if(!obj.name){ toast("Контакт","Укажите ФИО","err"); return; }
            contacts.push(obj);
            AsgardUI.hideModal();
            refreshContactsBox();
          };
        }
      });
    });

    // INN lookup button
    const btnLookup = $("#btnLookup");
    if(btnLookup){
      btnLookup.addEventListener("click", async ()=>{
        const inn = normInn($("#inn").value);
        if(inn.length !== 10 && inn.length !== 12){
          toast("Поиск","ИНН должен быть 10 или 12 цифр","err");
          return;
        }
        btnLookup.disabled = true;
        btnLookup.textContent = "⏳";
        try{
          const result = await lookupByInn(inn);
          if(result.found && result.suggestion){
            const s = result.suggestion;
            if(s.name) $("#name").value = s.name;
            if(s.full_name) $("#full").value = s.full_name;
            if(s.kpp) $("#kpp").value = s.kpp;
            if(s.ogrn) $("#ogrn").value = s.ogrn;
            if(s.address) $("#addr").value = s.address;
            toast("Поиск","Данные заполнены из реестра","ok");
          } else {
            toast("Поиск", result.message || "Организация не найдена","warn");
          }
        }catch(e){
          toast("Поиск", e.message||"Ошибка","err");
        }finally{
          btnLookup.disabled = false;
          btnLookup.textContent = "🔍";
        }
      });
    }

    $("#btnSave").addEventListener("click", async ()=>{
      try{
        const rec = { inn: normInn($("#inn").value), name: $("#name").value, full_name: $("#full").value, kpp: $("#kpp").value, ogrn: $("#ogrn").value, address: $("#addr").value, phone: $("#phone").value, email: $("#email").value, comment: $("#comment").value, contacts_json: JSON.stringify(contacts) };
        if(!rec.name && !rec.full_name) throw new Error("Укажите название организации");
        const inn = await upsertCustomer(rec);
        toast("Контрагент","Сохранено");
        location.hash = "#/customer?inn="+encodeURIComponent(inn);
      }catch(e){ toast("Контрагент", e.message||"Ошибка", "err"); }
    });

    const btnDel = $("#btnDel");
    if(btnDel){
      btnDel.addEventListener("click", ()=>{
        showModal({ title:"Удалить контрагента?", html: '<div class="help">Удалить '+esc(c?.inn||'')+' '+esc(c?.name||'')+'?</div><div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn ghost" id="d_cancel">Отмена</button><button class="btn red" id="d_ok">Удалить</button></div>',
          onMount: ({back})=>{
            $("#d_cancel",back).onclick=()=>AsgardUI.hideModal();
            $("#d_ok",back).onclick=async ()=>{
              await AsgardDB.del("customers", c.inn);
              AsgardUI.hideModal();
              toast("Контрагент","Удалено");
              location.hash="#/customers";
            };
          }
        });
      });
    }
  }

  return { renderList, renderCard, upsertCustomer, getCustomerByInn, lookupByInn };
})();
