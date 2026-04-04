window.AsgardHrRequestsPage=(function(){
  const { $, $$, esc, toast, showModal, closeModal } = AsgardUI;
  const isDirRole = (r)=> (window.AsgardAuth&&AsgardAuth.isDirectorRole)?AsgardAuth.isDirectorRole(r):(String(r||"")==="DIRECTOR"||String(r||"").startsWith("DIRECTOR_"));

  function isoNow(){ return new Date().toISOString(); }
  function ymNow(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }

  async function audit(actorId, entityType, entityId, action, payload){
    await AsgardDB.add("audit_log",{actor_user_id:actorId,entity_type:entityType,entity_id:entityId,action,payload_json:JSON.stringify(payload||{}),created_at:isoNow()});
  }
  async function notify(userId,title,message,link="#/pm-works"){
    // Уведомление на сайте
    await AsgardDB.add("notifications",{user_id:userId,is_read:false,created_at:isoNow(),title,message,link_hash:link});
    
    // Telegram уведомление
    try {
      const auth = await AsgardAuth.getAuth();
      if (auth?.token) {
        fetch('/api/notifications/approval', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + auth.token
          },
          body: JSON.stringify({
            type: 'staff_request',
            action: 'notification',
            entityId: null,
            toUserId: userId,
            details: `${title}\n\n${message}`
          })
        }).catch(() => {});
      }
    } catch(e) {}
  }

  async function getUsers(){ return (await AsgardDB.all("users")).filter(u=>u.is_active && u.name && u.name.trim()); }
  // HR works with "employees" (рабочие), not office "staff"
  async function getStaff(){ return await AsgardDB.all("employees"); }

  function safeJson(s,def){ try{return JSON.parse(s||"");}catch(_){return def;} }

  async function render({layout,title}){
    const auth=await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }
    const user=auth.user;
    if(!(user.role==="ADMIN" || user.role==="HR" || isDirRole(user.role))){
      toast("Доступ","Недостаточно прав","err"); location.hash="#/home"; return;
    }

    const users=await getUsers();
    const byId=new Map(users.map(u=>[u.id,u]));
    const staff=await getStaff();

    let sortKey="created_at", sortDir=-1;
    let currentPage = 1, pageSize = window.AsgardPagination ? AsgardPagination.getPageSize() : 20;

    const body = `
      ${window.__ASG_SHARED_TABLE_CSS__||""}
      <div class="panel">
        <div class="help">«Казарма Дружины • Персонал» — запросы на людей по работам. Девиз: “Дружина сильна, когда строем управляют руны.”</div>
        <hr class="hr"/>
        <div class="tools">
          <div class="field"><label>Период</label><div id="f_period_w"></div></div>
          <div class="field"><label>Статус</label><div id="f_status_w"></div></div>
          <div class="field"><label>РП</label><div id="f_pm_w"></div></div>
          <div class="field"><label>Поиск</label><input id="f_q" placeholder="заказчик / работа"/></div>
        </div>
        <hr class="hr"/>
        <div style="overflow:auto">
          <table class="asg">
            <thead>
              <tr>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="created_at">Запрос</button></th>
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
    await layout(body,{title:title||"Казарма Дружины • Персонал"});

    // ─── CRSelect filters ───
    { const periodOpts = [{ value: '', label: 'Все' }];
      const now2 = new Date();
      for (let i = 0; i < 12; i++) {
        const d = new Date(now2.getFullYear(), now2.getMonth() - i, 1);
        const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        periodOpts.push({ value: v, label: d.toLocaleString('ru-RU', { month: 'long', year: 'numeric' }) });
      }
      $('#f_period_w').appendChild(CRSelect.create({ id: 'f_period', options: periodOpts, value: ymNow(), onChange: () => { currentPage=1; load(); } }));
    }
    $('#f_status_w').appendChild(CRSelect.create({ id: 'f_status', options: [{ value: '', label: 'Все' }, { value: 'sent', label: 'Отправлен' }, { value: 'answered', label: 'Ответ HR' }, { value: 'approved', label: 'Согласован' }, { value: 'rework', label: 'Доработка' }], onChange: () => { currentPage=1; load(); } }));
    $('#f_pm_w').appendChild(CRSelect.create({ id: 'f_pm', options: [{ value: '', label: 'Все' }, ...users.filter(u => u.role==='PM' || (Array.isArray(u.roles) && u.roles.includes('PM'))).map(p => ({ value: String(p.id), label: p.name }))], onChange: () => { currentPage=1; load(); } }));

    const tb=$("#tb"), cnt=$("#cnt");

    function norm(s){ return String(s||"").toLowerCase().trim(); }
    function sortBy(key,dir){
      return (a,b)=>{
        const av=(a[key]??""); const bv=(b[key]??"");
        return dir*String(av).localeCompare(String(bv),"ru",{sensitivity:"base"});
      };
    }

    function compo(req){
      const r = safeJson(req.request_json, {});
      const parts = Object.entries(r).filter(([k,v])=>Number(v||0)>0).map(([k,v])=>`${k}:${v}`).join(" • ");
      return parts || "—";
    }

    async function load(){
      const reqs = await AsgardDB.all("staff_requests");
      const works = await AsgardDB.all("works");
      const tenders = await AsgardDB.all("tenders");

      if (!$('#f_period_w')) return; // page navigated away during async fetch
      const per = norm(CRSelect.getValue('f_period') || '');
      const st = CRSelect.getValue('f_status') || '';
      const pm = CRSelect.getValue('f_pm') || '';
      const q  = norm($("#f_q").value);

      let list = reqs.filter(r=>{
        if(st && r.status!==st) return false;
        if(pm && String(r.pm_id)!==String(pm)) return false;
        const w = works.find(x=>x.id===r.work_id);
        const t = w ? tenders.find(x=>x.id===w.tender_id) : null;
        if(per && norm(t?.period||"")!==per) return false;
        if(q){
          const hay = `${w?.customer_name||""} ${w?.work_title||""} ${t?.customer_name||""} ${t?.tender_title||""}`.toLowerCase();
          if(!hay.includes(q)) return false;
        }
        return true;
      });

      list.sort(sortBy(sortKey,sortDir));
      const paged_hr = window.AsgardPagination ? AsgardPagination.paginate(list, currentPage, pageSize) : list;
      tb.innerHTML = paged_hr.map(r=>{
        const w=works.find(x=>x.id===r.work_id);
        const t=w?tenders.find(x=>x.id===w.tender_id):null;
        const pmU=byId.get(r.pm_id);
        return `<tr data-id="${r.id}">
          <td><b>#${r.id}</b><div class="help">${esc(w?.customer_name||t?.customer_name||"")} — ${esc(w?.work_title||t?.tender_title||"")}</div><div class="help">${r.created_at?esc(new Date(r.created_at).toLocaleString("ru-RU")):""}</div></td>
          <td>${esc(pmU?pmU.name:"—")}</td>
          <td>${esc(compo(r))}</td>
          <td><span class="pill" style="background:${{sent:'var(--info)',answered:'var(--amber)',approved:'var(--ok-t)',rework:'var(--err-t)'}[r.status]||'var(--t2)'};color:#fff;padding:4px 10px;border-radius:12px;font-size:11px;font-weight:600">${{sent:'Отправлен',answered:'Ответ HR',approved:'Согласован',rework:'Доработка'}[r.status]||r.status}</span></td>
          <td><button class="btn" style="padding:6px 10px" data-act="open">Открыть</button></td>
        </tr>`;
      }).join("");
      cnt.textContent = `Показано: ${paged_hr.length} из ${list.length}`;
      if (window.AsgardPagination) {
        let pgEl = document.getElementById("hr_pagination");
        if (!pgEl) { pgEl = document.createElement("div"); pgEl.id = "hr_pagination"; tb.closest("table").after(pgEl); }
        pgEl.innerHTML = AsgardPagination.renderControls(list.length, currentPage, pageSize);
        AsgardPagination.attachHandlers("hr_pagination",
          (p) => { currentPage = p; load(); },
          (s) => { pageSize = s; currentPage = 1; load(); }
        );
      }
    }

    await load();
    $("#f_q").addEventListener("input", ()=>{ currentPage=1; load(); });
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
      const req = await AsgardDB.get("staff_requests", id);
      if(!req){ toast("Ошибка","Заявка не найдена","err"); return; }
      const w = req.work_id ? await AsgardDB.get("works", req.work_id) : null;
      const t = (w && w.tender_id) ? await AsgardDB.get("tenders", w.tender_id) : null;
      const pmU = byId.get(req.pm_id);
      const r = safeJson(req.request_json, {});
      const isVachta = !!req.is_vachta;
      const chosenA = new Set(safeJson(req.proposed_staff_ids_a_json, []));
      const chosenB = new Set(safeJson(req.proposed_staff_ids_b_json, []));
      const chosen = new Set(safeJson(req.proposed_staff_ids_json, []));
      const comment = req.hr_comment||"";

      const rosterByRole = {};
      staff.forEach(s=>{
        const role = s.role_tag||"Другое";
        rosterByRole[role] = rosterByRole[role]||[];
        rosterByRole[role].push(s);
      });

      const rolesHtml = Object.keys(rosterByRole).sort().map(role=>{
        const list = rosterByRole[role];
        const needed = Number(r[role]||0);
        return `<div class="sr-role-group" data-role="${esc(role)}">
          <div class="sr-role-header">
            <div>
              <span class="sr-role-name">${esc(role)}</span>
              ${needed>0?`<span style="margin-left:8px;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:rgba(74,144,217,0.15);color:var(--info)">нужно: ${needed}</span>`:''}
            </div>
            <button class="btn ghost" style="padding:5px 12px;font-size:12px" data-act="pickRole" data-role="${esc(role)}">Авто-подбор</button>
          </div>
          <div class="sr-emp-grid">
            ${list.map(s=> isVachta ? `
              <div class="sr-emp-card ${chosenA.has(s.id)||chosenB.has(s.id)?'selected':''}" data-emp-id="${s.id}" data-emp-name="${esc(s.fio||s.name||'')}" data-emp-role="${esc(s.role_tag||'')}" data-emp-city="${esc(s.city||'')}">
                <div style="display:flex;gap:6px;align-items:center;min-width:60px">
                  <label style="display:flex;gap:4px;align-items:center;font-size:11px;cursor:pointer"><input type="checkbox" class="stchkA" data-id="${s.id}" ${chosenA.has(s.id)?"checked":""}/>A</label>
                  <label style="display:flex;gap:4px;align-items:center;font-size:11px;cursor:pointer"><input type="checkbox" class="stchkB" data-id="${s.id}" ${chosenB.has(s.id)?"checked":""}/>B</label>
                </div>
                <div>
                  <div class="sr-emp-name">${esc(s.fio||s.name||"")}${s.rating_avg ? " ★"+Number(s.rating_avg).toFixed(1) : ""}</div>
                  <div class="sr-emp-info">${esc(s.role_tag||"")}${s.city?" · "+esc(s.city):""}${s.phone?" · "+esc(s.phone):""}</div>
                </div>
              </div>
            ` : `
              <label class="sr-emp-card ${chosen.has(s.id)?'selected':''}" data-emp-id="${s.id}" data-emp-name="${esc(s.fio||s.name||'')}" data-emp-role="${esc(s.role_tag||'')}" data-emp-city="${esc(s.city||'')}">
                <input type="checkbox" class="stchk" value="${s.id}" ${chosen.has(s.id)?"checked":""} style="accent-color:var(--info)"/>
                <div>
                  <div class="sr-emp-name">${esc(s.fio||s.name||"")}${s.rating_avg ? " ★"+Number(s.rating_avg).toFixed(1) : ""}</div>
                  <div class="sr-emp-info">${esc(s.role_tag||"")}${s.city?" · "+esc(s.city):""}${s.phone?" · "+esc(s.phone):""}</div>
                </div>
              </label>
            `).join("")}
          </div>
        </div>`;
      }).join("");

      // ===== Замены (HR инициирует, PM согласует) =====
      const approvedIds = safeJson(req.approved_staff_ids_json, []);
      const approvedA = new Set(safeJson(req.approved_staff_ids_a_json, []));
      const approvedB = new Set(safeJson(req.approved_staff_ids_b_json, []));
      const replaceList = (approvedIds||[]).map(i=>staff.find(s=>s.id===Number(i))).filter(Boolean);
      const replaceHtml = (String(req.status||"")==="approved" && user.role==="HR") ? `
        <hr class="hr"/>
        <div class="sr-section-title">Замены сотрудников</div>
        ${replaceList.length? `<div style="margin-top:8px">${replaceList.map(s=>{
            const crew = approvedA.has(s.id) ? "A" : (approvedB.has(s.id) ? "B" : "");
            return `<div class="pill" style="justify-content:space-between; gap:10px">
              <div><div class="who"><b>${esc(s.fio||s.name||"")}</b> ${crew?`<span class=\"tag\">вахта ${crew}</span>`:""}</div>
              <div class="role">${esc(s.role_tag||"")}${s.city?" • "+esc(s.city):""}</div></div>
              <button class="btn ghost" style="padding:6px 10px" data-act="replace" data-emp="${s.id}">Заменить</button>
            </div>`;
          }).join("")}</div>` : `<div class="help">Нет согласованных сотрудников для замены.</div>`}
      ` : ``;

      // --- Build composition cards ---
      const composParts = Object.entries(r).filter(([k,v])=>Number(v||0)>0);
      const composHtml = composParts.length ? composParts.map(([k,v])=>`<div style="display:inline-flex;align-items:center;gap:6px;background:rgba(74,144,217,0.1);border:1px solid rgba(74,144,217,0.2);border-radius:8px;padding:6px 12px;font-size:13px"><b>${esc(k)}</b><span style="background:var(--info);color:#fff;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700">${v}</span></div>`).join(' ') : '<span style="color:var(--t2)">Не указан</span>';

      const statusColors = {sent:'var(--info)',answered:'var(--amber)',approved:'var(--ok-t)',rework:'var(--err-t)'};
      const statusLabels = {sent:'Отправлен',answered:'Ответ HR',approved:'Согласован',rework:'На доработке'};
      const stColor = statusColors[req.status]||'var(--t2)';
      const stLabel = statusLabels[req.status]||req.status;

      const html = `
        <style>
          .sr-header{display:grid;grid-template-columns:1fr auto;gap:16px;padding:16px 20px;background:linear-gradient(135deg,rgba(13,20,40,0.7),rgba(30,61,114,0.2));border-radius:10px;border:1px solid rgba(255,255,255,0.06)}
          .sr-header .title{font-size:16px;font-weight:700;color:var(--t1)}
          .sr-header .sub{font-size:13px;color:var(--t2);margin-top:4px}
          .sr-badge{display:inline-block;padding:5px 14px;border-radius:20px;font-size:12px;font-weight:700;color:#fff}
          .sr-section{margin-top:16px}
          .sr-section-title{font-size:13px;font-weight:700;color:var(--gold-l,#d4af37);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px;display:flex;align-items:center;gap:8px}
          .sr-role-group{background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:14px;margin-bottom:10px}
          .sr-role-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
          .sr-role-name{font-weight:700;font-size:14px;color:var(--t1)}
          .sr-emp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:6px;max-height:250px;overflow-y:auto;padding-right:4px}
          .sr-emp-card{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.06);cursor:pointer;transition:all 0.15s}
          .sr-emp-card:hover{background:rgba(74,144,217,0.08);border-color:rgba(74,144,217,0.2)}
          .sr-emp-card.selected{background:rgba(74,144,217,0.12);border-color:rgba(74,144,217,0.4)}
          .sr-emp-name{font-size:13px;font-weight:600;color:var(--t1)}
          .sr-emp-info{font-size:11px;color:var(--t2)}
          .sr-chat-msg{padding:10px 14px;border-radius:8px;margin-bottom:6px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05)}
          .sr-chat-msg .who{font-size:11px;color:var(--gold-l);font-weight:600}
          .sr-chat-msg .when{font-size:10px;color:var(--t3)}
          .sr-chat-msg .text{font-size:13px;color:var(--t1);margin-top:4px}
          .sr-search{width:100%;padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.2);color:var(--t1);font-size:13px;margin-bottom:10px}
          .sr-search::placeholder{color:var(--t3)}
          .sr-actions{display:flex;gap:10px;flex-wrap:wrap;padding:16px 0 0;position:sticky;bottom:0;background:var(--bg-card);z-index:2}
          .sr-section-title::after{content:'';flex:1;height:1px;background:rgba(212,168,67,0.2)}
        </style>

        <div class="sr-header">
          <div>
            <div class="title">${esc(w?.customer_name||t?.customer_name||"Заказчик не указан")}</div>
            <div class="sub">${esc(w?.work_title||t?.tender_title||"Работа не указана")}</div>
            <div class="sub" style="margin-top:6px">РП: <b style="color:var(--t1)">${esc(pmU?pmU.name:"Не назначен")}</b></div>
          </div>
          <div style="text-align:right">
            <div class="sr-badge" style="background:${stColor}">${esc(stLabel)}</div>
            <div style="font-size:11px;color:var(--t3);margin-top:6px">${req.created_at?new Date(req.created_at).toLocaleDateString("ru-RU"):""}</div>
          </div>
        </div>

        <div class="sr-section">
          <div class="sr-section-title">Запрошенный состав</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px">${composHtml}</div>
          ${isVachta ? '<div style="margin-top:8px;padding:8px 12px;background:rgba(212,168,67,0.08);border-radius:8px;font-size:12px;color:var(--gold-l)"><b>Вахтовый метод</b>: ротация ' + esc(String(req.rotation_days||"")) + ' дн. (бригады A/B)</div>' : ''}
        </div>

        <div class="sr-section">
          <div class="sr-section-title">Комментарий HR</div>
          <input id="hr_comment" value="${esc(comment)}" placeholder="Условия, доступность, ограничения..." style="width:100%;padding:10px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.2);color:var(--t1);font-size:13px"/>
        </div>

        <div class="sr-section">
          <div class="sr-section-title">Подбор сотрудников</div>
          <div style="display:flex;gap:8px;margin-bottom:10px">
            <input class="sr-search" id="sr_emp_search" placeholder="Поиск по ФИО, должности, городу..." style="flex:1;margin-bottom:0"/>
            <button class="btn ghost" id="btnFromCollection" style="white-space:nowrap;border:1px solid var(--gold);color:var(--gold)">Из подборки</button>
          </div>
          <div id="sr_roles_container">${rolesHtml}</div>
        </div>

        ${replaceHtml}

        <div class="sr-section">
          <div class="sr-section-title">Переписка с РП</div>
          <div id="sr_chat" style="max-height:200px;overflow-y:auto"></div>
          <div style="display:flex;gap:10px;align-items:flex-end;margin-top:10px">
            <div style="flex:1">
              <textarea id="sr_msg" rows="2" placeholder="Сообщение для РП..." style="width:100%;padding:10px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.2);color:var(--t1);font-size:13px;resize:vertical"></textarea>
            </div>
            <button class="btn" id="btnSendSrMsg" style="padding:10px 16px;white-space:nowrap">Отправить</button>
          </div>
        </div>

        <div class="sr-actions">
          <button class="btn primary" id="btnSend" style="flex:1;padding:12px 20px;font-size:14px;font-weight:700">Отправить ответ РП</button>
          <button class="btn ghost" id="btnHistory" style="padding:12px 16px">История</button>
        </div>
      `;
      showModal(`Запрос персонала #${id}`, `<div style="max-height:85vh; overflow-y:auto; padding:4px">${html}</div>`);

      // Collection picker button
      var btnCol = document.getElementById('btnFromCollection');
      if (btnCol && window.AsgardEmployeeCollections) {
        btnCol.addEventListener('click', async function() {
          try {
            var cols = await AsgardEmployeeCollections.getCollectionsList();
            if (!cols.length) { toast('Подборки', 'Нет подборок. Создайте в меню Подборки Дружины', 'err'); return; }
            var colHtml = cols.map(function(c2) {
              return '<div class="col-pick" data-col-id="' + c2.id + '" style="padding:14px;background:var(--bg3);border:1px solid var(--brd);border-radius:8px;cursor:pointer;margin-bottom:6px"><div style="font-weight:700;color:var(--gold)">' + esc(c2.name) + '</div><div style="font-size:12px;color:var(--t3)">' + (c2.employee_count||0) + ' сотр.</div></div>';
            }).join('');
            showModal('Выберите подборку', '<div style="max-height:60vh;overflow-y:auto">' + colHtml + '</div>');
            document.querySelectorAll('.col-pick').forEach(function(el) {
              el.addEventListener('click', async function() {
                var cid = Number(el.dataset.colId);
                var emps = await AsgardEmployeeCollections.getCollectionEmployees(cid);
                var empIds = new Set(emps.map(function(e2){ return e2.id; }));
                document.querySelectorAll('.stchk').forEach(function(cb) {
                  if (empIds.has(Number(cb.value))) { cb.checked = true; }
                  var card2 = cb.closest('.sr-emp-card');
                  if (card2) card2.classList.toggle('selected', cb.checked);
                });
                AsgardUI.hideModal();
                toast('Подборки', 'Сотрудники из подборки отмечены');
              });
            });
          } catch(e2) { toast('Ошибка', 'Не удалось загрузить подборки', 'err'); }
        });
      }

      // Employee search filter
      const searchInput = document.getElementById('sr_emp_search');
      if (searchInput) {
        searchInput.addEventListener('input', () => {
          const q = searchInput.value.toLowerCase().trim();
          document.querySelectorAll('.sr-emp-card').forEach(card => {
            const name = (card.getAttribute('data-emp-name')||'').toLowerCase();
            const role = (card.getAttribute('data-emp-role')||'').toLowerCase();
            const city = (card.getAttribute('data-emp-city')||'').toLowerCase();
            card.style.display = (!q || name.includes(q) || role.includes(q) || city.includes(q)) ? '' : 'none';
          });
          document.querySelectorAll('.sr-role-group').forEach(g => {
            const visible = g.querySelectorAll('.sr-emp-card:not([style*="display: none"])').length;
            g.style.display = visible > 0 ? '' : 'none';
          });
        });
      }

      document.querySelectorAll('.stchk').forEach(cb => {
        cb.addEventListener('change', () => {
          const card = cb.closest('.sr-emp-card');
          if (card) card.classList.toggle('selected', cb.checked);
        });
      });
      document.querySelectorAll('.stchkA, .stchkB').forEach(cb => {
        cb.addEventListener('change', () => {
          const card = cb.closest('.sr-emp-card');
          if (card) {
            const anyChecked = card.querySelector('.stchkA:checked') || card.querySelector('.stchkB:checked');
            card.classList.toggle('selected', !!anyChecked);
          }
        });
      });

      // helpers
      const toDateStr = (d)=>{
        const z = (n)=>String(n).padStart(2,'0');
        return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`;
      };
      const parseDate = (s)=>{ try{ const d=new Date(String(s)+"T00:00:00"); return isNaN(d.getTime())?null:d; }catch(_){ return null; } };
      const listDatesLocal = (start, end)=>{
        const ds=[]; const a=parseDate(start), b=parseDate(end);
        if(!a||!b) return ds;
        let cur = new Date(a.getTime());
        while(cur<=b){ ds.push(toDateStr(cur)); cur.setDate(cur.getDate()+1); }
        return ds;
      };
      const vachtaDates = (start,end,rotationDays,crewLetter)=>{
        const all = listDatesLocal(start,end);
        const d = Math.max(1, Math.round(Number(rotationDays||0)));
        if(!all.length) return [];
        const out=[];
        for(let i=0;i<all.length;i++){
          const seg = Math.floor(i/d)%2; // 0=A,1=B
          const crew = (seg===0)?"A":"B";
          if(crew===crewLetter) out.push(all[i]);
        }
        return out;
      };

      // replacements: open dialog
      async function openReplaceDialog(oldEmployeeId){
        if(user.role!=="HR") return;
        if(String(req.status||"")!=="approved"){ toast("Замена","Доступно только после согласования РП","err"); return; }
        const old = staff.find(s=>s.id===Number(oldEmployeeId));
        if(!old){ toast("Замена","Сотрудник не найден","err"); return; }
        const crew = isVachta ? (approvedA.has(old.id)?"A":(approvedB.has(old.id)?"B":"")) : "";
        const start = w.start_in_work_date;
        const end = w.end_plan;
        const dates = isVachta ? vachtaDates(start,end,req.rotation_days,crew||"A") : listDatesLocal(start,end);
        if(!dates.length){ toast("Замена","У работы не заданы плановые даты","err"); return; }

        // кандидаты: та же роль, не в текущем составе, свободны по датам
        const rosterNow = new Set(approvedIds.map(Number));
        const candidatesAll = staff.filter(s=>String(s.role_tag||"")===String(old.role_tag||"") && !rosterNow.has(s.id) && s.id!==old.id);
        const isFree = async (empId)=>{
          for(const dt of dates){
            const plans = await AsgardDB.byIndex("employee_plan","employee_id", Number(empId));
            // оптимизация: фильтр по dt
            const hit = (plans||[]).find(p=>String(p.date||"")===String(dt) && (String(p.kind||"")==="work" || String(p.kind||"")==="reserve") && Number(p.work_id||0)!==Number(w?.id||0));
            if(hit) return false;
          }
          return true;
        };
        const okIds=[];
        for(const c of candidatesAll){ if(await isFree(c.id)) okIds.push(c.id); }
        const opts = okIds.map(id2=>{ const s=staff.find(x=>x.id===id2); return `<option value="${id2}">${esc(s.fio||s.name||"")} (${esc(s.city||"")})</option>`; }).join("");
        const body = `
          <div class="help"><b>Замена</b>: ${esc(old.fio||old.name||"")} (${esc(old.role_tag||"")}) ${crew?`<span class=\"tag\">вахта ${crew}</span>`:""}</div>
          <div class="help" style="margin-top:6px">Период: ${esc(start||"")} — ${esc(end||"")}</div>
          <div class="formrow" style="margin-top:10px">
          <div id="repNewPicker"></div>
            <div style="grid-column:1/-1"><label>Комментарий (HR)</label><input id="rep_comment" placeholder="причина замены/контакт"/></div>
          </div>
          <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px">
            <button class="btn" id="rep_send">Отправить РП</button>
            <button class="btn ghost" id="rep_cancel">Закрыть</button>
          </div>
        `;
        showModal("Замена сотрудника", `<div style="max-height:70vh; overflow:auto">${body}</div>`);
        if(window.CREmployeePicker && typeof okIds !== 'undefined'){const _okSet=new Set(okIds);CREmployeePicker.renderButton('repNewPicker',{placeholder:'Выберите замену...',title:'Замена сотрудника',filter:e=>_okSet.has(e.id)});}
        const btnSend = document.getElementById("rep_send");
        const btnCancel = document.getElementById("rep_cancel");
        if(btnCancel) btnCancel.onclick = ()=>closeModal();
        if(btnSend) btnSend.onclick = async ()=>{
          const newId = Number(document.getElementById('repNewPicker')?.pickerValue||0);
          if(!newId){ toast("Замена","Выберите кандидата","err"); return; }
          const rec = {
            staff_request_id:req.id,
            work_id:w?.id,
            old_employee_id:old.id,
            new_employee_id:newId,
            crew: crew||null,
            dates_json: JSON.stringify(dates),
            comment: String((document.getElementById("rep_comment")||{}).value||"").trim()||"",
            status:"sent",
            created_by:user.id,
            created_at: isoNow()
          };
          const rid = await AsgardDB.add("staff_replacements", rec);
          await audit(user.id,"staff_replacement", rid,"create", {staff_request_id:req.id, work_id:w?.id, old:old.id, nw:newId, crew});
          await notify(req.pm_id, "Запрос на замену сотрудника", `${w?.customer_name||t?.customer_name} — ${w?.work_title||t?.tender_title}`, "#/pm-works");
          toast("Замена","Отправлено РП");
          closeModal();
          openReq(id);
        };
      }

      // bind replace buttons
      $$('[data-act="replace"]').forEach(b=>{
        b.addEventListener('click', ()=>openReplaceDialog(Number(b.getAttribute('data-emp'))));
      });

      async function renderChat(){
        let msgs=[];
        try{ msgs = await AsgardDB.byIndex("staff_request_messages","staff_request_id", req.id); }catch(e){ msgs=[]; }
        msgs = (msgs||[]).sort((a,b)=>String(a.created_at||"").localeCompare(String(b.created_at||"")));
        const usersAll = await AsgardDB.all("users");
        const uById = new Map((usersAll||[]).map(u=>[u.id,u]));
        const box = document.getElementById("sr_chat");
        if(!box) return;
        if(!msgs.length){ box.innerHTML = `<div class="help">Сообщений нет.</div>`; return; }
        box.innerHTML = msgs.map(m=>{
          const u = uById.get(m.author_user_id)||{};
          const who = esc(u.name||("user#"+m.author_user_id));
          const dt = m.created_at ? new Date(m.created_at).toLocaleString("ru-RU") : "";
          return `<div class="sr-chat-msg"><div style="display:flex;justify-content:space-between"><span class="who">${who}</span><span class="when">${esc(dt)}</span></div><div class="text">${esc(m.text||"")}</div></div>`;
        }).join("");
      }
      await renderChat();

      const btnSendChat = document.getElementById("btnSendSrMsg");
      if(btnSendChat){
        btnSendChat.addEventListener("click", async ()=>{
          const ta = document.getElementById("sr_msg");
          const text = String(ta && ta.value || "").trim();
          if(!text){ toast("Чат","Введите сообщение","err"); return; }
          const msg = { staff_request_id:req.id, author_user_id:user.id, text, created_at: isoNow() };
          const mid = await AsgardDB.add("staff_request_messages", msg);
          await audit(user.id,"staff_request_message",mid,"create",{staff_request_id:req.id});
          await notify(req.pm_id,"Сообщение HR по персоналу",`${w?.customer_name||t?.customer_name} — ${w?.work_title||t?.tender_title}`,"#/pm-works");
          try{ ta.value=""; }catch(_){}
          await renderChat();
          toast("Чат","Отправлено");
        });
      }

      // A/B переключатели (вахта): запрещаем одновременно быть в A и B
      if(isVachta){
        $$(".stchkA").forEach(c=>{
          c.addEventListener("change", ()=>{
            const id2 = Number(c.getAttribute("data-id"));
            if(c.checked){
              $$(".stchkB").forEach(b=>{ if(Number(b.getAttribute("data-id"))===id2) b.checked=false; });
            }
          });
        });
        $$(".stchkB").forEach(c=>{
          c.addEventListener("change", ()=>{
            const id2 = Number(c.getAttribute("data-id"));
            if(c.checked){
              $$(".stchkA").forEach(a=>{ if(Number(a.getAttribute("data-id"))===id2) a.checked=false; });
            }
          });
        });
      }

      // quick pick: select first N in role
      $$("[data-act='pickRole']").forEach(btn=>{
        btn.addEventListener("click", ()=>{
          const role=btn.getAttribute("data-role");
          const need = Number(r[role]||0);
          if(!need) return;
          if(!isVachta){
            let picked=0;
            $$(".stchk").forEach(c=>{
              const stId=Number(c.value);
              const st=staff.find(x=>x.id===stId);
              if(st?.role_tag===role){
                if(picked<need){ c.checked=true; picked++; }
                else c.checked=false;
              }
            });
          }else{
            // для вахты: отдельно набираем A и B одинаковой численности
            const roleStaff = staff.filter(s=>String(s.role_tag||"")===String(role));
            // очистим выделение по роли
            $$(".stchkA").forEach(c=>{ const st=staff.find(x=>x.id===Number(c.getAttribute('data-id'))); if(st?.role_tag===role) c.checked=false; });
            $$(".stchkB").forEach(c=>{ const st=staff.find(x=>x.id===Number(c.getAttribute('data-id'))); if(st?.role_tag===role) c.checked=false; });
            let a=0, b=0;
            for(const s of roleStaff){
              if(a<need){
                const el = $$(".stchkA").find(x=>Number(x.getAttribute('data-id'))===s.id);
                if(el){ el.checked=true; a++; }
                continue;
              }
              if(b<need){
                const el = $$(".stchkB").find(x=>Number(x.getAttribute('data-id'))===s.id);
                if(el){ el.checked=true; b++; }
              }
              if(a>=need && b>=need) break;
            }
          }
        });
      });

      $("#btnHistory").addEventListener("click", async ()=>{
        const logs = (await AsgardDB.all("audit_log"))
          .filter(l=>l.entity_type==="staff_request" && l.entity_id===id)
          .sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
        const rows = logs.map(l=>`
          <div class="pill"><div class="who"><b>${esc(l.action)}</b> — ${esc(new Date(l.created_at).toLocaleString("ru-RU"))}</div><div class="role">${esc(l.actor_user_id)}</div></div>
          <div class="help" style="margin:6px 0 10px">${esc(l.payload_json||"")}</div>
        `).join("");
        showModal("История (staff_request)", rows || `<div class="help">Пусто.</div>`);
      });

      $("#btnSend").addEventListener("click", async ()=>{
        let ids = [];
        let idsA = [];
        let idsB = [];
        if(!isVachta){
          ids = $$(".stchk").filter(c=>c.checked).map(c=>Number(c.value));
        }else{
          idsA = $$(".stchkA").filter(c=>c.checked).map(c=>Number(c.getAttribute('data-id')));
          idsB = $$(".stchkB").filter(c=>c.checked).map(c=>Number(c.getAttribute('data-id')));
          ids = Array.from(new Set([...(idsA||[]),...(idsB||[])]));
          // валидация: состав по каждой роли должен совпадать с запросом для A и для B
          const staffById = new Map((staff||[]).map(s=>[s.id,s]));
          const bad = [];
          Object.keys(r||{}).forEach(role=>{
            const need = Number(r[role]||0);
            if(!need) return;
            const cntA = (idsA||[]).map(id3=>staffById.get(id3)).filter(s=>s&&String(s.role_tag||'')===String(role)).length;
            const cntB = (idsB||[]).map(id3=>staffById.get(id3)).filter(s=>s&&String(s.role_tag||'')===String(role)).length;
            if(cntA!==need) bad.push(`${role}: A=${cntA}/${need}`);
            if(cntB!==need) bad.push(`${role}: B=${cntB}/${need}`);
          });
          if(bad.length){
            toast("Вахта","Нужно подобрать состав для A/B строго по заявке: " + bad.join('; '),"err", 8000);
            return;
          }
          req.proposed_staff_ids_a_json = JSON.stringify(idsA);
          req.proposed_staff_ids_b_json = JSON.stringify(idsB);
        }
        req.proposed_staff_ids_json = JSON.stringify(ids);
        req.hr_comment = $("#hr_comment").value.trim()||"";
        req.status = "answered";
        req.updated_at = isoNow();
        await AsgardDB.put("staff_requests", req);
        await audit(user.id,"staff_request",id,"answer",{count:ids.length, is_vachta:isVachta});

        // Auto-book workers on schedule (reserve)
        try {
          var bookStart = w?.start_in_work_date || req.date_from;
          var bookEnd = w?.end_plan || req.date_to;
          if (bookStart && bookEnd && ids.length) {
            var bookDates = listDatesLocal(bookStart, bookEnd);
            if (bookDates.length > 0 && bookDates.length <= 365) {
              var entries = [];
              ids.forEach(function(empId){
                bookDates.forEach(function(dt){
                  entries.push({
                    employee_id: empId,
                    date: dt,
                    kind: "reserve",
                    work_id: w?.id || null,
                    source: "staff_request",
                    staff_request_id: req.id,
                    locked: true
                  });
                });
              });
              // Bulk create via API
              var token = (await AsgardAuth.getAuth())?.token;
              await fetch("/api/staff/schedule/bulk", {
                method: "POST",
                headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
                body: JSON.stringify({ entries: entries })
              });
            }
          }
        } catch(bookErr) { console.warn("Auto-book error:", bookErr); }

        // notify PM
        await notify(req.pm_id,"Ответ HR по персоналу", `${w?.customer_name||t?.customer_name} — ${w?.work_title||t?.tender_title}`, "#/pm-works");
        toast("HR","Ответ отправлен РП");
        await load();
        openReq(id);
      });
    }
  }

  return { render };
})();