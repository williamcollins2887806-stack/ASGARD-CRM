/**
 * ASGARD CRM — Казна — Управление (страница директора)
 * Согласование и контроль авансовых отчётов
 * Карточный вид с KPI, progress-шагами и быстрыми действиями
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
    advance: 'Аванс на проект',
    loan: 'Долг до ЗП'
  };

  const TYPE_COLORS = {
    advance: 'info',
    loan: 'warning'
  };

  const ADVANCE_STEPS = ['requested', 'approved', 'received', 'reporting', 'closed'];
  const LOAN_STEPS = ['requested', 'approved', 'received', 'closed'];
  const STEP_LABELS = { requested: 'Заявка', approved: 'Согласов.', received: 'Получено', reporting: 'Отчёт', closed: 'Закрыто' };

  let currentRequests = [];
  let currentSummary = [];
  let currentFilter = { status: '', type: '' };
  let activeTab = 'requests';

  function statusCssClass(status) {
    const map = { requested: 'yellow', approved: 'green', received: 'blue', reporting: 'blue', closed: 'gray', rejected: 'red', question: 'yellow' };
    return map[status] || 'gray';
  }

  // ─────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────
  function fmtMoney(val) {
    const num = parseFloat(val) || 0;
    return num.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' \u20BD';
  }

  function fmtDate(val) {
    if (!val) return '-';
    return new Date(val).toLocaleDateString('ru-RU');
  }

  function fmtDateTime(val) {
    if (!val) return '-';
    return new Date(val).toLocaleString('ru-RU');
  }

  // ─────────────────────────────────────────────────────────────────
  // PROGRESS STEPS
  // ─────────────────────────────────────────────────────────────────
  function renderProgressSteps(r) {
    const isLoan = r.type === 'loan';
    const steps = isLoan ? LOAN_STEPS : ADVANCE_STEPS;
    const currentStep = steps.indexOf(r.status);
    const isRejected = r.status === 'rejected';
    const isQuestion = r.status === 'question';

    if (isRejected) {
      return `<div class="cash-steps">${steps.map((s, i) => {
        return `<div class="cash-step rejected"><div class="cash-step-dot"></div><div class="cash-step-label">${STEP_LABELS[s]}</div></div>`;
      }).join('')}</div>`;
    }

    if (isQuestion) {
      // Show steps up to current position but mark current as question
      return `<div class="cash-steps">${steps.map((s, i) => {
        let cls = 'cash-step';
        if (i < currentStep) cls += ' done';
        else if (i === currentStep) cls += ' active';
        return `<div class="${cls}"><div class="cash-step-dot"></div><div class="cash-step-label">${STEP_LABELS[s]}</div></div>`;
      }).join('')}</div>`;
    }

    return `<div class="cash-steps">${steps.map((s, i) => {
      let cls = 'cash-step';
      if (i < currentStep) cls += ' done';
      else if (i === currentStep) cls += ' active';
      return `<div class="${cls}"><div class="cash-step-dot"></div><div class="cash-step-label">${STEP_LABELS[s]}</div></div>`;
    }).join('')}</div>`;
  }

  // ─────────────────────────────────────────────────────────────────
  // RENDER PAGE
  // ─────────────────────────────────────────────────────────────────
  async function render(container) {
    container.innerHTML = `
      <div class="page-header">
        <h1>Казна — Управление</h1>
        <p style="color:var(--text-muted); font-size:var(--text-sm); margin:0">Согласование и контроль авансовых отчётов</p>
      </div>

      <div id="cash-admin-kpi" style="margin-bottom:24px"></div>

      <div id="cash-admin-pending-section" style="margin-bottom:24px"></div>

      <div id="cash-admin-pending-returns-section" style="margin-bottom:24px"></div>

      <div class="cash-tabs">
        <button class="cash-tab active" id="tab-btn-requests" onclick="CashAdminPage.switchTab('requests')">Заявки</button>
        <button class="cash-tab" id="tab-btn-summary" onclick="CashAdminPage.switchTab('summary')">Сводка по РП</button>
      </div>

      <div id="tab-requests">
        <div class="cash-card">
          <div class="cash-card-header">
            <span class="card-title">Все заявки</span>
            <div class="cash-filter-bar" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <select id="cashAdminFilterType" onchange="CashAdminPage.onFilterChange()" style="padding:8px 12px; background:var(--bg-surface); border:1px solid var(--border); border-radius:var(--radius-sm); color:var(--text-primary); font-family:var(--font-sans); font-size:var(--text-sm); min-width:140px;">
                <option value="">Все типы</option>
                <option value="advance">Аванс</option>
                <option value="loan">Долг до ЗП</option>
              </select>
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
  // KPI CARDS
  // ─────────────────────────────────────────────────────────────────
  function renderKPI() {
    const kpiContainer = document.getElementById('cash-admin-kpi');
    if (!kpiContainer) return;

    const pendingCount = currentRequests.filter(r => r.status === 'requested').length;
    const activeCount = currentRequests.filter(r => !['closed', 'rejected'].includes(r.status)).length;
    const totalBalance = currentSummary.reduce((sum, s) => sum + (parseFloat(s.balance) || 0), 0);

    kpiContainer.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px">
        <div style="background:var(--bg-surface);border:1px solid ${pendingCount > 0 ? 'var(--danger)' : 'var(--border)'};border-radius:var(--radius-md);padding:20px;text-align:center;${pendingCount > 0 ? 'box-shadow:0 0 12px rgba(239,68,68,0.15)' : ''}">
          <div style="font-size:32px;font-weight:800;color:${pendingCount > 0 ? 'var(--danger)' : 'var(--text-primary)'}">${pendingCount}</div>
          <div style="font-size:var(--text-sm);color:var(--text-muted);margin-top:4px">\u26A1 Ожидают решения</div>
        </div>
        <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-md);padding:20px;text-align:center">
          <div style="font-size:32px;font-weight:800;color:var(--info)">${activeCount}</div>
          <div style="font-size:var(--text-sm);color:var(--text-muted);margin-top:4px">Активных заявок</div>
        </div>
        <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-md);padding:20px;text-align:center">
          <div style="font-size:32px;font-weight:800;color:${totalBalance > 0 ? 'var(--warning)' : 'var(--success)'}">${fmtMoney(totalBalance)}</div>
          <div style="font-size:var(--text-sm);color:var(--text-muted);margin-top:4px">На руках у РП</div>
        </div>
      </div>
    `;
  }

  // ─────────────────────────────────────────────────────────────────
  // PENDING DECISIONS SECTION
  // ─────────────────────────────────────────────────────────────────
  function renderPendingSection() {
    const container = document.getElementById('cash-admin-pending-section');
    if (!container) return;

    const pending = currentRequests.filter(r => r.status === 'requested');
    if (!pending.length) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <div style="background:var(--bg-surface);border:1px solid var(--danger);border-radius:var(--radius-md);padding:20px;border-left:4px solid var(--danger)">
        <div style="font-size:var(--text-lg);font-weight:700;color:var(--danger);margin-bottom:16px">\u26A1 ТРЕБУЮТ РЕШЕНИЯ</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px">
          ${pending.map(r => renderPendingCard(r)).join('')}
        </div>
      </div>
    `;
  }

  function renderPendingCard(r) {
    const isLoan = r.type === 'loan';
    const typeColor = isLoan ? 'var(--warning)' : 'var(--info)';
    const typeIcon = isLoan ? '\uD83E\uDE99' : '\uD83D\uDCCB';
    const projectName = r.work_title || (r.work_id ? '#' + r.work_id : (isLoan ? 'Личные средства' : '-'));

    return `
      <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;cursor:pointer" onclick="CashAdminPage.showDetail(${r.id})">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div>
            <div style="font-weight:700;color:var(--text-primary)">${esc(r.user_name)}</div>
            <div style="font-size:11px;color:var(--text-muted)">${esc(r.user_role || '')}</div>
          </div>
          <div style="font-size:var(--text-xs);color:var(--text-muted)">${fmtDate(r.created_at)}</div>
        </div>
        <div style="margin-bottom:8px">
          <span style="color:${typeColor};font-weight:600;font-size:var(--text-sm)">${typeIcon} ${esc(TYPE_LABELS[r.type] || r.type)}</span>
          ${projectName !== '-' ? `<span style="color:var(--text-muted);font-size:var(--text-sm)"> — ${esc(projectName)}</span>` : ''}
        </div>
        <div style="font-size:var(--text-xl);font-weight:800;color:var(--gold);margin-bottom:12px">${fmtMoney(r.amount)}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap" onclick="event.stopPropagation()">
          <button class="btn green mini" onclick="CashAdminPage.approve(${r.id})">&#10003; Согласовать</button>
          <button class="btn red mini" onclick="CashAdminPage.showRejectModal(${r.id})">&#10007; Отклонить</button>
          <button class="btn amber mini" onclick="CashAdminPage.showQuestionModal(${r.id})">? Вопрос</button>
        </div>
      </div>
    `;
  }

  // ─────────────────────────────────────────────────────────────────
  // PENDING RETURNS SECTION
  // ─────────────────────────────────────────────────────────────────
  function renderPendingReturns() {
    const container = document.getElementById('cash-admin-pending-returns-section');
    if (!container) return;

    // Collect requests that have unconfirmed returns
    const withPendingReturns = currentRequests.filter(r =>
      r.returns && r.returns.some(ret => !ret.confirmed_at)
    );

    if (!withPendingReturns.length) {
      container.innerHTML = '';
      return;
    }

    let cardsHtml = '';
    withPendingReturns.forEach(r => {
      const pendingRets = r.returns.filter(ret => !ret.confirmed_at);
      pendingRets.forEach(ret => {
        cardsHtml += `
          <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
            <div>
              <div style="font-weight:700;color:var(--text-primary)">${esc(r.user_name)}</div>
              <div style="font-size:var(--text-sm);color:var(--text-muted)">Заявка #${r.id} — ${fmtDateTime(ret.created_at)}</div>
              ${ret.note ? `<div style="font-size:var(--text-sm);color:var(--text-muted);margin-top:4px">${esc(ret.note)}</div>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:12px">
              <span style="font-size:var(--text-lg);font-weight:700;color:var(--gold)">${fmtMoney(ret.amount)}</span>
              <button class="btn green mini" onclick="CashAdminPage.confirmReturn(${r.id}, ${ret.id})">Подтвердить</button>
            </div>
          </div>
        `;
      });
    });

    container.innerHTML = `
      <div style="background:var(--bg-surface);border:1px solid var(--warning);border-radius:var(--radius-md);padding:20px;border-left:4px solid var(--warning)">
        <div style="font-size:var(--text-lg);font-weight:700;color:var(--warning);margin-bottom:16px">\uD83D\uDCE5 ОЖИДАЮТ ПОДТВЕРЖДЕНИЯ ВОЗВРАТОВ</div>
        <div style="display:grid;gap:12px">
          ${cardsHtml}
        </div>
      </div>
    `;
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
      const params = [];
      if (currentFilter.status) params.push('status=' + currentFilter.status);
      if (params.length) url += '?' + params.join('&');

      const resp = await fetch(url, { headers: getHeaders() });
      currentRequests = await resp.json();
      renderKPI();
      renderPendingSection();
      renderPendingReturns();
      renderRequestsList();
    } catch (e) {
      console.error('loadRequests error', e);
      const el = document.getElementById('cash-admin-requests-list');
      if (el) el.innerHTML = '<div style="text-align:center; padding:24px; color:var(--danger)">Ошибка загрузки</div>';
    }
  }

  async function loadSummary() {
    try {
      const resp = await fetch('/api/cash/summary', { headers: getHeaders() });
      currentSummary = await resp.json();
      renderKPI();
      renderSummary();
    } catch (e) {
      console.error('loadSummary error', e);
      const el = document.getElementById('cash-admin-summary');
      if (el) el.innerHTML = '<div style="text-align:center; padding:24px; color:var(--danger)">Ошибка загрузки</div>';
    }
  }

  function onFilterChange() {
    const statusEl = document.getElementById('cashAdminFilter');
    const typeEl = document.getElementById('cashAdminFilterType');
    if (statusEl) currentFilter.status = statusEl.value;
    if (typeEl) currentFilter.type = typeEl.value;
    loadRequests();
  }

  // ─────────────────────────────────────────────────────────────────
  // CARD RENDERING — REQUESTS LIST
  // ─────────────────────────────────────────────────────────────────
  function renderRequestsList() {
    const container = document.getElementById('cash-admin-requests-list');
    if (!container) return;

    let filtered = currentRequests;
    if (currentFilter.type) {
      filtered = filtered.filter(r => r.type === currentFilter.type);
    }

    if (!filtered.length) {
      container.innerHTML = AsgardUI.emptyState({ icon: '\uD83D\uDCB0', title: 'Нет заявок', desc: 'Заявки появятся здесь' });
      return;
    }

    const active = filtered.filter(r => !['closed', 'rejected'].includes(r.status));
    const done = filtered.filter(r => ['closed', 'rejected'].includes(r.status));

    let html = '';
    if (active.length) {
      html += `<div class="cash-section-title" style="margin-top:0">Активные заявки</div>`;
      html += `<div class="cash-cards-grid">${active.map(r => renderAdminCard(r)).join('')}</div>`;
    }
    if (done.length) {
      html += `<div class="cash-section-title">Завершённые</div>`;
      html += `<div class="cash-cards-grid">${done.map(r => renderAdminCard(r)).join('')}</div>`;
    }

    container.innerHTML = html;
  }

  function renderAdminCard(r) {
    const isLoan = r.type === 'loan';
    const typeColor = isLoan ? 'var(--warning)' : 'var(--info)';
    const typeIcon = isLoan ? '\uD83E\uDE99' : '\uD83D\uDCCB';
    const projectName = r.work_title || (r.work_id ? '#' + r.work_id : (isLoan ? 'Личные средства' : ''));
    const balanceVal = r.balance ? r.balance.remainder : 0;
    const isRejected = r.status === 'rejected';
    const isQuestion = r.status === 'question';

    // Progress steps
    let stepsHtml = '';
    if (!isRejected && !isQuestion) {
      stepsHtml = renderProgressSteps(r);
    } else if (isRejected) {
      stepsHtml = `<div class="cash-card-rejected">Отклонено${r.director_comment ? ': ' + esc(r.director_comment) : ''}</div>`;
    } else if (isQuestion) {
      stepsHtml = `<div class="cash-card-question">Вопрос от директора${r.director_comment ? ': ' + esc(r.director_comment) : ''}</div>`;
    }

    // Balance display
    let balanceHtml = '';
    if (r.balance && !isRejected) {
      if (isLoan) {
        balanceHtml = balanceVal > 0
          ? `<span style="color:var(--danger);font-weight:700">Долг: ${fmtMoney(balanceVal)}</span>`
          : `<span style="color:var(--success);font-weight:600">Погашен</span>`;
      } else {
        const pct = r.balance.approved > 0 ? Math.round(r.balance.spent / r.balance.approved * 100) : 0;
        balanceHtml = `
          <div class="cash-card-balance-bar">
            <div class="cash-card-balance-fill" style="width:${Math.min(pct, 100)}%"></div>
          </div>
          <div class="cash-card-balance-info">
            <span>Израсходовано ${pct}%</span>
            <span style="font-weight:600">Ост. ${fmtMoney(balanceVal)}</span>
          </div>
        `;
      }
    }

    return `
      <div class="cash-req-card ${isRejected ? 'rejected' : ''} ${isQuestion ? 'question' : ''}" onclick="CashAdminPage.showDetail(${r.id})">
        <div class="cash-card-top">
          <div>
            <div style="font-weight:700;color:var(--text-primary)">${esc(r.user_name)}</div>
            <div style="font-size:11px;color:var(--text-muted)">${esc(r.user_role || '')}</div>
          </div>
          <div class="cash-card-date">${fmtDate(r.created_at)}</div>
        </div>

        <div style="margin:6px 0">
          <span style="color:${typeColor};font-weight:600;font-size:var(--text-sm)">${typeIcon} ${esc(TYPE_LABELS[r.type] || r.type)}</span>
          ${projectName ? `<span style="color:var(--text-muted);font-size:var(--text-sm)"> — ${esc(projectName)}</span>` : ''}
        </div>

        <div class="cash-card-amount">${fmtMoney(r.amount)}</div>

        ${stepsHtml}

        ${balanceHtml ? `<div class="cash-card-balance">${balanceHtml}</div>` : ''}
      </div>
    `;
  }

  // ─────────────────────────────────────────────────────────────────
  // SUMMARY RENDERING
  // ─────────────────────────────────────────────────────────────────
  function renderSummary() {
    const container = document.getElementById('cash-admin-summary');
    if (!container) return;

    if (!currentSummary.length) {
      container.innerHTML = AsgardUI.emptyState({ icon: '\uD83D\uDCCA', title: 'Нет данных', desc: 'Сводка будет доступна после создания заявок' });
      return;
    }

    const totals = currentSummary.reduce((acc, r) => {
      acc.issued += parseFloat(r.total_issued) || 0;
      acc.spent += parseFloat(r.total_spent) || 0;
      acc.returned += parseFloat(r.total_returned) || 0;
      acc.balance += parseFloat(r.balance) || 0;
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
                <td style="text-align:right">${fmtMoney(r.total_issued)}</td>
                <td style="text-align:right">${fmtMoney(r.total_spent)}</td>
                <td style="text-align:right">${fmtMoney(r.total_returned)}</td>
                <td style="text-align:right;${parseFloat(r.balance) > 0 ? 'color:var(--danger);font-weight:700' : ''}">${fmtMoney(r.balance)}</td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr style="background:var(--bg-elevated); font-weight:700">
              <td colspan="2">ИТОГО</td>
              <td style="text-align:right">${fmtMoney(totals.issued)}</td>
              <td style="text-align:right">${fmtMoney(totals.spent)}</td>
              <td style="text-align:right">${fmtMoney(totals.returned)}</td>
              <td style="text-align:right;${totals.balance > 0 ? 'color:var(--danger)' : ''}">${fmtMoney(totals.balance)}</td>
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
    const isLoan = req.type === 'loan';

    // Progress steps at top
    let html = `
      <div style="margin-bottom:20px">${renderProgressSteps(req)}</div>

      <div class="cash-detail-grid">
        <div>
          <div class="cash-detail-item"><span class="label">Сотрудник</span><span class="value">${esc(req.user_name)} (${esc(req.user_role)})</span></div>
          <div class="cash-detail-item" style="margin-top:12px"><span class="label">Тип</span><span class="value"><span class="status status-${TYPE_COLORS[req.type] === 'info' ? 'blue' : 'yellow'}">${esc(TYPE_LABELS[req.type] || req.type)}</span></span></div>
          <div class="cash-detail-item" style="margin-top:12px"><span class="label">Проект</span><span class="value">${esc(req.work_title || (req.work_id ? '#' + req.work_id : '-'))}</span></div>
          <div class="cash-detail-item" style="margin-top:12px"><span class="label">Сумма</span><span class="value" style="font-size:var(--text-lg);color:var(--gold)">${fmtMoney(req.amount)}</span></div>
          <div class="cash-detail-item" style="margin-top:12px"><span class="label">Цель</span><span class="value">${esc(req.purpose)}</span></div>
          ${req.cover_letter ? `<div class="cash-detail-item" style="margin-top:12px"><span class="label">Письмо</span><span class="value">${esc(req.cover_letter)}</span></div>` : ''}
        </div>
        <div>
          <div class="cash-detail-item"><span class="label">Статус</span><span class="value"><span class="status status-${statusCssClass(req.status)}">${esc(STATUS_LABELS[req.status])}</span></span></div>
          <div class="cash-detail-item" style="margin-top:12px"><span class="label">Создано</span><span class="value">${fmtDateTime(req.created_at)}</span></div>
          ${req.director_name ? `<div class="cash-detail-item" style="margin-top:12px"><span class="label">Директор</span><span class="value">${esc(req.director_name)}</span></div>` : ''}
          ${req.director_comment ? `<div class="cash-detail-item" style="margin-top:12px"><span class="label">Комментарий</span><span class="value">${esc(req.director_comment)}</span></div>` : ''}
          ${req.received_at ? `<div class="cash-detail-item" style="margin-top:12px"><span class="label">Получено</span><span class="value">${fmtDateTime(req.received_at)}</span></div>` : ''}
          ${req.closed_at ? `<div class="cash-detail-item" style="margin-top:12px"><span class="label">Закрыто</span><span class="value">${fmtDateTime(req.closed_at)}</span></div>` : ''}
        </div>
      </div>
    `;

    if (req.balance) {
      const alertType = req.balance.remainder > 0 ? 'warning' : 'success';
      html += `<div class="cash-alert ${alertType}">
        <strong>Баланс:</strong>
        Выдано: ${fmtMoney(req.balance.approved)} |
        Потрачено: ${fmtMoney(req.balance.spent)} |
        Возвращено: ${fmtMoney(req.balance.returned)} |
        <strong>Остаток: ${fmtMoney(req.balance.remainder)}</strong>
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
                  <td>${fmtDate(e.expense_date)}</td>
                  <td>${esc(e.description)}</td>
                  <td>${fmtMoney(e.amount)}</td>
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
                  <td>${fmtDateTime(r.created_at)}</td>
                  <td>${fmtMoney(r.amount)}</td>
                  <td>${esc(r.note || '-')}</td>
                  <td>${r.confirmed_at ? `<span class="status status-green">Подтверждено ${fmtDateTime(r.confirmed_at)}</span>` : '<span class="status status-yellow">Ожидает</span>'}</td>
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
              <div class="meta">${fmtDateTime(m.created_at)} — ${esc(m.user_name)} (${esc(m.user_role)})</div>
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
            ${remainder > 0 ? `<div class="cash-alert warning" style="margin-bottom:16px">Остаток: <strong>${fmtMoney(remainder)}</strong> — заявка будет закрыта принудительно.</div>` : ''}
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
      await loadRequests();
      await loadSummary();
    } catch (e) {
      toast('Ошибка', e.message, 'err');
    }
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
