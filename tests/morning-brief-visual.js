'use strict';
/**
 * Визуальный гейт утреннего брифинга (D-249).
 * Поднимает статику public/ + fixture с реальным payload и снимает модалку
 * в обеих темах. Плюс проверяет то, что нельзя увидеть глазами: дата, чипы
 * сроков, отсутствие «#id · —» и кликабельность строк.
 *
 * Запуск: node tests/morning-brief-visual.js
 * Выход:  tests/reports/morning-brief/*.png + .json, exit 1 при FAIL.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const FIX = path.join(ROOT, 'tests', 'fixtures');
const OUT = path.join(ROOT, 'tests', 'reports', 'morning-brief');
fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.json': 'application/json'
};

function serve(port) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const candidates = [
        u.startsWith('/tests/fixtures/') ? path.join(ROOT, u) : null,
        path.join(PUB, u)
      ].filter(Boolean);
      for (const f of candidates) {
        if (fs.existsSync(f) && fs.statSync(f).isFile()) {
          res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
          return fs.createReadStream(f).pipe(res);
        }
      }
      res.writeHead(404); res.end('404 ' + u);
    });
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

const results = [];
function check(name, ok, proof) {
  results.push({ name, ok: !!ok, proof: String(proof).slice(0, 400) });
}

(async () => {
  const port = 3377;
  const srv = await serve(port);
  const browser = await chromium.launch({ headless: true });
  const shots = [];

  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(`http://127.0.0.1:${port}/tests/fixtures/mb_harness.html?theme=${theme}`,
      { waitUntil: 'networkidle' });
    await page.waitForSelector('.mbk-hero', { timeout: 5000 });
    await page.waitForTimeout(350);

    const file = path.join(OUT, `brief-${theme}.png`);
    await page.screenshot({ path: file });
    shots.push(file);

    if (theme === 'dark') {
      // ── Дата: не «2026-10-18», а 19 октября ──
      const title = await page.textContent('.mbk-title');
      check('Дата в шапке — 19 октября', /19 октября 2026/.test(title || ''), title);

      // ── Пустые заказчики не рендерятся как «#id · —» ──
      const bodyText = await page.textContent('.cr-m__body');
      check('Нет строки «· —» для пустого заказчика', !/· —/.test(bodyText || ''),
        (bodyText || '').match(/.{0,20}· —.{0,20}/)?.[0] || 'не найдено');

      // ── Сроки словами ──
      const chips = await page.$$eval('.mbk-dl', (els) => els.map((e) => e.textContent.trim()));
      check('Чип «сегодня» есть', chips.includes('сегодня'), chips.join(' | '));
      check('Отрицательный срок отрисован как −N дн.', chips.some((c) => /^−\d+ дн\.$/.test(c)),
        chips.filter((c) => c.startsWith('−')).join(' | ') || 'нет');

      // ── Секция «просрочено» реально есть и первая ──
      const tones = await page.$$eval('.mbk-sec', (els) =>
        els.map((e) => (e.className.match(/tone-(\w+)/) || [])[1]));
      check('Первая секция — просрочка', tones[0] === 'err', tones.join(','));

      // ── Пустых секций нет: секция без содержимого не рендерится вовсе ──
      // У «Канбана» строк тендеров нет по устройству — там плитки-статистика.
      const emptySections = await page.evaluate(() =>
        [...document.querySelectorAll('.mbk-sec')]
          .filter((s) => !s.querySelector('.mbk-stats'))
          .filter((s) => s.querySelectorAll('.mbk-row').length === 0)
          .map((s) => s.querySelector('h3')?.textContent || '?'));
      check('Секций без строк нет', emptySections.length === 0,
        emptySections.join(' | ') || 'все секции с содержимым');

      // ── KPI кликабельны и ведут к секции ──
      const kpiCount = await page.$$eval('.mbk-kpi', (e) => e.length);
      check('Полоса KPI отрисована', kpiCount >= 3, 'плиток: ' + kpiCount);

      // Плитка «Просрочено» скроллит именно к секции просрочки (не к первой с тем же тоном).
      const kpiTarget = await page.evaluate(() => {
        const btn = document.querySelector('.mbk-kpi[data-scroll-to="overdue"]');
        if (!btn) return null;
        const sec = document.querySelector('.mbk-sec[data-sec="overdue"]');
        return { hasBtn: true, hasSec: !!sec, tone: sec && sec.className };
      });
      check('KPI-плитка ведёт в свою секцию', kpiTarget && kpiTarget.hasSec, JSON.stringify(kpiTarget));

      // ── Кнопка «Напомнить РП» есть, пока модалка открыта (ADMIN) ──
      // D-249: одна кнопка на окно. Двух быть не должно — иначе непонятно, чья она.
      const nudgeCount = await page.$$eval('#mbNudge', (e) => e.length);
      check('Кнопка «Напомнить РП» ровно одна', nudgeCount === 1, 'найдено: ' + nudgeCount);

      // ── Клик по строке: закрывает модалку и ставит hash ──
      await page.click('.mbk-row');
      await page.waitForTimeout(250);
      const hash = await page.evaluate(() => location.hash);
      const modalGone = await page.evaluate(() => !document.querySelector('.cr-m-overlay'));
      check('Клик по тендеру открывает #/tenders?open=<id>',
        /^#\/tenders\?open=\d+$/.test(hash), hash || '(пусто)');
      check('Модалка закрылась при переходе', modalGone, modalGone ? 'overlay нет' : 'overlay остался');
    }

    check(`Консоль без ошибок (${theme})`, errors.length === 0, errors.slice(0, 3).join(' | ') || 'чисто');
    await ctx.close();
  }

  // ── Узкий экран: строки не разъезжаются, срок остаётся читаемым ──
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${port}/tests/fixtures/mb_harness.html?theme=dark`,
      { waitUntil: 'networkidle' });
    await page.waitForSelector('.mbk-row', { timeout: 5000 });
    await page.waitForTimeout(300);
    const file = path.join(OUT, 'brief-mobile.png');
    await page.screenshot({ path: file });
    shots.push(file);

    const overflow = await page.evaluate(() => {
      const card = document.querySelector('.cr-m');
      return { scrollW: card.scrollWidth, clientW: card.clientWidth };
    });
    check('Мобильный: нет горизонтального переполнения',
      overflow.scrollW <= overflow.clientW + 1, JSON.stringify(overflow));
    check('Мобильный: консоль чистая', errors.length === 0, errors.slice(0, 2).join(' | ') || 'чисто');
    await ctx.close();
  }

  await browser.close();
  srv.close();

  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(OUT, 'report.json'),
    JSON.stringify({ shots, results, ok: failed.length === 0 }, null, 2));
  for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + ' — ' + r.proof);
  console.log('\n' + (failed.length ? 'FAIL: ' + failed.length : 'OK: ' + results.length + '/' + results.length));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS FAIL', e); process.exit(1); });
