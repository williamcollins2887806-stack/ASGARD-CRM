const { chromium } = require('playwright');
const { loginAs, sleep } = require('./lib/auth');
const { getAccount, BASE_URL } = require('./config');

const ROLES = ['ADMIN','PM','TO','BUH','WAREHOUSE','HR','DIRECTOR_GEN','OFFICE_MANAGER','CHIEF_ENGINEER','PROC','HEAD_PM','HEAD_TO','HR_MANAGER','DIRECTOR_COMM','DIRECTOR_DEV'];

const issues = [];

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
  
  for (const role of ROLES) {
    console.log('\n=== ' + role + ' ===');
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    
    try {
      await loginAs(page, getAccount(role));
    } catch(e) {
      issues.push(role + ': LOGIN FAILED');
      console.log('  LOGIN FAILED');
      await ctx.close();
      continue;
    }
    
    // Get nav pages
    await sleep(2000);
    const navPages = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('aside a[href^="#/"]')).map(a => ({
        href: a.getAttribute('href'),
        label: a.textContent.trim().replace(/\s+/g,' ').substring(0,40)
      })).filter((v,i,arr) => arr.findIndex(x=>x.href===v.href)===i);
    });
    
    console.log('  Pages: ' + navPages.length);
    
    for (const nav of navPages) {
      errs.length = 0;
      try {
        await page.goto(BASE_URL + '/' + nav.href, { waitUntil:'domcontentloaded', timeout:12000 });
        await sleep(3000);
        
        const check = await page.evaluate(() => {
          var body = document.body;
          var text = body.innerText;
          var hash = location.hash;
          
          // Visual checks
          var overlapping = false;
          var brokenLayout = false;
          var unreadableText = false;
          
          // Check if main content area exists and has reasonable size
          var content = document.querySelector('#content, .page, .fk-page, .warehouse-page');
          var contentRect = content ? content.getBoundingClientRect() : null;
          if (contentRect && contentRect.width < 200) brokenLayout = true;
          
          // Check for text overflow / elements going off screen
          var allEls = document.querySelectorAll('h1,h2,h3,.btn,table,.card,.widget');
          for (var i=0; i<Math.min(allEls.length,50); i++) {
            var r = allEls[i].getBoundingClientRect();
            if (r.left < -100 || r.right > window.innerWidth + 100) {
              brokenLayout = true;
              break;
            }
          }
          
          // Check for visible error messages in content
          var hasError = text.includes('Cannot read') || text.includes('undefined') && text.length < 100 || text.includes('TypeError') || text.includes('ReferenceError');
          
          // Check buttons exist and are visible
          var btns = document.querySelectorAll('button:not([style*="display:none"])');
          var visibleBtns = 0;
          btns.forEach(function(b) { if (b.offsetWidth > 0 && b.offsetHeight > 0) visibleBtns++; });
          
          return {
            hash: hash,
            textLen: text.length,
            brokenLayout: brokenLayout,
            hasError: hasError,
            visibleBtns: visibleBtns,
            hasTable: !!document.querySelector('table, .tbl'),
            hasCards: !!document.querySelector('.card, .fk-card, .dash-widget, .widget'),
            snippet: text.substring(0, 80).replace(/\n/g, ' ')
          };
        });
        
        // Critical page errors (not the known ones)
        var criticalErrs = errs.filter(e => !e.includes('await is only valid') && !e.includes('SSL') && !e.includes('ServiceWorker'));
        
        if (check.brokenLayout) {
          issues.push(role + ' ' + nav.href + ': BROKEN LAYOUT');
          console.log('  BROKEN: ' + nav.href);
        }
        if (check.hasError) {
          issues.push(role + ' ' + nav.href + ': JS ERROR IN CONTENT');
          console.log('  JS_ERR: ' + nav.href + ' | ' + check.snippet);
        }
        if (check.textLen < 20 && check.visibleBtns < 3) {
          issues.push(role + ' ' + nav.href + ': POSSIBLY EMPTY (' + check.textLen + ' chars)');
          console.log('  EMPTY?: ' + nav.href + ' (' + check.textLen + ' chars)');
        }
        if (criticalErrs.length > 0) {
          issues.push(role + ' ' + nav.href + ': CONSOLE ERROR: ' + criticalErrs[0].substring(0,80));
          console.log('  CONSOLE_ERR: ' + nav.href + ' -> ' + criticalErrs[0].substring(0,60));
        }
        
      } catch(e) {
        if (e.message.includes('timeout')) {
          issues.push(role + ' ' + nav.href + ': TIMEOUT');
          console.log('  TIMEOUT: ' + nav.href);
        }
      }
    }
    
    console.log('  Done: ' + role);
    await ctx.close();
  }
  
  await browser.close();
  
  console.log('\n\n========== VISUAL CHECK RESULTS ==========');
  if (issues.length === 0) {
    console.log('NO ISSUES FOUND - All pages render correctly');
  } else {
    console.log('Issues found: ' + issues.length);
    issues.forEach(function(i) { console.log('  - ' + i); });
  }
  console.log('VISUAL CHECK COMPLETE');
  process.exit(issues.length > 0 ? 1 : 0);
})();
