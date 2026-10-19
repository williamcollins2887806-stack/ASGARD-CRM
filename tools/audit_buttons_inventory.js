'use strict';
/**
 * Инвентарь кнопок светлой темы по страницам:
 * классы, фон, градиент, цвет текста, тень. Нужен, чтобы увидеть
 * все «разные» кнопки и свести их к единой системе.
 *
 * Запуск: node tools/audit_buttons_inventory.js [--theme light|dark]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const THEME = (process.argv.find((a) => a.startsWith('--theme=')) || '--theme=light').split('=')[1];
const OUT = path.join(__dirname, '..', 'tests', 'reports', 'buttons');
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  '/', '/tenders', '/pre-tenders', '/tasks', '/personnel', '/finances',
  '/procurement', '/warehouse', '/estimates', '/contracts', '/approvals', '/settings'
];

async function apiLogin() {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'test_pm', password: 'Test123!' })
  });
  let d = await res.json();
  if (!res.ok) throw new Error('login: ' + JSON.stringify(d));
  const r2 = await fetch(BASE + '/api/auth/verify-pin', {
    method: 'POST', headers: { Authorization: 'Bearer ' + d.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '0000' })
  });
  d = await r2.json();
  return d;
}

const PROBE = () => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 2 && r.height > 2 && cs.display !== 'none' &&
      cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05;
  };
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
  const out = [];
  const seen = new Set();

  document.querySelectorAll('button, .btn, a.btn, [role="button"], input[type="submit"]').forEach((el) => {
    if (!vis(el)) return;
    const cs = getComputedStyle(el);
    const cls = typeof el.className === 'string' ? el.className : '';
    const text = norm(el.textContent).slice(0, 30);
    const key = cls + '|' + cs.backgroundColor + '|' + cs.backgroundImage.slice(0, 60);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      cls: cls.slice(0, 70),
      text,
      bg: cs.backgroundColor,
      img: cs.backgroundImage === 'none' ? '' : cs.backgroundImage.slice(0, 90),
      color: cs.color,
      border: cs.borderTopWidth + ' ' + cs.borderTopColor,
      shadow: cs.boxShadow === 'none' ? '' : cs.boxShadow.slice(0, 60),
      radius: cs.borderTopLeftRadius
    });
  });
  return out;
};

(async () => {
  const d = await apiLogin();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([t, u, th]) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('auth_token', t);
    localStorage.setItem('asgard_user', JSON.stringify(u));
    localStorage.setItem('asgard_theme', th);
    for (const k of ['asgard_shell_banner_dismissed', 'cr_modal_seen', 'asgard_v2_banner_dismissed']) localStorage.setItem(k, '1');
  }, [d.token, d.user || {}, THEME]);

  const all = [];
  for (const url of PAGES) {
    await page.goto(BASE + '/' + (url === '/' ? '' : '#' + url), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4200);
    let rows = [];
    try { rows = await page.evaluate(PROBE); } catch (e) { rows = []; }
    rows.forEach((r) => all.push({ page: url, ...r }));
    console.log(`${url}  кнопок (уникальных): ${rows.length}`);
  }

  fs.writeFileSync(path.join(OUT, 'inventory-' + THEME + '.json'), JSON.stringify(all, null, 2));

  // сводка по «цветовым семействам»
  const fam = {};
  for (const r of all) {
    let f = 'neutral';
    if (/gradient/.test(r.img)) f = 'gradient:' + r.img.replace(/linear-gradient\(|\)/g, '').slice(0, 40);
    else {
      const m = r.bg.match(/rgba?\(([^)]+)\)/);
      if (m) {
        const [rr, gg, bb, aa] = m[1].split(',').map((x) => parseFloat(x));
        if (aa !== undefined && aa < 0.35) f = 'transparent';
        else if (rr > gg + 40 && rr > bb + 40) f = 'red';
        else if (bb > rr + 40) f = 'blue';
        else if (gg > rr + 30 && gg > bb + 20) f = 'green';
        else if (rr > 140 && gg > 80 && bb < 90) f = 'gold/orange';
        else if (rr > 240 && gg > 240 && bb > 240) f = 'white';
      }
    }
    fam[f] = (fam[f] || 0) + 1;
  }
  console.log('\n=== семейства цветов (все страницы)');
  Object.entries(fam).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v.toString().padStart(3)}  ${k}`));

  console.log('\n=== примеры «не-sys» кнопок (gold/red/blue/градиент)');
  const weird = all.filter((r) => /gold\/orange|red|gradient|blue|green/.test(
    (() => {
      const m = r.bg.match(/rgba?\(([^)]+)\)/);
      if (/gradient/.test(r.img)) return 'gradient';
      if (!m) return '';
      const [rr, gg, bb] = m[1].split(',').map(Number);
      if (rr > 140 && gg > 80 && bb < 90) return 'gold/orange';
      if (rr > gg + 40 && rr > bb + 40) return 'red';
      if (bb > rr + 40) return 'blue';
      return '';
    })()
  )).slice(0, 55);
  weird.forEach((r) => {
    console.log(`  ${r.page.padEnd(14)} [${r.text.padEnd(22)}] .${r.cls.slice(0, 40)}`);
    console.log(`      bg=${r.bg}  img=${r.img}  color=${r.color}`);
  });
  console.log('\npage errors:', JSON.stringify(errors.slice(0, 4)));
  await browser.close();
  console.log('OUT', OUT);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
