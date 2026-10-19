'use strict';
/**
 * Живая проверка прода ПОСЛЕ логина: гейт присутствия, контраст, кнопки.
 * Использует тестовую учётку на проде (если есть) — иначе только публичная часть.
 */
const { chromium } = require('playwright');

const PROD = process.env.PROD_URL || 'https://92.242.61.184';
const LOGIN = process.env.PROD_LOGIN || 'test_pm';
const PASS = process.env.PROD_PASS || 'Test123!';
const PIN = process.env.PROD_PIN || '0000';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));

  // логин через API напрямую
  const login = await page.evaluate(async ([url, l, p, pin]) => {
    try {
      const r1 = await fetch(url + '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: l, password: p })
      });
      let d = await r1.json();
      if (!r1.ok) return { ok: false, step: 'login', body: d };
      if (d.status === 'need_pin' || d.pinVerified === false) {
        const r2 = await fetch(url + '/api/auth/verify-pin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + d.token },
          body: JSON.stringify({ pin })
        });
        d = await r2.json();
        if (!r2.ok) return { ok: false, step: 'pin', body: d };
      }
      localStorage.setItem('asgard_token', d.token);
      localStorage.setItem('auth_token', d.token);
      if (d.user) localStorage.setItem('asgard_user', JSON.stringify(d.user));
      localStorage.setItem('asgard_theme', 'light');
      localStorage.setItem('asgard_theme_chosen', '1');
      for (const k of ['asgard_shell_banner_dismissed', 'cr_modal_seen', 'asgard_v2_banner_dismissed']) localStorage.setItem(k, '1');
      return { ok: true, user: d.user && (d.user.login || d.user.name) };
    } catch (e) {
      return { ok: false, step: 'exception', body: String(e) };
    }
  }, [PROD, LOGIN, PASS, PIN]);
  console.log('login:', JSON.stringify(login));

  await page.goto(PROD + '/#/home', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(7000);

  const res = await page.evaluate(() => {
    const txt = document.body.innerText;
    const moji = (txt.match(/[\u2568\u2564\u2565]/g) || []).length;
    const fffd = (txt.match(/\ufffd/g) || []).length;
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      version: window.ASGARD_SHELL_VERSION || '—',
      moji, fffd,
      // гейт присутствия содержит эти слова
      hasGate: /рабочую неделю|держать строй|В офисе|выбери/i.test(txt),
      gateSample: (txt.match(/[^\n]*(рабочую неделю|держать строй)[^\n]*/i) || [''])[0].slice(0, 100),
      widgets: document.querySelectorAll('.dash-widget-v2').length,
      title: (document.querySelector('.dash-head-title') || {}).textContent || ''
    };
  });
  console.log('\n=== после логина:');
  console.log(JSON.stringify(res, null, 1));

  // контраст
  const contrast = await page.evaluate(() => {
    const parse = (c) => {
      const str = String(c);
      const cs = str.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/);
      if (cs) return { r: +cs[1] * 255, g: +cs[2] * 255, b: +cs[3] * 255, a: cs[4] !== undefined ? +cs[4] : 1 };
      const m = str.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(',').map((x) => parseFloat(x.trim()));
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const lin = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
    const blend = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
    const effBg = (el) => {
      let node = el, acc = null;
      while (node && node !== document.documentElement) {
        const cs = getComputedStyle(node);
        if (cs.backgroundImage !== 'none' && /gradient/.test(cs.backgroundImage) && !acc) return { grad: true };
        const c = parse(cs.backgroundColor);
        if (c && c.a > 0) { acc = acc ? blend(acc, c) : c; if (c.a >= 0.999) return acc; }
        node = node.parentElement;
      }
      return acc || { r: 255, g: 255, b: 255, a: 1 };
    };
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && cs.display !== 'none' && cs.visibility !== 'hidden';
    };
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const t = w.currentNode;
      if ((t.nodeValue || '').trim().length < 2) continue;
      const el = t.parentElement;
      if (!el || !vis(el) || el.closest('svg')) continue;
      const cs = getComputedStyle(el);
      const fg = parse(cs.color);
      if (!fg) continue;
      const bg = effBg(el);
      if (bg.grad) continue;
      const f = fg.a < 1 ? blend(fg, bg) : fg;
      const size = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight, 10) || 400;
      const need = (size >= 24 || (size >= 18.66 && weight >= 700)) ? 3 : 4.5;
      const cr = ratio(f, bg);
      if (cr < need) out.push({ text: (t.nodeValue || '').trim().slice(0, 36), cls: String(el.className).slice(0, 36), ratio: Math.round(cr * 100) / 100 });
    }
    return out;
  });
  console.log('\n=== контраст (нарушений):', contrast.length);
  contrast.slice(0, 8).forEach((c) => console.log(`   ${c.ratio}:1 "${c.text}" .${c.cls}`));

  await page.screenshot({ path: 'tests/reports/full-audit/prod-home-light.png' });
  console.log('JS-ошибки:', errors.length);
  await browser.close();
})();
