'use strict';

/**
 * ASGARD CRM — TKP (Technical-Commercial Proposals)
 *
 * GET    /              — List TKP
 * GET    /:id           — Details
 * POST   /              — Create
 * PUT    /:id           — Update
 * DELETE /:id           — Delete draft
 * GET    /:id/pdf       — Generate PDF (Puppeteer with PDFKit fallback)
 * POST   /:id/send      — Send by email
 * PUT    /:id/status    — Change status
 * POST   /:id/approve   — Approve TKP (directors only)
 */

const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

/* Try to load Puppeteer PDF generator */
let pdfGenerator = null;
let numberToWordsRu = null;
try {
  pdfGenerator = require('../services/pdf-generator');
  numberToWordsRu = pdfGenerator.numberToWordsRu;
} catch (e) {
  console.warn('[TKP] pdf-generator not available, will use PDFKit:', e.message);
}

// Inline fallback for numberToWordsRu if pdf-generator unavailable
if (!numberToWordsRu) {
  numberToWordsRu = function(num) {
    if (!num && num !== 0) return 'Ноль рублей 00 копеек';
    const units = ['','один','два','три','четыре','пять','шесть','семь','восемь','девять'];
    const unitsFem = ['','одна','две','три','четыре','пять','шесть','семь','восемь','девять'];
    const teens = ['десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать'];
    const tens = ['','','двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто'];
    const hundreds = ['','сто','двести','триста','четыреста','пятьсот','шестьсот','семьсот','восемьсот','девятьсот'];
    function getForm(n, forms) { n = Math.abs(n) % 100; if (n > 10 && n < 20) return forms[2]; n = n % 10; if (n === 1) return forms[0]; if (n >= 2 && n <= 4) return forms[1]; return forms[2]; }
    function triplet(n, fem) { if (n === 0) return ''; const p = []; const h = Math.floor(n/100), r = n%100, t = Math.floor(r/10), u = r%10; if (h>0) p.push(hundreds[h]); if (t===1) p.push(teens[u]); else { if (t>1) p.push(tens[t]); if (u>0) p.push(fem?unitsFem[u]:units[u]); } return p.join(' '); }
    const rub = Math.floor(Math.abs(num)), kop = Math.round((Math.abs(num)-rub)*100);
    if (rub === 0) return 'Ноль рублей ' + String(kop).padStart(2,'0') + ' ' + getForm(kop, ['копейка','копейки','копеек']);
    const parts = [];
    const billions = Math.floor(rub/1e9); if (billions>0) parts.push(triplet(billions,false)+' '+getForm(billions,['миллиард','миллиарда','миллиардов']));
    const millions = Math.floor((rub%1e9)/1e6); if (millions>0) parts.push(triplet(millions,false)+' '+getForm(millions,['миллион','миллиона','миллионов']));
    const thousands = Math.floor((rub%1e6)/1e3); if (thousands>0) parts.push(triplet(thousands,true)+' '+getForm(thousands,['тысяча','тысячи','тысяч']));
    const remainder = rub%1000; if (remainder>0 || parts.length===0) parts.push(triplet(remainder,false));
    let result = parts.join(' ').replace(/\s+/g,' ').trim();
    result = result.charAt(0).toUpperCase() + result.slice(1);
    return result + ' ' + getForm(rub,['рубль','рубля','рублей']) + ' ' + String(kop).padStart(2,'0') + ' ' + getForm(kop,['копейка','копейки','копеек']);
  };
}

const WRITE_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const SEE_ALL_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'BUH', 'HEAD_TO'];
const APPROVE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

async function routes(fastify, options) {
  const db = fastify.db;
  const { createNotification } = require('../services/notify');

  // GET / — List
  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { tender_id, status, limit = 100, offset = 0 } = request.query;
    const userRole = request.user.role;
    const userId = request.user.id;

    let sql = `
      SELECT t.*, u.name as creator_name, te.customer_name as tender_customer
      FROM tkp t
      LEFT JOIN users u ON t.author_id = u.id
      LEFT JOIN tenders te ON t.tender_id = te.id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;

    if (!SEE_ALL_ROLES.includes(userRole)) {
      sql += ` AND t.author_id = $${idx++}`;
      params.push(userId);
    }

    if (tender_id) { sql += ` AND t.tender_id = $${idx++}`; params.push(tender_id); }
    if (status) { sql += ` AND t.status = $${idx++}`; params.push(status); }

    sql += ` ORDER BY t.id DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(Math.min(parseInt(limit), 200), parseInt(offset));

    const { rows } = await db.query(sql, params);
    return { items: rows };
  });

  // GET /:id — Details
  fastify.get('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { rows } = await db.query(`
      SELECT t.*, u.name as creator_name, sb.name as sent_by_name,
             ab.name as approved_by_name,
             te.customer_name as tender_customer, te.tender_title as tender_number
      FROM tkp t
      LEFT JOIN users u ON t.author_id = u.id
      LEFT JOIN users sb ON t.sent_by = sb.id
      LEFT JOIN users ab ON t.approved_by = ab.id
      LEFT JOIN tenders te ON t.tender_id = te.id
      WHERE t.id = $1
    `, [request.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'TKP not found' });
    return { item: rows[0] };
  });

  // POST / — Create
  fastify.post('/', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const { subject, title, tender_id, work_id, customer_name, customer_inn,
            contact_person, contact_phone, contact_email, customer_email,
            items, content_json, services, total_sum, deadline, validity_days,
            source, customer_address, work_description, estimate_id } = request.body;

    const subj = subject || title;
    if (!subj || !String(subj).trim()) {
      return reply.code(400).send({ error: 'Required field: subject' });
    }

    const itemsVal = items
      ? (typeof items === 'string' ? items : JSON.stringify(items))
      : (content_json ? JSON.stringify(content_json) : '{}');

    const { rows } = await db.query(`
      INSERT INTO tkp (subject, tender_id, work_id, customer_name, customer_inn,
                        contact_person, contact_phone, contact_email,
                        customer_address, work_description,
                        items, services, total_sum, deadline, validity_days,
                        author_id, source, estimate_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING *
    `, [
      subj.trim(), tender_id || null, work_id || null,
      customer_name || null, customer_inn || null,
      contact_person || null, contact_phone || null,
      contact_email || customer_email || null,
      customer_address || null, work_description || null,
      itemsVal, services || null, total_sum || 0,
      deadline || null, validity_days || 30, request.user.id,
      source || null, estimate_id || null
    ]);

    return { item: rows[0] };
  });

  // PUT /:id — Update
  fastify.put('/:id', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const allowed = ['subject', 'tender_id', 'work_id', 'customer_name', 'customer_inn',
                     'contact_person', 'contact_phone', 'contact_email',
                     'items', 'services', 'total_sum', 'deadline', 'validity_days', 'tkp_type',
                     'source', 'customer_address', 'work_description', 'estimate_id'];
    const updates = [];
    const values = [];
    let idx = 1;

    for (const key of allowed) {
      if (request.body[key] !== undefined) {
        const val = key === 'items' ? JSON.stringify(request.body[key]) : request.body[key];
        updates.push(`${key} = $${idx++}`);
        values.push(val);
      }
    }
    if (!updates.length) return reply.code(400).send({ error: 'No data' });

    updates.push('updated_at = NOW()');
    values.push(id);
    const { rows } = await db.query(
      `UPDATE tkp SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`, values
    );
    if (!rows[0]) return reply.code(404).send({ error: 'TKP not found' });
    return { item: rows[0] };
  });

  // DELETE /:id — Delete draft
  fastify.delete('/:id', {
    preHandler: [fastify.requireRoles(['ADMIN'])]
  }, async (request, reply) => {
    const { rows } = await db.query(
      `DELETE FROM tkp WHERE id = $1 AND status = 'draft' RETURNING id`, [request.params.id]
    );
    if (!rows[0]) return reply.code(404).send({ error: 'TKP not found or not a draft' });
    return { success: true };
  });

  // PUT /:id/status — Change status
  fastify.put('/:id/status', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const { status } = request.body;
    const validStatuses = ['draft', 'sent', 'accepted', 'rejected', 'expired'];
    if (!validStatuses.includes(status)) {
      return reply.code(400).send({ error: `Status must be: ${validStatuses.join(', ')}` });
    }

    const { rows } = await db.query(
      'UPDATE tkp SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [status, id]
    );
    if (!rows[0]) return reply.code(404).send({ error: 'TKP not found' });

    if (rows[0].author_id && rows[0].author_id !== request.user.id) {
      const statusLabels = { accepted: 'accepted', rejected: 'rejected', expired: 'expired' };
      if (statusLabels[status]) {
        createNotification(db, {
          user_id: rows[0].author_id,
          title: `TKP ${statusLabels[status]}`,
          message: `TKP "${rows[0].subject}" — ${statusLabels[status]}`,
          type: 'tkp',
          link: `#/tkp?id=${id}`
        });
      }
    }

    return { item: rows[0] };
  });

  // POST /:id/approve — Approve TKP (directors only)
  fastify.post('/:id/approve', {
    preHandler: [fastify.requireRoles(APPROVE_ROLES)]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);

    const check = await db.query('SELECT * FROM tkp WHERE id = $1', [id]);
    if (!check.rows[0]) return reply.code(404).send({ error: 'TKP not found' });

    const tkp = check.rows[0];

    if (tkp.status === 'approved') {
      return reply.code(400).send({ error: 'TKP already approved' });
    }

    const { rows } = await db.query(`
      UPDATE tkp
         SET status = 'approved',
             approved_by = $1,
             approved_at = NOW(),
             updated_at  = NOW()
       WHERE id = $2
       RETURNING *
    `, [request.user.id, id]);

    if (tkp.author_id && tkp.author_id !== request.user.id) {
      createNotification(db, {
        user_id: tkp.author_id,
        title: 'TKP approved',
        message: `TKP "${tkp.subject}" approved by director`,
        type: 'tkp',
        link: `#/tkp?id=${id}`
      });
    }

    return { item: rows[0] };
  });

  // ═══════════════════════════════════════════════════════════════
  // POST /:id/copy — Clone TKP
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/:id/copy', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const { rows } = await db.query('SELECT * FROM tkp WHERE id = $1', [request.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'TKP not found' });
    const src = rows[0];

    const { rows: [copy] } = await db.query(`
      INSERT INTO tkp (subject, tender_id, work_id, customer_name, customer_inn,
                        contact_person, contact_phone, contact_email,
                        customer_address, work_description,
                        items, services, total_sum, deadline, validity_days,
                        author_id, source, estimate_id, tkp_type)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      RETURNING *
    `, [
      '(Копия) ' + (src.subject || ''), src.tender_id, src.work_id,
      src.customer_name, src.customer_inn,
      src.contact_person, src.contact_phone, src.contact_email,
      src.customer_address, src.work_description,
      src.items ? (typeof src.items === 'string' ? src.items : JSON.stringify(src.items)) : '{}',
      src.services, src.total_sum, src.deadline, src.validity_days || 30,
      request.user.id, src.source, src.estimate_id, src.tkp_type
    ]);

    return { item: copy };
  });

  // ═══════════════════════════════════════════════════════════════
  // GET /:id/pdf — Generate PDF (Puppeteer with PDFKit fallback)
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/:id/pdf', {
    preHandler: [
      // Allow token via query parameter (browser opens PDF in new tab without Bearer header)
      async (request, reply) => {
        if (!request.headers.authorization && request.query.token) {
          request.headers.authorization = 'Bearer ' + request.query.token;
        }
      },
      fastify.authenticate
    ]
  }, async (request, reply) => {
    const { rows } = await db.query('SELECT t.*, te.tender_title as tender_number FROM tkp t LEFT JOIN tenders te ON t.tender_id = te.id WHERE t.id = $1', [request.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'TKP not found' });
    const tkp = rows[0];

    const pdfOpts = {
      signature: request.query.signature === '1',
      stamp: request.query.stamp === '1'
    };

    let pdfBuffer;

    // Try Puppeteer-based generator first
    if (pdfGenerator) {
      try {
        pdfBuffer = await pdfGenerator.generateTkpPdf(tkp.id, pdfOpts);
      } catch (err) {
        fastify.log.warn(`[TKP PDF] Puppeteer failed for TKP ${tkp.id}: ${err.message}, falling back to PDFKit`);
        pdfBuffer = null;
      }
    }

    // Fallback to PDFKit if Puppeteer failed or unavailable
    if (!pdfBuffer) {
      pdfBuffer = await generateTkpPdfKit(tkp, db, pdfOpts);
    }

    // Save PDF
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const pdfDir = path.join(uploadDir, 'tkp');
    fs.mkdirSync(pdfDir, { recursive: true });
    const filename = `tkp_${tkp.id}_${Date.now()}.pdf`;
    fs.writeFileSync(path.join(pdfDir, filename), pdfBuffer);
    await db.query('UPDATE tkp SET pdf_path = $1 WHERE id = $2', [`tkp/${filename}`, tkp.id]);

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="TKP_${tkp.id}.pdf"`);
    return reply.send(pdfBuffer);
  });

  // POST /:id/send — Send by email
  fastify.post('/:id/send', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const { rows } = await db.query('SELECT t.*, te.tender_title as tender_number FROM tkp t LEFT JOIN tenders te ON t.tender_id = te.id WHERE t.id = $1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'TKP not found' });
    const tkp = rows[0];

    const email = request.body.email || tkp.contact_email;
    if (!email) return reply.code(400).send({ error: 'Укажите email получателя' });

    // Прямая генерация PDF (без fastify.inject)
    const pdfOpts = {
      signature: request.body.with_signature === true || request.body.with_signature === '1',
      stamp: request.body.with_stamp === true || request.body.with_stamp === '1'
    };

    let pdfBuf;
    if (pdfGenerator) {
      try {
        pdfBuf = await pdfGenerator.generateTkpPdf(tkp.id, pdfOpts);
      } catch (err) {
        fastify.log.warn(`[TKP Send] Puppeteer failed: ${err.message}, fallback to PDFKit`);
        pdfBuf = null;
      }
    }
    if (!pdfBuf) {
      pdfBuf = await generateTkpPdfKit(tkp, db, pdfOpts);
    }

    // Текст письма на русском + поддержка custom_text
    const customText = request.body.custom_text || '';
    const sumStr = tkp.total_sum ? Number(tkp.total_sum).toLocaleString('ru-RU') + ' руб.' : 'по запросу';
    const emailText = customText ||
      `Добрый день!\n\nНаправляем Вам технико-коммерческое предложение «${tkp.subject}».\nСумма: ${sumStr}\nСрок действия: ${tkp.validity_days || 30} дней\n\nС уважением,\nООО «Асгард Сервис»`;

    // Отправка через CRM Mailer (личный ящик + BCC на CRM)
    const crmMailer = require('../services/crm-mailer');
    await crmMailer.sendCrmEmail(db, request.user.id, {
      to: email,
      subject: `Коммерческое предложение: ${tkp.subject}`,
      text: emailText,
      attachments: [{ filename: `ТКП_${tkp.id}.pdf`, content: pdfBuf, contentType: 'application/pdf' }]
    });

    await db.query(
      'UPDATE tkp SET status = $1, sent_at = NOW(), sent_by = $2, contact_email = $3, updated_at = NOW() WHERE id = $4',
      ['sent', request.user.id, email, id]
    );

    if (tkp.author_id && tkp.author_id !== request.user.id) {
      createNotification(db, {
        user_id: tkp.author_id,
        title: 'ТКП отправлено',
        message: `ТКП «${tkp.subject}» отправлено на ${email}`,
        type: 'tkp',
        link: `#/tkp?id=${id}`
      });
    }

    return { success: true, message: `ТКП отправлено на ${email}` };
  });
}

/**
 * PDFKit — PDF генератор ТКП
 * Динамические высоты, кириллица (DejaVuSans), авто-перенос текста, нумерация страниц
 */
async function generateTkpPdfKit(tkp, db, opts) {
  opts = opts || {};
  // Load company profile from DB
  let company = {};
  try {
    const { rows } = await db.query("SELECT value_json FROM settings WHERE key = 'company_profile'");
    if (rows.length > 0) {
      company = typeof rows[0].value_json === 'string' ? JSON.parse(rows[0].value_json) : rows[0].value_json;
    }
  } catch (_) {}
  if (!company.name) {
    company = {
      name: 'ООО «Асгард-Сервис»', inn: '7736244785', kpp: '770101001', ogrn: '1157746388128',
      legal_address: '105082, г. Москва, ул. Большая Почтовая, д. 55/59, строение 1, пом. 37',
      phone: '8(499)322-30-62', email: 'info@asgard-service.com',
      director_name: 'Кудряшов Олег Сергеевич', director_title: 'Генеральный директор',
    };
  }

  const fontPath = path.join(__dirname, '..', '..', 'public', 'assets', 'fonts');
  let regularFont, boldFont;

  if (fs.existsSync(path.join(fontPath, 'DejaVuSans.ttf'))) {
    regularFont = path.join(fontPath, 'DejaVuSans.ttf');
    boldFont = fs.existsSync(path.join(fontPath, 'DejaVuSans-Bold.ttf'))
      ? path.join(fontPath, 'DejaVuSans-Bold.ttf') : regularFont;
  } else if (fs.existsSync('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')) {
    regularFont = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
    boldFont = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
  }

  const pageW = 595.28; // A4 width in pt
  const pageH = 841.89; // A4 height in pt
  const mL = 50, mR = 50, mT = 40, mB = 45;
  const contentW = pageW - mL - mR;
  const maxY = pageH - mB - 20; // leave space for footer

  const doc = new PDFDocument({
    size: 'A4', margin: mL,
    info: { Title: tkp.subject || 'ТКП', Author: 'ООО АСГАРД СЕРВИС' },
    bufferPages: true,
    autoFirstPage: true
  });

  if (regularFont) doc.registerFont('F', regularFont);
  if (boldFont) doc.registerFont('FB', boldFont);
  const F = regularFont ? 'F' : 'Helvetica';
  const FB = boldFont ? 'FB' : 'Helvetica-Bold';

  const chunks = [];
  doc.on('data', c => chunks.push(c));

  const fmtNum = (n) => n ? Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0,00';

  // Helper: ensure enough vertical space, add page if needed
  function ensureSpace(needed) {
    if (doc.y + needed > maxY) {
      doc.addPage();
      doc.x = mL;
      doc.y = mT;
    }
  }

  // Helper: measure text height
  function textH(text, opts) {
    return doc.heightOfString(text || '', { width: opts.width || contentW, font: opts.font || F, fontSize: opts.size || 10 });
  }

  // ─── Parse items from JSONB ───
  let cj;
  try {
    cj = typeof tkp.items === 'string' ? JSON.parse(tkp.items || '{}') : (tkp.items || {});
  } catch (_) { cj = {}; }
  const rows = Array.isArray(cj.items) ? cj.items : [];
  const vatPct = cj.vat_pct || 22;

  // ─── ЛОГО ───
  const logoPath = path.join(__dirname, '..', '..', 'public', 'assets', 'img', 'asgard_emblem.png');
  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, mL, mT - 28, { width: 120, height: 69 });
  }

  // ─── Реквизиты справа от лого (из БД) ───
  doc.font(FB).fontSize(12).fillColor('#1E4D8C')
     .text(company.name || 'ООО «Асгард-Сервис»', 180, mT - 26);
  doc.font(F).fontSize(7.5).fillColor('#6B7280');
  doc.text(`ИНН ${company.inn || ''} | ОГРН ${company.ogrn || ''} | КПП ${company.kpp || ''}`, 180, mT - 11);
  doc.text(company.legal_address || '', 180, mT - 1);
  doc.text(`Тел: ${company.phone || ''} | ${company.email || ''}`, 180, mT + 9);

  // ─── Акцентная линия (синяя + красная) ───
  const lineY = mT + 52;
  doc.rect(mL, lineY, contentW / 2, 3).fill('#1E4D8C');
  doc.rect(mL + contentW / 2, lineY, contentW / 2, 3).fill('#C8293B');
  doc.x = mL; doc.y = lineY + 14;

  // ─── ЗАГОЛОВОК ───
  doc.font(FB).fontSize(15).fillColor('#1E4D8C')
     .text('КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ', mL, doc.y, { width: contentW, align: 'center' });
  doc.moveDown(0.2);

  const tkpLabel = tkp.tkp_number || `№ ${tkp.id}`;
  const tkpDate = tkp.created_at ? new Date(tkp.created_at).toLocaleDateString('ru-RU') : '';
  doc.font(F).fontSize(10).fillColor('#6B7280')
     .text(`${tkpLabel} от ${tkpDate}`, mL, doc.y, { width: contentW, align: 'center' });
  doc.moveDown(0.8);

  // ─── КАРТОЧКА ЗАКАЗЧИКА (динамическая высота) ───
  const cardLines = [];
  if (tkp.customer_name) cardLines.push({ label: 'Заказчик:', value: tkp.customer_name });
  if (tkp.customer_inn) {
    const kppStr = cj.customer_kpp ? ' / КПП: ' + cj.customer_kpp : '';
    cardLines.push({ label: 'ИНН:', value: tkp.customer_inn + kppStr });
  }
  if (tkp.customer_address) cardLines.push({ label: 'Адрес:', value: tkp.customer_address });
  if (tkp.contact_person) cardLines.push({ label: 'Контактное лицо:', value: tkp.contact_person });
  const contacts = [tkp.contact_phone, tkp.contact_email].filter(Boolean).join(' | ');
  if (contacts) cardLines.push({ label: 'Контакты:', value: contacts });

  if (cardLines.length > 0) {
    const labelW = 105;
    const valueW = contentW - labelW - 24; // padding
    const cardPad = 10;

    // Measure actual height of each line
    let totalCardH = cardPad * 2;
    const lineMeasures = cardLines.map(line => {
      doc.font(F).fontSize(9.5);
      const h = Math.max(14, doc.heightOfString(line.value, { width: valueW }) + 4);
      totalCardH += h;
      return h;
    });

    ensureSpace(totalCardH);
    const cardY = doc.y;

    // Background + border
    doc.rect(mL, cardY, contentW, totalCardH).fill('#F8F9FA');
    doc.rect(mL, cardY, contentW, totalCardH).strokeColor('#E5E7EB').lineWidth(0.5).stroke();

    let cy = cardY + cardPad;
    cardLines.forEach((line, idx) => {
      doc.font(FB).fontSize(8.5).fillColor('#6B7280')
         .text(line.label, mL + 12, cy, { width: labelW });
      doc.font(F).fontSize(9.5).fillColor('#374151')
         .text(line.value, mL + 12 + labelW, cy, { width: valueW });
      cy += lineMeasures[idx];
    });

    doc.x = mL;
    doc.y = cardY + totalCardH + 10;
  }

  // ─── ПРЕДМЕТ ───
  doc.x = mL;
  if (tkp.subject) {
    ensureSpace(40);
    doc.font(FB).fontSize(11).fillColor('#1E4D8C')
       .text('Предмет предложения', mL, doc.y, { width: contentW });
    doc.moveDown(0.2);
    doc.font(FB).fontSize(10.5).fillColor('#374151')
       .text(tkp.subject, mL, doc.y, { width: contentW });
    doc.moveDown(0.4);
  }

  if (tkp.work_description) {
    doc.font(F).fontSize(9.5).fillColor('#374151')
       .text(tkp.work_description, mL, doc.y, { width: contentW });
    doc.moveDown(0.4);
  }

  // ─── ТАБЛИЦА РАБОТ (динамические высоты строк) ───
  if (rows.length > 0) {
    ensureSpace(60);
    doc.x = mL;
    doc.font(FB).fontSize(11).fillColor('#1E4D8C')
       .text('Состав работ и стоимость', mL, doc.y, { width: contentW });
    doc.moveDown(0.4);

    const colW = [25, 240, 40, 35, 72, 83];
    const totalW = colW.reduce((a, b) => a + b, 0);
    const tableX = mL;
    const headerH = 24;
    let ty = doc.y;

    // ── Table header ──
    doc.rect(tableX, ty, totalW, headerH).fill('#1E4D8C');
    const headers = ['№', 'Наименование работ / услуг', 'Ед.', 'Кол.', 'Цена, ₽', 'Сумма, ₽'];
    let hx = tableX;
    doc.font(FB).fontSize(7.5).fillColor('#FFFFFF');
    headers.forEach((h, i) => {
      doc.text(h, hx + 3, ty + 7, { width: colW[i] - 6, align: i >= 4 ? 'right' : (i === 0 || i >= 2 ? 'center' : 'left') });
      hx += colW[i];
    });
    ty += headerH;

    // ── Rows with dynamic height ──
    rows.forEach((row, ri) => {
      const name = row.name || 'Услуга';
      doc.font(F).fontSize(8.5);
      const nameH = doc.heightOfString(name, { width: colW[1] - 8 });
      const rowH = Math.max(20, nameH + 8);

      if (ty + rowH > maxY) {
        doc.addPage();
        ty = mT;
        // Re-draw header on new page
        doc.rect(tableX, ty, totalW, headerH).fill('#1E4D8C');
        let hx2 = tableX;
        doc.font(FB).fontSize(7.5).fillColor('#FFFFFF');
        headers.forEach((h, i) => {
          doc.text(h, hx2 + 3, ty + 7, { width: colW[i] - 6, align: i >= 4 ? 'right' : (i === 0 || i >= 2 ? 'center' : 'left') });
          hx2 += colW[i];
        });
        ty += headerH;
      }

      // Alternating row background
      if (ri % 2 === 1) {
        doc.rect(tableX, ty, totalW, rowH).fill('#F8F9FA');
      }

      const qty = row.qty || row.quantity || 1;
      const price = row.price || 0;
      const total = row.total || qty * price;
      const cellY = ty + 4;

      let rx = tableX;
      doc.font(F).fontSize(8.5).fillColor('#374151');
      // №
      doc.text(String(ri + 1), rx + 3, cellY, { width: colW[0] - 6, align: 'center' });
      rx += colW[0];
      // Name (wraps)
      doc.text(name, rx + 4, cellY, { width: colW[1] - 8 });
      rx += colW[1];
      // Unit
      doc.text(row.unit || 'усл.', rx + 3, cellY, { width: colW[2] - 6, align: 'center' });
      rx += colW[2];
      // Qty
      doc.text(String(qty), rx + 3, cellY, { width: colW[3] - 6, align: 'center' });
      rx += colW[3];
      // Price
      doc.text(fmtNum(price), rx + 3, cellY, { width: colW[4] - 6, align: 'right' });
      rx += colW[4];
      // Total
      doc.text(fmtNum(total), rx + 3, cellY, { width: colW[5] - 6, align: 'right' });

      // Row bottom border
      doc.strokeColor('#E5E7EB').lineWidth(0.3)
         .moveTo(tableX, ty + rowH).lineTo(tableX + totalW, ty + rowH).stroke();

      // Vertical column borders
      let bx = tableX;
      colW.forEach(w => {
        doc.moveTo(bx, ty).lineTo(bx, ty + rowH).stroke();
        bx += w;
      });
      doc.moveTo(bx, ty).lineTo(bx, ty + rowH).stroke();

      ty += rowH;
    });

    // Bottom border of table
    doc.strokeColor('#D1D5DB').lineWidth(0.5)
       .moveTo(tableX, ty).lineTo(tableX + totalW, ty).stroke();

    doc.x = mL;
    doc.y = ty + 8;
  }

  // ─── ИТОГО ───
  if (rows.length > 0) {
    const subtotal = cj.subtotal || rows.reduce((s, r) => s + (r.total || (r.qty || 1) * (r.price || 0)), 0);
    const vatSum = cj.vat_sum || Math.round(subtotal * vatPct / 100);
    const totalWithVat = cj.total_with_vat || (subtotal + vatSum);

    ensureSpace(55);
    doc.font(F).fontSize(9.5).fillColor('#6B7280')
       .text(`Итого без НДС: ${fmtNum(subtotal)} ₽`, mL, doc.y, { width: contentW, align: 'right' });
    doc.font(F).fontSize(9.5).fillColor('#6B7280')
       .text(`НДС ${vatPct}%: ${fmtNum(vatSum)} ₽`, mL, doc.y, { width: contentW, align: 'right' });
    doc.moveDown(0.15);
    doc.moveTo(mL + contentW - 200, doc.y).lineTo(mL + contentW, doc.y).strokeColor('#1E4D8C').lineWidth(1).stroke();
    doc.moveDown(0.25);
    doc.font(FB).fontSize(12).fillColor('#1E4D8C')
       .text(`ИТОГО: ${fmtNum(totalWithVat)} ₽`, mL, doc.y, { width: contentW, align: 'right' });
    doc.moveDown(0.9);
    const posCount = rows.length;
    const posWord = posCount === 1 ? 'позиция' : (posCount < 5 ? 'позиции' : 'позиций');
    doc.font(F).fontSize(10.5).fillColor('#374151')
       .text(`Всего ${posCount} ${posWord} на сумму: ${numberToWordsRu(totalWithVat)}`, mL, doc.y, { width: contentW });
    doc.moveDown(0.5);
  } else if (tkp.total_sum) {
    doc.font(FB).fontSize(12).fillColor('#1E4D8C')
       .text(`Итого: ${fmtNum(tkp.total_sum)} ₽`, mL, doc.y, { width: contentW, align: 'right' });
    doc.moveDown(0.9);
    doc.font(F).fontSize(10.5).fillColor('#374151')
       .text(`Сумма: ${numberToWordsRu(parseFloat(tkp.total_sum))}`, mL, doc.y, { width: contentW });
    doc.moveDown(0.5);
  }

  // ─── УСЛОВИЯ ───
  ensureSpace(60);
  doc.x = mL;
  doc.moveTo(mL, doc.y).lineTo(mL + contentW, doc.y).strokeColor('#E5E7EB').lineWidth(0.5).stroke();
  doc.moveDown(0.4);
  doc.font(FB).fontSize(11).fillColor('#1E4D8C')
     .text('Условия', mL, doc.y, { width: contentW });
  doc.moveDown(0.25);

  const paymentTerms = cj.payment_terms || '';
  const terms = [];
  if (tkp.deadline) terms.push(`Сроки выполнения: ${tkp.deadline}`);
  terms.push(`Срок действия предложения: ${tkp.validity_days || 30} дней`);
  if (paymentTerms) terms.push(`Условия оплаты: ${paymentTerms}`);

  terms.forEach(t => {
    ensureSpace(18);
    doc.font(F).fontSize(9.5).fillColor('#374151')
       .text(`•  ${t}`, mL + 8, doc.y, { width: contentW - 8 });
    doc.moveDown(0.15);
  });

  if (cj.notes || tkp.notes) {
    doc.moveDown(0.2);
    ensureSpace(20);
    doc.font(F).fontSize(9.5).fillColor('#374151')
       .text(cj.notes || tkp.notes, mL, doc.y, { width: contentW });
  }

  // ─── ПОДПИСЬ ───
  const signNeed = (opts.stamp || opts.signature) ? 100 : 40;
  ensureSpace(signNeed);
  doc.x = mL;
  doc.moveDown(0.5);
  doc.moveTo(mL, doc.y).lineTo(mL + contentW, doc.y).strokeColor('#E5E7EB').lineWidth(0.5).stroke();
  doc.moveDown(0.6);

  const authorName = cj.author_name || company.director_name || 'Кудряшов О.С.';
  const authorPos = cj.author_position || company.director_title || 'Генеральный директор';

  const signY = doc.y;
  doc.font(FB).fontSize(9.5).fillColor('#374151')
     .text(authorPos, mL, signY, { width: 170 });
  doc.font(F).fontSize(9.5).fillColor('#9CA3AF')
     .text('_________________', mL + 180, signY, { width: 110, align: 'center' });
  doc.font(FB).fontSize(9.5).fillColor('#374151')
     .text(authorName, mL + 310, signY, { width: contentW - 310, align: 'right' });

  // Signature & stamp images
  const imgDir = path.join(__dirname, '..', '..', 'public', 'assets', 'img');
  const sigPath = path.join(imgDir, 'signature.png');
  const stampPath = path.join(imgDir, 'stamp.png');

  if (opts.signature && fs.existsSync(sigPath)) {
    doc.image(sigPath, mL + 180, signY - 30, { height: 80 });
  }
  if (opts.stamp && fs.existsSync(stampPath)) {
    doc.image(stampPath, mL + 130, signY - 15, { height: 90 });
  }

  doc.x = mL;
  doc.y = signY + (opts.stamp || opts.signature ? 55 : 14);
  if (!opts.stamp && !opts.signature) {
    doc.font(F).fontSize(7.5).fillColor('#9CA3AF')
       .text('М.П.', mL, doc.y, { width: contentW, align: 'center' });
  }

  // ─── ФУТЕР (безопасный — не создаёт новые страницы) ───
  const footerY = pageH - mB;
  const pages = doc.bufferedPageRange();
  const totalPages = pages.count;
  const footerText = `${company.name || 'ООО «Асгард-Сервис»'} — ${company.phone || ''} — ${company.email || ''}`;
  for (let i = pages.start; i < pages.start + totalPages; i++) {
    doc.switchToPage(i);
    // Рисуем линию и текст БЕЗ text() чтобы не вызвать page overflow.
    // Используем _fragment напрямую или просто линию + текст с lineBreak:false
    doc.save();
    doc.moveTo(mL, footerY).lineTo(mL + contentW, footerY).strokeColor('#E5E7EB').lineWidth(0.3).stroke();
    // Текст рисуем через низкоуровневый метод чтобы избежать addPage
    doc.font(F).fontSize(6.5).fillColor('#9CA3AF');
    doc.text(footerText, mL, footerY + 4, { width: contentW - 60, lineBreak: false, height: 10 });
    doc.text(`${i + 1} / ${totalPages}`, mL + contentW - 55, footerY + 4, { width: 55, align: 'right', lineBreak: false, height: 10 });
    doc.restore();
  }

  // ─── ЗАКРЫТИЕ ───
  doc.end();
  await new Promise(resolve => doc.on('end', resolve));
  return Buffer.concat(chunks);
}

module.exports = routes;
