
window.AsgardGanttFullPage=(function(){
  const {$, $$, esc, toast, showModal} = AsgardUI;
  const isDirRole = (r)=> (window.AsgardAuth&&AsgardAuth.isDirectorRole)?AsgardAuth.isDirectorRole(r):(r==="DIRECTOR"||String(r||"").startsWith("DIRECTOR_"));

  function safeOn(){ try{ return (window.AsgardSafeMode && AsgardSafeMode.isOn()); }catch(e){ return false; } }
  function norm(s){ return String(s||"").trim().toLowerCase(); }

  function parseDate(v){
    if(!v) return null;
    if(typeof v === 'string'){
      // YYYY-MM-DD → парсим как ЛОКАЛЬНУЮ дату (иначе new Date('2026-03-28') = UTC midnight,
      // и в браузере вне Moscow TZ getDate() возвращает предыдущий день)
      const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
      if(m) return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
    }
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  function isoDate(d){
    const y=d.getFullYear();
    const m=String(d.getMonth()+1).padStart(2,'0');
    const dd=String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${dd}`;
  }
  function startOfWeek(d){
    const x=new Date(d);
    const day=(x.getDay()+6)%7; // Mon=0
    x.setHours(0,0,0,0);
    x.setDate(x.getDate()-day);
    return x;
  }
  function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
  function clamp(n,min,max){ return Math.max(min, Math.min(max,n)); }

  function overlap(aStart,aEnd,bStart,bEnd){
    const a0 = (parseDate(aStart)||new Date('1970-01-01')); a0.setHours(0,0,0,0);
    const a1 = (parseDate(aEnd)||parseDate(aStart)||a0); a1.setHours(0,0,0,0);
    const b0 = (parseDate(bStart)||new Date('1970-01-01')); b0.setHours(0,0,0,0);
    const b1 = (parseDate(bEnd)||parseDate(bStart)||b0); b1.setHours(0,0,0,0);
    return a0<=b1 && b0<=a1;
  }

  function calcWeeks(fromIso,toIso){
    const f=parseDate(fromIso); const t=parseDate(toIso);
    if(!f||!t) return null;
    const ms = 7*24*60*60*1000;
    const f0=startOfWeek(f);
    // Включаем целиком ту неделю, в которой находится конец диапазона
    // (startOfWeek(t) + 7 даёт понедельник следующей недели)
    const t0=addDays(startOfWeek(t), 7);
    return Math.ceil((t0-f0)/ms);
  }

  async function getCoreSettings(){
    const s = await AsgardDB.get("settings","app");
    return s ? JSON.parse(s.value_json||"{}") : {vat_pct:22, gantt_start_iso:"2026-01-01T00:00:00Z", status_colors:{tender:{}, work:{}}};
  }
  function renderSafeList(items, title){
    const fmtDate = AsgardUI.formatDate || (d => d ? new Date(d).toLocaleDateString('ru-RU') : '—');
    const rows = (items||[]).map(it=>{
      const name = it.title || it.work_title || it.tender_title || ("ID "+it.id);
      const start = fmtDate(it.start || it.start_in_work_date || it.start_plan || it.work_start_plan);
      const end = fmtDate(it.end || it.end_plan || it.work_end_plan);
      const st = it.work_status || it.status || it.tender_status || "";
      return `<tr><td>${esc(name)}</td><td class="mono">${start}</td><td class="mono">${end}</td><td>${esc(st)}</td></tr>`;
    }).join("");
    return `
      <div class="card">
        <div class="muted">Safe-mode включён: Гантт отключён, показан список периодов.</div>
        <div class="actions" style="margin-top:10px">
          <button class="btn ghost" id="btnSafeOff">Выключить safe-mode</button>
        </div>
      </div>
      <div class="card" style="margin-top:12px">
        <table class="tbl">
          <thead><tr><th>Проект</th><th>Старт</th><th>Финиш</th><th>Статус</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="4" class="muted">нет данных</td></tr>`}</tbody>
        </table>
      </div>
    `;
  }

  /* S9: use shared AsgardGantt.navHtml / .initNav */
  const ganttNavHtml = AsgardGantt.navHtml;
  const initGanttNav = AsgardGantt.initNav;

  async function renderCalcs({layout}={}){
    const auth=await AsgardAuth.requireUser();
    const user=auth.user; const isDir = (user.role==="ADMIN"||isDirRole(user.role));
    const core=await getCoreSettings();

    const refsRec = await AsgardDB.get("settings","refs");
    const refs = refsRec ? JSON.parse(refsRec.value_json||"{}") : {};
    const pmUsers = (await AsgardDB.all("users")).filter(u=>u.role==="PM" || (Array.isArray(u.roles) && u.roles.includes("PM")));

    // Load tenders visible
    let tenders = (await AsgardDB.all("tenders")).filter(t => t.handoff_at);
    if(!isDir){ tenders = tenders.filter(t=>t.responsible_pm_id===user.id); }

    // only those in pipeline (not отказ) unless show
    const body = `
      <div class="card">
        <div class="row" style="justify-content:space-between; gap:10px; align-items:center">
          <div>
            <div class="kpi"><span class="dot" style="background:var(--info)"></span> Гантт • Просчёты</div>
            <div class="help">Шкала: недели. Линия «сегодня» отмечает текущую дату. Старт: ${esc(core.gantt_start_iso ? new Date(core.gantt_start_iso).toLocaleDateString("ru-RU") : "01.01.2026")}.</div>
          </div>
          <div class="row" style="gap:8px; flex-wrap:wrap">
            <button class="btn ghost" id="fs">Открыть на весь экран</button>
            <a class="btn ghost" style="padding:8px 12px" href="#/pm-calcs">Назад</a>
          </div>
        </div>
        <hr class="hr"/>
        ${ganttNavHtml()}
        <div class="row" style="gap:10px; flex-wrap:wrap; align-items:end">
          <input id="q" placeholder="Поиск: заказчик / работа" style="max-width:360px"/>
          <div id="cr-flt-wrap" style="max-width:240px;min-width:180px"></div>
          <div id="cr-pm-wrap" style="max-width:240px;min-width:180px"></div>
          <div id="cr-st-wrap" style="max-width:260px;min-width:180px"></div>
          <div id="cr-per-wrap" style="max-width:220px;min-width:180px"></div>
          <input id="from" type="hidden"/>
          <input id="to" type="hidden"/>
          <div id="cr-zoom-wrap" style="max-width:190px;min-width:150px"></div>
        </div>
        <div id="g" style="margin-top:12px"></div>
      </div>
    `;

    if(safeOn()){
      const body = renderSafeList(tenders, "renderCalcs");
      await layout(body, {title: "Гантт • Просчёты", motto: "Путь виден. Но сейчас — безопасный режим."});
      const b = document.getElementById("btnSafeOff");
      if(b) b.onclick = ()=>{ try{ AsgardSafeMode.disable(); }catch(_){} location.reload(); };
      return;
    }

await layout(body,{title:"Гантт • Просчёты", motto:"Сроки видны. Силы рассчитаны. Риск под контролем."});

    // Create CRSelect filters
    const crFltWrap = document.getElementById('cr-flt-wrap');
    if(crFltWrap) crFltWrap.appendChild(CRSelect.create({
      id: 'g-flt',
      options: [
        { value: 'active', label: 'Активные' },
        { value: 'all', label: 'Все' },
        { value: 'lost', label: 'Только отказ/проигрыш' }
      ],
      value: 'active',
      onChange: () => apply()
    }));

    const pmOpts = isDir
      ? [{value:'all',label:'РП: все'}, ...pmUsers.map(u=>({value:String(u.id),label:u.name||u.login}))]
      : [{value:String(user.id),label:'РП: '+(user.name||user.login)}];
    const crPmWrap = document.getElementById('cr-pm-wrap');
    if(crPmWrap) crPmWrap.appendChild(CRSelect.create({
      id: 'g-pm',
      options: pmOpts,
      value: isDir ? 'all' : String(user.id),
      onChange: () => apply()
    }));

    const tenderStatuses = Array.isArray(refs.tender_statuses) ? refs.tender_statuses : [...new Set(tenders.map(t=>t.tender_status).filter(Boolean))];
    const crStWrap = document.getElementById('cr-st-wrap');
    if(crStWrap) crStWrap.appendChild(CRSelect.create({
      id: 'g-st',
      options: [{value:'all',label:'Статус: все'}, ...tenderStatuses.map(s=>({value:String(s),label:String(s)}))],
      value: 'all',
      onChange: () => apply()
    }));

    const crPerWrap = document.getElementById('cr-per-wrap');
    if(crPerWrap) crPerWrap.appendChild(CRSelect.create({
      id: 'g-per',
      options: [
        { value: 'custom', label: 'Период: вручную' },
        { value: 'month', label: 'Текущий месяц' },
        { value: 'year', label: 'Текущий год' },
        { value: 'last12', label: 'Последние 12 месяцев' },
        { value: 'all', label: 'Всё время' }
      ],
      value: 'custom',
      onChange: (v) => { setPreset(v); apply(); }
    }));

    const crZoomWrap = document.getElementById('cr-zoom-wrap');
    if(crZoomWrap) crZoomWrap.appendChild(CRSelect.create({
      id: 'g-zoom',
      options: [
        { value: '12', label: 'Масштаб: 12 нед' },
        { value: '26', label: '26 нед' },
        { value: '52', label: '52 нед' },
        { value: '104', label: '104 нед' }
      ],
      value: '52',
      onChange: () => apply()
    }));

    // Defaults
    const fromInp = $("#from");
    const toInp = $("#to");

    function apply(){
      const q=norm($("#q").value);
      const flt=CRSelect.getValue('g-flt')||'active';
      const pmV=CRSelect.getValue('g-pm')||'all';
      const stV=CRSelect.getValue('g-st')||'all';
      const perV=CRSelect.getValue('g-per')||'custom';
      const fromV=fromInp.value;
      const toV=toInp.value;
      const zoomW=Number(CRSelect.getValue('g-zoom')||'52')||52;

      let items=[...tenders];
      if(q) items=items.filter(t=> norm(t.customer_name).includes(q) || norm(t.tender_title).includes(q));
      if(pmV && pmV!=="all") items = items.filter(t=> String(t.responsible_pm_id||"") === String(pmV));
      if(stV && stV!=="all") items = items.filter(t=> String(t.tender_status||"") === String(stV));

      const lostSet=new Set(["Проиграли","Не участвуем"]);
      if(flt==="active") items=items.filter(t=> !lostSet.has(t.tender_status));
      if(flt==="lost") items=items.filter(t=> lostSet.has(t.tender_status));

      // Period filter by overlap
      let windowFrom = null, windowTo = null;
      if(perV==="all"){
        windowFrom = null; windowTo = null;
      }else{
        if(fromV) windowFrom = fromV;
        if(toV) windowTo = toV;
      }
      if(windowFrom || windowTo){
        const f = windowFrom || windowTo;
        const t = windowTo || windowFrom;
        items = items.filter(tn=> overlap(tn.work_start_plan||f, tn.work_end_plan||tn.work_start_plan||f, f, t));
      }

      // timeline window
      const baseStart = (windowFrom || (core.gantt_start_iso ? core.gantt_start_iso.slice(0,10) : "2026-01-01"));
      const startIso = isoDate(startOfWeek(parseDate(baseStart) || new Date("2026-01-01")));
      let weeks = zoomW;
      if(windowFrom && windowTo){
        const w = calcWeeks(windowFrom, windowTo);
        if(w) weeks = w;
      }
      weeks = clamp(weeks, 4, 104);

      const rows = items.map(t=>{
        const st = t.work_start_plan || startIso;
        const en = t.work_end_plan || t.work_start_plan || startIso;
        return {
          id: t.id,
          label: `${t.customer_name||""} — ${t.tender_title||""}`,
          sub: t.tender_status || "",
          start: st,
          end: en,
          kind: "tender",
          status: t.tender_status || ""
        };
      });
      const statusColors = core.status_colors?.tender || {};
      const html = AsgardGantt.renderBoard({
        startIso,
        weeks,
        rows,
        getColor: (r)=> statusColors[r.status] || "#2a6cf1"
      });
      $("#g").innerHTML=html;

      // open item click
      $$("#g [data-gitem]").forEach(el=>{
        el.addEventListener("click", async ()=>{
          const id=Number(el.getAttribute("data-gitem"));
          location.hash = "#/pm-calcs?open="+encodeURIComponent(String(id));
        });
      });
    }

    function setPreset(v){
      const now=new Date(); now.setHours(0,0,0,0);
      if(v==="month"){
        const a=new Date(now.getFullYear(), now.getMonth(), 1);
        const b=new Date(now.getFullYear(), now.getMonth()+1, 0);
        fromInp.value = isoDate(a);
        toInp.value = isoDate(b);
      }else if(v==="year"){
        const a=new Date(now.getFullYear(), 0, 1);
        const b=new Date(now.getFullYear(), 11, 31);
        fromInp.value = isoDate(a);
        toInp.value = isoDate(b);
      }else if(v==="last12"){
        const a=new Date(now.getFullYear(), now.getMonth()-11, 1);
        const b=new Date(now.getFullYear(), now.getMonth()+1, 0);
        fromInp.value = isoDate(a);
        toInp.value = isoDate(b);
      }else if(v==="all"){
        fromInp.value = "";
        toInp.value = "";
      }
    }

    $("#q").addEventListener("input", apply);
    // CRSelect onChange handlers already set above
    $("#fs").addEventListener("click", ()=>{
      AsgardUI.showModal("Гантт • Просчёты (полный экран)", `<div id="gfs" style="height:76vh; overflow:auto">${$("#g").innerHTML}</div>`);
      document.querySelector(".modal")?.classList.add("fullscreen");
      setTimeout(()=>{
        document.querySelectorAll("#gfs [data-gitem]").forEach(el=>{
          el.addEventListener("click", ()=>{
            const id=Number(el.getAttribute("data-gitem"));
            location.hash = "#/pm-calcs?open="+encodeURIComponent(String(id));
          });
        });
      }, 0);
    });

    initGanttNav(fromInp, toInp, apply);
  }

  async function renderWorks({layout}={}){
    const auth=await AsgardAuth.requireUser();
    const user=auth.user; const isDir=(user.role==="ADMIN"||isDirRole(user.role));
    const core=await getCoreSettings();

    const refsRec = await AsgardDB.get("settings","refs");
    const refs = refsRec ? JSON.parse(refsRec.value_json||"{}") : {};
    const pmUsers = (await AsgardDB.all("users")).filter(u=>u.role==="PM" || (Array.isArray(u.roles) && u.roles.includes("PM")));

    let works = await AsgardDB.all("works");
    if(!isDir){ works = works.filter(w=>w.pm_id===user.id); }

    const body = `
      <div class="card">
        <div class="row" style="justify-content:space-between; gap:10px; align-items:center">
          <div>
            <div class="kpi"><span class="dot" style="background:var(--err-t)"></span> Гантт • Работы</div>
            <div class="help">Шкала: недели. Линия «сегодня». Старт: ${esc(core.gantt_start_iso ? new Date(core.gantt_start_iso).toLocaleDateString("ru-RU") : "01.01.2026")}.</div>
          </div>
          <div class="row" style="gap:8px; flex-wrap:wrap">
            <button class="btn ghost" id="fs">Открыть на весь экран</button>
            <a class="btn ghost" style="padding:8px 12px" href="#/pm-works">Назад</a>
          </div>
        </div>
        <hr class="hr"/>
        ${ganttNavHtml()}
        <div class="row" style="gap:10px; flex-wrap:wrap; align-items:end">
          <input id="q" placeholder="Поиск: компания / работа" style="max-width:360px"/>
          <div id="cr-flt-wrap" style="max-width:240px;min-width:180px"></div>
          <div id="cr-pm-wrap" style="max-width:240px;min-width:180px"></div>
          <div id="cr-st-wrap" style="max-width:260px;min-width:180px"></div>
          <div id="cr-per-wrap" style="max-width:220px;min-width:180px"></div>
          <input id="from" type="hidden"/>
          <input id="to" type="hidden"/>
          <div id="cr-zoom-wrap" style="max-width:190px;min-width:150px"></div>
        </div>
        <div id="g" style="margin-top:12px"></div>
      </div>
    `;

    if(safeOn()){
      const body = renderSafeList(works, "renderWorks");
      await layout(body, {title: "Гантт • Работы", motto: "Путь виден. Но сейчас — безопасный режим."});
      const b = document.getElementById("btnSafeOff");
      if(b) b.onclick = ()=>{ try{ AsgardSafeMode.disable(); }catch(_){} location.reload(); };
      return;
    }

await layout(body,{title:"Гантт • Работы", motto:"Клятва дана — доведи дело до конца."});

    // Create CRSelect filters
    const crFltWrap = document.getElementById('cr-flt-wrap');
    if(crFltWrap) crFltWrap.appendChild(CRSelect.create({
      id: 'g-flt',
      options: [
        { value: 'active', label: 'Активные' },
        { value: 'all', label: 'Все' },
        { value: 'done', label: 'Только завершённые' }
      ],
      value: 'active',
      onChange: () => apply()
    }));

    const pmOpts = isDir
      ? [{value:'all',label:'РП: все'}, ...pmUsers.map(u=>({value:String(u.id),label:u.name||u.login}))]
      : [{value:String(user.id),label:'РП: '+(user.name||user.login)}];
    const crPmWrap = document.getElementById('cr-pm-wrap');
    if(crPmWrap) crPmWrap.appendChild(CRSelect.create({
      id: 'g-pm',
      options: pmOpts,
      value: isDir ? 'all' : String(user.id),
      onChange: () => apply()
    }));

    const workStatuses = Array.isArray(refs.work_statuses) ? refs.work_statuses : [...new Set(works.map(w=>w.work_status).filter(Boolean))];
    const crStWrap = document.getElementById('cr-st-wrap');
    if(crStWrap) crStWrap.appendChild(CRSelect.create({
      id: 'g-st',
      options: [{value:'all',label:'Статус: все'}, ...workStatuses.map(s=>({value:String(s),label:String(s)}))],
      value: 'all',
      onChange: () => apply()
    }));

    const crPerWrap = document.getElementById('cr-per-wrap');
    if(crPerWrap) crPerWrap.appendChild(CRSelect.create({
      id: 'g-per',
      options: [
        { value: 'custom', label: 'Период: вручную' },
        { value: 'month', label: 'Текущий месяц' },
        { value: 'year', label: 'Текущий год' },
        { value: 'last12', label: 'Последние 12 месяцев' },
        { value: 'all', label: 'Всё время' }
      ],
      value: 'custom',
      onChange: (v) => { setPreset(v); apply(); }
    }));

    const crZoomWrap = document.getElementById('cr-zoom-wrap');
    if(crZoomWrap) crZoomWrap.appendChild(CRSelect.create({
      id: 'g-zoom',
      options: [
        { value: '12', label: 'Масштаб: 12 нед' },
        { value: '26', label: '26 нед' },
        { value: '52', label: '52 нед' },
        { value: '104', label: '104 нед' }
      ],
      value: '52',
      onChange: () => apply()
    }));

    const fromInp = $("#from");
    const toInp = $("#to");

    function apply(){
      const q=norm($("#q").value);
      const flt=CRSelect.getValue('g-flt')||'active';
      const pmV=CRSelect.getValue('g-pm')||'all';
      const stV=CRSelect.getValue('g-st')||'all';
      const perV=CRSelect.getValue('g-per')||'custom';
      const fromV=fromInp.value;
      const toV=toInp.value;
      const zoomW=Number(CRSelect.getValue('g-zoom')||'52')||52;

      let items=[...works];
      if(q) items=items.filter(w=> norm(w.customer_name).includes(q) || norm(w.work_title).includes(q));
      if(pmV && pmV!=="all") items = items.filter(w=> String(w.pm_id||"") === String(pmV));
      if(stV && stV!=="all") items = items.filter(w=> String(w.work_status||"") === String(stV));

      const doneSet=new Set(["Работы сдали","Подписание акта"]);
      if(flt==="active") items=items.filter(w=> !doneSet.has(w.work_status));
      if(flt==="done") items=items.filter(w=> doneSet.has(w.work_status));

      let windowFrom = null, windowTo = null;
      if(perV==="all"){
        windowFrom = null; windowTo = null;
      }else{
        if(fromV) windowFrom = fromV;
        if(toV) windowTo = toV;
      }
      if(windowFrom || windowTo){
        const f = windowFrom || windowTo;
        const t = windowTo || windowFrom;
        items = items.filter(w=>{
          const st = w.start_in_work_date || w.end_plan || w.end_fact || f;
          const en = w.end_fact || w.end_plan || w.start_in_work_date || f;
          return overlap(st, en, f, t);
        });
      }

      const baseStart = (windowFrom || (core.gantt_start_iso ? core.gantt_start_iso.slice(0,10) : "2026-01-01"));
      const startIso = isoDate(startOfWeek(parseDate(baseStart) || new Date("2026-01-01")));
      let weeks = zoomW;
      if(windowFrom && windowTo){
        const w = calcWeeks(windowFrom, windowTo);
        if(w) weeks = w;
      }
      weeks = clamp(weeks, 4, 104);

      const rows = items.map(w=>{
        const st = w.start_in_work_date || w.end_plan || startIso;
        const en = w.end_fact || w.end_plan || w.start_in_work_date || startIso;
        return {
          id: w.id,
          label: `${w.customer_name||""} — ${w.work_title||""}`,
          sub: w.work_status || "",
          start: st,
          end: en,
          kind: "work",
          status: w.work_status || ""
        };
      });

      const statusColors = core.status_colors?.work || {};
      const html = AsgardGantt.renderBoard({
        startIso,
        weeks,
        rows,
        getColor: (r)=> statusColors[r.status] || "var(--err-t)"
      });
      $("#g").innerHTML=html;

      $$("#g [data-gitem]").forEach(el=>{
        el.addEventListener("click", ()=>{
          const id=Number(el.getAttribute("data-gitem"));
          location.hash = "#/pm-works?open="+encodeURIComponent(String(id));
        });
      });
    }

    function setPreset(v){
      const now=new Date(); now.setHours(0,0,0,0);
      if(v==="month"){
        const a=new Date(now.getFullYear(), now.getMonth(), 1);
        const b=new Date(now.getFullYear(), now.getMonth()+1, 0);
        fromInp.value = isoDate(a);
        toInp.value = isoDate(b);
      }else if(v==="year"){
        const a=new Date(now.getFullYear(), 0, 1);
        const b=new Date(now.getFullYear(), 11, 31);
        fromInp.value = isoDate(a);
        toInp.value = isoDate(b);
      }else if(v==="last12"){
        const a=new Date(now.getFullYear(), now.getMonth()-11, 1);
        const b=new Date(now.getFullYear(), now.getMonth()+1, 0);
        fromInp.value = isoDate(a);
        toInp.value = isoDate(b);
      }else if(v==="all"){
        fromInp.value = "";
        toInp.value = "";
      }
    }

    $("#q").addEventListener("input", apply);
    // CRSelect onChange handlers already set above

    $("#fs").addEventListener("click", ()=>{
      AsgardUI.showModal("Гантт • Работы (полный экран)", `<div id="gfs" style="height:76vh; overflow:auto">${$("#g").innerHTML}</div>`);
      document.querySelector(".modal")?.classList.add("fullscreen");
      setTimeout(()=>{
        document.querySelectorAll("#gfs [data-gitem]").forEach(el=>{
          el.addEventListener("click", ()=>{
            const id=Number(el.getAttribute("data-gitem"));
            location.hash = "#/pm-works?open="+encodeURIComponent(String(id));
          });
        });
      }, 0);
    });

    initGanttNav(fromInp, toInp, apply);
  }

  /**
   * Доработка 6: Объединённый ГАНТ — работы + просчёты на одной шкале
   */
  async function renderCombined({layout}={}){
    const auth=await AsgardAuth.requireUser();
    const user=auth.user; const isDir=(user.role==="ADMIN"||isDirRole(user.role));
    const core=await getCoreSettings();

    const refsRec = await AsgardDB.get("settings","refs");
    const refs = refsRec ? JSON.parse(refsRec.value_json||"{}") : {};
    const pmUsers = (await AsgardDB.all("users")).filter(u=>u.role==="PM" || (Array.isArray(u.roles) && u.roles.includes("PM")));

    // Загружаем ОБА типа данных
    let tenders = (await AsgardDB.all("tenders")).filter(t => t.handoff_at);
    let works = await AsgardDB.all("works");
    if(!isDir){
      tenders = tenders.filter(t=>t.responsible_pm_id===user.id);
      works = works.filter(w=>w.pm_id===user.id);
    }

    const body = `
      <div class="card">
        <div class="row" style="justify-content:space-between; gap:10px; align-items:center">
          <div>
            <div class="kpi">
              <span class="dot" style="background:var(--info);border:2px dashed var(--info-t)"></span>
              <span class="dot" style="background:var(--ok-t);margin-left:4px"></span>
              Гантт — Единая шкала
            </div>
            <div class="help">
              <span style="display:inline-block;width:12px;height:12px;background:var(--info);border:2px dashed var(--info-t);border-radius:2px;vertical-align:middle"></span> Просчёты (тендеры)
              <span style="display:inline-block;width:12px;height:12px;background:var(--ok-t);border-radius:2px;vertical-align:middle;margin-left:12px"></span> Работы (контракты)
            </div>
          </div>
          <div class="row" style="gap:8px; flex-wrap:wrap">
            <button class="btn ghost" id="fs">Открыть на весь экран</button>
            <a class="btn ghost" style="padding:8px 12px" href="#/home">На главную</a>
          </div>
        </div>
        <hr class="hr"/>
        ${ganttNavHtml()}
        <div class="row" style="gap:10px; flex-wrap:wrap; align-items:end">
          <input id="q" placeholder="Поиск: заказчик / объект" style="max-width:360px"/>
          <div id="cr-typeFilter-wrap" style="max-width:200px;min-width:160px"></div>
          <div id="cr-flt-wrap" style="max-width:240px;min-width:180px"></div>
          <div id="cr-pm-wrap" style="max-width:240px;min-width:180px"></div>
          <div id="cr-per-wrap" style="max-width:220px;min-width:180px"></div>
          <input id="from" type="hidden"/>
          <input id="to" type="hidden"/>
          <div id="cr-zoom-wrap" style="max-width:190px;min-width:150px"></div>
        </div>
        <div id="g" style="margin-top:12px"></div>
      </div>
    `;

    if(safeOn()){
      const allItems = [...tenders.map(t=>({...t, _type:'tender'})), ...works.map(w=>({...w, _type:'work'}))];
      const safeBody = renderSafeList(allItems, "renderCombined");
      await layout(safeBody, {title: "Гантт — Единая шкала", motto: "Путь виден. Но сейчас — безопасный режим."});
      const b = document.getElementById("btnSafeOff");
      if(b) b.onclick = ()=>{ try{ AsgardSafeMode.disable(); }catch(_){} location.reload(); };
      return;
    }

    await layout(body,{title:"Гантт — Единая шкала", motto:"Просчёты и работы на одной карте. Путь ясен."});

    // Create CRSelect filters
    const crTypeWrap = document.getElementById('cr-typeFilter-wrap');
    if(crTypeWrap) crTypeWrap.appendChild(CRSelect.create({
      id: 'g-typeFilter',
      options: [
        { value: 'all', label: 'Тип: все' },
        { value: 'tender', label: 'Только просчёты' },
        { value: 'work', label: 'Только работы' }
      ],
      value: 'all',
      onChange: () => apply()
    }));

    const crFltWrap = document.getElementById('cr-flt-wrap');
    if(crFltWrap) crFltWrap.appendChild(CRSelect.create({
      id: 'g-flt',
      options: [
        { value: 'active', label: 'Активные' },
        { value: 'all', label: 'Все' },
        { value: 'done', label: 'Завершённые' }
      ],
      value: 'active',
      onChange: () => apply()
    }));

    const pmOpts = isDir
      ? [{value:'all',label:'РП: все'}, ...pmUsers.map(u=>({value:String(u.id),label:u.name||u.login}))]
      : [{value:String(user.id),label:'РП: '+(user.name||user.login)}];
    const crPmWrap = document.getElementById('cr-pm-wrap');
    if(crPmWrap) crPmWrap.appendChild(CRSelect.create({
      id: 'g-pm',
      options: pmOpts,
      value: isDir ? 'all' : String(user.id),
      onChange: () => apply()
    }));

    const crPerWrap = document.getElementById('cr-per-wrap');
    if(crPerWrap) crPerWrap.appendChild(CRSelect.create({
      id: 'g-per',
      options: [
        { value: 'custom', label: 'Период: вручную' },
        { value: 'month', label: 'Текущий месяц' },
        { value: 'year', label: 'Текущий год' },
        { value: 'last12', label: 'Последние 12 месяцев' },
        { value: 'all', label: 'Всё время' }
      ],
      value: 'custom',
      onChange: (v) => { setPreset(v); apply(); }
    }));

    const crZoomWrap = document.getElementById('cr-zoom-wrap');
    if(crZoomWrap) crZoomWrap.appendChild(CRSelect.create({
      id: 'g-zoom',
      options: [
        { value: '12', label: 'Масштаб: 12 нед' },
        { value: '26', label: '26 нед' },
        { value: '52', label: '52 нед' },
        { value: '104', label: '104 нед' }
      ],
      value: '52',
      onChange: () => apply()
    }));

    const fromInp = $("#from");
    const toInp = $("#to");

    function apply(){
      const q=norm($("#q").value);
      const typeF=CRSelect.getValue('g-typeFilter')||'all';
      const flt=CRSelect.getValue('g-flt')||'active';
      const pmV=CRSelect.getValue('g-pm')||'all';
      const perV=CRSelect.getValue('g-per')||'custom';
      const fromV=fromInp.value;
      const toV=toInp.value;
      const zoomW=Number(CRSelect.getValue('g-zoom')||'52')||52;

      // Объединяем данные с пометкой типа
      let items = [];

      // Добавляем тендеры
      if(typeF==="all" || typeF==="tender"){
        tenders.forEach(t=>{
          items.push({
            ...t,
            _type: 'tender',
            _label: `${t.customer_name||""} — ${t.tender_title||""}`,
            _status: t.tender_status || "",
            _start: t.work_start_plan || t.tender_deadline,
            _end: t.work_end_plan || t.tender_deadline,
            _pmId: t.responsible_pm_id
          });
        });
      }

      // Добавляем работы
      if(typeF==="all" || typeF==="work"){
        works.forEach(w=>{
          items.push({
            ...w,
            _type: 'work',
            _label: `${w.customer_name||""} — ${w.work_title||""}`,
            _status: w.work_status || "",
            _start: w.start_in_work_date || w.end_plan,
            _end: w.end_fact || w.end_plan || w.start_in_work_date,
            _pmId: w.pm_id
          });
        });
      }

      // Фильтры
      if(q) items=items.filter(it=> norm(it._label).includes(q));
      if(pmV && pmV!=="all") items = items.filter(it=> String(it._pmId||"") === String(pmV));

      const doneSetTender = new Set(["Проиграли", "Не подходит"]);
      const doneSetWork = new Set(["Работы сдали", "Подписание акта"]);
      if(flt==="active"){
        items=items.filter(it=>{
          if(it._type==='tender') return !doneSetTender.has(it._status);
          return !doneSetWork.has(it._status);
        });
      }
      if(flt==="done"){
        items=items.filter(it=>{
          if(it._type==='tender') return doneSetTender.has(it._status) || it._status==='Выиграли';
          return doneSetWork.has(it._status);
        });
      }

      let windowFrom = null, windowTo = null;
      if(perV!=="all"){
        if(fromV) windowFrom = fromV;
        if(toV) windowTo = toV;
      }
      if(windowFrom || windowTo){
        const f = windowFrom || windowTo;
        const t = windowTo || windowFrom;
        items = items.filter(it=>{
          const st = it._start || f;
          const en = it._end || it._start || f;
          return overlap(st, en, f, t);
        });
      }

      const baseStart = (windowFrom || (core.gantt_start_iso ? core.gantt_start_iso.slice(0,10) : "2026-01-01"));
      const startIso = isoDate(startOfWeek(parseDate(baseStart) || new Date("2026-01-01")));
      let weeks = zoomW;
      if(windowFrom && windowTo){
        const w = calcWeeks(windowFrom, windowTo);
        if(w) weeks = w;
      }
      weeks = clamp(weeks, 4, 104);

      // Формируем строки для Гантта
      const rows = items.map(it=>{
        const isTender = it._type === 'tender';
        return {
          id: it.id,
          label: it._label,
          sub: `${isTender ? '📋' : '🔧'} ${it._status}`,
          start: it._start || startIso,
          end: it._end || it._start || startIso,
          kind: it._type,
          status: it._status,
          _isTender: isTender
        };
      });

      // Сортировка: сначала по дате старта
      rows.sort((a,b)=>{
        const da = parseDate(a.start) || new Date('2099-01-01');
        const db = parseDate(b.start) || new Date('2099-01-01');
        return da - db;
      });

      const tenderColor = 'var(--info)';
      const workColor = 'var(--ok-t)';
      const tenderStatusColors = core.status_colors?.tender || {};
      const workStatusColors = core.status_colors?.work || {};

      const html = AsgardGantt.renderBoard({
        startIso,
        weeks,
        rows,
        getColor: (r)=>{
          if(r._isTender){
            return tenderStatusColors[r.status] || tenderColor;
          }
          return workStatusColors[r.status] || workColor;
        },
        getStyle: (r)=>{
          // Для тендеров — пунктирная граница
          if(r._isTender){
            return 'border: 2px dashed rgba(96,165,250,0.7);';
          }
          return '';
        }
      });
      $("#g").innerHTML=html;

      // Клики на элементы
      $$("#g [data-gitem]").forEach(el=>{
        el.addEventListener("click", ()=>{
          const id=Number(el.getAttribute("data-gitem"));
          const kind=el.getAttribute("data-gkind");
          if(kind==='tender'){
            location.hash = "#/pm-calcs?open="+encodeURIComponent(String(id));
          }else{
            location.hash = "#/pm-works?open="+encodeURIComponent(String(id));
          }
        });
      });
    }

    function setPreset(v){
      const now=new Date(); now.setHours(0,0,0,0);
      if(v==="month"){
        const a=new Date(now.getFullYear(), now.getMonth(), 1);
        const b=new Date(now.getFullYear(), now.getMonth()+1, 0);
        fromInp.value = isoDate(a);
        toInp.value = isoDate(b);
      }else if(v==="year"){
        const a=new Date(now.getFullYear(), 0, 1);
        const b=new Date(now.getFullYear(), 11, 31);
        fromInp.value = isoDate(a);
        toInp.value = isoDate(b);
      }else if(v==="last12"){
        const a=new Date(now.getFullYear(), now.getMonth()-11, 1);
        const b=new Date(now.getFullYear(), now.getMonth()+1, 0);
        fromInp.value = isoDate(a);
        toInp.value = isoDate(b);
      }else if(v==="all"){
        fromInp.value = "";
        toInp.value = "";
      }
    }

    $("#q").addEventListener("input", apply);
    // CRSelect onChange handlers already set above
    fromInp.addEventListener("change", ()=>{ CRSelect.setValue('g-per','custom'); apply(); });
    $("#fs").addEventListener("click", ()=>{
      AsgardUI.showModal("Гантт — Единая шкала (полный экран)", `<div id="gfs" style="height:76vh; overflow:auto">${$("#g").innerHTML}</div>`);
      document.querySelector(".modal")?.classList.add("fullscreen");
      setTimeout(()=>{
        document.querySelectorAll("#gfs [data-gitem]").forEach(el=>{
          el.addEventListener("click", ()=>{
            const id=Number(el.getAttribute("data-gitem"));
            const kind=el.getAttribute("data-gkind");
            if(kind==='tender'){
              location.hash = "#/pm-calcs?open="+encodeURIComponent(String(id));
            }else{
              location.hash = "#/pm-works?open="+encodeURIComponent(String(id));
            }
          });
        });
      }, 0);
    });

    initGanttNav(fromInp, toInp, apply);
  }

  return {renderCalcs, renderWorks, renderCombined};
})();
