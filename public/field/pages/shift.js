/**
 * ASGARD Field — Shift Page
 * Detailed shift view: big timer, geo, checkout, event timeline
 */
(() => {
'use strict';
const el = Utils.el;

let timerInterval = null;

function formatBigTimer(checkinAt) {
  const ms = Date.now() - new Date(checkinAt).getTime();
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return h + ':' + m + ':' + s;
}

const ShiftPage = {
  render() {
    const t = DS.t;
    const page = el('div', { className: 'field-page field-shift' });

    page.appendChild(F.Header({ title: '\u0421\u043C\u0435\u043D\u0430', logo: true, back: true, backHref: '/field/home' }));

    const content = el('div', { style: { padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' } });
    content.appendChild(F.Skeleton({ type: 'hero' }));
    content.appendChild(F.Skeleton({ type: 'card', count: 2 }));
    page.appendChild(content);

    setTimeout(() => loadShiftData(content), 0);

    return page;
  }
};

async function loadShiftData(content) {
  const t = DS.t;
  const data = await API.fetch('/worker/active-project');

  content.replaceChildren();

  if (!data || !data.project) {
    content.appendChild(F.Empty({ text: '\u041D\u0435\u0442 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0433\u043E \u043F\u0440\u043E\u0435\u043A\u0442\u0430', icon: '\uD83D\uDEE1\uFE0F' }));
    return;
  }

  const project = data.project || data;
  const checkin = data.today_checkin || project.today_checkin;

  // Status card
  const statusCard = el('div', {
    style: {
      background: checkin && checkin.status === 'active' ? t.greenBg : t.surface,
      borderRadius: '20px', padding: '24px', textAlign: 'center',
      border: '1px solid ' + (checkin && checkin.status === 'active' ? 'rgba(52,199,89,0.2)' : t.border),
      animation: 'fieldSlideUp 0.4s ease both',
    },
  });

  if (checkin && checkin.status === 'active') {
    // Active shift — big timer
    statusCard.appendChild(el('div', {
      style: { color: t.green, fontSize: '0.75rem', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px' },
    }, '\u25CF \u041D\u0410 \u041E\u0411\u042A\u0415\u041A\u0422\u0415'));

    statusCard.appendChild(el('div', {
      style: { color: t.textSec, fontSize: '0.8125rem', marginBottom: '16px' },
    }, '\u041D\u0430\u0447\u0430\u043B\u043E \u0441\u043C\u0435\u043D\u044B: ' + Utils.formatTime(checkin.checkin_at)));

    const timerEl = el('div', {
      style: {
        color: t.text, fontSize: '3.5rem', fontWeight: '700', fontFamily: "'Inter', monospace",
        letterSpacing: '2px', lineHeight: '1',
        animation: 'fieldCountUp 0.5s ease both',
      },
    }, formatBigTimer(checkin.checkin_at));
    statusCard.appendChild(timerEl);

    // Live timer
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      timerEl.textContent = formatBigTimer(checkin.checkin_at);
    }, 1000);

    // Progress bar (% of shift_hours)
    const shiftHours = project.shift_hours || 11;
    const elapsedHours = (Date.now() - new Date(checkin.checkin_at).getTime()) / 3600000;
    const pct = Math.min(100, (elapsedHours / shiftHours) * 100);

    const progressWrap = el('div', {
      style: { marginTop: '16px', background: 'rgba(255,255,255,0.06)', borderRadius: '6px', height: '8px', overflow: 'hidden' },
    });
    progressWrap.appendChild(el('div', {
      style: { height: '100%', width: pct + '%', borderRadius: '6px', background: t.shiftActiveGrad, transition: 'width 1s ease' },
    }));
    statusCard.appendChild(progressWrap);

    statusCard.appendChild(el('div', {
      style: { color: t.textTer, fontSize: '0.75rem', marginTop: '6px' },
    }, Math.round(pct) + '% \u043E\u0442 \u043D\u043E\u0440\u043C\u0430\u0442\u0438\u0432\u043D\u043E\u0439 \u0441\u043C\u0435\u043D\u044B (' + shiftHours + '\u0447)'));

  } else if (checkin && checkin.status === 'completed') {
    // Shift completed
    statusCard.appendChild(el('div', {
      style: { color: t.blue, fontSize: '0.75rem', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px' },
    }, '\u2713 \u0421\u041C\u0415\u041D\u0410 \u0417\u0410\u0412\u0415\u0420\u0428\u0415\u041D\u0410'));

    statusCard.appendChild(el('div', {
      style: { color: t.text, fontSize: '2.5rem', fontWeight: '700', lineHeight: '1', margin: '8px 0' },
    }, Utils.formatHours(checkin.hours_worked)));

    const fields = el('div', { style: { display: 'flex', justifyContent: 'center', gap: '24px', marginTop: '12px' } });
    fields.appendChild(buildMiniStat('\u041D\u0430\u0447\u0430\u043B\u043E', Utils.formatTime(checkin.checkin_at), t));
    fields.appendChild(buildMiniStat('\u041A\u043E\u043D\u0435\u0446', Utils.formatTime(checkin.checkout_at), t));
    fields.appendChild(buildMiniStat('\u0417\u0430\u0440\u0430\u0431\u043E\u0442\u043E\u043A', Utils.formatMoney(checkin.amount_earned) + '\u20BD', t));
    statusCard.appendChild(fields);

  } else {
    // No checkin today
    statusCard.appendChild(el('div', {
      style: { color: t.textSec, fontSize: '0.75rem', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '12px' },
    }, '\u041D\u0415 \u041D\u0410 \u041E\u0411\u042A\u0415\u041A\u0422\u0415'));

    statusCard.appendChild(el('div', {
      style: { color: t.textTer, fontSize: '1rem', marginBottom: '16px' },
    }, '\u0421\u043C\u0435\u043D\u0430 \u0435\u0449\u0451 \u043D\u0435 \u043D\u0430\u0447\u0430\u0442\u0430'));

    statusCard.appendChild(F.BigButton({
      label: '\u041D\u0410\u0427\u0410\u0422\u042C \u0421\u041C\u0415\u041D\u0423',
      icon: '\u2694\uFE0F',
      variant: 'gold',
      pulse: true,
      onClick: async () => {
        let geo = {};
        try {
          const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 }));
          geo = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        } catch (e) { }
        const workId = project.work_id || project.id;
        const resp = await API.post('/checkin/', { work_id: workId, ...geo });
        if (resp && resp._ok) {
          Utils.vibrate(100);
          F.Toast({ message: resp.quote || '\u2694\uFE0F \u0421\u043C\u0435\u043D\u0430 \u043D\u0430\u0447\u0430\u043B\u0430\u0441\u044C!', type: 'success' });
          Router.navigate('/field/shift');
        } else {
          F.Toast({ message: resp?.error || '\u041E\u0448\u0438\u0431\u043A\u0430', type: 'error' });
        }
      },
    }));
  }

  content.appendChild(statusCard);

  // Checkout button (if active)
  if (checkin && checkin.status === 'active') {
    content.appendChild(el('div', { style: { animation: 'fieldSlideUp 0.4s ease 0.15s both' } },
      F.BigButton({
        label: '\u0417\u0410\u0412\u0415\u0420\u0428\u0418\u0422\u042C \u0421\u041C\u0415\u041D\u0423',
        icon: '\uD83D\uDEE1\uFE0F',
        variant: 'red',
        onClick: async () => {
          let geo = {};
          try {
            const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 }));
            geo = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
          } catch (e) { }
          const resp = await API.post('/checkin/checkout', { checkin_id: checkin.id, ...geo });
          if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
          if (resp && resp._ok) {
            Utils.vibrate(100);
            F.Toast({
              message: resp.quote || ('\uD83D\uDEE1\uFE0F \u0421\u043C\u0435\u043D\u0430 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0430! ' + Utils.formatHours(resp.hours_worked)),
              type: 'success', duration: 5000,
            });
            Router.navigate('/field/shift');
          } else {
            F.Toast({ message: resp?.error || '\u041E\u0448\u0438\u0431\u043A\u0430', type: 'error' });
          }
        },
      })
    ));
  }

  // Geo info
  if (checkin && checkin.checkin_lat) {
    const geoCard = el('div', {
      style: {
        background: t.surface, borderRadius: '14px', padding: '14px 16px',
        border: '1px solid ' + t.border, animation: 'fieldSlideUp 0.4s ease 0.25s both',
      },
    });
    geoCard.appendChild(el('div', {
      style: { color: t.textTer, fontSize: '0.6875rem', fontWeight: '600', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '6px' },
    }, '\uD83D\uDCCD \u0413\u0415\u041E\u041B\u041E\u041A\u0410\u0426\u0418\u042F'));
    geoCard.appendChild(el('div', {
      style: { color: t.textSec, fontSize: '0.8125rem' },
    }, '\u0422\u043E\u0447\u043D\u043E\u0441\u0442\u044C: ' + Math.round(checkin.checkin_accuracy || 0) + '\u043C'));
    content.appendChild(geoCard);
  }

  // Project info
  content.appendChild(F.Card({
    title: project.work_title || project.title,
    subtitle: [project.city, project.object_name].filter(Boolean).join(' \u00B7 '),
    fields: [
      { label: '\u0421\u0442\u0430\u0432\u043A\u0430', value: Utils.formatMoney(project.day_rate || project.total_rate) + '\u20BD/\u0441\u043C' },
      { label: '\u0421\u043C\u0435\u043D\u0430', value: (project.shift_hours || 11) + '\u0447' },
    ],
    animDelay: 0.35,
  }));
}

function buildMiniStat(label, value, t) {
  const wrap = el('div', { style: { textAlign: 'center' } });
  wrap.appendChild(el('div', { style: { color: t.textTer, fontSize: '0.625rem', textTransform: 'uppercase', letterSpacing: '0.06em' } }, label));
  wrap.appendChild(el('div', { style: { color: t.text, fontSize: '0.9375rem', fontWeight: '600', marginTop: '2px' } }, value));
  return wrap;
}

Router.register('/field/shift', ShiftPage);
})();
