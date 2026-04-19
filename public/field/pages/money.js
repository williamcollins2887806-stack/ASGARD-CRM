/**
 * ASGARD Field — Money Page
 * Finances: current project tariff breakdown, earnings history
 */
(() => {
'use strict';
const el = Utils.el;

// ─── Main money page (/field/money) ─────────────────────────────────────
const MoneyPage = {
  render() {
    const t = DS.t;
    const page = el('div', { className: 'field-page field-money' });

    page.appendChild(F.Header({ title: '\u041C\u043E\u0438 \u0434\u0435\u043D\u044C\u0433\u0438', logo: true, back: true }));

    const content = el('div', { style: { padding: '16px 20px 100px', display: 'flex', flexDirection: 'column', gap: '16px' } });
    content.appendChild(F.Skeleton({ type: 'hero' }));
    content.appendChild(F.Skeleton({ type: 'card', count: 3 }));
    page.appendChild(content);

    setTimeout(() => loadMoney(content), 0);
    return page;
  }
};

async function loadMoney(content) {
  const t = DS.t;
  const [finances, project] = await Promise.all([
    API.fetch('/worker/finances'),
    API.fetch('/worker/active-project'),
  ]);

  content.replaceChildren();

  if (!finances) {
    content.appendChild(F.Empty({ text: '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0434\u0430\u043D\u043D\u044B\u0435', icon: '\uD83D\uDCB0' }));
    return;
  }

  if (finances.error === 'per_diem_not_set') {
    content.appendChild(F.Empty({ text: finances.message || '\u0421\u0443\u0442\u043E\u0447\u043D\u044B\u0435 \u043D\u0435 \u0443\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u044B', icon: '\u26A0\uFE0F' }));
    return;
  }

  // SSoT v1.2: activeWork из by_work[], отсортированных по активности и количеству смен
  const sortedWorks = (finances.by_work || []).slice().sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    return (b.days_worked || 0) - (a.days_worked || 0);
  });
  const activeWork = sortedWorks[0] || null;
  const cur = activeWork || {};
  const all = finances;
  const proj = project?.project || project || {};
  const tariff = proj.tariff || {};
  const assignment = project?.assignment || proj;

  let delay = 0;
  const nd = () => { delay += 0.08; return delay; };

  // Hero card — total earned on current project
  const heroCard = el('div', {
    style: {
      background: t.heroGrad, backgroundSize: '200% 200%', animation: 'fieldGradShift 8s ease infinite',
      borderRadius: '20px', padding: '24px', position: 'relative', overflow: 'hidden',
    },
  });
  heroCard.appendChild(el('div', {
    style: { position: 'absolute', right: '-10px', top: '50%', transform: 'translateY(-50%)', fontSize: '4rem', fontWeight: '900', color: 'rgba(255,255,255,0.03)', letterSpacing: '4px', pointerEvents: 'none' },
  }, 'ASGARD'));

  const heroContent = el('div', { style: { position: 'relative', zIndex: '1' } });
  if (cur.work_title) {
    heroContent.appendChild(el('div', { style: { color: t.textSec, fontSize: '0.75rem', fontWeight: '600', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '4px' } },
      '\u0422\u0435\u043A\u0443\u0449\u0438\u0439 \u043F\u0440\u043E\u0435\u043A\u0442: ' + cur.work_title));
  }

  const amountEl = el('div', { style: { color: t.gold, fontWeight: '700', fontSize: '2.5rem', lineHeight: '1.1' } });
  heroContent.appendChild(amountEl);
  setTimeout(() => Utils.countUp(amountEl, cur.total_earned || 0, 1000), 200);
  const suffix = el('span', { style: { fontSize: '1.5rem', fontWeight: '600', marginLeft: '4px' } }, ' \u20BD');
  amountEl.appendChild(suffix);

  const curShifts = cur.days_worked || 0;
  if (curShifts) {
    heroContent.appendChild(el('div', { style: { color: t.textSec, fontSize: '0.8125rem', marginTop: '8px' } },
      '\u041E\u0442\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u043E ' + curShifts + ' \u0441\u043C\u0435\u043D'));

    // Progress bar
    const totalShifts = cur.total_shifts || 20;
    const pct = Math.min(100, (curShifts / totalShifts) * 100);
    const bar = el('div', { style: { marginTop: '10px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', height: '6px', overflow: 'hidden' } });
    bar.appendChild(el('div', { style: { height: '100%', width: pct + '%', borderRadius: '4px', background: t.goldGrad, transition: 'width 0.8s ease' } }));
    heroContent.appendChild(bar);
    heroContent.appendChild(el('div', { style: { color: t.textTer, fontSize: '0.6875rem', marginTop: '4px' } },
      curShifts + ' \u0438\u0437 ' + totalShifts + ' \u0441\u043C\u0435\u043D'));
  }

  heroCard.appendChild(heroContent);
  content.appendChild(heroCard);

  // Tariff card
  const tariffCard = el('div', {
    style: {
      background: t.goldBg, borderRadius: '16px', padding: '16px',
      border: '1px solid rgba(196,154,42,0.12)',
      animation: 'fieldSlideUp 0.4s ease ' + nd() + 's both',
    },
  });
  tariffCard.appendChild(el('div', {
    style: { color: t.textTer, fontSize: '0.6875rem', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '10px' },
  }, '\u0422\u0410\u0420\u0418\u0424\u041D\u0410\u042F \u0421\u0415\u0422\u041A\u0410'));

  const tariffLines = [];
  const posName = tariff.position_name || assignment.tariff_position || '\u0420\u0430\u0431\u043E\u0447\u0438\u0439';
  const points = tariff.points || assignment.tariff_points || 0;
  const ratePerShift = tariff.rate_per_shift || assignment.day_rate || 0;
  const pointValue = tariff.point_value || 500;

  tariffLines.push({ label: posName, value: points + ' \u0431\u0430\u043B\u043B\u043E\u0432 \u00D7 ' + Utils.formatMoney(pointValue) + '\u20BD = ' + Utils.formatMoney(ratePerShift) + '\u20BD/\u0441\u043C' });

  if (tariff.combination_name || assignment.combo_position) {
    const comboName = tariff.combination_name || assignment.combo_position;
    tariffLines.push({ label: '+ \u0421\u043E\u0432\u043C\u0435\u0449\u0435\u043D\u0438\u0435: ' + comboName, value: '+1 \u0431\u0430\u043B\u043B (+500\u20BD)', color: t.gold });
  }

  if (assignment.per_diem) {
    tariffLines.push({ label: '\u041F\u0430\u0439\u043A\u043E\u0432\u044B\u0435', value: Utils.formatMoney(assignment.per_diem) + '\u20BD/\u0441\u0443\u0442' });
  }

  for (const line of tariffLines) {
    const row = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '6px 0', gap: '8px' } });
    row.appendChild(el('span', { style: { color: line.color || t.textSec, fontSize: '0.8125rem', flex: '1' } }, line.label));
    row.appendChild(el('span', { style: { color: t.text, fontSize: '0.8125rem', fontWeight: '600', textAlign: 'right', whiteSpace: 'nowrap' } }, line.value));
    tariffCard.appendChild(row);
  }

  tariffCard.appendChild(el('div', { style: { borderTop: '1px solid ' + t.border, marginTop: '8px', paddingTop: '8px', color: t.textTer, fontSize: '0.6875rem', fontStyle: 'italic' } },
    '\u0422\u0430\u0440\u0438\u0444\u043D\u0430\u044F \u0441\u0435\u0442\u043A\u0430 \u0443\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0430 \u041A\u0443\u0434\u0440\u044F\u0448\u043E\u0432\u044B\u043C \u041E.\u0421. 01.10.2025. 1 \u0431\u0430\u043B\u043B = ' + Utils.formatMoney(pointValue) + '\u20BD'));
  content.appendChild(tariffCard);

  // Trip stages breakdown (loaded async)
  const stagesCard = el('div', {
    style: { background: t.surface, borderRadius: '16px', padding: '16px', border: '1px solid ' + t.border, animation: 'fieldSlideUp 0.4s ease ' + nd() + 's both', display: 'none' },
  });
  stagesCard.appendChild(el('div', {
    style: { color: t.textTer, fontSize: '0.6875rem', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '10px' },
  }, '\u041C\u0410\u0420\u0428\u0420\u0423\u0422 \u0414\u041E \u041E\u0411\u042A\u0415\u041A\u0422\u0410'));
  content.appendChild(stagesCard);

  // Load stages for current project
  const STAGE_LABELS_M = { medical: '\u041C\u0435\u0434\u043E\u0441\u043C\u043E\u0442\u0440', travel: '\u0414\u043E\u0440\u043E\u0433\u0430', waiting: '\u041E\u0436\u0438\u0434\u0430\u043D\u0438\u0435', warehouse: '\u0421\u043A\u043B\u0430\u0434', day_off: '\u0412\u044B\u0445\u043E\u0434\u043D\u043E\u0439' };
  const STATUS_ICONS_M = { completed: '\u2705', approved: '\u2705', adjusted: '\u2705', active: '\uD83D\uDD35', planned: '\u26AC', rejected: '\u274C' };
  const workIdForStages = proj.work_id || proj.id;
  if (workIdForStages) {
    API.fetch('/stages/my/' + workIdForStages).then(stData => {
      if (!stData || !stData.stages || stData.stages.length === 0) return;
      stagesCard.style.display = '';
      const preObj = stData.stages.filter(s => s.stage_type !== 'object' && s.status !== 'rejected');
      let stagesTotal = 0;
      for (const st of preObj) {
        const earned = parseFloat(st.amount_earned || 0);
        stagesTotal += earned;
        const label = (STAGE_LABELS_M[st.stage_type] || st.stage_type) + ': ' + (st.days_count || 1) + ' \u0434\u043D. \u00D7 ' + Utils.formatMoney(parseFloat(st.rate_per_day || 0)) + '\u20BD';
        const icon = STATUS_ICONS_M[st.status] || '';
        const row = el('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '5px 0' } });
        row.appendChild(el('span', { style: { color: t.textSec, fontSize: '0.8125rem' } }, label));
        row.appendChild(el('span', { style: { color: t.text, fontSize: '0.8125rem', fontWeight: '600' } }, Utils.formatMoney(earned) + '\u20BD ' + icon));
        stagesCard.appendChild(row);
      }
      // Total
      const totalRow = el('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid ' + t.border, marginTop: '4px', paddingTop: '8px' } });
      totalRow.appendChild(el('span', { style: { color: t.text, fontSize: '0.8125rem', fontWeight: '700' } }, '\u0418\u0442\u043E\u0433\u043E \u0434\u043E \u043E\u0431\u044A\u0435\u043A\u0442\u0430'));
      totalRow.appendChild(el('span', { style: { color: t.gold, fontSize: '0.8125rem', fontWeight: '700' } }, Utils.formatMoney(stagesTotal) + '\u20BD'));
      stagesCard.appendChild(totalRow);
    }).catch(() => {});
  }

  // Breakdown
  const breakCard = el('div', {
    style: { background: t.surface, borderRadius: '16px', padding: '16px', border: '1px solid ' + t.border, animation: 'fieldSlideUp 0.4s ease ' + nd() + 's both' },
  });
  breakCard.appendChild(el('div', {
    style: { color: t.textTer, fontSize: '0.6875rem', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '10px' },
  }, '\u041D\u0410 \u041E\u0411\u042A\u0415\u041A\u0422\u0415'));

  const rows = [
    { label: '\u0424\u041E\u0422: ' + (cur.days_worked || 0) + ' \u0441\u043C\u0435\u043D', value: Utils.formatMoney(cur.fot || 0) + '\u20BD' },
  ];
  if (cur.per_diem_accrued) {
    rows.push({ label: '\u0421\u0443\u0442\u043E\u0447\u043D\u044B\u0435: ' + (cur.days_worked || 0) + ' \u0434\u043D. \u00D7 ' + Utils.formatMoney(cur.per_diem_rate || 0) + '\u20BD', value: Utils.formatMoney(cur.per_diem_accrued) + '\u20BD' });
  }
  if (cur.bonus_paid) rows.push({ label: '\u0411\u043E\u043D\u0443\u0441\u044B', value: '+' + Utils.formatMoney(cur.bonus_paid) + '\u20BD', color: t.green });
  if (cur.penalty) rows.push({ label: '\u0423\u0434\u0435\u0440\u0436\u0430\u043D\u0438\u044F', value: '\u2212' + Utils.formatMoney(cur.penalty) + '\u20BD', color: t.red });
  if (cur.advance_paid) rows.push({ label: '\u0410\u0432\u0430\u043D\u0441\u044B', value: '\u2212' + Utils.formatMoney(cur.advance_paid) + '\u20BD', color: t.red });

  rows.push({ label: '\u0418\u0422\u041E\u0413\u041E \u043D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u043E', value: Utils.formatMoney(cur.total_earned || 0) + '\u20BD', bold: true });
  const pending = cur.total_pending || 0;
  if (pending < 0) {
    rows.push({ label: '\u041F\u0415\u0420\u0415\u041F\u041B\u0410\u0422\u0410', value: Utils.formatMoney(Math.abs(pending)) + '\u20BD', bold: true, color: t.green });
  } else {
    rows.push({ label: '\u041A \u0412\u042B\u041F\u041B\u0410\u0422\u0415', value: Utils.formatMoney(pending) + '\u20BD', bold: true, color: t.gold });
  }

  for (const row of rows) {
    const r = el('div', {
      style: {
        display: 'flex', justifyContent: 'space-between', padding: '6px 0',
        borderTop: row.bold ? '1px solid ' + t.border : 'none',
        marginTop: row.bold ? '4px' : '0', paddingTop: row.bold ? '8px' : '6px',
      },
    });
    r.appendChild(el('span', { style: { color: row.color || t.textSec, fontSize: '0.8125rem', fontWeight: row.bold ? '700' : '400' } }, row.label));
    r.appendChild(el('span', { style: { color: row.color || t.text, fontSize: '0.8125rem', fontWeight: row.bold ? '700' : '600' } }, row.value));
    breakCard.appendChild(r);
  }
  content.appendChild(breakCard);

  // All time summary
  if (all.total_earned && (finances.by_work || []).length > 0) {
    const allCard = el('div', {
      style: { background: t.surface, borderRadius: '16px', padding: '16px', border: '1px solid ' + t.border, animation: 'fieldSlideUp 0.4s ease ' + nd() + 's both' },
    });
    allCard.appendChild(el('div', {
      style: { color: t.textTer, fontSize: '0.6875rem', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '10px' },
    }, '\u0417\u0410 \u0412\u0421\u0401 \u0412\u0420\u0415\u041C\u042F'));

    const allRows = [
      { label: '\u0412\u0441\u0435\u0433\u043E \u043D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u043E', value: Utils.formatMoney(all.total_earned) + '\u20BD' },
      { label: '\u0412\u044B\u043F\u043B\u0430\u0447\u0435\u043D\u043E', value: Utils.formatMoney(all.total_paid) + '\u20BD', color: t.green },
      { label: '\u041E\u0436\u0438\u0434\u0430\u0435\u0442 \u0432\u044B\u043F\u043B\u0430\u0442\u044B', value: Utils.formatMoney(all.total_pending) + '\u20BD', color: t.orange },
    ];
    for (const row of allRows) {
      const r = el('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '5px 0' } });
      r.appendChild(el('span', { style: { color: t.textSec, fontSize: '0.8125rem' } }, row.label));
      r.appendChild(el('span', { style: { color: row.color || t.text, fontSize: '0.8125rem', fontWeight: '600' } }, row.value));
      allCard.appendChild(r);
    }
    content.appendChild(allCard);
  }

  // History button
  content.appendChild(el('div', {
    style: {
      textAlign: 'center', padding: '12px', color: t.gold, fontSize: '0.875rem',
      fontWeight: '600', cursor: 'pointer', animation: 'fieldSlideUp 0.4s ease ' + nd() + 's both',
    },
    onClick: () => Router.navigate('/field/history'),
  }, '\u0412\u0441\u044F \u0438\u0441\u0442\u043E\u0440\u0438\u044F \u0434\u043E\u0445\u043E\u0434\u043E\u0432 \u2192'));

  // Projects history
  if (finances.projects && finances.projects.length) {
    for (const p of finances.projects) {
      const isPaid = p.status === 'paid' || p.fully_paid;
      content.appendChild(F.Card({
        title: p.work_title || p.title,
        subtitle: p.city + (p.date_from ? ' \u00B7 ' + Utils.formatDate(p.date_from) + ' \u2013 ' + Utils.formatDate(p.date_to) : ''),
        badge: isPaid ? '\u0412\u044B\u043F\u043B\u0430\u0447\u0435\u043D\u043E \u2713' : '\u0412 \u043F\u0440\u043E\u0446\u0435\u0441\u0441\u0435',
        badgeColor: isPaid ? DS.t.green : DS.t.orange,
        fields: [
          { label: '\u0421\u043C\u0435\u043D\u044B', value: String(p.shifts_count || 0) },
          { label: '\u0417\u0430\u0440\u0430\u0431\u043E\u0442\u043E\u043A', value: Utils.formatMoney(p.total_earned || 0) + '\u20BD' },
        ],
        onClick: () => Router.navigate('/field/money/' + (p.work_id || p.id)),
        animDelay: nd(),
      }));
    }
  }
}

// ─── Money detail page (/field/money/:work_id) ──────────────────────────
const MoneyDetailPage = {
  render(params) {
    const t = DS.t;
    const workId = params?.[0];
    const page = el('div', { className: 'field-page field-money-detail' });

    page.appendChild(F.Header({ title: '\u0424\u0438\u043D\u0430\u043D\u0441\u044B \u043F\u0440\u043E\u0435\u043A\u0442\u0430', back: true, backHref: '/field/money' }));

    const content = el('div', { style: { padding: '16px 20px 100px', display: 'flex', flexDirection: 'column', gap: '16px' } });
    content.appendChild(F.Skeleton({ type: 'card', count: 3 }));
    page.appendChild(content);

    if (workId) setTimeout(() => loadMoneyDetail(content, workId), 0);
    return page;
  }
};

async function loadMoneyDetail(content, workId) {
  const t = DS.t;
  const data = await API.fetch('/worker/finances/' + workId);

  content.replaceChildren();
  if (!data || data.error) {
    content.appendChild(F.Empty({ text: data?.error || '\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445', icon: '\uD83D\uDCB0' }));
    return;
  }

  // Title
  if (data.work_title) {
    content.appendChild(el('div', {
      style: { color: t.text, fontWeight: '600', fontSize: '1.125rem', animation: 'fieldSlideUp 0.4s ease both' },
    }, data.work_title));
  }

  // Earned card
  content.appendChild(F.MoneyCard({
    amount: data.total_earned || 0,
    label: '\u041D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u043E',
    details: (data.days_worked || 0) + ' \u0441\u043C\u0435\u043D \u00D7 ' + Utils.formatMoney(data.day_rate || 0) + '\u20BD',
    animDelay: 0.1,
  }));

  // Detailed breakdown
  const breakCard = el('div', {
    style: { background: t.surface, borderRadius: '16px', padding: '16px', border: '1px solid ' + t.border, animation: 'fieldSlideUp 0.4s ease 0.2s both' },
  });
  breakCard.appendChild(el('div', {
    style: { color: t.textTer, fontSize: '0.6875rem', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px' },
  }, '\u041F\u041E\u0414\u0420\u041E\u0411\u041D\u041E'));

  const rows = [];
  rows.push({ l: '\u0411\u0430\u0437\u043E\u0432\u0430\u044F \u0441\u0442\u0430\u0432\u043A\u0430', v: Utils.formatMoney(data.base_amount || 0) + '\u20BD' });
  if (data.per_diem_total) rows.push({ l: '\u041F\u0430\u0439\u043A\u043E\u0432\u044B\u0435 (' + (data.per_diem_days || 0) + ' \u0434\u043D.)', v: Utils.formatMoney(data.per_diem_total) + '\u20BD' });
  if (data.bonuses) rows.push({ l: '\u0411\u043E\u043D\u0443\u0441\u044B', v: '+' + Utils.formatMoney(data.bonuses) + '\u20BD', c: t.green });
  if (data.overtime_amount) rows.push({ l: '\u041F\u0435\u0440\u0435\u0440\u0430\u0431\u043E\u0442\u043A\u0438', v: '+' + Utils.formatMoney(data.overtime_amount) + '\u20BD', c: t.green });
  if (data.penalties) rows.push({ l: '\u0428\u0442\u0440\u0430\u0444\u044B', v: '\u2212' + Utils.formatMoney(data.penalties) + '\u20BD', c: t.red });
  rows.push({ l: '\u0418\u0442\u043E\u0433\u043E \u043D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u043E', v: Utils.formatMoney(data.total_earned || 0) + '\u20BD', b: true });
  if (data.total_paid) rows.push({ l: '\u0412\u044B\u043F\u043B\u0430\u0447\u0435\u043D\u043E (\u0430\u0432\u0430\u043D\u0441\u044B)', v: '\u2212' + Utils.formatMoney(data.total_paid) + '\u20BD', c: t.red });
  rows.push({ l: '\u041A \u0432\u044B\u043F\u043B\u0430\u0442\u0435', v: Utils.formatMoney(data.remaining || 0) + '\u20BD', b: true, c: t.gold });

  for (const row of rows) {
    const r = el('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderTop: row.b ? '1px solid ' + t.border : 'none', marginTop: row.b ? '4px' : '0' } });
    r.appendChild(el('span', { style: { color: row.c || t.textSec, fontSize: '0.8125rem', fontWeight: row.b ? '700' : '400' } }, row.l));
    r.appendChild(el('span', { style: { color: row.c || t.text, fontSize: '0.8125rem', fontWeight: row.b ? '700' : '600' } }, row.v));
    breakCard.appendChild(r);
  }
  content.appendChild(breakCard);

  // Advances list
  if (data.advances && data.advances.length) {
    const advCard = el('div', {
      style: { background: t.surface, borderRadius: '16px', padding: '16px', border: '1px solid ' + t.border, animation: 'fieldSlideUp 0.4s ease 0.3s both' },
    });
    advCard.appendChild(el('div', {
      style: { color: t.textTer, fontSize: '0.6875rem', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px' },
    }, '\u0410\u0412\u0410\u041D\u0421\u042B'));
    for (const a of data.advances) {
      const r = el('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '4px 0' } });
      r.appendChild(el('span', { style: { color: t.textSec, fontSize: '0.8125rem' } }, Utils.formatDate(a.date) + (a.method ? ' \u00B7 ' + a.method : '')));
      r.appendChild(el('span', { style: { color: t.text, fontSize: '0.8125rem', fontWeight: '600' } }, Utils.formatMoney(a.amount) + '\u20BD'));
      advCard.appendChild(r);
    }
    content.appendChild(advCard);
  }
}

Router.register('/field/money', MoneyPage);
Router.register('/field/money/:work_id', MoneyDetailPage);
})();
