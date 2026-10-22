/**
 * Съёмка заставки в ОБЕИХ темах: убедиться, что светлая тема действительно светлая,
 * фон html закрывает canvas, и убедиться, что бар/фон не «прыгают».
 */
const fs = require('fs');
const path = require('path');
const { webkit } = require('playwright');

const ROOT = process.cwd();
const distAssets = path.join(ROOT, 'public', 'mobile-app', 'dist', 'assets');
const jsFile = fs.readdirSync(distAssets).find((f) => /^index-.*\.js$/.test(f));
const cssFile = fs.readdirSync(distAssets).find((f) => /^index-.*\.css$/.test(f));

// Собираем страницу, повторяющую AppSplash, но со своими переменными —
// чтобы проверить именно СЦЕНЫ, а не весь бандл (он требует API).
const css = fs.readFileSync(path.join(distAssets, cssFile), 'utf8');

const splashVars = `
  /* Копия переменных из AppSplash.jsx (проверяем фактические значения) */
  :root {
    --splash-bg: radial-gradient(ellipse 130% 90% at 50% -12%, #17213f 0%, #0a0e1c 44%, #04050a 100%);
    --splash-title-a: #a08030; --splash-title-b: #c8a84e; --splash-title-hi: #FFF9E4;
    --splash-sub: rgba(214,224,240,0.50); --splash-quote: rgba(230,237,248,0.82);
    --splash-quote-shadow: 0 1px 12px rgba(0,0,0,0.55);
    --splash-track: rgba(214,224,240,0.09); --splash-bar: rgba(214,224,240,0.36);
    --splash-hint: rgba(214,224,240,0.22);
  }
  html.light {
    --splash-bg: radial-gradient(ellipse 130% 90% at 50% -12%, #FFFFFF 0%, #F7F4EC 42%, #EFEAE0 100%);
    --splash-title-a: #8A5E0B; --splash-title-b: #B8860B; --splash-title-hi: #FFF6D8;
    --splash-sub: rgba(60,60,67,0.62); --splash-quote: rgba(40,42,50,0.86);
    --splash-quote-shadow: 0 1px 0 rgba(255,255,255,0.7);
    --splash-track: rgba(60,60,67,0.12); --splash-bar: rgba(90,90,100,0.55);
    --splash-hint: rgba(60,60,67,0.34);
  }
`;

const mk = (light) => `<!doctype html><html class="${light ? 'light' : ''}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<style>${css}</style>
<style>${splashVars}
  html, body { margin:0; height:100dvh; overflow:hidden; }
  .splash { position:fixed; inset:0; z-index:20000; display:flex; flex-direction:column;
            align-items:center; justify-content:center; background: var(--splash-bg); }
  .logo { width:150px; height:auto; filter: drop-shadow(0 6px 20px rgba(0,0,0,0.35)); }
  .title { font-size:30px; font-weight:800; letter-spacing:11px; padding-left:11px;
           backgroundImage:none;
           background-image: linear-gradient(100deg, var(--splash-title-a) 0%, var(--splash-title-b) 26%, var(--splash-title-hi) 46%, var(--splash-title-b) 62%, var(--splash-title-a) 84%, #6B4909 100%);
           -webkit-background-clip:text; background-clip:text; color:transparent; }
  .sub { margin-top:9px; font-size:9.5px; letter-spacing:5px; color: var(--splash-sub);
         text-transform:uppercase; font-weight:600; }
  .quote { margin-top:30px; font-size:14.5px; font-style:italic; color: var(--splash-quote);
           text-shadow: var(--splash-quote-shadow); }
  .track { position:absolute; bottom:60px; width:180px; height:2.5px; border-radius:999;
           background: var(--splash-track); }
  .fill { width:72%; height:100%; border-radius:999;
          background: linear-gradient(90deg, var(--splash-title-a), var(--splash-title-b) 45%, var(--splash-title-hi)); }
  .bar { position:absolute; bottom:44px; font-size:10px; letter-spacing:2px; color: var(--splash-bar); }
  .hint { position:absolute; bottom:18px; font-size:9.5px; letter-spacing:1.3px; color: var(--splash-hint); }
</style></head><body>
<div class="splash">
  <img class="logo" src="/m/asgard-logo.png" alt="">
  <div class="title">АСГАРД</div>
  <div class="sub">Система управления</div>
  <div class="quote">«Терпение воина дороже похвал»</div>
  <div class="track"><div class="fill"></div></div>
  <div class="bar">Загрузка</div>
  <div class="hint">коснитесь, чтобы пропустить</div>
</div>
</body></html>`;

(async () => {
  const b = await webkit.launch();
  for (const light of [false, true]) {
    const f = path.join(ROOT, 'tests', 'reports', `_splash-${light ? 'light' : 'dark'}.html`);
    // Копируем логотип рядом, чтобы <img> нашёлся (BASE_URL в стенде — корень)
    fs.writeFileSync(f, mk(light));
    const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    // Подменяем путь логотипа на локальный файл
    await p.route('**/m/asgard-logo.png', (route) => route.fulfill({ path: path.join(ROOT, 'public', 'm', 'asgard-logo.png') }));
    await p.goto('file:///' + f.replace(/\\/g, '/'));
    await p.waitForTimeout(500);
    const r = await p.evaluate(() => {
      const sp = document.querySelector('.splash');
      const q = document.querySelector('.quote');
      const cs = getComputedStyle(sp);
      return {
        тема: document.documentElement.className || '(тёмная)',
        фон: cs.backgroundImage.slice(0, 60),
        color_scheme: getComputedStyle(document.documentElement).colorScheme,
        цвет_девиза: getComputedStyle(q).color,
      };
    });
    console.log(`\n=== ${light ? 'СВЕТЛАЯ' : 'ТЁМНАЯ'} тема ===`);
    console.log(JSON.stringify(r, null, 2));
    await p.screenshot({ path: `tests/reports/splash-${light ? 'light' : 'dark'}.png` });
    await ctx.close();
  }
  await b.close();
})();
