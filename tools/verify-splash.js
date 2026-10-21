/**
 * Проверка заставки AppSplash:
 *  1) видна сразу при открытии (первый кадр);
 *  2) держится минимум MIN_MS и уходит максимум через MAX_MS;
 *  3) тап пробивает её сразу;
 *  4) нет JS-ошибок;
 *  5) prefers-reduced-motion → статичная и уходит быстро.
 */
const { chromium } = require('playwright');

const URL = 'http://127.0.0.1:5199/m/';

const findSplash = () => {
  const el = document.querySelector('[aria-label="ASGARD CRM загружается"]');
  return el ? { present: true, opacity: getComputedStyle(el).opacity } : { present: false };
};

(async () => {
  const b = await chromium.launch();

  // ── 1. Обычный режим: тайминги ──
  let ctx = await b.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  let p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

  const t0 = Date.now();
  await p.goto(URL, { waitUntil: 'commit', timeout: 60000 });
  await p.waitForTimeout(120);
  const atStart = await p.evaluate(findSplash);
  console.log('через 120 мс после старта:', JSON.stringify(atStart));

  await p.screenshot({ path: 'tests/reports/splash-early.png' });
  await p.waitForTimeout(400);
  await p.screenshot({ path: 'tests/reports/splash-mid.png' });

  // Ждём исчезновения
  let goneAt = null;
  for (let i = 0; i < 60; i++) {
    const s = await p.evaluate(findSplash);
    if (!s.present) { goneAt = Date.now() - t0; break; }
    await p.waitForTimeout(100);
  }
  console.log('заставка ушла через, мс:', goneAt);
  console.log('JS ошибок:', errs.length, errs.slice(0, 3));

  // ── 2. Тап пробивает заставку ──
  const p2 = await ctx.newPage();
  await p2.goto(URL, { waitUntil: 'commit', timeout: 60000 });
  await p2.waitForTimeout(200);
  const before = await p2.evaluate(findSplash);
  await p2.touchscreen.tap(196, 420);
  await p2.waitForTimeout(600);
  const after = await p2.evaluate(findSplash);
  console.log('\nтап: до =', JSON.stringify(before), ' после =', JSON.stringify(after));

  // ── 3. reduced motion ──
  const ctx3 = await b.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const p3 = await ctx3.newPage();
  const t3 = Date.now();
  await p3.goto(URL, { waitUntil: 'commit', timeout: 60000 });
  await p3.waitForTimeout(150);
  const rmStart = await p3.evaluate(findSplash);
  let rmGone = null;
  for (let i = 0; i < 40; i++) {
    const s = await p3.evaluate(findSplash);
    if (!s.present) { rmGone = Date.now() - t3; break; }
    await p3.waitForTimeout(100);
  }
  console.log('\nreduced-motion: сразу =', JSON.stringify(rmStart), ' ушла через', rmGone, 'мс');

  await b.close();
})();
