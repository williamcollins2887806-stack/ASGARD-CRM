  async function openDocsPack({tender_id, work_id, purchase_url}){
    const auth = await AsgardAuth.requireUser();
    const user = auth?auth.user:null;
    const tender = tender_id ? await AsgardDB.get("tenders", tender_id) : null;
    const estList = tender_id ? await AsgardDB.byIndex("estimates","tender_id", tender_id) : [];
    const est = (estList||[]).sort((a,b)=>(Number(b.version_no||0)-Number(a.version_no||0)) || Number(b.id||0)-Number(a.id||0))[0] || null;

    await AsgardDocsPack.ensurePack({tender_id, work_id});
    const docs = await AsgardDocsPack.docsFor({tender_id, work_id});
    const links = (docs||[]).map(d=>`${d.type||"Документ"}: ${d.data_url||""}`).join("\n");

    const html = `
      <div class="help">Единый комплект документов на тендер/работу (ссылки или сгенерированные HTML). </div>
      <div class="row" style="gap:8px; flex-wrap:wrap; margin-top:10px">
        <button class="btn" id="copyAll">Скопировать все ссылки</button>
        <button class="btn ghost" id="packExport">Экспорт (JSON)</button>
        <button class="btn ghost" id="packImport">Импорт</button>
        <button class="btn ghost" id="packAddLink">+ Ссылка</button>
        ${purchase_url?`<a class="btn ghost" target="_blank" href="${AsgardUI.esc(purchase_url)}">Открыть площадку</a>`:"<span class=\"help\">Площадки нет</span>"}
      </div>
      <div class="row" style="gap:8px; flex-wrap:wrap; margin:10px 0">
        <button class="btn ghost" id="dReq">Скачать запрос</button>
        <button class="btn ghost" id="dTKP">Скачать ТКП</button>
        <button class="btn ghost" id="dCov">Скачать сопроводительное</button>
        <button class="btn" id="aReq">Добавить запрос</button>
        <button class="btn" id="aTKP">Добавить ТКП</button>
        <button class="btn" id="aCov">Добавить сопроводительное</button>
      </div>
      <div style="margin-top:12px">
        ${docs.length? docs.map(d=>`<div class="pill" style="gap:10px; flex-wrap:wrap"><div class="who"><b>${AsgardUI.esc(d.type||"Документ")}</b> — <a target="_blank" href="${AsgardUI.esc(d.data_url||"#")}">${AsgardUI.esc(d.name||"ссылка")}</a></div><button class="btn ghost" data-del-doc="${d.id}">Удалить</button></div>`).join("") : `<div class="help">Документов пока нет.</div>`}
      </div>`;

    AsgardUI.showModal("Комплект документов", html);

    const b=document.getElementById("copyAll");
    if(b) b.addEventListener("click", ()=>AsgardUI.copyToClipboard(links||""));

    const exp=document.getElementById("packExport");
    if(exp) exp.addEventListener("click", ()=>AsgardDocsPack.downloadPackJson({tender_id, work_id}));

    const imp=document.getElementById("packImport");
    if(imp) imp.addEventListener("click", ()=>{
      const inp=document.createElement("input"); inp.type="file"; inp.accept="application/json";
      inp.onchange=async()=>{
        const f=inp.files&&inp.files[0]; if(!f) return;
        try{ await AsgardDocsPack.importPackJson(f,{tender_id, work_id, user_id:user?.id}); openDocsPack({tender_id, work_id, purchase_url}); }
        catch(e){ AsgardUI.toast("Импорт", e.message||"Ошибка", "err"); }
      };
      inp.click();
    });

    const addLink=document.getElementById("packAddLink");
    if(addLink) addLink.addEventListener("click", async ()=>{
      const html2=`
        <div class="formrow">
          <div><label>Тип</label><input id="pl_type" placeholder="ТЗ / Письмо / Фото"/></div>
          <div><label>Название</label><input id="pl_name" placeholder="например: Комплект"/></div>
          <div style="grid-column:1/-1"><label>Ссылка</label><input id="pl_url" placeholder="https://..."/></div>
        </div>
        <div style="margin-top:12px"><button class="btn" id="pl_save">Сохранить</button></div>`;
      AsgardUI.showModal("Добавить ссылку", html2);
      document.getElementById("pl_save").addEventListener("click", async ()=>{
        const url = document.getElementById("pl_url").value.trim();
        if(!url){ AsgardUI.toast("Документ","Укажите ссылку","err"); return; }
        try{
          await AsgardDocsPack.addLink({tender_id, work_id, type:(document.getElementById("pl_type").value||"Документ").trim(), name:(document.getElementById("pl_name").value||url).trim(), url, user_id:user?.id});
          AsgardUI.toast("Документ","Добавлено");
          openDocsPack({tender_id, work_id, purchase_url});
        }catch(e){ AsgardUI.toast("Документ", e.message||"Ошибка", "err"); }
      });
    });

    document.querySelectorAll("[data-del-doc]").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const id = Number(btn.getAttribute("data-del-doc"));
        await AsgardDB.del("documents", id);
        AsgardUI.toast("Документ","Удалено");
        openDocsPack({tender_id, work_id, purchase_url});
      });
    });

    const addGen = async (kind)=>{
      if(!tender_id){ AsgardUI.toast("Шаблон","Нет связанного тендера","err"); return; }
      let html="", type="Документ", name="";
      if(kind==="req"){ html = await AsgardTemplates.buildClientRequest({tender, estimate:est}); type="Запрос"; name=`Запрос_${tender_id}.html`; }
      if(kind==="tkp"){ html = await AsgardTemplates.buildTKP({tender, estimate:est}); type="ТКП"; name=`ТКП_${tender_id}_v${est?.version_no||1}.html`; }
      if(kind==="cov"){ html = await AsgardTemplates.buildCoverLetter({tender, estimate:est}); type="Сопроводительное"; name=`Сопроводительное_${tender_id}.html`; }
      await AsgardDocsPack.addGeneratedHtml({tender_id, work_id, type, name, html, user_id:user?.id});
      AsgardUI.toast("Комплект","Добавлено");
      openDocsPack({tender_id, work_id, purchase_url});
    };

    const dReq=document.getElementById("dReq"); if(dReq) dReq.addEventListener("click", ()=>AsgardTemplates.downloadRequest(tender, est));
    const dTKP=document.getElementById("dTKP"); if(dTKP) dTKP.addEventListener("click", ()=>AsgardTemplates.downloadTKP(tender, est));
    const dCov=document.getElementById("dCov"); if(dCov) dCov.addEventListener("click", ()=>AsgardTemplates.downloadCover(tender, est));
    const aReq=document.getElementById("aReq"); if(aReq) aReq.addEventListener("click", ()=>addGen("req"));
    const aTKP=document.getElementById("aTKP"); if(aTKP) aTKP.addEventListener("click", ()=>addGen("tkp"));
    const aCov=document.getElementById("aCov"); if(aCov) aCov.addEventListener("click", ()=>addGen("cov"));
  }

window.AsgardPmWorksPage=(function(){
  const { $, $$, esc, toast, showModal } = AsgardUI;
  const { dial } = AsgardCharts;

  function isoNow(){ return new Date().toISOString(); }
  function ymNow(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }
  function num(x){ if(x===null||x===undefined||x==="") return null; const n=Number(String(x).replace(/\s/g,"").replace(",", ".")); return isNaN(n)?null:n; }
  function daysBetween(a,b){
    const da=new Date(a); const db=new Date(b);
    if(isNaN(da.getTime())||isNaN(db.getTime())) return null;
    da.setHours(0,0,0,0); db.setHours(0,0,0,0);
    return Math.round((db-da)/(24*60*60*1000))+1;
  }
  function money(x){
    if(x===null||x===undefined||x==="") return "—";
    const n=Number(x); if(isNaN(n)) return esc(String(x));
    return n.toLocaleString("ru-RU");
  }
  const V = AsgardValidate;


  async function rosterEmployeeIds(work){
    // Prefer explicit staff_ids_json on work; fallback to booking plan rows.
    let ids=[];
    try{
      const raw = work && work.staff_ids_json;
      if(raw){
        const a = safeJson(raw, []);
        if(Array.isArray(a)) ids = a.map(Number).filter(n=>isFinite(n));
      }
    }catch(_){ ids=[]; }
    if(ids.length) return Array.from(new Set(ids));

    try{
      const plan = await AsgardDB.all("employee_plan");
      const set = new Set();
      for(const p of (plan||[])){
        if(!p) continue;
        if(String(p.kind||"")!=="work") continue;
        if(Number(p.work_id||0)!==Number(work.id||0)) continue;
        const eid = Number(p.employee_id||0);
        if(eid) set.add(eid);
      }
      return Array.from(set);
    }catch(_){
      return [];
    }
  }

  async function recomputeEmployeeRating(employee_id){
    const eid = Number(employee_id||0);
    if(!eid) return;
    const emp = await AsgardDB.get("employees", eid);
    if(!emp) return;
    const reviews = await AsgardDB.byIndex("employee_reviews","employee_id", eid);
    let sum=0, cnt=0;
    for(const r of (reviews||[])){
      const s=Number(r.score||0);
      if(isFinite(s) && s>0){ sum+=s; cnt++; }
    }
    emp.rating_avg = cnt ? Math.round((sum/cnt)*10)/10 : null;
    emp.rating_count = cnt;
    await AsgardDB.put("employees", emp);
  }

  async function ensureRatingsForWork({work, pmUser}){
    // Enforce PM ratings when work is completed.
    if(!work || !pmUser) return true;
    if(String(work.work_status||"") !== "Работы сдали") return true;

    const ids = await rosterEmployeeIds(work);
    if(!ids.length) return true;

    const emps = await AsgardDB.all("employees");
    const empById = new Map((emps||[]).map(e=>[Number(e.id), e]));

    const missing=[];
    for(const eid of ids){
      const revs = await AsgardDB.byIndex("employee_reviews","employee_id", eid);
      const has = (revs||[]).some(r=>Number(r.work_id||0)===Number(work.id||0) && Number(r.pm_id||0)===Number(pmUser.id||0));
      if(!has) missing.push(eid);
    }
    if(!missing.length) return true;

    return await new Promise((resolve)=>{
      const rows = missing.map(eid=>{
        const e = empById.get(Number(eid));
        const name = e ? (e.fio||"") : `ID ${eid}`;
        return `
          <div class="pill" style="gap:10px; flex-wrap:wrap">
            <div class="who"><b>${esc(name)}</b></div>
            <div class="role">Оценка: <input class="input" data-score="${eid}" type="number" min="1" max="10" value="8" style="width:90px"/></div>
            <div style="flex:1 1 380px; min-width:280px"><input class="input" data-comment="${eid}" placeholder="Комментарий (обязательно)"/></div>
          </div>
        `;
      }).join("");

      showModal({
        title: "Оценка сотрудников (обязательно)",
        html: `
          <div class="help">Работа переведена в статус <b>«Работы сдали»</b>. Перед сохранением необходимо оценить каждого сотрудника (1–10) и добавить комментарий. </div>
          <div style="margin-top:10px">${rows}</div>
          <div class="row" style="justify-content:flex-end; gap:8px; margin-top:12px">
            <button class="btn ghost" id="rateCancel">Назад</button>
            <button class="btn" id="rateSave">Сохранить оценки</button>
          </div>
        `,
        onMount: ({back})=>{
          const cancel = $("#rateCancel", back);
          const save = $("#rateSave", back);
          cancel.onclick=()=>{ AsgardUI.hideModal(); resolve(false); };
          save.onclick=async ()=>{
            try{
              for(const eid of missing){
                const sc = Number($(`[data-score='${eid}']`, back).value||0);
                const cm = String($(`[data-comment='${eid}']`, back).value||"").trim();
                if(!isFinite(sc) || sc<1 || sc>10) throw new Error("Оценка должна быть 1–10");
                if(!cm) throw new Error("Комментарий обязателен");
              }

              for(const eid of missing){
                const sc = Number($(`[data-score='${eid}']`, back).value||0);
                const cm = String($(`[data-comment='${eid}']`, back).value||"").trim();
                await AsgardDB.add("employee_reviews", {
                  employee_id: Number(eid),
                  work_id: Number(work.id),
                  pm_id: Number(pmUser.id),
                  score: sc,
                  comment: cm,
                  created_at: isoNow()
                });
                await recomputeEmployeeRating(eid);
              }
              await audit(pmUser.id, "work", work.id, "rate_staff", {employees: missing});
              AsgardUI.hideModal();
              toast("Рейтинг", "Оценки сохранены");
              resolve(true);
            }catch(e){
              toast("Оценка", e.message||"Ошибка", "err");
            }
          };
        }
      });
    });
  }

  async function upsertCustomerReview({work_id, pm_id, score, comment}){
    const wid = Number(work_id||0);
    const pid = Number(pm_id||0);
    if(!wid || !pid) throw new Error('Некорректные параметры оценки заказчика');
    const list = await AsgardDB.byIndex('customer_reviews','work_id', wid);
    const cur = (list||[]).find(r=>Number(r.pm_id||0)===pid);
    const rec = {
      id: cur?cur.id:undefined,
      work_id: wid,
      pm_id: pid,
      score: Number(score||0),
      comment: String(comment||'').trim(),
      created_at: cur?cur.created_at:isoNow(),
      updated_at: isoNow(),
    };
    if(cur){ await AsgardDB.put('customer_reviews', Object.assign(cur, rec)); return cur.id; }
    return await AsgardDB.add('customer_reviews', rec);
  }

  async function closeoutWizard({work, pmUser, triggerStatus, onDone}={}){
    if(!work || !pmUser) return;
    const trig = String(triggerStatus||'Подписание акта');
    if(String(work.work_status||'') !== trig){
      toast('Закрытие',`Кнопка доступна на статусе «${trig}»`,'err');
      return;
    }
    if(String(work.work_status||'') === 'Работы сдали'){
      toast('Закрытие','Работа уже завершена','err');
      return;
    }

    const w = Object.assign({}, work);

    const html = `
      <div class="help">Фиксируем <b>фактические данные</b>. После подтверждения директору уйдёт уведомление с актуальными значениями. Затем потребуется оценить сотрудников и заказчика.</div>
      <div class="formrow" style="margin-top:10px">
        <div><label>Старт работ (факт/вход в работу)</label><input id="c_start" type="date" value="${esc((w.start_in_work_date||'').slice(0,10))}"/></div>
        <div><label>Окончание работ (факт)</label><input id="c_end" type="date" value="${esc((w.end_fact||'').slice(0,10))}"/></div>
        <div><label>Себестоимость (факт)</label><input id="c_cost" placeholder="руб." value="${esc(w.cost_fact!=null?String(w.cost_fact):'')}"/></div>
        <div><label>Актуальная цена контракта</label><input id="c_value" placeholder="руб." value="${esc(w.contract_value!=null?String(w.contract_value):'')}"/></div>
        <div><label>Аванс получено (факт)</label><input id="c_adv" placeholder="руб." value="${esc(w.advance_received!=null?String(w.advance_received):'0')}"/></div>
        <div><label>Дата аванса (факт)</label><input id="c_adv_date" type="date" value="${esc((w.advance_date_fact||'').slice(0,10))}"/></div>
        <div><label>Остаток получено (факт)</label><input id="c_bal" placeholder="руб." value="${esc(w.balance_received!=null?String(w.balance_received):'0')}"/></div>
        <div><label>Дата оплаты остатка</label><input id="c_pay_date" type="date" value="${esc((w.payment_date_fact||'').slice(0,10))}"/></div>
        <div><label>Дата акта (факт)</label><input id="c_act" type="date" value="${esc((w.act_signed_date_fact||'').slice(0,10))}"/></div>
      </div>
      <div class="row" style="justify-content:flex-end; gap:8px; margin-top:12px">
        <button class="btn ghost" id="c_cancel">Отмена</button>
        <button class="btn" id="c_submit" style="background:#ef4444">Отправить на закрытие</button>
      </div>
    `;

    showModal({
      title: 'Закрытие контракта (факт)',
      html,
      onMount: ({back})=>{
        $('#c_cancel', back).onclick = ()=>AsgardUI.hideModal();
        $('#c_submit', back).onclick = async ()=>{
          try{
            const start = String($('#c_start', back).value||'').trim()||null;
            const end = String($('#c_end', back).value||'').trim()||null;
            const cost = num($('#c_cost', back).value);
            const value = num($('#c_value', back).value);
            const adv = num($('#c_adv', back).value) ?? 0;
            const bal = num($('#c_bal', back).value) ?? 0;
            const advDate = String($('#c_adv_date', back).value||'').trim()||null;
            const payDate = String($('#c_pay_date', back).value||'').trim()||null;
            const actDate = String($('#c_act', back).value||'').trim()||null;

            if(!end) throw new Error('Укажите дату окончания работ (факт)');
            if(value==null || !isFinite(value) || value<=0) throw new Error('Укажите актуальную цену контракта');
            if(cost==null || !isFinite(cost) || cost<=0) throw new Error('Укажите себестоимость (факт)');
            if((adv+bal) > value*1.5) throw new Error('Сумма оплат выглядит некорректно');

            w.start_in_work_date = start || w.start_in_work_date || null;
            w.end_fact = end;
            w.cost_fact = cost;
            w.contract_value = value;
            w.advance_received = adv;
            w.balance_received = bal;
            w.advance_date_fact = advDate;
            w.payment_date_fact = payDate;
            w.act_signed_date_fact = actDate || w.act_signed_date_fact || null;
            w.closeout_submitted_at = isoNow();
            w.closeout_submitted_by = pmUser.id;

            await AsgardDB.put('works', w);
            await audit(pmUser.id, 'work', w.id, 'closeout_submit', {
              work_id:w.id,
              end_fact:w.end_fact,
              cost_fact:w.cost_fact,
              contract_value:w.contract_value,
              paid:(Number(w.advance_received||0)+Number(w.balance_received||0)),
              left:(Number(w.contract_value||0)-Number(w.advance_received||0)-Number(w.balance_received||0)),
            });

            const paid = (Number(w.advance_received||0)+Number(w.balance_received||0));
            const left = (Number(w.contract_value||0)-paid);
            const profit = (Number(w.contract_value||0) - Number(w.cost_fact||w.cost_plan||0));
            const msg = `${w.company||''} — ${w.work_title||''}\nФакт: конец ${w.end_fact||'—'}\nЦена: ${money(w.contract_value)} ₽\nСебест(факт): ${money(w.cost_fact)} ₽\nПрибыль(упр): ${money(Math.round(profit))} ₽\nОплачено: ${money(paid)} ₽ • Осталось: ${money(left)} ₽\nPM: ${pmUser.name||pmUser.login}`;

            await notifyDirectors('Закрытие контракта (факт)', msg, '#/pm-works');

            AsgardUI.hideModal();

            // Mandatory ratings: employees + customer
            const okRatings = await collectCloseoutRatings({work:w, pmUser});
            if(!okRatings) return;

            // Finalize
            w.work_status = 'Работы сдали';
            w.closed_at = isoNow();
            await AsgardDB.put('works', w);
            await audit(pmUser.id, 'work', w.id, 'close', {work_status:w.work_status});
            toast('Закрытие','Контракт завершён');
            if(typeof onDone==='function') onDone();
          }catch(e){
            toast('Закрытие', e.message||'Ошибка', 'err', 7000);
          }
        };
      }
    });
  }

  async function collectCloseoutRatings({work, pmUser}){
    const ids = await rosterEmployeeIds(work);
    const emps = await AsgardDB.all('employees');
    const empById = new Map((emps||[]).map(e=>[Number(e.id), e]));

    // Prepare existing employee reviews
    const existingByEmp = new Map();
    for(const eid of ids){
      const revs = await AsgardDB.byIndex('employee_reviews','employee_id', Number(eid));
      const cur = (revs||[]).find(r=>Number(r.work_id||0)===Number(work.id||0) && Number(r.pm_id||0)===Number(pmUser.id||0));
      if(cur) existingByEmp.set(Number(eid), cur);
    }

    // Existing customer review
    let custCur=null;
    try{
      const custList = await AsgardDB.byIndex('customer_reviews','work_id', Number(work.id||0));
      custCur = (custList||[]).find(r=>Number(r.pm_id||0)===Number(pmUser.id||0)) || null;
    }catch(_){ custCur=null; }

    const empRows = (ids||[]).map(eid=>{
      const e = empById.get(Number(eid));
      const name = e ? (e.fio||'') : `ID ${eid}`;
      const cur = existingByEmp.get(Number(eid));
      const sc = cur ? Number(cur.score||8) : 8;
      const cm = cur ? String(cur.comment||'') : '';
      return `
        <div class="pill" style="gap:10px; flex-wrap:wrap">
          <div class="who"><b>${esc(name)}</b></div>
          <div class="role">Оценка: <input class="input" data-score="${eid}" type="number" min="1" max="10" value="${esc(String(sc))}" style="width:90px"/></div>
          <div style="flex:1 1 380px; min-width:280px"><input class="input" data-comment="${eid}" placeholder="Комментарий (обязательно)" value="${esc(cm)}"/></div>
        </div>
      `;
    }).join('') || `<div class="help">Нет закреплённых сотрудников. Оценка сотрудников пропущена.</div>`;

    return await new Promise((resolve)=>{
      showModal({
        title: 'Оценка после завершения (обязательно)',
        html: `
          <div class="help">Для завершения контракта нужно оценить <b>сотрудников</b> и <b>заказчика</b>. Оценка 1–10, комментарий обязателен.</div>
          <div style="margin-top:10px">
            <div class="help"><b>Сотрудники</b></div>
            ${empRows}
          </div>
          <hr class="hr"/>
          <div class="help"><b>Заказчик</b></div>
          <div class="formrow" style="margin-top:10px">
            <div><label>Оценка заказчика (1–10)</label><input id="cust_score" type="number" min="1" max="10" value="${esc(String(custCur?Number(custCur.score||8):8))}"/></div>
            <div style="grid-column:1/-1"><label>Комментарий (обязательно)</label><input id="cust_comment" placeholder="Качество взаимодействия, допуски, оперативность" value="${esc(String(custCur?.comment||''))}"/></div>
          </div>
          <div class="row" style="justify-content:flex-end; gap:8px; margin-top:12px">
            <button class="btn ghost" id="rateCancel">Назад</button>
            <button class="btn" id="rateSave">Сохранить оценки</button>
          </div>
        `,
        onMount: ({back})=>{
          $('#rateCancel', back).onclick = ()=>{ AsgardUI.hideModal(); resolve(false); };
          $('#rateSave', back).onclick = async ()=>{
            try{
              // validate employees
              for(const eid of ids){
                const sc = Number($(`[data-score='${eid}']`, back).value||0);
                const cm = String($(`[data-comment='${eid}']`, back).value||'').trim();
                if(!isFinite(sc) || sc<1 || sc>10) throw new Error('Оценка сотрудника должна быть 1–10');
                if(!cm) throw new Error('Комментарий к сотруднику обязателен');
              }
              // validate customer
              const csc = Number($('#cust_score', back).value||0);
              const ccm = String($('#cust_comment', back).value||'').trim();
              if(!isFinite(csc) || csc<1 || csc>10) throw new Error('Оценка заказчика должна быть 1–10');
              if(!ccm) throw new Error('Комментарий к заказчику обязателен');

              // save employee reviews (upsert)
              for(const eid of ids){
                const sc = Number($(`[data-score='${eid}']`, back).value||0);
                const cm = String($(`[data-comment='${eid}']`, back).value||'').trim();
                const cur = existingByEmp.get(Number(eid));
                const rec = {
                  id: cur?cur.id:undefined,
                  employee_id:Number(eid),
                  work_id:Number(work.id),
                  pm_id:Number(pmUser.id),
                  score: sc,
                  comment: cm,
                  created_at: cur?cur.created_at:isoNow(),
                  updated_at: isoNow(),
                };
                if(cur) await AsgardDB.put('employee_reviews', Object.assign(cur, rec));
                else await AsgardDB.add('employee_reviews', rec);
                await recomputeEmployeeRating(Number(eid));
              }

              await upsertCustomerReview({work_id:work.id, pm_id:pmUser.id, score:csc, comment:ccm});

              await audit(pmUser.id, 'work', Number(work.id), 'ratings', { employees: ids.length, customer_score:csc });

              AsgardUI.hideModal();
              resolve(true);
            }catch(e){
              toast('Оценки', e.message||'Ошибка', 'err', 7000);
            }
          };
        }
      });
    });
  }


  function safeJson(s,def){ try{return JSON.parse(s||"");}catch(_){return def;} }

  async function upsertStaffRequest({work, pmUser, requestObj, comment}){
    const reqs = await AsgardDB.all("staff_requests");
    let cur = reqs.find(r=>r.work_id===work.id);
    const payload = {
      work_id: work.id,
      pm_id: work.pm_id,
      status: "sent",
      is_vachta: !!work.is_vachta,
      rotation_days: Number(work.rotation_days||0) || 0,
      request_json: JSON.stringify(requestObj||{}),
      pm_comment: String(comment||""),
      hr_comment: "",
      proposed_staff_ids_json: JSON.stringify([]),
      proposed_staff_ids_a_json: JSON.stringify([]),
      proposed_staff_ids_b_json: JSON.stringify([]),
      created_at: cur?cur.created_at: isoNow(),
      updated_at: isoNow(),
    };
    if(cur){
      payload.id = cur.id;
      await AsgardDB.put("staff_requests", Object.assign(cur, payload));
      return cur.id;
    }else{
      const id = await AsgardDB.add("staff_requests", payload);
      return id;
    }
  }

  async function upsertPurchaseRequest({work, itemsObj}){
    const reqs = await AsgardDB.all("purchase_requests");
    let cur = reqs.find(r=>r.work_id===work.id);
    const payload = {
      work_id: work.id,
      pm_id: work.pm_id,
      status: "sent",
      items_json: JSON.stringify(itemsObj||{}),
      proc_comment: "",
      created_at: cur?cur.created_at: isoNow(),
      updated_at: isoNow(),
    };
    if(cur){
      payload.id = cur.id;
      await AsgardDB.put("purchase_requests", Object.assign(cur, payload));
      return cur.id;
    }else{
      const id = await AsgardDB.add("purchase_requests", payload);
      return id;
    }
  }
  async function getRefs(){
    const refs = await AsgardDB.get("settings","refs");
    return refs ? JSON.parse(refs.value_json||"{}") : { work_statuses:[], tender_statuses:[], reject_reasons:[] };
  }
  async function getSettings(){
    const s = await AsgardDB.get("settings","app");
    return s ? JSON.parse(s.value_json||"{}") : { vat_pct:20, gantt_start_iso:"2026-01-01T00:00:00.000Z", status_colors:{work:{},tender:{}} };
  }
  async function audit(actorId, entityType, entityId, action, payload){
    await AsgardDB.add("audit_log",{actor_user_id:actorId,entity_type:entityType,entity_id:entityId,action,payload_json:JSON.stringify(payload||{}),created_at:isoNow()});
  }

  async function notify(userId, title, body, linkHash){
    if(!userId) return;
    await AsgardDB.add("notifications",{
      user_id:userId,
      title:String(title||""),
      // unified field name across app: notifications.message
      message:String(body||""),
      link_hash: String(linkHash||""),
      is_read:false,
      created_at:isoNow()
    });
  }

  async function notifyDirectors(title, message, linkHash){
    const users = await AsgardDB.all("users");
    const isDirRole = (r)=> (window.AsgardAuth&&AsgardAuth.isDirectorRole)?AsgardAuth.isDirectorRole(r):(String(r||"")==="DIRECTOR"||String(r||"").startsWith("DIRECTOR_"));
    const directors = (users||[]).filter(u=>u && u.is_active && isDirRole(u.role));
    for(const d of directors){
      await notify(d.id, title, message, linkHash);
    }
  }

  async function userIdByLogin(login){
    const users = await AsgardDB.all("users");
    const u = (users||[]).find(x=>String(x.login||"").toLowerCase()===String(login||"").toLowerCase());
    return u ? u.id : null;
  }

  async function render({layout,title}){
    const auth=await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }
    const user=auth.user;

    const refs=await getRefs();
    const settings=await getSettings();

    const allWorks = await AsgardDB.all("works");
    const allTenders = await AsgardDB.all("tenders");

    // PM sees own, DIRECTOR sees all, ADMIN sees all
    const works = (user.role==="PM") ? allWorks.filter(w=>w.pm_id===user.id) : allWorks;

    let sortKey="id", sortDir=-1;

    const body = `
      ${window.__ASG_SHARED_TABLE_CSS__||""}
      <div class="panel">
        <div class="help">
          Раздел «Работы» — это контрактная стадия. Здесь фиксируются статусы выполнения, финансы, план/факт и сроки.
          Девиз: “Клятва дана — доведи дело до конца.”
        </div>
        <hr class="hr"/>
        <div class="chart">
          <h3>KPI: план vs факт (себестоимость / срок)</h3>
          <div class="help">Считается по работам, где заполнены план и факт. Отрицательное значение = факт лучше плана (зелёная зона справа). Положительное = перерасход/пересрок (красная зона слева).</div>
          <div style="display:flex; gap:14px; flex-wrap:wrap">
            <div style="min-width:240px; flex:1">
              <div class="help"><b>Себестоимость</b> (Σфакт vs Σплан)</div>
              <canvas id="kpi_cost" class="asgcanvas" height="140"></canvas>
            </div>
            <div style="min-width:240px; flex:1">
              <div class="help"><b>Срок</b> (Σфакт vs Σплан)</div>
              <canvas id="kpi_time" class="asgcanvas" height="140"></canvas>
            </div>
          </div>
        </div>

        <hr class="hr"/>
        <div class="tools">
          <div class="field">
            <label>Период</label>
            <select id="f_period">${generatePeriodOptions(ymNow())}</select>
          </div>
          <div class="field">
            <label>Поиск</label>
            <input id="f_q" placeholder="заказчик / работа" />
          </div>
          <div class="field">
            <label>Статус работ</label>
            <select id="f_status">
              <option value="">Все</option>
              ${(refs.work_statuses||[]).map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join("")}
            </select>
          </div>
          <div style="display:flex; gap:10px; flex-wrap:wrap">
            <button class="btn ghost" id="btnGantt">Гантт по работам</button>
          </div>
        </div>
        <hr class="hr"/>
        <div style="overflow:auto">
          <table class="asg">
            <thead>
              <tr>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="company">Заказчик / Работа</button></th>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="work_status">Статус</button></th>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="start_in_work_date">Сроки</button></th>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="contract_value">Деньги</button></th>
                <th></th>
              </tr>
            </thead>
            <tbody id="tb"></tbody>
          </table>
        </div>
        <div class="help" id="cnt"></div>
      </div>
    `;

    await layout(body,{title:title||"Карта Похода • Работы"});

    const tb=$("#tb"), cnt=$("#cnt");
    const cCost = $("#kpi_cost");
    const cTime = $("#kpi_time");

    function toDate(d){
      if(!d) return null;
      const s=String(d).trim();
      if(!s) return null;
      const m=s.match(/^\d{4}-\d{2}-\d{2}/);
      if(m){ const y=+m[0].slice(0,4), mo=+m[0].slice(5,7), da=+m[0].slice(8,10); return new Date(Date.UTC(y,mo-1,da,0,0,0)); }
      const dt=new Date(s); return isFinite(dt.getTime())?dt:null;
    }
    function diffDays(a,b){
      const da=toDate(a); const db=toDate(b);
      if(!da||!db) return null;
      return Math.round((db.getTime()-da.getTime())/(24*3600*1000));
    }
    function pctDelta(fact, plan){
      const p=Number(plan||0); const f=Number(fact||0);
      if(!isFinite(p) || p<=0) return null;
      return ((f-p)/p)*100;
    }

    function drawKpi(){
      // Works with plan+fact only
      const base = works;
      let planCost=0, factCost=0, planDays=0, factDays=0;
      for(const w of base){
        if(w.cost_plan!=null && w.cost_fact!=null){ planCost += Number(w.cost_plan||0); factCost += Number(w.cost_fact||0); }
        const dp = diffDays(w.start_in_work_date||w.start_plan, w.end_plan);
        const df = diffDays(w.start_in_work_date||w.start_plan, w.end_fact);
        if(dp!=null && df!=null && dp>0 && df>0){ planDays += dp; factDays += df; }
      }
      const costPct = pctDelta(factCost, planCost);
      const timePct = pctDelta(factDays, planDays);
      try{ if(cCost) dial(cCost, costPct, { title:'Δ себестоимость', valueFmt:(v)=>v==null?'—':(Math.round(v*10)/10)+'%' }); }catch(e){}
      try{ if(cTime) dial(cTime, timePct, { title:'Δ срок', valueFmt:(v)=>v==null?'—':(Math.round(v*10)/10)+'%' }); }catch(e){}
    }


    function norm(s){ return String(s||"").toLowerCase().trim(); }

    function sortBy(key,dir){
      return (a,b)=>{
        const av=(a[key]??""); const bv=(b[key]??"");
        if(typeof av==="number" && typeof bv==="number") return dir*(av-bv);
        return dir*String(av).localeCompare(String(bv), "ru", {sensitivity:"base"});
      };
    }

    function row(w){
      const st=w.work_status||"";
      const color = (settings.status_colors?.work||{})[st] || "#2a6cf1";
      const tender = allTenders.find(t=>t.id===w.tender_id);
      const start = w.start_in_work_date || w.start_plan || tender?.work_start_plan || "—";
      const end = w.end_fact || w.end_plan || tender?.work_end_plan || "—";
      const got = (Number(w.advance_received||0)+Number(w.balance_received||0))||0;
      const left = (w.contract_value||0) ? Math.max(0, Number(w.contract_value||0)-got) : 0;
      return `<tr data-id="${w.id}">
        <td><b>${esc(w.company||tender?.customer_name||"")}</b><div class="help">${esc(w.work_title||tender?.tender_title||"")}</div></td>
        <td><span class="pill" style="border-color:${esc(color)}">${esc(st)}</span></td>
        <td><div>${esc(start)} → ${esc(end)}</div><div class="help">tender #${w.tender_id}</div></td>
        <td>
          <div><b>${money(w.contract_value)}</b> ₽</div>
          <div class="help">получено: ${money(got)} ₽ • должны: ${money(left)} ₽</div>
        </td>
        <td><button class="btn" style="padding:6px 10px" data-act="open">Открыть</button></td>
      </tr>`;
    }

    function apply(){
      const per = norm($("#f_period").value);
      const q = norm($("#f_q").value);
      const st = $("#f_status").value;

      let list = works.filter(w=>{
        const t = allTenders.find(x=>x.id===w.tender_id);
        const period = (t?.period)||"";
        if(per && norm(period)!==per) return false;
        if(st && w.work_status!==st) return false;
        if(q){
          const hay = `${w.company||""} ${w.work_title||""} ${(t?.customer_name||"")} ${(t?.tender_title||"")}`.toLowerCase();
          if(!hay.includes(q)) return false;
        }
        return true;
      });

      list.sort(sortBy(sortKey, sortDir));
      tb.innerHTML = list.map(row).join("");
      cnt.textContent = `Показано: ${list.length} из ${works.length}.`;
    }

    drawKpi();

    apply();
    $("#f_period").addEventListener("input", apply);
    $("#f_q").addEventListener("input", apply);
    $("#f_status").addEventListener("change", apply);

    $$("[data-sort]").forEach(b=>{
      b.addEventListener("click", ()=>{
        const k=b.getAttribute("data-sort");
        if(sortKey===k) sortDir*=-1; else { sortKey=k; sortDir=1; }
        apply();
      });
    });

    tb.addEventListener("click",(e)=>{
      const tr=e.target.closest("tr[data-id]");
      if(!tr) return;
      if(e.target.getAttribute("data-act")==="open") openWork(Number(tr.getAttribute("data-id")));
    });

    $("#btnGantt").addEventListener("click", ()=>openGantt());

    async function openGantt(){
      const startIso = (settings.gantt_start_iso||"2026-01-01T00:00:00.000Z").slice(0,10);
      const rows = works.map(w=>{
        const t = allTenders.find(x=>x.id===w.tender_id);
        const start = w.start_in_work_date || t?.work_start_plan || w.end_plan || "2026-01-01";
        const end = w.end_fact || w.end_plan || t?.work_end_plan || start;
        const label = `${w.company||t?.customer_name||""}`;
        const sub = `${w.work_title||t?.tender_title||""}`;
        return { id:w.id, start, end, label, sub, barText:w.work_status||"" , status:w.work_status||"" };
      });
      const html = AsgardGantt.renderBoard({
        startIso, weeks: 60,
        rows,
        getColor:(r)=>(settings.status_colors?.work||{})[r.status]||"#2a6cf1"
      });
      showModal("Гантт • Работы (недели)", `<div style="max-height:80vh; overflow:auto">${html}</div>`);
    }

    async function openWork(id){
      const w = await AsgardDB.get("works", id);
      const triggerStatus = String((settings&&settings.work_close_trigger_status)||"Подписание акта");
      const t = await AsgardDB.get("tenders", w.tender_id);
      const got = (Number(w.advance_received||0)+Number(w.balance_received||0))||0;
      const left = (w.contract_value||0) ? Math.max(0, Number(w.contract_value||0)-got) : 0;
      const cost = (w.cost_fact!=null?Number(w.cost_fact): (w.cost_plan!=null?Number(w.cost_plan):null));
      const profit = (w.contract_value!=null && cost!=null) ? (Number(w.contract_value)-cost) : null;
      const start = w.start_in_work_date || t?.work_start_plan;
      const end = w.end_fact || w.end_plan || t?.work_end_plan || start;
      const duration = (start && end) ? daysBetween(start,end) : null;
      const crew = Number(w.crew_size||0)||0;
      const profitPerDay = (profit!=null && duration) ? profit/Math.max(1,duration) : null;
      const profitPerManDay = (profit!=null && duration) ? profit/Math.max(1,(crew||1)*duration) : null;

      const stColor = (settings.status_colors?.work||{})[w.work_status] || "#2a6cf1";
      const ganttMini = AsgardGantt.renderMini({
        startIso:(settings.gantt_start_iso||"2026-01-01T00:00:00.000Z").slice(0,10),
        weeks:24,
        barStart:start||"2026-01-01",
        barEnd:end||"2026-01-08",
        barLabel:`${w.work_status||""}`,
        barColor:stColor
      });

      const html = `
        <div class="help"><b>${esc(w.company||t?.customer_name||"")}</b> — ${esc(w.work_title||t?.tender_title||"")}</div>
        <div class="help">Девиз: “Клятва дана — доведи дело до конца.” • tender #${w.tender_id}</div>
        <hr class="hr"/>
        ${ganttMini}
        <hr class="hr"/>

        <div class="formrow">
          <div><label>Статус работ</label>
            <select id="w_status">
              ${(refs.work_statuses||[]).map(s=>`<option value="${esc(s)}" ${(w.work_status===s)?"selected":""}>${esc(s)}</option>`).join("")}
            </select>
          </div>
          <div><label>Начало работ (факт/старт)</label><input id="w_start" value="${esc(w.start_in_work_date||t?.work_start_plan||"")}" placeholder="YYYY-MM-DD"/></div>
          <div><label>Окончание план</label><input id="w_end_plan" value="${esc(w.end_plan||t?.work_end_plan||"")}" placeholder="YYYY-MM-DD"/></div>
          <div><label>Окончание факт</label><input id="w_end_fact" value="${esc(w.end_fact||"")}" placeholder="YYYY-MM-DD"/></div>

          <div><label>Стоимость договора</label><input id="w_value" value="${esc(w.contract_value!=null?String(w.contract_value):"")}" placeholder="руб."/></div>
          <div><label>Аванс %</label><input id="w_adv_pct" value="${esc(w.advance_pct!=null?String(w.advance_pct):"30")}" placeholder="30"/></div>
          <div><label>Аванс получено</label><input id="w_adv_got" value="${esc(w.advance_received!=null?String(w.advance_received):"0")}" placeholder="руб."/></div>
          <div><label>Дата аванса факт</label><input id="w_adv_date" value="${esc(w.advance_date_fact||"")}" placeholder="YYYY-MM-DD"/></div>

          <div><label>Остаток получено</label><input id="w_bal_got" value="${esc(w.balance_received!=null?String(w.balance_received):"0")}" placeholder="руб."/></div>
          <div><label>Дата оплаты остатка факт</label><input id="w_pay_date" value="${esc(w.payment_date_fact||"")}" placeholder="YYYY-MM-DD"/></div>
          <div><label>Дата акта факт</label><input id="w_act_date" value="${esc(w.act_signed_date_fact||"")}" placeholder="YYYY-MM-DD"/></div>
          <div><label>Отсрочка, раб.дни</label><input id="w_delay" value="${esc(w.delay_workdays!=null?String(w.delay_workdays):"5")}" placeholder="5"/></div>

          <div><label>План себестоимость</label><input id="w_cost_plan" value="${esc(w.cost_plan!=null?String(w.cost_plan):"")}" placeholder="руб."/></div>
          <div><label>Факт себестоимость</label><input id="w_cost_fact" value="${esc(w.cost_fact!=null?String(w.cost_fact):"")}" placeholder="руб."/></div>
          <div><label>Численность (для чел-дней)</label><input id="w_crew" value="${esc(w.crew_size!=null?String(w.crew_size):"")}" placeholder="например: 10"/></div>

          <div style="grid-column:1/-1"><label>Комментарий</label><input id="w_comment" value="${esc(w.comment||"")}" placeholder="важные заметки"/></div>
        </div>

        
        <hr class="hr"/>
        <div class="help"><b>Персонал (заявка HR)</b></div>
        <div class="formrow" style="grid-template-columns:repeat(2,minmax(220px,1fr))">
          <div style="display:flex; align-items:flex-end; gap:10px">
            <label style="display:flex; gap:10px; align-items:center">
              <input type="checkbox" id="sr_is_vachta" />
              <span>Вахта</span>
            </label>
          </div>
          <div>
            <label>Срок ротации, дней</label>
            <input id="sr_rotation_days" placeholder="0" />
          </div>
        </div>
        <div class="formrow">
          <div><label>Мастера</label><input id="sr_Мастера" placeholder="0" /></div>
          <div><label>Слесари</label><input id="sr_Слесари" placeholder="0" /></div>
          <div><label>ПТО</label><input id="sr_ПТО" placeholder="0" /></div>
          <div><label>Промывщики</label><input id="sr_Промывщики" placeholder="0" /></div>
          <div style="grid-column:1/-1"><label>Комментарий к запросу (PM)</label><input id="sr_comment" placeholder="условия, сменность, требования" /></div>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap">
          <button class="btn" id="btnReqStaff">Запросить рабочих</button>
          <button class="btn ghost" id="btnViewStaff">Открыть статус/ответ</button>
          <button class="btn ghost" id="btnApproveStaff">Принять</button>
          <button class="btn ghost" id="btnAskStaff">Вопрос</button>
        </div>

        <hr class="hr"/>
        <div class="help"><b>Закупки (заявка)</b></div>
        <div class="formrow">
          <div style="grid-column:1/-1"><label>Химия</label><input id="pr_chem" placeholder="перечень/объёмы" /></div>
          <div style="grid-column:1/-1"><label>Оборудование</label><input id="pr_eq" placeholder="НВД/шланги/головки/прочее" /></div>
          <div style="grid-column:1/-1"><label>Логистика</label><input id="pr_log" placeholder="транспорт/доставки/маршрут" /></div>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap">
          <button class="btn" id="btnReqProc">Отправить в закупки</button>
          <button class="btn ghost" id="btnViewProc">Открыть статус/ответ</button>
          <button class="btn ghost" id="btnApproveProc">Согласовать</button>
          <button class="btn ghost" id="btnReworkProc">На доработку</button>
        </div>
<hr class="hr"/>
        <div class="kpi" style="grid-template-columns:repeat(5,minmax(140px,1fr))">
          <div class="k"><div class="t">Получено</div><div class="v">${money(got)} ₽</div><div class="s">Аванс + остаток</div></div>
          <div class="k"><div class="t">Должны</div><div class="v">${money(left)} ₽</div><div class="s">Остаток к оплате</div></div>
          <div class="k"><div class="t">Прибыль</div><div class="v">${profit==null?"—":money(Math.round(profit))+" ₽"}</div><div class="s">стоимость − себест.</div></div>
          <div class="k"><div class="t">Прибыль/день</div><div class="v">${profitPerDay==null?"—":money(Math.round(profitPerDay))+" ₽"}</div><div class="s">по длительности</div></div>
          <div class="k"><div class="t">Прибыль/чел‑день</div><div class="v">${profitPerManDay==null?"—":money(Math.round(profitPerManDay))+" ₽"}</div><div class="s">по людям×дни</div></div>
        </div>

        <hr class="hr"/>
        <div style="display:flex; gap:10px; flex-wrap:wrap">
          ${(user.role==="PM" && String(w.work_status||"")===triggerStatus) ? `<button class="btn" id="btnCloseout" style="background:#ef4444">Работы завершены</button>` : ``}
          <button class="btn" id="btnSaveWork">Сохранить</button>
          <button class="btn ghost" id="btnExpenses">💰 Расходы</button>
          <button class="btn ghost" id="btnHistory">История</button>
          <button class="btn ghost" id="btnFullGantt">Открыть Гантт</button>
        </div>
      `;

      showModal(`Работа #${w.id}`, html);

      // вахта (UI)
      try{
        const cb = document.getElementById("sr_is_vachta");
        const rd = document.getElementById("sr_rotation_days");
        if(cb) cb.checked = !!w.is_vachta;
        if(rd) rd.value = w.rotation_days ? String(w.rotation_days) : "";
      }catch(_){ }

      const btnCloseout = $("#btnCloseout");
      if(btnCloseout){
        btnCloseout.addEventListener("click", ()=>closeoutWizard({
          work: w,
          pmUser: user,
          triggerStatus,
          onDone: async ()=>{
            await render({layout,title});
            openWork(id);
          }
        }));
      }

      $("#btnFullGantt").addEventListener("click", ()=>openGantt());

      // Кнопка "Расходы" — открывает модуль расходов Stage 13
      const btnExpenses = $("#btnExpenses");
      if(btnExpenses){
        btnExpenses.addEventListener("click", ()=>{
          if(window.AsgardWorkExpenses && AsgardWorkExpenses.openExpensesModal){
            AsgardWorkExpenses.openExpensesModal(w, user);
          } else {
            toast("Расходы", "Модуль расходов не загружен", "err");
          }
        });
      }

      $("#btnHistory").addEventListener("click", async ()=>{
        const logs = (await AsgardDB.all("audit_log"))
          .filter(l=>l.entity_type==="work" && l.entity_id===id)
          .sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
        const rows = logs.map(l=>`
          <div class="pill"><div class="who"><b>${esc(l.action)}</b> — ${esc(new Date(l.created_at).toLocaleString("ru-RU"))}</div><div class="role">${esc(l.actor_user_id)}</div></div>
          <div class="help" style="margin:6px 0 10px">${esc(l.payload_json||"")}</div>
        `).join("");
        showModal("История (work)", rows || `<div class="help">Пусто.</div>`);
      });

      // ===== Staff request flow (Stage 6) =====
      async function getStaffReq(){
        const reqs = await AsgardDB.all("staff_requests");
        return (reqs||[]).find(r=>Number(r.work_id||0)===Number(w.id));
      }
      async function openStaffReqModal(){
        const req = await getStaffReq();
        if(!req){ toast("Персонал","Заявка не найдена","err"); return; }
        const emps = await AsgardDB.all("employees");
        const byId = new Map((emps||[]).map(e=>[e.id,e]));
        const isVachta = !!req.is_vachta;
        const idsA = safeJson(req.proposed_staff_ids_a_json, []);
        const idsB = safeJson(req.proposed_staff_ids_b_json, []);
        const ids = safeJson(req.proposed_staff_ids_json, []);
        const listA = (idsA||[]).map(id=>byId.get(id)).filter(Boolean);
        const listB = (idsB||[]).map(id=>byId.get(id)).filter(Boolean);
        const list = (ids||[]).map(id=>byId.get(id)).filter(Boolean);

        // replacements
        let reps = [];
        try{ reps = await AsgardDB.byIndex("staff_replacements","staff_request_id", req.id); }catch(_){ reps = []; }
        reps = (reps||[]).sort((a,b)=>String(b.created_at||"").localeCompare(String(a.created_at||"")));
        const repHtml = reps.length ? `
          <div class="help" style="margin-top:10px"><b>Замены</b></div>
          ${reps.map(rp=>{
            const oldE = byId.get(Number(rp.old_employee_id));
            const newE = byId.get(Number(rp.new_employee_id));
            const crew = rp.crew ? ` (вахта ${esc(String(rp.crew))})` : "";
            const st = esc(String(rp.status||"sent"));
            const btn = (String(rp.status||"")==="sent") ? `<button class="btn" style="padding:6px 10px" data-act="repAccept" data-id="${rp.id}">Принять замену</button>` : ``;
            return `<div class="pill" style="justify-content:space-between; gap:10px">
              <div><div class="who"><b>${esc(oldE?oldE.fio:"—")}</b> → <b>${esc(newE?newE.fio:"—")}</b>${crew}</div>
              <div class="role">статус: ${st}${rp.comment?" • "+esc(rp.comment):""}</div></div>
              ${btn}
            </div>`;
          }).join("")}
        ` : ``;
        const html2 = `
          <div class="pill"><div class="who"><b>Статус</b></div><div class="role">${esc(req.status||"sent")}</div></div>
          <div class="help" style="margin-top:10px"><b>Комментарий HR</b>: ${esc(req.hr_comment||"—")}</div>
          ${isVachta ? `
            <div class="help" style="margin-top:10px"><b>Вахта</b>: срок ротации ${esc(String(req.rotation_days||""))} дн.</div>
            <div class="help" style="margin-top:10px"><b>Бригада А</b> (${listA.length}):</div>
            <div style="margin-top:8px">${listA.length ? listA.map(e=>`<div class="pill"><div class="who"><b>${esc(e.fio||"")}</b></div><div class="role">${esc(e.role_tag||"")}${e.city?" • "+esc(e.city):""}</div></div>`).join("") : `<div class="help">Пока не выбрано.</div>`}</div>
            <div class="help" style="margin-top:10px"><b>Бригада Б</b> (${listB.length}):</div>
            <div style="margin-top:8px">${listB.length ? listB.map(e=>`<div class="pill"><div class="who"><b>${esc(e.fio||"")}</b></div><div class="role">${esc(e.role_tag||"")}${e.city?" • "+esc(e.city):""}</div></div>`).join("") : `<div class="help">Пока не выбрано.</div>`}</div>
          ` : `
            <div class="help" style="margin-top:10px"><b>Выбранные рабочие</b> (${list.length}):</div>
            <div style="margin-top:8px">${list.length ? list.map(e=>`<div class="pill"><div class="who"><b>${esc(e.fio||"")}</b></div><div class="role">${esc(e.role_tag||"")}${e.city?" • "+esc(e.city):""}</div></div>`).join("") : `<div class="help">Пока не выбрано.</div>`}</div>
          `}

          ${repHtml}
          
          <hr class="hr"/>
          <div class="help"><b>Вопрос/чат с HR</b></div>
          <div id="sr_chat" style="margin-top:8px"></div>
          <div class="row" style="gap:10px; align-items:flex-end; margin-top:10px">
            <div style="flex:1">
              <label>Сообщение</label>
              <textarea id="sr_msg" rows="3" placeholder="Задайте вопрос HR (отказ невозможен)"></textarea>
            </div>
            <button class="btn" id="btnSendSrMsg" style="padding:8px 12px">Отправить</button>
          </div>

          <div class="help" style="margin-top:12px">Автобронь попадёт в «График Дружины • Рабочие» после согласования.</div>
        `;
        showModal("Заявка HR (персонал)", `<div style="max-height:78vh; overflow:auto">${html2}</div>`);

        // accept replacement
        async function acceptReplacement(repId){
          const rp = await AsgardDB.get("staff_replacements", Number(repId));
          if(!rp || String(rp.status||"")!=="sent"){ toast("Замена","Нет актуального запроса","err"); return; }
          const dates = safeJson(rp.dates_json, []);
          if(!Array.isArray(dates) || !dates.length){ toast("Замена","Период не задан","err"); return; }
          const oldId = Number(rp.old_employee_id);
          const newId = Number(rp.new_employee_id);
          // снять бронь старого
          const plans = await AsgardDB.byIndex("employee_plan","employee_id", oldId);
          for(const p of (plans||[])){
            if(Number(p.work_id||0)===Number(w.id) && dates.includes(String(p.date||"")) && String(p.kind||"")==="work"){
              await AsgardDB.del("employee_plan", p.id);
            }
          }
          // поставить бронь новому
          for(const dt of dates){
            await AsgardDB.add("employee_plan", { employee_id:newId, date:dt, kind:"work", work_id:w.id, staff_request_id:req.id, created_by:user.id, created_at: isoNow(), note: rp.crew ? ("вахта "+rp.crew) : ("замена") });
          }
          // обновить списки в staff_request
          const a = safeJson(req.approved_staff_ids_a_json, []);
          const b = safeJson(req.approved_staff_ids_b_json, []);
          const all = safeJson(req.approved_staff_ids_json, []);
          function repl(arr){
            return (arr||[]).map(x=>Number(x)).filter(x=>x!==oldId);
          }
          let a2=repl(a), b2=repl(b), all2=repl(all);
          if(!!req.is_vachta){
            if(rp.crew==="A") a2.push(newId);
            else if(rp.crew==="B") b2.push(newId);
            // union
            all2 = Array.from(new Set([...(a2||[]),...(b2||[])]));
            req.approved_staff_ids_a_json = JSON.stringify(a2);
            req.approved_staff_ids_b_json = JSON.stringify(b2);
            req.approved_staff_ids_json = JSON.stringify(all2);
          }else{
            all2.push(newId);
            req.approved_staff_ids_json = JSON.stringify(Array.from(new Set(all2)));
          }
          req.updated_at = isoNow();
          await AsgardDB.put("staff_requests", req);

          rp.status = "approved";
          rp.approved_by = user.id;
          rp.approved_at = isoNow();
          await AsgardDB.put("staff_replacements", rp);
          await audit(user.id, "staff_replacement", rp.id, "approve", { old:oldId, nw:newId, work_id:w.id });
          // notify HR
          const usersAll = await AsgardDB.all("users");
          const hrs = (usersAll||[]).filter(u=>u.role==="HR" || (Array.isArray(u.roles)&&u.roles.includes("HR")));
          for(const h of hrs){ await notify(h.id, "Замена согласована", `${w.company||""} — ${w.work_title||""}`, "#/hr-requests"); }
          toast("Замена","Согласовано");
          openStaffReqModal();
        }

        $$('[data-act="repAccept"]').forEach(b=>{
          b.addEventListener('click', ()=>acceptReplacement(Number(b.getAttribute('data-id'))));
        });

        // render chat
        async function renderChat(){
          let msgs = [];
          try{ msgs = await AsgardDB.byIndex("staff_request_messages","staff_request_id", req.id); }catch(e){ msgs=[]; }
          msgs = (msgs||[]).sort((a,b)=>String(a.created_at||"").localeCompare(String(b.created_at||"")));
          const usersAll = await AsgardDB.all("users");
          const uById = new Map((usersAll||[]).map(u=>[u.id,u]));
          const box = document.getElementById("sr_chat");
          if(!box) return;
          if(!msgs.length){ box.innerHTML = `<div class="help">Сообщений нет.</div>`; return; }
          box.innerHTML = msgs.map(m=>{
            const u = uById.get(m.author_user_id)||{};
            const who = esc(u.name||("user#"+m.author_user_id));
            const dt = m.created_at ? new Date(m.created_at).toLocaleString("ru-RU") : "";
            return `<div class="pill"><div class="who"><b>${who}</b> • ${esc(dt)}</div><div class="role">${esc(m.text||"")}</div></div>`;
          }).join("");
        }
        await renderChat();

        const btnSend = document.getElementById("btnSendSrMsg");
        if(btnSend){
          btnSend.addEventListener("click", async ()=>{
            const ta = document.getElementById("sr_msg");
            const text = String(ta && ta.value || "").trim();
            if(!text){ toast("Чат","Введите сообщение","err"); return; }
            const msg = { staff_request_id:req.id, author_user_id:user.id, text, created_at: isoNow() };
            const mid = await AsgardDB.add("staff_request_messages", msg);
            await audit(user.id, "staff_request_message", mid, "create", { staff_request_id:req.id });
            // notify HR (all HR roles)
            const usersAll = await AsgardDB.all("users");
            const hrs = (usersAll||[]).filter(u=>u.role==="HR" || (Array.isArray(u.roles)&&u.roles.includes("HR")));
            for(const h of hrs){
              await notify(h.id, "Вопрос по персоналу", `${w.company||""} — ${w.work_title||""}`, "#/hr-requests");
            }
            try{ ta.value=""; }catch(_){}
            await renderChat();
            toast("Чат","Отправлено");
          });
        }
      }

      async function hrUserId(){
        return await userIdByLogin("trukhin");
      }

      const btnReqStaff = document.getElementById("btnReqStaff");
      const btnViewStaff = document.getElementById("btnViewStaff");
      const btnApproveStaff = document.getElementById("btnApproveStaff");
      const btnAskStaff = document.getElementById("btnAskStaff");

      if(btnViewStaff) btnViewStaff.addEventListener("click", openStaffReqModal);
      if(btnAskStaff) btnAskStaff.addEventListener("click", openStaffReqModal);

      if(btnReqStaff) btnReqStaff.addEventListener("click", async ()=>{
        // вахта
        w.is_vachta = !!(document.getElementById("sr_is_vachta") && document.getElementById("sr_is_vachta").checked);
        w.rotation_days = Math.max(0, Math.round(num((document.getElementById("sr_rotation_days")||{}).value,0)));
        if(w.is_vachta && !w.rotation_days){
          toast("Вахта","Укажите срок ротации (дней)","err");
          return;
        }
        const reqObj = {
          "Мастера": Math.max(0, Math.round(num($("#sr_Мастера").value,0))),
          "Слесари": Math.max(0, Math.round(num($("#sr_Слесари").value,0))),
          "ПТО": Math.max(0, Math.round(num($("#sr_ПТО").value,0))),
          "Промывщики": Math.max(0, Math.round(num($("#sr_Промывщики").value,0)))
        };
        const total = Object.values(reqObj).reduce((a,b)=>a+Number(b||0),0);
        if(!total){ toast("Персонал","Укажите количество людей","err"); return; }
        const comment = String($("#sr_comment").value||"").trim();
        const idReq = await upsertStaffRequest({ work:w, pmUser:user, requestObj:reqObj, comment });
        await audit(user.id, "staff_request", idReq, "send", { work_id:w.id, req:reqObj });
        const hrId = await hrUserId();
        await notify(hrId, "Новая заявка персонала", `${w.company||""} — ${w.work_title||""}`, "#/hr-requests");
        toast("Персонал","Заявка отправлена HR");
      });

      if(btnApproveStaff) btnApproveStaff.addEventListener("click", async ()=>{
        const req = await getStaffReq();
        if(!req){ toast("Персонал","Заявка не найдена","err"); return; }
        if(String(req.status||"") !== "answered"){
          toast("Персонал","Нужно дождаться ответа HR (статус answered)","err");
          return;
        }
        const isVachta = !!req.is_vachta;
        const idsA = safeJson(req.proposed_staff_ids_a_json, []);
        const idsB = safeJson(req.proposed_staff_ids_b_json, []);
        const ids = safeJson(req.proposed_staff_ids_json, []);
        const roster = isVachta ? Array.from(new Set([...(idsA||[]),...(idsB||[])])) : ids;
        if(!Array.isArray(roster) || !roster.length){ toast("Персонал","HR не выбрал людей","err"); return; }

        // Auto-booking to workers schedule (обычная/вахта)
        const booking = window.AsgardBooking;
        if(!booking){ toast("Персонал","Модуль брони не найден","err"); return; }

        function vachtaDates(startIso, endIso, rotationDays, crewIndex){
          const out=[];
          const s=new Date(String(startIso)); s.setHours(0,0,0,0);
          const e=new Date(String(endIso)); e.setHours(0,0,0,0);
          if(isNaN(s.getTime())||isNaN(e.getTime())||e<s) return out;
          const d = Math.max(1, Math.round(Number(rotationDays||0)));
          for(let cur=new Date(s); cur<=e; cur.setDate(cur.getDate()+1)){
            const diffDays = Math.floor((cur.getTime()-s.getTime())/(24*60*60*1000));
            const seg = Math.floor(diffDays/d) % 2;
            if(seg===crewIndex){ out.push(booking.ymd(cur)); }
          }
          return out;
        }

        let res = null;
        if(!isVachta){
          res = await (booking.bookEmployeesForWork ? booking.bookEmployeesForWork({ employeeIds: roster, work: w, staff_request_id: req.id, actor_user_id: user.id }) : { ok:false, error:"NO_BOOKING" });
        }else{
          const rot = Number(req.rotation_days||w.rotation_days||0)||0;
          if(!rot){ toast("Вахта","Не задан срок ротации","err"); return; }
          const dr = await booking.getWorkDateRange(w);
          if(!dr.start || !dr.end){ res = { ok:false, error:"NO_DATES" }; }
          else{
            const datesA = vachtaDates(dr.start, dr.end, rot, 0);
            const datesB = vachtaDates(dr.start, dr.end, rot, 1);
            const rA = await booking.bookEmployeesForDates({ employeeIds: (idsA||[]), dates: datesA, work: w, staff_request_id: req.id, actor_user_id: user.id, note:"вахта А" });
            if(!rA.ok){ res = Object.assign({ which:"A" }, rA); }
            else{
              const rB = await booking.bookEmployeesForDates({ employeeIds: (idsB||[]), dates: datesB, work: w, staff_request_id: req.id, actor_user_id: user.id, note:"вахта Б" });
              res = rB.ok ? { ok:true, start:dr.start, end:dr.end, written:(rA.written||0)+(rB.written||0) } : Object.assign({ which:"B" }, rB);
            }
          }
        }
        if(!res.ok){
          if(res.error==="NO_DATES"){
            toast("Персонал","Не заданы даты работ (старт/план). Укажите в карточке работы.","err", 7000);
            return;
          }
          if(res.error==="CONFLICT"){
            const emps = await AsgardDB.all("employees");
            const empById = new Map((emps||[]).map(e=>[e.id,e]));
            const rows = (res.conflicts||[]).map(c=>{
              const e = empById.get(c.employee_id);
              const name = e ? (e.fio||"") : `ID ${c.employee_id}`;
              const days = c.rows.map(r=>`${esc(r.date)} (work #${esc(String(r.work_id||""))})`).join(", ");
              return `<div class="pill"><div class="who"><b>${esc(name)}</b></div><div class="role">${days}</div></div>`;
            }).join("");
            showModal("Конфликт брони", `
              <div class="help">Найден конфликт брони на период ${esc(res.start)} — ${esc(res.end)}. Согласование заблокировано.
              Сдвигать бронь может только Трухин (страница «График Дружины • Рабочие»).</div>
              <div style="margin-top:10px">${rows || ""}</div>
              <div class="row" style="justify-content:flex-end; gap:8px; margin-top:12px">
                <a class="btn" href="#/workers-schedule">Открыть график</a>
              </div>
            `);
            return;
          }
          toast("Персонал","Не удалось выполнить автобронь","err", 7000);
          return;
        }

        req.status = "approved";
        if(isVachta){
          req.approved_staff_ids_a_json = JSON.stringify(idsA||[]);
          req.approved_staff_ids_b_json = JSON.stringify(idsB||[]);
          req.approved_staff_ids_json = JSON.stringify(roster||[]);
        }else{
          req.approved_staff_ids_json = JSON.stringify(roster||[]);
        }
        req.updated_at = isoNow();
        await AsgardDB.put("staff_requests", req);
        await audit(user.id, "staff_request", req.id, "approve", { work_id:w.id, start:res.start||w.start_in_work_date||null, end:res.end||w.end_plan||null, employees:roster, is_vachta:isVachta });
        const hrId = await hrUserId();
        await notify(hrId, "Заявка персонала согласована", `${w.company||""} — ${w.work_title||""}`, "#/workers-schedule");
        const s = res.start||w.start_in_work_date||"";
        const e = res.end||w.end_plan||"";
        toast("Персонал", `Согласовано и забронировано: ${s} — ${e}`);
      });

      $("#btnSaveWork").addEventListener("click", async ()=>{
        const prevStatus = String(w.work_status||"");
        w.work_status = $("#w_status").value;
        w.start_in_work_date = $("#w_start").value.trim()||null;
        w.end_plan = $("#w_end_plan").value.trim()||null;
        w.end_fact = $("#w_end_fact").value.trim()||null;

        w.contract_value = num($("#w_value").value);
        w.advance_pct = num($("#w_adv_pct").value) ?? 30;
        w.advance_received = num($("#w_adv_got").value) ?? 0;
        w.advance_date_fact = $("#w_adv_date").value.trim()||null;
        w.balance_received = num($("#w_bal_got").value) ?? 0;
        w.payment_date_fact = $("#w_pay_date").value.trim()||null;
        w.act_signed_date_fact = $("#w_act_date").value.trim()||null;
        w.delay_workdays = num($("#w_delay").value) ?? 5;

        w.cost_plan = num($("#w_cost_plan").value);
        w.cost_fact = num($("#w_cost_fact").value);
        w.crew_size = num($("#w_crew").value);

        w.comment = $("#w_comment").value.trim()||"";
        // вахта (признак хранится в работе)
        try{
          w.is_vachta = !!(document.getElementById("sr_is_vachta") && document.getElementById("sr_is_vachta").checked);
          w.rotation_days = Math.max(0, Math.round(num((document.getElementById("sr_rotation_days")||{}).value,0)));
        }catch(_){ }
        // Validation layer (dates/money/required by key status)
        if(!V.dateOrder(w.start_in_work_date, w.end_plan)){ toast("Валидация","Плановый финиш не может быть раньше старта","err"); return; }
        if(w.end_fact && !V.dateOrder(w.start_in_work_date, w.end_fact)){ toast("Валидация","Факт. финиш не может быть раньше старта","err"); return; }
        const moneyFields=["contract_value","advance_pct","advance_received","balance_received","cost_plan","cost_fact"];
        for(const f of moneyFields){
          if(!V.moneyGE0(w[f])){ toast("Валидация",`Поле ${f}: значение должно быть числом >= 0`,"err"); return; }
        }
        // Status change confirmation
        if(prevStatus && prevStatus!==w.work_status){
          const ok = await AsgardConfirm.open({title:"Подтверждение", body:`Сменить статус работы: <b>${esc(prevStatus)}</b> → <b>${esc(w.work_status)}</b>?`, okText:"Да", cancelText:"Нет"});
          if(!ok) return;
        }


        // Completion is performed via the dedicated closeout button (mandatory fact fields + ratings)
        if(user.role==="PM" && String(w.work_status||"")==="Работы сдали" && prevStatus!=="Работы сдали"){
          toast("Статус","Используйте кнопку «Работы завершены» (факт + оценки)","err", 7000);
          w.work_status = prevStatus;
          return;
        }

        await AsgardDB.put("works", w);
        await audit(user.id,"work",id,"update",{work_status:w.work_status});
        toast("Работы","Сохранено");
        await render({layout,title});
        openWork(id);
      });
    }
  }

  return { render };
})();