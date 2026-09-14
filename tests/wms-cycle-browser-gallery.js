'use strict';
/**
 * Браузерная галерея полного бизнес-цикла склада/закупок.
 * Playwright (headless Chromium): UI-клики где возможно,
 * API только для смены статуса (approve/pay/deliver), после каждого — скрин страницы/модалки.
 *
 * Артефакты: tests/reports/wms-cycle-browser/
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

process.env.TEST_BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const BASE = process.env.TEST_BASE_URL.replace(/\/$/, '');
const OUT = path.join(__dirname, 'reports', 'wms-cycle-browser');
const FIX = path.join(__dirname, 'fixtures', 'wms-cart-scenario-a.xlsx');
fs.mkdirSync(OUT, { recursive: true });

const ACCOUNTS = {
  PM: { login: 'test_pm', password: 'Test123!', pin: '0000' },
  PROC: { login: 'test_proc', password: 'Test123!', pin: '0000' },
  WAREHOUSE: { login: 'test_warehouse', password: 'Test123!', pin: '0000' },
  DIRECTOR_GEN: { login: 'test_director_gen', password: 'Test123!', pin: '0000' },
  BUH: { login: 'test_buh', password: 'Test123!', pin: '0000' },
};

const report = {
  started_at: new Date().toISOString(),
  base: BASE,
  tag: 'GALLERY-' + Date.now(),
  shots: [],
  notes: [],
  ids: {},
  summary: {},
};

function note(msg) {
  report.notes.push(msg);
  console.log('[note]', msg);
}

async function login(role) {
  const a = ACCOUNTS[role];
  const lr = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: a.login, password: a.password }),
  }).then((r) => r.json());
  if (!lr.token) throw new Error(role + ' login fail');
  let token = lr.token;
  let user = lr.user;
  if (lr.status === 'need_pin') {
    const pr = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: a.pin }),
    }).then((r) => r.json());
    if (!pr.token) throw new Error(role + ' pin fail');
    token = pr.token;
    user = pr.user || user;
  }
  return { token, user, role };
}

async function api(auth, method, urlPath, body) {
  const opts = { method, headers: { Authorization: 'Bearer ' + auth.token } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(BASE + urlPath, opts);
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch (_) { data = text; }
  return { status: r.status, ok: r.ok, data };
}

async function clearCart(auth) {
  const cart = await api(auth, 'GET', '/api/warehouse-cart');
  for (const it of cart.data.items || []) {
    await api(auth, 'DELETE', '/api/warehouse-cart/items/' + it.id);
  }
}

async function markPresence(auth) {
  await api(auth, 'POST', '/api/daily-presence', { status_code: 'оф' }).catch(() => {});
}

async function dismissChrome(page) {
  // Presence gate: выбрать «В офисе» → «В строй»
  await page.evaluate(() => {
    const gate = document.getElementById('asgard-presence-gate');
    if (!gate) return;
    const office = [...gate.querySelectorAll('button')].find((b) => /В офисе/i.test(b.textContent || ''));
    if (office) office.click();
  }).catch(() => {});
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const gate = document.getElementById('asgard-presence-gate');
    if (!gate) return;
    const go = gate.querySelector('#pg-save') || [...gate.querySelectorAll('button')].find((b) => /В строй/i.test(b.textContent || ''));
    if (go) go.click();
  }).catch(() => {});
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const gate = document.getElementById('asgard-presence-gate');
    if (gate) gate.remove();
  }).catch(() => {});

  // Свитки / обучение — только «Позже», не трогаем рабочие drawer/модалки
  for (const t of ['Позже', 'Понял', 'Не сейчас']) {
    await page.getByRole('button', { name: new RegExp('^' + t + '$', 'i') }).first().click({ timeout: 400 }).catch(() => {});
  }
}

async function openDesktop(browser, auth, hash) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const today = new Date().toISOString().slice(0, 10);
  await context.addInitScript(({ token, user, today }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user || {}));
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user || {}));
    localStorage.setItem('asgard_theme', 'dark');
    localStorage.setItem('asgard_theme_chosen', '1');
    localStorage.setItem('asgard_shell_banner_dismissed', '1');
    localStorage.setItem('asgard_v2_banner_dismissed', '1');
    localStorage.setItem('presence_done_' + today, '1');
    localStorage.setItem('asgard_presence_done_' + today, '1');
  }, { token: auth.token, user: auth.user, today });
  const page = await context.newPage();
  await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 60000 });
  await page.evaluate(async () => {
    try {
      if (navigator.serviceWorker) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) await r.unregister();
      }
      if (window.caches) {
        const keys = await caches.keys();
        for (const k of keys) await caches.delete(k);
      }
    } catch (_) {}
  }).catch(() => {});
  await page.goto(BASE + '/?nocache=' + Date.now() + hash, { waitUntil: 'commit', timeout: 60000 });
  await page.waitForTimeout(2200);
  await dismissChrome(page);
  await dismissChrome(page);
  return { context, page };
}

async function shot(page, name, label) {
  const file = path.join(OUT, name + '.png');
  await page.waitForTimeout(400);
  await page.screenshot({ path: file, fullPage: false });
  const entry = {
    name,
    label: label || name,
    file: path.relative(path.join(__dirname, '..'), file).replace(/\\/g, '/'),
    url: page.url(),
    at: new Date().toISOString(),
  };
  report.shots.push(entry);
  console.log('[shot]', name, '—', label || '');
  return entry;
}

async function ensureFieldWorker() {
  const pool = new Pool({
    user: process.env.PGUSER || 'asgard',
    password: process.env.PGPASSWORD || '123456789',
    database: process.env.PGDATABASE || 'asgard_crm_dev',
    host: process.env.PGHOST || '127.0.0.1',
  });
  try {
    const emp = (await pool.query(`
      SELECT e.id, e.phone, e.fio, e.full_name, e.user_id
      FROM employees e
      WHERE e.is_active = true AND e.phone IS NOT NULL
        AND length(regexp_replace(e.phone, '\\D', '', 'g')) >= 10
      ORDER BY e.id ASC LIMIT 1`)).rows[0];
    if (!emp) throw new Error('no employee');
    let userId = emp.user_id;
    if (!userId) {
      const ins = await pool.query(`
        INSERT INTO users(login, name, role, is_active, password_hash)
        VALUES($1, $2, 'FIELD_WORKER', true, $3)
        ON CONFLICT DO NOTHING RETURNING id`,
      ['field_test_' + emp.id, emp.fio || 'Field', await bcrypt.hash('FieldTest123!', 10)]);
      userId = ins.rows[0] && ins.rows[0].id;
      if (!userId) {
        const u = await pool.query(`SELECT id FROM users WHERE login=$1`, ['field_test_' + emp.id]);
        userId = u.rows[0] && u.rows[0].id;
      }
      if (userId) await pool.query(`UPDATE employees SET user_id=$1 WHERE id=$2`, [userId, emp.id]);
    }
    await pool.query(`UPDATE users SET pin_hash=$1 WHERE id=$2`, [await bcrypt.hash('0000', 10), userId]);
    return { employee_id: emp.id, phone: emp.phone, user_id: userId, pin: '0000' };
  } finally {
    await pool.end();
  }
}

async function fieldToken(fw) {
  const pinR = await fetch(BASE + '/api/field/auth/pin-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_id: fw.employee_id, pin: fw.pin }),
  });
  const pinD = await pinR.json().catch(() => ({}));
  if (pinR.ok && pinD.token) return pinD;
  await fetch(BASE + '/api/field/auth/request-code', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: fw.phone }),
  });
  const pool = new Pool({ user: 'asgard', password: '123456789', database: 'asgard_crm_dev', host: '127.0.0.1' });
  let code;
  try {
    const r = await pool.query(`
      SELECT code FROM field_auth_codes
      WHERE employee_id=$1 AND used=false AND expires_at>NOW()
      ORDER BY id DESC LIMIT 1`, [fw.employee_id]);
    code = r.rows[0] && r.rows[0].code;
  } finally { await pool.end(); }
  if (!code) throw new Error('no SMS code');
  const vr = await fetch(BASE + '/api/field/auth/verify-code', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: fw.phone, code }),
  });
  const vd = await vr.json();
  if (vd.token && !vd.has_pin) {
    await fetch(BASE + '/api/field/auth/setup-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + vd.token },
      body: JSON.stringify({ pin: '0000' }),
    });
  }
  return vd;
}

async function main() {
  console.log('CYCLE BROWSER GALLERY', BASE, report.tag);
  const health = await fetch(BASE + '/api/health').then((r) => r.json());
  if (!health || health.status !== 'ok') throw new Error('health fail');

  const pm = await login('PM');
  const proc = await login('PROC');
  const wh = await login('WAREHOUSE');
  const dir = await login('DIRECTOR_GEN');
  const buh = await login('BUH');
  for (const a of [pm, proc, wh, dir, buh]) await markPresence(a);

  await clearCart(pm);

  // Работа через API (форма создания работы тяжёлая) — потом скрин списка
  const workRes = await api(pm, 'POST', '/api/works', {
    work_title: report.tag + ' Монтаж',
    object_place: 'Рязань',
    customer_name: 'Gallery Заказчик',
    status: 'in_progress',
  });
  const workId = (workRes.data.item && workRes.data.item.id)
    || (workRes.data.work && workRes.data.work.id)
    || workRes.data.id;
  report.ids.work_id = workId;
  note('work_id=' + workId);

  const browser = await chromium.launch({ headless: true });
  try {
    // ── PM: склад → корзина → Excel → submit (настоящий UI) ──
    {
      const { context, page } = await openDesktop(browser, pm, '#/warehouse-v2');
      await page.waitForSelector('.wh2-fab__btn, #wh2-cart-fab', { timeout: 20000 }).catch(() => {});
      await shot(page, '01-pm-warehouse', 'PM: склад / каталог');

      await page.evaluate(() => {
        if (window.AsgardWarehouseCart && window.AsgardWarehouseCart.open) window.AsgardWarehouseCart.open();
        else {
          const fab = document.querySelector('.wh2-fab__btn');
          if (fab) fab.click();
        }
      });
      await page.waitForTimeout(1200);
      await shot(page, '02-pm-cart-empty', 'PM: модалка/drawer корзины');

      await page.evaluate(() => {
        const b = document.getElementById('wh2-cart-excel');
        if (b) b.click();
        else if (window.AsgardWarehouseCart && window.AsgardWarehouseCart.openExcel) window.AsgardWarehouseCart.openExcel();
      });
      await page.waitForTimeout(800);
      await shot(page, '03-pm-excel-panel', 'PM: панель Excel');

      if (!fs.existsSync(FIX)) throw new Error('fixture missing');
      if (!(await page.locator('#wh2-xl-file').count())) throw new Error('no excel file input');
      await page.locator('#wh2-xl-file').setInputFiles(FIX);
      await page.waitForSelector('#wh2-xl-add', { timeout: 45000 });
      await shot(page, '04-pm-excel-preview', 'PM: AI-превью Excel');

      const addWait = page.waitForResponse(
        (r) => r.url().includes('/api/warehouse-cart/items') && r.request().method() === 'POST',
        { timeout: 30000 }
      ).catch(() => null);
      await page.evaluate(() => { const b = document.getElementById('wh2-xl-add'); if (b) b.click(); });
      await addWait;
      await page.waitForTimeout(1500);
      if (!(await page.locator('.wh2-cart-it, #wh2-cart-submit').count())) {
        await page.evaluate(() => {
          if (window.AsgardWarehouseCart && window.AsgardWarehouseCart.open) window.AsgardWarehouseCart.open();
        });
        await page.waitForTimeout(1000);
      }
      await shot(page, '05-pm-cart-filled', 'PM: корзина заполнена');

      // привязка work_id через API если UI не умеет глобально
      const cart = await api(pm, 'GET', '/api/warehouse-cart');
      for (const it of cart.data.items || []) {
        if (!it.work_id) {
          await api(pm, 'PUT', '/api/warehouse-cart/items/' + it.id, { work_id: workId }).catch(() => {});
        }
      }
      // гарантируем закупку
      if (!(cart.data.items || []).some((i) => i.item_type === 'new_position' || i.source === 'manual')) {
        await api(pm, 'POST', '/api/warehouse-cart/items', {
          warehouse_id: 1,
          items: [{
            item_type: 'new_position',
            custom_name: 'Gallery уплотнение ' + report.tag,
            need_qty: 2,
            manual_price: 12000,
            work_id: workId,
            source: 'manual',
          }],
        });
        await page.evaluate(() => {
          if (window.AsgardWarehouseCart && window.AsgardWarehouseCart.open) window.AsgardWarehouseCart.open();
        });
        await page.waitForTimeout(1000);
        await shot(page, '05b-pm-cart-with-procure', 'PM: корзина + позиция на закупку');
      }

      if (await page.locator('#wh2-cart-preview').count()) {
        await page.evaluate(() => { const b = document.getElementById('wh2-cart-preview'); if (b) b.click(); });
        await page.waitForSelector('#wh2-prev-submit', { timeout: 15000 }).catch(() => {});
        await shot(page, '06-pm-submit-preview', 'PM: модалка превью отправки');
        const subWait = page.waitForResponse(
          (r) => r.url().includes('/api/warehouse-cart/submit') && r.request().method() === 'POST',
          { timeout: 30000 }
        ).catch(() => null);
        await page.evaluate(() => { const b = document.getElementById('wh2-prev-submit'); if (b) b.click(); });
        const subResp = await subWait;
        let subJson = {};
        if (subResp) subJson = await subResp.json().catch(() => ({}));
        report.ids.procurement_id = subJson.procurement_id;
        report.ids.assembly_id = subJson.assembly_id;
        if (!subResp || !subResp.ok() || !report.ids.procurement_id) {
          note('UI submit incomplete — API fallback');
          const submit = await api(pm, 'POST', '/api/warehouse-cart/submit', {
            global_work_id: workId,
            confirmed: true,
          });
          if (!submit.ok) throw new Error('submit fail ' + JSON.stringify(submit.data).slice(0, 200));
          report.ids.procurement_id = submit.data.procurement_id;
          report.ids.assembly_id = submit.data.assembly_id;
        }
        await page.waitForTimeout(2000);
        await shot(page, '07-pm-submitted', 'PM: после отправки корзины');
      } else {
        const submit = await api(pm, 'POST', '/api/warehouse-cart/submit', {
          global_work_id: workId,
          confirmed: true,
        });
        if (!submit.ok) throw new Error('submit fail');
        report.ids.procurement_id = submit.data.procurement_id;
        report.ids.assembly_id = submit.data.assembly_id;
        note('no preview button — API submit');
        await shot(page, '06-pm-submit-preview', 'PM: превью недоступно (API submit)');
        await shot(page, '07-pm-submitted', 'PM: после API submit');
      }
      note('procurement_id=' + report.ids.procurement_id + ' assembly_id=' + report.ids.assembly_id);

      await page.goto(BASE + '/#/my-procurement', { waitUntil: 'commit' });
      await page.waitForTimeout(2500);
      await dismissChrome(page);
      await shot(page, '08-pm-my-procurement', 'PM: Мои закупки после submit');
      await context.close();
    }

    const pid = report.ids.procurement_id;
    if (!pid) throw new Error('no procurement_id');

    // ── PROC UI ──
    {
      const { context, page } = await openDesktop(browser, proc, '#/procurement');
      await page.waitForTimeout(2000);
      await shot(page, '09-proc-board', 'PROC: доска закупок');
      await page.goto(BASE + '/#/procurement?id=' + pid, { waitUntil: 'commit' });
      await page.waitForTimeout(2500);
      await dismissChrome(page);
      // открыть карточку, если hash не развернул drawer
      await page.evaluate((id) => {
        const card = [...document.querySelectorAll('.proc-card, [data-id], .kanban-card, .proc-k-card')]
          .find((el) => (el.textContent || '').includes('#' + id) || (el.getAttribute('data-id') === String(id)));
        if (card) card.click();
        const byNum = [...document.querySelectorAll('*')].find((el) => (el.textContent || '').trim() === '#' + id);
        if (byNum && byNum.closest('button, a, .proc-card, .card')) byNum.closest('button, a, .proc-card, .card').click();
      }, pid).catch(() => {});
      await page.waitForTimeout(1200);
      await shot(page, '10-proc-detail-open', 'PROC: карточка заявки (sent_to_proc)');

      const procGet = await api(proc, 'GET', '/api/procurement/' + pid);
      for (const it of procGet.data.items || []) {
        if (it.unit_price == null || parseFloat(it.unit_price) <= 0) {
          await api(proc, 'PUT', `/api/procurement/${pid}/items/${it.id}`, {
            unit_price: 1000,
            supplier: 'Gallery Поставщик',
          });
        }
      }
      await page.reload({ waitUntil: 'commit' });
      await page.waitForTimeout(2000);
      await dismissChrome(page);
      await shot(page, '11-proc-prices-set', 'PROC: цены проставлены');

      await api(proc, 'PUT', `/api/procurement/${pid}/proc-respond`, {
        comment: 'Gallery: цены ок, срок 7 дней',
      });
      await page.reload({ waitUntil: 'commit' });
      await page.waitForTimeout(2000);
      await dismissChrome(page);
      await shot(page, '12-proc-responded', 'PROC: после proc-respond');
      await context.close();
    }

    // ── PM approve UI ──
    {
      const { context, page } = await openDesktop(browser, pm, '#/procurement?id=' + pid);
      await page.waitForTimeout(2200);
      await dismissChrome(page);
      await shot(page, '13-pm-before-approve', 'PM: заявка до pm-approve');
      await api(pm, 'PUT', `/api/procurement/${pid}/pm-approve`, {});
      await page.reload({ waitUntil: 'commit' });
      await page.waitForTimeout(2000);
      await dismissChrome(page);
      await shot(page, '14-pm-approved', 'PM: после pm-approve');
      await context.close();
    }

    // ── DIR ──
    {
      const { context, page } = await openDesktop(browser, dir, '#/procurement?id=' + pid);
      await page.waitForTimeout(2200);
      await dismissChrome(page);
      await shot(page, '15-dir-before-approve', 'DIR: до dir-approve');
      await api(dir, 'PUT', `/api/procurement/${pid}/dir-approve`, {});
      await page.reload({ waitUntil: 'commit' });
      await page.waitForTimeout(2000);
      await dismissChrome(page);
      await shot(page, '16-dir-approved', 'DIR: после dir-approve');
      await context.close();
    }

    // ── BUH ──
    {
      const { context, page } = await openDesktop(browser, buh, '#/procurement?id=' + pid);
      await page.waitForTimeout(2200);
      await dismissChrome(page);
      await shot(page, '17-buh-before-pay', 'BUH: до mark-paid');
      await api(buh, 'PUT', `/api/procurement/${pid}/mark-paid`, {});
      await page.reload({ waitUntil: 'commit' });
      await page.waitForTimeout(2000);
      await dismissChrome(page);
      await shot(page, '18-buh-paid', 'BUH: после оплаты');
      await context.close();
    }

    // ── WH incoming + deliver + ops ──
    {
      const { context, page } = await openDesktop(browser, wh, '#/warehouse-v2');
      await page.waitForTimeout(2000);
      await dismissChrome(page);
      const tab = page.locator('.wh2-tab[data-tab="incoming"]');
      if (await tab.count()) await tab.click({ force: true });
      await page.waitForTimeout(1500);
      await shot(page, '19-wh-incoming-paid', 'WH: Приёмка (после оплаты)');

      const afterPaid = await api(wh, 'GET', '/api/procurement/' + pid);
      for (const it of afterPaid.data.items || []) {
        if (it.item_status === 'delivered' || it.item_status === 'cancelled') continue;
        await api(wh, 'PUT', `/api/procurement/${pid}/items/${it.id}/deliver`, {});
      }
      await page.reload({ waitUntil: 'commit' });
      await page.waitForTimeout(1500);
      await dismissChrome(page);
      if (await tab.count()) await tab.click({ force: true });
      await page.waitForTimeout(1200);
      await shot(page, '20-wh-incoming-delivered', 'WH: после deliver позиций');

      await page.goto(BASE + '/#/procurement?id=' + pid, { waitUntil: 'commit' });
      await page.waitForTimeout(2200);
      await dismissChrome(page);
      await shot(page, '21-wh-proc-detail-delivered', 'WH: карточка заявки delivered');

      await page.goto(BASE + '/#/warehouse-v2', { waitUntil: 'commit' });
      await page.waitForTimeout(2000);
      await dismissChrome(page);
      await page.locator('.wh2-tab[data-tab="ops"]').click({ force: true }).catch(() => {});
      await page.waitForTimeout(800);
      await page.locator('#wh2-ops-receive').click({ force: true }).catch(() => {});
      await page.waitForTimeout(1200);
      await shot(page, '22-wh-ops-mass-receive', 'WH: массовая приёмка (модалка/панель)');

      await page.locator('.wh2-tab[data-tab="map"]').click({ force: true }).catch(() => {});
      await page.waitForTimeout(2000);
      await shot(page, '23-wh-map', 'WH: карта склада');
      await context.close();
    }

    // WMS session API + UI refresh
    {
      const locs = await api(wh, 'GET', '/api/warehouse/locations?warehouse_id=1&limit=20');
      const locList = locs.data.items || locs.data.locations || locs.data || [];
      const place = Array.isArray(locList) ? locList.find((l) => l.place_code || l.label) : null;
      const sess = await api(wh, 'POST', '/api/warehouse-ops/sessions', {
        warehouse_id: 1,
        session_type: 'receive',
        title: 'Gallery приёмка ' + report.tag,
        document_ref: 'GAL-' + report.tag.slice(-8),
        items: [{
          track_type: 'consumable',
          product_id: 33,
          planned_qty: 2,
          unit: 'кг',
          meta_json: { name: 'Электроды МР-3 3мм' },
        }],
      });
      const sessionId = (sess.data.session && sess.data.session.id) || sess.data.id;
      report.ids.wms_session_id = sessionId;
      const det = await api(wh, 'GET', '/api/warehouse-ops/sessions/' + sessionId);
      const lineId = (det.data.items || sess.data.items || [])[0] && (det.data.items || sess.data.items || [])[0].id;
      if (lineId && place) {
        await api(wh, 'POST', `/api/warehouse-ops/items/${lineId}/lock`, { device: 'gallery' });
        await api(wh, 'POST', `/api/warehouse-ops/items/${lineId}/confirm`, {
          place_code: place.place_code || place.label,
          location_id: place.id,
          fact_qty: 2,
          device: 'gallery',
        });
        await api(wh, 'POST', `/api/warehouse-ops/sessions/${sessionId}/close`, {});
      }
      const { context, page } = await openDesktop(browser, wh, '#/warehouse-v2');
      await page.locator('.wh2-tab[data-tab="ops"]').click({ force: true }).catch(() => {});
      await page.waitForTimeout(1500);
      await shot(page, '24-wh-ops-after-session', 'WH: ops после WMS-сессии');
      await context.close();
    }

    // ── Assembly ──
    {
      const asmId = report.ids.assembly_id;
      if (asmId) {
        const asmGet = await api(pm, 'GET', '/api/assembly/' + asmId);
        const st = (asmGet.data.item || asmGet.data.assembly || {}).status;
        if (st === 'draft') await api(pm, 'PUT', `/api/assembly/${asmId}/confirm`, {});
      }
      const { context, page } = await openDesktop(browser, pm, '#/assembly');
      await page.waitForTimeout(2500);
      await dismissChrome(page);
      await shot(page, '25-pm-assembly', 'PM: страница сборок');
      await context.close();
    }

    // close procurement
    {
      const finalGet = await api(pm, 'GET', '/api/procurement/' + pid);
      if (finalGet.data.item && finalGet.data.item.status === 'delivered') {
        await api(pm, 'PUT', `/api/procurement/${pid}/close`, {});
      }
      const { context, page } = await openDesktop(browser, pm, '#/procurement?id=' + pid);
      await page.waitForTimeout(2200);
      await dismissChrome(page);
      await shot(page, '26-pm-proc-final', 'PM: финальный статус заявки');
      await context.close();
    }

    // ── FIELD mobile ──
    {
      const fw = await ensureFieldWorker();
      const tok = await fieldToken(fw);
      const context = await browser.newContext({
        viewport: { width: 430, height: 900 },
        serviceWorkers: 'block',
      });
      await context.addInitScript(({ token, emp }) => {
        localStorage.setItem('field_auth_epoch', '6');
        localStorage.setItem('field_token', token);
        localStorage.setItem('field_employee', JSON.stringify(emp || {}));
        localStorage.setItem('field_has_pin', '1');
      }, { token: tok.token, emp: tok.employee || { id: fw.employee_id, fio: 'Test Worker' } });
      const page = await context.newPage();
      for (const [pth, name, label] of [
        ['/m/field/home', '27-field-home', 'FIELD: home'],
        ['/m/field/assembly', '28-field-assembly', 'FIELD: сборка'],
        ['/m/field/receiving', '29-field-receiving', 'FIELD: приёмка'],
      ]) {
        await page.goto(BASE + pth, { waitUntil: 'commit', timeout: 60000 });
        await page.waitForTimeout(1800);
        await page.evaluate(() => {
          const later = [...document.querySelectorAll('button')].find((b) => /Позже|Закрыть|Пропустить/i.test(b.textContent || ''));
          if (later) later.click();
        }).catch(() => {});
        await page.waitForTimeout(400);
        await shot(page, name, label);
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  report.finished_at = new Date().toISOString();
  report.summary = {
    shots: report.shots.length,
    ids: report.ids,
    pass: report.shots.length >= 20 && !!report.ids.procurement_id,
  };

  const indexMd = [
    '# WMS cycle browser gallery',
    '',
    `Tag: \`${report.tag}\``,
    `Base: ${BASE}`,
    `Shots: ${report.shots.length}`,
    `IDs: work=${report.ids.work_id}, procurement=${report.ids.procurement_id}, assembly=${report.ids.assembly_id}`,
    '',
    '| # | Shot | Label |',
    '|---|------|-------|',
    ...report.shots.map((s, i) => `| ${i + 1} | ![](${path.basename(s.file)}) | ${s.label} |`),
    '',
    '## Notes',
    ...report.notes.map((n) => '- ' + n),
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'INDEX.md'), indexMd);
  fs.writeFileSync(path.join(OUT, 'GALLERY.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary, null, 2));
  console.log('Wrote', OUT);
  process.exit(report.summary.pass ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  report.error = String(e && e.message || e);
  fs.writeFileSync(path.join(OUT, 'GALLERY.json'), JSON.stringify(report, null, 2));
  process.exit(2);
});
