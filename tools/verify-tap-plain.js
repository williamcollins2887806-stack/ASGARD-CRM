/**
 * Чистый дискриминирующий тест: есть ли «проглатывание первого тапа после свайпа»
 * в ГОЛОМ Chromium, без React и без нашего кода.
 *  - если ДА  → это артефакт движка/эмуляции, а не дефект приложения;
 *  - если НЕТ → дефект в нашем коде (PTR/шторка).
 */
const { chromium } = require('playwright');

const PLAIN = `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0}
#area{height:2000px;background:linear-gradient(#111,#333)}
#btn{position:fixed;bottom:20px;left:20px;right:20px;padding:20px;font-size:16px}
</style></head><body>
<button id="btn">Вернуть</button>
<div id="area"></div>
<script>
window.__clicks = 0;
document.getElementById('btn').addEventListener('click', () => { window.__clicks++; });
</script></body></html>`;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.setContent(PLAIN);
  await p.waitForTimeout(600);
  const cdp = await ctx.newCDPSession(p);

  const btnXY = async () => p.$eval('#btn', (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });

  // 1. Тап без свайпа (контроль)
  await p.evaluate(() => { window.__clicks = 0; });
  let xy = await btnXY();
  await p.touchscreen.tap(xy.x, xy.y);
  await p.waitForTimeout(250);
  console.log('1) тап без свайпа            :', await p.evaluate(() => window.__clicks));

  // 2. CDP-свайп вниз (pull-to-refresh-подобный), затем тап
  const swipe = async (dir, times) => {
    for (let i = 0; i < times; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 196, y: 300 }] });
      for (let s = 1; s <= 12; s++) {
        const y = dir === 'down' ? 300 + s * 10 : 300 - s * 10;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 196, y }] });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    await p.waitForTimeout(400);
  };

  await p.evaluate(() => { window.__clicks = 0; });
  await swipe('down', 1);
  xy = await btnXY();
  await p.touchscreen.tap(xy.x, xy.y);
  await p.waitForTimeout(250);
  console.log('2) CDP-свайп вниз → тап      :', await p.evaluate(() => window.__clicks));

  // 3. то же, но пауза 1200 мс перед тапом
  await p.evaluate(() => { window.__clicks = 0; });
  await swipe('down', 1);
  await p.waitForTimeout(1200);
  xy = await btnXY();
  await p.touchscreen.tap(xy.x, xy.y);
  await p.waitForTimeout(250);
  console.log('3) CDP-свайп вниз, пауза 1.2с:', await p.evaluate(() => window.__clicks));

  // 4. Свайп вверх (скролл страницы)
  await p.evaluate(() => { window.__clicks = 0; });
  await swipe('up', 1);
  xy = await btnXY();
  await p.touchscreen.tap(xy.x, xy.y);
  await p.waitForTimeout(250);
  console.log('4) CDP-свайп вверх → тап     :', await p.evaluate(() => window.__clicks));

  // 5. Два тапа подряд после свайпа
  await p.evaluate(() => { window.__clicks = 0; });
  await swipe('down', 1);
  xy = await btnXY();
  await p.touchscreen.tap(xy.x, xy.y);
  await p.waitForTimeout(200);
  await p.touchscreen.tap(xy.x, xy.y);
  await p.waitForTimeout(200);
  console.log('5) свайп → два тапа          :', await p.evaluate(() => window.__clicks));

  await b.close();
})();
