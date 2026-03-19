/* ================================================================
   AsgardEquipment - FaceKit Premium Edition v2
   Enhanced equipment management with card view, kits, grouping,
   search, works integration. Premium UX with skeleton loading,
   server pagination, custom modals, real export/QR.
   ================================================================ */
window.AsgardEquipment = (function () {
  'use strict';
  const { $, $$, esc, toast, showModal, closeModal, skeleton, makeResponsiveTable, emptyState, money } = AsgardUI;

  /* --- CLOSURE-SCOPED VARIABLES (A12) --- */
  let _pendingPhoto = null;
  let _pendingIcon = null;
  let _availableCache = null;

  /* --- STATE --- */
  let categories = [], objects = [], warehouses = [], pmList = [], worksList = [];
  let allEquipment = [], filteredEquipment = [], kits = [], stats = {};
  let currentUser = null, currentLayout = null;
  let viewMode   = localStorage.getItem('fk_view')  || 'cards';
  let groupBy    = localStorage.getItem('fk_group') || 'category';
  let searchTerm = '', activeFilters = {};
  let collapsedGroups = new Set();
  let currentOffset = 0, totalCount = 0;
  const PAGE_SIZE = 50;

  /* --- CONSTANTS --- */
  const STATUS = {
    on_warehouse: { l: 'На складе',  c: '#22c55e', i: '📦' },
    issued:       { l: 'Выдано',     c: '#3b82f6', i: '👷' },
    in_transit:   { l: 'В пути',     c: '#f59e0b', i: '🚚' },
    repair:       { l: 'Ремонт',     c: '#ef4444', i: '🔧' },
    broken:       { l: 'Сломано',    c: '#dc2626', i: '❌' },
    written_off:  { l: 'Списано',    c: '#6b7280', i: '🗑️' }
  };
  const COND = {
    new:          { l: 'Новое',  c: '#22c55e' },
    good:         { l: 'Хорошее', c: '#3b82f6' },
    satisfactory: { l: 'Удовл.',  c: '#f59e0b' },
    poor:         { l: 'Плохое',  c: '#ef4444' },
    broken:       { l: 'Неисправно', c: '#991b1b' }
  };

  /* --- LUCIDE ICON NAME TO EMOJI MAPPING --- */
  const LUCIDE_EMOJI = {
    wrench: '🔧', truck: '🚛', package: '📦', cpu: '⚙️',
    shield: '🛡️', gauge: '🔍', 'flask-conical': '🧪',
    hammer: '🔨', scissors: '✂️', zap: '⚡', thermometer: '🌡️',
    ruler: '📏', camera: '📷', 'hard-hat': '⛑️', cog: '⚙️'
  };
  function resolveIcon(eq) {
    var icon = eq.custom_icon || eq.category_icon || '📦';
    return LUCIDE_EMOJI[icon] || icon;
  }

  /* --- HELPERS --- */
  function fmtDate(d) { if(!d) return '—'; try { return new Date(d).toLocaleDateString('ru-RU'); } catch(_) { return '—'; } }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  /* --- A1: api() with error handling --- */
  async function api(url, opts = {}) {
    const auth = await AsgardAuth.getAuth();
    const h = { 'Authorization': 'Bearer ' + auth.token, ...(opts.headers||{}) };
    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
      h['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const r = await fetch(url, { ...opts, headers: h });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw { status: r.status, message: err.message || 'Ошибка сервера', data: err };
    }
    return r.json();
  }

  function highlightSearch(text) {
    if (!searchTerm) return esc(text||'');
    const safe = esc(text||'');
    const re = new RegExp('(' + searchTerm.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'gi');
    return safe.replace(re, '<mark class="fk-hl">$1</mark>');
  }

  /* --- A13: Deduplicated option helpers --- */
  function optionsHtml(list, valueFn, labelFn, selectedVal) {
    return list.map(i => {
      const v = valueFn(i);
      const sel = selectedVal !== undefined && String(v) === String(selectedVal) ? ' selected' : '';
      return '<option value="' + v + '"' + sel + '>' + esc(labelFn(i)) + '</option>';
    }).join('');
  }
  const catOpts = (sel) => optionsHtml(categories, c=>c.id, c=>(c.icon||'')+' '+c.name, sel);
  const objOpts = (sel) => optionsHtml(objects, o=>o.id, o=>o.name, sel);
  const whOpts  = (sel) => optionsHtml(warehouses, w=>w.id, w=>w.name, sel);
  const pmOpts  = (sel) => optionsHtml(pmList, p=>p.id, p=>p.name, sel);
  const workOpts = (sel) => optionsHtml(worksList.filter(w=>w.work_status!=='Завершена'), w=>w.id, w=>(w.work_number||'')+' — '+(w.work_title||w.customer_name||''), sel);
  const statusFilterOpts = () => Object.entries(STATUS).filter(([k])=>k!=='written_off').map(([k,v])=>'<option value="'+k+'">'+v.i+' '+v.l+'</option>').join('');
  const condOpts = (sel) => Object.entries(COND).map(([k,v])=>'<option value="'+k+'"'+(sel===k?' selected':'')+'>'+v.l+'</option>').join('');

  /* --- A4: Custom modals instead of prompt/confirm --- */
  function askConfirm(title, message) {
    return new Promise(resolve => {
      showModal({ title: title, html: '<p style="font-size:14px;margin:0 0 16px">' + esc(message) + '</p>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end">' +
        '<button class="btn ghost" id="fkConfirmNo">Отмена</button>' +
        '<button class="btn" id="fkConfirmYes">Подтвердить</button></div>',
        onMount: function() {
          document.getElementById('fkConfirmYes').onclick = function() { closeModal(); resolve(true); };
          document.getElementById('fkConfirmNo').onclick = function() { closeModal(); resolve(false); };
        }
      });
    });
  }

  function askInput(title, placeholder) {
    return new Promise(resolve => {
      showModal({ title: title, html: '<textarea id="fkAskInput" class="inp" rows="3" placeholder="' + esc(placeholder||'') + '" style="width:100%;margin-bottom:16px"></textarea>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end">' +
        '<button class="btn ghost" id="fkAskCancel">Отмена</button>' +
        '<button class="btn" id="fkAskOk">OK</button></div>',
        onMount: function() {
          document.getElementById('fkAskOk').onclick = function() {
            var v = document.getElementById('fkAskInput').value.trim();
            closeModal(); resolve(v || null);
          };
          document.getElementById('fkAskCancel').onclick = function() { closeModal(); resolve(null); };
        }
      });
    });
  }

  /* --- A9: Animated counter helper --- */
  function animateCounter(el, target) {
    var start = 0, duration = 600, startTime = null;
    target = parseInt(target) || 0;
    function step(ts) {
      if (!startTime) startTime = ts;
      var progress = Math.min((ts - startTime) / duration, 1);
      el.textContent = Math.floor(progress * target);
      if (progress < 1) requestAnimationFrame(step);
      else el.textContent = target;
    }
    requestAnimationFrame(step);
  }

  /* --- A3: Button loading state helpers --- */
  function btnLoading(btn, text) {
    if (!btn) return;
    btn.disabled = true;
    btn.dataset.origText = btn.innerHTML;
    btn.innerHTML = '<span class="fk-spinner"></span> ' + (text||'');
  }
  function btnReset(btn) {
    if (!btn) return;
    btn.disabled = false;
    btn.innerHTML = btn.dataset.origText || '';
  }

  /* --- ICON LIBRARY --- */
  var ICON_LIB = [
    { cat: 'Инструменты', icons: ['🔧','🔨','🪛','🪚','🗜️','⚙️','🔩','🪝','🔗','🧲','🪜','🛠️'] },
    { cat: 'Насосы / Вода', icons: ['💧','🚿','💦','🌊','🫧','🪠','🚰','🧊'] },
    { cat: 'Электрика', icons: ['⚡','🔌','💡','🔋','🔦','🪫','🏮','💠'] },
    { cat: 'Измерения', icons: ['📏','📐','🌡️','⏱️','🧭','🔬','🔭','⏲️'] },
    { cat: 'Сварка / Огонь', icons: ['🔥','🧯','⚗️','🪨','💎','🫠','♨️'] },
    { cat: 'Транспорт', icons: ['🚗','🚛','🏗️','🚜','🚐','🛻','🏎️','🚲'] },
    { cat: 'СИЗ', icons: ['🦺','🧤','🥽','👷','🪖','🫁','👓','🧣'] },
    { cat: 'Ёмкости', icons: ['🛢️','🪣','🧪','🧫','🏺','🫙','🍶','🥫'] },
    { cat: 'Стройка', icons: ['🧱','🪵','🏗️','🪨','🏠','🪟','🪞','🚧'] },
    { cat: 'Уборка / Хим', icons: ['🧹','🧽','🧴','🧼','🫧','🪥','🧻','♻️'] },
    { cat: 'Техника / IT', icons: ['💻','🖨️','📱','📷','🖥️','⌨️','🖱️','📡'] },
    { cat: 'Канцелярия', icons: ['📋','📁','📦','🗃️','🏷️','📌','✂️','📎'] },
    { cat: 'Прочее', icons: ['🔑','🔒','🪪','📡','🔔','⚓','🧰','🎯','🏆','⭐','🎪','🪤'] }
  ];

  function openIconPicker(currentIcon, onSelect) {
    var selected = currentIcon || '';
    var html = '<div>' +
      '<input class="fk-avail-search" id="fkIconSearch" placeholder="Поиск иконки..." style="margin-bottom:12px"/>' +
      '<div class="fk-icon-picker" id="fkIconGrid">' +
        ICON_LIB.map(function(g) { return '<div class="fk-icon-cat">' + esc(g.cat) + '</div>' +
          '<div class="fk-icon-grid">' +
            g.icons.map(function(ic) { return '<div class="fk-icon-item ' + (ic===selected?'selected':'') + '" data-icon="' + ic + '" title="' + esc(g.cat) + '">' + ic + '</div>'; }).join('') +
          '</div>'; }).join('') +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">' +
        (selected ? '<button class="btn ghost" id="fkIconClear">🗑️ Убрать</button>' : '') +
        '<button class="btn ghost" onclick="AsgardUI.closeModal()">Отмена</button>' +
      '</div></div>';
    showModal('Выберите иконку', html);
    document.querySelectorAll('.fk-icon-item').forEach(function(el) {
      el.addEventListener('click', function() { onSelect(el.dataset.icon); closeModal(); });
    });
    var clearBtn = document.getElementById('fkIconClear');
    if (clearBtn) clearBtn.addEventListener('click', function() { onSelect(null); closeModal(); });
    var searchIn = document.getElementById('fkIconSearch');
    if (searchIn) searchIn.addEventListener('input', function(e) {
      var q = e.target.value.toLowerCase();
      document.querySelectorAll('.fk-icon-cat').forEach(function(cat) {
        var match = !q || cat.textContent.toLowerCase().includes(q);
        cat.style.display = match ? '' : 'none';
        var grid = cat.nextElementSibling;
        if (grid) grid.style.display = match ? '' : 'none';
      });
    });
  }

  /* --- PHOTO UPLOAD HELPERS --- */
  function renderPhotoZone(currentPhotoUrl, currentIcon, eqId) {
    var hasPhoto = currentPhotoUrl && !currentPhotoUrl.startsWith('icon:');
    var hasIcon = currentIcon;
    return '<div class="fk-photo-zone" id="fkPhotoZone" data-eq-id="' + (eqId||'') + '">' +
      (hasPhoto
        ? '<img class="fk-photo-preview" src="' + esc(currentPhotoUrl) + '" alt=""/>'
        : hasIcon
          ? '<span style="font-size:64px">' + (LUCIDE_EMOJI[currentIcon] || currentIcon) + '</span>'
          : '<div class="fk-photo-zone-icon">📷</div><div class="fk-photo-zone-text">Перетащите фото сюда или <b>выберите файл</b></div>'
      ) +
      '<input type="file" id="fkPhotoInput" accept="image/*" style="display:none"/>' +
      '<div class="fk-photo-actions">' +
        '<button type="button" class="btn mini ghost" onclick="document.getElementById(\'fkPhotoInput\').click()">📷 Фото</button>' +
        '<button type="button" class="btn mini ghost" onclick="AsgardEquipment.pickIcon(' + (eqId||0) + ')">😀 Иконка</button>' +
        (hasPhoto || hasIcon ? '<button type="button" class="btn mini ghost" onclick="AsgardEquipment.removePhoto(' + eqId + ')">🗑️</button>' : '') +
      '</div></div>';
  }

  function initPhotoZone() {
    var zone = document.getElementById('fkPhotoZone');
    var input = document.getElementById('fkPhotoInput');
    if (!zone || !input) return;
    zone.addEventListener('dragover', function(e) { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', function() { zone.classList.remove('dragover'); });
    zone.addEventListener('drop', function(e) {
      e.preventDefault(); zone.classList.remove('dragover');
      var file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) handlePhotoFile(file, zone.dataset.eqId);
    });
    input.addEventListener('change', function() { if (input.files[0]) handlePhotoFile(input.files[0], zone.dataset.eqId); });
    zone.addEventListener('click', function(e) {
      if (e.target === zone || e.target.classList.contains('fk-photo-zone-icon') || e.target.classList.contains('fk-photo-zone-text')) {
        input.click();
      }
    });
  }

  async function handlePhotoFile(file, eqId) {
    if (!eqId || eqId === '0') {
      var reader = new FileReader();
      reader.onload = function(e) {
        var zone = document.getElementById('fkPhotoZone');
        if (!zone) return;
        var existing = zone.querySelector('.fk-photo-preview');
        if (existing) { existing.src = e.target.result; }
        else {
          var img = document.createElement('img');
          img.className = 'fk-photo-preview';
          img.src = e.target.result;
          zone.querySelectorAll('.fk-photo-zone-icon,.fk-photo-zone-text').forEach(function(el) { el.remove(); });
          zone.insertBefore(img, zone.querySelector('input'));
        }
      };
      reader.readAsDataURL(file);
      _pendingPhoto = file;
      return;
    }
    try {
      var fd = new FormData();
      fd.append('file', file);
      var auth = await AsgardAuth.getAuth();
      var r = await fetch('/api/equipment/' + eqId + '/photo', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + auth.token }, body: fd
      });
      var data = await r.json();
      if (data.success) { toast('Успех', 'Фото загружено', 'ok'); loadEquipment(); loadStats(); }
      else toast('Ошибка', data.message || 'Ошибка загрузки', 'err');
    } catch(e) { toast('Ошибка', e.message || 'Не удалось загрузить фото', 'err'); }
  }

  async function uploadPendingPhoto(eqId) {
    if (!_pendingPhoto) return;
    try {
      var fd = new FormData();
      fd.append('file', _pendingPhoto);
      var auth = await AsgardAuth.getAuth();
      await fetch('/api/equipment/' + eqId + '/photo', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + auth.token }, body: fd
      });
    } catch(e) { console.error('Photo upload err:', e); }
    _pendingPhoto = null;
  }

  function pickIcon(eqId) {
    openIconPicker(null, async function(icon) {
      if (eqId && eqId !== 0) {
        try {
          var r = await api('/api/equipment/' + eqId + '/photo', { method: 'POST', body: { custom_icon: icon } });
          if (r.success) { toast('Успех', 'Иконка установлена', 'ok'); loadEquipment(); }
        } catch(e) { toast('Ошибка', e.message || 'Не удалось установить иконку', 'err'); }
      } else {
        _pendingIcon = icon;
        var zone = document.getElementById('fkPhotoZone');
        if (zone) {
          zone.querySelectorAll('.fk-photo-preview,.fk-photo-zone-icon,.fk-photo-zone-text').forEach(function(el) { el.remove(); });
          var span = document.createElement('span');
          span.style.fontSize = '64px';
          span.textContent = icon;
          zone.insertBefore(span, zone.querySelector('input'));
        }
      }
    });
  }

  async function removePhoto(eqId) {
    if (!eqId) return;
    try {
      var r = await api('/api/equipment/' + eqId + '/photo', { method: 'DELETE' });
      if (r.success) { toast('Успех', 'Фото удалено', 'ok'); loadEquipment(); }
    } catch(e) { toast('Ошибка', e.message || 'Не удалось удалить фото', 'err'); }
  }

  /* --- CSS INJECTION (A8, A9 extended) --- */
  var _css = false;
  function injectCSS() {
    if (_css) return; _css = true;
    var s = document.createElement('style');
    s.textContent = `
/* FaceKit Premium v2 Styles */
.fk-page { padding: 24px; max-width: 1600px; margin: 0 auto; }

/* -- Header -- */
.fk-header { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:24px; }
.fk-header h2 { margin:0; font-size:22px; font-weight:700; }
.fk-header-actions { display:flex; gap:8px; flex-wrap:wrap; }

/* -- Metrics row -- */
.fk-metrics { display:flex; gap:14px; overflow-x:auto; padding-bottom:8px; margin-bottom:24px; }
.fk-metric { flex:0 0 auto; min-width:150px; background:var(--bg-card); border-radius:12px; padding:16px 42px 16px 20px;
  border:1px solid var(--border); transition:all .2s; cursor:pointer; position:relative; overflow:hidden; }
.fk-metric:hover { border-color:var(--primary); transform:translateY(-2px); box-shadow:0 4px 16px rgba(0,0,0,.15); }
.fk-metric::before { content:''; position:absolute; top:0; left:0; width:4px; height:100%; background:var(--primary); border-radius:4px 0 0 4px; }
.fk-metric.green::before { background:#22c55e; }
.fk-metric.blue::before { background:#3b82f6; }
.fk-metric.amber::before { background:#f59e0b; }
.fk-metric.red::before { background:#ef4444; }
.fk-metric.purple::before { background:#a855f7; }
.fk-metric-value { font-size:28px; font-weight:800; line-height:1.1; color:var(--text); }
.fk-metric-label { font-size:12px; color:var(--text-muted); margin-top:4px; letter-spacing:.3px; text-transform:uppercase; }
.fk-metric-icon { position:absolute; top:12px; right:14px; font-size:20px; opacity:.6; }

/* -- Toolbar -- */
.fk-toolbar { display:flex; flex-wrap:wrap; gap:12px; align-items:center; margin-bottom:20px;
  background:var(--bg-card); padding:14px 18px; border-radius:12px; border:1px solid var(--border); }
.fk-search { flex:1 1 260px; position:relative; }
.fk-search input { width:100%; padding:10px 14px 10px 38px; border-radius:8px; border:1px solid var(--border);
  background:var(--bg); color:var(--text); font-size:14px; transition:border .2s; box-sizing:border-box; }
.fk-search input:focus { outline:none; border-color:var(--primary); box-shadow:0 0 0 3px rgba(59,130,246,.15); }
.fk-search::before { content:'\\1F50D'; position:absolute; left:12px; top:50%; transform:translateY(-50%); font-size:14px; }
.fk-filters { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
.fk-select { padding:8px 12px; border-radius:8px; border:1px solid var(--border); background:var(--bg); color:var(--text);
  font-size:13px; cursor:pointer; transition:border .2s; }
.fk-select:focus { outline:none; border-color:var(--primary); }
.fk-view-toggle { display:flex; border:1px solid var(--border); border-radius:8px; overflow:hidden; }
.fk-view-btn { padding:8px 14px; border:none; background:var(--bg); color:var(--text-muted); cursor:pointer;
  font-size:13px; transition:all .2s; }
.fk-view-btn.active { background:var(--primary); color:#fff; }
.fk-group-toggle { display:flex; gap:4px; }
.fk-group-btn { padding:6px 12px; border-radius:20px; border:1px solid var(--border); background:var(--bg);
  color:var(--text-muted); font-size:12px; cursor:pointer; transition:all .2s; white-space:nowrap; }
.fk-group-btn.active { background:var(--primary); color:#fff; border-color:var(--primary); }
.fk-group-btn:hover { border-color:var(--primary); }

/* -- Filter chips -- */
.fk-chips { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:16px; }
.fk-chip { display:inline-flex; align-items:center; gap:4px; padding:4px 10px; border-radius:20px;
  background:var(--primary); color:#fff; font-size:12px; cursor:pointer; animation:fk-fadeIn .3s ease both; }
.fk-chip-x { opacity:.7; margin-left:2px; }
.fk-chip-x:hover { opacity:1; }

/* -- Pending requests -- */
.fk-requests { background:var(--bg-card); border-left:4px solid #f59e0b; border-radius:10px; padding:16px;
  margin-bottom:20px; }
.fk-requests h3 { margin:0 0 12px; font-size:15px; }
.fk-req-item { display:flex; justify-content:space-between; align-items:center; padding:10px 12px;
  background:var(--bg); border-radius:8px; margin-bottom:6px; gap:12px; }
.fk-req-info { flex:1; font-size:13px; }
.fk-req-actions { display:flex; gap:6px; }

/* -- Group -- */
.fk-group { margin-bottom:16px; }
.fk-group-header { display:flex; align-items:center; gap:10px; padding:10px 16px; background:var(--bg-card);
  border:1px solid var(--border); border-radius:10px; cursor:pointer; user-select:none; transition:all .2s; }
.fk-group-header:hover { border-color:var(--primary); background:var(--bg-hover,var(--bg-card)); }
.fk-group-chevron { transition:transform .2s; font-size:10px; color:var(--text-muted); }
.fk-group-header.open .fk-group-chevron { transform:rotate(90deg); }
.fk-group-title { font-weight:600; font-size:14px; flex:1; }
.fk-group-count { background:var(--primary); color:#fff; padding:2px 10px; border-radius:20px; font-size:12px;
  font-weight:600; min-width:28px; text-align:center; }
.fk-group-body { padding:14px 0 0; }
.fk-group-body.collapsed { display:none; }

/* -- Cards Grid -- */
.fk-cards { display:grid; grid-template-columns:repeat(auto-fill, minmax(290px, 1fr)); gap:16px; }

/* -- Card with animation A9 -- */
.fk-card { background:var(--bg-card); border:1px solid var(--border); border-radius:14px; padding:0;
  cursor:pointer; transition:all .25s; position:relative; overflow:hidden; animation:fk-fadeIn .3s ease both; }
.fk-card:nth-child(1) { animation-delay:0s; }
.fk-card:nth-child(2) { animation-delay:.05s; }
.fk-card:nth-child(3) { animation-delay:.1s; }
.fk-card:nth-child(4) { animation-delay:.15s; }
.fk-card:nth-child(5) { animation-delay:.2s; }
.fk-card:nth-child(6) { animation-delay:.25s; }
.fk-card:nth-child(7) { animation-delay:.3s; }
.fk-card:nth-child(8) { animation-delay:.35s; }
.fk-card:nth-child(n+9) { animation-delay:.4s; }
.fk-card:hover { border-color:var(--primary); transform:translateY(-3px);
  box-shadow:0 8px 30px rgba(0,0,0,.12); }
.fk-card-top { display:flex; align-items:flex-start; padding:16px 110px 12px 16px; gap:14px; }
.fk-card-photo { width:64px; height:64px; border-radius:12px; background:var(--bg); display:flex;
  align-items:center; justify-content:center; font-size:28px; flex-shrink:0; overflow:hidden;
  border:2px solid var(--border); }
.fk-card-photo img { width:100%; height:100%; object-fit:cover; }
.fk-card-info { flex:1; min-width:0; }
.fk-card-name { font-weight:700; font-size:14px; line-height:1.3; white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis; color:var(--text); }
.fk-card-inv { font-size:11px; color:var(--text-muted); font-family:monospace; margin-top:2px; }
.fk-card-cat { font-size:12px; color:var(--text-muted); margin-top:4px; }
.fk-card-badges { position:absolute; top:12px; right:12px; display:flex; flex-direction:column; gap:4px; align-items:flex-end; }
.fk-badge { padding:3px 10px; border-radius:20px; font-size:11px; font-weight:600; white-space:nowrap; }
.fk-cond-dot { width:8px; height:8px; border-radius:50%; display:inline-block; margin-right:4px; vertical-align:middle; }
.fk-card-body { padding:0 16px 12px; display:flex; flex-direction:column; gap:6px; }
.fk-card-row { display:flex; justify-content:space-between; font-size:12px; }
.fk-card-row .fk-label { color:var(--text-muted); }
.fk-card-row .fk-value { color:var(--text); font-weight:500; max-width:60%; text-align:right;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.fk-card-footer { display:flex; gap:6px; padding:0 16px 14px; }
.fk-card-btn { flex:1; padding:7px 0; border-radius:8px; border:1px solid var(--border); background:var(--bg);
  color:var(--text); font-size:12px; cursor:pointer; text-align:center; transition:all .2s; font-weight:500; }
.fk-card-btn:hover { border-color:var(--primary); color:var(--primary); background:rgba(59,130,246,.05); }
.fk-card-btn.primary { background:var(--primary); color:#fff; border-color:var(--primary); }
.fk-card-btn.primary:hover { opacity:.9; }
.fk-card-btn.danger { color:#ef4444; border-color:#ef4444; }
.fk-card-btn.danger:hover { background:rgba(239,68,68,.08); }

/* -- Table -- */
.fk-table-wrap { overflow-x:auto; -webkit-overflow-scrolling:touch; }
.fk-table { width:100%; border-collapse:separate; border-spacing:0; }
.fk-table th { text-align:left; padding:10px 12px; font-size:12px; color:var(--text-muted);
  border-bottom:2px solid var(--border); font-weight:600; text-transform:uppercase; letter-spacing:.5px; white-space:nowrap; }
.fk-table td { padding:10px 12px; font-size:13px; border-bottom:1px solid var(--border); vertical-align:middle; }
.fk-table tr { cursor:pointer; transition:background .15s; }
.fk-table tr:hover { background:var(--bg-hover,rgba(255,255,255,.03)); }
.fk-table .fk-thumb { width:36px; height:36px; border-radius:8px; object-fit:cover; background:var(--bg);
  display:flex; align-items:center; justify-content:center; font-size:18px; }

/* -- Kits Section -- */
.fk-kits { margin-top:32px; }
.fk-kits-header { display:flex; align-items:center; gap:12px; cursor:pointer; padding:12px 0; }
.fk-kits-header h3 { margin:0; font-size:16px; font-weight:700; }
.fk-kits-count { background:var(--primary); color:#fff; padding:2px 10px; border-radius:20px; font-size:12px; font-weight:600; }
.fk-kits-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:14px; margin-top:14px; }
.fk-kit-card { background:var(--bg-card); border:1px solid var(--border); border-radius:14px; padding:18px;
  cursor:pointer; transition:all .25s; animation:fk-fadeIn .3s ease both; }
.fk-kit-card:hover { border-color:var(--primary); transform:translateY(-2px); box-shadow:0 6px 20px rgba(0,0,0,.1); }
.fk-kit-icon { font-size:32px; margin-bottom:8px; }
.fk-kit-name { font-weight:700; font-size:14px; margin-bottom:4px; }
.fk-kit-type { font-size:12px; color:var(--text-muted); margin-bottom:10px; }
.fk-kit-bar { height:6px; background:var(--border); border-radius:3px; overflow:hidden; }
.fk-kit-bar-fill { height:100%; background:var(--primary); border-radius:3px; transition:width .3s; }
.fk-kit-meta { display:flex; justify-content:space-between; font-size:11px; color:var(--text-muted); margin-top:6px; }

/* -- Detail Modal Tabs -- */
.fk-detail-tabs { display:flex; gap:2px; border-bottom:2px solid var(--border); margin-bottom:16px; overflow-x:auto; }
.fk-detail-tab { padding:10px 18px; border:none; background:none; cursor:pointer; color:var(--text-muted);
  font-size:13px; font-weight:500; border-bottom:3px solid transparent; transition:all .2s; white-space:nowrap; }
.fk-detail-tab:hover { color:var(--text); }
.fk-detail-tab.active { color:var(--primary); border-bottom-color:var(--primary); }
.fk-detail-content { min-height:200px; }

/* -- Work Equipment Modal -- */
.fk-work-sections { display:flex; flex-direction:column; gap:20px; }
.fk-work-section h4 { margin:0 0 12px; font-size:14px; font-weight:700; }
.fk-work-item { display:flex; align-items:center; gap:12px; padding:10px; background:var(--bg);
  border-radius:8px; margin-bottom:6px; }
.fk-work-item-icon { font-size:20px; }
.fk-work-item-info { flex:1; }
.fk-work-item-name { font-weight:600; font-size:13px; }
.fk-work-item-meta { font-size:11px; color:var(--text-muted); }
.fk-work-item label { display:flex; align-items:center; gap:8px; cursor:pointer; }
.fk-avail-search { width:100%; padding:8px 12px; border-radius:8px; border:1px solid var(--border);
  background:var(--bg); color:var(--text); font-size:13px; margin-bottom:10px; box-sizing:border-box; }

/* -- Search highlight -- */
.fk-hl { background:rgba(251,191,36,.35); padding:0 2px; border-radius:2px; }

/* -- Empty state -- */
.fk-empty { text-align:center; padding:60px 20px; color:var(--text-muted); }
.fk-empty-icon { font-size:48px; margin-bottom:12px; }
.fk-empty-text { font-size:15px; }

/* -- Icon Picker -- */
.fk-icon-picker { max-height:400px; overflow-y:auto; }
.fk-icon-cat { font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:.5px;
  padding:8px 0 4px; border-bottom:1px solid var(--border); margin-top:12px; }
.fk-icon-cat:first-child { margin-top:0; }
.fk-icon-grid { display:flex; flex-wrap:wrap; gap:4px; padding:8px 0; }
.fk-icon-item { width:44px; height:44px; display:flex; align-items:center; justify-content:center; font-size:24px;
  border-radius:10px; cursor:pointer; transition:all .15s; border:2px solid transparent; background:var(--bg); }
.fk-icon-item:hover { background:var(--primary); transform:scale(1.15); border-color:var(--primary); filter:brightness(1.2); }
.fk-icon-item.selected { border-color:var(--primary); background:rgba(59,130,246,.15); box-shadow:0 0 0 3px rgba(59,130,246,.2); }

/* -- Photo Drop Zone -- */
.fk-photo-zone { border:2px dashed var(--border); border-radius:14px; padding:24px; text-align:center; cursor:pointer;
  transition:all .2s; background:var(--bg); position:relative; overflow:hidden; min-height:120px;
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; }
.fk-photo-zone:hover, .fk-photo-zone.dragover { border-color:var(--primary); background:rgba(59,130,246,.05); }
.fk-photo-zone.dragover { border-style:solid; transform:scale(1.01); }
.fk-photo-zone-icon { font-size:36px; opacity:.5; }
.fk-photo-zone-text { font-size:13px; color:var(--text-muted); }
.fk-photo-zone-text b { color:var(--primary); }
.fk-photo-preview { max-width:200px; max-height:150px; border-radius:10px; object-fit:cover; margin-top:8px; }
.fk-photo-actions { display:flex; gap:6px; margin-top:8px; }

/* -- QR Tab (A6) -- */
.fk-qr-tab { display:flex; flex-direction:column; align-items:center; padding:20px; gap:12px; }
.fk-qr-info { text-align:center; }
.fk-qr-info p { margin:4px 0; font-size:13px; }
.fk-qr-actions { display:flex; gap:8px; margin-top:8px; }

/* -- Load more (A7) -- */
.fk-load-more { display:flex; align-items:center; justify-content:center; gap:12px; padding:16px; margin-top:16px; }
.fk-load-more-info { font-size:13px; color:var(--text-muted); }

/* -- A9: Animations -- */
@keyframes fk-fadeIn { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:none; } }
@keyframes fk-spin { to { transform:rotate(360deg); } }
@keyframes fk-shimmer { to { background-position:-200% 0; } }
.fk-spinner { display:inline-block; width:14px; height:14px; border:2px solid currentColor;
  border-right-color:transparent; border-radius:50%; animation:fk-spin .6s linear infinite; vertical-align:middle; }
.fk-skeleton { background:linear-gradient(90deg, var(--bg-card,#1a1a2e) 25%, var(--border,#2a2a3e) 50%, var(--bg-card,#1a1a2e) 75%);
  background-size:200% 100%; animation:fk-shimmer 1.5s infinite; border-radius:8px; min-height:20px; }
.fk-skeleton-card { height:200px; border-radius:14px; }
.fk-skeleton-metric { height:80px; min-width:150px; border-radius:12px; flex:0 0 auto; }

/* -- A8: 5 Responsive breakpoints -- */
@media (min-width:1440px) {
  .fk-cards { grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); }
  .fk-kits-grid { grid-template-columns:repeat(auto-fill, minmax(300px, 1fr)); }
  .fk-page { padding:32px; }
}
@media (max-width:1024px) {
  .fk-cards { grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); }
  .fk-kits-grid { grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); }
}
@media (max-width:768px) {
  .fk-page { padding:12px; }
  .fk-metrics { gap:8px; }
  .fk-metric { min-width:120px; padding:12px 14px; }
  .fk-metric-value { font-size:22px; }
  .fk-toolbar { padding:10px; gap:8px; }
  .fk-cards { grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); }
  .fk-header { flex-direction:column; align-items:stretch; }
  .fk-kits-grid { grid-template-columns:1fr; }
  .fk-card-top { padding:12px 100px 12px 12px; }
  .fk-group-toggle { flex-wrap:wrap; }
}
@media (max-width:600px) {
  .fk-cards { grid-template-columns:1fr; }
  .fk-toolbar { flex-direction:column; }
  .fk-filters { width:100%; }
  .fk-select { flex:1; min-width:0; }
  .fk-view-toggle { align-self:flex-end; }
  .fk-detail-tabs { gap:0; }
  .fk-detail-tab { padding:8px 12px; font-size:12px; }
}
@media (max-width:480px) {
  .fk-page { padding:8px; }
  .fk-metrics { flex-direction:column; }
  .fk-metric { min-width:auto; }
  .fk-header-actions { width:100%; }
  .fk-header-actions .btn { flex:1; font-size:12px; padding:8px 4px; }
  .fk-card-footer { flex-wrap:wrap; }
  .fk-card-btn { min-width:45%; }
  .fk-group-toggle { gap:2px; }
  .fk-group-btn { padding:4px 8px; font-size:11px; }
}
`;
    document.head.appendChild(s);
  }

  /* --- DATA LOADING --- */
  async function loadDictionaries() {
    var auth = await AsgardAuth.getAuth();
    currentUser = auth?.user || {};
    var h = { 'Authorization': 'Bearer ' + auth.token };
    try {
      var results = await Promise.all([
        fetch('/api/equipment/categories', { headers: h }).then(function(r){return r.json();}),
        fetch('/api/equipment/objects', { headers: h }).then(function(r){return r.json();}),
        fetch('/api/equipment/warehouses', { headers: h }).then(function(r){return r.json();}),
        fetch('/api/users?is_active=true', { headers: h }).then(function(r){return r.json();}).then(function(d){var pmRoles=['PM','HEAD_PM','DIRECTOR_DEV','DIRECTOR_GEN','CHIEF_ENGINEER','HR'];d.users=(d.users||[]).filter(function(u){return pmRoles.indexOf(u.role)!==-1;});return d;}).catch(function(){return {};}),
        fetch('/api/works?limit=200', { headers: h }).then(function(r){return r.json();}).catch(function(){return {};})
      ]);
      categories = results[0].categories || [];
      objects = results[1].objects || [];
      warehouses = results[2].warehouses || [];
      pmList = results[3].users || [];
      worksList = results[4].works || [];
    } catch(e) { console.error('Dict load err:', e); }
  }

  /* A2/A7: loadEquipment with skeleton + server pagination */
  async function loadEquipment(append) {
    var contentEl = $('#fkContent');
    if (!append) {
      currentOffset = 0;
      if (contentEl) {
        contentEl.innerHTML = '<div class="fk-cards">' +
          Array.from({length:6}, function(){return '<div class="fk-skeleton fk-skeleton-card"></div>';}).join('') +
          '</div>';
      }
    }
    try {
      var params = new URLSearchParams();
      if (activeFilters.status) params.set('status', activeFilters.status);
      if (activeFilters.category_id) params.set('category_id', activeFilters.category_id);
      if (activeFilters.warehouse_id) params.set('warehouse_id', activeFilters.warehouse_id);
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(currentOffset));
      var data = await api('/api/equipment?' + params.toString());
      if (data.success) {
        if (append) {
          allEquipment = allEquipment.concat(data.equipment || []);
        } else {
          allEquipment = data.equipment || [];
        }
        totalCount = data.total || allEquipment.length;
        applyClientFilters();
      }
    } catch(e) {
      toast('Ошибка', e.message || 'Не удалось загрузить оборудование', 'err');
      if (contentEl) contentEl.innerHTML = '';
    }
  }

  /* A2: loadStats with skeleton */
  async function loadStats() {
    var el = $('#fkMetrics');
    if (el) {
      el.innerHTML = Array.from({length:5}, function(){return '<div class="fk-skeleton fk-skeleton-metric"></div>';}).join('');
    }
    try {
      var data = await api('/api/equipment/stats/dashboard');
      if (data.success) { stats = data; renderMetrics(); return; }
    } catch(_) {}
    try {
      var data2 = await api('/api/equipment/stats/summary');
      if (data2.success) { stats = data2.stats || data2; }
    } catch(_) {}
    renderMetrics();
  }

  async function loadKits() {
    try {
      var data = await api('/api/equipment/kits');
      kits = data.kits || [];
    } catch(_) { kits = []; }
  }

  async function loadPendingRequests() {
    if (!isAdmin()) return;
    try {
      var data = await api('/api/equipment/requests?status=pending');
      renderPendingRequests(data.requests || []);
    } catch(_) {}
  }

  function isAdmin() {
    return ['ADMIN','WAREHOUSE','CHIEF_ENGINEER','DIRECTOR','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'].includes(currentUser?.role);
  }
  function isPM() { return ['PM','MANAGER'].includes(currentUser?.role); }

  /* --- CLIENT FILTERING --- */
  function applyClientFilters() {
    filteredEquipment = allEquipment.filter(function(eq) {
      if (searchTerm) {
        var s = searchTerm.toLowerCase();
        if (!(eq.name||'').toLowerCase().includes(s) &&
            !(eq.inventory_number||'').toLowerCase().includes(s) &&
            !(eq.serial_number||'').toLowerCase().includes(s) &&
            !(eq.holder_name||'').toLowerCase().includes(s)) return false;
      }
      return true;
    });
    renderContent();
    renderFilterChips();
  }

  /* A14: debounced load for server filters */
  var debouncedLoad = debounce(function() { loadEquipment(); }, 300);

  /* --- MAIN RENDER --- */
  async function render(opts) {
    var layout = opts.layout;
    var title = opts.title;
    injectCSS();
    currentLayout = layout;
    await loadDictionaries();
    var ua = isAdmin(), up = isPM();

    var html = '<div class="fk-page">' +
      '<div class="fk-header">' +
        '<h2>Склад ТМЦ</h2>' +
        '<div class="fk-header-actions">' +
          (ua ? '<button class="btn" id="btnAddEquipment">+ Создать</button>' : '') +
          (up||ua ? '<button class="btn ghost" id="fkReqEq">📋 Запрос</button>' : '') +
          '<button class="btn ghost" id="fkMyEq">👤 Моё</button>' +
          '<button class="btn ghost" id="fkExport">📥 Экспорт</button>' +
        '</div>' +
      '</div>' +
      '<div class="fk-metrics" id="fkMetrics"></div>' +
      '<div class="fk-toolbar">' +
        '<div class="fk-search"><input id="fkSearch" placeholder="Поиск по названию, инв.№, серийному..." /></div>' +
        '<div class="fk-filters">' +
          '<select class="fk-select" id="fkCat"><option value="">Категория</option>' + catOpts() + '</select>' +
          '<select class="fk-select" id="fkStatus"><option value="">Статус</option>' + statusFilterOpts() + '</select>' +
          '<select class="fk-select" id="fkWh"><option value="">Склад</option>' + whOpts() + '</select>' +
        '</div>' +
        '<div class="fk-view-toggle">' +
          '<button class="fk-view-btn ' + (viewMode==='cards'?'active':'') + '" onclick="AsgardEquipment.toggleView(\'cards\')">◻◻</button>' +
          '<button class="fk-view-btn ' + (viewMode==='table'?'active':'') + '" onclick="AsgardEquipment.toggleView(\'table\')">☰</button>' +
        '</div>' +
      '</div>' +
      '<div class="fk-group-toggle" style="margin-bottom:16px">' +
        '<button class="fk-group-btn ' + (groupBy==='category'?'active':'') + '" onclick="AsgardEquipment.setGroupBy(\'category\')">По категории</button>' +
        '<button class="fk-group-btn ' + (groupBy==='status'?'active':'') + '" onclick="AsgardEquipment.setGroupBy(\'status\')">По статусу</button>' +
        '<button class="fk-group-btn ' + (groupBy==='object'?'active':'') + '" onclick="AsgardEquipment.setGroupBy(\'object\')">По объекту</button>' +
        '<button class="fk-group-btn ' + (groupBy==='holder'?'active':'') + '" onclick="AsgardEquipment.setGroupBy(\'holder\')">По ответственному</button>' +
        '<button class="fk-group-btn ' + (groupBy==='none'?'active':'') + '" onclick="AsgardEquipment.setGroupBy(\'none\')">Все</button>' +
      '</div>' +
      '<div class="fk-chips" id="fkChips"></div>' +
      '<div id="fkRequests"></div>' +
      '<div id="fkContent"></div>' +
      '<div class="fk-kits" id="fkKits"></div>' +
    '</div>';

    await layout(html, { title: title || 'Склад ТМЦ' });
    bindEvents();
    await Promise.all([ loadEquipment(), loadStats(), loadKits(), loadPendingRequests() ]);
    renderKitsSection();
  }

  /* --- EVENTS (A14: debounced server filters) --- */
  function bindEvents() {
    var s = $('#fkSearch');
    if(s) s.addEventListener('input', debounce(function() { searchTerm = s.value.trim(); applyClientFilters(); }, 300));
    var catEl = $('#fkCat');
    if (catEl) catEl.addEventListener('change', function(e) { activeFilters.category_id = e.target.value || null; debouncedLoad(); });
    var stEl = $('#fkStatus');
    if (stEl) stEl.addEventListener('change', function(e) { activeFilters.status = e.target.value || null; debouncedLoad(); });
    var whEl = $('#fkWh');
    if (whEl) whEl.addEventListener('change', function(e) { activeFilters.warehouse_id = e.target.value || null; debouncedLoad(); });
    $('#btnAddEquipment')?.addEventListener('click', openAddForm);
    $('#fkReqEq')?.addEventListener('click', openRequestForm);
    $('#fkMyEq')?.addEventListener('click', function() { showMyEquipment(currentUser.id); });
    $('#fkExport')?.addEventListener('click', exportToExcel);
  }

  /* --- METRICS (A9: animated counters) --- */
  function renderMetrics() {
    var el = $('#fkMetrics');
    if (!el) return;
    var s = stats;
    el.innerHTML =
      '<div class="fk-metric" onclick="AsgardEquipment.setFilter(\'\',\'\')">' +
        '<div class="fk-metric-icon">📊</div><div class="fk-metric-value fk-counter" data-target="' + (s.total||0) + '">0</div><div class="fk-metric-label">Всего</div></div>' +
      '<div class="fk-metric green" onclick="AsgardEquipment.setFilter(\'status\',\'on_warehouse\')">' +
        '<div class="fk-metric-icon">📦</div><div class="fk-metric-value fk-counter" data-target="' + (s.on_warehouse||0) + '">0</div><div class="fk-metric-label">На складе</div></div>' +
      '<div class="fk-metric blue" onclick="AsgardEquipment.setFilter(\'status\',\'issued\')">' +
        '<div class="fk-metric-icon">👷</div><div class="fk-metric-value fk-counter" data-target="' + (s.issued||0) + '">0</div><div class="fk-metric-label">Выдано</div></div>' +
      '<div class="fk-metric amber" onclick="AsgardEquipment.setFilter(\'status\',\'repair\')">' +
        '<div class="fk-metric-icon">🔧</div><div class="fk-metric-value fk-counter" data-target="' + (s.in_repair||0) + '">0</div><div class="fk-metric-label">Ремонт</div></div>' +
      '<div class="fk-metric red">' +
        '<div class="fk-metric-icon">❌</div><div class="fk-metric-value fk-counter" data-target="' + (s.broken||0) + '">0</div><div class="fk-metric-label">Сломано</div></div>' +
      (s.total_value !== undefined ? '<div class="fk-metric purple"><div class="fk-metric-icon">💰</div><div class="fk-metric-value">' + money(s.total_value) + '</div><div class="fk-metric-label">Стоимость</div></div>' : '') +
      ((s.alerts?.maintenance_overdue||0) > 0 ? '<div class="fk-metric red"><div class="fk-metric-icon">⚠️</div><div class="fk-metric-value fk-counter" data-target="' + s.alerts.maintenance_overdue + '">0</div><div class="fk-metric-label">Просрочено ТО</div></div>' : '');
    /* A9: animate counters */
    el.querySelectorAll('.fk-counter').forEach(function(c) { animateCounter(c, c.dataset.target); });
  }

  /* --- FILTER CHIPS --- */
  function renderFilterChips() {
    var el = $('#fkChips');
    if (!el) return;
    var html = '';
    if (searchTerm) html += '<span class="fk-chip" onclick="AsgardEquipment.clearSearch()">🔍 ' + esc(searchTerm) + ' <span class="fk-chip-x">×</span></span>';
    if (activeFilters.category_id) {
      var c = categories.find(function(x){return String(x.id)===String(activeFilters.category_id);});
      html += '<span class="fk-chip" onclick="AsgardEquipment.clearFilter(\'category_id\')">' + esc(c?.name||'Категория') + ' <span class="fk-chip-x">×</span></span>';
    }
    if (activeFilters.status) {
      var st = STATUS[activeFilters.status];
      html += '<span class="fk-chip" onclick="AsgardEquipment.clearFilter(\'status\')">' + (st?.i||'') + ' ' + esc(st?.l||activeFilters.status) + ' <span class="fk-chip-x">×</span></span>';
    }
    if (activeFilters.warehouse_id) {
      var w = warehouses.find(function(x){return String(x.id)===String(activeFilters.warehouse_id);});
      html += '<span class="fk-chip" onclick="AsgardEquipment.clearFilter(\'warehouse_id\')">' + esc(w?.name||'Склад') + ' <span class="fk-chip-x">×</span></span>';
    }
    el.innerHTML = html;
  }

  /* --- CONTENT RENDER (A7: pagination, A10: empty states) --- */
  function renderContent() {
    var el = $('#fkContent');
    if (!el) return;
    if (filteredEquipment.length === 0) {
      el.innerHTML = emptyState({ icon: '📦', title: 'Нет оборудования',
        message: searchTerm || Object.keys(activeFilters).length ? 'Попробуйте изменить фильтры' : 'Добавьте первое оборудование' });
      /* Add action button for empty state */
      if (isAdmin() && !searchTerm && !Object.keys(activeFilters).length) {
        el.innerHTML += '<div style="text-align:center;margin-top:12px"><button class="btn" onclick="AsgardEquipment.openEditForm && AsgardEquipment.render ? document.getElementById(\'btnAddEquipment\')?.click() : void 0">+ Добавить</button></div>';
      }
      return;
    }
    var contentHtml;
    if (groupBy === 'none') {
      contentHtml = viewMode === 'cards' ? renderCardsGrid(filteredEquipment) : renderTableView(filteredEquipment);
    } else {
      var groups = groupEquipment(filteredEquipment, groupBy);
      contentHtml = groups.map(function(g) {
        var isOpen = !collapsedGroups.has(g.key);
        return '<div class="fk-group">' +
          '<div class="fk-group-header ' + (isOpen?'open':'') + '" onclick="AsgardEquipment.toggleGroup(\'' + esc(g.key) + '\')">' +
            '<span class="fk-group-chevron">▶</span>' +
            '<span class="fk-group-title">' + (g.icon ? g.icon+' ' : '') + esc(g.label) + '</span>' +
            '<span class="fk-group-count">' + g.items.length + '</span>' +
          '</div>' +
          '<div class="fk-group-body ' + (isOpen?'':'collapsed') + '">' +
            (viewMode === 'cards' ? renderCardsGrid(g.items) : renderTableView(g.items)) +
          '</div></div>';
      }).join('');
    }
    /* A7: Load more button */
    var loadMoreHtml = '';
    if (allEquipment.length < totalCount) {
      loadMoreHtml = '<div class="fk-load-more">' +
        '<span class="fk-load-more-info">Загружено ' + allEquipment.length + ' из ' + totalCount + '</span>' +
        '<button class="btn ghost" id="fkLoadMore">Показать ещё</button></div>';
    } else if (totalCount > 0) {
      loadMoreHtml = '<div class="fk-load-more"><span class="fk-load-more-info">Показано: ' + filteredEquipment.length + ' из ' + totalCount + '</span></div>';
    }
    el.innerHTML = contentHtml + loadMoreHtml;
    /* Bind load more */
    var loadMoreBtn = document.getElementById('fkLoadMore');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', async function() {
        btnLoading(loadMoreBtn, 'Загрузка...');
        currentOffset += PAGE_SIZE;
        await loadEquipment(true);
        btnReset(loadMoreBtn);
      });
    }
    /* A8: make tables responsive */
    if (viewMode === 'table') {
      try { makeResponsiveTable('.fk-table'); } catch(_) {}
    }
  }

  function groupEquipment(items, by) {
    var map = new Map();
    for (var idx = 0; idx < items.length; idx++) {
      var eq = items[idx];
      var key, label, icon;
      switch(by) {
        case 'category':
          key = eq.category_id||0; label = eq.category_name||'Без категории'; icon = eq.category_icon||'📦'; break;
        case 'status':
          key = eq.status||'unknown'; var s=STATUS[eq.status]; label = s?.l||eq.status; icon = s?.i||''; break;
        case 'object':
          key = eq.current_object_id||0; label = eq.object_name||'Без объекта'; icon = '📍'; break;
        case 'holder':
          key = eq.current_holder_id||0; label = eq.holder_name||'На складе'; icon = '👤'; break;
        default:
          key = 'all'; label = 'Все'; icon = ''; break;
      }
      if (!map.has(key)) map.set(key, { key: String(key), label: label, icon: icon, items: [] });
      map.get(key).items.push(eq);
    }
    return Array.from(map.values()).sort(function(a,b) { return b.items.length - a.items.length; });
  }

  /* --- CARDS GRID --- */
  function renderCardsGrid(items) {
    return '<div class="fk-cards">' + items.map(renderCard).join('') + '</div>';
  }

  function renderCard(eq) {
    var st = STATUS[eq.status] || STATUS.on_warehouse;
    var cn = COND[eq.condition] || COND.good;
    var photo = eq.photo_url
      ? '<img src="' + esc(eq.photo_url) + '" alt="" />'
      : resolveIcon(eq);
    var actions = getCardActions(eq);
    return '<div class="fk-card" data-id="' + eq.id + '">' +
      '<div class="fk-card-badges"><span class="fk-badge" style="background:' + st.c + '22;color:' + st.c + '">' + st.i + ' ' + st.l + '</span></div>' +
      '<div class="fk-card-top" onclick="AsgardEquipment.openEquipmentCard(' + eq.id + ')">' +
        '<div class="fk-card-photo">' + photo + '</div>' +
        '<div class="fk-card-info">' +
          '<div class="fk-card-name">' + highlightSearch(eq.name) + '</div>' +
          '<div class="fk-card-inv">' + highlightSearch(eq.inventory_number) + '</div>' +
          '<div class="fk-card-cat">' + esc(eq.category_name||'') + '</div>' +
        '</div></div>' +
      '<div class="fk-card-body" onclick="AsgardEquipment.openEquipmentCard(' + eq.id + ')">' +
        '<div class="fk-card-row"><span class="fk-label">Состояние</span><span class="fk-value"><span class="fk-cond-dot" style="background:' + cn.c + '"></span>' + cn.l + '</span></div>' +
        (eq.holder_name ? '<div class="fk-card-row"><span class="fk-label">Ответственный</span><span class="fk-value">' + esc(eq.holder_name) + '</span></div>' : '') +
        (eq.object_name ? '<div class="fk-card-row"><span class="fk-label">Объект</span><span class="fk-value">' + esc(eq.object_name) + '</span></div>' : '') +
        (eq.warehouse_name ? '<div class="fk-card-row"><span class="fk-label">Склад</span><span class="fk-value">' + esc(eq.warehouse_name) + '</span></div>' : '') +
        '<div class="fk-card-row"><span class="fk-label">Кол-во</span><span class="fk-value">' + (eq.quantity||1) + ' ' + esc(eq.unit||'шт') + '</span></div>' +
      '</div>' +
      (actions ? '<div class="fk-card-footer">' + actions + '</div>' : '') +
    '</div>';
  }

  function getCardActions(eq) {
    var a = '';
    if (eq.status === 'on_warehouse' && isAdmin()) {
      a += '<button class="fk-card-btn primary" onclick="event.stopPropagation();AsgardEquipment.openIssueForm(' + eq.id + ')">📤 Выдать</button>';
    }
    if (eq.status === 'issued' && (isAdmin() || eq.current_holder_id === currentUser?.id)) {
      a += '<button class="fk-card-btn" onclick="event.stopPropagation();AsgardEquipment.doReturn(' + eq.id + ')">📥 Вернуть</button>';
    }
    if (eq.status === 'issued' && isPM() && eq.current_holder_id === currentUser?.id) {
      a += '<button class="fk-card-btn" onclick="event.stopPropagation();AsgardEquipment.openTransferForm(' + eq.id + ')">🔄 Передать</button>';
    }
    if (isAdmin() && eq.status !== 'repair' && eq.status !== 'written_off') {
      a += '<button class="fk-card-btn danger" onclick="event.stopPropagation();AsgardEquipment.sendToRepair(' + eq.id + ')">🔧</button>';
    }
    return a;
  }

  /* --- TABLE VIEW (A8: wrapped in overflow-x:auto) --- */
  function renderTableView(items) {
    return '<div class="fk-table-wrap"><table class="fk-table"><thead><tr>' +
      '<th></th><th>Наименование</th><th>Инв. №</th><th>Категория</th><th>Статус</th>' +
      '<th>Состояние</th><th>Ответственный</th><th>Объект</th><th>Кол-во</th>' +
    '</tr></thead><tbody>' +
    items.map(function(eq) {
      var st = STATUS[eq.status]||STATUS.on_warehouse;
      var cn = COND[eq.condition]||COND.good;
      return '<tr onclick="AsgardEquipment.openEquipmentCard(' + eq.id + ')">' +
        '<td><div class="fk-thumb">' + (eq.photo_url ? '<img src="' + esc(eq.photo_url) + '" style="width:36px;height:36px;border-radius:8px;object-fit:cover"/>' : resolveIcon(eq)) + '</div></td>' +
        '<td><strong>' + highlightSearch(eq.name) + '</strong>' + (eq.serial_number?'<br><small style="color:var(--text-muted)">S/N: ' + esc(eq.serial_number) + '</small>':'') + '</td>' +
        '<td><code style="font-size:12px">' + highlightSearch(eq.inventory_number) + '</code></td>' +
        '<td>' + esc(eq.category_name||'—') + '</td>' +
        '<td><span class="fk-badge" style="background:' + st.c + '22;color:' + st.c + '">' + st.i + ' ' + st.l + '</span></td>' +
        '<td><span class="fk-cond-dot" style="background:' + cn.c + '"></span>' + cn.l + '</td>' +
        '<td>' + esc(eq.holder_name||'—') + '</td>' +
        '<td>' + esc(eq.object_name||'—') + '</td>' +
        '<td>' + (eq.quantity||1) + ' ' + esc(eq.unit||'шт') + '</td></tr>';
    }).join('') +
    '</tbody></table></div>';
  }

  /* --- PENDING REQUESTS --- */
  function renderPendingRequests(requests) {
    var el = $('#fkRequests');
    if (!el || !requests.length) { if(el) el.innerHTML=''; return; }
    el.innerHTML = '<div class="fk-requests"><h3>📥 Запросы на обработку (' + requests.length + ')</h3>' +
      requests.map(function(r) { return '<div class="fk-req-item"><div class="fk-req-info">' +
        '<strong>' + esc(r.equipment_name||'') + '</strong> (' + esc(r.inventory_number||'') + ')<br/>' +
        '<span style="font-size:12px;color:var(--text-muted)">' +
          (r.request_type==='transfer'?'🔄 Передача':'📝 Запрос') + ': ' + esc(r.requester_name||'') +
          (r.target_holder_name?' → ' + esc(r.target_holder_name):'') +
          (r.work_title?' | Работа: ' + esc(r.work_title):'') +
        '</span></div><div class="fk-req-actions">' +
        '<button class="btn mini" onclick="AsgardEquipment.executeTransfer(' + r.id + ')">✅</button>' +
        '<button class="btn mini ghost" onclick="AsgardEquipment.rejectRequest(' + r.id + ')">❌</button>' +
      '</div></div>'; }).join('') +
    '</div>';
  }

  /* --- KITS SECTION --- */
  function renderKitsSection() {
    var el = $('#fkKits');
    if (!el || !kits.length) { if(el) el.innerHTML=''; return; }
    el.innerHTML = '<div class="fk-kits-header" onclick="document.getElementById(\'fkKitsBody\').classList.toggle(\'collapsed\')">' +
      '<h3>🧰 Комплекты оборудования</h3><span class="fk-kits-count">' + kits.length + '</span></div>' +
      '<div id="fkKitsBody" class="fk-kits-grid">' +
      kits.map(function(k) {
        var pct = k.items_count > 0 ? Math.round((k.assigned_count/k.items_count)*100) : 0;
        return '<div class="fk-kit-card" onclick="AsgardEquipment.openKitDetail(' + k.id + ')">' +
          '<div class="fk-kit-icon">' + (k.icon||'🧰') + '</div>' +
          '<div class="fk-kit-name">' + esc(k.name) + '</div>' +
          '<div class="fk-kit-type">' + esc(k.work_type||'Универсальный') + '</div>' +
          '<div class="fk-kit-bar"><div class="fk-kit-bar-fill" style="width:' + pct + '%"></div></div>' +
          '<div class="fk-kit-meta"><span>' + (k.items_count||0) + ' позиций</span><span>' + pct + '% собран</span></div></div>';
      }).join('') + '</div>';
  }

  /* --- EQUIPMENT DETAIL MODAL (A2: skeleton loading) --- */
  async function openEquipmentCard(id) {
    showModal('Загрузка...', '<div style="padding:20px">' +
      '<div class="fk-skeleton" style="height:80px;margin-bottom:16px"></div>' +
      '<div class="fk-skeleton" style="height:40px;margin-bottom:12px"></div>' +
      '<div class="fk-skeleton" style="height:200px"></div></div>');
    try {
      var data = await api('/api/equipment/' + id);
      if (!data.success) { toast('Ошибка', 'Не удалось загрузить', 'err'); closeModal(); return; }
      var eq = data.equipment;
      var movements = data.movements || [];
      var maintenance = data.maintenance || [];
      var st = STATUS[eq.status]||STATUS.on_warehouse;
      var cn = COND[eq.condition]||COND.good;

      var html = '<div style="max-width:800px;width:min(95vw,800px)">' +
        '<div style="display:flex;gap:16px;align-items:flex-start;margin-bottom:20px">' +
          '<div class="fk-card-photo" style="width:80px;height:80px;font-size:36px;border-radius:14px;cursor:pointer" onclick="AsgardEquipment.openPhotoManager(' + eq.id + ')" title="Изменить фото/иконку">' +
            (eq.photo_url ? '<img src="' + esc(eq.photo_url) + '" style="width:100%;height:100%;object-fit:cover;border-radius:12px"/>' : resolveIcon(eq)) +
          '</div>' +
          '<div style="flex:1">' +
            '<h2 style="margin:0 0 4px;font-size:20px">' + esc(eq.name) + '</h2>' +
            '<code style="font-size:13px;color:var(--text-muted)">' + esc(eq.inventory_number) + '</code>' +
            '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">' +
              '<span class="fk-badge" style="background:' + st.c + '22;color:' + st.c + '">' + st.i + ' ' + st.l + '</span>' +
              '<span class="fk-badge" style="background:' + cn.c + '22;color:' + cn.c + '"><span class="fk-cond-dot" style="background:' + cn.c + '"></span>' + cn.l + '</span>' +
            '</div></div></div>' +
        '<div class="fk-detail-tabs">' +
          '<button class="fk-detail-tab active" data-tab="info">📋 Инфо</button>' +
          '<button class="fk-detail-tab" data-tab="moves">📍 Перемещения (' + movements.length + ')</button>' +
          '<button class="fk-detail-tab" data-tab="maint">🔧 ТО (' + maintenance.length + ')</button>' +
          '<button class="fk-detail-tab" data-tab="works">📊 Работы</button>' +
          '<button class="fk-detail-tab" data-tab="qr">🏷️ QR</button></div>' +
        '<div class="fk-detail-content" id="fkDetailContent">' + renderInfoTab(eq) + '</div>' +
        '<div style="display:flex;gap:8px;margin-top:20px;flex-wrap:wrap">' +
          (eq.status==='on_warehouse' && isAdmin() ? '<button class="btn" onclick="AsgardEquipment.openIssueForm(' + eq.id + ');AsgardUI.closeModal()">📤 Выдать</button>' : '') +
          (eq.status==='issued' && (isAdmin()||eq.current_holder_id===currentUser?.id) ? '<button class="btn" onclick="AsgardEquipment.doReturn(' + eq.id + ')">📥 Вернуть</button>' : '') +
          (isAdmin() ? '<button class="btn ghost" onclick="AsgardEquipment.openEditForm(' + eq.id + ')">✏️ Редактировать</button>' : '') +
        '</div></div>';

      closeModal();
      showModal((eq.category_icon||'📦') + ' ' + esc(eq.name), html);

      document.querySelectorAll('.fk-detail-tab').forEach(function(tab) {
        tab.addEventListener('click', async function() {
          document.querySelectorAll('.fk-detail-tab').forEach(function(t) { t.classList.remove('active'); });
          tab.classList.add('active');
          var t = tab.dataset.tab;
          var content = document.getElementById('fkDetailContent');
          if (!content) return;
          switch(t) {
            case 'info': content.innerHTML = renderInfoTab(eq); break;
            case 'moves': content.innerHTML = renderMovesTab(movements); break;
            case 'maint': content.innerHTML = renderMaintTab(maintenance, eq); break;
            case 'works': content.innerHTML = await renderWorksTab(eq); break;
            case 'qr': content.innerHTML = renderQrTab(eq); break;
          }
        });
      });
    } catch(e) {
      closeModal();
      toast('Ошибка', e.message || 'Не удалось загрузить карточку', 'err');
    }
  }

  function renderInfoTab(eq) {
    return '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px">' +
      '<div style="background:var(--bg);padding:14px;border-radius:10px">' +
        '<h4 style="margin:0 0 10px;font-size:13px;color:var(--text-muted)">Основное</h4>' +
        '<div class="fk-card-row"><span class="fk-label">Категория</span><span class="fk-value">' + esc(eq.category_name||'—') + '</span></div>' +
        '<div class="fk-card-row"><span class="fk-label">Серийный №</span><span class="fk-value">' + esc(eq.serial_number||'—') + '</span></div>' +
        '<div class="fk-card-row"><span class="fk-label">Штрих-код</span><span class="fk-value">' + esc(eq.barcode||'—') + '</span></div>' +
        '<div class="fk-card-row"><span class="fk-label">Количество</span><span class="fk-value">' + (eq.quantity||1) + ' ' + esc(eq.unit||'шт') + '</span></div>' +
        (eq.brand?'<div class="fk-card-row"><span class="fk-label">Бренд</span><span class="fk-value">' + esc(eq.brand) + '</span></div>':'') +
        (eq.model?'<div class="fk-card-row"><span class="fk-label">Модель</span><span class="fk-value">' + esc(eq.model) + '</span></div>':'') +
      '</div>' +
      '<div style="background:var(--bg);padding:14px;border-radius:10px">' +
        '<h4 style="margin:0 0 10px;font-size:13px;color:var(--text-muted)">Местоположение</h4>' +
        '<div class="fk-card-row"><span class="fk-label">Склад</span><span class="fk-value">' + esc(eq.warehouse_name||'—') + '</span></div>' +
        '<div class="fk-card-row"><span class="fk-label">Ответственный</span><span class="fk-value">' + esc(eq.holder_name||'—') + '</span></div>' +
        '<div class="fk-card-row"><span class="fk-label">Объект</span><span class="fk-value">' + esc(eq.object_name||'—') + '</span></div>' +
      '</div>' +
      '<div style="background:var(--bg);padding:14px;border-radius:10px">' +
        '<h4 style="margin:0 0 10px;font-size:13px;color:var(--text-muted)">Финансы</h4>' +
        '<div class="fk-card-row"><span class="fk-label">Стоимость</span><span class="fk-value">' + (eq.purchase_price?money(eq.purchase_price)+' ₽':'—') + '</span></div>' +
        '<div class="fk-card-row"><span class="fk-label">Балансовая</span><span class="fk-value">' + (eq.book_value?money(eq.book_value)+' ₽':'—') + '</span></div>' +
        '<div class="fk-card-row"><span class="fk-label">Дата покупки</span><span class="fk-value">' + fmtDate(eq.purchase_date) + '</span></div>' +
        '<div class="fk-card-row"><span class="fk-label">На балансе</span><span class="fk-value">' + (eq.balance_status==='on_balance'?'Да':'Нет') + '</span></div>' +
      '</div>' +
      '<div style="background:var(--bg);padding:14px;border-radius:10px">' +
        '<h4 style="margin:0 0 10px;font-size:13px;color:var(--text-muted)">ТО и гарантия</h4>' +
        '<div class="fk-card-row"><span class="fk-label">Гарантия до</span><span class="fk-value">' + fmtDate(eq.warranty_end) + '</span></div>' +
        '<div class="fk-card-row"><span class="fk-label">След. ТО</span><span class="fk-value">' + fmtDate(eq.next_maintenance) + '</span></div>' +
        '<div class="fk-card-row"><span class="fk-label">Поверка</span><span class="fk-value">' + fmtDate(eq.next_calibration) + '</span></div>' +
      '</div></div>' +
      (eq.notes?'<div style="margin-top:14px;padding:12px;background:var(--bg);border-radius:10px"><h4 style="margin:0 0 8px;font-size:13px;color:var(--text-muted)">Примечания</h4><p style="margin:0;font-size:13px">' + esc(eq.notes) + '</p></div>':'');
  }

  function renderMovesTab(moves) {
    if (!moves.length) return emptyState({ icon: '📍', title: 'Нет перемещений', message: 'История перемещений пуста' });
    var typeMap = { issue:'📤 Выдача', return:'📥 Возврат', transfer_out:'➡️ Передал', transfer_in:'⬅️ Получил',
      write_off:'🗑️ Списание', repair_start:'🔧 В ремонт', repair_end:'✅ Из ремонта' };
    return '<div style="max-height:400px;overflow-y:auto">' + moves.map(function(m) {
      var det = '';
      if (m.from_holder_name) det += 'От: ' + esc(m.from_holder_name);
      if (m.to_holder_name) det += (det?' → ':'') + 'Кому: ' + esc(m.to_holder_name);
      if (m.to_object_name) det += ' (' + esc(m.to_object_name) + ')';
      if (m.work_title) det += ' | ' + esc(m.work_title);
      return '<div style="display:flex;gap:12px;padding:12px;border-bottom:1px solid var(--border)">' +
        '<div style="font-size:20px">' + (typeMap[m.movement_type]||'📍').split(' ')[0] + '</div>' +
        '<div style="flex:1"><div style="font-weight:600;font-size:13px">' + (typeMap[m.movement_type]||m.movement_type) + '</div>' +
        '<div style="font-size:12px;color:var(--text-muted)">' + (det||'—') + '</div>' +
        (m.notes?'<div style="font-size:11px;font-style:italic;color:var(--text-muted);margin-top:2px">' + esc(m.notes) + '</div>':'') +
        '</div><div style="font-size:11px;color:var(--text-muted);text-align:right">' + fmtDate(m.created_at) + '<br/>' + esc(m.created_by_name||'') + '</div></div>';
    }).join('') + '</div>';
  }

  function renderMaintTab(maint, eq) {
    var icons = { scheduled_to:'🔄', repair:'🔧', calibration:'📏', inspection:'🔍' };
    var html = isAdmin() ? '<button class="btn mini" style="margin-bottom:12px" onclick="AsgardEquipment.openMaintenanceForm(' + eq.id + ')">+ Добавить запись</button>' : '';
    if (!maint.length) return html + emptyState({ icon: '🔧', title: 'Нет записей ТО', message: 'Добавьте первую запись обслуживания' });
    return html + '<div style="max-height:300px;overflow-y:auto">' + maint.map(function(m) {
      return '<div style="display:grid;grid-template-columns:auto 1fr 100px 80px;gap:10px;padding:10px;border-bottom:1px solid var(--border);font-size:13px;align-items:center">' +
        '<span>' + (icons[m.maintenance_type]||'📋') + ' ' + esc(m.maintenance_type||'') + '</span>' +
        '<span>' + esc(m.description||'—') + '</span>' +
        '<span>' + fmtDate(m.performed_date||m.started_at) + '</span>' +
        '<span style="text-align:right">' + (m.cost?money(m.cost)+' ₽':'—') + '</span></div>';
    }).join('') + '</div>';
  }

  async function renderWorksTab(eq) {
    try {
      var data = await api('/api/equipment/' + eq.id);
      var moves = (data.movements||[]).filter(function(m) { return m.work_id; });
      var workIds = [];
      var seen = {};
      moves.forEach(function(m) { if (!seen[m.work_id]) { seen[m.work_id] = true; workIds.push(m.work_id); } });
      if (!workIds.length) return emptyState({ icon: '📊', title: 'Не привязано к работам', message: 'Оборудование не используется в работах' });
      return '<div style="max-height:300px;overflow-y:auto">' + workIds.map(function(wid) {
        var m = moves.find(function(x){return x.work_id===wid;});
        return '<div style="display:flex;gap:12px;padding:10px;border-bottom:1px solid var(--border)">' +
          '<span style="font-size:18px">📊</span><div style="flex:1">' +
          '<div style="font-weight:600;font-size:13px">' + esc(m?.work_title||'Работа #'+wid) + '</div>' +
          '<div style="font-size:11px;color:var(--text-muted)">' + (m?.work_number?'№' + esc(m.work_number):'') + ' ' + fmtDate(m?.created_at) + '</div></div></div>';
      }).join('') + '</div>';
    } catch(_) { return emptyState({ icon: '⚠️', title: 'Ошибка загрузки', message: 'Не удалось загрузить данные' }); }
  }

  /* A6: Real QR code using api.qrserver.com */
  function renderQrTab(eq) {
    var qrData = eq.qr_uuid || eq.inventory_number || String(eq.id);
    var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(qrData);
    return '<div class="fk-qr-tab">' +
      '<img src="' + qrUrl + '" alt="QR" style="width:200px;height:200px;border-radius:8px"/>' +
      '<div class="fk-qr-info">' +
        '<p><strong>' + esc(eq.name) + '</strong></p>' +
        '<p>Инв. №: ' + esc(eq.inventory_number||'—') + '</p>' +
        '<p>S/N: ' + esc(eq.serial_number||'—') + '</p>' +
      '</div>' +
      '<div class="fk-qr-actions">' +
        '<button class="btn" onclick="window.open(\'' + qrUrl + '&format=svg\',\'_blank\')">📥 Скачать SVG</button>' +
        '<button class="btn" onclick="window.print()">🖨️ Печать</button>' +
      '</div></div>';
  }

  /* --- FORMS --- */
  /* A3: All form submissions with button loading states */
  /* A13: Using deduplicated option helpers */

  async function openAddForm() {
    _pendingPhoto = null;
    _pendingIcon = null;
    var html = '<form id="fkAddForm" style="display:grid;gap:14px">' +
      '<div style="display:grid;grid-template-columns:auto 1fr;gap:14px;align-items:start">' +
        renderPhotoZone(null, null, 0) +
        '<div style="display:grid;gap:14px">' +
          '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Наименование *</label>' +
            '<input name="name" class="inp" required/></div>' +
          '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Категория *</label>' +
            '<select name="category_id" class="inp" required><option value="">Выберите...</option>' + catOpts() + '</select></div>' +
        '</div></div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px">' +
        '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Серийный номер</label><input name="serial_number" class="inp"/></div>' +
        '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Штрих-код</label><input name="barcode" class="inp"/></div>' +
        '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Бренд</label><input name="brand" class="inp"/></div>' +
        '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Модель</label><input name="model" class="inp"/></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px">' +
        '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Кол-во</label><input name="quantity" type="number" class="inp" value="1" step="0.01"/></div>' +
        '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Ед.изм.</label>' +
          '<select name="unit" class="inp"><option>шт</option><option>м</option><option>кг</option><option>л</option><option>компл</option></select></div>' +
        '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Стоимость, ₽</label><input name="purchase_price" type="number" class="inp" step="0.01"/></div>' +
        '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Дата покупки</label><input name="purchase_date" type="date" class="inp"/></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px">' +
        '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Гарантия до</label><input name="warranty_end" type="date" class="inp"/></div>' +
        '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Интервал ТО (дней)</label><input name="maintenance_interval_days" type="number" class="inp"/></div>' +
      '</div>' +
      '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Описание</label><textarea name="notes" class="inp" rows="2"></textarea></div>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end">' +
        '<button type="button" class="btn ghost" onclick="AsgardUI.closeModal()">Отмена</button>' +
        '<button type="submit" class="btn" id="fkAddSubmit">💾 Сохранить</button>' +
      '</div></form>';
    showModal('+ Добавить ТМЦ', html);
    initPhotoZone();
    var form = $('#fkAddForm');
    if (form) form.addEventListener('submit', async function(e) {
      e.preventDefault();
      var submitBtn = document.getElementById('fkAddSubmit');
      btnLoading(submitBtn, 'Сохранение...');
      try {
        var fd = new FormData(e.target);
        var body = { name:fd.get('name'), category_id:fd.get('category_id'), serial_number:fd.get('serial_number'),
          barcode:fd.get('barcode'), brand:fd.get('brand'), model:fd.get('model'),
          quantity:fd.get('quantity')||1, unit:fd.get('unit'),
          purchase_price:fd.get('purchase_price'), purchase_date:fd.get('purchase_date'),
          warranty_end:fd.get('warranty_end'), maintenance_interval_days:fd.get('maintenance_interval_days'), notes:fd.get('notes') };
        if (_pendingIcon) body.custom_icon = _pendingIcon;
        var r = await api('/api/equipment', { method:'POST', body: body });
        if (r.success) {
          if (_pendingPhoto && r.equipment?.id) { await uploadPendingPhoto(r.equipment.id); }
          closeModal(); toast('Успех', 'Добавлено: ' + r.equipment.inventory_number, 'ok'); loadEquipment(); loadStats();
        } else { toast('Ошибка', r.message||'Ошибка', 'err'); }
      } catch(e2) { toast('Ошибка', e2.message || 'Не удалось сохранить', 'err'); }
      finally { btnReset(submitBtn); }
    });
  }

  /* A11: Full edit form with ALL fields */
  async function openEditForm(id) {
    showModal('Загрузка...', '<div class="fk-skeleton" style="height:300px"></div>');
    try {
      var data = await api('/api/equipment/'+id);
      if (!data.success) { closeModal(); return; }
      var eq = data.equipment;
      closeModal();
      var html = '<form id="fkEditForm" style="display:grid;gap:14px">' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px">' +
          '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Наименование *</label><input name="name" class="inp" value="' + esc(eq.name||'') + '" required/></div>' +
          '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Категория *</label><select name="category_id" class="inp" required><option value="">Выберите...</option>' + catOpts(eq.category_id) + '</select></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px">' +
          '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Серийный №</label><input name="serial_number" class="inp" value="' + esc(eq.serial_number||'') + '"/></div>' +
          '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Штрих-код</label><input name="barcode" class="inp" value="' + esc(eq.barcode||'') + '"/></div>' +
          '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Бренд</label><input name="brand" class="inp" value="' + esc(eq.brand||'') + '"/></div>' +
          '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Модель</label><input name="model" class="inp" value="' + esc(eq.model||'') + '"/></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px">' +
          '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Кол-во</label><input name="quantity" type="number" class="inp" value="' + (eq.quantity||1) + '" step="0.01"/></div>' +
          '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Ед.изм.</label>' +
            '<select name="unit" class="inp"><option' + (eq.unit==='шт'?' selected':'') + '>шт</option><option' + (eq.unit==='м'?' selected':'') + '>м</option><option' + (eq.unit==='кг'?' selected':'') + '>кг</option><option' + (eq.unit==='л'?' selected':'') + '>л</option><option' + (eq.unit==='компл'?' selected':'') + '>компл</option></select></div>' +
          '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Стоимость, ₽</label><input name="purchase_price" type="number" class="inp" step="0.01" value="' + (eq.purchase_price||'') + '"/></div>' +
          '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Состояние</label><select name="condition" class="inp">' + condOpts(eq.condition) + '</select></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px">' +
          '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Гарантия до</label><input name="warranty_end" type="date" class="inp" value="' + (eq.warranty_end?eq.warranty_end.slice(0,10):'') + '"/></div>' +
          '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Интервал ТО (дней)</label><input name="maintenance_interval_days" type="number" class="inp" value="' + (eq.maintenance_interval_days||'') + '"/></div>' +
        '</div>' +
        '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Примечания</label><textarea name="notes" class="inp" rows="2">' + esc(eq.notes||'') + '</textarea></div>' +
        '<div style="display:flex;gap:10px;justify-content:flex-end">' +
          '<button type="button" class="btn ghost" onclick="AsgardUI.closeModal()">Отмена</button>' +
          '<button type="submit" class="btn" id="fkEditSubmit">💾 Сохранить</button>' +
        '</div></form>';
      showModal('✏️ Редактирование: ' + esc(eq.name), html);
      var form = $('#fkEditForm');
      if (form) form.addEventListener('submit', async function(ev) {
        ev.preventDefault();
        var submitBtn = document.getElementById('fkEditSubmit');
        btnLoading(submitBtn, 'Сохранение...');
        try {
          var fd2 = new FormData(ev.target);
          var body2 = { name:fd2.get('name'), category_id:fd2.get('category_id'), serial_number:fd2.get('serial_number'),
            barcode:fd2.get('barcode'), brand:fd2.get('brand'), model:fd2.get('model'),
            quantity:fd2.get('quantity'), unit:fd2.get('unit'), purchase_price:fd2.get('purchase_price'),
            condition:fd2.get('condition'), warranty_end:fd2.get('warranty_end'),
            maintenance_interval_days:fd2.get('maintenance_interval_days'), notes:fd2.get('notes') };
          var r2 = await api('/api/equipment/'+id, { method:'PUT', body: body2 });
          if (r2.success) { closeModal(); toast('Успех', 'Обновлено', 'ok'); loadEquipment(); }
          else toast('Ошибка', r2.message||'Ошибка', 'err');
        } catch(e3) { toast('Ошибка', e3.message || 'Не удалось сохранить', 'err'); }
        finally { btnReset(submitBtn); }
      });
    } catch(e4) { closeModal(); toast('Ошибка', e4.message || 'Не удалось загрузить', 'err'); }
  }

  async function openIssueForm(equipmentId) {
    var html = '<form id="fkIssueForm" style="display:grid;gap:14px">' +
      '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Кому выдать (РП) *</label>' +
        '<select name="holder_id" class="inp" required><option value="">Выберите...</option>' + pmOpts() + '</select></div>' +
      '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Работа *</label>' +
        '<select name="work_id" class="inp" required><option value="">Выберите...</option>' + workOpts() + '</select></div>' +
      '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Объект</label>' +
        '<select name="object_id" class="inp"><option value="">Выберите...</option>' + objOpts() + '</select></div>' +
      '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Состояние</label>' +
        '<select name="condition_after" class="inp"><option value="good">Хорошее</option><option value="satisfactory">Удовл.</option><option value="poor">Плохое</option></select></div>' +
      '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Примечание</label><textarea name="notes" class="inp" rows="2"></textarea></div>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end">' +
        '<button type="button" class="btn ghost" onclick="AsgardUI.closeModal()">Отмена</button>' +
        '<button type="submit" class="btn" id="fkIssueSubmit">📤 Выдать</button>' +
      '</div></form>';
    showModal('📤 Выдача оборудования', html);
    var form = $('#fkIssueForm');
    if (form) form.addEventListener('submit', async function(e) {
      e.preventDefault();
      var submitBtn = document.getElementById('fkIssueSubmit');
      btnLoading(submitBtn, 'Выдача...');
      try {
        var fd = new FormData(e.target);
        var r = await api('/api/equipment/issue', { method:'POST', body:{
          equipment_id:parseInt(equipmentId), holder_id:parseInt(fd.get('holder_id')),
          work_id:parseInt(fd.get('work_id')), object_id:fd.get('object_id')?parseInt(fd.get('object_id')):null,
          condition_after:fd.get('condition_after'), notes:fd.get('notes')
        }});
        if (r.success) { closeModal(); toast('Успех', 'Оборудование выдано', 'ok'); loadEquipment(); loadStats(); }
        else toast('Ошибка', r.message||'Ошибка', 'err');
      } catch(e5) { toast('Ошибка', e5.message || 'Не удалось выдать', 'err'); }
      finally { btnReset(submitBtn); }
    });
  }

  /* A4: doReturn uses askConfirm instead of confirm() */
  async function doReturn(equipmentId) {
    var ok = await askConfirm('Возврат оборудования', 'Вернуть оборудование на склад?');
    if (!ok) return;
    try {
      var r = await api('/api/equipment/return', { method:'POST', body:{ equipment_id:parseInt(equipmentId) }});
      if (r.success) { toast('Успех', 'Возвращено на склад', 'ok'); loadEquipment(); loadStats(); }
      else toast('Ошибка', r.message||'Ошибка', 'err');
    } catch(e) { toast('Ошибка', e.message || 'Не удалось вернуть', 'err'); }
  }

  async function openTransferForm(equipmentId) {
    var html = '<form id="fkTransferForm" style="display:grid;gap:14px">' +
      '<p style="color:var(--text-muted);font-size:13px;margin:0">Передача происходит через склад.</p>' +
      '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Кому (РП) *</label>' +
        '<select name="target_holder_id" class="inp" required><option value="">Выберите...</option>' + pmOpts() + '</select></div>' +
      '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Работа *</label>' +
        '<select name="work_id" class="inp" required><option value="">Выберите...</option>' + workOpts() + '</select></div>' +
      '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Объект</label>' +
        '<select name="object_id" class="inp"><option value="">Выберите...</option>' + objOpts() + '</select></div>' +
      '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Примечание</label><textarea name="notes" class="inp" rows="2"></textarea></div>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end">' +
        '<button type="button" class="btn ghost" onclick="AsgardUI.closeModal()">Отмена</button>' +
        '<button type="submit" class="btn" id="fkTransferSubmit">🔄 Запросить передачу</button>' +
      '</div></form>';
    showModal('🔄 Передача оборудования', html);
    var form = $('#fkTransferForm');
    if (form) form.addEventListener('submit', async function(e) {
      e.preventDefault();
      var submitBtn = document.getElementById('fkTransferSubmit');
      btnLoading(submitBtn, 'Отправка...');
      try {
        var fd = new FormData(e.target);
        var r = await api('/api/equipment/transfer-request', { method:'POST', body:{
          equipment_id:parseInt(equipmentId), target_holder_id:parseInt(fd.get('target_holder_id')),
          work_id:parseInt(fd.get('work_id')), object_id:fd.get('object_id')?parseInt(fd.get('object_id')):null, notes:fd.get('notes')
        }});
        if (r.success) { closeModal(); toast('Успех', 'Запрос создан', 'ok'); }
        else toast('Ошибка', r.message||'Ошибка', 'err');
      } catch(e6) { toast('Ошибка', e6.message || 'Не удалось создать запрос', 'err'); }
      finally { btnReset(submitBtn); }
    });
  }

  async function openRequestForm() {
    var html = '<form id="fkReqForm" style="display:grid;gap:14px">' +
      '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Категория</label>' +
        '<select name="category_id" class="inp"><option value="">Любая</option>' + catOpts() + '</select></div>' +
      '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Для работы *</label>' +
        '<select name="work_id" class="inp" required><option value="">Выберите...</option>' + workOpts() + '</select></div>' +
      '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Объект</label>' +
        '<select name="object_id" class="inp"><option value="">Выберите...</option>' + objOpts() + '</select></div>' +
      '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Описание *</label>' +
        '<textarea name="notes" class="inp" rows="3" required placeholder="Что именно нужно..."></textarea></div>' +
      '<button type="submit" class="btn" id="fkReqSubmit">📝 Отправить заявку</button>' +
    '</form>';
    showModal('📋 Запрос оборудования', html);
    var form = $('#fkReqForm');
    if (form) form.addEventListener('submit', async function(e) {
      e.preventDefault();
      var submitBtn = document.getElementById('fkReqSubmit');
      btnLoading(submitBtn, 'Отправка...');
      try {
        var fd = new FormData(e.target);
        var r = await api('/api/data/equipment_requests', { method:'POST', body:{
          request_type:'equipment', requester_id:currentUser.id,
          work_id:fd.get('work_id'), object_id:fd.get('object_id')||null, notes:fd.get('notes'), status:'pending'
        }});
        if (!r.error) { closeModal(); toast('Успех', 'Заявка отправлена', 'ok'); }
        else toast('Ошибка', r.error||'Ошибка', 'err');
      } catch(e7) { toast('Ошибка', e7.message || 'Не удалось отправить', 'err'); }
      finally { btnReset(submitBtn); }
    });
  }

  async function executeTransfer(requestId) {
    try {
      var r = await api('/api/equipment/transfer-execute', { method:'POST', body:{ request_id:requestId }});
      if (r.success) { toast('Успех', 'Передача выполнена', 'ok'); loadPendingRequests(); loadEquipment(); }
      else toast('Ошибка', r.message||'Ошибка', 'err');
    } catch(e) { toast('Ошибка', e.message || 'Не удалось выполнить передачу', 'err'); }
  }

  /* A4: rejectRequest uses askInput instead of prompt() */
  async function rejectRequest(requestId) {
    var reason = await askInput('Отклонение запроса', 'Укажите причину отклонения...');
    if (reason === null) return;
    try {
      var r = await api('/api/equipment/requests/'+requestId+'/reject', { method:'POST', body:{ reason: reason }});
      if (r.success) { toast('Успех', 'Отклонено', 'ok'); loadPendingRequests(); }
      else toast('Ошибка', r.message||'Ошибка', 'err');
    } catch(e) { toast('Ошибка', e.message || 'Не удалось отклонить', 'err'); }
  }

  /* A4: sendToRepair uses askInput instead of prompt() */
  async function sendToRepair(equipmentId) {
    var notes = await askInput('Отправка в ремонт', 'Укажите причину ремонта...');
    if (notes === null) return;
    try {
      var r = await api('/api/equipment/repair', { method:'POST', body:{ equipment_id:parseInt(equipmentId), notes: notes }});
      if (r.success) { toast('Успех', 'В ремонт', 'ok'); loadEquipment(); loadStats(); }
      else toast('Ошибка', r.message||'Ошибка', 'err');
    } catch(e) { toast('Ошибка', e.message || 'Не удалось отправить в ремонт', 'err'); }
  }

  async function openMaintenanceForm(eqId) {
    var html = '<form id="fkMaintForm" style="display:grid;gap:14px">' +
      '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Тип</label>' +
        '<select name="type" class="inp"><option value="scheduled_to">Плановое ТО</option><option value="repair">Ремонт</option><option value="calibration">Поверка</option><option value="inspection">Осмотр</option></select></div>' +
      '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Описание</label><textarea name="description" class="inp" rows="2"></textarea></div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px">' +
        '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">Стоимость, ₽</label><input name="cost" type="number" class="inp" step="0.01"/></div>' +
        '<div><label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-muted)">След. ТО</label><input name="next_maintenance" type="date" class="inp"/></div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end">' +
        '<button type="button" class="btn ghost" onclick="AsgardUI.closeModal()">Отмена</button>' +
        '<button type="submit" class="btn" id="fkMaintSubmit">💾 Сохранить</button>' +
      '</div></form>';
    showModal('🔧 Добавить запись ТО', html);
    var form = $('#fkMaintForm');
    if (form) form.addEventListener('submit', async function(e) {
      e.preventDefault();
      var submitBtn = document.getElementById('fkMaintSubmit');
      btnLoading(submitBtn, 'Сохранение...');
      try {
        var fd = new FormData(e.target);
        var r = await api('/api/equipment/'+eqId+'/maintenance', { method:'POST', body:{
          maintenance_type:fd.get('type'), description:fd.get('description'), cost:fd.get('cost')||null,
          next_maintenance:fd.get('next_maintenance')||null
        }});
        if (r.success) { closeModal(); toast('Успех', 'Запись добавлена', 'ok'); }
        else toast('Ошибка', r.message||'Ошибка', 'err');
      } catch(e8) { toast('Ошибка', e8.message || 'Не удалось сохранить', 'err'); }
      finally { btnReset(submitBtn); }
    });
  }

  async function showMyEquipment(userId) {
    try {
      var data = await api('/api/equipment/by-holder/'+userId);
      if (!data.equipment?.length) { toast('Информация', 'Нет закреплённого оборудования', 'info'); return; }
      var html = '<div style="max-height:400px;overflow-y:auto">' + data.equipment.map(function(eq) {
        return '<div class="fk-work-item">' +
          '<div class="fk-work-item-icon">' + (eq.category_icon||'📦') + '</div>' +
          '<div class="fk-work-item-info">' +
            '<div class="fk-work-item-name">' + esc(eq.name) + '</div>' +
            '<div class="fk-work-item-meta">' + esc(eq.inventory_number) + ' | ' + esc(eq.object_name||'—') + '</div>' +
          '</div>' +
          '<button class="btn mini" onclick="AsgardEquipment.doReturn(' + eq.id + ');AsgardUI.closeModal()">📥 Вернуть</button>' +
        '</div>';
      }).join('') + '</div>';
      showModal('👤 Моё оборудование (' + data.equipment.length + ')', html);
    } catch(e) { toast('Ошибка', e.message || 'Не удалось загрузить', 'err'); }
  }

  /* A5: Real Excel export */
  async function exportToExcel() {
    var btn = $('#fkExport');
    if (btn) { btnLoading(btn, 'Экспорт...'); }
    try {
      var auth = await AsgardAuth.getAuth();
      var params = new URLSearchParams();
      if (activeFilters.status) params.set('status', activeFilters.status);
      if (activeFilters.category_id) params.set('category_id', activeFilters.category_id);
      if (activeFilters.warehouse_id) params.set('warehouse_id', activeFilters.warehouse_id);
      var r = await fetch('/api/equipment/export/excel?' + params.toString(), {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      });
      if (!r.ok) throw { message: 'Сервер вернул ошибку ' + r.status };
      var blob = await r.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'equipment_' + new Date().toISOString().slice(0,10) + '.xlsx';
      a.click();
      URL.revokeObjectURL(url);
      toast('Экспорт', 'Файл скачан', 'ok');
    } catch(e) { toast('Ошибка', e.message || 'Не удалось экспортировать', 'err'); }
    finally { if (btn) { btnReset(btn); } }
  }

  /* --- KIT DETAIL --- */
  async function openKitDetail(kitId) {
    try {
      var data = await api('/api/equipment/kits/'+kitId);
      if (!data.success) { toast('Ошибка', 'Не удалось загрузить', 'err'); return; }
      var kit = data.kit;
      var items = data.items || [];
      var assigned = items.filter(function(i) { return i.equipment_id; }).length;
      var pct = items.length > 0 ? Math.round(assigned/items.length*100) : 0;
      var html = '<div>' +
        '<div style="display:flex;gap:14px;align-items:center;margin-bottom:16px">' +
          '<span style="font-size:40px">' + (kit.icon||'🧰') + '</span>' +
          '<div><h3 style="margin:0">' + esc(kit.name) + '</h3>' +
            '<div style="font-size:13px;color:var(--text-muted)">' + esc(kit.work_type||'Универсальный') + ' — ' + items.length + ' позиций</div></div></div>' +
        '<div class="fk-kit-bar" style="margin-bottom:16px;height:8px"><div class="fk-kit-bar-fill" style="width:' + pct + '%"></div></div>' +
        '<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);margin-bottom:16px">' +
          '<span>Собрано: ' + assigned + '/' + items.length + '</span><span>' + pct + '%</span></div>' +
        (kit.description?'<p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">' + esc(kit.description) + '</p>':'') +
        '<div style="max-height:400px;overflow-y:auto">' +
        items.map(function(item) {
          var has = !!item.equipment_id;
          return '<div style="display:flex;gap:12px;align-items:center;padding:10px;background:var(--bg);border-radius:8px;margin-bottom:6px;border-left:3px solid ' + (has?'#22c55e':item.is_required?'#ef4444':'#f59e0b') + '">' +
            '<span style="font-size:14px;width:24px;text-align:center">' + (has?'✅':'⬜') + '</span>' +
            '<div style="flex:1"><div style="font-weight:500;font-size:13px">' + esc(item.item_name||item.equipment_name||'—') + '</div>' +
            '<div style="font-size:11px;color:var(--text-muted)">' +
              (item.is_required?'Обязательно':'Опционально') + ' · x' + (item.quantity||1) +
              (has?' · ' + esc(item.equipment_name) + ' (' + esc(item.inventory_number||'') + ')':'') +
            '</div></div>' +
            (item.category_icon?'<span>' + item.category_icon + '</span>':'') +
          '</div>';
        }).join('') + '</div></div>';
      showModal((kit.icon||'🧰') + ' ' + esc(kit.name), html);
    } catch(e) { toast('Ошибка', e.message || 'Не удалось загрузить комплект', 'err'); }
  }

  /* --- WORK EQUIPMENT MODAL --- */
  async function openWorkEquipmentModal(work, user) {
    var workId = work.id;
    try {
      var results = await Promise.all([
        api('/api/equipment/work/'+workId+'/equipment').catch(function(){return {assignments:[]};}),
        api('/api/equipment/available').catch(function(){return {equipment:[]};})
      ]);
      var assigned = results[0].assignments || [];
      var available = (results[1].equipment || []).filter(function(e) { return !assigned.some(function(a) { return a.equipment_id===e.id && a.status==='active'; }); });

      var recommendations = null;
      if (work.work_type) {
        try { recommendations = await api('/api/equipment/recommend?work_type='+encodeURIComponent(work.work_type)); } catch(_) {}
      }

      var html = '<div class="fk-work-sections" style="max-width:700px;width:min(95vw,700px)">' +
        '<div><h4>📋 Назначено на работу (' + assigned.filter(function(a){return a.status==='active';}).length + ')</h4>' +
        (assigned.filter(function(a){return a.status==='active';}).length ?
          assigned.filter(function(a){return a.status==='active';}).map(function(a) {
            return '<div class="fk-work-item">' +
              '<div class="fk-work-item-icon">' + (a.category_icon||'📦') + '</div>' +
              '<div class="fk-work-item-info"><div class="fk-work-item-name">' + esc(a.name) + '</div>' +
              '<div class="fk-work-item-meta">' + esc(a.inventory_number||'') + ' · ' + fmtDate(a.assigned_at) + '</div></div>' +
              '<button class="btn mini ghost" onclick="AsgardEquipment.unassignFromWork(' + workId + ',[' + a.equipment_id + '])">📥 Вернуть</button></div>';
          }).join('') : '<div style="padding:12px;color:var(--text-muted);font-size:13px">Оборудование не назначено</div>') +
        '</div><hr style="border:none;border-top:1px solid var(--border)"/>' +
        '<div><h4>📦 Доступное оборудование</h4>' +
          '<input class="fk-avail-search" placeholder="Поиск..." oninput="AsgardEquipment._filterAvailable(this.value)"/>' +
          '<div id="fkAvailList" style="max-height:300px;overflow-y:auto">' +
            available.slice(0,50).map(function(eq) {
              return '<label class="fk-work-item" style="cursor:pointer">' +
                '<input type="checkbox" class="fk-avail-cb" value="' + eq.id + '"/>' +
                '<div class="fk-work-item-icon">' + (eq.category_icon||'📦') + '</div>' +
                '<div class="fk-work-item-info"><div class="fk-work-item-name">' + esc(eq.name) + '</div>' +
                '<div class="fk-work-item-meta">' + esc(eq.inventory_number||'') + ' · ' + esc(eq.category_name||'') + '</div></div></label>';
            }).join('') +
          '</div>' +
          '<button class="btn" style="margin-top:10px" onclick="AsgardEquipment.assignSelectedToWork(' + workId + ')">📤 Назначить выбранные</button>' +
        '</div>' +
        (recommendations?.recommendations?.length ? '<hr style="border:none;border-top:1px solid var(--border)"/><div><h4>💡 Рекомендуемый комплект</h4>' +
          recommendations.recommendations.map(function(rec) {
            return '<div style="margin-bottom:8px;font-weight:600">' + (rec.kit.icon||'🧰') + ' ' + esc(rec.kit.name) + '</div>' +
              rec.items.map(function(i) { return '<div style="font-size:12px;padding:4px 0;color:var(--text-muted)">' +
                (i.is_required?'●':'○') + ' ' + esc(i.item_name||'') + ' x' + (i.quantity||1) + '</div>'; }).join('');
          }).join('') + '</div>' : '') +
      '</div>';
      showModal('🧰 Оборудование: ' + esc(work.work_title||'Работа #'+workId), html);
      _availableCache = available;
    } catch(e) { toast('Ошибка', e.message || 'Не удалось загрузить', 'err'); }
  }

  function _filterAvailable(q) {
    var avail = _availableCache || [];
    var el = document.getElementById('fkAvailList');
    if (!el) return;
    var s = q.toLowerCase();
    var filtered = s ? avail.filter(function(eq) { return (eq.name||'').toLowerCase().includes(s)||(eq.inventory_number||'').toLowerCase().includes(s); }) : avail;
    el.innerHTML = filtered.slice(0,50).map(function(eq) {
      return '<label class="fk-work-item" style="cursor:pointer">' +
        '<input type="checkbox" class="fk-avail-cb" value="' + eq.id + '"/>' +
        '<div class="fk-work-item-icon">' + (eq.category_icon||'📦') + '</div>' +
        '<div class="fk-work-item-info"><div class="fk-work-item-name">' + esc(eq.name) + '</div>' +
        '<div class="fk-work-item-meta">' + esc(eq.inventory_number||'') + ' · ' + esc(eq.category_name||'') + '</div></div></label>';
    }).join('');
  }

  async function assignSelectedToWork(workId) {
    var ids = Array.from(document.querySelectorAll('.fk-avail-cb:checked')).map(function(cb) { return parseInt(cb.value); });
    if (!ids.length) { toast('Выберите', 'Отметьте оборудование для назначения', 'info'); return; }
    try {
      var r = await api('/api/equipment/work/'+workId+'/assign', { method:'POST', body:{ equipment_ids:ids, holder_id:currentUser.id }});
      if (r.success) { toast('Успех', 'Назначено: ' + (r.assigned?.length||0), 'ok'); closeModal(); }
      else toast('Ошибка', r.message||'Ошибка', 'err');
    } catch(e) { toast('Ошибка', e.message || 'Не удалось назначить', 'err'); }
  }

  async function assignToWork(workId, equipmentIds, holderId) {
    try {
      var r = await api('/api/equipment/work/'+workId+'/assign', { method:'POST', body:{ equipment_ids:equipmentIds, holder_id:holderId||currentUser.id }});
      if (r.success) toast('Успех', 'Назначено: ' + (r.assigned?.length||0), 'ok');
      else toast('Ошибка', r.message||'Ошибка', 'err');
      return r;
    } catch(e) { toast('Ошибка', e.message || 'Не удалось назначить', 'err'); return { success: false }; }
  }

  async function unassignFromWork(workId, equipmentIds) {
    try {
      var r = await api('/api/equipment/work/'+workId+'/unassign', { method:'POST', body:{ equipment_ids:equipmentIds }});
      if (r.success) { toast('Успех', 'Возвращено', 'ok'); closeModal(); }
      else toast('Ошибка', r.message||'Ошибка', 'err');
    } catch(e) { toast('Ошибка', e.message || 'Не удалось вернуть', 'err'); }
  }

  /* --- PHOTO MANAGER --- */
  async function openPhotoManager(eqId) {
    try {
      var data = await api('/api/equipment/' + eqId);
      if (!data.success) return;
      var eq = data.equipment;
      var html = '<div style="max-width:400px">' +
        renderPhotoZone(eq.photo_url, eq.custom_icon, eqId) +
        '<p style="margin-top:12px;font-size:12px;color:var(--text-muted)">Загрузите фото (перетащите или выберите файл) или выберите иконку из библиотеки.</p></div>';
      showModal('📷 Фото / Иконка', html);
      initPhotoZone();
    } catch(e) { toast('Ошибка', e.message || 'Не удалось загрузить', 'err'); }
  }

  /* --- VIEW / GROUP TOGGLES --- */
  function toggleView(mode) {
    viewMode = mode;
    localStorage.setItem('fk_view', mode);
    document.querySelectorAll('.fk-view-btn').forEach(function(b) { b.classList.toggle('active', b.textContent.includes(mode==='cards'?'◻':'☰')); });
    renderContent();
  }

  function setGroupBy(by) {
    groupBy = by;
    localStorage.setItem('fk_group', by);
    collapsedGroups.clear();
    document.querySelectorAll('.fk-group-btn').forEach(function(b) { b.classList.remove('active'); });
    var sel = document.querySelector('.fk-group-btn[onclick*="\'' + by + '\'"]');
    if (sel) sel.classList.add('active');
    renderContent();
  }

  function toggleGroup(key) {
    if (collapsedGroups.has(key)) collapsedGroups.delete(key); else collapsedGroups.add(key);
    renderContent();
  }

  function setFilter(key, val) {
    if (key && val) {
      activeFilters[key] = val;
      var sel = document.getElementById('fk' + key.charAt(0).toUpperCase() + key.slice(1));
      if(sel) sel.value = val;
    } else {
      activeFilters = {};
      document.querySelectorAll('.fk-select').forEach(function(s) { s.value = ''; });
    }
    loadEquipment();
  }

  function clearFilter(key) {
    delete activeFilters[key];
    var map = {category_id:'fkCat', status:'fkStatus', warehouse_id:'fkWh'};
    var el = $('#' + (map[key]||''));
    if(el) el.value = '';
    loadEquipment();
  }

  function clearSearch() {
    searchTerm = '';
    var el = $('#fkSearch');
    if(el) el.value = '';
    applyClientFilters();
  }

  /* --- PUBLIC API --- */
  return {
    render: render,
    openEquipmentCard: openEquipmentCard,
    openEditForm: openEditForm,
    openIssueForm: openIssueForm,
    doReturn: doReturn,
    openTransferForm: openTransferForm,
    executeTransfer: executeTransfer,
    rejectRequest: rejectRequest,
    sendToRepair: sendToRepair,
    openMaintenanceForm: openMaintenanceForm,
    toggleView: toggleView,
    setGroupBy: setGroupBy,
    toggleGroup: toggleGroup,
    setFilter: setFilter,
    clearFilter: clearFilter,
    clearSearch: clearSearch,
    openKitDetail: openKitDetail,
    openWorkEquipmentModal: openWorkEquipmentModal,
    assignSelectedToWork: assignSelectedToWork,
    assignToWork: assignToWork,
    unassignFromWork: unassignFromWork,
    _filterAvailable: _filterAvailable,
    openPhotoManager: openPhotoManager,
    pickIcon: pickIcon,
    removePhoto: removePhoto
  };
})();

window.AsgardEquipmentPage = window.AsgardEquipment;
