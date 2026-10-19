'use strict';
/**
 * Визуальная проверка стекла на нескольких страницах + замеры:
 * фон/блур топбара, сайдбара, карточек, кнопок, цвет иконок, кегль.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:3100';
const OUT = path.join(__dirname, '..', 'tests', 'reports', 'glass');
fs.mkdirSync(OUT, { recursive: true });

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

const CHECK = () => {
  const g = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      bg: cs.backgroundColor,
      blur: cs.backdropFilter,
      border: cs.borderBottomColor,
      shadow: cs.boxShadow.slice(0, 60),
      w: Math.round(r.width), h: Math.round(r.height)
    };
  };
  const icon = (() => {
    const el = document.querySelector('.nav-group-header');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { color: cs.color };
  })();
  const btn = (() => {
    const el = document.getElementById('btnAddW');
    if (!el) return null;
    const cs = getComputedStyle(el);
    const af = getComputedStyle(el, '::after');
    return { bg: cs.backgroundColor, blur: cs.backdropFilter, afterContent: af.content, afterBg: af.backgroundImage.slice(0, 40) };
  })();
  const sizes = {};
  document.querySelectorAll('.dw-kpi-sub, .dw-label, .dash-head-meta, .muted').forEach((el) => {
    const s = getComputedStyle(el).fontSize;
    sizes[s] = (sizes[s] || 0) + 1;
  });
  return { topbar: g('.topbar'), sidenav: g('.sidenav'), card: g('.card, .dash-widget-v2'), icon, btn, sizes };
};

(async () => {
  const d = await apiLogin();
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([t, u]) => {
    localStorage.setItem('asgard_token', t); localStorage.setItem('auth_token', t);
    localStorage.setItem('asgard_user', JSON.stringify(u)); localStorage.setItem('asgard_theme', 'light');
    for (const k of ['asgard_shell_banner_dismissed', 'cr_modal_seen', 'asgard_v2_banner_dismissed']) localStorage.setItem(k, '1');
  }, [d.token, d.user || {}]);

  const pages = [['/', 'home'], ['/personnel', 'personnel'], ['/tenders', 'tenders'], ['/tasks', 'tasks']];
  for (const [url, name] of pages) {
    await page.goto(BASE + '/' + (url === '/' ? '' : '#' + url), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    await page.screenshot({ path: path.join(OUT, name + '-light.png'), fullPage: false });
    let r = null;
    try { r = await page.evaluate(CHECK); } catch (e) { /* навигация */ }
    console.log('\n### ' + url, JSON.stringify(r, null, 1));
  }
  console.log('\npage errors:', JSON.stringify(errs.slice(0, 5)));
  await b.close();
})();
