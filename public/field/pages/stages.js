/**
 * ASGARD Field — Trip Stages Page (Session 12)
 * Worker: /field/stages, /field/stages/:work_id
 * Master: /field/crew-stages
 */
(() => {
'use strict';
const el = Utils.el;

const STAGE_ICONS = {
  medical: '\uD83D\uDFE3', travel: '\uD83D\uDD35', waiting: '\uD83D\uDFE1',
  warehouse: '\uD83D\uDFE0', day_off: '\u26AA', object: '\uD83D\uDFE2',
};
const STAGE_EMOJI = {
  medical: '\uD83C\uDFE5', travel: '\u2708\uFE0F', waiting: '\u23F3',
  warehouse: '\uD83D\uDCE6', day_off: '\uD83D\uDECC', object: '\u2694\uFE0F',
};
const STAGE_LABELS = {
  medical: '\u041C\u0435\u0434\u043E\u0441\u043C\u043E\u0442\u0440', travel: '\u0414\u043E\u0440\u043E\u0433\u0430',
  waiting: '\u041E\u0436\u0438\u0434\u0430\u043D\u0438\u0435', warehouse: '\u0421\u043A\u043B\u0430\u0434',
  day_off: '\u0412\u044B\u0445\u043E\u0434\u043D\u043E\u0439', object: '\u041E\u0431\u044A\u0435\u043A\u0442',
};
const STAGE_COLORS = {
  medical: '#9333EA', travel: '#3B82F6', waiting: '#F59E0B',
  warehouse: '#F97316', day_off: '#9CA3AF', object: '#22C55E',
};
const STATUS_LABELS = {
  planned: '\u0417\u0430\u043F\u043B\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u043D', active: '\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0439',
  completed: '\u0417\u0430\u0432\u0435\u0440\u0448\u0451\u043D', approved: '\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0451\u043D',
  adjusted: '\u0421\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u043D', rejected: '\u041E\u0442\u043A\u043B\u043E\u043D\u0451\u043D',
};
const STAGE_QUOTES = {
  medical_start: ['\uD83C\uDFE5 \u0417\u0434\u043E\u0440\u043E\u0432\u044C\u0435 \u0432\u043E\u0438\u043D\u0430 \u2014 \u043E\u0441\u043D\u043E\u0432\u0430 \u043F\u043E\u0431\u0435\u0434\u044B!', '\uD83C\uDFE5 \u041F\u0443\u0441\u0442\u044C \u043C\u0435\u0434\u0438\u0446\u0438\u043D\u0430 \u0431\u0443\u0434\u0435\u0442 \u043D\u0430 \u0442\u0432\u043E\u0435\u0439 \u0441\u0442\u043E\u0440\u043E\u043D\u0435'],
  medical_end: ['\uD83C\uDFE5 \u041E\u0441\u043C\u043E\u0442\u0440 \u043F\u0440\u043E\u0439\u0434\u0435\u043D! \u0412\u043E\u0438\u043D \u0433\u043E\u0442\u043E\u0432 \u043A \u0431\u043E\u044E', '\uD83C\uDFE5 \u0417\u0434\u043E\u0440\u043E\u0432 \u0438 \u0441\u0438\u043B\u0451\u043D \u2014 \u0432 \u043F\u0443\u0442\u044C!'],
  travel_start: ['\u2708\uFE0F \u0414\u043E\u0440\u043E\u0433\u0430 \u0437\u043E\u0432\u0451\u0442! \u0423\u0434\u0430\u0447\u043D\u043E\u0433\u043E \u043F\u0443\u0442\u0438, \u0432\u043E\u0438\u043D', '\u2708\uFE0F \u0412 \u043F\u0443\u0442\u044C! \u0410\u0441\u0433\u0430\u0440\u0434 \u0436\u0434\u0451\u0442 \u0432\u0435\u0441\u0442\u0435\u0439'],
  travel_end: ['\u2708\uFE0F \u0414\u043E\u0431\u0440\u0430\u043B\u0441\u044F! \u041E\u0442\u0434\u043E\u0445\u043D\u0438 \u0441 \u0434\u043E\u0440\u043E\u0433\u0438', '\u2708\uFE0F \u041F\u0440\u0438\u0431\u044B\u043B! \u0415\u0449\u0451 \u043E\u0434\u0438\u043D \u044D\u0442\u0430\u043F \u043F\u043E\u0437\u0430\u0434\u0438'],
  warehouse_start: ['\uD83D\uDCE6 \u0421\u043A\u043B\u0430\u0434 \u0436\u0434\u0451\u0442 \u043A\u0440\u0435\u043F\u043A\u0438\u0445 \u0440\u0443\u043A!', '\uD83D\uDCE6 \u0412\u0440\u0435\u043C\u044F \u0441\u043E\u0431\u0438\u0440\u0430\u0442\u044C \u0441\u043D\u0430\u0440\u044F\u0436\u0435\u043D\u0438\u0435'],
  warehouse_end: ['\uD83D\uDCE6 \u0421\u043A\u043B\u0430\u0434 \u0437\u0430\u043A\u0440\u044B\u0442. \u041C\u043E\u043B\u043E\u0434\u0435\u0446!', '\uD83D\uDCE6 \u041A\u043E\u043C\u043F\u043B\u0435\u043A\u0442\u0430\u0446\u0438\u044F \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0430'],
  waiting_info: ['\u23F3 \u041E\u0436\u0438\u0434\u0430\u043D\u0438\u0435 \u2014 \u0442\u043E\u0436\u0435 \u0447\u0430\u0441\u0442\u044C \u043F\u043E\u0445\u043E\u0434\u0430', '\u23F3 \u041E\u0442\u0434\u044B\u0445\u0430\u0439, \u0441\u043A\u043E\u0440\u043E \u0432 \u0431\u043E\u0439'],
};

function randomQuote(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function stageDay(dateFrom) {
  const d = new Date(dateFrom);
  const now = new Date();
  return Math.max(1, Math.floor((now - d) / 86400000) + 1);
}

function formatDateShort(d) {
  if (!d) return '';
  const dt = new Date(d);
  const months = ['\u044F\u043D\u0432','\u0444\u0435\u0432','\u043C\u0430\u0440','\u0430\u043F\u0440','\u043C\u0430\u0439','\u0438\u044E\u043D','\u0438\u044E\u043B','\u0430\u0432\u0433','\u0441\u0435\u043D','\u043E\u043A\u0442','\u043D\u043E\u044F','\u0434\u0435\u043A'];
  return dt.getDate() + ' ' + months[dt.getMonth()];
}

// ═══════════════════════════════════════════════════════════════
// WORKER PAGE: /field/stages
// ═══════════════════════════════════════════════════════════════
const StagesPage = {
  render(params) {
    const t = DS.t;
    const page = el('div', { className: 'field-page field-stages' });
    page.appendChild(F.Header({ title: '\u041C\u043E\u0439 \u043C\u0430\u0440\u0448\u0440\u0443\u0442', back: true, backHref: '/field/home' }));

    const content = el('div', { style: { padding: '16px 20px 100px', display: 'flex', flexDirection: 'column', gap: '16px' } });
    content.appendChild(F.Skeleton({ type: 'hero' }));
    content.appendChild(F.Skeleton({ type: 'card', count: 3 }));
    page.appendChild(content);

    const workId = params?.[0] || Store.get('active_work_id');
    setTimeout(() => loadWorkerStages(content, workId), 0);
    return page;
  }
};

async function loadWorkerStages(content, workId) {
  const t = DS.t;
  if (!workId) {
    const proj = await API.fetch('/worker/active-project');
    workId = proj?.project?.work_id || proj?.work_id;
  }
  if (!workId) {
    content.replaceChildren(F.Empty({ text: '\u041D\u0435\u0442 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0433\u043E \u043F\u0440\u043E\u0435\u043A\u0442\u0430', icon: '\uD83D\uDDFA\uFE0F' }));
    return;
  }

  const data = await API.fetch('/stages/my/' + workId);
  content.replaceChildren();

  if (!data || data.error) {
    content.appendChild(F.Empty({ text: data?.error || '\u041E\u0448\u0438\u0431\u043A\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438', icon: '\uD83D\uDDFA\uFE0F' }));
    return;
  }

  const stages = data.stages || [];
  let delay = 0;
  const nd = () => { delay += 0.08; return delay; };

  // Hero — заработано до объекта
  const preObjectStages = stages.filter(s => s.stage_type !== 'object' && s.status !== 'rejected');
  const heroEarned = preObjectStages.reduce((s, st) => s + parseFloat(st.amount_earned || 0), 0);
  const heroDays = preObjectStages.reduce((s, st) => s + (st.days_approved || st.days_count || 0), 0);

  const heroCard = el('div', {
    style: {
      background: t.heroGrad, backgroundSize: '200% 200%', animation: 'fieldGradShift 8s ease infinite',
      borderRadius: '20px', padding: '24px', position: 'relative', overflow: 'hidden',
    },
  });
  const heroContent = el('div', { style: { position: 'relative', zIndex: '1' } });
  heroContent.appendChild(el('div', { style: { color: t.textSec, fontSize: '0.6875rem', fontWeight: '600', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '4px' } },
    '\u0417\u0410\u0420\u0410\u0411\u041E\u0422\u0410\u041D\u041E \u0414\u041E \u041E\u0411\u042A\u0415\u041A\u0422\u0410'));

  const amountEl = el('div', { style: { color: t.gold, fontWeight: '700', fontSize: '2.5rem', lineHeight: '1.1' } });
  heroContent.appendChild(amountEl);
  setTimeout(() => Utils.countUp(amountEl, heroEarned, 1000), 200);
  amountEl.appendChild(el('span', { style: { fontSize: '1.5rem', fontWeight: '600', marginLeft: '4px' } }, ' \u20BD'));

  heroContent.appendChild(el('div', { style: { color: t.textSec, fontSize: '0.8125rem', marginTop: '8px' } },
    heroDays + ' \u0434\u043D\u0435\u0439 \u00B7 ' + preObjectStages.length + ' \u044D\u0442\u0430\u043F\u043E\u0432'));
  heroCard.appendChild(heroContent);
  content.appendChild(heroCard);

  // Текущий этап
  const active = stages.filter(s => s.status === 'active');
  if (active.length > 0) {
    content.appendChild(sectionLabel('\u0422\u0415\u041A\u0423\u0429\u0418\u0419 \u042D\u0422\u0410\u041F', nd()));
    for (const s of active) {
      content.appendChild(stageCard(s, true, nd(), workId, content));
    }
  }

  // Завершённые
  const completed = stages.filter(s => ['completed', 'approved', 'adjusted'].includes(s.status));
  if (completed.length > 0) {
    content.appendChild(sectionLabel('\u0417\u0410\u0412\u0415\u0420\u0428\u0401\u041D\u041D\u042B\u0415 \u042D\u0422\u0410\u041F\u042B', nd()));
    for (const s of completed) {
      content.appendChild(stageCard(s, false, nd()));
    }
  }

  // Запланированные
  const planned = stages.filter(s => s.status === 'planned');
  if (planned.length > 0) {
    content.appendChild(sectionLabel('\u0417\u0410\u041F\u041B\u0410\u041D\u0418\u0420\u041E\u0412\u0410\u041D\u041E', nd()));
    for (const s of planned) {
      content.appendChild(stageCard(s, false, nd()));
    }
  }

  // Кнопка добавить этап
  const addBtn = el('div', {
    style: {
      background: t.surface, borderRadius: '16px', padding: '16px', textAlign: 'center',
      border: '1px dashed ' + t.border, cursor: 'pointer', color: t.gold, fontWeight: '600',
      fontSize: '0.9375rem', animation: 'fieldSlideUp 0.4s ease ' + nd() + 's both',
    },
    onClick: () => showAddStageSheet(workId, content),
  }, '+ \u0414\u041E\u0411\u0410\u0412\u0418\u0422\u042C \u042D\u0422\u0410\u041F');
  content.appendChild(addBtn);
}

function sectionLabel(text, delay) {
  const t = DS.t;
  return el('div', {
    style: {
      color: t.textTer, fontSize: '0.6875rem', fontWeight: '600',
      letterSpacing: '0.08em', textTransform: 'uppercase',
      animation: 'fieldSlideUp 0.4s ease ' + delay + 's both',
    },
  }, text);
}

function stageCard(stage, isActive, delay, workId, content) {
  const t = DS.t;
  const color = STAGE_COLORS[stage.stage_type] || t.textSec;
  const icon = isActive ? STAGE_ICONS[stage.stage_type] : '\u2705';
  const label = STAGE_LABELS[stage.stage_type] || stage.stage_type;

  const card = el('div', {
    style: {
      background: t.surface, borderRadius: '16px', padding: '16px',
      border: isActive ? '2px solid ' + color : '1px solid ' + t.border,
      animation: 'fieldSlideUp 0.4s ease ' + delay + 's both',
      cursor: isActive ? 'pointer' : 'default',
    },
  });

  if (isActive) {
    card.addEventListener('click', () => showEndStageSheet(stage, workId, content));
  }

  // Header
  const hdr = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' } });
  hdr.appendChild(el('span', { style: { fontSize: '1.2rem' } }, icon));
  hdr.appendChild(el('span', { style: { color: isActive ? color : t.text, fontWeight: '600', fontSize: '1rem', flex: '1' } }, label));
  if (stage.status === 'rejected') {
    hdr.appendChild(el('span', { style: { fontSize: '0.6875rem', color: t.red, fontWeight: '600' } }, '\u041E\u0442\u043A\u043B\u043E\u043D\u0451\u043D'));
  } else if (stage.status === 'planned') {
    hdr.appendChild(el('span', { style: { fontSize: '0.6875rem', color: t.textTer, fontWeight: '600' } }, '\u26AC \u0417\u0430\u043F\u043B\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u043D'));
  }
  card.appendChild(hdr);

  // Info
  const dateStr = stage.date_to
    ? formatDateShort(stage.date_from) + ' \u2013 ' + formatDateShort(stage.date_to)
    : formatDateShort(stage.date_from);
  const daysStr = isActive
    ? stageDay(stage.date_from) + '-\u0439 \u0434\u0435\u043D\u044C'
    : (stage.days_count || 1) + ' \u0434\u043D.';
  const earned = parseFloat(stage.amount_earned || 0);
  const earnStr = isActive
    ? '~' + Utils.formatMoney(stageDay(stage.date_from) * parseFloat(stage.rate_per_day || 0)) + '\u20BD'
    : Utils.formatMoney(earned) + '\u20BD';

  card.appendChild(el('div', { style: { color: t.textSec, fontSize: '0.8125rem' } },
    dateStr + ' \u00B7 ' + daysStr + ' \u00B7 ' + earnStr));

  // Travel details
  const details = typeof stage.details === 'string' ? JSON.parse(stage.details || '{}') : (stage.details || {});
  if (stage.stage_type === 'travel' && details.route) {
    card.appendChild(el('div', { style: { color: t.textTer, fontSize: '0.75rem', marginTop: '4px' } },
      (details.flight ? details.flight + ' ' : '') + details.route));
  }
  if (stage.stage_type === 'waiting' && details.location) {
    card.appendChild(el('div', { style: { color: t.textTer, fontSize: '0.75rem', marginTop: '4px' } }, details.location));
  }

  // Photo attachment
  if (stage.photo_filename) {
    card.appendChild(el('div', { style: { color: t.gold, fontSize: '0.75rem', marginTop: '4px' } }, '\uD83D\uDCCE \u0417\u0430\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435'));
  }

  return card;
}

function showAddStageSheet(workId, content) {
  const t = DS.t;
  const types = [
    { type: 'medical', icon: '\uD83D\uDFE3', label: '\u041C\u0435\u0434\u043E\u0441\u043C\u043E\u0442\u0440' },
    { type: 'travel', icon: '\uD83D\uDD35', label: '\u0414\u043E\u0440\u043E\u0433\u0430' },
    { type: 'warehouse', icon: '\uD83D\uDFE0', label: '\u0421\u043A\u043B\u0430\u0434' },
  ];

  const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });

  for (const tp of types) {
    const btn = el('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: '12px', padding: '16px',
        background: t.bg2, borderRadius: '14px', cursor: 'pointer',
        border: '1px solid ' + t.border,
      },
      onClick: () => { sheet.remove(); showStartStageForm(tp.type, workId, content); },
    });
    btn.appendChild(el('span', { style: { fontSize: '1.5rem' } }, tp.icon));
    btn.appendChild(el('span', { style: { color: t.text, fontWeight: '600', fontSize: '1rem' } }, tp.label));
    wrap.appendChild(btn);
  }

  const sheet = F.BottomSheet({ title: '\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u044D\u0442\u0430\u043F', content: wrap });
}

function showStartStageForm(stageType, workId, content) {
  const t = DS.t;
  const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
  let detailsObj = {};

  if (stageType === 'medical') {
    const input = el('input', {
      type: 'text', placeholder: '\u041A\u043B\u0438\u043D\u0438\u043A\u0430',
      style: { width: '100%', height: '44px', borderRadius: '12px', border: '1px solid ' + t.border, background: t.bg2, color: t.text, padding: '0 14px', fontSize: '0.9375rem' },
      onInput: (e) => { detailsObj.clinic = e.target.value; },
    });
    wrap.appendChild(input);
  } else if (stageType === 'travel') {
    // Transport pills
    const pillsRow = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } });
    const transports = [
      { val: 'plane', label: '\u2708\uFE0F \u0421\u0430\u043C\u043E\u043B\u0451\u0442' },
      { val: 'train', label: '\uD83D\uDE82 \u041F\u043E\u0435\u0437\u0434' },
      { val: 'bus', label: '\uD83D\uDE8C \u0410\u0432\u0442\u043E\u0431\u0443\u0441' },
      { val: 'car', label: '\uD83D\uDE97 \u041C\u0430\u0448\u0438\u043D\u0430' },
    ];
    let selected = null;
    for (const tr of transports) {
      const pill = el('div', {
        style: {
          padding: '8px 14px', borderRadius: '20px', border: '1px solid ' + t.border,
          background: t.bg2, color: t.textSec, fontSize: '0.8125rem', cursor: 'pointer',
        },
        onClick: () => {
          pillsRow.querySelectorAll('div').forEach(p => { p.style.background = t.bg2; p.style.color = t.textSec; p.style.borderColor = t.border; });
          pill.style.background = STAGE_COLORS.travel; pill.style.color = '#FFF'; pill.style.borderColor = STAGE_COLORS.travel;
          detailsObj.transport = tr.val;
          selected = tr.val;
        },
      }, tr.label);
      pillsRow.appendChild(pill);
    }
    wrap.appendChild(pillsRow);

    const routeInput = el('input', {
      type: 'text', placeholder: '\u041C\u0430\u0440\u0448\u0440\u0443\u0442 (\u041C\u043E\u0441\u043A\u0432\u0430 \u2192 \u041A\u0435\u043C\u0435\u0440\u043E\u0432\u043E)',
      style: { width: '100%', height: '44px', borderRadius: '12px', border: '1px solid ' + t.border, background: t.bg2, color: t.text, padding: '0 14px', fontSize: '0.9375rem' },
      onInput: (e) => { detailsObj.route = e.target.value; },
    });
    wrap.appendChild(routeInput);
  }

  const submitBtn = el('button', {
    style: {
      width: '100%', height: '52px', borderRadius: '14px', border: 'none',
      background: DS.t.goldGrad, color: '#FFF', fontSize: '1rem', fontWeight: '700',
      cursor: 'pointer',
    },
    onClick: async () => {
      submitBtn.textContent = '\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430...';
      submitBtn.disabled = true;
      const resp = await API.post('/stages/my/start', { work_id: parseInt(workId), stage_type: stageType, details: detailsObj });
      sheet.remove();
      if (resp && !resp.error) {
        const qKey = stageType + '_start';
        const quotes = STAGE_QUOTES[qKey];
        F.Toast({ message: quotes ? randomQuote(quotes) : '\u042D\u0442\u0430\u043F \u043D\u0430\u0447\u0430\u0442!', type: 'success', duration: 3000 });
        Router.navigate('/field/stages/' + workId);
      } else {
        F.Toast({ message: resp?.error || '\u041E\u0448\u0438\u0431\u043A\u0430', type: 'error' });
      }
    },
  }, stageType === 'travel' ? '\u0412\u044B\u0435\u0445\u0430\u043B' : '\u041D\u0430\u0447\u0430\u0442\u044C');
  wrap.appendChild(submitBtn);

  const sheet = F.BottomSheet({
    title: STAGE_EMOJI[stageType] + ' ' + STAGE_LABELS[stageType],
    content: wrap,
  });
}

function showEndStageSheet(stage, workId, content) {
  const t = DS.t;
  const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });

  wrap.appendChild(el('div', { style: { color: t.textSec, fontSize: '0.9375rem', textAlign: 'center' } },
    STAGE_LABELS[stage.stage_type] + ' \u00B7 ' + stageDay(stage.date_from) + '-\u0439 \u0434\u0435\u043D\u044C'));

  if (stage.stage_type === 'medical') {
    wrap.appendChild(el('div', { style: { color: t.textTer, fontSize: '0.8125rem', textAlign: 'center' } },
      '\u0424\u043E\u0442\u043E \u0437\u0430\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E'));
  }

  const submitBtn = el('button', {
    style: {
      width: '100%', height: '52px', borderRadius: '14px', border: 'none',
      background: DS.t.goldGrad, color: '#FFF', fontSize: '1rem', fontWeight: '700', cursor: 'pointer',
    },
    onClick: async () => {
      submitBtn.textContent = '\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430...';
      submitBtn.disabled = true;
      const resp = await API.post('/stages/my/end', { stage_id: stage.id });
      sheet.remove();
      if (resp && !resp.error) {
        const qKey = stage.stage_type + '_end';
        const quotes = STAGE_QUOTES[qKey];
        F.Toast({ message: quotes ? randomQuote(quotes) : '\u042D\u0442\u0430\u043F \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D!', type: 'success', duration: 3000 });
        Router.navigate('/field/stages/' + workId);
      } else {
        F.Toast({ message: resp?.error || '\u041E\u0448\u0438\u0431\u043A\u0430', type: 'error' });
      }
    },
  }, stage.stage_type === 'travel' ? '\u041F\u0440\u0438\u0431\u044B\u043B' : '\u0417\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u044C');
  wrap.appendChild(submitBtn);

  const cancelBtn = el('button', {
    style: {
      width: '100%', height: '44px', borderRadius: '14px', border: '1px solid ' + t.border,
      background: 'transparent', color: t.textSec, fontSize: '0.9375rem', cursor: 'pointer',
    },
    onClick: () => sheet.remove(),
  }, '\u041E\u0442\u043C\u0435\u043D\u0430');
  wrap.appendChild(cancelBtn);

  const sheet = F.BottomSheet({ title: '\u0417\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u044C \u044D\u0442\u0430\u043F', content: wrap });
}

// ═══════════════════════════════════════════════════════════════
// MASTER PAGE: /field/crew-stages
// ═══════════════════════════════════════════════════════════════
const CrewStagesPage = {
  render() {
    const t = DS.t;
    const page = el('div', { className: 'field-page field-crew-stages' });
    page.appendChild(F.Header({ title: '\u041C\u0430\u0440\u0448\u0440\u0443\u0442\u044B \u0431\u0440\u0438\u0433\u0430\u0434\u044B', back: true, backHref: '/field/home' }));

    const content = el('div', { style: { padding: '16px 20px 100px', display: 'flex', flexDirection: 'column', gap: '14px' } });
    content.appendChild(F.Skeleton({ type: 'card', count: 4 }));
    page.appendChild(content);

    setTimeout(() => loadCrewStages(content), 0);
    return page;
  }
};

async function loadCrewStages(content) {
  const t = DS.t;
  const project = await API.fetch('/worker/active-project');
  const workId = project?.project?.work_id || project?.work_id;
  if (!workId) {
    content.replaceChildren(F.Empty({ text: '\u041D\u0435\u0442 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0433\u043E \u043F\u0440\u043E\u0435\u043A\u0442\u0430', icon: '\uD83D\uDCCB' }));
    return;
  }

  const data = await API.fetch('/stages/my-crew/' + workId);
  content.replaceChildren();

  if (!data || data.error) {
    content.appendChild(F.Empty({ text: data?.error || '\u041E\u0448\u0438\u0431\u043A\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438', icon: '\uD83D\uDCCB' }));
    return;
  }

  const employees = data.employees || [];
  if (employees.length === 0) {
    content.appendChild(F.Empty({ text: '\u041D\u0435\u0442 \u044D\u0442\u0430\u043F\u043E\u0432 \u0431\u0440\u0438\u0433\u0430\u0434\u044B', icon: '\uD83D\uDCCB' }));
    return;
  }

  // Search
  const searchInput = el('input', {
    type: 'text', placeholder: '\uD83D\uDD0D \u041F\u043E\u0438\u0441\u043A \u043F\u043E \u0424\u0418\u041E...',
    style: {
      width: '100%', height: '44px', borderRadius: '12px', border: '1px solid ' + t.border,
      background: t.bg2, color: t.text, padding: '0 14px', fontSize: '0.9375rem',
    },
  });
  content.appendChild(searchInput);

  // Filters
  const filterRow = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } });
  const filters = ['\u0412\u0441\u0435', '\u041D\u0430 \u044D\u0442\u0430\u043F\u0430\u0445', '\u041D\u0430 \u043E\u0431\u044A\u0435\u043A\u0442\u0435'];
  let currentFilter = '\u0412\u0441\u0435';
  for (const f of filters) {
    const pill = el('div', {
      style: {
        padding: '6px 14px', borderRadius: '20px', fontSize: '0.8125rem', cursor: 'pointer',
        background: f === '\u0412\u0441\u0435' ? t.gold : t.bg2, color: f === '\u0412\u0441\u0435' ? '#000' : t.textSec,
        border: '1px solid ' + t.border,
      },
      onClick: () => {
        currentFilter = f;
        filterRow.querySelectorAll('div').forEach(p => { p.style.background = t.bg2; p.style.color = t.textSec; });
        pill.style.background = t.gold; pill.style.color = '#000';
        renderCrewList();
      },
    }, f);
    filterRow.appendChild(pill);
  }
  content.appendChild(filterRow);

  const listContainer = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
  content.appendChild(listContainer);

  function renderCrewList() {
    listContainer.replaceChildren();
    const q = (searchInput.value || '').toLowerCase();

    for (const emp of employees) {
      if (q && !emp.fio.toLowerCase().includes(q)) continue;

      const activeStage = emp.stages.find(s => s.status === 'active');
      if (currentFilter === '\u041D\u0430 \u044D\u0442\u0430\u043F\u0430\u0445' && (!activeStage || activeStage.stage_type === 'object')) continue;
      if (currentFilter === '\u041D\u0430 \u043E\u0431\u044A\u0435\u043A\u0442\u0435' && (!activeStage || activeStage.stage_type !== 'object')) continue;

      const card = el('div', {
        style: {
          background: t.surface, borderRadius: '16px', padding: '14px 16px',
          border: '1px solid ' + t.border,
        },
      });

      card.appendChild(el('div', { style: { color: t.text, fontWeight: '600', fontSize: '0.9375rem', marginBottom: '4px' } }, emp.fio));

      if (activeStage) {
        const color = STAGE_COLORS[activeStage.stage_type] || t.textSec;
        const day = stageDay(activeStage.date_from);
        const earned = day * parseFloat(activeStage.rate_per_day || 0);
        card.appendChild(el('div', { style: { color: color, fontSize: '0.8125rem' } },
          STAGE_ICONS[activeStage.stage_type] + ' ' + STAGE_LABELS[activeStage.stage_type] +
          ' \u00B7 ' + day + '-\u0439 \u0434\u0435\u043D\u044C \u00B7 ~' + Utils.formatMoney(earned) + '\u20BD'));
      } else {
        card.appendChild(el('div', { style: { color: t.textTer, fontSize: '0.8125rem' } }, '\u041D\u0435\u0442 \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u044D\u0442\u0430\u043F\u043E\u0432'));
      }

      // Action buttons
      const btns = el('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } });
      btns.appendChild(el('button', {
        style: {
          padding: '6px 12px', borderRadius: '10px', border: '1px solid ' + t.border,
          background: t.bg2, color: t.gold, fontSize: '0.75rem', cursor: 'pointer',
        },
        onClick: (e) => { e.stopPropagation(); showOnBehalfSheet(emp, workId, content); },
      }, '\u270F\uFE0F \u041E\u0442\u043C\u0435\u0442\u0438\u0442\u044C \u0437\u0430 \u043D\u0435\u0433\u043E'));
      card.appendChild(btns);

      listContainer.appendChild(card);
    }
  }

  searchInput.addEventListener('input', renderCrewList);
  renderCrewList();

  // Correction request button
  content.appendChild(el('div', {
    style: {
      background: t.surface, borderRadius: '14px', padding: '14px', textAlign: 'center',
      border: '1px solid ' + t.border, cursor: 'pointer', color: t.gold, fontWeight: '600', fontSize: '0.875rem',
    },
    onClick: () => showCorrectionSheet(employees, workId),
  }, '\uD83D\uDCCB \u0417\u0410\u041F\u0420\u041E\u0421\u0418\u0422\u042C \u041A\u041E\u0420\u0420\u0415\u041A\u0422\u0418\u0420\u041E\u0412\u041A\u0423'));
}

function showOnBehalfSheet(emp, workId, content) {
  const t = DS.t;
  const allTypes = [
    { type: 'medical', label: '\uD83D\uDFE3 \u041C\u0435\u0434\u043E\u0441\u043C\u043E\u0442\u0440' },
    { type: 'travel', label: '\uD83D\uDD35 \u0414\u043E\u0440\u043E\u0433\u0430' },
    { type: 'warehouse', label: '\uD83D\uDFE0 \u0421\u043A\u043B\u0430\u0434' },
    { type: 'waiting', label: '\uD83D\uDFE1 \u041E\u0436\u0438\u0434\u0430\u043D\u0438\u0435' },
    { type: 'day_off', label: '\u26AA \u0412\u044B\u0445\u043E\u0434\u043D\u043E\u0439' },
  ];

  const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });
  wrap.appendChild(el('div', { style: { color: t.textSec, fontSize: '0.875rem', textAlign: 'center', marginBottom: '4px' } },
    '\u041E\u0442\u043C\u0435\u0442\u0438\u0442\u044C \u0437\u0430 ' + emp.fio));

  for (const tp of allTypes) {
    wrap.appendChild(el('div', {
      style: {
        padding: '14px', borderRadius: '12px', background: t.bg2, border: '1px solid ' + t.border,
        cursor: 'pointer', color: t.text, fontSize: '0.9375rem',
      },
      onClick: async () => {
        const today = new Date().toISOString().slice(0, 10);
        const resp = await API.post('/stages/on-behalf', {
          employee_id: emp.employee_id, work_id: parseInt(workId),
          stage_type: tp.type, date_from: today,
        });
        sheet.remove();
        if (resp && !resp.error) {
          F.Toast({ message: '\u042D\u0442\u0430\u043F \u0441\u043E\u0437\u0434\u0430\u043D', type: 'success' });
          Router.navigate('/field/crew-stages');
        } else {
          F.Toast({ message: resp?.error || '\u041E\u0448\u0438\u0431\u043A\u0430', type: 'error' });
        }
      },
    }, tp.label));
  }

  const sheet = F.BottomSheet({ title: '\u041D\u0430\u0447\u0430\u0442\u044C \u044D\u0442\u0430\u043F', content: wrap });
}

function showCorrectionSheet(employees, workId) {
  const t = DS.t;
  const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });

  const empSelectWrap = el('div', {});
  const empSelectEl = CRSelect.create({
    id: 'field-corr-emp',
    options: employees.map(function(emp) { return { value: String(emp.stages[0]?.id || ''), label: emp.fio }; }),
    placeholder: '\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0440\u0430\u0431\u043E\u0447\u0435\u0433\u043E',
    clearable: false,
  });
  empSelectWrap.appendChild(empSelectEl);
  wrap.appendChild(empSelectWrap);

  const noteInput = el('textarea', {
    placeholder: '\u0427\u0442\u043E \u043D\u0443\u0436\u043D\u043E \u0438\u0441\u043F\u0440\u0430\u0432\u0438\u0442\u044C...',
    style: { width: '100%', height: '80px', borderRadius: '12px', border: '1px solid ' + t.border, background: t.bg2, color: t.text, padding: '12px', fontSize: '0.9375rem', resize: 'none' },
  });
  wrap.appendChild(noteInput);

  wrap.appendChild(el('button', {
    style: {
      width: '100%', height: '48px', borderRadius: '14px', border: 'none',
      background: DS.t.goldGrad, color: '#FFF', fontSize: '1rem', fontWeight: '700', cursor: 'pointer',
    },
    onClick: async () => {
      const stageId = parseInt(CRSelect.getValue('field-corr-emp') || '0');
      if (!stageId || !noteInput.value.trim()) { F.Toast({ message: '\u0417\u0430\u043F\u043E\u043B\u043D\u0438\u0442\u0435 \u0432\u0441\u0435 \u043F\u043E\u043B\u044F', type: 'error' }); return; }
      const resp = await API.post('/stages/request-correction', { stage_id: stageId, note: noteInput.value.trim() });
      sheet.remove();
      F.Toast({ message: resp?.ok ? '\u0417\u0430\u043F\u0440\u043E\u0441 \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D' : (resp?.error || '\u041E\u0448\u0438\u0431\u043A\u0430'), type: resp?.ok ? 'success' : 'error' });
    },
  }, '\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C'));

  const sheet = F.BottomSheet({ title: '\u0417\u0430\u043F\u0440\u043E\u0441 \u043A\u043E\u0440\u0440\u0435\u043A\u0442\u0438\u0440\u043E\u0432\u043A\u0438', content: wrap });
}

Router.register('/field/stages', StagesPage);
Router.register('/field/stages/:work_id', StagesPage);
Router.register('/field/crew-stages', CrewStagesPage);
})();
