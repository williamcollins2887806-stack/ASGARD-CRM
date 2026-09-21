'use strict';
/**
 * D-205 репро: почему на /tasks под ADMIN падают #tasksList / #todoList.
 * Проверяем гипотезу «контейнер подменяется до завершения async-рендера».
 * Запуск: node tools/verify_tasks_render.js
 */
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const OUT = [];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const events = [];
  page.on('console', (m) => { if (m.type() === 'error') events.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', (e) => events.push('PAGE_ERROR: ' + e.message));

  // Логин ADMIN: login → verify-pin → инъекция localStorage (как в 99-console-audit).
  const loginResp = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'admin', password: 'admin123' })
  }).then((r) => r.json());
  const preToken = loginResp.token;
  const pinResp = await fetch(BASE + '/api/auth/verify-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + preToken },
    body: JSON.stringify({ pin: '1234' })
  }).then((r) => r.json());
  const token = pinResp.token;
  const user = pinResp.user || {};

  await page.goto(BASE + '/#/welcome', { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForFunction(() => !window.location.search.includes('_sw='), { timeout: 5000 }).catch(() => {});
  const inject = () => page.evaluate(({ t, u }) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('asgard_user', JSON.stringify(u));
    if (u.permissions) localStorage.setItem('asgard_permissions', JSON.stringify(u.permissions));
    if (u.menu_settings) localStorage.setItem('asgard_menu_settings', JSON.stringify(u.menu_settings));
  }, { t: token, u: user });
  try { await inject(); } catch (_) {
    await page.waitForFunction(() => !window.location.search.includes('_sw='), { timeout: 8000 }).catch(() => {});
    await inject();
  }

  await page.goto(BASE + '/#/tasks', { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForTimeout(4000);

  // Матрица: A — зайти и дать догрузиться; B — зайти и сразу уйти (гонка async-рендера).
  const relevant = (events) => events.filter((e) =>
    /Cannot set properties of null/.test(e) || /tasks\.js/.test(e));

  const scenarios = {};

  for (const [name, fastLeave] of [['A_settle', false], ['B_fast_leave', true]]) {
    const ev = [];
    const p = await ctx.newPage();
    p.on('console', (m) => { if (m.type() === 'error') ev.push('CONSOLE: ' + m.text()); });
    p.on('pageerror', (e) => ev.push('PAGE_ERROR: ' + e.message));
    await p.goto(BASE + '/#/tasks', { waitUntil: 'domcontentloaded', timeout: 25000 });
    if (fastLeave) {
      // уходим, пока /api/tasks/my и /api/tasks/todo ещё в полёте
      await p.waitForTimeout(120);
      await p.goto(BASE + '/#/home', { waitUntil: 'domcontentloaded', timeout: 25000 });
    }
    await p.waitForTimeout(3500);
    scenarios[name] = { errors: relevant(ev), all: ev.length };
    await p.close();
  }

  const probe = await page.evaluate(() => {
    const inDom = (sel) => !!document.querySelector(sel);
    return {
      hash: location.hash,
      hasTasksList: inDom('#tasksList'),
      hasTodoList: inDom('#todoList'),
    };
  });

  // D-205: детерминированная проверка — страницу убрали из DOM, затем вызвали рендеры.
  // До правки каждый из них падал `TypeError: Cannot set properties of null`.
  const guard = await page.evaluate(() => {
    const fails = [];
    if (!window.AsgardTasksPage) return ['AsgardTasksPage недоступен — гейт невозможен'];
    // уводим страницу из DOM
    const host = document.querySelector('.tasks-page');
    if (host) host.remove();
    for (const fn of ['renderTasksList', 'renderTodoList', 'renderCreatedTasksList']) {
      if (typeof window.AsgardTasksPage[fn] !== 'function') { fails.push(fn + ': не экспортирован'); continue; }
      try { window.AsgardTasksPage[fn](); }
      catch (e) { fails.push(fn + ': ' + e.message); }
    }
    return fails;
  });

  console.log(JSON.stringify({ probe, scenarios, guard }, null, 2));

  const bad = scenarios.A_settle.errors.length + scenarios.B_fast_leave.errors.length + guard.length;
  const pass = bad === 0;
  console.log(pass
    ? '\nИТОГ: OK — контейнеры защищены, ошибок #tasksList/#todoList нет (D-205 закрыт)'
    : '\nИТОГ: FAIL — дефект D-205 (null-контейнер без защиты): ' + guard.join('; '));
  await browser.close();
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
