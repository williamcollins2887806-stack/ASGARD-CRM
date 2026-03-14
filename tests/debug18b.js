const { chromium } = require('playwright');
const { loginAs, sleep, log } = require('./lib/auth');
const { getAccount, BASE_URL } = require('./config');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  
  const pageLogs = [];
  page.on('console', msg => pageLogs.push(msg.type() + ': ' + msg.text()));
  page.on('pageerror', err => pageLogs.push('PAGE_ERROR: ' + err.message));
  
  try {
    await loginAs(page, getAccount('WAREHOUSE'));
    await page.goto(BASE_URL + '/#/warehouse', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(6000);
    
    // Inject diagnostic into AsgardWarehouse
    const diag = await page.evaluate(() => {
      try {
        var aw = window.AsgardWarehouse;
        var keys = aw ? Object.keys(aw) : 'NO AsgardWarehouse';
        
        // Check if btnAddEquipment exists
        var btn = document.getElementById('btnAddEquipment');
        var btnOld = document.getElementById('btnAddEquip');
        
        // Check fk-header-actions content
        var headerActions = document.querySelector('.fk-header-actions');
        var headerHTML = headerActions ? headerActions.innerHTML : 'NO .fk-header-actions';
        
        // Check if fk-page exists
        var fkPage = document.querySelector('.fk-page');
        var warehousePage = document.querySelector('.warehouse-page');
        
        return {
          keys: keys,
          btnAddEquipment: !!btn,
          btnAddEquip: !!btnOld,
          headerActionsHTML: headerHTML,
          hasFkPage: !!fkPage,
          hasWarehousePage: !!warehousePage,
          pageTitle: document.querySelector('h2')?.textContent || 'no h2'
        };
      } catch(e) { return { error: e.message }; }
    });
    console.log('Diagnostic:', JSON.stringify(diag, null, 2));
    
    // Check 401 details
    const fourOhOne = pageLogs.filter(l => l.includes('401'));
    console.log('401 errors count:', fourOhOne.length);
    if (fourOhOne.length) console.log('First 401:', fourOhOne[0]);
    
    // Check all page errors
    const pageErrors = pageLogs.filter(l => l.startsWith('PAGE_ERROR'));
    console.log('Page errors:', pageErrors.join(' | '));
    
  } catch(e) {
    console.error('Error:', e.message);
  }
  await browser.close();
})();
