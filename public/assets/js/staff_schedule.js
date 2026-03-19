window.AsgardStaffSchedulePage=(function(){
  const { $, $$, esc, toast, showModal, closeModal, formatDate} = AsgardUI;
  const isDirRole = (r)=> (window.AsgardAuth&&AsgardAuth.isDirectorRole)?AsgardAuth.isDirectorRole(r):(String(r||"" )==="DIRECTOR"||String(r||"" ).startsWith("DIRECTOR_"));

  const STATUS = [
    {code:"free",  label:"Свободен",            defColor:"#334155"},
    {code:"office",label:"Офис",               defColor:"var(--blue-l)"},
    {code:"trip",  label:"Командировка",       defColor:"var(--purple)"},
    {code:"work",  label:"Работа (контракт)",  defColor:"var(--ok)"},
    {code:"note",  label:"Заметка",            defColor:"var(--amber)"},
    {code:"reserve",label:"Бронь",             defColor:"var(--purple)"}
  ];

  const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

  function resolveColor(col){
    if(!col || !String(col).includes('var(')) return col;
    const el=document.createElement('div');
    el.style.color=col;
    document.body.appendChild(el);
    const resolved=getComputedStyle(el).color;
    el.remove();
    return resolved;
  }
  function parseToRGB(col){
    if(!col) return null;
    let c=String(col).trim();
    if(!c) return null;
    if(c.includes('var(')) c=resolveColor(c);
    if(/^rgba?\(/i.test(c)){
      const m=c.match(/rgba?\(([^)]+)\)/i);
      if(!m) return null;
      const parts=m[1].split(',').map(x=>x.trim());
      const r=parseFloat(parts[0]), g=parseFloat(parts[1]), b=parseFloat(parts[2]);
      if([r,g,b].some(v=>Number.isNaN(v))) return null;
      return {r:Math.max(0,Math.min(255,Math.round(r))), g:Math.max(0,Math.min(255,Math.round(g))), b:Math.max(0,Math.min(255,Math.round(b)))};
    }
    if(c[0]==='#') c=c.slice(1);
    if(c.length===3) c=c.split('').map(ch=>ch+ch).join('');
    if(c.length!==6) return null;
    const r=parseInt(c.slice(0,2),16), g=parseInt(c.slice(2,4),16), b=parseInt(c.slice(4,6),16);
    if([r,g,b].some(v=>Number.isNaN(v))) return null;
    return {r,g,b};
  }
  function luminance({r,g,b}){
    const sr=[r,g,b].map(v=>{
      v/=255;
      return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
    });
    return 0.2126*sr[0] + 0.7152*sr[1] + 0.0722*sr[2];
  }
  function safeBaseColor(col){
    const rgb=parseToRGB(col);
    if(!rgb) return "var(--t2)";
    if(luminance(rgb) > 0.92) return "var(--t2)";
    return col;
  }
  function toRGBA(col, a){
    const rgb=parseToRGB(col);
    if(!rgb) return `rgba(148,163,184,${a})`;
    return `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
  }

  function ymd(d){
    const x=new Date(d);
    const y=x.getFullYear();
    const m=String(x.getMonth()+1).padStart(2,'0');
    const dd=String(x.getDate()).padStart(2,'0');
    return `${y}-${m}-${dd}`;
  }
  function startOfDay(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }
  function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
  function isWeekend(dateObj){ const gd=dateObj.getDay(); return (gd===0||gd===6); }
  function daysInMonth(year, month){ return new Date(year, month+1, 0).getDate(); }

  async function getColors(){
    const s = await AsgardDB.get("settings","app");
    let cfg = {};
    try{ cfg = s ? JSON.parse(s.value_json||"{}") : {}; }catch(e){}
    const custom = (cfg.status_colors && cfg.status_colors.workers) ? cfg.status_colors.workers : {};
    const colors = {};
    STATUS.forEach(s => { colors[s.code] = custom[s.code] || s.defColor; });
    return colors;
  }

  async function getWorkTitleById(){
    const works = await AsgardDB.all("works");
    const m=new Map();
    (works||[]).forEach(w=> m.set(w.id, w.work_title || w.customer_name || `Работа #${w.id}`));
    return m;
  }

  async function loadPlan(employeeIds, startDate, endDate){
    const all = await AsgardDB.all("employee_plan");
    const start=ymd(startDate), end=ymd(endDate);
    const m=new Map();
    (all||[]).forEach(p=>{
      if(!p || !p.date) return;
      if(!employeeIds.includes(p.employee_id)) return;
      if(p.date < start || p.date > end) return;
      m.set(`${p.employee_id}|${p.date}`, p);
    });
    return m;
  }

  function legendHtml(colors){
    const items = STATUS.map(s=>{
      const base = safeBaseColor(colors[s.code]);
      return `<span class="sched-legend-item">
        <span class="sched-legend-box" style="background:${esc(base)}"></span>
        <span>${esc(s.label)}</span>
      </span>`;
    }).join("");
    return `<div class="sched-legend">${items}
      <span class="sched-legend-item">
        <span class="sched-legend-box" style="background:var(--ok);opacity:0.25;border-bottom:2px solid var(--ok)"></span>
        <span>Назначение (авто)</span>
      </span>
    </div>`;
  }

  async function openPicker({emp, dateIso, current, worksMap, colors}){
    return new Promise(resolve=>{
      const opts = STATUS.map(s=>`<option value="${esc(s.code)}"${s.code===current.kind?' selected':''}>${esc(s.label)}</option>`).join("");
      const workOptions = Array.from(worksMap.entries())
        .sort((a,b)=>String(a[1]).localeCompare(String(b[1]), 'ru'))
        .map(([id,name])=>`<option value="${id}"${Number(current.work_id||0)===id?' selected':''}>${esc(name)}</option>`)
        .join("");

      const html = `
        <div class="stack" style="gap:12px">
          <div class="muted">Сотрудник: <b>${esc(emp.fio||"")}</b></div>
          <div class="muted">Дата: <b>${esc(formatDate(dateIso))}</b></div>
          <div class="formrow" style="grid-template-columns:1fr">
            <div>
              <label for="wk_kind">Статус</label>
              <select id="wk_kind">${opts}</select>
            </div>
            <div id="wk_workBox" class="hide">
              <label for="wk_work">Контракт</label>
              <select id="wk_work"><option value="">—</option>${workOptions}</select>
            </div>
            <div id="wk_noteBox" class="hide">
              <label for="wk_note">Заметка</label>
              <input id="wk_note" placeholder="что планируется" value="${esc(String(current.note||""))}"/>
            </div>
          </div>
          <div class="row" style="gap:10px;justify-content:flex-end;margin-top:10px">
            <button class="btn ghost" data-act="clear">Очистить</button>
            <button class="btn ghost" data-act="cancel">Отмена</button>
            <button class="btn primary" data-act="save">Сохранить</button>
          </div>
        </div>`;
      showModal({title:"Статус дня", html, wide:false, onMount:()=>{
        const kindEl = $("#wk_kind");
        const workBox = $("#wk_workBox");
        const noteBox = $("#wk_noteBox");
        function refresh(){
          const k = kindEl.value;
          workBox.classList.toggle("hide", k!=="work");
          noteBox.classList.toggle("hide", k!=="note");
        }
        kindEl.addEventListener("change", refresh);
        refresh();

        $$('[data-act]').forEach(b=>b.addEventListener('click', async ()=>{
          const act=b.dataset.act;
          if(act==="cancel"){ closeModal(); resolve(null); return; }
          if(act==="clear"){ closeModal(); resolve({clear:true}); return; }
          const kind = kindEl.value;
          const out = { kind, work_id:null, note:"" };
          if(kind==="work"){
            const wid = Number($("#wk_work").value||0) || null;
            if(!wid){ toast("Проверка","Выберите контракт","err"); return; }
            out.work_id = wid;
          }
          if(kind==="note"){
            out.note = ($("#wk_note").value||"").trim();
          }
          closeModal();
          resolve(out);
        }));
      }});
    });
  }

  async function upsertPlan(employee_id, dateIso, payload){
    const all = await AsgardDB.all("employee_plan");
    const existing = (all||[]).find(p => p.employee_id===employee_id && p.date===dateIso);
    if(existing){
      await AsgardDB.del("employee_plan", existing.id);
    }
    if(payload && !payload.clear && payload.kind){
      await AsgardDB.add("employee_plan", {
        employee_id,
        date: dateIso,
        kind: payload.kind,
        work_id: payload.work_id || null,
        note: payload.note || "",
        source: existing?.source || null,
        staff_request_id: existing?.staff_request_id || null,
        locked: existing?.locked ? true : false,
        updated_at: new Date().toISOString()
      });
    }
  }

  async function render({layout, title}){
    const auth=await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }
    const user=auth.user;
    if(!(user.role==="ADMIN" || user.role==="HR" || isDirRole(user.role))){
      toast("Доступ","Недостаточно прав","err");
      location.hash="#/home";
      return;
    }

    let canShift = (user.login === "trukhin");
    try{
      const s = await AsgardDB.get("settings","app");
      const cfg = s ? JSON.parse(s.value_json||"{}") : {};
      const list = (cfg.schedules && Array.isArray(cfg.schedules.workers_shift_logins)) ? cfg.schedules.workers_shift_logins : ["trukhin"];
      canShift = list.map(x=>String(x||"").toLowerCase()).includes(String(user.login||"").toLowerCase());
    }catch(_){}

    // Текущий месяц по умолчанию
    const now = new Date();
    let viewYear = now.getFullYear();
    let viewMonth = now.getMonth();

    const employees = await AsgardDB.all("employees");
    // Фильтруем: только полевые рабочие (без user_id - офисные сотрудники исключаются)
    // и только активные (не удалённые, не заблокированные)
    const rows = (employees||[])
      .filter(e => {
        // Исключаем офисных сотрудников (тех, у кого есть user_id - привязка к пользователю)
        if (e.user_id) return false;
        // Исключаем удалённых
        if (e.deleted === true) return false;
        // Исключаем неактивных (если поле есть и явно false)
        if (e.is_active === false) return false;
        return true;
      })
      .sort((a,b)=>String(a.fio||"").localeCompare(String(b.fio||""), 'ru'));
    const ids = rows.map(e=>e.id);
    const colors = await getColors();
    const worksMap = await getWorkTitleById();
    // Data for Gantt view
    const allWorks = await AsgardDB.all("works");
    const fullWorkMap = new Map((allWorks||[]).map(w=>[w.id, w]));
    const usersAll = await AsgardDB.all("users");
    const userMap = new Map((usersAll||[]).map(u=>[u.id, u.name||u.login||'']));
    const allAssignmentsGlobal = await AsgardDB.all("employee_assignments");

    // == Filter infrastructure ==
    const todayFilterS = ymd(new Date());
    const busyIdsGlobal = new Set();
    (allAssignmentsGlobal||[]).forEach(function(a){
      if(a.employee_id && ids.includes(a.employee_id) && a.date_from){
        if(!a.date_to || a.date_to.slice(0,10) >= todayFilterS) busyIdsGlobal.add(a.employee_id);
      }
    });
    const todayPlanAll = await AsgardDB.all("employee_plan");
    const todayPlanFilterMap = new Map();
    const reserveIds = new Set();
    (todayPlanAll||[]).forEach(function(p){
      if(p && p.date===todayFilterS && ids.includes(p.employee_id)){
        todayPlanFilterMap.set(p.employee_id, p);
        if(p.kind==='reserve') reserveIds.add(p.employee_id);
      }
    });

    let filterStatus = 'all';
    let filterName = '';

    function getFilteredRows(){
      var result = rows;
      if(filterName){
        var q = filterName.toLowerCase();
        result = result.filter(function(e){
          return (e.fio||'').toLowerCase().indexOf(q)>=0 ||
                 (e.specialization||'').toLowerCase().indexOf(q)>=0 ||
                 (e.role_tag||'').toLowerCase().indexOf(q)>=0 ||
                 (e.phone||'').indexOf(q)>=0 ||
                 (e.city||'').toLowerCase().indexOf(q)>=0;
        });
      }
      if(filterStatus!=='all'){
        result = result.filter(function(e){
          var plan = todayPlanFilterMap.get(e.id);
          var kind = plan ? (plan.kind||'free') : 'free';
          if(filterStatus==='busy') return busyIdsGlobal.has(e.id);
          if(filterStatus==='free') return !busyIdsGlobal.has(e.id) && !reserveIds.has(e.id) && (kind==='free'||!plan);
          return kind===filterStatus;
        });
      }
      return result;
    }

    function getStatusCounts(){
      var cnt = {all:rows.length, free:0, busy:0, office:0, trip:0, work:0, reserve:0, note:0};
      rows.forEach(function(e){
        var plan = todayPlanFilterMap.get(e.id);
        var kind = plan ? (plan.kind||'free') : 'free';
        if(busyIdsGlobal.has(e.id)) cnt.busy++;
        if(!busyIdsGlobal.has(e.id) && !reserveIds.has(e.id) && (kind==='free'||!plan)) cnt.free++;
        if(kind==='office') cnt.office++;
        if(kind==='trip') cnt.trip++;
        if(kind==='reserve') cnt.reserve++;
        if(kind==='note') cnt.note++;
      });
      cnt.work = cnt.busy;
      return cnt;
    }

    function filterBarHtml(){
      var sc = getStatusCounts();
      var filters = [
        {key:'all',     label:'\u0412\u0441\u0435',       count:sc.all},
        {key:'free',    label:'\u0421\u0432\u043e\u0431\u043e\u0434\u043d\u044b\u0435', count:sc.free},
        {key:'busy',    label:'\u041d\u0430 \u0440\u0430\u0431\u043e\u0442\u0435', count:sc.busy},
        {key:'office',  label:'\u041e\u0444\u0438\u0441',       count:sc.office},
        {key:'trip',    label:'\u041a\u043e\u043c\u0430\u043d\u0434\u0438\u0440\u043e\u0432\u043a\u0430', count:sc.trip},
        {key:'reserve', label:'\u0411\u0440\u043e\u043d\u044c',     count:sc.reserve},
        {key:'note',    label:'\u0417\u0430\u043c\u0435\u0442\u043a\u0430',   count:sc.note}
      ];
      var btns = filters.map(function(f){
        var active = f.key===filterStatus ? ' sched-f-active' : '';
        return '<button class="sched-f-btn'+active+'" data-filter="'+f.key+'">'+esc(f.label)+' <span class="sched-f-cnt">'+f.count+'</span></button>';
      }).join('');
      return '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 0">'+
        '<input type="text" id="schedSearchName" placeholder="\u041f\u043e\u0438\u0441\u043a \u043f\u043e \u0424\u0418\u041e, \u0441\u043f\u0435\u0446\u0438\u0430\u043b\u0438\u0437\u0430\u0446\u0438\u0438, \u0433\u043e\u0440\u043e\u0434\u0443..." value="'+esc(filterName)+'" style="padding:6px 12px;background:var(--bg2);border:1px solid var(--brd);border-radius:6px;color:var(--t1);font-size:12px;width:260px;outline:none" />'+
        '<div style="display:flex;gap:4px;flex-wrap:wrap">'+btns+'</div>'+
        '</div>';
    }

    async function renderGrid(){
      const numDays = daysInMonth(viewYear, viewMonth);
      const startDate = new Date(viewYear, viewMonth, 1);
      const endDate = new Date(viewYear, viewMonth, numDays);
      const planMap = await loadPlan(ids, startDate, endDate);

      // Load employee_assignments for work overlay
      const allAssignments = await AsgardDB.all("employee_assignments");
      const assignMap = new Map(); // key: "empId|date" -> {work_id, work_title}
      (allAssignments||[]).forEach(a => {
        if(!a.employee_id || !a.date_from) return;
        if(!ids.includes(a.employee_id)) return;
        const df = a.date_from.slice(0,10);
        const dt = a.date_to ? a.date_to.slice(0,10) : df;
        // Check if assignment overlaps with current month
        const mStart = ymd(startDate);
        const mEnd = ymd(endDate);
        if(dt < mStart || df > mEnd) return;
        // Fill all days in range within this month
        const from = new Date(Math.max(new Date(df).getTime(), startDate.getTime()));
        const to = new Date(Math.min(new Date(dt).getTime(), endDate.getTime()));
        for(let cur = new Date(from); cur <= to; cur.setDate(cur.getDate()+1)) {
          const iso = ymd(cur);
          const key = `${a.employee_id}|${iso}`;
          if(!assignMap.has(key)) assignMap.set(key, []);
          assignMap.get(key).push({
            work_id: a.work_id,
            title: worksMap.get(a.work_id) || `Работа #${a.work_id}`,
            role: a.role || ''
          });
        }
      });
      const todayIso = ymd(now);

      // Шапка дней
      const days=[];
      for(let d=1; d<=numDays; d++){
        const dt = new Date(viewYear, viewMonth, d);
        const weekend = isWeekend(dt);
        const iso = ymd(dt);
        const isToday = iso === todayIso;
        days.push(`<div class="sched-day${weekend?' weekend':''}${isToday?' today':''}">${d}</div>`);
      }

      // Строки сотрудников
      const fRows = getFilteredRows();
      const bodyRows = fRows.map(emp=>{
        const cells=[];
        for(let d=1; d<=numDays; d++){
          const dt = new Date(viewYear, viewMonth, d);
          const iso = ymd(dt);
          const weekend = isWeekend(dt);
          const isToday = iso === todayIso;
          const key = `${emp.id}|${iso}`;
          const rec = planMap.get(key) || null;
          const code = rec ? String(rec.kind||"") : "";
          const color = code ? (colors[code] || "#334155") : "";
          
          // Check for work assignments from employee_assignments
          const assignKey = `${emp.id}|${iso}`;
          const assignList = assignMap ? (assignMap.get(assignKey) || []) : [];

          let ttl = iso;
          let cellLabel = "";
          if(rec){
            if(code==="work") ttl = `Работа: ${worksMap.get(Number(rec.work_id||0)) || "Контракт"}`;
            else if(code==="note") ttl = `Заметка: ${rec.note||""}`;
            else {
              const st = STATUS.find(s=>s.code===code);
              ttl = st ? st.label : code;
            }
            ttl = `${formatDate(iso)} \u2022 ${ttl}`;
            if(assignList.length > 0) ttl += ` | \u0418\u0437 \u043d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0439: ${assignList.map(a=>a.title).join(", ")}`;
          } else if(assignList.length > 0) {
            ttl = `${formatDate(iso)} \u2022 \u041d\u0430\u0437\u043d\u0430\u0447\u0435\u043d: ${assignList.map(a=>a.title).join(", ")}`;
            cellLabel = assignList[0].title;
            cellLabel = cellLabel.length > 3 ? cellLabel.slice(0,3) : cellLabel;
          }

          const isLocked = !!(rec && (rec.locked || rec.source==="staff_request"));
          const cellEditable = isLocked ? canShift : true;
          const hasAssignment = assignList.length > 0 && !rec;
          const base = code ? safeBaseColor(color) : (hasAssignment ? safeBaseColor("var(--ok)") : "");
          const bgStyle = code ? `background:${toRGBA(base, 0.5)};` : (hasAssignment ? `background:${toRGBA(base, 0.25)};border-bottom:2px solid ${toRGBA(base,0.7)};` : "");

          cells.push(`<button class="sched-cell${weekend?' weekend':''}${isToday?' today':''}${hasAssignment?' has-assign':''}" 
            style="${bgStyle}" 
            data-date="${esc(iso)}" 
            data-emp="${emp.id}"
            data-code="${esc(code||"")}" 
            ${cellEditable ? '' : "data-locked='1'"} 
            title="${esc(ttl)}" 
            type="button">${hasAssignment && cellLabel ? '<span style="font-size:7px;opacity:0.7;line-height:1">'+esc(cellLabel)+'</span>' : ''}</button>`);
        }
        // Build work assignment summary for this employee this month
        const empAssigns = (allAssignments||[]).filter(a =>
          a.employee_id === emp.id &&
          a.date_from && a.date_to &&
          a.date_from.slice(0,10) <= ymd(endDate) &&
          a.date_to.slice(0,10) >= ymd(startDate)
        );
        const workTags = empAssigns.map(a => {
          const wTitle = worksMap.get(a.work_id) || '';
          return wTitle ? `<span class="sched-work-tag" title="${esc(wTitle)}">${esc(wTitle.length>20?wTitle.slice(0,20)+'…':wTitle)}</span>` : '';
        }).filter(Boolean).join('');

        return `<div class="sched-row">
          <div class="sched-name">${esc(emp.fio||"")}${workTags ? '<div class="sched-work-tags">'+workTags+'</div>' : ''}</div>
          <div class="sched-cells">${cells.join("")}</div>
        </div>`;
      }).join("");

      return { days, bodyRows, planMap };
    }

    const initialGrid = await renderGrid();

    const html = `
      <div class="page-head">
        <h1>${esc(title||"График рабочих")}</h1>
        <div class="motto">Кто где стоит — тот и держит фронт.</div>
      </div>

      <div class="card">
        <div class="sched-header">
          <button class="btn ghost" id="btnPrevMonth">← Назад</button>
          <div class="sched-period" id="schedPeriod">${MONTHS_RU[viewMonth]} ${viewYear}</div>
          <button class="btn ghost" id="btnNextMonth">Вперёд →</button>
          <div style="margin-left:auto;display:flex;gap:4px">
            <button class="btn" id="btnViewCal" style="font-size:12px;padding:6px 12px;background:var(--gold);color:#000;font-weight:700">Календарь</button>
            <button class="btn ghost" id="btnViewGantt" style="font-size:12px;padding:6px 12px">Таймлайн</button>
          </div>
        </div>
        <style>.sched-f-btn{padding:4px 10px;font-size:11px;border:1px solid var(--brd);border-radius:14px;background:transparent;color:var(--t3);cursor:pointer;transition:all .2s;white-space:nowrap}.sched-f-btn:hover{border-color:var(--t2);color:var(--t2)}.sched-f-btn.sched-f-active{background:var(--gold);color:#000;border-color:var(--gold);font-weight:700}.sched-f-cnt{font-size:9px;opacity:.7;margin-left:2px}</style>
        <div id="schedFilterBarWrap">${filterBarHtml()}</div>
        ${legendHtml(colors)}
      </div>

      <div class="card sched-wrap" id="schedWrap">
        <div class="sched-grid">
          <div class="sched-head">
            <div class="sched-name head">Сотрудник</div>
            <div class="sched-days" id="schedDays">${initialGrid.days.join("")}</div>
          </div>
          <div class="sched-body" id="schedBody">${initialGrid.bodyRows || `<div class="muted" style="padding:12px">Нет сотрудников</div>`}</div>
        </div>
      </div>
      <div class="card" id="ganttWrap" style="display:none;overflow-x:auto;padding:0">
        <div id="ganttContent"><div class="muted" style="padding:20px;text-align:center">Загрузка...</div></div>
      </div>
    `;

    await layout(html, {title: title || "График рабочих", motto:"Кто где стоит — тот и держит фронт."});

    let planMap = initialGrid.planMap;

    // Навигация по месяцам
    $("#btnPrevMonth").addEventListener("click", async ()=>{
      viewMonth--;
      if(viewMonth < 0){ viewMonth = 11; viewYear--; }
      await updateGrid();
    });

    $("#btnNextMonth").addEventListener("click", async ()=>{
      viewMonth++;
      if(viewMonth > 11){ viewMonth = 0; viewYear++; }
      await updateGrid();
    });

    async function updateGrid(){
      $("#schedPeriod").textContent = `${MONTHS_RU[viewMonth]} ${viewYear}`;
      const grid = await renderGrid();
      $("#schedDays").innerHTML = grid.days.join("");
      $("#schedBody").innerHTML = grid.bodyRows;
      planMap = grid.planMap;
      bindCellClicks();
    }

    function bindCellClicks(){
      $$(".sched-cell").forEach(btn=>{
        btn.addEventListener("click", async ()=>{
          if(btn.dataset.locked==="1"){
            toast("Доступ","Этот день заблокирован","warn");
            return;
          }
          const empId = Number(btn.dataset.emp||0);
          const dateIso = btn.dataset.date;
          const emp = await AsgardDB.get("employees", empId);
          const existing = planMap.get(`${empId}|${dateIso}`) || {};
          const current = {
            kind: String(existing.kind||"free"),
            work_id: existing.work_id || null,
            note: existing.note || ""
          };
          const payload = await openPicker({emp: emp||{fio:""}, dateIso, current, worksMap, colors});
          if(payload===null) return;

          await upsertPlan(empId, dateIso, payload);
          
          if(payload && payload.clear){
            planMap.delete(`${empId}|${dateIso}`);
            btn.dataset.code = "";
            btn.style.background = "";
            toast("Готово","Очищено","ok");
            return;
          }

          planMap.set(`${empId}|${dateIso}`, Object.assign({}, payload, {employee_id:empId, date:dateIso}));
          const code = payload.kind;
          btn.dataset.code = code;
          const def = (STATUS.find(s=>s.code===code)||{}).defColor || "var(--t2)";
          const raw = (colors && colors[code]) ? colors[code] : def;
          const base = safeBaseColor(raw);
          btn.style.background = toRGBA(base, 0.5);
          toast("Сохранено", `${formatDate(dateIso)}: ${STATUS.find(s=>s.code===code)?.label||code}`, "ok");
        });
      });
    }

    bindCellClicks();

    // == Filter event listeners ==
    function bindFilters(){
      var nameInput = $("#schedSearchName");
      if(nameInput){
        var debounceTimer = null;
        nameInput.addEventListener("input", function(){
          filterName = this.value;
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(function(){ applyFilter(); }, 300);
        });
      }
      $$(".sched-f-btn").forEach(function(btn){
        btn.addEventListener("click", function(){
          filterStatus = this.dataset.filter;
          $$(".sched-f-btn").forEach(function(b){ b.classList.remove("sched-f-active"); });
          this.classList.add("sched-f-active");
          applyFilter();
        });
      });
    }

    async function applyFilter(){
      var wrap = $("#schedFilterBarWrap");
      if(wrap){ wrap.innerHTML = filterBarHtml(); bindFilters(); }
      var isGantt = $("#ganttWrap").style.display !== 'none';
      if(isGantt) renderGantt();
      else await updateGrid();
    }

    bindFilters();

    // == View mode toggle ==
    function setViewMode(mode) {
      var sw = $("#schedWrap"), gw = $("#ganttWrap");
      var bc = $("#btnViewCal"), bg = $("#btnViewGantt");
      if (mode === 'gantt') {
        sw.style.display = 'none';
        gw.style.display = '';
        bc.className = 'btn ghost'; bc.style.cssText = 'font-size:12px;padding:6px 12px';
        bg.className = 'btn'; bg.style.cssText = 'font-size:12px;padding:6px 12px;background:var(--gold);color:#000;font-weight:700';
        renderGantt();
      } else {
        sw.style.display = '';
        gw.style.display = 'none';
        bc.className = 'btn'; bc.style.cssText = 'font-size:12px;padding:6px 12px;background:var(--gold);color:#000;font-weight:700';
        bg.className = 'btn ghost'; bg.style.cssText = 'font-size:12px;padding:6px 12px';
      }
    }
    $("#btnViewCal").addEventListener("click", function(){ setViewMode('calendar'); });
    $("#btnViewGantt").addEventListener("click", function(){ setViewMode('gantt'); });

    // == Gantt timeline ==
    function renderGantt() {
      var displayRows = getFilteredRows();
      var container = $("#ganttContent");
      if (!container) return;
      var nowD = new Date();
      var todayS = ymd(nowD);

      // All assignments for displayed employees
      var empAssigns = (allAssignmentsGlobal||[]).filter(function(a){
        return a.employee_id && ids.includes(a.employee_id) && a.date_from;
      });

      // Categorize employees
      var activeMap = new Map(); // emp_id -> [{assign, work}]
      empAssigns.forEach(function(a){
        var isCurr = !a.date_to || a.date_to.slice(0,10) >= todayS;
        if (!isCurr) return;
        if (!activeMap.has(a.employee_id)) activeMap.set(a.employee_id, []);
        var w = fullWorkMap.get(a.work_id);
        activeMap.get(a.employee_id).push({assign: a, work: w});
      });

      var busyIds = new Set(activeMap.keys());
      var freeRows = displayRows.filter(function(e){ return !busyIds.has(e.id); });
      var busyRows = displayRows.filter(function(e){ return busyIds.has(e.id); });

      // Stats
      var statsH = '<div style="display:flex;gap:12px;flex-wrap:wrap;padding:16px">';
      statsH += '<div style="padding:10px 16px;background:var(--bg2);border-radius:8px;border:1px solid var(--brd);text-align:center"><div style="font-size:20px;font-weight:900;color:var(--gold)">'+displayRows.length+'</div><div style="font-size:10px;color:var(--t3)">'+esc("\u0412\u0441\u0435\u0433\u043e \u0440\u0430\u0431\u043e\u0447\u0438\u0445")+'</div></div>';
      statsH += '<div style="padding:10px 16px;background:var(--bg2);border-radius:8px;border:1px solid var(--brd);text-align:center"><div style="font-size:20px;font-weight:900;color:var(--ok-t)">'+busyRows.length+'</div><div style="font-size:10px;color:var(--t3)">'+esc("\u041d\u0430 \u0440\u0430\u0431\u043e\u0442\u0430\u0445")+'</div></div>';
      statsH += '<div style="padding:10px 16px;background:var(--bg2);border-radius:8px;border:1px solid var(--brd);text-align:center"><div style="font-size:20px;font-weight:900;color:var(--info)">'+freeRows.length+'</div><div style="font-size:10px;color:var(--t3)">'+esc("\u0421\u0432\u043e\u0431\u043e\u0434\u043d\u044b")+'</div></div>';
      statsH += '<div style="padding:10px 16px;background:var(--bg2);border-radius:8px;border:1px solid var(--brd);text-align:center"><div style="font-size:20px;font-weight:900;color:var(--t1)">'+empAssigns.length+'</div><div style="font-size:10px;color:var(--t3)">'+esc("\u041d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0439")+'</div></div>';
      statsH += '</div>';

      if (!empAssigns.length) {
        container.innerHTML = statsH + '<div style="text-align:center;padding:40px;color:var(--t3)"><div style="font-size:16px">'+esc("\u041d\u0435\u0442 \u043d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0439 \u0434\u043b\u044f \u043e\u0442\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u044f")+'</div></div>';
        return;
      }

      // Date range
      var allDates = [];
      empAssigns.forEach(function(a){
        if(a.date_from) allDates.push(new Date(a.date_from));
        allDates.push(a.date_to ? new Date(a.date_to) : nowD);
      });
      var minD = new Date(Math.min.apply(null, allDates));
      var maxD = new Date(Math.max.apply(null, allDates));
      minD.setDate(1); minD.setMonth(minD.getMonth()-1);
      maxD.setDate(1); maxD.setMonth(maxD.getMonth()+2);
      var totalMs = maxD - minD;
      if(totalMs<=0) return;

      var months = [];
      var cur = new Date(minD);
      while(cur < maxD){
        months.push({d:new Date(cur), label:cur.toLocaleDateString('ru-RU',{month:'short',year:'2-digit'})});
        cur.setMonth(cur.getMonth()+1);
      }
      var monthW = Math.max(48, Math.min(80, 1200/months.length));
      var totalW = monthW * months.length;
      var nameW = 200;
      var barH = 24;
      var rowGap = 4;

      // Group by employee
      var empGroups = new Map();
      displayRows.forEach(function(e){ empGroups.set(e.id, {emp:e, assigns:[]}); });
      empAssigns.forEach(function(a){ var g=empGroups.get(a.employee_id); if(g) g.assigns.push(a); });

      // Style
      var styleTag = '<style>.g-bar{transition:transform .15s,box-shadow .15s;z-index:1;cursor:pointer}.g-bar:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,.3);z-index:10!important}</style>';

      // Header
      var hdr = '<div style="display:flex;position:sticky;top:0;z-index:3;background:var(--bg2)">';
      hdr += '<div style="width:'+nameW+'px;min-width:'+nameW+'px;padding:6px 10px;font-size:11px;font-weight:700;color:var(--t2);border-bottom:1px solid var(--brd);border-right:1px solid var(--brd)">'+esc("\u0421\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a")+'</div>';
      hdr += '<div style="display:flex;border-bottom:1px solid var(--brd)">';
      months.forEach(function(m){
        hdr += '<div style="width:'+monthW+'px;min-width:'+monthW+'px;text-align:center;font-size:10px;color:var(--t3);padding:6px 0;border-right:1px solid rgba(255,255,255,0.04)">'+m.label+'</div>';
      });
      hdr += '</div></div>';

      // Rows
      var bodyH = '';
      var ri = 0;
      displayRows.forEach(function(emp){
        var group = empGroups.get(emp.id);
        var assigns = group ? group.assigns : [];
        assigns.sort(function(a,b){ return (a.date_from||'').localeCompare(b.date_from||''); });
        var hasCurrent = busyIds.has(emp.id);

        // Sub-rows for overlapping bars
        var subRows = [];
        assigns.forEach(function(a){
          var d1 = a.date_from ? new Date(a.date_from) : minD;
          var d2 = a.date_to ? new Date(a.date_to) : nowD;
          var placed = false;
          for(var si=0;si<subRows.length;si++){
            if(d1>=subRows[si].end){ subRows[si].items.push(a); subRows[si].end=d2; placed=true; break; }
          }
          if(!placed) subRows.push({items:[a], end:d2});
        });
        if(!subRows.length) subRows.push({items:[], end:minD});

        var empRowH = Math.max(36, subRows.length*(barH+rowGap)+8);
        var bgR = ri%2===0 ? 'rgba(255,255,255,0.01)' : 'transparent';
        bodyH += '<div style="display:flex;min-height:'+empRowH+'px;background:'+bgR+';border-bottom:1px solid rgba(255,255,255,0.04)">';

        // Name cell with status indicator
        var nameStyle = 'width:'+nameW+'px;min-width:'+nameW+'px;padding:4px 10px;font-size:12px;border-right:1px solid var(--brd);display:flex;align-items:center;gap:6px;overflow:hidden';
        var statusDot = hasCurrent
          ? '<span style="width:8px;height:8px;border-radius:50%;background:var(--ok);flex-shrink:0" title="'+esc("\u041d\u0430 \u0440\u0430\u0431\u043e\u0442\u0435")+'"></span>'
          : '<span style="width:8px;height:8px;border-radius:50%;background:var(--t3);opacity:0.4;flex-shrink:0" title="'+esc("\u0421\u0432\u043e\u0431\u043e\u0434\u0435\u043d")+'"></span>';
        var nameColor = hasCurrent ? 'color:var(--t1);font-weight:600' : 'color:var(--t3)';
        var currentWork = '';
        if (hasCurrent) {
          var cw = activeMap.get(emp.id);
          if (cw && cw.length) {
            var wNames = cw.map(function(x){ return x.work ? (x.work.customer_name||x.work.work_title||'') : ''; }).filter(Boolean);
            if (wNames.length) currentWork = '<div style="font-size:9px;color:var(--ok-t);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px" title="'+esc(wNames.join(', '))+'">'+esc(wNames[0])+'</div>';
          }
        }
        bodyH += '<div style="'+nameStyle+'">'+statusDot+'<div style="min-width:0"><div style="'+nameColor+';white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+esc(emp.fio||'')+'">'+esc(emp.fio||'')+'</div>'+currentWork+'</div></div>';

        // Bars area
        bodyH += '<div style="position:relative;width:'+totalW+'px;min-width:'+totalW+'px">';
        months.forEach(function(m,mi){ bodyH += '<div style="position:absolute;left:'+(mi*monthW)+'px;top:0;bottom:0;width:1px;background:rgba(255,255,255,0.03)"></div>'; });
        subRows.forEach(function(sr,sri){
          sr.items.forEach(function(a){
            var d1 = a.date_from ? new Date(a.date_from) : minD;
            var d2 = a.date_to ? new Date(a.date_to) : nowD;
            var left = ((d1-minD)/totalMs)*totalW;
            var width = Math.max(6, ((d2-d1)/totalMs)*totalW);
            var w = fullWorkMap.get(a.work_id);
            var isCurr = !a.date_to || a.date_to.slice(0,10)>=todayS;
            var bgC = isCurr ? 'linear-gradient(135deg,#d4a825,#c9952a)' : 'linear-gradient(135deg,#22c55e,#1a8a4a)';
            var lbl = w ? (w.work_title||w.customer_name||'').substring(0,28) : '';
            var cust = w ? (w.customer_name||'') : '';
            var city = w ? (w.city||'') : '';
            var pm = w&&w.pm_id ? (userMap.get(w.pm_id)||'') : '';
            var role = a.role||a.role_on_work||'';
            var days = Math.max(1, Math.round((d2-d1)/86400000));
            var df2 = d1.toLocaleDateString('ru-RU');
            var dt2 = a.date_to ? d2.toLocaleDateString('ru-RU') : '\u043f\u043e \u043d.\u0432.';
            var tip = lbl + ' | ' + cust + (city ? ' | '+city : '') + ' | \u0420\u041f: '+pm+' | \u0420\u043e\u043b\u044c: '+role+' | '+df2+' \u2014 '+dt2+' | '+days+' \u0434\u043d.'+(isCurr?' (\u0430\u043a\u0442\u0438\u0432\u043d\u0430)':' (\u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u0430)');
            var top = sri*(barH+rowGap)+4;
            bodyH += '<div class="g-bar" style="position:absolute;left:'+left+'px;top:'+top+'px;width:'+width+'px;height:'+barH+'px;background:'+bgC+';border-radius:5px;display:flex;align-items:center;padding:0 6px;font-size:10px;font-weight:600;color:#fff;overflow:hidden;white-space:nowrap" title="'+esc(tip)+'">'+esc(lbl)+'</div>';
          });
        });
        bodyH += '</div></div>';
        ri++;
      });

      // Today line
      var todayLeft = ((nowD-minD)/totalMs)*totalW;

      // Legend
      var legend = '<div style="display:flex;gap:16px;padding:12px 16px;font-size:11px;color:var(--t3);border-top:1px solid var(--brd)">';
      legend += '<span><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:linear-gradient(135deg,#d4a825,#c9952a);margin-right:4px;vertical-align:middle"></span>'+esc("\u0410\u043a\u0442\u0438\u0432\u043d\u0430\u044f \u0440\u0430\u0431\u043e\u0442\u0430")+'</span>';
      legend += '<span><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:linear-gradient(135deg,#22c55e,#1a8a4a);margin-right:4px;vertical-align:middle"></span>'+esc("\u0417\u0430\u0432\u0435\u0440\u0448\u0451\u043d\u043d\u0430\u044f")+'</span>';
      legend += '<span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--ok);margin-right:4px;vertical-align:middle"></span>'+esc("\u041d\u0430 \u0440\u0430\u0431\u043e\u0442\u0435")+'</span>';
      legend += '<span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--t3);opacity:0.4;margin-right:4px;vertical-align:middle"></span>'+esc("\u0421\u0432\u043e\u0431\u043e\u0434\u0435\u043d")+'</span>';
      legend += '<span style="margin-left:auto"><span style="display:inline-block;width:12px;height:2px;background:var(--red);margin-right:4px;vertical-align:middle"></span>'+esc("\u0421\u0435\u0433\u043e\u0434\u043d\u044f")+'</span>';
      legend += '</div>';

      // Free workers list
      var freeH = '';
      if (freeRows.length > 0) {
        freeH = '<div style="padding:12px 16px;border-top:1px solid var(--brd)">';
        freeH += '<div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:8px">'+esc("\u0421\u0432\u043e\u0431\u043e\u0434\u043d\u044b\u0435 \u0440\u0430\u0431\u043e\u0447\u0438\u0435 ("+freeRows.length+")")+'</div>';
        freeH += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
        freeRows.forEach(function(e){
          var spec = e.role_tag || e.specialization || '';
          var tipF = (e.fio||'') + (spec ? ' | '+spec : '') + (e.city ? ' | '+e.city : '') + (e.phone ? ' | '+e.phone : '');
          freeH += '<div style="padding:4px 10px;background:var(--bg2);border:1px solid var(--brd);border-radius:6px;font-size:11px;color:var(--t2);cursor:default" title="'+esc(tipF)+'">'+esc(e.fio||'')+(spec ? ' <span style="color:var(--t3)">'+esc(spec)+'</span>' : '')+'</div>';
        });
        freeH += '</div></div>';
      }

      container.innerHTML = styleTag + statsH +
        '<div style="overflow-x:auto;position:relative">' +
          '<div style="min-width:'+(nameW+totalW)+'px">' +
            hdr + bodyH +
            '<div style="position:absolute;left:'+(nameW+todayLeft)+'px;top:0;bottom:0;width:2px;background:var(--red);z-index:5;opacity:0.6;pointer-events:none" title="'+esc("\u0421\u0435\u0433\u043e\u0434\u043d\u044f")+'"></div>' +
          '</div>' +
        '</div>' + legend + freeH;
    }
  }

  return { render };
})();
