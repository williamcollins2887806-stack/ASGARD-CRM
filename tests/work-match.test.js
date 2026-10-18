/**
 * Сопоставление объекта/работы по подсказке из счёта (заказчик 18.10.2026:
 * «люди постоянно пишут неправильно — сделай, чтобы привязывал»).
 * Проверяем прощающие сценарии: уточнения, регистр, номер работы, адрес, город,
 * заказчик, опечатки, перестановка слов — и что мусор НЕ привязывается.
 */
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
const { Client } = require('pg');
const { matchWork } = require('../src/services/contract-match');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

(async () => {
  const db = new Client({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
  await db.connect();
  const tag = 'MW-' + String(Date.now()).slice(-5);
  const works = [
    { title: `ЖК Северный ${tag}`, obj: `ЖК Северный, корпус 3 ${tag}`, num: `A-100-${tag}`, city: 'Москва', addr: 'ул. Северная, 10', cust: 'ООО «Заказчик-А»' },
    { title: `Химическая чистка сушильного цилиндра PH-M 1100/2 ${tag}`, obj: `ЦБК Сокол ${tag}`, num: `Б-200-${tag}`, city: 'Сокол', addr: 'Промзона, 5', cust: 'АО «Сокол»' },
    { title: `Монтаж трубопровода котельной ${tag}`, obj: `Котельная №7 ${tag}`, num: `В-300-${tag}`, city: 'Казань', addr: 'ул. Ленина, 1', cust: 'ООО «Теплосеть»' }
  ];
  const ids = [];
  for (const w of works) {
    const r = await db.query(
      `INSERT INTO works(work_title, object_name, work_number, city, address, customer_name, created_at)
       VALUES($1::varchar,$2::varchar,$3::varchar,$4::varchar,$5::varchar,$6::varchar,NOW()) RETURNING id`,
      [w.title, w.obj, w.num, w.city, w.addr, w.cust]);
    ids.push(r.rows[0].id);
  }
  console.log('=== Как люди пишут объект → привязка ===\n');
  const cases = [
    [`Объект: ЖК Северный, корпус 3 ${tag}`, true, 'точное + уточнение «корпус 3»'],
    [`жк северный ${tag}`, true, 'другой регистр'],
    [`ЖК Северный, лит. А ${tag}`, true, 'литера вместо корпуса'],
    [`Объект № A-100-${tag}`, true, 'по НОМЕРУ работы'],
    [`Сокол ${tag}`, true, 'одно короткое слово'],
    [`ЦБК Сокол ${tag}`, true, 'объект + короткое слово'],
    [`котельная №7 ${tag}`, true, 'по объекту с №'],
    [`Теплосеть ${tag}`, true, 'по ЗАКАЗЧИКУ'],
    [`Казань, ул. Ленина ${tag}`, true, 'по ГОРОДУ и адресу'],
    [`ЖК Севрный ${tag}`, true, 'ОПЕЧАТКА в слове'],
    [`Монтаж котельной ${tag}`, true, 'перестановка/усечение слов'],
    [`Сушильный цилиндр PH-M ${tag}`, true, 'длинное техническое название'],
    [`Совсем другой объект ${tag}`, false, 'чужая формулировка — НЕ привязывать'],
    [`автомобиль купить срочно ${tag}`, false, 'мусор — НЕ привязывать'],
  ];
  for (const [hint, expect, what] of cases) {
    const r = await matchWork(db, hint);
    const label = r.work ? (r.work.work_title || r.work.object_name || '').slice(0, 32) : '—';
    ok(r.found === expect, `«${hint}» → ${r.found ? 'привязано: ' + label : 'не привязано'} (${r.reason}) · ${what}`);
  }

  // Неоднозначность: две похожие работы → должен вернуть кандидатов на выбор, НЕ привязать.
  const dup = (await db.query(
    `INSERT INTO works(work_title, object_name, created_at) VALUES($1::varchar,$2::varchar,NOW()) RETURNING id`,
    [`Склад Логистика Юг ${tag}`, `Склад Логистика Юг ${tag}`])).rows[0];
  const dup2 = (await db.query(
    `INSERT INTO works(work_title, object_name, created_at) VALUES($1::varchar,$2::varchar,NOW()) RETURNING id`,
    [`Склад Логистика Север ${tag}`, `Склад Логистика Север ${tag}`])).rows[0];
  const amb = await matchWork(db, `Склад Логистика ${tag}`);
  ok(amb.found === false || (amb.candidates && amb.candidates.length), 'два похожих склада → выбор, а не слепая привязка (' + amb.reason + ')');
  ok(!amb.found || Number(amb.work.id) === Number(dup.id) || Number(amb.work.id) === Number(dup2.id), 'если привязал — то одного из двух нужных');

  // ── P0 (верификатор 18.10.2026): ЧУЖОЙ корпус/код привязывать НЕЛЬЗЯ ──────
  // Нормализация вырезает «корпус N», из-за чего корпус 9 становился неотличим
  // от корпуса 3 — и счёт молча привязывался к ЧУЖОЙ работе (влияет на расходы).
  console.log('\n=== Чужой корпус/код не должен привязываться (P0) ===');
  const g1 = (await db.query(
    `INSERT INTO works(work_title, object_name, created_at) VALUES($1::varchar,$2::varchar,NOW()) RETURNING id`,
    [`Гидроузел Павловский ${tag}`, `Гидроузел Павловский ${tag}, корпус 3`])).rows[0];
  const k1 = (await db.query(
    `INSERT INTO works(work_title, object_name, created_at) VALUES($1::varchar,$2::varchar,NOW()) RETURNING id`,
    [`Промывка деаэратора V49001 ${tag}`, `Промывка деаэратора V49001 ${tag}`])).rows[0];
  const badK = await matchWork(db, `Гидроузел Павловский ${tag}, корпус 9`);
  ok(badK.found === false, 'корпус 9 при базе «корпус 3» → НЕ привязано (' + badK.reason + ')');
  const goodK = await matchWork(db, `Гидроузел Павловский ${tag}, корпус 3`);
  ok(goodK.found === true && Number(goodK.work.id) === Number(g1.id), 'корпус 3 → привязано к нужной работе');
  const badCode = await matchWork(db, `Промывка деаэратора V99001 ${tag}`);
  ok(badCode.found === false, 'код V99001 при базе V49001 → НЕ привязано (' + badCode.reason + ')');
  const goodCode = await matchWork(db, `Промывка деаэратора V49001 ${tag}`);
  ok(goodCode.found === true && Number(goodCode.work.id) === Number(k1.id), 'код V49001 → привязано к нужной работе');

  await db.query(`DELETE FROM works WHERE id = ANY($1::int[])`, [[...ids, dup.id, dup2.id, g1.id, k1.id]]);
  await db.end();
  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
