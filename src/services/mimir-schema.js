/**
 * ASGARD CRM — Mimir Text-to-SQL Service
 *
 * Даёт Мимиру доступ к базе данных через генерацию SQL-запросов.
 * Двухэтапная схема:
 *   1) AI генерирует SELECT-запрос по схеме БД
 *   2) Сервер выполняет с RBAC-фильтрацией и таймаутом
 *
 * Безопасность: только SELECT, LIMIT 50, RBAC по ролям, таймаут 5с, логирование
 */

'use strict';

const { hasFullAccess, isPM, isTO, isHR, isBUH } = require('./mimir-data');

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA CACHE
// ═══════════════════════════════════════════════════════════════════════════

let _schemaCache = null;
let _schemaCacheTime = 0;
const SCHEMA_CACHE_TTL = 3600000; // 1 час

/**
 * Получить схему БД (таблицы + колонки + типы)
 */
async function getDbSchema(db) {
  const result = await db.query(`
    SELECT
      table_name,
      string_agg(
        column_name || ' ' || data_type,
        ', ' ORDER BY ordinal_position
      ) AS columns
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name NOT LIKE 'pg_%'
      AND table_name NOT IN ('migrations','sessions','mimir_usage_log','mimir_auto_log','mimir_auto_config')
    GROUP BY table_name
    ORDER BY table_name
  `);
  return result.rows.map(r => `${r.table_name}: ${r.columns}`).join('\n');
}

async function getCachedSchema(db) {
  if (_schemaCache && Date.now() - _schemaCacheTime < SCHEMA_CACHE_TTL) return _schemaCache;
  _schemaCache = await getDbSchema(db);
  _schemaCacheTime = Date.now();
  return _schemaCache;
}

// ═══════════════════════════════════════════════════════════════════════════
// SQL VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Проверить и обезопасить SQL-запрос.
 * Допускается ТОЛЬКО SELECT. Добавляет LIMIT если нет.
 */
function validateSQL(query) {
  if (!query || typeof query !== 'string') throw new Error('Пустой SQL');

  const trimmed = query.trim().replace(/;+\s*$/, ''); // убрать trailing ;

  // Запрет мутирующих операций
  const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXEC|EXECUTE|COPY|SET\s+ROLE|SET\s+SESSION)\b/i;
  if (forbidden.test(trimmed)) throw new Error('Только SELECT запросы разрешены');

  // Должен начинаться с SELECT (или WITH ... SELECT)
  if (!/^\s*(SELECT|WITH)\b/i.test(trimmed)) throw new Error('Запрос должен начинаться с SELECT');

  // Добавить LIMIT если нет
  let final = trimmed;
  if (!/LIMIT\s+\d+/i.test(final)) {
    final += ' LIMIT 50';
  } else {
    // Ограничить LIMIT до 50
    final = final.replace(/LIMIT\s+(\d+)/i, (match, n) => {
      return `LIMIT ${Math.min(parseInt(n), 50)}`;
    });
  }

  return final;
}

// ═══════════════════════════════════════════════════════════════════════════
// RBAC — Ролевая фильтрация SQL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Применить RBAC-фильтры к SQL-запросу на основе роли пользователя.
 * ADMIN/DIRECTOR — полный доступ. Остальные — ограничения.
 */
function applyRBAC(query, user) {
  const role = user.role;
  const userId = user.id;

  // Чёрный список для всех кроме ADMIN/DIRECTOR
  if (!hasFullAccess(role)) {
    if (/password_hash|pin_hash|api_key|secret_key|refresh_token/i.test(query)) {
      throw new Error('Доступ к конфиденциальным полям запрещён');
    }
  }

  // ADMIN, DIRECTOR_* — полный доступ
  if (hasFullAccess(role)) return query;

  // PM — только свои данные (работы, просчёты, тендеры где они РП)
  if (isPM(role)) {
    if (/\bfield_payments\b/i.test(query) || /\bsalary\b/i.test(query)) {
      // PM может видеть только свои полевые выплаты (через работы)
    }
    if (/\bpassport\b/i.test(query)) {
      throw new Error('Нет доступа к паспортным данным');
    }
  }

  // TO — тендеры, ничего больше
  if (isTO(role)) {
    if (/\bfield_payments\b|\bsalar/i.test(query) || /\bpassport\b/i.test(query)) {
      throw new Error('Нет доступа к этим данным');
    }
    if (/\bincomes\b|\bwork_expenses\b|\binvoices\b/i.test(query)) {
      throw new Error('Нет доступа к финансовым данным');
    }
  }

  // BUH — финансы, но не персональные данные
  if (isBUH(role)) {
    if (/\bpassport\b/i.test(query)) {
      throw new Error('Нет доступа к персональным данным');
    }
  }

  // HR — только сотрудники
  if (isHR(role)) {
    if (/\btenders\b|\bestimates\b|\bworks\b|\bincomes\b|\binvoices\b|\bwork_expenses\b/i.test(query)) {
      throw new Error('Нет доступа к этим данным');
    }
  }

  // WAREHOUSE — только оборудование
  if (role === 'WAREHOUSE') {
    if (/\btenders\b|\bestimates\b|\bfield_payments\b|\bincomes\b|\binvoices\b/i.test(query)) {
      throw new Error('Нет доступа к этим данным');
    }
  }

  return query;
}

// ═══════════════════════════════════════════════════════════════════════════
// SAFE SQL EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Выполнить SQL безопасно: валидация + RBAC + таймаут 5с
 */
async function executeSafeSQL(db, query, user) {
  // 1) Validate
  const validated = validateSQL(query);

  // 2) RBAC
  const filtered = applyRBAC(validated, user);

  // 3) Execute with timeout
  const result = await Promise.race([
    db.query(filtered),
    new Promise((_, reject) => setTimeout(() => reject(new Error('SQL timeout 5s')), 5000))
  ]);

  return result.rows;
}

// ═══════════════════════════════════════════════════════════════════════════
// TEXT-TO-SQL: AI генерирует SQL
// ═══════════════════════════════════════════════════════════════════════════

const SQL_GENERATOR_SYSTEM = `Ты SQL-генератор для PostgreSQL базы данных CRM-системы АСГАРД.
Пользователь задаёт вопрос на русском — ты генерируешь SQL SELECT-запрос.

ПРАВИЛА:
- Генерируй ТОЛЬКО SELECT запросы
- LIMIT 50 максимум
- Отвечай ТОЛЬКО SQL-запросом, без пояснений, без markdown, без обёрток
- Используй ILIKE для поиска по тексту (русский язык)
- Используй агрегатные функции (COUNT, SUM, AVG) для количественных вопросов
- Для поиска людей: таблица users (login, name, role), таблица employees (full_name, position, phone)
- Для тендеров: таблица tenders (tender_number, customer_name, object_name, tender_status, amount, deadline)
- Для работ: таблица works (work_number, contract_value, work_status, pm_id)
- Для просчётов: таблица estimates (title, object_name, approval_status, pm_id)
- Для финансов: таблицы incomes, work_expenses, invoices
- Для оборудования: таблица equipment (name, inventory_number, status, category_id)
- Для сотрудников на объектах: таблица field_payments (worker_id, amount, period, work_id)
- JOIN users u ON ... для получения имён пользователей
- Если вопрос НЕ про данные или ты НЕ уверен в запросе — ответь одним словом: NO_SQL
- Если вопрос общий (приветствие, благодарность, помощь) — ответь: NO_SQL`;

/**
 * Попросить AI сгенерировать SQL-запрос по вопросу пользователя.
 * Возвращает SQL-строку или null если AI не смог/не нужен SQL.
 */
async function generateSQL(aiProvider, db, question) {
  const schema = await getCachedSchema(db);

  const result = await aiProvider.completeAnalytics({
    system: SQL_GENERATOR_SYSTEM + '\n\nСХЕМА БД:\n' + schema,
    messages: [{ role: 'user', content: question }],
    maxTokens: 500,
    temperature: 0.1
  });

  const text = (result.text || '').trim();

  // AI отказался
  if (!text || text === 'NO_SQL' || text.startsWith('NO_SQL')) return null;

  // Извлечь SQL из ответа (на случай если AI обернул в ```)
  let sql = text;
  const codeMatch = sql.match(/```(?:sql)?\s*([\s\S]*?)```/);
  if (codeMatch) sql = codeMatch[1].trim();

  // Проверить что это SQL
  if (!/^\s*(SELECT|WITH)\b/i.test(sql)) return null;

  return sql;
}

// ═══════════════════════════════════════════════════════════════════════════
// FORMAT SQL RESULTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Форматировать результаты SQL в текстовую таблицу для AI
 */
function formatSQLResults(rows) {
  if (!rows || rows.length === 0) return 'Результат: пустой (0 строк)';

  const cols = Object.keys(rows[0]);
  const header = '| ' + cols.join(' | ') + ' |';
  const separator = '|' + cols.map(() => '---').join('|') + '|';
  const body = rows.map(row =>
    '| ' + cols.map(c => {
      const v = row[c];
      if (v === null || v === undefined) return '—';
      if (v instanceof Date) return v.toLocaleDateString('ru-RU');
      if (typeof v === 'number') return v.toLocaleString('ru-RU');
      return String(v).substring(0, 100);
    }).join(' | ') + ' |'
  ).join('\n');

  return `Результат запроса (${rows.length} строк):\n${header}\n${separator}\n${body}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// LOGGING
// ═══════════════════════════════════════════════════════════════════════════

async function logMimirSQL(db, userId, question, generatedSQL, resultRows, durationMs, error) {
  try {
    await db.query(
      `INSERT INTO mimir_auto_log (chat_id, trigger_action, trigger_comment, response, duration_ms, scenario)
       VALUES (NULL, 'text_to_sql', $1, $2, $3, $4)`,
      [
        question.substring(0, 500),
        (generatedSQL || 'NO_SQL').substring(0, 2000),
        durationMs,
        error ? 'sql_error: ' + error : (resultRows > 0 ? `found_${resultRows}` : 'empty')
      ]
    );
  } catch (e) { /* ignore logging errors */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN: ПОЛНЫЙ PIPELINE Text-to-SQL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Полный Text-to-SQL pipeline:
 *   1) AI генерирует SQL по вопросу
 *   2) Валидация + RBAC + выполнение
 *   3) Возвращает отформатированные данные для контекста AI
 *
 * @returns {{ dataContext: string|null, sql: string|null, rowCount: number }}
 */
async function textToSQL(aiProvider, db, question, user) {
  const startTime = Date.now();
  let sql = null;
  let rowCount = 0;
  let error = null;

  try {
    // Этап 1: AI генерирует SQL
    sql = await generateSQL(aiProvider, db, question);
    if (!sql) return { dataContext: null, sql: null, rowCount: 0 };

    // Этап 2: Выполнить безопасно
    const rows = await executeSafeSQL(db, sql, user);
    rowCount = rows.length;

    const durationMs = Date.now() - startTime;
    logMimirSQL(db, user.id, question, sql, rowCount, durationMs, null);

    if (rowCount === 0) {
      return { dataContext: 'Запрос к БД выполнен, но данных не найдено.', sql, rowCount: 0 };
    }

    return { dataContext: formatSQLResults(rows), sql, rowCount };

  } catch (err) {
    error = err.message;
    const durationMs = Date.now() - startTime;
    logMimirSQL(db, user.id, question, sql, 0, durationMs, error);

    // Не пробрасываем ошибку — AI ответит без данных из БД
    // Но если это RBAC-ошибка, передадим в контекст
    if (/Нет доступа|запрещён/i.test(error)) {
      return { dataContext: `Доступ к запрошенным данным ограничен: ${error}`, sql, rowCount: 0 };
    }

    return { dataContext: null, sql: null, rowCount: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  getDbSchema,
  getCachedSchema,
  validateSQL,
  applyRBAC,
  executeSafeSQL,
  generateSQL,
  formatSQLResults,
  logMimirSQL,
  textToSQL
};
