/**
 * ASGARD Field — Master Funds API (Подотчёт мастера)
 * ═══════════════════════════════════════════════════════════════
 * POST /                     — PM issues funds to master (CRM auth)
 * GET  /                     — list funds for project (CRM auth)
 * GET  /:id                  — fund details + expenses (CRM auth)
 * PUT  /:id/close            — close fund report (CRM auth)
 *
 * PUT  /:id/confirm          — master confirms receipt (Field auth)
 * POST /:id/expense          — add expense with receipt (Field auth, multipart)
 * POST /:id/return           — return remainder (Field auth)
 * GET  /my/balance           — master's current balance (Field auth)
 * GET  /my                   — master's funds list (Field auth)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_BASE = process.env.UPLOAD_DIR || './uploads';
const MAX_RECEIPT_SIZE = 15 * 1024 * 1024; // 15MB

const MANAGE_ROLES = ['PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'BUH'];

async function routes(fastify, options) {
  const db = fastify.db;
  const crmAuth = { preHandler: [fastify.requireRoles(MANAGE_ROLES)] };
  const fieldAuth = { preHandler: [fastify.fieldAuthenticate] };

  // ═════════════════════════════════════════════════════════════════════
  // CRM ENDPOINTS (PM / Admin)
  // ═════════════════════════════════════════════════════════════════════

  // ─────────────────────────────────────────────────────────────────────
  // POST / — issue funds to master
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/', crmAuth, async (req, reply) => {
    try {
      const userId = req.user.id;
      const { work_id, master_employee_id, amount, purpose, confirm_deadline } = req.body || {};

      if (!work_id || !master_employee_id || !amount || !purpose) {
        return reply.code(400).send({ error: 'Укажите work_id, master_employee_id, amount, purpose' });
      }
      if (parseFloat(amount) <= 0) {
        return reply.code(400).send({ error: 'Сумма должна быть больше 0' });
      }

      // Verify work exists
      const { rows: work } = await db.query('SELECT id FROM works WHERE id = $1', [work_id]);
      if (work.length === 0) return reply.code(404).send({ error: 'Проект не найден' });

      // Verify employee exists
      const { rows: emp } = await db.query('SELECT id, fio FROM employees WHERE id = $1', [master_employee_id]);
      if (emp.length === 0) return reply.code(404).send({ error: 'Сотрудник не найден' });

      const { rows: inserted } = await db.query(`
        INSERT INTO field_master_funds (work_id, master_employee_id, issued_by, amount, purpose, confirm_deadline, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'issued')
        RETURNING *
      `, [work_id, master_employee_id, userId, amount, purpose, confirm_deadline || null]);

      return { fund: inserted[0] };
    } catch (err) {
      fastify.log.error('[field-funds] POST / error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET / — list funds for project
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/', crmAuth, async (req, reply) => {
    try {
      const workId = parseInt(req.query.work_id);
      if (!workId) return reply.code(400).send({ error: 'Укажите work_id' });

      const { rows } = await db.query(`
        SELECT f.*, e.fio as master_name, e.phone as master_phone,
               iss.fio as issued_by_name
        FROM field_master_funds f
        JOIN employees e ON e.id = f.master_employee_id
        LEFT JOIN employees iss ON iss.user_id = f.issued_by
        WHERE f.work_id = $1
        ORDER BY f.created_at DESC
      `, [workId]);

      return { funds: rows };
    } catch (err) {
      fastify.log.error('[field-funds] GET / error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /:id — fund details with expenses and returns
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/:id', crmAuth, async (req, reply) => {
    try {
      const fundId = parseInt(req.params.id);

      const { rows: fund } = await db.query(`
        SELECT f.*, e.fio as master_name, e.phone as master_phone
        FROM field_master_funds f
        JOIN employees e ON e.id = f.master_employee_id
        WHERE f.id = $1
      `, [fundId]);
      if (fund.length === 0) return reply.code(404).send({ error: 'Подотчёт не найден' });

      const { rows: expenses } = await db.query(`
        SELECT * FROM field_master_expenses WHERE fund_id = $1 ORDER BY expense_date DESC, created_at DESC
      `, [fundId]);

      const { rows: returns } = await db.query(`
        SELECT * FROM field_master_returns WHERE fund_id = $1 ORDER BY created_at DESC
      `, [fundId]);

      return { fund: fund[0], expenses, returns };
    } catch (err) {
      fastify.log.error('[field-funds] GET /:id error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // PUT /:id/close — close fund report (PM reconciliation)
  // ─────────────────────────────────────────────────────────────────────
  fastify.put('/:id/close', crmAuth, async (req, reply) => {
    try {
      const fundId = parseInt(req.params.id);
      const userId = req.user.id;

      const { rows: fund } = await db.query('SELECT * FROM field_master_funds WHERE id = $1', [fundId]);
      if (fund.length === 0) return reply.code(404).send({ error: 'Подотчёт не найден' });
      if (fund[0].status === 'closed') return reply.code(400).send({ error: 'Подотчёт уже закрыт' });

      await db.query(`
        UPDATE field_master_funds SET status = 'closed', closed_at = NOW(), closed_by = $1, updated_at = NOW()
        WHERE id = $2
      `, [userId, fundId]);

      return { ok: true };
    } catch (err) {
      fastify.log.error('[field-funds] PUT /:id/close error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ═════════════════════════════════════════════════════════════════════
  // FIELD ENDPOINTS (Master via Field PWA)
  // ═════════════════════════════════════════════════════════════════════

  // ─────────────────────────────────────────────────────────────────────
  // PUT /:id/confirm — master confirms funds receipt
  // ─────────────────────────────────────────────────────────────────────
  fastify.put('/:id/confirm', fieldAuth, async (req, reply) => {
    try {
      const fundId = parseInt(req.params.id);
      const empId = req.fieldEmployee.id;

      const { rows: fund } = await db.query(
        'SELECT * FROM field_master_funds WHERE id = $1 AND master_employee_id = $2',
        [fundId, empId]
      );
      if (fund.length === 0) return reply.code(404).send({ error: 'Подотчёт не найден' });
      if (fund[0].status !== 'issued') return reply.code(400).send({ error: 'Подотчёт уже подтверждён' });

      await db.query(`
        UPDATE field_master_funds SET status = 'confirmed', confirmed_at = NOW(), updated_at = NOW()
        WHERE id = $1
      `, [fundId]);

      return { ok: true, status: 'confirmed' };
    } catch (err) {
      fastify.log.error('[field-funds] PUT /:id/confirm error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /:id/expense — add expense with receipt photo (multipart)
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/:id/expense', fieldAuth, async (req, reply) => {
    try {
      const fundId = parseInt(req.params.id);
      const empId = req.fieldEmployee.id;

      // Verify fund belongs to master and is active
      const { rows: fund } = await db.query(
        'SELECT * FROM field_master_funds WHERE id = $1 AND master_employee_id = $2',
        [fundId, empId]
      );
      if (fund.length === 0) return reply.code(404).send({ error: 'Подотчёт не найден' });
      if (fund[0].status === 'closed') return reply.code(400).send({ error: 'Подотчёт закрыт' });

      // Parse multipart
      const parts = req.parts();
      let file = null;
      let amount = null;
      let description = null;
      let category = null;
      let supplier = null;
      let source = 'advance';
      let expenseDate = null;

      for await (const part of parts) {
        if (part.file) {
          const buffer = await part.toBuffer();
          if (buffer.length > MAX_RECEIPT_SIZE) {
            return reply.code(413).send({ error: 'Файл слишком большой (макс 15МБ)' });
          }
          file = { buffer, filename: part.filename, mimetype: part.mimetype };
        } else {
          switch (part.fieldname) {
            case 'amount': amount = parseFloat(part.value); break;
            case 'description': description = part.value; break;
            case 'category': category = part.value; break;
            case 'supplier': supplier = part.value; break;
            case 'source': source = part.value; break;
            case 'expense_date': expenseDate = part.value; break;
          }
        }
      }

      if (!amount || amount <= 0) return reply.code(400).send({ error: 'Укажите сумму > 0' });
      if (!description) return reply.code(400).send({ error: 'Укажите описание расхода' });

      // Save receipt file if provided
      let receiptFilename = null;
      let receiptOriginal = null;
      if (file) {
        const ext = path.extname(file.filename).toLowerCase() || '.jpg';
        const uploadDir = path.join(UPLOAD_BASE, 'receipts');
        await fs.promises.mkdir(uploadDir, { recursive: true });

        receiptFilename = `receipt_${crypto.randomBytes(16).toString('hex')}${ext}`;
        receiptOriginal = file.filename;
        await fs.promises.writeFile(path.join(uploadDir, receiptFilename), file.buffer);
      }

      // Determine source: advance or own
      const validSources = ['advance', 'own'];
      if (!validSources.includes(source)) source = 'advance';

      // Insert expense
      const { rows: inserted } = await db.query(`
        INSERT INTO field_master_expenses
          (fund_id, work_id, master_employee_id, amount, description, category, supplier,
           source, receipt_filename, receipt_original, expense_date)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::date, CURRENT_DATE))
        RETURNING *
      `, [fundId, fund[0].work_id, empId, amount, description, category || null,
          supplier || null, source, receiptFilename, receiptOriginal, expenseDate || null]);

      // Update fund totals
      if (source === 'advance') {
        await db.query(`
          UPDATE field_master_funds SET spent = spent + $1, updated_at = NOW() WHERE id = $2
        `, [amount, fundId]);
      } else {
        await db.query(`
          UPDATE field_master_funds SET own_spent = own_spent + $1, updated_at = NOW() WHERE id = $2
        `, [amount, fundId]);
      }

      // Auto-sync to work_expenses
      let workExpenseId = null;
      try {
        const { rows: we } = await db.query(`
          INSERT INTO work_expenses (work_id, employee_id, amount, description, category, source, receipt_url, created_at)
          VALUES ($1, $2, $3, $4, $5, 'field_master', $6, NOW())
          RETURNING id
        `, [fund[0].work_id, empId, amount, description, category || 'Полевые расходы',
            receiptFilename ? `/uploads/receipts/${receiptFilename}` : null]);
        workExpenseId = we[0].id;

        await db.query(`
          UPDATE field_master_expenses SET work_expense_id = $1, synced_at = NOW() WHERE id = $2
        `, [workExpenseId, inserted[0].id]);
      } catch (syncErr) {
        fastify.log.warn('[field-funds] work_expenses sync failed:', syncErr.message);
      }

      return { expense: inserted[0], work_expense_id: workExpenseId };
    } catch (err) {
      fastify.log.error('[field-funds] POST /:id/expense error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /:id/return — master returns remainder
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/:id/return', fieldAuth, async (req, reply) => {
    try {
      const fundId = parseInt(req.params.id);
      const empId = req.fieldEmployee.id;
      const { amount, note } = req.body || {};

      if (!amount || parseFloat(amount) <= 0) {
        return reply.code(400).send({ error: 'Укажите сумму возврата > 0' });
      }

      const { rows: fund } = await db.query(
        'SELECT * FROM field_master_funds WHERE id = $1 AND master_employee_id = $2',
        [fundId, empId]
      );
      if (fund.length === 0) return reply.code(404).send({ error: 'Подотчёт не найден' });
      if (fund[0].status === 'closed') return reply.code(400).send({ error: 'Подотчёт закрыт' });

      const remainder = parseFloat(fund[0].amount) - parseFloat(fund[0].spent) - parseFloat(fund[0].returned);
      if (parseFloat(amount) > remainder + 0.01) {
        return reply.code(400).send({ error: `Сумма возврата не может превышать остаток (${remainder.toFixed(2)} ₽)` });
      }

      const { rows: ret } = await db.query(`
        INSERT INTO field_master_returns (fund_id, amount, note)
        VALUES ($1, $2, $3)
        RETURNING *
      `, [fundId, amount, note || null]);

      await db.query(`
        UPDATE field_master_funds SET returned = returned + $1, updated_at = NOW() WHERE id = $2
      `, [amount, fundId]);

      return { return: ret[0] };
    } catch (err) {
      fastify.log.error('[field-funds] POST /:id/return error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /my/balance — master's balance for active project
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/my/balance', fieldAuth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;
      const workId = parseInt(req.query.work_id) || null;

      let query = `
        SELECT f.id, f.work_id, f.amount, f.spent, f.returned, f.own_spent, f.status, f.purpose,
               f.confirmed_at, f.created_at, w.work_title
        FROM field_master_funds f
        JOIN works w ON w.id = f.work_id
        WHERE f.master_employee_id = $1 AND f.status != 'closed'
      `;
      const params = [empId];

      if (workId) {
        query += ' AND f.work_id = $2';
        params.push(workId);
      }
      query += ' ORDER BY f.created_at DESC';

      const { rows } = await db.query(query, params);

      // Calculate totals
      let totalIssued = 0, totalSpent = 0, totalReturned = 0, totalOwnSpent = 0;
      for (const f of rows) {
        totalIssued += parseFloat(f.amount);
        totalSpent += parseFloat(f.spent);
        totalReturned += parseFloat(f.returned);
        totalOwnSpent += parseFloat(f.own_spent);
      }

      return {
        funds: rows,
        totals: {
          issued: totalIssued,
          spent: totalSpent,
          returned: totalReturned,
          own_spent: totalOwnSpent,
          remainder: totalIssued - totalSpent - totalReturned
        }
      };
    } catch (err) {
      fastify.log.error('[field-funds] GET /my/balance error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /my — master's funds list (Field auth)
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/my', fieldAuth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;

      const { rows } = await db.query(`
        SELECT f.*, w.work_title
        FROM field_master_funds f
        JOIN works w ON w.id = f.work_id
        WHERE f.master_employee_id = $1
        ORDER BY f.created_at DESC
        LIMIT 50
      `, [empId]);

      return { funds: rows };
    } catch (err) {
      fastify.log.error('[field-funds] GET /my error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });
}

module.exports = routes;
