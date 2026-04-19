/**
 * ASGARD Field — Crew Page (master only)
 * Brigade list with statuses, call buttons, manual checkin
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
  const project = await API.fetch('/worker/active-project');
  if (!project || !project.project) {
    content.replaceChildren(F.Empty({ text: '\u041D\u0435\u0442 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0433\u043E \u043F\u0440\u043E\u0435\u043A\u0442\u0430', icon: '\uD83D\uDC65' }));
    return;
  }

  const workId = project.project.work_id || project.project.id;
  const data = await API.fetch('/checkin/today?work_id=' + workId);

  content.replaceChildren();

  const checkins = data?.checkins || (Array.isArray(data) ? data : []);

  // Count stats
  const onSite = checkins.filter(c => c.status === 'active').length;
  const completed = checkins.filter(c => c.status === 'completed').length;
  const total = project.project.crew_count || checkins.length || 0;

  // Stats header
  const statsRow = el('div', {
    style: { display: 'flex', gap: '8px', animation: 'fieldSlideUp 0.4s ease both' },
  });
  statsRow.appendChild(buildCrewStat('\u041D\u0430 \u043E\u0431\u044A\u0435\u043A\u0442\u0435', String(onSite), t.green, t));
  statsRow.appendChild(buildCrewStat('\u0417\u0430\u0432\u0435\u0440\u0448\u0438\u043B\u0438', String(completed), t.blue, t));
  statsRow.appendChild(buildCrewStat('\u0412\u0441\u0435\u0433\u043E', String(total), t.textSec, t));
  content.appendChild(statsRow);

  if (!checkins.length) {
    content.appendChild(F.Empty({ text: '\u0421\u0435\u0433\u043E\u0434\u043D\u044F \u043D\u0438\u043A\u0442\u043E \u043D\u0435 \u043E\u0442\u043C\u0435\u0442\u0438\u043B\u0441\u044F', icon: '\uD83D\uDC65' }));
  }

  let delay = 0.1;
  for (const c of checkins) {
    delay += 0.05;
    content.appendChild(buildCrewCard(c, delay, workId, content, t));
  }

  // Shift report button
  content.appendChild(el('div', {
    style: { marginTop: '8px', animation: 'fieldSlideUp 0.4s ease ' + (delay + 0.1) + 's both' },
  }, F.BigButton({
    label: '\u0414\u043D\u0435\u0432\u043D\u043E\u0439 \u043E\u0442\u0447\u0451\u0442',
    icon: '\uD83D\uDCDD',
    variant: 'gold',
    onClick: () => Router.navigate('/field/report'),
  })));
}

function buildCrewStat(label, value, color, t) {
  const wrap = el('div', {
    style: {
      flex: '1', textAlign: 'center', padding: '12px 8px', borderRadius: '14px',
      background: t.surface, border: '1px solid ' + t.border,
    },
  });
  wrap.appendChild(el('div', { style: { color, fontSize: '1.5rem', fontWeight: '700' } }, value));
  wrap.appendChild(el('div', { style: { color: t.textTer, fontSize: '0.625rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '2px' } }, label));
  return wrap;
}

function buildCrewCard(checkin, animDelay, workId, content, t) {
  const isActive = checkin.status === 'active';
  const isCompleted = checkin.status === 'completed';
  const statusIcon = isActive ? '\u2705' : isCompleted ? '\uD83D\uDD35' : '\u2B55';
  const statusLabel = isActive ? '\u041D\u0430 \u043E\u0431\u044A\u0435\u043A\u0442\u0435' : isCompleted ? '\u0417\u0430\u0432\u0435\u0440\u0448\u0438\u043B' : '\u041D\u0435 \u043E\u0442\u043C\u0435\u0442\u0438\u043B\u0441\u044F';

  const card = el('div', {
    style: {
      background: t.surface, borderRadius: '14px', padding: '14px 16px',
      border: '1px solid ' + (isActive ? 'rgba(52,199,89,0.15)' : t.border),
      animation: 'fieldSlideUp 0.4s ease ' + animDelay + 's both',
    },
  });

  // Top row
  const top = el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } });
  top.appendChild(el('span', { style: { fontSize: '1.1rem' } }, statusIcon));

  const info = el('div', { style: { flex: '1' } });
  info.appendChild(el('div', { style: { color: t.text, fontWeight: '600', fontSize: '0.9375rem' } }, checkin.fio || checkin.employee_name || '\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A'));

  const meta = [];
  if (checkin.checkin_at) meta.push(Utils.formatTime(checkin.checkin_at));
  if (isCompleted && checkin.hours_worked) meta.push(Utils.formatHours(checkin.hours_worked));
  if (meta.length) {
    info.appendChild(el('div', { style: { color: t.textSec, fontSize: '0.75rem', marginTop: '1px' } }, meta.join(' \u00B7 ')));
  }
  top.appendChild(info);

  // Call button
  if (checkin.phone) {
    top.appendChild(el('a', {
      href: 'tel:' + checkin.phone.replace(/[^\d+]/g, ''),
      style: {
        width: '36px', height: '36px', borderRadius: '10px', display: 'flex',
        alignItems: 'center', justifyContent: 'center', background: t.bg2,
        border: '1px solid ' + t.border, fontSize: '1rem', textDecoration: 'none',
      },
    }, '\uD83D\uDCDE'));
  }

  // Manual checkin button (if not checked in)
  if (!isActive && !isCompleted) {
    const manualBtn = el('button', {
      style: {
        padding: '4px 10px', borderRadius: '8px', border: '1px solid ' + t.gold + '40',
        background: 'transparent', color: t.gold, fontSize: '0.6875rem', fontWeight: '600',
        cursor: 'pointer',
      },
      onClick: () => showManualCheckin(checkin, workId, content),
    }, '\u270F\uFE0F \u041E\u0442\u043C\u0435\u0442\u0438\u0442\u044C');
    top.appendChild(manualBtn);
  }

  card.appendChild(top);

  // Earnings for completed + correct button
  if (isCompleted && checkin.amount_earned) {
    const earnRow = el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px' } });
    const pts = Math.round(parseFloat(checkin.day_rate || checkin.amount_earned || 0) / 500);
    earnRow.appendChild(el('span', { style: { color: t.textSec, fontSize: '0.75rem' } }, pts + ' бал'));
    const rightPart = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } });
    rightPart.appendChild(el('span', { style: { color: t.gold, fontSize: '0.8125rem', fontWeight: '600' } }, Utils.formatMoney(checkin.amount_earned) + '\u20BD'));
    const correctBtn = el('button', {
      style: { padding: '2px 8px', borderRadius: '6px', border: '1px solid ' + t.border, background: 'transparent', color: t.textSec, fontSize: '0.625rem', cursor: 'pointer' },
      onClick: () => showCorrectCheckin(checkin, workId, content),
    }, '\u270F');
    rightPart.appendChild(correctBtn);
    earnRow.appendChild(rightPart);
    card.appendChild(earnRow);
  }

  return card;
}

function showManualCheckin(employee, workId, content) {
  const t = DS.t;
  const form = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });

  form.appendChild(el('div', { style: { color: t.text, fontSize: '0.9375rem' } },
    '\u041E\u0442\u043C\u0435\u0442\u0438\u0442\u044C ' + (employee.fio || employee.employee_name) + ' \u0432\u0440\u0443\u0447\u043D\u0443\u044E'));

  // Time inputs
  const timeRow = el('div', { style: { display: 'flex', gap: '12px' } });

  const checkinInput = el('input', {
    type: 'time', value: '08:00',
    style: {
      flex: '1', padding: '12px', borderRadius: '12px', border: '1px solid ' + t.border,
      background: t.bg2, color: t.text, fontSize: '1rem',
    },
  });
  const checkoutInput = el('input', {
    type: 'time', value: '',
    placeholder: '\u0423\u0445\u043E\u0434 (\u043D\u0435\u043E\u0431\u044F\u0437.)',
    style: {
      flex: '1', padding: '12px', borderRadius: '12px', border: '1px solid ' + t.border,
      background: t.bg2, color: t.text, fontSize: '1rem',
    },
  });

  const labelIn = el('div', {});
  labelIn.appendChild(el('div', { style: { color: t.textSec, fontSize: '0.6875rem', marginBottom: '4px' } }, '\u041F\u0440\u0438\u0445\u043E\u0434'));
  labelIn.appendChild(checkinInput);

  const labelOut = el('div', {});
  labelOut.appendChild(el('div', { style: { color: t.textSec, fontSize: '0.6875rem', marginBottom: '4px' } }, '\u0423\u0445\u043E\u0434 (\u043D\u0435\u043E\u0431\u044F\u0437.)'));
  labelOut.appendChild(checkoutInput);

  timeRow.appendChild(labelIn);
  timeRow.appendChild(labelOut);
  form.appendChild(timeRow);

  // Reason
  const reason = el('textarea', {
    placeholder: '\u041F\u0440\u0438\u0447\u0438\u043D\u0430 \u0440\u0443\u0447\u043D\u043E\u0439 \u043E\u0442\u043C\u0435\u0442\u043A\u0438...',
    style: {
      width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid ' + t.border,
      background: t.bg2, color: t.text, fontSize: '0.875rem', minHeight: '60px', resize: 'vertical',
      boxSizing: 'border-box',
    },
  });
  form.appendChild(reason);

  const errorEl = el('div', { style: { color: t.red, fontSize: '0.8125rem', minHeight: '18px' } });
  form.appendChild(errorEl);

  // Buttons
  const btns = el('div', { style: { display: 'flex', gap: '12px' } });
  btns.appendChild(el('button', {
    style: { flex: '1', height: '48px', borderRadius: '14px', border: '1px solid ' + t.border, background: t.bg2, color: t.text, fontSize: '0.9375rem', fontWeight: '600', cursor: 'pointer' },
    onClick: () => sheet.remove(),
  }, '\u041E\u0442\u043C\u0435\u043D\u0430'));

  btns.appendChild(el('button', {
    style: { flex: '1', height: '48px', borderRadius: '14px', border: 'none', background: t.goldGrad, color: '#FFF', fontSize: '0.9375rem', fontWeight: '600', cursor: 'pointer' },
    onClick: async () => {
      const today = new Date().toISOString().split('T')[0];
      const checkinAt = today + 'T' + (checkinInput.value || '08:00') + ':00';
      const body = {
        employee_id: employee.employee_id || employee.id,
        work_id: workId,
        checkin_at: checkinAt,
        date: today,
        reason: reason.value || '\u0420\u0443\u0447\u043D\u0430\u044F \u043E\u0442\u043C\u0435\u0442\u043A\u0430 \u043C\u0430\u0441\u0442\u0435\u0440\u043E\u043C',
      };
      if (checkoutInput.value) {
        body.checkout_at = today + 'T' + checkoutInput.value + ':00';
      }
      const resp = await API.post('/checkin/manual', body);
      if (resp && resp._ok) {
        sheet.remove();
        F.Toast({ message: '\u2705 \u041E\u0442\u043C\u0435\u0442\u043A\u0430 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0430', type: 'success' });
        Router.navigate('/field/crew');
      } else {
        errorEl.textContent = resp?.error || '\u041E\u0448\u0438\u0431\u043A\u0430';
      }
    },
  }, '\u041E\u0442\u043C\u0435\u0442\u0438\u0442\u044C'));
  form.appendChild(btns);

  const sheet = F.BottomSheet({
    title: '\u270F\uFE0F \u0420\u0443\u0447\u043D\u0430\u044F \u043E\u0442\u043C\u0435\u0442\u043A\u0430',
    content: form,
  });
}

function showCorrectCheckin(checkin, workId, content) {
  const t = DS.t;
  const currentPts = Math.round(parseFloat(checkin.day_rate || checkin.amount_earned || 0) / 500);
  const form = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });

  form.appendChild(el('div', { style: { color: t.text, fontSize: '0.9375rem' } },
    '\u041A\u043E\u0440\u0440\u0435\u043A\u0442\u0438\u0440\u043E\u0432\u043A\u0430: ' + (checkin.fio || checkin.employee_name)));

  // Points input
  const ptsLabel = el('div', {});
  ptsLabel.appendChild(el('div', { style: { color: t.textSec, fontSize: '0.6875rem', marginBottom: '4px' } }, '\u0411\u0430\u043B\u043B\u044B (6=\u0434\u043E\u0440\u043E\u0433\u0430, 12=\u0440\u0430\u0431\u043E\u0442\u0430, 18=\u043F\u0435\u0440\u0435\u0440\u0430\u0431.)'));
  const ptsInput = el('input', {
    type: 'number', value: String(currentPts), min: '0', max: '30',
    style: { width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid ' + t.border, background: t.bg2, color: t.text, fontSize: '1.25rem', textAlign: 'center', boxSizing: 'border-box' },
  });
  ptsLabel.appendChild(ptsInput);
  form.appendChild(ptsLabel);

  // Note
  const note = el('input', {
    type: 'text', placeholder: '\u041F\u0440\u0438\u0447\u0438\u043D\u0430 \u043A\u043E\u0440\u0440\u0435\u043A\u0442\u0438\u0440\u043E\u0432\u043A\u0438...',
    style: { width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid ' + t.border, background: t.bg2, color: t.text, fontSize: '0.875rem', boxSizing: 'border-box' },
  });
  form.appendChild(note);

  const btns = el('div', { style: { display: 'flex', gap: '12px' } });
  btns.appendChild(el('button', {
    style: { flex: '1', height: '48px', borderRadius: '14px', border: '1px solid ' + t.border, background: t.bg2, color: t.text, fontSize: '0.9375rem', fontWeight: '600', cursor: 'pointer' },
    onClick: () => sheet.remove(),
  }, '\u041E\u0442\u043C\u0435\u043D\u0430'));

  btns.appendChild(el('button', {
    style: { flex: '1', height: '48px', borderRadius: '14px', border: 'none', background: t.goldGrad, color: '#FFF', fontSize: '0.9375rem', fontWeight: '600', cursor: 'pointer' },
    onClick: async () => {
      const newPts = parseInt(ptsInput.value) || 0;
      const newRate = newPts * 500;
      const resp = await API.put('/checkin/correct/' + checkin.id, {
        day_rate: newRate, amount_earned: newRate, note: note.value || null
      });
      if (resp && (resp.ok || resp._ok)) {
        sheet.remove();
        F.Toast({ message: '\u2705 \u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E: ' + newPts + ' \u0431\u0430\u043B = ' + Utils.formatMoney(newRate) + '\u20BD', type: 'success' });
        loadCrew(content);
      } else {
        F.Toast({ message: '\u274C ' + (resp?.error || '\u041E\u0448\u0438\u0431\u043A\u0430'), type: 'error' });
      }
    },
  }, '\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C'));
  form.appendChild(btns);

  const sheet = F.BottomSheet({
    title: '\u270F\uFE0F \u041A\u043E\u0440\u0440\u0435\u043A\u0442\u0438\u0440\u043E\u0432\u043A\u0430',
    content: form,
  });
}

Router.register('/field/crew', CrewPage);
})();
