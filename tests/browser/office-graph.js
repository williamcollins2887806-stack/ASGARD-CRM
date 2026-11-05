'use strict';
/**
 * Рантайм-проверка «График офиса» (список выработки) на клоне :3100.
 * Скриншоты desktop 1440 dark/light + mobile 390/768.
 */
const { chromium } = require('playwright');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const ACC = { login: 'admin', password: 'admin123', pin: '1234' };

const results = [];
function check(name, ok, proof) {
  results.push({ name, ok: !!ok, proof: proof || '' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${proof ? ' — ' + proof : ''}`);
}

async function login(page) {
  await page.goto(BASE + '/#/welcome', { waitUntil: 'commit' });
  await page.evaluate(() => {
    ['asgard_token', 'token', 'authToken', 'auth_token', 'access_token', 'jwt']
      .forEach((k) => { try { localStorage.removeItem(k); } catch (_) {} });
  }).catch(() => {});
  await page.addStyleTag({
    content: '#asgard-splash, #asgard-theme-selector, .ats-visible { display:none !important; pointer-events:none !important; }'
  }).catch(() => {});
  await page.waitForSelector('#btnShowLogin', { state: 'visible', timeout: 20000 });
  await page.locator('#btnShowLogin').click({ force: true });
  await page.waitForSelector('#w_login', { state: 'visible', timeout: 15000 });
  await page.locator('#w_login').fill(ACC.login);
  await page.locator('#w_pass').fill(ACC.password);
  await page.locator('#btnDoLogin').click({ force: true });
  const setupForm = page.locator('#setupForm');
  if (await setupForm.isVisible().catch(() => false)) {
    // Аккаунт-клон без пароля: задаём тот же, что в config, и PIN.
    await page.locator('#s_pass').fill(ACC.password).catch(() => {});
    await page.waitForTimeout(500);
    const host = page.locator('#setupPinKeypadContainer');
    if (await host.isVisible().catch(() => false)) {
      for (const d of ACC.pin.split('')) {
        await host.locator(`[data-digit="${d}"]`).click({ force: true });
        await page.waitForTimeout(160);
      }
    }
  }
  await page.waitForSelector('#pinForm', { state: 'visible', timeout: 25000 });
  await page.waitForTimeout(400);
  for (const d of ACC.pin.split('')) {
    await page.locator(`#pk-keypad [data-digit="${d}"]`).click({ force: true });
    await page.waitForTimeout(160);
  }
  await page.waitForSelector('#pinForm', { state: 'hidden', timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => {
    const t = localStorage.getItem('asgard_token');
    return !!t && t.length > 50;
  }, { timeout: 25000 });
}

async function openDashboard(page) {
  // После PIN приложение ещё грузится и само уводит на #/home: если перейти
  // на #/dashboard ДО регистрации роутов, роутер отдаст fallback /home.
  // Ждём готовности и повторяем переход, пока не отрисуется наш раздел.
  await page.waitForTimeout(2500);
  const ok = await page.evaluate(async () => {
    const deadline = Date.now() + 30000;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    while (Date.now() < deadline) {
      if (document.getElementById('sec-team')) return true;
      if (location.hash !== '#/dashboard') {
        location.hash = '#/home';
        await sleep(60);
        location.hash = '#/dashboard';
      }
      await sleep(500);
    }
    return !!document.getElementById('sec-team');
  }).catch(() => false);
  if (!ok) throw new Error('дашборд не отрисовался за 30 с');
  await page.addStyleTag({
    content: '#asgard-splash, #asgard-theme-selector, .ats-visible { display:none !important; pointer-events:none !important; }'
  }).catch(() => {});
  await page.evaluate(() => {
    const el = document.getElementById('asgard-presence-week');
    if (el) el.remove();
  }).catch(() => {});
  await page.waitForSelector('#sec-team .og-table, #sec-team .dl-banner', { timeout: 40000 });
  await page.waitForTimeout(600);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push('PAGE_ERROR: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/favicon|ResizeObserver|ERR_|Failed to load resource|status of 40[134]/.test(t)) return;
    errors.push(t);
  });

  await login(page);
  check('логин директора', true);
  await openDashboard(page);

  const sec = page.locator('#sec-team');
  const title = await sec.locator('.sec-title').innerText();
  check('заголовок раздела «График офиса»', /График офиса/.test(title), title);

  const scopes = await sec.locator('.og-scope').allInnerTexts();
  check('фильтр: Неделя / Месяц / Год', scopes.join(',') === 'Неделя,Месяц,Год', scopes.join(', '));

  const rows = await sec.locator('.og-row').count();
  check('список сотрудников отрисован', rows > 0, `строк: ${rows}`);

  const heads = await sec.locator('.og-thead > span').allInnerTexts();
  const headText = heads.join(' ').toLowerCase();
  check('колонки: офис/удалённо/сумма/норма/выработка',
    /офис/.test(headText) && /удалённо/.test(headText)
    && /сумма/.test(headText) && /норма/.test(headText) && /выработка/.test(headText),
    heads.join(' | '));

  const beforeScope = await sec.locator('.og-range').innerText();
  const beforeRows = await sec.locator('.og-row').count();

  // Если авто-выбор не сработал и период пуст — сами уходим на покрытую
  // неделю. Счёт проверок при этом не меняется: обе ветки выполняются всегда.
  let crownCount = await sec.locator('.og-row.is-crown').count();
  if (crownCount === 0 && await sec.locator('.og-row.is-none, .og-row').count() > 0) {
    await sec.locator('[data-team-scope="week"]').click();
    await page.waitForTimeout(2200);
    await sec.locator('[data-team-anchor]').first().click();
    await page.waitForTimeout(2400);
  }
  const coveredLabel = await sec.locator('.og-range').innerText();
  const coveredRows = await sec.locator('.og-row').count();
  // 4-я ячейка строки — «Норма». Если в ней прочерк у всех, нормы за период нет.
  const normFilled = await sec.locator('.og-row').evaluateAll((rows) => rows.filter((r) => {
    const cells = r.querySelectorAll('.og-cell');
    const norm = cells[cells.length - 1];
    return norm && norm.textContent.trim() !== '—';
  }).length);
  check('период по умолчанию содержит норму (покрыт отчётом СКУД)',
    coveredRows > 0 && normFilled > 0, `${coveredLabel}, строк ${coveredRows}, с нормой ${normFilled}`);

  crownCount = await sec.locator('.og-row.is-crown').count();
  const crownName = crownCount ? (await sec.locator('.og-row.is-crown .og-name-txt').first().innerText()).trim() : '';
  const greenCrown = await sec.locator('.og-row.is-crown.is-green').count();
  check('корона у зелёного лидера', crownCount >= 1 && greenCrown === crownCount,
    `корон: ${crownCount}, лидер: ${crownName}`);

  // Скриншот именно покрытого периода — здесь видны все четыре цвета.
  await sec.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await sec.screenshot({ path: 'tests/reports/office-graph-section-covered.png' }).catch(() => {});

  const states = await sec.locator('.og-row').evaluateAll((els) => els
    .map((e) => (e.className.match(/is-(green|yellow|red|none)/) || [])[1]));
  const uniq = [...new Set(states)];
  check('цветовые состояния проставлены', uniq.length >= 2, uniq.join(', '));

  // Переключение scope проверяем от исходного месяца.
  await sec.locator('[data-team-scope="month"]').click();
  await page.waitForTimeout(2200);
  const monthLabel = await sec.locator('.og-range').innerText();
  await sec.locator('[data-team-scope="week"]').click();
  await page.waitForTimeout(2200);
  const afterWeek = await sec.locator('.og-range').innerText();
  const weekRows = await sec.locator('.og-row').count();
  check('переключение «Месяц → Неделя» меняет диапазон',
    afterWeek !== monthLabel && weekRows > 0,
    `${beforeScope} → ${monthLabel} → ${afterWeek}, строк ${weekRows} (было ${beforeRows})`);

  await sec.locator('[data-team-anchor]').first().click();
  await page.waitForTimeout(2200);
  const afterPrev = await sec.locator('.og-range').innerText();
  check('стрелка «‹» листает период', afterPrev !== afterWeek, `${afterWeek} → ${afterPrev}`);

  const today = sec.locator('[data-team-current]');
  check('кнопка «Текущий период» появилась', await today.count() === 1);
  await today.first().click();
  await page.waitForTimeout(2200);
  const backToCurrent = await sec.locator('.og-range').innerText();
  check('«Текущий период» возвращает диапазон', backToCurrent !== afterPrev, `${afterPrev} → ${backToCurrent}`);

  await sec.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/reports/office-graph-desktop-dark.png', fullPage: false });
  await sec.screenshot({ path: 'tests/reports/office-graph-section-dark.png' }).catch(() => {});

  // Светлая тема: у приложения есть переключатель темы на html/body.
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    if (window.AsgardTheme && typeof window.AsgardTheme.set === 'function') {
      try { window.AsgardTheme.set('light'); } catch (_) {}
    }
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'tests/reports/office-graph-desktop-light.png' });
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    if (window.AsgardTheme && typeof window.AsgardTheme.set === 'function') {
      try { window.AsgardTheme.set('dark'); } catch (_) {}
    }
  });
  await page.waitForTimeout(500);

  // Модалка по строке: дни с колонкой «Удалённо».
  const firstRow = sec.locator('.og-row').first();
  await firstRow.click();
  await page.waitForTimeout(1200);
  const modal = page.locator('#jpModalRoot');
  const modalVisible = await modal.isVisible().catch(() => false);
  const thead = modalVisible
    ? await page.locator('.th-thead--days').innerText() : '';
  check('модалка сотрудника открывается с колонкой «Удалённо»',
    modalVisible && /удалённо/i.test(thead), thead.replace(/\n/g, ' | '));
  await page.screenshot({ path: 'tests/reports/office-graph-modal.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // Мобильный режим (та же страница, узкий viewport).
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'tests/reports/office-graph-768.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(900);
  const rowBox = await sec.locator('.og-row').first().boundingBox();
  check('на 390 вёрстка не вылезает по ширине', rowBox && rowBox.width <= 390, rowBox ? `ширина строки ${Math.round(rowBox.width)}` : 'нет строки');
  await page.screenshot({ path: 'tests/reports/office-graph-390.png' });

  check('ноль JS-ошибок в консоли', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\nИТОГ: ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) process.exit(1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
