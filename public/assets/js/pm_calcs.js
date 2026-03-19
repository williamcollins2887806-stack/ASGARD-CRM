window.AsgardPmCalcsPage = (function(){
  const { $, $$, esc, toast, showModal, money } = AsgardUI;
  const V = AsgardValidate;
  const isDirRole = (r)=> (window.AsgardAuth&&AsgardAuth.isDirectorRole)?AsgardAuth.isDirectorRole(r):(r==="DIRECTOR"||String(r||"").startsWith("DIRECTOR_"));

  function isoNow(){ return new Date().toISOString(); }
  function ymNow(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }
  function num(x){ if(x===null||x===undefined||x==="") return null; const n=Number(String(x).replace(/\s/g,"").replace(",", ".")); return Number.isFinite(n)?n:null; }
  function norm(s){ return String(s||"").toLowerCase().trim(); }
  function approvalStatusLabel(status){
    const map = { draft:"Черновик", sent:"На согласовании", approved:"Согласовано", approved_final:"Согласовано", rework:"На доработке", question:"Вопрос", rejected:"Отклонено", cancelled:"Отменено" };
    return map[String(status||"draft")] || String(status||"Черновик");
  }

  async function getCore(){
    const core = await AsgardDB.get("settings","app");
    return core ? JSON.parse(core.value_json||"{}") : {vat_pct:22, status_colors:{tender:{}, work:{}}};
  }
  async function getRefs(){
    const refs = await AsgardDB.get("settings","refs");
    return refs && refs.tender_statuses ? refs : {tender_statuses:[], reject_reasons:[]};
  }

  async function audit(actorId, entityType, entityId, action, payload){
    await AsgardDB.add("audit_log", { actor_user_id: actorId, entity_type: entityType, entity_id: entityId, action, payload_json: JSON.stringify(payload||{}), created_at: isoNow() });
  }

  async function notify(userId, title, message, link_hash){
    await AsgardDB.add("notifications", { user_id:userId, is_read:false, created_at: isoNow(), title, message, link_hash: link_hash||"#/pm-calcs" });
  }


  async function listQA(tender_id, estimate_id){
    let msgs = await AsgardDB.byIndex("qa_messages","estimate_id", estimate_id);
    msgs = (msgs||[]).filter(m=>m.tender_id===tender_id);
    msgs.sort((a,b)=> String(a.created_at||"").localeCompare(String(b.created_at||"")));
    return msgs;
  }
  async function addAnswer({tender_id, estimate_id, pm_id, from_user_id, text, question_id}){
    const msg = { tender_id, estimate_id, pm_id, from_user_id, from_role:"PM", type:"answer", text:String(text||""), question_id, is_open:false, created_at: new Date().toISOString() };
    return await AsgardDB.add("qa_messages", msg);
  }
  async function closeQuestion(question_id){
    const q = await AsgardDB.get("qa_messages", question_id);
    if(q){ q.is_open=false; await AsgardDB.put("qa_messages", q); }
  }


  async function hasOpenQuestion(tender_id, estimate_id){
    const msgs = await listQA(tender_id, estimate_id);
    return (msgs||[]).some(m=>m.type==="question" && m.is_open);
  }
  async function isAnswerRequired(){
    const app = await AsgardDB.get("settings","app");
    const cur = app ? JSON.parse(app.value_json||"{}") : {};
    return cur.require_answer_on_question !== false;
  }

  async function ensureWorkFromTender(tender){
    const exist = (await AsgardDB.byIndex("works","tender_id", tender.id))[0];
    if(exist) return exist;
    const work = {
      tender_id: tender.id,
      pm_id: tender.responsible_pm_id,
      customer_name: tender.customer_name,
      work_title: tender.tender_title,
      work_status: "Подготовка",
      start_in_work_date: tender.work_start_plan || null,
      end_plan: tender.work_end_plan || null,
      end_fact: null,
      contract_value: tender.tender_price || null,
      advance_pct: 30,
      advance_received: 0,
      advance_date_fact: null,
      act_signed_date_fact: null,
      delay_workdays: 5,
      balance_received: 0,
      payment_date_fact: null,
      cost_plan: null,
      cost_fact: null,
      comment: ""
    };
    const id = await AsgardDB.add("works", work);
    return await AsgardDB.get("works", id);
  }

  // === БЫСТРЫЙ ПРОСЧЁТ (ручная форма без калькулятора) ===
  async function openQuickCalcForm(tenderId, tender, est, core, user){
    const calc = est?.calc_summary_json ? JSON.parse(est.calc_summary_json) : {};
    const quick = est?.quick_calc_json ? JSON.parse(est.quick_calc_json) : calc;
    
    const html = `
      <style>
        .qc-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
        .qc-form>div{display:flex;flex-direction:column}
        .qc-form label{font-size:12px;color:var(--muted);margin-bottom:4px}
        .qc-form .full{grid-column:1/-1}
        .qc-section{background:var(--bg-card);border:none;border-radius:var(--radius-md);padding:16px;margin-bottom:16px}
        .qc-section h4{margin:0 0 12px;font-size:14px;color:var(--gold)}
        .qc-kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-top:16px}
        .qc-kpi .k{background:rgba(13,20,40,.5);border-radius:6px;padding:12px;text-align:center}
        .qc-kpi .k .t{font-size:11px;color:var(--muted)}
        .qc-kpi .k .v{font-size:18px;font-weight:700;color:var(--gold)}
        .qc-zone{padding:16px;border-radius:6px;text-align:center;margin-top:16px}
      </style>
      
      <div class="help" style="margin-bottom:16px">
        <b>Быстрый просчёт</b> — заполните ключевые показатели вручную. Директор увидит эти данные при согласовании.
        <div style="margin-top:4px">Заказчик: <b>${esc(tender.customer_name)}</b> · ${esc(tender.tender_title||"")}</div>
      </div>
      
      <div class="qc-section">
        <h4>📍 Объект</h4>
        <div class="qc-form">
          <div>
            <label>Город</label>
            <input class="inp" id="qc_city" value="${esc(quick.city||"")}" placeholder="Москва, Сургут..." list="qc_citylist">
            <datalist id="qc_citylist"></datalist>
          </div>
          <div>
            <label>Расстояние от Москвы, км</label>
            <input class="inp" id="qc_distance" type="number" min="0" value="${num(quick.distance_km)||0}">
          </div>
          <div>
            <label>Тип работы</label>
            <input class="inp" id="qc_work_type" value="${esc(quick.work_type||"")}" placeholder="Очистка теплообменников...">
          </div>
        </div>
      </div>
      
      <div class="qc-section">
        <h4>👷 Бригада и сроки</h4>
        <div class="qc-form">
          <div>
            <label>Количество людей</label>
            <input class="inp" id="qc_people" type="number" min="1" value="${num(quick.people_count)||8}">
          </div>
          <div>
            <label>Дней работы</label>
            <input class="inp" id="qc_days" type="number" min="1" value="${num(quick.work_days)||10}">
          </div>
          <div>
            <label>Чел-дней всего</label>
            <input class="inp" id="qc_pd" type="number" readonly value="${(num(quick.people_count)||8)*(num(quick.work_days)||10)}">
          </div>
        </div>
      </div>
      
      <div class="qc-section">
        <h4>💰 Финансы</h4>
        <div class="qc-form">
          <div>
            <label>Себестоимость (план), ₽</label>
            <input class="inp" id="qc_cost" type="number" min="0" value="${num(est?.cost_plan)||0}">
          </div>
          <div>
            <label>Цена ТКП (с НДС), ₽</label>
            <input class="inp" id="qc_price" type="number" min="0" value="${num(est?.price_tkp)||0}">
          </div>
          <div>
            <label>Вероятность, %</label>
            <input class="inp" id="qc_prob" type="number" min="0" max="100" value="${num(est?.probability_pct)||50}">
          </div>
          <div class="full">
            <label>Условия оплаты</label>
            <input class="inp" id="qc_terms" value="${esc(est?.payment_terms||"50% предоплата, остаток по акту")}" placeholder="50% предоплата...">
          </div>
        </div>
        
        <div class="qc-kpi" id="qc_kpi_block"></div>
        <div class="qc-zone" id="qc_zone_block"></div>
      </div>
      
      <div class="qc-section">
        <h4>📝 Для директора</h4>
        <div class="qc-form">
          <div class="full">
            <label>Допущения и риски</label>
            <textarea class="inp" id="qc_assumptions" rows="2" placeholder="Доступ на объект, требования заказчика, риски...">${esc(quick.assumptions||est?.assumptions||"")}</textarea>
          </div>
          <div class="full">
            <label>Комментарий РП</label>
            <input class="inp" id="qc_comment" value="${esc(est?.comment||"")}" placeholder="Важные замечания...">
          </div>
          <div class="full">
            <label>Сопроводительное письмо</label>
            <textarea class="inp" id="qc_cover" rows="3" placeholder="Кратко: что считаем, почему такая цена, ключевые риски...">${esc(est?.cover_letter||"")}</textarea>
          </div>
          <div class="full">
            <label style="display:flex; align-items:center; gap:8px">
              <input class="inp" id="qc_requires_payment" type="checkbox" style="width:auto" ${est?.requires_payment ? 'checked' : ''}>
              <span>Требуется оплата / участие бухгалтерии</span>
            </label>
            <div class="help">Если включено, после согласования директора заявка перейдет на этап бухгалтерии.</div>
          </div>
        </div>
      </div>
      
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" id="qc_save" style="flex:1">💾 Сохранить черновик</button>
        <button class="btn primary" id="qc_send">📤 Отправить на согласование</button>
      </div>
    `;
    
    showModal("📝 Быстрый просчёт", html);
    
    const vatPct = core.vat_pct || 22;
    const minPPD = core.calc?.min_profit_per_person_day || 20000;
    const normPPD = core.calc?.norm_profit_per_person_day || 25000;
    
    function updateKPI(){
      const people = num($("#qc_people").value) || 1;
      const days = num($("#qc_days").value) || 1;
      const cost = num($("#qc_cost").value) || 0;
      const price = num($("#qc_price").value) || 0;
      
      const pd = people * days;
      $("#qc_pd").value = pd;
      
      const priceNoVat = price / (1 + vatPct/100);
      const profit = priceNoVat - cost;
      const margin = price > 0 ? ((priceNoVat - cost) / priceNoVat * 100) : 0;
      const profitPD = pd > 0 ? profit / pd : 0;
      
      let status = "red", statusLabel = "🔴 КРАСНАЯ ЗОНА", statusColor = "#e03a4a";
      if(profitPD >= normPPD) { status = "green"; statusLabel = "🟢 ЗЕЛЁНАЯ ЗОНА"; statusColor = "var(--ok-t)"; }
      else if(profitPD >= minPPD) { status = "yellow"; statusLabel = "🟡 ЖЁЛТАЯ ЗОНА"; statusColor = "var(--amber)"; }
      
      $("#qc_kpi_block").innerHTML = `
        <div class="k"><div class="t">Цена без НДС</div><div class="v">${money(Math.round(priceNoVat))}</div></div>
        <div class="k"><div class="t">Прибыль</div><div class="v">${money(Math.round(profit))}</div></div>
        <div class="k"><div class="t">Маржа</div><div class="v">${margin.toFixed(1)}%</div></div>
      `;
      
      $("#qc_zone_block").innerHTML = `
        <div style="background:${statusColor}22;border:2px solid ${statusColor};border-radius:6px;padding:16px;text-align:center">
          <div style="font-size:14px;font-weight:700;color:${statusColor}">${statusLabel}</div>
          <div style="font-size:24px;font-weight:700;color:${statusColor};margin-top:8px">${money(Math.round(profitPD))}</div>
          <div style="font-size:11px;color:var(--muted)">прибыль / чел-день</div>
        </div>
      `;
    }
    
    // Привязка событий
    ["qc_people","qc_days","qc_cost","qc_price"].forEach(id => {
      const el = $("#"+id);
      if(el) el.addEventListener("input", updateKPI);
    });
    
    // Автоподсказка города
    const cityInp = $("#qc_city");
    if(cityInp){
      cityInp.addEventListener("input", ()=>{
        if(window.findCity){
          const dl = $("#qc_citylist");
          if(dl) dl.innerHTML = window.findCity(cityInp.value).map(c => `<option value="${c.name}">${c.name} (${c.km} км)</option>`).join("");
        }
      });
      cityInp.addEventListener("change", ()=>{
        if(window.getCityDistance){
          const km = window.getCityDistance(cityInp.value);
          if(km !== null) $("#qc_distance").value = km;
        }
      });
    }
    
    updateKPI();
    
    // Сохранить черновик
    $("#qc_save").addEventListener("click", async ()=>{
      const data = collectQuickData();
      await saveQuickEstimate(data, false);
      toast("Сохранено", "Черновик сохранён");
      AsgardUI.hideModal();
    });
    
    // Отправить на согласование
    $("#qc_send").addEventListener("click", async ()=>{
      const data = collectQuickData();
      if(!data.cover_letter){
        toast("Проверка", "Добавьте сопроводительное письмо", "err");
        return;
      }
      if(!data.price_tkp || data.price_tkp <= 0){
        toast("Проверка", "Укажите цену ТКП", "err");
        return;
      }
      await saveQuickEstimate(data, true);
      
      // Меняем статус тендера
      const cur = await AsgardDB.get("tenders", tenderId);
      cur.tender_status = "Согласование ТКП";
      await AsgardDB.put("tenders", cur);
      
      toast("Отправлено", "Просчёт отправлен на согласование");







      AsgardUI.hideModal();
    });
    
    function collectQuickData(){
      return {
        tender_id: tenderId,
        pm_id: tender.responsible_pm_id,
        probability_pct: num($("#qc_prob").value),
        cost_plan: num($("#qc_cost").value),
        price_tkp: num($("#qc_price").value),
        payment_terms: $("#qc_terms").value.trim(),
        comment: $("#qc_comment").value.trim(),
        cover_letter: $("#qc_cover").value.trim(),
        assumptions: $("#qc_assumptions").value.trim(),
        quick_calc_json: JSON.stringify({
          city: $("#qc_city").value.trim(),
          distance_km: num($("#qc_distance").value),
          work_type: $("#qc_work_type").value.trim(),
          people_count: num($("#qc_people").value),
          work_days: num($("#qc_days").value),
          assumptions: $("#qc_assumptions").value.trim()
        }),
        calc_summary_json: JSON.stringify({
          city: $("#qc_city").value.trim(),
          distance_km: num($("#qc_distance").value),
          people_count: num($("#qc_people").value),
          work_days: num($("#qc_days").value)
        }),
        requires_payment: !!($("#qc_requires_payment") && $("#qc_requires_payment").checked)
      };
    }
    
    async function saveQuickEstimate(data, sendForApproval){
      const v = await nextVersionNo(tenderId, tender.responsible_pm_id);
      const obj = {
        ...data,
        version_no: v,
        approval_status: sendForApproval ? "sent" : "draft",
        approval_comment: "",
        sent_for_approval_at: sendForApproval ? isoNow() : null,
        created_at: isoNow(),
        requires_payment: !!data.requires_payment
      };
      const id = await AsgardDB.add("estimates", obj);
      await audit(user.id, "estimate", id, sendForApproval ? "quick_send" : "quick_draft", { tender_id: tenderId, version_no: v });
      return id;
    }
  }

  // Stage 7: win -> director assigns PM to work
  async function createWorkAssignRequest({tender, actor}){
    // pick latest estimate (by created_at) for info card
    let ests = await AsgardDB.byIndex("estimates","tender_id", tender.id);
    ests = (ests||[]).filter(e=>Number(e.pm_id)===Number(tender.responsible_pm_id));
    ests.sort((a,b)=>String(b.created_at||"").localeCompare(String(a.created_at||"")));
    const last = ests[0]||null;

    const req = {
      tender_id: tender.id,
      source_pm_id: tender.responsible_pm_id,
      price_tkp: last ? (last.price_tkp??null) : null,
      cost_plan: last ? (last.cost_plan??null) : null,
      work_start_plan: tender.work_start_plan||null,
      work_end_plan: tender.work_end_plan||null,
      status: "pending",
      requested_at: isoNow(),
      requested_by_user_id: actor.id,
      assigned_pm_id: null,
      assigned_by_user_id: null,
      assigned_at: null,
      override_required: false,
      override_pm_id: null,
      override_status: null
    };
    const id = await AsgardDB.add("work_assign_requests", req);

    // notify all directors (3 роли DIRECTOR_*)
    try{
      const users = await AsgardDB.all("users");
      const dirs = (users||[]).filter(u=>Array.isArray(u.roles) && u.roles.some(r=>isDirRole(r)));
      for(const d of dirs){
        await notify(d.id, "Назначение РП на работу", `${tender.customer_name} — ${tender.tender_title}`, "#/tenders");
      }
    }catch(e){}
    return id;
  }

  async function hasApprovedOverride({request_id, pm_id}){
    try{
      const cons = await AsgardDB.all("pm_consents");
      return (cons||[]).some(c=>c.type==="overlap_override" && Number(c.request_id)===Number(request_id) && Number(c.pm_id)===Number(pm_id) && c.status==="approved");
    }catch(e){
      return false;
    }
  }

  function statusSelect(statuses, current){
    return statuses.filter(s=>s!=="Новый").map(s=>`<option value="${esc(s)}" ${(current===s)?"selected":""}>${esc(s)}</option>`).join("");
  }

  function calcDerived({price_tkp, cost_plan, vat_pct, people_count, work_days}){
    const price = num(price_tkp);
    const cost = num(cost_plan);
    const vat = Number(vat_pct) || 22;
    const noVat = (price!=null) ? (price/(1+vat/100)) : null;
    const margin = (noVat!=null && cost!=null && noVat>0) ? ((noVat-cost)/noVat) : null;
    const profit = (noVat!=null && cost!=null) ? (noVat-cost) : null;
    const denom = Math.max(1, (num(people_count)||0) * (num(work_days)||0));
    const profitPer = (profit!=null && denom>0) ? (profit/denom) : null;
    return { noVat, margin, profit, profitPer };
  }

  async function render({layout, title}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }
    const user = auth.user;

    const core = await getCore();
    const refs = await getRefs();
    const users = await AsgardDB.all("users");
    const byId = new Map(users.map(u=>[u.id,u]));
    const tendersAll = await AsgardDB.all("tenders");

    const isPM = user.role==="PM" || user.role==="ADMIN";
    const isDir = isDirRole(user.role) || user.role==="ADMIN";

    // PM sees only own; Director/Admin can see all handed-off
    let tenders = tendersAll.filter(t=>t.handoff_at);
    if(isPM) tenders = tenders.filter(t=>t.responsible_pm_id===user.id);

    const pms = users.filter(u=>u.role==="PM" || (Array.isArray(u.roles) && u.roles.includes("PM")));

    const body = `
      ${window.__ASG_SHARED_TABLE_CSS__||""}
      <style>
        .st{display:inline-flex; align-items:center; gap:8px}
        .dot{width:10px;height:10px;border-radius:999px; box-shadow:0 0 0 2px rgba(255,255,255,.05) inset}
      </style>

      <div class="panel">
        <div class="help">
          Inbox руководителя проекта: здесь живут тендеры после передачи на просчёт. Статус меняет только назначенный РП.
          Отказы скрываются фильтром, но доступны в любой момент через переключатель.
        </div>
        <hr class="hr"/>

        <div class="tools">
          <div class="field">
            <label>Период</label>
            <select id="f_period">${generatePeriodOptions(ymNow())}</select>
          </div>
          <div class="field">
            <label>Поиск</label>
            <input id="f_q" placeholder="заказчик / тендер / тег / ссылка" />
          </div>
          <div class="field">
            <label>Статус</label>
            <select id="f_status">
              <option value="">Все</option>
              ${refs.tender_statuses.filter(s=>s!=="Новый").map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join("")}
            </select>
          </div>

          ${isDir ? `
          <div class="field">
            <label>РП</label>
            <select id="f_pm">
              <option value="">Все</option>
              ${pms.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("")}
            </select>
          </div>` : ``}

          <div class="field" style="min-width:280px">
            <label>Показать</label>
            <div style="display:flex; gap:12px; flex-wrap:wrap; padding:10px 12px; border:none; border-radius:var(--radius-sm); background:var(--bg-card)">
              <label style="display:flex; gap:8px; align-items:center"><input id="f_refused" type="checkbox"/> Отказы</label>
              <label style="display:flex; gap:8px; align-items:center"><input id="f_allperiod" type="checkbox"/> Все периоды</label>
              <label style="display:flex; gap:8px; align-items:center"><input id="f_won" type="checkbox"/> Выигранные (архив)</label>
            </div>
          </div>

          <div style="display:flex; gap:10px; flex-wrap:wrap">
            <button class="btn ghost" id="btnReset">Сброс</button>
          </div>
        </div>

        <hr class="hr"/>

        <div style="overflow:auto">
          <table class="asg">
            <thead>
              <tr>
                <th>Заказчик / Тендер</th>
                ${isDir ? `<th>РП</th>` : ``}
                <th>Статус</th>
                <th>Сроки (план)</th>
                <th>Сумма</th>
                <th>Документы</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="tb"></tbody>
          </table>
        </div>
        <div class="help" id="cnt"></div>
      </div>
    `;

    await layout(body, {title: title||"Карта Похода • Просчёты", rightBadges:[`НДС: ${core.vat_pct||22}%`]});

    const tb=$("#tb"), cnt=$("#cnt");

    function statusCell(s){
      const c = (core.status_colors?.tender||{})[s] || "var(--t2)";
      return `<span class="st"><span class="dot" style="background:${c}"></span>${esc(s||"")}</span>`;
    }

    function row(t){
      const fmtDate = AsgardUI.formatDate || (d => d ? new Date(d).toLocaleDateString('ru-RU') : '—');
      const ds = fmtDate(t.work_start_plan);
      const de = fmtDate(t.work_end_plan);
      const link = t.purchase_url ? `<a class="btn ghost" style="padding:6px 10px" target="_blank" href="${esc(t.purchase_url)}">Площадка</a>` : "";
      const pmName = (byId.get(t.responsible_pm_id)||{}).name || "—";
      return `<tr data-id="${t.id}">
        <td><b>${esc(t.customer_name||"")}</b><div class="help">${esc(t.tender_title||"")}</div></td>
        ${isDir ? `<td>${esc(pmName)}</td>` : ``}
        <td>${statusCell(t.tender_status)}</td>
        <td>${ds} → ${de}</td>
        <td>${t.tender_price!=null?money(t.tender_price):"—"}</td>
        <td>
          <div class="row" style="gap:8px; flex-wrap:wrap">
            <a class="btn ghost" style="padding:8px 12px" href="#/gantt-calcs">Гантт (полный)</a>
            <button class="btn ghost" style="padding:6px 10px" data-act="docs">Комплект</button>
            ${link?link:"<span class=\"help\">—</span>"}
          </div>
        </td>
        <td><button class="btn" style="padding:6px 10px" data-act="open">Открыть</button></td>
      </tr>`;
    }

    function apply(){
      const q = norm($("#f_q").value);
      const period = norm($("#f_period").value);
      const st = $("#f_status").value;
      const showRef = $("#f_refused").checked;
      const allPeriod = $("#f_allperiod").checked;
      const showWon = $("#f_won").checked;
      const pmFilter = isDir ? $("#f_pm").value : "";

      let list = tenders.slice();

      if(!allPeriod){
        list = list.filter(t=>norm(t.period)===period);
      }
      if(!showRef){
        list = list.filter(t=>t.tender_status!=="Клиент отказался");
      }
      if(!showWon){
        list = list.filter(t=>t.tender_status!=="Клиент согласился");
      }
      if(st){
        list = list.filter(t=>t.tender_status===st);
      }
      if(isDir && pmFilter){
        list = list.filter(t=>String(t.responsible_pm_id||"")===String(pmFilter));
      }
      if(q){
        list = list.filter(t=>{
          const hay = `${t.customer_name||""} ${t.tender_title||""} ${t.group_tag||""} ${t.purchase_url||""}`.toLowerCase();
          return hay.includes(q);
        });
      }

      // newest first
      list.sort((a,b)=>Number(b.id)-Number(a.id));

      tb.innerHTML = list.map(row).join("");
      cnt.textContent = `Показано: ${list.length} из ${tenders.length}.`;
    }

    apply();

    $("#f_q").addEventListener("input", apply);
    $("#f_period").addEventListener("input", apply);
    $("#f_status").addEventListener("change", apply);
    $("#f_refused").addEventListener("change", apply);
    $("#f_allperiod").addEventListener("change", apply);
    $("#f_won").addEventListener("change", apply);
    if(isDir) $("#f_pm").addEventListener("change", apply);

    $("#btnReset").addEventListener("click", ()=>{
      $("#f_q").value="";
      $("#f_period").value=ymNow();
      $("#f_status").value="";
      $("#f_refused").checked=false;
      $("#f_allperiod").checked=false;
      $("#f_won").checked=false;
      if(isDir) $("#f_pm").value="";
      apply();
    });

    tb.addEventListener("click", async (e)=>{
      const tr=e.target.closest("tr[data-id]");
      if(!tr) return;
      const tenderId = Number(tr.getAttribute("data-id"));
      if(e.target.getAttribute("data-act")==="open"){
        openTender(tenderId);
      }
      if(e.target.getAttribute("data-act")==="docs"){
        // Открыть комплект документов для тендера
        const tender = tenders.find(t => t.id === tenderId);
        const workRes = tender ? await AsgardDB.byIndex("works","tender_id", tenderId) : [];
        const work = workRes[0] || null;
        if (typeof openDocsPack === 'function') {
          openDocsPack({ tender_id: tenderId, work_id: work?.id, purchase_url: tender?.purchase_url });
        } else if (typeof AsgardDocsPack !== 'undefined') {
          await AsgardDocsPack.ensurePack({ tender_id: tenderId, work_id: work?.id });
          const docs = await AsgardDocsPack.docsFor({ tender_id: tenderId, work_id: work?.id });
          const html = docs.length
            ? docs.map(d => `<div style="padding:6px 0;font-size:13px"><b>${AsgardUI.esc(d.type||'Документ')}</b> — <a target="_blank" href="${AsgardUI.esc(d.download_url||d.file_url||'#')}">${AsgardUI.esc(d.name||'ссылка')}</a></div>`).join('')
            : '<div class="help">Документов пока нет</div>';
          AsgardUI.showModal({ title: 'Комплект документов', html: `<div>${html}</div>`, wide: false });
        } else {
          // Fallback: показать файлы из API
          try {
            const auth = await AsgardAuth.getAuth();
            const res = await fetch(`/api/files/?tender_id=${tenderId}`, { headers: { 'Authorization': 'Bearer ' + auth.token } });
            const data = await res.json();
            if (data.files?.length) {
              const html = data.files.map(f => `<div style="padding:6px 0;font-size:13px">📄 <a href="/api/files/download/${f.filename}" target="_blank">${AsgardUI.esc(f.original_name)}</a> <span class="help">(${f.type||'Документ'})</span></div>`).join('');
              AsgardUI.showModal({ title: 'Документы тендера', html: `<div>${html}</div>` });
            } else {
              AsgardUI.toast('Документы', 'Нет прикреплённых документов');
            }
          } catch(err) { AsgardUI.toast('Ошибка', err.message, 'err'); }
        }
      }
    });

    async function latestEstimate(tenderId, pmId){
      const all = await AsgardDB.byIndex("estimates","tender_id", tenderId);
      const mine = all.filter(x=>x.pm_id===pmId);
      mine.sort((a,b)=>(b.version_no||0)-(a.version_no||0));
      return mine[0]||null;
    }

    async function nextVersionNo(tenderId, pmId){
      const all = await AsgardDB.byIndex("estimates","tender_id", tenderId);
      const mine = all.filter(x=>x.pm_id===pmId);
      const max = mine.reduce((m,x)=>Math.max(m, Number(x.version_no||0)), 0);
      return max+1;
    }

    async function openTender(tenderId){
      const tender = await AsgardDB.get("tenders", tenderId);
      if(!tender){ toast("Тендер","Не найден","err"); return; }

      // rights: PM only own, director/admin can view
      if(isPM && tender.responsible_pm_id!==user.id){
        toast("Доступ","Этот тендер закреплён за другим РП","err");
        return;
      }

      const pm = byId.get(tender.responsible_pm_id)||{};
      const statusColor = (core.status_colors?.tender||{})[tender.tender_status] || "var(--t2)";
      const canEditStatus = (isPM && tender.responsible_pm_id===user.id) || user.role==="ADMIN";

      const est = await latestEstimate(tenderId, tender.responsible_pm_id);
      const estStatus = est ? approvalStatusLabel(est.approval_status||"draft") : "Черновик";

      const calc = est ? (JSON.parse(est.calc_summary_json||"{}")||{}) : {};

      const derived = calcDerived({
        price_tkp: est?est.price_tkp:null,
        cost_plan: est?est.cost_plan:null,
        vat_pct: core.vat_pct,
        people_count: calc.people_count,
        work_days: calc.work_days
      });

      const ganttHtml = AsgardGantt.renderMini({
        startIso: core.gantt_start_iso || "2026-01-01",
        weeks: 24,
        barStart: tender.work_start_plan || "2026-02-01",
        barEnd: tender.work_end_plan || "2026-02-08",
        barLabel: `${tender.customer_name||""} — ${tender.tender_title||""}`,
        barColor: statusColor
      });

      const docs = tender.purchase_url ? `<a target="_blank" class="btn ghost" href="${esc(tender.purchase_url)}">Скачать/открыть комплект</a>` : `<span class="help">Ссылка не задана.</span>`;

      const html = `
        <div class="help">
          <b>${esc(pm.name||"")}</b> · статус: <span style="color:${statusColor}; font-weight:900">${esc(tender.tender_status)}</span>
          <div class="help">ᚱ Помни: порядок в данных — порядок в деньгах.</div>
        </div>

        <hr class="hr"/>

        <div class="panel" style="margin:0">
          <div class="help"><b>Кратко по тендеру</b></div>
          <div class="formrow">
            <div><label>Период</label><input autocomplete="off" disabled value="${esc(tender.period||"")}"/></div>
            <div><label>Заказчик</label><input autocomplete="off" disabled value="${esc(tender.customer_name||"")}"/></div>
            <div style="grid-column:1/-1"><label>Тендер</label><input autocomplete="off" disabled value="${esc(tender.tender_title||"")}"/></div>
            <div><label>Сумма</label><input autocomplete="off" disabled value="${tender.tender_price!=null?money(tender.tender_price):""}"/></div>
            <div><label>Сроки (план)</label><input autocomplete="off" disabled value="${esc(tender.work_start_plan||"")} → ${esc(tender.work_end_plan||"")}"/></div>
            <div><label>Документы</label><div style="padding-top:6px">${docs}</div></div>
            <div style="grid-column:1/-1"><label>Комментарий ТО</label><input autocomplete="off" disabled value="${esc(tender.tender_comment_to||"")}"/></div>
          </div>
        </div>

        <hr class="hr"/>

        <div class="panel" style="margin:0">
          <div class="help"><b>Сроки на карте (Гантт · недельная шкала)</b></div>
          <div style="margin-top:10px">${ganttHtml}</div>
        </div>

        <hr class="hr"/>

        <div class="panel" style="margin:0">
          <div class="help"><b>Статус тендера (после передачи — только РП)</b></div>
          <div class="formrow">
            <div>
              <label>Статус</label>
              <select id="s_status" ${canEditStatus?"":"disabled"}>
                ${statusSelect(refs.tender_statuses, tender.tender_status)}
              </select>
              <div class="help">«Отправлено на просчёт» ставит ТО кнопкой передачи.</div>
            </div>
            <div>
              <label>Причина отказа (если «Клиент отказался»)</label>
              <select id="s_reject" ${canEditStatus?"":"disabled"}>
                <option value="">—</option>
                ${refs.reject_reasons.map(r=>`<option value="${esc(r)}" ${(tender.reject_reason===r)?"selected":""}>${esc(r)}</option>`).join("")}
              </select>
            </div>
          </div>
          <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px">
            <button class="btn" id="btnSaveStatus" ${canEditStatus?"":"disabled"}>Сохранить статус</button>
            ${(user.role==="ADMIN" || isDirRole(user.role)) ? `<button class="btn ghost" id="btnHistory">История</button>` : ``}
          </div>
        </div>

        <hr class="hr"/>

        <div class="panel" style="margin:0">
          <div class="help"><b>Просчёт (Estimate)</b> · версия: <b>${est?esc(String(est.version_no||1)):"—"}</b> · согласование: <b>${esc(estStatus)}</b></div>
          ${est && est.approval_comment ? `<div class="help" style="margin-top:6px">Комментарий Ярла: <b>${esc(est.approval_comment)}</b></div>` : ``}

          <div class="formrow" style="margin-top:10px">
            <div>
              <label>Вероятность, %</label>
              <input id="e_prob" value="${esc(est?String(est.probability_pct??""):"")}" placeholder="0..100"/>
            </div>
            <div>
              <label>Себестоимость (план), ₽</label>
              <input id="e_cost" value="${esc(est?String(est.cost_plan??""):"")}" placeholder="например: 900000"/>
            </div>
            <div>
              <label>Цена ТКП (с НДС), ₽</label>
              <input id="e_price" value="${esc(est?String(est.price_tkp??""):"")}" placeholder="например: 1200000"/>
              <div class="help">НДС берём из «Кузницы Настроек» (пока seed).</div>
            </div>
            <div style="grid-column:1/-1">
              <label>Условия оплаты</label>
              <input id="e_terms" value="${esc(est?String(est.payment_terms||""):"")}" placeholder="50% предоплата, остаток 5 банковских дней..."/>
            </div>

            <div style="grid-column:1/-1; display:flex; gap:10px; flex-wrap:wrap; align-items:center">
              <button class="btn primary" id="btnCalc" ${isPM?"":"disabled"}>ᚱ Рунический калькулятор</button>
              <button class="btn" id="btnQuickCalc" ${isPM?"":"disabled"}>📝 Быстрый просчёт</button>
              <button class="btn ghost" id="btnCalcView" ${(calc && Object.keys(calc).length)?"":"disabled"}>Итоги расчёта</button>
            </div>
            <div class="help" style="grid-column:1/-1">
              <b>Рунический калькулятор</b> — полный расчёт с автоподбором бригады, химии, оборудования.<br>
              <b>Быстрый просчёт</b> — ручной ввод итоговых цифр без детализации.
            </div>

            <div>
              <label>Людей, чел.</label>
              <input id="c_people" value="${esc(String(calc.people_count||""))}" placeholder="10"/>
            </div>
            <div>
              <label>Длительность, дней</label>
              <input id="c_days" value="${esc(String(calc.work_days||""))}" placeholder="10"/>
            </div>
            <div>
              <label>Город</label>
              <input id="c_city" value="${esc(String(calc.city||""))}" placeholder="Москва, Сургут..."/>
            </div>
            <div>
              <label>Расстояние от Москвы, км</label>
              <input id="c_distance" type="number" value="${esc(String(calc.distance_km||""))}" placeholder="0"/>
            </div>
            <div style="grid-column:1/-1">
              <label>Комментарий РП</label>
              <input id="e_comm" value="${esc(est?String(est.comment||""):"")}" placeholder="важные допущения/риски/условия"/>
            </div>
            <div style="grid-column:1/-1">
              <label>Допущения и риски</label>
              <textarea id="e_assumptions" rows="2" placeholder="Доступ на объект, требования заказчика, возможные риски...">${esc(est?String(est.assumptions||calc.assumptions||""):"")}</textarea>
            </div>

            <div style="grid-column:1/-1">
              <label>Сопроводительное письмо директору</label>
              <textarea id="e_cover" placeholder="Кратко: что считаем, допущения, ключевые риски, что нужно утвердить...">${esc(est?String(est.cover_letter||""):"")}</textarea>
              <div class="help">Отправляется вместе с запросом на согласование.</div>
            </div>
            <div style="grid-column:1/-1">
              <label style="display:flex; align-items:center; gap:8px">
                <input id="e_requires_payment" type="checkbox" style="width:auto" ${est && est.requires_payment ? 'checked' : ''}/>
                <span>Требуется оплата / участие бухгалтерии</span>
              </label>
              <div class="help">Если включено, после директора смета уйдёт в бухгалтерию.</div>
            </div>
          </div>

          <hr class="hr"/>

          <div style="display:flex; gap:10px; flex-wrap:wrap">
            <div class="pill">
              <div class="who"><b>Цена без НДС:</b> ${derived.noVat!=null?money(Math.round(derived.noVat)):"—"} ₽</div>
              <div class="role">НДС ${core.vat_pct||22}%</div>
            </div>
            <div class="pill">
              <div class="who"><b>Маржа:</b> ${derived.margin!=null?`${Math.round(derived.margin*100)}%`:"—"}</div>
              <div class="role">по плану</div>
            </div>
            <div class="pill">
              <div class="who"><b>Прибыль:</b> ${derived.profit!=null?money(Math.round(derived.profit)):"—"} ₽</div>
              <div class="role">Цена − Себест.</div>
            </div>
            <div class="pill">
              <div class="who"><b>Прибыль/чел‑день:</b> ${derived.profitPer!=null?money(Math.round(derived.profitPer)):"—"} ₽</div>
              <div class="role">MVP</div>
            </div>
          </div>

          <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:12px">
            <button class="btn" id="btnSaveDraft">Сохранить</button>
            <button class="btn ghost" id="btnNewVersion">Сохранить новую версию</button>
            <button class="btn red" id="btnSend" ${(!isPM && user.role!=="ADMIN")?"disabled":""}>Отправить на согласование</button>
            <button class="btn ghost" id="btnVersions">Версии</button>
          </div>

          <div class="help" style="margin-top:10px">ᚦ Сначала счёт. Потом слово. Так держится казна.</div>
        </div>
      `;

      showModal(`Просчёт — тендер #${tender.id}`, html);

      // History for tender
      if($("#btnHistory")){
        $("#btnHistory").addEventListener("click", async ()=>{
          const logs = (await AsgardDB.all("audit_log"))
            .filter(l=>l.entity_type==="tender" && l.entity_id===tenderId)
            .sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
          const rows = logs.map(l=>`<div class="pill"><div class="who"><b>${esc(l.action)}</b> — ${esc(new Date(l.created_at).toLocaleString("ru-RU"))}</div><div class="role">${esc((byId.get(l.actor_user_id)||{}).login||"")}</div></div>
            <div class="help" style="margin:6px 0 10px">${esc(l.payload_json||"")}</div>`).join("");
          showModal("История тендера", rows || `<div class="help">Пока пусто.</div>`);
        });
      }

      $("#btnSaveStatus").addEventListener("click", async ()=>{
        if(!canEditStatus){ toast("Права","Недоступно","err"); return; }
        const st = $("#s_status").value;
        const rej = $("#s_reject").value || null;
        if(st==="Клиент отказался" && !rej){
          toast("Проверка","Для отказа требуется причина","err"); return;
        }
        const cur = await AsgardDB.get("tenders", tenderId);

        // Only PM (assigned) can change after handoff; ADMIN override
        if(user.role==="PM" && cur.responsible_pm_id!==user.id){
          toast("Права","Только назначенный РП может менять статус","err"); return;
        }

        const before = {status:cur.tender_status, reject_reason:cur.reject_reason};
        cur.tender_status = st;
        cur.reject_reason = (st==="Клиент отказался") ? rej : null;
        await AsgardDB.put("tenders", cur);
        await audit(user.id,"tender",tenderId,"status_change",{before, after:{status:st, reject_reason:cur.reject_reason}});

        if(st==="Клиент согласился"){
          const w = await ensureWorkFromTender(cur);
          await audit(user.id,"work",w.id,"auto_create_from_tender",{tender_id:tenderId});
          await notify(cur.responsible_pm_id, "Тендер согласован", "Создана работа в разделе «Работы».", "#/pm-works");
        }

        toast("Статус","Сохранено");
        // refresh local list
        tendersAll.splice(tendersAll.findIndex(x=>x.id===tenderId),1,cur);
        tenders = tenders.map(x=>x.id===tenderId?cur:x);
        apply();
        openTender(tenderId);
      });

      async function collectEstimate(){
        // Собираем данные из быстрого просчёта
        const quickCalc = {
          people_count: num($("#c_people").value),
          work_days: num($("#c_days").value),
          city: ($("#c_city")?.value || "").trim(),
          distance_km: num($("#c_distance")?.value),
          assumptions: ($("#e_assumptions")?.value || "").trim()
        };
        
        const payload = {
          tender_id: tenderId,
          pm_id: tender.responsible_pm_id,
          probability_pct: num($("#e_prob").value),
          cost_plan: num($("#e_cost").value),
          price_tkp: num($("#e_price").value),
          payment_terms: $("#e_terms").value.trim(),
          calc_summary_json: (est && est.calc_summary_json) ? est.calc_summary_json : JSON.stringify(quickCalc),
          quick_calc_json: JSON.stringify(quickCalc),
          assumptions: quickCalc.assumptions,
          comment: $("#e_comm").value.trim(),
          cover_letter: $("#e_cover").value.trim(),
          requires_payment: !!($("#e_requires_payment") && $("#e_requires_payment").checked),
        };
        // minimal validation
        if(payload.probability_pct!=null && (payload.probability_pct<0 || payload.probability_pct>100)){
          toast("Проверка","Вероятность 0..100","err"); return null;
        }
        if(payload.price_tkp!=null && payload.price_tkp<0){ toast("Проверка","Цена не может быть отрицательной","err"); return null; }
        if(payload.cost_plan!=null && payload.cost_plan<0){ toast("Проверка","Себестоимость не может быть отрицательной","err"); return null; }
        return payload;
      }

      async function saveDraft(createNewVersion){
        if(!(isPM || user.role==="ADMIN")){ toast("Права","Только РП/админ","err"); return; }
        const data = await collectEstimate();
        if(!data) return;

        const curT = await AsgardDB.get("tenders", tenderId);
        if(user.role==="PM" && curT.responsible_pm_id!==user.id){
          toast("Права","Только назначенный РП","err"); return;
        }

        if(!createNewVersion && est && (est.approval_status==="draft" || !est.approval_status)){
          const upd = Object.assign({}, est, data, { updated_at: isoNow() });

      if(est.probability_pct!==null && est.probability_pct!==undefined){
        const p = Number(est.probability_pct);
        if(!Number.isFinite(p) || p<0 || p>100){ toast("Валидация","Вероятность должна быть 0..100","err"); return; }
      }
      const mf=["cost_plan","price_tkp"];
      for(const f of mf){ if(est[f]!==null && est[f]!==undefined && !V.moneyGE0(est[f])){ toast("Валидация",`Поле ${f}: число >= 0`,"err"); return; } }
          await AsgardDB.put("estimates", upd);
          await audit(user.id,"estimate",upd.id,"update_draft",{tender_id:tenderId, version_no:upd.version_no});
          toast("Просчёт","Сохранено (черновик)");
          return upd;
        }else{
          const v = await nextVersionNo(tenderId, tender.responsible_pm_id);
          const obj = Object.assign({}, data, {
            version_no: v,
            approval_status: "draft",
            approval_comment: "",
            sent_for_approval_at: null,
            created_at: isoNow()
          });
          const id = await AsgardDB.add("estimates", obj);
          await audit(user.id,"estimate",id,"create_version",{tender_id:tenderId, version_no:v});
          toast("Просчёт",`Сохранено (версия ${v})`);
          return await AsgardDB.get("estimates", id);
        }
      }

      $("#btnSaveDraft").addEventListener("click", async ()=>{ await saveDraft(false); openTender(tenderId); });
      $("#btnNewVersion").addEventListener("click", async ()=>{ await saveDraft(true); openTender(tenderId); });

      // Calculator
      const btnCalc = $("#btnCalc");
      if(btnCalc){
        btnCalc.addEventListener("click", async ()=>{
          if(!(isPM || user.role==="ADMIN")) { toast("Права","Только РП/админ","err"); return; }
          const tcur = await AsgardDB.get("tenders", tenderId);
          const estCur = await loadLatestEstimate(tenderId, tcur.responsible_pm_id);
          // Используем калькулятор v2 если доступен
          if(window.AsgardCalcV2 && AsgardCalcV2.open){
            await AsgardCalcV2.open({ tender: tcur, estimate: estCur, user: user });
          } else if(window.AsgardCalc && AsgardCalc.open){
            const ok = await AsgardCalc.open({ tender: tcur, estimate: estCur, actor_user: user });
            if(ok){ openTender(tenderId); }
          }else{
            toast("Калькулятор","Модуль калькулятора не подключён","err");
          }
        });
      }
      
      // Кнопка "Быстрый просчёт" — открывает форму ручного ввода
      const btnQuickCalc = $("#btnQuickCalc");
      if(btnQuickCalc){
        btnQuickCalc.addEventListener("click", async ()=>{
          if(!(isPM || user.role==="ADMIN")) { toast("Права","Только РП/админ","err"); return; }
          openQuickCalcForm(tenderId, tender, est, core, user);
        });
      }
      
      const btnCalcView = $("#btnCalcView");
      if(btnCalcView){
        btnCalcView.addEventListener("click", async ()=>{
          const tcur = await AsgardDB.get("tenders", tenderId);
          const estCur = await loadLatestEstimate(tenderId, tcur.responsible_pm_id);
          // Показываем калькулятор v2 для просмотра итогов
          if(window.AsgardCalcV2 && AsgardCalcV2.open && estCur?.calc_v2_json){
            await AsgardCalcV2.open({ tender: tcur, estimate: estCur, user: user });
          } else {
            const calc = safeParse(estCur && estCur.calc_summary_json, {});
            if(window.AsgardCalc && AsgardCalc.view) AsgardCalc.view(calc);
          }
        });
      }

      $("#btnVersions").addEventListener("click", async ()=>{
        const all = (await AsgardDB.byIndex("estimates","tender_id", tenderId))
          .filter(x=>x.pm_id===tender.responsible_pm_id)
          .sort((a,b)=>(b.version_no||0)-(a.version_no||0));
        const rows = all.map(x=>{
          const d = calcDerived({price_tkp:x.price_tkp,cost_plan:x.cost_plan,vat_pct:core.vat_pct,people_count:0,work_days:0});
          return `<div class="pill" style="gap:10px">
            <div class="who"><b>v${esc(String(x.version_no||0))}</b> · ${esc(approvalStatusLabel(x.approval_status||"draft"))} · ${esc(new Date((x.sent_for_approval_at||x.created_at||isoNow())).toLocaleString("ru-RU"))}</div>
            <div class="role">Маржа: ${d.margin!=null?`${Math.round(d.margin*100)}%`:"—"} · Цена: ${x.price_tkp!=null?money(x.price_tkp):"—"}</div>
          </div>
          <div class="help" style="margin:6px 0 10px">${esc(x.comment||"")}</div>`;
        }).join("");
        showModal("Версии просчёта", rows || `<div class="help">Пока нет версий.</div>`);
      });

      $("#btnSend").addEventListener("click", async ()=>{
        if(!(isPM || user.role==="ADMIN")){ toast("Права","Только РП/админ","err"); return; }
        const data = await collectEstimate();
        if(!data) return;

        if(!data.cover_letter){
          toast("Проверка","Добавьте сопроводительное письмо (хотя бы 2–3 строки)","err");
          return;
        }

        // snapshot as new version, status=sent
        const v = await nextVersionNo(tenderId, tender.responsible_pm_id);
        const obj = Object.assign({}, data, {
          version_no: v,
          approval_status: "sent",
          approval_comment: "",
          sent_for_approval_at: isoNow(),
          created_at: isoNow()
        });
        const id = await AsgardDB.add("estimates", obj);
        await audit(user.id,"estimate",id,"send_for_approval",{tender_id:tenderId, version_no:v});

        // set tender status to "Согласование ТКП"
        const cur = await AsgardDB.get("tenders", tenderId);
        const before = cur.tender_status;
        cur.tender_status = "Согласование ТКП";
        await AsgardDB.put("tenders", cur);
        await audit(user.id,"tender",tenderId,"status_change_auto",{before, after:"Согласование ТКП"});

        toast("Согласование","Просчёт отправлен на согласование");
        // refresh list
        tendersAll.splice(tendersAll.findIndex(x=>x.id===tenderId),1,cur);
        tenders = tenders.map(x=>x.id===tenderId?cur:x);
        apply();
        openTender(tenderId);
      });
    }
  }

  return { render };
})();
