/**
 * ASGARD Field — History Page
 * Full work history + project detail view
 */
(() => {
'use strict';
const el = Utils.el;

// ─── History list (/field/history) ──────────────────────────────────────
const HistoryPage = {
  render() {
    const t = DS.t;
    const page = el('div', { className: 'field-page field-history' });

    page.appendChild(F.Header({ title: '\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0440\u0430\u0431\u043E\u0442', logo: true, back: true }));

    const content = el('div', { style: { padding: '16px 20px 100px', display: 'flex', flexDirection: 'column', gap: '12px' } });
    content.appendChild(F.Skeleton({ type: 'card', count: 4 }));
    page.appendChild(content);

    setTimeout(() => loadHistory(content), 0);
    return page;
  }
};

async function loadHistory(content) {
  const t = DS.t;
  const data = await API.fetch('/worker/projects');

  content.replaceChildren();

  const projects = data?.projects || (Array.isArray(data) ? data : []);

  if (!projects.length) {
    content.appendChild(F.Empty({ text: '\u041F\u043E\u043A\u0430 \u043D\u0435\u0442 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D\u043D\u044B\u0445 \u043F\u0440\u043E\u0435\u043A\u0442\u043E\u0432', icon: '\uD83D\uDCCB' }));
    return;
  }

  // Group by year
  const byYear = {};
  for (const p of projects) {
    const year = p.date_from ? new Date(p.date_from).getFullYear() : new Date().getFullYear();
    if (!byYear[year]) byYear[year] = [];
    byYear[year].push(p);
  }

  const years = Object.keys(byYear).sort((a, b) => b - a);
  let delay = 0;

  // Total stats
  const totalShifts = projects.reduce((s, p) => s + (p.shifts_count || 0), 0);
  const totalEarned = projects.reduce((s, p) => s + (p.total_earned || 0), 0);

  const statsRow = el('div', {
    style: {
      display: 'flex', gap: '12px', animation: 'fieldSlideUp 0.4s ease both',
    },
  });
  statsRow.appendChild(buildStatPill('\uD83D\uDCC5 ' + projects.length + ' \u043F\u0440\u043E\u0435\u043A\u0442\u043E\u0432', t));
  statsRow.appendChild(buildStatPill('\u2694\uFE0F ' + totalShifts + ' \u0441\u043C\u0435\u043D', t));
  statsRow.appendChild(buildStatPill('\uD83D\uDCB0 ' + Utils.formatMoney(totalEarned) + '\u20BD', t));
  content.appendChild(statsRow);

  for (const year of years) {
    delay += 0.06;
    // Year header
    content.appendChild(el('div', {
      style: {
        color: t.textTer, fontSize: '0.75rem', fontWeight: '700', letterSpacing: '0.1em',
        marginTop: '8px', padding: '4px 0',
        borderBottom: '1px solid ' + t.border,
        animation: 'fieldSlideUp 0.4s ease ' + delay + 's both',
      },
    }, String(year)));

    for (const p of byYear[year]) {
      delay += 0.06;
      const isActive = p.is_active === true;
      const isCompleted = p.work_status === '\u0417\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0430' || (!isActive && !p.is_active);
      const badgeText = isActive ? '\u25B6 \u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0439' : '\u0417\u0430\u0432\u0435\u0440\u0448\u0451\u043D';
      const badgeClr = isActive ? t.green : t.textSec;
      const roleLabel = p.field_role === 'senior_master' ? '\u041C\u0430\u0441\u0442\u0435\u0440 \u043E\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0439' :
                        p.field_role === 'shift_master' ? '\u041C\u0430\u0441\u0442\u0435\u0440 \u0441\u043C\u0435\u043D\u043D\u044B\u0439' :
                        p.role || '\u0420\u0430\u0431\u043E\u0447\u0438\u0439';

      content.appendChild(F.Card({
        title: p.work_title || p.title,
        subtitle: [
          p.city,
          Utils.formatDate(p.date_from) + (p.date_to ? ' \u2013 ' + Utils.formatDate(p.date_to) : ' \u2013 ...'),
          roleLabel,
          p.pm_name ? '\u0420\u041F: ' + p.pm_name : null,
        ].filter(Boolean).join(' \u00B7 '),
        badge: badgeText,
        badgeColor: badgeClr,
        fields: [
          { label: '\u0421\u043C\u0435\u043D\u044B', value: String(p.shifts_count || 0) },
          { label: '\u0417\u0430\u0440\u0430\u0431\u043E\u0442\u043E\u043A', value: Utils.formatMoney(p.total_earned || 0) + '\u20BD' },
        ],
        onClick: () => Router.navigate('/field/history/' + (p.work_id || p.id)),
        animDelay: delay,
      }));
    }
  }
}

function buildStatPill(text, t) {
  return el('div', {
    style: {
      flex: '1', textAlign: 'center', padding: '10px 6px', borderRadius: '12px',
      background: t.surface, border: '1px solid ' + t.border,
      color: t.textSec, fontSize: '0.6875rem', fontWeight: '600',
    },
  }, text);
}

// ─── History detail (/field/history/:work_id) ───────────────────────────
const HistoryDetailPage = {
  render(params) {
    const t = DS.t;
    const workId = params?.[0];
    const page = el('div', { className: 'field-page field-history-detail' });

    page.appendChild(F.Header({ title: '\u0414\u0435\u0442\u0430\u043B\u0438 \u043F\u0440\u043E\u0435\u043A\u0442\u0430', back: true, backHref: '/field/history' }));

    const content = el('div', { style: { padding: '16px 20px 100px', display: 'flex', flexDirection: 'column', gap: '14px' } });
    content.appendChild(F.Skeleton({ type: 'hero' }));
    content.appendChild(F.Skeleton({ type: 'card', count: 4 }));
    page.appendChild(content);

    if (workId) setTimeout(() => loadHistoryDetail(content, workId), 0);
    return page;
  }
};

async function loadHistoryDetail(content, workId) {
  const t = DS.t;
  const data = await API.fetch('/worker/projects/' + workId);

  content.replaceChildren();
  if (!data || data.error) {
    content.appendChild(F.Empty({ text: data?.error || '\u041F\u0440\u043E\u0435\u043A\u0442 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D', icon: '\uD83D\uDCCB' }));
    return;
  }

  const project = data.project || data;
  const checkins = data.checkins || data.days || [];

  // Project info
  content.appendChild(F.Card({
    title: project.work_title || project.title,
    subtitle: [project.city, project.object_name].filter(Boolean).join(' \u00B7 '),
    fields: [
      { label: '\u041F\u0435\u0440\u0438\u043E\u0434', value: Utils.formatDate(project.date_from) + ' \u2013 ' + Utils.formatDate(project.date_to || new Date()) },
      { label: '\u0421\u0442\u0430\u0432\u043A\u0430', value: Utils.formatMoney(project.day_rate || 0) + '\u20BD' },
    ],
    animDelay: 0.05,
  }));

  // Summary
  const totalHours = checkins.reduce((s, c) => s + (c.hours_worked || 0), 0);
  const totalEarned = checkins.reduce((s, c) => s + (c.amount_earned || 0), 0);

  content.appendChild(F.MoneyCard({
    amount: totalEarned,
    label: '\u0418\u0442\u043E\u0433\u043E \u0437\u0430\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u043E',
    details: checkins.length + ' \u0441\u043C\u0435\u043D \u00B7 ' + Utils.formatHours(totalHours),
    animDelay: 0.15,
  }));

  // Timesheet — day by day
  if (checkins.length) {
    const table = el('div', {
      style: { background: t.surface, borderRadius: '16px', padding: '14px', border: '1px solid ' + t.border, animation: 'fieldSlideUp 0.4s ease 0.25s both' },
    });
    table.appendChild(el('div', {
      style: { color: t.textTer, fontSize: '0.6875rem', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '10px' },
    }, '\u0422\u0410\u0411\u0415\u041B\u042C'));

    // Header
    const hdr = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 60px 60px 80px', gap: '4px', padding: '4px 0', borderBottom: '1px solid ' + t.border } });
    hdr.appendChild(el('span', { style: { color: t.textTer, fontSize: '0.625rem', fontWeight: '600' } }, '\u0414\u0410\u0422\u0410'));
    hdr.appendChild(el('span', { style: { color: t.textTer, fontSize: '0.625rem', fontWeight: '600', textAlign: 'center' } }, '\u041F\u0420\u0418\u0425\u041E\u0414'));
    hdr.appendChild(el('span', { style: { color: t.textTer, fontSize: '0.625rem', fontWeight: '600', textAlign: 'center' } }, '\u0427\u0410\u0421\u042B'));
    hdr.appendChild(el('span', { style: { color: t.textTer, fontSize: '0.625rem', fontWeight: '600', textAlign: 'right' } }, '\u0417\u0410\u0420\u0410\u0411\u041E\u0422\u041E\u041A'));
    table.appendChild(hdr);

    for (const c of checkins) {
      const row = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 60px 60px 80px', gap: '4px', padding: '6px 0', borderBottom: '1px solid ' + t.borderLight } });
      row.appendChild(el('span', { style: { color: t.text, fontSize: '0.8125rem' } }, Utils.formatDate(c.date)));
      row.appendChild(el('span', { style: { color: t.textSec, fontSize: '0.8125rem', textAlign: 'center' } }, Utils.formatTime(c.checkin_at)));
      row.appendChild(el('span', { style: { color: t.text, fontSize: '0.8125rem', textAlign: 'center', fontWeight: '500' } }, Utils.formatHours(c.hours_paid || c.hours_worked)));
      row.appendChild(el('span', { style: { color: t.gold, fontSize: '0.8125rem', textAlign: 'right', fontWeight: '600' } }, Utils.formatMoney(c.amount_earned || 0) + '\u20BD'));
      table.appendChild(row);
    }
    content.appendChild(table);
  }

  // Links
  const links = el('div', { style: { display: 'flex', gap: '12px', animation: 'fieldSlideUp 0.4s ease 0.35s both' } });
  links.appendChild(buildLinkBtn('\uD83D\uDCB0 \u0424\u0438\u043D\u0430\u043D\u0441\u044B', () => Router.navigate('/field/money/' + workId), t));
  content.appendChild(links);
}

function buildLinkBtn(text, onClick, t) {
  return el('button', {
    style: {
      flex: '1', padding: '12px', borderRadius: '14px', border: '1px solid ' + t.border,
      background: t.surface, color: t.gold, fontSize: '0.875rem', fontWeight: '600', cursor: 'pointer',
      textAlign: 'center',
    },
    onClick,
  }, text);
}

Router.register('/field/history', HistoryPage);
Router.register('/field/history/:work_id', HistoryDetailPage);
})();
