window.AsgardOfficeSchedulePage=(function(){
  const {$, $$, esc, toast, showModal, closeModal} = AsgardUI;
  const isDirRole = (r)=> (window.AsgardAuth&&AsgardAuth.isDirectorRole)?AsgardAuth.isDirectorRole(r):(String(r||"" )==="DIRECTOR"||String(r||"" ).startsWith("DIRECTOR_"));

  const STATUS = [
    {code:"оф", label:"В офисе",             color:"#2563eb"},
    {code:"уд", label:"Удалёнка",           color:"#0ea5e9"},
    {code:"бн", label:"На больничном",      color:"#ef4444"},
    {code:"сс", label:"За свой счёт",       color:"#f59e0b"},
    {code:"км", label:"Командировка",       color:"#8b5cf6"},
    {code:"пг", label:"Встреча/переговоры", color:"#22c55e"},
    {code:"уч", label:"Учёба",              color:"#10b981"},
    {code:"ск", label:"Склад",              color:"#64748b"},
    {code:"вх", label:"Выходной",           color:"#334155"},
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
  function isWeekend(dateObj){ const gd=dateObj.getDay(); return (gd===0||gd===6); }
  function daysInMonth(year, month){ return new Date(year, month+1, 0).getDate(); }

  async function getColors(){
    const s = await AsgardDB.get("settings","app");
    let cfg = {};
    try{ cfg = s ? JSON.parse(s.value_json||"{}") : {}; }catch(e){}
    const custom = (cfg.status_colors && cfg.status_colors.office) ? cfg.status_colors.office : {};
    const colors = {};
    STATUS.forEach(st => { colors[st.code] = custom[st.code] || st.color; });
    return colors;
  }

  async function ensureStaffSeed(){
    const staff = await AsgardDB.all("staff") || [];
    const users = await AsgardDB.all("users") || [];
    // Получаем user_id уже существующих записей в staff
    const existingUserIds = new Set(staff.map(s => s.user_id));

    // Добавляем всех активных пользователей, которых нет в staff
    for(const u of users){
      if(!u.is_active) continue;
      if(existingUserIds.has(u.id)) continue;
      await AsgardDB.add("staff", {
        user_id: u.id,
        name: u.name || u.login,
        role_tag: u.role || "",
        created_at: new Date().toISOString()
      });
    }
  }

  async function loadPlanForMonth(staffIds, startDate, endDate){
    const all = await AsgardDB.all("staff_plan");
    const start=ymd(startDate), end=ymd(endDate);
    const m=new Map();
    (all||[]).forEach(p=>{
      if(!p || !p.date) return;
      if(!staffIds.includes(p.staff_id)) return;
      if(p.date < start || p.date > end) return;
      m.set(`${p.staff_id}|${p.date}`, p.status_code||"");
    });
    return m;
  }

  function legendHtml(colors){
    const items = STATUS.map(s=>{
      const base = safeBaseColor(colors[s.code] || s.color);
      return `<span class="sched-legend-item">
        <span class="sched-legend-box" style="background:${esc(base)}"></span>
        <span>${esc(s.label)}</span>
      </span>`;
    }).join("");
    return `<div class="sched-legend">${items}</div>`;
  }

  async function openPicker({staffId, staffName, dateIso, currentCode, colors}){
    return new Promise(resolve=>{
      const opts = STATUS.map(s=>`<option value="${esc(s.code)}"${s.code===currentCode?' selected':''}>${esc(s.label)}</option>`).join("");
      const html = `
        <div class="stack" style="gap:12px">
          <div class="muted">Сотрудник: <b>${esc(staffName||"")}</b></div>
          <div class="muted">Дата: <b>${esc(dateIso)}</b></div>
          <div>
            <label for="schedPick">Статус</label>
            <select id="schedPick">${opts}</select>
          </div>
          <div class="row" style="gap:10px;justify-content:flex-end;margin-top:10px">
            <button class="btn ghost" data-act="clear">Очистить</button>
            <button class="btn ghost" data-act="cancel">Отмена</button>
            <button class="btn primary" data-act="save">Сохранить</button>
          </div>
        </div>`;
      showModal({title:"Статус дня", html, wide:false, onMount:()=>{
        $("#schedPick")?.focus();
        $$("[data-act]").forEach(b=>b.addEventListener("click", async ()=>{
          const act=b.dataset.act;
          if(act==="cancel"){ closeModal(); resolve(null); return; }
          if(act==="clear"){ closeModal(); resolve(""); return; }
          const code=$("#schedPick")?.value||"";
          closeModal();
          resolve(code);
        }));
      }});
    });
  }

  async function upsertPlan(staffId, dateIso, code){
    const all = await AsgardDB.all("staff_plan");
    const existing = (all||[]).find(p=>p.staff_id===staffId && p.date===dateIso);
    if(existing){
      await AsgardDB.del("staff_plan", existing.id);
    }
    if(code){
      await AsgardDB.add("staff_plan", {staff_id:staffId, date:dateIso, status_code:code, updated_at:new Date().toISOString()});
    }
  }

  async function render({layout,title}){
    const auth=await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }
    const user=auth.user;
    await ensureStaffSeed();

    let officeStrictOwn = true;
    try{
      const s = await AsgardDB.get("settings","app");
      const cfg = s ? JSON.parse(s.value_json||"{}") : {};
      if(cfg && cfg.schedules && typeof cfg.schedules.office_strict_own === "boolean"){
        officeStrictOwn = cfg.schedules.office_strict_own;
      }
    }catch(_){}

    const now = new Date();
    let viewYear = now.getFullYear();
    let viewMonth = now.getMonth();

    const staff = await AsgardDB.all("staff");
    const staffSorted = (staff||[]).sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""), 'ru'));
    const staffIds = staffSorted.map(s=>s.id);
    const colors = await getColors();

    async function renderGrid(){
      const numDays = daysInMonth(viewYear, viewMonth);
      const startDate = new Date(viewYear, viewMonth, 1);
      const endDate = new Date(viewYear, viewMonth, numDays);
      const planMap = await loadPlanForMonth(staffIds, startDate, endDate);
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
      const bodyRows = staffSorted.map(s=>{
        const editable = (s.user_id===user.id) || (!officeStrictOwn && (user.role==="ADMIN" || isDirRole(user.role)));
        const cells=[];
        for(let d=1; d<=numDays; d++){
          const dt = new Date(viewYear, viewMonth, d);
          const iso = ymd(dt);
          const weekend = isWeekend(dt);
          const isToday = iso === todayIso;
          const key = `${s.id}|${iso}`;
          let code = planMap.get(key) || "";
          // По умолчанию выходные = "вх"
          if(!code && weekend) code = "вх";
          
          const color = code ? (colors[code] || "#334155") : "";
          const base = code ? safeBaseColor(color) : "";
          const bgStyle = code ? `background:${toRGBA(base, 0.5)};` : "";
          
          cells.push(`<button class="sched-cell${weekend?' weekend':''}${isToday?' today':''}" 
            style="${bgStyle}" 
            data-date="${esc(iso)}" 
            data-staff="${s.id}"
            data-code="${esc(code||"")}" 
            ${editable ? '' : "data-locked='1'"} 
            title="${iso}" 
            type="button"></button>`);
        }
        const badge = (s.user_id===user.id) ? ` <span class="badge blue" style="font-size:10px">вы</span>` : "";
        return `<div class="sched-row">
          <div class="sched-name">${esc(s.name||"")}${badge}</div>
          <div class="sched-cells">${cells.join("")}</div>
        </div>`;
      }).join("");

      return { days, bodyRows, planMap };
    }

    const initialGrid = await renderGrid();

    const html = `
      <div class="page-head">
        <h1>${esc(title||"График офиса")}</h1>
        <div class="motto">Порядок в строю — ясность в делах.</div>
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

    await layout(html, {title: title || "График офиса", motto:"Порядок в строю — ясность в делах."});

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
            toast("Доступ","Можно редактировать только свою строку","warn");
            return;
          }
          const staffId = Number(btn.dataset.staff||0);
          const dateIso = btn.dataset.date;
          const staffObj = staffSorted.find(s=>s.id===staffId);
          const currentCode = btn.dataset.code||"";
          
          const code = await openPicker({staffId, staffName: staffObj?.name||"", dateIso, currentCode, colors});
          if(code===null) return;

          await upsertPlan(staffId, dateIso, code);
          
          const weekend = btn.classList.contains("weekend");
          const finalCode = code || (weekend ? "вх" : "");
          
          if(finalCode){
            planMap.set(`${staffId}|${dateIso}`, finalCode);
            btn.dataset.code = finalCode;
            const def = (STATUS.find(s=>s.code===finalCode)||{}).color || "#94a3b8";
            const raw = (colors && colors[finalCode]) ? colors[finalCode] : def;
            const base = safeBaseColor(raw);
            btn.style.background = toRGBA(base, 0.5);
          } else {
            planMap.delete(`${staffId}|${dateIso}`);
            btn.dataset.code = "";
            btn.style.background = "";
          }
          toast("Сохранено", `${dateIso}: ${STATUS.find(s=>s.code===finalCode)?.label || "—"}`, "ok");
        });
      });
    }

    bindCellClicks();
  }

  return { render };
})();
