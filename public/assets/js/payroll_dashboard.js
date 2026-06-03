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

        <h3 style="color:var(--t1);margin-bottom:12px">Годовые лимиты самозанятых</h3>
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
    async function apiPut(url){
      const resp = await fetch(url, {method:'PUT', headers:{'Authorization':'Bearer '+token}});
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

    async function refreshAll(){
      updatePeriod();
      await Promise.all([loadSummary(), loadTransfers(), loadLimits()]);
    }

    // Navigation
    $('#pd_prev').addEventListener('click', ()=>{ curMonth--; if(curMonth<1){curMonth=12;curYear--;} refreshAll(); });
    $('#pd_next').addEventListener('click', ()=>{ curMonth++; if(curMonth>12){curMonth=1;curYear++;} refreshAll(); });
    $('#pd_refresh').addEventListener('click', refreshAll);

    refreshAll();
  }

  return {render};
})();
