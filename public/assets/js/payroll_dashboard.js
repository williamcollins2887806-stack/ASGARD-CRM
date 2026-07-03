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
        <!-- 2026-06-29 — итоги выплат по источникам денег -->
        <div id="pd_source_totals" style="display:flex;flex-wrap:wrap;gap:14px;padding:10px 12px;margin-bottom:10px;background:var(--bg2);border:1px solid var(--brd);border-radius:var(--r-md);font-size:13px"></div>
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
              <!-- 2026-06-29 — разделение выплат по источникам -->
              <th style="color:var(--ok)" title="Выплачено наличкой/картой РП">📤 Моя касса</th>
              <th style="color:var(--blue)" title="Перевод бухгалтерии через банк (штатные)">🏦 Банк</th>
              <th style="color:var(--purple)" title="Перевод через сервис самозанятых">📱 СЗ-сервис</th>
              <th title="Остаток к доплате (начислено − выплачено)">К доплате</th>
            </tr></thead>
            <tbody id="pd_cc_body"></tbody>
            <tfoot id="pd_cc_foot"></tfoot>
          </table>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="color:var(--t1);margin:0">Операции с самозанятыми</h3>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <div id="pd_filter_wrap" style="min-width:180px"></div>
            <button class="btn primary" id="pd_bulk_se">🚀 Массовая выплата СЗ</button>
            <button class="btn ghost" id="pd_add_agreement">🤝 По договорённости</button>
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
        .pdcash-diff-neg { color: var(--err); }
        .pdcash-diff-pos { color: var(--ok); }
        .pdcash-diff-zero { opacity: 0.7; }
        html[data-theme="dark"] .pdcash-diff-neg { color: var(--err-t); }
        html[data-theme="dark"] .pdcash-diff-pos { color: var(--ok-t); }
        .pdcash-pct {
          font-size: 11px; font-weight: 700;
          margin-top: 3px; opacity: 0.78; text-align: right;
        }
        .pdcash-bar {
          height: 10px; border-radius: 999px;
          background: var(--bg3); overflow: hidden;
          border: 1px solid var(--brd);
        }
        .pdcash-bar-fill {
          height: 100%; border-radius: 999px;
          transition: width 240ms ease;
        }
        .pdcash-bar-fill.cash-status-ok,
        .pdcash-bar-fill.cash-status-ok_with_returns {
          background: linear-gradient(90deg, color-mix(in srgb, var(--ok) 55%, transparent), var(--ok));
        }
        .pdcash-bar-fill.cash-status-tight {
          background: linear-gradient(90deg, color-mix(in srgb, var(--warn) 55%, transparent), var(--warn));
        }
        .pdcash-bar-fill.cash-status-shortage {
          background: linear-gradient(90deg, color-mix(in srgb, var(--err) 55%, transparent), var(--err));
        }
        /* 2026-06-20 — парность для тёмной темы (на тёмном фоне нужны более насыщенные оттенки) */
        html[data-theme="dark"] .pdcash-bar-fill.cash-status-ok,
        html[data-theme="dark"] .pdcash-bar-fill.cash-status-ok_with_returns {
          background: linear-gradient(90deg, var(--ok-t), var(--ok));
        }
        html[data-theme="dark"] .pdcash-bar-fill.cash-status-tight {
          background: linear-gradient(90deg, var(--warn-t), var(--warn));
        }
        html[data-theme="dark"] .pdcash-bar-fill.cash-status-shortage {
          background: linear-gradient(90deg, var(--err-t), var(--err));
        }
        .pdcash-action { font-size: 13px; font-weight: 700; padding: 6px 0; }
        .pdcash-action-bad { color: var(--err); }
        .pdcash-action-good { color: var(--ok); }
        html[data-theme="dark"] .pdcash-action-bad { color: var(--err-t); }
        html[data-theme="dark"] .pdcash-action-good { color: var(--ok-t); }
        .pdcash-advances {
          font-size: 12px; opacity: 0.82;
          padding-top: 6px; border-top: 1px dashed currentColor;
        }
        .pdcash.cash-status-ok              { background: var(--ok-bg);   color: var(--ok);   border-color: color-mix(in srgb, var(--ok) 45%, transparent); }
        .pdcash.cash-status-ok_with_returns { background: var(--ok-bg);   color: var(--ok);   border-color: color-mix(in srgb, var(--ok) 35%, transparent); }
        .pdcash.cash-status-tight           { background: var(--warn-bg); color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, transparent); }
        .pdcash.cash-status-shortage        { background: var(--err-bg);  color: var(--err);  border-color: color-mix(in srgb, var(--err) 45%, transparent); }
        html[data-theme="dark"] .pdcash.cash-status-ok {
          background: var(--ok-bg); color: var(--ok-t); border-color: color-mix(in srgb, var(--ok) 40%, transparent);
        }
        html[data-theme="dark"] .pdcash.cash-status-ok_with_returns {
          background: var(--ok-bg); color: var(--ok-t); border-color: color-mix(in srgb, var(--ok) 35%, transparent);
        }
        html[data-theme="dark"] .pdcash.cash-status-tight {
          background: var(--warn-bg); color: var(--warn-t); border-color: color-mix(in srgb, var(--warn) 40%, transparent);
        }
        html[data-theme="dark"] .pdcash.cash-status-shortage {
          background: var(--err-bg); color: var(--err-t); border-color: color-mix(in srgb, var(--err) 45%, transparent);
        }
        @media (max-width: 720px) {
          .pdcash-grid { grid-template-columns: 1fr; }
        }
      `;
      document.head.appendChild(s);
    }

    // 2026-06-27 — стили для bulk-модалки (тема-нейтральные, через CSS-переменные)
    if(!document.getElementById('pd-bulk-styles')){
      const s = document.createElement('style');
      s.id = 'pd-bulk-styles';
      s.textContent = `
        .bulkse-grid { display:grid; grid-template-columns: 1fr 1fr 1fr; gap:8px; margin-bottom:12px; }
        @media (max-width:720px){ .bulkse-grid { grid-template-columns: 1fr; } }
        .bulkse-search { width:100%; padding:8px 10px; border:1px solid var(--brd, var(--border)); border-radius:var(--r-sm,6px); background:var(--bg2, var(--bg-surface)); color:var(--t1, var(--text-primary)); }
        .bulkse-pick {
          max-height:260px; overflow-y:auto; border:1px solid var(--brd, var(--border));
          border-radius:var(--r-md, 8px); background:var(--bg2, var(--bg-surface));
        }
        .bulkse-pick-row {
          display:flex; align-items:center; gap:8px; padding:8px 10px;
          border-bottom:1px solid var(--brd, var(--border)); font-size:13px;
        }
        .bulkse-pick-row:last-child { border-bottom:none; }
        .bulkse-pick-row label { flex:1; cursor:pointer; display:flex; gap:8px; align-items:center; }
        .bulkse-pick-row .bulkse-rem { color:var(--t3, var(--text-muted)); font-size:11px; }
        .bulkse-pick-row.over-limit { background:var(--err-bg); }
        .bulkse-pick-row.over-limit .bulkse-rem { color:var(--err-t); font-weight:600; }
        .bulkse-cfg-wrap { overflow-x:auto; }
        .bulkse-cfg { width:100%; border-collapse:collapse; font-size:12px; }
        .bulkse-cfg th, .bulkse-cfg td {
          border:1px solid var(--brd, var(--border));
          padding:6px 8px; text-align:left; vertical-align:top;
        }
        .bulkse-cfg th { background:var(--bg2, var(--bg-surface)); color:var(--t1, var(--text-primary)); font-weight:600; }
        .bulkse-cfg td input, .bulkse-cfg td select {
          width:100%; padding:4px 6px; border:1px solid var(--brd, var(--border));
          border-radius:var(--r-sm,4px); background:var(--bg, var(--bg-base));
          color:var(--t1, var(--text-primary)); font-size:12px;
        }
        .bulkse-cfg td input[readonly] { background:var(--bg3, var(--bg-elevated)); color:var(--t2, var(--text-secondary)); }
        .bulkse-cfg tr.has-error { background:var(--err-bg); }
        .bulkse-cfg tr.has-error td { border-color:var(--err); }
        .bulkse-cfg .bulkse-err-msg { color:var(--err-t); font-size:11px; margin-top:4px; }
        .bulkse-preview {
          margin-top:12px; padding:12px;
          background:var(--info-bg); color:var(--info-t);
          border:1px solid var(--info-t); border-radius:var(--r-md, 8px);
          display:flex; flex-direction:column; gap:6px; font-size:13px;
        }
        .bulkse-preview .bulkse-prev-row { display:flex; justify-content:space-between; gap:12px; }
        .bulkse-preview .bulkse-prev-row b { font-variant-numeric: tabular-nums; }
        .bulkse-section-title { font-size:13px; font-weight:700; color:var(--t1); margin:12px 0 6px; }
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
    // 2026-06-29 — разделение выплат по источникам денег
    // sourceData = { summary:{pm_cash, company_bank, company_se, auto_fot, total}, workers:[{employee_id, fio, is_*, accrued_total, by_source:{pm_cash, company_bank, company_se, auto_fot}, to_pay_remainder}] }
    let sourceData = null;
    // Карта employee_id → запись из workers[] для быстрой связки
    let sourceByEmp = new Map();

    async function loadCashCalc(){
      try{
        ccData = await apiFetch(`/api/payroll-dashboard/cash-calc/${curYear}/${curMonth}`);
      }catch(e){
        ccData = null;
        toast("Ошибка","Не удалось загрузить расчёт кассы","err");
      }
      // Параллельно — выплаты по источникам (новый эндпоинт, тихий fallback)
      try{
        // Период «месяц целиком» — даты в YYYY-MM-DD
        const pad = (n)=>String(n).padStart(2,'0');
        const from = `${curYear}-${pad(curMonth)}-01`;
        const lastDay = new Date(curYear, curMonth, 0).getDate();
        const to = `${curYear}-${pad(curMonth)}-${pad(lastDay)}`;
        sourceData = await apiFetch(
          `/api/payroll-dashboard/payouts-by-source?from=${from}&to=${to}`
        );
      }catch(_){
        // Endpoint может быть недоступен — деградируем мягко
        sourceData = null;
      }
      // Перестроить карту
      sourceByEmp = new Map();
      if(sourceData && Array.isArray(sourceData.workers)){
        sourceData.workers.forEach(w=>{
          sourceByEmp.set(Number(w.employee_id), w);
        });
      }
      renderCashCalc();
    }

    // 2026-06-29 — нормализация ключа источника (pm_cash_legacy → pm_cash)
    function _srcVal(by_source, key){
      if(!by_source) return 0;
      if(key === 'pm_cash'){
        return Number(by_source.pm_cash||0) + Number(by_source.pm_cash_legacy||0);
      }
      return Number(by_source[key]||0);
    }

    // 2026-06-29 — ячейка источника (либо сумма цветом, либо «—»)
    function _srcCell(val, color){
      const v = Number(val||0);
      if(v <= 0) return `<td style="color:var(--t3)">—</td>`;
      return `<td style="color:${color};font-weight:600">${fmtR(v)}</td>`;
    }

    // 2026-06-29 — ячейка «К доплате»
    function _toPayCell(remainder){
      const v = Number(remainder||0);
      if(v <= 0){
        return `<td style="color:var(--ok);font-weight:600" title="Полностью закрыто">✓ ${fmtR(0)}</td>`;
      }
      return `<td style="color:var(--warn);font-weight:700" title="Остаток к доплате">⚠ ${fmtR(v)}</td>`;
    }

    // 2026-06-29 — итоги выплат по источникам (шапка над таблицей)
    function renderSourceTotals(){
      const box = $('#pd_source_totals');
      if(!box) return;
      const sum = (sourceData && sourceData.summary) ? sourceData.summary : null;
      if(!sum){
        box.innerHTML = `<span style="color:var(--t3);font-size:12px">Разбивка по источникам недоступна</span>`;
        return;
      }
      const pmCash = Number(sum.pm_cash||0);
      const bank   = Number(sum.company_bank||0);
      const se     = Number(sum.company_se||0);
      const auto   = Number(sum.auto_fot||0);
      const total  = Number(sum.total||0) || (pmCash+bank+se+auto);
      box.innerHTML = `
        <span style="color:var(--ok);font-weight:600">📤 ${fmtR(pmCash)} из вашей кассы</span>
        <span style="color:var(--blue);font-weight:600">🏦 ${fmtR(bank)} от компании</span>
        <span style="color:var(--purple);font-weight:600">📱 ${fmtR(se)} через СЗ-сервис</span>
        <span style="color:var(--gold);font-weight:600" title="Авто-начисления ФОТ из табелей">⚙ ${fmtR(auto)} авто-ФОТ</span>
        <span style="margin-left:auto;color:var(--t2)">Σ выплачено: <b style="color:var(--t1)">${fmtR(total)}</b></span>
      `;
    }

    function renderCashCalc(){
      // 2026-06-29 — итоги по источникам
      renderSourceTotals();

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
      // colspan = 10 (6 базовых + 4 новых)
      if(!list.length){
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--t3);padding:20px">Нет данных за период</td></tr>';
        if(tfoot) tfoot.innerHTML = '';
        return;
      }
      tbody.innerHTML = list.map(i=>{
        const pt = PAY_TYPE_LABEL[i.pay_type] || {label:i.pay_type,bg:'var(--bg3)',color:'var(--t2)'};
        // 2026-06-29 — данные по источникам выплат (могут отсутствовать)
        const src = sourceByEmp.get(Number(i.employee_id));
        const bs  = src && src.by_source ? src.by_source : null;
        const myCash = _srcVal(bs, 'pm_cash');
        const bank   = _srcVal(bs, 'company_bank');
        const se     = _srcVal(bs, 'company_se');
        const remain = src ? Number(src.to_pay_remainder||0) : 0;
        const empId  = i.employee_id ? Number(i.employee_id) : null;
        const clickable = empId
          ? ` data-pd-emp="${empId}" style="cursor:pointer"`
          : '';
        return `<tr${clickable} title="Открыть детализацию выплат">
          <td><b>${esc(i.fio||'—')}</b></td>
          <td><span style="padding:3px 8px;border-radius:var(--r-sm);background:${pt.bg};color:${pt.color};font-size:12px;font-weight:600">${pt.label}</span></td>
          <td>${fmtR(i.earned||0)}</td>
          <td style="font-weight:600">${fmtR(i.transfer||0)}</td>
          <td style="color:var(--gold)">${i.cash_return?fmtR(i.cash_return):'—'}</td>
          <td style="color:var(--warn-t);font-weight:600">${i.cash_payout?fmtR(i.cash_payout):'—'}</td>
          ${_srcCell(myCash, 'var(--ok)')}
          ${_srcCell(bank,   'var(--blue)')}
          ${_srcCell(se,     'var(--purple)')}
          ${_toPayCell(remain)}
        </tr>`;
      }).join('');

      // Клик по строке → модалка с детализацией
      tbody.querySelectorAll('tr[data-pd-emp]').forEach(tr=>{
        tr.addEventListener('click', (ev)=>{
          // Не открывать модалку при клике по кнопке/ссылке внутри ряда (на будущее)
          if(ev.target && ev.target.closest && ev.target.closest('button,a,input,select,textarea')) return;
          const empId = Number(tr.getAttribute('data-pd-emp'));
          if(!empId) return;
          if(typeof window.openPaymentBreakdownModal !== 'function'){
            toast('Внимание','Модуль детализации выплат не загружен','err');
            return;
          }
          const pad = (n)=>String(n).padStart(2,'0');
          const from = `${curYear}-${pad(curMonth)}-01`;
          const lastDay = new Date(curYear, curMonth, 0).getDate();
          const to = `${curYear}-${pad(curMonth)}-${pad(lastDay)}`;
          window.openPaymentBreakdownModal({
            employee_id: empId,
            from, to
            // work_id/pm_id не задаём — показываем срез по всему периоду
          });
        });
      });

      // ИТОГО по текущей вкладке
      const sum = list.reduce((a,i)=>{
        const src = sourceByEmp.get(Number(i.employee_id));
        const bs  = src && src.by_source ? src.by_source : null;
        return {
          earned:a.earned+(i.earned||0),
          transfer:a.transfer+(i.transfer||0),
          cash_return:a.cash_return+(i.cash_return||0),
          cash_payout:a.cash_payout+(i.cash_payout||0),
          my_cash: a.my_cash + _srcVal(bs,'pm_cash'),
          bank:    a.bank    + _srcVal(bs,'company_bank'),
          se:      a.se      + _srcVal(bs,'company_se'),
          remain:  a.remain  + (src?Number(src.to_pay_remainder||0):0)
        };
      }, {earned:0,transfer:0,cash_return:0,cash_payout:0,my_cash:0,bank:0,se:0,remain:0});
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
            <td style="color:var(--ok)">${sum.my_cash?fmtR(sum.my_cash):'—'}</td>
            <td style="color:var(--blue)">${sum.bank?fmtR(sum.bank):'—'}</td>
            <td style="color:var(--purple)">${sum.se?fmtR(sum.se):'—'}</td>
            <td style="color:${sum.remain>0?'var(--warn)':'var(--ok)'}">${sum.remain>0?'⚠ '+fmtR(sum.remain):'✓ '+fmtR(0)}</td>
          </tr>
          <tr style="background:var(--bg2)">
            <td colspan="10" style="color:${netColor};font-weight:700;font-size:14px">
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

    // ────────────────────────────────────────────────────────────────
    // 2026-06-27 — BULK SE TRANSFERS (массовая выплата)
    // ────────────────────────────────────────────────────────────────
    // State модалки (живёт пока модалка открыта)
    const bulk = {
      workers: [],          // [{employee_id, fio, yearly_limit, yearly_transferred, ...}]
      works: [],            // [{id, work_title, pm_id, pm_name}]
      monthlyLimit: 350000,
      rows: [],             // [{employee_id, fio, selected, type, transfer, earned, work_id, destination, error, errorMsg}]
      autofilled: {}        // ключ "empId|workId" -> earned (кэш)
    };

    function bulkComputeRemainder(r){
      const t = Number(r.transfer) || 0;
      const e = Number(r.earned) || 0;
      return Math.max(0, t - e);
    }

    function bulkRowError(r, w){
      // Возвращает строку с описанием ошибки или null
      if(!r.transfer || Number(r.transfer) <= 0) return 'Перевод должен быть > 0';
      if(r.type === 'work_transfer'){
        if(!r.work_id) return 'Выберите работу';
        if(!r.earned || Number(r.earned) <= 0) return 'Для "за работу" нужно поле "заработал"';
      }
      if(r.type === 'agreement_transfer'){
        if(Number(r.earned) !== 0) return 'Для "договорённости" заработал должен быть 0';
      }
      if(r.destination === 'pm' && r.work_id){
        const wk = bulk.works.find(x => Number(x.id) === Number(r.work_id));
        if(wk && !wk.pm_id) return 'У работы нет РП → выберите "Касса"';
      }
      if(r.destination === 'pm' && !r.work_id){
        return 'Без работы остаток не может идти РП → выберите "Касса"';
      }
      // Лимит НПД
      const yearly = Number(w?.yearly_limit) || 2400000;
      const used = Number(w?.yearly_transferred) || 0;
      if(used + Number(r.transfer) > yearly){
        return `Превышен годовой лимит (остаток ${fmtR(Math.max(0, yearly - used))})`;
      }
      return null;
    }

    function bulkRenderConfig(){
      const tbody = document.getElementById('bulkse_cfg_body');
      if(!tbody) return;
      const selected = bulk.rows.filter(r => r.selected);
      if(!selected.length){
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--t3);padding:14px">Выберите СЗ выше (чек-боксы)</td></tr>';
        bulkRenderPreview();
        return;
      }
      const workOpts = bulk.works.map(w =>
        `<option value="${w.id}">${esc(w.work_title || ('#' + w.id))}${w.pm_id?'':' (без РП)'}</option>`
      ).join('');
      tbody.innerHTML = selected.map((r, idx) => {
        const w = bulk.workers.find(x => Number(x.employee_id) === Number(r.employee_id));
        const rem = bulkComputeRemainder(r);
        const err = bulkRowError(r, w);
        r.error = !!err; r.errorMsg = err;
        const rowIdx = bulk.rows.indexOf(r);
        return `
          <tr class="${err ? 'has-error' : ''}" data-row="${rowIdx}">
            <td>
              <b>${esc(r.fio || '')}</b>
              ${err ? `<div class="bulkse-err-msg">${esc(err)}</div>` : ''}
            </td>
            <td>
              <select data-field="type" data-row="${rowIdx}">
                <option value="work_transfer"${r.type==='work_transfer'?' selected':''}>За работу</option>
                <option value="agreement_transfer"${r.type==='agreement_transfer'?' selected':''}>По договорённости</option>
              </select>
            </td>
            <td>
              <input type="number" min="0" step="1000" data-field="transfer" data-row="${rowIdx}" value="${r.transfer||0}">
            </td>
            <td>
              <input type="number" min="0" step="1000" data-field="earned" data-row="${rowIdx}" value="${r.earned||0}" ${r.type==='agreement_transfer' ? 'disabled' : ''}>
            </td>
            <td>
              <input type="text" readonly value="${fmt(rem)} ₽" title="auto = transfer - earned">
            </td>
            <td>
              <select data-field="destination" data-row="${rowIdx}">
                <option value="pm"${r.destination==='pm'?' selected':''}>РП (handover)</option>
                <option value="company"${r.destination==='company'?' selected':''}>Касса</option>
              </select>
            </td>
            <td>
              <select data-field="work_id" data-row="${rowIdx}">
                <option value="">— нет —</option>
                ${bulk.works.map(w => `<option value="${w.id}"${Number(r.work_id)===Number(w.id)?' selected':''}>${esc(w.work_title||('#'+w.id))}${w.pm_id?'':' (без РП)'}</option>`).join('')}
              </select>
            </td>
          </tr>
        `;
      }).join('');

      // Bind inline-edit (oninput для number, onchange для select)
      tbody.querySelectorAll('input[data-field], select[data-field]').forEach(el => {
        const ev = (el.tagName === 'SELECT' || el.type === 'checkbox') ? 'change' : 'input';
        el.addEventListener(ev, () => {
          const ri = Number(el.getAttribute('data-row'));
          const field = el.getAttribute('data-field');
          const row = bulk.rows[ri];
          if(!row) return;
          let v = el.value;
          if(field === 'transfer' || field === 'earned' || field === 'work_id'){
            v = v === '' ? null : Number(v);
            if(field === 'work_id') v = v || null;
            else v = v || 0;
          }
          row[field] = v;
          if(field === 'type'){
            if(v === 'agreement_transfer'){ row.earned = 0; }
          }
          if(field === 'type' || field === 'work_id' || field === 'employee_id'){
            // Autofill earned (только для work_transfer)
            if(row.type === 'work_transfer' && row.work_id){
              bulkAutofillEarned(row).then(() => bulkRenderConfig());
              return;
            }
          }
          bulkRenderConfig();
        });
      });

      bulkRenderPreview();
    }

    async function bulkAutofillEarned(row){
      if(row.type !== 'work_transfer' || !row.work_id || !row.employee_id) return;
      const key = row.employee_id + '|' + row.work_id;
      if(bulk.autofilled[key] != null){ row.earned = bulk.autofilled[key]; return; }
      try{
        const data = await apiFetch(`/api/payroll-dashboard/summary/${curYear}/${curMonth}?employee_id=${row.employee_id}&work_id=${row.work_id}`);
        // Толерантно: ищем поле earned в нескольких возможных местах
        let earned = 0;
        if(data && typeof data === 'object'){
          if(typeof data.earned === 'number') earned = data.earned;
          else if(typeof data.employee_earned === 'number') earned = data.employee_earned;
          else if(Array.isArray(data.items)){
            const it = data.items.find(i => Number(i.employee_id) === Number(row.employee_id));
            if(it) earned = Number(it.earned || it.earned_amount || 0);
          }
        }
        bulk.autofilled[key] = earned;
        row.earned = earned;
      }catch(_){
        // молча: РП введёт сам
      }
    }

    function bulkRenderPreview(){
      const box = document.getElementById('bulkse_preview');
      if(!box) return;
      const selected = bulk.rows.filter(r => r.selected);
      const validRows = selected.filter(r => !r.error);
      const totalT = validRows.reduce((s,r) => s + (Number(r.transfer)||0), 0);
      const totalE = validRows.reduce((s,r) => s + (Number(r.earned)||0), 0);
      const remPm = validRows.filter(r => r.destination === 'pm').reduce((s,r) => s + bulkComputeRemainder(r), 0);
      const remCompany = validRows.filter(r => r.destination === 'company').reduce((s,r) => s + bulkComputeRemainder(r), 0);
      const errCount = selected.length - validRows.length;
      box.innerHTML = `
        <div class="bulkse-prev-row">
          <span>Создаём переводов:</span><b>${validRows.length}${errCount?` <span style="color:var(--err-t)">(${errCount} с ошибками — будут пропущены)</span>`:''}</b>
        </div>
        <div class="bulkse-prev-row"><span>Σ Перевод:</span><b>${fmtR(totalT)}</b></div>
        <div class="bulkse-prev-row"><span>Σ Заработал:</span><b>${fmtR(totalE)}</b></div>
        <div class="bulkse-prev-row"><span>Σ Остаток → РП (handover):</span><b>${fmtR(remPm)}</b></div>
        <div class="bulkse-prev-row"><span>Σ Остаток → Касса Асгарда:</span><b>${fmtR(remCompany)}</b></div>
      `;
      const submitBtn = document.getElementById('bulkse_submit');
      if(submitBtn) submitBtn.disabled = (validRows.length === 0);
    }

    function bulkRenderPickList(filter){
      const list = document.getElementById('bulkse_pick_list');
      if(!list) return;
      const q = (filter || '').toLowerCase().trim();
      const filtered = bulk.workers.filter(w => !q || (w.fio||'').toLowerCase().includes(q));
      if(!filtered.length){
        list.innerHTML = '<div style="padding:14px;text-align:center;color:var(--t3)">Не найдено</div>';
        return;
      }
      list.innerHTML = filtered.map(w => {
        const yearly = Number(w.yearly_limit) || 2400000;
        const used = Number(w.yearly_transferred) || 0;
        const rem = Math.max(0, yearly - used);
        const overLimit = rem <= 0;
        const checked = bulk.rows.some(r => Number(r.employee_id) === Number(w.employee_id) && r.selected);
        return `
          <div class="bulkse-pick-row ${overLimit?'over-limit':''}">
            <label>
              <input type="checkbox" data-pick="${w.employee_id}" ${checked?'checked':''} ${overLimit?'disabled':''}>
              <span>${esc(w.fio || '—')}</span>
              <span class="bulkse-rem">остаток ${fmtR(rem)}</span>
            </label>
          </div>
        `;
      }).join('');
      list.querySelectorAll('[data-pick]').forEach(cb => {
        cb.addEventListener('change', () => {
          const empId = Number(cb.getAttribute('data-pick'));
          const w = bulk.workers.find(x => Number(x.employee_id) === empId);
          if(!w) return;
          const existing = bulk.rows.find(r => Number(r.employee_id) === empId);
          if(cb.checked){
            if(existing){
              existing.selected = true;
            } else {
              bulk.rows.push({
                employee_id: empId,
                fio: w.fio,
                selected: true,
                type: 'work_transfer',
                transfer: bulk.monthlyLimit,
                earned: 0,
                work_id: null,
                destination: 'pm',
                error: false,
                errorMsg: null
              });
            }
          } else if(existing){
            existing.selected = false;
          }
          bulkRenderConfig();
        });
      });
    }

    async function openBulkSeModal(){
      try{
        // Параллельная загрузка работ + лимитов
        const [limitsData, worksData] = await Promise.all([
          apiFetch('/api/payroll-dashboard/self-employed-limits'),
          apiFetch('/api/works?limit=500').catch(()=>({works:[]}))
        ]);
        bulk.workers = (limitsData.limits || limitsData || []).filter(w => w.is_self_employed);
        bulk.monthlyLimit = Number(limitsData.monthly_limit) || 350000;
        bulk.works = (worksData.works || worksData.items || worksData || []).map(w => ({
          id: w.id,
          work_title: w.work_title || w.title || ('Работа #' + w.id),
          pm_id: w.pm_id || w.head_pm_id || null,
          pm_name: w.pm_name || null
        }));
        bulk.rows = [];
        bulk.autofilled = {};
      }catch(e){
        toast('Ошибка', 'Не удалось загрузить данные: ' + e.message, 'err');
        return;
      }

      const body = `
        <div class="bulkse-section-title">1. Выберите СЗ (${bulk.workers.length} доступно)</div>
        <input type="text" id="bulkse_search" class="bulkse-search" placeholder="Поиск по ФИО…" style="margin-bottom:8px">
        <div class="bulkse-pick" id="bulkse_pick_list"></div>

        <div class="bulkse-section-title">2. Настройка переводов</div>
        <div class="bulkse-cfg-wrap">
          <table class="bulkse-cfg">
            <thead>
              <tr>
                <th>ФИО</th><th>Тип</th><th>Перевод ₽</th><th>Заработал ₽</th>
                <th>Остаток</th><th>Куда остаток</th><th>Работа</th>
              </tr>
            </thead>
            <tbody id="bulkse_cfg_body"></tbody>
          </table>
        </div>

        <div class="bulkse-preview" id="bulkse_preview"></div>

        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
          <button class="btn ghost" id="bulkse_cancel">Отмена</button>
          <button class="btn primary" id="bulkse_submit" disabled>🚀 Создать переводы</button>
        </div>
      `;
      showModal(`Массовая выплата СЗ — ${new Date(curYear, curMonth-1).toLocaleString('ru-RU',{month:'long',year:'numeric'})}`, body);

      bulkRenderPickList('');
      bulkRenderConfig();

      $('#bulkse_search').addEventListener('input', (e) => bulkRenderPickList(e.target.value));
      $('#bulkse_cancel').addEventListener('click', () => closeModal());
      $('#bulkse_submit').addEventListener('click', bulkSubmit);
    }

    async function bulkSubmit(){
      const selected = bulk.rows.filter(r => r.selected && !r.error);
      if(!selected.length){ toast('Проверка','Нет валидных строк для отправки','err'); return; }
      const payload = {
        year: curYear,
        month: curMonth,
        transfers: selected.map(r => ({
          employee_id: r.employee_id,
          work_id: r.work_id || null,
          operation_type: r.type,
          transfer_amount: Number(r.transfer)||0,
          earned_amount: r.type === 'agreement_transfer' ? 0 : (Number(r.earned)||0),
          remainder_destination: r.destination,
          comment: `Массовая выплата ${curMonth}/${curYear}`
        }))
      };
      const submitBtn = document.getElementById('bulkse_submit');
      if(submitBtn){ submitBtn.disabled = true; submitBtn.textContent = 'Создаём…'; }
      try{
        const resp = await apiPost('/api/payroll-dashboard/se-transfers/bulk', payload);
        const errs = resp.errors || [];
        const summary = resp.summary || {};
        // Подсветить строки с серверными ошибками (по index)
        if(errs.length){
          // index в payload.transfers соответствует selected[index]
          errs.forEach(er => {
            const i = Number(er.index);
            const r = selected[i];
            if(r){ r.error = true; r.errorMsg = er.error || 'Ошибка'; }
          });
          bulkRenderConfig();
          toast('Частично', `Создано ${summary.se_transfers||0}, ошибок ${errs.length}`, 'err');
          if(submitBtn){ submitBtn.disabled = false; submitBtn.textContent = '🚀 Создать оставшиеся'; }
          // Снимаем галку с успешно созданных, чтобы повторный submit отправил только проблемные
          const errIdx = new Set(errs.map(e => Number(e.index)));
          selected.forEach((r, i) => { if(!errIdx.has(i)) r.selected = false; });
          await refreshAll();
          return;
        }
        // Полный успех
        closeModal();
        toast('Готово', `Создано переводов: ${summary.se_transfers || selected.length}`, 'ok');
        await refreshAll();
      }catch(e){
        if(submitBtn){ submitBtn.disabled = false; submitBtn.textContent = '🚀 Создать переводы'; }
        toast('Ошибка', e.message, 'err');
      }
    }

    $('#pd_bulk_se').addEventListener('click', openBulkSeModal);

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
