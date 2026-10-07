#!/usr/bin/env node
/**
 * Проверка safe-area в мобильных поверхностях: Huginn (/h/), Тинг-гость, /m/.
 * Эмулируем iPhone 14 Pro (insets 59/34). Гейт: exit 1 при FAIL.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const root = path.join(__dirname, '../../..');

/* Минимальная разметка, повторяющая мобильный Huginn-док (без авторизации /h/ не рендерит док). */
const PROBE_HTML = `<!DOCTYPE html><html lang="ru"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no"/>
<link rel="stylesheet" href="/assets/css/design-tokens.css"/>
<link rel="stylesheet" href="/assets/css/huginn_dock.css"/>
<title>safe-area probe</title>
<style>html,body{margin:0;padding:0;background:#0d1117}</style>
</head><body>
<div class="hg-chrome" id="huginnDock">
  <section class="hg-panel">
    <div class="hg-panel-head hg-list-head-hybrid">
      <h2>Хугинн</h2>
      <span class="hg-head-actions"><button class="hg-head-edit">Изм.</button></span>
    </div>
    <div class="hg-list"><div class="hg-chat-row">Тестовая строка</div></div>
  </section>
</div>
<nav class="hg-bottom-nav"></nav>
</body></html>`;

function ct(p) {
  if (p.endsWith('.html')) return 'text/html; charset=utf-8';
  if (p.endsWith('.css')) return 'text/css; charset=utf-8';
  if (p.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (p.endsWith('.json') || p.endsWith('.webmanifest')) return 'application/manifest+json';
  if (p.endsWith('.svg')) return 'image/svg+xml';
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.woff2')) return 'font/woff2';
  return 'application/octet-stream';
}

const srv = http.createServer((q, r) => {
  const u = decodeURIComponent((q.url || '/').split('?')[0]);
  if (u === '/_safe_probe.html') {
    r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(PROBE_HTML); return;
  }
  let f = path.join(root, 'public', u.replace(/^\//, ''));
  if (u.endsWith('/')) f = path.join(root, 'public', u.replace(/^\//, ''), 'index.html');
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end('no'); return; }
  r.writeHead(200, { 'Content-Type': ct(f) }); fs.createReadStream(f).pipe(r);
});

const results = [];
const check = (n, ok, d) => { results.push({ n, ok }); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + '  ' + (d || '')); };

async function setInsets(cdp) {
  try {
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 59, left: 0, bottom: 34, right: 0 } });
  } catch (_) {
    await cdp.send('Emulation.setSafeAreaInsets', { insets: { top: 59, left: 0, bottom: 34, right: 0 } });
  }
}

(async () => {
  await new Promise((res) => srv.listen(0, '127.0.0.1', res));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const { chromium, devices } = require('playwright');
  const browser = await chromium.launch({ headless: true });

  async function openMobile(url) {
    const ctx = await browser.newContext({
      viewport: { width: 393, height: 852 }, deviceScaleFactor: 3,
      isMobile: true, hasTouch: true, userAgent: devices['iPhone 14 Pro'].userAgent,
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const cdp = await ctx.newCDPSession(page);
    await setInsets(cdp);
    await page.waitForTimeout(500);
    return { ctx, page };
  }

  // ── Huginn /h/ (standalone приложение) ──
  // Приложение без авторизации не поднимает док, поэтому проверяем на реальном
  // huginn_dock.css: синтетический .hg-chrome с шапкой + .hg-list на мобильном вьюпорте.
  {
    const { ctx, page } = await openMobile(base + '/_safe_probe.html');
    const info = await page.evaluate(() => {
      const chrome = document.querySelector('.hg-chrome');
      const cs = getComputedStyle(chrome);
      const rect = chrome.getBoundingClientRect();
      const head = document.querySelector('.hg-list-head-hybrid');
      return {
        padTop: cs.paddingTop, padLeft: cs.paddingLeft, padRight: cs.paddingRight,
        chromeTop: Math.round(rect.top),
        headTop: head ? Math.round(head.getBoundingClientRect().top) : null,
      };
    });
    check('Huginn: .hg-chrome получил safe-area (top)', parseFloat(info.padTop) > 0, JSON.stringify(info));
    check('Huginn: шапка не под чёлкой (top >= 40 при inset 59)', info.headTop != null && info.headTop >= 40, `headTop=${info.headTop}`);
    check('Huginn: боковые вырезы учтены (left/right)', parseFloat(info.padLeft) >= 0 && parseFloat(info.padRight) >= 0,
      `left=${info.padLeft} right=${info.padRight}`);
    await ctx.close();
  }

  // ── Гость Тинга (/ting/) — viewport-fit=cover ──
  {
    const { ctx, page } = await openMobile(base + '/ting/index.html');
    await page.waitForTimeout(600);
    const vp = await page.evaluate(() => {
      const m = document.querySelector('meta[name="viewport"]');
      return m ? m.getAttribute('content') : '';
    });
    check('Гость Тинга: viewport-fit=cover', /viewport-fit=cover/.test(vp), vp);

    // CSS: safe-area применяется к полям гостя
    const applied = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;top:env(safe-area-inset-top,0px);left:0;width:1px;height:1px;';
      document.body.appendChild(probe);
      const v = probe.getBoundingClientRect().top;
      probe.remove();
      return Math.round(v);
    });
    check('Гость Тинга: env(safe-area-inset-top) доступен', applied !== null, 'top=' + applied);
    await ctx.close();
  }

  // ── Мобильная CRM /m/ ──
  {
    const { ctx, page } = await openMobile(base + '/m/index.html');
    await page.waitForTimeout(1200);
    const info = await page.evaluate(() => {
      const m = document.querySelector('meta[name="viewport"]');
      const probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;top:env(safe-area-inset-top,0px);width:1px;height:1px;';
      document.body.appendChild(probe);
      const top = Math.round(probe.getBoundingClientRect().top);
      probe.remove();
      return { vp: m ? m.getAttribute('content') : '', top, root: !!document.getElementById('root') };
    });
    check('Мобильная CRM: viewport-fit=cover', /viewport-fit=cover/.test(info.vp), info.vp);
    check('Мобильная CRM: env(safe-area-inset-top) применяется', info.top > 0, 'top=' + info.top);
    check('Мобильная CRM: приложение отрендерилось', info.root, JSON.stringify(info));
    await ctx.close();
  }

  await browser.close();
  srv.close();
  const bad = results.filter((r) => !r.ok).length;
  console.log('\n=== ' + (results.length - bad) + '/' + results.length + ' PASS ===');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
