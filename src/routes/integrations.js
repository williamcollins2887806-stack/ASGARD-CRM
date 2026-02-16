/**
 * ASGARD CRM — Integrations Routes
 * Модуль A: Банк/1С (#34)
 * Модуль B: Тендерные площадки (#64)
 * Модуль C: ERP-интеграции (#68)
 * Prefix: /api/integrations
 */

'use strict';

const crypto = require('crypto');
const db = require('../services/db');
const bankProcessor = require('../services/bank-processor');
const platformParser = require('../services/platform-parser');
const path = require('path');
const fs = require('fs');

const BANK_ROLES = ['ADMIN', 'BUH', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const PLATFORM_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_TO', 'TO'];
const ERP_ROLES = ['ADMIN', 'DIRECTOR_GEN'];

module.exports = async function (fastify) {

  // ═══════════════════════════════════════════════════════════════════════
  //  МОДУЛЬ A: БАНК / 1С
  // ═══════════════════════════════════════════════════════════════════════

  // ── GET /bank/batches ──────────────────────────────────────────────────
  fastify.get('/bank/batches', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { limit = 50, offset = 0 } = req.query;
    const res = await db.query(
      `SELECT b.*, u.name as imported_by_name
       FROM bank_import_batches b LEFT JOIN users u ON u.id = b.imported_by
       ORDER BY b.created_at DESC LIMIT $1 OFFSET $2`, [Math.min(+limit, 200), +offset]);
    const cnt = await db.query('SELECT COUNT(*) as total FROM bank_import_batches');
    return { success: true, items: res.rows, total: parseInt(cnt.rows[0]?.total || 0) };
  });

  // ── POST /bank/upload ─────────────────────────────────────────────────
  fastify.post('/bank/upload', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const user = req.user;
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'Файл не загружен' });

    const chunks = [];
    for await (const chunk of data.file) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    const filename = data.filename || 'statement.csv';

    // Парсинг
    const { format, rows } = bankProcessor.parseStatement(buffer, req.query.format || null);
    if (!rows.length) return reply.code(400).send({ error: 'Не удалось распознать данные', format });

    // Создаём batch
    const batchRes = await db.query(
      `INSERT INTO bank_import_batches (filename, source_format, total_rows, imported_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [filename, format, rows.length, user.id]);
    const batchId = batchRes.rows[0].id;

    // Загружаем правила
    const rulesRes = await db.query(
      'SELECT * FROM bank_classification_rules WHERE is_active = true ORDER BY priority DESC, usage_count DESC');
    const rules = rulesRes.rows;

    let newCount = 0, dupeCount = 0, autoClassified = 0;

    for (const row of rows) {
      // Проверяем дубликат
      if (row.import_hash) {
        const exists = await db.query('SELECT id FROM bank_transactions WHERE import_hash = $1', [row.import_hash]);
        if (exists.rows.length) { dupeCount++; continue; }
      }

      // Классификация
      let article = null, articleConfidence = 'none', category1c = null, workId = null;
      const cls = bankProcessor.classifyTransaction(row, rules);
      if (cls) {
        article = cls.article;
        articleConfidence = cls.confidence;
        category1c = cls.category_1c;
        workId = cls.work_id;
        autoClassified++;
        // Инкрементим usage_count
        if (cls.rule_id) {
          await db.query('UPDATE bank_classification_rules SET usage_count = usage_count + 1 WHERE id = $1', [cls.rule_id]);
        }
      }

      const status = article ? 'classified' : 'new';

      await db.query(`
        INSERT INTO bank_transactions (
          import_hash, batch_id, transaction_date, amount, direction, currency,
          counterparty_name, counterparty_inn, counterparty_kpp,
          counterparty_account, counterparty_bank_bik,
          our_account, our_bank_bik,
          payment_purpose, description, document_number, document_date,
          article, article_confidence, category_1c, work_id,
          status, source_format, source_filename, imported_by
        ) VALUES ($1,$2,$3,$4,$5,'RUB',$6,$7,$8,$9,$10,$11,NULL,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
      `, [
        row.import_hash, batchId, row.transaction_date, row.amount, row.direction,
        row.counterparty_name, row.counterparty_inn, row.counterparty_kpp,
        row.counterparty_account, row.counterparty_bank_bik,
        row.our_account,
        row.payment_purpose, row.payment_purpose?.slice(0, 100),
        row.document_number, row.document_date,
        article, articleConfidence, category1c, workId,
        status, format, filename, user.id
      ]);
      newCount++;
    }

    const manualNeeded = newCount - autoClassified;
    await db.query(
      `UPDATE bank_import_batches SET new_rows=$1, duplicate_rows=$2, auto_classified=$3, manual_needed=$4, status='completed' WHERE id=$5`,
      [newCount, dupeCount, autoClassified, manualNeeded, batchId]);

    return { success: true, batch_id: batchId, format, stats: { total: rows.length, new: newCount, duplicates: dupeCount, auto: autoClassified, manual: manualNeeded } };
  });

  // ── GET /bank/transactions ────────────────────────────────────────────
  fastify.get('/bank/transactions', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { batch_id, status, direction, article, date_from, date_to, search, sort = 'transaction_date', order = 'DESC', limit = 50, offset = 0 } = req.query;
    let where = 'WHERE 1=1'; const params = []; let idx = 1;

    if (batch_id) { where += ` AND t.batch_id = $${idx++}`; params.push(batch_id); }
    if (status) { where += ` AND t.status = $${idx++}`; params.push(status); }
    if (direction) { where += ` AND t.direction = $${idx++}`; params.push(direction); }
    if (article) { where += ` AND t.article = $${idx++}`; params.push(article); }
    if (date_from) { where += ` AND t.transaction_date >= $${idx++}`; params.push(date_from); }
    if (date_to) { where += ` AND t.transaction_date <= $${idx++}`; params.push(date_to); }
    if (search) { where += ` AND (t.counterparty_name ILIKE $${idx} OR t.payment_purpose ILIKE $${idx})`; params.push(`%${search}%`); idx++; }

    const allowed = ['transaction_date', 'amount', 'counterparty_name', 'article', 'status', 'created_at'];
    const sCol = allowed.includes(sort) ? sort : 'transaction_date';
    const sOrd = order === 'ASC' ? 'ASC' : 'DESC';

    const cnt = await db.query(`SELECT COUNT(*) as total FROM bank_transactions t ${where}`, params);
    const data = await db.query(`
      SELECT t.*, w.work_number, w.work_title
      FROM bank_transactions t
      LEFT JOIN works w ON w.id = t.work_id
      ${where} ORDER BY t.${sCol} ${sOrd} LIMIT $${idx++} OFFSET $${idx++}
    `, [...params, Math.min(+limit, 500), +offset]);

    return { success: true, items: data.rows, total: parseInt(cnt.rows[0]?.total || 0) };
  });

  // ── GET /bank/transactions/:id ────────────────────────────────────────
  fastify.get('/bank/transactions/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const res = await db.query(`
      SELECT t.*, w.work_number, w.work_title, b.filename as batch_filename
      FROM bank_transactions t
      LEFT JOIN works w ON w.id = t.work_id
      LEFT JOIN bank_import_batches b ON b.id = t.batch_id
      WHERE t.id = $1`, [req.params.id]);
    if (!res.rows.length) return reply.code(404).send({ error: 'Не найдена' });
    return { success: true, item: res.rows[0] };
  });

  // ── PUT /bank/transactions/:id ────────────────────────────────────────
  fastify.put('/bank/transactions/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { article, work_id, tender_id, category_1c, description } = req.body;
    const user = req.user;
    await db.query(`
      UPDATE bank_transactions SET
        article = COALESCE($1, article),
        work_id = $2,
        tender_id = $3,
        category_1c = COALESCE($4, category_1c),
        description = COALESCE($5, description),
        article_confidence = 'manual',
        status = 'confirmed',
        confirmed_by = $6, confirmed_at = NOW(), updated_at = NOW()
      WHERE id = $7`, [article, work_id || null, tender_id || null, category_1c, description, user.id, req.params.id]);
    return { success: true };
  });

  // ── POST /bank/transactions/bulk-classify ─────────────────────────────
  fastify.post('/bank/transactions/bulk-classify', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { ids, article, work_id } = req.body;
    if (!ids?.length || !article) return reply.code(400).send({ error: 'ids и article обязательны' });
    const user = req.user;
    const res = await db.query(`
      UPDATE bank_transactions SET article = $1, work_id = $2, article_confidence = 'manual',
        status = 'confirmed', confirmed_by = $3, confirmed_at = NOW(), updated_at = NOW()
      WHERE id = ANY($4) AND status IN ('new', 'classified')`, [article, work_id || null, user.id, ids]);
    return { success: true, updated: res.rowCount };
  });

  // ── POST /bank/transactions/:id/distribute ────────────────────────────
  fastify.post('/bank/transactions/:id/distribute', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const txRes = await db.query('SELECT * FROM bank_transactions WHERE id = $1', [req.params.id]);
    if (!txRes.rows.length) return reply.code(404).send({ error: 'Не найдена' });
    const tx = txRes.rows[0];

    if (!['classified', 'confirmed'].includes(tx.status)) return reply.code(400).send({ error: 'Статус не позволяет разноску' });
    if (!tx.article) return reply.code(400).send({ error: 'Не указана статья' });

    let linkedId = null;
    if (tx.direction === 'income') {
      const ins = await db.query(`
        INSERT INTO incomes (work_id, type, date, amount, description, created_at)
        VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING id`,
        [tx.work_id, tx.article, tx.transaction_date, tx.amount, tx.payment_purpose || 'Банковский импорт']);
      linkedId = ins.rows[0].id;
      await db.query('UPDATE bank_transactions SET status = $1, linked_income_id = $2, updated_at = NOW() WHERE id = $3', ['distributed', linkedId, tx.id]);
    } else {
      if (tx.work_id) {
        const ins = await db.query(`
          INSERT INTO work_expenses (work_id, category, amount, date, comment, created_at)
          VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING id`,
          [tx.work_id, tx.article, tx.amount, tx.transaction_date, tx.payment_purpose]);
        linkedId = ins.rows[0].id;
      } else {
        const ins = await db.query(`
          INSERT INTO office_expenses (category, amount, date, description, status, created_at)
          VALUES ($1,$2,$3,$4,'approved',NOW()) RETURNING id`,
          [tx.article, tx.amount, tx.transaction_date, tx.payment_purpose]);
        linkedId = ins.rows[0].id;
      }
      await db.query('UPDATE bank_transactions SET status = $1, linked_expense_id = $2, updated_at = NOW() WHERE id = $3', ['distributed', linkedId, tx.id]);
    }
    return { success: true, linked_id: linkedId };
  });

  // ── POST /bank/transactions/bulk-distribute ───────────────────────────
  fastify.post('/bank/transactions/bulk-distribute', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { ids } = req.body;
    if (!ids?.length) return reply.code(400).send({ error: 'ids обязательны' });

    let success = 0, failed = 0;
    for (const id of ids) {
      try {
        const txRes = await db.query('SELECT * FROM bank_transactions WHERE id = $1 AND status IN ($2,$3) AND article IS NOT NULL', [id, 'classified', 'confirmed']);
        if (!txRes.rows.length) { failed++; continue; }
        const tx = txRes.rows[0];

        if (tx.direction === 'income') {
          const ins = await db.query(`INSERT INTO incomes (work_id, type, date, amount, description, created_at) VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING id`,
            [tx.work_id, tx.article, tx.transaction_date, tx.amount, tx.payment_purpose || 'Банковский импорт']);
          await db.query('UPDATE bank_transactions SET status=$1, linked_income_id=$2, updated_at=NOW() WHERE id=$3', ['distributed', ins.rows[0].id, id]);
        } else {
          if (tx.work_id) {
            const ins = await db.query(`INSERT INTO work_expenses (work_id, category, amount, date, comment, created_at) VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING id`,
              [tx.work_id, tx.article, tx.amount, tx.transaction_date, tx.payment_purpose]);
            await db.query('UPDATE bank_transactions SET status=$1, linked_expense_id=$2, updated_at=NOW() WHERE id=$3', ['distributed', ins.rows[0].id, id]);
          } else {
            const ins = await db.query(`INSERT INTO office_expenses (category, amount, date, description, status, created_at) VALUES ($1,$2,$3,$4,'approved',NOW()) RETURNING id`,
              [tx.article, tx.amount, tx.transaction_date, tx.payment_purpose]);
            await db.query('UPDATE bank_transactions SET status=$1, linked_expense_id=$2, updated_at=NOW() WHERE id=$3', ['distributed', ins.rows[0].id, id]);
          }
        }
        success++;
      } catch (_) { failed++; }
    }
    return { success: true, distributed: success, failed };
  });

  // ── GET /bank/rules ───────────────────────────────────────────────────
  fastify.get('/bank/rules', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { direction, search } = req.query;
    let where = 'WHERE 1=1'; const params = []; let idx = 1;
    if (direction) { where += ` AND (direction = $${idx++} OR direction IS NULL)`; params.push(direction); }
    if (search) { where += ` AND pattern ILIKE $${idx++}`; params.push(`%${search}%`); }
    const res = await db.query(`SELECT * FROM bank_classification_rules ${where} ORDER BY priority DESC, usage_count DESC`, params);
    return { success: true, items: res.rows };
  });

  // ── POST /bank/rules ──────────────────────────────────────────────────
  fastify.post('/bank/rules', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { pattern, match_field, direction, article, category_1c, work_id, priority } = req.body;
    if (!pattern || !article) return reply.code(400).send({ error: 'pattern и article обязательны' });
    const res = await db.query(`
      INSERT INTO bank_classification_rules (pattern, match_field, direction, article, category_1c, work_id, priority, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [pattern.toLowerCase(), match_field || 'all', direction || null, article, category_1c || null, work_id || null, priority || 0, req.user.id]);
    return { success: true, id: res.rows[0].id };
  });

  // ── PUT /bank/rules/:id ───────────────────────────────────────────────
  fastify.put('/bank/rules/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { pattern, match_field, direction, article, category_1c, work_id, priority, is_active } = req.body;
    await db.query(`UPDATE bank_classification_rules SET
      pattern=COALESCE($1,pattern), match_field=COALESCE($2,match_field), direction=$3,
      article=COALESCE($4,article), category_1c=$5, work_id=$6, priority=COALESCE($7,priority), is_active=COALESCE($8,is_active)
      WHERE id=$9`, [pattern?.toLowerCase(), match_field, direction, article, category_1c, work_id, priority, is_active, req.params.id]);
    return { success: true };
  });

  // ── DELETE /bank/rules/:id ────────────────────────────────────────────
  fastify.delete('/bank/rules/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    await db.query('DELETE FROM bank_classification_rules WHERE id = $1 AND is_system = false', [req.params.id]);
    return { success: true };
  });

  // ── GET /bank/export/1c ───────────────────────────────────────────────
  fastify.get('/bank/export/1c', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { date_from, date_to, status = 'distributed' } = req.query;
    let where = 'WHERE status = $1'; const params = [status]; let idx = 2;
    if (date_from) { where += ` AND transaction_date >= $${idx++}`; params.push(date_from); }
    if (date_to) { where += ` AND transaction_date <= $${idx++}`; params.push(date_to); }

    const res = await db.query(`SELECT * FROM bank_transactions ${where} ORDER BY transaction_date`, params);
    if (!res.rows.length) return reply.code(404).send({ error: 'Нет транзакций для экспорта' });

    const ourAccount = res.rows[0].our_account || '';
    const buf = bankProcessor.generate1CExport(res.rows, date_from || res.rows[0].transaction_date, date_to || res.rows[res.rows.length - 1].transaction_date, ourAccount);

    // Помечаем экспортированные
    const ids = res.rows.map(r => r.id);
    await db.query('UPDATE bank_transactions SET status = $1, updated_at = NOW() WHERE id = ANY($2)', ['exported_1c', ids]);

    reply.header('Content-Type', 'text/plain; charset=windows-1251');
    reply.header('Content-Disposition', `attachment; filename="bank_export_1c_${new Date().toISOString().slice(0,10)}.txt"`);
    return reply.send(buf);
  });

  // ── GET /bank/export/excel ────────────────────────────────────────────
  fastify.get('/bank/export/excel', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { date_from, date_to, article, direction } = req.query;
    let where = 'WHERE 1=1'; const params = []; let idx = 1;
    if (date_from) { where += ` AND transaction_date >= $${idx++}`; params.push(date_from); }
    if (date_to) { where += ` AND transaction_date <= $${idx++}`; params.push(date_to); }
    if (article) { where += ` AND article = $${idx++}`; params.push(article); }
    if (direction) { where += ` AND direction = $${idx++}`; params.push(direction); }

    const res = await db.query(`SELECT * FROM bank_transactions ${where} ORDER BY transaction_date`, params);
    // Return JSON data for client-side SheetJS rendering
    return { success: true, items: res.rows, total: res.rows.length };
  });

  // ── GET /bank/stats ───────────────────────────────────────────────────
  fastify.get('/bank/stats', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const [income, expense, unclass, byArticle, byMonth, lastImport] = await Promise.all([
      db.query("SELECT COALESCE(SUM(amount),0) as total FROM bank_transactions WHERE direction='income' AND status != 'skipped'"),
      db.query("SELECT COALESCE(SUM(amount),0) as total FROM bank_transactions WHERE direction='expense' AND status != 'skipped'"),
      db.query("SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as total FROM bank_transactions WHERE status = 'new'"),
      db.query("SELECT article, COALESCE(SUM(amount),0) as total, COUNT(*) as cnt FROM bank_transactions WHERE article IS NOT NULL GROUP BY article ORDER BY total DESC"),
      db.query(`SELECT to_char(transaction_date,'YYYY-MM') as month,
        COALESCE(SUM(CASE WHEN direction='income' THEN amount ELSE 0 END),0) as income,
        COALESCE(SUM(CASE WHEN direction='expense' THEN amount ELSE 0 END),0) as expense
        FROM bank_transactions WHERE transaction_date > NOW() - INTERVAL '12 months' GROUP BY month ORDER BY month DESC`),
      db.query('SELECT MAX(created_at) as last_date FROM bank_import_batches')
    ]);

    return {
      success: true,
      total_income: parseFloat(income.rows[0]?.total || 0),
      total_expense: parseFloat(expense.rows[0]?.total || 0),
      balance: parseFloat(income.rows[0]?.total || 0) - parseFloat(expense.rows[0]?.total || 0),
      unclassified_count: parseInt(unclass.rows[0]?.cnt || 0),
      unclassified_amount: parseFloat(unclass.rows[0]?.total || 0),
      by_article: byArticle.rows,
      by_month: byMonth.rows,
      last_import_date: lastImport.rows[0]?.last_date || null
    };
  });

  // ── POST /bank/sync-from-client ───────────────────────────────────────
  fastify.post('/bank/sync-from-client', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { transactions } = req.body;
    if (!transactions?.length) return reply.code(400).send({ error: 'Нет транзакций' });

    let synced = 0;
    for (const tx of transactions) {
      const hash = tx.import_hash || tx.hash;
      if (!hash) continue;
      const exists = await db.query('SELECT id FROM bank_transactions WHERE import_hash = $1', [hash]);
      if (exists.rows.length) continue;

      await db.query(`
        INSERT INTO bank_transactions (import_hash, transaction_date, amount, direction,
          counterparty_name, payment_purpose, article, article_confidence, status, source_format, imported_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'client_sync',$10)
        ON CONFLICT (import_hash) DO NOTHING`,
        [hash, tx.date, Math.abs(tx.amount), tx.amount >= 0 ? 'income' : 'expense',
         tx.counterparty || '', tx.description || '', tx.article || null,
         tx.article ? 'medium' : 'none', tx.article ? 'classified' : 'new', req.user.id]);
      synced++;
    }
    return { success: true, synced };
  });


  // ═══════════════════════════════════════════════════════════════════════
  //  МОДУЛЬ B: ТЕНДЕРНЫЕ ПЛОЩАДКИ
  // ═══════════════════════════════════════════════════════════════════════

  // ── GET /platforms ────────────────────────────────────────────────────
  fastify.get('/platforms', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { platform_code, parse_status, date_from, date_to, search, limit = 50, offset = 0 } = req.query;
    let where = 'WHERE 1=1'; const params = []; let idx = 1;

    if (platform_code) { where += ` AND p.platform_code = $${idx++}`; params.push(platform_code); }
    if (parse_status) { where += ` AND p.parse_status = $${idx++}`; params.push(parse_status); }
    if (date_from) { where += ` AND p.created_at >= $${idx++}`; params.push(date_from); }
    if (date_to) { where += ` AND p.created_at <= $${idx++}`; params.push(date_to); }
    if (search) { where += ` AND (p.customer_name ILIKE $${idx} OR p.object_description ILIKE $${idx} OR p.purchase_number ILIKE $${idx})`; params.push(`%${search}%`); idx++; }

    const cnt = await db.query(`SELECT COUNT(*) as total FROM platform_parse_results p ${where}`, params);
    const data = await db.query(`
      SELECT p.*, e.subject as email_subject, e.from_email, e.email_date,
        pt.status as pre_tender_status
      FROM platform_parse_results p
      LEFT JOIN emails e ON e.id = p.email_id
      LEFT JOIN pre_tender_requests pt ON pt.id = p.pre_tender_id
      ${where} ORDER BY p.created_at DESC LIMIT $${idx++} OFFSET $${idx++}
    `, [...params, Math.min(+limit, 200), +offset]);

    return { success: true, items: data.rows, total: parseInt(cnt.rows[0]?.total || 0) };
  });

  // ── GET /platforms/:id ────────────────────────────────────────────────
  fastify.get('/platforms/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const res = await db.query(`
      SELECT p.*, e.subject as email_subject, e.body_text as email_body_text,
        e.from_email, e.from_name, e.email_date, e.has_attachments,
        pt.status as pre_tender_status
      FROM platform_parse_results p
      LEFT JOIN emails e ON e.id = p.email_id
      LEFT JOIN pre_tender_requests pt ON pt.id = p.pre_tender_id
      WHERE p.id = $1`, [req.params.id]);
    if (!res.rows.length) return reply.code(404).send({ error: 'Не найдена' });

    let attachments = [];
    if (res.rows[0].email_id) {
      const attRes = await db.query('SELECT id, filename, original_filename, mime_type, size FROM email_attachments WHERE email_id = $1', [res.rows[0].email_id]);
      attachments = attRes.rows;
    }
    return { success: true, item: res.rows[0], attachments };
  });

  // ── POST /platforms/parse-email ───────────────────────────────────────
  fastify.post('/platforms/parse-email', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { email_id } = req.body;
    if (!email_id) return reply.code(400).send({ error: 'email_id обязателен' });

    try {
      const result = await platformParser.parseAndSave(email_id);
      return { success: true, ...result };
    } catch (e) {
      return reply.code(500).send({ error: 'Ошибка парсинга: ' + e.message });
    }
  });

  // ── POST /platforms/parse-batch ───────────────────────────────────────
  fastify.post('/platforms/parse-batch', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { limit = 50 } = req.body || {};

    const emails = await db.query(`
      SELECT id FROM emails
      WHERE email_type = 'platform_tender'
        AND id NOT IN (SELECT email_id FROM platform_parse_results WHERE email_id IS NOT NULL)
      ORDER BY email_date DESC LIMIT $1`, [Math.min(+limit, 200)]);

    let processed = 0, success = 0, failed = 0;
    for (const row of emails.rows) {
      processed++;
      try {
        await platformParser.parseAndSave(row.id);
        success++;
      } catch (e) {
        failed++;
        console.error('[Platforms] Batch parse error email #' + row.id + ':', e.message);
      }
    }
    return { success: true, processed, success_count: success, failed };
  });

  // ── POST /platforms/:id/download-docs ─────────────────────────────────
  fastify.post('/platforms/:id/download-docs', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const res = await db.query('SELECT * FROM platform_parse_results WHERE id = $1', [req.params.id]);
    if (!res.rows.length) return reply.code(404).send({ error: 'Не найдена' });
    const item = res.rows[0];

    // На данном этапе реальное скачивание не реализовано
    await db.query(`UPDATE platform_parse_results SET
      docs_download_error = 'Требуется авторизация на площадке. Загрузите документы вручную.',
      parse_status = CASE WHEN parse_status = 'parsed' THEN 'completed' ELSE parse_status END,
      updated_at = NOW() WHERE id = $1`, [req.params.id]);

    return { success: true, message: 'Автоматическое скачивание документов недоступно. Загрузите вручную.' };
  });

  // ── PUT /platforms/:id ────────────────────────────────────────────────
  fastify.put('/platforms/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const allowed = ['purchase_number', 'purchase_url', 'lot_number', 'purchase_method',
      'customer_name', 'customer_inn', 'object_description', 'nmck',
      'application_deadline', 'auction_date', 'work_start_date', 'work_end_date'];
    const fields = []; const vals = []; let idx = 1;
    for (const key of allowed) {
      if (req.body[key] !== undefined) { fields.push(`${key} = $${idx++}`); vals.push(req.body[key]); }
    }
    if (!fields.length) return reply.code(400).send({ error: 'Нет полей для обновления' });
    fields.push('updated_at = NOW()');
    if (req.body.parse_status === 'manual') { fields.push(`parse_status = 'manual'`); }
    vals.push(req.params.id);
    await db.query(`UPDATE platform_parse_results SET ${fields.join(', ')} WHERE id = $${idx}`, vals);
    return { success: true };
  });

  // ── POST /platforms/:id/create-pre-tender ─────────────────────────────
  fastify.post('/platforms/:id/create-pre-tender', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const res = await db.query('SELECT * FROM platform_parse_results WHERE id = $1', [req.params.id]);
    if (!res.rows.length) return reply.code(404).send({ error: 'Не найдена' });
    const p = res.rows[0];

    // Проверяем нет ли уже заявки
    if (p.pre_tender_id) return reply.code(409).send({ error: 'Заявка уже создана', pre_tender_id: p.pre_tender_id });
    if (p.email_id) {
      const ex = await db.query('SELECT id FROM pre_tender_requests WHERE email_id = $1', [p.email_id]);
      if (ex.rows.length) {
        await db.query('UPDATE platform_parse_results SET pre_tender_id = $1 WHERE id = $2', [ex.rows[0].id, p.id]);
        return { success: true, pre_tender_id: ex.rows[0].id, exists: true };
      }
    }

    const ins = await db.query(`
      INSERT INTO pre_tender_requests (
        email_id, source_type, customer_name, customer_inn,
        work_description, estimated_sum, ai_summary, ai_color,
        ai_recommendation, ai_work_match_score, status, created_by
      ) VALUES ($1, 'platform', $2, $3, $4, $5, $6, $7, $8, $9, 'new', $10)
      RETURNING id`,
      [p.email_id, p.customer_name, p.customer_inn,
       p.object_description, p.nmck,
       p.ai_analysis, p.ai_relevance_score >= 70 ? 'green' : p.ai_relevance_score >= 40 ? 'yellow' : 'red',
       p.ai_analysis, p.ai_relevance_score,
       req.user.id]);

    await db.query('UPDATE platform_parse_results SET pre_tender_id = $1 WHERE id = $2', [ins.rows[0].id, p.id]);
    return { success: true, pre_tender_id: ins.rows[0].id };
  });

  // ── GET /platforms/stats ──────────────────────────────────────────────
  fastify.get('/platforms/stats', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const [total, byPlatform, byMonth, deadlines] = await Promise.all([
      db.query('SELECT COUNT(*) as cnt FROM platform_parse_results'),
      db.query(`SELECT platform_code, platform_name, COUNT(*) as cnt,
        COALESCE(AVG(nmck),0) as avg_nmck FROM platform_parse_results
        GROUP BY platform_code, platform_name ORDER BY cnt DESC`),
      db.query(`SELECT to_char(created_at,'YYYY-MM') as month, COUNT(*) as cnt
        FROM platform_parse_results WHERE created_at > NOW() - INTERVAL '6 months'
        GROUP BY month ORDER BY month DESC`),
      db.query(`SELECT id, purchase_number, customer_name, application_deadline, nmck, platform_name
        FROM platform_parse_results
        WHERE application_deadline > NOW() AND application_deadline < NOW() + INTERVAL '7 days'
        ORDER BY application_deadline LIMIT 10`)
    ]);
    return {
      success: true,
      total: parseInt(total.rows[0]?.cnt || 0),
      by_platform: byPlatform.rows,
      by_month: byMonth.rows,
      upcoming_deadlines: deadlines.rows
    };
  });


  // ═══════════════════════════════════════════════════════════════════════
  //  МОДУЛЬ C: ERP-ИНТЕГРАЦИИ
  // ═══════════════════════════════════════════════════════════════════════

  // ── GET /erp/connections ──────────────────────────────────────────────
  fastify.get('/erp/connections', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const res = await db.query('SELECT id, name, erp_type, connection_url, auth_type, is_active, sync_direction, last_sync_at, last_sync_status, last_sync_error, sync_interval_minutes, created_at FROM erp_connections ORDER BY created_at DESC');
    return { success: true, items: res.rows };
  });

  // ── POST /erp/connections ─────────────────────────────────────────────
  fastify.post('/erp/connections', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { name, erp_type, connection_url, auth_type, auth_credentials, sync_direction, sync_interval_minutes } = req.body;
    if (!name || !erp_type) return reply.code(400).send({ error: 'name и erp_type обязательны' });

    let encCreds = null;
    if (auth_credentials) {
      try { const imap = require('../services/imap'); encCreds = imap.encrypt(JSON.stringify(auth_credentials)); } catch (_) { encCreds = auth_credentials; }
    }

    const res = await db.query(`
      INSERT INTO erp_connections (name, erp_type, connection_url, auth_type, auth_credentials_encrypted, sync_direction, sync_interval_minutes, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [name, erp_type, connection_url || null, auth_type || 'basic', encCreds, sync_direction || 'both', sync_interval_minutes || 60, req.user.id]);
    return { success: true, id: res.rows[0].id };
  });

  // ── PUT /erp/connections/:id ──────────────────────────────────────────
  fastify.put('/erp/connections/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { name, connection_url, auth_type, auth_credentials, sync_direction, sync_interval_minutes, is_active } = req.body;
    let encCreds = undefined;
    if (auth_credentials !== undefined) {
      try { const imap = require('../services/imap'); encCreds = imap.encrypt(JSON.stringify(auth_credentials)); } catch (_) { encCreds = auth_credentials; }
    }

    await db.query(`UPDATE erp_connections SET
      name = COALESCE($1, name), connection_url = COALESCE($2, connection_url),
      auth_type = COALESCE($3, auth_type),
      auth_credentials_encrypted = COALESCE($4, auth_credentials_encrypted),
      sync_direction = COALESCE($5, sync_direction),
      sync_interval_minutes = COALESCE($6, sync_interval_minutes),
      is_active = COALESCE($7, is_active), updated_at = NOW()
      WHERE id = $8`,
      [name, connection_url, auth_type, encCreds, sync_direction, sync_interval_minutes, is_active, req.params.id]);
    return { success: true };
  });

  // ── DELETE /erp/connections/:id ───────────────────────────────────────
  fastify.delete('/erp/connections/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    await db.query('UPDATE erp_connections SET is_active = false, updated_at = NOW() WHERE id = $1', [req.params.id]);
    return { success: true };
  });

  // ── POST /erp/connections/:id/test ────────────────────────────────────
  fastify.post('/erp/connections/:id/test', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const res = await db.query('SELECT * FROM erp_connections WHERE id = $1', [req.params.id]);
    if (!res.rows.length) return reply.code(404).send({ error: 'Не найдена' });
    const conn = res.rows[0];

    if (!conn.connection_url) {
      return { success: true, status: 'ok', message: 'Подключение настроено (URL не указан — ручной режим)' };
    }

    try {
      const resp = await fetch(conn.connection_url, { method: 'GET', signal: AbortSignal.timeout(10000) });
      const ok = resp.ok;
      await db.query('UPDATE erp_connections SET last_sync_status = $1, last_sync_error = $2 WHERE id = $3',
        [ok ? 'ok' : 'error', ok ? null : 'HTTP ' + resp.status, conn.id]);
      return { success: true, status: ok ? 'ok' : 'error', http_status: resp.status };
    } catch (e) {
      await db.query('UPDATE erp_connections SET last_sync_status = $1, last_sync_error = $2 WHERE id = $3',
        ['error', e.message, conn.id]);
      return { success: false, error: e.message };
    }
  });

  // ── GET /erp/connections/:id/mappings ─────────────────────────────────
  fastify.get('/erp/connections/:id/mappings', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { entity_type } = req.query;
    let where = 'WHERE connection_id = $1'; const params = [req.params.id];
    if (entity_type) { where += ' AND entity_type = $2'; params.push(entity_type); }
    const res = await db.query(`SELECT * FROM erp_field_mappings ${where} ORDER BY entity_type, id`, params);
    return { success: true, items: res.rows };
  });

  // ── POST /erp/connections/:id/mappings ────────────────────────────────
  fastify.post('/erp/connections/:id/mappings', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { entity_type, crm_field, erp_field, transform_rule, is_required } = req.body;
    if (!entity_type || !crm_field || !erp_field) return reply.code(400).send({ error: 'entity_type, crm_field, erp_field обязательны' });
    const res = await db.query(`
      INSERT INTO erp_field_mappings (connection_id, entity_type, crm_field, erp_field, transform_rule, is_required)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [req.params.id, entity_type, crm_field, erp_field, transform_rule || 'direct', is_required || false]);
    return { success: true, id: res.rows[0].id };
  });

  // ── DELETE /erp/connections/:id/mappings/:mid ─────────────────────────
  fastify.delete('/erp/connections/:id/mappings/:mid', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    await db.query('DELETE FROM erp_field_mappings WHERE id = $1 AND connection_id = $2', [req.params.mid, req.params.id]);
    return { success: true };
  });

  // ── POST /erp/connections/:id/export ──────────────────────────────────
  fastify.post('/erp/connections/:id/export', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { entity_type, date_from, date_to } = req.body;
    if (!entity_type) return reply.code(400).send({ error: 'entity_type обязателен' });

    const connRes = await db.query('SELECT * FROM erp_connections WHERE id = $1', [req.params.id]);
    if (!connRes.rows.length) return reply.code(404).send({ error: 'Подключение не найдено' });
    const conn = connRes.rows[0];

    // Создаём лог
    const logRes = await db.query(`INSERT INTO erp_sync_log (connection_id, direction, entity_type, initiated_by) VALUES ($1,'export',$2,$3) RETURNING id`,
      [conn.id, entity_type, req.user.id]);
    const logId = logRes.rows[0].id;

    try {
      let data = [];
      let total = 0;

      if (entity_type === 'payroll') {
        let where = '1=1'; const params = [];
        if (date_from) { where += ' AND ps.period_start >= $' + (params.length + 1); params.push(date_from); }
        if (date_to) { where += ' AND ps.period_end <= $' + (params.length + 1); params.push(date_to); }
        const res = await db.query(`
          SELECT ps.*, pi.employee_id, pi.days_worked, pi.day_rate, pi.bonus,
            pi.overtime_hours, pi.overtime_rate, pi.penalty, pi.advance_paid, pi.deductions, pi.accrued, pi.payout,
            e.fio as employee_name, e.tab_number
          FROM payroll_sheets ps
          JOIN payroll_items pi ON pi.sheet_id = ps.id
          LEFT JOIN employees e ON e.id = pi.employee_id
          WHERE ${where} ORDER BY ps.period_start, e.fio`, params);
        data = res.rows;
        total = data.length;

        // Форматируем для 1С ЗУП
        if (conn.erp_type === '1c') {
          const grouped = {};
          for (const row of data) {
            const key = row.period_start;
            if (!grouped[key]) grouped[key] = { period: row.period_start, employees: [] };
            grouped[key].employees.push({
              fio: row.employee_name, tab_number: row.tab_number || '',
              days_worked: row.days_worked, day_rate: parseFloat(row.day_rate || 0),
              bonus: parseFloat(row.bonus || 0), penalty: parseFloat(row.penalty || 0),
              advance_paid: parseFloat(row.advance_paid || 0), payout: parseFloat(row.payout || 0)
            });
          }
          data = Object.values(grouped).map(g => ({
            document: 'НачислениеЗарплаты', period: g.period, organization: 'ООО Асгард Сервис', employees: g.employees
          }));
        }

      } else if (entity_type === 'bank') {
        let where = "status = 'distributed'"; const params = [];
        if (date_from) { where += ' AND transaction_date >= $' + (params.length + 1); params.push(date_from); }
        if (date_to) { where += ' AND transaction_date <= $' + (params.length + 1); params.push(date_to); }
        const res = await db.query(`SELECT * FROM bank_transactions WHERE ${where} ORDER BY transaction_date`, params);
        data = res.rows;
        total = data.length;

      } else if (entity_type === 'tenders') {
        let where = '1=1'; const params = [];
        if (date_from) { where += ' AND created_at >= $' + (params.length + 1); params.push(date_from); }
        if (date_to) { where += ' AND created_at <= $' + (params.length + 1); params.push(date_to); }
        const res = await db.query(`SELECT * FROM tenders WHERE ${where} ORDER BY created_at`, params);
        data = res.rows;
        total = data.length;
      }

      await db.query(`UPDATE erp_sync_log SET records_total=$1, records_success=$2, status='completed', completed_at=NOW() WHERE id=$3`,
        [total, total, logId]);
      await db.query('UPDATE erp_connections SET last_sync_at=NOW(), last_sync_status=$1 WHERE id=$2', ['ok', conn.id]);

      return { success: true, entity_type, records: total, data };

    } catch (e) {
      await db.query(`UPDATE erp_sync_log SET status='failed', error_details=$1, completed_at=NOW() WHERE id=$2`,
        [JSON.stringify([{ error: e.message }]), logId]);
      return reply.code(500).send({ error: e.message });
    }
  });

  // ── POST /erp/connections/:id/import ──────────────────────────────────
  fastify.post('/erp/connections/:id/import', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { entity_type, data: importData } = req.body;
    if (!entity_type || !importData?.length) return reply.code(400).send({ error: 'entity_type и data обязательны' });

    const logRes = await db.query(`INSERT INTO erp_sync_log (connection_id, direction, entity_type, records_total, initiated_by) VALUES ($1,'import',$2,$3,$4) RETURNING id`,
      [req.params.id, entity_type, importData.length, req.user.id]);
    const logId = logRes.rows[0].id;

    let success = 0, failed = 0; const errors = [];

    for (const row of importData) {
      try {
        if (entity_type === 'counterparties') {
          await db.query(`INSERT INTO customers (name, inn, kpp, address, phone, email, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT DO NOTHING`,
            [row.name || row.Наименование, row.inn || row.ИНН, row.kpp || row.КПП,
             row.address || row.Адрес || '', row.phone || row.Телефон || '', row.email || row.Email || '']);
          success++;
        } else if (entity_type === 'bank_statement') {
          // Обрабатываем через bank-processor
          const hash = bankProcessor.generateHash({ date: row.date, amount: row.amount, counterparty: row.counterparty || '', description: row.description || '' });
          const exists = await db.query('SELECT id FROM bank_transactions WHERE import_hash = $1', [hash]);
          if (exists.rows.length) { success++; continue; }
          await db.query(`INSERT INTO bank_transactions (import_hash, transaction_date, amount, direction, counterparty_name, payment_purpose, source_format, imported_by)
            VALUES ($1,$2,$3,$4,$5,$6,'erp_import',$7)`,
            [hash, row.date, Math.abs(row.amount), row.amount >= 0 ? 'income' : 'expense', row.counterparty || '', row.description || '', req.user.id]);
          success++;
        }
      } catch (e) { failed++; errors.push({ row_index: importData.indexOf(row), error: e.message }); }
    }

    await db.query(`UPDATE erp_sync_log SET records_success=$1, records_failed=$2, error_details=$3, status=$4, completed_at=NOW() WHERE id=$5`,
      [success, failed, JSON.stringify(errors), failed > 0 ? 'completed' : 'completed', logId]);

    return { success: true, imported: success, failed, errors: errors.slice(0, 10) };
  });

  // ── GET /erp/sync-log ────────────────────────────────────────────────
  fastify.get('/erp/sync-log', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { connection_id, entity_type, limit = 50, offset = 0 } = req.query;
    let where = 'WHERE 1=1'; const params = []; let idx = 1;
    if (connection_id) { where += ` AND l.connection_id = $${idx++}`; params.push(connection_id); }
    if (entity_type) { where += ` AND l.entity_type = $${idx++}`; params.push(entity_type); }

    const res = await db.query(`
      SELECT l.*, c.name as connection_name, u.name as initiated_by_name
      FROM erp_sync_log l
      LEFT JOIN erp_connections c ON c.id = l.connection_id
      LEFT JOIN users u ON u.id = l.initiated_by
      ${where} ORDER BY l.started_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, Math.min(+limit, 200), +offset]);
    return { success: true, items: res.rows };
  });

  // ── GET /erp/sync-log/:id ────────────────────────────────────────────
  fastify.get('/erp/sync-log/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const res = await db.query(`
      SELECT l.*, c.name as connection_name FROM erp_sync_log l
      LEFT JOIN erp_connections c ON c.id = l.connection_id WHERE l.id = $1`, [req.params.id]);
    if (!res.rows.length) return reply.code(404).send({ error: 'Не найдена' });
    return { success: true, item: res.rows[0] };
  });

  // ── POST /erp/webhook/:connection_id ─────────────────────────────────
  fastify.post('/erp/webhook/:connection_id', {
    config: { rawBody: true }
  }, async (req, reply) => {
    const connRes = await db.query('SELECT * FROM erp_connections WHERE id = $1 AND is_active = true', [req.params.connection_id]);
    if (!connRes.rows.length) return reply.code(404).send({ error: 'Подключение не найдено' });

    const conn = connRes.rows[0];

    // SECURITY: HMAC-SHA256 signature validation
    if (conn.webhook_secret) {
      const signature = req.headers['x-webhook-signature'] || '';
      if (!signature) {
        return reply.code(401).send({ error: 'Missing X-Webhook-Signature header' });
      }
      const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      const expected = crypto.createHmac('sha256', conn.webhook_secret).update(rawBody).digest('hex');
      const sigHex = signature.replace(/^sha256=/, '');
      if (sigHex.length !== expected.length ||
          !crypto.timingSafeEqual(Buffer.from(sigHex, 'hex'), Buffer.from(expected, 'hex'))) {
        return reply.code(401).send({ error: 'Invalid webhook signature' });
      }
    } else {
      // SECURITY B6: No webhook_secret configured — reject until configured
      fastify.log.warn(`Webhook ${req.params.connection_id}: no webhook_secret configured, rejecting`);
      return reply.code(403).send({ error: 'Webhook secret не настроен. Добавьте webhook_secret в настройки подключения.' });
    }

    const { entity_type, action, data } = req.body;
    if (!entity_type || !data) return reply.code(400).send({ error: 'entity_type и data обязательны' });

    const logRes = await db.query(`INSERT INTO erp_sync_log (connection_id, direction, entity_type, records_total, status) VALUES ($1,'import',$2,1,'running') RETURNING id`,
      [req.params.connection_id, entity_type]);

    try {
      // Обработка webhook в зависимости от entity_type
      await db.query(`UPDATE erp_sync_log SET records_success=1, status='completed', completed_at=NOW() WHERE id=$1`, [logRes.rows[0].id]);
      return { success: true, log_id: logRes.rows[0].id };
    } catch (e) {
      await db.query(`UPDATE erp_sync_log SET status='failed', error_details=$1, completed_at=NOW() WHERE id=$2`,
        [JSON.stringify([{ error: e.message }]), logRes.rows[0].id]);
      return reply.code(500).send({ error: e.message });
    }
  });

  // ── POST /erp/connections/:id/rotate-secret ─────────────────────────
  fastify.post('/erp/connections/:id/rotate-secret', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    if (!ERP_ROLES.includes(req.user.role)) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }
    const connRes = await db.query('SELECT id FROM erp_connections WHERE id = $1', [req.params.id]);
    if (!connRes.rows.length) return reply.code(404).send({ error: 'Подключение не найдено' });

    const secret = crypto.randomBytes(32).toString('hex');
    await db.query('UPDATE erp_connections SET webhook_secret = $1, updated_at = NOW() WHERE id = $2', [secret, req.params.id]);
    return { success: true, webhook_secret: secret };
  });

};
