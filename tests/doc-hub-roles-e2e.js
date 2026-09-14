'use strict';
/**
 * Doc Hub — полный E2E по ролям (API + Playwright UI smoke).
 * Роли: TO, HEAD_TO, PM, HEAD_PM, PROC, BUH, WAREHOUSE, OFFICE_MANAGER, DIRECTOR_GEN, ADMIN
 * Exit 0 только если все PASS. Артефакты: tests/reports/doc-hub-e2e/
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const OUT = path.join(__dirname, 'reports', 'doc-hub-e2e');
fs.mkdirSync(OUT, { recursive: true });

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
  roles: {},
  api_chain: {},
  summary: { pass: 0, fail: 0 }
};

function mark(role, check, pass, detail) {
  if (!report.roles[role]) report.roles[role] = { checks: [] };
  report.roles[role].checks.push({ check, pass: !!pass, detail: detail || '' });
  if (pass) report.summary.pass++; else report.summary.fail++;
}

async function login(login) {
  const lr = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password: PASSWORD })
  }).then((r) => r.json());
  if (!lr.token) throw new Error('login fail ' + login + ' ' + JSON.stringify(lr));
  let token = lr.token;
  let user = lr.user;
  if (lr.status === 'need_pin') {
    const pr = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: PIN })
    }).then((r) => r.json());
    if (!pr.token) throw new Error('pin fail ' + login);
    token = pr.token;
    user = pr.user || user;
  }
  const me = await fetch(BASE + '/api/auth/me', {
    headers: { Authorization: 'Bearer ' + token }
  }).then((r) => r.json()).catch(() => ({}));
  user = me.user || user || {};
  return { token, user, permissions: user.permissions || {} };
}

async function dismissChrome(page) {
  await page.evaluate(() => {
    const d = new Date();
    for (let i = -1; i <= 1; i++) {
      const x = new Date(d.getTime() + i * 86400000);
      try { localStorage.setItem('presence_done_' + x.toISOString().slice(0, 10), '1'); } catch (_) {}
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
  });
  for (const t of ['Понял', 'Принять вызов', 'Закрыть', 'Позже', 'Пропустить', 'В строй']) {
    await page.getByRole('button', { name: new RegExp(t, 'i') }).first().click({ timeout: 400 }).catch(() => {});
  }
}

async function api(token, method, pathName, body) {
  const r = await fetch(BASE + '/api/doc-registry' + pathName, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: body != null ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch (_) { j = { raw: text }; }
  return { status: r.status, body: j };
}

async function runApiChain(token) {
  const stamp = Date.now();
  const create = await api(token, 'POST', '/', {
    dir: 'in',
    invoice_number: 'DH-E2E-' + stamp,
    invoice_date: new Date().toISOString().slice(0, 10),
    counterparty_name: 'ООО Тест DocHub E2E',
    amount_gross: 1220,
    has_vat: true,
    vat_rate: 0.22,
    payment_due_at: new Date(Date.now() + 86400000 * 5).toISOString().slice(0, 10),
    contract_mode: 'once',
    purpose_asgard: true,
    parsed_json: [{ name: 'Кабель E2E DocHub ' + stamp, article: 'DH-CAB-' + stamp, unit_price: 100, quantity: 2, unit: 'м' }],
    ops_status: 'wait_sf'
  });
  report.api_chain.create = { status: create.status, id: create.body && create.body.id };
  if (create.status >= 400 || !create.body || !create.body.id) {
    return { ok: false, reason: 'create failed ' + JSON.stringify(create.body) };
  }
  const id = create.body.id;

  const dup = await api(token, 'POST', '/check-duplicate', {
    dir: 'in',
    invoice_number: 'DH-E2E-' + stamp,
    invoice_date: new Date().toISOString().slice(0, 10),
    counterparty_name: 'ООО Тест DocHub E2E',
    amount_gross: 1220
  });
  report.api_chain.duplicate = dup.body;

  const kpi = await api(token, 'GET', '/kpi?scope=all');
  report.api_chain.kpi = kpi.body;

  const facets = await api(token, 'GET', '/facets?scope=all');
  report.api_chain.facets_ok = facets.status === 200;

  const parse = await api(token, 'POST', '/' + id + '/parse-catalog', {
    items: [{ name: 'Муфта E2E ' + stamp, article: 'DH-MF-' + stamp, unit_price: 50, quantity: 1 }]
  });
  report.api_chain.parse_catalog = { status: parse.status, lines: (parse.body && parse.body.lines) || [] };

  // catalog search — poll background enrich; match by unique article/stamp
  const qName = 'DH-CAB-' + stamp;
  let hit = null;
  let prod = { status: 0, body: {} };
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 300));
    prod = await fetch(BASE + '/api/products/search?q=' + encodeURIComponent(qName), {
      headers: { Authorization: 'Bearer ' + token }
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    hit = Array.isArray(prod.body && prod.body.items)
      ? prod.body.items.find((it) => String(it.article || it.name || '').includes(String(stamp)))
      : null;
    if (hit) break;
  }
  report.api_chain.catalog_search = { status: prod.status, hit: hit && (hit.article || hit.name), raw_count: ((prod.body && prod.body.items) || []).length };

  const sf = await api(token, 'POST', '/' + id + '/quick', { action: 'sf', kind: 'СФ', number: 'SF-' + stamp });
  report.api_chain.quick_sf = { status: sf.status };

  const wh = await api(token, 'POST', '/' + id + '/quick', { action: 'wh' });
  report.api_chain.quick_wh = { status: wh.status, wh: wh.body && wh.body.wh_status };

  const pay = await api(token, 'POST', '/' + id + '/quick', { action: 'pay' });
  report.api_chain.quick_pay = pay.body;

  const exp = await api(token, 'POST', '/export-1c', { ids: [id] });
  report.api_chain.export_1c = {
    status: exp.status,
    hasCsv: !!(exp.body && (exp.body.csv || exp.body.raw))
  };

  const dry = await api(token, 'POST', '/excel/dry-run', {
    rows: [{
      dir: 'in',
      invoice_number: 'DH-XL-' + stamp,
      invoice_date: new Date().toISOString().slice(0, 10),
      counterparty_name: 'ИП Excel Test',
      amount_gross: 500,
      contract_mode: 'once',
      purpose_consumables: true,
      work_title: 'DocHub Excel Work ' + stamp,
      work_pm_name: null
    }]
  });
  report.api_chain.excel_dry = dry.body;

  // outgoing should not enrich catalog requirement — create out
  const out = await api(token, 'POST', '/', {
    dir: 'out',
    invoice_number: 'DH-OUT-' + stamp,
    invoice_date: new Date().toISOString().slice(0, 10),
    counterparty_name: 'АО Клиент',
    amount_gross: 10000,
    has_vat: true,
    contract_mode: 'linked',
    ops_status: 'out_sent'
  });
  report.api_chain.out_create = { status: out.status, id: out.body && out.body.id };

  const mine = await api(token, 'GET', '/?scope=mine&limit=5');
  const all = await api(token, 'GET', '/?scope=all&limit=5');
  report.api_chain.scope = {
    mine: mine.status === 200,
    all: all.status === 200
  };

  return {
    ok: create.status < 400 && dup.body && dup.body.duplicate === true && parse.status < 400 && !!hit,
    id,
    stamp
  };
}

async function uiRole(browser, role) {
  let auth;
  try {
    auth = await login(role.login);
  } catch (e) {
    mark(role.key, 'login', false, e.message);
    return;
  }
  mark(role.key, 'login', true, role.login);

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(({ token, user, permissions }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('auth_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user || {}));
    localStorage.setItem('asgard_permissions', JSON.stringify(permissions || {}));
    localStorage.setItem('asgard_shell_banner_dismissed', '1');
    localStorage.setItem('asgard_v2_banner_dismissed', '1');
    localStorage.setItem('asgard_theme_chosen', '1');
    localStorage.setItem('asgard_theme', 'dark');
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

  try {
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
    await page.goto(BASE + '/?nocache=' + Date.now() + '#/doc-hub', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await page.waitForFunction(() => !!(window.AsgardApp && window.AsgardDocHubPage), { timeout: 25000 }).catch(() => {});
    await dismissChrome(page);
    let hasApp = 0;
    try {
      await page.waitForSelector('.dh-app, .dh-shell, #dhBtnNew, #dhTableHost, .dh-top__h1', { timeout: 25000 });
      hasApp = await page.locator('.dh-app, .dh-shell, #dhTableHost, .dh-top, #dhBtnNew').first().count();
    } catch (_) {
      // one hard reload retry (presence/SW race)
      await page.goto(BASE + '/?nocache=' + Date.now() + '#/doc-hub', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
      await page.waitForTimeout(2500);
      await dismissChrome(page);
      await page.waitForSelector('.dh-app, .dh-shell, #dhBtnNew, #dhTableHost, .dh-top__h1', { timeout: 25000 });
      hasApp = await page.locator('.dh-app, .dh-shell, #dhTableHost, .dh-top, #dhBtnNew').first().count();
    }
    await dismissChrome(page);

    const htmlSnippet = await page.evaluate(() => (document.querySelector('#content') || document.querySelector('#app') || document.body).innerHTML.slice(0, 400));
    mark(role.key, 'page_render', hasApp > 0, hasApp > 0 ? 'doc-hub shell' : htmlSnippet.replace(/\s+/g, ' ').slice(0, 180));
    await page.screenshot({ path: path.join(OUT, role.key + '-registry.png'), fullPage: true }).catch(() => {});

    // KPI buttons
    const kpiBtns = await page.locator('#dhKpis [data-kpi], .dh-kpi[data-kpi]').count();
    mark(role.key, 'kpi_buttons', kpiBtns >= 5, 'count=' + kpiBtns);
    if (kpiBtns) {
      await page.locator('#dhKpis [data-kpi], .dh-kpi[data-kpi]').first().click({ timeout: 2000, force: true }).catch(() => {});
    }

    // Scope toggle
    const scope = page.locator('#dhScopeAll');
    if (await scope.count()) {
      await scope.check({ force: true }).catch(() => {});
      await page.waitForTimeout(400);
      await scope.uncheck({ force: true }).catch(() => {});
      mark(role.key, 'scope_toggle', true, 'ok');
    } else {
      mark(role.key, 'scope_toggle', false, 'missing #dhScopeAll');
    }

    // Open wizard
    const newBtn = page.locator('#dhBtnNew');
    if (await newBtn.count()) {
      await dismissChrome(page);
      await newBtn.click({ force: true });
      await page.waitForTimeout(500);
      const modal = await page.locator('#dhModal:not([hidden]), .dh-modal__card').count();
      mark(role.key, 'wizard_open', modal > 0, 'modal');
      await page.screenshot({ path: path.join(OUT, role.key + '-wizard.png') }).catch(() => {});
      await page.locator('#dhModalClose, #dhWizCancel').first().click({ timeout: 2000, force: true }).catch(() => {});
    } else {
      mark(role.key, 'wizard_open', false, 'no #dhBtnNew');
    }

    // Guide toggle if present
    const guide = page.locator('#dhBtnGuide, [data-view="guide"]');
    if (await guide.count()) {
      await guide.first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(300);
      mark(role.key, 'guide_view', true, 'toggled');
      await page.screenshot({ path: path.join(OUT, role.key + '-guide.png') }).catch(() => {});
    } else {
      mark(role.key, 'guide_view', true, 'optional missing');
    }

    // Export 1c button present
    mark(role.key, 'export_btn', (await page.locator('#dhBtnExport1c').count()) > 0, '');

    const fatal = consoleErrors.filter((t) => !/favicon|ResizeObserver|Download the React/i.test(t));
    mark(role.key, 'no_pageerror', fatal.length === 0, fatal.slice(0, 3).join(' | '));
  } catch (e) {
    mark(role.key, 'ui_exception', false, e.message);
  } finally {
    await context.close();
  }
}

(async () => {
  let browser;
  try {
    // Prefer ADMIN for API chain
    let adminAuth;
    try {
      adminAuth = await login('test_admin');
    } catch (_) {
      adminAuth = await login('test_buh');
    }
    const chain = await runApiChain(adminAuth.token);
    mark('API', 'business_chain', !!chain.ok, chain.ok ? 'id=' + chain.id : chain.reason);
    mark('API', 'export_json_csv', !!(report.api_chain.export_1c && report.api_chain.export_1c.hasCsv), '');
    mark('API', 'catalog_parse', (report.api_chain.parse_catalog || {}).status < 400, JSON.stringify(report.api_chain.parse_catalog));
    mark('API', 'duplicate_409_path', !!(report.api_chain.duplicate && report.api_chain.duplicate.duplicate), '');

    browser = await chromium.launch({ headless: true });
    for (const role of ROLES) {
      await uiRole(browser, role);
    }
  } catch (e) {
    report.fatal = e.message;
    report.summary.fail++;
  } finally {
    if (browser) await browser.close();
  }

  report.finished_at = new Date().toISOString();
  const indexLines = [
    '# Doc Hub E2E INDEX',
    '',
    `Base: ${BASE}`,
    `Started: ${report.started_at}`,
    `Finished: ${report.finished_at}`,
    `PASS: ${report.summary.pass}  FAIL: ${report.summary.fail}`,
    '',
    '## API chain',
    '```json',
    JSON.stringify(report.api_chain, null, 2),
    '```',
    '',
    '## Roles'
  ];
  for (const [role, data] of Object.entries(report.roles)) {
    const fails = (data.checks || []).filter((c) => !c.pass);
    indexLines.push(`### ${role} — ${fails.length ? 'FAIL' : 'PASS'}`);
    for (const c of data.checks || []) {
      indexLines.push(`- ${c.pass ? 'PASS' : 'FAIL'} ${c.check}${c.detail ? ': ' + c.detail : ''}`);
    }
    indexLines.push('');
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, 'INDEX.md'), indexLines.join('\n'));
  console.log(JSON.stringify({ summary: report.summary, out: OUT }, null, 2));
  process.exit(report.summary.fail > 0 || report.fatal ? 1 : 0);
})();
