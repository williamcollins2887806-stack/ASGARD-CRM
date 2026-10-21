/**
 * Проверка девизов: (1) первый виден и читается на быстрой сети;
 * (2) при долгой загрузке сменяется. Тормозим ТОЛЬКО /api/auth/me —
 * статику и бандл не трогаем.
 */
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:5199/m/';

const readQuote = (p) => p.evaluate(() => {
  const s = document.querySelector('[aria-label="ASGARD CRM загружается"]');
  if (!s) return null;
  const m = (s.innerText || '').match(/Терпение[^\n]*|Хугин[^\n]*|Сила[^\n]*|Медленно[^\n]*|Путь[^\n]*|Кто ждёт[^\n]*/);
  return m ? m[0] : null;
});

(async () => {
  const b = await chromium.launch();

  // A. быстрая готовность
  const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'commit', timeout: 60000 });
  await p.waitForTimeout(1100);
  const a1 = await readQuote(p);
  await p.screenshot({ path: 'tests/reports/q-read.png' });
  await p.waitForTimeout(700);
  const a2 = await readQuote(p);
  console.log('A. первый девиз:', JSON.stringify(a1), '| через 0.7с:', JSON.stringify(a2));

  // B. долгая загрузка: тормозим только /auth/me
  const ctx2 = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p2 = await ctx2.newPage();
  await p2.route('**/api/auth/me*', (route) => setTimeout(() => route.continue(), 8000));
  await p2.goto(URL, { waitUntil: 'commit', timeout: 60000 });
  await p2.waitForTimeout(1000);
  const b1 = await readQuote(p2);
  await p2.waitForTimeout(2100);
  const b2 = await readQuote(p2);
  await p2.waitForTimeout(2000);
  const b3 = await readQuote(p2);
  await p2.screenshot({ path: 'tests/reports/q-long.png' });
  console.log('B. 1.0с:', JSON.stringify(b1));
  console.log('B. 3.1с:', JSON.stringify(b2));
  console.log('B. 5.1с:', JSON.stringify(b3));
  const set = new Set([b1, b2, b3].filter(Boolean));
  console.log('уникальных девизов за 5с:', set.size, set.size >= 2 ? '(смена работает)' : '(НЕ меняется)');

  // C. долгий таймаут: заставка не висит дольше MAX_MS
  const ctx3 = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p3 = await ctx3.newPage();
  await p3.route('**/api/auth/me*', (route) => setTimeout(() => route.abort(), 30000));
  const t = Date.now();
  await p3.goto(URL, { waitUntil: 'commit', timeout: 60000 });
  let gone = null;
  for (let i = 0; i < 60; i++) {
    const on = await p3.evaluate(() => !!document.querySelector('[aria-label="ASGARD CRM загружается"]'));
    if (!on) { gone = Date.now() - t; break; }
    await p3.waitForTimeout(100);
  }
  console.log('C. заставка ушла при мёртвом API через:', gone, 'мс (лимит MAX_MS=3600)');

  await b.close();
})();
