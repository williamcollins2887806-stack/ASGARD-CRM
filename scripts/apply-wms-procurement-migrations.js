#!/usr/bin/env node
/**
 * Точечный аппликатор миграций для деплоя «Закупки 2.0 + Склад/WMS».
 *
 * Зачем: общий `node migrations/run.js` падает на постороннем V001a (audit baseline),
 * которого нет на проде. Этот скрипт применяет ТОЛЬКО нужные миграции в строгом порядке,
 * каждую в транзакции, пропуская уже применённые (по таблице migrations).
 *
 * Использование (на сервере, из корня проекта):
 *   node scripts/apply-wms-procurement-migrations.js          # применить
 *   node scripts/apply-wms-procurement-migrations.js --dry    # показать план, ничего не менять
 *
 * Идемпотентно: повторный запуск пропускает уже применённые. Безопасно гонять несколько раз.
 */
'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry');
const MIG_DIR = path.join(__dirname, '..', 'migrations');

// Порядок ВАЖЕН: справочники закупок → их зависимости → склад/WMS поверх каталога.
const ORDER = [
  // — Закупки 2.0 (commit 4bb4168) —
  'V149__suppliers',
  'V150__supplier_contacts',
  'V151__product_categories',
  'V152__products',
  'V153__procurement_items_refs',
  'V154__price_records',
  'V155__procurement_templates',
  'V156__price_hint_view',
  'V161__max_bot_sessions',
  // — Склад / WMS —
  'V167__products_warehouse_fields',
  'V168__warehouse_locations',
  'V169__stock',
  'V170__stock_movements',
  'V171__equipment_location_product',
  'V172__assembly_items_wms',
  'V173__procurement_items_recipient',
  'V174__wms_seed',
  'V175__assembly_source_from_warehouse',
];

async function main() {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'asgard_crm',
    user: process.env.DB_USER || 'asgard',
    password: process.env.DB_PASSWORD || 'password',
  });

  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL UNIQUE, executed_at TIMESTAMP DEFAULT NOW())`);
    const done = new Set((await pool.query('SELECT name FROM migrations')).rows.map(r => r.name));

    console.log(`\n=== План миграций (${DRY ? 'DRY-RUN' : 'ПРИМЕНЕНИЕ'}) ===`);
    let applied = 0, skipped = 0;
    for (const name of ORDER) {
      if (done.has(name)) { console.log(`  ⏭️  ${name} — уже применена`); skipped++; continue; }
      const file = path.join(MIG_DIR, name + '.sql');
      if (!fs.existsSync(file)) { console.error(`  ❌ ${name} — ФАЙЛ НЕ НАЙДЕН (${file})`); process.exit(2); }
      if (DRY) { console.log(`  🔹 ${name} — будет применена`); applied++; continue; }
      const sql = fs.readFileSync(file, 'utf8');
      try {
        await pool.query('BEGIN');
        await pool.query(sql);
        await pool.query('INSERT INTO migrations(name) VALUES($1)', [name]);
        await pool.query('COMMIT');
        console.log(`  ✅ ${name}`);
        applied++;
      } catch (e) {
        await pool.query('ROLLBACK');
        console.error(`  🔴 ${name} — ОШИБКА: ${e.message}`);
        console.error('     Остановка. Уже применённые миграции зафиксированы. Исправьте и запустите снова.');
        process.exit(1);
      }
    }
    console.log(`\n=== Готово: применено ${applied}, пропущено ${skipped} ===`);
    if (DRY) console.log('(DRY-RUN — БД не менялась)');
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error('Фатальная ошибка:', e.message); process.exit(1); });
