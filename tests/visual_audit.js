/**
 * Visual Audit Script — ASGARD CRM
 * Takes screenshots of every page for every role.
 * Saves to /tmp/visual_audit/<role>/<page>.png
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://127.0.0.1';
const SCREENSHOT_DIR = '/tmp/visual_audit';
const VIEWPORT = { width: 1920, height: 1080 };

// Roles and their test accounts
const ROLES = [
  { role: 'ADMIN', login: 'test_admin', pass: 'Test123!' },
  { role: 'PM', login: 'test_pm', pass: 'Test123!' },
  { role: 'TO', login: 'test_to', pass: 'Test123!' },
  { role: 'HEAD_PM', login: 'test_head_pm', pass: 'Test123!' },
  { role: 'HEAD_TO', login: 'test_head_to', pass: 'Test123!' },
  { role: 'HR', login: 'test_hr', pass: 'Test123!' },
  { role: 'HR_MANAGER', login: 'test_hr_manager', pass: 'Test123!' },
  { role: 'BUH', login: 'test_buh', pass: 'Test123!' },
  { role: 'DIRECTOR_GEN', login: 'test_director_gen', pass: 'Test123!' },
  { role: 'OFFICE_MANAGER', login: 'test_office_manager', pass: 'Test123!' },
  { role: 'CHIEF_ENGINEER', login: 'test_chief_engineer', pass: 'Test123!' },
  { role: 'WAREHOUSE', login: 'test_warehouse', pass: 'Test123!' },
  { role: 'PROC', login: 'test_proc', pass: 'Test123!' },
];

// Pages per role
const ROLE_PAGES = {
  ADMIN: [
    'home', 'tenders', 'pre-tenders', 'customers', 'tkp', 'invoices', 'contracts',
    'gantt', 'gantt-works', 'gantt-calcs', 'pm-works', 'pm-calcs', 'all-works', 'all-estimates',
    'cash', 'cash-admin', 'buh-registry', 'finances', 'kpi-money', 'kpi-works',
    'tasks', 'tasks-admin', 'kanban', 'calendar', 'meetings',
    'personnel', 'hr-requests', 'user-requests', 'collections', 'workers-schedule',
    'office-schedule', 'hr-rating', 'travel', 'training',
    'permits', 'permit-applications', 'pass-requests',
    'bonus-approval', 'seals', 'payroll', 'one-time-pay', 'self-employed',
    'warehouse', 'office-expenses', 'correspondence', 'mailbox',
    'funnel', 'pm-analytics', 'diag', 'settings',
    'alerts', 'messenger', 'calculator', 'object-map', 'my-mail'
  ],
  PM: [
    'home', 'tenders', 'pre-tenders', 'customers', 'tkp', 'invoices', 'contracts',
    'gantt', 'gantt-works', 'gantt-calcs', 'pm-works', 'pm-calcs',
    'cash', 'finances',
    'tasks', 'kanban', 'calendar', 'meetings',
    'hr-requests', 'workers-schedule', 'travel',
    'permits', 'permit-applications',
    'correspondence', 'mailbox',
    'pm-analytics', 'calculator',
    'alerts', 'messenger', 'my-mail'
  ],
  TO: [
    'home', 'gantt', 'gantt-works',
    'tasks', 'kanban', 'calendar', 'meetings',
    'workers-schedule', 'travel',
    'permits', 'permit-applications',
    'warehouse',
    'alerts', 'messenger', 'my-mail'
  ],
  HEAD_PM: [
    'home', 'tenders', 'pre-tenders', 'customers', 'tkp', 'invoices', 'contracts',
    'gantt', 'gantt-works', 'gantt-calcs', 'pm-works', 'pm-calcs', 'all-works', 'all-estimates',
    'cash', 'finances', 'kpi-works',
    'tasks', 'kanban', 'calendar', 'meetings',
    'hr-requests', 'workers-schedule', 'travel',
    'permits', 'permit-applications',
    'payroll',
    'correspondence', 'mailbox',
    'funnel', 'pm-analytics', 'calculator',
    'alerts', 'messenger', 'my-mail'
  ],
  HEAD_TO: [
    'home', 'gantt', 'gantt-works',
    'tasks', 'kanban', 'calendar', 'meetings',
    'workers-schedule', 'travel',
    'permits', 'permit-applications',
    'warehouse',
    'alerts', 'messenger', 'my-mail'
  ],
  HR: [
    'home', 'personnel', 'hr-requests', 'user-requests', 'collections',
    'workers-schedule', 'office-schedule', 'hr-rating', 'travel', 'training',
    'permits', 'permit-applications', 'pass-requests',
    'tasks', 'kanban', 'calendar', 'meetings',
    'correspondence',
    'alerts', 'messenger', 'my-mail'
  ],
  HR_MANAGER: [
    'home', 'personnel', 'hr-requests', 'user-requests', 'collections',
    'workers-schedule', 'office-schedule', 'hr-rating', 'travel', 'training',
    'permits', 'permit-applications', 'pass-requests',
    'tasks', 'kanban', 'calendar', 'meetings',
    'alerts', 'messenger', 'my-mail'
  ],
  BUH: [
    'home', 'cash', 'buh-registry', 'finances', 'kpi-money',
    'invoices', 'contracts', 'payroll', 'one-time-pay', 'self-employed',
    'acts', 'tasks', 'kanban', 'calendar',
    'office-expenses',
    'alerts', 'messenger', 'my-mail'
  ],
  DIRECTOR_GEN: [
    'home', 'tenders', 'pre-tenders', 'customers', 'tkp', 'invoices', 'contracts',
    'gantt', 'gantt-works', 'gantt-calcs', 'pm-works', 'pm-calcs', 'all-works', 'all-estimates',
    'cash', 'cash-admin', 'buh-registry', 'finances', 'kpi-money', 'kpi-works',
    'tasks', 'kanban', 'calendar', 'meetings',
    'personnel', 'hr-requests', 'user-requests', 'collections', 'workers-schedule',
    'office-schedule', 'hr-rating', 'travel', 'training',
    'permits', 'permit-applications', 'pass-requests',
    'bonus-approval', 'seals', 'payroll',
    'warehouse', 'office-expenses', 'correspondence', 'mailbox',
    'funnel', 'pm-analytics', 'diag',
    'alerts', 'messenger', 'calculator', 'my-mail'
  ],
  OFFICE_MANAGER: [
    'home', 'office-expenses', 'warehouse', 'correspondence',
    'tasks', 'kanban', 'calendar',
    'tmc-requests',
    'alerts', 'messenger', 'my-mail'
  ],
  CHIEF_ENGINEER: [
    'home', 'gantt', 'gantt-works',
    'tasks', 'kanban', 'calendar',
    'workers-schedule', 'permits', 'permit-applications',
    'warehouse',
    'alerts', 'messenger', 'my-mail'
  ],
  WAREHOUSE: [
    'home', 'warehouse',
    'tasks', 'kanban', 'calendar',
    'alerts', 'messenger', 'my-mail'
  ],
  PROC: [
    'home', 'proc-requests', 'tmc-requests',
    'tasks', 'kanban', 'calendar',
    'warehouse',
    'alerts', 'messenger', 'my-mail'
  ],
};

// Key modals to open on specific pages
const PAGE_MODALS = {
  'tenders': [
    { btn: '+ Новый тендер', name: 'new-tender' },
  ],
  'customers': [
    { btn: '+ Добавить', name: 'new-customer' },
  ],
  'tasks': [
    { btn: '+ Задача', name: 'new-task' },
  ],
  'personnel': [
    { btn: '+ Добавить', name: 'new-employee' },
  ],
  'hr-requests': [
    { btn: '+ Заявка', name: 'new-hr-request' },
  ],
  'warehouse': [
    { btn: '+ Добавить', name: 'new-warehouse-item' },
    { btn: '➕ Добавить ТМЦ', name: 'new-tmc' },
  ],
  'office-expenses': [
    { btn: '+ Добавить расход', name: 'new-expense' },
  ],
  'calendar': [
    { btn: '+ Событие', name: 'new-event' },
  ],
  'correspondence': [
    { btn: '📥 Входящее', name: 'incoming' },
    { btn: '📤 Исходящее', name: 'outgoing' },
  ],
  'permits': [
    { btn: '+ Допуск', name: 'new-permit' },
    { btn: '+ Добавить', name: 'new-permit-alt' },
  ],
  'cash': [
    { btn: '+ Добавить кассу', name: 'new-cash' },
  ],
  'invoices': [
    { btn: '+ Счёт', name: 'new-invoice' },
  ],
  'training': [
    { btn: '+ Обучение', name: 'new-training' },
    { btn: '+ Добавить', name: 'new-training-alt' },
  ],
};

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function loginAs(page, login, pass) {
  await page.goto(`${BASE_URL}/#/login`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(1000);

  // Clear and fill login
  const loginInput = page.locator('#loginInput, input[name="login"], input[placeholder*="Логин"]').first();
  const passInput = page.locator('#passInput, input[name="password"], input[type="password"]').first();
  const submitBtn = page.locator('#btnLogin, button[type="submit"]').first();

  await loginInput.fill(login, { timeout: 5000 }).catch(() => {});
  await passInput.fill(pass, { timeout: 5000 }).catch(() => {});
  await submitBtn.click({ timeout: 5000 }).catch(() => {});
  await sleep(2000);
}

async function closeAnyModal(page) {
  // Try multiple close button selectors
  for (const sel of ['#modalOverlay .modal-close', '.modal-close', 'button:has-text("✕")', 'button:has-text("Закрыть")']) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 500 })) {
        await btn.click({ timeout: 2000 });
        await sleep(500);
      }
    } catch (e) {}
  }
  // Click overlay to close
  try {
    const overlay = page.locator('#modalOverlay');
    if (await overlay.isVisible({ timeout: 300 })) {
      await overlay.click({ position: { x: 10, y: 10 }, timeout: 1000 });
      await sleep(500);
    }
  } catch(e) {}
}

async function run() {
  // Clean up old screenshots
  if (fs.existsSync(SCREENSHOT_DIR)) {
    fs.rmSync(SCREENSHOT_DIR, { recursive: true });
  }
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--ignore-certificate-errors']
  });

  const results = { roles: {}, errors: [], total_pages: 0, total_modals: 0 };

  for (const { role, login, pass } of ROLES) {
    const pages = ROLE_PAGES[role] || [];
    if (!pages.length) continue;

    const roleDir = path.join(SCREENSHOT_DIR, role);
    fs.mkdirSync(roleDir, { recursive: true });

    const context = await browser.newContext({
      viewport: VIEWPORT,
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    // Collect console errors
    const jsErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') jsErrors.push(msg.text().substring(0, 200));
    });

    console.log(`\n[${role}] Logging in as ${login}...`);
    await loginAs(page, login, pass);

    const roleResult = { pages: [], errors: [] };

    for (const pageName of pages) {
      try {
        console.log(`  [${role}] → /#/${pageName}`);
        jsErrors.length = 0;

        await page.goto(`${BASE_URL}/#/${pageName}`, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
        await sleep(2000);

        // Take page screenshot
        const filename = `${pageName}.png`;
        const filepath = path.join(roleDir, filename);
        await page.screenshot({ path: filepath, fullPage: false });
        results.total_pages++;

        const pageInfo = {
          name: pageName,
          screenshot: filepath,
          jsErrors: [...jsErrors],
          modals: []
        };

        // Try opening modals for this page
        const modals = PAGE_MODALS[pageName] || [];
        for (const modal of modals) {
          try {
            const btnLoc = page.locator(`button:has-text("${modal.btn}"), a:has-text("${modal.btn}")`).first();
            if (await btnLoc.isVisible({ timeout: 1000 })) {
              jsErrors.length = 0;
              await btnLoc.click({ timeout: 3000 });
              await sleep(1500);

              // Screenshot modal
              const modalFilename = `${pageName}__modal_${modal.name}.png`;
              const modalPath = path.join(roleDir, modalFilename);
              await page.screenshot({ path: modalPath, fullPage: false });
              results.total_modals++;

              pageInfo.modals.push({
                name: modal.name,
                screenshot: modalPath,
                jsErrors: [...jsErrors]
              });

              await closeAnyModal(page);
              await sleep(500);
            }
          } catch (e) {
            // Modal button not found or not accessible for this role
          }
        }

        // Also try clicking first table row to open detail modal (if table exists)
        try {
          const row = page.locator('table tbody tr, .card-list .card, .list-item').first();
          if (await row.isVisible({ timeout: 500 })) {
            const eye = page.locator('table tbody tr:first-child button:has-text("👁"), table tbody tr:first-child .btn-view').first();
            if (await eye.isVisible({ timeout: 500 })) {
              jsErrors.length = 0;
              await eye.click({ timeout: 2000 });
              await sleep(1500);

              const detailPath = path.join(roleDir, `${pageName}__detail.png`);
              await page.screenshot({ path: detailPath, fullPage: false });
              results.total_modals++;

              pageInfo.modals.push({
                name: 'detail-view',
                screenshot: detailPath,
                jsErrors: [...jsErrors]
              });

              await closeAnyModal(page);
              await sleep(500);
            }
          }
        } catch (e) {}

        roleResult.pages.push(pageInfo);

        if (pageInfo.jsErrors.length > 0) {
          roleResult.errors.push({ page: pageName, errors: pageInfo.jsErrors });
        }
      } catch (err) {
        console.log(`  [${role}] ERROR on ${pageName}: ${err.message}`);
        results.errors.push({ role, page: pageName, error: err.message });
      }
    }

    results.roles[role] = roleResult;
    await context.close();
  }

  await browser.close();

  // Write summary JSON
  const summaryPath = path.join(SCREENSHOT_DIR, 'summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2));

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('VISUAL AUDIT COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total pages screenshotted: ${results.total_pages}`);
  console.log(`Total modals screenshotted: ${results.total_modals}`);
  console.log(`Errors: ${results.errors.length}`);

  for (const [role, data] of Object.entries(results.roles)) {
    const errCount = data.errors.length;
    const pageCount = data.pages.length;
    console.log(`  [${role}] ${pageCount} pages, ${errCount} JS errors`);
    if (errCount > 0) {
      for (const e of data.errors) {
        console.log(`    ⚠️ ${e.page}: ${e.errors[0]}`);
      }
    }
  }

  console.log(`\nScreenshots: ${SCREENSHOT_DIR}/`);
  console.log(`Summary: ${summaryPath}`);
}

run().catch(console.error);
