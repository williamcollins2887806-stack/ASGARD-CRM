window.AsgardHrRequestsPage=(function(){
  const { $, $$, esc, toast, showModal, closeModal } = AsgardUI;
  const isDirRole = (r)=> (window.AsgardAuth&&AsgardAuth.isDirectorRole)?AsgardAuth.isDirectorRole(r):(String(r||"")==="DIRECTOR"||String(r||"").startsWith("DIRECTOR_"));

  function isoNow(){ return new Date().toISOString(); }
  function ymNow(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }

  // Role tag → human-readable Russian label
  const ROLE_LABELS = {
    'Мастер':'Мастер','Мастера':'Мастера','master':'Мастер',
    'Слесарь':'Слесарь','Слесари':'Слесари','worker':'Слесарь',
    'ПТО':'ПТО','pto':'ПТО',
    'Промывщик':'Промывщик','Промывщики':'Промывщики','washer':'Промывщик',
    'Химик':'Химик','chemist':'Химик',
    'Сварщик':'Сварщик','welder':'Сварщик',
    'Разнорабочий':'Разнорабочий','laborer':'Разнорабочий',
    'ИТР':'ИТР','itr':'ИТР',
    'pm':'Руководитель проекта','PM':'Руководитель проекта',
    'office':'Офис','OFFICE':'Офис',
    'driver':'Водитель',
    'Другое':'Другое',
  };
  function roleLabel(tag){ return ROLE_LABELS[tag] || tag; }

  // Маппинг role_tag/position сотрудника → ключ из request_json заявки
  // Данные из БД: role_tag = "Слесарь"(477), "Сварщик"(36), "РП"(8)
  // position = NULL(203), "Изолировщик"(83), "Слесарь-монтажник"(57), "Сварщик 6 р"(32), etc.
  const TAG_TO_REQUEST = {
    // === role_tag маппинг ===
    'Слесарь':'Слесари', 'Сварщик':'Сварщики',
    // РП — офисные, не маппим

    // === position маппинг ===
    'Мастер':'Мастера', 'Мастер-наставник':'Мастера', 'Мастер сменный':'Мастера', 'Мастер ответственный':'Мастера',
    'Слесарь-монтажник':'Слесари', 'Слесарь-ремонтник':'Слесари',
    'Монтажник':'Слесари', 'Монтажник ТТ':'Слесари', 'Монтажник ТТ 5р':'Слесари', 'Монтажник ТТ 6р':'Слесари',
    'ПТО':'ПТО', 'Инженер ПТО':'ПТО', 'Мастер ПТО':'ПТО',
    'Сварщик 6 р':'Сварщики', 'Сварщик 5 р':'Сварщики',
    'Изолировщик':'Изолировщики',
    'Слесарь-монтажник, Изолировщик':'Слесари',
    'Жестянщик':'Жестянщики',
    'Водитель':'Водители',
    'Промывщик':'Промывщики', 'Оператор АВД':'Промывщики',
    'Химик':'Химики',
    'ИТР':'ИТР',
    'Разнорабочий':'Разнорабочие', 'Лесовик':'Разнорабочие',
  };
  // Системные/офисные теги — исключать из подбора полевого персонала
  const OFFICE_TAGS = new Set([
    'pm','PM','РП','рп',
    'office','OFFICE','ADMIN','admin','HR','hr','BUH','buh','PROC','proc',
    'Руководитель проектов','Менеджер тендерного отдела','Главный инженер',
  ]);

  function empRequestRole(emp) {
    // position приоритетнее — там точнее специальность
    const pos = String(emp.position||'').trim();
    const tag = String(emp.role_tag||'').trim();
    return TAG_TO_REQUEST[pos] || TAG_TO_REQUEST[tag] || null;
  }
  function isFieldWorker(emp) {
    const tag = String(emp.role_tag||'').trim();
    const pos = String(emp.position||'').trim();
    if (OFFICE_TAGS.has(tag)) return false;
    if (OFFICE_TAGS.has(pos)) return false;
    if (!tag && !pos) return false;
    return true;
  }

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

  async function getUsers(){ return (await AsgardDB.all("users")).filter(u=>u.is_active && u.name && u.name.trim() && u.role !== 'BOT' && !String(u.login||'').startsWith('test_') && u.login !== 'mimir_bot'); }
  // HR works with "employees" (рабочие), not office "staff"
  async function getStaff(){
    const all = await AsgardDB.all("employees");
    return all.filter(e => e.is_active !== false && isFieldWorker(e));
  }

  function safeJson(s,def){ if(Array.isArray(s)||(typeof s==='object'&&s!==null))return s; try{return JSON.parse(s||"");}catch(_){return def;} }

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
        <div class="table-wrap">
          <table class="asg">
            <thead>
              <tr>
                <th><button class="btn ghost mini" data-sort="created_at">Запрос</button></th>
                <th><button class="btn ghost mini" data-sort="pm_id">РП</button></th>
                <th>Состав</th>
                <th><button class="btn ghost mini" data-sort="status">Статус</button></th>
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
          <td><span class="sr-status-pill sr-badge--${r.status||''}">${{sent:'Отправлен',answered:'Ответ HR',approved:'Согласован',rework:'Доработка'}[r.status]||r.status}</span></td>
          <td><button class="btn mini" data-act="open">Открыть</button></td>
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

      // Группировка по запрошенным ролям из request_json
      const requestedRoles = Object.entries(r).filter(([k,v])=>Number(v||0)>0).map(([k])=>k);
      const rosterByRequestRole = {};
      const unmatchedStaff = [];
      requestedRoles.forEach(role => { rosterByRequestRole[role] = []; });

      staff.forEach(s => {
        const mappedRole = empRequestRole(s);
        if (mappedRole && rosterByRequestRole[mappedRole]) {
          rosterByRequestRole[mappedRole].push(s);
        } else if (mappedRole && requestedRoles.length === 0) {
          // Нет конкретного запроса — все в общий пул
          unmatchedStaff.push(s);
        } else {
          unmatchedStaff.push(s);
        }
      });

      // Сортировка внутри групп: по рейтингу (desc), потом ФИО
      const sortByRating = (a,b) => (Number(b.rating_avg||0) - Number(a.rating_avg||0)) || String(a.full_name||a.fio||'').localeCompare(String(b.full_name||b.fio||''),'ru');
      Object.values(rosterByRequestRole).forEach(arr => arr.sort(sortByRating));
      unmatchedStaff.sort(sortByRating);

      function empName(s) {
        return s.full_name || s.fio || `Сотрудник #${s.id}`;
      }
      function empAvatar(s) {
        const name = empName(s);
        const parts = name.split(' ');
        const initials = parts.length >= 2
          ? (parts[0][0] + parts[1][0]).toUpperCase()
          : (name[0] || '?').toUpperCase();
        const hash = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
        return `<div class="sr-avatar sr-avatar--c${hash % 10}">${initials}</div>`;
      }

      function renderEmpRow(s, role) {
        const name = empName(s);
        const pos = s.position || roleLabel(s.role_tag||'');
        const rat = s.rating_avg && Number(s.rating_avg) > 0 ? Number(s.rating_avg).toFixed(1) : '';
        const ratCls = Number(s.rating_avg||0) >= 4 ? 'sr-rat--high' : Number(s.rating_avg||0) >= 3 ? 'sr-rat--mid' : '';
        const phone = s.phone || '';
        const avatar = empAvatar(s);
        const searchData = `data-emp-id="${s.id}" data-emp-name="${esc(name)}" data-emp-role="${esc(role)}" data-emp-city="${esc(s.city||'')}"`;

        if (isVachta) {
          const isSel = chosenA.has(s.id)||chosenB.has(s.id);
          return `<tr class="sr-emp-row ${isSel?'selected':''}" ${searchData}>
            <td class="sr-td-vachta">
              <label><input type="checkbox" class="stchkA" data-id="${s.id}" data-role="${esc(role)}" ${chosenA.has(s.id)?"checked":""}/>A</label>
              <label><input type="checkbox" class="stchkB" data-id="${s.id}" data-role="${esc(role)}" ${chosenB.has(s.id)?"checked":""}/>B</label>
            </td>
            <td class="sr-td-av">${avatar}</td>
            <td class="sr-td-name">${esc(name)}</td>
            <td class="sr-td-pos">${esc(pos)}</td>
            <td class="sr-td-city">${esc(s.city||'')}</td>
            <td class="sr-td-rat ${ratCls}">${rat}</td>
            <td class="sr-td-ph">${esc(phone)}</td>
          </tr>`;
        }
        return `<tr class="sr-emp-row ${chosen.has(s.id)?'selected':''}" ${searchData}>
          <td class="sr-td-chk"><input type="checkbox" class="stchk" value="${s.id}" data-role="${esc(role)}" ${chosen.has(s.id)?"checked":""}></td>
          <td class="sr-td-av">${avatar}</td>
          <td class="sr-td-name">${esc(name)}</td>
          <td class="sr-td-pos">${esc(pos)}</td>
          <td class="sr-td-city">${esc(s.city||'')}</td>
          <td class="sr-td-rat ${ratCls}">${rat}</td>
          <td class="sr-td-ph">${esc(phone)}</td>
        </tr>`;
      }

      function buildEmpTable(list, role) {
        if (!list.length) return '<div class="help sr-empty-hint">Нет сотрудников с подходящей специальностью</div>';
        return `<div class="sr-emp-table-wrap"><table class="sr-emp-table">
          <thead><tr><th class="sr-th-chk"></th><th></th><th>ФИО</th><th>Должность</th><th>Город</th><th>★</th><th>Телефон</th></tr></thead>
          <tbody>${list.map(s => renderEmpRow(s, role)).join("")}</tbody>
        </table></div>`;
      }

      const rolesHtml = requestedRoles.map(role => {
        const list = rosterByRequestRole[role] || [];
        const needed = Number(r[role]||0);
        return `<div class="sr-role-group" data-role="${esc(role)}">
          <div class="sr-role-header">
            <div>
              <span class="sr-role-name">${esc(roleLabel(role))}</span>
              <span class="sr-role-need">нужно: ${needed}</span>
              <span class="sr-role-picked" data-counter="${esc(role)}">выбрано: 0 / ${needed}</span>
            </div>
            <button class="btn ghost mini" data-act="pickRole" data-role="${esc(role)}">Авто-подбор</button>
          </div>
          ${buildEmpTable(list, role)}
        </div>`;
      }).join("") + (unmatchedStaff.length ? `<div class="sr-role-group" data-role="__other">
        <div class="sr-role-header">
          <div><span class="sr-role-name">Остальные сотрудники</span></div>
        </div>
        ${buildEmpTable(unmatchedStaff, '__other')}
      </div>` : '');

      // ===== Замены (HR инициирует, PM согласует) =====
      const approvedIds = safeJson(req.approved_staff_ids_json, []);
      const approvedA = new Set(safeJson(req.approved_staff_ids_a_json, []));
      const approvedB = new Set(safeJson(req.approved_staff_ids_b_json, []));
      const replaceList = (approvedIds||[]).map(i=>staff.find(s=>s.id===Number(i))).filter(Boolean);
      const replaceHtml = (String(req.status||"")==="approved" && user.role==="HR") ? `
        <hr class="hr"/>
        <div class="sr-section-title">Замены сотрудников</div>
        ${replaceList.length? `<div class="sr-section">${replaceList.map(s=>{
            const crew = approvedA.has(s.id) ? "A" : (approvedB.has(s.id) ? "B" : "");
            return `<div class="pill between">
              <div><div class="who"><b>${esc(empName(s))}</b> ${crew?`<span class="tag">вахта ${crew}</span>`:""}</div>
              <div class="role">${esc(roleLabel(s.role_tag||""))}${s.city?" • "+esc(s.city):""}</div></div>
              <button class="btn ghost mini" data-act="replace" data-emp="${s.id}">Заменить</button>
            </div>`;
          }).join("")}</div>` : `<div class="help">Нет согласованных сотрудников для замены.</div>`}
      ` : ``;

      // --- Build composition table with live counters ---
      const composParts = Object.entries(r).filter(([k,v])=>Number(v||0)>0);
      const totalNeeded = composParts.reduce((s,[,v])=>s+Number(v||0),0);
      const composHtml = composParts.length ? `
        <table class="sr-compos-table">
          <thead><tr><th>Должность</th><th>Запрошено</th><th>Выбрано</th></tr></thead>
          <tbody>
            ${composParts.map(([k,v])=>`<tr><td>${esc(k)}</td><td>${v}</td><td class="sr-compos-picked" data-role="${esc(k)}">0 / ${v}</td></tr>`).join('')}
            <tr class="sr-compos-total"><td><b>ИТОГО</b></td><td><b>${totalNeeded}</b></td><td id="sr_total_counter"><b>0 / ${totalNeeded}</b></td></tr>
          </tbody>
        </table>
        ${req.pm_comment ? `<div class="sr-pm-comment">Комментарий РП: «${esc(req.pm_comment)}»</div>` : ''}
      ` : '<span class="sr-compos-empty">Состав на усмотрение HR</span>';

      const statusLabels = {sent:'Отправлен',answered:'Ответ HR',approved:'Согласован',rework:'На доработке'};
      const stLabel = statusLabels[req.status]||req.status;

      const html = `
        <div class="sr-header">
          <div>
            <div class="title">${esc(w?.customer_name||t?.customer_name||"Заказчик не указан")}</div>
            <div class="sub">${esc(w?.work_title||t?.tender_title||"Работа не указана")}</div>
            <div class="sub">РП: <b>${esc(pmU?pmU.name:"Не назначен")}</b>${req.date_from ? ` · ${esc(req.date_from)}` : ''}${req.date_to ? ` — ${esc(req.date_to)}` : ''}</div>
          </div>
          <div class="sr-header__right">
            <div class="sr-badge sr-badge--${esc(req.status||'')}">${esc(stLabel)}</div>
            <div class="sr-header__date">${req.created_at?new Date(req.created_at).toLocaleDateString("ru-RU"):""}</div>
          </div>
        </div>

        <div class="sr-section">
          <div class="sr-section-title">Запрошенный состав</div>
          ${composHtml}
          ${isVachta ? '<div class="sr-vachta-note"><b>Вахтовый метод</b>: ротация ' + esc(String(req.rotation_days||"")) + ' дн. (бригады A/B)</div>' : ''}
        </div>

        <div class="sr-section">
          <div class="sr-section-title">Комментарий HR</div>
          <input id="hr_comment" class="sr-input" value="${esc(comment)}" placeholder="Условия, доступность, ограничения..."/>
        </div>

        <div class="sr-section">
          <div class="sr-section-title">Подбор сотрудников</div>
          <button class="btn ghost mini" id="btnAutoPickAll" style="margin-bottom:8px">Авто-подбор всех</button>
          <div class="sr-msg-row">
            <div><input class="sr-search" id="sr_emp_search" placeholder="Поиск по ФИО, должности, городу..."/></div>
            <button class="btn ghost" id="btnFromCollection">Из подборки</button>
          </div>
          <div id="sr_roles_container">${rolesHtml}</div>
        </div>

        ${replaceHtml}

        <div class="sr-section">
          <div class="sr-section-title">Переписка с РП</div>
          <div id="sr_chat" class="sr-chat-area"></div>
          <div class="sr-msg-row">
            <div><textarea id="sr_msg" class="sr-input" rows="2" placeholder="Сообщение для РП..."></textarea></div>
            <button class="btn" id="btnSendSrMsg">Отправить</button>
          </div>
        </div>

        <div class="sr-actions">
          <button class="btn primary" id="btnSend">Отправить ответ РП</button>
          <button class="btn ghost" id="btnHistory">История</button>
        </div>
      `;
      showModal(`Запрос персонала #${id}`, `<div class="sr-modal-scroll">${html}</div>`);

      // Collection picker button
      var btnCol = document.getElementById('btnFromCollection');
      if (btnCol && window.AsgardEmployeeCollections) {
        btnCol.addEventListener('click', async function() {
          try {
            var cols = await AsgardEmployeeCollections.getCollectionsList();
            if (!cols.length) { toast('Подборки', 'Нет подборок. Создайте в меню Подборки Дружины', 'err'); return; }
            var colHtml = cols.map(function(c2) {
              return '<div class="col-pick sr-col-card" data-col-id="' + c2.id + '"><div class="sr-col-name">' + esc(c2.name) + '</div><div class="sr-col-count">' + (c2.employee_count||0) + ' сотр.</div></div>';
            }).join('');
            showModal('Выберите подборку', '<div class="sr-modal-scroll">' + colHtml + '</div>');
            document.querySelectorAll('.col-pick').forEach(function(el) {
              el.addEventListener('click', async function() {
                var cid = Number(el.dataset.colId);
                var emps = await AsgardEmployeeCollections.getCollectionEmployees(cid);
                var empIds = new Set(emps.map(function(e2){ return e2.id; }));
                document.querySelectorAll('.stchk').forEach(function(cb) {
                  if (empIds.has(Number(cb.value))) { cb.checked = true; }
                  var row2 = cb.closest('.sr-emp-row');
                  if (row2) row2.classList.toggle('selected', cb.checked);
                });
                AsgardUI.hideModal();
                updateCounters();
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
          document.querySelectorAll('.sr-emp-row').forEach(row => {
            const name = (row.getAttribute('data-emp-name')||'').toLowerCase();
            const role = (row.getAttribute('data-emp-role')||'').toLowerCase();
            const city = (row.getAttribute('data-emp-city')||'').toLowerCase();
            row.classList.toggle('cr-field-hidden', !(!q || name.includes(q) || role.includes(q) || city.includes(q)));
          });
          document.querySelectorAll('.sr-role-group').forEach(g => {
            const visible = g.querySelectorAll('.sr-emp-row:not(.cr-field-hidden)').length;
            g.classList.toggle('cr-field-hidden', visible === 0);
          });
        });
      }

      // Live counter update function
      function updateCounters() {
        let totalPicked = 0;
        requestedRoles.forEach(role => {
          const needed = Number(r[role]||0);
          let picked = 0;
          if (!isVachta) {
            picked = document.querySelectorAll(`.stchk[data-role="${CSS.escape(role)}"]:checked`).length;
          } else {
            const aSet = new Set(), bSet = new Set();
            document.querySelectorAll(`.stchkA[data-role="${CSS.escape(role)}"]:checked`).forEach(c => aSet.add(c.dataset.id));
            document.querySelectorAll(`.stchkB[data-role="${CSS.escape(role)}"]:checked`).forEach(c => bSet.add(c.dataset.id));
            picked = new Set([...aSet, ...bSet]).size;
          }
          totalPicked += picked;
          // Update counter in role header
          const counter = document.querySelector(`.sr-role-picked[data-counter="${CSS.escape(role)}"]`);
          if (counter) {
            counter.textContent = `выбрано: ${picked} / ${needed}`;
            counter.classList.toggle('sr-counter-ok', picked >= needed);
            counter.classList.toggle('sr-counter-warn', picked > 0 && picked < needed);
          }
          // Update counter in composition table
          const cell = document.querySelector(`.sr-compos-picked[data-role="${CSS.escape(role)}"]`);
          if (cell) {
            cell.textContent = `${picked} / ${needed}`;
            cell.classList.toggle('sr-counter-ok', picked >= needed);
            cell.classList.toggle('sr-counter-warn', picked > 0 && picked < needed);
          }
        });
        const totalEl = document.getElementById('sr_total_counter');
        if (totalEl) {
          totalEl.innerHTML = `<b>${totalPicked} / ${totalNeeded}</b>`;
          totalEl.classList.toggle('sr-counter-ok', totalPicked >= totalNeeded);
        }
      }

      // Click on table row = toggle checkbox
      document.querySelectorAll('.sr-emp-row').forEach(row => {
        row.addEventListener('click', (e) => {
          if (e.target.tagName === 'INPUT') return; // let native checkbox handle
          const cb = row.querySelector('.stchk, .stchkA');
          if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change', {bubbles:true})); }
        });
      });
      document.querySelectorAll('.stchk').forEach(cb => {
        cb.addEventListener('change', () => {
          const row = cb.closest('.sr-emp-row');
          if (row) row.classList.toggle('selected', cb.checked);
          updateCounters();
        });
      });
      document.querySelectorAll('.stchkA, .stchkB').forEach(cb => {
        cb.addEventListener('change', () => {
          const row = cb.closest('.sr-emp-row');
          if (row) {
            const anyChecked = row.querySelector('.stchkA:checked') || row.querySelector('.stchkB:checked');
            row.classList.toggle('selected', !!anyChecked);
          }
          updateCounters();
        });
      });
      // Initial counter update
      updateCounters();

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
        const opts = okIds.map(id2=>{ const s=staff.find(x=>x.id===id2); return `<option value="${id2}">${esc(empName(s))} (${esc(s.city||"")})</option>`; }).join("");
        const body = `
          <div class="help"><b>Замена</b>: ${esc(empName(old))} (${esc(roleLabel(old.role_tag||""))}) ${crew?`<span class=\"tag\">вахта ${crew}</span>`:""}</div>
          <div class="help">Период: ${esc(start||"")} — ${esc(end||"")}</div>
          <div class="formrow">
          <div id="repNewPicker"></div>
            <div><label>Комментарий (HR)</label><input id="rep_comment" placeholder="причина замены/контакт"/></div>
          </div>
          <div class="sr-replace-btns">
            <button class="btn" id="rep_send">Отправить РП</button>
            <button class="btn ghost" id="rep_cancel">Закрыть</button>
          </div>
        `;
        showModal("Замена сотрудника", `<div class="sr-replace-scroll">${body}</div>`);
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
          return `<div class="sr-chat-msg"><div class="sr-chat-msg-head"><span class="who">${who}</span><span class="when">${esc(dt)}</span></div><div class="text">${esc(m.text||"")}</div></div>`;
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

      // Авто-подбор по роли: выбрать top-N по рейтингу (DOM-порядок уже отсортирован)
      function autoPickRole(role) {
        const need = Number(r[role]||0);
        if (!need) return;
        if (!isVachta) {
          $$(".stchk").forEach(c => { if (c.dataset.role === role) { c.checked = false; c.closest('.sr-emp-row')?.classList.remove('selected'); } });
          let picked = 0;
          $$(".stchk").forEach(c => {
            if (c.dataset.role === role && picked < need) {
              c.checked = true; c.closest('.sr-emp-row')?.classList.add('selected'); picked++;
            }
          });
          if (picked < need) toast("Авто-подбор", `${role}: найдено ${picked} из ${need}`, "warn");
        } else {
          $$(".stchkA").forEach(c => { if (c.dataset.role === role) c.checked = false; });
          $$(".stchkB").forEach(c => { if (c.dataset.role === role) c.checked = false; });
          let a = 0, b = 0;
          const allA = $$(".stchkA").filter(c => c.dataset.role === role);
          const allB = $$(".stchkB").filter(c => c.dataset.role === role);
          for (let i = 0; i < allA.length && a < need; i++) { allA[i].checked = true; a++; }
          for (let i = 0; i < allB.length && b < need; i++) {
            if (!allA[i]?.checked) { allB[i].checked = true; b++; }
            else if (allB.length > allA.length && b < need) { allB[allA.length + b - need]&&(allB[allA.length + b - need].checked = true); b++; }
          }
          // Fallback: just pick first N for B that aren't in A
          if (b < need) {
            const aIds = new Set(allA.filter(c=>c.checked).map(c=>c.dataset.id));
            allB.forEach(c => { if (!aIds.has(c.dataset.id) && b < need && !c.checked) { c.checked = true; b++; } });
          }
          document.querySelectorAll('.sr-emp-row').forEach(card => {
            const any = card.querySelector('.stchkA:checked') || card.querySelector('.stchkB:checked');
            card.classList.toggle('selected', !!any);
          });
        }
        updateCounters();
      }

      $$("[data-act='pickRole']").forEach(btn => {
        btn.addEventListener("click", () => autoPickRole(btn.getAttribute("data-role")));
      });
      // Кнопка "Авто-подбор всех"
      const btnAutoAll = document.getElementById('btnAutoPickAll');
      if (btnAutoAll) {
        btnAutoAll.addEventListener('click', () => { requestedRoles.forEach(role => autoPickRole(role)); });
      }

      $("#btnHistory").addEventListener("click", async ()=>{
        const logs = (await AsgardDB.all("audit_log"))
          .filter(l=>l.entity_type==="staff_request" && l.entity_id===id)
          .sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
        const rows = logs.map(l=>`
          <div class="pill"><div class="who"><b>${esc(l.action)}</b> — ${esc(new Date(l.created_at).toLocaleString("ru-RU"))}</div><div class="role">${esc(l.actor_user_id)}</div></div>
          <div class="help sr-history-detail">${esc(l.payload_json||"")}</div>
        `).join("");
        showModal("История (staff_request)", rows || `<div class="help">Пусто.</div>`);
      });

      $("#btnSend").addEventListener("click", async ()=>{
        let ids = [];
        let idsA = [];
        let idsB = [];
        if(!isVachta){
          ids = $$(".stchk").filter(c=>c.checked).map(c=>Number(c.value));
          req.proposed_staff_ids_a_json = null;
          req.proposed_staff_ids_b_json = null;
        }else{
          idsA = $$(".stchkA").filter(c=>c.checked).map(c=>Number(c.getAttribute('data-id')));
          idsB = $$(".stchkB").filter(c=>c.checked).map(c=>Number(c.getAttribute('data-id')));
          ids = Array.from(new Set([...(idsA||[]),...(idsB||[])]));
          // валидация по data-role атрибуту (маппинг запрошенных ролей)
          const bad = [];
          requestedRoles.forEach(role => {
            const need = Number(r[role]||0);
            if (!need) return;
            const cntA = $$(".stchkA:checked").filter(c => c.dataset.role === role).length;
            const cntB = $$(".stchkB:checked").filter(c => c.dataset.role === role).length;
            if (cntA !== need) bad.push(`${role}: A=${cntA}/${need}`);
            if (cntB !== need) bad.push(`${role}: B=${cntB}/${need}`);
          });
          if(bad.length){
            toast("Вахта","Нужно подобрать состав для A/B строго по заявке: " + bad.join('; '),"err", 8000);
            return;
          }
          req.proposed_staff_ids_a_json = JSON.stringify(idsA);
          req.proposed_staff_ids_b_json = JSON.stringify(idsB);
        }
        if (!ids.length) {
          toast("HR", "Выберите хотя бы одного сотрудника", "err");
          return;
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