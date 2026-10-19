'use strict';
/**
 * Сравнение акцентных элементов главной в двух темах.
 * Показывает, что именно теряется в светлой теме: левая полоса категории,
 * верхний градиент, цветная точка, цвет KPI-цифры, цвет иконки.
 */
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:3100';
const OUT = 'tests/reports/home-theme/accents';

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
  d = await r2.json();
  return d;
}

const PROBE = () => {
  const sw = (sel, el) => {
    if (!el) return { sel, missing: true };
    const cs = getComputedStyle(el);
    const before = getComputedStyle(el, '::before');
    return {
      sel,
      cat: el.getAttribute('data-cat'),
      borderLeft: `${cs.borderLeftWidth} ${cs.borderLeftStyle} ${cs.borderLeftColor}`,
      borderTop: `${cs.borderTopWidth} ${cs.borderTopColor}`,
      bg: cs.backgroundColor,
      beforeDisplay: before.display,
      beforeBg: before.backgroundImage.slice(0, 70),
      beforeH: before.height
    };
  };
  const widgets = [...document.querySelectorAll('.dash-widget-v2')].slice(0, 3)
    .map((el, i) => sw(`.dash-widget-v2[${i}] cat=${el.getAttribute('data-cat')}`, el));
  const dot = document.querySelector('.dw-cat-dot');
  const kpiNum = document.querySelector('.dw-kpi-num');
  const kpiCards = [...document.querySelectorAll('.dw-kpi-card')].slice(0, 4).map((el) => {
    const num = el.querySelector('.dw-kpi-num');
    const cs = num ? getComputedStyle(num) : null;
    return {
      tone: el.getAttribute('data-tone'),
      borderLeft: getComputedStyle(el).borderLeftColor,
      numColor: cs ? cs.color : null,
      numText: num ? num.textContent.trim().slice(0, 12) : null
    };
  });
  return {
    theme: document.documentElement.dataset.theme,
    widgets,
    dot: dot ? getComputedStyle(dot).backgroundColor : null,
    kpiNum: kpiNum ? getComputedStyle(kpiNum).color : null,
    kpiCards
  };
};

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const d = await apiLogin();
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1440, height: 980 } });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([t, u]) => {
    localStorage.setItem('asgard_token', t); localStorage.setItem('auth_token', t);
    localStorage.setItem('asgard_user', JSON.stringify(u));
    for (const k of ['asgard_shell_banner_dismissed', 'cr_modal_seen', 'asgard_v2_banner_dismissed']) localStorage.setItem(k, '1');
  }, [d.token, d.user || {}]);

  const result = {};
  for (const theme of ['dark', 'light']) {
    await page.evaluate((th) => localStorage.setItem('asgard_theme', th), theme);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6500);
    result[theme] = await page.evaluate(PROBE);
    await page.screenshot({ path: `${OUT}/home-${theme}.png`, fullPage: true });
  }
  require('fs').writeFileSync(`${OUT}/compare.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 1));
  await b.close();
})();
