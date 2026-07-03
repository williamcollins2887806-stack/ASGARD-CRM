// Stage 16: Корреспонденция — входящие/исходящие письма
// Автонумерация исходящих, реестр, фильтры
// RBAC (Stage 3.1 / S-11A): ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV, OFFICE_MANAGER, PM, HEAD_PM, TO, HEAD_TO
//   - OFFICE_MANAGER + DIRECTOR_* — полный доступ (view all, edit, delete, finalize, send, new-revision)
//   - PM, HEAD_PM, TO, HEAD_TO — view-only «своих» писем + создание + скачать PDF/Word

window.AsgardCorrespondencePage = (function(){
  let corrCurrentPage = 1, corrPageSize = window.AsgardPagination ? AsgardPagination.getPageSize() : 20;
  const { $, $$, esc, toast, showModal } = AsgardUI;

  function getToken(){
    return localStorage.getItem('asgard_token') || '';
  }

  async function apiFetch(url, options = {}) {
    const resp = await fetch(url, {
      method: options.method || 'GET',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + getToken()
      }, options.headers || {}),
      body: options.body
    });

    if (resp.status === 401) {
      localStorage.removeItem('asgard_token');
      localStorage.removeItem('asgard_user');
      location.hash = '#/login';
      return null;
    }

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data.error || data.message || 'API Error');
    }
    return data;
  }

  // Направления
  const DIRECTIONS = {
    incoming: { label: 'Входящее', icon: '📥', color: 'var(--info)' },
    outgoing: { label: 'Исходящее', icon: '📤', color: 'var(--ok-t)' }
  };

  // Типы документов
  const DOC_TYPES = [
    { key: 'letter', label: 'Письмо', icon: '✉️' },
    { key: 'request', label: 'Запрос', icon: '❓' },
    { key: 'response', label: 'Ответ', icon: '💬' },
    { key: 'contract', label: 'Договор', icon: '📜' },
    { key: 'act', label: 'Акт', icon: '📋' },
    { key: 'invoice', label: 'Счёт', icon: '💰' },
    { key: 'claim', label: 'Претензия', icon: '⚠️' },
    { key: 'notification', label: 'Уведомление', icon: '📢' },
    { key: 'other', label: 'Прочее', icon: '📄' }
  ];

  const MONTHS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

  // Статус подписания (V252 correspondence.signing_status)
  // Цвета — через токены тем (--*-bg / --*-t), без хардкода.
  const SIGNING_STATUS = {
    draft:     { label: 'Черновик',      icon: '✎',  bg: 'var(--muted-bg, rgba(148,163,184,.12))', fg: 'var(--muted)' },
    finalized: { label: 'Финализировано', icon: '🔒', bg: 'var(--info-bg)',                          fg: 'var(--info-t)' },
    sent:      { label: 'Отправлено',     icon: '✉', bg: 'var(--ok-bg)',                            fg: 'var(--ok-t)' }
  };

  // Типы письма (V252 correspondence.letter_kind) — соответствует settings.letter_kinds
  const LETTER_KINDS = {
    clarification: 'Пояснения к ценовому предложению',
    request:       'Запрос',
    response:      'Ответ на запрос',
    notification:  'Уведомление',
    claim:         'Претензия',
    warranty:      'Гарантийное письмо',
    cover:         'Сопроводительное письмо',
    information:   'Информационное письмо',
    free:          'Свободный формат'
  };

  function isoNow(){ return new Date().toISOString(); }
  function today(){ return new Date().toISOString().slice(0,10); }

  function getDocTypeInfo(key){
    return DOC_TYPES.find(t => t.key === key) || { label: key, icon: '📄' };
  }
  function getSigningStatus(key){
    return SIGNING_STATUS[key] || SIGNING_STATUS.draft;
  }
  function getLetterKindLabel(key){
    return key && LETTER_KINDS[key] ? LETTER_KINDS[key] : '';
  }

  // === RBAC: Разрешённые роли (синхронно с backend CORRESPONDENCE_ROLES) ===
  // 9 ролей. PM/HEAD_PM/TO/HEAD_TO — view-only «своих» (см. _LETTER_CONTRACT.md §5).
  const ALLOWED_ROLES = [
    'ADMIN',
    'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV',
    'OFFICE_MANAGER',
    'PM', 'HEAD_PM',
    'TO', 'HEAD_TO'
  ];

  // Роли с полным доступом (видят все письма, могут удалять/финализировать/создавать новые редакции).
  const FULL_ACCESS_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'OFFICE_MANAGER'];

  // Роли, которым разрешено soft-delete (см. §5: только ADMIN + DIRECTOR_GEN).
  const DELETE_ROLES = ['ADMIN', 'DIRECTOR_GEN'];

  // Роли, которые могут финализировать чужие письма (OFFICE_MANAGER — НЕ может, см. §5).
  const FINALIZE_ANY_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

  function _hasRole(user, list){
    if(!user) return false;
    if(list.includes(user.role)) return true;
    if(Array.isArray(user.roles)){
      return user.roles.some(r => list.includes(r));
    }
    return false;
  }

  function hasAccess(user){
    return _hasRole(user, ALLOWED_ROLES);
  }
  function hasFullAccess(user){
    return _hasRole(user, FULL_ACCESS_ROLES);
  }
  function canDelete(user){
    return _hasRole(user, DELETE_ROLES);
  }
  function canFinalizeAny(user){
    return _hasRole(user, FINALIZE_ANY_ROLES);
  }
  function isViewOnlyRole(user){
    // PM/HEAD_PM/TO/HEAD_TO — view + create + download (но не edit/delete чужого, не finalize чужого)
    return hasAccess(user) && !hasFullAccess(user);
  }

  // «Моё» письмо для PM/TO: created_by==me ИЛИ родительская сущность под моим управлением.
  // Backend уже фильтрует выдачу для PM/TO/HEAD_*, но дублируем гард на фронте для action-rendering.
  function isOwnItem(user, item){
    if(!user || !item) return false;
    const uid = Number(user.id);
    if(Number(item.created_by) === uid) return true;
    // Поля от расширенного backend (S-5..S-9): responsible_pm_id, calculator_user_id и т.п.
    const ownerFields = [
      'responsible_pm_id', 'assigned_pm_id', 'pm_id',
      'calculator_user_id', 'to_user_id', 'head_to_user_id', 'head_pm_user_id'
    ];
    for(const f of ownerFields){
      if(item[f] != null && Number(item[f]) === uid) return true;
    }
    return false;
  }

  // Может ли user редактировать item (текст черновика).
  function canEditItem(user, item){
    if(!item) return false;
    // Финализированное/отправленное — никто не редактирует (только new-revision).
    if(item.signing_status && item.signing_status !== 'draft') return false;
    // OFFICE_MANAGER — НЕ редактирует (только просмотр+скачивание, см. §5).
    if(user && (user.role === 'OFFICE_MANAGER' || (Array.isArray(user.roles) && user.roles.includes('OFFICE_MANAGER')))){
      return false;
    }
    if(_hasRole(user, ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'])) return true;
    // PM/HEAD_PM/TO/HEAD_TO — только своё.
    return isOwnItem(user, item);
  }

  function canFinalizeItem(user, item){
    if(!item || (item.signing_status && item.signing_status !== 'draft')) return false;
    if(canFinalizeAny(user)) return true;
    // PM/HEAD_PM/TO/HEAD_TO — финализируют только свои.
    if(_hasRole(user, ['PM','HEAD_PM','TO','HEAD_TO'])) return isOwnItem(user, item);
    return false;
  }

  function canNewRevision(user, item){
    if(!item || item.signing_status !== 'sent') return false;
    if(canFinalizeAny(user)) return true;
    if(_hasRole(user, ['PM','HEAD_PM','TO','HEAD_TO'])) return isOwnItem(user, item);
    return false;
  }

  // === Скачивание защищённых файлов: получаем blob с Bearer-токеном, открываем как objectURL ===
  // Аналог openProtected из desktop-v2-src/src/api/download.js — но vanilla.
  async function openProtected(url, filename){
    try {
      const resp = await fetch(url, {
        headers: { 'Authorization': 'Bearer ' + getToken() }
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        throw new Error(txt || ('HTTP ' + resp.status));
      }
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const w = window.open(blobUrl, '_blank', 'noopener,noreferrer');
      if (!w) {
        // popup blocked → форсированное скачивание
        const a = document.createElement('a');
        a.href = blobUrl;
        if (filename) a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      // отдадим GC через 60c
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch(e){
      toast('Скачивание', e.message || 'Не удалось получить файл', 'err');
    }
  }

  // === Предпросмотр следующего исходящего номера (без резервирования) ===
  async function generateOutgoingNumber(date){
    try {
      const query = date ? ('?date=' + encodeURIComponent(date)) : '';
      const data = await apiFetch('/api/correspondence/next-outgoing-number' + query);
      return data?.number || '';
    } catch(e) {}

    return '';
  }

  // === Аудит ===
  async function audit(userId, action, entityId, details){
    try {
      await AsgardDB.add('audit_log', {
        actor_user_id: userId,
        entity_type: 'correspondence',
        entity_id: entityId,
        action: action,
        payload: details,
        created_at: isoNow()
      });
    } catch(e){ console.warn('Audit error:', e); }
  }

  async function render({layout, title, query}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash = "#/welcome"; return; }
    const user = auth.user;

    // === RBAC: Проверка доступа ===
    if(!hasAccess(user)){
      toast("Доступ запрещён", "Раздел доступен директорам, офис-менеджеру, РП и тендерному отделу", "err");
      location.hash = "#/welcome";
      return;
    }
    const viewOnly = isViewOnlyRole(user);

    // === S-16 (F-26): URL params parent_entity_type/parent_entity_id ===
    // Router передаёт query, плюс fallback на URLSearchParams (защита от прямого вызова).
    const q = query || (() => {
      const raw = (location.hash || '').split('?')[1] || '';
      const sp = new URLSearchParams(raw);
      const o = {};
      sp.forEach((v, k) => { o[k] = v; });
      return o;
    })();
    const PARENT_LABELS = {
      tender:     { label: 'тендеру',   icon: '📋' },
      work:       { label: 'работе',    icon: '🛠' },
      calc:       { label: 'просчёту',  icon: '🧮' },
      pre_tender: { label: 'пред-тендеру', icon: '🎯' },
      request:    { label: 'заявке',    icon: '📦' }
    };
    const rawParentType = q.parent_entity_type || q.parent_type || '';
    const rawParentId   = q.parent_entity_id   || q.parent_id   || '';
    const parentType = PARENT_LABELS[rawParentType] ? rawParentType : '';
    const parentId   = parentType && /^\d+$/.test(String(rawParentId)) ? String(rawParentId) : '';
    const hasParentFilter = !!(parentType && parentId);

    // Загрузка данных
    let items = [];
    if (hasParentFilter) {
      // S-7 backend endpoint: GET /api/correspondence/by-parent (с RBAC + parent-filter).
      try {
        const data = await apiFetch('/api/correspondence/by-parent?parent_entity_type=' +
          encodeURIComponent(parentType) + '&parent_entity_id=' + encodeURIComponent(parentId));
        // Backend возвращает {items, total}. Поле created_by нормализуем в число
        // (vanilla usersMap.get ожидает number, а сервер отдаёт {id,name}).
        items = (data?.items || []).map(it => ({
          ...it,
          created_by: it.created_by && typeof it.created_by === 'object'
            ? Number(it.created_by.id) : it.created_by
        }));
      } catch(e){
        toast('Корреспонденция', e.message || 'Не удалось загрузить письма по сущности', 'err');
        items = [];
      }
    } else {
      // Общий реестр писем — прямой fetch (IDB-кэш отражал старые удалённые записи).
      try {
        const tok = (window.AsgardAuth && window.AsgardAuth.token) || localStorage.getItem('asgard_token');
        const r = await fetch('/api/correspondence', {
          headers: { Authorization: 'Bearer ' + tok },
          cache: 'no-store'
        });
        if (!r.ok) throw new Error('GET /api/correspondence ' + r.status);
        const j = await r.json();
        items = (j.correspondence || j.items || j.data || []).map(it => ({
          ...it,
          created_by: it.created_by && typeof it.created_by === 'object'
            ? Number(it.created_by.id) : it.created_by
        }));
      } catch(e){
        console.warn('[correspondence] fetch failed, fallback to IDB:', e.message);
        try { items = await AsgardDB.all('correspondence'); } catch(_){}
      }
    }
    const users = await AsgardDB.all('users');
    const usersMap = new Map(users.map(u => [u.id, u]));

    // S-16 (F-26): после save/update/delete/finalize/new-revision переключаемся
    // на тот же источник, на котором открыли реестр (parent-filter или общий).
    async function reloadItems(){
      if (hasParentFilter) {
        try {
          const data = await apiFetch('/api/correspondence/by-parent?parent_entity_type=' +
            encodeURIComponent(parentType) + '&parent_entity_id=' + encodeURIComponent(parentId));
          return (data?.items || []).map(it => ({
            ...it,
            created_by: it.created_by && typeof it.created_by === 'object'
              ? Number(it.created_by.id) : it.created_by
          }));
        } catch(e){ return items; }
      }
      // Общий реестр после write-операции — прямой fetch.
      try {
        const tok = (window.AsgardAuth && window.AsgardAuth.token) || localStorage.getItem('asgard_token');
        const r = await fetch('/api/correspondence', {
          headers: { Authorization: 'Bearer ' + tok },
          cache: 'no-store'
        });
        if (!r.ok) throw new Error('GET /api/correspondence ' + r.status);
        const j = await r.json();
        return (j.correspondence || j.items || j.data || []).map(it => ({
          ...it,
          created_by: it.created_by && typeof it.created_by === 'object'
            ? Number(it.created_by.id) : it.created_by
        }));
      } catch(e){
        console.warn('[correspondence] reloadItems fetch failed, fallback to IDB:', e.message);
        try { return await AsgardDB.all('correspondence'); } catch(_){ return items; }
      }
    }

    // Текущий год
    const now = new Date();
    const currentYear = now.getFullYear();

    // Фильтры
    let filters = {
      year: currentYear,
      month: '',
      direction: '',
      docType: '',
      search: ''
    };

    function filterItems(){
      return items.filter(item => {
        const date = item.date ? new Date(item.date) : null;
        if(!date) return false;
        if(filters.year && date.getFullYear() !== Number(filters.year)) return false;
        if(filters.month !== '' && date.getMonth() !== Number(filters.month)) return false;
        if(filters.direction && item.direction !== filters.direction) return false;
        if(filters.docType && item.doc_type !== filters.docType) return false;
        if(filters.search){
          const s = filters.search.toLowerCase();
          const match = 
            (item.subject || '').toLowerCase().includes(s) ||
            (item.counterparty || '').toLowerCase().includes(s) ||
            (item.number || '').toLowerCase().includes(s);
          if(!match) return false;
        }
        return true;
      }).sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')));
    }

    function calcStats(list){
      const incoming = list.filter(i => i.direction === 'incoming').length;
      const outgoing = list.filter(i => i.direction === 'outgoing').length;
      const byType = {};
      DOC_TYPES.forEach(t => { byType[t.key] = 0; });
      list.forEach(i => {
        if(byType[i.doc_type] !== undefined) byType[i.doc_type]++;
      });
      return { incoming, outgoing, total: list.length, byType };
    }

    function renderPage(){
      const filtered = filterItems();
      const stats = calcStats(filtered);

      const body = `
        <style>
          /* Stage 16: Premium Viking UI */
          .corr-header { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:24px; }
          .corr-header-actions { display:flex; gap:10px; }
          
          /* KPI Cards with Viking flair */
          .corr-kpi { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:14px; margin-bottom:24px; }
          .corr-kpi-card { 
            position:relative;
            background: linear-gradient(135deg, var(--bg3) 0%, var(--bg2) 100%);
            border: 1px solid rgba(242,208,138,.15);
            border-radius:6px; 
            padding:18px;
            overflow:hidden;
            transition: all .3s ease;
          }
          .corr-kpi-card::before {
            content:'';
            position:absolute;
            top:0; left:0; right:0;
            height:3px;
            background: linear-gradient(90deg, var(--red), var(--gold), var(--blue));
            opacity:.6;
          }
          .corr-kpi-card:hover {
            border-color: rgba(242,208,138,.35);
            transform: translateY(-2px);
            box-shadow: 0 12px 40px rgba(0,0,0,.3);
          }
          .corr-kpi-label { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:1.5px; font-weight:700; }
          .corr-kpi-value { font-size:32px; font-weight:900; color:var(--gold); margin-top:8px; text-shadow: 0 2px 10px rgba(242,208,138,.3); }
          .corr-kpi-icon { position:absolute; right:14px; top:50%; transform:translateY(-50%); font-size:42px; opacity:.15; }
          
          /* Filters bar */
          .corr-filters { 
            display:flex; flex-wrap:wrap; gap:12px; 
            margin-bottom:20px; padding:16px; 
            background: linear-gradient(135deg, var(--bg3), var(--bg3));
            border: 1px solid rgba(148,163,184,.12);
            border-radius:6px;
            align-items:flex-end;
          }
          .corr-filter { display:flex; flex-direction:column; gap:5px; min-width:140px; }
          .corr-filter label { font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:1px; font-weight:700; }
          .corr-filter select, .corr-filter input { 
            padding:10px 14px; border-radius:6px; 
            border:1px solid rgba(148,163,184,.18); 
            background: var(--bg3);
            color:var(--text); font-size:13px;
            transition: all .2s ease;
          }
          .corr-filter select:focus, .corr-filter input:focus {
            border-color: rgba(242,208,138,.4);
            box-shadow: 0 0 0 3px rgba(242,208,138,.1);
            outline:none;
          }
          
          /* Table with Viking styling */
          .corr-table { width:100%; border-collapse:separate; border-spacing:0 8px; }
          .corr-table th { 
            font-size:10px; color:var(--muted); font-weight:800; 
            text-align:left; padding:10px 14px; 
            text-transform:uppercase; letter-spacing:1px;
            border-bottom: 2px solid rgba(242,208,138,.2);
          }
          .corr-table td { 
            padding:14px; 
            background: linear-gradient(135deg, var(--bg3), var(--bg2));
            border:1px solid rgba(148,163,184,.1);
            transition: all .2s ease;
          }
          .corr-table tr td:first-child { border-radius:6px 0 0 6px; border-left:3px solid transparent; }
          .corr-table tr td:last-child { border-radius:0 6px 6px 0; }
          .corr-table tr:hover td { 
            background: rgba(59,130,246,.08);
            border-color: rgba(242,208,138,.2);
          }
          .corr-table tr:hover td:first-child { border-left-color: var(--gold); }
          
          /* Direction badge */
          .corr-dir { 
            display:inline-flex; align-items:center; gap:6px;
            padding:5px 10px; border-radius:6px; 
            font-size:11px; font-weight:700;
          }
          .corr-dir.incoming { background:rgba(59,130,246,.15); color:var(--info-t); }
          .corr-dir.outgoing { background:rgba(34,197,94,.15); color:var(--ok-t); }
          
          /* Type badge */
          .corr-type { font-size:12px; display:flex; align-items:center; gap:4px; }
          
          /* Number styling */
          .corr-number { 
            font-family:var(--mono); font-size:12px; font-weight:700;
            color:var(--gold); 
            background: rgba(242,208,138,.1);
            padding:3px 8px; border-radius:6px;
          }
          
          /* Subject */
          .corr-subject { font-weight:600; }
          .corr-counterparty { font-size:12px; color:var(--muted); margin-top:3px; }
          
          /* Date */
          .corr-date { color:var(--muted); font-size:12px; }
          
          /* Actions */
          .corr-actions { display:flex; gap:6px; }
          .corr-btn { 
            padding:6px 10px; border-radius:6px; 
            border:1px solid rgba(148,163,184,.18); 
            background: var(--bg3);
            color:var(--text); font-size:12px; cursor:pointer;
            transition: all .2s ease;
          }
          .corr-btn:hover { 
            border-color: rgba(242,208,138,.4);
            transform: translateY(-1px);
          }
          
          /* Empty state */
          .corr-empty { 
            text-align:center; padding:60px 20px; 
            color:var(--muted);
            background: linear-gradient(135deg, var(--bg2), var(--bg3));
            border-radius:6px;
            border: 1px dashed rgba(148,163,184,.2);
          }
          .corr-empty-icon { font-size:64px; margin-bottom:16px; opacity:.5; }
          
          /* Count badge */
          .corr-count { font-size:13px; color:var(--muted); margin-bottom:12px; display:flex; align-items:center; gap:8px; }
          .corr-count::before { content:'ᚱ'; font-size:14px; color:var(--gold); opacity:.6; }
          
          /* Rune divider */
          .rune-divider {
            text-align:center;
            margin:20px 0;
            color: rgba(169,183,208,.3);
            font-size:12px;
            letter-spacing:8px;
          }
          
          /* Attachment placeholder */
          .corr-attach {
            display:inline-flex; align-items:center; gap:6px;
            padding:4px 8px; border-radius:6px;
            background: rgba(100,116,139,.15);
            color: var(--muted);
            font-size:11px;
            cursor:not-allowed;
            opacity:.6;
          }

          /* === V252: Signing-status pill, letter-kind chip, version chip === */
          .corr-sstatus {
            display:inline-flex; align-items:center; gap:5px;
            padding:4px 9px; border-radius:6px;
            font-size:11px; font-weight:700; line-height:1;
            white-space:nowrap;
          }
          .corr-sstatus.draft     { background: var(--muted-bg, rgba(148,163,184,.12)); color: var(--muted); }
          .corr-sstatus.finalized { background: var(--info-bg); color: var(--info-t); }
          .corr-sstatus.sent      { background: var(--ok-bg); color: var(--ok-t); }

          .corr-kind {
            display:inline-block;
            margin-top:4px;
            padding:2px 7px; border-radius:6px;
            font-size:10px; font-weight:700;
            background: var(--gold-bg); color: var(--gold);
            letter-spacing:.3px;
          }

          .corr-version {
            display:inline-flex; align-items:center; gap:4px;
            margin-left:6px;
            padding:2px 7px; border-radius:6px;
            font-size:10px; font-weight:700;
            background: var(--info-bg); color: var(--info-t);
            font-family: var(--mono);
          }

          /* Кнопки скачивания PDF/Word + view-only badge */
          .corr-dl-btns { display:flex; gap:6px; flex-wrap:wrap; }
          .corr-dl-btns .corr-btn { font-weight:700; }
          .corr-viewonly-badge {
            display:inline-flex; align-items:center; gap:4px;
            padding:2px 7px; border-radius:6px;
            background: var(--info-bg); color: var(--info-t);
            font-size:10px; font-weight:700;
            margin-left:8px;
          }

          /* Поле «номер присвоится при finalize» */
          .corr-number-placeholder {
            display:flex; align-items:center; gap:6px;
            padding:8px 12px; border-radius:6px;
            background: var(--muted-bg, rgba(148,163,184,.12));
            color: var(--muted);
            font-size:12px; font-style:italic;
          }

          /* S-16 (F-26): бейдж фильтра по родительской сущности */
          .corr-parent-filter {
            display:inline-flex; align-items:center; gap:10px;
            padding:8px 14px; border-radius:8px;
            background: var(--info-bg);
            color: var(--info-t);
            font-size:13px; font-weight:600;
            margin-bottom:14px;
          }
          .corr-parent-filter .corr-pf-clear {
            display:inline-flex; align-items:center; gap:4px;
            padding:3px 9px; border-radius:6px;
            background: transparent;
            border: 1px solid var(--info-t);
            color: var(--info-t);
            font-size:11px; font-weight:700;
            cursor:pointer;
            transition: all .15s ease;
          }
          .corr-parent-filter .corr-pf-clear:hover {
            background: var(--info-t);
            color: var(--info-bg);
          }
        </style>

        <div class="panel">
          <div class="corr-header">
            <div>
              <h2 class="page-title" style="margin:0">
                Корреспонденция
                ${viewOnly ? '<span class="corr-viewonly-badge" title="Видны только письма по вашим тендерам/работам, удаление и финализация чужих недоступны">👁 view-only «своих»</span>' : ''}
              </h2>
              <div class="help" style="margin-top:8px">Реестр входящих и исходящих документов</div>
            </div>
            <div class="corr-header-actions">
              <button class="btn primary" id="btnComposeLetter" title="Открыть редактор официального письма (Composer)">✉ Написать письмо</button>
              <button class="btn" id="btnAddIncoming">📥 Входящее</button>
              <button class="btn" id="btnAddOutgoing">📤 Исходящее</button>
            </div>
          </div>

          ${hasParentFilter ? `
            <div class="corr-parent-filter" title="Письма отфильтрованы по родительской сущности">
              <span>📌 Фильтр по ${PARENT_LABELS[parentType].icon} ${PARENT_LABELS[parentType].label} <b>#${esc(parentId)}</b></span>
              <button class="corr-pf-clear" id="btnClearParentFilter" title="Сбросить фильтр и показать общий реестр">✕ Очистить</button>
            </div>
          ` : ''}

          <div class="corr-kpi">
            <div class="corr-kpi-card">
              <div class="corr-kpi-label">Всего документов</div>
              <div class="corr-kpi-value">${stats.total}</div>
              <div class="corr-kpi-icon">📋</div>
            </div>
            <div class="corr-kpi-card">
              <div class="corr-kpi-label">Входящие</div>
              <div class="corr-kpi-value" style="color:var(--info-t)">${stats.incoming}</div>
              <div class="corr-kpi-icon">📥</div>
            </div>
            <div class="corr-kpi-card">
              <div class="corr-kpi-label">Исходящие</div>
              <div class="corr-kpi-value" style="color:var(--ok-t)">${stats.outgoing}</div>
              <div class="corr-kpi-icon">📤</div>
            </div>
          </div>

          <div class="corr-filters">
            <div class="corr-filter"><label>Год</label><div id="f_year_w"></div></div>
            <div class="corr-filter"><label>Месяц</label><div id="f_month_w"></div></div>
            <div class="corr-filter"><label>Направление</label><div id="f_direction_w"></div></div>
            <div class="corr-filter"><label>Тип</label><div id="f_docType_w"></div></div>
            <div class="corr-filter" style="flex:1; min-width:200px">
              <label>Поиск</label>
              <input id="f_search" placeholder="Тема, контрагент, номер..." value="${esc(filters.search)}"/>
            </div>
          </div>

          <div class="corr-count">Найдено: ${filtered.length} документов</div>

          ${filtered.length ? (() => {
            const paged_corr = window.AsgardPagination ? AsgardPagination.paginate(filtered, corrCurrentPage, corrPageSize) : filtered;
            return `
            <table class="corr-table">
              <thead>
                <tr>
                  <th style="width:100px">Направление</th>
                  <th style="width:90px">Дата</th>
                  <th style="width:150px">Номер</th>
                  <th>Тема / Контрагент</th>
                  <th style="width:100px">Тип</th>
                  <th style="width:130px">Статус</th>
                  <th style="width:90px"></th>
                </tr>
              </thead>
              <tbody>
                ${paged_corr.map(item => {
                  const dir = DIRECTIONS[item.direction] || DIRECTIONS.incoming;
                  const dtype = getDocTypeInfo(item.doc_type);
                  const creator = usersMap.get(Number(item.created_by));
                  const sstatusKey = item.signing_status || (item.direction === 'outgoing' && !item.number ? 'draft' : 'finalized');
                  const sstatus = getSigningStatus(sstatusKey);
                  const isDraft = sstatusKey === 'draft';
                  // Если черновик исходящего и нет номера — показываем плейсхолдер.
                  const numberDisplay = (item.direction === 'outgoing' && isDraft && !item.number)
                    ? '<span class="corr-number" style="opacity:.5;font-style:italic">при finalize</span>'
                    : `<span class="corr-number">${esc(item.number || '—')}</span>`;
                  const kindLabel = getLetterKindLabel(item.letter_kind);
                  const isRevision = item.parent_correspondence_id != null;
                  const verNo = Number(item.version_no || 1);
                  const editable = canEditItem(user, item);

                  return `
                    <tr data-id="${item.id}">
                      <td><span class="corr-dir ${item.direction}">${dir.icon} ${dir.label}</span></td>
                      <td class="corr-date">${item.date ? AsgardUI.formatDate(item.date) : '—'}</td>
                      <td>
                        ${numberDisplay}
                        ${isRevision || verNo > 1 ? `<span class="corr-version" title="Редакция версии ${verNo}">v${verNo}</span>` : ''}
                      </td>
                      <td>
                        <div class="corr-subject">${esc(item.subject || 'Без темы')}</div>
                        <div class="corr-counterparty">${esc(item.counterparty || '—')}</div>
                        ${kindLabel ? `<div class="corr-kind" title="Тип письма">${esc(kindLabel)}</div>` : ''}
                      </td>
                      <td class="corr-type">${dtype.icon} ${dtype.label}</td>
                      <td>
                        <span class="corr-sstatus ${sstatusKey}" title="Статус подписания">
                          ${sstatus.icon} ${sstatus.label}
                        </span>
                      </td>
                      <td>
                        <div class="corr-actions">
                          <button class="corr-btn" data-view="${item.id}" title="Просмотр">👁</button>
                          ${editable ? `<button class="corr-btn" data-edit="${item.id}" title="Редактировать">✎</button>` : ''}
                        </div>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
            <div id="corr_pagination">${window.AsgardPagination ? AsgardPagination.renderControls(filtered.length, corrCurrentPage, corrPageSize) : ""}</div>
            <div class="help" style="text-align:center; margin-top:8px">Показано: ${paged_corr.length} из ${filtered.length}</div>`;
          })() : `
            <div class="corr-empty">
              <div class="corr-empty-icon">📬</div>
              <div style="font-size:18px; font-weight:700; margin-bottom:8px">Нет документов</div>
              <div>Добавьте входящий или исходящий документ</div>
            </div>
          `}
          
          <div class="rune-divider">ᚱ ᚨ ᚷ ᚾ ᚨ ᚱ</div>
        </div>
      `;

      layout(body, { title: title || "Корреспонденция" }).then(bindEvents);
    }

    function bindEvents(){
      // ─── CRSelect filters ───
      const _yrOpts = [{ value: '', label: 'Все' }, ...[currentYear, currentYear-1, currentYear-2, currentYear-3, currentYear-4].map(y => ({ value: String(y), label: String(y) }))];
      const _moOpts = [{ value: '', label: 'Все' }, ...MONTHS.map((m, i) => ({ value: String(i), label: m }))];
      const _dirOpts = [{ value: '', label: 'Все' }, { value: 'incoming', label: '📥 Входящие' }, { value: 'outgoing', label: '📤 Исходящие' }];
      const _dtOpts = [{ value: '', label: 'Все' }, ...DOC_TYPES.map(t => ({ value: t.key, label: t.icon + ' ' + t.label }))];
      $('#f_year_w')?.appendChild(CRSelect.create({ id: 'f_year', options: _yrOpts, value: filters.year || '', onChange: v => { filters.year = v; corrCurrentPage = 1; renderPage(); } }));
      $('#f_month_w')?.appendChild(CRSelect.create({ id: 'f_month', options: _moOpts, value: filters.month || '', onChange: v => { filters.month = v; corrCurrentPage = 1; renderPage(); } }));
      $('#f_direction_w')?.appendChild(CRSelect.create({ id: 'f_direction', options: _dirOpts, value: filters.direction || '', onChange: v => { filters.direction = v; corrCurrentPage = 1; renderPage(); } }));
      $('#f_docType_w')?.appendChild(CRSelect.create({ id: 'f_docType', options: _dtOpts, value: filters.docType || '', onChange: v => { filters.docType = v; corrCurrentPage = 1; renderPage(); } }));
      $('#f_search')?.addEventListener('input', e => { filters.search = e.target.value; corrCurrentPage = 1; renderPage(); });

      // Pagination controls
      if (window.AsgardPagination) {
        AsgardPagination.attachHandlers("corr_pagination",
          (p) => { corrCurrentPage = p; renderPage(); },
          (s) => { corrPageSize = s; corrCurrentPage = 1; renderPage(); }
        );
      }

      // S-16 (F-26): сброс фильтра по родительской сущности.
      $('#btnClearParentFilter')?.addEventListener('click', () => {
        location.hash = '#/correspondence';
      });

      // ✉ Написать письмо — переход в React v2 Composer (composer существует только в v2).
      // Если открыли реестр с parent-фильтром, прокидываем привязку в composer чтобы он
      // pre-fill'ил тендер/работу/просчёт/заявку.
      $('#btnComposeLetter')?.addEventListener('click', () => {
        const params = new URLSearchParams();
        if (hasParentFilter) {
          params.set('parent_entity_type', parentType);
          params.set('parent_entity_id', String(parentId));
        }
        // return_to: чтобы после finalize/Close композер вернул юзера в vanilla.
        params.set('return_to', window.location.href);
        window.location.href = '/v2/#/correspondence/composer?' + params.toString();
      });

      // Добавить входящее
      $('#btnAddIncoming')?.addEventListener('click', () => openAddModal('incoming'));

      // Добавить исходящее
      $('#btnAddOutgoing')?.addEventListener('click', () => openAddModal('outgoing'));

      // Просмотр
      $$('[data-view]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.view);
          const item = await AsgardDB.get('correspondence', id);
          if(item) openViewModal(item);
        });
      });

      // Редактирование
      $$('[data-edit]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.edit);
          const item = await AsgardDB.get('correspondence', id);
          if(!item) return;
          if(!canEditItem(user, item)){
            // PM/TO попытка открыть чужое или финализированное — fallback на просмотр.
            openViewModal(item);
            return;
          }
          openEditModal(item);
        });
      });
    }

    async function openAddModal(direction){
      const isOutgoing = direction === 'outgoing';
      const dir = DIRECTIONS[direction];
      // V252: исходящий стартует как draft → номер НЕ аллоцируется до finalize.
      // Поэтому показываем плейсхолдер вместо preview-номера.
      const html = `
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px">
          <span style="font-size:24px">${dir.icon}</span>
          <span style="font-weight:700">${dir.label} документ</span>
        </div>
        <div class="formrow">
          <div><label>Дата</label><input id="corr_date" type="date" value="${today()}"/></div>
          <div>
            <label>Номер</label>
            ${isOutgoing
              ? '<div class="corr-number-placeholder" title="Номер аллоцируется при финализации (POST /finalize)">🔒 присвоится при finalize</div>'
              : '<input id="corr_number" placeholder="Номер из входящего"/>'}
          </div>
          <div><label>Тип документа</label>
            <div id="corr_type_w"></div>
          </div>
        </div>
        ${isOutgoing ? `
          <div class="formrow">
            <div><label>Тип письма</label><div id="corr_kind_w"></div></div>
            <div style="grid-column:span 2"><label>Заголовок документа</label><input id="corr_doc_title" placeholder="Например: ПОЯСНЕНИЯ К ЦЕНОВОМУ ПРЕДЛОЖЕНИЮ"/></div>
          </div>
          <div class="formrow">
            <div style="grid-column:1/-1"><label>Подзаголовок (курсив)</label><input id="corr_doc_sub" placeholder="(об обстоятельствах, исключающих дальнейшее снижение цены)"/></div>
          </div>
          <div class="formrow">
            <div style="grid-column:1/-1"><label>Подпрефикс под Исх.№</label><input id="corr_header_subline" placeholder="по дополнительному запросу Организатора к заявке…"/></div>
          </div>
          <div class="formrow">
            <div><label>№ процедуры</label><input id="corr_procedure_number" placeholder="01-3012707-523-2026"/></div>
            <div><label>№ лота</label><input id="corr_lot_number" placeholder="5855-3014050-2026"/></div>
            <div><label>Название лота</label><input id="corr_lot_title" placeholder="Замена оголовка…"/></div>
          </div>
        ` : ''}
        <div class="formrow">
          <div style="grid-column:1/-1"><label>Тема</label><input id="corr_subject" placeholder="О чём документ..."/></div>
        </div>
        <div class="formrow">
          <div><label>${isOutgoing ? 'Получатель' : 'Отправитель'}</label><input id="corr_counterparty" placeholder="Организация или ФИО"/></div>
          <div><label>Контактное лицо</label><input id="corr_contact" placeholder="ФИО"/></div>
        </div>
        <div class="formrow">
          <div style="grid-column:1/-1"><label>Примечание</label><textarea id="corr_note" rows="2" placeholder="Дополнительная информация..."></textarea></div>
        </div>
        <hr class="hr"/>
        <div style="margin-bottom:12px">
          <label style="font-size:13px;font-weight:600">📎 Вложение (скан, PDF, файл)</label>
          <input type="file" id="corr_file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.zip,.rar" style="margin-top:6px"/>
        </div>
        <div style="display:flex; gap:10px; align-items:center">
          <div id="corrMimirSlot"></div>
          <button class="btn" id="btnSaveCorr">Сохранить черновик</button>
        </div>
      `;

      showModal({ title: `Новый документ`, html, icon: '📨', subtitle: isOutgoing ? 'Исходящая корреспонденция' : 'Входящая корреспонденция' });
      $('#corr_type_w')?.appendChild(CRSelect.create({ id: 'corr_type', options: DOC_TYPES.map(t => ({ value: t.key, label: t.icon + ' ' + t.label })), dropdownClass: 'z-modal' }));

      // Тип письма (только для исходящих) — авто-заполняет title/sub.
      if (isOutgoing) {
        const KIND_DEFAULTS = {
          clarification: { title: 'ПОЯСНЕНИЯ К ЦЕНОВОМУ ПРЕДЛОЖЕНИЮ',  sub: '(об обстоятельствах, исключающих дальнейшее снижение цены)' },
          request:       { title: 'ЗАПРОС',                              sub: '' },
          response:      { title: 'ОТВЕТ НА ЗАПРОС',                     sub: '' },
          notification:  { title: 'УВЕДОМЛЕНИЕ',                          sub: '' },
          claim:         { title: 'ПРЕТЕНЗИЯ',                            sub: '' },
          warranty:      { title: 'ГАРАНТИЙНОЕ ПИСЬМО',                   sub: '' },
          cover:         { title: 'СОПРОВОДИТЕЛЬНОЕ ПИСЬМО',              sub: '' },
          information:   { title: 'ИНФОРМАЦИОННОЕ ПИСЬМО',                sub: '' },
          free:          { title: '',                                      sub: '' }
        };
        const kindOptions = Object.entries(LETTER_KINDS).map(([key, lbl]) => ({ value: key, label: lbl }));
        $('#corr_kind_w')?.appendChild(CRSelect.create({
          id: 'corr_letter_kind',
          options: kindOptions,
          value: 'free',
          dropdownClass: 'z-modal',
          onChange: (v) => {
            const def = KIND_DEFAULTS[v] || {};
            const t = $('#corr_doc_title');
            const s = $('#corr_doc_sub');
            if (t && (!t.value || Object.values(KIND_DEFAULTS).some(d => d.title === t.value))) t.value = def.title || '';
            if (s && (!s.value || Object.values(KIND_DEFAULTS).some(d => d.sub === s.value && d.sub))) s.value = def.sub || '';
          }
        }));
      }

      // ── WOW: Мимир автозаполнение для корреспонденции ──
      // Форма корреспонденции использует id-селекторы (не name), поэтому маппинг вручную
      if (window.MimirForms) {
        const mimirSlot = document.getElementById('corrMimirSlot');
        if (mimirSlot) {
          MimirForms.ensureStyles();
          const btn = MimirForms.createButton('Мимир');
          btn.classList.add('pulsing');
          mimirSlot.appendChild(btn);

          // Маппинг: бэкенд field name → DOM id
          const FIELD_MAP = {
            subject: 'corr_subject',
            note: 'corr_note',
            counterparty: 'corr_counterparty',
            contact_person: 'corr_contact'
          };

          btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.classList.remove('pulsing');
            btn.innerHTML = '<span class="mimir-form-spinner"></span> Мимир думает\u2026';

            // Skeleton на пустых полях
            Object.values(FIELD_MAP).forEach(id => {
              const el = $('#' + id);
              if (el && !el.value) el.classList.add('mimir-field-skeleton');
            });

            try {
              const token = localStorage.getItem('asgard_token');
              const existing = {};
              Object.entries(FIELD_MAP).forEach(([k, id]) => {
                const el = $('#' + id);
                if (el && el.value) existing[k] = el.value;
              });

              const resp = await fetch('/api/mimir/suggest-form', {
                method: 'POST',
                headers: { 'Content-Type':'application/json', 'Authorization':'Bearer ' + token },
                body: JSON.stringify({
                  form_type: 'correspondence',
                  context: { direction, existing_fields: existing }
                })
              });

              // Убираем skeleton
              Object.values(FIELD_MAP).forEach(id => {
                const el = $('#' + id);
                if (el) el.classList.remove('mimir-field-skeleton');
              });

              if (resp.ok) {
                const data = await resp.json();
                let filled = 0;
                if (data.fields) {
                  Object.entries(FIELD_MAP).forEach(([fieldName, domId], i) => {
                    const el = $('#' + domId);
                    const val = data.fields[fieldName];
                    if (!el || !val || el.value) return;
                    setTimeout(() => {
                      if (el.tagName === 'TEXTAREA' || String(val).length > 30) {
                        MimirForms.typewriterFill(el, val);
                      } else {
                        el.value = val;
                      }
                      el.classList.add('mimir-field-filled');
                      setTimeout(() => el.classList.remove('mimir-field-filled'), 1200);
                      filled++;
                    }, i * 150);
                  });
                  toast('Мимир', 'Заполнил ' + (filled || Object.keys(data.fields).length) + ' полей', 'ok');
                } else {
                  MimirForms.showBubble(btn, 'Воин, мало информации! Заполни хотя бы тему или контрагента — и я помогу дальше.');
                }
              }
            } catch(e) {
              MimirForms.showBubble(btn, (e.message || 'Ошибка') + ' Попробуй заполнить пару полей и нажми снова.', true);
            }
            finally {
              btn.disabled = false;
              btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="var(--brd)"/></svg> Мимир';
              btn.classList.add('pulsing');
            }
          });
        }
      }

      // V252: для исходящих номер аллоцируется на finalize, preview не нужен.
      // Для входящих — пользователь вводит номер вручную (поле corr_number).

      $('#btnSaveCorr')?.addEventListener('click', async () => {
        const subject = $('#corr_subject')?.value?.trim();
        if(!subject){ toast('Ошибка', 'Укажите тему документа', 'err'); return; }

        // Загрузить файл если есть
        let filePath = null;
        let uploadedDocId = null;
        const fileInput = document.getElementById('corr_file');
        if (fileInput && fileInput.files && fileInput.files[0]) {
          try {
            const formData = new FormData();
            formData.append('file', fileInput.files[0]);
            formData.append('type', 'Корреспонденция');
            const uploadResp = await fetch('/api/files/upload', {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('asgard_token') || '') },
              body: formData
            });
            if (uploadResp.ok) {
              const uploadData = await uploadResp.json();
              filePath = uploadData.download_url || uploadData.filename || null;
              uploadedDocId = uploadData.file?.id || null;
            }
          } catch(ue) { console.error('[Corr] File upload error:', ue); }
        }

        const item = {
          direction,
          // S-16 (F-26): pre-fill parent link если открыли реестр из карточки.
          ...(hasParentFilter ? { parent_entity_type: parentType, parent_entity_id: Number(parentId) } : {}),
          date: $('#corr_date')?.value || today(),
          doc_type: CRSelect.getValue('corr_type') || 'letter',
          subject,
          counterparty: $('#corr_counterparty')?.value?.trim() || '',
          contact_person: $('#corr_contact')?.value?.trim() || '',
          note: $('#corr_note')?.value?.trim() || ''
        };
        if (filePath) item.file_path = filePath;
        if(!isOutgoing){
          item.number = $('#corr_number')?.value?.trim() || '';
        } else {
          // V252 поля для исходящих писем
          const letterKind = CRSelect.getValue('corr_letter_kind') || 'free';
          item.letter_kind      = letterKind;
          item.doc_title        = $('#corr_doc_title')?.value?.trim() || '';
          item.doc_sub          = $('#corr_doc_sub')?.value?.trim() || '';
          item.header_subline   = $('#corr_header_subline')?.value?.trim() || '';
          item.procedure_number = $('#corr_procedure_number')?.value?.trim() || '';
          item.lot_number       = $('#corr_lot_number')?.value?.trim() || '';
          item.lot_title        = $('#corr_lot_title')?.value?.trim() || '';
        }

        try {
          const response = await apiFetch('/api/correspondence', {
            method: 'POST',
            body: JSON.stringify(item)
          });
          const savedItem = response?.item || item;
          const savedId = savedItem.id || response?.id;

          // Привязать загруженный файл к корреспонденции
          if (uploadedDocId && savedId) {
            try {
              await apiFetch('/api/correspondence/' + savedId + '/link-doc', {
                method: 'POST',
                body: JSON.stringify({ document_id: uploadedDocId })
              });
            } catch(le) { console.error('[Corr] Link doc error:', le); }
          }

          await audit(user.id, 'create', savedId, {
            direction: savedItem.direction,
            number: savedItem.number || null,
            subject: savedItem.subject,
            counterparty: savedItem.counterparty
          });

          toast('Документ', 'Успешно добавлен');
          if (AsgardDB.clearCache) AsgardDB.clearCache('correspondence');
          items = await reloadItems();
          renderPage();
        } catch(e) {
          toast('Ошибка', e.message || 'Не удалось сохранить документ', 'err');
        }
      });
    }

    function openEditModal(item){
      const isOutgoing = item.direction === 'outgoing';
      const dir = DIRECTIONS[item.direction];
      const sstatusKey = item.signing_status || 'draft';
      const sstatus = getSigningStatus(sstatusKey);
      const isDraft = sstatusKey === 'draft';
      const lockOutgoingIdentity = isOutgoing && !!item.number;

      const html = `
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px">
          <span style="font-size:24px">${dir.icon}</span>
          <span style="font-weight:700">${dir.label} #${item.id}</span>
          <span class="corr-sstatus ${sstatusKey}" style="margin-left:auto">${sstatus.icon} ${sstatus.label}</span>
          ${(item.version_no && Number(item.version_no) > 1) || item.parent_correspondence_id
              ? `<span class="corr-version">v${Number(item.version_no || 1)}</span>` : ''}
        </div>
        <div class="formrow">
          <div><label>Дата</label><input id="corr_date" type="date" value="${(item.date || '').slice(0,10)}" ${lockOutgoingIdentity ? 'readonly style="background:var(--muted-bg, rgba(148,163,184,.12));color:var(--muted);font-weight:600"' : ''}/></div>
          <div>
            <label>${isOutgoing ? 'Номер (серверный)' : 'Номер'}</label>
            ${isOutgoing && isDraft && !item.number
              ? '<div class="corr-number-placeholder">🔒 присвоится при finalize</div>'
              : `<input id="corr_number" value="${esc(item.number || '')}" ${isOutgoing ? 'readonly style="background:var(--muted-bg, rgba(148,163,184,.12));color:var(--muted);font-weight:600"' : ''}/>`}
          </div>
          <div><label>Тип документа</label>
            <div id="corr_type_w"></div>
          </div>
        </div>
        ${isOutgoing ? `
          <div class="formrow">
            <div><label>Тип письма</label><div id="corr_kind_w"></div></div>
            <div style="grid-column:span 2"><label>Заголовок документа</label><input id="corr_doc_title" value="${esc(item.doc_title || '')}"/></div>
          </div>
          <div class="formrow">
            <div style="grid-column:1/-1"><label>Подзаголовок (курсив)</label><input id="corr_doc_sub" value="${esc(item.doc_sub || '')}"/></div>
          </div>
          <div class="formrow">
            <div style="grid-column:1/-1"><label>Подпрефикс под Исх.№</label><input id="corr_header_subline" value="${esc(item.header_subline || '')}"/></div>
          </div>
          <div class="formrow">
            <div><label>№ процедуры</label><input id="corr_procedure_number" value="${esc(item.procedure_number || '')}"/></div>
            <div><label>№ лота</label><input id="corr_lot_number" value="${esc(item.lot_number || '')}"/></div>
            <div><label>Название лота</label><input id="corr_lot_title" value="${esc(item.lot_title || '')}"/></div>
          </div>
        ` : ''}
        <div class="formrow">
          <div style="grid-column:1/-1"><label>Тема</label><input id="corr_subject" value="${esc(item.subject || '')}"/></div>
        </div>
        <div class="formrow">
          <div><label>${isOutgoing ? 'Получатель' : 'Отправитель'}</label><input id="corr_counterparty" value="${esc(item.counterparty || '')}"/></div>
          <div><label>Контактное лицо</label><input id="corr_contact" value="${esc(item.contact_person || '')}"/></div>
        </div>
        <div class="formrow">
          <div style="grid-column:1/-1"><label>Примечание</label><textarea id="corr_note" rows="2">${esc(item.note || '')}</textarea></div>
        </div>
        <hr class="hr"/>
        <div style="margin-bottom:12px">
          <label style="font-size:13px;font-weight:600">📎 Вложение</label>
          ${item.file_path ? `<div style="margin:6px 0;padding:8px 12px;border-radius:6px;background:var(--bg2);display:flex;align-items:center;gap:8px">
            <span>📄</span>
            <a href="${esc(item.file_path)}" target="_blank" style="color:var(--blue);font-size:13px" download>Скачать текущий файл</a>
          </div>` : '<div class="help" style="margin:4px 0;font-size:12px">Файл не прикреплён</div>'}
          <input type="file" id="corr_file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.zip,.rar" style="margin-top:4px"/>
          <div class="help" style="font-size:11px;margin-top:2px">Загрузите новый файл чтобы заменить текущий</div>
        </div>
        <div style="display:flex; gap:10px; justify-content:space-between; flex-wrap:wrap">
          <button class="btn" id="btnUpdateCorr">Сохранить изменения</button>
          ${isOutgoing && isDraft ? '<button class="btn" id="btnFinalizeCorr" style="background:var(--info-bg);color:var(--info-t)">🔒 Финализировать</button>' : ''}
          <button class="btn red" id="btnDeleteCorr">Удалить</button>
        </div>
      `;

      showModal({ title: `Редактировать документ`, html, icon: '📨', subtitle: isOutgoing ? 'Исходящая корреспонденция' : 'Входящая корреспонденция' });
      $('#corr_type_w')?.appendChild(CRSelect.create({ id: 'corr_type', options: DOC_TYPES.map(t => ({ value: t.key, label: t.icon + ' ' + t.label })), value: item.doc_type || 'letter', dropdownClass: 'z-modal' }));

      if (isOutgoing) {
        const kindOptions = Object.entries(LETTER_KINDS).map(([key, lbl]) => ({ value: key, label: lbl }));
        $('#corr_kind_w')?.appendChild(CRSelect.create({
          id: 'corr_letter_kind',
          options: kindOptions,
          value: item.letter_kind || 'free',
          dropdownClass: 'z-modal'
        }));
      }

      $('#btnUpdateCorr')?.addEventListener('click', async () => {
        const subject = $('#corr_subject')?.value?.trim();
        if(!subject){ toast('Ошибка', 'Укажите тему документа', 'err'); return; }

        // Загрузить новый файл если выбран
        let filePath = null;
        const fileInput = document.getElementById('corr_file');
        if (fileInput && fileInput.files && fileInput.files[0]) {
          try {
            const formData = new FormData();
            formData.append('file', fileInput.files[0]);
            formData.append('type', 'Корреспонденция');
            const uploadResp = await fetch('/api/files/upload', {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('asgard_token') || '') },
              body: formData
            });
            if (uploadResp.ok) {
              const uploadData = await uploadResp.json();
              filePath = uploadData.download_url || uploadData.filename || null;
            }
          } catch(ue) { console.error('[Corr] File upload error:', ue); }
        }

        const oldNumber = item.number;
        const payload = {
          date: $('#corr_date')?.value || today(),
          doc_type: CRSelect.getValue('corr_type') || 'letter',
          subject,
          counterparty: $('#corr_counterparty')?.value?.trim() || '',
          contact_person: $('#corr_contact')?.value?.trim() || '',
          note: $('#corr_note')?.value?.trim() || ''
        };
        if (filePath) payload.file_path = filePath;
        if(!isOutgoing){
          payload.number = $('#corr_number')?.value?.trim() || '';
        } else {
          payload.letter_kind      = CRSelect.getValue('corr_letter_kind') || item.letter_kind || 'free';
          payload.doc_title        = $('#corr_doc_title')?.value?.trim() || '';
          payload.doc_sub          = $('#corr_doc_sub')?.value?.trim() || '';
          payload.header_subline   = $('#corr_header_subline')?.value?.trim() || '';
          payload.procedure_number = $('#corr_procedure_number')?.value?.trim() || '';
          payload.lot_number       = $('#corr_lot_number')?.value?.trim() || '';
          payload.lot_title        = $('#corr_lot_title')?.value?.trim() || '';
        }

        try {
          const response = await apiFetch('/api/correspondence/' + item.id, {
            method: 'PUT',
            body: JSON.stringify(payload)
          });
          const savedItem = response?.item || item;

          const changes = { subject: savedItem.subject, counterparty: savedItem.counterparty };
          if(savedItem.direction === 'outgoing' && savedItem.number && savedItem.number !== oldNumber){
            await audit(user.id, 'assign_number', savedItem.id, {
              old_number: oldNumber || null,
              new_number: savedItem.number
            });
          }
          await audit(user.id, 'update', savedItem.id, changes);

          toast('Документ', 'Обновлён');
          if (AsgardDB.clearCache) AsgardDB.clearCache('correspondence');
          items = await reloadItems();
          renderPage();
        } catch(e) {
          toast('Ошибка', e.message || 'Не удалось обновить документ', 'err');
        }
      });

      // Удаление доступно только ADMIN + DIRECTOR_GEN (см. §5).
      const btnDelete = $('#btnDeleteCorr');
      if (btnDelete) {
        if (!canDelete(user)) {
          btnDelete.style.display = 'none';
        } else {
          btnDelete.addEventListener('click', async () => {
            if(!confirm('Удалить документ?')) return;

            await audit(user.id, 'delete', item.id, { subject: item.subject, number: item.number });

            await AsgardDB.del('correspondence', item.id);
            toast('Документ', 'Удалён');
            if (AsgardDB.clearCache) AsgardDB.clearCache('correspondence');
            items = await reloadItems();
            renderPage();
          });
        }
      }

      // Финализация (POST /api/correspondence/:id/finalize) — аллоцирует Исх.№.
      const btnFin = $('#btnFinalizeCorr');
      if (btnFin) {
        if (!canFinalizeItem(user, item)) {
          btnFin.style.display = 'none';
        } else {
          btnFin.addEventListener('click', async () => {
            if(!confirm('Финализировать письмо? После этого редактирование закроется и будет присвоен Исх.№.')) return;
            btnFin.disabled = true;
            btnFin.textContent = 'Финализирую…';
            try {
              const resp = await apiFetch('/api/correspondence/' + item.id + '/finalize', { method: 'POST', body: JSON.stringify({}) });
              await audit(user.id, 'finalize', item.id, { number: resp?.number, finalized_at: resp?.finalized_at });
              toast('Письмо', 'Финализировано · № ' + (resp?.number || ''));
              if (AsgardDB.clearCache) AsgardDB.clearCache('correspondence');
              items = await reloadItems();
              AsgardUI.closeModal && AsgardUI.closeModal();
              renderPage();
            } catch(e) {
              toast('Ошибка', e.message || 'Не удалось финализировать', 'err');
              btnFin.disabled = false;
              btnFin.textContent = '🔒 Финализировать';
            }
          });
        }
      }
    }

    function openViewModal(item){
      const dir = DIRECTIONS[item.direction];
      const dtype = getDocTypeInfo(item.doc_type);
      const creator = usersMap.get(Number(item.created_by));
      const isOutgoing = item.direction === 'outgoing';
      const sstatusKey = item.signing_status || (isOutgoing && !item.number ? 'draft' : 'finalized');
      const sstatus = getSigningStatus(sstatusKey);
      const isFinalized = sstatusKey === 'finalized' || sstatusKey === 'sent';
      const kindLabel = getLetterKindLabel(item.letter_kind);
      const verNo = Number(item.version_no || 1);
      const isRevision = item.parent_correspondence_id != null;
      const parentItem = isRevision ? items.find(x => Number(x.id) === Number(item.parent_correspondence_id)) : null;
      const showDownloads = isOutgoing && isFinalized;
      const showNewRevision = canNewRevision(user, item);

      const html = `
        <div style="display:flex; align-items:center; gap:12px; margin-bottom:20px; flex-wrap:wrap">
          <span style="font-size:32px">${dir.icon}</span>
          <div style="flex:1; min-width:200px">
            <div style="font-weight:800; font-size:18px">${esc(item.subject || 'Без темы')}</div>
            <div style="color:var(--muted); font-size:13px">${dir.label} • ${dtype.icon} ${dtype.label}${kindLabel ? ' • <span class="corr-kind" style="margin:0">' + esc(kindLabel) + '</span>' : ''}</div>
          </div>
          <span class="corr-sstatus ${sstatusKey}">${sstatus.icon} ${sstatus.label}</span>
        </div>

        ${isRevision || verNo > 1 ? `
          <div class="help" style="display:flex; align-items:center; gap:8px; padding:10px 12px; background: var(--info-bg); border-radius:6px; color: var(--info-t); margin-bottom:12px">
            <span>🔁</span>
            <span><b>Редакция v${verNo}</b>${parentItem ? ' от № ' + esc(parentItem.number || ('#' + parentItem.id)) : (item.parent_correspondence_id ? ' (родитель #' + item.parent_correspondence_id + ')' : '')}</span>
          </div>
        ` : ''}

        <div class="formrow">
          <div><label>Номер</label><div class="corr-number" style="display:inline-block">${esc(item.number || '— (черновик)')}</div></div>
          <div><label>Дата</label><div class="help">${item.date ? AsgardUI.formatDate(item.date) : '—'}</div></div>
        </div>

        ${isOutgoing ? `
          ${item.doc_title || item.doc_sub ? `
            <hr class="hr"/>
            <div><label>Заголовок документа</label>
              <div class="help" style="font-weight:600">${esc(item.doc_title || '—')}</div>
              ${item.doc_sub ? `<div class="help" style="font-style:italic; color:var(--muted)">${esc(item.doc_sub)}</div>` : ''}
            </div>
          ` : ''}
          ${item.header_subline ? `
            <div style="margin-top:8px"><label>Подпрефикс под Исх.№</label><div class="help">${esc(item.header_subline)}</div></div>
          ` : ''}
          ${item.procedure_number || item.lot_number || item.lot_title ? `
            <hr class="hr"/>
            <div class="formrow">
              ${item.procedure_number ? `<div><label>№ процедуры</label><div class="help" style="font-family:var(--mono)">${esc(item.procedure_number)}</div></div>` : ''}
              ${item.lot_number ? `<div><label>№ лота</label><div class="help" style="font-family:var(--mono)">${esc(item.lot_number)}</div></div>` : ''}
              ${item.lot_title ? `<div><label>Название лота</label><div class="help">${esc(item.lot_title)}</div></div>` : ''}
            </div>
          ` : ''}
        ` : ''}

        <hr class="hr"/>
        <div class="formrow">
          <div><label>${isOutgoing ? 'Получатель' : 'Отправитель'}</label><div class="help" style="font-weight:600">${esc(item.counterparty || '—')}</div></div>
          <div><label>Контактное лицо</label><div class="help">${esc(item.contact_person || '—')}</div></div>
        </div>
        ${item.note ? `
          <hr class="hr"/>
          <div><label>Примечание</label><div class="help">${esc(item.note)}</div></div>
        ` : ''}
        ${item.file_path ? `
          <hr class="hr"/>
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:20px">📎</span>
            <a href="${esc(item.file_path)}" target="_blank" download style="color:var(--blue);font-weight:600;font-size:14px">Скачать вложение</a>
          </div>
        ` : ''}

        ${showDownloads ? `
          <hr class="hr"/>
          <div><label>Бланк письма</label>
            <div class="corr-dl-btns" style="margin-top:6px">
              <button class="corr-btn" data-dl-pdf="${item.id}" title="Скачать PDF с подписью и печатью">📄 PDF</button>
              <button class="corr-btn" data-dl-docx="${item.id}" title="Скачать редактируемый Word">📝 Word</button>
            </div>
            <div class="help" style="font-size:11px; margin-top:4px">PDF — с подписью и печатью (?with_signature=1&with_stamp=1). Word — редактируемый.</div>
          </div>
        ` : ''}

        ${showNewRevision ? `
          <hr class="hr"/>
          <div style="display:flex; justify-content:flex-end">
            <button class="corr-btn" id="btnNewRevision" style="background:var(--gold-bg); color:var(--gold); font-weight:700">🔁 Создать новую редакцию</button>
          </div>
        ` : ''}

        <hr class="hr"/>
        <div class="help" style="font-size:11px; color:var(--muted)">
          Создал: ${esc(creator?.name || '—')} • ${item.created_at ? new Date(item.created_at).toLocaleString('ru-RU') : '—'}
          ${item.ai_model ? ' • AI: ' + esc(item.ai_model) : ''}
        </div>
      `;

      showModal({ title: `Документ #${item.id}`, html, icon: '📨', subtitle: item.direction === 'outgoing' ? 'Исходящая корреспонденция' : 'Входящая корреспонденция' });

      // Кнопки скачивания PDF/Word — защищённые (Bearer токен).
      const fileBase = (item.number || ('letter-' + item.id)).replace(/[\\\/\:\*\?"<>\|]/g, '_');
      $('[data-dl-pdf]')?.addEventListener('click', () => {
        openProtected('/api/letter/' + item.id + '/render/pdf?with_signature=1&with_stamp=1', fileBase + '.pdf');
      });
      $('[data-dl-docx]')?.addEventListener('click', () => {
        openProtected('/api/letter/' + item.id + '/render/docx', fileBase + '.docx');
      });

      // Создание новой редакции.
      $('#btnNewRevision')?.addEventListener('click', async () => {
        const note = (prompt('Краткое примечание к новой редакции (опц.):', '') || '').trim();
        try {
          const resp = await apiFetch('/api/correspondence/' + item.id + '/new-revision', {
            method: 'POST',
            body: JSON.stringify(note ? { revision_note: note } : {})
          });
          await audit(user.id, 'new_revision', resp?.new_id || null, { parent_id: item.id, version_no: resp?.version_no });
          toast('Редакция', 'Создана v' + (resp?.version_no || '?'));
          if (AsgardDB.clearCache) AsgardDB.clearCache('correspondence');
          items = await reloadItems();
          AsgardUI.closeModal && AsgardUI.closeModal();
          renderPage();
          // Открыть новую редакцию для редактирования.
          if (resp?.new_id) {
            const fresh = items.find(x => Number(x.id) === Number(resp.new_id));
            if (fresh && canEditItem(user, fresh)) openEditModal(fresh);
            else if (fresh) openViewModal(fresh);
          }
        } catch(e) {
          toast('Ошибка', e.message || 'Не удалось создать редакцию', 'err');
        }
      });
    }

    renderPage();
  }

  return { render, generateOutgoingNumber };
})();
