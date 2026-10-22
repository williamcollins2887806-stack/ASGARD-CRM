'use strict';
/**
 * Визуальная проверка присутствия: десктоп + мобильный, ОБЕ темы.
 * Особое внимание — «дырам»: пустое место между шапкой и подвалом
 * (когда данных нет, а контейнер растянут).
 */
const { chromium, devices } = require('playwright');
const { Client } = require('pg');
const path = require('path');
const fs = require('fs');

const BASE = 'http://127.0.0.1:3100';
const OUT = path.join(__dirname, '..', 'reports', 'presence-visual-2');
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (d ? ' :: ' + d : '')); } };

function isBlue(bg) {
  const m = String(bg).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return false;
  const [r, g, b] = [+m[1], +m[2], +m[3]];
  return b > r + 20 && b > 90;
}

async function login(page) {
  const lg = await page.request.post(BASE + '/api/auth/login', { data: { login: 'test_buh', password: 'Test123!' } });
  const lj = await lg.json();
  const t0 = lj.token || (lj.data && lj.data.token);
  const u = lj.user || (lj.data && lj.data.user);
  const pr = await page.request.post(BASE + '/api/auth/verify-pin', { headers: { Authorization: 'Bearer ' + t0 }, data: { pin: '0000' } });
  const pj = await pr.json();
  return { token: pj.token || t0, user: u };
}

(async () => {
  const db = new Client({ database: 'asgard_crm_test', user: 'asgard', password: '123456789', host: '127.0.0.1' });
  await db.connect();

  const browser = await chromium.launch();

  // ── ДЕСКТОП: дневной гейт в двух темах ────────────────────────────────
  console.log('=== ДЕСКТОП ===');
  {
    await db.query(`
      DELETE FROM staff_plan sp USING staff s, users u
      WHERE sp.staff_id = s.id AND s.user_id = u.id AND u.login = 'test_buh'
        AND sp.date = CURRENT_DATE`);
    await db.query(`
      INSERT INTO staff_plan (staff_id, date, status_code, created_at, updated_at)
      SELECT s.id, CURRENT_DATE, 'оф', NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day'
        FROM staff s JOIN users u ON u.id = s.user_id WHERE u.login = 'test_buh'`);

    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { token, user } = await login(page);
    await page.goto(BASE + '/', { waitUntil: 'commit' });
    await page.evaluate(([t, uu]) => {
      localStorage.setItem('asgard_token', t);
      localStorage.setItem('asgard_user', JSON.stringify(uu));
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && (k.indexOf('presence_done_') === 0 || k.indexOf('presence_week_done_') === 0)) localStorage.removeItem(k);
      }
    }, [token, user]);
    await page.goto(BASE + '/#/home', { waitUntil: 'commit' });

    // Ждём появления ЛЮБОГО окна присутствия
    await page.waitForSelector('.pg-scene, .pd-scene', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1200);

    // Для проверки визуала ДНЯ: ставим флаг недели по фактическому week_start
    // и «старим» updated_at, затем перезагружаем. Флаг ставим ДО навигации,
    // иначе гейт успевает показать неделю.
    const wkStart = await page.evaluate(async () => {
      const a = AsgardAuth.getAuth();
      const r = await fetch('/api/daily-presence/week', { headers: { Authorization: 'Bearer ' + a.token } });
      const j = await r.json();
      return j.week_start;
    });
    await db.query(`
      UPDATE staff_plan sp SET updated_at = NOW() - INTERVAL '1 day'
        FROM staff s, users u
       WHERE sp.staff_id = s.id AND s.user_id = u.id AND u.login = 'test_buh'
         AND sp.date = CURRENT_DATE`);

    await page.evaluate((k) => localStorage.setItem(k, '1'), 'presence_week_done_' + wkStart);
    // ВАЖНО: reload(), а не goto() — goto на тот же путь с другим хэшем
    // не перезагружает страницу, и старое окно недели остаётся в DOM.
    await page.reload({ waitUntil: 'commit' });
    await page.waitForSelector('#asgard-presence-day', { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(1200);
    check('десктоп: окно дня появилось', !!(await page.$('#asgard-presence-day')));

    // Диагностика при неудаче
    if (!(await page.$('#asgard-presence-day'))) {
      const diag = await page.evaluate(async () => {
        const a = AsgardAuth.getAuth();
        const r = await fetch('/api/daily-presence/today', { headers: { Authorization: 'Bearer ' + a.token } });
        const j = await r.json();
        const flags = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf('presence') === 0) flags.push(k + '=' + localStorage.getItem(k));
        }
        return { required: j.required, current: j.current, flags, weekDom: !!document.getElementById('asgard-presence-week'), scenes: document.querySelectorAll('.pg-scene,.pd-scene').length };
      });
      console.log('  ДИАГНОСТИКА: ' + JSON.stringify(diag));
      await page.close();
      await db.end();
      await browser.close();
      console.log('ИТОГ: FAIL — окно дня не появилось');
      process.exit(1);
    }

    for (const theme of ['dark', 'light']) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.waitForTimeout(700);

      const m = await page.evaluate(() => {
        const gate = document.getElementById('asgard-presence-day');
        if (!gate) return null;
        const card = gate.querySelector('.pd-gate');
        const body = gate.querySelector('.pd-body');
        const opts = gate.querySelector('.pd-opts');
        const btn = gate.querySelector('.pd-btn');
        const head = gate.querySelector('.pd-head');
        const foot = gate.querySelector('.pd-foot');
        const cr = card.getBoundingClientRect();
        const br = body.getBoundingClientRect();
        const or = opts.getBoundingClientRect();
        // «Дыра» — пустое место между низом сетки и верхом подвала
        const gap = Math.round(foot.getBoundingClientRect().top - or.bottom);
        // «Дыра» также — если body сильно выше контента
        const bodySlack = Math.round(br.height - (or.height + 20));
        return {
          cardW: Math.round(cr.width),
          cardH: Math.round(cr.height),
          gap,
          bodySlack,
          btnBg: getComputedStyle(btn).backgroundImage,
          cardBg: getComputedStyle(card).backgroundColor,
          textColor: getComputedStyle(card).color,
          tiles: gate.querySelectorAll('.pd-opt').length,
          overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
        };
      });
      console.log(`  ${theme}: ` + JSON.stringify(m));

      check(`десктоп ${theme}: карточка не шире 470`, m.cardW <= 470, 'w=' + m.cardW);
      check(`десктоп ${theme}: НЕТ дыры (зазор до подвала ≤ 40px)`, m.gap <= 40, 'gap=' + m.gap);
      check(`десктоп ${theme}: тело не пустует (slack ≤ 60)`, m.bodySlack <= 60, 'slack=' + m.bodySlack);
      check(`десктоп ${theme}: кнопка СИНЯЯ`, isBlue(m.btnBg), m.btnBg.slice(0, 60));
      check(`десктоп ${theme}: нет горизонтального скролла`, !m.overflowX);
      check(`десктоп ${theme}: плитки на месте`, m.tiles >= 6, 'плиток=' + m.tiles);

      await page.screenshot({ path: path.join(OUT, `desktop-${theme}.png`) });
    }
    await page.close();
  }

  // ── МОБИЛЬНЫЙ: режим дня, две темы ────────────────────────────────────
  console.log('\n=== МОБИЛЬНЫЙ ===');
  {
    await db.query(`
      DELETE FROM staff_plan sp USING staff s, users u
      WHERE sp.staff_id = s.id AND s.user_id = u.id AND u.login = 'test_buh'
        AND sp.date = CURRENT_DATE`);
    await db.query(`
      INSERT INTO staff_plan (staff_id, date, status_code, created_at, updated_at)
      SELECT s.id, CURRENT_DATE, 'оф', NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day'
        FROM staff s JOIN users u ON u.id = s.user_id WHERE u.login = 'test_buh'`);

    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    const { token, user } = await login(page);
    await page.goto(BASE + '/m/', { waitUntil: 'commit' });
    await page.evaluate(([t, uu]) => {
      localStorage.setItem('asgard_token', t);
      localStorage.setItem('asgard_user', JSON.stringify(uu));
      if (uu && uu.permissions) localStorage.setItem('asgard_permissions', JSON.stringify(uu.permissions));
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && (k.indexOf('presence_done_') === 0 || k.indexOf('presence_week_done_') === 0)) localStorage.removeItem(k);
      }
    }, [token, user]);
    await page.goto(BASE + '/m/', { waitUntil: 'commit' });
    await page.waitForTimeout(7000);

    // Для проверки мобильного дневного окна: ставим флаг недели и «старим» updated_at,
    // затем ПЕРЕЗАГРУЖАЕМ (goto не перезапускает SPA).
    const wkStartM = await page.evaluate(async () => {
      try {
        const a = JSON.parse(localStorage.getItem('asgard_user') || '{}');
        const t = localStorage.getItem('asgard_token');
        const r = await fetch('/api/daily-presence/week', { headers: { Authorization: 'Bearer ' + t } });
        const j = await r.json();
        return j.week_start;
      } catch (_) { return null; }
    });
    if (wkStartM) await page.evaluate((k) => localStorage.setItem(k, '1'), 'presence_week_done_' + wkStartM);
    await db.query(`
      UPDATE staff_plan sp SET updated_at = NOW() - INTERVAL '1 day'
        FROM staff s, users u
       WHERE sp.staff_id = s.id AND s.user_id = u.id AND u.login = 'test_buh'
         AND sp.date = CURRENT_DATE`);

    await page.reload({ waitUntil: 'commit' });
    await page.waitForTimeout(8000);

    const hasSheet = await page.$('.pgm-sheet');
    check('мобильный: окно присутствия появилось', !!hasSheet);

    if (hasSheet) {
      for (const theme of ['dark', 'light']) {
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
        await page.waitForTimeout(700);

        const m = await page.evaluate(() => {
          const sheet = document.querySelector('.pgm-sheet');
          const body = document.querySelector('.pgm-body');
          const last = document.querySelector('.pgm-days')?.lastElementChild;
          const foot = document.querySelector('.pgm-foot');
          const daypick = document.querySelector('.pgm-daypick');
          const sr = sheet.getBoundingClientRect();
          // «Дыра» — пустое место между последним блоком и подвалом
          const gap = (last && foot) ? Math.round(foot.getBoundingClientRect().top - last.getBoundingClientRect().bottom) : -1;
          return {
            sheetH: Math.round(sr.height),
            viewH: window.innerHeight,
            hasDayPick: !!daypick,
            tiles: document.querySelectorAll('.pgm-tile').length,
            gap,
            emptyBody: body ? Math.round(body.getBoundingClientRect().height) : 0,
            overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
            scrollable: document.documentElement.scrollHeight > window.innerHeight + 2,
          };
        });
        console.log(`  ${theme}: ` + JSON.stringify(m));

        check(`мобильный ${theme}: лист не выше экрана`, m.sheetH <= m.viewH + 2, `h=${m.sheetH} vh=${m.viewH}`);
        check(`мобильный ${theme}: сетка статусов есть (нет дыры)`, m.hasDayPick && m.tiles >= 6, 'tiles=' + m.tiles);
        check(`мобильный ${theme}: тело не пустое`, m.emptyBody > 80, 'bodyH=' + m.emptyBody);
        check(`мобильный ${theme}: зазор до подвала ≤ 40px`, m.gap <= 40, 'gap=' + m.gap);
        check(`мобильный ${theme}: нет горизонтального скролла`, !m.overflowX);

        await page.screenshot({ path: path.join(OUT, `mobile-${theme}.png`) });
      }
    }
    await ctx.close();
  }

  await db.end();
  await browser.close();
  console.log('\nСкриншоты: ' + OUT);
  console.log('ИТОГ: ' + (fail === 0 ? 'OK' : 'FAIL') + ' — ' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH:', e.message); process.exit(1); });
