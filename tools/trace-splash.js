/**
 * Точная диагностика заставки во времени: присутствие, стадия, девиз, прогресс.
 * Тормозим только /api/auth/me, чтобы bootstrap не завершался.
 */
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:5199/m/';

const probe = (p) => p.evaluate(() => {
  const s = document.querySelector('[aria-label="ASGARD CRM загружается"]');
  if (!s) return { up: false };
  const txt = s.innerText || '';
  const q = (txt.match(/Терпение[^\n]*|Хугин[^\n]*|Сила[^\n]*|Медленно[^\n]*|Путь[^\n]*|Кто ждёт[^\n]*/)) || [];
  const pctm = txt.match(/(\d+)%/);
  return { up: true, quote: q[0] || null, pct: pctm ? pctm[1] : null, logo: !!s.querySelector('img[src*="asgard-logo"]') };
});

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.route('**/api/auth/me**', (route) => setTimeout(() => route.abort(), 20000));
  await p.goto(URL, { waitUntil: 'commit', timeout: 60000 });

  const t0 = Date.now();
  for (const at of [200, 700, 1200, 1700, 2300, 2900, 3500, 4100]) {
    const w = at - (Date.now() - t0);
    if (w > 0) await p.waitForTimeout(w);
    const r = await probe(p);
    console.log(`${String(at).padStart(5)}ms  up=${r.up ? 'да ' : 'НЕТ'}  pct=${r.pct || '-'}  logo=${r.logo || '-'}  quote=${JSON.stringify(r.quote)}`);
  }
  await b.close();
})();
