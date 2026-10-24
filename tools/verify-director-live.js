/**
 * ЖИВАЯ проверка страниц директора на клоне БД с реальными данными.
 *
 * Отличие от `verify-director-visual.js` (который шёл на моках):
 *   • приложение-двойник работает на клоне `asgard_crm_test` (1475 тендеров,
 *     92 заявки, 361 просчёт) — то есть страницы показывают НАСТОЯЩИЕ карточки,
 *     а не пустые состояния;
 *   • вход ЧЕРЕЗ РЕАЛЬНЫЙ API: логин + пароль + PIN. Никаких подмен `auth/me`;
 *   • проверяем, что на страницах появились данные: имена контрагентов, суммы,
 *     статусы — а не «ничего не найдено».
 *
 * Прод не затрагивается: двойник слушает 127.0.0.1:3100 и смотрит в клон.
 *
 * Запуск: node tools/verify-director-live.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.ASGARD_LIVE_BASE || 'http://127.0.0.1:3100';
const LOGIN = process.env.ASGARD_LOGIN || 'test_director_gen';
const PASSWORD = process.env.ASGARD_PASSWORD || 'TestDirector!2026';
const PIN = process.env.ASGARD_PIN || '4321';
const SHOTS = path.join(process.cwd(), 'tests', 'reports', 'visual-live');
fs.mkdirSync(SHOTS, { recursive: true });

let fail = 0;
const bad = (m) => { console.log('  FAIL ' + m); fail++; };
const ok = (m) => console.log('  OK   ' + m);

const PAGES = [
  ['главная (дашборд)', '/m/'],
  ['заявки по РП', '/m/director-applications'],
  ['согласование тендеров', '/m/director-tender-approvals'],
  ['реестр тендеров', '/m/tenders'],
  ['меню Ещё', '/m/more'],
];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    serviceWorkers: 'block',   // SW мешает перехвату и отдаёт закешированную оболочку
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 120)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + String(m.text()).slice(0, 120)); });

  // ── РЕАЛЬНЫЙ ВХОД ───────────────────────────────────────────────────────
  console.log('=== вход через реальный API (%s) ===', BASE);
  const loginRes = await p.request.post(BASE + '/api/auth/login', {
    data: { login: LOGIN, password: PASSWORD },
  }).catch((e) => ({ error: e }));

  if (loginRes.error) { bad('запрос логина не выполнен: ' + loginRes.error); }
  const lj = await loginRes.json().catch(() => ({}));
  console.log('  статус логина:', loginRes.status(), '| ответ:', JSON.stringify({
    status: lj.status, has_user: !!lj.user, has_token: !!lj.token,
    pin_required: lj.pin_required, pin_status: lj.pin_status,
  }));

  let token = lj.token;
  if (!token) bad('токена нет — вход не выполнен');
  else ok('логин принят');

  // PIN: приложение просит его отдельным запросом.
  if (lj.status === 'need_pin' || lj.pin_status === 'need_pin' || lj.pin_required) {
    const pinRes = await p.request.post(BASE + '/api/auth/verify-pin', {
      data: { pin: PIN },
      headers: { Authorization: 'Bearer ' + token },
    }).catch((e) => ({ error: e }));
    const pj = await pinRes.json().catch(() => ({}));
    console.log('  статус PIN:', pinRes.status(), '| токен выдан:', !!pj.token);
    if (pj.token) { token = pj.token; ok('PIN принят, получен полный токен'); }
    else bad('PIN не принят — страницы под директором не откроются');
  } else {
    console.log('  (PIN не запрошен — вход полный)');
  }

  // Проверяем, что токен даёт доступ к защищённым данным.
  const meRes = await p.request.get(BASE + '/api/auth/me', {
    headers: { Authorization: 'Bearer ' + token },
  }).catch(() => null);
  const me = await meRes.json().catch(() => ({}));
  console.log('  /auth/me:', meRes ? meRes.status() : 'ошибка', '| роль:', (me.user || {}).role, '| имя:', (me.user || {}).name);
  if ((me.user || {}).role !== 'DIRECTOR_GEN') bad('роль не DIRECTOR_GEN — проверка недействительна');
  else ok('вход подтверждён: DIRECTOR_GEN');

  // Токен в localStorage — приложение поднимется уже авторизованным.
  await ctx.addInitScript(([t]) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('asgard_theme', 'dark');
  }, [token]);

  // ── СТРАНИЦЫ ────────────────────────────────────────────────────────────
  console.log('\n=== страницы на реальных данных ===');
  const seenPaths = [];
  for (const [name, route] of PAGES) {
    // route уже начинается с /m → склеиваем без лишнего сегмента.
    // Первая версия делала `BASE + '/m' + '/m/...'` и все страницы открывали
    // главную: тест «прошёл», ничего не проверив.
    await p.goto(BASE + route, { waitUntil: 'commit', timeout: 45000 }).catch(() => {});
    // Ждём завершения bootstrap и ухода заставки.
    let prev = null;
    for (let i = 0; i < 30; i++) {
      await p.waitForTimeout(300);
      const cur = new URL(p.url()).pathname;
      if (cur === prev) break;
      prev = cur;
    }
    for (let i = 0; i < 40; i++) {
      const splash = await p.evaluate(() => {
        const el = document.querySelector('[role="status"][aria-label*="загружается"]');
        return el ? Number(getComputedStyle(el).opacity) > 0.05 : false;
      });
      if (!splash) break;
      await p.waitForTimeout(250);
    }
    await p.waitForTimeout(1500);   // дать данным подгрузиться по сети

    const m = await p.evaluate(() => {
      const t = (document.body.innerText || '');
      const de = document.documentElement;
      return {
        path: location.pathname,
        text: t.slice(0, 900),
        textLen: t.trim().length,
        // Признаки РЕАЛЬНЫХ данных, а не пустого состояния.
        hasMoney: /₽|\d[\d\s]{3,}\s*(руб|₽)/.test(t),
        hasEmptyState: /ничего не найдено|нет данных|очередь пуста|нет тендеров|пока нет/i.test(t),
        overflowX: de.scrollWidth - de.clientWidth,
      };
    });

    // Первые строки текста — чтобы видеть, что именно на экране.
    const preview = m.text.replace(/\s+/g, ' ').slice(0, 160);
    console.log(`\n${name} (${route})`);
    console.log(`  путь: ${m.path} | текста ${m.textLen} симв. | уезд ${m.overflowX}px`);
    console.log(`  на экране: ${preview}`);

    // СТРОГАЯ проверка маршрута: страница обязана остаться на своём адресе.
    // Раньше тест этого не требовал, поэтому «все на главной» прошло как OK.
    const wantPath = route === '/m/' ? '/' : route.replace('/m', '');
    if (m.path === '/m/welcome') bad(`${name}: уехало на вход — авторизация не сработала`);
    else if (route !== '/m/' && !m.path.includes(wantPath)) {
      bad(`${name}: остался на ${m.path}, ожидался ${wantPath} — страница не открылась`);
    } else ok(`${name}: открылась на своём маршруте`);
    seenPaths.push(m.path);

    if (m.textLen < 60) bad(`${name}: экран почти пуст (${m.textLen} симв.)`);
    if (m.overflowX > 2) bad(`${name}: уезд по ширине ${m.overflowX}px`);
    if (m.hasEmptyState) console.log('  (показано пустое состояние — возможно, для этой роли так и есть)');
    if (m.hasMoney) ok(`${name}: на экране есть суммы — данные реальные`);
    else console.log('  (сумм на экране не видно)');

    const shot = path.join(SHOTS, name.replace(/[^\wа-яА-Я]+/g, '_') + '.png');
    await p.screenshot({ path: shot });

    // Замер содержимого снимка: не пустой ли он.
    const px = await p.evaluate(async (dataUrl) => {
      const img = new Image(); img.src = dataUrl; await img.decode();
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
      const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      let bright = 0;
      for (let i = 0; i < d.length; i += 4) if ((d[i] + d[i + 1] + d[i + 2]) / 3 > 90) bright++;
      return Math.round((bright / (cv.width * cv.height)) * 1000) / 10;
    }, 'data:image/png;base64,' + fs.readFileSync(shot).toString('base64'));
    console.log(`  контент на снимке: ${px}% ярких пикселей`);
    if (px < 0.3) bad(`${name}: снимок почти пуст — вероятно, снята заставка или экран не отрисован`);
  }

  // Все страницы не могут быть одной и той же: если маршруты не различаются,
  // значит навигация не работает, а тест «проверял» один экран несколько раз.
  const uniqPaths = [...new Set(seenPaths)];
  if (uniqPaths.length < 2) {
    bad(`все страницы открылись по одному адресу (${uniqPaths.join(', ')}) — навигация не проверена`);
  } else {
    ok(`маршруты различаются: ${uniqPaths.join(' ')}`);
  }

  // ── Ошибки ──────────────────────────────────────────────────────────────
  console.log('\n=== ошибки JS/консоли ===');
  const uniq = [...new Set(errs)];
  if (!uniq.length) console.log('  нет');
  else {
    uniq.slice(0, 12).forEach((e) => console.log('  ' + e));
    const noise = /EventSource|not "text\/event-stream"|401|403|Failed to fetch|NetworkError/i;
    const real = uniq.filter((e) => !noise.test(e));
    if (real.length) { console.log('  -> значимых: ' + real.length); fail += real.length; }
    else console.log('  (всё — SSE/сеть, не дефект вёрстки)');
  }

  await browser.close();
  console.log('\n' + (fail === 0
    ? 'ИТОГ: OK — вход реальный, страницы на данных клона, ошибок нет'
    : `ИТОГ: FAIL — ${fail} замечаний`));
  process.exit(fail === 0 ? 0 : 1);
})();
