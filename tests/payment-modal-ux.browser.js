'use strict';

/**
 * D-316b: UX-проверка модалки согласования (жалобы заказчика 21.10.2026).
 * ═══════════════════════════════════════════════════════════════════════════
 * Что именно проверяем — по каждой претензии:
 *   1. «зачем гигантское поле для перетаскивания? перекрывает рабочую полость»
 *      → зона загрузки ≤ 80px (было 1180px из-за глобального label{display:block});
 *   2. «не показывает сколько у поставщика счетов и договоров»
 *      → карточка контрагента с счётчиками docs/contracts;
 *   3. «договор просто заполнил поле, но не нашёл в базе, не отметил что есть»
 *      → выбор договора из реестра + отметка «найден/не найден»;
 *   4. «поле выбора объекта — просто ввод текста, как выбрать?»
 *      → объект выбирается из СПИСКА (data-work-search + выбранный объект);
 *   5. «а если это не объект, а офисные расходы?»
 *      → 4 вида расхода; для офиса/склада объект НЕ требуется и скрыт.
 */

const { chromium } = require('playwright');
const { Client } = require('pg');
const jwt = require('jsonwebtoken');

const BASE = process.env.DH_BASE || 'http://127.0.0.1:3101';
const SECRET = process.env.JWT_SECRET || 'asgard-jwt-secret-2026';
const db = new Client({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS', m); };
const bad = (m) => { fail++; console.log('  FAIL', m); };

(async () => {
  await db.connect();
  console.log('\n=== D-316b: UX модалки согласования ===');

  const u = (await db.query(`SELECT id, login, name, role FROM users WHERE role='PROC' AND is_active=true LIMIT 1`)).rows[0];
  if (!u) { console.error('нет PROC'); process.exit(1); }
  const token = jwt.sign({ id: u.id, login: u.login, name: u.name, role: u.role, pinVerified: true }, SECRET, { expiresIn: '1h' });

  // Поставщик с договором и счетами — чтобы счётчики были не нулевые.
  let sup = (await db.query(`SELECT s.id, s.name FROM suppliers s WHERE s.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM contracts c WHERE lower(trim(c.counterparty_name))=lower(trim(s.name)))
    LIMIT 1`)).rows[0];
  if (!sup) sup = (await db.query(`SELECT id, name FROM suppliers ORDER BY id LIMIT 1`)).rows[0];
  const work = (await db.query(`SELECT id, COALESCE(work_title,object_name) t FROM works WHERE deleted_at IS NULL ORDER BY id LIMIT 1`)).rows[0];

  const ins = await db.query(
    `INSERT INTO payment_invoices(status, supplier_name, supplier_id, amount, vat_amount, vat_rate,
       invoice_number, invoice_date, basis_type, work_id, work_hint, pay_timing, created_by, draft_updated_at)
     VALUES('draft',$1,$2,12345.00,2226.64,22,'UX-1',CURRENT_DATE,'contract',$3,$4,'immediate',$5,NOW())
     RETURNING id`, [sup.name, sup.id, work ? work.id : null, work ? work.t : null, u.id]);
  const id = ins.rows[0].id;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  await page.addInitScript(({ t, user }) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('asgard_user', JSON.stringify(user));
  }, { t: token, user: { id: u.id, login: u.login, name: u.name, role: u.role } });

  await page.goto(`${BASE}/#/procurement`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(7000);
  await page.evaluate(() => window.AsgardPaymentBatch.open());
  await page.waitForTimeout(500);
  await page.evaluate((d) => window.AsgardPaymentBatch.openDraft(d), id);
  await page.waitForTimeout(4000);

  // 1. Компактная загрузка
  const dropH = await page.evaluate(() => {
    const d = document.querySelector('.pbm-drop');
    return d ? Math.round(d.getBoundingClientRect().height) : null;
  });
  if (dropH != null && dropH <= 80) ok(`зона загрузки компактная: ${dropH}px (было 1180px)`);
  else bad(`зона загрузки слишком большая: ${dropH}px`);

  // 2. Карточка поставщика со счётчиками
  const card = await page.evaluate(() => {
    const c = document.querySelector('.pbm-card');
    if (!c) return null;
    const stats = c.querySelector('.pbm-card__stats');
    return {
      text: stats ? stats.innerText.replace(/\s+/g, ' ') : '',
      hasDocs: /\d+\s*сч/i.test(stats ? stats.innerText : ''),
      hasContracts: /\d+\s*договор/i.test(stats ? stats.innerText : ''),
      hasBadge: !!c.querySelector('.pbm-badge-ok, .pbm-badge-warn')
    };
  });
  if (card) ok('карточка контрагента показана');
  else bad('карточки контрагента нет');
  if (card && card.hasDocs) ok('видно число счетов в реестре');
  else bad('нет счётчика счетов: ' + (card ? card.text : '-'));
  if (card && card.hasContracts) ok('видно число договоров');
  else bad('нет счётчика договоров: ' + (card ? card.text : '-'));
  if (card && card.hasBadge) ok('есть отметка «работаем по договору» / «договора нет»');
  else bad('нет отметки о наличии договора');

  // 3-5. Вкладка «Условия»
  await page.evaluate(() => document.querySelector('.pbm-tab[data-tab="terms"]')?.click());
  await page.waitForTimeout(900);

  const terms = await page.evaluate(() => ({
    spendChips: [...document.querySelectorAll('[data-spend]')].map((b) => b.textContent.trim()),
    workPicked: !!document.querySelector('.pbm-picked'),
    workSearch: !!document.querySelector('[data-work-search]'),
    contractSelect: !!document.querySelector('[data-f="contract_type"]'),
    contractPickBtn: !!document.querySelector('[data-contract-pick]'),
    contractOptions: [...document.querySelectorAll('[data-f="contract_type"] option')].map((o) => o.value)
  }));

  if (terms.spendChips.length === 4) ok('4 вида расхода: ' + terms.spendChips.join(' / '));
  else bad('видов расхода: ' + terms.spendChips.length);
  if (terms.contractOptions.includes('office') === false && terms.spendChips.some((s) => /Офис/i.test(s))) {
    ok('есть офисные расходы — не всё по объекту');
  } else bad('нет варианта офисных расходов');
  if (terms.workPicked || terms.workSearch) ok('объект выбирается из списка/показан выбранным');
  else bad('нет выбора объекта');
  if (terms.contractSelect) ok('есть выбор договора (без договора / рамочный / разовая / по номеру)');
  else bad('нет выбора типа договора');
  if (terms.contractPickBtn) ok('есть кнопка «Выбрать договор из базы»');
  else bad('нет кнопки выбора договора из реестра');

  // Офисные расходы → объект НЕ требуется
  await page.evaluate(() => document.querySelector('[data-spend="office"]')?.click());
  await page.waitForTimeout(600);
  const office = await page.evaluate(() => ({
    workSec: !!document.querySelector('[data-work-sec]'),
    helpText: (document.querySelector('[data-spend-chips]')?.parentElement?.querySelector('.pbm-f__h') || {}).textContent || ''
  }));
  if (!office.workSec) ok('для офисных расходов блок объекта скрыт (объект не нужен)');
  else bad('для офиса всё ещё требуется объект');

  if (!errs.length) ok('ошибок JS нет');
  else bad('ошибки JS: ' + errs.slice(0, 2).join(' | '));

  await browser.close();
  await db.query('DELETE FROM payment_invoices WHERE id=$1', [id]);
  await db.end();
  console.log(`\nИТОГ: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
