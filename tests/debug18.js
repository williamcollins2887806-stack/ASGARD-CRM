const { chromium } = require('playwright');
const { loginAs, sleep, log } = require('./lib/auth');
const { getAccount, BASE_URL } = require('./config');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  
  const pageLogs = [];
  page.on('console', msg => pageLogs.push(msg.type() + ': ' + msg.text()));
  page.on('pageerror', err => pageLogs.push('PAGE_ERROR: ' + err.message));
  
  try {
    await loginAs(page, getAccount('WAREHOUSE'));
    
    // Check auth state after login
    const authInfo = await page.evaluate(async () => {
      try {
        const auth = await window.AsgardAuth.getAuth();
        return { role: auth?.user?.role, userId: auth?.user?.id, login: auth?.user?.login, hasToken: !!auth?.token };
      } catch(e) { return { error: e.message }; }
    });
    console.log('Auth info after login:', JSON.stringify(authInfo));
    
    // Navigate to warehouse
    await page.goto(BASE_URL + '/#/warehouse', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(6000);
    
    // Check auth state on warehouse page
    const authInfo2 = await page.evaluate(async () => {
      try {
        const auth = await window.AsgardAuth.getAuth();
        return { role: auth?.user?.role, userId: auth?.user?.id };
      } catch(e) { return { error: e.message }; }
    });
    console.log('Auth on warehouse page:', JSON.stringify(authInfo2));
    
    // Check btnAddEquip
    const btnCount = await page.locator('#btnAddEquip').count();
    console.log('btnAddEquip count:', btnCount);
    
    // Check all buttons
    const buttons = await page.evaluate(() => 
      Array.from(document.querySelectorAll('button')).map(b => ({ id: b.id || '-', text: b.textContent.trim().substring(0, 40), cls: b.className }))
    );
    console.log('All buttons:', JSON.stringify(buttons));
    
    // Check toolbar content
    const toolbarInfo = await page.evaluate(() => {
      const tb = document.querySelector('.toolbar');
      if (!tb) return 'NO .toolbar found';
      return tb.innerHTML.substring(0, 1000);
    });
    console.log('Toolbar HTML:', toolbarInfo);
    
    // Check page URL and hash
    console.log('Current URL:', page.url());
    
    // Check for errors in console
    const errors = pageLogs.filter(l => l.includes('error') || l.includes('ERROR') || l.includes('Error'));
    if (errors.length) console.log('Console errors:', errors.slice(0, 10).join(' | '));
    
    // Screenshot
    await page.screenshot({ path: '/tmp/debug18.png', fullPage: true });
    console.log('Screenshot saved to /tmp/debug18.png');
    
  } catch(e) {
    console.error('Error:', e.message);
  }
  await browser.close();
})();
