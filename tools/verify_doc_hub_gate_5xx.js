// Негативный контроль для блока no_5xx/no_pageerror, добавленного в tests/doc-hub-gate-e2e.js.
// Доказывает, что слушатель `page.on('response', s>=500)` в gate НЕ вакуумный:
// 1) логинимся как BUH (как в gate), кладём токен в localStorage;
// 2) подменяем /api/doc-registry* на 500;
// 3) ждём, что captured_5xx >= 1.
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const PASSWORD = 'Test123!';

async function login(loginName) {
  const lr = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: loginName, password: PASSWORD })
  }).then((r) => r.json());
  let token = lr.token;
  let user = lr.user;
  if (lr.status === 'need_pin') {
    const pr = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: '0000' })
    }).then((r) => r.json());
    token = pr.token; user = pr.user || user;
  }
  if (!token) throw new Error('login fail ' + loginName);
  const me = await fetch(BASE + '/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })
    .then((r) => r.json()).catch(() => ({}));
  user = me.user || user || {};
  return { token, user, permissions: user.permissions || {} };
}

(async () => {
  const auth = await login('test_buh');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(({ token, user, permissions }) => {
    try {
      localStorage.setItem('asgard_token', token);
      localStorage.setItem('auth_token', token);
      localStorage.setItem('asgard_user', JSON.stringify(user || {}));
      localStorage.setItem('asgard_permissions', JSON.stringify(permissions || {}));
      const d = new Date();
      for (let i = -1; i <= 1; i++) {
        localStorage.setItem('presence_done_' + new Date(d.getTime() + i * 86400000).toISOString().slice(0, 10), '1');
      }
      localStorage.setItem('asgard_shell_banner_dismissed', '1');
      localStorage.setItem('asgard_safe_mode', '1');
    } catch (_) {}
  }, { token: auth.token, user: auth.user, permissions: auth.permissions });

  const page = await ctx.newPage();
  const consoleErrors = [];
  const http5xx = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('response', (r) => { const s = r.status(); if (s >= 500) http5xx.push(s + ' ' + r.url()); });

  await page.route('**/api/doc-registry**', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"probe"}' })
  );
  // D-202: второй класс дефекта — сетевой сбой БЕЗ ответа (ERR_ABORTED).
  // Регистрируем ПОСЛЕ общего: в Playwright специфичный маршрут должен идти последним
  // (матчи применяются в обратном порядке регистрации), иначе abort не сработает.
  await page.route('**/api/doc-registry/facets**', (route) => route.abort('failed'));

  const seen = [];
  page.on('request', (r) => { if (/\/api\//.test(r.url())) seen.push(r.method() + ' ' + r.url().replace(BASE, '')); });
  page.on('requestfailed', (r) => seen.push('FAILED ' + r.method() + ' ' + r.url().replace(BASE, '')));

  await page.goto(BASE + '/?probe=' + Date.now() + '#/doc-hub', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(6000);

  console.log('api_requests=' + seen.length);
  console.log(seen.slice(0, 15).join('\n'));
  const hash = await page.evaluate(() => location.hash + ' | url=' + location.href).catch(() => 'n/a');
  console.log('location=' + hash);
  console.log('captured_5xx=' + http5xx.length);
  if (http5xx.length) console.log('sample=' + http5xx[0]);
  // повторим фильтр из gate-e2e.js (D-202): net::ERR НЕ глушим
  const fatal = consoleErrors.filter((t) => !/favicon|ResizeObserver|Download the React/i.test(t));
  const netFail = fatal.filter((t) => /net::ERR|Failed to fetch|ERR_ABORTED/i.test(t));
  console.log('console_fatal=' + fatal.length + ' netfail=' + netFail.length);
  if (netFail.length) console.log('netfail_sample=' + netFail[0].slice(0, 160));
  const ok = http5xx.length > 0 && netFail.length > 0;
  console.log('NO5XX PROBE: ' + (ok
    ? 'PASS (caught ' + http5xx.length + 'x5xx + ' + netFail.length + 'x netfail)'
    : 'FAIL (vacuous: 5xx=' + http5xx.length + ' netfail=' + netFail.length + ')'));
  await ctx.close();
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
