const { chromium } = require('playwright');
const { loginAs, sleep } = require('./lib/auth');
const { getAccount, BASE_URL } = require('./config');

const PAGES_TO_CHECK = ['#/tasks', '#/kanban', '#/correspondence', '#/to-analytics', '#/settings', '#/alerts'];

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  
  await loginAs(page, getAccount('ADMIN'));
  
  for (const pg of PAGES_TO_CHECK) {
    await page.goto(BASE_URL + '/' + pg, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(4000);
    
    const info = await page.evaluate(() => {
      var text = document.body.innerText.substring(0, 300);
      var hash = location.hash;
      var toasts = Array.from(document.querySelectorAll('.toast, .notify, [class*=toast]')).map(t => t.textContent.trim().substring(0, 50));
      return { hash, text: text.substring(0, 150), toasts, hasContent: text.length > 50 };
    });
    
    var redirected = info.hash !== pg;
    console.log(pg + ':');
    console.log('  Hash after nav: ' + info.hash + (redirected ? ' (REDIRECTED!)' : ''));
    console.log('  Content: ' + info.text.replace(/\n/g, ' ').substring(0, 100));
    if (info.toasts.length) console.log('  Toasts: ' + info.toasts.join(', '));
    console.log('');
  }
  
  await browser.close();
  process.exit(0);
})();
