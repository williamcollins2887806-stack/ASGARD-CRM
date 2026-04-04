window.AsgardApprovalsPage = (function(){
  const { $, esc, toast, showModal, money } = AsgardUI;
  const isDirRole = (r)=> (window.AsgardAuth&&AsgardAuth.isDirectorRole)?AsgardAuth.isDirectorRole(r):(r==="DIRECTOR"||String(r||"").startsWith("DIRECTOR_"));
  function isoNow(){ return new Date().toISOString(); }

  async function isAnswerRequired(){
    const app = await AsgardDB.get("settings","app");
    const cur = app ? JSON.parse(app.value_json||"{}") : {};
    return cur.require_answer_on_question !== false;
  }
  async function hasOpenQuestion(tender_id, estimate_id){
    let msgs = await AsgardDB.byIndex("qa_messages","estimate_id", estimate_id);
    msgs = (msgs||[]).filter(m=>m.tender_id===tender_id);
    return msgs.some(m=>m.type==="question" && m.is_open);
  }

  function ymNow(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }
  function norm(s){ return String(s||"").toLowerCase().trim(); }
  function num(x){ if(x===null||x===undefined||x==="") return null; const n=Number(String(x).replace(/\s/g,"").replace(",", ".")); return Number.isFinite(n)?n:null; }
  // Цветные pill-стили для статусов
  const STATUS_COLORS = {
    draft:    { color:'#6b7280', bg:'rgba(107,114,128,.12)' },
    sent:     { color:'#3b82f6', bg:'rgba(59,130,246,.12)' },
    approved: { color:'#22c55e', bg:'rgba(34,197,94,.12)' },
    rework:   { color:'#f59e0b', bg:'rgba(245,158,11,.12)' },
    question: { color:'#a855f7', bg:'rgba(168,85,247,.12)' },
    rejected: { color:'#ef4444', bg:'rgba(239,68,68,.12)' },
    cancelled:{ color:'#6b7280', bg:'rgba(107,114,128,.12)' }
  };
  function statusPill(status, label) {
    const s = STATUS_COLORS[status] || STATUS_COLORS.draft;
    return `<span style="display:inline-block;padding:3px 8px;border-radius:5px;font-size:11px;font-weight:600;color:${s.color};background:${s.bg};border:1px solid ${s.color}30">${esc(label)}</span>`;
  }
  function normalizeLinkValue(value){
    const raw = String(value || '').trim();
    if(!raw) return '';
    const lower = raw.toLowerCase();
    if(lower === 'undefined' || lower === 'null' || raw === '#') return '';
    return raw;
  }

  function buildDocumentLink(doc){
    if(!doc || typeof doc !== 'object') return '';
    const direct = normalizeLinkValue(doc.download_url) || normalizeLinkValue(doc.file_url);
    if(direct) return direct;
    const attachmentPath = normalizeLinkValue(doc.attachment_path || doc.file_path);
    if(attachmentPath){
      if(/^(https?:|data:|blob:|\/)/i.test(attachmentPath)) return attachmentPath;
      const uploadsIndex = attachmentPath.indexOf('uploads/');
      if(uploadsIndex >= 0) return '/' + attachmentPath.slice(uploadsIndex);
      const fileName = attachmentPath.split('/').pop();
      return fileName ? `/api/files/download/${encodeURIComponent(fileName)}` : '';
    }
    const filename = normalizeLinkValue(doc.filename);
    return filename ? `/api/files/download/${encodeURIComponent(filename)}` : '';
  }

  function renderDocumentLine(doc){
    const label = AsgardUI.esc(doc?.name || doc?.original_name || doc?.filename || '\u0424\u0430\u0439\u043b');
    const typeLabel = AsgardUI.esc(doc?.type || '\u0414\u043e\u043a\u0443\u043c\u0435\u043d\u0442');
    const url = buildDocumentLink(doc);
    if(!url) return `<div class="pill" style="gap:10px"><div class="who"><b>${typeLabel}</b> ? <span class="help">\u0424\u0430\u0439\u043b \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d</span></div></div>`;
    const attrs = /^(\/api\/|\/uploads\/|data:)/i.test(url)
      ? `href="${AsgardUI.esc(url)}" download`
      : `href="${AsgardUI.esc(url)}" target="_blank" rel="noopener"`;
    return `<div class="pill" style="gap:10px"><div class="who"><b>${typeLabel}</b> · <a ${attrs}>${label}</a></div></div>`;
  }




  async function getCore(){
    const core = await AsgardDB.get("settings","app");
    return core ? JSON.parse(core.value_json||"{}") : {vat_pct:22, status_colors:{tender:{}, work:{}}};
  }

  async function getSLA(){
    const app = await AsgardDB.get("settings","app");
    const v = app ? JSON.parse(app.value_json||"{}") : {};
    const s = v.sla || {};
    return {
      director_approval_due_workdays: Number.isFinite(s.director_approval_due_workdays) ? s.director_approval_due_workdays : 2
    };
  }

  function addWorkdays(base, days){
    if(window.AsgardSLA && typeof AsgardSLA.addWorkdays === 'function') return AsgardSLA.addWorkdays(base, days);
    // fallback (UTC): skip Sat/Sun
    const dt = new Date(base);
    if(!isFinite(dt.getTime())) return null;
    let n = Number(days||0);
    if(!Number.isFinite(n)) n=0;
    const isW=(d)=>{ const w=d.getDay(); return w===0||w===6; };
    while(n>0){
      dt.setDate(dt.getDate()+1);
      if(!isW(dt)) n--;
    }
    return dt;
  }

  async function audit(actorId, entityType, entityId, action, payload){
    await AsgardDB.add("audit_log", { actor_user_id: actorId, entity_type: entityType, entity_id: entityId, action, payload_json: JSON.stringify(payload||{}), created_at: isoNow() });
  }
  async function notify(userId, title, message, link_hash){
    await AsgardDB.add("notifications", { user_id:userId, is_read:false, created_at: isoNow(), title, message, link_hash: link_hash||"#/approvals" });
  }


  async function openDocsPack(tender_id){
    const docs = (await AsgardDB.byIndex("documents","tender_id", tender_id)) || [];
    const t = await AsgardDB.get("tenders", tender_id);
    const links = docs.map(d=>{ const url = buildDocumentLink(d); return url ? `${d.type||"Документ"}: ${url}` : ""; }).filter(Boolean).join("\n");
    const html = `
      <div class="help">Ссылки на Я.Диск/площадку. Доступно на любом статусе.</div>
      <div class="row" style="gap:8px; flex-wrap:wrap; margin-top:10px">
        <button class="btn" id="copyAll">Скопировать все ссылки</button>
        ${t?.purchase_url?`<a class="btn ghost" target="_blank" href="${AsgardUI.esc(t.purchase_url)}">Открыть площадку</a>`:"<span class=\"help\">Площадки нет</span>"}
      </div>
      <div style="margin-top:12px">
        ${docs.length ? docs.map(renderDocumentLine).join("") : `<div class="help">Документы не найдены.</div>`}
      </div>`;
    AsgardUI.showModal("Комплект документов", html);
    const b=document.getElementById("copyAll");
    if(b) b.addEventListener("click", ()=>AsgardUI.copyToClipboard(links||""));
  }


  async function addQAMessage({tender_id, estimate_id, pm_id, from_user_id, from_role, type, text, question_id=null}){
    const msg = { tender_id, estimate_id, pm_id, from_user_id, from_role, type, text:String(text||""), question_id, is_open:(type==="question"), created_at: isoNow() };
    return await AsgardDB.add("qa_messages", msg);
  }
  async function listQA(tender_id, estimate_id){
    let msgs = await AsgardDB.byIndex("qa_messages","estimate_id", estimate_id);
    msgs = (msgs||[]).filter(m=>m.tender_id===tender_id);
    msgs.sort((a,b)=> String(a.created_at||"").localeCompare(String(b.created_at||"")));
    return msgs;
  }
  async function closeQuestion(question_id){
    const q = await AsgardDB.get("qa_messages", question_id);
    if(q){ q.is_open=false; await AsgardDB.put("qa_messages", q); }
  }

  function calcDerived({price_tkp, cost_plan}){
    const price = num(price_tkp);
    const cost = num(cost_plan);
    const margin = (price!=null && cost!=null && price>0) ? ((price-cost)/price) : null;
    return { margin };
  }

  function safeParseJSON(s, fallback){
    try{
      const v = JSON.parse(s||"{}");
      return (v && typeof v === "object") ? v : (fallback||{});
    }catch(_){
      return (fallback||{});
    }
  }

  function sumCrew(obj){
    if(!obj || typeof obj!=="object") return null;
    let total=0; let any=false;
    for(const k of Object.keys(obj)){
      const n = Number(obj[k]);
      if(Number.isFinite(n)) { total+=n; any=true; }
    }
    return any ? total : null;
  }

  function calcView(calc){
    calc = (calc && typeof calc==="object") ? calc : {};

    // v1 калькулятор
    if(calc._type === "asgard_calc_v1"){
      const out = (calc.output && typeof calc.output==="object") ? calc.output : {};
      const dv  = (calc.director_view && typeof calc.director_view==="object") ? calc.director_view : {};
      return {
        chemCost: (out.chem && typeof out.chem==="object") ? out.chem.cost : null,
        logisticsCost: out.logistics ?? null,
        equipmentCost: out.equipment_total ?? null,
        peopleCount: dv.people ?? out.peopleWork ?? null,
        workDays: dv.work_days ?? out.workDays ?? null,
        director: dv
      };
    }

    // seed / legacy calc packs
    if(calc.tkp_total!=null || calc.cost_total!=null || calc.profit_clean!=null){
      const people = calc.people_count ?? sumCrew(calc.crew);
      return {
        chemCost: calc.chemicals_total ?? null,
        logisticsCost: calc.logistics_cost ?? null,
        equipmentCost: calc.equipment_total ?? null,
        peopleCount: people ?? null,
        workDays: calc.work_days ?? null,
        director: {
          price_tkp_with_vat: calc.tkp_total ?? null,
          cost_total: calc.cost_total ?? null,
          net_profit: calc.profit_clean ?? null,
          people,
          work_days: calc.work_days ?? null
        }
      };
    }

    // MVP form (pm_calcs)
    return {
      chemCost: calc.chemistry_cost ?? null,
      logisticsCost: calc.logistics_cost ?? null,
      equipmentCost: calc.equipment_cost ?? null,
      peopleCount: calc.people_count ?? null,
      workDays: calc.work_days ?? null,
      director: (calc.director_view && typeof calc.director_view==="object") ? calc.director_view : null
    };
  }

  async function render({layout, title}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }
    const user = auth.user;

    if(!(isDirRole(user.role) || user.role==="ADMIN")){
      toast("Доступ","Раздел доступен только Ярлу/админу","err");
      location.hash="#/home";
      return;
    }

    const core = await getCore();
    const sla = await getSLA();
    const users = await AsgardDB.all("users");
    const byId = new Map(users.map(u=>[u.id,u]));
    const tenders = await AsgardDB.all("tenders");
    const tendById = new Map(tenders.map(t=>[t.id,t]));

    const body = `
      ${window.__ASG_SHARED_TABLE_CSS__||""}
      <style>
        tr.overdue td{background:rgba(239,68,68,.10);}
        tr.overdue td:first-child{box-shadow: inset 4px 0 0 rgba(239,68,68,.85);}
      </style>

      <div class="panel">
        <div class="help">
          Очередь согласования. Ярл видит снимок версии просчёта (vN) и принимает решение: согласовать / доработка / вопрос.
          Доработка и вопрос требуют комментария. Вопрос не меняет «статус тендера», но фиксирует коммуникацию.
        </div>

        <hr class="hr"/>

        <div class="tools">
          <div class="field">
            <label>Период</label>
            <div id="f_period_w"></div>
          </div>
          <div class="field">
            <label>Поиск</label>
            <input id="f_q" placeholder="заказчик / тендер / РП"/>
          </div>
          <div class="field">
            <label>Показывать</label>
            <div id="f_mode_w"></div>
          </div>
          <div style="display:flex; gap:10px">
            <button class="btn ghost" id="btnReset">Сброс</button>
          </div>
        </div>

        <hr class="hr"/>

        <div style="overflow:auto">
          <table class="asg">
            <thead>
              <tr>
                <th>Тендер</th>
                <th>РП</th>
                <th>Версия</th>
                <th>Цена</th>
                <th>Себест.</th>
                <th>Маржа</th>
                <th>Отправлено</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="tb"></tbody>
          </table>
        </div>
        <div class="help" id="cnt"></div>
      </div>
    `;
    await layout(body, {title: title||"Согласование", rightBadges:[`НДС: ${core.vat_pct||22}%`]});

    const tb=$("#tb"), cnt=$("#cnt");

    // ─── CRSelect filters ───
    { const periodOpts = [{ value: '', label: 'Все' }];
      const now2 = new Date();
      for (let i = 0; i < 12; i++) {
        const d = new Date(now2.getFullYear(), now2.getMonth() - i, 1);
        const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        periodOpts.push({ value: v, label: d.toLocaleString('ru-RU', { month: 'long', year: 'numeric' }) });
      }
      $('#f_period_w').appendChild(CRSelect.create({ id: 'f_period', options: periodOpts, value: ymNow(), onChange: () => listEstimates() }));
    }
    $('#f_mode_w').appendChild(CRSelect.create({ id: 'f_mode', options: [
      { value: 'sent', label: 'Только на согласовании' },
      { value: 'all', label: 'Все решения' }
    ], value: 'sent', onChange: () => listEstimates() }));

    async function listEstimates(){
      const mode=CRSelect.getValue('f_mode')||"sent";
      const q=norm($("#f_q")?.value||"");
      const period=norm(CRSelect.getValue('f_period')||"");

      let all = await AsgardDB.all("estimates");
      // QA flags (open questions)
      let qaAll = [];
      try{ qaAll = await AsgardDB.all("qa_messages"); }catch(e){}
      const qaByEstimate = new Map();
      for(const m of (qaAll||[])){
        if(m.estimate_id==null) continue;
        const arr = qaByEstimate.get(m.estimate_id) || [];
        arr.push(m);
        qaByEstimate.set(m.estimate_id, arr);
      }

      if(mode==="sent"){
        all = all.filter(e=>e.approval_status==="sent");
      }else{
        all = all.filter(e=>["sent","approved","rework","question"].includes(e.approval_status));
      }

      // Use tender period filter (current month by default)
      all = all.filter(e=>{
        const t = tendById.get(e.tender_id);
        if(!t) return false;
        if(period && norm(t.period)!==period) return false;
        if(q){
          const pm = byId.get(e.pm_id)||{};
          const hay = `${t.customer_name||""} ${t.tender_title||""} ${pm.name||""}`.toLowerCase();
          if(!hay.includes(q)) return false;
        }
        return true;
      });

      // Show newest first
      all.sort((a,b)=>String(b.sent_for_approval_at||b.created_at||"").localeCompare(String(a.sent_for_approval_at||a.created_at||"")));

      tb.innerHTML = all.map(e=>{
        const t = tendById.get(e.tender_id)||{};
        const pm = byId.get(e.pm_id)||{};
        const d = calcDerived({price_tkp:e.price_tkp, cost_plan:e.cost_plan});
        const sent = e.sent_for_approval_at ? new Date(e.sent_for_approval_at).toLocaleString("ru-RU") : "—";
        const due = (e.approval_status==="sent") ? addWorkdays(e.sent_for_approval_at||e.created_at||new Date().toISOString(), sla.director_approval_due_workdays) : null;
        const overdue = (e.approval_status==="sent" && due && (Date.now() > due.getTime()));
        const dueLine = overdue ? `<div class="help">Просрочено: до ${due.toLocaleDateString("ru-RU")}</div>` : ``;
        return `<tr data-id="${e.id}"${overdue?` class="overdue"`:``}>
          <td><b>${esc(t.customer_name||"")}</b><div class="help">${esc(t.tender_title||"")}</div></td>
          <td>${esc(pm.name||"")}</td>
          <td>
            <div>v${esc(String(e.version_no||0))} · ${statusPill(e.approval_status||"draft", ({ draft:"Черновик", sent:"На согласовании", approved:"Согласована", rework:"На доработке", question:"Вопрос", rejected:"Отклонена", cancelled:"Отменена" }[e.approval_status||"draft"]) || (e.approval_status||""))}</div>
            ${(()=>{
              const msgs=(qaByEstimate.get(e.id)||[]);
              const open = msgs.filter(m=>m.type==="question" && m.is_open).length;
              const answered = msgs.filter(m=>m.type==="answer").length;
              const badges=[];
              if(open>0) badges.push(`<span class="badge"><span class="dot" style="background:var(--amber)"></span>Ожидает ответа (${open})</span>`);
              if(answered>0) badges.push(`<span class="badge"><span class="dot" style="background:var(--ok-t)"></span>Есть ответы (${answered})</span>`);
              return badges.length? `<div class="row" style="gap:6px; flex-wrap:wrap; margin-top:6px">${badges.join("")}</div>`:"";
            })()}
          </td>
          <td>${e.price_tkp!=null?money(e.price_tkp):"—"}</td>
          <td>${e.cost_plan!=null?money(e.cost_plan):"—"}</td>
          <td>${d.margin!=null?`${Math.round(d.margin*100)}%`:"—"}</td>
          <td>${esc(sent)}${dueLine}</td>
          <td><button class="btn" style="padding:6px 10px" data-act="open">Открыть</button></td>
        </tr>`;
      }).join("");

      cnt.textContent = `Записей: ${all.length}.`;
    }

    await listEstimates();

    $("#f_q").addEventListener("input", listEstimates);

    $("#btnReset").addEventListener("click", ()=>{
      CRSelect.setValue('f_period', ymNow());
      if($("#f_q")) $("#f_q").value="";
      CRSelect.setValue('f_mode', 'sent');
      listEstimates();
    });

    tb.addEventListener("click", async (e)=>{
      const tr=e.target.closest("tr[data-id]");
      if(!tr) return;
      if(e.target.getAttribute("data-act")==="open"){
        location.hash = `#/all-estimates?id=${Number(tr.getAttribute("data-id"))}`;
      }
    });

    async function openEstimate(id){
      const est = await AsgardDB.get("estimates", id);
      if(!est){ toast("Просчёт","Не найден","err"); return; }
      const t = tendById.get(est.tender_id)||{};
      const pm = byId.get(est.pm_id)||{};
      const calcRaw = safeParseJSON(est.calc_summary_json, {});
      const calc = calcView(calcRaw);
      const sent = est.sent_for_approval_at ? new Date(est.sent_for_approval_at).toLocaleString("ru-RU") : "—";
      
      // Проверяем есть ли данные калькулятора v2
      const calcV2 = est.calc_v2_json ? safeParseJSON(est.calc_v2_json, null) : null;
      let v2Summary = null;
      if(calcV2 && window.AsgardCalcV2){
        try {
          const s = await AsgardCalcV2.getSettings();
          v2Summary = AsgardCalcV2.compute(calcV2, s);
        } catch(e) {}
      }
      
      // Проверяем есть ли данные быстрого просчёта
      const quickCalc = est.quick_calc_json ? safeParseJSON(est.quick_calc_json, null) : null;
      
      // Компактная карточка быстрого просчёта
      let quickCard = '';
      if(quickCalc && !v2Summary){
        const vatPct = core.vat_pct || 22;
        const priceNoVat = (est.price_tkp || 0) / (1 + vatPct/100);
        const profit = priceNoVat - (est.cost_plan || 0);
        const pd = (quickCalc.people_count || 1) * (quickCalc.work_days || 1);
        const profitPD = pd > 0 ? profit / pd : 0;
        const margin = priceNoVat > 0 ? ((profit / priceNoVat) * 100) : 0;
        
        const minPPD = core.calc?.min_profit_per_person_day || 20000;
        const normPPD = core.calc?.norm_profit_per_person_day || 25000;
        
        let status = "red", statusLabel = "🔴 КРАСНАЯ ЗОНА", statusColor = "#e03a4a";
        if(profitPD >= normPPD) { status = "green"; statusLabel = "🟢 ЗЕЛЁНАЯ ЗОНА"; statusColor = "var(--ok-t)"; }
        else if(profitPD >= minPPD) { status = "yellow"; statusLabel = "🟡 ЖЁЛТАЯ ЗОНА"; statusColor = "var(--amber)"; }
        
        quickCard = `
          <div style="background:rgba(13,20,40,.6); border-radius:6px; padding:16px; margin-bottom:16px">
            <div style="font-size:12px; color:var(--muted); margin-bottom:8px">📝 БЫСТРЫЙ ПРОСЧЁТ</div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(100px,1fr)); gap:12px">
              <div style="text-align:center">
                <div style="font-size:11px; color:var(--muted)">Бригада</div>
                <div style="font-size:18px; font-weight:700; color:var(--gold)">${quickCalc.people_count||'—'} чел</div>
              </div>
              <div style="text-align:center">
                <div style="font-size:11px; color:var(--muted)">Дней работы</div>
                <div style="font-size:18px; font-weight:700; color:var(--gold)">${quickCalc.work_days||'—'}</div>
              </div>
              <div style="text-align:center">
                <div style="font-size:11px; color:var(--muted)">Себестоимость</div>
                <div style="font-size:16px; font-weight:700">${money(est.cost_plan)}</div>
              </div>
              <div style="text-align:center">
                <div style="font-size:11px; color:var(--muted)">Цена с НДС</div>
                <div style="font-size:18px; font-weight:700; color:var(--gold)">${money(est.price_tkp)}</div>
              </div>
            </div>
            <div style="background:${statusColor}22; border:2px solid ${statusColor}; border-radius:6px; padding:12px; margin-top:12px; text-align:center">
              <div style="font-size:13px; font-weight:700; color:${statusColor}">${statusLabel}</div>
              <div style="font-size:22px; font-weight:700; color:${statusColor}; margin-top:4px">${money(Math.round(profitPD))}</div>
              <div style="font-size:11px; color:var(--muted)">прибыль / чел-день</div>
            </div>
            <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap; font-size:12px">
              <span style="background:rgba(42,59,102,.4); padding:4px 8px; border-radius:6px">Маржа: ${margin.toFixed(1)}%</span>
              <span style="background:rgba(42,59,102,.4); padding:4px 8px; border-radius:6px">Прибыль: ${money(Math.round(profit))}</span>
              ${quickCalc.city ? `<span style="background:rgba(42,59,102,.4); padding:4px 8px; border-radius:6px">Город: ${esc(quickCalc.city)} (${quickCalc.distance_km||0} км)</span>` : ''}
              ${quickCalc.work_type ? `<span style="background:rgba(42,59,102,.4); padding:4px 8px; border-radius:6px">${esc(quickCalc.work_type)}</span>` : ''}
            </div>
            ${(quickCalc.assumptions || est.assumptions) ? `<div style="margin-top:12px; padding:10px; background:rgba(245,158,11,.1); border-radius:6px; border-left:3px solid var(--amber)">
              <div style="font-size:11px; color:var(--amber); font-weight:600; margin-bottom:4px">⚠️ ДОПУЩЕНИЯ И РИСКИ</div>
              <div style="font-size:12px; color:var(--muted)">${esc(quickCalc.assumptions || est.assumptions)}</div>
            </div>` : ''}
          </div>
        `;
      }

      // Компактная карточка v2 если есть данные
      const v2Card = v2Summary ? `
        <div style="background:rgba(13,20,40,.6); border-radius:6px; padding:16px; margin-bottom:16px">
          <div style="font-size:12px; color:var(--muted); margin-bottom:8px">ᚱ РУНИЧЕСКИЙ КАЛЬКУЛЯТОР</div>
          <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(100px,1fr)); gap:12px">
            <div style="text-align:center">
              <div style="font-size:11px; color:var(--muted)">Бригада</div>
              <div style="font-size:18px; font-weight:700; color:var(--gold)">${v2Summary.people_count} чел</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:11px; color:var(--muted)">Дней работы</div>
              <div style="font-size:18px; font-weight:700; color:var(--gold)">${v2Summary.work_days}</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:11px; color:var(--muted)">Себестоимость</div>
              <div style="font-size:16px; font-weight:700">${money(v2Summary.cost_total)}</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:11px; color:var(--muted)">Цена с НДС</div>
              <div style="font-size:18px; font-weight:700; color:var(--gold)">${money(v2Summary.price_with_vat)}</div>
            </div>
          </div>
          <div style="background:${v2Summary.status==='green'?'rgba(34,197,94,.2)':v2Summary.status==='yellow'?'rgba(245,158,11,.2)':'rgba(224,58,74,.2)'}; border:2px solid ${v2Summary.status==='green'?'var(--ok-t)':v2Summary.status==='yellow'?'var(--amber)':'#e03a4a'}; border-radius:6px; padding:12px; margin-top:12px; text-align:center">
            <div style="font-size:13px; font-weight:700; color:${v2Summary.status==='green'?'var(--ok-t)':v2Summary.status==='yellow'?'var(--amber)':'#e03a4a'}">${v2Summary.status==='green'?'🟢 ЗЕЛЁНАЯ':v2Summary.status==='yellow'?'🟡 ЖЁЛТАЯ':'🔴 КРАСНАЯ'} ЗОНА</div>
            <div style="font-size:22px; font-weight:700; color:${v2Summary.status==='green'?'var(--ok-t)':v2Summary.status==='yellow'?'var(--amber)':'#e03a4a'}; margin-top:4px">${money(v2Summary.profit_per_day)}</div>
            <div style="font-size:11px; color:var(--muted)">прибыль / чел-день</div>
          </div>
          <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap; font-size:12px">
            <span style="background:rgba(42,59,102,.4); padding:4px 8px; border-radius:6px">Маржа: ${v2Summary.margin_pct}%</span>
            <span style="background:rgba(42,59,102,.4); padding:4px 8px; border-radius:6px">Чистая прибыль: ${money(v2Summary.net_profit)}</span>
            <span style="background:rgba(42,59,102,.4); padding:4px 8px; border-radius:6px">Город: ${esc(calcV2.city||'—')} (${calcV2.distance_km||0} км)</span>
          </div>
          ${calcV2.assumptions ? `<div style="margin-top:12px; padding:10px; background:rgba(245,158,11,.1); border-radius:6px; border-left:3px solid var(--amber)">
            <div style="font-size:11px; color:var(--amber); font-weight:600; margin-bottom:4px">⚠️ ДОПУЩЕНИЯ И РИСКИ</div>
            <div style="font-size:12px; color:var(--muted)">${esc(calcV2.assumptions)}</div>
          </div>` : ''}
        </div>
      ` : '';

      const html = `
        <div class="help">
          <b>${esc(t.customer_name||"")}</b> — ${esc(t.tender_title||"")}
          <div class="help">РП: <b>${esc(pm.name||"")}</b> · версия: <b>v${esc(String(est.version_no||0))}</b> · отправлено: ${esc(sent)}</div>
          <div class="help">ᚦ Слово Ярла — закон. Но закон опирается на счёт.</div>
        </div>

        <hr class="hr"/>

        ${v2Card || quickCard}

        <div class="formrow">
          <div><label>Вероятность</label><input autocomplete="off" disabled value="${esc(String(est.probability_pct??""))}"/></div>
          <div><label>Себестоимость (план)</label><input autocomplete="off" disabled value="${est.cost_plan!=null?money(est.cost_plan):""}"/></div>
          <div><label>Цена ТКП (с НДС)</label><input autocomplete="off" disabled value="${est.price_tkp!=null?money(est.price_tkp):""}"/></div>
          <div style="grid-column:1/-1"><label>Условия оплаты</label><input autocomplete="off" disabled value="${esc(est.payment_terms||"")}"/></div>
          ${!(v2Card || quickCard) ? `
          <div><label>Химия</label><input autocomplete="off" disabled value="${calc.chemCost!=null?money(calc.chemCost):""}"/></div>
          <div><label>Логистика</label><input autocomplete="off" disabled value="${calc.logisticsCost!=null?money(calc.logisticsCost):""}"/></div>
          <div><label>Оборудование</label><input autocomplete="off" disabled value="${calc.equipmentCost!=null?money(calc.equipmentCost):""}"/></div>
          <div><label>Людей</label><input autocomplete="off" disabled value="${esc(String(calc.peopleCount??""))}"/></div>
          <div><label>Дней</label><input autocomplete="off" disabled value="${esc(String(calc.workDays??""))}"/></div>
          ${calc.director?`
            <div style="grid-column:1/-1">
              <div class="help"><b>Срез для Ярла</b></div>
              <div class="row" style="gap:8px; flex-wrap:wrap; margin-top:6px">
                ${calc.director.price_tkp_with_vat!=null?`<span class="badge">ТКП: <b>${money(calc.director.price_tkp_with_vat)}</b></span>`:""}
                ${calc.director.cost_total!=null?`<span class="badge">Себест.: <b>${money(calc.director.cost_total)}</b></span>`:""}
                ${calc.director.fot_with_taxes!=null?`<span class="badge">ФОТ+налоги: <b>${money(calc.director.fot_with_taxes)}</b></span>`:""}
                ${calc.director.net_profit!=null?`<span class="badge">Чистая прибыль: <b>${money(calc.director.net_profit)}</b></span>`:""}
                ${calc.director.profit_per_person_day!=null?`<span class="badge">Прибыль/чел‑день: <b>${money(calc.director.profit_per_person_day)}</b></span>`:""}
              </div>
            </div>
          `:""}
          ` : ''}
          ${est.cover_letter!=null?`
          <div style="grid-column:1/-1">
            <label>Сопроводительное письмо РП</label>
            <textarea disabled id="pm_cover">${esc(est.cover_letter||"")}</textarea>
            <div class="row" style="gap:8px; flex-wrap:wrap; margin-top:6px">
              <button class="btn ghost" id="btnCopyCover">Скопировать</button>
            </div>
          </div>
        `:``}
          <div style="grid-column:1/-1"><label>Комментарий РП</label><input autocomplete="off" disabled value="${esc(est.comment||"")}"/></div>
        </div>

        <hr class="hr"/>

        <div class="help"><b>Решение</b></div>
        <div class="formrow">
          <div style="grid-column:1/-1">
            <label>Комментарий Ярла (обязателен для «Доработка» и «Вопрос»)</label>
            <input id="a_comm" value="${esc(est.approval_comment||"")}" placeholder="замечания/вопрос/уточнение"/>
          </div>
        </div>

        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px">
          <button class="btn" id="btnApprove" style="background:#22c55e;color:#fff;border:none">✅ Согласовать</button>
          <button class="btn" id="btnRework" style="background:#f59e0b;color:#fff;border:none">🔄 Доработка</button>
          <button class="btn" id="btnQuestion" style="background:#a855f7;color:#fff;border:none">❓ Вопрос</button>
          <button class="btn" id="btnReject" style="background:#ef4444;color:#fff;border:none">❌ Отклонить</button>
        </div>

        <div class="help" style="margin-top:10px">Решение фиксируется в журнале и отправляет уведомление РП.</div>
      `;

      showModal("Согласование просчёта", html);

      const cbtn = document.getElementById('btnCopyCover');
      if(cbtn){ cbtn.addEventListener('click', ()=>AsgardUI.copyToClipboard((est.cover_letter||'').toString())); }


      async function decide(newStatus, requireComment){
        const comm = document.getElementById("a_comm").value.trim();
        if(requireComment && !comm){
          toast("Проверка","Нужен комментарий","err"); return;
        }
        const cur = await AsgardDB.get("estimates", id);
        if(!cur){ toast("Ошибка","Запись не найдена","err"); return; }
        const before = cur.approval_status;
        cur.approval_status = newStatus;
        cur.approval_comment = comm;
        if(newStatus==="rework"){
          cur.rework_requested_at = isoNow();
        }
        cur.decided_at = isoNow();
        await AsgardDB.put("estimates", cur);
        await audit(user.id,"estimate",id,"approval_decision",{before, after:newStatus, comment:comm, tender_id:cur.tender_id, version_no:cur.version_no});
        await notify(cur.pm_id, "Решение по просчёту", `v${cur.version_no}: ${newStatus}${comm?` — ${comm}`:""}`, "#/pm-calcs");
        toast("Решение","Сохранено");
        listEstimates();
        showModal("Готово", `<div class="help">Решение применено. Уведомление отправлено РП.</div>`);
      }

      document.getElementById("btnApprove").addEventListener("click", ()=>decide("approved", false));
      document.getElementById("btnRework").addEventListener("click", ()=>decide("rework", true));
      const btnReject = document.getElementById("btnReject");
      if(btnReject) btnReject.addEventListener("click", ()=>decide("rejected", true));
      document.getElementById("btnQuestion").addEventListener("click", async ()=>{
        const comm = document.getElementById("a_comm").value.trim();
        if(!comm){ toast("Проверка","Нужен вопрос (комментарий)","err"); return; }
        const cur = await AsgardDB.get("estimates", id);
        if(!cur){ toast("Ошибка","Запись не найдена","err"); return; }
        // фиксируем статус "question" и точку отсчёта SLA для ответа/доработки
        const before = cur.approval_status;
        cur.approval_status = "question";
        cur.approval_comment = comm;
        cur.rework_requested_at = isoNow();
        cur.decided_at = isoNow();
        await AsgardDB.put("estimates", cur);

        const qid = await addQAMessage({tender_id:cur.tender_id, estimate_id:id, pm_id:cur.pm_id, from_user_id:user.id, from_role:user.role, type:"question", text:comm});
        await audit(user.id,"estimate",id,"ask_question",{before, after:"question", tender_id:cur.tender_id, question_id:qid, text:comm, version_no:cur.version_no});
        await notify(cur.pm_id, "Вопрос по просчёту", `v${cur.version_no}: ${comm}`, "#/pm-calcs");
        toast("Вопрос","Отправлен РП");
        listEstimates();
        showModal("Готово", `<div class="help">Вопрос отправлен. Статус согласования: <b>question</b>.</div>`);
      });
}
  }

  return { render };
})();
