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
    office:  'Офисный расход',
    other:   'Прочее'
  };

  // Stage W — 12 категорий авансового отчёта (CategoryGrid)
  const CASH_CATEGORIES = [
    { code: 'fuel_service',     icon: '⛽', label: 'ГСМ служ.' },
    { code: 'fuel_personal',    icon: '⛽', label: 'ГСМ личн.' },
    { code: 'taxi',             icon: '🚕', label: 'Такси' },
    { code: 'accommodation',    icon: '🏨', label: 'Проживание' },
    { code: 'food_brigade',     icon: '🍲', label: 'Продукты бригаде' },
    { code: 'materials',        icon: '🧱', label: 'Материалы' },
    { code: 'tool',             icon: '🔧', label: 'Инструмент' },
    { code: 'tech_rent',        icon: '🚛', label: 'Аренда техники' },
    { code: 'communication',    icon: '📞', label: 'Связь/интернет' },
    { code: 'representational', icon: '🥂', label: 'Представительские' },
    { code: 'urgent_repair',    icon: '🚨', label: 'Срочный ремонт' },
    { code: 'other',            icon: '📦', label: 'Другое' },
  ];

  // Совместимость старой таблицы расходов авансового отчёта (renderDetail)
  const EXPENSE_CATEGORIES = CASH_CATEGORIES.map(c => ({ value: c.code, label: c.label, icon: c.icon }));

  // Stage W — loan убран; steps только для advance/office/other
  const ADVANCE_STEPS = ['requested', 'approved', 'money_issued', 'received', 'reporting', 'closed'];
  const STEP_LABELS = { requested: 'Заявка', approved: 'Согласов.', money_issued: 'Выдано', received: 'Получено', reporting: 'Отчёт', closed: 'Закрыто' };

  // ─────────────────────────────────────────────────────────────────
  // STAGE W — стили для CategoryGrid + SE-payee блока (one-time)
  // ─────────────────────────────────────────────────────────────────
  (function injectStageWStyles() {
    if (document.getElementById('cash-stagew-styles')) return;
    const s = document.createElement('style');
    s.id = 'cash-stagew-styles';
    s.textContent = `
      .cash-category-grid {
        display:grid; grid-template-columns: repeat(3, 1fr); gap:8px; margin-top:6px;
      }
      @media (max-width:540px) { .cash-category-grid { grid-template-columns: repeat(2, 1fr); } }
      .cash-cat {
        display:flex; flex-direction:column; align-items:center; justify-content:center;
        gap:6px; padding:14px 6px; min-height:78px;
        background: var(--bg3); color: var(--t1, var(--text-primary));
        border:1px solid var(--brd, var(--border)); border-radius: var(--r-md, 10px);
        font-size:12px; font-weight:600; cursor:pointer;
        transition: transform .12s ease, background .12s ease, border-color .12s ease;
      }
      .cash-cat span { display:block; text-align:center; line-height:1.15; font-size:11.5px; }
      .cash-cat .cash-cat-ic { font-size:22px; line-height:1; }
      .cash-cat:hover { transform: scale(1.02); border-color: var(--gold, #c8a849); }
      .cash-cat.active {
        background: var(--blue-bg, #1a2433);
        color: var(--blue, #3b82f6);
        border-color: var(--blue, #3b82f6);
        box-shadow: 0 0 0 2px rgba(59,130,246,.18);
      }
      html[data-theme="light"] .cash-cat { background: #F5F7FA; color: #1F2933; border-color: #E2E8F0; }
      html[data-theme="light"] .cash-cat:hover { background: #ECEFF4; }
      html[data-theme="light"] .cash-cat.active { background: #E3F2FD; color: #1565C0; border-color: #1565C0; }

      .cash-se-block {
        margin-top:10px; padding:12px;
        background: var(--blue-bg, rgba(33,150,243,.08));
        border:1px solid var(--blue, #3b82f6); border-radius: var(--r-md, 10px);
      }
      html[data-theme="light"] .cash-se-block { background: #E3F2FD; border-color: #1565C0; }
      .cash-se-block .cash-se-hint {
        font-size:12px; color: var(--t3, var(--text-muted)); margin-bottom:8px;
      }

      .cash-cat-other-desc { margin-top:8px; }
      .cash-cat-other-desc textarea { min-height:60px; }
    `;
    document.head.appendChild(s);
  })();

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
    // Stage W — тип loan убран; legacy записи рендерим как advance
    const steps = ADVANCE_STEPS;
    const currentStep = steps.indexOf(r.status);
    const isRejected = r.status === 'rejected';
    const isQuestion = r.status === 'question';
    const balanceVal = r.balance ? r.balance.remainder : 0;
    const typeColor = 'var(--info)';
    const projectName = r.work_title || (r.work_id ? '#' + r.work_id : '');

    // Quick actions
    const canReceive = r.status === 'approved' || r.status === 'money_issued';
    const canAddExpense = ['received', 'reporting'].includes(r.status);
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
    if (canReturn) actions.push(`<button class="btn amber mini" onclick="event.stopPropagation();AsgardCashPage.showReturnModal(${r.id}, ${balanceVal})">Вернуть</button>`);
    if (canReply) actions.push(`<button class="btn blue mini" onclick="event.stopPropagation();AsgardCashPage.showReplyModal(${r.id})">Ответить</button>`);
    if (actions.length) {
      actionsHtml = `<div class="cash-card-actions">${actions.join('')}</div>`;
    }

    // Balance display
    let balanceHtml = '';
    if (r.balance) {
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

    const typeLabel = TYPE_LABELS[r.type] || 'Заявка';
    return `
      <div class="cash-req-card ${isRejected ? 'rejected' : ''} ${isQuestion ? 'question' : ''}" onclick="AsgardCashPage.showDetail(${r.id})">
        <div class="cash-card-top">
          <div class="cash-card-type" style="color:${typeColor}">
            📋 ${esc(typeLabel)}
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
  // CREATE REQUEST  (Stage W — CategoryGrid 12 + SE-payee)
  // ─────────────────────────────────────────────────────────────────
  let _selectedCategory = null;       // выбранная категория (code)
  let _useSePayee = false;            // галка «Использовать остаток лимита СЗ»
  let _sePayee = null;                // {id, name, limit_remainder_month}

  function renderCategoryGrid() {
    return `<div class="cash-category-grid" id="cashCatGrid">
      ${CASH_CATEGORIES.map(c => `
        <button type="button" class="cash-cat" data-cat="${c.code}">
          <span class="cash-cat-ic">${c.icon}</span>
          <span>${esc(c.label)}</span>
        </button>
      `).join('')}
    </div>`;
  }

  function showCreateModal() {
    _selectedCategory = null;
    _useSePayee = false;
    _sePayee = null;

    showModal({
      title: 'Новая заявка',
      icon: '💵',
      subtitle: 'Касса',
      html: `
        <form id="cashCreateForm">
          <input type="hidden" name="type" value="advance">

          <div class="asg-form-group" id="cashWorkGroup">
            <label>Проект</label>
            <input type="hidden" name="work_id" id="cashWorkIdHidden" value="">
            <div id="crselect-cashWorkId"></div>
          </div>

          <div class="asg-form-group">
            <label>Категория расхода</label>
            <input type="hidden" name="category" id="cashCategoryHidden" value="">
            ${renderCategoryGrid()}
          </div>

          <div class="asg-form-group cash-cat-other-desc" id="cashCatOtherDescWrap" style="display:none">
            <label>Описание (обязательно для «Другое»)</label>
            <textarea name="category_other_desc" id="cashCategoryOtherDesc" rows="2" placeholder="Подробно опишите цель"></textarea>
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

          <div class="asg-form-group">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="cashUseSePayee" name="use_se_payee">
              <span>Использовать остаток лимита СЗ</span>
            </label>
            <div id="cashSeBlock" class="cash-se-block" style="display:none">
              <div class="cash-se-hint">Бухгалтер переведёт деньги напрямую на СЗ вместо выдачи налом.</div>
              <input type="hidden" name="se_payee_employee_id" id="cashSePayeeId" value="">
              <div id="cashSePayeeAc"></div>
              <div id="cashSePayeeInfo" style="font-size:12px;color:var(--t3,var(--text-muted));margin-top:6px"></div>
            </div>
          </div>

          <div class="asg-form-actions">
            <button type="button" class="btn ghost" onclick="AsgardUI.hideModal()">Отмена</button>
            <button type="button" class="btn primary" onclick="AsgardCashPage.submitCreate()">Создать</button>
          </div>
        </form>
      `
    });

    // CRSelect init — work
    const _workOpts = works.map(w => ({ value: String(w.id), label: esc(w.work_title || 'Проект #' + w.id) }));
    document.getElementById('crselect-cashWorkId')?.appendChild(CRSelect.create({
      id: 'cashWorkId', fullWidth: true, placeholder: 'Выберите проект',
      options: _workOpts,
      onChange: (v) => { document.getElementById('cashWorkIdHidden').value = v; },
    }));

    // CategoryGrid — bind
    const grid = document.getElementById('cashCatGrid');
    if (grid) {
      grid.addEventListener('click', (ev) => {
        const btn = ev.target.closest('.cash-cat');
        if (!btn) return;
        grid.querySelectorAll('.cash-cat').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const code = btn.getAttribute('data-cat');
        _selectedCategory = code;
        document.getElementById('cashCategoryHidden').value = code;
        const wrap = document.getElementById('cashCatOtherDescWrap');
        if (wrap) wrap.style.display = (code === 'other') ? 'block' : 'none';
      });
    }

    // SE-payee checkbox toggle
    const seCb = document.getElementById('cashUseSePayee');
    const seBlock = document.getElementById('cashSeBlock');
    if (seCb && seBlock) {
      seCb.addEventListener('change', () => {
        _useSePayee = seCb.checked;
        seBlock.style.display = _useSePayee ? 'block' : 'none';
        if (!_useSePayee) {
          _sePayee = null;
          document.getElementById('cashSePayeeId').value = '';
          document.getElementById('cashSePayeeInfo').textContent = '';
          const acInp = document.querySelector('#cashSePayeeAc input');
          if (acInp) acInp.value = '';
        }
      });
    }

    // Autocomplete для СЗ-получателя
    mountSeAutocomplete();
  }

  // Стрейт-форвард autocomplete без зависимости от внешних компонентов
  function mountSeAutocomplete() {
    const box = document.getElementById('cashSePayeeAc');
    if (!box) return;
    box.innerHTML = `
      <input type="text" id="cashSePayeeInput" autocomplete="off"
             placeholder="Начните вводить ФИО самозанятого…"
             style="width:100%;padding:8px 10px;border:1px solid var(--brd,var(--border));border-radius:var(--r-sm,6px);background:var(--bg2,var(--bg-surface));color:var(--t1,var(--text-primary))">
      <div id="cashSePayeeMenu" style="position:relative"></div>
    `;
    const inp = document.getElementById('cashSePayeeInput');
    const menu = document.getElementById('cashSePayeeMenu');
    if (!inp) return;
    let timer = null;
    inp.addEventListener('input', () => {
      const q = inp.value.trim();
      clearTimeout(timer);
      if (q.length < 2) { menu.innerHTML = ''; return; }
      timer = setTimeout(async () => {
        try {
          const r = await fetch('/api/employees?is_self_employed=true&search=' + encodeURIComponent(q), { headers: getHeaders() });
          if (!r.ok) { menu.innerHTML = ''; return; }
          const j = await r.json();
          const list = Array.isArray(j) ? j : (j.employees || j.items || []);
          if (!list.length) { menu.innerHTML = `<div style="padding:6px 8px;font-size:12px;color:var(--t3,var(--text-muted))">Не найдено</div>`; return; }
          menu.innerHTML = `<div style="position:absolute;left:0;right:0;top:0;background:var(--bg2,var(--bg-surface));border:1px solid var(--brd,var(--border));border-radius:var(--r-sm,6px);max-height:220px;overflow-y:auto;z-index:10">
            ${list.slice(0,12).map(e => `
              <div data-eid="${e.id}" data-fio="${esc(e.full_name || e.name || '')}"
                   data-limit="${e.se_limit_remainder_month || ''}"
                   style="padding:8px 10px;cursor:pointer;border-bottom:1px solid var(--brd,var(--border));font-size:13px">
                ${esc(e.full_name || e.name || '#' + e.id)}
                ${e.se_limit_remainder_month != null ? `<div style="font-size:11px;color:var(--t3,var(--text-muted))">Лимит остаток: ${fmtMoney(e.se_limit_remainder_month)}</div>` : ''}
              </div>
            `).join('')}
          </div>`;
          menu.querySelectorAll('[data-eid]').forEach(it => {
            it.addEventListener('click', () => {
              const eid = it.getAttribute('data-eid');
              const fio = it.getAttribute('data-fio');
              const lim = it.getAttribute('data-limit');
              _sePayee = { id: parseInt(eid, 10), name: fio, limit_remainder_month: lim ? parseFloat(lim) : null };
              document.getElementById('cashSePayeeId').value = String(_sePayee.id);
              inp.value = fio;
              menu.innerHTML = '';
              const info = document.getElementById('cashSePayeeInfo');
              if (info) info.textContent = (_sePayee.limit_remainder_month != null)
                ? `Остаток лимита СЗ за месяц: ${fmtMoney(_sePayee.limit_remainder_month)}`
                : '';
            });
          });
        } catch (_) { menu.innerHTML = ''; }
      }, 250);
    });
  }

  // (legacy stub — больше не нужно переключать видимость "Проект", но публичный API сохраняем)
  function onTypeChange() { /* no-op после Stage W */ }

  async function submitCreate() {
    const form = document.getElementById('cashCreateForm');
    if (!form) return;
    const data = Object.fromEntries(new FormData(form));

    if (data.type === 'advance' && !data.work_id) {
      toast('Выберите проект', '', 'warn');
      return;
    }

    // Stage W — категория обязательна
    if (!data.category && !_selectedCategory) {
      toast('Выберите категорию', '', 'warn');
      return;
    }
    const category = data.category || _selectedCategory;

    // 'other' → описание обязательно
    if (category === 'other') {
      const desc = (data.category_other_desc || '').trim();
      if (!desc) {
        toast('Опишите расход', 'Для категории «Другое» нужно описание', 'warn');
        return;
      }
    }

    // SE-payee валидации
    const useSe = !!form.querySelector('#cashUseSePayee')?.checked;
    let seEmpId = null;
    if (useSe) {
      seEmpId = parseInt(data.se_payee_employee_id || '0', 10);
      if (!seEmpId) {
        toast('Выберите СЗ-получателя', '', 'warn');
        return;
      }
      if (_sePayee && _sePayee.limit_remainder_month != null
          && parseFloat(data.amount) > _sePayee.limit_remainder_month) {
        toast('Превышен лимит СЗ',
              `Сумма ${fmtMoney(parseFloat(data.amount))} > остатка ${fmtMoney(_sePayee.limit_remainder_month)}`,
              'warn');
        return;
      }
    }

    try {
      const body = {
        type: data.type,
        work_id: data.work_id ? parseInt(data.work_id) : null,
        amount: parseFloat(data.amount),
        purpose: data.purpose,
        cover_letter: data.cover_letter || null,
        category,
        category_other_desc: (category === 'other') ? (data.category_other_desc || '').trim() : null,
        use_se_payee: useSe
      };
      if (useSe) body.se_payee_employee_id = seEmpId;

      const resp = await fetch('/api/cash', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(body)
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
      icon: '💵',
      subtitle: 'Касса',
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
    // Stage W — тип loan убран
    const canReceive = req.status === 'approved' || req.status === 'money_issued';
    const canAddExpense = ['received', 'reporting'].includes(req.status);
    const canReturn = ['received', 'reporting'].includes(req.status) && req.balance?.remainder > 0;
    const canReply = req.status === 'question';
    const balanceVal = req.balance?.remainder || 0;

    // Progress bar
    const steps = ADVANCE_STEPS;
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
          <div class="cash-detail-item"><span class="label">Тип</span><span class="value"><span class="status status-blue">${esc(TYPE_LABELS[req.type] || req.type)}</span></span></div>
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
      const alertType = req.balance.remainder > 0 ? 'warning' : 'success';
      html += `<div class="cash-alert ${alertType}">`;
      html += `<strong>Баланс:</strong> Выдано: ${fmtMoney(req.balance.approved)} | Потрачено: ${fmtMoney(req.balance.spent)} | Возвращено: ${fmtMoney(req.balance.returned)} | <strong>Остаток: ${fmtMoney(balanceVal)}</strong>`;
      html += '</div>';
    }

    // Actions
    const actions = [];
    if (canReceive) actions.push(`<button class="btn green" onclick="AsgardCashPage.confirmReceive(${req.id})">Подтвердить получение</button>`);
    if (canAddExpense) actions.push(`<button class="btn primary" onclick="AsgardCashPage.showExpenseModal(${req.id})">+ Добавить расход</button>`);
    if (canAddExpense) actions.push(`<button class="btn amber" onclick="AsgardCashPage.submitReport(${req.id})">Отчитаться</button>`);
    if (canReturn) actions.push(`<button class="btn amber" onclick="AsgardCashPage.showReturnModal(${req.id}, ${balanceVal})">Вернуть остаток</button>`);
    if (canReply) actions.push(`<button class="btn blue" onclick="AsgardCashPage.showReplyModal(${req.id})">Ответить</button>`);
    if (actions.length) {
      html += `<div class="cash-actions">${actions.join('')}</div>`;
    }

    // Expenses with category totals
    if (req.expenses?.length) {
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
        icon: '💵',
        subtitle: 'Касса',
        html: `
          <form id="cashExpenseForm">
            <input type="hidden" name="request_id" value="${requestId}">
            <div class="asg-form-group">
              <label>Категория</label>
              <input type="hidden" name="category" id="cashCategoryHidden" value="${EXPENSE_CATEGORIES[0]?.value || ''}">
              <div id="crselect-cashCategory"></div>
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

      // CRSelect init — expense category
      const _catOpts = EXPENSE_CATEGORIES.map(c => ({ value: c.value, label: c.icon + ' ' + c.label }));
      document.getElementById('crselect-cashCategory')?.appendChild(CRSelect.create({
        id: 'cashCategory', fullWidth: true, value: EXPENSE_CATEGORIES[0]?.value || '',
        options: _catOpts,
        onChange: (v) => { document.getElementById('cashCategoryHidden').value = v; },
      }));
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
        icon: '💵',
        subtitle: 'Касса',
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
        icon: '💵',
        subtitle: 'Касса',
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
