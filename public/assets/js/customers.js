window.AsgardCustomersPage = (function(){
    let currentPage = 1, pageSize = window.AsgardPagination ? AsgardPagination.getPageSize() : 20;
  const { $, $$, esc, toast, showModal, money } = AsgardUI;

  // DaData autocomplete helper — replaced by CRAutocomplete
  // Usage: wrap a container with CRAutocomplete.create({ fetchOptions via /api/customers/suggest })
  function dadataAutocomplete(inputEl, type, onSelect) {
    const id = 'dadata-' + (inputEl.id || Date.now());
    const wrap = document.createElement('div');
    wrap.style.width = '100%';
    inputEl.parentElement.insertBefore(wrap, inputEl);
    inputEl.style.display = 'none';
    wrap.appendChild(CRAutocomplete.create({
      id, value: inputEl.value || '', placeholder: inputEl.placeholder || '',
      minChars: 3, fullWidth: true,
      fetchOptions: async (q) => {
        try {
          const auth = await AsgardAuth.getAuth();
          const r = await fetch('/api/customers/suggest?q=' + encodeURIComponent(q) + '&type=' + type, {
            headers: { 'Authorization': 'Bearer ' + auth.token }
          });
          const data = await r.json();
          return (data.suggestions || []).map(s => ({
            value: s.inn || '', label: s.name || '',
            sublabel: '\u0418\u041d\u041d ' + (s.inn||'') + (s.address ? ' \u2022 ' + s.address.slice(0,60) : ''),
            _raw: s
          }));
        } catch(e) { return []; }
      },
      onSelect: (item) => { if(item && item._raw) onSelect(item._raw); }
    }));
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
      contacts: Array.isArray(rec.contacts) ? rec.contacts : undefined,
      contact_person: String(rec.contact_person||"").trim(),
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
    
    // customers PK = inn (не id). AsgardDB.put шлёт PUT по val.id, если он есть.
    // Без delete out.id ушёл бы PUT /api/data/customers/<id> → backend WHERE inn=<id> → 404.
    // Без id уходит POST → UPSERT с ON CONFLICT(inn) — корректный путь для customers.
    delete out.id;
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

  function normalizeContact(c){
    return {
      name:    String(c?.name || ""),
      role:    String(c?.role || c?.position || ""),
      phone:   String(c?.phone || ""),
      email:   String(c?.email || ""),
      comment: String(c?.comment || "")
    };
  }

  /** contacts JSONB → contacts_json TEXT → []. */
  function loadContacts(customer){
    const raw = customer?.contacts;
    if (Array.isArray(raw) && raw.length) return raw.map(normalizeContact);
    if (typeof raw === "string" && raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed.map(normalizeContact);
      } catch(_) { /* fallback */ }
    }
    return parseContactsJson(customer?.contacts_json || "").map(normalizeContact);
  }

  function contactsToPayload(contacts){
    const list = (contacts || []).map((c, i) => ({
      name:       String(c.name || "").trim(),
      position:   String(c.role || c.position || "").trim(),
      phone:      String(c.phone || "").trim(),
      email:      String(c.email || "").trim(),
      is_primary: i === 0
    })).filter((c) => c.name || c.phone || c.email);
    if (list.length && !list.some((c) => c.is_primary)) list[0].is_primary = true;
    return list;
  }

  function contactsTemplate(contacts){
    const rows = (contacts||[]).map((c,i)=>`
      <div class="pill between customer-contact-row" style="width:100%;margin-bottom:8px;box-sizing:border-box;overflow:visible">
        <div style="flex:1;min-width:0;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:flex-start">
          <div style="min-width:120px"><b>${esc(c.name||"")}</b><div class="help">${esc(c.role||"")}</div></div>
          <div class="help">${esc(c.phone||"")}</div>
          <div class="help">${esc(c.email||"")}</div>
          ${c.comment ? `<div class="help">${esc(c.comment||"")}</div>` : ""}
        </div>
        <div class="customer-contact-actions" style="display:flex;gap:6px;flex-shrink:0;margin-left:8px">
          <button type="button" class="btn ghost" data-edit-contact="${i}" style="padding:6px 10px;white-space:nowrap" title="Редактировать контакт">✎ Редактировать</button>
          <button type="button" class="btn ghost" data-del-contact="${i}" style="padding:6px 10px;white-space:nowrap" title="Удалить контакт">Удалить</button>
        </div>
      </div>
    `).join("");
    return rows || '<div class="help">Контактов пока нет.</div>';
  }

  function openContactModal({ title, contact, onSave }){
    const html = '<div class="formrow">'
      + '<div><label>ФИО</label><input id="c_name" value="'+esc(contact?.name||'')+'"/></div>'
      + '<div><label>Должность</label><input id="c_role" value="'+esc(contact?.role||'')+'"/></div>'
      + '<div><label>Телефон</label><input id="c_phone" value="'+esc(contact?.phone||'')+'"/></div>'
      + '<div><label>Email</label><input id="c_email" value="'+esc(contact?.email||'')+'"/></div>'
      + '</div>'
      + '<div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px">'
      + '<button type="button" class="btn ghost" id="c_cancel">Отмена</button>'
      + '<button type="button" class="btn" id="c_ok">Сохранить</button>'
      + '</div>';
    showModal({ title: title || "Контакт", html: html,
      onMount: ({back})=>{
        $("#c_cancel",back).onclick = ()=>AsgardUI.hideModal();
        $("#c_ok",back).onclick = async ()=>{
          const obj = {
            name:    $("#c_name",back).value.trim(),
            role:    $("#c_role",back).value.trim(),
            phone:   $("#c_phone",back).value.trim(),
            email:   $("#c_email",back).value.trim(),
            comment: String(contact?.comment || "").trim()
          };
          if(!obj.name){ toast("Контакт","Укажите ФИО","err"); return; }
          try {
            const result = onSave(obj);
            if (result && typeof result.then === "function") await result;
            AsgardUI.hideModal();
          } catch(e) {
            toast("Контакт", e.message || "Не удалось сохранить", "err");
          }
        };
      }
    });
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
    const contacts = loadContacts(c);

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
          <button class="btn ghost" id="btnLookup" style="height:38px" title="Обновить данные из ЕГРЮЛ">${c?.inn && !isNew ? '🔄 ЕГРЮЛ' : '🔍'}</button>
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
      <div id="contactsBox" class="customer-contacts-box" style="margin-top:10px;overflow-x:auto;overflow-y:visible">${contactsTemplate(contacts)}</div>
      <div class="row" style="gap:10px;margin-top:10px"><button class="btn ghost" id="btnAddContact">+ Контакт</button></div>
    `;

    await layout('<div class="content"><div class="card">'+html+'</div></div>', { title, motto:"Храни имена и печати." });

    function buildCustomerRec(){
      const payload = contactsToPayload(contacts);
      return {
        inn: normInn($("#inn").value),
        name: $("#name").value,
        full_name: $("#full").value,
        kpp: $("#kpp").value,
        ogrn: $("#ogrn").value,
        address: $("#addr").value,
        phone: $("#phone").value,
        email: $("#email").value,
        comment: $("#comment").value,
        contacts_json: JSON.stringify(contacts),
        contacts: payload,
        contact_person: payload.length
          ? [payload.find((x)=>x.is_primary) || payload[0]].map((x)=>[x.name, x.position].filter(Boolean).join(" · "))[0]
          : ""
      };
    }

    async function saveCustomerContacts(msg){
      const rec = buildCustomerRec();
      if(!rec.inn || (rec.inn.length !== 10 && rec.inn.length !== 12)){
        toast("Контакт","Сначала укажите корректный ИНН","warn");
        return false;
      }
      if(!rec.name && !rec.full_name){
        toast("Контакт","Сначала укажите название организации","warn");
        return false;
      }
      await upsertCustomer(rec);
      if(msg) toast("Контакт", msg, "ok");
      return true;
    }

    function refreshContactsBox(){
      $("#contactsBox").innerHTML = contactsTemplate(contacts);
      $$("[data-edit-contact]").forEach(b=>{
        b.addEventListener("click", ()=>{
          const i = Number(b.getAttribute("data-edit-contact"));
          if(i<0 || i>=contacts.length) return;
          openContactModal({
            title: "Редактировать контакт",
            contact: contacts[i],
            onSave: async (obj)=>{
              contacts[i] = obj;
              refreshContactsBox();
              try {
                await saveCustomerContacts("Контакт обновлён");
              } catch(e) {
                toast("Контакт", e.message || "Не удалось сохранить", "err");
              }
            }
          });
        });
      });
      $$("[data-del-contact]").forEach(b=>{
        b.addEventListener("click", async ()=>{
          const i = Number(b.getAttribute("data-del-contact"));
          if(i<0 || i>=contacts.length) return;
          if(!confirm("Удалить контакт «"+(contacts[i].name||"")+"»?")) return;
          contacts.splice(i,1);
          refreshContactsBox();
          try {
            await saveCustomerContacts("Контакт удалён");
          } catch(e) {
            toast("Контакт", e.message || "Не удалось удалить", "err");
          }
        });
      });
    }
    refreshContactsBox();

    $("#btnAddContact").addEventListener("click", ()=>{
      openContactModal({
        title: "Добавить контакт",
        onSave: async (obj)=>{
          contacts.push(obj);
          refreshContactsBox();
          try {
            await saveCustomerContacts("Контакт добавлен");
          } catch(e) {
            toast("Контакт", e.message || "Не удалось сохранить", "err");
          }
        }
      });
    });

    // INN lookup button (works for both new and existing customers)
    const btnLookup = $("#btnLookup");
    const btnLookupLabel = btnLookup.textContent;
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
          toast("ЕГРЮЛ","Данные обновлены из реестра","ok");
        } else {
          toast("ЕГРЮЛ", result.message || "Организация не найдена","warn");
        }
      }catch(e){
        toast("ЕГРЮЛ", e.message||"Ошибка","err");
      }finally{
        btnLookup.disabled = false;
        btnLookup.textContent = btnLookupLabel;
      }
    });

    $("#btnSave").addEventListener("click", async ()=>{
      try{
        const rec = buildCustomerRec();
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
