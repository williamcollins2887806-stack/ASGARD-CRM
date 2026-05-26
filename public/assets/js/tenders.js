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

  function appendTokenToUrl(url) {
    var tk = localStorage.getItem('asgard_token');
    if (!url || !tk) return url;
    if (!/^\/api\//i.test(url)) return url;
    var sep = url.indexOf('?') === -1 ? '?' : '&';
    return url + sep + 'token=' + encodeURIComponent(tk);
  }

  function openDocumentLink(doc){
    const url = buildDocumentLink(doc);
    if(!url) return false;
    const a = document.createElement('a');
    a.href = appendTokenToUrl(url);
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
    const tokenUrl = appendTokenToUrl(url);
    const label = esc(doc?.name || doc?.original_name || doc?.filename || '\u0424\u0430\u0439\u043b');
    if(!url) return '<span class="help">\u0424\u0430\u0439\u043b \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d</span>';
    const attrs = isInlineDownloadLink(url)
      ? `href="${esc(tokenUrl)}" download="${label}"`
      : `href="${esc(tokenUrl)}" target="_blank" rel="noopener"`;
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
  let _typeChipsEl = null; // CrField.chips element for tender type (set in openTenderEditor)

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
    const _inn = (typeof window.__tenderSelectedInnGetter === 'function')
      ? (window.__tenderSelectedInnGetter() || '')
      : '';
    return {
      period: (_py && _pm) ? `${_py}-${_pm}` : '',
      customer_inn: _inn,
      customer_name: CRAutocomplete.getValue("e_customer") || '',
      tender_title: document.getElementById("e_title")?.value || '',
      tender_type: (typeof _typeChipsEl !== 'undefined' && _typeChipsEl && _typeChipsEl._crGetValue) ? (_typeChipsEl._crGetValue() || '') : (CRSelect.getValue('e_type') || ''),
      tender_price: document.getElementById("e_price")?.value || '',
      tender_price_with_vat: document.getElementById("e_price_vat")?.value || '',
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
    // ИНН восстанавливается в _selectedInn после монтирования autocomplete (см. ниже)
    if (draft.customer_name) CRAutocomplete.setValue('e_customer', draft.customer_name);
    if (draft.customer_inn && typeof window !== 'undefined') {
      // Отложенная установка — _selectedInnGetter ставится только после mount
      setTimeout(() => {
        if (typeof window.__tenderSelectedInnSetter === 'function') {
          window.__tenderSelectedInnSetter(draft.customer_inn);
        }
      }, 100);
    }
    if (draft.tender_type) {
      if (_typeChipsEl && _typeChipsEl._crSetValue) _typeChipsEl._crSetValue(draft.tender_type);
      else CRSelect.setValue('e_type', draft.tender_type);
    }
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

// State machine тендеров — допустимые переходы (зеркало src/routes/tenders.js)
  const TENDER_TRANSITIONS = {
    'Черновик':              ['Новый'],
    'Новый':                 ['Отправлено на просчёт', 'Проиграли'],
    'Отправлено на просчёт': ['Согласование ТКП', 'Проиграли'],
    'Согласование ТКП':      ['ТКП согласовано', 'Отправлено на просчёт', 'Проиграли'],
    'ТКП согласовано':       ['Готово к отправке КП', 'Согласование ТКП', 'Проиграли'],
    'Готово к отправке КП':  ['КП отправлено', 'ТКП согласовано', 'Проиграли'],
    'КП отправлено':         ['Выиграли', 'Проиграли'],
    'Выиграли':              [],
    'Проиграли':             ['Новый']
  };

  const TENDER_STATUS_COLORS = {
    'Черновик': '#6c757d', 'Новый': '#5b8def', 'На анализе': '#9b59b6',
    'Отправлено на просчёт': '#f39c12',
    'Согласование ТКП': '#e67e22', 'ТКП согласовано': '#27ae60',
    'Готово к отправке КП': '#c8a84e',
    'КП отправлено': '#17a2b8',
    'Выиграли': '#2ecc71', 'Проиграли': '#e74c3c', 'Не подходит': '#95a5a6'
  };

  function tenderStatusBadge(status) {
    const bg = TENDER_STATUS_COLORS[status] || '#6c757d';
    return `<span class="cr-status-badge" style="background:${bg}">${esc(status || '')}</span>`;
  }

  async function getRefs(){
    const refs = await AsgardDB.get("settings","refs");
    const defaultStatuses = ['Черновик','Новый','На анализе','Отправлено на просчёт','Согласование ТКП','ТКП согласовано','Готово к отправке КП','КП отправлено','Выиграли','Проиграли','Не подходит'];
    if(refs && refs.tender_statuses && refs.tender_statuses.length) return refs;
    return { tender_statuses: defaultStatuses, reject_reasons: (refs && refs.reject_reasons) || [] };
  }

  async function getUsers(){
    const users = await AsgardDB.all("users");
    return users.filter(u =>
      u.is_active &&
      u.name && u.name.trim() &&
      u.role !== 'BOT' &&
      !String(u.login||'').startsWith('test_') &&
      u.login !== 'mimir_bot'
    );
  }

  function canEditTender(user, tender){
    if(user.role==="ADMIN") return {full:true, limited:false};
    if(isDirRole(user.role)) return {full:false, limited:true};
    if(user.role==="TO" || user.role==="HEAD_TO"){
      // После назначения РП на работы ТО не имеет прав даже на limited-правки —
      // дальше тендер полностью в зоне ответственности РП на работах.
      if (tender.work_assigned_at) return {full:false, limited:false};
      if(!tender.handoff_at && tender.tender_status !== 'На анализе') return {full:true, limited:false};
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

  var _showAutoEstBtn = false;

  function tenderRow(t, pmName, createdByName){
    const fmtDate = AsgardUI.formatDate || (d => d ? new Date(d).toLocaleDateString('ru-RU') : '—');
    const ds = fmtDate(t.work_start_plan);
    const de = fmtDate(t.work_end_plan);
    const link = t.purchase_url ? `<a class="btn ghost" style="padding:6px 10px" target="_blank" href="${esc(t.purchase_url)}">Ссылка</a>` : "—";
    const ddl = fmtDate(t.docs_deadline);
    const archiveInfo = t.tender_status === 'Не подходит' ? `<div class="help" style="color:var(--t3);margin-top:4px">📁 ${esc(t.archive_reason||'—')} · ${esc((t.archive_comment||'').substring(0,60))}${(t.archive_comment||'').length>60?'...':''}</div>` : '';
    return `<tr data-id="${t.id}">
      <td><input type="checkbox" class="tender-check" value="${t.id}" onchange="window._asgTenderBulkCount&&window._asgTenderBulkCount()"/></td>
      <td>${fmtPeriod(t.period)}</td>
      <td>
        <b>${esc(t.customer_name||"")}</b>
        <div class="help">${esc(t.customer_inn||"")}</div>
        <div class="help">${esc(t.tender_title||"")}</div>
        ${archiveInfo}
      </td>
      <td>${esc(pmName||"—")}</td>
      <td>${esc(t.tender_type||"—")}</td>
      <td>${tenderStatusBadge(t.tender_status)}</td>
      <td>${ddl}</td>
      <td>${esc(createdByName||"—")}</td>
      <td>${(function(){var n=t.tender_price?'<div style="font-size:11px"><span style="font-size:10px;color:var(--t3)">НМЦ</span> '+money(t.tender_price)+'</div>':'';var s=t.submission_price?'<div style="font-size:11px;margin-top:3px"><span style="font-size:10px;color:#4cd964">Подача</span> '+money(t.submission_price)+'</div>':'';return (n+s)||'—';}())}</td>
      <td>${ds} → ${de}</td>
      <td>${link}</td>
      <td style="white-space:nowrap">
        ${_showAutoEstBtn ? (function(){
          const st = t.tender_status||'';
          if(st === 'Новый') return '<button class="btn" style="padding:6px 10px;background:linear-gradient(135deg,#C8293B,#1E4D8C);color:#fff;border:none;margin-right:6px" data-act="auto_estimate" title="Авто-просчёт Мимиром">⚡ Просчитать</button>';
          if(st === 'Отправлено на просчёт' || st === 'Согласование ТКП' || st === 'ТКП согласовано') return '<button class="btn ghost" style="padding:6px 10px;opacity:0.5;margin-right:6px" disabled title="Тендер у РП">⚡ У РП</button>';
          if(st === 'Выиграли' || st === 'Проиграли' || st === 'Не подходит') return '';
          return '<button class="btn ghost" style="padding:6px 10px;opacity:0.5;margin-right:6px" disabled title="Тендер просчитан">⚡ Просчитан</button>';
        })() : ''}
        <button class="btn" style="padding:6px 10px" data-act="open">Открыть</button>
      </td>
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
    else if (st === 'Черновик' || st === 'Не подходит') statusCls = 'draft';
    else statusCls = 'info';

    const archiveInfo = t.tender_status === 'Не подходит'
      ? '<div style="font-size:12px;color:var(--t3);margin-top:6px;padding:6px 8px;background:rgba(149,165,166,.1);border-radius:6px">📁 ' + esc(t.archive_reason||'—') + ' · ' + esc((t.archive_comment||'').substring(0,50)) + ((t.archive_comment||'').length>50?'...':'') + '</div>'
      : '';

    return '<div class="m-tender-card" data-id="' + t.id + '">' +
      '<div class="m-tc-header">' +
        '<div class="m-tc-customer">' + esc(t.customer_name || '—') + '</div>' +
        '<span class="m-tc-badge m-tc-' + statusCls + '">' + esc(st || '—') + '</span>' +
      '</div>' +
      '<div class="m-tc-title">' + esc(t.tender_title || '') + '</div>' +
      archiveInfo +
      '<div class="m-tc-meta">' +
        '<div class="m-tc-field"><span class="m-tc-label">РП</span><span>' + esc(pmName || '—') + '</span></div>' +
        '<div class="m-tc-field"><span class="m-tc-label">Тип</span><span>' + esc(t.tender_type || '—') + '</span></div>' +
        '<div class="m-tc-field"><span class="m-tc-label">Дедлайн</span><span>' + ddl + '</span></div>' +
        '<div class="m-tc-field"><span class="m-tc-label">НМЦ</span><span class="m-tc-price">' + price + (t.tender_price_with_vat ? '<span style="font-size:11px;color:var(--t3);margin-left:4px">(с НДС ' + money(t.tender_price_with_vat) + ')</span>' : '') + '</span></div>' +
        '<div class="m-tc-field"><span class="m-tc-label" style="color:var(--ok-t,#4cd964)">Подача</span><span class="m-tc-price" style="color:var(--ok-t,#4cd964)">' + (t.submission_price ? money(t.submission_price) : '—') + (t.submission_price_with_vat ? '<span style="font-size:11px;color:var(--t3);margin-left:4px">(с НДС ' + money(t.submission_price_with_vat) + ')</span>' : '') + '</span></div>' +
      '</div>' +
      '<div class="m-tc-footer">' +
        '<span class="m-tc-period">' + fmtPeriod(t.period) + '</span>' +
        '<div style="display:flex;gap:6px">' +
        (_showAutoEstBtn ? (function(){
          var st2 = t.tender_status||'';
          if(st2 === 'Новый') return '<button class="btn mini" data-act="auto_estimate" style="border-radius:8px;background:linear-gradient(135deg,#C8293B,#1E4D8C);color:#fff;border:none">⚡ Просчитать</button>';
          if(st2 === 'Отправлено на просчёт' || st2 === 'Согласование ТКП' || st2 === 'ТКП согласовано') return '<button class="btn mini" disabled style="border-radius:8px;opacity:0.5" title="У РП">⚡</button>';
          return '';
        })() : '') +
        '<button class="btn mini" data-act="open">Открыть</button>' +
        '</div>' +
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
    _showAutoEstBtn = ['TO','HEAD_TO','ADMIN'].includes(user.role);

    const users = await getUsers();
    const pms = users.filter(u=>u.role==="PM" || (Array.isArray(u.roles) && u.roles.includes("PM")));
    const byId = new Map(users.map(u=>[u.id,u]));
    const refs = await getRefs();
    const tenders = await AsgardDB.all("tenders");

    let sortKey="id", sortDir=-1;

    let archiveMode = false; // true = показываем архив (Не подходит)

    const body = `
      ${tableCSS()}
      <style>
        .tender-tabs { display:flex; gap:0; border-bottom:2px solid var(--brd); margin-bottom:16px; }
        .tender-tab { padding:10px 20px; cursor:pointer; font-weight:600; font-size:14px; border-bottom:3px solid transparent; margin-bottom:-2px; color:var(--t3); transition:all .2s; user-select:none; }
        .tender-tab:hover { color:var(--t1); }
        .tender-tab.active { color:var(--primary); border-bottom-color:var(--primary); }
        .tender-tab .tab-badge { display:inline-block; background:var(--err-t); color:#fff; font-size:11px; font-weight:700; padding:2px 7px; border-radius:99px; margin-left:6px; vertical-align:middle; }
        .archive-info-row { display:flex; gap:16px; align-items:center; padding:10px 14px; background:rgba(149,165,166,.1); border-radius:8px; margin-bottom:8px; font-size:13px; color:var(--t2); }
        .archive-info-row b { color:var(--t1); }
      </style>
      <div class="panel">
        <div class="help">
          Реестр тендеров и передача в просчёт. После передачи ТО ограничен: документы/ссылка/тег/комментарий ТО.
          Переназначение РП — только директор/админ, с причиной и записью в журнал.
        </div>
        <hr class="hr"/>
        <div class="tender-tabs">
          <div class="tender-tab active" id="tabActive">Активные</div>
          <div class="tender-tab" id="tabArchive">📁 Архив <span class="tab-badge" id="archiveBadge" style="display:none">0</span></div>
        </div>
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
        <div id="tkp_ready_panel"></div>
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
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="tender_price">НМЦ / Подача</button></th>
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
    $('#f_period_w')?.appendChild(CRSelect.create({ id: 'f_period', options: _periodOpts, value: '', onChange: () => applyAndRender() }));
    $('#f_type_w')?.appendChild(CRSelect.create({ id: 'f_type', options: [{ value: '', label: 'Все' }, ...TENDER_TYPES.map(tp => ({ value: tp, label: tp }))], onChange: () => applyAndRender() }));
    $('#f_status_w')?.appendChild(CRSelect.create({ id: 'f_status', options: [{ value: '', label: 'Все' }, ...refs.tender_statuses.map(s => ({ value: s, label: s }))], onChange: () => applyAndRender() }));
    $('#f_pm_w')?.appendChild(CRSelect.create({ id: 'f_pm', options: [{ value: '', label: 'Все' }, ...pms.map(p => ({ value: String(p.id), label: p.name }))], searchable: true, onChange: () => applyAndRender() }));

    const tb=$("#tb");
    const cnt=$("#cnt");
    const distPanel = $("#dist_panel");
    const winPanel = $("#win_panel");

    await (async function renderDistributionPanel(){
      if(!distPanel) return;
      const canDist = (user.role==="HEAD_TO" || user.role==="ADMIN");
      if(!canDist){ distPanel.innerHTML=""; return; }

      const pending = tenders.filter(t=>t.tender_status==='На анализе');
      if(!pending.length){ distPanel.innerHTML=""; return; }

      const appS = await getAppSettings();
      const lim = Number(appS?.limits?.pm_active_calcs_limit ?? 0) || 0;
      const doneRaw = String(appS?.limits?.pm_active_calcs_done_statuses||"");
      const done = new Set(doneRaw.split(",").map(s=>s.trim()).filter(Boolean));
      if(done.size===0){
        ["Согласование ТКП","ТКП согласовано","Готово к отправке КП","КП отправлено","Выиграли","Проиграли"].forEach(x=>done.add(x));
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
        const suggestedPm = (byId.get(t.responsible_pm_id)||{}).name || "";
        const ddl = t.docs_deadline ? new Date(t.docs_deadline).toLocaleDateString("ru-RU") : "";
        return `
          <tr>
            <td>${esc(t.customer_name||"")}</td>
            <td>${esc(t.tender_title||"")}</td>
            <td>${esc(String(t.tender_type||""))}</td>
            <td>${esc(ddl)}</td>
            <td>${esc(createdBy)}</td>
            <td>${suggestedPm ? '<span style="color:var(--gold,#c8a84e);font-weight:600">💡 ' + esc(suggestedPm) + '</span>' : '<span class="help">не указан</span>'}</td>
            <td style="white-space:nowrap">
              <div id="dist_pm_${t.id}_w" style="display:inline-block;min-width:220px;vertical-align:middle"></div>
              <button class="btn red" style="padding:6px 10px; margin-left:8px" data-assign="${t.id}">Отправить на просчёт</button>
              <button class="btn ghost" style="padding:6px 10px; margin-left:4px; color:var(--err-t)" data-reject="${t.id}">Не подходит</button>
            </td>
          </tr>
        `;
      }).join("");

      distPanel.innerHTML = `
        <div class="card">
          <div class="row" style="justify-content:space-between; align-items:center">
            <h3 style="margin:0">Тендеры на анализе</h3>
            <span class="badge">${pending.length}</span>
          </div>
          <div class="help">Рук. ТО анализирует тендер и назначает РП. Колонка «💡 ТО предложил» — кого ТО изначально указал. Можно оставить или выбрать другого. Лимит активных просчётов: ${lim||"без лимита"}.</div>
          <div style="overflow:auto; margin-top:10px">
            <table class="t" style="min-width:1000px">
              <thead>
                <tr><th>Заказчик</th><th>Тендер</th><th>Тип</th><th>Дедлайн</th><th>Внёс</th><th>💡 ТО предложил</th><th></th></tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
        <hr class="hr"/>
      `;

      /* Mount CRSelect для каждой строки — предустановить значение = preferred РП от ТО */
      pending.forEach(t => {
        const w = distPanel.querySelector(`#dist_pm_${t.id}_w`);
        if (!w) return;
        const distOpts = pms.map(p => {
          const a = activeByPm.get(p.id)||0;
          const dis = (lim>0 && a>=lim);
          return { value: String(p.id), label: `${p.name} (${a}/${lim||'∞'})`, disabled: dis };
        });
        const preselect = t.responsible_pm_id ? String(t.responsible_pm_id) : '';
        w.appendChild(CRSelect.create({
          id: 'dist_pm_' + t.id,
          options: distOpts,
          value: preselect,
          placeholder: 'Выберите РП',
          searchable: true
        }));
      });

      /* Кнопка "Отправить на просчёт" */
      distPanel.querySelectorAll("button[data-assign]").forEach(btn=>{
        btn.addEventListener("click", async ()=>{
          const tid = Number(btn.getAttribute("data-assign"));
          const pmId = Number(CRSelect.getValue('dist_pm_' + tid) || 0);
          if(!pmId){ toast("Анализ","Выберите РП","err"); return; }

          btn.disabled = true;
          try {
            const token = localStorage.getItem('asgard_token');
            const resp = await fetch(`/api/tenders/${tid}/send-to-pm`, {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
              body: JSON.stringify({ pm_id: pmId })
            });
            const data = await resp.json();
            if (!resp.ok) { toast("Анализ", data.error || "Ошибка", "err"); btn.disabled = false; return; }

            const pmName = (byId.get(pmId)||{}).name || "РП";
            toast("Анализ","Тендер отправлен в просчёт РП " + pmName,"ok");
            await render({layout, title});
          } catch(e) {
            toast("Анализ", "Ошибка сети", "err");
            btn.disabled = false;
          }
        });
      });

      /* Кнопка "Не подходит" */
      distPanel.querySelectorAll("button[data-reject]").forEach(btn=>{
        btn.addEventListener("click", ()=>{
          const tid = Number(btn.getAttribute("data-reject"));
          openArchiveModal(tid);
        });
      });
    })();

    // ═══════════════════════════════════════════════════════════════
    // Win-assign panel — НОВЫЙ (бэкенд GET /api/tenders/win-pending).
    // После «Выиграли» тендер ждёт назначения РП для ВЫПОЛНЕНИЯ работ.
    // HEAD_TO видит кто считал тендер (calc_pm_name) и может выбрать
    // того же или другого РП для работ. После выбора создаётся work.
    // ═══════════════════════════════════════════════════════════════
    await (async function renderWinAssignPanel(){
      if(!winPanel) return;
      const canWin = (user.role==="HEAD_TO" || isDirRole(user.role) || user.role==="ADMIN");
      if(!canWin){ winPanel.innerHTML=""; return; }

      // Берём с сервера выигранные тендеры БЕЗ работ
      let items = [];
      try {
        const token = localStorage.getItem('asgard_token');
        const resp = await fetch('/api/tenders/win-pending', { headers: { Authorization: 'Bearer ' + token } });
        if (resp.ok) {
          const d = await resp.json();
          items = d.items || [];
        }
      } catch(e) { /* сеть */ }

      if (!items.length) { winPanel.innerHTML = ''; return; }

      const worksAll = await AsgardDB.all("works").catch(()=>[]);

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

      const _winOptsMap = new Map();
      const rows = items.map(t => {
        const ds = t.work_start_plan || "—";
        const de = t.work_end_plan || "—";
        const srcPm = t.calc_pm_name || (byId.get(t.responsible_pm_id)||{}).name || "—";
        const price = t.submission_price || t.tender_price || 0;

        const crOpts = pms.map(p => {
          const pmWorks = worksAll.filter(w => Number(w.pm_id||0) === Number(p.id));
          let maxOv = 0;
          for (const w of pmWorks) {
            const ov = overlapDays(t.work_start_plan, t.work_end_plan, w.start_in_work_date, w.end_plan);
            if (ov > maxOv) maxOv = ov;
          }
          const warn = (maxOv > 0 && maxOv <= 7) ? ` ⚠${maxOv}д` : (maxOv > 7 ? ` ⛔${maxOv}д` : '');
          return { value: String(p.id), label: p.name + warn };
        });
        _winOptsMap.set(t.id, crOpts);

        return `
          <tr>
            <td><b>${esc(t.customer_name||"")}</b><div class="help">${esc(t.tender_title||"")}</div></td>
            <td>${esc(ds)} → ${esc(de)}</td>
            <td>${price ? money(price) : "—"}</td>
            <td><span style="color:var(--gold,#c8a84e);font-weight:600">💡 ${esc(srcPm)}</span></td>
            <td style="white-space:nowrap">
              <div id="win_pm_${t.id}_w" style="display:inline-block;min-width:240px;vertical-align:middle"></div>
              <button class="btn red" style="padding:6px 10px; margin-left:8px" data-win-assign="${t.id}">Назначить на работы</button>
            </td>
          </tr>
        `;
      }).join("");

      winPanel.innerHTML = `
        <div class="card" style="background:linear-gradient(135deg,rgba(46,204,113,.06),rgba(46,204,113,.02));border:1.5px solid rgba(46,204,113,.3);border-radius:12px;padding:16px 20px;margin-bottom:16px">
          <div class="row" style="justify-content:space-between; align-items:center">
            <h3 style="margin:0;color:var(--ok-t,#2ecc71)">🏆 Выигранные тендеры — назначьте РП на работы</h3>
            <span class="badge">${items.length}</span>
          </div>
          <div class="help" style="margin-top:6px">Можно выбрать того же РП что считал тендер (подсвечен 💡) или другого. После назначения работа появится у РП в разделе «Работы».</div>
          <div style="overflow:auto; margin-top:12px">
            <table class="t" style="min-width:900px">
              <thead>
                <tr><th>Тендер</th><th>Период (план)</th><th>Сумма</th><th>💡 Считал тендер</th><th>РП на работы</th></tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
        <hr class="hr"/>
      `;

      _winOptsMap.forEach((crOpts, tenderId) => {
        const w = winPanel.querySelector(`#win_pm_${tenderId}_w`);
        if (!w) return;
        const item = items.find(it => it.id === tenderId);
        const preselect = item && item.responsible_pm_id ? String(item.responsible_pm_id) : '';
        w.appendChild(CRSelect.create({
          id: 'win_pm_' + tenderId,
          options: crOpts,
          value: preselect,
          placeholder: 'Выберите РП',
          searchable: true
        }));
      });

      winPanel.querySelectorAll('button[data-win-assign]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const tid = Number(btn.getAttribute('data-win-assign'));
          const pmId = Number(CRSelect.getValue('win_pm_' + tid) || 0);
          if (!pmId) { toast('Назначение', 'Выберите РП для работ', 'err'); return; }
          btn.disabled = true;
          try {
            const token = localStorage.getItem('asgard_token');
            const resp = await fetch(`/api/tenders/${tid}/assign-work-pm`, {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
              body: JSON.stringify({ pm_id: pmId })
            });
            const data = await resp.json();
            if (!resp.ok) { toast('Назначение', data.error || 'Ошибка', 'err'); btn.disabled = false; return; }
            toast('Назначение', 'Работа создана и назначена РП', 'ok');
            await render({ layout, title });
          } catch(e) {
            toast('Назначение', 'Ошибка сети: ' + e.message, 'err');
            btn.disabled = false;
          }
        });
      });
    })();

    // === LEGACY-блок ниже полностью удалён.
    // Раньше: AsgardDB-based work_assign_requests + pm_consents IndexedDB store.
    // Теперь: всё через REST /api/tenders/{win-pending, assign-work-pm}.
    // Историю → git blame этого файла на коммит 7febfa8 и ранее.
    if (false) {
      let reqs = [];

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
    } // конец if(false) — старый legacy блок

    // ═══════════════════════════════════════════════════════════════
    // Блок «Готово к отправке КП» — для ТО/HEAD_TO/ADMIN/директоров.
    // PM/HEAD_PM этот блок НЕ видят (у них своя панель «Готовы к ТКП» в pm-calcs).
    // На этом этапе РП уже создал ТКП → тендер ждёт отправки КП клиенту.
    // ═══════════════════════════════════════════════════════════════
    (async function renderKpReadyPanel(){
      const tkpReadyPanel = $("#tkp_ready_panel");
      if (!tkpReadyPanel) return;

      // PM/HEAD_PM не видят — у них своя инбокс-панель в pm-calcs
      if (['PM','HEAD_PM'].includes(user.role)) { tkpReadyPanel.innerHTML = ''; return; }
      const canSee = ['TO','HEAD_TO','ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'].includes(user.role);
      if (!canSee) { tkpReadyPanel.innerHTML = ''; return; }

      let items = [];
      try {
        const token = localStorage.getItem('asgard_token');
        const resp = await fetch('/api/tenders?status=' + encodeURIComponent('Готово к отправке КП') + '&limit=200', {
          headers: { Authorization: 'Bearer ' + token }
        });
        if (resp.ok) {
          const data = await resp.json();
          items = data.tenders || data.items || [];
        }
      } catch(e) { /* сеть */ }

      if (!items.length) { tkpReadyPanel.innerHTML = ''; return; }

      const money = AsgardUI.money || (v => Number(v||0).toLocaleString('ru-RU') + ' ₽');
      const fmtDate = AsgardUI.formatDate || (d => d ? new Date(d).toLocaleDateString('ru-RU') : '—');

      const cards = items.map(function(it) {
        const price = Number(it.submission_price || it.tender_price || 0);
        const deadline = it.docs_deadline ? fmtDate(it.docs_deadline) : '';
        const pmName = it.pm_name || '';

        return '<div class="tkp-ready-card" data-tender-id="' + it.id + '">' +
          '<div class="tkp-rc-top">' +
            '<div class="tkp-rc-main">' +
              '<div class="tkp-rc-customer">' + esc(it.customer_name || '—') + '</div>' +
              '<div class="tkp-rc-title">' + esc(it.tender_title || 'Без названия') + '</div>' +
              (pmName ? '<div class="tkp-rc-loc">👤 РП: ' + esc(pmName) + '</div>' : '') +
            '</div>' +
            '<div class="tkp-rc-meta">' +
              (price > 0 ? '<span class="tkp-rc-badge green">' + money(price) + '</span>' : '') +
              (it.tender_type ? '<span class="tkp-rc-badge blue">' + esc(it.tender_type) + '</span>' : '') +
              (deadline ? '<span class="tkp-rc-badge gray">📅 ' + deadline + '</span>' : '') +
            '</div>' +
          '</div>' +
          '<div class="tkp-rc-actions">' +
            '<button class="btn tkp-rc-btn-create" data-send-kp="' + it.id + '">📨 Отправить КП клиенту</button>' +
            '<button class="btn ghost tkp-rc-btn-tender" data-goto-tender="' + it.id + '">Открыть тендер</button>' +
          '</div>' +
        '</div>';
      }).join('');

      tkpReadyPanel.innerHTML =
        '<style>' +
          '.tkp-ready-wrap{background:linear-gradient(135deg,rgba(200,168,78,0.06),rgba(200,168,78,0.03));' +
            'border:1.5px solid rgba(200,168,78,0.3);border-radius:12px;padding:16px 20px;margin-bottom:16px}' +
          '.tkp-ready-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}' +
          '.tkp-ready-title{font-size:14px;font-weight:700;color:var(--gold,#c8a84e);display:flex;align-items:center;gap:8px}' +
          '.tkp-ready-count{background:rgba(200,168,78,0.2);color:var(--gold,#c8a84e);' +
            'font-size:11px;font-weight:700;padding:3px 9px;border-radius:99px;border:1px solid rgba(200,168,78,0.4)}' +
          '.tkp-ready-cards{display:flex;flex-direction:column;gap:8px}' +
          '.tkp-ready-card{background:var(--bg2,#1a1a20);border:1px solid var(--brd,rgba(255,255,255,0.08));' +
            'border-radius:10px;padding:12px 16px;display:flex;align-items:center;' +
            'gap:16px;justify-content:space-between;transition:border-color .2s}' +
          '.tkp-ready-card:hover{border-color:rgba(200,168,78,0.35)}' +
          '.tkp-rc-top{display:flex;align-items:center;gap:16px;flex:1;min-width:0;flex-wrap:wrap}' +
          '.tkp-rc-main{min-width:0;flex:1}' +
          '.tkp-rc-customer{font-weight:700;font-size:14px;color:var(--t1,#fff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
          '.tkp-rc-title{font-size:12px;color:var(--t2,rgba(255,255,255,0.65));margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
          '.tkp-rc-loc{font-size:11px;color:var(--t3,rgba(255,255,255,0.4));margin-top:2px}' +
          '.tkp-rc-meta{display:flex;flex-wrap:wrap;gap:5px;align-items:center;flex-shrink:0}' +
          '.tkp-rc-badge{font-size:11px;font-weight:600;padding:3px 8px;border-radius:6px;white-space:nowrap}' +
          '.tkp-rc-badge.green{background:rgba(48,209,88,0.12);color:#30d158;border:1px solid rgba(48,209,88,0.25)}' +
          '.tkp-rc-badge.blue{background:rgba(74,144,217,0.12);color:#4A90D9;border:1px solid rgba(74,144,217,0.25)}' +
          '.tkp-rc-badge.amber{background:rgba(200,168,78,0.12);color:#c8a84e;border:1px solid rgba(200,168,78,0.25)}' +
          '.tkp-rc-badge.gray{background:rgba(255,255,255,0.06);color:var(--t3,rgba(255,255,255,0.45));border:1px solid rgba(255,255,255,0.1)}' +
          '.tkp-rc-actions{display:flex;gap:8px;flex-shrink:0;align-items:center}' +
          '.tkp-rc-btn-create{background:rgba(200,168,78,0.15)!important;color:var(--gold,#c8a84e)!important;' +
            'border:1px solid rgba(200,168,78,0.4)!important;font-weight:600!important;' +
            'white-space:nowrap;transition:all .2s!important;padding:7px 14px!important}' +
          '.tkp-rc-btn-create:hover{background:rgba(200,168,78,0.28)!important;border-color:rgba(200,168,78,0.7)!important;' +
            'box-shadow:0 0 14px rgba(200,168,78,0.2)!important;transform:translateY(-1px)}' +
          '.tkp-rc-btn-tender{padding:7px 12px!important;font-size:12px!important}' +
          '@media(max-width:600px){' +
            '.tkp-ready-card{flex-direction:column;align-items:flex-start}' +
            '.tkp-rc-actions{width:100%}' +
            '.tkp-rc-btn-create{flex:1;text-align:center}' +
          '}' +
        '</style>' +
        '<div class="tkp-ready-wrap">' +
          '<div class="tkp-ready-header">' +
            '<div class="tkp-ready-title">📨 Готово к отправке КП <span class="tkp-ready-count">' + items.length + '</span></div>' +
            '<span class="help" style="font-size:11px">ТКП создано — отправьте КП клиенту</span>' +
          '</div>' +
          '<div class="tkp-ready-cards">' + cards + '</div>' +
        '</div>' +
        '<hr class="hr"/>';

      // Кнопка "Отправить КП клиенту" — берёт последнее активное ТКП по тендеру
      // и открывает модалку отправки (если AsgardTkpPage умеет). Иначе — открывает карточку тендера.
      tkpReadyPanel.querySelectorAll('[data-send-kp]').forEach(function(btn) {
        btn.addEventListener('click', async function(e) {
          e.stopPropagation();
          var tid = Number(btn.getAttribute('data-send-kp'));
          if (!tid) return;
          btn.disabled = true;
          try {
            // Найти активное ТКП для тендера
            var token = localStorage.getItem('asgard_token');
            var resp = await fetch('/api/tkp/?tender_id=' + tid + '&limit=50', {
              headers: { Authorization: 'Bearer ' + token }
            });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            var data = await resp.json();
            var activeList = (data.items||[]).filter(function(t){ return t.status !== 'rejected' && t.status !== 'draft'; });
            if (!activeList.length) {
              toast('Отправка КП', 'Активного ТКП не найдено — откройте тендер', 'warn');
              openTenderEditor(tid);
              return;
            }
            // Берём самое свежее ТКП
            var tkp = activeList.sort(function(a,b){ return Number(b.id) - Number(a.id); })[0];
            if (window.AsgardTkpPage && AsgardTkpPage.openSend) {
              AsgardTkpPage.openSend(tkp.id);
            } else if (window.AsgardTkpPage && AsgardTkpPage.openEdit) {
              AsgardTkpPage.openEdit(tkp.id);
            } else {
              openTenderEditor(tid);
            }
          } catch (ex) {
            toast('Отправка КП', ex.message || 'Ошибка', 'err');
            openTenderEditor(tid);
          } finally {
            btn.disabled = false;
          }
        });
      });

      // Кнопки "Открыть тендер"
      tkpReadyPanel.querySelectorAll('[data-goto-tender]').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          var tid = Number(btn.getAttribute('data-goto-tender'));
          if (tid) openTenderEditor(tid);
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
        // Режим архива: только "Не подходит"
        if(archiveMode) {
          if(t.tender_status !== 'Не подходит') return false;
        } else {
          // Активные: исключаем "Не подходит"
          if(t.tender_status === 'Не подходит') return false;
        }
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
        if(!archiveMode && st && t.tender_status!==st) return false;
        if(pm && String(t.responsible_pm_id||"")!==String(pm)) return false;
        if(q){
          const hay = `${t.customer_inn||""} ${t.customer_name||""} ${t.tender_title||""} ${t.purchase_url||""} ${t.group_tag||""} ${t.tender_type||""} ${t.archive_reason||""} ${t.archive_comment||""}`.toLowerCase();
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
            const aeBtn = card.querySelector('[data-act="auto_estimate"]');
            if (aeBtn) aeBtn.addEventListener('click', async (ev) => {
              ev.stopPropagation();
              const tId = Number(card.dataset.id);
              if(!window.openMimirAutoEstimate){ toast("Просчёт","Модуль не загружен","err"); return; }
              const workRes = await AsgardDB.byIndex("works","tender_id", tId);
              const work = workRes[0] || null;
              if(work && work.id) window.openMimirAutoEstimate(work.id);
              else window.openMimirAutoEstimate(null, tId);
            });
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
      // Обновляем бейдж архива
      const archiveCount = tenders.filter(t => t.tender_status === 'Не подходит').length;
      const archiveBadge = document.getElementById('archiveBadge');
      if(archiveBadge) {
        archiveBadge.textContent = archiveCount;
        archiveBadge.style.display = archiveCount > 0 ? '' : 'none';
      }
    }

    applyAndRender();

    // Табы "Активные" / "Архив"
    const tabActive = document.getElementById('tabActive');
    const tabArchive = document.getElementById('tabArchive');
    if(tabActive) tabActive.addEventListener('click', () => {
      archiveMode = false;
      tabActive.classList.add('active');
      tabArchive.classList.remove('active');
      currentPage = 1;
      applyAndRender();
    });
    if(tabArchive) tabArchive.addEventListener('click', () => {
      archiveMode = true;
      tabArchive.classList.add('active');
      tabActive.classList.remove('active');
      currentPage = 1;
      applyAndRender();
    });

    // Мобильные карточки
    if (window.AsgardUI?.makeResponsiveTable) {
      AsgardUI.makeResponsiveTable('.asg');
    }

    // CRSelect onChange уже вызывает applyAndRender()
    $("#f_q").addEventListener("input", applyAndRender);

    $("#btnReset").addEventListener("click", ()=>{
      CRSelect.setValue('f_period', '');
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
            <div style="background:var(--bg3); padding:12px; border-radius:6px; max-height:150px; overflow:auto; font-size:13px">
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
      if(act==="auto_estimate"){
        if(!window.openMimirAutoEstimate){ toast("Просчёт","Модуль авто-просчёта не загружен","err"); return; }
        const workRes = await AsgardDB.byIndex("works","tender_id", id);
        const work = workRes[0] || null;
        if(work && work.id){
          window.openMimirAutoEstimate(work.id);
        } else {
          window.openMimirAutoEstimate(null, id);
        }
      }
      if(act==="handoff") { openTenderEditor(id); setTimeout(()=>{ const b=document.getElementById("btnDist")||document.getElementById("btnCreateTkp"); if(b) b.scrollIntoView({block:"center"}); }, 50); }
    });

    async function openTenderEditor(tenderId){
      const t = tenderId ? await AsgardDB.get("tenders", tenderId) : null;
      const rights = canEditTender(user, t||{handoff_at:null});
      const isNew = !t;

      // Авто-восстановление Мимира: если в этом тендере идёт/готов просчёт —
      // открыть модалку автоматически (например после перезагрузки страницы).
      if (tenderId && window.mimirRecoverIfRunning) {
        try {
          const workRes = await AsgardDB.byIndex("works","tender_id", tenderId);
          const work = workRes[0] || null;
          window.mimirRecoverIfRunning({
            workId: work && work.id ? work.id : null,
            tenderId: !work ? tenderId : null
          }).catch(function(){});
        } catch(_) {}
      }

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

      const lockedMsg = t && t.handoff_at ? `<div class="tag"><b>🔒</b> Передано в просчёт: ${esc(formatDateTime(t.handoff_at))}</div>` : "";
      const canReassign = (isDirRole(user.role) || user.role==="ADMIN");
      const canArchive = ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','HEAD_TO'].includes(user.role);

      const full = rights.full || isNew;
      const limited = rights.limited;

      // ═══════════════════════════════════════════════════════════════
      // WIZARD HTML — 3 steps: Основное / Условия / Документы
      // ═══════════════════════════════════════════════════════════════
      const _stepperHtml = isNew ? `<div id="e_stepper"></div>` : '';

      const html = `
        ${lockedMsg ? `<div class="help" style="margin-bottom:8px">${lockedMsg} ${t && t.handoff_at ? 'После передачи ТО меняет только: «Ссылка», «Тег», «Комментарий ТО», «Документы».' : ''}</div>` : ''}
        ${_stepperHtml}

        <!-- ═══ STEP 1: Основное ═══ -->
        <div data-step="0">
          <div class="cr-f-section"><span class="cr-f-section__icon" style="color:var(--gold)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2m-9-11h2m18 0h2"/></svg></span><span>Заказчик и предмет</span></div>

          <div class="cr-f-field">
            <div class="cr-f-label">Заказчик / ИНН <span class="cr-f-label__req">*</span></div>
            <div id="cr-customer-wrap"></div>
            <div class="cr-f-help">Начните вводить название или ИНН. Если организации нет в базе — будет предложен поиск через ДаДата (ЕГРЮЛ).</div>
            <div class="cr-f-help" id="innWarn" style="display:none; color:var(--err-t)">Контрагент не найден в базе. Создайте карточку — она подставится автоматически.</div>
            <div id="innCreateRow" style="display:none; margin-top:6px"><button type="button" class="btn ghost mini" id="btnCreateCustomer">➕ Создать контрагента</button></div>
            <div id="customerScoreBlock" style="margin-top:8px;display:none"></div>
          </div>

          <div class="cr-f-row--2">
            <div class="cr-f-field">
              <div class="cr-f-label">Период <span class="cr-f-label__req">*</span></div>
              <div class="cr-period-row" id="e_period_w"></div>
            </div>
            <div class="cr-f-field"></div>
          </div>

          <div class="cr-f-field">
            <div class="cr-f-label">Наименование работ <span class="cr-f-label__req">*</span></div>
            <input id="e_title" value="${esc((t&&t.tender_title)||"")}" ${full?"":"disabled"} placeholder="Что нужно сделать?"/>
          </div>

          <div class="cr-f-row--2">
            <div class="cr-f-field">
              <div class="cr-f-label">НМЦ без НДС, ₽</div>
              <input id="e_price" class="cr-f-mono" value="${esc((t&&t.tender_price)!=null?String(t.tender_price):"")}" ${full?"":"disabled"} placeholder="0"/>
            </div>
            <div class="cr-f-field">
              <div class="cr-f-label">НМЦ с НДС, ₽</div>
              <input id="e_price_vat" class="cr-f-mono" value="${esc((t&&t.tender_price_with_vat)!=null?String(t.tender_price_with_vat):"")}" ${full?"":"disabled"} placeholder="авто" style="color:var(--t3)"/>
            </div>
          </div>
          ${(!isNew) ? `<div class="cr-f-row--2" style="margin-top:4px">
            <div class="cr-f-field">
              <div class="cr-f-label" style="color:var(--ok-t,#4cd964)">Цена подачи без НДС, ₽</div>
              <input id="e_sub_price" class="cr-f-mono" value="${esc((t&&t.submission_price)!=null?String(t.submission_price):"")}" ${(user.role==='ADMIN'||isDirRole(user.role))?"":"disabled"} placeholder="заполняется после согласования" style="color:var(--ok-t,#4cd964)"/>
            </div>
            <div class="cr-f-field">
              <div class="cr-f-label" style="color:var(--ok-t,#4cd964)">Цена подачи с НДС, ₽</div>
              <input id="e_sub_price_vat" class="cr-f-mono" value="${esc((t&&t.submission_price_with_vat)!=null?String(t.submission_price_with_vat):"")}" disabled placeholder="авто" style="color:var(--ok-t,#4cd964)"/>
            </div>
          </div>` : ''}
          <div class="cr-f-row--2">
            <div class="cr-f-field">
              <div class="cr-f-label">Тип заявки</div>
              <div id="e_type_w"></div>
            </div>
            <div class="cr-f-field"></div>
          </div>

          <div class="cr-f-row--2">
            <div class="cr-f-field">
              <div class="cr-f-label">Ответственный РП <span class="cr-f-label__req">*</span></div>
              <div id="e_pm_w"></div>
              ${(user.role==="TO" && (!t || !t.handoff_at)) ? `<div class="cr-f-help">РП назначается Рук. ТО после отправки «На анализ».</div>` : ``}
              ${(t && t.tender_status==='На анализе') ? `<div class="cr-f-help" style="color:var(--gold)"><b>На анализе.</b> Рук. ТО назначит РП.</div>` : ``}
              ${(t && t.handoff_at && canReassign) ? `<button class="btn ghost mini" style="margin-top:6px" id="btnReassign">Переназначить</button>` : ``}
            </div>
            <div class="cr-f-field">
              <div class="cr-f-label">Статус</div>
              <div id="e_status_w"></div>
            </div>
          </div>

          <div class="cr-f-field">
            <div class="cr-f-label">Тег/группа</div>
            <div id="e_tag_w"></div>
          </div>
        </div>

        <!-- ═══ STEP 2: Условия ═══ -->
        <div data-step="1">
          <div class="cr-f-section"><span class="cr-f-section__icon" style="color:var(--blue-l)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span><span>Сроки и условия</span></div>

          <div class="cr-f-field">
            <div class="cr-f-label">Ссылка на документы (Я.Диск / площадка)</div>
            <input id="e_url" value="${esc((t&&t.purchase_url)||"")}" ${(full||limited)?"":"disabled"} placeholder="https://..."/>
          </div>

          <div class="cr-f-row--2">
            <div class="cr-f-field">
              <div class="cr-f-label">План: начало работ</div>
              <div id="e_ws_w"></div>
            </div>
            <div class="cr-f-field">
              <div class="cr-f-label">План: окончание работ</div>
              <div id="e_we_w"></div>
            </div>
          </div>

          <div class="cr-f-field" id="e_deadline_row">
            <div class="cr-f-label">Дедлайн (окончание приёма заявок)</div>
            <div id="e_deadline_w"></div>
          </div>

          ${(t && t.reject_reason) ? `
          <div class="cr-f-field">
            <div class="cr-f-label">Причина отказа</div>
            <input autocomplete="off" value="${esc(t.reject_reason)}" disabled />
          </div>` : ``}

          <div class="cr-f-field">
            <div class="cr-f-label">Комментарии</div>
            <div id="tc_feed" class="tc-feed"><div class="tc-empty">Загрузка...</div></div>
            ${(full||limited) ? `<div class="tc-input-row">
              <textarea id="tc_input" rows="1" placeholder="Комментарий..."></textarea>
              <button class="btn mini" id="tc_send">Отправить</button>
            </div>` : ''}
          </div>
        </div>

        <!-- ═══ STEP 3: Документы ═══ -->
        <div data-step="2">
          <div class="cr-f-section"><span class="cr-f-section__icon" style="color:var(--blue-l)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span><span>Документы</span></div>

          <div class="cr-f-field">
            <div class="cr-f-label">Загрузить файл</div>
            <div id="e_dropzone_w"></div>
          </div>

          <div style="display:flex; gap:8px; flex-wrap:wrap; margin:12px 0">
            <button class="btn ghost mini" id="btnAddDoc">📎 Файл</button>
            <button class="btn ghost mini" id="btnAddLink">🔗 Ссылку</button>
            ${(t && (isDirRole(user.role)||user.role==="ADMIN")) ? `<button class="btn ghost mini" id="btnHistory">📜 История</button>` : ``}
          </div>
          <div id="docsBox" style="display:flex; flex-direction:column; gap:8px">
            <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px">
              <button class="btn primary mini" id="downloadAllDocs">📥 Скачать все</button>
              <button class="btn ghost mini" id="copyAllDocs">📋 Копировать ссылки</button>
            </div>
            ${docsHtml}
          </div>

          ${(t && t.tender_status === 'Не подходит') ? `
          <div class="archive-info-row" style="margin-top:16px">
            <b>📁 Архив</b>
            <span>Причина: <b>${esc(t.archive_reason||'—')}</b></span>
            <span>Комментарий: ${esc(t.archive_comment||'—')}</span>
            <span>Кто: ${esc((byId.get(t.archived_by_user_id)||{}).name||'—')}</span>
            <span>Когда: ${esc(formatDateTime(t.archived_at))}</span>
          </div>` : ''}
        </div>

        <!-- ═══ FOOTER: actions ═══ -->
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:16px; padding-top:14px; border-top:1px solid var(--brd)">
          ${isNew ? `<button class="btn ghost" id="btnSaveDraft">💾 Черновик</button>` : ``}
          <div style="flex:1"></div>
          ${isNew ? `<button class="btn ghost" id="btnStepPrev" style="display:none">← Назад</button>` : ''}
          <button class="${isNew?'btn ghost':'btn primary'}" id="btnSave">${isNew?"Создать тендер":"Сохранить"}</button>
          ${isNew ? `<button class="btn gold" id="btnStepNext">Далее →</button>` : ''}
          ${!isNew ? '<button class="btn ghost" id="btnTenderActions">⚡ Действия</button>' : ''}
          ${(t && t.tender_status==='Новый' && (user.role==="TO"||user.role==="HEAD_TO")) ? `<button class="btn red" id="btnDist">На анализ</button>` : ``}
          ${(t && t.tender_status==='ТКП согласовано' && ((user.role==='PM' && Number(t.responsible_pm_id)===Number(user.id)) || user.role==='HEAD_PM' || user.role==='ADMIN')) ? `<button class="btn" id="btnCreateTkp" style="background:#c8a84e;color:#1a1000;font-weight:700">⚡ Создать ТКП</button>` : ``}
          ${(t && t.tender_status==='Готово к отправке КП' && ['TO','HEAD_TO','ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'].includes(user.role)) ? `<button class="btn" id="btnSentToClient" style="background:#17a2b8;color:#fff">📨 КП отправлено клиенту</button>` : ``}
          ${(t && t.tender_status==='КП отправлено' && ['TO','HEAD_TO','ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'].includes(user.role)) ? `
            <button class="btn" id="btnTenderWon" style="background:#2ecc71;color:#fff;font-weight:700">🏆 Выиграли</button>
            <button class="btn" id="btnTenderLost" style="background:#e74c3c;color:#fff;font-weight:700">❌ Проиграли</button>
            <button class="btn ghost" id="btnTenderCancel" style="color:var(--t3)">⊘ Тендер отменён</button>
          ` : ``}
          ${(t && t.tender_status !== 'Не подходит' && canArchive) ? `<button class="btn ghost mini" id="btnArchiveTender" style="color:var(--err-t)">🗑 Отсеять</button>` : ``}
          ${(t && t.tender_status === 'Не подходит' && canArchive) ? `<button class="btn ghost mini" id="btnUnarchiveTender" style="color:var(--ok-t)">♻️ Вернуть</button>` : ``}
        </div>
      `;

      showModal({ title: isNew ? "Новый тендер" : `Тендер #${t.id}`, html, icon: '📋', subtitle: isNew ? 'Шаг 1 из 3 · Основная информация' : `${esc((t&&t.customer_name)||'')} · ${esc((t&&t.tender_type)||'')}` });

      // ═══ STEPPER + STEP NAVIGATION ═══
      // BUG2 FIX: scope to modal body, not entire document
      const _modalBody = document.getElementById('modalBody');
      let _currentStep = 0;
      const _stepPanels = _modalBody ? Array.from(_modalBody.querySelectorAll('[data-step]')) : [];

      // BUG5 FIX: all steps start visible so CRSelect/CRDatePicker mount correctly.
      // We hide steps AFTER all mounts are done (see _initSteps() call below).

      function _showStep(n) {
        _currentStep = n;
        _stepPanels.forEach(p => { p.style.display = (Number(p.dataset.step) === n) ? '' : 'none'; });
        if (_stepperEl) _stepperEl._crSetStep(n);
        const subtitleEl = document.getElementById('modalSubtitle');
        const stepNames = ['Основная информация', 'Сроки и условия', 'Документы'];
        if (subtitleEl && isNew) subtitleEl.textContent = `Шаг ${n+1} из 3 · ${stepNames[n]}`;
        // Nav buttons
        const prevBtn = document.getElementById('btnStepPrev');
        const nextBtn = document.getElementById('btnStepNext');
        if (prevBtn) prevBtn.style.display = n > 0 ? '' : 'none';
        if (nextBtn) nextBtn.style.display = n < 2 ? '' : 'none';
        // BUG4 FIX: Save always visible. On step 3 it becomes primary, on 1-2 secondary.
        const saveBtn = document.getElementById('btnSave');
        if (saveBtn && isNew) {
          saveBtn.className = n === 2 ? 'btn primary' : 'btn ghost';
        }
      }

      // Mount stepper (new tenders only) — but DON'T hide steps yet
      let _stepperEl = null;
      const stepperW = document.getElementById('e_stepper');
      if (stepperW && typeof CrField !== 'undefined') {
        _stepperEl = CrField.stepper({
          steps: [{ label: 'Основное', id: 'main' }, { label: 'Условия', id: 'conditions' }, { label: 'Документы', id: 'docs' }],
          current: 0,
          onChange: (n) => _showStep(n)
        });
        stepperW.appendChild(_stepperEl);
      }

      // Step navigation buttons
      const _btnNext = document.getElementById('btnStepNext');
      const _btnPrev = document.getElementById('btnStepPrev');
      if (_btnNext) _btnNext.addEventListener('click', () => { if (_currentStep < 2) _showStep(_currentStep + 1); });
      if (_btnPrev) _btnPrev.addEventListener('click', () => { if (_currentStep > 0) _showStep(_currentStep - 1); });

      // DropZone: обычные файлы → /api/files/upload, архивы → upload-archive flow с preview
      const dzW = document.getElementById('e_dropzone_w');
      if (dzW && typeof CrField !== 'undefined') {
        const ARCHIVE_RX = /\.(zip|rar|7z|tar|tar\.gz|tgz|tar\.bz2|gz|bz2|jar)$/i;
        const dz = CrField.dropZone({
          accept: '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.zip,.rar,.7z,.tar,.gz,.bz2',
          text: 'Перетащите файл или архив (ZIP / RAR / 7Z). Архивы распакуются автоматически. Лимит 200 МБ.',
          onUpload: async (files) => {
            const file = files[files.length - 1];
            if (!file) return;
            let uploadId = tenderId;
            if (!uploadId) {
              uploadId = await saveTender(true);
              if (!uploadId) return;
            }
            if (file.size > 200 * 1024 * 1024) {
              toast('Ошибка', file.name + ' > 200 МБ. Разделите на части.', 'err');
              return;
            }

            // Архив → отдельный flow с прогрессом + preview
            if (ARCHIVE_RX.test(file.name)) {
              await uploadArchiveFlow(file, uploadId);
              return;
            }

            // Обычный файл — старый путь
            try {
              const formData = new FormData();
              formData.append('file', file);
              formData.append('tender_id', uploadId);
              formData.append('type', 'Документ');
              const _auth = await AsgardAuth.getAuth();
              await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', '/api/files/upload');
                xhr.setRequestHeader('Authorization', 'Bearer ' + _auth.token);
                xhr.timeout = 120000;
                xhr.onload = () => xhr.status < 300 ? resolve() : reject(new Error('Ошибка ' + xhr.status));
                xhr.onerror = () => reject(new Error('Сеть'));
                xhr.ontimeout = () => reject(new Error('Таймаут'));
                xhr.send(formData);
              });
              toast('Документ', file.name + ' загружен', 'ok');
            } catch (err) {
              toast('Ошибка', file.name + ': ' + err.message, 'err');
            }
          }
        });
        dzW.appendChild(dz);
        if (dz._crList && !dz._crList.parentElement) dzW.appendChild(dz._crList);
      }

      // ═══════════════════════════════════════════════════════════════
      // Архив-флоу: upload с прогрессом → preview-модалка → confirm
      // ═══════════════════════════════════════════════════════════════
      async function uploadArchiveFlow(file, tId) {
        // 1. Модалка прогресса загрузки
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:11500;display:flex;align-items:center;justify-content:center;padding:20px';
        overlay.innerHTML = `
          <div style="background:var(--bg2);border:1px solid var(--brd);border-radius:14px;padding:24px;max-width:520px;width:100%;box-shadow:0 12px 48px rgba(0,0,0,.5)">
            <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
              <div style="font-size:32px">📦</div>
              <div>
                <div style="font-weight:700;font-size:15px">${esc(file.name)}</div>
                <div class="help" style="font-size:12px">${(file.size/1024/1024).toFixed(1)} МБ · загрузка...</div>
              </div>
            </div>
            <div style="height:10px;background:var(--bg3);border-radius:5px;overflow:hidden;margin-bottom:8px">
              <div id="archProgBar" style="height:100%;background:linear-gradient(90deg,#5b8def,#c8a84e);width:0%;transition:width .2s"></div>
            </div>
            <div id="archProgText" class="help" style="font-size:12px">0% · подготовка...</div>
            <div id="archStage" class="help" style="font-size:11px;margin-top:8px;color:var(--t3)">⏳ Передача на сервер</div>
            <div style="margin-top:14px;text-align:right">
              <button class="btn ghost mini" id="archCancelBtn">Отмена</button>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);
        const closeOverlay = () => { try { document.body.removeChild(overlay); } catch(_){} };
        const setProgress = (pct, text, stage) => {
          const bar = overlay.querySelector('#archProgBar');
          const tx = overlay.querySelector('#archProgText');
          const st = overlay.querySelector('#archStage');
          if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
          if (tx && text) tx.textContent = text;
          if (st && stage) st.innerHTML = stage;
        };

        // Запрос
        const formData = new FormData();
        formData.append('archive', file);
        const _auth = await AsgardAuth.getAuth();
        let xhr;
        let cancelled = false;
        overlay.querySelector('#archCancelBtn').onclick = () => {
          cancelled = true;
          try { xhr && xhr.abort(); } catch(_){}
          closeOverlay();
          toast('Загрузка', 'Отменена', 'warn');
        };

        let resp;
        try {
          resp = await new Promise((resolve, reject) => {
            xhr = new XMLHttpRequest();
            xhr.open('POST', `/api/tenders/${tId}/upload-archive`);
            xhr.setRequestHeader('Authorization', 'Bearer ' + _auth.token);
            xhr.timeout = 300000; // 5 минут
            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) {
                const pct = (e.loaded / e.total) * 100;
                setProgress(pct, pct.toFixed(0) + '% · ' + (e.loaded/1024/1024).toFixed(1) + ' / ' + (e.total/1024/1024).toFixed(1) + ' МБ', '⏳ Передача на сервер');
              }
            };
            xhr.upload.onload = () => setProgress(100, '100% · принято сервером', '⚙️ Распаковка архива...');
            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                try { resolve(JSON.parse(xhr.responseText)); }
                catch (e) { reject({ unparseable: true, status: xhr.status, body: xhr.responseText }); }
              } else {
                try { reject({ status: xhr.status, body: JSON.parse(xhr.responseText) }); }
                catch (e) { reject({ status: xhr.status, body: { error: { message: 'HTTP ' + xhr.status, hint: xhr.responseText.slice(0,200) } } }); }
              }
            };
            xhr.onerror = () => reject({ network: true });
            xhr.ontimeout = () => reject({ timeout: true });
            xhr.send(formData);
          });
        } catch (errResp) {
          if (cancelled) return;
          closeOverlay();
          let errObj = errResp.body && errResp.body.error;
          if (!errObj) {
            errObj = { code: 'NETWORK', message: errResp.network ? 'Не удалось связаться с сервером' : (errResp.timeout ? 'Таймаут — архив слишком большой или интернет медленный' : 'Неизвестная ошибка'), hint: '' };
          }
          // Иногда error приходит строкой (старые роуты)
          if (typeof errObj === 'string') errObj = { code: 'ERR', message: errObj, hint: '' };
          showArchiveError(errObj);
          return;
        }

        if (cancelled) return;
        closeOverlay();

        // 2. Preview модалка
        showArchivePreview(tId, resp);
      }

      function showArchiveError(errObj) {
        const code = errObj.code || 'ERR';
        const icons = { PASSWORD_PROTECTED:'🔒', CORRUPTED:'⚠️', UNSUPPORTED_FORMAT:'❓', EMPTY:'📭', EMPTY_FILE:'📭', TOO_MANY:'📚', BOMB:'💣', NO_TOOL:'🛠', TIMEOUT:'⏱', NOT_ARCHIVE:'📄', FILE_TOO_LARGE:'⚖️', UPLOAD_FAILED:'⬆️', IO_ERROR:'💾', NETWORK:'🌐' };
        const icon = icons[code] || '❌';
        const html = `
          <div style="background:rgba(231,76,60,.08);border-left:4px solid #e74c3c;padding:14px 18px;border-radius:8px;margin-bottom:14px">
            <div style="font-size:32px;margin-bottom:8px">${icon}</div>
            <div style="font-weight:700;font-size:15px;color:var(--err-t,#e74c3c);margin-bottom:6px">${esc(errObj.message || 'Ошибка')}</div>
            ${errObj.hint ? '<div class="help" style="font-size:13px;color:var(--t2);line-height:1.5">💡 ' + esc(errObj.hint) + '</div>' : ''}
            ${errObj.code ? '<div class="help" style="font-size:10px;margin-top:8px;color:var(--t3);font-family:monospace">CODE: ' + esc(errObj.code) + '</div>' : ''}
          </div>
          <div style="text-align:right;margin-top:14px">
            <button class="btn" id="archErrOk">Понятно</button>
          </div>
        `;
        AsgardUI.showModal({
          title: 'Не удалось обработать архив',
          icon: '📦',
          html,
          wide: false,
          onMount: () => {
            document.getElementById('archErrOk').onclick = () => AsgardUI.closeModal();
          }
        });
      }

      function showArchivePreview(tId, data) {
        const FT_ICON = { pdf:'📕', doc:'📘', xls:'📗', ppt:'📙', image:'🖼', drawing:'📐', text:'📄', archive:'📦', other:'📄' };
        const files = data.files || [];
        const totalSize = (data.total_size || 0);

        // Если все файлы — junk, заранее ничего не отмечаем
        const filesSorted = [...files].sort((a, b) => {
          if (a.isJunk !== b.isJunk) return a.isJunk ? 1 : -1;
          return a.relPath.localeCompare(b.relPath, 'ru');
        });

        const rowsHtml = filesSorted.map(f => {
          const ic = FT_ICON[f.type] || FT_ICON.other;
          const sizeKb = (f.size / 1024).toFixed(f.size > 1024*1024 ? 1 : 0);
          const sizeStr = f.size > 1024*1024 ? ((f.size/1024/1024).toFixed(1) + ' МБ') : (sizeKb + ' КБ');
          return `
            <label class="arch-row" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid var(--brd);cursor:pointer;${f.isJunk?'opacity:.55;background:rgba(255,255,255,.02)':''}">
              <input type="checkbox" class="arch-cb" data-idx="${f.idx}" ${f.isJunk?'':'checked'} style="width:auto;flex-shrink:0"/>
              <span style="font-size:18px;flex-shrink:0">${ic}</span>
              <span style="flex:1;min-width:0;font-size:13px;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(f.relPath)}">${esc(f.relPath)}</span>
              <span style="font-size:11px;color:var(--t3);flex-shrink:0">${sizeStr}</span>
              ${f.isJunk ? '<span style="font-size:10px;color:var(--t3);background:var(--bg3);padding:1px 6px;border-radius:4px" title="Системный файл / мусор">junk</span>' : ''}
            </label>
          `;
        }).join('');

        const html = `
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
            <div style="font-size:28px">📦</div>
            <div style="flex:1">
              <div style="font-weight:700;font-size:15px">${esc(data.archive_name)}</div>
              <div class="help" style="font-size:12px">${(data.archive_size/1024/1024).toFixed(1)} МБ · ${(data.archive_type||'').toUpperCase()} · распаковано <b>${files.length}</b> файлов (${(totalSize/1024/1024).toFixed(1)} МБ)</div>
            </div>
          </div>

          <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
            <button class="btn ghost mini" id="archSelAll">Выбрать все</button>
            <button class="btn ghost mini" id="archSelNone">Снять все</button>
            <button class="btn ghost mini" id="archSelNoJunk">Без junk</button>
            <div style="flex:1"></div>
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--t2);cursor:pointer">
              <input type="checkbox" id="archInclArchive" style="width:auto"/>
              Прикрепить и сам архив
            </label>
          </div>

          <div style="border:1px solid var(--brd);border-radius:8px;max-height:50vh;overflow-y:auto">
            ${rowsHtml || '<div class="help" style="padding:20px;text-align:center">Архив пустой</div>'}
          </div>

          <div id="archCounter" class="help" style="font-size:12px;margin-top:10px"></div>

          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
            <button class="btn ghost" id="archPrevCancel">Отмена</button>
            <button class="btn" id="archPrevOk" style="background:var(--ok-t,#27ae60);color:#fff;font-weight:700">✅ Прикрепить выбранные</button>
          </div>
        `;

        AsgardUI.showModal({
          title: 'Содержимое архива — выберите файлы',
          icon: '📋',
          html, wide: true,
          onMount: () => {
            const updCounter = () => {
              const checked = document.querySelectorAll('.arch-cb:checked').length;
              const total = files.length;
              const el = document.getElementById('archCounter');
              if (el) el.textContent = `Выбрано: ${checked} из ${total}`;
            };
            updCounter();
            document.querySelectorAll('.arch-cb').forEach(cb => cb.addEventListener('change', updCounter));
            document.getElementById('archSelAll').onclick = () => {
              document.querySelectorAll('.arch-cb').forEach(cb => cb.checked = true);
              updCounter();
            };
            document.getElementById('archSelNone').onclick = () => {
              document.querySelectorAll('.arch-cb').forEach(cb => cb.checked = false);
              updCounter();
            };
            document.getElementById('archSelNoJunk').onclick = () => {
              filesSorted.forEach(f => {
                const cb = document.querySelector(`.arch-cb[data-idx="${f.idx}"]`);
                if (cb) cb.checked = !f.isJunk;
              });
              updCounter();
            };

            document.getElementById('archPrevCancel').onclick = async () => {
              try {
                const _auth = await AsgardAuth.getAuth();
                await fetch(`/api/tenders/${tId}/archive/${data.session_id}/cancel`, {
                  method: 'POST',
                  headers: { 'Authorization': 'Bearer ' + _auth.token }
                });
              } catch (_) {}
              AsgardUI.closeModal();
              toast('Архив', 'Загрузка отменена', 'warn');
            };

            document.getElementById('archPrevOk').onclick = async () => {
              const selected = Array.from(document.querySelectorAll('.arch-cb:checked')).map(cb => Number(cb.dataset.idx));
              if (selected.length === 0) { toast('Архив', 'Не выбрано ни одного файла', 'warn'); return; }
              const includeArchive = document.getElementById('archInclArchive').checked;
              const btn = document.getElementById('archPrevOk');
              btn.disabled = true;
              btn.textContent = '⏳ Прикрепляю...';
              try {
                const _auth = await AsgardAuth.getAuth();
                const r = await fetch(`/api/tenders/${tId}/archive/${data.session_id}/confirm`, {
                  method: 'POST',
                  headers: { 'Authorization': 'Bearer ' + _auth.token, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ selected_indices: selected, include_archive_too: includeArchive })
                });
                const result = await r.json();
                if (!r.ok) {
                  toast('Архив', (result.error && result.error.message) || result.error || 'Ошибка', 'err');
                  btn.disabled = false; btn.textContent = '✅ Прикрепить выбранные';
                  return;
                }
                AsgardUI.closeModal();
                toast('Архив', `Прикреплено ${result.attached} файлов из архива`, 'ok');
                // Перерисовать карточку тендера чтобы документы появились
                if (typeof openTenderEditor === 'function') openTenderEditor(tId);
              } catch (e) {
                toast('Архив', 'Ошибка сети: ' + e.message, 'err');
                btn.disabled = false; btn.textContent = '✅ Прикрепить выбранные';
              }
            };
          }
        });
      }

      /* Mount CRSelect for editor fields */
      const _eTypeDis = !full;
      const _ePmDis = (user.role==="TO") || !full;
      const _eStatusDis = !full || isNew;
      // Tender type as CrField.chips (WOW visual) instead of CRSelect
      _typeChipsEl = null;
      if (typeof CrField !== 'undefined' && !_eTypeDis) {
        _typeChipsEl = CrField.chips({ options: TENDER_TYPES.map(tp => ({ value: tp, label: tp })), selected: (t&&t.tender_type)||(isNew?'Тендер':''), onChange: (v) => applyTypeRules(v) });
        $('#e_type_w')?.appendChild(_typeChipsEl);
      } else {
        $('#e_type_w')?.appendChild(CRSelect.create({ id: 'e_type', options: TENDER_TYPES.map(tp => ({ value: tp, label: tp })), value: (t&&t.tender_type)||(isNew?'Тендер':''), disabled: _eTypeDis, dropdownClass: 'z-modal', onChange: (v) => applyTypeRules(v) }));
      }
      // PM: PersonPicker card with CRSelect dropdown behind it
      // BUG3+6 FIX: use CRSelect onChange callback instead of setInterval
      const _pmWrap = $('#e_pm_w');
      let _pmPicker = null;
      if (_pmWrap) {
        const _selPm = pms.find(p => t && p.id === t.responsible_pm_id);

        // onChange handler: update PersonPicker when CRSelect value changes
        const _onPmChange = (val) => {
          const pm = pms.find(p => String(p.id) === val);
          if (pm && _pmPicker) {
            _pmPicker._crUpdate({ name: pm.name, role: 'Руководитель проекта' });
            _pmPicker.style.display = '';
            _pmSelectWrap.style.display = 'none';
          }
        };

        const _pmSelectWrap = CRSelect.create({ id: 'e_pm', placeholder: '— выбрать —', options: pms.map(p => ({ value: String(p.id), label: p.name })), value: String((t&&t.responsible_pm_id)||''), disabled: _ePmDis, searchable: true, dropdownClass: 'z-modal', onChange: _onPmChange });

        if (typeof CrField !== 'undefined' && _selPm && !_ePmDis) {
          _pmPicker = CrField.personPicker({
            name: _selPm.name,
            role: 'Руководитель проекта',
            color: 'linear-gradient(135deg, var(--gold), var(--gold-h))',
            onChange: () => {
              _pmSelectWrap.style.display = '';
              _pmPicker.style.display = 'none';
            }
          });
          _pmWrap.appendChild(_pmPicker);
          _pmSelectWrap.style.display = 'none';
          _pmWrap.appendChild(_pmSelectWrap);
        } else {
          _pmWrap.appendChild(_pmSelectWrap);
        }
      }
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
      $('#e_ws_w')?.appendChild(CRDatePicker.create({ id:'e_ws', value:(t&&t.work_start_plan)||'', placeholder:'Выберите дату', disabled:!full, clearable:true, dropdownClass:'z-modal' }));
      $('#e_we_w')?.appendChild(CRDatePicker.create({ id:'e_we', value:(t&&t.work_end_plan)||'', placeholder:'Выберите дату', disabled:!full, clearable:true, dropdownClass:'z-modal' }));
      $('#e_deadline_w')?.appendChild(CRDatePicker.create({ id:'e_docs_deadline', value:(t&&t.docs_deadline)||'', placeholder:'Выберите дату', disabled:!(full||limited), clearable:true, dropdownClass:'z-modal' }));

      // Авторасчёт НДС: ставка из настроек
      const _vatSetting = await AsgardDB.get('settings', 'vat_default_pct');
      const _vatPct = _vatSetting ? (parseFloat(_vatSetting.value_json) || 20) : 20;
      const _vatMul = 1 + _vatPct / 100;
      const ePriceEl = document.getElementById('e_price');
      const ePriceVatEl = document.getElementById('e_price_vat');
      if (ePriceEl && ePriceVatEl) {
        ePriceEl.addEventListener('input', () => {
          const v = Number(ePriceEl.value.replace(/\s/g,'').replace(',','.'));
          ePriceVatEl.value = v > 0 ? Math.round(v * _vatMul * 100) / 100 : '';
        });
        ePriceVatEl.addEventListener('input', () => {
          const v = Number(ePriceVatEl.value.replace(/\s/g,'').replace(',','.'));
          ePriceEl.value = v > 0 ? Math.round(v / _vatMul * 100) / 100 : '';
        });
      }
      // Авторасчёт цены подачи с НДС
      const eSubPriceEl = document.getElementById('e_sub_price');
      const eSubPriceVatEl = document.getElementById('e_sub_price_vat');
      if (eSubPriceEl && eSubPriceVatEl) {
        eSubPriceEl.addEventListener('input', () => {
          const v = Number(eSubPriceEl.value.replace(/\s/g,'').replace(',','.'));
          eSubPriceVatEl.value = v > 0 ? Math.round(v * _vatMul * 100) / 100 : '';
        });
      }

      // BUG5 FIX: ALL mounts done. Now hide steps for wizard mode.
      // Components mounted while visible → no layout bugs.
      if (isNew) {
        _showStep(0);
      } else {
        _stepPanels.forEach(p => { p.style.display = ''; });
      }

      /* ── 3.2: Dynamic required fields by procedure type ── */
      function applyTypeRules(tType) {
        const deadlineRow = document.getElementById('e_deadline_row');
        const urlLabel = document.getElementById('e_url')?.closest('.cr-f-field')?.querySelector('.cr-f-label') || document.querySelector('label[for="e_url"]') || document.getElementById('e_url')?.closest('div')?.querySelector('label');
        const deadlineLabel = deadlineRow?.querySelector('.cr-f-label') || deadlineRow?.querySelector('label');
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

      // ═══════════════════════════════════════════════════════════════
      // Единое поле «Заказчик / ИНН» — локальная база + ДаДата (ЕГРЮЛ)
      // Selected INN хранится в замыкании _selectedInn, читается в saveTender()
      // ═══════════════════════════════════════════════════════════════
      const normInn = (v)=>String(v||"").replace(/\D/g, "");
      const custList = await AsgardDB.all("customers");
      const custWrap = document.getElementById("cr-customer-wrap");
      const innWarn = document.getElementById("innWarn");
      const innCreateRow = document.getElementById("innCreateRow");
      const btnCreateCustomer = document.getElementById("btnCreateCustomer");
      const byInn = new Map((custList||[]).map(c=>[String(c.inn||""), c]));

      // Замыкание для текущего выбранного ИНН (приоритет: локальный → ДаДата → ручной ввод цифр)
      let _selectedInn = (t && t.customer_inn) ? String(t.customer_inn) : "";
      let _selectedFromDadata = null; // {inn, name, kpp, address, full_name} если выбрали из ДаДата
      // Экспонируем для saveTender и для восстановления из черновика
      window.__tenderSelectedInnGetter = () => _selectedInn;
      window.__tenderSelectedDadataGetter = () => _selectedFromDadata;
      window.__tenderSelectedInnSetter = (v) => { _selectedInn = String(v||""); updateInnUi(); };

      if(custWrap){
        custWrap.appendChild(CRAutocomplete.create({
          id: 'e_customer',
          value: (t&&t.customer_name)||"",
          placeholder: 'Название организации или ИНН (10/12 цифр)',
          minChars: 2,
          fullWidth: true,
          inputClass: 'inp',
          disabled: !full,
          fetchOptions: async (q) => {
            const ql = q.toLowerCase().trim();
            const isDigits = /^\d+$/.test(q);
            // 1) Локальная база
            const local = (custList||[]).filter(c => {
              const n = String(c.name||c.full_name||"").toLowerCase();
              const inn = String(c.inn||"");
              return isDigits ? inn.includes(q) : n.includes(ql);
            }).slice(0,10).map(c => ({
              value: c.name||c.full_name||"",
              label: c.name||c.full_name||"",
              sublabel: 'ИНН ' + (c.inn||"—") + ' · в базе',
              inn: c.inn||"",
              _source: 'local',
              _raw: c
            }));
            // 2) Если локально мало — спрашиваем ДаДата (suggest или lookup)
            let dadata = [];
            try {
              const token = localStorage.getItem('asgard_token');
              if (isDigits && (q.length === 10 || q.length === 12)) {
                // Точный поиск по ИНН
                const r = await fetch('/api/customers/lookup/' + q, { headers: { Authorization: 'Bearer ' + token } });
                if (r.ok) {
                  const d = await r.json();
                  if (d.suggestion && d.suggestion.name) {
                    dadata.push({
                      value: d.suggestion.name,
                      label: '🌐 ' + d.suggestion.name,
                      sublabel: 'ИНН ' + (d.suggestion.inn||q) + ' · ДаДата (ЕГРЮЛ)',
                      inn: d.suggestion.inn||q,
                      _source: 'dadata',
                      _raw: d.suggestion
                    });
                  }
                }
              } else if (!isDigits && local.length < 5 && q.length >= 3) {
                // Suggest по названию
                const r = await fetch('/api/customers/suggest?q=' + encodeURIComponent(q) + '&type=party', {
                  headers: { Authorization: 'Bearer ' + token }
                });
                if (r.ok) {
                  const d = await r.json();
                  dadata = (d.suggestions||[]).slice(0, 5).map(s => ({
                    value: s.name||'',
                    label: '🌐 ' + (s.name||''),
                    sublabel: 'ИНН ' + (s.inn||'') + ' · ДаДата (ЕГРЮЛ)',
                    inn: s.inn||'',
                    _source: 'dadata',
                    _raw: s
                  }));
                }
              }
            } catch(_) { /* Dadata недоступна → не блокируем */ }
            return [...local, ...dadata];
          },
          onSelect: (item) => {
            if (!item) return;
            _selectedInn = item.inn || "";
            if (item._source === 'dadata') {
              _selectedFromDadata = item._raw || null;
            } else {
              _selectedFromDadata = null;
            }
            updateInnUi();
            updateCustomerScore(item.value || item.label || "");
          }
        }));
      }

      const nameInput = CRAutocomplete.getInput("e_customer");

      function findByNameExact(name){
        const n = String(name||"").trim().toLowerCase();
        if(!n) return null;
        const hits = (custList||[]).filter(c=>String(c.name||c.full_name||"").trim().toLowerCase()===n);
        return hits.length===1 ? hits[0] : null;
      }
      function updateInnUi(){
        // Если выбран ДаДата-вариант или ИНН не в локальной базе → показать кнопку создания
        const inn = normInn(_selectedInn);
        const looksValid = (inn.length===10 || inn.length===12);
        const existsLocally = looksValid ? byInn.has(inn) : false;
        const needCreate = (_selectedFromDadata && _selectedFromDadata.inn) || (looksValid && !existsLocally);
        if(needCreate){
          if(innWarn) innWarn.style.display="block";
          if(innCreateRow) innCreateRow.style.display="flex";
        }else{
          if(innWarn) innWarn.style.display="none";
          if(innCreateRow) innCreateRow.style.display="none";
        }
      }

      // Светофор клиента
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
      if(t && t.customer_name){ updateCustomerScore(t.customer_name); }

      // Кнопка «Создать контрагента» — открывает openNewCustomerModal БЕЗ закрытия модалки тендера.
      // После создания подставляет в поле и в _selectedInn.
      if (btnCreateCustomer) {
        btnCreateCustomer.addEventListener('click', () => {
          if (!window.AsgardContractsPage || !AsgardContractsPage.openNewCustomerModal) {
            toast('Контрагент', 'Модуль договоров не загружен. Перейдите в раздел «Заказчики».', 'err');
            return;
          }
          AsgardContractsPage.openNewCustomerModal(async (created) => {
            if (!created || !created.inn) return;
            _selectedInn = String(created.inn);
            _selectedFromDadata = null;
            // Перезагружаем custList чтобы byInn увидел нового клиента (фон)
            try {
              const fresh = await AsgardDB.all("customers");
              const freshById = new Map(fresh.map(c=>[String(c.inn||""), c]));
              freshById.forEach((v,k) => byInn.set(k,v));
            } catch(_) {}
            if (nameInput) {
              nameInput.value = created.short_name || created.name || created.full_name || '';
              CRAutocomplete.setValue('e_customer', nameInput.value);
            }
            updateInnUi();
            updateCustomerScore(nameInput?.value || '');
            toast('Контрагент', 'Создан и подставлен в тендер', 'ok');
          });
        });
      }

      if (nameInput) {
        // Очистка поля сбрасывает выбранный ИНН (чтобы не сохранился старый)
        nameInput.addEventListener('input', () => {
          if (!nameInput.value || nameInput.value.trim().length < 2) {
            _selectedInn = "";
            _selectedFromDadata = null;
            updateInnUi();
          }
        });
        nameInput.addEventListener('change', () => {
          const hit = findByNameExact(nameInput.value);
          if (hit && !_selectedInn) { _selectedInn = String(hit.inn||""); }
          updateInnUi();
          updateCustomerScore(nameInput.value);
        });
        let scoreTimeout;
        nameInput.addEventListener('input', () => {
          clearTimeout(scoreTimeout);
          scoreTimeout = setTimeout(() => updateCustomerScore(nameInput.value), 500);
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
            if (file.size > 50 * 1024 * 1024) { toast("Ошибка", "Файл больше 50 МБ", "err"); return; }
            const formData = new FormData();
            formData.append('file', file);
            formData.append('tender_id', uploadId);
            formData.append('type', document.getElementById("d_type").value.trim() || "Документ");
            const auth = await AsgardAuth.getAuth();

            // XHR с progress bar
            const btn = document.getElementById('btnUploadFile');
            const origText = btn ? btn.textContent : '';
            await new Promise((resolve, reject) => {
              const xhr = new XMLHttpRequest();
              xhr.open('POST', '/api/files/upload');
              xhr.setRequestHeader('Authorization', 'Bearer ' + auth.token);
              xhr.timeout = 60000;
              xhr.upload.onprogress = (e) => {
                if (e.lengthComputable && btn) {
                  const pct = Math.round(e.loaded / e.total * 100);
                  btn.textContent = pct + '%';
                }
              };
              xhr.onload = () => { if (btn) btn.textContent = origText; xhr.status < 300 ? resolve() : reject(new Error('Ошибка ' + xhr.status)); };
              xhr.onerror = () => { if (btn) btn.textContent = origText; reject(new Error('Сеть недоступна')); };
              xhr.ontimeout = () => { if (btn) btn.textContent = origText; reject(new Error('Таймаут (60 сек)')); };
              xhr.send(formData);
            });

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
          let uploaded = 0;
          for (const file of files) {
            if (file.size > 50 * 1024 * 1024) { toast("Ошибка", file.name + " > 50 МБ", "err"); continue; }
            try {
              const formData = new FormData();
              formData.append('file', file);
              formData.append('tender_id', uploadId);
              formData.append('type', 'Документ');
              docsBox.textContent = 'Загрузка ' + file.name + '...';
              await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', '/api/files/upload');
                xhr.setRequestHeader('Authorization', 'Bearer ' + auth.token);
                xhr.timeout = 60000;
                xhr.upload.onprogress = (e) => { if (e.lengthComputable) docsBox.textContent = file.name + ' ' + Math.round(e.loaded/e.total*100) + '%'; };
                xhr.onload = () => xhr.status < 300 ? resolve() : reject(new Error('Ошибка ' + xhr.status));
                xhr.onerror = () => reject(new Error('Сеть'));
                xhr.ontimeout = () => reject(new Error('Таймаут'));
                xhr.send(formData);
              });
              uploaded++;
            } catch (err) {
              toast("Ошибка", file.name + ": " + err.message, "err");
            }
          }
          if (uploaded) toast("Документы", uploaded + " файл(ов) загружено");
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
          if(isDirRole(user.role) || user.role === "ADMIN" || user.role === "HEAD_TO"){
            actions.push({ section: 'Управление' });

            // Отсеять (только если не архив)
            if(t.tender_status !== 'Не подходит'){
              actions.push({
                icon: '🗑', label: 'Отсеять',
                desc: 'Перевести тендер в архив с указанием причины',
                onClick: () => openArchiveModal(tenderId)
              });
            }

            // Вернуть из архива
            if(t.tender_status === 'Не подходит'){
              actions.push({
                icon: '♻️', label: 'Вернуть из архива',
                desc: 'Вернуть тендер в статус «Новый»',
                onClick: () => openUnarchiveModal(tenderId)
              });
            }

            // Сменить автора
            actions.push({
              icon: '👤', label: 'Сменить автора',
              desc: 'Сменить автора (создателя) тендера',
              onClick: () => openChangeAuthorModal(tenderId)
            });

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
        // Берём ИНН из единого поля «Заказчик / ИНН» (выбранный через autocomplete/ДаДата),
        // или, если в поле «Заказчик» юзер просто ввёл цифры — парсим их как ИНН.
        let innRaw = (typeof window.__tenderSelectedInnGetter === 'function')
          ? window.__tenderSelectedInnGetter() : "";
        const customerRaw = (CRAutocomplete.getValue("e_customer") || "").trim();
        if (!innRaw && /^\d{10,12}$/.test(customerRaw)) innRaw = customerRaw;
        const customer_inn = String(innRaw||"").replace(/\D/g, "");
        let customer=(CRAutocomplete.getValue("e_customer") || "").trim();
        const title=document.getElementById("e_title").value.trim();
        const tenderType = ((_typeChipsEl && _typeChipsEl._crGetValue) ? (_typeChipsEl._crGetValue() || 'Тендер') : (CRSelect.getValue('e_type') || "Тендер")).trim();
        const pmId = Number(CRSelect.getValue('e_pm')||0) || null;
        const status = CRSelect.getValue('e_status') || '';
        const priceRaw=document.getElementById("e_price").value.trim();
        const price = priceRaw ? Number(priceRaw.replace(/\s/g,"").replace(",", ".")) : null;
        const priceVatRaw=document.getElementById("e_price_vat")?.value?.trim()||"";
        const priceVat = priceVatRaw ? Number(priceVatRaw.replace(/\s/g,"").replace(",", ".")) : (price ? Math.round(price * _vatMul * 100) / 100 : null);
        const subPriceRaw=document.getElementById("e_sub_price")?.value?.trim()||"";
        const subPrice = (subPriceRaw && (user.role==='ADMIN'||isDirRole(user.role))) ? Number(subPriceRaw.replace(/\s/g,"").replace(",",".")) : undefined;
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
            tender_price: price, tender_price_with_vat: priceVat,
            work_start_plan: ws, work_end_plan: we,
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
            tender_price: price, tender_price_with_vat: priceVat,
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
            cur.tender_price=price; cur.tender_price_with_vat=priceVat;
            if(subPrice !== undefined){ cur.submission_price = subPrice; cur.submission_price_with_vat = subPrice ? Math.round(subPrice*_vatMul*100)/100 : null; }
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
              <div style="background:var(--bg2);padding:24px;border-radius:12px;max-width:420px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.3)">
                <div style="font-weight:600;font-size:16px;margin-bottom:12px">Не заполнены обязательные поля</div>
                <div style="margin-bottom:16px;color:var(--t2)">${esc(missingFields.join(', '))}</div>
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

          const btnEl = document.getElementById("btnDist");
          if(btnEl) btnEl.disabled = true;
          try {
            const token = localStorage.getItem('asgard_token');
            const resp = await fetch(`/api/tenders/${id}`, {
              method: 'PUT',
              headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
              body: JSON.stringify({ tender_status: 'На анализе' })
            });
            const data = await resp.json();
            if(!resp.ok){ toast("Анализ", data.error || "Ошибка", "err"); if(btnEl) btnEl.disabled=false; return; }

            // Уведомляем HEAD_TO
            try{
              const allU = await getUsers();
              const headTo = (allU||[]).filter(u=>u.role==='HEAD_TO');
              for(const h of headTo){
                await notify(h.id, "Тендер на анализ", `${data.tender?.customer_name||""} — ${data.tender?.tender_title||""}\nДедлайн: ${data.tender?.docs_deadline||"—"}`, "#/tenders");
              }
            }catch(e){}

            toast("Анализ","Тендер отправлен на анализ Рук. ТО","ok");
            await render({layout, title});
            openTenderEditor(id);
          } catch(e) {
            toast("Анализ","Ошибка сети","err");
            if(btnEl) btnEl.disabled = false;
          }
        });
      }

      // btnHandoff removed — Director no longer sends to estimate directly (HEAD_TO does via distPanel)

      // Кнопка "Создать ТКП" для PM (после согласования директором)
      if(document.getElementById("btnCreateTkp")){
        document.getElementById("btnCreateTkp").addEventListener("click", function(){
          if(!window.AsgardTkpPage || !AsgardTkpPage.openNew){
            toast('ТКП','Модуль ТКП не загружен. Перейдите в раздел ТКП.','err'); return;
          }
          AsgardTkpPage.openNew({
            tender_id: tenderId,
            customer_name: (t&&t.customer_name) || '',
            customer_inn: (t&&t.customer_inn) || '',
            subject: t ? ('ТКП — ' + (t.tender_title || t.customer_name || '')) : ''
          });
        });
      }

      // «КП отправлено клиенту» — quick-action button
      if(document.getElementById("btnSentToClient")){
        document.getElementById("btnSentToClient").addEventListener("click", async ()=>{
          const id = tenderId;
          const cur = await AsgardDB.get("tenders", id);
          if(!cur || cur.tender_status !== 'Готово к отправке КП'){ toast("Статус","Кнопка доступна только при статусе «Готово к отправке КП»","err"); return; }
          cur.tender_status = "КП отправлено";
          await AsgardDB.put("tenders", cur);
          await audit(user.id,"tender",id,"sent_to_client",{});
          toast("Тендер","Статус изменён на «КП отправлено»");
          if(window.AsgardTkpFollowup){ try { await AsgardTkpFollowup.activateFollowup(cur); } catch(e){} }
          await render({layout, title});
          openTenderEditor(id);
        });
      }

      // ═══════════════════════════════════════════════════════════════
      // 3 кнопки финала: Выиграли / Проиграли / Отменён (для «КП отправлено»)
      // ═══════════════════════════════════════════════════════════════
      if (document.getElementById("btnTenderWon")) {
        document.getElementById("btnTenderWon").addEventListener("click", () => openWonModal(tenderId, t));
      }
      if (document.getElementById("btnTenderLost")) {
        document.getElementById("btnTenderLost").addEventListener("click", () => openLostModal(tenderId, t));
      }
      if (document.getElementById("btnTenderCancel")) {
        document.getElementById("btnTenderCancel").addEventListener("click", () => openCancelModal(tenderId, t));
      }

      // Кнопка "Отсеять" в карточке
      if(document.getElementById("btnArchiveTender")){
        document.getElementById("btnArchiveTender").addEventListener("click", () => openArchiveModal(tenderId));
      }

      // Кнопка "Вернуть" из архива в карточке
      if(document.getElementById("btnUnarchiveTender")){
        document.getElementById("btnUnarchiveTender").addEventListener("click", () => openUnarchiveModal(tenderId));
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // Модалка «🏆 Выиграли тендер» — фиксируем финальную цену контракта.
    // После: HEAD_TO в win-panel сверху страницы назначит РП на работы.
    // ═══════════════════════════════════════════════════════════════
    async function openWonModal(tid, tender) {
      const vatSetting = await AsgardDB.get('settings', 'vat_default_pct');
      const vatPct = vatSetting ? (parseFloat(vatSetting.value_json) || 22) : 22;
      const vatMul = 1 + vatPct / 100;

      const initNoVat = tender?.submission_price || 0;
      const initWithVat = tender?.submission_price_with_vat || (initNoVat ? Math.round(initNoVat * vatMul * 100) / 100 : 0);

      const html = `
        <div class="help" style="margin-bottom:14px;background:rgba(46,204,113,.08);padding:10px 14px;border-radius:8px;border-left:3px solid #2ecc71">
          🏆 <b>Поздравляем с победой!</b><br/>
          После сохранения тендер появится у <b>Рук. ТО</b> в блоке «Выигранные» —
          там назначается РП на выполнение работ (можно того же, кто считал, или другого).
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="cr-f-field">
            <div class="cr-f-label">Цена подачи без НДС, ₽ <span class="cr-f-label__req">*</span></div>
            <input id="won_price_no_vat" class="inp cr-f-mono" type="number" min="0" step="0.01" value="${initNoVat||''}" placeholder="0"/>
          </div>
          <div class="cr-f-field">
            <div class="cr-f-label">Цена подачи с НДС ${vatPct}%, ₽</div>
            <input id="won_price_with_vat" class="inp cr-f-mono" type="number" min="0" step="0.01" value="${initWithVat||''}" placeholder="0"/>
          </div>
        </div>
        <div class="cr-f-help" style="margin-top:4px">Из «Цена подачи». Поправьте если победили по другой сумме (торги/переторжка). НМЦ не изменится.</div>
        <div class="cr-f-field" style="margin-top:12px">
          <div class="cr-f-label">Комментарий (необязательно)</div>
          <textarea id="won_comment" class="inp" rows="2" placeholder="Кратко: торги/переторжка/особые условия..."></textarea>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
          <button class="btn ghost" id="wonCancel">Отмена</button>
          <button class="btn" id="wonOk" style="background:#2ecc71;color:#fff;font-weight:700">🏆 Подтвердить победу</button>
        </div>
      `;
      AsgardUI.showModal({ title: 'Выиграли тендер', icon: '🏆', html, wide: false, onMount: () => {
        const noVatEl = document.getElementById('won_price_no_vat');
        const withVatEl = document.getElementById('won_price_with_vat');
        noVatEl.addEventListener('input', () => {
          const v = Number(noVatEl.value);
          withVatEl.value = v > 0 ? Math.round(v * vatMul * 100) / 100 : '';
        });
        withVatEl.addEventListener('input', () => {
          const v = Number(withVatEl.value);
          noVatEl.value = v > 0 ? Math.round(v / vatMul * 100) / 100 : '';
        });
        document.getElementById('wonCancel').onclick = () => AsgardUI.closeModal();
        document.getElementById('wonOk').onclick = async () => {
          const priceNoVat = Number(noVatEl.value || 0);
          const priceWithVat = Number(withVatEl.value || 0);
          if (!priceNoVat && !priceWithVat) { toast('Проверка', 'Укажите цену подачи', 'err'); return; }
          const finalNoVat = priceNoVat || Math.round(priceWithVat / vatMul * 100) / 100;
          const finalWithVat = priceWithVat || Math.round(priceNoVat * vatMul * 100) / 100;
          const comment = document.getElementById('won_comment').value.trim();
          const btn = document.getElementById('wonOk'); btn.disabled = true;
          try {
            const token = localStorage.getItem('asgard_token');
            const resp = await fetch(`/api/tenders/${tid}/win`, {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
              body: JSON.stringify({ submission_price: finalNoVat, submission_price_with_vat: finalWithVat, win_comment: comment })
            });
            const data = await resp.json();
            if (!resp.ok) { toast('Победа', data.error || 'Ошибка', 'err'); btn.disabled = false; return; }
            toast('🏆 Победа', 'Тендер выигран. Рук. ТО назначит РП на работы.', 'ok', 6000);
            AsgardUI.closeModal();
            await render({ layout, title });
          } catch(e) {
            toast('Победа', 'Ошибка сети: ' + e.message, 'err');
            btn.disabled = false;
          }
        };
      }});
    }

    // ═══════════════════════════════════════════════════════════════
    // Модалка «❌ Проиграли» — причина + сопроводительное письмо
    // ═══════════════════════════════════════════════════════════════
    async function openLostModal(tid, tender) {
      const reasons = ['Цена выше конкурента', 'Сроки не подошли заказчику', 'Выбрали другого подрядчика',
                       'Не прошли квалификацию', 'Отказались от выполнения', 'Технические требования',
                       'Конкурент с админ. ресурсом', 'Другое'];
      const html = `
        <div class="help" style="margin-bottom:14px;background:rgba(231,76,60,.08);padding:10px 14px;border-radius:8px;border-left:3px solid #e74c3c">
          Зафиксируем причину для аналитики и сопроводительное письмо — это поможет команде сделать выводы.
        </div>
        <div class="cr-f-field">
          <div class="cr-f-label">Причина проигрыша <span class="cr-f-label__req">*</span></div>
          <div id="lost_reason_w"></div>
        </div>
        <div class="cr-f-field" style="margin-top:12px">
          <div class="cr-f-label">Кто выиграл (если известно)</div>
          <input id="lost_winner" class="inp" placeholder="Название организации-победителя"/>
        </div>
        <div class="cr-f-field" style="margin-top:12px">
          <div class="cr-f-label">Сопроводительное письмо — анализ для команды <span class="cr-f-label__req">*</span></div>
          <textarea id="lost_letter" class="inp" rows="5" placeholder="Что узнали, какие выводы, что учесть в следующий раз..."></textarea>
          <div class="cr-f-help">Это видят все — РП, директора, Рук. ТО. Помогает развивать компанию.</div>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
          <button class="btn ghost" id="lostCancel">Отмена</button>
          <button class="btn" id="lostOk" style="background:#e74c3c;color:#fff;font-weight:700">❌ Зафиксировать поражение</button>
        </div>
      `;
      AsgardUI.showModal({ title: 'Проиграли тендер', icon: '❌', html, wide: false, onMount: () => {
        const w = document.getElementById('lost_reason_w');
        w.appendChild(CRSelect.create({
          id: 'lost_reason',
          options: reasons.map(r => ({ value: r, label: r })),
          placeholder: '— выберите —',
          searchable: false
        }));
        document.getElementById('lostCancel').onclick = () => AsgardUI.closeModal();
        document.getElementById('lostOk').onclick = async () => {
          const reason = CRSelect.getValue('lost_reason') || '';
          const winner = document.getElementById('lost_winner').value.trim();
          const letter = document.getElementById('lost_letter').value.trim();
          if (!reason) { toast('Проверка', 'Выберите причину', 'err'); return; }
          if (!letter || letter.length < 20) { toast('Проверка', 'Сопроводительное письмо: минимум 20 символов', 'err'); return; }
          const btn = document.getElementById('lostOk'); btn.disabled = true;
          try {
            const token = localStorage.getItem('asgard_token');
            const resp = await fetch(`/api/tenders/${tid}/lose`, {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
              body: JSON.stringify({ reject_reason: reason, cover_letter: letter, winner_name: winner })
            });
            const data = await resp.json();
            if (!resp.ok) { toast('Проигрыш', data.error || 'Ошибка', 'err'); btn.disabled = false; return; }
            toast('Зафиксировано', 'Поражение и анализ сохранены.', 'ok');
            AsgardUI.closeModal();
            await render({ layout, title });
          } catch(e) {
            toast('Проигрыш', 'Ошибка сети: ' + e.message, 'err');
            btn.disabled = false;
          }
        };
      }});
    }

    // ═══════════════════════════════════════════════════════════════
    // Модалка «⊘ Тендер отменён» — только причина (заказчик отказался)
    // ═══════════════════════════════════════════════════════════════
    async function openCancelModal(tid, tender) {
      const html = `
        <div class="help" style="margin-bottom:14px">
          Заказчик отменил тендер. Опишите кратко обстоятельства.
        </div>
        <div class="cr-f-field">
          <div class="cr-f-label">Причина отмены <span class="cr-f-label__req">*</span></div>
          <textarea id="cancel_reason" class="inp" rows="4" placeholder="Заказчик переиграл закупку / нет финансирования / отложили на год..."></textarea>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
          <button class="btn ghost" id="cancelCancel">Назад</button>
          <button class="btn ghost" id="cancelOk" style="color:var(--err-t);border-color:var(--err-t)">⊘ Подтвердить отмену</button>
        </div>
      `;
      AsgardUI.showModal({ title: 'Тендер отменён', icon: '⊘', html, wide: false, onMount: () => {
        document.getElementById('cancelCancel').onclick = () => AsgardUI.closeModal();
        document.getElementById('cancelOk').onclick = async () => {
          const reason = document.getElementById('cancel_reason').value.trim();
          if (!reason || reason.length < 5) { toast('Проверка', 'Укажите причину (минимум 5 символов)', 'err'); return; }
          const btn = document.getElementById('cancelOk'); btn.disabled = true;
          try {
            const token = localStorage.getItem('asgard_token');
            const resp = await fetch(`/api/tenders/${tid}/cancel`, {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
              body: JSON.stringify({ cancel_reason: reason })
            });
            const data = await resp.json();
            if (!resp.ok) { toast('Отмена', data.error || 'Ошибка', 'err'); btn.disabled = false; return; }
            toast('Сохранено', 'Тендер отменён и перенесён в архив.', 'ok');
            AsgardUI.closeModal();
            await render({ layout, title });
          } catch(e) {
            toast('Отмена', 'Ошибка сети: ' + e.message, 'err');
            btn.disabled = false;
          }
        };
      }});
    }

    // ═══════════════════════════════════════════════════════════════
    // Модалка "Отсеять тендер" (архивация)
    // ═══════════════════════════════════════════════════════════════
    async function openArchiveModal(tid){
      let archiveReasons = [];
      try {
        const token = localStorage.getItem('asgard_token');
        const resp = await fetch('/api/tenders/archive-reasons', { headers: { 'Authorization': 'Bearer ' + token } });
        if(resp.ok){
          const data = await resp.json();
          archiveReasons = data.reasons || data || [];
        }
      } catch(e){}
      // Fallback reasons if API not available
      if(!archiveReasons.length){
        archiveReasons = [
          'Не наш профиль','Слишком маленький объём','Слишком большой объём',
          'Невыгодные условия','Далеко от базы','Короткие сроки',
          'Нет ресурсов','Сложный доступ','Плохая репутация заказчика',
          'Конкурент уже выиграл','Торги отменены','Дубликат',
          'Тестовая закупка','Ошибочно внесён','Другое'
        ];
      }
      const reasonOpts = archiveReasons.map(r => {
        const val = typeof r === 'object' ? (r.value || r.name || r.label) : r;
        const lbl = typeof r === 'object' ? (r.label || r.name || r.value) : r;
        return { value: val, label: lbl };
      });

      const html = `
        <div class="help" style="margin-bottom:12px">Тендер будет переведён в статус «Не подходит» и перемещён в архив.</div>
        <div class="formrow">
          <div style="grid-column:1/-1">
            <label class="cr-required">Причина</label>
            <div id="archive_reason_w"></div>
          </div>
        </div>
        <div class="formrow">
          <div style="grid-column:1/-1">
            <label class="cr-required">Комментарий</label>
            <textarea id="archive_comment" rows="3" placeholder="Опишите причину отсева..."></textarea>
          </div>
        </div>
        <hr class="hr"/>
        <div style="display:flex;gap:10px">
          <button class="btn red" id="archive_confirm">Подтвердить</button>
          <button class="btn ghost" id="archive_cancel">Отмена</button>
        </div>
      `;
      showModal('Отсеять тендер', html);
      $('#archive_reason_w')?.appendChild(CRSelect.create({ id: 'archive_reason', placeholder: '— выберите причину —', options: reasonOpts, dropdownClass: 'z-modal' }));

      $('#archive_cancel')?.addEventListener('click', () => hideModal());
      $('#archive_confirm')?.addEventListener('click', async () => {
        const reason = CRSelect.getValue('archive_reason') || '';
        const comment = ($('#archive_comment')?.value || '').trim();
        if(!reason){ toast('Отсев','Выберите причину','err'); return; }
        if(!comment){ toast('Отсев','Укажите комментарий','err'); return; }

        try {
          const token = localStorage.getItem('asgard_token');
          const resp = await fetch('/api/tenders/' + tid + '/archive', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ reason, comment })
          });
          if(resp.ok){
            toast('Архив','Тендер отсеян','ok');
            hideModal();
            await render({layout, title});
          } else {
            const err = await resp.json().catch(()=>({}));
            toast('Ошибка', err.error || 'Не удалось отсеять','err');
          }
        } catch(e){
          toast('Ошибка', e.message || 'Сеть недоступна','err');
        }
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // Модалка "Вернуть из архива"
    // ═══════════════════════════════════════════════════════════════
    async function openUnarchiveModal(tid){
      const html = `
        <div class="help" style="margin-bottom:12px">Тендер будет возвращён в статус «Новый».</div>
        <div class="formrow">
          <div style="grid-column:1/-1">
            <label>Комментарий</label>
            <textarea id="unarchive_comment" rows="3" placeholder="Причина возврата (необязательно)"></textarea>
          </div>
        </div>
        <hr class="hr"/>
        <div style="display:flex;gap:10px">
          <button class="btn" id="unarchive_confirm" style="background:var(--ok);color:#fff">Вернуть</button>
          <button class="btn ghost" id="unarchive_cancel">Отмена</button>
        </div>
      `;
      showModal('Вернуть из архива', html);

      $('#unarchive_cancel')?.addEventListener('click', () => hideModal());
      $('#unarchive_confirm')?.addEventListener('click', async () => {
        const comment = ($('#unarchive_comment')?.value || '').trim();
        try {
          const token = localStorage.getItem('asgard_token');
          const resp = await fetch('/api/tenders/' + tid + '/unarchive', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ comment })
          });
          if(resp.ok){
            toast('Архив','Тендер возвращён','ok');
            hideModal();
            await render({layout, title});
          } else {
            const err = await resp.json().catch(()=>({}));
            toast('Ошибка', err.error || 'Не удалось вернуть','err');
          }
        } catch(e){
          toast('Ошибка', e.message || 'Сеть недоступна','err');
        }
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // Модалка "Сменить автора тендера"
    // ═══════════════════════════════════════════════════════════════
    async function openChangeAuthorModal(tid){
      const toUsers = users.filter(u => u.role === 'TO' || u.role === 'HEAD_TO');
      const toOpts = toUsers.map(u => ({ value: String(u.id), label: u.name + ' (' + u.role + ')' }));

      const html = `
        <div class="help" style="margin-bottom:12px">Сменить автора (создателя) тендера. Изменение фиксируется в журнале.</div>
        <div class="formrow">
          <div style="grid-column:1/-1">
            <label class="cr-required">Новый автор</label>
            <div id="change_author_w"></div>
          </div>
        </div>
        <div class="formrow">
          <div style="grid-column:1/-1">
            <label>Комментарий</label>
            <textarea id="change_author_comment" rows="2" placeholder="Причина смены (необязательно)"></textarea>
          </div>
        </div>
        <hr class="hr"/>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn" id="change_author_confirm">Сменить</button>
          <button class="btn ghost" id="change_author_history">История</button>
          <button class="btn ghost" id="change_author_cancel">Отмена</button>
        </div>
        <div id="change_author_history_box" style="margin-top:12px;display:none"></div>
      `;
      showModal('Сменить автора тендера', html);
      $('#change_author_w')?.appendChild(CRSelect.create({ id: 'change_author', placeholder: '— выберите —', options: toOpts, searchable: true, dropdownClass: 'z-modal' }));

      $('#change_author_cancel')?.addEventListener('click', () => hideModal());

      // История авторов
      $('#change_author_history')?.addEventListener('click', async () => {
        const box = $('#change_author_history_box');
        if(!box) return;
        box.style.display = 'block';
        box.innerHTML = '<div class="help">Загрузка...</div>';
        try {
          const token = localStorage.getItem('asgard_token');
          const resp = await fetch('/api/tenders/' + tid + '/author-history', { headers: { 'Authorization': 'Bearer ' + token } });
          if(resp.ok){
            const data = await resp.json();
            const history = data.history || [];
            if(!history.length){
              box.innerHTML = '<div class="help">Автор не менялся.</div>';
            } else {
              box.innerHTML = '<table class="t" style="font-size:13px"><thead><tr><th>Дата</th><th>Старый автор</th><th>Новый автор</th><th>Кто сменил</th><th>Комментарий</th></tr></thead><tbody>' +
                history.map(h => '<tr>' +
                  '<td>' + esc(formatDateTime(h.changed_at)) + '</td>' +
                  '<td>' + esc(h.old_author_name||'—') + '</td>' +
                  '<td>' + esc(h.new_author_name||'—') + '</td>' +
                  '<td>' + esc(h.changed_by_name||'—') + '</td>' +
                  '<td>' + esc(h.comment||'—') + '</td>' +
                '</tr>').join('') +
              '</tbody></table>';
            }
          } else {
            box.innerHTML = '<div class="help">Не удалось загрузить.</div>';
          }
        } catch(e){
          box.innerHTML = '<div class="help">Ошибка: ' + esc(e.message) + '</div>';
        }
      });

      // Подтверждение смены автора
      $('#change_author_confirm')?.addEventListener('click', async () => {
        const newAuthorId = Number(CRSelect.getValue('change_author') || 0);
        const comment = ($('#change_author_comment')?.value || '').trim();
        if(!newAuthorId){ toast('Смена автора','Выберите нового автора','err'); return; }

        try {
          const token = localStorage.getItem('asgard_token');
          const resp = await fetch('/api/tenders/' + tid + '/change-author', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ new_author_id: newAuthorId, comment })
          });
          if(resp.ok){
            toast('Автор','Автор тендера сменён','ok');
            hideModal();
            await render({layout, title});
          } else {
            const err = await resp.json().catch(()=>({}));
            toast('Ошибка', err.error || 'Не удалось сменить автора','err');
          }
        } catch(e){
          toast('Ошибка', e.message || 'Сеть недоступна','err');
        }
      });
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
