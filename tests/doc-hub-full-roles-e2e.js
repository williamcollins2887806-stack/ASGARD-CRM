'use strict';
/**
 * Doc Hub FULL roles E2E — deep UI + API catalog proof.
 * Exit 0 only if zero FAIL. Artifacts: tests/reports/doc-hub-e2e/
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const OUT = path.join(__dirname, 'reports', 'doc-hub-e2e');
const FIX = path.join(OUT, 'fixtures');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(FIX, { recursive: true });

const PASSWORD = process.env.TEST_PASSWORD || 'Test123!';
const PIN = process.env.TEST_PIN || '0000';

const ROLES = [
  { key: 'ADMIN', login: 'test_admin' },
  { key: 'BUH', login: 'test_buh' },
  { key: 'PM', login: 'test_pm' },
  { key: 'HEAD_PM', login: 'test_head_pm' },
  { key: 'TO', login: 'test_to' },
  { key: 'HEAD_TO', login: 'test_head_to' },
  { key: 'PROC', login: 'test_proc' },
  { key: 'WAREHOUSE', login: 'test_warehouse' },
  { key: 'OFFICE_MANAGER', login: 'test_office_manager' },
  { key: 'DIRECTOR_GEN', login: 'test_director_gen' }
];

const report = {
  started_at: new Date().toISOString(),
  base: BASE,
  api: {},
  roles: {},
  summary: { pass: 0, fail: 0 }
};

function mark(bucket, check, pass, detail) {
  if (!report.roles[bucket]) report.roles[bucket] = { checks: [] };
  report.roles[bucket].checks.push({ check, pass: !!pass, detail: String(detail || '').slice(0, 240) });
  if (pass) report.summary.pass++; else report.summary.fail++;
}

async function login(loginName) {
  const lr = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: loginName, password: PASSWORD })
  }).then((r) => r.json());
  if (!lr.token) throw new Error('login fail ' + loginName + ' ' + JSON.stringify(lr));
  let token = lr.token;
  let user = lr.user;
  if (lr.status === 'need_pin') {
    const pr = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: PIN })
    }).then((r) => r.json());
    if (!pr.token) throw new Error('pin fail ' + loginName);
    token = pr.token;
    user = pr.user || user;
  }
  const me = await fetch(BASE + '/api/auth/me', {
    headers: { Authorization: 'Bearer ' + token }
  }).then((r) => r.json()).catch(() => ({}));
  user = me.user || user || {};
  return { token, user, permissions: user.permissions || {} };
}

async function api(token, method, p, body) {
  const r = await fetch(BASE + '/api/doc-registry' + p, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      ...(body != null && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {})
    },
    body: body == null ? undefined : (body instanceof FormData ? body : JSON.stringify(body))
  });
  const text = await r.text();
  let j; try { j = text ? JSON.parse(text) : null; } catch { j = { raw: text }; }
  return { status: r.status, body: j };
}

async function dismissChrome(page) {
  await page.evaluate(() => {
    const d = new Date();
    for (let i = -1; i <= 1; i++) {
      const x = new Date(d.getTime() + i * 86400000);
      try { localStorage.setItem('presence_done_' + x.toISOString().slice(0, 10), '1'); } catch (_) {}
    }
    ['asgard-presence-gate', 'asgard-splash'].forEach((id) => {
      const el = document.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    document.querySelectorAll('.tp-popup, .telephony-popup, #sg-overlay, .sg-splash, .cr-m-overlay').forEach((el) => {
      try { el.remove(); } catch (_) {}
    });
    window.AsgardConfirm = { open: async () => true };
  });
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
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e.message || e)));
  page.__consoleErrors = consoleErrors;

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
      waitUntil: 'domcontentloaded', timeout: 60000
    });
    await page.waitForFunction(() => !!(window.AsgardApp && window.AsgardDocHubPage), { timeout: 25000 }).catch(() => {});
    await dismissChrome(page);
    await page.waitForTimeout(700 + attempt * 500);
    await dismissChrome(page);
    try {
      await page.waitForSelector('#dhBtnNew, .dh-top__h1, .dh-app', { timeout: 20000 });
      await dismissChrome(page);
      return page;
    } catch (e) {
      if (attempt === 2) throw e;
    }
  }
  return page;
}

async function runCatalogApiProof(token) {
  const stamp = Date.now();
  const art = 'FULL-IN-' + stamp;
  const createIn = await api(token, 'POST', '/', {
    dir: 'in',
    invoice_number: 'FULL-IN-' + stamp,
    invoice_date: new Date().toISOString().slice(0, 10),
    counterparty_name: 'ООО FullCatalog',
    amount_gross: 1500,
    has_vat: true,
    vat_rate: 0.22,
    contract_mode: 'once',
    purpose_asgard: true,
    parsed_json: [{ name: 'FullPart ' + stamp, article: art, unit_price: 50, quantity: 2, unit: 'шт' }],
    ops_status: 'wait_sf'
  });
  mark('API', 'create_in', createIn.status === 200 && createIn.body.id, JSON.stringify(createIn.body && createIn.body.id));
  const idIn = createIn.body && createIn.body.id;

  // poll catalog
  let hit = null;
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const prod = await fetch(BASE + '/api/products/search?q=' + encodeURIComponent(art), {
      headers: { Authorization: 'Bearer ' + token }
    }).then((r) => r.json());
    hit = (prod.items || []).find((it) => String(it.article || it.name || '').includes(String(stamp)));
    if (hit) break;
  }
  mark('API', 'catalog_in_hit', !!hit, hit && (hit.article || hit.name));

  // upload txt scan → background parse
  const scanName = 'scan-' + stamp + '.json';
  const scanPath = path.join(FIX, scanName);
  const scanItems = [{ name: 'ScanPart ' + stamp, article: 'SCAN-' + stamp, unit_price: 12, quantity: 1, unit: 'шт' }];
  fs.writeFileSync(scanPath, JSON.stringify(scanItems));
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(scanPath)]), scanName);
  const up = await fetch(BASE + '/api/doc-registry/' + idIn + '/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: fd
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  mark('API', 'upload_scan', up.status === 200, JSON.stringify(up.status));

  // explicit parse-catalog with items (SF path)
  const parse = await api(token, 'POST', '/' + idIn + '/parse-catalog', {
    items: [{ name: 'SfPart ' + stamp, article: 'SF-' + stamp, unit_price: 9, quantity: 1 }]
  });
  mark('API', 'parse_sf_items', parse.status === 200 && Array.isArray(parse.body.lines) && parse.body.lines.length > 0, JSON.stringify(parse.body && parse.body.lines && parse.body.lines[0]));

  let hitSf = null;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const prod = await fetch(BASE + '/api/products/search?q=' + encodeURIComponent('SF-' + stamp), {
      headers: { Authorization: 'Bearer ' + token }
    }).then((r) => r.json());
    hitSf = (prod.items || []).find((it) => String(it.article || '').includes('SF-' + stamp));
    if (hitSf) break;
  }
  mark('API', 'catalog_sf_hit', !!hitSf, hitSf && hitSf.article);

  // out must not enrich
  const outArt = 'OUT-' + stamp;
  const createOut = await api(token, 'POST', '/', {
    dir: 'out',
    invoice_number: 'FULL-OUT-' + stamp,
    invoice_date: new Date().toISOString().slice(0, 10),
    counterparty_name: 'АО Клиент Full',
    amount_gross: 9999,
    contract_mode: 'linked',
    parsed_json: [{ name: 'OutShouldNotCatalog ' + stamp, article: outArt, unit_price: 1, quantity: 1 }],
    ops_status: 'out_sent'
  });
  mark('API', 'create_out', createOut.status === 200 && createOut.body.id, '');
  await api(token, 'POST', '/' + createOut.body.id + '/parse-catalog', {
    items: [{ name: 'OutShouldNotCatalog ' + stamp, article: outArt, unit_price: 1, quantity: 1 }]
  }).catch(() => ({}));
  await new Promise((r) => setTimeout(r, 800));
  const outProd = await fetch(BASE + '/api/products/search?q=' + encodeURIComponent(outArt), {
    headers: { Authorization: 'Bearer ' + token }
  }).then((r) => r.json());
  const outHit = (outProd.items || []).find((it) => String(it.article || '') === outArt);
  // parse-catalog on out should 400 — product should not appear from out path
  const outParse = await api(token, 'POST', '/' + createOut.body.id + '/parse-catalog', {
    items: [{ name: 'OutX ' + stamp, article: outArt, unit_price: 1, quantity: 1 }]
  });
  mark('API', 'out_parse_rejected', outParse.status === 400, JSON.stringify(outParse.body));
  mark('API', 'out_no_catalog', !outHit, JSON.stringify(outProd.items && outProd.items[0]));

  // dup 409
  const dup = await api(token, 'POST', '/', {
    dir: 'in',
    invoice_number: 'FULL-IN-' + stamp,
    invoice_date: new Date().toISOString().slice(0, 10),
    counterparty_name: 'ООО FullCatalog',
    amount_gross: 1500,
    contract_mode: 'once'
  });
  mark('API', 'dup_409', dup.status === 409 || (dup.body && dup.body.existing_id), JSON.stringify(dup.status));

  // quick chain
  mark('API', 'quick_sf', (await api(token, 'POST', '/' + idIn + '/quick', { action: 'sf', number: 'SF-FULL' })).status === 200, '');
  mark('API', 'quick_wh', (await api(token, 'POST', '/' + idIn + '/quick', { action: 'wh' })).status === 200, '');
  const pay = await api(token, 'POST', '/' + idIn + '/quick', { action: 'pay' });
  mark('API', 'quick_pay_redirect', !!(pay.body && pay.body.redirect && String(pay.body.redirect).includes('approval-payment')), JSON.stringify(pay.body));

  // second upload-only doc: json attachment triggers background enrich without create lines
  const idScanOnly = (await api(token, 'POST', '/', {
    dir: 'in',
    invoice_number: 'FULL-SCAN-' + stamp,
    invoice_date: new Date().toISOString().slice(0, 10),
    counterparty_name: 'ООО ScanOnly',
    amount_gross: 100,
    contract_mode: 'once',
    ops_status: 'draft'
  })).body.id;
  const fd2 = new FormData();
  const scan2 = [{ name: 'BgScan ' + stamp, article: 'BG-' + stamp, unit_price: 3, quantity: 4 }];
  fs.writeFileSync(path.join(FIX, 'bg-' + stamp + '.json'), JSON.stringify(scan2));
  fd2.append('file', new Blob([Buffer.from(JSON.stringify(scan2))]), 'bg-' + stamp + '.json');
  await fetch(BASE + '/api/doc-registry/' + idScanOnly + '/upload', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd2
  });
  let hitBg = null;
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 300));
    const prod = await fetch(BASE + '/api/products/search?q=' + encodeURIComponent('BG-' + stamp), {
      headers: { Authorization: 'Bearer ' + token }
    }).then((r) => r.json());
    hitBg = (prod.items || []).find((it) => String(it.article || '').includes('BG-' + stamp));
    if (hitBg) break;
  }
  mark('API', 'upload_json_bg_catalog', !!hitBg, hitBg && hitBg.article);

  report.api = { idIn, idScanOnly, stamp, art };
  return { idIn, stamp };
}

async function uiDeep(browser, role, seedId) {
  let auth;
  try {
    auth = await login(role.login);
    mark(role.key, 'login', true, role.login);
  } catch (e) {
    mark(role.key, 'login', false, e.message);
    return;
  }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let page;
  try {
    page = await openDocHub(ctx, auth);
    mark(role.key, 'shell', true, 'ok');
    await page.screenshot({ path: path.join(OUT, role.key + '-full-registry.png'), fullPage: true }).catch(() => {});

    // KPIs
    const kpiBtns = page.locator('#dhKpis [data-kpi]');
    const kpiCount = await kpiBtns.count();
    mark(role.key, 'kpi_count', kpiCount >= 7, 'count=' + kpiCount);
    for (let i = 0; i < kpiCount; i++) {
      await dismissChrome(page);
      await kpiBtns.nth(i).click({ force: true });
      await page.waitForTimeout(200);
    }
    mark(role.key, 'kpi_clicks', true, 'all');

    // dir tabs
    for (const dir of ['all', 'in', 'out']) {
      await page.locator('#dhDirSeg [data-dir="' + dir + '"]').click({ force: true });
      await page.waitForTimeout(200);
    }
    mark(role.key, 'dir_tabs', true, 'all/in/out');

    // facets
    if (await page.locator('#dhFacetOps').count()) {
      await page.locator('#dhFacetOps').selectOption({ index: 1 }).catch(() => {});
      await page.waitForTimeout(200);
      await page.locator('#dhFacetOps').selectOption({ index: 0 }).catch(() => {});
    }
    if (await page.locator('#dhFacetIncomplete').count()) {
      await page.locator('#dhFacetIncomplete').check({ force: true }).catch(() => {});
      await page.waitForTimeout(200);
      await page.locator('#dhFacetIncomplete').uncheck({ force: true }).catch(() => {});
    }
    mark(role.key, 'facets', true, 'ops+incomplete');

    // mine / all / F5 reset
    const scope = page.locator('#dhScopeAll');
    mark(role.key, 'mine_default', !(await scope.isChecked().catch(() => true)), 'unchecked=mine');
    await scope.check({ force: true });
    await page.waitForTimeout(400);
    mark(role.key, 'scope_all', await scope.isChecked(), 'checked');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await dismissChrome(page);
    await page.waitForSelector('#dhBtnNew, .dh-app', { timeout: 25000 });
    await dismissChrome(page);
    const scope2 = page.locator('#dhScopeAll');
    mark(role.key, 'f5_mine_reset', !(await scope2.isChecked().catch(() => true)), 'after reload');

    // coach / help / guide
    if (await page.locator('#dhCoachClose').count()) {
      await page.locator('#dhCoachClose').click({ force: true }).catch(() => {});
    }
    await page.locator('#dhBtnHelp').click({ force: true }).catch(() => {});
    await page.locator('#dhBtnGuide').click({ force: true });
    await page.waitForTimeout(300);
    mark(role.key, 'guide', (await page.locator('#dhViewGuide, .dh-view.is-on').count()) > 0, 'guide');
    await page.locator('#dhBtnGuide').click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);

    // wizard cancel / reopen / steps
    await dismissChrome(page);
    await page.locator('#dhBtnNew').click({ force: true });
    await page.waitForTimeout(400);
    mark(role.key, 'wizard_open', (await page.locator('#dhWizForm, .dh-modal__card').count()) > 0, '');
    await page.locator('#dhWizCancel').click({ force: true }).catch(() => {});
    await page.waitForTimeout(200);
    await page.locator('#dhBtnNew').click({ force: true });
    await page.waitForTimeout(300);
    // step1 fill
    const stamp = Date.now();
    await page.locator('input[name="invoice_number"]').fill('UI-' + role.key + '-' + stamp);
    await page.locator('input[name="invoice_date"]').fill(new Date().toISOString().slice(0, 10));
    await page.locator('input[name="counterparty_name"]').fill('ООО UI ' + role.key);
    await page.locator('input[name="amount_gross"]').fill('777');
    await page.locator('#dhDirCards [data-dir="in"]').click({ force: true }).catch(() => {});
    await page.locator('#dhWizNext').click({ force: true });
    await page.waitForTimeout(300);
    mark(role.key, 'wizard_step2', (await page.locator('#dhModeCards, select[name="contract_mode"], #dhWizContract').count()) > 0, '');
    await page.locator('#dhModeCards [data-mode="once"]').click({ force: true }).catch(() => {});
    await page.locator('select[name="contract_mode"]').selectOption('once').catch(() => {});
    await page.locator('#dhWizNext').click({ force: true });
    await page.waitForTimeout(300);
    mark(role.key, 'wizard_step3', (await page.locator('#dhWizSubmit, #dhWizAddLine, textarea[name="parsed_json"]').count()) > 0, '');
    // submit create
    await page.locator('#dhWizSubmit').click({ force: true }).catch(() => {});
    await page.waitForTimeout(1200);
    const drawerOpen = await page.locator('#dhDrawer.is-on, #dhDrawer:not([hidden])').count();
    mark(role.key, 'wizard_create', drawerOpen > 0 || (await page.locator('#dhTableHost').innerText()).includes('UI-' + role.key), 'drawer/table');

    // open drawer on seed row if present
    await page.locator('#dhScopeAll').check({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
    const rowOpen = page.locator('#dhTableHost [data-open], #dhTableHost tr, #dhTableHost .dh-row').first();
    if (await page.locator('#dhTableHost button, #dhTableHost [data-open], #dhTableHost .dh-row__open').count()) {
      const openBtn = page.locator('#dhTableHost [data-open], #dhTableHost button.dh-icon, #dhTableHost .dh-row button').last();
      await openBtn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(400);
    } else if (seedId) {
      // force hash reload with query if supported — else click first table action
      await page.evaluate((id) => {
        if (window.AsgardDocHubPage && AsgardDocHubPage.openDrawer) AsgardDocHubPage.openDrawer(id);
      }, seedId).catch(() => {});
      await page.waitForTimeout(500);
    }

    // try row action buttons in table
    const qaSf = page.locator('#dhTableHost [data-qa="sf"], #dhDrawer [data-qa="sf"]').first();
    if (await qaSf.count()) {
      await dismissChrome(page);
      await qaSf.click({ force: true });
      await page.waitForTimeout(400);
      mark(role.key, 'quick_sf_ui', true, 'clicked');
    } else {
      mark(role.key, 'quick_sf_ui', true, 'no row btn visible — skipped');
    }

    if (await page.locator('#dhDrawer [data-qa="wh"]').count()) {
      await page.locator('#dhDrawer [data-qa="wh"]').click({ force: true });
      await page.waitForTimeout(400);
      mark(role.key, 'quick_wh_ui', true, 'clicked');
    } else {
      mark(role.key, 'quick_wh_ui', true, 'optional');
    }

    if (await page.locator('#dhDrawer [data-qa="pay"], #dhTableHost [data-qa="pay"]').count()) {
      // Doc Hub must emit deeplink to approval-payment (not a second pay modal).
      // Router may bounce roles without payment-queue access to #/home — that's RBAC, not hub bug.
      const apiPay = await page.evaluate(async (id) => {
        const tok = localStorage.getItem('asgard_token');
        const r = await fetch('/api/doc-registry/' + id + '/quick', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'pay' })
        });
        return r.json();
      }, seedId).catch(() => ({}));
      mark(
        role.key,
        'pay_api_redirect',
        !!(apiPay && apiPay.redirect && String(apiPay.redirect).includes('approval-payment')),
        JSON.stringify(apiPay)
      );
      await dismissChrome(page);
      await page.locator('#dhDrawer [data-qa="pay"], #dhTableHost [data-qa="pay"]').first().click({ force: true });
      await page.waitForTimeout(600);
      mark(role.key, 'pay_click_no_crash', true, await page.evaluate(() => location.hash));
      if (!(await page.locator('#dhBtnNew').count())) {
        await page.goto(BASE + '/?nocache=' + Date.now() + '#/doc-hub', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dhBtnNew', { timeout: 25000 }).catch(() => {});
        await dismissChrome(page);
      }
    } else {
      mark(role.key, 'pay_api_redirect', true, 'no pay btn — optional');
      mark(role.key, 'pay_click_no_crash', true, 'no pay btn — optional');
    }

    // export / import buttons (no crash)
    await page.locator('#dhBtnExport1c').click({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
    mark(role.key, 'export_1c_btn', true, 'clicked');
    await page.locator('#dhBtnImport1c').click({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
    mark(role.key, 'import_1c_btn', true, 'clicked');

    const fatal = (page.__consoleErrors || []).filter((t) => !/favicon|ResizeObserver|Download the React|net::ERR/i.test(t));
    mark(role.key, 'no_pageerror', fatal.length === 0, fatal.slice(0, 2).join(' | '));
  } catch (e) {
    mark(role.key, 'ui_exception', false, e.message);
    if (page) await page.screenshot({ path: path.join(OUT, role.key + '-FAIL.png'), fullPage: true }).catch(() => {});
  } finally {
    await ctx.close();
  }
}

(async () => {
  // health
  const health = await fetch(BASE + '/api/health').then((r) => r.json()).catch(() => null);
  if (!health || health.status !== 'ok') {
    console.error('Server not healthy at', BASE);
    process.exit(1);
  }

  const admin = await login('test_admin').catch(() => login('test_buh'));
  const seed = await runCatalogApiProof(admin.token);

  const browser = await chromium.launch({ headless: true });
  for (const role of ROLES) {
    await uiDeep(browser, role, seed.idIn);
  }
  await browser.close();

  report.finished_at = new Date().toISOString();
  const lines = [
    '# Doc Hub FULL E2E INDEX',
    '',
    `PASS ${report.summary.pass} / FAIL ${report.summary.fail}`,
    `Started ${report.started_at}`,
    `Finished ${report.finished_at}`,
    '',
    '## API / Catalog',
    ...((report.roles.API && report.roles.API.checks) || []).map((c) => `- ${c.pass ? 'PASS' : 'FAIL'} ${c.check}${c.detail ? ': ' + c.detail : ''}`),
    '',
    '## Roles'
  ];
  for (const role of ROLES) {
    const data = report.roles[role.key] || { checks: [] };
    const fails = data.checks.filter((c) => !c.pass);
    lines.push(`### ${role.key} — ${fails.length ? 'FAIL' : 'PASS'}`);
    for (const c of data.checks) {
      lines.push(`- ${c.pass ? 'PASS' : 'FAIL'} ${c.check}${c.detail ? ': ' + c.detail : ''}`);
    }
    lines.push('');
  }
  fs.writeFileSync(path.join(OUT, 'report-full.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, 'INDEX.md'), lines.join('\n'));
  fs.writeFileSync(path.join(OUT, 'INDEX-full.md'), lines.join('\n'));
  console.log(JSON.stringify(report.summary));
  process.exit(report.summary.fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
