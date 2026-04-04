window.AsgardTendersPage = (function(){
  const { $, $$, esc, toast, showModal, hideModal, money } = AsgardUI;
  const V = AsgardValidate;
  const isDirRole = (r)=> (window.AsgardAuth&&AsgardAuth.isDirectorRole)?AsgardAuth.isDirectorRole(r):(r==="DIRECTOR"||String(r||"").startsWith("DIRECTOR_"));

  function isoNow(){ return new Date().toISOString(); }
  function ymNow(){
    const d=new Date();
    const y=d.getFullYear();
    const m=String(d.getMonth()+1).padStart(2,"0");
    return `${y}-${m}`;
  }
  const formatDateTime = AsgardUI.formatDateTime || (value => value ? new Date(value).toLocaleString('ru-RU') : '\u2014');

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

  function isInlineDownloadLink(url){
    return /^(\/api\/|\/uploads\/|data:)/i.test(url || '');
  }

  function openDocumentLink(doc){
    const url = buildDocumentLink(doc);
    if(!url) return false;
    const a = document.createElement('a');
    a.href = url;
    if(isInlineDownloadLink(url)) {
      a.download = doc?.name || doc?.original_name || doc?.filename || 'document';
    } else {
      a.target = '_blank';
      a.rel = 'noopener';
    }
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  }

  function renderDocumentAnchor(doc){
    const url = buildDocumentLink(doc);
    const label = esc(doc?.name || doc?.original_name || doc?.filename || '\u0424\u0430\u0439\u043b');
    if(!url) return '<span class="help">\u0424\u0430\u0439\u043b \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d</span>';
    const attrs = isInlineDownloadLink(url)
      ? `href="${esc(url)}" download="${label}"`
      : `href="${esc(url)}" target="_blank" rel="noopener"`;
    return `<a ${attrs}>${label}</a>`;
  }

  function getFileExtension(doc){
    const name = doc.original_name || doc.name || doc.filename || '';
    const m = name.match(/\.(\w+)$/);
    return m ? m[1].toLowerCase() : '';
  }

  function isPreviewableExt(ext){
    return /^(pdf|jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(ext);
  }

  async function previewDocument(doc){
    const url = buildDocumentLink(doc);
    if(!url){ toast("Просмотр","Файл недоступен","err"); return; }
    const ext = getFileExtension(doc);
    const name = doc.name || doc.original_name || doc.filename || 'Документ';
    if(!isPreviewableExt(ext)){
      openDocumentLink(doc);
      return;
    }
    try {
      const auth = await AsgardAuth.getAuth();
      const resp = await fetch(url, { headers:{ 'Authorization':'Bearer '+auth.token } });
      if(!resp.ok) throw new Error('Не удалось загрузить');
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      if(/^pdf$/i.test(ext)){
        showModal({ title:esc(name), html:`<iframe src="${blobUrl}" class="cr-file-preview-frame"></iframe>`, fullscreen:true });
      } else {
        showModal(esc(name), `<div class="cr-file-preview-img-wrap"><img src="${blobUrl}" class="cr-file-preview-img" alt="${esc(name)}"/></div>`);
      }
    } catch(e){
      toast("Просмотр", e.message||"Ошибка","err");
    }
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
    const _pm = (typeof CRSelect !== 'undefined' && CRSelect.getValue('e_period_month')) || '';
    const _py = (typeof CRSelect !== 'undefined' && CRSelect.getValue('e_period_year')) || '';
    return {
      period: (_py && _pm) ? `${_py}-${_pm}` : '',
      customer_inn: CRAutocomplete.getValue("e_inn") || '',
      customer_name: CRAutocomplete.getValue("e_customer") || '',
      tender_title: document.getElementById("e_title")?.value || '',
      tender_type: CRSelect.getValue('e_type') || '',
      tender_price: document.getElementById("e_price")?.value || '',
      tag_id: (typeof CRSelect !== 'undefined' && CRSelect.getValue('e_tag')) || '',
      work_start_plan: (typeof CRDatePicker !== 'undefined' && CRDatePicker.getValue('e_ws')) || '',
      work_end_plan: (typeof CRDatePicker !== 'undefined' && CRDatePicker.getValue('e_we')) || '',
      purchase_url: document.getElementById("e_url")?.value || '',
      docs_deadline: (typeof CRDatePicker !== 'undefined' && CRDatePicker.getValue('e_docs_deadline')) || '',
      tender_comment_to: '' // deprecated — comments are now in tender_comments table
    };
  }

  function restoreDraftToForm(draft) {
    if (!draft) return;
    const fields = {
      'e_title': draft.tender_title,
      'e_price': draft.tender_price,
      'e_url': draft.purchase_url,
      // e_c_to removed — comments now in feed
    };
    for (const [id, value] of Object.entries(fields)) {
      const el = document.getElementById(id);
      if (el && value) el.value = value;
    }
    if (draft.period) {
      const [y, m] = draft.period.split('-');
      if (y) CRSelect.setValue('e_period_year', y);
      if (m) CRSelect.setValue('e_period_month', m);
    }
    if (draft.work_start_plan && typeof CRDatePicker !== 'undefined') CRDatePicker.setValue('e_ws', draft.work_start_plan);
    if (draft.work_end_plan && typeof CRDatePicker !== 'undefined') CRDatePicker.setValue('e_we', draft.work_end_plan);
    if (draft.docs_deadline && typeof CRDatePicker !== 'undefined') CRDatePicker.setValue('e_docs_deadline', draft.docs_deadline);
    if (draft.customer_inn) CRAutocomplete.setValue('e_inn', draft.customer_inn);
    if (draft.customer_name) CRAutocomplete.setValue('e_customer', draft.customer_name);
    if (draft.tender_type) CRSelect.setValue('e_type', draft.tender_type);
    if (draft.tag_id) CRSelect.setValue('e_tag', draft.tag_id);
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
      <div class="modal-overlay show" id="duplicateModal" style="z-index:10001">
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
      obj.limits.pm_active_calcs_done_statuses = 'Согласование ТКП, ТКП согласовано, Выиграли, Проиграли';

    return obj;
  }

// State machine тендеров — допустимые переходы (зеркало бэкенда)
  const TENDER_TRANSITIONS = {
    'Черновик':              ['Новый'],
    'Новый':                 ['Отправлено на просчёт', 'Проиграли'],
    'Отправлено на просчёт': ['Согласование ТКП', 'Проиграли'],
    'Согласование ТКП':      ['ТКП согласовано', 'Отправлено на просчёт', 'Проиграли'],
    'ТКП согласовано':       ['КП отправлено', 'Согласование ТКП', 'Проиграли'],
    'КП отправлено':         ['Выиграли', 'Проиграли'],
    'Выиграли':              [],
    'Проиграли':             ['Новый']
  };

  const TENDER_STATUS_COLORS = {
    'Черновик': '#6c757d', 'Новый': '#5b8def', 'Отправлено на просчёт': '#f39c12',
    'Согласование ТКП': '#e67e22', 'ТКП согласовано': '#27ae60', 'КП отправлено': '#17a2b8',
    'Выиграли': '#2ecc71', 'Проиграли': '#e74c3c'
  };

  function tenderStatusBadge(status) {
    const bg = TENDER_STATUS_COLORS[status] || '#6c757d';
    return `<span class="cr-status-badge" style="background:${bg}">${esc(status || '')}</span>`;
  }

  async function getRefs(){
    const refs = await AsgardDB.get("settings","refs");
    const defaultStatuses = ['Черновик','Новый','Отправлено на просчёт','Согласование ТКП','ТКП согласовано','КП отправлено','Выиграли','Проиграли'];
    if(refs && refs.tender_statuses && refs.tender_statuses.length) return refs;
    return { tender_statuses: defaultStatuses, reject_reasons: (refs && refs.reject_reasons) || [] };
  }

  async function getUsers(){
    const users = await AsgardDB.all("users");
    return users.filter(u=>u.is_active && u.name && u.name.trim());
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

  const _monthNamesShort = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  function fmtPeriod(p){
    if(!p) return '—';
    const m = String(p).match(/^(\d{4})-(\d{2})$/);
    if(!m) return esc(p);
    const mi = Number(m[2])-1;
    return `${_monthNamesShort[mi]||m[2]} ${m[1]}`;
  }

  function tenderRow(t, pmName, createdByName){
    const fmtDate = AsgardUI.formatDate || (d => d ? new Date(d).toLocaleDateString('ru-RU') : '—');
    const ds = fmtDate(t.work_start_plan);
    const de = fmtDate(t.work_end_plan);
    const link = t.purchase_url ? `<a class="btn ghost" style="padding:6px 10px" target="_blank" href="${esc(t.purchase_url)}">Ссылка</a>` : "—";
    const ddl = fmtDate(t.docs_deadline);
    return `<tr data-id="${t.id}">
      <td><input type="checkbox" class="tender-check" value="${t.id}" onchange="window._asgTenderBulkCount&&window._asgTenderBulkCount()"/></td>
      <td>${fmtPeriod(t.period)}</td>
      <td>
        <b>${esc(t.customer_name||"")}</b>
        <div class="help">${esc(t.customer_inn||"")}</div>
        <div class="help">${esc(t.tender_title||"")}</div>
      </td>
      <td>${esc(pmName||"—")}</td>
      <td>${esc(t.tender_type||"—")}</td>
      <td>${tenderStatusBadge(t.tender_status)}${(t.distribution_requested_at && !t.handoff_at)?" <span class=\"badge\">На распределении</span>":""}</td>
      <td>${ddl}</td>
      <td>${esc(createdByName||"—")}</td>
      <td>${t.tender_price?money(t.tender_price):"—"}</td>
      <td>${ds} → ${de}</td>
      <td>${link}</td>
      <td><button class="btn" style="padding:6px 10px" data-act="open">Открыть</button></td>
    </tr>`;
  }

  // ═══ MOBILE_CARD_RENDER ═══
  const _isMobile = () => document.body.classList.contains('is-mobile') || window.innerWidth <= 768;

  function tenderCard(t, pmName, createdByName) {
    const fmtDate = AsgardUI.formatDate || (d => d ? new Date(d).toLocaleDateString('ru-RU') : '—');
    const ddl = fmtDate(t.docs_deadline);
    const price = t.tender_price ? money(t.tender_price) : '—';

    // Status badge color
    let statusCls = '';
    const st = t.tender_status || '';
    if (st === 'Выиграли') statusCls = 'ok';
    else if (st === 'Проиграли') statusCls = 'err';
    else if (st === 'Черновик') statusCls = 'draft';
    else statusCls = 'info';

    return '<div class="m-tender-card" data-id="' + t.id + '">' +
      '<div class="m-tc-header">' +
        '<div class="m-tc-customer">' + esc(t.customer_name || '—') + '</div>' +
        '<span class="m-tc-badge m-tc-' + statusCls + '">' + esc(st || '—') + '</span>' +
      '</div>' +
      '<div class="m-tc-title">' + esc(t.tender_title || '') + '</div>' +
      '<div class="m-tc-meta">' +
        '<div class="m-tc-field"><span class="m-tc-label">РП</span><span>' + esc(pmName || '—') + '</span></div>' +
        '<div class="m-tc-field"><span class="m-tc-label">Тип</span><span>' + esc(t.tender_type || '—') + '</span></div>' +
        '<div class="m-tc-field"><span class="m-tc-label">Дедлайн</span><span>' + ddl + '</span></div>' +
        '<div class="m-tc-field"><span class="m-tc-label">Сумма</span><span class="m-tc-price">' + price + '</span></div>' +
      '</div>' +
      '<div class="m-tc-footer">' +
        '<span class="m-tc-period">' + fmtPeriod(t.period) + '</span>' +
        '<button class="btn mini" data-act="open">Открыть</button>' +
      '</div>' +
    '</div>';
  }

  function tableCSS(){
    return `${window.__ASG_SHARED_TABLE_CSS__||""}
    <style>
      .tag{display:inline-flex; gap:6px; align-items:center; padding:6px 10px; border-radius:999px;
        border:none; background:var(--bg-card); font-size:12px; color:var(--text-secondary); font-family:var(--font-sans)}
      .tag b{color:var(--gold)}

      /* ═══ Mobile Tender Cards ═══ */
      @media(max-width:768px) {
        .m-tender-cards { display:flex; flex-direction:column; gap:12px; }
        .m-tender-card {
          background:var(--bg2); border-radius:14px; padding:16px;
          border:1px solid var(--brd); transition:all .2s ease;
          box-shadow:0 2px 8px rgba(0,0,0,.15);
        }
        .m-tender-card:active { transform:scale(0.98); background:var(--bg3); }
        .m-tc-header { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:8px; }
        .m-tc-customer { font-weight:700; font-size:15px; color:var(--t1); flex:1; line-height:1.3; }
        .m-tc-badge {
          font-size:11px; font-weight:700; padding:4px 10px; border-radius:99px; white-space:nowrap;
          text-transform:uppercase; letter-spacing:0.03em;
        }
        .m-tc-ok { background:rgba(34,197,94,.15); color:var(--ok-t); }
        .m-tc-err { background:rgba(239,68,68,.15); color:var(--err-t); }
        .m-tc-draft { background:rgba(156,163,175,.15); color:var(--t3); }
        .m-tc-info { background:rgba(59,130,246,.15); color:var(--info-t); }
        .m-tc-title { font-size:13px; color:var(--t2); margin-bottom:12px; line-height:1.4; }
        .m-tc-meta {
          display:grid; grid-template-columns:1fr 1fr; gap:8px 16px;
          padding:12px 0; border-top:1px solid var(--brd); border-bottom:1px solid var(--brd);
        }
        .m-tc-field { display:flex; flex-direction:column; gap:2px; }
        .m-tc-label { font-size:10px; color:var(--t3); text-transform:uppercase; letter-spacing:0.05em; font-weight:700; }
        .m-tc-field span:last-child { font-size:13px; color:var(--t1); font-weight:500; }
        .m-tc-price { color:var(--gold) !important; font-weight:700 !important; }
        .m-tc-footer { display:flex; justify-content:space-between; align-items:center; margin-top:12px; }
        .m-tc-period { font-size:12px; color:var(--t3); }
        .m-tc-footer .btn { min-height:36px; border-radius:8px; font-size:13px; padding:6px 16px; }
      }
    </style>`;
  }

  async function render({layout, title}){
    let currentPage = 1, pageSize = window.AsgardPagination ? AsgardPagination.getPageSize() : 20;
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
        <div class="tools m-tender-tools">
          <div class="field">
            <label>Период</label>
            <div id="f_period_w"></div>
          </div>
          <div class="field">
            <label>Поиск</label>
            <input id="f_q" placeholder="заказчик / тендер / ссылка / тег" />
          </div>
          <div class="field">
            <label>Тип</label>
            <div id="f_type_w"></div>
          </div>
          <div class="field">
            <label>Статус</label>
            <div id="f_status_w"></div>
          </div>
          <div class="field">
            <label>Ответственный РП</label>
            <div id="f_pm_w"></div>
          </div>
          <div style="display:flex; gap:10px; flex-wrap:wrap">
            <button class="btn" id="btnNew">+ Внести тендер</button>
            <button class="btn ghost" id="btnReset">Сброс</button>
            ${user.role === "ADMIN" ? '<button class="btn ghost" id="btnBulkReassign">Массовое переназначение</button>' : ''}
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
          <button class="btn ghost" id="btnBulkSelected" style="display:none">Переназначить выбранные</button>
        </div>
      </div>
    `;

    await layout(body, {title: title||"Сага Тендеров"});

    /* --- CRSelect: filter bar --- */
    const _periodOpts = (() => {
      const o = [{ value: '', label: 'Все тендеры' }, { value: 'year:' + new Date().getFullYear(), label: 'За ' + new Date().getFullYear() + ' год' }, { value: 'year:' + (new Date().getFullYear()-1), label: 'За ' + (new Date().getFullYear()-1) + ' год' }];
      const now = new Date();
      for(let i = 0; i < 12; i++) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); const ym = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'); o.push({ value: ym, label: d.toLocaleDateString('ru-RU', {month:'long', year:'numeric'}) }); }
      return o;
    })();
    $('#f_period_w')?.appendChild(CRSelect.create({ id: 'f_period', options: _periodOpts, value: 'year:' + new Date().getFullYear(), onChange: () => applyAndRender() }));
    $('#f_type_w')?.appendChild(CRSelect.create({ id: 'f_type', options: [{ value: '', label: 'Все' }, ...TENDER_TYPES.map(tp => ({ value: tp, label: tp }))], onChange: () => applyAndRender() }));
    $('#f_status_w')?.appendChild(CRSelect.create({ id: 'f_status', options: [{ value: '', label: 'Все' }, ...refs.tender_statuses.map(s => ({ value: s, label: s }))], onChange: () => applyAndRender() }));
    $('#f_pm_w')?.appendChild(CRSelect.create({ id: 'f_pm', options: [{ value: '', label: 'Все' }, ...pms.map(p => ({ value: String(p.id), label: p.name }))], searchable: true, onChange: () => applyAndRender() }));

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
        ["Согласование ТКП","ТКП согласовано","Выиграли","Проиграли"].forEach(x=>done.add(x));
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
              <div id="dist_pm_${t.id}_w" style="display:inline-block;min-width:220px;vertical-align:middle"></div>
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

      /* Mount CRSelect for each distribution row */
      pending.forEach(t => {
        const w = distPanel.querySelector(`#dist_pm_${t.id}_w`);
        if (!w) return;
        const distOpts = pms.map(p => {
          const a = activeByPm.get(p.id)||0;
          const dis = (lim>0 && a>=lim);
          return { value: String(p.id), label: `${p.name} (${a}/${lim||'∞'})`, disabled: dis };
        });
        w.appendChild(CRSelect.create({ id: 'dist_pm_' + t.id, options: distOpts, placeholder: 'Выберите РП', searchable: true }));
      });

      distPanel.querySelectorAll("button[data-assign]").forEach(btn=>{
        btn.addEventListener("click", async ()=>{
          const tid = Number(btn.getAttribute("data-assign"));
          const pmId = Number(CRSelect.getValue('dist_pm_' + tid) || 0);
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
            ["Согласование ТКП","ТКП согласовано","Выиграли","Проиграли"].forEach(x=>done2.add(x));
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

    // ===== Stage 7: Назначение РП на работу после статуса «Выиграли» =====
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

      const _winOptsMap = new Map();
      const rows = await Promise.all(reqs.map(async r=>{
        const t = await AsgardDB.get("tenders", r.tender_id);
        if(!t) return "";
        const ds = t.work_start_plan||"—";
        const de = t.work_end_plan||"—";
        const srcPm = (byId.get(r.source_pm_id)||{}).name || "—";

        const opts = [];
        const crOpts = [];
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
          crOpts.push({ value: String(p.id), label: p.name + warn + ovr, disabled: !!(maxOv>7 && !okOverride) });
        }
        _winOptsMap.set(r.id, crOpts);

        return `
          <tr>
            <td>${esc(t.customer_name||"")}</td>
            <td>${esc(t.tender_title||"")}</td>
            <td>${esc(ds)} → ${esc(de)}</td>
            <td>${r.price_tkp!=null?money(r.price_tkp):"—"} / ${r.cost_plan!=null?money(r.cost_plan):"—"}</td>
            <td>${esc(srcPm)}</td>
            <td style="white-space:nowrap">
              <div id="win_pm_${r.id}_w" style="display:inline-block;min-width:240px;vertical-align:middle"></div>
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
          <div class="help">Запрос создаётся после статуса «Выиграли» у РП в просчёте. Пересечение плановых сроков: ≤7 дней — предупреждение, >7 дней — блок (override только после согласия РП).</div>
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

      /* Mount CRSelect for each win-assign row */
      _winOptsMap.forEach((crOpts, reqId) => {
        const w = winPanel.querySelector(`#win_pm_${reqId}_w`);
        if (w) w.appendChild(CRSelect.create({ id: 'win_pm_' + reqId, options: crOpts, placeholder: 'Выберите РП', searchable: true }));
      });

      winPanel.querySelectorAll("button[data-win-assign]").forEach(btn=>{
        btn.addEventListener("click", async ()=>{
          const reqId = Number(btn.getAttribute("data-win-assign"));
          const req = await AsgardDB.get("work_assign_requests", reqId);
          if(!req || req.status!=="pending"){ toast("Назначение","Уже обработано","warn"); await render({layout,title}); return; }
          const tender = await AsgardDB.get("tenders", req.tender_id);
          if(!tender){ toast("Назначение","Тендер не найден","err"); return; }
          const pmId = Number(CRSelect.getValue('win_pm_' + reqId) || 0);
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
          const pmId = Number(CRSelect.getValue('win_pm_' + reqId) || 0);
          if(!pmId){ toast("Согласие","Выберите РП в списке","err"); return; }
          await requestOverride({reqId, pmId, tender});
        });
      });
    })();

    function applyAndRender(){

      const periodVal = CRSelect.getValue('f_period')||"";
      const q = norm($("#f_q")?.value||"");
      const tp = CRSelect.getValue('f_type')||"";
      const st = CRSelect.getValue('f_status')||"";
      const pm = CRSelect.getValue('f_pm')||"";

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

      const pagedTenders = window.AsgardPagination ? AsgardPagination.paginate(list, currentPage, pageSize) : list;
      if (_isMobile()) {
        // Mobile: render as cards instead of table rows
        const _tableEl = tb.closest('table');
        if (_tableEl) {
          _tableEl.style.display = 'none';
          let _cc = document.getElementById('m-tender-cards');
          if (!_cc) {
            _cc = document.createElement('div');
            _cc.id = 'm-tender-cards';
            _cc.className = 'm-tender-cards';
            _tableEl.parentNode.insertBefore(_cc, _tableEl);
          }
          _cc.innerHTML = pagedTenders.map(t => tenderCard(t, (byId.get(t.responsible_pm_id)||{}).name, (byId.get(t.created_by_user_id)||{}).name)).join('');
          _cc.querySelectorAll('.m-tender-card').forEach(card => {
            card.addEventListener('click', (e) => {
              if (e.target.tagName === 'BUTTON') return;
              const tId = card.dataset.id;
              openTender(tId);
            });
            const openBtn = card.querySelector('[data-act="open"]');
            if (openBtn) openBtn.addEventListener('click', () => openTender(card.dataset.id));
          });
        }
      } else {
        // Desktop: table rows
        const _tableEl = tb.closest('table');
        if (_tableEl) _tableEl.style.display = '';
        const _cc = document.getElementById('m-tender-cards');
        if (_cc) _cc.remove();
        tb.innerHTML = pagedTenders.map(t=>tenderRow(t, (byId.get(t.responsible_pm_id)||{}).name, (byId.get(t.created_by_user_id)||{}).name)).join("");
      }
      // Пагинация
      if (window.AsgardPagination) {
        let pgEl = document.getElementById("tenders_pagination");
        if (!pgEl) { pgEl = document.createElement("div"); pgEl.id = "tenders_pagination"; tb.closest("table").after(pgEl); }
        pgEl.innerHTML = AsgardPagination.renderControls(list.length, currentPage, pageSize);
        AsgardPagination.attachHandlers("tenders_pagination",
          (p) => { currentPage = p; applyAndRender(); },
          (s) => { pageSize = s; currentPage = 1; applyAndRender(); }
        );
      }
      cnt.textContent = `Показано: ${list.length} из ${tenders.length}.`;
    }

    applyAndRender();

    // Мобильные карточки
    if (window.AsgardUI?.makeResponsiveTable) {
      AsgardUI.makeResponsiveTable('.asg');
    }

    // CRSelect onChange уже вызывает applyAndRender()
    $("#f_q").addEventListener("input", applyAndRender);

    $("#btnReset").addEventListener("click", ()=>{
      CRSelect.setValue('f_period', 'year:' + new Date().getFullYear());
      $("#f_q").value="";
      CRSelect.setValue('f_type', '');
      CRSelect.setValue('f_status', '');
      CRSelect.setValue('f_pm', '');
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
    // Auto-open tender from URL params (?open=ID or ?id=ID)    const _urlHash = (location.hash || "").split("?")[1] || "";    const _urlParams = new URLSearchParams(_urlHash);    const _openId = _urlParams.get("open") || _urlParams.get("id");    if (_openId) { openTenderEditor(Number(_openId)); }

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
            <div><label>Новый ответственный РП</label><div id="bulk_sel_pm_w"></div></div>
            <div><label>Причина</label><input id="bulk_sel_reason" value="Переназначение"/></div>
          </div>
          <hr class="hr"/>
          <button class="btn" id="bulk_sel_do">Переназначить</button>
        `;
        showModal("Переназначение выбранных тендеров", html);
        $('#bulk_sel_pm_w')?.appendChild(CRSelect.create({ id: 'bulk_sel_pm', placeholder: '— выбрать —', options: pms.map(p => ({ value: String(p.id), label: p.name })), searchable: true, dropdownClass: 'z-modal' }));
        $("#bulk_sel_do").addEventListener("click", async ()=>{
          const newPmId = Number(CRSelect.getValue('bulk_sel_pm')||0);
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
              <div id="bulk_status_w"></div>
            </div>
            <div>
              <label>Новый ответственный РП</label>
              <div id="bulk_pm_w"></div>
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
            <button class="btn primary" id="bulk_do">Переназначить</button>
            <div id="bulk_result" style="padding:10px; color:var(--muted)"></div>
          </div>
        `;
        
        showModal("Массовое переназначение тендеров", html);
        $('#bulk_status_w')?.appendChild(CRSelect.create({ id: 'bulk_status', options: [{ value: '__ALL__', label: '— Все статусы —' }, ...Object.keys(byStatus).map(s => ({ value: s, label: s + ' (' + byStatus[s].length + ')' }))], value: '__ALL__', dropdownClass: 'z-modal' }));
        $('#bulk_pm_w')?.appendChild(CRSelect.create({ id: 'bulk_pm', placeholder: '— выбрать —', options: pms.filter(p => p.login !== 'archive').map(p => ({ value: String(p.id), label: p.name })), searchable: true, dropdownClass: 'z-modal' }));

        $("#bulk_do").addEventListener("click", async ()=>{
          const newPmId = Number(CRSelect.getValue('bulk_pm') || 0);
          const statusFilter = CRSelect.getValue('bulk_status') || '__ALL__';
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

      // Load tender tags from API
      let tenderTags = [];
      try {
        const auth = await AsgardAuth.getAuth();
        const tagResp = await fetch('/api/tenders/tags', { headers: { 'Authorization': 'Bearer ' + auth.token } });
        if (tagResp.ok) {
          const tagData = await tagResp.json();
          tenderTags = tagData.tags || [];
        }
      } catch(e) { /* fallback: empty list */ }

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

      const docList = (await AsgardDB.byIndex("documents","tender_id", tenderId||-1)) || [];
      const docsHtml = docList.length ? docList.map(d=>{
        const ext = getFileExtension(d);
        const canPreview = isPreviewableExt(ext);
        return `<div class="cr-doc-item">
          <div class="cr-doc-info"><b>${esc(d.type||"Документ")}</b> — ${renderDocumentAnchor(d)}</div>
          <div class="cr-doc-actions">
            ${canPreview ? `<button class="btn ghost mini" data-preview-doc="${d.id}" title="Предпросмотр">👁</button>` : ''}
            <button class="btn ghost mini" data-del-doc="${d.id}">Удалить</button>
          </div>
        </div>`;
      }).join("") : AsgardUI.emptyState({ icon:'📄', title:'Нет прикреплённых документов', desc:'Загрузите файл или добавьте ссылку' });

      const lockedMsg = t && t.handoff_at ? `<div class="tag"><b>🔒</b> Передано в ТО: ${esc(formatDateTime(t.handoff_at))}</div>` : "";
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
            <label>Период</label>
            <div class="cr-period-row" id="e_period_w"></div>
          </div>
          <div>
            <label>ИНН заказчика</label>
            <div id="cr-inn-wrap"></div>
            <div class="help">Вводите ИНН — название подставится из справочника (Настройки → Справочник заказчиков).</div>
          </div>
          <div>
            <label>Заказчик</label>
            <div id="cr-customer-wrap"></div>
            <div class="help">Начните вводить название или ИНН — выбирайте из списка. Если ИНН нет в базе, создайте карточку в «Карта Контрагентов».</div>
            <div class="help" id="innWarn" style="display:none; margin-top:6px; color:var(--err-t)">ИНН не найден в базе. Создайте карточку контрагента.</div>
            <div class="row" id="innCreateRow" style="display:none; justify-content:flex-start; gap:8px; margin-top:8px">
              <a class="btn ghost" id="btnCreateCustomer" href="#/customers" style="padding:6px 10px">Создать карточку</a>
            </div>
            <!-- Светофор клиента -->
            <div id="customerScoreBlock" style="margin-top:10px;display:none"></div>
          </div>
          <div style="grid-column: 1 / -1">
            <label>Наименование работ</label>
            <input id="e_title" value="${esc((t&&t.tender_title)||"")}" ${full?"":"disabled"} />
          </div>
          <div>
            <label>Тип заявки</label>
            <div id="e_type_w"></div>
          </div>
          <div>
            <label>Ответственный РП</label>
            <div id="e_pm_w"></div>
            ${(user.role==="TO" && (!t || !t.handoff_at)) ? `<div class="help">Назначение РП выполняет директор после кнопки «На распределение».</div>` : ``}
            ${(t && t.distribution_requested_at && !t.handoff_at) ? `<div class="help"><b>На распределении.</b> Ожидает назначения директором.</div>` : ``}
            ${(t && t.handoff_at && !canReassign) ? `<div class="help">Переназначение — только директор.</div>` : ``}
            ${(t && t.handoff_at && canReassign) ? `<button class="btn ghost" style="margin-top:8px" id="btnReassign">Переназначить (директор)</button>` : ``}
          </div>
          <div>
            <label>Статус</label>
            <div id="e_status_w"></div>
          </div>
          <div>
            <label>Сумма (если есть)</label>
            <input id="e_price" value="${esc((t&&t.tender_price)!=null?String(t.tender_price):"")}" ${full?"":"disabled"} placeholder="например: 268400"/>
          </div>
          <div>
            <label>Тег/группа</label>
            <div id="e_tag_w"></div>
          </div>
          <div>
            <label>План: начало работ</label>
            <div id="e_ws_w"></div>
          </div>
          <div>
            <label>План: окончание работ</label>
            <div id="e_we_w"></div>
          </div>
          <div style="grid-column: 1 / -1">
            <label>Ссылка на комплект документов (Я.Диск/площадка)</label>
            <input id="e_url" value="${esc((t&&t.purchase_url)||"")}" ${(full||limited)?"":"disabled"} placeholder="https://..."/>
          </div>
          <div id="e_deadline_row">
            <label>Дедлайн (окончание приема заявок)</label>
            <div id="e_deadline_w"></div>
          </div>
          <div class="cr-field-full">
            <label>Комментарии</label>
            <div id="tc_feed" class="tc-feed"><div class="tc-empty">Загрузка...</div></div>
            ${(full||limited) ? `<div class="tc-input-row">
              <textarea id="tc_input" rows="1" placeholder="Комментарий..."></textarea>
              <button class="btn mini" id="tc_send">Отправить</button>
            </div>` : ''}
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
  <button class="btn primary" id="downloadAllDocs">📥 Скачать все</button>
  <button class="btn" id="copyAllDocs">📋 Копировать ссылки</button>
</div>
${docsHtml}</div>



        <hr class="hr"/>
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center">
          <button class="btn" id="btnSave">${isNew?"Создать":"Сохранить"}</button>
          ${!isNew ? '<button class="btn ghost" id="btnTenderActions">⚡ Действия</button>' : ''}
          ${isNew ? `<button class="btn ghost" id="btnSaveDraft">💾 Черновик</button>` : ``}
          ${(t && !t.handoff_at && !t.distribution_requested_at && user.role==="TO") ? `<button class="btn red" id="btnDist">На распределение</button>` : ``}
          ${(t && !t.handoff_at && (user.role==="ADMIN"||isDirRole(user.role))) ? `<button class="btn red" id="btnHandoff">Передать в просчёт</button>` : ``}
          ${(t && t.tender_status==='ТКП согласовано') ? `<button class="btn" id="btnSentToClient" style="background:#17a2b8;color:#fff">📨 КП отправлено клиенту</button>` : ``}
        </div>
      `;

      showModal(isNew ? "Новый тендер" : `Тендер #${t.id}`, html);

      /* Mount CRSelect for editor fields */
      const _eTypeDis = !full;
      const _ePmDis = (user.role==="TO") || !full;
      const _eStatusDis = !full || isNew;
      $('#e_type_w')?.appendChild(CRSelect.create({ id: 'e_type', options: TENDER_TYPES.map(tp => ({ value: tp, label: tp })), value: (t&&t.tender_type)||(isNew?'Тендер':''), disabled: _eTypeDis, dropdownClass: 'z-modal', onChange: (v) => applyTypeRules(v) }));
      $('#e_pm_w')?.appendChild(CRSelect.create({ id: 'e_pm', placeholder: '— выбрать —', options: pms.map(p => ({ value: String(p.id), label: p.name })), value: String((t&&t.responsible_pm_id)||''), disabled: _ePmDis, searchable: true, dropdownClass: 'z-modal' }));
      const _curStatus = (t&&t.tender_status)||(isNew?'Черновик':'');
      const _isAdmin = user.role === 'ADMIN';
      const _statusOpts = _isAdmin ? refs.tender_statuses : (TENDER_TRANSITIONS[_curStatus] || []).concat([_curStatus]);
      $('#e_status_w')?.appendChild(CRSelect.create({ id: 'e_status', options: [...new Set(_statusOpts)].map(s => ({ value: s, label: s })), value: _curStatus, disabled: _eStatusDis, dropdownClass: 'z-modal' }));

      /* Mount CRSelect for tag */
      const _tagOpts = tenderTags.map(tg => ({ value: String(tg.id), label: tg.name }));
      const _curTagId = (t && t.tag_id) ? String(t.tag_id) : '';
      $('#e_tag_w')?.appendChild(CRSelect.create({ id: 'e_tag', placeholder: '— выбрать —', options: _tagOpts, value: _curTagId, disabled: !(full||limited), searchable: true, dropdownClass: 'z-modal' }));

      /* Mount Period: month + year CRSelect */
      const _curPeriod = (t&&t.period) || ymNow();
      const _pYear = Number(_curPeriod.slice(0,4));
      const _pMonth = _curPeriod.slice(5,7);
      const _monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
      const _monthOpts = _monthNames.map((n,i) => ({ value: String(i+1).padStart(2,'0'), label: n }));
      const _yearOpts = [];
      for(let y = 2024; y <= new Date().getFullYear()+2; y++) _yearOpts.push({ value: String(y), label: String(y) });
      const periodW = document.getElementById('e_period_w');
      if(periodW){
        periodW.appendChild(CRSelect.create({ id:'e_period_month', options:_monthOpts, value:_pMonth, disabled:!full, dropdownClass:'z-modal' }));
        periodW.appendChild(CRSelect.create({ id:'e_period_year', options:_yearOpts, value:String(_pYear), disabled:!full, dropdownClass:'z-modal' }));
      }

      /* Mount CRDatePicker for date fields */
      $('#e_ws_w')?.appendChild(CRDatePicker.create({ id:'e_ws', value:(t&&t.work_start_plan)||'', placeholder:'Выберите дату', disabled:!full, dropdownClass:'z-modal' }));
      $('#e_we_w')?.appendChild(CRDatePicker.create({ id:'e_we', value:(t&&t.work_end_plan)||'', placeholder:'Выберите дату', disabled:!full, dropdownClass:'z-modal' }));
      $('#e_deadline_w')?.appendChild(CRDatePicker.create({ id:'e_docs_deadline', value:(t&&t.docs_deadline)||'', placeholder:'Выберите дату', disabled:!(full||limited), clearable:true, dropdownClass:'z-modal' }));

      /* ── 3.2: Dynamic required fields by procedure type ── */
      function applyTypeRules(tType) {
        const deadlineRow = document.getElementById('e_deadline_row');
        const urlLabel = document.querySelector('label[for="e_url"]') || document.getElementById('e_url')?.closest('div')?.querySelector('label');
        const deadlineLabel = deadlineRow?.querySelector('label');
        // Reset required markers
        if(urlLabel) urlLabel.classList.remove('cr-required');
        if(deadlineLabel) deadlineLabel.classList.remove('cr-required');

        if (tType === 'Доп. объём') {
          // No deadline
          if(deadlineRow) deadlineRow.classList.add('cr-field-hidden');
          CRDatePicker.setValue('e_docs_deadline', '');
        } else if (tType === 'Прямой запрос') {
          // Show deadline, auto-fill +5 days, disable
          if(deadlineRow) deadlineRow.classList.remove('cr-field-hidden');
          if (!CRDatePicker.getValue('e_docs_deadline')) {
            CRDatePicker.setValue('e_docs_deadline', addDaysISO(new Date(), 5));
          }
          CRDatePicker.setDisabled('e_docs_deadline', true);
        } else {
          // Тендер, Запрос предложений, Оценка рынка — deadline required, manual
          if(deadlineRow) deadlineRow.classList.remove('cr-field-hidden');
          if(deadlineLabel) deadlineLabel.classList.add('cr-required');
          CRDatePicker.setDisabled('e_docs_deadline', !(full||limited));
        }
      }
      applyTypeRules((t&&t.tender_type) || (isNew ? 'Тендер' : ''));

      /* ── 4.1: Comment feed ── */
      if (t && t.id) {
        const tcFeed = document.getElementById('tc_feed');
        const tcInput = document.getElementById('tc_input');
        const tcSend = document.getElementById('tc_send');

        function renderCommentFeed(comments) {
          if (!tcFeed) return;
          if (!comments.length) {
            tcFeed.innerHTML = '<div class="tc-empty">Комментариев нет</div>';
            return;
          }
          tcFeed.innerHTML = comments.map(c => {
            const initials = (c.user_name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
            const dt = c.created_at ? new Date(c.created_at).toLocaleString('ru-RU') : '';
            const canDel = c.user_id === auth.user.id || auth.user.role === 'ADMIN';
            return `<div class="tc-comment" data-cid="${c.id}">
              <div class="tc-avatar">${esc(initials)}</div>
              <div class="tc-body">
                <div class="tc-header">
                  <span class="tc-author">${esc(c.user_name || 'Пользователь')}</span>
                  <span class="tc-time">${esc(dt)}</span>
                  ${canDel ? `<span class="tc-delete" data-del="${c.id}">удалить</span>` : ''}
                </div>
                <div class="tc-text">${esc(c.text)}</div>
              </div>
            </div>`;
          }).join('');
          tcFeed.scrollTop = tcFeed.scrollHeight;
        }

        async function loadComments() {
          try {
            const resp = await fetch('/api/tenders/' + t.id + '/comments', {
              headers: { 'Authorization': 'Bearer ' + auth.token }
            });
            if (resp.ok) {
              const data = await resp.json();
              renderCommentFeed(data.comments || []);
            }
          } catch (_) {
            if (tcFeed) tcFeed.innerHTML = '<div class="tc-empty">Ошибка загрузки</div>';
          }
        }

        loadComments();

        if (tcSend && tcInput) {
          tcSend.addEventListener('click', async () => {
            const text = tcInput.value.trim();
            if (!text) return;
            tcSend.disabled = true;
            try {
              const resp = await fetch('/api/tenders/' + t.id + '/comments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + auth.token },
                body: JSON.stringify({ text })
              });
              if (resp.ok) {
                tcInput.value = '';
                await loadComments();
              } else {
                toast('Ошибка', 'Не удалось отправить', 'err');
              }
            } catch (_) {
              toast('Ошибка', 'Сеть недоступна', 'err');
            } finally {
              tcSend.disabled = false;
            }
          });
          tcInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); tcSend.click(); }
          });
        }

        if (tcFeed) {
          tcFeed.addEventListener('click', async (e) => {
            const del = e.target.closest('[data-del]');
            if (!del) return;
            if (!confirm('Удалить комментарий?')) return;
            try {
              await fetch('/api/tenders/' + t.id + '/comments/' + del.dataset.del, {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer ' + auth.token }
              });
              await loadComments();
            } catch (_) {}
          });
        }
      } else if (document.getElementById('tc_feed')) {
        document.getElementById('tc_feed').innerHTML = '<div class="tc-empty">Сохраните тендер, чтобы оставлять комментарии</div>';
      }

      // Restore draft for new tenders
      if (isNew) {
        const draft = loadDraft();
        if (draft && (draft.customer_name || draft.tender_title || draft.customer_inn)) {
          const draftAge = draft.saved_at ? formatDateTime(draft.saved_at) : 'неизвестно';
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

      // Customers directory (INN -> name) via CRAutocomplete
      const normInn = (v)=>String(v||"").replace(/\D/g, "");
      const custList = await AsgardDB.all("customers");
      const innWrap = document.getElementById("cr-inn-wrap");
      const custWrap = document.getElementById("cr-customer-wrap");
      if(innWrap){
        innWrap.appendChild(CRAutocomplete.create({ id: 'e_inn', value: (t&&t.customer_inn)||"", placeholder: '10/12 цифр', minChars: 1, fullWidth: true, inputClass: 'inp', disabled: !full, fetchOptions: async (q) => { const nq = q.replace(/\D/g, ""); if(!nq) return []; return (custList||[]).filter(c => String(c.inn||"").includes(nq)).slice(0,20).map(c => ({ value: c.inn||"", label: c.inn||"", sublabel: c.name||c.full_name||"", name: c.name||c.full_name||"" })); }, onSelect: (item) => { if(!item) return; const nameInp = CRAutocomplete.getInput('e_customer'); if(nameInp && (!nameInp.value || nameInp.value.trim().length<2)){ CRAutocomplete.setValue('e_customer', item.name||""); updateCustomerScore(item.name||""); } updateInnUi(); } }));
      }
      if(custWrap){
        custWrap.appendChild(CRAutocomplete.create({ id: 'e_customer', value: (t&&t.customer_name)||"", placeholder: 'Название организации / ИНН', minChars: 2, fullWidth: true, inputClass: 'inp', disabled: !full, fetchOptions: async (q) => { const ql = q.toLowerCase().trim(); return (custList||[]).filter(c => { const n = String(c.name||c.full_name||"").toLowerCase(); const inn = String(c.inn||""); return n.includes(ql) || inn.includes(ql); }).slice(0,20).map(c => ({ value: c.name||c.full_name||"", label: c.name||c.full_name||"", sublabel: 'ИНН ' + (c.inn||"—"), inn: c.inn||"" })); }, onSelect: (item) => { if(!item) return; const innInp = CRAutocomplete.getInput('e_inn'); if(innInp && !innInp.value) CRAutocomplete.setValue('e_inn', item.inn||""); updateInnUi(); updateCustomerScore(item.label||""); } }));
      }
      const innInput = CRAutocomplete.getInput("e_inn");
      const nameInput = CRAutocomplete.getInput("e_customer");
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

      $$("[data-preview-doc]").forEach(b=>{
        b.addEventListener("click", async ()=>{
          const did=Number(b.getAttribute("data-preview-doc"));
          const doc = docList.find(d=>d.id===did);
          if(doc) previewDocument(doc);
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

          let uploadId = tenderId;
          if(!uploadId){
            uploadId = await saveTender(true);
            if(!uploadId) return;
          }

          try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('tender_id', uploadId);
            formData.append('type', document.getElementById("d_type").value.trim() || "Документ");

            const auth = await AsgardAuth.getAuth();
            const response = await fetch('/api/files/upload', {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + auth.token },
              body: formData
            });

            if (!response.ok) throw new Error('Ошибка загрузки');
            toast("Документ","Файл загружен");
            hideModal();
            openTenderEditor(uploadId);
          } catch (e) {
            toast("Ошибка", e.message, "err");
          }
        });
      });

      // Drag-n-drop загрузка файлов на зону документов
      const docsBox = document.getElementById('docsBox');
      if (docsBox) {
        docsBox.addEventListener('dragover', (e) => {
          e.preventDefault();
          docsBox.classList.add('cr-drop-active');
        });
        docsBox.addEventListener('dragleave', (e) => {
          e.preventDefault();
          docsBox.classList.remove('cr-drop-active');
        });
        docsBox.addEventListener('drop', async (e) => {
          e.preventDefault();
          docsBox.classList.remove('cr-drop-active');
          const files = e.dataTransfer.files;
          if (!files.length) return;

          let uploadId = tenderId;
          if (!uploadId) {
            uploadId = await saveTender(true);
            if (!uploadId) return;
          }

          const auth = await AsgardAuth.getAuth();
          for (const file of files) {
            try {
              const formData = new FormData();
              formData.append('file', file);
              formData.append('tender_id', uploadId);
              formData.append('type', 'Документ');
              const response = await fetch('/api/files/upload', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + auth.token },
                body: formData
              });
              if (!response.ok) throw new Error('Ошибка загрузки');
              toast("Документ", `${file.name} загружен`);
            } catch (err) {
              toast("Ошибка", `${file.name}: ${err.message}`, "err");
            }
          }
          openTenderEditor(uploadId);
        });
      }

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

          let uploadId = tenderId;
          if(!uploadId){
            uploadId = await saveTender(true);
            if(!uploadId) return;
          }

          await AsgardDB.add("documents",{
            tender_id:uploadId, work_id:null, type:document.getElementById("d_type").value.trim()||"Документ",
            name:document.getElementById("d_name").value.trim()||url,
            file_url:url, download_url:url, uploaded_by_user_id:user.id, created_at:isoNow()
          });
          await audit(user.id,"tender",uploadId,"doc_add",{url});
          toast("Документ","Добавлено");
          openTenderEditor(uploadId);
        });
      });

      // --- docs pack actions ---
      const latestEstimate = async ()=>{
        if(!tenderId) return null;
        const list = await AsgardDB.byIndex("estimates","tender_id", tenderId);
        const arr = (list||[]).sort((a,b)=>(Number(b.version_no||0)-Number(a.version_no||0)) || Number(b.id||0)-Number(a.id||0));
        return arr[0]||null;
      };
      const docs = tenderId ? ((await AsgardDB.byIndex("documents","tender_id", tenderId)) || []) : [];
      const linksAll = (docs||[]).map(d=>{ const url = buildDocumentLink(d); return url ? `${d.type||"Документ"}: ${url}` : ""; }).filter(Boolean).join("\n");
      const bCopy = document.getElementById("copyAllDocs");
      if(bCopy) bCopy.addEventListener("click", ()=>AsgardUI.copyToClipboard(linksAll||""));
      const bOpenAll = document.getElementById("openAllDocs");
      if(bOpenAll) bOpenAll.addEventListener("click", ()=>{
        (docs||[]).forEach(d=>{ openDocumentLink(d); });
      });

      // Download All Documents handler
      const bDownloadAll = document.getElementById("downloadAllDocs");
      if(bDownloadAll) bDownloadAll.addEventListener("click", async ()=>{
        const validDocs = (docs || []).filter(d => buildDocumentLink(d));
        if(validDocs.length === 0) {
          toast("Документы", "Нет документов для скачивания", "err");
          return;
        }

        toast("Документы", `Начинаю скачивание ${validDocs.length} документов...`, "ok");

        let downloadCount = 0;
        for(const d of validDocs) {
          try {
            if(openDocumentLink(d)) downloadCount++;
            await new Promise(r => setTimeout(r, 300));
          } catch(e) {
            console.warn('[Tender] Download failed for:', d?.name, e);
          }
        }

        toast("Документы", `Скачано ${downloadCount} документов`, "ok");
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
          const rows = logs.map(l=>`<div class="pill"><div class="who"><b>${esc(l.action)}</b> — ${esc(formatDateTime(l.created_at))}</div><div class="role">${esc((byId.get(l.actor_user_id)||{}).login||"")}</div></div>
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
                <div id="r_pm_w"></div>
              </div>
              <div><label>Причина</label><input id="r_reason" placeholder="почему меняем ответственного"/></div>
            </div>
            <div style="margin-top:12px"><button class="btn" id="r_do">Переназначить</button></div>
          `;
          showModal("Переназначить РП", html3);
          $('#r_pm_w')?.appendChild(CRSelect.create({ id: 'r_pm', placeholder: '— выбрать —', options: pms.map(p => ({ value: String(p.id), label: p.name })), searchable: true, dropdownClass: 'z-modal' }));
          document.getElementById("r_do").addEventListener("click", async ()=>{
            const newPm = Number(CRSelect.getValue('r_pm')||0);
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

      // ═══════════════════════════════════════════════════════════════
      // Заявка на пропуск из карточки тендера
      // ═══════════════════════════════════════════════════════════════
      // ===== Popup-grid menu: "Действия" =====
      const btnTenderActions = document.getElementById("btnTenderActions");
      if(btnTenderActions && window.AsgardActionMenu){
        btnTenderActions.addEventListener("click", ()=>{
          const actions = [];

          // ─── Документы ───
          actions.push({ section: 'Документы' });
          actions.push({
            icon: '📂', label: 'Открыть все',
            desc: 'Открыть все документы в новых вкладках',
            onClick: () => {
              const links = (docList||[]).filter(d => buildDocumentLink(d));
              links.forEach(d=>openDocumentLink(d));
              if(!links.length) toast("Документы","Нет ссылок","err");
            }
          });
          actions.push({
            icon: '📦', label: 'Экспорт комплекта',
            desc: 'Экспорт документов в JSON-файл',
            onClick: async () => {
              if(window.AsgardDocsPack) await AsgardDocsPack.exportPackJson(tenderId);
              else toast("Экспорт","Модуль не загружен","err");
            }
          });
          actions.push({
            icon: '📥', label: 'Импорт в комплект',
            desc: 'Импорт документов из JSON-файла',
            onClick: async () => {
              const inp=document.createElement("input"); inp.type="file"; inp.accept=".json";
              inp.onchange = async ()=>{
                const f=inp.files[0]; if(!f) return;
                try{ await AsgardDocsPack.importPackJson(f,{tender_id:tenderId, user_id:user.id}); openTenderEditor(tenderId); }
                catch(ex){ toast("Импорт","Ошибка: "+ex.message,"err"); }
              };
              inp.click();
            }
          });

          // ─── Шаблоны ───
          actions.push({ section: 'Шаблоны' });
          actions.push({
            icon: '📄', label: 'Скачать запрос',
            desc: 'Сформировать и скачать запрос',
            onClick: async () => { await AsgardTemplates.downloadRequest(t, await latestEstimate()); }
          });
          actions.push({
            icon: '📊', label: 'Скачать ТКП',
            desc: 'Сформировать и скачать ТКП',
            onClick: async () => { await AsgardTemplates.downloadTKP(t, await latestEstimate()); }
          });
          actions.push({
            icon: '📝', label: 'Скачать сопроводит.',
            desc: 'Сформировать и скачать сопроводительное письмо',
            onClick: async () => { await AsgardTemplates.downloadCover(t, await latestEstimate()); }
          });
          actions.push('---');
          actions.push({
            icon: '📄', label: 'Запрос → комплект',
            desc: 'Сгенерировать и добавить запрос в комплект',
            onClick: () => addGen("req")
          });
          actions.push({
            icon: '📊', label: 'ТКП → комплект',
            desc: 'Сгенерировать и добавить ТКП в комплект',
            onClick: () => addGen("tkp")
          });
          actions.push({
            icon: '📝', label: 'Сопроводит. → компл.',
            desc: 'Сгенерировать и добавить сопроводительное в комплект',
            onClick: () => addGen("cov")
          });

          // ─── Заявки ───
          actions.push({ section: 'Заявки' });
          actions.push({
            icon: '🏗', label: 'Заявка на пропуск',
            desc: 'Создать заявку на оформление пропуска',
            onClick: async () => {
              if(window.AsgardPassRequests && AsgardPassRequests.openFromTender){
                AsgardPassRequests.openFromTender(t, user);
              } else { location.hash = "#/pass-requests"; }
            }
          });
          actions.push({
            icon: '📦', label: 'Заявка на ТМЦ',
            desc: 'Создать заявку на ввоз/вывоз ТМЦ',
            onClick: async () => {
              if(window.AsgardTmcRequests && AsgardTmcRequests.openFromTender){
                AsgardTmcRequests.openFromTender(t, user);
              } else { location.hash = "#/tmc-requests"; }
            }
          });

          // ─── Управление ───
          if(isDirRole(user.role) || user.role === "ADMIN"){
            actions.push({ section: 'Управление' });
            actions.push({
              icon: '📋', label: 'История',
              desc: 'Аудит-лог изменений по тендеру',
              onClick: async () => {
                const logs = (await AsgardDB.all("audit_log"))
                  .filter(l=>l.entity_type==="tender" && l.entity_id===tenderId)
                  .sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
                const rows = logs.map(l=>'<div class="pill"><div class="who"><b>'+esc(l.action)+'</b> — '+esc(formatDateTime(l.created_at))+'</div><div class="role">'+esc(l.actor_user_id)+'</div></div><div class="help" style="margin:6px 0 10px">'+esc(l.payload_json||"")+'</div>').join("");
                showModal("История (тендер)", rows || '<div class="help">Пусто.</div>');
              }
            });
          }

          AsgardActionMenu.show({
            title: 'Действия: Тендер #' + (t ? t.id : 'новый'),
            actions
          });
        });
      }

      const btnPassReq = document.getElementById("btnPassRequest");
      if(btnPassReq && t){
        btnPassReq.addEventListener("click", async ()=>{
          openPassRequestFromTender(t);
        });
      }

      // ═══════════════════════════════════════════════════════════════
      // Заявка на ввоз/вывоз ТМЦ из карточки тендера
      // ═══════════════════════════════════════════════════════════════
      const btnTmcReq = document.getElementById("btnTmcRequest");
      if(btnTmcReq && t){
        btnTmcReq.addEventListener("click", async ()=>{
          openTmcRequestFromTender(t);
        });
      }

      async function saveTender(forceDraft){
        const appS = await getAppSettings();
        const _pm = CRSelect.getValue('e_period_month') || String(new Date().getMonth()+1).padStart(2,'0');
        const _py = CRSelect.getValue('e_period_year') || String(new Date().getFullYear());
        const period = `${_py}-${_pm}`;
        const innRaw = CRAutocomplete.getValue("e_inn") || "";
        const customer_inn = String(innRaw).replace(/\D/g, "");
        let customer=(CRAutocomplete.getValue("e_customer") || "").trim();
        const title=document.getElementById("e_title").value.trim();
        const tenderType = (CRSelect.getValue('e_type') || "Тендер").trim();
        const pmId = Number(CRSelect.getValue('e_pm')||0) || null;
        const status = CRSelect.getValue('e_status') || '';
        const priceRaw=document.getElementById("e_price").value.trim();
        const price = priceRaw ? Number(priceRaw.replace(/\s/g,"").replace(",", ".")) : null;
        const ws = CRDatePicker.getValue('e_ws') || null;
        const we = CRDatePicker.getValue('e_we') || null;
        const url=document.getElementById("e_url").value.trim()||null;
        let docsDeadline = CRDatePicker.getValue('e_docs_deadline') || null;
        const tagId = Number(CRSelect.getValue('e_tag')) || null;
        const tag = tagId ? (tenderTags.find(tg => tg.id === tagId)?.name || null) : null;
        const cto=""; // deprecated — comments in tender_comments table
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
            reject_reason: reject, group_tag: tag, tag_id: tagId, tender_comment_to: cto,
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
          CRDatePicker.setValue('e_docs_deadline', docsDeadline);
        }
        if(!docsDeadline && tenderType!=="Прямой запрос" && tenderType!=="Доп. объём"){
          toast("Проверка","Укажите дедлайн (окончание приема заявок)","err");
          return null;
        }

        if(!pmId && status!=="Новый"){ toast("Проверка","Назначьте ответственного РП","err"); return null; }
        if(status==="Проиграли" && !reject){ toast("Проверка","Для отказа нужна причина","err"); return null; }

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
            group_tag: tag, tag_id: tagId,
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
            cur.purchase_url=url; cur.docs_deadline=docsDeadline; cur.group_tag=tag; cur.tag_id=tagId; cur.tender_comment_to=cto;
          }else if(rights2.limited){
            cur.purchase_url=url;
            cur.docs_deadline=docsDeadline;
            cur.group_tag=tag; cur.tag_id=tagId;
            cur.tender_comment_to=cto;
          }else{
            toast("Права","Недостаточно прав для редактирования","err");
            return null;
          }
          await AsgardDB.put("tenders", cur);
          
          // TKP Follow-up: активируем если "Прямой запрос" + "КП отправлено"
          if(status === "КП отправлено" && window.AsgardTkpFollowup){
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
          const chkCustomer = (CRAutocomplete.getValue("e_customer") || '').trim();
          const chkTitle = document.getElementById("e_title")?.value?.trim() || '';
          const _cpm = CRSelect.getValue('e_period_month') || '';
          const _cpy = CRSelect.getValue('e_period_year') || '';
          const chkPeriod = (_cpy && _cpm) ? `${_cpy}-${_cpm}` : '';
          const chkDeadline = CRDatePicker.getValue('e_docs_deadline') || '';
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
            _overlay.addEventListener('click', (e) => { if (e.target === _overlay) AsgardUI.oopsBubble(e.clientX, e.clientY); });
            document.getElementById('btnFillMissing').addEventListener('click', () => {
              _overlay.remove();
              const ids = missingFields.map(f => _fieldIdMap[f]).filter(Boolean);
              ids.forEach(fid => {
                const el = CRAutocomplete.getInput(fid) || document.getElementById(fid);
                if (el) {
                  el.style.border = '2px solid var(--err-t)';
                  el.addEventListener('input', () => { el.style.border = ''; }, { once: true });
                }
              });
              if (ids.length) { const first = CRAutocomplete.getInput(ids[0]) || document.getElementById(ids[0]); if (first) first.focus(); }
            });
            document.getElementById('btnDraftMissing').addEventListener('click', async () => {
              _overlay.remove();
              const id = await saveTender(true);
              if(id){ await render({layout, title}); openTenderEditor(id); }
            });
            return;
          }

          // Проверка дубликатов для новых тендеров (Этап 34)
          const customerInn = (CRAutocomplete.getValue("e_inn") || '').trim();
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
              if(done.size===0){ ["Согласование ТКП","ТКП согласовано","Выиграли","Проиграли"].forEach(x=>done.add(x)); }
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

      // «КП отправлено клиенту» — quick-action button
      if(document.getElementById("btnSentToClient")){
        document.getElementById("btnSentToClient").addEventListener("click", async ()=>{
          const id = tenderId;
          const cur = await AsgardDB.get("tenders", id);
          if(!cur || cur.tender_status !== 'ТКП согласовано'){ toast("Статус","Кнопка доступна только при статусе «ТКП согласовано»","err"); return; }
          cur.tender_status = "КП отправлено";
          await AsgardDB.put("tenders", cur);
          await audit(user.id,"tender",id,"sent_to_client",{});
          toast("Тендер","Статус изменён на «КП отправлено»");
          if(window.AsgardTkpFollowup){ try { await AsgardTkpFollowup.activateFollowup(cur); } catch(e){} }
          await render({layout, title});
          openTenderEditor(id);
        });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Заявка на пропуск — из карточки тендера (pre-filled)
  // ═══════════════════════════════════════════════════════════════════
  async function openPassRequestFromTender(tender) {
    const { showModal, hideModal, toast, esc } = AsgardUI;
    const $ = (s) => document.querySelector(s);

    // Получаем список сотрудников компании для выбора
    let staffList = [];
    try {
      const token = localStorage.getItem('asgard_token');
      const resp = await fetch('/api/users?limit=500', { headers: { Authorization: 'Bearer ' + token } });
      const data = await resp.json();
      staffList = (data.users || data.items || []).filter(u => u.is_active !== false && u.name && u.name.trim());
    } catch(e) {
      // fallback: try from IndexedDB
      try { staffList = (await AsgardDB.all('users')) || []; } catch(_) {}
    }

    // Avatar helpers
    const _avatarColors = ['#FF6B6B','#4ECDC4','#45B7D1','#96CEB4','#FFEAA7','#DDA0DD','#98D8C8','#F7DC6F','#BB8FCE','#85C1E9'];
    const _getAvatarColor = (name) => { if(!name) return 'var(--t3)'; let h=0; for(let i=0;i<name.length;i++) h=name.charCodeAt(i)+((h<<5)-h); return _avatarColors[Math.abs(h)%_avatarColors.length]; };
    const _getInitials = (name) => { if(!name) return '??'; return name.split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase(); };

    const staffOptions = staffList.map(s => {
      const sName = s.name||s.login||'—';
      const sPos = s.position||s.role||'';
      return `<label class="emp-selector-item">
        <input type="checkbox" class="pass-staff-cb" value="${s.id}" data-name="${(s.name||s.login||'').replace(/"/g,'&quot;')}" data-position="${(sPos).replace(/"/g,'&quot;')}" />
        <div class="emp-selector-check">\u2713</div>
        <div class="emp-selector-avatar" style="background:${_getAvatarColor(sName)}">${_getInitials(sName)}</div>
        <div class="emp-selector-info">
          <div class="emp-selector-name">${esc(sName)}</div>
          <div class="emp-selector-role">${esc(sPos)}</div>
        </div>
      </label>`;
    }).join('');

    // Получаем email заказчика
    let customerEmail = '';
    if (tender.customer_inn) {
      try {
        const cust = await AsgardDB.get('customers', tender.customer_inn);
        customerEmail = cust?.email || '';
      } catch(_) {}
    }

    const objectName = tender.customer_name || tender.tender_title || '';
    const contactPerson = '';

    const html = `
      <div class="help" style="margin-bottom:12px">Заявка на пропуск для тендера: <b>${esc(tender.tender_title || '')}</b><br/>Заказчик: <b>${esc(tender.customer_name || '')}</b></div>
      <div class="formrow">
        <div><label>Объект (название)</label><input id="prObj" value="${esc(objectName)}" placeholder="Название объекта" /></div>
      </div>
      <div class="formrow">
        <div><label>Дата с</label><input id="prFrom" type="date" value="${(tender.work_start_plan || '').slice(0,10)}" /></div>
        <div><label>Дата по</label><input id="prTo" type="date" value="${(tender.work_end_plan || '').slice(0,10)}" /></div>
      </div>
      <div class="formrow">
        <div><label>Контактное лицо</label><input id="prContact" value="${esc(contactPerson)}" /></div>
        <div><label>Телефон</label><input id="prPhone" value="" /></div>
      </div>
      <div class="formrow"><div style="grid-column:1/-1">
        <label>Email заказчика (для отправки заявки)</label>
        <input id="prClientEmail" type="email" value="${esc(customerEmail)}" placeholder="email заказчика"/>
      </div></div>

      <hr class="hr"/>
      <div class="help"><b>Сотрудники</b> — выберите из списка или введите вручную</div>
      <input type="text" class="inp" placeholder="Поиск сотрудников..." id="passStaffSearch" style="margin:8px 0;width:100%">
      <div class="emp-selector" style="max-height:240px;" id="staffSelectBox">
        ${staffOptions || '<div class="muted">Список сотрудников не загружен</div>'}
      </div>
      <div class="formrow"><div style="grid-column:1/-1">
        <label>Дополнительные сотрудники (ФИО, по одному на строку)</label>
        <textarea id="prEmpsExtra" rows="2" placeholder="Иванов Иван Иванович"></textarea>
      </div></div>

      <hr class="hr"/>
      <div class="formrow"><div style="grid-column:1/-1">
        <label>Транспорт (марка + номер, по одному на строку)</label>
        <textarea id="prVehs" rows="2" placeholder="Газель А123БВ77"></textarea>
      </div></div>
      <div class="formrow"><div style="grid-column:1/-1">
        <label>Примечания</label><textarea id="prNotes" rows="2">${esc(tender.tender_comment_to || '')}</textarea>
      </div></div>
      <hr class="hr"/>
      <div style="display:flex;gap:10px">
        <button class="btn primary" id="btnCreatePassReq" style="flex:1">Создать заявку на пропуск</button>
      </div>`;

    showModal('Заявка на пропуск', html);

    // Staff search filter
    const passStaffSearch = document.getElementById('passStaffSearch');
    if (passStaffSearch) {
      passStaffSearch.addEventListener('input', function() {
        const q = this.value.toLowerCase();
        const items = document.querySelectorAll('#staffSelectBox .emp-selector-item');
        items.forEach(item => {
          const name = (item.querySelector('.emp-selector-name')?.textContent || '').toLowerCase();
          const role = (item.querySelector('.emp-selector-role')?.textContent || '').toLowerCase();
          item.style.display = (name.includes(q) || role.includes(q)) ? '' : 'none';
        });
      });
    }

    $('#btnCreatePassReq')?.addEventListener('click', async () => {
      // Собираем выбранных сотрудников
      const employees = [];
      document.querySelectorAll('.pass-staff-cb:checked').forEach(cb => {
        employees.push({
          fio: cb.dataset.name || '',
          position: cb.dataset.position || '',
          user_id: cb.value
        });
      });
      // Добавляем введённых вручную
      const extraLines = ($('#prEmpsExtra')?.value || '').split('\n').filter(s => s.trim());
      extraLines.forEach(line => {
        employees.push({ fio: line.trim() });
      });

      // Транспорт
      const vehicles = ($('#prVehs')?.value || '').split('\n').filter(s => s.trim()).map(line => {
        const parts = line.trim().split(/\s+/);
        return { brand: parts.slice(0, -1).join(' ') || 'ТС', plate: parts[parts.length - 1] || '' };
      });

      const body = {
        work_id: tender.work_id || null,
        object_name: $('#prObj')?.value || '',
        pass_date_from: $('#prFrom')?.value || '',
        pass_date_to: $('#prTo')?.value || '',
        contact_person: $('#prContact')?.value || '',
        contact_phone: $('#prPhone')?.value || '',
        employees_json: employees,
        vehicles_json: vehicles,
        notes: ($('#prNotes')?.value || '') + (tender.id ? `\n[Тендер #${tender.id}: ${tender.tender_title || ''}]` : '')
      };

      if (!body.object_name) { toast('Ошибка', 'Укажите объект', 'err'); return; }
      if (!body.pass_date_from || !body.pass_date_to) { toast('Ошибка', 'Укажите даты пропуска', 'err'); return; }

      try {
        const token = localStorage.getItem('asgard_token');
        const resp = await fetch('/api/pass-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify(body)
        });
        if (resp.ok) {
          const result = await resp.json();
          toast('Готово', 'Заявка на пропуск создана');
          hideModal();

          // Отправить заявку на email заказчика, если указан
          const clientEmail = $('#prClientEmail')?.value;
          if (clientEmail && result.item?.id) {
            try {
              window.open(`/api/pass-requests/${result.item.id}/pdf?token=${token}`, '_blank');
              toast('PDF', 'PDF заявки открыт для скачивания/отправки');
            } catch(_) {}
          }
        } else {
          const err = await resp.json();
          toast('Ошибка', err.error || 'Не удалось создать заявку', 'err');
        }
      } catch(e) {
        toast('Ошибка', e.message || 'Ошибка сети', 'err');
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // Заявка на ввоз/вывоз ТМЦ — из карточки тендера (pre-filled)
  // ═══════════════════════════════════════════════════════════════════
  async function openTmcRequestFromTender(tender) {
    const { showModal, hideModal, toast, esc } = AsgardUI;
    const $ = (s) => document.querySelector(s);

    const tenderTitle = tender.tender_title || '';
    const customerName = tender.customer_name || '';

    const html = `
      <div class="help" style="margin-bottom:12px">Заявка на ввоз/вывоз ТМЦ для тендера: <b>${esc(tenderTitle)}</b><br/>Заказчик: <b>${esc(customerName)}</b></div>
      <div class="formrow"><div style="grid-column:1/-1">
        <label>Название заявки</label>
        <input id="tmcTitle" value="${esc('ТМЦ — ' + tenderTitle)}" placeholder="Заявка на материалы для..." />
      </div></div>
      <div class="formrow">
        <div><label>Приоритет</label>
          <div id="tmcPriority_w"></div>
        </div>
        <div><label>Нужно к дате</label><input id="tmcNeeded" type="date" value="${(tender.work_start_plan || '').slice(0,10)}" /></div>
      </div>
      <div class="formrow">
        <div><label>Поставщик</label><input id="tmcSupplier" value="" /></div>
        <div><label>Адрес доставки</label><input id="tmcAddr" value="" /></div>
      </div>
      <div class="formrow"><div style="grid-column:1/-1">
        <label>Позиции (наименование|ед.|кол-во|цена, по одной на строку)</label>
        <textarea id="tmcItems" rows="6" placeholder="Труба 89x6|м.п.|100|1500&#10;Электрод ОК 46.00|кг|50|800"></textarea>
      </div></div>
      <div class="formrow"><div style="grid-column:1/-1">
        <label>Примечания</label><textarea id="tmcNotes" rows="2">${esc(tender.tender_comment_to || '')}</textarea>
      </div></div>
      <hr class="hr"/>
      <div style="display:flex;gap:10px">
        <button class="btn primary" id="btnCreateTmcReq" style="flex:1">Создать заявку на ТМЦ</button>
      </div>`;

    showModal('Заявка на ввоз/вывоз ТМЦ', html);
    $('#tmcPriority_w')?.appendChild(CRSelect.create({ id: 'tmcPriority', options: [{ value: 'low', label: 'Низкий' },{ value: 'normal', label: 'Обычный' },{ value: 'high', label: 'Высокий' },{ value: 'urgent', label: 'Срочный' }], value: 'normal', dropdownClass: 'z-modal' }));

    $('#btnCreateTmcReq')?.addEventListener('click', async () => {
      const lines = ($('#tmcItems')?.value || '').split('\n').filter(s => s.trim());
      const parsedItems = lines.map(line => {
        const parts = line.split('|');
        const qty = parseFloat(parts[2]) || 0;
        const price = parseFloat(parts[3]) || 0;
        return { name: (parts[0] || '').trim(), unit: (parts[1] || 'шт.').trim(), quantity: qty, price: price, total: qty * price };
      });
      const totalSum = parsedItems.reduce((s, i) => s + (i.total || 0), 0);

      const body = {
        work_id: tender.work_id || null,
        title: $('#tmcTitle')?.value || '',
        priority: CRSelect.getValue('tmcPriority') || 'normal',
        needed_by: $('#tmcNeeded')?.value || null,
        supplier: $('#tmcSupplier')?.value || '',
        delivery_address: $('#tmcAddr')?.value || '',
        items_json: parsedItems,
        total_sum: totalSum,
        notes: ($('#tmcNotes')?.value || '') + (tender.id ? `\n[Тендер #${tender.id}: ${tenderTitle}]` : '')
      };

      if (!body.title) { toast('Ошибка', 'Укажите название заявки', 'err'); return; }

      try {
        const token = localStorage.getItem('asgard_token');
        const resp = await fetch('/api/tmc-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify(body)
        });
        if (resp.ok) {
          toast('Готово', 'Заявка на ТМЦ создана');
          hideModal();
        } else {
          const err = await resp.json();
          toast('Ошибка', err.error || 'Не удалось создать заявку', 'err');
        }
      } catch(e) {
        toast('Ошибка', e.message || 'Ошибка сети', 'err');
      }
    });
  }

  return { render };
})();
