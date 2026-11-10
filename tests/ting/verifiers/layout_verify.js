#!/usr/bin/env node
/**
 * Ting layout geometry verifier (no screenshots — измеряет DOM).
 * Проверяет: пропорции тайлов (анти-сплющивание), PiP 4:3, один столбец на мобиле.
 * Гейт: exit 1 при любом FAIL.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const root = path.join(__dirname, '../../..');
const harnessPath = path.join(root, 'tests/ting/verifiers/shot_matrix.js');

function contentType(p) {
  if (p.endsWith('.html')) return 'text/html; charset=utf-8';
  if (p.endsWith('.css')) return 'text/css; charset=utf-8';
  if (p.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (p.endsWith('.svg')) return 'image/svg+xml';
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.woff2')) return 'font/woff2';
  return 'application/octet-stream';
}

/* HARNESS берём из shot_matrix.js, чтобы не дублировать демо-окружение.
   Извлекаем сам шаблонный литерал и вычисляем его так же, как это делает стенд. */
function extractHarness() {
  const src = fs.readFileSync(harnessPath, 'utf8');
  const m = src.match(/const HARNESS = (`[\s\S]*?`);\n/);
  if (!m) throw new Error('cannot extract HARNESS from shot_matrix.js');
  // eslint-disable-next-line no-eval
  return eval(m[1]);
}

function startStatic(harness) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/' || urlPath === '/ting-harness.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(harness);
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

const TOL = 0.06; // допуск по соотношению сторон

function ratio(w, h) { return h > 0 ? w / h : 0; }

async function main() {
  const { chromium } = require('playwright');
  const harness = extractHarness();
  const { server, base } = await startStatic(harness);
  const browser = await chromium.launch({ headless: true });
  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + '  ' + detail);
  };

  async function openRoom(viewport, hash) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.goto(base + '/ting-harness.html' + hash, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.ting-room-shell', { timeout: 15000 });
    await page.waitForTimeout(400);
    return { context, page };
  }

  const box = (page, sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height, top: r.top, left: r.left };
  }, sel);

  /* ---- 1. Desktop speaker 1-на-1: main 16:9, PiP 4:3, PiP внутри стейджа ---- */
  {
    const { context, page } = await openRoom({ width: 1280, height: 800 }, '#/ting?view=room&slug=k7m2qx');
    const main = await box(page, '.ting-stage.speaker > .ting-tile:not(.is-pip)');
    const pip = await box(page, '.ting-stage.speaker > .ting-tile.is-pip');
    const stage = await box(page, '.ting-stage.speaker');
    check('desktop: main-тайл существует', !!main, JSON.stringify(main));
    check('desktop: PiP-тайл существует', !!pip, JSON.stringify(pip));
    if (main) check('desktop: main ≈ 16:9 (анти-сплющивание)', Math.abs(ratio(main.w, main.h) - 16 / 9) < TOL, 'ratio=' + ratio(main.w, main.h).toFixed(3));
    if (pip) check('desktop: PiP ≈ 4:3', Math.abs(ratio(pip.w, pip.h) - 4 / 3) < TOL, 'ratio=' + ratio(pip.w, pip.h).toFixed(3));
    if (pip && stage) {
      const inside = pip.left >= stage.left - 1 && pip.top >= stage.top - 1 &&
        pip.left + pip.w <= stage.left + stage.w + 1 && pip.top + pip.h <= stage.top + stage.h + 1;
      check('desktop: PiP внутри стейджа', inside, `pip=${JSON.stringify(pip)} stage=${JSON.stringify(stage)}`);
    }
    // swap: клик по PiP меняет местами
    if (pip) {
      const before = await page.evaluate(() => document.querySelector('.ting-stage > .ting-tile.is-pip')?.dataset.id);
      await page.click('.ting-stage.speaker > .ting-tile.is-pip');
      await page.waitForTimeout(300);
      const after = await page.evaluate(() => document.querySelector('.ting-stage > .ting-tile.is-pip')?.dataset.id);
      check('desktop: клик по PiP меняет местами', !!before && !!after && before !== after, `${before} → ${after}`);
      const main2 = await box(page, '.ting-stage.speaker > .ting-tile:not(.is-pip)');
      if (main2) check('desktop: после свапа main ≈ 16:9', Math.abs(ratio(main2.w, main2.h) - 16 / 9) < TOL, 'ratio=' + ratio(main2.w, main2.h).toFixed(3));
      await page.click('.ting-stage.speaker > .ting-tile.is-pip');
      await page.waitForTimeout(300);
      const back = await page.evaluate(() => document.querySelector('.ting-stage > .ting-tile.is-pip')?.dataset.id);
      check('desktop: второй клик по PiP возвращает порядок', back === before, `${before} → ${after} → ${back}`);
    }
    await context.close();
  }

  /* ---- 2. Desktop grid: каждый тайл 16:9 (группа 3+ — жёстко, по размеру) ---- */
  {
    const { context, page } = await openRoom({ width: 1280, height: 800 }, '#/ting?view=room&slug=k7m2qx');
    await page.evaluate(() => document.querySelector('[data-act="layout-toggle"]')?.click());
    await page.waitForTimeout(400);
    const tiles = await page.evaluate(() => Array.from(document.querySelectorAll('.ting-stage > .ting-tile'))
      .map((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, id: el.dataset.id }; }));
    check('desktop grid: ≥3 тайла', tiles.length >= 3, 'n=' + tiles.length);
    const bad = tiles.filter((t) => Math.abs(ratio(t.w, t.h) - 16 / 9) > TOL);
    check('desktop grid: все тайлы ≈ 16:9', bad.length === 0, JSON.stringify(tiles.map((t) => ratio(t.w, t.h).toFixed(2))));
    const tiny = tiles.filter((t) => t.w < 120 || t.h < 60);
    check('desktop grid: нет вырожденных тайлов', tiny.length === 0, JSON.stringify(tiles.map((t) => `${Math.round(t.w)}x${Math.round(t.h)}`)));
    await context.close();
  }

  /* ---- 3. Mobile portrait: speaker + grid строго 16:9, без выхода за viewport ---- */
  {
    const { context, page } = await openRoom({ width: 390, height: 844 }, '#/ting?view=room&slug=k7m2qx');
    const cols = await page.evaluate(() => getComputedStyle(document.querySelector('.ting-stage')).gridTemplateColumns.split(' ').filter(Boolean).length);
    check('mobile speaker: один столбец', cols === 1, 'cols=' + cols);
    const main = await box(page, '.ting-stage.speaker > .ting-tile:not(.is-pip)');
    if (main) check('mobile speaker: main ≈ 16:9', Math.abs(ratio(main.w, main.h) - 16 / 9) < TOL, 'ratio=' + ratio(main.w, main.h).toFixed(3));
    const pip = await box(page, '.ting-stage.speaker > .ting-tile.is-pip');
    if (pip) {
      check('mobile speaker: PiP ширина ≥ 112px', pip.w >= 111, 'w=' + pip.w.toFixed(1));
      check('mobile speaker: PiP ≈ 4:3', Math.abs(ratio(pip.w, pip.h) - 4 / 3) < TOL, 'ratio=' + ratio(pip.w, pip.h).toFixed(3));
    }
    await page.evaluate(() => document.querySelector('[data-act="layout-toggle"]')?.click());
    await page.waitForTimeout(400);
    const gcols = await page.evaluate(() => getComputedStyle(document.querySelector('.ting-stage')).gridTemplateColumns.split(' ').filter(Boolean).length);
    check('mobile grid: две колонки', gcols === 2, 'cols=' + gcols);
    const ginfo = await page.evaluate(() => {
      const tiles = Array.from(document.querySelectorAll('.ting-stage > .ting-tile')).map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, w: r.width, h: r.height };
      });
      let overlap = false;
      for (let i = 0; i < tiles.length; i++) {
        for (let j = i + 1; j < tiles.length; j++) {
          const a = tiles[i]; const b = tiles[j];
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
            && Math.min(a.h + (a.top || 0), b.h + (b.top || 0)) > 1) {
            /* use full boxes */
          }
        }
      }
      const boxes = Array.from(document.querySelectorAll('.ting-stage > .ting-tile')).map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
      });
      overlap = false;
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]; const b = boxes[j];
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
            && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlap = true;
        }
      }
      const pastVw = boxes.some((t) => t.right > innerWidth + 0.5);
      const ratios = boxes.map((t) => (t.h > 0 ? t.w / t.h : 0));
      return {
        n: boxes.length,
        overlap,
        pastVw,
        scrollW: document.documentElement.scrollWidth,
        ratios,
        sizes: boxes.map((t) => Math.round(t.w) + 'x' + Math.round(t.h))
      };
    });
    check('mobile grid N=3: нет bbox-пересечений', !ginfo.overlap, JSON.stringify(ginfo.sizes));
    check('mobile grid N=3: не вылезает за viewport', !ginfo.pastVw && ginfo.scrollW <= 390 + 1, 'scrollW=' + ginfo.scrollW);
    const bad169 = (ginfo.ratios || []).filter((r) => Math.abs(r - 16 / 9) > TOL);
    check('mobile grid N=3: все тайлы ≈ 16:9', bad169.length === 0, JSON.stringify((ginfo.ratios || []).map((r) => r.toFixed(2))));
    await context.close();
  }

  /* ---- 4. Mobile landscape: сохраняем пропорции И размер (не схлопываемся) ---- */
  {
    const { context, page } = await openRoom({ width: 844, height: 390 }, '#/ting?view=room&slug=k7m2qx');
    const main = await box(page, '.ting-stage.speaker > .ting-tile:not(.is-pip)');
    const stage = await box(page, '.ting-stage.speaker');
    if (main) {
      check('landscape speaker: main ≈ 16:9', Math.abs(ratio(main.w, main.h) - 16 / 9) < TOL, 'ratio=' + ratio(main.w, main.h).toFixed(3));
      check('landscape speaker: main не схлопнут (ширина ≥ 200px, высота ≥ 110px)', main.w >= 200 && main.h >= 110, `w=${main.w.toFixed(1)} h=${main.h.toFixed(1)}`);
    }
    if (stage && main) {
      check('landscape speaker: main заполняет стейдж по высоте', main.h >= stage.h * 0.85,
        `main.h=${main.h.toFixed(1)} stage.h=${stage.h.toFixed(1)}`);
      const centered = Math.abs((main.left + main.w / 2) - (stage.left + stage.w / 2)) < 4;
      check('landscape speaker: main отцентрован по горизонтали', centered,
        `main.cx=${(main.left + main.w / 2).toFixed(1)} stage.cx=${(stage.left + stage.w / 2).toFixed(1)}`);
      check('landscape speaker: стейдж не вылезает за экран', stage.left >= -1 && stage.left + stage.w <= 845, JSON.stringify(stage));
    }
    const pip = await box(page, '.ting-stage.speaker > .ting-tile.is-pip');
    if (pip) check('landscape speaker: PiP ≈ 4:3', Math.abs(ratio(pip.w, pip.h) - 4 / 3) < TOL, 'ratio=' + ratio(pip.w, pip.h).toFixed(3));
    await page.evaluate(() => document.querySelector('[data-act="layout-toggle"]')?.click());
    await page.waitForTimeout(400);
    const ltiles = await page.evaluate(() => Array.from(document.querySelectorAll('.ting-stage > .ting-tile'))
      .map((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; }));
    const lbad = ltiles.filter((t) => Math.abs(ratio(t.w, t.h) - 16 / 9) > TOL || t.w < 80 || t.h < 45);
    check('landscape grid: все тайлы ≈ 16:9 и не схлопнуты', lbad.length === 0, JSON.stringify(ltiles.map((t) => `${Math.round(t.w)}x${Math.round(t.h)}`)));
    await context.close();
  }

  /* ---- 5. Tablet (1024x768): тайлы 16:9, без переполнения ---- */
  {
    const { context, page } = await openRoom({ width: 1024, height: 768 }, '#/ting?view=room&slug=k7m2qx');
    const main = await box(page, '.ting-stage.speaker > .ting-tile:not(.is-pip)');
    if (main) check('tablet speaker: main ≈ 16:9', Math.abs(ratio(main.w, main.h) - 16 / 9) < TOL, 'ratio=' + ratio(main.w, main.h).toFixed(3));
    await page.evaluate(() => document.querySelector('[data-act="layout-toggle"]')?.click());
    await page.waitForTimeout(400);
    const ttiles = await page.evaluate(() => Array.from(document.querySelectorAll('.ting-stage > .ting-tile'))
      .map((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; }));
    const tbad = ttiles.filter((t) => Math.abs(ratio(t.w, t.h) - 16 / 9) > TOL);
    check('tablet grid: все тайлы ≈ 16:9', tbad.length === 0, JSON.stringify(ttiles.map((t) => ratio(t.w, t.h).toFixed(2))));
    const over = ttiles.some((t) => t.w > 1024);
    check('tablet grid: нет переполнения по ширине', !over, JSON.stringify(ttiles.map((t) => Math.round(t.w))));
    await context.close();
  }

  /* ---- 6. Групповой режим «спикер» (3+): пин по ленте, снятие пина по центру, без лишнего PiP ---- */
  {
    const { context, page } = await openRoom({ width: 1280, height: 800 }, '#/ting?view=room&slug=k7m2qx&demo=group');
    check('group: в группе нет лишнего PiP', (await page.$$('.ting-stage > .ting-tile.is-pip')).length === 0, 'pips=' + (await page.$$('.ting-stage > .ting-tile.is-pip')).length);
    const stripTile = await box(page, '.ting-filmstrip .ting-tile.is-swappable');
    check('group: тайл ленты кликабелен (.is-swappable)', !!stripTile, JSON.stringify(stripTile));
    const before = await page.evaluate(() => document.querySelector('.ting-stage > .ting-tile:not(.is-pip)')?.dataset.id);
    const clicked = await page.evaluate(() => document.querySelector('.ting-filmstrip .ting-tile.is-swappable')?.dataset.id);
    if (stripTile && clicked) {
      await page.click('.ting-filmstrip .ting-tile.is-swappable');
      await page.waitForTimeout(350);
      const after = await page.evaluate(() => document.querySelector('.ting-stage > .ting-tile:not(.is-pip)')?.dataset.id);
      check('group: клик по тайлу ленты ставит выбранного в центр', after === clicked, `before=${before} clicked=${clicked} after=${after}`);
      const mainClickable = await page.evaluate(() => {
        const el = document.querySelector('.ting-stage > .ting-tile:not(.is-pip)');
        return !!(el && el.classList.contains('is-swappable'));
      });
      check('group: центральный тайл кликабелен для снятия пина', mainClickable, 'main.is-swappable=' + mainClickable);
      await page.click('.ting-stage > .ting-tile:not(.is-pip)');
      await page.waitForTimeout(350);
      const unpinned = await page.evaluate(() => document.querySelector('.ting-stage > .ting-tile:not(.is-pip)')?.dataset.id);
      check('group: клик по центру снимает пин', unpinned === before, `before=${before} pinned=${after} unpinned=${unpinned}`);
    }
    await context.close();
  }

  /* ---- 7. Мобильная группа: лента не перекрыта и кликабельна ---- */
  for (const vp of [{ width: 390, height: 844, label: 'portrait' }, { width: 844, height: 390, label: 'landscape' }]) {
    const { context, page } = await openRoom(vp, '#/ting?view=room&slug=k7m2qx&demo=group');
    const stripInfo = await page.evaluate(() => {
      const strip = document.querySelector('.ting-filmstrip');
      if (!strip) return null;
      const bar = document.querySelector('.ting-room-top');
      const barBox = bar ? bar.getBoundingClientRect() : null;
      const tiles = Array.from(strip.querySelectorAll('.ting-tile')).map((el) => {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const hit = document.elementFromPoint(cx, cy);
        return {
          id: el.dataset.id, w: +r.width.toFixed(1), h: +r.height.toFixed(1), top: +r.top.toFixed(1),
          hitSelf: !!(hit && (hit === el || el.contains(hit))),
          hitCls: hit ? String(hit.className || hit.tagName).slice(0, 40) : null
        };
      });
      return { barBottom: barBox ? +barBox.bottom.toFixed(1) : null, tiles };
    });
    if (!stripInfo || !stripInfo.tiles.length) {
      check(`mobile ${vp.label}: лента группы есть`, false, JSON.stringify(stripInfo));
    } else {
      check(`mobile ${vp.label}: лента группы есть`, true, JSON.stringify(stripInfo.tiles.map((t) => t.id)));
      const covered = stripInfo.barBottom != null && stripInfo.tiles.some((t) => t.top < stripInfo.barBottom - 1);
      check(`mobile ${vp.label}: лента не перекрыта верхним баром`, !covered, `barBottom=${stripInfo.barBottom} tops=${JSON.stringify(stripInfo.tiles.map((t) => t.top))}`);
      const notHit = stripInfo.tiles.filter((t) => !t.hitSelf);
      check(`mobile ${vp.label}: тайлы ленты кликабельны (elementFromPoint)`, notHit.length === 0,
        notHit.length ? 'перекрыты: ' + JSON.stringify(notHit) : 'все hitSelf');
      // реальный клик + пин
      const clicked = stripInfo.tiles[0].id;
      const before = await page.evaluate(() => document.querySelector('.ting-stage > .ting-tile')?.dataset.id);
      try {
        await page.click('.ting-filmstrip .ting-tile.is-swappable', { timeout: 3000 });
        await page.waitForTimeout(350);
        const after = await page.evaluate(() => document.querySelector('.ting-stage > .ting-tile')?.dataset.id);
        check(`mobile ${vp.label}: клик по ленте работает`, after === clicked, `before=${before} clicked=${clicked} after=${after}`);
      } catch (e) {
        check(`mobile ${vp.label}: клик по ленте работает`, false, 'click intercepted: ' + e.message.split('\n')[0]);
      }
    }
    await context.close();
  }

  /* ---- 8. Premium grid N=5/10/12/15: класс + 16:9 + нет native controls / HTTP ---- */
  for (const n of [5, 10, 12, 15]) {
    const { context, page } = await openRoom({ width: 1280, height: 800 }, '#/ting?view=room&slug=k7m2qx&n=' + n);
    await page.evaluate((nn) => {
      window.__TING_DEMO_N__ = nn;
      const btn = document.querySelector('[data-act="layout-toggle"]');
      if (document.querySelector('.ting-stage.speaker')) btn?.click();
      else { btn?.click(); btn?.click(); }
    }, n);
    await page.waitForTimeout(450);
    const info = await page.evaluate(() => {
      const stage = document.querySelector('.ting-stage');
      const tiles = Array.from(document.querySelectorAll('.ting-stage > .ting-tile')).map((el) => {
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height };
      });
      return {
        cls: stage ? stage.className : '',
        n: tiles.length,
        ratios: tiles.map((t) => (t.h > 0 ? t.w / t.h : 0)),
        controls: Array.from(document.querySelectorAll('.ting-tile video')).some((v) => v.controls),
        http: !!(document.body.innerText || '').match(/\bHTTP\s+\d+/)
      };
    });
    const expectCls = n <= 4 ? ('g' + n) : (n <= 6 ? 'g6' : (n <= 9 ? 'g9' : (n <= 10 ? 'g10' : 'g12')));
    check('desktop N=' + n + ': класс ' + expectCls, new RegExp('\\b' + expectCls + '\\b').test(info.cls), 'cls=' + info.cls);
    check('desktop N=' + n + ': число тайлов', info.n === n, 'n=' + info.n);
    const badR = (info.ratios || []).filter((r) => Math.abs(r - 16 / 9) > TOL);
    check('desktop N=' + n + ': все тайлы ≈ 16:9', badR.length === 0, JSON.stringify((info.ratios || []).map((r) => r.toFixed(2))));
    check('desktop N=' + n + ': нет native video.controls', !info.controls, 'controls=' + info.controls);
    check('desktop N=' + n + ': нет HTTP-тоста в viewport', !info.http, 'http=' + info.http);
    await context.close();
  }

  /* ---- 8b. Tablet 768 (≤820 → fit 2col) + laptop 1440 (desktop 16:9) grid N=9 ---- */
  for (const vp of [{ width: 768, height: 1024, label: 'tablet768', mobileFit: true }, { width: 1440, height: 900, label: 'laptop1440', mobileFit: false }]) {
    const { context, page } = await openRoom(vp, '#/ting?view=room&slug=k7m2qx&n=9');
    await page.evaluate(() => {
      window.__TING_DEMO_N__ = 9;
      const btn = document.querySelector('[data-act="layout-toggle"]');
      if (document.querySelector('.ting-stage.speaker')) btn?.click();
      else { btn?.click(); btn?.click(); }
    });
    await page.waitForTimeout(450);
    const info = await page.evaluate(() => {
      const stage = document.querySelector('.ting-stage');
      const sr = stage ? stage.getBoundingClientRect() : null;
      const tiles = Array.from(document.querySelectorAll('.ting-stage > .ting-tile')).map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
      });
      let overlap = false;
      for (let i = 0; i < tiles.length; i++) {
        for (let j = i + 1; j < tiles.length; j++) {
          const a = tiles[i]; const b = tiles[j];
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
            && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlap = true;
        }
      }
      return {
        n: tiles.length,
        ratios: tiles.map((t) => (t.h > 0 ? t.w / t.h : 0)),
        overlap,
        stageH: sr ? sr.height : 0
      };
    });
    check(vp.label + ' N=9: 9 тайлов', info.n === 9, 'n=' + info.n);
    const badR = (info.ratios || []).filter((r) => Math.abs(r - 16 / 9) > TOL);
    check(vp.label + ' N=9: ≈16:9', badR.length === 0, JSON.stringify((info.ratios || []).map((r) => r.toFixed(2))));
    if (vp.mobileFit) {
      check(vp.label + ' N=9: нет bbox-пересечений', !info.overlap, 'overlap');
      check(vp.label + ' N=9: stage не бесконечный (<2000px)', info.stageH < 2000, 'stageH=' + Math.round(info.stageH));
    }
    await context.close();
  }

  /* ---- 9. Speaker N=5: filmstrip не пустой, thumbs ≥72px ---- */
  {
    const { context, page } = await openRoom({ width: 1280, height: 800 }, '#/ting?view=room&slug=k7m2qx&n=5');
    const strip = await page.evaluate(() => {
      const tiles = Array.from(document.querySelectorAll('.ting-filmstrip .ting-tile'));
      return tiles.map((el) => {
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height, id: el.dataset.id };
      });
    });
    check('speaker N=5: лента ≥4 thumbs', strip.length >= 4, 'n=' + strip.length);
    const small = strip.filter((t) => t.w < 71 || t.h < 40);
    check('speaker N=5: thumbs ≥72px шириной', small.length === 0, JSON.stringify(strip));
    check('speaker N=5: нет PiP на стейдже', (await page.$$('.ting-stage > .ting-tile.is-pip')).length === 0, 'ok');
    await context.close();
  }

  /* ---- 10. Mobile N=5/12/15: fit + non-intersect + count chip ---- */
  for (const n of [5, 12, 15]) {
    const { context, page } = await openRoom({ width: 390, height: 844 }, '#/ting?view=room&slug=k7m2qx&n=' + n);
    await page.evaluate((nn) => {
      window.__TING_DEMO_N__ = nn;
      const btn = document.querySelector('[data-act="layout-toggle"]');
      if (document.querySelector('.ting-stage.speaker')) btn?.click();
      else { btn?.click(); btn?.click(); }
    }, n);
    await page.waitForTimeout(500);
    const info = await page.evaluate((nn) => {
      const stage = document.querySelector('.ting-stage');
      const sr = stage.getBoundingClientRect();
      const tiles = Array.from(document.querySelectorAll('.ting-stage > .ting-tile:not(.ting-tile--more)')).map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
      });
      let overlap = false;
      for (let i = 0; i < tiles.length; i++) {
        for (let j = i + 1; j < tiles.length; j++) {
          const a = tiles[i]; const b = tiles[j];
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
            && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlap = true;
        }
      }
      const chip = (document.querySelector('.ting-count-chip') || {}).textContent || '';
      const chipN = parseInt(String(chip).replace(/\D+/g, ''), 10) || 0;
      const dock = document.querySelector('.ting-dock');
      const dockTop = dock ? dock.getBoundingClientRect().top : 844;
      const underDock = tiles.some((t) => t.bottom > dockTop + 4);
      const ratios = tiles.map((t) => (t.h > 0 ? t.w / t.h : 0));
      const pastVw = tiles.some((t) => t.right > innerWidth + 0.5);
      return {
        n: tiles.length,
        overlap,
        stageH: sr.height,
        chip,
        chipN,
        cols: getComputedStyle(stage).gridTemplateColumns.split(' ').filter(Boolean).length,
        ratios,
        pastVw,
        scrollW: document.documentElement.scrollWidth,
        expect: nn
      };
    }, n);
    check('mobile N=' + n + ': число тайлов', info.n === n, 'n=' + info.n);
    check('mobile N=' + n + ': 2 колонки', info.cols === 2, 'cols=' + info.cols);
    check('mobile N=' + n + ': нет bbox-пересечений', !info.overlap, 'overlap');
    check('mobile N=' + n + ': count chip = N', info.chipN === n, 'chip=' + info.chip);
    const badR = (info.ratios || []).filter((r) => Math.abs(r - 16 / 9) > TOL);
    check('mobile N=' + n + ': все тайлы ≈ 16:9', badR.length === 0, JSON.stringify((info.ratios || []).map((r) => r.toFixed(2))));
    check('mobile N=' + n + ': нет полосы справа (scrollW≤390)', !info.pastVw && info.scrollW <= 391, 'scrollW=' + info.scrollW);
    await context.close();
  }

  /* ---- 11. Desktop count chip matches demo N ---- */
  {
    const { context, page } = await openRoom({ width: 1280, height: 800 }, '#/ting?view=room&slug=k7m2qx&n=10');
    await page.evaluate(() => {
      window.__TING_DEMO_N__ = 10;
      const btn = document.querySelector('[data-act="layout-toggle"]');
      if (document.querySelector('.ting-stage.speaker')) btn?.click();
      else { btn?.click(); btn?.click(); }
    });
    await page.waitForTimeout(450);
    const chip = await page.evaluate(() => (document.querySelector('.ting-count-chip') || {}).textContent || '');
    const nTiles = await page.evaluate(() => document.querySelectorAll('.ting-stage > .ting-tile').length);
    const chipN = parseInt(String(chip).replace(/\D+/g, ''), 10) || 0;
    check('desktop N=10: count chip = 10', chipN === 10 && nTiles === 10, 'chip=' + chip + ' tiles=' + nTiles);
    await context.close();
  }

  /* ---- 12. TV dual + g4: injector classes, no gallery overlap ---- */
  {
    const tvServer = await new Promise((resolve) => {
      const srv = http.createServer((req, res) => {
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        const file = path.join(root, 'public', urlPath.replace(/^\//, ''));
        if (!file.startsWith(path.join(root, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          res.writeHead(404); res.end('no'); return;
        }
        const ct = urlPath.endsWith('.css') ? 'text/css; charset=utf-8'
          : urlPath.endsWith('.js') ? 'application/javascript; charset=utf-8'
            : urlPath.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': ct });
        fs.createReadStream(file).pipe(res);
      });
      srv.listen(0, '127.0.0.1', () => resolve({ srv, base: 'http://127.0.0.1:' + srv.address().port }));
    });
    async function injectTv(page, count) {
      return page.evaluate((R) => {
        function hallModeFor(r) {
          if (r <= 0) return 'wait';
          if (r === 1) return 'spot';
          if (r === 2) return 'dual';
          if (r <= 7) return 'spot-rail';
          if (r <= 9) return 'g3';
          if (r <= 12) return 'g4';
          return 'g5';
        }
        const mode = hallModeFor(R);
        document.getElementById('startView')?.classList.add('hidden');
        document.getElementById('roomView')?.classList.remove('hidden');
        const stage = document.getElementById('stage');
        const strip = document.getElementById('filmstrip');
        stage.innerHTML = '';
        if (strip) { strip.innerHTML = ''; strip.classList.add('hidden'); }
        stage.className = 'ttv-stage hall hall-' + mode;
        const names = ['Зал', 'Никита', 'Елена', 'Андрей', 'Мария', 'Игорь', 'Ольга', 'Сергей', 'Анна', 'Дмитрий', 'Павел', 'Наталья'];
        const mk = (id, label, cls) => {
          const d = document.createElement('div');
          d.className = 'ttv-tile ' + cls;
          d.setAttribute('data-id', id);
          d.innerHTML = '<div class="ttv-av-fallback">' + label.slice(0, 1) + '</div><div class="ttv-lbl">' + label + '</div>';
          return d;
        };
        if (mode === 'dual') {
          stage.appendChild(mk('r1', names[1], 'is-gallery'));
          stage.appendChild(mk('r2', names[2], 'is-gallery'));
          stage.appendChild(mk('local', 'Зал', 'is-local is-self-pip'));
        } else {
          for (let i = 1; i <= R; i++) stage.appendChild(mk('r' + i, names[i] || ('Уч' + i), 'is-gallery'));
          stage.appendChild(mk('local', 'Зал', 'is-local is-self-pip'));
        }
        return mode;
      }, count);
    }
    for (const [R, label] of [[2, 'dual'], [12, 'g4']]) {
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const page = await context.newPage();
      await page.goto(tvServer.base + '/ting-tv/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(300);
      const mode = await injectTv(page, R);
      await page.waitForTimeout(200);
      const geom = await page.evaluate(() => {
        const gallery = Array.from(document.querySelectorAll('.ttv-stage > .ttv-tile.is-gallery'));
        const pip = document.querySelector('.ttv-stage > .ttv-tile.is-self-pip');
        const boxes = gallery.map((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        });
        let overlap = false;
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i]; const b = boxes[j];
            if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
              && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlap = true;
          }
        }
        return {
          galleryN: gallery.length,
          hasPip: !!pip,
          overlap,
          modeCls: document.getElementById('stage')?.className || ''
        };
      });
      check('TV ' + label + ': mode class', new RegExp('hall-' + (label === 'dual' ? 'dual' : 'g4')).test(geom.modeCls), geom.modeCls);
      check('TV ' + label + ': is-gallery плитки', geom.galleryN === R, 'n=' + geom.galleryN);
      check('TV ' + label + ': is-self-pip local', geom.hasPip, 'pip=' + geom.hasPip);
      check('TV ' + label + ': gallery без overlap', !geom.overlap, 'overlap');
      await context.close();
    }
    tvServer.srv.close();
  }

  await browser.close();
  server.close();

  const passed = results.filter((r) => r.ok).length;  console.log(`\n=== ${passed}/${results.length} PASS ===`);
  if (passed !== results.length) {
    console.log('FAILURES:');
    results.filter((r) => !r.ok).forEach((r) => console.log(' -', r.name, r.detail));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
