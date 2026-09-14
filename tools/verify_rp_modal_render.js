#!/usr/bin/env node
/**
 * verify_rp_modal_render.js — браузерный гейт модалки просчёта РП (просчёт/анализ).
 *
 * Зачем (D-150 + батч B):
 *   В проде модалку просчёта РП нельзя было проскроллить, а вокруг чисел KPI были
 *   «круглые рамки». Причина скролла — каскад: `.cr-m-overlay:has(.rp-calc-modal)`
 *   получал `align-items: stretch`, из-за чего модалка фиксировалась в высоту overlay.
 *   Отдельная ловушка: `.rp-calc-modal{overflow:visible}` перебивал по порядку
 *   `.rp-calc-modal--embedded{overflow:hidden}` (одинаковая специфичность 0,1,0),
 *   потому что элемент несёт ОБА класса (rp_calc_modal.js:479). Текстовый grep такое
 *   не ловит — ловит только вычисленный стиль в браузере.
 *
 * Что делает:
 *   1. Берёт ПОРЯДОК подключения CSS из public/index.html (это и есть каскад).
 *   2. Собирает стенд с реальной цепочкой DOM:
 *      .cr-m-overlay > .cr-m.cr-m--fullscreen > .cr-m__body#modalBody > .rp-calc-modal
 *      (как в public/assets/js/ui.js:108-176 и rp_calc_modal.js:479-504).
 *   3. Открывает стенд в chromium (Playwright) и МЕРЯЕТ getComputedStyle + скролл.
 *
 * Гейты (все обязаны быть зелёными, иначе exit 1):
 *   G1 overlay .cr-m-overlay:has(.rp-calc-modal) → align-items: flex-start
 *   G2 .rp-calc-modal (fullscreen, без --embedded) → overflow: visible
 *   G3 .rp-calc-modal + .rp-calc-modal--embedded одновременно → overflow: hidden
 *   G4 длинный контент: футер достижим скроллом (модалку не режет)
 *   G5 короткий контент: модалка занимает высоту, но не раздувается за экран
 *   G6 KPI сметы/футера: нет рамки и заливки (border-width 0, фон прозрачный)
 *   G7 «Дежурство» .pm-duty-kpi рамку СОХРАНИЛО (не сломали чужой скоуп)
 *   G8 золотой цвет .is-gold b сохранён и отличается от обычного
 *
 * Использование: node tools/verify_rp_modal_render.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const INDEX = path.join(PUBLIC, 'index.html');

const C = { red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', off: '\x1b[0m' };
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? C.green + 'PASS' : C.red + 'FAIL'}${C.off}  ${name}${detail ? C.dim + '  — ' + detail + C.off : ''}`);
}

// ── 1. Порядок CSS как в index.html ────────────────────────────────────────
const html = fs.readFileSync(INDEX, 'utf8');
const cssOrder = [];
for (const m of html.matchAll(/<link\b[^>]*?\bhref\s*=\s*["']([^"']+\.css)(?:\?[^"']*)?["']/gi)) {
  const rel = m[1].replace(/^\.?\//, '');
  if (/^https?:/i.test(rel)) continue;
  const abs = path.join(PUBLIC, rel);
  if (fs.existsSync(abs) && !cssOrder.includes(abs)) cssOrder.push(abs);
}
if (!cssOrder.length) {
  console.error(C.red + 'В public/index.html не найдено ни одного подключённого CSS — гейт бессмыслен.' + C.off);
  process.exit(1);
}
console.log(`${C.dim}CSS в порядке каскада (${cssOrder.length}): ${cssOrder.map((p) => path.relative(PUBLIC, p)).join(' → ')}${C.off}\n`);

const linkTags = cssOrder
  .map((p) => `<link rel="stylesheet" href="file:///${p.replace(/\\/g, '/').replace(/ /g, '%20')}">`)
  .join('\n');

// ── 2. Стенд ───────────────────────────────────────────────────────────────
function smetaRows(n) {
  let rows = '';
  for (let i = 1; i <= n; i++) {
    rows += `<tr><td>${i}</td><td>Статья номер ${i}</td><td>шт</td><td class="num">1</td><td class="num">1 000</td><td class="num">1 000</td></tr>`;
  }
  return rows;
}

function harness(bodyRows) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
${linkTags}
<style>html,body{margin:0}body{background:#0b0f14;color:#e6e8ee;font-family:sans-serif}</style>
</head><body>
<div class="cr-m-overlay modalback cr-m-overlay--visible" id="ov">
  <div class="cr-m modal cr-m--fullscreen" id="md">
    <div class="cr-m__topline"></div>
    <div class="cr-m__header mh"><div class="cr-m__title">Просчёт</div></div>
    <div class="cr-m__body mc" id="modalBody">
      <div class="rp-calc-modal" id="rp" data-rp-calc-root="1">
        <div class="rp-calc-hero">
          <div class="rp-calc-hero__main">
            <div class="rp-calc-hero__kicker">АСГАРД · ПРОСЧЁТ</div>
            <h2 class="rp-calc-hero__title">Просчёт</h2>
            <div class="rp-calc-hero__sub"><span>№ <b>1836</b></span><span>Заказчик</span></div>
          </div>
          <div class="rp-calc-hero__side"><span class="rp-calc-badge">РП</span></div>
        </div>
        <div class="rp-calc-tabs-wrap"><div class="rp-calc-tabs" role="tablist">
          <button type="button" class="rp-calc-tab is-active">Смета</button>
          <button type="button" class="rp-calc-tab">Файлы</button>
        </div></div>
        <div class="rp-calc-body" id="rpBody">
          <div class="rp-calc-smeta-wrap"><table class="rp-calc-smeta">
            <thead><tr><th>Код</th><th>Статья</th><th>Ед.</th><th class="num">Кол-во</th><th class="num">Цена</th><th class="num">Сумма</th></tr></thead>
            <tbody>${smetaRows(bodyRows)}</tbody></table>
            <div class="rp-calc-smeta-totals">
              <div class="kpi" id="kpiCost"><span>Себестоимость</span><b>1 000 ₽</b></div>
              <div class="kpi" id="kpiNoVat"><span>Без НДС</span><b>2 000 ₽</b></div>
              <div class="kpi is-gold" id="kpiVat"><span>С НДС</span><b>2 400 ₽</b></div>
            </div>
          </div>
        </div>
        <div class="rp-calc-footer" id="ftr">
          <div class="rp-calc-footer__kpis">
            <div class="rp-calc-footer__kpi" id="fkCost"><span>Себестоимость</span><b>1 000 ₽</b></div>
            <div class="rp-calc-footer__kpi" id="fkNoVat"><span>Цена без НДС</span><b>2 000 ₽</b></div>
            <div class="rp-calc-footer__kpi is-gold" id="fkVat"><span>Цена с НДС</span><b>2 400 ₽</b></div>
          </div>
          <div class="rp-calc-footer__acts"><button type="button" class="btn ghost">Сохранить черновик</button></div>
        </div>
      </div>
    </div>
  </div>
</div>
<div class="pm-duty-page"><div class="pm-duty-kpi" id="dutyKpi"><span>Дежурство</span><b>7</b></div></div>
</body></html>`;
}

const TALL = 140;
const SHORT = 2;
const tallPath = path.join(os.tmpdir(), 'asgard-rp-modal-tall.html');
const shortPath = path.join(os.tmpdir(), 'asgard-rp-modal-short.html');
fs.writeFileSync(tallPath, harness(TALL), 'utf8');
fs.writeFileSync(shortPath, harness(SHORT), 'utf8');

// ── 3. Измерения в chromium ────────────────────────────────────────────────
const MEASURE = `(() => {
  const cs = (el) => el ? getComputedStyle(el) : null;
  const ov = document.getElementById('ov');
  const rp = document.getElementById('rp');
  const emb = document.getElementById('emb') || (() => {
    // Проверяем «двойной класс» на живом узле: как в rp_calc_modal.js:479.
    const clone = rp.cloneNode(false);
    clone.id = 'emb';
    clone.className = 'rp-calc-modal rp-calc-modal--embedded';
    document.body.appendChild(clone);
    return document.getElementById('emb');
  })();
  const ftr = document.getElementById('ftr');
  const ovCs = cs(ov), rpCs = cs(rp), embCs = cs(emb);
  const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height }; };

  // Скроллим контейнер-скроллер (overlay) до упора и смотрим, достижим ли футер.
  const before = box(ftr);
  ov.scrollTop = ov.scrollHeight;
  const after = box(ftr);

  const kpi = (id) => { const e = document.getElementById(id); const c = cs(e); return {
    id, borderTop: c.borderTopWidth, borderStyle: c.borderTopStyle, bg: c.backgroundColor, shadow: c.boxShadow,
  }; };
  const colorOf = (id) => cs(document.querySelector('#' + id + ' b')).color;

  return {
    overlayAlign: ovCs.alignItems,
    overlayOverflowY: ovCs.overflowY,
    overlayScrollable: ov.scrollHeight > ov.clientHeight + 1,
    overlayScrollHeight: ov.scrollHeight, overlayClientHeight: ov.clientHeight,
    modalOverflow: rpCs.overflow,
    embeddedOverflow: embCs.overflow,
    modalH: box(rp).h, modalScrollH: rp.scrollHeight,
    wrapH: box(document.getElementById('md')).h,
    footerBefore: before, footerAfter: after,
    viewportH: window.innerHeight,
    kpiCost: kpi('kpiCost'), kpiNoVat: kpi('kpiNoVat'), fkCost: kpi('fkCost'), fkNoVat: kpi('fkNoVat'),
    duty: kpi('dutyKpi'),
    goldSmeta: colorOf('kpiVat'), plainSmeta: colorOf('kpiCost'),
    goldFooter: colorOf('fkVat'), plainFooter: colorOf('fkCost'),
  };
})()`;

(async () => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    console.error(C.red + 'Не найден playwright. Установи: npm i -D playwright && npx playwright install chromium' + C.off);
    process.exit(1);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  // ── Длинный контент ──
  await page.goto('file:///' + tallPath.replace(/\\/g, '/'));
  await page.waitForTimeout(250);
  const tall = await page.evaluate(MEASURE);

  // ── Короткий контент ──
  await page.goto('file:///' + shortPath.replace(/\\/g, '/'));
  await page.waitForTimeout(250);
  const short = await page.evaluate(MEASURE);

  await browser.close();

  console.log(`\n${C.dim}viewport=800; длинный контент: overlay scrollHeight=${tall.overlayScrollHeight} clientHeight=${tall.overlayClientHeight}; ` +
    `футер до скролла bottom=${Math.round(tall.footerBefore.bottom)} → после скролла bottom=${Math.round(tall.footerAfter.bottom)}${C.off}\n`);

  // ── G1..G8 ──
  check('G1 overlay align-items = flex-start (скролл overlay работает)', tall.overlayAlign === 'flex-start', `получено: ${tall.overlayAlign}`);
  check('G2 .rp-calc-modal (fullscreen) overflow = visible', tall.modalOverflow === 'visible', `получено: ${tall.modalOverflow}`);
  check('G3 .rp-calc-modal + --embedded (оба класса) overflow = hidden', tall.embeddedOverflow === 'hidden', `получено: ${tall.embeddedOverflow}`);

  check('G4 длинный контент: overlay реально скроллится', tall.overlayScrollable, `${tall.overlayScrollHeight} > ${tall.overlayClientHeight}`);
  check('G4 длинный контент: футер достижим после скролла',
    tall.footerAfter.bottom <= tall.viewportH + 2 && tall.footerAfter.bottom > 0,
    `footer.bottom=${Math.round(tall.footerAfter.bottom)} при viewport=${tall.viewportH}`);

  check('G5 короткий контент: fullscreen-обёртка занимает высоту экрана', short.wrapH >= short.viewportH * 0.95, `wrap.h=${Math.round(short.wrapH)} при viewport=${short.viewportH}`);
  check('G5 короткий контент: модалка не выше экрана', short.modalH <= short.viewportH + 2, `modal.h=${Math.round(short.modalH)} при viewport=${short.viewportH}`);
  check('G5 короткий контент: лишнего скролла нет (не раздувается)', !short.overlayScrollable, `scrollHeight=${short.overlayScrollHeight} clientHeight=${short.overlayClientHeight}`);

  for (const [nm, k] of [['KPI сметы (себестоимость)', tall.kpiCost], ['KPI сметы (без НДС)', tall.kpiNoVat], ['KPI футера (себестоимость)', tall.fkCost], ['KPI футера (без НДС)', tall.fkNoVat]]) {
    check(`G6 ${nm}: без рамки`, k.borderTop === '0px', `border-top=${k.borderTop} ${k.borderStyle}`);
    check(`G6 ${nm}: без заливки`, k.bg === 'rgba(0, 0, 0, 0)' || k.bg === 'transparent', `background=${k.bg}`);
  }
  check('G7 .pm-duty-kpi рамку сохранил (чужой скоуп не сломан)', tall.duty.borderTop !== '0px', `border-top=${tall.duty.borderTop} ${tall.duty.borderStyle} bg=${tall.duty.bg}`);

  check('G8 смета: золото .is-gold b сохранено', tall.goldSmeta !== tall.plainSmeta, `gold=${tall.goldSmeta} vs plain=${tall.plainSmeta}`);
  check('G8 футер: золото .is-gold b сохранено', tall.goldFooter !== tall.plainFooter, `gold=${tall.goldFooter} vs plain=${tall.plainFooter}`);

  const failed = results.filter((r) => !r.ok);
  console.log('');
  if (failed.length) {
    console.log(C.red + `ИТОГ: FAIL — ${failed.length} из ${results.length} проверок провалено` + C.off);
    process.exit(1);
  }
  console.log(C.green + `ИТОГ: OK — ${results.length}/${results.length} проверок пройдено (chromium, реальные CSS в порядке index.html)` + C.off);
  process.exit(0);
})().catch((e) => {
  console.error(C.red + 'Гейт упал с ошибкой: ' + e.message + C.off);
  process.exit(1);
});
