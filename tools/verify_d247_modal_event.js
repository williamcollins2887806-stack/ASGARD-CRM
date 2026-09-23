#!/usr/bin/env node
/**
 * verify_d247_modal_event.js — независимый chromium-гейт дефекта D-247
 * («e.querySelector is not a function» в `hideModal`).
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ (и почему это не харнесс, а проверка дефекта):
 *   Правило проекта — «чинит один агент, сертифицирует ДРУГОЙ». Гейт для D-247
 *   нельзя писать в `ui.js` или в `verify_rp_modal_render.js`: первый — предмет
 *   проверки, второй — чужая зона. Здесь проверяется ТОЛЬКО контракт:
 *
 *   D-247 (диагноз): кнопка закрытия подписывалась как `addEventListener('click', hideModal)`.
 *   Браузер передаёт первым аргументом MouseEvent, `if(overlay)` считал его overlay'ем и
 *   `$(".cr-m", target)` → `e.querySelector is not a function` (31 живое событие 21–23.09,
 *   прод, `ui.js?v=20.28.47`).
 *
 * Гейты (дискриминирующие: на СТАРОМ коде обязаны падать):
 *   G1 showModal возвращает рабочий overlay (стек = 1) — база, без неё остальное бессмысленно
 *   G2 клик по `.cr-m__close` закрывает модалку и НЕ бросает исключение  ← ядро D-247
 *   G3 клик по оверлею (мимо модалки) не бросает исключение
 *   G4 Escape закрывает модалку без исключения
 *   G5 hideModal(): после закрытия DOM очищен, повторный вызов — no-op без исключения
 *   G6 мутация: hideModal(MouseEvent) → закрывает верхнюю, без исключения  ← ядро D-247
 *   G7 мутация: hideModal(HTMLButtonElement) → закрывает верхнюю, без исключения
 *   G8 мутация: hideModal({тег-мусор}) → закрывает верхнюю, без исключения
 *   G9 мутация: hideModal(overlay) → закрывает ИМЕННО его (стек не перепутан)
 *   G10 два модалки: закрытие верхней не ломает нижнюю
 *
 * Источник истины — ФАКТИЧЕСКИЙ `public/assets/js/ui.js` (читается с диска, не переписывается).
 * Запуск: node tools/verify_d247_modal_event.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
// По умолчанию — рабочая версия. Можно указать другую (напр. `git show HEAD:...` во временный файл),
// чтобы доказать, что гейт ДИСКРИМИНИРУЮЩИЙ: на старом коде он обязан упасть.
const UI = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'public', 'assets', 'js', 'ui.js');

const C = { red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', off: '\x1b[0m' };
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? C.green + 'PASS' : C.red + 'FAIL'}${C.off}  ${name}${detail ? C.dim + '  — ' + detail + C.off : ''}`);
}

// `hideModal` снимает overlay отложенно (setTimeout 300 мс, анимация .cr-m-overlay--leaving).
// Поэтому «закрыто» проверяем по ДВУМ сигналам: синхронный класс --leaving (hideModal дошёл
// до конца, а не упал на первом шаге) и фактическое удаление из DOM после паузы.
const REMOVE_WAIT = 450;
function leaving(el) {
  return !!(el && el.classList && el.classList.contains('cr-m-overlay--leaving'));
}

if (!fs.existsSync(UI)) {
  console.error(C.red + `нет ${UI}` + C.off);
  process.exit(1);
}
const uiSrc = fs.readFileSync(UI, 'utf8');

// Статический маркер: `hideModal` нормализует аргумент (иначе динамика не имеет источника).
check('ui.js содержит нормализацию аргумента hideModal (D-247)',
  /_isOverlay\s*\(/.test(uiSrc) || /currentTarget/.test(uiSrc),
  /_isOverlay\s*\(/.test(uiSrc) ? '_isOverlay найдена' : 'нет _isOverlay/currentTarget');

// Стенд: ui.js на file:// (скрипт самодостаточен, внешних зависимостей на загрузке нет).
const standPath = path.join(os.tmpdir(), `_d247_stand_${process.pid}.html`);
fs.writeFileSync(standPath, `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<style>html,body{margin:0}.cr-m-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5)}</style>
</head><body>
<script src="file:///${UI.replace(/\\/g, '/').replace(/ /g, '%20')}"></script>
</body></html>`, 'utf8');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (_) {
  console.error(C.red + 'нет playwright. Установка: npm i -D playwright && npx playwright install chromium' + C.off);
  fs.rmSync(standPath, { force: true });
  process.exit(1);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // Любое исключение страницы = провал (именно это и есть дефект).
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()); });

  await page.goto('file:///' + standPath.replace(/\\/g, '/'));

  const hasUi = await page.evaluate(() => !!(window.AsgardUI && typeof window.AsgardUI.showModal === 'function'));
  check('AsgardUI загрузился в chromium', hasUi, hasUi ? 'showModal есть' : 'нет window.AsgardUI');
  if (!hasUi) {
    await browser.close();
    fs.rmSync(standPath, { force: true });
    console.log(C.red + '\nИТОГ: FAIL — стенд не поднялся' + C.off);
    process.exit(1);
  }

  // ── G1: showModal отдаёт рабочий overlay ──
  const g1 = await page.evaluate(() => {
    const ov = window.AsgardUI.showModal({ title: 'D-247 G1', html: '<p>тест</p>' });
    return { ok: !!(ov && ov.classList && ov.classList.contains('cr-m-overlay')), overlays: document.querySelectorAll('.cr-m-overlay').length };
  });
  check('G1 showModal возвращает overlay (.cr-m-overlay), стек = 1', g1.ok && g1.overlays === 1,
    `ok=${g1.ok} overlays=${g1.overlays}`);

  // ── G2: клик по кнопке закрытия (ядро D-247) ──
  const g2 = await page.evaluate(() => {
    const before = document.querySelectorAll('.cr-m-overlay').length;
    const ov = document.querySelector('.cr-m-overlay');
    const btn = document.querySelector('.cr-m-overlay .cr-m__close');
    if (!btn) return { err: 'кнопка .cr-m__close не найдена', before };
    let threw = '';
    try { btn.click(); } catch (e) { threw = String(e && e.message || e); }
    return {
      before, threw,
      leaving: !!(ov && ov.classList.contains('cr-m-overlay--leaving')),
      inStack: document.querySelectorAll('.cr-m-overlay').length
    };
  });
  await page.waitForTimeout(REMOVE_WAIT);
  const g2after = await page.evaluate(() => document.querySelectorAll('.cr-m-overlay').length);
  check('G2 клик по .cr-m__close запускает закрытие и не бросает',
    !g2.err && !g2.threw && g2.leaving && g2after === 0,
    g2.err ? g2.err : `before=${g2.before} leaving=${g2.leaving} after=${g2after}${g2.threw ? ' threw=' + g2.threw : ''}`);

  // ── G3: клик по оверлею мимо модалки (oops-bubble) ──
  const g3 = await page.evaluate(() => {
    window.AsgardUI.showModal({ title: 'D-247 G3', html: '<p>тест</p>' });
    const ov = document.querySelector('.cr-m-overlay');
    let threw = '';
    try { ov.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 })); } catch (e) { threw = String(e && e.message || e); }
    return { threw, overlays: document.querySelectorAll('.cr-m-overlay').length };
  });
  check('G3 клик по оверлею не бросает исключение', !g3.threw, g3.threw ? 'threw=' + g3.threw : `overlays=${g3.overlays}`);

  // ── G4: Escape ──
  const g4 = await page.evaluate(() => {
    window.AsgardUI.hideModal();
    const ov = window.AsgardUI.showModal({ title: 'D-247 G4', html: '<p>тест</p>' });
    let threw = '';
    try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (e) { threw = String(e && e.message || e); }
    return { threw, leaving: !!(ov && ov.classList.contains('cr-m-overlay--leaving')) };
  });
  await page.waitForTimeout(REMOVE_WAIT);
  const g4after = await page.evaluate(() => ({ overlays: document.querySelectorAll('.cr-m-overlay').length, stale: document.querySelectorAll('.cr-m-overlay--leaving').length }));
  check('G4 Escape закрывает верхнюю модалку без исключения', !g4.threw && g4.leaving && g4after.overlays === 0,
    g4.threw ? 'threw=' + g4.threw : `leaving=${g4.leaving} after=${g4after.overlays}`);

  // ── G5: hideModal() идемпотентен и DOM чист ──
  const g5 = await page.evaluate(() => {
    window.AsgardUI.hideModal(); // очистка от возможных остатков
    const ov = window.AsgardUI.showModal({ title: 'D-247 G5', html: '<p>тест</p>' });
    window.AsgardUI.hideModal();
    const leaving = !!(ov && ov.classList.contains('cr-m-overlay--leaving'));
    let threw = '';
    try { window.AsgardUI.hideModal(); window.AsgardUI.hideModal(); } catch (e) { threw = String(e && e.message || e); }
    return { threw, leaving };
  });
  await page.waitForTimeout(REMOVE_WAIT);
  const g5after = await page.evaluate(() => document.querySelectorAll('.cr-m-overlay').length);
  check('G5 hideModal(): повторный вызов — no-op без исключения', !g5.threw && g5.leaving && g5after === 0,
    g5.threw ? 'threw=' + g5.threw : `leaving=${g5.leaving} after=${g5after}`);

  // ── G6/G7/G8: МУТАЦИИ аргумента — то, что делал старый addEventListener ──
  const mutation = async (argExpr) => {
    const r = await page.evaluate(({ argExprSrc }) => {
      window.AsgardUI.hideModal();
      const ov = window.AsgardUI.showModal({ title: 'D-247 mutation', html: '<p>тест</p>' });
      let arg;
      // eslint-disable-next-line no-eval
      arg = eval(argExprSrc);
      let threw = '';
      try { window.AsgardUI.hideModal(arg); } catch (e) { threw = String(e && e.message || e); }
      return { threw, leaving: !!(ov && ov.classList.contains('cr-m-overlay--leaving')) };
    }, { argExprSrc: argExpr });
    await page.waitForTimeout(REMOVE_WAIT);
    const after = await page.evaluate(() => document.querySelectorAll('.cr-m-overlay').length);
    return { threw: r.threw, leaving: r.leaving, after };
  };

  const g6 = await mutation('new MouseEvent("click", { bubbles: true })');
  check('G6 hideModal(MouseEvent) закрывает верхнюю, без исключения', !g6.threw && g6.leaving && g6.after === 0,
    g6.threw ? 'threw=' + g6.threw : `leaving=${g6.leaving} after=${g6.after}`);

  const g7 = await mutation('(() => { const b = document.createElement("button"); document.body.appendChild(b); return b; })()');
  check('G7 hideModal(HTMLButtonElement) закрывает верхнюю, без исключения', !g7.threw && g7.leaving && g7.after === 0,
    g7.threw ? 'threw=' + g7.threw : `leaving=${g7.leaving} after=${g7.after}`);

  const g8 = await mutation('({ nodeType: 3, foo: 1 })');
  check('G8 hideModal(объект-мусор) закрывает верхнюю, без исключения', !g8.threw && g8.leaving && g8.after === 0,
    g8.threw ? 'threw=' + g8.threw : `leaving=${g8.leaving} after=${g8.after}`);

  // ── G9: hideModal(overlay) закрывает ИМЕННО переданный ──
  const g9 = await page.evaluate(() => {
    window.AsgardUI.hideModal();
    const a = window.AsgardUI.showModal({ title: 'A', html: '<p>a</p>' });
    let threw = '';
    try { window.AsgardUI.hideModal(a); } catch (e) { threw = String(e && e.message || e); }
    return { threw, aLeaving: !!(a && a.classList.contains('cr-m-overlay--leaving')) };
  });
  await page.waitForTimeout(REMOVE_WAIT);
  const g9after = await page.evaluate(() => document.querySelectorAll('.cr-m-overlay').length);
  check('G9 hideModal(overlay) закрывает переданный overlay', !g9.threw && g9.aLeaving && g9after === 0,
    g9.threw ? 'threw=' + g9.threw : `aLeaving=${g9.aLeaving} осталось=${g9after}`);

  // ── G10: два модалки — закрытие верхней не ломает нижнюю ──
  const g10 = await page.evaluate(() => {
    window.AsgardUI.hideModal();
    const lower = window.AsgardUI.showModal({ title: 'lower', html: '<p>lower</p>' });
    const upper = window.AsgardUI.showModal({ title: 'upper', html: '<p>upper</p>' });
    let threw = '';
    try { upper.querySelector('.cr-m__close').click(); } catch (e) { threw = String(e && e.message || e); }
    return {
      threw,
      upperLeaving: !!(upper && upper.classList.contains('cr-m-overlay--leaving')),
      lowerLeaving: !!(lower && lower.classList.contains('cr-m-overlay--leaving')),
      total: document.querySelectorAll('.cr-m-overlay').length
    };
  });
  await page.waitForTimeout(REMOVE_WAIT);
  const g10after = await page.evaluate(() => ({
    lowerAlive: !!document.querySelector('.cr-m-overlay'),
    total: document.querySelectorAll('.cr-m-overlay').length
  }));
  check('G10 закрытие верхней модалки сохраняет нижнюю',
    !g10.threw && g10.upperLeaving && !g10.lowerLeaving && g10after.total === 1,
    g10.threw ? 'threw=' + g10.threw : `upperLeaving=${g10.upperLeaving} lowerLeaving=${g10.lowerLeaving} after=${g10after.total}`);

  // ── Ошибки страницы: любая = провал ядра D-247 ──
  const realErrors = pageErrors.filter((e) => /querySelector is not a function|is not a function/i.test(e));
  check('в chromium нет ошибок «is not a function» за весь прогон', realErrors.length === 0,
    realErrors.length ? realErrors.slice(0, 2).join(' | ') : `всего pageerror/console.error: ${pageErrors.length}`);

  await browser.close();
  fs.rmSync(standPath, { force: true });

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.log(C.red + `\nИТОГ: FAIL — ${failed.length}/${results.length} проверок не прошли (D-247 не закрыт)` + C.off);
    process.exit(1);
  }
  console.log(C.green + `\nИТОГ: OK — ${results.length}/${results.length} проверок пройдено (chromium, реальный ui.js)` + C.off);
  process.exit(0);
})().catch((err) => {
  try { fs.rmSync(standPath, { force: true }); } catch (_) { /* ignore */ }
  console.error(C.red + 'FATAL: ' + (err && err.stack || err) + C.off);
  process.exit(1);
});
