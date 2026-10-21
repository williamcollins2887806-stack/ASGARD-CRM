'use strict';
/**
 * Порядок гейтов: неделя → день, без повторного вопроса про тот же день.
 *
 * Сценарий А: неделя заполнена, сегодняшний день ОТМЕЧЕН  → день не спрашиваем.
 * Сценарий Б: неделя заполнена, сегодняшний день ПУСТОЙ   → день спрашиваем.
 */
const { chromium } = require('playwright');
const { Client } = require('pg');

const BASE = 'http://127.0.0.1:3100';
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (d ? ' :: ' + d : '')); } };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

(async () => {
  const db = new Client({ database: 'asgard_crm_test', user: 'asgard', password: '123456789', host: '127.0.0.1' });
  await db.connect();
  const today = todayIso();

  const browser = await chromium.launch();

  async function freshPage() {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const lg = await page.request.post(BASE + '/api/auth/login', { data: { login: 'test_buh', password: 'Test123!' } });
    const lj = await lg.json();
    const t0 = lj.token || (lj.data && lj.data.token);
    const u = lj.user || (lj.data && lj.data.user);
    const pr = await page.request.post(BASE + '/api/auth/verify-pin', { headers: { Authorization: 'Bearer ' + t0 }, data: { pin: '0000' } });
    const pj = await pr.json();
    const token = pj.token || t0;
    await page.goto(BASE + '/', { waitUntil: 'commit' });
    await page.evaluate(([t, uu]) => {
      localStorage.setItem('asgard_token', t);
      localStorage.setItem('asgard_user', JSON.stringify(uu));
      if (uu && uu.permissions) localStorage.setItem('asgard_permissions', JSON.stringify(uu.permissions));
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && (k.indexOf('presence_done_') === 0 || k.indexOf('presence_week_done_') === 0)) localStorage.removeItem(k);
      }
    }, [token, u]);
    return page;
  }

  // ── Сценарий А: неделя заполнена, сегодня отмечен ──────────────────────
  console.log('=== А: неделя заполнена, сегодня ОТМЕЧЕН ===');
  await db.query(`
    DELETE FROM staff_plan sp USING staff s, users u
    WHERE sp.staff_id = s.id AND s.user_id = u.id AND u.login = 'test_buh'
      AND sp.date >= date_trunc('week', CURRENT_DATE)::date
      AND sp.date <  date_trunc('week', CURRENT_DATE)::date + 7`);
  // ставим сегодня «в офисе» — как будто заполнили неделю
  await db.query(`
    INSERT INTO staff_plan (staff_id, date, status_code, created_at, updated_at)
    SELECT s.id, $1::date, 'оф', NOW(), NOW()
      FROM staff s JOIN users u ON u.id = s.user_id WHERE u.login = 'test_buh'`, [today]);

  let page = await freshPage();
  await page.goto(BASE + '/#/home', { waitUntil: 'commit' });
  await page.waitForTimeout(7000);
  let st = await page.evaluate(() => ({
    week: !!document.getElementById('asgard-presence-week'),
    day: !!document.getElementById('asgard-presence-day'),
  }));
  check('А: недельный экран показан первым', st.week === true, 'week=' + st.week);
  check('А: дневной НЕ показывается (сегодня уже отмечен)', st.day === false, 'day=' + st.day);
  await page.close();

  // ── Сценарий Б: неделя заполнена, но сегодня пустой ────────────────────
  console.log('\n=== Б: неделя заполнена, сегодня ПУСТОЙ ===');
  await db.query(`
    DELETE FROM staff_plan sp USING staff s, users u
    WHERE sp.staff_id = s.id AND s.user_id = u.id AND u.login = 'test_buh'
      AND sp.date = $1::date`, [today]);
  // ставим «в офисе» на завтра — неделя как бы заполнена, сегодня нет
  await db.query(`
    INSERT INTO staff_plan (staff_id, date, status_code, created_at, updated_at)
    SELECT s.id, ($1::date + 1), 'оф', NOW(), NOW()
      FROM staff s JOIN users u ON u.id = s.user_id WHERE u.login = 'test_buh'
    ON CONFLICT DO NOTHING`, [today]);

  page = await freshPage();
  await page.goto(BASE + '/#/home', { waitUntil: 'commit' });
  await page.waitForTimeout(3000);
  await page.waitForSelector('#asgard-presence-week, #asgard-presence-day', { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1200);

  // Неделя спрашивает первой — отмечаем в ней завтрашний день, сегодня оставляем пустым.
  const weekShown = await page.$('#asgard-presence-week');
  check('Б: недельный экран показан первым', !!weekShown);

  if (weekShown) {
    // Отмечаем ЛЮБОЙ день, кроме сегодняшнего, чтобы неделя сохранилась,
    // а сегодня остался пустым.
    const marked = await page.evaluate((iso) => {
      const rows = Array.from(document.querySelectorAll('.pg-row[data-day-row]'));
      const target = rows.find((r) => r.getAttribute('data-day-row') !== iso);
      if (!target) return false;
      const trig = target.querySelector('.pg-trigger');
      if (trig) trig.click();
      return !!trig;
    }, today);
    await page.waitForTimeout(700);

    // Выбираем первый статус в открывшейся панели
    await page.evaluate(() => {
      const opt = document.querySelector('.pg-pop .pg-opt');
      if (opt) opt.click();
    });
    await page.waitForTimeout(500);

    // Сохраняем неделю
    await page.evaluate(() => {
      const b = document.querySelector('.pg-btn');
      if (b) b.click();
    });
    await page.waitForTimeout(4000);
  }

  // Теперь неделя закрыта — должен появиться дневной гейт, т.к. сегодня пустой.
  await page.waitForSelector('#asgard-presence-day', { timeout: 15000 }).catch(() => {});
  st = await page.evaluate(() => ({
    week: !!document.getElementById('asgard-presence-week'),
    day: !!document.getElementById('asgard-presence-day'),
  }));
  console.log('  после сохранения недели: week=' + st.week + ' day=' + st.day);
  check('Б: после недели спрашивают про сегодня', st.day === true, 'day=' + st.day);
  await page.close();

  await db.end();
  await browser.close();
  console.log('\nИТОГ: ' + (fail === 0 ? 'OK' : 'FAIL') + ' — ' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH:', e.message); process.exit(1); });
