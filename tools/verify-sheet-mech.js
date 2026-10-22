/**
 * Проверка МЕХАНИКИ фикса зависания без React — чистый DOM.
 *
 * Смысл: убедиться, что шторка поднимается над клавиатурой и обработчики
 * срабатывают, а не «залипают». React-специфику (resolve вне апдейтера)
 * проверяет статическая часть теста по исходнику.
 */
const fs = require('fs');
const path = require('path');
const { webkit } = require('playwright');

const ROOT = process.cwd();
const distAssets = path.join(ROOT, 'public', 'mobile-app', 'dist', 'assets');
const cssFile = fs.readdirSync(distAssets).find((f) => /^index-.*\.css$/.test(f));
const css = fs.readFileSync(path.join(distAssets, cssFile), 'utf8');

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<style>${css}</style>
<style>
  body { margin:0; }
  .bd { position:fixed; inset:0; z-index:10060; display:flex; flex-direction:column; justify-content:flex-end; }
  .scrim { position:absolute; inset:0; background:rgba(0,0,0,.5); }
  .sheet { position:relative; background:var(--bg-surface,#1c1c22); color:var(--text-primary,#fff);
           display:flex; flex-direction:column; max-height:85vh;
           padding-bottom: calc(var(--safe-bottom) + 8px); }
  .body { overflow-y:auto; flex:1; min-height:0; padding:16px; }
  .footer { display:flex; gap:8px; padding:12px 16px; border-top:0.5px solid var(--border-norse,#333); }
  .footer button { flex:1; min-height:46px; border-radius:14px; font-weight:700; }
  textarea { width:100%; min-height:96px; border-radius:12px; padding:12px; box-sizing:border-box; }
</style></head><body>
<div class="bd" id="bd" hidden>
  <div class="scrim" id="scrim"></div>
  <div class="sheet" id="sheet">
    <div class="body">
      <p style="font-size:12.5px">Причина обязательна — её увидит отправитель.</p>
      <textarea id="reason" placeholder="Например: уточните сумму"></textarea>
    </div>
    <div class="footer">
      <button id="btn-cancel">Отмена</button>
      <button id="btn-reject">Вернуть с причиной</button>
    </div>
  </div>
</div>
<script>
window.__renders = 0;
const bd = document.getElementById('bd');
const sheet = document.getElementById('sheet');

// Копия логики useVisualViewportBottom из BottomSheet: marginBottom = высота клавиатуры
function applyKb(){
  window.__renders++;
  const vv = window.visualViewport;
  let kb = 0;
  if (vv) {
    const overlap = window.innerHeight - (vv.height + vv.offsetTop);
    kb = overlap > 60 ? Math.round(overlap) : 0;
  }
  sheet.style.marginBottom = kb ? kb + 'px' : '';
  window.__kb = kb;
}
applyKb();
window.addEventListener('resize', applyKb);
if (window.visualViewport){
  window.visualViewport.addEventListener('resize', applyKb);
  window.visualViewport.addEventListener('scroll', applyKb);
}

window.__open = () => { bd.hidden = false; window.__done = null; applyKb(); };
window.__close = (v) => { bd.hidden = true; window.__done = v; };
document.getElementById('scrim').onclick = () => window.__close(null);
document.getElementById('btn-cancel').onclick = () => window.__close(null);
document.getElementById('btn-reject').onclick = () => window.__close('причина');
</script></body></html>`;

const f = path.join(ROOT, 'tests', 'reports', '_sheet-mech.html');
fs.writeFileSync(f, HTML);
const publicHtml = path.join(ROOT, 'public', '_sheet-mech.html');
fs.writeFileSync(publicHtml, HTML);

(async () => {
  const b = await webkit.launch();
  const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:5199/_sheet-mech.html');
  await p.waitForTimeout(500);

  console.log('=== 1. шторка открывается, кнопка работает ===');
  await p.evaluate(() => window.__open());
  await p.waitForTimeout(250);
  const openOk = await p.$eval('#bd', (el) => !el.hidden);
  console.log('шторка открыта:', openOk ? 'ДА' : 'НЕТ');

  const before = await p.evaluate(() => window.__renders);
  const bb = await p.$eval('#btn-reject', (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await p.touchscreen.tap(bb.x, bb.y);
  await p.waitForTimeout(300);
  const done = await p.evaluate(() => window.__done);
  const after = await p.evaluate(() => window.__renders);
  console.log('кнопка сработала:', done === 'причина' ? 'ДА' : `НЕТ (${done})`);
  console.log('перерисовок за действие:', after - before, '(норма: единицы, не сотни)');

  console.log('\n=== 2. клавиатура (visualViewport 552 из 852 → клавиатура 300) ===');
  await p.evaluate(() => window.__open());
  await p.waitForTimeout(200);
  const beforeKb = await p.$eval('#sheet', (el) => { const r = el.getBoundingClientRect(); return { bottom: Math.round(r.bottom), marginBottom: getComputedStyle(el).marginBottom }; });
  console.log('до клавиатуры:', JSON.stringify(beforeKb));

  // Подменяем visualViewport
  await p.evaluate(() => {
    const real = window.visualViewport;
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { get height() { return 552; }, get offsetTop() { return 0; },
               get width() { return real.width; }, get scale() { return 1; },
               addEventListener() {}, removeEventListener() {} },
    });
    window.dispatchEvent(new Event('resize'));
  });
  await p.waitForTimeout(400);
  const afterKb = await p.$eval('#sheet', (el) => { const r = el.getBoundingClientRect(); return { bottom: Math.round(r.bottom), marginBottom: getComputedStyle(el).marginBottom }; });
  const kb = await p.evaluate(() => window.__kb);
  console.log('после клавиатуры:', JSON.stringify(afterKb), '| kb=', kb);
  const footerInfo = await p.evaluate(() => {
    const f = document.querySelector('.footer');
    const r = f.getBoundingClientRect();
    const visH = 852 - 300; // видимая часть экрана над клавиатурой
    return { footerBottom: Math.round(r.bottom), видимая_высота: visH, кнопки_видны: r.bottom <= visH + 2 };
  });
  console.log('футер:', JSON.stringify(footerInfo));

  await p.screenshot({ path: 'tests/reports/sheet-mech-kb.png' });
  await b.close();
})();
