#!/usr/bin/env node
'use strict';
/**
 * apply-sql.js — применить конкретный SQL-файл к указанной БД.
 *
 * Зачем: `migrations/run.js` прогоняет ВСЕ невыполненные миграции, а на клоне
 * исторически дрейф (часть объектов создана вручную). Для проверки одного
 * нового файла нужен точечный запуск.
 *
 * Запуск: node tools/apply-sql.js migrations/V468__mimir_stage_state.sql --db=asgard_crm_test
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const file = process.argv[2];
const dbName = (process.argv.find((a) => a.startsWith('--db=')) || '').split('=')[1]
  || process.env.DB_NAME || 'asgard_crm_test';

if (!file) {
  console.error('usage: node tools/apply-sql.js <file.sql> [--db=name]');
  process.exit(1);
}
const abs = path.isAbsolute(file) ? file : path.join(__dirname, '..', file);
if (!fs.existsSync(abs)) {
  console.error('нет файла:', abs);
  process.exit(1);
}

(async () => {
  const sql = fs.readFileSync(abs, 'utf8');
  const c = new Client({
    host: 'localhost', port: 5432,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: dbName
  });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query(sql);
    await c.query('COMMIT');
    console.log('OK:', path.basename(abs), '→', dbName);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('FAIL:', e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
