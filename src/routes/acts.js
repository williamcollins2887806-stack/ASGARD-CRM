/**
 * ASGARD CRM - Acts Routes
 * Акты выполненных работ
 */

// ═══════════════════════════════════════════════════════════════════════════
// SECURITY: Ролевой контроль для финансовых операций (HIGH-9)
// ═══════════════════════════════════════════════════════════════════════════
const WRITE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'PM', 'BUH'];

async function actsRoutes(fastify, options) {
  const db = fastify.db;

  // Auto-generate act number in format АКТ-ГГГГ-NNN
  async function generateActNumber() {
    const year = new Date().getFullYear();
    const prefix = `АКТ-${year}-`;
    const { rows } = await db.query(
      `SELECT act_number FROM acts
       WHERE act_number LIKE $1
       ORDER BY act_number DESC LIMIT 1`,
      [prefix + '%']
    );
    let next = 1;
    if (rows.length > 0) {
      const match = rows[0].act_number.match(/(\d+)$/);
      if (match) next = parseInt(match[1]) + 1;
    }
    return `${prefix}${String(next).padStart(3, '0')}`;
  }

  // Auto-generate next act number (for frontend pre-fill)
  fastify.get('/next-number', {
    preHandler: [fastify.authenticate]
  }, async () => {
    const number = await generateActNumber();
    return { success: true, number };
  });

  // Получить все акты
  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { work_id, customer_name, status, limit = 100 } = request.query;
    
    let sql = 'SELECT * FROM acts WHERE 1=1';
    const params = [];
    
    if (work_id) {
      params.push(work_id);
      sql += ` AND work_id = $${params.length}`;
    }
    
    if (customer_name) {
      params.push('%' + customer_name + '%');
      sql += ` AND customer_name ILIKE $${params.length}`;
    }
    
    if (status) {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }
    
    params.push(parseInt(limit));
    sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
    
    const result = await db.query(sql, params);
    return { success: true, acts: result.rows };
  });
  
  // Получить акт по ID
  fastify.get('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const result = await db.query('SELECT * FROM acts WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Акт не найден' });
    }
    
    return { success: true, act: result.rows[0] };
  });
  
  // Создать акт
  // SECURITY: Только WRITE_ROLES (HIGH-9)
  fastify.post('/', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request) => {
    let {
      act_number, act_date, status = 'draft',
      work_id, customer_name, customer_inn,
      description, amount, vat_pct = null, total_amount,
      signed_date, paid_date
    } = request.body;

    // Load VAT default from settings if not provided
    if (vat_pct == null) {
      try {
        const vat = await db.query("SELECT value_json FROM settings WHERE key = 'vat_default_pct'");
        vat_pct = vat.rows[0] ? JSON.parse(vat.rows[0].value_json) : 20;
      } catch(_) { vat_pct = 20; }
    }

    const result = await db.query(`
      INSERT INTO acts (
        act_number, act_date, status, work_id,
        customer_name, customer_inn, description,
        amount, vat_pct, total_amount,
        signed_date, paid_date, created_by, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
      RETURNING *
    `, [
      act_number, act_date, status, work_id,
      customer_name, customer_inn, description,
      amount, vat_pct, total_amount,
      signed_date, paid_date, request.user?.id
    ]);
    
    return { success: true, act: result.rows[0] };
  });
  
  // Обновить акт
  // SECURITY: Только WRITE_ROLES (HIGH-9)
  fastify.put('/:id', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;
    const {
      act_number, act_date, status,
      work_id, customer_name, customer_inn,
      description, amount, vat_pct, total_amount,
      signed_date, paid_date
    } = request.body;
    
    const result = await db.query(`
      UPDATE acts SET
        act_number = COALESCE($1, act_number),
        act_date = COALESCE($2, act_date),
        status = COALESCE($3, status),
        work_id = COALESCE($4, work_id),
        customer_name = COALESCE($5, customer_name),
        customer_inn = COALESCE($6, customer_inn),
        description = COALESCE($7, description),
        amount = COALESCE($8, amount),
        vat_pct = COALESCE($9, vat_pct),
        total_amount = COALESCE($10, total_amount),
        signed_date = $11,
        paid_date = $12,
        updated_at = NOW()
      WHERE id = $13
      RETURNING *
    `, [
      act_number, act_date, status, work_id,
      customer_name, customer_inn, description,
      amount, vat_pct, total_amount,
      signed_date, paid_date, id
    ]);
    
    if (result.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Акт не найден' });
    }
    
    return { success: true, act: result.rows[0] };
  });
  
  // Удалить акт
  // SECURITY: Только WRITE_ROLES (HIGH-9)
  fastify.delete('/:id', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const { id } = request.params;
    
    const result = await db.query('DELETE FROM acts WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Акт не найден' });
    }
    
    return { success: true, deleted: true };
  });
  
  // Статистика
  fastify.get('/stats/summary', {
    preHandler: [fastify.authenticate]
  }, async () => {
    const result = await db.query(`
      SELECT
        status,
        COUNT(*) as count,
        COALESCE(SUM(total_amount), 0) as total_sum
      FROM acts
      GROUP BY status
    `);

    return { success: true, stats: result.rows };
  });

  // ═══════════════════════════════════════════════════════════════
  // GET /:id/pdf — Генерация PDF акта (PDFKit)
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/:id/pdf', {
    preHandler: [
      async (request, reply) => {
        if (!request.headers.authorization && request.query.token) {
          request.headers.authorization = 'Bearer ' + request.query.token;
        }
      },
      fastify.authenticate
    ]
  }, async (request, reply) => {
    const PDFDocument = require('pdfkit');
    const path = require('path');
    const fs = require('fs');

    const { id } = request.params;
    const actRes = await db.query('SELECT * FROM acts WHERE id = $1', [id]);
    if (actRes.rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Акт не найден' });
    }
    const act = actRes.rows[0];

    // Load company settings
    let companyName = 'АСГАРД-СЕРВИС';
    let companyInn = '';
    try {
      const sRes = await db.query("SELECT key, value_json FROM settings WHERE key IN ('company_name','company_inn')");
      for (const row of sRes.rows) {
        const val = JSON.parse(row.value_json || 'null');
        if (row.key === 'company_name' && val) companyName = val;
        if (row.key === 'company_inn' && val) companyInn = val;
      }
    } catch (_) {}

    const formatDate = (d) => d ? new Date(d).toLocaleDateString('ru-RU') : '—';
    const formatMoney = (n) => Number(n || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const pdfBuffer = await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Try to use embedded font; fallback to Helvetica for Cyrillic
      try { doc.font('Helvetica'); } catch (_) {}

      const pageW = doc.page.width - 100;

      // ── Header ──
      doc.fontSize(16).font('Helvetica-Bold')
        .text('АКТ о приёмке выполненных работ', { align: 'center' });
      doc.fontSize(13).font('Helvetica')
        .text(`№ ${act.act_number || id}   от ${formatDate(act.act_date)}`, { align: 'center' });
      doc.moveDown(1.5);

      // ── Parties ──
      doc.fontSize(11).font('Helvetica-Bold').text('Стороны:');
      doc.font('Helvetica')
        .text(`Исполнитель: ${companyName}${companyInn ? '  ИНН ' + companyInn : ''}`)
        .text(`Заказчик: ${act.customer_name || '—'}${act.customer_inn ? '  ИНН ' + act.customer_inn : ''}`);
      doc.moveDown(1);

      // ── Description ──
      if (act.description) {
        doc.fontSize(11).font('Helvetica-Bold').text('Наименование работ:');
        doc.font('Helvetica').text(act.description);
        doc.moveDown(1);
      }

      // ── Table ──
      doc.fontSize(11).font('Helvetica-Bold').text('Финансы:');
      doc.moveDown(0.3);

      const tableTop = doc.y;
      const colX = [50, 300, 390, 480];
      const cols = ['Наименование', 'Сумма без НДС', 'НДС', 'Итого'];
      doc.font('Helvetica-Bold').fontSize(10);
      cols.forEach((c, i) => doc.text(c, colX[i], tableTop, { width: 100 }));
      doc.moveDown(0.5);

      const rowY = doc.y;
      const amount = Number(act.amount || 0);
      const vatPct = Number(act.vat_pct || 0);
      const vatAmt = amount * vatPct / 100;
      const total = Number(act.total_amount || (amount + vatAmt));

      doc.font('Helvetica').fontSize(10);
      const rowData = [
        act.description || 'Выполненные работы',
        formatMoney(amount) + ' ₽',
        `${vatPct}% (${formatMoney(vatAmt)} ₽)`,
        formatMoney(total) + ' ₽'
      ];
      rowData.forEach((c, i) => doc.text(c, colX[i], rowY, { width: 100 }));
      doc.moveDown(1.5);

      // ── Total ──
      doc.fontSize(12).font('Helvetica-Bold')
        .text(`ИТОГО С НДС: ${formatMoney(total)} ₽`, { align: 'right' });
      doc.moveDown(2);

      // ── Signatures ──
      doc.fontSize(11).font('Helvetica-Bold').text('Подписи сторон:');
      doc.moveDown(0.5);
      doc.font('Helvetica').fontSize(10);
      const sigY = doc.y;
      doc.text('Сдал (Исполнитель):', 50, sigY);
      doc.text('Принял (Заказчик):', 300, sigY);
      doc.moveDown(1);
      const lineY = doc.y;
      doc.moveTo(50, lineY).lineTo(230, lineY).stroke();
      doc.moveTo(300, lineY).lineTo(480, lineY).stroke();
      doc.text('_________________', 50, lineY + 3);
      doc.text('_________________', 300, lineY + 3);

      if (act.signed_date) {
        doc.moveDown(0.5);
        doc.text(`Дата подписания: ${formatDate(act.signed_date)}`);
      }

      doc.end();
    });

    // Save PDF
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const pdfDir = path.join(uploadDir, 'acts');
    fs.mkdirSync(pdfDir, { recursive: true });
    const filename = `act_${act.id}_${Date.now()}.pdf`;
    fs.writeFileSync(path.join(pdfDir, filename), pdfBuffer);
    await db.query('UPDATE acts SET file_path = $1 WHERE id = $2', [`acts/${filename}`, act.id]);

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="Act_${act.act_number || act.id}.pdf"`);
    return reply.send(pdfBuffer);
  });
}

module.exports = actsRoutes;
