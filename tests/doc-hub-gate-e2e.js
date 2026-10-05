'use strict';
/**
 * Fast Doc Hub gate: API full chain + UI for all hub roles.
 * Writes tests/reports/doc-hub-e2e/report-gate.json + INDEX-gate.md
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
    localStorage.setItem('asgard_doc_hub_e2e', '1');
    const d = new Date();
    for (let i = -1; i <= 1; i++) {
      const x = new Date(d.getTime() + i * 86400000);
      localStorage.setItem('presence_done_' + x.toISOString().slice(0, 10), '1');
    }
  }, auth);
  const page = await context.newPage();
  // B2 (негативная находка верификатора): в этом suite НЕ было ни одного слушателя
  // страницы — прогон мог быть «зелёным» при ошибках консоли и 5xx. Ставим ДО первой
  // навигации, иначе ранние ошибки не поймаются.
  const consoleErrors = [];
  const http5xx = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('response', (r) => { const s = r.status(); if (s >= 500) http5xx.push(s + ' ' + r.url()); });
  page.__consoleErrors = consoleErrors;
  page.__http5xx = http5xx;
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
  // E2: pay requires attachment — upload stub before redirect check
  {
    const fd = new FormData();
    fd.append('file', new Blob([JSON.stringify([{ name: 'Gate pay', article: 'GP-' + stamp, unit_price: 1, quantity: 1 }])]), 'gate-pay-' + stamp + '.json');
    const upPay = await fetch(BASE + '/api/doc-registry/' + id + '/upload', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    add('api_pay_upload', upPay.status === 200, String(upPay.status));
  }
  add('api_pay_redirect', !!(await api(token, 'POST', '/' + id + '/quick', { action: 'pay' })).body.redirect, '');
  add('api_export', !!(await api(token, 'POST', '/export-1c', { ids: [id] })).body.csv, '');

  // ── B1: Excel-ВЛОЖЕНИЕ → автопарс БЕЗ обращения к AI ───────────────────────
  // Проверяем ветку maybeScheduleParse → parseProcurementExcel (opts.buffer).
  // Документ создаём БЕЗ parsed_json, иначе schedule вернётся раньше (lines.length > 0).
  const create2 = await api(token, 'POST', '/', {
    dir: 'in', invoice_number: 'GATE-XLSX-' + stamp, invoice_date: new Date().toISOString().slice(0, 10),
    counterparty_name: 'ООО Gate XLSX', amount_gross: 166.5, has_vat: false,
    contract_mode: 'once', purpose_consumables: true
  });
  const id2 = create2.body.id;
  let upStatus = 0;
  try {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('list');
    ws.addRow(['Наименование', 'Артикул', 'Кол-во', 'Ед', 'Цена']);
    ws.addRow(['Gate XLSX ' + stamp, 'GX-' + stamp, 3, 'шт', 55.5]);
    const xbuf = Buffer.from(await wb.xlsx.writeBuffer());
    const fd = new FormData();
    fd.append('file', new Blob([xbuf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }), 'attach-' + stamp + '.xlsx');
    const up = await fetch(BASE + '/api/doc-registry/' + id2 + '/upload', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd
    });
    upStatus = up.status;
  } catch (e) {
    add('api_attach_upload', false, e.message);
  }
  if (upStatus) add('api_attach_upload', upStatus === 200, 'HTTP ' + upStatus);
  // ждём фоновый parse (без AI) — ROW должен лечь в products/price_records
  let autoPj = null;
  let autoHit = null;
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 400));
    const d = await api(token, 'GET', '/' + id2);
    const pj = d.body && d.body.parsed_json;
    if (Array.isArray(pj) && pj.length) { autoPj = pj; break; }
  }
  add('api_attach_autoparse', !!(autoPj && autoPj.length), autoPj ? JSON.stringify(autoPj[0]) : 'parsed_json is empty');
  for (let i = 0; i < 8; i++) {
    const p = await fetch(BASE + '/api/products/search?q=' + encodeURIComponent('GX-' + stamp), {
      headers: { Authorization: 'Bearer ' + token }
    }).then((r) => r.json());
    if (Array.isArray(p.items) && p.items.length) { autoHit = p.items[0]; break; }
    await new Promise((r) => setTimeout(r, 300));
  }
  add('api_attach_catalog', !!autoHit, autoHit ? (autoHit.article || autoHit.name) : 'no product');

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
        add(role.key + '_wizard', (await page.locator('#dhWizForm, .dh-modal__card--wiz, .dh-card--wiz').count()) > 0, '');
        await page.locator('#dhWizCancel, #dhWizToRegistry, #dhModalClose').first().click({ timeout: 4000, force: true }).catch(() => {});
        await page.waitForSelector('#dhTableHost', { timeout: 12000 }).catch(() => {});
        const scope = page.locator('#dhScopeAll');
        if (!(await scope.count())) {
          await page.locator('#dhWizToRegistry').click({ timeout: 2000, force: true }).catch(() => {});
          await page.waitForSelector('#dhScopeAll', { timeout: 8000 }).catch(() => {});
        }
        if (await scope.count()) {
          await scope.check({ force: true }).catch(() => {});
          await page.waitForTimeout(300);
          await scope.uncheck({ force: true }).catch(() => {});
          add(role.key + '_scope', true, 'mine/all');
          // ── B1: «scope=mine» переживает F5 (не сбрасывается в all) ──────────
          const respP = page.waitForResponse(
            (r) => r.url().includes('/api/doc-registry') && r.request().method() === 'GET',
            { timeout: 9000 }
          ).catch(() => null);
          await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
          const resp = await respP;
          await dismissChrome(page);
          // Флак 20.09: после reload 600 мс могло не хватить на отрисовку, элемент
          // отсутствовал -> count()=0 -> checkedAfter дефолтился в true и проверка
          // ложно падала (хотя запрос уже нёс scope=mine). Ждём появления элемента
          // и читаем состояние ТОЛЬКО если он реально есть; иначе честный FAIL.
          const sc2 = page.locator('#dhScopeAll');
          const scAttached = await sc2.first().waitFor({ state: 'attached', timeout: 12000 })
            .then(() => true).catch(() => false);
          if (!scAttached) {
            add(role.key + '_scope_f5', false, 'скоп-чекбокс не отрисовался после F5');
          } else {
            const checkedAfter = await sc2.isChecked().catch(() => null);
            const q = resp ? (resp.url().split('?')[1] || '') : '';
            add(role.key + '_scope_f5', checkedAfter === false && !/scope=all/.test(q),
              'checked=' + checkedAfter + ' q=' + (q || 'no-call'));
          }
        } else {
          add(role.key + '_scope', false, 'missing');
        }
      }
      // B2: 0 console.error и 0 ответов 5xx под ролью (как в roles/full-roles).
      // D-202: `net::ERR` НЕ глушим — сетевой сбой (ERR_CONNECTION_REFUSED, ERR_ABORTED)
      // не даёт ответа, поэтому _no_5xx его не поймает; это отдельный класс дефекта.
      const fatal = (page.__consoleErrors || []).filter((t) =>
        !/favicon|ResizeObserver|Download the React|status of 403 \(Forbidden\)|Failed to load resource: the server responded with a status of 403/i.test(t)
      );
      add(role.key + '_no_pageerror', fatal.length === 0, fatal.slice(0, 2).join(' | '));
      const h5 = page.__http5xx || [];
      const h5doc = h5.filter((u) => !/\/api\/sse\/|\/api\/hints\?|office-academy|data\/reminders/i.test(u));
      add(role.key + '_no_5xx', h5doc.length === 0, h5doc.slice(0, 2).join(' | '));
      // D-202: сетевые сбои, по которым вообще не пришёл ответ (failed-запросы к API).
      const netFail = fatal.filter((t) => /net::ERR|Failed to fetch|ERR_ABORTED/i.test(t))
        .filter((t) => !/\/api\/sse\/|\/api\/hints\/|office-academy|data\/reminders/i.test(t));
      add(role.key + '_no_netfail', netFail.length === 0, netFail.slice(0, 2).join(' | '));
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
  fs.writeFileSync(path.join(OUT, 'report-gate.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, 'INDEX-gate.md'), [
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
