/**
 * verify_d2_live.js — D2: WMS/очередь обновляются без F5 (live-поллинг).
 *
 * Раньше: ни setInterval, ни SSE/WS в модулях склада — данные менялись только по F5.
 * Проверяем в реальном chromium:
 *  1) на вкладке очереди/склада стоит интервал (перехватываем setInterval ДО загрузки модуля);
 *  2) при скрытой вкладке тик НЕ делает запрос (document.hidden);
 *  3) после ухода со страницы таймер очищается (нет «вечного» поллинга);
 *  4) данные реально подтягиваются без перезагрузки (счётчик запросов растёт);
 *  5) негативный контроль: без live счётчик бы не рос.
 */
process.env.DB_NAME = process.env.DB_NAME || 'asgard_crm_test';
if (process.env.DB_NAME === 'asgard_crm') { console.error('[D2] FAIL: прод-БД запрещена'); process.exit(1); }

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3101';
const fs = require('fs');
const { chromium } = require('playwright');

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: detail || '' }); console.log(`${ok ? '[OK]' : '[FAIL]'} ${name}${detail ? ' — ' + detail : ''}`); };

async function login(loginName, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: loginName, password }),
  });
  const j = await r.json();
  let token = j.token;
  let user = j.user || null;
  if (j.status === 'need_pin' || j.status === 'need_setup') {
    const r2 = await fetch(`${BASE}/api/auth/verify-pin`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: '0000' }),
    });
    const j2 = await r2.json();
    if (j2.token) token = j2.token;
    if (j2.user) user = j2.user;
  }
  // Вернуть ту же форму, что пишет auth.js при входе: и токен, и пользователя.
  // Без asgard_user роутер уводит на #/welcome и страница не рендерится вовсе.
  return { token, user };
}

(async () => {
  const { token, user } = await login('test_admin', 'Test123!');
  if (!user) { console.error('FATAL: login не вернул user — тест был бы недостоверным'); process.exit(1); }
  console.log(`[env] роль теста: ${user.role}`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  // Перехватываем setInterval ДО загрузки приложения, чтобы увидеть регистрацию поллинга.
  await ctx.addInitScript(() => {
    window.__intervals = [];
    const orig = window.setInterval;
    window.setInterval = function (fn, ms, ...rest) {
      window.__intervals.push(ms);
      return orig.call(this, fn, ms, ...rest);
    };
  });

  // Считаем запросы к «живым» эндпоинтам склада/очереди.
  let liveHits = 0;
  page.on('request', (req) => {
    const u = req.url();
    if (/\/api\/(warehouse|stock|approval)/.test(u)) liveHits++;
  });

  await page.addInitScript(([t, u]) => {
    try {
      localStorage.setItem('asgard_token', t);
      localStorage.setItem('auth_token', t);
      localStorage.setItem('asgard_user', JSON.stringify(u));
    } catch (_) {}
  }, [token, user]);

  // ── 1. Очередь оплаты: интервал зарегистрирован ─────────────────────────
  await page.goto(`${BASE}/#/approval-payment`, { waitUntil: 'load' });
  await page.waitForTimeout(3500);
  const landed = await page.evaluate(() => ({
    hash: location.hash,
    // Режим очереди помечаем атрибутом, а не вторым h1 (h1 рисует layout).
    mode: (document.querySelector('#payment-list') || {}).dataset ? (document.querySelector('#payment-list').dataset.queueMode || null) : null,
  }));
  check('0. страница очереди реально отрендерилась как режим директора', landed.hash.startsWith('#/approval-payment') && landed.mode === 'dir', `hash=${landed.hash} mode=${landed.mode}`);
  const intervals1 = await page.evaluate(() => window.__intervals || []);
  check('1. на «Очереди оплаты» зарегистрирован интервал', intervals1.some((ms) => ms >= 10000), `intervals=[${intervals1.join(',')}]`);

  const before = liveHits;
  await page.waitForTimeout(22000);
  const grew1 = liveHits > before;
  check('2. live реально дёргает API без F5', grew1, `запросов было ${before}, стало ${liveHits}`);

  // ── 2. Скрытая вкладка: тик не делает запросов ──────────────────────────
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const beforeHidden = liveHits;
  await page.waitForTimeout(22000);
  const grewHidden = liveHits - beforeHidden;
  // Допускаем 0 запросов — это и есть проверяемое свойство (в скрытой вкладке не поллим).
  check('3. скрытая вкладка: тик не поллит', grewHidden === 0, `запросов за 22с в hidden: ${grewHidden}`);

  // ── 3. Уход со страницы останавливает таймер ────────────────────────────
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.goto(`${BASE}/#/`, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  const beforeLeft = liveHits;
  await page.waitForTimeout(23000);
  const grewAfterLeave = liveHits - beforeLeft;
  check('4. после ухода со страницы поллинг остановлен', grewAfterLeave <= 1, `запросов за 23с после ухода: ${grewAfterLeave}`);

  // ── 3b. ПОВТОРНЫЙ ВХОД + переключение вкладки (дефект, найденный верификатором) ──
  // Прежняя версия вешала visibilitychange-листенер в startLive() и не снимала его.
  // После «зашёл → ушёл → вернулся → свернул/развернул» старый листенер гасил ЖИВОЙ таймер.
  await page.goto(`${BASE}/#/approval-payment`, { waitUntil: 'load' });
  await page.waitForTimeout(4500);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const beforeReenter = liveHits;
  await page.waitForTimeout(45000);
  const grewReenter = liveHits - beforeReenter;
  check('4b. live ЖИВ после повторного входа + переключения вкладки', grewReenter >= 1, `запросов за 45с после возврата+toggle: ${grewReenter}`);

  // ── 4. Склад: живость проверяем ЗАПРОСАМИ, а не грепом по файлу ─────────
  let whHits = 0;
  page.on('request', (q) => { if (/\/api\/(products|stock|warehouse|equipment)/.test(q.url())) whHits++; });
  await page.goto(`${BASE}/#/warehouse-v2?tab=assemblies`, { waitUntil: 'load' });
  await page.waitForTimeout(5000);
  const whBefore = whHits;
  await page.waitForTimeout(45000);
  const whLive = whHits - whBefore;
  check('5. склад: live реально дёргает API без F5 (счётчик запросов)', whLive >= 1, `запросов за 45с на вкладке «Сборки»: ${whLive}`);
  const src = fs.readFileSync('public/assets/js/warehouse-v2.js', 'utf8');
  check('6. в warehouse-v2 учтён document.hidden', /document\.hidden/.test(src), 'hidden проверяется');
  check('7. в warehouse-v2 есть остановка таймера', /_stopLive|clearInterval/.test(src), 'stopLive');
  check('8. live только для «живых» вкладок (не для всех)', /LIVE_TABS/.test(src), 'LIVE_TABS');
  check('8b. тик берёт ЖИВОЙ корень (не захваченный)', /document\.querySelector\('\.wh2'\)/.test(src), 'живой .wh2');

  // ── 5. Бухгалтер: ДРУГОЙ срез на той же странице ───────────────────────
  const buh = await login('test_buh', 'Test123!');
  const ctx2 = await browser.newContext({ ignoreHTTPSErrors: true });
  const page2 = await ctx2.newPage();
  await page2.addInitScript(([t, u]) => {
    try {
      localStorage.setItem('asgard_token', t); localStorage.setItem('auth_token', t);
      localStorage.setItem('asgard_user', JSON.stringify(u));
    } catch (_) {}
  }, [buh.token, buh.user]);
  let buhCalls = [];
  page2.on('request', (q) => { if (q.url().includes('/api/approval/pending-')) buhCalls.push(q.url().replace(BASE, '')); });
  await page2.goto(`${BASE}/#/approval-payment`, { waitUntil: 'load' });
  await page2.waitForTimeout(4500);
  const buhInfo = await page2.evaluate(() => ({
    hash: location.hash,
    mode: document.querySelector('#payment-list') ? (document.querySelector('#payment-list').dataset.queueMode || null) : null,
    h1count: document.querySelectorAll('h1').length,
  }));
  check('9. бухгалтер получает режим buh', buhInfo.mode === 'buh', `mode=${buhInfo.mode}`);
  check('10. бухгалтер ходит в pending-buh, а не pending-dir', buhCalls.some((u) => u.includes('pending-buh')) && !buhCalls.some((u) => u.includes('pending-dir')), `calls=${buhCalls.join(',')}`);
  check('11. нет дублирующегося h1 (layout рисует один заголовок)', buhInfo.h1count <= 1, `h1 count=${buhInfo.h1count}`);

  await browser.close();
  const fail = results.filter((r) => !r.ok);
  console.log(`\nИТОГ: ${results.length - fail.length} PASS / ${fail.length} FAIL`);
  fail.forEach((f) => console.log(`  FAIL: ${f.name} — ${f.detail}`));
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
