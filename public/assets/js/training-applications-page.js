// ASGARD CRM — Заявки на обучение
window.AsgardTrainingPage = (function() {
  let allItems = [], currentPage = 1, pageSize = window.AsgardPagination ? AsgardPagination.getPageSize() : 20;
  const { $, esc, toast, showModal, hideModal } = AsgardUI;

  const STATUS_MAP = {
    draft:            { label: 'Черновик',             color: 'var(--t2)' },
    pending_approval: { label: 'На согласовании',      color: 'var(--info)' },
    approved:         { label: 'Согласовано',           color: 'var(--ok-t)' },
    budget_approved:  { label: 'Бюджет утверждён',     color: 'var(--purple, #9333ea)' },
    paid:             { label: 'Оплачено',              color: 'var(--amber, #d97706)' },
    completed:        { label: 'Завершено',             color: 'var(--ok-t)' },
    rejected:         { label: 'Отклонено',             color: 'var(--err-t)' }
  };

  const TYPE_MAP = {
    external: 'Внешнее',
    internal: 'Внутреннее',
    conference: 'Конференция',
    certification: 'Сертификация',
    online: 'Онлайн-курс'
  };

  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('ru-RU');
  }

  // FIX: convert ISO date to YYYY-MM-DD for input[type=date]
  function isoToInput(d) {
    if (!d) return '';
    var s = String(d);
    if (s.length >= 10) return s.substring(0, 10);
    return s;
  }

  function fmtCost(c) {
    if (!c || c === '0' || c === '0.00' || Number(c) === 0) return '—';
    return Number(c).toLocaleString('ru-RU') + ' \u20BD';
  }

  function getRole() {
    try {
      var auth = window.AsgardAuth && AsgardAuth.getAuth ? (AsgardAuth.getAuth() || {}).user || null : null;
      if (auth) return auth.role || '';
      var token = localStorage.getItem('asgard_token');
      if (token) {
        var payload = JSON.parse(atob(token.split('.')[1]));
        return payload.role || '';
      }
    } catch(e) {}
    return '';
  }

  function getUserId() {
    try {
      var auth = window.AsgardAuth && AsgardAuth.getAuth ? (AsgardAuth.getAuth() || {}).user || null : null;
      if (auth) return auth.id;
      var token = localStorage.getItem('asgard_token');
      if (token) {
        var payload = JSON.parse(atob(token.split('.')[1]));
        return payload.id;
      }
    } catch(e) {}
    return null;
  }

  async function render({ layout, title }) {
    await layout('<div id="training-page"><div class="loading">Загрузка...</div></div>', { title: title || 'Обучение' });
    await loadList();
  }

  async function loadList() {
    var el = $('#training-page');
    if (!el) return;
    try {
      var token = localStorage.getItem('asgard_token');
      var resp = await fetch('/api/training-applications/', { headers: { Authorization: 'Bearer ' + token } });
      var data = await resp.json();
      var items = data.applications || [];
      allItems = items;
      var pagedItems = window.AsgardPagination ? AsgardPagination.paginate(items, currentPage, pageSize) : items;

      el.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">' +
          '<h3 style="margin:0">Заявки на обучение (' + items.length + ')</h3>' +
          '<button class="btn primary" id="btnAddTraining">+ Новая заявка</button>' +
        '</div>' +
        // FIX: добавляем стиль для обрезки длинного текста в таблице
        '<style>.train-tbl td.truncate{max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}</style>' +
        '<div class="tbl-wrap"><table class="data-table train-tbl">' +
          '<thead><tr>' +
            '<th>\u2116</th><th>Сотрудник</th><th>Курс / обучение</th><th>Тип</th><th>Даты</th><th>Стоимость</th><th>Статус</th><th>Создана</th><th></th>' +
          '</tr></thead>' +
          '<tbody>' + (pagedItems.length === 0
            ? '<tr><td colspan="9" style="text-align:center;color:var(--t3);padding:32px">Заявок пока нет</td></tr>'
            : pagedItems.map(function(i) {
              var st = STATUS_MAP[i.status] || STATUS_MAP.draft;
              return '<tr data-id="' + i.id + '" style="cursor:pointer">' +
                '<td>' + i.id + '</td>' +
                '<td>' + esc(i.user_name || '—') + '</td>' +
                '<td class="truncate" title="' + esc(i.course_name || '') + '">' + esc(i.course_name || '—') + '</td>' +
                '<td>' + (TYPE_MAP[i.training_type] || esc(i.training_type || '—')) + '</td>' +
                '<td style="white-space:nowrap">' + fmtDate(i.date_start) + ' — ' + fmtDate(i.date_end) + '</td>' +
                '<td style="white-space:nowrap">' + fmtCost(i.cost) + '</td>' +
                '<td><span style="color:' + st.color + ';font-weight:600">' + st.label + '</span></td>' +
                '<td style="white-space:nowrap">' + fmtDate(i.created_at) + '</td>' +
                '<td><button class="btn ghost mini" data-action="open" data-id="' + i.id + '" title="Открыть">\u270F\uFE0F</button></td>' +
              '</tr>';
            }).join('')) +
          '</tbody></table></div>';

      // Пагинация
      if (window.AsgardPagination) {
        var pgEl = document.getElementById('training_pagination');
        if (!pgEl) { pgEl = document.createElement('div'); pgEl.id = 'training_pagination'; el.appendChild(pgEl); }
        pgEl.innerHTML = AsgardPagination.renderControls(items.length, currentPage, pageSize);
        AsgardPagination.attachHandlers('training_pagination',
          function(p) { currentPage = p; loadList(); },
          function(s) { pageSize = s; currentPage = 1; loadList(); }
        );
      }

      var btnAdd = $('#btnAddTraining');
      if (btnAdd) btnAdd.addEventListener('click', function() { openForm(); });

      // FIX: клик по строке тоже открывает детали
      el.querySelectorAll('tr[data-id]').forEach(function(row) {
        row.addEventListener('click', function(e) {
          if (e.target.closest('button')) return;
          openDetail(row.dataset.id);
        });
      });

      el.querySelectorAll('[data-action="open"]').forEach(function(b) {
        b.addEventListener('click', function() { openDetail(b.dataset.id); });
      });
    } catch(e) {
      el.innerHTML = '<div class="err">Ошибка загрузки: ' + esc(e.message) + '</div>';
    }
  }

  function openForm(item) {
    item = item || {};
    var isEdit = !!item.id;
    // FIX: cost = '' для нового, чтобы placeholder работал
    var costVal = isEdit ? (item.cost || '') : '';
    var html =
      '<div class="formrow">' +
        '<div style="grid-column:1/-1"><label>Название курса / обучения *</label>' +
          '<input id="tfCourseName" name="name" value="' + esc(item.course_name || '') + '" placeholder="Название курса или программы обучения" />' +
        '</div>' +
      '</div>' +
      '<div class="formrow">' +
        '<div><label>Провайдер / организатор</label>' +
          '<input id="tfProvider" value="' + esc(item.provider || '') + '" placeholder="Учебный центр, платформа" />' +
        '</div>' +
        '<div><label>Тип обучения</label>' +
          '<div id="crw_tfType"></div>' +
        '</div>' +
      '</div>' +
      '<div class="formrow">' +
        '<div><label>Дата начала</label><input id="tfDateStart" type="date" value="' + isoToInput(item.date_start) + '" /></div>' +
        '<div><label>Дата окончания</label><input id="tfDateEnd" type="date" value="' + isoToInput(item.date_end) + '" /></div>' +
        // FIX: стоимость в одной строке с датами — не растягивается на всю ширину
        '<div><label>Стоимость (\u20BD)</label><input id="tfCost" type="number" step="0.01" min="0" value="' + costVal + '" placeholder="0" /></div>' +
      '</div>' +
      '<div class="formrow"><div style="grid-column:1/-1">' +
        '<label>Обоснование</label>' +
        '<textarea id="tfJustification" name="description" rows="3" placeholder="Зачем нужно обучение, как поможет в работе">' + esc(item.justification || '') + '</textarea>' +
      '</div></div>' +
      '<div class="formrow"><div style="grid-column:1/-1">' +
        '<label>Комментарий</label>' +
        '<textarea id="tfComment" name="comment" rows="2" placeholder="Дополнительная информация">' + esc(item.comment || '') + '</textarea>' +
      '</div></div>' +
      '<hr class="hr"/>' +
      '<div style="display:flex;gap:10px">' +
        '<button class="btn primary" id="btnSaveTraining" style="flex:1">' + (isEdit ? '\uD83D\uDCBE Сохранить' : '\u2795 Создать') + '</button>' +
      '</div>';

    showModal(isEdit ? 'Редактирование заявки #' + item.id : 'Новая заявка на обучение', html);

    $('#crw_tfType')?.appendChild(CRSelect.create({
      id: 'tfType', fullWidth: true, dropdownClass: 'z-modal',
      options: [
        { value: 'external', label: 'Внешнее' },
        { value: 'internal', label: 'Внутреннее' },
        { value: 'conference', label: 'Конференция' },
        { value: 'certification', label: 'Сертификация' },
        { value: 'online', label: 'Онлайн-курс' }
      ],
      value: item.training_type || 'external'
    }));

    var btnSave = $('#btnSaveTraining');
    if (btnSave) {
      btnSave.addEventListener('click', async function() {
        var courseName = ($('#tfCourseName') || {}).value;
        if (!courseName || !courseName.trim()) {
          toast('Ошибка', 'Укажите название курса', 'err');
          return;
        }
        var body = {
          course_name: courseName,
          provider: ($('#tfProvider') || {}).value || null,
          training_type: CRSelect.getValue('tfType') || 'external',
          date_start: ($('#tfDateStart') || {}).value || null,
          date_end: ($('#tfDateEnd') || {}).value || null,
          cost: parseFloat(($('#tfCost') || {}).value) || 0,
          justification: ($('#tfJustification') || {}).value || null,
          comment: ($('#tfComment') || {}).value || null
        };
        var token = localStorage.getItem('asgard_token');
        var url = isEdit ? '/api/training-applications/' + item.id : '/api/training-applications/';
        var method = isEdit ? 'PUT' : 'POST';
        try {
          var resp = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify(body)
          });
          if (resp.ok) {
            var result = await resp.json();
            toast('Готово', isEdit ? 'Заявка обновлена' : 'Заявка создана');
            hideModal();
            // FIX: после создания сразу открываем детали, чтобы была видна кнопка «Подать»
            if (!isEdit && result.item && result.item.id) {
              await loadList();
              openDetail(result.item.id);
            } else {
              loadList();
            }
          } else {
            var err = await resp.json();
            toast('Ошибка', err.error || 'Ошибка сохранения', 'err');
          }
        } catch(e) {
          toast('Ошибка', 'Ошибка сети: ' + e.message, 'err');
        }
      });
    }
  }

  async function openDetail(id) {
    var token = localStorage.getItem('asgard_token');
    try {
      var resp = await fetch('/api/training-applications/' + id, { headers: { Authorization: 'Bearer ' + token } });
      if (!resp.ok) { toast('Ошибка', 'Не удалось загрузить заявку', 'err'); return; }
      var data = await resp.json();
      var item = data.item;
      if (!item) { toast('Ошибка', 'Заявка не найдена', 'err'); return; }
    } catch(e) {
      toast('Ошибка', 'Ошибка сети: ' + e.message, 'err');
      return;
    }

    var st = STATUS_MAP[item.status] || STATUS_MAP.draft;
    var role = getRole();
    var userId = getUserId();
    var isAuthor = item.user_id === userId;
    var isAdmin = role === 'ADMIN';

    // История согласования
    var history = '<div style="margin-top:12px"><strong>История согласования:</strong>' +
      '<ul style="margin:6px 0;padding-left:20px;list-style:none">';
    history += '<li>\uD83D\uDCC4 Создана: ' + fmtDate(item.created_at) + '</li>';
    if (item.status !== 'draft') {
      history += '<li>\uD83D\uDCE8 Подана на согласование</li>';
    }
    if (item.approved_by_head) history += '<li>\u2705 Согласовано: ' + esc(item.head_name || '—') + ' (' + fmtDate(item.approved_by_head_at) + ')</li>';
    if (item.approved_by_dir) history += '<li>\uD83D\uDCB0 Бюджет утверждён: ' + esc(item.dir_name || '—') + ' (' + fmtDate(item.approved_by_dir_at) + ')</li>';
    if (item.paid_by_buh) history += '<li>\uD83D\uDCB3 Оплата подтверждена: ' + esc(item.buh_name || '—') + ' (' + fmtDate(item.paid_by_buh_at) + ')</li>';
    if (item.completed_by_hr) history += '<li>\uD83C\uDF93 Завершено: ' + esc(item.hr_name || '—') + ' (' + fmtDate(item.completed_by_hr_at) + ')</li>';
    if (item.rejected_by) history += '<li style="color:var(--err-t)">\u274C Отклонено: ' + esc(item.rejector_name || '—') + ' (' + fmtDate(item.rejected_at) + ')' + (item.reject_reason ? ' — ' + esc(item.reject_reason) : '') + '</li>';
    history += '</ul></div>';

    // Кнопки действий
    var actions = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">';

    if (item.status === 'draft' && (isAuthor || isAdmin)) {
      actions += '<button class="btn" id="btnEditTraining">\u270F\uFE0F Редактировать</button>';
      actions += '<button class="btn primary" id="btnSubmitTraining">\uD83D\uDCE8 Подать на согласование</button>';
    }
    if (item.status === 'pending_approval' && (isAdmin || ['HEAD_PM','HEAD_TO','DIRECTOR_COMM','DIRECTOR_GEN','DIRECTOR_DEV'].indexOf(role) >= 0)) {
      actions += '<button class="btn primary" id="btnApproveHead">\u2705 Согласовать</button>';
    }
    if (item.status === 'approved' && (isAdmin || role === 'DIRECTOR_GEN')) {
      actions += '<button class="btn primary" id="btnApproveBudget">\uD83D\uDCB0 Утвердить бюджет</button>';
    }
    if (item.status === 'budget_approved' && (isAdmin || role === 'BUH')) {
      actions += '<button class="btn primary" id="btnConfirmPayment">\uD83D\uDCB3 Подтвердить оплату</button>';
    }
    if (item.status === 'paid' && (isAdmin || role === 'HR' || role === 'HR_MANAGER')) {
      actions += '<button class="btn primary" id="btnMarkCompleted">\uD83C\uDF93 Завершить</button>';
    }
    // Кнопка отклонения
    var canReject = false;
    if (item.status === 'pending_approval' && (isAdmin || ['HEAD_PM','HEAD_TO','DIRECTOR_COMM','DIRECTOR_GEN','DIRECTOR_DEV'].indexOf(role) >= 0)) canReject = true;
    if (item.status === 'approved' && (isAdmin || role === 'DIRECTOR_GEN')) canReject = true;
    if (item.status === 'budget_approved' && (isAdmin || role === 'BUH')) canReject = true;
    if (canReject) {
      actions += '<button class="btn" id="btnRejectTraining" style="color:var(--err-t)">\u274C Отклонить</button>';
    }
    actions += '</div>';

    // FIX: обоснование и комментарий с word-break чтобы длинный текст не вылезал
    var wbStyle = 'word-break:break-word;overflow-wrap:break-word';
    var html =
      '<div style="' + wbStyle + '">' +
        '<div class="formrow">' +
          '<div><strong>Сотрудник:</strong> ' + esc(item.user_name || '—') + '</div>' +
          '<div><strong>Статус:</strong> <span style="color:' + st.color + ';font-weight:600">' + st.label + '</span></div>' +
        '</div>' +
        '<div class="formrow">' +
          '<div><strong>Курс:</strong> ' + esc(item.course_name || '—') + '</div>' +
          '<div><strong>Провайдер:</strong> ' + esc(item.provider || '—') + '</div>' +
        '</div>' +
        '<div class="formrow">' +
          '<div><strong>Тип:</strong> ' + (TYPE_MAP[item.training_type] || esc(item.training_type || '—')) + '</div>' +
          '<div><strong>Стоимость:</strong> ' + fmtCost(item.cost) + '</div>' +
        '</div>' +
        '<div class="formrow">' +
          '<div><strong>Период:</strong> ' + fmtDate(item.date_start) + ' — ' + fmtDate(item.date_end) + '</div>' +
        '</div>' +
        (item.justification ? '<div style="margin-top:8px"><strong>Обоснование:</strong><br/><span style="color:var(--t2)">' + esc(item.justification) + '</span></div>' : '') +
        (item.comment ? '<div style="margin-top:8px"><strong>Комментарий:</strong><br/><span style="color:var(--t2)">' + esc(item.comment) + '</span></div>' : '') +
        history +
        '<hr class="hr"/>' +
        actions +
      '</div>';

    showModal('Заявка на обучение #' + item.id, html);

    // Обработчики кнопок
    var btnEdit = $('#btnEditTraining');
    if (btnEdit) btnEdit.addEventListener('click', function() { hideModal(); openForm(item); });

    var btnSubmit = $('#btnSubmitTraining');
    if (btnSubmit) btnSubmit.addEventListener('click', function() { doAction(item.id, 'submit'); });

    var btnApproveH = $('#btnApproveHead');
    if (btnApproveH) btnApproveH.addEventListener('click', function() { doAction(item.id, 'approve_head'); });

    var btnApproveB = $('#btnApproveBudget');
    if (btnApproveB) btnApproveB.addEventListener('click', function() { doAction(item.id, 'approve_budget'); });

    var btnPay = $('#btnConfirmPayment');
    if (btnPay) btnPay.addEventListener('click', function() { doAction(item.id, 'confirm_payment'); });

    var btnComplete = $('#btnMarkCompleted');
    if (btnComplete) btnComplete.addEventListener('click', function() { doAction(item.id, 'mark_completed'); });

    var btnReject = $('#btnRejectTraining');
    if (btnReject) btnReject.addEventListener('click', function() {
      var reason = prompt('Причина отклонения:');
      if (reason !== null) doAction(item.id, 'reject', reason);
    });
  }

  async function doAction(id, action, reject_reason) {
    var token = localStorage.getItem('asgard_token');
    var body = { action: action };
    if (reject_reason) body.reject_reason = reject_reason;
    try {
      var resp = await fetch('/api/training-applications/' + id + '/status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(body)
      });
      if (resp.ok) {
        toast('Готово', 'Статус обновлён');
        hideModal();
        await loadList();
      } else {
        var err = await resp.json();
        toast('Ошибка', err.error || 'Ошибка', 'err');
      }
    } catch(e) {
      toast('Ошибка', 'Ошибка сети: ' + e.message, 'err');
    }
  }

  return { render: render };
})();
