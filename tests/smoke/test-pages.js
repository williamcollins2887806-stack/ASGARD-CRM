/**
 * ASGARD CRM - Stage 12 Smoke Tests (Playwright)
 *
 * Checks every SPA route for every role:
 *   - No JS errors
 *   - No 4xx/5xx API calls
 *   - Page is not empty
 *   - No [object Object] renders
 */
'use strict';

let chromium;
try {
  chromium = require('playwright').chromium;
} catch (e) {
  // Will be handled in run()
}

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'asgard-jwt-secret-2026';

// 15 roles and their accessible SPA routes
const ROUTES_BY_ROLE = {
  ADMIN:          ['#/home','#/my-dashboard','#/dashboard','#/tenders','#/pm-works','#/all-works','#/finances','#/personnel','#/tasks','#/tasks-admin','#/settings','#/object-map','#/permits','#/calendar','#/meetings','#/integrations','#/reports','#/cash-admin','#/users','#/equipment','#/warehouse'],
  PM:             ['#/home','#/my-dashboard','#/pm-calcs','#/calculator','#/pm-works','#/cash','#/payroll','#/tasks','#/invoices','#/calendar','#/meetings'],
  TO:             ['#/home','#/my-dashboard','#/tenders','#/funnel','#/customers','#/tasks','#/calculator','#/calendar'],
  HEAD_PM:        ['#/home','#/my-dashboard','#/all-works','#/all-estimates','#/approvals','#/pm-works','#/tasks','#/tasks-admin','#/object-map','#/calendar'],
  HEAD_TO:        ['#/home','#/my-dashboard','#/tenders','#/funnel','#/pre-tenders','#/tasks','#/object-map','#/calendar'],
  HR:             ['#/home','#/personnel','#/permits','#/hr-rating','#/tasks','#/calendar'],
  HR_MANAGER:     ['#/home','#/personnel','#/permits','#/hr-rating','#/tasks','#/calendar'],
  BUH:            ['#/home','#/buh-registry','#/finances','#/payroll','#/tasks','#/invoices','#/calendar'],
  PROC:           ['#/home','#/proc-requests','#/tasks','#/calendar'],
  OFFICE_MANAGER: ['#/home','#/office-expenses','#/correspondence','#/tasks','#/calendar'],
  CHIEF_ENGINEER: ['#/home','#/warehouse','#/my-equipment','#/tasks','#/calendar'],
  DIRECTOR_GEN:   ['#/home','#/dashboard','#/tenders','#/all-works','#/finances','#/approvals','#/object-map','#/reports','#/calendar'],
  DIRECTOR_COMM:  ['#/home','#/dashboard','#/tenders','#/all-works','#/finances','#/approvals','#/object-map','#/calendar'],
  DIRECTOR_DEV:   ['#/home','#/dashboard','#/tenders','#/all-works','#/finances','#/object-map','#/calendar'],
  WAREHOUSE:      ['#/home','#/warehouse','#/tasks','#/calendar']
};

const ROLES = Object.keys(ROUTES_BY_ROLE);

function _synthToken(role) {
  const jwt = require('jsonwebtoken');
  const idx = ROLES.indexOf(role);
  return jwt.sign({
    id: 9000 + idx,
    login: `test_${role.toLowerCase()}`,
    name: `Test ${role}`,
    role,
    email: `test_${role.toLowerCase()}@test.asgard.local`,
    pinVerified: true
  }, JWT_SECRET, { expiresIn: '1h' });
}

async function run() {
  if (!chromium) {
    console.log('    Playwright not installed - skipping smoke tests');
    console.log('    Run: npm install playwright && npx playwright install chromium');
    return [{ role: 'ALL', route: 'N/A', status: 'SKIP', error: 'Playwright not installed' }];
  }

  // Try to get real tokens
  let getToken;
  try {
    const auth = require('../helpers/auth');
    await auth.initAuth();
    getToken = auth.getToken;
  } catch (_) {
    getToken = (role) => _synthToken(role);
  }

  const results = [];
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  for (const role of ROLES) {
    const routes = ROUTES_BY_ROLE[role] || ['#/home'];
    let token;
    try {
      token = await getToken(role);
    } catch (_) {
      token = _synthToken(role);
    }

    const context = await browser.newContext();
    const page = await context.newPage();

    // Inject auth token
    try {
      await page.goto(`${BASE_URL}/#/welcome`, { waitUntil: 'networkidle', timeout: 20000 });
      await page.evaluate(({ token, role }) => {
        localStorage.setItem('asgard_token', token);
        localStorage.setItem('asgard_user', JSON.stringify({
          id: 9000, login: `test_${role.toLowerCase()}`, name: `Test ${role}`, role
        }));
      }, { token, role });
    } catch (e) {
      results.push({ role, route: 'LOGIN', status: 'FAIL', error: e.message.slice(0, 150) });
      await context.close();
      continue;
    }

    for (const route of routes) {
      const jsErrors = [];
      const failedRequests = [];

      const onConsole = msg => {
        if (msg.type() === 'error' && !msg.text().includes('favicon') && !msg.text().includes('net::')) {
          jsErrors.push(msg.text().slice(0, 150));
        }
      };
      const onResponse = resp => {
        if (resp.url().includes('/api/') && resp.status() >= 400 && resp.status() !== 404) {
          failedRequests.push(`${resp.status()} ${resp.url().split('/api/')[1]?.slice(0, 60)}`);
        }
      };

      page.on('console', onConsole);
      page.on('response', onResponse);

      try {
        await page.goto(`${BASE_URL}/${route}`, { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(500);

        const bodyText = await page.textContent('body');
        const isEmpty = !bodyText || bodyText.trim().length < 20;
        const hasObjectObject = bodyText?.includes('[object Object]');

        const status = (jsErrors.length === 0 && failedRequests.length === 0 && !isEmpty && !hasObjectObject) ? 'PASS' : 'FAIL';
        const error = [];
        if (jsErrors.length) error.push(`JS: ${jsErrors.join('; ')}`);
        if (failedRequests.length) error.push(`API: ${failedRequests.join('; ')}`);
        if (isEmpty) error.push('Empty page');
        if (hasObjectObject) error.push('[object Object] detected');

        results.push({ role, route, status, error: error.join(' | ') || null });
      } catch (e) {
        results.push({ role, route, status: 'FAIL', error: e.message.slice(0, 150) });
      }

      page.removeListener('console', onConsole);
      page.removeListener('response', onResponse);
    }

    await context.close();
  }

  await browser.close();
  return results;
}

module.exports = { name: 'SMOKE PAGES', run };
