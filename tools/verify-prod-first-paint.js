/**
 * Проверка ФАКТА первого кадра на живом проде.
 *
 * Симптом был: плавающий 50/50 — первый кадр белый, потом приходит цвет.
 * Фикс: фон задан инлайном в `head`, поэтому белого кадра не должно быть.
 *
 * Метод: грузим страницу с ОСТАНОВЛЕННЫМ CSS/JS (блокируем внешние ресурсы).
 * Если фон берётся из инлайна — он будет правильным даже без бандла.
 * Это прямая проверка: раньше без бандла страница была БЕЛОЙ.
 */
const { chromium } = require('playwright');

const BASE = process.env.ASGARD_BASE || 'https://asgard-crm.ru';

(async () => {
  const b = await chromium.launch();
  let fail = 0;

  for (const theme of ['dark', 'light']) {
    const ctx = await b.newContext({
      viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true,
      deviceScaleFactor: 2,
    });
    const p = await ctx.newPage();

    // Светлая тема: сохранённый выбор в localStorage.
    await ctx.addInitScript((t) => {
      localStorage.setItem('asgard_theme', t);
    }, theme);

    /**
     * Блокируем ВСЕ внешние ресурсы (.js/.css) — имитируем самый ранний момент,
     * когда бандл ещё не пришёл. Инлайн-стиль из head всё равно применится.
     * Так проверяется именно «первый кадр», а не итог после загрузки.
     */
    await p.route('**/*', (route) => {
      const url = route.request().url();
      if (/\.(js|css)($|\?)/.test(url) && !url.startsWith('data:')) {
        return route.abort();
      }
      return route.continue();
    });

    await p.goto(BASE + '/m/', { waitUntil: 'commit', timeout: 60000 }).catch(() => {});
    await p.waitForTimeout(2500);

    const r = await p.evaluate(() => {
      const html = getComputedStyle(document.documentElement);
      const body = getComputedStyle(document.body);
      return {
        htmlBg: html.backgroundColor,
        bodyBg: body.backgroundColor,
        cls: document.documentElement.className,
        // Есть ли бандл (должен быть заблокирован)
        hasBundle: !!document.querySelector('script[src*="assets/index-"]'),
      };
    });

    const want = theme === 'dark' ? 'rgb(10, 10, 12)' : 'rgb(242, 242, 247)';
    const okBg = r.htmlBg === want;
    const white = r.htmlBg === 'rgb(255, 255, 255)' || r.htmlBg === 'rgba(0, 0, 0, 0)';

    console.log(`=== ${theme === 'dark' ? 'ТЁМНАЯ' : 'СВЕТЛАЯ'} тема (внешние ресурсы заблокированы) ===`);
    console.log(`  html background : ${r.htmlBg} (ожидалось ${want}) -> ${okBg ? 'OK' : 'НЕВЕРНО'}`);
    console.log(`  body background : ${r.bodyBg}`);
    console.log(`  класс на html   : ${r.cls || '(нет)'}`);
    console.log(`  бандл загружен  : ${r.hasBundle} (при блокировке должен быть false)`);
    console.log(`  БЕЛЫЙ первый кадр: ${white ? 'ДА — ДЕФЕКТ' : 'нет'}`);

    if (!okBg) { console.log(`  FAIL фон не из инлайна`); fail++; }
    if (white) { console.log('  FAIL первый кадр белый — гонка осталась'); fail++; }
    else console.log('  OK   фон определён без бандла — гонки нет');

    await ctx.close();
    console.log('');
  }

  await b.close();
  console.log(fail === 0
    ? 'ИТОГ: OK — первый кадр окрашен в обеих темах, белой вспышки нет'
    : `ИТОГ: FAIL — ${fail} нарушений`);
  process.exit(fail === 0 ? 0 : 1);
})();
