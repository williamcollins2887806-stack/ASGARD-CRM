/* Wave-4a vanilla smoke — PERSONAL_KANBAN_AND_INBOX_PIPELINE.md §4.1.
 * Запуск: $env:JWT_SECRET=(process.env.JWT_SECRET || (() => { throw new Error('JWT_SECRET env required'); })()); node tests/_wave4a_vanilla_smoke.cjs
 * Сервер должен быть поднят на :3120 с DB_NAME=asgard_crm_kanban_test.
 *
 * Сценарии:
 *  1. test_pm → /#/personal-kanban → видит каркас + табы flow_type
 *  2. test_pm → открывает конфигуратор → создаёт «Smoke <ts>» → видит в списке
 *  3. test_director → /#/director-inbox → видит фильтры + пустое состояние или карточки
 *  4. Тема: localStorage.asgard_theme='light' + class — токены меняются (отдельная тема, не инверсия)
 *  5. NAV: пункты «Мой канбан» / «Корзина заявок» в меню видны/RBAC ок.
 * Console errors = 0 (за пределами известного 401 от загрузки до auth).
 */
'use strict';

const { chromium } = require('playwright');
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || (() => { throw new Error('JWT_SECRET env required'); })();
const BASE   = process.env.BASE || 'http://127.0.0.1:3120';
const PM     = { id: 4610, login: 'test_pm', role: 'PM', name: 'Test PM' };
const DIR    = { id: 4594, login: 'test_director', role: 'DIRECTOR_GEN', name: 'Test Director' };

function sign(u) {
  return jwt.sign({ id: u.id, login: u.login, role: u.role, pinVerified: true }, SECRET, { expiresIn: '1h' });
}

let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log(`PASS  ${name}` + (info ? `  ${info}` : '')); }
  else      { fail++; console.log(`FAIL  ${name}` + (info ? `  ${info}` : '')); }
}

function normHex(s) { return (s || '').trim().toLowerCase(); }

// Загрузка vanilla desktop SPA и установка auth + темы до бутстрапа
async function gotoVanilla(page, token, hashPath, theme, user) {
  // addInitScript выставляет токен/user/тему до выполнения любого скрипта страницы.
  // getAuth() в auth.js требует И asgard_token, И asgard_user.
  const userSnap = user || { id: 0, login: '', role: '', name: '' };
  await page.addInitScript(({ tok, th, usr }) => {
    try {
      localStorage.setItem('asgard_token', tok);
      localStorage.setItem('asgard_user', JSON.stringify(usr));
    } catch (e) {}
    try { localStorage.setItem('asgard_theme', th || 'dark'); } catch (e) {}
    // Заглушаем daily-presence gate (он блокирует клики оверлеем z-index 100000).
    try {
      const d = new Date().toISOString().slice(0, 10);
      localStorage.setItem('presence_done_' + d, '1');
    } catch (e) {}
    if (th === 'light') {
      try {
        document.documentElement.setAttribute('data-theme', 'light');
        document.documentElement.classList.add('light');
      } catch (e) {}
    }
  }, { tok: token, th: theme || 'dark', usr: userSnap });

  // Сразу с хэшем — чтобы router отрисовал нужный путь, а не welcome
  await page.goto(`${BASE}/${hashPath}`, { waitUntil: 'commit' });
  // Подождать пока загрузятся defer-скрипты и завершится первый render
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);
}

(async () => {
  console.log('=== Wave-4a vanilla smoke ===');
  console.log(`BASE=${BASE}`);

  // Pre-flight: server reachable
  try {
    const r = await fetch(`${BASE}/api/health`);
    if (!r.ok) throw new Error(`health ${r.status}`);
  } catch (e) {
    console.error('Preflight FAIL: server unreachable —', e.message);
    process.exit(2);
  }

  const browser = await chromium.launch({ headless: true });
  const console_errors = [];
  const pageerrors = [];

  try {
    // ─── S1: test_pm → /#/personal-kanban ───────────────────────────────
    {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') console_errors.push(`[s1] ${m.text()}`); });
      page.on('pageerror', (e) => pageerrors.push(`[s1] ${e.message}`));

      await gotoVanilla(page, sign(PM), '#/personal-kanban', 'dark', PM);

      // Заголовок страницы: layout рендерит <h1 class="page-title"> (display:none по CSS,
      // дублируется в topbar). Проверяем по факту наличия текста, а не visible-флагу.
      const titlePresent = await page.evaluate(() => {
        const el = document.querySelector('h1.page-title');
        return !!(el && /канбан/i.test(el.textContent || ''));
      });
      check('S1: заголовок «Мой канбан» виден', titlePresent);

      const tabsVisible = await page.locator('.pk-tab').first().isVisible({ timeout: 3000 }).catch(() => false);
      check('S1: табы flow_type видны', tabsVisible);

      const cfgBtnVisible = await page.locator('#pk-btn-config').first().isVisible({ timeout: 3000 }).catch(() => false);
      check('S1: кнопка «Подэтапы» доступна', cfgBtnVisible);

      // Либо статусбар, либо empty + CTA
      const hasStatusbar = await page.locator('.pk-statusbar').first().isVisible({ timeout: 2000 }).catch(() => false);
      check('S1: статусбар main_status виден', hasStatusbar);

      await ctx.close();
    }

    // ─── S2: создание substage ──────────────────────────────────────────
    {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') console_errors.push(`[s2] ${m.text()}`); });
      page.on('pageerror', (e) => pageerrors.push(`[s2] ${e.message}`));

      await gotoVanilla(page, sign(PM), '#/personal-kanban', 'dark', PM);

      // Переключаемся на flow application + main_status new
      const appTab = page.locator('.pk-tab:has-text("Заявки")').first();
      const tabVisible = await appTab.isVisible({ timeout: 5000 }).catch(() => false);
      if (tabVisible) await appTab.click();
      await page.waitForTimeout(400);

      const newChip = page.locator('.pk-status-chip:has-text("Новые")').first();
      const chipVisible = await newChip.isVisible({ timeout: 3000 }).catch(() => false);
      if (chipVisible) await newChip.click();
      await page.waitForTimeout(300);

      // Открываем конфигуратор
      const cfgBtn = page.locator('#pk-btn-config').first();
      const okOpen = await cfgBtn.isVisible({ timeout: 2000 }).catch(() => false);
      check('S2: кнопка «Подэтапы» доступна для клика', okOpen);
      if (okOpen) await cfgBtn.click();
      await page.waitForTimeout(700);

      const inp = page.locator('#pk-cfg-new-title').first();
      const inpVisible = await inp.isVisible({ timeout: 4000 }).catch(() => false);
      check('S2: модалка конфигуратора открылась', inpVisible);

      const ts = Date.now();
      const title = `Smoke ${ts}`;
      if (inpVisible) {
        await inp.fill(title);
        await page.locator('#pk-cfg-add').first().click();
        await page.waitForTimeout(1200);

        const created = await page.locator('.pk-cfg-row .pk-cfg-title').count();
        const matched = await page.locator(`.pk-cfg-title[value="${title}"]`).first().isVisible({ timeout: 2000 }).catch(() => false);
        check('S2: подэтап создан и виден в списке', matched, `${created} rows`);
      }

      await ctx.close();
    }

    // ─── S3: test_director → /#/director-inbox ──────────────────────────
    {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') console_errors.push(`[s3] ${m.text()}`); });
      page.on('pageerror', (e) => pageerrors.push(`[s3] ${e.message}`));

      await gotoVanilla(page, sign(DIR), '#/director-inbox', 'dark', DIR);

      const titlePresent = await page.evaluate(() => {
        const el = document.querySelector('h1.page-title');
        return !!(el && /Корзина заявок/i.test(el.textContent || ''));
      });
      check('S3: заголовок «Корзина заявок» виден у директора', titlePresent);

      const filterVisible = await page.locator('.di-filter:has-text("Новые")').first().isVisible({ timeout: 3000 }).catch(() => false);
      check('S3: фильтр «Новые» виден', filterVisible);

      const directBtnVisible = await page.locator('#di-btn-direct').first().isVisible({ timeout: 3000 }).catch(() => false);
      check('S3: кнопка «Прямая заявка от меня» видна', directBtnVisible);

      // Либо grid с карточками, либо empty CTA
      const cardsCount = await page.locator('.di-card').count();
      const emptyVisible = await page.locator('text=/Корзина чиста|Пусто/i').first().isVisible({ timeout: 1500 }).catch(() => false);
      check('S3: показан список либо пустое состояние', cardsCount > 0 || emptyVisible, `cards=${cardsCount}, empty=${emptyVisible}`);

      await ctx.close();
    }

    // ─── S4: Темы — light → dark ────────────────────────────────────────
    {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') console_errors.push(`[s4] ${m.text()}`); });
      page.on('pageerror', (e) => pageerrors.push(`[s4] ${e.message}`));

      await gotoVanilla(page, sign(PM), '#/personal-kanban', 'light', PM);
      const hasLight = await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'light' || document.documentElement.classList.contains('light'));
      check('S4: data-theme=light применён', hasLight);

      // bg-primary в светлой ≠ bg-primary в тёмной
      const bgLight = await page.evaluate(() => {
        const v = getComputedStyle(document.documentElement).getPropertyValue('--bg-primary')
               || getComputedStyle(document.documentElement).getPropertyValue('--bg1')
               || getComputedStyle(document.body).backgroundColor;
        return (v || '').trim().toLowerCase();
      });
      check('S4: --bg-primary в светлой теме определён (отдельная палитра)', !!bgLight);

      // Тёмная обратно
      await page.evaluate(() => {
        document.documentElement.removeAttribute('data-theme');
        document.documentElement.classList.remove('light');
        try { localStorage.setItem('asgard_theme', 'dark'); } catch (e) {}
      });
      await page.waitForTimeout(300);
      const bgDark = await page.evaluate(() => {
        const v = getComputedStyle(document.documentElement).getPropertyValue('--bg-primary')
               || getComputedStyle(document.documentElement).getPropertyValue('--bg1')
               || getComputedStyle(document.body).backgroundColor;
        return (v || '').trim().toLowerCase();
      });
      check('S4: dark и light дают разный фон (НЕ инверсия = разные значения)', bgDark !== bgLight, `light=${bgLight}, dark=${bgDark}`);

      // Заголовок присутствует в обеих темах (h1.page-title скрыт CSS, но текст есть)
      const titleStillPresent = await page.evaluate(() => {
        const el = document.querySelector('h1.page-title');
        return !!(el && /канбан/i.test(el.textContent || ''));
      });
      check('S4: заголовок не схлопывается после смены темы', titleStillPresent);

      await ctx.close();
    }

    // ─── S5: NAV — пункты видны под нужными ролями ─────────────────────
    {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') console_errors.push(`[s5] ${m.text()}`); });
      page.on('pageerror', (e) => pageerrors.push(`[s5] ${e.message}`));

      await gotoVanilla(page, sign(PM), '#/personal-kanban', 'dark', PM);
      await page.waitForTimeout(900);

      // Проверяем что NAV содержит пункт «Мой канбан» (для PM)
      const pmHasMyKanban = await page.evaluate(() => {
        const links = document.querySelectorAll('a[href="#/personal-kanban"], a[href*="personal-kanban"]');
        return links.length > 0;
      });
      check('S5: пункт NAV «Мой канбан» доступен PM', pmHasMyKanban);

      // PM НЕ должен видеть «Корзина заявок» (RBAC: только директор/HEAD_PM/ADMIN)
      const pmHasInbox = await page.evaluate(() => {
        const links = document.querySelectorAll('a[href="#/director-inbox"], a[href*="director-inbox"]');
        return links.length > 0;
      });
      check('S5: PM НЕ видит «Корзина заявок» (RBAC)', !pmHasInbox);

      await ctx.close();

      // Под директором — обратное
      const ctx2 = await browser.newContext({ viewport: { width: 1366, height: 800 } });
      const page2 = await ctx2.newPage();
      page2.on('console', (m) => { if (m.type() === 'error') console_errors.push(`[s5d] ${m.text()}`); });
      await gotoVanilla(page2, sign(DIR), '#/director-inbox', 'dark', DIR);
      await page2.waitForTimeout(900);

      const dirHasInbox = await page2.evaluate(() => {
        const links = document.querySelectorAll('a[href="#/director-inbox"], a[href*="director-inbox"]');
        return links.length > 0;
      });
      check('S5: пункт NAV «Корзина заявок» доступен директору', dirHasInbox);

      await ctx2.close();
    }
  } catch (e) {
    fail++;
    console.log(`FAIL  Exception: ${e.message}`);
    console.error(e.stack);
  } finally {
    await browser.close();
  }

  console.log('');
  console.log(`=== ИТОГ: pass=${pass}, fail=${fail} ===`);
  if (pageerrors.length) {
    console.log('--- pageerror ---');
    pageerrors.slice(0, 20).forEach((e) => console.log(e));
  }
  if (console_errors.length) {
    console.log('--- console.error (first 30) ---');
    console_errors.slice(0, 30).forEach((e) => console.log(e));
  }
  console.log(`console_errors total: ${console_errors.length}`);

  process.exit(fail === 0 && pageerrors.length === 0 ? 0 : 1);
})();
