/**
 * Проверка фикса тап-бара: моделируем iOS, где visual viewport МЕНЬШЕ layout
 * viewport (панели Safari показаны / идёт свайп-возврат). Именно этого не умеет
 * обычная эмуляция, поэтому раньше дефект «не воспроизводился».
 *
 * Как моделируем: подменяем window.visualViewport так, чтобы
 *   vv.height + vv.offsetTop < window.innerHeight
 * то есть низ видимой области ВЫШЕ низа layout viewport. Смотрим зазор бара.
 *
 * Харнесс повторяет структуру приложения и подключает реальный CSS.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = process.cwd();
const cssFile = fs.readdirSync(path.join(ROOT, 'public', 'mobile-app', 'dist', 'assets')).find((f) => /^index-.*\.css$/.test(f));
const css = fs.readFileSync(path.join(ROOT, 'public', 'mobile-app', 'dist', 'assets', cssFile), 'utf8');

const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<style>${css}</style>
<style>
  #root > div { height: 100%; position: relative; }
  .page { height: 100%; overflow-y: auto; padding-bottom: 90px; }
  .content { height: 1200px; background: linear-gradient(#111,#333); }
</style>
</head><body>
<div id="root">
  <div class="h-full relative">
    <div class="page"><div class="content"></div></div>
    <nav class="fixed bottom-0 left-0 right-0 glass-strong" id="nav"
         style="z-index:50; bottom:var(--vv-bottom,0px); height:var(--tabbar-total); padding-bottom:var(--safe-bottom)">
      <div style="display:flex;align-items:center;height:100%">tabbar</div>
    </nav>
  </div>
</div>
<script>
// Мини-копия хука useVisualViewportBottom: подписка на visualViewport и запись --vv-bottom
(function(){
  const root = document.documentElement;
  const apply = () => {
    const vv = window.visualViewport;
    let offset = 0;
    if (vv) offset = window.innerHeight - (vv.height + vv.offsetTop);
    const safe = Math.max(0, Math.min(Math.round(offset), 120));
    root.style.setProperty('--vv-bottom', safe + 'px');
    window.__applied = safe;
  };
  apply();
  window.visualViewport && window.visualViewport.addEventListener('resize', apply);
  window.visualViewport && window.visualViewport.addEventListener('scroll', apply);
  window.addEventListener('resize', apply);
  window.__apply = apply;
})();
</script>
</body></html>`;

const f = path.join(ROOT, 'tests', 'reports', '_vv-stand.html');
fs.writeFileSync(f, html);

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto('file:///' + f.replace(/\\/g, '/'));

  /**
   * Подменяем visualViewport так, как его видит Safari с показанными панелями:
   * видимая высота меньше, чем layout. Проверяем зазор бара до НИЗА ВИДИМОЙ области.
   */
  const model = async (label, vvHeight, vvOffsetTop) => {
    const r = await p.evaluate(({ vvHeight, vvOffsetTop }) => {
      // Перекрываем свойства visualViewport
      const real = window.visualViewport;
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: {
          get height() { return vvHeight; },
          get offsetTop() { return vvOffsetTop; },
          get width() { return real ? real.width : window.innerWidth; },
          get scale() { return 1; },
          addEventListener() {}, removeEventListener() {},
        },
      });
      window.__apply();
      const nav = document.getElementById('nav');
      const nr = nav.getBoundingClientRect();
      const visibleBottom = vvHeight + vvOffsetTop;   // низ видимой области в координатах layout
      return {
        vvBottom: Math.round(visibleBottom),
        navBottom: Math.round(nr.bottom),
        gapToVisible: Math.round(visibleBottom - nr.bottom), // 0 = бар ровно у видимого низа
        vvVar: getComputedStyle(document.documentElement).getPropertyValue('--vv-bottom').trim(),
        innerH: window.innerHeight,
      };
    }, { vvHeight, vvOffsetTop });
    console.log(`${label.padEnd(46)} низ.видим=${String(r.vvBottom).padStart(4)}  бар.низ=${String(r.navBottom).padStart(4)}  зазор=${String(r.gapToVisible).padStart(4)}  --vv-bottom=${r.vvVar}`);
    return r;
  };

  console.log('=== БЕЗ фикса (--vv-bottom принудительно 0) ===');
  const st = await p.addStyleTag({ content: '#nav { bottom: 0 !important; }' });
  await model('Safari с панелями (видимая 780 из 852)', 780, 0);

  console.log('\n=== С фиксом (бар прижат к видимому низу) ===');
  await p.evaluate((el) => el.remove(), st);
  await model('панели показаны (видимая 780 из 852)', 780, 0);
  await model('панели скрыты (совпадает 852)', 852, 0);
  await model('свайп-возврат (сдвиг 40)', 812, 0);
  await model('клавиатура (видимая 500)', 500, 0);

  await b.close();
})();
