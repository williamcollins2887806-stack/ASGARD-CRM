/**
 * verify_brigade_cart.js — корзина бригады ЖИВЬЁМ в браузере (жалоба заказчика:
 * «нет кнопок добавить в корзину, корзина не открывается»).
 *
 * Проверяем пользовательский путь, а не наличие строк:
 *  1) страница #/personnel рендерится и бригада НЕ пустая (иначе кнопки судить не на чем);
 *  2) в строках есть кнопки [data-bc-toggle] «+» (добавить в корзину);
 *  3) клик по «+» → появляется полоса корзины (#bc_bar), счётчик = 1, значение persisted в localStorage;
 *  4) «Открыть корзину» → открывается drawer (#bc_drawer виден), в теле — тот же рабочий;
 *  5) 0 JS-ошибок консоли и 0 ответов 5xx за прогон.
 *
 * Клиентская фича; БД только читается (список рабочих). Прод-БД запрещена.
 */
process.env.DB_NAME = process.env.DB_NAME || 'asgard_crm_test';
if (process.env.DB_NAME === 'asgard_crm') { console.error('[bc] FAIL: прод-БД запрещена'); process.exit(1); }

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3101';
const { chromium } = require('playwright');

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: detail || '' }); console.log(`${ok ? '[OK]' : '[FAIL]'} ${name}${detail ? ' — ' + detail : ''}`); };

async function login(l, p) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: l, password: p }),
  });
  const j = await r.json();
  let token = j.token, user = j.user || null;
  if (j.status === 'need_pin' || j.status === 'need_setup') {
    const r2 = await fetch(`${BASE}/api/auth/verify-pin`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: '0000' }),
    });
    const j2 = await r2.json();
    if (j2.token) token = j2.token;
    if (j2.user) user = j2.user;
  }
  return { token, user };
}

(async () => {
  const admin = await login('test_admin', 'Test123!');
  if (!admin.user) { console.error('FATAL: login без user'); process.exit(1); }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();

  const errors = [];
  const fivexx = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 500) fivexx.push(r.status() + ' ' + r.url()); });

  await page.addInitScript(([t, u]) => {
    try {
      localStorage.setItem('asgard_token', t);
      localStorage.setItem('asgard_user', JSON.stringify(u));
      localStorage.setItem('asgard_permissions', JSON.stringify(u.permissions || {}));
      localStorage.setItem('asgard_menu_settings', JSON.stringify(u.menu_settings || {}));
    } catch (e) {}
  }, [admin.token, admin.user]);

  await page.goto(`${BASE}/#/personnel`, { waitUntil: 'commit' });
  await page.waitForTimeout(800);
  // дождаться отрисовки списка
  await page.waitForSelector('#prs_tbody tr, #prs_tbody .prs-row, [data-bc-toggle]', { timeout: 20000 }).catch(() => {});

  const rowInfo = await page.evaluate(() => ({
    page: location.hash,
    rows: document.querySelectorAll('#prs_tbody tr').length,
    toggles: document.querySelectorAll('[data-bc-toggle]').length,
    cartGlobal: typeof window.AsgardBrigadeCart,
  }));
  check('1. #/personnel отрисована', /personnel/.test(rowInfo.page), `hash=${rowInfo.page}`);
  check('2. BrigadeCart загружен', rowInfo.cartGlobal === 'object', `typeof=${rowInfo.cartGlobal}`);
  check('3. строки рабочих есть', rowInfo.rows > 0, `rows=${rowInfo.rows}`);
  check('4. кнопки «в корзину» есть', rowInfo.toggles > 0, `toggles=${rowInfo.toggles}`);
  if (rowInfo.toggles === 0) {
    check('4b. ПРИЧИНА: cartBtnHtml в строках', false,
      `personnel рендерит без кнопок; BrigadeCart=${rowInfo.cartGlobal}`);
  }

  // ── клик по «+» ────────────────────────────────────────────────────────────
  const first = await page.$('[data-bc-toggle]');
  let afterAdd = null;
  if (first) {
    await first.click();
    await page.waitForTimeout(400);
    afterAdd = await page.evaluate(() => {
      const bar = document.getElementById('bc_bar');
      const keys = Object.keys(localStorage).filter((k) => k.startsWith('asgard-brigade-cart:'));
      const ids = keys.length ? JSON.parse(localStorage.getItem(keys[0]) || '[]') : [];
      return { barHidden: bar ? bar.hidden : null, badge: (document.getElementById('bc_bar_n') || {}).textContent, stored: ids.length };
    });
    check('5. после клика полоса корзины показалась', afterAdd.barHidden === false, `hidden=${afterAdd.barHidden}`);
    check('6. счётчик корзины = 1', String(afterAdd.badge).trim() === '1', `badge=${afterAdd.badge}`);
    check('7. id persisted в localStorage', afterAdd.stored === 1, `stored=${afterAdd.stored}`);
  }

  // ── «Открыть корзину» ──────────────────────────────────────────────────────
  if (afterAdd && afterAdd.barHidden === false) {
    const openBtn = await page.$('#bc_bar_open');
    let drawer = null;
    if (openBtn) {
      await openBtn.click();
      await page.waitForTimeout(500);
      drawer = await page.evaluate(() => {
        const d = document.getElementById('bc_drawer');
        const body = document.getElementById('bc_drawer_body');
        return { hidden: d ? d.hidden : null, visible: d ? (d.offsetParent !== null || getComputedStyle(d).display !== 'none') : null, bodyLen: (body ? body.textContent.trim().length : 0) };
      });
      check('8. drawer корзины открылся', drawer.hidden === false, `hidden=${drawer.hidden}`);
      check('9. в корзине есть содержимое', drawer.bodyLen > 0, `bodyLen=${drawer.bodyLen}`);
    } else {
      check('8. кнопка «Открыть корзину» есть', false, 'нет #bc_bar_open');
    }
  }

  check('10. 0 JS-ошибок консоли', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('11. 0 ответов 5xx', fivexx.length === 0, fivexx.slice(0, 3).join(' | '));

  await page.screenshot({ path: 'tests/reports/_bc_probe.png', fullPage: false }).catch(() => {});
  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\nИТОГ: ${results.length - failed.length}/${results.length} OK${failed.length ? ' — FAIL: ' + failed.map((f) => f.name).join('; ') : ''}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
