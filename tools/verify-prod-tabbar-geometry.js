/**
 * Проверка D-341 на ЖИВОМ проде: тап-бар достаёт до физического низа экрана,
 * маскировка снята.
 *
 * Почему отдельный файл, а не часть `verify-tabbar-geometry.js`:
 * локальный гейт доказывает ГЕОМЕТРИЮ формулой и моделью (экран 896 / коробка
 * 845). Здесь проверяется, что ровно этот код ЗАЛИТ и работает: переменные
 * присутствуют в собранном CSS, фон `html` — обычный фон приложения, страница
 * жива. Полноценный «бар на 896» на устройстве измерить может только сам
 * заказчик через `?diag=1`, потому что в headless `dvh == lvh`.
 */
const { chromium } = require('playwright');

const BASE = process.env.ASGARD_BASE || 'https://asgard-crm.ru';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  });
  const p = await ctx.newPage();
  const errs = [];
  const missing = [];
  p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 90)));
  p.on('response', (r) => { if (r.status() === 404) missing.push(r.url().split('/').pop()); });

  await p.goto(BASE + '/m/', { waitUntil: 'commit', timeout: 60000 });
  await p.waitForTimeout(4500);

  const probe = await p.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const root = document.getElementById('root');
    return {
      url: location.pathname,
      rootLen: (root || {}).innerHTML?.length || 0,
      tabbarLift: cs.getPropertyValue('--tabbar-lift').trim(),
      appGap: cs.getPropertyValue('--app-gap').trim(),
      tabbarTotal: cs.getPropertyValue('--tabbar-total').trim(),
      htmlBg: cs.backgroundColor,
      // Маскировка = фон html совпал с цветом бара. Бар полупрозрачный, его
      // композит в тёмной теме ≈ #121215 — если фон html ровно такой, значит
      // вернули покраску вместо геометрии.
      bgPrimary: cs.getPropertyValue('--bg-primary').trim(),
      theme: document.documentElement.className || '(тёмная)',
    };
  });

  console.log('=== /m/ на проде ===');
  console.log('  url:', probe.url, '| root:', probe.rootLen, '| тема:', probe.theme);
  console.log('  --tabbar-lift :', probe.tabbarLift);
  console.log('  --app-gap     :', probe.appGap);
  console.log('  --tabbar-total:', probe.tabbarTotal);
  console.log('  фон html      :', probe.htmlBg, '| --bg-primary:', probe.bgPrimary);
  console.log('  JS ошибок:', errs.length, '| 404:', missing.length);

  let fail = 0;

  if (/calc\(/.test(probe.tabbarLift) && /dvh/.test(probe.tabbarLift) && /lvh/.test(probe.tabbarLift)) {
    console.log('  OK   бар смещается формулой 100dvh − 100lvh');
  } else {
    console.log('  FAIL --tabbar-lift не в собранном CSS: ' + probe.tabbarLift);
    fail++;
  }

  if (probe.rootLen > 1000 && errs.length === 0) {
    console.log('  OK   приложение отрендерилось без ошибок');
  } else {
    console.log('  FAIL приложение не поднялось (root=' + probe.rootLen + ', ошибок=' + errs.length + ')');
    fail++;
  }

  // Фон html должен быть фоном приложения, а не цветом бара.
  const htmlHex = (() => {
    const m = String(probe.htmlBg).match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    return m ? '#' + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('') : null;
  })();
  if (htmlHex === '#121215') {
    console.log('  FAIL фон html = цвет бара (#121215) — маскировка вернулась');
    fail++;
  } else {
    console.log('  OK   фон html не маскирует полосу (' + htmlHex + ')');
  }

  await browser.close();
  console.log('\n' + (fail === 0
    ? 'ИТОГ: OK — геометрия бара залита на прод, маскировка отсутствует'
    : `ИТОГ: FAIL — ${fail} нарушений`));
  process.exit(fail === 0 ? 0 : 1);
})();
