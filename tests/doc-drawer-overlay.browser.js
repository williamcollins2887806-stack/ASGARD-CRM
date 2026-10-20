'use strict';

/**
 * D-306b: браузерная проверка оверлея карточки документа (клон :3101).
 * ═══════════════════════════════════════════════════════════════════════════
 * Ловит ровно те сценарии, на которых верификатор нашёл FAIL D3/D4:
 *   1. первое открытие карточки → оверлей ВКЛЮЧЁН (затемнение + клик по фону);
 *   2. сохранение той же карточки → оверлей НЕ переключается (нет мерцания);
 *   3. закрыл → открыл ТУ ЖЕ снова → оверлей ВКЛЮЧЁН (был FAIL: без затемнения);
 *   4. клик по фону закрывает карточку.
 *
 * Требует: приложение на :3101 (БД asgard_crm_test), chromium playwright.
 * Запуск: $env:JWT_SECRET='asgard-jwt-secret-2026'; node tests/doc-drawer-overlay.browser.js
 */

const { chromium } = require('playwright');
const { Client } = require('pg');
const jwt = require('jsonwebtoken');

const BASE = 'http://127.0.0.1:3101';
const SECRET = process.env.JWT_SECRET || 'asgard-jwt-secret-2026';
const db = new Client({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS', m); };
const bad = (m) => { fail++; console.log('  FAIL', m); };

(async () => {
  await db.connect();
  const u = (await db.query('SELECT id, login, name, role FROM users WHERE id=3471')).rows[0];
  const token = jwt.sign({ id: u.id, login: u.login, name: u.name, role: u.role, pinVerified: true }, SECRET, { expiresIn: '1h' });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

  // Сессия до загрузки приложения.
  await page.addInitScript(({ t, user }) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('asgard_user', JSON.stringify(user));
  }, { t: token, user: { id: u.id, login: u.login, name: u.name, role: u.role } });

  await page.goto(`${BASE}/#/doc-hub`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  // Документ берём ИЗ DOM: по умолчанию реестр в режиме «только мои»,
  // поэтому произвольный id из базы может отсутствовать на странице.
  const docId = await page.evaluate(() => {
    const tr = document.querySelector('#dhTableHost tr[data-id]');
    return tr ? Number(tr.getAttribute('data-id')) : null;
  });
  if (!docId) { console.error('в реестре нет строк — тест невозможен'); await browser.close(); await db.end(); process.exit(1); }
  console.log(`\n=== D-306b браузер: оверлей карточки (документ #${docId}) ===`);

  const ovState = () => page.evaluate(() => {
    const ov = document.getElementById('dhOverlay');
    const d = document.getElementById('dhDrawer');
    if (!ov || !d) return { missing: true };
    const cs = getComputedStyle(ov);
    return {
      drawerHidden: d.hidden,
      drawerDocId: d.dataset.docId || null,
      drawerOn: d.classList.contains('is-on'),
      ovHidden: ov.hidden,
      ovIsOn: ov.classList.contains('is-on'),
      opacity: cs.opacity,
      pointer: cs.pointerEvents
    };
  });

  const openDoc = async (id) => {
    const res = await page.evaluate((docId2) => {
      const tr = document.querySelector(`#dhTableHost tr[data-id="${docId2}"]`);
      if (!tr) return { found: false };
      const btn = tr.querySelector('[data-qa="open"]');
      if (btn) btn.click(); else tr.click();
      return { found: true, viaButton: !!btn };
    }, id);
    await page.waitForTimeout(1500);
    return res;
  };

  const closeDoc = async () => {
    await page.evaluate(() => {
      const b = document.getElementById('dhDrawerClose');
      if (b) b.click();
    });
    await page.waitForTimeout(900);
  };

  // ── Сценарий 1: первое открытие ──
  const r1 = await openDoc(docId);
  let s = await ovState();
  if (!r1.found) bad(`сценарий 1: строка ${docId} не найдена в DOM`);
  else if (s.drawerHidden === false && s.ovHidden === false && s.ovIsOn === true && Number(s.opacity) > 0.4 && s.pointer === 'auto') {
    ok(`сценарий 1: первое открытие — оверлей включён (opacity=${s.opacity}, pointer=${s.pointer})`);
  } else bad(`сценарий 1: оверлей не включился → ${JSON.stringify(s)}`);

  // ── Сценарий 2: сохранение той же карточки ──
  const flicker = await page.evaluate(async () => {
    const ov = document.getElementById('dhOverlay');
    if (!ov) return null;
    const seen = [];
    const mo = new MutationObserver(() => {
      seen.push({ hidden: ov.hidden, on: ov.classList.contains('is-on') });
    });
    mo.observe(ov, { attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
    const btn = document.getElementById('dhDrawerSave');
    if (btn) btn.click();
    await new Promise((r) => setTimeout(r, 3500));
    mo.disconnect();
    return seen;
  });
  if (flicker === null) bad('сценарий 2: оверлей не найден');
  else {
    const flips = flicker.filter((x) => x.hidden === true || x.on === false).length;
    if (flips === 0) ok(`сценарий 2: сохранение — оверлей не дёргался (мутаций: ${flicker.length}, выключений: 0)`);
    else bad(`сценарий 2: оверлей мигал при сохранении — выключений ${flips}`);
  }
  s = await ovState();
  if (s.drawerHidden === false && s.ovHidden === false && Number(s.opacity) > 0.4) {
    ok('сценарий 2: после сохранения карточка и оверлей на месте');
  } else bad(`сценарий 2: после сохранения оверлей/карточка пропали → ${JSON.stringify(s)}`);

  // ── Сценарий 3: закрыл → открыл ТУ ЖЕ снова (место FAIL D4) ──
  await closeDoc();
  s = await ovState();
  if (s.drawerHidden === true && s.ovHidden === true && s.ovIsOn === false) ok('сценарий 3: закрытие — карточка и оверлей погашены');
  else bad(`сценарий 3: после закрытия состояние не сброшено → ${JSON.stringify(s)}`);

  await openDoc(docId);
  s = await ovState();
  if (s.drawerHidden === false && s.ovHidden === false && s.ovIsOn === true && Number(s.opacity) > 0.4 && s.pointer === 'auto') {
    ok(`сценарий 3: повторное открытие ТОЙ ЖЕ карточки — оверлей включён (opacity=${s.opacity})`);
  } else bad(`сценарий 3 (был FAIL D4): повторное открытие той же без оверлея → ${JSON.stringify(s)}`);

  // ── Сценарий 4: клик по фону закрывает ──
  await page.evaluate(() => { const ov = document.getElementById('dhOverlay'); if (ov) ov.click(); });
  await page.waitForTimeout(900);
  s = await ovState();
  if (s.drawerHidden === true) ok('сценарий 4: клик по фону закрывает карточку');
  else bad(`сценарий 4: клик по фону не закрыл → ${JSON.stringify(s)}`);

  await browser.close();
  await db.end();
  console.log(`\nИТОГ: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('ERR', e.message); process.exit(1); });
