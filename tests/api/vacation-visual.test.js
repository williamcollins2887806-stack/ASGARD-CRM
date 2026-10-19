/**
 * Визуальная сверка прод-страницы графика отпусков с утверждённым рендер-прототипом
 * + регрессии, найденные на стенде 19.10.2026:
 *   • модалка должна накрывать ВЕСЬ экран (была 884px из-за transform на .main);
 *   • оверлей выбора темы не должен висеть поверх интерфейса и глушить клики;
 *   • 1280×720 без горизонтальной прокрутки;
 *   • 0 JS-ошибок.
 *
 * Сравниваем СТРУКТУРУ и КОМПОЗИЦИЮ (шрифты/темы разные — пиксельная сверка даст ложные FAIL).
 * Запуск: node tests/api/vacation-visual.test.js
 * Требует клон-сервер (TEST_BASE_URL / CLONE_URL, по умолчанию :3100).
 */
const { chromium } = require('playwright');
const cfg = require('../config');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'reports', 'visual-parity');
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (e ? ' :: ' + e : '')); } };

(async () => {
  const BASE = cfg.BASE_URL;
  const token = await cfg.getToken('PM');
  const b = await chromium.launch();

  async function openPage(viewport) {
    const ctx = await b.newContext({ viewport });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSERR ' + m.text().slice(0, 140)); });
    await p.addInitScript((t) => { try { localStorage.setItem('asgard_token', t); } catch (_) {} }, token);
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 40000 });
    await p.waitForFunction(() => !!(window.AsgardAuth && AsgardAuth.getAuth && AsgardAuth.getAuth()), { timeout: 30000 }).catch(() => {});
    await p.evaluate(() => { location.hash = '#/vacation-schedule'; }).catch(() => {});
    // Ждём РЕАЛЬНОЙ отрисовки: страница грузит данные по API, и на нагруженном
    // клон-сервере это может занять больше обычного. Пробуем несколько раз.
    for (let attempt = 0; attempt < 3; attempt++) {
      await p.waitForFunction(
        () => document.querySelectorAll('.vs-mon--head').length >= 12 && document.querySelectorAll('.vs-row').length > 0,
        { timeout: 25000 }
      ).catch(() => {});
      const ok = await p.evaluate(() => document.querySelectorAll('.vs-mon--head').length >= 12);
      if (ok) break;
      await p.waitForTimeout(1500);
      await p.evaluate(() => { location.hash = '#/home'; }).catch(() => {});
      await p.waitForTimeout(500);
      await p.evaluate(() => { location.hash = '#/vacation-schedule'; }).catch(() => {});
    }
    await p.waitForTimeout(800);
    return { p, ctx, errs };
  }

  const { p, errs } = await openPage({ width: 1440, height: 900 });

  // ── 1. Структура как в макете ───────────────────────────────────────────
  const struct = await p.evaluate(() => ({
    accs: document.querySelectorAll('.vs-acc').length,
    monHeads: document.querySelectorAll('.vs-mon--head').length,
    rows: document.querySelectorAll('.vs-row').length,
    legend: document.querySelectorAll('.vs-legend, .vs-lg').length,
    groups: Array.from(document.querySelectorAll('.vs-group__t')).map((e) => e.textContent.trim()),
    hideButtons: document.querySelectorAll('.vs-hide').length,
    hasBalance: /Можно взять/i.test(document.body.innerText),
    hasCarryOver: /отгулено/i.test(document.body.innerText),
    hasDeadline: /1 ноября|1 декабря/i.test(document.body.innerText),
    hasHoliday: /праздник/i.test(document.body.innerText),
  }));
  console.log('STRUCT=' + JSON.stringify(struct));

  check('3 щита баланса', struct.accs === 3, 'accs=' + struct.accs);
  check('12 месяцев сверху', struct.monHeads >= 12, 'mon=' + struct.monHeads);
  check('строки сотрудников', struct.rows >= 10, 'rows=' + struct.rows);
  check('легенда статусов', struct.legend >= 5, 'legend=' + struct.legend);
  check('«Можно взять»', struct.hasBalance);
  check('«отгулено» (перенос)', struct.hasCarryOver);
  check('плашка сроков 1 ноября/1 декабря', struct.hasDeadline);
  check('праздники в интерфейсе', struct.hasHoliday);
  check('кнопки «скрыть»', struct.hideButtons >= 5, 'hide=' + struct.hideButtons);
  check('первая группа — Дирекция', (struct.groups[0] || '').includes('Дирекция'), struct.groups[0]);
  check('есть группа Руководители проектов', struct.groups.some((g) => /Руководители/.test(g)), JSON.stringify(struct.groups));

  // ── 2. Модалка полноэкранная (регрессия: было 884px) ────────────────────
  const stageSize = () => p.evaluate(() => {
    const st = document.querySelector('.vs-stage');
    if (!st) return null;
    const r = st.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), sw: window.innerWidth, sh: window.innerHeight };
  });
  check('модалка накрывает экран (до смены темы)',
    JSON.stringify(await stageSize()) === JSON.stringify({ ...(await stageSize()), w: (await stageSize()).sw, h: (await stageSize()).sh }),
    JSON.stringify(await stageSize()));

  // ── 3. Оверлей темы не перекрывает интерфейс ────────────────────────────
  const blocker = await p.evaluate(() => {
    const el = document.getElementById('asgard-theme-selector');
    const m = document.querySelector('.vs-mon--head');
    let top = null;
    if (m) {
      const r = m.getBoundingClientRect();
      const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      top = e ? String(e.className || e.tagName) : null;
    }
    return { themeOverlay: !!el, topOverMonth: top };
  });
  check('оверлей выбора темы не перекрывает график', !blocker.themeOverlay, JSON.stringify(blocker));
  check('клик по месяцу попадает в месяц', !blocker.topOverMonth || /vs-/.test(blocker.topOverMonth), JSON.stringify(blocker));

  // ── 4. Раскрытие месяца + возврат темы (именно тут ломалось) ────────────
  await p.evaluate(() => { const m = document.querySelector('.vs-mon--head'); if (m) m.click(); });
  await p.waitForTimeout(800);
  const openInfo = await p.evaluate(() => ({
    open: document.querySelectorAll('.vs-days--head').length,
    days: document.querySelectorAll('.vs-days__nm .vs-d--hd').length,
  }));
  check('раскрыт ровно один месяц', openInfo.open === 1, 'open=' + openInfo.open);
  check('дни месяца отрисованы (28–31)', openInfo.days >= 28, 'days=' + openInfo.days);

  await p.evaluate(() => { const h = document.querySelector('.vs-days--head'); if (h) h.click(); });
  await p.waitForTimeout(700);
  check('повторный клик скрывает месяц', (await p.evaluate(() => document.querySelectorAll('.vs-days--head').length)) === 0);

  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await p.waitForTimeout(800);
  const lightSize = await stageSize();
  check('модалка полноэкранная в СВЕТЛОЙ теме',
    lightSize && lightSize.w === lightSize.sw && lightSize.h === lightSize.sh, JSON.stringify(lightSize));
  await p.screenshot({ path: path.join(OUT, 'prod-1440-light.png') });

  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await p.waitForTimeout(800);
  const darkSize = await stageSize();
  check('модалка полноэкранная после ВОЗВРАТА в тёмную (регрессия)',
    darkSize && darkSize.w === darkSize.sw && darkSize.h === darkSize.sh, JSON.stringify(darkSize));
  await p.screenshot({ path: path.join(OUT, 'prod-1440-dark.png') });

  check('нет JS-ошибок', errs.filter((e) => !/Failed to load resource/.test(e)).length === 0,
    errs.slice(0, 4).join(' || ') || 'clean');
  await p.context().close();

  // ── 5. 1280×720 ─────────────────────────────────────────────────────────
  const { p: p2, errs: errs2 } = await openPage({ width: 1280, height: 720 });
  await p2.evaluate(() => { const m = document.querySelector('.vs-mon--head'); if (m) m.click(); }).catch(() => {});
  await p2.waitForTimeout(900);
  const fit = await p2.evaluate(() => {
    const w = document.querySelector('.vs-tablewrap') || document.querySelector('.vs-modal');
    return { sw: w ? w.scrollWidth : 0, cw: w ? w.clientWidth : 0 };
  });
  check('1280×720: раскрытый месяц без горизонтальной прокрутки', fit.sw <= fit.cw + 4, JSON.stringify(fit));
  check('1280×720: нет JS-ошибок', errs2.filter((e) => !/Failed to load resource/.test(e)).length === 0,
    errs2.slice(0, 3).join(' || ') || 'clean');
  await p2.screenshot({ path: path.join(OUT, 'prod-1280-dark.png') });
  await p2.context().close();

  await b.close();
  console.log('\n' + (fail ? `FAILS: ${fail}` : 'ALL PASS') + ` (${pass} проверок)`);
  console.log('Скриншоты: ' + OUT);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH ' + e.message + '\n' + (e.stack || '')); process.exit(1); });
