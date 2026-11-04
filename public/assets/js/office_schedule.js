window.AsgardOfficeSchedulePage=(function(){
  const {$, $$, esc, toast, showModal, closeModal} = AsgardUI;
  const isDirRole = (r)=> (window.AsgardAuth&&AsgardAuth.isDirectorRole)?AsgardAuth.isDirectorRole(r):(String(r||"" )==="DIRECTOR"||String(r||"" ).startsWith("DIRECTOR_"));

  /* Статусы дня. «отп» — ОТПУСК: витрина из графика отпусков, руками не ставится. */
  const STATUS = [
    {code:"оф", label:"В офисе",             color:"var(--blue-l)"},
    {code:"уд", label:"Удалёнка",           color:"var(--cyan)"},
    {code:"об", label:"На объекте",         color:"var(--ok-t)"},
    {code:"бн", label:"На больничном",      color:"var(--err-t)"},
    {code:"сс", label:"За свой счёт",       color:"var(--amber)"},
    {code:"км", label:"Командировка",       color:"var(--purple)"},
    {code:"пг", label:"Встреча/переговоры", color:"var(--info-t)"},
    {code:"уч", label:"Учёба",              color:"var(--ok)"},
    {code:"ск", label:"Склад",              color:"var(--t2)"},
    {code:"вх", label:"Выходной",           color:"var(--t3)"},
    {code:"отп",label:"Отпуск",             color:"var(--gold)"},
    {code:"нп", label:"Не подтверждён",     color:"var(--err-t)"},
  ];

  const VAC_CODE = "отп";
  /* «нп» — машинный статус «не подтверждён»: ставит система, когда снят ложный
     «оф» (не было прохода СКУД). В ручном выборе его нет — как «отп». */
  const DISPUTE_CODE = "нп";
  /* В селекторе статуса отпуска НЕТ — он приходит только из графика отпусков. */
  const PICKER_STATUS = STATUS.filter(s=>s.code!==VAC_CODE && s.code!==DISPUTE_CODE);

  const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

  const IC_CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2.5"/><path d="M3 9h18M8 2.5v3M16 2.5v3"/><path d="M7.5 13h2M11 13h2M14.5 13h2M7.5 17h2M11 17h2"/></svg>';

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
  function daysInMonth(year, month){ return new Date(year, month+1, 0).getDate(); }

  function fmtDM(iso){ const p=String(iso||'').slice(0,10).split('-'); return p.length===3?`${p[2]}.${p[1]}`:String(iso||''); }
  function fmtRange(a,b){ return `${fmtDM(a)}–${fmtDM(b)}`; }

  /* ── Авторизованный GET (график отпусков / производственный календарь) ── */
  async function apiGet(path){
    try{
      const t=localStorage.getItem('asgard_token')||'';
      const r=await fetch(path,{headers:{'Authorization':'Bearer '+t}});
      if(!r.ok) return null;
      return await r.json();
    }catch(e){
      console.warn('[office_schedule] apiGet failed', path, e);
      return null;
    }
  }

  /* Авторизованный запрос с телом (PUT/POST/DELETE) — импорт, привязка ФИО, правка часов. */
  async function apiSend(path, method, body){
    const t=localStorage.getItem('asgard_token')||'';
    const opt={ method, headers:{'Authorization':'Bearer '+t} };
    if(body instanceof FormData){ opt.body=body; }
    else if(body!==undefined){ opt.headers['Content-Type']='application/json'; opt.body=JSON.stringify(body); }
    const r=await fetch(path, opt);
    let j=null;
    try{ j=await r.json(); }catch(_){}
    if(!r.ok){
      const err=new Error((j&&(j.message||j.error))||('HTTP '+r.status));
      err.code=(j&&j.error)||'http_'+r.status;
      err.payload=j;
      throw err;
    }
    return j;
  }

  /* Часы: 475 → «7:55». */
  function hm(min){
    const m=Math.max(0, Math.round(Number(min)||0));
    return `${Math.floor(m/60)}:${String(m%60).padStart(2,'0')}`;
  }
  /* Часы с десятыми: 475 → 7.9 */
  function hh(min){ return Math.round((Number(min)||0)/6)/10; }

  /* Производственный календарь: iso → {is_working, kind, title}. */
  let calMap = new Map();
  /* Отпуска года: `${employee_id}|${iso}` → {status, date_from, date_to, days, fio}. */
  let vacMap = new Map();
  let loadedYear = null;

  async function loadYearData(year){
    if(loadedYear === year) return;
    const [cal, vac] = await Promise.all([
      apiGet(`/api/vacations/calendar?year=${year}`),
      apiGet(`/api/vacations/office?year=${year}`),
    ]);
    const cm = new Map();
    ((cal && cal.days) || []).forEach(d=>{
      if(!d || !d.date) return;
      cm.set(String(d.date).slice(0,10), {is_working: d.is_working !== false, kind: d.kind || '', title: d.title || ''});
    });
    const vm = new Map();
    ((vac && vac.vacations) || []).forEach(v=>{
      if(!v || !v.date_from || !v.date_to) return;
      const emp = Number(v.employee_id);
      if(!emp) return;
      const from = Date.parse(String(v.date_from).slice(0,10)+'T00:00:00Z');
      const to   = Date.parse(String(v.date_to).slice(0,10)+'T00:00:00Z');
      if(Number.isNaN(from) || Number.isNaN(to)) return;
      for(let t=from; t<=to; t+=86400000){
        const d = new Date(t);
        const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
        vm.set(`${emp}|${iso}`, {status: v.status, date_from: v.date_from, date_to: v.date_to, days: v.days, fio: v.fio});
      }
    });
    calMap = cm;
    vacMap = vm;
    loadedYear = year;
  }

  /* Нерабочий день: из производственного календаря, с фолбэком на сб/вс. */
  function isNonWorking(dateObj, iso){
    const c = calMap.get(iso);
    if(c) return !c.is_working;
    const gd = dateObj.getDay();
    return (gd === 0 || gd === 6);
  }
  function dayInfo(iso){ return calMap.get(iso) || null; }

  async function getColors(){
    const s = await AsgardDB.get("settings","app");
    let cfg = {};
    try{ cfg = s ? JSON.parse(s.value_json||"{}") : {}; }catch(e){}
    const custom = (cfg.status_colors && cfg.status_colors.office) ? cfg.status_colors.office : {};
    const colors = {};
    STATUS.forEach(st => { colors[st.code] = custom[st.code] || st.color; });
    return colors;
  }

  function isSkippedOfficeUser(u){
    if(!u || !u.is_active) return true;
    if(u.role === 'BOT' || u.role === 'ADMIN' || u.role === 'FIELD_WORKER') return true;
    const login = String(u.login || '');
    if(login.startsWith('test_') || login === 'mimir_bot') return true;
    const name = String(u.name || '').trim();
    if(name.startsWith('Test ') || name.startsWith('Тест ')) return true;
    return false;
  }

  async function loadDisplayStaff(){
    const staff = await AsgardDB.all("staff") || [];
    const users = await AsgardDB.all("users") || [];
    const skipUserIds = new Set(users.filter(isSkippedOfficeUser).map(u => u.id));
    return staff.filter(s => {
      if(s.user_id && skipUserIds.has(s.user_id)) return false;
      const nm = String(s.name || '').trim();
      if(nm.startsWith('Test ') || nm.startsWith('Тест ')) return false;
      return true;
    });
  }

  async function ensureStaffSeed(){
    const staff = await AsgardDB.all("staff") || [];
    const users = await AsgardDB.all("users") || [];
    // Получаем user_id уже существующих записей в staff
    const existingUserIds = new Set(staff.map(s => s.user_id));

    // Добавляем всех активных пользователей, которых нет в staff
    for(const u of users){
      if(isSkippedOfficeUser(u)) continue;
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
      const d = ymd(p.date); // Нормализуем дату из API
      if(d < start || d > end) return;
      m.set(`${p.staff_id}|${d}`, {code: p.status_code||"", kind: p.kind||null});
    });
    return m;
  }

  function legendHtml(colors){
    const items = STATUS.map(s=>{
      const base = safeBaseColor(colors[s.code] || s.color);
      const vac = s.code===VAC_CODE ? ' sched-legend-item--vac' : '';
      return `<span class="sched-legend-item${vac}">
        <span class="sched-legend-box" style="background:${esc(base)}"></span>
        <span class="sched-legend-l">${esc(s.label)}</span>
      </span>`;
    }).join("");
    const hol = `<span class="sched-legend-item sched-legend-item--hol">
        <span class="sched-legend-box sched-legend-box--hol"></span>
        <span class="sched-legend-l">Праздник РФ</span>
      </span>`;
    const hint = `<span class="sched-legend-hint">«ОТП» — отпуск из графика отпусков; пунктирная рамка — период ждёт согласования директора</span>`;
    return `<div class="sched-legend">${items}${hol}${hint}</div>`;
  }

  async function openPicker({staffId, staffName, dateIso, currentCode, colors}){
    return new Promise(resolve=>{
      const schedOpts = PICKER_STATUS.map(s=>({ value: s.code, label: s.label }));
      const html = `
        <div class="stack" style="gap:12px">
          <div class="muted">Сотрудник: <b>${esc(staffName||"")}</b></div>
          <div class="muted">Дата: <b>${AsgardUI.formatDate(dateIso)}</b></div>
          <div>
            <label for="schedPick">Статус</label>
            <div id="crw_schedPick"></div>
          </div>
          <div class="row" style="gap:10px;justify-content:flex-end;margin-top:10px">
            <button class="btn ghost" data-act="clear">Очистить</button>
            <button class="btn ghost" data-act="cancel">Отмена</button>
            <button class="btn primary" data-act="save">Сохранить</button>
          </div>
        </div>`;
      showModal({title:"Статус дня", html, wide:false, onMount:()=>{
        $("#crw_schedPick")?.appendChild(CRSelect.create({
          id:'schedPick', fullWidth:true, value:currentCode||'',
          options: schedOpts, dropdownClass:'z-modal'
        }));
        $$("[data-act]").forEach(b=>b.addEventListener("click", async ()=>{
          const act=b.dataset.act;
          if(act==="cancel"){ closeModal(); resolve(null); return; }
          if(act==="clear"){ closeModal(); resolve(""); return; }
          const code=CRSelect.getValue("schedPick")||"";
          closeModal();
          resolve(code);
        }));
      }});
    });
  }

  async function upsertPlan(staffId, dateIso, code){
    /* Отпуск в графике офиса поставить нельзя — он приходит из графика отпусков. */
    if(code === VAC_CODE) return;
    const all = await AsgardDB.all("staff_plan");
    // Нормализуем дату: API возвращает "2026-02-11T00:00:00.000Z", а dateIso = "2026-02-11"
    const existing = (all||[]).find(p=>p.staff_id===staffId && ymd(p.date)===dateIso);
    // Ошибки НЕ глотаем: «оф» без прохода СКУД приходит как 409, и вызывающий
    // код должен показать понятное сообщение, а не «Сохранено».
    if(existing){
      if(code){
        await AsgardDB.put("staff_plan", Object.assign({}, existing, {status_code:code, updated_at:new Date().toISOString()}));
        return;
      }
      await AsgardDB.del("staff_plan", existing.id);
      return;
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

    const staff = await loadDisplayStaff();
    const staffSorted = (staff||[]).sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""), 'ru'));
    const staffIds = staffSorted.map(s=>s.id);
    const colors = await getColors();

    /* Данные часов за месяц (дашборд + часы в ячейках + метки вопросов). */
    let monthData = null;
    async function loadMonthData(){
      const j = await apiGet(`/api/office-attendance/month?year=${viewYear}&month=${viewMonth+1}`);
      if(!j || !j.ok){ monthData = null; return; }
      const byStaff = new Map();
      (j.people||[]).forEach(p=>byStaff.set(p.staff_id, p));
      const flagMap = new Map();
      (j.people||[]).forEach(p=>{ if(p.flags && p.flags.open) flagMap.set(p.staff_id, p.flags.open); });
      monthData = { raw: j, byStaff, flagMap };
    }

    /* Дашборд: месяц и неделя. Показываем то, что просил заказчик:
       «за месяц отработано в офисе столько-то, за неделю столько-то». */
    function buildDashHtml(md){
      if(!md || !md.raw) {
        return `<div class="sched-dash__empty">Нет данных учёта часов за этот месяц. Загрузите отчёт СКУД или откройте октябрь (там уже есть проходы).</div>`;
      }
      const c = md.raw.company || {};
      const w = md.raw.week || {};
      const since = md.raw.settings && md.raw.settings.crm_activity_since;
      const deltaCls = (d)=> (d>=0 ? 'ok' : 'bad');
      const card = (cap, val, sub, cls, act)=>`
        <div class="sched-dash__card ${cls||''} ${act?'is-click':''}" ${act?`data-dash-act="${act}"`:''}>
          <div class="sched-dash__cap">${esc(cap)}</div>
          <div class="sched-dash__val">${val}</div>
          ${sub?`<div class="sched-dash__sub">${esc(sub)}</div>`:''}
        </div>`;
      const mon = c.office_hours||0, monCrm = c.crm_hours||0, monNorm = c.norm_hours||0, monDelta = c.delta_hours||0;
      const wek = w.office_hours||0, wekCrm = w.crm_hours||0, wekNorm = w.norm_hours||0, wekDelta = w.delta_hours||0;
      const deltaSign = (v)=> (v>=0? '+':'') + v.toFixed(1);
      const noSkudHint = mon <= 0
        ? `нет отчёта СКУД за ${MONTHS_RU[viewMonth].toLowerCase()}`
        : `по СКУД за ${MONTHS_RU[viewMonth].toLowerCase()}`;
      const crmHint = since
        ? `учёт с ${fmtDM(since)}`
        : (monCrm <= 0 ? 'учёт СРМ только с выкатки (историю не восстановить)' : 'удалёнка и объекты');
      const normHint = monNorm <= 0
        ? 'норма 0: дни «оф» без СКУД и «уд» без СРМ пока не входят в зачёт'
        : `${deltaSign(monDelta)} ч к норме`;
      return `
        ${card('В офисе · месяц', `${mon.toFixed(1)}<small>ч</small>`, noSkudHint)}
        ${card('В СРМ · месяц', `${monCrm.toFixed(1)}<small>ч</small>`, crmHint)}
        ${card('Зачёт · месяц', `${(c.credited_hours||0).toFixed(1)}<small>из ${monNorm.toFixed(0)} ч</small>`,
          normHint, monNorm>0 ? deltaCls(monDelta) : 'warn')}
        ${card('В офисе · неделя', `${wek.toFixed(1)}<small>ч</small>`,
          w.from ? `${fmtDM(w.from)}–${fmtDM(w.to)}` : '')}
        ${card('СРМ · неделя', `${wekCrm.toFixed(1)}<small>ч</small>`, '')}
        ${card('Зачёт · неделя', `${(w.credited_hours||0).toFixed(1)}<small>из ${wekNorm.toFixed(0)} ч</small>`,
          `${deltaSign(wekDelta)} ч к норме`, deltaCls(wekDelta))}
        ${card('Снято «оф»', `${c.flags_total||0}`, (c.flags_open? `${c.flags_open} без ответа` : 'все ответили'),
          (c.flags_open? 'warn':''), 'flags')}
      `;
    }

    async function renderGrid(){
      await loadYearData(viewYear);
      await loadMonthData();
      const numDays = daysInMonth(viewYear, viewMonth);
      const startDate = new Date(viewYear, viewMonth, 1);
      const endDate = new Date(viewYear, viewMonth, numDays);
      const planMap = await loadPlanForMonth(staffIds, startDate, endDate);
      const todayIso = ymd(now);

      // Шапка дней (праздники и переносы — из производственного календаря)
      const days=[];
      for(let d=1; d<=numDays; d++){
        const dt = new Date(viewYear, viewMonth, d);
        const iso = ymd(dt);
        const info = dayInfo(iso);
        const nonWorking = isNonWorking(dt, iso);
        const isToday = iso === todayIso;
        const cls = ['sched-day'];
        if(info && info.kind === 'holiday') cls.push('holiday');
        else if(info && info.kind === 'shift') cls.push('shift');
        else if(nonWorking) cls.push('weekend');
        if(isToday) cls.push('today');
        // Тултип: отдельно праздник РФ, отдельно перенос и обычный выходной.
        let ttl = `${d} ${MONTHS_RU[viewMonth]} · ${['вс','пн','вт','ср','чт','пт','сб'][dt.getDay()]}`;
        if(info && info.kind === 'holiday') ttl += ` · Праздник РФ: ${info.title || 'нерабочий день'}`;
        else if(info && info.kind === 'shift') ttl += ` · Перенос выходного: ${info.title || 'нерабочий день'}`;
        else if(nonWorking) ttl += ' · выходной';
        if(isToday) ttl += ' · сегодня';
        days.push(`<div class="${cls.join(' ')}" title="${esc(ttl)}">${d}</div>`);
      }

      // Строки сотрудников
      const bodyRows = staffSorted.map(s=>{
        const editable = (s.user_id===user.id) || user.role==="OFFICE_MANAGER" || (!officeStrictOwn && (user.role==="ADMIN" || isDirRole(user.role)));
        const cells=[];
        const personMonth = monthData ? (monthData.byStaff.get(s.id) || null) : null;
        for(let d=1; d<=numDays; d++){
          const dt = new Date(viewYear, viewMonth, d);
          const iso = ymd(dt);
          const nonWorking = isNonWorking(dt, iso);
          const info = dayInfo(iso);
          const isToday = iso === todayIso;
          const key = `${s.id}|${iso}`;
          const rec = planMap.get(key) || null;

          // Отпуск (витрина из графика отпусков) — ячейка только для показа
          const vac = vacMap.get(key) || (rec && rec.code === VAC_CODE
            ? {status: rec.kind === 'vacation_pending' ? 'pending' : 'approved', note:true}
            : null);
          if(vac){
            const pend = vac.status === 'pending';
            const ttl = vac.note
              ? `${s.name||''} · отпуск (из графика офиса)`
              : `${s.name||''} · отпуск ${fmtRange(vac.date_from, vac.date_to)} · ${vac.days} дн.${pend?' · ждёт согласования':''}`;
            cells.push(`<button class="sched-cell vac${pend?' vac-pending':''}"
              type="button"
              data-vac="1"
              data-date="${esc(iso)}"
              data-staff="${s.id}"
              title="${esc(ttl)}"
              aria-label="${esc(ttl)}"><span class="sched-vtag">ОТП</span></button>`);
            continue;
          }

          let code = (rec && rec.code) || "";
          // По умолчанию нерабочие дни = "вх"
          if(!code && nonWorking) code = "вх";

          const color = code ? (colors[code] || "var(--t2)") : "";
          const base = code ? safeBaseColor(color) : "";
          const bgStyle = code ? `background:${toRGBA(base, 0.5)};` : "";
          const cellCls = ['sched-cell'];
          if(nonWorking) cellCls.push('weekend');
          if(isToday) cellCls.push('today');
          if(code) cellCls.push('has-status');
          const ttl = (info && info.title) ? `${iso} · ${info.title}` : iso;

          // Часы и предупреждения из office_hours_daily (V453).
          // Показываем ФАКТ (СКУД/СРМ), даже если день не зачтён в норму
          // (нет отчёта СКУД за ноябрь, учёт СРМ только с выкатки и т.п.).
          // Раньше условие `credited_minutes` прятало все цифры — на ноябре
          // ячейки выглядели пустыми при живых минутах.
          const dd = personMonth ? personMonth.days.find(x=>x.date===iso) : null;
          // Факт в ячейке — максимум из офиса/СРМ/зачёта. Источник «какой
          // именно» для стиля: СРМ, если статус удалённый/объектный.
          const factMin = dd
            ? Math.max(
                Number(dd.office_minutes || 0),
                Number(dd.crm_minutes || 0),
                Number(dd.credited_minutes || 0)
              )
            : 0;
          const credited = dd ? Number(dd.credited_minutes || 0) : 0;
          const hoursTxt = factMin > 0 ? hm(factMin) : '';
          const hoursMuted = hoursTxt && credited <= 0;
          const isCrmStyle = dd && (
            dd.source === 'crm' || dd.source === 'crm_no_status'
            || ['уд','об','км','пг','уч','ск'].includes(String(dd.status||''))
          );
          const warnMark = dd && dd.warn === 'no_punches' ? '!'
            : (dd && (dd.warn === 'skud_missing' || dd.source === 'skud_missing') ? '?'
              : (dd && (dd.warn === 'no_crm_data' || dd.source === 'no_crm_data') ? '·' : ''));
          if(dd && dd.source==='unconfirmed') cellCls.push('is-dispute');
          if(dd && (dd.source==='no_crm_data' || dd.source==='skud_missing' || dd.source==='no_data' || dd.warn==='skud_missing')) {
            cellCls.push('is-nodata');
          }

          cells.push(`<button class="${cellCls.join(' ')}"
            style="${bgStyle}"
            data-date="${esc(iso)}"
            data-staff="${s.id}"
            data-code="${esc(code||"")}"
            ${editable ? '' : "data-locked='1'"}
            title="${esc(ttl)}"
            type="button">${
              hoursTxt ? `<span class="sched-hours${isCrmStyle ? ' is-crm' : ''}${hoursMuted ? ' is-muted' : ''}">${esc(hoursTxt)}</span>` : ''
            }${
              warnMark ? `<span class="sched-warn${warnMark==='!' ? ' is-bad' : ''}">${warnMark}</span>` : ''
            }</button>`);
        }
        const badge = (s.user_id===user.id) ? ` <span class="badge blue sched-you">вы</span>` : "";
        const flags = monthData ? (monthData.flagMap.get(s.id) || 0) : 0;
        const flagMark = flags ? `<span class="sched-flagmark" title="Есть неотвеченные вопросы «где ты был»: ${flags}">${flags}</span>` : "";
        // Клик по имени сотрудника открывает его отчёт за месяц: директору
        // нужен обзор по человеку, а тыкать в мелкие ячейки неудобно.
        return `<div class="sched-row">
          <div class="sched-name" data-person="${s.id}" title="Открыть отчёт: ${esc(s.name||"")}">
            <span class="sched-name__txt">${esc(s.name||"")}</span>${badge}${flagMark}
          </div>
          <div class="sched-cells">${cells.join("")}</div>
        </div>`;
      }).join("");

      return { days, bodyRows, planMap, dash: buildDashHtml(monthData) };
    }

    const initialGrid = await renderGrid();

    const html = `
      <div class="page-head">
        <h1>${esc(title||"График офиса")}</h1>
        <div class="motto">Порядок в строю — ясность в делах.</div>
      </div>

      <div class="card sched-hero">
        <div class="sched-hero__ic">${IC_CAL}</div>
        <div class="sched-hero__tx">
          <div class="sched-period" id="schedPeriod">${MONTHS_RU[viewMonth]} ${viewYear}</div>
          <div class="sched-hero__s">Отпуска приходят из «Графика отпусков» (ячейка «ОТП»), праздники и переносы — из производственного календаря РФ.</div>
        </div>
        <div class="sched-hero__nav">
          <button class="btn ghost" id="btnPrevMonth" type="button">← Назад</button>
          <button class="btn ghost" id="btnNextMonth" type="button">Вперёд →</button>
          <button class="btn gold" id="btnVacSchedule" type="button">${IC_CAL}<span>График отпусков</span></button>
        </div>
      </div>

      <div class="card sched-legend-card">
        ${legendHtml(colors)}
      </div>

      <div class="card sched-hero" style="margin-bottom:10px;display:block">
        <div class="sched-dash" id="schedDash">${initialGrid.dash || ''}</div>
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

    // График отпусков открывает родительский роут (полноэкранная модалка)
    const btnVac = $("#btnVacSchedule");
    if(btnVac) btnVac.addEventListener("click", ()=>{ location.hash = '#/vacation-schedule'; });

    async function updateGrid(){
      try {
        $("#schedPeriod").textContent = `${MONTHS_RU[viewMonth]} ${viewYear}`;
        const grid = await renderGrid();
        $("#schedDays").innerHTML = grid.days.join("");
        $("#schedBody").innerHTML = grid.bodyRows;
        const dashEl = $("#schedDash");
        if(dashEl) dashEl.innerHTML = grid.dash || '';
        planMap = grid.planMap;
        bindCellClicks();
        bindPersonClicks();
        bindDashClicks();
      } catch(e) { console.error('[office_schedule] updateGrid error:', e); }
    }

    /* Клик по карточке дашборда «Снято оф» → список флагов за месяц. */
    function bindDashClicks(){
      $$("[data-dash-act]").forEach(el=>{
        el.addEventListener("click", async ()=>{
          if(el.dataset.dashAct === 'flags') await openFlagsModal();
        });
      });
    }

    function bindCellClicks(){
      $$(".sched-cell").forEach(btn=>{
        btn.addEventListener("click", async (ev)=>{
          if(btn.dataset.vac==="1"){
            toast("Отпуск","День в отпуске — ставится только в «Графике отпусков»","warn");
            return;
          }
          const staffId = Number(btn.dataset.staff||0);
          const dateIso = btn.dataset.date;
          const staffObj = staffSorted.find(s=>s.id===staffId);
          const currentCode = btn.dataset.code||"";

          // Смена статуса — только там, где это разрешено. Карточка дня
          // (часы, проходы, сессии СРМ) доступна всем: сотрудник должен видеть
          // свой день целиком.
          // Shift+клик или клик по чужой строке → карточка дня без смены статуса.
          // window.event НЕ используем: в современных браузерах он undefined,
          // и Shift-клик молча не срабатывал (поймано Playwright-прогоном).
          const shift = !!(ev && ev.shiftKey);
          if(btn.dataset.locked==="1" || shift){
            await openDayModal(staffId, dateIso, staffObj?.name||"");
            return;
          }

          const code = await openPicker({staffId, staffName: staffObj?.name||"", dateIso, currentCode, colors});
          if(code===null) return;

          try{
            await upsertPlan(staffId, dateIso, code);
          }catch(e){
            if(e && e.code === 'office_not_confirmed'){
              toast("Не подтверждено",
                "В этот день СКУД не зафиксировал вход — «в офисе» поставить нельзя. Выберите другой статус.",
                "err");
              return;
            }
            throw e;
          }

          const nonWorking = btn.classList.contains("weekend");
          const finalCode = code || (nonWorking ? "вх" : "");

          if(finalCode){
            const def = (STATUS.find(s=>s.code===finalCode)||{}).color || "var(--t2)";
            const raw = (colors && colors[finalCode]) ? colors[finalCode] : def;
            const base = safeBaseColor(raw);
            btn.style.background = toRGBA(base, 0.5);
            btn.dataset.code = finalCode;
            btn.classList.add('has-status');
          } else {
            btn.style.background = "";
            btn.dataset.code = "";
            btn.classList.remove('has-status');
          }
          toast("Сохранено", `${dateIso}: ${(STATUS.find(s=>s.code===finalCode)||{}).label || "—"}`, "ok");
          // Пересчитываем ячейку и дашборд: часы зависят от статуса.
          await updateGrid();
        });
        btn.addEventListener('contextmenu', async (e)=>{
          e.preventDefault();
          const staffId = Number(btn.dataset.staff||0);
          const staffObj = staffSorted.find(s=>s.id===staffId);
          await openDayModal(staffId, btn.dataset.date, staffObj?.name||"");
        });
      });
    }

    /* Клик по имени сотрудника → отчёт по человеку за месяц. */
    function bindPersonClicks(){
      $$("[data-person]").forEach(el=>{
        el.addEventListener("click", async ()=>{
          const staffId = Number(el.dataset.person||0);
          if(!staffId) return;
          const staffObj = staffSorted.find(s=>s.id===staffId);
          await openPersonModal(staffId, staffObj?.name||"");
        });
      });
    }

    /**
     * Отчёт по сотруднику за просматриваемый месяц: по дням часы офиса,
     * часы СРМ, норма и зачёт; итоги месяца. Источник — GET /me?staff_id.
     */
    async function openPersonModal(staffId, staffName){
      const fromIso = ymd(new Date(viewYear, viewMonth, 1));
      const toIso = ymd(new Date(viewYear, viewMonth, daysInMonth(viewYear, viewMonth)));
      showModal({title:`Отчёт: ${staffName}`, html:`<div class="muted">Загружаем…</div>`, wide:true, onMount: async (ctx)=>{
        const host = (ctx && ctx.body) || null;
        if(!host) return;
        const j = await apiGet(`/api/office-attendance/me?from=${fromIso}&to=${toIso}&staff_id=${staffId}`);
        if(!j || !j.ok){ host.innerHTML = '<div class="muted">Не удалось загрузить отчёт</div>'; return; }

        const mon = j.month || j.summary || {};
        const dH = Math.floor(Math.abs(mon.delta_minutes||0)/60);
        const dM = Math.abs(mon.delta_minutes||0)%60;
        const deltaTxt = (mon.delta_minutes||0) >= 0
          ? 'норма выполнена'
          : `недоработка ${dH} ч${dM? ' ' + dM + ' мин':''}`;

        const rows = (j.days||[]).map(d=>{
          const mark = d.source === 'unconfirmed' ? '⚠ ' :
                       d.source === 'no_data' ? '· ' : '';
          const label = STATUS.find(s=>s.code===d.status)?.label || (d.status || '—');
          return `<div class="sched-seg" style="display:grid;grid-template-columns:58px 1fr 62px 62px 58px;gap:6px">
            <span class="sched-seg__m">${fmtDM(d.date)}</span>
            <span>${mark}${esc(label)}</span>
            <span title="в офисе по СКУД">${esc(d.office_text)}</span>
            <span title="в СРМ">${esc(d.crm_text)}</span>
            <span class="sched-seg__m" title="зачёт из нормы">${esc(d.credited_text)}</span>
          </div>`;
        }).join('') || '<div class="muted">Нет дней</div>';

        host.innerHTML = `
          <div id="asgDayModalBody">
            <div class="sched-dash" style="margin-bottom:10px">
              <div class="sched-dash__card"><div class="sched-dash__cap">В офисе</div><div class="sched-dash__val">${mon.office_hours||0}<small>ч</small></div></div>
              <div class="sched-dash__card"><div class="sched-dash__cap">В СРМ</div><div class="sched-dash__val">${mon.crm_hours||0}<small>ч</small></div></div>
              <div class="sched-dash__card ${(mon.delta_minutes||0)>=0?'ok':'bad'}">
                <div class="sched-dash__cap">Зачёт</div>
                <div class="sched-dash__val">${mon.credited_hours||0}<small>из ${mon.norm_hours||0} ч</small></div>
              </div>
            </div>
            <div class="muted" style="margin-bottom:8px">${esc(deltaTxt)}</div>
            <div class="muted" style="font-size:11px;margin-bottom:6px">
              Колонки: дата · статус · в офисе · в СРМ · зачёт
            </div>
            <div class="sched-seg-list" style="max-height:52vh">${rows}</div>
          </div>`;
      }});
    }

    async function openDayModal(staffId, dateIso, staffName){
      showModal({title:`День ${fmtDM(dateIso)}`, html:`<div class="muted">Загружаем…</div>`, wide:true, onMount: async (ctx)=>{
        // onMount отдаёт {back, modal, body} — ищем свои элементы ТОЛЬКО внутри
        // этой модалки. Поиск по document цепляет уходящую модалку (D-226).
        const host = (ctx && ctx.body) || null;
        if(!host) return;
        const j = await apiGet(`/api/office-attendance/day?staff_id=${staffId}&date=${dateIso}`);
        if(!j || !j.ok){
          host.innerHTML = `<div class="muted">Не удалось загрузить день</div>`;
          return;
        }
        const segs = (j.segments||[]).map(sg=>{
          const f = new Date(sg.from), t = new Date(sg.to);
          const fmt = (d)=>`${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
          return `<div class="sched-seg"><span>${fmt(f)}–${fmt(t)}</span><span class="sched-seg__m">${hm(sg.minutes)}</span></div>`;
        }).join('') || '<div class="muted">Проходов СКУД нет</div>';

        const punches = (j.punches||[]).map(p=>`<div class="sched-punch"><span>${esc(p.time)}</span><span class="sched-punch__dir ${p.direction==='вход'?'in':'out'}">${esc(p.direction)}</span><span>${esc(p.device||'')}</span></div>`).join('')
          || '<div class="muted">Нет событий</div>';

        const sessions = (j.crm && j.crm.sessions || []).map(s=>`<div class="sched-seg"><span>${esc(s.from)}–${esc(s.to)}</span><span class="sched-seg__m">${hm(s.minutes)}</span></div>`).join('')
          || '<div class="muted">Активности в СРМ нет</div>';

        const flag = (j.flags||[])[0];
        const flagHtml = flag
          ? `<div class="sched-dispute">
               <div class="sched-dispute__title">Отметка «в офисе» снята</div>
               <div class="sched-dispute__txt">СКУД не зафиксировал вход в этот день. ${flag.resolved_at ? `Сотрудник ответил: ${esc(flag.resolved_status||'—')}` : 'Сотрудник ещё не ответил.'}</div>
             </div>`
          : '';

        const creditLabel = {
          skud: 'часы СКУД', crm: 'часы СРМ', excluded: 'не входит в норму',
          dayoff: 'нерабочий день', unconfirmed: 'ждёт ответа', no_crm_data: 'нет данных СРМ',
          skud_no_status: 'часы СКУД (статуса нет)', none: '—', unknown_status: 'неизвестный статус',
          no_status: 'статуса нет', no_data: 'нет данных за день', skud_missing: 'нет отчёта СКУД'
        }[j.credit.source] || j.credit.source;

        host.innerHTML = `
          <div id="asgDayModalBody">
            ${flagHtml}
            <div class="muted" style="margin-bottom:6px">${esc(j.staff.name)} · ${esc(j.status||'без статуса')}</div>
            <dl class="sched-day-meta">
              <dt>Норма дня</dt><dd>${esc(j.norm_text)}</dd>
              <dt>В офисе (СКУД)</dt><dd>${esc(j.office_text)}${j.open_ended?' · вход без выхода':''}</dd>
              <dt>В СРМ</dt><dd>${esc(j.crm.text)}</dd>
              <dt>Зачёт</dt><dd>${esc(hm(j.credit.credited_minutes))} · ${esc(creditLabel)}</dd>
            </dl>
            <div class="muted" style="margin:10px 0 4px">Интервалы в офисе</div>
            <div class="sched-seg-list">${segs}</div>
            <div class="muted" style="margin:10px 0 4px">Проходы СКУД</div>
            <div class="sched-seg-list">${punches}</div>
            <div class="muted" style="margin:10px 0 4px">Сессии в СРМ</div>
            <div class="sched-seg-list">${sessions}</div>
          </div>`;
      }});
    }

    /* ── Список снятых «оф» за месяц ── */
    async function openFlagsModal(){
      showModal({title:`Снятые отметки «в офисе» · ${MONTHS_RU[viewMonth]} ${viewYear}`, html:`<div class="muted">Загружаем…</div>`, wide:true, onMount: async (ctx)=>{
        const host = (ctx && ctx.body) || null;
        if(!host) return;
        const j = await apiGet(`/api/office-attendance/flags?year=${viewYear}&month=${viewMonth+1}`);
        if(!j || !j.ok){ host.innerHTML = '<div class="muted">Не удалось загрузить</div>'; return; }
        if(!j.count){ host.innerHTML = '<div class="muted">В этом месяце ложных отметок нет.</div>'; return; }
        const rows = j.flags.map(f=>`
          <div class="sched-seg" style="align-items:flex-start;flex-direction:column;gap:2px">
            <div style="display:flex;justify-content:space-between;width:100%">
              <b>${esc(f.name||('#'+f.staff_id))}</b>
              <span class="sched-seg__m">${fmtDM(f.date)}</span>
            </div>
            <div class="muted" style="font-size:11px">
              ${f.resolved_at
                ? `Ответ: ${esc(f.resolved_status||'—')} · ${esc(String(f.resolved_at).slice(0,16).replace('T',' '))}`
                : 'Ответа нет — сотруднику задаётся вопрос при входе'}
            </div>
          </div>`).join('');
        host.innerHTML = `
          <div id="asgDayModalBody">
            <div class="muted" style="margin-bottom:8px">Всего ${j.count}, без ответа ${j.open_count}</div>
            <div class="sched-seg-list">${rows}</div>
          </div>`;
      }});
    }

    bindCellClicks();
    bindPersonClicks();
    bindDashClicks();
  }

  return { render };
})();
