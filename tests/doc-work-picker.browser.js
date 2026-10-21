'use strict';
// D-331: закупщик (PROC) должен выбирать объект в карточке реестра счетов.
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
  console.log('\n=== D-331: выбор объекта в карточке счёта (закупщик PROC) ===');
  const u = (await db.query("SELECT id, login, name, role FROM users WHERE role='PROC' AND is_active ORDER BY id LIMIT 1")).rows[0];
  console.log(' пользователь:', u.name, '(' + u.role + ')');
  const token = jwt.sign({ id: u.id, login: u.login, name: u.name, role: u.role, pinVerified: true }, SECRET, { expiresIn: '1h' });

  // Берём строку реестра с spend_kind, НЕ равным work (это и был проблемный случай)
  const doc = (await db.query(`SELECT id, invoice_number, spend_kind FROM doc_registry
    WHERE deleted_at IS NULL AND COALESCE(spend_kind,'other') <> 'work' ORDER BY id DESC LIMIT 1`)).rows[0];
  console.log(' документ:', doc ? '#' + doc.id + ' №' + doc.invoice_number + ' spend_kind=' + doc.spend_kind : 'нет');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  await page.addInitScript(({ t, usr }) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('asgard_user', JSON.stringify(usr));
  }, { t: token, usr: { id: u.id, login: u.login, name: u.name, role: u.role } });

  await page.goto(`${BASE}/#/doc-hub`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);

  await page.evaluate((id) => window.AsgardDocHubPage && window.AsgardDocHubPage.openDrawer(id), doc.id);
  await page.waitForTimeout(3500);

  const st = await page.evaluate(() => {
    const f = document.getElementById('drWorkField');
    const host = document.getElementById('drWork_w');
    const hidden = f ? getComputedStyle(f).display === 'none' : null;
    const trig = host ? host.querySelector('.cr-select__trigger, button, select') : null;
    return {
      fieldExists: !!f,
      fieldHidden: hidden,
      hostExists: !!host,
      hasControl: !!trig,
      controlText: trig ? trig.textContent.trim().slice(0, 50) : null
    };
  });
  console.log(' состояние:', JSON.stringify(st));

  if (st.fieldExists) ok('блок «Работа / объект» есть в карточке');
  else bad('блока объекта нет');
  if (st.fieldExists && !st.fieldHidden) ok('блок ВИДЕН даже при spend_kind != work (был скрыт)');
  else bad('блок скрыт — закупщик не может выбрать объект');
  if (st.hasControl) ok('есть контрол выбора: ' + JSON.stringify(st.controlText));
  else bad('контрол выбора не отрисован');

  // Открываем список и считаем опции
  if (st.hasControl) {
    await page.evaluate(() => {
      const h = document.getElementById('drWork_w');
      const t = h ? h.querySelector('.cr-select__trigger, button, select') : null;
      if (t) t.click();
    });
    await page.waitForTimeout(1400);
    const opts = await page.evaluate(() => {
      const drops = [...document.querySelectorAll('[class*="drop"]')].filter((d) => !d.hidden && d.offsetParent !== null);
      const items = drops.flatMap((d) => [...d.querySelectorAll('[role="option"], button, li')]);
      return items.map((i) => (i.textContent || '').trim()).filter(Boolean);
    });
    console.log(' опций в списке:', opts.length, opts.slice(0, 3));
    if (opts.length > 1) ok('список объектов доступен закупщику: ' + opts.length + ' вариантов');
    else bad('список объектов пуст или не открылся');
  }

  if (!errs.length) ok('ошибок JS нет');
  else bad('ошибки JS: ' + errs.slice(0, 2).join(' | '));

  await browser.close();
  await db.end();
  console.log('\nИТОГ: ' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('ERR', e.message); process.exit(1); });
