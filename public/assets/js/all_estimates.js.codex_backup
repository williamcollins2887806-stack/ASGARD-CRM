window.AsgardAllEstimatesPage=(function(){
  const { $, $$, esc, toast, showModal } = AsgardUI;

  function ymNow(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }
  function money(x){ if(x===null||x===undefined||x==="") return "—"; const n=Number(x); if(isNaN(n)) return esc(String(x)); return n.toLocaleString("ru-RU"); }
  function norm(s){ return String(s||"").toLowerCase().trim(); }
  function isDirectorRole(role){ return role === 'ADMIN' || (window.AsgardAuth && AsgardAuth.isDirectorRole ? AsgardAuth.isDirectorRole(role) : String(role||'').startsWith('DIRECTOR')); }
  function getApiBase(){ return (window.AsgardApp && AsgardApp.API_BASE) || localStorage.getItem('asgard_api_base') || '/api'; }
  function getAuthToken(){ return localStorage.getItem('asgard_token') || (window.AsgardAuth && AsgardAuth.getToken && AsgardAuth.getToken()) || ''; }
  async function apiFetch(path, opts = {}){
    const res = await fetch(`${getApiBase()}${path}`, {
      ...opts,
      headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${getAuthToken()}`, ...(opts.headers||{}) }
    });
    if(!res.ok){ const err = await res.json().catch(()=>({error:'Ошибка сети'})); throw new Error(err.error || `Ошибка запроса (${res.status})`); }
    return res.json();
  }
  async function apiForm(path, formData){
    const res = await fetch(`${getApiBase()}${path}`, { method:'POST', body: formData, headers: { 'Authorization': `Bearer ${getAuthToken()}` } });
    if(!res.ok){ const err = await res.json().catch(()=>({error:'Ошибка сети'})); throw new Error(err.error || `Ошибка запроса (${res.status})`); }
    return res.json();
  }
  async function downloadWithAuth(url, filename){
    const href = /^https?:/i.test(url) ? url : `${location.origin}${url.startsWith('/') ? url : `/${url}`}`;
    const res = await fetch(href, { headers: { 'Authorization': `Bearer ${getAuthToken()}` } });
    if(!res.ok) throw new Error('Не удалось скачать файл');
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl; link.download = filename || 'file'; link.target = '_blank';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(()=>URL.revokeObjectURL(objectUrl), 1000);
  }
  function safeParseJSON(s, fallback){ try{ const v=JSON.parse(s||"{}"); return (v && typeof v==="object")?v:(fallback||{}); } catch(_){ return (fallback||{}); } }
  function sumCrew(obj){ if(!obj || typeof obj!=="object") return null; let total=0; let any=false; for(const k of Object.keys(obj)){ const n=Number(obj[k]); if(Number.isFinite(n)){ total+=n; any=true; } } return any?total:null; }
  function calcView(calc){
    calc = (calc && typeof calc==="object")?calc:{};
    if(calc._type==="asgard_calc_v1"){ const out=(calc.output&&typeof calc.output==="object")?calc.output:{}; const dv=(calc.director_view&&typeof calc.director_view==="object")?calc.director_view:{}; return { chemCost:(out.chem&&typeof out.chem==="object")?out.chem.cost:null, logisticsCost:out.logistics??null, equipmentCost:out.equipment_total??null, peopleCount:dv.people??out.peopleWork??null, workDays:dv.work_days??out.workDays??null, director:dv }; }
    if(calc.tkp_total!=null || calc.cost_total!=null || calc.profit_clean!=null){ const people = calc.people_count ?? sumCrew(calc.crew); return { chemCost:calc.chemicals_total??null, logisticsCost:calc.logistics_cost??null, equipmentCost:calc.equipment_total??null, peopleCount:people??null, workDays:calc.work_days??null, director:{ price_tkp_with_vat:calc.tkp_total??null, cost_total:calc.cost_total??null, net_profit:calc.profit_clean??null, people, work_days:calc.work_days??null } }; }
    return { chemCost:calc.chemistry_cost??null, logisticsCost:calc.logistics_cost??null, equipmentCost:calc.equipment_cost??null, peopleCount:calc.people_count??null, workDays:calc.work_days??null, director:(calc.director_view&&typeof calc.director_view==="object")?calc.director_view:null };
  }
  function statusLabel(status){ const map = { draft:'Черновик', sent:'На согласовании у директора', accounting_review:'На согласовании у бухгалтерии', payment_pending:'Ожидает оплаты', approved:'Согласовано', approved_final:'Согласовано', paid:'Оплачено', rework:'На доработке', question:'Вопрос', rejected:'Отклонено', cancelled:'Отменено' }; return map[String(status||'draft')] || String(status||'Черновик'); }
  function stageLabel(stage){ const map = { director_review:'Директор', accounting_review:'Бухгалтерия', payment_pending:'Ожидает оплаты', pm_rework:'Доработка', approved_final:'Согласовано', paid:'Оплачено', rejected:'Отклонено', cancelled_by_pm:'Отменено' }; return map[String(stage||'')] || 'Не начато'; }
  function eventLabel(action){ const map = { submit:'Отправлено на согласование', resubmit:'Повторно отправлено', approve_to_accounting:'Согласовано директором', approve_director_final:'Согласовано директором', accept_accounting:'Принято бухгалтерией, ожидается оплата', mark_paid:'Оплачено', request_rework:'Возвращено с комментарием', reject:'Отклонено', cancel_by_pm:'Отменено РП' }; return map[String(action||'')] || String(action||'Событие'); }
  function requiresPaymentLabel(value){ return value ? 'Оплата требуется' : 'Оплата не требуется'; }
  function sourceTypeLabel(type){ const map = { tkp:'ТКП', estimate:'Документ', work_expense:'Расход', office_expense:'Расход', purchase_request:'Заявка на закупку' }; return map[String(type||'')] || 'Документ'; }
  function parseEstimateIdFromHash(){ const hash = String(location.hash || ''); const idx = hash.indexOf('?'); if(idx < 0) return null; const params = new URLSearchParams(hash.slice(idx + 1)); const id = Number(params.get('id')); return Number.isFinite(id) && id > 0 ? id : null; }
  function canReviewAsDirector(user, approval){ return !!approval && approval.current_stage === 'director_review' && isDirectorRole(user.role); }
  function canReviewAsAccounting(user, approval){ return !!approval && approval.current_stage === 'accounting_review' && (user.role === 'BUH' || user.role === 'ADMIN'); }
  function canMarkPaid(user, approval){ return !!approval && approval.current_stage === 'payment_pending' && (user.role === 'BUH' || user.role === 'ADMIN'); }
  async function getUsers(){ return (await AsgardDB.all("users")).filter(u=>u.is_active && u.name && u.name.trim()); }
  async function getSettings(){ const s = await AsgardDB.get("settings","app"); return s ? JSON.parse(s.value_json||"{}") : { vat_pct:20 }; }
  function buildEvents(events){ if(!Array.isArray(events) || !events.length) return '<div class="help">История согласования пока пуста.</div>'; return events.slice().reverse().map((event)=>{ const when = event.created_at ? new Date(event.created_at).toLocaleString('ru-RU') : '—'; const actor = event.actor_name || 'Не указан'; const comment = event.comment ? `<div class="help" style="margin-top:4px">Комментарий: ${esc(event.comment)}</div>` : ''; return `<div class="pill" style="display:block; margin-bottom:8px"><div class="who"><b>${esc(eventLabel(event.action))}</b></div><div class="role">${esc(actor)} · ${esc(when)}</div>${comment}</div>`; }).join(''); }
  function buildPaymentSlips(slips){ if(!Array.isArray(slips) || !slips.length) return '<div class="help">Платежки пока не загружены.</div>'; return slips.map((slip)=>{ const when = slip.created_at ? new Date(slip.created_at).toLocaleString('ru-RU') : '—'; const uploader = slip.uploaded_by_name || '—'; const name = slip.original_name || 'Платежка'; return `<div class="pill" style="display:block; margin-bottom:8px"><div class="who"><b>${esc(name)}</b></div><div class="role">${esc(uploader)} · ${esc(when)}</div>${slip.comment?`<div class="help" style="margin-top:4px">Комментарий: ${esc(slip.comment)}</div>`:''}<div style="margin-top:8px"><button class="btn ghost" data-slip-url="${esc(slip.download_url||'')}" data-slip-name="${esc(name)}">Скачать</button></div></div>`; }).join(''); }
  async function render({layout,title}){
    let currentPage = 1;
    let pageSize = window.AsgardPagination ? AsgardPagination.getPageSize() : 20;
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }
    const user = auth.user || auth;
    const users = await getUsers();
    const byId = new Map(users.map(u=>[u.id,u]));
    const settings = await getSettings();
    const tenders = await AsgardDB.all("tenders");
    let estimates = await AsgardDB.all("estimates");
    let sortKey = 'sent_for_approval_at';
    let sortDir = -1;

    const body = `${window.__ASG_SHARED_TABLE_CSS__||""}<div class="panel"><div class="help">Очередь документов и ТКП в согласовании. Здесь доступны действия директора, бухгалтерии и этап оплаты.</div><hr class="hr"/><div class="tools"><div class="field"><label>Период</label><select id="f_period">${generatePeriodOptions(ymNow())}</select></div><div class="field"><label>Поиск</label><input id="f_q" placeholder="заказчик / тендер"/></div><div class="field"><label>РП</label><select id="f_pm"><option value="">Все</option>${users.filter(u=>u.role==="PM" || (Array.isArray(u.roles) && u.roles.includes("PM"))).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></div><div class="field"><label>Статус согласования</label><select id="f_a"><option value="">Все</option><option value="draft">Черновик</option><option value="sent">На согласовании у директора</option><option value="accounting_review">На согласовании у бухгалтерии</option><option value="payment_pending">Ожидает оплаты</option><option value="approved">Согласовано</option><option value="paid">Оплачено</option><option value="rework">На доработке</option><option value="question">Вопрос</option><option value="rejected">Отклонено</option><option value="cancelled">Отменено</option></select></div></div><hr class="hr"/><div style="overflow:auto"><table class="asg"><thead><tr><th><button class="btn ghost" style="padding:6px 10px" data-sort="tender_id">Заказчик</button></th><th><button class="btn ghost" style="padding:6px 10px" data-sort="pm_id">РП</button></th><th><button class="btn ghost" style="padding:6px 10px" data-sort="version_no">Версия</button></th><th><button class="btn ghost" style="padding:6px 10px" data-sort="approval_status">Статус</button></th><th><button class="btn ghost" style="padding:6px 10px" data-sort="price_tkp">Цена ТКП</button></th><th><button class="btn ghost" style="padding:6px 10px" data-sort="cost_plan">Себестоим.</button></th><th></th></tr></thead><tbody id="tb"></tbody></table></div><div class="help" id="cnt"></div></div>`;
    await layout(body,{title:title||"Согласования"});
    const tb = $("#tb");
    const cnt = $("#cnt");
    async function refreshEstimates(){ estimates = await AsgardDB.all("estimates"); }
    async function syncEstimateLocally(estimate, approval){ if(!estimate || !estimate.id) return; const current = await AsgardDB.get('estimates', estimate.id).catch(()=>null); const next = Object.assign({}, current || {}, estimate); if(approval && approval.requires_payment !== undefined) next.requires_payment = !!approval.requires_payment; if(!next.updated_at) next.updated_at = new Date().toISOString(); if(current) await AsgardDB.put('estimates', next); else await AsgardDB.add('estimates', next); await refreshEstimates(); }
    function sortBy(key,dir){ return (a,b)=>{ const av=(a[key]??""); const bv=(b[key]??""); if(typeof av==="number" && typeof bv==="number") return dir*(av-bv); return dir*String(av).localeCompare(String(bv),"ru",{sensitivity:"base"}); }; }
    function row(e){ const t = tenders.find(x=>x.id===e.tender_id); const pm = byId.get(e.pm_id); const priceNoVat = (e.price_tkp!=null) ? Math.round(Number(e.price_tkp)/(1+(Number(settings.vat_pct||0)/100))) : null; return `<tr data-id="${e.id}" data-tender-id="${e.tender_id||""}"><td><b>${esc(t?.customer_name||"—")}</b><div class="help">${esc(t?.tender_title||"—")} · период ${esc(t?.period||"—")}</div></td><td>${esc(pm?pm.name:"—")}</td><td>#${esc(e.version_no||1)}</td><td><span class="pill">${esc(statusLabel(e.approval_status||"draft"))}</span><div class="help">${e.sent_for_approval_at?esc(new Date(e.sent_for_approval_at).toLocaleString("ru-RU")):""}</div></td><td><div><b>${money(e.price_tkp)}</b> руб.</div><div class="help">Без НДС: ${priceNoVat==null?"—":money(priceNoVat)} руб.</div></td><td>${money(e.cost_plan)} руб.</td><td style="white-space:nowrap"><button class="btn" style="padding:6px 10px" data-act="open">Открыть</button><button class="btn ghost" style="padding:6px 10px" data-act="create_tkp" title="Создать ТКП по текущему документу">Создать ТКП</button></td></tr>`; }
    function apply(){ const per = norm($("#f_period").value); const q = norm($("#f_q").value); const pm = $("#f_pm").value; const a = $("#f_a").value; let list = estimates.filter(e=>{ const t = tenders.find(x=>x.id===e.tender_id); if(per && norm(t?.period||"")!==per) return false; if(pm && String(e.pm_id)!==String(pm)) return false; if(a && (e.approval_status||"draft")!==a) return false; if(q){ const hay = `${t?.customer_name||""} ${t?.tender_title||""}`.toLowerCase(); if(!hay.includes(q)) return false; } return true; }); list.sort(sortBy(sortKey,sortDir)); const paged = window.AsgardPagination ? AsgardPagination.paginate(list, currentPage, pageSize) : list; tb.innerHTML = paged.map(row).join(""); if (window.AsgardPagination) { let pgEl = document.getElementById("estimates_pagination"); if (!pgEl) { pgEl = document.createElement("div"); pgEl.id = "estimates_pagination"; tb.closest("table").after(pgEl); } pgEl.innerHTML = AsgardPagination.renderControls(list.length, currentPage, pageSize); AsgardPagination.attachHandlers("estimates_pagination", (p) => { currentPage = p; apply(); }, (s) => { pageSize = s; currentPage = 1; apply(); }); } cnt.textContent = `Показано: ${list.length} из ${estimates.length}.`; }
    async function createTkpFromEstimate(estId){ const e = estimates.find(x=>x.id===estId); if(!e){ toast("Ошибка","Документ не найден","err"); return; } const t = tenders.find(x=>x.id===e.tender_id); const tkpTitle = t ? `ТКП: ${t.customer_name||""} · ${t.tender_title||""}` : `ТКП по документу #${estId}`; const totalSum = e.price_tkp || 0; try { const resp = await apiFetch('/tkp', { method: 'POST', body: JSON.stringify({ title: tkpTitle.substring(0, 200), tender_id: e.tender_id || null, estimate_id: e.id, customer_name: t?.customer_name || '', total_sum: totalSum, source: 'estimate', work_description: t?.tender_title || '' }) }); if(resp.item){ toast('ТКП', `ТКП #${resp.item.id} создано`, 'ok'); location.hash = '#/tkp'; } else { toast('ТКП', 'ТКП создано', 'ok'); location.hash = '#/tkp'; } } catch(err){ toast('Ошибка', err.message, 'err'); } }

    async function openEst(id){
      const e = await AsgardDB.get('estimates', id);
      if(!e){ toast('Ошибка', 'Документ не найден', 'err'); return; }
      const t = tenders.find(x=>x.id===e.tender_id);
      const pm = byId.get(e.pm_id);
      const calcRaw = safeParseJSON(e.calc_summary_json, {});
      const calc = calcView(calcRaw);
      const sent = e.sent_for_approval_at ? new Date(e.sent_for_approval_at).toLocaleString('ru-RU') : '—';
      let approval = null; let events = []; let paymentSlips = [];
      try {
        const details = await apiFetch(`/estimates/${id}/approval`);
        approval = details.approval || null;
        events = details.events || [];
        paymentSlips = details.payment_slips || [];
        await syncEstimateLocally(details.estimate || e, approval);
      } catch(_){ approval = null; events = []; paymentSlips = []; }
      const paymentFlag = approval ? !!approval.requires_payment : !!e.requires_payment;
      const currentStage = approval ? stageLabel(approval.current_stage) : 'Не начато';
      const directorCanAct = canReviewAsDirector(user, approval);
      const accountingCanAct = canReviewAsAccounting(user, approval);
      const paidCanAct = canMarkPaid(user, approval);
      const sourceBadge = approval && approval.source_id ? `${sourceTypeLabel(approval.source_type)} #${approval.source_id}` : 'Не указан';
      const actionHint = directorCanAct ? 'Доступно: Согласовать / На доработку / Вопрос / Отклонить' : accountingCanAct ? 'Бухгалтерия: Принять / На доработку / Вопрос' : paidCanAct ? 'Для завершения оплаты приложите платежку, добавьте комментарий и нажмите «Оплачено».' : '';
      const actionsHtml = (directorCanAct || accountingCanAct || paidCanAct) ? `
        <hr class="hr"/>
        <div class="help"><b>Действия</b></div>
        ${actionHint ? `<div class="help" style="margin-top:6px">${esc(actionHint)}</div>` : ''}
        <div style="grid-column:1/-1; margin-top:8px">
          <label>Комментарий</label>
          <input id="approval_action_comment" value="" placeholder="Комментарий обязателен для действий «На доработку», «Вопрос», «Отклонить» и «Оплачено»"/>
        </div>
        ${paidCanAct ? `<div style="grid-column:1/-1; margin-top:8px"><label>Платежка</label><input id="approval_payment_slip" type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"/></div>` : ''}
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:12px">
          ${directorCanAct ? '<button class="btn" id="btnApprovalApprove">Согласовать</button><button class="btn ghost" id="btnApprovalRework">На доработку</button><button class="btn ghost" id="btnApprovalQuestion">Вопрос</button><button class="btn red" id="btnApprovalReject">Отклонить</button>' : ''}
          ${accountingCanAct ? '<button class="btn" id="btnApprovalApprove">Принять</button><button class="btn ghost" id="btnApprovalRework">На доработку</button><button class="btn ghost" id="btnApprovalQuestion">Вопрос</button>' : ''}
          ${paidCanAct ? '<button class="btn" id="btnApprovalPaid">Оплачено</button>' : ''}
        </div>
      ` : '';
      const pmHint = approval && approval.current_stage === 'pm_rework' ? `<div class="help" style="margin-top:10px">Документ возвращен с комментарием. После исправления его можно отправить на согласование повторно. ${esc(requiresPaymentLabel(paymentFlag))}.</div>` : '';
      const html = `
        <div style="max-height:80vh; overflow:auto">
          <div class="help"><b>${esc(t?.customer_name||"—")}</b> · ${esc(t?.tender_title||"—")}</div>
          <div class="help">РП: ${esc(pm?pm.name:'—')} · версия #${esc(e.version_no||1)} · статус: <b>${esc(statusLabel(e.approval_status||'draft'))}</b></div>
          <div class="row" style="gap:8px; flex-wrap:wrap; margin-top:10px">
            <span class="badge">Этап: <b>${esc(currentStage)}</b></span>
            <span class="badge">Источник: <b>${esc(sourceBadge)}</b></span>
            <span class="badge">${esc(requiresPaymentLabel(paymentFlag))}</span>
            <span class="badge">Отправлено: <b>${esc(sent)}</b></span>
          </div>
          <hr class="hr"/>
          <div class="kpi" style="grid-template-columns:repeat(4,minmax(160px,1fr))">
            <div class="k"><div class="t">Вероятность</div><div class="v">${esc(e.probability_pct||0)}%</div></div>
            <div class="k"><div class="t">Цена ТКП</div><div class="v">${money(e.price_tkp)} руб.</div></div>
            <div class="k"><div class="t">Себестоим. план</div><div class="v">${money(e.cost_plan)} руб.</div></div>
            <div class="k"><div class="t">Условия оплаты</div><div class="v" style="font-size:14px">${esc(e.payment_terms||'—')}</div></div>
          </div>
          <hr class="hr"/>
          <div class="help"><b>Расчет (сводка)</b></div>
          <div class="pill"><div class="who">Химия: ${calc.chemCost!=null?money(calc.chemCost):'—'} руб.</div><div class="role">Оборудование: ${calc.equipmentCost!=null?money(calc.equipmentCost):'—'} руб.</div></div>
          <div class="pill"><div class="who">Логистика: ${calc.logisticsCost!=null?money(calc.logisticsCost):'—'} руб.</div><div class="role">Люди/дни: ${esc(String(calc.peopleCount??'—'))} / ${esc(String(calc.workDays??'—'))}</div></div>
          ${calc.director?`<div class="row" style="gap:8px; flex-wrap:wrap; margin-top:10px">${calc.director.price_tkp_with_vat!=null?`<span class="badge">ТКП: <b>${money(calc.director.price_tkp_with_vat)}</b> руб.</span>`:''}${calc.director.cost_total!=null?`<span class="badge">Себестоим.: <b>${money(calc.director.cost_total)}</b> руб.</span>`:''}${calc.director.fot_with_taxes!=null?`<span class="badge">ФОТ+налоги: <b>${money(calc.director.fot_with_taxes)}</b> руб.</span>`:''}${calc.director.net_profit!=null?`<span class="badge">Чистая прибыль: <b>${money(calc.director.net_profit)}</b> руб.</span>`:''}${calc.director.profit_per_person_day!=null?`<span class="badge">Прибыль/чел-день: <b>${money(calc.director.profit_per_person_day)}</b> руб.</span>`:''}</div>`:''}
          <hr class="hr"/>
          <div class="help"><b>Сопроводительное письмо</b></div>
          <div class="panel" style="padding:12px">${esc(e.cover_letter||'')||'—'}</div>
          <hr class="hr"/>
          <div class="help"><b>Комментарий документа</b></div>
          <div class="panel" style="padding:12px">${esc(e.comment||'')||'—'}</div>
          <hr class="hr"/>
          <div class="help"><b>Комментарий согласующего</b></div>
          <div class="panel" style="padding:12px">${esc(e.approval_comment||'')||'—'}</div>
          ${pmHint}
          ${actionsHtml}
          <hr class="hr"/>
          <div class="help"><b>Платежки</b></div>
          <div style="margin-top:10px">${buildPaymentSlips(paymentSlips)}</div>
          <hr class="hr"/>
          <div class="help"><b>История согласования</b></div>
          <div style="margin-top:10px">${buildEvents(events)}</div>
        </div>`;
      showModal(`Согласование #${id}`, html);
      async function performJsonAction(path, payload, successMessage){ const response = await apiFetch(`/estimates/${id}${path}`, { method: 'POST', body: JSON.stringify(payload || {}) }); await syncEstimateLocally(response.estimate, response.approval); toast('Готово', successMessage, 'ok'); apply(); await openEst(id); }
      async function performPaidAction(){ const comment = (document.getElementById('approval_action_comment')?.value || '').trim(); const file = document.getElementById('approval_payment_slip')?.files?.[0]; if(!comment){ toast('Ошибка', 'Комментарий к оплате обязателен', 'err'); return; } if(!file){ toast('Ошибка', 'Приложите файл платежки', 'err'); return; } const formData = new FormData(); formData.append('comment', comment); formData.append('payment_slip', file); const response = await apiForm(`/estimates/${id}/approval/mark-paid`, formData); await syncEstimateLocally(response.estimate, response.approval); toast('Готово', 'Оплата подтверждена, платежка сохранена', 'ok'); apply(); await openEst(id); }
      const approveBtn = document.getElementById('btnApprovalApprove');
      const reworkBtn = document.getElementById('btnApprovalRework');
      const questionBtn = document.getElementById('btnApprovalQuestion');
      const rejectBtn = document.getElementById('btnApprovalReject');
      const paidBtn = document.getElementById('btnApprovalPaid');
      if(approveBtn){ approveBtn.addEventListener('click', async ()=>{ const comment = (document.getElementById('approval_action_comment')?.value || '').trim(); try { if(directorCanAct) await performJsonAction('/approval/approve-to-accounting', { comment }, paymentFlag ? 'Согласовано, следующий этап: бухгалтерия' : 'Согласовано'); else await performJsonAction('/approval/accept', { comment }, 'Принято, следующий этап: оплата'); } catch(err){ toast('Ошибка', err.message, 'err'); } }); }
      if(reworkBtn){ reworkBtn.addEventListener('click', async ()=>{ const comment = (document.getElementById('approval_action_comment')?.value || '').trim(); if(!comment){ toast('Ошибка', 'Комментарий для возврата обязателен', 'err'); return; } try { await performJsonAction('/approval/request-rework', { comment, rework_kind: 'rework' }, 'Отправлено на доработку'); } catch(err){ toast('Ошибка', err.message, 'err'); } }); }
      if(questionBtn){ questionBtn.addEventListener('click', async ()=>{ const comment = (document.getElementById('approval_action_comment')?.value || '').trim(); if(!comment){ toast('Ошибка', 'Комментарий для вопроса обязателен', 'err'); return; } try { await performJsonAction('/approval/request-rework', { comment, rework_kind: 'question' }, 'Вопрос отправлен'); } catch(err){ toast('Ошибка', err.message, 'err'); } }); }
      if(rejectBtn){ rejectBtn.addEventListener('click', async ()=>{ const comment = (document.getElementById('approval_action_comment')?.value || '').trim(); if(!comment){ toast('Ошибка', 'Причина отклонения обязательна', 'err'); return; } try { await performJsonAction('/approval/reject', { comment }, 'Отклонено'); } catch(err){ toast('Ошибка', err.message, 'err'); } }); }
      if(paidBtn){ paidBtn.addEventListener('click', async ()=>{ try { await performPaidAction(); } catch(err){ toast('Ошибка', err.message, 'err'); } }); }
      $$('[data-slip-url]').forEach((btn)=>{ btn.addEventListener('click', async ()=>{ try { await downloadWithAuth(btn.getAttribute('data-slip-url'), btn.getAttribute('data-slip-name')); } catch(err){ toast('Ошибка', err.message, 'err'); } }); });
    }

    await refreshEstimates();
    apply();
    $("#f_period").addEventListener("input",apply);
    $("#f_q").addEventListener("input",apply);
    $("#f_pm").addEventListener("change",apply);
    $("#f_a").addEventListener("change",apply);
    $$('[data-sort]').forEach((b)=>{ b.addEventListener('click', ()=>{ const k = b.getAttribute('data-sort'); if(sortKey===k) sortDir*=-1; else { sortKey=k; sortDir=1; } apply(); }); });
    tb.addEventListener('click',(ev)=>{
      const tr = ev.target.closest('tr[data-id]');
      if(!tr) return;
      const id = Number(tr.getAttribute('data-id'));
      const act = ev.target.getAttribute('data-act');
      if(act==='open'){ location.hash = `#/all-estimates?id=${id}`; openEst(id); }
      if(act==='create_tkp') createTkpFromEstimate(id);
    });
    const initialId = parseEstimateIdFromHash();
    if(initialId){ setTimeout(()=>{ openEst(initialId); }, 0); }
  }

  return { render };
})();
