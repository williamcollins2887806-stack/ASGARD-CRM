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
  const fmtDate = (iso) => iso ? (AsgardUI.formatDate ? AsgardUI.formatDate(iso) : new Date(iso).toLocaleDateString('ru-RU')) : '—';

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
    // 22.06.2026: подгружаем Caveat/Permanent Marker (Google Fonts) через <link> в head —
    // надёжнее чем @import в CSS (некоторые SW/CSP режут @import).
    if (!document.getElementById('asg-pk-fonts')) {
      const fLink = document.createElement('link');
      fLink.id = 'asg-pk-fonts';
      fLink.rel = 'stylesheet';
      fLink.href = 'https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Permanent+Marker&display=swap';
      document.head.appendChild(fLink);
    }
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
.pk-tline{display:flex;flex-direction:column;gap:8px;padding-right:6px}
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
/* Когда показан busy-overlay — скрываем фоновый прогресс-line,
   иначе юзер видит дубль текста под полупрозрачным фоном. */
.pk3-modal:has(.pk3-busy) #pk3-q-progress,
.pk3-modal:has(.pk3-busy) #pk3-q-prog-line { visibility: hidden }
/* Busy-overlay: накладывается на pk3-modal во время AI-вызовов.
   Полупрозрачный фон + spinner + текст состояния. Перехватывает клики чтобы
   юзер не двойным-кликом повторно слал запрос. Кнопки фона visually disabled. */
.pk3-busy{position:absolute;inset:0;background:rgba(15,15,18,.78);backdrop-filter:blur(3px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;z-index:50;border-radius:14px;animation:pk3-fade-in .18s ease-out;pointer-events:auto}
.pk3-busy-spin{width:46px;height:46px;border-radius:50%;border:3px solid rgba(255,255,255,.08);border-top-color:#D4A843;animation:pk3-spin .8s linear infinite}
.pk3-busy-text{color:#E8C35A;font-size:14px;font-weight:600;font-family:Cinzel,Georgia,serif;letter-spacing:.4px;text-align:center;max-width:80%;line-height:1.5}
.pk3-busy-sub{color:rgba(255,255,255,.55);font-size:11.5px;text-align:center;margin-top:-2px}
.pk3-busy-dots::after{content:'';display:inline-block;width:18px;text-align:left;animation:pk3-dots 1.2s steps(4,end) infinite}
@keyframes pk3-spin{to{transform:rotate(360deg)}}
@keyframes pk3-fade-in{from{opacity:0}to{opacity:1}}
@keyframes pk3-dots{0%{content:''}25%{content:'.'}50%{content:'..'}75%{content:'...'}100%{content:''}}
/* Кнопка во время своего запроса: spinner вместо иконки */
.pk3-btn.pk3-loading{position:relative;color:transparent !important;pointer-events:none}
.pk3-btn.pk3-loading::after{content:'';position:absolute;left:50%;top:50%;width:14px;height:14px;border-radius:50%;border:2px solid rgba(0,0,0,.18);border-top-color:currentColor;color:#fff;transform:translate(-50%,-50%);animation:pk3-spin .7s linear infinite}
/* Pulse-эффект при первом нажатии — мгновенное визуальное подтверждение */
.pk3-btn.pk3-pulse{animation:pk3-pulse .35s ease-out}
@keyframes pk3-pulse{0%{transform:scale(1)}50%{transform:scale(.96);box-shadow:0 0 0 4px rgba(212,168,67,.35)}100%{transform:scale(1)}}
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

/* 22.06.2026 v2: НАСТОЯЩИЕ post-it стикеры. С нуля, wow-эффект.
   - Доска: прозрачная панель слева от drawer, на blur'е overlay (sticky на широких экранах)
   - Стикеры: квадратные 3M-style, пастельные, реальные тени, лёгкая текстура бумаги
   - Шрифт: Kalam (Google Fonts) — рукописный, отлично работает с кириллицей
   - Анимации: pop-in появление, поворот при hover выпрямляется, тень оживает */
.pk3-noteboard{position:fixed;top:24px;bottom:24px;left:24px;width:460px;z-index:99999;display:none;flex-direction:column;background:transparent;pointer-events:none;overflow:hidden;font-family:'Kalam','Caveat','Permanent Marker','Comic Sans MS',cursive}
.pk3-noteboard.pk3-show{display:flex}
.pk3-noteboard>*{pointer-events:auto}
.pk3-noteboard-head{display:flex;align-items:center;gap:12px;padding:0 6px 14px;font-size:28px;color:#fff;letter-spacing:.5px;text-shadow:0 2px 0 rgba(0,0,0,.7),0 0 18px rgba(0,0,0,.6),2px 3px 0 rgba(0,0,0,.5)}
.pk3-noteboard-head .pk3-noteboard-emoji{filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))}
.pk3-noteboard-head .pk3-count-badge{margin-left:auto;font-size:16px;color:#3a2f08;font-weight:600;background:#fff8a1;border:1px solid rgba(0,0,0,.15);padding:2px 12px;border-radius:9999px;box-shadow:0 3px 6px rgba(0,0,0,.35);text-shadow:none}
.pk3-noteboard-hint{font-size:14px;color:rgba(255,255,255,.85);font-family:'Kalam','Caveat',cursive;padding:0 8px 12px;text-shadow:0 1px 3px rgba(0,0,0,.7)}

.pk3-stk-list{flex:1 !important;overflow:auto !important;display:block !important;padding:14px !important;scrollbar-width:none;position:relative !important;width:100% !important;min-height:560px !important;height:auto !important;box-sizing:border-box}
.pk3-stk-list::-webkit-scrollbar{display:none}
.pk3-stk-list-empty{grid-column:1/-1;text-align:center;color:#fff;opacity:.7;padding:40px 18px;font-size:18px;font-family:'Kalam','Caveat',cursive;text-shadow:0 1px 3px rgba(0,0,0,.6)}

/* === КАНОНИЧНЫЙ 3M POST-IT === */
.pk3-sticker{position:relative;aspect-ratio:1/1;min-height:180px;padding:18px 16px 36px;display:flex;flex-direction:column;color:#2a1f08;font-size:21px;line-height:1.18;font-weight:400;cursor:default;background:#fff782;background-image:linear-gradient(135deg,rgba(255,255,255,.45) 0%,transparent 40%),linear-gradient(180deg,rgba(0,0,0,.04) 0%,transparent 18%),repeating-linear-gradient(45deg,rgba(0,0,0,.012) 0 2px,transparent 2px 6px);box-shadow:1px 1px 1px rgba(255,255,255,.25) inset,-1px -1px 1px rgba(0,0,0,.04) inset,3px 8px 16px -2px rgba(0,0,0,.4),0 2px 5px rgba(0,0,0,.18);transition:transform .25s cubic-bezier(.34,1.56,.64,1),box-shadow .25s ease,filter .25s ease;transform:rotate(-2.3deg);animation:pk3-sticker-pop .35s cubic-bezier(.34,1.56,.64,1)}
.pk3-sticker::before{content:'';position:absolute;top:0;left:0;right:0;height:8px;background:linear-gradient(180deg,rgba(0,0,0,.06),transparent);pointer-events:none}
.pk3-sticker::after{content:'';position:absolute;bottom:0;right:0;width:26px;height:26px;background:linear-gradient(135deg,transparent 49%,rgba(0,0,0,.18) 50%,rgba(0,0,0,.07) 65%,transparent 66%);pointer-events:none;filter:drop-shadow(-1px -1px 1px rgba(0,0,0,.08))}
.pk3-sticker:hover{transform:rotate(0) translateY(-6px) scale(1.06);box-shadow:1px 1px 1px rgba(255,255,255,.3) inset,-1px -1px 1px rgba(0,0,0,.05) inset,4px 16px 28px -4px rgba(0,0,0,.55),0 4px 10px rgba(0,0,0,.28);z-index:5;filter:brightness(1.04)}
.pk3-sticker:nth-child(5n+1){background-color:#fff782;transform:rotate(-2.3deg)}
.pk3-sticker:nth-child(5n+2){background-color:#ffc7a8;transform:rotate(1.8deg)}
.pk3-sticker:nth-child(5n+3){background-color:#bcebbc;transform:rotate(-1.2deg)}
.pk3-sticker:nth-child(5n+4){background-color:#ffc4d8;transform:rotate(2.4deg)}
.pk3-sticker:nth-child(5n+5){background-color:#b9deff;transform:rotate(-1.7deg)}
.pk3-sticker:nth-child(5n+1):hover,.pk3-sticker:nth-child(5n+2):hover,.pk3-sticker:nth-child(5n+3):hover,.pk3-sticker:nth-child(5n+4):hover,.pk3-sticker:nth-child(5n+5):hover{transform:rotate(0) translateY(-6px) scale(1.06)}

.pk3-sticker-body{flex:1;white-space:pre-wrap;word-break:break-word;color:#2a1f08;font-family:inherit;overflow:hidden;text-overflow:ellipsis;font-weight:400;line-height:1.16}
.pk3-sticker-foot{position:absolute;bottom:10px;left:16px;right:16px;display:flex;align-items:baseline;gap:8px;font-size:13.5px;color:rgba(60,40,10,.65);font-family:inherit;font-weight:400;font-style:italic}
.pk3-sticker-foot .pk3-sticker-author{color:rgba(60,40,10,.85);font-weight:500;font-style:normal}
.pk3-sticker-foot .pk3-sticker-when{margin-left:auto;color:rgba(60,40,10,.55)}

.pk3-sticker-tools{position:absolute;top:6px;right:6px;display:flex;gap:4px;opacity:0;transition:opacity .2s ease}
.pk3-sticker:hover .pk3-sticker-tools{opacity:1}
.pk3-sticker-tools button{background:rgba(60,40,10,.15);border:1px solid rgba(60,40,10,.25);border-radius:6px;width:26px;height:26px;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;transition:all .15s ease;font-family:inherit;color:#2a1f08;box-shadow:0 1px 2px rgba(0,0,0,.15)}
.pk3-sticker-tools button:hover{background:rgba(60,40,10,.3);transform:scale(1.12)}
.pk3-sticker-tools button.pk3-del:hover{background:rgba(180,30,30,.7);color:#fff;border-color:rgba(180,30,30,.8)}

/* === EDIT MODE — пишем прямо на стикере === */
.pk3-sticker.pk3-edit{transform:rotate(0)!important;animation:pk3-sticker-focus .3s ease;cursor:text;padding:14px 14px 12px}
.pk3-sticker.pk3-edit textarea{flex:1;width:100%;border:none;outline:none;background:transparent;color:#2a1f08;font:inherit;font-size:21px;line-height:1.18;resize:none;padding:0;font-family:inherit;font-weight:400;min-height:90px}
.pk3-sticker.pk3-edit textarea::placeholder{color:rgba(60,40,10,.4);font-style:italic}
.pk3-sticker-edit-bar{display:flex;justify-content:space-between;align-items:center;gap:6px;margin-top:8px;padding-top:8px;border-top:1px dashed rgba(60,40,10,.2)}
.pk3-sticker-edit-bar .pk3-sticker-hint{font-size:11px;color:rgba(60,40,10,.5);font-family:var(--font-sans);font-style:italic}
.pk3-sticker-edit-bar button{font-family:'Kalam',cursive;font-size:14px;font-weight:600;padding:4px 11px;border-radius:6px;cursor:pointer;border:1px solid rgba(60,40,10,.25);background:rgba(60,40,10,.1);color:#2a1f08;transition:all .15s ease;box-shadow:0 1px 2px rgba(0,0,0,.15)}
.pk3-sticker-edit-bar button:hover{transform:translateY(-1px);box-shadow:0 3px 6px rgba(0,0,0,.22)}
.pk3-sticker-edit-bar button.pk3-save{background:linear-gradient(180deg,#ffd95e,#e8a93a);border-color:#b07814;color:#2a1f08;text-shadow:0 1px 0 rgba(255,255,255,.3)}
.pk3-sticker-edit-bar button.pk3-cancel{background:rgba(255,255,255,.4)}

/* Анимации */
@keyframes pk3-sticker-pop{from{opacity:0;transform:rotate(-2.3deg) scale(.6)}to{opacity:1;transform:rotate(-2.3deg) scale(1)}}
@keyframes pk3-sticker-focus{from{transform:rotate(-2.3deg) scale(1)}to{transform:rotate(0) scale(1)}}

@media (max-width:1280px){.pk3-noteboard{width:380px}}
@media (max-width:1100px){.pk3-noteboard{width:320px;left:16px}}
@media (max-width:880px){.pk3-noteboard{width:280px;left:10px;top:14px;bottom:14px} .pk3-stk-list{grid-template-columns:1fr}}
@media (max-width:680px){.pk3-noteboard{display:none}}

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
    // (v3 — отдельный namespace AsgardPersonalKanbanV3 на роуте /personal-kanban-v3)
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
          ${item.work_deadline ? `<div style="margin-top:4px"><b>Срок:</b> ${esc(fmtDate(item.work_deadline))}</div>` : ''}
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
    // Маппинг entity_kind → parent_entity_type для модуля писем.
    // Backend /api/correspondence принимает: tender|work|calc|pre_tender|request.
    const _PE_MAP = { tender:'tender', work:'work', pre_tender:'pre_tender', inbox_application:'pre_tender' };
    const _peType = _PE_MAP[card.entity_kind];
    const _peId = card.entity_id;
    const letterBtn = (_peType && _peId)
      ? `<button class="btn ghost" id="pk-card-letter" title="Написать официальное письмо по этой карточке">✉ Письмо</button>`
      : '';

    const universalButtons = `
      ${letterBtn}
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
    $('#pk-card-letter')?.addEventListener('click', () => {
      const qs = new URLSearchParams({
        parent_entity_type: _peType,
        parent_entity_id: String(_peId),
        return_to: window.location.href
      }).toString();
      window.location.href = '/v2/#/correspondence/composer?' + qs;
    });
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

    // 23.06.2026 Маркетплейс: для pre_tender передача = reassign самого pre_tender'а
    // (а не только карты канбана). Эндпоинт /api/pre-tenders/:id/transfer
    // делает: обновляет assigned_to + закрывает карту у старого + создаёт у нового
    // + проверяет лимит 5 у получателя. Карта личного канбана для tender/work и проч.
    // идёт через legacy /personal-kanban/cards/:id/transfer.
    const isPreTender = card.entity_kind === 'pre_tender';
    const titleLabel = isPreTender ? 'Передать заявку другому РП' : 'Передать карту';
    const hint = isPreTender
      ? '<div style="font-size:11px;color:var(--text-secondary);margin-bottom:10px">У получателя должно быть < 5 активных заявок.</div>'
      : '';

    const html = `
      ${hint}
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
      title: titleLabel,
      html, icon: '↻',
      onMount: () => {
        $('#pk-transfer-cancel').addEventListener('click', hideModal);
        $('#pk-transfer-ok').addEventListener('click', async () => {
          const sel = $('#pk-transfer-pm');
          const to = Number(sel.value || 0);
          if (!to) { toast('Ошибка', 'Выберите РП', 'err'); return; }
          const note = $('#pk-transfer-note').value.trim() || null;

          let r;
          if (isPreTender) {
            // Pre-tender: маршрут /api/pre-tenders/:id/transfer.
            r = await apiPreTender(`/${card.entity_id}/transfer`, {
              method: 'POST',
              body: { to_user_id: to, reason: note }
            });
          } else {
            r = await api(`/cards/${card.id}/transfer`, {
              method: 'POST', body: { to_user_id: to, note }
            });
          }

          if (r.ok && r.data && r.data.success) {
            _cards = _cards.filter(c => c.id !== card.id);
            hideModal();
            hideModal();
            renderPage();
            toast('Готово', isPreTender ? 'Заявка передана' : 'Карта передана', 'ok');
            return;
          }
          // Специальные 409 от pre-tender transfer.
          if (isPreTender && r.status === 409 && r.data) {
            if (r.data.error === 'recipient_limit_reached') {
              const name = r.data.recipient_name || 'у получателя';
              toast('Лимит', `🚫 ${name}: уже ${r.data.current_count}/${r.data.limit} заявок`, 'err');
              return;
            }
            if (r.data.error === 'already_owns') {
              toast('Ошибка', 'У этого РП уже есть эта заявка', 'err');
              return;
            }
          }
          if (r.status === 409 && r.data && r.data.error === 'already_owns') {
            toast('Ошибка', 'У этого РП уже есть карта на эту сущность', 'err');
            return;
          }
          if (r.status === 400 && r.data && r.data.error === 'to_user_not_pm') {
            toast('Ошибка', 'Получатель не является РП', 'err'); return;
          }
          if (r.status === 403) {
            toast('Ошибка', 'Нет прав на передачу этой заявки', 'err'); return;
          }
          toast('Ошибка', (r.data && (r.data.message || r.data.error)) || 'Не удалось передать', 'err');
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
  const STAGE_LABELS = ['📥 Новая', '🧮 Просчёт', '❓ Дозапрос', '📋 КП готов', '⚖️ Согл. дир', '📤 КП ушло', '🏆 Выигр.', '❌ Проигр.', '🏗 В работе'];
  const COL_TO_STAGE = { new: 0, calc: 1, addendum: 2, kp_prep: 3, approval: 4, sent: 5, win: 6, lose: 7, work: 8 };

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
.pk3-noteboard {
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
      // 22.06.2026 BUG-FIX: backend отдаёт `v3_column`, фронт везде ждёт `card.col`.
      // Без этого `_tkpStatus`, drag-checks, action-bar — падают в default (lock:true)
      // → раздел ТКП заблокирован даже на calc, кнопки контекста не показываются.
      Object.keys(_columns).forEach(colKey => {
        (_columns[colKey] || []).forEach(c => {
          if (!c.col) c.col = c.v3_column || colKey;
        });
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
      <div class="pk3-noteboard" id="pk3-noteboard"></div>
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
    const board = $('#pk3-noteboard');
    if (!board) return;
    // S-15: сохраняем скролл-позицию колонки addendum (и любых других) между ре-рендерами
    const prevScroll = {};
    $$('#pk3-noteboard .pk3-col-body').forEach(b => {
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
    $$('#pk3-noteboard .pk3-col-body').forEach(b => {
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
    $$('#pk3-noteboard .pk3-card').forEach(el => {
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
    $$('#pk3-noteboard .pk3-col-body').forEach(body => {
      body.addEventListener('dragover', (e) => { e.preventDefault(); body.classList.add('pk3-drop-hover'); });
      body.addEventListener('dragleave', () => body.classList.remove('pk3-drop-hover'));
      body.addEventListener('drop', async (e) => {
        e.preventDefault(); body.classList.remove('pk3-drop-hover');
        const toCol = body.dataset.colId;
        const cardId = _draggingCardId; if (!cardId) return;
        // FIX JS-2: drop в ту же колонку — noop, не отправлять POST.
        const card = _v3FindCard(cardId);
        if (card && card.col === toCol) { _draggingCardId = null; return; }
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
      // 22.06.2026: специальный кейс — нет ТКП при попытке отправить на согласование
      if (r.data && r.data.error === 'tkp_required') {
        toast('Нужен ТКП', r.data.message || 'Сначала создайте ТКП в разделе ниже', 'warn');
        return;
      }
      toast('Не получилось', (r.data && (r.data.error || r.data.message)) || 'Ошибка перехода', 'err');
      return;
    }
    // 22.06.2026: backend мог автопромоутить из approval в kp_prep (сумма < 50M)
    if (r.data && r.data.auto_promoted_from_approval) {
      toast('Согласование не требуется',
        `Сумма ${(r.data.price_used || 0).toLocaleString('ru-RU')} ₽ < 50 млн — карта сразу в «КП готов»`, 'ok');
    } else {
      toast('Готово', 'Карта перемещена', 'ok');
    }
    await _v3LoadAndRender();
    // 22.06.2026 BUG-FIX: после перехода обновить открытый drawer (если это та же карта),
    // иначе он держит старое card.col → разделы (ТКП и т.п.) не разблокируются после
    // drag-and-drop в новую колонку. Требовалось закрывать-открывать вручную.
    if (_currentCard && _currentCard.id === cardId) {
      await _reopenCurrentCard();
    }
  }
  function _v3OpenCreateManual() {
    // Полная форма ручного создания заявки (формат как через почту).
    // POST /api/pre-tenders/ создаёт pre_tender_request, далее карта канбана попадает в колонку «📥 Новые».
    const overlay = document.createElement('div');
    overlay.className = 'pk3-modal-overlay show';
    overlay.innerHTML = `
      <div class="pk3-modal" style="max-width:760px;height:auto;max-height:90vh">
        <div class="pk3-modal-head">
          <span style="font-size:20px;color:var(--gold)">＋</span>
          <h3>Создать заявку вручную</h3>
          <span class="pk3-tag pk3-info">та же форма что приходит с почты</span>
          <button class="pk3-btn-icon" data-act="close">✕</button>
        </div>
        <div class="pk3-modal-body">
          <p style="margin-bottom:14px;color:var(--t2);font-size:12.5px">
            Заполни поля — заявка попадёт в колонку «📥 Новые» и будет распределена тебе. Дальше — как обычно: 🚀 Quick → ТКП → отправка.
          </p>

          <h4 style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin:14px 0 8px">Источник</h4>
          <div class="pk3-row"><label>Канал заявки *</label>
            <select id="pk3mc-source">
              <option value="phone">📞 Звонок клиента</option>
              <option value="meeting">🤝 Личная встреча</option>
              <option value="email">📧 Личная почта (не CRM)</option>
              <option value="referral">🔄 Перевод от партнёра</option>
              <option value="website">🌐 Сайт компании</option>
              <option value="other">📝 Другое</option>
            </select>
          </div>

          <h4 style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin:14px 0 8px">Клиент</h4>
          <div class="pk3-row"><label>ИНН</label>
            <div class="pk3-twocol">
              <input id="pk3mc-inn" placeholder="введите ИНН">
              <button class="pk3-btn pk3-ghost pk3-sm" id="pk3mc-egrul">🔎 Найти в egrul</button>
            </div>
          </div>
          <div class="pk3-row"><label>Заказчик *</label><input id="pk3mc-customer" placeholder="название организации"></div>
          <div class="pk3-row"><label>Контактное лицо</label><input id="pk3mc-contact" placeholder="ФИО"></div>
          <div class="pk3-row"><label>Должность</label><input id="pk3mc-position" placeholder="например, главный механик"></div>
          <div class="pk3-row"><label>Email клиента</label><input id="pk3mc-email" type="email" placeholder="email для отправки КП"></div>
          <div class="pk3-row"><label>Телефон *</label><input id="pk3mc-phone" placeholder="+7 (___) ___-__-__"></div>
          <div class="pk3-row"><label>Город</label><input id="pk3mc-city" placeholder="город объекта"></div>
          <div class="pk3-row"><label>Адрес объекта</label><input id="pk3mc-location" placeholder="полный адрес"></div>

          <h4 style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin:14px 0 8px">Работа</h4>
          <div class="pk3-row"><label>Тип работ</label>
            <select id="pk3mc-worktype">
              <option value="">— не выбрано —</option>
              <option>Гидромеханическая очистка</option>
              <option>Химическая промывка</option>
              <option>Антикоррозионная обработка</option>
              <option>Монтажные работы</option>
              <option>ПНР (пуско-наладочные работы)</option>
              <option>Диагностика</option>
              <option>Вентиляция и кондиционирование</option>
              <option>Другое</option>
            </select>
          </div>
          <div class="pk3-row"><label>Описание работ *</label><textarea id="pk3mc-desc" rows="3" placeholder="что нужно сделать, на каком оборудовании, особенности"></textarea></div>
          <div class="pk3-row"><label>Объём</label>
            <div class="pk3-twocol">
              <input id="pk3mc-volume" type="number" min="0" step="0.1" placeholder="число">
              <select id="pk3mc-vunit"><option>м³</option><option>часов</option><option>точек</option><option>тонн</option><option>м²</option><option>п.м.</option><option>шт</option><option>компл</option></select>
            </div>
          </div>
          <div class="pk3-row"><label>Дедлайн КП</label><input id="pk3mc-kpdeadline" type="date"></div>
          <div class="pk3-row"><label>Сроки работ</label>
            <div class="pk3-twocol">
              <input id="pk3mc-startp" type="date" placeholder="с">
              <input id="pk3mc-endp" type="date" placeholder="по">
            </div>
          </div>
          <div class="pk3-row"><label>Ориентир бюджета</label>
            <div class="pk3-twocol">
              <input id="pk3mc-budget" type="number" min="0" step="1000" placeholder="₽ (если клиент назвал)">
              <span style="color:var(--t3);font-size:11px;padding-top:7px">опционально</span>
            </div>
          </div>

          <h4 style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin:14px 0 8px">Заметки</h4>
          <div class="pk3-row"><label>Контекст</label><textarea id="pk3mc-notes" rows="3" placeholder="что сказал клиент, какие особенности, обещания, дедлайны — это попадёт в заметку карты"></textarea></div>

          <div style="margin-top:14px;padding:11px 13px;background:var(--ok-bg);border:1px solid var(--ok);border-radius:8px;font-size:12px;color:var(--t2);line-height:1.55">
            💡 <b>После создания</b>: заявка попадёт в твой канбан в колонку «📥 Новые». AI её НЕ будет повторно разбирать (ты сам всё ввёл) — можно сразу нажать «🚀 К просчёту».
          </div>
        </div>
        <div class="pk3-modal-foot">
          <button class="pk3-btn pk3-ghost" data-act="close">← Отмена</button>
          <div style="flex:1"></div>
          <button class="pk3-btn pk3-gold" data-act="create">✅ Создать заявку</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    // Автозаполнение по ИНН: сперва НАША карточка контрагента (с контактами),
    // затем — DaData (findById) как fallback для названия/адреса новых клиентов.
    const inn = overlay.querySelector('#pk3mc-inn');
    const egrulBtn = overlay.querySelector('#pk3mc-egrul');
    const setVal = (id, val) => { const el = overlay.querySelector('#' + id); if (el && val != null) el.value = val; };
    const setIfEmpty = (id, val) => { const el = overlay.querySelector('#' + id); if (el && val && !el.value.trim()) el.value = val; };
    egrulBtn.addEventListener('click', async () => {
      const v = (inn.value || '').trim();
      if (!v) { toast('Введи ИНН', '', 'warn'); return; }
      const digits = v.replace(/\D/g, '');
      if (digits.length !== 10 && digits.length !== 12) { toast('ИНН', '10 или 12 цифр', 'warn'); return; }
      egrulBtn.disabled = true; const _t = egrulBtn.textContent; egrulBtn.textContent = '⏳';
      try {
        // 1) Наша карточка контрагента — тянем максимум (контакты, телефон, email, адрес)
        let cardFilled = false;
        try {
          const cr = await api('/api/customers/' + encodeURIComponent(digits));
          if (cr.ok && cr.data && cr.data.customer) {
            const c = cr.data.customer;
            let legacyContacts = [];
            if (c.contacts_json && String(c.contacts_json).trim()) {
              try {
                const parsed = JSON.parse(String(c.contacts_json));
                if (Array.isArray(parsed)) legacyContacts = parsed;
              } catch (_) {}
            }
            const contacts = (Array.isArray(c.contacts) && c.contacts.length) ? c.contacts : legacyContacts;
            const primary = contacts.find(x => x && x.is_primary) || contacts[0] || {};
            setVal('pk3mc-customer', c.name || c.full_name || '');
            setIfEmpty('pk3mc-contact',  (primary.name || c.contact_person || ''));
            setIfEmpty('pk3mc-position', (primary.position || primary.role || ''));
            setIfEmpty('pk3mc-email',    (primary.email || c.email || ''));
            setIfEmpty('pk3mc-phone',    (primary.phone || c.phone || ''));
            setIfEmpty('pk3mc-location', (c.address || ''));
            cardFilled = !!(c.name || c.full_name);
            if (cardFilled) {
              const extra = contacts.length > 1 ? ` · ещё ${contacts.length - 1} контакт(а)` : '';
              toast('Карточка найдена', (c.name || c.full_name) + extra, 'ok');
              return;
            }
          }
        } catch (_) { /* нет карточки — идём в DaData */ }

        // 2) DaData findById — для новых клиентов (название + адрес)
        const r = await api('/api/customers/lookup/' + encodeURIComponent(digits));
        const data = (r.ok && r.data) || {};
        const sug  = data.suggestion || {};
        if (data.found === false && data.message) { toast('Не найдено', data.message, 'warn'); return; }
        const name = sug.name || sug.full_name || '';
        if (name) {
          setVal('pk3mc-customer', name);
          setIfEmpty('pk3mc-location', sug.address || '');
          toast('ЕГРЮЛ', sug.kpp ? `${name} (КПП ${sug.kpp})` : name, 'ok');
        } else {
          toast('Не найдено', 'Заполни вручную', 'warn');
        }
      } catch (_) {
        toast('egrul недоступен', 'Заполни вручную', 'warn');
      } finally {
        egrulBtn.disabled = false; egrulBtn.textContent = _t;
      }
    });

    overlay.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', async () => {
      const a = b.dataset.act;
      if (a === 'close') return overlay.remove();
      if (a === 'create') {
        const $f = (id) => overlay.querySelector('#' + id);
        const customer  = $f('pk3mc-customer').value.trim();
        const phone     = $f('pk3mc-phone').value.trim();
        const desc      = $f('pk3mc-desc').value.trim();
        if (!customer && !desc) { toast('Заполни поля', 'Нужен Заказчик ИЛИ Описание работ', 'err'); return; }
        if (!phone) { toast('Телефон обязателен', '', 'err'); return; }
        b.disabled = true; b.textContent = '⏳ Создаю…';

        // BUG #2: должность вшиваем в contact_person через ", " — отдельной колонки нет
        const person   = $f('pk3mc-contact').value.trim();
        const position = $f('pk3mc-position').value.trim();
        const contactPerson = position ? (person ? `${person}, ${position}` : position) : person;

        // BUG #4 + #5: объём и сроки нет отдельных колонок — префиксом в work_description
        const vol   = $f('pk3mc-volume').value.trim();
        const vunit = $f('pk3mc-vunit').value || '';
        const startp = $f('pk3mc-startp').value;
        const endp   = $f('pk3mc-endp').value;
        let prefix = '';
        if (startp || endp) {
          prefix += `Сроки работ: ${startp || '?'} — ${endp || '?'}\n\n`;
        }
        if (vol) {
          prefix += `Объём: ${vol} ${vunit}\n\n`;
        }
        const finalDesc = (prefix ? prefix + (desc || '') : desc) || null;

        // Bonus: notes (контекст) — fallback в decision_comment, чтобы не потерять если карта не создалась
        const notes = $f('pk3mc-notes').value.trim();

        const body = {
          source_type:     $f('pk3mc-source').value || 'manual',
          customer_name:   customer || null,
          customer_inn:    $f('pk3mc-inn').value.trim() || null,
          customer_email:  $f('pk3mc-email').value.trim() || null,
          contact_person:  contactPerson || null,
          contact_phone:   phone,
          work_description: finalDesc,
          work_location:    [$f('pk3mc-city').value.trim(), $f('pk3mc-location').value.trim()].filter(Boolean).join(', ') || null,
          work_deadline:    $f('pk3mc-kpdeadline').value || null,
          estimated_sum:    parseFloat($f('pk3mc-budget').value) || null,
          assigned_to:      _user && _user.id ? _user.id : null,  // на себя
          // BUG #3: тип работ — у pre_tender_requests есть колонка ai_work_type
          ai_work_type:    $f('pk3mc-worktype').value || null,
          // Bonus: fallback notes в decision_comment, чтобы текст не потерялся если карта не создастся
          decision_comment: notes || null,
        };
        const r = await api('/api/pre-tenders/', { method: 'POST', body });
        if (r.ok && r.data && r.data.id) {
          // Если есть notes — добавим как первую заметку через kanban API.
          if (notes && r.data.kanban_card_id) {
            api(`/api/personal-kanban/cards/${r.data.kanban_card_id}/notes`, { method: 'POST', body: { body: notes } }).catch(() => {});
          }
          toast('✅ Создано', `Заявка #${r.data.id} в колонке «📥 Новые»`, 'ok');
          overlay.remove();
          _v3LoadAndRender();
        } else {
          b.disabled = false; b.textContent = '✅ Создать заявку';
          toast('Не получилось', (r.data && (r.data.error || r.data.message)) || 'Ошибка', 'err');
        }
      }
    }));

    const escHandler = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);
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

  // ── Drawer (открытие/закрытие + рендер 8 секций) ──
  function _openDrawer(card) {
    _currentCard = card;
    if (_drawerEl) _closeDrawer();
    const overlay = document.createElement('div');
    overlay.className = 'pk3-drawer-overlay show';
    // 22.06.2026: клик на overlay НЕ закрывает drawer (раньше теряли работу случайным кликом).
    // Показываем шуточный toast — карта закрывается только через X в углу.
    const _jokes = [
      'Эй, не клацай в пустоту 😅 Закрой крестиком',
      'Закрыть карту? Жми ✕ справа сверху, не лень же 🙃',
      'Тут пусто, как в холодильнике перед зарплатой 🥪 Жми ✕',
      'Тык-тык по воздуху не помогает. Крестик в углу 🎯',
      'Стой, куда! Карта закрывается только через ✕ 🛑'
    ];
    overlay.addEventListener('click', (e) => {
      if (e.target !== overlay) return;
      const msg = _jokes[Math.floor(Math.random() * _jokes.length)];
      toast('Эй', msg, 'info');
    });
    const drawer = document.createElement('div');
    drawer.className = 'pk3-drawer show';
    drawer.innerHTML = _renderDrawerHtml(card);
    // 22.06.2026 v2: доска заметок СЛЕВА от drawer'a (см. CSS .pk3-noteboard)
    // ВАЖНО: appendChild доска ВНУТРИ overlay — иначе backdrop-filter blur у overlay
    // создаёт новый stacking context и доска (даже с z-index 99999) уходит «за» blur.
    const notesBoard = document.createElement('div');
    notesBoard.className = 'pk3-noteboard pk3-show';
    notesBoard.innerHTML = _renderNotesBoardHtml(card);
    document.body.appendChild(overlay);
    overlay.appendChild(notesBoard); // ← внутрь overlay, не в body
    document.body.appendChild(drawer);
    _drawerEl = { overlay, drawer, notesBoard };
    _attachDrawerEvents(card);
  }
  function _closeDrawer() {
    if (!_drawerEl) return;
    try { _drawerEl.overlay.remove(); _drawerEl.drawer.remove(); } catch (_) {}
    try { if (_drawerEl.notesBoard) _drawerEl.notesBoard.remove(); } catch (_) {}
    _drawerEl = null; _currentCard = null;
  }
  function _kindLabelFromEntity(k) {
    if (k === 'pre_tender') return 'PRE-TENDER';
    if (k === 'inbox_application') return 'ЗАЯВКА';
    if (k === 'tender') return 'TENDER';
    if (k === 'work') return 'WORK';
    return '';
  }
  function _renderDrawerHtml(card) {
    // Backend (loadEntitySnapshotsBatch + _v3LoadBoard) кладёт колонку как
    // `card.v3_column`. Старый код читал card.col, которого нет в payload —
    // отсюда прочерки и полоски всегда «застряли» на этапе 0 «Новые».
    const colKey = card.v3_column || card.col || 'new';
    const active = COL_TO_STAGE[colKey] ?? 0;
    const fin = card.finance || {};
    const aiSummary = card.ai_summary || '(AI ещё не разобрал заявку)';
    // Источник дат: card.created_at (ISO от Postgres) или snap.created_at.
    let dateLabel = '—';
    try {
      const dt = card.created_at_label || card.created_at;
      if (dt) {
        const d = new Date(dt);
        if (!isNaN(d)) dateLabel = d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
      }
    } catch (_) {}
    // Источник РП: имя owner — приходит как owner_name из view или подмешивается
    // отдельным полем (snap.owner_label). Если нет — показываем e-mail/role.
    const ownerLabel = card.owner_label || card.owner_name || (card.owner_user_id ? '#' + card.owner_user_id : '—');
    // 📨 — клиент: customer_name из pre_tender/tender или source_name из inbox_application.
    const customerLine = card.customer || card.customer_name || card.source_name || card.source_email || '—';
    return `
      <div class="pk3-drawer-head">
        <div class="pk3-row1">
          <span class="pk3-badge pk3-${(card.kind || card.entity_kind || '').split('_')[0]}">${esc(card.kindLabel || _kindLabelFromEntity(card.entity_kind))}</span>
          <h2>${esc(card.title || card.work_description || '(без названия)')}</h2>
          <button class="pk3-btn-icon" id="pk3-drawer-close" title="Закрыть (Esc)">✕</button>
        </div>
        <div class="pk3-meta">
          <span>📅 ${esc(dateLabel)}</span>
          <span>👤 РП: ${esc(ownerLabel)}</span>
          <span>📨 ${esc(customerLine)}</span>
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
        <span class="pk3-dnav-link" data-anchor="sec-reminders">⏰ Напоминания</span>
      </div>
      ${_secAI(card, aiSummary)}
      ${_secClient(card)}
      ${_secWork(card)}
      ${_secCalc(card)}
      ${_secDocs(card)}
      ${_secFin(card, fin)}
      ${_secTKP(card)}
      ${_secHist(card)}
      ${_secReminders(card)}
      <div style="height:80px"></div>
      <div class="pk3-actions-bar" id="pk3-actions-bar">
        ${_renderActionsBar(card)}
      </div>
    `;
  }

  // 22.06.2026: доска заметок — ОТДЕЛЬНАЯ панель СЛЕВА от drawer'a (НЕ внутри).
  // Появляется вместе с открытием карты, исчезает при закрытии. Свой DOM-элемент.
  // 22.06.2026 v5: голая доска с absolute-стикерами (drag&drop). Inline width 100%.
  function _renderNotesBoardHtml(card) {
    return `<div class="pk3-stk-list" id="pk3-stk-list" style="position:relative;flex:1;overflow:auto;padding:14px;width:100%;min-height:560px;display:block;box-sizing:border-box"></div>
            <span id="pk3-notes-count" style="display:none">0</span>`;
  }

  function _fmtNoteWhen(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (isNaN(d)) return '';
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
      const isYesterday = d.toDateString() === yesterday.toDateString();
      const t = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      if (sameDay) return `сегодня ${t}`;
      if (isYesterday) return `вчера ${t}`;
      return d.toLocaleDateString('ru-RU') + ' ' + t;
    } catch (_) { return ''; }
  }

  // 22.06.2026: адаптивный шрифт стикера по длине текста (чем длиннее — мельче)
  function _stkFontSize(len) {
    if (len <= 20)  return 22;
    if (len <= 60)  return 18;
    if (len <= 100) return 15;
    if (len <= 130) return 13;
    return 11;
  }
  const NOTE_MAX = 150;

  // 22.06.2026 v4: стикер inline + absolute positioning + drag&drop
  function _renderNoteCard(n) {
    const author = esc(n.author_name || (n.author_id ? '#' + n.author_id : '—'));
    const when = esc(_fmtNoteWhen(n.created_at));
    const body = esc(n.body || '').replace(/\n/g, '<br>');
    const variant = (n.color_variant != null) ? (Number(n.color_variant) % 5) : (Math.abs(parseInt(n.id || 0)) % 5);
    const colors = ['#fff782', '#ffc7a8', '#bcebbc', '#ffc4d8', '#b9deff'];
    const rotates = [-2.3, 1.8, -1.2, 2.4, -1.7];
    const bg = colors[variant];
    const rot = rotates[variant];
    const posX = (n.pos_x != null) ? Number(n.pos_x) : Math.floor(Math.random()*100);
    const posY = (n.pos_y != null) ? Number(n.pos_y) : Math.floor(Math.random()*150);
    const zIdx = (n.z_index != null) ? Number(n.z_index) : 1;
    const fz = _stkFontSize((n.body || '').length);
    const styleBox = [
      'position:absolute',
      `left:${posX}px`,
      `top:${posY}px`,
      `z-index:${zIdx}`,
      'width:170px',
      'height:170px',
      'box-sizing:border-box',
      'padding:22px 14px 30px',
      'overflow:hidden',
      'display:flex',
      'flex-direction:column',
      'background:' + bg,
      'color:#2a1f08',
      `transform:rotate(${rot}deg)`,
      'font-family:Kalam,Caveat,"Permanent Marker","Comic Sans MS",cursive',
      `font-size:${fz}px`,
      'line-height:1.18',
      'font-weight:400',
      'box-shadow:1px 1px 1px rgba(255,255,255,.3) inset, -1px -1px 1px rgba(0,0,0,.05) inset, 3px 8px 16px -2px rgba(0,0,0,.4), 0 2px 5px rgba(0,0,0,.18)',
      'transition:transform .25s cubic-bezier(.34,1.56,.64,1), box-shadow .25s ease',
      'cursor:grab',
      'user-select:none',
      'touch-action:none',
      'animation:pk3-sticker-pop .35s cubic-bezier(.34,1.56,.64,1)',
    ].join(';');
    const styleBody  = `flex:1;white-space:pre-wrap;word-break:break-word;color:#2a1f08;overflow:hidden;font-weight:400;font-size:${fz}px;line-height:1.18;font-family:inherit`;
    const styleFoot  = 'position:absolute;bottom:9px;left:16px;right:16px;display:flex;align-items:baseline;gap:8px;font-size:13.5px;color:rgba(60,40,10,.65);font-family:inherit;font-style:italic';
    const styleTools = 'position:absolute;top:10px;right:10px;display:flex;gap:6px;opacity:0;transition:opacity .25s ease,transform .25s ease;transform:translateY(-4px);z-index:2';
    const styleBtn   = 'background:rgba(255,255,255,.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border:1px solid rgba(60,40,10,.18);border-radius:50%;width:30px;height:30px;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;color:#2a1f08;box-shadow:0 2px 6px rgba(0,0,0,.22),0 1px 2px rgba(0,0,0,.12);transition:all .18s cubic-bezier(.34,1.56,.64,1);font-family:inherit;line-height:1';
    // Скотч-полоска сверху и загиб уголка — через инлайн SVG поверх
    const styleScotch = 'position:absolute;top:-8px;left:50%;width:72px;height:18px;background:linear-gradient(180deg, rgba(220,220,220,.65), rgba(160,160,160,.5));transform:translateX(-50%) rotate(-3deg);box-shadow:0 2px 4px rgba(0,0,0,.25);opacity:.85;border-left:1px solid rgba(255,255,255,.5);border-right:1px solid rgba(0,0,0,.1);z-index:1;pointer-events:none';
    return `
      <div data-note-id="${n.id || ''}" data-pk3-sticker="1" data-rot="${rot}" data-z="${zIdx}" style="${styleBox}" onmouseenter="this.style.transform='rotate(0) translateY(-4px) scale(1.05)';const t=this.querySelector('[data-tools]');t.style.opacity=1;t.style.transform='translateY(0)'" onmouseleave="if(this.dataset.dragging!=='1')this.style.transform='rotate(${rot}deg)';const t=this.querySelector('[data-tools]');t.style.opacity=0;t.style.transform='translateY(-4px)'">
        <div style="${styleScotch}"></div>
        <div data-tools style="${styleTools}">
          <button data-note-act="edit" title="Редактировать" style="${styleBtn}" onmouseover="this.style.transform='scale(1.18) rotate(-8deg)';this.style.background='rgba(255,235,150,.9)';this.style.boxShadow='0 4px 10px rgba(0,0,0,.3)'" onmouseout="this.style.transform='';this.style.background='rgba(255,255,255,.55)';this.style.boxShadow='0 2px 6px rgba(0,0,0,.22),0 1px 2px rgba(0,0,0,.12)'">✏️</button>
          <button data-note-act="delete" title="Удалить" style="${styleBtn}" onmouseover="this.style.transform='scale(1.18) rotate(8deg)';this.style.background='rgba(255,80,80,.85)';this.style.color='#fff';this.style.boxShadow='0 4px 10px rgba(180,30,30,.45)'" onmouseout="this.style.transform='';this.style.background='rgba(255,255,255,.55)';this.style.color='#2a1f08';this.style.boxShadow='0 2px 6px rgba(0,0,0,.22),0 1px 2px rgba(0,0,0,.12)'">🗑</button>
        </div>
        <div style="${styleBody}">${body}</div>
        <div style="${styleFoot}">
          <span style="font-weight:500;font-style:normal;color:rgba(60,40,10,.85)">${author}</span>
          <span style="margin-left:auto;color:rgba(60,40,10,.55)">${when}</span>
        </div>
      </div>
    `;
  }

  function _renderNotesList(notes) {
    const list = document.getElementById('pk3-stk-list');
    const cnt = document.getElementById('pk3-notes-count');
    if (!list) return;
    list.innerHTML = (notes && notes.length) ? notes.map(_renderNoteCard).join('') : '';
    if (cnt) cnt.textContent = String((notes || []).length);
    // Подключаем drag к каждому стикеру
    list.querySelectorAll('[data-pk3-sticker]').forEach((el) => _bindStickerDrag(el));
  }

  // 22.06.2026 v4: native pointer-events drag для стикеров. Реалистично:
  // — при захвате стикер выпрямляется и слегка приподнимается (как будто оторвали)
  // — z-index растёт чтобы быть поверх
  // — после отпускания возвращается лёгкий поворот + PATCH сохраняет позицию
  function _bindStickerDrag(stk) {
    let startX = 0, startY = 0, elStartX = 0, elStartY = 0, dragging = false;
    let origRot = parseFloat(stk.dataset.rot) || 0;
    let savedNoteId = null;
    const onDown = (e) => {
      // Не начинаем drag если кликнули по кнопке/textarea
      if (e.target.closest('[data-note-act]') || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;
      if (!stk.parentElement) return;
      // Только левая кнопка
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      dragging = true;
      stk.dataset.dragging = '1';
      savedNoteId = stk.dataset.noteId;
      startX = e.clientX; startY = e.clientY;
      const rect = stk.getBoundingClientRect();
      const parentRect = stk.parentElement.getBoundingClientRect();
      elStartX = rect.left - parentRect.left + stk.parentElement.scrollLeft;
      elStartY = rect.top  - parentRect.top  + stk.parentElement.scrollTop;
      // Зафиксировать позицию по реальной (а не по transform)
      stk.style.left = elStartX + 'px';
      stk.style.top  = elStartY + 'px';
      // Поднять стикер
      stk.style.cursor = 'grabbing';
      stk.style.transition = 'box-shadow .15s ease, transform .15s ease';
      stk.style.transform = 'rotate(2deg) scale(1.05)';
      stk.style.boxShadow = '1px 1px 1px rgba(255,255,255,.4) inset,-1px -1px 1px rgba(0,0,0,.05) inset,8px 22px 32px -4px rgba(0,0,0,.55),0 6px 14px rgba(0,0,0,.3)';
      stk.style.zIndex = 99999;
      try { stk.setPointerCapture(e.pointerId); } catch (_) {}
    };
    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const newX = Math.max(0, elStartX + dx);
      const newY = Math.max(0, elStartY + dy);
      stk.style.left = newX + 'px';
      stk.style.top  = newY + 'px';
    };
    const onUp = async (e) => {
      if (!dragging) return;
      dragging = false;
      delete stk.dataset.dragging;
      stk.style.cursor = 'grab';
      stk.style.transition = 'transform .35s cubic-bezier(.34,1.56,.64,1), box-shadow .25s ease';
      stk.style.transform = `rotate(${origRot}deg)`;
      stk.style.boxShadow = '1px 1px 1px rgba(255,255,255,.3) inset,-1px -1px 1px rgba(0,0,0,.05) inset,3px 8px 16px -2px rgba(0,0,0,.4),0 2px 5px rgba(0,0,0,.18)';
      try { stk.releasePointerCapture(e.pointerId); } catch (_) {}
      // Сохраняем позицию + поднимаем z-index
      if (savedNoteId && _currentCard) {
        const newX = parseInt(stk.style.left, 10) || 0;
        const newY = parseInt(stk.style.top, 10) || 0;
        try {
          const r = await api(`/api/personal-kanban/cards/${_currentCard.id}/notes/${savedNoteId}/position`, {
            method: 'PATCH', body: { pos_x: newX, pos_y: newY }
          });
          if (r.ok && r.data && r.data.item && r.data.item.z_index != null) {
            stk.style.zIndex = String(r.data.item.z_index);
            stk.dataset.z = String(r.data.item.z_index);
          } else {
            stk.style.zIndex = stk.dataset.z || '1';
          }
        } catch (_) {
          stk.style.zIndex = stk.dataset.z || '1';
        }
      } else {
        stk.style.zIndex = stk.dataset.z || '1';
      }
    };
    stk.addEventListener('pointerdown', onDown);
    stk.addEventListener('pointermove', onMove);
    stk.addEventListener('pointerup', onUp);
    stk.addEventListener('pointercancel', onUp);
  }

  async function _loadAndRenderNotes(card) {
    if (!card || !card.id) return;
    try {
      const r = await api(`/api/personal-kanban/cards/${card.id}/history`);
      const notes = (r.ok && r.data && Array.isArray(r.data.notes)) ? r.data.notes : [];
      _renderNotesList(notes);
    } catch (e) {
      const list = document.getElementById('pk3-stk-list');
      if (list) list.innerHTML = '<div class="pk3-stk-list-empty">не удалось загрузить</div>';
    }
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
    // 22.06.2026: Заказчик теперь ТОЛЬКО из справочника контрагентов.
    // Input — readonly «pill», клик → пикер поиска (по имени/ИНН). Рядом «+ Новый».
    const customerName = card.customer_name || card.customer || '';
    return _section('sec-client', '👤', 'Клиент и контакты', null, `
      ${_row('Заказчик', `
        <div style="display:flex;gap:6px;align-items:stretch">
          <input id="pk3-f-customer" value="${esc(customerName)}" readonly placeholder="Кликни — выбрать из справочника"
                 style="cursor:pointer;flex:1" data-action="customer-pick" title="Выбрать контрагента из справочника" />
          <button class="pk3-btn pk3-ghost pk3-sm" data-action="customer-pick" title="Найти в справочнике">🔍</button>
          <button class="pk3-btn pk3-gold pk3-sm" data-action="customer-new" title="Создать нового контрагента">＋ Новый</button>
        </div>
      `)}
      ${_row('ИНН', `<input id="pk3-f-inn" value="${esc(card.customer_inn || '')}" readonly placeholder="будет подставлен" style="background:var(--bg3);color:var(--t2)" />`)}
      ${_row('Контактное лицо', `<input id="pk3-f-contact" value="${esc(card.contact_person || '')}" />`)}
      ${_row('Email', `<input id="pk3-f-email" value="${esc(card.customer_email || '')}" />`)}
      ${_row('Телефон', `<input id="pk3-f-phone" value="${esc(card.contact_phone || '')}" placeholder="+7 (___) ___-__-__" />`)}
      ${_row('Город / Объект', `<input id="pk3-f-city" value="${esc(card.customer_city || card.work_location || '')}" />`)}
    `);
  }

  // 22.06.2026: универсальные функции для подстановки контрагента в карту
  function _fillCustomerFields(c) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    set('pk3-f-customer', c.name || c.customer_name || '');
    set('pk3-f-inn',      c.inn || c.customer_inn || '');
    set('pk3-f-email',    c.email || c.customer_email || '');
    set('pk3-f-phone',    c.phone || c.contact_phone || '');
    set('pk3-f-contact',  c.contact_person || '');
    set('pk3-f-city',     c.address || c.customer_address || '');
  }

  function _openCustomerPicker(card) {
    const m = document.createElement('div');
    m.style.cssText = 'position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(4px)';
    m.innerHTML = `
      <div style="background:var(--bg2);border:1px solid var(--brd);border-radius:14px;width:min(640px,92vw);max-height:80vh;display:flex;flex-direction:column;box-shadow:0 16px 48px rgba(0,0,0,.6)">
        <div style="padding:14px 18px;border-bottom:1px solid var(--brd-m);display:flex;align-items:center;gap:10px">
          <span style="font-size:18px">👤</span>
          <h3 style="margin:0;font-family:'Cinzel',Georgia,serif;font-size:17px;color:var(--t1);flex:1">Выбрать контрагента</h3>
          <button class="pk3-btn pk3-ghost pk3-sm" data-act="close">✕</button>
        </div>
        <div style="padding:14px 18px;display:flex;gap:8px;border-bottom:1px solid var(--brd-m)">
          <input id="pk3-cust-q" placeholder="Поиск по имени или ИНН (минимум 2 символа)" autofocus
                 style="flex:1;padding:9px 12px;border:1px solid var(--brd-m);border-radius:7px;background:var(--bg1);color:var(--t1);font-size:14px;outline:none" />
          <button class="pk3-btn pk3-gold" data-act="new">＋ Новый</button>
        </div>
        <div id="pk3-cust-list" style="flex:1;overflow-y:auto;padding:6px"></div>
      </div>
    `;
    document.body.appendChild(m);
    const q = m.querySelector('#pk3-cust-q');
    const list = m.querySelector('#pk3-cust-list');
    let searchTimer = null;
    const close = () => { try { m.remove(); } catch(_) {} };
    const doSearch = async (query) => {
      const qstr = query.length >= 2 ? '?search=' + encodeURIComponent(query) + '&limit=50' : '?limit=30';
      list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t3);font-style:italic">Ищу…</div>';
      try {
        const r = await api('/api/customers' + qstr);
        const items = (r.ok && r.data && Array.isArray(r.data.customers)) ? r.data.customers : [];
        if (!items.length) {
          list.innerHTML = `<div style="padding:30px;text-align:center;color:var(--t3)"><b>Ничего не найдено.</b><br><br>Создайте нового через «＋ Новый»</div>`;
          return;
        }
        list.innerHTML = items.map(c => `
          <div class="pk3-cust-row" data-inn="${esc(c.inn||'')}" data-name="${esc(c.name||'')}" data-email="${esc(c.email||'')}" data-phone="${esc(c.phone||'')}" data-address="${esc(c.address||'')}" data-contact_person="${esc(c.contact_person||'')}"
               style="padding:10px 12px;margin:4px;border:1px solid var(--brd-m);border-radius:8px;background:var(--bg3);cursor:pointer;display:flex;align-items:center;gap:10px;transition:all .15s"
               onmouseover="this.style.background='var(--gold-bg,rgba(212,168,93,.12))';this.style.borderColor='var(--gold)'"
               onmouseout="this.style.background='var(--bg3)';this.style.borderColor='var(--brd-m)'">
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;color:var(--t1);font-size:14px">${esc(c.name||'—')}</div>
              <div style="font-size:11.5px;color:var(--t3);margin-top:2px">ИНН ${esc(c.inn||'—')}${c.address ? ' · ' + esc(c.address) : ''}${c.contact_person ? ' · 👤 ' + esc(c.contact_person) : ''}</div>
            </div>
            <button class="pk3-btn pk3-gold pk3-sm" data-act="pick" style="white-space:nowrap">Выбрать →</button>
          </div>
        `).join('');
      } catch (e) {
        list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--err-t)">Ошибка: ' + esc(String(e.message||e)) + '</div>';
      }
    };
    q.addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => doSearch(e.target.value.trim()), 250);
    });
    m.addEventListener('click', (e) => {
      if (e.target === m) { close(); return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') return close();
      if (act === 'new') { close(); return _openCreateCustomerModal(card); }
      if (act === 'pick') {
        const row = e.target.closest('.pk3-cust-row');
        if (row) {
          _fillCustomerFields({
            name: row.dataset.name, inn: row.dataset.inn, email: row.dataset.email,
            phone: row.dataset.phone, address: row.dataset.address,
            contact_person: row.dataset.contact_person
          });
          toast('Контрагент', row.dataset.name, 'ok');
          close();
        }
      }
    });
    document.addEventListener('keydown', function escH(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escH); }
    });
    // Загрузка списка сразу
    doSearch('');
    setTimeout(() => q.focus(), 50);
  }

  function _openCreateCustomerModal(card) {
    const m = document.createElement('div');
    m.style.cssText = 'position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(4px)';
    m.innerHTML = `
      <div style="background:var(--bg2);border:1px solid var(--brd);border-radius:14px;width:min(560px,92vw);box-shadow:0 16px 48px rgba(0,0,0,.6)">
        <div style="padding:14px 18px;border-bottom:1px solid var(--brd-m);display:flex;align-items:center;gap:10px">
          <span style="font-size:18px;color:var(--gold)">＋</span>
          <h3 style="margin:0;font-family:'Cinzel',Georgia,serif;font-size:17px;color:var(--t1);flex:1">Новый контрагент</h3>
          <button class="pk3-btn pk3-ghost pk3-sm" data-act="close">✕</button>
        </div>
        <div style="padding:16px 18px;display:flex;flex-direction:column;gap:9px">
          <div style="display:flex;gap:8px">
            <input id="nc-inn" placeholder="ИНН (10 или 12 цифр) *" maxlength="12"
                   style="flex:1;padding:9px 11px;border:1px solid var(--brd-m);border-radius:7px;background:var(--bg1);color:var(--t1);font-size:14px" />
            <button class="pk3-btn pk3-ghost" data-act="egrul" title="Подгрузить из ЕГРЮЛ">🔎 ЕГРЮЛ</button>
          </div>
          <input id="nc-name" placeholder="Название организации *"
                 style="padding:9px 11px;border:1px solid var(--brd-m);border-radius:7px;background:var(--bg1);color:var(--t1);font-size:14px" />
          <input id="nc-address" placeholder="Юридический адрес"
                 style="padding:9px 11px;border:1px solid var(--brd-m);border-radius:7px;background:var(--bg1);color:var(--t1);font-size:14px" />
          <div style="display:flex;gap:8px">
            <input id="nc-email" placeholder="Email" type="email"
                   style="flex:1;padding:9px 11px;border:1px solid var(--brd-m);border-radius:7px;background:var(--bg1);color:var(--t1);font-size:14px" />
            <input id="nc-phone" placeholder="Телефон"
                   style="flex:1;padding:9px 11px;border:1px solid var(--brd-m);border-radius:7px;background:var(--bg1);color:var(--t1);font-size:14px" />
          </div>
          <input id="nc-contact" placeholder="Контактное лицо"
                 style="padding:9px 11px;border:1px solid var(--brd-m);border-radius:7px;background:var(--bg1);color:var(--t1);font-size:14px" />
        </div>
        <div style="padding:12px 18px;border-top:1px solid var(--brd-m);display:flex;justify-content:flex-end;gap:8px">
          <button class="pk3-btn pk3-ghost" data-act="close">Отмена</button>
          <button class="pk3-btn pk3-gold" data-act="save">💾 Создать и выбрать</button>
        </div>
      </div>
    `;
    document.body.appendChild(m);
    setTimeout(() => m.querySelector('#nc-inn').focus(), 50);
    const close = () => { try { m.remove(); } catch(_) {} };
    const saveBtn = m.querySelector('[data-act="save"]');
    const egrulBtn = m.querySelector('[data-act="egrul"]');

    egrulBtn.addEventListener('click', async () => {
      const inn = m.querySelector('#nc-inn').value.trim();
      if (!inn || inn.length < 10) { toast('ИНН', 'Введите 10+ цифр', 'warn'); return; }
      egrulBtn.disabled = true; egrulBtn.textContent = '⏳';
      try {
        const r = await api('/api/customers/lookup/' + encodeURIComponent(inn));
        if (r.ok && r.data && r.data.found && r.data.suggestion) {
          const s = r.data.suggestion;
          m.querySelector('#nc-name').value = s.name || s.full_name || '';
          m.querySelector('#nc-address').value = s.address || '';
          toast('ЕГРЮЛ', s.name || 'Найдено', 'ok');
        } else {
          toast('ЕГРЮЛ', 'Не найдено по этому ИНН', 'warn');
        }
      } catch (e) {
        toast('ЕГРЮЛ', String(e.message || e), 'err');
      } finally {
        egrulBtn.disabled = false; egrulBtn.textContent = '🔎 ЕГРЮЛ';
      }
    });

    m.addEventListener('click', async (e) => {
      if (e.target === m) { close(); return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') return close();
      if (act === 'save') {
        const inn = m.querySelector('#nc-inn').value.trim();
        const name = m.querySelector('#nc-name').value.trim();
        if (!/^\d{10}$|^\d{12}$/.test(inn)) { toast('ИНН', '10 или 12 цифр', 'warn'); return; }
        if (!name) { toast('Название', 'Обязательно', 'warn'); return; }
        const body = {
          inn, name,
          email:          m.querySelector('#nc-email').value.trim() || null,
          phone:          m.querySelector('#nc-phone').value.trim() || null,
          contact_person: m.querySelector('#nc-contact').value.trim() || null,
          address:        m.querySelector('#nc-address').value.trim() || null
        };
        saveBtn.disabled = true; saveBtn.textContent = '⏳ Сохраняю…';
        try {
          const r = await api('/api/customers', { method: 'POST', body });
          if (!r.ok) {
            const errMsg = (r.data && (r.data.error || r.data.message)) || 'Не сохранилось';
            // Если контрагент с этим ИНН уже есть — предложить выбрать его
            if (errMsg.toLowerCase().includes('уже существует') || r.status === 409) {
              const gr = await api('/api/customers/' + encodeURIComponent(inn));
              if (gr.ok && gr.data && gr.data.customer) {
                _fillCustomerFields(gr.data.customer);
                toast('Контрагент', 'Уже был в базе — выбран', 'info');
                close();
                return;
              }
            }
            toast('Ошибка', errMsg, 'err');
            saveBtn.disabled = false; saveBtn.textContent = '💾 Создать и выбрать';
            return;
          }
          _fillCustomerFields(body);
          toast('Создано', name, 'ok');
          close();
        } catch (e) {
          toast('Ошибка', String(e.message || e), 'err');
          saveBtn.disabled = false; saveBtn.textContent = '💾 Создать и выбрать';
        }
      }
    });
    document.addEventListener('keydown', function escH(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escH); }
    });
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
    const pmDocs    = (card.pm_documents && card.pm_documents.length)
      ? card.pm_documents
      : (Array.isArray(card.manual_documents)
        ? card.manual_documents.filter((d) => d && d.generated_by !== 'mimir' && d.source !== 'mimir')
        : []);
    const calcDocs  = card.calc_documents || [];
    // _src='email' → download через /api/pre-tenders/:ptId/email-attachments/:attId/download
    // _src='manual' → через /api/pre-tenders/:ptId/documents/:idx/download
    // _src='calc'   → отдельный canal (TKP)
    const renderDoc = (d, idx, src) => `
      <div class="pk3-doc-row">
        <span class="pk3-doc-ic">${esc(_docIcon(d.mime_type || d.original_filename || d.filename))}</span>
        <span class="pk3-doc-name">${esc(d.original_filename || d.filename || 'файл')}</span>
        <span class="pk3-doc-size">${d.size ? _fmtBytes(d.size) : ''}</span>
        <div class="pk3-doc-actions">
          <button class="pk3-doc-btn" data-action="doc-view" data-src="${src}" data-id="${d.id || idx}" title="Открыть">👁</button>
          <button class="pk3-doc-btn" data-action="doc-dl"   data-src="${src}" data-id="${d.id || idx}" title="Скачать">⬇</button>
        </div>
      </div>
    `;
    // 🧙 manual_documents JSONB c generated_by='mimir' — сметы/отчёты/письма от AI.
    // Сохраняем абсолютный индекс в исходном массиве — backend ждёт его в /:ptId/documents/:idx/download.
    const allManual = Array.isArray(card.manual_documents) ? card.manual_documents : [];
    const _isPdfSibling = (md) => !!(md && ((md.kind && /_pdf$/.test(md.kind)) || md.parent_kind));
    const mimirAll = allManual
      .map((md, idx) => ({ md, idx }))
      .filter(x => x.md && x.md.generated_by === 'mimir');
    // PDF-сиблинги схлопываются в кнопку у родителя — отдельной строкой не показываем.
    const mimirDocs = mimirAll.filter(x => !_isPdfSibling(x.md));
    // Карта parent_kind → {idx} для O(1) поиска PDF-сиблинга у родителя.
    const mimirPdfByParent = {};
    mimirAll.forEach(x => {
      if (!_isPdfSibling(x.md)) return;
      const pk = x.md.parent_kind || (x.md.kind || '').replace(/_pdf$/, '');
      if (pk) mimirPdfByParent[pk] = x;
    });
    const _mimirIcon = (kind, mime) => {
      if (kind === 'smeta') return '📊';
      if (kind === 'director_report') return '📄';
      if (kind === 'customer_letter') return '✉';
      if (kind === 'tkp') return '📋';
      return _docIcon(mime || '');
    };
    const _mimirKindLbl = (kind) => {
      if (kind === 'smeta') return 'смета';
      if (kind === 'director_report') return 'отчёт директору';
      if (kind === 'customer_letter') return 'письмо клиенту';
      if (kind === 'tkp') return 'ТКП';
      return '';
    };
    const renderMimirDoc = ({ md, idx }) => {
      const name = md.filename || md.original_name || ('документ #' + idx);
      const kind = md.kind || '';
      const lbl  = _mimirKindLbl(kind);
      const ext  = (name.split('.').pop() || '').toUpperCase();
      const dlLbl = ext === 'XLSX' ? '⬇ XLSX' : (ext === 'DOCX' ? '⬇ DOCX' : (ext === 'PDF' ? '⬇ PDF' : '⬇ Скачать'));
      // Кнопка «✏ Просмотр и правки» доступна для смет (xlsx) и отчётов директору (docx),
      // т.к. для них backend умеет распарсить в JSON + сгенерить обратно.
      const editable = (kind === 'smeta' || kind === 'mimir_smeta'
                     || kind === 'director_report' || kind === 'mimir_director_report');
      // Вторая кнопка «⬇ PDF» — если родитель НЕ PDF и (а) есть PDF-сиблинг в manual_documents
      // (тогда качаем сиблинг по его idx), либо (б) исходник XLSX/DOCX — backend сконвертит
      // on-demand через ?format=pdf на том же /:ptId/documents/:idx/download.
      const pdfSib = mimirPdfByParent[kind];
      const hasPdfBtn = ext !== 'PDF' && (pdfSib || ext === 'XLSX' || ext === 'DOCX');
      const pdfId = pdfSib ? pdfSib.idx : idx;
      return `
        <div class="pk3-doc-row" data-mimir-kind="${esc(kind)}">
          <span class="pk3-doc-ic">${esc(_mimirIcon(kind, md.mime))}</span>
          <span class="pk3-doc-name">${esc(name)}${lbl ? ` <span style="color:var(--t3);font-size:11px;font-weight:400">· ${esc(lbl)}</span>` : ''}</span>
          <span class="pk3-doc-size">${md.size ? _fmtBytes(md.size) : ''}</span>
          <div class="pk3-doc-actions">
            <button class="pk3-doc-btn" data-action="doc-view" data-src="manual" data-id="${idx}" title="Открыть">👁</button>
            <button class="pk3-doc-btn" data-action="doc-dl"   data-src="manual" data-id="${idx}" title="Скачать ${esc(ext || 'файл')}">${dlLbl}</button>
            ${hasPdfBtn ? `<button class="pk3-doc-btn" data-action="doc-dl-pdf" data-src="manual" data-id="${pdfId}" data-from-parent="${pdfSib ? '0' : '1'}" title="Скачать PDF">⬇ PDF</button>` : ''}
            ${editable ? `<button class="pk3-doc-btn" data-action="doc-preview-edit" data-src="manual" data-id="${idx}" data-kind="${esc(kind)}" title="Просмотр и правки">✏</button>` : ''}
          </div>
        </div>
      `;
    };
    const totalCount = emailDocs.length + pmDocs.length + calcDocs.length + mimirDocs.length;
    return _section('sec-docs', '📎', 'Документы', totalCount, `
      <div class="pk3-doc-group">
        <h4>📧 Из письма клиента</h4>
        ${emailDocs.length ? emailDocs.map((d,i) => renderDoc(d,i,'email')).join('') : '<div style="color:var(--t3);font-size:11.5px">Нет вложений</div>'}
      </div>
      <div class="pk3-doc-group">
        <h4>📤 Загружено РП</h4>
        ${pmDocs.length ? pmDocs.map((d,i) => renderDoc(d,i,'manual')).join('') : '<div class="pk3-doc-add" data-action="doc-upload">+ Перетащите файлы или нажмите чтобы выбрать</div>'}
      </div>
      <div class="pk3-doc-group">
        <h4>🧮 Расчёты и сметы</h4>
        ${calcDocs.length ? calcDocs.map((d,i) => renderDoc(d,i,'calc')).join('') : '<div style="color:var(--t3);font-size:11.5px">Сметы появятся после Quick/Кондуктора</div>'}
      </div>
      <div class="pk3-doc-group">
        <h4>🧙 Сгенерировано Мимиром</h4>
        ${mimirDocs.length ? mimirDocs.map(renderMimirDoc).join('') : '<div style="color:var(--t3);font-size:11.5px">Документы появятся после запуска Quick или Conductor</div>'}
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
      <div style="margin-top:8px"><button class="pk3-btn" id="pk3-save-fin" data-action="save-fin">💾 Сохранить финансы</button></div>
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
      <div id="pk3-tkp-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px"></div>
      ${stat.lock ? '' : `
        <div class="pk3-calc-panel" style="grid-template-columns:1fr 1fr;margin-bottom:10px">
          <div class="pk3-calc-card pk3-r" data-action="open-tkp" style="border-color:var(--gold);background:var(--gold-bg)">
            <span class="pk3-ic">🛠</span>
            <div class="pk3-title">Открыть/создать ТКП</div>
            <div class="pk3-sub">блоки + превью + шаблон по типу</div>
          </div>
          <div class="pk3-calc-card pk3-c" data-action="tkp-upload">
            <span class="pk3-ic">📥</span>
            <div class="pk3-title">Загрузить готовый файл</div>
            <div class="pk3-sub">если у тебя свой ТКП в Word/PDF</div>
          </div>
        </div>
        <div class="pk3-hint">💡 После создания ТКП появится здесь со ссылками на PDF/Excel. Сумма подтянется в Финансы.</div>
      `}
    `);
  }

  // 22.06.2026: подгружаем прикреплённые ТКП по pre_tender_id (или tender_id)
  // через GET /api/tkp?pre_tender_id=X и рендерим карточки со ссылками PDF/Excel.
  function _fmtMoney(v) {
    if (v == null || v === '' || isNaN(v)) return '—';
    return Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
  }
  function _tkpStatusBadge(s) {
    const m = {
      draft:     { cls: 'pk3-warn', label: 'черновик' },
      review:    { cls: 'pk3-info', label: 'на согл.' },
      approved:  { cls: 'pk3-ok',   label: 'утверждено' },
      sent:      { cls: 'pk3-ok',   label: 'отправлено' },
      won:       { cls: 'pk3-ok',   label: 'принято' },
      lost:      { cls: 'pk3-err',  label: 'отклонено' },
      cancelled: { cls: 'pk3-err',  label: 'отменено' }
    };
    return m[s] || { cls: 'pk3-info', label: s || '?' };
  }
  function _renderTkpListItem(t) {
    const b = _tkpStatusBadge(t.status);
    const token = (() => { try { return localStorage.getItem('asgard_token'); } catch (_) { return ''; } })();
    const tokenQs = token ? `?token=${encodeURIComponent(token)}` : '';
    return `
      <div class="pk3-doc-row" style="border:1px solid var(--brd-m);border-left:3px solid var(--gold);border-radius:8px;padding:10px 12px;background:var(--bg2)">
        <span class="pk3-doc-ic">🛠</span>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <b style="color:var(--t1)">ТКП №${t.id}</b>
            <span class="pk3-tag ${b.cls}">${b.label}</span>
            <span style="margin-left:auto;color:var(--gold-l,var(--gold));font-weight:700;font-family:var(--ff-mono,monospace);font-size:14px">${_fmtMoney(t.total_sum)}</span>
          </div>
          <div style="font-size:11.5px;color:var(--t3);margin-top:3px">создано: ${esc(_fmtNoteWhen(t.created_at) || '')}${t.creator_name ? ' · ' + esc(t.creator_name) : ''}</div>
        </div>
        <div class="pk3-doc-actions" style="display:flex;gap:5px">
          <a class="pk3-doc-btn" href="#/tkp?edit=${t.id}" title="Открыть в конструкторе">✏️</a>
          <a class="pk3-doc-btn" href="/api/tkp/${t.id}/pdf${tokenQs}" target="_blank" title="Скачать PDF">📥 PDF</a>
          <a class="pk3-doc-btn" href="/api/tkp/${t.id}/excel${tokenQs}" target="_blank" title="Скачать Excel">📊 XLSX</a>
        </div>
      </div>
    `;
  }
  async function _loadAndRenderTkpList(card) {
    const container = document.getElementById('pk3-tkp-list');
    let qs = '';
    if (card.entity_kind === 'pre_tender' || card.flow_type === 'pre_tender') qs = 'pre_tender_id=' + card.entity_id;
    else if (card.entity_kind === 'tender' || card.flow_type === 'tender')    qs = 'tender_id='    + card.entity_id;
    if (!qs) return; // application/work — нет связи
    try {
      const r = await api(`/api/tkp?${qs}&limit=20`);
      const items = (r.ok && r.data && Array.isArray(r.data.items)) ? r.data.items : [];
      // 22.06.2026: считаем max total_sum для порога 50M.
      const maxSum = items.reduce((acc, t) => Math.max(acc, Number(t.total_sum) || 0), 0);
      card._tkp_max_sum = items.length ? maxSum : null;
      // Перерисовать action-bar — теперь кнопка зависит от наличия и суммы ТКП
      const bar = document.getElementById('pk3-actions-bar');
      if (bar) bar.innerHTML = _renderActionsBar(card);
      if (container) {
        if (!items.length) container.innerHTML = '';
        else container.innerHTML = items.map(_renderTkpListItem).join('');
      }
      // 22.06.2026: автоподтяжка фин-карточек. Сначала смета (полные totals),
      // если её нет — ТКП (только КП без НДС). Не ждём, делаем параллельно.
      _autofillFinFromTkp(card);
    } catch (_) {}
  }

  // 22.06.2026: автоподтяжка финансов в карту — единый endpoint /finance-source.
  // Приоритет: 1) смета (totals из tkp_quick_sessions.finalized), 2) ТКП (total_sum), 3) ручной ввод.
  // Раньше брали ТКП — отдавал только цену КП без с/с и маржи. Теперь смета даёт всё.
  async function _autofillFinFromTkp(card) {
    const fin = card.finance || {};
    if (fin.kp_price_without_vat || fin.cost_planned) return; // ручной override
    let qs = '';
    if (card.entity_kind === 'pre_tender' || card.flow_type === 'pre_tender') qs = 'pre_tender_id=' + card.entity_id;
    else if (card.entity_kind === 'tender' || card.flow_type === 'tender')    qs = 'tender_id='    + card.entity_id;
    if (!qs) return;
    try {
      const r = await api(`/api/tkp-quick/finance-source?${qs}`);
      if (!r.ok || !r.data || !r.data.totals) return;
      const { source, totals, ref_id } = r.data;
      const fmt = (n) => n != null ? Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽' : '— ₽';
      const cards = document.querySelectorAll('#sec-fin .pk3-fin-card .pk3-v');
      if (cards.length < 4) return;
      cards[0].textContent = fmt(totals.cost);
      cards[1].textContent = fmt(totals.kp_no_vat);
      cards[2].textContent = fmt(totals.kp_with_vat);
      if (totals.margin_pct != null) {
        cards[3].textContent = totals.margin_pct.toFixed(1) + '%';
        cards[3].style.color = totals.margin_pct > 0 ? 'var(--ok-t)' : 'var(--err-t)';
      } else {
        cards[3].textContent = '— %';
      }
      // Маркер источника
      const grid = document.querySelector('#sec-fin .pk3-fin-grid');
      if (grid) {
        let tag = grid.parentNode.querySelector('.pk3-fin-source');
        if (!tag) {
          tag = document.createElement('div');
          tag.className = 'pk3-fin-source';
          tag.style.cssText = 'font-size:11px;color:var(--t3);margin-top:6px;margin-bottom:6px';
          grid.parentNode.insertBefore(tag, grid.nextSibling);
        }
        const srcLabel = source === 'estimate'
          ? `🧮 Из сметы (Quick-сессия #${ref_id}). Поля ниже — для ручного override.`
          : `📋 Из ТКП №${ref_id} (сметы ещё нет — только цена КП). Создайте смету через 🚀 Quick для полных финансов.`;
        tag.innerHTML = srcLabel;
      }
    } catch (_) {}
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

  const REMINDER_KINDS = [
    { id: 'call', label: '📞 Звонок' },
    { id: 'sms', label: '💬 СМС' },
    { id: 'meeting', label: '🤝 Встреча' },
    { id: 'task', label: '✅ Задача' },
    { id: 'email', label: '✉️ Письмо' },
    { id: 'other', label: '📌 Другое' }
  ];
  const REMINDER_LEAD_OPTS = [
    { v: 0, label: 'В момент события' },
    { v: 15, label: 'За 15 минут' },
    { v: 30, label: 'За 30 минут' },
    { v: 60, label: 'За 1 час' },
    { v: 120, label: 'За 2 часа' },
    { v: 1440, label: 'За 1 день' },
    { v: 2880, label: 'За 2 дня' },
    { v: 10080, label: 'За 1 неделю' }
  ];
  const REMINDER_CHANNELS = [
    { id: 'inapp', label: 'В CRM (push / Telegram)' },
    { id: 'whatsapp', label: 'WhatsApp' },
    { id: 'max', label: 'MAX' },
    { id: 'email', label: 'Email' }
  ];

  function _reminderKindLabel(kind) {
    const k = REMINDER_KINDS.find(x => x.id === kind);
    return k ? k.label : (kind || 'Напоминание');
  }
  function _reminderLeadLabel(mins) {
    const o = REMINDER_LEAD_OPTS.find(x => x.v === Number(mins));
    return o ? o.label : (mins ? `За ${mins} мин` : 'В момент события');
  }
  function _reminderChannelLabels(channels) {
    const arr = Array.isArray(channels) ? channels : ['inapp'];
    return arr.map(c => {
      const ch = REMINDER_CHANNELS.find(x => x.id === c);
      return ch ? ch.label : c;
    }).join(', ');
  }
  function _fmtReminderWhen(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (isNaN(d)) return '—';
      return d.toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (_) { return '—'; }
  }
  function _defaultEventLocalIso() {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 60);
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  function _secReminders(card) {
    const open = ((card && card._reminders) || []).filter(r => !r.is_done).length;
    return _section('sec-reminders', '⏰', 'Напоминания', open || null, `
      <div id="pk3-reminders-list" style="display:flex;flex-direction:column;gap:8px">
        <div style="color:var(--t3);font-size:12px">Загрузка…</div>
      </div>
      <div style="margin-top:10px">
        <button class="pk3-btn pk3-ghost" data-action="remind" type="button">➕ Добавить напоминание</button>
      </div>
    `);
  }

  function _renderReminderCard(rem) {
    const done = !!rem.is_done;
    const fired = !!rem.fired_at;
    const statusCls = done ? 'pk3-info' : (fired ? 'pk3-warn' : 'pk3-ok');
    const statusText = done ? 'Выполнено' : (fired ? 'Отправлено' : 'Ожидает');
    const channels = _reminderChannelLabels(rem.channels);
    return `
      <div class="pk3-reminder-card" data-reminder-id="${rem.id}" style="border:1px solid var(--brd-m);border-radius:10px;padding:10px 12px;background:var(--bg2)">
        <div style="display:flex;align-items:flex-start;gap:8px">
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;color:var(--t1)">${esc(_reminderKindLabel(rem.reminder_kind))}${rem.title ? ': ' + esc(rem.title) : ''}</div>
            <div style="font-size:11.5px;color:var(--t3);margin-top:4px">
              📅 Событие: <b style="color:var(--t2)">${esc(_fmtReminderWhen(rem.event_at || rem.remind_at))}</b>
              · ${_reminderLeadLabel(rem.lead_minutes)}
            </div>
            ${rem.message ? `<div style="font-size:12px;color:var(--t2);margin-top:6px">${esc(rem.message)}</div>` : ''}
            <div style="font-size:11px;color:var(--t3);margin-top:6px">📡 ${esc(channels)}</div>
            <span class="pk3-tag ${statusCls}" style="margin-top:6px;display:inline-block">${statusText}</span>
          </div>
          ${!done ? `
          <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
            <button class="pk3-btn pk3-ghost" type="button" data-reminder-act="edit" title="Изменить" style="padding:4px 8px;font-size:11px">✏️</button>
            <button class="pk3-btn pk3-ghost" type="button" data-reminder-act="done" title="Выполнено" style="padding:4px 8px;font-size:11px">✅</button>
            <button class="pk3-btn pk3-ghost" type="button" data-reminder-act="delete" title="Удалить" style="padding:4px 8px;font-size:11px">🗑</button>
          </div>` : `
          <button class="pk3-btn pk3-ghost" type="button" data-reminder-act="delete" title="Удалить" style="padding:4px 8px;font-size:11px;flex-shrink:0">🗑</button>`}
        </div>
      </div>`;
  }

  function _renderRemindersList(items) {
    const list = document.getElementById('pk3-reminders-list');
    if (!list) return;
    const arr = items || [];
    const open = arr.filter(r => !r.is_done);
    list.innerHTML = arr.length
      ? arr.map(_renderReminderCard).join('')
      : '<div style="color:var(--t3);font-size:12px">Напоминаний пока нет. Нажмите «⏰ Напоминание» внизу или кнопку выше.</div>';
    const secHead = document.querySelector('#sec-reminders .pk3-section-head');
    if (secHead) {
      let secCnt = secHead.querySelector('.pk3-count');
      if (open.length > 0) {
        if (!secCnt) {
          secCnt = document.createElement('span');
          secCnt.className = 'pk3-count';
          const chev = secHead.querySelector('.pk3-chev');
          if (chev) secHead.insertBefore(secCnt, chev);
          else secHead.appendChild(secCnt);
        }
        secCnt.textContent = String(open.length);
      } else if (secCnt) {
        secCnt.remove();
      }
    }
    _updateRemindersBadge(arr);
  }

  async function _loadAndRenderReminders(card) {
    try {
      const r = await api(`/api/personal-kanban/cards/${card.id}/reminders`);
      if (!r.ok || !r.data) {
        const list = document.getElementById('pk3-reminders-list');
        if (list) list.innerHTML = '<div style="color:var(--red,#e74c3c);font-size:12px">Не удалось загрузить напоминания</div>';
        return;
      }
      card._reminders = r.data.items || [];
      _renderRemindersList(card._reminders);
    } catch (e) {
      const list = document.getElementById('pk3-reminders-list');
      if (list) list.innerHTML = '<div style="color:var(--red,#e74c3c);font-size:12px">Ошибка загрузки</div>';
    }
  }

  function _updateRemindersBadge(items) {
    const open = (items || []).filter(r => !r.is_done).length;
    const btn = document.querySelector('#pk3-actions-bar [data-action="remind"]');
    if (!btn) return;
    let badge = btn.querySelector('.pk3-rem-badge');
    if (open > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'pk3-rem-badge';
        badge.style.cssText = 'margin-left:6px;background:var(--gold,#c9a227);color:#111;border-radius:10px;padding:1px 7px;font-size:10px;font-weight:700';
        btn.appendChild(badge);
      }
      badge.textContent = String(open);
    } else if (badge) {
      badge.remove();
    }
  }

  async function _onReminderAction(act, remId, card) {
    if (!remId) return;
    if (act === 'delete') {
      if (!window.confirm('Удалить напоминание?')) return;
      const r = await api(`/api/personal-kanban/cards/${card.id}/reminders/${remId}`, { method: 'DELETE' });
      if (!r.ok) { toast('Ошибка', 'Не удалось удалить', 'err'); return; }
      toast('Готово', 'Напоминание удалено', 'ok');
      await _loadAndRenderReminders(card);
      return;
    }
    if (act === 'done') {
      const r = await api(`/api/personal-kanban/cards/${card.id}/reminders/${remId}`, {
        method: 'PATCH', body: { is_done: true }
      });
      if (!r.ok) { toast('Ошибка', 'Не удалось отметить', 'err'); return; }
      toast('Готово', 'Напоминание выполнено', 'ok');
      await _loadAndRenderReminders(card);
      return;
    }
    if (act === 'edit') {
      const rem = (card._reminders || []).find(x => String(x.id) === String(remId));
      if (rem) _addReminder(card, rem);
    }
  }

  function _renderActionsBar(card) {
    const openRem = ((card && card._reminders) || []).filter(r => !r.is_done).length;
    const remBadge = openRem > 0
      ? `<span class="pk3-rem-badge" style="margin-left:6px;background:var(--gold,#c9a227);color:#111;border-radius:10px;padding:1px 7px;font-size:10px;font-weight:700">${openRem}</span>`
      : '';
    const ghost = `
      <button class="pk3-btn pk3-ghost" data-action="save">💾 Сохранить</button>
      <button class="pk3-btn pk3-ghost" data-action="note">📝 Заметка</button>
      <button class="pk3-btn pk3-ghost" data-action="remind">⏰ Напоминание${remBadge}</button>
      <button class="pk3-btn pk3-ghost" data-action="letter">✉ Письмо</button>
      <div style="flex:1"></div>
    `;
    let context = '';
    if (card.col === 'new') {
      context = `
        <button class="pk3-btn" data-action="convert-pretender">📄 В пре-тендер</button>
        <button class="pk3-btn pk3-gold" data-action="trans-calc">🚀 К просчёту</button>
      `;
    } else if (card.col === 'calc') {
      // 22.06.2026: динамическая кнопка по сумме ТКП.
      // Сумма (max total_sum) подтянется через _loadAndRenderTkpList → setCardPrice.
      // По дефолту показываем gold-кнопку "На согласование" — backend сам решит:
      //   если ТКП нет → 400 "Сначала создайте ТКП"
      //   если сумма < 50M → автопромоут в kp_prep
      //   если ≥ 50M → реальное согласование директором
      const tkpSum = card._tkp_max_sum;
      const hasTkp = tkpSum != null;
      const under = hasTkp && tkpSum < 50_000_000;
      if (!hasTkp) {
        context = `
          <span style="font-size:11px;color:var(--t3);align-self:center;margin-right:6px">📋 Сначала создайте ТКП в разделе ниже</span>
          <button class="pk3-btn" disabled style="opacity:.55;cursor:not-allowed">⚖️ На согласование</button>
        `;
      } else if (under) {
        context = `
          <span style="font-size:11px;color:var(--ok-t);align-self:center;margin-right:6px">💰 ${Math.round(tkpSum).toLocaleString('ru-RU')} ₽ &lt; 50 млн — согл. не нужно</span>
          <button class="pk3-btn pk3-ok" data-action="trans-kp_prep">✅ Утвердить и в КП</button>
        `;
      } else {
        context = `
          <span style="font-size:11px;color:var(--warn-t);align-self:center;margin-right:6px">💰 ${Math.round(tkpSum).toLocaleString('ru-RU')} ₽ ≥ 50 млн — нужно согласование</span>
          <button class="pk3-btn pk3-gold" data-action="trans-approval">⚖️ На согласование директору</button>
        `;
      }
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
      // 21.06.2026: работа уже создана автохуком при tender→win
      // (src/routes/personal-kanban.js:2076-2159). Кнопка ведёт прямо в карточку работы.
      // Раньше "trans-work" возвращал 409 — backend не поддерживает tender→work transition.
      context = `<button class="pk3-btn pk3-gold" data-action="open-work">🏗 Открыть работу</button>`;
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
    // Подтягиваем дефолтный НДС из настроек системы (settings.vat_default_pct).
    // Раньше fallback был хардкод 20% — но компания работает с 22% (УСН 5/НДС/etc),
    // дефолт должен браться из настроек, не из кода.
    (async () => {
      try {
        const r = await api('/api/settings/vat_default_pct');
        const v = (r && r.ok && r.data && r.data.value != null) ? String(r.data.value) : null;
        if (!v) return;
        const sel = $('#pk3-f-vat');
        if (sel) {
          // Если значения из настроек нет среди option — добавляем.
          if (![...sel.options].some(o => o.value === v)) {
            const opt = document.createElement('option');
            opt.value = v; opt.textContent = v + '% (по настройкам)';
            sel.appendChild(opt);
          }
          sel.value = v;
        }
      } catch (_) {}
    })();
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
    // 22.06.2026: event delegation — handler на drawer, ловит ВСЕ клики [data-action].
    // Раньше биндились отдельно на каждую кнопку, но после перерисовок innerHTML
    // (например _loadAndRenderTkpList → bar.innerHTML=...) обработчики слетали,
    // и кнопки «📝 Заметка», «✅ Утвердить» и т.п. переставали реагировать.
    if (_drawerEl && _drawerEl.drawer) {
      _drawerEl.drawer.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-action]');
        if (!b || !_drawerEl.drawer.contains(b)) return;
        e.stopPropagation();
        await _onDrawerAction(b.dataset.action, card);
      });
    }
    // 22.06.2026 v3: event delegation для tools (✏️/🗑) inline-стикеров
    if (_drawerEl && _drawerEl.notesBoard) {
      _drawerEl.notesBoard.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-note-act]');
        if (!btn) return;
        const noteEl = btn.closest('[data-pk3-sticker]');
        if (!noteEl) return;
        const act = btn.dataset.noteAct;
        if (act === 'edit')   _startNoteEdit(noteEl, card);
        if (act === 'delete') _deleteNote(noteEl, card);
      });
    }
    // Грузим заметки асинхронно — drawer уже виден
    _loadAndRenderNotes(card);
    _loadAndRenderReminders(card);
    // 22.06.2026: подгружаем прикреплённые ТКП в секции 📋 (с кнопками PDF/Excel)
    _loadAndRenderTkpList(card);
    // Напоминания: делегирование кнопок в секции
    if (_drawerEl && _drawerEl.drawer) {
      _drawerEl.drawer.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-reminder-act]');
        if (!btn || !_drawerEl.drawer.contains(btn)) return;
        const cardEl = btn.closest('[data-reminder-id]');
        const remId = cardEl ? cardEl.dataset.reminderId : null;
        e.stopPropagation();
        await _onReminderAction(btn.dataset.reminderAct, remId, card);
      });
    }
  }

  async function _onDrawerAction(act, card) {
    if (act === 'open-quick')      return _openQuickWizard(card);
    if (act === 'open-conductor')  return _openConductorModal(card);
    if (act === 'open-references') return _openReferencesModal(card);
    if (act === 'open-tkp')        return _openTkpConstructor(card);
    if (act === 'open-send')       return _openSendModal(card);
    if (act === 'tkp-upload')      return _openTkpUploadModal(card);
    if (act === 'tkp-pdf')         return _downloadTkpPdf(card);
    if (act === 'save')            return _saveDrawerFields(card);
    if (act === 'save-fin')        return _saveFinanceFields(card);
    if (act === 'egrul-lookup')    return _doEgrulLookup();
    if (act === 'customer-pick')   return _openCustomerPicker(card);
    if (act === 'customer-new')    return _openCreateCustomerModal(card);
    if (act === 'doc-view' || act === 'doc-dl' || act === 'doc-dl-pdf') return _onDocClick(card, act);
    if (act === 'doc-preview-edit') return _onDocPreviewEditClick(card);
    if (act === 'doc-upload')      return _openDocUploadPicker(card);
    if (act === 'note')            return _addNote(card);
    if (act === 'remind')          return _addReminder(card);
    if (act === 'letter') {
      // ✉ Открыть Composer (React v2) с привязкой к этой карточке.
      // Маппинг entity_kind → parent_entity_type (backend whitelist: tender|work|calc|pre_tender|request).
      const _MAP = { tender:'tender', work:'work', pre_tender:'pre_tender', inbox_application:'pre_tender' };
      const peType = _MAP[card.entity_kind];
      const peId = card.entity_id;
      const qs = new URLSearchParams({ return_to: window.location.href });
      if (peType && peId) {
        qs.set('parent_entity_type', peType);
        qs.set('parent_entity_id', String(peId));
      }
      window.location.href = '/v2/#/correspondence/composer?' + qs.toString();
      return;
    }
    if (act === 'convert-pretender') return _doConvertPretender(card);
    if (act === 'fin-summary')     return toast('Финансовая сводка', 'Откроется в /finance', 'info');
    if (act === 'close-act')       return toast('Закрытие актом', 'Откроется в /works detail', 'info');
    // 21.06.2026: открыть автосозданную работу. После tender→win backend хук
    // (src/routes/personal-kanban.js:2076-2159) уже создал works запись; РП попадает
    // прямо в /pm-works на конкретную работу.
    if (act === 'open-work') {
      try {
        // pre_tender-карточки: ищем по source_pre_tender_id (backend support)
        // tender-карточки: ищем по tender_id
        const e = card.entity || card;
        const query = (card.entity_kind === 'pre_tender' || card.col === 'pre_tenders')
          ? `source_pre_tender_id=${card.entity_id || e.id}`
          : `tender_id=${card.entity_id || card.tender_id || e.id}`;
        const r = await fetch(`/api/works?${query}`, {
          headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('asgard_token') || '') }
        });
        const j = await r.json().catch(() => ({}));
        const works = (j && (j.works || j.items || j.data)) || (Array.isArray(j) ? j : []);
        const work = Array.isArray(works) && works[0];
        if (work && work.id) {
          window.location.hash = `#/pm-works?work_id=${work.id}`;
        } else {
          window.location.hash = '#/pm-works';
        }
        _closeDrawer();
      } catch (_) {
        window.location.hash = '#/pm-works';
        _closeDrawer();
      }
      return;
    }
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
    const get = (id) => { const el = $(id); return el ? (el.value || '').trim() : null; };
    const body = {
      customer_name:    get('#pk3-f-customer') || null,
      customer_inn:     get('#pk3-f-inn')      || null,
      contact_person:   get('#pk3-f-contact')  || null,
      customer_email:   get('#pk3-f-email')    || null,
      contact_phone:    get('#pk3-f-phone')    || null,
      work_description: get('#pk3-f-desc')     || null,
      work_location:    get('#pk3-f-city')     || null,
    };
    const r = await api(`/api/personal-kanban/cards/${card.id}/update`, { method: 'POST', body });
    if (r.ok) {
      toast('Сохранено', 'Карточка клиента обновлена', 'ok');
      Object.assign(card, body);
    } else {
      toast('Не сохранилось', (r.data && r.data.error) || 'Ошибка', 'err');
    }
  }

  async function _saveFinanceFields(card) {
    const getNum = (id) => {
      const el = $(id);
      if (!el || el.value === '') return null;
      const n = Number(el.value);
      return Number.isFinite(n) ? n : null;
    };
    const ptId = card.entity_id || card.entity_id_pt;
    if (!ptId) { toast('Нет привязки', 'pre_tender не найден', 'warn'); return; }
    const kpNoVat = getNum('#pk3-f-kp');
    const cost = getNum('#pk3-f-cost');
    const vatSel = $('#pk3-f-vat');
    const vatRate = vatSel ? Number(vatSel.value) : 20;
    const kpWithVat = kpNoVat != null ? Math.round(kpNoVat * (1 + (vatRate || 0) / 100) * 100) / 100 : null;
    const margin = (cost != null && kpNoVat != null && kpNoVat > 0)
      ? Math.round((1 - cost / kpNoVat) * 1000) / 10
      : null;
    const body = {
      cost_planned: cost,
      kp_price_without_vat: kpNoVat,
      kp_price_with_vat: kpWithVat,
      vat_rate_pct: vatRate,
      margin_planned_pct: margin
    };
    const r = await api(`/api/pre-tenders/${ptId}`, { method: 'PUT', body });
    if (r.ok) {
      toast('Сохранено', 'Финансы обновлены', 'ok');
      card.finance = { ...card.finance, ...body };
    } else {
      toast('Не сохранилось', (r.data && (r.data.error || r.data.message)) || 'Ошибка', 'err');
    }
  }

  // Просмотр / скачивание документа из drawer карты.
  // event.target = <button data-action="doc-view|doc-dl|doc-dl-pdf" data-src=email|manual|calc data-id=...>
  // pt id берём из card.entity_id (это pre_tender_request id).
  // doc-dl-pdf — добавляет format=pdf к URL: если data-from-parent='1' (нет PDF-сиблинга),
  // backend сконвертит исходник XLSX/DOCX в PDF on-demand; иначе data-id уже указывает на сиблинг.
  function _onDocClick(card, act) {
    const ev = window.event;
    const btn = ev && ev.target && ev.target.closest('[data-action="doc-view"], [data-action="doc-dl"], [data-action="doc-dl-pdf"]');
    if (!btn) return;
    const src = btn.dataset.src || 'email';
    const docId = btn.dataset.id;
    const ptId = card.entity_id || card.entity_id_pt || (card.entity && card.entity.id);
    if (!ptId) { toast('Нет привязки', 'Открой pre-tender', 'warn'); return; }
    const token = encodeURIComponent(localStorage.getItem('asgard_token') || '');
    let url;
    if (src === 'email') {
      url = `/api/pre-tenders/${ptId}/email-attachments/${encodeURIComponent(docId)}/download?token=${token}`;
    } else if (src === 'manual') {
      url = `/api/pre-tenders/${ptId}/documents/${encodeURIComponent(docId)}/download?token=${token}`;
    } else {
      toast('Скоро', 'Расчётные файлы появятся после Quick', 'info'); return;
    }
    // doc-dl-pdf: добавляем format=pdf к URL (token уже в query → через '&').
    // Если сиблинг существует — он уже PDF, backend всё равно отдаст как есть; флаг безвреден.
    if (act === 'doc-dl-pdf') {
      url += (url.indexOf('?') >= 0 ? '&' : '?') + 'format=pdf';
    }
    // doc-view → новая вкладка (PDF/img покажет; docx/xlsx скачает — браузер решает).
    // doc-dl / doc-dl-pdf → форсируем download через скрытую ссылку с attribute download.
    if (act === 'doc-dl' || act === 'doc-dl-pdf') {
      const a = document.createElement('a');
      a.href = url; a.download = ''; a.target = '_blank';
      document.body.appendChild(a); a.click(); a.remove();
    } else if (window.AsgardDocPreview) {
      const fname = btn.closest('.pk3-doc-row')?.querySelector('.pk3-doc-name')?.textContent || 'документ';
      window.AsgardDocPreview.open({ title: fname.trim(), fileUrl: url, downloadUrl: url });
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ✏ Просмотр и правки документа Мимира (смета или отчёт директору).
  // Кнопка в drawer-секции «🧙 Сгенерировано Мимиром». Из event-делегата
  // (_onDrawerAction → 'doc-preview-edit') достаём data-id/data-kind с кнопки
  // и зовём _openDocPreviewEdit(card, idx, kind).
  // ─────────────────────────────────────────────────────────────────────────
  function _onDocPreviewEditClick(card) {
    const ev = window.event;
    const btn = ev && ev.target && ev.target.closest('[data-action="doc-preview-edit"]');
    if (!btn) return;
    const idx  = Number(btn.dataset.id);
    const kind = btn.dataset.kind || '';
    if (!Number.isFinite(idx)) { toast('Ошибка', 'Не определён индекс документа', 'err'); return; }
    return _openDocPreviewEdit(card, idx, kind);
  }

  // Нормализатор kind: 'mimir_smeta' / 'smeta' → 'smeta'; 'mimir_director_report'/'director_report' → 'director_report'.
  function _normMimirKind(k) {
    if (!k) return '';
    const s = String(k).toLowerCase();
    if (s.includes('smeta')) return 'smeta';
    if (s.includes('director_report') || s.includes('director')) return 'director_report';
    if (s.includes('customer_letter')) return 'customer_letter';
    if (s.includes('tkp')) return 'tkp';
    return s;
  }

  // Главная функция: открыть модалку предпросмотра/правок.
  // 1. GET /api/pre-tenders/:ptId/documents/:idx/json — получить JSON-представление.
  // 2. Отрисовать редактируемое превью (смета — таблица input'ов с auto-sum;
  //    отчёт — форма по разделам).
  // 3. Кнопки: ⬇ Скачать с правками (POST /save-edits → файл),
  //    ✉ Отправить Мимиру (POST в chat-сессию Quick или conductor recompute).
  async function _openDocPreviewEdit(card, idx, kindRaw) {
    const ptId = card.entity_id || card.entity_id_pt || (card.entity && card.entity.id);
    if (!ptId) { toast('Нет привязки', 'Открой pre-tender', 'warn'); return; }
    const kind = _normMimirKind(kindRaw);
    const titleByKind = (k) => k === 'smeta' ? 'Смета — расчёт себестоимости'
                            : k === 'director_report' ? 'Отчёт директору'
                            : 'Документ Мимира';
    const ttl = titleByKind(kind);

    const overlay = document.createElement('div');
    overlay.className = 'pk3-modal-overlay show';
    overlay.id = 'pk3-doc-edit-overlay';
    overlay.innerHTML = `
      <div class="pk3-modal" style="max-width:1100px">
        <div class="pk3-modal-head">
          <span style="font-size:20px;color:var(--gold)">✏</span>
          <h3>Редактирование: ${esc(ttl)}</h3>
          <span class="pk3-tag pk3-info">правки доступны Мимиру</span>
          <button class="pk3-btn-icon" data-act="close" title="Закрыть">✕</button>
        </div>
        <div class="pk3-modal-body" id="pk3-doc-edit-body">
          <div style="padding:38px;text-align:center;color:var(--t2);font-size:13px">
            ⏳ Загружаю документ…
          </div>
        </div>
        <div class="pk3-modal-foot">
          <button class="pk3-btn pk3-ghost" data-act="close">← Отмена</button>
          <div style="flex:1"></div>
          <button class="pk3-btn pk3-ghost" data-act="download-edited" disabled>⬇ Скачать с правками</button>
          <button class="pk3-btn pk3-gold" data-act="send-mimir" disabled>✉ Отправить Мимиру</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
      const closer = e.target.closest && e.target.closest('[data-act="close"]');
      if (closer) overlay.remove();
    });

    // 1. Загружаем JSON-представление документа.
    let docJson = null;
    try {
      const r = await apiPreTender(`/${ptId}/documents/${idx}/json`);
      if (!r.ok || !r.data) {
        const err = (r.data && r.data.error) || ('HTTP ' + r.status);
        const body = $('#pk3-doc-edit-body');
        if (body) body.innerHTML = `<div style="padding:38px;text-align:center;color:var(--err);font-size:13px">❌ Не удалось загрузить документ: ${esc(err)}</div>`;
        return;
      }
      docJson = r.data;
    } catch (e) {
      const body = $('#pk3-doc-edit-body');
      if (body) body.innerHTML = `<div style="padding:38px;text-align:center;color:var(--err);font-size:13px">❌ Сеть упала: ${esc(String(e.message || e))}</div>`;
      return;
    }

    // 2. Рендерим редактируемое превью.
    const body = $('#pk3-doc-edit-body');
    if (!body) return;
    const realKind = _normMimirKind(docJson.type || kind);
    if (realKind === 'smeta') {
      body.innerHTML = _renderSmetaEditable(docJson);
      _bindSmetaEditable(body);
    } else if (realKind === 'director_report') {
      body.innerHTML = _renderReportEditable(docJson);
    } else {
      body.innerHTML = `<div style="padding:30px;color:var(--t2);font-size:13px">
        Документ типа <b>${esc(docJson.type || 'unknown')}</b> не поддерживается для in-place правок.
        Используй «⬇ Скачать», правь в Word/Excel и загрузи обратно через «📤 Загружено РП».
      </div>`;
    }

    // Включаем кнопки.
    const dlBtn = overlay.querySelector('[data-act="download-edited"]');
    const sndBtn = overlay.querySelector('[data-act="send-mimir"]');
    if (dlBtn) dlBtn.disabled = false;
    if (sndBtn) sndBtn.disabled = false;

    // 3. Действия в футере.
    if (dlBtn) dlBtn.addEventListener('click', async () => {
      const edits = _collectDocEdits(body, realKind);
      if (!edits) { toast('Пусто', 'Нет полей для сохранения', 'warn'); return; }
      dlBtn.disabled = true; dlBtn.textContent = '⏳ Генерирую…';
      try {
        const headers = await _authHeaders();
        const res = await fetch(`/api/pre-tenders/${ptId}/documents/${idx}/save-edits`, {
          method: 'POST', headers, body: JSON.stringify({ kind: realKind, edits })
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          toast('Не сохранилось', txt || ('HTTP ' + res.status), 'err');
          dlBtn.disabled = false; dlBtn.textContent = '⬇ Скачать с правками';
          return;
        }
        // Backend возвращает либо бинарь файла, либо JSON {ok, new_idx}. Сначала пробуем blob.
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          const j = await res.json().catch(() => ({}));
          toast('Сохранено', 'Документ обновлён в карте', 'ok');
          dlBtn.textContent = '✅ Сохранено';
          // Релоад карты, чтобы новый файл появился в списке.
          _reopenCurrentCard();
        } else {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = (realKind === 'smeta' ? 'smeta_edited.xlsx' : 'report_edited.docx');
          document.body.appendChild(a); a.click(); a.remove();
          URL.revokeObjectURL(url);
          dlBtn.disabled = false; dlBtn.textContent = '⬇ Скачать с правками';
          toast('Готово', 'Документ скачан', 'ok');
        }
      } catch (e) {
        toast('Сеть упала', String(e.message || e), 'err');
        dlBtn.disabled = false; dlBtn.textContent = '⬇ Скачать с правками';
      }
    });

    if (sndBtn) sndBtn.addEventListener('click', async () => {
      const fb = (overlay.querySelector('#pk3-doc-edit-feedback') || {}).value;
      const feedback = (fb || '').trim();
      if (!feedback) { toast('Пусто', 'Опиши что нужно поправить — Мимир перечитает.', 'warn'); return; }
      sndBtn.disabled = true; sndBtn.textContent = '⏳ Отправляю…';
      try {
        const ok = await _sendFeedbackToMimir(card, feedback);
        if (ok) {
          toast('Отправлено', 'Мимир пересчитывает в фоне — обнови карту через минуту.', 'ok');
          overlay.remove();
        } else {
          toast('Не отправилось', 'Не нашёл активной Quick/Conductor сессии для карты. Запусти 🚀 Quick или 🎩 Кондуктора.', 'err');
          sndBtn.disabled = false; sndBtn.textContent = '✉ Отправить Мимиру';
        }
      } catch (e) {
        toast('Сеть упала', String(e.message || e), 'err');
        sndBtn.disabled = false; sndBtn.textContent = '✉ Отправить Мимиру';
      }
    });
  }

  // Рендер редактируемой сметы: JSON {type:'smeta', rows:[[col1,col2,...], ...]}.
  // Каждая ячейка — input. Внизу — textarea «Замечания Мимиру».
  // На каждый input навешиваем data-field (qty|price|sum|rate|total_xxx|grand_xxx|markup|vat)
  // — это позволяет _bindSmetaEditable пересчитывать суммы строк, итоги разделов и большие итоги.
  function _renderSmetaEditable(j) {
    const rows = Array.isArray(j.rows) ? j.rows : [];
    const maxCols = rows.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0);

    // --- Распознавание структуры ---
    // 1) Ищем строку-заголовок таблицы: ячейки совпадают с «№»/«Кол-во»/«Цена»/«Сумма» (или содержат эти слова).
    //    Эталон smeta-template.xlsx: row 36 = ["№","Статья затрат","Кол-во","Ед.","Цена/ставка, ₽","Сумма, ₽"].
    let hdrRow = -1, colNum = -1, colName = -1, colQty = -1, colUnit = -1, colPrice = -1, colSum = -1;
    const lc = s => String(s == null ? '' : s).toLowerCase().trim();
    for (let ri = 0; ri < rows.length && ri < 80; ri++) {
      const r = rows[ri] || [];
      let qty = -1, price = -1, sum = -1, num = -1, name = -1, unit = -1;
      for (let ci = 0; ci < r.length; ci++) {
        const s = lc(r[ci]);
        if (!s) continue;
        if (qty < 0 && (s === 'кол-во' || s === 'кол.' || s.startsWith('кол-во') || s === 'qty' || s === 'количество')) qty = ci;
        else if (price < 0 && (s.startsWith('цена') || s.startsWith('ставка') || s.includes('цена/ставка') || s === 'price' || s.includes('цена,') || s.startsWith('цена '))) price = ci;
        else if (sum < 0 && (s.startsWith('сумма') || s === 'sum' || s === 'итого' || s.includes('сумма,'))) sum = ci;
        else if (num < 0 && (s === '№' || s === 'no' || s === 'п/п' || s === '#')) num = ci;
        else if (name < 0 && (s.includes('статья') || s.includes('наименование') || s.includes('позиция'))) name = ci;
        else if (unit < 0 && (s === 'ед.' || s === 'ед' || s === 'ед. изм.' || s === 'unit' || s === 'ед.изм.')) unit = ci;
      }
      if (qty >= 0 && price >= 0 && sum >= 0) {
        hdrRow = ri; colQty = qty; colPrice = price; colSum = sum;
        colNum = num; colName = name; colUnit = unit;
        break;
      }
    }
    // Фоллбэк-эвристика: если заголовок не нашли, в каждой строке ищем 2 числовых поля + 3-е (сумма).
    const fallbackMode = hdrRow < 0;

    // 2) Определяем «итоговые» строки и большие итоги по тексту в любой ячейке.
    //    Возвращает ключ итога: 'ФОТ', 'Персонал', 'Текущие', 'Командировочные', 'Транспорт',
    //    'Материалы', 'direct', 'overhead', 'contingency', 'cost', 'markup', 'price_no_vat',
    //    'vat', 'price_with_vat', 'profit', или null если строка обычная.
    function _classifyTotal(row) {
      const joined = (Array.isArray(row) ? row : []).map(c => lc(c)).join(' | ');
      if (!joined) return null;
      // Большие итоги — сначала, т.к. префиксы могут пересечься.
      if (joined.includes('прибыль')) return 'profit';
      if (joined.includes('цена заказчику') || joined.includes('цена с ндс')) return 'price_with_vat';
      if (joined.includes('цена без ндс')) return 'price_no_vat';
      // НДС-строка ставки: "НДС 22%" / "НДС 20%". \b не работает с кириллицей — используем явные границы.
      if (/(^|[^а-яё])ндс(\s|$)/i.test(joined) && (joined.includes('22') || joined.includes('20') || joined.includes('%'))) return 'vat';
      if (joined.includes('наценка') && joined.includes('markup')) return 'markup';
      if (joined.includes('себестоимость')) return 'cost';
      if (joined.includes('непредвиденн')) return 'contingency';
      if (joined.includes('накладные')) return 'overhead';
      if (joined.includes('прямые затраты')) return 'direct';
      if (joined.includes('фот, итого')) return 'fot';
      if (joined.includes('налог') && joined.includes('фот')) return 'fot_tax';
      if (joined.includes('персонал, итого')) return 'section_persons';
      if (joined.includes('текущие расходы, итого')) return 'section_current';
      if (joined.includes('командировочные, итого')) return 'section_per_diem';
      if (joined.includes('транспорт, итого')) return 'section_transport';
      if (joined.includes('материалы') && joined.includes('итого')) return 'section_materials';
      return null;
    }

    // 3) Определяем «принадлежность строки разделу». Section header — короткая ячейка «A»/«B»/«C»/«D»/«E»
    //    в первой колонке; данные раздела — строки с кодом A1/A2/B1… в той же колонке.
    //    Возвращает букву раздела или null.
    function _sectionOf(row) {
      const c0 = String((row && row[0]) || '').trim();
      const c1 = String((row && row[1]) || '').trim();
      const m0 = c0.match(/^([A-EА-Е])(\d+)?$/i);
      if (m0) return m0[1].toUpperCase();
      const m1 = c1.match(/^([A-EА-Е])(\d+)?$/i);
      if (m1) return m1[1].toUpperCase();
      return null;
    }
    // Map английского/русского: A→A, А→A. Раздел A=персонал, B=текущие, C=командировочные, D=транспорт, E=материалы.
    const SECTION_TO_TOTAL = { A: 'fot', B: 'section_current', C: 'section_per_diem', D: 'section_transport', E: 'section_materials' };

    // 4) Парсинг числовых строк (часто с пробелами, запятыми, формулами C45*E45 — формулу не считаем).
    const _num = (v) => {
      if (v == null) return NaN;
      const s = String(v).replace(/\s+/g, '').replace(/,/g, '.').replace(/[^\d.\-]/g, '');
      if (!s) return NaN;
      const n = Number(s);
      return isNaN(n) ? NaN : n;
    };

    // 5) Помечаем каждый ряд метаданными для последующего binding.
    //    rowMeta[ri] = { section: 'A'|null, total: 'fot'|..., isData: bool }
    const rowMeta = rows.map((row, ri) => {
      if (ri <= hdrRow) return { meta: 'pre' };
      const tot = _classifyTotal(row);
      const sec = _sectionOf(row);
      return { meta: tot ? 'total' : (sec ? 'data' : 'other'), section: sec, total: tot };
    });

    // --- Сборка HTML ---
    let html = `
      <div style="margin-bottom:14px;padding:11px 13px;background:var(--gold-bg);border:1px solid var(--gold);border-radius:8px;font-size:12.5px;color:var(--t2);line-height:1.55">
        💡 Каждая ячейка редактируема. После правок: «⬇ Скачать с правками» — XLSX с твоими изменениями;
        «✉ Отправить Мимиру» — попросить ИИ пересчитать смету с учётом твоих замечаний.
        <b>Автопересчёт:</b> при правке Кол-во или Цены сумма строки и итоги разделов обновляются автоматически.
      </div>
      <div style="overflow:auto;max-height:55vh;border:1px solid var(--brd-m);border-radius:8px">
        <table class="pk3-smeta-edit-tbl" style="width:100%;border-collapse:collapse;font-size:12px;font-family:'JetBrains Mono',Consolas,monospace">
          <tbody>
    `;
    rows.forEach((row, ri) => {
      const m = rowMeta[ri] || {};
      const isTotal = m.meta === 'total';
      const rowAttrs = [
        `data-row-idx="${ri}"`,
        m.section ? `data-section="${m.section}"` : '',
        m.total ? `data-total="${m.total}"` : '',
        `data-meta="${m.meta || ''}"`
      ].filter(Boolean).join(' ');
      const rowStyle = isTotal ? 'background:var(--bg2);font-weight:600' : '';
      html += `<tr ${rowAttrs} style="${rowStyle}">`;
      for (let ci = 0; ci < maxCols; ci++) {
        const v = (row && row[ci] != null) ? String(row[ci]) : '';
        const isNum = v !== '' && !isNaN(Number(v.replace(/\s+/g, '').replace(',', '.')));
        // Определяем data-field для конкретной ячейки.
        let field = '';
        if (!fallbackMode && ri > hdrRow) {
          if (ci === colQty) field = 'qty';
          else if (ci === colPrice) field = 'price';
          else if (ci === colSum) field = 'sum';
        }
        // На total-строках клетка суммы — выходной агрегат (не редактируется автоматически, но юзер может).
        if (isTotal && ci === colSum) field = 'total_value';
        // Для строки «Налог / взносы на ФОТ», «Накладные», «Непредвиденные», «Наценка», «НДС» —
        // колонка price (колонка 4) хранит ставку (коэффициент). Помечаем как rate.
        if (isTotal && (m.total === 'fot_tax' || m.total === 'overhead' || m.total === 'contingency' || m.total === 'markup' || m.total === 'vat') && ci === colPrice) {
          field = 'rate';
        }
        const fieldAttr = field ? ` data-field="${field}"` : '';
        const align = (field === 'qty' || field === 'price' || field === 'sum' || field === 'total_value' || field === 'rate' || isNum) ? 'text-align:right' : '';
        html += `<td style="padding:0;border:1px solid var(--brd-m)"><input type="text" data-row="${ri}" data-col="${ci}"${fieldAttr} value="${esc(v)}" style="width:100%;border:0;padding:5px 7px;background:transparent;color:var(--t1);font:inherit;${align}"></td>`;
      }
      html += '</tr>';
    });
    html += `
          </tbody>
        </table>
      </div>
      <h4 style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin:18px 0 8px">💬 Замечания Мимиру</h4>
      <textarea id="pk3-doc-edit-feedback" rows="4" placeholder="Например: «пересчитай маржу на 25%, бригаду уменьши до 9 человек, добавь логистику на 80 тыс»" style="width:100%;padding:9px 11px;background:var(--bg2);border:1px solid var(--brd);border-radius:8px;color:var(--t1);font-size:13px;font-family:inherit;resize:vertical"></textarea>
    `;
    // Кэшируем мета на таблице (читаем в _bindSmetaEditable).
    setTimeout(() => {
      const tbl = document.querySelector('.pk3-smeta-edit-tbl');
      if (tbl) {
        tbl.__cols = { num: colNum, name: colName, qty: colQty, unit: colUnit, price: colPrice, sum: colSum };
        tbl.__fallback = fallbackMode;
      }
    }, 0);
    return html;
  }

  // Авто-пересчёт сметы при правке qty/price.
  //   1. sum строки = qty × price
  //   2. итог раздела (data-total=fot/section_*) = Σ sum всех строк с тем же data-section
  //   3. fot_tax = ФОТ × rate;  section_persons = ФОТ + tax
  //   4. direct = Σ section_persons + section_current + section_per_diem + section_transport + section_materials
  //   5. overhead = direct × rate;  contingency = direct × rate
  //   6. cost = direct + overhead + contingency
  //   7. price_no_vat = cost × markup;  vat = price_no_vat × vat_rate;
  //      price_with_vat = price_no_vat + vat;  profit = price_no_vat − cost
  // Если структура не распозналась (fallback) — для каждой строки с 2 числовыми
  // полями подряд считаем 3-е поле как их произведение.
  function _bindSmetaEditable(body) {
    if (!body) return;
    const tbl = body.querySelector('.pk3-smeta-edit-tbl');
    if (!tbl) return;
    const cols = tbl.__cols || {};
    const fallback = !!tbl.__fallback;

    const _num = (v) => {
      if (v == null) return NaN;
      const s = String(v).replace(/\s+/g, '').replace(/,/g, '.').replace(/[^\d.\-]/g, '');
      if (!s || s === '-' || s === '.') return NaN;
      const n = Number(s);
      return isNaN(n) ? NaN : n;
    };
    const _fmt = (n) => {
      if (!isFinite(n)) return '';
      // Сохраняем 2 знака для дробных, целые без точки.
      if (Math.abs(n - Math.round(n)) < 0.005) return String(Math.round(n));
      return String(Math.round(n * 100) / 100);
    };
    const _set = (input, val) => {
      if (!input) return;
      const cur = input.value;
      const next = _fmt(val);
      if (cur !== next) input.value = next;
    };

    function recalcRowSum(tr) {
      if (fallback) {
        // Эвристика: ищем 2 первых числовых input'а в строке, 3-й = произведение.
        const inputs = tr.querySelectorAll('input[data-col]');
        let nums = [];
        inputs.forEach(inp => {
          const n = _num(inp.value);
          if (isFinite(n)) nums.push({ inp, n });
        });
        if (nums.length >= 3) {
          const prod = nums[0].n * nums[1].n;
          if (isFinite(prod)) _set(nums[2].inp, prod);
        }
        return;
      }
      const qtyInp = tr.querySelector('input[data-field="qty"]');
      const priceInp = tr.querySelector('input[data-field="price"]');
      const sumInp = tr.querySelector('input[data-field="sum"]');
      if (!qtyInp || !priceInp || !sumInp) return;
      const q = _num(qtyInp.value);
      const p = _num(priceInp.value);
      if (isFinite(q) && isFinite(p)) _set(sumInp, q * p);
    }

    function sumSection(section) {
      const rows = tbl.querySelectorAll(`tr[data-section="${section}"][data-meta="data"]`);
      let total = 0, hadAny = false;
      rows.forEach(tr => {
        const sumInp = tr.querySelector('input[data-field="sum"]');
        if (sumInp) {
          const n = _num(sumInp.value);
          if (isFinite(n)) { total += n; hadAny = true; }
        }
      });
      return hadAny ? total : NaN;
    }

    function getTotalRowValue(totalKey) {
      const tr = tbl.querySelector(`tr[data-total="${totalKey}"]`);
      if (!tr) return NaN;
      const inp = tr.querySelector('input[data-field="total_value"]');
      return inp ? _num(inp.value) : NaN;
    }
    // Обновляем ВСЕ строки с одинаковым data-total (одна и та же сумма может
    // встречаться в разделах «Калькуляция» и «Цена для заказчика»).
    function setTotalRowValue(totalKey, val) {
      if (!isFinite(val)) return;
      tbl.querySelectorAll(`tr[data-total="${totalKey}"]`).forEach(tr => {
        const inp = tr.querySelector('input[data-field="total_value"]');
        if (inp) _set(inp, val);
      });
    }
    function getRate(totalKey) {
      const tr = tbl.querySelector(`tr[data-total="${totalKey}"]`);
      if (!tr) return NaN;
      const inp = tr.querySelector('input[data-field="rate"]');
      return inp ? _num(inp.value) : NaN;
    }

    function recalcAllTotals() {
      // По разделам
      const fot = sumSection('A');        // A: персонал — суммы строк A1..AN
      const sectB = sumSection('B');
      const sectC = sumSection('C');
      const sectD = sumSection('D');
      const sectE = sumSection('E');

      if (isFinite(fot)) setTotalRowValue('fot', fot);

      // Налог на ФОТ
      const fotTaxRate = getRate('fot_tax');
      let fotTax = NaN;
      if (isFinite(fot) && isFinite(fotTaxRate)) {
        fotTax = fot * fotTaxRate;
        setTotalRowValue('fot_tax', fotTax);
      } else {
        fotTax = getTotalRowValue('fot_tax');
      }

      // Персонал, итого = ФОТ + налог
      let persons = NaN;
      if (isFinite(fot) && isFinite(fotTax)) {
        persons = fot + fotTax;
        setTotalRowValue('section_persons', persons);
      } else {
        persons = getTotalRowValue('section_persons');
      }

      if (isFinite(sectB)) setTotalRowValue('section_current', sectB);
      if (isFinite(sectC)) setTotalRowValue('section_per_diem', sectC);
      if (isFinite(sectD)) setTotalRowValue('section_transport', sectD);
      if (isFinite(sectE)) setTotalRowValue('section_materials', sectE);

      // Прямые затраты = сумма разделов
      const parts = [persons, sectB, sectC, sectD, sectE].filter(x => isFinite(x));
      let direct = NaN;
      if (parts.length) {
        direct = parts.reduce((a, b) => a + b, 0);
        setTotalRowValue('direct', direct);
      } else {
        direct = getTotalRowValue('direct');
      }

      // Накладные, непредвиденные — ставки от direct
      const ovhRate = getRate('overhead');
      const cntRate = getRate('contingency');
      let overhead = getTotalRowValue('overhead');
      let contingency = getTotalRowValue('contingency');
      if (isFinite(direct) && isFinite(ovhRate)) {
        overhead = direct * ovhRate;
        setTotalRowValue('overhead', overhead);
      }
      if (isFinite(direct) && isFinite(cntRate)) {
        contingency = direct * cntRate;
        setTotalRowValue('contingency', contingency);
      }

      // Себестоимость
      let cost = NaN;
      if (isFinite(direct)) {
        cost = direct + (isFinite(overhead) ? overhead : 0) + (isFinite(contingency) ? contingency : 0);
        setTotalRowValue('cost', cost);
      } else {
        cost = getTotalRowValue('cost');
      }

      // Цена для заказчика
      const markup = getRate('markup');
      let priceNoVat = NaN;
      if (isFinite(cost) && isFinite(markup)) {
        priceNoVat = cost * markup;
        setTotalRowValue('price_no_vat', priceNoVat);
      } else {
        priceNoVat = getTotalRowValue('price_no_vat');
      }

      const vatRate = getRate('vat');
      let vat = NaN;
      if (isFinite(priceNoVat) && isFinite(vatRate)) {
        vat = priceNoVat * vatRate;
        setTotalRowValue('vat', vat);
      } else {
        vat = getTotalRowValue('vat');
      }

      if (isFinite(priceNoVat) && isFinite(vat)) {
        setTotalRowValue('price_with_vat', priceNoVat + vat);
      }

      if (isFinite(priceNoVat) && isFinite(cost)) {
        setTotalRowValue('profit', priceNoVat - cost);
      }
    }

    // Реагируем на input по qty/price/sum/rate (rate→каскад).
    body.addEventListener('input', (e) => {
      const t = e.target;
      if (!t || !t.matches('input[data-field]')) return;
      const fld = t.dataset.field;
      if (fld === 'qty' || fld === 'price' || fld === 'sum' || fld === 'rate' || fld === 'total_value') {
        const tr = t.closest('tr[data-row-idx]');
        if (tr && (fld === 'qty' || fld === 'price')) recalcRowSum(tr);
        recalcAllTotals();
      }
    });
    // Если включён fallback-режим — пробегаем все строки и считаем 3-е поле.
    if (fallback) {
      tbl.querySelectorAll('tr[data-row-idx]').forEach(tr => recalcRowSum(tr));
    } else {
      // Первичный пересчёт — пользователь видит, что система работает.
      recalcAllTotals();
    }
  }

  // Рендер редактируемого отчёта директору: JSON {type:'director_report', data:{...}}.
  // Каждое поле — textarea/input. Списки warnings/decisions — добавляемые.
  function _renderReportEditable(j) {
    const d = j.data || {};
    const v = (k, def) => esc(d[k] != null ? String(d[k]) : (def || ''));
    const warnings = Array.isArray(d.warnings) ? d.warnings : [];
    const decisions = Array.isArray(d.decisions) ? d.decisions : [];
    const rowsHtml = (arr, kind) => arr.map((it, i) => `
      <div class="pk3-rep-listrow" data-kind="${kind}" data-i="${i}" style="display:flex;gap:7px;margin-bottom:6px">
        <input type="text" data-field="title" value="${esc(it.title || it.kind || '')}" placeholder="Заголовок" style="flex:0 0 200px;padding:6px 9px;background:var(--bg2);border:1px solid var(--brd);border-radius:6px;color:var(--t1);font-size:12.5px">
        <textarea data-field="text" rows="2" placeholder="Текст" style="flex:1;padding:6px 9px;background:var(--bg2);border:1px solid var(--brd);border-radius:6px;color:var(--t1);font-size:12.5px;resize:vertical">${esc(it.text || it.message || '')}</textarea>
        <button class="pk3-btn pk3-ghost pk3-sm" data-act="rm-listrow" title="Удалить">✕</button>
      </div>
    `).join('');

    const html = `
      <div style="margin-bottom:14px;padding:11px 13px;background:var(--gold-bg);border:1px solid var(--gold);border-radius:8px;font-size:12.5px;color:var(--t2);line-height:1.55">
        💡 Правь любые поля. Кнопка «⬇ Скачать с правками» соберёт новый DOCX и обновит карту.
        «✉ Отправить Мимиру» — отдать твои замечания ИИ, чтобы он переписал отчёт целиком.
      </div>

      <h4 style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin:14px 0 8px">Заголовок</h4>
      <div class="pk3-row"><label>Тема</label><input data-field="project_subject" type="text" value="${v('project_subject')}"></div>
      <div class="pk3-row"><label>Заказчик</label><input data-field="customer_name" type="text" value="${v('customer_name')}"></div>
      <div class="pk3-row"><label>Адрес заказчика</label><input data-field="customer_address" type="text" value="${v('customer_address')}"></div>
      <div class="pk3-row"><label>Объект</label><input data-field="project_object" type="text" value="${v('project_object')}"></div>

      <h4 style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin:14px 0 8px">Резюме</h4>
      <div class="pk3-row" style="flex-direction:column;align-items:stretch"><label>Текст резюме</label>
        <textarea data-field="summary_paragraph" rows="5" style="width:100%;padding:8px 10px;background:var(--bg2);border:1px solid var(--brd);border-radius:8px;color:var(--t1);font-size:12.5px;font-family:inherit;resize:vertical">${v('summary_paragraph')}</textarea>
      </div>

      <h4 style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin:14px 0 8px">Параметры</h4>
      <div class="pk3-row"><label>Бригада, чел</label><input data-field="crew_size" type="text" value="${v('crew_size')}"></div>
      <div class="pk3-row"><label>Срок</label><input data-field="deadline_str" type="text" value="${v('deadline_str')}"></div>

      <h4 style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin:14px 0 8px">Экономика</h4>
      <div class="pk3-row"><label>Себестоимость без НДС</label><input data-field="cost_no_vat" type="text" value="${v('cost_no_vat')}"></div>
      <div class="pk3-row"><label>Цена (станд. НДС)</label><input data-field="price_standard_vat" type="text" value="${v('price_standard_vat')}"></div>
      <div class="pk3-row"><label>Цена (раздельная)</label><input data-field="price_separate_vat" type="text" value="${v('price_separate_vat')}"></div>

      <h4 style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin:14px 0 8px">Замечания (warnings)</h4>
      <div id="pk3-rep-warnings">${rowsHtml(warnings, 'warning')}</div>
      <button class="pk3-btn pk3-ghost pk3-sm" data-act="add-listrow" data-kind="warning">＋ Добавить замечание</button>

      <h4 style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin:14px 0 8px">Решения (decisions)</h4>
      <div id="pk3-rep-decisions">${rowsHtml(decisions.map(x => typeof x === 'string' ? { text: x } : x), 'decision')}</div>
      <button class="pk3-btn pk3-ghost pk3-sm" data-act="add-listrow" data-kind="decision">＋ Добавить решение</button>

      <h4 style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin:18px 0 8px">Подпись</h4>
      <div class="pk3-row"><label>Автор</label><input data-field="author_name" type="text" value="${v('author_name')}"></div>
      <div class="pk3-row"><label>Должность</label><input data-field="author_position" type="text" value="${v('author_position')}"></div>

      <h4 style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin:18px 0 8px">💬 Замечания Мимиру</h4>
      <textarea id="pk3-doc-edit-feedback" rows="4" placeholder="Например: «перепиши резюме покороче, добавь риск по реагенту, маржу подними до 30%»" style="width:100%;padding:9px 11px;background:var(--bg2);border:1px solid var(--brd);border-radius:8px;color:var(--t1);font-size:13px;font-family:inherit;resize:vertical"></textarea>
    `;
    // События для add/remove строк — навешиваем сразу после вставки в DOM.
    setTimeout(() => {
      const root = document.getElementById('pk3-doc-edit-body');
      if (!root) return;
      root.addEventListener('click', (e) => {
        const addBtn = e.target.closest('[data-act="add-listrow"]');
        if (addBtn) {
          const kind = addBtn.dataset.kind;
          const container = document.getElementById(kind === 'warning' ? 'pk3-rep-warnings' : 'pk3-rep-decisions');
          if (!container) return;
          const i = container.children.length;
          const div = document.createElement('div');
          div.className = 'pk3-rep-listrow';
          div.dataset.kind = kind; div.dataset.i = String(i);
          div.style.cssText = 'display:flex;gap:7px;margin-bottom:6px';
          div.innerHTML = `
            <input type="text" data-field="title" placeholder="Заголовок" style="flex:0 0 200px;padding:6px 9px;background:var(--bg2);border:1px solid var(--brd);border-radius:6px;color:var(--t1);font-size:12.5px">
            <textarea data-field="text" rows="2" placeholder="Текст" style="flex:1;padding:6px 9px;background:var(--bg2);border:1px solid var(--brd);border-radius:6px;color:var(--t1);font-size:12.5px;resize:vertical"></textarea>
            <button class="pk3-btn pk3-ghost pk3-sm" data-act="rm-listrow" title="Удалить">✕</button>
          `;
          container.appendChild(div);
          return;
        }
        const rmBtn = e.target.closest('[data-act="rm-listrow"]');
        if (rmBtn) {
          const row = rmBtn.closest('.pk3-rep-listrow');
          if (row) row.remove();
        }
      });
    }, 30);
    return html;
  }

  // Собрать правки в JSON для backend'а.
  // smeta → {rows:[[col1,col2,...],...]}
  // director_report → {data:{project_subject, customer_name, ..., warnings:[{title,text}], decisions:[{text}]}}
  function _collectDocEdits(body, kind) {
    if (kind === 'smeta') {
      const inputs = body.querySelectorAll('.pk3-smeta-edit-tbl input[data-row]');
      const matrix = {};
      let maxCol = 0;
      inputs.forEach(inp => {
        const r = Number(inp.dataset.row), c = Number(inp.dataset.col);
        if (!Number.isFinite(r) || !Number.isFinite(c)) return;
        matrix[r] = matrix[r] || [];
        matrix[r][c] = inp.value;
        if (c > maxCol) maxCol = c;
      });
      const rows = [];
      const keys = Object.keys(matrix).map(Number).sort((a, b) => a - b);
      keys.forEach(r => {
        const row = matrix[r];
        // нормализуем длину до maxCol+1
        for (let c = 0; c <= maxCol; c++) if (row[c] == null) row[c] = '';
        rows.push(row);
      });
      return { rows };
    }
    if (kind === 'director_report') {
      const data = {};
      body.querySelectorAll('input[data-field], textarea[data-field]').forEach(inp => {
        if (inp.closest('.pk3-rep-listrow')) return; // listrow собираем отдельно
        if (inp.id === 'pk3-doc-edit-feedback') return; // это поле для AI, не для DOCX
        data[inp.dataset.field] = inp.value;
      });
      const collectList = (containerId) => {
        const c = document.getElementById(containerId);
        if (!c) return [];
        return Array.from(c.querySelectorAll('.pk3-rep-listrow')).map(row => ({
          title: (row.querySelector('[data-field="title"]') || {}).value || '',
          text:  (row.querySelector('[data-field="text"]')  || {}).value || ''
        })).filter(x => x.title || x.text);
      };
      data.warnings = collectList('pk3-rep-warnings');
      data.decisions = collectList('pk3-rep-decisions').map(x => ({ text: (x.title ? x.title + ': ' : '') + x.text }));
      return { data };
    }
    return null;
  }

  // Отправить замечания обратно Мимиру.
  // Приоритет: (1) card._conductorRun → POST /api/mimir/conductor/run/:id/recompute-with-feedback
  //            (2) card._quickSession → POST /api/tkp-quick/sessions/:uid/chat (SSE)
  //            (3) фоллбэк: ищем активную Quick-сессию по pre_tender_id (GET /sessions?…)
  // Возвращает true если запрос принят, false если ни одного канала.
  async function _sendFeedbackToMimir(card, feedback) {
    const headers = await _authHeaders();
    // (1) Conductor
    if (card._conductorRun) {
      try {
        const res = await fetch(`/api/mimir/conductor/run/${card._conductorRun}/recompute-with-feedback`, {
          method: 'POST', headers, body: JSON.stringify({ feedback_text: feedback })
        });
        if (res.ok) return true;
      } catch (_) {}
    }
    // (2) Quick
    if (card._quickSession) {
      try {
        // chat — SSE; нам не нужен ответ, просто запустить. fetch получит stream — закроем сразу.
        const res = await fetch(`/api/tkp-quick/sessions/${card._quickSession}/chat`, {
          method: 'POST', headers, body: JSON.stringify({ message: feedback })
        });
        if (res.ok) {
          // отпускаем стрим — AI продолжит фоновую запись в БД.
          try { res.body && res.body.cancel && res.body.cancel(); } catch (_) {}
          return true;
        }
      } catch (_) {}
    }
    // (3) Фоллбэк: попробуем найти открытую Quick-сессию по pre_tender_id.
    try {
      const ptId = card.entity_id;
      if (ptId) {
        const res = await fetch(`/api/tkp-quick/sessions?pre_tender_id=${ptId}`, { headers });
        if (res.ok) {
          const j = await res.json().catch(() => ({}));
          const sess = (j && (j.session || (Array.isArray(j.sessions) && j.sessions[0]) || (Array.isArray(j) && j[0]))) || null;
          const uid = sess && (sess.session_uid || sess.uid);
          if (uid) {
            const r2 = await fetch(`/api/tkp-quick/sessions/${uid}/chat`, {
              method: 'POST', headers, body: JSON.stringify({ message: feedback })
            });
            if (r2.ok) {
              card._quickSession = uid;
              try { r2.body && r2.body.cancel && r2.body.cancel(); } catch (_) {}
              return true;
            }
          }
        }
      }
    } catch (_) {}
    return false;
  }

  // Открыть file-picker и загрузить документ в pre_tender (раздел «📤 Загружено РП»).
  function _openDocUploadPicker(card) {
    const ptId = card.entity_id;
    if (!ptId) { toast('Нет привязки', 'Открой pre-tender', 'warn'); return; }
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true;
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const files = Array.from(input.files || []);
      input.remove();
      if (!files.length) return;
      const fd = new FormData();
      files.forEach(f => fd.append('files', f, f.name));
      const headers = await _authHeaders();
      try {
        const res = await fetch(`/api/pre-tenders/${ptId}/upload-docs`, {
          method: 'POST', headers, body: fd
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          toast('Загружено', `${files.length} файл(ов) сохранено`, 'ok');
          // Релоад drawer, чтобы появились в списке.
          _reopenCurrentCard();
        } else {
          toast('Не загрузилось', data.error || ('HTTP ' + res.status), 'err');
        }
      } catch (e) {
        toast('Сеть упала', String(e.message || e), 'err');
      }
    });
    document.body.appendChild(input);
    input.click();
  }
  async function _reopenCurrentCard() {
    if (!_currentCard) return;
    try {
      const r = await api(`/api/personal-kanban/board?flow_filter=all`);
      if (!r.ok || !r.data || !r.data.columns) return;
      // Найти карту с тем же id в обновлённом board.
      const all = Object.values(r.data.columns).flat();
      const fresh = all.find(c => c.id === _currentCard.id);
      if (fresh) _openDrawer(fresh);
    } catch (_) {}
  }

  // Поиск контрагента по ИНН через /api/customers/lookup/:inn.
  // Автозаполняет customer_name / email / телефон. Используется data-action="egrul-lookup".
  async function _doEgrulLookup() {
    const innEl = $('#pk3-f-inn');
    const inn = innEl ? (innEl.value || '').trim() : '';
    if (!inn || inn.length < 10) { toast('Введи ИНН', 'Минимум 10 цифр', 'warn'); return; }
    const btn = $('#pk3-egrul');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Ищу…'; }
    try {
      const r = await api('/api/customers/lookup/' + encodeURIComponent(inn));
      // Реальный формат /api/customers/lookup/:inn (src/routes/customers.js:53):
      //   { found: true|false, suggestion: {inn, name, full_name, kpp, ogrn, address}, message? }
      // Раньше парсили r.data.name → всегда «не найдено».
      const data = (r.ok && r.data) || {};
      const sug  = data.suggestion || {};
      if (data.found === false && data.message) {
        toast('Не найдено', data.message, 'warn'); return;
      }
      const name  = sug.name || sug.full_name || data.name || '';
      const email = sug.email || '';
      const phone = sug.phone || '';
      const kpp   = sug.kpp || '';
      const addr  = sug.address || '';
      if (!name) { toast('Не найдено', 'Заполни вручную', 'warn'); return; }
      const setIfEmpty = (sel, val) => {
        const el = $(sel); if (!el) return;
        if (!el.value.trim() && val) el.value = val;
      };
      $('#pk3-f-customer').value = name; // имя — перезаписываем всегда
      setIfEmpty('#pk3-f-email', email);
      setIfEmpty('#pk3-f-phone', phone);
      setIfEmpty('#pk3-f-city', addr);
      toast('Найдено', kpp ? `${name} (КПП ${kpp})` : name, 'ok');
    } catch (_) {
      toast('egrul недоступен', 'Заполни вручную', 'warn');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🔎 egrul'; }
    }
  }
  // 22.06.2026: модалка загрузки готового ТКП (Word/PDF/Excel) для карты заявки/тендера
  function _openTkpUploadModal(card) {
    const existed = document.querySelector('.pk3-tkp-upload-modal');
    if (existed) existed.remove();
    const customerName = card.customer || card.customer_name || card.source_name || '';
    const ptId = (card.entity_kind === 'pre_tender' || card.flow_type === 'pre_tender') ? card.entity_id : '';
    const tdId = (card.entity_kind === 'tender' || card.flow_type === 'tender') ? card.entity_id : '';
    const linkType = ptId ? 'direct_request' : (tdId ? 'tender' : 'standalone');
    const m = document.createElement('div');
    m.className = 'pk3-tkp-upload-modal';
    m.style.cssText = 'position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.65);backdrop-filter:blur(4px)';
    m.innerHTML = `
      <div style="background:var(--bg2);border:1px solid var(--brd);border-radius:14px;padding:20px 22px;width:min(560px,92vw);box-shadow:0 16px 48px rgba(0,0,0,.6);max-height:90vh;overflow-y:auto">
        <h3 style="margin:0 0 14px;font-family:'Cinzel',Georgia,serif;font-size:17px;color:var(--t1);display:flex;align-items:center;gap:8px">
          📥 Загрузить готовый ТКП
        </h3>
        <div style="display:flex;flex-direction:column;gap:10px">
          <label style="font-size:12px;color:var(--t2)">Тема ТКП <span style="color:var(--err-t)">*</span>
            <input id="pk3-tkp-up-subj" type="text" maxlength="500" placeholder="например, ТКП на гидромеханическую очистку деаэратора"
              style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid var(--brd-m);border-radius:7px;background:var(--bg1);color:var(--t1);font-size:13px;outline:none" />
          </label>
          <div style="display:flex;gap:10px">
            <label style="flex:1;font-size:12px;color:var(--t2)">Сумма ТКП (₽, без НДС)
              <input id="pk3-tkp-up-sum" type="number" min="0" step="0.01" placeholder="2 739 175"
                style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid var(--brd-m);border-radius:7px;background:var(--bg1);color:var(--t1);font-size:13px;outline:none" />
            </label>
            <label style="flex:0 0 130px;font-size:12px;color:var(--t2)">НДС, %
              <input id="pk3-tkp-up-vat" type="number" min="0" max="50" value="20"
                style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid var(--brd-m);border-radius:7px;background:var(--bg1);color:var(--t1);font-size:13px;outline:none" />
            </label>
          </div>
          <label style="font-size:12px;color:var(--t2)">Срок действия (дн.)
            <input id="pk3-tkp-up-validity" type="number" min="1" max="365" value="30"
              style="width:160px;margin-top:4px;padding:8px 10px;border:1px solid var(--brd-m);border-radius:7px;background:var(--bg1);color:var(--t1);font-size:13px;outline:none" />
          </label>
          <label style="font-size:12px;color:var(--t2)">Файл ТКП (Word/PDF/Excel) <span style="color:var(--err-t)">*</span>
            <input id="pk3-tkp-up-file" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              style="display:block;width:100%;margin-top:4px;padding:8px;border:1px dashed var(--brd-m);border-radius:7px;background:var(--bg1);color:var(--t1);font-size:13px" />
          </label>
          <div style="font-size:11px;color:var(--t3)">Заказчик: <b>${esc(customerName || '—')}</b> · ${esc(linkType)}${ptId ? ` #${ptId}` : (tdId ? ` #${tdId}` : '')}</div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
          <button class="pk3-btn pk3-ghost" data-act="cancel">Отмена</button>
          <button class="pk3-btn pk3-gold" data-act="submit">📥 Загрузить</button>
        </div>
      </div>
    `;
    document.body.appendChild(m);
    setTimeout(() => m.querySelector('#pk3-tkp-up-subj').focus(), 30);
    const close = () => { try { m.remove(); } catch (_) {} };
    const submit = async () => {
      const subj = m.querySelector('#pk3-tkp-up-subj').value.trim();
      const file = m.querySelector('#pk3-tkp-up-file').files[0];
      const sum  = m.querySelector('#pk3-tkp-up-sum').value;
      const vat  = m.querySelector('#pk3-tkp-up-vat').value;
      const validity = m.querySelector('#pk3-tkp-up-validity').value;
      if (!subj) { toast('Не хватает', 'Тема ТКП обязательна', 'warn'); return; }
      if (!file) { toast('Не хватает', 'Выберите файл', 'warn'); return; }
      const btn = m.querySelector('[data-act="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Загружаю…'; }
      const fd = new FormData();
      fd.append('subject', subj);
      if (customerName) fd.append('customer_name', customerName);
      if (ptId) fd.append('pre_tender_id', String(ptId));
      if (tdId) fd.append('tender_id', String(tdId));
      fd.append('link_type', linkType);
      if (sum) fd.append('total_sum', String(sum));
      if (vat) fd.append('vat_pct', String(vat));
      if (validity) fd.append('validity_days', String(validity));
      fd.append('file', file);
      try {
        const token = (() => { try { return localStorage.getItem('asgard_token'); } catch (_) { return ''; } })();
        const res = await fetch('/api/tkp/upload-ready', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token },
          body: fd
        });
        if (!res.ok) {
          let err = `HTTP ${res.status}`;
          try { const j = await res.json(); err = j.error || j.message || err; } catch (_) {}
          toast('Не загрузилось', err, 'err');
          if (btn) { btn.disabled = false; btn.textContent = '📥 Загрузить'; }
          return;
        }
        toast('Готово', 'ТКП загружено и привязано к карте', 'ok');
        close();
        await _loadAndRenderTkpList(card);
      } catch (e) {
        toast('Не загрузилось', String(e.message || e), 'err');
        if (btn) { btn.disabled = false; btn.textContent = '📥 Загрузить'; }
      }
    };
    m.addEventListener('click', (e) => {
      if (e.target === m) close();
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'cancel') close();
      if (act === 'submit') submit();
    });
    document.addEventListener('keydown', function escH(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escH); }
    });
  }

  // 22.06.2026: кнопка «📝 Заметка» добавляет НА ДОСКУ слева новый пустой стикер
  // в режиме редактирования. Юзер пишет прямо в стикере → 💾 сохранить или 🗑 удалить.
  // Никаких модалок поверх drawer'а.
  function _addNote(card) {
    const list = document.getElementById('pk3-stk-list');
    if (!list) {
      toast('Доска заметок недоступна', 'Узкий экран. Расширьте окно.', 'warn');
      return;
    }
    // Если уже есть открытый пустой edit-стикер — фокусим его, не плодим
    const existing = list.querySelector('.pk3-sticker.pk3-edit[data-new="1"]');
    if (existing) { const ta = existing.querySelector('textarea'); if (ta) ta.focus(); return; }
    // Снимаем плейсхолдер если был
    const empty = list.querySelector('.pk3-stk-list-empty');
    if (empty) empty.remove();
    // Вставляем НОВЫЙ пустой стикер в начало — inline-стили на жёлтом фоне как реальный post-it
    const stk = document.createElement('div');
    stk.setAttribute('data-new', '1');
    stk.setAttribute('data-pk3-sticker-edit', '1');
    // Случайная позиция для нового стикера
    const px = Math.floor(Math.random()*120);
    const py = Math.floor(Math.random()*150);
    const cv = Math.floor(Math.random()*5);
    stk.dataset.colorVariant = String(cv);
    const colors = ['#fff782', '#ffc7a8', '#bcebbc', '#ffc4d8', '#b9deff'];
    const bg = colors[cv];
    stk.style.cssText = `position:absolute;left:${px}px;top:${py}px;width:200px;height:200px;box-sizing:border-box;padding:18px 14px 12px;display:flex;flex-direction:column;background:${bg};color:#2a1f08;transform:rotate(0deg);z-index:99999;font-family:Kalam,Caveat,"Permanent Marker","Comic Sans MS",cursive;font-size:17px;line-height:1.18;font-weight:400;box-shadow:1px 1px 1px rgba(255,255,255,.3) inset, -1px -1px 1px rgba(0,0,0,.05) inset, 8px 18px 30px -4px rgba(0,0,0,.5), 0 4px 10px rgba(0,0,0,.25);animation:pk3-sticker-pop .35s cubic-bezier(.34,1.56,.64,1)`;
    stk.innerHTML = `
      <div style="position:absolute;top:-8px;left:50%;width:72px;height:18px;background:linear-gradient(180deg,rgba(220,220,220,.65),rgba(160,160,160,.5));transform:translateX(-50%) rotate(-3deg);box-shadow:0 2px 4px rgba(0,0,0,.25);opacity:.85;border-left:1px solid rgba(255,255,255,.5);border-right:1px solid rgba(0,0,0,.1);pointer-events:none"></div>
      <textarea placeholder="Пиши…" maxlength="150" rows="4" style="flex:1;width:100%;border:none;outline:none;background:transparent;color:#2a1f08;font:inherit;resize:none;padding:0;font-family:inherit;box-sizing:border-box"></textarea>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-top:6px;padding-top:6px;border-top:1px dashed rgba(60,40,10,.2)">
        <span data-cnt style="font-size:11px;color:rgba(60,40,10,.5);font-family:var(--font-sans);font-style:italic">0/150</span>
        <div style="display:flex;gap:6px">
          <button data-act="cancel" style="font-family:'Kalam',cursive;font-size:13px;padding:4px 12px;border-radius:16px;cursor:pointer;border:1px solid rgba(60,40,10,.3);background:rgba(255,255,255,.55);color:#2a1f08;box-shadow:0 2px 4px rgba(0,0,0,.15);transition:all .15s ease" onmouseover="this.style.background='rgba(255,255,255,.85)';this.style.transform='translateY(-1px)'" onmouseout="this.style.background='rgba(255,255,255,.55)';this.style.transform=''">Отмена</button>
          <button data-act="save" style="font-family:'Kalam',cursive;font-size:13px;font-weight:600;padding:4px 14px;border-radius:16px;cursor:pointer;border:1px solid #b07814;background:linear-gradient(180deg,#ffd95e,#e8a93a);color:#2a1f08;box-shadow:0 3px 8px rgba(176,120,20,.35);transition:all .15s ease" onmouseover="this.style.transform='translateY(-1px)'" onmouseout="this.style.transform=''">💾</button>
        </div>
      </div>
    `;
    list.insertBefore(stk, list.firstChild);
    const ta = stk.querySelector('textarea');
    const cntEl = stk.querySelector('[data-cnt]');
    const onInput = () => {
      const len = ta.value.length;
      if (cntEl) {
        cntEl.textContent = `${len}/150`;
        cntEl.style.color = len > 135 ? '#b13030' : 'rgba(60,40,10,.5)';
      }
      ta.style.fontSize = _stkFontSize(len) + 'px';
    };
    ta.addEventListener('input', onInput);
    setTimeout(() => { ta.focus(); onInput(); }, 40);

    const cancel = () => { try { stk.remove(); } catch (_) {} _refreshNotesEmpty(); };
    const save = async () => {
      const text = (ta.value || '').trim();
      if (!text) { ta.focus(); return; }
      const btn = stk.querySelector('[data-act="save"]');
      if (btn) { btn.disabled = true; btn.textContent = '⏳…'; }
      try {
        const r = await api(`/api/personal-kanban/cards/${card.id}/notes`, {
          method: 'POST', body: { body: text }
        });
        if (!r.ok) {
          toast('Заметка', (r.data && (r.data.error || r.data.message)) || 'Не сохранилось', 'err');
          if (btn) { btn.disabled = false; btn.textContent = '💾 Сохранить'; }
          return;
        }
        const tmp = document.createElement('div');
        tmp.innerHTML = _renderNoteCard(r.data.item).trim();
        const newEl = tmp.firstChild;
        list.replaceChild(newEl, stk);
        _bindStickerDrag(newEl); // 22.06: drag-handler для свежего стикера
        _updateNotesCount();
      } catch (e) {
        toast('Заметка', String(e.message || e), 'err');
        if (btn) { btn.disabled = false; btn.textContent = '💾 Сохранить'; }
      }
    };
    stk.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'cancel') cancel();
      if (act === 'save') save();
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save(); }
    });
  }

  function _updateNotesCount() {
    const list = document.getElementById('pk3-stk-list');
    const cnt = document.getElementById('pk3-notes-count');
    if (!list || !cnt) return;
    cnt.textContent = String(list.querySelectorAll('.pk3-sticker:not(.pk3-edit)').length);
  }
  function _refreshNotesEmpty() {
    // 22.06.2026 v3: пустую доску оставляем пустой — без надписей
  }

  // Edit существующего стикера — превращаем pk3-sticker в pk3-sticker.pk3-edit
  function _startNoteEdit(noteEl, card) {
    if (noteEl.dataset.editing === '1') return;
    const noteId = noteEl.dataset.noteId;
    const bodyDivs = noteEl.querySelectorAll('div[style*="white-space:pre-wrap"]');
    const currentText = bodyDivs.length ? bodyDivs[0].innerText : (noteEl.textContent || '');
    noteEl.dataset.editing = '1';
    // выпрямляем поворот
    noteEl.style.transform = 'rotate(0)';
    noteEl.style.padding = '24px 16px 12px';
    noteEl.innerHTML = `
      <div style="position:absolute;top:-8px;left:50%;width:72px;height:18px;background:linear-gradient(180deg,rgba(220,220,220,.65),rgba(160,160,160,.5));transform:translateX(-50%) rotate(-3deg);box-shadow:0 2px 4px rgba(0,0,0,.25);opacity:.85;border-left:1px solid rgba(255,255,255,.5);border-right:1px solid rgba(0,0,0,.1);pointer-events:none"></div>
      <textarea maxlength="150" rows="4" style="flex:1;width:100%;border:none;outline:none;background:transparent;color:#2a1f08;font:inherit;resize:none;padding:0;font-family:inherit;box-sizing:border-box"></textarea>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-top:6px;padding-top:6px;border-top:1px dashed rgba(60,40,10,.2)">
        <span data-cnt style="font-size:11px;color:rgba(60,40,10,.5);font-family:var(--font-sans);font-style:italic">0/150</span>
        <div style="display:flex;gap:6px">
          <button data-act="cancel-edit" style="font-family:'Kalam',cursive;font-size:13px;padding:4px 12px;border-radius:16px;cursor:pointer;border:1px solid rgba(60,40,10,.3);background:rgba(255,255,255,.55);color:#2a1f08;box-shadow:0 2px 4px rgba(0,0,0,.15);transition:all .15s ease" onmouseover="this.style.background='rgba(255,255,255,.85)';this.style.transform='translateY(-1px)'" onmouseout="this.style.background='rgba(255,255,255,.55)';this.style.transform=''">Отмена</button>
          <button data-act="save-edit" style="font-family:'Kalam',cursive;font-size:13px;font-weight:600;padding:4px 14px;border-radius:16px;cursor:pointer;border:1px solid #b07814;background:linear-gradient(180deg,#ffd95e,#e8a93a);color:#2a1f08;box-shadow:0 3px 8px rgba(176,120,20,.35);transition:all .15s ease" onmouseover="this.style.transform='translateY(-1px)'" onmouseout="this.style.transform=''">💾</button>
        </div>
      </div>
    `;
    const ta = noteEl.querySelector('textarea');
    ta.value = currentText;
    const cntEl = noteEl.querySelector('[data-cnt]');
    const onInputEdit = () => {
      const len = ta.value.length;
      if (cntEl) {
        cntEl.textContent = `${len}/150`;
        cntEl.style.color = len > 135 ? '#b13030' : 'rgba(60,40,10,.5)';
      }
      ta.style.fontSize = _stkFontSize(len) + 'px';
    };
    ta.addEventListener('input', onInputEdit);
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); onInputEdit(); }, 40);

    const cancel = async () => { await _loadAndRenderNotes(card); };
    const save = async () => {
      const text = (ta.value || '').trim();
      if (!text) { ta.focus(); return; }
      const btn = noteEl.querySelector('[data-act="save-edit"]');
      if (btn) { btn.disabled = true; btn.textContent = '⏳…'; }
      try {
        const r = await api(`/api/personal-kanban/cards/${card.id}/notes/${noteId}`, {
          method: 'PUT', body: { body: text }
        });
        if (!r.ok) {
          toast('Заметка', (r.data && (r.data.error || r.data.message)) || 'Не сохранилось', 'err');
          if (btn) { btn.disabled = false; btn.textContent = '💾 Сохранить'; }
          return;
        }
        const tmp = document.createElement('div');
        tmp.innerHTML = _renderNoteCard(r.data.item).trim();
        const newEl = tmp.firstChild;
        noteEl.parentNode.replaceChild(newEl, noteEl);
        _bindStickerDrag(newEl); // 22.06: drag-handler после редактирования
      } catch (e) {
        toast('Заметка', String(e.message || e), 'err');
        if (btn) { btn.disabled = false; btn.textContent = '💾 Сохранить'; }
      }
    };
    noteEl.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'cancel-edit') cancel();
      if (act === 'save-edit') save();
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save(); }
    });
  }

  async function _deleteNote(noteEl, card) {
    const noteId = noteEl.dataset.noteId;
    if (!noteId || !window.confirm('Удалить заметку?')) return;
    try {
      const r = await api(`/api/personal-kanban/cards/${card.id}/notes/${noteId}`, { method: 'DELETE' });
      if (!r.ok) { toast('Заметка', 'Не удалилось', 'err'); return; }
      // Анимация падения и удаление
      noteEl.style.transition = 'transform .3s ease, opacity .3s ease';
      noteEl.style.transform = 'rotate(8deg) translateY(40px) scale(.8)';
      noteEl.style.opacity = '0';
      setTimeout(() => { noteEl.remove(); _updateNotesCount(); _refreshNotesEmpty(); }, 300);
    } catch (e) {
      toast('Заметка', String(e.message || e), 'err');
    }
  }
  async function _addReminder(card, existing) {
    const isEdit = !!existing;
    const kind = existing ? (existing.reminder_kind || 'task') : 'task';
    const lead = existing ? Number(existing.lead_minutes || 0) : 60;
    const eventIso = existing && (existing.event_at || existing.remind_at)
      ? new Date(existing.event_at || existing.remind_at)
      : new Date(_defaultEventLocalIso());
    const eventLocal = new Date(eventIso.getTime() - eventIso.getTimezoneOffset() * 60000)
      .toISOString().slice(0, 16);
    const channels = existing && Array.isArray(existing.channels) ? existing.channels : ['inapp'];
    const title = existing && existing.title ? String(existing.title) : '';
    const message = existing && existing.message ? String(existing.message) : '';

    const kindOpts = REMINDER_KINDS.map(k =>
      `<option value="${k.id}"${k.id === kind ? ' selected' : ''}>${esc(k.label)}</option>`
    ).join('');
    const leadOpts = REMINDER_LEAD_OPTS.map(o =>
      `<option value="${o.v}"${o.v === lead ? ' selected' : ''}>${esc(o.label)}</option>`
    ).join('');
    const chBoxes = REMINDER_CHANNELS.map(ch => `
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t2);cursor:pointer">
        <input type="checkbox" class="pk3-rem-ch" value="${ch.id}"${channels.includes(ch.id) ? ' checked' : ''} />
        ${esc(ch.label)}
      </label>`).join('');

    const html = `
      <div class="pk3-modal" style="max-width:520px;height:auto;max-height:92vh;width:92vw">
        <div class="pk3-modal-head">
          <span style="font-size:20px">⏰</span>
          <h3>${isEdit ? 'Изменить напоминание' : 'Новое напоминание'}</h3>
          <button class="pk3-btn-icon" id="pk3-rem-close" type="button">✕</button>
        </div>
        <div class="pk3-modal-body" style="padding:18px 22px">
          <div class="pk3-row" style="margin-bottom:12px">
            <label>Тип</label>
            <select id="pk3-rem-kind" class="pk3-inp" style="width:100%">${kindOpts}</select>
          </div>
          <div class="pk3-row" style="margin-bottom:12px">
            <label>Заголовок <span style="color:var(--t3);font-weight:400">(необяз.)</span></label>
            <input type="text" id="pk3-rem-title" class="pk3-inp" maxlength="200" placeholder="Кратко: кому звонить, тема встречи…" value="${esc(title)}" />
          </div>
          <div class="pk3-row" style="margin-bottom:12px">
            <label>Дата и время события</label>
            <input type="datetime-local" id="pk3-rem-event" class="pk3-inp" value="${eventLocal}" />
          </div>
          <div class="pk3-row" style="margin-bottom:12px">
            <label>Напомнить</label>
            <select id="pk3-rem-lead" class="pk3-inp" style="width:100%">${leadOpts}</select>
          </div>
          <div style="margin-bottom:12px">
            <label style="display:block;font-size:12px;color:var(--t3);margin-bottom:8px">Каналы уведомления</label>
            <div style="display:flex;flex-direction:column;gap:6px">${chBoxes}</div>
          </div>
          <div class="pk3-row">
            <label>Комментарий</label>
            <textarea id="pk3-rem-msg" class="pk3-inp" rows="3" placeholder="О чём напомнить, детали…">${esc(message)}</textarea>
          </div>
        </div>
        <div class="pk3-modal-foot">
          <button class="pk3-btn pk3-ghost" id="pk3-rem-cancel" type="button">Отмена</button>
          <button class="pk3-btn pk3-gold" id="pk3-rem-save" type="button">${isEdit ? 'Сохранить' : 'Поставить напоминание'}</button>
        </div>
      </div>`;

    _openModal(html, {
      onMount: (overlay) => {
        const close = () => _closeTopModal();
        overlay.querySelector('#pk3-rem-close')?.addEventListener('click', close);
        overlay.querySelector('#pk3-rem-cancel')?.addEventListener('click', close);
        overlay.querySelector('#pk3-rem-save')?.addEventListener('click', async () => {
          const eventRaw = overlay.querySelector('#pk3-rem-event')?.value;
          if (!eventRaw) { toast('Ошибка', 'Укажите дату и время', 'err'); return; }
          const eventAt = new Date(eventRaw);
          if (isNaN(eventAt.getTime())) { toast('Ошибка', 'Некорректная дата', 'err'); return; }

          const leadMinutes = parseInt(overlay.querySelector('#pk3-rem-lead')?.value, 10) || 0;
          const remindAt = new Date(eventAt.getTime() - leadMinutes * 60000);
          if (remindAt.getTime() < Date.now() - 30000) {
            toast('Ошибка', 'Время напоминания уже в прошлом. Увеличьте дату события или уменьшите «за сколько».', 'err');
            return;
          }

          const selectedChannels = [...overlay.querySelectorAll('.pk3-rem-ch:checked')].map(el => el.value);
          if (!selectedChannels.length) { toast('Ошибка', 'Выберите хотя бы один канал', 'err'); return; }

          const body = {
            reminder_kind: overlay.querySelector('#pk3-rem-kind')?.value || 'task',
            event_at: eventAt.toISOString(),
            lead_minutes: leadMinutes,
            channels: selectedChannels,
            title: (overlay.querySelector('#pk3-rem-title')?.value || '').trim() || null,
            message: (overlay.querySelector('#pk3-rem-msg')?.value || '').trim() || null
          };

          const saveBtn = overlay.querySelector('#pk3-rem-save');
          if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Сохраняю…'; }

          const url = isEdit
            ? `/api/personal-kanban/cards/${card.id}/reminders/${existing.id}`
            : `/api/personal-kanban/cards/${card.id}/reminders`;
          const r = await api(url, { method: isEdit ? 'PATCH' : 'POST', body });

          if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = isEdit ? 'Сохранить' : 'Поставить напоминание'; }

          if (r.ok && r.data && r.data.success) {
            close();
            toast('Готово', isEdit ? 'Напоминание обновлено' : 'Напоминание поставлено', 'ok');
            await _loadAndRenderReminders(card);
          } else {
            const err = (r.data && (r.data.error || r.data.message)) || 'Не удалось сохранить';
            const errMap = {
              remind_at_in_past: 'Время напоминания в прошлом',
              invalid_event_at: 'Некорректная дата события',
              invalid_reminder_kind: 'Некорректный тип напоминания',
              forbidden: 'Нет прав на эту карту'
            };
            toast('Ошибка', errMap[err] || err, 'err');
          }
        });
      }
    });
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
  // 22.06.2026: вместо локальной модалки-дубля (тёмная тема ломалась, функционал
  // повторял основной модуль /tkp) → редирект на полноценную страницу #/tkp?edit=<id>.
  // Создаём TKP-сущность из карты и открываем её в основном TKP-модуле.
  // Backend POST /api/tkp/from-card/:cardId отдаёт { item: tkp, template_kind, ... }
  // (НЕ tkp_id отдельно), нужно брать item.id или tkp_id как fallback.
  async function _openTkpConstructor(card) {
    try {
      const r = await api(`/api/tkp/from-card/${card.id}`, {
        method: 'POST', body: { template_kind: 'universal' }
      });
      if (!r.ok) {
        const msg = (r.data && (r.data.message || r.data.error)) || `HTTP ${r.status}`;
        toast('ТКП', `Не удалось создать ТКП: ${msg}`, 'err');
        console.error('[TKP from-card] failed:', r.status, r.data);
        return;
      }
      const tkpId = (r.data && (r.data.tkp_id || (r.data.item && r.data.item.id))) || null;
      if (!tkpId) {
        toast('ТКП', 'Не удалось создать ТКП: ответ без id', 'err');
        console.error('[TKP from-card] no id in response:', r.data);
        return;
      }
      location.hash = '#/tkp?edit=' + tkpId;
    } catch (e) {
      toast('ТКП', String(e.message || e), 'err');
      console.error('[TKP from-card] exception:', e);
    }
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

  // ── Helpers общие для Quick / Conductor ──────────────────────────────
  function _getToken() {
    try { return localStorage.getItem('asgard_token') || ''; } catch (_) { return ''; }
  }
  function _authHeader() {
    const t = _getToken();
    return t ? { 'Authorization': 'Bearer ' + t } : {};
  }
  function _fmtMoneyRub(n) {
    if (n == null || !isFinite(Number(n))) return '—';
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(Number(n))) + ' ₽';
  }
  function _markdownToHtml(md) {
    // Минимальный безопасный рендер: только esc + перевод **bold**, *italic*, \n→<br>, нумерованные/маркер-списки.
    if (md == null) return '';
    let s = esc(String(md));
    s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    s = s.replace(/(^|[^*])\*([^*\n]+?)\*/g, '$1<i>$2</i>');
    s = s.replace(/\n/g, '<br>');
    return s;
  }
  // POST-SSE стрим: парсит "event:" + "data:" блоки и вызывает onEvent для каждого.
  // Возвращает финальное событие done/error/complete.
  async function _streamSSE(url, body) {
    const headers = Object.assign({}, _authHeader(), { 'Content-Type': 'application/json' });
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    if (!resp.ok || !resp.body) {
      let errText = '';
      try { const j = await resp.json(); errText = j.error || JSON.stringify(j); } catch (_) {}
      throw new Error('HTTP ' + resp.status + (errText ? ': ' + errText : ''));
    }
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const events = [];
    let onEvent = null;
    const promise = (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        // SSE-блок разделён "\n\n"
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const ev = { event: 'message', data: null, id: null };
          raw.split('\n').forEach(line => {
            if (!line) return;
            if (line.startsWith(':')) return; // heartbeat/comment
            const m = line.match(/^(\w+):\s?(.*)$/);
            if (!m) return;
            const k = m[1], v = m[2];
            if (k === 'event') ev.event = v;
            else if (k === 'id') ev.id = v;
            else if (k === 'data') ev.data = ev.data == null ? v : ev.data + '\n' + v;
          });
          if (ev.data != null) {
            try { ev.data = JSON.parse(ev.data); } catch (_) { /* оставить строкой */ }
          }
          events.push(ev);
          if (onEvent) try { onEvent(ev); } catch (_) {}
        }
      }
    })();
    return {
      events,
      stream: promise,
      onEach(cb) { onEvent = cb; events.forEach(cb); return this; }
    };
  }

  /* ────────────────────────────────────────────────────────────────────
   * 1. Quick wizard — реальный AI-просчёт через /api/tkp-quick
   * ──────────────────────────────────────────────────────────────────── */
  function openQuick(card, opts) {
    opts = opts || {};
    // Состояние сессии
    let step = 0; // 0 загрузка, 1 расчёт, 2 диалог, 3 финал
    let sessionUid = card._quickSession || null;
    let lastEstimate = null;       // {items, totals, total_with_vat, ...}
    let lastChatMd = '';            // markdown ответа AI
    let attachWarn = [];            // имена файлов, не загруженных в сессию
    let vatPct = 20;
    let marginPct = 30;
    let extraFiles = [];           // ручные File-объекты с диска (доп.ТЗ)
    let marginEdited = false;       // юзер вручную тронул маржу → игнорим total_without_vat от AI
    let vatEdited = false;          // то же для НДС
    let running = false;            // блокирует кнопки во время AI-вызовов

    // Подтянем дефолтный НДС из настроек
    api('/api/settings/vat_default_pct').then(r => {
      const v = (r && r.ok && r.data && r.data.value != null) ? Number(r.data.value) : null;
      if (v && isFinite(v)) {
        vatPct = v;
        const vatEl = overlay && overlay.querySelector('#pk3-q-vat');
        if (vatEl) vatEl.value = String(vatPct);
      }
    }).catch(() => {});

    function _calcTotals(est) {
      if (!est) return { cost: 0, kp_no_vat: 0, kp_with_vat: 0 };
      const items = Array.isArray(est.items) ? est.items : [];
      const cost = items.reduce((s, it) => {
        const q = Number(it.qty || it.quantity || 0);
        const p = Number(it.price || it.unit_price || 0);
        return s + (isFinite(q * p) ? q * p : 0);
      }, 0);
      // Если юзер руками изменил маржу — наше значение приоритет, total_without_vat от AI
      // игнорируется. Иначе используем AI-расчёт (он точнее, учитывает накладные/налоги).
      const kpNoVat = (!marginEdited && est.total_without_vat != null)
        ? Number(est.total_without_vat)
        : Math.round(cost * (1 + marginPct / 100));
      const kpWithVat = (!vatEdited && !marginEdited && est.total_with_vat != null)
        ? Number(est.total_with_vat)
        : Math.round(kpNoVat * (1 + vatPct / 100));
      return { cost, kp_no_vat: kpNoVat, kp_with_vat: kpWithVat };
    }

    function _stepHeaderHtml(s) {
      const labels = ['Загрузка ТЗ в AI', 'AI читает ТЗ', 'Диалог / уточнения', 'Смета', 'Финал'];
      return labels.map((lbl, i) => {
        const cls = i < s ? 'pk3-done' : (i === s ? 'pk3-now' : '');
        return `<div class="pk3-wiz-step ${cls}"><span class="pk3-num">${i+1}</span>${esc(lbl)}</div>`;
      }).join('');
    }

    function _attachmentsCount() {
      return Array.isArray(card.email_attachments) ? card.email_attachments.length : 0;
    }

    function _renderStep0() {
      const cnt = _attachmentsCount();
      const extraList = (extraFiles && extraFiles.length) ? `
        <div style="margin-top:8px;font-size:11.5px">
          <b>Доп.файлы (${extraFiles.length}):</b>
          ${extraFiles.map((f, i) => `<div style="display:flex;align-items:center;gap:8px;padding:4px 0">
            <span style="flex:1">📎 ${esc(f.name)} · ${_fmtBytes(f.size)}</span>
            <button class="pk3-btn pk3-ghost pk3-sm" data-act="extra-del" data-idx="${i}" style="padding:2px 8px">✕</button>
          </div>`).join('')}
        </div>` : '';
      return `
        <p style="margin-bottom:12px;color:var(--t2)">
          ${cnt
            ? `📎 Из письма клиента подтянется <b>${cnt}</b> вложение(й).`
            : '⚠ В письме клиента нет вложений — добавь ТЗ или опиши работу руками ниже.'}
        </p>

        <div class="pk3-row" style="margin-bottom:10px">
          <label>🖊 Дополнительное описание работы (необязательно)</label>
          <textarea id="pk3-q-manual-tz" placeholder="Опиши вкратце что делаем, если ТЗ в письме нет или его мало. AI прочитает это вместе с приложенными документами." style="min-height:90px"></textarea>
          <p style="font-size:11px;color:var(--t3);margin-top:4px">До 100 000 символов. Будет добавлено к ТЗ из письма (не заменит).</p>
        </div>

        <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
          <button class="pk3-btn pk3-ghost pk3-sm" data-act="extra-add">📎 Добавить файл(ы) ТЗ</button>
          <span style="flex:1"></span>
          <span style="font-size:11px;color:var(--t3);align-self:center">PDF / DOCX / XLSX / JPG / PNG · до 200 МБ</span>
        </div>
        ${extraList}

        <div id="pk3-q-progress" class="pk3-ai-block">
          <p id="pk3-q-prog-line">Готов к запуску.</p>
        </div>
        ${attachWarn.length ? `<div class="pk3-ai-block" style="margin-top:10px;border-color:var(--warn)"><b>⚠ Файлы, которые не удалось загрузить:</b><br>${attachWarn.map(esc).join('<br>')}</div>` : ''}
      `;
    }
    function _renderStep1() {
      return `
        <p style="margin-bottom:12px;color:var(--t2)">🧠 Мимир анализирует ТЗ. Это может занять до минуты.</p>
        <div id="pk3-q-progress" class="pk3-ai-block">
          <p id="pk3-q-prog-line">Подключаюсь…</p>
        </div>
      `;
    }
    function _renderStep2() {
      return `
        <div class="pk3-quick-actions" style="display:flex;gap:8px;margin-bottom:10px;padding:8px;background:var(--bg2);border-radius:6px;border:1px solid var(--brd-m);flex-wrap:wrap;align-items:center">
          <button data-act="dl-smeta-preview" class="pk3-btn pk3-ghost pk3-sm" type="button" title="Скачать промежуточную смету как Excel">📊 Скачать смету (предпросмотр)</button>
          <button data-act="dl-report-preview" class="pk3-btn pk3-ghost pk3-sm" type="button" title="Скачать промежуточный отчёт как DOCX">📋 Скачать отчёт (предпросмотр)</button>
          <button data-act="save-to-card" class="pk3-btn pk3-gold pk3-sm" type="button" title="Сохранить смету и отчёт в карточку заявки" style="margin-left:auto">💾 Сохранить в карточку</button>
        </div>
        <p style="margin-bottom:8px;color:var(--t2)">🤖 Ответ AI:</p>
        <div class="pk3-ai-block">
          ${_markdownToHtml(lastChatMd) || '<span style="color:var(--t3)">AI не вернул текстовый ответ</span>'}
        </div>
        <div class="pk3-row" style="margin-top:14px">
          <label>Ваш ответ / уточнение для AI (опционально)</label>
          <textarea id="pk3-q-reply" placeholder="Опиши режим работ, ограничения, особенности — AI пересчитает." style="min-height:90px"></textarea>
        </div>
        <p style="font-size:11px;color:var(--t3);margin-top:8px">Можно сразу перейти к смете, если черновика достаточно.</p>
      `;
    }
    function _renderStep3() {
      // Нормализуем items в единый формат до мутаций — чтобы input'ы работали стабильно.
      if (lastEstimate && Array.isArray(lastEstimate.items)) {
        lastEstimate.items = lastEstimate.items.map(it => ({
          name:  it.name != null ? it.name : (it.title || it.description || ''),
          unit:  it.unit != null ? it.unit : (it.unit_name || ''),
          qty:   it.qty != null ? Number(it.qty) : (it.quantity != null ? Number(it.quantity) : 0),
          price: it.price != null ? Number(it.price) : (it.unit_price != null ? Number(it.unit_price) : 0),
        }));
      }
      const items = (lastEstimate && Array.isArray(lastEstimate.items)) ? lastEstimate.items : [];
      const totals = _calcTotals(lastEstimate);
      const inp = (val, attrs) => `<input ${attrs} value="${esc(String(val == null ? '' : val))}" style="width:100%;background:transparent;border:1px solid transparent;padding:4px 6px;color:var(--t1);font:inherit;border-radius:4px"/>`;
      const rows = items.length ? items.map((it, i) => {
        const sum = (Number(it.qty) * Number(it.price)) || 0;
        return `<tr data-row-idx="${i}" style="border-bottom:1px solid var(--brd-m)">
          <td style="padding:4px;color:var(--t3);font-size:11px">${i+1}</td>
          <td style="padding:4px">${inp(it.name, 'data-fld="name"')}</td>
          <td style="padding:4px;width:64px">${inp(it.unit, 'data-fld="unit"')}</td>
          <td style="padding:4px;width:80px">${inp(it.qty, 'data-fld="qty" type="number" min="0" step="0.01" style="text-align:right;width:100%;background:transparent;border:1px solid transparent;padding:4px 6px;color:var(--t1);font:inherit;border-radius:4px"')}</td>
          <td style="padding:4px;width:110px">${inp(it.price, 'data-fld="price" type="number" min="0" step="1" style="text-align:right;width:100%;background:transparent;border:1px solid transparent;padding:4px 6px;color:var(--t1);font:inherit;border-radius:4px"')}</td>
          <td style="padding:6px;text-align:right;color:var(--gold-l);font-family:monospace" data-fld="sum">${_fmtMoneyRub(sum)}</td>
          <td style="padding:4px;width:32px"><button class="pk3-btn pk3-ghost pk3-sm" data-act="row-del" data-row-idx="${i}" title="Удалить строку" style="padding:4px 8px">🗑</button></td>
        </tr>`;
      }).join('') : '<tr><td colspan="7" style="padding:14px;color:var(--t3);text-align:center">AI не вернул позиции сметы</td></tr>';

      const aiBlock = lastChatMd ? `
        <details style="margin-top:12px;background:var(--bg2);border:1px solid var(--brd-m);border-radius:10px;padding:8px 12px">
          <summary style="cursor:pointer;font-size:12px;color:var(--gold-l);font-weight:600">📝 Анализ Мимира (нажми чтобы развернуть)</summary>
          <div style="margin-top:10px;font-size:12.5px;line-height:1.55">${_markdownToHtml(lastChatMd)}</div>
        </details>` : '';

      return `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:10px;flex-wrap:wrap">
          <p style="margin:0;color:var(--t2)">Смета — <b>правь прямо в таблице</b>: имя / кол-во / цена / ед. Сумма пересчитывается автоматически.</p>
          <div style="display:flex;gap:6px">
            <button class="pk3-btn pk3-ghost pk3-sm" data-act="row-add">+ Позиция</button>
            <button class="pk3-btn pk3-gold pk3-sm" data-act="dl-xlsx" title="Excel с формулами и дашбордом">📊 Excel</button>
            <button class="pk3-btn pk3-ghost pk3-sm" data-act="preview-html" title="HTML-отчёт в новой вкладке">👁 Превью</button>
            <button class="pk3-btn pk3-ghost pk3-sm" data-act="dl-csv" title="CSV для импорта в Excel/1С">📄 CSV</button>
            <button class="pk3-btn pk3-ghost pk3-sm" data-act="dl-md" title="Markdown-отчёт">📋 MD</button>
          </div>
        </div>
        <div style="background:var(--bg2);border:1px solid var(--brd-m);border-radius:10px;padding:8px 10px">
          <table id="pk3-q-smeta-tbl" style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr style="border-bottom:1px solid var(--brd-m)">
              <th style="text-align:left;padding:7px 6px;color:var(--t3);font-size:11px">№</th>
              <th style="text-align:left;padding:7px 6px;color:var(--t3);font-size:11px">Позиция</th>
              <th style="text-align:left;padding:7px 6px;color:var(--t3);font-size:11px">Ед</th>
              <th style="text-align:right;padding:7px 6px;color:var(--t3);font-size:11px">Кол-во</th>
              <th style="text-align:right;padding:7px 6px;color:var(--t3);font-size:11px">Цена</th>
              <th style="text-align:right;padding:7px 6px;color:var(--t3);font-size:11px">Сумма</th>
              <th></th>
            </tr></thead><tbody>${rows}
              <tr style="border-top:2px solid var(--brd)">
                <td colspan="5" style="padding:9px;text-align:right;color:var(--t1);font-weight:600">Итого с/с:</td>
                <td id="pk3-q-smeta-total" style="padding:9px;text-align:right;color:var(--gold-l);font-weight:700;font-family:monospace">${_fmtMoneyRub(totals.cost)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="pk3-row" style="margin-top:14px"><label>Маржа, %</label><input id="pk3-q-margin" type="number" value="${marginPct}" /></div>
        <div class="pk3-row"><label>НДС, %</label><input id="pk3-q-vat" type="number" value="${vatPct}" /></div>
        <p style="font-size:11.5px;color:var(--t3);margin-top:10px">💡 Если правил позиции — Мимир увидит твою версию когда вернёшься в «← К диалогу» и нажмёшь «💬 Отправить AI».</p>
        ${aiBlock}
      `;
    }

    // Пересчёт суммы строки и итога при изменении inputs в таблице сметы.
    function _bindSmetaEditing() {
      const tbl = overlay.querySelector('#pk3-q-smeta-tbl');
      if (!tbl) return;
      tbl.querySelectorAll('tr[data-row-idx]').forEach(tr => {
        const idx = Number(tr.dataset.rowIdx);
        const it = lastEstimate && lastEstimate.items && lastEstimate.items[idx];
        if (!it) return;
        tr.querySelectorAll('input[data-fld]').forEach(inp => {
          inp.addEventListener('input', () => {
            const fld = inp.dataset.fld;
            if (fld === 'qty' || fld === 'price') it[fld] = Number(inp.value) || 0;
            else it[fld] = inp.value;
            const sum = (Number(it.qty) * Number(it.price)) || 0;
            const sumCell = tr.querySelector('[data-fld="sum"]');
            if (sumCell) sumCell.textContent = _fmtMoneyRub(sum);
            // Итог
            const totals = _calcTotals(lastEstimate);
            const totEl = overlay.querySelector('#pk3-q-smeta-total');
            if (totEl) totEl.textContent = _fmtMoneyRub(totals.cost);
          });
        });
      });
      // Маржа/НДС — отмечаем как edited при первом изменении и пересчитываем live.
      const mEl = overlay.querySelector('#pk3-q-margin');
      if (mEl) mEl.addEventListener('input', () => {
        const v = Number(mEl.value);
        if (isFinite(v)) { marginPct = v; marginEdited = true; }
      });
      const vEl = overlay.querySelector('#pk3-q-vat');
      if (vEl) vEl.addEventListener('input', () => {
        const v = Number(vEl.value);
        if (isFinite(v)) { vatPct = v; vatEdited = true; }
      });
    }

    function _addEstimateRow() {
      if (!lastEstimate) lastEstimate = { items: [] };
      if (!Array.isArray(lastEstimate.items)) lastEstimate.items = [];
      lastEstimate.items.push({ name: '', unit: '', qty: 1, price: 0 });
      rerender();
    }
    function _removeEstimateRow(idx) {
      if (!lastEstimate || !Array.isArray(lastEstimate.items)) return;
      lastEstimate.items.splice(idx, 1);
      rerender();
    }

    function _estimateAsText() {
      const items = (lastEstimate && Array.isArray(lastEstimate.items)) ? lastEstimate.items : [];
      if (!items.length) return '(смета пустая)';
      const lines = items.map((it, i) => {
        const sum = (Number(it.qty) * Number(it.price)) || 0;
        return `${i+1}. ${it.name || '—'} — ${it.qty || 0} ${it.unit || ''} × ${it.price || 0} ₽ = ${sum.toLocaleString('ru-RU')} ₽`;
      });
      const totals = _calcTotals(lastEstimate);
      lines.push('');
      lines.push(`Итого с/с: ${totals.cost.toLocaleString('ru-RU')} ₽`);
      lines.push(`КП без НДС (маржа ${marginPct}%): ${totals.kp_no_vat.toLocaleString('ru-RU')} ₽`);
      lines.push(`КП с НДС ${vatPct}%: ${totals.kp_with_vat.toLocaleString('ru-RU')} ₽`);
      return lines.join('\n');
    }

    // Lazy-load ExcelJS из CDN — ~600KB, поэтому только когда юзер реально жмёт.
    async function _loadExcelJS() {
      if (window.ExcelJS) return window.ExcelJS;
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
        s.async = true;
        s.onload = resolve;
        s.onerror = () => reject(new Error('ExcelJS CDN недоступен'));
        document.head.appendChild(s);
      });
      return window.ExcelJS;
    }

    async function _downloadXlsx() {
      toast('Excel', 'Готовлю файл с формулами и дашбордом…', 'info');
      let ExcelJS;
      try { ExcelJS = await _loadExcelJS(); }
      catch (e) { toast('Excel', 'Не удалось загрузить движок: ' + e.message, 'err'); return; }

      const items = (lastEstimate && Array.isArray(lastEstimate.items)) ? lastEstimate.items : [];
      const wb = new ExcelJS.Workbook();
      wb.creator = 'ASGARD CRM · Мимир';
      wb.created = new Date();

      // ── Лист 1: Дашборд ──
      const dash = wb.addWorksheet('Дашборд', {
        properties: { tabColor: { argb: 'FFD4A843' } },
        views: [{ showGridLines: false }]
      });
      dash.columns = [
        { width: 32 }, { width: 22 }, { width: 22 }, { width: 22 }
      ];
      // Шапка
      dash.mergeCells('A1:D1');
      const head = dash.getCell('A1');
      head.value = `Просчёт ТКП — ${card.customer_name || 'клиент'}`;
      head.font = { name: 'Cinzel', size: 18, bold: true, color: { argb: 'FFE8C35A' } };
      head.alignment = { horizontal: 'center', vertical: 'middle' };
      head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF15110D' } };
      dash.getRow(1).height = 38;
      dash.mergeCells('A2:D2');
      const sub = dash.getCell('A2');
      sub.value = `Карта #${card.id || ''} · ${new Date().toLocaleString('ru-RU')}`;
      sub.font = { italic: true, color: { argb: 'FF888888' } };
      sub.alignment = { horizontal: 'center' };

      // KPI-карточки (4×1)
      const kpiTitles = ['Себестоимость', 'КП без НДС', `С НДС (=НДС% из B7)`, 'Маржа'];
      kpiTitles.forEach((t, i) => {
        const c = dash.getCell(4, i + 1);
        c.value = t;
        c.font = { bold: true, color: { argb: 'FFB89860' }, size: 11 };
        c.alignment = { horizontal: 'center' };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F1A14' } };
        c.border = { top: { style: 'thin', color: { argb: 'FF3E3729' } } };
      });
      // Значения через формулы из листа «Смета»
      dash.getCell('A5').value = { formula: 'SUM(Смета!F8:F1000)' };
      dash.getCell('B5').value = { formula: 'A5*(1+B7/100)' };
      dash.getCell('C5').value = { formula: 'B5*(1+D7/100)' };
      dash.getCell('D5').value = { formula: `${marginPct}` };
      ['A5','B5','C5','D5'].forEach((addr, i) => {
        const c = dash.getCell(addr);
        c.numFmt = i === 3 ? '0.0"%"' : '# ##0 " ₽"';
        c.font = { bold: true, size: 18, color: { argb: 'FFE8C35A' } };
        c.alignment = { horizontal: 'center', vertical: 'middle' };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF15110D' } };
        c.border = {
          top: { style: 'thin', color: { argb: 'FF3E3729' } },
          left: { style: 'thin', color: { argb: 'FF3E3729' } },
          right: { style: 'thin', color: { argb: 'FF3E3729' } },
          bottom: { style: 'medium', color: { argb: 'FFD4A843' } }
        };
      });
      dash.getRow(5).height = 38;

      // Параметры
      dash.getCell('A7').value = 'Маржа, %';   dash.getCell('A7').font = { bold: true };
      dash.getCell('B7').value = marginPct;    dash.getCell('B7').numFmt = '0.0';
      dash.getCell('C7').value = 'НДС, %';     dash.getCell('C7').font = { bold: true };
      dash.getCell('D7').value = vatPct;       dash.getCell('D7').numFmt = '0.0';
      // Обновление формул при изменении B7/D7 (Excel сам пересчитает).
      // Связка маржи: D5 = B7 (формула)
      dash.getCell('D5').value = { formula: 'B7' };

      // Заказчик блок
      dash.getCell('A9').value = 'Заказчик';        dash.getCell('A9').font = { bold: true };
      dash.getCell('B9').value = card.customer_name || '—';
      dash.mergeCells('B9:D9');
      dash.getCell('A10').value = 'ИНН';            dash.getCell('A10').font = { bold: true };
      dash.getCell('B10').value = card.customer_inn || '—';
      dash.getCell('A11').value = 'Контакт';        dash.getCell('A11').font = { bold: true };
      dash.getCell('B11').value = (card.contact_person || '—') + (card.contact_phone ? ' · ' + card.contact_phone : '');
      dash.mergeCells('B11:D11');

      // Анализ Мимира (если есть)
      if (lastChatMd) {
        dash.getCell('A13').value = 'Анализ Мимира';
        dash.getCell('A13').font = { bold: true, color: { argb: 'FFD4A843' }, size: 13 };
        dash.mergeCells('A13:D13');
        // Конвертим markdown в plain (убираем **)
        const plain = lastChatMd.replace(/\*\*/g, '').replace(/^#+\s*/gm, '');
        dash.getCell('A14').value = plain;
        dash.mergeCells('A14:D14');
        dash.getCell('A14').alignment = { wrapText: true, vertical: 'top' };
        dash.getRow(14).height = Math.min(400, plain.split('\n').length * 16);
      }

      // ── Лист 2: Смета ──
      const sm = wb.addWorksheet('Смета', { properties: { tabColor: { argb: 'FF8B7339' } } });
      sm.columns = [
        { header: '№', key: 'idx', width: 5 },
        { header: 'Позиция', key: 'name', width: 56 },
        { header: 'Ед.', key: 'unit', width: 10 },
        { header: 'Кол-во', key: 'qty', width: 12 },
        { header: 'Цена ₽', key: 'price', width: 14 },
        { header: 'Сумма ₽', key: 'sum', width: 16 }
      ];
      // Стиль шапки колонок
      sm.getRow(1).font = { bold: true, color: { argb: 'FFE8C35A' } };
      sm.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF15110D' } };
      sm.getRow(1).alignment = { horizontal: 'center' };
      sm.getRow(1).height = 26;

      // Заголовок раздела (строка 2-6) — связь с дашбордом
      sm.mergeCells('A2:F2');
      sm.getCell('A2').value = `Смета по работе для ${card.customer_name || ''}`;
      sm.getCell('A2').font = { bold: true, size: 14, color: { argb: 'FFD4A843' } };
      sm.getCell('A2').alignment = { horizontal: 'center' };
      sm.getRow(2).height = 28;

      sm.getCell('A4').value = 'Дата:';
      sm.getCell('B4').value = new Date().toLocaleDateString('ru-RU');
      sm.getCell('A5').value = 'Карта:';
      sm.getCell('B5').value = '#' + (card.id || '');
      sm.getCell('A6').value = 'Заказчик:';
      sm.getCell('B6').value = card.customer_name || '—';

      // Шапка таблицы заново (на строке 7)
      const tblHead = sm.getRow(7);
      ['№','Позиция','Ед.','Кол-во','Цена ₽','Сумма ₽'].forEach((v, i) => {
        const c = tblHead.getCell(i + 1);
        c.value = v;
        c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2A2218' } };
        c.alignment = { horizontal: i < 2 ? 'left' : (i === 2 ? 'center' : 'right'), vertical: 'middle' };
        c.border = { bottom: { style: 'thin', color: { argb: 'FFD4A843' } } };
      });
      tblHead.height = 22;

      // Строки сметы — позиции с ФОРМУЛАМИ для суммы
      items.forEach((it, i) => {
        const r = sm.getRow(8 + i);
        r.getCell(1).value = i + 1;
        r.getCell(2).value = it.name || '';
        r.getCell(3).value = it.unit || '';
        r.getCell(4).value = Number(it.qty) || 0;
        r.getCell(5).value = Number(it.price) || 0;
        r.getCell(6).value = { formula: `D${8 + i}*E${8 + i}` };
        // Стили
        r.getCell(1).alignment = { horizontal: 'center', vertical: 'top' };
        r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
        r.getCell(3).alignment = { horizontal: 'center', vertical: 'top' };
        r.getCell(4).numFmt = '# ##0.##';
        r.getCell(5).numFmt = '# ##0 " ₽"';
        r.getCell(6).numFmt = '# ##0 " ₽"';
        r.getCell(6).font = { bold: true, color: { argb: 'FFD4A843' } };
        [1,2,3,4,5,6].forEach(ci => {
          r.getCell(ci).border = { bottom: { style: 'hair', color: { argb: 'FFCCCCCC' } } };
        });
        // Высота под wrap
        const nameLen = (it.name || '').length;
        if (nameLen > 60) r.height = 28;
        if (nameLen > 100) r.height = 38;
      });

      // Итоги (сразу после последней строки)
      const total = 8 + items.length;
      const totalRow = sm.getRow(total);
      totalRow.getCell(5).value = 'Итого с/с:';
      totalRow.getCell(5).font = { bold: true };
      totalRow.getCell(5).alignment = { horizontal: 'right' };
      totalRow.getCell(6).value = { formula: `SUM(F8:F${total - 1})` };
      totalRow.getCell(6).numFmt = '# ##0 " ₽"';
      totalRow.getCell(6).font = { bold: true, color: { argb: 'FFE8C35A' }, size: 13 };
      totalRow.getCell(6).border = {
        top: { style: 'double', color: { argb: 'FFD4A843' } }
      };

      const margR = total + 1;
      sm.getCell(`E${margR}`).value = `КП без НДС (маржа ${marginPct}%):`;
      sm.getCell(`E${margR}`).font = { bold: true };
      sm.getCell(`E${margR}`).alignment = { horizontal: 'right' };
      sm.getCell(`F${margR}`).value = { formula: `F${total}*(1+${marginPct}/100)` };
      sm.getCell(`F${margR}`).numFmt = '# ##0 " ₽"';

      const vatR = total + 2;
      sm.getCell(`E${vatR}`).value = `С НДС ${vatPct}%:`;
      sm.getCell(`E${vatR}`).font = { bold: true };
      sm.getCell(`E${vatR}`).alignment = { horizontal: 'right' };
      sm.getCell(`F${vatR}`).value = { formula: `F${margR}*(1+${vatPct}/100)` };
      sm.getCell(`F${vatR}`).numFmt = '# ##0 " ₽"';
      sm.getCell(`F${vatR}`).font = { bold: true, color: { argb: 'FF4ADE80' }, size: 14 };

      // Autofilter на таблицу
      sm.autoFilter = `A7:F${total - 1}`;
      // Freeze шапку
      sm.views = [{ state: 'frozen', ySplit: 7 }];

      // ── Лист 3: Анализ AI ──
      if (lastChatMd) {
        const an = wb.addWorksheet('Анализ Мимира', { properties: { tabColor: { argb: 'FF553A18' } } });
        an.columns = [{ width: 120 }];
        an.getCell('A1').value = '📝 Анализ от Мимира';
        an.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFD4A843' } };
        an.getRow(1).height = 30;
        const plain = lastChatMd.replace(/\*\*([^*]+)\*\*/g, '$1');
        an.getCell('A3').value = plain;
        an.getCell('A3').alignment = { wrapText: true, vertical: 'top' };
        an.getRow(3).height = Math.min(600, plain.split('\n').length * 16);
      }

      // Сохраняем
      const buf = await wb.xlsx.writeBuffer();
      _downloadFile(`mimir-quick-${card.id || 'report'}.xlsx`,
        new Blob([buf]),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      toast('Excel', 'Файл скачан — в нём дашборд + смета с формулами + анализ', 'ok');
    }

    function _previewHtml() {
      const totals = _calcTotals(lastEstimate);
      const items = (lastEstimate && Array.isArray(lastEstimate.items)) ? lastEstimate.items : [];
      const ai = lastChatMd ? _markdownToHtml(lastChatMd) : '';
      const rows = items.map((it, i) => {
        const sum = (Number(it.qty) * Number(it.price)) || 0;
        return `<tr>
          <td class="num">${i + 1}</td>
          <td>${esc(it.name || '')}</td>
          <td class="ce">${esc(it.unit || '')}</td>
          <td class="ri">${Number(it.qty || 0).toLocaleString('ru-RU')}</td>
          <td class="ri">${Number(it.price || 0).toLocaleString('ru-RU')} ₽</td>
          <td class="ri sum">${sum.toLocaleString('ru-RU')} ₽</td>
        </tr>`;
      }).join('');
      const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"/>
<title>Мимир-Quick · отчёт #${card.id || ''}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=Inter:wght@400;500;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#0d0a07;--bg2:#15110d;--bg3:#1f1a14;--gold:#d4a843;--gold-l:#e8c35a;--gold-d:#8b7339;--ok:#4ade80;--t1:#f5e9c8;--t2:#bfb195;--t3:#7a6f54;--brd:#3e3729}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--t1);font-family:Inter,system-ui,sans-serif;font-size:14px;line-height:1.55}
.wrap{max-width:1080px;margin:0 auto;padding:32px 28px}
.hd{display:flex;align-items:center;justify-content:space-between;gap:20px;padding-bottom:18px;border-bottom:2px solid var(--gold)}
.hd .logo{font-family:Cinzel,serif;font-size:28px;font-weight:700;color:var(--gold-l);letter-spacing:1px}
.hd .meta{text-align:right;color:var(--t3);font-size:12px}
.hd .meta b{display:block;color:var(--t2);font-size:14px;margin-bottom:3px}
h1{font-family:Cinzel,serif;color:var(--gold-l);margin:24px 0 10px;font-size:22px;font-weight:700}
.cust{display:grid;grid-template-columns:repeat(2,1fr);gap:8px 24px;background:var(--bg2);border:1px solid var(--brd);border-radius:12px;padding:16px 20px;margin-top:16px}
.cust div{display:flex;justify-content:space-between;font-size:13px}
.cust label{color:var(--t3);text-transform:uppercase;letter-spacing:.5px;font-size:11px}
.cust span{color:var(--t1);font-weight:500;text-align:right}
.kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:22px 0}
.kpi .card{background:linear-gradient(180deg,var(--bg2),var(--bg3));border:1px solid var(--brd);border-radius:14px;padding:14px 14px;border-bottom:3px solid var(--gold)}
.kpi .lbl{font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--gold-d);font-weight:600;margin-bottom:6px}
.kpi .val{font-family:'Cinzel',serif;font-size:22px;font-weight:700;color:var(--gold-l);font-variant-numeric:tabular-nums}
.kpi .card.marg{border-bottom-color:var(--ok)}
.kpi .card.marg .val{color:var(--ok)}
table{width:100%;border-collapse:collapse;background:var(--bg2);border:1px solid var(--brd);border-radius:12px;overflow:hidden;margin-top:8px}
thead{background:#221c14}
th{padding:11px 12px;text-align:left;font-size:11.5px;color:var(--gold-l);text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid var(--gold)}
th.ri{text-align:right} th.ce{text-align:center}
td{padding:10px 12px;font-size:13px;color:var(--t1);border-bottom:1px solid var(--brd)}
td.num{color:var(--t3);width:32px;text-align:center}
td.ri{text-align:right;font-variant-numeric:tabular-nums}
td.ce{text-align:center;color:var(--t2)}
td.sum{color:var(--gold-l);font-weight:600}
tr:last-child td{border-bottom:none}
tfoot td{padding:14px 12px;font-weight:700;background:var(--bg3);border-top:2px solid var(--gold)}
tfoot .label{color:var(--gold-d);text-align:right}
tfoot .total{color:var(--gold-l);font-size:16px;text-align:right}
tfoot .vat{color:var(--ok);font-size:18px}
.ai{margin-top:30px;background:var(--bg2);border:1px solid var(--brd);border-left:4px solid var(--gold);border-radius:12px;padding:18px 22px}
.ai h2{margin:0 0 10px;font-family:Cinzel,serif;font-size:18px;color:var(--gold-l)}
.ai .content{color:var(--t2);font-size:13px;line-height:1.65}
.ai .content b,.ai .content strong{color:var(--t1)}
.foot{margin-top:32px;text-align:center;color:var(--t3);font-size:11px;padding-top:18px;border-top:1px solid var(--brd)}
.print{display:inline-block;background:var(--gold);color:var(--bg);border:none;padding:9px 18px;border-radius:8px;font-weight:700;cursor:pointer;margin:18px 4px 0}
.print:hover{background:var(--gold-l)}
@media print{body{background:#fff;color:#000}.print,.hd .meta{display:none}.hd{border-color:#000}.kpi .card,table,.ai{box-shadow:none;border-color:#999;background:#fff}.kpi .lbl{color:#666}.kpi .val,h1,.hd .logo,.ai h2{color:#000}th{color:#000;border-bottom-color:#000}td{color:#000;border-bottom-color:#ccc}}
</style>
</head><body>
<div class="wrap">
  <div class="hd">
    <div>
      <div class="logo">⚔ АСГАРД · Мимир</div>
      <div style="color:var(--t3);font-size:12px;margin-top:4px">Quick-просчёт ТКП</div>
    </div>
    <div class="meta">
      <b>Карта #${card.id || ''}</b>
      ${new Date().toLocaleString('ru-RU')}
    </div>
  </div>

  <h1>Заказчик</h1>
  <div class="cust">
    <div><label>Заказчик</label><span>${esc(card.customer_name || '—')}</span></div>
    <div><label>ИНН</label><span>${esc(card.customer_inn || '—')}</span></div>
    <div><label>Контактное лицо</label><span>${esc(card.contact_person || '—')}</span></div>
    <div><label>Телефон</label><span>${esc(card.contact_phone || '—')}</span></div>
    <div><label>Email</label><span>${esc(card.customer_email || '—')}</span></div>
    <div><label>Объект</label><span>${esc(card.work_location || '—')}</span></div>
  </div>

  <h1>Финансовая сводка</h1>
  <div class="kpi">
    <div class="card"><div class="lbl">Себестоимость</div><div class="val">${totals.cost.toLocaleString('ru-RU')} ₽</div></div>
    <div class="card"><div class="lbl">КП без НДС</div><div class="val">${totals.kp_no_vat.toLocaleString('ru-RU')} ₽</div></div>
    <div class="card"><div class="lbl">С НДС ${vatPct}%</div><div class="val">${totals.kp_with_vat.toLocaleString('ru-RU')} ₽</div></div>
    <div class="card marg"><div class="lbl">Маржа</div><div class="val">${(marginPct.toFixed ? marginPct.toFixed(1) : marginPct)}%</div></div>
  </div>

  <h1>Смета — ${items.length} позиций</h1>
  <table>
    <thead><tr>
      <th>№</th><th>Позиция</th><th class="ce">Ед.</th><th class="ri">Кол-во</th><th class="ri">Цена</th><th class="ri">Сумма</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr><td colspan="5" class="label">Итого с/с:</td><td class="total">${totals.cost.toLocaleString('ru-RU')} ₽</td></tr>
      <tr><td colspan="5" class="label">КП без НДС (маржа ${marginPct}%):</td><td class="total">${totals.kp_no_vat.toLocaleString('ru-RU')} ₽</td></tr>
      <tr><td colspan="5" class="label">КП с НДС ${vatPct}%:</td><td class="vat total">${totals.kp_with_vat.toLocaleString('ru-RU')} ₽</td></tr>
    </tfoot>
  </table>

  ${ai ? `<div class="ai"><h2>📝 Анализ Мимира</h2><div class="content">${ai}</div></div>` : ''}

  <div class="foot">
    Сформировано ASGARD CRM · Мимир-Quick · ${new Date().toLocaleString('ru-RU')}<br>
    <button class="print" onclick="window.print()">🖨 Печать / PDF</button>
    <button class="print" onclick="window.close()">Закрыть</button>
  </div>
</div>
</body></html>`;
      const w = window.open('', '_blank');
      if (!w) { toast('Превью', 'Браузер заблокировал новое окно. Разреши попап-ы.', 'warn'); return; }
      w.document.write(html);
      w.document.close();
      w.focus();
    }

    function _pickExtraFiles() {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = '.pdf,.docx,.xlsx,.xls,.txt,.csv,.rtf,.jpg,.jpeg,.png,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/*';
      input.style.display = 'none';
      input.addEventListener('change', () => {
        const files = Array.from(input.files || []);
        files.forEach(f => extraFiles.push(f));
        input.remove();
        rerender();
        if (files.length) toast('Quick', `Добавлено ${files.length} файл(ов). Жми «▶ Запустить».`, 'ok');
      });
      document.body.appendChild(input);
      input.click();
    }
    function _fmtBytes(n) {
      if (!n && n !== 0) return '';
      if (n < 1024) return n + ' Б';
      if (n < 1024 * 1024) return Math.round(n / 1024) + ' КБ';
      return (n / (1024 * 1024)).toFixed(1) + ' МБ';
    }

    function _downloadFile(filename, content, mime) {
      const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(() => { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch(_){} }, 100);
    }
    function _downloadCsv() {
      const items = (lastEstimate && Array.isArray(lastEstimate.items)) ? lastEstimate.items : [];
      const rows = [['№','Позиция','Ед.','Кол-во','Цена ₽','Сумма ₽']];
      items.forEach((it, i) => {
        const sum = (Number(it.qty) * Number(it.price)) || 0;
        rows.push([i+1, it.name || '', it.unit || '', it.qty || 0, it.price || 0, sum]);
      });
      const totals = _calcTotals(lastEstimate);
      rows.push(['','','','','Итого с/с', totals.cost]);
      rows.push(['','','','',`КП без НДС (маржа ${marginPct}%)`, totals.kp_no_vat]);
      rows.push(['','','','',`КП с НДС ${vatPct}%`, totals.kp_with_vat]);
      const csv = '﻿' + rows.map(r =>
        r.map(c => {
          const s = String(c == null ? '' : c);
          return /[",;\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
        }).join(';')
      ).join('\r\n');
      _downloadFile(`smeta-${card.id || 'quick'}.csv`, csv, 'text/csv;charset=utf-8');
    }
    function _downloadMd() {
      const head = `# Отчёт Мимира · Quick-просчёт\n\n**Карта:** #${card.id || ''}\n**Заказчик:** ${card.customer_name || '—'}\n**Дата:** ${new Date().toLocaleString('ru-RU')}\n\n`;
      const ai = lastChatMd ? `## Анализ Мимира\n\n${lastChatMd}\n\n` : '';
      const items = (lastEstimate && Array.isArray(lastEstimate.items)) ? lastEstimate.items : [];
      const totals = _calcTotals(lastEstimate);
      let table = '## Смета\n\n| № | Позиция | Ед | Кол-во | Цена ₽ | Сумма ₽ |\n|---|---|---|---|---|---|\n';
      items.forEach((it, i) => {
        const sum = (Number(it.qty) * Number(it.price)) || 0;
        table += `| ${i+1} | ${(it.name || '').replace(/\|/g,'\\|')} | ${it.unit || ''} | ${it.qty || 0} | ${(it.price||0).toLocaleString('ru-RU')} | ${sum.toLocaleString('ru-RU')} |\n`;
      });
      table += `\n**Итого с/с:** ${totals.cost.toLocaleString('ru-RU')} ₽\n`;
      table += `**КП без НДС (маржа ${marginPct}%):** ${totals.kp_no_vat.toLocaleString('ru-RU')} ₽\n`;
      table += `**КП с НДС ${vatPct}%:** ${totals.kp_with_vat.toLocaleString('ru-RU')} ₽\n`;
      _downloadFile(`mimir-quick-${card.id || 'report'}.md`, head + ai + table, 'text/markdown;charset=utf-8');
    }
    function _renderStep4() {
      const totals = _calcTotals(lastEstimate);
      return `
        <p style="margin-bottom:12px;color:var(--t2)">✅ Готово к фиксации. Маржу и НДС можно поправить — карточки и сумма обновятся.</p>
        <div class="pk3-fin-grid">
          <div class="pk3-fin-card"><label>Плановая с/с</label><div class="pk3-v" id="pk3-f-cost">${_fmtMoneyRub(totals.cost)}</div></div>
          <div class="pk3-fin-card"><label>Цена КП без НДС</label><div class="pk3-v" id="pk3-f-kpnovat">${_fmtMoneyRub(totals.kp_no_vat)}</div></div>
          <div class="pk3-fin-card"><label>С НДС <span id="pk3-f-vatlbl">${vatPct}</span>%</label><div class="pk3-v" id="pk3-f-kpwithvat">${_fmtMoneyRub(totals.kp_with_vat)}</div></div>
          <div class="pk3-fin-card pk3-margin"><label>Маржа</label><div class="pk3-v" id="pk3-f-marginlbl">${marginPct.toFixed ? marginPct.toFixed(1) : marginPct}%</div></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px">
          <div class="pk3-row"><label>Маржа, %</label><input id="pk3-q-margin" type="number" step="1" value="${marginPct}" /></div>
          <div class="pk3-row"><label>НДС, %</label><input id="pk3-q-vat" type="number" step="1" value="${vatPct}" /></div>
        </div>
        <div class="pk3-ai-block" style="margin-top:14px">
          <p><b>📊 После «Сохранить и на согласование»:</b></p>
          <ul style="margin-top:5px;padding-left:18px;line-height:1.6">
            <li>finalize → ТКП-черновик в pre_tender_request (источник: mimir_quick)</li>
            <li>карта переходит в колонку «Согласование»</li>
          </ul>
        </div>
        <div id="pk3-q-generated-docs" style="margin-top:14px">${_quickGeneratedDocsHtml()}</div>
      `;
    }
    // Сгенерированные Мимиром документы для текущей карты (manual_documents JSONB,
    // фильтр generated_by='mimir'). Рендерится на финал-шаге Quick. После finalize
    // блок перерисовывается через _refreshGeneratedDocs() — подтягиваем свежий card.
    function _quickGeneratedDocsHtml() {
      const docs = Array.isArray(card.manual_documents) ? card.manual_documents : [];
      const items = docs.map((md, idx) => ({ md, idx })).filter(x => x.md && x.md.generated_by === 'mimir');
      if (!items.length) {
        return `<div style="font-size:11.5px;color:var(--t3)">📎 Сгенерированные документы появятся здесь после сохранения (смета.xlsx / отчёт.docx / письмо.docx).</div>`;
      }
      const ptId = card.entity_id;
      const token = encodeURIComponent(localStorage.getItem('asgard_token') || '');
      const ico = (k) => k === 'smeta' ? '📊' : (k === 'director_report' ? '📄' : (k === 'customer_letter' ? '✉' : (k === 'tkp' ? '📋' : '📎')));
      const lbl = (k) => k === 'smeta' ? 'смета' : (k === 'director_report' ? 'отчёт директору' : (k === 'customer_letter' ? 'письмо клиенту' : (k === 'tkp' ? 'ТКП' : '')));
      return `
        <div style="font-size:10.5px;color:var(--t3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">📎 Сгенерированные документы</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${items.map(({ md, idx }) => {
            const name = md.filename || md.original_name || ('документ #' + idx);
            const url  = `/api/pre-tenders/${ptId}/documents/${idx}/download?token=${token}`;
            const kLbl = lbl(md.kind || '');
            return `
              <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg2);border:1px solid var(--brd-m);border-radius:6px;font-size:12px">
                <span>${ico(md.kind)}</span>
                <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}${kLbl ? ` <span style="color:var(--t3);font-size:11px">· ${esc(kLbl)}</span>` : ''}</span>
                <a class="pk3-btn pk3-sm pk3-ghost" href="${url}" target="_blank" rel="noopener" style="text-decoration:none">⬇ Скачать</a>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }
    // Дёргаем актуальную карту с board (там GET /personal-kanban/board подгружает
    // pre_tender_requests со всеми JSONB-полями) и перерисовываем блок.
    async function _refreshGeneratedDocs() {
      try {
        const r = await api(`/api/personal-kanban/board?flow_filter=all`);
        if (!r.ok || !r.data || !r.data.columns) return;
        const all = Object.values(r.data.columns).flat();
        const fresh = all.find(c => c.id === card.id);
        if (fresh && Array.isArray(fresh.manual_documents)) {
          card.manual_documents = fresh.manual_documents;
        }
      } catch (_) { /* graceful */ }
      const el = overlay.querySelector('#pk3-q-generated-docs');
      if (el) el.innerHTML = _quickGeneratedDocsHtml();
    }
    // Live-пересчёт 4 финкарточек на шаге 4 при изменении маржи/НДС.
    function _bindFinalEditing() {
      const mEl = overlay.querySelector('#pk3-q-margin');
      const vEl = overlay.querySelector('#pk3-q-vat');
      if (!mEl && !vEl) return;
      const recalc = () => {
        const t = _calcTotals(lastEstimate);
        const set = (id, v) => { const el = overlay.querySelector(id); if (el) el.textContent = v; };
        set('#pk3-f-cost',       _fmtMoneyRub(t.cost));
        set('#pk3-f-kpnovat',    _fmtMoneyRub(t.kp_no_vat));
        set('#pk3-f-kpwithvat',  _fmtMoneyRub(t.kp_with_vat));
        set('#pk3-f-vatlbl',     String(vatPct));
        set('#pk3-f-marginlbl',  (marginPct.toFixed ? marginPct.toFixed(1) : marginPct) + '%');
      };
      if (mEl) mEl.addEventListener('input', () => {
        const v = Number(mEl.value); if (isFinite(v)) { marginPct = v; marginEdited = true; recalc(); }
      });
      if (vEl) vEl.addEventListener('input', () => {
        const v = Number(vEl.value); if (isFinite(v)) { vatPct = v; vatEdited = true; recalc(); }
      });
    }
    function _renderFoot(s) {
      const disabled = running ? 'disabled' : '';
      // Кнопка «🔄 С нуля» — общая для всех шагов, рядом с закрытием.
      const resetBtn = `<button class="pk3-btn pk3-ghost" data-act="reset" title="Полный пересчёт с нуля" ${disabled}>🔄 С нуля</button>`;
      if (s === 0) return `<button class="pk3-btn pk3-ghost" data-act="close">Отмена</button>${resetBtn}<div style="flex:1"></div><button class="pk3-btn pk3-gold" data-act="upload" ${disabled}>▶ Запустить</button>`;
      if (s === 1) return `<button class="pk3-btn pk3-ghost" data-act="close">Закрыть</button>${resetBtn}<div style="flex:1"></div><button class="pk3-btn" data-act="calc" ${disabled}>🧠 Запросить расчёт у AI</button>`;
      if (s === 2) return `<button class="pk3-btn pk3-ghost" data-act="back">← Назад</button>${resetBtn}<div style="flex:1"></div><button class="pk3-btn" data-act="send-reply" ${disabled}>💬 Отправить AI</button><button class="pk3-btn pk3-gold" data-act="to-smeta" ${disabled}>📊 К смете →</button>`;
      if (s === 3) return `<button class="pk3-btn pk3-ghost" data-act="back" title="Вернуться в диалог с AI">← К диалогу</button>${resetBtn}<div style="flex:1"></div><button class="pk3-btn" data-act="ai-again" ${disabled}>🔁 Уточнить AI заново</button><button class="pk3-btn pk3-gold" data-act="to-final" ${disabled}>→ Финал</button>`;
      /* s === 4 */ return `<button class="pk3-btn pk3-ghost" data-act="back">← Назад</button>${resetBtn}<div style="flex:1"></div><button class="pk3-btn" data-act="save-tkp" ${disabled}>🛠 Сохранить и собрать ТКП</button><button class="pk3-btn pk3-ok" data-act="save" ${disabled}>✅ Сохранить и на согласование</button>`;
    }
    function _renderBody(s) {
      if (s === 0) return _renderStep0();
      if (s === 1) return _renderStep1();
      if (s === 2) return _renderStep2();
      if (s === 3) return _renderStep3();
      return _renderStep4();
    }
    function wizardHtml() {
      return `
        <div class="pk3-modal">
          <div class="pk3-modal-head">
            <span style="font-size:20px;color:var(--info)">🚀</span>
            <h3>Быстрый просчёт через Мимир-Quick</h3>
            <span class="pk3-tag pk3-info" id="pk3-q-tag">${sessionUid ? 'сессия ' + esc(sessionUid.substring(0, 8)) : 'AI ~10 мин'}</span>
            <button class="pk3-btn-icon" data-act="close">✕</button>
          </div>
          <div class="pk3-modal-body">
            <div class="pk3-wiz-steps">${_stepHeaderHtml(step)}</div>
            ${_renderBody(step)}
          </div>
          <div class="pk3-modal-foot">${_renderFoot(step)}</div>
        </div>
      `;
    }

    const overlay = mountModal(wizardHtml());
    const rerender = () => { overlay.innerHTML = wizardHtml(); bindAll(); };
    const setProgress = (text) => {
      // Если busy-overlay показан — пишем ТОЛЬКО в него (иначе текст дублируется
      // и виден под полупрозрачным фоном). Без busy — обычный inline progress-line.
      const busy = overlay.querySelector('.pk3-busy');
      if (busy) {
        const bt = busy.querySelector('.pk3-busy-text');
        if (bt) bt.textContent = text;
        return;
      }
      const el = overlay.querySelector('#pk3-q-prog-line');
      if (el) el.innerHTML = esc(text);
    };

    // ── Busy-overlay поверх модалки (показываем пока ждём AI) ──
    function _setBusy(title, subtitle) {
      const modalEl = overlay.querySelector('.pk3-modal');
      if (!modalEl) return;
      let busy = modalEl.querySelector('.pk3-busy');
      if (!busy) {
        // pk3-modal обязан быть position:relative — иначе inset не сработает.
        modalEl.style.position = 'relative';
        busy = document.createElement('div');
        busy.className = 'pk3-busy';
        busy.innerHTML = `
          <div class="pk3-busy-spin"></div>
          <div class="pk3-busy-text"></div>
          <div class="pk3-busy-sub"></div>
          <div class="pk3-busy-sub pk3-busy-dots"></div>
        `;
        modalEl.appendChild(busy);
      }
      busy.querySelector('.pk3-busy-text').textContent = title || 'Мимир работает';
      busy.querySelectorAll('.pk3-busy-sub')[0].textContent = subtitle || '';
    }
    function _clearBusy() {
      const busy = overlay.querySelector('.pk3-busy');
      if (busy) busy.remove();
    }

    // ── Авто-инициализация: ищем существующую сессию (backend дедупит
    //    по pre_tender_id/tender_id). Если уже была — подгружаем состояние,
    //    PM продолжает с того места.
    async function _initSession() {
      try {
        setProgress('Проверяю предыдущую сессию…');
        const r = await api(`/api/personal-kanban/cards/${card.id}/start-quick`, { method: 'POST', body: {} });
        if (!r.ok || !r.data || !r.data.session_uid) return; // ничего — юзер жмёт «Запустить»
        sessionUid = r.data.session_uid;
        card._quickSession = sessionUid;
        const isExisting = r.data.status === 'existing';
        if (!isExisting) {
          setProgress('Сессия готова. Жми «▶ Запустить» чтобы скачать ТЗ.');
          return;
        }
        // Существующая — тянем полное состояние и восстанавливаем шаг.
        setProgress('Восстанавливаю предыдущий расчёт…');
        const g = await api(`/api/tkp-quick/sessions/${encodeURIComponent(sessionUid)}`);
        if (!g.ok || !g.data) {
          setProgress('Не удалось подгрузить — нажми «🔄 С нуля» или «▶ Запустить».');
          return;
        }
        const sess = g.data.session || g.data;
        const sStatus = (sess.status || '').toLowerCase();
        const msgs = Array.isArray(sess.chat_messages) ? sess.chat_messages : [];
        // Берём последний assistant с estimate.
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].role === 'assistant') {
            lastChatMd = msgs[i].content || lastChatMd;
            if (msgs[i].estimate) lastEstimate = msgs[i].estimate;
            if (lastEstimate) break;
          }
        }
        if (!lastEstimate && sess.estimate_draft) lastEstimate = sess.estimate_draft;
        // Маппинг статуса в step:
        if (sStatus === 'finalized') {
          step = 4; // финал — но finalize уже сделан, кнопки заблокируем дальше
        } else if (lastEstimate || sStatus === 'chatting') {
          step = 2; // есть смета + диалог открыт
        } else if (sStatus === 'calculating') {
          step = 1; // AI всё ещё считает; backend завершит и сохранит — purpos: показать ожидание
        } else {
          step = 0; // draft без расчёта
        }
        rerender();
      } catch (e) {
        // молча, юзер всё равно увидит шаг 0 с кнопкой «Запустить»
        try { console.warn('[Quick] init failed:', e && e.message); } catch (_) {}
      }
    }
    // Не блокируем рендер модалки — _initSession асинхронен.
    _initSession();

    // Кнопка «🔄 С нуля» — confirm + POST start-quick{fresh:true} + reset state.
    async function _resetSession() {
      if (running) return;
      if (!window.confirm('Полный пересчёт с нуля? Текущая сессия будет помечена как abandoned.')) return;
      running = true;
      try {
        const r = await api(`/api/personal-kanban/cards/${card.id}/start-quick`, { method: 'POST', body: { fresh: true } });
        if (!r.ok || !r.data || !r.data.session_uid) {
          toast('Quick', 'Не удалось создать новую сессию', 'err');
          return;
        }
        sessionUid = r.data.session_uid;
        card._quickSession = sessionUid;
        lastEstimate = null;
        lastChatMd = '';
        attachWarn = [];
        step = 0;
        toast('Quick', 'Новая сессия создана', 'ok');
        rerender();
      } finally {
        running = false;
      }
    }

    // ── Шаги ──
    async function _doUpload() {
      if (running) return;
      running = true;
      const tag = overlay.querySelector('#pk3-q-tag'); if (tag) tag.textContent = 'запуск…';
      _setBusy('Мимир готовит сессию', 'это займёт несколько секунд');
      try {
        // 1. Создать (или переиспользовать) сессию
        if (!sessionUid) {
          setProgress('Создаю Quick-сессию…');
          const r = await api(`/api/personal-kanban/cards/${card.id}/start-quick`, { method: 'POST', body: {} });
          if (!r.ok || !r.data || !r.data.session_uid) {
            throw new Error((r.data && r.data.error) || 'start-quick failed');
          }
          sessionUid = r.data.session_uid;
          card._quickSession = sessionUid;
        }
        // 1.5 Если юзер ввёл ручной текст — добавим в сессию
        const manualEl = overlay.querySelector('#pk3-q-manual-tz');
        const manualTz = manualEl ? (manualEl.value || '').trim() : '';
        if (manualTz) {
          setProgress('Сохраняю ваше описание работы…');
          try {
            await api(`/api/tkp-quick/sessions/${encodeURIComponent(sessionUid)}/text`, {
              method: 'POST', body: { text: manualTz, mode: 'append' }
            });
          } catch (e) {
            attachWarn.push('Ручной ТЗ: ' + (e.message || 'не сохранился'));
          }
        }
        // 1.6 Догруженные с диска файлы — заливаем напрямую (без скачивания)
        if (extraFiles.length) {
          for (let i = 0; i < extraFiles.length; i++) {
            const f = extraFiles[i];
            setProgress(`Загружаю доп.файл ${i+1}/${extraFiles.length}: ${f.name}`);
            try {
              const fd = new FormData();
              fd.append('files', f, f.name);
              const upResp = await fetch(`/api/tkp-quick/sessions/${encodeURIComponent(sessionUid)}/upload`, {
                method: 'POST', headers: _authHeader(), body: fd
              });
              if (!upResp.ok) {
                let j = {}; try { j = await upResp.json(); } catch (_) {}
                throw new Error(j.error || ('HTTP ' + upResp.status));
              }
            } catch (e) {
              attachWarn.push(f.name + ' (upload: ' + (e.message || 'err') + ')');
            }
          }
        }
        // 2. Скачать каждый attachment и загрузить в сессию
        const atts = Array.isArray(card.email_attachments) ? card.email_attachments : [];
        const ptId = card.entity_id;
        for (let i = 0; i < atts.length; i++) {
          const att = atts[i];
          const fname = att.original_filename || att.filename || ('att_' + att.id);
          setProgress(`Качаю файл ${i+1}/${atts.length}: ${fname}`);
          let blob;
          try {
            const dlUrl = `/api/pre-tenders/${ptId}/email-attachments/${att.id}/download?token=${encodeURIComponent(_getToken())}`;
            const dlResp = await fetch(dlUrl);
            if (!dlResp.ok) throw new Error('HTTP ' + dlResp.status);
            blob = await dlResp.blob();
          } catch (e) {
            attachWarn.push(fname + ' (download: ' + e.message + ')');
            continue;
          }
          setProgress(`Загружаю в AI-сессию: ${fname}`);
          try {
            const fd = new FormData();
            fd.append('files', blob, fname);
            const upResp = await fetch(`/api/tkp-quick/sessions/${encodeURIComponent(sessionUid)}/upload`, {
              method: 'POST',
              headers: _authHeader(), // НЕ ставим Content-Type — браузер выставит multipart с boundary
              body: fd
            });
            if (!upResp.ok) {
              let j = {}; try { j = await upResp.json(); } catch (_) {}
              throw new Error(j.error || ('HTTP ' + upResp.status));
            }
          } catch (e) {
            attachWarn.push(fname + ' (upload: ' + e.message + ')');
          }
        }
        setProgress(atts.length
          ? `✅ Загружено ${atts.length - attachWarn.length} из ${atts.length} файлов в сессию.`
          : '⚠ В карте нет вложений — AI будет работать только по описанию работ.');
        step = 1;
        rerender();
      } catch (e) {
        toast('Quick: запуск не удался', String(e.message || e), 'err');
        setProgress('❌ ' + (e.message || 'ошибка'));
        _clearBusy();
        running = false;
        return;
      }
      // running=false до _doCalculate (см. коммент в шаге calculate).
      running = false;
      _doCalculate(); // _doCalculate сам обновит busy на «AI читает ТЗ»
    }

    async function _doCalculate() {
      if (!sessionUid) return;
      if (running) return;
      running = true;
      _setBusy('🧠 Мимир анализирует ТЗ', 'Claude читает документ и собирает смету (до 60 сек)');
      try {
        setProgress('AI читает ТЗ…');
        const ssr = await _streamSSE(`/api/tkp-quick/sessions/${encodeURIComponent(sessionUid)}/calculate`, {});
        ssr.onEach(ev => {
          const d = ev.data || {};
          if (d.type === 'start' || d.type === 'progress') {
            setProgress(d.message || 'AI работает…');
          } else if (d.type === 'done') {
            lastChatMd = d.chat_response_md || '';
            lastEstimate = d.estimate || null;
          } else if (d.type === 'error') {
            setProgress('❌ ' + (d.message || 'ошибка AI'));
          }
        });
        await ssr.stream;
        if (!lastEstimate && !lastChatMd) {
          throw new Error('AI ничего не вернул');
        }
      } catch (e) {
        toast('Quick: расчёт не удался', String(e.message || e), 'err');
        setProgress('❌ ' + (e.message || 'ошибка'));
        _clearBusy();
        running = false;
        return;
      }
      _clearBusy();
      // running=false ДО rerender, иначе кнопки step=2 рендерятся disabled.
      running = false;
      step = 2;
      rerender();
    }

    async function _doSendReply() {
      const ta = overlay.querySelector('#pk3-q-reply');
      const userMsg = (ta && ta.value || '').trim();
      if (!userMsg) { toast('Quick', 'Напиши ответ AI или нажми «К смете»', 'warn'); return; }
      if (!sessionUid) { toast('Quick', 'Сессия потеряна — закрой и открой заново', 'err'); return; }
      if (running) { toast('Quick', 'Подожди — AI ещё думает', 'warn'); return; }
      running = true;

      // Если PM правил позиции в шаге «Смета» — добавляем актуальную смету в preamble,
      // чтобы Claude увидел ИЗМЕНЕНИЯ (а не повторно работал по своей старой версии).
      let msg = userMsg;
      const items = (lastEstimate && Array.isArray(lastEstimate.items)) ? lastEstimate.items : [];
      if (items.length) {
        msg = `Ниже моя текущая смета (с моими правками — учти их при пересчёте):\n\n${_estimateAsText()}\n\nМой комментарий:\n${userMsg}`;
      }

      _setBusy('🧠 Мимир обрабатывает уточнение', 'пересчитываю смету с учётом твоего ответа (до 60 сек)');
      try {
        const ssr = await _streamSSE(`/api/tkp-quick/sessions/${encodeURIComponent(sessionUid)}/chat`, { message: msg });
        ssr.onEach(ev => {
          const d = ev.data || {};
          if (d.type === 'start' || d.type === 'progress') {
            _setBusy('🧠 ' + (d.message || 'Мимир думает'), 'пересчитываю смету');
          } else if (d.type === 'done') {
            lastChatMd = d.chat_response_md || lastChatMd;
            if (d.estimate) lastEstimate = d.estimate;
          } else if (d.type === 'error') {
            _setBusy('❌ ' + (d.message || 'ошибка AI'), 'попробуй переотправить');
          }
        });
        await ssr.stream;
      } catch (e) {
        toast('Quick: ответ AI не получен', String(e.message || e), 'err');
        _clearBusy();
        running = false;
        return;
      }
      _clearBusy();
      running = false;
      toast('Готово', 'AI обновил ответ — смотри новый текст', 'ok');
      rerender();
    }

    async function _doFinalize(thenOpenTkp) {
      if (!sessionUid) return;
      if (running) return;
      running = true;
      _setBusy(thenOpenTkp ? 'Сохраняю и открываю ТКП' : 'Сохраняю и отправляю на согласование',
               'фиксирую финансы и двигаю карту');
      try {
        const totals = _calcTotals(lastEstimate);
        const body = {
          customer_name:   card.customer_name || null,
          customer_inn:    card.customer_inn || null,
          work_description: card.work_description || null,
          kp_price_without_vat: totals.kp_no_vat || null,
          kp_price_with_vat:    totals.kp_with_vat || null,
          margin_pct: marginPct,
          vat_pct: vatPct
        };
        const r = await api(`/api/tkp-quick/sessions/${encodeURIComponent(sessionUid)}/finalize`, { method: 'POST', body });
        if (!r.ok) throw new Error((r.data && r.data.error) || 'finalize failed');
        // best-effort: обновить карту (если поля разрешены — backend пропустит лишнее)
        try {
          await api(`/api/personal-kanban/cards/${card.id}/update`, {
            method: 'POST',
            body: { estimated_sum: totals.kp_no_vat || null }
          });
        } catch (_) {}
        if (thenOpenTkp) {
          close(overlay);
          if (opts.onOpenTKP) opts.onOpenTKP({ prefillFromSession: sessionUid });
          return;
        }
        // Перевод карты в approval
        try {
          await api(`/api/personal-kanban/cards/${card.id}/transition`, {
            method: 'POST',
            body: { to_v3_column: 'approval', note: 'AI Quick готов', confirm: true }
          });
        } catch (_) {}
        toast('Готово', 'ТКП сохранён, карта на согласовании', 'ok');
        close(overlay);
        if (opts.onSaved) opts.onSaved({ sessionUid, tkp: (r.data && r.data.tkp) || null });
      } catch (e) {
        toast('Quick: не сохранилось', String(e.message || e), 'err');
      } finally {
        _clearBusy();
        running = false;
      }
    }

    function bindAll() {
      overlay.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', async (ev) => {
        const a = b.dataset.act;
        // Мгновенная визуальная реакция на клик — pulse-анимация + spinner
        // на самой кнопке для AI-actions. Юзер уверен что клик принят.
        try {
          b.classList.remove('pk3-pulse');
          // принуждаем reflow для перезапуска анимации
          void b.offsetWidth;
          b.classList.add('pk3-pulse');
        } catch (_) {}
        const aiActs = ['upload','calc','send-reply','save','save-tkp','ai-again','reset'];
        if (aiActs.includes(a)) {
          b.classList.add('pk3-loading');
          setTimeout(() => b.classList.remove('pk3-loading'), 60000);
        }
        if (a === 'close') return close(overlay);
        if (a === 'back')  { step = Math.max(0, step - 1); return rerender(); }
        if (a === 'upload')      return _doUpload();
        if (a === 'calc')        return _doCalculate();
        if (a === 'send-reply')  return _doSendReply();
        if (a === 'to-smeta')    { step = 3; return rerender(); }
        if (a === 'reset')       return _resetSession();
        if (a === 'row-add')     return _addEstimateRow();
        if (a === 'row-del')     return _removeEstimateRow(Number(b.dataset.rowIdx));
        if (a === 'dl-csv')      return _downloadCsv();
        if (a === 'dl-md')       return _downloadMd();
        if (a === 'dl-xlsx')     return _downloadXlsx();
        if (a === 'preview-html')return _previewHtml();
        if (a === 'dl-smeta-preview') {
          if (!sessionUid) return toast('Предпросмотр', 'Сессия не запущена', 'err');
          const tk = encodeURIComponent(_getToken());
          window.open(`/api/tkp-quick/sessions/${encodeURIComponent(sessionUid)}/preview-doc/smeta?token=${tk}`, '_blank');
          return;
        }
        if (a === 'dl-report-preview') {
          if (!sessionUid) return toast('Предпросмотр', 'Сессия не запущена', 'err');
          const tk = encodeURIComponent(_getToken());
          window.open(`/api/tkp-quick/sessions/${encodeURIComponent(sessionUid)}/preview-doc/report?token=${tk}`, '_blank');
          return;
        }
        if (a === 'save-to-card') {
          if (!sessionUid) return toast('Сохранение', 'Сессия не запущена', 'err');
          const btn = b;
          const origText = btn.textContent;
          btn.disabled = true;
          btn.textContent = '⏳ Сохраняю…';
          try {
            const r = await api(`/api/tkp-quick/sessions/${encodeURIComponent(sessionUid)}/save-to-card`, { method: 'POST', body: {} });
            if (r.ok) {
              toast('✓ Сохранено', 'Смета и отчёт сохранены в карточку заявки', 'ok');
              try { window.dispatchEvent(new CustomEvent('asgard:pre-tender:docs:saved', { detail: { card_id: card.id, pre_tender_id: card.entity_id } })); } catch (_) {}
            } else {
              toast('Ошибка', (r.data && r.data.error) || 'Не удалось сохранить', 'err');
            }
          } catch (e) {
            toast('Ошибка', e.message || String(e), 'err');
          } finally {
            btn.disabled = false;
            btn.textContent = origText;
          }
          return;
        }
        if (a === 'extra-add')   return _pickExtraFiles();
        if (a === 'extra-del')   { extraFiles.splice(Number(b.dataset.idx), 1); return rerender(); }
        if (a === 'ai-again')    {
          // Возвращаемся в диалог. _doSendReply вызывать не надо — текстарея
          // ещё не отрендерилась, и юзер сам пишет новое уточнение.
          step = 2;
          rerender();
          // Фокус на textarea для удобства.
          setTimeout(() => { const t = overlay.querySelector('#pk3-q-reply'); if (t) t.focus(); }, 50);
          return;
        }
        if (a === 'to-final') {
          const mEl = overlay.querySelector('#pk3-q-margin');
          const vEl = overlay.querySelector('#pk3-q-vat');
          if (mEl && mEl.value !== '') marginPct = Number(mEl.value);
          if (vEl && vEl.value !== '') vatPct = Number(vEl.value);
          step = 4;
          return rerender();
        }
        if (a === 'save')     return _doFinalize(false);
        if (a === 'save-tkp') return _doFinalize(true);
      }));
      // Биндинг inputs редактируемой сметы (шаг 3) и финансов (шаг 4) — после каждого rerender.
      _bindSmetaEditing();
      _bindFinalEditing();
      // На финальном шаге — подтянуть актуальные AI-документы (Мимир пишет в
      // pre_tender.manual_documents в фоне; первый рендер может застать пустой массив).
      if (step === 4) { _refreshGeneratedDocs(); }
    }
    bindAll();
  }

  /* ────────────────────────────────────────────────────────────────────
   * 2. Conductor — реальный AI-цикл через /api/mimir/conductor + SSE
   * ──────────────────────────────────────────────────────────────────── */
  function openConductor(card) {
    let runId = (card._conductorRun && Number(card._conductorRun)) || null;
    let runState = null;       // объект из GET /run/:id
    let eventSource = null;
    let reconnectAttempt = 0;
    let lastLetter = null;     // последнее сгенерированное письмо {letter_id, subject, body}
    const journalEvents = [];  // {id, event_type, data, created_at, _source?}

    // ── HTML ──
    // Какие event_type ВООБЩЕ не показывать в журнале (шум):
    // - thought / tool_call / tool_result — внутренняя кухня AI, не нужна РП
    // - mode / queue_wait / stage_step — техническая телеметрия
    const HIDDEN_EVENT_TYPES = /^(thought|tool_call|tool_result|mode|queue_wait|stage_step|status_change|context_trimmed)$/i;
    function _journalHtml() {
      const visible = journalEvents.filter(ev => {
        const t = ev.event_type || ev.event || '';
        return !HIDDEN_EVENT_TYPES.test(t);
      });
      if (!visible.length) {
        return '<div style="padding:14px;color:var(--t3);text-align:center;font-size:11.5px">Журнал чист. AI работает в фоне.</div>';
      }
      return visible.map(ev => {
        const t = ev.event_type || ev.event || 'event';
        const isErr = /^error$/i.test(t);
        const isAI = /agent|analysis|estimate|computed|tz_summary|conductor/i.test(t);
        const isClient = /letter_sent|reply|customer/i.test(t);
        const isClar = /clarification/i.test(t);
        const role = isErr ? 'err' : (isAI ? 'ai' : (isClient ? 'client' : (isClar ? 'pm' : 'ai')));
        const av = isErr ? '⚠️' : (isAI ? '🧙' : (isClient ? '📨' : '👤'));
        const when = ev.created_at ? new Date(ev.created_at).toLocaleTimeString('ru-RU', { hour12: false }) : '';
        let body = '';
        const d = ev.data || ev.payload || {};
        if (typeof d === 'string') body = esc(d);
        else if (d.message) body = esc(d.message);
        else if (d.subject) body = esc(d.subject) + (d.preview ? '<br><span style="color:var(--t3)">' + esc(d.preview) + '</span>' : '');
        else body = '<code style="font-size:10.5px;color:var(--t3)">' + esc(JSON.stringify(d).substring(0, 140)) + '</code>';
        return `
          <div class="pk3-cond-msg pk3-${role}">
            <div class="pk3-cond-ava">${av}</div>
            <div class="pk3-cond-content">
              <div class="pk3-cond-head">
                <span class="pk3-cond-name">${esc(t)}</span>
                <span class="pk3-cond-time">${esc(when)}</span>
              </div>
              <div class="pk3-cond-text">${body}</div>
            </div>
          </div>
        `;
      }).join('');
    }

    function _stateHtml() {
      if (!runState) return '<p style="margin:0;color:var(--t3)">Загрузка состояния…</p>';
      const r = runState.run || {};
      const ar = runState.agent_runs || [];
      const clars = runState.clarifications || [];
      const letters = runState.customer_letters || [];
      const blockingOpen = clars.filter(c => c.status === 'OPEN' && c.blocking).length;
      const prog = runState.progress || {};
      const pct = prog.progress_pct != null ? prog.progress_pct : null;
      return `
        <p style="margin:0;font-size:12px"><b>Статус:</b> ${esc(r.status || '—')}</p>
        <p style="margin:6px 0 0;font-size:11.5px">Профиль: ${esc(r.profile || '—')}</p>
        ${pct != null ? `<p style="margin:6px 0 0;font-size:11.5px">Прогресс: ${pct}%</p>` : ''}
        <p style="margin:6px 0 0;font-size:11.5px">Агенты успешно: ${ar.filter(a => a.status === 'SUCCESS').length} / ${ar.length}</p>
        <p style="margin:6px 0 0;font-size:11.5px">Уточнений (открыто/всего): ${clars.filter(c => c.status === 'OPEN').length} / ${clars.length}${blockingOpen ? ` <span style="color:var(--warn-t)">⚠ блокирует: ${blockingOpen}</span>` : ''}</p>
        <p style="margin:6px 0 0;font-size:11.5px">Писем: ${letters.length}</p>
        ${r.blocked_reason ? `<p style="margin:8px 0 0;font-size:11.5px;color:var(--warn-t)"><b>Блокер:</b> ${esc(r.blocked_reason)}</p>` : ''}
      `;
    }

    function _clarificationsHtml() {
      if (!runState) return '';
      const opens = (runState.clarifications || []).filter(c => c.status === 'OPEN');
      if (!opens.length) return '';
      return `
        <div style="margin-top:12px;font-size:10.5px;color:var(--t3);text-transform:uppercase;letter-spacing:.4px">Открытые уточнения от Мимира</div>
        ${opens.map(c => {
          // Backend колонка question_ru (mimir_clarifications), не question_text.
          const q = c.question_ru || c.question_text || c.question || '—';
          const why = c.why_we_ask;
          const cons = c.consequence;
          const def = c.default_assumption;
          return `
            <div class="pk3-ai-block" style="margin-top:8px;padding:12px 14px">
              <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--t3);margin-bottom:6px">
                <span><b>#${c.id}</b></span>
                ${c.blocking ? '<span style="color:var(--err-t)">🔒 блокирует расчёт</span>' : '<span style="color:var(--t2)">опционально</span>'}
                <span>канал: ${esc(c.channel || 'manual')}</span>
                ${c.category ? `<span>· ${esc(c.category)}</span>` : ''}
              </div>
              <p style="margin:0;font-size:13px;line-height:1.5"><b>❓ ${esc(q)}</b></p>
              ${why ? `<p style="margin:8px 0 0;font-size:11.5px;color:var(--t3)"><b>Зачем:</b> ${esc(why)}</p>` : ''}
              ${cons ? `<p style="margin:5px 0 0;font-size:11.5px;color:var(--t3)"><b>Последствие если не ответить:</b> ${esc(cons)}</p>` : ''}
              ${def ? `<p style="margin:5px 0 0;font-size:11.5px;color:var(--t3)"><b>Дефолт-предположение:</b> ${esc(def)}</p>` : ''}
              <div class="pk3-row" style="margin-top:10px">
                <label style="font-size:11px;color:var(--t3)">Твой ответ от лица клиента:</label>
                <textarea data-clar-id="${c.id}" placeholder="Напиши ответ клиента (или то что бы сказал клиент) — AI учтёт и пересчитает" style="min-height:70px"></textarea>
              </div>
              <button class="pk3-btn pk3-sm pk3-gold" data-act="answer-clar" data-clar-id="${c.id}">✅ Ответить</button>
            </div>
          `;
        }).join('')}
      `;
    }

    function _letterPanelHtml() {
      if (!lastLetter) return '';
      return `
        <div class="pk3-ai-block" style="margin-top:14px">
          <p style="margin:0"><b>📧 Сгенерированное письмо #${esc(lastLetter.letter_id)}</b></p>
          <p style="margin:6px 0 0"><b>Тема:</b> ${esc(lastLetter.subject || '')}</p>
          <pre style="margin:8px 0 0;white-space:pre-wrap;font-family:inherit;font-size:12px;max-height:180px;overflow:auto;background:var(--bg2);padding:8px;border-radius:6px;border:1px solid var(--brd-m)">${esc(lastLetter.body || lastLetter.preview || '')}</pre>
          <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
            <button class="pk3-btn pk3-sm" data-act="open-compose">📤 Открыть в My-Mail</button>
            <button class="pk3-btn pk3-sm" data-act="mark-sent">✓ Отметить отправленным</button>
            <button class="pk3-btn pk3-sm" data-act="upload-reply">📥 Загрузить ответ клиента</button>
          </div>
        </div>
      `;
    }
    // Sidebar-блок «📎 Сгенерированные документы» для War Room:
    //  · письмо текущего прогона — через /api/mimir/conductor/letter/:id/download/docx (+ pdf если есть)
    //  · отчёт директору / смета / ТКП — через pre_tender.manual_documents (generated_by=mimir)
    function _condDocsHtml() {
      const ptId = card.entity_id;
      const token = encodeURIComponent(localStorage.getItem('asgard_token') || '');
      const blocks = [];
      // 1) Письмо клиенту от Conductor
      if (lastLetter && lastLetter.letter_id) {
        const docxUrl = `/api/mimir/conductor/letter/${lastLetter.letter_id}/download/docx?token=${token}`;
        const pdfUrl  = `/api/mimir/conductor/letter/${lastLetter.letter_id}/download/pdf?token=${token}`;
        blocks.push(`
          <div style="display:flex;align-items:center;gap:6px;padding:6px 8px;background:var(--bg2);border:1px solid var(--brd-m);border-radius:6px;font-size:12px">
            <span>✉</span>
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">письмо #${esc(lastLetter.letter_id)}${lastLetter.subject ? ` <span style="color:var(--t3);font-size:11px">· ${esc(String(lastLetter.subject).slice(0, 40))}</span>` : ''}</span>
            <a class="pk3-btn pk3-sm pk3-ghost" href="${docxUrl}" target="_blank" rel="noopener" style="text-decoration:none">⬇ DOCX</a>
            <a class="pk3-btn pk3-sm pk3-ghost" href="${pdfUrl}" target="_blank" rel="noopener" style="text-decoration:none" title="если PDF не сгенерирован — backend вернёт 404">⬇ PDF</a>
          </div>
        `);
      }
      // 2) Документы из pre_tender.manual_documents (generated_by='mimir')
      const docs = Array.isArray(card.manual_documents) ? card.manual_documents : [];
      const mimirDocs = docs.map((md, idx) => ({ md, idx })).filter(x => x.md && x.md.generated_by === 'mimir');
      const ico = (k) => k === 'smeta' ? '📊' : (k === 'director_report' ? '📄' : (k === 'customer_letter' ? '✉' : (k === 'tkp' ? '📋' : '📎')));
      const lbl = (k) => k === 'smeta' ? 'смета' : (k === 'director_report' ? 'отчёт директору' : (k === 'customer_letter' ? 'письмо клиенту' : (k === 'tkp' ? 'ТКП' : '')));
      mimirDocs.forEach(({ md, idx }) => {
        const name = md.filename || md.original_name || ('документ #' + idx);
        const url  = `/api/pre-tenders/${ptId}/documents/${idx}/download?token=${token}`;
        const kLbl = lbl(md.kind || '');
        blocks.push(`
          <div style="display:flex;align-items:center;gap:6px;padding:6px 8px;background:var(--bg2);border:1px solid var(--brd-m);border-radius:6px;font-size:12px">
            <span>${ico(md.kind)}</span>
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}${kLbl ? ` <span style="color:var(--t3);font-size:11px">· ${esc(kLbl)}</span>` : ''}</span>
            <a class="pk3-btn pk3-sm pk3-ghost" href="${url}" target="_blank" rel="noopener" style="text-decoration:none">⬇ Скачать</a>
          </div>
        `);
      });
      if (!blocks.length) {
        return `
          <div style="font-size:10.5px;color:var(--t3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">📎 Документы прогона</div>
          <div style="font-size:11.5px;color:var(--t3)">Документы появятся после генерации письма / отчёта / сметы.</div>
        `;
      }
      return `
        <div style="font-size:10.5px;color:var(--t3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">📎 Документы прогона</div>
        <div style="display:flex;flex-direction:column;gap:6px">${blocks.join('')}</div>
      `;
    }
    // Подтянуть свежие manual_documents с board (Мимир пишет в pre_tender в фоне)
    // и перерисовать sidebar-блок документов War Room.
    async function _refreshCondDocs() {
      try {
        const r = await api(`/api/personal-kanban/board?flow_filter=all`);
        if (r.ok && r.data && r.data.columns) {
          const all = Object.values(r.data.columns).flat();
          const fresh = all.find(c => c.id === card.id);
          if (fresh && Array.isArray(fresh.manual_documents)) {
            card.manual_documents = fresh.manual_documents;
          }
        }
      } catch (_) { /* graceful */ }
      const el = overlay.querySelector('#pk3-cond-docs');
      if (el) el.innerHTML = _condDocsHtml();
    }

    function condHtml() {
      const tagText = runId ? ('run #' + runId + (runState && runState.run ? ' · ' + runState.run.status : '')) : 'инициализация…';
      const errorCount = journalEvents.filter(ev => /^error$/i.test(ev.event_type)).length;
      return `
      <div class="pk3-modal" style="max-width:1180px">
        <div class="pk3-modal-head">
          <span style="font-size:20px;color:#A78BFA">🎼</span>
          <h3>Мимир-Кондуктор</h3>
          <span class="pk3-tag pk3-warn" id="pk3-cond-tag">${esc(tagText)}</span>
          <button class="pk3-btn-icon" data-act="close">✕</button>
        </div>
        <div class="pk3-modal-body">
          <div style="display:grid;grid-template-columns:2fr 1fr;gap:18px">
            <!-- ЛЕВО (2/3): главное — вопросы AI -->
            <div>
              <div style="font-size:10.5px;color:var(--t3);text-transform:uppercase;margin-bottom:7px;letter-spacing:.4px">ВОПРОСЫ ОТ МИМИРА — ответь чтобы продвинуться</div>
              <div id="pk3-cond-clars">${_clarificationsHtml()}</div>
              <div id="pk3-cond-letter">${_letterPanelHtml()}</div>
            </div>
            <!-- ПРАВО (1/3): sidebar — статус + действия + журнал (свёрнут) -->
            <div>
              <div style="font-size:10.5px;color:var(--t3);text-transform:uppercase;margin-bottom:7px;letter-spacing:.4px">СОСТОЯНИЕ</div>
              <div class="pk3-ai-block" id="pk3-cond-state">${_stateHtml()}</div>
              <div style="margin-top:12px;display:flex;flex-direction:column;gap:6px">
                <button class="pk3-btn" data-act="gen-letter">📧 Сгенерировать письмо клиенту</button>
                <button class="pk3-btn" data-act="recompute">🧮 Пересчитать с feedback</button>
                <button class="pk3-btn pk3-ok" data-act="approve">✅ Утвердить</button>
                <button class="pk3-btn pk3-danger" data-act="cancel-run">❌ Отменить run</button>
              </div>
              <div id="pk3-cond-docs" style="margin-top:12px">${_condDocsHtml()}</div>
              <!-- Журнал свёрнут по умолчанию, ошибки в отдельной плашке -->
              ${errorCount ? `<div class="pk3-ai-block" style="margin-top:12px;border-color:var(--warn);background:rgba(248,113,113,.05)">
                <p style="margin:0;font-size:12px;color:var(--err-t)"><b>⚠ Ошибок AI: ${errorCount}</b> <span style="color:var(--t3);font-size:11px">— см. журнал ниже</span></p>
              </div>` : ''}
              <details style="margin-top:12px" ${errorCount ? 'open' : ''}>
                <summary style="cursor:pointer;font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.4px;padding:6px 0">
                  📜 Журнал событий <span id="pk3-cond-conn" style="text-transform:none;letter-spacing:0;font-size:10px">отключено</span>
                </summary>
                <div id="pk3-cond-journal" style="margin-top:6px;font-size:11px">${_journalHtml()}</div>
              </details>
            </div>
          </div>
        </div>
        <div class="pk3-modal-foot">
          <button class="pk3-btn pk3-ghost" data-act="close">Закрыть</button>
          <button class="pk3-btn pk3-ghost" data-act="reset-cond" title="Отменить текущий прогон и запустить новый">🔄 С нуля</button>
          <button class="pk3-btn pk3-ghost" data-act="add-materials" title="Добавить ТЗ-текст или файлы и перезапустить AI с учётом новых материалов">📎 Дозагрузить материалы</button>
          <div style="flex:1"></div>
          <button class="pk3-btn" data-act="refresh">🔄 Обновить</button>
        </div>
      </div>
    `;
    }

    // Мини-модалка дозагрузки: textarea + file-input + кнопка перезапуска Conductor.
    function _openAddMaterials() {
      const wrap = document.createElement('div');
      wrap.className = 'pk3-modal-overlay show';
      wrap.innerHTML = `
        <div class="pk3-modal" style="max-width:560px">
          <div class="pk3-modal-head">
            <span style="font-size:18px;color:var(--gold)">📎</span>
            <h3 style="flex:1;margin:0">Дозагрузить материалы для Кондуктора</h3>
            <button class="pk3-btn-icon" data-am="close">✕</button>
          </div>
          <div class="pk3-modal-body">
            <p style="color:var(--t2);font-size:12.5px;margin-bottom:10px">Добавь ТЗ-текст и/или файлы. После «Применить» — Conductor запускается заново с учётом новых материалов.</p>
            <div class="pk3-row" style="margin-bottom:10px">
              <label>🖊 Дополнительное описание</label>
              <textarea id="am-text" placeholder="Опиши работу, добавь технические детали, объёмы — Мимир учтёт." style="min-height:120px"></textarea>
              <p style="font-size:11px;color:var(--t3);margin-top:4px">Будет дописано к существующему work_description заявки.</p>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <button class="pk3-btn pk3-ghost pk3-sm" data-am="pick">📎 Выбрать файлы</button>
              <span style="font-size:11px;color:var(--t3)">PDF / DOCX / XLSX / JPG / PNG</span>
            </div>
            <div id="am-list" style="margin-top:8px;font-size:11.5px"></div>
          </div>
          <div class="pk3-modal-foot">
            <button class="pk3-btn pk3-ghost" data-am="close">Отмена</button>
            <div style="flex:1"></div>
            <button class="pk3-btn pk3-gold" data-am="apply">✅ Применить и перезапустить</button>
          </div>
        </div>
      `;
      document.body.appendChild(wrap);
      const close = () => wrap.remove();
      const filesSel = [];
      const listEl = wrap.querySelector('#am-list');
      const renderList = () => {
        if (!filesSel.length) { listEl.innerHTML = ''; return; }
        listEl.innerHTML = '<b>Файлы (' + filesSel.length + '):</b>' + filesSel.map((f, i) =>
          `<div style="display:flex;align-items:center;gap:8px;padding:4px 0">
            <span style="flex:1">📎 ${esc(f.name)} · ${((f.size||0)/1024).toFixed(0)} КБ</span>
            <button class="pk3-btn pk3-ghost pk3-sm" data-am-del="${i}" style="padding:2px 8px">✕</button>
          </div>`).join('');
        listEl.querySelectorAll('[data-am-del]').forEach(b => b.addEventListener('click', () => {
          filesSel.splice(Number(b.dataset.amDel), 1); renderList();
        }));
      };

      wrap.addEventListener('click', async e => {
        const t = e.target.closest('[data-am]');
        if (!t) return;
        const a = t.dataset.am;
        if (a === 'close') return close();
        if (a === 'pick') {
          const input = document.createElement('input');
          input.type = 'file';
          input.multiple = true;
          input.accept = '.pdf,.docx,.xlsx,.xls,.txt,.csv,.rtf,.jpg,.jpeg,.png,.webp,image/*';
          input.style.display = 'none';
          input.addEventListener('change', () => {
            Array.from(input.files || []).forEach(f => filesSel.push(f));
            input.remove();
            renderList();
          });
          document.body.appendChild(input);
          input.click();
          return;
        }
        if (a === 'apply') {
          t.disabled = true; t.textContent = '⏳ Применяю…';
          const text = (wrap.querySelector('#am-text').value || '').trim();
          const ptId = card.entity_id;
          try {
            // 1. Дописываем work_description к pre_tender (если есть текст)
            if (text && ptId) {
              const cur = card.work_description || '';
              const next = cur ? (cur + '\n\n— Дополнение РП —\n' + text) : text;
              await api(`/api/personal-kanban/cards/${card.id}/update`, {
                method: 'POST', body: { work_description: next }
              });
              card.work_description = next; // обновим в памяти
            }
            // 2. Загружаем файлы в pre_tender (manual_documents JSONB)
            if (filesSel.length && ptId) {
              const fd = new FormData();
              filesSel.forEach(f => fd.append('files', f, f.name));
              const r = await fetch(`/api/pre-tenders/${ptId}/upload-docs`, {
                method: 'POST', headers: await _authHeaders(), body: fd
              });
              if (!r.ok) {
                const j = await r.json().catch(() => ({}));
                throw new Error(j.error || ('upload ' + r.status));
              }
            }
            toast('Кондуктор', 'Материалы добавлены, перезапускаю AI', 'ok');
            close();
            await _bootstrap({ fresh: true });
          } catch (err) {
            toast('Не применилось', String(err.message || err), 'err');
            t.disabled = false; t.textContent = '✅ Применить и перезапустить';
          }
        }
      });
    }

    const overlay = mountModal(condHtml());
    const rerender = () => { overlay.innerHTML = condHtml(); bindAll(); };
    const updateJournal = () => {
      const el = overlay.querySelector('#pk3-cond-journal');
      if (el) el.innerHTML = _journalHtml();
    };
    const updateState = () => {
      const el = overlay.querySelector('#pk3-cond-state');
      if (el) el.innerHTML = _stateHtml();
      const tag = overlay.querySelector('#pk3-cond-tag');
      if (tag) tag.textContent = (runId ? 'run #' + runId : '') + (runState && runState.run ? ' · ' + runState.run.status : '');
      const cl = overlay.querySelector('#pk3-cond-clars');
      if (cl) cl.innerHTML = _clarificationsHtml();
    };
    const updateLetter = () => {
      const el = overlay.querySelector('#pk3-cond-letter');
      if (el) el.innerHTML = _letterPanelHtml();
      // Письмо появилось → его docx/pdf-ссылки нужно показать в блоке «Документы прогона».
      const docsEl = overlay.querySelector('#pk3-cond-docs');
      if (docsEl) docsEl.innerHTML = _condDocsHtml();
    };
    const setConn = (text, color) => {
      const el = overlay.querySelector('#pk3-cond-conn');
      if (el) { el.textContent = text; el.style.color = color || 'var(--t3)'; }
    };

    // Закрытие модалки → освободить SSE
    const origClose = overlay._closeFn;
    overlay._closeFn = () => {
      try { if (eventSource) eventSource.close(); } catch (_) {}
      eventSource = null;
      if (origClose) origClose();
    };

    // Busy-overlay для Кондуктора (аналог Quick).
    function _setBusy(title, subtitle) {
      const modalEl = overlay.querySelector('.pk3-modal');
      if (!modalEl) return;
      let busy = modalEl.querySelector('.pk3-busy');
      if (!busy) {
        modalEl.style.position = 'relative';
        busy = document.createElement('div');
        busy.className = 'pk3-busy';
        busy.innerHTML = `<div class="pk3-busy-spin"></div><div class="pk3-busy-text"></div><div class="pk3-busy-sub"></div><div class="pk3-busy-sub pk3-busy-dots"></div>`;
        modalEl.appendChild(busy);
      }
      busy.querySelector('.pk3-busy-text').textContent = title || 'Мимир работает';
      busy.querySelectorAll('.pk3-busy-sub')[0].textContent = subtitle || '';
    }
    function _clearBusy() {
      const busy = overlay.querySelector('.pk3-busy');
      if (busy) busy.remove();
    }

    let _loadStateTimer = null;
    let _loadStateInflight = false;
    // Throttle 800ms: SSE может сыпать ~30 events/сек, fronend не должен слать
    // по одному GET /run/:id на каждое — это устраивало reconnect-storm.
    async function _loadState() {
      if (!runId) return;
      if (_loadStateInflight) return;
      if (_loadStateTimer) return; // уже запланирован
      _loadStateTimer = setTimeout(async () => {
        _loadStateTimer = null;
        if (!runId) return;
        _loadStateInflight = true;
        try {
          const r = await api(`/api/mimir/conductor/run/${runId}`);
          if (r.ok && r.data) {
            runState = r.data;
            updateState();
            // Подтянуть свежий manual_documents — Мимир мог дописать смету/отчёт
            // в фоне за время прогона. _refreshCondDocs обновит блок «Документы прогона».
            _refreshCondDocs();
            // Если статус терминальный — закрываем SSE, чтобы EventSource не
            // переподключался в бесконечную петлю на упавшем run.
            const st = runState.run && runState.run.status;
            if (['ERROR', 'READY_FOR_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(st)) {
              try { if (eventSource) eventSource.close(); } catch (_) {}
              eventSource = null;
              setConn(`run · ${st}`, st === 'ERROR' ? 'var(--err-t)' : 'var(--ok-t)');
            }
          }
        } catch (_) {}
        _loadStateInflight = false;
      }, 800);
    }

    function _openSSE() {
      if (!runId) return;
      try { if (eventSource) eventSource.close(); } catch (_) {}
      const url = `/api/mimir/conductor/events?run_id=${runId}&token=${encodeURIComponent(_getToken())}`;
      setConn('подключаюсь…');
      eventSource = new EventSource(url);
      eventSource.addEventListener('connected', (e) => {
        setConn('online', 'var(--ok-t)');
        reconnectAttempt = 0;
        try {
          const d = JSON.parse(e.data || '{}');
          if (d.status && runState && runState.run) { runState.run.status = d.status; updateState(); }
        } catch (_) {}
      });
      eventSource.addEventListener('complete', (e) => {
        setConn('завершено', 'var(--ok-t)');
        try { eventSource.close(); } catch (_) {}
        eventSource = null;
        _loadState();
      });
      // Каталог-событий из backend: 'message' (по умолчанию) + named типы
      const onAny = (e) => {
        let payload = null;
        try { payload = JSON.parse(e.data || 'null'); } catch (_) { payload = e.data; }
        const ev = {
          id: e.lastEventId || null,
          event_type: e.type && e.type !== 'message' ? e.type : (payload && payload.event_type) || 'message',
          data: payload && payload.payload ? payload.payload : (payload && payload.data ? payload.data : payload),
          created_at: (payload && payload.created_at) || new Date().toISOString()
        };
        journalEvents.push(ev);
        if (journalEvents.length > 200) journalEvents.shift();
        updateJournal();
        // Догружаем state при ключевых событиях
        if (/clarification|letter|status|estimate|agent_/.test(ev.event_type)) {
          _loadState();
        }
      };
      eventSource.addEventListener('message', onAny);
      // Backend шлёт каждое событие как именованное (event:<event_type>).
      // EventSource не вызывает 'message' для именованных — нужно явно слушать каждый тип.
      [
        'agent_started', 'agent_finished', 'agent_rejected',
        'clarification_raised', 'clarification_requested', 'clarification_answered', 'clarification_answered_with_norms',
        'letter_drafted', 'letter_sent', 'reply_parsed', 'answers_applied',
        'status_change', 'recompute_requested', 'resume_recompute', 'estimate_diff',
        'artifact_emitted', 'thought', 'tool_call', 'tool_result',
        'mode', 'stage_step', 'queue_wait', 'director_report_generated', 'error'
      ].forEach(t => eventSource.addEventListener(t, onAny));
      eventSource.onerror = () => {
        setConn('ошибка', 'var(--err-t)');
        try { eventSource.close(); } catch (_) {}
        eventSource = null;
        // Не реконнектимся если run в терминальном статусе — там стрим уже закрыт.
        const st = runState && runState.run && runState.run.status;
        if (['ERROR', 'READY_FOR_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(st)) {
          setConn(`run · ${st}`, st === 'ERROR' ? 'var(--err-t)' : 'var(--ok-t)');
          return;
        }
        if (reconnectAttempt < 3) {
          const delay = Math.pow(2, reconnectAttempt) * 1000;
          reconnectAttempt++;
          setTimeout(() => _openSSE(), delay);
        }
      };
    }

    async function _bootstrap(opts) {
      opts = opts || {};
      _setBusy(opts.fresh ? 'Перезапускаю Кондуктора' : '🎼 Мимир-Кондуктор стартует',
               'создаю/возобновляю прогон AI-цикла');
      try {
        const body = opts.fresh ? { fresh: true } : {};
        const r = await api(`/api/personal-kanban/cards/${card.id}/start-conductor`, { method: 'POST', body });
        if (!r.ok || !r.data || !r.data.run_id) {
          throw new Error((r.data && r.data.error) || 'start-conductor failed');
        }
        runId = Number(r.data.run_id);
        card._conductorRun = runId;
        // Чистим журнал/письмо если перезапуск
        if (opts.fresh) {
          journalEvents.length = 0;
          lastLetter = null;
        }
        await _loadState();
        rerender();
        _openSSE();
        if (opts.fresh) toast('Кондуктор', 'Прогон запущен заново', 'ok');
      } catch (e) {
        toast('Кондуктор', 'Не удалось запустить: ' + (e.message || e), 'err');
        const tag = overlay.querySelector('#pk3-cond-tag');
        if (tag) { tag.textContent = 'ошибка'; tag.style.color = 'var(--err-t)'; }
      } finally {
        _clearBusy();
      }
    }

    async function _resetConductor() {
      if (!window.confirm('Отменить текущий прогон Кондуктора и запустить с нуля? Текущий run будет помечен CANCELLED.')) return;
      try { if (eventSource) eventSource.close(); } catch (_) {}
      eventSource = null;
      runState = null;
      lastLetter = null;
      journalEvents.length = 0;
      await _bootstrap({ fresh: true });
    }

    async function _genLetter() {
      if (!runId) return;
      // Берём все OPEN+blocking clarification_ids; если пусто — все OPEN.
      let ids = [];
      if (runState && Array.isArray(runState.clarifications)) {
        ids = runState.clarifications.filter(c => c.status === 'OPEN' && c.blocking).map(c => c.id);
        if (!ids.length) ids = runState.clarifications.filter(c => c.status === 'OPEN').map(c => c.id);
      }
      if (!ids.length) {
        toast('Кондуктор', 'Нет открытых вопросов — письмо не нужно', 'warn');
        return;
      }
      try {
        const r = await api('/api/mimir/conductor/letter/generate', { method: 'POST', body: { run_id: runId, clarification_ids: ids } });
        if (!r.ok) throw new Error((r.data && r.data.error) || 'letter/generate failed');
        const L = r.data || {};
        lastLetter = {
          letter_id: L.id || L.letter_id || (L.letter && L.letter.id),
          subject:   L.subject || (L.letter && L.letter.subject) || '',
          body:      L.body_text || L.body || (L.letter && (L.letter.body_text || L.letter.body)) || '',
          preview:   L.preview || ''
        };
        updateLetter();
        toast('Письмо готово', 'Можно открыть в My-Mail или отметить отправленным', 'ok');
      } catch (e) {
        toast('Письмо не сгенерировано', String(e.message || e), 'err');
      }
    }

    async function _markSent() {
      if (!lastLetter || !lastLetter.letter_id) return;
      try {
        const r = await api(`/api/mimir/conductor/letter/${lastLetter.letter_id}/mark-sent`, { method: 'POST', body: { channel: 'manual' } });
        if (!r.ok) throw new Error((r.data && r.data.error) || 'mark-sent failed');
        toast('Отмечено', 'Письмо помечено отправленным', 'ok');
        _loadState();
      } catch (e) {
        toast('Не сохранилось', String(e.message || e), 'err');
      }
    }

    function _openCompose() {
      if (!lastLetter) return;
      const to = card.customer_email || '';
      const subj = encodeURIComponent(lastLetter.subject || '');
      const body = encodeURIComponent(lastLetter.body || '');
      window.open(`#/my-mail/compose?to=${encodeURIComponent(to)}&subject=${subj}&body=${body}`, '_blank');
    }

    function _uploadReply() {
      if (!lastLetter || !lastLetter.letter_id) return;
      const input = document.createElement('input');
      input.type = 'file';
      input.style.display = 'none';
      input.addEventListener('change', async () => {
        const f = input.files && input.files[0];
        input.remove();
        if (!f) return;
        try {
          const fd = new FormData();
          fd.append('file', f, f.name);
          const resp = await fetch(`/api/mimir/conductor/letter/${lastLetter.letter_id}/upload-reply`, {
            method: 'POST', headers: _authHeader(), body: fd
          });
          if (!resp.ok) {
            let j = {}; try { j = await resp.json(); } catch (_) {}
            throw new Error(j.error || ('HTTP ' + resp.status));
          }
          const data = await resp.json().catch(() => ({}));
          // mapping в ответе → сразу применяем (AI распарсил)
          if (data.mapping && Array.isArray(data.mapping) && data.mapping.length) {
            try {
              const ar = await api(`/api/mimir/conductor/letter/${lastLetter.letter_id}/apply-mapping`, {
                method: 'POST', body: { mapping: data.mapping }
              });
              if (ar.ok) toast('Ответы клиента применены', `Закрыто вопросов: ${(ar.data && ar.data.applied) || data.mapping.length}`, 'ok');
              else toast('Применение не сработало', (ar.data && ar.data.error) || 'ошибка', 'warn');
            } catch (e) {
              toast('apply-mapping упал', String(e.message || e), 'err');
            }
          } else {
            toast('Файл загружен', 'AI не нашёл прямых ответов — открой уточнения и закрой вручную', 'warn');
          }
          _loadState();
        } catch (e) {
          toast('Загрузка не удалась', String(e.message || e), 'err');
        }
      });
      document.body.appendChild(input);
      input.click();
    }

    async function _answerClar(clarId, text) {
      if (!clarId || !text || !text.trim()) return;
      try {
        const r = await api(`/api/mimir/conductor/clarification/${clarId}/answer`, { method: 'POST', body: { answer_text: text.trim() } });
        if (!r.ok) throw new Error((r.data && r.data.error) || 'answer failed');
        toast('Ответ записан', r.data && r.data.resumed ? 'Кондуктор продолжает работу' : 'Ждём остальные ответы', 'ok');
        _loadState();
      } catch (e) {
        toast('Не сохранилось', String(e.message || e), 'err');
      }
    }

    async function _recompute() {
      if (!runId) return;
      const fb = window.prompt('Опиши, что пересчитать (feedback для AI):');
      if (!fb || !fb.trim()) return;
      try {
        const r = await api(`/api/mimir/conductor/run/${runId}/recompute-with-feedback`, { method: 'POST', body: { feedback_text: fb.trim() } });
        if (!r.ok) throw new Error((r.data && r.data.error) || 'recompute failed');
        toast('Пересчёт запущен', 'События придут в журнал', 'ok');
        _loadState();
      } catch (e) {
        toast('Пересчёт не запущен', String(e.message || e), 'err');
      }
    }

    async function _approve() {
      if (!runId) return;
      if (!window.confirm('Утвердить просчёт?')) return;
      try {
        const r = await api(`/api/mimir/conductor/run/${runId}/approve`, { method: 'POST', body: {} });
        if (!r.ok) throw new Error((r.data && r.data.error) || 'approve failed');
        toast('Утверждено', 'Карта переходит в Согласование', 'ok');
        try {
          await api(`/api/personal-kanban/cards/${card.id}/transition`, {
            method: 'POST', body: { to_v3_column: 'approval', note: 'Кондуктор утверждён', confirm: true }
          });
        } catch (_) {}
        close(overlay);
      } catch (e) {
        toast('Не утвердилось', String(e.message || e), 'err');
      }
    }

    async function _cancelRun() {
      if (!runId) return;
      if (!window.confirm('Точно отменить просчёт? Все промежуточные данные сохранятся, но run закроется.')) return;
      try {
        const r = await api(`/api/mimir/conductor/run/${runId}/cancel`, { method: 'POST', body: {} });
        if (!r.ok) throw new Error((r.data && r.data.error) || 'cancel failed');
        toast('Отменено', 'Run закрыт', 'ok');
        close(overlay);
      } catch (e) {
        toast('Не отменилось', String(e.message || e), 'err');
      }
    }

    function bindAll() {
      overlay.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', async () => {
        const a = b.dataset.act;
        if (a === 'close')        return close(overlay);
        if (a === 'refresh')      return _loadState();
        if (a === 'reset-cond')   return _resetConductor();
        if (a === 'add-materials')return _openAddMaterials();
        if (a === 'gen-letter')   return _genLetter();
        if (a === 'mark-sent')    return _markSent();
        if (a === 'open-compose') return _openCompose();
        if (a === 'upload-reply') return _uploadReply();
        if (a === 'recompute')    return _recompute();
        if (a === 'approve')      return _approve();
        if (a === 'cancel-run')   return _cancelRun();
        if (a === 'answer-clar') {
          const id = b.dataset.clarId;
          const ta = overlay.querySelector(`textarea[data-clar-id="${id}"]`);
          return _answerClar(id, ta ? ta.value : '');
        }
      }));
    }
    bindAll();

    // Старт
    _bootstrap();
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
          required: b.is_required, block_data: b.block_data || {}
        }));
      } else if (r.status === 409 && r.data && r.data.tkp_id) {
        tkpId = r.data.tkp_id;
        const g = await api(`/api/tkp/${tkpId}/blocks`);
        if (g.ok && g.data && g.data.blocks) blocks = g.data.blocks.map(b => ({
          key: b.block_key, ic: b.block_icon || '📦', name: b.block_title || b.block_key,
          required: b.is_required, block_data: b.block_data || {}
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
      // ── EXCEL-style смета: редактирование ячеек + add/del/recalc без полного rerender ──
      const smetaBlock = blocks.find(b => b.key === 'smeta');
      const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
      function recalcSmetaUI() {
        if (!smetaBlock || !smetaBlock.block_data || !Array.isArray(smetaBlock.block_data.items)) return;
        const items = smetaBlock.block_data.items;
        const vatPct = Number(smetaBlock.block_data.vat_pct) || 0;
        let total = 0;
        items.forEach((it, i) => {
          const s = (Number(it.qty) || 0) * (Number(it.price) || 0);
          total += s;
          const cell = overlay.querySelector(`[data-sum="${i}"]`);
          if (cell) cell.textContent = fmt(s);
        });
        const vatAmount = total * vatPct / 100;
        const tot = overlay.querySelector('[data-pk3-smeta-total]'); if (tot) tot.textContent = fmt(total);
        const va = overlay.querySelector('[data-pk3-smeta-vatamt]'); if (va) va.innerHTML = fmt(vatAmount);
        const tv = overlay.querySelector('[data-pk3-smeta-totalvat]'); if (tv) tv.innerHTML = `<b>${fmt(total + vatAmount)}</b>`;
      }
      // input на ячейках имени/единицы/количества/цены
      overlay.querySelectorAll('tr[data-row] input[data-fld]').forEach(inp => {
        inp.addEventListener('input', () => {
          const tr = inp.closest('tr[data-row]');
          const idx = parseInt(tr.dataset.row, 10);
          const fld = inp.dataset.fld;
          if (!smetaBlock.block_data.items[idx]) return;
          const val = (fld === 'qty' || fld === 'price') ? parseFloat(inp.value) || 0 : inp.value;
          smetaBlock.block_data.items[idx][fld] = val;
          dirty = true;
          if (fld === 'qty' || fld === 'price') recalcSmetaUI();
        });
        inp.addEventListener('focus', () => { inp.style.border = '1px solid #b89860'; inp.style.background = '#fff'; });
        inp.addEventListener('blur',  () => { inp.style.border = '1px solid transparent'; inp.style.background = 'transparent'; });
      });
      // НДС rate
      const vatInp = overlay.querySelector('[data-pk3-smeta-vat]');
      if (vatInp) vatInp.addEventListener('input', () => {
        smetaBlock.block_data.vat_pct = parseFloat(vatInp.value) || 0;
        dirty = true;
        recalcSmetaUI();
      });
      // + Добавить позицию
      const addBtn = overlay.querySelector('[data-pk3-smeta-add]');
      if (addBtn) addBtn.addEventListener('click', () => {
        smetaBlock.block_data.items.push({ name: '', unit: 'шт', qty: 1, price: 0 });
        dirty = true; rerender();
      });
      // ✕ Удалить позицию
      overlay.querySelectorAll('[data-pk3-smeta-del]').forEach(b => b.addEventListener('click', () => {
        const idx = parseInt(b.dataset.pk3SmetaDel, 10);
        smetaBlock.block_data.items.splice(idx, 1);
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
        block_data: b.block_data || b.data || {}, is_required: !!b.required, is_active: true
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
      const smetaBlock = blocks.find(b => b.key === 'smeta');
      // Excel-style редактируемая таблица. Позиции в block_data.items, ставка в block_data.vat_pct.
      const items = (smetaBlock.block_data && Array.isArray(smetaBlock.block_data.items) && smetaBlock.block_data.items.length)
        ? smetaBlock.block_data.items
        : [
          { name: 'Подготовка',         unit: 'шт',     qty: 1,  price: 28500  },
          { name: 'Основные работы',    unit: 'м²',     qty: 42, price: 14500  },
          { name: 'Контроль качества',  unit: 'точек', qty: 16, price: 3000   },
          { name: 'Логистика',          unit: 'компл',  qty: 1,  price: 144000 },
          { name: 'Реагенты',           unit: 'компл',  qty: 1,  price: 370500 },
        ];
      const vatPct = (smetaBlock.block_data && smetaBlock.block_data.vat_pct != null)
        ? Number(smetaBlock.block_data.vat_pct) : 20;
      // Сохраняем дефолты обратно в blocks для autosave (если пусто).
      if (!smetaBlock.block_data || !Array.isArray(smetaBlock.block_data.items)) {
        smetaBlock.block_data = { items, vat_pct: vatPct };
      }

      const sum = (it) => (Number(it.qty) || 0) * (Number(it.price) || 0);
      const fmt = (n) => (Math.round(n)).toLocaleString('ru-RU');
      const total = items.reduce((acc, it) => acc + sum(it), 0);
      const vatAmount = total * vatPct / 100;
      const totalWithVat = total + vatAmount;

      out += `<h2 style="display:flex;align-items:center;justify-content:space-between">
          <span>Смета работ</span>
          <span style="font-size:11px;color:#7a5a22;font-style:italic;font-weight:normal">✏️ Редактируйте поля прямо в таблице</span>
        </h2>
        <table data-pk3-smeta-tbl>
          <thead>
            <tr>
              <th style="width:28px">№</th>
              <th>Наименование</th>
              <th style="width:60px" class="pk3-right">Ед.</th>
              <th style="width:70px" class="pk3-right">Кол-во</th>
              <th style="width:110px" class="pk3-right">Цена</th>
              <th style="width:130px" class="pk3-right">Сумма</th>
              <th style="width:24px"></th>
            </tr>
          </thead>
          <tbody>
            ${items.map((it, i) => `
              <tr data-row="${i}">
                <td>${i + 1}</td>
                <td><input data-fld="name" type="text" value="${esc(it.name || '')}" style="width:100%;background:transparent;border:1px solid transparent;padding:3px 4px;color:#2a1f0a;font:inherit"></td>
                <td><input data-fld="unit" type="text" value="${esc(it.unit || '')}" style="width:100%;background:transparent;border:1px solid transparent;padding:3px 4px;color:#2a1f0a;font:inherit;text-align:right"></td>
                <td><input data-fld="qty" type="number" min="0" step="0.01" value="${Number(it.qty) || 0}" style="width:100%;background:transparent;border:1px solid transparent;padding:3px 4px;color:#2a1f0a;font:inherit;text-align:right"></td>
                <td><input data-fld="price" type="number" min="0" step="1" value="${Number(it.price) || 0}" style="width:100%;background:transparent;border:1px solid transparent;padding:3px 4px;color:#2a1f0a;font:inherit;text-align:right"></td>
                <td class="pk3-right" data-sum="${i}" style="font-weight:600">${fmt(sum(it))}</td>
                <td><button data-pk3-smeta-del="${i}" style="background:transparent;border:0;color:#a94440;cursor:pointer;font-size:14px" title="Удалить">✕</button></td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="7" style="padding:7px 4px"><button data-pk3-smeta-add style="background:#e8d8a8;border:1px solid #b89860;padding:5px 10px;border-radius:4px;color:#3d2a08;cursor:pointer;font-weight:600;font-family:'Cinzel',serif">+ Добавить позицию</button></td>
            </tr>
            <tr><td colspan="5" class="pk3-right">Итого без НДС:</td><td class="pk3-right" data-pk3-smeta-total>${fmt(total)}</td><td></td></tr>
            <tr>
              <td colspan="5" class="pk3-right">НДС <input data-pk3-smeta-vat type="number" min="0" max="100" step="1" value="${vatPct}" style="width:42px;background:transparent;border:1px solid #b89860;padding:1px 4px;color:#2a1f0a;font:inherit;text-align:right">%:</td>
              <td class="pk3-right" data-pk3-smeta-vatamt>${fmt(vatAmount)}</td><td></td>
            </tr>
            <tr><td colspan="5" class="pk3-right" style="font-size:13px"><b>Итого с НДС:</b></td><td class="pk3-right" data-pk3-smeta-totalvat style="font-size:13px"><b>${fmt(totalWithVat)}</b></td><td></td></tr>
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
