#!/usr/bin/env node
'use strict';
/**
 * Назначает дежурного РП на клоне (для тестов нового анализа).
 * Запуск: node tools/set-clone-duty.js [login] [--db=asgard_crm_test]
 */
require('dotenv').config();
const { Client } = require('pg');

const args = process.argv.slice(2);
const login = args.find((a) => !a.startsWith('--')) || 'test_pm';
const dbName = (args.find((a) => a.startsWith('--db=')) || '').split('=')[1] || 'asgard_crm_test';

(async () => {
  const db = new Client({
    host: 'localhost', port: 5432, user: process.env.DB_USER || 'asgard',
    password: process.env.DB_PASSWORD || '123456789', database: dbName
  });
  await db.connect();

  const { rows: [u] } = await db.query(
    'SELECT id, login, role FROM users WHERE login = $1', [login]
  );
  if (!u) { console.error('нет пользователя', login); process.exit(1); }

  // Ростер дежурных: закрываем прошлые открытые периоды и пишем новый на 30 дней.
  await db.query(
    `UPDATE pm_duty_roster SET period_end = CURRENT_DATE - 1
      WHERE period_end >= CURRENT_DATE AND pm_user_id <> $1`, [u.id]
  );
  const exist = await db.query(
    `SELECT id FROM pm_duty_roster
      WHERE pm_user_id = $1 AND CURRENT_DATE BETWEEN period_start AND period_end`, [u.id]
  );
  if (!exist.rows[0]) {
    await db.query(
      `INSERT INTO pm_duty_roster (pm_user_id, period_start, period_end, assigned_by_user_id)
       VALUES ($1, CURRENT_DATE - 7, CURRENT_DATE + 30, $1)`, [u.id]
    );
  }

  const check = await db.query(
    `SELECT pm_user_id, period_start, period_end FROM pm_duty_roster
      WHERE CURRENT_DATE BETWEEN period_start AND period_end ORDER BY period_start DESC LIMIT 3`
  );
  console.log('дежурный:', u.login, '#' + u.id, '| role:', u.role);
  console.log('ростер:', JSON.stringify(check.rows));
  await db.end();
})();
