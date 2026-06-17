/* Wave-3 mobile-app smoke test.
 * Запуск (PowerShell):
 *   $env:DB_NAME='asgard_crm_kanban_test'; $env:JWT_SECRET=(process.env.JWT_SECRET || (() => { throw new Error('JWT_SECRET env required'); })());
 *   node tests/_wave3_mobile_smoke.cjs
 * Сервер на :3120, mobile-app build уже скопирован в public/m/.
 *
 * 5 сценариев:
 *   1. test_pm → /personal-kanban → видит пустое состояние «Нет подэтапов» или подэтап
 *   2. test_pm → /personal-kanban-config → создаёт substage
 *   3. Светлая тема: переключение, токены применены
 *   4. Тёмная тема обратно: без регрессий
 *   5. test_director → /director-inbox → видит список заявок
 */
'use strict';

const { chromium } = require('playwright');
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || (() => { throw new Error('JWT_SECRET env required'); })();
const BASE   = process.env.BASE || 'http://127.0.0.1:3120';
const PM      = { id: 4610, login: 'test_pm', role: 'PM' };
const DIR     = { id: 4594, login: 'test_director', role: 'DIRECTOR_GEN' };

function sign(u) {
  return jwt.sign({ id: u.id, login: u.login, role: u.role, pinVerified: true }, SECRET, { expiresIn: '1h' });
}

let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log(`PASS  ${name}` + (info ? `  ${info}` : '')); }
  else      { fail++; console.log(`FAIL  ${name}` + (info ? `  ${info}` : '')); }
}

function normHex(s) { return (s || '').trim().toLowerCase(); }

async function gotoMobile(page, token, path, theme) {
  // SPA: загружаем index.html и сразу выставляем token+тему ДО первого render-cycle
  await page.goto(`${BASE}/m/index.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ tok, th, p }) => {
    try { localStorage.setItem('asgard_token', tok); } catch (e) {}
    try { localStorage.setItem('asgard_theme', th); } catch (e) {}
    // Гасим PresenceGate за все возможные сегодняшние даты (UTC+любая локаль)
    const now = new Date();
    for (let offset = -1; offset <= 1; offset++) {
      const d = new Date(now.getTime() + offset * 86400000);
      const ymd = d.toISOString().slice(0, 10);
      try { localStorage.setItem('presence_done_' + ymd, '1'); } catch (e) {}
    }
    if (th === 'light') document.documentElement.classList.add('light');
    else document.documentElement.classList.remove('light');
    history.replaceState(null, '', `/m${p || '/'}`);
  }, { tok: token, th: theme || 'dark', p: path });
  // Принудительно перейти, чтобы router зафиксировал путь
  await page.goto(`${BASE}/m${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800);
}

(async () => {
  console.log('=== Wave-3 mobile-app smoke ===');
  console.log(`BASE=${BASE}`);

  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const console_errors = [];

  try {
    // ─── Scenario 1: test_pm → /personal-kanban ─────────────────────────
    {
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        ignoreHTTPSErrors: true,
      });
      const page = await ctx.newPage();
      page.on('console', (msg) => {
        if (msg.type() === 'error') console_errors.push(`[s1] ${msg.text()}`);
      });
      page.on('pageerror', (err) => { errors.push(`[s1 pageerror] ${err.message}`); });

      await gotoMobile(page, sign(PM), '/personal-kanban', 'dark');

      // Title в PageShell — h1 с font-bold tracking-tight
      const titleVisible = await page.locator('h1:has-text("Мой канбан")').first().isVisible({ timeout: 5000 }).catch(() => false);
      const debugHtml = !titleVisible ? await page.locator('body').innerText().catch(() => '(?)') : '';
      check('S1: /personal-kanban загружается (title visible)', titleVisible,
        !titleVisible ? `body=${debugHtml.slice(0, 200)}` : '');

      const flowTabsVisible = await page.locator('button:has-text("Заявки")').first().isVisible({ timeout: 3000 }).catch(() => false);
      check('S1: переключатель flow_type виден', flowTabsVisible);

      const hasEmpty = await page.locator('h3:has-text("Нет подэтапов"), p:has-text("Пусто")').first().isVisible({ timeout: 2000 }).catch(() => false);
      const hasSubstage = await page.locator('h2').count() > 0;
      check('S1: показано либо пустое состояние, либо подэтап',
        hasEmpty || hasSubstage,
        `empty=${hasEmpty}, substage_h2=${hasSubstage}`);

      await ctx.close();
    }

    // ─── Scenario 2: /personal-kanban-config — создаём substage ─────────
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      page.on('console', (msg) => { if (msg.type() === 'error') console_errors.push(`[s2] ${msg.text()}`); });
      page.on('pageerror', (err) => { errors.push(`[s2 pageerror] ${err.message}`); });

      await gotoMobile(page, sign(PM), '/personal-kanban-config', 'dark');

      const titleVisible = await page.locator('h1:has-text("Подэтапы канбана")').first().isVisible({ timeout: 5000 }).catch(() => false);
      check('S2: /personal-kanban-config загружается', titleVisible);

      const inputVisible = await page.locator('input[placeholder*="Название"]').first().isVisible({ timeout: 3000 }).catch(() => false);
      check('S2: форма создания видна', inputVisible);

      if (inputVisible) {
        const ts = Date.now();
        const newTitle = `Smoke ${ts}`;
        await page.locator('input[placeholder*="Название"]').first().fill(newTitle);
        await page.waitForTimeout(150);
        await page.locator('button:has-text("Создать")').first().click();
        await page.waitForTimeout(1500);
        const found = await page.locator(`button:has-text("${newTitle}")`).first().isVisible({ timeout: 2000 }).catch(() => false);
        check('S2: подэтап создан и виден в списке', found, found ? newTitle : 'не найден');
      }

      await ctx.close();
    }

    // ─── Scenario 3: Светлая тема ───────────────────────────────────────
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      page.on('console', (msg) => { if (msg.type() === 'error') console_errors.push(`[s3] ${msg.text()}`); });
      page.on('pageerror', (err) => { errors.push(`[s3 pageerror] ${err.message}`); });

      await gotoMobile(page, sign(PM), '/personal-kanban', 'light');

      const hasLightClass = await page.evaluate(() => document.documentElement.classList.contains('light'));
      check('S3: class="light" применён', hasLightClass);

      const bgPrimary = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--bg-primary'));
      check('S3: --bg-primary в светлой теме = #F2F2F7', normHex(bgPrimary) === '#f2f2f7',
        `actual=${bgPrimary}`);

      const textPrimary = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--text-primary'));
      check('S3: --text-primary в светлой теме = #1C1C1E', normHex(textPrimary) === '#1c1c1e',
        `actual=${textPrimary}`);

      // Проверяем что цвет фона body НЕ ТОТ ЖЕ что в тёмной — отдельная тема
      const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      check('S3: bg body не чёрный (#0a0a0c)',
        bodyBg !== 'rgb(10, 10, 12)',
        `actual=${bodyBg}`);

      const titleVisible = await page.locator('h1:has-text("Мой канбан")').first().isVisible({ timeout: 3000 }).catch(() => false);
      check('S3: заголовок виден в светлой теме', titleVisible);

      await ctx.close();
    }

    // ─── Scenario 4: Тёмная тема обратно ────────────────────────────────
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      page.on('console', (msg) => { if (msg.type() === 'error') console_errors.push(`[s4] ${msg.text()}`); });
      page.on('pageerror', (err) => { errors.push(`[s4 pageerror] ${err.message}`); });

      await gotoMobile(page, sign(PM), '/personal-kanban', 'dark');

      const hasLightClass = await page.evaluate(() => document.documentElement.classList.contains('light'));
      check('S4: class="light" отсутствует (тёмная)', !hasLightClass);

      const bgPrimary = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--bg-primary'));
      check('S4: --bg-primary в тёмной = #0a0a0c', normHex(bgPrimary) === '#0a0a0c',
        `actual=${bgPrimary}`);

      const titleVisible = await page.locator('h1:has-text("Мой канбан")').first().isVisible({ timeout: 3000 }).catch(() => false);
      check('S4: заголовок виден в тёмной теме', titleVisible);

      await ctx.close();
    }

    // ─── Scenario 5: test_director → /director-inbox ────────────────────
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      page.on('console', (msg) => { if (msg.type() === 'error') console_errors.push(`[s5] ${msg.text()}`); });
      page.on('pageerror', (err) => { errors.push(`[s5 pageerror] ${err.message}`); });

      await gotoMobile(page, sign(DIR), '/director-inbox', 'dark');

      const titleVisible = await page.locator('h1:has-text("Корзина заявок")').first().isVisible({ timeout: 5000 }).catch(() => false);
      check('S5: /director-inbox загружается под директором', titleVisible);

      const filterVisible = await page.locator('button:has-text("Новые")').first().isVisible({ timeout: 3000 }).catch(() => false);
      check('S5: фильтры видны', filterVisible);

      await page.waitForTimeout(2000);
      const hasEmpty = await page.locator('text=/Корзина пуста|Нет заявок/i').first().isVisible({ timeout: 2000 }).catch(() => false);
      // Карточки заявок: содержат либо svg иконку Mail/Forward, либо текст «(без темы)»
      const cardCount = await page.locator('button').count();
      check('S5: показан список либо пустое состояние',
        hasEmpty || cardCount > 5,
        `cardCount=${cardCount}, empty=${hasEmpty}`);

      await ctx.close();
    }
  } finally {
    await browser.close();
  }

  console.log('');
  console.log(`=== ИТОГ: pass=${pass}, fail=${fail} ===`);
  if (errors.length) {
    console.log('--- pageerror ---');
    errors.slice(0, 20).forEach((e) => console.log(e));
  }
  if (console_errors.length) {
    // Фильтруем 500 — могут быть от auth/me пинающего после смены токена
    const filtered = console_errors.filter((e) => !/Failed to load resource|500/.test(e));
    console.log(`--- console.error (total=${console_errors.length}, filtered=${filtered.length}) ---`);
    (filtered.length ? filtered : console_errors).slice(0, 30).forEach((e) => console.log(e));
  }
  process.exit(fail > 0 ? 1 : 0);
})();
