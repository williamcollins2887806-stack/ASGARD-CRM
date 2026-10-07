#!/usr/bin/env node
/**
 * UI-проверка формы Тинга: чекбоксы «Запись»/«AI-протокол» есть и уходят в теле запроса.
 * Гейт: exit 1 при FAIL.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const root = path.join(__dirname, '../../..');
const HARNESS = eval(fs.readFileSync(path.join(root, 'tests/ting/verifiers/shot_matrix.js'), 'utf8')
  .match(/const HARNESS = (`[\s\S]*?`);\n/)[1]);

function ct(p) {
  if (p.endsWith('.html')) return 'text/html; charset=utf-8';
  if (p.endsWith('.css')) return 'text/css; charset=utf-8';
  if (p.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (p.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

const srv = http.createServer((q, r) => {
  const u = decodeURIComponent((q.url || '/').split('?')[0]);
  if (u === '/' || u === '/ting-harness.html') {
    r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(HARNESS); return;
  }
  const f = path.join(root, 'public', u.replace(/^\//, ''));
  if (!fs.existsSync(f)) { r.writeHead(404); r.end('no'); return; }
  r.writeHead(200, { 'Content-Type': ct(f) }); fs.createReadStream(f).pipe(r);
});

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? 'PASS  ' : 'FAIL  ') + name + '  ' + (detail || '')); };

(async () => {
  await new Promise((res) => srv.listen(0, '127.0.0.1', res));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  let posted = null;
  await page.route('**/api/thing/rooms', async (route) => {
    if (route.request().method() === 'POST') {
      try { posted = JSON.parse(route.request().postData() || '{}'); } catch (_) { posted = null; }
      return route.fulfill({ status: 201, contentType: 'application/json',
        body: JSON.stringify({ room: { id: 1, slug: 'ui-probe', title: (posted && posted.title) || 'T', recording_mode: posted && posted.recording_mode, protocol_enabled: posted && posted.protocol_enabled } }) });
    }
    return route.continue();
  });

  // Форма «Новый Тинг»
  await page.goto(base + '/ting-harness.html#/ting?view=new', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ting-title', { timeout: 15000 });
  const hasRec = await page.$('#ting-rec');
  const hasProto = await page.$('#ting-proto');
  check('форма: есть чекбокс «Запись»', !!hasRec, '#ting-rec');
  check('форма: есть чекбокс «AI-протокол»', !!hasProto, '#ting-proto');
  const isChecked = (id) => page.$eval(id, (el) => el.checked);
  const toggle = (id) => page.click(`label:has(${id}) .ting-switch-ui, label:has(${id})`);
  check('форма: оба по умолчанию выключены', !(await isChecked('#ting-rec')) && !(await isChecked('#ting-proto')), 'unchecked');

  // Сценарий A: только протокол → запись должна включиться автоматически
  await toggle('#ting-proto');
  await page.waitForTimeout(150);
  check('A: протокол отмечен', await isChecked('#ting-proto'), 'proto.checked');
  await page.click('[data-act="create"]');
  await page.waitForTimeout(400);
  check('A: уходит protocol_enabled=true', posted && posted.protocol_enabled === true, JSON.stringify(posted));
  check('A: протокол включает запись (recording_mode=auto)', posted && posted.recording_mode === 'auto', 'rec=' + (posted && posted.recording_mode));

  // Сценарий B: ничего не выбрано → запись manual, протокол false
  posted = null;
  await page.goto(base + '/ting-harness.html#/ting?view=new', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ting-title', { timeout: 15000 });
  await page.click('[data-act="create"]');
  await page.waitForTimeout(400);
  check('B: без галочек protocol_enabled=false', posted && posted.protocol_enabled === false, JSON.stringify(posted));
  check('B: без галочек recording_mode=manual', posted && posted.recording_mode === 'manual', 'rec=' + (posted && posted.recording_mode));

  // Сценарий C: только запись → протокол выключен
  posted = null;
  await page.goto(base + '/ting-harness.html#/ting?view=new', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ting-title', { timeout: 15000 });
  await toggle('#ting-rec');
  await page.waitForTimeout(150);
  check('C: запись отмечена', await isChecked('#ting-rec'), 'rec.checked');
  await page.click('[data-act="create"]');
  await page.waitForTimeout(400);
  check('C: запись без протокола (recording_mode=auto)', posted && posted.recording_mode === 'auto', 'rec=' + (posted && posted.recording_mode));
  check('C: запись без протокола (protocol_enabled=false)', posted && posted.protocol_enabled === false, 'proto=' + (posted && posted.protocol_enabled));

  await browser.close();
  srv.close();
  const bad = results.filter((r) => !r.ok);
  console.log('\n=== ' + (results.length - bad.length) + '/' + results.length + ' PASS ===');
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
