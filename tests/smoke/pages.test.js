/**
 * Smoke тесты: открыть каждую страницу от каждой роли через Playwright
 * Проверяет: нет JS ошибок, нет 4xx/5xx API, страница не пустая
 */

let chromium;
try {
  chromium = require('playwright').chromium;
} catch (e) {
  // Playwright не установлен — будет обработано в run()
}

const { BASE_URL, TEST_USERS, ROLES } = require('../config');

// Роуты доступные каждой роли
const ROUTES_BY_ROLE = {
  ADMIN:          ['#/home','#/my-dashboard','#/dashboard','#/tenders','#/pm-works','#/all-works','#/finances','#/personnel','#/tasks','#/settings','#/object-map'],
  PM:             ['#/home','#/my-dashboard','#/pm-calcs','#/calculator','#/pm-works','#/cash','#/payroll','#/tasks','#/invoices'],
  TO:             ['#/home','#/my-dashboard','#/tenders','#/funnel','#/customers','#/tasks','#/calculator'],
  HEAD_PM:        ['#/home','#/my-dashboard','#/all-works','#/all-estimates','#/approvals','#/pm-works','#/tasks','#/object-map'],
  HEAD_TO:        ['#/home','#/my-dashboard','#/tenders','#/funnel','#/pre-tenders','#/tasks','#/object-map'],
  HR:             ['#/home','#/personnel','#/permits','#/hr-rating','#/tasks'],
  HR_MANAGER:     ['#/home','#/personnel','#/permits','#/hr-rating','#/tasks'],
  BUH:            ['#/home','#/buh-registry','#/finances','#/payroll','#/tasks'],
  PROC:           ['#/home','#/proc-requests','#/tasks'],
  OFFICE_MANAGER: ['#/home','#/office-expenses','#/correspondence','#/tasks'],
  CHIEF_ENGINEER: ['#/home','#/warehouse','#/my-equipment','#/tasks'],
  DIRECTOR_GEN:   ['#/home','#/dashboard','#/tenders','#/all-works','#/finances','#/approvals','#/object-map'],
  DIRECTOR_COMM:  ['#/home','#/dashboard','#/tenders','#/all-works','#/finances','#/approvals','#/object-map'],
  DIRECTOR_DEV:   ['#/home','#/dashboard','#/tenders','#/all-works','#/finances','#/object-map'],
  WAREHOUSE:      ['#/home','#/warehouse','#/tasks']
};

async function runSmoke() {
  if (!chromium) {
    console.log('    ⚠️  Playwright not installed — skipping smoke tests');
    console.log('    Run: npm install playwright && npx playwright install chromium');
    return [{ role: 'ALL', route: 'N/A', status: 'SKIP', error: 'Playwright not installed' }];
  }

  const results = [];

  // Ensure TEST_USERS and tokens are initialized
  const { initRealUsers, initTokens } = require('../config');
  await initRealUsers();
  await initTokens();

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  for (const role of ROLES) {
    const routes = ROUTES_BY_ROLE[role] || ['#/home'];
    const user = TEST_USERS[role];
    if (!user || !user.id) {
      results.push({ role, route: 'LOGIN', status: 'SKIP', error: 'No test user found for role ' + role });
      continue;
    }

    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    // Логин через JS — устанавливаем токен напрямую в localStorage
    try {
      await page.goto(`${BASE_URL}/#/welcome`, { waitUntil: 'networkidle', timeout: 15000 });
      // Вместо UI-логина, инжектим токен
      const { getToken } = require('../config');
      const token = await getToken(role);
      await page.evaluate(({ token, user }) => {
        localStorage.setItem('asgard_token', token);
        localStorage.setItem('asgard_user', JSON.stringify(user));
      }, { token, user: { id: user.id, login: user.login, name: user.name, role: user.role } });
    } catch (e) {
      results.push({ role, route: 'LOGIN', status: 'FAIL', error: e.message.slice(0, 150) });
      await context.close();
      continue;
    }

    // Проверяем каждую страницу
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

        results.push({
          role, route, status,
          jsErrors: jsErrors.length ? jsErrors : null,
          failedRequests: failedRequests.length ? failedRequests : null,
          isEmpty: isEmpty || null,
          hasObjectObject: hasObjectObject || null
        });
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

module.exports = { name: 'SMOKE PAGES', run: runSmoke };
