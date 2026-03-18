// Stage 17: Доверенности — Реестр + 7 шаблонов с генерацией DOC
window.AsgardProxiesPage = (function(){
  var _ui = AsgardUI, $ = _ui.$, $$ = _ui.$$, esc = _ui.esc, toast = _ui.toast, showModal = _ui.showModal;
  var PAGE_SIZE = 20;

  var PROXY_TYPES = [
    {id:'general', label:'Генеральная', icon:'📜', desc:'Полные полномочия представлять интересы', fields:['fio','passport','powers_general']},
    {id:'receive_goods', label:'Получение ТМЦ', icon:'📦', desc:'Получение товарно-материальных ценностей', fields:['fio','passport','supplier','goods_list']},
    {id:'representation', label:'Представительство', icon:'🏛️', desc:'Представление интересов в организациях', fields:['fio','passport','powers_general','description']},
    {id:'construction', label:'Строительная площадка', icon:'🏗️', desc:'Полномочия на строительной площадке', fields:['fio','passport','address','description']},
    {id:'vehicle', label:'Транспорт/Грузы', icon:'🚚', desc:'Управление ТС и перевозка грузов', fields:['fio','passport','vehicle_brand','vehicle_number','vin']},
    {id:'bank', label:'Банковская', icon:'🏦', desc:'Операции в банке', fields:['fio','passport','bank_name','account_number']},
    {id:'common', label:'Общая', icon:'📋', desc:'Общие полномочия', fields:['fio','passport','powers_general','description']}
  ];

  var TYPE_MAP = {};
  PROXY_TYPES.forEach(function(t){ TYPE_MAP[t.id] = t; });

  var TYPE_DB_LABELS = {
    'Генеральная': 'general',
    'Общая': 'common',
    'Получение ТМЦ': 'receive_goods',
    'Представительство': 'representation',
    'Строительная площадка': 'construction',
    'Транспорт/Грузы': 'vehicle'
  };
  var TYPE_ICONS = {
    'Генеральная':'📜', 'Общая':'📋', 'Получение ТМЦ':'📦',
    'Представительство':'🏛️', 'Строительная площадка':'🏗️', 'Транспорт/Грузы':'🚚'
  };

  var FIELD_LABELS = {
    fio:'ФИО доверенного лица', passport:'Паспортные данные', powers_general:'Полномочия',
    description:'Описание', address:'Адрес', supplier:'Поставщик',
    goods_list:'Перечень ТМЦ', vehicle_brand:'Марка ТС', vehicle_number:'Гос. номер',
    vin:'VIN', bank_name:'Банк', account_number:'Расчётный счёт',
    tax_office:'Налоговая', court_name:'Суд', case_number:'Номер дела', license:'Лицензия'
  };

  var FIELD_PLACEHOLDERS = {
    fio:'Иванов Иван Иванович', passport:'Серия 1234 Номер 567890, выдан...',
    powers_general:'Представлять интересы, подписывать документы...',
    description:'Дополнительная информация', address:'г. Москва, ул. Примерная, д. 1',
    supplier:'ООО Поставщик', goods_list:'Кирпич, цемент, арматура...',
    vehicle_brand:'Toyota Camry', vehicle_number:'А123БВ77', vin:'JTDKN3DU5A0...',
    bank_name:'ПАО Сбербанк', account_number:'40702810...'
  };

  // ======== Utility functions ========
  function fmtDate(d) {
    if (!d) return '—';
    var dt = new Date(d);
    if (isNaN(dt.getTime())) return '—';
    var dd = ('0'+dt.getDate()).slice(-2), mm = ('0'+(dt.getMonth()+1)).slice(-2);
    return dd+'.'+mm+'.'+dt.getFullYear();
  }

  function getProxyStatus(row) {
    if (row.status === 'revoked') return 'revoked';
    if (row.status === 'expired') return 'expired';
    if (!row.valid_until) return row.status === 'active' ? 'active' : (row.status || 'active');
    var now = new Date(), exp = new Date(row.valid_until);
    if (exp < now) return 'expired';
    var diff = (exp - now) / (1000*60*60*24);
    if (diff <= 30) return 'expiring';
    return 'active';
  }

  var STATUS_CFG = {
    active:   {label:'Действует',    cls:'prx-st-active'},
    expiring: {label:'Истекает',     cls:'prx-st-expiring'},
    expired:  {label:'Истекла',      cls:'prx-st-expired'},
    revoked:  {label:'Отозвана',     cls:'prx-st-revoked'}
  };

  function statusBadge(st) {
    var c = STATUS_CFG[st] || STATUS_CFG.active;
    return '<span class="prx-badge '+c.cls+'">'+esc(c.label)+'</span>';
  }

  // ======== State ========
  var state = {
    allRows: [], rows: [], total: 0, page: 1, orderBy: 'id', desc: true,
    filterType: '', filterStatus: '', search: '',
    detailRow: null, loading: false
  };

  // ======== API ========
  function apiHeaders() {
    return { 'Content-Type':'application/json', 'Authorization':'Bearer '+localStorage.getItem('asgard_token') };
  }

  function loadProxies(cb) {
    state.loading = true;
    var params = 'limit=10000&orderBy='+state.orderBy+'&desc='+(state.desc?'true':'false');
    fetch('/api/data/proxies?'+params, {headers: apiHeaders()})
      .then(function(r){ return r.json(); })
      .then(function(d){
        state.allRows = (d.proxies || []).map(function(r){ r._status = getProxyStatus(r); return r; });
        applyFilters();
        state.loading = false;
        if (cb) cb();
      })
      .catch(function(e){ console.error('loadProxies error:', e); state.loading = false; toast('Ошибка загрузки данных', 'error'); });
  }

  function applyFilters() {
    var filtered = state.allRows;
    if (state.filterType) {
      filtered = filtered.filter(function(r){ return r.type === state.filterType; });
    }
    if (state.filterStatus) {
      filtered = filtered.filter(function(r){ return r._status === state.filterStatus; });
    }
    if (state.search) {
      var q = state.search.toLowerCase();
      filtered = filtered.filter(function(r){
        return (r.fio && r.fio.toLowerCase().indexOf(q)>=0) ||
               (r.employee_name && r.employee_name.toLowerCase().indexOf(q)>=0) ||
               (r.number && r.number.toLowerCase().indexOf(q)>=0);
      });
    }
    state.total = filtered.length;
    var start = (state.page - 1) * PAGE_SIZE;
    state.rows = filtered.slice(start, start + PAGE_SIZE);
  }

  function updateProxy(id, data, cb) {
    fetch('/api/data/proxies/'+id, {
      method:'PUT', headers: apiHeaders(), body: JSON.stringify(data)
    }).then(function(r){ return r.json(); }).then(cb)
      .catch(function(e){ toast('Ошибка обновления','error'); });
  }

  function saveNewProxy(data, cb) {
    fetch('/api/data/proxies', {
      method:'POST', headers: apiHeaders(), body: JSON.stringify(data)
    }).then(function(r){ return r.json(); }).then(cb)
      .catch(function(e){ toast('Ошибка сохранения','error'); });
  }

  // ======== Main render ========
  async function render(opts) {
    opts = opts || {};
    var auth = AsgardAuth.requireUser ? await AsgardAuth.requireUser() : null;
    if (!auth) { location.hash = '#/login'; return; }

    var html = '<style>' + getStyles() + '</style><div id="prx-root"><div class="prx-loading">Загрузка...</div></div>';
    if (typeof opts.layout === 'function') {
      await opts.layout(html, { title: opts.title || 'Доверенности' });
    } else {
      var root = document.getElementById('main-content');
      if (root) root.innerHTML = html;
      document.title = 'Доверенности — ASGARD CRM';
    }
    loadProxies(function(){ renderRegistry(); });
  }

  function loadAndRender() {
    applyFilters();
    renderRegistry();
  }

  function reloadFromServer() {
    var el = document.getElementById('prx-root');
    if (el) el.innerHTML = '<div class="prx-loading">Загрузка...</div>';
    loadProxies(function(){ renderRegistry(); });
  }

  // ======== Registry ========
  function renderRegistry() {
    var root = document.getElementById('prx-root');
    if (!root) return;
    // Compute stats from ALL loaded data
    var active=0, expiring=0, expired=0, revoked=0;
    state.allRows.forEach(function(r){
      if(r._status==='active')active++;
      else if(r._status==='expiring')expiring++;
      else if(r._status==='expired')expired++;
      else if(r._status==='revoked')revoked++;
    });
    var totalAll = state.allRows.length;
    var totalPages = Math.ceil(state.total / PAGE_SIZE) || 1;

    var h = '';
    // Stats cards
    h += '<div class="prx-stats">';
    h += '<div class="prx-stat-card"><div class="prx-stat-num">'+totalAll+'</div><div class="prx-stat-lbl">Всего</div></div>';
    h += '<div class="prx-stat-card prx-stat-ok"><div class="prx-stat-num">'+active+'</div><div class="prx-stat-lbl">Действуют</div></div>';
    h += '<div class="prx-stat-card prx-stat-warn"><div class="prx-stat-num">'+expiring+'</div><div class="prx-stat-lbl">Истекают</div></div>';
    h += '<div class="prx-stat-card prx-stat-err"><div class="prx-stat-num">'+expired+'</div><div class="prx-stat-lbl">Истекли</div></div>';
    h += '</div>';

    // Toolbar
    h += '<div class="prx-toolbar">';
    h += '<input type="text" id="prx-search" class="prx-input" placeholder="Поиск по ФИО / номеру..." value="'+esc(state.search)+'">';
    // Type filter
    h += '<select id="prx-ftype" class="prx-select">';
    h += '<option value="">Все типы</option>';
    ['Генеральная','Общая','Получение ТМЦ','Представительство','Строительная площадка','Транспорт/Грузы'].forEach(function(t){
      h += '<option value="'+esc(t)+'"'+(state.filterType===t?' selected':'')+'>'+esc(t)+'</option>';
    });
    h += '</select>';
    // Status filter
    h += '<select id="prx-fstatus" class="prx-select">';
    h += '<option value="">Все статусы</option>';
    [{v:'active',l:'Действует'},{v:'expiring',l:'Истекает'},{v:'expired',l:'Истекла'},{v:'revoked',l:'Отозвана'}].forEach(function(s){
      h += '<option value="'+s.v+'"'+(state.filterStatus===s.v?' selected':'')+'>'+esc(s.l)+'</option>';
    });
    h += '</select>';
    h += '<div class="prx-toolbar-right">';
    h += '<button id="prx-btn-csv" class="prx-btn prx-btn-sec" title="Экспорт CSV">📃 CSV</button>';
    h += '<button id="prx-btn-create" class="prx-btn prx-btn-prim">+ Создать доверенность</button>';
    h += '</div></div>';

    // Table
    h += '<div class="prx-table-wrap"><table class="prx-table"><thead><tr>';
    h += rTh('#', 'id');
    h += rTh('Номер', 'number');
    h += rTh('Тип', 'type');
    h += rTh('На кого (ФИО)', 'fio');
    h += rTh('Выдана', 'issue_date');
    h += rTh('Действует до', 'valid_until');
    h += rTh('Статус', '_status');
    h += '</tr></thead><tbody>';

    if (state.rows.length === 0) {
      h += '<tr><td colspan="7" class="prx-empty">Доверенности не найдены</td></tr>';
    } else {
      state.rows.forEach(function(r) {
        var icon = TYPE_ICONS[r.type] || '📄';
        h += '<tr class="prx-row" data-id="'+r.id+'">';
        h += '<td class="prx-td-id">'+r.id+'</td>';
        h += '<td>'+esc(r.number||'—')+'</td>';
        h += '<td><span class="prx-type-cell">'+icon+' '+esc(r.type||'—')+'</span></td>';
        h += '<td class="prx-td-fio">'+esc(r.fio||r.employee_name||'—')+'</td>';
        h += '<td>'+fmtDate(r.issue_date)+'</td>';
        h += '<td>'+fmtDate(r.valid_until)+'</td>';
        h += '<td>'+statusBadge(r._status)+'</td>';
        h += '</tr>';
      });
    }
    h += '</tbody></table></div>';

    // Pagination
    h += '<div class="prx-pager">';
    h += '<button class="prx-btn prx-btn-page" id="prx-prev"'+(state.page<=1?' disabled':'')+'>◀ Назад</button>';
    h += '<span class="prx-page-info">Стр. '+state.page+' из '+totalPages+' (всего '+state.total+')</span>';
    h += '<button class="prx-btn prx-btn-page" id="prx-next"'+(state.page>=totalPages?' disabled':'')+'>Вперёд ▶</button>';
    h += '</div>';

    // Detail panel placeholder
    h += '<div id="prx-detail" class="prx-detail"></div>';
    h += '<div id="prx-overlay" class="prx-overlay"></div>';

    root.innerHTML = h;
    bindRegistryEvents();
  }

  function rTh(label, col) {
    var arrow = '';
    if (state.orderBy === col) arrow = state.desc ? ' ▼' : ' ▲';
    return '<th class="prx-th" data-sort="'+col+'">'+esc(label)+arrow+'</th>';
  }

  // ======== Events ========
  function bindRegistryEvents() {
    var searchEl = document.getElementById('prx-search');
    var timer;
    if (searchEl) {
      searchEl.addEventListener('input', function(){
        clearTimeout(timer);
        timer = setTimeout(function(){
          state.search = searchEl.value.trim();
          state.page = 1;
          loadAndRender();
        }, 400);
      });
      // Focus search field and set cursor at end
      if (state.search) {
        searchEl.focus();
        searchEl.setSelectionRange(searchEl.value.length, searchEl.value.length);
      }
    }

    var ftEl = document.getElementById('prx-ftype');
    if (ftEl) ftEl.addEventListener('change', function(){
      state.filterType = ftEl.value; state.page = 1; loadAndRender();
    });
    var fsEl = document.getElementById('prx-fstatus');
    if (fsEl) fsEl.addEventListener('change', function(){
      state.filterStatus = fsEl.value; state.page = 1; loadAndRender();
    });

    // Sort - need to re-fetch from server for proper ordering
    var ths = document.querySelectorAll('.prx-th[data-sort]');
    ths.forEach(function(th){
      th.addEventListener('click', function(){
        var col = th.getAttribute('data-sort');
        if (col === '_status') return;
        if (state.orderBy === col) { state.desc = !state.desc; }
        else { state.orderBy = col; state.desc = true; }
        state.page = 1;
        reloadFromServer();
      });
    });

    // Row click
    var rows = document.querySelectorAll('.prx-row');
    rows.forEach(function(row){
      row.addEventListener('click', function(){
        var id = parseInt(row.getAttribute('data-id'));
        var found = state.rows.find(function(r){ return r.id === id; });
        if (found) openDetail(found);
      });
    });

    // Pagination
    var prevBtn = document.getElementById('prx-prev');
    var nextBtn = document.getElementById('prx-next');
    if (prevBtn) prevBtn.addEventListener('click', function(){ if(state.page>1){state.page--;loadAndRender();} });
    if (nextBtn) nextBtn.addEventListener('click', function(){ state.page++; loadAndRender(); });

    // Create button
    var createBtn = document.getElementById('prx-btn-create');
    if (createBtn) createBtn.addEventListener('click', showCreateModal);

    // CSV button
    var csvBtn = document.getElementById('prx-btn-csv');
    if (csvBtn) csvBtn.addEventListener('click', exportCSV);

    // Overlay click to close detail
    var overlay = document.getElementById('prx-overlay');
    if (overlay) overlay.addEventListener('click', closeDetail);
  }

  // ======== Detail panel ========
  function openDetail(row) {
    state.detailRow = row;
    var panel = document.getElementById('prx-detail');
    var overlay = document.getElementById('prx-overlay');
    if (!panel) return;

    var icon = TYPE_ICONS[row.type] || '📄';
    var st = row._status || getProxyStatus(row);
    var h = '<div class="prx-detail-header">';
    h += '<div class="prx-detail-title">'+icon+' '+esc(row.type||'Доверенность')+'</div>';
    h += '<button class="prx-detail-close" id="prx-detail-close">✕</button>';
    h += '</div>';
    h += statusBadge(st);
    h += '<div class="prx-detail-body">';

    // Info rows
    var fields = [
      ['Номер', row.number],
      ['ФИО', row.fio || row.employee_name],
      ['Паспорт', row.passport],
      ['Дата выдачи', fmtDate(row.issue_date)],
      ['Действует до', fmtDate(row.valid_until)],
      ['Полномочия', row.powers_general],
      ['Описание', row.description],
      ['Адрес', row.address],
      ['Поставщик', row.supplier],
      ['Перечень ТМЦ', row.goods_list],
      ['Марка ТС', row.vehicle_brand],
      ['Гос. номер', row.vehicle_number],
      ['VIN', row.vin],
      ['Банк', row.bank_name],
      ['Расчётный счёт', row.account_number],
      ['Налоговая', row.tax_office],
      ['Суд', row.court_name],
      ['Номер дела', row.case_number],
      ['Лицензия', row.license]
    ];
    fields.forEach(function(f){
      if (f[1]) {
        h += '<div class="prx-detail-row"><span class="prx-detail-label">'+esc(f[0])+':</span><span class="prx-detail-value">'+esc(f[1])+'</span></div>';
      }
    });
    h += '</div>';

    // Actions
    h += '<div class="prx-detail-actions">';
    h += '<button class="prx-btn prx-btn-prim" id="prx-dl-doc">📄 Скачать .doc</button>';
    if (st !== 'revoked' && st !== 'expired') {
      h += '<button class="prx-btn prx-btn-danger" id="prx-revoke">⛔ Отозвать</button>';
    }
    h += '</div>';

    panel.innerHTML = h;
    panel.classList.add('prx-detail-open');
    if (overlay) overlay.classList.add('prx-overlay-show');

    // Bind detail events
    var closeBtn = document.getElementById('prx-detail-close');
    if (closeBtn) closeBtn.addEventListener('click', closeDetail);
    var dlBtn = document.getElementById('prx-dl-doc');
    if (dlBtn) dlBtn.addEventListener('click', function(){ dlFromDetail(row); });
    var revokeBtn = document.getElementById('prx-revoke');
    if (revokeBtn) revokeBtn.addEventListener('click', function(){ revokeProxy(row); });
  }

  function closeDetail() {
    var panel = document.getElementById('prx-detail');
    var overlay = document.getElementById('prx-overlay');
    if (panel) panel.classList.remove('prx-detail-open');
    if (overlay) overlay.classList.remove('prx-overlay-show');
    state.detailRow = null;
  }

  function revokeProxy(row) {
    if (!confirm('Отозвать доверенность #'+row.id+'?')) return;
    updateProxy(row.id, {status:'revoked'}, function(){
      toast('Доверенность отозвана', 'success');
      closeDetail();
      reloadFromServer();
    });
  }

  function dlFromDetail(row) {
    var typeId = TYPE_DB_LABELS[row.type] || 'common';
    downloadProxyDoc(row, typeId);
  }

  // ======== Create modal ========
  function showCreateModal() {
    var h = '<div class="prx-create-grid">';
    PROXY_TYPES.forEach(function(t){
      h += '<div class="prx-create-card" data-type="'+t.id+'">';
      h += '<div class="prx-create-icon">'+t.icon+'</div>';
      h += '<div class="prx-create-label">'+esc(t.label)+'</div>';
      h += '<div class="prx-create-desc">'+esc(t.desc)+'</div>';
      h += '</div>';
    });
    h += '</div>';

    showModal('Выберите тип доверенности', h, {width:720});

    setTimeout(function(){
      var cards = document.querySelectorAll('.prx-create-card');
      cards.forEach(function(card){
        card.addEventListener('click', function(){
          var typeId = card.getAttribute('data-type');
          openProxyForm(typeId);
        });
      });
    }, 100);
  }

  // ======== Proxy form ========
  function openProxyForm(typeId) {
    var tpl = TYPE_MAP[typeId];
    if (!tpl) return;
    var h = '<div class="prx-form">';
    h += '<div class="prx-form-title">'+tpl.icon+' '+esc(tpl.label)+'</div>';

    h += '<div class="prx-form-row">';
    h += '<label class="prx-form-label">Номер доверенности</label>';
    h += '<input type="text" class="prx-input prx-form-input" id="prx-f-number" placeholder="Например: ДОВ-001">';
    h += '</div>';
    h += '<div class="prx-form-row prx-form-dates">';
    h += '<div><label class="prx-form-label">Дата выдачи</label><input type="date" class="prx-input prx-form-input" id="prx-f-issue"></div>';
    h += '<div><label class="prx-form-label">Действует до</label><input type="date" class="prx-input prx-form-input" id="prx-f-until"></div>';
    h += '</div>';

    tpl.fields.forEach(function(fld){
      var lbl = FIELD_LABELS[fld] || fld;
      var ph = FIELD_PLACEHOLDERS[fld] || '';
      var isTextarea = (fld==='powers_general'||fld==='description'||fld==='goods_list'||fld==='passport');
      h += '<div class="prx-form-row">';
      h += '<label class="prx-form-label">'+esc(lbl)+'</label>';
      if (isTextarea) {
        h += '<textarea class="prx-input prx-form-input prx-textarea" id="prx-f-'+fld+'" placeholder="'+esc(ph)+'"></textarea>';
      } else {
        h += '<input type="text" class="prx-input prx-form-input" id="prx-f-'+fld+'" placeholder="'+esc(ph)+'">';
      }
      h += '</div>';
    });

    h += '<div class="prx-form-actions" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">';
    h += '<span id="prxMimirSlot"></span>';
    h += '<button class="prx-btn prx-btn-sec" id="prx-f-preview">Предпросмотр</button>';
    h += '<button class="prx-btn prx-btn-prim" id="prx-f-save">Сохранить</button>';
    h += '<button class="prx-btn prx-btn-prim" id="prx-f-download">Скачать .doc</button>';
    h += '</div></div>';

    showModal(tpl.icon + ' ' + tpl.label, h, {width:640});

    setTimeout(function(){
      // ── WOW: Мимир автозаполнение для доверенностей ──
      // Доверенности используют id="prx-f-{field}", маппинг через tpl.fields
      if (window.MimirForms) {
        MimirForms.ensureStyles();
        var mimirSlot = document.getElementById('prxMimirSlot');
        if (mimirSlot) {
          var btn = MimirForms.createButton('Мимир');
          btn.classList.add('pulsing');
          mimirSlot.appendChild(btn);
          btn.addEventListener('click', function() {
            btn.disabled = true;
            btn.classList.remove('pulsing');
            btn.innerHTML = '<span class="mimir-form-spinner"></span> Мимир думает\u2026';

            // Skeleton на пустых полях
            tpl.fields.forEach(function(fld) {
              var el = document.getElementById('prx-f-' + fld);
              if (el && !el.value) el.classList.add('mimir-field-skeleton');
            });

            var token = localStorage.getItem('asgard_token');
            fetch('/api/mimir/suggest-form', {
              method: 'POST',
              headers: { 'Content-Type':'application/json', 'Authorization':'Bearer ' + token },
              body: JSON.stringify({
                form_type: 'proxy',
                context: {
                  proxy_type: tpl.label,
                  existing_fields: collectFormData(tpl)
                }
              })
            }).then(function(r) { return r.json(); })
            .then(function(data) {
              // Убираем skeleton
              tpl.fields.forEach(function(fld) {
                var el = document.getElementById('prx-f-' + fld);
                if (el) el.classList.remove('mimir-field-skeleton');
              });

              if (data.fields) {
                var filled = 0;
                tpl.fields.forEach(function(fld, i) {
                  var el = document.getElementById('prx-f-' + fld);
                  var val = data.fields[fld];
                  if (!el || !val || el.value) return;
                  // Cascade с задержкой
                  setTimeout(function() {
                    if (el.tagName === 'TEXTAREA') {
                      MimirForms.typewriterFill(el, val);
                    } else {
                      el.value = val;
                    }
                    el.classList.add('mimir-field-filled');
                    setTimeout(function() { el.classList.remove('mimir-field-filled'); }, 1200);
                    filled++;
                  }, i * 130);
                });
                toast('Мимир', 'Заполнил ' + (filled || Object.keys(data.fields).length) + ' полей', 'ok');
              } else {
                toast('Мимир', 'Недостаточно контекста', 'warn');
              }
            }).catch(function(e) {
              tpl.fields.forEach(function(fld) {
                var el = document.getElementById('prx-f-' + fld);
                if (el) el.classList.remove('mimir-field-skeleton');
              });
              toast('Мимир', e.message || 'Ошибка', 'err');
            }).finally(function() {
              btn.disabled = false;
              btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="rgba(255,255,255,.2)"/></svg> Мимир';
              btn.classList.add('pulsing');
            });
          });
        }
      }

      var previewBtn = document.getElementById('prx-f-preview');
      var saveBtn = document.getElementById('prx-f-save');
      var dlBtn = document.getElementById('prx-f-download');
      if (previewBtn) previewBtn.addEventListener('click', function(){
        var data = collectFormData(tpl);
        var html = generatePreviewHtml(data, tpl);
        showModal('Предпросмотр', '<div class="prx-preview">'+html+'</div>', {width:700});
      });
      if (saveBtn) saveBtn.addEventListener('click', function(){
        var data = collectFormData(tpl);
        data.type = tpl.label;
        data.status = 'active';
        saveNewProxy(data, function(res){
          toast('Доверенность сохранена', 'success');
          reloadFromServer();
        });
      });
      if (dlBtn) dlBtn.addEventListener('click', function(){
        var data = collectFormData(tpl);
        downloadProxyDoc(data, tpl.id);
      });
    }, 100);
  }

  function collectFormData(tpl) {
    var data = {};
    var numEl = document.getElementById('prx-f-number');
    var issEl = document.getElementById('prx-f-issue');
    var untilEl = document.getElementById('prx-f-until');
    if (numEl) data.number = numEl.value;
    if (issEl) data.issue_date = issEl.value;
    if (untilEl) data.valid_until = untilEl.value;
    tpl.fields.forEach(function(fld){
      var el = document.getElementById('prx-f-'+fld);
      if (el) data[fld] = el.value;
    });
    return data;
  }

  // ======== CSV export ========
  function exportCSV() {
    fetch('/api/data/proxies?limit=10000', {headers: apiHeaders()})
      .then(function(r){ return r.json(); })
      .then(function(d){
        var rows = d.proxies || [];
        if (!rows.length) { toast('Нет данных для экспорта', 'warning'); return; }
        var headers = ['ID','Номер','Тип','ФИО','Дата выдачи','Действует до','Статус','Полномочия','Описание'];
        var csvLines = [headers.join(';')];
        var nlRe = /[\n\r;]/g;
        rows.forEach(function(r){
          var st = getProxyStatus(r);
          var stLabel = (STATUS_CFG[st]||{}).label||st;
          var pw = (''+(r.powers_general||'')).replace(nlRe,' ');
          var desc = (''+(r.description||'')).replace(nlRe,' ');
          csvLines.push([r.id,r.number||'',r.type||'',r.fio||r.employee_name||'',fmtDate(r.issue_date),fmtDate(r.valid_until),stLabel,pw,desc].join(';'));
        });
        var bom = '\ufeff';
        var blob = new Blob([bom+csvLines.join('\n')], {type:'text/csv;charset=utf-8'});
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = 'doverennosti_'+new Date().toISOString().slice(0,10)+'.csv';
        a.click(); URL.revokeObjectURL(url);
        toast('CSV файл скачан', 'success');
      });
  }

  // ======== Doc generation ========
  function generatePreviewHtml(data, tpl) {
    var h = '<h2 style="text-align:center">ДОВЕРЕННОСТЬ</h2>';
    if (data.number) h += '<p style="text-align:center">№ '+esc(data.number)+'</p>';
    if (data.issue_date) h += '<p>Дата выдачи: '+fmtDate(data.issue_date)+'</p>';
    if (data.valid_until) h += '<p>Действительна до: '+fmtDate(data.valid_until)+'</p>';
    h += '<p>Тип: '+esc(tpl.label)+'</p>';
    tpl.fields.forEach(function(fld){
      var val = data[fld];
      if (val) {
        h += '<p><strong>'+esc(FIELD_LABELS[fld]||fld)+':</strong> '+esc(val)+'</p>';
      }
    });
    return h;
  }

  function downloadProxyDoc(data, typeId) {
    var content = generateDocContent(data, typeId);
    var blob = new Blob([content], {type:'application/msword'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'doverennost_'+(data.number||'new')+'.doc';
    a.click();
    URL.revokeObjectURL(url);
    toast('Документ скачан', 'success');
  }

  function generateDocContent(data, typeId) {
    var tpl = TYPE_MAP[typeId];
    var h = '<html><head><meta charset="utf-8"><style>body{font-family:Times New Roman,serif;font-size:14pt;margin:2cm}h1{text-align:center;font-size:18pt}h2{text-align:center;font-size:16pt}.center{text-align:center}.field{margin:10px 0}.label{font-weight:bold}</style></head><body>';
    h += '<h1>ДОВЕРЕННОСТЬ</h1>';
    if (data.number) h += '<p class="center">№ '+esc(data.number)+'</p>';
    h += '<p class="center">г. Москва</p>';
    if (data.issue_date) h += '<p class="center">'+fmtDate(data.issue_date)+'</p>';
    h += '<p>ООО «Асгард Сервис», в лице Генерального директора, действующего на основании Устава, настоящей доверенностью уполномочивает:</p>';
    if (data.fio) h += '<p class="field"><span class="label">ФИО:</span> '+esc(data.fio)+'</p>';
    if (data.passport) h += '<p class="field"><span class="label">Паспорт:</span> '+esc(data.passport)+'</p>';

    if (tpl) {
      tpl.fields.forEach(function(fld){
        if (fld !== 'fio' && fld !== 'passport' && data[fld]) {
          h += '<p class="field"><span class="label">'+esc(FIELD_LABELS[fld]||fld)+':</span> '+esc(data[fld])+'</p>';
        }
      });
    }

    if (data.valid_until) h += '<p class="field">Доверенность действительна до '+fmtDate(data.valid_until)+'.</p>';
    else h += '<p class="field">Доверенность действительна в течение одного года со дня выдачи.</p>';
    h += '<br><br><p>Генеральный директор _______________ / _______________</p>';
    h += '<p>М.П.</p>';
    h += '</body></html>';
    return h;
  }

  // ======== CSS Styles ========
  function getStyles() {
    return '#prx-root { max-width:1400px; margin:0 auto; padding:20px; }\n.prx-loading { text-align:center; padding:60px; color:var(--muted); font-size:1.1em; }\n\n.prx-stats { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin-bottom:24px; }\n.prx-stat-card { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:20px; text-align:center; transition:transform .2s,box-shadow .2s; }\n.prx-stat-card:hover { transform:translateY(-2px); box-shadow:0 8px 24px rgba(0,0,0,.3); }\n.prx-stat-num { font-size:2em; font-weight:700; color:var(--text); }\n.prx-stat-lbl { color:var(--muted); font-size:.85em; margin-top:4px; }\n.prx-stat-ok .prx-stat-num { color:var(--ok-t); }\n.prx-stat-warn .prx-stat-num { color:var(--amber,#f0ad4e); }\n.prx-stat-err .prx-stat-num { color:var(--err-t); }\n\n.prx-toolbar { display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-bottom:20px; }\n.prx-input { background:var(--surface,#1a1e2e); border:1px solid var(--border); color:var(--text); padding:10px 14px; border-radius:8px; font-size:.9em; outline:none; transition:border .2s; }\n.prx-input:focus { border-color:var(--gold,#c8a84e); }\n#prx-search { min-width:260px; }\n.prx-select { background:var(--surface,#1a1e2e); border:1px solid var(--border); color:var(--text); padding:10px 14px; border-radius:8px; font-size:.9em; cursor:pointer; }\n.prx-toolbar-right { margin-left:auto; display:flex; gap:10px; }\n\n.prx-btn { padding:10px 18px; border-radius:8px; border:none; font-size:.9em; cursor:pointer; transition:all .2s; font-weight:500; }\n.prx-btn:disabled { opacity:.5; cursor:not-allowed; }\n.prx-btn-prim { background:linear-gradient(135deg,var(--gold,#c8a84e),#a08030); color:#1a1a2e; }\n.prx-btn-prim:hover { filter:brightness(1.1); transform:translateY(-1px); }\n.prx-btn-sec { background:var(--surface,#1a1e2e); color:var(--text); border:1px solid var(--border); }\n.prx-btn-sec:hover { border-color:var(--gold,#c8a84e); }\n.prx-btn-danger { background:#c0392b; color:#fff; }\n.prx-btn-danger:hover { background:#e74c3c; }\n.prx-btn-page { background:var(--surface,#1a1e2e); color:var(--text); border:1px solid var(--border); padding:8px 16px; }\n.prx-btn-page:hover:not(:disabled) { border-color:var(--gold,#c8a84e); }\n\n.prx-table-wrap { overflow-x:auto; border-radius:12px; border:1px solid var(--border); margin-bottom:20px; }\n.prx-table { width:100%; border-collapse:collapse; }\n.prx-th { background:var(--surface,#1a1e2e); color:var(--muted); padding:14px 16px; text-align:left; font-size:.8em; text-transform:uppercase; letter-spacing:.05em; cursor:pointer; user-select:none; white-space:nowrap; border-bottom:2px solid var(--border); }\n.prx-th:hover { color:var(--gold,#c8a84e); }\n.prx-row { background:var(--card); border-bottom:1px solid var(--border); cursor:pointer; transition:background .15s; }\n.prx-row:hover { background:var(--surface,#1a1e2e); }\n.prx-row td { padding:14px 16px; color:var(--text); font-size:.92em; }\n.prx-td-id { color:var(--muted); font-size:.85em; }\n.prx-td-fio { font-weight:500; max-width:250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }\n.prx-type-cell { display:inline-flex; align-items:center; gap:6px; }\n.prx-empty { text-align:center; padding:40px; color:var(--muted); }\n\n.prx-badge { padding:5px 12px; border-radius:20px; font-size:.8em; font-weight:600; display:inline-block; }\n.prx-st-active { background:rgba(46,204,113,.15); color:var(--ok-t,#2ecc71); }\n.prx-st-expiring { background:rgba(240,173,78,.15); color:var(--amber,#f0ad4e); }\n.prx-st-expired { background:rgba(231,76,60,.15); color:var(--err-t,#e74c3c); }\n.prx-st-revoked { background:rgba(149,165,166,.15); color:#95a5a6; }\n\n.prx-pager { display:flex; align-items:center; justify-content:center; gap:16px; padding:16px 0; }\n.prx-page-info { color:var(--muted); font-size:.9em; }\n\n.prx-overlay { position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,.5); z-index:999; opacity:0; pointer-events:none; transition:opacity .3s; }\n.prx-overlay-show { opacity:1; pointer-events:auto; }\n\n.prx-detail { position:fixed; top:0; right:-480px; width:460px; height:100vh; background:var(--card); border-left:1px solid var(--border); z-index:1000; transition:right .3s ease; overflow-y:auto; box-shadow:-4px 0 24px rgba(0,0,0,.4); }\n.prx-detail-open { right:0; }\n.prx-detail-header { display:flex; align-items:center; justify-content:space-between; padding:24px; border-bottom:1px solid var(--border); }\n.prx-detail-title { font-size:1.2em; font-weight:600; color:var(--text); }\n.prx-detail-close { background:none; border:none; color:var(--muted); font-size:1.4em; cursor:pointer; padding:4px 8px; border-radius:6px; }\n.prx-detail-close:hover { color:var(--text); background:var(--surface,#1a1e2e); }\n.prx-detail-body { padding:20px 24px; }\n.prx-detail-row { margin-bottom:14px; }\n.prx-detail-label { color:var(--muted); font-size:.82em; text-transform:uppercase; letter-spacing:.04em; display:block; margin-bottom:2px; }\n.prx-detail-value { color:var(--text); font-size:.95em; word-break:break-word; }\n.prx-detail-actions { padding:20px 24px; border-top:1px solid var(--border); display:flex; gap:12px; }\n\n.prx-create-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:16px; }\n.prx-create-card { background:var(--surface,#1a1e2e); border:1px solid var(--border); border-radius:12px; padding:24px 16px; text-align:center; cursor:pointer; transition:all .2s; }\n.prx-create-card:hover { border-color:var(--gold,#c8a84e); transform:translateY(-3px); box-shadow:0 8px 24px rgba(0,0,0,.3); }\n.prx-create-icon { font-size:2.4em; margin-bottom:12px; }\n.prx-create-label { font-weight:600; color:var(--text); margin-bottom:6px; }\n.prx-create-desc { color:var(--muted); font-size:.82em; line-height:1.4; }\n\n.prx-form { padding:8px 0; }\n.prx-form-title { font-size:1.1em; font-weight:600; color:var(--text); margin-bottom:20px; }\n.prx-form-row { margin-bottom:16px; }\n.prx-form-label { display:block; color:var(--muted); font-size:.82em; text-transform:uppercase; letter-spacing:.04em; margin-bottom:6px; }\n.prx-form-input { width:100%; box-sizing:border-box; }\n.prx-form-dates { display:grid; grid-template-columns:1fr 1fr; gap:16px; }\n.prx-textarea { min-height:80px; resize:vertical; }\n.prx-form-actions { display:flex; gap:12px; margin-top:20px; padding-top:16px; border-top:1px solid var(--border); }\n.prx-preview { padding:20px; background:#fff; color:#222; border-radius:8px; max-height:60vh; overflow-y:auto; }\n.prx-preview h2 { margin:0 0 10px; }\n.prx-preview p { margin:6px 0; }\n\n@media(max-width:768px){\n  .prx-stats{grid-template-columns:repeat(2,1fr)}\n  .prx-toolbar{flex-direction:column;align-items:stretch}\n  .prx-toolbar-right{margin-left:0;justify-content:flex-end}\n  #prx-search{min-width:auto}\n  .prx-detail{width:100vw;right:-100vw}\n  .prx-create-grid{grid-template-columns:repeat(2,1fr)}\n  .prx-form-dates{grid-template-columns:1fr}\n}\n';
  }

  // ======== Public API ========
  return { render: render, PROXY_TYPES: PROXY_TYPES };
})();