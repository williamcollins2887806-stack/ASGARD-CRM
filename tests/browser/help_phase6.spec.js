/**
 * Playwright UI тест /v2/#/help под 8 ролями (Phase 6).
 *
 *   PM, TO, HEAD_TO, PROC, BUH, DIRECTOR_GEN, ADMIN, HR
 *
 * Авторизация через предзаписанный localStorage (asgard_token + asgard_user) —
 * JWT подписывается тем же секретом что сервер.
 *
 * Запуск:  npx playwright test tests/help_phase6_playwright.spec.js
 *   (или с UI:  npx playwright test --headed)
 */
const { test, expect } = require('@playwright/test');
const jwt = require('jsonwebtoken');

const BASE_URL = process.env.HELP_BASE || 'http://127.0.0.1:3120';
const JWT_SECRET = 'asgard-jwt-secret-2026';

const ROLES = ['PM','TO','HEAD_TO','PROC','BUH','DIRECTOR_GEN','ADMIN','HR'];

let cachedUsers = null;
async function loadUsersByRole() {
  if (cachedUsers) return cachedUsers;
  // Bootstrap-ADMIN токен (для API-запроса /api/users — fullAccess роль)
  const adminTok = jwt.sign(
    { id: 1, login: 'bootstrap', name: 'Bootstrap', role: 'ADMIN', email: null, pinVerified: true },
    JWT_SECRET, { expiresIn: '10m' }
  );
  const map = {};
  for (const role of ROLES) {
    const r = await fetch(`${BASE_URL}/api/users?is_active=true&role=${role}&limit=1`, {
      headers: { Authorization: `Bearer ${adminTok}` }
    });
    if (!r.ok) continue;
    const data = await r.json();
    if (data.users && data.users[0]) map[role] = data.users[0];
  }
  cachedUsers = map;
  return map;
}

function makeToken(u) {
  return jwt.sign(
    { id:u.id, login:u.login, name:u.name, role:u.role, email:null, pinVerified:true },
    JWT_SECRET, { expiresIn:'1h' }
  );
}

async function loginAs(context, user) {
  const token = makeToken(user);
  // Используем addInitScript — set localStorage ДО первой загрузки приложения.
  // Это надёжнее чем goto + evaluate (нет двойного navigation).
  await context.addInitScript(({ token, user }) => {
    try {
      localStorage.setItem('asgard_token', token);
      localStorage.setItem('asgard_user', JSON.stringify({
        id: user.id, login: user.login, name: user.name,
        role: user.role, email: null,
        permissions: {}, menu_settings: { hidden_routes: [], route_order: [] }
      }));
    } catch (e) {}
  }, { token, user });
}

test.describe.configure({ mode: 'serial' });

for (const role of ROLES) {
  test(`Help page рендерится без ошибок: роль ${role}`, async ({ browser }) => {
    const users = await loadUsersByRole();
    const u = users[role];
    test.skip(!u, `Нет активного юзера для роли ${role}`);

    // Свежий контекст — для каждой роли свой localStorage
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    // Блокировки до открытия страницы
    await context.route('**/fonts.googleapis.com/**', r => r.abort());
    await context.route('**/fonts.gstatic.com/**',    r => r.abort());
    await context.route('**/unpkg.com/**',            r => r.abort());
    await context.route('**/api.telegram.org/**',     r => r.abort());

    await loginAs(context, u);

    const page = await context.newPage();
    const consoleErrors = [];
    const allLogs = [];
    page.on('console', (msg) => {
      allLogs.push(`${msg.type()}: ${msg.text()}`);
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + err.message));
    page.on('requestfailed', r => allLogs.push(`reqfail ${r.url()} :: ${r.failure()?.errorText}`));
    page.on('response', r => { if (r.status() >= 400) allLogs.push(`HTTP ${r.status()} ${r.url()}`); });

    // commit — самый ранний event (header response). React/V2 запустится сам, ждём дальше через waitForFunction.
    await page.goto(BASE_URL + '/v2/#/help', { waitUntil: 'commit', timeout: 15000 });

    // Ждём пока React-приложение прорисует страницу (любой осмысленный элемент)
    try {
      await page.waitForFunction(() => {
        const root = document.querySelector('#root');
        if (!root || !root.children.length) return false;
        return !!document.querySelector('.help-page, .help-tabs, [class*="help-tab"], [class*="help-card"]')
            || /Попросить помощи|Помощь коллеги/i.test(document.body.innerText || '');
      }, { timeout: 30000, polling: 500 });
    } catch (e) {
      try {
        await page.screenshot({ path: `tests/screenshots/help-${role}-FAIL.png`, fullPage: false, timeout: 5000, animations: 'disabled' });
      } catch (_) {}
      const url = page.url();
      const bodyText = await page.evaluate(() => (document.body.innerText || '').slice(0, 400)).catch(() => '?');
      const rootHas = await page.evaluate(() => !!document.querySelector('#root')?.children.length).catch(() => null);
      console.log(`[${role}] url=${url}  root-rendered=${rootHas}`);
      console.log(`[${role}] body:`, bodyText);
      console.log(`[${role}] logs:`, allLogs.slice(-15).join('\n  '));
      throw e;
    }

    // Кнопка «Попросить помощи» — глобальный текст
    const createBtn = page.getByText(/Попросить помощи/i).first();
    await expect(createBtn).toBeVisible({ timeout: 10000 });

    // Клик → открывается модалка с UserPicker
    await createBtn.click();
    await page.waitForSelector('.help-picker, [class*="help-picker"], textarea, input[placeholder*="имя"], input[placeholder*="Имя"]', { timeout: 6000 });

    // Закрываем (Escape)
    await page.keyboard.press('Escape');

    // Скриншот (с disabled animations + игнор fonts timeout)
    try {
      await page.screenshot({ path: `tests/screenshots/help-${role}.png`, fullPage: false, timeout: 8000, animations: 'disabled' });
    } catch (_) { /* шрифты могли не успеть — не критично */ }

    // Console errors: разрешаем известные тех. шумы (favicon, sw, telegram polling),
    // считаем фатальными только настоящие ошибки приложения.
    const fatal = consoleErrors.filter(e =>
      !/favicon|service-worker|telegram polling|MimirFab|webpack|sw\.js|chrome-extension|404 \(Not Found\)|net::ERR|403 \(Forbidden\)|401 \(Unauthorized\)|status of 4\d\d/i.test(e)
    );
    if (fatal.length) console.log(`[${role}] Console errors:`, fatal);
    expect(fatal, `Fatal console errors for ${role}: ${fatal.join('; ')}`).toEqual([]);
    await context.close();
  });
}
