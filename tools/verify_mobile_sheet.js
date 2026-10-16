/**
 * verify_mobile_sheet.js — гейт мобильных модалок (D-267)
 *
 * Ловит регресс именно тех дефектов, из-за которых рабочие жаловались:
 *  «панель браузера скрывает кнопки», «модалку нельзя закрыть», «выкидывает при вводе».
 *
 * ЧАСТЬ A (статика по прод-сборке) — быстро, детерминированно:
 *   A1  public/m/index.html содержит #modal-root (портал вне #root);
 *   A2  viewport содержит interactive-widget=resizes-content;
 *   A3  @keyframes pageTransitionIn БЕЗ transform  (иначе fixed внутри ломается);
 *   A4  @keyframes pageSlideIn      БЕЗ transform;
 *   A5  в собранном CSS есть .sheet-surface и .sheet-close;
 *   A6  в собранном JS используется портал в 'modal-root'.
 *
 * ЧАСТЬ B (рантайм в chromium, реальный собранный CSS):
 *   B1  fixed-шторка остаётся на границе вьюпорта при 3 позициях скролла
 *       (даже когда предок имеет `animation: pageTransitionIn ... both`);
 *   B2  центр CTA проходит hit-test (elementFromPoint === сама кнопка);
 *   B3  шторка закрывается 4 способами: «×», «Отмена», Escape, тап по подложке;
 *   B4  обычный скролл формы (палец вниз внутри .body) шторку НЕ закрывает;
 *   B5  свайп вниз за грабер шторку ЗАКРЫВАЕТ.
 *
 * Запуск: node tools/verify_mobile_sheet.js
 * Exit 1 при любом провале.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const M_DIR = path.join(ROOT, 'public', 'm');
const CSS_DIR = path.join(M_DIR, 'assets');

const results = [];
function check(id, name, ok, evidence) {
  results.push({ id, name, ok: !!ok, evidence });
}

function readIndexHtml() {
  return fs.readFileSync(path.join(M_DIR, 'index.html'), 'utf8');
}

function findBuiltCss() {
  const files = fs.readdirSync(CSS_DIR).filter((f) => /^index-.*\.css$/.test(f));
  if (!files.length) return null;
  // самый свежий
  files.sort((a, b) =>
    fs.statSync(path.join(CSS_DIR, b)).mtimeMs - fs.statSync(path.join(CSS_DIR, a)).mtimeMs);
  return path.join(CSS_DIR, files[0]);
}

function findBuiltJs() {
  const files = fs.readdirSync(CSS_DIR).filter((f) => /\.js$/.test(f));
  return files.map((f) => path.join(CSS_DIR, f));
}

/** Вырезает тело @keyframes <name>{...} с учётом вложенных скобок. */
function keyframesBody(css, name) {
  const idx = css.indexOf(`@keyframes ${name}`);
  if (idx < 0) return null;
  let i = css.indexOf('{', idx);
  if (i < 0) return null;
  let depth = 0;
  const start = i;
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') { depth--; if (depth === 0) return css.slice(start, i + 1); }
  }
  return null;
}

async function main() {
  // ─────────────── ЧАСТЬ A ───────────────
  const html = readIndexHtml();

  check('A1', '#modal-root в public/m/index.html',
    /id="modal-root"/.test(html),
    /id="modal-root"/.test(html) ? 'найден' : 'ОТСУТСТВУЕТ — портал некуда монтировать');

  const viewportOk = /interactive-widget=resizes-content/.test(html);
  check('A2', 'viewport: interactive-widget=resizes-content', viewportOk,
    viewportOk ? 'найден' : 'нет — клавиатура не сжимает layout viewport на Android');

  const cssPath = findBuiltCss();
  if (!cssPath) {
    check('A3', 'собранный CSS найден', false, 'нет public/m/assets/index-*.css');
  } else {
    const css = fs.readFileSync(cssPath, 'utf8');
    const cssName = path.basename(cssPath);

    const pt = keyframesBody(css, 'pageTransitionIn');
    const ptHasTransform = pt ? /transform\s*:/.test(pt) : null;
    check('A3', '@keyframes pageTransitionIn без transform',
      pt !== null && ptHasTransform === false,
      pt === null ? 'ключевые кадры не найдены' :
        (ptHasTransform ? `ЕСТЬ transform → fixed сломается. ${cssName}: ${pt.slice(0, 120)}`
          : `ок, ${cssName}: ${pt.slice(0, 90)}`));

    const ps = keyframesBody(css, 'pageSlideIn');
    const psHasTransform = ps ? /transform\s*:/.test(ps) : null;
    check('A4', '@keyframes pageSlideIn без transform',
      ps !== null && psHasTransform === false,
      ps === null ? 'ключевые кадры не найдены' :
        (psHasTransform ? `ЕСТЬ transform → fixed сломается. ${ps.slice(0, 120)}`
          : `ок: ${ps.slice(0, 90)}`));

    const hasSurface = /\.sheet-surface/.test(css);
    const hasClose = /\.sheet-close/.test(css);
    check('A5', 'CSS: .sheet-surface и .sheet-close', hasSurface && hasClose,
      `sheet-surface=${hasSurface} sheet-close=${hasClose}`);
  }

  const jsFiles = findBuiltJs();
  let portalFound = false;
  let portalFile = '';
  for (const f of jsFiles) {
    const c = fs.readFileSync(f, 'utf8');
    if (c.includes('modal-root')) { portalFound = true; portalFile = path.basename(f); break; }
  }
  check('A6', "портал в 'modal-root' в собранном JS", portalFound,
    portalFound ? `найден в ${portalFile}` : 'не найден — модалки рендерятся в потоке');

  // ─────────────── ЧАСТЬ C: инварианты РЕАЛЬНОГО исходника BottomSheet ───────────────
  // Часть B работает на фикстуре и не видит регрессий в самом компоненте,
  // поэтому ключевые инварианты проверяем по исходнику.
  const BS_PATH = path.join(ROOT, 'public', 'mobile-app', 'src', 'components', 'shared', 'BottomSheet.jsx');
  if (!fs.existsSync(BS_PATH)) {
    check('C0', 'BottomSheet.jsx найден', false, BS_PATH);
  } else {
    const src = fs.readFileSync(BS_PATH, 'utf8');
    const flat = src.replace(/\s+/g, ' ');

    // C1 — свайп только за грабер (регресс: жест на всей шторке закрывал её при скролле формы)
    const usesGrabber = /grabberRef/.test(src) && /addEventListener\('touchmove'/.test(src);
    const gestureOnWholeSheet = /onTouchStart=/.test(src);
    check('C1', 'свайп-закрытие только за грабер (нет onTouchStart на шторке)',
      usesGrabber && !gestureOnWholeSheet,
      `grabber+touchmove=${usesGrabber} onTouchStart-на-шторке=${gestureOnWholeSheet}`);

    // C2 — фокус-эффект НЕ зависит от onClose (регресс P0: при вводе фокус «убегал» на «×»)
    const focusDepsBad = /\[open,\s*onClose\]/.test(flat);
    const hasOnCloseRef = /onCloseRef/.test(src);
    check('C2', 'эффект фокуса не зависит от идентичности onClose',
      !focusDepsBad && hasOnCloseRef,
      `deps[open,onClose]=${focusDepsBad} onCloseRef=${hasOnCloseRef}`);

    // C3 — кнопка закрытия в шапке
    check('C3', 'кнопка закрытия с aria-label="Закрыть"',
      /aria-label="Закрыть"/.test(src),
      /aria-label="Закрыть"/.test(src) ? 'есть' : 'НЕТ');

    // C4 — нет дублирующей безусловной «Отмена» (в 6–7 шторках своя кнопка в теле).
    // Ищем признак КНОПКИ, а не упоминание в комментариях.
    const noCancelButton = !/(>|children:\s*)Отмена/.test(src);
    check('C4', 'нет безусловной кнопки «Отмена» (чтобы не дублировать кнопку в теле шторки)',
      noCancelButton,
      noCancelButton ? 'ок' : 'найдена кнопка «Отмена» — риск дубля');

    // C5 — портал
    check('C5', 'createPortal в getModalRoot()',
      /createPortal\(content,\s*root\)/.test(flat) && /getModalRoot/.test(src),
      `createPortal=${/createPortal\(content,\s*root\)/.test(flat)} getModalRoot=${/getModalRoot/.test(src)}`);

    // C6 — пассивный слушатель: touchmove должен быть { passive: false }, иначе preventDefault не работает
    check('C6', "touchmove зарегистрирован как { passive: false }",
      /'touchmove',\s*onMove,\s*\{\s*passive:\s*false\s*\}/.test(flat),
      /'touchmove',\s*onMove,\s*\{\s*passive:\s*false\s*\}/.test(flat) ? 'ок' : 'не найден / пассивный');
  }

  // ─────────────── ЧАСТЬ B ───────────────
  let chromium;
  try { ({ chromium, devices } = require('playwright')); }
  catch (e) {
    check('B0', 'playwright доступен', false, 'нет модуля playwright — часть B пропущена');
  }

  if (chromium && cssPath) {
    const css = fs.readFileSync(cssPath, 'utf8');

    // Фикстура повторяет НОВУЮ структуру BottomSheet: портал в #modal-root,
    // sheet-surface, sheet-close, грабер с touch-action:none.
    // Предок намеренно имеет animation:pageTransitionIn ... both (как в App.jsx) —
    // проверяем, что при ЭТОМ fixed больше не ломается, потому что transform убран.
    const FIXTURE = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<style>
/* ==== РЕАЛЬНЫЙ собранный CSS приложения ==== */
${css}
/* ==== окружение, как в App.jsx ==== */
html,body{margin:0;height:100%}
body{overflow:hidden;background:#0a0a0c;color:#fff;font:14px system-ui}
.app-anim{animation:pageTransitionIn 180ms cubic-bezier(.4,0,.2,1) both;height:100%}
.layout{height:100%;display:flex;flex-direction:column}
.layout-scroll{flex:1;overflow:auto;padding:16px}
.card{height:120px;border:1px solid #222;border-radius:12px;margin-bottom:10px;background:#141418}
.body-scroll{overflow-y:auto;max-height:200px}
</style></head><body>
<div id="root"><div class="app-anim"><div class="layout">
  <div class="layout-scroll" id="scroller">
    ${Array.from({ length: 20 }, (_, i) => `<div class="card">Карточка ${i + 1}</div>`).join('')}
  </div>
</div></div></div>
<div id="modal-root"></div>
<script>
window.__closes = 0;
window.__open = false;
function openSheet(){
  window.__open = true;
  var sheet = document.createElement('div');
  sheet.className = 'fixed inset-0';
  sheet.style.zIndex = '10060';
  sheet.innerHTML =
    '<div class="absolute inset-0" id="backdrop" style="background:rgba(0,0,0,.5)"></div>' +
    '<div id="sheet" role="dialog" aria-modal="true" tabindex="-1" ' +
      'class="absolute bottom-0 left-0 right-0 sheet-surface" style="max-height:85vh;padding-bottom:16px">' +
      '<div class="flex justify-center pt-3 pb-1" id="grabber" style="touch-action:none">' +
        '<div class="w-9 h-1 rounded-full" style="background:#555"></div></div>' +
      '<div class="px-5 pb-3 flex items-start gap-2">' +
        '<h3 class="text-lg font-bold flex-1">Исправить данные</h3>' +
        '<button type="button" class="sheet-close" id="xBtn" aria-label="Закрыть">&#10005;</button></div>' +
      '<div class="px-5 body-scroll" id="body">' +
        '<label>Размер одежды</label><select><option>44</option><option>46</option></select>' +
        '${Array.from({ length: 12 }, (_, i) => `<label>Поле ${i + 1}</label><input>`).join('')}' +
      '</div>' +
      '<div class="px-5 pt-3"><button id="cancel">Отмена</button></div>' +
      '<button id="cta" style="margin:8px;padding:14px;width:calc(100% - 16px)">Сохранить</button>' +
    '</div>';
  document.getElementById('modal-root').appendChild(sheet);
  document.getElementById('xBtn').onclick = closeSheet;
  document.getElementById('cancel').onclick = closeSheet;
  document.getElementById('backdrop').onclick = closeSheet;
  document.addEventListener('keydown', onKey, true);
  // свайп только за грабер, как в новом BottomSheet
  var sy=0, cy=0, drag=false;
  var g = document.getElementById('grabber');
  g.addEventListener('touchstart', function(e){ sy=e.touches[0].clientY; cy=sy; drag=true; });
  g.addEventListener('touchmove', function(e){ if(!drag) return; if(e.cancelable) e.preventDefault();
    var dy=e.touches[0].clientY-sy; if(dy>0){ cy=e.touches[0].clientY;
      document.getElementById('sheet').style.transform='translateY('+dy+'px)'; } });
  g.addEventListener('touchend', function(){ if(!drag) return; drag=false;
    var dy=cy-sy; document.getElementById('sheet').style.transform='';
    if(dy>100) closeSheet(); sy=0; cy=0; });
}
function onKey(e){ if(e.key==='Escape') closeSheet(); }
function closeSheet(){
  window.__closes++;
  window.__open = false;
  var s = document.getElementById('modal-root').firstElementChild;
  if (s) s.remove();
  document.removeEventListener('keydown', onKey, true);
}
window.__report = function(){
  var sheet = document.getElementById('sheet');
  var cta = document.getElementById('cta');
  var bd = document.getElementById('backdrop');
  if (!sheet) return { open:false, closes: window.__closes };
  var vh = window.innerHeight;
  var sr = sheet.getBoundingClientRect();
  var cr = cta.getBoundingClientRect();
  var br = bd.getBoundingClientRect();
  var anim = getComputedStyle(document.querySelector('.app-anim'));
  var hit = document.elementFromPoint((cr.left+cr.right)/2, (cr.top+cr.bottom)/2);
  return {
    open:true, closes: window.__closes, vh:vh,
    animTransform: anim.transform,
    sheetBottom: +sr.bottom.toFixed(1),
    sheetAtViewportBottom: Math.abs(sr.bottom - vh) <= 1.5,
    ctaFullyVisible: cr.top >= 0 && cr.bottom <= vh,
    ctaHittable: !!(hit && hit.id === 'cta'),
    backdropCoversViewport: br.top <= 0 && br.bottom >= vh,
    bodyScrollTop: document.getElementById('body').scrollTop,
  };
};
</script></body></html>`;

    const browser = await chromium.launch();
    const context = await browser.newContext({ ...devices['Pixel 7'], hasTouch: true });
    const page = await context.newPage();
    page.on('pageerror', (e) => check('B-pageerror', 'нет JS-ошибок в фикстуре', false, String(e)));

    await page.setContent(FIXTURE, { waitUntil: 'load' });
    await page.waitForTimeout(400); // анимация перехода завершается

    // B0 — «тест не пустой». Доказываем, что окружение СПОСОБНО увидеть класс бага:
    // если поместить fixed внутрь элемента с identity-transform (scale(1)),
    // он ДОЛЖЕН сломаться. Если не ломается — тест ничего не проверяет.
    const sensitivity = await page.evaluate(() => {
      const vh = window.innerHeight;
      const host = document.createElement('div');
      host.style.cssText = 'transform:scale(1);position:absolute;top:0;left:0;width:100%;height:100px';
      const inner = document.createElement('div');
      inner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;height:40px;background:#f00';
      host.appendChild(inner);
      document.body.appendChild(host);
      const broken = Math.abs(inner.getBoundingClientRect().bottom - vh) > 2;
      host.remove();
      return { broken, vh };
    });
    check('B0', 'тест чувствителен к классу бага (identity-transform ломает fixed)',
      sensitivity.broken === true,
      `fixed внутри transform:scale(1) сломан=${sensitivity.broken} (ожидалось true; ` +
      `если false — гейт не способен поймать регресс)`);

    await page.evaluate(() => window.openSheet());
    await page.waitForTimeout(350);

    // B1 + B2 на трёх позициях скролла
    const positions = [0, 400, 1200];
    for (const y of positions) {
      await page.evaluate((yy) => { document.getElementById('scroller').scrollTop = yy; }, y);
      await page.waitForTimeout(120);
      const r = await page.evaluate(() => window.__report());
      check(`B1@${y}`, `шторка на границе вьюпорта при scrollTop=${y}`, r.sheetAtViewportBottom,
        `sheetBottom=${r.sheetBottom} vh=${r.vh} animTransform=${r.animTransform}`);
      check(`B2@${y}`, `CTA кликабельна при scrollTop=${y}`, r.ctaHittable && r.ctaFullyVisible,
        `ctaHittable=${r.ctaHittable} ctaFullyVisible=${r.ctaFullyVisible}`);
    }
    const r3 = await page.evaluate(() => window.__report());
    check('B2-backdrop', 'подложка перекрывает весь вьюпорт', r3.backdropCoversViewport,
      `backdropCoversViewport=${r3.backdropCoversViewport}`);

    // Настоящие TouchEvent
    async function touchDrag(sel, { dx = 0, dy = 0 }) {
      await page.evaluate(async ({ sel, dx, dy }) => {
        const el = document.querySelector(sel);
        const r = el.getBoundingClientRect();
        const x0 = r.x + r.width / 2;
        const y0 = r.y + r.height / 2;
        const mk = (t, x, y, target) => {
          const touch = new Touch({ identifier: 1, target, clientX: x, clientY: y });
          return new TouchEvent(t, {
            touches: t === 'touchend' ? [] : [touch],
            targetTouches: t === 'touchend' ? [] : [touch],
            changedTouches: [touch],
            bubbles: true, cancelable: true,
          });
        };
        const target = document.elementFromPoint(x0, y0) || el;
        target.dispatchEvent(mk('touchstart', x0, y0, target));
        for (let i = 1; i <= 6; i++) {
          target.dispatchEvent(mk('touchmove', x0 + (dx * i) / 6, y0 + (dy * i) / 6, target));
          await new Promise((res) => setTimeout(res, 16));
        }
        target.dispatchEvent(mk('touchend', x0 + dx, y0 + dy, target));
        await new Promise((res) => setTimeout(res, 60));
      }, { sel, dx, dy });
    }

    // B4: скролл формы (drag down ВНУТРИ .body) НЕ закрывает
    await page.evaluate(() => { document.getElementById('body').scrollTop = 100; });
    const beforeB4 = await page.evaluate(() => window.__report().closes);
    await touchDrag('#body', { dy: 150 });
    await page.waitForTimeout(250);
    const afterB4 = await page.evaluate(() => window.__report());
    check('B4', 'скролл формы НЕ закрывает шторку',
      afterB4.open && afterB4.closes === beforeB4,
      `open=${afterB4.open} closesBefore=${beforeB4} closesAfter=${afterB4.closes}`);

    // B5: свайп вниз за грабер ЗАКРЫВАЕТ
    const beforeB5 = await page.evaluate(() => window.__report().closes);
    await touchDrag('#grabber', { dy: 160 });
    await page.waitForTimeout(250);
    const afterB5 = await page.evaluate(() => window.__report());
    check('B5', 'свайп вниз за грабер закрывает шторку',
      !afterB5.open && afterB5.closes === beforeB5 + 1,
      `open=${afterB5.open} closes ${beforeB4} -> ${afterB5.closes}`);

    // B3: 4 способа закрытия
    const ways = [];
    async function reopen() {
      await page.evaluate(() => window.openSheet());
      await page.waitForTimeout(200);
    }
    // 1) крестик
    await reopen();
    await page.click('#xBtn'); await page.waitForTimeout(150);
    ways.push({ way: '×', ok: !(await page.evaluate(() => window.__report().open)) });
    // 2) Отмена
    await reopen();
    await page.click('#cancel'); await page.waitForTimeout(150);
    ways.push({ way: 'Отмена', ok: !(await page.evaluate(() => window.__report().open)) });
    // 3) Escape
    await reopen();
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    ways.push({ way: 'Escape', ok: !(await page.evaluate(() => window.__report().open)) });
    // 4) тап по подложке (верхняя зона, вне шторки)
    await reopen();
    await page.evaluate(() => {
      const bd = document.getElementById('backdrop');
      const r = bd.getBoundingClientRect();
      const el = document.elementFromPoint((r.left + r.right) / 2, r.top + 40);
      el && el.click();
    });
    await page.waitForTimeout(150);
    ways.push({ way: 'подложка', ok: !(await page.evaluate(() => window.__report().open)) });

    const allWays = ways.every((w) => w.ok);
    check('B3', 'закрытие 4 способами (× / Отмена / Escape / подложка)', allWays,
      ways.map((w) => `${w.way}=${w.ok ? 'ok' : 'FAIL'}`).join(', '));

    await page.screenshot({ path: path.join(ROOT, 'tests', 'reports', '_mob-audit', 'shot-gate-sheet.png') });
    await browser.close();
  }

  // ─────────────── ИТОГ ───────────────
  const failed = results.filter((r) => !r.ok);
  console.log('\n=== verify_mobile_sheet (D-267) ===\n');
  for (const r of results) {
    console.log(`${r.ok ? '  OK  ' : ' FAIL '} [${r.id}] ${r.name}`);
    if (!r.ok) console.log(`         ${r.evidence}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nПРОВАЛ: мобильные модалки в регрессии.');
    process.exit(1);
  }
  console.log('Все инварианты мобильных модалок соблюдены.');
}

main().catch((e) => { console.error('Гейт упал:', e); process.exit(1); });
