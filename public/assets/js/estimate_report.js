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
    let est, calc, comments, analogs, diffData;
    try {
      const [estR, calcR, commR, analR, diffR] = await Promise.all([
        api('GET', '/estimates/' + id, token),
        api('GET', '/estimates/' + id + '/calculation', token).catch(() => ({ calculation: null })),
        api('GET', '/approval/estimates/' + id + '/comments', token).catch(() => ({ comments: [] })),
        api('GET', '/estimates/' + id + '/analogs', token).catch(() => ({ analogs: [] })),
        api('GET', '/estimates/' + id + '/diff', token).catch(() => ({ diff: {} }))
      ]);
      est = estR.estimate;
      calc = calcR.calculation;
      comments = commR.comments || [];
      analogs = analR.analogs || [];
      diffData = diffR.diff || {};
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
    const isPM = ['PM', 'HEAD_PM'].includes(user.role) || user.role === 'ADMIN';
    const isOwner = Number(est.pm_id) === Number(user.id) || user.role === 'ADMIN';
    const canEdit = isPM && isOwner && ['draft', 'rework', 'question'].includes(est.approval_status);
    const canResubmit = isPM && isOwner && ['rework', 'question'].includes(est.approval_status);
    const canSend = isPM && isOwner && est.approval_status === 'draft';
    const showReworkBanner = canEdit && ['rework', 'question'].includes(est.approval_status) && est.last_director_comment;
    const showDiff = ['rework', 'question'].includes(est.approval_status) && Object.keys(diffData).length >= 2;

    const body = `
    <div class="er-page" id="erPage" data-est-id="${est.id}">
      ${renderHeader(est, st, canEdit)}
      ${showReworkBanner ? renderReworkBanner(est) : ''}
      ${showDiff ? renderChangesDiff(diffData, est) : ''}
      ${renderSummaryCards(calcData)}
      ${renderCostBar(calcData)}
      ${renderObjectInfo(est)}
      ${canEdit ? renderEditableTable(calcData, est) : renderConsolidatedTable(calcData)}
      ${canEdit ? renderMimirChat() : ''}
      ${renderAnalogs(analogs)}
      ${renderComments(comments)}
      ${canAct ? renderActionPanel() : ''}
      ${canEdit ? renderPMActionPanel(canSend, canResubmit) : ''}
    </div>`;

    await layoutFn(body, { title: est.title || 'Просчёт #' + est.id });

    // ── Bind events ──
    bindObjectToggle();
    bindExcelExport(est, calcData);
    bindFilePreview();
    if (canEdit) {
      bindEditableTable(id, token, calcData);
      bindMimirChat(id, token);
      if (canSend) bindSendButton(id, token);
      if (canResubmit) bindResubmitButton(id, token);
    } else {
      bindTableExpand();
    }
    bindCommentSubmit(id, token, user);
    if (canAct) bindActionButtons(id, token, user);
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
  function renderHeader(est, st, canEdit) {
    const dl = est.deadline ? fmtDate(est.deadline) : '';
    const dlClass = deadlineClass(est.deadline);
    return `
    <div class="er-header">
      <div class="er-header-left">
        <h2>${esc(est.title || 'Просчёт #' + est.id)}</h2>
        <div class="er-header-sub">
          <span class="er-pill er-pill--${st.css}">${st.label}</span>
          ${est.pm_name ? '<span>' + esc(est.pm_name) + '</span>' : ''}
          ${est.current_version_no ? '<span>v.' + est.current_version_no + '</span>' : ''}
          ${dl ? '<span class="' + dlClass + '">Дедлайн: ' + dl + '</span>' : ''}
          ${est.work_type ? '<span class="er-wtype er-wtype--' + esc(est.work_type) + '">' + esc(WORK_TYPES[est.work_type] || est.work_type) + '</span>' : ''}
        </div>
      </div>
      <div class="er-header-right">
        ${canEdit ? '<button class="er-btn er-btn--mimir" id="erAutoCalcBtn">🧙 Авторасчёт</button>' : ''}
        <button class="er-btn er-btn--secondary" id="erExcelBtn">Excel</button>
        <a href="#/all-estimates" class="er-btn er-btn--secondary">← К списку</a>
      </div>
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
        ${renderFiles(est.documents || [])}
      </div>
    </div>`;
  }

  // ──────────────────────────────────────────────────────────────
  // COMPONENT: Files / Attachments
  // ──────────────────────────────────────────────────────────────
  const FILE_ICONS = {
    'application/pdf': '📄', 'application/msword': '📝', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '📝',
    'application/vnd.ms-excel': '📊', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '📊',
    'application/zip': '📦', 'application/x-rar-compressed': '📦', 'application/x-7z-compressed': '📦',
    'application/gzip': '📦', 'application/x-tar': '📦',
    'image/png': '🖼', 'image/jpeg': '🖼', 'image/gif': '🖼', 'image/webp': '🖼', 'image/svg+xml': '🖼'
  };
  const PREVIEWABLE_MIME = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
  const ARCHIVE_MIME = ['application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed', 'application/gzip', 'application/x-tar'];

  function fileIcon(mime) { return FILE_ICONS[mime] || '📎'; }
  function fileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' Б';
    if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' КБ';
    return (bytes / 1048576).toFixed(1) + ' МБ';
  }
  function fileDownloadUrl(doc) {
    return '/api/files/download/' + encodeURIComponent(doc.filename);
  }
  function isPreviewable(mime) { return PREVIEWABLE_MIME.includes(mime); }
  function isArchive(mime) { return ARCHIVE_MIME.includes(mime); }

  function renderFiles(docs) {
    if (!docs || !docs.length) return '';
    const items = docs.map(d => {
      const url = fileDownloadUrl(d);
      const icon = fileIcon(d.mime_type);
      const name = d.original_name || d.filename || 'Файл';
      const size = fileSize(d.size);
      const preview = isPreviewable(d.mime_type);
      const archive = isArchive(d.mime_type);

      return `
      <div class="er-file" data-file-id="${d.id}" data-mime="${esc(d.mime_type || '')}">
        <span class="er-file__icon">${icon}</span>
        <div class="er-file__info">
          <span class="er-file__name">${esc(name)}</span>
          ${size ? '<span class="er-file__size">' + size + '</span>' : ''}
        </div>
        <div class="er-file__actions">
          ${preview ? '<button class="er-file__btn er-file__btn--preview" data-url="' + esc(url) + '" data-mime="' + esc(d.mime_type) + '" data-name="' + esc(name) + '" title="Предпросмотр">👁</button>' : ''}
          <a href="${esc(url)}" download="${esc(name)}" class="er-file__btn" title="Скачать">⬇</a>
        </div>
      </div>`;
    }).join('');

    return `
    <div class="er-files">
      <div class="er-files__label">Вложения (${docs.length})</div>
      <div class="er-files__list">${items}</div>
    </div>
    <div class="er-file-preview-overlay" id="erFilePreviewOverlay" style="display:none">
      <div class="er-file-preview-modal" id="erFilePreviewModal">
        <div class="er-file-preview-header">
          <span id="erFilePreviewTitle"></span>
          <button class="er-file-preview-close" id="erFilePreviewClose">✕</button>
        </div>
        <div class="er-file-preview-body" id="erFilePreviewBody"></div>
      </div>
    </div>`;
  }

  function bindFilePreview() {
    const overlay = $('#erFilePreviewOverlay');
    if (!overlay) return;
    const modal = $('#erFilePreviewModal');
    const body = $('#erFilePreviewBody');
    const titleEl = $('#erFilePreviewTitle');
    const closeBtn = $('#erFilePreviewClose');

    // Preview buttons
    document.querySelectorAll('.er-file__btn--preview').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const url = btn.dataset.url;
        const mime = btn.dataset.mime;
        const name = btn.dataset.name;
        titleEl.textContent = name;

        if (mime === 'application/pdf') {
          body.innerHTML = '<iframe src="' + esc(url) + '#toolbar=1" class="er-file-preview-iframe"></iframe>';
        } else if (mime && mime.startsWith('image/')) {
          body.innerHTML = '<img src="' + esc(url) + '" class="er-file-preview-img" alt="' + esc(name) + '">';
        }
        overlay.style.display = 'flex';
      });
    });

    // Close
    closeBtn.addEventListener('click', () => { overlay.style.display = 'none'; body.innerHTML = ''; });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) AsgardUI.oopsBubble(e.clientX, e.clientY);
    });
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
  // COMPONENT: Rework Banner (shown to PM when director returned)
  // ──────────────────────────────────────────────────────────────
  function renderReworkBanner(est) {
    const actionLabel = est.approval_status === 'question' ? 'Вопрос директора' : 'Замечание директора';
    return `
    <div class="er-rework-banner">
      <div class="er-rework-banner__icon">↻</div>
      <div class="er-rework-banner__body">
        <div class="er-rework-banner__title">${actionLabel}</div>
        <div class="er-rework-banner__text">${esc(est.last_director_comment || '')}</div>
        ${est.director_name ? '<div class="er-rework-banner__who">' + esc(est.director_name) + '</div>' : ''}
      </div>
    </div>`;
  }

  // ──────────────────────────────────────────────────────────────
  // COMPONENT: Changes Diff (rework/question — compare versions)
  // ──────────────────────────────────────────────────────────────
  function renderChangesDiff(diffData, est) {
    const keys = Object.keys(diffData).sort();
    if (keys.length < 2) return '';
    const oldCalc = diffData[keys[0]];
    const newCalc = diffData[keys[1]];
    const v1 = oldCalc?.version_no || keys[0].replace('v', '');
    const v2 = newCalc?.version_no || keys[1].replace('v', '');

    const BLOCK_FIELDS = [
      { key: 'personnel_json', name: 'Персонал и ФОТ' },
      { key: 'current_costs_json', name: 'Текущие расходы' },
      { key: 'travel_json', name: 'Командировочные' },
      { key: 'transport_json', name: 'Транспорт' },
      { key: 'chemistry_json', name: 'Химия и утилизация' }
    ];
    const SCALAR_FIELDS = [
      { key: 'contingency_pct', name: 'Непредвиденные %' },
      { key: 'subtotal', name: 'Промежуточный итог', fmt: fmtMoney },
      { key: 'total_cost', name: 'Итого себестоимость', fmt: fmtMoney },
      { key: 'margin_pct', name: 'Маржа %' },
      { key: 'total_with_margin', name: 'Цена с наценкой', fmt: fmtMoney }
    ];

    const changes = [];

    // Compare JSONB blocks
    for (const bf of BLOCK_FIELDS) {
      const oldRows = parseJsonField(oldCalc?.[bf.key]);
      const newRows = parseJsonField(newCalc?.[bf.key]);
      const maxLen = Math.max(oldRows.length, newRows.length);
      for (let i = 0; i < maxLen; i++) {
        const oRow = oldRows[i];
        const nRow = newRows[i];
        if (!oRow && nRow) {
          changes.push({ block: bf.name, item: nRow.item || '—', field: '', old: '—', new_val: fmtMoney(nRow.total), type: 'added' });
        } else if (oRow && !nRow) {
          changes.push({ block: bf.name, item: oRow.item || '—', field: '', old: fmtMoney(oRow.total), new_val: 'удалено', type: 'removed' });
        } else if (oRow && nRow) {
          // Compare totals
          const oTotal = parseFloat(oRow.total) || 0;
          const nTotal = parseFloat(nRow.total) || 0;
          if (Math.abs(oTotal - nTotal) > 1) {
            changes.push({ block: bf.name, item: nRow.item || oRow.item || '—', field: 'итого', old: fmtMoney(oTotal), new_val: fmtMoney(nTotal) });
          }
          // Compare qty, rate, days
          for (const f of ['qty', 'rate', 'days', 'volume_m3', 'rate_m3', 'distance_km', 'rate_km']) {
            if (oRow[f] != null || nRow[f] != null) {
              const ov = parseFloat(oRow[f]) || 0;
              const nv = parseFloat(nRow[f]) || 0;
              if (Math.abs(ov - nv) > 0.01) {
                changes.push({ block: bf.name, item: nRow.item || oRow.item || '—', field: f, old: String(ov), new_val: String(nv) });
              }
            }
          }
        }
      }
    }

    // Compare scalar fields
    for (const sf of SCALAR_FIELDS) {
      const ov = parseFloat(oldCalc?.[sf.key]) || 0;
      const nv = parseFloat(newCalc?.[sf.key]) || 0;
      if (Math.abs(ov - nv) > 1) {
        const fmt = sf.fmt || String;
        changes.push({ block: 'Итоги', item: sf.name, field: '', old: fmt(ov), new_val: fmt(nv) });
      }
    }

    if (!changes.length) return '';

    const rows = changes.map(c => {
      const cls = c.type === 'added' ? ' er-diff__added' : c.type === 'removed' ? ' er-diff__removed' : '';
      return `<tr class="${cls}">
        <td class="er-diff__block">${esc(c.block)}</td>
        <td>${esc(c.item)}${c.field ? ' <span style="color:var(--t3);font-size:11px">(' + esc(c.field) + ')</span>' : ''}</td>
        <td class="er-diff__old"><s>${esc(c.old)}</s></td>
        <td class="er-diff__new"><b>${esc(c.new_val)}</b></td>
      </tr>`;
    }).join('');

    return `
    <div class="er-diff">
      <div class="er-diff__title">Изменения в v.${v2} (от v.${v1})</div>
      <table class="er-diff__table">
        <thead><tr><th>Блок</th><th>Позиция</th><th>Было</th><th>Стало</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  function parseJsonField(val) {
    if (!val) return [];
    if (typeof val === 'string') { try { return JSON.parse(val); } catch { return []; } }
    return Array.isArray(val) ? val : [];
  }

  // ──────────────────────────────────────────────────────────────
  // COMPONENT: Editable Calculation Table (PM view)
  // ──────────────────────────────────────────────────────────────
  function renderEditableTable(cd, est) {
    const blocks = cd.blocks || [];
    if (!blocks.length) return `
      <div class="er-empty">
        <p>Данные расчёта ещё не заполнены</p>
        <p style="font-size:12px;color:var(--t3);margin-top:4px">Нажмите «🧙 Авторасчёт» чтобы Мимир заполнил таблицу</p>
      </div>`;

    const total = blocks.reduce((s, b) => s + (b.subtotal || 0), 0);

    const blockHtml = blocks.map(b => {
      const meta = BLOCK_META[b.id] || { color: '#999' };
      const rows = b.rows || [];
      const isOpen = b.id === 'personnel' || b.id === 'chemistry'; // auto-expand first & chemistry

      const rowsHtml = rows.map((r, ri) => {
        const src = r.source ? `<span class="er-src er-src--${r.source}">${SRC_LABELS[r.source] || r.source}</span>` : '';
        const editable = r.editable || [];
        const inputCell = (field, val, unit) => {
          if (editable.includes(field)) {
            return `<input type="number" class="er-input" data-block="${b.id}" data-row="${ri}" data-field="${field}" value="${val || ''}" step="any">`;
          }
          return val != null ? String(val) : '—';
        };

        // Build description based on available fields
        let descCells = '';
        if (r.qty != null) descCells += `<td class="er-edit-cell">${inputCell('qty', r.qty)}</td>`;
        else descCells += '<td></td>';

        if (r.rate != null || r.rate_m3 != null || r.rate_kg != null || r.rate_km != null) {
          const rateField = r.rate_m3 != null ? 'rate_m3' : r.rate_kg != null ? 'rate_kg' : r.rate_km != null ? 'rate_km' : 'rate';
          const rateVal = r[rateField];
          descCells += `<td class="er-edit-cell">${inputCell(rateField, rateVal)}</td>`;
        } else descCells += '<td></td>';

        if (r.days != null) descCells += `<td class="er-edit-cell">${inputCell('days', r.days)}</td>`;
        else if (r.volume_m3 != null) descCells += `<td class="er-edit-cell">${inputCell('volume_m3', r.volume_m3)}</td>`;
        else if (r.percent != null) descCells += `<td>${r.percent}%</td>`;
        else descCells += '<td></td>';

        const totalEditable = editable.includes('total');
        const totalCell = totalEditable
          ? `<td class="er-edit-cell"><input type="number" class="er-input" data-block="${b.id}" data-row="${ri}" data-field="total" value="${r.total || ''}" step="any"></td>`
          : `<td class="er-edit-total">${fmtMoney(r.total)}</td>`;

        return `<tr>
          <td class="er-edit-item">${esc(r.item || '')} ${src}</td>
          ${descCells}
          ${totalCell}
        </tr>`;
      }).join('');

      return `
      <div class="er-eblock ${isOpen ? 'er-eblock--open' : ''}" data-block="${b.id}">
        <div class="er-eblock__header" data-toggle="${b.id}">
          <span class="er-eblock__dot" style="background:${meta.color}"></span>
          <span class="er-eblock__name">${esc(b.name)}</span>
          <span class="er-eblock__sum" id="erBlockSum_${b.id}">${fmtMoney(b.subtotal)}</span>
          <span class="er-eblock__chevron">▸</span>
        </div>
        <div class="er-eblock__body">
          <table class="er-etable">
            <thead><tr>
              <th>Позиция</th><th>Кол-во</th><th>Ставка</th><th>Дни/Объём</th><th>Итого</th>
            </tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>`;
    }).join('');

    return `
    <div class="er-editable" id="erEditable">
      ${blockHtml}
      <div class="er-editable__footer">
        <span>Итого себестоимость</span>
        <span class="er-editable__total" id="erTotalCost">${fmtMoney(total)}</span>
      </div>
    </div>`;
  }

  // ──────────────────────────────────────────────────────────────
  // COMPONENT: MimirChat (mini, below table for PM)
  // ──────────────────────────────────────────────────────────────
  function renderMimirChat() {
    return `
    <div class="er-mimir" id="erMimir">
      <div class="er-mimir__header">
        <span class="er-mimir__avatar">M</span>
        <span class="er-mimir__name">Мимир — ассистент расчёта</span>
      </div>
      <div class="er-mimir__body" id="erMimirBody">
        <div class="er-mimir__hint">Мимир подскажет по химии, тарифам и логистике. Напишите вопрос или нажмите «Авторасчёт».</div>
      </div>
      <div class="er-mimir__legend">
        <span class="er-src er-src--tariff">тариф</span> надёжный источник
        <span class="er-src er-src--mimir" style="margin-left:8px">Мимир</span> требует проверки
        <span class="er-src er-src--fixed" style="margin-left:8px">фикс.</span> константа
      </div>
      <div class="er-mimir__input">
        <input type="text" id="erMimirInput" placeholder="Спросить Мимира..." />
        <button class="er-mimir__send" id="erMimirSend">↗</button>
      </div>
    </div>`;
  }

  // ──────────────────────────────────────────────────────────────
  // COMPONENT: PM Action Panel (draft/rework)
  // ──────────────────────────────────────────────────────────────
  function renderPMActionPanel(canSend, canResubmit) {
    if (canSend) {
      return `
      <div class="er-pm-actions" id="erPMActions">
        <button class="er-btn er-btn--send" id="erSendBtn">Отправить на согласование →</button>
      </div>`;
    }
    if (canResubmit) {
      return `
      <div class="er-pm-actions" id="erPMActions">
        <button class="er-btn er-btn--resubmit" id="erResubmitBtn">Отправить повторно на согласование →</button>
      </div>`;
    }
    return '';
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

  // (renderResubmitPanel removed — replaced by renderPMActionPanel)

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

  function bindExcelExport(est, calcData) {
    const btn = document.getElementById('erExcelBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      try { exportToExcel(est, calcData); } catch (e) { toast('Ошибка экспорта: ' + e.message, 'error'); }
    });
  }

  function exportToExcel(est, cd) {
    if (typeof XLSX === 'undefined') { toast('SheetJS не загружен', 'error'); return; }
    const wb = XLSX.utils.book_new();

    // ── Sheet 1: Расчёт ──
    const calcRows = [];
    const blocks = cd.blocks || [];

    // Header row
    calcRows.push(['Просчёт #' + est.id + ': ' + (est.title || '')]);
    calcRows.push(['Дата экспорта: ' + new Date().toLocaleDateString('ru-RU')]);
    calcRows.push([]);

    for (const b of blocks) {
      const meta = BLOCK_META[b.id] || {};
      calcRows.push([meta.name || b.name || b.id, '', '', '', '']);
      calcRows.push(['Позиция', 'Кол-во', 'Ставка', 'Дни/Объём', 'Итого']);
      for (const r of (b.rows || [])) {
        const col2 = r.qty != null ? r.qty : '';
        const col3 = r.rate || r.rate_m3 || r.rate_kg || r.rate_km || '';
        const col4 = r.days || r.volume_m3 || (r.percent ? r.percent + '%' : '') || '';
        calcRows.push([r.item || '', col2, col3, col4, r.total || 0]);
      }
      calcRows.push(['Итого ' + (meta.name || b.name || ''), '', '', '', b.subtotal || 0]);
      calcRows.push([]);
    }

    const total = blocks.reduce((s, b) => s + (b.subtotal || 0), 0);
    calcRows.push(['ИТОГО СЕБЕСТОИМОСТЬ', '', '', '', total]);

    const ws1 = XLSX.utils.aoa_to_sheet(calcRows);
    // Column widths
    ws1['!cols'] = [{ wch: 35 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws1, 'Расчёт');

    // ── Sheet 2: Сводка ──
    const s = cd.summary || {};
    const summaryRows = [
      ['СВОДКА ПРОСЧЁТА'],
      [],
      ['Просчёт', est.title || 'Просчёт #' + est.id],
      ['Статус', (STATUS[est.approval_status] || {}).label || est.approval_status || '—'],
      ['РП', est.pm_name || '—'],
      ['Версия', est.current_version_no || 1],
      ['Дедлайн', est.deadline ? fmtDate(est.deadline) : '—'],
      [],
      ['Заказчик', est.customer || '—'],
      ['Город', est.object_city || '—'],
      ['Расстояние', est.object_distance_km ? est.object_distance_km + ' км' : '—'],
      ['Тип работ', est.work_type || '—'],
      ['Бригада', est.crew_count ? est.crew_count + ' чел.' : '—'],
      ['Рабочих дней', est.work_days || '—'],
      ['Дней дороги', est.road_days || '—'],
      [],
      ['ФИНАНСЫ'],
      ['Себестоимость', s.cost_no_vat || 0],
      ['Наценка', '×' + (s.markup || 1).toFixed(1)],
      ['Цена клиенту', s.price_no_vat || 0],
      ['Маржа ₽', s.margin_rub || 0],
      ['Маржа %', (s.margin_pct || 0).toFixed(1) + '%']
    ];

    // Block breakdown
    summaryRows.push([], ['СТРУКТУРА СЕБЕСТОИМОСТИ']);
    for (const b of blocks) {
      const meta = BLOCK_META[b.id] || {};
      const pct = total > 0 ? ((b.subtotal || 0) / total * 100).toFixed(1) : '0';
      summaryRows.push([meta.name || b.name || b.id, b.subtotal || 0, pct + '%']);
    }

    const ws2 = XLSX.utils.aoa_to_sheet(summaryRows);
    ws2['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Сводка');

    // Download
    const filename = 'Просчёт_' + est.id + '_v' + (est.current_version_no || 1) + '.xlsx';
    XLSX.writeFile(wb, filename);
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

  // ──────────────────────────────────────────────────────────────
  // PM BINDINGS: Editable table, Mimir chat, Send/Resubmit
  // ──────────────────────────────────────────────────────────────
  let _calcData = null; // live reference for recalculation
  let _saveTimer = null;

  function bindEditableTable(estimateId, token, calcData) {
    _calcData = calcData;

    // Toggle blocks
    document.querySelectorAll('.er-eblock__header[data-toggle]').forEach(hdr => {
      hdr.addEventListener('click', () => {
        hdr.parentElement.classList.toggle('er-eblock--open');
      });
    });

    // Input change → recalculate
    document.querySelectorAll('.er-input').forEach(input => {
      input.addEventListener('input', () => {
        const blockId = input.dataset.block;
        const rowIdx = parseInt(input.dataset.row);
        const field = input.dataset.field;
        const val = parseFloat(input.value) || 0;

        // Update calcData
        const block = _calcData.blocks.find(b => b.id === blockId);
        if (!block || !block.rows[rowIdx]) return;
        const row = block.rows[rowIdx];
        row[field] = val;

        // Recalculate row total
        recalcRow(row);

        // Recalculate block subtotal
        block.subtotal = block.rows.reduce((s, r) => s + (parseFloat(r.total) || 0), 0);

        // Update DOM
        const sumEl = document.getElementById('erBlockSum_' + blockId);
        if (sumEl) { sumEl.textContent = fmtMoney(block.subtotal); sumEl.classList.add('er-flash'); setTimeout(() => sumEl.classList.remove('er-flash'), 500); }

        // Recalc total
        const total = _calcData.blocks.reduce((s, b) => s + (b.subtotal || 0), 0);
        const totalEl = document.getElementById('erTotalCost');
        if (totalEl) { totalEl.textContent = fmtMoney(total); totalEl.classList.add('er-flash'); setTimeout(() => totalEl.classList.remove('er-flash'), 500); }

        // Update summary cards
        if (_calcData.summary) {
          _calcData.summary.cost_no_vat = total;
          const markup = _calcData.summary.markup || 1;
          _calcData.summary.price_no_vat = total * markup;
          _calcData.summary.margin_rub = _calcData.summary.price_no_vat - total;
          _calcData.summary.margin_pct = total > 0 ? ((_calcData.summary.price_no_vat - total) / total * 100) : 0;
        }

        // Debounced save
        clearTimeout(_saveTimer);
        _saveTimer = setTimeout(() => saveCalculation(estimateId, token), 2000);
      });
    });
  }

  function recalcRow(r) {
    // Per-row recalculation based on available fields (Mimir engine rules)
    if (r.qty != null && r.rate != null && r.days != null) {
      r.total = r.qty * r.rate * r.days;
    } else if (r.qty != null && r.rate != null) {
      r.total = r.qty * r.rate;
    } else if (r.volume_m3 != null && r.rate_m3 != null) {
      r.total = r.volume_m3 * r.rate_m3;
    } else if (r.qty_kg != null && r.rate_kg != null) {
      r.total = r.qty_kg * r.rate_kg;
    } else if (r.distance_km != null && r.rate_km != null) {
      r.total = r.distance_km * 2 * r.rate_km; // round trip
      if (r.round_trip === false) r.total = r.distance_km * r.rate_km;
    } else if (r.percent != null && r.base != null) {
      r.total = r.base * r.percent / 100;
    } else if (r.percent != null) {
      // Contingency — percent of all other blocks
      // Will be recalculated in full recalc pass
    }
    // If editable=['total'] — user sets total directly, don't recalculate
  }

  async function saveCalculation(estimateId, token) {
    if (!_calcData) return;
    try {
      // Build JSONB columns from calcData blocks
      const findBlock = (id) => (_calcData.blocks.find(b => b.id === id) || {}).rows || [];
      const contBlock = _calcData.blocks.find(b => b.id === 'contingency');
      const contPct = contBlock?.rows?.[0]?.percent || 5;

      const subtotal = _calcData.blocks.filter(b => b.id !== 'contingency').reduce((s, b) => s + (b.subtotal || 0), 0);
      const contingencyAmount = subtotal * contPct / 100;
      const totalCost = subtotal + contingencyAmount;
      const marginPct = _calcData.summary?.margin_pct || 0;
      const totalWithMargin = marginPct > 0 ? totalCost * (1 + marginPct / 100) : totalCost * (_calcData.summary?.markup || 1);

      await api('PUT', '/estimates/' + estimateId + '/calculation', token, {
        personnel_json: findBlock('personnel'),
        current_costs_json: findBlock('current'),
        travel_json: findBlock('travel'),
        transport_json: findBlock('transport'),
        chemistry_json: findBlock('chemistry'),
        contingency_pct: contPct,
        margin_pct: marginPct,
        notes: _calcData.notes || ''
      });
    } catch (e) {
      console.error('[EstReport] Save failed:', e);
    }
  }

  function bindMimirChat(estimateId, token) {
    const input = document.getElementById('erMimirInput');
    const sendBtn = document.getElementById('erMimirSend');
    const body = document.getElementById('erMimirBody');
    if (!input || !sendBtn || !body) return;

    const sendMsg = async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';

      // Add user message
      body.insertAdjacentHTML('beforeend', `<div class="er-mimir__msg er-mimir__msg--user">${esc(text)}</div>`);

      // Add typing indicator
      body.insertAdjacentHTML('beforeend', '<div class="er-mimir__msg er-mimir__msg--typing" id="erMimirTyping">Мимир думает…</div>');
      body.scrollTop = body.scrollHeight;

      try {
        const res = await api('POST', '/mimir/chat', token, {
          message: text,
          context: { estimate_id: estimateId, type: 'calculation' }
        });
        const typing = document.getElementById('erMimirTyping');
        if (typing) typing.remove();
        const reply = res.reply || res.message || 'Без ответа';
        body.insertAdjacentHTML('beforeend', `<div class="er-mimir__msg er-mimir__msg--bot">${esc(reply)}</div>`);
      } catch (e) {
        const typing = document.getElementById('erMimirTyping');
        if (typing) typing.remove();
        body.insertAdjacentHTML('beforeend', `<div class="er-mimir__msg er-mimir__msg--bot" style="color:var(--red)">Ошибка: ${esc(e.message)}</div>`);
      }
      body.scrollTop = body.scrollHeight;
    };

    sendBtn.addEventListener('click', sendMsg);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendMsg(); } });

    // Auto-calculate button
    const autoBtn = document.getElementById('erAutoCalcBtn');
    if (autoBtn) {
      autoBtn.addEventListener('click', async () => {
        autoBtn.disabled = true;
        autoBtn.textContent = '🧙 Считаю…';
        try {
          const res = await api('POST', '/estimates/' + estimateId + '/auto-calculate', token, {});
          toast('Авторасчёт завершён', 'ok');
          setTimeout(() => location.reload(), 500);
        } catch (e) {
          toast('Ошибка авторасчёта: ' + e.message, 'error');
          autoBtn.disabled = false;
          autoBtn.textContent = '🧙 Авторасчёт';
        }
      });
    }
  }

  function bindSendButton(estimateId, token) {
    const btn = document.getElementById('erSendBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      if (!confirm('Отправить просчёт на согласование директору?')) return;
      btn.disabled = true;
      try {
        // Save calculation first
        await saveCalculation(estimateId, token);
        // Then send for approval
        await api('POST', '/approval/estimates/' + estimateId + '/send', token, {});
        toast('Отправлено на согласование', 'ok');
        setTimeout(() => location.reload(), 500);
      } catch (e) {
        toast(e.message, 'error');
        btn.disabled = false;
      }
    });
  }

  function bindResubmitButton(estimateId, token) {
    const btn = document.getElementById('erResubmitBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      if (!confirm('Отправить просчёт повторно на согласование?')) return;
      btn.disabled = true;
      try {
        await saveCalculation(estimateId, token);
        await api('POST', '/approval/estimates/' + estimateId + '/resubmit', token, {});
        toast('Отправлено на согласование', 'ok');
        setTimeout(() => location.reload(), 500);
      } catch (e) {
        toast(e.message, 'error');
        btn.disabled = false;
      }
    });
  }

  return { render };
})();
