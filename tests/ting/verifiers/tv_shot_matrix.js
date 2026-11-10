#!/usr/bin/env node
/**
 * TV hall visual matrix R=1..15 — screenshots for director/layout review.
 * Injects fake tiles mirroring prod syncRosterTiles (is-gallery / is-self-pip).
 * Run: node tests/ting/verifiers/tv_shot_matrix.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const root = path.join(__dirname, '../../..');
const outDir = path.join(root, 'tests/reports/ting_ui_shots_v4');
const matrixMd = path.join(outDir, 'TV_MATRIX.md');

function contentType(p) {
  if (p.endsWith('.html')) return 'text/html; charset=utf-8';
  if (p.endsWith('.css')) return 'text/css; charset=utf-8';
  if (p.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (p.endsWith('.svg')) return 'image/svg+xml';
  if (p.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

function startStatic() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
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

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const { chromium } = require('playwright');
  const { server, base } = await startStatic();
  const browser = await chromium.launch({ headless: true });
  const rows = [];
  const vp = { width: 1920, height: 1080 };

  async function shotHall(R) {
    const context = await browser.newContext({ viewport: vp });
    const page = await context.newPage();
    const name = 'tv_hall_R' + String(R).padStart(2, '0');
    try {
      await page.goto(base + '/ting-tv/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(400);
      const mode = await page.evaluate((count) => {
        function hallModeFor(r) {
          if (r <= 0) return 'wait';
          if (r === 1) return 'spot';
          if (r === 2) return 'dual';
          if (r <= 7) return 'spot-rail';
          if (r <= 9) return 'g3';
          if (r <= 12) return 'g4';
          return 'g5';
        }
        const mode = hallModeFor(count);
        const start = document.getElementById('startView');
        const room = document.getElementById('roomView');
        if (start) start.classList.add('hidden');
        if (room) room.classList.remove('hidden');
        const stage = document.getElementById('stage');
        const strip = document.getElementById('filmstrip');
        const wrap = stage && stage.parentElement;
        if (!stage) return null;
        stage.innerHTML = '';
        if (strip) strip.innerHTML = '';
        stage.className = 'ttv-stage hall hall-' + mode;
        if (wrap) wrap.setAttribute('data-hall-mode', mode);
        const useRail = mode === 'spot-rail' || mode === 'share';
        if (strip) {
          if (useRail) strip.classList.remove('hidden');
          else strip.classList.add('hidden');
        }
        const names = ['Зал', 'Никита', 'Елена', 'Андрей', 'Мария', 'Игорь', 'Ольга', 'Сергей', 'Анна', 'Дмитрий', 'Павел', 'Наталья', 'Роман', 'Виктория', 'Кирилл', 'Гость'];
        /* Mirror syncRosterTiles: gallery remotes → is-gallery; local → is-self-pip (не ячейка сетки). */
        const isGallery = mode === 'dual' || mode === 'g3' || mode === 'g4' || mode === 'g5';
        const mk = (id, label, cls) => {
          const d = document.createElement('div');
          d.className = 'ttv-tile' + (cls ? (' ' + cls) : '');
          d.setAttribute('data-id', id);
          d.innerHTML = '<div class="ttv-av-fallback">' + (label || id).slice(0, 1) + '</div><div class="ttv-lbl">' + (label || id) + '</div>';
          return d;
        };
        const mkLocalPip = () => mk('local', 'Зал', 'is-local is-self-pip');
        if (mode === 'wait') {
          stage.appendChild(mk('local', 'Зал · вы', 'is-local is-main'));
        } else if (mode === 'spot') {
          stage.appendChild(mk('r1', names[1], 'is-main'));
          stage.appendChild(mkLocalPip());
        } else if (mode === 'dual') {
          stage.appendChild(mk('r1', names[1], 'is-gallery'));
          stage.appendChild(mk('r2', names[2], 'is-gallery'));
          stage.appendChild(mkLocalPip());
        } else if (mode === 'spot-rail') {
          stage.appendChild(mk('r1', names[1], 'is-main'));
          stage.appendChild(mkLocalPip());
          for (let i = 2; i <= count; i++) {
            if (strip) strip.appendChild(mk('r' + i, names[i] || ('Уч ' + i), 'is-rail'));
          }
        } else if (isGallery) {
          /* Capacity: g3≤9, g4≤12, g5≤15 remotes; local floats as self-pip */
          const cap = mode === 'g3' ? 9 : (mode === 'g4' ? 12 : 15);
          const nShow = Math.min(count, cap);
          for (let i = 1; i <= nShow; i++) {
            stage.appendChild(mk('r' + i, names[i] || ('Уч ' + i), 'is-gallery'));
          }
          stage.appendChild(mkLocalPip());
        }
        /* burn-in RU */
        let bar = document.getElementById('ting-shot-caption');
        if (!bar) {
          bar = document.createElement('div');
          bar.id = 'ting-shot-caption';
          bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;padding:10px 14px;background:rgba(0,0,0,.82);color:#fff;font:600 14px/1.3 system-ui,sans-serif;pointer-events:none';
          document.body.appendChild(bar);
        }
        bar.textContent = 'TV · зал · R=' + count + ' · mode=' + mode + ' · 1920×1080';
        return mode;
      }, R);
      await page.waitForTimeout(250);
      /* bbox non-intersect for gallery tiles (self-pip may overlay — exclude) */
      const geom = await page.evaluate(() => {
        const tiles = Array.from(document.querySelectorAll('.ttv-stage > .ttv-tile:not(.is-self-pip)'));
        const boxes = tiles.map((el) => {
          const r = el.getBoundingClientRect();
          return { id: el.getAttribute('data-id'), left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
        });
        let overlap = false;
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i]; const b = boxes[j];
            const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ix > 1 && iy > 1) overlap = true;
          }
        }
        return { n: boxes.length, overlap, boxes: boxes.map((b) => b.id + ':' + Math.round(b.w) + 'x' + Math.round(b.h)) };
      });
      if (geom.overlap) throw new Error('tile bbox overlap: ' + geom.boxes.join(','));
      await page.screenshot({ path: path.join(outDir, name + '.png'), fullPage: false });
      rows.push({ name, ok: true, R, mode, tiles: geom.n });
      console.log('OK', name, 'mode=' + mode, 'tiles=' + geom.n);
    } catch (e) {
      rows.push({ name, ok: false, R, err: e.message });
      console.log('FAIL', name, e.message);
    }
    await context.close();
  }

  for (const R of [1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 15]) {
    await shotHall(R);
  }

  await browser.close();
  server.close();

  const passed = rows.filter((r) => r.ok).length;
  const md = [
    '# Ting TV hall shot matrix v4',
    '',
    'Viewport: 1920×1080. Injector = prod syncRosterTiles (is-gallery / is-self-pip).',
    '',
    '| Shot | R | Mode | Tiles | OK |',
    '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.name}.png | ${r.R} | ${r.mode || '-'} | ${r.tiles != null ? r.tiles : '-'} | ${r.ok ? 'PASS' : 'FAIL ' + (r.err || '')} |`),
    '',
    `Total: ${passed}/${rows.length}`
  ].join('\n');
  fs.writeFileSync(matrixMd, md, 'utf8');
  console.log('\n=== TV shots', passed + '/' + rows.length, '→', outDir);
  if (passed !== rows.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
