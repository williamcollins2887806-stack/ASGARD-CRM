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
    await page.click('[data-act="layout-toggle"]');
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

  /* ---- 3. Mobile portrait: один столбец, тайлы 16:9, PiP влезает ---- */
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
    await page.click('[data-act="layout-toggle"]');
    await page.waitForTimeout(400);
    const gcols = await page.evaluate(() => getComputedStyle(document.querySelector('.ting-stage')).gridTemplateColumns.split(' ').filter(Boolean).length);
    check('mobile grid: один столбец', gcols === 1, 'cols=' + gcols);
    const gtiles = await page.evaluate(() => Array.from(document.querySelectorAll('.ting-stage > .ting-tile'))
      .map((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; }));
    const gbad = gtiles.filter((t) => Math.abs(ratio(t.w, t.h) - 16 / 9) > TOL);
    check('mobile grid: все тайлы ≈ 16:9', gbad.length === 0, JSON.stringify(gtiles.map((t) => ratio(t.w, t.h).toFixed(2))));
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
    await page.click('[data-act="layout-toggle"]');
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
    await page.click('[data-act="layout-toggle"]');
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
