// Скриншот блока «Действия» в реестре счетов (premium-иконки) + проверки.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const OUT = 'tests/reports/doc-hub-premium';
fs.mkdirSync(OUT, { recursive: true });

async function login(ctx, l, p) {
  const r = await ctx.request.post(BASE + '/api/auth/login', { data: { login: l, password: p } });
  const j = await r.json(); let t = j.token;
  if (j.status === 'need_pin' || j.need_pin) {
    for (const pin of ['0000', '1234', '1111']) {
      const r2 = await ctx.request.post(BASE + '/api/auth/verify-pin', { headers: { Authorization: 'Bearer ' + t }, data: { pin } });
      const j2 = await r2.json().catch(() => ({}));
      if (j2.token) { t = j2.token; break; }
    }
  }
  return t;
}

(async () => {
  const b = await chromium.launch();
  const rep = [];
  for (const theme of ['dark', 'light']) {
    const ctx = await b.newContext({ viewport: { width: 1700, height: 950 } });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message.slice(0, 120)));
    await p.goto(BASE + '/', { waitUntil: 'commit' });
    await p.waitForTimeout(1200);
    const t = await login(ctx, 'test_admin', 'Test123!');
    await p.evaluate((tk) => localStorage.setItem('asgard_token', tk), t);
    await p.evaluate((th) => { try { localStorage.setItem('asgard_theme', th); } catch (_) {} document.documentElement.dataset.theme = th; }, theme);
    await p.goto(BASE + '/#/doc-hub', { waitUntil: 'commit' });
    await p.reload({ waitUntil: 'commit' });
    await p.waitForSelector('.dh-qa button, .dh-empty', { timeout: 25000 }).catch(() => {});
    await p.waitForTimeout(2000);
    const info = await p.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('.dh-qa button'));
      const svg = btns.filter((b) => b.querySelector('svg')).length;
      const lbl = document.querySelectorAll('.dh-qa .lbl').length;
      const emoji = btns.filter((b) => /[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u.test(b.textContent || '')).length;
      const txt = btns.map((b) => (b.textContent || '').trim()).filter(Boolean);
      const cs = btns[0] ? getComputedStyle(btns[0]) : null;
      return {
        buttons: btns.length, withSvg: svg, withLbl: lbl, withEmoji: emoji,
        leftoverText: txt.slice(0, 8),
        w: cs ? cs.width : null, h: cs ? cs.height : null,
        rows: document.querySelectorAll('.dh-table--rich tbody tr[data-id]').length
      };
    });
    await p.screenshot({ path: `${OUT}/actions-${theme}.png`, clip: { x: 900, y: 150, width: 780, height: 620 } }).catch(() => {});
    await p.screenshot({ path: `${OUT}/doc-hub-${theme}.png`, fullPage: false });
    rep.push({ theme, ...info, jsErrors: errs.length });
    await ctx.close();
  }
  await b.close();
  fs.writeFileSync(`${OUT}/actions-audit.json`, JSON.stringify(rep, null, 2));
  for (const r of rep) console.log(`[${r.theme}] кнопок=${r.buttons} svg=${r.withSvg} подписей=${r.withLbl} эмодзи=${r.withEmoji} размер=${r.w}×${r.h} строк=${r.rows} jsErr=${r.jsErrors} leftover=${JSON.stringify(r.leftoverText)}`);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
