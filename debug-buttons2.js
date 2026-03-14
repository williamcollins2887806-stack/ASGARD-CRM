// Debug: check buttons for different roles on specific pages
const { chromium } = require('playwright');
const { loginAs, sleep } = require('./tests/lib/auth');
const { getAccount, BASE_URL } = require('./tests/config');

const checks = [
  { role: 'PM', pages: ['#/pm-works', '#/all-works', '#/tasks'] },
  { role: 'HR', pages: ['#/employees', '#/personnel'] },
  { role: 'ADMIN', pages: ['#/pm-works', '#/employees'] },
];

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  for (const check of checks) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    await loginAs(page, getAccount(check.role));

    for (const route of check.pages) {
      await page.evaluate(h => { window.location.hash = h.replace('#', ''); }, route);
      await sleep(3000);

      const btns = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('button, [role="button"]'))
          .filter(b => {
            const t = (b.textContent || '').trim();
            return /Создат|Добавит|Новый|Новая|Внести|\+/.test(t) && t.length < 60;
          })
          .map(b => {
            const r = b.getBoundingClientRect();
            const s = window.getComputedStyle(b);
            return {
              text: (b.textContent || '').trim().substring(0, 50),
              id: b.id || '',
              vis: r.width > 5 && r.height > 5 && s.display !== 'none',
              inMimir: !!b.closest('[class*="mimir"]'),
              w: Math.round(r.width),
              h: Math.round(r.height),
              offsetParent: b.offsetParent ? b.offsetParent.tagName : 'null',
            };
          });
      });

      console.log(`\n${check.role} → ${route}: ${btns.length} create-like buttons`);
      btns.forEach(b => console.log(`  ${JSON.stringify(b)}`));

      if (btns.filter(b => b.vis && !b.inMimir).length === 0) {
        // Also show ALL visible buttons
        const allBtns = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('button'))
            .filter(b => {
              const r = b.getBoundingClientRect();
              return r.width > 10 && r.height > 10 && !b.closest('[class*="mimir"]') && !b.closest('aside');
            })
            .map(b => ({
              text: (b.textContent || '').trim().substring(0, 40),
              id: b.id || '',
            }));
        });
        console.log(`  ALL visible non-mimir/aside buttons: ${allBtns.length}`);
        allBtns.forEach(b => console.log(`    ${b.id ? '#'+b.id : ''} "${b.text}"`));
      }
    }

    await ctx.close();
  }

  await browser.close();
})().catch(e => console.error(e));
