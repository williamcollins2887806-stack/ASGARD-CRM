// Доверенности — унитарный реестр (vanilla). Паритет с /v2/proxies.
window.AsgardProxiesPage = (function () {
  var _ui = AsgardUI, $ = _ui.$, $$ = _ui.$$, esc = _ui.esc, toast = _ui.toast, showModal = _ui.showModal;

  var PROXY_TYPES = [
    { id: 'tmc_short', label: 'Получение ТМЦ', desc: 'Получение ТМЦ', fields: [] },
    { id: 'tender', label: 'Тендер / переговоры', desc: 'Тендер', fields: ['tender_subject', 'counterparty'] },
    { id: 'commercial', label: 'Коммерческие договоры', desc: 'Договоры', fields: [] },
    { id: 'docs_tmc', label: 'Документы + ТМЦ', desc: 'Документы и ТМЦ', fields: [] },
    { id: 'representation', label: 'Представительство', desc: 'Госорганы', fields: [] },
    { id: 'vehicle', label: 'Транспорт', desc: 'ТС', fields: ['vehicle_brand', 'vehicle_number', 'vin'] },
    { id: 'bank', label: 'Банковская', desc: 'Банк', fields: ['bank_name', 'account_number'] },
    { id: 'custom', label: 'Свободная', desc: 'Свой текст', fields: [] }
  ];

  var FIELD_LABELS = {
    tender_subject: 'Предмет', counterparty: 'Контрагент',
    vehicle_brand: 'Марка ТС', vehicle_number: 'Гос. номер', vin: 'VIN',
    bank_name: 'Банк', account_number: 'Счёт'
  };

  var STATUS_CFG = {
    draft: { label: 'Черновик', cls: 'prx-st-draft' },
    created: { label: 'Создана', cls: 'prx-st-created' },
    issued: { label: 'Выдана', cls: 'prx-st-issued' },
    sent: { label: 'Отправлена', cls: 'prx-st-sent' },
    expiring: { label: 'Истекает', cls: 'prx-st-expiring' },
    expired: { label: 'Просрочена', cls: 'prx-st-expired' },
    annulled: { label: 'Аннулирована', cls: 'prx-st-annulled' },
    revoked: { label: 'Аннулирована', cls: 'prx-st-annulled' }
  };

  var state = {
    allRows: [], rows: [], search: '', filterType: '', filterStatus: '', loading: false
  };

  function token() { return localStorage.getItem('asgard_token') || ''; }
  function headers() {
    return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() };
  }
  function findType(id) {
    return PROXY_TYPES.find(function (t) { return t.id === id || t.label === id; }) || PROXY_TYPES[7];
  }
  function fmtDate(d) {
    if (!d) return '—';
    var dt = new Date(d);
    if (isNaN(dt.getTime())) return String(d).slice(0, 10);
    return ('0' + dt.getDate()).slice(-2) + '.' + ('0' + (dt.getMonth() + 1)).slice(-2) + '.' + dt.getFullYear();
  }
  function todayIso() { return new Date().toISOString().slice(0, 10); }
  function getStatus(row) {
    if (!row) return 'draft';
    if (row.status === 'annulled' || row.status === 'revoked') return 'annulled';
    if (row.status === 'expired') return 'expired';
    if (row.status === 'draft' || row.status === 'created') return row.status;
    if (row.valid_until) {
      var exp = new Date(row.valid_until), now = new Date();
      if (exp < now) return 'expired';
      var days = (exp - now) / 86400000;
      if (days <= 30 && (row.status === 'issued' || row.status === 'sent')) {
        return row.status === 'sent' ? 'sent' : 'expiring';
      }
    }
    return row.status || 'created';
  }
  function badge(st) {
    var c = STATUS_CFG[st] || STATUS_CFG.created;
    return '<span class="prx-badge ' + c.cls + '">' + esc(c.label) + '</span>';
  }
  function role() {
    try { return (window.AsgardAuth && AsgardAuth.getUser && AsgardAuth.getUser().role) || ''; }
    catch (e) { return ''; }
  }
  function isAdmin() { return role() === 'ADMIN'; }

  function api(path, opts) {
    opts = opts || {};
    return fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body instanceof FormData
        ? { Authorization: 'Bearer ' + token() }
        : headers(),
      body: opts.body instanceof FormData ? opts.body : (opts.body ? JSON.stringify(opts.body) : undefined)
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t || ('HTTP ' + r.status)); });
      var ct = r.headers.get('content-type') || '';
      if (ct.indexOf('json') >= 0) return r.json();
      return r;
    });
  }

  function loadProxies() {
    state.loading = true;
    render();
    return api('/api/proxies?limit=2000')
      .then(function (d) {
        state.allRows = (d.items || d.proxies || []).map(function (r) {
          r._status = getStatus(r);
          return r;
        });
        applyFilters();
      })
      .catch(function (e) { toast(e.message || 'Ошибка загрузки', 'error'); })
      .then(function () { state.loading = false; render(); });
  }

  function applyFilters() {
    var q = (state.search || '').trim().toLowerCase();
    state.rows = state.allRows.filter(function (r) {
      if (state.filterType && (r.type_id || findType(r.type).id) !== state.filterType) return false;
      if (state.filterStatus) {
        var st = r._status;
        if (state.filterStatus === 'annulled') {
          if (st !== 'annulled' && st !== 'revoked') return false;
        } else if (st !== state.filterStatus) return false;
      }
      if (!q) return true;
      return (
        String(r.fio || '').toLowerCase().indexOf(q) >= 0 ||
        String(r.number || '').toLowerCase().indexOf(q) >= 0 ||
        String(r.region || '').toLowerCase().indexOf(q) >= 0
      );
    });
  }

  function downloadBlob(url, filename) {
    return fetch(url, { headers: { Authorization: 'Bearer ' + token() } })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob();
      })
      .then(function (blob) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename || 'proxy.docx';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      });
  }

  function getStyles() {
    return '#prx-root{max-width:1280px;margin:0 auto;padding:16px 20px}' +
      '.prx-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin-bottom:16px;flex-wrap:wrap}' +
      '.prx-title{font-size:1.35em;font-weight:700;margin:0}' +
      '.prx-sub{color:var(--muted);font-size:.9em;margin-top:4px}' +
      '.prx-actions-top{display:flex;gap:8px;flex-wrap:wrap}' +
      '.prx-btn{border:1px solid var(--border);background:var(--card);color:var(--text);padding:8px 14px;border-radius:8px;cursor:pointer;font-size:.9em}' +
      '.prx-btn-prim{background:var(--accent,#3b82f6);border-color:transparent;color:#fff;font-weight:600}' +
      '.prx-toolbar{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}' +
      '.prx-input,.prx-select{background:var(--bg3,var(--card));border:1px solid var(--border);border-radius:8px;padding:8px 12px;color:var(--text);min-width:160px}' +
      '.prx-input{flex:1;min-width:220px}' +
      '.prx-table-wrap{background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:auto}' +
      '.prx-table{width:100%;border-collapse:collapse;font-size:.92em}' +
      '.prx-table th{text-align:left;padding:10px 12px;font-size:.72em;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--border)}' +
      '.prx-table td{padding:11px 12px;border-bottom:1px solid var(--border);vertical-align:middle}' +
      '.prx-row{cursor:pointer}.prx-row:hover{background:rgba(127,127,127,.08)}' +
      '.prx-num{font-weight:700;font-variant-numeric:tabular-nums}' +
      '.prx-dim{color:var(--muted);font-size:.85em}' +
      '.prx-badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:.78em;font-weight:600}' +
      '.prx-st-draft,.prx-st-annulled{background:rgba(127,127,127,.15);color:var(--muted)}' +
      '.prx-st-created{background:rgba(59,130,246,.15);color:#60a5fa}' +
      '.prx-st-issued{background:rgba(34,197,94,.15);color:#4ade80}' +
      '.prx-st-sent{background:rgba(168,85,247,.15);color:#c084fc}' +
      '.prx-st-expiring{background:rgba(245,158,11,.15);color:#fbbf24}' +
      '.prx-st-expired{background:rgba(239,68,68,.15);color:#f87171}' +
      '.prx-row-actions{white-space:nowrap;text-align:right}' +
      '.prx-row-actions button{margin-left:4px}' +
      '.prx-empty{text-align:center;padding:48px 16px;color:var(--muted)}' +
      '.prx-files span{display:inline-block;font-size:.7em;font-weight:700;padding:2px 6px;border-radius:4px;border:1px solid var(--border);margin-right:4px;color:var(--muted)}' +
      '.prx-modal-sec{margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border)}' +
      '.prx-modal-sec h4{margin:0 0 10px;font-size:.75em;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}' +
      '.prx-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}' +
      '.prx-field{margin-bottom:10px}.prx-field label{display:block;font-size:.85em;color:var(--muted);margin-bottom:4px}' +
      '.prx-field input,.prx-field textarea,.prx-field select{width:100%;box-sizing:border-box;background:var(--bg3,var(--card));border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text)}' +
      '.prx-typegrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}' +
      '.prx-typecard{text-align:left;padding:14px;border:1px solid var(--border);border-radius:10px;background:var(--card);cursor:pointer}' +
      '.prx-typecard:hover{border-color:var(--accent,#3b82f6)}' +
      '.prx-typecard b{display:block;margin-bottom:4px}' +
      '.prx-typecard span{font-size:.85em;color:var(--muted)}' +
      '.prx-mode{display:flex;gap:6px;margin-bottom:10px}' +
      '.prx-mode button{padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg3,var(--card));color:var(--text);cursor:pointer}' +
      '.prx-mode button.on{font-weight:700;border-color:var(--accent,#3b82f6)}' +
      '.prx-emp-list{max-height:180px;overflow:auto;border:1px solid var(--border);border-radius:8px;margin-top:6px}' +
      '.prx-emp-item{display:block;width:100%;text-align:left;padding:8px 10px;border:0;border-bottom:1px solid var(--border);background:transparent;color:var(--text);cursor:pointer}' +
      '.prx-emp-item:hover{background:rgba(127,127,127,.1)}' +
      '.prx-labrow{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px}' +
      '.prx-polish{border:0;background:transparent;color:var(--muted);cursor:pointer;font-size:13px;padding:2px 6px;border-radius:4px;opacity:.55}' +
      '.prx-polish:hover{opacity:1;background:rgba(127,127,127,.12)}' +
      '.prx-preview-frame{width:100%;height:min(72vh,820px);border:1px solid var(--border);border-radius:8px;background:var(--bg3,var(--card))}' +
      '@media(max-width:720px){.prx-grid2{grid-template-columns:1fr}}';
  }

  function render() {
    var root = document.getElementById('prx-root');
    if (!root) return;
    var h = '<style>' + getStyles() + '</style>';
    h += '<div class="prx-head"><div><h1 class="prx-title">Доверенности</h1>';
    h += '<div class="prx-sub">' + (state.loading ? 'Загрузка…' : (state.rows.length + ' из ' + state.allRows.length)) + '</div></div>';
    h += '<div class="prx-actions-top">';
    if (isAdmin()) h += '<button class="prx-btn" id="prx-btn-import">Импорт Excel</button>';
    h += '<button class="prx-btn" id="prx-btn-ext">Прикрепить внешнюю</button>';
    h += '<button class="prx-btn prx-btn-prim" id="prx-btn-create">Создать</button>';
    h += '</div></div>';

    h += '<div class="prx-toolbar">';
    h += '<input class="prx-input" id="prx-search" placeholder="Поиск по ФИО, номеру…" value="' + esc(state.search) + '">';
    h += '<select class="prx-select" id="prx-ftype"><option value="">Все типы</option>';
    PROXY_TYPES.forEach(function (t) {
      h += '<option value="' + t.id + '"' + (state.filterType === t.id ? ' selected' : '') + '>' + esc(t.label) + '</option>';
    });
    h += '</select><select class="prx-select" id="prx-fstatus"><option value="">Все статусы</option>';
    Object.keys(STATUS_CFG).forEach(function (k) {
      if (k === 'revoked') return;
      h += '<option value="' + k + '"' + (state.filterStatus === k ? ' selected' : '') + '>' + esc(STATUS_CFG[k].label) + '</option>';
    });
    h += '</select></div>';

    if (state.loading) {
      h += '<div class="prx-empty">Загружаем…</div>';
    } else if (!state.rows.length) {
      h += '<div class="prx-empty">Доверенностей нет. <button class="prx-btn prx-btn-prim" id="prx-empty-create">Создать</button></div>';
    } else {
      h += '<div class="prx-table-wrap"><table class="prx-table"><thead><tr>';
      h += '<th>Номер</th><th>Представитель</th><th>Тип</th><th>Выдана</th><th>До</th><th>Статус</th><th>Файлы</th><th></th>';
      h += '</tr></thead><tbody>';
      state.rows.forEach(function (r) {
        var t = findType(r.type_id || r.type);
        h += '<tr class="prx-row" data-id="' + r.id + '">';
        h += '<td class="prx-num">' + esc(r.number || '—') + '</td>';
        h += '<td>' + esc(r.fio || r.employee_name || '—');
        if (r.phone) h += '<div class="prx-dim">' + esc(r.phone) + '</div>';
        h += '</td>';
        h += '<td>' + esc(t.label) + '</td>';
        h += '<td class="prx-dim">' + fmtDate(r.issue_date) + '</td>';
        h += '<td class="prx-dim">' + fmtDate(r.valid_until) + '</td>';
        h += '<td>' + badge(r._status) + '</td>';
        h += '<td class="prx-files">';
        if (r.source !== 'external') h += '<span>CRM</span>';
        if (r.external_file_url) h += '<span>Внеш</span>';
        if (r.signed_file_url) h += '<span>Подп</span>';
        h += '</td><td class="prx-row-actions">';
        h += '<button class="prx-btn" data-act="dl" data-id="' + r.id + '" title="Скачать">↓</button>';
        h += '<button class="prx-btn" data-act="copy" data-id="' + r.id + '" title="Копия">⧉</button>';
        h += '<button class="prx-btn" data-act="send" data-id="' + r.id + '" title="Отправить">✉</button>';
        h += '<button class="prx-btn" data-act="status" data-id="' + r.id + '" title="Статус">↻</button>';
        if (r._status !== 'annulled' && r._status !== 'expired') {
          h += '<button class="prx-btn" data-act="annul" data-id="' + r.id + '" title="Аннулировать">✕</button>';
        }
        if (isAdmin()) h += '<button class="prx-btn" data-act="del" data-id="' + r.id + '" title="Удалить">⌫</button>';
        h += '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    root.innerHTML = h;
    bind();
  }

  function bind() {
    var s = $('#prx-search');
    if (s) s.oninput = function () {
      state.search = s.value;
      applyFilters();
      render();
      var el = $('#prx-search'); if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; }
    };
    var ft = $('#prx-ftype');
    if (ft) ft.onchange = function () { state.filterType = ft.value; applyFilters(); render(); };
    var fs = $('#prx-fstatus');
    if (fs) fs.onchange = function () { state.filterStatus = fs.value; applyFilters(); render(); };
    var c = $('#prx-btn-create'); if (c) c.onclick = openTypePicker;
    var e = $('#prx-btn-ext'); if (e) e.onclick = openExternal;
    var ec = $('#prx-empty-create'); if (ec) ec.onclick = openTypePicker;
    var imp = $('#prx-btn-import');
    if (imp) imp.onclick = function () {
      if (!confirm('Импортировать реестр из Downloads\\Реестр доверенностей.xlsx?')) return;
      api('/api/proxies/import-registry', { method: 'POST', body: {} })
        .then(function (r) {
          toast('Импорт: +' + (r.created || 0) + ', пропуск ' + (r.skipped || 0), 'ok');
          loadProxies();
        })
        .catch(function (err) { toast(err.message, 'error'); });
    };

    $$('#prx-root .prx-row').forEach(function (tr) {
      tr.onclick = function (ev) {
        if (ev.target.closest && ev.target.closest('[data-act]')) return;
        var row = state.allRows.find(function (r) { return String(r.id) === tr.getAttribute('data-id'); });
        if (row) openEdit(findType(row.type_id || row.type), row);
      };
    });
    $$('#prx-root [data-act]').forEach(function (btn) {
      btn.onclick = function (ev) {
        ev.stopPropagation();
        var id = btn.getAttribute('data-id');
        var act = btn.getAttribute('data-act');
        var row = state.allRows.find(function (r) { return String(r.id) === id; });
        if (!row) return;
        if (act === 'dl') {
          if (row.source === 'external' && row.external_file_url) window.open(row.external_file_url, '_blank');
          else downloadBlob('/api/proxies/' + row.id + '/render/docx', 'proxy_' + row.id + '.docx')
            .then(function () { toast('Скачано', 'ok'); })
            .catch(function (err) { toast(err.message, 'error'); });
        } else if (act === 'copy') openEdit(findType(row.type_id || row.type), null, row);
        else if (act === 'annul') {
          if (!confirm('Аннулировать № ' + (row.number || row.id) + '?')) return;
          api('/api/proxies/' + row.id, { method: 'PUT', body: { status: 'annulled' } })
            .then(function () { toast('Аннулирована', 'ok'); loadProxies(); })
            .catch(function (err) { toast(err.message, 'error'); });
        } else if (act === 'del') {
          if (!confirm('Удалить № ' + (row.number || row.id) + '?')) return;
          api('/api/proxies/' + row.id, { method: 'DELETE' })
            .then(function () { toast('Удалено', 'ok'); loadProxies(); })
            .catch(function (err) { toast(err.message, 'error'); });
        } else if (act === 'status') openStatus(row);
        else if (act === 'send') openSend(row);
      };
    });
  }

  function openTypePicker() {
    var body = '<div class="prx-typegrid">';
    PROXY_TYPES.forEach(function (t) {
      body += '<button type="button" class="prx-typecard" data-type="' + t.id + '"><b>' + esc(t.label) + '</b><span>' + esc(t.desc) + '</span></button>';
    });
    body += '</div>';
    showModal({ title: 'Новая доверенность', body: body, width: 720 });
    setTimeout(function () {
      $$('.prx-typecard').forEach(function (b) {
        b.onclick = function () {
          var t = findType(b.getAttribute('data-type'));
          var overlay = document.querySelector('.modal-overlay, .ui-modal-overlay, [data-modal-overlay]');
          if (overlay) overlay.click();
          openEdit(t, null);
        };
      });
    }, 30);
  }

  function fieldHtml(id, label, value, type) {
    type = type || 'text';
    if (type === 'textarea') {
      return '<div class="prx-field"><label>' + esc(label) + '</label><textarea id="' + id + '" rows="4">' + esc(value || '') + '</textarea></div>';
    }
    return '<div class="prx-field"><label>' + esc(label) + '</label><input id="' + id + '" type="' + type + '" value="' + esc(value || '') + '"></div>';
  }

  function powersFieldHtml(value) {
    return '<div class="prx-field">' +
      '<div class="prx-labrow"><label style="margin:0">Текст полномочий</label>' +
      '<button type="button" class="prx-polish" id="prx-polish-powers" title="Мимир поправит грамматику">✨</button></div>' +
      '<textarea id="prx-powers" rows="5">' + esc(value || '') + '</textarea></div>';
  }

  function openProxyPolish(textarea, label, context) {
    var original = (textarea && textarea.value) || '';
    if (!String(original).trim()) { toast('Сначала заполните поле', 'warn'); return; }
    var overlay = document.createElement('div');
    overlay.id = 'prxPolishOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML =
      '<div style="background:var(--bg2,var(--card));border:1px solid var(--border);border-radius:12px;max-width:960px;width:100%;max-height:90vh;overflow:auto;padding:16px 18px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
          '<div><div style="font-weight:700;font-size:15px">✨ Мимир — переписка текста</div>' +
          '<div style="font-size:12px;color:var(--muted)">' + esc(label || 'Полномочия') + '</div></div>' +
          '<button type="button" id="prxPolX" class="prx-btn" style="font-size:18px;line-height:1">×</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
          '<div><div style="font-size:11px;text-transform:uppercase;color:var(--muted);margin-bottom:6px">Было</div>' +
            '<textarea id="prxPolBefore" rows="12" readonly style="width:100%;box-sizing:border-box;opacity:.85">' + esc(original) + '</textarea></div>' +
          '<div><div style="font-size:11px;text-transform:uppercase;color:var(--muted);margin-bottom:6px">Стало</div>' +
            '<textarea id="prxPolAfter" rows="12" style="width:100%;box-sizing:border-box" placeholder="Мимир думает…"></textarea></div>' +
        '</div>' +
        '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">' +
          '<button class="prx-btn" type="button" id="prxPolCancel">Отмена</button>' +
          '<button class="prx-btn" type="button" id="prxPolAgain">✨ Ещё раз</button>' +
          '<button class="prx-btn prx-btn-prim" type="button" id="prxPolApply" disabled>Применить</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    var after = overlay.querySelector('#prxPolAfter');
    var applyBtn = overlay.querySelector('#prxPolApply');
    function destroy() { try { overlay.remove(); } catch (_) {} }
    function run() {
      applyBtn.disabled = true;
      after.value = '';
      after.placeholder = 'Мимир думает…';
      fetch('/api/proxies/polish-text', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ text: original, field_label: label || 'полномочия доверенности', context: context || {} })
      }).then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
          return d;
        });
      }).then(function (data) {
        after.value = data.polished || '';
        applyBtn.disabled = !after.value.trim();
      }).catch(function (ex) {
        toast(ex.message, 'error');
        after.placeholder = 'Ошибка';
      });
    }
    run();
    overlay.querySelector('#prxPolCancel').onclick = destroy;
    overlay.querySelector('#prxPolX').onclick = destroy;
    overlay.querySelector('#prxPolAgain').onclick = function () {
      original = after.value.trim() || original;
      run();
    };
    applyBtn.onclick = function () {
      if (!after.value.trim()) return;
      textarea.value = after.value;
      destroy();
      toast('Текст применён', 'ok');
    };
  }

  function openProxyPreview(payload) {
    var overlay = document.createElement('div');
    overlay.id = 'prxPreviewOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML =
      '<div style="background:var(--bg2,var(--card));border:1px solid var(--border);border-radius:12px;max-width:1100px;width:100%;max-height:94vh;overflow:auto;padding:16px 18px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px;flex-wrap:wrap">' +
          '<div><div style="font-weight:700;font-size:15px">Предпросмотр доверенности</div>' +
          '<div style="font-size:12px;color:var(--muted)">' + esc(payload.number || 'черновик') + '</div></div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
            '<button type="button" class="prx-btn" id="prxPrevDocx">Скачать Word</button>' +
            '<button type="button" class="prx-btn" id="prxPrevPdfDl" disabled>Скачать PDF</button>' +
            '<button type="button" class="prx-btn" id="prxPrevClose">Закрыть</button>' +
          '</div>' +
        '</div>' +
        '<div id="prxPrevStatus" class="prx-dim" style="padding:24px;text-align:center">Формируем PDF…</div>' +
        '<iframe id="prxPrevFrame" class="prx-preview-frame" style="display:none" title="proxy-preview"></iframe>' +
      '</div>';
    document.body.appendChild(overlay);
    var status = overlay.querySelector('#prxPrevStatus');
    var frame = overlay.querySelector('#prxPrevFrame');
    var pdfUrl = null;
    var pdfBtn = overlay.querySelector('#prxPrevPdfDl');
    function destroy() {
      if (pdfUrl) try { URL.revokeObjectURL(pdfUrl); } catch (_) {}
      try { overlay.remove(); } catch (_) {}
    }
    overlay.querySelector('#prxPrevClose').onclick = destroy;
    overlay.querySelector('#prxPrevDocx').onclick = function () {
      fetch('/api/proxies/preview', { method: 'POST', headers: headers(), body: JSON.stringify(payload) })
        .then(function (r) {
          if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'Ошибка Word'); });
          return r.blob();
        })
        .then(function (blob) {
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'Доверенность_' + (payload.number || 'draft') + '.docx';
          a.click();
        })
        .catch(function (err) { toast(err.message, 'error'); });
    };
    pdfBtn.onclick = function () {
      if (!pdfUrl) return;
      var a = document.createElement('a');
      a.href = pdfUrl;
      a.download = 'Доверенность_' + (payload.number || 'draft') + '.pdf';
      a.click();
    };
    fetch('/api/proxies/preview?format=pdf', { method: 'POST', headers: headers(), body: JSON.stringify(payload) })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'Ошибка PDF'); });
        return r.blob();
      })
      .then(function (blob) {
        pdfUrl = URL.createObjectURL(blob);
        frame.src = pdfUrl;
        frame.style.display = '';
        status.style.display = 'none';
        pdfBtn.disabled = false;
      })
      .catch(function (err) {
        status.textContent = err.message || 'PDF недоступен';
        status.insertAdjacentHTML('beforeend', '<div style="margin-top:12px"><button type="button" class="prx-btn" id="prxPrevFallbackDocx">Скачать Word</button></div>');
        var fb = overlay.querySelector('#prxPrevFallbackDocx');
        if (fb) fb.onclick = function () { overlay.querySelector('#prxPrevDocx').click(); };
      });
  }

  function openEdit(type, proxy, copyFrom) {
    var isEdit = !!(proxy && proxy.id && !copyFrom);
    var src = copyFrom || proxy || {};
    var title = isEdit ? 'Доверенность' : (copyFrom ? 'Копия доверенности' : 'Новая доверенность');

    api('/api/proxies/types').then(function (meta) {
      var defPowers = '';
      (meta.types || []).forEach(function (t) {
        if (t.id === type.id) defPowers = t.defaultPowers || '';
      });

      var body = '';
      body += '<div class="prx-modal-sec"><h4>Документ · ' + esc(type.label) + '</h4><div class="prx-grid2">';
      body += fieldHtml('prx-number', 'Номер', copyFrom ? '' : (src.number || ''));
      body += '<div class="prx-field"><label>Статус</label><select id="prx-status">';
      ['draft', 'created', 'issued', 'sent', 'expired', 'annulled'].forEach(function (k) {
        var sel = (copyFrom ? 'draft' : (src.status === 'revoked' ? 'annulled' : (src.status || 'created'))) === k ? ' selected' : '';
        body += '<option value="' + k + '"' + sel + '>' + esc(STATUS_CFG[k].label) + '</option>';
      });
      body += '</select></div>';
      body += fieldHtml('prx-issue', 'Дата выдачи', (src.issue_date || todayIso()).toString().slice(0, 10), 'date');
      body += fieldHtml('prx-from', 'Действует с', (src.valid_from || src.issue_date || todayIso()).toString().slice(0, 10), 'date');
      body += fieldHtml('prx-until', 'Действует до', (src.valid_until || '').toString().slice(0, 10), 'date');
      body += fieldHtml('prx-place', 'Место выдачи', src.issue_place || 'г. Москва');
      body += '</div><label style="font-size:.9em"><input type="checkbox" id="prx-redeleg"' + (src.allow_redelegation ? ' checked' : '') + '> С правом передоверия</label></div>';

      body += '<div class="prx-modal-sec"><h4>Представитель</h4>';
      body += '<div class="prx-mode"><button type="button" class="on" id="prx-mode-druzh">Из Дружины</button><button type="button" id="prx-mode-manual">Вручную</button></div>';
      body += '<div id="prx-search-wrap">' + fieldHtml('prx-emp-q', 'Поиск по Дружине', '') + '<div id="prx-emp-results"></div></div>';
      body += fieldHtml('prx-fio', 'ФИО', src.fio || src.employee_name || '');
      body += fieldHtml('prx-fio-gen', 'ФИО в родительном', src.fio_genitive || '');
      body += '<div class="prx-grid2">';
      body += fieldHtml('prx-birth', 'Дата рождения', (src.birth_date || '').toString().slice(0, 10), 'date');
      body += fieldHtml('prx-phone', 'Телефон', src.phone || '');
      body += fieldHtml('prx-ps', 'Паспорт серия', src.passport_series || '');
      body += fieldHtml('prx-pn', 'Паспорт номер', src.passport_number || '');
      body += '</div>';
      body += fieldHtml('prx-pi', 'Кем выдан', src.passport_issued || '');
      body += '<div class="prx-grid2">';
      body += fieldHtml('prx-pd', 'Дата выдачи паспорта', (src.passport_date || '').toString().slice(0, 10), 'date');
      body += fieldHtml('prx-pc', 'Код подразделения', src.passport_code || '');
      body += '</div>';
      body += fieldHtml('prx-addr', 'Адрес регистрации', src.registration_address || src.address || '', 'textarea');
      body += '</div>';

      body += '<div class="prx-modal-sec"><h4>Полномочия</h4>';
      body += powersFieldHtml(src.powers_text || src.powers_general || defPowers);
      if (type.fields && type.fields.length) {
        body += '<div class="prx-grid2">';
        type.fields.forEach(function (f) {
          var val = '';
          if (f === 'tender_subject') val = src.description || '';
          else if (f === 'counterparty') val = src.supplier || '';
          else val = src[f] || '';
          body += fieldHtml('prx-f-' + f, FIELD_LABELS[f] || f, val);
        });
        body += '</div>';
      }
      body += '</div>';

      body += '<div class="prx-modal-sec"><h4>Дополнительно</h4><div class="prx-grid2">';
      body += fieldHtml('prx-region', 'Регион', src.region || '');
      body += fieldHtml('prx-handed', 'Оригинал передан', src.original_handed_to || '');
      body += fieldHtml('prx-signatory', 'Подписант', src.signatory || '');
      body += fieldHtml('prx-notary', 'Нотариальный номер', src.notary_number || '');
      body += '</div>' + fieldHtml('prx-comment', 'Комментарий', src.comment || '') + '</div>';

      body += '<div class="prx-modal-sec"><h4>Файлы</h4>';
      if (src.signed_file_url) body += '<div class="prx-dim">Подписанный: <a href="' + esc(src.signed_file_url) + '" target="_blank">открыть</a></div>';
      if (src.external_file_url) body += '<div class="prx-dim">Внешний: <a href="' + esc(src.external_file_url) + '" target="_blank">открыть</a></div>';
      body += '<div class="prx-field"><label>Подписанный скан</label><input type="file" id="prx-signed-file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"></div></div>';

      body += '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:8px">';
      body += '<button class="prx-btn" id="prx-preview">Предпросмотр</button>';
      body += '<div style="display:flex;gap:8px"><button class="prx-btn" id="prx-cancel">Отмена</button>';
      body += '<button class="prx-btn prx-btn-prim" id="prx-save">Сохранить</button>';
      body += '<button class="prx-btn prx-btn-prim" id="prx-save-dl">Сохранить и скачать</button></div></div>';

      showModal({ title: title, body: body, width: 780 });

      setTimeout(function () {
        var employeeId = src.employee_id || null;
        var manual = !employeeId;
        var genitiveLocked = !!(src.fio_genitive && !copyFrom);
        function roughGenitive(fio) {
          var parts = String(fio || '').trim().split(/\s+/);
          if (parts.length < 2) return fio || '';
          var last = parts[0], first = parts[1], patr = parts[2] || '';
          if (/ов$|ев$|ин$/i.test(last)) last += 'а';
          else if (/ова$/i.test(last)) last = last.replace(/ова$/i, 'овой');
          else if (/ева$/i.test(last)) last = last.replace(/ева$/i, 'евой');
          if (/ей$/i.test(first)) first = first.replace(/ей$/i, 'ея');
          else if (/ий$/i.test(first)) first = first.replace(/ий$/i, 'ия');
          else if (/[бвгджзклмнпрстфхцчшщ]$/i.test(first)) first += 'а';
          else if (/а$/i.test(first)) first = first.replace(/а$/i, 'ы');
          if (/ович$/i.test(patr)) patr = patr.replace(/ович$/i, 'овича');
          else if (/евич$/i.test(patr)) patr = patr.replace(/евич$/i, 'евича');
          else if (/овна$/i.test(patr)) patr = patr.replace(/овна$/i, 'овны');
          else if (/евна$/i.test(patr)) patr = patr.replace(/евна$/i, 'евны');
          return [last, first, patr].filter(Boolean).join(' ');
        }
        var fioEl = $('#prx-fio');
        if (fioEl) {
          fioEl.addEventListener('input', function () {
            if (!genitiveLocked) $('#prx-fio-gen').value = roughGenitive(fioEl.value);
          });
        }
        var genEl = $('#prx-fio-gen');
        if (genEl) genEl.addEventListener('input', function () { genitiveLocked = true; });
        if (!src.fio_genitive && fioEl && fioEl.value && !genEl.value) {
          genEl.value = roughGenitive(fioEl.value);
        }
        function setMode(isManual) {
          manual = isManual;
          var a = $('#prx-mode-druzh'), b = $('#prx-mode-manual'), w = $('#prx-search-wrap');
          if (a) a.className = isManual ? '' : 'on';
          if (b) b.className = isManual ? 'on' : '';
          if (w) w.style.display = isManual ? 'none' : '';
          if (isManual) employeeId = null;
        }
        setMode(manual);
        var md = $('#prx-mode-druzh'); if (md) md.onclick = function () { setMode(false); };
        var mm = $('#prx-mode-manual'); if (mm) mm.onclick = function () { setMode(true); };

        var qEl = $('#prx-emp-q');
        var timer = null;
        if (qEl) qEl.oninput = function () {
          clearTimeout(timer);
          timer = setTimeout(function () {
            var q = qEl.value.trim();
            if (q.length < 2) { $('#prx-emp-results').innerHTML = ''; return; }
            api('/api/staff/employees?search=' + encodeURIComponent(q) + '&limit=15').then(function (d) {
              var arr = d.employees || d.items || [];
              var html = '<div class="prx-emp-list">';
              arr.forEach(function (e) {
                html += '<button type="button" class="prx-emp-item" data-eid="' + e.id + '">' +
                  esc(e.full_name || e.name || '') +
                  '<div class="prx-dim">' + esc(e.phone || '') + '</div></button>';
              });
              html += '</div>';
              $('#prx-emp-results').innerHTML = html;
              $$('#prx-emp-results .prx-emp-item').forEach(function (btn) {
                btn.onclick = function () {
                  var emp = arr.find(function (x) { return String(x.id) === btn.getAttribute('data-eid'); });
                  if (!emp) return;
                  employeeId = emp.id;
                  $('#prx-fio').value = emp.full_name || emp.name || '';
                  $('#prx-birth').value = (emp.birth_date || '').toString().slice(0, 10);
                  $('#prx-ps').value = emp.passport_series || '';
                  $('#prx-pn').value = emp.passport_number || '';
                  $('#prx-pi').value = emp.passport_issued || '';
                  $('#prx-pd').value = (emp.passport_date || '').toString().slice(0, 10);
                  $('#prx-pc').value = emp.passport_code || '';
                  $('#prx-addr').value = emp.registration_address || emp.address || '';
                  $('#prx-phone').value = emp.phone || '';
                  $('#prx-emp-results').innerHTML = '';
                };
              });
            }).catch(function () {});
          }, 280);
        };

        if (!isEdit && !copyFrom) {
          api('/api/proxies/next-number', { method: 'POST', body: { issue_date: $('#prx-issue').value } })
            .then(function (d) { if (d.number && !$('#prx-number').value) $('#prx-number').value = d.number; })
            .catch(function () {});
        }

        function collect() {
          var payload = {
            type_id: type.id,
            type: type.label,
            number: $('#prx-number').value.trim() || null,
            issue_date: $('#prx-issue').value || null,
            valid_from: $('#prx-from').value || null,
            valid_until: $('#prx-until').value || null,
            status: $('#prx-status').value || 'created',
            source: 'crm',
            employee_id: employeeId,
            fio: $('#prx-fio').value.trim(),
            fio_genitive: $('#prx-fio-gen').value.trim() || null,
            birth_date: $('#prx-birth').value || null,
            passport_series: $('#prx-ps').value || null,
            passport_number: $('#prx-pn').value || null,
            passport_issued: $('#prx-pi').value || null,
            passport_date: $('#prx-pd').value || null,
            passport_code: $('#prx-pc').value || null,
            registration_address: $('#prx-addr').value || null,
            phone: $('#prx-phone').value || null,
            powers_text: $('#prx-powers').value || null,
            region: $('#prx-region').value || null,
            original_handed_to: $('#prx-handed').value || null,
            signatory: $('#prx-signatory').value || null,
            notary_number: $('#prx-notary').value || null,
            comment: $('#prx-comment').value || null,
            issue_place: $('#prx-place').value || 'г. Москва',
            allow_redelegation: !!($('#prx-redeleg') && $('#prx-redeleg').checked)
          };
          (type.fields || []).forEach(function (f) {
            var el = $('#prx-f-' + f);
            if (!el) return;
            if (f === 'tender_subject') payload.description = el.value || null;
            else if (f === 'counterparty') payload.supplier = el.value || null;
            else payload[f] = el.value || null;
          });
          return payload;
        }

        function closeModal() {
          var overlay = document.querySelector('.modal-overlay, .ui-modal-overlay');
          if (overlay) overlay.click();
          else {
            var m = document.querySelector('.modal, .ui-modal');
            if (m && m.parentNode) m.parentNode.removeChild(m);
          }
        }

        $('#prx-cancel').onclick = closeModal;
        $('#prx-save').onclick = function () {
          var p = collect();
          if (!p.fio) { toast('Укажите ФИО', 'error'); return; }
          var req = isEdit
            ? api('/api/proxies/' + proxy.id, { method: 'PUT', body: p })
            : api('/api/proxies', { method: 'POST', body: p });
          req.then(function (d) {
            var item = d.item || d;
            var file = $('#prx-signed-file') && $('#prx-signed-file').files[0];
            var done = function () { toast('Сохранено', 'ok'); closeModal(); loadProxies(); };
            if (file && item.id) {
              var fd = new FormData();
              fd.append('file', file);
              return fetch('/api/proxies/' + item.id + '/upload?kind=signed', {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + token() },
                body: fd
              }).then(done);
            }
            done();
          }).catch(function (err) { toast(err.message, 'error'); });
        };
        $('#prx-save-dl').onclick = function () {
          var p = collect();
          if (!p.fio) { toast('Укажите ФИО', 'error'); return; }
          var req = isEdit
            ? api('/api/proxies/' + proxy.id, { method: 'PUT', body: p })
            : api('/api/proxies', { method: 'POST', body: p });
          req.then(function (d) {
            var item = d.item || d;
            return downloadBlob('/api/proxies/' + item.id + '/render/docx', 'proxy_' + item.id + '.docx')
              .then(function () { toast('Сохранено и скачано', 'ok'); closeModal(); loadProxies(); });
          }).catch(function (err) { toast(err.message, 'error'); });
        };
        $('#prx-preview').onclick = function () {
          var p = collect();
          if (!p.fio) { toast('Укажите ФИО', 'error'); return; }
          openProxyPreview(p);
        };
        var polishBtn = $('#prx-polish-powers');
        if (polishBtn) {
          polishBtn.onclick = function () {
            var ta = $('#prx-powers');
            if (!ta) return;
            openProxyPolish(ta, 'Текст полномочий', {
              type: type.id,
              type_label: type.label,
              number: ($('#prx-number') && $('#prx-number').value) || '',
              issue_date: ($('#prx-issue') && $('#prx-issue').value) || '',
              valid_until: ($('#prx-until') && $('#prx-until').value) || '',
              fio: ($('#prx-fio') && $('#prx-fio').value) || '',
              region: ($('#prx-region') && $('#prx-region').value) || '',
              tender_subject: ($('#prx-f-tender_subject') && $('#prx-f-tender_subject').value) || '',
              counterparty: ($('#prx-f-counterparty') && $('#prx-f-counterparty').value) || '',
              vehicle_brand: ($('#prx-f-vehicle_brand') && $('#prx-f-vehicle_brand').value) || '',
              bank_name: ($('#prx-f-bank_name') && $('#prx-f-bank_name').value) || ''
            });
          };
        }
      }, 40);
    }).catch(function (e) { toast(e.message, 'error'); });
  }

  function openExternal() {
    var body = '<div class="prx-grid2">';
    body += '<div class="prx-field"><label>Тип</label><select id="ext-type">';
    PROXY_TYPES.forEach(function (t) { body += '<option value="' + t.id + '">' + esc(t.label) + '</option>'; });
    body += '</select></div>';
    body += fieldHtml('ext-number', 'Номер', '');
    body += fieldHtml('ext-issue', 'Дата выдачи', todayIso(), 'date');
    body += fieldHtml('ext-until', 'Действует до', '', 'date');
    body += '</div>';
    body += fieldHtml('ext-fio', 'ФИО представителя', '');
    body += '<div class="prx-field"><label>Файл</label><input type="file" id="ext-file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"></div>';
    body += fieldHtml('ext-comment', 'Комментарий', '');
    body += '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">';
    body += '<button class="prx-btn" id="ext-cancel">Отмена</button>';
    body += '<button class="prx-btn prx-btn-prim" id="ext-save">Сохранить</button></div>';
    showModal({ title: 'Прикрепить внешнюю', body: body, width: 560 });
    setTimeout(function () {
      $('#ext-cancel').onclick = function () {
        var o = document.querySelector('.modal-overlay, .ui-modal-overlay');
        if (o) o.click();
      };
      $('#ext-save').onclick = function () {
        var fio = $('#ext-fio').value.trim();
        var file = $('#ext-file').files[0];
        if (!fio) { toast('Укажите ФИО', 'error'); return; }
        if (!file) { toast('Прикрепите файл', 'error'); return; }
        var type = findType($('#ext-type').value);
        var payload = {
          type_id: type.id, type: type.label,
          number: $('#ext-number').value.trim() || null,
          issue_date: $('#ext-issue').value || null,
          valid_from: $('#ext-issue').value || null,
          valid_until: $('#ext-until').value || null,
          fio: fio, employee_name: fio, status: 'issued', source: 'external',
          comment: $('#ext-comment').value || null, issue_place: 'г. Москва'
        };
        var createP = payload.number
          ? Promise.resolve(payload)
          : api('/api/proxies/next-number', { method: 'POST', body: { issue_date: payload.issue_date } })
            .then(function (d) { payload.number = d.number; return payload; });
        createP.then(function (p) {
          return api('/api/proxies', { method: 'POST', body: p });
        }).then(function (d) {
          var item = d.item || d;
          var fd = new FormData();
          fd.append('file', file);
          return fetch('/api/proxies/' + item.id + '/upload?kind=external', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token() },
            body: fd
          });
        }).then(function () {
          toast('Добавлено', 'ok');
          var o = document.querySelector('.modal-overlay, .ui-modal-overlay');
          if (o) o.click();
          loadProxies();
        }).catch(function (err) { toast(err.message, 'error'); });
      };
    }, 30);
  }

  function openStatus(row) {
    var body = '<div class="prx-field"><label>Статус</label><select id="st-val">';
    ['draft', 'created', 'issued', 'sent', 'expired', 'annulled'].forEach(function (k) {
      var cur = row.status === 'revoked' ? 'annulled' : row.status;
      body += '<option value="' + k + '"' + (cur === k ? ' selected' : '') + '>' + esc(STATUS_CFG[k].label) + '</option>';
    });
    body += '</select></div>';
    body += '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">';
    body += '<button class="prx-btn prx-btn-prim" id="st-save">Сохранить</button></div>';
    showModal({ title: 'Статус · № ' + (row.number || row.id), body: body, width: 400 });
    setTimeout(function () {
      $('#st-save').onclick = function () {
        api('/api/proxies/' + row.id, { method: 'PUT', body: { status: $('#st-val').value } })
          .then(function () {
            toast('Обновлено', 'ok');
            var o = document.querySelector('.modal-overlay, .ui-modal-overlay');
            if (o) o.click();
            loadProxies();
          }).catch(function (err) { toast(err.message, 'error'); });
      };
    }, 30);
  }

  function openSend(row) {
    var body = fieldHtml('send-to', 'Email', '');
    body += '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">';
    body += '<button class="prx-btn prx-btn-prim" id="send-go">Отправить</button></div>';
    showModal({ title: 'Отправить · № ' + (row.number || row.id), body: body, width: 420 });
    setTimeout(function () {
      $('#send-go').onclick = function () {
        var to = $('#send-to').value.trim();
        if (!to) { toast('Укажите email', 'error'); return; }
        api('/api/proxies/' + row.id + '/send', {
          method: 'POST',
          body: { to: to, prefer_signed: !!row.signed_file_url }
        }).then(function () {
          toast('Отправлено', 'ok');
          var o = document.querySelector('.modal-overlay, .ui-modal-overlay');
          if (o) o.click();
          loadProxies();
        }).catch(function (err) { toast(err.message, 'error'); });
      };
    }, 30);
  }

  function renderPage(opts) {
    opts = opts || {};
    var layout = opts.layout;
    var html = '<div id="prx-root"><div class="prx-empty">Загрузка…</div></div>';
    if (layout && layout.setContent) layout.setContent(html);
    else {
      var main = document.getElementById('content') || document.getElementById('app-main') || document.body;
      main.innerHTML = html;
    }
    loadProxies();
    window.addEventListener('asgard:proxies:changed', loadProxies);
  }

  return { render: renderPage };
})();
