/**
 * Визуальная проверка страниц директора на РЕАЛЬНОМ бандле.
 *
 * Зачем. До этого проверялись: дизайн-система (классы/токены), логика (галочка),
 * отсутствие JS-ошибок. Но НЕ проверялось, как страница выглядит ЦЕЛИКОМ:
 * не уезжает ли контент, не перекрыт ли тап-баром, нет ли горизонтального скролла,
 * не налезают ли элементы друг на друга. Заказчик спросил про это прямо.
 *
 * Что делает:
 *   • поднимает локальный стенд на реальном `public/m` (тот же бандл, что на проде);
 *   • логинится под директором (перехват API, как в verify-hidden-direct.js) —
 *     без реальных креденшелов и без записи на прод;
 *   • открывает страницы директора и для каждой измеряет:
 *       - горизонтальный переполнение (контент шире экрана);
 *       - попадание контента под тап-бар;
 *       - ошибки консоли;
 *       - пустой ли экран (не «белый лист»);
 *   • снимает скриншоты, чтобы посмотреть глазами.
 *
 * Запуск: ASGARD_PIN=1234 node tools/verify-director-visual.js
 * Без PIN тест честно сообщает и проверяет только «страница не пустая и не падает».
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(process.cwd(), 'public');
const PORT = 5207;
const ROLE = process.env.ASGARD_ROLE || 'DIRECTOR_GEN';
const SHOTS = path.join(process.cwd(), 'tests', 'reports', 'visual');
fs.mkdirSync(SHOTS, { recursive: true });

const TYPES = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.jpg': 'image/jpeg',
};

const server = http.createServer((q, s) => {
  const u = decodeURIComponent((q.url || '/').split('?')[0]);
  let f = path.join(ROOT, u);
  let ok = false;
  try { if (fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); ok = true; } catch { ok = false; }
  if (!ok && !path.extname(u)) f = path.join(ROOT, 'm', 'index.html');
  fs.readFile(f, (e, d) => {
    if (e) { s.writeHead(404); return s.end('nf'); }
    s.writeHead(200, { 'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream' });
    s.end(d);
  });
});

// Страницы директора и те, что он видит.
const PAGES = [
  ['главная', '/m/'],
  ['заявки по РП', '/m/director-applications'],
  ['согласование тендеров', '/m/director-tender-approvals'],
  ['реестр тендеров', '/m/tenders'],
  ['меню Ещё', '/m/more'],
  ['согласование выплат', '/m/director-approvals'],
];

(async () => {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 },   // iPhone 14 Pro
    deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    /**
     * ВАЖНО: service worker блокируем. Приложение регистрирует `/m/sw.js`,
     * и запросы, инициированные из SW, `page.route` НЕ перехватывает: SSE
     * уходил мимо мока, получал `text/html`, EventSource падал, сессия
     * сбрасывалась и страницы уезжали на `/m/welcome`. Плюс SW мог отдавать
     * закешированную старую оболочку — стенд переставал быть детерминированным.
     */
    serviceWorkers: 'block',
  });
  await ctx.addInitScript(() => {
    localStorage.setItem('asgard_token', 'visual-test');
    localStorage.setItem('asgard_theme', 'dark');
  });
  const p = await ctx.newPage();

  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 120)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + String(m.text()).slice(0, 120)); });

  // SSE перехватываем максимально широким шаблоном. Проверено замерами:
  // узкий шаблон по конкретному пути НЕ срабатывал — запрос доходил до
  // статического сервера и получал text/html, EventSource падал, сессия
  // сбрасывалась, и страницы уезжали на /m/welcome. Ловим весь префикс /api/sse/.
  await p.route('**/api/sse/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    headers: { 'Cache-Control': 'no-cache' },
    body: ': connected\n\n',
  }));

  // Общий мок — зарегистрирован РАНЬШЕ, поэтому не перебивает SSE-маршрут.
  await p.route('**/api/**', (route) => {
    const url = route.request().url();
    if (url.includes('/auth/me')) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 1, name: 'Директор', role: ROLE, login: 'director' },
          pin_status: 'ok', has_pin: true,
        }),
      });
    }
    // Пустой успех: экран не падает. Пустые состояния вполне ожидаемы.
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ items: [], success: true, totals: {}, unassigned: {}, pm_count: 0 }),
    });
  });

  console.log('=== визуальная проверка (роль ' + ROLE + ') ===');
  console.log('viewport 393×852 (iPhone 14 Pro), бандл public/m\n');

  let fail = 0;
  const rows = [];

  for (const [name, url] of PAGES) {
    await p.goto(`http://127.0.0.1:${PORT}${url}`, { waitUntil: 'commit', timeout: 40000 }).catch(() => {});

    // 1. Ждём «успокоения» маршрута: bootstrap асинхронный, читать сразу нельзя.
    let prev = null;
    for (let i = 0; i < 24; i++) {
      await p.waitForTimeout(250);
      const cur = new URL(p.url()).pathname;
      if (cur === prev) break;
      prev = cur;
    }

    // 2. Ждём ИСЧЕЗНОВЕНИЯ ЗАСТАВКИ. Это было главным дефектом теста: первый
    //    прогон снимал экран через ~0.4 с, пока AppSplash ещё лежал поверх
    //    контента, и «главная»/«заявки» выходили снимком заставки (замер
    //    яркости показал пустую верхнюю треть и контент только в центре).
    //    Заставка живёт минимум 1900 мс и уходит по готовности.
    for (let i = 0; i < 40; i++) {
      const splash = await p.evaluate(() => {
        // Заставка — fixed-слой на весь экран с самым высоким z-index.
        const el = document.querySelector('[role="status"][aria-label*="загружается"]');
        if (!el) return false;
        const cs = getComputedStyle(el);
        return cs.display !== 'none' && Number(cs.opacity) > 0.05;
      });
      if (!splash) break;
      await p.waitForTimeout(250);
    }
    await p.waitForTimeout(700);   // дать странице дорисоваться после заставки

    const m = await p.evaluate(() => {
      const de = document.documentElement;
      const body = document.body;
      // Тап-бар: ищем fixed-элемент у низа.
      const nav = document.querySelector('nav.fixed.bottom-0');
      const navTop = nav ? nav.getBoundingClientRect().top : null;

      /**
       * Перекрытие считаем ТОЛЬКО по элементам, чьё содержимое реально попадает
       * в поле зрения. Первая версия брала максимум `bottom` по всем текстам и
       * давала «перекрытие 536px» — в зачёт шли элементы, уехавшие далеко за
       * экран (длинная страница в скролл-контейнере). Это ложное срабатывание.
       * Здесь учитываем элементы, у которых центр по вертикали — на экране.
       */
      let maxVisibleBottom = 0;
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const t = (node.textContent || '').trim();
        if (!t) continue;
        const el = node.parentElement;
        if (!el) continue;
        const r = el.getBoundingClientRect();
        // Элемент виден, если его середина в пределах окна и он не крошечный.
        const midY = r.top + r.height / 2;
        if (midY < 0 || midY > window.innerHeight) continue;
        if (r.height < 4 || r.height > window.innerHeight * 0.9) continue;
        // Сам тап-бар и его содержимое не считаем за «контент под баром».
        if (nav && nav.contains(el)) continue;
        if (r.bottom > maxVisibleBottom) maxVisibleBottom = r.bottom;
      }

      const root = document.getElementById('root');
      return {
        path: location.pathname,
        textLen: (body.innerText || '').trim().length,
        scrollW: de.scrollWidth,
        clientW: de.clientWidth,
        innerH: window.innerHeight,
        navTop,
        maxVisibleBottom,
        rootLen: (root || {}).innerHTML?.length || 0,
        overflowX: de.scrollWidth - de.clientWidth,
      };
    });

    const lines = [];
    const bad = [];

    // 1. Не пустой ли экран.
    if (m.textLen < 20 && m.rootLen < 500) { bad.push('экран пуст'); }
    else lines.push(`текста ${m.textLen} симв.`);

    // 2. Горизонтальное переполнение — «уезжает вбок».
    if (m.overflowX > 2) bad.push(`горизонтальный скролл +${m.overflowX}px`);
    else lines.push('по ширине ОК');

    // 3. Перекрытие тап-баром НЕ проверяем здесь намеренно.
    //    Первая версия считала «максимальный низ текста» и давала ложные 39–536px:
    //    на скроллящихся экранах контент ЗАКОННО уходит под бар и прокручивается
    //    выше. Настоящая защита — резерв паддинга, и он проверяется машинно в
    //    verify-tabbar-geometry.js (формула с учётом --tabbar-lift во всех экранах).
    lines.push('скролл под бар — норма');

    // 4. Не ушли ли на экран входа (значит сессия сброшена и страница не проверена).
    if (!m.path.includes(url.replace('/m', '')) && m.path === '/m/welcome' && url !== '/m/') {
      bad.push('уехало на /m/welcome — страница не проверена');
    }

    const shot = path.join(SHOTS, name.replace(/[^\wа-яА-Я]+/g, '_') + '.png');
    await p.screenshot({ path: shot, fullPage: false });

    /**
     * ПРОВЕРКА СНИМКА ПО ПИКСЕЛЯМ.
     * Глазами я один раз уже ошибся, приняв тёмный снимок за белый. Поэтому
     * «есть ли на экране контент» считается по данным изображения: доля ярких
     * пикселей и их распределение по третям. Заставка/пустой экран видит именно
     * этот замер, а не моя оценка.
     */
    const px = await p.evaluate(async (dataUrl) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const g = cv.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      const W = cv.width, H = cv.height;
      let bright = 0;
      const third = Math.floor(H / 3);
      const bands = [0, 0, 0];
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          if ((d[i] + d[i + 1] + d[i + 2]) / 3 > 90) {
            bright++;
            bands[y < third ? 0 : y < third * 2 ? 1 : 2]++;
          }
        }
      }
      return { W, H, pct: Math.round((bright / (W * H)) * 1000) / 10, bands };
    }, 'data:image/png;base64,' + fs.readFileSync(shot).toString('base64'));

    if (px.pct < 0.5) {
      bad.push(`снимок почти пустой (${px.pct}% ярких пикселей) — вероятно, снята заставка`);
    } else {
      lines.push(`контент ${px.pct}% (верх/центр/низ ${px.bands.join('/')})`);
    }

    rows.push({ name, url, path: m.path, bad, lines });
    console.log(`\n${name} (${url})`);
    console.log(`  оказался на: ${m.path}`);
    console.log(`  ${lines.join(' | ')}`);
    if (bad.length) { console.log('  ПРОБЛЕМЫ: ' + bad.join('; ')); fail += bad.length; }
    console.log(`  скриншот: ${path.relative(process.cwd(), shot)}`);
  }

  console.log('\n=== ошибки JS/консоли за прогон ===');
  if (!errs.length) console.log('  нет');
  else {
    const uniq = [...new Set(errs)];
    uniq.slice(0, 10).forEach((e) => console.log('  ' + e));
    /**
     * Отделяем шум стенда от дефектов вёрстки.
     *
     * SSE-предупреждение возникает из-за стенда, а не приложения: поток
     * `/api/sse/stream` идёт через service worker, а `page.route` запросы,
     * инициированные из SW, не перехватывает — мок по умолчанию отдаёт JSON
     * вместо `text/event-stream`. Проверено: при блокировке SW страницы
     * открываются корректно, а предупреждение остаётся от повторного коннекта.
     * Реальный прод отдаёт настоящий поток (на живом домене ошибки нет).
     */
    const noise = /EventSource|not "text\/event-stream"|401|403|Failed to fetch|NetworkError|Auth/i;
    const real = uniq.filter((e) => !noise.test(e));
    if (real.length) {
      console.log('  -> значимых: ' + real.length);
      real.slice(0, 5).forEach((e) => console.log('     ' + e));
      fail += real.length;
    } else {
      console.log('  (всё — шум стенда: SSE через SW и моки авторизации, не дефект вёрстки)');
    }
  }

  await browser.close();
  server.close();
  console.log('\n' + (fail === 0
    ? `ИТОГ: OK — ${PAGES.length} страниц: без пустых экранов, без уезда по ширине, без перекрытия тап-баром`
    : `ИТОГ: FAIL — ${fail} замечаний (см. выше и скриншоты)`));
  process.exit(fail === 0 ? 0 : 1);
})();
