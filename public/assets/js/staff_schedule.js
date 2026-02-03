window.AsgardStaffSchedulePage=(function(){
  const {$, $$, esc, toast, showModal, closeModal} = AsgardUI;
  const isDirRole = (r)=> (window.AsgardAuth&&AsgardAuth.isDirectorRole)?AsgardAuth.isDirectorRole(r):(String(r||"" )==="DIRECTOR"||String(r||"" ).startsWith("DIRECTOR_"));

  const STATUS = [
    {code:"free",  label:"Свободен",            defColor:"#334155"},
    {code:"office",label:"Офис",               defColor:"#2563eb"},
    {code:"trip",  label:"Командировка",       defColor:"#8b5cf6"},
    {code:"work",  label:"Работа (контракт)",  defColor:"#16a34a"},
    {code:"note",  label:"Заметка",            defColor:"#f59e0b"}
  ];

  const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

  function parseToRGB(col){
    if(!col) return null;
    let c=String(col).trim();
    if(!c) return null;
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
    if(!rgb) return "#94a3b8";
    if(luminance(rgb) > 0.92) return "#94a3b8";
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
    (works||[]).forEach(w=> m.set(w.id, w.work_title || w.company || `Работа #${w.id}`));
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
    return `<div class="sched-legend">${items}</div>`;
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
          <div class="muted">Дата: <b>${esc(dateIso)}</b></div>
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
    const rows = (employees||[]).sort((a,b)=>String(a.fio||"").localeCompare(String(b.fio||""), 'ru'));
    const ids = rows.map(e=>e.id);
    const colors = await getColors();
    const worksMap = await getWorkTitleById();

    async function renderGrid(){
      const numDays = daysInMonth(viewYear, viewMonth);
      const startDate = new Date(viewYear, viewMonth, 1);
      const endDate = new Date(viewYear, viewMonth, numDays);
      const planMap = await loadPlan(ids, startDate, endDate);
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
      const bodyRows = rows.map(emp=>{
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
          
          let ttl = iso;
          if(rec){
            if(code==="work") ttl = `Работа: ${worksMap.get(Number(rec.work_id||0)) || "Контракт"}`;
            else if(code==="note") ttl = `Заметка: ${rec.note||""}`;
            else {
              const st = STATUS.find(s=>s.code===code);
              ttl = st ? st.label : code;
            }
            ttl = `${iso} • ${ttl}`;
          }
          
          const isLocked = !!(rec && (rec.locked || rec.source==="staff_request"));
          const cellEditable = isLocked ? canShift : true;
          const base = code ? safeBaseColor(color) : "";
          const bgStyle = code ? `background:${toRGBA(base, 0.5)};` : "";
          
          cells.push(`<button class="sched-cell${weekend?' weekend':''}${isToday?' today':''}" 
            style="${bgStyle}" 
            data-date="${esc(iso)}" 
            data-emp="${emp.id}"
            data-code="${esc(code||"")}" 
            ${cellEditable ? '' : "data-locked='1'"} 
            title="${esc(ttl)}" 
            type="button"></button>`);
        }
        return `<div class="sched-row">
          <div class="sched-name">${esc(emp.fio||"")}</div>
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
        </div>
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
          const def = (STATUS.find(s=>s.code===code)||{}).defColor || "#94a3b8";
          const raw = (colors && colors[code]) ? colors[code] : def;
          const base = safeBaseColor(raw);
          btn.style.background = toRGBA(base, 0.5);
          toast("Сохранено", `${dateIso}: ${STATUS.find(s=>s.code===code)?.label||code}`, "ok");
        });
      });
    }

    bindCellClicks();
  }

  return { render };
})();
