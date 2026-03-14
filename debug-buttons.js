// Debug: check what buttons exist on tenders page
const { chromium } = require('playwright');
const { loginAs, sleep } = require('./tests/lib/auth');
const { getAccount, BASE_URL } = require('./tests/config');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  await loginAs(page, getAccount('ADMIN'));

  // Check tenders page
  await page.evaluate(() => { window.location.hash = '/tenders'; });
  await sleep(3000);

  const btns = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, [role="button"]'))
      .map(b => {
        const r = b.getBoundingClientRect();
        const s = window.getComputedStyle(b);
        return {
          text: (b.textContent || '').trim().substring(0, 60),
          id: b.id || '',
          visible: b.offsetParent !== null || s.position === 'fixed',
          display: s.display,
          inMimir: !!b.closest('[class*="mimir"]'),
          inAside: !!b.closest('aside'),
          inNav: !!b.closest('nav'),
          inSidebar: !!b.closest('[class*="sidebar"]'),
          w: Math.round(r.width),
          h: Math.round(r.height),
          classes: (b.className || '').substring(0, 80),
        };
      })
      .filter(b => /Создат|Добавит|Новый|Новая|\+/.test(b.text));
  });

  console.log('=== Create-like buttons on #/tenders ===');
  btns.forEach(b => console.log(JSON.stringify(b)));

  // Check pm-works
  await page.evaluate(() => { window.location.hash = '/pm-works'; });
  await sleep(3000);

  const btns2 = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, [role="button"]'))
      .map(b => {
        const r = b.getBoundingClientRect();
        const s = window.getComputedStyle(b);
        return {
          text: (b.textContent || '').trim().substring(0, 60),
          id: b.id || '',
          visible: b.offsetParent !== null || s.position === 'fixed',
          display: s.display,
          inMimir: !!b.closest('[class*="mimir"]'),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      })
      .filter(b => /Создат|Добавит|Новый|Новая|\+/.test(b.text));
  });

  console.log('\n=== Create-like buttons on #/pm-works ===');
  btns2.forEach(b => console.log(JSON.stringify(b)));

  // Check tasks
  await page.evaluate(() => { window.location.hash = '/tasks'; });
  await sleep(3000);

  const btns3 = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, [role="button"]'))
      .map(b => {
        const r = b.getBoundingClientRect();
        const s = window.getComputedStyle(b);
        return {
          text: (b.textContent || '').trim().substring(0, 60),
          id: b.id || '',
          visible: b.offsetParent !== null || s.position === 'fixed',
          display: s.display,
          inMimir: !!b.closest('[class*="mimir"]'),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      })
      .filter(b => /Создат|Добавит|Новый|Новая|\+/.test(b.text));
  });

  console.log('\n=== Create-like buttons on #/tasks ===');
  btns3.forEach(b => console.log(JSON.stringify(b)));

  await ctx.close();
  await browser.close();
})().catch(e => console.error(e));
