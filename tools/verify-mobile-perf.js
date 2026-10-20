'use strict';
/**
 * verify-mobile-perf.js — гейт производительности мобильного приложения.
 *
 * Проверяет:
 *  1. Бюджеты бандла: главный чанк и vendor-чанки не раздулись.
 *  2. Нет утечек таймеров: после ухода с экранов не остаётся «висящих» setTimeout
 *     (косвенно — по отсутствию ошибок React о setState после размонтирования).
 *  3. Нет дублирующих SSE-потоков сверх ожидаемого числа.
 *  4. Число blur-слоёв в кадре не превышает порога (тяжёлые backdrop-filter).
 *  5. Долгие задачи в кадре: время отклика навигации в пределах бюджета.
 *  6. Чистота консоли на ключевых экранах (0 ошибок).
 *
 * Запуск: node tools/verify-mobile-perf.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const jwt = require('jsonwebtoken');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'public', 'mobile-app', 'dist', 'assets');
const SECRET = 'asgard-jwt-secret-2026';
const BASE = process.env.BASE || 'http://127.0.0.1:5173';

/** Бюджеты (КБ gzip считается по сырому размеру — консервативно). */
const BUDGET = {
  mainChunkKB: 200,      // главный index-*.js
  threeKB: 900,          // vendor-three
  totalAssetsMB: 12,     // вся папка assets
};

const ROUTES = ['/', '/tasks', '/works', '/more', '/director-approvals', '/personnel', '/warehouse', '/finances'];

let fails = 0;
const ok = (m) => console.log('  ok   ' + m);
const bad = (m) => { console.log('  FAIL ' + m); fails++; };

(async () => {
  console.log('=== verify-mobile-perf ===');

  // ─── 1. Бюджеты бандла ──────────────────────────────────────────────────────
  console.log('\n[1] Бюджеты бандла');
  if (!fs.existsSync(DIST)) {
    bad('нет папки dist — сначала npm run build');
  } else {
    const files = fs.readdirSync(DIST).filter((f) => /\.(js|css)$/.test(f));
    const size = (f) => fs.statSync(path.join(DIST, f)).size;
    const main = files.filter((f) => /^index-.*\.js$/.test(f));
    const three = files.filter((f) => /^vendor-three.*\.js$/.test(f));
    const total = files.reduce((s, f) => s + size(f), 0);

    const mainKB = Math.round(Math.max(0, ...main.map(size)) / 1024);
    const threeKB = Math.round(Math.max(0, ...three.map(size)) / 1024);
    const totalMB = +(total / 1024 / 1024).toFixed(1);

    (mainKB <= BUDGET.mainChunkKB ? ok : bad.bind(null, 'главный чанк ' + mainKB + ' КБ > ' + BUDGET.mainChunkKB))('главный чанк: ' + mainKB + ' КБ (лимит ' + BUDGET.mainChunkKB + ')');
    (threeKB <= BUDGET.threeKB ? ok : bad.bind(null, 'vendor-three ' + threeKB + ' КБ > ' + BUDGET.threeKB))('vendor-three: ' + threeKB + ' КБ (лимит ' + BUDGET.threeKB + ')');
    (totalMB <= BUDGET.totalAssetsMB ? ok : bad.bind(null, 'ассеты ' + totalMB + ' МБ > ' + BUDGET.totalAssetsMB))('всего ассетов: ' + totalMB + ' МБ (лимит ' + BUDGET.totalAssetsMB + ')');
    console.log('       чанков всего: ' + files.length);
  }

  // ─── 2–6. Рантайм ───────────────────────────────────────────────────────────
  const b = await chromium.launch();
  const token = jwt.sign({ id: 3455, login: 'ok', name: 'Д', role: 'DIRECTOR_GEN', email: 'x@a.com', pinVerified: true }, SECRET);
  const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.addInitScript(({ t }) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('asgard_theme', 'dark');
    localStorage.setItem('field_auth_epoch', '6');
    localStorage.setItem('asgard_mobile_banner_dismissed_v1', '1');
  }, { t: token });
  const p = await ctx.newPage();

  // Считаем EventSource-потоки через подмену конструктора.
  await p.addInitScript(() => {
    window.__sseCount = 0;
    const Orig = window.EventSource;
    window.EventSource = function (...args) {
      window.__sseCount++;
      return new Orig(...args);
    };
    window.EventSource.prototype = Orig.prototype;
  });

  const consoleErrors = [];
  p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 90)); });
  p.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message.slice(0, 90)));

  console.log('\n[2] Навигация: отклик и ошибки');
  let worstNav = 0;
  for (const r of ROUTES) {
    const t0 = Date.now();
    await p.goto(BASE + '/m' + r, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await p.waitForTimeout(1900);
    const ms = Date.now() - t0;
    if (ms > worstNav) worstNav = ms;
  }
  (worstNav < 6000 ? ok : bad.bind(null, 'медленная навигация ' + worstNav + ' мс'))('худшая навигация с ожиданием: ' + worstNav + ' мс');
  const realErrors = consoleErrors.filter((e) => !/503|401|502|Failed to load resource/i.test(e));
  (realErrors.length === 0 ? ok : bad.bind(null, 'ошибки консоли: ' + realErrors.slice(0, 3).join(' | ')))('JS-ошибок: ' + realErrors.length);

  console.log('\n[3] SSE-потоки и blur-слои');
  const runtime = await p.evaluate(() => {
    const sse = window.__sseCount || 0;
    // Активные blur-слои: элементы с необнулённым backdrop-filter в видимой части.
    let blur = 0;
    for (const el of document.querySelectorAll('*')) {
      const s = getComputedStyle(el);
      const bf = s.backdropFilter || s.webkitBackdropFilter;
      if (bf && bf !== 'none') {
        const r = el.getBoundingClientRect();
        if (r.height > 4 && r.bottom > 0 && r.top < window.innerHeight) blur++;
      }
    }
    return { sse, blur };
  });
  (runtime.sse <= 2 ? ok : bad.bind(null, 'SSE-потоков ' + runtime.sse + ' (ожидается ≤2)'))('SSE-потоков: ' + runtime.sse);
  (runtime.blur <= 12 ? ok : bad.bind(null, 'blur-слоёв ' + runtime.blur + ' > 12'))('blur-слоёв в кадре: ' + runtime.blur);

  console.log('\n[4] Плавность скролла (кадры)');
  await p.goto(BASE + '/m/more', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2200);
  const fps = await p.evaluate(async () => {
    const sc = document.querySelector('.scroll-container');
    if (!sc) return null;
    sc.style.scrollBehavior = 'auto';
    let frames = 0;
    const t0 = performance.now();
    return await new Promise((resolve) => {
      function tick() {
        frames++;
        sc.scrollTop += 24;
        if (performance.now() - t0 < 1200 && sc.scrollTop + sc.clientHeight < sc.scrollHeight) requestAnimationFrame(tick);
        else resolve(Math.round((frames / (performance.now() - t0)) * 1000));
      }
      requestAnimationFrame(tick);
    });
  });
  if (fps === null) console.log('       скролл не найден — пропуск');
  else (fps >= 40 ? ok : bad.bind(null, 'скролл ' + fps + ' fps < 40'))('плавность скролла: ' + fps + ' fps');

  // ─── 5. Утечки таймеров ─────────────────────────────────────────────────────
  console.log('\n[5] Утечки после ухода с экранов');
  await p.goto(BASE + '/m/mimir-estimate/999999', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await p.waitForTimeout(2000);
  await p.goto(BASE + '/m/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  const afterErrors = consoleErrors.filter((e) => /unmounted|memory leak|setState/i.test(e));
  (afterErrors.length === 0 ? ok : bad.bind(null, 'предупреждения об утечке: ' + afterErrors.slice(0, 2).join(' | ')))('предупреждений об утечке: ' + afterErrors.length);

  console.log('\nИТОГ: ' + (fails === 0 ? 'OK — бюджеты и плавность в норме' : 'FAIL — ' + fails + ' нарушений'));
  await b.close();
  process.exit(fails === 0 ? 0 : 1);
})();
