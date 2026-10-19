#!/usr/bin/env node
'use strict';

/**
 * Точечный прогон миграций.
 *
 * Зачем: штатный `npm run migrate` (migrations/run.js) выбирает ВСЕ файлы, которых нет
 * в таблице `migrations`. На проде эта таблица неполная — в ней 286 записей из 365 файлов,
 * причём легаси-миграции V229…V382 применены руками, но не записаны. Поэтому обычный
 * прогон поднял бы 132 миграции вместо 20 нужных — неоправданный риск на живом проде.
 *
 * Этот раннер применяет ТОЛЬКО перечисленные файлы, в указанном порядке,
 * каждый — в своей транзакции, и пишет запись в `migrations` тем же форматом,
 * что и основной раннер (name без `.sql`). Повторный запуск пропускает уже записанные.
 *
 * Использование:
 *   node tools/migrate_targeted.js --list                       # показать план
 *   node tools/migrate_targeted.js --apply                      # применить
 *   node tools/migrate_targeted.js --apply --down               # откатить (в обратном порядке)
 *
 * БД берётся из DB_* (как migrations/run.js). Прод — только по явной команде.
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// Каталог миграций можно переопределить (нужно, когда на сервере файлов ещё нет,
// а прогнать их на тестовой копии надо): MIGRATIONS_DIR=/tmp/prodmig
const MIG_DIR = process.env.MIGRATIONS_DIR || path.join(ROOT, 'migrations');

/**
 * Список согласован по ФАКТИЧЕСКОМУ состоянию схемы прода (проверено 18.10.2026),
 * а не по таблице `migrations` — она на проде неполная.
 *
 * ВАЖНО: V385, V387, V388, V389, V390, V393 прод УЖЕ ИМЕЕТ фактически
 * (проверено по колонкам/констрейнтам/настройкам), хотя в таблице `migrations`
 * записаны только V389 и V393. Поэтому их НЕ включаем — иначе платим за риск
 * без пользы. Их _down намеренно оставлен в репо для ручного отката.
 *
 * Порядок = порядок применения. Повторный запуск пропускает записанные.
 */
const TARGETS = [
  'V391__payout_batches_payees_plan',           // 4 таблицы выплат (D-281)
  'V392__payout_kind_all_types',                // CHECK chk_pbi_kind — после V391
  'V394__doc_traffic_light_acts',               // doc_reconciliation_acts, doc_reminder_log, work_calendar
  'V395__doc_traffic_workdays_fn',              // функция asgard_workdays_until
  'V396__doc_incomplete_recompute',             // правка данных (без своей функции)
  'V397__doc_cp_inn_fx',                        // doc_registry: counterparty_inn, fx_rate
  'V398__doc_email_chain',                      // doc_email_intake, email_threads, payment_invoices.*
  'V399__cash_issued_amount',                   // cash_requests.issued_amount
  'V400__payment_invoice_doc_link',             // payment_invoices.doc_registry_id
  'V401__supplier_bank_requisites',             // suppliers.bik/rs/ks, payment_invoices.pp_*
  'V402__doc_registry_list_index',              // индексы списка реестра
  'V403__price_records_from_invoice',           // price_records.quantity
  'V404__payment_invoice_initiator_context',    // payment_invoices.initiator_intent
  'V405__doc_reminder_log_null_dedup',          // ПОСЛЕ V394: дедуп + уникальный индекс
  'V406__director_dev_chat_perms',              // role_presets DIRECTOR_DEV: chat_groups
  'V407__field_tariff_grid_ceilings',           // потолки тарифов поля (D-282)
  'V408__doc_deferred_approval',                // doc_approval_grant (переименована из V406 — коллизия номеров)
  'V409__doc_ai_extract_seller_payee',          // doc_registry: seller_/payee_*, parse_engine/warnings (ИИ-разбор)
  'V410__user_email_aliases',                   // user_email_aliases (почта→сотрудник) + включение email_intake_enabled
  'V411__payment_batches'                       // payment_batches (партия счетов) + payment_invoices.batch_id
];

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'asgard_crm',
  user: process.env.DB_USER || 'asgard',
  password: process.env.DB_PASSWORD || 'password'
});

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function appliedSet() {
  const { rows } = await pool.query('SELECT name FROM migrations');
  return new Set(rows.map((r) => r.name));
}

function fileOf(name, down) {
  return path.join(MIG_DIR, `${name}${down ? '_down' : ''}.sql`);
}

async function plan() {
  await ensureMigrationsTable();
  const done = await appliedSet();
  console.log(`БД: ${process.env.DB_NAME || 'asgard_crm'}`);
  console.log('');
  let need = 0;
  for (const name of TARGETS) {
    const recorded = done.has(name);
    const exists = fs.existsSync(fileOf(name, false));
    const hasDown = fs.existsSync(fileOf(name, true));
    const mark = recorded ? '⏭️  записана' : '🚀 применить';
    if (!recorded) need++;
    console.log(`  ${mark}  ${name}${exists ? '' : '  ❌ ФАЙЛА НЕТ'}${hasDown ? '' : '  (без _down)'}`);
  }
  console.log('');
  console.log(`Итого: ${TARGETS.length} в списке, ${need} к применению, ${TARGETS.length - need} уже записаны.`);
  return need;
}

async function applyOne(name, down) {
  const f = fileOf(name, down);
  if (!fs.existsSync(f)) {
    console.error(`❌ ${down ? 'down' : 'up'} файл не найден: ${f}`);
    process.exit(1);
  }
  const sql = fs.readFileSync(f, 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    if (down) {
      await client.query('DELETE FROM migrations WHERE name = $1', [name]);
    } else {
      await client.query('INSERT INTO migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
    }
    await client.query('COMMIT');
    console.log(`✅ ${down ? 'откат' : 'применена'}: ${name}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`❌ ${name} — ${err.message}`);
    process.exit(1);
  } finally {
    client.release();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const down = args.includes('--down');
  const doApply = args.includes('--apply');

  if (!doApply) {
    await plan();
    if (!down) console.log('\n(это план; для применения добавь --apply)');
    await pool.end();
    return;
  }

  await ensureMigrationsTable();
  const done = await appliedSet();
  const list = down ? [...TARGETS].reverse() : TARGETS;

  if (down) {
    console.log('⚠️  ОТКАТ — обратный порядок\n');
    for (const name of list) {
      // полярность: откатываем только то, что записано (и файл _down существует)
      const hasDownFile = fs.existsSync(fileOf(name, true));
      if (!hasDownFile) { console.log(`⏭️  пропуск (нет _down): ${name}`); continue; }
      await applyOne(name, true);
    }
  } else {
    for (const name of list) {
      if (done.has(name)) { console.log(`⏭️  уже применена: ${name}`); continue; }
      await applyOne(name, false);
    }
  }

  console.log('\n✨ Готово');
  await pool.end();
}

main().catch((e) => { console.error('Migration error:', e); process.exit(1); });
