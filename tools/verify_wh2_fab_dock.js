/**
 * verify_wh2_fab_dock.js — FAB корзины склада не должен уезжать под док «Хугинн».
 *
 * Жалоба заказчика (24.10.2026): на странице склада кнопку корзины (и полосу
 * «N поз. / резерв / закупка») не видно — правый док/рейл накрывает её.
 *
 * Проверяем геометрию, а не наличие строк:
 *  1) FAB и бейдж-полоса не пересекаются с прямоугольником `.hg-chrome`
 *     (и с рейлом `.hg-rail`) ни в открытом доке, ни в свёрнутом;
 *  2) FAB реально виден: `document.elementFromPoint` в центре кнопки — сама кнопка,
 *     то есть её не перекрывает оверлей/док;
 *  3) FAB стоит в пределах вьюпорта с запасом 0 (не обрезан справа);
 *  4) 0 JS-ошибок консоли.
 *
 * Клиентская фича. Запуск: node tools/verify_wh2_fab_dock.js
 * BASE по умолчанию :3000 (локальная dev-копия), прод не трогаем.
 */
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const { chromium } = require('playwright');

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log(`${ok ? '[OK]' : '[FAIL]'} ${name}${detail ? ' — ' + detail : ''}`);
};

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

const intersects = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);

(async () => {
  const auth = await login('test_admin', 'Test123!');
  if (!auth.user) { console.error('FATAL: login без user'); process.exit(1); }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(({ token, user }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user || {}));
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user || {}));
    localStorage.setItem('asgard_theme', 'dark');
    localStorage.setItem('hg_dock_collapsed', '0');
  }, { token: auth.token, user: auth.user });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e && e.message || e)));
  await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 60000 });
  await page.waitForTimeout(2500);

  const gotoScreen = async () => {
    await page.evaluate(() => { location.hash = '#/warehouse'; });
    await page.waitForTimeout(1200);
  };

  /**
   * Свернуть/развернуть док РЕАЛЬНЫМ путём (клик по рейлу, D-260), а не подменой
   * классов body: иначе .hg-chrome сохраняет ширину панели и меряется фантомный бокс.
   */
  const setDockCollapsed = async (wantCollapsed) => {
    for (let i = 0; i < 3; i++) {
      const state = await page.evaluate(() => ({
        collapsed: document.body.classList.contains('hg-dock-collapsed'),
        hasRail: !!document.querySelector('.hg-rail'),
      }));
      if (!state.hasRail || state.collapsed === wantCollapsed) break;
      // клик по активной вкладке рейла сворачивает; по неактивной — раскрывает
      await page.evaluate((c) => {
        const btns = [...document.querySelectorAll('.hg-rail-btn')];
        const btn = c ? btns.find((b) => b.classList.contains('is-active')) : btns.find((b) => !b.classList.contains('is-active'));
        if (btn) btn.click();
      }, wantCollapsed);
      await page.waitForTimeout(400);
    }
  };

  const measure = async (label) => {
    // _cartSync/_updateFab асинхронно прячет полосу, если корзина пуста. Перед замером
    // геометрии показываем её приоритетом — меряем расположение, а не данные.
    await page.evaluate(() => {
      const s = document.querySelector('.wh2-fab__split');
      if (!s) return;
      if (!s.innerHTML.trim()) {
        s.innerHTML = '<span><b>9</b> поз.</span><span class="res">✅ <b>5</b> резерв</span><span class="buy">🛒 <b>4</b> закупка</span>';
      }
      s.style.setProperty('display', 'flex', 'important');
    });
    await page.waitForTimeout(120);
    const m = await page.evaluate(() => {
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
      const btn = document.querySelector('.wh2-fab__btn');
      const fab = document.querySelector('.wh2-fab');
      const dock = document.querySelector('.hg-chrome');
      const rail = document.querySelector('.hg-rail');
      const split = document.querySelector('.wh2-fab__split');
      let hit = null;
      if (btn) {
        const b = btn.getBoundingClientRect();
        const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        hit = el ? (el.className && typeof el.className === 'string' ? el.className : el.tagName) : null;
      }
      return {
        btn: r(btn), fab: r(fab), dock: r(dock), rail: r(rail), split: r(split),
        hit, dockVisible: dock ? getComputedStyle(dock).display !== 'none' && !dock.classList.contains('is-offscreen') : false,
        railVisible: rail ? getComputedStyle(rail).display !== 'none' : false,
        vw: window.innerWidth,
        zFab: fab ? getComputedStyle(fab).zIndex : null,
        zDock: dock ? getComputedStyle(dock).zIndex : null,
      };
    });
    check(`[${label}] FAB существует и имеет размер`, m.btn && m.btn.width > 30, m.btn ? `${Math.round(m.btn.width)}×${Math.round(m.btn.height)}` : 'нет .wh2-fab__btn');
    check(`[${label}] FAB внутри вьюпорта`, m.btn && m.btn.right <= m.vw + 0.5 && m.btn.left >= 0,
      m.btn ? `right=${Math.round(m.btn.right)} / vw=${m.vw}` : '-');
    if (m.dock && m.dockVisible) {
      check(`[${label}] FAB не пересекается с доком`, m.btn && !intersects(m.btn, m.dock),
        m.btn ? `fab.right=${Math.round(m.btn.right)} dock.left=${Math.round(m.dock.left)}` : '-');
      if (m.split) {
        check(`[${label}] полоса разбивки реально отрисована (ширина > 0)`, m.split.width > 50,
          `width=${Math.round(m.split.width)}`);
        check(`[${label}] полоса разбивки не пересекается с доком`, m.split.width > 0 && !intersects(m.split, m.dock),
          `split.right=${Math.round(m.split.right)} dock.left=${Math.round(m.dock.left)}`);
      }
    } else {
      console.log(`[skip] [${label}] док не виден — пересечение проверять нечего`);
    }
    if (m.rail && m.railVisible && m.dock && m.dockVisible) {
      check(`[${label}] FAB не пересекается с рейлом`, m.btn && !intersects(m.btn, m.rail),
        m.btn ? `fab.right=${Math.round(m.btn.right)} rail.left=${Math.round(m.rail.left)}` : '-');
    }
    check(`[${label}] центр кнопки кликабелен (не под оверлеем)`,
      typeof m.hit === 'string' && m.hit.includes('wh2-fab__btn'), 'elementFromPoint: ' + m.hit);
    console.log(`       z-index: fab=${m.zFab} dock=${m.zDock}`);
  };

  await gotoScreen();
  // Рендер склада асинхронный (loadRefs/права) — ждём FAB явно, а не «на глазок».
  let hasFab = false;
  try {
    await page.waitForFunction(() => !!document.querySelector('.wh2-fab__btn'), null, { timeout: 15000 });
    hasFab = true;
  } catch (_) {
    hasFab = await page.evaluate(() => !!document.querySelector('.wh2-fab__btn'));
  }
  if (!hasFab) {
    check('FAB корзины смонтирован на #/warehouse', false, 'нет .wh2-fab__btn — проверить hash/роль');
  } else {
    await setDockCollapsed(false);
    await measure('док открыт');
    await setDockCollapsed(true);
    const collapsedOk = await page.evaluate(() => document.body.classList.contains('hg-dock-collapsed'));
    check('док реально свёрнут (клик по рейлу)', collapsedOk, 'body.hg-dock-collapsed=' + collapsedOk);
    await measure('док свёрнут');
  }

  check('0 JS-ошибок консоли', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\nИТОГ: ${results.length - fail}/${results.length} OK, FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
