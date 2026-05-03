/**
 * ASGARD Field — Crew Page
 * Brigade list: on_site / not_checked_in / left_site
 * Available to all workers (not only masters)
 */
(() => {
'use strict';
const el = Utils.el;

const CrewPage = {
  render() {
    const t = DS.t;
    const page = el('div', { className: 'field-page field-crew' });

    page.appendChild(F.Header({ title: '\u0411\u0440\u0438\u0433\u0430\u0434\u0430', logo: true, back: true }));

    const content = el('div', { style: { padding: '16px 20px 100px', display: 'flex', flexDirection: 'column', gap: '12px' } });
    content.appendChild(F.Skeleton({ type: 'card', count: 5 }));
    page.appendChild(content);

    setTimeout(() => loadCrew(content), 0);
    return page;
  }
};

async function loadCrew(content) {
  const t = DS.t;

  // 1. Get work_id: active project first, fallback to last project
  let workId = null;
  let workTitle = null;

  const active = await API.fetch('/worker/active-project').catch(() => null);
  if (active && active.project) {
    workId = active.project.work_id || active.project.id;
    workTitle = active.project.work_title;
  }

  if (!workId) {
    const all = await API.fetch('/worker/projects').catch(() => null);
    const list = all?.projects || (Array.isArray(all) ? all : []);
    if (list.length > 0) {
      workId = list[0].work_id;
      workTitle = list[0].work_title;
    }
  }

  if (!workId) {
    content.replaceChildren(F.Empty({ text: '\u041D\u0435\u0442 \u043F\u0440\u043E\u0435\u043A\u0442\u043E\u0432', icon: '\uD83D\uDC65' }));
    return;
  }

  // 2. Load crew
  let data;
  try {
    data = await API.fetch('/worker/crew?work_id=' + workId);
  } catch (err) {
    content.replaceChildren(F.Empty({ text: err.message || '\u041E\u0448\u0438\u0431\u043A\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438', icon: '\u26A0\uFE0F' }));
    return;
  }

  content.replaceChildren();

  const onSite = data.on_site || [];
  const notChecked = data.not_checked_in || [];
  const leftSite = data.left_site || [];

  // Project title
  if (workTitle) {
    content.appendChild(el('div', {
      style: { color: t.textTer, fontSize: '0.75rem', fontWeight: '600', letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'center' },
    }, workTitle));
  }

  // Stats
  const statsRow = el('div', {
    style: { display: 'flex', gap: '8px', animation: 'fieldSlideUp 0.4s ease both' },
  });
  statsRow.appendChild(crewStat('\u0412\u0441\u0435\u0433\u043E', String(data.total || 0), t.textSec, t));
  statsRow.appendChild(crewStat('\u041D\u0430 \u043E\u0431\u044A\u0435\u043A\u0442\u0435', String(onSite.length), t.green, t));
  statsRow.appendChild(crewStat('\u041D\u0435\u0442 \u0447\u0435\u043A\u0438\u043D\u0430', String(notChecked.length), t.orange, t));
  statsRow.appendChild(crewStat('\u0423\u0435\u0445\u0430\u043B\u0438', String(leftSite.length), t.textTer, t));
  content.appendChild(statsRow);

  let delay = 0.1;

  // On site
  if (onSite.length > 0) {
    delay += 0.06;
    content.appendChild(sectionLabel('\uD83D\uDFE2 \u041D\u0430 \u043E\u0431\u044A\u0435\u043A\u0442\u0435 \u0441\u0435\u0433\u043E\u0434\u043D\u044F', t, delay));
    for (const m of onSite) {
      delay += 0.04;
      content.appendChild(crewCard(m, t, delay));
    }
  }

  // Not checked in
  if (notChecked.length > 0) {
    delay += 0.06;
    content.appendChild(sectionLabel('\uD83D\uDFE1 \u041D\u0435 \u043E\u0442\u043C\u0435\u0442\u0438\u043B\u0438\u0441\u044C', t, delay));
    for (const m of notChecked) {
      delay += 0.04;
      content.appendChild(crewCard(m, t, delay));
    }
  }

  // Left site
  if (leftSite.length > 0) {
    delay += 0.06;
    content.appendChild(sectionLabel('\u26AB \u0423\u0435\u0445\u0430\u043B\u0438 \u0441 \u043E\u0431\u044A\u0435\u043A\u0442\u0430', t, delay));
    for (const m of leftSite) {
      delay += 0.04;
      content.appendChild(crewCard(m, t, delay));
    }
  }

  if (onSite.length === 0 && notChecked.length === 0 && leftSite.length === 0) {
    content.appendChild(F.Empty({ text: '\u0411\u0440\u0438\u0433\u0430\u0434\u0430 \u043F\u0443\u0441\u0442\u0430', icon: '\uD83D\uDC65' }));
  }
}

function crewCard(m, t, animDelay) {
  const ROLE_LABELS = {
    senior_master: '\u0421\u0442. \u043C\u0430\u0441\u0442\u0435\u0440',
    shift_master: '\u041C\u0430\u0441\u0442\u0435\u0440',
    worker: '\u0420\u0430\u0431\u043E\u0447\u0438\u0439',
  };

  const hasCheckin = !!m.checkin_status;
  const isCompleted = m.checkin_status === 'completed';
  const isActive = m.checkin_status === 'active';
  const borderColor = isActive ? 'rgba(52,199,89,0.2)' : !m.is_active ? 'rgba(255,255,255,0.04)' : t.border;

  const card = el('div', {
    style: {
      background: t.surface, borderRadius: '14px', padding: '12px 14px',
      border: '1px solid ' + borderColor,
      animation: 'fieldSlideUp 0.4s ease ' + animDelay + 's both',
    },
  });

  const top = el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } });

  // Role badge
  const roleText = ROLE_LABELS[m.field_role] || '\u0420\u0430\u0431\u043E\u0447\u0438\u0439';
  const isMaster = m.field_role === 'shift_master' || m.field_role === 'senior_master';

  const info = el('div', { style: { flex: '1', minWidth: '0' } });
  const nameRow = el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } });
  nameRow.appendChild(el('span', {
    style: { color: t.text, fontWeight: '600', fontSize: '0.9375rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  }, m.fio || '\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A'));
  if (isMaster) {
    nameRow.appendChild(el('span', {
      style: { fontSize: '0.625rem', fontWeight: '600', color: t.gold, background: 'rgba(212,168,67,0.12)', padding: '1px 6px', borderRadius: '4px', whiteSpace: 'nowrap' },
    }, roleText));
  }
  info.appendChild(nameRow);

  // Meta line
  const meta = [];
  if (hasCheckin && m.checkin_at) {
    const time = new Date(m.checkin_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    meta.push(time);
  }
  if (m.checkin_shift) {
    const SHIFT_LABELS = { day: '\u0434\u043D\u0435\u0432\u043D\u0430\u044F', night: '\u043D\u043E\u0447\u043D\u0430\u044F', road: '\u0434\u043E\u0440\u043E\u0433\u0430', standby: '\u043E\u0436\u0438\u0434\u0430\u043D\u0438\u0435' };
    meta.push(SHIFT_LABELS[m.checkin_shift] || m.checkin_shift);
  }
  if (isCompleted && m.amount_earned) {
    meta.push(Utils.formatMoney(parseFloat(m.amount_earned)) + '\u20BD');
  }
  if (!m.is_active && m.date_to) {
    meta.push('\u0434\u043E ' + Utils.formatDate(m.date_to));
  }
  if (meta.length) {
    info.appendChild(el('div', {
      style: { color: t.textSec, fontSize: '0.75rem', marginTop: '2px' },
    }, meta.join(' \u00B7 ')));
  }

  top.appendChild(info);

  // Call button
  if (m.phone) {
    top.appendChild(el('a', {
      href: 'tel:' + m.phone.replace(/[^\d+]/g, ''),
      style: {
        width: '36px', height: '36px', borderRadius: '10px', display: 'flex',
        alignItems: 'center', justifyContent: 'center', background: t.bg2,
        border: '1px solid ' + t.border, fontSize: '1rem', textDecoration: 'none',
        flexShrink: '0',
      },
    }, '\uD83D\uDCDE'));
  }

  card.appendChild(top);
  return card;
}

function crewStat(label, value, color, t) {
  const wrap = el('div', {
    style: {
      flex: '1', textAlign: 'center', padding: '10px 4px', borderRadius: '12px',
      background: t.surface, border: '1px solid ' + t.border,
    },
  });
  wrap.appendChild(el('div', { style: { color, fontSize: '1.25rem', fontWeight: '700' } }, value));
  wrap.appendChild(el('div', { style: { color: t.textTer, fontSize: '0.5625rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: '2px' } }, label));
  return wrap;
}

function sectionLabel(text, t, animDelay) {
  return el('div', {
    style: {
      color: t.textTer, fontSize: '0.75rem', fontWeight: '700', letterSpacing: '0.08em',
      marginTop: '6px', padding: '4px 0',
      borderBottom: '1px solid ' + t.border,
      animation: 'fieldSlideUp 0.4s ease ' + animDelay + 's both',
    },
  }, text);
}

Router.register('/field/crew', CrewPage);
})();
