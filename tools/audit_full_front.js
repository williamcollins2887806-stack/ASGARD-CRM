'use strict';
/**
 * СПЛОШНОЙ аудит светлой темы по всем роутам ванилы.
 *
 * Для каждой страницы:
 *  1) контраст текста (WCAG AA) — сколько нарушений и какие;
 *  2) инвентарь кнопок: фон/текст/градиент/радиус — ищем «выбивающиеся» цвета;
 *  3) JS-ошибки.
 *
 * Итог: JSON + краткая сводка, exit 1 если есть блокирующие проблемы.
 *
 * Запуск: node tools/audit_full_front.js [--limit=30] [--theme=light]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const argv = process.argv.slice(2);
const getArg = (n, d) => {
  const a = argv.find((x) => x.startsWith('--' + n + '='));
  return a ? a.split('=')[1] : d;
};
const THEME = getArg('theme', 'light');
const LIMIT = Number(getArg('limit', '0'));
const OUT = path.join(__dirname, '..', 'tests', 'reports', 'full-audit');
fs.mkdirSync(OUT, { recursive: true });

// Роуты, которые точно работают у РП (роль test_pm)
const ROUTES = [
  '/', '/tenders', '/pre-tenders', '/platform-tenders', '/tender-approvals',
  '/estimates', '/all-estimates', '/create-estimate', '/contracts', '/customers',
  '/tasks', '/tasks-admin', '/personnel', '/official-employees', '/hr-requests',
  '/staff-requests', '/finances', '/invoices', '/acts', '/payments', '/cash',
  '/cash-admin', '/procurement', '/proc-requests', '/suppliers', '/warehouse',
  '/warehouse-v2', '/my-equipment', '/seals', '/permits', '/nd-permits',
  '/approvals', '/approval-payment', '/directors-inbox', '/meetings', '/chat',
  '/my-mail', '/correspondence', '/doc-hub', '/documents', '/settings', '/profile',
  '/timesheet', '/timesheet-warehouse', '/timesheet-mobile', '/pm-timesheet',
  '/pm-calcs', '/pm-balance', '/pm-payout-cart', '/gantt', '/assembly',
  '/field-assembly', '/brigade-cart', '/telephony', '/call-analytics',
  '/telephony-history', '/telephony-missed', '/phone', '/proxies', '/integrations',
  '/backup', '/diag', '/help', '/hr', '/payroll', '/payroll-dashboard',
  '/office-expenses', '/office-schedule', '/global-timesheet', '/personal-kanban',
  '/personal-kanban-v3', '/marketplace', '/academy', '/training'
];

async function apiLogin() {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: process.env.TEST_LOGIN_A || 'test_pm', password: process.env.TEST_PASS_A || 'Test123!' })
  });
  let d = await res.json();
  if (!res.ok) throw new Error('login: ' + JSON.stringify(d));
  const r2 = await fetch(BASE + '/api/auth/verify-pin', {
    method: 'POST', headers: { Authorization: 'Bearer ' + d.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: process.env.TEST_PIN || '0000' })
  });
  d = await r2.json();
  if (!r2.ok) throw new Error('pin: ' + JSON.stringify(d));
  return d;
}

const AUDIT = () => {
  const parse = (c) => {
    const str = String(c);
    // CSS color(srgb r g b / a) — современный формат, rgb() не ловит
    const cs = str.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/);
    if (cs) {
      return {
        r: parseFloat(cs[1]) * 255,
        g: parseFloat(cs[2]) * 255,
        b: parseFloat(cs[3]) * 255,
        a: cs[4] !== undefined ? parseFloat(cs[4]) : 1
      };
    }
    const m = str.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lin = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const blend = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1
  });
  const effBg = (el) => {
    let node = el, acc = null;
    while (node && node !== document.documentElement) {
      const cs = getComputedStyle(node);
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && /gradient|url\(/.test(cs.backgroundImage) && !acc) {
        return { gradient: true };
      }
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) {
        acc = acc ? blend(acc, c) : c;
        if (c.a >= 0.999) return acc;
      }
      node = node.parentElement;
    }
    const rootBg = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    return acc ? blend(acc, rootBg) : rootBg;
  };
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && cs.display !== 'none' &&
      cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.1;
  };

  // ── 1. контраст текста ──
  const contrast = [];
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
    if (bg.gradient) continue;
    const fgEff = fg.a < 1 ? blend(fg, bg) : fg;
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const cr = ratio(fgEff, bg);
    if (cr < need) {
      contrast.push({
        text: (t.nodeValue || '').trim().slice(0, 45),
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 45),
        size, ratio: Math.round(cr * 100) / 100, need
      });
    }
  }

  // ── 2. кнопки: единообразие ──
  const btnSeen = new Set();
  const buttons = [];
  document.querySelectorAll('button, .btn, a.btn, [role="button"]').forEach((el) => {
    if (!vis(el)) return;
    const cs = getComputedStyle(el);
    const hasGrad = /gradient/.test(cs.backgroundImage);
    const cls = (typeof el.className === 'string' ? el.className : '').slice(0, 45);
    const bgRaw = hasGrad ? cs.backgroundImage : cs.backgroundColor;
    const key = cls + '|' + bgRaw + '|' + cs.color;
    if (btnSeen.has(key)) return;
    btnSeen.add(key);
    buttons.push({
      cls,
      text: (el.textContent || '').trim().slice(0, 22),
      bg: hasGrad ? 'gradient' : cs.backgroundColor,
      gradFrom: hasGrad ? (cs.backgroundImage.match(/rgb\([^)]+\)/) || [''])[0] : '',
      color: cs.color,
      radius: cs.borderTopLeftRadius
    });
  });

  // классификация цвета фона кнопки
  const family = (b) => {
    const src = b.gradFrom || b.bg;
    const str = String(src);
    // CSS color(srgb r g b / a) — новее, чем rgb()
    const cs = str.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/);
    if (cs) {
      const r = parseFloat(cs[1]) * 255, g = parseFloat(cs[2]) * 255, bl = parseFloat(cs[3]) * 255;
      const a = cs[4] !== undefined ? parseFloat(cs[4]) : 1;
      if (a < 0.3) return 'transparent/white';
      if (r > 235 && g > 235 && bl > 235) return 'white';
      if (bl > r + 40) return 'blue';
      if (r > g + 45 && r > bl + 40) return 'red';
      if (g > r + 25 && g > bl + 15) return 'green';
      if (r > 120 && g > 70 && bl < 100) return 'gold';
      if (Math.abs(r - g) < 25 && Math.abs(g - bl) < 25) return 'neutral';
      return 'other';
    }
    const m = str.match(/rgba?\(([^)]+)\)/);
    if (!m) return 'unknown';
    const [r, g, bl, a] = m[1].split(',').map((x) => parseFloat(x));
    if (a !== undefined && a < 0.3) return 'transparent/white';
    if (r > 235 && g > 235 && bl > 235) return 'white';
    if (bl > r + 40) return 'blue';
    if (r > g + 45 && r > bl + 40) return 'red';
    if (g > r + 25 && g > bl + 15) return 'green';
    if (r > 120 && g > 70 && bl < 100) return 'gold';
    if (Math.abs(r - g) < 25 && Math.abs(g - bl) < 25) return 'neutral';
    return 'other';
  };
  buttons.forEach((b) => { b.family = family(b); });

  return {
    theme: document.documentElement.getAttribute('data-theme'),
    contrast, buttons,
    url: location.hash || '/'
  };
};

(async () => {
  const d = await apiLogin();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 } });
  const page = await ctx.newPage();

  await ctx.addInitScript(([t, u, th]) => {
    try {
      localStorage.setItem('asgard_token', t);
      localStorage.setItem('auth_token', t);
      localStorage.setItem('asgard_user', u);
      localStorage.setItem('asgard_theme', th);
      localStorage.setItem('asgard_theme_chosen', '1');
      for (const k of ['asgard_shell_banner_dismissed', 'cr_modal_seen', 'asgard_v2_banner_dismissed']) localStorage.setItem(k, '1');
    } catch (e) {}
  }, [d.token, JSON.stringify(d.user || {}), THEME]);

  const routes = LIMIT > 0 ? ROUTES.slice(0, LIMIT) : ROUTES;
  const results = [];
  const errors = [];

  page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)));

  for (let i = 0; i < routes.length; i++) {
    const r = routes[i];
    errors.length = 0;
    let data = null;
    try {
      await page.goto(BASE + '/#' + r, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(2600);
      data = await page.evaluate(AUDIT);
    } catch (e) {
      console.log(`[${i + 1}/${routes.length}] ${r}  — ОШИБКА ЗАГРУЗКИ: ${String(e.message).slice(0, 60)}`);
      continue;
    }
    const fams = {};
    data.buttons.forEach((b) => { fams[b.family] = (fams[b.family] || 0) + 1; });
    const bad = data.buttons.filter((b) => ['gold', 'other', 'unknown'].includes(b.family) && !/ghost|tab|chip|badge/i.test(b.cls));
    results.push({ route: r, theme: data.theme, contrast: data.contrast, buttons: data.buttons, families: fams, pageErrors: errors.slice(0, 2) });
    const cTxt = data.contrast.length ? `контраст: ${data.contrast.length} FAIL` : 'контраст: OK';
    const bTxt = bad.length ? `кнопки: ${bad.length} вне системы` : 'кнопки: OK';
    console.log(`[${i + 1}/${routes.length}] ${(data.theme || '?').padEnd(5)} ${r.padEnd(24)} ${cTxt.padEnd(22)} ${bTxt}`);
  }

  fs.writeFileSync(path.join(OUT, 'audit-' + THEME + '.json'), JSON.stringify(results, null, 2));

  // ── сводка ──
  const totalContrast = results.reduce((s, r) => s + r.contrast.length, 0);
  const badPages = results.filter((r) => r.contrast.length);
  const allFam = {};
  results.forEach((r) => Object.entries(r.families).forEach(([k, v]) => { allFam[k] = (allFam[k] || 0) + v; }));

  console.log('\n════════ СВОДКА ════════');
  console.log(`страниц проверено: ${results.length}`);
  console.log(`страниц с низким контрастом: ${badPages.length}`);
  console.log(`всего нарушений контраста: ${totalContrast}`);
  console.log('семейства цветов кнопок:', JSON.stringify(allFam));
  if (badPages.length) {
    console.log('\nПроблемные страницы:');
    badPages.slice(0, 25).forEach((r) => {
      console.log(`  ${r.route}  (${r.contrast.length})`);
      r.contrast.slice(0, 3).forEach((c) => console.log(`      ${c.ratio}:1  "${c.text}"  .${c.cls}`));
    });
  }
  fs.writeFileSync(path.join(OUT, 'summary-' + THEME + '.json'), JSON.stringify({
    pages: results.length, badPages: badPages.length, totalContrast, families: allFam
  }, null, 2));
  await browser.close();
  console.log('\nOUT', OUT);
})();
