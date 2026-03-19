/**
 * ASGARD CRM — Казна Дружины (страница РП)
 * Карточный вид с progress-шагами и категориями расходов
 */

window.AsgardCashPage = (function() {
  'use strict';

  const { showModal, hideModal, toast, esc } = AsgardUI;

  const STATUS_LABELS = {
    requested: 'Ожидает',
    approved: 'Согласовано',
    money_issued: 'Деньги выданы',
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

  const EXPENSE_CATEGORIES = [
    { value: 'materials', label: 'Материалы', icon: '🧱' },
    { value: 'transport', label: 'Транспорт', icon: '🚗' },
    { value: 'food', label: 'Питание', icon: '🍽️' },
    { value: 'housing', label: 'Проживание', icon: '🏨' },
    { value: 'tools', label: 'Инструмент', icon: '🔧' },
    { value: 'fuel', label: 'Топливо', icon: '⛽' },
    { value: 'other', label: 'Прочее', icon: '📦' }
  ];

  // Status step order — money_issued добавлен между approved и received
  const ADVANCE_STEPS = ['requested', 'approved', 'money_issued', 'received', 'reporting', 'closed'];
  const LOAN_STEPS = ['requested', 'approved', 'money_issued', 'received', 'closed'];
  const STEP_LABELS = { requested: 'Заявка', approved: 'Согласов.', money_issued: 'Выдано', received: 'Получено', reporting: 'Отчёт', closed: 'Закрыто' };

  let currentRequests = [];
  let currentPage = 1, pageSize = 20;
  let works = [];

  // ─────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────
  async function render(container) {
    currentPage = 1; pageSize = window.AsgardPagination ? AsgardPagination.getPageSize() : 20;
    container.innerHTML = `
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <h1>Казна Дружины</h1>
          <p style="color:var(--text-muted);font-size:var(--text-sm);margin:0">Авансы, расходы и расчёты</p>
        </div>
        <button class="btn primary" onclick="AsgardCashPage.showCreateModal()">+ Новая заявка</button>
      </div>

      <div id="cash-balance-widget"></div>

      <div id="cash-requests-list">
        <div style="text-align:center;padding:40px;color:var(--text-muted)">Загрузка...</div>
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
      const d = await resp.json();
      const widget = document.getElementById('cash-balance-widget');
      if (!widget) return;

      widget.innerHTML = `
        <div class="cash-balance-grid">
          <div class="cash-balance-card info">
            <div class="balance-value">${fmtMoney(d.issued)}</div>
            <div class="balance-label">Получено</div>
          </div>
          <div class="cash-balance-card warning">
            <div class="balance-value">${fmtMoney(d.spent)}</div>
            <div class="balance-label">Потрачено</div>
          </div>
          <div class="cash-balance-card success">
            <div class="balance-value">${fmtMoney(d.returned)}</div>
            <div class="balance-label">Возвращено</div>
          </div>
          <div class="cash-balance-card ${d.balance > 0 ? 'danger' : 'secondary'}">
            <div class="balance-value">${fmtMoney(d.balance)}</div>
            <div class="balance-label">На руках</div>
          </div>
        </div>
      `;
    } catch (e) {
      console.error('loadBalance', e);
    }
  }

  async function loadWorks() {
    try {
      const resp = await fetch('/api/works?limit=500', { headers: getHeaders() });
      const data = await resp.json();
      works = data.works || data || [];
    } catch (e) { console.error('loadWorks', e); }
  }

  async function loadRequests() {
    try {
      const resp = await fetch('/api/cash/my', { headers: getHeaders() });
      currentRequests = await resp.json();
      renderCards();
    } catch (e) {
      console.error('loadRequests', e);
      document.getElementById('cash-requests-list').innerHTML =
        '<div style="text-align:center;padding:40px;color:var(--danger)">Ошибка загрузки</div>';
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // CARD RENDERING
  // ─────────────────────────────────────────────────────────────────
  function renderCards() {
    const container = document.getElementById('cash-requests-list');
    if (!container) return; // Guard against DOM being replaced after navigation
    if (!currentRequests.length) {
      container.innerHTML = AsgardUI.emptyState({ icon: '💰', title: 'Нет заявок', desc: 'Создайте первую заявку на аванс или долг' });
      return;
    }

    // Sort: active first, then closed
    const active = currentRequests.filter(r => !['closed', 'rejected'].includes(r.status));
    const done = currentRequests.filter(r => ['closed', 'rejected'].includes(r.status));

    let html = '';
    if (active.length) {
      html += `<div class="cash-section-title" style="margin-top:0">Активные заявки</div>`;
      html += `<div class="cash-cards-grid">${active.map(r => renderCard(r)).join('')}</div>`;
    }
    if (done.length) {
      html += `<div class="cash-section-title">Завершённые</div>`;
      html += `<div class="cash-cards-grid">${done.map(r => renderCard(r)).join('')}</div>`;
    }

    container.innerHTML = html;
      if (window.AsgardPagination) {
        let pgEl = document.getElementById("cash_pagination");
        if (!pgEl) { pgEl = document.createElement("div"); pgEl.id = "cash_pagination"; container.after(pgEl); }
        pgEl.innerHTML = AsgardPagination.renderControls(currentRequests.length, currentPage, pageSize);
        AsgardPagination.attachHandlers("cash_pagination",
          (p) => { currentPage = p; renderCards(); },
          (s) => { pageSize = s; currentPage = 1; renderCards(); }
        );
      };
  }

  function renderDeadlineTimer(receipt_deadline, is_overdue) {
    if (!receipt_deadline) return '';
    const deadline = new Date(receipt_deadline);
    const now = new Date();
    if (is_overdue) {
      return `<div style="color:var(--danger);font-weight:700;font-size:var(--text-sm);margin-top:6px">⚠️ ПРОСРОЧЕНО</div>`;
    }
    const diff = deadline - now;
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const color = hours < 2 ? 'var(--danger)' : 'var(--warning)';
    return `<div style="color:${color};font-size:var(--text-sm);margin-top:6px">⏱ Подтвердите: ${hours}ч ${mins}мин</div>`;
  }

  function renderCard(r) {
    const isLoan = r.type === 'loan';
    const steps = isLoan ? LOAN_STEPS : ADVANCE_STEPS;
    const currentStep = steps.indexOf(r.status);
    const isRejected = r.status === 'rejected';
    const isQuestion = r.status === 'question';
    const balanceVal = r.balance ? r.balance.remainder : 0;
    const typeColor = isLoan ? 'var(--warning)' : 'var(--info)';
    const projectName = r.work_title || (r.work_id ? '#' + r.work_id : (isLoan ? 'Личные средства' : ''));

    // Quick actions
    const canReceive = r.status === 'approved' || r.status === 'money_issued';
    const canAddExpense = !isLoan && ['received', 'reporting'].includes(r.status);
    const canReturn = ['received', 'reporting'].includes(r.status) && balanceVal > 0;
    const canReply = r.status === 'question';

    // Progress steps
    const stepsHtml = steps.map((s, i) => {
      let cls = 'cash-step';
      if (isRejected) cls += ' rejected';
      else if (i < currentStep) cls += ' done';
      else if (i === currentStep) cls += ' active';
      return `<div class="${cls}"><div class="cash-step-dot"></div><div class="cash-step-label">${STEP_LABELS[s]}</div></div>`;
    }).join('');

    // Deadline timer for money_issued
    let deadlineHtml = '';
    if (r.status === 'money_issued') {
      deadlineHtml = renderDeadlineTimer(r.receipt_deadline, r.is_overdue);
    }

    // Actions
    let actionsHtml = '';
    const actions = [];
    if (canReceive) actions.push(`<button class="btn green mini" onclick="event.stopPropagation();AsgardCashPage.confirmReceive(${r.id})">Подтвердить получение</button>`);
    if (canAddExpense) actions.push(`<button class="btn primary mini" onclick="event.stopPropagation();AsgardCashPage.showExpenseModal(${r.id})">+ Расход</button>`);
    if (canReturn) actions.push(`<button class="btn amber mini" onclick="event.stopPropagation();AsgardCashPage.showReturnModal(${r.id}, ${balanceVal})">${isLoan ? 'Погасить' : 'Вернуть'}</button>`);
    if (canReply) actions.push(`<button class="btn blue mini" onclick="event.stopPropagation();AsgardCashPage.showReplyModal(${r.id})">Ответить</button>`);
    if (actions.length) {
      actionsHtml = `<div class="cash-card-actions">${actions.join('')}</div>`;
    }

    // Balance display
    let balanceHtml = '';
    if (r.balance) {
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
      <div class="cash-req-card ${isRejected ? 'rejected' : ''} ${isQuestion ? 'question' : ''}" onclick="AsgardCashPage.showDetail(${r.id})">
        <div class="cash-card-top">
          <div class="cash-card-type" style="color:${typeColor}">
            ${isLoan ? '🪙' : '📋'} ${esc(TYPE_LABELS[r.type])}
          </div>
          <div class="cash-card-date">${fmtDate(r.created_at)}</div>
        </div>

        ${projectName ? `<div class="cash-card-project">${esc(projectName)}</div>` : ''}

        <div class="cash-card-amount">${fmtMoney(r.amount)}</div>

        ${isRejected ? `
          <div class="cash-card-rejected">Отклонено${r.director_comment ? ': ' + esc(r.director_comment) : ''}</div>
        ` : isQuestion ? `
          <div class="cash-card-question">Вопрос от директора${r.director_comment ? ': ' + esc(r.director_comment) : ''}</div>
        ` : `
          <div class="cash-steps">${stepsHtml}</div>
        `}

        ${deadlineHtml}
        ${balanceHtml ? `<div class="cash-card-balance">${balanceHtml}</div>` : ''}
        ${actionsHtml}
      </div>
    `;
  }

  function statusCssClass(status) {
    const map = { requested: 'yellow', approved: 'green', money_issued: 'blue', received: 'blue', reporting: 'blue', closed: 'gray', rejected: 'red', question: 'yellow' };
    return map[status] || 'gray';
  }

  // ─────────────────────────────────────────────────────────────────
  // CREATE REQUEST
  // ─────────────────────────────────────────────────────────────────
  function showCreateModal() {
    const worksOptions = '<option value="">-- Выберите проект --</option>' +
      works.map(w => `<option value="${w.id}">${esc(w.work_title || 'Проект #' + w.id)}</option>`).join('');

    showModal({
      title: 'Новая заявка',
      html: `
        <form id="cashCreateForm">
          <div class="asg-form-group">
            <label>Тип</label>
            <select name="type" id="cashType" onchange="AsgardCashPage.onTypeChange()">
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
            <textarea name="cover_letter" rows="2" placeholder="Дополнительная информация"></textarea>
          </div>
          <div class="asg-form-actions">
            <button type="button" class="btn ghost" onclick="AsgardUI.hideModal()">Отмена</button>
            <button type="button" class="btn primary" onclick="AsgardCashPage.submitCreate()">Создать</button>
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
  // DETAIL (modal)
  // ─────────────────────────────────────────────────────────────────
  async function showDetail(id) {
    showModal({
      title: 'Заявка #' + id,
      html: '<div style="text-align:center;padding:24px;color:var(--text-muted)">Загрузка...</div>'
    });

    try {
      const resp = await fetch('/api/cash/' + id, { headers: getHeaders() });
      if (!resp.ok) throw new Error('Ошибка загрузки');
      const req = await resp.json();
      const body = document.getElementById('modalBody');
      if (body) body.innerHTML = renderDetail(req);
    } catch (e) {
      const body = document.getElementById('modalBody');
      if (body) body.innerHTML = `<div style="text-align:center;padding:24px;color:var(--danger)">${esc(e.message)}</div>`;
    }
  }

  function renderDetail(req) {
    const isLoan = req.type === 'loan';
    const canReceive = req.status === 'approved' || req.status === 'money_issued';
    const canAddExpense = !isLoan && ['received', 'reporting'].includes(req.status);
    const canReturn = ['received', 'reporting'].includes(req.status) && req.balance?.remainder > 0;
    const canReply = req.status === 'question';
    const balanceVal = req.balance?.remainder || 0;

    // Progress bar
    const steps = isLoan ? LOAN_STEPS : ADVANCE_STEPS;
    const currentStep = steps.indexOf(req.status);
    const isRejected = req.status === 'rejected';
    const stepsHtml = steps.map((s, i) => {
      let cls = 'cash-step';
      if (isRejected) cls += ' rejected';
      else if (i < currentStep) cls += ' done';
      else if (i === currentStep) cls += ' active';
      return `<div class="${cls}"><div class="cash-step-dot"></div><div class="cash-step-label">${STEP_LABELS[s]}</div></div>`;
    }).join('');

    let html = `
      <div class="cash-steps" style="margin-bottom:20px">${stepsHtml}</div>

      <div class="cash-detail-grid">
        <div>
          <div class="cash-detail-item"><span class="label">Тип</span><span class="value"><span class="status status-${isLoan ? 'yellow' : 'blue'}">${esc(TYPE_LABELS[req.type] || req.type)}</span></span></div>
          <div class="cash-detail-item" style="margin-top:12px"><span class="label">Проект</span><span class="value">${esc(req.work_title || (req.work_id ? '#' + req.work_id : (isLoan ? 'Личные' : '-')))}</span></div>
          <div class="cash-detail-item" style="margin-top:12px"><span class="label">Сумма</span><span class="value" style="font-size:var(--text-lg);color:var(--gold)">${fmtMoney(req.amount)}</span></div>
          <div class="cash-detail-item" style="margin-top:12px"><span class="label">Цель</span><span class="value">${esc(req.purpose)}</span></div>
          ${req.cover_letter ? `<div class="cash-detail-item" style="margin-top:12px"><span class="label">Письмо</span><span class="value">${esc(req.cover_letter)}</span></div>` : ''}
        </div>
        <div>
          <div class="cash-detail-item"><span class="label">Статус</span><span class="value"><span class="status status-${statusCssClass(req.status)}">${esc(STATUS_LABELS[req.status])}</span></span></div>
          <div class="cash-detail-item" style="margin-top:12px"><span class="label">Создано</span><span class="value">${fmtDateTime(req.created_at)}</span></div>
          ${req.director_name ? `<div class="cash-detail-item" style="margin-top:12px"><span class="label">Директор</span><span class="value">${esc(req.director_name)}</span></div>` : ''}
          ${req.director_comment ? `<div class="cash-detail-item" style="margin-top:12px"><span class="label">Комментарий</span><span class="value">${esc(req.director_comment)}</span></div>` : ''}
          ${req.issued_by_name ? `<div class="cash-detail-item" style="margin-top:12px"><span class="label">Выдал</span><span class="value">${esc(req.issued_by_name)}</span></div>` : ''}
          ${req.issued_at ? `<div class="cash-detail-item" style="margin-top:12px"><span class="label">Дата выдачи</span><span class="value">${fmtDateTime(req.issued_at)}</span></div>` : ''}
          ${req.received_at ? `<div class="cash-detail-item" style="margin-top:12px"><span class="label">Получено</span><span class="value">${fmtDateTime(req.received_at)}</span></div>` : ''}
        </div>
      </div>
    `;

    // Deadline timer for money_issued
    if (req.status === 'money_issued' && req.receipt_deadline) {
      const deadline = new Date(req.receipt_deadline);
      const now = new Date();
      if (req.is_overdue) {
        html += `<div class="cash-alert danger" style="margin-top:12px">⚠️ <strong>ПРОСРОЧЕНО!</strong> Дедлайн подтверждения истёк ${fmtDateTime(req.receipt_deadline)}</div>`;
      } else {
        const diff = deadline - now;
        const hours = Math.floor(diff / 3600000);
        const mins = Math.floor((diff % 3600000) / 60000);
        const alertType = hours < 2 ? 'danger' : 'warning';
        html += `<div class="cash-alert ${alertType}" style="margin-top:12px">⏱ Подтвердите получение в течение <strong>${hours}ч ${mins}мин</strong> (до ${fmtDateTime(req.receipt_deadline)})</div>`;
      }
    }

    // Balance
    if (req.balance) {
      const alertType = req.balance.remainder > 0 ? (isLoan ? 'danger' : 'warning') : 'success';
      html += `<div class="cash-alert ${alertType}">`;
      if (isLoan) {
        html += `<strong>Долг:</strong> Получено: ${fmtMoney(req.balance.approved)} | Возвращено: ${fmtMoney(req.balance.returned)} | <strong>${balanceVal > 0 ? 'Осталось: ' + fmtMoney(balanceVal) : 'Погашен'}</strong>`;
      } else {
        html += `<strong>Баланс:</strong> Выдано: ${fmtMoney(req.balance.approved)} | Потрачено: ${fmtMoney(req.balance.spent)} | Возвращено: ${fmtMoney(req.balance.returned)} | <strong>Остаток: ${fmtMoney(balanceVal)}</strong>`;
      }
      html += '</div>';
    }

    // Actions
    const actions = [];
    if (canReceive) actions.push(`<button class="btn green" onclick="AsgardCashPage.confirmReceive(${req.id})">Подтвердить получение</button>`);
    if (canAddExpense) actions.push(`<button class="btn primary" onclick="AsgardCashPage.showExpenseModal(${req.id})">+ Добавить расход</button>`);
    if (canAddExpense) actions.push(`<button class="btn amber" onclick="AsgardCashPage.submitReport(${req.id})">Отчитаться</button>`);
    if (canReturn) actions.push(`<button class="btn ${isLoan ? 'red' : 'amber'}" onclick="AsgardCashPage.showReturnModal(${req.id}, ${balanceVal})">${isLoan ? 'Погасить долг' : 'Вернуть остаток'}</button>`);
    if (canReply) actions.push(`<button class="btn blue" onclick="AsgardCashPage.showReplyModal(${req.id})">Ответить</button>`);
    if (actions.length) {
      html += `<div class="cash-actions">${actions.join('')}</div>`;
    }

    // Expenses with category totals
    if (!isLoan && req.expenses?.length) {
      // Group by category
      const byCat = {};
      req.expenses.forEach(e => {
        const cat = e.category || 'other';
        if (!byCat[cat]) byCat[cat] = 0;
        byCat[cat] += parseFloat(e.amount);
      });

      const catSummary = Object.entries(byCat).map(([cat, sum]) => {
        const catInfo = EXPENSE_CATEGORIES.find(c => c.value === cat) || { icon: '📦', label: cat };
        return `<span class="cash-cat-badge">${catInfo.icon} ${catInfo.label}: ${fmtMoney(sum)}</span>`;
      }).join('');

      html += `<div class="cash-section-title">Расходы (авансовый отчёт)</div>`;
      if (catSummary) html += `<div class="cash-cat-summary">${catSummary}</div>`;
      html += `
        <div style="overflow-x:auto;margin-bottom:16px">
          <table class="tbl">
            <thead><tr><th>Дата</th><th>Категория</th><th>Описание</th><th>Сумма</th><th>Чек</th>${canAddExpense ? '<th></th>' : ''}</tr></thead>
            <tbody>
              ${req.expenses.map(e => {
                const catInfo = EXPENSE_CATEGORIES.find(c => c.value === (e.category || 'other')) || { icon: '📦', label: 'Прочее' };
                return `
                  <tr>
                    <td>${fmtDate(e.expense_date)}</td>
                    <td>${catInfo.icon} ${esc(catInfo.label)}</td>
                    <td>${esc(e.description)}</td>
                    <td>${fmtMoney(e.amount)}</td>
                    <td>${e.receipt_file ? `<a href="/api/cash/${req.id}/receipt/${e.receipt_file}" target="_blank" style="color:var(--gold)">${esc(e.receipt_original_name || 'Чек')}</a>` : '-'}</td>
                    ${canAddExpense ? `<td><button class="btn red mini" onclick="AsgardCashPage.deleteExpense(${req.id}, ${e.id})">Удалить</button></td>` : ''}
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>`;
    }

    // Returns
    if (req.returns?.length) {
      html += `<div class="cash-section-title">Возвраты</div>
        <div style="overflow-x:auto;margin-bottom:16px">
          <table class="tbl">
            <thead><tr><th>Дата</th><th>Сумма</th><th>Комментарий</th><th>Подтверждено</th></tr></thead>
            <tbody>
              ${req.returns.map(r => `
                <tr>
                  <td>${fmtDateTime(r.created_at)}</td>
                  <td>${fmtMoney(r.amount)}</td>
                  <td>${esc(r.note || '-')}</td>
                  <td>${r.confirmed_at ? `${fmtDateTime(r.confirmed_at)}` : '<span class="status status-yellow">Ожидает</span>'}</td>
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
              <div class="meta">${fmtDateTime(m.created_at)} — ${esc(m.user_name)}</div>
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
      const resp = await fetch(`/api/cash/${id}/receive`, { method: 'PUT', headers: getHeaders() });
      if (!resp.ok) { const e = await resp.json(); throw new Error(e.error || 'Ошибка'); }
      toast('Получение подтверждено', '', 'ok');
      await showDetail(id);
      await loadBalance();
      await loadRequests();
    } catch (e) { toast('Ошибка', e.message, 'err'); }
  }

  async function submitReport(id) {
    if (!confirm('Подать авансовый отчёт? Директор будет уведомлён для проверки.')) return;
    try {
      const resp = await fetch(`/api/cash/${id}/submit-report`, { method: 'PUT', headers: getHeaders() });
      if (!resp.ok) { const e = await resp.json(); throw new Error(e.error || 'Ошибка'); }
      toast('Отчёт подан', 'Директор уведомлён', 'ok');
      await showDetail(id);
      await loadRequests();
    } catch (e) { toast('Ошибка', e.message, 'err'); }
  }

  function showExpenseModal(requestId) {
    hideModal();
    setTimeout(() => {
      const categoryOptions = EXPENSE_CATEGORIES.map(c =>
        `<option value="${c.value}">${c.icon} ${c.label}</option>`
      ).join('');

      showModal({
        title: 'Добавить расход',
        html: `
          <form id="cashExpenseForm">
            <input type="hidden" name="request_id" value="${requestId}">
            <div class="asg-form-group">
              <label>Категория</label>
              <select name="category">${categoryOptions}</select>
            </div>
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
              <input type="file" name="receipt" accept="image/*,.pdf" capture="environment">
              <small style="color:var(--text-muted);display:block;margin-top:4px">На телефоне откроется камера</small>
            </div>
            <div class="asg-form-actions">
              <button type="button" class="btn ghost" onclick="AsgardUI.hideModal()">Отмена</button>
              <button type="button" class="btn primary" onclick="AsgardCashPage.submitExpense()">Добавить</button>
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
      if (!resp.ok) { const e = await resp.json(); throw new Error(e.error || 'Ошибка'); }
      hideModal();
      toast('Расход добавлен', '', 'ok');
      await showDetail(parseInt(requestId));
      await loadBalance();
      await loadRequests();
    } catch (e) { toast('Ошибка', e.message, 'err'); }
  }

  async function deleteExpense(requestId, expenseId) {
    if (!confirm('Удалить расход?')) return;
    try {
      const resp = await fetch(`/api/cash/${requestId}/expense/${expenseId}`, { method: 'DELETE', headers: getHeaders() });
      if (!resp.ok) { const e = await resp.json(); throw new Error(e.error || 'Ошибка'); }
      toast('Расход удалён', '', 'ok');
      await showDetail(requestId);
      await loadBalance();
      await loadRequests();
    } catch (e) { toast('Ошибка', e.message, 'err'); }
  }

  function showReturnModal(requestId, remainder) {
    hideModal();
    setTimeout(() => {
      showModal({
        title: 'Вернуть остаток',
        html: `
          <form id="cashReturnForm">
            <input type="hidden" name="request_id" value="${requestId}">
            <div class="cash-alert info" style="margin-bottom:16px">Остаток: <strong>${fmtMoney(remainder)}</strong></div>
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
              <button type="button" class="btn green" onclick="AsgardCashPage.submitReturn()">Вернуть</button>
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
        method: 'POST', headers: getHeaders(),
        body: JSON.stringify({ amount: parseFloat(data.amount), note: data.note || null })
      });
      if (!resp.ok) { const e = await resp.json(); throw new Error(e.error || 'Ошибка'); }
      hideModal();
      toast('Возврат зарегистрирован', '', 'ok');
      await showDetail(parseInt(requestId));
      await loadBalance();
      await loadRequests();
    } catch (e) { toast('Ошибка', e.message, 'err'); }
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
              <button type="button" class="btn primary" onclick="AsgardCashPage.submitReply()">Отправить</button>
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
        method: 'POST', headers: getHeaders(),
        body: JSON.stringify({ message: data.message })
      });
      if (!resp.ok) { const e = await resp.json(); throw new Error(e.error || 'Ошибка'); }
      hideModal();
      toast('Ответ отправлен', '', 'ok');
      await showDetail(parseInt(requestId));
      await loadRequests();
    } catch (e) { toast('Ошибка', e.message, 'err'); }
  }

  // ─────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────
  function fmtMoney(val) {
    return AsgardUI.money(Math.round(Number(val || 0))) + ' \u20BD';
  }

  function fmtDate(val) {
    if (!val) return '-';
    return new Date(val).toLocaleDateString('ru-RU');
  }

  function fmtDateTime(val) {
    if (!val) return '-';
    return new Date(val).toLocaleString('ru-RU');
  }

  return {
    render, showCreateModal, onTypeChange, submitCreate, showDetail,
    confirmReceive, showExpenseModal, submitExpense, deleteExpense, submitReport,
    showReturnModal, submitReturn, showReplyModal, submitReply
  };
})();
