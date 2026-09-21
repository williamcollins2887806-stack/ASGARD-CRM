#!/usr/bin/env node
'use strict';
/**
 * verify_vt3_wms_map_live.js — ЖИВОЙ гейт вкладки «Карта склада» (V-T3, часть про 403).
 *
 * Почему отдельный гейт: заказчик видел в прод-консоли пачку
 *   POST /api/warehouse-map/floors/1/sync-locations 403 (Forbidden)
 * под ролью без WMS_WRITE (в WMS_WRITE только ADMIN/WAREHOUSE/CHIEF_ENGINEER/DIRECTOR_*,
 * см. src/routes/warehouse-map.js:7). Дефект D-158: авто-синк ЖИЛ ВНУТРИ refresh()
 * (read-поток) и бил 403 на КАЖДОЙ отрисовке. Решение заказчика (Вариант A):
 * убрать авто-синк, оставить кнопку «Синхр. QR».
 *
 * Этот гейт проверяет результат ЖИВЬЁМ, под ролью БЕЗ прав склада:
 *   1) вкладка «Карта» реально монтируется (canvas/объекты, не «Модуль карты не загружен»);
 *   2) за 25 с открытой карты НЕТ ни одного POST .../sync-locations (авто-синка нет);
 *   3) НЕТ ни одного ответа 403 на sync-locations (тот самый прод-симптом);
 *   4) кнопка «Синхр. QR» на месте — явное действие сохранено (заказчик: «оставить кнопку»);
 *   5) 0 JS-ошибок консоли и 0 ответов 5xx.
 *
 * Запуск: TEST_BASE_URL=http://127.0.0.1:3100 node tools/verify_vt3_wms_map_live.js
 */
const { chromium } = require('playwright');

const BASE = (process.env.TEST_BASE_URL || 'http://127.0.0.1:3100').replace(/\/$/, '');
const ROLE_LOGIN = process.env.VT3_LOGIN || 'test_pm';   // роль БЕЗ WMS_WRITE — именно её 403 и били
const ROLE_PASS = process.env.VT3_PASS || 'Test123!';

let pass = 0, fail = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  [OK] ' + name + (detail ? ' — ' + String(detail).slice(0, 180) : '')); }
  else { fail++; fails.push(name); console.log('  [FAIL] ' + name + (detail ? ' — ' + String(detail).slice(0, 220) : '')); }
}

async function login(loginName, password) {
  const lr = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: loginName, password }),
  }).then((r) => r.json());
  if (!lr.token) throw new Error('login: ' + JSON.stringify(lr).slice(0, 160));
  let token = lr.token, user = lr.user;
  if (lr.status === 'need_pin') {
    const pr = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: '0000' }),
    }).then((r) => r.json());
    token = pr.token || token; user = pr.user || user;
  }
  return { token, user };
}

(async () => {
  console.log('V-T3/карта: живой гейт 403 sync-locations. BASE=' + BASE + ' role=' + ROLE_LOGIN);
  const { token, user } = await login(ROLE_LOGIN, ROLE_PASS);
  if (!user) { console.error('FATAL: login без user'); process.exit(1); }
  console.log('  роль: ' + user.role + ' (WMS_WRITE=' + ['ADMIN', 'WAREHOUSE', 'CHIEF_ENGINEER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(user.role) + ')');

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(({ t, u }) => {
    try {
      localStorage.setItem('asgard_token', t);
      localStorage.setItem('auth_token', t);
      localStorage.setItem('asgard_user', JSON.stringify(u || {}));
      localStorage.setItem('asgard_pin_verified', 'true');
      localStorage.setItem('pin_unlocked_at', String(Date.now()));
      localStorage.setItem('asgard_theme', 'dark');
      localStorage.setItem('asgard_theme_chosen', '1');
      localStorage.setItem('asgard_v2_banner_dismissed', '1');
    } catch (_) {}
  }, { t: token, u: user });

  const syncPosts = [];
  const sync403 = [];
  const fivexx = [];
  const jsErrors = [];
  const page = await ctx.newPage();
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/api\/warehouse-map\/.*sync-locations/.test(r.url())) syncPosts.push(r.url().replace(BASE, ''));
  });
  page.on('response', (r) => {
    const u = r.url();
    if (r.status() === 403 && /sync-locations/.test(u)) sync403.push(u.replace(BASE, ''));
    if (r.status() >= 500) fivexx.push(r.status() + ' ' + u.replace(BASE, ''));
  });
  page.on('console', (m) => { if (m.type() === 'error') jsErrors.push(m.text().slice(0, 180)); });

  try {
    await page.goto(BASE + '/#/warehouse-v2?tab=map', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(9000);

    const st = await page.evaluate(() => {
      const body = document.querySelector('.wh2') || document.body;
      const host = document.querySelector('#wh2-map-host');
      return {
        hash: location.hash,
        hasHost: !!host,
        canvas: !!(host && host.querySelector('canvas')),
        hostText: host ? (host.textContent || '').trim().slice(0, 120) : '',
        hasSyncBtn: !!(host && host.querySelector('[data-a="sync"]')),
        syncBtnText: (host && (host.querySelector('[data-a="sync"]') || {}).textContent) || '',
      };
    });

    check('1. вкладка «Карта» смонтирована (canvas, модуль не пустой)',
      st.hasHost && st.canvas, 'hash=' + st.hash + ' canvas=' + st.canvas + ' text="' + st.hostText + '"');

    // Наблюдаем ещё 25 с открытой картой: авто-синка быть не должно.
    const postsBefore = syncPosts.length;
    await page.waitForTimeout(25000);
    check('2. за 25 с открытой карты — НОЛЬ авто-POST sync-locations',
      syncPosts.length === postsBefore,
      'POST-ов: ' + (syncPosts.length - postsBefore) + (syncPosts.length ? ' ' + JSON.stringify(syncPosts) : ''));

    check('3. НЕТ ответов 403 на sync-locations (прод-симптом закрыт)',
      sync403.length === 0, '403-ответов: ' + sync403.length + (sync403.length ? ' ' + JSON.stringify(sync403) : ''));

    check('4. кнопка «Синхр. QR» на месте (явное действие сохранено)',
      st.hasSyncBtn && /Синхр/i.test(st.syncBtnText),
      'кнопка=' + st.hasSyncBtn + ' текст="' + st.syncBtnText.trim() + '"');

    check('5. 0 JS-ошибок консоли', jsErrors.length === 0, jsErrors.length ? JSON.stringify(jsErrors.slice(0, 3)) : 'нет');
    check('6. 0 ответов 5xx', fivexx.length === 0, fivexx.length ? JSON.stringify(fivexx.slice(0, 3)) : 'нет');
  } finally {
    await browser.close();
  }

  console.log('\nИТОГ: ' + pass + ' PASS / ' + fail + ' FAIL');
  if (fail) { console.log('Провалы: ' + fails.join(' | ')); process.exit(1); }
  console.log('V-T3/карта: авто-синк и 403 подтверждённо устранены живьём.');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
