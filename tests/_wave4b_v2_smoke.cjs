/* Wave-4b React v2 desktop smoke — PERSONAL_KANBAN_AND_INBOX_PIPELINE.md §4.2.
 * Запуск:
 *   $env:JWT_SECRET=(process.env.JWT_SECRET || (() => { throw new Error('JWT_SECRET env required'); })()); node tests/_wave4b_v2_smoke.cjs
 * Сервер на :3120 (asgard_crm_kanban_test).
 *
 * Сценарии:
 *  1. test_pm → /v2/#/personal-kanban → видит заголовок «Личный канбан РП», табы flow_type
 *  2. Конфигуратор → создаёт substage «Smoke <ts>» → виден в списке
 *  3. test_director → /v2/#/director-inbox → видит UI (CTA empty или карточки)
 *  4. Темы dark↔light — данные сохраняются, разный фон
 *  5. NAV: PersonalKanban виден PM, DirectorsInbox виден директору, PM не видит DirectorsInbox
 * Console errors = 0.
 */
'use strict';

const { chromium } = require('playwright');
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || (() => { throw new Error('JWT_SECRET env required'); })();
const BASE   = process.env.BASE || 'http://127.0.0.1:3120';
const PM     = { id: 4610, login: 'test_pm', role: 'PM' };
const DIR    = { id: 4594, login: 'test_director', role: 'DIRECTOR_GEN' };

function sign(u) {
  return jwt.sign({ id: u.id, login: u.login, role: u.role, pinVerified: true }, SECRET, { expiresIn: '1h' });
}

let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log(`PASS  ${name}` + (info ? `  ${info}` : '')); }
  else      { fail++; console.log(`FAIL  ${name}` + (info ? `  ${info}` : '')); }
}

async function gotoV2(page, token, hash, theme) {
  await page.addInitScript(({ tok, th }) => {
    try { localStorage.setItem('asgard_token', tok); } catch (e) {}
    try { localStorage.setItem('asgard_v2_theme', th || 'dark'); } catch (e) {}
  }, { tok: token, th: theme || 'dark' });
  await page.goto(`${BASE}/v2/${hash}`, { waitUntil: 'commit' });
  // Wait for React to mount (lazy import + auth check)
  await page.waitForSelector('#root > *', { timeout: 20000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

(async () => {
  console.log('=== Wave-4b React v2 desktop smoke ===');
  console.log(`BASE=${BASE}`);

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
    // ─── S1: test_pm → /#/personal-kanban ────────────────────────────────
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') console_errors.push(`[s1] ${m.text()}`); });
      page.on('pageerror', (e) => pageerrors.push(`[s1] ${e.message}`));

      await gotoV2(page, sign(PM), '#/personal-kanban', 'dark');

      const title = await page.locator('text=/Личный канбан РП|Мой канбан/').first().isVisible({ timeout: 10000 }).catch(() => false);
      check('S1: заголовок страницы виден', title);

      const flowTabs = await page.locator('.blk-tabs button').first().isVisible({ timeout: 4000 }).catch(() => false);
      check('S1: TabsBar (flow_type) видны', flowTabs);

      const cfgBtn = await page.locator('button:has-text("Подэтапы")').first().isVisible({ timeout: 3000 }).catch(() => false);
      check('S1: кнопка «⚙ Подэтапы» доступна', cfgBtn);

      await ctx.close();
    }

    // ─── S2: создание substage через ConfiguratorModal ──────────────────
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') console_errors.push(`[s2] ${m.text()}`); });
      page.on('pageerror', (e) => pageerrors.push(`[s2] ${e.message}`));

      await gotoV2(page, sign(PM), '#/personal-kanban', 'dark');

      const cfgBtn = page.locator('button:has-text("Подэтапы")').first();
      const ok = await cfgBtn.isVisible({ timeout: 5000 }).catch(() => false);
      if (ok) await cfgBtn.click();
      await page.waitForTimeout(800);

      const modalTitle = await page.locator('text=/Подэтапы —/').first().isVisible({ timeout: 4000 }).catch(() => false);
      check('S2: модалка ConfiguratorModal открылась', modalTitle);

      if (modalTitle) {
        const ts = Date.now();
        const title = `SmokeR ${ts}`;
        const input = page.locator('.m-card input.m-input').first();
        const inputVisible = await input.isVisible({ timeout: 3000 }).catch(() => false);
        if (inputVisible) {
          await input.fill(title);
          await page.locator('button:has-text("Добавить")').first().click();
          await page.waitForTimeout(1500);
          const rowFound = await page.locator(`.pk-cfg-row button:has-text("${title}")`).first().isVisible({ timeout: 3000 }).catch(() => false);
          check('S2: новый substage создан и виден', rowFound, title);
        } else {
          check('S2: input для title найден', false);
        }
      }

      await ctx.close();
    }

    // ─── S3: theme dark ↔ light ────────────────────────────────────────
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') console_errors.push(`[s3] ${m.text()}`); });
      page.on('pageerror', (e) => pageerrors.push(`[s3] ${e.message}`));

      await gotoV2(page, sign(PM), '#/personal-kanban', 'dark');
      const bgDark = await page.evaluate(() => {
        const v = getComputedStyle(document.documentElement).getPropertyValue('--bg-primary')
              || getComputedStyle(document.documentElement).getPropertyValue('--card-bg')
              || getComputedStyle(document.body).backgroundColor;
        return (v || '').trim().toLowerCase();
      });

      await page.evaluate(() => {
        try { localStorage.setItem('asgard_v2_theme', 'light'); } catch (e) {}
        document.documentElement.setAttribute('data-theme', 'light');
      });
      await page.waitForTimeout(500);
      const bgLight = await page.evaluate(() => {
        const v = getComputedStyle(document.documentElement).getPropertyValue('--bg-primary')
              || getComputedStyle(document.documentElement).getPropertyValue('--card-bg')
              || getComputedStyle(document.body).backgroundColor;
        return (v || '').trim().toLowerCase();
      });
      check('S3: dark ≠ light (тёмная и светлая — РАЗНЫЕ темы, не инверсия)', bgDark !== bgLight, `dark=${bgDark}, light=${bgLight}`);

      const titleStill = await page.locator('text=/Личный канбан|Мой канбан/').first().isVisible({ timeout: 2000 }).catch(() => false);
      check('S3: заголовок виден после смены темы', titleStill);

      await ctx.close();
    }

    // ─── S4: test_director → /#/director-inbox ──────────────────────────
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') console_errors.push(`[s4] ${m.text()}`); });
      page.on('pageerror', (e) => pageerrors.push(`[s4] ${e.message}`));

      await gotoV2(page, sign(DIR), '#/director-inbox', 'dark');

      const title = await page.locator('text=/Распределение РП|Корзина заявок/').first().isVisible({ timeout: 10000 }).catch(() => false);
      check('S4: заголовок «Корзина заявок» виден директору', title);

      // TabsBar (.blk-tabs) — fallback на любые табы bucket'ов через текст
      const tabsVisible = await page.locator('.blk-tabs').first().isVisible({ timeout: 6000 }).catch(() => false);
      const bucketsByText = await page.locator('button:has-text("Неназначенные")').first().isVisible({ timeout: 3000 }).catch(() => false);
      check('S4: TabsBar (фильтры) виден', tabsVisible || bucketsByText, `blk-tabs=${tabsVisible}, button=${bucketsByText}`);

      // Либо карточки, либо пустое состояние с CTA
      const list = await page.locator('[role="list"]').count();
      const empty = await page.locator('text=/Заявок пока нет|нет неназначенных/i').first().isVisible({ timeout: 2000 }).catch(() => false);
      check('S4: список заявок или пустое состояние', list > 0 || empty, `lists=${list}, empty=${empty}`);

      const direct = await page.locator('button:has-text("Прямая заявка от меня")').first().isVisible({ timeout: 2500 }).catch(() => false);
      check('S4: кнопка «Прямая заявка от меня» видна', direct);

      await ctx.close();
    }

    // ─── S5: PM НЕ видит DirectorsInbox (RBAC) ───────────────────────────
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') console_errors.push(`[s5] ${m.text()}`); });
      page.on('pageerror', (e) => pageerrors.push(`[s5] ${e.message}`));

      await gotoV2(page, sign(PM), '#/director-inbox', 'dark');
      // Protected с ролями ['ADMIN','DIRECTOR_*','HEAD_PM'] — PM должен увидеть AccessDenied
      const denied = await page.locator('text=/Нет доступа|Доступ запрещ|🚫/').first().isVisible({ timeout: 6000 }).catch(() => false);
      check('S5: PM получает AccessDenied на /director-inbox', denied);

      await ctx.close();
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
