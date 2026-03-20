// ASGARD CRM — ТКП (Техническо-коммерческое предложение)
window.AsgardTkpPage = (function() {
  'use strict';
  const { $, esc, toast, showModal, hideModal } = AsgardUI;

  const STATUS_MAP = {
    draft: { label: 'Черновик', color: 'var(--t2)' },
    sent: { label: 'Отправлено', color: 'var(--info)' },
    accepted: { label: 'Принято', color: 'var(--ok-t)' },
    rejected: { label: 'Отклонено', color: 'var(--err-t)' },
    expired: { label: 'Просрочено', color: 'var(--amber)' }
  };

  const TKP_TYPES = [
    { value: 'chem', label: 'Химическая очистка' },
    { value: 'hydro', label: 'Гидродинамическая очистка' },
    { value: 'hvac', label: 'HVAC' },
    { value: 'to', label: 'ТО' },
    { value: 'rp', label: 'РП' },
    { value: 'other', label: 'Другое' }
  ];

  const UNITS = ['усл.', 'компл.', 'шт.', 'м\u00B2', 'м\u00B3', 'п.м.', 'т.', 'кг', 'час', 'смена', 'рейс'];

  const PAYMENT_MAP = {
    'prepay100': '100% предоплата до начала работ',
    '5050': 'Аванс 50% по договору, остаток 50% по акту выполненных работ',
    '3070': 'Аванс 30% по договору, остаток 70% по акту выполненных работ',
    'fact': 'Оплата по факту выполнения работ в течение 10 банковских дней',
    'contract': 'В соответствии с условиями договора',
    'custom': ''
  };

  const PAYMENT_LABELS = {
    'prepay100': '100% предоплата',
    '5050': '50/50',
    '3070': '30/70',
    'fact': 'По факту',
    'contract': 'По договору',
    'custom': 'Другое'
  };

  function generatePaymentText(type, advancePct, deferredDays) {
    if (type === 'advance') {
      const pct = parseInt(advancePct) || 100;
      if (pct >= 100) return '100% предоплата до начала работ';
      return 'Аванс ' + pct + '% до начала работ, остаток ' + (100 - pct) + '% по акту выполненных работ';
    }
    if (type === 'postpay') {
      const days = parseInt(deferredDays) || 10;
      const pct = parseInt(advancePct) || 0;
      if (pct > 0) {
        return 'Аванс ' + pct + '%, остаток ' + (100 - pct) + '% в течение ' + days + ' банковских дней после подписания акта выполненных работ';
      }
      return 'Постоплата в течение ' + days + ' банковских дней после подписания акта выполненных работ';
    }
    return '';
  }

  let vatPct = 22;
  let itemRows = [];
  let _docClickBound = false;
  let _mimirStylesInjected = false;

  function injectMimirTkpStyles() {
    if (_mimirStylesInjected) return;
    _mimirStylesInjected = true;
    var s = document.createElement('style');
    s.id = 'mimir-tkp-styles';
    s.textContent =
      '@keyframes mimirSpin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}' +
      '.mimir-spinner{' +
        'display:inline-block;width:14px;height:14px;' +
        'border:2px solid rgba(212,168,67,0.3);border-top-color:#D4A843;' +
        'border-radius:50%;animation:mimirSpin .8s linear infinite;vertical-align:middle' +
      '}' +
      '.mimir-tkp-btn{' +
        'background:linear-gradient(135deg,rgba(192,57,43,0.15),rgba(42,59,102,0.15));' +
        'border:1px solid rgba(212,168,67,0.3);' +
        'color:#D4A843;padding:4px 14px;border-radius:8px;' +
        'font-size:12px;font-weight:600;cursor:pointer;' +
        'transition:all .3s;display:inline-flex;align-items:center;gap:6px;white-space:nowrap' +
      '}' +
      '.mimir-tkp-btn:hover{' +
        'background:linear-gradient(135deg,rgba(192,57,43,0.25),rgba(42,59,102,0.25));' +
        'border-color:rgba(212,168,67,0.5);' +
        'box-shadow:0 0 12px rgba(212,168,67,0.2);' +
        'transform:translateY(-1px)' +
      '}' +
      '.mimir-tkp-btn:disabled{opacity:.7;cursor:wait;transform:none}' +
      '@keyframes mimirRowFlash{' +
        '0%{background:rgba(212,168,67,0.15)}' +
        '100%{background:transparent}' +
      '}' +
      // Fix: select visibility (dark theme + table cells)
      '.modal select option,.modal-content select option{background:var(--bg2);color:var(--t1)}' +
      '#tkpItemsTable select{padding:6px 20px 6px 6px;font-size:12px;color:var(--t1)!important;background:var(--bg2)!important;-webkit-appearance:none;width:100%;box-sizing:border-box}' +
      '#tkpItemsTable select option{color:var(--t1);background:var(--bg2)}' +
      '#tkpItemsTable input{padding:6px 8px;font-size:12px}' +
      '#tkpItemsTable td{vertical-align:middle}' +
      // Payment radio cards — override global label styles
      '.tkp-pay-card{' +
        'display:flex!important;align-items:center;gap:10px;' +
        'padding:12px 16px;border:1.5px solid var(--brd);border-radius:10px;' +
        'cursor:pointer;transition:all .2s;flex:1;' +
        'text-transform:none!important;font-size:inherit!important;' +
        'letter-spacing:normal!important;color:var(--t1)!important;margin:0!important' +
      '}' +
      '.tkp-pay-card:hover{border-color:var(--blue);background:rgba(30,77,140,0.03)}' +
      '.tkp-pay-card.selected{border-color:var(--blue);background:rgba(30,77,140,0.06);box-shadow:0 0 0 3px var(--blue-glow)}' +
      '.tkp-pay-card input[type="radio"]{width:16px;height:16px;flex-shrink:0;margin:0}' +
      '.tkp-pay-card .pay-title{font-size:14px;font-weight:600;color:var(--t1);line-height:1.3}' +
      '.tkp-pay-card .pay-desc{font-size:11px;font-weight:400;color:var(--t3);margin-top:1px}' +
      '.tkp-pay-fields{display:flex;gap:12px;margin-top:8px}' +
      '.tkp-pay-fields>div{flex:1}' +
      '.tkp-pay-fields label{text-transform:uppercase;font-size:11px}' +
      // Stamp & signature checkboxes
      '.tkp-stamp-row{display:flex;gap:20px;margin:16px 0;padding:12px 16px;background:var(--bg3);border:1px solid var(--brd);border-radius:8px}' +
      '.tkp-check{display:flex!important;align-items:center;gap:8px;cursor:pointer;text-transform:none!important;font-size:13px!important;font-weight:500!important;color:var(--t1)!important;letter-spacing:normal!important;margin:0!important}' +
      '.tkp-check input[type="checkbox"]{width:18px;height:18px;accent-color:var(--blue);cursor:pointer}' +
      // Action buttons — modal footer
      '.tkp-actions{display:flex;gap:10px;margin-top:20px;padding-top:16px;border-top:1px solid var(--brd)}' +
      '.tkp-btn-save,.tkp-btn-pdf,.tkp-btn-send{display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;transition:all .2s;border:none}' +
      '.tkp-btn-save{flex:1;justify-content:center;background:var(--blue);color:#fff}' +
      '.tkp-btn-save:hover{background:var(--blue-h);box-shadow:0 4px 12px rgba(30,77,140,0.3)}' +
      '.tkp-btn-pdf{background:var(--bg3);color:var(--t1);border:1px solid var(--brd)!important}' +
      '.tkp-btn-pdf:hover{border-color:var(--blue)!important;color:var(--blue);background:rgba(30,77,140,0.05)}' +
      '.tkp-btn-send{background:linear-gradient(135deg,#1E4D8C,#2563EB);color:#fff}' +
      '.tkp-btn-send:hover{box-shadow:0 4px 12px rgba(37,99,235,0.3);transform:translateY(-1px)}' +
      // Table action buttons
      '.tkp-tbl-btn{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:6px;border:1px solid var(--brd);background:transparent;color:var(--t1);cursor:pointer;transition:all .15s;padding:0}' +
      '.tkp-tbl-btn:hover{border-color:var(--blue);color:var(--blue);background:rgba(30,77,140,0.06)}' +
      '.tkp-tbl-btn svg{width:15px;height:15px;stroke:currentColor}' +

      // ── PDF Dialog (compact) ──
      '.pdf-dlg{padding:4px 0}' +
      '.pdf-dlg-row{display:flex;align-items:center;gap:8px}' +
      '.pdf-dlg-opt{display:flex!important;align-items:center;gap:8px;' +
        'padding:8px 14px;border-radius:8px;border:1.5px solid var(--brd);' +
        'background:var(--bg2);cursor:pointer;transition:all .2s;' +
        'text-transform:none!important;font-size:13px!important;font-weight:500!important;' +
        'letter-spacing:normal!important;color:var(--t2)!important;margin:0!important;white-space:nowrap}' +
      '.pdf-dlg-opt:hover{border-color:var(--blue)}' +
      '.pdf-dlg-opt.active{border-color:var(--blue);color:var(--t1)!important;background:rgba(30,77,140,0.06)}' +
      '.pdf-dlg-opt input{display:none}' +
      '.pdf-dlg-sw{width:32px;height:18px;border-radius:9px;background:var(--brd);position:relative;transition:background .2s;flex-shrink:0}' +
      '.pdf-dlg-opt.active .pdf-dlg-sw{background:linear-gradient(135deg,#1E4D8C,#2563EB)}' +
      '.pdf-dlg-sw-dot{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.15);transition:transform .2s cubic-bezier(.34,1.56,.64,1)}' +
      '.pdf-dlg-opt.active .pdf-dlg-sw-dot{transform:translateX(14px)}' +
      '.pdf-dlg-lbl{font-size:13px}' +
      '.pdf-dlg-go{display:inline-flex;align-items:center;gap:6px;padding:8px 18px;border-radius:8px;border:none;' +
        'font-size:13px;font-weight:700;color:#fff;cursor:pointer;' +
        'background:linear-gradient(135deg,#1E4D8C,#2563EB);transition:all .2s;white-space:nowrap;margin-left:auto}' +
      '.pdf-dlg-go:hover{box-shadow:0 4px 12px rgba(30,77,140,0.3);transform:translateY(-1px)}';

    document.head.appendChild(s);
  }

  function typewriterFill(textarea, text, callback) {
    textarea.value = '';
    var i = 0;
    var step = Math.max(1, Math.floor(text.length / 40));
    var interval = setInterval(function() {
      i += step;
      textarea.value = text.substring(0, Math.min(i, text.length));
      textarea.scrollTop = textarea.scrollHeight;
      if (i >= text.length) {
        clearInterval(interval);
        textarea.value = text;
        if (callback) callback();
      }
    }, 50);
  }

  // ═══════════════════════════════════════════
  // Утилиты
  // ═══════════════════════════════════════════

  function fmt(n) {
    return Number(n).toLocaleString('ru-RU') + ' \u20BD';
  }

  async function loadVat() {
    try {
      const settings = await AsgardDB.get('settings', 'app');
      vatPct = settings ? (JSON.parse(settings.value_json || '{}').vat_pct || 22) : 22;
    } catch (e) { vatPct = 22; }
  }

  function parseItemsData(item) {
    if (!item.items) return {};
    let data = item.items;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (e) { return {}; }
    }
    return data || {};
  }

  function matchPaymentPreset(text) {
    if (!text) return 'prepay100';
    for (const key in PAYMENT_MAP) {
      if (PAYMENT_MAP[key] === text) return key;
    }
    return 'custom';
  }

  function sectionHdr(title) {
    return '<h4 style="color:var(--blue-l);margin:16px 0 8px;border-bottom:1px solid var(--brd);padding-bottom:6px">' +
      esc(title) + '</h4>';
  }

  function ensureDocClick() {
    if (_docClickBound) return;
    _docClickBound = true;
    document.addEventListener('click', function(e) {
      const dd = document.getElementById('tkpCustomerDropdown');
      if (dd && !e.target.closest('#tkpCustomerSearch') && !e.target.closest('#tkpCustomerDropdown')) {
        dd.style.display = 'none';
      }
      const td = document.getElementById('tkpTenderDropdown');
      if (td && !e.target.closest('#tkpTenderSearch') && !e.target.closest('#tkpTenderDropdown')) {
        td.style.display = 'none';
      }
    });
  }

  // ═══════════════════════════════════════════
  // Динамическая таблица работ
  // ═══════════════════════════════════════════

  function addItemRow(data) {
    data = data || {};
    const tbody = $('#tkpItemsBody');
    if (!tbody) return;
    const tr = document.createElement('tr');
    const unitOpts = UNITS.map(u =>
      '<option' + (u === (data.unit || 'усл.') ? ' selected' : '') + '>' + esc(u) + '</option>'
    ).join('');
    tr.innerHTML =
      '<td class="rn">' + (itemRows.length + 1) + '</td>' +
      '<td><input class="iname" value="' + esc(data.name || '') + '" placeholder="Наименование" style="width:100%"/></td>' +
      '<td><select class="iunit">' + unitOpts + '</select></td>' +
      '<td><input class="iqty" type="number" min="0" step="any" value="' + (data.qty || '') + '" style="width:100%"/></td>' +
      '<td><input class="iprice" type="number" min="0" step="any" value="' + (data.price || '') + '" style="width:100%"/></td>' +
      '<td class="itotal" style="text-align:right;white-space:nowrap">' + (data.total ? fmt(data.total) : '') + '</td>' +
      '<td><button class="btn ghost mini idel" type="button">\u2715</button></td>';
    tbody.appendChild(tr);
    itemRows.push(tr);

    const qtyInp = tr.querySelector('.iqty');
    const priceInp = tr.querySelector('.iprice');
    const totalCell = tr.querySelector('.itotal');

    const recalcRow = () => {
      const qty = parseFloat(qtyInp.value) || 0;
      const price = parseFloat(priceInp.value) || 0;
      const total = qty * price;
      totalCell.textContent = total ? fmt(total) : '';
      recalcTotals();
    };

    qtyInp.addEventListener('input', recalcRow);
    priceInp.addEventListener('input', recalcRow);

    tr.querySelector('.idel').addEventListener('click', () => {
      tr.remove();
      itemRows = itemRows.filter(r => r !== tr);
      renumber();
      recalcTotals();
    });
  }

  function renumber() {
    itemRows.forEach((tr, i) => {
      const c = tr.querySelector('.rn');
      if (c) c.textContent = i + 1;
    });
  }

  function getItems() {
    return itemRows.map(tr => {
      const name = (tr.querySelector('.iname') || {}).value || '';
      const unit = (tr.querySelector('.iunit') || {}).value || '';
      const qty = parseFloat((tr.querySelector('.iqty') || {}).value) || 0;
      const price = parseFloat((tr.querySelector('.iprice') || {}).value) || 0;
      return { name: name.trim(), unit: unit, qty: qty, price: price, total: qty * price };
    }).filter(i => i.name);
  }

  function recalcTotals() {
    let subtotal = 0;
    itemRows.forEach(tr => {
      const qty = parseFloat((tr.querySelector('.iqty') || {}).value) || 0;
      const price = parseFloat((tr.querySelector('.iprice') || {}).value) || 0;
      subtotal += qty * price;
    });
    const vatSum = Math.round(subtotal * vatPct / 100);
    const total = subtotal + vatSum;
    const el = $('#tkpTotals');
    if (el) {
      el.innerHTML =
        '<div>Итого без НДС: <b>' + fmt(subtotal) + '</b></div>' +
        '<div>НДС ' + vatPct + '%: <b>' + fmt(vatSum) + '</b></div>' +
        '<div style="border-top:1px solid var(--brd);padding-top:4px;margin-top:4px">' +
        '<b>ИТОГО с НДС: ' + fmt(total) + '</b></div>';
    }
  }

  // ═══════════════════════════════════════════
  // Render + Список
  // ═══════════════════════════════════════════

  async function render({ layout, title }) {
    await loadVat();
    await layout('<div id="tkp-page"><div class="loading">Загрузка...</div></div>', { title: title });
    await loadList();
    // Авто-открытие по ссылке из Мимира: #/tkp?edit=15
    var hash = location.hash || '';
    var editMatch = hash.match(/[?&]edit=(\d+)/);
    if (editMatch) {
      setTimeout(function() { openForm(editMatch[1]); }, 500);
    }
  }

  async function loadList() {
    const el = $('#tkp-page');
    if (!el) return;
    try {
      const token = localStorage.getItem('asgard_token');
      const resp = await fetch('/api/tkp', { headers: { Authorization: 'Bearer ' + token } });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      const items = data.items || [];

      el.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">' +
          '<h3 style="margin:0">ТКП (' + items.length + ')</h3>' +
          '<button class="btn primary" id="btnNewTkp">+ Создать ТКП</button>' +
        '</div>' +
        '<div class="tbl-wrap"><table class="data-table"><thead><tr>' +
          '<th>\u2116</th><th>Номер</th><th>Название</th><th>Заказчик</th>' +
          '<th>Сумма</th><th>Статус</th><th>Дата</th><th></th>' +
        '</tr></thead><tbody>' +
        (items.length ? items.map(function(i) {
          const st = STATUS_MAP[i.status] || STATUS_MAP.draft;
          return '<tr>' +
            '<td>' + i.id + '</td>' +
            '<td>' + esc(i.tkp_number || '\u2014') + '</td>' +
            '<td>' + esc(i.subject || i.title || '') + '</td>' +
            '<td>' + esc(i.customer_name || i.tender_customer || '\u2014') + '</td>' +
            '<td style="text-align:right">' + (i.total_sum ? fmt(i.total_sum) : '\u2014') + '</td>' +
            '<td><span style="color:' + st.color + ';font-weight:600">' + st.label + '</span></td>' +
            '<td>' + (i.created_at ? new Date(i.created_at).toLocaleDateString('ru-RU') : '') + '</td>' +
            '<td style="white-space:nowrap">' +
              '<button class="tkp-tbl-btn" data-action="edit" data-id="' + i.id + '" title="Редактировать"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>' +
              '<button class="tkp-tbl-btn" data-action="copy" data-id="' + i.id + '" title="Копировать ТКП"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>' +
              '<button class="tkp-tbl-btn" data-action="pdf" data-id="' + i.id + '" title="Скачать PDF"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></button>' +
              '<button class="tkp-tbl-btn" data-action="send" data-id="' + i.id + '" title="Отправить"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9z"/></svg></button>' +
            '</td></tr>';
        }).join('') : '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--t3)">Нет созданных ТКП</td></tr>') +
        '</tbody></table></div>';

      $('#btnNewTkp').addEventListener('click', () => openForm());
      el.querySelectorAll('[data-action="edit"]').forEach(b =>
        b.addEventListener('click', () => openForm(b.dataset.id))
      );
      el.querySelectorAll('[data-action="copy"]').forEach(b =>
        b.addEventListener('click', async () => {
          const token = localStorage.getItem('asgard_token');
          try {
            const resp = await fetch('/api/tkp/' + b.dataset.id + '/copy', {
              method: 'POST',
              headers: { Authorization: 'Bearer ' + token }
            });
            if (resp.ok) {
              const data = await resp.json();
              toast('Готово', 'ТКП скопировано');
              loadList();
              if (data.item && data.item.id) openForm(data.item.id);
            } else {
              const err = await resp.json().catch(function() { return {}; });
              toast('Ошибка', err.error || 'Не удалось скопировать', 'err');
            }
          } catch (ex) {
            toast('Ошибка', ex.message, 'err');
          }
        })
      );
      el.querySelectorAll('[data-action="pdf"]').forEach(b =>
        b.addEventListener('click', () => showPdfDialog(b.dataset.id))
      );
      el.querySelectorAll('[data-action="send"]').forEach(b =>
        b.addEventListener('click', () => openSendTkpModal(b.dataset.id))
      );
    } catch (e) {
      el.innerHTML = '<div class="err">Ошибка загрузки: ' + esc(e.message) + '</div>';
    }
  }

  // ═══════════════════════════════════════════
  // Форма: сборка HTML
  // ═══════════════════════════════════════════

  function buildFormHtml(o) {
    const typeOptions = TKP_TYPES.map(t =>
      '<option value="' + t.value + '"' + (t.value === o.typeVal ? ' selected' : '') + '>' + esc(t.label) + '</option>'
    ).join('');

    const ddStyle = 'position:absolute;top:100%;left:0;right:0;z-index:100;background:var(--bg2);border:1px solid var(--brd);' +
      'border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.15);display:none;max-height:240px;overflow-y:auto';

    return '' +
      // --- Секция 1: Заказчик ---
      sectionHdr('Заказчик') +
      '<div class="formrow"><div style="position:relative;grid-column:1/-1">' +
        '<label>Поиск контрагента</label>' +
        '<div style="display:flex;gap:8px">' +
          '<input id="tkpCustomerSearch" placeholder="Начните вводить название или ИНН..." style="flex:1" value="' + esc(o.item.customer_name || '') + '"/>' +
          '<button class="btn ghost" id="btnNewCustomer" type="button" style="white-space:nowrap">+ Новый</button>' +
        '</div>' +
        '<div id="tkpCustomerDropdown" style="' + ddStyle + '"></div>' +
      '</div></div>' +
      '<div class="formrow">' +
        '<div><label>ИНН</label><input id="tkpInn" value="' + esc(o.item.customer_inn || '') + '"/></div>' +
        '<div><label>КПП</label><input id="tkpKpp" value="' + esc(o.parsed.customer_kpp || '') + '"/></div>' +
      '</div>' +
      '<div class="formrow"><div style="grid-column:1/-1">' +
        '<label>Адрес</label><input id="tkpAddress" value="' + esc(o.item.customer_address || '') + '"/>' +
      '</div></div>' +
      '<div class="formrow">' +
        '<div><label>Контактное лицо</label><input id="tkpContactPerson" value="' + esc(o.item.contact_person || '') + '"/></div>' +
        '<div><label>Телефон</label><input id="tkpContactPhone" value="' + esc(o.item.contact_phone || '') + '"/></div>' +
        '<div><label>Email</label><input id="tkpContactEmail" type="email" value="' + esc(o.item.contact_email || o.item.customer_email || '') + '"/></div>' +
      '</div>' +

      // --- Связь с тендером ---
      '<div class="formrow"><div style="position:relative;grid-column:1/-1">' +
        '<label>Связь с тендером (опционально)</label>' +
        '<input id="tkpTenderSearch" placeholder="Поиск по тендерам..." value="' + esc(o.tenderTitle) + '"/>' +
        '<input type="hidden" id="tkpTenderId" value="' + (o.item.tender_id || '') + '"/>' +
        '<div id="tkpTenderDropdown" style="' + ddStyle + '"></div>' +
      '</div></div>' +

      // --- Секция 2: Предмет предложения ---
      sectionHdr('Предмет предложения') +
      '<div class="formrow"><div style="grid-column:1/-1">' +
        '<label>Название ТКП</label>' +
        '<input id="tkpSubject" value="' + esc(o.item.subject || o.item.title || '') + '" placeholder="Химическая очистка..."/>' +
      '</div></div>' +
      '<div class="formrow">' +
        '<div><label>Тип</label><select id="tkpType">' + typeOptions + '</select></div>' +
      '</div>' +
      '<div class="formrow"><div style="grid-column:1/-1">' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
          '<label>Описание работ</label>' +
        '</div>' +
        '<textarea id="tkpDescription" rows="4">' + esc(o.desc) + '</textarea>' +
        '<div style="display:flex;justify-content:flex-end;margin-top:6px">' +
          '<button class="mimir-tkp-btn" id="btnMimirDesc" type="button" title="Мимир сгенерирует описание по названию ТКП">🧙 Мимир заполнит</button>' +
        '</div>' +
      '</div></div>' +

      // --- Секция 3: Таблица работ ---
      '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--brd);margin:16px 0 8px;padding-bottom:6px">' +
        '<h4 style="color:var(--blue-l);margin:0">Работы и услуги</h4>' +
        '<button class="mimir-tkp-btn" id="btnMimirItems" type="button" title="Мимир предложит состав работ и цены">🧙 Мимир предложит работы</button>' +
      '</div>' +
      '<table class="data-table" id="tkpItemsTable"><thead><tr>' +
        '<th style="width:30px">\u2116</th>' +
        '<th>Наименование работ / услуг</th>' +
        '<th style="width:100px">Ед.</th>' +
        '<th style="width:65px">Кол-во</th>' +
        '<th style="width:110px">Цена, \u20BD</th>' +
        '<th style="width:110px">Сумма, \u20BD</th>' +
        '<th style="width:30px"></th>' +
      '</tr></thead><tbody id="tkpItemsBody"></tbody></table>' +
      '<button class="btn ghost" id="btnAddItem" style="margin-top:8px">+ Добавить строку</button>' +
      '<div id="tkpTotals" style="text-align:right;margin-top:12px"></div>' +

      // --- Секция 4: Условия ---
      sectionHdr('Условия') +
      '<div class="formrow">' +
        '<div><label>Сроки выполнения</label><input id="tkpDeadline" value="' + esc(o.item.deadline || '') + '" placeholder="30 рабочих дней"/></div>' +
        '<div><label>Срок действия, дней</label><input id="tkpValidity" type="number" value="' + (o.item.validity_days || 30) + '"/></div>' +
      '</div>' +
      // --- Способ оплаты ---
      '<div style="margin:14px 0 8px"><label>Способ оплаты</label></div>' +
      '<div style="display:flex;gap:10px;margin-bottom:12px">' +
        '<label class="tkp-pay-card' + (o.payType === 'advance' ? ' selected' : '') + '">' +
          '<input type="radio" name="tkpPayType" value="advance"' + (o.payType === 'advance' ? ' checked' : '') + '/>' +
          '<div><div class="pay-title">Аванс</div><div class="pay-desc">Предоплата до начала работ</div></div>' +
        '</label>' +
        '<label class="tkp-pay-card' + (o.payType === 'postpay' ? ' selected' : '') + '">' +
          '<input type="radio" name="tkpPayType" value="postpay"' + (o.payType === 'postpay' ? ' checked' : '') + '/>' +
          '<div><div class="pay-title">Постоплата</div><div class="pay-desc">Оплата после выполнения</div></div>' +
        '</label>' +
      '</div>' +
      '<div class="tkp-pay-fields">' +
        '<div><label>Аванс, %</label><input id="tkpAdvancePct" type="number" min="0" max="100" value="' + (o.advancePct || (o.payType === 'advance' ? 100 : 0)) + '"/></div>' +
        '<div id="tkpDeferredWrap" style="' + (o.payType === 'postpay' ? '' : 'display:none') + '"><label>Отсрочка, дней</label><input id="tkpDeferredDays" type="number" min="1" value="' + (o.deferredDays || 10) + '"/></div>' +
      '</div>' +
      '<div style="margin-top:8px"><label>Текст условий оплаты</label>' +
        '<input id="tkpPaymentText" value="' + esc(o.payText) + '" placeholder="Генерируется автоматически"/>' +
      '</div>' +

      // --- Секция 5: Подпись ---
      sectionHdr('Подпись и примечания') +
      '<div class="formrow"><div style="grid-column:1/-1">' +
        '<label>Примечания</label>' +
        '<textarea id="tkpNotes" rows="3">' + esc(o.parsed.notes || o.item.notes || '') + '</textarea>' +
      '</div></div>' +
      '<div class="formrow">' +
        '<div><label>Подписант</label><input id="tkpAuthorName" value="' + esc(o.authorName) + '"/></div>' +
        '<div><label>Должность</label><input id="tkpAuthorPosition" value="' + esc(o.authorPos) + '"/></div>' +
      '</div>' +

      // --- Печать и подпись на PDF ---
      '<div class="tkp-stamp-row">' +
        '<label class="tkp-check"><input type="checkbox" id="tkpAddSignature" checked/><span class="tkp-check-mark"></span> Подпись директора</label>' +
        '<label class="tkp-check"><input type="checkbox" id="tkpAddStamp" checked/><span class="tkp-check-mark"></span> Печать организации</label>' +
      '</div>' +

      // --- Кнопки ---
      '<div class="tkp-actions">' +
        '<button class="tkp-btn-save" id="btnSaveTkp">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17,21 17,13 7,13 7,21"/><polyline points="7,3 7,8 15,8"/></svg>' +
          (o.id ? 'Сохранить' : 'Создать черновик') +
        '</button>' +
        '<button class="tkp-btn-pdf" id="btnSavePdf">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>' +
          'Скачать PDF' +
        '</button>' +
        (o.id ? '<button class="tkp-btn-send" id="btnSendTkpEmail">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9z"/></svg>' +
          'Отправить' +
        '</button>' : '') +
      '</div>';
  }

  // ═══════════════════════════════════════════
  // Форма: сборка тела запроса
  // ═══════════════════════════════════════════

  function buildSaveBody() {
    const items = getItems();
    let subtotal = 0;
    items.forEach(function(i) { subtotal += i.total; });
    const vatSum = Math.round(subtotal * vatPct / 100);
    const totalWithVat = subtotal + vatSum;

    var checkedPay = document.querySelector('input[name="tkpPayType"]:checked');
    var payType = checkedPay ? checkedPay.value : 'advance';

    return {
      subject: ($('#tkpSubject') || {}).value || '',
      customer_name: ($('#tkpCustomerSearch') || {}).value || '',
      customer_inn: ($('#tkpInn') || {}).value || '',
      customer_address: ($('#tkpAddress') || {}).value || '',
      contact_person: ($('#tkpContactPerson') || {}).value || '',
      contact_phone: ($('#tkpContactPhone') || {}).value || '',
      contact_email: ($('#tkpContactEmail') || {}).value || '',
      tender_id: parseInt(($('#tkpTenderId') || {}).value) || null,
      work_description: ($('#tkpDescription') || {}).value || '',
      items: JSON.stringify({
        vat_pct: vatPct,
        items: items,
        subtotal: subtotal,
        vat_sum: vatSum,
        total_with_vat: totalWithVat,
        payment_type: payType,
        advance_pct: parseInt(($('#tkpAdvancePct') || {}).value) || 0,
        deferred_days: payType === 'postpay' ? (parseInt(($('#tkpDeferredDays') || {}).value) || 10) : 0,
        payment_terms: ($('#tkpPaymentText') || {}).value || '',
        author_name: ($('#tkpAuthorName') || {}).value || '',
        author_position: ($('#tkpAuthorPosition') || {}).value || '',
        tkp_type: ($('#tkpType') || {}).value || '',
        customer_kpp: ($('#tkpKpp') || {}).value || '',
        notes: ($('#tkpNotes') || {}).value || ''
      }),
      total_sum: totalWithVat,
      deadline: ($('#tkpDeadline') || {}).value || '',
      validity_days: parseInt(($('#tkpValidity') || {}).value) || 30,
      services: ''
    };
  }

  // ═══════════════════════════════════════════
  // Форма: открытие
  // ═══════════════════════════════════════════

  async function openForm(editId) {
    let currentId = editId || null;
    let item = {};

    if (currentId) {
      try {
        const token = localStorage.getItem('asgard_token');
        const resp = await fetch('/api/tkp/' + currentId, { headers: { Authorization: 'Bearer ' + token } });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        item = data.item || {};
      } catch (e) {
        toast('Ошибка', 'Не удалось загрузить ТКП: ' + e.message, 'err');
        return;
      }
    }

    await loadVat();
    const parsed = parseItemsData(item);
    if (parsed.vat_pct) vatPct = parsed.vat_pct;

    let allTenders = [];
    try { allTenders = (await AsgardDB.all('tenders')) || []; } catch (e) {}

    let tenderTitle = '';
    if (item.tender_id && allTenders.length) {
      const found = allTenders.find(function(x) { return x.id == item.tender_id; });
      if (found) tenderTitle = found.tender_title || '';
    }

    const typeVal = parsed.tkp_type || item.tkp_type || 'to';
    const payType = parsed.payment_type || 'advance';
    const advancePct = parsed.advance_pct != null ? parsed.advance_pct : (payType === 'advance' ? 100 : 0);
    const deferredDays = parsed.deferred_days || 10;
    const payText = parsed.payment_terms || generatePaymentText(payType, advancePct, deferredDays);
    const authorName = parsed.author_name || 'Кудряшов О.С.';
    const authorPos = parsed.author_position || 'Генеральный директор';
    const desc = parsed.description || item.work_description || '';

    const html = buildFormHtml({
      id: currentId, item: item, parsed: parsed, tenderTitle: tenderTitle,
      typeVal: typeVal, payType: payType, advancePct: advancePct,
      deferredDays: deferredDays, payText: payText,
      authorName: authorName, authorPos: authorPos, desc: desc
    });

    itemRows = [];

    showModal({
      title: currentId ? 'Редактирование ТКП #' + currentId : 'Новое ТКП',
      html: html,
      wide: true,
      onMount: function() {
        // Таблица работ
        if (parsed.items && Array.isArray(parsed.items)) {
          parsed.items.forEach(function(row) { addItemRow(row); });
        } else {
          addItemRow();
        }
        recalcTotals();

        // Мимир: генерация описания
        injectMimirTkpStyles();
        var btnMD = $('#btnMimirDesc');
        if (btnMD) {
          btnMD.addEventListener('click', async function() {
            var subject = ($('#tkpSubject') || {}).value;
            var typeVal = ($('#tkpType') || {}).value;
            if (!subject) { toast('Внимание', 'Сначала заполните название ТКП', 'warn'); return; }
            btnMD.disabled = true;
            btnMD.innerHTML = '<span class="mimir-spinner"></span> Мимир думает\u2026';
            try {
              var token = localStorage.getItem('asgard_token');
              var resp = await fetch('/api/mimir/suggest-tkp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                body: JSON.stringify({ description: subject + ' (тип: ' + typeVal + ')', mode: 'description' })
              });
              if (resp.ok) {
                var data = await resp.json();
                if (data.description) {
                  var ta = $('#tkpDescription');
                  if (ta) {
                    typewriterFill(ta, data.description, function() {
                      toast('🧙 Мимир', 'Описание готово');
                    });
                  }
                }
              } else {
                toast('Ошибка', 'Не удалось сгенерировать', 'err');
              }
            } catch (ex) {
              toast('Ошибка', ex.message, 'err');
            } finally {
              btnMD.disabled = false;
              btnMD.innerHTML = '🧙 Мимир заполнит';
            }
          });
        }

        // Мимир: генерация строк работ
        var btnMI = $('#btnMimirItems');
        if (btnMI) {
          btnMI.addEventListener('click', async function() {
            var subject = ($('#tkpSubject') || {}).value;
            var desc = ($('#tkpDescription') || {}).value;
            var customerName = ($('#tkpCustomerSearch') || {}).value;
            var tId = parseInt(($('#tkpTenderId') || {}).value) || null;
            if (!subject && !desc) { toast('Внимание', 'Заполните название или описание работ', 'warn'); return; }
            if (itemRows.length > 0 && itemRows.some(function(tr) { var n = tr.querySelector('.iname'); return n && n.value.trim(); })) {
              if (!confirm('Текущие строки будут заменены. Продолжить?')) return;
            }
            btnMI.disabled = true;
            btnMI.innerHTML = '<span class="mimir-spinner"></span> Мимир думает\u2026';
            try {
              var token = localStorage.getItem('asgard_token');
              var resp = await fetch('/api/mimir/suggest-tkp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                body: JSON.stringify({
                  tender_id: tId,
                  customer_name: customerName,
                  description: (subject || '') + '\n' + (desc || ''),
                  mode: 'items'
                })
              });
              if (resp.ok) {
                var data = await resp.json();
                if (data.items && data.items.length) {
                  // Очистить текущие строки
                  itemRows.forEach(function(tr) { tr.remove(); });
                  itemRows = [];
                  // Каскадное добавление строк с golden flash
                  var totalItems = data.items.length;
                  data.items.forEach(function(item, idx) {
                    setTimeout(function() {
                      addItemRow(item);
                      var lastTr = itemRows[itemRows.length - 1];
                      if (lastTr) {
                        lastTr.style.animation = 'mimirRowFlash 1s ease forwards';
                      }
                      // Пересчёт + glow на итогах после последней строки
                      if (idx === totalItems - 1) {
                        recalcTotals();
                        var totalsEl = $('#tkpTotals');
                        if (totalsEl) {
                          totalsEl.style.transition = 'box-shadow .5s';
                          totalsEl.style.boxShadow = '0 0 12px rgba(212,168,67,0.3)';
                          setTimeout(function() { totalsEl.style.boxShadow = ''; }, 2000);
                        }
                      }
                    }, idx * 200);
                  });
                  toast('🧙 Мимир', totalItems + ' позиций предложено. Проверьте цены!');
                }
                if (data.description && !($('#tkpDescription') || {}).value) {
                  var ta = $('#tkpDescription');
                  if (ta) typewriterFill(ta, data.description);
                }
              } else {
                toast('Ошибка', 'Не удалось сгенерировать', 'err');
              }
            } catch (ex) {
              toast('Ошибка', ex.message, 'err');
            } finally {
              btnMI.disabled = false;
              btnMI.innerHTML = '🧙 Мимир предложит работы';
            }
          });
        }

        // + Добавить строку
        const btnAdd = $('#btnAddItem');
        if (btnAdd) btnAdd.addEventListener('click', function() { addItemRow(); });

        // Autocomplete
        setupCustomerAutocomplete();
        setupTenderAutocomplete(allTenders);
        ensureDocClick();

        // Оплата: радио-карточки (аванс / постоплата)
        function updatePayText() {
          var checked = document.querySelector('input[name="tkpPayType"]:checked');
          var type = checked ? checked.value : 'advance';
          var pct = ($('#tkpAdvancePct') || {}).value || 0;
          var days = ($('#tkpDeferredDays') || {}).value || 10;
          var inp = $('#tkpPaymentText');
          if (inp) inp.value = generatePaymentText(type, pct, days);
          // Show/hide deferred days
          var dw = $('#tkpDeferredWrap');
          if (dw) dw.style.display = type === 'postpay' ? '' : 'none';
          // Toggle .selected on cards
          document.querySelectorAll('.tkp-pay-card').forEach(function(card) {
            var r = card.querySelector('input[type="radio"]');
            card.classList.toggle('selected', r && r.checked);
          });
        }

        document.querySelectorAll('input[name="tkpPayType"]').forEach(function(r) {
          r.addEventListener('change', updatePayText);
        });
        var advInp = $('#tkpAdvancePct');
        if (advInp) advInp.addEventListener('input', updatePayText);
        var defInp = $('#tkpDeferredDays');
        if (defInp) defInp.addEventListener('input', updatePayText);
        updatePayText();

        // + Новый заказчик
        const btnNew = $('#btnNewCustomer');
        if (btnNew) {
          btnNew.addEventListener('click', function() {
            if (window.AsgardContractsPage && AsgardContractsPage.openNewCustomerModal) {
              AsgardContractsPage.openNewCustomerModal(function(created) {
                if (created && created.id) {
                  const cs = $('#tkpCustomerSearch');
                  if (cs) { cs.value = created.short_name || created.name || ''; }
                  const inn = $('#tkpInn'); if (inn && created.inn) inn.value = created.inn;
                  const kpp = $('#tkpKpp'); if (kpp && created.kpp) kpp.value = created.kpp;
                  const addr = $('#tkpAddress'); if (addr && created.legal_address) addr.value = created.legal_address;
                  const cp = $('#tkpContactPerson'); if (cp && created.contact_person) cp.value = created.contact_person;
                  const cph = $('#tkpContactPhone'); if (cph && created.contact_phone) cph.value = created.contact_phone;
                  const ce = $('#tkpContactEmail'); if (ce && created.contact_email) ce.value = created.contact_email;
                  toast('Контрагент создан', created.short_name || created.name, 'ok');
                }
              });
            } else {
              toast('Ошибка', 'Модуль договоров не загружен', 'err');
            }
          });
        }

        // Сохранить
        const btnSave = $('#btnSaveTkp');
        if (btnSave) {
          btnSave.addEventListener('click', async function() {
            const body = buildSaveBody();
            const token = localStorage.getItem('asgard_token');
            try {
              const resp = await fetch(currentId ? '/api/tkp/' + currentId : '/api/tkp', {
                method: currentId ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                body: JSON.stringify(body)
              });
              if (resp.ok) {
                const result = await resp.json();
                if (!currentId) currentId = result.id || (result.item && result.item.id);
                toast('Готово', editId ? 'ТКП обновлено' : 'ТКП создано');
                hideModal();
                loadList();
              } else {
                const err = await resp.json().catch(function() { return {}; });
                toast('Ошибка', err.error || 'Не удалось сохранить (HTTP ' + resp.status + ')', 'err');
              }
            } catch (ex) {
              toast('Ошибка', ex.message, 'err');
            }
          });
        }

        // Скачать PDF (сначала сохранить)
        const btnPdf = $('#btnSavePdf');
        if (btnPdf) {
          btnPdf.addEventListener('click', async function() {
            const body = buildSaveBody();
            const token = localStorage.getItem('asgard_token');
            try {
              const resp = await fetch(currentId ? '/api/tkp/' + currentId : '/api/tkp', {
                method: currentId ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                body: JSON.stringify(body)
              });
              if (resp.ok) {
                const result = await resp.json();
                if (!currentId) currentId = result.id || (result.item && result.item.id);
                if (currentId) {
                  var pdfUrl = '/api/tkp/' + currentId + '/pdf?token=' + token;
                  var sigCb = $('#tkpAddSignature');
                  var stCb = $('#tkpAddStamp');
                  if (sigCb && sigCb.checked) pdfUrl += '&signature=1';
                  if (stCb && stCb.checked) pdfUrl += '&stamp=1';
                  window.open(pdfUrl, '_blank');
                }
              } else {
                const err = await resp.json().catch(function() { return {}; });
                toast('Ошибка', err.error || 'Не удалось сохранить (HTTP ' + resp.status + ')', 'err');
              }
            } catch (ex) {
              toast('Ошибка', ex.message, 'err');
            }
          });
        }

        // Отправить
        const btnSend = $('#btnSendTkpEmail');
        if (btnSend) {
          btnSend.addEventListener('click', function() {
            if (currentId) openSendTkpModal(currentId);
          });
        }
      }
    });
  }

  // ═══════════════════════════════════════════
  // Autocomplete: заказчик
  // ═══════════════════════════════════════════

  function setupCustomerAutocomplete() {
    const input = $('#tkpCustomerSearch');
    const dropdown = $('#tkpCustomerDropdown');
    if (!input || !dropdown) return;

    let timer = null;
    let customers = [];

    input.addEventListener('input', function() {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { dropdown.style.display = 'none'; return; }
      timer = setTimeout(async function() {
        try {
          const token = localStorage.getItem('asgard_token');
          const resp = await fetch('/api/customers?search=' + encodeURIComponent(q) + '&limit=10', {
            headers: { Authorization: 'Bearer ' + token }
          });
          if (!resp.ok) { dropdown.style.display = 'none'; return; }
          const data = await resp.json();
          customers = data.customers || [];
          if (!customers.length) { dropdown.style.display = 'none'; return; }
          dropdown.innerHTML = customers.map(function(c, i) {
            return '<div class="ac-item" data-idx="' + i + '" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--brd)">' +
              esc(c.name || '') + ' <span style="color:var(--t3)">(ИНН: ' + esc(c.inn || '\u2014') + ')</span></div>';
          }).join('');
          dropdown.style.display = 'block';
        } catch (e) {
          dropdown.style.display = 'none';
        }
      }, 300);
    });

    dropdown.addEventListener('mouseover', function(e) {
      const el = e.target.closest('.ac-item');
      if (el) el.style.background = 'var(--bg3)';
    });
    dropdown.addEventListener('mouseout', function(e) {
      const el = e.target.closest('.ac-item');
      if (el) el.style.background = '';
    });

    dropdown.addEventListener('click', function(e) {
      const el = e.target.closest('.ac-item');
      if (!el) return;
      const c = customers[parseInt(el.dataset.idx)];
      if (!c) return;
      input.value = c.name || '';
      const innF = $('#tkpInn'); if (innF) innF.value = c.inn || '';
      const kppF = $('#tkpKpp'); if (kppF) kppF.value = c.kpp || '';
      const addrF = $('#tkpAddress'); if (addrF) addrF.value = c.address || c.legal_address || '';
      const cpF = $('#tkpContactPerson'); if (cpF) cpF.value = c.contact_person || '';
      const phF = $('#tkpContactPhone'); if (phF) phF.value = c.phone || '';
      const emF = $('#tkpContactEmail'); if (emF) emF.value = c.email || '';
      dropdown.style.display = 'none';
    });
  }

  // ═══════════════════════════════════════════
  // Autocomplete: тендер
  // ═══════════════════════════════════════════

  function setupTenderAutocomplete(allTenders) {
    const input = $('#tkpTenderSearch');
    const dropdown = $('#tkpTenderDropdown');
    const hiddenId = $('#tkpTenderId');
    if (!input || !dropdown) return;

    let matches = [];

    input.addEventListener('input', function() {
      const q = input.value.trim().toLowerCase();
      if (q.length < 2) { dropdown.style.display = 'none'; return; }
      matches = allTenders.filter(function(t) {
        return (t.tender_title || '').toLowerCase().indexOf(q) >= 0 ||
               (t.customer_name || '').toLowerCase().indexOf(q) >= 0;
      }).slice(0, 10);
      if (!matches.length) { dropdown.style.display = 'none'; return; }
      dropdown.innerHTML = matches.map(function(t, i) {
        return '<div class="ac-item" data-idx="' + i + '" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--brd)">' +
          esc(t.tender_title || '') + ' <span style="color:var(--t3)">(' + esc(t.customer_name || '') + ')</span></div>';
      }).join('');
      dropdown.style.display = 'block';
    });

    dropdown.addEventListener('mouseover', function(e) {
      const el = e.target.closest('.ac-item');
      if (el) el.style.background = 'var(--bg3)';
    });
    dropdown.addEventListener('mouseout', function(e) {
      const el = e.target.closest('.ac-item');
      if (el) el.style.background = '';
    });

    dropdown.addEventListener('click', function(e) {
      const el = e.target.closest('.ac-item');
      if (!el) return;
      const t = matches[parseInt(el.dataset.idx)];
      if (!t) return;
      input.value = t.tender_title || '';
      if (hiddenId) hiddenId.value = t.id;
      const custInp = $('#tkpCustomerSearch');
      if (custInp && !custInp.value.trim() && t.customer_name) {
        custInp.value = t.customer_name;
      }
      const innInp = $('#tkpInn');
      if (innInp && !innInp.value.trim() && t.customer_inn) {
        innInp.value = t.customer_inn;
      }
      dropdown.style.display = 'none';
    });
  }

  // ═══════════════════════════════════════════
  // Отправка ТКП по email — через модальное окно с шаблоном
  // ═══════════════════════════════════════════

  async function openSendTkpModal(id) {
    const token = localStorage.getItem('asgard_token');
    let tkp = {};
    try {
      const resp = await fetch('/api/tkp/' + id, { headers: { Authorization: 'Bearer ' + token } });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      tkp = data.item || {};
    } catch (e) {
      toast('Ошибка', 'Не удалось загрузить ТКП', 'err');
      return;
    }

    const customerEmail = tkp.contact_email || tkp.customer_email || '';
    const customerName = tkp.customer_name || tkp.tender_customer || '';
    const tkpTitle = tkp.subject || tkp.title || '';
    const totalSum = tkp.total_sum ? Number(tkp.total_sum).toLocaleString('ru-RU') + ' руб.' : 'по запросу';
    const validityDays = tkp.validity_days || 30;
    const services = tkp.services || '';
    const tkpType = tkp.tkp_type || 'to';
    const deadline = tkp.deadline || '';

    const emailBody = buildTkpEmailBody({ tkp: tkp, customerName: customerName, tkpTitle: tkpTitle, totalSum: totalSum, validityDays: validityDays, services: services, tkpType: tkpType, deadline: deadline });
    const emailSubject = 'Коммерческое предложение: ' + tkpTitle;

    if (window.AsgardEmailCompose) {
      try { hideModal(); } catch (_) {}
      AsgardEmailCompose.open({
        mode: 'compose',
        email: {
          to_prefill: customerEmail,
          subject_prefill: emailSubject,
          body_prefill: emailBody,
          tkp_id: id
        }
      });
      setTimeout(function() {
        const toInput = document.getElementById('compose-to');
        const subjectInput = document.getElementById('compose-subject');
        const bodyInput = document.getElementById('compose-body');
        if (toInput && !toInput.value) toInput.value = customerEmail;
        if (subjectInput && !subjectInput.value) subjectInput.value = emailSubject;
        if (bodyInput && !bodyInput.value) bodyInput.value = emailBody;
      }, 300);
      return;
    }

    if (window.AsgardEmail && AsgardEmail.openEmailModal) {
      try { hideModal(); } catch (_) {}
      AsgardEmail.openEmailModal({
        to: customerEmail,
        templateType: 'tkp',
        data: {
          tkp_title: tkpTitle,
          total_sum: totalSum,
          validity_days: validityDays,
          customer_name: customerName,
          services: services,
          deadline: deadline
        },
        attachments: [{ name: 'TKP_' + id + '.pdf', url: '/api/tkp/' + id + '/pdf?token=' + token }],
        entityType: 'tkp',
        entityId: id
      });
      return;
    }

    if (!customerEmail) {
      toast('Ошибка', 'Укажите email заказчика в карточке ТКП', 'err');
      return;
    }
    const resp2 = await fetch('/api/tkp/' + id + '/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ email: customerEmail })
    });
    if (resp2.ok) {
      toast('Готово', 'ТКП отправлено на ' + customerEmail);
      loadList();
    } else {
      const err = await resp2.json().catch(function() { return {}; });
      toast('Ошибка', err.error || 'Не удалось отправить', 'err');
    }
  }

  function buildTkpEmailBody(opts) {
    const { customerName, tkpTitle, totalSum, validityDays, services, tkpType, deadline } = opts;
    const typeLabel = tkpType === 'rp' ? 'ремонтных работ' : 'технического обслуживания';

    let body = 'Добрый день!\n\nНаправляем Вам коммерческое предложение на выполнение ' + typeLabel + '.\n\nНаименование: ' + tkpTitle;
    if (customerName) body += '\nЗаказчик: ' + customerName;
    body += '\nСумма: ' + totalSum;
    if (deadline) body += '\nСрок выполнения: ' + deadline;
    body += '\nСрок действия предложения: ' + validityDays + ' дней';
    if (services) body += '\n\nПеречень услуг:\n' + services;
    body += '\n\nДетали предложения во вложении (PDF).\n\nС уважением,\nООО \u00ABАсгард Сервис\u00BB\nТел: +7 (499) 322-30-62\nEmail: info@asgard-service.ru';
    return body;
  }

  // ═══════════════════════════════════════════
  // WOW-диалог параметров PDF (из таблицы)
  // ═══════════════════════════════════════════

  function showPdfDialog(tkpId) {
    var html =
      '<div class="pdf-dlg">' +
        '<div class="pdf-dlg-row">' +
          '<label class="pdf-dlg-opt active" id="pdfOptSig">' +
            '<input type="checkbox" id="pdfChkSig" checked/>' +
            '<span class="pdf-dlg-sw"><span class="pdf-dlg-sw-dot"></span></span>' +
            '<span class="pdf-dlg-lbl">Подпись</span>' +
          '</label>' +
          '<label class="pdf-dlg-opt active" id="pdfOptStamp">' +
            '<input type="checkbox" id="pdfChkStamp" checked/>' +
            '<span class="pdf-dlg-sw"><span class="pdf-dlg-sw-dot"></span></span>' +
            '<span class="pdf-dlg-lbl">Печать</span>' +
          '</label>' +
          '<button class="pdf-dlg-go" id="pdfDlgDownload">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">' +
              '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>' +
              '<polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/>' +
            '</svg>' +
            'PDF' +
          '</button>' +
        '</div>' +
      '</div>';

    showModal({
      title: 'Выгрузка PDF',
      html: html,
      onMount: function() {
        // Toggle
        document.querySelectorAll('.pdf-dlg-opt').forEach(function(opt) {
          opt.addEventListener('click', function(e) {
            if (e.target.tagName === 'INPUT') return;
            var cb = opt.querySelector('input');
            cb.checked = !cb.checked;
            opt.classList.toggle('active', cb.checked);
          });
          var cb = opt.querySelector('input');
          cb.addEventListener('change', function() { opt.classList.toggle('active', cb.checked); });
        });
        // Download
        document.getElementById('pdfDlgDownload').addEventListener('click', function() {
          var token = localStorage.getItem('asgard_token');
          var url = '/api/tkp/' + tkpId + '/pdf?token=' + token;
          if (document.getElementById('pdfChkSig').checked) url += '&signature=1';
          if (document.getElementById('pdfChkStamp').checked) url += '&stamp=1';
          window.open(url, '_blank');
          hideModal();
        });
      }
    });
  }

  return { render: render, openSendTkpModal: openSendTkpModal };
})();
