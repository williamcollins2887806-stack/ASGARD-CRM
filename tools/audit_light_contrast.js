'use strict';
/**
 * Аудит контраста текста в светлой теме на реальных страницах (WCAG 2.1 AA).
 * Для каждого видимого текстового узла: поднимаемся по родителям до первого
 * непрозрачного фона, считаем relative luminance и ratio.
 *
 * Запуск: node tools/audit_light_contrast.js [--theme light|dark] [--pages /,/tenders]
 */
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const LOGIN = process.env.TEST_LOGIN_A || 'test_pm';
const PASS = process.env.TEST_PASS_A || 'Test123!';
const PIN = process.env.TEST_PIN || '0000';

const argv = process.argv.slice(2);
const getArg = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const THEME = getArg('--theme', 'light');
const PAGES = getArg('--pages', '/').split(',');

async function apiLogin() {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, password: PASS })
  });
  let d = await res.json();
  if (!res.ok) throw new Error('login: ' + JSON.stringify(d));
  if (d.status === 'need_pin' || d.pinVerified === false) {
    res = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + d.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: PIN })
    });
    d = await res.json();
    if (!res.ok) throw new Error('pin: ' + JSON.stringify(d));
  }
  return { token: d.token, user: d.user || {} };
}

const AUDIT = () => {
  const parse = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const blend = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1
  });
  const effectiveBg = (el) => {
    let node = el;
    let acc = null;
    while (node && node !== document.documentElement) {
      const cs = getComputedStyle(node);
      // Градиент/картинка на элементе: цвет фона прозрачный, но реальный фон
      // непрозрачный — считать такие узлы «ручной проверкой», не нарушением.
      if (cs.backgroundImage && cs.backgroundImage !== 'none' &&
          /gradient|url\(/.test(cs.backgroundImage) && !acc) {
        return { gradient: true };
      }
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) {
        const layer = acc ? blend(acc, c) : c;
        acc = layer;
        if (c.a >= 0.999) return acc;
      }
      node = node.parentElement;
    }
    const rootBg = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    return acc ? blend(acc, rootBg) : rootBg;
  };

  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode;
    const text = (t.nodeValue || '').trim();
    if (text.length < 2) continue;
    const el = t.parentElement;
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.1) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    if (el.closest('svg')) continue;

    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = effectiveBg(el);
    if (bg.gradient) continue; // фон задан градиентом — визуально проверяем отдельно
    const fgEff = fg.a < 1 ? blend(fg, bg) : fg;
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const cr = ratio(fgEff, bg);
    if (cr < need) {
      out.push({
        text: text.slice(0, 60),
        cls: (el.className && typeof el.className === 'string' ? el.className : '').slice(0, 70),
        size, weight,
        color: `rgb(${Math.round(fgEff.r)},${Math.round(fgEff.g)},${Math.round(fgEff.b)})`,
        bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
        ratio: Math.round(cr * 100) / 100,
        need
      });
    }
  }
  return out;
};

(async () => {
  const { token, user } = await apiLogin();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([t, u, th]) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('auth_token', t);
    localStorage.setItem('asgard_user', JSON.stringify(u));
    localStorage.setItem('asgard_theme', th);
    for (const k of ['asgard_shell_banner_dismissed', 'cr_modal_seen', 'asgard_v2_banner_dismissed']) localStorage.setItem(k, '1');
  }, [token, user, THEME]);

  let total = 0;
  const report = {};
  for (const url of PAGES) {
    errors.length = 0;
    await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(() => {
      document.querySelectorAll('#asgard-presence-gate,#asgard-splash,.cr-m-overlay,.modalback,#sg-overlay').forEach((el) => {
        el.style.setProperty('display', 'none', 'important');
      });
    });
    await page.waitForTimeout(2200);
    const fails = await page.evaluate(AUDIT);
    report[url] = { count: fails.length, fails: fails.slice(0, 40), errors: errors.slice(0, 3) };
    total += fails.length;
    console.log(`${url}  theme=${THEME}  низкий контраст: ${fails.length}`);
    for (const f of fails.slice(0, 12)) {
      console.log(`   ${f.ratio} (need ${f.need})  ${f.size}px/${f.weight}  "${f.text}"  .${f.cls}`);
    }
  }
  console.log('ИТОГО нарушений:', total);
  require('fs').writeFileSync('tests/reports/light-contrast-' + THEME + '.json', JSON.stringify(report, null, 2));
  await browser.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
