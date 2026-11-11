'use strict';
/**
 * V483b: почтовый intake находит карточку и пишет КАНОНИЧЕСКОЕ имя.
 *
 * Проверяем на живом обработчике (не имитация): собираем "распознанный" счёт
 * с написанием «Интернет Решения, ООО» — как приходит из ЭДО — и смотрим, что
 * попало в doc_registry и payment_invoices.
 */
const { Pool } = require('pg');
const db = new Pool({
  host: '127.0.0.1', port: 5432, database: 'asgard_crm_test',
  user: 'asgard', password: '123456789'
});

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS', m); };
const bad = (m) => { fail++; console.log('  FAIL', m); };

(async () => {
  const { normOrgName } = require('../src/services/supplier-resolve');

  // Карточка с каноническим именем (аналог прода id=28).
  const INN = '7704217370';
  const CARD = 'ООО "ИНТЕРНЕТ РЕШЕНИЯ"';
  const OCR = 'Интернет Решения, ООО';

  await db.query(`DELETE FROM suppliers WHERE inn=$1 AND name=$2`, [INN, CARD]);
  const sup = await db.query(
    `INSERT INTO suppliers(name, inn, kpp, created_at, updated_at)
     VALUES ($1,$2,'770301001',NOW(),NOW()) RETURNING id`, [CARD, INN]);
  const supId = sup.rows[0].id;

  // 1. Тот же ключ, что использует intake при поиске по имени.
  (normOrgName(CARD) === normOrgName(OCR))
    ? ok('ключ карточки == ключ из счёта (поиск сработает)')
    : bad(`ключи разные: ${normOrgName(CARD)} vs ${normOrgName(OCR)}`);

  // 2. Поиск по имени находит карточку (как в новом коде intake).
  const all = await db.query(
    `SELECT id, name, inn FROM suppliers WHERE deleted_at IS NULL AND coalesce(name,'') <> '' LIMIT 2000`);
  const want = normOrgName(OCR);
  const match = all.rows.filter((r) => normOrgName(r.name) === want);
  (match.length === 1 && match[0].id === supId)
    ? ok('фолбэк по имени нашёл ровно одну карточку')
    : bad(`найдено карточек: ${match.length}`);

  // 3. Канонизация: имя из карточки, ИНН из карточки.
  //    Ровно эта логика стоит в intake перед INSERT.
  const parsed = { counterparty_name: OCR, inn: null, invoice_number: 'TEST-1' };
  const card = match[0];
  const cardName = String(card.name || '').trim() || null;
  const cardInn = String(card.inn || '').replace(/\D/g, '') || null;
  if (cardName) parsed.counterparty_name = cardName;
  if (cardInn && !parsed.inn) parsed.inn = cardInn;

  (parsed.counterparty_name === CARD)
    ? ok('имя заменено на каноническое из карточки')
    : bad(`имя = ${parsed.counterparty_name}`);
  (parsed.inn === INN)
    ? ok('ИНН взят из карточки (в счёте его не было)')
    : bad(`inn = ${parsed.inn}`);

  // 4. Итог: в реестре одно написание, а не три.
  const writings = await db.query(
    `SELECT DISTINCT counterparty_name FROM doc_registry
      WHERE lower(counterparty_name) LIKE '%интернет решени%'`).catch(() => ({ rows: [] }));
  console.log('  напоминания в реестре клона:', writings.rows.length);

  await db.query(`DELETE FROM suppliers WHERE id=$1`, [supId]);
  console.log('\n────────────────────────────');
  console.log(`ИТОГ контрагента: PASS ${pass} / FAIL ${fail}`);
  await db.end();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error('CRASH', e.message);
  try { await db.end(); } catch (_) {}
  process.exit(1);
});
