/**
 * V407: инициатор заявки — тот, с чьей почты пришло письмо (заказчик 18.10.2026:
 * «инициатор это не админ а пользователь с чей почты пришел запрос — баринов, хосе,
 * вика и т.д., любой»). Плюс замена согласующего на время тестов через настройку.
 */
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
const { Client } = require('pg');
const { resolveSenderUserId } = require('../src/services/doc-email-intake');
const { approverEmails, extractEmail } = require('../src/services/approval-thread');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

(async () => {
  const db = new Client({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
  await db.connect();

  console.log('=== 1. Инициатор = ЛЮБОЙ сотрудник по своей почте ===');
  const people = (await db.query(
    `SELECT id, name, role, email FROM users
      WHERE is_active=true AND email ILIKE '%@asgard-service.com'
      ORDER BY id`)).rows;
  let good = 0;
  for (const p of people) {
    const id = await resolveSenderUserId(db, { from_email: p.email });
    if (id) good++;
    else console.log(`     не определился: ${p.email} (${p.role})`);
  }
  console.log(`  определено ${good} из ${people.length} рабочих почт`);
  ok(good === people.length, 'все корпоративные почты дают инициатора');

  // Конкретно те, кого назвал заказчик.
  const named = {
    'bv@asgard-service.com': 'Баринов',
    'hv@asgard-service.com': 'Хосе',
    'office@asgard-service.com': 'Вика (Тумаева)',
    'n.androsov@asgard-service.com': 'Андросов',
    'd.putkov@asgard-service.com': 'Путков',
    'i.morozov@asgard-service.com': 'Морозов',
    'buh@asgard-service.com': 'Кононова'
  };
  for (const [email, who] of Object.entries(named)) {
    const id = await resolveSenderUserId(db, { from_email: email });
    const u = id ? (await db.query(`SELECT name, role FROM users WHERE id=$1`, [id])).rows[0] : null;
    ok(!!id && !!u, `${who}: ${email} → ${u ? u.name + ' (' + u.role + ')' : 'не определён'}`);
  }

  console.log('\n=== 2. Display-name не мешает ===');
  ok(await resolveSenderUserId(db, { from_email: 'Баринов Виктор <bv@asgard-service.com>' }) === 3467,
    '«Баринов Виктор <bv@…>» → 3467');
  ok(await resolveSenderUserId(db, { from_email: 'BV@ASGARD-SERVICE.COM' }) === 3467, 'регистр не важен');

  console.log('\n=== 3. Дубль почты: выбирается осмысленный владелец ===');
  const dupId = await resolveSenderUserId(db, { from_email: 'n.androsov@asgard-service.com' });
  const dupRoles = (await db.query(
    `SELECT id, role FROM users WHERE lower(email)='n.androsov@asgard-service.com' ORDER BY id`)).rows;
  console.log('  претенденты:', JSON.stringify(dupRoles));
  ok(dupId === 3474, 'из трёх владельцев выбран РП Андросов (3474), а не ADMIN, получили ' + dupId);

  console.log('\n=== 4. Внешний отправитель → null (не выдумываем инициатора) ===');
  ok(await resolveSenderUserId(db, { from_email: 'zakaz@postavshik.ru' }) === null, 'внешняя почта → null');
  ok(await resolveSenderUserId(db, { from_email: '' }) === null, 'пустая почта → null');

  console.log('\n=== 5. Замена согласующего на время тестов ===');
  await db.query(`INSERT INTO settings(key, value_json) VALUES('doc_approver_emails', $1::jsonb)
    ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json`,
    [JSON.stringify(['andr0sov.nikita@yandex.ru'])]);
  const list = await approverEmails(db);
  console.log('  список согласующих:', JSON.stringify(list));
  ok(list.includes('andr0sov.nikita@yandex.ru'), 'Яндекс-адрес заказчика принимается');
  ok(list.includes('go@asgard-service.com'), 'штатный согласующий не потерян');
  ok(list.includes(extractEmail('Андросов Никита <andr0sov.nikita@yandex.ru>')), 'ответ с display-name распознаётся');
  ok(!list.includes('random@example.com'), 'посторонний не согласующий');
  ok(!list.includes(extractEmail('bv@asgard-service.com')), 'инициатор (Баринов) НЕ может согласовать свою же заявку');

  // оставляем настройку для живого теста заказчика (как просили «на время тестов поставь её»)
  console.log('\n  (настройка doc_approver_emails оставлена включённой для живого теста)');
  await db.end();
  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
