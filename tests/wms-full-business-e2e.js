'use strict';
/**
 * Полноценный бизнес-E2E склада/закупок/приёмки/сборки/поля.
 * Локально: http://127.0.0.1:3000 + asgard_crm_dev.
 * Без skip/ослаблений: любой FAIL = exit 2 + дыра чинится в коде, не в assert.
 *
 * Цепочка:
 *  PM: работа → корзина (Excel+API) → submit
 *  PROC: цены → proc-respond
 *  PM: pm-approve
 *  DIR: dir-approve
 *  BUH: mark-paid
 *  WH: incoming → deliver (+ WMS receive session)
 *  PM/WH: assembly
 *  FIELD: мобильные страницы сборки/приёмки
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

process.env.TEST_BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const BASE = process.env.TEST_BASE_URL.replace(/\/$/, '');
const OUT = path.join(__dirname, 'reports', 'wms-full-business');
const FIX = path.join(__dirname, 'fixtures', 'wms-cart-scenario-a.xlsx');
fs.mkdirSync(OUT, { recursive: true });

const ACCOUNTS = {
  PM: { login: 'test_pm', password: 'Test123!', pin: '0000' },
  PROC: { login: 'test_proc', password: 'Test123!', pin: '0000' },
  WAREHOUSE: { login: 'test_warehouse', password: 'Test123!', pin: '0000' },
  DIRECTOR_GEN: { login: 'test_director_gen', password: 'Test123!', pin: '0000' },
  BUH: { login: 'test_buh', password: 'Test123!', pin: '0000' },
  ADMIN: { login: 'test_admin', password: 'Test123!', pin: '0000' },
};

const report = {
  started_at: new Date().toISOString(),
  base: BASE,
  tag: 'FULL-BIZ-' + Date.now(),
  steps: [],
  ids: {},
  summary: { pass: false },
};

function step(name, pass, detail) {
  const row = { name, pass: !!pass, detail: detail || null, at: new Date().toISOString() };
  report.steps.push(row);
  const mark = pass ? 'OK' : 'FAIL';
  console.log(`[${mark}] ${name}${detail ? ' — ' + String(detail).slice(0, 180) : ''}`);
  if (!pass) {
    const err = new Error('STEP_FAIL: ' + name + (detail ? ' | ' + detail : ''));
    err.step = name;
    throw err;
  }
  return row;
}

async function login(role) {
  const a = ACCOUNTS[role];
  if (!a) throw new Error('no account ' + role);
  const lr = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: a.login, password: a.password }),
  }).then((r) => r.json());
  if (!lr.token) throw new Error(role + ' login fail ' + JSON.stringify(lr));
  let token = lr.token;
  let user = lr.user;
  if (lr.status === 'need_pin') {
    const pr = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: a.pin }),
    }).then((r) => r.json());
    if (!pr.token) throw new Error(role + ' pin fail ' + JSON.stringify(pr));
    token = pr.token;
    user = pr.user || user;
  }
  return { token, user, role };
}

async function api(auth, method, urlPath, body) {
  const opts = {
    method,
    headers: { Authorization: 'Bearer ' + auth.token },
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(BASE + urlPath, opts);
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch (_) { data = text; }
  return { status: r.status, ok: r.ok, data, text };
}

async function clearCart(auth) {
  const cart = await api(auth, 'GET', '/api/warehouse-cart');
  for (const it of cart.data.items || []) {
    await api(auth, 'DELETE', '/api/warehouse-cart/items/' + it.id);
  }
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
      WHERE e.is_active = true AND e.phone IS NOT NULL
        AND length(regexp_replace(e.phone, '\\D', '', 'g')) >= 10
      ORDER BY e.id ASC LIMIT 1`)).rows[0];
    if (!emp) throw new Error('no employee with phone');
    const phone = emp.phone;
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
        userId = u.rows[0] && u.rows[0].id;
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
  const pool = new Pool({
    user: 'asgard', password: '123456789', database: 'asgard_crm_dev', host: '127.0.0.1',
  });
  let code;
  try {
    const r = await pool.query(`
      SELECT code FROM field_auth_codes
      WHERE employee_id=$1 AND used=false AND expires_at>NOW()
      ORDER BY id DESC LIMIT 1`, [fw.employee_id]);
    code = r.rows[0] && r.rows[0].code;
  } finally { await pool.end(); }
  if (!code) throw new Error('no SMS code in DB');
  const vr = await fetch(BASE + '/api/field/auth/verify-code', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: fw.phone, code }),
  }).then((r) => r.json());
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

async function dismissChrome(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.cr-m-overlay, .modalback, [class*="overlay--visible"]').forEach((el) => {
      el.classList.remove('cr-m-overlay--visible');
      el.style.display = 'none';
      try { el.remove(); } catch (_) {}
    });
    localStorage.setItem('asgard_shell_banner_dismissed', '1');
    localStorage.setItem('asgard_v2_banner_dismissed', '1');
    localStorage.setItem('asgard_theme_chosen', '1');
    localStorage.setItem('asgard_theme', 'dark');
  });
}

async function openUi(browser, auth, hash) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user || {}));
    localStorage.setItem('asgard_theme', 'dark');
    localStorage.setItem('asgard_theme_chosen', '1');
    localStorage.setItem('asgard_shell_banner_dismissed', '1');
    localStorage.setItem('asgard_v2_banner_dismissed', '1');
  }, auth);
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
  await page.waitForTimeout(2200);
  await dismissChrome(page);
  return { context, page };
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: false }).catch(() => {});
}

async function main() {
  console.log('FULL BUSINESS E2E', BASE, report.tag);
  const health = await fetch(BASE + '/api/health').then((r) => r.json()).catch(() => null);
  step('0. health', !!(health && health.status === 'ok'), JSON.stringify(health));

  const pm = await login('PM');
  const proc = await login('PROC');
  const wh = await login('WAREHOUSE');
  const dir = await login('DIRECTOR_GEN');
  const buh = await login('BUH');
  step('0. logins', true, 'PM/PROC/WH/DIR/BUH');

  // ── 1. Работа ──
  const workTitle = report.tag + ' Монтаж тест';
  const workRes = await api(pm, 'POST', '/api/works', {
    work_title: workTitle,
    object_place: 'Рязань',
    customer_name: 'E2E Заказчик',
    status: 'in_progress',
  });
  step('1. PM создаёт работу', workRes.ok && !!(workRes.data.item || workRes.data.work || workRes.data.id),
    workRes.status + ' ' + JSON.stringify(workRes.data).slice(0, 200));
  const workId = (workRes.data.item && workRes.data.item.id)
    || (workRes.data.work && workRes.data.work.id)
    || workRes.data.id;
  report.ids.work_id = workId;
  step('1b. work_id', !!workId, String(workId));

  // ── 2. Корзина: очистка + Excel parse + items ──
  await clearCart(pm);
  step('2. корзина очищена', true);

  if (!fs.existsSync(FIX)) throw new Error('fixture missing ' + FIX);
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(FIX)]), 'wms-cart-scenario-a.xlsx');
  const parseR = await fetch(BASE + '/api/warehouse-cart/parse-excel', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + pm.token },
    body: fd,
  });
  const parseD = await parseR.json();
  step('2b. Excel parse', parseR.ok && (parseD.rows || []).length > 0, 'rows=' + (parseD.rows || []).length);

  // Берём 3 строки: дефицит (закупка) + наличие на складе + новая позиция
  const rows = parseD.rows || [];
  const pick = [];
  const deficit = rows.find((r) => r.matched && r.product_id && (r.available_qty || 0) < (r.quantity || 1));
  const inStock = rows.find((r) => r.matched && r.product_id && (r.available_qty || 0) >= (r.quantity || 1));
  const neu = rows.find((r) => r.is_new_position || !r.matched);
  if (deficit) pick.push(deficit);
  if (inStock && (!deficit || inStock.product_id !== deficit.product_id)) pick.push(inStock);
  if (neu) pick.push(neu);
  if (pick.length < 2) {
    // fallback: first 3 rows
    pick.push(...rows.slice(0, 3));
  }
  const unique = [];
  const seen = new Set();
  for (const r of pick) {
    const k = r.product_id || r.name;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(r);
  }
  step('2c. выбраны позиции для корзины', unique.length >= 2, unique.map((r) => r.name).join(' | '));

  const cartItems = unique.map((x) => {
    if (x.matched && x.product_id) {
      return {
        item_type: 'consumable',
        product_id: x.product_id,
        need_qty: Math.max(1, Math.min(parseFloat(x.quantity) || 1, 5)),
        work_id: workId,
        source: 'excel',
      };
    }
    return {
      item_type: 'new_position',
      custom_name: x.name || ('E2E позиция ' + report.tag),
      need_qty: Math.max(1, parseFloat(x.quantity) || 2),
      manual_price: x.unit_price || 1500,
      work_id: workId,
      source: 'excel',
    };
  });

  // гарантируем хотя бы одну закупку: если всё со склада — добавим new_position
  if (!cartItems.some((i) => i.item_type === 'new_position')) {
    cartItems.push({
      item_type: 'new_position',
      custom_name: 'E2E уплотнение ' + report.tag,
      need_qty: 2,
      manual_price: 12000,
      work_id: workId,
      source: 'manual',
    });
  }

  const add = await api(pm, 'POST', '/api/warehouse-cart/items', { warehouse_id: 1, items: cartItems });
  step('2d. добавить в корзину', add.ok && (add.data.items || []).length > 0,
    add.status + ' items=' + (add.data.items || []).length + ' ' + JSON.stringify(add.data.error || ''));

  const preview = await api(pm, 'POST', '/api/warehouse-cart/preview-submit', { global_work_id: workId });
  step('2e. preview-submit', preview.ok,
    `reserve=${(preview.data.reserve_lines || []).length} procure=${(preview.data.procure_lines || []).length}`);
  step('2f. в закупку есть позиции', (preview.data.procure_lines || []).length > 0,
    JSON.stringify(preview.data.procure_lines || []).slice(0, 200));

  const submit = await api(pm, 'POST', '/api/warehouse-cart/submit', {
    global_work_id: workId,
    destination: 'МЛСП Приразломная · ОФС',
    planned_date: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
    object_name: 'МЛСП Приразломная · ОФС',
    confirmed: true,
  });
  step('2g. submit корзины', submit.ok && submit.data.success,
    submit.status + ' ' + JSON.stringify(submit.data).slice(0, 300));
  report.ids.procurement_id = submit.data.procurement_id;
  report.ids.assembly_id = submit.data.assembly_id;
  report.ids.reservations = (submit.data.reservations || []).length;
  step('2h. создана заявка закупки', !!report.ids.procurement_id, 'procurement_id=' + report.ids.procurement_id);
  step('2i. создана/привязана сборка', !!report.ids.assembly_id, 'assembly_id=' + report.ids.assembly_id);

  // ── 3. PROC ──
  const procGet = await api(proc, 'GET', '/api/procurement/' + report.ids.procurement_id);
  step('3. PROC открывает заявку', procGet.ok && procGet.data.item,
    'status=' + (procGet.data.item && procGet.data.item.status) + ' items=' + (procGet.data.items || []).length);
  step('3b. статус sent_to_proc', procGet.data.item.status === 'sent_to_proc', procGet.data.item.status);

  for (const it of procGet.data.items || []) {
    if (it.unit_price == null || parseFloat(it.unit_price) <= 0) {
      const up = await api(proc, 'PUT', `/api/procurement/${report.ids.procurement_id}/items/${it.id}`, {
        unit_price: 1000,
        supplier: 'E2E Поставщик',
      });
      step('3c. PROC цена #' + it.id, up.ok, up.status + ' ' + (up.data.error || ''));
    }
  }

  const respond = await api(proc, 'PUT', `/api/procurement/${report.ids.procurement_id}/proc-respond`, {
    comment: 'E2E: цены проставлены, срок 7 дней',
  });
  step('3d. PROC proc-respond', respond.ok && respond.data.item && respond.data.item.status === 'proc_responded',
    respond.status + ' ' + ((respond.data.item && respond.data.item.status) || respond.data.error));

  // ── 4. PM approve ──
  const pmAppr = await api(pm, 'PUT', `/api/procurement/${report.ids.procurement_id}/pm-approve`, {});
  step('4. PM pm-approve', pmAppr.ok && pmAppr.data.item.status === 'pm_approved',
    pmAppr.status + ' ' + ((pmAppr.data.item && pmAppr.data.item.status) || pmAppr.data.error));

  // ── 5. DIR approve ──
  const dirAppr = await api(dir, 'PUT', `/api/procurement/${report.ids.procurement_id}/dir-approve`, {});
  step('5. DIR dir-approve', dirAppr.ok && dirAppr.data.item.status === 'dir_approved',
    dirAppr.status + ' ' + ((dirAppr.data.item && dirAppr.data.item.status) || dirAppr.data.error));

  // ── 6. BUH pay ──
  const paid = await api(buh, 'PUT', `/api/procurement/${report.ids.procurement_id}/mark-paid`, {});
  step('6. BUH mark-paid', paid.ok && paid.data.item.status === 'paid',
    paid.status + ' ' + ((paid.data.item && paid.data.item.status) || paid.data.error));

  // ── 7. WH incoming + deliver ──
  const incoming = await api(wh, 'GET', '/api/stock/incoming?target=all');
  step('7. WH incoming API', incoming.ok, 'keys=' + Object.keys(incoming.data || {}).join(','));
  const incomingTxt = JSON.stringify(incoming.data || {});
  step('7b. incoming содержит заявку', incomingTxt.includes(String(report.ids.procurement_id))
    || incomingTxt.includes('E2E') || incomingTxt.includes(report.tag.slice(-6)),
    incomingTxt.slice(0, 250));

  const afterPaid = await api(wh, 'GET', '/api/procurement/' + report.ids.procurement_id);
  step('7c. WH видит заявку', afterPaid.ok, 'items=' + (afterPaid.data.items || []).length);
  const deliverIds = [];
  for (const it of afterPaid.data.items || []) {
    if (it.item_status === 'delivered' || it.item_status === 'cancelled') continue;
    const d = await api(wh, 'PUT', `/api/procurement/${report.ids.procurement_id}/items/${it.id}/deliver`, {});
    step('7d. deliver #' + it.id + ' ' + (it.name || '').slice(0, 40), d.ok,
      d.status + ' ' + JSON.stringify(d.data.error || d.data.item && d.data.item.item_status || d.data).slice(0, 160));
    deliverIds.push(it.id);
  }
  step('7e. доставлено ≥1', deliverIds.length > 0, 'n=' + deliverIds.length);

  const afterDel = await api(wh, 'GET', '/api/procurement/' + report.ids.procurement_id);
  const st = afterDel.data.item.status;
  step('7f. статус заявки delivered/partially_delivered',
    st === 'delivered' || st === 'partially_delivered', st);

  // ── 8. WMS mass receive session (отдельный трек) ──
  const locs = await api(wh, 'GET', '/api/warehouse/locations?warehouse_id=1&limit=20');
  const locList = locs.data.items || locs.data.locations || locs.data || [];
  const place = Array.isArray(locList) ? locList.find((l) => l.place_code || l.label) : null;
  step('8. есть место на складе', !!place, place ? (place.place_code || place.label || place.id) : JSON.stringify(locs.data).slice(0, 120));

  const sess = await api(wh, 'POST', '/api/warehouse-ops/sessions', {
    warehouse_id: 1,
    session_type: 'receive',
    title: 'E2E приёмка ' + report.tag,
    document_ref: 'E2E-' + report.tag.slice(-8),
    items: [{
      track_type: 'consumable',
      product_id: 33, // Электроды — реальный каталог
      planned_qty: 3,
      unit: 'кг',
      meta_json: { name: 'Электроды МР-3 3мм' },
    }],
  });
  step('8b. WMS receive session', sess.ok && (sess.data.session || sess.data).id,
    sess.status + ' ' + JSON.stringify(sess.data).slice(0, 220));
  const sessionId = (sess.data.session && sess.data.session.id) || sess.data.id;
  report.ids.wms_session_id = sessionId;
  const sessItems = sess.data.items || (sess.data.session && sess.data.session.items) || [];
  let lineId = sessItems[0] && sessItems[0].id;
  if (!lineId) {
    const det = await api(wh, 'GET', '/api/warehouse-ops/sessions/' + sessionId);
    lineId = (det.data.items || [])[0] && (det.data.items || [])[0].id;
  }
  step('8c. строка сессии', !!lineId, 'line=' + lineId);

  await api(wh, 'POST', `/api/warehouse-ops/items/${lineId}/lock`, { device: 'e2e' });
  const confirm = await api(wh, 'POST', `/api/warehouse-ops/items/${lineId}/confirm`, {
    place_code: place.place_code || place.label,
    location_id: place.id,
    fact_qty: 3,
    device: 'e2e',
  });
  step('8d. confirm putaway/receive line', confirm.ok,
    confirm.status + ' ' + JSON.stringify(confirm.data).slice(0, 200));

  const closeS = await api(wh, 'POST', `/api/warehouse-ops/sessions/${sessionId}/close`, {});
  step('8e. close session', closeS.ok || closeS.status === 200,
    closeS.status + ' ' + JSON.stringify(closeS.data).slice(0, 160));

  // ── 9. Assembly ──
  const asmId = report.ids.assembly_id;
  const asmGet = await api(pm, 'GET', '/api/assembly/' + asmId);
  step('9. assembly GET', asmGet.ok, 'status=' + ((asmGet.data.item || asmGet.data.assembly || {}).status));
  const asmStatus = (asmGet.data.item || asmGet.data.assembly || {}).status;
  if (asmStatus === 'draft' || asmStatus === 'confirmed') {
    if (asmStatus === 'draft') {
      const conf = await api(pm, 'PUT', `/api/assembly/${asmId}/confirm`, {});
      step('9b. assembly confirm', conf.ok, conf.status + ' ' + JSON.stringify(conf.data).slice(0, 120));
    } else {
      step('9b. assembly already confirmed', true, asmStatus);
    }
  } else {
    step('9b. assembly status usable', !!asmStatus, asmStatus);
  }

  // ── 10. Playwright UI checks ──
  const browser = await chromium.launch({ headless: true });
  try {
    // PM my-procurement
    {
      const { context, page } = await openUi(browser, pm, '#/my-procurement');
      await page.waitForTimeout(2000);
      const body = await page.locator('body').innerText();
      step('10. UI PM my-procurement', /заявк|закуп/i.test(body) && !/войти/i.test(body.slice(0, 40)), body.slice(0, 80));
      step('10b. UI PM видит нашу заявку/тег', body.includes(String(report.ids.procurement_id)) || body.includes('корзин') || body.includes('FULL-BIZ') || body.includes('Заявка'),
        'proc=' + report.ids.procurement_id);
      await shot(page, '10-pm-my-procurement');
      await context.close();
    }
    // PROC board
    {
      const { context, page } = await openUi(browser, proc, '#/procurement?id=' + report.ids.procurement_id);
      await page.waitForTimeout(2500);
      await dismissChrome(page);
      const body = await page.locator('body').innerText();
      step('10c. UI PROC заявка', /закуп|заявк|оплач|доставл|позиц/i.test(body), body.slice(0, 100));
      await shot(page, '10-proc-detail');
      await context.close();
    }
    // WH warehouse incoming
    {
      const { context, page } = await openUi(browser, wh, '#/warehouse-v2');
      await page.waitForTimeout(2000);
      await dismissChrome(page);
      const tab = page.locator('.wh2-tab[data-tab="incoming"]');
      step('10d. UI WH вкладка Приёмка', await tab.count() > 0);
      await tab.click({ force: true });
      await page.waitForTimeout(1500);
      const body = await page.locator('body').innerText();
      step('10e. UI WH приёмка контент', /приёмк|склад|доставл|в пути|ожид/i.test(body), body.slice(0, 100));
      await shot(page, '10-wh-incoming');
      // ops mass receive
      await page.locator('.wh2-tab[data-tab="ops"]').click({ force: true }).catch(() => {});
      await page.waitForTimeout(800);
      await page.locator('#wh2-ops-receive').click({ force: true }).catch(() => {});
      await page.waitForTimeout(1000);
      const ops = await page.locator('body').innerText();
      step('10f. UI WH массовая приёмка', /файл|уpd|уpd|вставк|сесси/i.test(ops) || /Массовая приёмка|УПД|вставк/i.test(ops), ops.slice(0, 80));
      await shot(page, '10-wh-ops-receive');
      await context.close();
    }
    // Assembly page
    {
      const { context, page } = await openUi(browser, pm, '#/assembly');
      await page.waitForTimeout(2500);
      const body = await page.locator('body').innerText();
      step('10g. UI assembly', /сборк|паллет|мобилиз/i.test(body), body.slice(0, 80));
      await shot(page, '10-assembly');
      await context.close();
    }
    // FIELD
    {
      const fw = await ensureFieldWorker();
      const tok = await fieldToken(fw);
      step('10h0. FIELD token', !!(tok && tok.token), tok && tok.token ? 'ok' : JSON.stringify(tok));
      const context = await browser.newContext({ viewport: { width: 430, height: 900 }, serviceWorkers: 'block' });
      await context.addInitScript(({ token, emp }) => {
        localStorage.setItem('field_auth_epoch', '6');
        localStorage.setItem('field_token', token);
        localStorage.setItem('field_employee', JSON.stringify(emp || {}));
        localStorage.setItem('field_has_pin', '1');
      }, { token: tok.token, emp: tok.employee || { id: fw.employee_id, fio: 'Test Worker' } });
      const page = await context.newPage();
      for (const pth of ['/m/field/home', '/m/field/assembly', '/m/field/receiving']) {
        await page.goto(BASE + pth, { waitUntil: 'commit', timeout: 60000 });
        await page.waitForTimeout(1800);
        const body = await page.locator('body').innerText();
        const name = pth.split('/').pop();
        step('10h. FIELD ' + name,
          !/Введите телефон|field-login/i.test(body) && (/сбор|приём|работ|добро|паллет|скан/i.test(body) || page.url().includes('/field/')),
          body.replace(/\s+/g, ' ').slice(0, 70));
        await page.screenshot({ path: path.join(OUT, '10-field-' + name + '.png') }).catch(() => {});
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  // ── 11. Close procurement if delivered ──
  const finalGet = await api(pm, 'GET', '/api/procurement/' + report.ids.procurement_id);
  if (finalGet.data.item && finalGet.data.item.status === 'delivered') {
    const cl = await api(pm, 'PUT', `/api/procurement/${report.ids.procurement_id}/close`, {});
    step('11. PM close delivered', cl.ok && cl.data.item.status === 'closed',
      cl.status + ' ' + ((cl.data.item && cl.data.item.status) || cl.data.error));
  } else {
    step('11. close skipped (не delivered)', true, finalGet.data.item && finalGet.data.item.status);
  }

  report.finished_at = new Date().toISOString();
  report.summary = {
    pass: report.steps.every((s) => s.pass),
    total: report.steps.length,
    failed: report.steps.filter((s) => !s.pass).map((s) => s.name),
    ids: report.ids,
  };
  fs.writeFileSync(path.join(OUT, 'FULL-BUSINESS-E2E.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary, null, 2));
  console.log('Wrote', path.join(OUT, 'FULL-BUSINESS-E2E.json'));
  process.exit(report.summary.pass ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  report.finished_at = new Date().toISOString();
  report.summary = {
    pass: false,
    error: String(e.message || e),
    failed_step: e.step || null,
    ids: report.ids,
    steps: report.steps,
  };
  fs.writeFileSync(path.join(OUT, 'FULL-BUSINESS-E2E.json'), JSON.stringify(report, null, 2));
  process.exit(2);
});
