/**
 * Проверка тап-бара: он обязан прилегать к низу экрана без зазора.
 * Раньше пользователь видел полосу фона под баром. Проверяем позицию `nav`
 * в разных режимах: (1) обычный браузер, safe-area = 0; (2) эмуляция iOS
 * с ненулевым safe-area; (3) standalone.
 */
const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:5199/m';

const HARNESS = (safeBottom) => `<!doctype html><html><head><meta charset="utf-8">
<style>
  :root {
    --safe-bottom: ${safeBottom}px;
    --tabbar-height: 52px;
    --tabbar-total: calc(var(--tabbar-height) + var(--safe-bottom));
    --bg-primary: #0a0a0c;
    --gold: #c8a84e;
    --border-norse: #1f1f28;
    --text-tertiary: #8E8E93;
  }
  html, body { margin:0; height:100dvh; overflow:hidden; }
  nav { position: fixed; bottom: 0; left: 0; right: 0; height: var(--tabbar-total);
        padding-bottom: var(--safe-bottom); background: #141418; box-sizing: border-box; }
</style></head><body>
<nav id="n"><div style="height:52px">tab</div></nav>
</body></html>`;

(async () => {
  const b = await chromium.launch();

  // 1. Обычный браузер: safe-area = 0
  let p = await b.newPage({ viewport: { width: 414, height: 844 } });
  await p.setContent(HARNESS(0));
  let r = await p.evaluate(() => {
    const n = document.getElementById('n').getBoundingClientRect();
    return { navTop: Math.round(n.top), navBottom: Math.round(n.bottom), navH: Math.round(n.height), innerH: window.innerHeight, gap: Math.round(window.innerHeight - n.bottom) };
  });
  console.log('safe-area=0 :', JSON.stringify(r));
  await p.close();

  // 2. iOS с домашним индикатором: safe-area = 34
  p = await b.newPage({ viewport: { width: 414, height: 844 } });
  await p.setContent(HARNESS(34));
  r = await p.evaluate(() => {
    const n = document.getElementById('n').getBoundingClientRect();
    return { navTop: Math.round(n.top), navBottom: Math.round(n.bottom), navH: Math.round(n.height), innerH: window.innerHeight, gap: Math.round(window.innerHeight - n.bottom) };
  });
  console.log('safe-area=34:', JSON.stringify(r));
  await p.close();

  // 3. Реальный экран приложения с тап-баром (если удастся войти — иначе пропуск).
  p = await b.newPage({ viewport: { width: 414, height: 844 }, isMobile: true, hasTouch: true });
  await p.goto(BASE + '/', { waitUntil: 'commit', timeout: 45000 }).catch(() => {});
  await p.waitForTimeout(3000);
  r = await p.evaluate(() => {
    const nav = document.querySelector('nav.fixed.bottom-0');
    if (!nav) return { navFound: false, note: 'тап-бар скрыт (не авторизованы)' };
    const n = nav.getBoundingClientRect();
    const cs = getComputedStyle(nav);
    return {
      navFound: true,
      navTop: Math.round(n.top), navBottom: Math.round(n.bottom), navH: Math.round(n.height),
      innerH: window.innerHeight,
      gapUnderNav: Math.round(window.innerHeight - n.bottom),
      heightCss: cs.height, paddingBottom: cs.paddingBottom,
    };
  });
  console.log('живой экран  :', JSON.stringify(r));
  await b.close();
})();
