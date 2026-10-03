#!/usr/bin/env node
/**
 * Full Ting shot matrix — every page/modal, desktop + mobile.
 * For independent layout designer review.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const root = path.join(__dirname, '../../..');
const outDir = path.join(root, 'tests/reports/ting_ui_shots_v2');
const matrixMd = path.join(outDir, 'MATRIX.md');

function contentType(p) {
  if (p.endsWith('.html') || p.endsWith('.htm')) return 'text/html; charset=utf-8';
  if (p.endsWith('.css')) return 'text/css; charset=utf-8';
  if (p.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (p.endsWith('.svg')) return 'image/svg+xml';
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.woff2')) return 'font/woff2';
  return 'application/octet-stream';
}

function startStatic() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/' || urlPath === '/ting-harness.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(path.join(__dirname, 'ting_harness.html'), 'utf8').replace(
          'BASE_PLACEHOLDER',
          'local'
        ));
        return;
      }
      // inline harness if file missing
      if (urlPath === '/ting-harness.html' || urlPath === '/') {
        /* handled above */
      }
      const file = path.join(root, 'public', urlPath.replace(/^\//, ''));
      if (!file.startsWith(path.join(root, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        // serve harness inline
        if (urlPath.includes('ting-harness') || urlPath === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(HARNESS);
          return;
        }
        res.writeHead(404); res.end('no'); return;
      }
      res.writeHead(200, { 'Content-Type': contentType(file) });
      fs.createReadStream(file).pipe(res);
    });
    // fix: always use HARNESS for harness path
    const orig = server.listeners('request')[0];
    server.removeAllListeners('request');
    server.on('request', (req, res) => {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/' || urlPath === '/ting-harness.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(HARNESS);
        return;
      }
      const file = path.join(root, 'public', urlPath.replace(/^\//, ''));
      if (!file.startsWith(path.join(root, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('no'); return;
      }
      res.writeHead(200, { 'Content-Type': contentType(file) });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, base: 'http://127.0.0.1:' + server.address().port }));
  });
}

const HARNESS = `<!DOCTYPE html><html lang="ru"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="stylesheet" href="/assets/css/ting.css"/>
<title>Ting harness</title>
<style>html,body{margin:0;background:#0a0c10;min-height:100%}</style>
</head><body>
<div id="ting-root" class="ting-page"></div>
<script src="/assets/js/ting_icons.js"></script>
<script src="/assets/js/ting_common.js"></script>
<script src="/assets/js/ting_page.js"></script>
<script>
window.ASGARD_USER = { id: 1, name: 'Никита', full_name: 'Никита Морозов' };
const origFetch = window.fetch.bind(window);
window.fetch = async function(url, opts) {
  const u = String(url);
  if (u.includes('/api/thing/rooms') && (!opts || !opts.method || opts.method === 'GET') && !/rooms\\/[^/?]+/.test(u)) {
    return new Response(JSON.stringify({ rooms: [
      { title: 'Смета ОВКВ · согласование', slug: 'k7m2qx', status: 'live', dial_code: '482917', created_at: new Date().toISOString() },
      { title: 'Еженедельный статус', slug: 'demo02', status: 'scheduled', dial_code: '111222', created_at: new Date(Date.now()-864e5).toISOString() }
    ]}), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.includes('/api/meetings')) return new Response(JSON.stringify({ meetings: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (u.includes('/api/thing/dial-in')) return new Response(JSON.stringify({ number: '+7 495 000-00-42', instruction: 'Наберите и введите код', enabled: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (/\\/api\\/thing\\/rooms\\/[^/]+$/.test(u) && (!opts || !opts.method || opts.method === 'GET')) {
    return new Response(JSON.stringify({ room: { title: 'Смета ОВКВ · согласование', slug: 'k7m2qx', status: 'live', dial_code: '482917', pin_code: '3914', meeting_id: 2042, url: 'https://asgard-crm.ru/ting/k7m2qx' }}), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.includes('/protocol')) {
    return new Response(JSON.stringify({
      protocol_status: 'ready',
      can_edit: false,
      meeting_id: 2042,
      duration: '24 мин',
      protocol_no: 'Т-K7M2QX',
      participants: [
        { display_name: 'Никита', role: 'host' },
        { display_name: 'Елена', role: 'member' },
        { display_name: 'Гость', role: 'guest' }
      ],
      summary: 'Согласовали объёмы ОВКВ; КП уходит заказчику до пятницы.',
      minutes: [
        { item_type: 'agenda', content: 'Согласование сметы ОВКВ' },
        { item_type: 'decision', content: 'Утвердить объёмы до пятницы' },
        { item_type: 'task', content: 'Отправить КП заказчику', assignee: 'Елена', due: 'пт', status: 'open' },
        { item_type: 'task', content: 'Сверить объёмы ОВ', assignee: 'Никита', due: 'ср', status: 'done' },
        { item_type: 'question', content: 'Нужен ли выезд на объект до подписания?' }
      ],
      status_labels: { ready: 'Протокол готов' }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.includes('/participants')) {
    return new Response(JSON.stringify({ is_host: true, participants: [
      { id: 1, identity: 'host', display_name: 'Никита', role: 'host', lobby_status: 'admitted' },
      { id: 2, identity: 'e', display_name: 'Елена', role: 'member', lobby_status: 'admitted' },
      { id: 3, identity: 'p', display_name: 'Гость', role: 'guest', lobby_status: 'admitted' },
      { id: 4, identity: 'w', display_name: 'Ожидает', role: 'guest', lobby_status: 'waiting' }
    ], live: [
      { identity: 'host', name: 'Никита', state: 'active', tracks: [] },
      { identity: 'e', name: 'Елена', state: 'active', tracks: [] },
      { identity: 'p', name: 'Гость', state: 'active', tracks: [] }
    ]}), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.includes('/chat')) {
    return new Response(JSON.stringify({ messages: [
      { display_name: 'Елена', text: 'Скиньте ссылку на смету ещё раз', identity: 'e' },
      { display_name: 'Никита', text: 'Уже в чате ✓', user_id: 1, identity: 'user_1' }
    ]}), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  const method = (opts && opts.method) || 'GET';
  if (method === 'POST' && /\\/api\\/thing\\/rooms\\/[^/]+\\/end/.test(u)) {
    return new Response(JSON.stringify({ ok: true, protocol: { protocol: 'no_recording' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (method === 'POST' && /\\/api\\/thing\\/rooms\\/[^/]+\\/leave/.test(u)) {
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (method === 'POST' && /\\/api\\/thing\\/rooms\\/[^/]+\\/chat/.test(u)) {
    return new Response(JSON.stringify({ ok: true, message: { text: 'ok', display_name: 'Никита' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return origFetch(url, opts);
};
if (!location.hash || location.hash.indexOf('#/ting') !== 0) location.hash = '#/ting';
window.__TING_HARNESS_DEMO__ = true;
TingPage.mount('#ting-root');
window.addEventListener('hashchange', () => TingPage.onHash());
</script></body></html>`;

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const { chromium } = require('playwright');
  const { server, base } = await startStatic();
  const browser = await chromium.launch({ headless: true });
  const rows = [];
  const desk = { width: 1280, height: 800 };
  const mob = { width: 390, height: 844 };

  async function shot(name, viewport, hash, after) {
    const context = await browser.newContext({ viewport, permissions: [] });
    const page = await context.newPage();
    try {
      await page.goto(base + '/ting-harness.html' + hash, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector('.ting-page', { timeout: 15000 });
      await page.waitForTimeout(450);
      if (after) await after(page);
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(outDir, name + '.png'), fullPage: true });
      rows.push({ name, ok: true, vp: viewport.width + 'x' + viewport.height });
      console.log('OK', name);
    } catch (e) {
      rows.push({ name, ok: false, err: e.message, vp: viewport.width + 'x' + viewport.height });
      console.log('FAIL', name, e.message);
    }
    await context.close();
  }

  async function shotRoom(name, viewport, after, clipMain) {
    const context = await browser.newContext({ viewport, permissions: [] });
    const page = await context.newPage();
    try {
      await page.goto(base + '/ting-harness.html#/ting?view=room&slug=k7m2qx', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector('.ting-room-shell', { timeout: 15000 });
      await page.waitForTimeout(400);
      if (after) await after(page);
      await page.waitForTimeout(300);
      const file = path.join(outDir, name + '.png');
      if (clipMain) {
        const el = await page.$('.ting-room-main') || await page.$('.ting-room-shell');
        await el.screenshot({ path: file });
      } else {
        await page.screenshot({ path: file, fullPage: false });
      }
      rows.push({ name, ok: true, vp: viewport.width + 'x' + viewport.height });
      console.log('OK', name);
    } catch (e) {
      rows.push({ name, ok: false, err: e.message, vp: viewport.width + 'x' + viewport.height });
      console.log('FAIL', name, e.message);
    }
    await context.close();
  }

  const pages = [
    ['hub', '#/ting'],
    ['new', '#/ting?view=new'],
    ['schedule', '#/ting?view=schedule'],
    ['meeting_create', '#/ting?view=meeting-create'],
    ['ready', '#/ting?view=ready&slug=k7m2qx'],
    ['lobby', '#/ting?view=lobby&slug=k7m2qx'],
    ['waiting', '#/ting?view=waiting&slug=k7m2qx'],
    ['dialin', '#/ting?view=dialin&slug=k7m2qx'],
    ['protocol', '#/ting?view=protocol&slug=k7m2qx'],
    ['meeting', '#/ting?view=meeting&slug=k7m2qx'],
    ['ended', '#/ting?view=ended&slug=k7m2qx'],
    ['error', '#/ting?view=error']
  ];
  for (const [id, hash] of pages) {
    await shot('crm_d_' + id, desk, hash);
    await shot('crm_m_' + id, mob, hash);
  }

  async function hideChat(page) {
    await page.evaluate(() => {
      const c = document.querySelector('.ting-chat');
      if (c) c.style.display = 'none';
      document.querySelector('.ting-room-shell')?.classList.add('no-chat');
    });
  }

  for (const [prefix, vp] of [['crm_d', desk], ['crm_m', mob]]) {
    await shotRoom(prefix + '_room_grid', vp, async (page) => {
      await page.waitForSelector('.ting-tile', { timeout: 5000 });
      await hideChat(page);
    }, true);
    await shotRoom(prefix + '_room_speaker', vp, async (page) => {
      await page.click('[data-act="layout-toggle"]');
      await page.waitForTimeout(350);
      await hideChat(page);
    }, true);
    await shotRoom(prefix + '_room_people', vp, async (page) => {
      await page.click('.ting-top-actions [data-act="toggle-people"]');
      await page.waitForSelector('.ting-people-drawer', { timeout: 5000 });
      await page.waitForTimeout(200);
    }, false);
    await shotRoom(prefix + '_room_chat', vp, async (page) => {
      if (vp.width < 500) {
        try { await page.click('[data-act="chat-open-mobile"]'); } catch (_) {}
        await page.waitForTimeout(300);
      }
      await page.evaluate(() => {
        const list = document.querySelector('#ting-chat-list');
        if (list) {
          list.innerHTML = '<div class="ting-chat-bubble"><b>Елена</b>Скиньте ссылку</div><div class="ting-chat-bubble me"><b>Вы</b>Уже в чате ✓</div>';
        }
      });
    }, false);
    await shotRoom(prefix + '_host_end', vp, async (page) => {
      await page.click('[data-act="host-end-open"]');
      await page.waitForSelector('#ting-host-end', { timeout: 5000 });
    }, false);
  }

  async function shotGuest(name, viewport, mode) {
    const context = await browser.newContext({ viewport, permissions: [] });
    const page = await context.newPage();
    try {
      await page.route('**/api/thing/public/**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            title: 'Смета ОВКВ · согласование', slug: 'k7m2qx',
            status: mode === 'ended' ? 'ended' : 'live',
            lobby_enabled: mode === 'waiting', pin_required: false
          })
        });
      });
      await page.goto(base + '/ting/index.html', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);
      await page.evaluate((m) => {
        const hide = (id) => document.getElementById(id)?.classList.add('hidden');
        const show = (id) => document.getElementById(id)?.classList.remove('hidden');
        ['lobby', 'waiting', 'ended', 'errorView', 'errorCode'].forEach(hide);
        if (m === 'lobby') {
          show('lobby');
          document.getElementById('title').textContent = 'Смета ОВКВ · согласование';
          document.getElementById('meta').textContent = 'Вас ждут.';
          document.getElementById('form').classList.remove('hidden');
          document.getElementById('name').value = 'Гость';
          document.getElementById('name').placeholder = 'Ваше имя';
          document.getElementById('previewAvatar').textContent = 'Г';
          document.getElementById('previewAvatar').style.display = 'grid';
        } else if (m === 'waiting') {
          show('waiting');
        } else if (m === 'ended') {
          show('ended');
          document.getElementById('endedMeta').textContent = 'Смета ОВКВ · согласование';
        } else if (m === 'error') {
          show('errorView');
          document.getElementById('errorMeta').textContent =
            'Сеть, PIN или доступ к комнате. Проверьте ссылку и попробуйте снова.';
        }
      }, mode);
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(outDir, name + '.png'), fullPage: true });
      rows.push({ name, ok: true, vp: viewport.width + 'x' + viewport.height });
      console.log('OK', name);
    } catch (e) {
      rows.push({ name, ok: false, err: e.message, vp: viewport.width + 'x' + viewport.height });
      console.log('FAIL', name, e.message);
    }
    await context.close();
  }

  for (const [prefix, vp] of [['guest_d', desk], ['guest_m', mob]]) {
    await shotGuest(prefix + '_lobby', vp, 'lobby');
    await shotGuest(prefix + '_waiting', vp, 'waiting');
    await shotGuest(prefix + '_ended', vp, 'ended');
    await shotGuest(prefix + '_error', vp, 'error');
  }

  await browser.close();
  server.close();

  const md = [
    '# Ting UI shot matrix — layout designer pack',
    '',
    `at: ${new Date().toISOString()}`,
    `ok: ${rows.filter((r) => r.ok).length}/${rows.length}`,
    '',
    'Viewports: desktop 1280x800, mobile 390x844',
    '',
    '| Shot | VP | OK |',
    '|------|----|----|',
    ...rows.map((r) => `| ${r.name} | ${r.vp || ''} | ${r.ok ? 'PASS' : 'FAIL ' + (r.err || '')} |`)
  ].join('\n');
  fs.writeFileSync(matrixMd, md);
  console.log(md);
  process.exit(rows.every((r) => r.ok) ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
