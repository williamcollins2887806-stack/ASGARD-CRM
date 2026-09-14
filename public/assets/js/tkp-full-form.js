// ASGARD CRM — Полное КП (шаблон Ника). Модалка 2 на /#/tkp.
window.AsgardTkpFullForm = (function() {
  'use strict';
  const { esc, toast, showModal, hideModal } = AsgardUI;

  function emptyFull() {
    return {
      object_name: '',
      basis: 'Техническое задание, ведомость объемов работ и письменные ответы Заказчика на технические вопросы',
      conditions: {
        mobilization: '',
        personnel: '',
        regime: '',
        payment: '',
        customer_resources: '',
        price_summary: ''
      },
      scope: '',
      scope_boundary: '',
      apparatus: [{ equipment: '', inventory_no: '', tube_data: '', qty: '1 компл.', amount_no_vat: '' }],
      transport_amount: 0,
      cost_notes: '',
      acceptance: '',
      risks: '',
      customer_duties: '',
      deliverables: '',
      author_name: '',
      author_position: 'Генеральный директор'
    };
  }

  function sectionHdr(title) {
    return '<div class="cr-f-section" style="margin-top:16px"><span class="cr-f-section__icon" style="color:var(--gold)">▸</span><span>' + esc(title) + '</span></div>';
  }

  function polishBtn(fieldId) {
    return '<button type="button" class="mimir-tkp-btn tkp-polish-btn" data-polish="' + fieldId + '" title="Мимир перепишет текст">✨</button>';
  }

  function fieldWithPolish(label, id, rows, value) {
    return '<div style="margin-bottom:10px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center">' +
        '<label style="font-size:11px;text-transform:uppercase;color:var(--t3)">' + esc(label) + '</label>' +
        polishBtn(id) +
      '</div>' +
      '<textarea id="' + id + '" rows="' + rows + '" style="width:100%;box-sizing:border-box;margin-top:4px">' + esc(value || '') + '</textarea>' +
    '</div>';
  }

  function apparatusRowHtml(r, idx) {
    r = r || {};
    return '<tr data-idx="' + idx + '">' +
      '<td style="width:28px">' + (idx + 1) + '</td>' +
      '<td><input class="fa-eq" value="' + esc(r.equipment || '') + '" placeholder="Оборудование" style="width:100%;box-sizing:border-box"/></td>' +
      '<td style="width:100px"><input class="fa-inv" value="' + esc(r.inventory_no || '') + '" placeholder="Инв. №" style="width:100%;box-sizing:border-box"/></td>' +
      '<td><input class="fa-tube" value="' + esc(r.tube_data || '') + '" placeholder="трубки; L; Ø" style="width:100%;box-sizing:border-box"/></td>' +
      '<td style="width:90px"><input class="fa-qty" value="' + esc(r.qty || '1 компл.') + '" style="width:100%;box-sizing:border-box"/></td>' +
      '<td style="width:120px"><input class="fa-amt" type="number" step="0.01" value="' + (r.amount_no_vat != null && r.amount_no_vat !== '' ? r.amount_no_vat : '') + '" style="width:100%;box-sizing:border-box"/></td>' +
      '<td style="width:32px"><button type="button" class="btn ghost mini fa-del" title="Удалить">×</button></td>' +
    '</tr>';
  }

  function openPolishSheet(textarea, label) {
    var original = textarea.value || '';
    if (!original.trim()) { toast('Мимир', 'Сначала заполните поле', 'warn'); return; }

    var overlay = document.createElement('div');
    overlay.id = 'tkpPolishOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML =
      '<div style="background:var(--bg2);border:1px solid var(--brd);border-radius:12px;max-width:960px;width:100%;max-height:90vh;overflow:auto;padding:16px 18px;box-shadow:0 12px 40px rgba(0,0,0,.35)">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
          '<div><div style="font-weight:700;font-size:15px">✨ Мимир — переписка текста</div>' +
          '<div style="font-size:12px;color:var(--t3)">' + esc(label || 'Поле КП') + '</div></div>' +
          '<button type="button" id="tkpPolX" class="btn ghost" style="font-size:18px;line-height:1">×</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
          '<div><div style="font-size:11px;text-transform:uppercase;color:var(--t3);margin-bottom:6px">Было</div>' +
            '<textarea id="tkpPolBefore" rows="12" readonly style="width:100%;box-sizing:border-box;opacity:.85">' + esc(original) + '</textarea></div>' +
          '<div><div style="font-size:11px;text-transform:uppercase;color:var(--t3);margin-bottom:6px">Стало</div>' +
            '<textarea id="tkpPolAfter" rows="12" style="width:100%;box-sizing:border-box" placeholder="Мимир думает…"></textarea></div>' +
        '</div>' +
        '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">' +
          '<button class="btn ghost" type="button" id="tkpPolCancel">Отмена</button>' +
          '<button class="btn ghost" type="button" id="tkpPolAgain">✨ Ещё раз</button>' +
          '<button class="btn primary" type="button" id="tkpPolApply" disabled>Применить</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var after = overlay.querySelector('#tkpPolAfter');
    var applyBtn = overlay.querySelector('#tkpPolApply');
    function destroy() { try { overlay.remove(); } catch (_) {} }

    async function run() {
      applyBtn.disabled = true;
      after.value = '';
      after.placeholder = 'Мимир думает…';
      try {
        var token = localStorage.getItem('asgard_token');
        var r = await fetch('/api/tkp/polish-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ text: original, field_label: label || 'раздел КП' })
        });
        if (!r.ok) { var e = await r.json().catch(function(){return{};}); throw new Error(e.error || 'HTTP ' + r.status); }
        var data = await r.json();
        after.value = data.polished || '';
        applyBtn.disabled = !after.value.trim();
      } catch (ex) {
        toast('Ошибка', ex.message, 'err');
        after.placeholder = 'Ошибка';
      }
    }
    run();
    overlay.querySelector('#tkpPolCancel').addEventListener('click', destroy);
    overlay.querySelector('#tkpPolX').addEventListener('click', destroy);
    overlay.querySelector('#tkpPolAgain').addEventListener('click', function() {
      original = after.value.trim() || original;
      run();
    });
    applyBtn.addEventListener('click', function() {
      if (!after.value.trim()) return;
      textarea.value = after.value;
      destroy();
      toast('Мимир', 'Текст применён', 'ok');
    });
  }

  function bindPolish(root) {
    root.querySelectorAll('.tkp-polish-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var id = btn.getAttribute('data-polish');
        var ta = root.querySelector('#' + id);
        if (!ta) return;
        var label = (btn.previousElementSibling && btn.previousElementSibling.textContent) || id;
        openPolishSheet(ta, label);
      });
    });
  }

  function collectApparatus(tbody) {
    var rows = [];
    tbody.querySelectorAll('tr').forEach(function(tr) {
      rows.push({
        equipment: (tr.querySelector('.fa-eq') || {}).value || '',
        inventory_no: (tr.querySelector('.fa-inv') || {}).value || '',
        tube_data: (tr.querySelector('.fa-tube') || {}).value || '',
        qty: (tr.querySelector('.fa-qty') || {}).value || '1 компл.',
        amount_no_vat: parseFloat((tr.querySelector('.fa-amt') || {}).value) || 0
      });
    });
    return rows;
  }

  function calcPreviewTotals(root) {
    var apparatus = collectApparatus(root.querySelector('#fullAppBody'));
    var transport = parseFloat((root.querySelector('#fullTransport') || {}).value) || 0;
    var sub = transport;
    apparatus.forEach(function(r) { sub += Number(r.amount_no_vat) || 0; });
    var vatPct = 22;
    var vat = Math.round(sub * vatPct) / 100;
    var total = Math.round((sub + vat) * 100) / 100;
    var el = root.querySelector('#fullTotals');
    if (el) {
      el.innerHTML = 'Итого без НДС: <b>' + sub.toLocaleString('ru-RU', { minimumFractionDigits: 2 }) + '</b> ₽ · ' +
        'НДС 22%: <b>' + vat.toLocaleString('ru-RU', { minimumFractionDigits: 2 }) + '</b> ₽ · ' +
        '<span style="color:var(--gold);font-weight:700">С НДС: ' + total.toLocaleString('ru-RU', { minimumFractionDigits: 2 }) + ' ₽</span>';
    }
    return { subtotal: sub, vat_pct: vatPct, vat_sum: vat, total_with_vat: total };
  }

  async function openFullForm(editId, prefill, onSaved) {
    prefill = prefill || {};
    var currentId = editId || null;
    var item = {};
    var full = emptyFull();
    var vatPct = 22;

    if (currentId) {
      try {
        var token = localStorage.getItem('asgard_token');
        var resp = await fetch('/api/tkp/' + currentId, { headers: { Authorization: 'Bearer ' + token } });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var data = await resp.json();
        item = data.item || {};
        var cj = {};
        try { cj = typeof item.items === 'string' ? JSON.parse(item.items || '{}') : (item.items || {}); } catch (_) {}
        if (cj.full) full = Object.assign(emptyFull(), cj.full, { conditions: Object.assign(emptyFull().conditions, (cj.full.conditions || {})) });
        if (cj.vat_pct) vatPct = cj.vat_pct;
      } catch (e) {
        toast('Ошибка', 'Не удалось загрузить ТКП: ' + e.message, 'err');
        return;
      }
    } else {
      item = {
        customer_name: prefill.customer_name || '',
        customer_inn: prefill.customer_inn || '',
        subject: prefill.subject || '',
        validity_days: 30
      };
      if (prefill.object_name) full.object_name = prefill.object_name;
    }

    if (!full.apparatus.length) full.apparatus = [{ equipment: '', inventory_no: '', tube_data: '', qty: '1 компл.', amount_no_vat: '' }];

    var html =
      sectionHdr('Шапка') +
      '<div class="formrow"><div style="position:relative;grid-column:1/-1">' +
        '<label>Поиск контрагента</label>' +
        '<div style="display:flex;gap:8px">' +
          '<input id="fullCustomer" placeholder="Начните вводить название или ИНН..." style="flex:1" autocomplete="off" value="' + esc(item.customer_name || '') + '"/>' +
          '<button class="btn ghost" id="fullBtnNewCustomer" type="button" style="white-space:nowrap">+ Новый</button>' +
        '</div>' +
      '</div></div>' +
      '<div class="formrow">' +
        '<div><label>ИНН</label><div style="display:flex;gap:6px"><input id="fullInn" placeholder="10 или 12 цифр" value="' + esc(item.customer_inn || '') + '"/><button class="btn ghost" id="fullInnLookup" type="button" title="Найти по ИНН в ЕГРЮЛ">🔄</button></div></div>' +
        '<div><label>Срок действия, дн.</label><input id="fullValidity" type="number" value="' + (item.validity_days || 30) + '"/></div>' +
        '<div><label>№ КП (опц.)</label><input id="fullNumber" value="' + esc(item.tkp_number || '') + '"/></div>' +
      '</div>' +
      '<div id="fullCustomerCardWrap" style="margin:2px 0 8px"></div>' +
      fieldWithPolish('Объект', 'fullObject', 2, full.object_name) +
      fieldWithPolish('Предмет', 'fullSubject', 2, item.subject || '') +
      fieldWithPolish('Основание', 'fullBasis', 2, full.basis) +

      sectionHdr('Условия и комментарии') +
      fieldWithPolish('Мобилизация и срок', 'fullCondMob', 3, full.conditions.mobilization) +
      fieldWithPolish('Персонал', 'fullCondPers', 2, full.conditions.personnel) +
      fieldWithPolish('Режим производства', 'fullCondReg', 3, full.conditions.regime) +
      fieldWithPolish('Оплата', 'fullCondPay', 2, full.conditions.payment) +
      fieldWithPolish('Ресурсы Заказчика', 'fullCondRes', 3, full.conditions.customer_resources) +
      fieldWithPolish('Цена предложения (текст)', 'fullCondPrice', 2, full.conditions.price_summary) +

      sectionHdr('Технический периметр') +
      fieldWithPolish('Технический периметр работ', 'fullScope', 6, full.scope) +
      fieldWithPolish('Граница объема', 'fullScopeBound', 3, full.scope_boundary) +

      sectionHdr('Стоимость работ по аппаратам') +
      '<div style="overflow-x:auto"><table class="data-table" style="font-size:12px"><thead><tr>' +
        '<th>№</th><th>Оборудование</th><th>Инв. №</th><th>Расчётные данные по трубкам</th><th>Кол-во</th><th>Сумма без НДС</th><th></th>' +
      '</tr></thead><tbody id="fullAppBody">' +
        full.apparatus.map(apparatusRowHtml).join('') +
      '</tbody></table></div>' +
      '<button class="btn ghost" id="fullAddApp" type="button" style="margin-top:8px">+ Добавить аппарат</button>' +
      '<div class="formrow" style="margin-top:10px"><div><label>Транспортные расходы (без НДС)</label><input id="fullTransport" type="number" step="0.01" value="' + (full.transport_amount || 0) + '"/></div></div>' +
      '<div id="fullTotals" style="text-align:right;margin:8px 0;font-size:13px"></div>' +
      fieldWithPolish('Примечания к распределению стоимости', 'fullCostNotes', 4, full.cost_notes) +

      sectionHdr('Юридические разделы') +
      fieldWithPolish('Порядок сдачи, приемки и оплаты', 'fullAcceptance', 5, full.acceptance) +
      fieldWithPolish('Условия, влияющие на сроки и стоимость', 'fullRisks', 5, full.risks) +
      fieldWithPolish('Обязанности заказчика (по строкам)', 'fullDuties', 5, full.customer_duties) +
      fieldWithPolish('Исполнительная документация (по строкам)', 'fullDeliverables', 4, full.deliverables) +

      sectionHdr('Подпись') +
      '<div class="formrow">' +
        '<div><label>Должность</label><input id="fullAuthorPos" value="' + esc(full.author_position || 'Генеральный директор') + '"/></div>' +
        '<div><label>ФИО</label><input id="fullAuthorName" value="' + esc(full.author_name || '') + '"/></div>' +
      '</div>' +

      '<div class="tkp-actions" style="margin-top:16px;flex-wrap:wrap">' +
        '<button class="tkp-btn-pdf" id="fullPreview" type="button">Предпросмотр</button>' +
        '<button class="tkp-btn-save" id="fullSave" type="button">' + (currentId ? 'Сохранить' : 'Создать полное КП') + '</button>' +
        (currentId ? '<button class="tkp-btn-pdf" id="fullPdfNoStamp" type="button">PDF без печати</button>' : '') +
        (currentId ? '<button class="tkp-btn-pdf" id="fullPdfStamp" type="button">PDF с печатью</button>' : '') +
        (currentId ? '<button class="tkp-btn-pdf" id="fullDocx" type="button" style="color:#1B7340;border-color:rgba(27,115,64,0.35)!important">Word</button>' : '') +
      '</div>';

    showModal({
      title: currentId ? ('Полное КП #' + currentId) : 'Полное коммерческое предложение',
      icon: '📑',
      subtitle: 'Шаблон развёрнутого КП',
      wide: true,
      html: '<div id="fullKpRoot" style="max-height:70vh;overflow:auto;padding-right:4px">' + html + '</div>',
      onMount: function() {
        var root = document.getElementById('fullKpRoot');
        if (!root) return;
        bindPolish(root);

        // ── Заказчик: автокомплит + ИНН lookup + «+ Новый»
        // Dropdown в body + position:fixed — иначе overflow модалки обрезает список.
        (function setupFullCustomerPicker() {
          var input = root.querySelector('#fullCustomer');
          var innInput = root.querySelector('#fullInn');
          var cardWrap = root.querySelector('#fullCustomerCardWrap');
          if (!input) return;

          var timer = null;
          var customers = [];
          var dropdown = document.createElement('div');
          dropdown.id = 'fullCustomerDropdown';
          dropdown.setAttribute('role', 'listbox');
          dropdown.style.cssText = 'position:fixed;z-index:10060;background:var(--bg2);border:1px solid var(--brd);' +
            'border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.25);display:none;max-height:260px;overflow-y:auto;';
          document.body.appendChild(dropdown);

          function hideDropdown() { dropdown.style.display = 'none'; }

          function positionDropdown() {
            var r = input.getBoundingClientRect();
            dropdown.style.left = Math.round(r.left) + 'px';
            dropdown.style.top = Math.round(r.bottom + 4) + 'px';
            dropdown.style.width = Math.round(r.width) + 'px';
          }

          function destroyDropdown() {
            try { dropdown.remove(); } catch (_) {}
            window.removeEventListener('resize', positionDropdown);
            root.removeEventListener('scroll', positionDropdown, true);
          }

          function applyCustomer(c) {
            if (!c) return;
            input.value = c.name || c.short_name || c.full_name || '';
            if (innInput) innInput.value = c.inn || '';
            hideDropdown();
            if (cardWrap && (c.inn || '') && window.AsgardCustomerCard) {
              AsgardCustomerCard.mount(cardWrap, c.inn);
            }
          }

          async function lookupByInn(raw) {
            var inn = String(raw || '').replace(/\D/g, '');
            if (inn.length !== 10 && inn.length !== 12) return;
            try {
              var token = localStorage.getItem('asgard_token');
              var r = await fetch('/api/customers?search=' + encodeURIComponent(inn) + '&limit=5', {
                headers: { Authorization: 'Bearer ' + token }
              });
              if (r.ok) {
                var data = await r.json();
                var list = data.customers || [];
                var hit = list.find(function(x) {
                  return String(x.inn || '').replace(/\D/g, '') === inn;
                });
                if (hit) { applyCustomer(hit); toast('Заказчик', 'Подставлен из CRM', 'ok'); return; }
              }
              var lr = await fetch('/api/customers/lookup/' + encodeURIComponent(inn), {
                headers: { Authorization: 'Bearer ' + token }
              });
              if (!lr.ok) return;
              var ld = await lr.json();
              var s = ld.suggestion || ld.customer || (ld.found ? ld : null);
              if (ld.found && s && (s.name || s.full_name)) {
                applyCustomer({ name: s.name || s.full_name, inn: s.inn || inn });
                toast('ЕГРЮЛ', 'Заполнено из реестра', 'ok');
              } else if (ld.message) {
                toast('ИНН', ld.message, 'warn');
              }
            } catch (_) { /* silent */ }
          }

          input.addEventListener('input', function() {
            clearTimeout(timer);
            var q = input.value.trim();
            if (q.length < 2) { hideDropdown(); return; }
            timer = setTimeout(async function() {
              var digits = q.replace(/\D/g, '');
              var isInn = (digits.length === 10 || digits.length === 12) && digits === q.replace(/\s/g, '');
              try {
                var token = localStorage.getItem('asgard_token');
                var resp = await fetch('/api/customers?search=' + encodeURIComponent(q) + '&limit=10', {
                  headers: { Authorization: 'Bearer ' + token }
                });
                if (!resp.ok) { hideDropdown(); if (isInn) lookupByInn(digits); return; }
                var data = await resp.json();
                customers = data.customers || [];
                if (isInn) {
                  var hit = customers.find(function(x) {
                    return String(x.inn || '').replace(/\D/g, '') === digits;
                  });
                  if (hit) { applyCustomer(hit); return; }
                  if (!customers.length) { hideDropdown(); lookupByInn(digits); return; }
                }
                if (!customers.length) { hideDropdown(); return; }
                dropdown.innerHTML = customers.map(function(c, i) {
                  return '<div class="ac-item" data-idx="' + i + '" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--brd)">' +
                    esc(c.name || '') + ' <span style="color:var(--t3)">(ИНН: ' + esc(c.inn || '—') + ')</span></div>';
                }).join('');
                positionDropdown();
                dropdown.style.display = 'block';
              } catch (_) {
                hideDropdown();
                if (isInn) lookupByInn(digits);
              }
            }, 300);
          });

          dropdown.addEventListener('mouseover', function(e) {
            var el = e.target.closest('.ac-item');
            if (el) el.style.background = 'var(--bg3)';
          });
          dropdown.addEventListener('mouseout', function(e) {
            var el = e.target.closest('.ac-item');
            if (el) el.style.background = '';
          });
          dropdown.addEventListener('mousedown', function(e) {
            // mousedown — до blur инпута, иначе клик «съедается»
            var el = e.target.closest('.ac-item');
            if (!el) return;
            e.preventDefault();
            applyCustomer(customers[parseInt(el.dataset.idx, 10)]);
          });

          document.addEventListener('click', function hideDd(e) {
            if (e.target === input || dropdown.contains(e.target)) return;
            hideDropdown();
          });

          window.addEventListener('resize', positionDropdown);
          root.addEventListener('scroll', positionDropdown, true);

          // Снять portal при закрытии модалки
          var mo = new MutationObserver(function() {
            if (!document.body.contains(root)) {
              destroyDropdown();
              mo.disconnect();
            }
          });
          mo.observe(document.body, { childList: true, subtree: true });

          if (innInput) {
            innInput.addEventListener('blur', function() { lookupByInn(innInput.value); });
            innInput.addEventListener('keydown', function(e) {
              if (e.key === 'Enter') { e.preventDefault(); lookupByInn(innInput.value); }
            });
          }
          var btnLookup = root.querySelector('#fullInnLookup');
          if (btnLookup) {
            btnLookup.addEventListener('click', function() { lookupByInn((innInput || {}).value); });
          }

          var btnNew = root.querySelector('#fullBtnNewCustomer');
          if (btnNew) {
            btnNew.addEventListener('click', function() {
              var openNew = window.AsgardContractsPage && AsgardContractsPage.openNewCustomerModal;
              if (openNew) {
                openNew(function(created) {
                  if (!created) return;
                  applyCustomer({
                    name: created.short_name || created.name || '',
                    inn: created.inn || ''
                  });
                  toast('Контрагент создан', created.short_name || created.name || '', 'ok');
                });
              } else {
                toast('Ошибка', 'Модуль договоров не загружен — откройте раздел «Договоры» и повторите', 'err');
              }
            });
          }

          if (item.customer_inn && window.AsgardCustomerCard && cardWrap) {
            AsgardCustomerCard.mount(cardWrap, item.customer_inn);
          }
        })();

        function renumber() {
          root.querySelectorAll('#fullAppBody tr').forEach(function(tr, i) {
            tr.dataset.idx = i;
            var cell = tr.querySelector('td');
            if (cell) cell.textContent = String(i + 1);
          });
        }

        root.querySelector('#fullAddApp').addEventListener('click', function() {
          var body = root.querySelector('#fullAppBody');
          body.insertAdjacentHTML('beforeend', apparatusRowHtml({}, body.children.length));
          renumber();
          calcPreviewTotals(root);
        });
        root.querySelector('#fullAppBody').addEventListener('click', function(e) {
          var btn = e.target.closest('.fa-del');
          if (!btn) return;
          var tr = btn.closest('tr');
          if (tr && root.querySelectorAll('#fullAppBody tr').length > 1) { tr.remove(); renumber(); calcPreviewTotals(root); }
        });
        root.querySelector('#fullAppBody').addEventListener('input', function() { calcPreviewTotals(root); });
        root.querySelector('#fullTransport').addEventListener('input', function() { calcPreviewTotals(root); });
        calcPreviewTotals(root);

        function buildBody() {
          var totals = calcPreviewTotals(root);
          var fullPayload = {
            object_name: (root.querySelector('#fullObject') || {}).value || '',
            basis: (root.querySelector('#fullBasis') || {}).value || '',
            conditions: {
              mobilization: (root.querySelector('#fullCondMob') || {}).value || '',
              personnel: (root.querySelector('#fullCondPers') || {}).value || '',
              regime: (root.querySelector('#fullCondReg') || {}).value || '',
              payment: (root.querySelector('#fullCondPay') || {}).value || '',
              customer_resources: (root.querySelector('#fullCondRes') || {}).value || '',
              price_summary: (root.querySelector('#fullCondPrice') || {}).value || ''
            },
            scope: (root.querySelector('#fullScope') || {}).value || '',
            scope_boundary: (root.querySelector('#fullScopeBound') || {}).value || '',
            apparatus: collectApparatus(root.querySelector('#fullAppBody')),
            transport_amount: parseFloat((root.querySelector('#fullTransport') || {}).value) || 0,
            cost_notes: (root.querySelector('#fullCostNotes') || {}).value || '',
            acceptance: (root.querySelector('#fullAcceptance') || {}).value || '',
            risks: (root.querySelector('#fullRisks') || {}).value || '',
            customer_duties: (root.querySelector('#fullDuties') || {}).value || '',
            deliverables: (root.querySelector('#fullDeliverables') || {}).value || '',
            author_name: (root.querySelector('#fullAuthorName') || {}).value || '',
            author_position: (root.querySelector('#fullAuthorPos') || {}).value || 'Генеральный директор'
          };
          return {
            kp_variant: 'full',
            subject: (root.querySelector('#fullSubject') || {}).value || '',
            customer_name: (root.querySelector('#fullCustomer') || {}).value || '',
            customer_inn: (root.querySelector('#fullInn') || {}).value || '',
            validity_days: parseInt((root.querySelector('#fullValidity') || {}).value, 10) || 30,
            tkp_number: (root.querySelector('#fullNumber') || {}).value || null,
            total_sum: totals.total_with_vat,
            work_description: fullPayload.scope ? String(fullPayload.scope).slice(0, 500) : '',
            items: {
              vat_pct: totals.vat_pct,
              subtotal: totals.subtotal,
              vat_sum: totals.vat_sum,
              total_with_vat: totals.total_with_vat,
              items: fullPayload.apparatus.map(function(a) {
                return { name: a.equipment, unit: a.qty || 'компл.', qty: 1, price: a.amount_no_vat, total: a.amount_no_vat };
              }),
              full: fullPayload
            }
          };
        }

        root.querySelector('#fullSave').addEventListener('click', async function() {
          var btn = this;
          var body = buildBody();
          if (!body.subject.trim()) { toast('Предмет', 'Укажите предмет КП', 'warn'); return; }
          btn.disabled = true; btn.textContent = '⏳…';
          try {
            var token = localStorage.getItem('asgard_token');
            var url = currentId ? '/api/tkp/' + currentId : '/api/tkp';
            var method = currentId ? 'PUT' : 'POST';
            var r = await fetch(url, {
              method: method,
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
              body: JSON.stringify(body)
            });
            if (!r.ok) { var e = await r.json().catch(function(){return{};}); throw new Error(e.error || 'HTTP ' + r.status); }
            var res = await r.json();
            currentId = (res.item && res.item.id) || currentId;
            toast('Готово', currentId ? ('Полное КП #' + currentId + ' сохранено') : 'Сохранено', 'ok');
            hideModal();
            if (typeof onSaved === 'function') onSaved(currentId);
          } catch (ex) {
            toast('Ошибка', ex.message, 'err');
            btn.disabled = false;
            btn.textContent = currentId ? 'Сохранить' : 'Создать полное КП';
          }
        });

        root.querySelector('#fullPreview').addEventListener('click', async function() {
          var body = buildBody();
          body.with_signature = true;
          body.with_stamp = true;
          try {
            var token = localStorage.getItem('asgard_token');
            var r = await fetch('/api/tkp/preview-pdf', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
              body: JSON.stringify(body)
            });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            var blob = await r.blob();
            var url = URL.createObjectURL(blob);
            window.open(url, '_blank');
          } catch (ex) { toast('Ошибка', ex.message, 'err'); }
        });

        function openPdf(sig, stamp) {
          if (!currentId) return toast('Сохраните', 'Сначала сохраните КП', 'warn');
          var token = localStorage.getItem('asgard_token');
          var url = '/api/tkp/' + currentId + '/pdf?token=' + token;
          if (sig) url += '&signature=1';
          if (stamp) url += '&stamp=1';
          window.open(url, '_blank');
        }
        var pdfNo = root.querySelector('#fullPdfNoStamp');
        var pdfYes = root.querySelector('#fullPdfStamp');
        var docxBtn = root.querySelector('#fullDocx');
        if (pdfNo) pdfNo.addEventListener('click', function(){ openPdf(true, false); });
        if (pdfYes) pdfYes.addEventListener('click', function(){ openPdf(true, true); });
        if (docxBtn) docxBtn.addEventListener('click', function() {
          if (!currentId) return;
          var token = localStorage.getItem('asgard_token');
          window.open('/api/tkp/' + currentId + '/docx?token=' + token, '_blank');
        });
      }
    });
  }

  return { open: openFullForm, openPolishSheet: openPolishSheet };
})();
