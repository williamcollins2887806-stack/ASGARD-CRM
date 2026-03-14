const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://asgard-crm.ru';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const REPORT_FILE = path.join(__dirname, 'report.json');
const REPORT = [];
const PAGE_TIMEOUT = 60000; // 60s max per page
const CLICK_TIMEOUT = 3000;
const MAX_BUTTONS_PER_PAGE = 15;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function log(msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`); }

function addReport(pageName, element, status, description = '') {
  const entry = { pageName, element: element.replace(/\s+/g, ' ').trim(), status, description };
  REPORT.push(entry);
  const icon = status === 'OK' ? '+' : status === 'ERROR' ? 'X' : '-';
  log(`  [${icon}] ${entry.element.substring(0, 40)} -> ${status}${description ? ': ' + description.substring(0, 80) : ''}`);
  // Save incrementally
  fs.writeFileSync(REPORT_FILE, JSON.stringify(REPORT, null, 2));
}

async function screenshotOnError(page, name) {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 60);
  const p = path.join(SCREENSHOT_DIR, `err_${safe}_${Date.now()}.png`);
  try { await page.screenshot({ path: p, fullPage: false, timeout: 5000 }); return p; } catch { return null; }
}

async function login(page) {
  log('=== LOGIN ===');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(1500);

  // Click "Войти" to show form
  await page.locator('#btnShowLogin').click();
  await sleep(1500);

  // Fill credentials
  const loginField = page.locator('#w_login');
  await loginField.waitFor({ state: 'visible', timeout: 5000 });
  await loginField.fill('admin');
  await page.locator('input[type="password"]').first().fill('admin123');
  await page.getByText('Далее', { exact: true }).click();
  await sleep(2000);

  // PIN
  const pinField = page.locator('#w_pin');
  await pinField.waitFor({ state: 'visible', timeout: 5000 });
  await pinField.click();
  await page.keyboard.type('1234', { delay: 80 });
  await page.locator('#btnVerifyPin').click();
  await sleep(3000);

  log(`Logged in. URL: ${page.url()}`);
}

async function collectMenuPages(page) {
  log('=== COLLECTING MENU ===');
  // Wait for sidebar to render
  await page.waitForSelector('aside a', { timeout: 10000 }).catch(() => {});
  await sleep(2000);
  return await page.evaluate(() => {
    const aside = document.querySelector('aside');
    if (!aside) return [];
    const links = aside.querySelectorAll('a[href^="#/"]');
    const seen = new Set();
    const items = [];
    links.forEach(a => {
      const href = a.getAttribute('href');
      if (!href || href === '#/welcome' || seen.has(href)) return;
      seen.add(href);
      // Get clean name
      const spans = a.querySelectorAll('span');
      let name = '';
      if (spans.length > 0) name = spans[0].textContent.trim();
      if (!name) name = a.textContent.trim().split('\n')[0].trim();
      items.push({ name: name.substring(0, 50), href });
    });
    return items;
  });
}

async function testPage(page, pageName, route) {
  log(`\n--- PAGE: "${pageName}" (${route}) ---`);

  const jsErrors = [];
  const httpErrors = [];

  const onConsoleError = msg => { if (msg.type() === 'error') jsErrors.push(msg.text()); };
  const onPageError = err => { jsErrors.push(`UNCAUGHT: ${err.message}`); };
  const onResponse = resp => { if (resp.status() >= 500) httpErrors.push(`${resp.status()} ${resp.url()}`); };

  page.on('console', onConsoleError);
  page.on('pageerror', onPageError);
  page.on('response', onResponse);

  try {
    // Navigate
    await page.evaluate(hash => { window.location.hash = hash.substring(1); }, route);
    await sleep(2000);

    // Check errors
    if (httpErrors.length > 0) {
      addReport(pageName, 'PAGE_LOAD', 'ERROR', `HTTP 5xx: ${httpErrors.join('; ').substring(0, 200)}`);
      await screenshotOnError(page, `${pageName}_http`);
    }
    if (jsErrors.length > 0) {
      addReport(pageName, 'JS_ERRORS', 'ERROR', jsErrors.slice(0, 3).join(' | ').substring(0, 200));
      await screenshotOnError(page, `${pageName}_js`);
    }
    if (httpErrors.length === 0 && jsErrors.length === 0) {
      addReport(pageName, 'PAGE_LOAD', 'OK', '');
    }

    // Collect buttons (only in main content, not sidebar)
    const buttons = await page.evaluate(() => {
      const mainContent = document.querySelector('main, [class*="content"], [class*="page-body"], .layout-main, section');
      const container = mainContent || document.body;

      const elems = container.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]');
      const result = [];
      const seen = new Set();

      elems.forEach((el, idx) => {
        // Skip sidebar elements
        if (el.closest('aside') || el.closest('nav')) return;
        // Skip invisible
        const rect = el.getBoundingClientRect();
        if (rect.width < 5 || rect.height < 5) return;
        if (window.getComputedStyle(el).display === 'none') return;
        if (window.getComputedStyle(el).visibility === 'hidden') return;

        let text = el.textContent?.trim().replace(/\s+/g, ' ').substring(0, 50) || '';
        const ariaLabel = el.getAttribute('aria-label') || '';
        const title = el.getAttribute('title') || '';
        const display = text || ariaLabel || title || `[button#${idx}]`;

        if (seen.has(display)) return;
        seen.add(display);

        // Build a unique selector
        let selector = '';
        if (el.id) selector = `#${el.id}`;
        else if (el.className && typeof el.className === 'string') {
          const cls = el.className.split(' ').filter(c => c && c.length < 40).slice(0, 2).join('.');
          if (cls) selector = `${el.tagName.toLowerCase()}.${cls}`;
        }

        result.push({
          display,
          tag: el.tagName.toLowerCase(),
          selector,
          index: idx,
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2
        });
      });

      return result;
    });

    log(`  Found ${buttons.length} buttons`);

    // Test each button (limit)
    const toTest = buttons.slice(0, MAX_BUTTONS_PER_PAGE);
    for (const btn of toTest) {
      // Reset error trackers for this click
      const preClickJsErrors = [...jsErrors];
      const preClickHttpErrors = [...httpErrors];
      const beforeUrl = page.url();

      try {
        // Click by coordinates (most reliable)
        await page.mouse.click(btn.x, btn.y);
        await sleep(1000);

        const afterUrl = page.url();
        const newJsErrors = jsErrors.filter(e => !preClickJsErrors.includes(e));
        const newHttpErrors = httpErrors.filter(e => !preClickHttpErrors.includes(e));

        // Check for modals
        const modalOpened = await page.evaluate(() => {
          const modals = document.querySelectorAll('[class*="modal"]:not([style*="display: none"]):not([style*="display:none"]), [role="dialog"], [class*="popup"]:not([style*="display: none"])');
          for (const m of modals) {
            const rect = m.getBoundingClientRect();
            if (rect.width > 50 && rect.height > 50) return true;
          }
          return false;
        });

        if (newJsErrors.length > 0 || newHttpErrors.length > 0) {
          const errDesc = [...newJsErrors.slice(0, 2), ...newHttpErrors.slice(0, 2)].join(' | ');
          addReport(pageName, btn.display, 'ERROR', errDesc.substring(0, 250));
          await screenshotOnError(page, `${pageName}_${btn.display}`);
        } else if (modalOpened) {
          addReport(pageName, btn.display, 'OK', 'Modal opened');
          // Close modal
          await page.keyboard.press('Escape');
          await sleep(300);
        } else if (afterUrl !== beforeUrl) {
          addReport(pageName, btn.display, 'OK', `Navigate: ${afterUrl.split('#')[1] || afterUrl}`);
        } else {
          // Check if something visually happened (dropdown, tooltip, etc.)
          addReport(pageName, btn.display, 'OK', 'Click handled');
        }

        // Recover URL if changed
        if (afterUrl !== beforeUrl) {
          await page.evaluate(hash => { window.location.hash = hash.substring(1); }, route);
          await sleep(1500);
        }

      } catch (e) {
        addReport(pageName, btn.display, 'ERROR', `Click failed: ${e.message.substring(0, 100)}`);
        // Recover
        try {
          await page.evaluate(hash => { window.location.hash = hash.substring(1); }, route);
          await sleep(1000);
        } catch {}
      }
    }

  } catch (e) {
    addReport(pageName, 'PAGE_TEST', 'ERROR', `Page test failed: ${e.message.substring(0, 150)}`);
    await screenshotOnError(page, `${pageName}_fatal`);
  } finally {
    page.removeListener('console', onConsoleError);
    page.removeListener('pageerror', onPageError);
    page.removeListener('response', onResponse);
  }
}

async function main() {
  log('Starting ASGARD CRM test v2...');
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();

  try {
    await login(page);
    const menuItems = await collectMenuPages(page);

    log(`Found ${menuItems.length} menu pages`);
    menuItems.forEach((m, i) => log(`  ${i + 1}. ${m.name} -> ${m.href}`));

    for (let i = 0; i < menuItems.length; i++) {
      const item = menuItems[i];
      log(`\n=== [${i + 1}/${menuItems.length}] ===`);

      // Wrap in timeout
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('PAGE_TIMEOUT')), PAGE_TIMEOUT)
      );

      try {
        await Promise.race([
          testPage(page, item.name, item.href),
          timeoutPromise
        ]);
      } catch (e) {
        if (e.message === 'PAGE_TIMEOUT') {
          addReport(item.name, 'TIMEOUT', 'ERROR', `Page test exceeded ${PAGE_TIMEOUT / 1000}s limit`);
          await screenshotOnError(page, `${item.name}_timeout`);
          // Force navigate away and back
          try {
            await page.evaluate(() => { window.location.hash = '/home'; });
            await sleep(2000);
          } catch {}
        } else {
          addReport(item.name, 'FATAL', 'ERROR', e.message.substring(0, 150));
        }
      }
    }

  } catch (e) {
    log(`Fatal: ${e.message}`);
  } finally {
    await browser.close();
  }

  // Final report
  log('\n\n========================================');
  log('         FINAL REPORT');
  log('========================================\n');

  const byPage = {};
  for (const r of REPORT) {
    if (!byPage[r.pageName]) byPage[r.pageName] = [];
    byPage[r.pageName].push(r);
  }

  let okCount = 0, errCount = 0;
  for (const [pageName, items] of Object.entries(byPage)) {
    const hasErrors = items.some(i => i.status === 'ERROR');
    console.log(`\n${hasErrors ? 'X' : '+'} ${pageName}`);
    for (const item of items) {
      const icon = item.status === 'OK' ? '  +' : '  X';
      console.log(`${icon} [${item.element}] ${item.description}`);
      if (item.status === 'OK') okCount++;
      else errCount++;
    }
  }

  console.log(`\n========================================`);
  console.log(`TOTAL: OK=${okCount} | ERRORS=${errCount}`);
  console.log(`========================================`);

  fs.writeFileSync(REPORT_FILE, JSON.stringify(REPORT, null, 2));
  log(`Report saved to ${REPORT_FILE}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
