/**
 * Полная очистка тестовых данных и удаление тестовых пользователей
 * Запуск: cd /var/www/asgard-crm && node /tmp/cleanup-test-data.js
 */
const { Client } = require('pg');

const db = new Client({
  host: 'localhost',
  database: 'asgard_crm',
  user: 'asgard',
  password: '123456789'
});

async function del(tbl, col, ids) {
  if (!ids || ids.length === 0) return 0;
  try {
    const r = await db.query(`DELETE FROM ${tbl} WHERE ${col} = ANY($1)`, [ids]);
    if (r.rowCount > 0) console.log(`  ${tbl} (${col}): ${r.rowCount}`);
    return r.rowCount;
  } catch (e) {
    console.log(`  WARN ${tbl}: ${e.message.substring(0, 100)}`);
    return 0;
  }
}

(async () => {
  await db.connect();
  console.log('Connected to DB');

  // Находим тестовых пользователей
  const { rows: testUsers } = await db.query("SELECT id, login FROM users WHERE login LIKE 'test_%'");
  const uids = testUsers.map(u => u.id);
  console.log(`Test users: ${testUsers.length} (IDs: ${uids.join(', ')})`);
  if (uids.length === 0) {
    console.log('No test users found. Nothing to clean.');
    await db.end();
    return;
  }

  // ID тестовых работ и тендеров
  const { rows: tw } = await db.query('SELECT id FROM works WHERE created_by = ANY($1)', [uids]);
  const wids = tw.map(w => w.id);
  const { rows: tt } = await db.query('SELECT id FROM tenders WHERE created_by = ANY($1)', [uids]);
  const tids = tt.map(t => t.id);
  console.log(`Test works: ${wids.length}, Test tenders: ${tids.length}`);

  await db.query('BEGIN');

  let total = 0;

  // === Уровень 4: FK зависимости от works ===
  console.log('\n--- FK deps on works ---');
  for (const t of [
    'payroll_items', 'payroll_sheets', 'one_time_payments',
    'work_permit_requirements', 'employee_reviews', 'bank_transactions',
    'meetings', 'tasks', 'tkp', 'documents', 'incomes', 'employee_plan',
    'work_expenses', 'cash_requests', 'correspondence', 'calendar_events',
    'travel_expenses', 'inbox_applications'
  ]) {
    const col = t === 'inbox_applications' ? 'linked_work_id' : 'work_id';
    total += await del(t, col, wids);
  }

  // === Уровень 3: FK зависимости от tenders ===
  console.log('\n--- FK deps on tenders ---');
  for (const t of [
    'estimates', 'invoices', 'meetings', 'tasks', 'tkp',
    'tmc_requests', 'pass_requests', 'documents', 'correspondence',
    'calendar_events', 'bank_transactions', 'works', 'inbox_applications'
  ]) {
    const col = t === 'inbox_applications' ? 'linked_tender_id' : 'tender_id';
    total += await del(t, col, tids);
  }

  // === Уровень 2: По created_by ===
  console.log('\n--- By created_by ---');
  for (const t of [
    'chat_messages', 'task_comments', 'task_watchers', 'chat_group_members',
    'invoice_payments', 'qa_messages', 'notifications', 'seal_transfers',
    'travel_expenses', 'correspondence', 'calendar_events', 'doc_sets',
    'contracts', 'office_expenses', 'permit_applications', 'pre_tender_requests',
    'payment_registry', 'ai_analysis_log', 'incomes', 'inbox_applications',
    'employee_permits', 'employee_rates', 'equipment_movements',
    'equipment_maintenance', 'work_expenses', 'acts', 'invoices', 'meeting_minutes'
  ]) {
    total += await del(t, 'created_by', uids);
  }

  // === Уровень 2: По user_id ===
  console.log('\n--- By user_id ---');
  for (const t of [
    'cash_messages', 'push_subscriptions', 'reminders', 'todo_items',
    'user_call_status', 'user_dashboard', 'user_menu_settings',
    'role_analytics_cache', 'saved_reports', 'webauthn_challenges',
    'webauthn_credentials', 'mimir_conversations', 'mimir_usage_log',
    'email_log', 'call_history', 'employee_plan', 'cash_requests',
    'hr_requests', 'expenses', 'staff', 'estimates', 'meeting_participants'
  ]) {
    total += await del(t, 'user_id', uids);
  }

  // === По author_id ===
  console.log('\n--- By author_id ---');
  for (const t of ['pass_requests', 'tmc_requests', 'tkp']) {
    total += await del(t, 'author_id', uids);
  }

  // === Уровень 1: Основные сущности ===
  console.log('\n--- Main entities ---');
  total += await del('equipment', 'created_by', uids);
  total += await del('works', 'created_by', uids);
  total += await del('tenders', 'created_by', uids);

  // === Уровень 0: Пользователи ===
  console.log('\n--- Users ---');
  total += await del('user_permissions', 'user_id', uids);
  total += await del('employees', 'user_id', uids);
  const r = await db.query('DELETE FROM users WHERE id = ANY($1)', [uids]);
  console.log(`  users: ${r.rowCount}`);
  total += r.rowCount;

  await db.query('COMMIT');

  // Проверка
  const { rows: check } = await db.query("SELECT count(*) as c FROM users WHERE login LIKE 'test_%'");
  console.log(`\n=== CLEANUP COMPLETE ===`);
  console.log(`Total records deleted: ${total}`);
  console.log(`Remaining test users: ${check[0].c}`);

  await db.end();
})().catch(async (e) => {
  console.error('FATAL:', e.message);
  try { await db.query('ROLLBACK'); } catch {}
  try { await db.end(); } catch {}
  process.exit(1);
});
