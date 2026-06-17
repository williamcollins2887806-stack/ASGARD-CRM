window.AsgardGlobalTimesheetPage=(function(){
  'use strict';
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

  // VIEW_ROLES — синхронизировано с backend src/routes/global-timesheet.js:VIEW_ROLES
  const ALLOWED = ["ADMIN","DIRECTOR_GEN","DIRECTOR_COMM","DIRECTOR_DEV","TO","HEAD_TO","WAREHOUSE","PROC","BUH","HR","HR_MANAGER"];

  // EDIT_ROLES — синхронизировано с backend canEditType()
  const EDIT_ROLES = {
    ADMIN:        Object.keys(CELL_TYPES),
    DIRECTOR_GEN: Object.keys(CELL_TYPES),
    DIRECTOR_COMM:Object.keys(CELL_TYPES),
    DIRECTOR_DEV: Object.keys(CELL_TYPES),
    TO:           ['medical'],
    HEAD_TO:      ['medical'],
    WAREHOUSE:    ['warehouse']
    // PROC, BUH, HR, HR_MANAGER — только просмотр и Excel
  };

  let _refreshTimer = null;
  let _stylesInjected = false;

  function injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    const s = document.createElement('style');
    s.id = 'ts-styles';
    s.textContent = `
      .ts-table { border-collapse: collapse; font-size: 12px; width: max-content; min-width: 100%; }
      .ts-table th, .ts-table td { padding: 4px 6px; border: 1px solid var(--brd); white-space: nowrap; text-align: center; }
      .ts-table thead { position: sticky; top: 0; z-index: 3; }
      .ts-table thead th { background: var(--bg2); color: var(--t2); font-weight: 600; font-size: 11px; }
      .ts-table thead th:first-child { z-index: 4; }
      .ts-table td:first-child, .ts-table th:first-child { position: sticky; left: 0; z-index: 2; background: var(--bg1); text-align: left; min-width: 180px; max-width: 220px; }
      .ts-table tbody tr:hover td { background: var(--bg3); }
      .ts-table tbody tr:hover td:first-child { background: var(--bg3); }
      .ts-cell { width: 28px; height: 24px; border-radius: var(--r-sm); display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; cursor: default; }
      .ts-cell.editable { cursor: pointer; }
      .ts-cell.editable:hover { opacity: .8; box-shadow: 0 0 0 2px var(--gold); }
      .ts-group-header td { background: var(--bg3) !important; font-weight: 600; color: var(--t1); font-size: 13px; }
      .ts-total { font-weight: 600; color: var(--t1); }
      .ts-sum { color: var(--ok-t); font-weight: 600; }
      .ts-dropdown { position: absolute; z-index: 100; background: var(--bg2); border: 1px solid var(--brd); border-radius: var(--r-md); padding: 4px; box-shadow: var(--shadow-md); min-width: 140px; }
      .ts-dropdown button { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 10px; border: none; background: none; color: var(--t1); cursor: pointer; border-radius: var(--r-sm); font-size: 13px; }
      .ts-dropdown button:hover { background: var(--bg4); }
      .ts-add-modal { display: flex; flex-direction: column; gap: 12px; min-width: 420px; }
      .ts-add-modal input[type=text], .ts-add-modal input[type=date] { width: 100%; padding: 8px 10px; border: 1px solid var(--brd); border-radius: var(--r-sm); background: var(--bg1); color: var(--t1); font-size: 14px; }
      .ts-search-results { max-height: 260px; overflow:auto; border: 1px solid var(--brd); border-radius: var(--r-sm); }
      .ts-search-row { display:flex; justify-content:space-between; align-items:center; padding: 8px 10px; cursor: pointer; border-bottom: 1px solid var(--brd); }
      .ts-search-row:hover { background: var(--bg3); }
      .ts-search-row.selected { background: var(--gold-bg); color: var(--gold); }
      .ts-add-empty { padding: 16px; text-align: center; color: var(--t3); font-size: 13px; }
      .ts-type-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
      .ts-type-btn { display:flex; align-items:center; justify-content:center; gap:6px; padding: 12px; border: 2px solid var(--brd); border-radius: var(--r-md); background: var(--bg2); color: var(--t1); cursor:pointer; font-size:13px; font-weight:600; }
      .ts-type-btn:hover { border-color: var(--gold); }
      .ts-type-btn .ts-cell { width: 32px; height: 28px; font-size: 14px; }
    `;
    document.head.appendChild(s);
  }

  async function render({layout, title}){
    injectStyles();
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }
    const user = auth.user;
    const token = auth.token;
    if(!(ALLOWED.includes(user.role) || isDirRole(user.role))){
      toast("Доступ","Недостаточно прав","err"); location.hash="#/home"; return;
    }

    // Всегда стартуем с текущего месяца
    const now = new Date();
    let curYear = now.getFullYear(), curMonth = now.getMonth()+1;

    const html = `
      <div class="panel">
        <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:8px">
            <button class="btn ghost" id="ts_prev">◀</button>
            <span id="ts_period" style="font-size:16px;font-weight:600;color:var(--t1);min-width:160px;text-align:center"></span>
            <button class="btn ghost" id="ts_next">▶</button>
            <button class="btn ghost" id="ts_today" title="К текущему месяцу">📅 Сегодня</button>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn primary" id="ts_add_worker" title="Добавить рабочего и отметку">＋ Добавить рабочего</button>
            <button class="btn ghost" id="ts_refresh">🔄 Обновить</button>
            <button class="btn primary" id="ts_export">📥 Excel</button>
          </div>
        </div>
        <div id="ts_stats" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px"></div>
        <div id="ts_wrap" class="timesheet-wrap" style="overflow:auto;max-height:calc(100vh - 240px);border:1px solid var(--brd);border-radius:var(--r-md)">
          <div style="padding:40px;text-align:center;color:var(--t3)">Загрузка...</div>
        </div>
      </div>
    `;
    await layout(html, {title: title || "Табель"});

    const editableTypes = EDIT_ROLES[user.role] || (isDirRole(user.role) ? Object.keys(CELL_TYPES) : []);
    const canEdit = editableTypes.length > 0;

    // Скрываем «+ Добавить» если у роли нет прав ставить отметки (PROC/BUH/HR/HR_MANAGER)
    const addBtn = $('#ts_add_worker');
    if (!canEdit && addBtn) addBtn.style.display = 'none';

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
        wrap.innerHTML = `<div style="padding:40px;text-align:center;color:var(--t3)">
          Нет данных за выбранный период.<br>
          <span style="font-size:12px">Показаны рабочие у кого есть хотя бы одна отметка за месяц.</span>
          ${canEdit ? '<br><br><button class="btn primary" id="ts_add_empty">＋ Добавить рабочего</button>' : ''}
        </div>`;
        $('#ts_stats').innerHTML = '';
        const ae = $('#ts_add_empty');
        if (ae) ae.addEventListener('click', openAddWorkerModal);
        return;
      }

      const daysInMonth = new Date(curYear, curMonth, 0).getDate();
      const days = Array.from({length:daysInMonth},(_,i)=>i+1);
      const todayD = (new Date().getFullYear()===curYear && new Date().getMonth()+1===curMonth) ? new Date().getDate() : -1;

      // Stats
      const totalWorkers = (data.total && data.total.workers) || new Set(data.workers.map(w=>w.employee_id)).size;
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
      rows += '<thead><tr><th>ФИО / Объект</th>';
      days.forEach(d=>{
        const dt = new Date(curYear, curMonth-1, d);
        const wd = dt.getDay();
        const isWeekend = wd===0||wd===6;
        const isToday = d===todayD;
        const style = (isWeekend?'color:var(--err-t);':'') + (isToday?'background:var(--gold-bg);color:var(--gold);':'');
        rows += `<th style="${style}">${d}</th>`;
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

    async function putEntry({employee_id, date, type, work_id}) {
      const resp = await fetch('/api/timesheet/global/entry', {
        method:'PUT',
        headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
        body: JSON.stringify({employee_id, date, type, work_id: work_id || null})
      });
      if(!resp.ok){
        const err = await resp.json().catch(()=>({}));
        const msg = err.error || 'Ошибка сохранения';
        const e = new Error(msg);
        e.status = resp.status;
        throw e;
      }
      return await resp.json();
    }

    function showEditDropdown(cell, empId, date, workId){
      document.querySelectorAll('.ts-dropdown').forEach(d=>d.remove());

      const dd = document.createElement('div');
      dd.className = 'ts-dropdown';

      editableTypes.forEach(type=>{
        // day/night без work_id поставить нельзя (assignment_id NOT NULL) — скрываем
        if((type==='day'||type==='night') && !workId) return;
        const ct = CELL_TYPES[type];
        const btn = document.createElement('button');
        btn.innerHTML = `<span class="ts-cell" style="background:${ct.bg};color:${ct.color}">${ct.label}</span> ${ct.title}`;
        btn.addEventListener('click', async ()=>{
          dd.remove();
          try{
            await putEntry({employee_id:Number(empId), date, type, work_id: workId ? Number(workId) : null});
            toast("Табель","Отметка добавлена","ok");
            await refresh();
          }catch(e){
            if (e.status === 409) toast("Уже есть отметка", e.message, "err");
            else toast("Ошибка", e.message, "err");
          }
        });
        dd.appendChild(btn);
      });

      if (!dd.children.length) {
        toast("Нет действий","Для этой клетки нет доступных типов","err");
        return;
      }

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

    // ─── Модалка «+ Добавить рабочего» ───────────────────────────────────
    function openAddWorkerModal() {
      if (!canEdit) { toast("Доступ","Просмотр без права редактирования","err"); return; }
      const todayStr = new Date().toISOString().slice(0,10);

      // Только типы которые роль может ставить + warehouse/medical/waiting (без обязательного work_id)
      const allowedTypes = editableTypes.filter(t => t !== 'day' && t !== 'night');

      const html = `
        <div class="ts-add-modal">
          <div>
            <label style="font-size:11px;color:var(--t2);display:block;margin-bottom:4px">Поиск рабочего (ФИО / телефон, минимум 2 символа)</label>
            <input type="text" id="ts_search" placeholder="Иванов, +7..." autocomplete="off">
          </div>
          <div id="ts_search_results" class="ts-search-results" style="display:none"></div>
          <div id="ts_picked" style="padding:8px 10px;background:var(--ok-bg);color:var(--ok-t);border-radius:var(--r-sm);font-weight:600;display:none"></div>
          <div>
            <label style="font-size:11px;color:var(--t2);display:block;margin-bottom:4px">Дата отметки</label>
            <input type="date" id="ts_date" value="${todayStr}">
          </div>
          <div>
            <label style="font-size:11px;color:var(--t2);display:block;margin-bottom:6px">Тип отметки</label>
            <div class="ts-type-grid" id="ts_type_grid">
              ${allowedTypes.map(t => {
                const ct = CELL_TYPES[t];
                return `<button class="ts-type-btn" data-type="${t}">
                  <span class="ts-cell" style="background:${ct.bg};color:${ct.color}">${ct.label}</span>
                  ${ct.title}
                </button>`;
              }).join('')}
            </div>
          </div>
        </div>
      `;

      showModal({
        title: 'Добавить рабочего в табель',
        html: html,
        wide: false,
        onMount: ({body}) => {
          let selected = null;
          let searchTimer = null;
          const sInput   = body.querySelector('#ts_search');
          const sResults = body.querySelector('#ts_search_results');
          const picked   = body.querySelector('#ts_picked');
          const dateInp  = body.querySelector('#ts_date');

          function pickWorker(w){
            selected = w;
            picked.style.display = 'block';
            picked.textContent = `✓ ${w.fio}${w.position ? ' · '+w.position : ''}`;
            sResults.style.display = 'none';
            sInput.value = w.fio;
          }

          async function doSearch(q) {
            if (q.length < 2) { sResults.style.display = 'none'; return; }
            try {
              const r = await fetch('/api/timesheet/workers/search?q=' + encodeURIComponent(q), {
                headers:{'Authorization':'Bearer '+token}
              });
              if (!r.ok) throw new Error('HTTP '+r.status);
              const data = await r.json();
              const list = data.workers || [];
              if (!list.length) {
                sResults.innerHTML = '<div class="ts-add-empty">Никого не нашли</div>';
              } else {
                sResults.innerHTML = list.map(w =>
                  `<div class="ts-search-row" data-emp="${w.employee_id}">
                    <div><b>${esc(w.fio)}</b> <span style="color:var(--t3);font-size:11px">${esc(w.position||'')}</span></div>
                    <div style="color:var(--t3);font-size:11px">${esc(w.phone||'')}</div>
                  </div>`
                ).join('');
                sResults.querySelectorAll('.ts-search-row').forEach(row => {
                  row.addEventListener('click', ()=> {
                    const id = Number(row.dataset.emp);
                    const w = list.find(x => x.employee_id === id);
                    if (w) pickWorker(w);
                  });
                });
              }
              sResults.style.display = 'block';
            } catch(e) {
              sResults.innerHTML = '<div class="ts-add-empty">Ошибка поиска</div>';
              sResults.style.display = 'block';
            }
          }

          sInput.addEventListener('input', () => {
            selected = null;
            picked.style.display = 'none';
            clearTimeout(searchTimer);
            searchTimer = setTimeout(()=> doSearch(sInput.value.trim()), 200);
          });
          setTimeout(()=> sInput.focus(), 50);

          body.querySelectorAll('.ts-type-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
              if (!selected) { toast("Не выбран рабочий","Сначала найдите и выберите рабочего","err"); return; }
              const type = btn.dataset.type;
              const date = dateInp.value || todayStr;
              try {
                await putEntry({employee_id: selected.employee_id, date, type, work_id: null});
                toast("Табель","Отметка добавлена","ok");
                closeModal();
                await refresh();
              } catch(e) {
                if (e.status === 409) toast("Уже есть отметка", e.message, "err");
                else toast("Ошибка", e.message, "err");
              }
            });
          });
        }
      });
    }

    async function refresh(){
      updatePeriodLabel();
      const data = await loadData();
      if(data) renderTable(data);
    }

    updatePeriodLabel();
    refresh();

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
    $('#ts_today').addEventListener('click', ()=>{
      const n = new Date();
      curYear = n.getFullYear(); curMonth = n.getMonth()+1;
      refresh();
    });
    $('#ts_refresh').addEventListener('click', refresh);
    if (addBtn) addBtn.addEventListener('click', openAddWorkerModal);

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
        toast("Экспорт","Файл скачан","ok");
      }catch(e){
        toast("Ошибка","Не удалось скачать Excel","err");
      }
    });

    if(_refreshTimer) clearInterval(_refreshTimer);
    _refreshTimer = setInterval(async ()=>{
      if(!document.getElementById('ts_wrap')) { clearInterval(_refreshTimer); return; }
      const data = await loadData();
      if(data) renderTable(data);
    }, 10000);
  }

  return {render};
})();
