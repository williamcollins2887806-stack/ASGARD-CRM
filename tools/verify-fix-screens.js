/**
 * Проверяет, что на экранах из фикса нет обрезки контента и тап-бар стоит у низа.
 * Идём по маршрутам, где раньше был min-height:100vh.
 */
const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:5199/m';
const ROUTES = ['/', '/welcome', '/login', '/pin'];

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 414, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();

  for (const route of ROUTES) {
    const errs = [];
    const onErr = (e) => errs.push(String(e.message));
    p.on('pageerror', onErr);
    await p.goto(BASE + route, { waitUntil: 'commit', timeout: 45000 }).catch(() => {});
    await p.waitForTimeout(3000);
    const r = await p.evaluate(() => {
      const el = document.querySelector('.app-min-h, .min-h-screen');
      const nav = document.querySelector('nav.fixed.bottom-0');
      const nr = nav ? nav.getBoundingClientRect() : null;
      const rect = el ? el.getBoundingClientRect() : null;
      return {
        hasSection: !!el,
        sectionH: rect ? Math.round(rect.height) : null,
        overflows: rect ? Math.round(rect.height) - window.innerHeight : null,
        navFound: !!nav,
        navBottom: nr ? Math.round(nr.bottom) : null,
        navTop: nr ? Math.round(nr.top) : null,
        innerH: window.innerHeight,
        gapUnderNav: nr ? Math.round(window.innerHeight - nr.bottom) : null,
      };
    });
    console.log(`\n=== ${route} ===`);
    console.log(JSON.stringify(r));
    console.log('errors:', errs.length, errs.slice(0, 2));
    p.off('pageerror', onErr);
  }

  await p.goto(BASE + '/welcome', { waitUntil: 'commit' }).catch(() => {});
  await p.waitForTimeout(3500);
  await p.screenshot({ path: 'tests/reports/verify-routes-welcome.png' });
  await b.close();
})();
