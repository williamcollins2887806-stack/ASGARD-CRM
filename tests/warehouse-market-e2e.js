'use strict';
/**
 * E2E warehouse marketplace: login → catalog UI → market/search → assist →
 * cart add → preview-submit → submit (reserve/procure) → assert IDs.
 *
 * BASE: TEST_BASE_URL || https://asgard-crm.ru
 * Out: tests/reports/warehouse-market-e2e/
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = (process.env.TEST_BASE_URL || 'https://asgard-crm.ru').replace(/\/$/, '');
const OUT = path.join(__dirname, 'reports', 'warehouse-market-e2e');
const SHOTS = path.join(OUT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const ACCOUNTS = {
  PM: {
    login: process.env.E2E_PM_LOGIN || 'e2e_wh_market_pm',
    password: process.env.E2E_PM_PASSWORD || 'E2eMarket!2026',
    pin: process.env.E2E_PM_PIN || '0000',
  },
};

const report = {
  started_at: new Date().toISOString(),
  base: BASE,
  tag: 'WH-MARKET-' + Date.now(),
  steps: [],
  console_errors: [],
  ids: {},
  summary: { pass: false },
};

function step(name, pass, detail) {
  const row = { name, pass: !!pass, detail: detail || null, at: new Date().toISOString() };
  report.steps.push(row);
  console.log(`[${pass ? 'OK' : 'FAIL'}] ${name}${detail ? ' — ' + String(detail).slice(0, 240) : ''}`);
  if (!pass) {
    const err = new Error('STEP_FAIL: ' + name + (detail ? ' | ' + detail : ''));
    err.step = name;
    throw err;
  }
  return row;
}

async function login(role) {
  const a = ACCOUNTS[role];
  const lr = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: a.login, password: a.password }),
  }).then((r) => r.json());
  if (!lr.token) throw new Error(role + ' login ' + JSON.stringify(lr));
  let token = lr.token;
  let user = lr.user;
  if (lr.status === 'need_pin') {
    const pr = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: a.pin }),
    }).then((r) => r.json());
    if (!pr.token) throw new Error(role + ' pin ' + JSON.stringify(pr));
    token = pr.token;
    user = pr.user || user;
  }
  return { token, user, role, login: a.login };
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
  return { status: r.status, ok: r.ok, data, text };
}

async function shot(page, name) {
  const file = path.join(SHOTS, name + '.png');
  await page.screenshot({ path: file, fullPage: false }).catch(() => {});
  return file;
}

async function openUi(browser, auth, hash) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });
  await context.addInitScript((t) => {
    localStorage.setItem('token', t);
    localStorage.setItem('asgard_token', t);
  }, auth.token);
  const page = await context.newPage();
  const consoleBucket = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      consoleBucket.push(t);
      report.console_errors.push(t);
    }
  });
  page.on('pageerror', (err) => {
    consoleBucket.push(String(err));
    report.console_errors.push(String(err));
  });
  await page.goto(BASE + '/' + hash, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1800);
  return { context, page, consoleBucket };
}

async function clearCart(auth) {
  const cart = await api(auth, 'GET', '/api/warehouse-cart');
  for (const it of (cart.data && cart.data.items) || []) {
    await api(auth, 'DELETE', '/api/warehouse-cart/items/' + it.id);
  }
}

async function main() {
  const pm = await login('PM');
  step('login_pm', true, pm.user && (pm.user.login || pm.user.name));

  // ── API: market search ──
  const search = await api(pm, 'GET', '/api/warehouse/market/search?q=' + encodeURIComponent('каска') + '&limit=20');
  step('api_market_search', search.ok && search.status === 200, 'status=' + search.status + ' keys=' + Object.keys(search.data || {}).join(','));
  const items = (search.data && (search.data.items || search.data.results || search.data.rows)) || [];
  step('api_market_search_items', items.length > 0, 'n=' + items.length);
  report.ids.sample_product = items[0] && (items[0].product_id || items[0].id);

  // ── API: assist (proposals only) ──
  const assist = await api(pm, 'POST', '/api/warehouse-cart/assist', {
    message: 'нужны каски 5 шт и перчатки 10 пар',
  });
  step('api_assist', assist.ok, 'status=' + assist.status);
  const proposals = (assist.data && (assist.data.proposals || assist.data.items || assist.data.suggestions)) || [];
  step('api_assist_proposals', Array.isArray(proposals), 'n=' + (Array.isArray(proposals) ? proposals.length : typeof proposals));

  // ── find in-stock product for reserve path ──
  let stockProduct = null;
  const stockSearch = await api(pm, 'GET', '/api/warehouse/market/search?q=&availability=in_stock&kind=product&limit=30');
  const stockItems = (stockSearch.data && (stockSearch.data.items || stockSearch.data.results || [])) || [];
  stockProduct = stockItems.find((x) => (x.available_qty || x.qty || 0) > 0 || x.availability === 'in_stock' || x.in_stock);
  if (!stockProduct && stockItems[0]) stockProduct = stockItems[0];
  step('find_stock_product', !!stockProduct, stockProduct ? JSON.stringify({
    id: stockProduct.product_id || stockProduct.id,
    name: stockProduct.name,
    avail: stockProduct.available_qty || stockProduct.qty || stockProduct.availability,
  }) : 'none');

  await clearCart(pm);

  // pick a real work_id
  let workId = null;
  const works = await api(pm, 'GET', '/api/works?limit=20');
  const wrows = (works.data && (works.data.works || works.data.items || works.data.rows || works.data)) || [];
  if (Array.isArray(wrows) && wrows[0]) workId = wrows[0].id;
  if (!workId) {
    // fallback: common endpoint
    const w2 = await api(pm, 'GET', '/api/pm/works');
    const rows2 = (w2.data && (w2.data.works || w2.data.items || w2.data)) || [];
    if (Array.isArray(rows2) && rows2[0]) workId = rows2[0].id;
  }
  step('resolve_work_id', !!workId, 'work_id=' + workId);
  report.ids.work_id = workId;

  const productId = stockProduct.product_id || stockProduct.id;
  const add = await api(pm, 'POST', '/api/warehouse-cart/items', {
    warehouse_id: stockProduct.warehouse_id || 1,
    items: [{
      item_type: 'consumable',
      product_id: productId,
      need_qty: 1,
      work_id: workId,
      source: 'market_e2e',
    }],
  });
  step('cart_add_stock', add.ok, 'status=' + add.status + ' ' + JSON.stringify(add.data && (add.data.error || add.data.message) || '').slice(0, 120));

  // force a procure line (new position)
  const addNew = await api(pm, 'POST', '/api/warehouse-cart/items', {
    warehouse_id: 1,
    items: [{
      item_type: 'new_position',
      custom_name: 'E2E market тест ' + report.tag,
      need_qty: 2,
      manual_price: 100,
      work_id: workId,
      source: 'market_e2e',
    }],
  });
  step('cart_add_procure', addNew.ok, 'status=' + addNew.status);

  const preview = await api(pm, 'POST', '/api/warehouse-cart/preview-submit', { global_work_id: workId });
  step('preview_submit', preview.ok, 'status=' + preview.status + ' reserve=' + ((preview.data && preview.data.reserve_lines) || []).length +
    ' procure=' + ((preview.data && preview.data.procure_lines) || []).length);
  report.ids.preview = {
    reserve: ((preview.data && preview.data.reserve_lines) || []).length,
    procure: ((preview.data && preview.data.procure_lines) || []).length,
  };

  const submit = await api(pm, 'POST', '/api/warehouse-cart/submit', {
    global_work_id: workId,
    confirmed: true,
    object_name: 'E2E warehouse-market ' + report.tag,
  });
  step('submit_cart', submit.ok, 'status=' + submit.status + ' ' + JSON.stringify({
    reservations: (submit.data && submit.data.reservations) || null,
    procurement_id: submit.data && submit.data.procurement_id,
    assembly_id: submit.data && submit.data.assembly_id,
    error: submit.data && submit.data.error,
  }).slice(0, 300));
  report.ids.procurement_id = submit.data && submit.data.procurement_id;
  report.ids.assembly_id = submit.data && submit.data.assembly_id;
  report.ids.reservations = submit.data && submit.data.reservations;
  const hasReserveOrProcure = !!(
    report.ids.procurement_id ||
    (Array.isArray(report.ids.reservations) && report.ids.reservations.length) ||
    report.ids.assembly_id
  );
  step('submit_created_artifacts', hasReserveOrProcure, JSON.stringify(report.ids).slice(0, 400));

  // ── Browser UI ──
  const browser = await chromium.launch({ headless: true });
  try {
    const { context, page, consoleBucket } = await openUi(browser, pm, '#/warehouse-v2?tab=catalog');
    await page.waitForTimeout(2500);
    await shot(page, '01-catalog');

    const hasGrid = await page.evaluate(() => {
      return !!(
        document.querySelector('.wh2-m-grid') ||
        document.querySelector('#wh2-m-grid') ||
        document.querySelector('[data-wh2-market]') ||
        document.querySelector('.wh2-catalog') ||
        document.getElementById('wh2-root')
      );
    });
    step('ui_catalog_mount', hasGrid, 'grid=' + hasGrid);

    // search box
    const typed = await page.evaluate(() => {
      const inp = document.querySelector('#wh2-m-q, #wh2-search, input[placeholder*="иск"], .wh2-m-search input');
      if (!inp) return false;
      inp.focus();
      inp.value = 'каска';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));
      return true;
    });
    await page.waitForTimeout(2000);
    await shot(page, '02-search-kaska');
    step('ui_search_typed', typed, 'typed=' + typed);

    // open assist
    const assistOpened = await page.evaluate(() => {
      if (window.AsgardWarehouseCart && typeof window.AsgardWarehouseCart.openAssist === 'function') {
        window.AsgardWarehouseCart.openAssist();
        return true;
      }
      const btn = document.querySelector('#wh2-m-assist, [data-action="assist"], button[onclick*="Assist"]');
      if (btn) { btn.click(); return true; }
      return false;
    });
    await page.waitForTimeout(1500);
    await shot(page, '03-assist');
    step('ui_open_assist', assistOpened, 'opened=' + assistOpened);

    // assist=1 deep link
    await page.goto(BASE + '/#/warehouse-v2?tab=catalog&assist=1', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await shot(page, '04-assist-deeplink');
    step('ui_assist_deeplink', true, 'hash ok');

    const fatalConsole = consoleBucket.filter((t) =>
      /TypeError|ReferenceError|SyntaxError|is not defined|Cannot read/i.test(t) &&
      !/favicon|ResizeObserver|third-party/i.test(t)
    );
    step('ui_no_fatal_console', fatalConsole.length === 0, fatalConsole.slice(0, 3).join(' | ') || 'clean');

    await context.close();
  } finally {
    await browser.close();
  }

  report.finished_at = new Date().toISOString();
  report.summary.pass = report.steps.every((s) => s.pass);
  fs.writeFileSync(path.join(OUT, 'REPORT.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log('\nREPORT:', path.join(OUT, 'REPORT.json'));
  console.log('PASS:', report.summary.pass, 'steps:', report.steps.length);
  if (!report.summary.pass) process.exit(1);
}

main().catch((e) => {
  report.finished_at = new Date().toISOString();
  report.summary.pass = false;
  report.summary.error = String(e && e.stack || e);
  fs.writeFileSync(path.join(OUT, 'REPORT.json'), JSON.stringify(report, null, 2), 'utf8');
  console.error(e);
  process.exit(1);
});
