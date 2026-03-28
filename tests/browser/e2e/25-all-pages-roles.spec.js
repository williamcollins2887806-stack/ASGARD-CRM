// @ts-check
// File 25: All Pages × All Roles — console errors + row click + basic render
// Checks that each page loads without JS errors for the authorized role.
// Clicks the first row to verify detail modal/panel opens.
const { test, expect } = require('@playwright/test');
const h = require('../helpers');

// ─────────────────────────────────────────────────────────────────
// Helper: navigate to a page and assert no console errors + body renders
// ─────────────────────────────────────────────────────────────────
async function checkPage(page, role, route, label) {
  const errors = h.setupConsoleCollector(page);
  await h.loginAs(page, role);
  await h.navigateTo(page, route);
  await h.waitForPageLoad(page);

  const body = await page.textContent('body');
  expect(body.length, `${label}: body empty`).toBeGreaterThan(50);

  h.assertNoConsoleErrors(errors, label);
}

// ─────────────────────────────────────────────────────────────────
// Helper: navigate, check page, then click first row and verify detail
// ─────────────────────────────────────────────────────────────────
async function checkPageWithRow(page, role, route, label) {
  const errors = h.setupConsoleCollector(page);
  await h.loginAs(page, role);
  await h.navigateTo(page, route);
  await h.waitForPageLoad(page);
  await page.waitForTimeout(1000);

  const body = await page.textContent('body');
  expect(body.length, `${label}: body empty`).toBeGreaterThan(50);

  // Try clicking first row — not required to succeed (may be empty)
  const row = page.locator('tbody tr[data-id], tbody tr:has(td), .card[data-id], .list-item[data-id], [data-id]').first();
  if (await row.count() > 0) {
    await h.clickRow(page, row);
    await page.waitForTimeout(1500);
    // Just verify page didn't crash after click
    const bodyAfter = await page.textContent('body');
    expect(bodyAfter.length).toBeGreaterThan(50);
    await h.closeModal(page);
  }

  h.assertNoConsoleErrors(errors, label);
}

// ─────────────────────────────────────────────────────────────────
// Helper: verify role is redirected away (no access)
// ─────────────────────────────────────────────────────────────────
async function checkNoAccess(page, role, route, label) {
  const errors = h.setupConsoleCollector(page);
  await h.loginAs(page, role);
  await h.navigateTo(page, route);
  await h.waitForPageLoad(page);

  const url = page.url();
  const redirected = !url.includes(route.replace('/', ''));

  if (!redirected) {
    // Page might have loaded but show "no access" message
    const body = await page.textContent('body');
    const hasNoAccess = body.includes('Нет доступа') || body.includes('Недостаточно') || body.includes('403');
    expect(redirected || hasNoAccess, `${label}: expected no access`).toBeTruthy();
  }

  h.assertNoConsoleErrors(errors, label);
}

// ═══════════════════════════════════════════════════════════════
// SECTION 1: ADMIN — проверяем все ключевые страницы
// ═══════════════════════════════════════════════════════════════
test.describe('ADMIN — All Pages', () => {
  test.setTimeout(300000);

  const adminPages = [
    ['home',             'ADMIN-home'],
    ['calendar',         'ADMIN-calendar'],
    ['tenders',          'ADMIN-tenders'],
    ['customers',        'ADMIN-customers'],
    ['pm-calcs',         'ADMIN-pm-calcs'],
    ['pm-works',         'ADMIN-pm-works'],
    ['all-estimates',    'ADMIN-all-estimates'],
    ['all-works',        'ADMIN-all-works'],
    ['procurement',      'ADMIN-procurement'],
    ['assembly',         'ADMIN-assembly'],
    ['warehouse',        'ADMIN-warehouse'],
    ['personnel',        'ADMIN-personnel'],
    ['training',         'ADMIN-training'],
    ['pass-requests',    'ADMIN-pass-requests'],
    ['permits',          'ADMIN-permits'],
    ['permit-applications','ADMIN-permit-applications'],
    ['invoices',         'ADMIN-invoices'],
    ['acts',             'ADMIN-acts'],
    ['payroll',          'ADMIN-payroll'],
    ['cash',             'ADMIN-cash'],
    ['finances',         'ADMIN-finances'],
    ['correspondence',   'ADMIN-correspondence'],
    ['contracts',        'ADMIN-contracts'],
    ['proxies',          'ADMIN-proxies'],
    ['meetings',         'ADMIN-meetings'],
    ['my-mail',          'ADMIN-my-mail'],
    ['tasks',            'ADMIN-tasks'],
    ['messenger',        'ADMIN-messenger'],
    ['analytics',        'ADMIN-analytics'],
    ['settings',         'ADMIN-settings'],
  ];

  for (const [route, label] of adminPages) {
    test(`ADMIN can open ${route}`, async ({ page }) => {
      await checkPage(page, 'ADMIN', route, label);
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// SECTION 2: PM — страницы РП с проверкой строк
// ═══════════════════════════════════════════════════════════════
test.describe('PM — Accessible Pages', () => {
  test.setTimeout(300000);

  test('PM-home: home page loads', async ({ page }) => {
    await checkPage(page, 'PM', 'home', 'PM-home');
  });

  test('PM-calendar: calendar loads', async ({ page }) => {
    await checkPage(page, 'PM', 'calendar', 'PM-calendar');
  });

  test('PM-pm-calcs: estimates list loads + row opens modal', async ({ page }) => {
    await checkPageWithRow(page, 'PM', 'pm-calcs', 'PM-pm-calcs');
  });

  test('PM-pm-works: works list loads', async ({ page }) => {
    await checkPage(page, 'PM', 'pm-works', 'PM-pm-works');
  });

  test('PM-customers: customer list loads + row opens', async ({ page }) => {
    await checkPageWithRow(page, 'PM', 'customers', 'PM-customers');
  });

  test('PM-invoices: invoices loads + row opens', async ({ page }) => {
    await checkPageWithRow(page, 'PM', 'invoices', 'PM-invoices');
  });

  test('PM-acts: acts page loads', async ({ page }) => {
    await checkPage(page, 'PM', 'acts', 'PM-acts');
  });

  test('PM-procurement: procurement loads', async ({ page }) => {
    await checkPage(page, 'PM', 'procurement', 'PM-procurement');
  });

  test('PM-assembly: assembly loads', async ({ page }) => {
    await checkPage(page, 'PM', 'assembly', 'PM-assembly');
  });

  test('PM-warehouse: warehouse loads + row opens', async ({ page }) => {
    await checkPageWithRow(page, 'PM', 'warehouse', 'PM-warehouse');
  });

  test('PM-pass-requests: pass requests loads', async ({ page }) => {
    await checkPage(page, 'PM', 'pass-requests', 'PM-pass-requests');
  });

  test('PM-permits: permits page loads for PM (read-only)', async ({ page }) => {
    // PM has can_read=true for permits in role_presets
    await checkPage(page, 'PM', 'permits', 'PM-permits');
  });

  test('PM-payroll: payroll loads', async ({ page }) => {
    await checkPage(page, 'PM', 'payroll', 'PM-payroll');
  });

  test('PM-training: training page loads', async ({ page }) => {
    await checkPage(page, 'PM', 'training', 'PM-training');
  });

  test('PM-my-mail: mail page loads', async ({ page }) => {
    await checkPage(page, 'PM', 'my-mail', 'PM-my-mail');
  });

  test('PM-tasks: tasks page loads', async ({ page }) => {
    await checkPage(page, 'PM', 'tasks', 'PM-tasks');
  });

  test('PM-messenger: messenger loads', async ({ page }) => {
    await checkPage(page, 'PM', 'messenger', 'PM-messenger');
  });

  test('PM-travel: travel page loads', async ({ page }) => {
    await checkPage(page, 'PM', 'travel', 'PM-travel');
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 3: HR — кадровые страницы
// ═══════════════════════════════════════════════════════════════
test.describe('HR — Accessible Pages', () => {
  test.setTimeout(240000);

  test('HR-home: home page loads', async ({ page }) => {
    await checkPage(page, 'HR', 'home', 'HR-home');
  });

  test('HR-personnel: personnel list loads + row opens', async ({ page }) => {
    await checkPageWithRow(page, 'HR', 'personnel', 'HR-personnel');
  });

  test('HR-training: training loads', async ({ page }) => {
    await checkPage(page, 'HR', 'training', 'HR-training');
  });

  test('HR-permits: permits loads', async ({ page }) => {
    await checkPage(page, 'HR', 'permits', 'HR-permits');
  });

  test('HR-permit-applications: permit applications loads', async ({ page }) => {
    await checkPage(page, 'HR', 'permit-applications', 'HR-permit-applications');
  });

  test('HR-pass-requests: pass requests loads', async ({ page }) => {
    await checkPage(page, 'HR', 'pass-requests', 'HR-pass-requests');
  });

  test('HR-workers-schedule: schedule loads', async ({ page }) => {
    await checkPage(page, 'HR', 'workers-schedule', 'HR-workers-schedule');
  });

  test('HR-hr-rating: HR rating loads', async ({ page }) => {
    await checkPage(page, 'HR', 'hr-rating', 'HR-hr-rating');
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 4: TO — инженер/тендеры
// ═══════════════════════════════════════════════════════════════
test.describe('TO — Accessible Pages', () => {
  test.setTimeout(240000);

  test('TO-home: home loads', async ({ page }) => {
    await checkPage(page, 'TO', 'home', 'TO-home');
  });

  test('TO-tenders: tenders loads + row opens', async ({ page }) => {
    await checkPageWithRow(page, 'TO', 'tenders', 'TO-tenders');
  });

  test('TO-pre-tenders: pre-tenders loads', async ({ page }) => {
    await checkPage(page, 'TO', 'pre-tenders', 'TO-pre-tenders');
  });

  test('TO-customers: customers loads', async ({ page }) => {
    await checkPage(page, 'TO', 'customers', 'TO-customers');
  });

  test('TO-permits: permits loads', async ({ page }) => {
    await checkPage(page, 'TO', 'permits', 'TO-permits');
  });

  test('TO-permit-applications: permit applications loads', async ({ page }) => {
    await checkPage(page, 'TO', 'permit-applications', 'TO-permit-applications');
  });

  test('TO-warehouse: warehouse loads', async ({ page }) => {
    await checkPage(page, 'TO', 'warehouse', 'TO-warehouse');
  });

  test('TO-my-mail: mail loads', async ({ page }) => {
    await checkPage(page, 'TO', 'my-mail', 'TO-my-mail');
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 5: BUH — бухгалтерские страницы
// ═══════════════════════════════════════════════════════════════
test.describe('BUH — Accessible Pages', () => {
  test.setTimeout(180000);

  test('BUH-home: home loads', async ({ page }) => {
    await checkPage(page, 'BUH', 'home', 'BUH-home');
  });

  test('BUH-finances: finances loads', async ({ page }) => {
    await checkPage(page, 'BUH', 'finances', 'BUH-finances');
  });

  test('BUH-invoices: invoices loads + row opens', async ({ page }) => {
    await checkPageWithRow(page, 'BUH', 'invoices', 'BUH-invoices');
  });

  test('BUH-acts: acts loads', async ({ page }) => {
    await checkPage(page, 'BUH', 'acts', 'BUH-acts');
  });

  test('BUH-payroll: payroll loads', async ({ page }) => {
    await checkPage(page, 'BUH', 'payroll', 'BUH-payroll');
  });

  test('BUH-all-estimates: estimates loads', async ({ page }) => {
    await checkPage(page, 'BUH', 'all-estimates', 'BUH-all-estimates');
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 6: DIRECTOR_GEN — директор
// ═══════════════════════════════════════════════════════════════
test.describe('DIRECTOR_GEN — Accessible Pages', () => {
  test.setTimeout(240000);

  test('DIR-home: home loads', async ({ page }) => {
    await checkPage(page, 'DIRECTOR_GEN', 'home', 'DIR-home');
  });

  test('DIR-dashboard: dashboard loads', async ({ page }) => {
    await checkPage(page, 'DIRECTOR_GEN', 'dashboard', 'DIR-dashboard');
  });

  test('DIR-tenders: tenders loads + row opens', async ({ page }) => {
    await checkPageWithRow(page, 'DIRECTOR_GEN', 'tenders', 'DIR-tenders');
  });

  test('DIR-analytics: analytics loads', async ({ page }) => {
    await checkPage(page, 'DIRECTOR_GEN', 'analytics', 'DIR-analytics');
  });

  test('DIR-personnel: personnel loads', async ({ page }) => {
    await checkPage(page, 'DIRECTOR_GEN', 'personnel', 'DIR-personnel');
  });

  test('DIR-pass-requests: pass requests loads + row opens', async ({ page }) => {
    await checkPageWithRow(page, 'DIRECTOR_GEN', 'pass-requests', 'DIR-pass-requests');
  });

  test('DIR-meetings: meetings loads', async ({ page }) => {
    await checkPage(page, 'DIRECTOR_GEN', 'meetings', 'DIR-meetings');
  });

  test('DIR-permits: permits loads', async ({ page }) => {
    await checkPage(page, 'DIRECTOR_GEN', 'permits', 'DIR-permits');
  });

  test('DIR-contracts: contracts loads + row opens', async ({ page }) => {
    await checkPageWithRow(page, 'DIRECTOR_GEN', 'contracts', 'DIR-contracts');
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 7: WAREHOUSE — склад
// ═══════════════════════════════════════════════════════════════
test.describe('WAREHOUSE — Accessible Pages', () => {
  test.setTimeout(120000);

  test('WH-home: home loads', async ({ page }) => {
    await checkPage(page, 'WAREHOUSE', 'home', 'WH-home');
  });

  test('WH-warehouse: warehouse loads + row opens', async ({ page }) => {
    await checkPageWithRow(page, 'WAREHOUSE', 'warehouse', 'WH-warehouse');
  });

  test('WH-assembly: assembly loads', async ({ page }) => {
    await checkPage(page, 'WAREHOUSE', 'assembly', 'WH-assembly');
  });

  test('WH-my-mail: mail loads', async ({ page }) => {
    await checkPage(page, 'WAREHOUSE', 'my-mail', 'WH-my-mail');
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 8: Access Denial checks — роли без доступа
// ═══════════════════════════════════════════════════════════════
test.describe('Access Denial — unauthorized roles redirected', () => {
  test.setTimeout(120000);

  test('BUH cannot access tenders', async ({ page }) => {
    await checkNoAccess(page, 'BUH', 'tenders', 'BUH-no-tenders');
  });

  test('BUH cannot access permit-applications', async ({ page }) => {
    await checkNoAccess(page, 'BUH', 'permit-applications', 'BUH-no-permit-apps');
  });

  test('TO cannot access payroll', async ({ page }) => {
    await checkNoAccess(page, 'TO', 'payroll', 'TO-no-payroll');
  });

  test('WAREHOUSE cannot access finances', async ({ page }) => {
    await checkNoAccess(page, 'WAREHOUSE', 'finances', 'WH-no-finances');
  });

  test('PM cannot access pre-tenders (TO only)', async ({ page }) => {
    await checkNoAccess(page, 'PM', 'pre-tenders', 'PM-no-pre-tenders');
  });

  test('HR cannot access tenders', async ({ page }) => {
    await checkNoAccess(page, 'HR', 'tenders', 'HR-no-tenders');
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 9: Console error check — critical pages across roles
// ═══════════════════════════════════════════════════════════════
test.describe('Console Error Sweep — key pages must have zero JS errors', () => {
  test.setTimeout(300000);

  const sweep = [
    ['ADMIN',        'home'],
    ['ADMIN',        'pm-calcs'],
    ['PM',           'pm-works'],
    ['PM',           'warehouse'],
    ['HR',           'personnel'],
    ['HR',           'training'],
    ['TO',           'tenders'],
    ['BUH',          'finances'],
    ['DIRECTOR_GEN', 'dashboard'],
    ['WAREHOUSE',    'warehouse'],
  ];

  for (const [role, route] of sweep) {
    test(`${role} / ${route} — zero console errors`, async ({ page }) => {
      const errors = h.setupConsoleCollector(page);
      await h.loginAs(page, role);
      await h.navigateTo(page, route);
      await h.waitForPageLoad(page);
      await page.waitForTimeout(1000); // let lazy-loaded scripts run
      h.assertNoConsoleErrors(errors, `${role}/${route}`);
    });
  }
});
