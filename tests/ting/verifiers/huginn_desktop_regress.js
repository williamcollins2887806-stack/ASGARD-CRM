#!/usr/bin/env node
/** Desktop-регресс Huginn: .hg-chrome не должен получить safe-area padding на десктопе. */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const root = path.join(__dirname, '../../..');

function ct(p) {
  if (p.endsWith('.html')) return 'text/html; charset=utf-8';
  if (p.endsWith('.css')) return 'text/css; charset=utf-8';
  if (p.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (p.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent((q.url || '/').split('?')[0]);
  let f = path.join(root, 'public', u.replace(/^\//, ''));
  if (u.endsWith('/')) f = path.join(root, 'public', u.replace(/^\//, ''), 'index.html');
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end('no'); return; }
  r.writeHead(200, { 'Content-Type': ct(f) }); fs.createReadStream(f).pipe(r);
});
(async () => {
  await new Promise((res) => srv.listen(0, '127.0.0.1', res));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const { chromium } = require('playwright');
  const b = await chromium.launch({ headless: true });
  const results = [];
  const check = (n, ok, d) => { results.push(ok); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + '  ' + (d || '')); };

  for (const vp of [{ w: 1280, h: 800, label: 'desktop' }, { w: 1024, h: 768, label: 'tablet' }]) {
    const ctx = await b.newContext({ viewport: { width: vp.w, height: vp.h } });
    const page = await ctx.newPage();
    await page.goto(base + '/_safe_probe.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    const cs = await page.evaluate(() => {
      const el = document.querySelector('.hg-chrome');
      const s = getComputedStyle(el);
      return { padTop: s.paddingTop, padLeft: s.paddingLeft, padRight: s.paddingRight, top: s.top, right: s.right };
    });
    check(`${vp.label}: .hg-chrome без safe-area padding (регресс)`,
      parseFloat(cs.padTop) === 0 && parseFloat(cs.padLeft) === 0 && parseFloat(cs.padRight) === 0,
      JSON.stringify(cs));
    await ctx.close();
  }
  await b.close(); srv.close();
  const bad = results.filter((r) => !r).length;
  console.log('\n=== ' + (results.length - bad) + '/' + results.length + ' PASS ===');
  process.exit(bad ? 1 : 0);
})();
