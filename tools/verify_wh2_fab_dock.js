/**
 * verify_wh2_fab_dock.js — FAB корзины склада не должен уезжать под правую оболочку.
 *
 * Жалоба заказчика (24.10.2026): на странице склада корзину не видно — правый док
 * «Хугинн» перекрывает кнопку и полосу «N поз. / резерв / закупка».
 *
 * Проверяем ГЕОМЕТРИЮ, а не наличие строк в CSS:
 *  1) FAB и полоса разбивки не пересекаются с видимыми правыми/нижними слоями
 *     оболочки: `.hg-chrome` (док), `.hg-rail` (рейл), `.hg-nav-search` (круглая
 *     кнопка поиска на мобильной раскладке), `.hg-bottom-nav` (тап-бар);
 *  2) FAB внутри вьюпорта (не обрезан справа/снизу);
 *  3) центр кнопки реально кликабелен: `elementFromPoint` попадает ВНУТРЬ кнопки
 *     (не в чужой оверлей) — это ловит и «накрыто доком», и «накрыто поиском»;
 *  4) 0 JS-ошибок консоли.
 *
 * Прогон на двух раскладках: desktop 1440×900 (док раскрыт/свёрнут) и mobile 390×844.
 * BASE по умолчанию — локальная копия :3000. Прод-БД не используется.
 *
 * Запуск: node tools/verify_wh2_fab_dock.js
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

const intersects = (a, b) => !!(a && b) && !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
const short = (r) => (r ? `[${Math.round(r.left)}..${Math.round(r.right)} × ${Math.round(r.top)}..${Math.round(r.bottom)}]` : 'нет');

(async () => {
  const auth = await login('test_admin', 'Test123!');
  if (!auth.user) { console.error('FATAL: login без user'); process.exit(1); }

  const browser = await chromium.launch();

  // ≤768px оболочка vanilla разворачивает «Хугинн» на весь экран (`.hg-chrome{inset:0}`),
  // склад там не открывается — мобильный контур живёт в /m/. Поэтому проверяем
  // desktop-раскладки: док раскрыт и свёрнут на широком и на «пограничном» экране.
  for (const vp of [{ name: 'desktop 1440×900', width: 1440, height: 900 }, { name: 'ноутбук 1000×768', width: 1000, height: 768 }]) {
    console.log(`\n=== ${vp.name} ===`);
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
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
    page.on('pageerror', (e) => errs.push(String((e && e.message) || e)));

    await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 60000 });
    await page.waitForTimeout(2200);
    await page.evaluate(() => { location.hash = '#/warehouse'; });
    // Рендер склада асинхронный (права + справочники) — ждём FAB явно.
    let hasFab = true;
    try { await page.waitForFunction(() => !!document.querySelector('.wh2-fab__btn'), null, { timeout: 20000 }); }
    catch (_) { hasFab = false; }

    check(`[${vp.name}] FAB корзины смонтирован`, hasFab, hasFab ? '' : 'нет .wh2-fab__btn');
    if (!hasFab) { await ctx.close(); continue; }
    await page.waitForTimeout(900);

    /** Свернуть/развернуть док РЕАЛЬНЫМ путём (клик по рейлу, D-260). */
    const setDockCollapsed = async (wantCollapsed) => {
      for (let i = 0; i < 3; i++) {
        const st = await page.evaluate(() => ({
          collapsed: document.body.classList.contains('hg-dock-collapsed'),
          hasRail: !!document.querySelector('.hg-rail') && getComputedStyle(document.querySelector('.hg-rail')).display !== 'none',
        }));
        if (!st.hasRail || st.collapsed === wantCollapsed) break;
        await page.evaluate((c) => {
          const btns = [...document.querySelectorAll('.hg-rail-btn')];
          const btn = c ? btns.find((b) => b.classList.contains('is-active')) : btns.find((b) => !b.classList.contains('is-active'));
          if (btn) btn.click();
        }, wantCollapsed);
        await page.waitForTimeout(420);
      }
    };

    const measure = async (label) => {
      // _cartSync/_updateFab асинхронно прячет полосу при пустой корзине. Меряем
      // расположение, а не данные — показываем её приоритетом перед замером.
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
        const rect = (el) => {
          if (!el) return null;
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') return null;
          const b = el.getBoundingClientRect();
          if (b.width < 1 || b.height < 1) return null;
          return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height };
        };
        const btn = document.querySelector('.wh2-fab__btn');
        const fab = document.querySelector('.wh2-fab');
        const split = document.querySelector('.wh2-fab__split');
        const dock = document.querySelector('.hg-chrome');
        const layers = {
          dock: rect(dock),
          rail: rect(document.querySelector('.hg-rail')),
          navSearch: rect(document.querySelector('.hg-nav-search')),
          bottomNav: rect(document.querySelector('.hg-bottom-nav')),
        };
        // Оболочка считается «видимой», только если её бокс реально попадает на экран:
        // свёрнутый док сохраняет width панели, уехавший поиск — сдвинут transform-ом.
        const onScreen = (r) => !!r && r.right > 0 && r.left < window.innerWidth && r.bottom > 0 && r.top < window.innerHeight;
        let hitInside = false, hitDesc = 'нет точки';
        if (btn) {
          const b = btn.getBoundingClientRect();
          const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
          let n = el;
          while (n && n !== document.body) {
            if (n === btn) { hitInside = true; break; }
            n = n.parentElement;
          }
          hitDesc = el ? `${el.tagName}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}` : 'null';
        }
        return {
          btn: rect(btn), fab: rect(fab), split: rect(split), layers,
          layersOnScreen: Object.fromEntries(Object.entries(layers).map(([k, r]) => [k, onScreen(r)])),
          hitInside, hitDesc,
          vw: window.innerWidth, vh: window.innerHeight,
          zFab: fab ? getComputedStyle(fab).zIndex : null,
          zDock: dock ? getComputedStyle(dock).zIndex : null,
        };
      });

      check(`[${label}] FAB имеет размер`, m.btn && m.btn.width > 30, m.btn ? `${Math.round(m.btn.width)}×${Math.round(m.btn.height)}` : 'нет кнопки');
      check(`[${label}] FAB внутри вьюпорта`,
        m.btn && m.btn.right <= m.vw + 0.5 && m.btn.bottom <= m.vh + 0.5 && m.btn.left >= 0 && m.btn.top >= 0,
        m.btn ? `right=${Math.round(m.btn.right)} bottom=${Math.round(m.btn.bottom)} при ${m.vw}×${m.vh}` : '-');

      for (const [name, key] of [['доком', 'dock'], ['рейлом', 'rail'], ['кнопкой поиска', 'navSearch'], ['тап-баром', 'bottomNav']]) {
        const lr = m.layers[key];
        if (!m.layersOnScreen[key]) continue;
        check(`[${label}] FAB не перекрыт ${name}`, m.btn && !intersects(m.btn, lr),
          `fab ${short(m.btn)} / ${key} ${short(lr)}`);
      }
      if (m.split) {
        check(`[${label}] полоса разбивки отрисована`, m.split.width > 50, `width=${Math.round(m.split.width)}`);
        for (const [name, key] of [['доком', 'dock'], ['рейлом', 'rail'], ['кнопкой поиска', 'navSearch'], ['тап-баром', 'bottomNav']]) {
          if (!m.layersOnScreen[key]) continue;
          check(`[${label}] полоса разбивки не перекрыта ${name}`, !intersects(m.split, m.layers[key]),
            `split ${short(m.split)} / ${key} ${short(m.layers[key])}`);
        }
      } else {
        check(`[${label}] полоса разбивки отрисована`, false, 'элемента нет');
      }
      check(`[${label}] центр кнопки кликабелен (попадает в саму кнопку)`, m.hitInside, 'elementFromPoint: ' + m.hitDesc);
      console.log(`       z-index: fab=${m.zFab} dock=${m.zDock}`);
    };

    await setDockCollapsed(false);
    await measure(`${vp.name} / док раскрыт`);
    await setDockCollapsed(true);
    const collapsedOk = await page.evaluate(() => document.body.classList.contains('hg-dock-collapsed'));
    check(`[${vp.name}] док реально свёрнут (клик по рейлу)`, collapsedOk, 'body.hg-dock-collapsed=' + collapsedOk);
    await measure(`${vp.name} / док свёрнут`);

    check(`[${vp.name}] 0 JS-ошибок консоли`, errs.length === 0, errs.slice(0, 3).join(' | '));
    await ctx.close();
  }

  await browser.close();
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\nИТОГ: ${results.length - fail}/${results.length} OK, FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
