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

  let vatPct = 22;
  let itemRows = [];
  let _docClickBound = false;

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
            '<td>' +
              '<button class="btn ghost mini" data-action="edit" data-id="' + i.id + '" title="Редактировать">\u270F\uFE0F</button>' +
              '<button class="btn ghost mini" data-action="pdf" data-id="' + i.id + '" title="PDF">\uD83D\uDCC4</button>' +
              '<button class="btn ghost mini" data-action="send" data-id="' + i.id + '" title="Отправить">\uD83D\uDCE8</button>' +
            '</td></tr>';
        }).join('') : '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--t3)">Нет созданных ТКП</td></tr>') +
        '</tbody></table></div>';

      $('#btnNewTkp').addEventListener('click', () => openForm());
      el.querySelectorAll('[data-action="edit"]').forEach(b =>
        b.addEventListener('click', () => openForm(b.dataset.id))
      );
      el.querySelectorAll('[data-action="pdf"]').forEach(b =>
        b.addEventListener('click', () => {
          const t = localStorage.getItem('asgard_token');
          window.open('/api/tkp/' + b.dataset.id + '/pdf?token=' + t, '_blank');
        })
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

    const payOptions = Object.keys(PAYMENT_MAP).map(k =>
      '<option value="' + k + '"' + (k === o.payPreset ? ' selected' : '') + '>' + (PAYMENT_LABELS[k] || k) + '</option>'
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
        '<label>Описание работ</label>' +
        '<textarea id="tkpDescription" rows="4">' + esc(o.desc) + '</textarea>' +
      '</div></div>' +

      // --- Секция 3: Таблица работ ---
      sectionHdr('Работы и услуги') +
      '<table class="data-table" id="tkpItemsTable"><thead><tr>' +
        '<th style="width:30px">\u2116</th>' +
        '<th>Наименование работ / услуг</th>' +
        '<th style="width:80px">Ед.</th>' +
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
        '<div><label>Сроки выполнения</label><input id="tkpDeadline" value="' + esc(o.item.deadline || '') + '"/></div>' +
        '<div><label>Срок действия, дней</label><input id="tkpValidity" type="number" value="' + (o.item.validity_days || 30) + '"/></div>' +
      '</div>' +
      '<div class="formrow">' +
        '<div><label>Условия оплаты</label><select id="tkpPaymentPreset">' + payOptions + '</select></div>' +
        '<div><label>Текст условий</label><input id="tkpPaymentText" value="' + esc(o.payText) + '"/></div>' +
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

      // --- Кнопки ---
      '<hr class="hr"/>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
        '<button class="btn primary" id="btnSaveTkp" style="flex:1">' + (o.id ? 'Сохранить' : 'Создать черновик') + '</button>' +
        '<button class="btn" id="btnSavePdf">\uD83D\uDCC4 Скачать PDF</button>' +
        (o.id ? '<button class="btn ghost" id="btnSendTkpEmail">\uD83D\uDCE8 Отправить</button>' : '') +
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
    const payPreset = matchPaymentPreset(parsed.payment_terms);
    const payText = parsed.payment_terms || PAYMENT_MAP['prepay100'];
    const authorName = parsed.author_name || 'Кудряшов О.С.';
    const authorPos = parsed.author_position || 'Генеральный директор';
    const desc = parsed.description || item.work_description || '';

    const html = buildFormHtml({
      id: currentId, item: item, parsed: parsed, tenderTitle: tenderTitle,
      typeVal: typeVal, payPreset: payPreset, payText: payText,
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

        // + Добавить строку
        const btnAdd = $('#btnAddItem');
        if (btnAdd) btnAdd.addEventListener('click', function() { addItemRow(); });

        // Autocomplete
        setupCustomerAutocomplete();
        setupTenderAutocomplete(allTenders);
        ensureDocClick();

        // Пресет оплаты
        const presetSel = $('#tkpPaymentPreset');
        if (presetSel) {
          presetSel.addEventListener('change', function() {
            const text = PAYMENT_MAP[presetSel.value];
            if (text !== undefined) {
              const inp = $('#tkpPaymentText');
              if (inp) inp.value = text;
            }
          });
        }

        // + Новый заказчик
        const btnNew = $('#btnNewCustomer');
        if (btnNew) {
          btnNew.addEventListener('click', function() {
            const fields = ['#tkpCustomerSearch', '#tkpInn', '#tkpKpp', '#tkpAddress', '#tkpContactPerson', '#tkpContactPhone', '#tkpContactEmail'];
            fields.forEach(function(sel) { const f = $(sel); if (f) f.value = ''; });
            const cs = $('#tkpCustomerSearch');
            if (cs) cs.focus();
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
                  window.open('/api/tkp/' + currentId + '/pdf?token=' + token, '_blank');
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
    body += '\n\nДетали предложения во вложении (PDF).\n\nС уважением,\nООО \u00ABАсгард Сервис\u00BB\nТел: +7 (XXX) XXX-XX-XX\nEmail: info@asgard-service.ru';
    return body;
  }

  return { render: render, openSendTkpModal: openSendTkpModal };
})();
