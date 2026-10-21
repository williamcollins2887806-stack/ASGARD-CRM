/**
 * Покадровая съёмка: фиксируем, что первый девиз показан полностью,
 * а при длительной загрузке сменяется на второй.
 */
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:5199/m/';

(async () => {
  const b = await chromium.launch();

  // Сценарий A: быстрая готовность — видим один девиз
  let ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  let p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'commit', timeout: 60000 });
  const t0 = Date.now();
  for (const [at, name] of [[250, 'q-1-appear.png'], [1000, 'q-2-read.png'], [1700, 'q-3-read.png']]) {
    const wait = at - (Date.now() - t0);
    if (wait > 0) await p.waitForTimeout(wait);
    await p.screenshot({ path: 'tests/reports/' + name });
  }
  const txtA = await p.evaluate(() => (document.querySelector('[aria-label="ASGARD CRM загружается"]') || document.body).innerText.replace(/\n+/g, ' | '));
  console.log('A (быстрая):', txtA);

  // Сценарий B: залипаем на заставке дольше — девиз должен смениться
  const ctx2 = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p2 = await ctx2.newPage();
  // Тормозим bootstrap: перехватываем /api/auth/me
  await p2.route('**/api/**', (route) => setTimeout(() => route.continue(), 6000));
  await p2.evaluate(() => {}).catch(() => {});
  await p2.goto(URL, { waitUntil: 'commit', timeout: 60000 });
  await p2.waitForTimeout(1000);
  const q1 = await p2.evaluate(() => (document.body.innerText.match(/Терпение|Хугин|Сила|Медленно|Путь|Кто ждёт/) || [null])[0]);
  await p2.waitForTimeout(2100);
  const q2 = await p2.evaluate(() => (document.body.innerText.match(/Терпение|Хугин|Сила|Медленно|Путь|Кто ждёт/) || [null])[0]);
  await p2.screenshot({ path: 'tests/reports/q-4-second.png' });
  console.log('B (долгая): первая =', JSON.stringify(q1), ' через 2.1с =', JSON.stringify(q2));
  console.log('   смена девиза:', q1 !== q2 ? 'ДА' : 'НЕТ');

  await b.close();
})();
