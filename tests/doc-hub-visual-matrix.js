'use strict';
/**
 * Full visual matrix: prototype render vs live CRM Doc Hub screens.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const OUT_CRM = path.join(__dirname, 'reports', 'doc-hub-visual', 'crm');
const OUT_RENDER = path.join(__dirname, 'reports', 'doc-hub-visual', 'render');
const INDEX = path.join(__dirname, 'reports', 'doc-hub-visual', 'INDEX.md');
fs.mkdirSync(OUT_CRM, { recursive: true });
fs.mkdirSync(OUT_RENDER, { recursive: true });
const PASSWORD = process.env.TEST_PASSWORD || 'Test123!';

async function loginFull(login = 'test_admin') {
  const lr = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password: PASSWORD })
  }).then((r) => r.json());
  let token = lr.token; let user = lr.user;
  if (lr.status === 'need_pin') {
    const pr = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: process.env.TEST_PIN || '0000' })
    }).then((r) => r.json());
    token = pr.token || token; user = pr.user || user;
  }
  const me = await fetch(BASE + '/api/auth/me', { headers: { Authorization: 'Bearer ' + token } }).then((r) => r.json()).catch(() => ({}));
  user = me.user || user || {};
  return { token, user, permissions: user.permissions || {} };
}

async function dismiss(page) {
  await page.evaluate(() => {
    const d = new Date();
    for (let i = -1; i <= 1; i++) {
      const x = new Date(d.getTime() + i * 86400000);
      try { localStorage.setItem('presence_done_' + x.toISOString().slice(0, 10), '1'); } catch (_) {}
    }
    ['asgard-presence-gate', 'asgard-splash'].forEach((id) => {
      const el = document.getElementById(id); if (el) el.remove();
    });
    window.AsgardConfirm = { open: async () => true };
  });
}

async function shot(page, dir, name, list) {
  const file = path.join(dir, name);
  await page.screenshot({ path: file, fullPage: true });
  list.push({ side: dir.includes('render') ? 'render' : 'crm', file: name });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const shots = [];

  // —— RENDER / prototype ——
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(BASE + '/prototypes/doc-hub/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(800);
    await shot(page, OUT_RENDER, '01-registry.png', shots);
    const wiz = page.locator('[data-nav="wizard"], #btnNew, button:has-text("Внести")');
    if (await wiz.count()) {
      await wiz.first().click().catch(() => {});
      await page.waitForTimeout(500);
      await shot(page, OUT_RENDER, '02-wizard.png', shots);
    }
    // try steps if proto has them
    for (const sel of ['[data-wiz-next]', '#wizNext', 'button:has-text("Далее")']) {
      if (await page.locator(sel).count()) {
        await page.locator(sel).first().click().catch(() => {});
        await page.waitForTimeout(350);
        await shot(page, OUT_RENDER, '02b-wizard-step2.png', shots);
        break;
      }
    }
    for (const sel of ['[data-wiz-next]', '#wizNext', 'button:has-text("Далее")']) {
      if (await page.locator(sel).count()) {
        await page.locator(sel).first().click().catch(() => {});
        await page.waitForTimeout(350);
        await shot(page, OUT_RENDER, '02c-wizard-step3.png', shots);
        break;
      }
    }
    const guide = page.locator('[data-nav="guide"], button:has-text("Справка")');
    if (await guide.count()) {
      await guide.first().click().catch(() => {});
      await page.waitForTimeout(400);
      await shot(page, OUT_RENDER, '03-guide.png', shots);
    }
    // drawer / row if any
    const row = page.locator('table tr, .dh-row, [data-open]').nth(1);
    if (await row.count()) {
      await row.click().catch(() => {});
      await page.waitForTimeout(400);
      await shot(page, OUT_RENDER, '04-drawer.png', shots);
    }
    await page.close();
  }

  // Seed varied statuses for richer registry screenshot
  {
    const auth = await loginFull('test_admin').catch(() => loginFull('test_buh'));
    const tok = auth.token;
    const stamp = Date.now();
    const hdr = { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };
    const mk = async (body) => fetch(BASE + '/api/doc-registry/', { method: 'POST', headers: hdr, body: JSON.stringify(body) });
    await mk({
      dir: 'in', invoice_number: 'VIS-OK-' + stamp, invoice_date: '2026-09-01', counterparty_name: 'ООО Готово',
      amount_gross: 5000, has_vat: true, contract_mode: 'once', ops_status: 'done', pay_status: 'paid',
      payment_due_at: '2026-09-20', purpose_asgard: true
    }).catch(() => {});
    await mk({
      dir: 'in', invoice_number: 'VIS-SF-' + stamp, invoice_date: '2026-09-02', counterparty_name: 'ООО ЖдёмСФ',
      amount_gross: 8000, has_vat: true, contract_mode: 'linked', ops_status: 'wait_sf', pay_status: 'paid',
      payment_due_at: '2026-09-10', sf_due_at: '2026-09-05', purpose_asgard: true
    }).catch(() => {});
    await mk({
      dir: 'out', invoice_number: 'VIS-OUT-' + stamp, invoice_date: '2026-09-03', counterparty_name: 'АО КлиентВиз',
      amount_gross: 12000, has_vat: true, contract_mode: 'linked', ops_status: 'out_sent', purpose_asgard: true
    }).catch(() => {});
    await mk({
      dir: 'in', invoice_number: 'VIS-WH-' + stamp, invoice_date: '2026-09-04', counterparty_name: 'ООО СкладВиз',
      amount_gross: 3000, has_vat: false, contract_mode: 'once', ops_status: 'wh_transfer', wh_status: 'await',
      payment_due_at: '2026-09-25', purpose_consumables: true
    }).catch(() => {});
  }

  // —— CRM ——
  {
    const auth = await loginFull('test_admin').catch(() => loginFull('test_buh'));
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(({ token, user, permissions }) => {
      localStorage.setItem('asgard_token', token);
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
    const page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil: 'commit' });
    await page.evaluate(async () => {
      if (navigator.serviceWorker) {
        for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
      }
    }).catch(() => {});
    await page.goto(BASE + '/?nocache=' + Date.now() + '#/doc-hub', { waitUntil: 'domcontentloaded' });
    for (let i = 0; i < 3; i++) {
      await dismiss(page);
      try { await page.waitForSelector('#dhBtnNew', { timeout: 15000 }); break; }
      catch (_) { await page.goto(BASE + '/?nocache=' + Date.now() + '#/doc-hub', { waitUntil: 'domcontentloaded' }); }
    }
    await dismiss(page);

    await page.locator('#dhScopeAll').check({ force: true }).catch(() => {});
    await page.locator('#dhFacetIncomplete').uncheck({ force: true }).catch(() => {});
    await page.locator('[data-kpi="all"]').click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
    await shot(page, OUT_CRM, '01-registry.png', shots);

    await page.locator('#dhScopeAll').uncheck({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
    await shot(page, OUT_CRM, '01b-registry-mine.png', shots);

    await page.locator('#dhFacetIncomplete').check({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
    await shot(page, OUT_CRM, '01c-facets-incomplete.png', shots);
    await page.locator('#dhFacetIncomplete').uncheck({ force: true }).catch(() => {});

    await page.locator('[data-kpi="incomplete"]').click({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
    await shot(page, OUT_CRM, '01d-kpi-incomplete.png', shots);
    await page.locator('[data-kpi="all"]').click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);

    // wizard steps
    await page.locator('#dhBtnNew').click({ force: true });
    await page.waitForTimeout(400);
    await shot(page, OUT_CRM, '02-wizard.png', shots);
    await page.locator('input[name="invoice_number"]').fill('VIS-' + Date.now()).catch(() => {});
    await page.locator('input[name="counterparty_name"]').fill('ООО Visual').catch(() => {});
    await page.locator('input[name="amount_gross"]').fill('1000').catch(() => {});
    await page.locator('#dhWizNext').click({ force: true });
    await page.waitForTimeout(350);
    await shot(page, OUT_CRM, '02b-wizard-step2.png', shots);
    await page.locator('#dhWizNext').click({ force: true });
    await page.waitForTimeout(350);
    await shot(page, OUT_CRM, '02c-wizard-step3.png', shots);
    await page.locator('#dhWizCancel, #dhModalClose').first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);

    // guide
    await page.locator('#dhDrawerClose').click({ force: true }).catch(() => {});
    await page.locator('#dhBtnGuide').click({ force: true });
    await page.waitForSelector('#dhViewGuide .dh-guide-grid, .dh-gcard', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
    await shot(page, OUT_CRM, '03-guide.png', shots);
    await page.locator('#dhBtnGuide').click({ force: true }).catch(() => {});
    await page.waitForTimeout(400);

    // drawer
    await page.locator('#dhScopeAll').check({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
    const openBtn = page.locator('#dhTableHost [data-qa="open"]').first();
    if (await openBtn.count()) {
      await openBtn.click({ force: true });
      await page.waitForTimeout(500);
      await shot(page, OUT_CRM, '04-drawer.png', shots);
      await page.locator('#dhDrawer [data-qa="sf"]').click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
      await shot(page, OUT_CRM, '05-after-sf-confirm.png', shots);
      await page.locator('#dhDrawerClose').click({ force: true }).catch(() => {});
    }

    await page.locator('#dhScopeAll').check({ force: true }).catch(() => {});
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const d = document.getElementById('dhDrawer');
      if (d) { d.hidden = true; d.classList.remove('is-on'); d.innerHTML = ''; }
    });
    await page.locator('#dhBtnExport1c').click({ force: true });
    await page.waitForFunction(() => !!document.getElementById('dhExportDl'), { timeout: 15000 });
    await page.waitForTimeout(400);
    await shot(page, OUT_CRM, '06-export-1c.png', shots);

    await ctx.close();
  }

  await browser.close();

  const md = [
    '# Doc Hub visual INDEX (full matrix)',
    '',
    'Self-review before independent verifier.',
    '',
    '## Rule',
    'DONE только при вердикте независимого верификатора: **CRM лучше рендера, 10/10 по каждому экрану матрицы**.',
    '',
    '## Matrix shots',
    ...shots.map((s) => `- (${s.side}) \`${s.file}\``),
    '',
    '## Independent verifier',
    'Status: **PENDING** — run Task verifier on crm/ vs render/.',
    ''
  ];
  fs.writeFileSync(INDEX, md.join('\n'));
  fs.writeFileSync(path.join(__dirname, 'reports', 'doc-hub-visual', 'self-review.json'), JSON.stringify({
    shots, at: new Date().toISOString(), claim: 'self matrix captured'
  }, null, 2));
  console.log('matrix shots', shots.length);
})().catch((e) => { console.error(e); process.exit(1); });
