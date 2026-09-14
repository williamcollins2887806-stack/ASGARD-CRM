'use strict';
/**
 * Fast Doc Hub gate: API full chain + UI for all hub roles.
 * Writes tests/reports/doc-hub-e2e/INDEX.md
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const OUT = path.join(__dirname, 'reports', 'doc-hub-e2e');
fs.mkdirSync(OUT, { recursive: true });
const PASSWORD = 'Test123!';
const report = { started_at: new Date().toISOString(), base: BASE, checks: [], api: {} };

function add(name, pass, detail) {
  report.checks.push({ name, pass: !!pass, detail: detail || '' });
}

async function login(login) {
  const lr = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password: PASSWORD })
  }).then((r) => r.json());
  let token = lr.token;
  let user = lr.user;
  if (lr.status === 'need_pin') {
    const pr = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: '0000' })
    }).then((r) => r.json());
    token = pr.token;
    user = pr.user || user;
  }
  if (!token) throw new Error('login fail ' + login);
  const me = await fetch(BASE + '/api/auth/me', {
    headers: { Authorization: 'Bearer ' + token }
  }).then((r) => r.json()).catch(() => ({}));
  user = me.user || user || {};
  return { token, user, permissions: user.permissions || {} };
}

async function api(token, method, p, body) {
  const r = await fetch(BASE + '/api/doc-registry' + p, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = { raw: text }; }
  return { status: r.status, body: j };
}

async function dismissChrome(page) {
  await page.evaluate(() => {
    const d = new Date();
    for (let i = -1; i <= 1; i++) {
      const x = new Date(d.getTime() + i * 86400000);
      const key = x.toISOString().slice(0, 10);
      try { localStorage.setItem('presence_done_' + key, '1'); } catch (_) {}
    }
    const gate = document.getElementById('asgard-presence-gate');
    if (gate && gate.parentNode) gate.parentNode.removeChild(gate);
    document.querySelectorAll(
      '.cr-m-overlay, .modalback, [class*="overlay--visible"], .tp-popup, .telephony-popup, #sg-overlay, .sg-splash, #asgard-presence-gate'
    ).forEach((el) => {
      el.classList.remove('cr-m-overlay--visible', 'visible');
      el.style.display = 'none';
      try { el.remove(); } catch (_) {}
    });
    const splash = document.getElementById('asgard-splash');
    if (splash && splash.parentNode) splash.parentNode.removeChild(splash);
    try { localStorage.setItem('asgard_shell_banner_dismissed', '1'); } catch (_) {}
    try { localStorage.setItem('asgard_v2_banner_dismissed', '1'); } catch (_) {}
  });
  for (const t of ['Понял', 'Принять вызов', 'Закрыть', 'Позже', 'Пропустить', 'В строй']) {
    await page.getByRole('button', { name: new RegExp(t, 'i') }).first().click({ timeout: 400 }).catch(() => {});
  }
}

async function openDocHub(context, auth) {
  await context.addInitScript(({ token, user, permissions }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('auth_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user || {}));
    localStorage.setItem('asgard_permissions', JSON.stringify(permissions || {}));
    localStorage.setItem('asgard_theme', 'dark');
    localStorage.setItem('asgard_theme_chosen', '1');
    localStorage.setItem('asgard_shell_banner_dismissed', '1');
    localStorage.setItem('asgard_v2_banner_dismissed', '1');
    localStorage.setItem('asgard_safe_mode', '1');
    const d = new Date();
    for (let i = -1; i <= 1; i++) {
      const x = new Date(d.getTime() + i * 86400000);
      localStorage.setItem('presence_done_' + x.toISOString().slice(0, 10), '1');
    }
  }, auth);
  const page = await context.newPage();
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
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(BASE + '/?nocache=' + Date.now() + '#/doc-hub', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await page.waitForFunction(() => {
      return !!(window.AsgardApp && window.AsgardDocHubPage && localStorage.getItem('asgard_token'));
    }, { timeout: 25000 }).catch(() => {});
    await dismissChrome(page);
    await page.waitForTimeout(800 + attempt * 700);
    await dismissChrome(page);
    try {
      await page.waitForSelector('#dhBtnNew, .dh-top__h1, .dh-app', { timeout: 22000 });
      await dismissChrome(page);
      return page;
    } catch (e) {
      if (attempt === 2) throw e;
    }
  }
  return page;
}

(async () => {
  const tokenAuth = await login('test_buh');
  const token = tokenAuth.token;
  const stamp = Date.now();
  const create = await api(token, 'POST', '/', {
    dir: 'in', invoice_number: 'GATE-' + stamp, invoice_date: new Date().toISOString().slice(0, 10),
    counterparty_name: 'ООО Gate', amount_gross: 1220, has_vat: true, vat_rate: 0.22,
    payment_due_at: new Date(Date.now() + 86400000 * 4).toISOString().slice(0, 10),
    contract_mode: 'once', purpose_asgard: true,
    parsed_json: [{ name: 'Gate Cable ' + stamp, article: 'GC-' + stamp, unit_price: 100, quantity: 2, unit: 'м' }],
    ops_status: 'wait_sf'
  });
  report.api.create = create;
  add('api_create', create.status === 200 && create.body.id, JSON.stringify(create.body && create.body.id));
  const id = create.body.id;
  const dup = await api(token, 'POST', '/check-duplicate', {
    dir: 'in', invoice_number: 'GATE-' + stamp, invoice_date: new Date().toISOString().slice(0, 10),
    counterparty_name: 'ООО Gate', amount_gross: 1220
  });
  add('api_dup', dup.body && dup.body.duplicate === true, JSON.stringify(dup.body));
  add('api_facets', (await api(token, 'GET', '/facets?scope=all')).status === 200, '');
  add('api_parse', (await api(token, 'POST', '/' + id + '/parse-catalog', { items: [{ name: 'Gate Fitting ' + stamp, article: 'GF-' + stamp, unit_price: 10, quantity: 1 }] })).status === 200, '');
  // background enrich — short poll for exact article/name
  let prod = { items: [] };
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 250));
    prod = await fetch(BASE + '/api/products/search?q=' + encodeURIComponent('GC-' + stamp), {
      headers: { Authorization: 'Bearer ' + token }
    }).then((r) => r.json());
    if (Array.isArray(prod.items) && prod.items.some((it) => String(it.article || it.name || '').includes(String(stamp)))) break;
    prod = await fetch(BASE + '/api/products/search?q=' + encodeURIComponent('Gate Cable ' + stamp), {
      headers: { Authorization: 'Bearer ' + token }
    }).then((r) => r.json());
    if (Array.isArray(prod.items) && prod.items.some((it) => String(it.name || '').includes(String(stamp)))) break;
  }
  const catHit = Array.isArray(prod.items) && prod.items.find((it) => String(it.article || it.name || '').includes(String(stamp)));
  add('api_catalog', !!catHit, JSON.stringify(catHit && (catHit.article || catHit.name)));
  add('api_sf', (await api(token, 'POST', '/' + id + '/quick', { action: 'sf', number: 'SF1' })).status === 200, '');
  add('api_wh', (await api(token, 'POST', '/' + id + '/quick', { action: 'wh' })).status === 200, '');
  add('api_pay_redirect', !!(await api(token, 'POST', '/' + id + '/quick', { action: 'pay' })).body.redirect, '');
  add('api_export', !!(await api(token, 'POST', '/export-1c', { ids: [id] })).body.csv, '');
  const mergedPath = path.join(OUT, '..', 'doc-hub-excel', 'merged-rows.json');
  const mergedRows = JSON.parse(fs.readFileSync(mergedPath, 'utf8'));
  const dry = await api(token, 'POST', '/excel/dry-run', { rows: mergedRows });
  add('api_excel_dry', dry.status === 200, JSON.stringify(dry.body && (dry.body.summary || dry.body)));
  const apply = await api(token, 'POST', '/excel/apply', { rows: mergedRows });
  add('api_excel_apply', apply.status === 200, JSON.stringify(apply.body && (apply.body.summary || apply.body)));
  fs.writeFileSync(path.join(OUT, '..', 'doc-hub-excel', 'apply-result.json'), JSON.stringify(apply.body, null, 2));

  const browser = await chromium.launch({ headless: true });
  for (const role of [
    { key: 'BUH', login: 'test_buh' },
    { key: 'PM', login: 'test_pm' },
    { key: 'PROC', login: 'test_proc' },
    { key: 'WAREHOUSE', login: 'test_warehouse' },
    { key: 'DIRECTOR_GEN', login: 'test_director_gen' },
    { key: 'OFFICE_MANAGER', login: 'test_office_manager' },
    { key: 'TO', login: 'test_to' },
    { key: 'HEAD_PM', login: 'test_head_pm' },
    { key: 'HEAD_TO', login: 'test_head_to' },
    { key: 'ADMIN', login: 'test_admin' }
  ]) {
    let auth;
    try { auth = await login(role.login); add(role.key + '_login', true, role.login); }
    catch (e) { add(role.key + '_login', false, e.message); continue; }
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    try {
      const page = await openDocHub(ctx, auth);
      await dismissChrome(page);
      const ok = await page.locator('#dhBtnNew, .dh-top__h1, .dh-app').first().count();
      add(role.key + '_ui', ok > 0, ok ? 'shell' : 'missing');
      await page.screenshot({ path: path.join(OUT, role.key + '-registry.png'), fullPage: true }).catch(() => {});
      if (ok) {
        await dismissChrome(page);
        await page.locator('#dhBtnNew').click({ timeout: 8000, force: true });
        await page.waitForTimeout(500);
        add(role.key + '_wizard', (await page.locator('.dh-modal__card, #dhWizForm').count()) > 0, '');
        await page.locator('#dhModalClose, #dhWizCancel').first().click({ timeout: 2000, force: true }).catch(() => {});
        const scope = page.locator('#dhScopeAll');
        if (await scope.count()) {
          await scope.check({ force: true }).catch(() => {});
          await page.waitForTimeout(300);
          await scope.uncheck({ force: true }).catch(() => {});
          add(role.key + '_scope', true, 'mine/all');
        } else {
          add(role.key + '_scope', false, 'missing');
        }
      }
    } catch (e) {
      add(role.key + '_exception', false, e.message);
    }
    await ctx.close();
  }
  await browser.close();

  const pass = report.checks.filter((c) => c.pass).length;
  const fail = report.checks.filter((c) => !c.pass).length;
  report.finished_at = new Date().toISOString();
  report.summary = { pass, fail };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, 'INDEX.md'), [
    '# Doc Hub E2E INDEX (gate)',
    '',
    `PASS ${pass} / FAIL ${fail}`,
    `Started ${report.started_at}`,
    `Finished ${report.finished_at}`,
    '',
    ...report.checks.map((c) => `- ${c.pass ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ': ' + c.detail : ''}`),
    ''
  ].join('\n'));
  console.log(JSON.stringify(report.summary));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
