window.AsgardGlobalTimesheetPage=(function(){
  const { $, $$, esc, toast, showModal, closeModal } = AsgardUI;
  const isDirRole = (r)=> (window.AsgardAuth&&AsgardAuth.isDirectorRole)?AsgardAuth.isDirectorRole(r):(String(r||"").startsWith("DIRECTOR"));
  const fmt = (n)=> n==null?'—': new Intl.NumberFormat('ru-RU').format(Math.round(n));

  const CELL_TYPES = {
    day:   { label:'Д', bg:'var(--ok-bg)',   color:'var(--ok-t)',   title:'Дневная смена' },
    night: { label:'Н', bg:'var(--info-bg)', color:'var(--info-t)', title:'Ночная смена' },
    travel:{ label:'🚗', bg:'var(--warn-bg)', color:'var(--warn-t)', title:'Дорога' },
    warehouse:{ label:'📦', bg:'var(--info-bg)', color:'var(--info-t)', title:'Склад' },
    medical:{ label:'🏥', bg:'var(--err-bg)', color:'var(--err-t)', title:'Медосмотр' },
    waiting:{ label:'⏳', bg:'var(--bg4)',    color:'var(--t2)',     title:'Ожидание' }
  };

  const EDIT_ROLES = {
    ADMIN:       Object.keys(CELL_TYPES),
    DIRECTOR_GEN:Object.keys(CELL_TYPES),
    DIRECTOR_COMM:Object.keys(CELL_TYPES),
    DIRECTOR_DEV:Object.keys(CELL_TYPES),
    TO:          ['medical'],
    HEAD_TO:     ['medical'],
    WAREHOUSE:   ['warehouse']
  };

  let _refreshTimer = null;

  async function render({layout, title}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }
    const user = auth.user;
    const token = auth.token;
    const ALLOWED = ["ADMIN","DIRECTOR_GEN","DIRECTOR_COMM","DIRECTOR_DEV","TO","HEAD_TO","WAREHOUSE"];
    if(!(ALLOWED.includes(user.role) || isDirRole(user.role))){
      toast("Доступ","Недостаточно прав","err"); location.hash="#/home"; return;
    }

    const now = new Date();
    let curYear = now.getFullYear(), curMonth = now.getMonth()+1;

    const html = `
      <div class="panel">
        <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:8px">
            <button class="btn ghost" id="ts_prev">◀</button>
            <span id="ts_period" style="font-size:16px;font-weight:600;color:var(--t1);min-width:160px;text-align:center"></span>
            <button class="btn ghost" id="ts_next">▶</button>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn ghost" id="ts_refresh">🔄 Обновить</button>
            <button class="btn primary" id="ts_export">📥 Excel</button>
          </div>
        </div>
        <div id="ts_stats" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px"></div>
        <div id="ts_wrap" class="timesheet-wrap" style="overflow:auto;max-height:calc(100vh - 240px);border:1px solid var(--brd);border-radius:var(--r-md)">
          <div style="padding:40px;text-align:center;color:var(--t3)">Загрузка...</div>
        </div>
      </div>
      <style>
        .ts-table{border-collapse:collapse;font-size:12px;width:max-content;min-width:100%}
        .ts-table th,.ts-table td{padding:4px 6px;border:1px solid var(--brd);white-space:nowrap;text-align:center}
        .ts-table thead{position:sticky;top:0;z-index:3}
        .ts-table thead th{background:var(--bg2);color:var(--t2);font-weight:600;font-size:11px}
        .ts-table thead th:first-child{z-index:4}
        .ts-table td:first-child,.ts-table th:first-child{position:sticky;left:0;z-index:2;background:var(--bg1);text-align:left;min-width:180px;max-width:220px}
        .ts-table tbody tr:hover td{background:var(--bg3)}
        .ts-table tbody tr:hover td:first-child{background:var(--bg3)}
        .ts-cell{width:28px;height:24px;border-radius:3px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;cursor:default}
        .ts-cell.editable{cursor:pointer}
        .ts-cell.editable:hover{opacity:.8;box-shadow:0 0 0 2px var(--gold)}
        .ts-group-header td{background:var(--bg3)!important;font-weight:600;color:var(--t1);font-size:13px}
        .ts-total{font-weight:600;color:var(--t1)}
        .ts-sum{color:var(--ok-t);font-weight:600}
      </style>
    `;
    await layout(html, {title: title || "Общий табель"});

    const editableTypes = EDIT_ROLES[user.role] || (isDirRole(user.role) ? Object.keys(CELL_TYPES) : []);
    const canEdit = editableTypes.length > 0;

    function updatePeriodLabel(){
      const el = $('#ts_period');
      if(el) el.textContent = new Date(curYear, curMonth-1).toLocaleString('ru-RU',{month:'long',year:'numeric'});
    }

    async function loadData(){
      try{
        const resp = await fetch(`/api/timesheet/global/${curYear}/${curMonth}`, {
          headers:{'Authorization':'Bearer '+token}
        });
        if(!resp.ok) throw new Error('HTTP '+resp.status);
        return await resp.json();
      }catch(e){
        toast("Ошибка","Не удалось загрузить табель","err");
        return null;
      }
    }

    function renderTable(data){
      const wrap = $('#ts_wrap');
      if(!data || !data.workers || !data.workers.length){
        wrap.innerHTML = '<div style="padding:40px;text-align:center;color:var(--t3)">Нет данных за выбранный период</div>';
        $('#ts_stats').innerHTML = '';
        return;
      }

      const daysInMonth = new Date(curYear, curMonth, 0).getDate();
      const days = Array.from({length:daysInMonth},(_,i)=>i+1);

      // Stats
      const totalWorkers = data.workers.length;
      const totalDays = data.workers.reduce((s,w)=> s + (w.total_days||0), 0);
      const totalAmount = data.workers.reduce((s,w)=> s + (w.total_amount||0), 0);
      $('#ts_stats').innerHTML = `
        <div style="padding:8px 16px;background:var(--ok-bg);border-radius:var(--r-sm);color:var(--ok-t);font-weight:600">${totalWorkers} рабочих</div>
        <div style="padding:8px 16px;background:var(--info-bg);border-radius:var(--r-sm);color:var(--info-t);font-weight:600">${totalDays} чел-дней</div>
        <div style="padding:8px 16px;background:var(--gold-bg);border-radius:var(--r-sm);color:var(--gold);font-weight:600">${fmt(totalAmount)} ₽</div>
      `;

      // Group by work
      const groups = {};
      data.workers.forEach(w=>{
        const key = w.work_title || 'Без объекта';
        if(!groups[key]) groups[key] = [];
        groups[key].push(w);
      });

      let rows = '';
      // Header
      rows += '<thead><tr><th>ФИО / Объект</th>';
      days.forEach(d=>{
        const dt = new Date(curYear, curMonth-1, d);
        const wd = dt.getDay();
        const isWeekend = wd===0||wd===6;
        rows += `<th style="${isWeekend?'color:var(--err-t)':''}">${d}</th>`;
      });
      rows += '<th class="ts-total">Дни</th><th class="ts-total">Сумма</th></tr></thead>';

      rows += '<tbody>';
      Object.entries(groups).forEach(([workTitle, workers])=>{
        rows += `<tr class="ts-group-header"><td colspan="${daysInMonth+3}">${esc(workTitle)}</td></tr>`;
        workers.forEach(w=>{
          rows += `<tr><td title="${esc(w.fio||'')}">${esc(w.fio||'—')}<div style="font-size:10px;color:var(--t3)">${esc(w.position||w.role_tag||'')}</div></td>`;
          days.forEach(d=>{
            const key = `${curYear}-${String(curMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const entry = (w.entries||{})[key];
            if(entry && entry.type){
              const ct = CELL_TYPES[entry.type] || CELL_TYPES.day;
              rows += `<td><div class="ts-cell" style="background:${ct.bg};color:${ct.color}" title="${ct.title}${entry.amount?' · '+fmt(entry.amount)+' ₽':''}">${ct.label}</div></td>`;
            } else {
              const editable = canEdit ? ' editable' : '';
              rows += `<td><div class="ts-cell${editable}" data-emp="${w.employee_id}" data-date="${key}" data-work="${w.work_id||''}"${canEdit?' title="Добавить отметку"':''}></div></td>`;
            }
          });
          rows += `<td class="ts-total">${w.total_days||0}</td>`;
          rows += `<td class="ts-sum">${fmt(w.total_amount||0)} ₽</td>`;
          rows += '</tr>';
        });
      });
      rows += '</tbody>';

      wrap.innerHTML = `<table class="ts-table">${rows}</table>`;

      // Edit handler
      if(canEdit){
        wrap.querySelectorAll('.ts-cell.editable').forEach(cell=>{
          cell.addEventListener('click', ()=>{
            const empId = cell.dataset.emp;
            const date = cell.dataset.date;
            const workId = cell.dataset.work;
            showEditDropdown(cell, empId, date, workId);
          });
        });
      }
    }

    function showEditDropdown(cell, empId, date, workId){
      // Remove existing dropdown
      document.querySelectorAll('.ts-dropdown').forEach(d=>d.remove());

      const dd = document.createElement('div');
      dd.className = 'ts-dropdown';
      dd.style.cssText = 'position:absolute;z-index:100;background:var(--bg2);border:1px solid var(--brd);border-radius:var(--r-md);padding:4px;box-shadow:var(--shadow-md);min-width:120px';

      editableTypes.forEach(type=>{
        const ct = CELL_TYPES[type];
        const btn = document.createElement('button');
        btn.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;border:none;background:none;color:var(--t1);cursor:pointer;border-radius:var(--r-sm);font-size:13px';
        btn.innerHTML = `<span style="background:${ct.bg};color:${ct.color};width:24px;height:20px;border-radius:3px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:600">${ct.label}</span> ${ct.title}`;
        btn.addEventListener('mouseenter', ()=>{ btn.style.background='var(--bg4)'; });
        btn.addEventListener('mouseleave', ()=>{ btn.style.background='none'; });
        btn.addEventListener('click', async ()=>{
          dd.remove();
          try{
            const resp = await fetch('/api/timesheet/global/entry', {
              method:'PUT',
              headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
              body: JSON.stringify({employee_id:Number(empId), date, type, work_id:workId?Number(workId):null})
            });
            if(!resp.ok){
              const err = await resp.json().catch(()=>({}));
              throw new Error(err.error||'Ошибка сохранения');
            }
            toast("Табель","Отметка добавлена","success");
            await refresh();
          }catch(e){
            toast("Ошибка", e.message, "err");
          }
        });
        dd.appendChild(btn);
      });

      const rect = cell.getBoundingClientRect();
      const wrap = $('#ts_wrap');
      const wrapRect = wrap.getBoundingClientRect();
      dd.style.left = (rect.left - wrapRect.left + wrap.scrollLeft) + 'px';
      dd.style.top = (rect.bottom - wrapRect.top + wrap.scrollTop + 2) + 'px';
      wrap.style.position = 'relative';
      wrap.appendChild(dd);

      const closeDD = (e)=>{ if(!dd.contains(e.target)){ dd.remove(); document.removeEventListener('click',closeDD); }};
      setTimeout(()=> document.addEventListener('click', closeDD), 10);
    }

    async function refresh(){
      updatePeriodLabel();
      const data = await loadData();
      if(data) renderTable(data);
    }

    // Init
    updatePeriodLabel();
    refresh();

    // Navigation
    $('#ts_prev').addEventListener('click', ()=>{
      curMonth--;
      if(curMonth<1){ curMonth=12; curYear--; }
      refresh();
    });
    $('#ts_next').addEventListener('click', ()=>{
      curMonth++;
      if(curMonth>12){ curMonth=1; curYear++; }
      refresh();
    });
    $('#ts_refresh').addEventListener('click', refresh);

    // Excel export
    $('#ts_export').addEventListener('click', async ()=>{
      try{
        const resp = await fetch(`/api/timesheet/global/${curYear}/${curMonth}/export`, {
          headers:{'Authorization':'Bearer '+token}
        });
        if(!resp.ok) throw new Error('HTTP '+resp.status);
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `табель_${curYear}_${String(curMonth).padStart(2,'0')}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
        toast("Экспорт","Файл скачан","success");
      }catch(e){
        toast("Ошибка","Не удалось скачать Excel","err");
      }
    });

    // Auto-refresh every 10s
    if(_refreshTimer) clearInterval(_refreshTimer);
    _refreshTimer = setInterval(async ()=>{
      if(!document.getElementById('ts_wrap')) { clearInterval(_refreshTimer); return; }
      const data = await loadData();
      if(data) renderTable(data);
    }, 10000);
  }

  return {render};
})();
