'use strict';
/**
 * check_ui_esc_topmost.js — регрессия общей модалки AsgardUI после правки Esc.
 *
 * Правка: ui.js больше не закрывает свою модалку, если СВЕРХУ есть pk3-слой
 * (Quick/Кондуктор личного канбана с большим z-index). Иначе один Esc снимал
 * два окна сразу.
 *
 * Что проверяем (чтобы «не сломали чужое»):
 *   U1 одиночная модалка: Esc закрывает (штатное поведение);
 *   U2 две модалки ui.js: Esc закрывает только верхнюю;
 *   U3 модалка поверх: showModal дважды → hideModal возвращает нижнюю;
 *   U4 клик по фону по-прежнему не закрывает (историческое поведение);
 *   U5 нет JS-ошибок.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const UI_JS = path.join(PUBLIC, 'assets', 'js', 'ui.js');
const C = { red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', off: '\x1b[0m' };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? C.green + 'PASS' : C.red + 'FAIL'}${C.off}  ${name}${detail ? C.dim + '  — ' + detail + C.off : ''}`);
}

const page = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<link rel="stylesheet" href="file:///${path.join(PUBLIC, 'assets/css/app.css').replace(/\\/g, '/')}">
</head><body>
<script src="file:///${UI_JS.replace(/\\/g, '/')}"></script>
</body></html>`;

(async () => {
  const browser = await chromium.launch();
  const errs = [];
  const p = path.join(os.tmpdir(), 'ui-esc.html');
  fs.writeFileSync(p, page, 'utf8');
  const br = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  br.on('pageerror', (e) => errs.push(String(e.message || e)));
  await br.goto('file:///' + p.replace(/\\/g, '/'));
  await br.waitForFunction(() => !!window.AsgardUI, null, { timeout: 15000 });

  // U1 — одиночная модалка закрывается по Esc.
  await br.evaluate(() => window.AsgardUI.showModal({ title: 'Одна', html: '<p>x</p>' }));
  await br.waitForTimeout(200);
  const u1before = await br.evaluate(() => document.querySelectorAll('.cr-m-overlay').length);
  await br.keyboard.press('Escape');
  await br.waitForTimeout(300);
  const u1after = await br.evaluate(() => document.querySelectorAll('.cr-m-overlay').length);
  check('U1 одиночная модалка закрывается по Esc',
    u1before === 1 && u1after === 0, `${u1before} → ${u1after}`);

  // U2 — две модалки: Esc снимает только верхнюю.
  await br.evaluate(() => {
    window.AsgardUI.showModal({ title: 'Нижняя', html: '<p>1</p>' });
    window.AsgardUI.showModal({ title: 'Верхняя', html: '<p>2</p>' });
  });
  await br.waitForTimeout(250);
  const u2before = await br.evaluate(() => document.querySelectorAll('.cr-m-overlay').length);
  await br.keyboard.press('Escape');
  await br.waitForTimeout(300);
  const u2after = await br.evaluate(() => document.querySelectorAll('.cr-m-overlay').length);
  check('U2 две модалки: Esc снимает только верхнюю',
    u2before === 2 && u2after === 1, `${u2before} → ${u2after}`);

  // U3 — повторный Esc снимает оставшуюся.
  await br.keyboard.press('Escape');
  await br.waitForTimeout(300);
  const u3after = await br.evaluate(() => document.querySelectorAll('.cr-m-overlay').length);
  check('U3 второй Esc снимает следующую модалку', u3after === 0, `осталось ${u3after}`);

  // U4 — клик по фону не закрывает (историческое поведение ui.js).
  await br.evaluate(() => window.AsgardUI.showModal({ title: 'Фон', html: '<p>z</p>' }));
  await br.waitForTimeout(200);
  const ov = await br.$('.cr-m-overlay');
  if (ov) {
    const box = await ov.boundingBox();
    if (box) await br.mouse.click(box.x + 6, box.y + 6);
  }
  await br.waitForTimeout(250);
  const u4after = await br.evaluate(() => document.querySelectorAll('.cr-m-overlay').length);
  check('U4 клик по фону модалку не закрывает (поведение не изменено)', u4after === 1, `модалок=${u4after}`);

  check('U5 нет JS-ошибок', errs.length === 0, errs.length ? errs.slice(0, 2).join(' | ') : '0');

  await br.close();
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log('');
  if (failed.length) {
    console.log(C.red + `ИТОГ: FAIL — ${failed.length} из ${results.length}` + C.off);
    process.exit(1);
  }
  console.log(C.green + `ИТОГ: OK — ${results.length}/${results.length} (настоящий ui.js в chromium)` + C.off);
  process.exit(0);
})().catch((e) => {
  console.error(C.red + 'Упало: ' + (e && e.stack || e) + C.off);
  process.exit(1);
});
