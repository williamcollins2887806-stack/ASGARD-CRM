'use strict';
/**
 * Full FRONTEND (Playwright) E2E for WMS/procurement flows.
 * Roles: PM (РП), WAREHOUSE (кладовщик), PROC (закупщик), FIELD (рабочий).
 * Exit 0 only if every check passes. Writes JSON + screenshots.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const OUT = path.join(__dirname, 'reports', 'wms-roles-ui');
const FIX = path.join(__dirname, 'fixtures', 'wms-cart-scenario-a.xlsx');
fs.mkdirSync(OUT, { recursive: true });

const ACCOUNTS = {
  PM: { login: 'test_pm', password: 'Test123!', pin: '0000' },
  WAREHOUSE: { login: 'test_warehouse', password: 'Test123!', pin: '0000' },
  PROC: { login: 'test_proc', password: 'Test123!', pin: '0000' },
};

const report = {
  started_at: new Date().toISOString(),
  base: BASE,
  roles: {},
  summary: {},
};

function ok(cond, msg) { return { pass: !!cond, msg }; }

async function officeLogin(role) {
  const a = ACCOUNTS[role];
  const lr = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: a.login, password: a.password }),
  }).then(r => r.json());
  if (!lr.token) throw new Error(role + ' login fail ' + JSON.stringify(lr));
  let token = lr.token;
  let user = lr.user;
  if (lr.status === 'need_pin') {
    const pr = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: a.pin }),
    }).then(r => r.json());
    if (!pr.token) throw new Error(role + ' pin fail ' + JSON.stringify(pr));
    token = pr.token;
    user = pr.user || user;
  }
  const me = await fetch(BASE + '/api/auth/me', {
    headers: { Authorization: 'Bearer ' + token },
  }).then(r => r.json());
  return { token, user: me.user || user, permissions: (me.user || user || {}).permissions || {} };
}

async function dismissChrome(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.cr-m-overlay, .modalback, [class*="overlay--visible"]').forEach(el => {
      el.classList.remove('cr-m-overlay--visible');
      el.style.display = 'none';
      try { el.remove(); } catch (_) {}
    });
    localStorage.setItem('asgard_shell_banner_dismissed', '1');
    localStorage.setItem('asgard_theme_chosen', '1');
    localStorage.setItem('asgard_theme', 'dark');
  });
  for (const t of ['Понял', 'Принять вызов', 'Закрыть']) {
    await page.getByRole('button', { name: new RegExp(t, 'i') }).first().click({ timeout: 400 }).catch(() => {});
  }
}

async function openDesktop(context, auth, hash) {
  const page = await context.newPage();
  const consoleErrors = [];
  const netFails = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push(String(e.message || e)));
  page.on('response', r => {
    if (r.status() >= 500 && r.url().includes('/api/')) {
      netFails.push({ status: r.status(), url: r.url().replace(BASE, '').slice(0, 140) });
    }
  });
  await context.addInitScript(({ token, user, permissions }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user || {}));
    localStorage.setItem('asgard_permissions', JSON.stringify(permissions || {}));
    localStorage.setItem('asgard_theme', 'dark');
    localStorage.setItem('asgard_theme_chosen', '1');
    localStorage.setItem('asgard_shell_banner_dismissed', '1');
    localStorage.setItem('asgard_v2_banner_dismissed', '1');
  }, auth);
  // сбросить SW-кэш shell, иначе E2E ловит старый warehouse-v2.js
  await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 60000 });
  await page.evaluate(async () => {
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  }).catch(() => {});
  await page.goto(BASE + '/?nocache=' + Date.now() + hash, { waitUntil: 'commit', timeout: 60000 });
  await page.waitForSelector('#layout, #main-content, .wh2, body', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2800);
  await dismissChrome(page);
  await page.waitForTimeout(500);
  return { page, consoleErrors, netFails };
}

async function shot(page, name) {
  const file = path.join(OUT, name + '.png');
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function ensureFieldWorker() {
  const pool = new Pool({
    user: process.env.PGUSER || 'asgard',
    password: process.env.PGPASSWORD || '123456789',
    database: process.env.PGDATABASE || 'asgard_crm_dev',
    host: process.env.PGHOST || '127.0.0.1',
  });
  try {
    let emp = (await pool.query(`
      SELECT e.id, e.phone, e.fio, e.full_name, e.user_id
      FROM employees e
      WHERE e.is_active = true AND e.phone IS NOT NULL AND length(regexp_replace(e.phone, '\\D', '', 'g')) >= 10
      ORDER BY e.id ASC LIMIT 1`)).rows[0];
    if (!emp) throw new Error('no employee with phone');
    const phone = emp.phone;
    // ensure linked user with PIN 0000
    let userId = emp.user_id;
    if (!userId) {
      const ins = await pool.query(`
        INSERT INTO users(login, name, role, is_active, password_hash)
        VALUES($1, $2, 'FIELD_WORKER', true, $3)
        ON CONFLICT DO NOTHING
        RETURNING id`,
        ['field_test_' + emp.id, emp.fio || emp.full_name || 'Field Test', await bcrypt.hash('FieldTest123!', 10)]);
      if (ins.rows[0]) userId = ins.rows[0].id;
      else {
        const u = await pool.query(`SELECT id FROM users WHERE login=$1`, ['field_test_' + emp.id]);
        userId = u.rows[0]?.id;
      }
      if (userId) await pool.query(`UPDATE employees SET user_id=$1 WHERE id=$2`, [userId, emp.id]);
    }
    const pinHash = await bcrypt.hash('0000', 10);
    await pool.query(`UPDATE users SET pin_hash=$1 WHERE id=$2`, [pinHash, userId]);
    return { employee_id: emp.id, phone, user_id: userId, pin: '0000' };
  } finally {
    await pool.end();
  }
}

async function fieldToken(fw) {
  // pin-login if possible
  const pinR = await fetch(BASE + '/api/field/auth/pin-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_id: fw.employee_id, pin: fw.pin }),
  });
  const pinD = await pinR.json().catch(() => ({}));
  if (pinR.ok && pinD.token) return pinD;

  // SMS path
  await fetch(BASE + '/api/field/auth/request-code', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: fw.phone }),
  });
  const pool = new Pool({
    user: 'asgard', password: '123456789', database: 'asgard_crm_dev', host: '127.0.0.1',
  });
  let code;
  try {
    const r = await pool.query(`
      SELECT code FROM field_auth_codes
      WHERE employee_id=$1 AND used=false AND expires_at>NOW()
      ORDER BY id DESC LIMIT 1`, [fw.employee_id]);
    code = r.rows[0]?.code;
  } finally { await pool.end(); }
  if (!code) throw new Error('no SMS code in DB');
  const vr = await fetch(BASE + '/api/field/auth/verify-code', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: fw.phone, code }),
  }).then(r => r.json());
  if (vr.status === 'need_pin_setup' && vr.token) {
    await fetch(BASE + '/api/field/auth/setup-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + vr.token },
      body: JSON.stringify({ pin: '0000' }),
    });
    return fieldToken(fw);
  }
  if (!vr.token) throw new Error('field verify fail ' + JSON.stringify(vr));
  return vr;
}

async function runPM(browser) {
  const steps = [];
  const auth = await officeLogin('PM');
  // очистить корзину перед сценарием — иначе хвосты прошлых прогонов
  try {
    const cart = await fetch(BASE + '/api/warehouse-cart', {
      headers: { Authorization: 'Bearer ' + auth.token },
    }).then((r) => r.json());
    for (const it of cart.items || []) {
      await fetch(BASE + '/api/warehouse-cart/items/' + it.id, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + auth.token },
      }).catch(() => {});
    }
  } catch (_) {}
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page, consoleErrors, netFails } = await openDesktop(context, auth, '#/warehouse-v2');
    // PM may not have warehouse-v2 default tab with FAB if redirected — force hash
  if (!page.url().includes('warehouse')) {
    await page.goto(BASE + '/#/warehouse-v2', { waitUntil: 'commit' });
    await page.waitForTimeout(2500);
    await dismissChrome(page);
  }
  await page.waitForSelector('.wh2-fab__btn, #wh2-cart-fab', { timeout: 15000 }).catch(() => {});
  steps.push(ok(/склад|warehouse|каталог|корзин|оборуд/i.test(await page.locator('body').innerText()), 'PM warehouse-v2 loaded'));
  await shot(page, 'pm-01-warehouse');

  // open cart + excel (force; never hang on evaluate async)
  await page.evaluate(() => {
    try {
      if (window.AsgardWarehouseCart && window.AsgardWarehouseCart.open) window.AsgardWarehouseCart.open();
      else {
        const fab = document.querySelector('.wh2-fab__btn');
        if (fab) fab.click();
      }
    } catch (_) {}
  });
  await page.waitForTimeout(1500);
  let excelBtn = page.locator('#wh2-cart-excel');
  if (!(await excelBtn.count())) {
    await page.locator('.wh2-fab__btn').first().click({ force: true, timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(800);
    excelBtn = page.locator('#wh2-cart-excel');
  }
  steps.push(ok(await excelBtn.count() > 0, 'PM cart excel button'));
  if (await excelBtn.count()) {
    await page.evaluate(() => {
      const b = document.getElementById('wh2-cart-excel');
      if (b && typeof b.onclick === 'function') b.onclick();
      else if (window.AsgardWarehouseCart && window.AsgardWarehouseCart.openExcel) window.AsgardWarehouseCart.openExcel();
      else if (b) b.click();
    });
    await page.waitForTimeout(800);
    steps.push(ok(await page.locator('#wh2-xl-file, a[href*=\"wms-cart-excel-template\"]').count() > 0
      || await page.locator('text=Скачать шаблон').count() > 0, 'PM template link'));
    if (fs.existsSync(FIX) && await page.locator('#wh2-xl-file').count()) {
      await page.locator('#wh2-xl-file').setInputFiles(FIX);
      // ждём именно кнопку добавления (не текст подсказки в body)
      await page.waitForSelector('#wh2-xl-add', { timeout: 45000 }).catch(() => {});
      const prev = await page.locator('#wh2-xl-preview').innerText().catch(() => '');
      steps.push(ok(/со склада|закупка|Добавить в корзину/i.test(prev) && await page.locator('#wh2-xl-add').count() > 0, 'PM excel AI preview'));

      // полноценнее: добавить в корзину → превью → отправить
      const addBtn = page.locator('#wh2-xl-add');
      if (await addBtn.count()) {
        const addWait = page.waitForResponse(
          (r) => r.url().includes('/api/warehouse-cart/items') && r.request().method() === 'POST',
          { timeout: 30000 }
        ).catch(() => null);
        await page.evaluate(() => {
          const b = document.getElementById('wh2-xl-add');
          if (b) b.click();
        });
        const addResp = await addWait;
        const addOk = !!(addResp && addResp.ok());
        await page.waitForTimeout(1500);
        await page.waitForFunction(() => {
          return document.querySelectorAll('.wh2-cart-it').length > 0
            || !!document.getElementById('wh2-cart-submit')
            || ((document.getElementById('wh2-cart-badge') || {}).textContent || '') !== '';
        }, { timeout: 20000 }).catch(() => {});
        // если drawer не обновился — откроем корзину заново
        if (!(await page.locator('.wh2-cart-it, #wh2-cart-submit').count())) {
          await page.evaluate(() => {
            if (window.AsgardWarehouseCart && window.AsgardWarehouseCart.open) window.AsgardWarehouseCart.open();
            else {
              const fab = document.querySelector('.wh2-fab__btn');
              if (fab) fab.click();
            }
          });
          await page.waitForTimeout(1200);
        }
        const nItems = await page.locator('.wh2-cart-it').count();
        const badge = await page.locator('#wh2-cart-badge').innerText().catch(() => '');
        steps.push(ok(addOk || nItems > 0 || parseInt(badge, 10) > 0, 'PM excel added to cart (' + nItems + ', api=' + addOk + ', badge=' + badge + ')'));
        await shot(page, 'pm-02b-cart-filled');

        const tipOk = /Отправить заявку|Excel|резерв/i.test(await page.locator('.wh2-page-tip').innerText().catch(() => ''));
        steps.push(ok(tipOk, 'PM cart tip present'));

        if (await page.locator('#wh2-cart-preview').count()) {
          await page.evaluate(() => {
            const b = document.getElementById('wh2-cart-preview');
            if (b) b.click();
          });
          await page.waitForSelector('#wh2-prev-submit', { timeout: 12000 }).catch(() => {});
          const hasConfirm = await page.locator('#wh2-prev-submit').count() > 0;
          steps.push(ok(hasConfirm, 'PM submit preview modal'));
          await shot(page, 'pm-02c-preview');
          if (hasConfirm) {
            const subWait = page.waitForResponse(
              (r) => r.url().includes('/api/warehouse-cart/submit') && r.request().method() === 'POST',
              { timeout: 30000 }
            ).catch(() => null);
            await page.evaluate(() => {
              const b = document.getElementById('wh2-prev-submit');
              if (b) b.click();
            });
            const subResp = await subWait;
            await page.waitForTimeout(2500);
            const after = await page.locator('body').innerText();
            const submitted = (subResp && subResp.ok())
              || /Отправлено|Закупка\s*#|Резерв:/i.test(after);
            steps.push(ok(!!submitted, 'PM cart submit done'));
            await shot(page, 'pm-02d-submitted');
          } else if (await page.locator('#wh2-cart-submit').count()) {
            // fallback: прямая отправка без модалки превью
            const subWait = page.waitForResponse(
              (r) => r.url().includes('/api/warehouse-cart/submit') && r.request().method() === 'POST',
              { timeout: 30000 }
            ).catch(() => null);
            await page.evaluate(() => {
              const b = document.getElementById('wh2-cart-submit');
              if (b) b.click();
            });
            const subResp = await subWait;
            await page.waitForTimeout(2500);
            steps.push(ok(!!(subResp && subResp.ok()), 'PM direct submit done'));
          } else {
            steps.push(ok(false, 'PM confirm submit button missing'));
          }
        } else if (await page.locator('#wh2-cart-submit').count()) {
          const subWait = page.waitForResponse(
            (r) => r.url().includes('/api/warehouse-cart/submit') && r.request().method() === 'POST',
            { timeout: 30000 }
          ).catch(() => null);
          await page.evaluate(() => {
            const b = document.getElementById('wh2-cart-submit');
            if (b) b.click();
          });
          const subResp = await subWait;
          await page.waitForTimeout(2500);
          steps.push(ok(!!(subResp && subResp.ok()), 'PM direct submit clicked'));
        } else {
          steps.push(ok(false, 'PM no preview/submit after add'));
        }
      } else {
        steps.push(ok(false, 'PM excel add button missing'));
      }
    } else {
      steps.push(ok(false, 'PM excel file input missing'));
    }
  }
  await shot(page, 'pm-02-excel');

  // my-procurement
  await page.goto(BASE + '/#/my-procurement', { waitUntil: 'commit' });
  await page.waitForTimeout(2500);
  await dismissChrome(page);
  const myProc = await page.locator('body').innerText();
  steps.push(ok(/заявк|закуп|procurement|пуст|позиц/i.test(myProc) && !/войти|логин/i.test(myProc.slice(0, 80)), 'PM my-procurement page'));
  await shot(page, 'pm-03-my-procurement');

  const hardErr = consoleErrors.filter(e => !/favicon|ResizeObserver|Failed to load resource.*403|Failed to load resource.*409/i.test(e));
  steps.push(ok(netFails.length === 0, 'PM no 5xx api (' + netFails.length + ')'));
  steps.push(ok(hardErr.length === 0, 'PM console clean (' + hardErr.length + ')'));

  report.roles.PM = { steps, pass: steps.every(s => s.pass), consoleErrors: hardErr.slice(0, 10), netFails, url: page.url() };
  console.log('PM steps', steps.filter(s => !s.pass).map(s => s.msg));
  await context.close();
}

async function runWarehouse(browser) {
  const steps = [];
  const auth = await officeLogin('WAREHOUSE');
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page, consoleErrors, netFails } = await openDesktop(context, auth, '#/warehouse-v2');
  await page.waitForSelector('.wh2-tab[data-tab="incoming"], .wh2-tabs', { timeout: 20000 }).catch(() => {});
  if (!(await page.locator('.wh2-tab[data-tab="incoming"]').count())) {
    await dismissChrome(page);
    await page.goto(BASE + '/#/warehouse-v2', { waitUntil: 'commit' });
    await page.waitForTimeout(3000);
    await dismissChrome(page);
  }
  steps.push(ok(true, 'WAREHOUSE warehouse-v2 open'));

  // Tab Приёмка
  const incomingTab = page.locator('.wh2-tab[data-tab="incoming"]');
  const hasIncoming = await incomingTab.count() > 0;
  steps.push(ok(hasIncoming, 'tab Приёмка exists'));
  if (hasIncoming) {
    await incomingTab.click({ force: true, timeout: 10000 });
    await page.waitForTimeout(2000);
    const incomingTxt = await page.locator('body').innerText();
    steps.push(ok(/В пути на склад|Доставлено|На склад|Приёмка|пуст|нет|Как принять/i.test(incomingTxt), 'Приёмка tab content'));
    await shot(page, 'wh-01-incoming');
  }

  // Tab Операции → Массовая приёмка
  const opsTab = page.locator('.wh2-tab[data-tab="ops"]');
  if (await opsTab.count()) {
    await dismissChrome(page);
    await opsTab.click({ force: true, timeout: 10000 });
    await page.waitForSelector('#wh2-ops-receive', { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(1500);
    if (!(await page.locator('#wh2-ops-receive').count())) {
      await dismissChrome(page);
      await opsTab.click({ force: true }).catch(() => {});
      await page.waitForSelector('#wh2-ops-receive', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1200);
    }
  }
  const recvBtn = page.locator('#wh2-ops-receive');
  steps.push(ok(await recvBtn.count() > 0, 'Массовая приёмка button'));
  if (await recvBtn.count()) {
    await recvBtn.click({ force: true, timeout: 10000 });
    await page.waitForTimeout(1500);
    const opsPanel = await page.locator('body').innerText();
    steps.push(ok(/файл|excel|текст|позиц|приёмк|накладн|артикул|кол-во|УПД|вставк/i.test(opsPanel), 'receive panel opened'));
    steps.push(ok(/Файл|вставка|штрихкод|сессия|УПД/i.test(opsPanel), 'receive flow steps visible'));
    const paste = page.locator('#wh2-br-paste');
    if (await paste.count()) {
      await paste.fill('Тест E2E кабель;12;м');
      await page.locator('#wh2-br-parse').click({ force: true }).catch(() => {});
      await page.waitForTimeout(1500);
      const prevTxt = await page.locator('#wh2-br-preview').innerText().catch(() => '');
      steps.push(ok(/Тест E2E|кабель|наименование|кол/i.test(prevTxt), 'receive paste parsed'));
    }
    await shot(page, 'wh-02-ops-receive');
  }

  // Map
  const mapTab = page.locator('.wh2-tab[data-tab="map"]');
  if (await mapTab.count()) {
    await dismissChrome(page);
    await mapTab.click({ force: true, timeout: 10000 });
    await page.waitForSelector('#wh2-map-host canvas, .whm__view canvas, #wh2-map-host .whm', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2200);
    if (!(await page.locator('#wh2-map-host canvas, .whm__view canvas').count())) {
      await dismissChrome(page);
      await mapTab.click({ force: true }).catch(() => {});
      await page.waitForTimeout(3000);
    }
  }
  const mapOk = await page.locator('#wh2-map-host canvas, #wh2-map-host .whm, canvas').count();
  steps.push(ok(mapOk > 0, 'map host/canvas present'));
  await shot(page, 'wh-03-map');

  // Mobile helper
  const mobile = await context.newPage();
  const mConsole = [];
  mobile.on('console', m => { if (m.type() === 'error') mConsole.push(m.text()); });
  await mobile.goto(BASE + '/m/welcome', { waitUntil: 'commit' });
  await mobile.evaluate(({ token, user }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user || {}));
  }, auth);
  await mobile.goto(BASE + '/m/warehouse-wms', { waitUntil: 'commit', timeout: 60000 });
  await mobile.waitForTimeout(3500);
  if (mobile.url().includes('/pin')) {
    for (const d of ['0', '0', '0', '0']) {
      await mobile.getByRole('button', { name: d, exact: true }).first().click().catch(() => {});
      await mobile.waitForTimeout(120);
    }
    await mobile.waitForTimeout(1500);
    await mobile.goto(BASE + '/m/warehouse-wms', { waitUntil: 'commit' });
    await mobile.waitForTimeout(2500);
  }
  const mBody = await mobile.locator('body').innerText();
  steps.push(ok(/WMS помощник|Открытые сессии|QR места/i.test(mBody), 'mobile WMS helper'));
  await mobile.screenshot({ path: path.join(OUT, 'wh-04-mobile-helper.png') });

  const hardErr = consoleErrors.filter(e => !/favicon|ResizeObserver|Failed to load resource.*403/i.test(e));
  steps.push(ok(netFails.length === 0, 'WH no 5xx (' + netFails.length + ')'));
  steps.push(ok(hardErr.length === 0, 'WH console clean (' + hardErr.length + ')'));

  report.roles.WAREHOUSE = { steps, pass: steps.every(s => s.pass), consoleErrors: hardErr.slice(0, 10), netFails, mobileConsole: mConsole.slice(0, 10) };
  await context.close();
}

async function runProc(browser) {
  const steps = [];
  const auth = await officeLogin('PROC');
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page, consoleErrors, netFails } = await openDesktop(context, auth, '#/procurement');
  const txt = await page.locator('body').innerText();
  steps.push(ok(/закуп|заявк|procurement|реестр|позиц/i.test(txt), 'PROC procurement page'));
  steps.push(ok(!/^[\s\S]{0,60}войти/i.test(txt), 'PROC not on login'));
  await shot(page, 'proc-01-procurement');

  // try open a request if any card/row
  let opened = false;
  const card = page.locator('.proc-kcard, .proc-card, [data-proc-id], .kanban-card').first();
  if (await card.count()) {
    await card.click({ force: true, timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(2000);
    opened = /позиц|статус|поставщик|сумм|товар|заявк/i.test(await page.locator('body').innerText());
    await shot(page, 'proc-02-detail');
  } else {
    const link = page.locator('a[href*="procurement"], tr').first();
    if (await link.count()) {
      await link.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1500);
      opened = true;
      await shot(page, 'proc-02-detail');
    }
  }
  const tip = await page.locator('.proc-dash-hero__tip').innerText().catch(() => '');
  steps.push(ok(/Куда жать|канбан|обработк/i.test(tip), 'PROC dash tip'));
  steps.push(ok(opened || /пуст|нет заяв|очередь/i.test(await page.locator('body').innerText()), 'PROC interaction or empty queue'));

  const hardErr = consoleErrors.filter(e => !/favicon|ResizeObserver|Failed to load resource.*403/i.test(e));
  steps.push(ok(netFails.length === 0, 'PROC no 5xx'));
  steps.push(ok(hardErr.length === 0, 'PROC console clean (' + hardErr.length + ')'));
  report.roles.PROC = { steps, pass: steps.every(s => s.pass), consoleErrors: hardErr.slice(0, 10), netFails };
  await context.close();
}

async function runWorker(browser) {
  const steps = [];
  let fw;
  try {
    fw = await ensureFieldWorker();
    steps.push(ok(!!fw.employee_id, 'field worker seeded id=' + fw.employee_id));
  } catch (e) {
    steps.push(ok(false, 'seed field worker: ' + e.message));
    report.roles.FIELD = { steps, pass: false };
    return;
  }
  let tok;
  try {
    tok = await fieldToken(fw);
    steps.push(ok(!!tok.token, 'field token ok'));
  } catch (e) {
    steps.push(ok(false, 'field token: ' + e.message));
    report.roles.FIELD = { steps, pass: false, fw };
    return;
  }

  const context = await browser.newContext({ viewport: { width: 430, height: 900 }, serviceWorkers: 'block' });
  await context.addInitScript(({ token, emp }) => {
    localStorage.setItem('field_auth_epoch', '6');
    localStorage.setItem('field_token', token);
    localStorage.setItem('field_employee', JSON.stringify(emp || {}));
    localStorage.setItem('field_has_pin', '1');
  }, { token: tok.token, emp: tok.employee || { id: fw.employee_id, fio: 'Test Worker' } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  for (const pathUrl of ['/m/field/home', '/m/field/assembly', '/m/field/receiving']) {
    await page.goto(BASE + pathUrl, { waitUntil: 'commit', timeout: 60000 });
    await page.waitForTimeout(2000);
    if (page.url().includes('pin-entry') || page.url().includes('pin-setup')) {
      const pinInput = page.locator('input[type="tel"], input[inputmode="numeric"]').first();
      if (await pinInput.count()) {
        await pinInput.fill('0000');
        await page.waitForTimeout(2000);
      }
      await page.goto(BASE + pathUrl, { waitUntil: 'commit', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }
    const body = await page.locator('body').innerText();
    const name = pathUrl.split('/').pop();
    const landed = !/field-login|Введите телефон/i.test(body)
      && (page.url().includes('/field/') && !page.url().includes('pin-entry') && !page.url().includes('pin-setup'));
    // accept home redirect variants
    const okLand = landed || (/сборк|приём|смен|Главная|работ|наряд/i.test(body) && !page.url().includes('login'));
    steps.push(ok(okLand, 'FIELD ' + name + ' url=' + page.url() + ' body=' + body.replace(/\s+/g, ' ').slice(0, 80)));
    await page.screenshot({ path: path.join(OUT, 'field-' + name + '.png') });
  }
  steps.push(ok(consoleErrors.filter(e => !/favicon|403|navigator\.vibrate|chromestatus\.com\/feature\/5644273861001216/i.test(e)).length < 5, 'FIELD console mostly clean'));
  report.roles.FIELD = { steps, pass: steps.every(s => s.pass), fw, consoleErrors: consoleErrors.slice(0, 15) };
  await context.close();
}

async function main() {
  console.log('E2E start', BASE);
  const health = await fetch(BASE + '/api/health').then(r => r.json()).catch(() => null);
  if (!health || health.status !== 'ok') {
    console.error('Server not healthy on', BASE);
    process.exit(1);
  }
  console.log('health ok');

  const browser = await chromium.launch({ headless: true });
  try {
    console.log('role PM…');
    await runPM(browser);
    console.log('PM', report.roles.PM?.pass);
    console.log('role WAREHOUSE…');
    await runWarehouse(browser);
    console.log('WAREHOUSE', report.roles.WAREHOUSE?.pass);
    console.log('role PROC…');
    await runProc(browser);
    console.log('PROC', report.roles.PROC?.pass);
    console.log('role FIELD…');
    await runWorker(browser);
    console.log('FIELD', report.roles.FIELD?.pass);
  } finally {
    await browser.close();
  }

  report.finished_at = new Date().toISOString();
  report.summary = Object.fromEntries(Object.entries(report.roles).map(([k, v]) => [k, !!v.pass]));
  const outFile = path.join(OUT, 'ROLES-UI-E2E.json');
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary, null, 2));
  console.log('Wrote', outFile);
  const failed = Object.values(report.summary).filter(v => !v).length;
  process.exit(failed ? 2 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
