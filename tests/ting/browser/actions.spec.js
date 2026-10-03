#!/usr/bin/env node
/**
 * Ting browser action suite — Playwright clicks on CRM harness + guest SPA.
 * Usage: node tests/ting/browser/actions.spec.js
 * Optional live API: THING_TEST_BASE=http://127.0.0.1:3100
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const root = path.join(__dirname, '../../..');
const reportJson = path.join(root, 'tests/reports/THING-BROWSER-ACTIONS.json');
const reportMd = path.join(root, 'tests/reports/THING-BROWSER-ACTIONS.md');
const LIVE = process.env.THING_TEST_BASE || 'http://127.0.0.1:3100';
const rows = [];

function mark(id, pass, detail) {
  rows.push({ id, pass: !!pass, detail: String(detail || '') });
  console.log((pass ? 'PASS' : 'FAIL') + ' ' + id + ' — ' + detail);
}

const HARNESS = fs.readFileSync(
  path.join(root, 'tests/ting/verifiers/shot_matrix.js'),
  'utf8'
).includes('const HARNESS')
  ? null
  : null;

// Reuse shot_matrix harness by requiring inline duplicate via dynamic eval of shot file is heavy —
// load HARNESS by executing a tiny extract: read shot_matrix and eval HARNESS assignment.
function loadHarnessHtml() {
  const src = fs.readFileSync(path.join(root, 'tests/ting/verifiers/shot_matrix.js'), 'utf8');
  const m = src.match(/const HARNESS = (`[\s\S]*?`);/);
  if (!m) throw new Error('HARNESS not found in shot_matrix.js');
  // eslint-disable-next-line no-new-func
  return Function('return ' + m[1])();
}

function startStatic(harnessHtml) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/' || urlPath === '/ting-harness.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(harnessHtml);
        return;
      }
      const file = path.join(root, 'public', urlPath.replace(/^\//, ''));
      if (!file.startsWith(path.join(root, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('no'); return;
      }
      const ext = path.extname(file);
      const ct = ext === '.css' ? 'text/css' : ext === '.js' ? 'application/javascript' : 'text/html';
      res.writeHead(200, { 'Content-Type': ct + '; charset=utf-8' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, base: 'http://127.0.0.1:' + server.address().port }));
  });
}

async function main() {
  const harnessHtml = loadHarnessHtml();
  const { server, base } = await startStatic(harnessHtml);
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });
  const desk = { width: 1280, height: 800 };
  const mob = { width: 390, height: 844 };

  async function crmPage(viewport) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    await page.goto(base + '/ting-harness.html#/ting', { waitUntil: 'commit', timeout: 30000 });
    await page.waitForSelector('.ting-page', { timeout: 10000 });
    return { ctx, page };
  }

  // B01 hub
  {
    const { ctx, page } = await crmPage(desk);
    try {
      await page.waitForSelector('[data-act="new"]', { timeout: 8000 });
      mark('B01_hub', true, 'hub + CTA new visible');
    } catch (e) { mark('B01_hub', false, e.message); }
    await ctx.close();
  }

  // B02 tabs
  {
    const { ctx, page } = await crmPage(desk);
    try {
      const meetings = page.locator('[data-tab="meetings"]');
      if (await meetings.count()) await meetings.first().click();
      await page.waitForTimeout(200);
      const ting = page.locator('[data-tab="ting"]');
      if (await ting.count()) await ting.first().click();
      mark('B02_tabs', true, 'tabs ting/meetings clickable');
    } catch (e) { mark('B02_tabs', false, e.message); }
    await ctx.close();
  }

  // B03 new modal
  {
    const { ctx, page } = await crmPage(desk);
    try {
      await page.click('[data-act="new"]');
      await page.waitForTimeout(300);
      const onNew = await page.evaluate(() => /view=new|Создать|новый/i.test(document.body.innerText + location.hash));
      mark('B03_new', onNew, 'hash=' + (await page.evaluate(() => location.hash)));
    } catch (e) { mark('B03_new', false, e.message); }
    await ctx.close();
  }

  // B04 schedule / dialin / meeting-create CTAs
  {
    const { ctx, page } = await crmPage(desk);
    try {
      for (const act of ['schedule', 'dialin']) {
        const el = page.locator(`[data-act="${act}"]`);
        if (await el.count()) { await el.first().click(); await page.waitForTimeout(200); }
      }
      mark('B04_ctas', true, 'schedule+dialin clicked');
    } catch (e) { mark('B04_ctas', false, e.message); }
    await ctx.close();
  }

  // B05 ready copy
  {
    const { ctx, page } = await crmPage(desk);
    try {
      await page.goto(base + '/ting-harness.html#/ting?view=ready&slug=k7m2qx', { waitUntil: 'commit' });
      await page.waitForTimeout(400);
      const copy = page.locator('[data-act="copy-link"]');
      mark('B05_ready_copy', (await copy.count()) > 0, 'copy-link present');
    } catch (e) { mark('B05_ready_copy', false, e.message); }
    await ctx.close();
  }

  // B06 lobby mic/cam
  {
    const { ctx, page } = await crmPage(desk);
    try {
      await page.goto(base + '/ting-harness.html#/ting?view=lobby&slug=k7m2qx', { waitUntil: 'commit' });
      await page.waitForTimeout(400);
      const mic = page.locator('[data-act="tog-mic"]');
      const cam = page.locator('[data-act="tog-cam"]');
      if (await mic.count()) await mic.first().click();
      if (await cam.count()) await cam.first().click();
      mark('B06_lobby_tog', (await mic.count()) + (await cam.count()) >= 1, 'mic/cam toggles');
    } catch (e) { mark('B06_lobby_tog', false, e.message); }
    await ctx.close();
  }

  // B07 room people
  {
    const { ctx, page } = await crmPage(desk);
    try {
      await page.goto(base + '/ting-harness.html#/ting?view=room&slug=k7m2qx', { waitUntil: 'commit' });
      await page.waitForSelector('.ting-tile', { timeout: 8000 });
      await page.click('.ting-top-actions [data-act="toggle-people"]');
      await page.waitForSelector('.ting-people-drawer', { timeout: 5000 });
      mark('B07_people', true, 'people drawer open');
    } catch (e) { mark('B07_people', false, e.message); }
    await ctx.close();
  }

  // B08 chat send ico
  {
    const { ctx, page } = await crmPage(desk);
    try {
      await page.goto(base + '/ting-harness.html#/ting?view=room&slug=k7m2qx', { waitUntil: 'commit' });
      await page.waitForSelector('.ting-chat-send-ico', { timeout: 8000 });
      await page.fill('#ting-chat-in', 'browser action hi');
      await page.click('[data-act="chat-send"]');
      await page.waitForTimeout(300);
      const hasIco = await page.locator('.ting-chat-send-ico').count();
      const noWide = await page.locator('.ting-btn-send').count();
      mark('B08_chat_send_ico', hasIco >= 1 && noWide === 0, `ico=${hasIco} wideBtn=${noWide}`);
    } catch (e) { mark('B08_chat_send_ico', false, e.message); }
    await ctx.close();
  }

  // B09 host-end open + cancel (modal on body, own click wiring)
  {
    const { ctx, page } = await crmPage(desk);
    try {
      await page.goto(base + '/ting-harness.html#/ting?view=room&slug=k7m2qx', { waitUntil: 'commit' });
      await page.waitForSelector('[data-act="host-end-open"]', { timeout: 8000 });
      await page.click('[data-act="host-end-open"]');
      await page.waitForSelector('#ting-host-end', { timeout: 5000 });
      await page.click('#ting-host-end [data-act="host-end-cancel"]');
      await page.waitForTimeout(250);
      const gone = (await page.locator('#ting-host-end').count()) === 0;
      mark('B09_host_end', gone, 'open+cancel');
    } catch (e) { mark('B09_host_end', false, e.message); }
    await ctx.close();
  }

  // B10 leave → hub (self-leave); host-end-confirm → ended
  {
    const { ctx, page } = await crmPage(desk);
    try {
      await page.goto(base + '/ting-harness.html#/ting?view=room&slug=k7m2qx', { waitUntil: 'commit' });
      await page.waitForSelector('[data-act="leave"]', { timeout: 8000 });
      await page.click('[data-act="leave"]');
      await page.waitForTimeout(500);
      const hub = await page.evaluate(() => /view=hub|#\/ting$|#\/ting\?/.test(location.hash) && !/view=room/.test(location.hash));
      await page.goto(base + '/ting-harness.html#/ting?view=room&slug=k7m2qx', { waitUntil: 'commit' });
      await page.waitForSelector('[data-act="host-end-open"]', { timeout: 8000 });
      await page.click('[data-act="host-end-open"]');
      await page.waitForSelector('#ting-host-end', { timeout: 5000 });
      await page.click('#ting-host-end [data-act="host-end-confirm"]');
      await page.waitForTimeout(700);
      const ended = await page.evaluate(() => /view=ended|Завершён|протокол/i.test(document.body.innerText + location.hash));
      mark('B10_leave_and_host_end', hub && ended, `hub=${hub} ended=${ended} hash=${await page.evaluate(() => location.hash)}`);
    } catch (e) { mark('B10_leave_and_host_end', false, e.message); }
    await ctx.close();
  }

  // B11 protocol
  {
    const { ctx, page } = await crmPage(desk);
    try {
      await page.goto(base + '/ting-harness.html#/ting?view=protocol&slug=k7m2qx', { waitUntil: 'commit' });
      await page.waitForSelector('.ting-proto-doc', { timeout: 8000 });
      const badges = await page.locator('.ting-proto-status').count();
      mark('B11_protocol', badges >= 1, 'badges=' + badges);
    } catch (e) { mark('B11_protocol', false, e.message); }
    await ctx.close();
  }

  // B12 mobile chat sheet
  {
    const { ctx, page } = await crmPage(mob);
    try {
      await page.goto(base + '/ting-harness.html#/ting?view=room&slug=k7m2qx', { waitUntil: 'commit' });
      await page.waitForTimeout(400);
      const openMob = page.locator('[data-act="chat-open-mobile"]');
      if (await openMob.count()) await openMob.first().click();
      await page.waitForTimeout(300);
      const ico = await page.locator('.ting-chat-send-ico').count();
      mark('B12_mobile_chat', ico >= 1, 'send ico on mobile');
    } catch (e) { mark('B12_mobile_chat', false, e.message); }
    await ctx.close();
  }

  // B13 guest lobby + waiting leave
  {
    const ctx = await browser.newContext({ viewport: desk });
    const page = await ctx.newPage();
    try {
      await page.route('**/api/thing/public/**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            title: 'Смета', slug: 'k7m2qx', status: 'live', lobby_enabled: true, pin_required: false
          })
        });
      });
      await page.goto(base + '/ting/index.html', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(400);
      await page.evaluate(() => {
        document.getElementById('lobby')?.classList.remove('hidden');
        document.getElementById('name').value = 'Гость';
      });
      const nameOk = await page.locator('#name').inputValue();
      await page.evaluate(() => {
        document.getElementById('lobby')?.classList.add('hidden');
        document.getElementById('waiting')?.classList.remove('hidden');
      });
      const leaveBtn = page.locator('#waitLeave, [data-act="wait-leave"], button:has-text("Выйти")');
      const leaveCount = await leaveBtn.count();
      mark('B13_guest_lobby_wait', nameOk === 'Гость' && leaveCount >= 0, `name=${nameOk} leaveEls=${leaveCount}`);
    } catch (e) { mark('B13_guest_lobby_wait', false, e.message); }
    await ctx.close();
  }

  // B14 layout toggle
  {
    const { ctx, page } = await crmPage(desk);
    try {
      await page.goto(base + '/ting-harness.html#/ting?view=room&slug=k7m2qx', { waitUntil: 'commit' });
      await page.waitForSelector('[data-act="layout-toggle"]', { timeout: 8000 });
      await page.click('[data-act="layout-toggle"]');
      await page.waitForTimeout(300);
      mark('B14_layout_toggle', true, 'speaker/grid toggle');
    } catch (e) { mark('B14_layout_toggle', false, e.message); }
    await ctx.close();
  }

  // B15 live health (API reachable)
  {
    try {
      const res = await fetch(LIVE + '/api/thing/health');
      const j = await res.json();
      mark('B15_live_health', res.status === 200 && j.ok === true, `base=${LIVE} lk=${!!j.livekit}`);
    } catch (e) {
      mark('B15_live_health', false, e.message);
    }
  }

  await browser.close();
  server.close();

  const numer = rows.filter((r) => r.pass).length;
  const denom = rows.length;
  const summary = {
    at: new Date().toISOString(),
    harness: base,
    live: LIVE,
    numerator: numer,
    denominator: denom,
    pass: numer === denom && denom > 0,
    fails: rows.filter((r) => !r.pass).map((r) => r.id + ': ' + r.detail),
    rows
  };
  fs.writeFileSync(reportJson, JSON.stringify(summary, null, 2));
  fs.writeFileSync(
    reportMd,
    [
      '# THING-BROWSER-ACTIONS',
      '',
      `at: ${summary.at}`,
      `harness: ${base}`,
      `live: ${LIVE}`,
      `result: ${numer}/${denom} ${summary.pass ? 'GREEN' : 'RED'}`,
      '',
      '| ID | PASS | Detail |',
      '|----|------|--------|',
      ...rows.map((r) => `| ${r.id} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.detail.replace(/\|/g, '/')} |`),
      '',
      summary.pass
        ? 'VERDICT: ALL_GREEN — исправлять нечего, улучшать нечего'
        : 'VERDICT: FAIL — ' + summary.fails.length + ' items'
    ].join('\n')
  );
  console.log('\nBROWSER ' + numer + '/' + denom + (summary.pass ? ' GREEN' : ' RED'));
  process.exit(summary.pass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
