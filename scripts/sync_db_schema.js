#!/usr/bin/env node
/**
 * ASGARD CRM — Синхронизация схемы БД
 *
 * Сканирует JS-файлы, находит все используемые поля таблиц,
 * сравнивает с реальной схемой БД и генерирует SQL для синхронизации.
 *
 * Запуск: node scripts/sync_db_schema.js
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'asgard_crm',
  user: process.env.DB_USER || 'asgard',
  password: process.env.DB_PASSWORD
});

// Таблицы для анализа
const TABLES = [
  'users', 'tenders', 'works', 'customers', 'estimates', 'invoices',
  'expenses', 'documents', 'notifications', 'chat_messages', 'audit_log',
  'bonus_requests', 'hr_requests', 'purchase_requests', 'reminders',
  'calendar_events', 'correspondence', 'user_call_status'
];

// Известные типы полей (по суффиксам и именам)
const FIELD_TYPES = {
  // По суффиксу
  '_id': 'INTEGER',
  '_at': 'TIMESTAMP',
  '_date': 'DATE',
  '_pct': 'INTEGER',
  '_json': 'JSONB',
  '_url': 'TEXT',
  '_link': 'TEXT',
  '_hash': 'TEXT',
  '_key': 'TEXT',
  // По имени
  'id': 'SERIAL PRIMARY KEY',
  'created_at': 'TIMESTAMP DEFAULT now()',
  'updated_at': 'TIMESTAMP DEFAULT now()',
  'is_read': 'BOOLEAN DEFAULT false',
  'is_deleted': 'BOOLEAN DEFAULT false',
  'is_system': 'BOOLEAN DEFAULT false',
  'amount': 'NUMERIC(15,2)',
  'price': 'NUMERIC(15,2)',
  'cost': 'NUMERIC(15,2)',
  'total': 'NUMERIC(15,2)',
  'sum': 'NUMERIC(15,2)',
  'status': 'TEXT',
  'role': 'TEXT',
  'type': 'TEXT',
  'name': 'TEXT',
  'title': 'TEXT',
  'comment': 'TEXT',
  'description': 'TEXT',
  'text': 'TEXT',
  'email': 'TEXT',
  'phone': 'TEXT',
  'address': 'TEXT',
  'inn': 'VARCHAR(20)',
  'kpp': 'VARCHAR(20)',
  'ogrn': 'VARCHAR(20)',
  'login': 'VARCHAR(100)',
  'password': 'TEXT',
  'token': 'TEXT',
  'version': 'INTEGER DEFAULT 1',
  'year': 'INTEGER',
  'month': 'INTEGER',
  'day': 'INTEGER',
  'count': 'INTEGER',
  'qty': 'INTEGER',
  'period': 'VARCHAR(20)'
};

// Получить тип поля по имени
function getFieldType(fieldName) {
  // Точное совпадение
  if (FIELD_TYPES[fieldName]) return FIELD_TYPES[fieldName];

  // По суффиксу
  for (const [suffix, type] of Object.entries(FIELD_TYPES)) {
    if (suffix.startsWith('_') && fieldName.endsWith(suffix)) {
      return type;
    }
  }

  // По умолчанию TEXT
  return 'TEXT';
}

// Сканировать JS файл и найти обращения к полям таблиц
function scanJsFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const fields = {};

  // Паттерны для поиска полей
  const patterns = [
    // obj.field_name или obj?.field_name
    /\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/gi,
    // obj["field_name"] или obj['field_name']
    /\b([a-z_][a-z0-9_]*)\[["']([a-z_][a-z0-9_]*)["']\]/gi,
    // { field_name: value }
    /\{\s*([a-z_][a-z0-9_]*)\s*:/gi,
    // field_name: value (внутри объекта)
    /,\s*([a-z_][a-z0-9_]*)\s*:/gi,
    // AsgardDB.add("table", { ... })
    /AsgardDB\.(add|put|get|byIndex)\s*\(\s*["']([a-z_]+)["']/gi,
    // /api/data/table
    /\/api\/data\/([a-z_]+)/gi
  ];

  // Ищем таблицы
  const tablePattern = /AsgardDB\.(add|put|get|getAll|byIndex)\s*\(\s*["']([a-z_]+)["']/gi;
  let match;
  while ((match = tablePattern.exec(content)) !== null) {
    const table = match[2];
    if (!fields[table]) fields[table] = new Set();
  }

  // API вызовы
  const apiPattern = /\/api\/data\/([a-z_]+)/gi;
  while ((match = apiPattern.exec(content)) !== null) {
    const table = match[1];
    if (!fields[table]) fields[table] = new Set();
  }

  // Ищем объекты, которые сохраняются
  // Паттерн: { field1: val, field2: val, ... }
  const objectPattern = /\{([^{}]+)\}/g;
  while ((match = objectPattern.exec(content)) !== null) {
    const objContent = match[1];
    const fieldPattern = /([a-z_][a-z0-9_]*)\s*:/gi;
    let fieldMatch;
    while ((fieldMatch = fieldPattern.exec(objContent)) !== null) {
      const field = fieldMatch[1].toLowerCase();
      // Исключаем JS ключевые слова и методы
      if (!['function', 'return', 'const', 'let', 'var', 'if', 'else', 'for', 'while', 'async', 'await', 'class', 'method', 'headers', 'body', 'catch', 'try', 'new', 'true', 'false', 'null', 'undefined'].includes(field)) {
        // Добавляем ко всем таблицам что были в этом файле (потом отфильтруем)
        for (const table of Object.keys(fields)) {
          fields[table].add(field);
        }
      }
    }
  }

  return fields;
}

// Сканировать директорию
function scanDirectory(dir) {
  const allFields = {};

  function scan(currentDir) {
    const items = fs.readdirSync(currentDir);
    for (const item of items) {
      const fullPath = path.join(currentDir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules') {
        scan(fullPath);
      } else if (item.endsWith('.js') && !item.includes('.min.')) {
        const fields = scanJsFile(fullPath);
        for (const [table, fieldSet] of Object.entries(fields)) {
          if (!allFields[table]) allFields[table] = new Set();
          for (const field of fieldSet) {
            allFields[table].add(field);
          }
        }
      }
    }
  }

  scan(dir);
  return allFields;
}

// Получить существующие колонки из БД
async function getDbColumns(table) {
  try {
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = $1 AND table_schema = 'public'
      ORDER BY ordinal_position
    `, [table]);
    return result.rows;
  } catch (e) {
    return [];
  }
}

// Проверить существование таблицы
async function tableExists(table) {
  const result = await pool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1
    )
  `, [table]);
  return result.rows[0].exists;
}

// Главная функция
async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('        ASGARD CRM — Синхронизация схемы базы данных');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // Сканируем JS файлы
  console.log('📂 Сканирование JavaScript файлов...\n');
  const publicFields = scanDirectory(path.join(__dirname, '../public/assets/js'));
  const srcFields = scanDirectory(path.join(__dirname, '../src'));

  // Объединяем
  const allFields = {};
  for (const fields of [publicFields, srcFields]) {
    for (const [table, fieldSet] of Object.entries(fields)) {
      if (!allFields[table]) allFields[table] = new Set();
      for (const field of fieldSet) {
        allFields[table].add(field);
      }
    }
  }

  console.log(`Найдено ${Object.keys(allFields).length} таблиц в коде\n`);

  // Сравниваем с БД
  const sqlStatements = [];
  const report = {
    missing: [],
    extra: [],
    ok: []
  };

  for (const table of TABLES) {
    const exists = await tableExists(table);
    if (!exists) {
      console.log(`⚠️  Таблица ${table} не существует в БД`);
      continue;
    }

    const dbColumns = await getDbColumns(table);
    const dbColumnNames = new Set(dbColumns.map(c => c.column_name));
    const jsFields = allFields[table] || new Set();

    console.log(`\n📋 Таблица: ${table}`);
    console.log(`   В БД: ${dbColumnNames.size} колонок`);
    console.log(`   В JS: ${jsFields.size} полей`);

    // Находим недостающие колонки
    const missing = [];
    for (const field of jsFields) {
      if (!dbColumnNames.has(field) && field.length > 1 && !field.startsWith('_')) {
        // Фильтруем очевидно неправильные
        if (!/^[a-z][a-z0-9_]*$/.test(field)) continue;
        if (['id', 'key', 'value', 'data', 'item', 'items', 'result', 'response', 'error', 'message', 'options', 'config', 'settings', 'params', 'args', 'callback', 'handler', 'event', 'target', 'element', 'node', 'parent', 'child', 'children', 'index', 'length', 'size', 'width', 'height', 'style', 'class', 'type', 'name', 'label', 'placeholder', 'disabled', 'checked', 'selected', 'visible', 'hidden', 'active', 'focus', 'blur', 'click', 'change', 'submit', 'reset', 'open', 'close', 'show', 'hide', 'toggle', 'add', 'remove', 'update', 'delete', 'get', 'set', 'put', 'post', 'fetch', 'load', 'save', 'create', 'edit', 'view', 'list', 'filter', 'sort', 'search', 'find', 'map', 'reduce', 'forEach', 'some', 'every', 'includes', 'indexOf', 'slice', 'splice', 'push', 'pop', 'shift', 'unshift', 'concat', 'join', 'split', 'replace', 'match', 'test', 'exec', 'parse', 'stringify', 'toString', 'valueOf', 'then', 'catch', 'finally', 'resolve', 'reject', 'all', 'race', 'any', 'allSettled'].includes(field)) continue;

        missing.push(field);
        const fieldType = getFieldType(field);
        sqlStatements.push(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${field} ${fieldType};`);
        report.missing.push({ table, field, type: fieldType });
      }
    }

    if (missing.length > 0) {
      console.log(`   ❌ Недостающие: ${missing.join(', ')}`);
    } else {
      console.log(`   ✅ Все колонки на месте`);
    }
  }

  // Выводим SQL
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('                      SQL для синхронизации');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  if (sqlStatements.length === 0) {
    console.log('✅ Все колонки синхронизированы, изменения не требуются.\n');
  } else {
    console.log(`Найдено ${sqlStatements.length} недостающих колонок:\n`);

    // Группируем по таблицам
    const byTable = {};
    for (const stmt of sqlStatements) {
      const match = stmt.match(/ALTER TABLE (\w+)/);
      if (match) {
        const t = match[1];
        if (!byTable[t]) byTable[t] = [];
        byTable[t].push(stmt);
      }
    }

    for (const [table, stmts] of Object.entries(byTable)) {
      console.log(`-- ${table}`);
      for (const stmt of stmts) {
        console.log(stmt);
      }
      console.log('');
    }

    // Сохраняем в файл
    const sqlFile = path.join(__dirname, 'sync_schema.sql');
    fs.writeFileSync(sqlFile, sqlStatements.join('\n'));
    console.log(`\n📄 SQL сохранён в: ${sqlFile}`);
    console.log('\nДля применения выполните:');
    console.log(`sudo -u postgres psql asgard_crm -f ${sqlFile}`);
  }

  await pool.end();
}

main().catch(err => {
  console.error('Ошибка:', err);
  process.exit(1);
});
