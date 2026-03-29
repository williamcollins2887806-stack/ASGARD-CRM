/**
 * ASGARD CRM — Estimate Approval Report (Desktop, Сессия 2: вид директора)
 * ═══════════════════════════════════════════════════════════════
 * Маршрут: #/estimate-report?id=123
 * Компоненты: ObjectInfoCard, SummaryCards, CostStructureBar,
 *             ConsolidatedTable, CommentThread, ActionPanel
 */
window.AsgardEstimateReportPage = (function () {
  'use strict';

  const { $, $$, esc, toast, money } = AsgardUI;

  // ── Статусы ──
  const STATUS = {
    draft:    { label: 'Черновик',         css: 'draft' },
    sent:     { label: 'На согласовании',  css: 'sent' },
    approved: { label: 'Согласован',       css: 'approved' },
    rework:   { label: 'На доработке',     css: 'rework' },
    question: { label: 'Вопрос',           css: 'question' },
    rejected: { label: 'Отклонён',         css: 'rejected' }
  };

  const ACTION_LABELS = {
    approve:  'Согласовано',
    rework:   'На доработку',
    question: 'Вопрос',
    reject:   'Отклонено',
    resubmit: 'Переотправлено',
    comment:  'Комментарий'
  };

  const DIRECTOR_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
  const WORK_TYPES = {
    CHEM: 'Химическая', HYDRO: 'Гидродинамическая', MECH: 'Механическая',
    HVAC: 'Вентиляция', COMBO: 'Комбинированная'
  };

  const BLOCK_META = {
    personnel:   { name: 'Персонал и ФОТ',       color: '#AFA9EC', icon: '#3D3780' },
    current:     { name: 'Текущие расходы',       color: '#5DCAA5', icon: '#1A5C42' },
    travel:      { name: 'Командировочные',       color: '#85B7EB', icon: '#1E3A5C' },
    transport:   { name: 'Транспорт',             color: '#F0997B', icon: '#6B2D1A' },
    chemistry:   { name: 'Химия и утилизация',    color: '#FAC775', icon: '#6B4A10' },
    contingency: { name: 'Непредвиденные расходы', color: '#B4B2A9', icon: '#3D3C38' }
  };

  const SRC_LABELS = {
    tariff: 'тариф', reference: 'справ.', warehouse: 'склад', search: 'поиск',
    mimir: 'Мимир', estimate: 'оценка', web: 'веб', fixed: 'фикс.', config: 'config'
  };

  function isDirector(role) { return DIRECTOR_ROLES.includes(role); }

  function fmtMoney(v) {
    if (v == null || isNaN(v)) return '—';
    return Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
  }
  function fmtNum(v) {
    if (v == null || isNaN(v)) return '—';
    return Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
  }
  function fmtDate(d) {
    if (!d) return '—';
    const dt = new Date(d);
    return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  function fmtDateTime(d) {
    if (!d) return '';
    const dt = new Date(d);
    return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' +
           dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
  function initials(name) {
    if (!name) return '?';
    return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }
  function avatarClass(role) {
    if (DIRECTOR_ROLES.includes(role)) return 'er-comment__avatar--director';
    if (role === 'PM' || role === 'HEAD_PM') return 'er-comment__avatar--pm';
    return 'er-comment__avatar--admin';
  }
  function deadlineClass(deadline) {
    if (!deadline) return '';
    const diff = (new Date(deadline) - new Date()) / (1000 * 60 * 60 * 24);
    if (diff < 0) return 'er-deadline--danger';
    if (diff < 3) return 'er-deadline--warn';
    return '';
  }

  // ── API helpers ──
  async function api(method, path, token, body) {
    const opts = {
      method,
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch('/api' + path, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Ошибка API');
    }
    return res.json();
  }

  // ──────────────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────────────
  async function render({ layout: layoutFn, title, query }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    const user = auth.user;
    const token = localStorage.getItem('asgard_token') || auth.token;

    const id = query?.id || new URLSearchParams(location.hash.split('?')[1] || '').get('id');
    if (!id) { location.hash = '#/all-estimates'; return; }

    // Show skeleton while loading
    await layoutFn('<div class="er-page"><div class="er-empty">Загрузка...</div></div>', { title: title || 'Отчёт просчёта' });

    // Fetch data in parallel
    let est, calc, comments, analogs;
    try {
      const [estR, calcR, commR, analR] = await Promise.all([
        api('GET', '/estimates/' + id, token),
        api('GET', '/estimates/' + id + '/calculation', token).catch(() => ({ calculation: null })),
        api('GET', '/approval/estimates/' + id + '/comments', token).catch(() => ({ comments: [] })),
        api('GET', '/estimates/' + id + '/analogs', token).catch(() => ({ analogs: [] }))
      ]);
      est = estR.estimate;
      calc = calcR.calculation;
      comments = commR.comments || [];
      analogs = analR.analogs || [];
    } catch (e) {
      await layoutFn('<div class="er-page"><div class="er-empty">Ошибка загрузки: ' + esc(e.message) + '</div></div>', { title: 'Ошибка' });
      return;
    }

    if (!est) {
      await layoutFn('<div class="er-page"><div class="er-empty">Просчёт не найден</div></div>', { title: '404' });
      return;
    }

    // Parse calculation JSON
    const calcData = parseCalcData(est, calc);
    const st = STATUS[est.approval_status] || STATUS.draft;
    const canAct = isDirector(user.role) && est.approval_status === 'sent';
    const canResubmit = (user.role === 'PM' || user.role === 'HEAD_PM' || user.role === 'ADMIN') &&
                        ['rework', 'question'].includes(est.approval_status) &&
                        (Number(est.pm_id) === Number(user.id) || user.role === 'ADMIN');

    const body = `
    <div class="er-page" id="erPage">
      ${renderHeader(est, st)}
      ${renderSummaryCards(calcData)}
      ${renderCostBar(calcData)}
      ${renderObjectInfo(est)}
      ${renderConsolidatedTable(calcData)}
      ${renderAnalogs(analogs)}
      ${renderComments(comments)}
      ${canAct ? renderActionPanel() : ''}
      ${canResubmit ? renderResubmitPanel() : ''}
    </div>`;

    await layoutFn(body, { title: est.title || 'Просчёт #' + est.id });

    // ── Bind events ──
    bindObjectToggle();
    bindTableExpand();
    bindCommentSubmit(id, token, user);
    if (canAct) bindActionButtons(id, token, user);
    if (canResubmit) bindResubmitButton(id, token);
  }

  // ──────────────────────────────────────────────────────────────
  // Parse calculation data from estimate + estimate_calculation_data
  // ──────────────────────────────────────────────────────────────
  function parseCalcData(est, calc) {
    // If we have the new calculation_json structure
    if (calc && calc.calculation_json) {
      return typeof calc.calculation_json === 'string' ? JSON.parse(calc.calculation_json) : calc.calculation_json;
    }

    // Build from the 6 JSONB columns (V058 structure)
    if (calc) {
      const blocks = [];
      const addBlock = (id, jsonField) => {
        const rows = (typeof jsonField === 'string' ? JSON.parse(jsonField || '[]') : jsonField) || [];
        if (rows.length || id === 'contingency') {
          const sub = rows.reduce((s, r) => s + (parseFloat(r.total) || 0), 0);
          blocks.push({ id, name: BLOCK_META[id]?.name || id, rows, subtotal: sub });
        }
      };
      addBlock('personnel', calc.personnel_json);
      addBlock('current', calc.current_costs_json);
      addBlock('travel', calc.travel_json);
      addBlock('transport', calc.transport_json);
      addBlock('chemistry', calc.chemistry_json);
      // Contingency
      const subtotalBase = blocks.reduce((s, b) => s + b.subtotal, 0);
      const contPct = parseFloat(calc.contingency_pct) || 5;
      blocks.push({
        id: 'contingency', name: 'Непредвиденные расходы',
        rows: [{ item: 'Буфер ' + contPct + '%', percent: contPct, total: subtotalBase * contPct / 100 }],
        subtotal: subtotalBase * contPct / 100
      });

      const totalCost = parseFloat(calc.total_cost) || (subtotalBase + subtotalBase * contPct / 100);
      const marginPct = parseFloat(calc.margin_pct) || parseFloat(est.margin) || 0;
      const totalWithMargin = parseFloat(calc.total_with_margin) || totalCost * (1 + marginPct / 100);
      const markup = marginPct > 0 ? (totalWithMargin / totalCost) : parseFloat(est.markup_multiplier) || 1;

      return {
        blocks,
        summary: {
          cost_no_vat: totalCost,
          markup: markup,
          markup_reason: est.markup_reason || '',
          price_no_vat: totalWithMargin,
          margin_rub: totalWithMargin - totalCost,
          margin_pct: marginPct
        },
        params: {
          city: est.object_city || '',
          distance_km: est.object_distance_km || '',
          work_days: est.work_days || '',
          road_days: est.road_days || 2,
          total_crew: est.crew_count || ''
        }
      };
    }

    // Fallback: no calculation data, show what we have from estimate
    return {
      blocks: [],
      summary: {
        cost_no_vat: parseFloat(est.cost) || 0,
        markup: parseFloat(est.markup_multiplier) || 1,
        price_no_vat: parseFloat(est.price_tkp) || parseFloat(est.amount) || 0,
        margin_rub: (parseFloat(est.price_tkp) || parseFloat(est.amount) || 0) - (parseFloat(est.cost) || 0),
        margin_pct: parseFloat(est.margin) || 0
      },
      params: {}
    };
  }

  // ──────────────────────────────────────────────────────────────
  // COMPONENT: Header
  // ──────────────────────────────────────────────────────────────
  function renderHeader(est, st) {
    const dl = est.deadline ? fmtDate(est.deadline) : '';
    const dlClass = deadlineClass(est.deadline);
    return `
    <div class="er-header">
      <div class="er-header-left">
        <h2>${esc(est.title || 'Просчёт #' + est.id)}</h2>
        <div class="er-header-sub">
          <span class="er-pill er-pill--${st.css}">${st.label}</span>
          ${est.pm_name ? '<span>' + esc(est.pm_name) + '</span>' : ''}
          ${est.version_no ? '<span>v.' + est.version_no + '</span>' : ''}
          ${dl ? '<span class="' + dlClass + '">Дедлайн: ' + dl + '</span>' : ''}
          ${est.work_type ? '<span class="er-wtype er-wtype--' + esc(est.work_type) + '">' + esc(WORK_TYPES[est.work_type] || est.work_type) + '</span>' : ''}
        </div>
      </div>
      <a href="#/all-estimates" class="er-btn er-btn--secondary" style="margin-top:2px">← К списку</a>
    </div>`;
  }

  // ──────────────────────────────────────────────────────────────
  // COMPONENT: Summary Cards
  // ──────────────────────────────────────────────────────────────
  function renderSummaryCards(cd) {
    const s = cd.summary || {};
    const cost = s.cost_no_vat || 0;
    const price = s.price_no_vat || 0;
    const margin = s.margin_rub || 0;
    const marginPct = s.margin_pct || 0;
    const markup = s.markup || 1;

    return `
    <div class="er-cards">
      <div class="er-card">
        <div class="er-card__label">Себестоимость</div>
        <div class="er-card__value">${fmtMoney(cost)}</div>
      </div>
      <div class="er-card er-card--gold">
        <div class="er-card__label">Наценка</div>
        <div class="er-card__value">×${Number(markup).toFixed(1)}</div>
        ${s.markup_reason ? '<div class="er-card__sub">' + esc(s.markup_reason).substring(0, 40) + '</div>' : ''}
      </div>
      <div class="er-card er-card--accent">
        <div class="er-card__label">Цена клиенту</div>
        <div class="er-card__value">${fmtMoney(price)}</div>
      </div>
      <div class="er-card er-card--green">
        <div class="er-card__label">Маржа</div>
        <div class="er-card__value">${fmtMoney(margin)}</div>
        <div class="er-card__sub">${fmtNum(marginPct)}%</div>
      </div>
    </div>`;
  }

  // ──────────────────────────────────────────────────────────────
  // COMPONENT: Cost Structure Bar
  // ──────────────────────────────────────────────────────────────
  function renderCostBar(cd) {
    const blocks = cd.blocks || [];
    if (!blocks.length) return '';

    const total = blocks.reduce((s, b) => s + (b.subtotal || 0), 0);
    if (total <= 0) return '';

    const segments = blocks.map(b => {
      const pct = ((b.subtotal || 0) / total * 100);
      const meta = BLOCK_META[b.id] || { color: '#999', icon: '#333' };
      const label = pct >= 8 ? fmtNum(b.subtotal) : '';
      return `<div class="er-costbar__seg er-costbar__seg--${b.id}" style="flex-basis:${pct.toFixed(1)}%">${label}</div>`;
    }).join('');

    const legend = blocks.map(b => {
      const meta = BLOCK_META[b.id] || { color: '#999' };
      const pct = ((b.subtotal || 0) / total * 100).toFixed(0);
      return `<span class="er-costbar__legend-item">
        <span class="er-costbar__legend-dot" style="background:${meta.color}"></span>
        ${esc(b.name)} ${pct}%
      </span>`;
    }).join('');

    return `
    <div class="er-costbar">
      <div class="er-costbar__label">Структура себестоимости</div>
      <div class="er-costbar__bar">${segments}</div>
      <div class="er-costbar__legend">${legend}</div>
    </div>`;
  }

  // ──────────────────────────────────────────────────────────────
  // COMPONENT: Object Info Card (expandable)
  // ──────────────────────────────────────────────────────────────
  function renderObjectInfo(est) {
    const fields = [];
    const add = (label, val) => { if (val) fields.push({ label, val }); };

    add('Заказчик', est.customer);
    add('Город', est.object_city);
    add('Расстояние', est.object_distance_km ? est.object_distance_km + ' км' : null);
    add('Тип работ', WORK_TYPES[est.work_type] || est.work_type);
    add('Начало работ', fmtDate(est.work_start_date));
    add('Окончание', fmtDate(est.work_end_date));
    add('Бригада', est.crew_count ? est.crew_count + ' чел.' : null);
    add('Рабочих дней', est.work_days);
    add('Дней дороги', est.road_days);
    add('Дедлайн', fmtDate(est.deadline));

    const hasDesc = est.object_description || est.description || est.notes;
    if (!fields.length && !hasDesc) return '';

    const summary = [est.customer, est.object_city, est.object_distance_km ? est.object_distance_km + ' км' : '']
      .filter(Boolean).join(' • ');

    return `
    <div class="er-object" id="erObject">
      <div class="er-object__toggle" id="erObjectToggle">
        <h3>Информация об объекте${summary ? ': ' + esc(summary) : ''}</h3>
        <span class="er-object__chevron">▸</span>
      </div>
      <div class="er-object__body">
        <div class="er-object__grid">
          ${fields.map(f => `
            <div class="er-object__field">
              <div class="er-object__field-label">${esc(f.label)}</div>
              <div class="er-object__field-value">${esc(f.val)}</div>
            </div>`).join('')}
          ${hasDesc ? `
          <div class="er-object__desc">
            <div class="er-object__field-label">Описание работ</div>
            <div class="er-object__desc-text">${esc(est.object_description || est.description || est.notes || '')}</div>
          </div>` : ''}
        </div>
      </div>
    </div>`;
  }

  // ──────────────────────────────────────────────────────────────
  // COMPONENT: Consolidated Table (director view — 1 row per block)
  // ──────────────────────────────────────────────────────────────
  function renderConsolidatedTable(cd) {
    const blocks = cd.blocks || [];
    if (!blocks.length) return '<div class="er-empty">Данные расчёта ещё не заполнены</div>';

    const total = blocks.reduce((s, b) => s + (b.subtotal || 0), 0);

    const rows = blocks.map(b => {
      const meta = BLOCK_META[b.id] || { color: '#999' };
      const detail = summarizeBlock(b);
      const hasDetail = b.rows && b.rows.length > 0;
      const highlights = b.rows ? b.rows.filter(r =>
        r.source === 'mimir' || r.source === 'estimate' || r.source === 'web'
      ) : [];
      const hlHtml = highlights.length
        ? highlights.map(r => `<span class="er-table__highlight">${esc(r.item || '')}</span>`).join(' ')
        : '';

      return `
      <tr class="er-table__block-row" data-block="${b.id}" style="cursor:pointer">
        <td>
          <span class="er-table__block-icon" style="background:${meta.color}"></span>
          <span class="er-table__block-name">${esc(b.name)}</span>
          ${hlHtml}
          <div class="er-table__block-detail">${esc(detail)}</div>
        </td>
        <td>${fmtMoney(b.subtotal)}</td>
      </tr>
      <tr class="er-table__detail-row" data-detail="${b.id}">
        <td colspan="2">${renderBlockDetail(b)}</td>
      </tr>`;
    }).join('');

    return `
    <table class="er-table">
      <thead><tr><th>Блок расходов</th><th>Сумма</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td>Итого себестоимость</td><td>${fmtMoney(total)}</td></tr></tfoot>
    </table>`;
  }

  function summarizeBlock(block) {
    const rows = block.rows || [];
    if (!rows.length) return '';
    // Pick top 2-3 items by total, show short summary
    const sorted = [...rows].sort((a, b) => (parseFloat(b.total) || 0) - (parseFloat(a.total) || 0));
    const top = sorted.slice(0, 3).map(r => r.item || '').filter(Boolean);
    const rest = rows.length - top.length;
    return top.join(', ') + (rest > 0 ? ' и ещё ' + rest : '');
  }

  function renderBlockDetail(block) {
    const rows = block.rows || [];
    if (!rows.length) return '<em style="color:var(--t3);font-size:12px">Нет позиций</em>';

    return `<table class="er-detail-table">${rows.map(r => {
      const src = r.source ? `<span class="er-src er-src--${r.source}">${SRC_LABELS[r.source] || r.source}</span>` : '';
      const desc = buildRowDesc(r);
      return `<tr>
        <td>${esc(r.item || '')} ${src}</td>
        <td>${desc}</td>
        <td>${fmtMoney(r.total)}</td>
      </tr>`;
    }).join('')}</table>`;
  }

  function buildRowDesc(r) {
    const parts = [];
    if (r.qty && r.rate) parts.push(r.qty + ' × ' + fmtNum(r.rate) + '₽');
    if (r.days) parts.push(r.days + ' дн.');
    if (r.percent) parts.push(r.percent + '%');
    if (r.volume_m3) parts.push(r.volume_m3 + ' м³');
    if (r.distance_km) parts.push(r.distance_km + ' км');
    return parts.join(' • ');
  }

  // ──────────────────────────────────────────────────────────────
  // COMPONENT: Analogs
  // ──────────────────────────────────────────────────────────────
  function renderAnalogs(analogs) {
    if (!analogs || !analogs.length) return '';
    const chips = analogs.map(a => {
      const price = a.total_with_margin || a.total_cost || a.amount || 0;
      const dt = a.created_at ? fmtDate(a.created_at) : '';
      return `<span class="er-analog-chip" data-id="${a.id}">
        ${esc(a.title || 'Просчёт #' + a.id)} • ${dt} • <b>${fmtMoney(price)}</b>
      </span>`;
    }).join('');
    return `
    <div class="er-analogs">
      <span class="er-analogs__label">Аналоги:</span>
      ${chips}
    </div>`;
  }

  // ──────────────────────────────────────────────────────────────
  // COMPONENT: Comment Thread
  // ──────────────────────────────────────────────────────────────
  function renderComments(comments) {
    const items = comments.map(c => {
      const actionLabel = ACTION_LABELS[c.action] || c.action || '';
      const actionCss = c.action || 'comment';
      const aClass = avatarClass(c.user_role);
      return `
      <div class="er-comment">
        <div class="er-comment__avatar ${aClass}">${initials(c.user_name)}</div>
        <div class="er-comment__body">
          <div class="er-comment__meta">
            <span class="er-comment__name">${esc(c.user_name || 'Пользователь')}</span>
            <span class="er-comment__action er-comment__action--${actionCss}">${esc(actionLabel)}</span>
            <span class="er-comment__time">${fmtDateTime(c.created_at)}</span>
          </div>
          <div class="er-comment__bubble">${esc(c.comment || '')}</div>
        </div>
      </div>`;
    }).join('');

    return `
    <div class="er-comments">
      <div class="er-comments__title">Переписка${comments.length ? ' (' + comments.length + ')' : ''}</div>
      <div id="erCommentsList">${items || '<div style="color:var(--t3);font-size:13px;padding:8px 0">Нет комментариев</div>'}</div>
      <div class="er-comment-input">
        <textarea id="erCommentText" placeholder="Ваш комментарий..." rows="1"></textarea>
        <button class="er-comment-input__send" id="erCommentSend" title="Отправить">↗</button>
      </div>
    </div>`;
  }

  // ──────────────────────────────────────────────────────────────
  // COMPONENT: Action Panel (director — 4 buttons)
  // ──────────────────────────────────────────────────────────────
  function renderActionPanel() {
    return `
    <div class="er-actions" id="erActions">
      <div class="er-actions__title">Решение по просчёту</div>
      <textarea id="erActionComment" placeholder="Комментарий (обязателен для доработки, вопроса, отклонения)..." rows="2"></textarea>
      <div class="er-actions__btns">
        <button class="er-btn er-btn--reject"   data-action="reject">✕ Отклонить</button>
        <button class="er-btn er-btn--question"  data-action="question">? Вопрос</button>
        <button class="er-btn er-btn--rework"    data-action="rework">↻ На доработку</button>
        <button class="er-btn er-btn--approve"   data-action="approve">✓ Согласовать</button>
      </div>
    </div>`;
  }

  // ──────────────────────────────────────────────────────────────
  // COMPONENT: Resubmit Panel (PM after rework/question)
  // ──────────────────────────────────────────────────────────────
  function renderResubmitPanel() {
    return `
    <div class="er-actions" id="erResubmit">
      <div class="er-actions__title">Повторная отправка</div>
      <div class="er-actions__btns">
        <button class="er-btn er-btn--resubmit" id="erResubmitBtn">Отправить повторно на согласование →</button>
      </div>
    </div>`;
  }

  // ──────────────────────────────────────────────────────────────
  // EVENT BINDINGS
  // ──────────────────────────────────────────────────────────────
  function bindObjectToggle() {
    const toggle = $('#erObjectToggle');
    if (!toggle) return;
    toggle.addEventListener('click', () => {
      const obj = $('#erObject');
      if (obj) obj.classList.toggle('er-object--open');
    });
  }

  function bindTableExpand() {
    const rows = $$('.er-table__block-row');
    rows.forEach(row => {
      row.addEventListener('click', () => {
        const blockId = row.dataset.block;
        const detail = document.querySelector(`[data-detail="${blockId}"]`);
        if (detail) detail.classList.toggle('open');
      });
    });
  }

  function bindCommentSubmit(estimateId, token, user) {
    const btn = $('#erCommentSend');
    const input = $('#erCommentText');
    if (!btn || !input) return;

    // Auto-resize textarea
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    btn.addEventListener('click', async () => {
      const text = input.value.trim();
      if (!text) return;

      btn.disabled = true;
      try {
        const res = await api('POST', '/approval/estimates/' + estimateId + '/comments', token, { comment: text });
        const c = res.comment;
        // Append to list
        const list = $('#erCommentsList');
        // Remove "no comments" placeholder
        const placeholder = list.querySelector('div[style]');
        if (placeholder && placeholder.textContent.includes('Нет комментариев')) {
          placeholder.remove();
        }
        const aClass = avatarClass(user.role);
        const html = `
        <div class="er-comment">
          <div class="er-comment__avatar ${aClass}">${initials(user.name)}</div>
          <div class="er-comment__body">
            <div class="er-comment__meta">
              <span class="er-comment__name">${esc(user.name)}</span>
              <span class="er-comment__action er-comment__action--comment">Комментарий</span>
              <span class="er-comment__time">сейчас</span>
            </div>
            <div class="er-comment__bubble">${esc(text)}</div>
          </div>
        </div>`;
        list.insertAdjacentHTML('beforeend', html);
        input.value = '';
        input.style.height = 'auto';
        // Scroll to bottom
        list.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });

    // Enter (without Shift) to send
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        btn.click();
      }
    });
  }

  function bindActionButtons(estimateId, token, user) {
    const btns = $$('#erActions [data-action]');
    btns.forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        const commentEl = $('#erActionComment');
        const comment = commentEl ? commentEl.value.trim() : '';

        // Validate: comment required for rework/question/reject
        if (['rework', 'question', 'reject'].includes(action) && !comment) {
          toast('Укажите комментарий', 'warn');
          if (commentEl) commentEl.focus();
          return;
        }

        // Confirm approve
        if (action === 'approve') {
          if (!confirm('Согласовать этот просчёт?')) return;
        }
        if (action === 'reject') {
          if (!confirm('Отклонить просчёт? Это действие нельзя отменить.')) return;
        }

        // Disable all buttons
        btns.forEach(b => b.disabled = true);

        try {
          await api('POST', '/approval/estimates/' + estimateId + '/' + action, token, { comment });
          toast(ACTION_LABELS[action] || 'Готово', 'ok');
          // Reload page
          setTimeout(() => {
            location.hash = '#/estimate-report?id=' + estimateId;
            location.reload();
          }, 500);
        } catch (e) {
          toast(e.message, 'error');
          btns.forEach(b => b.disabled = false);
        }
      });
    });
  }

  function bindResubmitButton(estimateId, token) {
    const btn = $('#erResubmitBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      if (!confirm('Отправить просчёт повторно на согласование?')) return;
      btn.disabled = true;
      try {
        await api('POST', '/approval/estimates/' + estimateId + '/resubmit', token, {});
        toast('Отправлено на согласование', 'ok');
        setTimeout(() => {
          location.hash = '#/estimate-report?id=' + estimateId;
          location.reload();
        }, 500);
      } catch (e) {
        toast(e.message, 'error');
        btn.disabled = false;
      }
    });
  }

  return { render };
})();
