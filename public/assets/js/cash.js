/**
 * ASGARD CRM — Касса (страница РП)
 * Авансовые отчёты и расчёты
 * Redesigned to use ASGARD Design System
 */

window.CashPage = (function() {
  'use strict';

  const { showModal, hideModal, toast, esc } = AsgardUI;

  const STATUS_LABELS = {
    requested: 'Ожидает согласования',
    approved: 'Согласовано',
    received: 'Получено',
    reporting: 'Отчёт',
    closed: 'Закрыто',
    rejected: 'Отклонено',
    question: 'Вопрос директора'
  };

  const STATUS_COLORS = {
    requested: 'warning',
    approved: 'success',
    received: 'info',
    reporting: 'info',
    closed: 'secondary',
    rejected: 'danger',
    question: 'warning'
  };

  const TYPE_LABELS = {
    advance: 'Аванс на проект',
    loan: 'Долг до ЗП'
  };

  const TYPE_COLORS = {
    advance: 'info',
    loan: 'warning'
  };

  let currentRequests = [];
  let works = [];

  // ─────────────────────────────────────────────────────────────────
  // RENDER PAGE
  // ─────────────────────────────────────────────────────────────────
  async function render(container) {
    container.innerHTML = `
      <div class="page-header">
        <h1>Касса</h1>
        <p style="color:var(--text-muted); font-size:var(--text-sm); margin:0">Авансовые отчёты и расчёты</p>
      </div>

      <div id="cash-balance-widget"></div>

      <div class="cash-card">
        <div class="cash-card-header">
          <span class="card-title">Мои заявки</span>
          <button class="btn primary" onclick="CashPage.showCreateModal()">+ Новая заявка</button>
        </div>
        <div class="cash-card-body">
          <div id="cash-requests-list">
            <div style="text-align:center; padding:24px; color:var(--text-muted)">Загрузка...</div>
          </div>
        </div>
      </div>
    `;

    await loadBalance();
    await loadWorks();
    await loadRequests();
  }

  // ─────────────────────────────────────────────────────────────────
  // API
  // ─────────────────────────────────────────────────────────────────
  function getHeaders() {
    const auth = AsgardAuth.getAuth();
    return {
      'Authorization': 'Bearer ' + (auth?.token || ''),
      'Content-Type': 'application/json'
    };
  }

  async function loadBalance() {
    try {
      const resp = await fetch('/api/cash/my-balance', { headers: getHeaders() });
      if (!resp.ok) return;
      const data = await resp.json();
      const widget = document.getElementById('cash-balance-widget');
      if (!widget) return;

      widget.innerHTML = `
        <div class="cash-balance-grid">
          <div class="cash-balance-card info">
            <div class="balance-value">${formatMoney(data.issued)}</div>
            <div class="balance-label">Получено</div>
          </div>
          <div class="cash-balance-card warning">
            <div class="balance-value">${formatMoney(data.spent)}</div>
            <div class="balance-label">Потрачено</div>
          </div>
          <div class="cash-balance-card success">
            <div class="balance-value">${formatMoney(data.returned)}</div>
            <div class="balance-label">Возвращено</div>
          </div>
          <div class="cash-balance-card ${data.balance > 0 ? 'danger' : 'secondary'}">
            <div class="balance-value">${formatMoney(data.balance)}</div>
            <div class="balance-label">На руках</div>
          </div>
        </div>
      `;
    } catch (e) {
      console.error('loadBalance error', e);
    }
  }

  async function loadWorks() {
    try {
      const resp = await fetch('/api/works?limit=500', { headers: getHeaders() });
      const data = await resp.json();
      works = data.works || data || [];
    } catch (e) {
      console.error('loadWorks error', e);
    }
  }

  async function loadRequests() {
    try {
      const resp = await fetch('/api/cash/my', { headers: getHeaders() });
      currentRequests = await resp.json();
      renderRequestsList();
    } catch (e) {
      console.error('loadRequests error', e);
      document.getElementById('cash-requests-list').innerHTML =
        '<div style="text-align:center; padding:24px; color:var(--danger)">Ошибка загрузки</div>';
    }
  }

  function renderRequestsList() {
    const container = document.getElementById('cash-requests-list');

    if (!currentRequests.length) {
      container.innerHTML = AsgardUI.emptyState({ icon: '💰', title: 'Нет заявок', desc: 'Создайте первую заявку на аванс' });
      return;
    }

    container.innerHTML = `
      <div style="overflow-x:auto">
        <table class="tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>Тип</th>
              <th>Проект</th>
              <th>Сумма</th>
              <th>Статус</th>
              <th>Баланс</th>
              <th>Дата</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${currentRequests.map(r => {
              const isLoan = r.type === 'loan';
              const balanceVal = r.balance ? r.balance.remainder : 0;
              const balanceDisplay = isLoan && balanceVal > 0 ? `-${formatMoney(balanceVal)}` : formatMoney(balanceVal);
              const balanceColor = isLoan ? (balanceVal > 0 ? 'var(--danger)' : 'var(--success)') : (balanceVal > 0 ? 'var(--warning)' : 'var(--success)');

              return `
              <tr onclick="CashPage.showDetail(${r.id})" style="cursor:pointer">
                <td>${r.id}</td>
                <td><span class="status status-${TYPE_COLORS[r.type] === 'info' ? 'blue' : 'yellow'}">${esc(TYPE_LABELS[r.type] || r.type)}</span></td>
                <td>${esc(r.work_title || (r.work_id ? '#' + r.work_id : (isLoan ? 'Личные' : '-')))}</td>
                <td><strong>${formatMoney(r.amount)}</strong></td>
                <td><span class="status status-${statusCssClass(r.status)}">${esc(STATUS_LABELS[r.status])}</span></td>
                <td><span style="color:${balanceColor};font-weight:600">${r.balance ? balanceDisplay : '-'}</span></td>
                <td>${formatDate(r.created_at)}</td>
                <td>
                  <button class="btn ghost mini" onclick="event.stopPropagation(); CashPage.showDetail(${r.id})">Открыть</button>
                </td>
              </tr>
            `;}).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function statusCssClass(status) {
    const map = { requested: 'yellow', approved: 'green', received: 'blue', reporting: 'blue', closed: 'gray', rejected: 'red', question: 'yellow' };
    return map[status] || 'gray';
  }

  // ─────────────────────────────────────────────────────────────────
  // CREATE REQUEST
  // ─────────────────────────────────────────────────────────────────
  function showCreateModal() {
    const worksOptions = '<option value="">-- Выберите проект --</option>' +
      works.map(w => `<option value="${w.id}">${esc(w.work_title || 'Проект #' + w.id)}</option>`).join('');

    showModal({
      title: 'Новая заявка на выдачу',
      html: `
        <form id="cashCreateForm">
          <div class="asg-form-group">
            <label>Тип</label>
            <select name="type" id="cashType" onchange="CashPage.onTypeChange()">
              <option value="advance">Аванс на проект</option>
              <option value="loan">Личный долг до ЗП</option>
            </select>
          </div>
          <div class="asg-form-group" id="cashWorkGroup">
            <label>Проект</label>
            <select name="work_id" id="cashWorkId">${worksOptions}</select>
          </div>
          <div class="asg-form-group">
            <label>Сумма</label>
            <input type="number" name="amount" step="0.01" min="1" required placeholder="0.00">
          </div>
          <div class="asg-form-group">
            <label>Цель / обоснование</label>
            <textarea name="purpose" rows="2" required placeholder="Укажите цель"></textarea>
          </div>
          <div class="asg-form-group">
            <label>Сопроводительное письмо (опционально)</label>
            <textarea name="cover_letter" rows="3" placeholder="Дополнительная информация"></textarea>
          </div>
          <div class="asg-form-actions">
            <button type="button" class="btn ghost" onclick="AsgardUI.hideModal()">Отмена</button>
            <button type="button" class="btn primary" onclick="CashPage.submitCreate()">Создать</button>
          </div>
        </form>
      `
    });
  }

  function onTypeChange() {
    const typeEl = document.getElementById('cashType');
    const workGroup = document.getElementById('cashWorkGroup');
    if (typeEl && workGroup) {
      workGroup.style.display = typeEl.value === 'advance' ? 'block' : 'none';
    }
  }

  async function submitCreate() {
    const form = document.getElementById('cashCreateForm');
    if (!form) return;
    const data = Object.fromEntries(new FormData(form));

    if (data.type === 'advance' && !data.work_id) {
      toast('Выберите проект', '', 'warn');
      return;
    }

    try {
      const resp = await fetch('/api/cash', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          type: data.type,
          work_id: data.work_id ? parseInt(data.work_id) : null,
          amount: parseFloat(data.amount),
          purpose: data.purpose,
          cover_letter: data.cover_letter || null
        })
      });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Ошибка');
      }

      hideModal();
      toast('Заявка создана', '', 'ok');
      await loadBalance();
      await loadRequests();
    } catch (e) {
      toast('Ошибка', e.message, 'err');
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // DETAIL
  // ─────────────────────────────────────────────────────────────────
  async function showDetail(id) {
    showModal({
      title: 'Заявка #' + id,
      html: '<div style="text-align:center; padding:24px; color:var(--text-muted)">Загрузка...</div>'
    });

    try {
      const resp = await fetch('/api/cash/' + id, { headers: getHeaders() });
      if (!resp.ok) throw new Error('Ошибка загрузки');
      const req = await resp.json();
      const body = document.getElementById('modalBody');
      if (body) body.innerHTML = renderDetail(req);
    } catch (e) {
      const body = document.getElementById('modalBody');
      if (body) body.innerHTML = `<div style="text-align:center; padding:24px; color:var(--danger)">${esc(e.message)}</div>`;
    }
  }

  function renderDetail(req) {
    const isLoan = req.type === 'loan';
    const canReceive = req.status === 'approved';
    const canAddExpense = !isLoan && ['received', 'reporting'].includes(req.status);
    const canReturn = ['received', 'reporting'].includes(req.status) && req.balance?.remainder > 0;
    const canReply = req.status === 'question';

    const balanceVal = req.balance?.remainder || 0;
    const balanceDisplay = isLoan && balanceVal > 0 ? `-${formatMoney(balanceVal)}` : formatMoney(balanceVal);
    const balanceLabel = isLoan ? 'Долг' : 'Остаток';

    let html = `
      <div class="cash-detail-grid">
        <div>
          <div class="cash-detail-item"><span class="label">Тип</span><span class="value"><span class="status status-${TYPE_COLORS[req.type] === 'info' ? 'blue' : 'yellow'}">${esc(TYPE_LABELS[req.type] || req.type)}</span></span></div>
          <div class="cash-detail-item" style="margin-top:12px"><span class="label">Проект</span><span class="value">${esc(req.work_title || (req.work_id ? '#' + req.work_id : (isLoan ? 'Личные средства' : '-')))}</span></div>
          <div class="cash-detail-item" style="margin-top:12px"><span class="label">Сумма</span><span class="value" style="font-size:var(--text-lg);color:var(--gold)">${formatMoney(req.amount)}</span></div>
          <div class="cash-detail-item" style="margin-top:12px"><span class="label">Цель</span><span class="value">${esc(req.purpose)}</span></div>
          ${req.cover_letter ? `<div class="cash-detail-item" style="margin-top:12px"><span class="label">Письмо</span><span class="value">${esc(req.cover_letter)}</span></div>` : ''}
        </div>
        <div>
          <div class="cash-detail-item"><span class="label">Статус</span><span class="value"><span class="status status-${statusCssClass(req.status)}">${esc(STATUS_LABELS[req.status])}</span></span></div>
          <div class="cash-detail-item" style="margin-top:12px"><span class="label">Создано</span><span class="value">${formatDateTime(req.created_at)}</span></div>
          ${req.director_name ? `<div class="cash-detail-item" style="margin-top:12px"><span class="label">Директор</span><span class="value">${esc(req.director_name)}</span></div>` : ''}
          ${req.director_comment ? `<div class="cash-detail-item" style="margin-top:12px"><span class="label">Комментарий</span><span class="value">${esc(req.director_comment)}</span></div>` : ''}
          ${req.received_at ? `<div class="cash-detail-item" style="margin-top:12px"><span class="label">Получено</span><span class="value">${formatDateTime(req.received_at)}</span></div>` : ''}
          ${req.closed_at ? `<div class="cash-detail-item" style="margin-top:12px"><span class="label">Закрыто</span><span class="value">${formatDateTime(req.closed_at)}</span></div>` : ''}
        </div>
      </div>
    `;

    // Balance alert
    if (req.balance) {
      const alertType = req.balance.remainder > 0 ? (isLoan ? 'danger' : 'warning') : 'success';
      html += `<div class="cash-alert ${alertType}">`;
      if (isLoan) {
        html += `<strong>Долг:</strong> Получено: ${formatMoney(req.balance.approved)} | Возвращено: ${formatMoney(req.balance.returned)} | <strong>${balanceLabel}: ${balanceDisplay}</strong>${balanceVal > 0 ? ' (будет удержан из ЗП)' : ' (погашен)'}`;
      } else {
        html += `<strong>Баланс:</strong> Выдано: ${formatMoney(req.balance.approved)} | Потрачено: ${formatMoney(req.balance.spent)} | Возвращено: ${formatMoney(req.balance.returned)} | <strong>${balanceLabel}: ${balanceDisplay}</strong>`;
      }
      html += '</div>';
    }

    if (isLoan) {
      html += `<div class="cash-alert info"><strong>Долг до ЗП</strong> — личные деньги без авансового отчёта. Необходим полный возврат (из ЗП или наличными).</div>`;
    }

    // Actions
    const actions = [];
    if (canReceive) actions.push(`<button class="btn green" onclick="CashPage.confirmReceive(${req.id})">Подтвердить получение</button>`);
    if (canAddExpense) actions.push(`<button class="btn primary" onclick="CashPage.showExpenseModal(${req.id})">Добавить расход</button>`);
    if (canReturn) actions.push(`<button class="btn ${isLoan ? 'red' : 'amber'}" onclick="CashPage.showReturnModal(${req.id}, ${req.balance?.remainder || 0})">${isLoan ? 'Погасить долг' : 'Вернуть остаток'}</button>`);
    if (canReply) actions.push(`<button class="btn blue" onclick="CashPage.showReplyModal(${req.id})">Ответить</button>`);

    if (actions.length) {
      html += `<div class="cash-actions">${actions.join('')}</div>`;
    }

    // Expenses
    if (!isLoan && req.expenses?.length) {
      html += `<div class="cash-section-title">Расходы (авансовый отчёт)</div>
        <div style="overflow-x:auto; margin-bottom:16px">
          <table class="tbl">
            <thead><tr><th>Дата</th><th>Описание</th><th>Сумма</th><th>Чек</th>${canAddExpense ? '<th></th>' : ''}</tr></thead>
            <tbody>
              ${req.expenses.map(e => `
                <tr>
                  <td>${formatDate(e.expense_date)}</td>
                  <td>${esc(e.description)}</td>
                  <td>${formatMoney(e.amount)}</td>
                  <td>${e.receipt_file ? `<a href="/api/cash/${req.id}/receipt/${e.receipt_file}" target="_blank" style="color:var(--gold)">${esc(e.receipt_original_name || 'Чек')}</a>` : '-'}</td>
                  ${canAddExpense ? `<td><button class="btn red mini" onclick="CashPage.deleteExpense(${req.id}, ${e.id})">Удалить</button></td>` : ''}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>`;
    }

    // Returns
    if (req.returns?.length) {
      html += `<div class="cash-section-title">Возвраты</div>
        <div style="overflow-x:auto; margin-bottom:16px">
          <table class="tbl">
            <thead><tr><th>Дата</th><th>Сумма</th><th>Комментарий</th><th>Подтверждено</th></tr></thead>
            <tbody>
              ${req.returns.map(r => `
                <tr>
                  <td>${formatDateTime(r.created_at)}</td>
                  <td>${formatMoney(r.amount)}</td>
                  <td>${esc(r.note || '-')}</td>
                  <td>${r.confirmed_at ? `${formatDateTime(r.confirmed_at)} (${esc(r.confirmed_by_name || '')})` : '<span class="status status-yellow">Ожидает</span>'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>`;
    }

    // Messages
    if (req.messages?.length) {
      html += `<div class="cash-section-title">Переписка</div>
        <div class="cash-messages">
          ${req.messages.map(m => `
            <div class="cash-message">
              <div class="meta">${formatDateTime(m.created_at)} — ${esc(m.user_name)} (${esc(m.user_role)})</div>
              <div class="text">${esc(m.message)}</div>
            </div>
          `).join('')}
        </div>`;
    }

    return html;
  }

  // ─────────────────────────────────────────────────────────────────
  // ACTIONS
  // ─────────────────────────────────────────────────────────────────
  async function confirmReceive(id) {
    if (!confirm('Подтвердить получение денег?')) return;

    try {
      const resp = await fetch(`/api/cash/${id}/receive`, {
        method: 'PUT',
        headers: getHeaders()
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Ошибка');
      }
      toast('Получение подтверждено', '', 'ok');
      await showDetail(id);
      await loadBalance();
      await loadRequests();
    } catch (e) {
      toast('Ошибка', e.message, 'err');
    }
  }

  function showExpenseModal(requestId) {
    hideModal();
    setTimeout(() => {
      showModal({
        title: 'Добавить расход',
        html: `
          <form id="cashExpenseForm">
            <input type="hidden" name="request_id" value="${requestId}">
            <div class="asg-form-group">
              <label>Сумма</label>
              <input type="number" name="amount" step="0.01" min="0.01" required placeholder="0.00">
            </div>
            <div class="asg-form-group">
              <label>За что потрачено</label>
              <input type="text" name="description" required placeholder="Описание расхода">
            </div>
            <div class="asg-form-group">
              <label>Дата расхода</label>
              <input type="date" name="expense_date" value="${new Date().toISOString().split('T')[0]}">
            </div>
            <div class="asg-form-group">
              <label>Фото чека</label>
              <input type="file" name="receipt" accept="image/*,.pdf" required>
            </div>
            <div class="asg-form-actions">
              <button type="button" class="btn ghost" onclick="AsgardUI.hideModal()">Отмена</button>
              <button type="button" class="btn primary" onclick="CashPage.submitExpense()">Добавить</button>
            </div>
          </form>
        `
      });
    }, 100);
  }

  async function submitExpense() {
    const form = document.getElementById('cashExpenseForm');
    if (!form) return;
    const requestId = form.querySelector('[name="request_id"]').value;
    const formData = new FormData(form);
    formData.delete('request_id');

    const auth = AsgardAuth.getAuth();

    try {
      const resp = await fetch(`/api/cash/${requestId}/expense`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + (auth?.token || '') },
        body: formData
      });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Ошибка');
      }

      hideModal();
      toast('Расход добавлен', '', 'ok');
      await showDetail(parseInt(requestId));
      await loadBalance();
      await loadRequests();
    } catch (e) {
      toast('Ошибка', e.message, 'err');
    }
  }

  async function deleteExpense(requestId, expenseId) {
    if (!confirm('Удалить расход?')) return;

    try {
      const resp = await fetch(`/api/cash/${requestId}/expense/${expenseId}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Ошибка');
      }
      toast('Расход удалён', '', 'ok');
      await showDetail(requestId);
      await loadBalance();
      await loadRequests();
    } catch (e) {
      toast('Ошибка', e.message, 'err');
    }
  }

  function showReturnModal(requestId, remainder) {
    hideModal();
    setTimeout(() => {
      showModal({
        title: 'Вернуть остаток',
        html: `
          <form id="cashReturnForm">
            <input type="hidden" name="request_id" value="${requestId}">
            <div class="cash-alert info" style="margin-bottom:16px">
              Остаток: <strong>${formatMoney(remainder)}</strong>
            </div>
            <div class="asg-form-group">
              <label>Сумма возврата</label>
              <input type="number" name="amount" step="0.01" min="0.01" max="${remainder}" value="${remainder}" required>
            </div>
            <div class="asg-form-group">
              <label>Комментарий</label>
              <input type="text" name="note" placeholder="Необязательно">
            </div>
            <div class="asg-form-actions">
              <button type="button" class="btn ghost" onclick="AsgardUI.hideModal()">Отмена</button>
              <button type="button" class="btn green" onclick="CashPage.submitReturn()">Вернуть</button>
            </div>
          </form>
        `
      });
    }, 100);
  }

  async function submitReturn() {
    const form = document.getElementById('cashReturnForm');
    if (!form) return;
    const requestId = form.querySelector('[name="request_id"]').value;
    const data = Object.fromEntries(new FormData(form));

    try {
      const resp = await fetch(`/api/cash/${requestId}/return`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          amount: parseFloat(data.amount),
          note: data.note || null
        })
      });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Ошибка');
      }

      hideModal();
      toast('Возврат зарегистрирован', '', 'ok');
      await showDetail(parseInt(requestId));
      await loadBalance();
      await loadRequests();
    } catch (e) {
      toast('Ошибка', e.message, 'err');
    }
  }

  function showReplyModal(requestId) {
    hideModal();
    setTimeout(() => {
      showModal({
        title: 'Ответить на вопрос',
        html: `
          <form id="cashReplyForm">
            <input type="hidden" name="request_id" value="${requestId}">
            <div class="asg-form-group">
              <label>Ваш ответ</label>
              <textarea name="message" rows="3" required placeholder="Введите ответ"></textarea>
            </div>
            <div class="asg-form-actions">
              <button type="button" class="btn ghost" onclick="AsgardUI.hideModal()">Отмена</button>
              <button type="button" class="btn primary" onclick="CashPage.submitReply()">Отправить</button>
            </div>
          </form>
        `
      });
    }, 100);
  }

  async function submitReply() {
    const form = document.getElementById('cashReplyForm');
    if (!form) return;
    const requestId = form.querySelector('[name="request_id"]').value;
    const data = Object.fromEntries(new FormData(form));

    try {
      const resp = await fetch(`/api/cash/${requestId}/reply`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ message: data.message })
      });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Ошибка');
      }

      hideModal();
      toast('Ответ отправлен', '', 'ok');
      await showDetail(parseInt(requestId));
      await loadRequests();
    } catch (e) {
      toast('Ошибка', e.message, 'err');
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────
  function formatMoney(val) {
    const num = parseFloat(val) || 0;
    return num.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' \u20BD';
  }

  function formatDate(val) {
    if (!val) return '-';
    return new Date(val).toLocaleDateString('ru-RU');
  }

  function formatDateTime(val) {
    if (!val) return '-';
    return new Date(val).toLocaleString('ru-RU');
  }

  // ─────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────
  return {
    render,
    showCreateModal,
    onTypeChange,
    submitCreate,
    showDetail,
    confirmReceive,
    showExpenseModal,
    submitExpense,
    deleteExpense,
    showReturnModal,
    submitReturn,
    showReplyModal,
    submitReply
  };
})();
