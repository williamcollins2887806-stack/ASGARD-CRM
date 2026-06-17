/**
 * ASGARD CRM — Личный канбан с подэтапами (Vanilla desktop — Волна 4а)
 * См. PERSONAL_KANBAN_AND_INBOX_PIPELINE.md §4.1.
 *
 * Регистрация: app.js NAV + MOTTOS + AsgardRouter.add('/personal-kanban').
 * API:       /api/personal-kanban/* (Wave-2 backend).
 * Темы:      только CSS-vars (design-tokens.css + light-theme.css).
 * DnD:       native HTML5 (как в funnel.js).
 */
window.AsgardPersonalKanbanPage = (function () {
  const { $, $$, esc, toast, showModal, hideModal, emptyState, formatDateTime } = AsgardUI;

  // ── Канонические main_status × flow_type (зеркало backend §9.1) ───────
  const FLOWS = [
    {
      key: 'application', label: 'Заявки', icon: '📥',
      mainStatuses: ['new', 'ai_processed', 'under_review', 'assigned', 'accepted', 'rejected', 'archived'],
      mainLabels: {
        new: 'Новые', ai_processed: 'AI обработана', under_review: 'На рассмотрении',
        assigned: 'Назначены', accepted: 'Приняты', rejected: 'Отклонены', archived: 'Архив'
      }
    },
    {
      key: 'tender', label: 'Тендеры', icon: '📋',
      mainStatuses: [
        'Черновик', 'Новый', 'На анализе', 'Отправлено на просчёт', 'Согласование ТКП',
        'ТКП согласовано', 'Готово к отправке КП', 'КП отправлено', 'Выиграли', 'Проиграли', 'Не подходит'
      ]
    },
    {
      key: 'pre_tender', label: 'Пре-тендеры', icon: '🗂',
      mainStatuses: [
        'new', 'in_review', 'need_docs', 'accepted', 'rejected', 'expired',
        'pending_approval', 'approved', 'pending_payment', 'paid',
        'cash_issued', 'cash_received', 'expense_reported'
      ],
      mainLabels: {
        new: 'Новый', in_review: 'На рассмотрении', need_docs: 'Нужны документы',
        accepted: 'Принят', rejected: 'Отклонён', expired: 'Просрочен',
        pending_approval: 'Ожидает согласования', approved: 'Согласован',
        pending_payment: 'Ожидает оплаты', paid: 'Оплачен',
        cash_issued: 'Деньги выданы', cash_received: 'Деньги получены',
        expense_reported: 'Отчёт сдан'
      }
    },
    {
      key: 'work', label: 'Работы', icon: '🏗',
      mainStatuses: ['Новая', 'Подготовка', 'Мобилизация', 'В работе', 'На паузе', 'Подписание акта', 'Работы сдали', 'Закрыт']
    }
  ];

  // Палитра цвета substage (как в backend — HEX)
  const COLOR_PALETTE = [
    '#8a93a6', '#5b8def', '#27ae60', '#f39c12',
    '#c8a84e', '#e67e22', '#9b59b6', '#e74c3c'
  ];

  // Шаблон «Подготовка ТКП» — batch INSERT (см. §3.2 mobile)
  const TEMPLATE_TKP = [
    'Входящая заявка', 'Созвон с клиентом', 'Получение доп. информации',
    'Осмотр объекта', 'Расчёт ТКП', 'Согласование с директором'
  ];

  // ── Состояние ────────────────────────────────────────────────────────
  let _flowKey = 'application';      // активный flow_type
  let _mainStatus = null;            // активный main_status в табе (горизонт. scroll)
  let _substages = [];               // полный список подэтапов user
  let _cards = [];                   // полный список карт user
  let _userPmList = null;            // кэш PM/HEAD_PM для transfer
  let _user = null;
  let _layout = null;
  let _sseHandler = null;            // удерживаем ссылку для cleanup

  // ── HTTP helpers ─────────────────────────────────────────────────────
  async function _authHeaders() {
    const token = localStorage.getItem('asgard_token') || '';
    return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };
  }

  async function api(path, opts) {
    opts = opts || {};
    const headers = await _authHeaders();
    if (opts.headers) Object.assign(headers, opts.headers);
    const res = await fetch('/api/personal-kanban' + path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    return { ok: res.ok, status: res.status, data };
  }

  async function apiInbox(path, opts) {
    opts = opts || {};
    const headers = await _authHeaders();
    if (opts.headers) Object.assign(headers, opts.headers);
    const init = { method: opts.method || 'GET', headers };
    if (opts.body && !opts.isFormData) init.body = JSON.stringify(opts.body);
    if (opts.body && opts.isFormData) {
      delete headers['Content-Type'];
      init.body = opts.body;
    }
    const res = await fetch('/api/inbox-applications' + path, init);
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    return { ok: res.ok, status: res.status, data };
  }

  // ── CSS (инжект однократный) ─────────────────────────────────────────
  function _injectStyles() {
    if (document.getElementById('asg-pk-styles')) return;
    const css = `
.pk-page{padding:8px 4px}
.pk-head{display:flex;flex-direction:column;gap:10px;margin-bottom:14px}
.pk-tabs{display:flex;gap:6px;flex-wrap:wrap}
.pk-tab{background:var(--bg-card);color:var(--text-secondary);border:1px solid var(--border);border-radius:10px;padding:8px 14px;cursor:pointer;font-size:13px;font-weight:600;font-family:var(--font-sans);transition:all .18s ease}
.pk-tab:hover{color:var(--text-primary);border-color:var(--gold-border, var(--border))}
.pk-tab.active{background:var(--gold-bg);color:var(--gold);border-color:var(--gold)}
.pk-tab .pk-tab-ico{margin-right:6px;opacity:.85}
.pk-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.pk-actions .btn{font-family:var(--font-sans)}
.pk-statusbar{display:flex;gap:4px;overflow-x:auto;padding:6px 2px;border-bottom:1px solid var(--border);scrollbar-width:thin}
.pk-statusbar::-webkit-scrollbar{height:6px}
.pk-statusbar::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
.pk-status-chip{flex:0 0 auto;padding:7px 14px;border-radius:8px;background:transparent;color:var(--text-secondary);border:1px solid transparent;cursor:pointer;font-size:13px;font-weight:600;white-space:nowrap;transition:all .15s ease}
.pk-status-chip:hover{color:var(--text-primary);background:var(--bg-elevated)}
.pk-status-chip.active{background:var(--bg-card);color:var(--gold);border-color:var(--gold-border, var(--border))}
.pk-status-chip .pk-status-count{margin-left:6px;font-size:11px;color:var(--text-secondary);font-weight:700}
.pk-status-chip.active .pk-status-count{color:var(--gold)}

.pk-board{display:flex;gap:14px;overflow-x:auto;padding:14px 2px;align-items:flex-start;min-height:380px}
.pk-col{flex:0 0 300px;display:flex;flex-direction:column;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;min-height:200px;max-height:calc(100vh - 250px)}
.pk-col-head{padding:10px 12px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;border-top-left-radius:12px;border-top-right-radius:12px}
.pk-col-color{width:8px;height:24px;border-radius:4px;flex:0 0 auto}
.pk-col-title{font-weight:700;color:var(--text-primary);font-size:13px;font-family:var(--font-sans);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pk-col-count{font-size:11px;color:var(--text-secondary);font-weight:700;background:var(--bg-elevated);padding:2px 8px;border-radius:10px}
.pk-col-body{flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:8px;min-height:80px}
.pk-col-body.pk-drop-hover{background:var(--gold-bg)}

.pk-card{background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;padding:10px 12px;cursor:grab;transition:transform .15s ease, box-shadow .15s ease, border-color .15s ease}
.pk-card:hover{border-color:var(--gold-border, var(--border));box-shadow:0 4px 14px rgba(0,0,0,.12)}
.pk-card:active{cursor:grabbing}
.pk-card.pk-dragging{opacity:.5;transform:scale(.96)}
.pk-card-title{font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:6px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pk-card-meta{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:11px;color:var(--text-secondary)}
.pk-card-kind{padding:1px 6px;border-radius:6px;background:var(--bg-card);font-weight:600}
.pk-card-stale{color:var(--amber,#D4A843)}
.pk-card-stale::before{content:"●";margin-right:3px}
.pk-card-transferred{font-size:11px;color:var(--gold);background:var(--gold-bg);padding:2px 6px;border-radius:4px;margin-top:6px;display:inline-block}

.pk-empty{padding:32px 16px;text-align:center;color:var(--text-secondary);font-size:13px;font-family:var(--font-sans)}
.pk-empty .pk-empty-cta{margin-top:10px}

.pk-skeleton{display:flex;gap:14px;padding:14px 2px}
.pk-skeleton .pk-skel-col{flex:0 0 300px;height:240px;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;position:relative;overflow:hidden}
.pk-skeleton .pk-skel-col::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg, transparent, var(--bg-elevated), transparent);animation:pk-shimmer 1.4s infinite}
@keyframes pk-shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}

/* Конфигуратор */
.pk-cfg-list{display:flex;flex-direction:column;gap:8px;margin-bottom:14px}
.pk-cfg-row{display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;cursor:grab}
.pk-cfg-row.pk-cfg-drag{opacity:.5}
.pk-cfg-handle{color:var(--text-secondary);font-weight:700;cursor:grab;font-size:14px}
.pk-cfg-color{width:18px;height:18px;border-radius:50%;border:2px solid var(--border);cursor:pointer;flex:0 0 auto}
.pk-cfg-title{flex:1;background:transparent;border:none;color:var(--text-primary);font-size:13px;font-weight:600;font-family:var(--font-sans);outline:none}
.pk-cfg-title:focus{border-bottom:1px dashed var(--gold)}
.pk-cfg-actions{display:flex;gap:4px}
.pk-cfg-btn{background:transparent;border:1px solid var(--border);color:var(--text-secondary);border-radius:6px;width:28px;height:28px;cursor:pointer;font-size:13px;font-family:var(--font-sans)}
.pk-cfg-btn:hover{color:var(--text-primary);border-color:var(--gold-border, var(--border))}
.pk-cfg-btn.danger:hover{color:var(--red, #e74c3c);border-color:var(--red, #e74c3c)}

.pk-color-pop{display:flex;gap:6px;padding:8px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;flex-wrap:wrap}
.pk-color-pop button{width:24px;height:24px;border-radius:50%;border:2px solid transparent;cursor:pointer}
.pk-color-pop button:hover{border-color:var(--gold)}

.pk-cfg-newrow{display:flex;gap:8px;align-items:center;padding-top:10px;border-top:1px solid var(--border)}
.pk-cfg-newrow input[type=text]{flex:1;background:var(--bg-elevated);border:1px solid var(--border);color:var(--text-primary);border-radius:8px;padding:8px 10px;font-size:13px;font-family:var(--font-sans)}
.pk-cfg-newrow input[type=text]:focus{outline:none;border-color:var(--gold)}
.pk-cfg-tplbar{margin:14px 0;padding:10px 12px;background:var(--gold-bg);border:1px dashed var(--gold);border-radius:8px;font-size:12px;color:var(--text-secondary)}

/* История/заметки/напоминания */
.pk-tline{display:flex;flex-direction:column;gap:8px;max-height:380px;overflow-y:auto;padding-right:6px}
.pk-tline-item{padding:8px 10px;background:var(--bg-elevated);border-left:3px solid var(--gold);border-radius:6px;font-size:12px;color:var(--text-primary)}
.pk-tline-item.pk-tline-note{border-left-color:var(--blue, #5b8def)}
.pk-tline-meta{font-size:11px;color:var(--text-secondary);margin-bottom:4px}

/* Director Inbox общие */
.di-page{padding:8px 4px}
.di-filters{display:flex;gap:6px;flex-wrap:wrap;margin:14px 0}
.di-filter{padding:7px 12px;border-radius:8px;background:var(--bg-card);color:var(--text-secondary);border:1px solid var(--border);cursor:pointer;font-size:13px;font-weight:600;font-family:var(--font-sans)}
.di-filter.active{background:var(--gold-bg);color:var(--gold);border-color:var(--gold)}
.di-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;margin-top:14px}
.di-card{background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px;transition:border-color .18s ease, box-shadow .18s ease}
.di-card:hover{border-color:var(--gold-border, var(--border));box-shadow:0 4px 14px rgba(0,0,0,.10)}
.di-card-row{display:flex;justify-content:space-between;align-items:center;gap:8px}
.di-card-title{font-weight:700;color:var(--text-primary);font-size:14px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.di-color-badge{flex:0 0 auto;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700}
.di-color-green{background:var(--green-glow,rgba(39,174,96,.18));color:var(--green,#27ae60)}
.di-color-yellow{background:var(--amber-glow,rgba(243,156,18,.18));color:var(--amber,#D4A843)}
.di-color-red{background:var(--red-glow,rgba(231,76,60,.18));color:var(--red,#C8293B)}
.di-color-gray{background:var(--bg-elevated);color:var(--text-secondary)}
.di-summary{font-size:12px;color:var(--text-secondary);line-height:1.4;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.di-meta{font-size:11px;color:var(--text-secondary);display:flex;gap:10px;flex-wrap:wrap}
.di-card-actions{display:flex;gap:6px;margin-top:4px;flex-wrap:wrap}
.di-card-actions .btn{font-size:12px;padding:6px 10px}

/* Универсальное */
.pk-form-grp{margin-bottom:12px}
.pk-form-grp label{display:block;font-size:12px;color:var(--text-secondary);margin-bottom:4px;font-weight:600;font-family:var(--font-sans)}
.pk-form-grp input,.pk-form-grp textarea,.pk-form-grp select{width:100%;background:var(--bg-elevated);border:1px solid var(--border);color:var(--text-primary);border-radius:8px;padding:8px 10px;font-size:13px;font-family:var(--font-sans);box-sizing:border-box}
.pk-form-grp input:focus,.pk-form-grp textarea:focus,.pk-form-grp select:focus{outline:none;border-color:var(--gold)}
.pk-modal-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--border)}

@media (max-width: 768px){
  .pk-col{flex:0 0 270px}
  .di-grid{grid-template-columns:1fr}
}
`;
    const st = document.createElement('style');
    st.id = 'asg-pk-styles';
    st.textContent = css;
    document.head.appendChild(st);
  }

  // ── Загрузка данных ──────────────────────────────────────────────────
  async function loadAll() {
    const [subRes, cardRes] = await Promise.all([
      api('/substages'),
      api('/cards')
    ]);
    _substages = (subRes.ok && subRes.data && subRes.data.items) ? subRes.data.items : [];
    _cards = (cardRes.ok && cardRes.data && cardRes.data.items) ? cardRes.data.items : [];
  }

  async function loadPmList() {
    if (_userPmList) return _userPmList;
    const headers = await _authHeaders();
    const all = [];
    for (const role of ['PM', 'HEAD_PM']) {
      try {
        const r = await fetch(`/api/users?role=${role}&is_active=true&limit=200`, { headers });
        if (r.ok) {
          const j = await r.json();
          for (const u of (j.users || [])) all.push(u);
        }
      } catch (e) {}
    }
    _userPmList = all;
    return all;
  }

  // ── Утилиты ──────────────────────────────────────────────────────────
  function getFlow(key) { return FLOWS.find(f => f.key === key) || FLOWS[0]; }

  function mainStatusLabel(flowKey, ms) {
    const flow = getFlow(flowKey);
    return (flow.mainLabels && flow.mainLabels[ms]) || ms;
  }

  function entityLabel(card) {
    const kind = card.entity_kind;
    if (kind === 'inbox_application') return 'Заявка';
    if (kind === 'tender') return 'Тендер';
    if (kind === 'pre_tender') return 'Пре-тендер';
    if (kind === 'work') return 'Работа';
    return kind || '—';
  }

  function isStale(card) {
    if (!card.last_moved_at) return false;
    const t = new Date(card.last_moved_at).getTime();
    if (!t || isNaN(t)) return false;
    const days = (Date.now() - t) / (1000 * 60 * 60 * 24);
    return days > 5;
  }

  function getSubstagesFor(flowKey, mainStatus) {
    return _substages.filter(s => s.flow_type === flowKey && s.main_status === mainStatus && s.is_active);
  }

  function getCardsFor(flowKey, mainStatus) {
    return _cards.filter(c => c.flow_type === flowKey && c.current_main_status === mainStatus && !c.is_closed);
  }

  function countCardsForFlow(flowKey) {
    return _cards.filter(c => c.flow_type === flowKey && !c.is_closed).length;
  }

  function cardsBySubstage(flowKey, mainStatus) {
    const subs = getSubstagesFor(flowKey, mainStatus);
    const cards = getCardsFor(flowKey, mainStatus);
    const map = new Map();
    for (const s of subs) map.set(s.id, []);
    const unplaced = [];
    for (const c of cards) {
      if (c.current_substage_id && map.has(c.current_substage_id)) {
        map.get(c.current_substage_id).push(c);
      } else {
        unplaced.push(c);
      }
    }
    return { subs, map, unplaced };
  }

  // ── Рендер ───────────────────────────────────────────────────────────
  function htmlSkeleton() {
    return `<div class="pk-skeleton">
      <div class="pk-skel-col"></div>
      <div class="pk-skel-col"></div>
      <div class="pk-skel-col"></div>
    </div>`;
  }

  function htmlCard(card) {
    const ent = card.entity || {};
    const title = esc(ent.title || `${entityLabel(card)} #${card.entity_id}`);
    const stale = isStale(card);
    const transferred = card.transferred_from_user_id ? `<div class="pk-card-transferred" title="Передана">↻ Передана${card.transferred_prev_substage_label ? ': ' + esc(card.transferred_prev_substage_label) : ''}</div>` : '';
    return `<div class="pk-card" draggable="true"
        data-card-id="${card.id}" data-card-version="${card.version}"
        data-main-status="${esc(card.current_main_status || '')}"
        data-substage-id="${card.current_substage_id || ''}">
      <div class="pk-card-title">${title}</div>
      <div class="pk-card-meta">
        <span class="pk-card-kind">${esc(entityLabel(card))} #${card.entity_id}</span>
        ${stale ? '<span class="pk-card-stale" title="Без движения более 5 дней">зависла</span>' : ''}
        ${ent.customer_name ? `<span title="${esc(ent.customer_name)}">${esc(String(ent.customer_name).slice(0, 24))}</span>` : ''}
      </div>
      ${transferred}
    </div>`;
  }

  function htmlColumn(sub, cards) {
    const safeColor = /^#[0-9A-Fa-f]{3,6}$/.test(sub.color) ? sub.color : '#8a93a6';
    return `<div class="pk-col" data-substage-id="${sub.id}">
      <div class="pk-col-head">
        <div class="pk-col-color" style="background:${safeColor}"></div>
        <div class="pk-col-title" title="${esc(sub.title)}">${esc(sub.title)}</div>
        <div class="pk-col-count">${cards.length}</div>
      </div>
      <div class="pk-col-body" data-drop-substage-id="${sub.id}">
        ${cards.map(htmlCard).join('') || '<div class="pk-empty" style="padding:16px 8px;font-size:11px">—</div>'}
      </div>
    </div>`;
  }

  function htmlUnplacedColumn(cards) {
    if (!cards.length) return '';
    return `<div class="pk-col" data-substage-id="">
      <div class="pk-col-head">
        <div class="pk-col-color" style="background:var(--text-secondary)"></div>
        <div class="pk-col-title">Не размещено</div>
        <div class="pk-col-count">${cards.length}</div>
      </div>
      <div class="pk-col-body" data-drop-substage-id="">
        ${cards.map(htmlCard).join('')}
      </div>
    </div>`;
  }

  function htmlPage() {
    const flow = getFlow(_flowKey);
    const tabs = FLOWS.map(f => {
      const n = countCardsForFlow(f.key);
      return `<button class="pk-tab ${f.key === _flowKey ? 'active' : ''}" data-flow="${f.key}">
        <span class="pk-tab-ico">${f.icon}</span>${esc(f.label)}${n ? ` <span style="opacity:.6;margin-left:4px">${n}</span>` : ''}
      </button>`;
    }).join('');

    const statusChips = flow.mainStatuses.map(ms => {
      const cnt = getCardsFor(_flowKey, ms).length;
      const subN = getSubstagesFor(_flowKey, ms).length;
      const indicator = (cnt + subN) > 0;
      return `<button class="pk-status-chip ${ms === _mainStatus ? 'active' : ''}" data-status="${esc(ms)}">
        ${esc(mainStatusLabel(_flowKey, ms))}
        ${indicator ? `<span class="pk-status-count">${cnt}</span>` : ''}
      </button>`;
    }).join('');

    return `<div class="pk-page">
      <div class="pk-head">
        <div class="pk-tabs">${tabs}</div>
        <div class="pk-actions">
          <button class="btn primary" id="pk-btn-config">⚙ Подэтапы — ${esc(mainStatusLabel(_flowKey, _mainStatus || flow.mainStatuses[0]))}</button>
          ${_flowKey === 'application' ? '<button class="btn ghost" id="pk-btn-direct">＋ Прямая заявка</button>' : ''}
          <button class="btn ghost" id="pk-btn-refresh" title="Обновить">⟳</button>
        </div>
        <div class="pk-statusbar">${statusChips}</div>
      </div>
      <div class="pk-board" id="pk-board"></div>
    </div>`;
  }

  function renderBoard() {
    const board = $('#pk-board');
    if (!board) return;
    const ms = _mainStatus;
    if (!ms) { board.innerHTML = ''; return; }

    const { subs, map, unplaced } = cardsBySubstage(_flowKey, ms);

    if (subs.length === 0 && unplaced.length === 0) {
      board.innerHTML = emptyState({
        icon: '🗂',
        title: 'Нет подэтапов для этого статуса',
        desc: 'Создайте подэтапы (например, «Входящая заявка», «Созвон с клиентом») — карты автоматически встанут на первый из них.',
        action: null
      }) + `<div style="text-align:center;margin-top:10px"><button class="btn primary" id="pk-empty-cta">⚙ Настроить подэтапы</button></div>`;
      const cta = $('#pk-empty-cta');
      if (cta) cta.addEventListener('click', openConfigurator);
      return;
    }

    const html = subs.map(s => htmlColumn(s, map.get(s.id) || [])).join('') + htmlUnplacedColumn(unplaced);
    board.innerHTML = html;
    _bindBoard();
  }

  function renderPage() {
    const flow = getFlow(_flowKey);
    if (!_mainStatus || !flow.mainStatuses.includes(_mainStatus)) {
      // Выбираем первый статус с картами или substages, иначе первый
      const withCards = flow.mainStatuses.find(ms => getCardsFor(_flowKey, ms).length > 0);
      const withSubs = flow.mainStatuses.find(ms => getSubstagesFor(_flowKey, ms).length > 0);
      _mainStatus = withCards || withSubs || flow.mainStatuses[0];
    }
    const root = $('#pk-root');
    if (!root) return;
    root.innerHTML = htmlPage();
    _bindHead();
    renderBoard();
  }

  // ── Binding ─────────────────────────────────────────────────────────
  function _bindHead() {
    $$('.pk-tab').forEach(b => {
      b.addEventListener('click', () => {
        _flowKey = b.dataset.flow;
        _mainStatus = null;
        renderPage();
      });
    });
    $$('.pk-status-chip').forEach(b => {
      b.addEventListener('click', () => {
        _mainStatus = b.dataset.status;
        renderPage();
      });
    });
    const cfg = $('#pk-btn-config');
    if (cfg) cfg.addEventListener('click', openConfigurator);
    const ref = $('#pk-btn-refresh');
    if (ref) ref.addEventListener('click', async () => {
      ref.disabled = true;
      try { await loadAll(); renderPage(); toast('Готово', 'Обновлено', 'ok'); }
      finally { ref.disabled = false; }
    });
    const direct = $('#pk-btn-direct');
    if (direct) direct.addEventListener('click', openDirectApplicationModal);
  }

  let _draggedCard = null;

  function _bindBoard() {
    $$('.pk-card').forEach(card => {
      card.addEventListener('dragstart', (e) => {
        _draggedCard = card;
        card.classList.add('pk-dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', card.dataset.cardId); } catch (_) {}
      });
      card.addEventListener('dragend', () => {
        if (_draggedCard) _draggedCard.classList.remove('pk-dragging');
        _draggedCard = null;
        $$('.pk-col-body').forEach(b => b.classList.remove('pk-drop-hover'));
      });
      card.addEventListener('click', () => openCardModal(Number(card.dataset.cardId)));
    });

    $$('.pk-col-body').forEach(body => {
      body.addEventListener('dragover', (e) => {
        e.preventDefault();
        body.classList.add('pk-drop-hover');
      });
      body.addEventListener('dragleave', () => body.classList.remove('pk-drop-hover'));
      body.addEventListener('drop', async (e) => {
        e.preventDefault();
        body.classList.remove('pk-drop-hover');
        if (!_draggedCard) return;
        const cardId = Number(_draggedCard.dataset.cardId);
        const version = Number(_draggedCard.dataset.cardVersion);
        const fromSubId = _draggedCard.dataset.substageId ? Number(_draggedCard.dataset.substageId) : null;
        const toSubRaw = body.dataset.dropSubstageId;
        const toSubId = toSubRaw ? Number(toSubRaw) : null;
        if (fromSubId === toSubId) return; // тот же
        if (toSubId === null) {
          toast('Ошибка', 'Нельзя перенести в «Не размещено». Создайте подэтап.', 'err');
          return;
        }
        await moveCard(cardId, version, toSubId, body);
      });
    });
  }

  async function moveCard(cardId, version, toSubstageId, dropEl, confirm) {
    const payload = { to_substage_id: toSubstageId, version, confirm: !!confirm };
    const r = await api(`/cards/${cardId}/move`, { method: 'POST', body: payload });
    if (r.ok && r.data && r.data.success) {
      // Локально обновляем
      const card = _cards.find(c => c.id === cardId);
      if (card && r.data.item) {
        card.current_substage_id = r.data.item.current_substage_id;
        card.current_main_status = r.data.item.current_main_status;
        card.version = r.data.item.version;
        card.last_moved_at = new Date().toISOString();
      }
      renderBoard();
      toast('Готово', 'Карта перемещена', 'ok');
      return;
    }
    if (r.status === 409 && r.data && r.data.error === 'confirm_required') {
      const ok = window.confirm(`Переход «${r.data.from_main_status}» → «${r.data.to_main_status}» — перенос между основными статусами. Подтвердить?`);
      if (ok) return moveCard(cardId, version, toSubstageId, dropEl, true);
      return;
    }
    if (r.status === 409 && r.data && r.data.error === 'version_conflict') {
      toast('Ошибка', 'Карта уже изменена. Обновите страницу.', 'err');
      await loadAll(); renderBoard();
      return;
    }
    toast('Ошибка', (r.data && (r.data.message || r.data.error)) || 'Не удалось переместить', 'err');
  }

  // ── Конфигуратор подэтапов ──────────────────────────────────────────
  let _cfgState = { items: [], dirty: false };

  function openConfigurator() {
    const flow = getFlow(_flowKey);
    const ms = _mainStatus || flow.mainStatuses[0];
    _cfgState.items = getSubstagesFor(_flowKey, ms).slice().sort((a, b) => a.sort_order - b.sort_order);

    const palette = COLOR_PALETTE.map(c => `<button data-color="${c}" style="background:${c}"></button>`).join('');

    const html = `
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px">
        Перетащите для смены порядка. Кликните по кружку — выбрать цвет. Удаление — с переносом карт.
      </div>
      ${_flowKey === 'pre_tender' && ms === 'in_review' ? `
        <div class="pk-cfg-tplbar">
          <b>Шаблон «Подготовка ТКП»</b> — добавит готовый набор подэтапов.
          <button class="btn ghost" id="pk-cfg-tpl" style="float:right">＋ Загрузить шаблон</button>
        </div>` : ''}
      <div class="pk-cfg-list" id="pk-cfg-list">
        ${_cfgState.items.map(htmlCfgRow).join('') || '<div class="pk-empty">Подэтапов пока нет</div>'}
      </div>
      <div class="pk-cfg-newrow">
        <input type="text" id="pk-cfg-new-title" placeholder="Название подэтапа (2..40 символов)" maxlength="40" />
        <button class="btn primary" id="pk-cfg-add">＋ Добавить</button>
      </div>
      <div class="pk-modal-foot">
        <button class="btn ghost" id="pk-cfg-close">Закрыть</button>
      </div>
      <template id="pk-color-pop-tpl"><div class="pk-color-pop">${palette}</div></template>
    `;

    showModal({
      title: `Подэтапы — ${mainStatusLabel(_flowKey, ms)}`,
      html,
      wide: true,
      icon: '⚙',
      subtitle: getFlow(_flowKey).label,
      onMount: () => _bindConfigurator(ms)
    });
  }

  function htmlCfgRow(s) {
    const safeColor = /^#[0-9A-Fa-f]{3,6}$/.test(s.color) ? s.color : '#8a93a6';
    return `<div class="pk-cfg-row" draggable="true" data-id="${s.id}" data-version="${s.version}">
      <span class="pk-cfg-handle" title="Перетащите">⠿</span>
      <div class="pk-cfg-color" style="background:${safeColor}" data-color="${safeColor}"></div>
      <input class="pk-cfg-title" type="text" value="${esc(s.title)}" maxlength="40" />
      <div class="pk-cfg-actions">
        <button class="pk-cfg-btn" data-action="save" title="Сохранить">✓</button>
        <button class="pk-cfg-btn danger" data-action="delete" title="Удалить">✕</button>
      </div>
    </div>`;
  }

  function _bindConfigurator(mainStatus) {
    const list = $('#pk-cfg-list');
    if (!list) return;

    // Кнопка «Добавить»
    const addBtn = $('#pk-cfg-add');
    if (addBtn) {
      addBtn.addEventListener('click', async () => {
        const inp = $('#pk-cfg-new-title');
        const title = (inp.value || '').trim();
        if (title.length < 2 || title.length > 40) {
          toast('Ошибка', 'Название от 2 до 40 символов', 'err');
          return;
        }
        addBtn.disabled = true;
        const r = await api('/substages', { method: 'POST', body: {
          flow_type: _flowKey, main_status: mainStatus, title, color: COLOR_PALETTE[0]
        }});
        addBtn.disabled = false;
        if (r.ok && r.data.success) {
          _substages.push(r.data.item);
          _cfgState.items.push(r.data.item);
          inp.value = '';
          _refreshCfgList(mainStatus);
          // фоновая перезагрузка карт (новый substage может быть first-active)
          renderBoard();
        } else {
          toast('Ошибка', (r.data && (r.data.message || r.data.error)) || 'Не удалось создать', 'err');
        }
      });
    }

    // Шаблон
    const tplBtn = $('#pk-cfg-tpl');
    if (tplBtn) {
      tplBtn.addEventListener('click', async () => {
        tplBtn.disabled = true;
        let created = 0;
        for (const title of TEMPLATE_TKP) {
          if (_cfgState.items.some(it => it.title === title)) continue;
          const r = await api('/substages', { method: 'POST', body: {
            flow_type: _flowKey, main_status: mainStatus, title, color: COLOR_PALETTE[(created + 1) % COLOR_PALETTE.length]
          }});
          if (r.ok && r.data.success) {
            _substages.push(r.data.item);
            _cfgState.items.push(r.data.item);
            created++;
          }
        }
        tplBtn.disabled = false;
        if (created > 0) {
          toast('Готово', `Добавлено: ${created}`, 'ok');
          _refreshCfgList(mainStatus);
          renderBoard();
        } else {
          toast('Шаблон', 'Все подэтапы уже есть', 'info');
        }
      });
    }

    const closeBtn = $('#pk-cfg-close');
    if (closeBtn) closeBtn.addEventListener('click', hideModal);

    _bindCfgRows(mainStatus);
  }

  function _refreshCfgList(mainStatus) {
    _cfgState.items = getSubstagesFor(_flowKey, mainStatus).slice().sort((a, b) => a.sort_order - b.sort_order);
    const list = $('#pk-cfg-list');
    if (!list) return;
    list.innerHTML = _cfgState.items.map(htmlCfgRow).join('') || '<div class="pk-empty">Подэтапов пока нет</div>';
    _bindCfgRows(mainStatus);
  }

  function _bindCfgRows(mainStatus) {
    const list = $('#pk-cfg-list');
    if (!list) return;

    let cfgDragId = null;
    $$('.pk-cfg-row', list).forEach(row => {
      row.addEventListener('dragstart', (e) => {
        cfgDragId = Number(row.dataset.id);
        row.classList.add('pk-cfg-drag');
        try { e.dataTransfer.setData('text/plain', String(cfgDragId)); } catch (_) {}
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('pk-cfg-drag');
      });
      row.addEventListener('dragover', (e) => e.preventDefault());
      row.addEventListener('drop', async (e) => {
        e.preventDefault();
        if (!cfgDragId) return;
        const overId = Number(row.dataset.id);
        if (overId === cfgDragId) return;
        // Считаем новый sort_order — берём middle между соседями
        const items = _cfgState.items.slice();
        const fromIdx = items.findIndex(it => it.id === cfgDragId);
        const toIdx = items.findIndex(it => it.id === overId);
        if (fromIdx < 0 || toIdx < 0) return;
        const [moved] = items.splice(fromIdx, 1);
        items.splice(toIdx, 0, moved);
        // Простейшее правило: новый sort_order = (sort_order соседей) среднее
        const prev = items[toIdx - 1] ? items[toIdx - 1].sort_order : 0;
        const next = items[toIdx + 1] ? items[toIdx + 1].sort_order : (prev + 2000);
        const newSort = (prev + next) / 2;
        const r = await api(`/substages/${moved.id}`, { method: 'PATCH', body: {
          sort_order: newSort, version: moved.version
        }});
        if (r.ok && r.data.success) {
          // Обновляем in-memory
          const found = _substages.find(s => s.id === moved.id);
          if (found) Object.assign(found, r.data.item);
          _refreshCfgList(mainStatus);
          renderBoard();
        } else if (r.status === 409) {
          toast('Ошибка', 'Подэтап изменён извне. Обновите конфигуратор.', 'err');
        } else {
          toast('Ошибка', (r.data && (r.data.message || r.data.error)) || 'Не удалось переместить', 'err');
        }
        cfgDragId = null;
      });

      // Цвет
      const colorEl = row.querySelector('.pk-cfg-color');
      if (colorEl) {
        colorEl.addEventListener('click', (e) => {
          e.stopPropagation();
          // popover
          const existing = row.querySelector('.pk-color-pop');
          if (existing) { existing.remove(); return; }
          const pop = document.createElement('div');
          pop.className = 'pk-color-pop';
          pop.innerHTML = COLOR_PALETTE.map(c => `<button data-color="${c}" style="background:${c}"></button>`).join('');
          row.appendChild(pop);
          $$('button', pop).forEach(b => b.addEventListener('click', async () => {
            const newColor = b.dataset.color;
            const id = Number(row.dataset.id);
            const item = _cfgState.items.find(it => it.id === id);
            if (!item) return;
            const r = await api(`/substages/${id}`, { method: 'PATCH', body: {
              color: newColor, version: item.version
            }});
            pop.remove();
            if (r.ok && r.data.success) {
              const found = _substages.find(s => s.id === id);
              if (found) Object.assign(found, r.data.item);
              _refreshCfgList(mainStatus);
              renderBoard();
            } else {
              toast('Ошибка', 'Не удалось сменить цвет', 'err');
            }
          }));
        });
      }

      // Save (rename)
      const saveBtn = row.querySelector('[data-action="save"]');
      if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
          const id = Number(row.dataset.id);
          const titleInp = row.querySelector('.pk-cfg-title');
          const newTitle = (titleInp.value || '').trim();
          if (newTitle.length < 2 || newTitle.length > 40) {
            toast('Ошибка', 'Название от 2 до 40 символов', 'err');
            return;
          }
          const item = _cfgState.items.find(it => it.id === id);
          if (!item) return;
          if (newTitle === item.title) return;
          const r = await api(`/substages/${id}`, { method: 'PATCH', body: {
            title: newTitle, version: item.version
          }});
          if (r.ok && r.data.success) {
            const found = _substages.find(s => s.id === id);
            if (found) Object.assign(found, r.data.item);
            _refreshCfgList(mainStatus);
            renderBoard();
            toast('Готово', 'Сохранено', 'ok');
          } else {
            toast('Ошибка', (r.data && (r.data.message || r.data.error)) || 'Не удалось переименовать', 'err');
          }
        });
      }

      // Delete
      const delBtn = row.querySelector('[data-action="delete"]');
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          const id = Number(row.dataset.id);
          const item = _cfgState.items.find(it => it.id === id);
          if (!item) return;
          if (!window.confirm(`Удалить подэтап «${item.title}»?`)) return;
          const r = await api(`/substages/${id}`, { method: 'DELETE' });
          if (r.ok && r.data.success) {
            _substages = _substages.filter(s => s.id !== id);
            _refreshCfgList(mainStatus);
            renderBoard();
            toast('Готово', 'Удалено', 'ok');
          } else if (r.status === 409 && r.data && r.data.error === 'has_cards') {
            const tgtId = r.data.suggest_target_id;
            if (!tgtId) {
              toast('Ошибка', `На подэтапе ${r.data.cards_count} карт, перенести некуда. Создайте другой подэтап.`, 'err');
              return;
            }
            const target = _substages.find(s => s.id === tgtId);
            if (!window.confirm(`На подэтапе ${r.data.cards_count} карт. Перенести их на «${target ? target.title : '#' + tgtId}» и удалить?`)) return;
            const m = await api(`/substages/${id}/move-cards-to/${tgtId}`, { method: 'POST' });
            if (!m.ok) {
              toast('Ошибка', (m.data && (m.data.message || m.data.error)) || 'Не удалось перенести карты', 'err');
              return;
            }
            const r2 = await api(`/substages/${id}`, { method: 'DELETE' });
            if (r2.ok) {
              _substages = _substages.filter(s => s.id !== id);
              await loadAll();
              _refreshCfgList(mainStatus);
              renderBoard();
              toast('Готово', 'Карты перенесены, подэтап удалён', 'ok');
            } else {
              toast('Ошибка', 'Не удалось удалить после переноса', 'err');
            }
          } else {
            toast('Ошибка', (r.data && (r.data.message || r.data.error)) || 'Не удалось удалить', 'err');
          }
        });
      }
    });
  }

  // ── Модалка карты: история + заметки + напоминания + transfer ──────
  async function openCardModal(cardId) {
    const card = _cards.find(c => c.id === cardId);
    if (!card) { toast('Ошибка', 'Карта не найдена', 'err'); return; }

    const ent = card.entity || {};
    const title = ent.title || `${entityLabel(card)} #${card.entity_id}`;

    const html = `
      <div style="display:flex;flex-direction:column;gap:12px">
        <div>
          <div style="font-size:11px;color:var(--text-secondary)">${esc(entityLabel(card))} #${card.entity_id}</div>
          <div style="font-size:14px;color:var(--text-primary);font-weight:600;margin-top:4px">${esc(title)}</div>
          ${ent.customer_name ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:4px">${esc(ent.customer_name)}</div>` : ''}
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn ghost" id="pk-card-transfer">↻ Передать другому РП</button>
          <button class="btn ghost" id="pk-card-note">＋ Заметка</button>
          <button class="btn ghost" id="pk-card-remind">⏰ Напоминание</button>
        </div>

        <div>
          <div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px;font-weight:600">Лента событий</div>
          <div class="pk-tline" id="pk-card-tline">${AsgardUI.skeleton('text', 4)}</div>
        </div>
      </div>
    `;

    showModal({
      title: 'Карта канбана',
      html,
      wide: true,
      icon: '🗂',
      subtitle: mainStatusLabel(card.flow_type, card.current_main_status),
      onMount: async () => {
        $('#pk-card-transfer').addEventListener('click', () => openTransferModal(card));
        $('#pk-card-note').addEventListener('click', () => openAddNoteModal(card));
        $('#pk-card-remind').addEventListener('click', () => openAddReminderModal(card));
        await loadCardHistory(card);
      }
    });
  }

  async function loadCardHistory(card) {
    const r = await api(`/cards/${card.id}/history`);
    const el = $('#pk-card-tline');
    if (!el) return;
    if (!r.ok || !r.data) { el.innerHTML = '<div class="pk-empty">Не удалось загрузить</div>'; return; }
    const items = r.data.items || [];
    if (!items.length) { el.innerHTML = '<div class="pk-empty">Событий нет</div>'; return; }
    el.innerHTML = items.map(it => {
      if (it.kind === 'note') {
        return `<div class="pk-tline-item pk-tline-note">
          <div class="pk-tline-meta">📝 ${esc(it.author_name || ('user#' + it.author_id))} · ${formatDateTime(it.at)}</div>
          <div>${esc(it.body)}</div>
        </div>`;
      }
      const arrow = `${esc(it.from_substage_title || '—')} → ${esc(it.to_substage_title || '—')}`;
      const act = it.action === 'transfer' ? '↻ Передача' :
        it.action === 'create' ? '＋ Создана' :
        it.action === 'close' ? '✕ Закрыта' : '⇄ Перемещение';
      return `<div class="pk-tline-item">
        <div class="pk-tline-meta">${act} · ${esc(it.moved_by_name || ('user#' + it.moved_by))} · ${formatDateTime(it.at)}</div>
        <div style="font-size:11px">${arrow}</div>
        ${it.note ? `<div style="margin-top:4px;font-size:11px;color:var(--text-secondary)">${esc(it.note)}</div>` : ''}
      </div>`;
    }).join('');
  }

  async function openTransferModal(card) {
    const pmList = await loadPmList();
    const options = pmList
      .filter(u => u.id !== card.owner_user_id)
      .map(u => `<option value="${u.id}">${esc(u.name || u.login)} (${esc(u.role)})</option>`).join('');
    const html = `
      <div class="pk-form-grp">
        <label>Кому передать</label>
        <select id="pk-transfer-pm">
          <option value="">— Выберите РП —</option>${options}
        </select>
      </div>
      <div class="pk-form-grp">
        <label>Комментарий (необязательно)</label>
        <textarea id="pk-transfer-note" rows="3" placeholder="Кратко: что сделано, что осталось"></textarea>
      </div>
      <div class="pk-modal-foot">
        <button class="btn ghost" id="pk-transfer-cancel">Отмена</button>
        <button class="btn primary" id="pk-transfer-ok">Передать</button>
      </div>`;
    showModal({
      title: 'Передать карту',
      html, icon: '↻',
      onMount: () => {
        $('#pk-transfer-cancel').addEventListener('click', hideModal);
        $('#pk-transfer-ok').addEventListener('click', async () => {
          const sel = $('#pk-transfer-pm');
          const to = Number(sel.value || 0);
          if (!to) { toast('Ошибка', 'Выберите РП', 'err'); return; }
          const note = $('#pk-transfer-note').value.trim() || null;
          const r = await api(`/cards/${card.id}/transfer`, { method: 'POST', body: { to_user_id: to, note }});
          if (r.ok && r.data.success) {
            // Карта больше не наша
            _cards = _cards.filter(c => c.id !== card.id);
            hideModal();
            hideModal(); // и предыдущую модалку карты
            renderPage();
            toast('Готово', 'Карта передана', 'ok');
          } else if (r.status === 409 && r.data && r.data.error === 'already_owns') {
            toast('Ошибка', 'У этого РП уже есть карта на эту сущность', 'err');
          } else {
            toast('Ошибка', (r.data && (r.data.message || r.data.error)) || 'Не удалось передать', 'err');
          }
        });
      }
    });
  }

  async function openAddNoteModal(card) {
    const html = `
      <div class="pk-form-grp">
        <label>Текст заметки (до 4000 символов)</label>
        <textarea id="pk-note-body" rows="5" placeholder="Кратко: что сделано / что обсудили"></textarea>
      </div>
      <div class="pk-modal-foot">
        <button class="btn ghost" id="pk-note-cancel">Отмена</button>
        <button class="btn primary" id="pk-note-ok">Сохранить</button>
      </div>`;
    showModal({
      title: 'Новая заметка', html, icon: '📝',
      onMount: () => {
        $('#pk-note-cancel').addEventListener('click', hideModal);
        $('#pk-note-ok').addEventListener('click', async () => {
          const body = $('#pk-note-body').value.trim();
          if (!body) { toast('Ошибка', 'Введите текст', 'err'); return; }
          const r = await api(`/cards/${card.id}/notes`, { method: 'POST', body: { body }});
          if (r.ok && r.data.success) {
            hideModal();
            toast('Готово', 'Заметка добавлена', 'ok');
            // Обновим ленту в модалке карты, если открыта
            await loadCardHistory(card);
          } else {
            toast('Ошибка', (r.data && (r.data.message || r.data.error)) || 'Не удалось сохранить', 'err');
          }
        });
      }
    });
  }

  async function openAddReminderModal(card) {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 60);
    const isoDefault = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const html = `
      <div class="pk-form-grp">
        <label>Когда напомнить</label>
        <input type="datetime-local" id="pk-rem-at" value="${isoDefault}" />
      </div>
      <div class="pk-form-grp">
        <label>Текст напоминания (необязательно)</label>
        <textarea id="pk-rem-msg" rows="3" placeholder="О чём напомнить"></textarea>
      </div>
      <div class="pk-modal-foot">
        <button class="btn ghost" id="pk-rem-cancel">Отмена</button>
        <button class="btn primary" id="pk-rem-ok">Поставить</button>
      </div>`;
    showModal({
      title: 'Напоминание', html, icon: '⏰',
      onMount: () => {
        $('#pk-rem-cancel').addEventListener('click', hideModal);
        $('#pk-rem-ok').addEventListener('click', async () => {
          const atRaw = $('#pk-rem-at').value;
          if (!atRaw) { toast('Ошибка', 'Укажите время', 'err'); return; }
          const remindAt = new Date(atRaw);
          if (isNaN(remindAt.getTime()) || remindAt.getTime() < Date.now() - 30000) {
            toast('Ошибка', 'Время должно быть в будущем', 'err'); return;
          }
          const message = $('#pk-rem-msg').value.trim() || null;
          const r = await api(`/cards/${card.id}/reminders`, { method: 'POST', body: {
            remind_at: remindAt.toISOString(), message
          }});
          if (r.ok && r.data.success) {
            hideModal();
            toast('Готово', 'Напоминание поставлено', 'ok');
          } else {
            toast('Ошибка', (r.data && (r.data.message || r.data.error)) || 'Не удалось поставить', 'err');
          }
        });
      }
    });
  }

  // ── Прямая заявка (PM) — multipart на /api/inbox-applications/direct ─
  function openDirectApplicationModal() {
    const html = `
      <div class="pk-form-grp">
        <label>Тема <span style="color:var(--red,#e74c3c)">*</span></label>
        <input type="text" id="pk-da-title" maxlength="500" placeholder="Например: «Прозвонить заказчика по объекту …»" />
      </div>
      <div class="pk-form-grp">
        <label>Описание <span style="color:var(--red,#e74c3c)">*</span></label>
        <textarea id="pk-da-body" rows="6" placeholder="Полное описание заявки"></textarea>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="pk-form-grp">
          <label>Заказчик (имя)</label>
          <input type="text" id="pk-da-cn" />
        </div>
        <div class="pk-form-grp">
          <label>Контакт (email/тел.)</label>
          <input type="text" id="pk-da-cc" />
        </div>
      </div>
      <div class="pk-form-grp">
        <label>Вложения (PDF/JPG/DOCX, до 20 файлов)</label>
        <input type="file" id="pk-da-files" multiple />
      </div>
      <div class="pk-modal-foot">
        <button class="btn ghost" id="pk-da-cancel">Отмена</button>
        <button class="btn primary" id="pk-da-ok">Создать</button>
      </div>`;
    showModal({
      title: 'Прямая заявка', html, icon: '📥', wide: true,
      onMount: () => {
        $('#pk-da-cancel').addEventListener('click', hideModal);
        $('#pk-da-ok').addEventListener('click', async () => {
          const title = $('#pk-da-title').value.trim();
          const bodyText = $('#pk-da-body').value.trim();
          if (title.length < 2 || title.length > 500) {
            toast('Ошибка', 'Тема: 2..500 символов', 'err'); return;
          }
          if (!bodyText) {
            toast('Ошибка', 'Введите описание', 'err'); return;
          }
          const fd = new FormData();
          fd.append('title', title);
          fd.append('body', bodyText);
          const cn = $('#pk-da-cn').value.trim(); if (cn) fd.append('customer_name', cn);
          const cc = $('#pk-da-cc').value.trim(); if (cc) fd.append('customer_contact', cc);
          const files = $('#pk-da-files').files;
          for (let i = 0; i < files.length; i++) fd.append('files', files[i]);

          const btn = $('#pk-da-ok'); btn.disabled = true;
          const r = await apiInbox('/direct', { method: 'POST', body: fd, isFormData: true });
          btn.disabled = false;
          if (r.ok && r.data && r.data.success) {
            hideModal();
            toast('Готово', `Заявка №${r.data.application_id} создана`, 'ok');
            await loadAll();
            renderPage();
          } else {
            toast('Ошибка', (r.data && (r.data.message || r.data.error)) || 'Не удалось создать', 'err');
          }
        });
      }
    });
  }

  // ── SSE ──────────────────────────────────────────────────────────────
  function _attachSSE() {
    if (!window._asgardSSE) return;
    if (_sseHandler) return;
    _sseHandler = async (e) => {
      try {
        const data = JSON.parse(e.data);
        if (!_user || data.owner_user_id !== _user.id) return;
        // Тихо перезагружаем карты
        await loadAll();
        renderBoard();
      } catch (_) {}
    };
    try {
      window._asgardSSE.addEventListener('personal_kanban:card_moved', _sseHandler);
      window._asgardSSE.addEventListener('personal_kanban:card_transferred', _sseHandler);
      // Wave-5: новые SSE-каналы (создание/конвертация/закрытие orphan-карты).
      window._asgardSSE.addEventListener('personal_kanban:card_created', _sseHandler);
      window._asgardSSE.addEventListener('personal_kanban:card_converted', _sseHandler);
      window._asgardSSE.addEventListener('personal_kanban:card_closed', _sseHandler);
    } catch (_) {}
  }

  function _detachSSE() {
    if (!_sseHandler) return;
    try {
      if (window._asgardSSE) {
        window._asgardSSE.removeEventListener('personal_kanban:card_moved', _sseHandler);
        window._asgardSSE.removeEventListener('personal_kanban:card_transferred', _sseHandler);
        // Wave-5
        window._asgardSSE.removeEventListener('personal_kanban:card_created', _sseHandler);
        window._asgardSSE.removeEventListener('personal_kanban:card_converted', _sseHandler);
        window._asgardSSE.removeEventListener('personal_kanban:card_closed', _sseHandler);
      }
    } catch (_) {}
    _sseHandler = null;
  }

  // ── Главный render ───────────────────────────────────────────────────
  async function render(opts) {
    _injectStyles();
    _layout = opts.layout;
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    _user = auth.user;

    // Каркас + skeleton
    await _layout(`<div id="pk-root">${htmlSkeleton()}</div>`, {
      title: opts.title || 'Мой канбан',
      motto: 'Свои подэтапы — путь к ясности.'
    });

    try {
      await loadAll();
    } catch (e) {
      const root = $('#pk-root');
      if (root) root.innerHTML = `<div class="pk-empty">Не удалось загрузить канбан: ${esc(e.message || String(e))}</div>`;
      return;
    }

    renderPage();
    _attachSSE();

    // Cleanup при смене hash
    const hashHandler = () => {
      if (!location.hash.startsWith('#/personal-kanban')) {
        _detachSSE();
        window.removeEventListener('hashchange', hashHandler);
      }
    };
    window.addEventListener('hashchange', hashHandler);
  }

  return { render };
})();
