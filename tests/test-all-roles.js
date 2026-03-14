const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://asgard-crm.ru';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const REPORT_DIR = path.join(__dirname, 'reports');
const PAGE_TIMEOUT = 60000;
const MAX_BUTTONS_PER_PAGE = 15;

// All roles with known credentials from tests/helpers/seed.js
const TEST_PASSWORD = 'Test123!';
const TEST_PIN = '0000';
const ACCOUNTS = [
  { login: 'admin',              password: 'admin123',    pin: '1234', role: 'ADMIN' },
  { login: 'test_director_gen',  password: TEST_PASSWORD, pin: TEST_PIN, role: 'DIRECTOR_GEN' },
  { login: 'test_director_comm', password: TEST_PASSWORD, pin: TEST_PIN, role: 'DIRECTOR_COMM' },
  { login: 'test_director_dev',  password: TEST_PASSWORD, pin: TEST_PIN, role: 'DIRECTOR_DEV' },
  { login: 'test_head_pm',       password: TEST_PASSWORD, pin: TEST_PIN, role: 'HEAD_PM' },
  { login: 'test_head_to',       password: TEST_PASSWORD, pin: TEST_PIN, role: 'HEAD_TO' },
  { login: 'test_pm',            password: TEST_PASSWORD, pin: TEST_PIN, role: 'PM' },
  { login: 'test_to',            password: TEST_PASSWORD, pin: TEST_PIN, role: 'TO' },
  { login: 'test_hr',            password: TEST_PASSWORD, pin: TEST_PIN, role: 'HR' },
  { login: 'test_buh',           password: TEST_PASSWORD, pin: TEST_PIN, role: 'BUH' },
  { login: 'test_office_manager',password: TEST_PASSWORD, pin: TEST_PIN, role: 'OFFICE_MANAGER' },
  { login: 'test_proc',          password: TEST_PASSWORD, pin: TEST_PIN, role: 'PROC' },
  { login: 'test_warehouse',     password: TEST_PASSWORD, pin: TEST_PIN, role: 'WAREHOUSE' },
  { login: 'test_chief_engineer',password: TEST_PASSWORD, pin: TEST_PIN, role: 'CHIEF_ENGINEER' },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(role, msg) { console.log(`[${new Date().toLocaleTimeString()}] [${role}] ${msg}`); }

function addReport(report, pageName, element, status, description = '') {
  report.push({
    pageName,
    element: element.replace(/\s+/g, ' ').trim(),
    status,
    description: (description || '').substring(0, 300)
  });
}

async function screenshotOnError(page, role, name) {
  const safe = `${role}_${name}`.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80);
  const p = path.join(SCREENSHOT_DIR, `err_${safe}_${Date.now()}.png`);
  try { await page.screenshot({ path: p, fullPage: false, timeout: 5000 }); return p; } catch { return null; }
}

async function loginAs(page, account) {
  const { login, password, pin, role } = account;
  log(role, `Logging in as ${login}...`);

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(2000);

  await page.locator('#btnShowLogin').click();
  await sleep(2000);

  const loginField = page.locator('#w_login');
  await loginField.waitFor({ state: 'visible', timeout: 15000 });
  await loginField.fill(login);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByText('Далее', { exact: true }).click();
  await sleep(3000);

  const pinField = page.locator('#w_pin');
  await pinField.waitFor({ state: 'visible', timeout: 15000 });
  await pinField.click();
  await page.keyboard.type(pin, { delay: 100 });
  await page.locator('#btnVerifyPin').click();
  await sleep(4000);

  log(role, `Logged in. URL: ${page.url()}`);
}

async function collectMenuPages(page) {
  await page.waitForSelector('aside a', { timeout: 10000 }).catch(() => {});
  await sleep(2000);
  // Expand all collapsed nav groups so we can see all menu items
  await page.evaluate(() => {
    document.querySelectorAll('.nav-group').forEach(g => {
      g.classList.add('expanded');
      g.classList.remove('collapsed');
      // Also try toggling display of child lists
      const ul = g.querySelector('ul, .nav-items, .nav-group-items');
      if (ul) ul.style.display = '';
    });
    // Also try clicking all nav-group headers to expand them
    document.querySelectorAll('.nav-group-title, .nav-group-header, [data-toggle="collapse"]').forEach(h => {
      const parent = h.closest('.nav-group');
      if (parent && !parent.classList.contains('expanded')) {
        h.click();
      }
    });
  });
  await sleep(1000);
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
      const spans = a.querySelectorAll('span');
      let name = '';
      if (spans.length > 0) name = spans[0].textContent.trim();
      if (!name) name = a.textContent.trim().split('\n')[0].trim();
      items.push({ name: name.substring(0, 50), href });
    });
    return items;
  });
}

async function testPage(page, role, report, pageName, route) {
  const jsErrors = [];
  const httpErrors = [];

  const onConsoleError = msg => { if (msg.type() === 'error') jsErrors.push(msg.text()); };
  const onPageError = err => { jsErrors.push(`UNCAUGHT: ${err.message}`); };
  const onResponse = resp => { if (resp.status() >= 500) httpErrors.push(`${resp.status()} ${resp.url()}`); };

  page.on('console', onConsoleError);
  page.on('pageerror', onPageError);
  page.on('response', onResponse);

  try {
    await page.evaluate(hash => { window.location.hash = hash.substring(1); }, route);
    await sleep(2000);

    if (httpErrors.length > 0) {
      addReport(report, pageName, 'PAGE_LOAD', 'ERROR', `HTTP 5xx: ${httpErrors.join('; ').substring(0, 200)}`);
      await screenshotOnError(page, role, `${pageName}_http`);
    }
    if (jsErrors.length > 0) {
      addReport(report, pageName, 'JS_ERRORS', 'ERROR', jsErrors.slice(0, 3).join(' | ').substring(0, 200));
      await screenshotOnError(page, role, `${pageName}_js`);
    }
    if (httpErrors.length === 0 && jsErrors.length === 0) {
      addReport(report, pageName, 'PAGE_LOAD', 'OK', '');
    }

    // Collect buttons
    const buttons = await page.evaluate(() => {
      const mainContent = document.querySelector('main, [class*="content"], [class*="page-body"], .layout-main, section');
      const container = mainContent || document.body;
      const elems = container.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]');
      const result = [];
      const seen = new Set();
      elems.forEach((el, idx) => {
        if (el.closest('aside') || el.closest('nav')) return;
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
        result.push({ display, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
      });
      return result;
    });

    const toTest = buttons.slice(0, MAX_BUTTONS_PER_PAGE);
    for (const btn of toTest) {
      const preClickJsErrors = [...jsErrors];
      const preClickHttpErrors = [...httpErrors];
      const beforeUrl = page.url();

      try {
        await page.mouse.click(btn.x, btn.y);
        await sleep(1000);

        const afterUrl = page.url();
        const newJsErrors = jsErrors.filter(e => !preClickJsErrors.includes(e));
        const newHttpErrors = httpErrors.filter(e => !preClickHttpErrors.includes(e));

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
          addReport(report, pageName, btn.display, 'ERROR', errDesc.substring(0, 250));
          await screenshotOnError(page, role, `${pageName}_${btn.display}`);
        } else if (modalOpened) {
          addReport(report, pageName, btn.display, 'OK', 'Modal opened');
          await page.keyboard.press('Escape');
          await sleep(300);
        } else if (afterUrl !== beforeUrl) {
          addReport(report, pageName, btn.display, 'OK', `Navigate: ${afterUrl.split('#')[1] || afterUrl}`);
        } else {
          addReport(report, pageName, btn.display, 'OK', 'Click handled');
        }

        if (afterUrl !== beforeUrl) {
          await page.evaluate(hash => { window.location.hash = hash.substring(1); }, route);
          await sleep(1500);
        }
      } catch (e) {
        addReport(report, pageName, btn.display, 'ERROR', `Click failed: ${e.message.substring(0, 100)}`);
        try {
          await page.evaluate(hash => { window.location.hash = hash.substring(1); }, route);
          await sleep(1000);
        } catch {}
      }
    }
  } catch (e) {
    addReport(report, pageName, 'PAGE_TEST', 'ERROR', `Page test failed: ${e.message.substring(0, 150)}`);
    await screenshotOnError(page, role, `${pageName}_fatal`);
  } finally {
    page.removeListener('console', onConsoleError);
    page.removeListener('pageerror', onPageError);
    page.removeListener('response', onResponse);
  }
}

async function testRole(browser, account) {
  const { role } = account;
  const report = [];

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true
  });
  const page = await context.newPage();

  try {
    await loginAs(page, account);
    const menuItems = await collectMenuPages(page);
    log(role, `Found ${menuItems.length} menu pages`);

    for (let i = 0; i < menuItems.length; i++) {
      const item = menuItems[i];
      log(role, `[${i + 1}/${menuItems.length}] ${item.name}`);

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('PAGE_TIMEOUT')), PAGE_TIMEOUT)
      );

      try {
        await Promise.race([
          testPage(page, role, report, item.name, item.href),
          timeoutPromise
        ]);
      } catch (e) {
        if (e.message === 'PAGE_TIMEOUT') {
          addReport(report, item.name, 'TIMEOUT', 'ERROR', `Exceeded ${PAGE_TIMEOUT / 1000}s`);
          await screenshotOnError(page, role, `${item.name}_timeout`);
          try {
            await page.evaluate(() => { window.location.hash = '/home'; });
            await sleep(2000);
          } catch {}
        } else {
          addReport(report, item.name, 'FATAL', 'ERROR', e.message.substring(0, 150));
        }
      }
    }
  } catch (e) {
    log(role, `FATAL: ${e.message}`);
    addReport(report, 'LOGIN', 'FATAL', 'ERROR', e.message.substring(0, 200));
  } finally {
    await context.close();
  }

  return report;
}

async function main() {
  console.log(`Starting ASGARD CRM multi-role test (${ACCOUNTS.length} roles)...`);
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  // Run roles in batches of 3 to avoid overloading
  const BATCH_SIZE = 3;
  const results = new Array(ACCOUNTS.length);
  for (let i = 0; i < ACCOUNTS.length; i += BATCH_SIZE) {
    const batch = ACCOUNTS.slice(i, i + BATCH_SIZE);
    console.log(`\n--- Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.map(a => a.role).join(', ')} ---`);
    const batchResults = await Promise.all(
      batch.map(account => testRole(browser, account))
    );
    batchResults.forEach((r, j) => { results[i + j] = r; });
  }

  await browser.close();

  // Compile results
  const allResults = {};
  let totalOk = 0, totalErr = 0;

  ACCOUNTS.forEach((account, idx) => {
    const report = results[idx];
    const ok = report.filter(r => r.status === 'OK').length;
    const err = report.filter(r => r.status === 'ERROR').length;
    totalOk += ok;
    totalErr += err;
    allResults[account.role] = { login: account.login, report, ok, err };

    // Save individual role report
    const roleFile = path.join(REPORT_DIR, `${account.role}.json`);
    fs.writeFileSync(roleFile, JSON.stringify(report, null, 2));
  });

  // Print summary
  console.log('\n\n' + '='.repeat(60));
  console.log('         MULTI-ROLE TEST REPORT');
  console.log('='.repeat(60));

  for (const [role, data] of Object.entries(allResults)) {
    const icon = data.err > 0 ? 'X' : '+';
    console.log(`\n[${icon}] ${role} (${data.login}) — OK: ${data.ok} | ERRORS: ${data.err}`);

    // Show errors
    const errors = data.report.filter(r => r.status === 'ERROR');
    for (const e of errors) {
      console.log(`    X [${e.pageName}] ${e.element}: ${e.description}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`TOTAL: OK=${totalOk} | ERRORS=${totalErr}`);
  console.log('='.repeat(60));

  // Save combined report
  const combinedFile = path.join(REPORT_DIR, 'combined.json');
  fs.writeFileSync(combinedFile, JSON.stringify(allResults, null, 2));
  console.log(`\nReports saved to ${REPORT_DIR}/`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
