'use strict';
// Все цветные акценты главной: чипы, бейджи, дни рождения, воронка, иконки.
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:3100';

async function apiLogin() {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'test_pm', password: 'Test123!' })
  });
  let d = await res.json();
  const r2 = await fetch(BASE + '/api/auth/verify-pin', {
    method: 'POST', headers: { Authorization: 'Bearer ' + d.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '0000' })
  });
  return r2.json();
}

const PROBE = () => {
  const grab = (sel, label) => {
    const el = document.querySelector(sel);
    if (!el) return `${label}: —`;
    const cs = getComputedStyle(el);
    return `${label}: color=${cs.color} bg=${cs.backgroundColor} bL=${cs.borderLeftColor}`;
  };
  // чипы маржа/оплата
  const chips = [...document.querySelectorAll('.dwr-chip')].slice(0, 4).map((el) => {
    const cs = getComputedStyle(el);
    return `${el.textContent.trim()} → ${cs.color} / ${cs.backgroundColor} / ${cs.borderTopColor}`;
  });
  // любые цветные полосы слева
  const strips = [...document.querySelectorAll('.dash-widget-v2, .dw-kpi-card, .dwr-chip, .bday-w .item')]
    .slice(0, 12).map((el) => {
      const cs = getComputedStyle(el);
      const c = cs.borderLeftColor;
      return `${el.className.split(' ')[0]}${el.dataset && el.dataset.cat ? '[cat=' + el.dataset.cat + ']' : ''}` +
        `${el.dataset && el.dataset.tone ? '[tone=' + el.dataset.tone + ']' : ''} → ${cs.borderLeftWidth} ${c}`;
    });
  return {
    theme: document.documentElement.dataset.theme,
    chips,
    strips,
    labels: [
      grab('.dash-head-title', 'заголовок Зал Ярла'),
      grab('.dw-label', 'метка виджета'),
      grab('.dwr-name', 'строка работы'),
      grab('.dw-kpi-num', 'KPI цифра'),
      grab('.dw-empty', 'пустое состояние'),
      grab('.dw-link', 'ссылка виджета'),
      grab('.navitem .lbl .name', 'пункт меню'),
      grab('.navitem .ico', 'иконка меню')
    ]
  };
};

(async () => {
  const d = await apiLogin();
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1440, height: 980 } });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([t, u]) => {
    localStorage.setItem('asgard_token', t); localStorage.setItem('auth_token', t);
    localStorage.setItem('asgard_user', JSON.stringify(u));
    for (const k of ['asgard_shell_banner_dismissed', 'cr_modal_seen', 'asgard_v2_banner_dismissed']) localStorage.setItem(k, '1');
  }, [d.token, d.user || {}]);

  for (const theme of ['dark', 'light']) {
    await page.evaluate((th) => localStorage.setItem('asgard_theme', th), theme);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    const r = await page.evaluate(PROBE);
    console.log('\n======== ' + theme.toUpperCase());
    console.log(r.labels.join('\n'));
    console.log('чипы:\n  ' + r.chips.join('\n  '));
    console.log('полосы:\n  ' + r.strips.join('\n  '));
  }
  await b.close();
})();
