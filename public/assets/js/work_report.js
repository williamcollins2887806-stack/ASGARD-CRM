/**
 * ASGARD CRM — Финансовый отчёт работы (WOW-страница)
 * ════════════════════════════════════════════════════
 * Маршрут: #/work-report?id=123
 * Компоненты: Hero, KPI Strip, Donut, Waterfall, Accordion,
 *             VAT/Taxes/Profit, Timeline, Crew, Payments, Excel Export
 */
window.AsgardWorkReport = (function () {
  'use strict';

  const { $, $$, esc, toast, money } = AsgardUI;

  const DIRECTOR_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

  const CAT_LABELS = {
    payroll: { label: 'ФОТ (начислено)', icon: '\uD83D\uDC77', color: '#e74c3c' },
    fot:     { label: 'ФОТ (начислено)', icon: '\uD83D\uDC77', color: '#e74c3c' },
    cash:    { label: 'Наличные',        icon: '\uD83D\uDCB5', color: '#e67e22' },
    per_diem:{ label: 'Суточные',        icon: '\uD83C\uDF7D', color: '#f39c12' },
    logistics:{ label: 'Билеты/логистика', icon: '\uD83D\uDE9A', color: '#3498db' },
    accommodation:{ label: 'Проживание',  icon: '\uD83C\uDFE8', color: '#2980b9' },
    transfer:{ label: 'Трансфер',        icon: '\uD83D\uDE97', color: '#1abc9c' },
    chemicals:{ label: 'Химия/материалы', icon: '\uD83E\uDDEA', color: '#9b59b6' },
    equipment:{ label: 'Оборудование',   icon: '\uD83D\uDD27', color: '#8e44ad' },
    materials:{ label: 'Материалы',       icon: '\uD83D\uDCE6', color: '#16a085' },
    subcontract:{ label: 'Субподряд',     icon: '\uD83E\uDD1D', color: '#d35400' },
    other:   { label: 'Прочие',          icon: '\uD83D\uDCCB', color: '#7f8c8d' },
    tickets: { label: 'Билеты',          icon: '\u2708',        color: '#2ecc71' },
  };

  // 12 distinct chart colors
  const CHART_COLORS = [
    '#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c',
    '#e67e22','#2980b9','#d35400','#16a085','#8e44ad','#7f8c8d'
  ];

  // ── API helper ──
  function hdr() {
    const t = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token');
    return { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' };
  }
  async function api(path) {
    const res = await fetch('/api' + path, { headers: hdr() });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Ошибка API'); }
    return res.json();
  }

  // ── money shorthand ──
  function m(v) { return money(Math.round(v || 0)); }

  function fmtDate(s) {
    if (!s) return '\u2014';
    const parts = s.split('T')[0].split('-');
    return parts[2] + '.' + parts[1] + '.' + parts[0];
  }

  function daysBetween(a, b) {
    if (!a || !b) return null;
    const da = new Date(a.split('T')[0] + 'T12:00:00');
    const db = new Date(b.split('T')[0] + 'T12:00:00');
    return Math.round((db - da) / 86400000);
  }

  function pct(val, total) {
    if (!total) return 0;
    return Math.round(val / total * 1000) / 10;
  }

  // ════════════════════════════════════════
  //  RENDER (entry point)
  // ════════════════════════════════════════
  async function render({ layout, title, query }) {
    const workId = query && (query.id || query.get && query.get('id'));
    if (!workId) {
      await layout('<div class="help" style="padding:60px;text-align:center">Не указан ID работы</div>', { title });
      return;
    }

    await layout('<div id="wrPage"><div class="wr-loading"><div class="wr-spinner"></div>Загрузка финансовых данных...</div></div>', { title });

    try {
      const data = await api('/works/' + workId + '/financial-summary');
      const container = document.getElementById('wrPage');
      if (!container) return;
      container.innerHTML = renderStyles() + renderPage(data);
      observeCountUps();
      bindAccordions();
      bindExport(data);
    } catch (e) {
      const c = document.getElementById('wrPage');
      if (c) c.innerHTML = renderStyles() + '<div class="wr-error">' + esc(e.message) + '</div>';
    }
  }

  // ════════════════════════════════════════
  //  FULL PAGE HTML
  // ════════════════════════════════════════
  function renderPage(d) {
    return [
      renderHero(d),
      renderKpiStrip(d),
      '<div class="wr-grid">',
        '<div class="wr-grid-main">',
          renderDonut(d),
          renderExpenseAccordion(d),
          renderVatBlock(d),
          renderTaxBlock(d),
          renderProfitBlock(d),
        '</div>',
        '<div class="wr-grid-side">',
          renderWaterfall(d),
          renderTimeline(d),
          renderPlanVsFact(d),
          renderCrew(d),
        '</div>',
      '</div>',
      renderPayments(d),
      renderExportButton(d),
    ].join('');
  }

  // ════════════════════════════════════════
  //  1. HERO
  // ════════════════════════════════════════
  function renderHero(d) {
    const wm = d.work_meta || {};
    const marginColor = d.profit.margin >= 25 ? '#10b981' : d.profit.margin >= 15 ? '#d4a843' : '#ef4444';
    const statusMap = {
      'Новая': '#64748b', 'Подготовка': '#3b82f6', 'Мобилизация': '#8b5cf6',
      'В работе': '#f59e0b', 'Подписание акта': '#f97316', 'Работы сдали': '#10b981',
      'Закрыт': '#6b7280', 'На паузе': '#94a3b8'
    };
    const statusColor = statusMap[wm.work_status] || '#64748b';

    return `<div class="wr-hero">
      <div class="wr-hero-bg"></div>
      <div class="wr-hero-content">
        <div class="wr-hero-top">
          <div>
            <div class="wr-hero-number">${esc(wm.work_number ? 'Работа #' + wm.work_number : 'Работа #' + d.work_id)}</div>
            <h1 class="wr-hero-title">${esc(d.work_title || 'Без названия')}</h1>
            <div class="wr-hero-meta">
              ${wm.customer_name ? '<span>' + esc(wm.customer_name) + '</span>' : ''}
              ${wm.customer_inn ? '<span class="wr-hero-inn">ИНН ' + esc(wm.customer_inn) + '</span>' : ''}
              ${wm.city ? '<span>' + esc(wm.city) + '</span>' : ''}
              ${wm.object_name ? '<span>' + esc(wm.object_name) + '</span>' : ''}
            </div>
            ${wm.pm_name ? '<div class="wr-hero-pm">РП: <strong>' + esc(wm.pm_name) + '</strong></div>' : ''}
          </div>
          <div class="wr-hero-right">
            <div class="wr-hero-status" style="background:${statusColor}">${esc(wm.work_status || '—')}</div>
            <div class="wr-hero-margin-label">Маржа</div>
            <div class="wr-hero-margin" style="color:${marginColor}">${d.profit.margin}%</div>
          </div>
        </div>
      </div>
    </div>`;
  }

  // ════════════════════════════════════════
  //  2. KPI STRIP (4 cards + countup)
  // ════════════════════════════════════════
  function renderKpiStrip(d) {
    const profitColor = d.profit.net >= 0 ? '#10b981' : '#ef4444';
    const marginColor = d.profit.margin >= 25 ? '#10b981' : d.profit.margin >= 15 ? '#d4a843' : '#ef4444';

    const cards = [
      { label: 'Выручка', value: d.revenue.with_vat, sub: 'Без НДС: ' + m(d.revenue.ex_vat) + ' \u20BD', icon: svgRevenue(), color: '#3b82f6' },
      { label: 'Расходы + налоги', value: d.expenses.total_with_tax, sub: 'Расходы: ' + m(d.expenses.total) + ' \u20BD', icon: svgExpense(), color: '#ef4444' },
      { label: 'Чистая прибыль', value: d.profit.net, sub: 'До налога: ' + m(d.profit.before_tax) + ' \u20BD', icon: svgProfit(), color: profitColor },
      { label: 'Маржа', value: d.profit.margin, suffix: '%', sub: 'НДС: ' + d.vat_pct + '%', icon: renderGaugeMini(d.profit.margin), color: marginColor, isGauge: true },
    ];

    return '<div class="wr-kpi-strip">' + cards.map(c => `
      <div class="wr-kpi-card">
        <div class="wr-kpi-icon">${c.icon}</div>
        <div class="wr-kpi-body">
          <div class="wr-kpi-label">${c.label}</div>
          <div class="wr-kpi-value" style="color:${c.color}">
            <span class="wr-countup" data-target="${c.value}">${c.isGauge ? '0' : '0'}</span>${c.suffix ? c.suffix : ' \u20BD'}
          </div>
          <div class="wr-kpi-sub">${c.sub}</div>
        </div>
      </div>
    `).join('') + '</div>';
  }

  // mini gauge SVG for margin (44x28, semicircle with 3 color zones + needle)
  function renderGaugeMini(margin) {
    var cx = 22, cy = 24, r = 16;
    var clamp = Math.min(Math.max(margin, 0), 50);
    var halfC = Math.PI * r;
    var arcP = 'M ' + (cx - r) + ' ' + cy + ' A ' + r + ' ' + r + ' 0 0 1 ' + (cx + r) + ' ' + cy;
    // Needle: angle from π (left) to 0 (right)
    var angle = Math.PI - (clamp / 50) * Math.PI;
    var nx = cx + (r + 3) * Math.cos(angle);
    var ny = cy - (r + 3) * Math.sin(angle);
    var nc = clamp >= 25 ? '#10b981' : clamp >= 15 ? '#d4a843' : '#ef4444';
    return '<svg width="44" height="28" viewBox="0 0 44 28">' +
      '<path d="' + arcP + '" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="4"/>' +
      '<path d="' + arcP + '" fill="none" stroke="#ef4444" stroke-width="4" stroke-dasharray="' + (0.3*halfC) + ' ' + (0.7*halfC) + '" opacity="0.4"/>' +
      '<path d="' + arcP + '" fill="none" stroke="#f59e0b" stroke-width="4" stroke-dasharray="' + (0.2*halfC) + ' ' + (0.8*halfC) + '" stroke-dashoffset="-' + (0.3*halfC) + '" opacity="0.4"/>' +
      '<path d="' + arcP + '" fill="none" stroke="#10b981" stroke-width="4" stroke-dasharray="' + (0.5*halfC) + ' ' + (0.5*halfC) + '" stroke-dashoffset="-' + (0.5*halfC) + '" opacity="0.4"/>' +
      '<line x1="' + cx + '" y1="' + cy + '" x2="' + nx.toFixed(1) + '" y2="' + ny.toFixed(1) + '" stroke="' + nc + '" stroke-width="2" stroke-linecap="round"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="2" fill="' + nc + '"/>' +
      '</svg>';
  }

  function svgRevenue() {
    return '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>';
  }
  function svgExpense() {
    return '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>';
  }
  function svgProfit() {
    // Знак рубля ₽ вместо доллара $
    return '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M6 12h8a5 5 0 0 0 0-10H8v20"/><line x1="5" y1="12" x2="16" y2="12"/><line x1="5" y1="16" x2="12" y2="16"/></svg>';
  }

  // ════════════════════════════════════════
  //  3. DONUT CHART (expenses by category)
  // ════════════════════════════════════════
  function renderDonut(d) {
    const cats = d.expenses.categories || [];
    if (cats.length === 0) return '<div class="wr-card"><div class="wr-card-title">Структура расходов</div><div class="wr-empty">Нет расходов</div></div>';

    const total = d.expenses.total || 1;
    const R = 75, CX = 100, CY = 100, SW = 35;
    const CIRC = 2 * Math.PI * R;
    // Отступ между сегментами = 4px длины дуги
    const GAP_PX = 4;
    const totalGapLen = GAP_PX * cats.length;
    const usableLen = CIRC - totalGapLen;

    // SVG circle рисуется ОТ 3 часов по часовой стрелке.
    // stroke-dashoffset сдвигает НАЗАД. Начнём с 12 часов (сдвиг на четверть).
    const startOffset = CIRC / 4;
    let accumulated = 0;

    const segments = cats.map((c, i) => {
      const frac = c.sum / total;
      const segLen = frac * usableLen;
      const dashOffset = startOffset - accumulated;
      accumulated += segLen + GAP_PX;
      const ci = CHART_COLORS[i % CHART_COLORS.length];
      return '<circle cx="' + CX + '" cy="' + CY + '" r="' + R + '" fill="none" stroke="' + ci + '" stroke-width="' + SW + '"' +
        ' stroke-dasharray="' + segLen + ' ' + (CIRC - segLen) + '"' +
        ' stroke-dashoffset="' + dashOffset + '"' +
        ' style="cursor:pointer;transition:opacity .2s" data-idx="' + i + '"/>';
    });

    const legend = cats.map((c, i) => {
      const info = CAT_LABELS[c.category] || { label: c.category, icon: '\uD83D\uDCCB' };
      const ci = CHART_COLORS[i % CHART_COLORS.length];
      return '<div class="wr-donut-legend-item" data-idx="' + i + '">' +
        '<span class="wr-donut-dot" style="background:' + ci + '"></span>' +
        '<span class="wr-donut-legend-label">' + esc(info.label) + '</span>' +
        '<span class="wr-donut-legend-val">' + m(c.sum) + ' \u20BD</span>' +
        '<span style="color:var(--t3);font-size:11px;min-width:36px;text-align:right">' + pct(c.sum, total) + '%</span>' +
        '</div>';
    });

    return '<div class="wr-card">' +
      '<div class="wr-card-title">Структура расходов</div>' +
      '<div class="wr-donut-wrap">' +
        '<svg viewBox="0 0 200 200" class="wr-donut-svg">' +
          segments.join('') +
          '<text x="' + CX + '" y="' + (CY - 8) + '" text-anchor="middle" class="wr-donut-total-label">Итого</text>' +
          '<text x="' + CX + '" y="' + (CY + 14) + '" text-anchor="middle" class="wr-donut-total-val">' + m(total) + ' \u20BD</text>' +
        '</svg>' +
        '<div class="wr-donut-legend">' + legend.join('') + '</div>' +
      '</div>' +
    '</div>';
  }

  // ════════════════════════════════════════
  //  4. EXPENSE ACCORDION
  // ════════════════════════════════════════
  function renderExpenseAccordion(d) {
    const cats = d.expenses.categories || [];
    if (cats.length === 0) return '';

    const rows = cats.map((c, i) => {
      const info = CAT_LABELS[c.category] || { label: c.category, icon: '\uD83D\uDCCB', color: '#7f8c8d' };
      const ci = CHART_COLORS[i % CHART_COLORS.length];
      const barW = pct(c.sum, d.expenses.total);

      const taxLabel = c.taxBurden > 0
        ? '<span class="wr-acc-tax">+' + m(c.taxBurden) + ' (' + d.taxes.rate + '%)</span>'
        : '';
      const vatLabel = c.vatDeductible > 0
        ? '<span class="wr-acc-vat">' + m(c.vatDeductible) + ' НДС к вычету</span>'
        : '';

      // Items table
      let itemsHtml = '';
      if (c.items && c.items.length > 0) {
        const trs = c.items.map(it => `<tr>
          <td>${esc(it.supplier || '\u2014')}</td>
          <td class="wr-r">${m(it.amount)} \u20BD</td>
          <td>${esc(it.comment || '')}</td>
          <td>${esc(it.doc_number || '\u2014')}</td>
          <td>${it.invoice_received ? '\u2705' : it.invoice_needed ? '\u23F3' : '\u2014'}</td>
        </tr>`).join('');

        itemsHtml = `<div class="wr-acc-body">
          <table class="wr-acc-table">
            <thead><tr><th>Поставщик</th><th class="wr-r">Сумма</th><th>Комментарий</th><th>Документ</th><th>С/Ф</th></tr></thead>
            <tbody>${trs}</tbody>
          </table>
        </div>`;
      }

      return `<div class="wr-acc" data-open="0">
        <div class="wr-acc-head" data-toggle>
          <div class="wr-acc-bar-bg"><div class="wr-acc-bar" style="width:${barW}%;background:${ci}"></div></div>
          <div class="wr-acc-info">
            <span class="wr-acc-icon">${info.icon}</span>
            <span class="wr-acc-name">${esc(info.label)}</span>
            <span class="wr-acc-count">${c.count} шт</span>
            ${taxLabel}${vatLabel}
          </div>
          <div class="wr-acc-sum">${m(c.sum)} \u20BD</div>
          <div class="wr-acc-chevron">\u25B6</div>
        </div>
        ${itemsHtml}
      </div>`;
    });

    // Totals
    const totalRow = `<div class="wr-acc-total">
      <span>Итого расходов</span>
      <span>${m(d.expenses.total)} \u20BD</span>
    </div>
    <div class="wr-acc-total-sub">
      <span>С учётом налогов (${d.taxes.rate}%)</span>
      <span>${m(d.expenses.total_with_tax)} \u20BD</span>
    </div>`;

    return `<div class="wr-card">
      <div class="wr-card-title">Расходы по категориям</div>
      ${rows.join('')}
      ${totalRow}
    </div>`;
  }

  // ════════════════════════════════════════
  //  5. VAT BLOCK
  // ════════════════════════════════════════
  function renderVatBlock(d) {
    return `<div class="wr-card">
      <div class="wr-card-title">НДС</div>
      <div class="wr-row"><span>НДС начисленный</span><span>${m(d.vat.charged)} \u20BD</span></div>
      <div class="wr-row-desc">Выручка ${m(d.revenue.with_vat)} \u00D7 ${d.vat_pct}/${100 + Math.round(d.vat_pct)}</div>
      <div class="wr-row"><span>НДС к вычету</span><span class="wr-blue">${m(d.vat.deductible)} \u20BD</span></div>
      <div class="wr-row-desc">Из безналичных расходов с НДС</div>
      <div class="wr-row wr-row-bold"><span>НДС к уплате</span><span class="wr-red">${m(d.vat.payable)} \u20BD</span></div>
    </div>`;
  }

  // ════════════════════════════════════════
  //  6. TAX BLOCK
  // ════════════════════════════════════════
  function renderTaxBlock(d) {
    return `<div class="wr-card">
      <div class="wr-card-title">Налоговая нагрузка</div>
      <div class="wr-row wr-row-bold"><span>НДФЛ + взносы / обналичка (${d.taxes.rate}%)</span><span class="wr-red">${m(d.taxes.burden)} \u20BD</span></div>
      <div class="wr-row-desc">На ФОТ, наличные, суточные, субподряд</div>
    </div>`;
  }

  // ════════════════════════════════════════
  //  7. PROFIT BLOCK (formula + gauge)
  // ════════════════════════════════════════
  function renderProfitBlock(d) {
    const profitColor = d.profit.net >= 0 ? '#10b981' : '#ef4444';
    const marginColor = d.profit.margin >= 25 ? '#10b981' : d.profit.margin >= 15 ? '#d4a843' : '#ef4444';

    // Простой gauge через полукруг (path) + stroke-dasharray
    // Полукруг от левого к правому через верх, R=60, центр (100, 75)
    const R = 60, CX = 100, CY = 75, SW = 10;
    const halfCirc = Math.PI * R; // длина полукруга
    // Зоны: 0-15% красная, 15-25% жёлтая, 25-50% зелёная
    // В единицах полукруга: 15/50=30%, 10/50=20%, 25/50=50%
    const zoneRed = 0.3 * halfCirc;
    const zoneYel = 0.2 * halfCirc;
    const zoneGrn = 0.5 * halfCirc;
    // Путь полукруга: от (CX-R, CY) через верх к (CX+R, CY)
    const arcPath = 'M ' + (CX - R) + ' ' + CY + ' A ' + R + ' ' + R + ' 0 0 1 ' + (CX + R) + ' ' + CY;

    // Стрелка: линия от центра к позиции margin на дуге
    const clamp = Math.min(Math.max(d.profit.margin, 0), 50);
    const angle = Math.PI - (clamp / 50) * Math.PI; // π..0 (лево→право)
    const nx = CX + (R + 8) * Math.cos(angle);
    const ny = CY - (R + 8) * Math.sin(angle);
    const nbx = CX + 12 * Math.cos(angle);
    const nby = CY - 12 * Math.sin(angle);

    const gaugeSvg = '<svg viewBox="0 0 200 100" style="width:100%;max-width:200px;height:auto">' +
      '<path d="' + arcPath + '" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="' + SW + '" stroke-linecap="round"/>' +
      '<path d="' + arcPath + '" fill="none" stroke="#ef4444" stroke-width="' + SW + '" stroke-dasharray="' + zoneRed + ' ' + (halfCirc - zoneRed) + '" stroke-dashoffset="0" opacity="0.4" stroke-linecap="butt"/>' +
      '<path d="' + arcPath + '" fill="none" stroke="#f59e0b" stroke-width="' + SW + '" stroke-dasharray="' + zoneYel + ' ' + (halfCirc - zoneYel) + '" stroke-dashoffset="-' + zoneRed + '" opacity="0.4" stroke-linecap="butt"/>' +
      '<path d="' + arcPath + '" fill="none" stroke="#10b981" stroke-width="' + SW + '" stroke-dasharray="' + zoneGrn + ' ' + (halfCirc - zoneGrn) + '" stroke-dashoffset="-' + (zoneRed + zoneYel) + '" opacity="0.4" stroke-linecap="butt"/>' +
      '<line x1="' + nbx.toFixed(1) + '" y1="' + nby.toFixed(1) + '" x2="' + nx.toFixed(1) + '" y2="' + ny.toFixed(1) + '" stroke="' + marginColor + '" stroke-width="3" stroke-linecap="round"/>' +
      '<circle cx="' + CX + '" cy="' + CY + '" r="5" fill="' + marginColor + '"/>' +
      '<text x="' + CX + '" y="' + (CY - 18) + '" text-anchor="middle" fill="' + marginColor + '" font-size="22" font-weight="700">' + d.profit.margin + '%</text>' +
      '<text x="' + CX + '" y="' + (CY - 4) + '" text-anchor="middle" fill="rgba(184,196,231,.7)" font-size="10">маржа</text>' +
      '<text x="' + (CX - R + 5) + '" y="' + (CY + 14) + '" text-anchor="start" fill="#ef4444" font-size="8" opacity="0.6">Плохо</text>' +
      '<text x="' + CX + '" y="' + (CY + 14) + '" text-anchor="middle" fill="#f59e0b" font-size="8" opacity="0.6">Средне</text>' +
      '<text x="' + (CX + R - 5) + '" y="' + (CY + 14) + '" text-anchor="end" fill="#10b981" font-size="8" opacity="0.6">Хорошо</text>' +
      '</svg>';

    return `<div class="wr-card wr-profit-card">
      <div class="wr-card-title">Итого: Прибыль</div>
      <div class="wr-profit-grid">
        <div class="wr-profit-formula">
          <div class="wr-row"><span>Выручка без НДС</span><span>${m(d.revenue.ex_vat)} \u20BD</span></div>
          <div class="wr-row"><span class="wr-red">\u2212 Расходы + налоги</span><span class="wr-red">${m(d.expenses.total_with_tax)} \u20BD</span></div>
          <div class="wr-row"><span class="wr-blue">+ НДС к вычету</span><span class="wr-blue">${m(d.vat.deductible)} \u20BD</span></div>
          <div class="wr-divider"></div>
          <div class="wr-row wr-row-bold"><span>Прибыль до налога</span><span>${m(d.profit.before_tax)} \u20BD</span></div>
          <div class="wr-row"><span class="wr-red">\u2212 Налог на прибыль (${d.profit.income_tax_rate}%)</span><span class="wr-red">${m(d.profit.income_tax)} \u20BD</span></div>
          <div class="wr-divider"></div>
          <div class="wr-row wr-row-big" style="color:${profitColor}"><span>Чистая прибыль</span><span>${m(d.profit.net)} \u20BD</span></div>
        </div>
        <div class="wr-profit-gauge-wrap">${gaugeSvg}</div>
      </div>
    </div>`;
  }

  // ════════════════════════════════════════
  //  8. WATERFALL CHART (path to profit)
  // ════════════════════════════════════════
  // Compact number for charts: 1879697 → "1.88М", 276705 → "277К"
  function mShort(v) {
    const n = Math.abs(Math.round(v || 0));
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 10e6 ? 1 : 2) + 'М';
    if (n >= 1e3) return Math.round(n / 1e3) + 'К';
    return String(n);
  }

  function renderWaterfall(d) {
    const items = [
      { label: 'Выручка', value: d.revenue.ex_vat, type: 'pos' },
      { label: 'Расходы', value: d.expenses.total, type: 'neg' },
      { label: 'Нал.нагрузка', value: d.taxes.burden, type: 'neg' },
      { label: 'НДС к выч.', value: d.vat.deductible, type: 'pos' },
      { label: 'Налог приб.', value: d.profit.income_tax, type: 'neg' },
      { label: 'Прибыль', value: d.profit.net, type: 'total' },
    ];

    const W = 400, H = 240;
    const padTop = 30, padBot = 28, padLeft = 10, padRight = 10;
    const chartH = H - padTop - padBot;
    const barCount = items.length;
    const barGap = 12;
    const chartW = W - padLeft - padRight;
    const barW = Math.floor((chartW - barGap * (barCount - 1)) / barCount);

    // Compute running totals to find min/max of the waterfall
    let running = 0;
    const runningVals = [0]; // start at 0
    items.forEach(item => {
      if (item.type === 'total') {
        runningVals.push(item.value);
        runningVals.push(0);
      } else if (item.type === 'pos') {
        runningVals.push(running);
        running += item.value;
        runningVals.push(running);
      } else {
        runningVals.push(running);
        running -= item.value;
        runningVals.push(running);
      }
    });
    const minVal = Math.min(...runningVals, 0);
    const maxVal = Math.max(...runningVals, 1);
    const range = maxVal - minVal || 1;
    const scale = chartH / range;

    // Y coordinate from value (higher value = lower Y)
    const yOf = (v) => padTop + (maxVal - v) * scale;
    const zeroY = yOf(0);

    running = 0;
    let prevRunning = 0;
    const svgParts = [];

    // Dashed zero baseline
    svgParts.push(`<line x1="${padLeft}" y1="${zeroY}" x2="${W - padRight}" y2="${zeroY}" stroke="rgba(255,255,255,0.12)" stroke-dasharray="4 3" stroke-width="1"/>`);

    items.forEach((item, i) => {
      const x = padLeft + i * (barW + barGap);
      const colors = { pos: '#10b981', neg: '#ef4444', total: item.value >= 0 ? '#3b82f6' : '#ef4444' };
      const color = colors[item.type];
      let barTop, barBottom;

      prevRunning = running;

      if (item.type === 'total') {
        // Bar from 0 to item.value
        if (item.value >= 0) {
          barTop = yOf(item.value);
          barBottom = zeroY;
        } else {
          barTop = zeroY;
          barBottom = yOf(item.value);
        }
      } else if (item.type === 'pos') {
        // Bar grows up from running
        barTop = yOf(running + item.value);
        barBottom = yOf(running);
        running += item.value;
      } else { // neg
        // Bar grows down from running
        barTop = yOf(running);
        barBottom = yOf(running - item.value);
        running -= item.value;
      }

      let barH = Math.max(barBottom - barTop, 2);

      // Connector: dashed line from previous bar's running total to this bar's starting level
      if (i > 0 && item.type !== 'total') {
        const connY = yOf(prevRunning);
        const prevX = padLeft + (i - 1) * (barW + barGap) + barW;
        svgParts.push(`<line x1="${prevX}" y1="${connY}" x2="${x}" y2="${connY}" stroke="rgba(255,255,255,0.15)" stroke-dasharray="3 2" stroke-width="1"/>`);
      }

      // Bar with rounded top
      svgParts.push(`<rect x="${x}" y="${barTop}" width="${barW}" height="${barH}" rx="3" fill="${color}" class="wr-wf-bar"/>`);

      // Value label above/below bar
      const valLabel = (item.type === 'neg' ? '\u2212' : '') + mShort(item.value);
      const labelAbove = item.type !== 'neg';
      const valY = labelAbove ? Math.max(barTop - 6, 10) : Math.min(barBottom + 14, H - padBot - 2);
      svgParts.push(`<text x="${x + barW / 2}" y="${valY}" text-anchor="middle" class="wr-wf-val">${valLabel}</text>`);

      // Bottom label
      svgParts.push(`<text x="${x + barW / 2}" y="${H - 6}" text-anchor="middle" class="wr-wf-label" style="font-size:10px">${item.label}</text>`);
    });

    return `<div class="wr-card">
      <div class="wr-card-title">Путь к прибыли</div>
      <svg viewBox="0 0 ${W} ${H}" class="wr-wf-svg">${svgParts.join('')}</svg>
    </div>`;
  }

  // ════════════════════════════════════════
  //  9. TIMELINE
  // ════════════════════════════════════════
  function renderTimeline(d) {
    const steps = [];

    if (d.tender) {
      steps.push({ label: 'Тендер создан', date: d.tender.created_at, icon: '\uD83D\uDCE5' });
    }
    if (d.estimate) {
      steps.push({ label: 'Просчёт', date: d.estimate.created_at, icon: '\uD83D\uDCCA' });
      if (d.estimate.sent_at) steps.push({ label: 'Просчёт отправлен', date: d.estimate.sent_at, icon: '\uD83D\uDCE8' });
    }

    const tl = d.timeline || {};
    if (tl.start_fact) steps.push({ label: 'Начало работ', date: tl.start_fact, icon: '\uD83D\uDE80' });
    if (tl.end_fact) steps.push({ label: 'Работы завершены', date: tl.end_fact, icon: '\u2705' });
    if (d.work_meta && d.work_meta.completed_at) steps.push({ label: 'Контракт закрыт', date: d.work_meta.completed_at, icon: '\uD83D\uDD12' });

    if (steps.length === 0) return '';

    const stepsHtml = steps.map((s, i) => `
      <div class="wr-tl-step ${i === steps.length - 1 ? 'wr-tl-last' : ''}">
        <div class="wr-tl-dot">${s.icon}</div>
        <div class="wr-tl-info">
          <div class="wr-tl-label">${esc(s.label)}</div>
          <div class="wr-tl-date">${fmtDate(s.date)}</div>
        </div>
      </div>
    `).join('');

    return `<div class="wr-card">
      <div class="wr-card-title">Хронология</div>
      <div class="wr-tl">${stepsHtml}</div>
    </div>`;
  }

  // ════════════════════════════════════════
  //  10. PLAN VS FACT
  // ════════════════════════════════════════
  function renderPlanVsFact(d) {
    const tl = d.timeline || {};
    const wm = d.work_meta || {};
    if (!tl.start_plan && !tl.start_fact && !wm.cost_plan) return '';

    const planDays = daysBetween(tl.start_plan, tl.end_plan);
    const factDays = daysBetween(tl.start_fact, tl.end_fact);
    const devDays = (planDays !== null && factDays !== null) ? factDays - planDays : null;
    const devColor = devDays === null ? 'var(--t2)' : devDays <= 0 ? '#10b981' : '#ef4444';
    const devText = devDays === null ? '—' : devDays === 0 ? 'В срок ✓' : (devDays > 0 ? 'Задержка +' + devDays + ' дн.' : 'Раньше на ' + Math.abs(devDays) + ' дн.');

    const costDev = wm.cost_plan > 0 ? Math.round((wm.cost_fact - wm.cost_plan) / wm.cost_plan * 100) : null;
    const costColor = costDev === null ? 'var(--t2)' : costDev <= 0 ? '#10b981' : '#ef4444';
    const costText = costDev === null ? '—' : (costDev > 0 ? 'Перерасход +' + costDev + '%' : 'Экономия ' + Math.abs(costDev) + '%');

    return `<div class="wr-card">
      <div class="wr-card-title">План vs Факт</div>
      <div class="wr-pvf-grid">
        <div class="wr-pvf-item">
          <div class="wr-pvf-label">Сроки (план)</div>
          <div class="wr-pvf-val">${planDays !== null ? planDays + ' дн.' : '\u2014'}</div>
        </div>
        <div class="wr-pvf-item">
          <div class="wr-pvf-label">Сроки (факт)</div>
          <div class="wr-pvf-val">${factDays !== null ? factDays + ' дн.' : '\u2014'}</div>
        </div>
        <div class="wr-pvf-item">
          <div class="wr-pvf-label">Отклонение</div>
          <div class="wr-pvf-val" style="color:${devColor}">${devText}</div>
        </div>
        <div class="wr-pvf-item">
          <div class="wr-pvf-label">Себест. план</div>
          <div class="wr-pvf-val">${wm.cost_plan ? m(wm.cost_plan) + ' \u20BD' : '\u2014'}</div>
        </div>
        <div class="wr-pvf-item">
          <div class="wr-pvf-label">Себест. факт</div>
          <div class="wr-pvf-val">${wm.cost_fact ? m(wm.cost_fact) + ' \u20BD' : '\u2014'}</div>
        </div>
        <div class="wr-pvf-item">
          <div class="wr-pvf-label">Отклонение</div>
          <div class="wr-pvf-val" style="color:${costColor}">${costText}</div>
        </div>
      </div>
    </div>`;
  }

  // ════════════════════════════════════════
  //  11. CREW
  // ════════════════════════════════════════
  function renderCrew(d) {
    const crew = d.crew || [];
    if (crew.length === 0) return '';

    const rows = crew.map(c => {
      const initials = (c.full_name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      const colors = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#2980b9'];
      const bg = colors[Math.abs(hashCode(c.full_name || '')) % colors.length];

      return `<div class="wr-crew-row">
        <div class="wr-crew-avatar" style="background:${bg}">${initials}</div>
        <div class="wr-crew-info">
          <div class="wr-crew-name">${esc(c.full_name || '\u2014')}</div>
          <div class="wr-crew-pos">${esc(c.position || '')}</div>
        </div>
        <div class="wr-crew-stats">
          <span>${c.shifts || 0} см</span>
          <span>${Math.round(parseFloat(c.earned || 0) / parseFloat(c.point_value || 500))} бал</span>
          <span class="wr-crew-earned">${m(c.earned)} \u20BD</span>
        </div>
      </div>`;
    });

    return `<div class="wr-card">
      <div class="wr-card-title">Бригада (${crew.length})</div>
      ${rows.join('')}
    </div>`;
  }

  function hashCode(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return h;
  }

  // ════════════════════════════════════════
  //  12. PAYMENTS
  // ════════════════════════════════════════
  function renderPayments(d) {
    const p = d.payments;
    if (!p || !p.items || p.items.length === 0) return '';

    const today = new Date().toISOString().slice(0, 10);
    const pctFilled = Math.min(p.payment_pct, 100);
    const barColor = pctFilled >= 100 ? '#10b981' : pctFilled >= 50 ? '#3b82f6' : '#d4a843';

    const typeLabels = { advance: 'Аванс', postpay: 'Постоплата', intermediate: 'Промежуточный', other: 'Прочее' };

    const rows = p.items.map(inc => {
      const isOverdue = !inc.confirmed && inc.date && inc.date < today;
      const statusHtml = inc.confirmed
        ? '<span class="wr-pay-ok">\u2705 Оплачен</span>'
        : isOverdue
          ? '<span class="wr-pay-overdue">\u26A0 Просрочен</span>'
          : '<span class="wr-pay-wait">\u23F3 Ожидает</span>';
      return `<tr class="${isOverdue ? 'wr-pay-row-overdue' : ''}">
        <td>${esc(typeLabels[inc.type] || inc.type || '\u2014')}</td>
        <td>${esc(inc.comment || '')}</td>
        <td class="wr-r">${m(inc.amount)} \u20BD</td>
        <td>${fmtDate(inc.date)}</td>
        <td>${statusHtml}</td>
      </tr>`;
    }).join('');

    const receivablesColor = p.receivables > 0 ? '#d4a843' : '#10b981';

    return `<div class="wr-card wr-pay-section">
      <div class="wr-card-title">Оплата заказчиком</div>
      <div class="wr-pay-progress">
        <div class="wr-pay-progress-head">
          <span>Получено</span>
          <span style="color:${barColor};font-weight:700">${p.payment_pct}%</span>
        </div>
        <div class="wr-pay-bar-bg"><div class="wr-pay-bar" style="width:${pctFilled}%;background:${barColor}"></div></div>
        <div class="wr-pay-progress-foot">
          <span>${m(p.confirmed)} \u20BD</span>
          <span>из ${m(d.contract_value)} \u20BD</span>
        </div>
      </div>

      <table class="wr-pay-table">
        <thead><tr><th>Тип</th><th>Описание</th><th class="wr-r">Сумма</th><th>Дата</th><th>Статус</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="wr-pay-summary">
        <div class="wr-pay-stat"><div class="wr-pay-stat-label">Оплачено</div><div class="wr-pay-stat-val" style="color:#10b981">${m(p.confirmed)} \u20BD</div></div>
        <div class="wr-pay-stat"><div class="wr-pay-stat-label">Ожидается</div><div class="wr-pay-stat-val" style="color:#d4a843">${m(p.pending)} \u20BD</div></div>
        <div class="wr-pay-stat"><div class="wr-pay-stat-label">Дебиторка</div><div class="wr-pay-stat-val" style="color:${receivablesColor}">${m(p.receivables)} \u20BD</div></div>
      </div>

      ${p.overdue > 0 ? '<div class="wr-pay-alert">\u26A0 Просроченных платежей: ' + p.overdue + '</div>' : ''}
    </div>`;
  }

  // ════════════════════════════════════════
  //  13. EXPORT BUTTON
  // ════════════════════════════════════════
  function renderExportButton() {
    return `<div class="wr-export-wrap">
      <button class="wr-export-btn" id="wrExportBtn">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Excel \u2014 \u0424\u0438\u043D\u0430\u043D\u0441\u043E\u0432\u044B\u0439 \u043E\u0442\u0447\u0451\u0442
      </button>
    </div>`;
  }

  // ════════════════════════════════════════
  //  COUNTUP ANIMATION
  // ════════════════════════════════════════
  function animateCountUp(el, target, duration) {
    const start = 0;
    const startTime = performance.now();
    const isPercent = target < 100 && el.closest('.wr-kpi-value') && el.closest('.wr-kpi-value').textContent.includes('%');

    function step(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = start + (target - start) * eased;

      if (Math.abs(target) < 100) {
        el.textContent = current.toFixed(1);
      } else {
        el.textContent = money(Math.round(current));
      }

      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function observeCountUps() {
    const els = document.querySelectorAll('.wr-countup');
    if (!els.length) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const el = entry.target;
          const target = parseFloat(el.dataset.target) || 0;
          animateCountUp(el, target, 1200);
          observer.unobserve(el);
        }
      });
    }, { threshold: 0.3 });

    els.forEach(el => observer.observe(el));
  }

  // ════════════════════════════════════════
  //  ACCORDION BINDING
  // ════════════════════════════════════════
  function bindAccordions() {
    document.querySelectorAll('.wr-acc-head[data-toggle]').forEach(head => {
      head.addEventListener('click', () => {
        const acc = head.closest('.wr-acc');
        if (!acc) return;
        const isOpen = acc.dataset.open === '1';
        acc.dataset.open = isOpen ? '0' : '1';
      });
    });
  }

  // ════════════════════════════════════════
  //  EXCEL EXPORT (10 sheets)
  // ════════════════════════════════════════
  function bindExport(data) {
    const btn = document.getElementById('wrExportBtn');
    if (!btn) return;
    btn.addEventListener('click', () => exportExcel(data));
  }

  function exportExcel(d) {
    if (typeof XLSX === 'undefined') {
      toast('Excel', 'Библиотека xlsx не загружена', 'err');
      return;
    }

    const wb = XLSX.utils.book_new();
    const wm = d.work_meta || {};
    const hs = { font: { bold: true, sz: 12 }, fill: { fgColor: { rgb: 'D4A843' } } };
    const hdr_s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1a2d52' } } };
    const money_s = { numFmt: '#,##0' };

    // 1. Summary
    const s1 = [
      ['Финансовый отчёт — Работа #' + d.work_id],
      [''],
      ['Название', d.work_title || ''],
      ['Заказчик', wm.customer_name || ''],
      ['ИНН', wm.customer_inn || ''],
      ['РП', wm.pm_name || ''],
      ['Город', wm.city || ''],
      ['Объект', wm.object_name || ''],
      ['Статус', wm.work_status || ''],
      [''],
      ['Выручка с НДС', d.revenue.with_vat],
      ['Выручка без НДС', d.revenue.ex_vat],
      ['Расходы', d.expenses.total],
      ['Налоговая нагрузка', d.taxes.burden],
      ['Расходы с налогами', d.expenses.total_with_tax],
      ['НДС к уплате', d.vat.payable],
      ['Прибыль до налога', d.profit.before_tax],
      ['Налог на прибыль', d.profit.income_tax],
      ['Чистая прибыль', d.profit.net],
      ['Маржа, %', d.profit.margin],
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(s1);
    ws1['!cols'] = [{ wch: 25 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws1, 'Сводка');

    // 2. Revenue
    const s2 = [
      ['Выручка'],
      [''],
      ['Показатель', 'Сумма, руб.'],
      ['Выручка с НДС', d.revenue.with_vat],
      ['НДС начисленный', d.vat.charged],
      ['Выручка без НДС', d.revenue.ex_vat],
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(s2);
    ws2['!cols'] = [{ wch: 25 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Выручка');

    // 3. Expenses by category
    const cats = d.expenses.categories || [];
    const s3 = [
      ['Расходы по категориям'],
      [''],
      ['Категория', 'Кол-во', 'Сумма', 'НДС к вычету', 'Налог ' + d.taxes.rate + '%', 'Итого с налогом'],
    ];
    for (const c of cats) {
      const info = CAT_LABELS[c.category] || { label: c.category };
      s3.push([info.label, c.count, c.sum, c.vatDeductible, c.taxBurden, c.sum + c.taxBurden]);
    }
    s3.push(['ИТОГО', '', d.expenses.total, d.vat.deductible, d.taxes.burden, d.expenses.total_with_tax]);
    const ws3 = XLSX.utils.aoa_to_sheet(s3);
    ws3['!cols'] = [{ wch: 22 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws3, 'Расходы');

    // 4. Expense details
    const s4 = [
      ['Детализация расходов'],
      [''],
      ['Категория', 'Поставщик', 'Сумма', 'Комментарий', 'Документ', 'Счёт-фактура'],
    ];
    for (const c of cats) {
      const info = CAT_LABELS[c.category] || { label: c.category };
      for (const it of (c.items || [])) {
        s4.push([info.label, it.supplier || '', parseFloat(it.amount) || 0, it.comment || '', it.doc_number || '', it.invoice_received ? 'Да' : it.invoice_needed ? 'Ожидается' : 'Нет']);
      }
    }
    const ws4 = XLSX.utils.aoa_to_sheet(s4);
    ws4['!cols'] = [{ wch: 20 }, { wch: 22 }, { wch: 14 }, { wch: 30 }, { wch: 14 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws4, 'Детали расходов');

    // 5. VAT
    const s5 = [
      ['НДС'],
      [''],
      ['Показатель', 'Сумма, руб.'],
      ['НДС начисленный', d.vat.charged],
      ['НДС к вычету', d.vat.deductible],
      ['НДС к уплате', d.vat.payable],
    ];
    const ws5 = XLSX.utils.aoa_to_sheet(s5);
    ws5['!cols'] = [{ wch: 22 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws5, 'НДС');

    // 6. Taxes
    const s6 = [
      ['Налоговая нагрузка'],
      [''],
      ['Ставка, %', d.taxes.rate],
      ['Нагрузка, руб.', d.taxes.burden],
      [''],
      ['Налог на прибыль, %', d.profit.income_tax_rate],
      ['Налог на прибыль, руб.', d.profit.income_tax],
    ];
    const ws6 = XLSX.utils.aoa_to_sheet(s6);
    ws6['!cols'] = [{ wch: 22 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws6, 'Налоги');

    // 7. Profit
    const s7 = [
      ['Прибыль'],
      [''],
      ['Показатель', 'Сумма, руб.'],
      ['Выручка без НДС', d.revenue.ex_vat],
      ['Расходы + налоги', d.expenses.total_with_tax],
      ['НДС к вычету (+)', d.vat.deductible],
      ['Прибыль до налога', d.profit.before_tax],
      ['Налог на прибыль', d.profit.income_tax],
      ['Чистая прибыль', d.profit.net],
      ['Маржа, %', d.profit.margin],
    ];
    const ws7 = XLSX.utils.aoa_to_sheet(s7);
    ws7['!cols'] = [{ wch: 22 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws7, 'Прибыль');

    // 8. Payments
    const s8 = [
      ['Оплата заказчиком'],
      [''],
      ['Тип', 'Описание', 'Сумма', 'Дата', 'Статус'],
    ];
    for (const inc of (d.payments.items || [])) {
      const typeLabels = { advance: 'Аванс', postpay: 'Постоплата', intermediate: 'Промежуточный', other: 'Прочее' };
      s8.push([
        typeLabels[inc.type] || inc.type || '',
        inc.comment || '',
        parseFloat(inc.amount) || 0,
        inc.date ? fmtDate(inc.date) : '',
        inc.confirmed ? 'Оплачен' : 'Ожидает'
      ]);
    }
    s8.push(['']);
    s8.push(['Всего получено', '', d.payments.confirmed]);
    s8.push(['Ожидается', '', d.payments.pending]);
    s8.push(['Дебиторка', '', d.payments.receivables]);
    const ws8 = XLSX.utils.aoa_to_sheet(s8);
    ws8['!cols'] = [{ wch: 16 }, { wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws8, 'Оплата');

    // 9. Crew
    const crew = d.crew || [];
    const s9 = [
      ['Бригада'],
      [''],
      ['ФИО', 'Должность', 'Смены', 'Часы', 'Заработок'],
    ];
    for (const c of crew) {
      s9.push([c.full_name || '', c.position || '', parseInt(c.shifts) || 0, Math.round(parseFloat(c.earned || 0) / parseFloat(c.point_value || 500)), parseFloat(c.earned) || 0]);
    }
    const ws9 = XLSX.utils.aoa_to_sheet(s9);
    ws9['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 8 }, { wch: 8 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws9, 'Бригада');

    // 10. Parameters
    const s10 = [
      ['Параметры'],
      [''],
      ['Ставка НДС, %', d.vat_pct],
      ['Ставка налог. нагрузки, %', d.taxes.rate],
      ['Ставка налога на прибыль, %', d.profit.income_tax_rate],
      [''],
      ['Тендер ID', wm.tender_id || ''],
      ['Себест. план', wm.cost_plan || ''],
      ['Себест. факт', wm.cost_fact || ''],
    ];
    const ws10 = XLSX.utils.aoa_to_sheet(s10);
    ws10['!cols'] = [{ wch: 28 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws10, 'Параметры');

    // Save
    const fileName = 'Фин_отчёт_работа_' + d.work_id + '.xlsx';
    XLSX.writeFile(wb, fileName);
    toast('Excel', 'Файл сохранён: ' + fileName, 'ok');
  }

  // ════════════════════════════════════════
  //  CSS STYLES
  // ════════════════════════════════════════
  function renderStyles() {
    return `<style>
/* ── Loading / Error ── */
.wr-loading{display:flex;align-items:center;justify-content:center;gap:12px;padding:80px 20px;color:var(--t2);font-size:15px}
.wr-spinner{width:24px;height:24px;border:3px solid var(--brd);border-top-color:#d4a843;border-radius:50%;animation:wrSpin .8s linear infinite}
@keyframes wrSpin{to{transform:rotate(360deg)}}
.wr-error{text-align:center;padding:80px 20px;color:#ef4444;font-size:15px}
.wr-empty{color:var(--t2);padding:20px;text-align:center;font-size:13px}

/* ── Hero ── */
.wr-hero{position:relative;border-radius:16px;overflow:hidden;margin-bottom:20px}
.wr-hero-bg{position:absolute;inset:0;background:linear-gradient(135deg,#0d1428 0%,#1a2d52 60%,#0f1d3a 100%);z-index:0}
.wr-hero-content{position:relative;z-index:1;padding:28px 32px 24px}
.wr-hero-top{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}
.wr-hero-number{font-size:12px;color:rgba(255,255,255,.45);letter-spacing:.5px;text-transform:uppercase;margin-bottom:4px}
.wr-hero-title{font-size:22px;font-weight:700;color:#fff;margin:0 0 10px;line-height:1.3}
.wr-hero-meta{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:13px;color:rgba(255,255,255,.6)}
.wr-hero-inn{background:rgba(212,168,67,.15);color:#d4a843;padding:1px 8px;border-radius:4px;font-size:12px}
.wr-hero-pm{margin-top:8px;font-size:13px;color:rgba(255,255,255,.5)}
.wr-hero-pm strong{color:rgba(255,255,255,.85)}
.wr-hero-right{text-align:right;flex-shrink:0}
.wr-hero-status{display:inline-block;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:600;color:#fff}
.wr-hero-margin-label{margin-top:12px;font-size:11px;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.5px}
.wr-hero-margin{font-size:36px;font-weight:800;line-height:1}

/* ── KPI Strip ── */
.wr-kpi-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px}
.wr-kpi-card{background:var(--bg2,#151922);border:1px solid var(--brd);border-radius:14px;padding:16px 18px;display:flex;align-items:center;gap:14px;transition:transform .2s,box-shadow .2s;contain:layout style paint}
.wr-kpi-card:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.3)}
.wr-kpi-icon{flex-shrink:0;opacity:.85}
.wr-kpi-body{flex:1;min-width:0}
.wr-kpi-label{font-size:11px;color:var(--t2);text-transform:uppercase;letter-spacing:.3px;margin-bottom:2px}
.wr-kpi-value{font-size:22px;font-weight:700;line-height:1.2}
.wr-kpi-sub{font-size:11px;color:var(--t2);margin-top:2px}

/* ── Grid ── */
.wr-grid{display:grid;grid-template-columns:3fr 2fr;gap:20px;margin-bottom:20px}
.wr-grid-main,.wr-grid-side{display:flex;flex-direction:column;gap:16px}

/* ── Card ── */
.wr-card{background:var(--bg2,#151922);border:1px solid var(--brd);border-radius:14px;padding:18px 20px;transition:box-shadow .2s}
.wr-card:hover{box-shadow:0 4px 16px rgba(0,0,0,.2)}
.wr-card-title{font-size:14px;font-weight:700;margin-bottom:14px;color:var(--t1)}

/* ── Rows ── */
.wr-row{display:flex;justify-content:space-between;align-items:center;padding:5px 0;font-size:13px}
.wr-row-bold{font-weight:700}
.wr-row-big{font-size:18px;padding:10px 0;border-top:1px solid var(--brd);margin-top:6px}
.wr-row-desc{font-size:11px;color:var(--t2,#888);margin:-2px 0 4px;padding-left:2px}
.wr-divider{height:1px;background:var(--brd);margin:6px 0}
.wr-red{color:#ef4444}
.wr-blue{color:#3b82f6}
.wr-r{text-align:right}

/* ── Donut ── */
.wr-donut-wrap{display:flex;align-items:center;gap:24px}
.wr-donut-svg{width:180px;height:180px;flex-shrink:0}
.wr-donut-seg{transition:transform .2s;cursor:pointer}
.wr-donut-seg:hover{transform:scale(1.04)}
.wr-donut-total-label{fill:var(--t2);font-size:11px}
.wr-donut-total-val{fill:var(--t1);font-size:14px;font-weight:700}
.wr-donut-legend{flex:1;display:flex;flex-direction:column;gap:6px}
.wr-donut-legend-item{display:flex;align-items:center;gap:8px;font-size:12px;cursor:default}
.wr-donut-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.wr-donut-legend-label{flex:1;color:var(--t1)}
.wr-donut-legend-val{color:var(--t2);white-space:nowrap}

/* ── Accordion ── */
.wr-acc{border-bottom:1px solid rgba(255,255,255,.04);transition:background .2s}
.wr-acc[data-open="1"]{background:rgba(255,255,255,.02)}
.wr-acc-head{display:flex;align-items:center;padding:10px 0;cursor:pointer;gap:10px;user-select:none}
.wr-acc-head:hover{background:rgba(255,255,255,.03)}
.wr-acc-bar-bg{width:60px;height:6px;background:rgba(255,255,255,.06);border-radius:3px;flex-shrink:0;overflow:hidden}
.wr-acc-bar{height:100%;border-radius:3px;transition:width .4s}
.wr-acc-info{flex:1;display:flex;align-items:center;gap:8px;font-size:13px;min-width:0;flex-wrap:wrap}
.wr-acc-icon{font-size:16px}
.wr-acc-name{font-weight:500;color:var(--t1)}
.wr-acc-count{color:var(--t2);font-size:11px}
.wr-acc-tax{color:#ef4444;font-size:11px}
.wr-acc-vat{color:#3b82f6;font-size:11px}
.wr-acc-sum{font-weight:700;font-size:14px;white-space:nowrap}
.wr-acc-chevron{color:var(--t2);font-size:10px;transition:transform .2s;flex-shrink:0}
.wr-acc[data-open="1"] .wr-acc-chevron{transform:rotate(90deg)}
.wr-acc-body{max-height:0;overflow:hidden;transition:max-height .3s ease}
.wr-acc[data-open="1"] .wr-acc-body{max-height:800px}
.wr-acc-table{width:100%;border-collapse:collapse;font-size:12px;margin:4px 0 8px}
.wr-acc-table th{text-align:left;padding:4px 8px;color:var(--t2);font-weight:500;border-bottom:1px solid var(--brd);font-size:11px}
.wr-acc-table td{padding:4px 8px;border-bottom:1px solid rgba(255,255,255,.03);color:var(--t1)}
.wr-acc-total{display:flex;justify-content:space-between;padding:12px 0 2px;font-weight:700;font-size:14px;border-top:1px solid var(--brd);margin-top:8px}
.wr-acc-total-sub{display:flex;justify-content:space-between;padding:2px 0 0;font-size:12px;color:var(--t2)}

/* ── Profit card ── */
.wr-profit-grid{display:flex;gap:20px;align-items:center}
.wr-profit-formula{flex:1}
.wr-profit-gauge-wrap{flex-shrink:0;width:200px;min-width:180px}

/* ── Waterfall ── */
.wr-wf-svg{width:100%;height:auto}
/* Анимации убраны: каскадные transform на SVG барах блокировали main thread
   во время скролла (10 баров × 600мс с разными delay) */
.wr-wf-bar{transform-origin:bottom}
.wr-wf-val{fill:var(--t1,#fff);font-size:10px;font-weight:600}
.wr-wf-label{fill:var(--t2,#888);font-size:8px}

/* ── Timeline ── */
.wr-tl{position:relative;padding-left:28px}
.wr-tl-step{position:relative;padding-bottom:18px;display:flex;gap:10px;align-items:flex-start}
.wr-tl-step:not(.wr-tl-last)::before{content:'';position:absolute;left:-18px;top:22px;width:2px;bottom:0;background:var(--brd)}
.wr-tl-dot{position:absolute;left:-26px;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:13px}
.wr-tl-info{flex:1}
.wr-tl-label{font-size:13px;font-weight:500;color:var(--t1)}
.wr-tl-date{font-size:11px;color:var(--t2);margin-top:1px}

/* ── Plan vs Fact ── */
.wr-pvf-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.wr-pvf-item{text-align:center;padding:8px}
.wr-pvf-label{font-size:11px;color:var(--t2);margin-bottom:2px}
.wr-pvf-val{font-size:15px;font-weight:600}

/* ── Crew ── */
.wr-crew-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.04)}
.wr-crew-row:last-child{border-bottom:none}
.wr-crew-avatar{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:700;flex-shrink:0}
.wr-crew-info{flex:1;min-width:0}
.wr-crew-name{font-size:13px;font-weight:500;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wr-crew-pos{font-size:11px;color:var(--t2)}
.wr-crew-stats{display:flex;gap:10px;font-size:12px;color:var(--t2);flex-shrink:0}
.wr-crew-earned{color:#d4a843;font-weight:600}

/* ── Payments ── */
.wr-pay-section{margin-bottom:20px}
.wr-pay-progress{margin-bottom:16px}
.wr-pay-progress-head{display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;color:var(--t2)}
.wr-pay-bar-bg{height:10px;background:rgba(255,255,255,.06);border-radius:5px;overflow:hidden}
.wr-pay-bar{height:100%;border-radius:5px;transition:width .8s ease}
.wr-pay-progress-foot{display:flex;justify-content:space-between;font-size:11px;color:var(--t2);margin-top:4px}
.wr-pay-table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:14px}
.wr-pay-table th{text-align:left;padding:6px 10px;border-bottom:1px solid var(--brd);color:var(--t2);font-weight:500;font-size:12px}
.wr-pay-table td{padding:7px 10px;border-bottom:1px solid rgba(255,255,255,.04)}
.wr-pay-row-overdue{background:rgba(239,68,68,.06)}
.wr-pay-ok{color:#10b981;font-weight:600;font-size:12px}
.wr-pay-overdue{color:#ef4444;font-weight:600;font-size:12px}
.wr-pay-wait{color:#d4a843;font-size:12px}
.wr-pay-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.wr-pay-stat{background:rgba(255,255,255,.03);border-radius:10px;padding:12px;text-align:center}
.wr-pay-stat-label{font-size:11px;color:var(--t2);margin-bottom:2px}
.wr-pay-stat-val{font-size:17px;font-weight:700}
.wr-pay-alert{margin-top:12px;padding:8px 14px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:8px;font-size:12px;color:#ef4444;font-weight:600}

/* ── Export ── */
.wr-export-wrap{text-align:center;margin-bottom:24px}
.wr-export-btn{display:inline-flex;align-items:center;gap:8px;padding:12px 32px;border:none;border-radius:10px;background:linear-gradient(135deg,#d4a843 0%,#b8922f 100%);color:#fff;font-size:15px;font-weight:600;cursor:pointer;transition:transform .15s,box-shadow .15s}
.wr-export-btn:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(212,168,67,.4)}
.wr-export-btn:active{transform:translateY(0)}

/* ── Responsive ── */
@media(max-width:900px){
  .wr-kpi-strip{grid-template-columns:repeat(2,1fr)}
  .wr-grid{grid-template-columns:1fr}
  .wr-hero-top{flex-direction:column}
  .wr-hero-right{text-align:left}
  .wr-donut-wrap{flex-direction:column}
  .wr-profit-grid{flex-direction:column}
  .wr-pvf-grid{grid-template-columns:repeat(2,1fr)}
  .wr-pay-summary{grid-template-columns:1fr}
}
@media(max-width:500px){
  .wr-kpi-strip{grid-template-columns:1fr}
  .wr-pvf-grid{grid-template-columns:1fr}
}
</style>`;
  }

  return { render };
})();