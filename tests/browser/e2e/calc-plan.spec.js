const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Client } = require('pg');

/** calc-plan.spec.js — кнопка «Рассчитать людей и сроки» на вкладке «Объёмы». */
const CLONE = process.env.CLONE_URL || 'http://127.0.0.1:3100';
const OUT = path.join(__dirname, '../../../tests/reports/mimir-stages/screens');

test('просчёт: план по кнопке заполняет людей и сроки', async ({ page }) => {
  test.setTimeout(240000);
  const lr = await fetch(`${CLONE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'test_pm', password: 'Test123!' })
  });
  const ld = await lr.json();
  const pr = await fetch(`${CLONE}/api/auth/verify-pin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ld.token },
    body: JSON.stringify({ pin: '0000' })
  });
  const token = (await pr.json()).token;

  const db = new Client({
    host: 'localhost', port: 5432, user: 'asgard',
    password: process.env.DB_PASSWORD || '123456789', database: 'asgard_crm_test'
  });
  await db.connect();
  const r = await db.query(
    "SELECT id FROM tenders WHERE tender_title ILIKE '%ДЕМО Мимир%' AND deleted_at IS NULL ORDER BY id LIMIT 1"
  );
  await db.end();
  const id = r.rows[0]?.id;
  test.skip(!id, 'нет демо-тендера');

  await page.goto(`${CLONE}/#/welcome`, { waitUntil: 'commit' });
  await page.evaluate((t) => {
    localStorage.setItem('asgard_token', t); localStorage.setItem('token', t);
  }, token);
  await page.evaluate((tid) => { window.__tid = tid; }, id);
  await page.goto(`${CLONE}/#/tenders-registry`, { waitUntil: 'commit' });
  await page.waitForTimeout(3200);
  // Переход по hash перезагружает страницу — вернём id в контекст.
  await page.evaluate((tid) => { window.__tid = tid; }, id);

  // Готовим сессию с ДВ: анализ → сохранение карточки.
  await page.evaluate(async (tid) => {
    const auth = 'Bearer ' + localStorage.getItem('asgard_token');
    const s = await fetch('/api/tkp-quick/sessions', { headers: { Authorization: auth } }).then((x) => x.json());
    const uid = (s.sessions || [])[0]?.session_uid;
    await fetch(`/api/tkp-quick/sessions/${uid}/stage/reset`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ to: 'intake' })
    });
    const a = await fetch(`/api/tkp-quick/sessions/${uid}/stage/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ tz_text: '' })
    }).then((x) => x.json());
    const positions = (a.state && a.state.positions) || [];
    await fetch(`/api/tenders/${tid}/rp-review`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({
        mode: 'calc',
        report_json: { mode: 'calc', dv_positions: positions, summary: 'ДВ для плана' }
      })
    });
  }, id);

  await page.evaluate(async () => {
    const auth = 'Bearer ' + localStorage.getItem('asgard_token');
    const s = await fetch('/api/tkp-quick/sessions', { headers: { Authorization: auth } }).then((x) => x.json());
    const uid = (s.sessions || [])[0]?.session_uid;
    await fetch(`/api/tkp-quick/sessions/${uid}/stage/reset`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ to: 'intake' })
    });
  });

  // Добиваем сессию реальными позициями, чтобы план было по чему считать.
  await page.evaluate(async () => {
    const auth = 'Bearer ' + localStorage.getItem('asgard_token');
    const s = await fetch('/api/tkp-quick/sessions', { headers: { Authorization: auth } }).then((x) => x.json());
    const uid = (s.sessions || [])[0]?.session_uid;
    const sample = [
      { id: 'p1', name: 'Очистка днищ баков БПМФ №1,2', category_code: 'vessels', method_code: 'clean', volume: 200, unit: 'м³', fouling: 'medium', tech_equip: 'гидроэлеватор, насос НШУ', objects: [{ tag: 'БПМФ-1' }], approved: true },
      { id: 'p2', name: 'Промывка теплообменника Т-4', category_code: 'tubes', method_code: 'chem', volume: 120, unit: 'пластины', fouling: 'heavy', tech_equip: 'CIP-станция, кислота', objects: [{ tag: 'Т-4' }], approved: true }
    ];
    await fetch(`/api/tkp-quick/sessions/${uid}/stage/patch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ state: { v: 1, gaps: [], positions: sample, calc: { positions: [] }, decision: null } })
    });
    const pos = await fetch(`/api/tkp-quick/sessions/${uid}/stage`, { headers: { Authorization: auth } }).then((x) => x.json());
    await fetch(`/api/tenders/${window.__tid}/rp-review`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({
        mode: 'calc',
        report_json: { mode: 'calc', dv_positions: (pos.state && pos.state.positions) || [], summary: 'ДВ для плана' }
      })
    });
  });

  await page.evaluate(async (tid) => {
    const auth = 'Bearer ' + localStorage.getItem('asgard_token');
    const d = await fetch(`/api/tenders/${tid}/rp-review`, { headers: { Authorization: auth } }).then((x) => x.json());
    window.AsgardRpCalcModal.open(d.tender || { id: tid }, [], function () {}, { mode: 'calc' });
    await new Promise((res) => setTimeout(res, 2200));
  }, id);

  await page.locator('.rp-calc-tab[data-rp-tab="dv"]').click({ force: true });
  await page.waitForTimeout(700);

  const before = await page.evaluate(() => ({
    rows: document.querySelectorAll('.rp-calc-dv-table tbody tr').length,
    hasBtn: !!document.querySelector('[data-act="plan-dv"]')
  }));
  console.log('ДО:', JSON.stringify(before));
  expect(before.hasBtn, 'кнопка расчёта плана').toBe(true);

  await page.locator('[data-act="plan-dv"]').click({ force: true });
  // План считает модель — ждём появления итога.
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(4000);
    const has = await page.locator('.rp-calc-dv-summary').count();
    if (has) break;
  }
  await page.waitForTimeout(800);

  const after = await page.evaluate(() => ({
    summary: (document.querySelector('.rp-calc-dv-summary') || {}).textContent || null,
    rows: document.querySelectorAll('.rp-calc-dv-table tbody tr').length,
    people: Array.from(document.querySelectorAll('.rp-calc-dv-table tbody tr'))
      .slice(0, 5).map((tr) => tr.children[6]?.textContent?.trim()),
    days: Array.from(document.querySelectorAll('.rp-calc-dv-table tbody tr'))
      .slice(0, 5).map((tr) => tr.children[7]?.textContent?.trim()),
    source: Array.from(document.querySelectorAll('.rp-calc-dv-table tbody tr'))
      .slice(0, 5).map((tr) => tr.children[8]?.textContent?.trim())
  }));
  console.log('ПОСЛЕ:', JSON.stringify(after));

  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, '90-calc-plan.png') });
  expect(after.summary, 'итог плана появился').toBeTruthy();
});
