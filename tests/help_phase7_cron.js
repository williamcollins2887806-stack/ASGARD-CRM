/* eslint-disable */
/* Phase 7 cron deadlines тест на клоне asgard_crm_test. */
const { Client } = require('pg');
const db = require('/var/www/asgard-test/src/services/db');
const cron = require('/var/www/asgard-test/src/services/tasks-deadlines-cron');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else      { fail++; console.log(`❌ ${name}${extra?' :: '+extra:''}`); }
}

(async () => {
  const pg = new Client({ host:'127.0.0.1', port:5432, user:'asgard', password:'123456789', database:'asgard_crm_test' });
  await pg.connect();
  // Очистка прошлых тестовых задач + старых уведомлений
  await pg.query("DELETE FROM tasks WHERE title LIKE 'CRON-TEST%'");
  await pg.query("DELETE FROM notifications WHERE type IN ('task_deadline_1h','task_deadline_24h','task_overdue') AND title LIKE '%CRON-TEST%' OR entity_id IN (SELECT id FROM tasks WHERE title LIKE 'CRON-TEST%')");

  // PM/TO для тестов
  const pm = (await pg.query("SELECT id FROM users WHERE login='test_pm'")).rows[0];
  const to = (await pg.query("SELECT id FROM users WHERE role='TO' AND is_active=true AND login NOT LIKE 'test_%' LIMIT 1")).rows[0];

  // Создаём 3 задачи:
  //   A. дедлайн +30 мин (попадает в 1h-окно)
  //   B. дедлайн +5 часов (24h-окно)
  //   C. дедлайн -2 часа (просрочка)
  const A = (await pg.query(`INSERT INTO tasks (creator_id, assignee_id, title, status, deadline, task_kind, priority, created_at, updated_at)
    VALUES ($1, $2, 'CRON-TEST 30min', 'new', NOW() + INTERVAL '30 minutes', 'help', 'high', NOW(), NOW()) RETURNING id`, [pm.id, to.id])).rows[0];
  const B = (await pg.query(`INSERT INTO tasks (creator_id, assignee_id, title, status, deadline, task_kind, priority, created_at, updated_at)
    VALUES ($1, $2, 'CRON-TEST 5h', 'new', NOW() + INTERVAL '5 hours', 'help', 'normal', NOW(), NOW()) RETURNING id`, [pm.id, to.id])).rows[0];
  const C = (await pg.query(`INSERT INTO tasks (creator_id, assignee_id, title, status, deadline, task_kind, priority, created_at, updated_at)
    VALUES ($1, $2, 'CRON-TEST overdue', 'in_progress', NOW() - INTERVAL '2 hours', 'help', 'urgent', NOW(), NOW()) RETURNING id`, [pm.id, to.id])).rows[0];

  console.log('Created:', { A:A.id, B:B.id, C:C.id });

  // RUN
  await cron.runOnce(db, console);

  // ASSERTS
  const aNotif = (await pg.query("SELECT * FROM notifications WHERE entity_id=$1 AND type='task_deadline_1h' AND user_id=$2",[A.id, to.id])).rows;
  ok('1. A (+30мин): assignee получил task_deadline_1h', aNotif.length === 1);

  const bNotif = (await pg.query("SELECT * FROM notifications WHERE entity_id=$1 AND type='task_deadline_24h' AND user_id=$2",[B.id, to.id])).rows;
  ok('2. B (+5ч): assignee получил task_deadline_24h', bNotif.length === 1);

  const cNotif = (await pg.query("SELECT * FROM notifications WHERE entity_id=$1 AND type='task_overdue'",[C.id])).rows;
  ok('3. C (-2ч): уведомления task_overdue созданы', cNotif.length >= 1);
  const cStatus = (await pg.query("SELECT status FROM tasks WHERE id=$1",[C.id])).rows[0];
  ok('3a. C статус → overdue', cStatus.status === 'overdue');

  // Идемпотентность: второй прогон не создаёт дублей
  await cron.runOnce(db, console);
  const aNotif2 = (await pg.query("SELECT * FROM notifications WHERE entity_id=$1 AND type='task_deadline_1h' AND user_id=$2",[A.id, to.id])).rows;
  ok('4. 2-й прогон: дубль 1h НЕ создан', aNotif2.length === 1);

  // Очистка
  await pg.query("DELETE FROM tasks WHERE id IN ($1,$2,$3)",[A.id,B.id,C.id]);
  await pg.query("DELETE FROM notifications WHERE entity_id IN ($1,$2,$3)",[A.id,B.id,C.id]);

  await pg.end();
  console.log(`\n=== Phase 7 RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(2); });
