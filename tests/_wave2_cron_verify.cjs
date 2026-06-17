'use strict';
process.env.DB_NAME = 'asgard_crm_kanban_test';
process.env.DB_USER = 'asgard';
process.env.DB_PASSWORD = '123456789';
process.env.DB_HOST = '127.0.0.1';

const db = require('../src/services/db');
const cron = require('../src/services/personal-kanban-reminders-cron');

(async () => {
  // ИМИТАЦИЯ "второго инстанса": берём advisory_lock на отдельном клиенте.
  const hold = await db.pool.connect();
  const r = await hold.query('SELECT pg_try_advisory_lock(7710013) AS got');
  console.log('imitated-other-instance got_lock=', r.rows[0].got);

  // Готовим минимальные данные: substage + карта + просроченное напоминание.
  await db.query(
    "INSERT INTO kanban_substages(owner_user_id, flow_type, main_status, title, sort_order) " +
    "VALUES (4610,'application','assigned','test-cron-stage',999) ON CONFLICT DO NOTHING"
  );
  const sub = await db.query(
    "SELECT id FROM kanban_substages WHERE owner_user_id=4610 AND flow_type='application' AND main_status='assigned' LIMIT 1"
  );
  const cardIns = await db.query(
    "INSERT INTO personal_kanban_cards" +
    "(owner_user_id, flow_type, entity_kind, entity_id, current_main_status, current_substage_id) " +
    "VALUES (4610,'application','inbox_application',999,'assigned',$1) RETURNING id",
    [sub.rows[0].id]
  );
  await db.query(
    "INSERT INTO personal_kanban_card_reminders(card_id, user_id, remind_at, message) " +
    "VALUES ($1, 4610, now() - interval '1 minute', 'past reminder for test')",
    [cardIns.rows[0].id]
  );

  // С удержанным lock — cron должен skip (никакой fired_at не проставит).
  const before = await db.query(
    "SELECT count(*) FROM personal_kanban_card_reminders WHERE fired_at IS NULL"
  );
  console.log('before=', before.rows[0].count);
  await cron.fireDueReminders(db, console);
  const afterLocked = await db.query(
    "SELECT count(*) FROM personal_kanban_card_reminders WHERE fired_at IS NULL"
  );
  console.log('after-with-lock-held=', afterLocked.rows[0].count, '(must equal before — skip)');

  // Отпускаем lock — cron должен сработать.
  await hold.query('SELECT pg_advisory_unlock(7710013)');
  hold.release();
  await cron.fireDueReminders(db, console);
  const afterReleased = await db.query(
    "SELECT count(*) FROM personal_kanban_card_reminders WHERE fired_at IS NULL"
  );
  console.log('after-after-release=', afterReleased.rows[0].count, '(must be 0 — fired)');

  await db.end();
  process.exit(0);
})().catch(e => {
  console.error('ERR', e.stack || e.message);
  process.exit(1);
});
