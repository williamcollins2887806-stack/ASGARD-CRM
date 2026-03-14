const { chromium } = require('playwright');
const { loginAs, sleep, log } = require('./lib/auth');
const { getAccount, BASE_URL } = require('./config');
const fs = require('fs');
const path = require('path');

const ROLES = ['ADMIN','PM','TO','HEAD_PM','HEAD_TO','HR','HR_MANAGER','BUH',
  'DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','OFFICE_MANAGER','CHIEF_ENGINEER','WAREHOUSE','PROC'];

const PAGES = [
  '#/home', '#/dashboard', '#/works', '#/tenders', '#/tender-registry', 
  '#/pre-tenders', '#/estimates', '#/all-estimates', '#/calendar',
  '#/warehouse', '#/my-equipment', '#/procurement',
  '#/employees', '#/employee-permits', '#/hr-requests',
  '#/cash', '#/bank', '#/contracts', '#/invoices',
  '#/docs', '#/approvals', '#/mail', '#/mailbox', '#/my-mail',
  '#/telephony', '#/notifications', '#/reports', '#/todo',
  '#/analytics', '#/pm-analytics', '#/settings', '#/users',
  '#/logs', '#/integrations', '#/data-admin'
];

const outDir = '/tmp/screenshots';
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const results = {};

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
  
  for (const role of ROLES) {
    results[role] = { accessible: [], empty: [], errors: [] };
    console.log('\n=== ' + role + ' ===');
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));
    
    try {
      await loginAs(page, getAccount(role));
    } catch(e) {
      console.log('  LOGIN FAILED: ' + e.message.substring(0,80));
      results[role].errors.push('LOGIN: ' + e.message.substring(0,80));
      await ctx.close();
      continue;
    }
    
    for (const pg of PAGES) {
      pageErrors.length = 0;
      try {
        await page.goto(BASE_URL + '/' + pg, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await sleep(3000);
        
        const info = await page.evaluate(() => {
          const main = document.querySelector('#content, main, .page, [class*="page"]');
          const bodyText = (main || document.body).innerText.trim();
          const hash = location.hash;
          const hasContent = bodyText.length > 50;
          const is403 = bodyText.includes('403') || bodyText.includes('Нет доступа') || bodyText.includes('Доступ запрещён');
          const is404 = bodyText.includes('404') || bodyText.includes('Страница не найдена');
          const isEmpty = !hasContent && !is403 && !is404;
          return { hash, bodyLen: bodyText.length, hasContent, is403, is404, isEmpty, snippet: bodyText.substring(0,120) };
        });
        
        if (info.is403) {
          // Expected for restricted pages
          continue;
        }
        
        if (info.is404) {
          console.log('  ' + pg + ' -> 404');
          continue;
        }
        
        if (info.isEmpty || info.bodyLen < 30) {
          results[role].empty.push(pg);
          console.log('  ' + pg + ' -> EMPTY (' + info.bodyLen + ' chars)');
          await page.screenshot({ path: path.join(outDir, role + '_' + pg.replace(/[#\/]/g,'_') + '_EMPTY.png') });
        } else {
          results[role].accessible.push(pg);
        }
        
        if (pageErrors.length > 0) {
          const critical = pageErrors.filter(e => !e.includes('await is only valid') && !e.includes('SSL'));
          if (critical.length > 0) {
            results[role].errors.push(pg + ': ' + critical[0].substring(0,80));
            console.log('  ' + pg + ' -> JS ERROR: ' + critical[0].substring(0,80));
          }
        }
        
      } catch(e) {
        if (!e.message.includes('timeout')) {
          results[role].errors.push(pg + ': ' + e.message.substring(0,60));
        }
      }
    }
    
    // Take screenshot of dashboard
    try {
      await page.goto(BASE_URL + '/#/home', { waitUntil: 'domcontentloaded', timeout: 10000 });
      await sleep(3000);
      await page.screenshot({ path: path.join(outDir, role + '_home.png'), fullPage: true });
    } catch(e) {}
    
    await ctx.close();
  }
  
  await browser.close();
  
  // Summary
  console.log('\n\n========== AUDIT SUMMARY ==========');
  let totalIssues = 0;
  for (const role of ROLES) {
    const r = results[role];
    const issues = r.empty.length + r.errors.length;
    totalIssues += issues;
    if (issues > 0) {
      console.log('\n' + role + ':');
      if (r.empty.length) console.log('  Empty pages: ' + r.empty.join(', '));
      if (r.errors.length) console.log('  Errors: ' + r.errors.join('; '));
    }
    console.log('  Accessible: ' + r.accessible.length + ' | Empty: ' + r.empty.length + ' | Errors: ' + r.errors.length);
  }
  console.log('\nTotal issues: ' + totalIssues);
  console.log('AUDIT COMPLETE');
  
  fs.writeFileSync('/tmp/audit_results.json', JSON.stringify(results, null, 2));
  process.exit(0);
})();
