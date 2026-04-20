/**
 * ASGARD Field — My Works Page
 * Full list of worker's projects with PM/masters contacts
 */
(() => {
'use strict';
const el = Utils.el;

const MyWorksPage = {
  render() {
    const t = DS.t;
    const page = el('div', { className: 'field-page field-my-works' });

    page.appendChild(F.Header({ title: 'Мои работы', logo: true, back: true }));

    const content = el('div', { style: { padding: '16px 20px 100px', display: 'flex', flexDirection: 'column', gap: '12px' } });
    content.appendChild(F.Skeleton({ type: 'card', count: 3 }));
    page.appendChild(content);

    setTimeout(() => loadMyWorks(content), 0);
    return page;
  }
};

async function loadMyWorks(content) {
  const t = DS.t;
  let data;
  try {
    data = await API.fetch('/worker/projects');
  } catch (err) {
    content.replaceChildren();
    content.appendChild(F.Empty({ text: 'Ошибка загрузки: ' + (err.message || 'нет сети'), icon: '⚠️' }));
    return;
  }

  content.replaceChildren();

  const projects = data?.projects || (Array.isArray(data) ? data : []);

  if (!projects.length) {
    content.appendChild(F.Empty({
      text: 'Ты ещё не назначен ни на один объект.\nЖди назначения от РП!',
      icon: '💼',
    }));
    return;
  }

  const active = projects.filter(p => p.is_active);
  const inactive = projects.filter(p => !p.is_active);

  let delay = 0;
  const nextDelay = () => { delay += 0.07; return delay; };

  // Stats row
  const totalShifts = projects.reduce((s, p) => s + (parseInt(p.shifts_count, 10) || 0), 0);
  const totalEarned = projects.reduce((s, p) => s + (parseFloat(p.total_earned) || 0), 0);

  const statsRow = el('div', {
    style: { display: 'flex', gap: '10px', animation: 'fieldSlideUp 0.4s ease both' },
  });
  statsRow.appendChild(statPill('📋 ' + projects.length + ' объект' + pluralRu(projects.length, '', 'а', 'ов'), t));
  statsRow.appendChild(statPill('⚔️ ' + totalShifts + ' смен', t));
  statsRow.appendChild(statPill('💰 ' + Utils.formatMoney(totalEarned) + '₽', t));
  content.appendChild(statsRow);

  // Active projects
  if (active.length > 0) {
    content.appendChild(sectionHeader('🟢 Активные', t, nextDelay()));
    for (const p of active) {
      content.appendChild(buildWorkCard(p, true, t, nextDelay()));
    }
  }

  // Inactive / completed
  if (inactive.length > 0) {
    content.appendChild(sectionHeader(active.length ? '⚫ Завершённые' : '📋 Все работы', t, nextDelay()));
    for (const p of inactive) {
      content.appendChild(buildWorkCard(p, false, t, nextDelay()));
    }
  }
}

function buildWorkCard(p, isActive, t, animDelay) {
  const card = el('div', {
    style: {
      background: t.surface, borderRadius: '16px', padding: '16px',
      border: '1px solid ' + (isActive ? t.green : t.border),
      animation: 'fieldSlideUp 0.4s ease ' + animDelay + 's both',
    },
  });

  // Title row: object_name + city
  const titleText = [p.object_name || p.work_title, p.city].filter(Boolean).join(', ');
  card.appendChild(el('div', {
    style: { color: t.text, fontSize: '1rem', fontWeight: '600', lineHeight: '1.3' },
  }, titleText));

  // Customer
  if (p.customer_name) {
    card.appendChild(el('div', {
      style: { color: t.textSec, fontSize: '0.8125rem', marginTop: '4px' },
    }, p.customer_name));
  }

  // Dates
  const dateStr = formatWorkDates(p);
  if (dateStr) {
    card.appendChild(el('div', {
      style: { color: t.textTer, fontSize: '0.75rem', marginTop: '4px' },
    }, dateStr));
  }

  // Stats: shifts + earned
  const shifts = parseInt(p.shifts_count, 10) || 0;
  const earned = parseFloat(p.total_earned) || 0;
  card.appendChild(el('div', {
    style: { color: t.gold, fontSize: '0.875rem', fontWeight: '600', marginTop: '8px' },
  }, shifts + ' смен · ' + Utils.formatMoney(earned) + '₽'));

  // Contacts row
  const contacts = el('div', { style: { display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' } });
  let hasContacts = false;

  if (p.pm && p.pm.fio) {
    contacts.appendChild(F.CallButton({
      name: 'РП: ' + shortFio(p.pm.fio),
      phone: cleanPhone(p.pm.phone),
      icon: '📞',
    }));
    hasContacts = true;
  }

  if (p.masters && p.masters.length > 0) {
    for (const m of p.masters) {
      const roleLabel = m.role === 'senior_master' ? 'Ст.мастер' : 'Мастер';
      contacts.appendChild(F.CallButton({
        name: roleLabel + ': ' + shortFio(m.fio),
        phone: cleanPhone(m.phone),
        icon: '📞',
      }));
      hasContacts = true;
    }
  }

  if (hasContacts) card.appendChild(contacts);

  // Actions
  const actions = el('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } });

  actions.appendChild(actionBtn('📋 Табель', t.bg3, t.text, () => {
    Router.navigate('/field/history/' + p.work_id);
  }));

  if (isActive) {
    actions.appendChild(actionBtn('⚔️ На смену', t.gold, t.textInv, () => {
      Router.navigate('/field/home');
    }));
  }

  card.appendChild(actions);

  return card;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function actionBtn(text, bg, color, onClick) {
  const btn = el('div', {
    style: {
      flex: '1', textAlign: 'center', padding: '10px', borderRadius: '10px',
      background: bg, color: color, fontSize: '0.8125rem', fontWeight: '600',
      cursor: 'pointer', transition: 'opacity 0.15s',
    },
    onClick,
  });
  btn.textContent = text;
  btn.addEventListener('touchstart', () => { btn.style.opacity = '0.7'; }, { passive: true });
  btn.addEventListener('touchend', () => { btn.style.opacity = '1'; }, { passive: true });
  return btn;
}

function statPill(text, t) {
  return el('div', {
    style: {
      flex: '1', textAlign: 'center', padding: '10px 6px', borderRadius: '12px',
      background: t.surface, border: '1px solid ' + t.border,
      color: t.textSec, fontSize: '0.6875rem', fontWeight: '600',
    },
  }, text);
}

function sectionHeader(text, t, animDelay) {
  return el('div', {
    style: {
      color: t.textTer, fontSize: '0.75rem', fontWeight: '700', letterSpacing: '0.1em',
      marginTop: '8px', padding: '4px 0',
      borderBottom: '1px solid ' + t.border,
      animation: 'fieldSlideUp 0.4s ease ' + animDelay + 's both',
    },
  }, text);
}

function cleanPhone(p) {
  return (p || '').replace(/_.*$/, '').replace(/[^\d+]/g, '');
}

function shortFio(fio) {
  if (!fio) return '';
  const parts = fio.split(' ');
  if (parts.length >= 3) return parts[0] + ' ' + parts[1][0] + '.' + parts[2][0] + '.';
  if (parts.length === 2) return parts[0] + ' ' + parts[1][0] + '.';
  return fio;
}

function formatWorkDates(p) {
  if (p.date_from && p.date_to) return Utils.formatDate(p.date_from) + ' — ' + Utils.formatDate(p.date_to);
  if (p.date_from) return 'с ' + Utils.formatDate(p.date_from);
  if (p.last_checkin_date) return 'последняя смена: ' + Utils.formatDate(p.last_checkin_date);
  return '';
}

function pluralRu(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

Router.register('/field/my-works', MyWorksPage);
})();
