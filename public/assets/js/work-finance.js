/**
 * AsgardWorkFinance — Финансовый дашборд работы
 * ═══════════════════════════════════════════════
 * Расходы по категориям, НДС, налоги, прибыль, маржа.
 * API: AsgardWorkFinance.openFinanceDashboard(work, user)
 */
window.AsgardWorkFinance = (function () {
  'use strict';

  const { $, $$, esc, toast, showModal, hideModal, money } = AsgardUI;

  function hdr() {
    const t = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token');
    return { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' };
  }

  const CAT_LABELS = {
    fot: { label: 'ФОТ (начислено)', icon: '👷', taxType: 'payroll' },
    cash: { label: 'Наличные', icon: '💵', taxType: 'payroll' },
    per_diem: { label: 'Суточные', icon: '🍽', taxType: 'payroll' },
    logistics: { label: 'Билеты/логистика', icon: '🚚', taxType: 'vat' },
    accommodation: { label: 'Проживание', icon: '🏨', taxType: 'vat' },
    transfer: { label: 'Трансфер', icon: '🚗', taxType: 'vat' },
    chemicals: { label: 'Химия/материалы', icon: '🧪', taxType: 'vat' },
    equipment: { label: 'Оборудование', icon: '🔧', taxType: 'vat' },
    materials: { label: 'Материалы', icon: '📦', taxType: 'vat' },
    subcontract: { label: 'Субподряд/агентское', icon: '🤝', taxType: 'payroll' },
    other: { label: 'Прочие', icon: '📋', taxType: 'vat' },
    tickets: { label: 'Билеты', icon: '✈', taxType: 'vat' },
  };

  async function openFinanceDashboard(work, user) {
    hideModal();

    const html = `<div id="finDash" style="min-height:200px"><div class="help" style="text-align:center;padding:40px">Загрузка финансовых данных...</div></div>`;
    showModal(`Финансовый дашборд — Работа #${work.id}`, html, { width: '900px' });

    try {
      const resp = await fetch(`/api/works/${work.id}/financial-summary`, { headers: hdr() });
      if (!resp.ok) throw new Error('Ошибка загрузки');
      const data = await resp.json();
      renderDashboard(data);
    } catch (e) {
      const wrap = document.getElementById('finDash');
      if (wrap) wrap.innerHTML = `<div class="help" style="color:#ef4444;text-align:center;padding:40px">Ошибка: ${esc(e.message)}</div>`;
    }
  }

  function renderDashboard(d) {
    const wrap = document.getElementById('finDash');
    if (!wrap) return;

    const profitColor = d.profit.net >= 0 ? '#10b981' : '#ef4444';
    const marginColor = d.profit.margin >= 25 ? '#10b981' : d.profit.margin >= 15 ? '#D4A843' : '#ef4444';

    wrap.innerHTML = `
      ${renderKpiCards(d)}
      ${renderExpenseTable(d)}
      ${renderVatBlock(d)}
      ${renderTaxBlock(d)}
      ${renderProfitBlock(d)}
      ${renderIncomeBlock(d)}
    `;
  }

  function renderKpiCards(d) {
    const items = [
      { label: 'Выручка с НДС', value: m(d.revenue.with_vat), sub: `НДС ${d.vat_pct}%` },
      { label: 'Выручка без НДС', value: m(d.revenue.ex_vat), sub: `НДС начислен: ${m(d.vat.charged)}` },
      { label: 'Расходы + налоги', value: m(d.expenses.total_with_tax), sub: `Расходы: ${m(d.expenses.total)}`, color: '#ef4444' },
      { label: 'Чистая прибыль', value: m(d.profit.net), sub: `Маржа: ${d.profit.margin}%`, color: d.profit.net >= 0 ? '#10b981' : '#ef4444' },
    ];

    return `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
      ${items.map(i => `<div style="background:var(--bg2,#151922);border-radius:10px;padding:14px;border:1px solid var(--brd)">
        <div style="font-size:11px;color:var(--t2);margin-bottom:4px">${i.label}</div>
        <div style="font-size:20px;font-weight:700;${i.color ? 'color:' + i.color : ''}">${i.value} <span style="font-size:12px;font-weight:400">₽</span></div>
        <div style="font-size:11px;color:var(--t2);margin-top:2px">${i.sub}</div>
      </div>`).join('')}
    </div>`;
  }

  function renderExpenseTable(d) {
    const cats = d.expenses.categories || [];
    if (cats.length === 0) return '<div class="help" style="color:var(--t2);margin-bottom:16px">Нет расходов</div>';

    let rows = '';
    for (const c of cats) {
      const info = CAT_LABELS[c.category] || { label: c.category, icon: '📋', taxType: 'vat' };
      const taxLabel = c.taxBurden > 0
        ? `<span style="color:#ef4444">+${m(c.taxBurden)} (${d.taxes.rate}%)</span>`
        : '';
      const vatLabel = c.vatDeductible > 0
        ? `<span style="color:#3b82f6">${m(c.vatDeductible)}</span>`
        : '<span style="color:var(--t2)">—</span>';
      const totalWithTax = c.sum + c.taxBurden;

      rows += `<tr style="border-bottom:1px solid var(--brd,rgba(255,255,255,0.04))">
        <td style="padding:8px 10px;white-space:nowrap">${info.icon} ${esc(info.label)}</td>
        <td style="padding:8px 10px;text-align:center;color:var(--t2)">${c.count}</td>
        <td style="padding:8px 10px;text-align:right;font-weight:600">${m(c.sum)} ₽</td>
        <td style="padding:8px 10px;text-align:right">${vatLabel}</td>
        <td style="padding:8px 10px;text-align:right">${taxLabel || '<span style="color:var(--t2)">—</span>'}</td>
        <td style="padding:8px 10px;text-align:right;font-weight:700">${m(Math.round(totalWithTax))} ₽</td>
      </tr>`;
    }

    // Total row
    rows += `<tr style="border-top:2px solid var(--brd);font-weight:700;background:var(--bg2,#151922)">
      <td style="padding:10px" colspan="2">ИТОГО</td>
      <td style="padding:10px;text-align:right">${m(d.expenses.total)} ₽</td>
      <td style="padding:10px;text-align:right;color:#3b82f6">${m(d.vat.deductible)}</td>
      <td style="padding:10px;text-align:right;color:#ef4444">+${m(d.taxes.burden)}</td>
      <td style="padding:10px;text-align:right;color:var(--gold,#D4A843)">${m(d.expenses.total_with_tax)} ₽</td>
    </tr>`;

    return `<div style="margin-bottom:20px">
      <div style="font-weight:600;font-size:14px;margin-bottom:8px">Расходы по категориям</div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr>
            <th style="text-align:left;padding:6px 10px;border-bottom:1px solid var(--brd);color:var(--t2);font-weight:500;font-size:12px">Категория</th>
            <th style="text-align:center;padding:6px 10px;border-bottom:1px solid var(--brd);color:var(--t2);font-weight:500;font-size:12px;width:50px">Шт</th>
            <th style="text-align:right;padding:6px 10px;border-bottom:1px solid var(--brd);color:var(--t2);font-weight:500;font-size:12px">Сумма</th>
            <th style="text-align:right;padding:6px 10px;border-bottom:1px solid var(--brd);color:var(--t2);font-weight:500;font-size:12px">НДС к вычету</th>
            <th style="text-align:right;padding:6px 10px;border-bottom:1px solid var(--brd);color:var(--t2);font-weight:500;font-size:12px">Налог ${d.taxes.rate}%</th>
            <th style="text-align:right;padding:6px 10px;border-bottom:1px solid var(--brd);color:var(--t2);font-weight:500;font-size:12px">Итого с нал.</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  }

  function renderVatBlock(d) {
    const rows = [
      { label: 'НДС начисленный', value: d.vat.charged, desc: `Выручка ${m(d.revenue.with_vat)} × ${d.vat_pct}/${100 + d.vat_pct}` },
      { label: 'НДС к вычету', value: d.vat.deductible, desc: 'Из безналичных расходов с НДС', color: '#3b82f6' },
      { label: 'НДС к уплате', value: d.vat.payable, desc: 'Начисленный − к вычету', color: '#ef4444', bold: true },
    ];
    return renderBlock('НДС', rows);
  }

  function renderTaxBlock(d) {
    const rows = [
      { label: `Налоговая нагрузка (${d.taxes.rate}%)`, value: d.taxes.burden, desc: 'На ФОТ, наличные, суточные, субподряд', color: '#ef4444', bold: true },
    ];
    return renderBlock('Налоговая нагрузка', rows);
  }

  function renderProfitBlock(d) {
    const profitColor = d.profit.net >= 0 ? '#10b981' : '#ef4444';
    const marginColor = d.profit.margin >= 25 ? '#10b981' : d.profit.margin >= 15 ? '#D4A843' : '#ef4444';

    const rows = [
      { label: 'Выручка без НДС', value: d.revenue.ex_vat },
      { label: 'Расходы + налоги', value: d.expenses.total_with_tax, color: '#ef4444', sign: '−' },
      { label: 'Прибыль до налога', value: d.profit.before_tax, bold: true },
      { label: `Налог на прибыль (${d.profit.income_tax_rate}%)`, value: d.profit.income_tax, color: '#ef4444', sign: '−' },
      { label: 'Чистая прибыль', value: d.profit.net, color: profitColor, bold: true, large: true },
      { label: 'Маржинальность', valueText: d.profit.margin + '%', color: marginColor, bold: true },
    ];
    return renderBlock('Итого', rows);
  }

  function renderIncomeBlock(d) {
    if (!d.incomes.items || d.incomes.items.length === 0) return '';

    let rows = '';
    for (const inc of d.incomes.items) {
      const confirmed = inc.confirmed ? '<span style="color:#10b981">✓</span>' : '<span style="color:var(--t2)">⏳</span>';
      const dt = inc.date ? new Date(inc.date).toLocaleDateString('ru-RU') : '—';
      rows += `<tr style="border-bottom:1px solid var(--brd,rgba(255,255,255,0.04))">
        <td style="padding:6px 10px">${confirmed}</td>
        <td style="padding:6px 10px">${esc(inc.type || '')}</td>
        <td style="padding:6px 10px;text-align:right;font-weight:600">${m(inc.amount)} ₽</td>
        <td style="padding:6px 10px;color:var(--t2)">${dt}</td>
        <td style="padding:6px 10px;color:var(--t2);font-size:12px">${esc(inc.comment || '')}</td>
      </tr>`;
    }

    return `<div style="margin-top:16px">
      <div style="font-weight:600;font-size:14px;margin-bottom:8px">Поступления</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr>
          <th style="padding:4px 10px;border-bottom:1px solid var(--brd);width:30px"></th>
          <th style="text-align:left;padding:4px 10px;border-bottom:1px solid var(--brd);color:var(--t2);font-size:12px">Тип</th>
          <th style="text-align:right;padding:4px 10px;border-bottom:1px solid var(--brd);color:var(--t2);font-size:12px">Сумма</th>
          <th style="padding:4px 10px;border-bottom:1px solid var(--brd);color:var(--t2);font-size:12px">Дата</th>
          <th style="padding:4px 10px;border-bottom:1px solid var(--brd);color:var(--t2);font-size:12px">Комментарий</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="margin-top:6px;font-size:12px;color:var(--t2)">
        Итого: <b>${m(d.incomes.total)} ₽</b> (подтверждено: ${m(d.incomes.confirmed)} ₽)
      </div>
    </div>`;
  }

  // ── Helpers ──

  function renderBlock(title, rows) {
    let html = `<div style="background:var(--bg2,#151922);border:1px solid var(--brd);border-radius:10px;padding:14px 16px;margin-bottom:16px">
      <div style="font-weight:600;font-size:14px;margin-bottom:10px">${title}</div>`;

    for (const r of rows) {
      const style = `display:flex;justify-content:space-between;align-items:center;padding:4px 0;${r.bold ? 'font-weight:700;' : ''}${r.large ? 'font-size:18px;padding:8px 0;border-top:1px solid var(--brd);margin-top:6px;' : ''}`;
      const valStyle = r.color ? `color:${r.color}` : '';
      const sign = r.sign || '';
      const val = r.valueText || `${sign}${m(r.value)} ₽`;
      html += `<div style="${style}">
        <div>
          <span>${r.label}</span>
          ${r.desc ? `<div style="font-size:11px;color:var(--t2);font-weight:400">${r.desc}</div>` : ''}
        </div>
        <div style="${valStyle}">${val}</div>
      </div>`;
    }

    html += '</div>';
    return html;
  }

  function m(v) {
    return money(Math.round(v || 0));
  }

  return { openFinanceDashboard };
})();
