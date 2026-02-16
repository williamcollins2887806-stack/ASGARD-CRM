/**
 * ASGARD CRM — Касса (страница директора)
 * Согласование и контроль авансовых отчётов
 * Redesigned to use ASGARD Design System
 */

window.CashAdminPage = (function() {
  'use strict';

  const { showModal, hideModal, toast, esc } = AsgardUI;

  const STATUS_LABELS = {
    requested: 'Ожидает согласования',
    approved: 'Согласовано',
    received: 'Получено',
    reporting: 'Отчёт',
    closed: 'Закрыто',
    rejected: 'Отклонено',
    question: 'Вопрос'
  };

  const TYPE_LABELS = {
    advance: 'Аванс',
    loan: 'Долг до ЗП'
  };

  const TYPE_COLORS = {
    advance: 'info',
    loan: 'warning'
  };

  let currentRequests = [];
  let currentSummary = [];
  let currentFilter = { status: '' };
  let activeTab = 'requests';

  function statusCssClass(status) {
    const map = { requested: 'yellow', approved: 'green', received: 'blue', reporting: 'blue', closed: 'gray', rejected: 'red', question: 'yellow' };
    return map[status] || 'gray';
  }

  // ─────────────────────────────────────────────────────────────────
  // RENDER PAGE
  // ─────────────────────────────────────────────────────────────────
  async function render(container) {
    container.innerHTML = `
      <div class="page-header">
        <h1>Касса (управление)</h1>
        <p style="color:var(--text-muted); font-size:var(--text-sm); margin:0">Согласование и контроль авансовых отчётов</p>
      </div>

      <div class="cash-tabs">
        <button class="cash-tab active" id="tab-btn-requests" onclick="CashAdminPage.switchTab('requests')">Заявки</button>
        <button class="cash-tab" id="tab-btn-summary" onclick="CashAdminPage.switchTab('summary')">Сводка по РП</button>
      </div>

      <div id="tab-requests">
        <div class="cash-card">
          <div class="cash-card-header">
            <span class="card-title">Все заявки</span>
            <div class="cash-filter-bar">
              <select id="cashAdminFilter" onchange="CashAdminPage.onFilterChange()" style="padding:8px 12px; background:var(--bg-surface); border:1px solid var(--border); border-radius:var(--radius-sm); color:var(--text-primary); font-family:var(--font-sans); font-size:var(--text-sm); min-width:180px;">
                <option value="">Все статусы</option>
                <option value="requested">Ожидают согласования</option>
                <option value="approved">Согласованы</option>
                <option value="received">Получены</option>
                <option value="reporting">Отчёт</option>
                <option value="question">Вопрос</option>
                <option value="closed">Закрыты</option>
                <option value="rejected">Отклонены</option>
              </select>
              <button class="btn ghost sm" onclick="CashAdminPage.loadRequests()">Обновить</button>
            </div>
          </div>
          <div class="cash-card-body">
            <div id="cash-admin-requests-list">
              <div style="text-align:center; padding:24px; color:var(--text-muted)">Загрузка...</div>
            </div>
          </div>
        </div>
      </div>

      <div id="tab-summary" style="display:none">
        <div class="cash-card">
          <div class="cash-card-header">
            <span class="card-title">Сводка по сотрудникам</span>
          </div>
          <div class="cash-card-body">
            <div id="cash-admin-summary">
              <div style="text-align:center; padding:24px; color:var(--text-muted)">Загрузка...</div>
            </div>
          </div>
        </div>
      </div>
    `;

    await Promise.all([loadRequests(), loadSummary()]);
  }

  function switchTab(tab) {
    activeTab = tab;
    document.getElementById('tab-requests').style.display = tab === 'requests' ? 'block' : 'none';
    document.getElementById('tab-summary').style.display = tab === 'summary' ? 'block' : 'none';
    document.getElementById('tab-btn-requests').classList.toggle('active', tab === 'requests');
    document.getElementById('tab-btn-summary').classList.toggle('active', tab === 'summary');
    if (tab === 'summary') loadSummary();
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
      document.getElementById('cash-admin-requests-list').innerHTML =
        '<div style="text-align:center; padding:24px; color:var(--danger)">Ошибка загрузки</div>';
    }
  }

  async function loadSummary() {
    try {
      const resp = await fetch('/api/cash/summary', { headers: getHeaders() });
      currentSummary = await resp.json();
      renderSummary();
    } catch (e) {
      console.error('loadSummary error', e);
      document.getElementById('cash-admin-summary').innerHTML =
        '<div style="text-align:center; padding:24px; color:var(--danger)">Ошибка загрузки</div>';
    }
  }

  function onFilterChange() {
    currentFilter.status = document.getElementById('cashAdminFilter').value;
    loadRequests();
  }

  function renderRequestsList() {
    const container = document.getElementById('cash-admin-requests-list');

    if (!currentRequests.length) {
      container.innerHTML = AsgardUI.emptyState({ icon: '💰', title: 'Нет заявок', desc: 'Заявки появятся здесь' });
      return;
    }

    container.innerHTML = `
      <div style="overflow-x:auto">
        <table class="tbl">
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
              const isLoan = r.type === 'loan';
              const balanceVal = r.balance ? r.balance.remainder : 0;
              const balanceDisplay = isLoan && balanceVal > 0 ? `-${formatMoney(balanceVal)}` : formatMoney(balanceVal);
              const balanceColor = isLoan ? (balanceVal > 0 ? 'var(--danger)' : 'var(--success)') : (balanceVal > 0 ? 'var(--warning)' : 'var(--success)');
              const isUrgent = r.status === 'requested';

              return `
              <tr onclick="CashAdminPage.showDetail(${r.id})" style="cursor:pointer;${isUrgent ? 'border-left:3px solid var(--warning)' : ''}">
                <td>${r.id}</td>
                <td><strong>${esc(r.user_name)}</strong><br><span style="font-size:11px;color:var(--text-muted)">${esc(r.user_role)}</span></td>
                <td><span class="status status-${TYPE_COLORS[r.type] === 'info' ? 'blue' : 'yellow'}">${esc(TYPE_LABELS[r.type] || r.type)}</span></td>
                <td>${esc(r.work_title || (r.work_id ? '#' + r.work_id : (isLoan ? 'Личные' : '-')))}</td>
                <td><strong>${formatMoney(r.amount)}</strong></td>
                <td><span class="status status-${statusCssClass(r.status)}">${esc(STATUS_LABELS[r.status])}</span></td>
                <td><span style="color:${balanceColor};font-weight:600">${r.balance ? balanceDisplay : '-'}</span></td>
                <td>${formatDate(r.created_at)}</td>
                <td>
                  <button class="btn ghost mini" onclick="event.stopPropagation(); CashAdminPage.showDetail(${r.id})">Открыть</button>
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
      container.innerHTML = AsgardUI.emptyState({ icon: '📊', title: 'Нет данных', desc: 'Сводка будет доступна после создания заявок' });
      return;
    }

    const totals = currentSummary.reduce((acc, r) => {
      acc.issued += r.total_issued;
      acc.spent += r.total_spent;
      acc.returned += r.total_returned;
      acc.balance += r.balance;
      return acc;
    }, { issued: 0, spent: 0, returned: 0, balance: 0 });

    container.innerHTML = `
      <div style="overflow-x:auto">
        <table class="tbl">
          <thead>
            <tr>
              <th>Сотрудник</th>
              <th>Роль</th>
              <th style="text-align:right">Выдано</th>
              <th style="text-align:right">Потрачено</th>
              <th style="text-align:right">Возвращено</th>
              <th style="text-align:right">На руках</th>
            </tr>
          </thead>
          <tbody>
            ${currentSummary.map(r => `
              <tr>
                <td><strong>${esc(r.user_name)}</strong></td>
                <td><span class="status status-blue">${esc(r.user_role)}</span></td>
                <td style="text-align:right">${formatMoney(r.total_issued)}</td>
                <td style="text-align:right">${formatMoney(r.total_spent)}</td>
                <td style="text-align:right">${formatMoney(r.total_returned)}</td>
                <td style="text-align:right;${r.balance > 0 ? 'color:var(--danger);font-weight:700' : ''}">${formatMoney(r.balance)}</td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr style="background:var(--bg-elevated); font-weight:700">
              <td colspan="2">ИТОГО</td>
              <td style="text-align:right">${formatMoney(totals.issued)}</td>
              <td style="text-align:right">${formatMoney(totals.spent)}</td>
              <td style="text-align:right">${formatMoney(totals.returned)}</td>
              <td style="text-align:right;${totals.balance > 0 ? 'color:var(--danger)' : ''}">${formatMoney(totals.balance)}</td>
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
    const canApprove = req.status === 'requested';
    const canReject = ['requested', 'approved'].includes(req.status);
    const canQuestion = ['requested', 'received', 'reporting'].includes(req.status);
    const canClose = ['received', 'reporting'].includes(req.status);

    let html = `
      <div class="cash-detail-grid">
        <div>
          <div class="cash-detail-item"><span class="label">Сотрудник</span><span class="value">${esc(req.user_name)} (${esc(req.user_role)})</span></div>
          <div class="cash-detail-item" style="margin-top:12px"><span class="label">Тип</span><span class="value"><span class="status status-${TYPE_COLORS[req.type] === 'info' ? 'blue' : 'yellow'}">${esc(TYPE_LABELS[req.type] || req.type)}</span></span></div>
          <div class="cash-detail-item" style="margin-top:12px"><span class="label">Проект</span><span class="value">${esc(req.work_title || (req.work_id ? '#' + req.work_id : '-'))}</span></div>
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

    if (req.balance) {
      const alertType = req.balance.remainder > 0 ? 'warning' : 'success';
      html += `<div class="cash-alert ${alertType}">
        <strong>Баланс:</strong>
        Выдано: ${formatMoney(req.balance.approved)} |
        Потрачено: ${formatMoney(req.balance.spent)} |
        Возвращено: ${formatMoney(req.balance.returned)} |
        <strong>Остаток: ${formatMoney(req.balance.remainder)}</strong>
      </div>`;
    }

    // Actions
    const actions = [];
    if (canApprove) actions.push(`<button class="btn green" onclick="CashAdminPage.approve(${req.id})">Согласовать</button>`);
    if (canReject) actions.push(`<button class="btn red" onclick="CashAdminPage.showRejectModal(${req.id})">Отклонить</button>`);
    if (canQuestion) actions.push(`<button class="btn amber" onclick="CashAdminPage.showQuestionModal(${req.id})">Задать вопрос</button>`);
    if (canClose) actions.push(`<button class="btn primary" onclick="CashAdminPage.showCloseModal(${req.id}, ${req.balance?.remainder || 0})">Закрыть</button>`);

    if (actions.length) {
      html += `<div class="cash-actions">${actions.join('')}</div>`;
    }

    // Expenses
    if (req.expenses?.length) {
      html += `<div class="cash-section-title">Расходы</div>
        <div style="overflow-x:auto; margin-bottom:16px">
          <table class="tbl">
            <thead><tr><th>Дата</th><th>Описание</th><th>Сумма</th><th>Чек</th></tr></thead>
            <tbody>
              ${req.expenses.map(e => `
                <tr>
                  <td>${formatDate(e.expense_date)}</td>
                  <td>${esc(e.description)}</td>
                  <td>${formatMoney(e.amount)}</td>
                  <td>${e.receipt_file ? `<a href="/api/cash/${req.id}/receipt/${e.receipt_file}" target="_blank" style="color:var(--gold)">${esc(e.receipt_original_name || 'Чек')}</a>` : '-'}</td>
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
            <thead><tr><th>Дата</th><th>Сумма</th><th>Комментарий</th><th>Статус</th><th></th></tr></thead>
            <tbody>
              ${req.returns.map(r => `
                <tr>
                  <td>${formatDateTime(r.created_at)}</td>
                  <td>${formatMoney(r.amount)}</td>
                  <td>${esc(r.note || '-')}</td>
                  <td>${r.confirmed_at ? `<span class="status status-green">Подтверждено ${formatDateTime(r.confirmed_at)}</span>` : '<span class="status status-yellow">Ожидает</span>'}</td>
                  <td>${!r.confirmed_at ? `<button class="btn green mini" onclick="CashAdminPage.confirmReturn(${req.id}, ${r.id})">Подтвердить</button>` : ''}</td>
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
      toast('Заявка согласована', '', 'ok');
      await showDetail(id);
      await loadRequests();
    } catch (e) {
      toast('Ошибка', e.message, 'err');
    }
  }

  function showRejectModal(id) {
    hideModal();
    setTimeout(() => {
      showModal({
        title: 'Отклонить заявку',
        html: `
          <form id="cashRejectForm">
            <input type="hidden" name="request_id" value="${id}">
            <div class="asg-form-group">
              <label>Причина отклонения</label>
              <textarea name="comment" rows="3" required placeholder="Укажите причину"></textarea>
            </div>
            <div class="asg-form-actions">
              <button type="button" class="btn ghost" onclick="AsgardUI.hideModal()">Отмена</button>
              <button type="button" class="btn red" onclick="CashAdminPage.submitReject()">Отклонить</button>
            </div>
          </form>
        `
      });
    }, 100);
  }

  async function submitReject() {
    const form = document.getElementById('cashRejectForm');
    if (!form) return;
    const requestId = form.querySelector('[name="request_id"]').value;
    const comment = form.querySelector('[name="comment"]').value;

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
      hideModal();
      toast('Заявка отклонена', '', 'ok');
      await loadRequests();
    } catch (e) {
      toast('Ошибка', e.message, 'err');
    }
  }

  function showQuestionModal(id) {
    hideModal();
    setTimeout(() => {
      showModal({
        title: 'Задать вопрос',
        html: `
          <form id="cashQuestionForm">
            <input type="hidden" name="request_id" value="${id}">
            <div class="asg-form-group">
              <label>Вопрос</label>
              <textarea name="message" rows="3" required placeholder="Введите вопрос"></textarea>
            </div>
            <div class="asg-form-actions">
              <button type="button" class="btn ghost" onclick="AsgardUI.hideModal()">Отмена</button>
              <button type="button" class="btn amber" onclick="CashAdminPage.submitQuestion()">Отправить вопрос</button>
            </div>
          </form>
        `
      });
    }, 100);
  }

  async function submitQuestion() {
    const form = document.getElementById('cashQuestionForm');
    if (!form) return;
    const requestId = form.querySelector('[name="request_id"]').value;
    const message = form.querySelector('[name="message"]').value;

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
      hideModal();
      toast('Вопрос отправлен', '', 'ok');
      await loadRequests();
    } catch (e) {
      toast('Ошибка', e.message, 'err');
    }
  }

  function showCloseModal(id, remainder) {
    hideModal();
    setTimeout(() => {
      showModal({
        title: 'Закрыть заявку',
        html: `
          <form id="cashCloseForm">
            <input type="hidden" name="request_id" value="${id}">
            <input type="hidden" name="has_remainder" value="${remainder > 0 ? '1' : '0'}">
            ${remainder > 0 ? `<div class="cash-alert warning" style="margin-bottom:16px">Остаток: <strong>${formatMoney(remainder)}</strong> — заявка будет закрыта принудительно.</div>` : ''}
            <div class="asg-form-group">
              <label>Комментарий (опционально)</label>
              <textarea name="comment" rows="2" placeholder="Дополнительная информация"></textarea>
            </div>
            <div class="asg-form-actions">
              <button type="button" class="btn ghost" onclick="AsgardUI.hideModal()">Отмена</button>
              <button type="button" class="btn green" onclick="CashAdminPage.submitClose()">Закрыть заявку</button>
            </div>
          </form>
        `
      });
    }, 100);
  }

  async function submitClose() {
    const form = document.getElementById('cashCloseForm');
    if (!form) return;
    const requestId = form.querySelector('[name="request_id"]').value;
    const comment = form.querySelector('[name="comment"]').value;
    const hasRemainder = form.querySelector('[name="has_remainder"]').value === '1';

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
      hideModal();
      toast('Заявка закрыта', '', 'ok');
      await loadRequests();
    } catch (e) {
      toast('Ошибка', e.message, 'err');
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
      toast('Возврат подтверждён', '', 'ok');
      await showDetail(requestId);
      await loadRequests();
      await loadSummary();
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
    switchTab,
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
