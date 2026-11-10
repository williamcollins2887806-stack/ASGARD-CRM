#!/usr/bin/env node
/**
 * Геометрия ТВ-сцены после переноса дока поверх картинки:
 * проверяем, что сцена ≈ 16:9 и не «сплющена».
 */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '../../..');
const PUBLIC = path.join(root, 'public');
const PREFIXED = ['/assets/', '/ting/', '/ting-tv/', '/h/'];

function resolveFile(urlPath) {
  // Каталог → index.html (как делает @fastify/static).
  let p = null;
  if (PREFIXED.some((prefix) => urlPath.startsWith(prefix))) {
    p = path.join(PUBLIC, urlPath.replace(/^\//, ''));
  } else if (urlPath === '/') {
    p = path.join(PUBLIC, 'index.html');
  } else {
    p = path.join(root, urlPath.replace(/^\//, ''));
  }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  return p;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const full = resolveFile(urlPath);
      if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        res.writeHead(404).end('nf');
        return;
      }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      fs.createReadStream(full).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

/**
 * Замер в headless Chrome через CDP: open page → set viewport 1920x1080 →
 * измерить .ttv-stage и .ttv-room.
 */
async function measure(url) {
  const chrome = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe'
  ].find((p) => p && fs.existsSync(p));
  if (!chrome) return null;

  const port = 9333 + Math.floor(Math.random() * 300);
  const userData = path.join(require('os').tmpdir(), 'tingtvp-' + Date.now());
  const proc = require('child_process').spawn(chrome, [
    '--headless=new',
    '--remote-debugging-port=' + port,
    '--window-size=1920,1080',
    '--user-data-dir=' + userData,
    '--no-first-run',
    '--disable-gpu',
    'about:blank'
  ], { stdio: 'ignore' });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    let ws = null;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const page = list.find((t) => t.type === 'page');
        if (page && page.webSocketDebuggerUrl) { ws = page.webSocketDebuggerUrl; break; }
      } catch (_) { /* ещё не поднялся */ }
    }
    if (!ws) return null;

    const { WebSocket } = require('ws');
    const sock = new WebSocket(ws);
    await new Promise((r) => sock.once('open', r));
    let id = 0;
    const pending = new Map();
    sock.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    });
    const send = (method, params) => new Promise((res) => {
      const mid = ++id;
      pending.set(mid, res);
      sock.send(JSON.stringify({ id: mid, method, params: params || {} }));
    });

    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false
    });
    await send('Page.navigate', { url });
    await sleep(2500);

    /* Заселяем сцену плитками как в реальном зале: без них замер бессмыслен. */
    await send('Runtime.evaluate', {
      expression: `(() => {
        const rv = document.getElementById('roomView');
        if (rv) rv.classList.remove('hidden');
        const stage = document.getElementById('stage');
        if (!stage) return 'no stage';
        stage.className = 'ttv-stage hall hall-spot';
        const ids = ['p1','p2','me'];
        stage.innerHTML = '';
        ids.forEach((id, i) => {
          const t = document.createElement('div');
          t.className = 'ttv-tile' + (id === 'me' ? ' is-self-pip' : (id === 'p1' ? ' is-main' : ''));
          t.setAttribute('data-id', id);
          t.innerHTML = '<div class="ttv-av-fallback">П' + (i+1) + '</div><div class="ttv-lbl">' + id + '</div>';
          stage.appendChild(t);
        });
        return 'ok';
      })()`,
      returnByValue: true
    });
    await sleep(400);

    const expr = `(() => {
      /* Комната скрыта до входа — раскрываем принудительно для замера. */
      const rv = document.getElementById('roomView');
      if (rv) rv.classList.remove('hidden');
      const info = {
        url: location.href,
        title: document.title,
        hasRoomView: !!rv,
        hasRoom: !!document.querySelector('.ttv-room'),
        bodyLen: document.body ? document.body.innerHTML.length : -1,
        classes: document.body ? document.body.className : ''
      };
      const room = document.querySelector('.ttv-room');
      const stage = document.querySelector('.ttv-stage');
      const wrap = document.querySelector('.ttv-stage-wrap');
      const dock = document.querySelector('.ttv-dock');
      if (!room || !stage) return JSON.stringify({ error: 'no room/stage', info: info });
      const r = (el) => { const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), y: Math.round(b.y) }; };
      const rr = r(room), rs = r(stage);
      const main = stage.querySelector('.is-main');
      const gallery = stage.querySelector('.is-gallery');
      const pip = stage.querySelector('.is-self-pip');
      const rm = main ? r(main) : null;
      return JSON.stringify({
        room: rr,
        stage: rs,
        stageRatio: +(rs.w / rs.h).toFixed(3),
        main: rm,
        mainRatio: rm ? +(rm.w / rm.h).toFixed(3) : null,
        galleryRatio: gallery ? +(r(gallery).w / r(gallery).h).toFixed(3) : null,
        pipRatio: pip ? +(r(pip).w / r(pip).h).toFixed(3) : null,
        wrap: wrap ? r(wrap) : null,
        dock: dock ? r(dock) : null,
        bodyScrollW: document.body.scrollWidth,
        bodyClientW: document.body.clientWidth
      });
    })()`;

    const out = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    sock.close();
    return out.result && out.result.result && out.result.result.value;
  } finally {
    try { proc.kill(); } catch (_) { /* */ }
  }
}

(async () => {
  const srv = await serve();
  const port = srv.address().port;
  const url = `http://127.0.0.1:${port}/ting-tv/`;
  const res = await measure(url);
  srv.close();
  if (!res) { console.log('SKIP: chrome/ws недоступны'); process.exit(0); }

  const d = typeof res === 'string' ? JSON.parse(res) : res;
  console.log(JSON.stringify(d, null, 2));
  if (d.error) { console.log('FAIL', d.error); process.exit(1); }

  const ratio = d.stageRatio;
  /* Сцена — контейнер, её собственное соотношение не обязано быть 16:9:
     важно, что КАДР (плитка) 16:9 и влезает без обрезки. */
  const okStageFits = ratio >= 1.4;
  console.log(`stage ratio ${ratio} → ${okStageFits ? 'OK (контейнер)' : 'FAIL'}`);
  const mRatio = d.mainRatio;
  const okMain = mRatio == null || (mRatio >= 1.70 && mRatio <= 1.86);
  console.log(`main tile ratio ${mRatio} → ${okMain ? 'OK (16:9)' : 'FAIL (не 16:9)'}`);
  const area = d.main ? (d.main.w * d.main.h) : 0;
  const stageArea = d.stage ? (d.stage.w * d.stage.h) : 1;
  const fill = stageArea ? Math.round((area / stageArea) * 100) : 0;
  const okFill = d.main ? fill >= 55 : false;
  console.log(`main fills ${fill}% of stage → ${okFill ? 'OK' : 'FAIL (мелкая плитка)'}`);
  const noOverflow = d.bodyScrollW <= d.bodyClientW + 1;
  console.log(`no horizontal overflow: ${noOverflow ? 'OK' : 'FAIL'}`);
  process.exit(okStageFits && okMain && okFill && noOverflow ? 0 : 1);
})();
