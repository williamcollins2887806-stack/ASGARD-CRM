window.AsgardTendersPage = (function(){
  const { $, $$, esc, toast, showModal } = AsgardUI;
  const V = AsgardValidate;
  const isDirRole = (r)=> (window.AsgardAuth&&AsgardAuth.isDirectorRole)?AsgardAuth.isDirectorRole(r):(r==="DIRECTOR"||String(r||"").startsWith("DIRECTOR_"));

  function isoNow(){ return new Date().toISOString(); }
  function ymNow(){
    const d=new Date();
    const y=d.getFullYear();
    const m=String(d.getMonth()+1).padStart(2,"0");
    return `${y}-${m}`;
  }

  const TENDER_TYPES = ["Тендер","Запрос предложений","Оценка рынка","Прямой запрос","Доп. объём"];

  // === ЧЕРНОВИКИ ТЕНДЕРОВ ===
  const DRAFT_KEY = 'asgard_tender_draft';

  function saveDraft(data) {
    try {
      const draft = { ...data, saved_at: isoNow() };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      return true;
    } catch(e) {
      console.warn('[Tender] Draft save failed:', e);
      return false;
    }
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const draft = JSON.parse(raw);
      // Check if draft is less than 7 days old
      if (draft.saved_at) {
        const age = Date.now() - new Date(draft.saved_at).getTime();
        if (age > 7 * 24 * 60 * 60 * 1000) {
          clearDraft();
          return null;
        }
      }
      return draft;
    } catch(e) {
      return null;
    }
  }

  function clearDraft() {
    localStorage.removeItem(DRAFT_KEY);
  }

  function getDraftFormData() {
    return {
      period: document.getElementById("e_period")?.value || '',
      customer_inn: document.getElementById("e_inn")?.value || '',
      customer_name: document.getElementById("e_customer")?.value || '',
      tender_title: document.getElementById("e_title")?.value || '',
      tender_type: document.getElementById("e_type")?.value || '',
      tender_price: document.getElementById("e_price")?.value || '',
      group_tag: document.getElementById("e_tag")?.value || '',
      work_start_plan: document.getElementById("e_ws")?.value || '',
      work_end_plan: document.getElementById("e_we")?.value || '',
      purchase_url: document.getElementById("e_url")?.value || '',
      docs_deadline: document.getElementById("e_docs_deadline")?.value || '',
      tender_comment_to: document.getElementById("e_c_to")?.value || ''
    };
  }

  function restoreDraftToForm(draft) {
    if (!draft) return;
    const fields = {
      'e_period': draft.period,
      'e_inn': draft.customer_inn,
      'e_customer': draft.customer_name,
      'e_title': draft.tender_title,
      'e_type': draft.tender_type,
      'e_price': draft.tender_price,
      'e_tag': draft.group_tag,
      'e_ws': draft.work_start_plan,
      'e_we': draft.work_end_plan,
      'e_url': draft.purchase_url,
      'e_docs_deadline': draft.docs_deadline,
      'e_c_to': draft.tender_comment_to
    };
    for (const [id, value] of Object.entries(fields)) {
      const el = document.getElementById(id);
      if (el && value) el.value = value;
    }
  }

  // === ПРОВЕРКА ДУБЛИКАТОВ (Этап 34) ===
  
  // Fuzzy match - вычисляет схожесть строк (0..1)
  function fuzzyMatch(str1, str2) {
    const s1 = String(str1 || '').toLowerCase().trim();
    const s2 = String(str2 || '').toLowerCase().trim();
    if (!s1 || !s2) return 0;
    if (s1 === s2) return 1;
    
    // Простой алгоритм: проверяем включение слов
    const words1 = s1.split(/\s+/).filter(w => w.length > 2);
    const words2 = s2.split(/\s+/).filter(w => w.length > 2);
    
    if (words1.length === 0 || words2.length === 0) return 0;
    
    let matches = 0;
    for (const w1 of words1) {
      for (const w2 of words2) {
        if (w1 === w2 || w1.includes(w2) || w2.includes(w1)) {
          matches++;
          break;
        }
      }
    }
    
    return matches / Math.max(words1.length, words2.length);
  }

  // Поиск похожих тендеров
  async function findDuplicates(customerInn, customerName, tenderTitle) {
    const allTenders = await AsgardDB.all('tenders') || [];
    const duplicates = [];
    
    for (const t of allTenders) {
      // Проверяем совпадение заказчика
      const sameCustomer = 
        (customerInn && t.customer_inn === customerInn) ||
        fuzzyMatch(customerName, t.customer_name) > 0.7;
      
      if (!sameCustomer) continue;
      
      // Проверяем схожесть названия
      const titleSimilarity = fuzzyMatch(tenderTitle, t.tender_title);
      
      if (titleSimilarity >= 0.5) {
        duplicates.push({
          tender: t,
          similarity: titleSimilarity,
          matchType: titleSimilarity >= 0.9 ? 'exact' : (titleSimilarity >= 0.7 ? 'high' : 'medium')
        });
      }
    }
    
    // Сортируем по схожести
    duplicates.sort((a, b) => b.similarity - a.similarity);
    
    return duplicates.slice(0, 5); // Максимум 5 похожих
  }

  // Показать предупреждение о дубликатах
  function showDuplicateWarning(duplicates, onProceed, onCancel) {
    const html = `
      <div class="modal-overlay" id="duplicateModal" style="z-index:10001">
        <div class="modal-content" style="max-width:600px">
          <div class="modal-header" style="background:var(--amber);color:#000">
            <h3>⚠️ Возможный дубликат!</h3>
            <button class="btn ghost btnClose" style="color:#000">✕</button>
          </div>
          <div class="modal-body">
            <p style="margin-bottom:16px">Найдены похожие тендеры с этим заказчиком:</p>
            
            <div style="max-height:300px;overflow-y:auto">
              ${duplicates.map((d, i) => `
                <div class="card" style="margin-bottom:12px;padding:12px;border-left:4px solid ${d.matchType === 'exact' ? 'var(--red)' : (d.matchType === 'high' ? 'var(--amber)' : 'var(--blue)')}">
                  <div style="display:flex;justify-content:space-between;align-items:start">
                    <div>
                      <div style="font-weight:600">${esc(d.tender.tender_title || '—')}</div>
                      <div class="help">${esc(d.tender.customer_name || '—')}</div>
                      <div class="help">Период: ${esc(d.tender.period || '—')} · Статус: ${esc(d.tender.tender_status || '—')}</div>
                    </div>
                    <div style="text-align:right">
                      <span class="badge" style="background:${d.matchType === 'exact' ? 'var(--red)' : (d.matchType === 'high' ? 'var(--amber)' : 'var(--blue)')};color:#fff">
                        ${Math.round(d.similarity * 100)}% схожесть
                      </span>
                      <div style="margin-top:8px">
                        <button class="btn mini ghost btnOpenExisting" data-id="${d.tender.id}">Открыть →</button>
                      </div>
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
          <div class="modal-footer" style="display:flex;gap:12px;justify-content:flex-end;padding:16px">
            <button class="btn ghost" id="btnDupCancel">Отмена</button>
            <button class="btn amber" id="btnDupProceed">Создать всё равно</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', html);
    const modal = document.getElementById('duplicateModal');
    
    // Закрытие
    const closeModal = () => modal.remove();
    modal.querySelector('.btnClose').onclick = () => { closeModal(); if (onCancel) onCancel(); };
    document.getElementById('btnDupCancel').onclick = () => { closeModal(); if (onCancel) onCancel(); };
    
    // Открыть существующий
    modal.querySelectorAll('.btnOpenExisting').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        closeModal();
        // Закрываем модалку создания и открываем существующий тендер
        try { AsgardUI.hideModal(); } catch(e) {}
        location.hash = `#/tenders?open=${id}`;
      };
    });
    
    // Создать всё равно
    document.getElementById('btnDupProceed').onclick = () => {
      closeModal();
      if (onProceed) onProceed();
    };
  }

  // === КОНЕЦ БЛОКА ПРОВЕРКИ ДУБЛИКАТОВ ===

  function addDaysISO(d, days){
    const x = new Date(d.getTime());
    x.setDate(x.getDate()+Number(days||0));
    const y= x.getFullYear();
    const m= String(x.getMonth()+1).padStart(2,"0");
    const dd= String(x.getDate()).padStart(2,"0");
    return `${y}-${m}-${dd}`;
  }

  
  async function getAppSettings(){
    const s = await AsgardDB.get("settings","app");
    const obj = s ? JSON.parse(s.value_json||"{}") : {};
    obj.require_docs_on_handoff = (obj.require_docs_on_handoff!==false);
    obj.doc_types = Array.isArray(obj.doc_types)?obj.doc_types:[];
    obj.docs_folder_hint = obj.docs_folder_hint || "";

    obj.sla = obj.sla || {};
    obj.limits = obj.limits || {};
    // SLA defaults
    if(!Number.isFinite(obj.sla.docs_deadline_notice_days)) obj.sla.docs_deadline_notice_days = 5;
    if(!Number.isFinite(obj.sla.direct_request_deadline_days)) obj.sla.direct_request_deadline_days = 5;

    // Limits defaults
    if(!Number.isFinite(obj.limits.pm_active_calcs_limit)) obj.limits.pm_active_calcs_limit = 6;
    if(typeof obj.limits.pm_active_calcs_done_statuses !== 'string')
      obj.limits.pm_active_calcs_done_statuses = 'Согласование ТКП, ТКП согласовано, Клиент отказался, Клиент согласился';

    return obj;
  }

async function getRefs(){
    const refs = await AsgardDB.get("settings","refs");
    const defaultStatuses = ['Черновик','Новый','В работе','Отправлено на просчёт','Согласование ТКП','ТКП согласовано','Выиграли','Проиграли','Контракт','Клиент отказался','Клиент согласился','Отказ'];
    if(refs && refs.tender_statuses && refs.tender_statuses.length) return refs;
    return { tender_statuses: defaultStatuses, reject_reasons: (refs && refs.reject_reasons) || [] };
  }

  async function getUsers(){
    const users = await AsgardDB.all("users");
    return users.filter(u=>u.is_active);
  }

  function canEditTender(user, tender){
    if(user.role==="ADMIN") return {full:true, limited:false};
    if(isDirRole(user.role)) return {full:false, limited:true};
    if(user.role==="TO"){
      if(!tender.handoff_at && !tender.distribution_requested_at) return {full:true, limited:false};
      return {full:false, limited:true};
    }
    return {full:false, limited:false};
  }

  function money(x){
    if(x===null || x===undefined || x==="") return "";
    const n=Number(x);
    if(Number.isNaN(n)) return esc(x);
    return n.toLocaleString("ru-RU");
  }

  async function audit(actorId, entityType, entityId, action, payload){
    await AsgardDB.add("audit_log", {
      actor_user_id: actorId,
      entity_type: entityType,
      entity_id: entityId,
      action,
      payload_json: JSON.stringify(payload||{}),
      created_at: isoNow()
    });
  }


  async function notify(userId, title, message, link_hash){
    await AsgardDB.add("notifications", { user_id:userId, is_read:false, created_at: isoNow(), title, message, link_hash: link_hash||"#/tenders" });
  }

  function sortBy(key, dir){
    return (a,b)=>{
      const av=(a[key]??""); const bv=(b[key]??"");
      if(typeof av==="number" && typeof bv==="number") return dir*(av-bv);
      return dir*String(av).localeCompare(String(bv), "ru", {sensitivity:"base"});
    };
  }

  function norm(s){ return String(s||"").toLowerCase().trim(); }

  function tenderRow(t, pmName, createdByName){
    const fmtDate = AsgardUI.formatDate || (d => d ? new Date(d).toLocaleDateString('ru-RU') : '—');
    const ds = fmtDate(t.work_start_plan);
    const de = fmtDate(t.work_end_plan);
    const link = t.purchase_url ? `<a class="btn ghost" style="padding:6px 10px" target="_blank" href="${esc(t.purchase_url)}">Ссылка</a>` : "—";
    const ddl = fmtDate(t.docs_deadline);
    return `<tr data-id="${t.id}">
      <td><input type="checkbox" class="tender-check" value="${t.id}" onchange="window._asgTenderBulkCount&&window._asgTenderBulkCount()"/></td>
      <td>${esc(t.period||"")}</td>
      <td>
        <b>${esc(t.customer_name||"")}</b>
        <div class="help">${esc(t.customer_inn||"")}</div>
        <div class="help">${esc(t.tender_title||"")}</div>
      </td>
      <td>${esc(pmName||"—")}</td>
      <td>${esc(t.tender_type||"—")}</td>
      <td>${t.tender_status==='Черновик'?'<span class="badge draft">Черновик</span>':esc(t.tender_status||"")}${(t.distribution_requested_at && !t.handoff_at)?" <span class=\"badge\">На распределении</span>":""}</td>
      <td>${ddl}</td>
      <td>${esc(createdByName||"—")}</td>
      <td>${t.tender_price?money(t.tender_price):"—"}</td>
      <td>${ds} → ${de}</td>
      <td>${link}</td>
      <td><button class="btn" style="padding:6px 10px" data-act="open">Открыть</button></td>
    </tr>`;
  }

  function tableCSS(){
    return `<style>
      table.asg{width:100%; border-collapse:separate; border-spacing:0 10px;}
      table.asg th{font-size:11px; color:rgba(184,196,231,.92); font-weight:800; text-align:left; padding:0 10px;}
      table.asg td{padding:10px; background:rgba(13,20,40,.40); border:1px solid rgba(42,59,102,.85);}
      table.asg tr td:first-child{border-top-left-radius:14px;border-bottom-left-radius:14px;}
      table.asg tr td:last-child{border-top-right-radius:14px;border-bottom-right-radius:14px;}
      .tools{display:flex; gap:10px; flex-wrap:wrap; align-items:end}
      .tools .field{min-width:220px}
      .tag{display:inline-flex; gap:6px; align-items:center; padding:6px 10px; border-radius:999px;
        border:1px solid rgba(42,59,102,.85); background:rgba(13,20,40,.40); font-size:12px; color:rgba(184,196,231,.95)}
      .tag b{color:var(--gold)}
    </style>`;
  }

  async function render({layout, title}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }
    const user = auth.user;

    const users = await getUsers();
    const pms = users.filter(u=>u.role==="PM" || (Array.isArray(u.roles) && u.roles.includes("PM")));
    const byId = new Map(users.map(u=>[u.id,u]));
    const refs = await getRefs();
    const tenders = await AsgardDB.all("tenders");

    let sortKey="id", sortDir=-1;

    const body = `
      ${tableCSS()}
      <div class="panel">
        <div class="help">
          Реестр тендеров и передача в просчёт. После передачи ТО ограничен: документы/ссылка/тег/комментарий ТО.
          Переназначение РП — только директор/админ, с причиной и записью в журнал.
        </div>
        <hr class="hr"/>
        <div class="tools">
          <div class="field">
            <label>Период</label>
            <select id="f_period">
              <option value="">Все тендеры</option>
              <option value="year:${new Date().getFullYear()}" selected>За ${new Date().getFullYear()} год</option>
              <option value="year:${new Date().getFullYear()-1}">За ${new Date().getFullYear()-1} год</option>
              ${(() => {
                const opts = [];
                const now = new Date();
                for(let i = 0; i < 12; i++) {
                  const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                  const ym = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
                  const label = d.toLocaleDateString('ru-RU', {month:'long', year:'numeric'});
                  opts.push('<option value="'+ym+'">'+label+'</option>');
                }
                return opts.join('');
              })()}
            </select>
          </div>
          <div class="field">
            <label>Поиск</label>
            <input id="f_q" placeholder="заказчик / тендер / ссылка / тег" />
          </div>
          <div class="field">
            <label>Тип</label>
            <select id="f_type">
              <option value="">Все</option>
              ${TENDER_TYPES.map(tp=>`<option value="${esc(tp)}">${esc(tp)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Статус</label>
            <select id="f_status">
              <option value="">Все</option>
              ${refs.tender_statuses.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Ответственный РП</label>
            <select id="f_pm">
              <option value="">Все</option>
              ${pms.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("")}
            </select>
          </div>
          <div style="display:flex; gap:10px; flex-wrap:wrap">
            <button class="btn" id="btnNew">+ Внести тендер</button>
            <button class="btn ghost" id="btnReset">Сброс</button>
            ${user.role === "ADMIN" ? '<button class="btn ghost" id="btnBulkReassign" style="background:rgba(139,92,246,.2)">🔄 Массовое переназначение</button>' : ''}
          </div>
        </div>
        <hr class="hr"/>
        <div id="dist_panel"></div>
        <div id="win_panel"></div>
        <div style="overflow:auto">
          <table class="asg">
            <thead>
              <tr>
                <th><input type="checkbox" id="selectAllTenders" title="Выбрать все"/></th>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="period">Период</button></th>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="customer_name">Заказчик / Тендер</button></th>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="responsible_pm_id">РП</button></th>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="tender_type">Тип</button></th>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="tender_status">Статус</button></th>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="docs_deadline">Дедлайн</button></th>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="created_by_user_id">Внёс</button></th>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="tender_price">Сумма</button></th>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="work_start_plan">Сроки (план)</button></th>
                <th>Документы</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="tb"></tbody>
          </table>
        </div>
        <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-top:8px">
          <div class="help" id="cnt"></div>
          <div id="bulkCount" style="font-weight:600; color:var(--primary); display:none"></div>
          <button class="btn ghost" id="btnBulkSelected" style="display:none; background:rgba(139,92,246,.2)">Переназначить выбранные</button>
        </div>
      </div>
    `;

    await layout(body, {title: title||"Сага Тендеров"});

    const tb=$("#tb");
    const cnt=$("#cnt");
    const distPanel = $("#dist_panel");
    const winPanel = $("#win_panel");

    await (async function renderDistributionPanel(){
      if(!distPanel) return;
      const canDist = (isDirRole(user.role) || user.role==="ADMIN");
      if(!canDist){ distPanel.innerHTML=""; return; }

      const pending = tenders.filter(t=>t.distribution_requested_at && !t.handoff_at);
      if(!pending.length){ distPanel.innerHTML=""; return; }

      const appS = await getAppSettings();
      const lim = Number(appS?.limits?.pm_active_calcs_limit ?? 0) || 0;
      const doneRaw = String(appS?.limits?.pm_active_calcs_done_statuses||"");
      const done = new Set(doneRaw.split(",").map(s=>s.trim()).filter(Boolean));
      if(done.size===0){
        ["Согласование ТКП","ТКП согласовано","Клиент отказался","Клиент согласился"].forEach(x=>done.add(x));
      }
      const activeByPm = new Map();
      for(const t of tenders){
        if(!t.handoff_at) continue;
        const pmId = Number(t.responsible_pm_id||0);
        if(!pmId) continue;
        if(done.has(String(t.tender_status||""))) continue;
        activeByPm.set(pmId, (activeByPm.get(pmId)||0) + 1);
      }

      const rows = pending.map(t=>{
        const createdBy = (byId.get(t.created_by_user_id)||{}).name || "";
        const ddl = t.docs_deadline ? new Date(t.docs_deadline).toLocaleDateString("ru-RU") : "";
        const opts = pms.map(p=>{
          const a = activeByPm.get(p.id)||0;
          const dis = (lim>0 && a>=lim) ? "disabled" : "";
          return `<option value="${p.id}" ${dis}>${esc(p.name)} (${a}/${lim||"∞"})</option>`;
        }).join("");
        return `
          <tr>
            <td>${esc(t.customer_name||"")}</td>
            <td>${esc(t.tender_title||"")}</td>
            <td>${esc(String(t.tender_type||""))}</td>
            <td>${esc(ddl)}</td>
            <td>${esc(createdBy)}</td>
            <td style="white-space:nowrap">
              <select id="dist_pm_${t.id}" style="min-width:220px">${opts}</select>
              <button class="btn red" style="padding:6px 10px; margin-left:8px" data-assign="${t.id}">Назначить</button>
            </td>
          </tr>
        `;
      }).join("");

      distPanel.innerHTML = `
        <div class="card">
          <div class="row" style="justify-content:space-between; align-items:center">
            <h3 style="margin:0">Распределение тендеров</h3>
            <span class="badge">${pending.length}</span>
          </div>
          <div class="help">Назначение РП выполняется директорами. Перегруженные РП недоступны. Лимит активных просчётов: ${lim||"без лимита"}. Активным считается всё, кроме статусов: ${esc(Array.from(done).join(", "))}.</div>
          <div style="overflow:auto; margin-top:10px">
            <table class="t" style="min-width:900px">
              <thead>
                <tr><th>Заказчик</th><th>Тендер</th><th>Тип</th><th>Дедлайн</th><th>Внёс</th><th></th></tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
        <hr class="hr"/>
      `;

      distPanel.querySelectorAll("button[data-assign]").forEach(btn=>{
        btn.addEventListener("click", async ()=>{
          const tid = Number(btn.getAttribute("data-assign"));
          const sel = distPanel.querySelector(`#dist_pm_${tid}`);
          const pmId = Number(sel && sel.value || 0);
          if(!pmId){ toast("Распределение","Выберите РП","err"); return; }

          // актуализируем и проверяем, что уже не назначено
          const cur = await AsgardDB.get("tenders", tid);
          if(!cur){ toast("Распределение","Тендер не найден","err"); return; }
          if(cur.handoff_at){ toast("Распределение","Уже передан в просчёт другим директором","warn"); await render({layout, title}); return; }

          const appS2 = await getAppSettings();
          const lim2 = Number(appS2?.limits?.pm_active_calcs_limit ?? 0) || 0;
          const doneRaw2 = String(appS2?.limits?.pm_active_calcs_done_statuses||"");
          const done2 = new Set(doneRaw2.split(",").map(s=>s.trim()).filter(Boolean));
          if(done2.size===0){
            ["Согласование ТКП","ТКП согласовано","Клиент отказался","Клиент согласился"].forEach(x=>done2.add(x));
          }
          const all = await AsgardDB.all("tenders");
          const active = all.filter(t=>t.handoff_at && Number(t.responsible_pm_id||0)===pmId && !done2.has(String(t.tender_status||""))).length;
          if(lim2>0 && active>=lim2){ toast("Распределение",`У РП уже ${active}/${lim2} активных просчётов. Выберите другого.`,`err`); return; }

          const now = isoNow();
          cur.responsible_pm_id = pmId;
          cur.handoff_at = now;
          cur.handoff_by_user_id = user.id;
          cur.distribution_assigned_at = now;
          cur.distribution_assigned_by_user_id = user.id;
          cur.tender_status = "Отправлено на просчёт";
          await AsgardDB.put("tenders", cur);
          await audit(user.id,"tender",tid,"distribute_to_pm",{pm_id: pmId});

          const pmName = (byId.get(pmId)||{}).name || "РП";
          await notify(pmId,"Тендер на просчёт",`${cur.customer_name||""}: ${cur.tender_title||""} → ${pmName}.`,'#/pm-calcs');
          toast("Распределение","Назначено. Тендер передан в просчёт.","ok");
          await render({layout, title});
        });
      });
    })();

    // ===== Stage 7: Назначение РП на работу после статуса «Клиент согласился» =====
    await (async function renderWinAssignPanel(){
      if(!winPanel) return;
      const canWin = (isDirRole(user.role) || user.role==="ADMIN");
      if(!canWin){ winPanel.innerHTML=""; return; }

      let reqs = [];
      try{ reqs = await AsgardDB.all("work_assign_requests"); }catch(e){}
      reqs = (reqs||[]).filter(r=>r.status==="pending");

      if(!reqs.length){ winPanel.innerHTML=""; return; }

      const worksAll = await AsgardDB.all("works");

      function parseISO(d){ if(!d) return null; const x=new Date(d); return isNaN(x.getTime())?null:x; }
      function daysBetween(a,b){ return Math.floor((b.getTime()-a.getTime())/86400000)+1; }
      function overlapDays(s1,e1,s2,e2){
        const a1=parseISO(s1), b1=parseISO(e1), a2=parseISO(s2), b2=parseISO(e2);
        if(!a1||!b1||!a2||!b2) return 0;
        const s = new Date(Math.max(a1.getTime(), a2.getTime()));
        const e = new Date(Math.min(b1.getTime(), b2.getTime()));
        if(e.getTime() < s.getTime()) return 0;
        return daysBetween(s,e);
      }

      async function hasApprovedOverride(request_id, pm_id){
        try{
          const cons = await AsgardDB.all("pm_consents");
          return (cons||[]).some(c=>c.type==="overlap_override" && Number(c.request_id)===Number(request_id) && Number(c.pm_id)===Number(pm_id) && c.status==="approved");
        }catch(e){ return false; }
      }

      async function requestOverride({reqId, pmId, tender}){
        const now = isoNow();
        const c = {
          type:"overlap_override",
          request_id:reqId,
          tender_id:tender.id,
          pm_id:pmId,
          status:"pending",
          created_at:now,
          created_by_user_id:user.id,
          decided_at:null,
          decided_by_user_id:null
        };
        const idC = await AsgardDB.add("pm_consents", c);
        await audit(user.id,"pm_consent",idC,"create",{reqId, pmId});
        await notify(pmId,"Нужно согласие РП",`Пересечение по срокам работ. Разрешить назначение? (${tender.customer_name} — ${tender.tender_title})`,"#/pm-consents");
        toast("Согласие","Запрос отправлен РП");
        await render({layout, title});
      }

      const rows = await Promise.all(reqs.map(async r=>{
        const t = await AsgardDB.get("tenders", r.tender_id);
        if(!t) return "";
        const ds = t.work_start_plan||"—";
        const de = t.work_end_plan||"—";
        const srcPm = (byId.get(r.source_pm_id)||{}).name || "—";

        const opts = [];
        for(const p of pms){
          // overlap calc with existing works of PM
          const pmWorks = worksAll.filter(w=>Number(w.pm_id||0)===Number(p.id));
          let maxOv = 0;
          for(const w of pmWorks){
            // считаем только если есть плановые даты
            const ov = overlapDays(t.work_start_plan, t.work_end_plan, w.start_in_work_date, w.end_plan);
            if(ov>maxOv) maxOv=ov;
          }
          const okOverride = await hasApprovedOverride(r.id, p.id);
          const disabled = (maxOv>7 && !okOverride) ? "disabled" : "";
          const warn = (maxOv>0 && maxOv<=7) ? ` ⚠${maxOv}д` : (maxOv>7 ? ` ⛔${maxOv}д` : "");
          const ovr = okOverride ? " ✅согл" : "";
          opts.push(`<option value="${p.id}" ${disabled}>${esc(p.name)}${warn}${ovr}</option>`);
        }

        return `
          <tr>
            <td>${esc(t.customer_name||"")}</td>
            <td>${esc(t.tender_title||"")}</td>
            <td>${esc(ds)} → ${esc(de)}</td>
            <td>${r.price_tkp!=null?money(r.price_tkp):"—"} / ${r.cost_plan!=null?money(r.cost_plan):"—"}</td>
            <td>${esc(srcPm)}</td>
            <td style="white-space:nowrap">
              <select id="win_pm_${r.id}" style="min-width:240px">${opts.join("")}</select>
              <button class="btn red" style="padding:6px 10px; margin-left:8px" data-win-assign="${r.id}">Назначить</button>
              <button class="btn ghost" style="padding:6px 10px; margin-left:8px" data-win-consent="${r.id}">Запросить согласие</button>
            </td>
          </tr>
        `;
      }));

      winPanel.innerHTML = `
        <div class="card">
          <div class="row" style="justify-content:space-between; align-items:center">
            <h3 style="margin:0">Назначение РП на работу (победы)</h3>
            <span class="badge">${reqs.length}</span>
          </div>
          <div class="help">Запрос создаётся после статуса «Клиент согласился» у РП в просчёте. Пересечение плановых сроков: ≤7 дней — предупреждение, >7 дней — блок (override только после согласия РП).</div>
          <div style="overflow:auto; margin-top:10px">
            <table class="t" style="min-width:1050px">
              <thead>
                <tr><th>Заказчик</th><th>Работа</th><th>Период (план)</th><th>Цена/Себест.</th><th>Просчитал</th><th></th></tr>
              </thead>
              <tbody>${rows.join("")}</tbody>
            </table>
          </div>
        </div>
        <hr class="hr"/>
      `;

      winPanel.querySelectorAll("button[data-win-assign]").forEach(btn=>{
        btn.addEventListener("click", async ()=>{
          const reqId = Number(btn.getAttribute("data-win-assign"));
          const req = await AsgardDB.get("work_assign_requests", reqId);
          if(!req || req.status!=="pending"){ toast("Назначение","Уже обработано","warn"); await render({layout,title}); return; }
          const tender = await AsgardDB.get("tenders", req.tender_id);
          if(!tender){ toast("Назначение","Тендер не найден","err"); return; }
          const sel = winPanel.querySelector(`#win_pm_${reqId}`);
          const pmId = Number(sel && sel.value || 0);
          if(!pmId){ toast("Назначение","Выберите РП","err"); return; }

          // Check overlap again
          const worksAll2 = await AsgardDB.all("works");
          const pmWorks = worksAll2.filter(w=>Number(w.pm_id||0)===pmId);
          let maxOv=0;
          for(const w of pmWorks){
            const ov = overlapDays(tender.work_start_plan, tender.work_end_plan, w.start_in_work_date, w.end_plan);
            if(ov>maxOv) maxOv=ov;
          }
          const okOverride = await hasApprovedOverride(reqId, pmId);
          if(maxOv>7 && !okOverride){
            toast("Назначение",`Пересечение ${maxOv} дней: нужен override и согласие РП.`,"err",7000);
            return;
          }

          // Create work if not exists
          const exist = (await AsgardDB.byIndex("works","tender_id", tender.id))[0];
          if(exist){
            toast("Назначение","Работа уже создана ранее","warn");
          }else{
            const work = {
              tender_id: tender.id,
              pm_id: pmId,
              company: tender.customer_name,
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
              cost_plan: req.cost_plan ?? null,
              cost_fact: null,
              comment: ""
            };
            const wid = await AsgardDB.add("works", work);
            await audit(user.id,"work",wid,"create_from_win_assign",{tender_id:tender.id, req_id:reqId, pm_id:pmId});
          }

          // Update request
          req.status="assigned";
          req.assigned_pm_id=pmId;
          req.assigned_by_user_id=user.id;
          req.assigned_at=isoNow();
          await AsgardDB.put("work_assign_requests", req);
          await audit(user.id,"work_assign_request",reqId,"assign",{pm_id:pmId});

          await notify(pmId,"Назначена работа",`${tender.customer_name} — ${tender.tender_title}`,"#/pm-works");
          toast("Назначение","Работа назначена");
          await render({layout,title});
        });
      });

      winPanel.querySelectorAll("button[data-win-consent]").forEach(btn=>{
        btn.addEventListener("click", async ()=>{
          const reqId = Number(btn.getAttribute("data-win-consent"));
          const req = await AsgardDB.get("work_assign_requests", reqId);
          if(!req || req.status!=="pending"){ toast("Согласие","Запрос неактуален","warn"); return; }
          const tender = await AsgardDB.get("tenders", req.tender_id);
          const sel = winPanel.querySelector(`#win_pm_${reqId}`);
          const pmId = Number(sel && sel.value || 0);
          if(!pmId){ toast("Согласие","Выберите РП в списке","err"); return; }
          await requestOverride({reqId, pmId, tender});
        });
      });
    })();

    function applyAndRender(){

      const periodVal = $("#f_period").value;
      const q = norm($("#f_q").value);
      const tp = $("#f_type").value;
      const st = $("#f_status").value;
      const pm = $("#f_pm").value;

      let list = tenders.filter(t=>{
        // Фильтр по периоду
        if(periodVal) {
          if(periodVal.startsWith("year:")) {
            // Фильтр по году
            const year = parseInt(periodVal.split(":")[1]);
            if(Number(t.year || (t.period||"").slice(0,4)) !== year) return false;
          } else {
            // Фильтр по месяцу (YYYY-MM)
            if(norm(t.period) !== norm(periodVal)) return false;
          }
        }
        if(tp && String(t.tender_type||"")!==String(tp)) return false;
        if(st && t.tender_status!==st) return false;
        if(pm && String(t.responsible_pm_id||"")!==String(pm)) return false;
        if(q){
          const hay = `${t.customer_inn||""} ${t.customer_name||""} ${t.tender_title||""} ${t.purchase_url||""} ${t.group_tag||""} ${t.tender_type||""}`.toLowerCase();
          if(!hay.includes(q)) return false;
        }
        return true;
      });

      list.sort(sortBy(sortKey, sortDir));

      tb.innerHTML = list.map(t=>tenderRow(t, (byId.get(t.responsible_pm_id)||{}).name, (byId.get(t.created_by_user_id)||{}).name)).join("");
      cnt.textContent = `Показано: ${list.length} из ${tenders.length}.`;
    }

    applyAndRender();

    // Мобильные карточки
    if (window.AsgardUI?.makeResponsiveTable) {
      AsgardUI.makeResponsiveTable('.asg');
    }

    $("#f_period").addEventListener("change", applyAndRender);
    $("#f_q").addEventListener("input", applyAndRender);
    $("#f_type").addEventListener("change", applyAndRender);
    $("#f_status").addEventListener("change", applyAndRender);
    $("#f_pm").addEventListener("change", applyAndRender);

    $("#btnReset").addEventListener("click", ()=>{
      $("#f_period").value = "year:" + new Date().getFullYear();
      $("#f_q").value="";
      $("#f_type").value="";
      $("#f_status").value="";
      $("#f_pm").value="";
      applyAndRender();
    });

    $$("[data-sort]").forEach(b=>{
      b.addEventListener("click", ()=>{
        const k=b.getAttribute("data-sort");
        if(sortKey===k) sortDir*=-1; else { sortKey=k; sortDir=1; }
        applyAndRender();
      });
    });

    $("#btnNew").addEventListener("click", ()=>openTenderEditor(null));

    // Чекбоксы массового выбора
    function updateBulkCount(){
      const checked = $$(".tender-check:checked");
      const count = checked.length;
      const bulkCountEl = $("#bulkCount");
      const bulkBtn = $("#btnBulkSelected");
      if(bulkCountEl) { bulkCountEl.textContent = count ? `Выбрано: ${count}` : ''; bulkCountEl.style.display = count ? '' : 'none'; }
      if(bulkBtn) bulkBtn.style.display = count > 0 ? '' : 'none';
    }
    window._asgTenderBulkCount = updateBulkCount;

    const selectAllEl = $("#selectAllTenders");
    if(selectAllEl){
      selectAllEl.addEventListener("change", ()=>{
        $$(".tender-check").forEach(cb=>{ cb.checked = selectAllEl.checked; });
        updateBulkCount();
      });
    }

    const btnBulkSelected = $("#btnBulkSelected");
    if(btnBulkSelected && (user.role === "ADMIN" || isDirRole(user.role))){
      btnBulkSelected.addEventListener("click", ()=>{
        const ids = $$(".tender-check:checked").map(cb=>Number(cb.value));
        if(!ids.length){ toast("Ошибка","Выберите тендеры","err"); return; }
        const pmOpts = pms.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("");
        const html = `
          <div style="margin-bottom:16px">Выбрано тендеров: <b>${ids.length}</b></div>
          <div class="formrow">
            <div><label>Новый ответственный РП</label><select id="bulk_sel_pm"><option value="">— выбрать —</option>${pmOpts}</select></div>
            <div><label>Причина</label><input id="bulk_sel_reason" value="Переназначение"/></div>
          </div>
          <hr class="hr"/>
          <button class="btn" id="bulk_sel_do">Переназначить</button>
        `;
        showModal("Переназначение выбранных тендеров", html);
        $("#bulk_sel_do").addEventListener("click", async ()=>{
          const newPmId = Number($("#bulk_sel_pm").value||0);
          const reason = ($("#bulk_sel_reason").value||"").trim();
          if(!newPmId){ toast("Ошибка","Выберите РП","err"); return; }
          if(!reason){ toast("Ошибка","Укажите причину","err"); return; }
          if(!confirm(`Переназначить ${ids.length} тендеров?`)) return;
          let count = 0;
          for(const id of ids){
            const t = tenders.find(x=>x.id===id);
            if(!t) continue;
            const oldPm = t.responsible_pm_id;
            t.responsible_pm_id = newPmId;
            await AsgardDB.put("tenders", t);
            await audit(user.id, "tender", t.id, "bulk_reassign_pm", {old_pm: oldPm, new_pm: newPmId, reason});
            count++;
          }
          toast("Готово", `Переназначено ${count} тендеров`);
          AsgardUI.hideModal();
          applyAndRender();
        });
      });
    }

    // Массовое переназначение тендеров (только для админа)
    const btnBulk = $("#btnBulkReassign");
    if(btnBulk){
      btnBulk.addEventListener("click", async ()=>{
        // Получаем архивного пользователя
        const archiveUser = users.find(u => u.login === "archive");
        if(!archiveUser){
          toast("Ошибка", "Архивный пользователь не найден", "err");
          return;
        }
        
        // Считаем тендеры архивного пользователя
        const archiveTenders = tenders.filter(t => t.responsible_pm_id === archiveUser.id);
        
        // Группируем по статусам
        const byStatus = {};
        for(const t of archiveTenders){
          const s = t.tender_status || "Без статуса";
          if(!byStatus[s]) byStatus[s] = [];
          byStatus[s].push(t);
        }
        
        const statusList = Object.entries(byStatus).map(([s, arr]) => 
          `<div style="padding:4px 0"><b>${esc(s)}</b>: ${arr.length} тендеров</div>`
        ).join("");
        
        const pmOpts = pms.filter(p => p.login !== "archive").map(p => 
          `<option value="${p.id}">${esc(p.name)}</option>`
        ).join("");
        
        const statusOpts = Object.keys(byStatus).map(s =>
          `<option value="${esc(s)}">${esc(s)} (${byStatus[s].length})</option>`
        ).join("");
        
        const html = `
          <div style="margin-bottom:16px">
            <div style="font-size:14px; font-weight:700; margin-bottom:8px">Тендеры на архивном РП: ${archiveTenders.length}</div>
            <div style="background:rgba(13,20,40,.5); padding:12px; border-radius:6px; max-height:150px; overflow:auto; font-size:13px">
              ${statusList}
            </div>
          </div>
          <div class="formrow">
            <div>
              <label>Статус тендеров для переноса</label>
              <select id="bulk_status">
                <option value="__ALL__">— Все статусы —</option>
                ${statusOpts}
              </select>
            </div>
            <div>
              <label>Новый ответственный РП</label>
              <select id="bulk_pm">
                <option value="">— выбрать —</option>
                ${pmOpts}
              </select>
            </div>
          </div>
          <div class="formrow">
            <div style="grid-column:1/-1">
              <label>Причина переназначения</label>
              <input id="bulk_reason" value="Перенос архивных тендеров" />
            </div>
          </div>
          <hr class="hr"/>
          <div style="display:flex; gap:10px">
            <button class="btn" id="bulk_do" style="background:linear-gradient(135deg, rgba(139,92,246,.4), rgba(139,92,246,.2))">🔄 Переназначить</button>
            <div id="bulk_result" style="padding:10px; color:var(--muted)"></div>
          </div>
        `;
        
        showModal("Массовое переназначение тендеров", html);
        
        $("#bulk_do").addEventListener("click", async ()=>{
          const newPmId = Number($("#bulk_pm").value || 0);
          const statusFilter = $("#bulk_status").value;
          const reason = $("#bulk_reason").value.trim();
          
          if(!newPmId){ toast("Ошибка", "Выберите РП", "err"); return; }
          if(!reason){ toast("Ошибка", "Укажите причину", "err"); return; }
          
          // Фильтруем тендеры
          let toReassign = archiveTenders;
          if(statusFilter !== "__ALL__"){
            toReassign = archiveTenders.filter(t => t.tender_status === statusFilter);
          }
          
          if(!toReassign.length){
            toast("Ошибка", "Нет тендеров для переназначения", "err");
            return;
          }
          
          if(!confirm(`Переназначить ${toReassign.length} тендеров?`)) return;
          
          let count = 0;
          for(const t of toReassign){
            const oldPm = t.responsible_pm_id;
            t.responsible_pm_id = newPmId;
            await AsgardDB.put("tenders", t);
            await audit(user.id, "tender", t.id, "bulk_reassign_pm", {old_pm: oldPm, new_pm: newPmId, reason});
            count++;
          }
          
          toast("Готово", `Переназначено ${count} тендеров`);
          render({layout, title});
        });
      });
    }

    tb.addEventListener("click", async (e)=>{
      const tr=e.target.closest("tr[data-id]");
      if(!tr) return;
      const id=Number(tr.getAttribute("data-id"));
      const act=e.target.getAttribute("data-act");
      if(act==="open") openTenderEditor(id);
      if(act==="handoff") { openTenderEditor(id); setTimeout(()=>{ const b=document.getElementById("btnHandoff"); if(b) b.scrollIntoView({block:"center"}); }, 50); }
    });

    async function openTenderEditor(tenderId){
      const t = tenderId ? await AsgardDB.get("tenders", tenderId) : null;
      const rights = canEditTender(user, t||{handoff_at:null});
      const isNew = !t;

      const pmOptions = pms.map(p=>{
        const sel = (t && t.responsible_pm_id===p.id) ? "selected" : "";
        return `<option value="${p.id}" ${sel}>${esc(p.name)}</option>`;
      }).join("");

      const statusOptions = refs.tender_statuses.map(s=>{
        const sel = (t && t.tender_status===s) ? "selected" : ((isNew && s==="Черновик")?"selected":"");
        return `<option value="${esc(s)}" ${sel}>${esc(s)}</option>`;
      }).join("");

      const typeOptions = TENDER_TYPES.map(tp=>{
        const sel = (t && t.tender_type===tp) ? "selected" : ((isNew && tp==="Тендер")?"selected":"");
        return `<option value="${esc(tp)}" ${sel}>${esc(tp)}</option>`;
      }).join("");

      const docList = await AsgardDB.byIndex("documents","tender_id", tenderId||-1);
      const docsHtml = docList.length ? docList.map(d=>`
        <div class="pill" style="gap:10px">
          <div class="who"><b>${esc(d.type||"Документ")}</b> — <a target="_blank" href="${esc(d.data_url)}">${esc(d.name||"ссылка")}</a></div>
          <button class="btn ghost" style="padding:6px 10px" data-del-doc="${d.id}">Удалить</button>
        </div>
      `).join("") : `<div class="help">Пока нет документов. Добавляйте ссылки на Я.Диск/площадку.</div>`;

      const lockedMsg = t && t.handoff_at ? `<div class="tag"><b>ᚦ</b> Передано в просчёт: ${esc(new Date(t.handoff_at).toLocaleString("ru-RU"))}</div>` : "";
      const canReassign = (isDirRole(user.role) || user.role==="ADMIN");

      const full = rights.full || isNew;
      const limited = rights.limited;

      const html = `
        <div class="help">
          ${lockedMsg}
          ${t && t.handoff_at ? `После передачи ТО меняет только: «Ссылка», «Тег», «Комментарий ТО», «Документы».` : `До передачи запись редактируется свободно.`}
        </div>
        <hr class="hr"/>
        <div class="formrow">
          <div>
            <label>Период (YYYY-MM)</label>
            <input id="e_period" value="${esc((t&&t.period)||ymNow())}" ${full?"":"disabled"} />
          </div>
          <div>
            <label>ИНН заказчика</label>
            <input id="e_inn" value="${esc((t&&t.customer_inn)||"")}" ${full?"":"disabled"} list="innList" placeholder="10/12 цифр" />
            <datalist id="innList"></datalist>
            <div class="help">Вводите ИНН — название подставится из справочника (Настройки → Справочник заказчиков).</div>
          </div>
          <div>
            <label>Заказчик</label>
            <input id="e_customer" value="${esc((t&&t.customer_name)||"")}" ${full?"":"disabled"} placeholder="Название организации / ИНН" list="custNameList" />
            <datalist id="custNameList"></datalist>
            <div class="help">Начните вводить название или ИНН — выбирайте из списка. Если ИНН нет в базе, создайте карточку в «Карта Контрагентов».</div>
            <div class="help" id="innWarn" style="display:none; margin-top:6px; color:#ffb4b4">ИНН не найден в базе. Создайте карточку контрагента.</div>
            <div class="row" id="innCreateRow" style="display:none; justify-content:flex-start; gap:8px; margin-top:8px">
              <a class="btn ghost" id="btnCreateCustomer" href="#/customers" style="padding:6px 10px">Создать карточку</a>
            </div>
            <!-- Светофор клиента -->
            <div id="customerScoreBlock" style="margin-top:10px;display:none"></div>
          </div>
          <div style="grid-column: 1 / -1">
            <label>Тендер / закупка</label>
            <input id="e_title" value="${esc((t&&t.tender_title)||"")}" ${full?"":"disabled"} />
          </div>
          <div>
            <label>Тип заявки</label>
            <select id="e_type" ${full?"":"disabled"}>
              ${typeOptions}
            </select>
          </div>
          <div>
            <label>Ответственный РП</label>
            <select id="e_pm" ${(user.role==="TO")?"disabled":(full?"":"disabled")}>
              <option value="">— выбрать —</option>
              ${pmOptions}
            </select>
            ${(user.role==="TO" && (!t || !t.handoff_at)) ? `<div class="help">Назначение РП выполняет директор после кнопки «На распределение».</div>` : ``}
            ${(t && t.distribution_requested_at && !t.handoff_at) ? `<div class="help"><b>На распределении.</b> Ожидает назначения директором.</div>` : ``}
            ${(t && t.handoff_at && !canReassign) ? `<div class="help">Переназначение — только директор.</div>` : ``}
            ${(t && t.handoff_at && canReassign) ? `<button class="btn ghost" style="margin-top:8px" id="btnReassign">Переназначить (директор)</button>` : ``}
          </div>
          <div>
            <label>Статус</label>
            <select id="e_status" ${(!full||isNew)?"disabled":""}>
              ${statusOptions}
            </select>
          </div>
          <div>
            <label>Сумма (если есть)</label>
            <input id="e_price" value="${esc((t&&t.tender_price)!=null?String(t.tender_price):"")}" ${full?"":"disabled"} placeholder="например: 268400"/>
          </div>
          <div>
            <label>Тег/группа</label>
            <input id="e_tag" value="${esc((t&&t.group_tag)||"")}" ${(full||limited)?"":"disabled"} placeholder="Промывка / Монтаж / Химия..."/>
          </div>
          <div>
            <label>План: начало работ</label>
            <input id="e_ws" value="${esc((t&&t.work_start_plan)||"")}" ${full?"":"disabled"} placeholder="ДД.ММ.ГГГГ"/>
          </div>
          <div>
            <label>План: окончание работ</label>
            <input id="e_we" value="${esc((t&&t.work_end_plan)||"")}" ${full?"":"disabled"} placeholder="ДД.ММ.ГГГГ"/>
          </div>
          <div style="grid-column: 1 / -1">
            <label>Ссылка на комплект документов (Я.Диск/площадка)</label>
            <input id="e_url" value="${esc((t&&t.purchase_url)||"")}" ${(full||limited)?"":"disabled"} placeholder="https://..."/>
          </div>
          <div>
            <label>Дедлайн (окончание приема заявок)</label>
            <input id="e_docs_deadline" value="${esc((t&&t.docs_deadline)||"")}" ${(full||limited)?"":"disabled"} placeholder="ДД.ММ.ГГГГ или ГГГГ-ММ-ДД"/>
            <div class="help">Формат: ДД.ММ.ГГГГ или ГГГГ-ММ-ДД. Напоминания формируются ежедневно за N дней до дедлайна.</div>
          </div>
          <div style="grid-column: 1 / -1">
            <label>Комментарий ТО</label>
            <input id="e_c_to" value="${esc((t&&t.tender_comment_to)||"")}" ${(full||limited)?"":"disabled"} placeholder="важные детали/контакты/сроки"/>
          </div>
          ${(t && t.reject_reason) ? `
          <div style="grid-column: 1 / -1">
            <label>Причина отказа</label>
            <input autocomplete="off" value="${esc(t.reject_reason)}" disabled />
          </div>` : ``}
        </div>

        <hr class="hr"/>
        <div class="help"><b>Документы</b></div>
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin:10px 0">
          <button class="btn ghost" id="btnAddDoc">📎 Загрузить файл</button>
          <button class="btn ghost" id="btnAddLink">🔗 Добавить ссылку</button>
          ${(t && (isDirRole(user.role)||user.role==="ADMIN")) ? `<button class="btn ghost" id="btnHistory">История</button>` : ``}
        </div>
        <div id="docsBox" style="display:flex; flex-direction:column; gap:10px"><div class="row" style="gap:8px; flex-wrap:wrap; margin:8px 0 10px 0">
  <button class="btn" id="copyAllDocs">Скопировать все ссылки</button>
  <button class="btn ghost" id="openAllDocs">Открыть все</button>
  <button class="btn primary" id="downloadAllDocs">📥 Скачать все документы</button>
  <button class="btn ghost" id="btnPackExport">Экспорт комплекта (JSON)</button>
  <button class="btn ghost" id="btnPackImport">Импорт в комплект</button>
</div>
<div class="row" style="gap:8px; flex-wrap:wrap; margin:0 0 10px 0">
  <button class="btn ghost" id="btnReq">Скачать запрос</button>
  <button class="btn ghost" id="btnTKP">Скачать ТКП</button>
  <button class="btn ghost" id="btnCov">Скачать сопроводительное</button>
  <button class="btn" id="btnReqAdd">Добавить запрос в комплект</button>
  <button class="btn" id="btnTKPAdd">Добавить ТКП в комплект</button>
  <button class="btn" id="btnCovAdd">Добавить сопроводительное</button>
</div>
${docsHtml}</div>

        <hr class="hr"/>
        <div style="display:flex; gap:10px; flex-wrap:wrap">
          <button class="btn" id="btnSave">${isNew?"Создать":"Сохранить"}</button>
          ${isNew ? `<button class="btn ghost" id="btnSaveDraft">💾 Черновик</button>` : ``}
          ${(t && !t.handoff_at && !t.distribution_requested_at && user.role==="TO") ? `<button class="btn red" id="btnDist">На распределение</button>` : ``}
          ${(t && !t.handoff_at && (user.role==="ADMIN"||isDirRole(user.role))) ? `<button class="btn red" id="btnHandoff">Передать в просчёт</button>` : ``}
        </div>
      `;

      showModal(isNew ? "Новый тендер" : `Тендер #${t.id}`, html);

      // Restore draft for new tenders
      if (isNew) {
        const draft = loadDraft();
        if (draft && (draft.customer_name || draft.tender_title || draft.customer_inn)) {
          const draftAge = draft.saved_at ? new Date(draft.saved_at).toLocaleString('ru-RU') : 'неизвестно';
          const useIt = confirm(`Найден черновик от ${draftAge}.\n\nЗаказчик: ${draft.customer_name || '—'}\nТендер: ${draft.tender_title || '—'}\n\nВосстановить?`);
          if (useIt) {
            setTimeout(() => restoreDraftToForm(draft), 50);
          } else {
            clearDraft();
          }
        }
      }

      // Draft save button handler
      const btnSaveDraft = document.getElementById("btnSaveDraft");
      if (btnSaveDraft) {
        btnSaveDraft.addEventListener("click", () => {
          const data = getDraftFormData();
          if (saveDraft(data)) {
            toast("Черновик", "Сохранён. Будет доступен при создании нового тендера", "ok");
          } else {
            toast("Черновик", "Ошибка сохранения", "err");
          }
        });
      }

      // === Auto-save draft on page exit (beforeunload, hashchange, modal close, tab switch) ===
      if (isNew) {
        function _autoSaveDraftIfOpen() {
          const el = document.getElementById('e_title');
          if (!el) return false;
          const data = getDraftFormData();
          if (data.customer_name || data.tender_title || data.customer_inn) saveDraft(data);
          return true;
        }
        const _onBeforeUnload = () => _autoSaveDraftIfOpen();
        const _onHashChange = () => { _autoSaveDraftIfOpen(); _cleanupDraftAuto(); };
        const _onVisChange = () => { if (document.hidden) _autoSaveDraftIfOpen(); };
        // Auto-save every 30s while modal is open
        const _draftAutoTimer = setInterval(() => {
          if (!_autoSaveDraftIfOpen()) _cleanupDraftAuto();
        }, 30000);
        // Save draft on modal close (capture phase fires before hideModal clears content)
        const _modalBack = document.querySelector('.modalback');
        const _onModalCloseCapture = (e) => {
          const closeBtn = document.getElementById('modalClose');
          if (e.target === closeBtn || e.target === _modalBack) _autoSaveDraftIfOpen();
        };
        if (_modalBack) _modalBack.addEventListener('click', _onModalCloseCapture, true);
        function _cleanupDraftAuto() {
          window.removeEventListener('beforeunload', _onBeforeUnload);
          window.removeEventListener('hashchange', _onHashChange);
          document.removeEventListener('visibilitychange', _onVisChange);
          if (_modalBack) _modalBack.removeEventListener('click', _onModalCloseCapture, true);
          clearInterval(_draftAutoTimer);
        }
        window.addEventListener('beforeunload', _onBeforeUnload);
        window.addEventListener('hashchange', _onHashChange);
        document.addEventListener('visibilitychange', _onVisChange);
      }

      // Customers directory (INN -> name)
      const normInn = (v)=>String(v||"").replace(/\D/g, "");
      const custList = await AsgardDB.all("customers");
      const dl = document.getElementById("innList");
      const dlName = document.getElementById("custNameList");
      if(dl){
        dl.innerHTML = (custList||[]).slice(0, 300).map(c=>
          `<option value="${esc(c.inn||"")}">${esc(c.name||"")}</option>`
        ).join("");
      }
      if(dlName){
        dlName.innerHTML = (custList||[]).slice(0, 300).map(c=>
          `<option value="${esc(c.name||c.full_name||"")}" data-inn="${esc(c.inn||"")}"></option>`
        ).join("");
      }
      const innInput = document.getElementById("e_inn");
      const nameInput = document.getElementById("e_customer");
      const innWarn = document.getElementById("innWarn");
      const innCreateRow = document.getElementById("innCreateRow");
      const btnCreateCustomer = document.getElementById("btnCreateCustomer");
      const byInn = new Map((custList||[]).map(c=>[String(c.inn||""), c]));
      function findByNameExact(name){
        const n = String(name||"").trim().toLowerCase();
        if(!n) return null;
        const hits = (custList||[]).filter(c=>String(c.name||c.full_name||"").trim().toLowerCase()===n);
        return hits.length===1 ? hits[0] : null;
      }
      function updateInnUi(){
        const inn = normInn(innInput?.value||"");
        if(innInput && inn!==innInput.value) innInput.value = inn;
        const looksValid = (inn.length===10 || inn.length===12);
        const exists = looksValid ? byInn.has(inn) : true;
        if(looksValid && !exists){
          if(innWarn) innWarn.style.display="block";
          if(innCreateRow) innCreateRow.style.display="flex";
          if(btnCreateCustomer) btnCreateCustomer.href = "#/customer?inn="+encodeURIComponent(inn)+"&new=1";
        }else{
          if(innWarn) innWarn.style.display="none";
          if(innCreateRow) innCreateRow.style.display="none";
        }
      }
      
      // Функция обновления светофора клиента
      async function updateCustomerScore(customerName){
        const scoreBlock = document.getElementById("customerScoreBlock");
        if(!scoreBlock) return;
        
        if(!customerName || customerName.trim().length < 2){
          scoreBlock.style.display = "none";
          return;
        }
        
        if(window.AsgardGeoScore){
          scoreBlock.style.display = "block";
          scoreBlock.innerHTML = '<span class="muted">⏳ Анализ...</span>';
          
          try {
            const scoreData = await AsgardGeoScore.getCustomerScore(customerName.trim());
            scoreBlock.innerHTML = AsgardGeoScore.getScoreCard(scoreData, customerName.trim());
          } catch(e){
            scoreBlock.innerHTML = '<span class="muted">Не удалось загрузить данные</span>';
          }
        }
      }
      
      // Начальное отображение светофора если есть заказчик
      if(t && t.customer_name){
        updateCustomerScore(t.customer_name);
      }
      
      if(innInput && nameInput){
        innInput.addEventListener("input", ()=>{
          const inn = normInn(innInput.value);
          const c = (custList||[]).find(x=>String(x.inn||"")===inn);
          if(c && (!nameInput.value || nameInput.value.trim().length<2)){
            nameInput.value = c.name||c.full_name||"";
            updateCustomerScore(c.name||c.full_name||"");
          }
          updateInnUi();
        });
        nameInput.addEventListener("change", ()=>{
          // If user selected an existing name, set INN
          const hit = findByNameExact(nameInput.value);
          if(hit && innInput && !innInput.value){ innInput.value = String(hit.inn||""); }
          updateInnUi();
          // Обновляем светофор
          updateCustomerScore(nameInput.value);
        });
        // Также обновляем при вводе (с debounce)
        let scoreTimeout;
        nameInput.addEventListener("input", ()=>{
          clearTimeout(scoreTimeout);
          scoreTimeout = setTimeout(()=>{
            updateCustomerScore(nameInput.value);
          }, 500);
        });
        updateInnUi();
      }

      $$("[data-del-doc]").forEach(b=>{
        b.addEventListener("click", async ()=>{
          const did=Number(b.getAttribute("data-del-doc"));
          await AsgardDB.del("documents", did);
          toast("Документ","Удалено");
          openTenderEditor(tenderId);
        });
      });

      $("#btnAddDoc").addEventListener("click", async ()=>{
        const html2=`
          <div class="formrow">
            <div><label>Тип документа</label><input id="d_type" placeholder="ТЗ / Письмо / Комплект"/></div>
            <div style="grid-column:1/-1">
              <label>Файл</label>
              <input type="file" id="d_file" class="inp" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.zip,.rar"/>
              <div class="help">PDF, DOC, DOCX, XLS, XLSX, JPG, PNG, ZIP</div>
            </div>
          </div>
          <div style="margin-top:12px; display:flex; gap:10px">
            <button class="btn" id="d_save">Загрузить</button>
          </div>
        `;
        showModal("Загрузить документ", html2);
        $("#d_save").addEventListener("click", async ()=>{
          const fileInput = document.getElementById("d_file");
          const file = fileInput.files[0];
          if(!file){ toast("Документ","Выберите файл","err"); return; }
          if(!tenderId){ toast("Документ","Сначала сохраните тендер","err"); return; }
          
          try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('tender_id', tenderId);
            formData.append('type', document.getElementById("d_type").value.trim() || "Документ");
            
            const auth = await AsgardAuth.getAuth();
            const response = await fetch('/api/files/upload', {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + auth.token },
              body: formData
            });
            
            if (!response.ok) throw new Error('Ошибка загрузки');
            toast("Документ","Файл загружен");
            closeModal();
            openTenderEditor(tenderId);
          } catch (e) {
            toast("Ошибка", e.message, "err");
          }
        });
      });

      // Добавление ссылки
      $("#btnAddLink")?.addEventListener("click", async ()=>{
        const html2=`
          <div class="formrow">
            <div><label>Тип</label><input id="d_type" placeholder="ТЗ / Письмо / Комплект"/></div>
            <div><label>Название</label><input id="d_name" placeholder="например: Комплект документов"/></div>
            <div style="grid-column:1/-1"><label>Ссылка (Я.Диск/площадка)</label><input id="d_url" placeholder="https://..."/></div>
          </div>
          <div style="margin-top:12px; display:flex; gap:10px">
            <button class="btn" id="d_save">Сохранить</button>
          </div>
        `;
        showModal("Добавить ссылку", html2);
        $("#d_save").addEventListener("click", async ()=>{
          const url=document.getElementById("d_url").value.trim();
          if(!url){ toast("Документ","Укажите ссылку","err"); return; }
          if(!tenderId){ toast("Документ","Сначала сохраните тендер","err"); return; }
          await AsgardDB.add("documents",{
            tender_id:tenderId, work_id:null, type:document.getElementById("d_type").value.trim()||"Документ",
            name:document.getElementById("d_name").value.trim()||url,
            data_url:url, uploaded_by_user_id:user.id, created_at:isoNow()
          });
          await audit(user.id,"tender",tenderId,"doc_add",{url});
          toast("Документ","Добавлено");
          openTenderEditor(tenderId);
        });
      });

      // --- docs pack actions ---
      const latestEstimate = async ()=>{
        if(!tenderId) return null;
        const list = await AsgardDB.byIndex("estimates","tender_id", tenderId);
        const arr = (list||[]).sort((a,b)=>(Number(b.version_no||0)-Number(a.version_no||0)) || Number(b.id||0)-Number(a.id||0));
        return arr[0]||null;
      };
      const docs = tenderId ? await AsgardDB.byIndex("documents","tender_id", tenderId) : [];
      const linksAll = (docs||[]).map(d=>`${d.type||"Документ"}: ${d.data_url||""}`).join("\n");
      const bCopy = document.getElementById("copyAllDocs");
      if(bCopy) bCopy.addEventListener("click", ()=>AsgardUI.copyToClipboard(linksAll||""));
      const bOpenAll = document.getElementById("openAllDocs");
      if(bOpenAll) bOpenAll.addEventListener("click", ()=>{
        (docs||[]).forEach(d=>{ if(d.data_url) window.open(d.data_url, "_blank"); });
      });

      // Download All Documents handler
      const bDownloadAll = document.getElementById("downloadAllDocs");
      if(bDownloadAll) bDownloadAll.addEventListener("click", async ()=>{
        if(!docs || docs.length === 0) {
          toast("Документы", "Нет документов для скачивания", "err");
          return;
        }

        toast("Скачивание", `Начинаю загрузку ${docs.length} документов...`, "ok");

        // Download each document with a small delay to avoid browser blocking
        let downloadCount = 0;
        for(const d of docs) {
          if(d.data_url) {
            try {
              const a = document.createElement('a');
              a.href = d.data_url;
              a.download = d.name || d.type || 'document';
              a.target = '_blank';

              // For data URLs, use direct download
              if(d.data_url.startsWith('data:')) {
                a.click();
                downloadCount++;
              } else {
                // For external URLs, open in new tab (browser security restriction)
                window.open(d.data_url, '_blank');
                downloadCount++;
              }

              // Small delay between downloads
              await new Promise(r => setTimeout(r, 300));
            } catch(e) {
              console.warn('[Tender] Download failed for:', d.name, e);
            }
          }
        }

        toast("Скачивание", `Открыто ${downloadCount} документов`, "ok");
      });

      const bPackExp = document.getElementById("btnPackExport");
      if(bPackExp) bPackExp.addEventListener("click", async ()=>{
        if(!tenderId){ toast("Комплект","Сначала сохраните тендер","err"); return; }
        await AsgardDocsPack.downloadPackJson({tender_id:tenderId});
      });
      const bPackImp = document.getElementById("btnPackImport");
      if(bPackImp) bPackImp.addEventListener("click", async ()=>{
        if(!tenderId){ toast("Комплект","Сначала сохраните тендер","err"); return; }
        const inp = document.createElement("input");
        inp.type = "file"; inp.accept = "application/json";
        inp.onchange = async ()=>{
          const f = inp.files && inp.files[0];
          if(!f) return;
          try{ await AsgardDocsPack.importPackJson(f,{tender_id:tenderId, user_id:user.id}); openTenderEditor(tenderId); }
          catch(e){ toast("Импорт", e.message||"Ошибка", "err"); }
        };
        inp.click();
      });

      const bReq = document.getElementById("btnReq");
      if(bReq) bReq.addEventListener("click", async ()=>{ await AsgardTemplates.downloadRequest(t, await latestEstimate()); });
      const bTKP = document.getElementById("btnTKP");
      if(bTKP) bTKP.addEventListener("click", async ()=>{ await AsgardTemplates.downloadTKP(t, await latestEstimate()); });
      const bCov = document.getElementById("btnCov");
      if(bCov) bCov.addEventListener("click", async ()=>{ await AsgardTemplates.downloadCover(t, await latestEstimate()); });

      const addGen = async (kind)=>{
        if(!tenderId){ toast("Документы","Сначала сохраните тендер","err"); return; }
        const est = await latestEstimate();
        let html="", type="Документ", name="";
        if(kind==="req"){ html = await AsgardTemplates.buildClientRequest({tender:t, estimate:est}); type="Запрос"; name=`Запрос_${tenderId}.html`; }
        if(kind==="tkp"){ html = await AsgardTemplates.buildTKP({tender:t, estimate:est}); type="ТКП"; name=`ТКП_${tenderId}_v${est?.version_no||1}.html`; }
        if(kind==="cov"){ html = await AsgardTemplates.buildCoverLetter({tender:t, estimate:est}); type="Сопроводительное"; name=`Сопроводительное_${tenderId}.html`; }
        await AsgardDocsPack.addGeneratedHtml({tender_id:tenderId, work_id:null, type, name, html, user_id:user.id});
        toast("Комплект","Добавлено");
        openTenderEditor(tenderId);
      };
      const bReqAdd = document.getElementById("btnReqAdd");
      if(bReqAdd) bReqAdd.addEventListener("click", ()=>addGen("req"));
      const bTKPAdd = document.getElementById("btnTKPAdd");
      if(bTKPAdd) bTKPAdd.addEventListener("click", ()=>addGen("tkp"));
      const bCovAdd = document.getElementById("btnCovAdd");
      if(bCovAdd) bCovAdd.addEventListener("click", ()=>addGen("cov"));

      if(document.getElementById("btnHistory")){
        document.getElementById("btnHistory").addEventListener("click", async ()=>{
          const logs = (await AsgardDB.all("audit_log"))
            .filter(l=>l.entity_type==="tender" && l.entity_id===tenderId)
            .sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
          const rows = logs.map(l=>`<div class="pill"><div class="who"><b>${esc(l.action)}</b> — ${esc(new Date(l.created_at).toLocaleString("ru-RU"))}</div><div class="role">${esc((byId.get(l.actor_user_id)||{}).login||"")}</div></div>
            <div class="help" style="margin:6px 0 10px">${esc(l.payload_json||"")}</div>`).join("");
          showModal("История (audit log)", rows || `<div class="help">Пока пусто.</div>`);
        });
      }

      if(document.getElementById("btnReassign")){
        document.getElementById("btnReassign").addEventListener("click", async ()=>{
          const html3=`
            <div class="help">Переназначение фиксируется в журнале. Требуется причина.</div>
            <hr class="hr"/>
            <div class="formrow">
              <div><label>Новый РП</label>
                <select id="r_pm"><option value="">— выбрать —</option>${pmOptions}</select>
              </div>
              <div><label>Причина</label><input id="r_reason" placeholder="почему меняем ответственного"/></div>
            </div>
            <div style="margin-top:12px"><button class="btn" id="r_do">Переназначить</button></div>
          `;
          showModal("Переназначить РП", html3);
          document.getElementById("r_do").addEventListener("click", async ()=>{
            const newPm = Number(document.getElementById("r_pm").value||0);
            const reason = document.getElementById("r_reason").value.trim();
            if(!newPm){ toast("Переназначение","Выберите РП","err"); return; }
            if(!reason){ toast("Переназначение","Укажите причину","err"); return; }
            const cur = await AsgardDB.get("tenders", tenderId);
            const oldPm = cur.responsible_pm_id;
            cur.responsible_pm_id = newPm;
            await AsgardDB.put("tenders", cur);
            await audit(user.id,"tender",tenderId,"reassign_pm",{old_pm:oldPm,new_pm:newPm,reason});
            toast("Переназначение","Готово");
            render({layout, title});
            openTenderEditor(tenderId);
          });
        });
      }

      async function saveTender(forceDraft){
        const period=document.getElementById("e_period").value.trim();
        const innRaw = document.getElementById("e_inn")?.value || "";
        const customer_inn = String(innRaw).replace(/\D/g, "");
        let customer=document.getElementById("e_customer").value.trim();
        const title=document.getElementById("e_title").value.trim();
        const tenderType = (document.getElementById("e_type")?.value || "Тендер").trim();
        const pmId = Number(document.getElementById("e_pm").value||0) || null;
        const status=document.getElementById("e_status").value;
        const priceRaw=document.getElementById("e_price").value.trim();
        const price = priceRaw ? Number(priceRaw.replace(/\s/g,"").replace(",", ".")) : null;
        const ws=document.getElementById("e_ws").value.trim()||null;
        const we=document.getElementById("e_we").value.trim()||null;
        const url=document.getElementById("e_url").value.trim()||null;
        let docsDeadline=document.getElementById("e_docs_deadline").value.trim()||null;
        const tag=document.getElementById("e_tag").value.trim()||null;
        const cto=document.getElementById("e_c_to").value.trim()||"";
        const rejectEl=document.getElementById("e_reject"); const reject=rejectEl ? rejectEl.value||null : null;

        // Draft mode: skip strict validation, save with 'Черновик' status
        if (forceDraft && isNew) {
          const obj={
            period: period || ymNow(), year:Number((period || ymNow()).slice(0,4)),
            customer_inn: customer_inn||null, customer_name:customer||'',
            tender_title:title||'', tender_type: tenderType||'Тендер',
            responsible_pm_id:pmId, tender_status:'Черновик',
            tender_price: price, work_start_plan: ws, work_end_plan: we,
            purchase_url: url, docs_deadline: docsDeadline,
            reject_reason: reject, group_tag: tag, tender_comment_to: cto,
            created_by_user_id: user.id,
            handoff_at: null, handoff_by_user_id: null,
            distribution_requested_at: null, distribution_requested_by_user_id: null,
            distribution_assigned_at: null, distribution_assigned_by_user_id: null,
            dedup_key: url || (`local:${period||ymNow()}:${customer_inn||customer||'draft'}:${title||'draft'}`.toLowerCase())
          };
          const id = await AsgardDB.add("tenders", obj);
          await audit(user.id,"tender",id,"create",{draft:true});
          clearDraft();
          toast("Черновик","Тендер сохранён как черновик");
          return id;
        }

        if(!period || !/^\d{4}-\d{2}$/.test(period)){ toast("Проверка","Период должен быть YYYY-MM","err"); return null; }
        if(!customer && customer_inn){
          const c = (custList||[]).find(x=>String(x.inn||"")===customer_inn);
          if(c) customer = String(c.name||"").trim();
        }
        if(!customer){ toast("Проверка","Укажите заказчика (или введите ИНН и выберите из списка)","err"); return null; }
        if(!title){ toast("Проверка","Укажите название тендера","err"); return null; }
        if(!TENDER_TYPES.includes(tenderType)){ toast("Проверка","Тип заявки задан некорректно","err"); return null; }

        // Deadline rules
        if(!docsDeadline && tenderType==="Прямой запрос"){
          docsDeadline = addDaysISO(new Date(), (appS?.sla?.direct_request_deadline_days ?? 5));
          const inp = document.getElementById("e_docs_deadline");
          if(inp) inp.value = docsDeadline;
        }
        if(!docsDeadline && tenderType!=="Прямой запрос"){
          toast("Проверка","Укажите дедлайн (окончание приема заявок)","err");
          return null;
        }

        if(!pmId && status!=="Новый"){ toast("Проверка","Назначьте ответственного РП","err"); return null; }
        if(status==="Клиент отказался" && !reject){ toast("Проверка","Для отказа нужна причина","err"); return null; }
        // Accept both DD.MM.YYYY and YYYY-MM-DD formats, convert to ISO
        if(docsDeadline){
          // Try to parse and normalize to YYYY-MM-DD
          const isoDate = V.dateISO ? V.dateISO(docsDeadline) : null;
          if(isoDate){
            docsDeadline = isoDate;
            const inp = document.getElementById("e_docs_deadline");
            if(inp) inp.value = isoDate;
          } else if(!/^\d{4}-\d{2}-\d{2}$/.test(docsDeadline)){
            toast("Проверка","Дата должна быть в формате ДД.ММ.ГГГГ или ГГГГ-ММ-ДД","err");
            return null;
          }
        }

        if(isNew){
          const obj={
            period, year:Number(period.slice(0,4)), customer_inn: customer_inn||null, customer_name:customer, tender_title:title,
            tender_type: tenderType,
            responsible_pm_id:pmId,
            tender_status:"Новый",
            tender_price: price,
            work_start_plan: ws, work_end_plan: we,
            purchase_url: url,
            docs_deadline: docsDeadline,
            reject_reason: reject,
            group_tag: tag,
            tender_comment_to: cto,
            created_by_user_id: user.id,
            handoff_at: null, handoff_by_user_id: null,
            distribution_requested_at: null, distribution_requested_by_user_id: null,
            distribution_assigned_at: null, distribution_assigned_by_user_id: null,
            dedup_key: url || (`local:${period}:${customer_inn||customer}:${title}`.toLowerCase())
          };
          // Customer directory validation (no auto-create)
          if(customer_inn && (customer_inn.length===10 || customer_inn.length===12)){
            const exists = await AsgardDB.get("customers", customer_inn);
            if(!exists){ toast("Контрагент","ИНН не найден в базе. Создайте карточку контрагента.","err",7000); return null; }
          }else{
            const nm = String(customer||"").trim().toLowerCase();
            if(nm){
              const hits = (custList||[]).filter(c=>String(c.name||c.full_name||"").trim().toLowerCase()===nm);
              if(hits.length===1){
                obj.customer_inn = String(hits[0].inn||"");
              }else{
                toast("Контрагент","Укажите ИНН или выберите организацию из справочника.","err",7000); return null;
              }
            }else{
              toast("Контрагент","Укажите ИНН или выберите организацию из справочника.","err",7000); return null;
            }
          }
          const id = await AsgardDB.add("tenders", obj);
          await audit(user.id,"tender",id,"create",{period,customer,title,pmId});
          clearDraft(); // Clear draft after successful save
          toast("Тендер","Создан");
          return id;
        }else{
          const cur = await AsgardDB.get("tenders", tenderId);
          const rights2 = canEditTender(user, cur);
          if(rights2.full){
            cur.period=period; cur.year=Number(period.slice(0,4));
            cur.customer_inn = customer_inn || null;
            cur.customer_name=customer; cur.tender_title=title;
            cur.responsible_pm_id=pmId;
            cur.tender_status=status;
            cur.tender_price=price;
            cur.work_start_plan=ws; cur.work_end_plan=we;
            cur.reject_reason=reject;
            cur.purchase_url=url; cur.docs_deadline=docsDeadline; cur.group_tag=tag; cur.tender_comment_to=cto;
          }else if(rights2.limited){
            cur.purchase_url=url;
            cur.docs_deadline=docsDeadline;
            cur.group_tag=tag;
            cur.tender_comment_to=cto;
          }else{
            toast("Права","Недостаточно прав для редактирования","err");
            return null;
          }
          await AsgardDB.put("tenders", cur);
          
          // TKP Follow-up: активируем если "Прямой запрос" + "ТКП отправлено"
          if(status === "ТКП отправлено" && window.AsgardTkpFollowup){
            try { await AsgardTkpFollowup.activateFollowup(cur); } catch(e){ console.warn('TKP Followup error:', e); }
          }
          
          // Customer directory validation (no auto-create)
          if(rights2.full && customer_inn && (customer_inn.length===10 || customer_inn.length===12)){
            const exists = await AsgardDB.get("customers", customer_inn);
            if(!exists){ toast("Контрагент","ИНН не найден в базе. Создайте карточку контрагента.","err",7000); return null; }
          }
          await audit(user.id,"tender",tenderId,"update",{mode:rights2.limited?"limited":"full"});
          toast("Тендер","Сохранено");
          return tenderId;
        }
      }

      document.getElementById("btnSave").addEventListener("click", async ()=>{
        if (isNew) {
          // Check required fields — offer draft save if missing
          const chkCustomer = document.getElementById("e_customer")?.value?.trim() || '';
          const chkTitle = document.getElementById("e_title")?.value?.trim() || '';
          const chkPeriod = document.getElementById("e_period")?.value?.trim() || '';
          const chkDeadline = document.getElementById("e_docs_deadline")?.value?.trim() || '';
          const missingFields = [];
          if (!chkCustomer) missingFields.push('Заказчик');
          if (!chkTitle) missingFields.push('Название тендера');
          if (!chkPeriod || !/^\d{4}-\d{2}$/.test(chkPeriod)) missingFields.push('Период');
          if (!chkDeadline) missingFields.push('Дедлайн');

          if (missingFields.length > 0) {
            const _fieldIdMap = {'Заказчик':'e_customer','Название тендера':'e_title','Период':'e_period','Дедлайн':'e_docs_deadline'};
            const _overlay = document.createElement('div');
            _overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:center;justify-content:center';
            _overlay.innerHTML = `
              <div style="background:var(--card,#1e1e2e);padding:24px;border-radius:12px;max-width:420px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.3)">
                <div style="font-weight:600;font-size:16px;margin-bottom:12px">Не заполнены обязательные поля</div>
                <div style="margin-bottom:16px;color:var(--text-secondary,#aaa)">${esc(missingFields.join(', '))}</div>
                <div style="display:flex;gap:10px;flex-wrap:wrap">
                  <button class="btn" id="btnFillMissing">Заполнить поля</button>
                  <button class="btn ghost" id="btnDraftMissing">Сохранить как черновик</button>
                </div>
              </div>`;
            document.body.appendChild(_overlay);
            _overlay.addEventListener('click', (e) => { if (e.target === _overlay) _overlay.remove(); });
            document.getElementById('btnFillMissing').addEventListener('click', () => {
              _overlay.remove();
              const ids = missingFields.map(f => _fieldIdMap[f]).filter(Boolean);
              ids.forEach(fid => {
                const el = document.getElementById(fid);
                if (el) {
                  el.style.border = '2px solid #ef4444';
                  el.addEventListener('input', () => { el.style.border = ''; }, { once: true });
                }
              });
              if (ids.length) { const first = document.getElementById(ids[0]); if (first) first.focus(); }
            });
            document.getElementById('btnDraftMissing').addEventListener('click', async () => {
              _overlay.remove();
              const id = await saveTender(true);
              if(id){ await render({layout, title}); openTenderEditor(id); }
            });
            return;
          }

          // Проверка дубликатов для новых тендеров (Этап 34)
          const customerInn = document.getElementById("e_inn")?.value?.trim() || '';
          const customerName = chkCustomer;
          const tenderTitle = chkTitle;

          if (customerName && tenderTitle) {
            const duplicates = await findDuplicates(customerInn, customerName, tenderTitle);

            if (duplicates.length > 0) {
              showDuplicateWarning(
                duplicates,
                async () => {
                  const id = await saveTender();
                  if(id){ await render({layout, title}); openTenderEditor(id); }
                },
                () => {
                  toast("Отменено", "Создание тендера отменено");
                }
              );
              return;
            }
          }
        }

        // Обычное сохранение (без дубликатов или редактирование)
        const id = await saveTender();
        if(id){ await render({layout, title}); openTenderEditor(id); }
      });

      if(document.getElementById("btnDist")){
        document.getElementById("btnDist").addEventListener("click", async ()=>{
          const id = isNew ? await saveTender() : tenderId;
          if(!id) return;
          const cur = await AsgardDB.get("tenders", id);
          if(!cur){ toast("Распределение","Тендер не найден","err"); return; }
          if(cur.handoff_at){ toast("Распределение","Уже передано в просчёт","err"); return; }
          if(cur.distribution_requested_at){ toast("Распределение","Уже отправлено директору","err"); return; }
          cur.distribution_requested_at = isoNow();
          cur.distribution_requested_by_user_id = user.id;
          await AsgardDB.put("tenders", cur);
          await audit(user.id, "tender", id, "request_distribution", {});

          // notify all directors and admins
          try{
            const allU = await getUsers();
            const dirs = (allU||[]).filter(u=> {
              // Check singular role field
              if (u.role && (isDirRole(u.role) || u.role === 'ADMIN')) return true;
              // Check roles array if exists
              if (Array.isArray(u.roles) && u.roles.some(r => isDirRole(r) || r === 'ADMIN')) return true;
              return false;
            });
            for(const d of dirs){
              await notify(d.id, "На распределение", `${cur.customer_name} — ${cur.tender_title}\nДедлайн: ${cur.docs_deadline||"—"}\nТип: ${cur.tender_type||"—"}`, "#/tenders");
            }
          }catch(e){ console.error('Distribution notify error:', e); }

          toast("Распределение","Отправлено директору");
          await render({layout, title});
          openTenderEditor(id);
        });
      }

      if(document.getElementById("btnHandoff")){
        document.getElementById("btnHandoff").addEventListener("click", async ()=>{
            const appS = await getAppSettings();
            // require docs/link before handoff if enabled
            if(appS.require_docs_on_handoff){
              const hasFolder = String(document.getElementById("e_url")?.value||"").trim();
              // If folder/link is provided, treat it as the "комплект документов" for MVP
              if(!hasFolder){
                const docs = await AsgardDB.byIndex("documents","tender_id", tenderId);
                // required types (only when using local uploads)
                const reqTypes = (appS.doc_types||[]).filter(x=>x.required_on_handoff && (x.scope==="tender"||x.scope==="both")).map(x=>x.label);
                const presentTypes = new Set((docs||[]).map(d=>String(d.type||"").trim()));
                const missing = reqTypes.filter(x=>!presentTypes.has(x));

                if(!docs || docs.length===0){
                  toast("Передача","Добавьте ссылку на папку (комплект) или загрузите документы","err"); 
                  return;
                }
                if(missing.length){
                  toast("Передача",`Нужен документ: ${missing.join(", ")}`,"err"); 
                  return;
                }
              }
            }

          const id = isNew ? await saveTender() : tenderId;
          if(!id) return;
          const cur = await AsgardDB.get("tenders", id);
          if(!cur.responsible_pm_id){
            toast("Передача","Сначала выберите ответственного РП","err");
            return;
          }
          if(cur.handoff_at){ toast("Передача","Уже передано","err"); return; }

          // limit active PM inbox to avoid overload
          try{
            const lim = Number(appS?.limits?.pm_active_calcs_limit ?? 0);
            if(Number.isFinite(lim) && lim>0){
              const allT = await AsgardDB.all("tenders");
              const doneRaw = String(appS?.limits?.pm_active_calcs_done_statuses||"");
              const done = new Set(doneRaw.split(",").map(x=>String(x).trim()).filter(Boolean));
              if(done.size===0){ ["Согласование ТКП","ТКП согласовано","Клиент отказался","Клиент согласился"].forEach(x=>done.add(x)); }
              const active = (allT||[]).filter(t=>
                t && t.handoff_at && Number(t.responsible_pm_id)===Number(cur.responsible_pm_id) && Number(t.id)!==Number(cur.id) &&
                !done.has(String(t.tender_status||""))
              );
              if(active.length >= lim){
                toast("Лимит РП", `У выбранного РП активных просчётов: ${active.length}. Лимит: ${lim}.`, "err");
                return;
              }
            }
          }catch(e){}

          cur.tender_status="Отправлено на просчёт";
          cur.handoff_at=isoNow();
          cur.handoff_by_user_id=user.id;
          await AsgardDB.put("tenders", cur);
          await audit(user.id,"tender",id,"handoff",{to_pm:cur.responsible_pm_id});
          await AsgardDB.add("notifications",{user_id:cur.responsible_pm_id, is_read:false, created_at:isoNow(), title:"Новый тендер на просчёт", message:`${cur.customer_name} — ${cur.tender_title}`, link_hash:"#/pm-calcs"});
          toast("Передача","Тендер передан в просчёт");
          await render({layout, title});
          openTenderEditor(id);
        });
      }
    }
  }

  return { render };
})();