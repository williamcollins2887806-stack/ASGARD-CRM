/**
 * Expenses Routes (work_expenses + office_expenses)
 */

// ═══════════════════════════════════════════════════════════════════════════
// SECURITY: Ролевой контроль для финансовых операций (HIGH-9)
// ═══════════════════════════════════════════════════════════════════════════
const WRITE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'PM', 'BUH'];

// SECURITY: Allowlist of columns for expenses
const WORK_EXP_COLS = new Set([
  'work_id', 'category', 'subcategory', 'description', 'amount', 'date', 'receipt_url',
  'supplier', 'notes', 'status', 'created_by', 'created_at', 'updated_at',
  'doc_number', 'vat_rate', 'vat_amount', 'amount_ex_vat', 'payment_method',
  'comment', 'invoice_needed', 'invoice_received',
  // ФОТ-поля (V050) — нужны для редактирования зарплатных строк
  'fot_employee_id', 'fot_employee_name', 'fot_base_pay', 'fot_per_diem', 'fot_bonus',
  'fot_date_from', 'fot_date_to',
  // Source tracking (V071) — для автосинка из field/worker_payments
  'source_table', 'source_id', 'source_key', 'is_finalized'
]);
const OFFICE_EXP_COLS = new Set([
  'category', 'description', 'amount', 'date', 'receipt_url',
  'supplier', 'notes', 'status', 'created_by', 'created_at', 'updated_at',
  // СчётФактура: эти колонки давно есть в БД (см. SELECT information_schema), но
  // allowlist их не пропускал — чекбоксы СФ-нужен/СФ-получен молча дропались.
  'doc_number', 'invoice_needed', 'invoice_received',
  // Финансовые детали: НДС/итого/оплата — тоже есть в БД, но без allowlist не писались.
  'vat_pct', 'vat_amount', 'total_amount', 'payment_date', 'payment_method',
  'contract_id', 'work_id', 'comment'
]);

function filterData(data, allowedSet) {
  const filtered = {};
  for (const [k, v] of Object.entries(data)) {
    if (allowedSet.has(k) && v !== undefined) filtered[k] = v;
  }
  return filtered;
}

async function routes(fastify, options) {
  const db = fastify.db;

  // Work expenses
  fastify.get('/work', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    // RBAC: финансовые операции по работам доступны только участникам цикла —
    // PM/HEAD_PM/BUH/директора/ADMIN/OFFICE_MANAGER (вспомогательная для контроля).
    const EXP_READ_ROLES = new Set(['ADMIN', 'PM', 'HEAD_PM', 'BUH', 'OFFICE_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV']);
    if (!EXP_READ_ROLES.has(request.user.role)) return reply.code(403).send({ error: 'Нет доступа к расходам по работам' });
    const { work_id, category, date_from, date_to, limit = 100, offset = 0 } = request.query;
    let sql = 'SELECT e.*, w.work_number FROM work_expenses e LEFT JOIN works w ON e.work_id = w.id WHERE 1=1';
    const params = [];
    let idx = 1;
    if (work_id) { sql += ` AND e.work_id = $${idx}`; params.push(work_id); idx++; }
    if (category) { sql += ` AND e.category = $${idx}`; params.push(category); idx++; }
    if (date_from) { sql += ` AND e.date >= $${idx}`; params.push(date_from); idx++; }
    if (date_to) { sql += ` AND e.date <= $${idx}`; params.push(date_to); idx++; }
    sql += ` ORDER BY e.date DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);
    const result = await db.query(sql, params);
    return { expenses: result.rows };
  });

  // GET /api/expenses/categories — единый словарь для фронтов
  // Фронты больше не хардкодят список — тянут отсюда. См. work-expense-categories.js.
  fastify.get('/categories', { preHandler: [fastify.authenticate] }, async (_request, reply) => {
    const taxo = require('../services/work-expense-categories');
const { logError } = require('../lib/log-error');
    return reply.send({
      categories: taxo.CATEGORIES,
      subcategories: {
        cash: taxo.CASH_SUBCATEGORIES,
        subcontract: taxo.SUB_SUBCATEGORIES,
      },
      payment_methods: taxo.PAYMENT_METHODS,
    });
  });

  // SECURITY: Только WRITE_ROLES (HIGH-9)
  // POST → одна точка записи через src/services/work-expense-writer.js
  fastify.post('/work', { preHandler: [fastify.requireRoles(WRITE_ROLES)] }, async (request, reply) => {
    const body = request.body || {};
    try {
      const { insertWorkExpense } = require('../services/work-expense-writer');
      const row = await insertWorkExpense(db, {
        ...body,
        created_by: request.user.id,
        source_table: body.source_table || 'manual',
      });
      return reply.send({ expense: row });
    } catch (err) {
      // Валидационные / FK ошибки возвращаем 400 (понятный текст), остальное 500
      const msg = err?.message || 'Не удалось сохранить расход';
      if (/обязател|не входит|положитель|подкатегори|payment_method/i.test(msg)) {
        return reply.code(400).send({ error: msg });
      }
      logError(request, '[expenses.POST /work]', err, request);
      return reply.code(500).send({ error: msg });
    }
  });

  // Office expenses
  fastify.get('/office', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    // RBAC: офисные расходы видят только финансовые роли.
    const OFFICE_READ_ROLES = new Set(['ADMIN', 'BUH', 'OFFICE_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV']);
    if (!OFFICE_READ_ROLES.has(request.user.role)) return reply.code(403).send({ error: 'Нет доступа к офисным расходам' });
    const { category, status, date_from, date_to, limit = 100, offset = 0 } = request.query;
    let sql = 'SELECT * FROM office_expenses WHERE 1=1';
    const params = [];
    let idx = 1;
    if (category) { sql += ` AND category = $${idx}`; params.push(category); idx++; }
    if (status) { sql += ` AND status = $${idx}`; params.push(status); idx++; }
    if (date_from) { sql += ` AND date >= $${idx}`; params.push(date_from); idx++; }
    if (date_to) { sql += ` AND date <= $${idx}`; params.push(date_to); idx++; }
    sql += ` ORDER BY date DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);
    const result = await db.query(sql, params);
    return { expenses: result.rows };
  });

  // SECURITY: Только WRITE_ROLES (HIGH-9)
  // SECURITY: SQL injection fix — filter keys
  fastify.post('/office', { preHandler: [fastify.requireRoles(WRITE_ROLES)] }, async (request, reply) => {
    const body = request.body || {};
    if (!body.amount || !body.category) {
      return reply.code(400).send({ error: 'Обязательные поля: amount, category' });
    }
    const data = filterData({ ...body, created_by: request.user.id, created_at: new Date().toISOString(), status: 'pending' }, OFFICE_EXP_COLS);
    const keys = Object.keys(data);
    const values = Object.values(data);
    const sql = `INSERT INTO office_expenses (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
    const result = await db.query(sql, values);
    return { expense: result.rows[0] };
  });

  // Generic update/delete
  // SECURITY: Только WRITE_ROLES (HIGH-9)
  fastify.put('/:type/:id', { preHandler: [fastify.requireRoles(WRITE_ROLES)] }, async (request, reply) => {
    try {
      const { type, id } = request.params;
      if (!['work', 'office'].includes(type)) return reply.code(400).send({ error: 'Тип: work или office' });
      const table = type === 'work' ? 'work_expenses' : 'office_expenses';
      const allowedSet = type === 'work' ? WORK_EXP_COLS : OFFICE_EXP_COLS;
      const data = filterData(request.body, allowedSet);
      const updates = [];
      const values = [];
      let idx = 1;
      for (const [key, value] of Object.entries(data)) {
        updates.push(`${key} = $${idx}`); values.push(value); idx++;
      }
      if (!updates.length) return reply.code(400).send({ error: 'Нет данных' });
      updates.push('updated_at = NOW()');
      values.push(id);
      const sql = `UPDATE ${table} SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`;
      const result = await db.query(sql, values);
      if (!result.rows[0]) return reply.code(404).send({ error: 'Не найден' });
      return { expense: result.rows[0] };
    } catch (err) {
      if (err.code === '22003') return reply.code(400).send({ error: 'Числовое значение вне допустимого диапазона' });
      if (err.code === '23503') return reply.code(400).send({ error: 'Связанная запись не найдена' });
      throw err;
    }
  });

  // SECURITY: Только WRITE_ROLES (HIGH-9)
  fastify.delete('/:type/:id', { preHandler: [fastify.requireRoles(WRITE_ROLES)] }, async (request, reply) => {
    const { type, id } = request.params;
    const table = type === 'work' ? 'work_expenses' : 'office_expenses';
    const result = await db.query(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [id]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найден' });
    return { message: 'Удалено' };
  });
  // ═══════════════════════════════════════════════════════════════════
  // EXPENSE ITEMS — позиции расхода (товары/услуги из счёта)
  // ═══════════════════════════════════════════════════════════════════

  // GET /api/expenses/items/:expense_id — все позиции расхода
  fastify.get('/items/:expense_id', { preHandler: [fastify.authenticate] }, async (request) => {
    const { rows } = await db.query(
      'SELECT * FROM work_expense_items WHERE expense_id = $1 ORDER BY position, id',
      [request.params.expense_id]
    );
    return { items: rows };
  });

  // POST /api/expenses/items/:expense_id — добавить позицию
  fastify.post('/items/:expense_id', { preHandler: [fastify.requireRoles(WRITE_ROLES)] }, async (request) => {
    const { name, unit, quantity, price, amount, vat_rate, vat_amount, note, position } = request.body || {};
    if (!name) return { error: 'Наименование обязательно' };
    const { rows } = await db.query(`
      INSERT INTO work_expense_items (expense_id, position, name, unit, quantity, price, amount, vat_rate, vat_amount, note)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *
    `, [request.params.expense_id, position || 1, name, unit || 'шт',
        quantity || 1, price || null, amount || null, vat_rate || null, vat_amount || null, note || null]);
    return { item: rows[0] };
  });

  // POST /api/expenses/items/:expense_id/bulk — массовое добавление позиций
  fastify.post('/items/:expense_id/bulk', { preHandler: [fastify.requireRoles(WRITE_ROLES)] }, async (request) => {
    const items = request.body?.items;
    if (!Array.isArray(items) || !items.length) return { error: 'Пустой массив' };
    const inserted = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const { rows } = await db.query(`
        INSERT INTO work_expense_items (expense_id, position, name, unit, quantity, price, amount, vat_rate, vat_amount, note)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *
      `, [request.params.expense_id, it.position || i + 1, it.name, it.unit || 'шт',
          it.quantity || 1, it.price || null, it.amount || null, it.vat_rate || null, it.vat_amount || null, it.note || null]);
      inserted.push(rows[0]);
    }
    return { items: inserted, count: inserted.length };
  });

  // DELETE /api/expenses/items/:expense_id/:item_id — удалить позицию
  fastify.delete('/items/:expense_id/:item_id', { preHandler: [fastify.requireRoles(WRITE_ROLES)] }, async (request) => {
    const { rows } = await db.query(
      'DELETE FROM work_expense_items WHERE id = $1 AND expense_id = $2 RETURNING id',
      [request.params.item_id, request.params.expense_id]
    );
    if (!rows.length) return { error: 'Не найдена' };
    return { ok: true };
  });

  // ═══════════════════════════════════════════════════════════════════
  // ATTACH FILE — привязать файл (receipt) к расходу
  // ═══════════════════════════════════════════════════════════════════

  // POST /api/expenses/attach/:expense_id — загрузить и привязать файл
  fastify.post('/attach/:expense_id', { preHandler: [fastify.requireRoles(WRITE_ROLES)] }, async (request, reply) => {
    const expenseId = parseInt(request.params.expense_id);
    try {
      const { rows: [expense] } = await db.query('SELECT id, work_id FROM work_expenses WHERE id = $1', [expenseId]);
      if (!expense) return reply.code(404).send({ error: 'Расход не найден' });

      const parts = request.parts();
      let file = null;
      for await (const part of parts) {
        if (part.file) {
          file = { filename: part.filename, mimetype: part.mimetype, buffer: await part.toBuffer() };
        }
      }
      if (!file) return reply.code(400).send({ error: 'Файл не загружен' });

      const path = require('path');
      const fs = require('fs').promises;
      const { v4: uuidv4 } = require('uuid');

      const ext = path.extname(file.filename).toLowerCase();
      const storedName = uuidv4() + ext;
      const uploadDir = process.env.UPLOAD_DIR || './uploads';
      // Каталог может отсутствовать (напр. после rsync/чистого чекаута) —
      // тогда fs.writeFile кидал ENOENT → тихий 500 без лога. Гарантируем наличие.
      await fs.mkdir(uploadDir, { recursive: true });
      await fs.writeFile(path.join(uploadDir, storedName), file.buffer);

      // Сохраняем в documents
      const { rows: [doc] } = await db.query(`
        INSERT INTO documents (filename, original_name, mime_type, size, type, work_id, uploaded_by, download_url, created_at)
        VALUES ($1, $2, $3, $4, 'Счёт', $5, $6, $7, NOW()) RETURNING *
      `, [storedName, file.filename, file.mimetype, file.buffer.length,
          expense.work_id, request.user.id, `/api/files/preview/${storedName}`]);

      // Привязываем к расходу
      await db.query('UPDATE work_expenses SET receipt_url = $1 WHERE id = $2',
        [`/api/files/preview/${storedName}`, expenseId]);

      return { ok: true, document: doc, preview_url: `/api/files/preview/${storedName}` };
    } catch (err) {
      const { logError } = require('../lib/log-error');
      logError(request, `[expenses.POST /attach/${expenseId}]`, err, request);
      return reply.code(500).send({ error: err?.message || 'Не удалось прикрепить файл' });
    }
  });
}

module.exports = routes;
