/**
 * Доказательство дефекта и его отсутствия после фикса.
 *
 * В Safari iOS `100vh` = БОЛЬШАЯ высота (панели считаются скрытыми), а `100dvh`
 * = реальная видимая высота. На iPhone 11: 100vh = 896, dvh = 844.
 *
 * Моделируем это в Chromium через CSS-переменные: подменяем 100vh на 896 и
 * 100dvh на 844, затем рендерим экран приветствия и смотрим, влезает ли
 * нижняя кнопка.
 */
const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:5199/m/';

// Эталон: -2.2.1 до фикса использовал min-h-screen (=100vh). Проверяем оба класса
// на одном и том же контенте.
const HARNESS = `
<!doctype html><html><head><meta charset="utf-8">
<style>
  html, body { margin:0; }
  /* Safari-модель: большой вьюпорт 896, реальный 844 */
  :root { --vv: 896px; --dv: 844px; }
  .sim-vh { min-height: var(--vv); }
  .sim-dvh { min-height: var(--dv); }
  .box { display:flex; flex-direction:column; justify-content:space-between; overflow:hidden; }
  .top { height: 200px; background:#123; }
  .bottom { height: 120px; background:#c33; }
</style></head><body>
<div id="wrap" style="height:844px; overflow:hidden; position:relative;">
  <div id="sec" class="box sim-CLASS"><div class="top"></div><div class="bottom"></div></div>
</div>
</body></html>
`;

(async () => {
  const b = await chromium.launch();

  for (const cls of ['sim-vh', 'sim-dvh']) {
    const p = await b.newPage({ viewport: { width: 414, height: 844 } });
    await p.setContent(HARNESS.replace('sim-CLASS', cls));
    const r = await p.evaluate(() => {
      const sec = document.getElementById('sec');
      const bottom = sec.querySelector('.bottom');
      const wrap = document.getElementById('wrap');
      return {
        secH: Math.round(sec.getBoundingClientRect().height),
        wrapH: Math.round(wrap.getBoundingClientRect().height),
        bottomBottom: Math.round(bottom.getBoundingClientRect().bottom),
      };
    });
    const clipped = r.bottomBottom > r.wrapH;
    console.log(
      `${cls.padEnd(9)}: высота секции=${r.secH}px  низ контента=${r.bottomBottom}px  ` +
      `обрезка=${clipped ? 'ДА — кнопка недоступна' : 'нет'}`
    );
    await p.close();
  }

  // Теперь живой экран приветствия из собранного бандла.
  const p = await b.newPage({ viewport: { width: 414, height: 844 }, isMobile: true, hasTouch: true });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message)));
  await p.goto(BASE, { waitUntil: 'commit', timeout: 60000 });
  await p.waitForTimeout(4500);
  const live = await p.evaluate(() => {
    // Секция приветствия — по классу из фикса
    const sec = document.querySelector('.app-min-h') || document.querySelector('.min-h-screen');
    const btn = [...document.querySelectorAll('button')].find((x) => /рабочий/i.test(x.textContent || ''));
    const r = sec ? sec.getBoundingClientRect() : null;
    const br = btn ? btn.getBoundingClientRect() : null;
    return {
      cls: sec ? sec.className : null,
      secH: r ? Math.round(r.height) : null,
      innerH: window.innerHeight,
      rootH: Math.round(document.getElementById('root').getBoundingClientRect().height),
      btnBottom: br ? Math.round(br.bottom) : null,
      btnVisible: br ? br.bottom <= window.innerHeight + 0.5 && br.top >= 0 : null,
    };
  });
  console.log('\nЖИВОЙ ЭКРАН ПРИВЕТСТВИЯ:');
  console.log(JSON.stringify(live, null, 2));
  console.log('JS errors:', errs.length);
  await p.screenshot({ path: 'tests/reports/verify-welcome-fit.png' });
  await b.close();
})();
