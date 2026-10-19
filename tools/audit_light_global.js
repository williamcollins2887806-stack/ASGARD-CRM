'use strict';
/**
 * Глобальная диагностика светлой темы (вся CRM, не только главная):
 *  1) кнопки с «дешёвым» градиентом;
 *  2) иконки сайдбара (белые на белом);
 *  3) элементы с backdrop-filter (где стекло уже есть);
 *  4) мелкий текст (< 12px) — кандидаты на подъём кегля.
 */
const { chromium } = require('playwright');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';

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
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05;
  };

  // 1. Градиентные кнопки
  const gradBtns = [];
  document.querySelectorAll('button, .btn, a.btn, [role="button"]').forEach((el) => {
    if (!visible(el)) return;
    const cs = getComputedStyle(el);
    if (/gradient/.test(cs.backgroundImage)) {
      gradBtns.push({
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 60),
        text: (el.textContent || '').trim().slice(0, 24),
        img: cs.backgroundImage.slice(0, 110)
      });
    }
  });

  // 2. Иконки сайдбара
  const iconReport = [];
  document.querySelectorAll('.sidenav .navitem .ico, .sidenav svg, .sidenav img, .sidenav .nav-icon').forEach((el) => {
    if (!visible(el)) return;
    const cs = getComputedStyle(el);
    if (cs.color === 'rgb(255, 255, 255)' || cs.fill === 'rgb(255, 255, 255)') {
      iconReport.push({
        tag: el.tagName,
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 40),
        color: cs.color, fill: cs.fill, stroke: cs.stroke
      });
    }
  });

  // 3. Стекло
  const glass = [];
  document.querySelectorAll('.topbar, .sidenav, .dash-widget-v2, .card, .panel, .modal-content, .cr-m').forEach((el) => {
    if (!visible(el)) return;
    const cs = getComputedStyle(el);
    if (cs.backdropFilter && cs.backdropFilter !== 'none') {
      glass.push({ cls: (typeof el.className === 'string' ? el.className : '').slice(0, 40), filter: cs.backdropFilter });
    }
  });

  // 4. Мелкий текст
  const small = {};
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const t = w.currentNode;
    if ((t.nodeValue || '').trim().length < 2) continue;
    const el = t.parentElement;
    if (!el || !visible(el) || el.closest('svg')) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size > 0 && size < 12) {
      const key = size + 'px';
      small[key] = (small[key] || 0) + 1;
    }
  }

  return { gradBtns: gradBtns.slice(0, 12), icons: iconReport.slice(0, 12), glass: glass.slice(0, 10), small };
};

(async () => {
  const d = await apiLogin();
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1440, height: 980 } });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([t, u]) => {
    localStorage.setItem('asgard_token', t); localStorage.setItem('auth_token', t);
    localStorage.setItem('asgard_user', JSON.stringify(u)); localStorage.setItem('asgard_theme', 'light');
    for (const k of ['asgard_shell_banner_dismissed', 'cr_modal_seen', 'asgard_v2_banner_dismissed']) localStorage.setItem(k, '1');
  }, [d.token, d.user || {}]);

  for (const url of ['/', '/personnel', '/tenders']) {
    await page.goto(BASE + '/' + (url === '/' ? '' : '#' + url), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5500);
    let r;
    try { r = await page.evaluate(PROBE); } catch (e) { console.log('\n######## ' + url + ' — навигация, пропуск'); continue; }
    console.log('\n######## ' + url);
    console.log('градиентные кнопки: ' + r.gradBtns.length);
    r.gradBtns.forEach((x) => console.log('   [' + x.text + '] .' + x.cls + '  ' + x.img));
    console.log('белые иконки сайдбара: ' + r.icons.length);
    r.icons.slice(0, 6).forEach((x) => console.log('   ' + x.tag + ' .' + x.cls + ' color=' + x.color + ' fill=' + x.fill));
    console.log('стекло: ' + JSON.stringify(r.glass.map((g) => g.cls + ':' + g.filter)));
    console.log('мелкий текст: ' + JSON.stringify(r.small));
  }
  await b.close();
})();
