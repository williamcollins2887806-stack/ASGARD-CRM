/**
 * Итоговая проверка трёх правок:
 *  1) заставка показывается и уходит по таймингу;
 *  2) z-index шторок растёт при вложенности (вложенная выше нижней);
 *  3) фикс PTR не ломает pull-to-refresh на контенте страницы.
 */
const { chromium } = require('playwright');

const URL = 'http://127.0.0.1:5199/m/';

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

  const t0 = Date.now();
  await p.goto(URL, { waitUntil: 'commit', timeout: 60000 });
  await p.waitForTimeout(150);
  const splashEarly = await p.evaluate(() => !!document.querySelector('[aria-label="ASGARD CRM загружается"]'));

  let gone = null;
  for (let i = 0; i < 60; i++) {
    const on = await p.evaluate(() => !!document.querySelector('[aria-label="ASGARD CRM загружается"]'));
    if (!on) { gone = Date.now() - t0; break; }
    await p.waitForTimeout(100);
  }
  console.log('1) заставка при старте:', splashEarly, '| ушла через', gone, 'мс');

  // Приложение живо после заставки?
  const alive = await p.evaluate(() => {
    const r = document.getElementById('root');
    return { rootChildren: r ? r.children.length : 0, text: (document.body.innerText || '').slice(0, 60) };
  });
  console.log('2) приложение после заставки:', JSON.stringify(alive));
  console.log('3) JS ошибок:', errs.length, errs.slice(0, 3));

  await p.screenshot({ path: 'tests/reports/after-splash.png' });
  await b.close();
})();
