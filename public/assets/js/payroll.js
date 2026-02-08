/**
 * АСГАРД CRM — Расчёты с рабочими (Payroll)
 * Фаза 4: ведомости, самозанятые, разовые оплаты
 */
window.AsgardPayrollPage = (function(){
  const { $, $$, esc, toast, showModal, hideModal } = AsgardUI;

  function money(x){
    if(x===null||x===undefined||x==="") return "\u2014";
    const n=Number(x); if(isNaN(n)) return esc(String(x));
    return n.toLocaleString("ru-RU") + ' \u20BD';
  }
  function moneyShort(x){
    const n=Number(x)||0;
    if(n>=1000000) return (n/1000000).toFixed(1)+'M';
    if(n>=1000) return Math.round(n/1000)+'K';
    return n.toLocaleString("ru-RU");
  }
  function fmtDate(d){ if(!d) return '\u2014'; return new Date(d).toLocaleDateString('ru-RU'); }
  function isoNow(){ return new Date().toISOString(); }
  function num(x){ if(x===null||x===undefined||x==="") return null; const n=Number(String(x).replace(/\s/g,"").replace(",",".")); return isNaN(n)?null:n; }

  const STATUSES = {
    draft:    { label:'Черновик',        bg:'rgba(100,116,139,.2)', color:'#94a3b8' },
    pending:  { label:'На согласовании', bg:'rgba(245,158,11,.2)',  color:'#f59e0b' },
    approved: { label:'Согласовано',     bg:'rgba(59,130,246,.2)',  color:'#3b82f6' },
    rework:   { label:'Доработка',       bg:'rgba(239,68,68,.15)', color:'#ef4444' },
    paid:     { label:'Оплачено',        bg:'rgba(34,197,94,.2)',  color:'#22c55e' },
    cancelled:{ label:'Отменено',        bg:'rgba(100,116,139,.15)',color:'#64748b' }
  };

  const PAYMENT_TYPES = {
    one_time:  { label:'Разовая',   icon:'\uD83D\uDCB5' },
    taxi:      { label:'Такси',     icon:'\uD83D\uDE95' },
    fuel:      { label:'Топливо',   icon:'\u26FD' },
    meal:      { label:'Питание',   icon:'\uD83C\uDF7D' },
    material:  { label:'Материалы', icon:'\uD83D\uDD29' },
    other:     { label:'Прочее',    icon:'\uD83D\uDCE6' }
  };

  function badge(status){
    const s = STATUSES[status] || STATUSES.draft;
    return `<span class="payroll-badge" style="background:${s.bg};color:${s.color}">${esc(s.label)}</span>`;
  }

  async function api(path, opts={}){
    const auth = await AsgardAuth.getAuth();
    if(!auth?.token) throw new Error('Нет токена');
    const url = '/api/payroll' + path;
    const fetchOpts = { headers: { 'Authorization': 'Bearer '+auth.token } };
    if(opts.method) fetchOpts.method = opts.method;
    if(opts.body){
      fetchOpts.headers['Content-Type'] = 'application/json';
      fetchOpts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, fetchOpts);
    if(!res.ok){
      const err = await res.json().catch(()=>({error:'Ошибка сервера'}));
      throw new Error(err.error || err.message || 'Ошибка');
    }
    // Excel download
    if(res.headers.get('content-type')?.includes('spreadsheet')){
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'payroll_export.xlsx';
      a.click();
      return { downloaded: true };
    }
    return res.json();
  }

  const CSS = `
<style>
.payroll-header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px;margin-bottom:20px}
.payroll-tabs{display:flex;gap:4px;background:rgba(13,20,40,.6);padding:4px;border-radius:14px;flex-wrap:wrap}
.payroll-tab{padding:8px 16px;border-radius:12px;border:none;background:transparent;color:var(--muted);font-weight:700;cursor:pointer;transition:all .2s;font-size:13px}
.payroll-tab:hover{color:var(--text)}
.payroll-tab.active{background:linear-gradient(135deg,rgba(59,130,246,.3),rgba(34,197,94,.2));color:var(--text)}
.payroll-tab .count{font-size:11px;background:rgba(245,158,11,.3);color:#f59e0b;padding:2px 6px;border-radius:6px;margin-left:4px}
.payroll-kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px}
.payroll-kpi .k{background:rgba(13,20,40,.5);border:1px solid rgba(42,59,102,.85);border-radius:16px;padding:14px}
.payroll-kpi .k .t{font-size:11px;color:rgba(184,196,231,.85);font-weight:800;text-transform:uppercase}
.payroll-kpi .k .v{font-size:24px;font-weight:900;margin-top:6px;color:rgba(242,208,138,.95)}
.payroll-kpi .k .s{font-size:12px;color:rgba(184,196,231,.7);margin-top:4px}
.payroll-card{background:rgba(13,20,40,.45);border:1px solid rgba(42,59,102,.85);border-radius:16px;padding:16px;margin-bottom:12px;cursor:pointer;transition:all .2s}
.payroll-card:hover{border-color:rgba(242,208,138,.5);transform:translateY(-2px)}
.payroll-badge{display:inline-flex;align-items:center;padding:3px 10px;border-radius:8px;font-size:12px;font-weight:700}
.payroll-actions{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px}
.payroll-director-comment{background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.3);border-left:4px solid #ef4444;border-radius:12px;padding:12px 16px;margin-bottom:16px}
.payroll-inline-input{background:rgba(13,20,40,.3);border:1px solid rgba(42,59,102,.6);border-radius:8px;padding:4px 8px;color:var(--text);width:80px;text-align:right;font-size:13px}
.payroll-inline-input:focus{border-color:rgba(242,208,138,.6);outline:none}
.payroll-inline-input:read-only{background:transparent;border-color:transparent;cursor:default}
.se-card{background:rgba(13,20,40,.45);border:1px solid rgba(42,59,102,.85);border-radius:16px;padding:16px;margin-bottom:12px}
.se-card .se-name{font-size:16px;font-weight:800;color:var(--text)}
.se-card .se-inn{font-size:13px;color:var(--muted);font-family:monospace}
.otp-card{background:rgba(13,20,40,.45);border:1px solid rgba(42,59,102,.85);border-radius:16px;padding:16px;margin-bottom:12px;border-left:4px solid transparent}
.otp-card[data-status="pending"]{border-left-color:#f59e0b}
.otp-card[data-status="approved"]{border-left-color:#3b82f6}
.otp-card[data-status="paid"]{border-left-color:#22c55e}
.otp-card[data-status="rejected"]{border-left-color:#ef4444}
.payroll-table{width:100%;border-collapse:collapse;font-size:13px}
.payroll-table th{text-align:left;padding:8px 6px;font-size:11px;color:var(--muted);text-transform:uppercase;border-bottom:1px solid rgba(42,59,102,.6);white-space:nowrap}
.payroll-table td{padding:6px;border-bottom:1px solid rgba(42,59,102,.3);vertical-align:middle}
.payroll-table tr:hover{background:rgba(59,130,246,.05)}
.payroll-table tfoot td{font-weight:800;border-top:2px solid rgba(242,208,138,.4);color:rgba(242,208,138,.95)}
.payroll-filters{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;align-items:center}
.payroll-filters select,.payroll-filters input{background:rgba(13,20,40,.4);border:1px solid rgba(42,59,102,.6);border-radius:10px;padding:6px 12px;color:var(--text);font-size:13px}
.tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
</style>`;

  // ═══════════════════════════════════════════════════════════
  // Экран 1: Список ведомостей
  // ═══════════════════════════════════════════════════════════
  async function render({layout, title}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }
    const user = auth.user;

    let currentTab = 'all';
    let filterWorkId = '';
    let sheets = [];
    let works = [];

    async function load(){
      try{
        const params = new URLSearchParams();
        if(filterWorkId) params.set('work_id', filterWorkId);
        if(currentTab !== 'all') params.set('status', currentTab);
        params.set('limit','200');
        const data = await api('/sheets?' + params.toString());
        sheets = data.sheets || [];
      }catch(e){ toast('Ошибка',''+e.message,'error'); sheets=[]; }

      try{
        works = await AsgardDB.all('works') || [];
      }catch(e){ works=[]; }
    }

    function renderContent(){
      const tabs = [
        {key:'all', label:'Все', count: sheets.length},
        {key:'draft', label:'Черновик'},
        {key:'pending', label:'На согл.'},
        {key:'approved', label:'Согл-но'},
        {key:'paid', label:'Оплачено'},
        {key:'rework', label:'Доработка'}
      ];

      // KPI
      const totalAccrued = sheets.reduce((s,x)=>s+Number(x.total_accrued||0),0);
      const totalPayout = sheets.reduce((s,x)=>s+Number(x.total_payout||0),0);
      const pendingCount = sheets.filter(s=>s.status==='pending').length;
      const paidTotal = sheets.filter(s=>s.status==='paid').reduce((s,x)=>s+Number(x.total_payout||0),0);

      // PM может создавать только для своих работ
      const canCreate = user.role==='ADMIN' || user.role==='HEAD_PM' ||
        ['DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'].includes(user.role) || user.role==='PM';

      const myWorks = user.role==='PM' ?
        works.filter(w=>w.pm_id==user.id||w.created_by==user.id) : works;

      return `${CSS}
        <div class="payroll-header">
          <h2 style="margin:0;font-size:22px">\uD83D\uDCB0 ${esc(title||'')}</h2>
          ${canCreate?`<button class="btn primary" id="btnNewSheet">+ Новая ведомость</button>`:''}
        </div>

        <div class="payroll-kpi">
          <div class="k"><div class="t">Всего ведомостей</div><div class="v">${sheets.length}</div></div>
          <div class="k"><div class="t">Ожидают согл.</div><div class="v" style="color:#f59e0b">${pendingCount}</div></div>
          <div class="k"><div class="t">К выплате</div><div class="v">${moneyShort(totalPayout)} \u20BD</div></div>
          <div class="k"><div class="t">Выплачено</div><div class="v" style="color:#22c55e">${moneyShort(paidTotal)} \u20BD</div></div>
        </div>

        <div class="payroll-tabs" id="payrollTabs">
          ${tabs.map(t=>`<button class="payroll-tab${currentTab===t.key?' active':''}" data-tab="${t.key}">${esc(t.label)}${t.count!==undefined?`<span class="count">${t.count}</span>`:''}</button>`).join('')}
        </div>

        <div class="payroll-filters">
          <select id="filterWork" style="min-width:200px">
            <option value="">Все работы</option>
            ${myWorks.map(w=>`<option value="${w.id}" ${filterWorkId==w.id?'selected':''}>${esc((w.customer_name||'')+ ' — '+(w.work_title||''))}</option>`).join('')}
          </select>
        </div>

        <div id="sheetsList">
          ${sheets.length===0 ? '<div style="text-align:center;color:var(--muted);padding:40px">Нет ведомостей</div>' :
            sheets.map(s=>{
              const workLabel = s.work_title ? esc((s.customer_name||'')+ ' — '+(s.work_title||'')) : 'Общая';
              return `<div class="payroll-card" data-id="${s.id}">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
                  <div>
                    <div style="font-weight:800;font-size:15px">${esc(s.title||'')}</div>
                    <div style="font-size:12px;color:var(--muted);margin-top:4px">${workLabel}</div>
                  </div>
                  <div style="text-align:right">
                    ${badge(s.status)}
                    <div style="font-size:12px;color:var(--muted);margin-top:4px">${fmtDate(s.created_at)}</div>
                  </div>
                </div>
                <div style="display:flex;gap:16px;margin-top:10px;font-size:13px;flex-wrap:wrap">
                  <span>Период: <b>${fmtDate(s.period_from)} — ${fmtDate(s.period_to)}</b></span>
                  <span>Рабочих: <b>${s.workers_count||0}</b></span>
                  <span>Начислено: <b>${money(s.total_accrued)}</b></span>
                  <span style="color:rgba(242,208,138,.95)">К выплате: <b>${money(s.total_payout)}</b></span>
                </div>
              </div>`;
            }).join('')}
        </div>`;
    }

    await load();
    await layout(renderContent(), {title: title||'Расчёты с рабочими'});

    // Обработчики
    document.getElementById('payrollTabs')?.addEventListener('click', async e=>{
      const tab = e.target.closest('.payroll-tab');
      if(!tab) return;
      currentTab = tab.dataset.tab;
      await load();
      const container = document.getElementById('app');
      if(container) await layout(renderContent(), {title});
      bindHandlers();
    });

    bindHandlers();

    function bindHandlers(){
      document.getElementById('filterWork')?.addEventListener('change', async e=>{
        filterWorkId = e.target.value;
        await load();
        await layout(renderContent(), {title});
        bindHandlers();
      });

      document.querySelectorAll('.payroll-card[data-id]').forEach(card=>{
        card.addEventListener('click', ()=>{
          location.hash = '#/payroll-sheet?id=' + card.dataset.id;
        });
      });

      document.getElementById('btnNewSheet')?.addEventListener('click', ()=>{
        const myWorks2 = user.role==='PM' ?
          works.filter(w=>w.pm_id==user.id||w.created_by==user.id) : works;

        showModal('Новая ведомость', `
          <div class="formrow"><div>
            <label>Работа *</label>
            <select id="ps_work" style="width:100%;padding:8px;border-radius:10px;background:var(--bg2);border:1px solid var(--line);color:var(--text)">
              <option value="">— Общая (без работы) —</option>
              ${myWorks2.map(w=>`<option value="${w.id}">${esc((w.customer_name||'')+ ' — '+(w.work_title||''))}</option>`).join('')}
            </select>
          </div></div>
          <div class="formrow" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Период с *</label><input type="date" id="ps_from" style="width:100%;padding:8px;border-radius:10px;background:var(--bg2);border:1px solid var(--line);color:var(--text)"/></div>
            <div><label>Период по *</label><input type="date" id="ps_to" style="width:100%;padding:8px;border-radius:10px;background:var(--bg2);border:1px solid var(--line);color:var(--text)"/></div>
          </div>
          <div class="formrow"><div style="grid-column:1/-1">
            <label>Название</label>
            <input id="ps_title" placeholder="Авто: Ведомость {месяц} \u2014 {объект}" style="width:100%;padding:8px;border-radius:10px;background:var(--bg2);border:1px solid var(--line);color:var(--text)"/>
          </div></div>
          <div class="formrow"><div style="grid-column:1/-1">
            <label>Комментарий</label>
            <textarea id="ps_comment" rows="2" style="width:100%;padding:8px;border-radius:10px;background:var(--bg2);border:1px solid var(--line);color:var(--text)"></textarea>
          </div></div>
          <button class="btn primary" id="btnCreateSheet" style="margin-top:12px;width:100%">Создать</button>
        `);

        document.getElementById('btnCreateSheet')?.addEventListener('click', async ()=>{
          const pf = document.getElementById('ps_from')?.value;
          const pt = document.getElementById('ps_to')?.value;
          if(!pf || !pt){ toast('Ошибка','Укажите период','error'); return; }
          try{
            const res = await api('/sheets', { method:'POST', body:{
              work_id: num(document.getElementById('ps_work')?.value),
              title: document.getElementById('ps_title')?.value || null,
              period_from: pf,
              period_to: pt,
              comment: document.getElementById('ps_comment')?.value || null
            }});
            hideModal();
            toast('Создано', 'Ведомость создана', 'ok');
            location.hash = '#/payroll-sheet?id=' + res.sheet.id;
          }catch(e){ toast('Ошибка', e.message, 'error'); }
        });
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Экран 2: Карточка ведомости
  // ═══════════════════════════════════════════════════════════
  async function renderSheet({layout, title, query}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }
    const user = auth.user;

    // Получить id из query или hash
    const params = new URLSearchParams(location.hash.split('?')[1]||'');
    const sheetId = params.get('id') || (query && query.id);
    const workIdFromUrl = params.get('work_id');

    // Если пришли с work_id — создать новую ведомость
    if(!sheetId && workIdFromUrl){
      location.hash = '#/payroll';
      return;
    }
    if(!sheetId){ location.hash='#/payroll'; return; }

    let sheet = null, items = [], payments = [];
    let employees = [];

    async function loadSheet(){
      try{
        const data = await api('/sheets/'+sheetId);
        sheet = data.sheet;
        items = data.items || [];
        payments = data.payments || [];
      }catch(e){
        toast('Ошибка', e.message, 'error');
        location.hash='#/payroll';
        return;
      }
      try{ employees = await AsgardDB.all('employees') || []; }catch(e){ employees=[]; }
    }

    await loadSheet();
    if(!sheet) return;

    const isEditable = sheet.status==='draft' || sheet.status==='rework';
    const isDirector = user.role==='ADMIN'||['DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'].includes(user.role);
    const canPay = isDirector || user.role==='BUH';

    function buildContent(){
      const workLabel = sheet.work_title ?
        esc((sheet.customer_name||'')+' \u2014 '+(sheet.work_title||'')) : 'Общая';

      // Summary
      const totalAccrued = items.reduce((s,x)=>s+Number(x.accrued||0),0);
      const totalBonus = items.reduce((s,x)=>s+Number(x.bonus||0),0);
      const totalPenalty = items.reduce((s,x)=>s+Number(x.penalty||0)+Number(x.deductions||0),0);
      const totalPayout = items.reduce((s,x)=>s+Number(x.payout||0),0);
      const avgRate = items.length ? Math.round(items.reduce((s,x)=>s+Number(x.day_rate||0),0)/items.length) : 0;

      // Action buttons
      let actions = '';
      if(isEditable){
        actions += `<button class="btn" id="btnAutoFill">Автозаполнение</button>`;
        actions += `<button class="btn" id="btnRecalc">Пересчитать</button>`;
        actions += `<button class="btn primary" id="btnSubmit">На согласование</button>`;
        actions += `<button class="btn" id="btnDeleteSheet" style="color:#ef4444">Удалить</button>`;
      }
      if(sheet.status==='pending' && isDirector){
        actions += `<button class="btn primary" id="btnApprove">Согласовать</button>`;
        actions += `<button class="btn" id="btnRework" style="color:#f59e0b">На доработку</button>`;
      }
      if(sheet.status==='approved' && canPay){
        actions += `<button class="btn primary" id="btnPay">Оплачено</button>`;
      }
      if(sheet.status==='approved' || sheet.status==='paid'){
        actions += `<button class="btn" id="btnExport">Excel</button>`;
      }

      // Director comment
      let dirComment = '';
      if(sheet.director_comment && (sheet.status==='rework'||sheet.status==='draft')){
        dirComment = `<div class="payroll-director-comment">
          <b>Комментарий директора:</b> ${esc(sheet.director_comment)}
        </div>`;
      }

      // Items table
      let tableRows = items.map((item, idx)=>{
        const seTag = item.is_self_employed || item.emp_se ? ' <span style="font-size:10px;background:rgba(59,130,246,.2);color:#3b82f6;padding:1px 5px;border-radius:4px">СЗ</span>' : '';
        if(isEditable){
          return `<tr data-item-id="${item.id}">
            <td>${idx+1}</td>
            <td style="min-width:150px"><b>${esc(item.employee_name||item.emp_fio||'')}</b>${seTag}<br><span style="font-size:11px;color:var(--muted)">${esc(item.role_on_work||'')}</span></td>
            <td><input type="number" class="payroll-inline-input pi-field" data-field="days_worked" value="${item.days_worked||0}" min="0" max="31" style="width:50px"/></td>
            <td><input type="number" class="payroll-inline-input pi-field" data-field="day_rate" value="${item.day_rate||0}" min="0" step="100"/></td>
            <td style="text-align:right;color:var(--muted)">${money(item.base_amount)}</td>
            <td><input type="number" class="payroll-inline-input pi-field" data-field="bonus" value="${item.bonus||0}" min="0" step="100" style="width:70px"/></td>
            <td><input type="number" class="payroll-inline-input pi-field" data-field="penalty" value="${item.penalty||0}" min="0" step="100" style="width:70px"/></td>
            <td><input type="number" class="payroll-inline-input pi-field" data-field="advance_paid" value="${item.advance_paid||0}" min="0" step="100" style="width:70px"/></td>
            <td style="text-align:right;font-weight:800;color:rgba(242,208,138,.95)" class="item-payout">${money(item.payout)}</td>
            <td><button class="btn" style="padding:2px 8px;font-size:11px" data-del-item="${item.id}">\u2716</button></td>
          </tr>`;
        } else {
          return `<tr>
            <td>${idx+1}</td>
            <td style="min-width:150px"><b>${esc(item.employee_name||item.emp_fio||'')}</b>${seTag}<br><span style="font-size:11px;color:var(--muted)">${esc(item.role_on_work||'')}</span></td>
            <td style="text-align:right">${item.days_worked||0}</td>
            <td style="text-align:right">${money(item.day_rate)}</td>
            <td style="text-align:right">${money(item.base_amount)}</td>
            <td style="text-align:right">${money(item.bonus)}</td>
            <td style="text-align:right">${money(item.penalty)}</td>
            <td style="text-align:right">${money(item.advance_paid)}</td>
            <td style="text-align:right;font-weight:800;color:rgba(242,208,138,.95)">${money(item.payout)}</td>
            <td></td>
          </tr>`;
        }
      }).join('');

      return `${CSS}
        <div style="margin-bottom:16px">
          <a href="#/payroll" style="color:var(--blue);font-size:13px">\u2190 Назад к списку</a>
        </div>

        <div class="payroll-header">
          <div>
            <h2 style="margin:0;font-size:20px">${esc(sheet.title||'Ведомость')}</h2>
            <div style="font-size:13px;color:var(--muted);margin-top:4px">
              ${badge(sheet.status)}
              &nbsp; Период: <b>${fmtDate(sheet.period_from)} \u2014 ${fmtDate(sheet.period_to)}</b>
              &nbsp; ${workLabel}
            </div>
            <div style="font-size:12px;color:var(--muted);margin-top:4px">
              Создал: ${esc(sheet.creator_name||'')} &middot; ${fmtDate(sheet.created_at)}
              ${sheet.approver_name ? ' &middot; Согласовал: '+esc(sheet.approver_name) : ''}
            </div>
          </div>
        </div>

        ${actions?`<div class="payroll-actions">${actions}</div>`:''}

        ${dirComment}

        <div class="payroll-kpi">
          <div class="k"><div class="t">Начислено</div><div class="v">${money(totalAccrued)}</div></div>
          <div class="k"><div class="t">Премии</div><div class="v" style="color:#3b82f6">${money(totalBonus)}</div></div>
          <div class="k"><div class="t">Удержания</div><div class="v" style="color:#ef4444">${money(totalPenalty)}</div></div>
          <div class="k"><div class="t">К выплате</div><div class="v">${money(totalPayout)}</div></div>
          <div class="k"><div class="t">Рабочих</div><div class="v">${items.length}</div></div>
          <div class="k"><div class="t">Ср. ставка</div><div class="v">${money(avgRate)}/д</div></div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="margin:0">Начисления</h3>
          ${isEditable?`<button class="btn" id="btnAddItem">+ Добавить</button>`:''}
        </div>

        <div class="tbl-wrap">
        <table class="payroll-table" id="payrollItemsTable">
          <thead>
            <tr>
              <th>\u2116</th><th>ФИО</th><th>Дней</th><th>Ставка</th><th>Начисл.</th>
              <th>Премия</th><th>Штраф</th><th>Аванс</th><th>К выпл.</th><th></th>
            </tr>
          </thead>
          <tbody>${tableRows || '<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:20px">Нет строк</td></tr>'}</tbody>
          ${items.length?`<tfoot><tr>
            <td></td><td><b>ИТОГО</b></td><td></td><td></td>
            <td style="text-align:right">${money(totalAccrued)}</td>
            <td style="text-align:right">${money(totalBonus)}</td>
            <td style="text-align:right">${money(totalPenalty)}</td>
            <td style="text-align:right">${money(items.reduce((s,x)=>s+Number(x.advance_paid||0),0))}</td>
            <td style="text-align:right">${money(totalPayout)}</td>
            <td></td>
          </tr></tfoot>`:''}
        </table>
        </div>

        ${sheet.comment?`<div style="margin-top:20px;padding:12px;background:rgba(13,20,40,.3);border-radius:12px;font-size:13px"><b>Комментарий:</b> ${esc(sheet.comment)}</div>`:''}
      `;
    }

    await layout(buildContent(), {title: sheet.title || 'Ведомость'});

    // Inline editing с дебаунсом
    let debounceTimers = {};
    document.querySelectorAll('.pi-field').forEach(input=>{
      input.addEventListener('input', e=>{
        const tr = e.target.closest('tr');
        const itemId = tr.dataset.itemId;
        if(!itemId) return;

        // Мгновенный пересчёт на клиенте
        const fields = {};
        tr.querySelectorAll('.pi-field').forEach(f=>{ fields[f.dataset.field] = Number(f.value)||0; });
        const base = fields.days_worked * fields.day_rate;
        const accrued = base + (fields.bonus||0);
        const payout = Math.max(0, accrued - (fields.penalty||0) - (fields.advance_paid||0));
        const payoutCell = tr.querySelector('.item-payout');
        if(payoutCell) payoutCell.textContent = money(payout);

        // Дебаунс API-вызов
        clearTimeout(debounceTimers[itemId]);
        debounceTimers[itemId] = setTimeout(async()=>{
          try{
            await api('/items/'+itemId, { method:'PUT', body: fields });
          }catch(err){ toast('Ошибка', err.message, 'error'); }
        }, 800);
      });
    });

    // Удаление строки
    document.querySelectorAll('[data-del-item]').forEach(btn=>{
      btn.addEventListener('click', async e=>{
        e.stopPropagation();
        const itemId = btn.dataset.delItem;
        if(!confirm('Удалить строку?')) return;
        try{
          await api('/items/'+itemId, {method:'DELETE'});
          toast('Удалено','','ok');
          await loadSheet(); await layout(buildContent(), {title: sheet.title}); bindSheetHandlers();
        }catch(err){ toast('Ошибка', err.message, 'error'); }
      });
    });

    bindSheetHandlers();

    function bindSheetHandlers(){
      // Inline editing rebind
      document.querySelectorAll('.pi-field').forEach(input=>{
        input.addEventListener('input', e=>{
          const tr = e.target.closest('tr');
          const itemId = tr.dataset.itemId;
          if(!itemId) return;
          const fields = {};
          tr.querySelectorAll('.pi-field').forEach(f=>{ fields[f.dataset.field] = Number(f.value)||0; });
          const base = fields.days_worked * fields.day_rate;
          const accrued = base + (fields.bonus||0);
          const payout = Math.max(0, accrued - (fields.penalty||0) - (fields.advance_paid||0));
          const payoutCell = tr.querySelector('.item-payout');
          if(payoutCell) payoutCell.textContent = money(payout);
          clearTimeout(debounceTimers[itemId]);
          debounceTimers[itemId] = setTimeout(async()=>{
            try{ await api('/items/'+itemId, { method:'PUT', body: fields }); }catch(err){}
          }, 800);
        });
      });

      document.querySelectorAll('[data-del-item]').forEach(btn=>{
        btn.addEventListener('click', async e=>{
          e.stopPropagation();
          if(!confirm('Удалить строку?')) return;
          try{
            await api('/items/'+btn.dataset.delItem, {method:'DELETE'});
            toast('Удалено','','ok');
            await loadSheet(); await layout(buildContent(), {title: sheet.title}); bindSheetHandlers();
          }catch(err){ toast('Ошибка', err.message, 'error'); }
        });
      });

      // Автозаполнение
      document.getElementById('btnAutoFill')?.addEventListener('click', async ()=>{
        try{
          const res = await api('/items/auto-fill', { method:'POST', body:{sheet_id: Number(sheetId)} });
          toast('Автозаполнение', `Добавлено ${res.filled}, пропущено ${res.skipped}`, 'ok');
          await loadSheet(); await layout(buildContent(), {title: sheet.title}); bindSheetHandlers();
        }catch(e){ toast('Ошибка', e.message, 'error'); }
      });

      // Пересчёт
      document.getElementById('btnRecalc')?.addEventListener('click', async ()=>{
        try{
          await api('/items/recalc', { method:'POST', body:{sheet_id: Number(sheetId)} });
          toast('Пересчитано', '', 'ok');
          await loadSheet(); await layout(buildContent(), {title: sheet.title}); bindSheetHandlers();
        }catch(e){ toast('Ошибка', e.message, 'error'); }
      });

      // На согласование
      document.getElementById('btnSubmit')?.addEventListener('click', async ()=>{
        if(!items.length){ toast('Ошибка','Добавьте строки начислений','error'); return; }
        if(!confirm('Отправить ведомость на согласование?')) return;
        try{
          await api('/sheets/'+sheetId+'/submit', {method:'PUT'});
          toast('Отправлено', 'Ведомость отправлена на согласование', 'ok');
          await loadSheet(); await layout(buildContent(), {title: sheet.title}); bindSheetHandlers();
        }catch(e){ toast('Ошибка', e.message, 'error'); }
      });

      // Согласовать
      document.getElementById('btnApprove')?.addEventListener('click', async ()=>{
        const total = money(items.reduce((s,x)=>s+Number(x.payout||0),0));
        if(!confirm('Согласовать ведомость на '+total+'?')) return;
        try{
          await api('/sheets/'+sheetId+'/approve', {method:'PUT'});
          toast('Согласовано', '', 'ok');
          await loadSheet(); await layout(buildContent(), {title: sheet.title}); bindSheetHandlers();
        }catch(e){ toast('Ошибка', e.message, 'error'); }
      });

      // На доработку
      document.getElementById('btnRework')?.addEventListener('click', async ()=>{
        const comment = prompt('Комментарий для доработки:');
        if(comment===null) return;
        try{
          await api('/sheets/'+sheetId+'/rework', {method:'PUT', body:{director_comment: comment}});
          toast('На доработку', '', 'ok');
          await loadSheet(); await layout(buildContent(), {title: sheet.title}); bindSheetHandlers();
        }catch(e){ toast('Ошибка', e.message, 'error'); }
      });

      // Оплата
      document.getElementById('btnPay')?.addEventListener('click', async ()=>{
        if(!confirm('Подтвердить оплату ведомости?')) return;
        try{
          const res = await api('/sheets/'+sheetId+'/pay', {method:'PUT'});
          toast('Оплачено', `Создано ${res.payments_created} записей реестра`, 'ok');
          await loadSheet(); await layout(buildContent(), {title: sheet.title}); bindSheetHandlers();
        }catch(e){ toast('Ошибка', e.message, 'error'); }
      });

      // Excel
      document.getElementById('btnExport')?.addEventListener('click', async ()=>{
        try{
          await api('/payments/export?sheet_id='+sheetId);
          toast('Скачано', 'Excel-файл загружен', 'ok');
        }catch(e){ toast('Ошибка', e.message, 'error'); }
      });

      // Удалить ведомость
      document.getElementById('btnDeleteSheet')?.addEventListener('click', async ()=>{
        if(!confirm('Удалить ведомость? Все строки будут удалены.')) return;
        try{
          await api('/sheets/'+sheetId, {method:'DELETE'});
          toast('Удалено','','ok');
          location.hash='#/payroll';
        }catch(e){ toast('Ошибка', e.message, 'error'); }
      });

      // Добавить строку
      document.getElementById('btnAddItem')?.addEventListener('click', ()=>{
        const activeEmps = employees.filter(e=>e.is_active!==false);
        showModal('Добавить рабочего', `
          <div class="formrow"><div>
            <label>Рабочий *</label>
            <select id="addItemEmp" style="width:100%;padding:8px;border-radius:10px;background:var(--bg2);border:1px solid var(--line);color:var(--text)">
              <option value="">Выберите...</option>
              ${activeEmps.map(e=>`<option value="${e.id}">${esc(e.fio||'')} ${e.role_tag?'('+esc(e.role_tag)+')':''}</option>`).join('')}
            </select>
          </div></div>
          <div class="formrow" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Дней</label><input type="number" id="addItemDays" value="0" min="0" max="31" style="width:100%;padding:8px;border-radius:10px;background:var(--bg2);border:1px solid var(--line);color:var(--text)"/></div>
            <div><label>Ставка (\u20BD/день)</label><input type="number" id="addItemRate" value="0" min="0" step="100" style="width:100%;padding:8px;border-radius:10px;background:var(--bg2);border:1px solid var(--line);color:var(--text)"/></div>
          </div>
          <div class="formrow" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Премия</label><input type="number" id="addItemBonus" value="0" min="0" step="100" style="width:100%;padding:8px;border-radius:10px;background:var(--bg2);border:1px solid var(--line);color:var(--text)"/></div>
            <div><label>Штраф</label><input type="number" id="addItemPenalty" value="0" min="0" step="100" style="width:100%;padding:8px;border-radius:10px;background:var(--bg2);border:1px solid var(--line);color:var(--text)"/></div>
          </div>
          <button class="btn primary" id="btnDoAddItem" style="margin-top:12px;width:100%">Добавить</button>
        `);

        // Автозаполнение ставки при выборе рабочего
        document.getElementById('addItemEmp')?.addEventListener('change', async e=>{
          const empId = e.target.value;
          if(!empId) return;
          try{
            const res = await api('/rates/current?employee_id='+empId);
            if(res.rate) document.getElementById('addItemRate').value = res.rate.day_rate;
            else{
              const emp = employees.find(x=>x.id==empId);
              if(emp?.day_rate) document.getElementById('addItemRate').value = emp.day_rate;
            }
          }catch(e){}
        });

        document.getElementById('btnDoAddItem')?.addEventListener('click', async ()=>{
          const empId = num(document.getElementById('addItemEmp')?.value);
          if(!empId){ toast('Ошибка','Выберите рабочего','error'); return; }
          try{
            await api('/items', { method:'POST', body:{
              sheet_id: Number(sheetId),
              employee_id: empId,
              days_worked: num(document.getElementById('addItemDays')?.value) || 0,
              day_rate: num(document.getElementById('addItemRate')?.value) || 0,
              bonus: num(document.getElementById('addItemBonus')?.value) || 0,
              penalty: num(document.getElementById('addItemPenalty')?.value) || 0
            }});
            hideModal();
            toast('Добавлено','','ok');
            await loadSheet(); await layout(buildContent(), {title: sheet.title}); bindSheetHandlers();
          }catch(e){ toast('Ошибка', e.message, 'error'); }
        });
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Экран 3: Самозанятые
  // ═══════════════════════════════════════════════════════════
  async function renderSelfEmployed({layout, title}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }

    let items = [];
    let searchQ = '';

    async function load(){
      try{
        const params = new URLSearchParams();
        if(searchQ) params.set('search', searchQ);
        const data = await api('/self-employed?' + params.toString());
        items = data.items || [];
      }catch(e){ toast('Ошибка', e.message, 'error'); items=[]; }
    }

    function buildContent(){
      return `${CSS}
        <div class="payroll-header">
          <h2 style="margin:0;font-size:22px">Реестр самозанятых</h2>
          <button class="btn primary" id="btnAddSE">+ Добавить СЗ</button>
        </div>

        <div class="payroll-filters">
          <input type="text" id="seSearch" placeholder="Поиск по ФИО / ИНН..." value="${esc(searchQ)}" style="min-width:250px"/>
        </div>

        <div id="seList">
          ${items.length===0 ? '<div style="text-align:center;color:var(--muted);padding:40px">Нет самозанятых</div>' :
            items.map(se=>{
              const statusColor = se.npd_status==='active' ? '#22c55e' : se.npd_status==='suspended' ? '#f59e0b' : '#ef4444';
              return `<div class="se-card">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
                  <div>
                    <div class="se-name">${esc(se.full_name)}</div>
                    <div class="se-inn">ИНН: ${esc(se.inn)}</div>
                  </div>
                  <span class="payroll-badge" style="background:${statusColor}22;color:${statusColor}">${esc(se.npd_status||'active')}</span>
                </div>
                <div style="margin-top:10px;font-size:13px;color:var(--muted);display:flex;gap:16px;flex-wrap:wrap">
                  ${se.phone?`<span>\u260E ${esc(se.phone)}</span>`:''}
                  ${se.bank_name?`<span>\uD83C\uDFE6 ${esc(se.bank_name)}</span>`:''}
                  ${se.account_number?`<span>****${esc(se.account_number.slice(-4))}</span>`:''}
                  ${se.contract_number?`<span>\u0413\u041F\u0425: \u2116${esc(se.contract_number)}${se.contract_date?' от '+fmtDate(se.contract_date):''}</span>`:''}
                </div>
                <div style="margin-top:10px;display:flex;gap:8px">
                  <button class="btn" style="font-size:12px;padding:4px 12px" data-edit-se="${se.id}">Редактировать</button>
                </div>
              </div>`;
            }).join('')}
        </div>`;
    }

    await load();
    await layout(buildContent(), {title: title||'Самозанятые'});
    bindSEHandlers();

    function bindSEHandlers(){
      let searchTimer;
      document.getElementById('seSearch')?.addEventListener('input', e=>{
        clearTimeout(searchTimer);
        searchTimer = setTimeout(async()=>{
          searchQ = e.target.value;
          await load();
          await layout(buildContent(), {title});
          bindSEHandlers();
        }, 500);
      });

      document.getElementById('btnAddSE')?.addEventListener('click', ()=>showSEModal());

      document.querySelectorAll('[data-edit-se]').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          const se = items.find(x=>x.id==btn.dataset.editSe);
          if(se) showSEModal(se);
        });
      });
    }

    function showSEModal(existing){
      const se = existing || {};
      let employees_list = [];
      try{ employees_list = employees || []; }catch(e){}

      showModal(existing?'Редактировать СЗ':'Добавить самозанятого', `
        <div class="formrow"><div>
          <label>ФИО *</label>
          <input id="seName" value="${esc(se.full_name||'')}" style="width:100%;padding:8px;border-radius:10px;background:var(--bg2);border:1px solid var(--line);color:var(--text)"/>
        </div></div>
        <div class="formrow" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div><label>ИНН * (12 цифр)</label><input id="seInn" value="${esc(se.inn||'')}" maxlength="12" style="width:100%;padding:8px;border-radius:10px;background:var(--bg2);border:1px solid var(--line);color:var(--text)"/></div>
          <div><label>Телефон</label><input id="sePhone" value="${esc(se.phone||'')}" placeholder="+7-XXX-XXX-XX-XX" style="width:100%;padding:8px;border-radius:10px;background:var(--bg2);border:1px solid var(--line);color:var(--text)"/></div>
        </div>
        <div class="formrow" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div><label>Банк</label><input id="seBank" value="${esc(se.bank_name||'')}" style="width:100%;padding:8px;border-radius:10px;background:var(--bg2);border:1px solid var(--line);color:var(--text)"/></div>
          <div><label>БИК</label><input id="seBik" value="${esc(se.bik||'')}" maxlength="9" style="width:100%;padding:8px;border-radius:10px;background:var(--bg2);border:1px solid var(--line);color:var(--text)"/></div>
        </div>
        <div class="formrow"><div>
          <label>Расчётный счёт</label>
          <input id="seAccount" value="${esc(se.account_number||'')}" maxlength="20" style="width:100%;padding:8px;border-radius:10px;background:var(--bg2);border:1px solid var(--line);color:var(--text)"/>
        </div></div>
        <div class="formrow" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div><label>\u2116 ГПХ</label><input id="seContract" value="${esc(se.contract_number||'')}" style="width:100%;padding:8px;border-radius:10px;background:var(--bg2);border:1px solid var(--line);color:var(--text)"/></div>
          <div><label>Дата ГПХ</label><input type="date" id="seContractDate" value="${(se.contract_date||'').slice(0,10)}" style="width:100%;padding:8px;border-radius:10px;background:var(--bg2);border:1px solid var(--line);color:var(--text)"/></div>
        </div>
        <div class="formrow"><div>
          <label>Комментарий</label>
          <textarea id="seComment" rows="2" style="width:100%;padding:8px;border-radius:10px;background:var(--bg2);border:1px solid var(--line);color:var(--text)">${esc(se.comment||'')}</textarea>
        </div></div>
        <button class="btn primary" id="btnSaveSE" style="margin-top:12px;width:100%">${existing?'Сохранить':'Добавить'}</button>
      `);

      document.getElementById('btnSaveSE')?.addEventListener('click', async ()=>{
        const inn = document.getElementById('seInn')?.value?.trim();
        const name = document.getElementById('seName')?.value?.trim();
        if(!name){ toast('Ошибка','Укажите ФИО','error'); return; }
        if(!inn || !/^\d{12}$/.test(inn)){ toast('Ошибка','ИНН должен содержать 12 цифр','error'); return; }

        const body = {
          full_name: name, inn,
          phone: document.getElementById('sePhone')?.value || null,
          bank_name: document.getElementById('seBank')?.value || null,
          bik: document.getElementById('seBik')?.value || null,
          account_number: document.getElementById('seAccount')?.value || null,
          contract_number: document.getElementById('seContract')?.value || null,
          contract_date: document.getElementById('seContractDate')?.value || null,
          comment: document.getElementById('seComment')?.value || null
        };

        try{
          if(existing){
            await api('/self-employed/'+existing.id, { method:'PUT', body });
          } else {
            await api('/self-employed', { method:'POST', body });
          }
          hideModal();
          toast(existing?'Сохранено':'Добавлено','','ok');
          await load();
          await layout(buildContent(), {title});
          bindSEHandlers();
        }catch(e){ toast('Ошибка', e.message, 'error'); }
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Экран 4: Разовые оплаты
  // ═══════════════════════════════════════════════════════════
  async function renderOneTimePay({layout, title}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }
    const user = auth.user;

    let currentTab = 'all';
    let items = [];
    let employees = [];
    let works = [];

    async function load(){
      try{
        const params = new URLSearchParams();
        if(currentTab !== 'all') params.set('status', currentTab);
        params.set('limit','200');
        const data = await api('/one-time?' + params.toString());
        items = data.items || [];
      }catch(e){ toast('Ошибка', e.message, 'error'); items=[]; }
      try{ employees = await AsgardDB.all('employees') || []; }catch(e){ employees=[]; }
      try{ works = await AsgardDB.all('works') || []; }catch(e){ works=[]; }
    }

    const isDirector = user.role==='ADMIN'||['DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'].includes(user.role);
    const canCreate = user.role==='ADMIN'||user.role==='PM'||user.role==='HEAD_PM'||isDirector;

    function buildContent(){
      const tabs = [
        {key:'all', label:'Все'},
        {key:'pending', label:'Ожидают'},
        {key:'approved', label:'Согласовано'},
        {key:'paid', label:'Оплачено'},
        {key:'rejected', label:'Отказ'}
      ];

      return `${CSS}
        <div class="payroll-header">
          <h2 style="margin:0;font-size:22px">Разовые оплаты</h2>
          ${canCreate?`<button class="btn primary" id="btnNewOTP">+ Запросить оплату</button>`:''}
        </div>

        <div class="payroll-tabs" id="otpTabs">
          ${tabs.map(t=>`<button class="payroll-tab${currentTab===t.key?' active':''}" data-tab="${t.key}">${esc(t.label)}</button>`).join('')}
        </div>

        <div id="otpList" style="margin-top:16px">
          ${items.length===0 ? '<div style="text-align:center;color:var(--muted);padding:40px">Нет разовых оплат</div>' :
            items.map(otp=>{
              const pt = PAYMENT_TYPES[otp.payment_type] || PAYMENT_TYPES.other;
              return `<div class="otp-card" data-status="${otp.status}">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
                  <div>
                    <b style="font-size:15px">${esc(otp.employee_name||'')}</b>
                    <span style="font-size:18px;font-weight:900;color:rgba(242,208,138,.95);margin-left:12px">${money(otp.amount)}</span>
                  </div>
                  ${badge(otp.status)}
                </div>
                <div style="margin-top:8px;font-size:13px;color:var(--muted)">
                  ${otp.work_title?`Работа: ${esc(otp.work_title)} &middot; `:''}
                  Тип: ${pt.icon} ${esc(pt.label)} &middot;
                  Запросил: ${esc(otp.requester_name||'')} &middot; ${fmtDate(otp.created_at)}
                </div>
                <div style="margin-top:6px;font-size:13px">${esc(otp.reason||'')}</div>
                ${otp.director_comment?`<div style="margin-top:6px;font-size:12px;color:#f59e0b">${esc(otp.director_comment)}</div>`:''}
                ${otp.status==='pending' && isDirector ? `
                  <div style="margin-top:10px;display:flex;gap:8px">
                    <button class="btn primary" style="font-size:12px" data-approve-otp="${otp.id}">Согласовать</button>
                    <button class="btn" style="font-size:12px;color:#ef4444" data-reject-otp="${otp.id}">Отклонить</button>
                  </div>
                ` : ''}
                ${otp.status==='approved' && (isDirector||user.role==='BUH') ? `
                  <div style="margin-top:10px">
                    <button class="btn primary" style="font-size:12px" data-pay-otp="${otp.id}">Оплачено</button>
                  </div>
                ` : ''}
              </div>`;
            }).join('')}
        </div>`;
    }

    await load();
    await layout(buildContent(), {title: title||'Разовые оплаты'});
    bindOTPHandlers();

    function bindOTPHandlers(){
      document.getElementById('otpTabs')?.addEventListener('click', async e=>{
        const tab = e.target.closest('.payroll-tab');
        if(!tab) return;
        currentTab = tab.dataset.tab;
        await load();
        await layout(buildContent(), {title});
        bindOTPHandlers();
      });

      document.getElementById('btnNewOTP')?.addEventListener('click', ()=>{
        const activeEmps = employees.filter(e=>e.is_active!==false);
        const myWorks = user.role==='PM' ? works.filter(w=>w.pm_id==user.id||w.created_by==user.id) : works;

        showModal('Запросить разовую оплату', `
          <div class="formrow"><div>
            <label>Рабочий *</label>
            <select id="otpEmp" style="width:100%;padding:8px;border-radius:10px;background:var(--bg2);border:1px solid var(--line);color:var(--text)">
              <option value="">Выберите...</option>
              ${activeEmps.map(e=>`<option value="${e.id}">${esc(e.fio||'')}</option>`).join('')}
            </select>
          </div></div>
          <div class="formrow" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Сумма * (\u20BD)</label><input type="number" id="otpAmount" min="0" step="100" style="width:100%;padding:8px;border-radius:10px;background:var(--bg2);border:1px solid var(--line);color:var(--text)"/></div>
            <div><label>Тип</label>
              <select id="otpType" style="width:100%;padding:8px;border-radius:10px;background:var(--bg2);border:1px solid var(--line);color:var(--text)">
                ${Object.entries(PAYMENT_TYPES).map(([k,v])=>`<option value="${k}">${v.icon} ${v.label}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="formrow"><div>
            <label>Работа</label>
            <select id="otpWork" style="width:100%;padding:8px;border-radius:10px;background:var(--bg2);border:1px solid var(--line);color:var(--text)">
              <option value="">Без привязки</option>
              ${myWorks.map(w=>`<option value="${w.id}">${esc((w.customer_name||'')+ ' \u2014 '+(w.work_title||''))}</option>`).join('')}
            </select>
          </div></div>
          <div class="formrow"><div>
            <label>Причина / описание *</label>
            <textarea id="otpReason" rows="2" style="width:100%;padding:8px;border-radius:10px;background:var(--bg2);border:1px solid var(--line);color:var(--text)"></textarea>
          </div></div>
          <button class="btn primary" id="btnDoOTP" style="margin-top:12px;width:100%">Запросить</button>
        `);

        document.getElementById('btnDoOTP')?.addEventListener('click', async ()=>{
          const empId = num(document.getElementById('otpEmp')?.value);
          const amount = num(document.getElementById('otpAmount')?.value);
          const reason = document.getElementById('otpReason')?.value?.trim();
          if(!empId){ toast('Ошибка','Выберите рабочего','error'); return; }
          if(!amount || amount<=0){ toast('Ошибка','Укажите сумму','error'); return; }
          if(!reason){ toast('Ошибка','Укажите причину','error'); return; }

          try{
            await api('/one-time', { method:'POST', body:{
              employee_id: empId, amount, reason,
              work_id: num(document.getElementById('otpWork')?.value),
              payment_type: document.getElementById('otpType')?.value || 'one_time'
            }});
            hideModal();
            toast('Запрос создан','Ожидает согласования','ok');
            await load(); await layout(buildContent(), {title}); bindOTPHandlers();
          }catch(e){ toast('Ошибка', e.message, 'error'); }
        });
      });

      // Согласовать
      document.querySelectorAll('[data-approve-otp]').forEach(btn=>{
        btn.addEventListener('click', async e=>{
          e.stopPropagation();
          if(!confirm('Согласовать оплату?')) return;
          try{
            await api('/one-time/'+btn.dataset.approveOtp+'/approve', {method:'PUT'});
            toast('Согласовано','','ok');
            await load(); await layout(buildContent(), {title}); bindOTPHandlers();
          }catch(e){ toast('Ошибка', e.message, 'error'); }
        });
      });

      // Отклонить
      document.querySelectorAll('[data-reject-otp]').forEach(btn=>{
        btn.addEventListener('click', async e=>{
          e.stopPropagation();
          const comment = prompt('Причина отклонения:');
          if(comment===null) return;
          try{
            await api('/one-time/'+btn.dataset.rejectOtp+'/reject', {method:'PUT', body:{director_comment:comment}});
            toast('Отклонено','','ok');
            await load(); await layout(buildContent(), {title}); bindOTPHandlers();
          }catch(e){ toast('Ошибка', e.message, 'error'); }
        });
      });

      // Оплачено
      document.querySelectorAll('[data-pay-otp]').forEach(btn=>{
        btn.addEventListener('click', async e=>{
          e.stopPropagation();
          if(!confirm('Подтвердить оплату?')) return;
          try{
            await api('/one-time/'+btn.dataset.payOtp+'/pay', {method:'PUT'});
            toast('Оплачено','','ok');
            await load(); await layout(buildContent(), {title}); bindOTPHandlers();
          }catch(e){ toast('Ошибка', e.message, 'error'); }
        });
      });
    }
  }

  return { render, renderSheet, renderSelfEmployed, renderOneTimePay };
})();
