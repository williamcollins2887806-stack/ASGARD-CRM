/**
 * ASGARD CRM — Касса (страница директора)
 * Согласование и контроль авансовых отчётов
 */

window.CashAdminPage = (function() {
  'use strict';

  const STATUS_LABELS = {
    requested: 'Ожидает согласования',
    approved: 'Согласовано',
    received: 'Получено',
    reporting: 'Отчёт',
    closed: 'Закрыто',
    rejected: 'Отклонено',
    question: 'Вопрос'
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
    advance: 'Аванс',
    loan: 'Долг до ЗП'
  };

  // Цвета типов запросов (Доработка 1)
  const TYPE_COLORS = {
    advance: '#3b82f6', // синий — целевой аванс
    loan: '#f59e0b'     // жёлтый — личный долг
  };

  let currentRequests = [];
  let currentSummary = [];
  let currentFilter = { status: '' };

  // ─────────────────────────────────────────────────────────────────
  // RENDER PAGE
  // ─────────────────────────────────────────────────────────────────
  async function render(container) {
    container.innerHTML = `
      <div class="page-header">
        <h1>Касса (управление)</h1>
        <p class="text-muted">Согласование и контроль авансовых отчётов</p>
      </div>

      <!-- Tabs -->
      <ul class="nav nav-tabs mb-4" role="tablist">
        <li class="nav-item">
          <button class="nav-link active" data-bs-toggle="tab" data-bs-target="#tab-requests">Заявки</button>
        </li>
        <li class="nav-item">
          <button class="nav-link" data-bs-toggle="tab" data-bs-target="#tab-summary">Сводка по РП</button>
        </li>
      </ul>

      <div class="tab-content">
        <!-- Requests Tab -->
        <div class="tab-pane fade show active" id="tab-requests">
          <div class="card mb-4">
            <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
              <span>Все заявки</span>
              <div class="d-flex gap-2 flex-wrap">
                <select class="form-select form-select-sm" style="width: auto;" id="cashAdminFilter" onchange="CashAdminPage.onFilterChange()">
                  <option value="">Все статусы</option>
                  <option value="requested">Ожидают согласования</option>
                  <option value="approved">Согласованы</option>
                  <option value="received">Получены</option>
                  <option value="reporting">Отчёт</option>
                  <option value="question">Вопрос</option>
                  <option value="closed">Закрыты</option>
                  <option value="rejected">Отклонены</option>
                </select>
                <button class="btn btn-outline-secondary btn-sm" onclick="CashAdminPage.loadRequests()">Обновить</button>
              </div>
            </div>
            <div class="card-body p-0">
              <div id="cash-admin-requests-list">
                <div class="text-center p-4"><div class="spinner-border"></div></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Summary Tab -->
        <div class="tab-pane fade" id="tab-summary">
          <div class="card">
            <div class="card-header">Сводка по сотрудникам</div>
            <div class="card-body p-0">
              <div id="cash-admin-summary">
                <div class="text-center p-4"><div class="spinner-border"></div></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Detail Modal -->
      <div class="modal fade" id="cashAdminDetailModal" tabindex="-1">
        <div class="modal-dialog modal-lg">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Заявка #<span id="cashAdminDetailId"></span></h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body" id="cashAdminDetailBody">
              <div class="text-center p-4"><div class="spinner-border"></div></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Question Modal -->
      <div class="modal fade" id="cashQuestionModal" tabindex="-1">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Задать вопрос</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <form id="cashQuestionForm">
                <input type="hidden" name="request_id" id="questionRequestId">
                <div class="mb-3">
                  <label class="form-label">Вопрос</label>
                  <textarea class="form-control" name="message" rows="3" required></textarea>
                </div>
              </form>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Отмена</button>
              <button type="button" class="btn btn-warning" onclick="CashAdminPage.submitQuestion()">Отправить вопрос</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Reject Modal -->
      <div class="modal fade" id="cashRejectModal" tabindex="-1">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Отклонить заявку</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <form id="cashRejectForm">
                <input type="hidden" name="request_id" id="rejectRequestId">
                <div class="mb-3">
                  <label class="form-label">Причина отклонения</label>
                  <textarea class="form-control" name="comment" rows="3" required></textarea>
                </div>
              </form>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Отмена</button>
              <button type="button" class="btn btn-danger" onclick="CashAdminPage.submitReject()">Отклонить</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Close Modal -->
      <div class="modal fade" id="cashCloseModal" tabindex="-1">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Закрыть заявку</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <form id="cashCloseForm">
                <input type="hidden" name="request_id" id="closeRequestId">
                <div id="closeRemainderWarning" class="alert alert-warning" style="display:none;">
                  Остаток: <strong id="closeRemainderAmount">0</strong> руб. Заявка будет закрыта принудительно.
                </div>
                <div class="mb-3">
                  <label class="form-label">Комментарий (опционально)</label>
                  <textarea class="form-control" name="comment" rows="2"></textarea>
                </div>
              </form>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Отмена</button>
              <button type="button" class="btn btn-success" onclick="CashAdminPage.submitClose()">Закрыть заявку</button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Load data for both tabs
    await Promise.all([loadRequests(), loadSummary()]);

    // Listen for tab changes to refresh data
    document.querySelectorAll('[data-bs-toggle="tab"]').forEach(el => {
      el.addEventListener('shown.bs.tab', async (e) => {
        if (e.target.dataset.bsTarget === '#tab-summary') {
          await loadSummary();
        }
      });
    });
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

  async function loadRequests() {
    try {
      let url = '/api/cash/all';
      if (currentFilter.status) {
        url += '?status=' + currentFilter.status;
      }

      const resp = await fetch(url, { headers: getHeaders() });
      currentRequests = await resp.json();
      renderRequestsList();
    } catch (e) {
      console.error('loadRequests error', e);
      document.getElementById('cash-admin-requests-list').innerHTML = '<div class="text-center text-danger p-4">Ошибка загрузки</div>';
    }
  }

  async function loadSummary() {
    try {
      const resp = await fetch('/api/cash/summary', { headers: getHeaders() });
      currentSummary = await resp.json();
      renderSummary();
    } catch (e) {
      console.error('loadSummary error', e);
      document.getElementById('cash-admin-summary').innerHTML = '<div class="text-center text-danger p-4">Ошибка загрузки</div>';
    }
  }

  function onFilterChange() {
    currentFilter.status = document.getElementById('cashAdminFilter').value;
    loadRequests();
  }

  function renderRequestsList() {
    const container = document.getElementById('cash-admin-requests-list');

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
              <th>Сотрудник</th>
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
              // Для loan (долг) баланс показываем как отрицательный (долг сотрудника)
              const isLoan = r.type === 'loan';
              const balanceVal = r.balance ? r.balance.remainder : 0;
              const balanceDisplay = isLoan && balanceVal > 0 ? `-${formatMoney(balanceVal)}` : formatMoney(balanceVal);
              const balanceColor = isLoan ? (balanceVal > 0 ? '#ef4444' : '#22c55e') : (balanceVal > 0 ? '#f59e0b' : '#22c55e');
              const typeColor = TYPE_COLORS[r.type] || '#6b7280';

              return `
              <tr class="${r.status === 'requested' ? 'table-warning' : ''}">
                <td>${r.id}</td>
                <td><strong>${escapeHtml(r.user_name)}</strong><br><small class="text-muted">${r.user_role}</small></td>
                <td><span style="display:inline-block;padding:2px 8px;border-radius:4px;background:${typeColor};color:#fff;font-size:0.85em">${TYPE_LABELS[r.type] || r.type}</span></td>
                <td>${r.work_title || (r.work_id ? '#' + r.work_id : (isLoan ? 'Личные' : '-'))}</td>
                <td><strong>${formatMoney(r.amount)}</strong></td>
                <td><span class="badge bg-${STATUS_COLORS[r.status]}">${STATUS_LABELS[r.status]}</span></td>
                <td><span style="color:${balanceColor};font-weight:600">${r.balance ? balanceDisplay : '-'}</span></td>
                <td>${formatDate(r.created_at)}</td>
                <td>
                  <button class="btn btn-sm btn-outline-primary" onclick="CashAdminPage.showDetail(${r.id})">
                    Открыть
                  </button>
                </td>
              </tr>
            `;}).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderSummary() {
    const container = document.getElementById('cash-admin-summary');

    if (!currentSummary.length) {
      container.innerHTML = '<div class="text-center text-muted p-4">Нет данных</div>';
      return;
    }

    // Calculate totals
    const totals = currentSummary.reduce((acc, r) => {
      acc.issued += r.total_issued;
      acc.spent += r.total_spent;
      acc.returned += r.total_returned;
      acc.balance += r.balance;
      return acc;
    }, { issued: 0, spent: 0, returned: 0, balance: 0 });

    container.innerHTML = `
      <div class="table-responsive">
        <table class="table table-hover mb-0">
          <thead>
            <tr>
              <th>Сотрудник</th>
              <th>Роль</th>
              <th class="text-end">Выдано</th>
              <th class="text-end">Потрачено</th>
              <th class="text-end">Возвращено</th>
              <th class="text-end">На руках</th>
            </tr>
          </thead>
          <tbody>
            ${currentSummary.map(r => `
              <tr>
                <td><strong>${escapeHtml(r.user_name)}</strong></td>
                <td>${r.user_role}</td>
                <td class="text-end">${formatMoney(r.total_issued)}</td>
                <td class="text-end">${formatMoney(r.total_spent)}</td>
                <td class="text-end">${formatMoney(r.total_returned)}</td>
                <td class="text-end ${r.balance > 0 ? 'text-danger fw-bold' : ''}">${formatMoney(r.balance)}</td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot class="table-light">
            <tr>
              <th colspan="2">ИТОГО</th>
              <th class="text-end">${formatMoney(totals.issued)}</th>
              <th class="text-end">${formatMoney(totals.spent)}</th>
              <th class="text-end">${formatMoney(totals.returned)}</th>
              <th class="text-end ${totals.balance > 0 ? 'text-danger fw-bold' : ''}">${formatMoney(totals.balance)}</th>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  }

  // ─────────────────────────────────────────────────────────────────
  // DETAIL
  // ─────────────────────────────────────────────────────────────────
  async function showDetail(id) {
    document.getElementById('cashAdminDetailId').textContent = id;
    document.getElementById('cashAdminDetailBody').innerHTML = '<div class="text-center p-4"><div class="spinner-border"></div></div>';
    new bootstrap.Modal(document.getElementById('cashAdminDetailModal')).show();

    try {
      const resp = await fetch('/api/cash/' + id, { headers: getHeaders() });
      if (!resp.ok) throw new Error('Ошибка загрузки');
      const req = await resp.json();
      renderDetail(req);
    } catch (e) {
      document.getElementById('cashAdminDetailBody').innerHTML = '<div class="text-center text-danger p-4">' + e.message + '</div>';
    }
  }

  function renderDetail(req) {
    const canApprove = req.status === 'requested';
    const canReject = ['requested', 'approved'].includes(req.status);
    const canQuestion = ['requested', 'received', 'reporting'].includes(req.status);
    const canClose = ['received', 'reporting'].includes(req.status);
    const hasUnconfirmedReturns = req.returns?.some(r => !r.confirmed_at);

    let html = `
      <div class="row mb-3">
        <div class="col-md-6">
          <p><strong>Сотрудник:</strong> ${escapeHtml(req.user_name)} (${req.user_role})</p>
          <p><strong>Тип:</strong> ${TYPE_LABELS[req.type] || req.type}</p>
          <p><strong>Проект:</strong> ${req.work_title || (req.work_id ? '#' + req.work_id : '-')}</p>
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
        ${canApprove ? `<button class="btn btn-success me-2" onclick="CashAdminPage.approve(${req.id})">Согласовать</button>` : ''}
        ${canReject ? `<button class="btn btn-danger me-2" onclick="CashAdminPage.showRejectModal(${req.id})">Отклонить</button>` : ''}
        ${canQuestion ? `<button class="btn btn-warning me-2" onclick="CashAdminPage.showQuestionModal(${req.id})">Задать вопрос</button>` : ''}
        ${canClose ? `<button class="btn btn-primary me-2" onclick="CashAdminPage.showCloseModal(${req.id}, ${req.balance?.remainder || 0})">Закрыть</button>` : ''}
      </div>
    `;

    // Expenses
    if (req.expenses?.length) {
      html += `
        <h6>Расходы</h6>
        <div class="table-responsive mb-3">
          <table class="table table-sm">
            <thead><tr><th>Дата</th><th>Описание</th><th>Сумма</th><th>Чек</th></tr></thead>
            <tbody>
              ${req.expenses.map(e => `
                <tr>
                  <td>${formatDate(e.expense_date)}</td>
                  <td>${escapeHtml(e.description)}</td>
                  <td>${formatMoney(e.amount)}</td>
                  <td>
                    ${e.receipt_file ? `<a href="/api/cash/${req.id}/receipt/${e.receipt_file}" target="_blank">${escapeHtml(e.receipt_original_name || 'Чек')}</a>` : '-'}
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
            <thead><tr><th>Дата</th><th>Сумма</th><th>Комментарий</th><th>Статус</th><th></th></tr></thead>
            <tbody>
              ${req.returns.map(r => `
                <tr>
                  <td>${formatDateTime(r.created_at)}</td>
                  <td>${formatMoney(r.amount)}</td>
                  <td>${escapeHtml(r.note || '-')}</td>
                  <td>${r.confirmed_at ? `<span class="badge bg-success">Подтверждено ${formatDateTime(r.confirmed_at)}</span>` : '<span class="badge bg-warning">Ожидает</span>'}</td>
                  <td>
                    ${!r.confirmed_at ? `<button class="btn btn-sm btn-success" onclick="CashAdminPage.confirmReturn(${req.id}, ${r.id})">Подтвердить</button>` : ''}
                  </td>
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

    document.getElementById('cashAdminDetailBody').innerHTML = html;
  }

  // ─────────────────────────────────────────────────────────────────
  // ACTIONS
  // ─────────────────────────────────────────────────────────────────
  async function approve(id) {
    if (!confirm('Согласовать заявку?')) return;

    try {
      const resp = await fetch(`/api/cash/${id}/approve`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({})
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Ошибка');
      }
      AsgardUI.toast('Заявка согласована', 'success');
      await showDetail(id);
      await loadRequests();
    } catch (e) {
      AsgardUI.toast(e.message, 'danger');
    }
  }

  function showRejectModal(id) {
    document.getElementById('cashRejectForm').reset();
    document.getElementById('rejectRequestId').value = id;
    new bootstrap.Modal(document.getElementById('cashRejectModal')).show();
  }

  async function submitReject() {
    const requestId = document.getElementById('rejectRequestId').value;
    const comment = document.querySelector('#cashRejectForm [name="comment"]').value;

    try {
      const resp = await fetch(`/api/cash/${requestId}/reject`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ comment })
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Ошибка');
      }
      bootstrap.Modal.getInstance(document.getElementById('cashRejectModal')).hide();
      AsgardUI.toast('Заявка отклонена', 'success');
      await showDetail(parseInt(requestId));
      await loadRequests();
    } catch (e) {
      AsgardUI.toast(e.message, 'danger');
    }
  }

  function showQuestionModal(id) {
    document.getElementById('cashQuestionForm').reset();
    document.getElementById('questionRequestId').value = id;
    new bootstrap.Modal(document.getElementById('cashQuestionModal')).show();
  }

  async function submitQuestion() {
    const requestId = document.getElementById('questionRequestId').value;
    const message = document.querySelector('#cashQuestionForm [name="message"]').value;

    try {
      const resp = await fetch(`/api/cash/${requestId}/question`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ message })
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Ошибка');
      }
      bootstrap.Modal.getInstance(document.getElementById('cashQuestionModal')).hide();
      AsgardUI.toast('Вопрос отправлен', 'success');
      await showDetail(parseInt(requestId));
      await loadRequests();
    } catch (e) {
      AsgardUI.toast(e.message, 'danger');
    }
  }

  function showCloseModal(id, remainder) {
    document.getElementById('cashCloseForm').reset();
    document.getElementById('closeRequestId').value = id;

    const warning = document.getElementById('closeRemainderWarning');
    if (remainder > 0) {
      document.getElementById('closeRemainderAmount').textContent = formatMoney(remainder);
      warning.style.display = 'block';
    } else {
      warning.style.display = 'none';
    }

    new bootstrap.Modal(document.getElementById('cashCloseModal')).show();
  }

  async function submitClose() {
    const requestId = document.getElementById('closeRequestId').value;
    const comment = document.querySelector('#cashCloseForm [name="comment"]').value;
    const hasRemainder = document.getElementById('closeRemainderWarning').style.display !== 'none';

    try {
      const resp = await fetch(`/api/cash/${requestId}/close`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ comment, force: hasRemainder })
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Ошибка');
      }
      bootstrap.Modal.getInstance(document.getElementById('cashCloseModal')).hide();
      AsgardUI.toast('Заявка закрыта', 'success');
      await showDetail(parseInt(requestId));
      await loadRequests();
    } catch (e) {
      AsgardUI.toast(e.message, 'danger');
    }
  }

  async function confirmReturn(requestId, returnId) {
    if (!confirm('Подтвердить получение возврата?')) return;

    try {
      const resp = await fetch(`/api/cash/${requestId}/return/${returnId}/confirm`, {
        method: 'PUT',
        headers: getHeaders()
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Ошибка');
      }
      AsgardUI.toast('Возврат подтверждён', 'success');
      await showDetail(requestId);
      await loadRequests();
      await loadSummary();
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
    loadRequests,
    loadSummary,
    onFilterChange,
    showDetail,
    approve,
    showRejectModal,
    submitReject,
    showQuestionModal,
    submitQuestion,
    showCloseModal,
    submitClose,
    confirmReturn
  };
})();
