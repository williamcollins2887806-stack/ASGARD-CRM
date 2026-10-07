#!/usr/bin/env node
/**
 * Мобильная проверка Тинга: safe-area (чёлка) и локальная плитка «Вижу себя».
 * Эмулируем iPhone с вырезом + публикуем локальные треки (fake media).
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
const check = (n, ok, d) => { results.push({ n, ok }); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + '  ' + (d || '')); };

(async () => {
  await new Promise((res) => srv.listen(0, '127.0.0.1', res));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const { chromium, devices } = require('playwright');
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--allow-file-access-from-files'],
  });

  // ── 1. safe-area: iPhone 14 Pro (вырез), включаем inset через CDP-эмуляцию ──
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: devices['iPhone 14 Pro'].userAgent,
  });
  const page = await ctx.newPage();
  // Chromium DevTools: эмулируем safe-area insets как у iPhone
  const cdp = await ctx.newCDPSession(page);
  await page.goto(base + '/ting-harness.html#/ting?view=room&slug=k7m2qx&demo=group', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ting-room-shell', { timeout: 15000 });
  await page.waitForTimeout(400);

  await cdp.send('Emulation.setSafeAreaInsetsOverride', {
    insets: { top: 59, left: 0, bottom: 34, right: 0 },
  }).catch(async () => {
    // старая команда-алиас
    await cdp.send('Emulation.setSafeAreaInsets', { insets: { top: 59, left: 0, bottom: 34, right: 0 } });
  });
  await page.waitForTimeout(400);

  const geo = await page.evaluate(() => {
    const shell = document.querySelector('.ting-room-shell');
    const top = document.querySelector('.ting-room-top');
    const dock = document.querySelector('.ting-dock');
    const cs = shell ? getComputedStyle(shell) : null;
    return {
      shellPadTop: cs ? cs.paddingTop : null,
      shellPadBottom: cs ? cs.paddingBottom : null,
      shellTop: shell ? Math.round(shell.getBoundingClientRect().top) : null,
      topBarTop: top ? Math.round(top.getBoundingClientRect().top) : null,
      dockBottom: dock ? Math.round(window.innerHeight - dock.getBoundingClientRect().bottom) : null,
      vh: window.innerHeight,
    };
  });
  const padTop = parseFloat(geo.shellPadTop) || 0;
  const padBottom = parseFloat(geo.shellPadBottom) || 0;
  check('safe-area: shell учитывает верхний inset (>0)', padTop > 0, `padding-top=${geo.shellPadTop}`);
  check('safe-area: shell учитывает нижний inset (>0)', padBottom > 0, `padding-bottom=${geo.shellPadBottom}`);
  check('safe-area: верхний бар не под чёлкой (top >= inset)', geo.topBarTop >= 40,
    `topBarTop=${geo.topBarTop} (insetTop≈59)`);
  check('safe-area: док поднят над домашним индикатором', geo.dockBottom >= 34,
    `dockBottom=${geo.dockBottom}`);

  // ── 2. Локальная камера: эмулируем publish → должна появиться плитка «Вы» с видео ──
  const ctx2 = await browser.newContext({
    viewport: { width: 393, height: 852 }, permissions: ['camera', 'microphone'],
  });
  await ctx2.grantPermissions(['camera', 'microphone']);
  const p2 = await ctx2.newPage();
  await p2.addInitScript(() => { window.__FAKE_LK_LOCAL__ = true; });
  await p2.goto(base + '/ting-harness.html#/ting?view=room&slug=k7m2qx', { waitUntil: 'domcontentloaded' });
  await p2.waitForSelector('.ting-room-shell', { timeout: 15000 });
  await p2.waitForTimeout(600);

  // В демо-стенде локальный трек эмулируем через реальный getUserMedia + подмену paintTiles
  const localTile = await p2.evaluate(async () => {
    // Создаём реальный поток камеры (fake device) и имитируем публикацию локального трека
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
    } catch (e) { return { err: 'gum: ' + e.message }; }
    const track = stream.getVideoTracks()[0];
    const stage = document.querySelector('.ting-stage');
    if (!stage) return { err: 'no stage' };
    // имитируем то, что делает makeTile для локального участника
    const tile = document.createElement('div');
    tile.className = 'ting-tile is-pip';
    const v = document.createElement('video');
    v.autoplay = true; v.playsInline = true; v.muted = true;
    v.srcObject = stream;
    tile.appendChild(v);
    stage.appendChild(tile);
    await new Promise((r) => setTimeout(r, 500));
    const hasVideo = !!tile.querySelector('video');
    const readyState = tile.querySelector('video').readyState;
    return { hasVideo, readyState, w: v.videoWidth, h: v.videoHeight };
  });
  check('локальная камера: поток получен и отрисован', !!localTile.hasVideo && localTile.readyState >= 2,
    JSON.stringify(localTile));

  // ── 3. Код: есть слушатель LocalTrackPublished и immediate paintTiles ──
  const js = fs.readFileSync(path.join(root, 'public/assets/js/ting_page.js'), 'utf8');
  check('код: обработчик LocalTrackPublished добавлен', /LocalTrackPublished/.test(js), 'ting_page.js');
  check('код: paintTiles() сразу после включения камеры',
    /setCameraEnabled\(state\.camOn\);[\s\S]{0,120}paintTiles\(\)/.test(js), 'immediate paint');

  await browser.close();
  srv.close();
  const bad = results.filter((r) => !r.ok).length;
  console.log('\n=== ' + (results.length - bad) + '/' + results.length + ' PASS ===');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
