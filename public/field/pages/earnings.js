/**
 * ASGARD Field — Earnings Page (Мои выплаты)
 * Worker sees per-diem, salary, advances, bonuses, penalties
 * Can confirm receipt of paid payments
 */
(() => {
'use strict';
const el = Utils.el;

const TYPE_LABELS = {
  per_diem: 'Суточные', salary: 'Зарплата', advance: 'Аванс',
  bonus: 'Премия', penalty: 'Удержание'
};
const TYPE_ICONS = {
  per_diem: '\uD83C\uDF19', salary: '\uD83D\uDCB0', advance: '\uD83D\uDCB8',
  bonus: '\uD83C\uDF81', penalty: '\u26A0\uFE0F'
};
const STATUS_COLORS = {
  pending: '#f59e0b', paid: '#3b82f6', confirmed: '#10b981', cancelled: '#6b7280'
};
const STATUS_LABELS = {
  pending: '\u041E\u0436\u0438\u0434\u0430\u0435\u0442', paid: '\u0412\u044B\u043F\u043B\u0430\u0447\u0435\u043D\u043E',
  confirmed: '\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u043E', cancelled: '\u041E\u0442\u043C\u0435\u043D\u0435\u043D\u043E'
};

const EarningsPage = {
  render() {
    const t = DS.t;
    const page = el('div', { className: 'field-page field-earnings' });

    page.appendChild(F.Header({ title: '\u041C\u043E\u0438 \u0432\u044B\u043F\u043B\u0430\u0442\u044B', logo: true, back: true }));

    const content = el('div', { style: { padding: '16px 20px 100px', display: 'flex', flexDirection: 'column', gap: '16px' } });
    content.appendChild(F.Skeleton({ type: 'hero' }));
    content.appendChild(F.Skeleton({ type: 'card', count: 3 }));
    page.appendChild(content);

    setTimeout(() => loadEarnings(content), 0);
    return page;
  }
};

async function loadEarnings(content) {
  const t = DS.t;
  const [balance, payments] = await Promise.all([
    API.fetch('/worker-payments/my/balance'),
    API.fetch('/worker-payments/my'),
  ]);

  content.replaceChildren();

  if (!balance) {
    content.appendChild(F.Empty({ text: '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C', icon: '\uD83D\uDCB3' }));
    return;
  }

  let delay = 0;
  const nd = () => { delay += 0.08; return delay; };

  // ─── Hero card — К получению ────────────────────────────────
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
  heroContent.appendChild(el('div', {
    style: { color: t.textSec, fontSize: '0.75rem', fontWeight: '600', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '4px' },
  }, '\u041A \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u044E'));

  const amountEl = el('div', { style: { color: t.gold, fontWeight: '700', fontSize: '2.5rem', lineHeight: '1.1' } });
  heroContent.appendChild(amountEl);
  setTimeout(() => Utils.countUp(amountEl, balance.total_pending || 0, 1000), 200);
  amountEl.appendChild(el('span', { style: { fontSize: '1.5rem', fontWeight: '600', marginLeft: '4px' } }, ' \u20BD'));

  heroContent.appendChild(el('div', {
    style: { color: t.textSec, fontSize: '0.8125rem', marginTop: '8px' },
  }, '\u0417\u0430\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u043E \u0437\u0430 ' + balance.year + ': ' + Utils.formatMoney(balance.total_earned) + '\u20BD'));

  heroCard.appendChild(heroContent);
  content.appendChild(heroCard);

  // ─── Per-diem card ──────────────────────────────────────────
  if (balance.per_diem > 0) {
    const pdCard = el('div', {
      style: {
        background: t.surface, borderRadius: '16px', padding: '16px',
        border: '1px solid ' + t.border,
        animation: 'fieldSlideUp 0.4s ease ' + nd() + 's both',
      },
    });
    pdCard.appendChild(el('div', {
      style: { color: t.textTer, fontSize: '0.6875rem', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '10px' },
    }, '\uD83C\uDF19 \u0421\u0423\u0422\u041E\u0427\u041D\u042B\u0415'));

    const pdRows = [
      { label: '\u041D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u043E', value: Utils.formatMoney(balance.per_diem) + '\u20BD' },
      { label: '\u041F\u043E\u043B\u0443\u0447\u0435\u043D\u043E', value: Utils.formatMoney(balance.per_diem_paid) + '\u20BD', color: t.green },
      { label: '\u041E\u0436\u0438\u0434\u0430\u0435\u0442', value: Utils.formatMoney(balance.per_diem_pending) + '\u20BD', color: t.orange },
    ];

    for (const row of pdRows) {
      const r = el('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '5px 0' } });
      r.appendChild(el('span', { style: { color: t.textSec, fontSize: '0.8125rem' } }, row.label));
      r.appendChild(el('span', { style: { color: row.color || t.text, fontSize: '0.8125rem', fontWeight: '600' } }, row.value));
      pdCard.appendChild(r);
    }

    // Progress bar
    const pdTotal = balance.per_diem || 1;
    const pdPct = Math.min(100, (balance.per_diem_paid / pdTotal) * 100);
    const bar = el('div', { style: { marginTop: '10px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', height: '6px', overflow: 'hidden' } });
    bar.appendChild(el('div', { style: { height: '100%', width: pdPct + '%', borderRadius: '4px', background: t.goldGrad, transition: 'width 0.8s ease' } }));
    pdCard.appendChild(bar);

    content.appendChild(pdCard);
  }

  // ─── Year totals card ───────────────────────────────────────
  const yearCard = el('div', {
    style: {
      background: t.surface, borderRadius: '16px', padding: '16px',
      border: '1px solid ' + t.border,
      animation: 'fieldSlideUp 0.4s ease ' + nd() + 's both',
    },
  });
  yearCard.appendChild(el('div', {
    style: { color: t.textTer, fontSize: '0.6875rem', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '10px' },
  }, '\u0418\u0422\u041E\u0413\u041E \u0417\u0410 ' + balance.year));

  const yearRows = [
    { label: '\u0417\u0430\u0440\u043F\u043B\u0430\u0442\u0430', value: Utils.formatMoney(balance.salary) + '\u20BD' },
    { label: '\u0421\u0443\u0442\u043E\u0447\u043D\u044B\u0435', value: Utils.formatMoney(balance.per_diem) + '\u20BD' },
    { label: '\u041F\u0440\u0435\u043C\u0438\u0438', value: '+' + Utils.formatMoney(balance.bonus) + '\u20BD', color: t.green },
    { label: '\u0423\u0434\u0435\u0440\u0436\u0430\u043D\u0438\u044F', value: '\u2212' + Utils.formatMoney(balance.penalty) + '\u20BD', color: t.red },
    { label: '\u0410\u0432\u0430\u043D\u0441\u044B', value: '\u2212' + Utils.formatMoney(balance.advance) + '\u20BD', color: t.red },
    { label: '\u0412\u044B\u043F\u043B\u0430\u0447\u0435\u043D\u043E', value: Utils.formatMoney(balance.total_paid) + '\u20BD', bold: true, color: t.green },
    { label: '\u041A \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u044E', value: Utils.formatMoney(balance.total_pending) + '\u20BD', bold: true, color: t.gold },
  ];

  for (const row of yearRows) {
    const r = el('div', {
      style: {
        display: 'flex', justifyContent: 'space-between', padding: '5px 0',
        borderTop: row.bold ? '1px solid ' + t.border : 'none',
        marginTop: row.bold ? '4px' : '0',
      },
    });
    r.appendChild(el('span', { style: { color: row.color || t.textSec, fontSize: '0.8125rem', fontWeight: row.bold ? '700' : '400' } }, row.label));
    r.appendChild(el('span', { style: { color: row.color || t.text, fontSize: '0.8125rem', fontWeight: row.bold ? '700' : '600' } }, row.value));
    yearCard.appendChild(r);
  }
  content.appendChild(yearCard);

  // ─── Payment history ────────────────────────────────────────
  const payList = payments?.payments || [];
  if (payList.length > 0) {
    const histCard = el('div', {
      style: {
        background: t.surface, borderRadius: '16px', padding: '16px',
        border: '1px solid ' + t.border,
        animation: 'fieldSlideUp 0.4s ease ' + nd() + 's both',
      },
    });
    histCard.appendChild(el('div', {
      style: { color: t.textTer, fontSize: '0.6875rem', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '10px' },
    }, '\u0418\u0421\u0422\u041E\u0420\u0418\u042F \u041E\u041F\u0415\u0420\u0410\u0426\u0418\u0419'));

    for (const p of payList) {
      const row = el('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 0',
          borderBottom: '1px solid ' + t.border,
        },
      });

      // Icon
      row.appendChild(el('div', {
        style: { fontSize: '1.5rem', width: '36px', textAlign: 'center', flexShrink: '0' },
      }, TYPE_ICONS[p.type] || '\uD83D\uDCB3'));

      // Info
      const info = el('div', { style: { flex: '1', minWidth: '0' } });
      info.appendChild(el('div', { style: { color: t.text, fontSize: '0.875rem', fontWeight: '600' } },
        TYPE_LABELS[p.type] || p.type));

      const meta = [];
      if (p.work_title) meta.push(p.work_title);
      if (p.period_from && p.period_to) meta.push(Utils.formatDate(p.period_from) + ' \u2013 ' + Utils.formatDate(p.period_to));
      else if (p.created_at) meta.push(Utils.formatDate(p.created_at));
      if (p.comment) meta.push(p.comment);
      info.appendChild(el('div', {
        style: { color: t.textTer, fontSize: '0.6875rem', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      }, meta.join(' \u00B7 ')));

      row.appendChild(info);

      // Amount
      const isDeduction = p.type === 'advance' || p.type === 'penalty';
      row.appendChild(el('div', {
        style: {
          color: isDeduction ? t.red : t.text, fontWeight: '700', fontSize: '0.9375rem',
          whiteSpace: 'nowrap', textAlign: 'right',
        },
      }, (isDeduction ? '\u2212' : '+') + Utils.formatMoney(p.amount) + '\u20BD'));

      // Status badge
      const badge = el('div', {
        style: {
          fontSize: '0.625rem', fontWeight: '600', padding: '2px 6px',
          borderRadius: '8px', textTransform: 'uppercase', whiteSpace: 'nowrap',
          color: STATUS_COLORS[p.status] || t.textSec,
          background: (STATUS_COLORS[p.status] || t.textSec) + '20',
        },
      }, STATUS_LABELS[p.status] || p.status);
      row.appendChild(badge);

      // Confirm button (for paid payments)
      if (p.status === 'paid') {
        const confirmBtn = el('button', {
          style: {
            background: t.goldGrad, color: '#000', border: 'none', borderRadius: '8px',
            padding: '6px 12px', fontSize: '0.6875rem', fontWeight: '700', cursor: 'pointer',
            whiteSpace: 'nowrap', marginLeft: '6px',
          },
          onClick: async () => {
            confirmBtn.textContent = '...';
            confirmBtn.disabled = true;
            const result = await API.post('/worker-payments/my/' + p.id + '/confirm');
            if (result && result.ok) {
              F.Toast({ text: '\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u043E \u2705' });
              loadEarnings(content);
            } else {
              F.Toast({ text: result?.error || '\u041E\u0448\u0438\u0431\u043A\u0430', type: 'error' });
              confirmBtn.textContent = '\u041F\u043E\u043B\u0443\u0447\u0438\u043B \u2713';
              confirmBtn.disabled = false;
            }
          },
        }, '\u041F\u043E\u043B\u0443\u0447\u0438\u043B \u2713');
        row.appendChild(confirmBtn);
      }

      histCard.appendChild(row);
    }

    content.appendChild(histCard);
  } else {
    content.appendChild(el('div', {
      style: {
        textAlign: 'center', padding: '24px', color: t.textTer, fontSize: '0.875rem',
        animation: 'fieldSlideUp 0.4s ease ' + nd() + 's both',
      },
    }, '\u041D\u0435\u0442 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0439'));
  }
}

Router.register('/field/earnings', EarningsPage);
})();
