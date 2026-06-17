/**
 * V209 UI-smoke: страница /travel (legacy) под 4 ролями.
 * Логин — через API (минуем UI-keypad), токен инжектируем в localStorage.
 *
 * Запуск: node tests/smoke-v209-logistics-ui.cjs
 */
'use strict';

const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:3120';

const ROLES = [
  { login: 'test_pm',             pin: '1234' },
  { login: 'test_office_manager', pin: '1234' },
  { login: 'test_hr',             pin: '1234' },
  { login: 'test_director_gen',   pin: '1234' }
];

async function getTokenViaApi(login, pin) {
  const r1 = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password: 'Test123!' })
  });
  const j1 = await r1.json();
  if (!j1.token) throw new Error('login: ' + JSON.stringify(j1));
  const r2 = await fetch(BASE + '/api/auth/verify-pin', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + j1.token },
    body: JSON.stringify({ pin })
  });
  const j2 = await r2.json();
  if (!j2.token) throw new Error('pin: ' + JSON.stringify(j2));
  return { token: j2.token, user: j2.user };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  let pass = 0, fail = 0;
  const summary = [];

  for (const role of ROLES) {
    const errors = [];
    let status = '✅';
    const notes = [];
    let context = null;

    try {
      // 1. Получить токен по API
      const { token, user } = await getTokenViaApi(role.login, role.pin);

      context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      // 2. Инжектим токен в localStorage до загрузки страницы
      const today = new Date().toISOString().slice(0, 10);
      await context.addInitScript(({ token, user, today }) => {
        localStorage.setItem('asgard_token', token);
        localStorage.setItem('asgard_user', JSON.stringify(user));
        localStorage.setItem('pin_unlocked_at', String(Date.now()));
        // обходим обязательную отметку «где я сегодня»
        localStorage.setItem('presence_done_' + today, '1');
      }, { token, user, today });

      const page = await context.newPage();
      page.on('pageerror', e => errors.push('pageerror: ' + e.message));
      // Network responses to capture URL of 4xx/5xx (resource-failed console errors не несут URL)
      const failedRequests = [];
      page.on('response', resp => {
        if (resp.status() >= 400 && resp.url().includes('/api/')) {
          failedRequests.push(resp.status() + ' ' + resp.url().replace(BASE, ''));
        }
      });
      page.on('console', msg => {
        if (msg.type() === 'error') {
          const t = msg.text();
          if (/favicon|service.worker|MimirConductor|chart-color|api\/notifications|Failed to load resource/i.test(t)) return;
          errors.push('console.error: ' + t);
        }
      });

      // 3. Идём прямо на /travel
      await page.goto(BASE + '/#/travel', { waitUntil: 'commit' });

      // 4. Ждём, что страница отрисовалась (заголовок «Логистика дружины»)
      await page.waitForSelector('.tl-tab, h2.page-title', { timeout: 25000 });
      const title = (await page.textContent('h2.page-title').catch(() => '')) || '';
      if (!/Логистика\s+дружины/i.test(title)) {
        throw new Error('Title не «Логистика дружины», got: ' + JSON.stringify(title));
      }

      // 5. 4 таба
      const tabCount = await page.locator('.tl-tab').count();
      if (tabCount < 4) throw new Error('Tabs < 4, got ' + tabCount);

      // 6. KPI 4
      const kpiCount = await page.locator('.tl-kpi-card').count();
      if (kpiCount < 4) throw new Error('KPI cards < 4, got ' + kpiCount);

      // 7. Открыть модалку «Добавить»
      await page.click('#btnAddItem');
      await page.waitForSelector('#ti_type', { timeout: 5000 });

      // 8. Type=hotel → #ti_hotel_row visible
      await page.selectOption('#ti_type', 'hotel');
      await page.waitForFunction(
        () => { const el = document.querySelector('#ti_hotel_row'); return el && el.style.display !== 'none'; },
        { timeout: 3000 }
      );

      // 9. Type=transfer → #ti_driver_row visible, hotel hidden
      await page.selectOption('#ti_type', 'transfer');
      await page.waitForFunction(
        () => {
          const drv = document.querySelector('#ti_driver_row');
          const hot = document.querySelector('#ti_hotel_row');
          return drv && drv.style.display !== 'none' && (!hot || hot.style.display === 'none');
        },
        { timeout: 3000 }
      );

      // 10. Type=directive_mo → #ti_referral_row visible
      await page.selectOption('#ti_type', 'directive_mo');
      await page.waitForFunction(
        () => { const el = document.querySelector('#ti_referral_row'); return el && el.style.display !== 'none'; },
        { timeout: 3000 }
      );

      // 11. Закрываем модалку (esc или клик по фону)
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // 12. JS-ошибки (не считаем 4xx-ответы от смежных API)
      if (errors.length) {
        notes.push('JS errors x' + errors.length + ': ' + errors.slice(0, 2).join(' | ').slice(0, 160));
        status = '❌';
      }
      // показать какие endpoints 4xx (диагностика, не fail)
      const relevant4xx = failedRequests.filter(u => /field\/logistics|works|staff/i.test(u));
      if (relevant4xx.length) {
        notes.push('relevant 4xx: ' + relevant4xx.slice(0, 3).join(', '));
      }
    } catch (e) {
      status = '❌';
      notes.push(e.message);
    } finally {
      if (context) await context.close();
      if (status === '✅') pass++; else fail++;
      summary.push(`  ${role.login.padEnd(22)} ${status}${notes.length ? '  ' + notes.join(' | ') : ''}`);
    }
  }

  console.log('\nUI smoke — /travel (legacy):');
  summary.forEach(l => console.log(l));
  console.log(`\nROLES PASS: ${pass}  FAIL: ${fail}`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
