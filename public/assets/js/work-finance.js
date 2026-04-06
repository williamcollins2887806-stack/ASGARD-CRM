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
    payroll: { label: 'ФОТ (начислено)', icon: '👷', taxType: 'payroll' },
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

    wrap.innerHTML = `
      ${renderKpiCards(d)}
      ${renderTimelineBlock(d)}
      ${renderExpenseTable(d)}
      ${renderVatBlock(d)}
      ${renderTaxBlock(d)}
      ${renderProfitBlock(d)}
      ${renderPaymentBlock(d)}
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
      { label: 'НДС к вычету', value: d.vat.deductible, color: '#3b82f6', sign: '+', desc: 'Возврат входящего НДС' },
      { label: 'Прибыль до налога', value: d.profit.before_tax, bold: true },
      { label: `Налог на прибыль (${d.profit.income_tax_rate}%)`, value: d.profit.income_tax, color: '#ef4444', sign: '−' },
      { label: 'Чистая прибыль', value: d.profit.net, color: profitColor, bold: true, large: true },
      { label: 'Маржинальность', valueText: d.profit.margin + '%', color: marginColor, bold: true },
    ];
    return renderBlock('Итого', rows);
  }

  function renderTimelineBlock(d) {
    const tl = d.timeline;
    if (!tl || (!tl.start_plan && !tl.start_fact)) return '';

    const fmtDate = (s) => {
      if (!s) return '—';
      // Parse YYYY-MM-DD without timezone shift
      const parts = s.split('T')[0].split('-');
      return `${parts[2]}.${parts[1]}.${parts[0]}`;
    };
    const daysBetween = (a, b) => {
      if (!a || !b) return null;
      const da = new Date(a.split('T')[0] + 'T12:00:00');
      const db = new Date(b.split('T')[0] + 'T12:00:00');
      return Math.round((db - da) / 86400000);
    };

    const planDays = daysBetween(tl.start_plan, tl.end_plan);
    const factDays = daysBetween(tl.start_fact, tl.end_fact);
    const deviationStart = daysBetween(tl.start_plan, tl.start_fact);
    const deviationEnd = daysBetween(tl.end_plan, tl.end_fact);

    const devColor = (v) => v === null ? 'var(--t2)' : v <= 0 ? '#10b981' : '#ef4444';
    const devText = (v) => {
      if (v === null) return '—';
      if (v === 0) return 'в срок';
      return v > 0 ? `+${v} дн.` : `${v} дн.`;
    };

    // Bar widths (proportional)
    const maxDays = Math.max(planDays || 1, factDays || 1, 1);
    const planW = planDays ? Math.round(planDays / maxDays * 100) : 0;
    const factW = factDays ? Math.round(factDays / maxDays * 100) : 0;

    return `<div style="background:var(--bg2,#151922);border:1px solid var(--brd);border-radius:10px;padding:14px 16px;margin-bottom:16px">
      <div style="font-weight:600;font-size:14px;margin-bottom:12px">Сроки</div>

      <div style="display:grid;grid-template-columns:80px 1fr auto;gap:6px 12px;align-items:center;font-size:13px">
        <div style="color:var(--t2)">План</div>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="background:#3b82f6;height:8px;border-radius:4px;min-width:20px;width:${planW}%"></div>
          <span>${fmtDate(tl.start_plan)} — ${fmtDate(tl.end_plan)}</span>
        </div>
        <div style="color:var(--t2)">${planDays !== null ? planDays + ' дн.' : '—'}</div>

        <div style="color:var(--t2)">Факт</div>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="background:#10b981;height:8px;border-radius:4px;min-width:20px;width:${factW}%"></div>
          <span>${fmtDate(tl.start_fact)} — ${fmtDate(tl.end_fact)}</span>
        </div>
        <div style="color:var(--t2)">${factDays !== null ? factDays + ' дн.' : '—'}</div>
      </div>

      <div style="display:flex;gap:24px;margin-top:10px;font-size:12px">
        <div>Начало: <span style="color:${devColor(deviationStart)};font-weight:600">${devText(deviationStart)}</span></div>
        <div>Окончание: <span style="color:${devColor(deviationEnd)};font-weight:600">${devText(deviationEnd)}</span></div>
      </div>
    </div>`;
  }

  function renderPaymentBlock(d) {
    const p = d.payments;
    if (!p || !p.items || p.items.length === 0) return '';

    const today = new Date().toISOString().slice(0, 10);
    const pctFilled = Math.min(p.payment_pct, 100);

    // Progress bar
    const barColor = pctFilled >= 100 ? '#10b981' : pctFilled >= 50 ? '#3b82f6' : '#D4A843';
    const progressBar = `<div style="margin:10px 0 14px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
        <span style="color:var(--t2)">Оплата заказчиком</span>
        <span style="font-weight:600;color:${barColor}">${p.payment_pct}%</span>
      </div>
      <div style="background:var(--bg1,#0d1117);height:10px;border-radius:5px;overflow:hidden">
        <div style="background:${barColor};height:100%;width:${pctFilled}%;border-radius:5px;transition:width .5s"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--t2);margin-top:4px">
        <span>Получено: ${m(p.confirmed)} ₽</span>
        <span>Из: ${m(d.contract_value)} ₽</span>
      </div>
    </div>`;

    // Payment table
    let rows = '';
    for (const inc of p.items) {
      const isOverdue = !inc.confirmed && inc.date && inc.date < today;
      const statusIcon = inc.confirmed
        ? '<span style="color:#10b981;font-weight:700">Оплачен</span>'
        : isOverdue
          ? '<span style="color:#ef4444;font-weight:700">Просрочен</span>'
          : '<span style="color:#D4A843">Ожидает</span>';
      const dt = inc.date ? new Date(inc.date).toLocaleDateString('ru-RU') : '—';
      const rowBg = isOverdue ? 'background:rgba(239,68,68,0.06);' : '';
      const typeLabels = { advance: 'Аванс', postpay: 'Постоплата', intermediate: 'Промежуточный', other: 'Прочее' };
      const typeName = typeLabels[inc.type] || inc.type || '—';

      rows += `<tr style="border-bottom:1px solid var(--brd,rgba(255,255,255,0.04));${rowBg}">
        <td style="padding:7px 10px">${esc(typeName)}</td>
        <td style="padding:7px 10px;font-size:12px;color:var(--t2)">${esc(inc.comment || '')}</td>
        <td style="padding:7px 10px;text-align:right;font-weight:600">${m(inc.amount)} ₽</td>
        <td style="padding:7px 10px;color:var(--t2)">${dt}</td>
        <td style="padding:7px 10px;text-align:center">${statusIcon}</td>
      </tr>`;
    }

    // Summary stats
    const receivablesColor = p.receivables > 0 ? '#D4A843' : '#10b981';
    const summaryHtml = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px">
      <div style="background:var(--bg1,#0d1117);border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:11px;color:var(--t2)">Оплачено</div>
        <div style="font-size:16px;font-weight:700;color:#10b981">${m(p.confirmed)} ₽</div>
      </div>
      <div style="background:var(--bg1,#0d1117);border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:11px;color:var(--t2)">Ожидается</div>
        <div style="font-size:16px;font-weight:700;color:#D4A843">${m(p.pending)} ₽</div>
      </div>
      <div style="background:var(--bg1,#0d1117);border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:11px;color:var(--t2)">Дебиторка</div>
        <div style="font-size:16px;font-weight:700;color:${receivablesColor}">${m(p.receivables)} ₽</div>
      </div>
    </div>`;

    return `<div style="background:var(--bg2,#151922);border:1px solid var(--brd);border-radius:10px;padding:14px 16px;margin-bottom:16px">
      <div style="font-weight:600;font-size:14px;margin-bottom:4px">Оплата заказчиком</div>
      ${progressBar}
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr>
            <th style="text-align:left;padding:5px 10px;border-bottom:1px solid var(--brd);color:var(--t2);font-size:12px">Тип</th>
            <th style="text-align:left;padding:5px 10px;border-bottom:1px solid var(--brd);color:var(--t2);font-size:12px">Описание</th>
            <th style="text-align:right;padding:5px 10px;border-bottom:1px solid var(--brd);color:var(--t2);font-size:12px">Сумма</th>
            <th style="padding:5px 10px;border-bottom:1px solid var(--brd);color:var(--t2);font-size:12px">Дата</th>
            <th style="text-align:center;padding:5px 10px;border-bottom:1px solid var(--brd);color:var(--t2);font-size:12px">Статус</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${summaryHtml}
      ${p.overdue > 0 ? `<div style="margin-top:10px;padding:8px 12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;font-size:12px;color:#ef4444;font-weight:600">Просроченных платежей: ${p.overdue}</div>` : ''}
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
