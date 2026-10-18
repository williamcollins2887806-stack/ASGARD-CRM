/**
 * V406: сопоставление договора и работы по данным из счёта.
 * Закрывает FAIL независимого верификатора 17.10.2026:
 *   • ложная привязка ЧУЖОГО договора по короткому номеру («26» → «ГНШ-26/…»);
 *   • «Объект: ЖК Северный, корпус 3» не находил работу (уточнение «корпус 3»
 *     ломало полное вхождение подстроки).
 */
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
const { Client } = require('pg');
const { matchContract, matchWork, normContractNo } = require('../src/services/contract-match');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

(async () => {
  const db = new Client({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
  await db.connect();
  const tag = 'V406-' + Date.now();

  console.log('=== 1. Нормализация номера ===');
  ok(normContractNo('№ ДП-2025/01') === 'дп-2025/01', 'normContractNo убирает № и пробелы');
  ok(normContractNo('') === '', 'пустой номер → пусто');

  console.log('\n=== 2. Ложная привязка по короткому номеру НЕ должна срабатывать ===');
  // Договор с «26» внутри длинного номера — как в находке верификатора.
  const longNo = 'ГНШ-26/11000/00120/Р-' + tag;
  const c1 = (await db.query(
    `INSERT INTO contracts(number, counterparty_name, subject, status) VALUES ($1,'ООО «ЧУЖОЙ»','проверка','active') RETURNING id`, [longNo])).rows[0];
  const short = await matchContract(db, { number: '26' });
  ok(short.found === false, 'короткий номер «26» НЕ цепляет чужой договор (found=' + short.found + ', reason=' + short.reason + ')');

  console.log('\n=== 3. Точный номер находится ===');
  const exact = await matchContract(db, { number: longNo });
  ok(exact.found === true && Number(exact.contract.id) === Number(c1.id), 'точный номер найден детерминированно (#' + (exact.contract && exact.contract.id) + ')');

  console.log('\n=== 4. Несуществующий номер не создаёт и не подставляет ===');
  const ghost = await matchContract(db, { number: 'НЕТ-ТАКОГО-' + tag });
  ok(ghost.found === false, 'несуществующий договор → found=false (reason=' + ghost.reason + ')');

  console.log('\n=== 5. Работа по объекту с уточнением «корпус N» ===');
  const wt = 'ЖК Северный ' + tag;
  const w = (await db.query(
    `INSERT INTO works(work_title, object_name, created_at) VALUES ($1::varchar, $2::varchar, NOW()) RETURNING id`, [wt, wt])).rows[0];
  const mw = await matchWork(db, 'Объект: ' + wt + ', корпус 3');
  ok(mw.found === true && Number(mw.work.id) === Number(w.id), 'работа найдена, несмотря на «корпус 3» (#' + (mw.work && mw.work.id) + ')');

  console.log('\n=== 6. Неоднозначность → НЕ привязываем (лучше пусто, чем чужая работа) ===');
  // Две РАЗНЫЕ работы, содержащие одно и то же значимое слово, и подсказка без
  // точного совпадения → привязывать нельзя (риск чужой работы).
  const w2 = (await db.query(
    `INSERT INTO works(work_title, object_name, created_at) VALUES ($1::varchar, $2::varchar, NOW()) RETURNING id`,
    ['ЖК Северный-2 ' + tag, 'ЖК Северный-2 ' + tag])).rows[0];
  const amb = await matchWork(db, 'Северный');
  ok(amb.found === false || Number(amb.work?.id) === Number(w.id), 'две похожие работы → без слепой привязки (reason=' + amb.reason + ')');

  // уборка: и первая работа, и дубль, и договор
  await db.query(`DELETE FROM contracts WHERE id = ANY($1::int[])`, [[c1.id]]).catch(() => {});
  await db.query(`DELETE FROM works WHERE id = ANY($1::int[])`, [[w.id, w2.id]]).catch(() => {});
  // страховка от артефактов прошлых упавших прогонов
  await db.query(`DELETE FROM works WHERE work_title LIKE 'ЖК Северный%'`).catch(() => {});
  await db.end();
  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
