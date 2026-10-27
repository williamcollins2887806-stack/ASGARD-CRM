/**
 * ЕДИНАЯ точка записи в work_expenses.
 *
 * До этого INSERT был в трёх местах (expenses.js, mimir.js, field-funds.js) — каждое
 * со своим списком колонок и дефолтов. Поэтому field-funds писал в несуществующие
 * колонки и молча терял данные, а mimir не писал payment_method.
 *
 * Сейчас все три пути зовут insertWorkExpense(db, payload, opts).
 *  - Валидация category/subcategory/payment_method через work-expense-categories.js
 *  - Дефолты: payment_method='cash' если не задан явно
 *  - Защита от дублей через ON CONFLICT (source_table, source_key)
 *  - INSERT возвращает свежую запись (с auto-id)
 *
 * Если хочешь поменять схему записи — меняй здесь, не в трёх местах.
 */

const cat = require('./work-expense-categories');

/**
 * @typedef WorkExpensePayload
 * @property {number} work_id
 * @property {string} category
 * @property {?string} [subcategory]
 * @property {number} amount
 * @property {?string} [date]            ISO date "YYYY-MM-DD" — по умолчанию сегодня
 * @property {?string} [description]
 * @property {?string} [supplier]
 * @property {?string} [notes]
 * @property {?string} [doc_number]
 * @property {?number} [vat_rate]
 * @property {?number} [vat_amount]
 * @property {?number} [amount_ex_vat]
 * @property {?string} [receipt_url]
 * @property {?string} [payment_method]  cash/card/bank/self/auto — дефолт см. defaultPaymentMethod
 * @property {?string} [source_table]
 * @property {?(string|number)} [source_id]
 * @property {?string} [source_key]
 * @property {?string} [status]          confirmed/pending/draft — по умолчанию 'confirmed'
 * @property {?number} [created_by]
 * @property {?number|null} [fot_employee_id]
 * @property {?string} [fot_employee_name]
 * @property {?number} [fot_base_pay]
 * @property {?number} [fot_per_diem]
 * @property {?number} [fot_bonus]
 * @property {?string} [fot_date_from]
 * @property {?string} [fot_date_to]
 */

/**
 * @param {*} db — pg-pool / fastify.db
 * @param {WorkExpensePayload} p
 * @param {object} [opts]
 * @param {boolean} [opts.skipValidation=false] — пропустить serverside validation (только для миграций)
 * @returns {Promise<object>} вставленная запись
 */
async function insertWorkExpense(db, p, opts = {}) {
  if (!p || !p.work_id) throw new Error('work_id обязателен');
  if (p.amount === undefined || p.amount === null || Number(p.amount) <= 0) {
    throw new Error('amount должен быть положительным числом');
  }

  // Валидация taxonomy (только если не skipValidation — миграции пишут «как есть»)
  if (!opts.skipValidation) {
    const catErr = cat.validateCategory(p.category, p.subcategory || null);
    if (catErr) throw new Error(catErr);

    const pmErr = cat.validatePaymentMethod(p.payment_method);
    if (pmErr) throw new Error(pmErr);
  }

  // Дефолты
  const today = new Date().toISOString().slice(0, 10);
  const payment_method = p.payment_method || cat.defaultPaymentMethod(p.category);
  const status = p.status || 'confirmed';

  // Сборка колонок (NULL → не передаём, пусть БД ставит дефолт)
  const cols = {
    work_id: p.work_id,
    category: p.category,
    subcategory: p.subcategory || null,
    amount: Number(p.amount),
    date: p.date || today,
    description: p.description != null ? String(p.description).substring(0, 500) : null,
    supplier: p.supplier != null ? String(p.supplier).substring(0, 500) : null,
    notes: p.notes != null ? String(p.notes).substring(0, 1000) : null,
    doc_number: p.doc_number || null,
    vat_rate: p.vat_rate != null ? Number(p.vat_rate) : null,
    vat_amount: p.vat_amount != null ? Number(p.vat_amount) : null,
    amount_ex_vat: p.amount_ex_vat != null ? Number(p.amount_ex_vat) : null,
    // V443: что такое amount — 'gross' (с НДС) или 'net' (без НДС).
    // Без этого поля сумма трактовалась каждым путём ввода по-своему (баг #406).
    vat_basis: p.vat_basis === 'gross' || p.vat_basis === 'net' ? p.vat_basis : null,
    receipt_url: p.receipt_url || null,
    payment_method,
    source_table: p.source_table || 'manual',
    source_id: p.source_id != null ? Number(p.source_id) : null,
    source_key: p.source_key || null,
    status,
    created_by: p.created_by != null ? Number(p.created_by) : null,
    // ФОТ-поля (V050) — необязательные
    fot_employee_id: p.fot_employee_id != null ? Number(p.fot_employee_id) : null,
    fot_employee_name: p.fot_employee_name || null,
    fot_base_pay: p.fot_base_pay != null ? Number(p.fot_base_pay) : null,
    fot_per_diem: p.fot_per_diem != null ? Number(p.fot_per_diem) : null,
    fot_bonus: p.fot_bonus != null ? Number(p.fot_bonus) : null,
    fot_date_from: p.fot_date_from || null,
    fot_date_to: p.fot_date_to || null,
  };

  const keys = Object.keys(cols);
  const values = keys.map(k => cols[k]);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');

  // Upsert по (source_table, source_key) через SELECT+UPDATE.
  // Почему не ON CONFLICT: в некоторых тест/старых БД нет unique индекса на эту пару.
  // В таком случае ON CONFLICT (...) падает с 42P10 и ломает весь insert-поток.
  if (p.source_table && p.source_key) {
    const { rows: existed } = await db.query(
      `SELECT id FROM work_expenses WHERE source_table = $1 AND source_key = $2 LIMIT 1`,
      [p.source_table, p.source_key]
    );
    if (existed[0]?.id) {
      const id = existed[0].id;
      // V443: НДС-поля тоже обновляем. COALESCE здесь был дефектом: если
      // счёт перестал быть «с НДС» (пере-оплата без счёта-фактуры), старые
      // vat_amount/vat_basis оставались навсегда и давали фантомный вычет
      // (нашёл верификатор 27.10.2026). Теперь: пришло значение — пишем,
      // пришёл явный null при непустом vat_basis-наборе — тоже пишем.
      // Защита: не затираем НДС, если в payload его вообще не передали
      // (undefined) — это несвязанное обновление.
      const setVat = p.vat_amount !== undefined || p.vat_basis !== undefined;
      const { rows } = await db.query(
        `UPDATE work_expenses
            SET amount = $1,
                description = COALESCE($2, description),
                supplier = COALESCE($3, supplier),
                receipt_url = COALESCE($4, receipt_url),
                vat_rate = CASE WHEN $9 THEN $5 ELSE vat_rate END,
                vat_amount = CASE WHEN $9 THEN $6 ELSE vat_amount END,
                amount_ex_vat = CASE WHEN $9 THEN $7 ELSE amount_ex_vat END,
                vat_basis = CASE WHEN $9 THEN $8 ELSE vat_basis END,
                updated_at = NOW()
          WHERE id = $10
          RETURNING *`,
        [cols.amount, cols.description, cols.supplier, cols.receipt_url,
         cols.vat_rate, cols.vat_amount, cols.amount_ex_vat, cols.vat_basis, setVat, id]
      );
      return rows[0];
    }
  }

  const sql = `
    INSERT INTO work_expenses (${keys.join(', ')}, created_at, updated_at)
    VALUES (${placeholders}, NOW(), NOW())
    RETURNING *
  `;
  const { rows } = await db.query(sql, values);
  return rows[0];
}

module.exports = { insertWorkExpense };
