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
      .cash-cat:hover { transform: scale(1.02); border-color: var(--gold, var(--warn)); }
      .cash-cat.active {
        background: var(--info-bg);
        color: var(--info);
        border-color: var(--info);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--info) 18%, transparent);
      }
      html[data-theme="light"] .cash-cat { background: var(--bg2); color: var(--t1); border-color: var(--brd); }
      html[data-theme="light"] .cash-cat:hover { background: var(--bg3); }
      html[data-theme="light"] .cash-cat.active { background: var(--info-bg); color: var(--info); border-color: var(--info); }

      .cash-se-block {
        margin-top:10px; padding:12px;
        background: var(--info-bg);
        border:1px solid var(--info); border-radius: var(--r-md, 10px);
      }
      html[data-theme="light"] .cash-se-block { background: var(--info-bg); border-color: var(--info); }
      .cash-se-block .cash-se-hint {
        font-size:12px; color: var(--t3, var(--text-muted)); margin-bottom:8px;
      }

      .cash-cat-other-desc { margin-top:8px; }
      .cash-cat-other-desc textarea { min-height:60px; }
    `;
    document.head.appendChild(s);
  })();

  let currentRequests = [];
  let currentHandovers = [];     // 2026-06-27 — handovers (worker_to_pm)
  let sourceFilter = 'all';      // 'all' | 'cash_request' | 'handover'
  let currentPage = 1, pageSize = 20;
  let works = [];

  // ─── Выписка РП (Statement) state — 2026-06-29 ─────────────────────────
  let activeTab = 'requests';            // 'requests' | 'statement'
  let stmtFrom = null;                   // YYYY-MM-DD (default = 1-е число тек. месяца)
  let stmtTo = null;                     // YYYY-MM-DD (default = сегодня)
  let stmtPmId = null;                   // выбранный PM (только для админ-ролей)
  let stmtPmList = [];                   // [{id, full_name, role}]
  let stmtData = null;                   // {pm, period, summary, operations}
  let stmtLoading = false;
  let stmtError = null;
  let stmtTypeFilter = 'all';            // 'all' | 'income' | 'outflow'
  let stmtSourceFilter = 'all';          // 'all' | <source key>
  let stmtDownloading = false;
  // 2026-06-29 — фильтр «Скрыть справочные» (info-строки bank/se/auto)
  let stmtHideInfo = false;

  // 2026-06-29 — карта source_kind → label + chip-стили (одинаково с модалкой)
  // pm_cash_legacy склеиваем с pm_cash
  const STMT_SOURCE_KIND_LABEL = {
    pm_cash:      '📤 Моя касса',
    company_bank: '🏦 Банк компании',
    company_se:   '📱 СЗ-сервис',
    auto_fot:     '⚙ Авто-ФОТ',
    other:        '· Прочее'
  };
  function _stmtNormSourceKind(sk) {
    if (sk === 'pm_cash_legacy') return 'pm_cash';
    return sk || null;
  }

  const STMT_SOURCE_LABEL = {
    handover:        '💵 От СЗ',
    cash_request:    '🏦 Касса',
    cash_return:     '↩ Возврат',
    worker_payment:  '🧑‍🔧 Рабочему',
    work_expense:    '🧱 Расход',
    cash_expense:    '📦 Прочее'
  };
  const STMT_CATEGORY_GROUPS = [
    { key: 'handover',       label: '💵 От СЗ' },
    { key: 'cash_request',   label: '🏦 Касса' },
    { key: 'cash_return',    label: '↩ Возвраты' },
    { key: 'worker_payment', label: '🧑‍🔧 ЗП/суточные' },
    { key: 'work_expense',   label: '🧱 Материалы' },
    { key: 'cash_expense',   label: '📦 Прочее' }
  ];
  const STMT_WP_TYPE_LABEL = {
    salary:   'Зарплата',
    per_diem: 'Суточные',
    bonus:    'Премии',
    advance:  'Авансы',
    penalty:  'Удержания'
  };
  const STMT_ADMIN_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'BUH'];

  function _stmtDefaultPeriod() {
    const today = new Date();
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    return { from: fmt(first), to: fmt(today) };
  }

  function _stmtCurrentRole() {
    try {
      const auth = AsgardAuth.getAuth();
      return (auth && auth.user && auth.user.role) || '';
    } catch (_) { return ''; }
  }

  function _stmtCurrentUserId() {
    try {
      const auth = AsgardAuth.getAuth();
      return (auth && auth.user && auth.user.id) || null;
    } catch (_) { return null; }
  }

  function _stmtCanPickPm() {
    return STMT_ADMIN_ROLES.includes(_stmtCurrentRole());
  }

  // ─── styles for statement tab (one-time, only CSS-tokens, обе темы) ────
  (function injectStatementStyles() {
    if (document.getElementById('cash-statement-styles')) return;
    const s = document.createElement('style');
    s.id = 'cash-statement-styles';
    s.textContent = `
      .cash-tabbar {
        display:flex; gap:6px; flex-wrap:wrap;
        border-bottom:1px solid var(--brd, var(--border));
        margin:8px 0 12px;
      }
      .cash-tab {
        padding:8px 14px; font-size:13px; font-weight:600;
        background:transparent; color: var(--t2, var(--text-secondary));
        border:1px solid transparent; border-bottom:none;
        border-radius: var(--r-sm, 6px) var(--r-sm, 6px) 0 0;
        cursor:pointer;
      }
      .cash-tab:hover { color: var(--t1, var(--text-primary)); background: var(--bg3, var(--bg-elevated)); }
      .cash-tab.active {
        color: var(--info, var(--text-primary));
        background: var(--bg2, var(--bg-surface));
        border-color: var(--brd, var(--border));
        border-bottom-color: var(--bg2, var(--bg-surface));
        position: relative; top: 1px;
      }

      .stmt-wrap { display:flex; flex-direction:column; gap:12px; }
      .stmt-controls {
        display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end;
        padding:12px;
        background: var(--bg2, var(--bg-surface));
        border:1px solid var(--brd, var(--border));
        border-radius: var(--r-md, 8px);
      }
      .stmt-control { display:flex; flex-direction:column; gap:4px; }
      .stmt-control-label {
        font-size:11px; font-weight:600; color: var(--t2, var(--text-secondary));
        text-transform:uppercase; letter-spacing:.5px;
      }
      .stmt-control input, .stmt-control select {
        padding:7px 10px; min-width:160px;
        background: var(--bg3, var(--bg-elevated));
        color: var(--t1, var(--text-primary));
        border:1px solid var(--brd, var(--border));
        border-radius: var(--r-sm, 6px);
        font-size:13px;
      }
      .stmt-control-actions { display:flex; gap:8px; margin-left:auto; }

      .stmt-empty {
        padding:30px; text-align:center;
        color: var(--t2, var(--text-secondary));
        background: var(--bg2, var(--bg-surface));
        border:1px dashed var(--brd-m, var(--border));
        border-radius: var(--r-md, 8px);
      }
      .stmt-empty.err {
        color: var(--err, var(--danger));
        border-color: var(--err, var(--danger));
        background: var(--err-bg, transparent);
      }

      .stmt-pm-head {
        display:flex; justify-content:space-between; align-items:center; gap:10px;
        padding:10px 14px;
        background: var(--bg2, var(--bg-surface));
        border:1px solid var(--brd, var(--border));
        border-radius: var(--r-md, 8px);
      }
      .stmt-pm-name { font-size:15px; font-weight:700; color: var(--t1, var(--text-primary)); }
      .stmt-pm-period { font-size:13px; color: var(--t2, var(--text-secondary)); }

      .stmt-grid {
        display:grid;
        grid-template-columns: repeat(3, 1fr);
        gap:12px;
      }
      @media (max-width: 900px) { .stmt-grid { grid-template-columns: 1fr; } }
      .stmt-sum {
        padding:14px;
        background: var(--bg2, var(--bg-surface));
        border:1px solid var(--brd, var(--border));
        border-radius: var(--r-md, 8px);
        display:flex; flex-direction:column; gap:8px;
      }
      .stmt-sum.tone-income {
        background: var(--ok-bg, var(--bg2));
        border-color: var(--ok, var(--success));
      }
      .stmt-sum.tone-outflow {
        background: var(--err-bg, var(--bg2));
        border-color: var(--err, var(--danger));
      }
      .stmt-sum.tone-balance { font-weight:700; }
      .stmt-sum-title {
        font-size:11px; font-weight:700;
        color: var(--t2, var(--text-secondary));
        text-transform:uppercase; letter-spacing:.5px;
      }
      .stmt-sum.tone-income  .stmt-sum-title { color: var(--ok-t, var(--ok)); }
      .stmt-sum.tone-outflow .stmt-sum-title { color: var(--err-t, var(--err)); }
      .stmt-sum-total {
        font-size:22px; font-weight:800;
        color: var(--t1, var(--text-primary));
      }
      .stmt-sum.tone-income  .stmt-sum-total { color: var(--ok, var(--success)); }
      .stmt-sum.tone-outflow .stmt-sum-total { color: var(--err, var(--danger)); }
      .stmt-sum-rows { display:flex; flex-direction:column; gap:3px; margin-top:4px; }
      .stmt-sum-row {
        display:flex; justify-content:space-between; gap:8px;
        font-size:12px; color: var(--t2, var(--text-secondary));
      }
      .stmt-sum-row-v { font-weight:600; color: var(--t1, var(--text-primary)); }

      .stmt-filters {
        display:flex; gap:6px; flex-wrap:wrap;
      }
      .stmt-chip {
        padding:6px 12px; font-size:12px; font-weight:600;
        background: var(--bg2, var(--bg-surface));
        color: var(--t2, var(--text-secondary));
        border:1px solid var(--brd, var(--border));
        border-radius: 999px;
        cursor:pointer;
      }
      .stmt-chip:hover { color: var(--t1, var(--text-primary)); }
      .stmt-chip.active {
        background: var(--info-bg, var(--bg3));
        color: var(--info, var(--text-primary));
        border-color: var(--info, var(--brd));
      }
      .stmt-chip[disabled] { opacity:.5; cursor:not-allowed; }

      .stmt-table-wrap {
        max-height: 60vh; overflow:auto;
        border:1px solid var(--brd, var(--border));
        border-radius: var(--r-md, 8px);
        background: var(--bg2, var(--bg-surface));
      }
      .stmt-table {
        width:100%; border-collapse:collapse; font-size:13px;
      }
      .stmt-table thead th {
        position:sticky; top:0; z-index:1;
        background: var(--bg3, var(--bg-elevated));
        color: var(--t2, var(--text-secondary));
        font-weight:700; font-size:11px;
        text-transform:uppercase; letter-spacing:.5px;
        text-align:left; padding:10px 12px;
        border-bottom:1px solid var(--brd, var(--border));
      }
      .stmt-table th.num, .stmt-table td.num { text-align:right; font-variant-numeric: tabular-nums; }
      .stmt-table tbody td {
        padding:8px 12px;
        border-bottom:1px solid var(--brd-m, var(--brd, var(--border)));
        color: var(--t1, var(--text-primary));
        vertical-align:top;
      }
      .stmt-row-income td { background: var(--ok-bg, transparent); }
      .stmt-row-outflow td { background: var(--err-bg, transparent); }
      .stmt-row-income:hover td, .stmt-row-outflow:hover td { filter: brightness(0.98); }

      .stmt-amt { font-weight:700; }
      .stmt-amt-income  { color: var(--ok, var(--success)); }
      .stmt-amt-outflow { color: var(--err, var(--danger)); }

      .stmt-badge {
        display:inline-block; padding:2px 8px; border-radius: 999px;
        font-size:11px; font-weight:600; white-space:nowrap;
        border:1px solid transparent;
      }
      .stmt-badge-income {
        background: var(--ok-bg, transparent);
        color: var(--ok-t, var(--ok));
        border-color: var(--ok, var(--success));
      }
      .stmt-badge-outflow {
        background: var(--err-bg, transparent);
        color: var(--err-t, var(--err));
        border-color: var(--err, var(--danger));
      }
      .stmt-cell-desc { max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .stmt-cell-work { color: var(--t2, var(--text-secondary)); font-size:12px; }
      .stmt-cell-bal { font-weight:700; color: var(--t1, var(--text-primary)); }

      /* 2026-06-29 — Источник денег (chip + info-строки) */
      .stmt-row-info td {
        background: var(--bg2);
        opacity: 0.55;
        font-style: italic;
      }
      .stmt-badge-info {
        background: var(--bg3);
        color: var(--t2);
        border-color: var(--brd);
      }
      .stmt-src-chip {
        display:inline-block; padding:2px 8px; border-radius: 999px;
        font-size:11px; font-weight:600; white-space:nowrap;
        border:1px solid transparent;
      }
      .stmt-src-chip.src-pm-cash    { background: var(--ok-bg);     color: var(--ok);     border-color: var(--ok); }
      .stmt-src-chip.src-bank       { background: var(--blue-bg);   color: var(--blue);   border-color: var(--blue); }
      .stmt-src-chip.src-se         { background: var(--purple-bg); color: var(--purple); border-color: var(--purple); }
      .stmt-src-chip.src-auto       { background: var(--gold-bg);   color: var(--gold);   border-color: var(--gold); }
      .stmt-src-chip.src-other      { background: var(--bg3);       color: var(--t2);     border-color: var(--brd); }
      .stmt-src-chip.src-none       { color: var(--t3); border:1px dashed var(--brd-m); }

      .stmt-info-toggle {
        display:inline-flex; align-items:center; gap:6px;
        margin-left:auto;
        font-size:12px; color: var(--t2);
        cursor:pointer; user-select:none;
        padding:6px 10px;
        border:1px solid var(--brd); border-radius: var(--r-sm);
        background: var(--bg2);
      }
      .stmt-info-toggle:hover { color: var(--t1); }
      .stmt-info-toggle input { cursor:pointer; }
    `;
    document.head.appendChild(s);
  })();

  // ─────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────
  async function render(container) {
    currentPage = 1; pageSize = window.AsgardPagination ? AsgardPagination.getPageSize() : 20;

    // init statement defaults once per render
    if (!stmtFrom || !stmtTo) {
      const dp = _stmtDefaultPeriod();
      stmtFrom = stmtFrom || dp.from;
      stmtTo = stmtTo || dp.to;
    }
    if (!_stmtCanPickPm()) {
      stmtPmId = _stmtCurrentUserId();
    }

    container.innerHTML = `
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <h1>Казна Дружины</h1>
          <p style="color:var(--text-muted);font-size:var(--text-sm);margin:0">Авансы, расходы и расчёты</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn primary" onclick="AsgardCashPage.showCreateModal()">+ Новая заявка</button>
          <button class="btn ghost" onclick="AsgardCashPage.showManualHandoverModal()">📥 Получил нал от СЗ</button>
        </div>
      </div>

      <div class="cash-tabbar" id="cash-tabbar">
        <button class="cash-tab ${activeTab === 'requests' ? 'active' : ''}" data-tab="requests">📋 Заявки и история</button>
        <button class="cash-tab ${activeTab === 'statement' ? 'active' : ''}" data-tab="statement">📋 Выписка</button>
      </div>

      <div id="cash-tab-requests" style="${activeTab === 'requests' ? '' : 'display:none'}">
        <div id="cash-balance-widget"></div>
        <div id="cash-source-filter" style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0"></div>
        <div id="cash-requests-list">
          <div style="text-align:center;padding:40px;color:var(--text-muted)">Загрузка...</div>
        </div>
      </div>

      <div id="cash-tab-statement" style="${activeTab === 'statement' ? '' : 'display:none'}">
        <div id="cash-statement-root"></div>
      </div>
    `;

    // bind tabs
    container.querySelectorAll('#cash-tabbar [data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.getAttribute('data-tab');
        switchTab(t);
      });
    });

    renderSourceFilter();
    await loadBalance();
    await loadWorks();
    await Promise.all([loadRequests(), loadHandovers()]);
    renderMerged();

    if (activeTab === 'statement') {
      renderStatementTab();
      loadStatement().catch(() => {});
    }
  }

  function switchTab(tab) {
    activeTab = tab;
    const reqEl = document.getElementById('cash-tab-requests');
    const stmtEl = document.getElementById('cash-tab-statement');
    document.querySelectorAll('#cash-tabbar [data-tab]').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });
    if (reqEl) reqEl.style.display = (tab === 'requests') ? '' : 'none';
    if (stmtEl) stmtEl.style.display = (tab === 'statement') ? '' : 'none';
    if (tab === 'statement') {
      renderStatementTab();
      // load PMs list once for admin roles
      if (_stmtCanPickPm() && !stmtPmList.length) {
        loadStatementPmList().then(() => renderStatementTab()).catch(() => {});
      }
      if (stmtData == null && (!_stmtCanPickPm() || stmtPmId)) {
        loadStatement().catch(() => {});
      }
    }
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

      // Толерантный fallback: новые поля могут отсутствовать на старом бэке
      const advances    = Number(d.cash_advances_issued ?? d.issued ?? 0);
      const handovers   = Number(d.handovers_received ?? 0);
      const returns     = Number(d.cash_returns_confirmed ?? d.returned ?? 0);
      const retPending  = Number(d.cash_returns_pending ?? 0);
      const payouts     = Number(d.cash_payouts_workers ?? d.spent ?? 0);
      const balance     = Number(d.balance ?? (advances + handovers - returns - payouts));

      widget.innerHTML = `
        <div class="cash-balance-grid">
          <div class="cash-balance-card ${balance > 0 ? 'danger' : 'secondary'}" style="grid-column:span 2">
            <div class="balance-value" style="font-size:24px">${fmtMoney(balance)}</div>
            <div class="balance-label">Текущий баланс</div>
          </div>
          <div class="cash-balance-card info">
            <div class="balance-value">${fmtMoney(advances)}</div>
            <div class="balance-label">💼 Авансы из кассы</div>
          </div>
          <div class="cash-balance-card success">
            <div class="balance-value">${fmtMoney(handovers)}</div>
            <div class="balance-label">💵 От СЗ</div>
          </div>
          <div class="cash-balance-card warning">
            <div class="balance-value">${fmtMoney(returns + retPending)}</div>
            <div class="balance-label">❌ Возвраты${retPending > 0 ? ` <span style="font-size:10px;opacity:.7">(${fmtMoney(retPending)} ожидают BUH)</span>` : ''}</div>
          </div>
          <div class="cash-balance-card secondary">
            <div class="balance-value">${fmtMoney(payouts)}</div>
            <div class="balance-label">🧑‍🔧 Выдано рабочим</div>
          </div>
        </div>
      `;
    } catch (e) {
      console.error('loadBalance', e);
    }
  }

  async function loadHandovers() {
    try {
      const resp = await fetch('/api/handovers', { headers: getHeaders() });
      if (!resp.ok) { currentHandovers = []; return; }
      const data = await resp.json();
      currentHandovers = Array.isArray(data) ? data : (data.handovers || data.items || []);
    } catch (e) {
      console.warn('loadHandovers fallback (endpoint unavailable):', e?.message || e);
      currentHandovers = [];
    }
  }

  function renderSourceFilter() {
    const box = document.getElementById('cash-source-filter');
    if (!box) return;
    const chips = [
      { v: 'all',           label: 'Все' },
      { v: 'cash_request',  label: '🏦 Касса' },
      { v: 'handover',      label: '💵 От СЗ' }
    ];
    box.innerHTML = chips.map(c =>
      `<button class="btn ${sourceFilter === c.v ? 'primary' : 'ghost'} mini" data-src="${c.v}">${esc(c.label)}</button>`
    ).join('');
    box.querySelectorAll('[data-src]').forEach(b => {
      b.addEventListener('click', () => {
        sourceFilter = b.getAttribute('data-src');
        renderSourceFilter();
        renderMerged();
      });
    });
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
      renderMerged();
    } catch (e) {
      console.error('loadRequests', e);
      const el = document.getElementById('cash-requests-list');
      if (el) el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger)">Ошибка загрузки</div>';
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 2026-06-27 — MERGED RENDERER: cash_requests + handovers, фильтр по источнику
  // ─────────────────────────────────────────────────────────────────
  function renderMerged() {
    const container = document.getElementById('cash-requests-list');
    if (!container) return;

    const items = [];
    if (sourceFilter === 'all' || sourceFilter === 'cash_request') {
      currentRequests.forEach(r => items.push({ __source: 'cash_request', __sortDate: r.created_at, data: r }));
    }
    if (sourceFilter === 'all' || sourceFilter === 'handover') {
      currentHandovers.forEach(h => items.push({ __source: 'handover', __sortDate: h.received_at || h.created_at, data: h }));
    }

    if (!items.length) {
      container.innerHTML = AsgardUI.emptyState({ icon: '💰', title: 'Нет записей', desc: 'Создайте заявку или зафиксируйте получение нала от СЗ' });
      return;
    }

    // Только cash_requests рендерим как карточки (старая UX); handovers — компактные строки.
    // Сортируем cash_requests по статусам как раньше, handovers — снизу как «История от СЗ».
    let html = '';

    const cashReqs = items.filter(x => x.__source === 'cash_request').map(x => x.data);
    const handovers = items.filter(x => x.__source === 'handover').map(x => x.data);

    if (cashReqs.length) {
      const active = cashReqs.filter(r => !['closed', 'rejected'].includes(r.status));
      const done   = cashReqs.filter(r => ['closed', 'rejected'].includes(r.status));
      if (active.length) {
        html += `<div class="cash-section-title" style="margin-top:0">
          <span style="display:inline-block;padding:2px 8px;border-radius:var(--r-sm,4px);background:var(--info-bg);color:var(--info-t);font-size:11px;font-weight:600;margin-right:6px">🏦 Касса</span>
          Активные заявки
        </div>`;
        html += `<div class="cash-cards-grid">${active.map(renderCard).join('')}</div>`;
      }
      if (done.length) {
        html += `<div class="cash-section-title">
          <span style="display:inline-block;padding:2px 8px;border-radius:var(--r-sm,4px);background:var(--info-bg);color:var(--info-t);font-size:11px;font-weight:600;margin-right:6px">🏦 Касса</span>
          Завершённые
        </div>`;
        html += `<div class="cash-cards-grid">${done.map(renderCard).join('')}</div>`;
      }
    }

    if (handovers.length) {
      html += `<div class="cash-section-title">
        <span style="display:inline-block;padding:2px 8px;border-radius:var(--r-sm,4px);background:var(--ok-bg);color:var(--ok-t);font-size:11px;font-weight:600;margin-right:6px">💵 От СЗ</span>
        Получено от самозанятых
      </div>`;
      html += `<div style="overflow-x:auto;border:1px solid var(--brd,var(--border));border-radius:var(--r-md,8px);background:var(--bg2,var(--bg-surface))">
        <table class="tbl" style="width:100%">
          <thead><tr>
            <th style="text-align:left;padding:8px 10px">Дата</th>
            <th style="text-align:left;padding:8px 10px">Источник</th>
            <th style="text-align:left;padding:8px 10px">СЗ</th>
            <th style="text-align:left;padding:8px 10px">Сумма</th>
            <th style="text-align:left;padding:8px 10px">Статус</th>
            <th style="text-align:left;padding:8px 10px">Заметка</th>
          </tr></thead>
          <tbody>
            ${handovers.map(h => `
              <tr>
                <td style="padding:8px 10px">${fmtDateTime(h.received_at || h.created_at)}</td>
                <td style="padding:8px 10px"><span style="padding:2px 6px;border-radius:var(--r-sm,4px);background:var(--ok-bg);color:var(--ok-t);font-size:11px;font-weight:600">💵 От СЗ</span></td>
                <td style="padding:8px 10px"><b>${esc(h.worker_fio || h.worker_name || ('#' + (h.worker_id || '')))}</b></td>
                <td style="padding:8px 10px"><b>${fmtMoney(h.received_amount || h.expected_amount || h.amount)}</b></td>
                <td style="padding:8px 10px"><span class="status status-${h.status === 'received' ? 'green' : 'yellow'}">${esc(h.status === 'received' ? 'Получено' : (h.status === 'pending' ? 'Ожидает' : (h.status || '—')))}</span></td>
                <td style="padding:8px 10px">${esc(h.note || h.comment || '—')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
    }

    container.innerHTML = html;

    // Pagination — только по cash_requests (как было), не считаем handovers
    if (window.AsgardPagination && cashReqs.length) {
      let pgEl = document.getElementById('cash_pagination');
      if (!pgEl) { pgEl = document.createElement('div'); pgEl.id = 'cash_pagination'; container.after(pgEl); }
      pgEl.innerHTML = AsgardPagination.renderControls(cashReqs.length, currentPage, pageSize);
      AsgardPagination.attachHandlers('cash_pagination',
        (p) => { currentPage = p; renderMerged(); },
        (s) => { pageSize = s; currentPage = 1; renderMerged(); }
      );
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
  // 2026-06-27 — MANUAL HANDOVER (📥 Получил нал от СЗ)
  // ─────────────────────────────────────────────────────────────────
  let _manualSeWorker = null;     // {id, name}

  async function showManualHandoverModal() {
    showModal({
      title: 'Получил нал от СЗ',
      icon: '📥',
      subtitle: 'Касса',
      html: `
        <form id="cashManualHandoverForm">
          <div class="asg-form-group">
            <label>Самозанятый</label>
            <input type="hidden" name="worker_id" id="manualHandoverWorkerId" value="">
            <input type="text" id="manualHandoverWorkerInput" autocomplete="off"
                   placeholder="Начните вводить ФИО…"
                   style="width:100%;padding:8px 10px;border:1px solid var(--brd,var(--border));border-radius:var(--r-sm,6px);background:var(--bg2,var(--bg-surface));color:var(--t1,var(--text-primary))">
            <div id="manualHandoverWorkerMenu" style="position:relative"></div>
            <div id="manualHandoverHint" style="font-size:12px;color:var(--text-muted);margin-top:6px"></div>
          </div>

          <div class="asg-form-group">
            <label>Сумма</label>
            <input type="number" name="amount" step="0.01" min="0.01" required placeholder="0.00">
          </div>

          <div class="asg-form-group">
            <label>Работа (опционально)</label>
            <input type="hidden" name="work_id" id="manualHandoverWorkIdHidden" value="">
            <div id="crselect-manualHandoverWorkId"></div>
          </div>

          <div class="asg-form-group">
            <label>Заметка (опционально)</label>
            <textarea name="note" rows="2" placeholder="Напр.: Передал лично, наличными"></textarea>
          </div>

          <div class="asg-form-actions">
            <button type="button" class="btn ghost" onclick="AsgardUI.hideModal()">Отмена</button>
            <button type="button" class="btn primary" onclick="AsgardCashPage.submitManualHandover()">Зафиксировать</button>
          </div>
        </form>
      `
    });

    _manualSeWorker = null;

    // CRSelect для работы (тот же набор что и в основной форме)
    const workOpts = works.map(w => ({ value: String(w.id), label: esc(w.work_title || 'Проект #' + w.id) }));
    if (window.CRSelect) {
      document.getElementById('crselect-manualHandoverWorkId')?.appendChild(CRSelect.create({
        id: 'manualHandoverWorkId', fullWidth: true, placeholder: 'Выберите работу (опц.)', clearable: true,
        options: workOpts,
        onChange: (v) => { document.getElementById('manualHandoverWorkIdHidden').value = v || ''; }
      }));
    }

    // Autocomplete по СЗ + проверка pending handover
    const inp = document.getElementById('manualHandoverWorkerInput');
    const menu = document.getElementById('manualHandoverWorkerMenu');
    const hint = document.getElementById('manualHandoverHint');
    let timer = null;
    if (!inp) return;
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
          if (!list.length) {
            menu.innerHTML = `<div style="padding:6px 8px;font-size:12px;color:var(--text-muted)">Не найдено</div>`;
            return;
          }
          menu.innerHTML = `<div style="position:absolute;left:0;right:0;top:0;background:var(--bg2,var(--bg-surface));border:1px solid var(--brd,var(--border));border-radius:var(--r-sm,6px);max-height:220px;overflow-y:auto;z-index:10">
            ${list.slice(0,12).map(e => `
              <div data-eid="${e.id}" data-fio="${esc(e.full_name || e.name || '')}"
                   style="padding:8px 10px;cursor:pointer;border-bottom:1px solid var(--brd,var(--border));font-size:13px">
                ${esc(e.full_name || e.name || '#' + e.id)}
              </div>
            `).join('')}
          </div>`;
          menu.querySelectorAll('[data-eid]').forEach(it => {
            it.addEventListener('click', async () => {
              const eid = it.getAttribute('data-eid');
              const fio = it.getAttribute('data-fio');
              _manualSeWorker = { id: parseInt(eid, 10), name: fio };
              document.getElementById('manualHandoverWorkerId').value = String(_manualSeWorker.id);
              inp.value = fio;
              menu.innerHTML = '';
              if (hint) hint.textContent = 'Проверяю pending handover…';
              // Проверка существующих pending handovers (толерантно)
              try {
                const now = new Date();
                const cr = await fetch(`/api/handovers?worker_id=${_manualSeWorker.id}&status=pending&year=${now.getFullYear()}&month=${now.getMonth()+1}`, { headers: getHeaders() });
                if (cr.ok) {
                  const d = await cr.json();
                  const arr = Array.isArray(d) ? d : (d.handovers || d.items || []);
                  if (arr.length && hint) {
                    const tot = arr.reduce((s,x) => s + Number(x.expected_amount || x.amount || 0), 0);
                    hint.innerHTML = `<span style="color:var(--warning,var(--warn-t))">⚠ Уже есть pending handover на ${fmtMoney(tot)}. Лучше подтвердить его в /my-timesheet → Передачи. Эта запись будет отдельной.</span>`;
                  } else if (hint) {
                    hint.textContent = '';
                  }
                } else if (hint) {
                  hint.textContent = '';
                }
              } catch (_) { if (hint) hint.textContent = ''; }
            });
          });
        } catch (_) { menu.innerHTML = ''; }
      }, 250);
    });
  }

  async function submitManualHandover() {
    const form = document.getElementById('cashManualHandoverForm');
    if (!form) return;
    const data = Object.fromEntries(new FormData(form));
    const workerId = parseInt(data.worker_id || '0', 10);
    const amount = parseFloat(data.amount);
    if (!workerId) { toast('Выберите СЗ', '', 'warn'); return; }
    if (!amount || amount <= 0) { toast('Укажите сумму > 0', '', 'warn'); return; }

    const now = new Date();
    const body = {
      worker_id: workerId,
      work_id: data.work_id ? parseInt(data.work_id, 10) : null,
      amount,
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      note: (data.note || '').trim() || null
    };
    try {
      const resp = await fetch('/api/handovers/manual', {
        method: 'POST', headers: getHeaders(),
        body: JSON.stringify(body)
      });
      if (!resp.ok) {
        const er = await resp.json().catch(() => ({}));
        throw new Error(er.error || ('HTTP ' + resp.status));
      }
      const result = await resp.json().catch(() => ({}));
      hideModal();
      if (result.warning) {
        toast('Зафиксировано', `+${fmtMoney(amount)} · ${result.warning}`, 'ok');
      } else {
        toast('Зафиксировано', `+${fmtMoney(amount)} получено от СЗ`, 'ok');
      }
      await loadBalance();
      await loadHandovers();
      renderMerged();
    } catch (e) {
      toast('Ошибка', e.message, 'err');
    }
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

  // ─────────────────────────────────────────────────────────────────
  // STATEMENT TAB — 2026-06-29
  // /api/cash/statement — банковская выписка РП
  // ─────────────────────────────────────────────────────────────────
  async function loadStatementPmList() {
    try {
      const r = await fetch('/api/users?role=PM&is_active=true&limit=500', { headers: getHeaders() });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      const allUsers = (d && (d.users || d.items)) || (Array.isArray(d) ? d : []);
      const pmRoles = ['PM', 'HEAD_PM'];
      stmtPmList = allUsers
        .filter(u => pmRoles.includes(u.role))
        .map(u => ({ id: u.id, full_name: u.full_name || u.name || u.fio || ('#' + u.id), role: u.role }));
      // fallback — если фильтр по role на бэке не работает, попробуем без него
      if (!stmtPmList.length) {
        const r2 = await fetch('/api/users?is_active=true&limit=1000', { headers: getHeaders() });
        if (r2.ok) {
          const d2 = await r2.json();
          const u2 = (d2 && (d2.users || d2.items)) || (Array.isArray(d2) ? d2 : []);
          stmtPmList = u2.filter(u => pmRoles.includes(u.role))
            .map(u => ({ id: u.id, full_name: u.full_name || u.name || u.fio || ('#' + u.id), role: u.role }));
        }
      }
    } catch (e) {
      console.warn('loadStatementPmList', e);
      stmtPmList = [];
    }
  }

  async function loadStatement() {
    // RBAC: для админ-ролей нужен выбранный pm_id, иначе 400 на бэке
    if (_stmtCanPickPm() && !stmtPmId) {
      stmtData = null;
      stmtError = null;
      renderStatementTab();
      return;
    }
    stmtLoading = true;
    stmtError = null;
    renderStatementTab();
    try {
      const q = new URLSearchParams({ from: stmtFrom, to: stmtTo });
      if (stmtPmId && _stmtCanPickPm()) q.set('pm_id', String(stmtPmId));
      const r = await fetch('/api/cash/statement?' + q.toString(), { headers: getHeaders() });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new Error(t || ('HTTP ' + r.status));
      }
      stmtData = await r.json();
    } catch (e) {
      console.error('loadStatement', e);
      stmtError = (e && e.message) || 'Ошибка загрузки';
      stmtData = null;
      toast('Ошибка', 'Не удалось загрузить выписку: ' + stmtError, 'err');
    } finally {
      stmtLoading = false;
      renderStatementTab();
    }
  }

  async function downloadStatementXlsx() {
    if (_stmtCanPickPm() && !stmtPmId) {
      toast('Выберите РП', '', 'warn');
      return;
    }
    if (stmtDownloading) return;
    stmtDownloading = true;
    renderStatementTab();
    try {
      const q = new URLSearchParams({ format: 'xlsx', from: stmtFrom, to: stmtTo });
      if (stmtPmId && _stmtCanPickPm()) q.set('pm_id', String(stmtPmId));
      const r = await fetch('/api/cash/statement?' + q.toString(), { headers: getHeaders() });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new Error(t || ('HTTP ' + r.status));
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const pmName = ((stmtData && stmtData.pm && stmtData.pm.name) || 'PM').replace(/[\\/:*?"<>|]/g, '_');
      a.download = 'Выписка_' + pmName + '_' + stmtFrom + '_' + stmtTo + '.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error('downloadStatementXlsx', e);
      toast('Ошибка', 'Не удалось скачать: ' + ((e && e.message) || e), 'err');
    } finally {
      stmtDownloading = false;
      renderStatementTab();
    }
  }

  function _stmtBreakdown(ops) {
    const result = {
      from_se: 0, from_cash: 0,
      returns: 0, salary: 0, per_diem: 0, bonus: 0, advance: 0, penalty: 0,
      work_exp: 0, cash_exp: 0
    };
    for (const op of (ops || [])) {
      const amt = Math.abs(Number(op.amount || 0));
      if (op.source === 'handover') result.from_se += amt;
      else if (op.source === 'cash_request') result.from_cash += amt;
      else if (op.source === 'cash_return') result.returns += amt;
      else if (op.source === 'work_expense') result.work_exp += amt;
      else if (op.source === 'cash_expense') result.cash_exp += amt;
      else if (op.source === 'worker_payment') {
        const c = op.category;
        if (c === 'salary') result.salary += amt;
        else if (c === 'per_diem') result.per_diem += amt;
        else if (c === 'bonus') result.bonus += amt;
        else if (c === 'advance') result.advance += amt;
        else if (c === 'penalty') result.penalty += amt;
        else result.salary += amt;
      }
    }
    return result;
  }

  function _stmtSumRow(label, value, negative) {
    if (!value) return '';
    const sign = negative ? '−' : '';
    return `<div class="stmt-sum-row">
      <span>${esc(label)}</span>
      <span class="stmt-sum-row-v">${sign}${fmtMoney(Math.abs(Number(value || 0)))}</span>
    </div>`;
  }

  function renderStatementTab() {
    const root = document.getElementById('cash-statement-root');
    if (!root) return;

    const canPick = _stmtCanPickPm();
    const pmOptions = stmtPmList.map(p =>
      `<option value="${p.id}" ${String(p.id) === String(stmtPmId) ? 'selected' : ''}>${esc(p.full_name)}</option>`
    ).join('');

    const controlsHtml = `
      <div class="stmt-controls">
        ${canPick ? `
          <div class="stmt-control">
            <label class="stmt-control-label" for="stmtPmSelect">РП</label>
            <select id="stmtPmSelect">
              <option value="">— выберите РП —</option>
              ${pmOptions}
            </select>
          </div>
        ` : ''}
        <div class="stmt-control">
          <label class="stmt-control-label" for="stmtFromInp">С</label>
          <input type="date" id="stmtFromInp" value="${esc(stmtFrom)}">
        </div>
        <div class="stmt-control">
          <label class="stmt-control-label" for="stmtToInp">По</label>
          <input type="date" id="stmtToInp" value="${esc(stmtTo)}">
        </div>
        <div class="stmt-control stmt-control-actions">
          <button class="btn ghost mini" id="stmtRefreshBtn" ${stmtLoading ? 'disabled' : ''}>↻ Обновить</button>
          <button class="btn primary mini" id="stmtDownloadBtn"
            ${stmtLoading || stmtDownloading || (canPick && !stmtPmId) ? 'disabled' : ''}>
            ${stmtDownloading ? '⏳ Готовим…' : '📥 Скачать XLSX'}
          </button>
        </div>
      </div>
    `;

    let bodyHtml = '';
    if (stmtLoading) {
      bodyHtml = `<div class="stmt-empty">⏳ Загружаем выписку…</div>`;
    } else if (canPick && !stmtPmId) {
      bodyHtml = `<div class="stmt-empty">Выберите РП в селекторе выше, чтобы увидеть выписку.</div>`;
    } else if (stmtError && !stmtData) {
      bodyHtml = `<div class="stmt-empty err">⚠ Ошибка: ${esc(stmtError)}</div>`;
    } else if (stmtData) {
      const ops = stmtData.operations || [];
      const summary = stmtData.summary || {};
      const bd = _stmtBreakdown(ops);

      const counts = { all: ops.length, income: 0, outflow: 0 };
      const srcCounts = {};
      for (const g of STMT_CATEGORY_GROUPS) srcCounts[g.key] = 0;
      for (const op of ops) {
        if (op.type === 'income') counts.income++;
        else if (op.type === 'outflow') counts.outflow++;
        if (srcCounts[op.source] != null) srcCounts[op.source]++;
      }

      // 2026-06-29 — info-строки можно скрыть чекбоксом «☑ Скрыть справочные»
      const filteredOps = ops.filter(op => {
        if (stmtHideInfo && op.type === 'info') return false;
        if (stmtTypeFilter !== 'all' && op.type !== stmtTypeFilter) return false;
        if (stmtSourceFilter !== 'all' && op.source !== stmtSourceFilter) return false;
        return true;
      });
      const infoCount = ops.reduce((s, o) => s + (o.type === 'info' ? 1 : 0), 0);

      const closing = Number(summary.closing_balance || 0);
      const openingSign = Number(summary.opening_balance || 0) >= 0 ? '+' : '−';

      bodyHtml = `
        <div class="stmt-pm-head">
          <div class="stmt-pm-name">${esc((stmtData.pm && stmtData.pm.name) || 'РП')}</div>
          <div class="stmt-pm-period">${fmtDate(stmtData.period && stmtData.period.from)} — ${fmtDate(stmtData.period && stmtData.period.to)}</div>
        </div>

        <div class="stmt-grid">
          <div class="stmt-sum tone-income">
            <div class="stmt-sum-title">Приход за период</div>
            <div class="stmt-sum-total">+${fmtMoney(Math.abs(Number(summary.total_in || 0)))}</div>
            <div class="stmt-sum-rows">
              ${_stmtSumRow('От СЗ', bd.from_se, false)}
              ${_stmtSumRow('Аванс из кассы', bd.from_cash, false)}
            </div>
          </div>
          <div class="stmt-sum tone-outflow">
            <div class="stmt-sum-title">Расход за период</div>
            <div class="stmt-sum-total">−${fmtMoney(Math.abs(Number(summary.total_out || 0)))}</div>
            <div class="stmt-sum-rows">
              ${_stmtSumRow('Возвраты',        bd.returns,  true)}
              ${_stmtSumRow('Зарплата',        bd.salary,   true)}
              ${_stmtSumRow('Суточные',        bd.per_diem, true)}
              ${_stmtSumRow('Премии',          bd.bonus,    true)}
              ${_stmtSumRow('Авансы',          bd.advance,  true)}
              ${_stmtSumRow('Удержания',       bd.penalty,  true)}
              ${_stmtSumRow('Расходы проекта', bd.work_exp, true)}
              ${_stmtSumRow('Прочее',          bd.cash_exp, true)}
            </div>
          </div>
          <div class="stmt-sum tone-balance">
            <div class="stmt-sum-title">Остаток на конец</div>
            <div class="stmt-sum-total">${closing >= 0 ? '+' : '−'}${fmtMoney(Math.abs(closing))}</div>
            <div class="stmt-sum-rows">
              <div class="stmt-sum-row">
                <span>На начало периода</span>
                <span class="stmt-sum-row-v">${openingSign}${fmtMoney(Math.abs(Number(summary.opening_balance || 0)))}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="stmt-filters" role="tablist" aria-label="Фильтр операций">
          <button class="stmt-chip ${stmtTypeFilter === 'all' ? 'active' : ''}" data-type-filter="all">Все · ${counts.all}</button>
          <button class="stmt-chip ${stmtTypeFilter === 'income' ? 'active' : ''}" data-type-filter="income">⬆ Приходы · ${counts.income}</button>
          <button class="stmt-chip ${stmtTypeFilter === 'outflow' ? 'active' : ''}" data-type-filter="outflow">⬇ Расходы · ${counts.outflow}</button>
        </div>

        <div class="stmt-filters" role="group" aria-label="Фильтр по источнику">
          <button class="stmt-chip ${stmtSourceFilter === 'all' ? 'active' : ''}" data-src-filter="all">Все источники</button>
          ${STMT_CATEGORY_GROUPS.map(g =>
            `<button class="stmt-chip ${stmtSourceFilter === g.key ? 'active' : ''}"
                     data-src-filter="${g.key}" ${!srcCounts[g.key] ? 'disabled' : ''}
                     title="${!srcCounts[g.key] ? 'Нет операций этого типа' : ''}">
              ${esc(g.label)} · ${srcCounts[g.key] || 0}
            </button>`
          ).join('')}
          <!-- 2026-06-29 — переключатель отображения info-строк (bank/se/auto) -->
          <label class="stmt-info-toggle" title="Скрыть справочные операции (банк, СЗ-сервис, авто-ФОТ — деньги компании, не из вашей кассы)">
            <input type="checkbox" id="stmtHideInfoChk" ${stmtHideInfo ? 'checked' : ''}>
            <span>☑ Скрыть справочные${infoCount ? ' (' + infoCount + ')' : ''}</span>
          </label>
        </div>

        <div class="stmt-table-wrap">
          ${filteredOps.length === 0 ? `
            <div class="stmt-empty" style="border:none;background:transparent">Нет операций по выбранным фильтрам</div>
          ` : `
            <table class="stmt-table">
              <thead><tr>
                <th>Дата</th>
                <th>Тип</th>
                <th class="num">Сумма</th>
                <th>Категория</th>
                <th>Источник</th>
                <th>Описание</th>
                <th>Работа</th>
                <th class="num">Баланс</th>
              </tr></thead>
              <tbody>
                ${filteredOps.map(op => renderStatementRow(op)).join('')}
              </tbody>
            </table>
          `}
        </div>
      `;
    } else {
      bodyHtml = `<div class="stmt-empty">Нет данных. Нажмите «Обновить».</div>`;
    }

    root.innerHTML = `<div class="stmt-wrap">${controlsHtml}${bodyHtml}</div>`;

    // bind controls
    const pmSel = document.getElementById('stmtPmSelect');
    if (pmSel) {
      pmSel.addEventListener('change', () => {
        const v = pmSel.value;
        stmtPmId = v ? parseInt(v, 10) : null;
        stmtData = null;
        loadStatement().catch(() => {});
      });
    }
    const fromInp = document.getElementById('stmtFromInp');
    if (fromInp) {
      fromInp.addEventListener('change', () => {
        const v = fromInp.value;
        if (v) stmtFrom = v;
        loadStatement().catch(() => {});
      });
    }
    const toInp = document.getElementById('stmtToInp');
    if (toInp) {
      toInp.addEventListener('change', () => {
        const v = toInp.value;
        if (v) stmtTo = v;
        loadStatement().catch(() => {});
      });
    }
    const refreshBtn = document.getElementById('stmtRefreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', () => loadStatement().catch(() => {}));
    const dlBtn = document.getElementById('stmtDownloadBtn');
    if (dlBtn) dlBtn.addEventListener('click', () => downloadStatementXlsx());

    root.querySelectorAll('[data-type-filter]').forEach(b => {
      b.addEventListener('click', () => {
        stmtTypeFilter = b.getAttribute('data-type-filter');
        renderStatementTab();
      });
    });
    root.querySelectorAll('[data-src-filter]').forEach(b => {
      b.addEventListener('click', () => {
        if (b.hasAttribute('disabled')) return;
        stmtSourceFilter = b.getAttribute('data-src-filter');
        renderStatementTab();
      });
    });
    // 2026-06-29 — переключатель «Скрыть справочные»
    const hideInfoChk = document.getElementById('stmtHideInfoChk');
    if (hideInfoChk) {
      hideInfoChk.addEventListener('change', () => {
        stmtHideInfo = !!hideInfoChk.checked;
        renderStatementTab();
      });
    }
  }

  function renderStatementRow(op) {
    // 2026-06-29 — info-строки: тип «ℹ инфо», opacity 0.55, не меняют running
    const isInfo = op.type === 'info';
    const isIncome = op.type === 'income';
    const amt = Math.abs(Number(op.amount || 0));
    const sign = isInfo ? '' : (isIncome ? '+' : '−');
    const rowCls = isInfo ? 'stmt-row-info' : (isIncome ? 'stmt-row-income' : 'stmt-row-outflow');
    const badgeCls = isInfo ? 'stmt-badge-info' : (isIncome ? 'stmt-badge-income' : 'stmt-badge-outflow');
    const amtCls = isInfo ? '' : (isIncome ? 'stmt-amt-income' : 'stmt-amt-outflow');
    const typeLabel = isInfo
      ? 'ℹ инфо'
      : (STMT_SOURCE_LABEL[op.source] || op.source || '—');

    let categoryLabel = op.category || '—';
    if (op.source === 'worker_payment' && STMT_WP_TYPE_LABEL[op.category]) {
      categoryLabel = STMT_WP_TYPE_LABEL[op.category];
    }

    // 2026-06-29 — chip «Источник»: source_kind (новый) → label/класс
    const sk = _stmtNormSourceKind(op.source_kind);
    let srcChip;
    if (sk === 'pm_cash') {
      srcChip = '<span class="stmt-src-chip src-pm-cash">📤 Моя касса</span>';
    } else if (sk === 'company_bank') {
      srcChip = '<span class="stmt-src-chip src-bank">🏦 Банк компании</span>';
    } else if (sk === 'company_se') {
      srcChip = '<span class="stmt-src-chip src-se">📱 СЗ-сервис</span>';
    } else if (sk === 'auto_fot') {
      srcChip = '<span class="stmt-src-chip src-auto">⚙ Авто-ФОТ</span>';
    } else if (sk === 'other') {
      srcChip = '<span class="stmt-src-chip src-other">· Прочее</span>';
    } else {
      // Если бэк не вернул source_kind (старая запись/приход) — мягкий fallback
      srcChip = '<span class="stmt-src-chip src-none">—</span>';
    }

    const workLabel = op.work_title || (op.work_id ? '#' + op.work_id : '—');
    const desc = op.description || '—';
    const balAfter = (op.balance_after != null) ? fmtMoney(op.balance_after) : '—';

    return `
      <tr class="${rowCls}">
        <td>${fmtDate(op.date)}</td>
        <td><span class="stmt-badge ${badgeCls}">${esc(typeLabel)}</span></td>
        <td class="num stmt-amt ${amtCls}">${sign}${fmtMoney(amt)}</td>
        <td>${esc(categoryLabel)}</td>
        <td>${srcChip}</td>
        <td class="stmt-cell-desc" title="${esc(desc)}">${esc(desc)}</td>
        <td class="stmt-cell-work">${esc(workLabel)}</td>
        <td class="num stmt-cell-bal">${balAfter}</td>
      </tr>
    `;
  }

  return {
    render, showCreateModal, onTypeChange, submitCreate, showDetail,
    confirmReceive, showExpenseModal, submitExpense, deleteExpense, submitReport,
    showReturnModal, submitReturn, showReplyModal, submitReply,
    // 2026-06-27 — manual handover (📥 Получил нал от СЗ)
    showManualHandoverModal, submitManualHandover,
    // 2026-06-29 — statement tab (Выписка РП)
    switchTab, loadStatement, downloadStatementXlsx, renderStatementTab
  };
})();
