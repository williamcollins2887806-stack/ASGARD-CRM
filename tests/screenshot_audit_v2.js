const { chromium } = require('playwright');
const { loginAs, sleep, log } = require('./lib/auth');
const { getAccount, BASE_URL } = require('./config');
const fs = require('fs');
const path = require('path');

const ROLES = ['ADMIN','PM','TO','HEAD_PM','HEAD_TO','HR','HR_MANAGER','BUH',
  'DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','OFFICE_MANAGER','CHIEF_ENGINEER','WAREHOUSE','PROC'];

const outDir = '/tmp/screenshots_v2';
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const results = {};

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
  
  for (const role of ROLES) {
    results[role] = { pages: [], empty: [], errors: [], total: 0 };
    console.log('\n=== ' + role + ' ===');
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));
    
    try {
      await loginAs(page, getAccount(role));
    } catch(e) {
      console.log('  LOGIN FAILED: ' + e.message.substring(0,80));
      results[role].errors.push('LOGIN FAILED');
      await ctx.close();
      continue;
    }
    
    // Get REAL nav pages from sidebar
    await sleep(2000);
    const navPages = await page.evaluate(() => {
      var links = document.querySelectorAll('aside a[href^="#/"]');
      var pages = [];
      links.forEach(function(a) {
        var href = a.getAttribute('href');
        var text = a.textContent.trim().replace(/\s+/g, ' ').substring(0, 50);
        if (href && !pages.some(function(p) { return p.href === href; })) {
          pages.push({ href: href, label: text });
        }
      });
      return pages;
    });
    
    results[role].total = navPages.length;
    console.log('  Nav pages: ' + navPages.length);
    
    for (const nav of navPages) {
      pageErrors.length = 0;
      try {
        await page.goto(BASE_URL + '/' + nav.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await sleep(3500);
        
        const info = await page.evaluate(function() {
          var content = document.querySelector('#content, main, .page-content');
          var el = content || document.body;
          var text = el.innerText.trim();
          var has403 = text.includes('403') || text.includes('Нет доступа') || text.includes('Доступ запрещён');
          var hasTable = !!document.querySelector('table, .tbl, .card, .fk-page, .stats-row');
          var hasForm = !!document.querySelector('form, .modal, input');
          var hasWidget = !!document.querySelector('.widget, .dash-widget, .dash-grid');
          var buttons = document.querySelectorAll('button, .btn').length;
          return {
            textLen: text.length,
            has403: has403,
            hasTable: hasTable,
            hasForm: hasForm,
            hasWidget: hasWidget,
            buttons: buttons,
            snippet: text.substring(0, 150).replace(/\n/g, ' ')
          };
        });
        
        if (info.has403) {
          console.log('  403: ' + nav.href + ' (' + nav.label + ')');
          results[role].errors.push('403: ' + nav.href);
          continue;
        }
        
        var status = 'OK';
        if (info.textLen < 30 && !info.hasTable && !info.hasForm && !info.hasWidget) {
          status = 'EMPTY';
          results[role].empty.push(nav.href + ' (' + nav.label + ')');
          await page.screenshot({ path: path.join(outDir, role + '_' + nav.href.replace(/[#\/]/g,'_') + '_EMPTY.png') });
        }
        
        // Check for critical page errors (ignore known ones)
        var critical = pageErrors.filter(function(e) {
          return !e.includes('await is only valid') && !e.includes('SSL') && !e.includes('ServiceWorker');
        });
        if (critical.length > 0) {
          results[role].errors.push(nav.href + ': JS_ERROR: ' + critical[0].substring(0, 80));
          console.log('  JS_ERROR: ' + nav.href + ' -> ' + critical[0].substring(0, 80));
        }
        
        results[role].pages.push({
          href: nav.href,
          label: nav.label,
          status: status,
          textLen: info.textLen,
          buttons: info.buttons,
          hasTable: info.hasTable
        });
        
      } catch(e) {
        results[role].errors.push(nav.href + ': ' + e.message.substring(0, 60));
        console.log('  TIMEOUT/ERR: ' + nav.href);
      }
    }
    
    // Screenshot home
    try {
      await page.goto(BASE_URL + '/#/home', { waitUntil: 'domcontentloaded', timeout: 10000 });
      await sleep(3000);
      await page.screenshot({ path: path.join(outDir, role + '_home.png'), fullPage: true });
    } catch(e) {}
    
    var ok = results[role].pages.filter(function(p) { return p.status === 'OK'; }).length;
    console.log('  Result: ' + ok + '/' + navPages.length + ' OK, ' + results[role].empty.length + ' empty, ' + results[role].errors.length + ' errors');
    
    await ctx.close();
  }
  
  await browser.close();
  
  // Summary
  console.log('\n\n========== AUDIT SUMMARY V2 ==========');
  var totalIssues = 0;
  for (var r = 0; r < ROLES.length; r++) {
    var role = ROLES[r];
    var res = results[role];
    var issues = res.empty.length + res.errors.length;
    totalIssues += issues;
    console.log('\n' + role + ' (' + res.total + ' pages in nav):');
    console.log('  OK: ' + res.pages.filter(function(p) { return p.status === 'OK'; }).length);
    if (res.empty.length) console.log('  EMPTY: ' + res.empty.join(', '));
    if (res.errors.length) console.log('  ERRORS: ' + res.errors.join('; '));
    // List all accessible pages
    res.pages.forEach(function(p) {
      console.log('    ' + p.status + ' ' + p.href + ' (' + p.label.substring(0,30) + ') [' + p.textLen + ' chars, ' + p.buttons + ' btns' + (p.hasTable ? ', has table' : '') + ']');
    });
  }
  console.log('\nTotal issues: ' + totalIssues);
  console.log('AUDIT V2 COMPLETE');
  
  fs.writeFileSync('/tmp/audit_v2_results.json', JSON.stringify(results, null, 2));
  process.exit(0);
})();
