const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true, isMobile: true });
  await page.goto('https://asgard-crm.ru', { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  await page.locator('#btnShowLogin').click();
  await sleep(2000);
  await page.locator('#w_login').fill('admin');
  await page.locator('input[type="password"]').first().fill('TestCheck1!');
  await page.getByText('Далее', { exact: true }).click();
  await sleep(3000);
  await page.locator('#w_pin').click();
  await page.keyboard.type('0000', { delay: 100 });
  await page.locator('#btnVerifyPin').click();
  await sleep(5000);
  await page.evaluate(() => { location.hash = '#/messenger'; });
  await sleep(5000);
  await page.evaluate(() => document.querySelector('.chat-item')?.click());
  await sleep(4000);
  
  const diag = await page.evaluate(() => {
    const input = document.querySelector('.chat-input-area');
    const tabbar = document.querySelector('.m-tabbar');
    const fab = document.querySelector('.m-fab');
    const textarea = document.querySelector('#chat-message-input');
    const r = {};
    if (input) {
      const cs = getComputedStyle(input);
      const rect = input.getBoundingClientRect();
      r.input = { h: Math.round(rect.height), bot: Math.round(rect.bottom), paddingBottom: cs.paddingBottom };
    }
    if (tabbar) {
      const cs = getComputedStyle(tabbar);
      r.tabbar = { display: cs.display, visible: cs.display !== 'none' };
    }
    if (fab) {
      const cs = getComputedStyle(fab);
      r.fab = { display: cs.display, visible: cs.display !== 'none' };
    }
    r.textareaExists = !!textarea;
    r.vp = { h: window.innerHeight };
    return r;
  });
  console.log(JSON.stringify(diag, null, 2));
  await browser.close();
})().catch(e => console.error(e.message));
