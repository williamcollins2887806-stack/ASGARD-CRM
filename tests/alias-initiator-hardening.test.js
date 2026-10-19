/**
 * Д-3/Д-4 (верификатор 19.10.2026): защита маршрутизации инициатора.
 *
 *  Д-3: алиас почты не должен ПЕРЕКРЫВАТЬ достоверную привязку (users.email /
 *       employees.email). Иначе подделанный заголовок From + переназначение
 *       навсегда «выучивают» неверного владельца корпоративного адреса.
 *  Д-4: алиас на ДЕАКТИВИРОВАННОГО пользователя не резолвится.
 */
const { Pool } = require('pg');
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
const { resolveSenderUserId } = require('../src/services/doc-email-intake');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

(async () => {
  const pool = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
  const db = { query: (t, p) => pool.query(t, p) };

  const realOwner = (await db.query(`SELECT id FROM users WHERE lower(email)='bv@asgard-service.com'`)).rows[0].id;
  const office = (await db.query(`SELECT id FROM users WHERE role='OFFICE_MANAGER' AND is_active IS NOT FALSE ORDER BY id LIMIT 1`)).rows[0].id;

  console.log('=== Д-3: алиас не перекрывает достоверный корп. адрес ===');
  await db.query(`DELETE FROM user_email_aliases WHERE lower(email)='bv@asgard-service.com'`);
  await db.query(`INSERT INTO user_email_aliases(email,user_id,source,label) VALUES('bv@asgard-service.com',$1,'learned','подмена-Д3')`, [office]);
  const r1 = await resolveSenderUserId(db, { from_email: 'bv@asgard-service.com' });
  ok(r1 === realOwner, 'bv@ → достоверный владелец #' + r1 + ' (подмена на #' + office + ' НЕ прошла)');

  console.log('\n=== Алиас работает для НЕстандартных адресов ===');
  await db.query(`INSERT INTO user_email_aliases(email,user_id,source,label) VALUES('alias-only@asgard-service.com',$1,'manual','тест-Д3')
                  ON CONFLICT (lower(email)) DO UPDATE SET user_id=EXCLUDED.user_id`, [office]);
  const r2 = await resolveSenderUserId(db, { from_email: 'alias-only@asgard-service.com' });
  ok(r2 === office, 'alias-only@ → #' + r2 + ' (через алиас)');

  console.log('\n=== Д-4: деактивированный не резолвится ===');
  const deact = (await db.query(`SELECT id FROM users WHERE is_active = false LIMIT 1`)).rows[0];
  if (deact) {
    await db.query(`INSERT INTO user_email_aliases(email,user_id,source,label) VALUES('deact@test.local',$1,'manual','тест-Д4')
                    ON CONFLICT (lower(email)) DO UPDATE SET user_id=EXCLUDED.user_id`, [deact.id]);
    const r3 = await resolveSenderUserId(db, { from_email: 'deact@test.local' });
    ok(r3 !== deact.id, 'деактивированный #' + deact.id + ' НЕ резолвится (получено ' + r3 + ')');
  } else {
    console.log('  (нет деактивированных пользователей — кейс пропущен)');
  }

  await db.query(`DELETE FROM user_email_aliases WHERE label IN ('подмена-Д3','тест-Д3','тест-Д4')`);
  await pool.end();
  console.log('\nИТОГ защиты инициатора: PASS ' + pass + ' / FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message, e.stack); process.exit(1); });
