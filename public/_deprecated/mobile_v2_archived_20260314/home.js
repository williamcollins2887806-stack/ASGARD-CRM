/* ================================================================
 *  ASGARD CRM Mobile v2 — Home Page (v3.1.0)
 *  #/home — Зал Ярла
 * ================================================================ */
(function () {
'use strict';

const el = Utils.el;

/* ============================================================
 *  QUICK ACTIONS — role → array of pill buttons
 * ============================================================ */
const QA = {
  TO:              ['Тендеры','Калькулятор','Задачи','ДР','Уведомления'],
  PM:              ['Калькулятор','Работы','Расчёты','Задачи','Касса','Жильё/билеты','Гантт','Уведомления'],
  DIRECTOR_COMM:   ['Дашборд','Калькулятор','Big Screen','Гантт','Согласование','Расчёты','Задачи','Деньги','ДР'],
  DIRECTOR_GEN:    ['Дашборд','Калькулятор','Big Screen','Гантт','Согласование','Расчёты','Задачи','Деньги','ДР'],
  DIRECTOR_DEV:    ['Дашборд','Калькулятор','Big Screen','Гантт','Согласование','Расчёты','Задачи','Деньги','ДР'],
  HR:              ['Персонал','Задачи','Жильё/билеты','График','Рейтинг','Уведомления'],
  PROC:            ['Заявки','ДР','Уведомления'],
  BUH:             ['Реестр расходов','Расчёты','Задачи','Деньги','ДР','Уведомления'],
  OFFICE_MANAGER:  ['Офис.расходы','Задачи','Жильё/билеты','Доверенности','Корреспонденция'],
  ADMIN:           ['Дашборд','Калькулятор','Big Screen','Гантт','Пользователи','Деньги','Настройки'],
  HEAD_TO:         ['Тендеры','Калькулятор','Big Screen','Аналитика отдела','Воронка','Уведомления'],
  HEAD_PM:         ['Свод работ','Калькулятор','Big Screen','Аналитика РП','Согласование','Гантт'],
  CHIEF_ENGINEER:  ['Склад','Аналитика склада','Моё оборудование','Уведомления'],
  HR_MANAGER:      ['Персонал','Калькулятор','Жильё/билеты','График','Допуски','Рейтинг'],
  WAREHOUSE:       ['Склад','Заявки','Уведомления'],
};

/* label → route */
const ROUTES = {
  'Тендеры':'/tenders','Калькулятор':'/calculator','Задачи':'/tasks','ДР':'/birthdays',
  'Уведомления':'/alerts','Работы':'/pm-works','Расчёты':'/calculations',
  'Касса':'/cash','Жильё/билеты':'/housing','Гантт':'/gantt','Дашборд':'/dashboard',
  'Big Screen':'/big-screen','Согласование':'/approvals','Деньги':'/money',
  'Персонал':'/employees','График':'/schedule','Рейтинг':'/rating','Заявки':'/requests',
  'Реестр расходов':'/expenses','Офис.расходы':'/office-expenses',
  'Доверенности':'/powers-of-attorney','Корреспонденция':'/correspondence',
  'Пользователи':'/users','Настройки':'/settings','Аналитика отдела':'/dept-analytics',
  'Воронка':'/funnel','Свод работ':'/works-summary','Аналитика РП':'/pm-analytics',
  'Склад':'/warehouse','Аналитика склада':'/warehouse-analytics',
  'Моё оборудование':'/my-equipment','Допуски':'/permits',
};

/* label → small inline SVG */
const QA_ICONS = {
  'Тендеры':      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  'Калькулятор':  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="14" x2="10" y2="14"/><line x1="14" y1="14" x2="16" y2="14"/></svg>',
  'Задачи':       '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>',
  'Уведомления':  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>',
  'Дашборд':      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
  'Работы':       '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 20h20"/><path d="M5 20V8l7-5 7 5v12"/></svg>',
  'Персонал':     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',
  'Склад':        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>',
  'Деньги':       '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>',
  'Настройки':    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
};

/* ============================================================
 *  Helpers
 * ============================================================ */
function greeting() {
  const h = new Date().getHours();
  if (h >= 5  && h < 12) return 'Доброе утро';
  if (h >= 12 && h < 17) return 'Добрый день';
  if (h >= 17 && h < 22) return 'Добрый вечер';
  return 'Доброй ночи';
}

function fmtDateHeader() {
  const d  = new Date();
  const mm = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  const dd = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
  return d.getDate() + ' ' + mm[d.getMonth()] + ', ' + dd[d.getDay()];
}

function firstName(user) {
  return (user.full_name || user.login || '').split(' ')[0] || 'Пользователь';
}

function initials(user) {
  return (user.full_name || user.login || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function deadlineColor(d) {
  if (!d) return 'neutral';
  const diff = (new Date(d) - Date.now()) / 86400000;
  if (diff < 0) return 'danger';
  if (diff < 3) return 'warning';
  return 'success';
}

function roleMeta(role) {
  return ROLE_META[role] || { label: 'Зал Ярла', subtitle: 'Главное за день и ближайшие сигналы' };
}

function safeNavigate(path, fallbackText) {
  if (Router.has && Router.has(path)) {
    Router.navigate(path);
    return true;
  }
  M.Toast({ message: fallbackText || 'Раздел будет добавлен в следующей сессии', type: 'info' });
  return false;
}

function renderHomeHero(role, stats) {
  const meta = roleMeta(role);
  return M.HeroCard({
    label: meta.label.toUpperCase(),
    value: stats.active ?? 0,
    details: [
      { label: 'Сегодня', value: String(stats.today ?? 0) },
      { label: 'Почта', value: String(stats.mail ?? 0) },
      { label: 'Сигналы', value: String(stats.notif ?? 0) },
    ],
    gradient: 'linear-gradient(145deg, #0A5DC2 0%, #17355A 34%, #5D1631 68%, #C62828 100%)',
  });
}

/* ============================================================
 *  HOME PAGE
 * ============================================================ */
const HomePage = {
  async render() {
    const user = Store.get('user');
    if (!user) { Router.navigate('/welcome', { replace: true }); return el('div'); }
    const role = user.role || 'TO';

    const page = el('div', { className: 'home-page' });
    Object.assign(page.style, {
      padding: DS.spacing.page + 'px',
      paddingBottom: '110px',
      minHeight: '100dvh',
    });

    let d = 0;
    const anim = () => { d += 0.08; return DS.anim(d); };

    /* ──────────── a) Greeting ──────────── */
    const greetRow = el('div', { className: 'home-greeting' });
    Object.assign(greetRow.style, {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      marginBottom: '24px', ...anim(),
    });

    const greetText = el('div');
    const g1 = el('h1');
    g1.textContent = greeting() + ', ' + firstName(user);
    Object.assign(g1.style, { ...DS.font('lg'), color: DS.t.text, margin: '0 0 2px' });
    greetText.appendChild(g1);

    const g2 = el('p');
    g2.textContent = fmtDateHeader();
    Object.assign(g2.style, { ...DS.font('sm'), color: DS.t.textSec, margin: '0' });
    greetText.appendChild(g2);
    greetRow.appendChild(greetText);

    /* avatar */
    const av = el('div', { className: 'home-avatar' });
    Object.assign(av.style, {
      width: '44px', height: '44px', borderRadius: '50%', flexShrink: '0',
      background: 'var(--hero-grad)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      ...DS.font('sm'), fontWeight: '700', color: '#fff',
      boxShadow: '0 2px 12px ' + DS.t.blue + '33',
    });
    if (user.avatar) {
      av.style.backgroundImage = 'url(' + user.avatar + ')';
      av.style.backgroundSize  = 'cover';
    } else {
      av.textContent = initials(user);
    }
    greetRow.appendChild(av);
    page.appendChild(greetRow);

    /* ──────────── b) Hero summary ──────────── */
    const heroWrap = el('div', { className: 'home-hero-wrap' });
    Object.assign(heroWrap.style, { ...anim(), marginBottom: '4px' });
    heroWrap.appendChild(renderHomeHero(role, { active: 0, today: 0, mail: 0, notif: 0 }));
    page.appendChild(heroWrap);

    /* ──────────── c) Quick Actions ──────────── */
    const actions = QA[role] || QA.TO;
    const qaEl = M.QuickActions({
      items: actions.map(label => ({
        label,
        icon: QA_ICONS[label] || null,
        onClick: () => {
          const r = ROUTES[label];
          if (r) safeNavigate(r, label + ' появится после следующей серверной сессии');
          else   M.Toast({ message: label + ' — скоро', type: 'info' });
        },
      })),
    });
    Object.assign(qaEl.style, anim());
    page.appendChild(qaEl);

    /* ──────────── d) Stats (2×2 grid) ──────────── */
    const statsWrap = el('div', { className: 'home-stats-wrap' });
    Object.assign(statsWrap.style, { ...anim(), marginTop: '8px' });

    /* skeleton stats first */
    const statsSkel = M.Skeleton({ type: 'stats' });
    statsWrap.appendChild(statsSkel);
    page.appendChild(statsWrap);

    /* ──────────── e) Deadlines section ──────────── */
    const dlWrap = el('div', { className: 'home-dl-wrap' });
    const dlSkel = M.Skeleton({ type: 'list', count: 3 });
    dlWrap.appendChild(dlSkel);

    const dlSection = M.Section({
      title: 'Ближайшие дедлайны',
      content: dlWrap,
      action: { label: 'Все', onClick: () => safeNavigate('/tasks', 'Раздел задач будет открыт после следующей сессии') },
    });
    Object.assign(dlSection.style, anim());
    page.appendChild(dlSection);

    /* ──────────── f) Notifications section ──────────── */
    const nWrap = el('div', { className: 'home-notif-wrap' });
    const nSkel = M.Skeleton({ type: 'list', count: 3 });
    nWrap.appendChild(nSkel);

    const nSection = M.Section({
      title: 'Последние уведомления',
      content: nWrap,
      action: { label: 'Все', onClick: () => safeNavigate('/alerts', 'Экран уведомлений войдёт в следующую серверную сессию') },
    });
    Object.assign(nSection.style, anim());
    page.appendChild(nSection);

    /* ──────────── g) Mimir Banner ──────────── */
    const mimir = M.MimirBanner({
      title: 'Мимир',
      text: 'Анализирую данные…',
    });
    Object.assign(mimir.style, anim());
    page.appendChild(mimir);

    /* ──────────── Async data loading (parallel) ──────────── */
    HomePage._loadAll(role, heroWrap, statsWrap, statsSkel, dlWrap, dlSkel, nWrap, nSkel, mimir);

    return page;
  },

  /* ---- parallel data load ---- */
  async _loadAll(role, heroWrap, statsWrap, statsSkel, dlWrap, dlSkel, nWrap, nSkel, mimir) {
    const [statsR, dlR, notifR, mimirR] = await Promise.allSettled([
      HomePage._fetchStats(role),
      API.fetch('/tasks/deadlines?limit=3').catch(() => null),
      API.fetch('/notifications?limit=3').catch(() => null),
      API.fetch('/mimir/tip?context=home&role=' + role).catch(() => null),
    ]);

    /* stats */
    const s = statsR.status === 'fulfilled' ? statsR.value : {};
    heroWrap.innerHTML = '';
    heroWrap.appendChild(renderHomeHero(role, s));
    statsWrap.innerHTML = '';
    statsWrap.appendChild(M.Stats({
      items: [
        { label: 'Активные',     value: s.active  ?? 0, color: 'blue'  },
        { label: 'На сегодня',   value: s.today   ?? 0, color: 'green' },
        { label: 'Письма',       value: s.mail    ?? 0, color: 'gold'  },
        { label: 'Уведомления',  value: s.notif   ?? 0, color: 'red'   },
      ],
    }));

    /* deadlines */
    const dlItems = HomePage._extractItems(dlR);
    dlWrap.innerHTML = '';
    if (dlItems.length) {
      dlWrap.appendChild(M.List({
        items: dlItems,
        renderItem: (it, i) => M.Card({
          title:      it.title || it.name || 'Задача',
          subtitle:   it.project_name || '',
          badge:      it.deadline ? Utils.formatDate(new Date(it.deadline), 'short') : '',
          badgeColor: deadlineColor(it.deadline),
          arrow:      !!(Router.has && Router.has('/tasks') && it.id),
          href:       (Router.has && Router.has('/tasks') && it.id) ? '/tasks/' + it.id : null,
          onClick:    !(Router.has && Router.has('/tasks')) ? () => M.Toast({ message: 'Карточка задачи откроется после следующей серверной сессии', type: 'info' }) : undefined,
          animDelay:  Math.min(i * 0.04, 0.2),
        }),
      }));
    } else {
      dlWrap.appendChild(M.Empty({ text: 'Нет ближайших дедлайнов' }));
    }

    /* notifications */
    const nItems = HomePage._extractItems(notifR);
    nWrap.innerHTML = '';
    if (nItems.length) {
      nWrap.appendChild(M.List({
        items: nItems,
        renderItem: (it, i) => M.Card({
          title:     it.title || it.message || 'Уведомление',
          subtitle:  it.created_at ? Utils.formatDate(new Date(it.created_at), 'relative') : '',
          animDelay: Math.min(i * 0.04, 0.2),
        }),
      }));
    } else {
      nWrap.appendChild(M.Empty({ text: 'Нет новых уведомлений' }));
    }

    /* mimir */
    const tip = mimirR.status === 'fulfilled' && mimirR.value?.text
      ? mimirR.value.text
      : HomePage._fallbackTip(role);
    const mimirText = mimir.querySelector('.mimir-text') || mimir.querySelector('p');
    if (mimirText) mimirText.textContent = tip;
  },

  async _fetchStats(role) {
    const [dashR, mailR, notifR] = await Promise.allSettled([
      API.fetch('/dashboard/stats'),
      API.fetch('/mail/unread-count'),
      API.fetch('/notifications/unread-count'),
    ]);
    const dash  = dashR.status  === 'fulfilled' ? dashR.value  : {};
    const mail  = mailR.status  === 'fulfilled' ? mailR.value  : {};
    const notif = notifR.status === 'fulfilled' ? notifR.value : {};
    return {
      active: dash.active ?? dash.total ?? 0,
      today:  dash.today  ?? dash.tasks_today ?? 0,
      mail:   mail.count  ?? mail.unread ?? 0,
      notif:  notif.count ?? notif.unread ?? 0,
    };
  },

  _extractItems(result) {
    if (result.status !== 'fulfilled' || !result.value) return [];
    const v = result.value;
    return Array.isArray(v) ? v : (v.items || v.data || []);
  },

  _fallbackTip(role) {
    const tips = {
      TO: 'Проверьте новые тендеры и приближающиеся дедлайны',
      PM: 'Убедитесь, что все работы идут по графику',
      ADMIN: 'Обзор системы: все показатели в норме',
      HR: 'Не забудьте проверить графики сотрудников',
      BUH: 'Сверьте расчёты за текущую неделю',
    };
    return tips[role] || 'Добро пожаловать в ASGARD. Хорошего рабочего дня!';
  },
};

window.HomePage = HomePage;
})();
