/**
 * Инициатор счёта из письма (заказчик 19.10.2026):
 *  • счета шлют 20–50 сотрудников, в т.ч. с ЛИЧНЫХ почт (@mail.ru/@yandex.ru);
 *  • личная почта лежит в employees.email, корпоративная — в users.email;
 *  • если почта не привязана — ответственным ставим ОФИС-МЕНЕДЖЕРА (Тумаева),
 *    а НЕ админа: она сама переназначит.
 */
const { Pool } = require('pg');
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
const { resolveSenderUserId } = require('../src/services/doc-email-intake');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

(async () => {
  const pool = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
  const db = { query: (t, p) => pool.query(t, p) };

  console.log('=== Инициатор: корпоративная почта ===');
  const u1 = (await db.query(`SELECT id FROM users WHERE email='bv@asgard-service.com'`)).rows[0];
  const r1 = await resolveSenderUserId(db, { from_email: 'bv@asgard-service.com' });
  ok(r1 === u1.id, 'bv@asgard-service.com → ' + r1 + ' (ждали ' + u1.id + ')');

  console.log('\n=== Инициатор: ЛИЧНАЯ почта сотрудника (employees.email) ===');
  // Берём реального сотрудника с личной почтой и его user_id.
  const emp = (await db.query(`SELECT e.email, e.user_id, u.id AS uid, u.role FROM employees e JOIN users u ON u.id=e.user_id WHERE e.email ILIKE '%@mail.%' OR e.email ILIKE '%@yandex.%' LIMIT 1`)).rows[0];
  if (emp) {
    const r2 = await resolveSenderUserId(db, { from_email: emp.email });
    ok(r2 === emp.uid, 'личная почта ' + emp.email + ' → ' + r2 + ' (ждали ' + emp.uid + ')');
  } else {
    console.log('  (нет сотрудника с личной почтой в клоне — кейс пропущен)');
  }

  console.log('\n=== Инициатор: неизвестная почта → офис-менеджер, НЕ админ ===');
  const office = (await db.query(`SELECT id FROM users WHERE role='OFFICE_MANAGER' AND is_active IS NOT FALSE ORDER BY id ASC LIMIT 1`)).rows[0];
  const r3 = await resolveSenderUserId(db, { from_email: 'random-stranger@nowhere-xyz.com' });
  ok(r3 === (office ? office.id : null), 'неизвестная почта → офис-менеджер #' + r3 + ' (ждали ' + (office ? office.id : 'нет') + ')');
  const admin = (await db.query(`SELECT id FROM users WHERE role='ADMIN' ORDER BY id LIMIT 1`)).rows[0];
  ok(!r3 || r3 !== admin.id, 'НЕ админ (#1=' + admin.id + '): r=' + r3);

  console.log('\n=== Инициатор: адрес с отображаемым именем ===');
  const r4 = await resolveSenderUserId(db, { from_email: 'Баринов Виктор <bv@asgard-service.com>' });
  ok(r4 === u1.id, '«Имя <почта>» → ' + r4);

  await pool.end();
  console.log('\nИТОГ инициатора: PASS ' + pass + ' / FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message, e.stack); process.exit(1); });
