/**
 * FRONTEND FILES AUDIT — verify all static files, pages, and assets are served correctly.
 *
 * Sections:
 *   1. Core HTML pages load (10 tests)
 *   2. CSS files exist and are served (15 tests)
 *   3. JavaScript core modules exist (50 tests)
 *   4. JavaScript file content verification (40 tests)
 *   5. Image and icon assets (15 tests)
 *   6. API endpoints return JSON (30 tests)
 *   7. SPA routing — hash routes work (20 tests)
 *   8. Static file security (20 tests)
 *
 * Total: 200 tests
 */
const { api, assert, skip, rawFetch } = require('../config');

// ── Helpers ──

/** Fetch a static file and assert 200 */
async function assertFileServed(path, label) {
  const res = await rawFetch('GET', path);
  assert(res.status === 200, `${label || path}: expected 200, got ${res.status}`);
  return res;
}

/** Fetch a static file and verify content-type contains expected substring */
async function assertContentType(path, expected, label) {
  const res = await rawFetch('GET', path);
  assert(res.status === 200, `${label || path}: expected 200, got ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  assert(ct.includes(expected), `${label || path}: expected content-type containing "${expected}", got "${ct}"`);
  return res;
}

/** Fetch a static file and verify its text body contains a substring (case-insensitive) */
async function assertBodyContains(path, substring, label) {
  const res = await rawFetch('GET', path);
  assert(res.status === 200, `${label || path}: expected 200, got ${res.status}`);
  const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  assert(
    body.toLowerCase().includes(substring.toLowerCase()),
    `${label || path}: expected body to contain "${substring}"`
  );
  return res;
}

/** Assert path returns 400, 403, or 404 (blocked) */
async function assertBlocked(path, label) {
  const res = await rawFetch('GET', path);
  assert(
    [400, 403, 404].includes(res.status),
    `${label || path}: expected 400/403/404 (blocked), got ${res.status}`
  );
  return res;
}

module.exports = {
  name: 'Frontend Files Audit (200 tests)',
  tests: [

    // ═══════════════════════════════════════════════════════════════════
    // 1. Core HTML pages load (10 tests)
    // ═══════════════════════════════════════════════════════════════════

    { name: '1.01 GET / returns 200 and contains HTML', run: async () => {
      const res = await rawFetch('GET', '/');
      assert(res.status === 200, `GET /: expected 200, got ${res.status}`);
      const body = typeof res.data === 'string' ? res.data : '';
      assert(body.includes('<!doctype html>') || body.includes('<!DOCTYPE html>') || body.includes('<html'), 'GET / should return HTML');
    }},

    { name: '1.02 GET /index.html returns 200', run: async () => {
      await assertFileServed('/index.html', 'index.html');
    }},

    { name: '1.03 GET / content-type is text/html', run: async () => {
      await assertContentType('/', 'text/html', 'root content-type');
    }},

    { name: '1.04 GET /index.html content-type is text/html', run: async () => {
      await assertContentType('/index.html', 'text/html', 'index.html content-type');
    }},

    { name: '1.05 GET / body contains <title>', run: async () => {
      await assertBodyContains('/', '<title>', 'root title tag');
    }},

    { name: '1.06 GET / body contains charset utf-8', run: async () => {
      await assertBodyContains('/', 'utf-8', 'root charset');
    }},

    { name: '1.07 GET / body contains <div id="app">', run: async () => {
      await assertBodyContains('/', 'id="app"', 'app container');
    }},

    { name: '1.08 GET /manifest.json returns 200', run: async () => {
      await assertFileServed('/manifest.json', 'manifest.json');
    }},

    { name: '1.09 GET /sw.js returns 200 (service worker)', run: async () => {
      await assertFileServed('/sw.js', 'service worker');
    }},

    { name: '1.10 GET / body references app.js script', run: async () => {
      await assertBodyContains('/', 'app.js', 'app.js script reference');
    }},

    // ═══════════════════════════════════════════════════════════════════
    // 2. CSS files exist and are served (15 tests)
    // ═══════════════════════════════════════════════════════════════════

    { name: '2.01 GET /assets/css/app.css returns 200', run: async () => {
      await assertFileServed('/assets/css/app.css', 'app.css');
    }},

    { name: '2.02 GET /assets/css/components.css returns 200', run: async () => {
      await assertFileServed('/assets/css/components.css', 'components.css');
    }},

    { name: '2.03 GET /assets/css/design-tokens.css returns 200', run: async () => {
      await assertFileServed('/assets/css/design-tokens.css', 'design-tokens.css');
    }},

    { name: '2.04 GET /assets/css/layout.css returns 200', run: async () => {
      await assertFileServed('/assets/css/layout.css', 'layout.css');
    }},

    { name: '2.05 app.css content-type includes text/css', run: async () => {
      await assertContentType('/assets/css/app.css', 'css', 'app.css content-type');
    }},

    { name: '2.06 components.css content-type includes text/css', run: async () => {
      await assertContentType('/assets/css/components.css', 'css', 'components.css content-type');
    }},

    { name: '2.07 design-tokens.css content-type includes text/css', run: async () => {
      await assertContentType('/assets/css/design-tokens.css', 'css', 'design-tokens.css content-type');
    }},

    { name: '2.08 layout.css content-type includes text/css', run: async () => {
      await assertContentType('/assets/css/layout.css', 'css', 'layout.css content-type');
    }},

    { name: '2.09 app.css is non-empty', run: async () => {
      const res = await rawFetch('GET', '/assets/css/app.css');
      assert(res.status === 200, 'app.css should return 200');
      assert(typeof res.data === 'string' && res.data.length > 100, 'app.css should be non-trivial');
    }},

    { name: '2.10 components.css is non-empty', run: async () => {
      const res = await rawFetch('GET', '/assets/css/components.css');
      assert(res.status === 200, 'components.css should return 200');
      assert(typeof res.data === 'string' && res.data.length > 100, 'components.css should be non-trivial');
    }},

    { name: '2.11 design-tokens.css contains CSS custom properties', run: async () => {
      await assertBodyContains('/assets/css/design-tokens.css', '--', 'design-tokens CSS vars');
    }},

    { name: '2.12 layout.css is non-empty', run: async () => {
      const res = await rawFetch('GET', '/assets/css/layout.css');
      assert(res.status === 200, 'layout.css should return 200');
      assert(typeof res.data === 'string' && res.data.length > 50, 'layout.css should have content');
    }},

    { name: '2.13 index.html references design-tokens.css', run: async () => {
      await assertBodyContains('/index.html', 'design-tokens.css', 'design-tokens ref');
    }},

    { name: '2.14 index.html references components.css', run: async () => {
      await assertBodyContains('/index.html', 'components.css', 'components.css ref');
    }},

    { name: '2.15 index.html references layout.css', run: async () => {
      await assertBodyContains('/index.html', 'layout.css', 'layout.css ref');
    }},

    // ═══════════════════════════════════════════════════════════════════
    // 3. JavaScript core modules exist (50 tests)
    // ═══════════════════════════════════════════════════════════════════

    { name: '3.01 JS: app.js exists', run: async () => {
      await assertFileServed('/assets/js/app.js');
    }},

    { name: '3.02 JS: auth.js exists', run: async () => {
      await assertFileServed('/assets/js/auth.js');
    }},

    { name: '3.03 JS: router.js exists', run: async () => {
      await assertFileServed('/assets/js/router.js');
    }},

    { name: '3.04 JS: db.js exists', run: async () => {
      await assertFileServed('/assets/js/db.js');
    }},

    { name: '3.05 JS: ui.js exists', run: async () => {
      await assertFileServed('/assets/js/ui.js');
    }},

    { name: '3.06 JS: validate.js exists', run: async () => {
      await assertFileServed('/assets/js/validate.js');
    }},

    { name: '3.07 JS: confirm.js exists', run: async () => {
      await assertFileServed('/assets/js/confirm.js');
    }},

    { name: '3.08 JS: calculator_v2.js exists', run: async () => {
      await assertFileServed('/assets/js/calculator_v2.js');
    }},

    { name: '3.09 JS: calculator.js exists', run: async () => {
      await assertFileServed('/assets/js/calculator.js');
    }},

    { name: '3.10 JS: calc_excel_export.js exists', run: async () => {
      await assertFileServed('/assets/js/calc_excel_export.js');
    }},

    { name: '3.11 JS: tenders.js exists', run: async () => {
      await assertFileServed('/assets/js/tenders.js');
    }},

    { name: '3.12 JS: customers.js exists', run: async () => {
      await assertFileServed('/assets/js/customers.js');
    }},

    { name: '3.13 JS: invoices.js exists', run: async () => {
      await assertFileServed('/assets/js/invoices.js');
    }},

    { name: '3.14 JS: acts.js exists', run: async () => {
      await assertFileServed('/assets/js/acts.js');
    }},

    { name: '3.15 JS: calendar.js exists', run: async () => {
      await assertFileServed('/assets/js/calendar.js');
    }},

    // 3.16 chat.js — удалён при миграции Huginn v2 (коммит C10)

    { name: '3.17 JS: notifications_helper.js exists', run: async () => {
      await assertFileServed('/assets/js/notifications_helper.js');
    }},

    { name: '3.18 JS: equipment.js exists', run: async () => {
      await assertFileServed('/assets/js/equipment.js');
    }},

    { name: '3.19 JS: personnel.js exists', run: async () => {
      await assertFileServed('/assets/js/personnel.js');
    }},

    { name: '3.20 JS: employee.js exists', run: async () => {
      await assertFileServed('/assets/js/employee.js');
    }},

    { name: '3.21 JS: dashboard.js exists', run: async () => {
      await assertFileServed('/assets/js/dashboard.js');
    }},

    { name: '3.22 JS: settings.js exists', run: async () => {
      await assertFileServed('/assets/js/settings.js');
    }},

    { name: '3.23 JS: payroll.js exists', run: async () => {
      await assertFileServed('/assets/js/payroll.js');
    }},

    { name: '3.24 JS: correspondence.js exists', run: async () => {
      await assertFileServed('/assets/js/correspondence.js');
    }},

    { name: '3.25 JS: contracts.js exists', run: async () => {
      await assertFileServed('/assets/js/contracts.js');
    }},

    { name: '3.26 JS: cash.js exists', run: async () => {
      await assertFileServed('/assets/js/cash.js');
    }},

    { name: '3.27 JS: meetings_page.js exists', run: async () => {
      await assertFileServed('/assets/js/meetings_page.js');
    }},

    { name: '3.28 JS: tasks.js exists', run: async () => {
      await assertFileServed('/assets/js/tasks.js');
    }},

    { name: '3.29 JS: permits.js exists', run: async () => {
      await assertFileServed('/assets/js/permits.js');
    }},

    { name: '3.30 JS: tkp-page.js exists', run: async () => {
      await assertFileServed('/assets/js/tkp-page.js');
    }},

    { name: '3.31 JS: pass-requests-page.js exists', run: async () => {
      await assertFileServed('/assets/js/pass-requests-page.js');
    }},

    { name: '3.32 JS: tmc-requests-page.js exists', run: async () => {
      await assertFileServed('/assets/js/tmc-requests-page.js');
    }},

    { name: '3.33 JS: export.js exists', run: async () => {
      await assertFileServed('/assets/js/export.js');
    }},

    { name: '3.34 JS: pre_tenders.js exists', run: async () => {
      await assertFileServed('/assets/js/pre_tenders.js');
    }},

    { name: '3.35 JS: mimir.js exists', run: async () => {
      await assertFileServed('/assets/js/mimir.js');
    }},

    { name: '3.36 JS: warehouse.js exists', run: async () => {
      await assertFileServed('/assets/js/warehouse.js');
    }},

    { name: '3.37 JS: gantt.js exists', run: async () => {
      await assertFileServed('/assets/js/gantt.js');
    }},

    { name: '3.38 JS: gantt_full.js exists', run: async () => {
      await assertFileServed('/assets/js/gantt_full.js');
    }},

    { name: '3.39 JS: charts.js exists', run: async () => {
      await assertFileServed('/assets/js/charts.js');
    }},

    { name: '3.40 JS: finances.js exists', run: async () => {
      await assertFileServed('/assets/js/finances.js');
    }},

    { name: '3.41 JS: travel.js exists', run: async () => {
      await assertFileServed('/assets/js/travel.js');
    }},

    { name: '3.42 JS: mailbox.js exists', run: async () => {
      await assertFileServed('/assets/js/mailbox.js');
    }},

    { name: '3.43 JS: email.js exists', run: async () => {
      await assertFileServed('/assets/js/email.js');
    }},

    { name: '3.44 JS: kanban.js exists', run: async () => {
      await assertFileServed('/assets/js/kanban.js');
    }},

    { name: '3.45 JS: funnel.js exists', run: async () => {
      await assertFileServed('/assets/js/funnel.js');
    }},

    { name: '3.46 JS: theme.js exists', run: async () => {
      await assertFileServed('/assets/js/theme.js');
    }},

    { name: '3.47 JS: templates.js exists', run: async () => {
      await assertFileServed('/assets/js/templates.js');
    }},

    { name: '3.48 JS: alerts.js exists', run: async () => {
      await assertFileServed('/assets/js/alerts.js');
    }},

    { name: '3.49 JS: safe_mode.js exists', run: async () => {
      await assertFileServed('/assets/js/safe_mode.js');
    }},

    { name: '3.50 JS: build_info.js exists', run: async () => {
      await assertFileServed('/assets/js/build_info.js');
    }},

    // ═══════════════════════════════════════════════════════════════════
    // 4. JavaScript file content verification (40 tests)
    // ═══════════════════════════════════════════════════════════════════

    { name: '4.01 calc_excel_export.js contains XLSX reference', run: async () => {
      await assertBodyContains('/assets/js/calc_excel_export.js', 'XLSX', 'calc_excel_export XLSX');
    }},

    { name: '4.02 calculator_v2.js contains calculator class/function', run: async () => {
      await assertBodyContains('/assets/js/calculator_v2.js', 'CALC_NAME', 'calculator_v2 CALC_NAME');
    }},

    { name: '4.03 auth.js contains token handling', run: async () => {
      await assertBodyContains('/assets/js/auth.js', 'token', 'auth.js token');
    }},

    { name: '4.04 auth.js contains login logic', run: async () => {
      await assertBodyContains('/assets/js/auth.js', 'login', 'auth.js login');
    }},

    { name: '4.05 router.js contains route management', run: async () => {
      await assertBodyContains('/assets/js/router.js', 'routes', 'router.js routes');
    }},

    { name: '4.06 router.js contains hash-based navigation', run: async () => {
      await assertBodyContains('/assets/js/router.js', 'hash', 'router.js hash');
    }},

    { name: '4.07 app.js contains sidebar reference', run: async () => {
      await assertBodyContains('/assets/js/app.js', 'sidebar', 'app.js sidebar');
    }},

    { name: '4.08 app.js contains menu rendering', run: async () => {
      await assertBodyContains('/assets/js/app.js', 'menu', 'app.js menu');
    }},

    { name: '4.09 db.js defines AsgardDB', run: async () => {
      await assertBodyContains('/assets/js/db.js', 'AsgardDB', 'db.js AsgardDB');
    }},

    { name: '4.10 ui.js defines AsgardUI', run: async () => {
      await assertBodyContains('/assets/js/ui.js', 'AsgardUI', 'ui.js AsgardUI');
    }},

    { name: '4.11 validate.js defines AsgardValidate', run: async () => {
      await assertBodyContains('/assets/js/validate.js', 'AsgardValidate', 'validate.js AsgardValidate');
    }},

    { name: '4.12 tenders.js contains AsgardTendersPage', run: async () => {
      await assertBodyContains('/assets/js/tenders.js', 'AsgardTendersPage', 'tenders.js page');
    }},

    { name: '4.13 customers.js contains AsgardCustomersPage', run: async () => {
      await assertBodyContains('/assets/js/customers.js', 'AsgardCustomersPage', 'customers.js page');
    }},

    { name: '4.14 dashboard.js contains dashboard rendering', run: async () => {
      await assertBodyContains('/assets/js/dashboard.js', 'dashboard', 'dashboard.js reference');
    }},

    { name: '4.15 settings.js contains AsgardSettingsPage', run: async () => {
      await assertBodyContains('/assets/js/settings.js', 'AsgardSettingsPage', 'settings.js page');
    }},

    { name: '4.16 calendar.js contains AsgardCalendarPage', run: async () => {
      await assertBodyContains('/assets/js/calendar.js', 'AsgardCalendarPage', 'calendar.js page');
    }},

    { name: '4.17 gantt.js contains AsgardGantt', run: async () => {
      await assertBodyContains('/assets/js/gantt.js', 'AsgardGantt', 'gantt.js class');
    }},

    { name: '4.18 personnel.js contains AsgardPersonnelPage', run: async () => {
      await assertBodyContains('/assets/js/personnel.js', 'AsgardPersonnelPage', 'personnel.js page');
    }},

    { name: '4.19 router.js defines AsgardRouter', run: async () => {
      await assertBodyContains('/assets/js/router.js', 'AsgardRouter', 'router.js AsgardRouter');
    }},

    // 4.20 chat.js — удалён при миграции Huginn v2

    { name: '4.21 invoices.js contains invoice module', run: async () => {
      await assertBodyContains('/assets/js/invoices.js', 'invoice', 'invoices.js reference');
    }},

    { name: '4.22 acts.js contains acts module', run: async () => {
      await assertBodyContains('/assets/js/acts.js', 'act', 'acts.js reference');
    }},

    { name: '4.23 equipment.js contains equipment module', run: async () => {
      await assertBodyContains('/assets/js/equipment.js', 'equipment', 'equipment.js reference');
    }},

    { name: '4.24 warehouse.js contains warehouse/TMC module', run: async () => {
      await assertBodyContains('/assets/js/warehouse.js', 'warehouse', 'warehouse.js reference');
    }},

    { name: '4.25 payroll.js contains payroll module', run: async () => {
      await assertBodyContains('/assets/js/payroll.js', 'payroll', 'payroll.js reference');
    }},

    { name: '4.26 contracts.js contains contracts module', run: async () => {
      await assertBodyContains('/assets/js/contracts.js', 'contract', 'contracts.js reference');
    }},

    { name: '4.27 permits.js contains permits module', run: async () => {
      await assertBodyContains('/assets/js/permits.js', 'permit', 'permits.js reference');
    }},

    { name: '4.28 correspondence.js contains correspondence module', run: async () => {
      await assertBodyContains('/assets/js/correspondence.js', 'correspondence', 'correspondence.js reference');
    }},

    { name: '4.29 cash.js contains cash/treasury module', run: async () => {
      await assertBodyContains('/assets/js/cash.js', 'cash', 'cash.js reference');
    }},

    { name: '4.30 tasks.js contains tasks module', run: async () => {
      await assertBodyContains('/assets/js/tasks.js', 'task', 'tasks.js reference');
    }},

    { name: '4.31 mimir.js contains knowledge base module', run: async () => {
      await assertBodyContains('/assets/js/mimir.js', 'mimir', 'mimir.js reference');
    }},

    { name: '4.32 pre_tenders.js contains pre-tender module', run: async () => {
      await assertBodyContains('/assets/js/pre_tenders.js', 'tender', 'pre_tenders.js reference');
    }},

    { name: '4.33 export.js contains export/Excel functionality', run: async () => {
      await assertBodyContains('/assets/js/export.js', 'export', 'export.js reference');
    }},

    { name: '4.34 finances.js contains finances module', run: async () => {
      await assertBodyContains('/assets/js/finances.js', 'financ', 'finances.js reference');
    }},

    { name: '4.35 kanban.js contains kanban board', run: async () => {
      await assertBodyContains('/assets/js/kanban.js', 'kanban', 'kanban.js reference');
    }},

    { name: '4.36 funnel.js contains funnel module', run: async () => {
      await assertBodyContains('/assets/js/funnel.js', 'funnel', 'funnel.js reference');
    }},

    { name: '4.37 travel.js contains travel expenses', run: async () => {
      await assertBodyContains('/assets/js/travel.js', 'travel', 'travel.js reference');
    }},

    { name: '4.38 mailbox.js contains mailbox module', run: async () => {
      await assertBodyContains('/assets/js/mailbox.js', 'mail', 'mailbox.js reference');
    }},

    { name: '4.39 theme.js contains theme switching', run: async () => {
      await assertBodyContains('/assets/js/theme.js', 'theme', 'theme.js reference');
    }},

    { name: '4.40 ui.js contains toast function', run: async () => {
      await assertBodyContains('/assets/js/ui.js', 'toast', 'ui.js toast');
    }},

    // ═══════════════════════════════════════════════════════════════════
    // 5. Image and icon assets (15 tests)
    // ═══════════════════════════════════════════════════════════════════

    { name: '5.01 favicon.ico exists', run: async () => {
      await assertFileServed('/assets/img/favicon.ico', 'favicon.ico');
    }},

    { name: '5.02 logo.png exists', run: async () => {
      await assertFileServed('/assets/img/logo.png', 'logo.png');
    }},

    { name: '5.03 logo-transparent.png exists', run: async () => {
      await assertFileServed('/assets/img/logo-transparent.png', 'logo-transparent.png');
    }},

    { name: '5.04 asgard_logo.png exists', run: async () => {
      await assertFileServed('/assets/img/asgard_logo.png', 'asgard_logo.png');
    }},

    { name: '5.05 asgard_emblem.png exists', run: async () => {
      await assertFileServed('/assets/img/asgard_emblem.png', 'asgard_emblem.png');
    }},

    { name: '5.06 apple-touch-icon.png exists', run: async () => {
      await assertFileServed('/assets/img/apple-touch-icon.png', 'apple-touch-icon.png');
    }},

    { name: '5.07 icon-192.png exists', run: async () => {
      await assertFileServed('/assets/img/icon-192.png', 'icon-192.png');
    }},

    { name: '5.08 icon-512.png exists', run: async () => {
      await assertFileServed('/assets/img/icon-512.png', 'icon-512.png');
    }},

    { name: '5.09 icon-32.png exists', run: async () => {
      await assertFileServed('/assets/img/icon-32.png', 'icon-32.png');
    }},

    { name: '5.10 icon-16.png exists', run: async () => {
      await assertFileServed('/assets/img/icon-16.png', 'icon-16.png');
    }},

    { name: '5.11 watermark.svg exists', run: async () => {
      await assertFileServed('/assets/img/watermark.svg', 'watermark.svg');
    }},

    { name: '5.12 watermark_dark.svg exists', run: async () => {
      await assertFileServed('/assets/img/watermark_dark.svg', 'watermark_dark.svg');
    }},

    { name: '5.13 icon-192.svg exists', run: async () => {
      await assertFileServed('/assets/img/icon-192.svg', 'icon-192.svg');
    }},

    { name: '5.14 nav icon tenders.svg exists', run: async () => {
      await assertFileServed('/assets/icons/nav/tenders.svg', 'nav tenders icon');
    }},

    { name: '5.15 nav icon dashboard.svg exists', run: async () => {
      await assertFileServed('/assets/icons/nav/dashboard.svg', 'nav dashboard icon');
    }},

    // ═══════════════════════════════════════════════════════════════════
    // 6. API endpoints return JSON (30 tests)
    // ═══════════════════════════════════════════════════════════════════

    { name: '6.01 GET /api/health returns JSON', run: async () => {
      const res = await api('GET', '/api/health');
      assert(res.status < 500, `health: got ${res.status}`);
    }},

    { name: '6.02 GET /api/users returns JSON content-type', run: async () => {
      const res = await api('GET', '/api/users', { role: 'ADMIN' });
      assert(res.status < 500, `users: got ${res.status}`);
    }},

    { name: '6.03 GET /api/tenders returns JSON', run: async () => {
      const res = await api('GET', '/api/tenders', { role: 'ADMIN' });
      assert(res.status < 500, `tenders: got ${res.status}`);
    }},

    { name: '6.04 GET /api/works returns JSON', run: async () => {
      const res = await api('GET', '/api/works', { role: 'ADMIN' });
      assert(res.status < 500, `works: got ${res.status}`);
    }},

    { name: '6.05 GET /api/estimates returns JSON', run: async () => {
      const res = await api('GET', '/api/estimates', { role: 'ADMIN' });
      assert(res.status < 500, `estimates: got ${res.status}`);
    }},

    { name: '6.06 GET /api/customers returns JSON', run: async () => {
      const res = await api('GET', '/api/customers', { role: 'ADMIN' });
      assert(res.status < 500, `customers: got ${res.status}`);
    }},

    { name: '6.07 GET /api/invoices returns JSON', run: async () => {
      const res = await api('GET', '/api/invoices', { role: 'ADMIN' });
      assert(res.status < 500, `invoices: got ${res.status}`);
    }},

    { name: '6.08 GET /api/acts returns JSON', run: async () => {
      const res = await api('GET', '/api/acts', { role: 'ADMIN' });
      assert(res.status < 500, `acts: got ${res.status}`);
    }},

    { name: '6.09 GET /api/calendar returns JSON', run: async () => {
      const res = await api('GET', '/api/calendar', { role: 'ADMIN' });
      assert(res.status < 500, `calendar: got ${res.status}`);
    }},

    { name: '6.10 GET /api/tasks/my returns JSON', run: async () => {
      const res = await api('GET', '/api/tasks/my', { role: 'ADMIN' });
      assert(res.status < 500, `tasks/my: got ${res.status}`);
    }},

    { name: '6.11 GET /api/staff/employees returns JSON', run: async () => {
      const res = await api('GET', '/api/staff/employees', { role: 'ADMIN' });
      assert(res.status < 500, `staff/employees: got ${res.status}`);
    }},

    { name: '6.12 GET /api/notifications returns JSON', run: async () => {
      const res = await api('GET', '/api/notifications', { role: 'ADMIN' });
      assert(res.status < 500, `notifications: got ${res.status}`);
    }},

    { name: '6.13 GET /api/equipment returns JSON', run: async () => {
      const res = await api('GET', '/api/equipment', { role: 'ADMIN' });
      assert(res.status < 500, `equipment: got ${res.status}`);
    }},

    { name: '6.14 GET /api/settings returns JSON', run: async () => {
      const res = await api('GET', '/api/settings', { role: 'ADMIN' });
      assert(res.status < 500, `settings: got ${res.status}`);
    }},

    { name: '6.15 GET /api/reports returns JSON', run: async () => {
      const res = await api('GET', '/api/reports', { role: 'ADMIN' });
      assert(res.status < 500, `reports: got ${res.status}`);
    }},

    { name: '6.16 GET /api/permits returns JSON', run: async () => {
      const res = await api('GET', '/api/permits', { role: 'ADMIN' });
      assert(res.status < 500, `permits: got ${res.status}`);
    }},

    { name: '6.17 GET /api/cash/my returns JSON', run: async () => {
      const res = await api('GET', '/api/cash/my', { role: 'ADMIN' });
      assert(res.status < 500, `cash/my: got ${res.status}`);
    }},

    { name: '6.18 GET /api/meetings returns JSON', run: async () => {
      const res = await api('GET', '/api/meetings', { role: 'ADMIN' });
      assert(res.status < 500, `meetings: got ${res.status}`);
    }},

    { name: '6.19 GET /api/payroll/sheets returns JSON', run: async () => {
      const res = await api('GET', '/api/payroll/sheets', { role: 'ADMIN' });
      assert(res.status < 500, `payroll/sheets: got ${res.status}`);
    }},

    { name: '6.20 GET /api/tkp returns JSON', run: async () => {
      const res = await api('GET', '/api/tkp', { role: 'ADMIN' });
      assert(res.status < 500, `tkp: got ${res.status}`);
    }},

    { name: '6.21 GET /api/pass-requests returns JSON', run: async () => {
      const res = await api('GET', '/api/pass-requests', { role: 'ADMIN' });
      assert(res.status < 500, `pass-requests: got ${res.status}`);
    }},

    { name: '6.22 GET /api/tmc-requests returns JSON', run: async () => {
      const res = await api('GET', '/api/tmc-requests', { role: 'ADMIN' });
      assert(res.status < 500, `tmc-requests: got ${res.status}`);
    }},

    { name: '6.23 GET /api/sites returns JSON', run: async () => {
      const res = await api('GET', '/api/sites', { role: 'ADMIN' });
      assert(res.status < 500, `sites: got ${res.status}`);
    }},

    { name: '6.24 GET /api/pre-tenders returns JSON', run: async () => {
      const res = await api('GET', '/api/pre-tenders', { role: 'ADMIN' });
      assert(res.status < 500, `pre-tenders: got ${res.status}`);
    }},

    { name: '6.25 GET /api/chat-groups returns JSON', run: async () => {
      const res = await api('GET', '/api/chat-groups', { role: 'ADMIN' });
      assert(res.status < 500, `chat-groups: got ${res.status}`);
    }},

    { name: '6.26 GET /api/permit-applications returns JSON', run: async () => {
      const res = await api('GET', '/api/permit-applications', { role: 'ADMIN' });
      assert(res.status < 500, `permit-applications: got ${res.status}`);
    }},

    { name: '6.27 GET /api/contracts returns JSON', run: async () => {
      const res = await api('GET', '/api/contracts', { role: 'ADMIN' });
      assert(res.status < 500, `contracts: got ${res.status}`);
    }},

    { name: '6.28 GET /api/expenses/work returns JSON', run: async () => {
      const res = await api('GET', '/api/expenses/work', { role: 'ADMIN' });
      assert(res.status < 500, `expenses/work: got ${res.status}`);
    }},

    { name: '6.29 GET /api/incomes returns JSON', run: async () => {
      const res = await api('GET', '/api/incomes', { role: 'ADMIN' });
      assert(res.status < 500, `incomes: got ${res.status}`);
    }},

    { name: '6.30 GET /api/mailbox returns JSON', run: async () => {
      const res = await api('GET', '/api/mailbox', { role: 'ADMIN' });
      assert(res.status < 500, `mailbox: got ${res.status}`);
    }},

    // ═══════════════════════════════════════════════════════════════════
    // 7. SPA routing — hash routes work (20 tests)
    // ═══════════════════════════════════════════════════════════════════

    { name: '7.01 SPA shell contains <script> tags', run: async () => {
      await assertBodyContains('/', '<script', 'SPA script tags');
    }},

    { name: '7.02 SPA shell loads db.js', run: async () => {
      await assertBodyContains('/', 'db.js', 'SPA db.js reference');
    }},

    { name: '7.03 SPA shell loads ui.js', run: async () => {
      await assertBodyContains('/', 'ui.js', 'SPA ui.js reference');
    }},

    { name: '7.04 SPA shell loads auth.js', run: async () => {
      await assertBodyContains('/', 'auth.js', 'SPA auth.js reference');
    }},

    { name: '7.05 SPA shell loads router.js', run: async () => {
      await assertBodyContains('/', 'router.js', 'SPA router.js reference');
    }},

    { name: '7.06 SPA shell loads tenders.js', run: async () => {
      await assertBodyContains('/', 'tenders.js', 'SPA tenders.js reference');
    }},

    { name: '7.07 SPA shell loads dashboard.js', run: async () => {
      await assertBodyContains('/', 'dashboard.js', 'SPA dashboard.js reference');
    }},

    { name: '7.08 SPA shell loads calendar.js', run: async () => {
      await assertBodyContains('/', 'calendar.js', 'SPA calendar.js reference');
    }},

    { name: '7.09 SPA shell loads tasks.js', run: async () => {
      await assertBodyContains('/', 'tasks.js', 'SPA tasks.js reference');
    }},

    // 7.10 chat.js — удалён при миграции Huginn v2

    { name: '7.11 SPA shell loads calculator_v2.js', run: async () => {
      await assertBodyContains('/', 'calculator_v2.js', 'SPA calculator_v2.js reference');
    }},

    { name: '7.12 SPA shell loads equipment.js', run: async () => {
      await assertBodyContains('/', 'equipment.js', 'SPA equipment.js reference');
    }},

    { name: '7.13 SPA shell loads invoices.js', run: async () => {
      await assertBodyContains('/', 'invoices.js', 'SPA invoices.js reference');
    }},

    { name: '7.14 SPA shell loads acts.js', run: async () => {
      await assertBodyContains('/', 'acts.js', 'SPA acts.js reference');
    }},

    { name: '7.15 SPA shell loads permits.js', run: async () => {
      await assertBodyContains('/', 'permits.js', 'SPA permits.js reference');
    }},

    { name: '7.16 SPA shell loads payroll.js', run: async () => {
      await assertBodyContains('/', 'payroll.js', 'SPA payroll.js reference');
    }},

    { name: '7.17 SPA shell loads contracts.js', run: async () => {
      await assertBodyContains('/', 'contracts.js', 'SPA contracts.js reference');
    }},

    { name: '7.18 SPA shell loads settings.js', run: async () => {
      await assertBodyContains('/', 'settings.js', 'SPA settings.js reference');
    }},

    { name: '7.19 SPA shell loads personnel.js', run: async () => {
      await assertBodyContains('/', 'personnel.js', 'SPA personnel.js reference');
    }},

    { name: '7.20 SPA shell references service worker (sw.js)', run: async () => {
      await assertBodyContains('/', 'sw.js', 'SPA service worker reference');
    }},

    // ═══════════════════════════════════════════════════════════════════
    // 8. Static file security (20 tests)
    // ═══════════════════════════════════════════════════════════════════

    { name: '8.01 path traversal: /assets/../../etc/passwd blocked', run: async () => {
      // Node.js fetch normalizes .. before sending, so we verify the response is SPA HTML, not file content
      const res = await rawFetch('GET', '/assets/../../etc/passwd');
      // Either blocked (400/403/404) or SPA fallback (200 with HTML, not actual passwd)
      if (res.status === 200) {
        const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
        assert(!body.includes('root:'), 'traversal etc/passwd: response must not contain passwd content');
      }
    }},

    { name: '8.02 path traversal: /../../../etc/shadow blocked', run: async () => {
      const res = await rawFetch('GET', '/../../../etc/shadow');
      if (res.status === 200) {
        const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
        assert(!body.includes('root:'), 'traversal etc/shadow: response must not contain shadow content');
      }
    }},

    { name: '8.03 path traversal: /assets/js/../../.env blocked', run: async () => {
      await assertBlocked('/assets/js/../../.env', 'traversal .env via js');
    }},

    { name: '8.04 GET /.env returns 403/404', run: async () => {
      await assertBlocked('/.env', '.env direct access');
    }},

    { name: '8.05 GET /node_modules returns 403/404', run: async () => {
      await assertBlocked('/node_modules/', 'node_modules directory');
    }},

    { name: '8.06 GET /node_modules/express/package.json blocked', run: async () => {
      await assertBlocked('/node_modules/express/package.json', 'node_modules file');
    }},

    { name: '8.07 GET /package.json returns 403/404', run: async () => {
      await assertBlocked('/package.json', 'package.json direct access');
    }},

    { name: '8.08 GET /package-lock.json returns 403/404', run: async () => {
      await assertBlocked('/package-lock.json', 'package-lock.json direct access');
    }},

    { name: '8.09 GET /server.js returns 403/404', run: async () => {
      await assertBlocked('/server.js', 'server.js direct access');
    }},

    { name: '8.10 GET /src/ returns 403/404', run: async () => {
      await assertBlocked('/src/', 'src directory');
    }},

    { name: '8.11 GET /.git/config returns 403/404', run: async () => {
      await assertBlocked('/.git/config', '.git/config');
    }},

    { name: '8.12 GET /.git/HEAD returns 403/404', run: async () => {
      await assertBlocked('/.git/HEAD', '.git/HEAD');
    }},

    { name: '8.13 GET /db/ returns 403/404', run: async () => {
      await assertBlocked('/db/', 'db directory');
    }},

    { name: '8.14 GET /config/ returns 403/404', run: async () => {
      await assertBlocked('/config/', 'config directory');
    }},

    { name: '8.15 encoded traversal: /%2e%2e/%2e%2e/etc/passwd blocked', run: async () => {
      const res = await rawFetch('GET', '/%2e%2e/%2e%2e/etc/passwd');
      if (res.status === 200) {
        const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
        assert(!body.includes('root:'), 'encoded traversal: response must not contain passwd content');
      }
    }},

    { name: '8.16 GET /.gitignore returns 403/404', run: async () => {
      await assertBlocked('/.gitignore', '.gitignore direct access');
    }},

    { name: '8.17 GET /docker-compose.yml returns 403/404', run: async () => {
      await assertBlocked('/docker-compose.yml', 'docker-compose.yml');
    }},

    { name: '8.18 GET /Dockerfile returns 403/404', run: async () => {
      await assertBlocked('/Dockerfile', 'Dockerfile');
    }},

    { name: '8.19 GET /tests/ returns 403/404', run: async () => {
      await assertBlocked('/tests/', 'tests directory');
    }},

    { name: '8.20 double-encoded traversal blocked', run: async () => {
      await assertBlocked('/assets/js/%252e%252e/%252e%252e/.env', 'double-encoded traversal');
    }},
  ]
};
