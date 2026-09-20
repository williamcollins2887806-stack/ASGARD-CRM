/**
 * C1/C3 — визуальный Playwright-тест vanilla desktop: вкладка «🏗️ Сборки».
 * Проверяет на КЛОНЕ (:3101):
 *   1) у поля РП в полевом модуле есть вкладка «🏗️ Сборки» (и НЕТ «📦 Сборы»);
 *   2) «+ Новая ведомость» открывает модалку с полями (asmType/asmTitle/asmDate/asmSubmit);
 *   3) модалку можно создать (POST /api/assembly уходит) — ведомость появляется в списке;
 *   4) 0 JS-ошибок консоли за прогон.
 * Запуск: node tools/verify_c1c3_browser.js
 */
const { chromium } = require('playwright');

const BASE = (process.env.TEST_BASE_URL || 'http://127.0.0.1:3101').replace(/\/$/, '');

let pass = 0, fail = 0;
function check(name, ok, proof) { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${name}${proof ? ' — ' + proof : ''}`); }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  try {
    // login via API
    await page.goto(BASE + '/', { waitUntil: 'commit' });
    const auth = await page.evaluate(async (base) => {
      const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'test_admin', password: 'Test123!' }) });
      const d = await r.json();
      let t = d.token;
      if (d.status === 'need_pin') {
        const r2 = await fetch(base + '/api/auth/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ pin: '0000' }) });
        const d2 = await r2.json(); t = d2.token || t;
      }
      if (t) { localStorage.setItem('asgard_token', t); localStorage.setItem('auth_token', t); }
      const me = await fetch(base + '/api/auth/me', { headers: { Authorization: 'Bearer ' + t } }).then(x => x.json());
      const w = await fetch(base + '/api/works?limit=5', { headers: { Authorization: 'Bearer ' + t } }).then(x => x.json());
      const arr = w.works || w.items || w.rows || [];
      const work = arr.find(x => /Beta/.test(x.work_title || x.title)) || arr[0];
      return { token: !!t, work, user: me.user || me };
    }, BASE);
    check('login + work получены', auth.token && !!auth.work, auth.work && ('work=' + auth.work.id));

    // дождаться загрузки vanilla-модуля полевого таба
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForFunction(() => !!(window.AsgardFieldTab && window.AsgardUI), null, { timeout: 20000 });
    check('модуль AsgardFieldTab загружен', true, '');
    // спрятать оверлей выбора темы (перехватывает клики)
    await page.evaluate(() => { const el = document.getElementById('asgard-theme-selector'); if (el) el.style.display = 'none'; });
    const clickByText = async (txt) => { return await page.evaluate((t) => {
      const all = [...document.querySelectorAll('button')].filter(x => x.textContent.includes(t) && x.offsetParent !== null);
      const b = all[all.length - 1];
      if (b) { b.click(); return true; }
      return false;
    }, txt); };

    // open field modal
    await page.evaluate(({ work, user }) => window.AsgardFieldTab.openFieldModal(work, user), { work: auth.work, user: auth.user });
    await page.waitForTimeout(1200);

    const tabs = await page.$$eval('.cr-m button', (bs) => bs.map(b => b.textContent.trim()).filter(t => /Сборки|Сборы|Бригада|Подотчёт/.test(t)));
    check('вкладка «🏗️ Сборки» есть, «📦 Сборы» нет', tabs.some(t => /Сборки/.test(t)) && !tabs.some(t => /^📦 Сборы$/.test(t)), JSON.stringify(tabs));

    // click Сборки
    await clickByText('Сборки');
    await page.waitForTimeout(1200);
    const hasList = await page.locator('.cr-m', { hasText: 'Ведомости сборки' }).count();
    check('вкладка «Сборки» отрисовала список «Ведомости сборки»', hasList > 0, '');

    // click «+ Новая ведомость»
    await clickByText('Новая ведомость');
    await page.waitForTimeout(700);
    const fields = await page.evaluate(() => ({
      type: !!document.getElementById('asmType'), title: !!document.getElementById('asmTitle'),
      date: !!document.getElementById('asmDate'), submit: !!document.getElementById('asmSubmit'),
      modalTitle: document.body.innerText.includes('Новая ведомость сборки'),
    }));
    check('модалка «Новая ведомость» с полями открылась', fields.type && fields.title && fields.submit && fields.modalTitle, JSON.stringify(fields));

    // create
    await page.fill('#asmTitle', 'PLAYWRIGHT проверка сборки');
    await page.fill('#asmDest', 'Клон-объект PW');
    await clickByText('Создать');
    await page.waitForTimeout(1500);
    const created = await page.locator('.cr-m', { hasText: 'PLAYWRIGHT проверка сборки' }).count();
    check('ведомость создана и появилась в списке', created > 0, '');

    // cleanup via API
    await page.evaluate(async (base) => {
      const t = localStorage.getItem('asgard_token');
      const w = await fetch(base + '/api/works?limit=5', { headers: { Authorization: 'Bearer ' + t } }).then(x => x.json());
      const arr = w.works || w.items || w.rows || [];
      const work = arr.find(x => /Beta/.test(x.work_title || x.title)) || arr[0];
      const list = await fetch(base + '/api/assembly?work_id=' + work.id, { headers: { Authorization: 'Bearer ' + t } }).then(x => x.json());
      for (const o of (list.items || [])) {
        if (/PLAYWRIGHT проверка сборки/.test(o.title || '')) {
          await fetch(base + '/api/assembly/' + o.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + t } });
        }
      }
    }, BASE);

    const realErrors = consoleErrors.filter(e => !/favicon|sw\.js|ServiceWorker|Failed to load resource.*401/i.test(e));
    check('0 JS-ошибок консоли', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  } catch (e) {
    check('НЕОЖИДАННАЯ ОШИБКА', false, e.message);
  } finally {
    await browser.close();
  }

  console.log('\n===================================================');
  console.log(`  ИТОГ: ${pass} PASS / ${fail} FAIL`);
  console.log('===================================================');
  process.exit(fail > 0 ? 1 : 0);
})();
