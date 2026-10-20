'use strict';

/**
 * D-306c: UI-проверка приватности подписей в браузере (клон :3101).
 * ═══════════════════════════════════════════════════════════════════════════
 * На ОДНОМ аккаунте АГПЗ два человека. Проверяем глазами пользователя:
 *   1. A вписал ФИО в карточке и сохранил → поле показывает его значение;
 *   2. в фильтре «Под-ответственный» у A есть его ФИО;
 *   3. у B в фильтре этого ФИО НЕТ (и бейдж «только мои» на месте);
 *   4. в карточке того же документа у B поле подписи ПУСТОЕ.
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

async function mint(id) {
  const u = (await db.query('SELECT id, login, name, role FROM users WHERE id=$1', [id])).rows[0];
  return { u, token: jwt.sign({ id: u.id, login: u.login, name: u.name, role: u.role, pinVerified: true }, SECRET, { expiresIn: '1h' }) };
}

async function openAs(browser, who, docOwnerId) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.addInitScript(({ t, user }) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('asgard_user', JSON.stringify(user));
  }, { t: who.token, user: { id: who.u.id, login: who.u.login, name: who.u.name, role: who.u.role } });
  await page.goto(`${BASE}/#/doc-hub?scope=all`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  return page;
}

(async () => {
  await db.connect();
  console.log('\n=== D-306c: приватность подписей в UI ===');
  const A = await mint(3471);
  const B = await mint(4698);

  const browser = await chromium.launch();

  // ── A ставит подпись в карточке ──
  const pa = await openAs(browser, A);
  // Документ берём ИЗ DOM обеих сессий: порядок по умолчанию одинаковый
  // (invoice_date DESC), поэтому первая строка совпадёт.
  const docId = await pa.evaluate(() => {
    const tr = document.querySelector('#dhTableHost tr[data-id]');
    return tr ? Number(tr.getAttribute('data-id')) : null;
  });
  if (!docId) { console.error('нет строк в реестре'); await browser.close(); await db.end(); process.exit(1); }
  console.log('  (документ для проверки: #' + docId + ')');
  await db.query(`UPDATE doc_registry SET doc_owner_note=NULL, doc_owner_note_by=NULL WHERE id=$1`, [docId]);
  await pa.reload({ waitUntil: 'domcontentloaded' });
  await pa.waitForTimeout(6000);

  await pa.evaluate((id) => {
    const tr = document.querySelector(`#dhTableHost tr[data-id="${id}"]`);
    if (tr) { const b = tr.querySelector('[data-qa="open"]'); (b || tr).click(); }
  }, docId);
  await pa.waitForTimeout(1800);

  const hasField = await pa.evaluate(() => !!document.getElementById('drDocOwnerNote'));
  if (hasField) ok('A: поле «Под-ответственный» есть в карточке');
  else bad('A: поля подписи нет в карточке');

  await pa.evaluate(() => {
    const i = document.getElementById('drDocOwnerNote');
    if (i) { i.value = 'Пираев С.'; i.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await pa.evaluate(() => document.getElementById('dhDrawerSave')?.click());
  await pa.waitForTimeout(3500);

  const savedA = await pa.evaluate(() => {
    const i = document.getElementById('drDocOwnerNote');
    return i ? i.value : null;
  });
  if (savedA === 'Пираев С.') ok('A: подпись сохранена и видна в карточке');
  else bad('A: подпись не сохранилась/не видна: ' + JSON.stringify(savedA));

  // фильтр A
  await pa.evaluate(() => document.getElementById('dhDrawerClose')?.click());
  await pa.waitForTimeout(800);
  await pa.reload({ waitUntil: 'domcontentloaded' });
  await pa.waitForTimeout(6000);
  const notesA = await pa.evaluate(() => {
    const host = document.getElementById('dhFacetNotes');
    if (!host) return null;
    return [...host.querySelectorAll('.dh-ms__item')].map((i) => i.getAttribute('data-label')).filter(Boolean);
  });
  if (Array.isArray(notesA) && notesA.some((x) => String(x).toLowerCase().includes('пираев'))) ok('A: в фильтре есть его ФИО');
  else bad('A: в фильтре нет его ФИО: ' + JSON.stringify(notesA));

  const badge = await pa.evaluate(() => {
    const el = document.querySelector('.dh-facet__priv');
    return el ? el.textContent.trim() : null;
  });
  if (badge && /только мои/i.test(badge)) ok('A: бейдж «только мои» виден');
  else bad('A: бейджа «только мои» нет: ' + JSON.stringify(badge));

  // ── B: тот же аккаунт, не должен видеть подпись A ──
  const pb = await openAs(browser, B);
  const notesB = await pb.evaluate(() => {
    const host = document.getElementById('dhFacetNotes');
    if (!host) return null;
    return [...host.querySelectorAll('.dh-ms__item')].map((i) => i.getAttribute('data-label')).filter(Boolean);
  });
  if (Array.isArray(notesB) && !notesB.some((x) => String(x).toLowerCase().includes('пираев'))) ok('B: фасет есть, но чужого ФИО в нём нет');
  else if (notesB === null) ok('B: фасета нет (у B нет своих подписей — пустое состояние)');
  else if (!notesB.some((x) => String(x).toLowerCase().includes('пираев'))) ok('B: в фильтре НЕТ чужого ФИО');
  else bad('УТЕЧКА в UI: B видит ФИО A: ' + JSON.stringify(notesB));

  // карточка у B
  await pb.evaluate((id) => {
    const tr = document.querySelector(`#dhTableHost tr[data-id="${id}"]`);
    if (tr) { const b = tr.querySelector('[data-qa="open"]'); (b || tr).click(); }
  }, docId);
  await pb.waitForTimeout(1800);
  const fieldB = await pb.evaluate(() => {
    const i = document.getElementById('drDocOwnerNote');
    return i ? i.value : '<нет поля>';
  });
  if (fieldB === '') ok('B: в карточке поле подписи пустое (чужая не показана)');
  else bad('УТЕЧКА в карточке: B видит ' + JSON.stringify(fieldB));

  await browser.close();
  await db.query(`UPDATE doc_registry SET doc_owner_note=NULL, doc_owner_note_by=NULL WHERE id=$1`, [docId]);
  await db.end();
  console.log(`\nИТОГ: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('ERR', e.message); process.exit(1); });
