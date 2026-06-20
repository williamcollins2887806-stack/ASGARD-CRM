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

  // ── v3 ───────────────────────────────────────────────────────────────
  // Режим: 'v3' (по воронке, 8 колонок) по умолчанию, 'substages' (старый).
  let _viewMode = (function () {
    try { return localStorage.getItem('asg_pk_view') || 'v3'; } catch (_) { return 'v3'; }
  })();
  let _v3FlowFilter = '';            // '' | 'application' | 'pre_tender' | 'tender' | 'work'
  let _v3Search = '';                // строка поиска
  let _v3Board = null;               // { columns: { id: [card,...] }, counts: {...} }
  let _v3DraggedCardId = null;
  // Колонки v3 (1-в-1 demo)
  const PK3_COLS = [
    { id: 'new',      ic: '📥', title: 'Новые' },
    { id: 'calc',     ic: '🧮', title: 'Просчёт ТКП' },
    { id: 'approval', ic: '⚖️', title: 'На согласовании' },
    { id: 'kp_prep',  ic: '📋', title: 'КП готовится' },
    { id: 'sent',     ic: '📤', title: 'КП отправлено' },
    { id: 'win',      ic: '🏆', title: 'Выиграно', cls: 'pk3-win' },
    { id: 'lose',     ic: '❌', title: 'Проиграно', cls: 'pk3-lose' },
    { id: 'work',     ic: '🏗', title: 'В работе' }
  ];
  // 8 этапов в drawer (1-в-1 demo)
  const PK3_STAGES = [
    { lbl: '📥 Новая' }, { lbl: '🧮 Просчёт' }, { lbl: '⚖️ Согл.' }, { lbl: '📋 КП готов' },
    { lbl: '📤 КП ушло' }, { lbl: '🏆 Выигр.' }, { lbl: '❌ Проигр.' }, { lbl: '🏗 В работе' }
  ];
  const PK3_COL_TO_STAGE = {
    new: 0, calc: 1, approval: 2, kp_prep: 3, sent: 4, win: 5, lose: 6, work: 7
  };
  // Маппинг kind → класс badge
  function _pk3KindClass(k) {
    if (!k) return 'pk3-app';
    if (k === 'inbox_application' || k === 'application') return 'pk3-app';
    if (k === 'pre_tender') return 'pk3-pre';
    if (k === 'tender') return 'pk3-tender';
    if (k === 'work') return 'pk3-work';
    return 'pk3-app';
  }
  function _pk3KindLabel(k) {
    if (k === 'inbox_application' || k === 'application') return 'Заявка';
    if (k === 'pre_tender') return 'Пре-тендер';
    if (k === 'tender') return 'Тендер';
    if (k === 'work') return 'Работа';
    return k || '—';
  }

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

  // Wave B: API клиент для pre-tenders
  async function apiPreTender(path, opts) {
    opts = opts || {};
    const headers = await _authHeaders();
    if (opts.headers) Object.assign(headers, opts.headers);
    const init = { method: opts.method || 'GET', headers };
    if (opts.body) init.body = JSON.stringify(opts.body);
    const res = await fetch('/api/pre-tenders' + path, init);
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

/* ═══════════════════════════════════════════════════════════════════════
   v3 — pk3 — полный цикл канбана + drawer 920px + 5 модалок
   Дизайн: наши токены (var(--bg0)/var(--t1)/var(--gold) и др.)
   ═══════════════════════════════════════════════════════════════════════ */
.pk3-shell{padding:8px 4px}
.pk3-top-actions{display:flex;align-items:flex-end;gap:16px;padding:14px 4px 14px;border-bottom:1px solid var(--brd-m);margin-bottom:10px;flex-wrap:wrap}
.pk3-titles{flex:1;min-width:220px}
.pk3-kicker{font-size:11px;color:var(--gold);text-transform:uppercase;letter-spacing:2px;font-weight:700;margin-bottom:4px}
.pk3-h2{font-family:'Cinzel',Georgia,serif;font-size:22px;font-weight:800;color:var(--t1);line-height:1.2;margin-bottom:3px}
.pk3-h2-sub{font-size:12.5px;color:var(--t3)}
.pk3-top-actions .pk3-search{background:var(--bg2);border:1px solid var(--brd);border-radius:9999px;padding:8px 14px;color:var(--t1);font-size:13px;outline:none;width:260px;max-width:100%}
.pk3-top-actions .pk3-search::placeholder{color:var(--t3)}
.pk3-top-actions .pk3-search:focus{border-color:var(--gold);box-shadow:0 0 0 3px var(--gold-bg)}
.pk3-view-toggle{display:inline-flex;border:1px solid var(--brd);border-radius:9px;overflow:hidden;background:var(--bg2)}
.pk3-view-toggle button{background:transparent;color:var(--t2);border:none;padding:7px 12px;font-size:12.5px;font-weight:600;cursor:pointer;font-family:var(--font-sans)}
.pk3-view-toggle button:hover{color:var(--t1);background:var(--bg3)}
.pk3-view-toggle button.pk3-active{background:var(--gold-bg);color:var(--gold-l)}

.pk3-tabs-bar{display:flex;gap:0;padding:0 4px;border-bottom:1px solid var(--brd-m);margin-bottom:14px;flex-wrap:wrap}
.pk3-tab{padding:11px 16px;color:var(--t3);cursor:pointer;font-size:13.5px;font-weight:600;border-bottom:2px solid transparent;display:inline-flex;align-items:center;gap:7px;background:transparent;border-left:none;border-top:none;border-right:none;font-family:var(--font-sans);transition:color .15s ease}
.pk3-tab:hover{color:var(--t1)}
.pk3-tab.pk3-active{color:var(--gold-l);border-bottom-color:var(--gold)}
.pk3-tab .pk3-cnt{background:var(--bg3);color:var(--t2);padding:1px 7px;border-radius:9999px;font-size:11px;font-weight:700}
.pk3-tab.pk3-active .pk3-cnt{background:var(--gold);color:#0a0a0a}

.pk3-board{padding:6px 0 28px;display:flex;gap:10px;overflow-x:auto;align-items:flex-start;min-height:380px}
.pk3-col{flex:0 0 270px;background:var(--bg2);border:1px solid var(--brd);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;max-height:calc(100vh - 260px)}
.pk3-col-head{padding:11px 13px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--brd-m);background:linear-gradient(180deg,var(--bg3),transparent)}
.pk3-col-icon{font-size:14px}
.pk3-col-title{flex:1;font-size:12.5px;font-weight:700;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pk3-col-count{font-size:11px;color:var(--t3);background:var(--bg4);padding:2px 8px;border-radius:9999px;font-weight:700}
.pk3-col-body{padding:8px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:8px;min-height:80px}
.pk3-col-body.pk3-drop-hover{background:var(--gold-bg)}
.pk3-col.pk3-win .pk3-col-head{background:linear-gradient(180deg,var(--ok-bg),transparent)}
.pk3-col.pk3-lose .pk3-col-head{background:linear-gradient(180deg,var(--err-bg),transparent)}

.pk3-card{background:linear-gradient(160deg,var(--bg2),var(--bg3) 140%);border:1px solid var(--brd);border-radius:9px;padding:11px 12px 9px;cursor:pointer;transition:transform .15s ease, box-shadow .15s ease, border-color .15s ease;border-left:3px solid var(--t3);box-shadow:0 1px 3px rgba(0,0,0,.25);position:relative}
.pk3-card:hover{transform:translateY(-2px);box-shadow:0 4px 14px rgba(0,0,0,.25);border-color:var(--gold-border,var(--brd))}
.pk3-card.pk3-dragging{opacity:.5}
.pk3-card.pk3-green{border-left-color:var(--ok-t)}
.pk3-card.pk3-yellow{border-left-color:var(--warn-t)}
.pk3-card.pk3-red{border-left-color:var(--err-t)}
.pk3-card.pk3-win{border-left-color:var(--ok-t);background:linear-gradient(160deg,var(--ok-bg),var(--bg3))}
.pk3-card.pk3-lose{border-left-color:var(--err-t);opacity:.72}
.pk3-card-top{display:flex;align-items:center;gap:5px;margin-bottom:6px}
.pk3-badge{font-size:9.5px;font-weight:700;padding:2px 7px;border-radius:4px;letter-spacing:.5px;text-transform:uppercase}
.pk3-badge.pk3-app{background:var(--gold-bg);color:var(--gold-l)}
.pk3-badge.pk3-pre{background:var(--ok-bg);color:var(--ok-t)}
.pk3-badge.pk3-tender{background:var(--info-bg);color:var(--info-t)}
.pk3-badge.pk3-work{background:var(--err-bg);color:var(--err-t)}
.pk3-card-id{font-size:10.5px;color:var(--t3);font-family:var(--ff-mono,monospace);margin-left:auto}
.pk3-card-title{font-size:13px;font-weight:600;line-height:1.35;color:var(--t1);margin-bottom:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pk3-card-customer{font-size:11.5px;color:var(--t2);margin-bottom:7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pk3-card-meta{display:flex;flex-wrap:wrap;gap:5px;font-size:10.5px;color:var(--t3)}
.pk3-card-meta .pk3-pill{background:var(--bg3);padding:2px 7px;border-radius:9999px;display:inline-flex;align-items:center;gap:3px}
.pk3-card-progress{display:flex;gap:2px;margin-top:8px}
.pk3-card-progress .pk3-dot{flex:1;height:3px;background:var(--bg4);border-radius:1.5px}
.pk3-card-progress .pk3-dot.pk3-done{background:var(--gold)}
.pk3-card-progress .pk3-dot.pk3-now{background:var(--gold-l);box-shadow:0 0 6px var(--gold)}

/* === DRAWER 920px right-side === */
.pk3-drawer-overlay{position:fixed;inset:0;background:var(--overlay);z-index:400;display:none;backdrop-filter:blur(4px)}
.pk3-drawer-overlay.pk3-show{display:block}
.pk3-drawer{position:fixed;top:0;right:0;bottom:0;width:920px;max-width:96vw;background:var(--bg1);border-left:1px solid var(--brd);box-shadow:0 8px 28px rgba(0,0,0,.45);overflow-y:auto;z-index:401;display:none;scroll-behavior:smooth;scroll-padding-top:170px}
.pk3-drawer.pk3-show{display:block;animation:pk3-in .25s cubic-bezier(.16,1,.3,1)}
@keyframes pk3-in{from{transform:translateX(40px);opacity:0}to{transform:translateX(0);opacity:1}}
.pk3-drawer-head{padding:18px 24px 12px;border-bottom:1px solid var(--brd-m);background:var(--bg2);backdrop-filter:blur(14px);position:sticky;top:0;z-index:5}
.pk3-drawer-head .pk3-row1{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.pk3-drawer-head h2{font-size:17px;flex:1;line-height:1.3;font-family:'Cinzel',Georgia,serif;color:var(--t1);font-weight:700;margin:0}
.pk3-drawer-head .pk3-meta{font-size:11.5px;color:var(--t3);display:flex;gap:13px;flex-wrap:wrap}
.pk3-icon-btn{width:34px;height:34px;border-radius:8px;border:1px solid var(--brd);background:var(--bg2);color:var(--t2);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:13px}
.pk3-icon-btn:hover{background:var(--bg3);color:var(--t1)}

.pk3-stages{display:flex;gap:1px;margin:14px 24px 0;background:var(--brd-m);border-radius:8px;overflow:hidden}
.pk3-stage{flex:1;padding:9px 5px 10px;text-align:center;background:var(--bg2);color:var(--t3);font-size:9.5px;font-weight:500;position:relative}
.pk3-stage.pk3-done{background:linear-gradient(180deg,var(--ok-bg),transparent);color:var(--ok-t)}
.pk3-stage.pk3-now{background:linear-gradient(180deg,var(--gold-bg),transparent);color:var(--gold-l);font-weight:800;box-shadow:inset 0 -3px 0 var(--gold)}
.pk3-stage .pk3-lbl{display:block;font-size:9.5px;line-height:1.2}

.pk3-drawer-nav{position:sticky;top:130px;z-index:4;background:var(--bg2);backdrop-filter:blur(14px);padding:8px 24px;border-bottom:1px solid var(--brd-m);margin-bottom:14px;display:flex;gap:6px;overflow-x:auto;flex-wrap:nowrap}
.pk3-dnav-link{padding:5px 11px;background:var(--bg3);border:1px solid var(--brd-m);border-radius:9999px;color:var(--t3);font-size:11.5px;cursor:pointer;transition:all .15s ease;white-space:nowrap}
.pk3-dnav-link:hover{background:var(--bg4);color:var(--t1)}

.pk3-section{margin:0 24px 16px;background:var(--bg2);border:1px solid var(--brd);border-radius:16px;overflow:hidden;scroll-margin-top:170px}
.pk3-section-head{padding:12px 18px;display:flex;align-items:center;gap:9px;border-bottom:1px solid var(--brd-m);cursor:pointer;user-select:none}
.pk3-section-head .pk3-ico{font-size:15px;color:var(--gold)}
.pk3-section-head h3{font-size:12.5px;font-weight:700;color:var(--t1);flex:1;letter-spacing:.3px;text-transform:uppercase;margin:0}
.pk3-section-head .pk3-chev{color:var(--t3);font-size:12px}
.pk3-section-head .pk3-count{background:var(--bg3);color:var(--t2);padding:1.5px 8px;border-radius:9999px;font-size:10.5px;font-weight:700}
.pk3-section-body{padding:14px 18px}
.pk3-section.pk3-closed .pk3-section-body{display:none}

.pk3-ai-block{background:var(--ok-bg);border-left:3px solid var(--ok);padding:12px 14px;border-radius:0 8px 8px 0;color:var(--t1);font-size:13px;line-height:1.6}
.pk3-ai-block b{color:var(--t1)}

.pk3-row{display:grid;grid-template-columns:160px 1fr;gap:10px 16px;margin-bottom:10px;align-items:start}
.pk3-row label{color:var(--t3);font-size:12px;padding-top:8px}
.pk3-row input,.pk3-row select,.pk3-row textarea{width:100%;background:var(--bg3);border:1px solid var(--brd);border-radius:6px;padding:8px 11px;color:var(--t1);font-size:13.5px;font-family:inherit;outline:none}
.pk3-row input:focus,.pk3-row select:focus,.pk3-row textarea:focus{border-color:var(--gold);box-shadow:0 0 0 3px var(--gold-bg)}
.pk3-row textarea{resize:vertical;min-height:60px}
.pk3-twocol{display:grid;grid-template-columns:1fr 1fr;gap:8px}

/* Calc panel — 3 кнопки */
.pk3-calc-panel{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px}
.pk3-calc-card{background:var(--bg2);border:1px solid var(--brd);border-radius:8px;padding:14px;cursor:pointer;transition:all .15s ease;text-align:center}
.pk3-calc-card:hover{border-color:var(--gold);background:var(--bg3);transform:translateY(-2px)}
.pk3-calc-card .pk3-ic{font-size:24px;display:block;margin-bottom:6px}
.pk3-calc-card .pk3-title{font-size:13px;font-weight:700;color:var(--t1);margin-bottom:3px}
.pk3-calc-card .pk3-sub{font-size:10.5px;color:var(--t3);line-height:1.4}
.pk3-calc-card.pk3-q .pk3-ic{color:var(--cyan,#06B6D4)}
.pk3-calc-card.pk3-c .pk3-ic{color:var(--purple,#8B5CF6)}
.pk3-calc-card.pk3-r .pk3-ic{color:var(--gold-l)}

/* Docs */
.pk3-doc-group{margin-bottom:14px}
.pk3-doc-group:last-child{margin-bottom:0}
.pk3-doc-group h4{font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.6px;margin-bottom:7px;font-weight:700}
.pk3-doc-row{display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--bg3);border:1px solid var(--brd-m);border-radius:6px;margin-bottom:5px;text-decoration:none;color:var(--t1);font-size:12.5px}
.pk3-doc-row:hover{border-color:var(--gold);background:var(--bg4)}
.pk3-doc-ic{font-size:16px;width:20px;text-align:center}
.pk3-doc-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pk3-doc-size{font-size:10.5px;color:var(--t3)}
.pk3-doc-actions{display:flex;gap:5px}
.pk3-doc-actions button{width:28px;height:28px;border-radius:5px;border:1px solid var(--brd-m);background:var(--bg2);color:var(--t2);cursor:pointer;font-size:11px}
.pk3-doc-actions button:hover{color:var(--gold-l);border-color:var(--gold)}
.pk3-doc-add{border:1.5px dashed var(--brd);padding:11px;text-align:center;border-radius:8px;color:var(--t3);cursor:pointer;font-size:12px;transition:all .15s ease;background:transparent}
.pk3-doc-add:hover{border-color:var(--gold);color:var(--gold-l);background:var(--gold-bg)}

/* Финансы */
.pk3-fin-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
.pk3-fin-card{background:var(--bg3);border:1px solid var(--brd-m);border-radius:12px;padding:12px 14px}
.pk3-fin-card label{font-size:10.5px;color:var(--t3);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:5px}
.pk3-fin-card .pk3-v{font-size:17px;color:var(--gold-l);font-weight:700;font-family:var(--ff-mono,monospace)}
.pk3-fin-card.pk3-margin .pk3-v{color:var(--ok-t)}

/* Sticky actions bar */
.pk3-actions-bar{position:sticky;bottom:0;padding:13px 24px;background:var(--bg2);backdrop-filter:blur(14px) saturate(140%);border-top:1px solid var(--brd);display:flex;gap:8px;z-index:5;flex-wrap:wrap}

/* Tags */
.pk3-tag{display:inline-block;padding:2px 8px;border-radius:9999px;font-size:10.5px;font-weight:700;letter-spacing:.3px}
.pk3-tag.pk3-ok{background:var(--ok-bg);color:var(--ok-t)}
.pk3-tag.pk3-warn{background:var(--warn-bg);color:var(--warn-t)}
.pk3-tag.pk3-err{background:var(--err-bg);color:var(--err-t)}
.pk3-tag.pk3-info{background:var(--info-bg);color:var(--info-t)}

/* Кнопки внутри pk3 */
.pk3-btn{padding:7px 14px;border-radius:8px;font-size:13px;font-weight:600;border:1px solid var(--brd);background:var(--bg2);color:var(--t1);cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-family:inherit;text-decoration:none;transition:all .15s ease}
.pk3-btn:hover{background:var(--bg3);border-color:var(--gold-border,var(--brd))}
.pk3-btn.pk3-gold{background:linear-gradient(180deg,var(--gold),var(--gold-h));color:#0a0a0a;border-color:var(--gold-h);font-weight:700}
.pk3-btn.pk3-gold:hover{filter:brightness(1.1)}
.pk3-btn.pk3-ghost{background:transparent}
.pk3-btn.pk3-danger{color:var(--err-t);border-color:var(--err)}
.pk3-btn.pk3-danger:hover{background:var(--err-bg)}
.pk3-btn.pk3-ok{background:var(--ok);color:#0a0a0a;border-color:var(--ok);font-weight:700}
.pk3-btn.pk3-sm{padding:5px 10px;font-size:12px}

/* === MODALS (5 штук) === */
.pk3-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:500;display:none;align-items:center;justify-content:center;backdrop-filter:blur(6px);padding:30px}
.pk3-modal-overlay.pk3-show{display:flex}
.pk3-modal{background:var(--bg1);border:1px solid var(--brd);border-radius:16px;width:92vw;max-width:1100px;height:88vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.55)}
.pk3-modal-head{padding:14px 22px;border-bottom:1px solid var(--brd-m);display:flex;align-items:center;gap:11px;background:var(--bg2)}
.pk3-modal-head h3{font-family:'Cinzel',Georgia,serif;font-size:16px;color:var(--t1);flex:1;margin:0;font-weight:700}
.pk3-modal-body{flex:1;overflow-y:auto;padding:22px 24px;scroll-behavior:smooth}
.pk3-modal-foot{padding:13px 22px;border-top:1px solid var(--brd-m);display:flex;gap:10px;align-items:center;background:var(--bg2);flex-wrap:wrap}

/* Quick wizard */
.pk3-wiz-steps{display:flex;gap:0;margin-bottom:22px;background:var(--brd-m);border-radius:8px;overflow:hidden}
.pk3-wiz-step{flex:1;padding:11px 8px;text-align:center;font-size:12px;background:var(--bg2);color:var(--t3);position:relative;font-weight:500}
.pk3-wiz-step.pk3-done{background:var(--ok-bg);color:var(--ok-t)}
.pk3-wiz-step.pk3-now{background:var(--gold-bg);color:var(--gold-l);font-weight:800;box-shadow:inset 0 -3px 0 var(--gold)}
.pk3-wiz-step .pk3-num{display:inline-block;width:20px;height:20px;border-radius:10px;background:var(--bg4);color:var(--t2);font-size:11px;font-weight:700;line-height:20px;margin-right:6px}
.pk3-wiz-step.pk3-done .pk3-num{background:var(--ok);color:#0a0a0a}
.pk3-wiz-step.pk3-now .pk3-num{background:var(--gold);color:#0a0a0a}

.pk3-smeta-table{width:100%;border-collapse:collapse;font-size:12.5px;background:var(--bg2);border:1px solid var(--brd-m);border-radius:8px;overflow:hidden}
.pk3-smeta-table th{text-align:left;padding:8px 6px;color:var(--t3);font-size:11px;font-weight:700;text-transform:uppercase;background:var(--bg3)}
.pk3-smeta-table td{padding:7px 6px;color:var(--t2);border-bottom:1px solid var(--brd-m)}
.pk3-smeta-table tr:last-child td{border-bottom:none}
.pk3-smeta-table td.pk3-right{text-align:right}
.pk3-smeta-table th.pk3-right{text-align:right}

/* Conductor */
.pk3-cond-grid{display:grid;grid-template-columns:200px 1fr;gap:18px}
.pk3-cond-side{font-size:11.5px}
.pk3-cond-side .pk3-cond-title{font-size:11px;color:var(--t3);text-transform:uppercase;margin-bottom:8px;letter-spacing:.5px}
.pk3-cond-msg{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--brd-m)}
.pk3-cond-msg:last-child{border-bottom:none}
.pk3-cond-ava{width:32px;height:32px;border-radius:16px;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}
.pk3-cond-msg.pk3-ai .pk3-cond-ava{background:var(--gold-bg);color:var(--gold-l)}
.pk3-cond-msg.pk3-client .pk3-cond-ava{background:var(--info-bg);color:var(--info-t)}
.pk3-cond-msg.pk3-pm .pk3-cond-ava{background:var(--ok-bg);color:var(--ok-t)}
.pk3-cond-content{flex:1;min-width:0}
.pk3-cond-head{display:flex;gap:8px;align-items:center;margin-bottom:5px;font-size:11.5px}
.pk3-cond-name{font-weight:700;color:var(--t1)}
.pk3-cond-time{color:var(--t3);font-size:11px}
.pk3-cond-text{font-size:13px;color:var(--t2);line-height:1.6}
.pk3-cond-status{font-size:10px;padding:2px 7px;border-radius:9999px;margin-left:auto;font-weight:700}
.pk3-cond-status.pk3-draft{background:var(--bg3);color:var(--t3)}
.pk3-cond-status.pk3-sent{background:var(--ok-bg);color:var(--ok-t)}
.pk3-cond-status.pk3-received{background:var(--info-bg);color:var(--info-t)}

/* References */
.pk3-ref-row{display:grid;grid-template-columns:1fr 100px 100px 80px 100px 80px;gap:10px;align-items:center;padding:11px 14px;background:var(--bg2);border:1px solid var(--brd-m);border-radius:8px;margin-bottom:7px;font-size:12.5px}
.pk3-ref-row.pk3-head{background:var(--bg3);font-weight:700;font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.4px}
.pk3-ref-row .pk3-name{font-weight:700;color:var(--t1)}
.pk3-ref-row .pk3-name-sub{font-size:11px;color:var(--t3);margin-top:2px}
.pk3-ref-row .pk3-num{font-family:var(--ff-mono,monospace);color:var(--gold-l);text-align:right}
.pk3-ref-row .pk3-pct.pk3-good{color:var(--ok-t)}
.pk3-ref-row .pk3-pct.pk3-bad{color:var(--err-t)}

/* TKP constructor */
.pk3-tkp-layout{display:grid;grid-template-columns:300px 1fr;gap:16px;height:100%}
.pk3-tkp-blocks{background:var(--bg2);border:1px solid var(--brd);border-radius:8px;padding:12px;overflow-y:auto}
.pk3-tkp-blocks h4{font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.6px;margin-bottom:9px;font-weight:700}
.pk3-tkp-block-item{display:flex;align-items:center;gap:8px;padding:9px 11px;background:var(--bg3);border:1px solid var(--brd-m);border-radius:6px;margin-bottom:5px;cursor:grab;transition:all .15s ease}
.pk3-tkp-block-item:hover{border-color:var(--gold);background:var(--bg4)}
.pk3-tkp-block-item.pk3-active{border-color:var(--gold);background:var(--gold-bg);box-shadow:0 0 0 2px var(--gold-bg)}
.pk3-tkp-block-item .pk3-bic{font-size:13px;color:var(--gold)}
.pk3-tkp-block-item .pk3-bname{flex:1;font-size:12px;color:var(--t1)}
.pk3-tkp-block-item .pk3-bactions{display:flex;gap:3px}
.pk3-tkp-block-item .pk3-bactions button{width:22px;height:22px;border-radius:4px;border:1px solid var(--brd-m);background:transparent;color:var(--t3);font-size:10px;cursor:pointer}
.pk3-tkp-block-item .pk3-bactions button:hover{color:var(--err-t);border-color:var(--err)}
.pk3-tkp-add{margin-top:8px;padding-top:9px;border-top:1px solid var(--brd-m)}
.pk3-tkp-add-options{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:5px}
.pk3-tkp-add-options button{padding:6px 8px;background:var(--bg3);border:1px solid var(--brd-m);border-radius:6px;color:var(--t2);font-size:10.5px;cursor:pointer;text-align:left;transition:all .15s ease}
.pk3-tkp-add-options button:hover{border-color:var(--gold);color:var(--gold-l)}
.pk3-tkp-preview{background:#f7f3e8;color:#2a1f0a;border-radius:8px;padding:30px 40px;overflow-y:auto;box-shadow:inset 0 0 30px rgba(0,0,0,.05);font-family:'Times New Roman',Georgia,serif;font-size:13px}
.pk3-tkp-preview h1{font-family:'Cinzel',Georgia,serif;font-size:22px;color:#5a3a0a;margin-bottom:6px;text-align:center;font-weight:700}
.pk3-tkp-preview .pk3-tkp-num{text-align:center;color:#7a5a22;font-size:13px;margin-bottom:22px;letter-spacing:.5px}
.pk3-tkp-preview h2{font-family:'Cinzel',Georgia,serif;font-size:15px;color:#5a3a0a;margin:18px 0 8px;border-bottom:1px solid #cdb87e;padding-bottom:5px}
.pk3-tkp-preview p{margin-bottom:9px;line-height:1.7}
.pk3-tkp-preview table{width:100%;border-collapse:collapse;margin:10px 0 16px}
.pk3-tkp-preview table th,.pk3-tkp-preview table td{padding:7px 10px;border:1px solid #b89860;text-align:left}
.pk3-tkp-preview table th{background:#e8d8a8;font-family:'Cinzel',Georgia,serif;font-size:12px;font-weight:600;color:#3d2a08}
.pk3-tkp-preview table tfoot td{background:#f5e9c0;font-weight:600}
.pk3-tkp-preview .pk3-right{text-align:right}
.pk3-tkp-preview ul{padding-left:22px;line-height:1.7}
.pk3-tkp-preview ul li{margin-bottom:4px}
.pk3-tkp-preview .pk3-sign-block{display:flex;justify-content:space-between;margin-top:28px;padding-top:16px;border-top:2px solid #b89860;font-size:12px}
.pk3-tkp-preview .pk3-sign-block > div{flex:1}
.pk3-tkp-preview .pk3-sign-line{height:1px;background:#3d2a08;margin:24px 0 5px}

/* Compose (send modal) */
.pk3-compose-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;height:100%}
.pk3-compose-form{background:var(--bg2);border:1px solid var(--brd);border-radius:8px;padding:16px;overflow-y:auto}
.pk3-compose-preview{background:#f7f3e8;color:#2a1f0a;border-radius:8px;padding:20px 24px;overflow-y:auto;font-family:'Times New Roman',Georgia,serif;font-size:13px;line-height:1.65}

@media (max-width: 1080px){
  .pk3-tkp-layout,.pk3-compose-grid,.pk3-cond-grid{grid-template-columns:1fr}
  .pk3-fin-grid{grid-template-columns:repeat(2,1fr)}
  .pk3-calc-panel{grid-template-columns:1fr}
}
@media (max-width: 768px){
  .pk3-col{flex:0 0 240px}
  .pk3-drawer{width:100vw}
  .pk3-row{grid-template-columns:1fr}
  .pk3-row label{padding-top:0}
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

    const viewToggle = `<div class="pk3-view-toggle">
        <button data-mode="substages" class="${_viewMode === 'substages' ? 'pk3-active' : ''}" title="Группировка по под-этапам">📋 По под-этапам</button>
        <button data-mode="v3" class="${_viewMode === 'v3' ? 'pk3-active' : ''}" title="Группировка по воронке (Сага Тендеров V3)">📊 По воронке</button>
      </div>`;

    return `<div class="pk-page">
      <div class="pk-head">
        <div class="pk-tabs">${tabs}</div>
        <div class="pk-actions">
          ${viewToggle}
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

    // Wave A — BUG-6 онбординг: если 0 substages но есть unplaced карты —
    // верхний баннер с подсказкой что создать подэтапы.
    let onboardingBanner = '';
    if (subs.length === 0 && unplaced.length > 0) {
      onboardingBanner = `
        <div style="margin-bottom:12px;padding:12px 14px;background:var(--gold-bg);border:1px solid var(--gold);border-radius:10px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <div style="font-size:24px">💡</div>
          <div style="flex:1;min-width:200px">
            <div style="font-size:13px;color:var(--text-primary);font-weight:600">У вас ${unplaced.length} карт в «Не размещено»</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:2px">Создайте свои подэтапы (например: «Изучить ТЗ» / «Связаться с клиентом» / «Готов передать») — карты переставите туда и будет видно где они стоят.</div>
          </div>
          <button class="btn primary" id="pk-onb-cta">⚙ Настроить подэтапы</button>
        </div>`;
    }

    const html = onboardingBanner +
                 subs.map(s => htmlColumn(s, map.get(s.id) || [])).join('') +
                 htmlUnplacedColumn(unplaced);
    board.innerHTML = html;
    const onbCta = $('#pk-onb-cta');
    if (onbCta) onbCta.addEventListener('click', openConfigurator);
    _bindBoard();
  }

  function renderPage() {
    if (_viewMode === 'v3') {
      _renderV3Page();
      return;
    }
    const flow = getFlow(_flowKey);
    if (!_mainStatus || !flow.mainStatuses.includes(_mainStatus)) {
      // Выбираем первый статус с картами или substages, иначе первый
      const withCards = flow.mainStatuses.find(ms => getCardsFor(_flowKey, ms).length > 0);
      const withSubs = flow.mainStatuses.find(ms => getSubstagesFor(_flowKey, ms).length > 0);
      _mainStatus = withCards || withSubs || flow.mainStatuses[0];
    }
    const root = $('#pk-root');
    if (!root) return;
    root.innerHTML = htmlPage() + _pk3ViewToggleHtml();
    _bindHead();
    _bindViewToggle();
    renderBoard();
  }

  // === v3 view toggle ===
  function _pk3ViewToggleHtml() {
    return ''; // включён в htmlPage отдельно — здесь чтобы не дублить
  }

  function _bindViewToggle() {
    $$('.pk3-view-toggle button').forEach(b => {
      b.addEventListener('click', () => {
        const mode = b.dataset.mode;
        if (!mode || mode === _viewMode) return;
        _viewMode = mode;
        try { localStorage.setItem('asg_pk_view', mode); } catch (_) {}
        renderPage();
      });
    });
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

  // ── Модалка карты: детали сущности + история + кнопки действий (Wave A) ──
  // BUG-2/3/9 fix: грузим полную заявку через /api/inbox-applications/:id —
  // AI summary, attachments, body preview + кнопки Принять/Отклонить/Архив для PM.
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

        <div id="pk-card-detail">${AsgardUI.skeleton('text', 5)}</div>

        <div id="pk-card-actions" style="display:flex;gap:8px;flex-wrap:wrap"></div>

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
        // Параллельно: детали + история
        await Promise.all([
          loadCardEntityDetail(card),
          loadCardHistory(card)
        ]);
      }
    });
  }

  // ── Wave A: загрузка деталей сущности + кнопки действий ────────────────
  async function loadCardEntityDetail(card) {
    const detailEl = $('#pk-card-detail');
    const actionsEl = $('#pk-card-actions');
    if (!detailEl) return;

    // Inbox-application detail: GET /api/inbox-applications/:id
    if (card.entity_kind === 'inbox_application') {
      const r = await apiInbox(`/${card.entity_id}`);
      if (!r.ok || !r.data?.item) {
        detailEl.innerHTML = `<div class="pk-empty">Не удалось загрузить детали заявки</div>`;
        renderCardActionsForCard(card, actionsEl);
        return;
      }
      const item = r.data.item;
      const atts = r.data.attachments || [];

      // AI badge + summary
      const colorMap = { green: '#27ae60', yellow: '#f39c12', red: '#e74c3c' };
      const badgeColor = colorMap[item.ai_color] || '#8a93a6';
      const sourceKindLabel = ({
        corporate_forward: '🔁 От сотрудника (форвард)',
        external_direct:   '🌐 Внешний клиент напрямую',
        platform:          '🏢 С тендерной площадки',
        manual:            '✋ Прямая заявка',
        unknown:           '❓ Источник не определён'
      })[item.source_kind] || item.source_kind || '';

      const forwardedBlock = (item.source_kind === 'corporate_forward' && item.forwarded_from_email) ? `
        <div style="font-size:11px;color:var(--text-secondary);margin-top:4px">
          Переслал: <b>${esc(item.forwarded_from_email)}</b>
          ${item.original_sender_email ? ` · Клиент: <b>${esc(item.original_sender_email)}</b> ${item.original_sender_name ? '(' + esc(item.original_sender_name) + ')' : ''}` : ''}
        </div>` : '';

      const summaryBlock = item.ai_summary ? `
        <div style="margin-top:8px;padding:8px 10px;background:var(--bg-elevated);border-left:3px solid ${badgeColor};border-radius:6px">
          <div style="font-size:11px;color:var(--text-secondary);font-weight:600">AI-резюме</div>
          <div style="font-size:13px;color:var(--text-primary);margin-top:4px;line-height:1.4">${esc(item.ai_summary)}</div>
          ${item.ai_recommendation ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:6px"><b>Рекомендация:</b> ${esc(item.ai_recommendation)}</div>` : ''}
        </div>` : '';

      const bodyPreview = (item.body_preview || item.email_body_text || '').toString();
      const bodyBlock = bodyPreview ? `
        <div style="margin-top:8px">
          <div style="font-size:11px;color:var(--text-secondary);font-weight:600;margin-bottom:4px">Текст письма (первые 400 символов)</div>
          <div style="font-size:12px;color:var(--text-primary);line-height:1.4;white-space:pre-wrap;max-height:120px;overflow-y:auto;padding:6px 8px;background:var(--bg-elevated);border-radius:6px">${esc(bodyPreview.slice(0, 400))}${bodyPreview.length > 400 ? '…' : ''}</div>
        </div>` : '';

      const _tk = encodeURIComponent(localStorage.getItem('asgard_token') || '');
      const attsBlock = atts.length ? `
        <div style="margin-top:10px">
          <div style="font-size:11px;color:var(--text-secondary);font-weight:600;margin-bottom:6px">Вложения · ${atts.length}</div>
          <div style="display:flex;flex-direction:column;gap:4px">
            ${atts.map(a => `
              <a href="/api/inbox-applications/${item.id}/attachments/${a.id}/download?token=${_tk}" target="_blank"
                 style="display:flex;align-items:center;gap:6px;padding:6px 8px;background:var(--bg-elevated);border-radius:6px;text-decoration:none;color:var(--text-primary);font-size:12px">
                📎 <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.original_filename || a.filename)}</span>
                <span style="color:var(--text-secondary);font-size:10px">${formatBytes(a.size)}</span>
              </a>`).join('')}
          </div>
        </div>` : '';

      detailEl.innerHTML = `
        <div>
          <span style="display:inline-block;padding:2px 8px;background:${badgeColor};color:#fff;border-radius:6px;font-size:11px;font-weight:600">${esc((item.ai_classification || 'unknown').replace(/_/g,' '))}</span>
          ${sourceKindLabel ? `<span style="margin-left:6px;font-size:11px;color:var(--text-secondary)">${sourceKindLabel}</span>` : ''}
        </div>
        ${forwardedBlock}
        ${summaryBlock}
        ${bodyBlock}
        ${attsBlock}
      `;

      renderCardActionsForCard(card, actionsEl, item);
      return;
    }

    // ── Wave B: Pre-tender — полная детальная карточка с переходами ───────
    if (card.entity_kind === 'pre_tender') {
      const r = await apiPreTender(`/${card.entity_id}`);
      if (!r.ok || !r.data?.item) {
        detailEl.innerHTML = `<div class="pk-empty">Не удалось загрузить просчёт</div>`;
        renderCardActionsForCard(card, actionsEl);
        return;
      }
      const item = r.data.item;
      const atts = r.data.attachments || [];
      const tk = encodeURIComponent(localStorage.getItem('asgard_token') || '');

      const colorMap = { green: '#27ae60', yellow: '#f39c12', red: '#e74c3c' };
      const badgeColor = colorMap[item.ai_color] || '#8a93a6';

      const statusLabels = {
        new:'🆕 Новая', in_review:'🔍 На рассмотрении', need_docs:'📄 Запрошены доки',
        accepted:'✓ Принят (создан тендер)', rejected:'✕ Отклонён', expired:'⌛ Просрочен',
        pending_approval:'⏳ Ожидает согласования', approved:'✓ Согласован',
        pending_payment:'💸 Ожидает оплаты', paid:'💰 Оплачен',
        cash_issued:'💵 Кэш выдан', cash_received:'💵 Кэш получен',
        expense_reported:'📊 Отчёт сдан'
      };

      const summaryBlock = item.ai_summary ? `
        <div style="margin-top:8px;padding:8px 10px;background:var(--bg-elevated);border-left:3px solid ${badgeColor};border-radius:6px">
          <div style="font-size:11px;color:var(--text-secondary);font-weight:600">AI-резюме</div>
          <div style="font-size:13px;color:var(--text-primary);margin-top:4px;line-height:1.4">${esc(item.ai_summary)}</div>
          ${item.ai_recommendation ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:6px"><b>Рекомендация:</b> ${esc(item.ai_recommendation)}</div>` : ''}
        </div>` : '';

      const clientBlock = `
        <div style="margin-top:8px;padding:8px 10px;background:var(--bg-elevated);border-radius:6px;font-size:12px;line-height:1.5">
          <div><b>Клиент:</b> ${esc(item.customer_name || '—')}${item.customer_email ? ' · ' + esc(item.customer_email) : ''}</div>
          ${item.customer_inn ? `<div><b>ИНН:</b> ${esc(item.customer_inn)}</div>` : ''}
          ${item.contact_person ? `<div><b>Контакт:</b> ${esc(item.contact_person)}${item.contact_phone ? ' · ' + esc(item.contact_phone) : ''}</div>` : ''}
        </div>`;

      const workBlock = `
        <div style="margin-top:8px;font-size:12px;line-height:1.5">
          ${item.work_description ? `<div><b>Описание работ:</b><br>${esc(item.work_description.slice(0, 600))}${item.work_description.length > 600 ? '…' : ''}</div>` : ''}
          ${item.work_location ? `<div style="margin-top:4px"><b>Объект:</b> ${esc(item.work_location)}</div>` : ''}
          ${item.work_deadline ? `<div style="margin-top:4px"><b>Срок:</b> ${esc(String(item.work_deadline).slice(0, 10))}</div>` : ''}
          ${item.estimated_sum ? `<div style="margin-top:4px"><b>Бюджет (оценка):</b> ${Number(item.estimated_sum).toLocaleString('ru-RU')} ₽</div>` : ''}
        </div>`;

      // Wave D BUG-8: документы — email_attachments (если есть email_id) +
      // manual_documents JSONB (uploaded через UI). Каждый кликабельный download-link.
      const manualDocs = Array.isArray(item.manual_documents) ? item.manual_documents : [];
      // Унифицированный список с источником в _src и индексом в _idx (для manual_docs).
      const allDocs = atts.map(a => ({
        _src: 'email', _id: a.id, name: a.original_filename || a.filename || 'файл',
        size: a.size, mime_type: a.mime_type
      })).concat(manualDocs.map((md, idx) => ({
        _src: 'manual', _idx: idx, name: md.original_name || md.filename || 'документ',
        size: md.size, mime_type: md.mime_type
      })));
      const _tkPT = encodeURIComponent(localStorage.getItem('asgard_token') || '');
      const attsBlockPT = allDocs.length ? `
        <div style="margin-top:10px">
          <div style="font-size:11px;color:var(--text-secondary);font-weight:600;margin-bottom:6px">Документы · ${allDocs.length}</div>
          <div style="display:flex;flex-direction:column;gap:4px">
            ${allDocs.map(a => {
              // Wave A+ fix BLOCKER#2: email-attachments под pre_tender идут через
              // /api/pre-tenders/:ptId/email-attachments/:attId/download (новый endpoint),
              // а не через /inbox-applications/0/... (хардкод appId=0 давал 404).
              const href = a._src === 'email'
                ? `/api/pre-tenders/${card.entity_id}/email-attachments/${a._id}/download?token=${_tkPT}`
                : `/api/pre-tenders/${card.entity_id}/documents/${a._idx}/download?token=${_tkPT}`;
              const tag = a._src === 'email' ? '📧' : '📤';
              return `<a href="${href}" target="_blank"
                 style="display:flex;align-items:center;gap:6px;padding:6px 8px;background:var(--bg-elevated);border-radius:6px;text-decoration:none;color:var(--text-primary);font-size:12px">
                ${tag} <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.name)}</span>
                <span style="color:var(--text-secondary);font-size:10px">${a.size ? formatBytes(a.size) : ''}</span>
              </a>`;
            }).join('')}
          </div>
        </div>` : '';

      detailEl.innerHTML = `
        <div>
          <span style="display:inline-block;padding:2px 8px;background:${badgeColor};color:#fff;border-radius:6px;font-size:11px;font-weight:600">PRE-TENDER</span>
          <span style="margin-left:6px;font-size:11px;color:var(--text-secondary)">${esc(statusLabels[item.status] || item.status || '')}</span>
        </div>
        ${clientBlock}
        ${workBlock}
        ${summaryBlock}
        ${attsBlockPT}
      `;
      renderCardActionsForCard(card, actionsEl, item);
      return;
    }

    // Tender / work — расширим позже.
    detailEl.innerHTML = `
      <div style="font-size:12px;color:var(--text-secondary)">
        Детали: <b>${esc(entityLabel(card))} #${card.entity_id}</b>
      </div>`;
    renderCardActionsForCard(card, actionsEl);
  }

  // ── Wave A: кнопки действий по entity_kind ─────────────────────────────
  function renderCardActionsForCard(card, actionsEl, detailItem) {
    if (!actionsEl) return;
    const universalButtons = `
      <button class="btn ghost" id="pk-card-transfer">↻ Передать другому РП</button>
      <button class="btn ghost" id="pk-card-note">＋ Заметка</button>
      <button class="btn ghost" id="pk-card-remind">⏰ Напоминание</button>
    `;

    let entityButtons = '';
    if (card.entity_kind === 'inbox_application' && detailItem) {
      const st = (detailItem.status || '').toLowerCase();
      const openStatuses = ['new','ai_processed','under_review','assigned'];
      if (openStatuses.includes(st)) {
        entityButtons = `
          <button class="btn primary" id="pk-act-accept">✓ Принять и завести просчёт</button>
          <button class="btn warn" id="pk-act-reject">✕ Отклонить</button>
          <button class="btn ghost" id="pk-act-archive">🗑 Архив</button>
        `;
      } else if (st === 'accepted' && detailItem.linked_tender_id) {
        entityButtons = `
          <a class="btn primary" href="#/tenders/${detailItem.linked_tender_id}">→ Перейти к тендеру #${detailItem.linked_tender_id}</a>
        `;
      }
    } else if (card.entity_kind === 'pre_tender' && detailItem) {
      // Wave B: pre_tender кнопки по статусу
      const st = (detailItem.status || '').toLowerCase();
      if (['new','in_review'].includes(st)) {
        entityButtons = `
          <button class="btn primary" id="pk-pt-accept">✓ Принять и создать тендер</button>
          <button class="btn ghost" id="pk-pt-need-docs">📄 Запросить доки</button>
          <button class="btn warn" id="pk-pt-reject">✕ Отклонить</button>
        `;
      } else if (st === 'need_docs') {
        entityButtons = `
          <button class="btn primary" id="pk-pt-back-review">🔄 Доки получены (в рассмотрение)</button>
          <button class="btn primary" id="pk-pt-accept">✓ Принять и создать тендер</button>
          <button class="btn warn" id="pk-pt-reject">✕ Отклонить</button>
        `;
      } else if (st === 'accepted' && detailItem.created_tender_id) {
        entityButtons = `
          <a class="btn primary" href="#/tenders/${detailItem.created_tender_id}">→ Перейти к тендеру #${detailItem.created_tender_id}</a>
        `;
      } else if (st === 'rejected') {
        entityButtons = `
          <div style="font-size:12px;color:var(--text-secondary)">Отклонён${detailItem.reject_reason ? ': ' + esc(detailItem.reject_reason) : ''}</div>
        `;
      }
    }

    actionsEl.innerHTML = entityButtons + universalButtons;

    // bind universal
    $('#pk-card-transfer')?.addEventListener('click', () => openTransferModal(card));
    $('#pk-card-note')?.addEventListener('click', () => openAddNoteModal(card));
    $('#pk-card-remind')?.addEventListener('click', () => openAddReminderModal(card));

    // bind inbox actions
    $('#pk-act-accept')?.addEventListener('click', () => doInboxAction(card, 'accept', detailItem));
    $('#pk-act-reject')?.addEventListener('click', () => doInboxAction(card, 'reject', detailItem));
    $('#pk-act-archive')?.addEventListener('click', () => doInboxAction(card, 'archive', detailItem));

    // Wave B: bind pre_tender actions
    $('#pk-pt-accept')?.addEventListener('click', () => doPreTenderAction(card, 'accept', detailItem));
    $('#pk-pt-reject')?.addEventListener('click', () => doPreTenderAction(card, 'reject', detailItem));
    $('#pk-pt-need-docs')?.addEventListener('click', () => doPreTenderAction(card, 'request-docs', detailItem));
    $('#pk-pt-back-review')?.addEventListener('click', () => doPreTenderAction(card, 'back-to-review', detailItem));
  }

  // Wave B: действия по pre-tender
  async function doPreTenderAction(card, action, detailItem) {
    let r;
    if (action === 'accept') {
      if (!window.confirm('Принять просчёт и создать тендер? Карта канбана сконвертируется в Тендеры.')) return;
      const noteVal = window.prompt('Комментарий (опц.)') || '';
      r = await apiPreTender(`/${card.entity_id}/accept`, { method: 'POST', body: noteVal ? { decision_comment: noteVal.trim() } : {} });
      if (r.ok) toast('Готово', 'Просчёт принят, тендер создан', 'ok');
    } else if (action === 'reject') {
      const reason = window.prompt('Причина отказа?');
      if (!reason || !reason.trim()) return;
      r = await apiPreTender(`/${card.entity_id}/reject`, { method: 'POST', body: { reject_reason: reason.trim() } });
      if (r.ok) toast('Готово', 'Просчёт отклонён', 'ok');
    } else if (action === 'request-docs') {
      const what = window.prompt('Что именно запросить у клиента?');
      if (!what || !what.trim()) return;
      r = await apiPreTender(`/${card.entity_id}/request-docs`, { method: 'POST', body: { request_text: what.trim() } });
      if (r.ok) toast('Готово', 'Запрос отправлен', 'ok');
    } else if (action === 'back-to-review') {
      r = await apiPreTender(`/${card.entity_id}`, { method: 'PUT', body: { status: 'in_review' } });
      if (r.ok) toast('Готово', 'Возвращено в рассмотрение', 'ok');
    }
    if (!r || !r.ok) {
      toast('Ошибка', (r?.data?.error || r?.data?.message || 'Не удалось выполнить'), 'err');
      return;
    }
    hideModal();
    await loadAll();
  }

  // ── Wave A/B: действие по заявке ──────────────────────────────────────
  // Wave B: accept теперь ведёт через /to-pre-tender (не legacy /accept):
  //   создаётся pre_tender_request с правильными данными, карта канбана
  //   конвертируется в entity_kind='pre_tender', flow='pre_tender', main='new'.
  async function doInboxAction(card, action, detailItem) {
    let body = null;
    let confirmText = '';
    let path = action; // /accept | /reject | /archive
    let okMsg = '';

    if (action === 'accept') {
      // Wave B: вместо /accept → /to-pre-tender
      path = 'to-pre-tender';
      confirmText = 'Завести просчёт (pre-tender) на основе заявки? Карта канбана сконвертируется в Пре-тендеры.';
      const noteVal = window.prompt('Комментарий к просчёту (опц.)') || '';
      body = noteVal ? { note: noteVal.trim() } : {};
      okMsg = 'Просчёт заведён';
    } else if (action === 'reject') {
      const reason = window.prompt('Причина отказа?');
      if (!reason || !reason.trim()) return;
      body = { reason: reason.trim() };
      okMsg = 'Заявка отклонена';
    } else if (action === 'archive') {
      confirmText = 'Архивировать заявку? Карта в канбане закроется.';
      body = {};
      okMsg = 'Заявка в архиве';
    }

    if (confirmText && !window.confirm(confirmText)) return;

    const r = await apiInbox(`/${card.entity_id}/${path}`, { method: 'POST', body });
    if (!r.ok) {
      const errMsg = r.data?.message || r.data?.error || `Не удалось выполнить ${action}`;
      toast('Ошибка', errMsg, 'err');
      return;
    }
    toast('Готово', okMsg, 'ok');
    hideModal();
    await loadAll();
  }

  // ── helper: размер файла ───────────────────────────────────────────────
  function formatBytes(n) {
    if (!Number.isFinite(n) || n < 0) return '?';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
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


/* ═══════════════════════════════════════════════════════════════════════════
 * ASGARD CRM — Личный канбан v3 (вид «По воронке»: 8 колонок)
 * Тот же файл, отдельный namespace, отдельный hash-роут /personal-kanban-v3.
 *
 * Механика и UX 1-в-1 как KANBAN-DEMO-V3.html, дизайн — наши токены.
 *
 * Endpoints (готовы на backend):
 *   GET  /api/personal-kanban/board?flow_filter=
 *   GET  /api/personal-kanban/columns/counts?flow_filter=
 *   POST /api/personal-kanban/cards/:id/transition {to_v3_column, note?, confirm?, version?}
 *   POST /api/personal-kanban/cards/:cardId/convert-to-pretender
 *   POST /api/personal-kanban/cards/:cardId/start-quick    → {session_uid}
 *   POST /api/personal-kanban/cards/:cardId/start-conductor → {run_id}
 *   GET  /api/mimir/references/search?work_type=&volume_min=&volume_max=&limit=
 *   POST /api/tkp/from-card/:cardId {template_kind?} → {tkp_id, blocks}
 *   GET  /api/tkp/:tkpId/blocks
 *   PUT  /api/tkp/:tkpId/blocks {blocks}
 *   POST /api/tkp/:tkpId/render-pdf → {pdf_path}
 *   POST /api/tkp/:tkpId/attach-to-card/:cardId
 *   POST /api/tkp/:cardId/send-tkp-to-client {tkp_id, to, cc?, subject, body_text, body_html?, attach_pdf, attach_estimate?}
 * ═══════════════════════════════════════════════════════════════════════════ */
window.AsgardPersonalKanbanV3 = (function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (window.AsgardUI && AsgardUI.esc) ? AsgardUI.esc : (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // toast backwards-compat (см. memory feedback-toast-api):
  function toast(title, msg, tone) {
    try {
      if (window.AsgardUI && typeof AsgardUI.toast === 'function') return AsgardUI.toast(title, msg, tone);
      if (window.toast) {
        if (typeof window.toast === 'function') return window.toast(title, msg, tone);
        const t = (tone === 'err' || tone === 'error') ? 'error' : (tone === 'warn' ? 'warning' : 'success');
        if (window.toast[t]) return window.toast[t](msg || title);
      }
      console.log('[toast]', title, msg);
    } catch (_) { console.log('[toast]', title, msg); }
  }

  // ── HTTP helpers ─────────────────────────────────────────────────────
  function _authHeaders() {
    const t = (() => { try { return localStorage.getItem('asgard_token'); } catch (_) { return null; } })();
    return t ? { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
  }
  async function api(path, opts) {
    const method = (opts && opts.method) || 'GET';
    const init = { method, headers: _authHeaders() };
    if (opts && opts.body) init.body = JSON.stringify(opts.body);
    const resp = await fetch(path, init);
    let data = null;
    try { data = await resp.json(); } catch (_) { data = null; }
    return { ok: resp.ok, status: resp.status, data };
  }

  // ── State ────────────────────────────────────────────────────────────
  let _layout = null;
  let _user = null;
  let _columns = { new: [], calc: [], approval: [], kp_prep: [], sent: [], addendum: [], win: [], lose: [], work: [] };
  let _counts = { new: 0, calc: 0, approval: 0, kp_prep: 0, sent: 0, addendum: 0, win: 0, lose: 0, work: 0, total: 0 };
  let _flowFilter = 'all';
  let _searchQ = '';
  let _draggingCardId = null;
  let _drawerEl = null;
  let _currentCard = null;
  let _modalStack = [];
  let _sseHandler = null;
  let _sseConnected = false;
  // S-15: scope-режим (HEAD_TO toggle Мои/Отдел, TO auto, PM owner)
  let _scopeMode = null; // 'owner' | 'to_personal' | 'to_team' | 'all' — derived from role+toggle

  // ── Колонки и константы ──────────────────────────────────────────────
  const COLS = [
    { id: 'new',      ic: '📥', title: 'Новые' },
    { id: 'calc',     ic: '🧮', title: 'Просчёт ТКП' },
    { id: 'approval', ic: '⚖️', title: 'На согласовании' },
    { id: 'kp_prep',  ic: '📋', title: 'КП готовится' },
    { id: 'sent',     ic: '📤', title: 'КП отправлено' },
    { id: 'addendum', ic: '❓', title: 'Дозапрос', cls: 'pk3-col-addendum' },
    { id: 'win',      ic: '🏆', title: 'Выиграно', cls: 'pk3-col-win' },
    { id: 'lose',     ic: '❌', title: 'Проиграно', cls: 'pk3-col-lose' },
    { id: 'work',     ic: '🏗', title: 'В работе' },
  ];
  const FLOW_TABS = [
    { id: 'all',         label: 'Все типы' },
    { id: 'application', label: '📥 Заявки' },
    { id: 'pre_tender',  label: '🗂 Пре-тендеры' },
    { id: 'tender',      label: '📋 Тендеры' },
    { id: 'work',        label: '🏗 Работы' },
  ];
  const STAGE_LABELS = ['📥 Новая', '🧮 Просчёт', '⚖️ Согл. дир', '📋 КП готов', '📤 КП ушло', '❓ Дозапрос', '🏆 Выигр.', '❌ Проигр.', '🏗 В работе'];
  const COL_TO_STAGE = { new: 0, calc: 1, approval: 2, kp_prep: 3, sent: 4, addendum: 5, win: 6, lose: 7, work: 8 };

  // S-15: scope helpers — определяет режим выборки по роли и (для HEAD_TO) toggle из LS
  function _computeScope() {
    const role = (_user && _user.role) || '';
    if (role === 'TO') return 'to_personal';
    if (role === 'HEAD_TO') {
      let toggle = 'team';
      try { toggle = localStorage.getItem('pk3_scope_toggle') || 'team'; } catch (_) {}
      return (toggle === 'mine') ? 'owner' : 'to_team';
    }
    // PM / HEAD_PM / ADMIN / DIRECTOR_* — owner-режим (бэкенд для admin/director сам решит, через scope=auto)
    return 'auto';
  }
  function _isToRole() {
    const role = (_user && _user.role) || '';
    return role === 'TO' || role === 'HEAD_TO';
  }
  function _scopeLabel() {
    const sc = _scopeMode || _computeScope();
    if (sc === 'to_personal') return 'Канбан · Мои тендеры (ТО)';
    if (sc === 'to_team')     return 'Канбан · Весь отдел ТО';
    if (sc === 'all')         return 'Канбан · Все (ADMIN)';
    return 'Канбан · полный цикл';
  }

  // ── CSS-инжект (наши токены --bg0..--bg5, --t1..--t3, --gold, --ok, etc.) ──
  function _injectV3Styles() {
    if (document.getElementById('asg-pk3-styles')) return;
    const css = `
/* === PK3: Личный канбан v3 — наша palette === */
.pk3-shell {
  display: flex; flex-direction: column; height: calc(100vh - 60px);
  background: var(--bg1); color: var(--t1);
  font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; font-size: 14px;
}
.pk3-shell *, .pk3-modal-overlay *, .pk3-drawer * { box-sizing: border-box; }

/* ── Top actions ── */
.pk3-top-actions {
  padding: 18px 22px 14px; display: flex; align-items: flex-end; gap: 14px;
  border-bottom: 1px solid var(--brd-m);
}
.pk3-top-actions .pk3-titles { flex: 1; }
.pk3-kicker {
  font-size: 11px; color: var(--gold); text-transform: uppercase;
  letter-spacing: 2px; font-weight: 600; margin-bottom: 3px;
}
.pk3-h2 {
  font-family: 'Cinzel', Georgia, serif; font-size: 22px; font-weight: 900;
  color: var(--t1); margin: 0 0 2px;
}
.pk3-h2-sub { font-size: 13px; color: var(--t3); }
.pk3-search-input {
  width: 280px; background: var(--bg2); border: 1px solid var(--brd);
  border-radius: 999px; padding: 7px 13px; color: var(--t1); font-size: 13px; outline: none;
}
.pk3-search-input:focus { border-color: var(--gold); box-shadow: 0 0 0 3px var(--gold-bg); }

/* ── Tabs (flow filter) ── */
.pk3-tabs-bar {
  display: flex; gap: 0; padding: 0 22px; border-bottom: 1px solid var(--brd-m);
  background: var(--bg2);
}
.pk3-tab {
  padding: 11px 17px; color: var(--t3); cursor: pointer; font-size: 13px;
  font-weight: 500; border-bottom: 2px solid transparent;
  display: inline-flex; align-items: center; gap: 7px; transition: all .15s;
}
.pk3-tab:hover { color: var(--t1); }
.pk3-tab.active { color: var(--gold-l); border-bottom-color: var(--gold); }
.pk3-cnt {
  background: var(--bg3); color: var(--t2); padding: 1px 7px;
  border-radius: 999px; font-size: 11px; font-weight: 600;
}
.pk3-tab.active .pk3-cnt { background: var(--gold); color: #1a1000; }

/* ── View toggle ── */
.pk3-view-toggle { display: inline-flex; background: var(--bg3); border-radius: 8px; padding: 2px; margin-right: 8px; }
.pk3-view-toggle button {
  padding: 6px 12px; background: transparent; border: 0; color: var(--t3);
  cursor: pointer; font-size: 12px; border-radius: 6px;
}
.pk3-view-toggle button.active { background: var(--bg1); color: var(--gold-l); }

/* ── Board ── */
.pk3-board {
  flex: 1; padding: 14px 14px 24px; display: flex; gap: 9px;
  overflow-x: auto; overflow-y: hidden; align-items: flex-start;
}
.pk3-col {
  flex: 0 0 252px; background: var(--bg2); border: 1px solid var(--brd);
  border-radius: 14px; overflow: hidden; display: flex; flex-direction: column;
  max-height: calc(100vh - 200px);
}
.pk3-col-head {
  padding: 11px 13px; display: flex; align-items: center; gap: 8px;
  border-bottom: 1px solid var(--brd-m);
  background: linear-gradient(180deg, var(--bg3), transparent);
}
.pk3-col-icon { font-size: 14px; }
.pk3-col-title { flex: 1; font-size: 12.5px; font-weight: 600; color: var(--t1); }
.pk3-col-count {
  font-size: 11px; color: var(--t3); background: var(--bg4);
  padding: 2px 8px; border-radius: 999px; font-weight: 600;
}
.pk3-col-body {
  padding: 8px; overflow-y: auto; flex: 1;
  display: flex; flex-direction: column; gap: 7px;
}
.pk3-col-body.pk3-drop-hover { background: var(--gold-bg); }
.pk3-col-win .pk3-col-head { background: linear-gradient(180deg, var(--ok-bg), transparent); }
.pk3-col-lose .pk3-col-head { background: linear-gradient(180deg, var(--err-bg), transparent); }
/* S-15: 9-я колонка «Дозапрос» — золотой акцент + pulse */
.pk3-col-addendum .pk3-col-head {
  background: linear-gradient(180deg, rgba(212,168,67,0.18), transparent);
  position: relative;
}
.pk3-col-addendum .pk3-col-head::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(circle at 50% 0%, rgba(212,168,67,.25), transparent 70%);
  animation: pk3-pulse 2s ease-in-out infinite;
}
@keyframes pk3-pulse { 0%,100%{opacity:.35} 50%{opacity:.9} }
.pk3-card-addendum-mark {
  position: absolute; top: 6px; right: 6px;
  background: var(--gold); color: #1a1000;
  font-size: 9px; font-weight: 700;
  padding: 2px 6px; border-radius: 999px;
  animation: pk3-pulse 1.5s ease-in-out infinite;
}
/* S-15: scope-toggle для HEAD_TO «Мои ↔ Отдел» */
.pk3-scope-toggle {
  display: inline-flex; background: var(--bg3); border-radius: 8px; padding: 2px;
  margin-right: 8px;
}
.pk3-scope-toggle button {
  padding: 6px 12px; background: transparent; border: 0; color: var(--t3);
  cursor: pointer; font-size: 12px; border-radius: 6px; font-family: inherit;
  transition: all .15s;
}
.pk3-scope-toggle button.active {
  background: var(--gold); color: #1a1000; font-weight: 600;
}
.pk3-scope-toggle button:not(.active):hover { color: var(--t1); }

/* ── Card ── */
.pk3-card {
  background: linear-gradient(160deg, var(--bg2), var(--bg3) 140%);
  border: 1px solid var(--brd); border-radius: 10px;
  padding: 10px 11px 8px; cursor: pointer; transition: all .2s;
  border-left: 3px solid var(--t3); position: relative;
  box-shadow: 0 2px 6px rgba(0,0,0,0.16);
}
.pk3-card:hover { transform: translateY(-2px); border-color: var(--gold); box-shadow: 0 6px 18px rgba(0,0,0,0.24); }
.pk3-card.pk3-dragging { opacity: .5; }
.pk3-card.pk3-green  { border-left-color: var(--ok); }
.pk3-card.pk3-yellow { border-left-color: var(--warn-t); }
.pk3-card.pk3-red    { border-left-color: var(--err); }
.pk3-card.pk3-win    { border-left-color: var(--ok); background: linear-gradient(160deg, var(--ok-bg), var(--bg3)); }
.pk3-card.pk3-lose   { border-left-color: var(--err); opacity: .7; }
.pk3-card-top { display: flex; align-items: center; gap: 5px; margin-bottom: 5px; }
.pk3-badge {
  font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 4px;
  letter-spacing: .4px; text-transform: uppercase;
}
.pk3-badge.pk3-app    { background: var(--gold-bg); color: var(--gold-l); }
.pk3-badge.pk3-pre    { background: var(--ok-bg);   color: var(--ok-t); }
.pk3-badge.pk3-tender { background: var(--info-bg); color: var(--info-t); }
.pk3-badge.pk3-work   { background: var(--err-bg);  color: var(--err-t); }
.pk3-card-id { font-size: 10px; color: var(--t3); font-family: 'JetBrains Mono', monospace; margin-left: auto; }
.pk3-card-title { font-size: 12.5px; font-weight: 600; line-height: 1.3; color: var(--t1); margin-bottom: 3px; }
.pk3-card-customer { font-size: 11px; color: var(--t2); margin-bottom: 7px; }
.pk3-card-meta { display: flex; flex-wrap: wrap; gap: 5px; font-size: 10px; color: var(--t3); }
.pk3-card-meta .pk3-pill {
  background: var(--bg3); padding: 1px 6px; border-radius: 999px;
  display: inline-flex; align-items: center; gap: 3px;
}
.pk3-card-progress { display: flex; gap: 2px; margin-top: 7px; }
.pk3-card-progress .pk3-dot { flex: 1; height: 3px; background: var(--bg4); border-radius: 1.5px; }
.pk3-card-progress .pk3-dot.pk3-done { background: var(--gold); }
.pk3-card-progress .pk3-dot.pk3-now  { background: var(--gold-l); box-shadow: 0 0 4px var(--gold); }

/* ── Drawer (920px right-side) ── */
.pk3-drawer-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 1100;
  backdrop-filter: blur(4px); display: none;
}
.pk3-drawer-overlay.show { display: block; }
.pk3-drawer {
  position: fixed; top: 0; right: 0; bottom: 0; width: 920px; max-width: 96vw;
  background: var(--bg1); border-left: 1px solid var(--brd);
  box-shadow: -12px 0 40px rgba(0,0,0,.5);
  overflow-y: auto; z-index: 1101; display: none;
  scroll-behavior: smooth; scroll-padding-top: 170px;
}
.pk3-drawer.show { display: block; animation: pk3-slidein .26s cubic-bezier(.16,1,.3,1); }
@keyframes pk3-slidein {
  from { transform: translateX(40px); opacity: 0; }
  to   { transform: translateX(0);     opacity: 1; }
}
.pk3-drawer-head {
  padding: 16px 24px 12px; border-bottom: 1px solid var(--brd-m);
  background: var(--bg1); position: sticky; top: 0; z-index: 5;
}
.pk3-drawer-head .pk3-row1 { display: flex; align-items: center; gap: 10px; margin-bottom: 7px; }
.pk3-drawer-head h2 { font-size: 17px; flex: 1; line-height: 1.3; font-family: 'Cinzel', serif; color: var(--t1); margin: 0; }
.pk3-drawer-head .pk3-meta { font-size: 11.5px; color: var(--t3); display: flex; gap: 13px; flex-wrap: wrap; }
.pk3-btn-icon {
  width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--brd);
  background: var(--bg2); color: var(--t2); cursor: pointer; font-size: 14px;
  display: inline-flex; align-items: center; justify-content: center;
}
.pk3-btn-icon:hover { background: var(--bg3); color: var(--t1); }

/* ── Stages (8 этапов в шапке drawer) ── */
.pk3-stages {
  display: flex; gap: 1px; margin: 12px 24px 0;
  background: var(--brd-m); border-radius: 10px; overflow: hidden;
}
.pk3-stage {
  flex: 1; padding: 8px 4px 9px; text-align: center; background: var(--bg2);
  color: var(--t3); font-size: 9.5px; font-weight: 500; position: relative;
}
.pk3-stage.pk3-done { background: var(--ok-bg); color: var(--ok-t); }
.pk3-stage.pk3-now {
  background: var(--gold-bg); color: var(--gold-l); font-weight: 700;
  box-shadow: inset 0 -3px 0 var(--gold);
}

/* ── In-drawer side-nav ── */
.pk3-drawer-nav {
  position: sticky; top: 122px; z-index: 4;
  background: var(--bg1); padding: 7px 24px;
  border-bottom: 1px solid var(--brd-m); margin-bottom: 12px;
  display: flex; gap: 5px; overflow-x: auto;
}
.pk3-dnav-link {
  padding: 4px 10px; background: var(--bg2); border: 1px solid var(--brd-m);
  border-radius: 999px; color: var(--t3); font-size: 11px; cursor: pointer;
  white-space: nowrap; transition: all .15s;
}
.pk3-dnav-link:hover { background: var(--bg3); color: var(--t1); }

/* ── Section accordion ── */
.pk3-section {
  margin: 0 24px 14px; background: var(--bg2); border: 1px solid var(--brd-m);
  border-radius: 14px; overflow: hidden;
  box-shadow: 0 4px 16px rgba(0,0,0,0.18);
  scroll-margin-top: 170px;
}
.pk3-section-head {
  padding: 11px 16px; display: flex; align-items: center; gap: 8px;
  border-bottom: 1px solid var(--brd-m); cursor: pointer; user-select: none;
}
.pk3-section-head .pk3-ico { font-size: 14px; color: var(--gold); }
.pk3-section-head h3 {
  font-size: 12px; font-weight: 600; color: var(--t1); flex: 1; margin: 0;
  letter-spacing: .3px; text-transform: uppercase;
}
.pk3-section-head .pk3-chev { color: var(--t3); font-size: 11px; }
.pk3-section-head .pk3-count {
  background: var(--bg3); color: var(--t2); padding: 1px 7px;
  border-radius: 999px; font-size: 10px; font-weight: 600;
}
.pk3-section-body { padding: 12px 16px; }

/* ── Row form ── */
.pk3-row {
  display: grid; grid-template-columns: 150px 1fr; gap: 8px 14px;
  margin-bottom: 9px; align-items: start;
}
.pk3-row label { color: var(--t3); font-size: 11.5px; padding-top: 7px; }
.pk3-row input, .pk3-row select, .pk3-row textarea {
  width: 100%; background: var(--bg1); border: 1px solid var(--brd);
  border-radius: 6px; padding: 7px 10px; color: var(--t1); font-size: 13px;
  font-family: inherit; outline: none;
}
.pk3-row input:focus, .pk3-row select:focus, .pk3-row textarea:focus {
  border-color: var(--gold); box-shadow: 0 0 0 3px var(--gold-bg);
}
.pk3-row textarea { resize: vertical; min-height: 56px; }
.pk3-twocol { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }

/* ── AI block ── */
.pk3-ai-block {
  background: var(--ok-bg); border-left: 3px solid var(--ok);
  padding: 11px 13px; border-radius: 0 10px 10px 0;
  color: var(--t1); font-size: 12.5px; line-height: 1.55;
}

/* ── Calc panel (3 cards) ── */
.pk3-calc-panel { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 9px; margin-bottom: 12px; }
.pk3-calc-card {
  background: var(--bg2); border: 1px solid var(--brd-m); border-radius: 10px;
  padding: 12px; cursor: pointer; transition: all .15s; text-align: center;
}
.pk3-calc-card:hover {
  border-color: var(--gold); background: var(--bg3); transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
}
.pk3-calc-card .pk3-ic { font-size: 22px; display: block; margin-bottom: 5px; }
.pk3-calc-card .pk3-title { font-size: 12.5px; font-weight: 600; color: var(--t1); margin-bottom: 3px; }
.pk3-calc-card .pk3-sub { font-size: 10.5px; color: var(--t3); line-height: 1.4; }
.pk3-calc-card.pk3-q .pk3-ic { color: var(--info); }
.pk3-calc-card.pk3-c .pk3-ic { color: #8B5CF6; }
.pk3-calc-card.pk3-r .pk3-ic { color: var(--gold-l); }

/* ── Doc rows ── */
.pk3-doc-group { margin-bottom: 13px; }
.pk3-doc-group:last-child { margin-bottom: 0; }
.pk3-doc-group h4 {
  font-size: 10.5px; color: var(--t3); text-transform: uppercase;
  letter-spacing: .5px; margin: 0 0 6px; font-weight: 600;
}
.pk3-doc-row {
  display: flex; align-items: center; gap: 9px; padding: 8px 11px;
  background: var(--bg1); border: 1px solid var(--brd-m); border-radius: 6px;
  margin-bottom: 4px;
}
.pk3-doc-row:hover { border-color: var(--gold); background: var(--bg3); }
.pk3-doc-ic { font-size: 14px; width: 18px; text-align: center; }
.pk3-doc-name { flex: 1; font-size: 12px; color: var(--t1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pk3-doc-size { font-size: 10.5px; color: var(--t3); }
.pk3-doc-actions { display: flex; gap: 4px; }
.pk3-doc-actions button {
  width: 26px; height: 26px; border-radius: 5px; border: 1px solid var(--brd-m);
  background: var(--bg2); color: var(--t2); cursor: pointer; font-size: 11px;
}
.pk3-doc-actions button:hover { color: var(--gold-l); border-color: var(--gold); }
.pk3-doc-add {
  border: 1.5px dashed var(--brd); padding: 10px; text-align: center;
  border-radius: 8px; color: var(--t3); cursor: pointer; font-size: 12px;
  transition: all .15s; background: transparent;
}
.pk3-doc-add:hover {
  border-color: var(--gold); color: var(--gold-l); background: var(--gold-bg);
}

/* ── Fin grid ── */
.pk3-fin-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 13px; }
.pk3-fin-card {
  background: var(--bg1); border: 1px solid var(--brd-m); border-radius: 10px;
  padding: 11px 13px;
}
.pk3-fin-card label {
  font-size: 10px; color: var(--t3); text-transform: uppercase;
  letter-spacing: .4px; display: block; margin-bottom: 4px;
}
.pk3-fin-card .pk3-v {
  font-size: 16px; color: var(--gold-l); font-weight: 600;
  font-family: 'JetBrains Mono', monospace;
}
.pk3-fin-card.pk3-margin .pk3-v { color: var(--ok-t); }

/* ── Actions bar (sticky bottom) ── */
.pk3-actions-bar {
  position: sticky; bottom: 0; padding: 12px 24px;
  background: var(--bg1); border-top: 1px solid var(--brd);
  display: flex; gap: 8px; z-index: 5; flex-wrap: wrap;
}

/* ── Btn primitives ── */
.pk3-btn {
  padding: 7px 13px; border-radius: 8px; font-size: 12.5px; font-weight: 500;
  border: 1px solid var(--brd); background: var(--bg2); color: var(--t1);
  cursor: pointer; transition: all .15s;
  display: inline-flex; align-items: center; gap: 6px; text-decoration: none;
  font-family: inherit;
}
.pk3-btn:hover { background: var(--bg3); border-color: var(--gold); }
.pk3-btn.pk3-gold {
  background: linear-gradient(180deg, var(--gold), var(--gold-h));
  color: #1a1000; border-color: var(--gold-h); font-weight: 600;
}
.pk3-btn.pk3-gold:hover { filter: brightness(1.1); }
.pk3-btn.pk3-ghost { background: transparent; }
.pk3-btn.pk3-danger { color: var(--err-t); border-color: var(--err); }
.pk3-btn.pk3-danger:hover { background: var(--err-bg); }
.pk3-btn.pk3-ok { background: var(--ok); color: #0a1b0a; border-color: var(--ok); font-weight: 600; }
.pk3-btn.pk3-sm { padding: 4px 9px; font-size: 11px; }

/* ── Modal overlay (поверх drawer) ── */
.pk3-modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 1200;
  display: none; align-items: center; justify-content: center; padding: 28px;
  backdrop-filter: blur(6px);
}
.pk3-modal-overlay.show { display: flex; }
.pk3-modal {
  background: var(--bg1); border: 1px solid var(--brd); border-radius: 14px;
  width: 92vw; max-width: 1100px; height: 88vh;
  display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 24px 60px rgba(0,0,0,0.6);
}
.pk3-modal-head {
  padding: 14px 20px; border-bottom: 1px solid var(--brd-m);
  display: flex; align-items: center; gap: 10px;
}
.pk3-modal-head h3 { font-family: 'Cinzel', serif; font-size: 16px; color: var(--t1); flex: 1; margin: 0; }
.pk3-modal-body { flex: 1; overflow-y: auto; padding: 18px 22px; scroll-behavior: smooth; }
.pk3-modal-foot {
  padding: 12px 20px; border-top: 1px solid var(--brd-m);
  display: flex; gap: 9px; align-items: center; background: var(--bg2);
}

/* ── Wizard steps (Quick) ── */
.pk3-wiz-steps {
  display: flex; gap: 0; margin-bottom: 18px; background: var(--brd-m);
  border-radius: 10px; overflow: hidden;
}
.pk3-wiz-step {
  flex: 1; padding: 10px 6px; text-align: center; font-size: 11.5px;
  background: var(--bg2); color: var(--t3); position: relative; font-weight: 500;
}
.pk3-wiz-step.pk3-done { background: var(--ok-bg); color: var(--ok-t); }
.pk3-wiz-step.pk3-now {
  background: var(--gold-bg); color: var(--gold-l); font-weight: 700;
  box-shadow: inset 0 -3px 0 var(--gold);
}
.pk3-wiz-step .pk3-num {
  display: inline-block; width: 18px; height: 18px; border-radius: 9px;
  background: var(--bg4); color: var(--t2); font-size: 10.5px;
  font-weight: 700; line-height: 18px; margin-right: 5px;
}
.pk3-wiz-step.pk3-done .pk3-num { background: var(--ok); color: #0a1b0a; }
.pk3-wiz-step.pk3-now  .pk3-num { background: var(--gold); color: #1a1000; }

/* ── Conductor msg ── */
.pk3-cond-msg { display: flex; gap: 11px; padding: 12px 0; border-bottom: 1px solid var(--brd-m); }
.pk3-cond-msg:last-child { border-bottom: none; }
.pk3-cond-ava {
  width: 30px; height: 30px; border-radius: 15px; background: var(--bg3);
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; flex-shrink: 0;
}
.pk3-cond-msg.pk3-ai .pk3-cond-ava     { background: #2a2438; color: #A78BFA; }
.pk3-cond-msg.pk3-client .pk3-cond-ava { background: var(--info-bg); color: var(--info-t); }
.pk3-cond-msg.pk3-pm .pk3-cond-ava     { background: var(--gold-bg); color: var(--gold-l); }
.pk3-cond-content { flex: 1; }
.pk3-cond-head { display: flex; gap: 7px; align-items: center; margin-bottom: 4px; font-size: 11px; }
.pk3-cond-name { font-weight: 600; color: var(--t1); }
.pk3-cond-time { color: var(--t3); font-size: 10.5px; }
.pk3-cond-status {
  font-size: 9.5px; padding: 2px 7px; border-radius: 999px; margin-left: auto;
  font-weight: 600;
}
.pk3-cond-status.pk3-draft    { background: var(--bg3);    color: var(--t3); }
.pk3-cond-status.pk3-sent     { background: var(--ok-bg);  color: var(--ok-t); }
.pk3-cond-status.pk3-received { background: var(--info-bg); color: var(--info-t); }
.pk3-cond-text { font-size: 12.5px; color: var(--t2); line-height: 1.55; }

/* ── References row ── */
.pk3-ref-row {
  display: grid; grid-template-columns: 1fr 100px 90px 80px 90px 70px;
  gap: 10px; align-items: center; padding: 10px 13px;
  background: var(--bg2); border: 1px solid var(--brd-m);
  border-radius: 8px; margin-bottom: 6px; font-size: 12px;
}
.pk3-ref-row:hover { border-color: var(--gold); background: var(--bg3); }
.pk3-ref-row .pk3-name { font-weight: 600; color: var(--t1); }
.pk3-ref-row .pk3-nameSub { font-size: 10.5px; color: var(--t3); margin-top: 2px; }
.pk3-ref-row .pk3-num { font-family: 'JetBrains Mono', monospace; color: var(--gold-l); text-align: right; }
.pk3-ref-row .pk3-pct.pk3-good { color: var(--ok-t); }
.pk3-ref-row .pk3-pct.pk3-bad  { color: var(--err-t); }

/* ── TKP constructor ── */
.pk3-tkp-layout { display: grid; grid-template-columns: 280px 1fr; gap: 14px; height: 100%; }
.pk3-tkp-blocks {
  background: var(--bg2); border: 1px solid var(--brd-m);
  border-radius: 10px; padding: 11px; overflow-y: auto;
}
.pk3-tkp-blocks h4 {
  font-size: 10.5px; color: var(--t3); text-transform: uppercase;
  letter-spacing: .5px; margin: 0 0 8px; font-weight: 600;
}
.pk3-tkp-block-item {
  display: flex; align-items: center; gap: 7px; padding: 8px 10px;
  background: var(--bg3); border: 1px solid var(--brd-m);
  border-radius: 6px; margin-bottom: 4px; cursor: grab; transition: all .15s;
}
.pk3-tkp-block-item:hover { border-color: var(--gold); background: var(--bg4); }
.pk3-tkp-block-item.pk3-active {
  border-color: var(--gold); background: var(--gold-bg);
  box-shadow: 0 0 0 2px var(--gold-bg);
}
.pk3-tkp-block-item .pk3-ic { font-size: 12px; color: var(--gold); }
.pk3-tkp-block-item .pk3-name { flex: 1; font-size: 11.5px; color: var(--t1); }
.pk3-tkp-block-item .pk3-actions { display: flex; gap: 2px; }
.pk3-tkp-block-item .pk3-actions button {
  width: 20px; height: 20px; border-radius: 4px; border: 1px solid var(--brd-m);
  background: transparent; color: var(--t3); font-size: 9.5px; cursor: pointer;
}
.pk3-tkp-block-item .pk3-actions button:hover { color: var(--err-t); border-color: var(--err); }
.pk3-tkp-add-block { margin-top: 7px; padding-top: 8px; border-top: 1px solid var(--brd-m); }
.pk3-tkp-add-options { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 4px; }
.pk3-tkp-add-options button {
  padding: 5px 7px; background: var(--bg3); border: 1px solid var(--brd-m);
  border-radius: 5px; color: var(--t2); font-size: 10px; cursor: pointer;
  text-align: left; transition: all .15s; font-family: inherit;
}
.pk3-tkp-add-options button:hover { border-color: var(--gold); color: var(--gold-l); }
/* TKP-preview: бежевая бумага — НАМЕРЕННО вне тем (это документ) */
.pk3-tkp-preview {
  background: #f7f3e8; color: #2a1f0a; border-radius: 10px;
  padding: 28px 36px; overflow-y: auto;
  box-shadow: inset 0 0 26px rgba(0,0,0,0.05);
  font-family: 'Times New Roman', serif; font-size: 12.5px;
}
.pk3-tkp-preview h1 {
  font-family: 'Cinzel', Georgia, serif; font-size: 22px;
  color: #5a3a0a; margin-bottom: 6px; text-align: center; font-weight: 700;
}
.pk3-tkp-preview .pk3-tkp-num {
  text-align: center; color: #7a5a22; font-size: 12.5px;
  margin-bottom: 22px; letter-spacing: .5px;
}
.pk3-tkp-preview h2 {
  font-family: 'Cinzel', Georgia, serif; font-size: 14px;
  color: #5a3a0a; margin: 18px 0 8px; border-bottom: 1px solid #cdb87e; padding-bottom: 4px;
}
.pk3-tkp-preview p { margin: 0 0 8px; line-height: 1.65; }
.pk3-tkp-preview table { width: 100%; border-collapse: collapse; margin: 10px 0 14px; }
.pk3-tkp-preview table th, .pk3-tkp-preview table td {
  padding: 7px 10px; border: 1px solid #b89860; text-align: left;
}
.pk3-tkp-preview table th {
  background: #e8d8a8; font-family: 'Cinzel', serif;
  font-size: 11.5px; font-weight: 600; color: #3d2a08;
}
.pk3-tkp-preview .pk3-right { text-align: right; }
.pk3-tkp-preview ul { padding-left: 20px; line-height: 1.65; margin: 0 0 8px; }
.pk3-tkp-preview ul li { margin-bottom: 3px; }
.pk3-tkp-preview .pk3-sign-block {
  display: flex; justify-content: space-between; margin-top: 26px;
  padding-top: 16px; border-top: 2px solid #b89860; font-size: 11.5px;
}
.pk3-tkp-preview .pk3-sign-line { height: 1px; background: #3d2a08; margin: 22px 0 4px; }

/* ── Compose grid (Send) ── */
.pk3-compose-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; height: 100%; }
.pk3-compose-form { background: var(--bg2); border: 1px solid var(--brd-m); border-radius: 10px; padding: 14px; overflow-y: auto; }
.pk3-compose-preview {
  background: #f7f3e8; color: #2a1f0a; border-radius: 10px;
  padding: 18px 24px; overflow-y: auto;
  font-family: 'Times New Roman', serif; font-size: 12.5px; line-height: 1.65;
}

/* ── Status tag (для секции ТКП и др) ── */
.pk3-tag {
  display: inline-block; padding: 2px 7px; border-radius: 999px;
  font-size: 10px; font-weight: 600; letter-spacing: .3px;
}
.pk3-tag.pk3-ok   { background: var(--ok-bg);   color: var(--ok-t); }
.pk3-tag.pk3-warn { background: var(--warn-bg); color: var(--warn-t); }
.pk3-tag.pk3-err  { background: var(--err-bg);  color: var(--err-t); }
.pk3-tag.pk3-info { background: var(--info-bg); color: var(--info-t); }

/* ── Hint info-блок ── */
.pk3-hint {
  margin: 10px 0; padding: 10px 13px; border: 1px dashed var(--brd);
  border-radius: 8px; font-size: 11.5px; color: var(--t3);
  background: var(--info-bg); line-height: 1.5;
}

/* === Scrollbar — единый стиль для всех v3 контейнеров === */
.pk3-shell *::-webkit-scrollbar,
.pk3-drawer *::-webkit-scrollbar,
.pk3-modal-overlay *::-webkit-scrollbar { width: 8px; height: 8px; }
.pk3-shell *::-webkit-scrollbar-thumb,
.pk3-drawer *::-webkit-scrollbar-thumb,
.pk3-modal-overlay *::-webkit-scrollbar-thumb { background: var(--gold-h); border-radius: 4px; }
.pk3-shell *::-webkit-scrollbar-track,
.pk3-drawer *::-webkit-scrollbar-track,
.pk3-modal-overlay *::-webkit-scrollbar-track { background: transparent; }
`;
    const st = document.createElement('style');
    st.id = 'asg-pk3-styles';
    st.textContent = css;
    document.head.appendChild(st);
  }

  // === V3-FUNCTIONS-PLACEHOLDER ===
  // (board render, drag&drop, drawer, 5 modals — добавляются ниже отдельными Edit'ами)

  // ── Заглушки на render до основной реализации ────────────────────────
  async function render(opts) {
    _injectV3Styles();
    _layout = opts.layout;
    try {
      const auth = await window.AsgardAuth.requireUser();
      if (!auth) { location.hash = '#/login'; return; }
      _user = auth.user;
    } catch (_) {}
    await _layout(
      `<div id="pk3-root" class="pk3-shell"><div style="padding:30px;color:var(--t3)">Загружаю канбан…</div></div>`,
      { title: opts.title || 'Канбан v3', motto: 'Полный цикл — от заявки до сданной работы.' }
    );
    await _v3LoadAndRender();
    _attachSSE();
    const hashHandler = () => {
      if (!location.hash.startsWith('#/personal-kanban-v3')) {
        _detachSSE(); _closeDrawer(); _closeAllModals();
        window.removeEventListener('hashchange', hashHandler);
      }
    };
    window.addEventListener('hashchange', hashHandler);
  }

  // ─────────────────────────────────────────────────────────────────────
  // STUB-ы для функций которые будут дополнены ниже (Edit-ами)
  // ─────────────────────────────────────────────────────────────────────
  async function _v3LoadAndRender() {
    await _v3LoadData();
    _v3RenderShell();
    _v3RenderBoard();
    _v3AttachEvents();
  }
  async function _v3LoadData() {
    // S-15: scope=auto по умолчанию; для TO/HEAD_TO backend форсит flow_filter='tender'
    _scopeMode = _computeScope();
    const scope = _scopeMode || 'auto';
    // Для TO/HEAD_TO канбана — backend (S-9) сам форсит tender; на фронте flow_filter не шлём,
    // чтобы не конфликтовать с серверной логикой; для PM/HEAD_PM/ADMIN — текущий _flowFilter.
    const flowParam = _isToRole() ? '' : ('&flow_filter=' + encodeURIComponent(_flowFilter));
    const scopeParam = '&scope=' + encodeURIComponent(scope);
    const [boardRes, countsRes] = await Promise.all([
      api('/api/personal-kanban/board?_=1' + flowParam + scopeParam),
      api('/api/personal-kanban/columns/counts?_=1' + flowParam + scopeParam),
    ]);
    if (boardRes.ok && boardRes.data && boardRes.data.columns) {
      _columns = boardRes.data.columns;
      // S-15: гарантируем что 9 ключей всегда есть (даже если backend вернул 8 для старых клонов)
      ['new','calc','approval','kp_prep','sent','addendum','win','lose','work'].forEach(k => {
        if (!Array.isArray(_columns[k])) _columns[k] = [];
      });
    }
    if (countsRes.ok && countsRes.data) {
      _counts = countsRes.data;
      if (typeof _counts.addendum !== 'number') _counts.addendum = 0;
    }
  }
  function _v3RenderShell() {
    const root = $('#pk3-root');
    if (!root) return;
    // S-15: для TO/HEAD_TO скрываем flow-tabs (показываем только тендеры);
    //       для HEAD_TO добавляем toggle «Мои / Отдел»
    const role = (_user && _user.role) || '';
    const hideFlowTabs = _isToRole();
    let scopeToggle = '';
    if (role === 'HEAD_TO') {
      let toggle = 'team';
      try { toggle = localStorage.getItem('pk3_scope_toggle') || 'team'; } catch (_) {}
      scopeToggle = `
        <div class="pk3-scope-toggle" id="pk3-scope-toggle" title="Переключить scope">
          <button data-scope="mine" class="${toggle === 'mine' ? 'active' : ''}">🟦 Мои</button>
          <button data-scope="team" class="${toggle === 'team' ? 'active' : ''}">👑 Отдел</button>
        </div>
      `;
    }
    const h2Title = _scopeLabel();
    const subTitle = hideFlowTabs
      ? '📥 → 🧮 → ⚖️ → 📋 → 📤 → ❓ → 🏆/❌ · только тендеры'
      : '📥 → 🧮 → ⚖️ → 📋 → 📤 → ❓ → 🏆/❌ → 🏗 · с просчётом и ТКП внутри карты';
    root.innerHTML = `
      <div class="pk3-top-actions">
        <div class="pk3-titles">
          <div class="pk3-kicker">САГА ТЕНДЕРОВ</div>
          <h1 class="pk3-h2">${esc(h2Title)}</h1>
          <div class="pk3-h2-sub">${subTitle}</div>
        </div>
        ${scopeToggle}
        <div class="pk3-view-toggle" id="pk3-view-toggle">
          <button data-view="substages">📋 По под-этапам</button>
          <button class="active" data-view="v3">📊 По воронке</button>
        </div>
        <input class="pk3-search-input" id="pk3-search" placeholder="🔍 поиск по клиенту, теме, ИНН…" />
        <button class="pk3-btn pk3-gold" id="pk3-create-manual">＋ Создать вручную</button>
      </div>
      ${hideFlowTabs ? '' : `
      <div class="pk3-tabs-bar" id="pk3-tabs">
        ${FLOW_TABS.map(t => `<div class="pk3-tab ${_flowFilter === t.id ? 'active' : ''}" data-flow="${t.id}">${esc(t.label)} <span class="pk3-cnt">${_countByFlow(t.id)}</span></div>`).join('')}
      </div>
      `}
      <div class="pk3-board" id="pk3-board"></div>
    `;
  }
  function _countByFlow(flowId) {
    if (flowId === 'all') return _counts.total || 0;
    // оценка: фронт-фильтр по карточкам
    let n = 0;
    Object.values(_columns).forEach(arr => arr.forEach(c => { if (c.flow_type === flowId) n++; }));
    return n;
  }
  function _v3RenderBoard() {
    const board = $('#pk3-board');
    if (!board) return;
    // S-15: сохраняем скролл-позицию колонки addendum (и любых других) между ре-рендерами
    const prevScroll = {};
    $$('#pk3-board .pk3-col-body').forEach(b => {
      const cid = b.dataset.colId; if (cid) prevScroll[cid] = b.scrollTop;
    });
    const cardMatchesFlow = (c) => _flowFilter === 'all' || c.flow_type === _flowFilter;
    const cardMatchesSearch = (c) => {
      if (!_searchQ) return true;
      const q = _searchQ.toLowerCase();
      return (c.title || '').toLowerCase().includes(q)
        || (c.customer || '').toLowerCase().includes(q)
        || (c.code || '').toLowerCase().includes(q);
    };
    board.innerHTML = COLS.map(col => {
      const cards = (_columns[col.id] || []).filter(c => cardMatchesFlow(c) && cardMatchesSearch(c));
      return `
        <div class="pk3-col ${col.cls || ''}">
          <div class="pk3-col-head">
            <span class="pk3-col-icon">${col.ic}</span>
            <span class="pk3-col-title">${esc(col.title)}</span>
            <span class="pk3-col-count">${cards.length}</span>
          </div>
          <div class="pk3-col-body" data-col-id="${col.id}">
            ${cards.map(c => _v3RenderCardHtml(c)).join('')}
          </div>
        </div>
      `;
    }).join('');
    // S-15: восстанавливаем скролл-позиции
    $$('#pk3-board .pk3-col-body').forEach(b => {
      const cid = b.dataset.colId;
      if (cid && prevScroll[cid] != null) b.scrollTop = prevScroll[cid];
    });
  }
  function _v3RenderCardHtml(c) {
    const kindShort = (c.kind || c.entity_kind || '').split('_')[0];
    const color = c.color || 'green';
    const winCls = c.col === 'win' ? ' pk3-win' : (c.col === 'lose' ? ' pk3-lose' : '');
    const meta = c.meta || [];
    // S-15: 9-этапная шкала прогресса (раньше 8); поддерживаем и legacy 8-элементный массив
    const progress = c.progress || [0,0,0,0,0,0,0,0,0];
    // S-15: маркер дозапроса (если backend пришлёт addendum_days или карта в колонке addendum)
    const addendumMark = (c.col === 'addendum')
      ? `<div class="pk3-card-addendum-mark">${esc((c.addendum_days != null ? c.addendum_days + 'д' : '!'))}</div>`
      : '';
    return `
      <div class="pk3-card pk3-${color}${winCls}" draggable="true" data-card-id="${c.id}">
        ${addendumMark}
        <div class="pk3-card-top">
          <span class="pk3-badge pk3-${kindShort}">${esc(c.kindLabel || kindShort)}</span>
          <span class="pk3-card-id">${esc(c.code || '#' + c.id)}</span>
        </div>
        <div class="pk3-card-title">${esc(c.title || '')}</div>
        <div class="pk3-card-customer">${esc(c.customer || '')}</div>
        <div class="pk3-card-meta">
          ${meta.map(m => `<span class="pk3-pill">${esc(m)}</span>`).join('')}
        </div>
        <div class="pk3-card-progress">
          ${progress.map(s => `<div class="pk3-dot ${s === 2 ? 'pk3-done' : (s === 1 ? 'pk3-now' : '')}"></div>`).join('')}
        </div>
      </div>
    `;
  }

  // Stubs (заполнены в следующих Edit'ах)
  function _v3AttachEvents() {
    // search
    const s = $('#pk3-search'); if (s) s.addEventListener('input', (e) => {
      _searchQ = e.target.value || ''; _v3RenderBoard();
    });
    // S-15: scope-toggle (HEAD_TO) «Мои / Отдел»
    $$('#pk3-scope-toggle button').forEach(b => b.addEventListener('click', async () => {
      const val = b.dataset.scope; // 'mine' | 'team'
      try { localStorage.setItem('pk3_scope_toggle', val); } catch (_) {}
      $$('#pk3-scope-toggle button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      await _v3LoadData();
      _v3RenderShell();
      _v3RenderBoard();
      _v3AttachEvents();
    }));
    // tabs flow (для PM/HEAD_PM/ADMIN/DIRECTOR — у TO/HEAD_TO скрыты, селектор пустой)
    $$('#pk3-tabs .pk3-tab').forEach(t => t.addEventListener('click', async () => {
      _flowFilter = t.dataset.flow;
      $$('#pk3-tabs .pk3-tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      await _v3LoadData();
      _v3RenderShell();
      _v3RenderBoard();
      _v3AttachEvents();
    }));
    // view toggle → substages
    $$('#pk3-view-toggle button').forEach(b => b.addEventListener('click', () => {
      const view = b.dataset.view;
      try { localStorage.setItem('pk3_view_mode', view); } catch (_) {}
      if (view === 'substages') {
        location.hash = '#/personal-kanban';
      }
    }));
    // create manual
    const cm = $('#pk3-create-manual'); if (cm) cm.addEventListener('click', _v3OpenCreateManual);
    // cards click + DnD
    $$('#pk3-board .pk3-card').forEach(el => {
      el.addEventListener('click', () => {
        const cid = parseInt(el.dataset.cardId, 10);
        const card = _v3FindCard(cid);
        if (card) _openDrawer(card);
      });
      el.addEventListener('dragstart', (e) => {
        _draggingCardId = parseInt(el.dataset.cardId, 10);
        el.classList.add('pk3-dragging');
        if (e.dataTransfer) { e.dataTransfer.setData('text/plain', String(_draggingCardId)); e.dataTransfer.effectAllowed = 'move'; }
      });
      el.addEventListener('dragend', () => { el.classList.remove('pk3-dragging'); _draggingCardId = null; });
    });
    $$('#pk3-board .pk3-col-body').forEach(body => {
      body.addEventListener('dragover', (e) => { e.preventDefault(); body.classList.add('pk3-drop-hover'); });
      body.addEventListener('dragleave', () => body.classList.remove('pk3-drop-hover'));
      body.addEventListener('drop', async (e) => {
        e.preventDefault(); body.classList.remove('pk3-drop-hover');
        const toCol = body.dataset.colId;
        const cardId = _draggingCardId; if (!cardId) return;
        await _v3DoTransition(cardId, toCol);
      });
    });
  }
  function _v3FindCard(id) {
    for (const k of Object.keys(_columns)) {
      const c = _columns[k].find(x => x.id === id);
      if (c) return c;
    }
    return null;
  }
  async function _v3DoTransition(cardId, toCol, opts) {
    opts = opts || {};
    const body = { to_v3_column: toCol, note: opts.note || null, confirm: !!opts.confirm };
    const r = await api(`/api/personal-kanban/cards/${cardId}/transition`, { method: 'POST', body });
    if (r.status === 409 && r.data && r.data.error === 'confirm_required') {
      if (window.confirm(r.data.message || 'Подтвердите переход')) {
        return _v3DoTransition(cardId, toCol, { ...opts, confirm: true });
      }
      return;
    }
    if (!r.ok) {
      toast('Не получилось', (r.data && (r.data.error || r.data.message)) || 'Ошибка перехода', 'err');
      return;
    }
    toast('Готово', 'Карта перемещена', 'ok');
    await _v3LoadAndRender();
  }
  function _v3OpenCreateManual() {
    toast('Создание вручную', 'Используй существующую страницу /pre-tenders или /tenders для ручного ввода. Из канбана v3 — в следующей итерации.', 'warn');
  }

  // SSE подписка (минимальная)
  function _attachSSE() {
    if (_sseConnected) return;
    try {
      if (!window._asgardSSE) return;
      _sseHandler = () => { _v3LoadAndRender().catch(() => {}); };
      window._asgardSSE.addEventListener('personal_kanban:card_moved',     _sseHandler);
      window._asgardSSE.addEventListener('personal_kanban:card_converted', _sseHandler);
      window._asgardSSE.addEventListener('personal_kanban:card_created',   _sseHandler);
      window._asgardSSE.addEventListener('personal_kanban:card_document_added', _sseHandler);
      window._asgardSSE.addEventListener('tkp_constructor:created',        _sseHandler);
      window._asgardSSE.addEventListener('tkp_constructor:sent',           _sseHandler);
      _sseConnected = true;
    } catch (_) {}
  }
  function _detachSSE() {
    if (!_sseConnected || !_sseHandler) return;
    try {
      if (window._asgardSSE) {
        window._asgardSSE.removeEventListener('personal_kanban:card_moved',     _sseHandler);
        window._asgardSSE.removeEventListener('personal_kanban:card_converted', _sseHandler);
        window._asgardSSE.removeEventListener('personal_kanban:card_created',   _sseHandler);
        window._asgardSSE.removeEventListener('personal_kanban:card_document_added', _sseHandler);
        window._asgardSSE.removeEventListener('tkp_constructor:created',        _sseHandler);
        window._asgardSSE.removeEventListener('tkp_constructor:sent',           _sseHandler);
      }
    } catch (_) {}
    _sseHandler = null; _sseConnected = false;
  }

  // ── Drawer (stub — будет дополнен Edit-ами с 8 секциями + 5 модалок) ──
  function _openDrawer(card) {
    _currentCard = card;
    if (_drawerEl) _closeDrawer();
    const overlay = document.createElement('div');
    overlay.className = 'pk3-drawer-overlay show';
    overlay.addEventListener('click', _closeDrawer);
    const drawer = document.createElement('div');
    drawer.className = 'pk3-drawer show';
    drawer.innerHTML = _renderDrawerHtml(card);
    document.body.appendChild(overlay);
    document.body.appendChild(drawer);
    _drawerEl = { overlay, drawer };
    _attachDrawerEvents(card);
  }
  function _closeDrawer() {
    if (!_drawerEl) return;
    try { _drawerEl.overlay.remove(); _drawerEl.drawer.remove(); } catch (_) {}
    _drawerEl = null; _currentCard = null;
  }
  function _renderDrawerHtml(card) {
    const active = COL_TO_STAGE[card.col] ?? 0;
    const fin = card.finance || {};
    const aiSummary = card.ai_summary || '(AI ещё не разобрал заявку)';
    return `
      <div class="pk3-drawer-head">
        <div class="pk3-row1">
          <span class="pk3-badge pk3-${(card.kind || '').split('_')[0]}">${esc(card.kindLabel || '')}</span>
          <h2>${esc(card.title || '')}</h2>
          <button class="pk3-btn-icon" id="pk3-drawer-close" title="Закрыть (Esc)">✕</button>
        </div>
        <div class="pk3-meta">
          <span>📅 ${esc(card.created_at_label || '—')}</span>
          <span>👤 РП: ${esc(card.owner_label || '—')}</span>
          <span>📨 ${esc(card.customer || '—')}</span>
          <span>🆔 ${esc(card.code || '#' + card.id)}</span>
        </div>
      </div>
      <div class="pk3-stages">
        ${STAGE_LABELS.map((lbl, i) => {
          const cls = i < active ? 'pk3-done' : (i === active ? 'pk3-now' : '');
          return `<div class="pk3-stage ${cls}">${esc(lbl)}</div>`;
        }).join('')}
      </div>
      <div class="pk3-drawer-nav">
        <span class="pk3-dnav-link" data-anchor="sec-ai">🤖 AI</span>
        <span class="pk3-dnav-link" data-anchor="sec-client">👤 Клиент</span>
        <span class="pk3-dnav-link" data-anchor="sec-work">🔧 Работа</span>
        <span class="pk3-dnav-link" data-anchor="sec-calc">🧮 Просчёт</span>
        <span class="pk3-dnav-link" data-anchor="sec-docs">📎 Документы</span>
        <span class="pk3-dnav-link" data-anchor="sec-fin">💰 Финансы</span>
        <span class="pk3-dnav-link" data-anchor="sec-tkp">📋 ТКП</span>
        <span class="pk3-dnav-link" data-anchor="sec-hist">🕘 История</span>
      </div>
      ${_secAI(card, aiSummary)}
      ${_secClient(card)}
      ${_secWork(card)}
      ${_secCalc(card)}
      ${_secDocs(card)}
      ${_secFin(card, fin)}
      ${_secTKP(card)}
      ${_secHist(card)}
      <div style="height:80px"></div>
      <div class="pk3-actions-bar" id="pk3-actions-bar">
        ${_renderActionsBar(card)}
      </div>
    `;
  }

  function _section(id, ic, title, count, body) {
    return `
      <div class="pk3-section" id="${id}">
        <div class="pk3-section-head" data-toggle="${id}">
          <span class="pk3-ico">${ic}</span>
          <h3>${esc(title)}</h3>
          ${count != null ? `<span class="pk3-count">${count}</span>` : ''}
          <span class="pk3-chev">▾</span>
        </div>
        <div class="pk3-section-body">${body}</div>
      </div>
    `;
  }
  function _row(label, htmlInput) {
    return `<div class="pk3-row"><label>${esc(label)}</label>${htmlInput}</div>`;
  }
  function _secAI(card, aiSummary) {
    const color = card.color === 'green' ? '🟢' : (card.color === 'yellow' ? '🟡' : (card.color === 'red' ? '🔴' : '⚪'));
    const cls  = card.color === 'green' ? 'pk3-ok' : (card.color === 'yellow' ? 'pk3-warn' : (card.color === 'red' ? 'pk3-err' : 'pk3-info'));
    return _section('sec-ai', '🤖', 'AI разбор', null, `
      <div style="display:flex;align-items:center;gap:9px;margin-bottom:10px">
        <span class="pk3-tag ${cls}">${color} ${esc(card.ai_classification || card.kind || '')}</span>
        ${card.ai_confidence != null ? `<span class="pk3-tag pk3-info">confidence ${Math.round((card.ai_confidence||0)*100)}%</span>` : ''}
      </div>
      <div class="pk3-ai-block">
        <p style="margin:0">${esc(aiSummary)}</p>
        ${card.ai_recommendation ? `<p style="margin-top:7px"><b>💡 Рекомендация:</b> ${esc(card.ai_recommendation)}</p>` : ''}
      </div>
    `);
  }
  function _secClient(card) {
    return _section('sec-client', '👤', 'Клиент и контакты', null, `
      ${_row('Заказчик', `<input id="pk3-f-customer" value="${esc(card.customer_name || card.customer || '')}" />`)}
      ${_row('ИНН', `<div class="pk3-twocol"><input id="pk3-f-inn" value="${esc(card.customer_inn || '')}" placeholder="ИНН для подгрузки" /><button class="pk3-btn pk3-ghost pk3-sm" id="pk3-egrul">🔎 egrul</button></div>`)}
      ${_row('Контактное лицо', `<input id="pk3-f-contact" value="${esc(card.contact_person || '')}" />`)}
      ${_row('Email', `<input id="pk3-f-email" value="${esc(card.customer_email || '')}" />`)}
      ${_row('Телефон', `<input id="pk3-f-phone" value="${esc(card.contact_phone || '')}" placeholder="+7 (___) ___-__-__" />`)}
      ${_row('Город / Объект', `<input id="pk3-f-city" value="${esc(card.customer_city || card.work_location || '')}" />`)}
    `);
  }
  function _secWork(card) {
    return _section('sec-work', '🔧', 'Что делать', null, `
      ${_row('Тип работ', `<select id="pk3-f-worktype">
        <option>Гидромеханическая очистка</option>
        <option>Химическая промывка</option>
        <option>Антикоррозионная обработка</option>
        <option>Монтажные работы</option>
        <option>Диагностика</option>
        <option>Вентиляция</option>
        <option>Другое</option>
      </select>`)}
      ${_row('Описание', `<textarea id="pk3-f-desc">${esc(card.work_description || '')}</textarea>`)}
      ${_row('Объём', `<div class="pk3-twocol"><input id="pk3-f-vol" placeholder="число" /><select id="pk3-f-volunit"><option>м³</option><option>часов</option><option>точек</option><option>тонн</option></select></div>`)}
      ${_row('Дедлайн КП', `<input type="date" id="pk3-f-kpdeadline" value="${esc(card.work_deadline || '')}" />`)}
      ${_row('Сроки работ', `<div class="pk3-twocol"><input type="date" id="pk3-f-startp" /><input type="date" id="pk3-f-endp" /></div>`)}
    `);
  }
  function _secCalc(card) {
    return _section('sec-calc', '🧮', 'Просчёт сметы', null, `
      <div class="pk3-calc-panel">
        <div class="pk3-calc-card pk3-q" data-action="open-quick">
          <span class="pk3-ic">🚀</span>
          <div class="pk3-title">Быстрый просчёт</div>
          <div class="pk3-sub">Мимир-Quick · 4 шага · ~10 мин</div>
        </div>
        <div class="pk3-calc-card pk3-c" data-action="open-conductor">
          <span class="pk3-ic">🎼</span>
          <div class="pk3-title">Полный просчёт</div>
          <div class="pk3-sub">Кондуктор · вопросы клиенту · 2-7 дней</div>
        </div>
        <div class="pk3-calc-card pk3-r" data-action="open-references">
          <span class="pk3-ic">📚</span>
          <div class="pk3-title">Найти эталоны</div>
          <div class="pk3-sub">База завершённых работ · похожие по типу</div>
        </div>
      </div>
      <div class="pk3-hint">
        💡 <b>Quick</b> — для типовых работ с чётким ТЗ. <b>Кондуктор</b> — когда нужно уточнять детали с клиентом письмами. <b>Эталоны</b> — для прикидки цены по похожему проекту.
      </div>
    `);
  }
  function _secDocs(card) {
    const emailDocs = card.email_attachments || [];
    const pmDocs    = card.pm_documents || [];
    const calcDocs  = card.calc_documents || [];
    const renderDoc = (d, idx) => `
      <div class="pk3-doc-row">
        <span class="pk3-doc-ic">${esc(_docIcon(d.mime_type || d.original_filename || d.filename))}</span>
        <span class="pk3-doc-name">${esc(d.original_filename || d.filename || 'файл')}</span>
        <span class="pk3-doc-size">${d.size ? _fmtBytes(d.size) : ''}</span>
        <div class="pk3-doc-actions">
          <button data-act="view" data-id="${d.id || idx}">👁</button>
          <button data-act="dl"   data-id="${d.id || idx}">⬇</button>
        </div>
      </div>
    `;
    const totalCount = emailDocs.length + pmDocs.length + calcDocs.length;
    return _section('sec-docs', '📎', 'Документы', totalCount, `
      <div class="pk3-doc-group">
        <h4>📧 Из письма клиента</h4>
        ${emailDocs.length ? emailDocs.map(renderDoc).join('') : '<div style="color:var(--t3);font-size:11.5px">Нет вложений</div>'}
      </div>
      <div class="pk3-doc-group">
        <h4>📤 Загружено РП</h4>
        ${pmDocs.length ? pmDocs.map(renderDoc).join('') : '<div class="pk3-doc-add" id="pk3-upload-pm">+ Перетащите файлы или нажмите чтобы выбрать</div>'}
      </div>
      <div class="pk3-doc-group">
        <h4>🧮 Расчёты и сметы</h4>
        ${calcDocs.length ? calcDocs.map(renderDoc).join('') : '<div style="color:var(--t3);font-size:11.5px">Сметы появятся после Quick/Кондуктора</div>'}
      </div>
    `);
  }
  function _docIcon(s) {
    s = (s || '').toLowerCase();
    if (s.includes('pdf')) return '📄';
    if (s.includes('xlsx') || s.includes('xls') || s.includes('sheet')) return '📊';
    if (s.includes('docx') || s.includes('doc') || s.includes('word')) return '📝';
    if (s.includes('image') || /\.(jpe?g|png|gif|webp)/.test(s)) return '🖼️';
    return '📎';
  }
  function _fmtBytes(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' Б';
    if (n < 1024*1024) return Math.round(n/1024) + ' КБ';
    return (n / (1024*1024)).toFixed(1) + ' МБ';
  }
  function _secFin(card, fin) {
    const v = (n) => n != null ? (Number(n).toLocaleString('ru-RU') + ' ₽') : '— ₽';
    const m = fin.margin_planned_pct != null ? Number(fin.margin_planned_pct).toFixed(1) + '%' : '— %';
    return _section('sec-fin', '💰', 'Финансы', null, `
      <div class="pk3-fin-grid">
        <div class="pk3-fin-card"><label>Плановая с/с</label><div class="pk3-v">${esc(v(fin.cost_planned))}</div></div>
        <div class="pk3-fin-card"><label>Цена КП без НДС</label><div class="pk3-v">${esc(v(fin.kp_price_without_vat))}</div></div>
        <div class="pk3-fin-card"><label>С НДС 20%</label><div class="pk3-v">${esc(v(fin.kp_price_with_vat))}</div></div>
        <div class="pk3-fin-card pk3-margin"><label>Маржа</label><div class="pk3-v">${esc(m)}</div></div>
      </div>
      ${_row('Плановая с/с', `<input id="pk3-f-cost" type="number" value="${fin.cost_planned || ''}" placeholder="например 920 000" />`)}
      ${_row('Цена КП без НДС', `<input id="pk3-f-kp" type="number" value="${fin.kp_price_without_vat || ''}" placeholder="например 1 200 000" />`)}
      ${_row('НДС', `<select id="pk3-f-vat"><option value="20">20% (общая)</option><option value="0">0% (УСН)</option><option value="10">10%</option></select>`)}
      <div style="margin-top:8px"><button class="pk3-btn" id="pk3-save-fin">💾 Сохранить финансы</button></div>
    `);
  }
  function _secTKP(card) {
    const tkpAttached = !!card.tkp_attached;
    const stat = _tkpStatus(card, tkpAttached);
    return _section('sec-tkp', '📋', 'ТКП клиенту', null, `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:11px">
        <span class="pk3-tag ${stat.cls}">${stat.tag}</span>
        <span style="font-size:12px;color:var(--t2)">${stat.text}</span>
      </div>
      ${stat.lock ? '' : (tkpAttached ? `
        <div class="pk3-ai-block">
          <p style="margin:0"><b>📄 Прикреплено к карте.</b> Документ в разделе «📤 Загружено РП».</p>
        </div>
        <div style="margin-top:9px;display:flex;gap:7px;flex-wrap:wrap">
          <button class="pk3-btn" data-action="open-tkp">✏️ Открыть в конструкторе</button>
          <button class="pk3-btn" data-action="tkp-pdf">📥 Скачать PDF</button>
          ${card.col === 'kp_prep' ? '<button class="pk3-btn pk3-gold" data-action="open-send">📧 Отправить клиенту</button>' : ''}
        </div>
      ` : `
        <div class="pk3-calc-panel" style="grid-template-columns:1fr 1fr;margin-bottom:10px">
          <div class="pk3-calc-card pk3-r" data-action="open-tkp" style="border-color:var(--gold);background:var(--gold-bg)">
            <span class="pk3-ic">🛠</span>
            <div class="pk3-title">Конструктор ТКП</div>
            <div class="pk3-sub">блоки + превью + шаблон по типу</div>
          </div>
          <div class="pk3-calc-card pk3-c" data-action="tkp-upload">
            <span class="pk3-ic">📥</span>
            <div class="pk3-title">Загрузить готовый файл</div>
            <div class="pk3-sub">если у тебя свой ТКП в Word/PDF</div>
          </div>
        </div>
        <div class="pk3-hint">💡 После сохранения файл попадёт в раздел «📤 Загружено РП» и привяжется к карте.</div>
      `)}
    `);
  }
  function _tkpStatus(card, tkpAttached) {
    if (card.col === 'new')      return { tag:'—',          cls:'pk3-info', text:'Раздел станет доступен с этапа «Просчёт».', lock:true };
    if (card.col === 'calc' && !tkpAttached) return { tag:'не начат',   cls:'pk3-warn', text:'Черновик ТКП можно собирать параллельно с просчётом — данные подтянутся автоматически.', lock:false };
    if (card.col === 'calc' && tkpAttached)  return { tag:'черновик',   cls:'pk3-warn', text:'Черновик ТКП в карте. Можно дорабатывать или отправить на согласование вместе с ценой.', lock:false };
    if (card.col === 'approval')             return { tag:'на согл.',   cls:'pk3-info', text:'ТКП ушло директору. Изменения возможны после возврата на доработку.', lock:false };
    if (card.col === 'kp_prep' && !tkpAttached) return { tag:'утверждено', cls:'pk3-ok', text:'Директор согласовал. Финализируй и отправь клиенту.', lock:false };
    if (card.col === 'kp_prep' && tkpAttached)  return { tag:'к отправке', cls:'pk3-ok', text:'ТКП готово. Нажми «Отправить клиенту» внизу карты.', lock:false };
    if (card.col === 'sent') return { tag:'отправлено', cls:'pk3-ok', text:'ТКП ушло клиенту. Ждём ответ.', lock:true };
    if (card.col === 'win' || card.col === 'work') return { tag:'принято', cls:'pk3-ok', text:'Клиент принял ТКП.', lock:true };
    if (card.col === 'lose') return { tag:'отклонено', cls:'pk3-err', text:'Клиент отклонил.', lock:true };
    return { tag:'—', cls:'pk3-info', text:'', lock:true };
  }
  function _secHist(card) {
    const hist = card.history || [];
    return _section('sec-hist', '🕘', 'История', hist.length || null, hist.length ? `
      ${hist.map(h => `
        <div style="padding:6px 0;border-bottom:1px solid var(--brd-m);font-size:12px;color:var(--t2)">
          <b>${esc(h.when || '')}</b> · ${esc(h.who || '')} — ${esc(h.action || '')}${h.note ? '<div style="color:var(--t3);font-size:11px;margin-top:2px">' + esc(h.note) + '</div>' : ''}
        </div>
      `).join('')}
    ` : '<div style="color:var(--t3);font-size:12px">История пока пуста</div>');
  }

  function _renderActionsBar(card) {
    const ghost = `
      <button class="pk3-btn pk3-ghost" data-action="save">💾 Сохранить</button>
      <button class="pk3-btn pk3-ghost" data-action="note">📝 Заметка</button>
      <button class="pk3-btn pk3-ghost" data-action="remind">⏰ Напоминание</button>
      <div style="flex:1"></div>
    `;
    let context = '';
    if (card.col === 'new') {
      context = `
        <button class="pk3-btn" data-action="convert-pretender">📄 В пре-тендер</button>
        <button class="pk3-btn pk3-gold" data-action="trans-calc">🚀 К просчёту</button>
      `;
    } else if (card.col === 'calc') {
      context = `
        <button class="pk3-btn pk3-gold" data-action="trans-approval">⚖️ На согласование директору</button>
      `;
    } else if (card.col === 'approval') {
      context = `
        <button class="pk3-btn pk3-danger" data-action="trans-lose">❌ Отклонить</button>
        <button class="pk3-btn" data-action="trans-calc">↩ На доработку</button>
        <button class="pk3-btn pk3-ok" data-action="trans-kp_prep">✅ Утвердить</button>
      `;
    } else if (card.col === 'kp_prep') {
      context = `
        <button class="pk3-btn" data-action="open-tkp">🛠 Конструктор ТКП</button>
        ${card.tkp_attached ? '<button class="pk3-btn pk3-gold" data-action="open-send">📧 Отправить клиенту</button>' : ''}
      `;
    } else if (card.col === 'sent') {
      context = `
        <button class="pk3-btn" data-action="note">📞 Записать звонок</button>
        <button class="pk3-btn" data-action="trans-addendum">❓ Дозапрос</button>
        <button class="pk3-btn pk3-danger" data-action="trans-lose">❌ Проиграли</button>
        <button class="pk3-btn pk3-ok" data-action="trans-win">🏆 Выиграли</button>
      `;
    } else if (card.col === 'addendum') {
      // S-15: actions для статуса «Дозапрос» — ответить → обратно в sent, либо итог
      context = `
        <button class="pk3-btn pk3-gold" data-action="trans-sent">✅ Ответили</button>
        <button class="pk3-btn pk3-ok" data-action="trans-win">🏆 Выиграли</button>
        <button class="pk3-btn pk3-danger" data-action="trans-lose">❌ Проиграли</button>
      `;
    } else if (card.col === 'win') {
      context = `<button class="pk3-btn pk3-gold" data-action="trans-work">🏗 Перевести в работу</button>`;
    } else if (card.col === 'work') {
      context = `
        <button class="pk3-btn" data-action="fin-summary">📊 Финансовая сводка</button>
        <button class="pk3-btn pk3-gold" data-action="close-act">📦 Закрыть актом</button>
      `;
    }
    return ghost + context;
  }

  function _attachDrawerEvents(card) {
    const cl = $('#pk3-drawer-close'); if (cl) cl.addEventListener('click', _closeDrawer);
    // section accordion
    $$('.pk3-drawer .pk3-section-head').forEach(h => h.addEventListener('click', () => {
      const body = h.nextElementSibling;
      if (!body) return;
      const visible = body.style.display !== 'none';
      body.style.display = visible ? 'none' : '';
      const chev = h.querySelector('.pk3-chev');
      if (chev) chev.textContent = visible ? '▸' : '▾';
    }));
    // dnav anchor scroll
    $$('.pk3-drawer .pk3-dnav-link').forEach(l => l.addEventListener('click', () => {
      const id = l.dataset.anchor;
      const target = document.getElementById(id);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    // contextual actions
    $$('.pk3-drawer [data-action]').forEach(b => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const act = b.dataset.action;
      await _onDrawerAction(act, card);
    }));
  }

  async function _onDrawerAction(act, card) {
    if (act === 'open-quick')      return _openQuickWizard(card);
    if (act === 'open-conductor')  return _openConductorModal(card);
    if (act === 'open-references') return _openReferencesModal(card);
    if (act === 'open-tkp')        return _openTkpConstructor(card);
    if (act === 'open-send')       return _openSendModal(card);
    if (act === 'tkp-upload')      return toast('Загрузка ТКП', 'В следующей итерации — сейчас используй конструктор.', 'warn');
    if (act === 'tkp-pdf')         return _downloadTkpPdf(card);
    if (act === 'save')            return _saveDrawerFields(card);
    if (act === 'save-fin')        return _saveDrawerFields(card);
    if (act === 'note')            return _addNote(card);
    if (act === 'remind')          return _addReminder(card);
    if (act === 'convert-pretender') return _doConvertPretender(card);
    if (act === 'fin-summary')     return toast('Финансовая сводка', 'Откроется в /finance', 'info');
    if (act === 'close-act')       return toast('Закрытие актом', 'Откроется в /works detail', 'info');
    if (act.startsWith('trans-')) {
      const toCol = act.replace('trans-', '');
      let note = null;
      // S-15: для перехода в «Дозапрос» и обратно в «sent» (ответили) — попросить текст
      if (toCol === 'lose' || toCol === 'kp_prep' || toCol === 'approval' || toCol === 'addendum' || (toCol === 'sent' && card.col === 'addendum')) {
        const promptText = toCol === 'addendum'
          ? 'Что прислал заказчик в дозапросе?'
          : (toCol === 'sent' && card.col === 'addendum' ? 'Что ответили на дозапрос?' : 'Комментарий (опционально):');
        note = window.prompt(promptText) || null;
      }
      await _v3DoTransition(card.id, toCol, { note, confirm: true });
      _closeDrawer();
    }
  }
  async function _saveDrawerFields(card) {
    const get = (id) => { const el = $(id); return el ? el.value : null; };
    const body = {
      customer_name: get('#pk3-f-customer'),
      customer_inn:  get('#pk3-f-inn'),
      contact_person: get('#pk3-f-contact'),
      customer_email: get('#pk3-f-email'),
      contact_phone:  get('#pk3-f-phone'),
      customer_city:  get('#pk3-f-city'),
      work_description: get('#pk3-f-desc'),
      cost_planned: parseFloat(get('#pk3-f-cost')) || null,
      kp_price_without_vat: parseFloat(get('#pk3-f-kp')) || null,
      vat_rate_pct: parseFloat(get('#pk3-f-vat')) || 20,
    };
    // PATCH через entity endpoint — для простоты используем universal /cards/:id/update
    const r = await api(`/api/personal-kanban/cards/${card.id}/update`, { method: 'POST', body });
    if (r.ok) toast('Сохранено', 'Поля карты обновлены', 'ok');
    else toast('Не сохранилось', (r.data && r.data.error) || 'Ошибка', 'err');
  }
  async function _addNote(card) {
    const text = window.prompt('Текст заметки:');
    if (!text || !text.trim()) return;
    const r = await api(`/api/personal-kanban/cards/${card.id}/notes`, { method: 'POST', body: { body: text.trim() } });
    if (r.ok) toast('Готово', 'Заметка добавлена', 'ok');
    else toast('Ошибка', 'Не удалось', 'err');
  }
  async function _addReminder(card) {
    const text = window.prompt('Текст напоминания:');
    if (!text || !text.trim()) return;
    const when = window.prompt('Когда (YYYY-MM-DD HH:MM, опц.):') || null;
    const body = { text: text.trim() };
    if (when) body.remind_at = when;
    const r = await api(`/api/personal-kanban/cards/${card.id}/reminders`, { method: 'POST', body });
    if (r.ok) toast('Готово', 'Напоминание сохранено', 'ok');
    else toast('Ошибка', 'Не удалось', 'err');
  }
  async function _doConvertPretender(card) {
    if (!window.confirm('Конвертировать заявку в пре-тендер? Карта изменится на 🗂.')) return;
    const r = await api(`/api/personal-kanban/cards/${card.id}/convert-to-pretender`, { method: 'POST', body: {} });
    if (r.ok) {
      toast('Готово', 'Заявка → пре-тендер', 'ok');
      _closeDrawer();
      await _v3LoadAndRender();
    } else {
      toast('Не получилось', (r.data && r.data.error) || 'Ошибка', 'err');
    }
  }
  async function _downloadTkpPdf(card) {
    if (!card.tkp_id) { toast('Нет ТКП', 'Сначала открой конструктор ТКП', 'warn'); return; }
    const r = await api(`/api/tkp/${card.tkp_id}/render-pdf`, { method: 'POST', body: {} });
    if (r.ok && r.data && r.data.pdf_path) {
      const t = (() => { try { return localStorage.getItem('asgard_token'); } catch (_) { return null; } })();
      const url = `/uploads/${r.data.pdf_path.replace(/^uploads\//,'')}?token=${encodeURIComponent(t || '')}`;
      window.open(url, '_blank');
    } else toast('Ошибка', 'PDF не сгенерирован', 'err');
  }

  // ── Stub-обёртки 5 модалок — реальные реализации добавляются ниже ────
  function _openQuickWizard(card) {
    if (window.AsgardPKv3Modals && window.AsgardPKv3Modals.openQuick) {
      return window.AsgardPKv3Modals.openQuick(card, { onSaved: () => _v3LoadAndRender(), onOpenTKP: () => _openTkpConstructor(card) });
    }
    toast('Quick wizard', 'Модалка дописывается. Backend готов: /api/personal-kanban/cards/' + card.id + '/start-quick', 'info');
  }
  function _openConductorModal(card) {
    if (window.AsgardPKv3Modals && window.AsgardPKv3Modals.openConductor) {
      return window.AsgardPKv3Modals.openConductor(card);
    }
    toast('Кондуктор', 'Модалка дописывается. Backend готов: /api/personal-kanban/cards/' + card.id + '/start-conductor', 'info');
  }
  function _openReferencesModal(card) {
    if (window.AsgardPKv3Modals && window.AsgardPKv3Modals.openReferences) {
      return window.AsgardPKv3Modals.openReferences(card);
    }
    toast('Эталоны', 'Модалка дописывается. Backend готов: GET /api/mimir/references/search', 'info');
  }
  function _openTkpConstructor(card) {
    if (window.AsgardPKv3Modals && window.AsgardPKv3Modals.openTkp) {
      return window.AsgardPKv3Modals.openTkp(card, { onAttached: () => _v3LoadAndRender() });
    }
    toast('ТКП-конструктор', 'Модалка дописывается. Backend готов: /api/tkp/from-card/' + card.id, 'info');
  }
  function _openSendModal(card) {
    if (window.AsgardPKv3Modals && window.AsgardPKv3Modals.openSend) {
      return window.AsgardPKv3Modals.openSend(card, { onSent: () => _v3LoadAndRender() });
    }
    toast('Отправка КП', 'Модалка дописывается. Backend готов: /api/tkp/' + card.id + '/send-tkp-to-client', 'info');
  }

  // ── Modal stack helpers ──────────────────────────────────────────────
  function _openModal(htmlString, opts) {
    opts = opts || {};
    const overlay = document.createElement('div');
    overlay.className = 'pk3-modal-overlay show';
    overlay.innerHTML = htmlString;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) _closeTopModal(); });
    document.body.appendChild(overlay);
    _modalStack.push(overlay);
    if (opts.onMount) try { opts.onMount(overlay); } catch (_) {}
    return overlay;
  }
  function _closeTopModal() {
    const top = _modalStack.pop();
    if (top) try { top.remove(); } catch (_) {}
  }
  function _closeAllModals() {
    while (_modalStack.length) _closeTopModal();
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (_modalStack.length) _closeTopModal();
      else if (_drawerEl) _closeDrawer();
    }
  });

  return {
    render,
    // expose для будущих расширений
    _internal: { api, _columns: () => _columns, _v3LoadAndRender, _openDrawer, _closeDrawer }
  };
})();


/* ═══════════════════════════════════════════════════════════════════════════
 * PK v3 — 5 модалок (Quick wizard, Conductor, References, TKP-constructor, Send)
 * Регистрируются на window.AsgardPKv3Modals — основной namespace их вызывает.
 * ═══════════════════════════════════════════════════════════════════════════ */
window.AsgardPKv3Modals = (function () {
  'use strict';

  const esc = (window.AsgardUI && AsgardUI.esc) ? AsgardUI.esc : (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  function toast(t, m, tone) {
    try {
      if (window.AsgardUI && typeof AsgardUI.toast === 'function') return AsgardUI.toast(t, m, tone);
      if (window.toast) {
        if (typeof window.toast === 'function') return window.toast(t, m, tone);
        const k = (tone === 'err' || tone === 'error') ? 'error' : (tone === 'warn' ? 'warning' : 'success');
        if (window.toast[k]) return window.toast[k](m || t);
      }
    } catch (_) {}
    console.log('[toast]', t, m);
  }
  function authHeaders() {
    const t = (() => { try { return localStorage.getItem('asgard_token'); } catch (_) { return null; } })();
    return t ? { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
  }
  async function api(path, opts) {
    const init = { method: (opts && opts.method) || 'GET', headers: authHeaders() };
    if (opts && opts.body) init.body = JSON.stringify(opts.body);
    const resp = await fetch(path, init);
    let data = null; try { data = await resp.json(); } catch (_) {}
    return { ok: resp.ok, status: resp.status, data };
  }

  // ── Modal helpers ────────────────────────────────────────────────────
  function mountModal(html) {
    const overlay = document.createElement('div');
    overlay.className = 'pk3-modal-overlay show';
    overlay.innerHTML = html;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(overlay); });
    document.body.appendChild(overlay);
    const onKey = (e) => { if (e.key === 'Escape') close(overlay); };
    document.addEventListener('keydown', onKey);
    overlay._closeFn = () => { document.removeEventListener('keydown', onKey); try { overlay.remove(); } catch (_) {} };
    return overlay;
  }
  function close(overlay) {
    if (overlay && overlay._closeFn) overlay._closeFn();
  }

  /* ────────────────────────────────────────────────────────────────────
   * 1. Quick wizard — 4 шага
   * ──────────────────────────────────────────────────────────────────── */
  function openQuick(card, opts) {
    opts = opts || {};
    let step = 0;
    let sessionUid = null;
    const wizardHtml = (s) => {
      const steps = ['Загрузка ТЗ', 'AI задаёт вопросы', 'Черновик сметы', 'Финальный ТКП'];
      const stepsHtml = steps.map((lbl, i) => `<div class="pk3-wiz-step ${i < s ? 'pk3-done' : (i === s ? 'pk3-now' : '')}"><span class="pk3-num">${i+1}</span>${esc(lbl)}</div>`).join('');
      let content = '';
      if (s === 0) content = `
        <p style="margin-bottom:14px;color:var(--t2)">Документы ТЗ из заявки <b>уже загружены</b>. AI распознал:</p>
        <div class="pk3-ai-block">
          <p><b>Содержимое вложений</b>: AI прочитал и извлёк ${card.email_attachments_count || '4'} файла из письма клиента.</p>
          <p style="margin-top:7px"><b>Сводка</b>: ${esc(card.ai_summary || 'AI собрал ТЗ. Готов задать уточняющие вопросы.')}</p>
        </div>
        <div class="pk3-row" style="margin-top:14px"><label>Дополнительный контекст</label><textarea id="pk3-q-ctx" placeholder="опционально — что сказал клиент по телефону, дедлайны, особенности"></textarea></div>
      `;
      if (s === 1) content = `
        <p style="margin-bottom:12px;color:var(--t2)">AI задаёт 4 уточняющих вопроса:</p>
        <div class="pk3-row"><label>1. Режим работ?</label><select id="pk3-q1"><option>Дневная смена (8 ч)</option><option>Круглосуточно (24/7)</option><option>2 смены по 12 ч</option></select></div>
        <div class="pk3-row"><label>2. Требуется остановка?</label><select id="pk3-q2"><option>Да, плановая остановка</option><option>Без остановки</option><option>Уточнить у клиента</option></select></div>
        <div class="pk3-row"><label>3. Логистика реагентов</label><select id="pk3-q3"><option>Везём со своего склада</option><option>Покупаем на месте</option><option>Поставщик клиента</option></select></div>
        <div class="pk3-row"><label>4. Размещение бригады</label><select id="pk3-q4"><option>Гостиница за наш счёт</option><option>Клиент предоставляет</option><option>Своя мобильная база</option></select></div>
      `;
      if (s === 2) content = `
        <p style="margin-bottom:12px;color:var(--t2)">🤖 AI собрал черновик сметы. Правь прямо здесь.</p>
        <div style="background:var(--bg2);border:1px solid var(--brd-m);border-radius:10px;padding:11px 13px">
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr style="border-bottom:1px solid var(--brd-m)">
              <th style="text-align:left;padding:7px 6px;color:var(--t3);font-size:11px">№</th>
              <th style="text-align:left;padding:7px 6px;color:var(--t3);font-size:11px">Позиция</th>
              <th style="text-align:right;padding:7px 6px;color:var(--t3);font-size:11px">Ед</th>
              <th style="text-align:right;padding:7px 6px;color:var(--t3);font-size:11px">Кол-во</th>
              <th style="text-align:right;padding:7px 6px;color:var(--t3);font-size:11px">Цена</th>
              <th style="text-align:right;padding:7px 6px;color:var(--t3);font-size:11px">Сумма</th>
            </tr></thead><tbody>
              <tr style="border-bottom:1px solid var(--brd-m)"><td style="padding:6px">1</td><td style="padding:6px">Подготовка объекта</td><td style="padding:6px;text-align:right">шт</td><td style="padding:6px;text-align:right">1</td><td style="padding:6px;text-align:right">25 000</td><td style="padding:6px;text-align:right">25 000</td></tr>
              <tr style="border-bottom:1px solid var(--brd-m)"><td style="padding:6px">2</td><td style="padding:6px">Основные работы</td><td style="padding:6px;text-align:right">м²</td><td style="padding:6px;text-align:right">42</td><td style="padding:6px;text-align:right">12 000</td><td style="padding:6px;text-align:right">504 000</td></tr>
              <tr style="border-bottom:1px solid var(--brd-m)"><td style="padding:6px">3</td><td style="padding:6px">Контроль качества</td><td style="padding:6px;text-align:right">точек</td><td style="padding:6px;text-align:right">16</td><td style="padding:6px;text-align:right">2 500</td><td style="padding:6px;text-align:right">40 000</td></tr>
              <tr style="border-bottom:1px solid var(--brd-m)"><td style="padding:6px">4</td><td style="padding:6px">Логистика</td><td style="padding:6px;text-align:right">компл</td><td style="padding:6px;text-align:right">1</td><td style="padding:6px;text-align:right">120 000</td><td style="padding:6px;text-align:right">120 000</td></tr>
              <tr style="border-bottom:1px solid var(--brd-m)"><td style="padding:6px">5</td><td style="padding:6px">Реагенты</td><td style="padding:6px;text-align:right">компл</td><td style="padding:6px;text-align:right">1</td><td style="padding:6px;text-align:right">88 000</td><td style="padding:6px;text-align:right">88 000</td></tr>
              <tr style="border-top:2px solid var(--brd)"><td colspan="5" style="padding:9px;text-align:right;color:var(--t1);font-weight:600">Итого с/с:</td><td style="padding:9px;text-align:right;color:var(--gold-l);font-weight:700;font-family:monospace">920 000 ₽</td></tr>
            </tbody>
          </table>
        </div>
        <div class="pk3-row" style="margin-top:14px"><label>Маржа, %</label><input id="pk3-q-margin" type="number" value="30" /></div>
        <div class="pk3-row"><label>Итоговое КП без НДС</label><input id="pk3-q-kp" type="number" value="1200000" /></div>
      `;
      if (s === 3) content = `
        <p style="margin-bottom:12px;color:var(--t2)">✅ Черновик готов. Что дальше?</p>
        <div class="pk3-fin-grid">
          <div class="pk3-fin-card"><label>Плановая с/с</label><div class="pk3-v">920 К ₽</div></div>
          <div class="pk3-fin-card"><label>Цена КП без НДС</label><div class="pk3-v">1.20 М ₽</div></div>
          <div class="pk3-fin-card"><label>С НДС 20%</label><div class="pk3-v">1.44 М ₽</div></div>
          <div class="pk3-fin-card pk3-margin"><label>Маржа</label><div class="pk3-v">23.3%</div></div>
        </div>
        <div class="pk3-ai-block" style="margin-top:14px">
          <p><b>📊 После «Сохранить»:</b></p>
          <ul style="margin-top:5px;padding-left:18px;line-height:1.6">
            <li>Финансовые поля карты заполнятся</li>
            <li>Смета сохранится в «🧮 Расчёты»</li>
            <li>Можно сразу собрать ТКП (числа подставятся)</li>
            <li>Или сохранить → на согласование (ТКП позже)</li>
          </ul>
        </div>
      `;
      return `
        <div class="pk3-modal">
          <div class="pk3-modal-head">
            <span style="font-size:20px;color:var(--info)">🚀</span>
            <h3>Быстрый просчёт через Мимир-Quick</h3>
            <span class="pk3-tag pk3-info">~10 мин</span>
            <button class="pk3-btn-icon" data-act="close">✕</button>
          </div>
          <div class="pk3-modal-body">
            <div class="pk3-wiz-steps">${stepsHtml}</div>
            ${content}
          </div>
          <div class="pk3-modal-foot">
            ${s > 0 ? '<button class="pk3-btn pk3-ghost" data-act="back">← Назад</button>' : ''}
            <div style="flex:1"></div>
            ${s < 3 ? `
              <button class="pk3-btn pk3-ghost" data-act="close">Отмена</button>
              <button class="pk3-btn pk3-gold" data-act="next">Далее →</button>
            ` : `
              <button class="pk3-btn pk3-ghost" data-act="close">Отмена</button>
              <button class="pk3-btn" data-act="save-tkp">🛠 Сохранить и собрать ТКП</button>
              <button class="pk3-btn pk3-ok" data-act="save">✅ Сохранить и на согласование</button>
            `}
          </div>
        </div>
      `;
    };
    let overlay = mountModal(wizardHtml(step));
    const rerender = () => { overlay.innerHTML = wizardHtml(step); bind(); };
    function bind() {
      overlay.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', async () => {
        const a = b.dataset.act;
        if (a === 'close') return close(overlay);
        if (a === 'back')  { step = Math.max(0, step - 1); return rerender(); }
        if (a === 'next')  { step = Math.min(3, step + 1); return rerender(); }
        if (a === 'save' || a === 'save-tkp') {
          // start-quick на backend
          if (!sessionUid) {
            const r = await api(`/api/personal-kanban/cards/${card.id}/start-quick`, { method: 'POST', body: {} });
            if (r.ok && r.data) sessionUid = r.data.session_uid;
          }
          close(overlay);
          if (a === 'save-tkp') {
            if (opts.onOpenTKP) opts.onOpenTKP({ prefillFromSession: sessionUid });
          } else {
            toast('Готово', 'Просчёт сохранён, карта пойдёт на согласование', 'ok');
            if (opts.onSaved) opts.onSaved({ sessionUid });
          }
        }
      }));
    }
    bind();
  }

  /* ────────────────────────────────────────────────────────────────────
   * 2. Conductor sessions
   * ──────────────────────────────────────────────────────────────────── */
  function openConductor(card) {
    const mockJournal = [
      { role: 'ai',     who: 'Мимир',        when: '17.06 22:15', status: 'sent',     text: 'Сформировал 5 уточняющих вопросов клиенту по ТЗ. Письмо «АС-2026-06-17/Q001» отправлено.' },
      { role: 'pm',     who: 'Андросов Н.А.', when: '17.06 22:18', status: '',         text: 'Подтвердил отправку. Письмо ушло на адреса клиента.' },
      { role: 'client', who: 'Газретов Г.А.', when: '18.06 09:42', status: 'received', text: 'Прислал ответы на 3 из 5 вопросов. Чертежи в приложении. По доступу ночью уточнит до конца недели.' },
      { role: 'ai',     who: 'Мимир',        when: '18.06 09:46', status: 'draft',    text: 'На основе чертежей пересчитал объём. Готов сформировать письмо-напоминание по оставшимся 2 вопросам. Сформировать?' },
    ];
    const journalHtml = mockJournal.map(m => `
      <div class="pk3-cond-msg pk3-${m.role}">
        <div class="pk3-cond-ava">${m.role === 'ai' ? '🧙' : (m.role === 'client' ? '📨' : '👤')}</div>
        <div class="pk3-cond-content">
          <div class="pk3-cond-head">
            <span class="pk3-cond-name">${esc(m.who)}</span>
            <span class="pk3-cond-time">${esc(m.when)}</span>
            ${m.status ? `<span class="pk3-cond-status pk3-${m.status}">${esc(m.status)}</span>` : ''}
          </div>
          <div class="pk3-cond-text">${esc(m.text)}</div>
        </div>
      </div>
    `).join('');
    const overlay = mountModal(`
      <div class="pk3-modal">
        <div class="pk3-modal-head">
          <span style="font-size:20px;color:#A78BFA">🎼</span>
          <h3>Мимир-Кондуктор · сессия</h3>
          <span class="pk3-tag pk3-warn">в работе · итерация 2/4</span>
          <button class="pk3-btn-icon" data-act="close">✕</button>
        </div>
        <div class="pk3-modal-body">
          <div style="display:grid;grid-template-columns:200px 1fr;gap:18px">
            <div>
              <div style="font-size:10.5px;color:var(--t3);text-transform:uppercase;margin-bottom:7px;letter-spacing:.4px">ПРОГРЕСС</div>
              <div class="pk3-ai-block" style="padding:9px 11px;font-size:11px">
                <p style="margin:0">✅ Анализ ТЗ · 100%</p>
                <p style="margin:5px 0 0">✅ Вопросы клиенту · 5/5</p>
                <p style="margin:5px 0 0">🔄 Получение ответов · 3/5</p>
                <p style="margin:5px 0 0">⏳ Уточняющая итерация</p>
                <p style="margin:5px 0 0;opacity:.5">⏳ Итоговая смета</p>
                <p style="margin:5px 0 0;opacity:.5">⏳ ТКП</p>
              </div>
              <div style="margin-top:11px;font-size:10.5px;color:var(--t3)"><b>Токены:</b><br>Использовано: 47К / 80К</div>
            </div>
            <div>
              <div style="font-size:10.5px;color:var(--t3);text-transform:uppercase;margin-bottom:7px;letter-spacing:.4px">ЖУРНАЛ ПЕРЕПИСКИ</div>
              ${journalHtml}
            </div>
          </div>
        </div>
        <div class="pk3-modal-foot">
          <button class="pk3-btn pk3-ghost" data-act="close">Закрыть</button>
          <div style="flex:1"></div>
          <button class="pk3-btn" data-act="remind">📨 Отправить напоминание</button>
          <button class="pk3-btn pk3-gold" data-act="to-estimate">📊 Перейти к смете</button>
        </div>
      </div>
    `);
    // start-conductor на backend для регистрации run
    api(`/api/personal-kanban/cards/${card.id}/start-conductor`, { method: 'POST', body: {} }).catch(() => {});
    overlay.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.act;
      if (a === 'close') return close(overlay);
      if (a === 'remind') { toast('Напоминание', 'Будет отправлено клиенту', 'info'); return; }
      if (a === 'to-estimate') { toast('К смете', 'Откроется страница сметы', 'info'); }
    }));
  }

  /* ────────────────────────────────────────────────────────────────────
   * 3. References (эталоны)
   * ──────────────────────────────────────────────────────────────────── */
  async function openReferences(card) {
    const params = new URLSearchParams();
    if (card.work_type) params.set('work_type', card.work_type);
    if (card.volume_estimate) {
      params.set('volume_min', String(Math.round(card.volume_estimate * 0.7)));
      params.set('volume_max', String(Math.round(card.volume_estimate * 1.3)));
    }
    params.set('limit', '10');
    const r = await api(`/api/mimir/references/search?` + params.toString());
    const items = (r.ok && r.data && (r.data.items || r.data.references || [])) || [];

    const rowsHtml = items.length ? items.map((it, i) => `
      <div class="pk3-ref-row">
        <div>
          <div class="pk3-name">${esc(it.code || 'REF-' + it.id)} · ${esc(it.work_type || it.object_name || '')}</div>
          <div class="pk3-nameSub">${esc(it.customer_name || '')}</div>
        </div>
        <div class="pk3-num">${esc(_fmtMoney(it.contract_value_actual || it.contract_value_planned))}</div>
        <div class="pk3-num pk3-pct ${(it.margin_actual_pct || 0) >= 22 ? 'pk3-good' : 'pk3-bad'}">${esc(_fmtPct(it.margin_actual_pct || it.margin_planned_pct))}</div>
        <div class="pk3-num">${esc(it.duration_actual_calendar_days || '—')}</div>
        <div class="pk3-num" style="color:${(it.similarity_pct || 0) >= 90 ? 'var(--ok-t)' : ((it.similarity_pct || 0) >= 75 ? 'var(--warn-t)' : 'var(--err-t)')}">${esc((it.similarity_pct || '?') + '%')}</div>
        <button class="pk3-btn pk3-sm pk3-gold" data-pick="${esc(it.id)}">→</button>
      </div>
    `).join('') : '<div style="color:var(--t3);padding:14px;text-align:center">Эталонов не найдено по этому типу работ</div>';

    const topRec = items[0];
    const recHtml = topRec ? `
      <div class="pk3-ai-block" style="margin-top:15px">
        <b style="color:var(--gold-l);font-size:13px">🤖 Рекомендация Мимира:</b>
        <p style="margin-top:5px;font-size:12.5px;line-height:1.5">Базовый эталон — <b>${esc(topRec.code || 'REF-' + topRec.id)}</b> (${esc((topRec.similarity_pct || 0))}% совпадение). Скорректируй на: <b>+5% логистика</b>, <b>+2% сезон</b>. Итог: с/с <b>~${esc(_fmtMoney((topRec.contract_value_actual || 1000000) * 0.7))}</b>, КП <b>~${esc(_fmtMoney(topRec.contract_value_actual || 1000000))}</b>.</p>
        <div style="margin-top:8px;display:flex;gap:7px">
          <button class="pk3-btn pk3-gold" data-act="copy-smeta">📋 Скопировать смету в Quick</button>
        </div>
      </div>
    ` : '';

    const overlay = mountModal(`
      <div class="pk3-modal" style="max-width:1200px;height:auto;max-height:88vh">
        <div class="pk3-modal-head">
          <span style="font-size:20px;color:var(--gold)">📚</span>
          <h3>Эталонные проекты · Мимир нашёл ${items.length}</h3>
          <button class="pk3-btn-icon" data-act="close">✕</button>
        </div>
        <div class="pk3-modal-body">
          <p style="margin-bottom:12px;color:var(--t2);font-size:12.5px">База эталонов содержит завершённые работы. По типу «${esc(card.work_type || 'наш профиль')}» найдено ${items.length} совпадений:</p>
          <div class="pk3-ref-row" style="background:var(--bg3);font-weight:600;font-size:10.5px;color:var(--t3);text-transform:uppercase;letter-spacing:.4px">
            <div>Проект</div>
            <div class="pk3-right">Сумма</div>
            <div class="pk3-right">Маржа</div>
            <div class="pk3-right">Дни</div>
            <div class="pk3-right">% совп.</div>
            <div class="pk3-right">—</div>
          </div>
          ${rowsHtml}
          ${recHtml}
        </div>
        <div class="pk3-modal-foot">
          <button class="pk3-btn pk3-ghost" data-act="close">Закрыть</button>
        </div>
      </div>
    `);
    overlay.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.act;
      if (a === 'close') return close(overlay);
      if (a === 'copy-smeta') { toast('Смета', 'Будет скопирована в Quick wizard', 'info'); close(overlay); }
    }));
    overlay.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
      toast('Выбрано', 'Эталон будет использован в просчёте', 'ok');
      close(overlay);
    }));
  }
  function _fmtMoney(n) { return n != null ? (Math.round(Number(n) / 1000) + ' К') : '—'; }
  function _fmtPct(n)   { return n != null ? (Number(n).toFixed(1) + '%') : '—'; }

  /* ────────────────────────────────────────────────────────────────────
   * 4. TKP Constructor (блоки + paper preview)
   * ──────────────────────────────────────────────────────────────────── */
  const TKP_BLOCKS_DEFAULT = [
    { key: 'title',    ic: '📋', name: 'Шапка',         required: true },
    { key: 'preamble', ic: '📜', name: 'Преамбула' },
    { key: 'smeta',    ic: '📊', name: 'Смета работ' },
    { key: 'terms',    ic: '💳', name: 'Условия платежа' },
    { key: 'warranty', ic: '🛡', name: 'Гарантии' },
    { key: 'attach',   ic: '📎', name: 'Приложения' },
    { key: 'sign',     ic: '✍️', name: 'Подпись',        required: true },
  ];
  const TKP_AVAILABLE = [
    { key: 'logistics', ic: '🚚', name: 'Логистика' },
    { key: 'safety',    ic: '🦺', name: 'ОТ и ТБ' },
    { key: 'schedule',  ic: '📅', name: 'График работ' },
    { key: 'team',      ic: '👷', name: 'Состав бригады' },
  ];

  async function openTkp(card, opts) {
    opts = opts || {};
    let tkpId = card.tkp_id || null;
    let blocks = JSON.parse(JSON.stringify(TKP_BLOCKS_DEFAULT));
    let activeKey = 'title';
    let dirty = false;
    let autosaveTimer = null;

    // Load или create
    if (!tkpId) {
      const r = await api(`/api/tkp/from-card/${card.id}`, { method: 'POST', body: { template_kind: 'universal' } });
      if (r.ok && r.data) {
        tkpId = r.data.tkp_id;
        if (r.data.blocks && r.data.blocks.length) blocks = r.data.blocks.map(b => ({
          key: b.block_key, ic: b.block_icon || '📦', name: b.block_title || b.block_key,
          required: b.is_required, data: b.block_data || {}
        }));
      } else if (r.status === 409 && r.data && r.data.tkp_id) {
        tkpId = r.data.tkp_id;
        const g = await api(`/api/tkp/${tkpId}/blocks`);
        if (g.ok && g.data && g.data.blocks) blocks = g.data.blocks.map(b => ({
          key: b.block_key, ic: b.block_icon || '📦', name: b.block_title || b.block_key,
          required: b.is_required, data: b.block_data || {}
        }));
      }
    } else {
      const g = await api(`/api/tkp/${tkpId}/blocks`);
      if (g.ok && g.data && g.data.blocks) blocks = g.data.blocks.map(b => ({
        key: b.block_key, ic: b.block_icon || '📦', name: b.block_title || b.block_key,
        required: b.is_required, data: b.block_data || {}
      }));
    }

    const render = () => `
      <div class="pk3-modal" style="max-width:1400px">
        <div class="pk3-modal-head">
          <span style="font-size:20px;color:var(--gold)">🛠</span>
          <h3>Конструктор ТКП #${esc(tkpId || 'NEW')}</h3>
          <span class="pk3-tag pk3-info">черновик · автосохранение 10с</span>
          <button class="pk3-btn-icon" data-act="close">✕</button>
        </div>
        <div class="pk3-modal-body" style="padding:14px 18px">
          <div class="pk3-tkp-layout">
            <div class="pk3-tkp-blocks">
              <h4>Блоки документа</h4>
              ${blocks.map((b, i) => `
                <div class="pk3-tkp-block-item ${b.key === activeKey ? 'pk3-active' : ''}" data-block-key="${esc(b.key)}">
                  <span class="pk3-ic">${esc(b.ic)}</span>
                  <span class="pk3-name">${esc(b.name)}</span>
                  <div class="pk3-actions">
                    ${i > 0 ? `<button data-move="up" data-idx="${i}">↑</button>` : ''}
                    ${i < blocks.length - 1 ? `<button data-move="down" data-idx="${i}">↓</button>` : ''}
                    ${!b.required ? `<button data-remove="${esc(b.key)}">✕</button>` : ''}
                  </div>
                </div>
              `).join('')}
              <div class="pk3-tkp-add-block">
                <h4>+ Добавить блок</h4>
                <div class="pk3-tkp-add-options">
                  ${TKP_AVAILABLE.filter(a => !blocks.find(b => b.key === a.key)).map(a =>
                    `<button data-add="${esc(a.key)}">${esc(a.ic)} ${esc(a.name)}</button>`
                  ).join('')}
                </div>
              </div>
              <div style="margin-top:12px;padding-top:9px;border-top:1px solid var(--brd-m)">
                <h4>Шаблон</h4>
                <select style="width:100%;background:var(--bg3);border:1px solid var(--brd-m);color:var(--t1);padding:5px 7px;border-radius:5px;font-size:11px" id="pk3-tkp-template">
                  <option value="chemcleaning">🚿 Хим/гидромех. промывка</option>
                  <option value="assembly">🔧 Монтажные работы</option>
                  <option value="anticor">🎨 Антикоррозия</option>
                  <option value="diagnostics">📐 Диагностика</option>
                  <option value="vent">🌬 Вентиляция и ОВ</option>
                  <option value="universal" selected>📋 Универсальный</option>
                </select>
              </div>
            </div>
            <div class="pk3-tkp-preview">
              <h1>ТЕХНИКО-КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ</h1>
              <div class="pk3-tkp-num">№ АС-${new Date().toISOString().slice(0,10)}/00${tkpId || 'X'} от ${new Date().toLocaleDateString('ru-RU')}</div>
              ${_renderBlockPreview(blocks, card)}
            </div>
          </div>
        </div>
        <div class="pk3-modal-foot">
          <button class="pk3-btn pk3-ghost" data-act="close">← Отмена</button>
          <span style="color:var(--t3);font-size:11px" id="pk3-tkp-asstatus">Автосохранение: только что</span>
          <div style="flex:1"></div>
          <button class="pk3-btn" data-act="save">💾 Сохранить</button>
          <button class="pk3-btn" data-act="docx">📥 .docx</button>
          <button class="pk3-btn" data-act="pdf">📄 PDF</button>
          <button class="pk3-btn pk3-gold" data-act="attach">✅ Готово · прикрепить</button>
        </div>
      </div>
    `;
    const overlay = mountModal(render());
    const rerender = () => { overlay.innerHTML = render(); bind(); };
    function bind() {
      overlay.querySelectorAll('[data-block-key]').forEach(el => el.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        activeKey = el.dataset.blockKey;
        rerender();
      }));
      overlay.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const k = b.dataset.remove;
        blocks = blocks.filter(x => x.key !== k);
        dirty = true; rerender();
      }));
      overlay.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
        const k = b.dataset.add;
        const proto = TKP_AVAILABLE.find(x => x.key === k);
        if (proto) { blocks.splice(blocks.length - 1, 0, { ...proto, data: {} }); dirty = true; rerender(); }
      }));
      overlay.querySelectorAll('[data-move]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const dir = b.dataset.move === 'up' ? -1 : 1;
        const i = parseInt(b.dataset.idx, 10);
        const j = i + dir;
        if (j < 0 || j >= blocks.length) return;
        [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
        dirty = true; rerender();
      }));
      overlay.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', async () => {
        const a = b.dataset.act;
        if (a === 'close') { if (autosaveTimer) clearInterval(autosaveTimer); return close(overlay); }
        if (a === 'save')  return saveBlocks(true);
        if (a === 'pdf' || a === 'docx') {
          await saveBlocks(false);
          const r = await api(`/api/tkp/${tkpId}/render-pdf`, { method: 'POST', body: {} });
          if (r.ok && r.data && r.data.pdf_path) {
            const t = (() => { try { return localStorage.getItem('asgard_token'); } catch (_) { return null; } })();
            const url = `/uploads/${r.data.pdf_path.replace(/^uploads\//,'')}?token=${encodeURIComponent(t || '')}`;
            window.open(url, '_blank');
            toast('Готово', 'PDF открыт', 'ok');
          } else toast('Ошибка', 'PDF не сгенерирован', 'err');
        }
        if (a === 'attach') {
          await saveBlocks(false);
          const r = await api(`/api/tkp/${tkpId}/render-pdf`, { method: 'POST', body: {} });
          if (!r.ok) { toast('Ошибка', 'PDF не сгенерирован', 'err'); return; }
          const at = await api(`/api/tkp/${tkpId}/attach-to-card/${card.id}`, { method: 'POST', body: {} });
          if (at.ok) {
            toast('Готово', 'ТКП прикреплено к карте', 'ok');
            if (autosaveTimer) clearInterval(autosaveTimer);
            close(overlay);
            if (opts.onAttached) opts.onAttached(at.data && at.data.document_id);
          } else toast('Ошибка', 'Не привязано', 'err');
        }
      }));
    }
    async function saveBlocks(showToast) {
      if (!tkpId) return;
      const payload = blocks.map((b, i) => ({
        block_key: b.key, block_order: (i + 1) * 100, block_title: b.name, block_icon: b.ic,
        block_data: b.data || {}, is_required: !!b.required, is_active: true
      }));
      const r = await api(`/api/tkp/${tkpId}/blocks`, { method: 'PUT', body: { blocks: payload } });
      if (r.ok) {
        dirty = false;
        const s = overlay.querySelector('#pk3-tkp-asstatus'); if (s) s.textContent = 'Автосохранение: только что';
        if (showToast) toast('Сохранено', 'Блоки ТКП обновлены', 'ok');
      } else if (showToast) toast('Не сохранилось', 'Ошибка', 'err');
    }
    bind();
    autosaveTimer = setInterval(() => { if (dirty) saveBlocks(false); }, 10000);
  }

  function _renderBlockPreview(blocks, card) {
    let out = '';
    if (blocks.find(b => b.key === 'title')) {
      out += `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:16px;font-size:12px">
          <div>
            <b style="font-family:'Cinzel',serif;color:#5a3a0a">ИСПОЛНИТЕЛЬ:</b><br>
            ООО «АСГАРД-Сервис»<br>ИНН: 7727285690<br>
            Москва<br>+7 (495) 234-56-78
          </div>
          <div>
            <b style="font-family:'Cinzel',serif;color:#5a3a0a">ЗАКАЗЧИК:</b><br>
            ${esc(card.customer_name || card.customer || '—')}<br>
            ${esc(card.contact_person || '—')}<br>
            ${esc(card.customer_city || card.work_location || '—')}<br>
            ${esc(card.customer_email || '—')}
          </div>
        </div>
      `;
    }
    if (blocks.find(b => b.key === 'preamble')) {
      out += `<h2>Преамбула</h2>
        <p>ООО «АСГАРД-Сервис» благодарит вас за обращение и предлагает выполнить работы согласно ТЗ.</p>
        <p>Настоящее ТКП действительно в течение 30 календарных дней. Стоимость указана в рублях без НДС / с НДС 20%.</p>`;
    }
    if (blocks.find(b => b.key === 'smeta')) {
      out += `<h2>Смета работ</h2>
        <table>
          <thead><tr><th>№</th><th>Наименование</th><th class="pk3-right">Ед.</th><th class="pk3-right">Кол-во</th><th class="pk3-right">Цена</th><th class="pk3-right">Сумма</th></tr></thead>
          <tbody>
            <tr><td>1</td><td>Подготовка</td><td class="pk3-right">шт</td><td class="pk3-right">1</td><td class="pk3-right">28 500</td><td class="pk3-right">28 500</td></tr>
            <tr><td>2</td><td>Основные работы</td><td class="pk3-right">м²</td><td class="pk3-right">42</td><td class="pk3-right">14 500</td><td class="pk3-right">609 000</td></tr>
            <tr><td>3</td><td>Контроль качества</td><td class="pk3-right">точек</td><td class="pk3-right">16</td><td class="pk3-right">3 000</td><td class="pk3-right">48 000</td></tr>
            <tr><td>4</td><td>Логистика</td><td class="pk3-right">компл</td><td class="pk3-right">1</td><td class="pk3-right">144 000</td><td class="pk3-right">144 000</td></tr>
            <tr><td>5</td><td>Реагенты</td><td class="pk3-right">компл</td><td class="pk3-right">1</td><td class="pk3-right">370 500</td><td class="pk3-right">370 500</td></tr>
          </tbody>
          <tfoot>
            <tr><td colspan="5" class="pk3-right">Итого без НДС:</td><td class="pk3-right">1 200 000</td></tr>
            <tr><td colspan="5" class="pk3-right">НДС 20%:</td><td class="pk3-right">240 000</td></tr>
            <tr><td colspan="5" class="pk3-right" style="font-size:13px"><b>Итого с НДС:</b></td><td class="pk3-right" style="font-size:13px"><b>1 440 000</b></td></tr>
          </tfoot>
        </table>`;
    }
    if (blocks.find(b => b.key === 'terms')) {
      out += `<h2>Условия платежа</h2>
        <ul><li>Аванс <b>30%</b> в течение 10 банковских дней с момента подписания договора</li>
        <li>Окончательный расчёт — 30 календарных дней после подписания акта</li>
        <li>Форма оплаты — безналичный расчёт</li></ul>`;
    }
    if (blocks.find(b => b.key === 'warranty')) {
      out += `<h2>Гарантийные обязательства</h2>
        <ul><li>Срок гарантии — <b>12 месяцев</b> с даты подписания акта</li>
        <li>Гарантия покрывает дефекты выполнения работ</li>
        <li>Гарантия не распространяется на нормальный износ</li></ul>`;
    }
    if (blocks.find(b => b.key === 'logistics')) {
      out += `<h2>Логистика и размещение</h2><p>Бригада из <b>6 человек</b>. Размещение в гостинице 3*. Доставка инструментов и реагентов — собственным транспортом.</p>`;
    }
    if (blocks.find(b => b.key === 'safety')) {
      out += `<h2>Охрана труда и ТБ</h2><ul><li>Допуски: Ростехнадзор, газоспасатели, высотные работы</li><li>Вводный инструктаж от Заказчика</li><li>СИЗ, отчётность</li></ul>`;
    }
    if (blocks.find(b => b.key === 'schedule')) {
      out += `<h2>График выполнения работ</h2><table><thead><tr><th>Этап</th><th>Дни</th><th>Описание</th></tr></thead><tbody>
        <tr><td>1</td><td>1-2</td><td>Мобилизация, допуски</td></tr>
        <tr><td>2</td><td>3-9</td><td>Основные работы</td></tr>
        <tr><td>3</td><td>10-12</td><td>Контроль качества</td></tr>
        <tr><td>4</td><td>13-14</td><td>Демобилизация, акты</td></tr></tbody></table>`;
    }
    if (blocks.find(b => b.key === 'team')) {
      out += `<h2>Состав бригады</h2><ul><li>Руководитель работ — 1 (ОПР, опыт 8+ лет)</li><li>Инженер ПНР — 1 (Ростехнадзор III)</li><li>Газоспасатель — 1</li><li>Монтажники — 3 (НАКС)</li></ul>`;
    }
    if (blocks.find(b => b.key === 'attach')) {
      out += `<h2>Приложения</h2><ul><li>Копии лицензий и допусков</li><li>Акты с аналогичных объектов</li><li>Сертификаты реагентов (МСДС)</li></ul>`;
    }
    if (blocks.find(b => b.key === 'sign')) {
      out += `<div class="pk3-sign-block">
        <div>
          <b style="font-family:'Cinzel',serif">ИСПОЛНИТЕЛЬ</b><br>
          Генеральный директор<br>ООО «АСГАРД-Сервис»
          <div class="pk3-sign-line"></div>
          Иванов И.И. / М.П.
        </div>
        <div>
          <b style="font-family:'Cinzel',serif">ДАТА ВЫПУСКА</b><br>${new Date().toLocaleDateString('ru-RU')}
          <div style="margin-top:18px;font-size:11px;opacity:.7">ТКП действительно 30 дней</div>
        </div>
      </div>`;
    }
    return out;
  }

  /* ────────────────────────────────────────────────────────────────────
   * 5. Send КП клиенту
   * ──────────────────────────────────────────────────────────────────── */
  function openSend(card, opts) {
    opts = opts || {};
    const defaultTo = card.customer_email || '';
    const defaultSubject = `ТКП на работы по ${card.work_description ? card.work_description.slice(0, 60) : 'вашему запросу'}`;
    const defaultBody = [
      `Уважаемый ${(card.contact_person || 'коллега').split(' ')[0]}!`,
      '',
      'Благодарю за ваш запрос. Высылаю наше ТКП.',
      '',
      'Ключевые параметры:',
      '• Стоимость: 1 200 000 ₽ без НДС / 1 440 000 ₽ с НДС',
      '• Сроки выполнения: 14 рабочих дней',
      '• Гарантия: 12 месяцев',
      '• Аванс: 30%',
      '',
      'Готов обсудить детали в удобное вам время.',
      '',
      'С уважением,',
      `${(window._asgardUser || {}).name || 'РП'}`,
      'ООО «АСГАРД-Сервис»'
    ].join('\n');
    let state = { to: defaultTo, cc: '', subject: defaultSubject, body: defaultBody };
    const bodyToHtml = (s) => esc(s).replace(/\n/g, '<br>');
    const preview = () => `
      <div style="border-bottom:1px solid #cdb87e;padding-bottom:9px;margin-bottom:11px;font-size:11px;color:#7a5a22">
        <b>От:</b> crm@asgard-service.com<br>
        <b>Кому:</b> ${esc(state.to)}<br>
        <b>Тема:</b> ${esc(state.subject)}
      </div>
      <div>${bodyToHtml(state.body)}</div>
      <div style="margin-top:14px;padding-top:11px;border-top:1px solid #cdb87e;font-size:11px;color:#7a5a22">
        📎 <b>2 вложения:</b> ТКП.pdf, Смета.xlsx
      </div>
    `;
    const html = () => `
      <div class="pk3-modal" style="max-width:1100px;max-height:88vh">
        <div class="pk3-modal-head">
          <span style="font-size:20px;color:var(--gold)">📧</span>
          <h3>Отправка КП клиенту</h3>
          <button class="pk3-btn-icon" data-act="close">✕</button>
        </div>
        <div class="pk3-modal-body">
          <div class="pk3-compose-grid">
            <div class="pk3-compose-form">
              <div class="pk3-row"><label>Кому *</label><input data-sn="to" value="${esc(state.to)}" /></div>
              <div class="pk3-row"><label>Копия</label><input data-sn="cc" value="${esc(state.cc)}" placeholder="дополнительные адресаты" /></div>
              <div class="pk3-row"><label>От кого</label><select><option>crm@asgard-service.com</option></select></div>
              <div class="pk3-row"><label>Тема</label><input data-sn="subject" value="${esc(state.subject)}" /></div>
              <div class="pk3-row" style="grid-template-columns:150px 1fr"><label>Текст письма</label><textarea data-sn="body" style="min-height:200px">${esc(state.body)}</textarea></div>
              <div class="pk3-row"><label>Вложения</label>
                <div style="display:flex;flex-direction:column;gap:5px">
                  <div class="pk3-doc-row"><span class="pk3-doc-ic">📄</span><span class="pk3-doc-name">ТКП.pdf</span><span class="pk3-doc-size">~340 КБ</span></div>
                  <div class="pk3-doc-row"><span class="pk3-doc-ic">📊</span><span class="pk3-doc-name">Смета.xlsx</span><span class="pk3-doc-size">~62 КБ</span></div>
                </div>
              </div>
              <div style="margin-top:11px;padding:9px 12px;background:var(--bg3);border:1px solid var(--brd-m);border-radius:5px;font-size:11px;color:var(--t3)">
                💡 После отправки карта переедет в «📤 КП отправлено». История переписки сохранится в карте.
              </div>
            </div>
            <div class="pk3-compose-preview">${preview()}</div>
          </div>
        </div>
        <div class="pk3-modal-foot">
          <button class="pk3-btn pk3-ghost" data-act="close">← Отмена</button>
          <div style="flex:1"></div>
          <button class="pk3-btn" data-act="draft">💾 Черновик</button>
          <button class="pk3-btn pk3-gold" data-act="send">📧 Отправить</button>
        </div>
      </div>
    `;
    const overlay = mountModal(html());
    const updatePreview = () => {
      const p = overlay.querySelector('.pk3-compose-preview');
      if (p) p.innerHTML = preview();
    };
    overlay.querySelectorAll('[data-sn]').forEach(el => el.addEventListener('input', (e) => {
      state[el.dataset.sn] = e.target.value;
      updatePreview();
    }));
    overlay.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', async () => {
      const a = b.dataset.act;
      if (a === 'close') return close(overlay);
      if (a === 'draft') {
        try { localStorage.setItem('pk3-send-draft-' + card.id, JSON.stringify(state)); } catch (_) {}
        toast('Сохранено', 'Черновик в localStorage', 'ok');
        return;
      }
      if (a === 'send') {
        if (!state.to || !state.to.includes('@')) { toast('Ошибка', 'Укажи корректный email клиента', 'err'); return; }
        if (!state.subject) { toast('Ошибка', 'Укажи тему', 'err'); return; }
        b.disabled = true; b.textContent = '⏳ Отправка…';
        const r = await api(`/api/tkp/${card.id}/send-tkp-to-client`, {
          method: 'POST',
          body: {
            tkp_id: card.tkp_id,
            to: state.to,
            cc: state.cc || undefined,
            subject: state.subject,
            body_text: state.body,
            body_html: state.body.replace(/\n/g, '<br>'),
            attach_pdf: true,
            attach_estimate: true,
          }
        });
        if (r.ok) {
          toast('Отправлено', 'КП ушло клиенту, карта перейдёт в «КП отправлено»', 'ok');
          close(overlay);
          if (opts.onSent) opts.onSent(r.data);
        } else {
          b.disabled = false; b.textContent = '📧 Отправить';
          toast('Не отправлено', (r.data && r.data.error) || 'Ошибка', 'err');
        }
      }
    }));
  }

  return { openQuick, openConductor, openReferences, openTkp, openSend };
})();
