/**
 * ASGARD CRM — Касса (страница РП)
 * Авансовые отчёты и расчёты
 */

window.CashPage = (function() {
  'use strict';

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
    loan: 'Личный долг до ЗП'
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
        <p class="text-muted">Авансовые отчёты и расчёты</p>
      </div>

      <div id="cash-balance-widget" class="mb-4"></div>

      <div class="card mb-4">
        <div class="card-header d-flex justify-content-between align-items-center">
          <span>Мои заявки</span>
          <button class="btn btn-primary btn-sm" onclick="CashPage.showCreateModal()">
            + Новая заявка
          </button>
        </div>
        <div class="card-body p-0">
          <div id="cash-requests-list">
            <div class="text-center p-4"><div class="spinner-border"></div></div>
          </div>
        </div>
      </div>

      <!-- Create Modal -->
      <div class="modal fade" id="cashCreateModal" tabindex="-1">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Новая заявка на выдачу</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <form id="cashCreateForm">
                <div class="mb-3">
                  <label class="form-label">Тип</label>
                  <select class="form-select" name="type" id="cashType" onchange="CashPage.onTypeChange()">
                    <option value="advance">Аванс на проект</option>
                    <option value="loan">Личный долг до ЗП</option>
                  </select>
                </div>
                <div class="mb-3" id="cashWorkGroup">
                  <label class="form-label">Проект</label>
                  <select class="form-select" name="work_id" id="cashWorkId">
                    <option value="">Загрузка...</option>
                  </select>
                </div>
                <div class="mb-3">
                  <label class="form-label">Сумма</label>
                  <input type="number" class="form-control" name="amount" step="0.01" min="1" required>
                </div>
                <div class="mb-3">
                  <label class="form-label">Цель / обоснование</label>
                  <textarea class="form-control" name="purpose" rows="2" required></textarea>
                </div>
                <div class="mb-3">
                  <label class="form-label">Сопроводительное письмо (опционально)</label>
                  <textarea class="form-control" name="cover_letter" rows="3"></textarea>
                </div>
              </form>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Отмена</button>
              <button type="button" class="btn btn-primary" onclick="CashPage.submitCreate()">Создать</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Detail Modal -->
      <div class="modal fade" id="cashDetailModal" tabindex="-1">
        <div class="modal-dialog modal-lg">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Заявка #<span id="cashDetailId"></span></h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body" id="cashDetailBody">
              <div class="text-center p-4"><div class="spinner-border"></div></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Expense Modal -->
      <div class="modal fade" id="cashExpenseModal" tabindex="-1">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Добавить расход</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <form id="cashExpenseForm">
                <input type="hidden" name="request_id" id="expenseRequestId">
                <div class="mb-3">
                  <label class="form-label">Сумма</label>
                  <input type="number" class="form-control" name="amount" step="0.01" min="0.01" required>
                </div>
                <div class="mb-3">
                  <label class="form-label">За что потрачено</label>
                  <input type="text" class="form-control" name="description" required>
                </div>
                <div class="mb-3">
                  <label class="form-label">Дата расхода</label>
                  <input type="date" class="form-control" name="expense_date">
                </div>
                <div class="mb-3">
                  <label class="form-label">Фото чека</label>
                  <input type="file" class="form-control" name="receipt" accept="image/*,.pdf" required>
                </div>
              </form>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Отмена</button>
              <button type="button" class="btn btn-primary" onclick="CashPage.submitExpense()">Добавить</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Return Modal -->
      <div class="modal fade" id="cashReturnModal" tabindex="-1">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Вернуть остаток</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <form id="cashReturnForm">
                <input type="hidden" name="request_id" id="returnRequestId">
                <div class="alert alert-info">
                  Остаток: <strong id="returnRemainder">0</strong> руб.
                </div>
                <div class="mb-3">
                  <label class="form-label">Сумма возврата</label>
                  <input type="number" class="form-control" name="amount" step="0.01" min="0.01" required>
                </div>
                <div class="mb-3">
                  <label class="form-label">Комментарий</label>
                  <input type="text" class="form-control" name="note">
                </div>
              </form>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Отмена</button>
              <button type="button" class="btn btn-success" onclick="CashPage.submitReturn()">Вернуть</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Reply Modal -->
      <div class="modal fade" id="cashReplyModal" tabindex="-1">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Ответить на вопрос</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <form id="cashReplyForm">
                <input type="hidden" name="request_id" id="replyRequestId">
                <div class="mb-3">
                  <label class="form-label">Ваш ответ</label>
                  <textarea class="form-control" name="message" rows="3" required></textarea>
                </div>
              </form>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Отмена</button>
              <button type="button" class="btn btn-primary" onclick="CashPage.submitReply()">Отправить</button>
            </div>
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
      const data = await resp.json();

      document.getElementById('cash-balance-widget').innerHTML = `
        <div class="row g-3">
          <div class="col-md-3">
            <div class="card bg-info text-white">
              <div class="card-body text-center">
                <h4>${formatMoney(data.issued)}</h4>
                <small>Получено</small>
              </div>
            </div>
          </div>
          <div class="col-md-3">
            <div class="card bg-warning text-dark">
              <div class="card-body text-center">
                <h4>${formatMoney(data.spent)}</h4>
                <small>Потрачено</small>
              </div>
            </div>
          </div>
          <div class="col-md-3">
            <div class="card bg-success text-white">
              <div class="card-body text-center">
                <h4>${formatMoney(data.returned)}</h4>
                <small>Возвращено</small>
              </div>
            </div>
          </div>
          <div class="col-md-3">
            <div class="card ${data.balance > 0 ? 'bg-danger text-white' : 'bg-secondary text-white'}">
              <div class="card-body text-center">
                <h4>${formatMoney(data.balance)}</h4>
                <small>На руках</small>
              </div>
            </div>
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

      const select = document.getElementById('cashWorkId');
      if (select) {
        select.innerHTML = '<option value="">-- Выберите проект --</option>' +
          works.map(w => `<option value="${w.id}">${w.title || w.object || 'Проект #' + w.id}</option>`).join('');
      }
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
      document.getElementById('cash-requests-list').innerHTML = '<div class="text-center text-danger p-4">Ошибка загрузки</div>';
    }
  }

  function renderRequestsList() {
    const container = document.getElementById('cash-requests-list');

    if (!currentRequests.length) {
      container.innerHTML = '<div class="text-center text-muted p-4">Нет заявок</div>';
      return;
    }

    container.innerHTML = `
      <div class="table-responsive">
        <table class="table table-hover mb-0">
          <thead>
            <tr>
              <th>#</th>
              <th>Тип</th>
              <th>Проект</th>
              <th>Сумма</th>
              <th>Статус</th>
              <th>Остаток</th>
              <th>Дата</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${currentRequests.map(r => `
              <tr>
                <td>${r.id}</td>
                <td>${TYPE_LABELS[r.type] || r.type}</td>
                <td>${r.work_title || r.work_object || (r.work_id ? '#' + r.work_id : '-')}</td>
                <td><strong>${formatMoney(r.amount)}</strong></td>
                <td><span class="badge bg-${STATUS_COLORS[r.status]}">${STATUS_LABELS[r.status]}</span></td>
                <td>${r.balance ? formatMoney(r.balance.remainder) : '-'}</td>
                <td>${formatDate(r.created_at)}</td>
                <td>
                  <button class="btn btn-sm btn-outline-primary" onclick="CashPage.showDetail(${r.id})">
                    Открыть
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // ─────────────────────────────────────────────────────────────────
  // CREATE REQUEST
  // ─────────────────────────────────────────────────────────────────
  function showCreateModal() {
    document.getElementById('cashCreateForm').reset();
    onTypeChange();
    new bootstrap.Modal(document.getElementById('cashCreateModal')).show();
  }

  function onTypeChange() {
    const type = document.getElementById('cashType').value;
    document.getElementById('cashWorkGroup').style.display = type === 'advance' ? 'block' : 'none';
  }

  async function submitCreate() {
    const form = document.getElementById('cashCreateForm');
    const data = Object.fromEntries(new FormData(form));

    if (data.type === 'advance' && !data.work_id) {
      AsgardUI.toast('Выберите проект', 'warning');
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

      bootstrap.Modal.getInstance(document.getElementById('cashCreateModal')).hide();
      AsgardUI.toast('Заявка создана', 'success');
      await loadBalance();
      await loadRequests();
    } catch (e) {
      AsgardUI.toast(e.message, 'danger');
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // DETAIL
  // ─────────────────────────────────────────────────────────────────
  async function showDetail(id) {
    document.getElementById('cashDetailId').textContent = id;
    document.getElementById('cashDetailBody').innerHTML = '<div class="text-center p-4"><div class="spinner-border"></div></div>';
    new bootstrap.Modal(document.getElementById('cashDetailModal')).show();

    try {
      const resp = await fetch('/api/cash/' + id, { headers: getHeaders() });
      if (!resp.ok) throw new Error('Ошибка загрузки');
      const req = await resp.json();
      renderDetail(req);
    } catch (e) {
      document.getElementById('cashDetailBody').innerHTML = '<div class="text-center text-danger p-4">' + e.message + '</div>';
    }
  }

  function renderDetail(req) {
    const canReceive = req.status === 'approved';
    const canAddExpense = ['received', 'reporting'].includes(req.status);
    const canReturn = ['received', 'reporting'].includes(req.status) && req.balance?.remainder > 0;
    const canReply = req.status === 'question';

    let html = `
      <div class="row mb-3">
        <div class="col-md-6">
          <p><strong>Тип:</strong> ${TYPE_LABELS[req.type] || req.type}</p>
          <p><strong>Проект:</strong> ${req.work_title || req.work_object || (req.work_id ? '#' + req.work_id : '-')}</p>
          <p><strong>Сумма:</strong> ${formatMoney(req.amount)}</p>
          <p><strong>Цель:</strong> ${escapeHtml(req.purpose)}</p>
          ${req.cover_letter ? `<p><strong>Письмо:</strong> ${escapeHtml(req.cover_letter)}</p>` : ''}
        </div>
        <div class="col-md-6">
          <p><strong>Статус:</strong> <span class="badge bg-${STATUS_COLORS[req.status]}">${STATUS_LABELS[req.status]}</span></p>
          <p><strong>Создано:</strong> ${formatDateTime(req.created_at)}</p>
          ${req.director_name ? `<p><strong>Директор:</strong> ${escapeHtml(req.director_name)}</p>` : ''}
          ${req.director_comment ? `<p><strong>Комментарий:</strong> ${escapeHtml(req.director_comment)}</p>` : ''}
          ${req.received_at ? `<p><strong>Получено:</strong> ${formatDateTime(req.received_at)}</p>` : ''}
          ${req.closed_at ? `<p><strong>Закрыто:</strong> ${formatDateTime(req.closed_at)}</p>` : ''}
        </div>
      </div>

      ${req.balance ? `
        <div class="alert alert-${req.balance.remainder > 0 ? 'warning' : 'success'}">
          <strong>Баланс:</strong>
          Выдано: ${formatMoney(req.balance.approved)} |
          Потрачено: ${formatMoney(req.balance.spent)} |
          Возвращено: ${formatMoney(req.balance.returned)} |
          <strong>Остаток: ${formatMoney(req.balance.remainder)}</strong>
        </div>
      ` : ''}

      <div class="mb-3">
        ${canReceive ? `<button class="btn btn-success me-2" onclick="CashPage.confirmReceive(${req.id})">Подтвердить получение</button>` : ''}
        ${canAddExpense ? `<button class="btn btn-primary me-2" onclick="CashPage.showExpenseModal(${req.id})">Добавить расход</button>` : ''}
        ${canReturn ? `<button class="btn btn-warning me-2" onclick="CashPage.showReturnModal(${req.id}, ${req.balance?.remainder || 0})">Вернуть остаток</button>` : ''}
        ${canReply ? `<button class="btn btn-info me-2" onclick="CashPage.showReplyModal(${req.id})">Ответить</button>` : ''}
      </div>
    `;

    // Expenses
    if (req.expenses?.length) {
      html += `
        <h6>Расходы</h6>
        <div class="table-responsive mb-3">
          <table class="table table-sm">
            <thead><tr><th>Дата</th><th>Описание</th><th>Сумма</th><th>Чек</th><th></th></tr></thead>
            <tbody>
              ${req.expenses.map(e => `
                <tr>
                  <td>${formatDate(e.expense_date)}</td>
                  <td>${escapeHtml(e.description)}</td>
                  <td>${formatMoney(e.amount)}</td>
                  <td>
                    ${e.receipt_file ? `<a href="/api/cash/${req.id}/receipt/${e.receipt_file}" target="_blank">${escapeHtml(e.receipt_original_name || 'Чек')}</a>` : '-'}
                  </td>
                  <td>
                    ${canAddExpense ? `<button class="btn btn-sm btn-outline-danger" onclick="CashPage.deleteExpense(${req.id}, ${e.id})">X</button>` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    // Returns
    if (req.returns?.length) {
      html += `
        <h6>Возвраты</h6>
        <div class="table-responsive mb-3">
          <table class="table table-sm">
            <thead><tr><th>Дата</th><th>Сумма</th><th>Комментарий</th><th>Подтверждено</th></tr></thead>
            <tbody>
              ${req.returns.map(r => `
                <tr>
                  <td>${formatDateTime(r.created_at)}</td>
                  <td>${formatMoney(r.amount)}</td>
                  <td>${escapeHtml(r.note || '-')}</td>
                  <td>${r.confirmed_at ? `${formatDateTime(r.confirmed_at)} (${escapeHtml(r.confirmed_by_name || '')})` : '<span class="badge bg-warning">Ожидает</span>'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    // Messages
    if (req.messages?.length) {
      html += `
        <h6>Переписка</h6>
        <div class="border rounded p-2 mb-3" style="max-height: 200px; overflow-y: auto;">
          ${req.messages.map(m => `
            <div class="mb-2">
              <small class="text-muted">${formatDateTime(m.created_at)} - ${escapeHtml(m.user_name)} (${m.user_role})</small>
              <div>${escapeHtml(m.message)}</div>
            </div>
          `).join('')}
        </div>
      `;
    }

    document.getElementById('cashDetailBody').innerHTML = html;
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
      AsgardUI.toast('Получение подтверждено', 'success');
      await showDetail(id);
      await loadBalance();
      await loadRequests();
    } catch (e) {
      AsgardUI.toast(e.message, 'danger');
    }
  }

  function showExpenseModal(requestId) {
    document.getElementById('cashExpenseForm').reset();
    document.getElementById('expenseRequestId').value = requestId;
    document.querySelector('#cashExpenseForm [name="expense_date"]').value = new Date().toISOString().split('T')[0];
    new bootstrap.Modal(document.getElementById('cashExpenseModal')).show();
  }

  async function submitExpense() {
    const form = document.getElementById('cashExpenseForm');
    const requestId = document.getElementById('expenseRequestId').value;
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

      bootstrap.Modal.getInstance(document.getElementById('cashExpenseModal')).hide();
      AsgardUI.toast('Расход добавлен', 'success');
      await showDetail(parseInt(requestId));
      await loadBalance();
      await loadRequests();
    } catch (e) {
      AsgardUI.toast(e.message, 'danger');
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
      AsgardUI.toast('Расход удалён', 'success');
      await showDetail(requestId);
      await loadBalance();
      await loadRequests();
    } catch (e) {
      AsgardUI.toast(e.message, 'danger');
    }
  }

  function showReturnModal(requestId, remainder) {
    document.getElementById('cashReturnForm').reset();
    document.getElementById('returnRequestId').value = requestId;
    document.getElementById('returnRemainder').textContent = formatMoney(remainder);
    document.querySelector('#cashReturnForm [name="amount"]').max = remainder;
    document.querySelector('#cashReturnForm [name="amount"]').value = remainder;
    new bootstrap.Modal(document.getElementById('cashReturnModal')).show();
  }

  async function submitReturn() {
    const form = document.getElementById('cashReturnForm');
    const requestId = document.getElementById('returnRequestId').value;
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

      bootstrap.Modal.getInstance(document.getElementById('cashReturnModal')).hide();
      AsgardUI.toast('Возврат зарегистрирован', 'success');
      await showDetail(parseInt(requestId));
      await loadBalance();
      await loadRequests();
    } catch (e) {
      AsgardUI.toast(e.message, 'danger');
    }
  }

  function showReplyModal(requestId) {
    document.getElementById('cashReplyForm').reset();
    document.getElementById('replyRequestId').value = requestId;
    new bootstrap.Modal(document.getElementById('cashReplyModal')).show();
  }

  async function submitReply() {
    const form = document.getElementById('cashReplyForm');
    const requestId = document.getElementById('replyRequestId').value;
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

      bootstrap.Modal.getInstance(document.getElementById('cashReplyModal')).hide();
      AsgardUI.toast('Ответ отправлен', 'success');
      await showDetail(parseInt(requestId));
      await loadRequests();
    } catch (e) {
      AsgardUI.toast(e.message, 'danger');
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────
  function formatMoney(val) {
    const num = parseFloat(val) || 0;
    return num.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' руб.';
  }

  function formatDate(val) {
    if (!val) return '-';
    return new Date(val).toLocaleDateString('ru-RU');
  }

  function formatDateTime(val) {
    if (!val) return '-';
    return new Date(val).toLocaleString('ru-RU');
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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
