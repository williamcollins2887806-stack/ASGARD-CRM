window.AsgardPayrollDashboard=(function(){
  'use strict';
  const { $, $$, esc, toast, showModal, closeModal } = AsgardUI;
  const isDirRole = (r)=> (window.AsgardAuth&&AsgardAuth.isDirectorRole)?AsgardAuth.isDirectorRole(r):(String(r||"").startsWith("DIRECTOR"));
  const fmt = (n)=> n==null?'—': new Intl.NumberFormat('ru-RU').format(Math.round(n));
  const fmtR = (n)=> fmt(n)+' ₽';

  const STATUS_MAP = {
    planned:    {label:'Запланировано', bg:'var(--bg4)',    color:'var(--t2)'},
    transferred:{label:'Переведено',   bg:'var(--info-bg)',color:'var(--info-t)'},
    returned:   {label:'Возврат получен',bg:'var(--gold-bg)',color:'var(--gold)'},
    completed:  {label:'Завершено',    bg:'var(--ok-bg)',  color:'var(--ok-t)'},
    cancelled:  {label:'Отменено',     bg:'var(--bg3)',    color:'var(--t3)'}
  };
  const OP_TYPE_MAP = {
    work_transfer:     'За работу',
    agreement_transfer:'По договорённости'
  };

  async function render({layout, title}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }
    const user = auth.user, token = auth.token;
    const ALLOWED = ["ADMIN","DIRECTOR_GEN","DIRECTOR_COMM","BUH"];
    if(!(ALLOWED.includes(user.role) || isDirRole(user.role))){
      toast("Доступ","Недостаточно прав","err"); location.hash="#/home"; return;
    }
    // Менять лимиты может только ADMIN/DIRECTOR_GEN (как в backend admin-system.js)
    const canEditLimits = ["ADMIN","DIRECTOR_GEN","DIRECTOR_COMM","DIRECTOR_DEV","BUH"].includes(user.role);

    const now = new Date();
    let curYear = now.getFullYear(), curMonth = now.getMonth()+1;

    const html = `
      <div class="panel">
        <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px">
          <div style="display:flex;align-items:center;gap:8px">
            <button class="btn ghost" id="pd_prev">◀</button>
            <span id="pd_period" style="font-size:16px;font-weight:600;color:var(--t1);min-width:160px;text-align:center"></span>
            <button class="btn ghost" id="pd_next">▶</button>
          </div>
          <button class="btn ghost" id="pd_refresh">🔄 Обновить</button>
        </div>

        <div id="pd_cards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:20px"></div>

        <!-- Phase 1E (2026-06-20) — Карточка «🏦 КАССА»: хватит ли нала на ЗП -->
        <div id="pd_cash_box" style="margin-bottom:20px"></div>

        <h3 style="color:var(--t1);margin:0 0 12px">Расчёт кассы</h3>
        <div id="pd_cc_tabs" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
          <button class="btn ghost cc-tab" data-cctab="all">Все</button>
          <button class="btn ghost cc-tab" data-cctab="self_employed">Самозанятые</button>
          <button class="btn ghost cc-tab" data-cctab="official">Официальные</button>
          <button class="btn ghost cc-tab" data-cctab="cash">Наличка</button>
        </div>
        <div class="tablewrap" style="margin-bottom:20px">
          <table class="asg" id="pd_cc_table">
            <thead><tr>
              <th>Рабочий</th><th>Тип оплаты</th><th>Заработал</th><th>Переводим</th><th>Возврат в кассу</th><th>Из кассы</th>
            </tr></thead>
            <tbody id="pd_cc_body"></tbody>
            <tfoot id="pd_cc_foot"></tfoot>
          </table>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="color:var(--t1);margin:0">Операции с самозанятыми</h3>
          <div style="display:flex;gap:8px">
            <div id="pd_filter_wrap" style="min-width:180px"></div>
            <button class="btn primary" id="pd_add_agreement">+ По договорённости</button>
          </div>
        </div>
        <div class="tablewrap" style="margin-bottom:20px">
          <table class="asg" id="pd_transfers_table">
            <thead><tr>
              <th>ФИО</th><th>Тип</th><th>Заработал</th><th>Перевели</th><th>Возврат</th><th>Статус</th><th></th>
            </tr></thead>
            <tbody id="pd_transfers_body"></tbody>
          </table>
          <div id="pd_transfers_totals" style="padding:8px 12px;background:var(--bg2);border-radius:0 0 var(--r-md) var(--r-md);display:flex;gap:20px;font-size:13px;color:var(--t2)"></div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="color:var(--t1);margin:0">Годовые лимиты самозанятых</h3>
          ${canEditLimits ? '<button class="btn ghost" id="pd_edit_limits">⚙️ Изменить лимиты</button>' : ''}
        </div>
        <div class="tablewrap">
          <table class="asg" id="pd_limits_table">
            <thead><tr>
              <th>ФИО</th><th>Переведено за год</th><th>Годовой лимит</th><th>Остаток</th><th>Прогресс</th>
            </tr></thead>
            <tbody id="pd_limits_body"></tbody>
          </table>
        </div>
      </div>
    `;
    await layout(html, {title: title || "Финансы персонала"});

    // Phase 1E (2026-06-20) — стили для «🏦 Касса» (inject один раз)
    if(!document.getElementById('pdcash-styles')){
      const s = document.createElement('style');
      s.id = 'pdcash-styles';
      s.textContent = `
        .pdcash {
          padding: 14px 16px; border-radius: var(--r-md, 8px);
          border: 1px solid; display: flex; flex-direction: column; gap: 10px;
        }
        .pdcash-title { font-size: 14px; font-weight: 700; }
        .pdcash-grid { display: grid; gap: 16px; grid-template-columns: 1fr 1fr; }
        .pdcash-col { display: flex; flex-direction: column; gap: 4px; }
        .pdcash-row {
          display: flex; justify-content: space-between; align-items: baseline;
          font-size: 12px; gap: 8px;
        }
        .pdcash-row-sep {
          margin-top: 4px; padding-top: 6px;
          border-top: 1px dashed currentColor;
        }
        .pdcash-label { opacity: 0.78; }
        .pdcash-label-bold { font-weight: 700; opacity: 1; }
        .pdcash-num { font-variant-numeric: tabular-nums; font-weight: 600; }
        .pdcash-num-bold { font-weight: 800; font-size: 14px; }
        .pdcash-num-mut { opacity: 0.75; }
        .pdcash-diff-neg { color: #C62828; }
        .pdcash-diff-pos { color: #2E7D32; }
        .pdcash-diff-zero { opacity: 0.7; }
        html[data-theme="dark"] .pdcash-diff-neg { color: #EF9A9A; }
        html[data-theme="dark"] .pdcash-diff-pos { color: #A5D6A7; }
        .pdcash-pct {
          font-size: 11px; font-weight: 700;
          margin-top: 3px; opacity: 0.78; text-align: right;
        }
        .pdcash-bar {
          height: 10px; border-radius: 999px;
          background: var(--bg3, #eee); overflow: hidden;
          border: 1px solid var(--brd, #ccc);
        }
        .pdcash-bar-fill {
          height: 100%; border-radius: 999px;
          transition: width 240ms ease;
        }
        .pdcash-bar-fill.cash-status-ok,
        .pdcash-bar-fill.cash-status-ok_with_returns {
          background: linear-gradient(90deg, #A5D6A7, #66BB6A);
        }
        .pdcash-bar-fill.cash-status-tight {
          background: linear-gradient(90deg, #FFE082, #FFB300);
        }
        .pdcash-bar-fill.cash-status-shortage {
          background: linear-gradient(90deg, #EF9A9A, #E57373);
        }
        /* 2026-06-20 — парность для тёмной темы (на тёмном фоне нужны более насыщенные оттенки) */
        html[data-theme="dark"] .pdcash-bar-fill.cash-status-ok,
        html[data-theme="dark"] .pdcash-bar-fill.cash-status-ok_with_returns {
          background: linear-gradient(90deg, #66BB6A, #43A047);
        }
        html[data-theme="dark"] .pdcash-bar-fill.cash-status-tight {
          background: linear-gradient(90deg, #FFB300, #F57F17);
        }
        html[data-theme="dark"] .pdcash-bar-fill.cash-status-shortage {
          background: linear-gradient(90deg, #E57373, #C62828);
        }
        .pdcash-action { font-size: 13px; font-weight: 700; padding: 6px 0; }
        .pdcash-action-bad { color: #B71C1C; }
        .pdcash-action-good { color: #1B5E20; }
        html[data-theme="dark"] .pdcash-action-bad { color: #EF9A9A; }
        html[data-theme="dark"] .pdcash-action-good { color: #A5D6A7; }
        .pdcash-advances {
          font-size: 12px; opacity: 0.82;
          padding-top: 6px; border-top: 1px dashed currentColor;
        }
        .pdcash.cash-status-ok              { background: #E8F5E9; color: #1B5E20; border-color: #66BB6A; }
        .pdcash.cash-status-ok_with_returns { background: #F1F8E9; color: #33691E; border-color: #9CCC65; }
        .pdcash.cash-status-tight           { background: #FFF8E1; color: #E65100; border-color: #FFB300; }
        .pdcash.cash-status-shortage        { background: #FFEBEE; color: #B71C1C; border-color: #E57373; }
        html[data-theme="dark"] .pdcash.cash-status-ok {
          background: rgba(76,175,80,0.10); color: #A5D6A7; border-color: rgba(76,175,80,0.40);
        }
        html[data-theme="dark"] .pdcash.cash-status-ok_with_returns {
          background: rgba(124,179,66,0.10); color: #C5E1A5; border-color: rgba(124,179,66,0.40);
        }
        html[data-theme="dark"] .pdcash.cash-status-tight {
          background: rgba(255,179,0,0.10); color: #FFE082; border-color: rgba(255,179,0,0.40);
        }
        html[data-theme="dark"] .pdcash.cash-status-shortage {
          background: rgba(229,115,115,0.12); color: #EF9A9A; border-color: rgba(229,115,115,0.45);
        }
        @media (max-width: 720px) {
          .pdcash-grid { grid-template-columns: 1fr; }
        }
      `;
      document.head.appendChild(s);
    }

    // Filter
    let filterType = '';
    if(window.CRSelect){
      $('#pd_filter_wrap').appendChild(CRSelect.create({
        id:'pd_filter', placeholder:'Все операции', clearable:true,
        options:[{value:'',label:'Все'},{value:'work_transfer',label:'За работу'},{value:'agreement_transfer',label:'По договорённости'}],
        onChange:()=>{ filterType = CRSelect.getValue('pd_filter')||''; loadTransfers(); }
      }));
    }

    function updatePeriod(){
      const el = $('#pd_period');
      if(el) el.textContent = new Date(curYear, curMonth-1).toLocaleString('ru-RU',{month:'long',year:'numeric'});
    }

    async function apiFetch(url){
      const resp = await fetch(url, {headers:{'Authorization':'Bearer '+token}});
      if(!resp.ok) throw new Error('HTTP '+resp.status);
      return resp.json();
    }
    async function apiPost(url, body){
      const resp = await fetch(url, {
        method:'POST', headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
        body:JSON.stringify(body)
      });
      if(!resp.ok){
        const err = await resp.json().catch(()=>({}));
        throw new Error(err.error||'Ошибка');
      }
      return resp.json();
    }
    async function apiPut(url, body){
      const resp = await fetch(url, {
        method:'PUT',
        headers:{'Authorization':'Bearer '+token, ...(body!==undefined?{'Content-Type':'application/json'}:{})},
        ...(body!==undefined?{body:JSON.stringify(body)}:{})
      });
      if(!resp.ok){
        const err = await resp.json().catch(()=>({}));
        throw new Error(err.error||'Ошибка');
      }
      return resp.json();
    }

    async function loadSummary(){
      try{
        const data = await apiFetch(`/api/payroll-dashboard/summary/${curYear}/${curMonth}`);
        $('#pd_cards').innerHTML = `
          <div style="padding:16px;background:var(--ok-bg);border-radius:var(--r-md)">
            <div style="font-size:13px;color:var(--ok-t);opacity:.8">Заработано всего</div>
            <div style="font-size:22px;font-weight:700;color:var(--ok-t)">${fmtR(data.total_earned||0)}</div>
          </div>
          <div style="padding:16px;background:var(--info-bg);border-radius:var(--r-md)">
            <div style="font-size:13px;color:var(--info-t);opacity:.8">К переводу (СЗ)</div>
            <div style="font-size:22px;font-weight:700;color:var(--info-t)">${fmtR(data.total_transfer||0)}</div>
          </div>
          <div style="padding:16px;background:var(--warn-bg);border-radius:var(--r-md)">
            <div style="font-size:13px;color:var(--warn-t);opacity:.8">Из кассы</div>
            <div style="font-size:22px;font-weight:700;color:var(--warn-t)">${fmtR(data.total_cash_needed||0)}</div>
          </div>
          <div style="padding:16px;background:var(--gold-bg);border-radius:var(--r-md)">
            <div style="font-size:13px;color:var(--gold);opacity:.8">Возврат в кассу</div>
            <div style="font-size:22px;font-weight:700;color:var(--gold)">${fmtR(data.total_cash_return||0)}</div>
          </div>
        `;
      }catch(e){
        toast("Ошибка","Не удалось загрузить сводку","err");
      }
    }

    // Phase 1E (2026-06-20) — «🏦 Касса» (хватит ли нала на ЗП)
    async function loadCashCoverage(){
      const box = $('#pd_cash_box');
      if(!box) return;
      let cc = null;
      try{
        cc = await apiFetch(`/api/payroll-dashboard/cash-coverage/${curYear}/${curMonth}`);
      }catch(_){
        box.innerHTML = '';
        return;
      }
      box.innerHTML = renderCashCoverage(cc);
    }

    function renderCashCoverage(cc){
      if(!cc) return '';
      const balance   = Number(cc.cash_balance||0);
      const needed    = Number(cc.cash_needed||0);
      const pending   = Number(cc.pending_returns||0);
      const effective = Number(cc.effective_balance != null ? cc.effective_balance : (balance + pending));
      const diff      = Number(cc.diff != null ? cc.diff : (effective - needed));
      const pct       = Number(cc.coverage_pct != null ? cc.coverage_pct : (needed>0 ? Math.round(effective/needed*100) : 100));
      const advSum    = Number(cc.advances_outstanding||0);
      const advCnt    = Number(cc.advances_count||0);
      const status    = cc.status || 'ok';
      const statusLb  = cc.status_label || '';

      const cls = `cash-status-${status}`;
      const icon = status==='ok' ? '✅'
                 : status==='ok_with_returns' ? '🟢'
                 : status==='tight' ? '⚠'
                 : '❌';

      const barPct = Math.min(100, Math.max(0, pct));
      const diffSign = diff<0 ? '−' : (diff>0 ? '+' : '');
      const diffAbs = Math.abs(diff);
      const diffCls = diff<0 ? 'pdcash-diff-neg' : (diff>0 ? 'pdcash-diff-pos' : 'pdcash-diff-zero');

      const advPlural = advCnt===1 ? 'заявка' : (advCnt<5 ? 'заявки' : 'заявок');
      const advRow = advSum>0 ? `<div class="pdcash-advances">💡 Дополнительно — <b>${fmtR(advSum)}</b> выданы РП на руках (${advCnt} ${advPlural})</div>` : '';

      const action = diff<0
        ? `<div class="pdcash-action pdcash-action-bad">${icon} ${esc(statusLb)} — нужно пополнить ${fmtR(diffAbs)}</div>`
        : `<div class="pdcash-action pdcash-action-good">${icon} ${esc(statusLb)}</div>`;

      return `<div class="pdcash ${cls}">
        <div class="pdcash-title">🏦 Касса — есть ли деньги на ЗП?</div>
        <div class="pdcash-grid">
          <div class="pdcash-col">
            <div class="pdcash-row"><span class="pdcash-label">В кассе:</span><span class="pdcash-num">${fmtR(balance)}</span></div>
            <div class="pdcash-row"><span class="pdcash-label">+ Ожидается возвратов:</span><span class="pdcash-num pdcash-num-mut">${fmtR(pending)}</span></div>
            <div class="pdcash-row pdcash-row-sep">
              <span class="pdcash-label pdcash-label-bold">= Эффективно:</span>
              <span class="pdcash-num pdcash-num-bold">${fmtR(effective)}</span>
            </div>
          </div>
          <div class="pdcash-col">
            <div class="pdcash-row"><span class="pdcash-label">Нужно на ЗП:</span><span class="pdcash-num">${fmtR(needed)}</span></div>
            <div class="pdcash-row pdcash-row-sep">
              <span class="pdcash-label pdcash-label-bold">${diff<0?'Дефицит:':'Профицит:'}</span>
              <span class="pdcash-num pdcash-num-bold ${diffCls}">${diffSign}${fmtR(diffAbs)}</span>
            </div>
            <div class="pdcash-pct">${pct}% покрыто</div>
          </div>
        </div>
        <div class="pdcash-bar"><div class="pdcash-bar-fill ${cls}" style="width:${barPct}%"></div></div>
        ${action}
        ${advRow}
      </div>`;
    }

    // ─── Расчёт кассы (4 вкладки) ───────────────────────────────
    const PAY_TYPE_LABEL = {
      self_employed: {label:'Самозанятый', bg:'var(--info-bg)', color:'var(--info-t)'},
      official:      {label:'Официальный', bg:'var(--gold-bg)', color:'var(--gold)'},
      cash:          {label:'Наличка',     bg:'var(--ok-bg)',   color:'var(--ok-t)'}
    };
    let ccTab = 'all';
    let ccData = null;

    async function loadCashCalc(){
      try{
        ccData = await apiFetch(`/api/payroll-dashboard/cash-calc/${curYear}/${curMonth}`);
      }catch(e){
        ccData = null;
        toast("Ошибка","Не удалось загрузить расчёт кассы","err");
      }
      renderCashCalc();
    }

    function renderCashCalc(){
      // подсветка активной вкладки
      $$('.cc-tab').forEach(b=>{
        const active = b.dataset.cctab===ccTab;
        b.classList.toggle('primary', active);
        b.classList.toggle('ghost', !active);
      });
      const tbody = $('#pd_cc_body'), tfoot = $('#pd_cc_foot');
      if(!tbody) return;
      const items = (ccData && ccData.items) ? ccData.items : [];
      const list = ccTab==='all' ? items : items.filter(i=>i.pay_type===ccTab);
      if(!list.length){
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--t3);padding:20px">Нет данных за период</td></tr>';
        if(tfoot) tfoot.innerHTML = '';
        return;
      }
      tbody.innerHTML = list.map(i=>{
        const pt = PAY_TYPE_LABEL[i.pay_type] || {label:i.pay_type,bg:'var(--bg3)',color:'var(--t2)'};
        return `<tr>
          <td><b>${esc(i.fio||'—')}</b></td>
          <td><span style="padding:3px 8px;border-radius:var(--r-sm);background:${pt.bg};color:${pt.color};font-size:12px;font-weight:600">${pt.label}</span></td>
          <td>${fmtR(i.earned||0)}</td>
          <td style="font-weight:600">${fmtR(i.transfer||0)}</td>
          <td style="color:var(--gold)">${i.cash_return?fmtR(i.cash_return):'—'}</td>
          <td style="color:var(--warn-t);font-weight:600">${i.cash_payout?fmtR(i.cash_payout):'—'}</td>
        </tr>`;
      }).join('');
      // ИТОГО по текущей вкладке
      const sum = list.reduce((a,i)=>({
        earned:a.earned+(i.earned||0), transfer:a.transfer+(i.transfer||0),
        cash_return:a.cash_return+(i.cash_return||0), cash_payout:a.cash_payout+(i.cash_payout||0)
      }), {earned:0,transfer:0,cash_return:0,cash_payout:0});
      const netCash = sum.cash_return - sum.cash_payout;
      const netColor = netCash>=0 ? 'var(--ok-t)' : 'var(--err-t)';
      if(tfoot){
        tfoot.innerHTML = `
          <tr style="background:var(--bg2);font-weight:700">
            <td colspan="2">ИТОГО</td>
            <td>${fmtR(sum.earned)}</td>
            <td>${fmtR(sum.transfer)}</td>
            <td style="color:var(--gold)">${fmtR(sum.cash_return)}</td>
            <td style="color:var(--warn-t)">${fmtR(sum.cash_payout)}</td>
          </tr>
          <tr style="background:var(--bg2)">
            <td colspan="6" style="color:${netColor};font-weight:700;font-size:14px">
              ИТОГО В КАССЕ (возврат − выдача): ${fmtR(netCash)}
            </td>
          </tr>`;
      }
    }

    $$('.cc-tab').forEach(b=>{
      b.addEventListener('click', ()=>{ ccTab = b.dataset.cctab; renderCashCalc(); });
    });

    async function loadTransfers(){
      try{
        const data = await apiFetch(`/api/payroll-dashboard/se-transfers/${curYear}/${curMonth}`);
        let list = data.transfers || data || [];
        if(filterType) list = list.filter(t=>t.operation_type===filterType);

        const tbody = $('#pd_transfers_body');
        if(!list.length){
          tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--t3);padding:20px">Нет операций за период</td></tr>';
          $('#pd_transfers_totals').innerHTML = '';
          return;
        }

        tbody.innerHTML = list.map(t=>{
          const st = STATUS_MAP[t.status]||STATUS_MAP.planned;
          const canConfirmReturn = t.status==='transferred';
          return `<tr>
            <td><b>${esc(t.fio||t.employee_name||'—')}</b></td>
            <td>${esc(OP_TYPE_MAP[t.operation_type]||t.operation_type)}</td>
            <td>${fmtR(t.earned_amount||0)}</td>
            <td style="font-weight:600">${fmtR(t.transfer_amount||0)}</td>
            <td>${fmtR(t.cash_return_amount||0)}</td>
            <td><span style="padding:3px 8px;border-radius:var(--r-sm);background:${st.bg};color:${st.color};font-size:12px;font-weight:600">${st.label}</span></td>
            <td>${canConfirmReturn?`<button class="btn mini" data-confirm-return="${t.id}">✅ Наличные получены</button>`:''}</td>
          </tr>`;
        }).join('');

        const totalTransfer = list.reduce((s,t)=>s+(t.transfer_amount||0),0);
        const totalReturn = list.reduce((s,t)=>s+(t.cash_return_amount||0),0);
        $('#pd_transfers_totals').innerHTML = `
          <span>Переводов: <b>${list.length}</b></span>
          <span>Сумма переводов: <b>${fmtR(totalTransfer)}</b></span>
          <span>Сумма возвратов: <b>${fmtR(totalReturn)}</b></span>
        `;

        // Confirm return handlers
        tbody.querySelectorAll('[data-confirm-return]').forEach(btn=>{
          btn.addEventListener('click', async ()=>{
            const id = btn.dataset.confirmReturn;
            if(!await AsgardUI.confirm('Подтвердить получение наличных?')) return;
            try{
              await apiPut(`/api/payroll-dashboard/se-transfers/${id}/confirm-return`);
              toast("Готово","Возврат подтверждён","ok");
              await refreshAll();
            }catch(e){ toast("Ошибка",e.message,"err"); }
          });
        });
      }catch(e){
        toast("Ошибка","Не удалось загрузить операции","err");
      }
    }

    async function loadLimits(){
      try{
        const data = await apiFetch('/api/payroll-dashboard/self-employed-limits');
        const list = data.limits || data || [];
        const tbody = $('#pd_limits_body');
        if(!list.length){
          tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--t3);padding:20px">Нет самозанятых</td></tr>';
          return;
        }
        const monthlyLimit = data.monthly_limit || 350000;
        tbody.innerHTML = list.map(w=>{
          const yearly = w.yearly_limit || 2400000;
          const used = w.yearly_transferred || 0;
          const remaining = Math.max(0, yearly - used);
          const pct = Math.min(100, Math.round(used/yearly*100));
          const isLow = remaining < monthlyLimit * 2;
          const barColor = isLow ? 'var(--err)' : 'var(--ok)';
          return `<tr${isLow?' style="background:var(--err-bg)"':''}>
            <td><b>${esc(w.fio||'—')}</b></td>
            <td>${fmtR(used)}</td>
            <td>${fmtR(yearly)}</td>
            <td style="color:${isLow?'var(--err-t)':'var(--ok-t)'};font-weight:600">${fmtR(remaining)}</td>
            <td style="min-width:120px">
              <div style="background:var(--bg3);border-radius:var(--r-sm);height:8px;overflow:hidden">
                <div style="background:${barColor};height:100%;width:${pct}%;transition:width .3s"></div>
              </div>
              <div style="font-size:10px;color:var(--t3);margin-top:2px">${pct}%</div>
            </td>
          </tr>`;
        }).join('');
      }catch(e){
        toast("Ошибка","Не удалось загрузить лимиты","err");
      }
    }

    // Agreement transfer modal
    $('#pd_add_agreement').addEventListener('click', async ()=>{
      try{
        const limitsData = await apiFetch('/api/payroll-dashboard/self-employed-limits');
        const seWorkers = (limitsData.limits || limitsData || []).filter(w=>w.is_self_employed);
        const monthlyLimit = limitsData.monthly_limit || 350000;

        const opts = seWorkers.map(w=>`<option value="${w.employee_id}">${esc(w.fio||'—')} (остаток: ${fmtR(Math.max(0,(w.yearly_limit||2400000)-(w.yearly_transferred||0)))})</option>`).join('');

        const body = `
          <div class="formrow">
            <div style="grid-column:1/-1">
              <label>Рабочий (самозанятый)</label>
              <select id="at_employee">
                <option value="">Выберите...</option>${opts}
              </select>
            </div>
            <div>
              <label>Сумма перевода</label>
              <input id="at_amount" type="number" value="${monthlyLimit}"/>
            </div>
            <div style="grid-column:1/-1">
              <label>Комментарий</label>
              <textarea id="at_comment" rows="2" placeholder="По договорённости"></textarea>
            </div>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
            <button class="btn ghost" id="at_cancel">Отмена</button>
            <button class="btn primary" id="at_save">Создать перевод</button>
          </div>
        `;
        showModal('Перевод по договорённости', body);

        $('#at_cancel').addEventListener('click', ()=>closeModal());
        $('#at_save').addEventListener('click', async ()=>{
          const empId = Number($('#at_employee').value);
          const amount = Number($('#at_amount').value);
          const comment = ($('#at_comment').value||'').trim();
          if(!empId){ toast("Проверка","Выберите рабочего","err"); return; }
          if(!amount || amount<=0){ toast("Проверка","Укажите сумму","err"); return; }
          try{
            await apiPost('/api/payroll-dashboard/se-transfers', {
              employee_id: empId,
              year: curYear,
              month: curMonth,
              operation_type: 'agreement_transfer',
              transfer_amount: amount,
              earned_amount: 0,
              work_id: null,
              comment: comment || 'По договорённости'
            });
            closeModal();
            toast("Готово","Перевод создан","ok");
            await refreshAll();
          }catch(e){
            toast("Ошибка", e.message, "err");
          }
        });
      }catch(e){
        toast("Ошибка","Не удалось загрузить данные","err");
      }
    });

    // Редактирование финансовых лимитов СЗ (ADMIN/DIRECTOR_GEN)
    if(canEditLimits){
      const editBtn = $('#pd_edit_limits');
      if(editBtn) editBtn.addEventListener('click', async ()=>{
        let cur = { monthly: 350000, yearly: 2400000 };
        try{ cur = await apiFetch('/api/admin/system/settings/finance-limits'); }catch(e){ /* дефолты */ }
        const body = `
          <div class="formrow">
            <div>
              <label>Месячный лимит на самозанятого (₽)</label>
              <input id="fl_monthly" type="number" min="0" step="1000" value="${Number(cur.monthly)||350000}"/>
            </div>
            <div>
              <label>Годовой лимит на самозанятого (₽)</label>
              <input id="fl_yearly" type="number" min="0" step="10000" value="${Number(cur.yearly)||2400000}"/>
            </div>
          </div>
          <div style="font-size:12px;color:var(--t3);margin-top:8px">Применяется ко всем самозанятым при расчёте остатка лимита.</div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
            <button class="btn ghost" id="fl_cancel">Отмена</button>
            <button class="btn primary" id="fl_save">Сохранить</button>
          </div>
        `;
        showModal('Финансовые лимиты самозанятых', body);
        $('#fl_cancel').addEventListener('click', ()=>closeModal());
        $('#fl_save').addEventListener('click', async ()=>{
          const monthly = Number($('#fl_monthly').value);
          const yearly  = Number($('#fl_yearly').value);
          if(!Number.isFinite(monthly) || monthly < 0){ toast("Проверка","Месячный лимит — число ≥ 0","err"); return; }
          if(!Number.isFinite(yearly) || yearly < 0){ toast("Проверка","Годовой лимит — число ≥ 0","err"); return; }
          try{
            await apiPut('/api/admin/system/settings/finance-limits', { monthly, yearly });
            closeModal();
            toast("Готово","Лимиты сохранены","ok");
            await loadLimits();
          }catch(e){ toast("Ошибка", e.message, "err"); }
        });
      });
    }

    async function refreshAll(){
      updatePeriod();
      await Promise.all([loadSummary(), loadCashCoverage(), loadCashCalc(), loadTransfers(), loadLimits()]);
    }

    // Navigation
    $('#pd_prev').addEventListener('click', ()=>{ curMonth--; if(curMonth<1){curMonth=12;curYear--;} refreshAll(); });
    $('#pd_next').addEventListener('click', ()=>{ curMonth++; if(curMonth>12){curMonth=1;curYear++;} refreshAll(); });
    $('#pd_refresh').addEventListener('click', refreshAll);

    refreshAll();
  }

  return {render};
})();
