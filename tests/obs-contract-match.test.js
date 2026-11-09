/**
 * V475: сопоставление ОБС-счёта с договором субподряда.
 *
 * Зачем тест. Лимит существенности считается по конкретному договору, и
 * неверная привязка израсходует ЧУЖОЙ лимит — это уже деньги, а не косметика.
 * Поэтому проверяем не только «нашёл», но и «НЕ нашёл, когда неоднозначно»:
 * на проде 16 из 18 ОБС-счетов ссылаются на договоры ПОСТАВЩИКОВ
 * («12.03/1339», «БПТ/26-039»), и привязывать их к КР320п26 нельзя.
 *
 * Запуск: node tests/obs-contract-match.test.js
 * Требует клон БД asgard_crm_test (по правилу CLAUDE.md — не прод).
 */
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
const { Client } = require('pg');
const { matchObsContract } = require('../src/services/obs-contract-match');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

(async () => {
  const db = new Client({
    host: process.env.PGHOST || '127.0.0.1',
    port: parseInt(process.env.PGPORT || '5432', 10),
    database: process.env.PGDATABASE || 'asgard_crm_test',
    user: process.env.PGUSER || 'asgard',
    password: process.env.DB_PASSWORD,
  });
  await db.connect();
  const tag = 'V475-' + Date.now();

  // Изолируем тест: свои договоры в транзакции, прод-данные не трогаем.
  await db.query('BEGIN');

  try {
    console.log('=== 1. Пустое основание → ничего не привязываем ===');
    const empty = await matchObsContract(db, { contractLabel: '' });
    ok(empty.found === false && empty.reason === 'no_label', 'нет contract_label → no_label');

    console.log('\n=== 2. Договор поставщика НЕ путается с ОБС-договором ===');
    // На проде таких 16: в основании стоит договор поставщика.
    const supplierBasis = await matchObsContract(db, { contractLabel: '12.03/1339' });
    ok(supplierBasis.found === false, 'чужое основание «12.03/1339» → found=false (reason=' + supplierBasis.reason + ')');

    const supply2 = await matchObsContract(db, { contractLabel: 'БПТ/26-039' });
    ok(supply2.found === false, 'чужое основание «БПТ/26-039» → found=false');

    console.log('\n=== 3. Точное совпадение номера ОБС-договора ===');
    const subs = (await db.query(
      `INSERT INTO subcontract_agreements (number, agreement_date, customer_name, limit_amount)
       VALUES ($1, CURRENT_DATE, 'ООО «Тест-Заказчик»', 1000000) RETURNING id, number`,
      ['ТЕСТ-' + tag])).rows;
    const sub = subs[0];

    const exact = await matchObsContract(db, { contractLabel: sub.number });
    ok(exact.found === true && Number(exact.contract.id) === Number(sub.id),
      'точный номер найден (#' + (exact.contract && exact.contract.id) + ')');
    ok(exact.reason === 'exact', 'reason=exact');

    console.log('\n=== 4. Формулировки одного номера считаются тем же договором ===');
    for (const variant of [
      '№ ' + sub.number,
      '«' + sub.number + '»',
      'Договор ' + sub.number + ' от 04.05.2026',
    ]) {
      const r = await matchObsContract(db, { contractLabel: variant });
      ok(r.found === true && Number(r.contract.id) === Number(sub.id), '«' + variant + '» → тот же договор');
    }

    console.log('\n=== 5. Склеенные основания: берём тот, что совпал ===');
    // Реальный случай с прода: счёт А-2127, contract_label =
    // «КР320п26 от 04.05.2026; 26-16/2 от 16.02.2026».
    const glued = await matchObsContract(db, {
      contractLabel: sub.number + ' от 04.05.2026; 26-16/2 от 16.02.2026',
    });
    ok(glued.found === true && Number(glued.contract.id) === Number(sub.id),
      'из склейки выбран ОБС-договор');

    console.log('\n=== 6. Короткий номер не цепляет всё подряд ===');
    const short = await matchObsContract(db, { contractLabel: '26' });
    ok(short.found === false, 'основание «26» → found=false (reason=' + short.reason + ')');

    console.log('\n=== 7. Неоднозначность → не привязываем ===');
    // Второй договор с номером, содержащим первый, — обе ветки совпадут.
    const dup = (await db.query(
      `INSERT INTO subcontract_agreements (number, agreement_date, customer_name, limit_amount)
       VALUES ($1, CURRENT_DATE, 'ООО «Тест-Заказчик»', 500000) RETURNING id`,
      ['ТЕСТ-' + tag + '-ДОП'])).rows[0];
    // Основание, которое содержит оба номера одновременно — ambiguous.
    const ambig = await matchObsContract(db, {
      contractLabel: 'ТЕСТ-' + tag + ' / ТЕСТ-' + tag + '-ДОП',
    });
    ok(ambig.found === false && ambig.reason === 'ambiguous',
      'два кандидата → ambiguous, привязки нет (reason=' + ambig.reason + ')');
    await db.query('DELETE FROM subcontract_agreements WHERE id = $1', [dup.id]);

    console.log('\n=== 8. Чужой номер поставщика НЕ цепляется даже при одном ОБС на объекте ===');
    // Раньше fallback single_for_work молча брал единственный договор объекта.
    // Это съедало лимит чужим основанием («БПТ/26-039»). Теперь — только номер.
    const w = (await db.query(
      `INSERT INTO works (work_title, created_at) VALUES ($1::varchar, NOW()) RETURNING id`,
      ['Тест-объект ' + tag])).rows[0];
    await db.query('UPDATE subcontract_agreements SET work_id = $1 WHERE id = $2', [w.id, sub.id]);

    const byWork = await matchObsContract(db, {
      contractLabel: 'БПТ/26-039',
      workId: w.id,
    });
    ok(byWork.found === false,
      'чужой номер + один ОБС на объекте → found=false (reason=' + byWork.reason + ')');

    const byWorkExact = await matchObsContract(db, {
      contractLabel: sub.number,
      workId: w.id,
    });
    ok(byWorkExact.found === true && byWorkExact.reason === 'exact',
      'свой номер на том же объекте → exact');

    // Дефис в номере не должен ломать совпадение (КР-433п26 ≈ КР433п26).
    const hyphen = await matchObsContract(db, {
      contractLabel: String(sub.number).replace(/-/g, '') === String(sub.number)
        ? String(sub.number).replace(/([A-Za-zА-Яа-я]+)(\d)/, '$1-$2')
        : String(sub.number).replace(/-/g, ''),
    });
    ok(hyphen.found === true, 'дефис в номере не мешает (reason=' + hyphen.reason + ')');

    console.log('\n=== 9. Неактивный договор не предлагается ===');
    await db.query('UPDATE subcontract_agreements SET is_active = FALSE WHERE id = $1', [sub.id]);
    const inactive = await matchObsContract(db, { contractLabel: sub.number });
    ok(inactive.found === false, 'деактивированный договор → found=false (reason=' + inactive.reason + ')');
  } catch (e) {
    fail++;
    console.log('  FAIL исключение: ' + e.message);
  } finally {
    await db.query('ROLLBACK');
    await db.end();
  }

  console.log('\n─────────────────────────────');
  console.log('PASS: ' + pass + '   FAIL: ' + fail);
  process.exit(fail ? 1 : 0);
})();
