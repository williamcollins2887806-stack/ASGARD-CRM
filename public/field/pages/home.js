/**
 * ASGARD Field — Home Page
 * Main screen: hero banner, project card, shift button, earnings, quick actions
 */
(() => {
'use strict';
const el = Utils.el;

const VIKING_QUOTES = [
  'Не бойся медленного продвижения — бойся остановки',
  'Лучше быть волком один день, чем овцой всю жизнь',
  'В бурю кормчий познаётся',
  'Каждый день — поход за славой',
  'Кто рано встаёт, тому Один даёт',
  'Сильный духом побеждает сильного телом',
  'Дела говорят громче рун',
  'Мудрый путник далеко не заходит в одиночку',
  'Своё железо куй, пока горячо',
  'Даже Тор пахал прежде, чем метал молнии',
  'Слава приходит к тому, кто работает молча',
  'Валгалла ждёт тех, кто не сдаётся',
  'Рука помощи ближе, чем ты думаешь',
  'Один весло не сдвинет корабль',
  'Битва выиграна до рассвета — подготовкой',
  'Нет плохой погоды — есть слабые воины',
  'Щит ломается — дух крепчает',
  'Асгард строится каждый день',
  'Один мудрый сказал: «Рано встал — уже победил»',
  'Новый день — новый поход за славой!',
  'Руки крепкие, дух несгибаемый — вперёд!',
  'Настоящий воин не ждёт команды — он готов',
  'Сегодня мы делаем то, что другие не могут',
  'Рассвет принадлежит тем, кто не боится работы',
  'Один за всех, все за Асгард!',
  'Воин не жалуется — воин действует',
];

const SHIFT_START_QUOTES = [
  '\u2694\uFE0F Славной смены, воин! Вальхалла гордится тобой',
  '\u2694\uFE0F В бой! Пусть этот день будет легендой',
  '\u2694\uFE0F Надевай каску — сегодня мы творим историю',
  '\u2694\uFE0F Щит поднят, меч наточен — смена началась!',
  '\u2694\uFE0F Ты на передовой. Асгард за твоей спиной',
  '\u2694\uFE0F Время показать, из чего сделаны воины!',
  '\u2694\uFE0F Руны удачи начертаны. Вперёд!',
  '\u2694\uFE0F Битва за качество начинается. Не подведи!',
];

function randomQuote(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function formatShiftDuration(checkinAt) {
  const ms = Date.now() - new Date(checkinAt).getTime();
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return h + '\u0447 ' + String(m).padStart(2, '0') + '\u043C\u0438\u043D';
}

let shiftTimerInterval = null;

const HomePage = {
  render() {
    const t = DS.t;
    const me = Store.get('me');
    const page = el('div', { className: 'field-page field-home' });

    // Header
    page.appendChild(F.Header({ title: 'ASGARD', logo: true }));

    // Hero
    const firstName = me?.fio?.split(' ')[1] || me?.fio || '\u0412\u043E\u0438\u043D';
    page.appendChild(F.HeroBanner({
      greeting: Utils.greeting() + ', ' + firstName + '!',
      date: Utils.todayStr(),
      quote: '\u00AB' + randomQuote(VIKING_QUOTES) + '\u00BB',
      emblemSrc: '/assets/img/logo.png',
    }));

    // Content area
    const content = el('div', { style: { padding: '16px 20px 100px', display:'flex', flexDirection:'column', gap:'16px' } });

    // Skeleton while loading
    content.appendChild(F.Skeleton({ type: 'card', count: 3 }));
    page.appendChild(content);

    // Load data async
    setTimeout(() => loadData(content, me), 0);

    return page;
  }
};

async function loadData(content, me) {
  const t = DS.t;
  const data = await API.fetch('/worker/active-project');

  content.replaceChildren(); // remove skeletons

  if (!data || (!data.work && !data.project)) {
    // No active project
    content.appendChild(F.Empty({
      text: '\u041D\u0430 \u0434\u0430\u043D\u043D\u044B\u0439 \u043C\u043E\u043C\u0435\u043D\u0442 \u043D\u0435\u0442 \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u043F\u0440\u043E\u0435\u043A\u0442\u043E\u0432.\n\u041E\u0442\u0434\u044B\u0445\u0430\u0439, \u0432\u043E\u0438\u043D!',
      icon: '\uD83D\uDEE1\uFE0F',
    }));
    // Quick actions still visible
    content.appendChild(buildQuickActions(null, me));
    return;
  }

  const project = data.project || data;
  const checkin = data.today_checkin || project.today_checkin;
  const assignment = data.assignment || project;

  let delay = 0;
  const nextDelay = () => { delay += 0.08; return delay; };

  // Project card
  const projectCard = F.Card({
    title: project.work_title || project.title,
    subtitle: [project.city, project.object_name].filter(Boolean).join(' \u00B7 '),
    badge: '\u25B6 \u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0439',
    badgeColor: t.green,
    animDelay: nextDelay(),
  });

  // Call buttons row
  const callRow = el('div', { style: { display:'flex', gap:'8px', marginTop:'12px', flexWrap:'wrap' } });

  if (project.pm_fio || project.pm_name) {
    callRow.appendChild(F.CallButton({
      name: '\u0420\u041F: ' + (project.pm_fio || project.pm_name),
      phone: project.pm_phone,
      icon: '\uD83D\uDCDE',
    }));
  }
  if (project.master_fio) {
    callRow.appendChild(F.CallButton({
      name: '\u041C\u0430\u0441\u0442\u0435\u0440: ' + project.master_fio,
      phone: project.master_phone,
      icon: '\uD83D\uDCDE',
    }));
  }
  if (callRow.children.length) projectCard.appendChild(callRow);
  content.appendChild(projectCard);

  // Shift button (or current stage)
  const btnWrap = el('div', { style: { animation: 'fieldSlideUp 0.4s ease ' + nextDelay() + 's both' } });

  // Check current trip stage
  const workIdForStage = project.work_id || project.id;
  let currentStage = null;
  try { currentStage = await API.fetch('/stages/my/current/' + workIdForStage); } catch (_) {}

  if (currentStage && currentStage.stage_type && currentStage.stage_type !== 'object') {
    // Worker is on a trip stage — show stage card instead of shift button
    const STAGE_ICONS_H = { medical: '\uD83C\uDFE5', travel: '\u2708\uFE0F', waiting: '\u23F3', warehouse: '\uD83D\uDCE6', day_off: '\uD83D\uDECC' };
    const STAGE_LABELS_H = { medical: '\u041C\u0435\u0434\u043E\u0441\u043C\u043E\u0442\u0440', travel: '\u0414\u043E\u0440\u043E\u0433\u0430', waiting: '\u041E\u0436\u0438\u0434\u0430\u043D\u0438\u0435', warehouse: '\u0421\u043A\u043B\u0430\u0434', day_off: '\u0412\u044B\u0445\u043E\u0434\u043D\u043E\u0439' };
    const STAGE_COLORS_H = { medical: '#9333EA', travel: '#3B82F6', waiting: '#F59E0B', warehouse: '#F97316', day_off: '#9CA3AF' };
    const stDay = Math.max(1, Math.floor((Date.now() - new Date(currentStage.date_from).getTime()) / 86400000) + 1);
    const stColor = STAGE_COLORS_H[currentStage.stage_type] || '#3B82F6';
    const stCard = el('div', {
      style: {
        background: DS.t.surface, borderRadius: '16px', padding: '16px',
        border: '2px solid ' + stColor, cursor: 'pointer',
      },
      onClick: () => Router.navigate('/field/stages/' + workIdForStage),
    });
    stCard.appendChild(el('div', { style: { color: stColor, fontWeight: '600', fontSize: '1rem' } },
      (STAGE_ICONS_H[currentStage.stage_type] || '') + ' ' + (STAGE_LABELS_H[currentStage.stage_type] || currentStage.stage_type)));
    stCard.appendChild(el('div', { style: { color: DS.t.textSec, fontSize: '0.8125rem', marginTop: '4px' } },
      stDay + '-\u0439 \u0434\u0435\u043D\u044C \u00B7 ~' + Utils.formatMoney(stDay * parseFloat(currentStage.rate_per_day || 0)) + '\u20BD'));
    stCard.appendChild(el('div', { style: { color: DS.t.gold, fontSize: '0.8125rem', marginTop: '6px' } },
      '\u041F\u043E\u0434\u0440\u043E\u0431\u043D\u0435\u0435 \u2192'));
    btnWrap.appendChild(stCard);
  } else if (!checkin || checkin.status === 'completed' || checkin.status === 'cancelled') {
    // No active checkin — show START SHIFT
    btnWrap.appendChild(F.BigButton({
      label: '\u041D\u0410\u0427\u0410\u0422\u042C \u0421\u041C\u0415\u041D\u0423',
      icon: '\u2694\uFE0F',
      variant: 'gold',
      pulse: true,
      onClick: () => startShift(project, btnWrap, content),
    }));
  } else {
    // Active checkin — show timer + END SHIFT
    buildActiveShiftButton(checkin, btnWrap, project, content);
  }
  content.appendChild(btnWrap);

  // Earnings today
  const todayEarned = checkin?.amount_earned || data.today_earnings || 0;
  const dayRate = assignment.day_rate || assignment.total_rate || project.day_rate || 0;
  const perDiem = assignment.per_diem || project.per_diem || 0;
  const details = [];
  if (dayRate) details.push(Utils.formatMoney(dayRate) + '\u20BD/\u0441\u043C\u0435\u043D\u0430');
  if (perDiem) details.push('\u043F\u0430\u0439\u043A\u043E\u0432\u044B\u0435 ' + Utils.formatMoney(perDiem) + '\u20BD/\u0441\u0443\u0442');

  content.appendChild(F.MoneyCard({
    amount: todayEarned,
    label: '\u0421\u0435\u0433\u043E\u0434\u043D\u044F \u0437\u0430\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u043E',
    details: details.join(' + '),
    animDelay: nextDelay(),
  }));

  // Tariff info
  if (assignment.tariff_position || project.tariff) {
    const tariff = project.tariff || assignment;
    const tariffCard = el('div', {
      style: {
        background: t.surface, borderRadius: '16px', padding: '14px 16px',
        border: '1px solid ' + t.border,
        animation: 'fieldSlideUp 0.4s ease ' + nextDelay() + 's both',
      },
    });
    tariffCard.appendChild(el('div', {
      style: { color: t.textTer, fontSize: '0.6875rem', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '6px' },
    }, '\u0422\u0410\u0420\u0418\u0424'));
    tariffCard.appendChild(el('div', {
      style: { color: t.text, fontSize: '0.875rem', fontWeight: '500' },
    }, (tariff.position_name || tariff.tariff_position || '') + ' \u00B7 ' + (tariff.points || tariff.tariff_points || '?') + ' \u0431\u0430\u043B\u043B\u043E\u0432'));
    if (tariff.combination_name || tariff.combo_position) {
      tariffCard.appendChild(el('div', {
        style: { color: t.gold, fontSize: '0.8125rem', marginTop: '4px' },
      }, '+ \u0421\u043E\u0432\u043C\u0435\u0449\u0435\u043D\u0438\u0435: ' + (tariff.combination_name || tariff.combo_position) + ' (+1 \u0431\u0430\u043B\u043B)'));
    }
    content.appendChild(tariffCard);
  }

  // Quick actions
  content.appendChild(buildQuickActions(project, me));
}

function buildQuickActions(project, me) {
  const t = DS.t;
  const isMaster = me?.field_role === 'shift_master' || me?.field_role === 'senior_master';
  const assignment = Store.get('me');

  const grid = el('div', {
    style: {
      display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px',
      animation: 'fieldSlideUp 0.4s ease 0.6s both',
    },
  });

  const actions = [
    { icon: '\uD83D\uDCB0', label: '\u0414\u0435\u043D\u044C\u0433\u0438', href: '/field/money' },
    { icon: '\uD83D\uDDFA\uFE0F', label: '\u041C\u0430\u0440\u0448\u0440\u0443\u0442', href: '/field/stages' },
    { icon: '\u2708\uFE0F', label: '\u0411\u0438\u043B\u0435\u0442\u044B', href: '/field/logistics' },
    { icon: '\uD83D\uDCF7', label: '\u0424\u043E\u0442\u043E', href: '/field/photos' },
    { icon: '\uD83D\uDCCB', label: '\u0418\u0441\u0442\u043E\u0440\u0438\u044F', href: '/field/history' },
    { icon: '\uD83D\uDCB3', label: '\u0412\u044B\u043F\u043B\u0430\u0442\u044B', href: '/field/earnings' },
  ];

  if (isMaster) {
    actions.push(
      { icon: '\uD83D\uDC65', label: '\u0411\u0440\u0438\u0433\u0430\u0434\u0430', href: '/field/crew' },
      { icon: '\uD83D\uDCCB', label: '\u041C\u0430\u0440\u0448\u0440. \u0431\u0440\u0438\u0433.', href: '/field/crew-stages' },
      { icon: '\uD83D\uDCDD', label: '\u041E\u0442\u0447\u0451\u0442', href: '/field/report' },
      { icon: '\u26A0\uFE0F', label: '\u0418\u043D\u0446\u0438\u0434\u0435\u043D\u0442', href: '/field/incidents' },
      { icon: '\uD83D\uDCB0', label: '\u041F\u043E\u0434\u043E\u0442\u0447\u0451\u0442', href: '/field/funds' },
      { icon: '\uD83D\uDCE6', label: '\u0421\u0431\u043E\u0440\u044B', href: '/field/packing' },
    );
  }

  // Profile always last
  actions.push({ icon: '\uD83D\uDC64', label: '\u041F\u0440\u043E\u0444\u0438\u043B\u044C', href: '/field/profile' });

  for (const a of actions) {
    const btn = el('div', {
      style: {
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
        padding: '14px 4px', borderRadius: '14px', background: t.surface,
        border: '1px solid ' + t.border, cursor: 'pointer',
        transition: 'transform 0.15s, background 0.15s',
      },
      onClick: () => { Utils.vibrate(30); Router.navigate(a.href); },
    });
    btn.addEventListener('touchstart', () => { btn.style.transform = 'scale(0.95)'; btn.style.background = t.surfaceHover; }, { passive: true });
    btn.addEventListener('touchend', () => { btn.style.transform = ''; btn.style.background = t.surface; }, { passive: true });
    btn.appendChild(el('span', { style: { fontSize: '1.5rem' } }, a.icon));
    btn.appendChild(el('span', { style: { fontSize: '0.6875rem', fontWeight: '500', color: t.textSec } }, a.label));
    grid.appendChild(btn);
  }

  return grid;
}

function buildActiveShiftButton(checkin, btnWrap, project, content) {
  const t = DS.t;
  const timerLabel = el('span', {}, formatShiftDuration(checkin.checkin_at));

  const btn = F.BigButton({
    label: '',
    variant: 'green',
    onClick: () => endShift(checkin, project, btnWrap, content),
  });
  // Replace inner content with icon + timer
  btn.replaceChildren();
  btn.appendChild(el('span', { style: { fontSize: '1.3rem' } }, '\uD83D\uDEE1\uFE0F'));
  btn.appendChild(el('span', {}, '\u0417\u0410\u0412\u0415\u0420\u0428\u0418\u0422\u042C \u0421\u041C\u0415\u041D\u0423 \u2014 '));
  btn.appendChild(timerLabel);

  btnWrap.replaceChildren(btn);

  // Live timer
  if (shiftTimerInterval) clearInterval(shiftTimerInterval);
  shiftTimerInterval = setInterval(() => {
    timerLabel.textContent = formatShiftDuration(checkin.checkin_at);
  }, 1000);
}

async function startShift(project, btnWrap, content) {
  const t = DS.t;
  // Show loading
  btnWrap.replaceChildren(F.BigButton({ label: '', variant: 'gold', loading: true }));

  // Try geolocation
  let geo = {};
  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000, enableHighAccuracy: true });
    });
    geo = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
  } catch (e) { /* geo optional */ }

  const workId = Store.get('active_work_id') || project.work_id || project.id;
  const resp = await API.post('/checkin/', { work_id: workId, ...geo });

  if (!resp || !resp._ok) {
    F.Toast({ message: resp?.error || '\u041E\u0448\u0438\u0431\u043A\u0430 \u0447\u0435\u043A\u0438\u043D\u0430', type: 'error' });
    // Restore button
    btnWrap.replaceChildren(F.BigButton({
      label: '\u041D\u0410\u0427\u0410\u0422\u042C \u0421\u041C\u0415\u041D\u0423',
      icon: '\u2694\uFE0F',
      variant: 'gold',
      pulse: true,
      onClick: () => startShift(project, btnWrap, content),
    }));
    return;
  }

  Utils.vibrate(100);
  F.Toast({ message: resp.quote || randomQuote(SHIFT_START_QUOTES), type: 'success', duration: 4000 });

  // Switch to active shift button
  const checkin = { id: resp.checkin_id, checkin_at: resp.checkin_at, status: 'active' };
  buildActiveShiftButton(checkin, btnWrap, project, content);
}

async function endShift(checkin, project, btnWrap, content) {
  const t = DS.t;
  // Confirm
  const sheet = F.BottomSheet({
    title: '\u0417\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u044C \u0441\u043C\u0435\u043D\u0443?',
    content: buildCheckoutConfirm(checkin, () => {
      sheet.remove();
      doCheckout(checkin, project, btnWrap, content);
    }, () => sheet.remove()),
  });
}

function buildCheckoutConfirm(checkin, onConfirm, onCancel) {
  const t = DS.t;
  const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } });

  wrap.appendChild(el('div', {
    style: { color: t.textSec, fontSize: '0.9375rem', textAlign: 'center' },
  }, '\u0412\u044B \u043D\u0430 \u043E\u0431\u044A\u0435\u043A\u0442\u0435 \u0441 ' + Utils.formatTime(checkin.checkin_at) + ' (' + formatShiftDuration(checkin.checkin_at) + ')'));

  const btns = el('div', { style: { display: 'flex', gap: '12px' } });
  btns.appendChild(el('button', {
    style: {
      flex: '1', height: '48px', borderRadius: '14px', border: '1px solid ' + t.border,
      background: t.bg2, color: t.text, fontSize: '0.9375rem', fontWeight: '600', cursor: 'pointer',
    },
    onClick: onCancel,
  }, '\u041E\u0442\u043C\u0435\u043D\u0430'));
  btns.appendChild(el('button', {
    style: {
      flex: '1', height: '48px', borderRadius: '14px', border: 'none',
      background: DS.t.dangerGrad, color: '#FFF', fontSize: '0.9375rem', fontWeight: '600', cursor: 'pointer',
    },
    onClick: onConfirm,
  }, '\u0417\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u044C'));
  wrap.appendChild(btns);

  return wrap;
}

async function doCheckout(checkin, project, btnWrap, content) {
  btnWrap.replaceChildren(F.BigButton({ label: '', variant: 'green', loading: true }));

  let geo = {};
  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000, enableHighAccuracy: true });
    });
    geo = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
  } catch (e) { /* optional */ }

  const resp = await API.post('/checkin/checkout', { checkin_id: checkin.id, ...geo });

  if (shiftTimerInterval) { clearInterval(shiftTimerInterval); shiftTimerInterval = null; }

  if (!resp || !resp._ok) {
    F.Toast({ message: resp?.error || '\u041E\u0448\u0438\u0431\u043A\u0430 \u0447\u0435\u043A\u0430\u0443\u0442\u0430', type: 'error' });
    buildActiveShiftButton(checkin, btnWrap, project, content);
    return;
  }

  Utils.vibrate(100);
  F.Toast({
    message: resp.quote || ('\uD83D\uDEE1\uFE0F \u0414\u043E\u0441\u0442\u043E\u0439\u043D\u0430\u044F \u0431\u0438\u0442\u0432\u0430! ' + Utils.formatHours(resp.hours_worked) + ' \u043D\u0430 \u043F\u043E\u0441\u0442\u0443'),
    type: 'success',
    duration: 5000,
  });

  // Show completed state — refresh page
  btnWrap.replaceChildren(F.BigButton({
    label: '\u0421\u041C\u0415\u041D\u0410 \u0417\u0410\u0412\u0415\u0420\u0428\u0415\u041D\u0410 \u2014 ' + Utils.formatHours(resp.hours_worked),
    variant: 'secondary',
    disabled: true,
  }));

  // Update money card
  if (resp.amount_earned) {
    const moneyCards = content.querySelectorAll('[data-money-card]');
    // Reload page after 2 sec for fresh data
    setTimeout(() => Router.navigate('/field/home'), 2000);
  }
}

Router.register('/field/home', HomePage);
})();
