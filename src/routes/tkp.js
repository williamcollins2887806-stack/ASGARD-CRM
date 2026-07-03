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

// Создавать ТКП может: РП (responsible_pm_id тендера), HEAD_PM, директора и ADMIN.
// TO/HEAD_TO допущены УСЛОВНО — только для тендеров с calculator_kind='to' (ТО считал сам).
// Проверка делается в assertCanCreateTkpForTender по конкретному тендеру.
const WRITE_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
// Видеть список ТКП могут все, кто работает с тендером
const SEE_ALL_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'BUH', 'HEAD_TO', 'TO', 'HEAD_PM'];
// Согласовать ТКП может директор; для ТО-просчётов — HEAD_TO (см. /api/approval/tkp).
const APPROVE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

// Внутренний хелпер: проверка что пользователь может создать ТКП для конкретного тендера.
async function assertCanCreateTkpForTender(db, user, tenderId) {
  if (!tenderId) {
    // ТКП без тендера разрешён только классическому WRITE_ROLES (не ТО/HEAD_TO)
    if (['TO','HEAD_TO'].includes(user.role)) {
      throw Object.assign(
        new Error('Тендерный отдел может создавать ТКП только привязанные к своему тендеру'),
        { statusCode: 403 }
      );
    }
    return;
  }
  const { rows } = await db.query(
    'SELECT responsible_pm_id, calculator_kind, calculator_user_id, created_by_user_id, created_by FROM tenders WHERE id = $1',
    [tenderId]
  );
  if (!rows[0]) {
    throw Object.assign(new Error('Тендер не найден'), { statusCode: 404 });
  }
  const t = rows[0];

  // ТО/HEAD_TO допущены ТОЛЬКО если тендер помечен «считает ТО»
  if (['TO','HEAD_TO'].includes(user.role)) {
    if (t.calculator_kind !== 'to') {
      throw Object.assign(
        new Error('Тендерный отдел может создавать ТКП только для своих просчётов (calculator_kind=to)'),
        { statusCode: 403 }
      );
    }
    // ТО — только для своего тендера (своего расчёта); HEAD_TO — для любого ТО-тендера
    if (user.role === 'TO') {
      const owner = Number(t.calculator_user_id || t.created_by_user_id || t.created_by);
      if (owner !== Number(user.id)) {
        throw Object.assign(
          new Error('ТКП по этому тендеру создаёт только сам ТО, который его считал'),
          { statusCode: 403 }
        );
      }
    }
    return;
  }

  // PM — только свой тендер; HEAD_PM/директора/ADMIN — без проверки
  if (user.role !== 'PM') return;
  if (Number(t.responsible_pm_id) !== Number(user.id)) {
    throw Object.assign(
      new Error('ТКП по этому тендеру создаёт только назначенный РП'),
      { statusCode: 403 }
    );
  }
}

async function routes(fastify, options) {
  const db = fastify.db;
  const { createNotification } = require('../services/notify');

  // GET / — List
  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { tender_id, pre_tender_id, status, link_type, client_decision, customer_inn, limit = 100, offset = 0 } = request.query;
    const userRole = request.user.role;
    const userId = request.user.id;

    let sql = `
      SELECT t.*, u.name as creator_name,
             te.customer_name as tender_customer, te.tender_title,
             pt.customer_name as pre_tender_customer,
             cdec.name as client_decision_by_name
      FROM tkp t
      LEFT JOIN users u    ON t.author_id          = u.id
      LEFT JOIN users cdec ON t.client_decision_by = cdec.id
      LEFT JOIN tenders te ON t.tender_id          = te.id
      LEFT JOIN pre_tender_requests pt ON t.pre_tender_id = pt.id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;

    if (!SEE_ALL_ROLES.includes(userRole)) {
      sql += ` AND t.author_id = $${idx++}`;
      params.push(userId);
    }

    if (tender_id)       { sql += ` AND t.tender_id = $${idx++}`;       params.push(tender_id); }
    if (pre_tender_id)   { sql += ` AND t.pre_tender_id = $${idx++}`;   params.push(pre_tender_id); }
    if (status)          { sql += ` AND t.status = $${idx++}`;           params.push(status); }
    if (link_type)       { sql += ` AND t.link_type = $${idx++}`;        params.push(link_type); }
    if (client_decision) { sql += ` AND t.client_decision = $${idx++}`;  params.push(client_decision); }
    if (customer_inn)    { sql += ` AND t.customer_inn = $${idx++}`;     params.push(customer_inn); }

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
    const b = request.body || {};
    const { subject, title, tender_id, work_id, customer_name, customer_inn,
            contact_person, contact_phone, contact_email, customer_email,
            items, content_json, services, deadline, validity_days,
            source, estimate_id, link_type, pre_tender_id, purpose_reason,
            tkp_number, tkp_type } = b;
    // Frontend-aliases — фронт шлёт total_amount/address/description, БД хранит total_sum/customer_address/work_description.
    // Без этих маппингов сумма КП всегда писалась как 0, адрес и описание уходили в null.
    const total_sum         = b.total_sum         ?? b.total_amount ?? 0;
    const customer_address  = b.customer_address  ?? b.address      ?? null;
    const work_description  = b.work_description  ?? b.description  ?? null;
    // Условия оплаты собираются в jsonb-like text (payment_terms colonny text).
    const paymentTermsObj = (b.payment_preset || b.avans_pct != null || b.postpay_days != null || b.custom_payment_terms) ? {
      preset: b.payment_preset || null,
      avans_pct: b.avans_pct != null ? Number(b.avans_pct) : null,
      postpay_days: b.postpay_days != null ? Number(b.postpay_days) : null,
      custom: b.custom_payment_terms || null
    } : null;
    const payment_terms = b.payment_terms || (paymentTermsObj ? JSON.stringify(paymentTermsObj) : null);

    const subj = subject || title;
    if (!subj || !String(subj).trim()) {
      return reply.code(400).send({ error: 'Required field: subject' });
    }

    // PM может создавать ТКП только по своему тендеру
    try {
      await assertCanCreateTkpForTender(db, request.user, tender_id);
    } catch (err) {
      return reply.code(err.statusCode || 500).send({ error: err.message });
    }

    const itemsVal = items
      ? (typeof items === 'string' ? items : JSON.stringify(items))
      : (content_json ? JSON.stringify(content_json) : '{}');

    // Авто-определение link_type: если явно не передан — вычисляем из FK
    const resolvedLinkType = link_type ||
      (tender_id     ? 'tender'         :
       work_id       ? 'work'           :
       pre_tender_id ? 'direct_request' : 'standalone');

    const { rows } = await db.query(`
      INSERT INTO tkp (subject, tender_id, work_id, customer_name, customer_inn,
                        contact_person, contact_phone, contact_email,
                        customer_address, work_description,
                        items, services, total_sum, deadline, validity_days,
                        author_id, source, estimate_id,
                        link_type, pre_tender_id, purpose_reason,
                        tkp_number, tkp_type, payment_terms)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
      RETURNING *
    `, [
      subj.trim(), tender_id || null, work_id || null,
      customer_name || null, customer_inn || null,
      contact_person || null, contact_phone || null,
      contact_email || customer_email || null,
      customer_address, work_description,
      itemsVal, services || null, total_sum || 0,
      deadline || null, validity_days || 30, request.user.id,
      source || null, estimate_id || null,
      resolvedLinkType, pre_tender_id || null, purpose_reason || null,
      tkp_number || null, tkp_type || null, payment_terms
    ]);

    const newTkp = rows[0];

    // Авто-генерация PDF и прикрепление к тендерным документам (фоновая задача)
    if (newTkp.tender_id) {
      const tenderId = newTkp.tender_id;
      const tkpId = newTkp.id;
      const actorId = request.user.id;

      setImmediate(async () => {
        try {
          // Генерируем PDF
          let pdfBuf = null;
          if (pdfGenerator) {
            try { pdfBuf = await pdfGenerator.generateTkpPdf(tkpId, {}); } catch (_) {}
          }
          if (!pdfBuf) {
            const tkpFull = (await db.query('SELECT t.*, te.tender_title as tender_number FROM tkp t LEFT JOIN tenders te ON t.tender_id = te.id WHERE t.id = $1', [tkpId])).rows[0];
            if (tkpFull) pdfBuf = await generateTkpPdfKit(tkpFull, db, {});
          }

          if (pdfBuf) {
            const uploadDir = process.env.UPLOAD_DIR || './uploads';
            const pdfDir = path.join(uploadDir, 'tkp');
            fs.mkdirSync(pdfDir, { recursive: true });
            const filename = `tkp_${tkpId}_${Date.now()}.pdf`;
            const displayName = `ТКП_${tkpId}.pdf`;
            fs.writeFileSync(path.join(pdfDir, filename), pdfBuf);
            await db.query('UPDATE tkp SET pdf_path = $1 WHERE id = $2', [`tkp/${filename}`, tkpId]);

            await db.query(`
              INSERT INTO documents (filename, original_name, mime_type, size, type, tender_id, uploaded_by, download_url, created_at)
              VALUES ($1, $2, 'application/pdf', $3, 'tkp', $4, $5, $6, NOW())
            `, [filename, displayName, pdfBuf.length, tenderId, actorId, `/uploads/tkp/${filename}`]);
          }

          // Excel-версия ТКП (красивая, с формулами, редактируемая)
          try {
            const ExcelJS = require('exceljs');
            const fs3 = require('fs');
            const path3 = require('path');
            const tkpEx = (await db.query(
              `SELECT t.*, u.name as author_name FROM tkp t LEFT JOIN users u ON t.author_id = u.id WHERE t.id = $1`,
              [tkpId]
            )).rows[0];
            if (tkpEx) {
              let iObj = {};
              try { iObj = typeof tkpEx.items === 'string' ? JSON.parse(tkpEx.items) : (tkpEx.items || {}); } catch(_) {}
              const iList = iObj.items || (Array.isArray(iObj) ? iObj : []);
              const vatPct = parseFloat(iObj.vat_pct || 20);

              const wb3 = new ExcelJS.Workbook();
              wb3.creator = 'АСГАРД CRM'; wb3.created = new Date();
              const ws3 = wb3.addWorksheet('ТКП');
              ws3.columns = [
                { key: 'n',     width: 5  },
                { key: 'name',  width: 44 },
                { key: 'unit',  width: 9  },
                { key: 'qty',   width: 8  },
                { key: 'price', width: 16 },
                { key: 'total', width: 16 },
              ];

              const CNVY = 'FF1E3A5F', CWHT = 'FFFFFFFF', CLGR = 'FFF5F7FA';
              const CBdr = { style: 'thin', color: { argb: 'FFD0D6E0' } };
              const Bdr = { top: CBdr, bottom: CBdr, left: CBdr, right: CBdr };

              // Логотип
              const logoP = '/var/www/asgard-crm/public/assets/img/logo.png';
              let curRow = 1;
              if (fs3.existsSync(logoP)) {
                try {
                  const imgId = wb3.addImage({ filename: logoP, extension: 'png' });
                  ws3.addImage(imgId, { tl: { col: 0, row: 0 }, ext: { width: 200, height: 58 } });
                  ws3.getRow(1).height = 44;
                  ws3.getRow(2).height = 12;
                  curRow = 3;
                } catch(_) {
                  const hR = ws3.getRow(curRow++);
                  ws3.mergeCells(`A${hR.number}:F${hR.number}`);
                  hR.getCell(1).value = 'ООО «Асгард Сервис»';
                  hR.getCell(1).font = { bold: true, size: 13, color: { argb: CNVY } };
                  hR.height = 22;
                }
              } else {
                const hR = ws3.getRow(curRow++);
                ws3.mergeCells(`A${hR.number}:F${hR.number}`);
                hR.getCell(1).value = 'ООО «Асгард Сервис»';
                hR.getCell(1).font = { bold: true, size: 13, color: { argb: CNVY } };
                hR.height = 22;
              }

              // Контакты компании
              const cR = ws3.getRow(curRow++);
              ws3.mergeCells(`A${cR.number}:F${cR.number}`);
              cR.getCell(1).value = 'ИНН: 7736244785  ·  Тел.: 8(499)322-30-62  ·  info@asgard-service.com';
              cR.getCell(1).font = { size: 9, color: { argb: 'FF8890B0' } };
              cR.height = 13;

              ws3.getRow(curRow++).height = 8;

              // Заголовок ТКП
              const tR = ws3.getRow(curRow++);
              ws3.mergeCells(`A${tR.number}:F${tR.number}`);
              tR.getCell(1).value = 'ТЕХНИКО-КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ';
              tR.getCell(1).font = { bold: true, size: 15, color: { argb: CNVY } };
              tR.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
              tR.height = 28;

              const nR = ws3.getRow(curRow++);
              ws3.mergeCells(`A${nR.number}:F${nR.number}`);
              const tkpDateStr = tkpEx.created_at ? new Date(tkpEx.created_at).toLocaleDateString('ru-RU') : new Date().toLocaleDateString('ru-RU');
              nR.getCell(1).value = `№ ТКП-${tkpId}  от  ${tkpDateStr}`;
              nR.getCell(1).font = { size: 11, color: { argb: 'FF4A4A6A' } };
              nR.getCell(1).alignment = { horizontal: 'center' };
              nR.height = 18;

              ws3.getRow(curRow++).height = 10;

              // Реквизиты заказчика
              const infoItems = [
                ['Заказчик:',         tkpEx.customer_name || ''],
                ['ИНН заказчика:',    tkpEx.customer_inn || '—'],
                ['Контактное лицо:',  tkpEx.contact_person || '—'],
                ['Телефон:',          tkpEx.contact_phone || '—'],
                ['E-mail:',           tkpEx.contact_email || '—'],
                ['Предмет предложения:', tkpEx.subject || ''],
              ];
              for (const [lbl, val] of infoItems) {
                const iR = ws3.getRow(curRow++);
                iR.getCell(1).value = lbl;
                iR.getCell(1).font = { bold: true, size: 10, color: { argb: 'FF5A6280' } };
                iR.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };
                ws3.mergeCells(`B${iR.number}:F${iR.number}`);
                iR.getCell(2).value = val;
                iR.getCell(2).font = { size: 10 };
                iR.getCell(2).alignment = { wrapText: true };
                iR.height = 16;
              }

              ws3.getRow(curRow++).height = 10;

              // Заголовок таблицы позиций
              const thR3 = ws3.getRow(curRow++);
              thR3.height = 20;
              ['№', 'Наименование', 'Ед.', 'Кол-во', 'Цена, ₽', 'Сумма, ₽'].forEach((v, i) => {
                const c = thR3.getCell(i + 1);
                c.value = v;
                c.font = { bold: true, size: 10, color: { argb: CWHT } };
                c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CNVY } };
                c.border = Bdr;
                c.alignment = { horizontal: i === 1 ? 'left' : 'center', vertical: 'middle', wrapText: i === 1 };
              });

              const dsRow = curRow;
              for (let i = 0; i < iList.length; i++) {
                const it = iList[i];
                const itemR = ws3.getRow(curRow++);
                const bg = i % 2 === 0 ? CWHT : CLGR;
                const qty = parseFloat(it.qty || it.quantity || 1);
                const price = parseFloat(it.price || it.unit_price || 0);
                const nameLen = (it.name || '').length;
                itemR.height = Math.max(16, Math.ceil(nameLen / 44) * 16);
                [i + 1, it.name || '', it.unit || 'шт.', qty, price, null].forEach((v, ci) => {
                  const c = itemR.getCell(ci + 1);
                  if (ci === 5) { c.value = { formula: `D${itemR.number}*E${itemR.number}` }; c.numFmt = '#,##0.00'; }
                  else { c.value = v; if (ci === 3) c.numFmt = '#,##0.##'; if (ci === 4) c.numFmt = '#,##0.00'; }
                  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
                  c.border = Bdr;
                  c.alignment = { horizontal: ci === 1 ? 'left' : 'center', vertical: 'middle', wrapText: ci === 1 };
                });
              }
              const deRow = curRow - 1;

              ws3.getRow(curRow++).height = 6;

              // Итого без НДС
              const totNvR = ws3.getRow(curRow++); totNvR.height = 20;
              ws3.mergeCells(`A${totNvR.number}:E${totNvR.number}`);
              totNvR.getCell(1).value = 'ИТОГО без НДС:';
              totNvR.getCell(1).font = { bold: true, size: 11 };
              totNvR.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };
              totNvR.getCell(6).value = { formula: `SUM(F${dsRow}:F${deRow})` };
              totNvR.getCell(6).numFmt = '#,##0.00 "₽"';
              totNvR.getCell(6).font = { bold: true, size: 11 };
              totNvR.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };
              totNvR.getCell(6).border = Bdr;
              totNvR.getCell(6).alignment = { horizontal: 'right' };

              // НДС
              const vatR3 = ws3.getRow(curRow++); vatR3.height = 18;
              ws3.mergeCells(`A${vatR3.number}:E${vatR3.number}`);
              vatR3.getCell(1).value = `НДС (${vatPct}%):`;
              vatR3.getCell(1).font = { size: 10, color: { argb: 'FF5A6280' } };
              vatR3.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };
              vatR3.getCell(6).value = { formula: `F${totNvR.number}*${vatPct / 100}` };
              vatR3.getCell(6).numFmt = '#,##0.00 "₽"';
              vatR3.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CLGR } };
              vatR3.getCell(6).border = Bdr;
              vatR3.getCell(6).alignment = { horizontal: 'right' };

              // Итого с НДС
              const totVR = ws3.getRow(curRow++); totVR.height = 24;
              ws3.mergeCells(`A${totVR.number}:E${totVR.number}`);
              totVR.getCell(1).value = 'ИТОГО с НДС:';
              totVR.getCell(1).font = { bold: true, size: 13, color: { argb: 'FF1B5E20' } };
              totVR.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };
              totVR.getCell(6).value = { formula: `F${totNvR.number}+F${vatR3.number}` };
              totVR.getCell(6).numFmt = '#,##0.00 "₽"';
              totVR.getCell(6).font = { bold: true, size: 13, color: { argb: 'FF1B5E20' } };
              totVR.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCCFFCC' } };
              totVR.getCell(6).border = Bdr;
              totVR.getCell(6).alignment = { horizontal: 'right', vertical: 'middle' };

              // Сумма прописью
              ws3.getRow(curRow++).height = 8;
              const wpR = ws3.getRow(curRow++); wpR.height = 18;
              ws3.mergeCells(`A${wpR.number}:F${wpR.number}`);
              wpR.getCell(1).value = `Сумма прописью: ${numberToWordsRu(parseFloat(tkpEx.total_sum || 0))}`;
              wpR.getCell(1).font = { italic: true, size: 10, color: { argb: 'FF4A4A6A' } };
              wpR.getCell(1).alignment = { horizontal: 'left', wrapText: true };

              // Срок действия
              ws3.getRow(curRow++).height = 8;
              const vdR = ws3.getRow(curRow++); vdR.height = 16;
              vdR.getCell(1).value = 'Срок действия КП:';
              vdR.getCell(1).font = { bold: true, size: 10 };
              ws3.mergeCells(`B${vdR.number}:F${vdR.number}`);
              vdR.getCell(2).value = `${tkpEx.validity_days || 30} дней`;

              if (tkpEx.deadline) {
                const dlR3 = ws3.getRow(curRow++); dlR3.height = 16;
                dlR3.getCell(1).value = 'Срок исполнения:';
                dlR3.getCell(1).font = { bold: true, size: 10 };
                ws3.mergeCells(`B${dlR3.number}:F${dlR3.number}`);
                dlR3.getCell(2).value = new Date(tkpEx.deadline).toLocaleDateString('ru-RU');
              }

              // Подпись
              ws3.getRow(curRow++).height = 24;
              const sg3 = ws3.getRow(curRow++); sg3.height = 18;
              sg3.getCell(1).value = 'Менеджер:';
              sg3.getCell(1).font = { size: 10, color: { argb: 'FF5A6280' } };
              ws3.mergeCells(`B${sg3.number}:D${sg3.number}`);
              sg3.getCell(2).value = tkpEx.author_name || '';
              sg3.getCell(2).font = { size: 10 };
              ws3.mergeCells(`E${sg3.number}:F${sg3.number}`);
              sg3.getCell(5).value = '________________________  /  ____________';
              sg3.getCell(5).font = { size: 10, color: { argb: 'FF8890B0' } };
              sg3.getCell(5).alignment = { horizontal: 'center' };

              // Сохраняем
              const xlsDir3 = path3.join(process.env.UPLOAD_DIR || './uploads', 'tkp');
              fs3.mkdirSync(xlsDir3, { recursive: true });
              const xlsName3 = `tkp_${tkpId}_${Date.now()}.xlsx`;
              const xlsBuf3 = await wb3.xlsx.writeBuffer();
              fs3.writeFileSync(path3.join(xlsDir3, xlsName3), xlsBuf3);
              await db.query(`
                INSERT INTO documents (filename, original_name, mime_type, size, type, tender_id, uploaded_by, download_url, created_at)
                VALUES ($1, $2, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', $3, 'tkp', $4, $5, $6, NOW())
              `, [xlsName3, `ТКП_${tkpId}.xlsx`, xlsBuf3.length, tenderId, actorId, `/uploads/tkp/${xlsName3}`]);
            }
          } catch (xlsErr3) {
            console.error('[TKP auto-excel] error:', xlsErr3.message);
          }

          // РП создал ТКП → тендер уходит в 'Готово к отправке КП'.
          // На этом этапе тендер появляется у ТО/HEAD_TO как «требуется отправка КП клиенту».
          await db.query(
            `UPDATE tenders SET
               tender_status = 'Готово к отправке КП',
               tkp_sent_at = COALESCE(tkp_sent_at, NOW()),
               updated_at = NOW()
             WHERE id = $1 AND tender_status IN ('ТКП согласовано', 'Согласование ТКП', 'Отправлено на просчёт')`,
            [tenderId]
          );

          // Уведомляем HEAD_TO и TO что ТКП готово к отправке
          const { rows: notifyUsers } = await db.query(
            "SELECT id FROM users WHERE role IN ('HEAD_TO', 'TO') AND is_active = true"
          );
          const { createNotification } = require('../services/notify');
          const tenderInfo = (await db.query('SELECT customer_name, tender_title FROM tenders WHERE id = $1', [tenderId])).rows[0] || {};
          for (const u of notifyUsers) {
            createNotification(db, {
              user_id: u.id,
              title: '📨 ТКП готово — нужна отправка КП',
              message: `${tenderInfo.customer_name || ''} — ${tenderInfo.tender_title || ''}`,
              type: 'tkp',
              link: `#/tenders?id=${tenderId}`
            });
          }
        } catch (err) {
          console.error('[TKP auto-pdf] error:', err.message);
        }
      });
    }

    return { item: newTkp };
  });

  // PUT /:id — Update
  fastify.put('/:id', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const allowed = ['subject', 'tender_id', 'work_id', 'customer_name', 'customer_inn',
                     'contact_person', 'contact_phone', 'contact_email',
                     'items', 'services', 'total_sum', 'deadline', 'validity_days', 'tkp_type',
                     'source', 'customer_address', 'work_description', 'estimate_id',
                     'link_type', 'pre_tender_id', 'purpose_reason',
                     'client_decision', 'client_decision_comment',
                     'tkp_number', 'payment_terms', 'status'];
    // Frontend-aliases при PUT — обрабатываем те же что в POST.
    const b = request.body || {};
    if (b.total_amount != null && b.total_sum == null) b.total_sum = b.total_amount;
    if (b.address != null && b.customer_address == null) b.customer_address = b.address;
    if (b.description != null && b.work_description == null) b.work_description = b.description;
    if (b.payment_terms == null && (b.payment_preset || b.avans_pct != null || b.postpay_days != null || b.custom_payment_terms)) {
      b.payment_terms = JSON.stringify({
        preset: b.payment_preset || null,
        avans_pct: b.avans_pct != null ? Number(b.avans_pct) : null,
        postpay_days: b.postpay_days != null ? Number(b.postpay_days) : null,
        custom: b.custom_payment_terms || null
      });
    }

    const updates = [];
    const values = [];
    let idx = 1;

    for (const key of allowed) {
      if (b[key] !== undefined) {
        const val = key === 'items' ? JSON.stringify(b[key]) : b[key];
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
                        author_id, source, estimate_id, tkp_type,
                        link_type, pre_tender_id, purpose_reason)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
      RETURNING *
    `, [
      '(Копия) ' + (src.subject || ''), src.tender_id, src.work_id,
      src.customer_name, src.customer_inn,
      src.contact_person, src.contact_phone, src.contact_email,
      src.customer_address, src.work_description,
      src.items ? (typeof src.items === 'string' ? src.items : JSON.stringify(src.items)) : '{}',
      src.services, src.total_sum, src.deadline, src.validity_days || 30,
      request.user.id, src.source, src.estimate_id, src.tkp_type,
      src.link_type || 'standalone', src.pre_tender_id || null, src.purpose_reason || null
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

  // ═══════════════════════════════════════════════════════════════
  // GET /:id/excel — выгрузка ТКП в Excel (красивый шаблон, без печати)
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/:id/excel', {
    preHandler: [
      async (request, reply) => {
        if (!request.headers.authorization && request.query.token) {
          request.headers.authorization = 'Bearer ' + request.query.token;
        }
      },
      fastify.authenticate
    ]
  }, async (request, reply) => {
    const { rows } = await db.query(
      `SELECT t.*, u.name as author_name, te.tender_title as tender_number
       FROM tkp t LEFT JOIN users u ON t.author_id = u.id
       LEFT JOIN tenders te ON t.tender_id = te.id WHERE t.id = $1`,
      [request.params.id]
    );
    if (!rows[0]) return reply.code(404).send({ error: 'TKP not found' });
    const buf = await generateTkpExcel(rows[0], db);
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="TKP_${rows[0].id}.xlsx"`);
    return reply.send(Buffer.from(buf));
  });

  // ═══════════════════════════════════════════════════════════════
  // POST /preview-pdf — генерация PDF без записи в БД (для предпросмотра)
  // body: те же поля что и POST / (subject, items, customer_*, total_sum…)
  // Возвращает PDF inline; нет аудита, нет уведомлений, ничего не сохраняется.
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/preview-pdf', {
    preHandler: [fastify.requireRoles(WRITE_ROLES)]
  }, async (request, reply) => {
    const b = request.body || {};
    const subj = b.subject || b.title || 'Предпросмотр ТКП';

    // Собираем виртуальный TKP-объект (как из БД), без INSERT
    const itemsObj = b.items
      ? (typeof b.items === 'string' ? JSON.parse(b.items) : b.items)
      : (b.content_json || {});

    const tkpVirtual = {
      id: 'preview',
      subject: subj,
      tender_id: b.tender_id || null,
      customer_name: b.customer_name || null,
      customer_inn: b.customer_inn || null,
      customer_address: b.customer_address || null,
      contact_person: b.contact_person || null,
      contact_phone: b.contact_phone || null,
      contact_email: b.contact_email || b.customer_email || null,
      work_description: b.work_description || null,
      items: typeof itemsObj === 'string' ? itemsObj : JSON.stringify(itemsObj),
      services: b.services || null,
      total_sum: b.total_sum || 0,
      deadline: b.deadline || null,
      validity_days: b.validity_days || 30,
      tkp_number: null,
      created_at: new Date().toISOString()
    };

    const pdfOpts = {
      signature: b.with_signature === true || b.with_signature === '1',
      stamp: b.with_stamp === true || b.with_stamp === '1'
    };

    const pdfBuf = await generateTkpPdfKit(tkpVirtual, db, pdfOpts);

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', 'inline; filename="preview.pdf"');
    return reply.send(pdfBuf);
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

    // ТО/HEAD_TO отправили КП клиенту → тендер уходит в 'КП отправлено'.
    if (tkp.tender_id) {
      await db.query(
        `UPDATE tenders SET tender_status = 'КП отправлено', updated_at = NOW()
         WHERE id = $1 AND tender_status IN ('Готово к отправке КП', 'ТКП согласовано')`,
        [tkp.tender_id]
      );
    }

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

// ═══════════════════════════════════════════════════════════════
// Excel-версия ТКП — чистый белый лист, логотип, ровные колонки,
// без печати. Визуально близко к PDF. Возвращает Buffer.
// ═══════════════════════════════════════════════════════════════
async function generateTkpExcel(tkp, db) {
  const ExcelJS = require('exceljs');

  // company profile
  let company = {};
  try {
    const { rows } = await db.query("SELECT value_json FROM settings WHERE key = 'company_profile'");
    if (rows.length) company = typeof rows[0].value_json === 'string' ? JSON.parse(rows[0].value_json) : rows[0].value_json;
  } catch (_) {}
  if (!company.name) company = {
    name: 'ООО «Асгард-Сервис»', inn: '7736244785', kpp: '770101001',
    phone: '8(499)322-30-62', email: 'info@asgard-service.com',
  };

  // author
  let authorName = tkp.author_name || '';
  let authorPos = '';
  let iObj = {};
  try { iObj = typeof tkp.items === 'string' ? JSON.parse(tkp.items) : (tkp.items || {}); } catch (_) {}
  if (!authorName && tkp.author_id) {
    try { const r = await db.query('SELECT name FROM users WHERE id=$1', [tkp.author_id]); if (r.rows[0]) authorName = r.rows[0].name; } catch (_) {}
  }
  authorName = iObj.author_name || authorName;
  authorPos = iObj.author_position || 'Руководитель проекта';

  const iList = iObj.items || (Array.isArray(iObj) ? iObj : []);
  const vatPct = parseFloat(iObj.vat_pct != null ? iObj.vat_pct : 22);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'АСГАРД CRM';
  wb.created = new Date();
  const ws = wb.addWorksheet('ТКП', {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
                 margins: { left: 0.5, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
  });
  ws.columns = [
    { width: 5 }, { width: 46 }, { width: 9 }, { width: 9 }, { width: 16 }, { width: 17 },
  ];

  const NAVY = 'FF1E3A5F', WHITE = 'FFFFFFFF', GREY = 'FF8890B0', DARK = 'FF2A2A40', GREEN = 'FF1B5E20';
  const thin = { style: 'thin', color: { argb: 'FFCBD2DE' } };
  const allBorder = { top: thin, bottom: thin, left: thin, right: thin };
  let r = 1;

  // ── Логотип ──
  const logoPath = path.join(__dirname, '..', '..', 'public', 'assets', 'img', 'logo.png');
  if (fs.existsSync(logoPath)) {
    try {
      const imgId = wb.addImage({ filename: logoPath, extension: 'png' });
      ws.addImage(imgId, { tl: { col: 0, row: 0 }, ext: { width: 196, height: 56 } });
      ws.getRow(1).height = 46; r = 2;
    } catch (_) {}
  }
  if (r === 1) {
    ws.mergeCells('A1:F1');
    const h = ws.getCell('A1'); h.value = company.name; h.font = { bold: true, size: 14, color: { argb: NAVY } };
    ws.getRow(1).height = 24; r = 2;
  }

  // Контакты компании
  ws.mergeCells(`A${r}:F${r}`);
  const cc = ws.getCell(`A${r}`);
  cc.value = `${company.name}  ·  ИНН ${company.inn || ''}  ·  ${company.phone || ''}  ·  ${company.email || ''}`;
  cc.font = { size: 9, color: { argb: GREY } };
  cc.alignment = { horizontal: 'left' };
  ws.getRow(r).height = 14; r++;

  // линия-разделитель
  ws.mergeCells(`A${r}:F${r}`);
  ws.getCell(`A${r}`).border = { bottom: { style: 'medium', color: { argb: NAVY } } };
  ws.getRow(r).height = 6; r++;
  r++; // отступ

  // ── Заголовок ──
  ws.mergeCells(`A${r}:F${r}`);
  const t = ws.getCell(`A${r}`);
  t.value = 'ТЕХНИКО-КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ';
  t.font = { bold: true, size: 16, color: { argb: NAVY } };
  t.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(r).height = 28; r++;

  ws.mergeCells(`A${r}:F${r}`);
  const num = ws.getCell(`A${r}`);
  const dateStr = tkp.created_at ? new Date(tkp.created_at).toLocaleDateString('ru-RU') : new Date().toLocaleDateString('ru-RU');
  num.value = `${tkp.tkp_number || ('№ ТКП-' + tkp.id)}  от  ${dateStr}`;
  num.font = { size: 11, color: { argb: DARK } };
  num.alignment = { horizontal: 'center' };
  ws.getRow(r).height = 18; r++;
  r++; // отступ

  // ── Реквизиты заказчика ──
  const info = [
    ['Заказчик:', tkp.customer_name || ''],
    ['ИНН / КПП:', `${tkp.customer_inn || '—'}${iObj.customer_kpp ? ' / ' + iObj.customer_kpp : ''}`],
    ['Адрес объекта:', tkp.customer_address || '—'],
    ['Контактное лицо:', tkp.contact_person || '—'],
    ['Телефон:', tkp.contact_phone || '—'],
    ['E-mail:', tkp.contact_email || '—'],
    ['Предмет:', tkp.subject || ''],
  ];
  for (const [lbl, val] of info) {
    if (val === '—' && (lbl === 'Телефон:' || lbl === 'E-mail:')) continue;
    const rr = ws.getRow(r);
    rr.getCell(1).value = lbl;
    rr.getCell(1).font = { bold: true, size: 10, color: { argb: GREY } };
    rr.getCell(1).alignment = { horizontal: 'left', vertical: 'top' };
    ws.mergeCells(`B${r}:F${r}`);
    rr.getCell(2).value = val;
    rr.getCell(2).font = { size: 10, color: { argb: DARK } };
    rr.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    rr.height = Math.max(15, Math.ceil(String(val).length / 70) * 14);
    r++;
  }
  r++; // отступ

  // ── Таблица позиций ──
  const thRow = ws.getRow(r); thRow.height = 22;
  ['№', 'Наименование работ', 'Ед.', 'Кол-во', 'Цена, ₽', 'Сумма, ₽'].forEach((v, i) => {
    const c = thRow.getCell(i + 1);
    c.value = v;
    c.font = { bold: true, size: 10, color: { argb: WHITE } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    c.border = allBorder;
    c.alignment = { horizontal: i === 1 ? 'left' : 'center', vertical: 'middle', wrapText: true };
  });
  r++;

  const firstItem = r;
  for (let i = 0; i < iList.length; i++) {
    const it = iList[i];
    const qty = parseFloat(it.qty || it.quantity || 1);
    const price = parseFloat(it.price || it.unit_price || 0);
    const nameLen = (it.name || '').length;
    const rr = ws.getRow(r); rr.height = Math.max(18, Math.ceil(nameLen / 46) * 14);
    const vals = [i + 1, it.name || '', it.unit || 'усл.', qty, price, null];
    vals.forEach((v, ci) => {
      const c = rr.getCell(ci + 1);
      if (ci === 5) { c.value = { formula: `D${r}*E${r}` }; c.numFmt = '#,##0'; }
      else { c.value = v; if (ci === 4) c.numFmt = '#,##0'; if (ci === 3) c.numFmt = '#,##0.##'; }
      c.font = { size: 10, color: { argb: DARK } };
      c.border = allBorder;
      c.alignment = { horizontal: ci === 1 ? 'left' : (ci === 0 ? 'center' : 'right'), vertical: 'middle', wrapText: ci === 1 };
      if (ci === 2 || ci === 3) c.alignment.horizontal = 'center';
    });
    r++;
  }
  const lastItem = r - 1;
  r++; // отступ

  // ── Итоги ──
  function totalRow(label, formula, opts2) {
    opts2 = opts2 || {};
    const rr = ws.getRow(r); rr.height = opts2.big ? 24 : 19;
    ws.mergeCells(`A${r}:E${r}`);
    const lc = rr.getCell(1);
    lc.value = label;
    lc.font = { bold: !!opts2.bold, size: opts2.big ? 13 : 11, color: { argb: opts2.green ? GREEN : DARK } };
    lc.alignment = { horizontal: 'right', vertical: 'middle' };
    const vc = rr.getCell(6);
    vc.value = { formula };
    vc.numFmt = '#,##0.00 "₽"';
    vc.font = { bold: !!opts2.bold, size: opts2.big ? 13 : 11, color: { argb: opts2.green ? GREEN : DARK } };
    vc.alignment = { horizontal: 'right', vertical: 'middle' };
    vc.border = { top: thin, bottom: opts2.big ? { style: 'double', color: { argb: NAVY } } : thin };
    r++;
  }
  totalRow('Итого без НДС:', `SUM(F${firstItem}:F${lastItem})`, { bold: true });
  totalRow(`НДС ${vatPct}%:`, `F${lastItem + 2}*${vatPct / 100}`, {});
  totalRow('ИТОГО с НДС:', `F${lastItem + 2}+F${lastItem + 3}`, { bold: true, big: true, green: true });
  r++; // отступ

  // Сумма прописью
  const totalWithVat = parseFloat(tkp.total_sum || iObj.total_with_vat || 0);
  ws.mergeCells(`A${r}:F${r}`);
  const wp = ws.getCell(`A${r}`);
  wp.value = `Сумма прописью: ${numberToWordsRu(totalWithVat)}`;
  wp.font = { italic: true, size: 10, color: { argb: DARK } };
  wp.alignment = { wrapText: true };
  ws.getRow(r).height = 28; r++;
  r++;

  // Условия / сроки
  const conds = [];
  if (iObj.payment_terms) conds.push(['Условия оплаты:', iObj.payment_terms]);
  if (tkp.deadline) conds.push(['Срок выполнения:', tkp.deadline]);
  conds.push(['Срок действия КП:', `${tkp.validity_days || 30} дней`]);
  for (const [lbl, val] of conds) {
    const rr = ws.getRow(r);
    rr.getCell(1).value = lbl;
    rr.getCell(1).font = { bold: true, size: 10, color: { argb: GREY } };
    rr.getCell(1).alignment = { vertical: 'top' };
    ws.mergeCells(`B${r}:F${r}`);
    rr.getCell(2).value = val;
    rr.getCell(2).font = { size: 10, color: { argb: DARK } };
    rr.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    rr.height = Math.max(15, Math.ceil(String(val).length / 70) * 14);
    r++;
  }

  // Обеспечение Заказчика
  if (Array.isArray(iObj.customer_provides) && iObj.customer_provides.length) {
    r++;
    ws.mergeCells(`A${r}:F${r}`);
    const h = ws.getCell(`A${r}`);
    h.value = 'Обеспечение Заказчика (вне стоимости работ):';
    h.font = { bold: true, size: 10, color: { argb: NAVY } };
    ws.getRow(r).height = 16; r++;
    for (const x of iObj.customer_provides) {
      ws.mergeCells(`A${r}:F${r}`);
      const c = ws.getCell(`A${r}`);
      c.value = `•  ${x}`;
      c.font = { size: 9.5, color: { argb: DARK } };
      c.alignment = { wrapText: true };
      ws.getRow(r).height = Math.max(14, Math.ceil(String(x).length / 90) * 13);
      r++;
    }
  }
  r++;

  // Подпись (без печати)
  r++;
  const sg = ws.getRow(r); sg.height = 20;
  sg.getCell(1).value = authorPos + ':';
  sg.getCell(1).font = { size: 10, color: { argb: GREY } };
  ws.mergeCells(`B${r}:C${r}`);
  sg.getCell(2).value = authorName;
  sg.getCell(2).font = { bold: true, size: 10, color: { argb: DARK } };
  ws.mergeCells(`E${r}:F${r}`);
  sg.getCell(5).value = '_______________ / подпись';
  sg.getCell(5).font = { size: 10, color: { argb: GREY } };
  sg.getCell(5).alignment = { horizontal: 'center' };

  return await wb.xlsx.writeBuffer();
}

module.exports = routes;

// ═══════════════════════════════════════════════════════════════════════════════
// Дополнительные endpoints (V128): парсинг файлов, загрузка готового ТКП,
// решение клиента, скачать оригинальный файл.
// Регистрируются в той же функции routes — чтобы не плодить отдельный файл.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Добавить в routes() следующие endpoint-ы (вызывается из patch ниже):
 *
 * POST  /parse-attachment        — парсинг файла, без сохранения в БД
 * POST  /upload-ready            — multipart: поля + файл → создать ТКП + сохранить файл
 * POST  /:id/client-decision     — отметить решение клиента (accepted/rejected/no_response)
 * GET   /:id/attachment          — скачать оригинальный прикреплённый файл
 *
 * Расширения существующих endpoint-ов (inline патчи ниже):
 * GET   /   — новые фильтры: link_type, client_decision, customer_inn
 * POST  /   — новые поля: link_type, pre_tender_id, purpose_reason + auto-detect link_type
 * PUT   /:id — новые поля: те же
 */

// Патч: регистрируем дополнительные endpoint-ы поверх уже экспортированной routes().
const _origRoutes = module.exports;

module.exports = async function routesWithExtensions(fastify, options) {
  // Регистрируем исходные маршруты
  await _origRoutes(fastify, options);

  const db = fastify.db;
  const { createNotification } = require('../services/notify');

  const tkpParser = require('../services/tkp-parser');
  const pathLib   = require('path');
  const fsLib     = require('fs');

  const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
  const EDIT_ROLES  = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/tkp/parse-attachment
  // Принимает один файл (multipart), возвращает структуру parsed-ТКП.
  // Ничего не сохраняет в БД.
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.post('/parse-attachment', {
    preHandler: [fastify.requireRoles(EDIT_ROLES)]
  }, async (request, reply) => {
    let data;
    try {
      data = await request.file();
    } catch (e) {
      return reply.code(400).send({ error: 'Файл не передан или превышен лимит размера (200 МБ)' });
    }
    if (!data) return reply.code(400).send({ error: 'Файл не передан' });

    let buf;
    try {
      buf = await data.toBuffer();
    } catch (e) {
      return reply.code(400).send({ error: 'Не удалось прочитать файл: ' + e.message });
    }

    if (data.file.truncated) {
      return reply.code(413).send({ error: 'Файл превышает 200 МБ' });
    }

    try {
      const result = await tkpParser.parseTkpBuffer({
        buf,
        originalName: data.filename || 'file',
        mime: data.mimetype
      });
      return { success: true, ...result };
    } catch (err) {
      request.log.error(err, '[TKP parse-attachment]');
      return reply.code(500).send({ error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/tkp/upload-ready
  // Multipart форма: поля ТКП + один файл.
  // Создаёт запись в tkp + сохраняет оригинальный файл + вносит в documents.
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.post('/upload-ready', {
    preHandler: [fastify.requireRoles(EDIT_ROLES)]
  }, async (request, reply) => {
    const body   = {};
    let fileBuf  = null;
    let fileInfo = null;

    // Итерируем multipart-части: поля → body, файл → fileBuf
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        try {
          fileBuf  = await part.toBuffer();
          fileInfo = { filename: part.filename, mimetype: part.mimetype, truncated: part.file.truncated };
        } catch (e) {
          return reply.code(400).send({ error: 'Не удалось прочитать файл: ' + e.message });
        }
      } else {
        body[part.fieldname] = part.value;
      }
    }

    if (!fileBuf || !fileInfo) return reply.code(400).send({ error: 'Файл обязателен' });
    if (fileInfo.truncated) return reply.code(413).send({ error: 'Файл превышает 200 МБ' });

    const subject = String(body.subject || body.title || '').trim();
    if (!subject) return reply.code(400).send({ error: 'Обязательное поле: subject' });

    // Определяем link_type
    const tenderId    = body.tender_id     ? parseInt(body.tender_id)     : null;
    const preTenderId = body.pre_tender_id ? parseInt(body.pre_tender_id) : null;
    const workId      = body.work_id       ? parseInt(body.work_id)       : null;
    const linkType    = body.link_type     ||
      (tenderId    ? 'tender'         :
       preTenderId ? 'direct_request' :
       workId      ? 'work'           : 'standalone');

    // Парсим items если переданы строкой
    let itemsVal = '{}';
    if (body.items) {
      try {
        const parsed = typeof body.items === 'string' ? JSON.parse(body.items) : body.items;
        itemsVal = JSON.stringify(parsed);
      } catch (_) { itemsVal = '{}'; }
    }

    // INSERT tkp
    const { rows: [newTkp] } = await db.query(`
      INSERT INTO tkp (
        subject, tender_id, work_id, pre_tender_id, link_type,
        customer_name, customer_inn, customer_address, work_description,
        contact_person, contact_phone, contact_email,
        items, total_sum, deadline, validity_days,
        source, status, parsed_from_attachment,
        purpose_reason, author_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      RETURNING *
    `, [
      subject,
      tenderId, workId, preTenderId, linkType,
      body.customer_name || null, body.customer_inn || null, body.customer_address || null,
      body.work_description || null,
      body.contact_person || null, body.contact_phone || null, body.contact_email || null,
      itemsVal,
      parseFloat(body.total_sum || 0) || 0,
      body.deadline || null,
      parseInt(body.validity_days || 30) || 30,
      'uploaded', 'sent',
      body.parsed_from_attachment === 'true' || body.parsed_from_attachment === true,
      body.purpose_reason || null,
      request.user.id
    ]);

    // Сохраняем файл на диск
    const ext       = pathLib.extname(fileInfo.filename || '').toLowerCase() || '.bin';
    const safeExt   = ext.replace(/[^a-z0-9.]/gi, '');
    const ts        = Date.now();
    const filename  = `tkp_ready_${newTkp.id}_${ts}${safeExt}`;
    const tkpDir    = pathLib.join(UPLOAD_DIR, 'tkp', 'ready');
    fsLib.mkdirSync(tkpDir, { recursive: true });
    const absPath   = pathLib.join(tkpDir, filename);
    const relPath   = pathLib.join('tkp', 'ready', filename);

    try {
      fsLib.writeFileSync(absPath, fileBuf);
    } catch (e) {
      request.log.error(e, '[TKP upload-ready] file save failed');
      return reply.code(500).send({ error: 'Не удалось сохранить файл на диск' });
    }

    // Обновляем attachment_* в tkp
    await db.query(`
      UPDATE tkp SET
        attachment_path = $1, attachment_mime = $2,
        attachment_original_name = $3, attachment_size = $4,
        updated_at = NOW()
      WHERE id = $5
    `, [relPath, fileInfo.mimetype, fileInfo.filename, fileBuf.length, newTkp.id]);

    // Вносим в documents (для единообразия с остальными файлами тендера)
    try {
      await db.query(`
        INSERT INTO documents (filename, original_name, mime_type, size, type, tender_id, uploaded_by, download_url, created_at)
        VALUES ($1, $2, $3, $4, 'tkp', $5, $6, $7, NOW())
      `, [
        pathLib.join('tkp', 'ready', filename),
        fileInfo.filename,
        fileInfo.mimetype,
        fileBuf.length,
        tenderId || null,
        request.user.id,
        `/uploads/tkp/ready/${filename}`
      ]);
    } catch (docErr) {
      request.log.warn('[TKP upload-ready] documents insert failed: ' + docErr.message);
    }

    // Если создавался из прямого запроса — проставляем обратную ссылку
    if (preTenderId) {
      await db.query(
        'UPDATE pre_tender_requests SET created_tkp_id = $1 WHERE id = $2 AND created_tkp_id IS NULL',
        [newTkp.id, preTenderId]
      );
    }

    const { rows: [full] } = await db.query('SELECT * FROM tkp WHERE id = $1', [newTkp.id]);
    return { item: full };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/tkp/:id/client-decision
  // Отметить решение клиента по ТКП.
  // При accepted/rejected + link_type='tender' → меняет tender_status.
  // При rejected + link_type='direct_request' → меняет pre_tender status.
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.post('/:id/client-decision', {
    preHandler: [fastify.requireRoles(EDIT_ROLES)]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const { decision, comment } = request.body || {};

    const VALID_DECISIONS = ['accepted', 'rejected', 'no_response'];
    if (!VALID_DECISIONS.includes(decision)) {
      return reply.code(400).send({ error: `decision должен быть одним из: ${VALID_DECISIONS.join(', ')}` });
    }

    const { rows: [tkp] } = await db.query('SELECT * FROM tkp WHERE id = $1', [id]);
    if (!tkp) return reply.code(404).send({ error: 'ТКП не найден' });

    // Обновляем ТКП
    const { rows: [updated] } = await db.query(`
      UPDATE tkp SET
        client_decision         = $1,
        client_decision_at      = NOW(),
        client_decision_by      = $2,
        client_decision_comment = $3,
        updated_at              = NOW()
      WHERE id = $4
      RETURNING *
    `, [decision, request.user.id, comment || null, id]);

    // Каскадные действия по типу связи
    if (tkp.link_type === 'tender' && tkp.tender_id) {
      if (decision === 'accepted') {
        await db.query(
          `UPDATE tenders SET tender_status = 'Выиграли', updated_at = NOW()
           WHERE id = $1 AND tender_status NOT IN ('Выиграли','Проиграли','Отменён')`,
          [tkp.tender_id]
        );
      } else if (decision === 'rejected') {
        await db.query(
          `UPDATE tenders SET tender_status = 'Проиграли', updated_at = NOW()
           WHERE id = $1 AND tender_status NOT IN ('Выиграли','Проиграли','Отменён')`,
          [tkp.tender_id]
        );
      }
    } else if (tkp.link_type === 'direct_request' && tkp.pre_tender_id && decision === 'rejected') {
      await db.query(
        `UPDATE pre_tender_requests SET status = 'rejected', decision_at = NOW(), decision_by = $1 WHERE id = $2`,
        [request.user.id, tkp.pre_tender_id]
      );
    }

    // Уведомляем автора ТКП
    if (tkp.author_id && tkp.author_id !== request.user.id) {
      const decisionLabels = { accepted: '✅ Принято клиентом', rejected: '❌ Отказ клиента', no_response: '⏳ Нет ответа' };
      createNotification(db, {
        user_id: tkp.author_id,
        title: decisionLabels[decision] || decision,
        message: `ТКП «${tkp.subject}»${comment ? ': ' + comment : ''}`,
        type: 'tkp',
        link: `#/tkp?id=${id}`
      });
    }

    // Аудит
    try {
      await db.query(
        `INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, details, created_at)
         VALUES ($1, 'tkp', $2, 'client_decision', $3, NOW())`,
        [request.user.id, id, JSON.stringify({ decision, comment, link_type: tkp.link_type })]
      );
    } catch (_) {}

    return { item: updated };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/tkp/followup
  // Реестр отправленных ТКП с агрегатом «последний контакт» для модуля TKP-Followup.
  // Дни без контакта = days since max(sent_at, последний log_call/log_email/decision из audit_log).
  // PM видит свои (author_id), руководство — все.
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.get('/followup', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { status_filter, limit = 200, offset = 0 } = request.query;
    const userRole = request.user.role;
    const userId   = request.user.id;

    const params = [];
    let idx = 1;
    let whereOwner = '';
    if (!SEE_ALL_ROLES.includes(userRole)) {
      whereOwner = ` AND t.author_id = $${idx++}`;
      params.push(userId);
    }

    // sent_at IS NOT NULL ИЛИ статус 'sent' — для совместимости со старыми записями,
    // которые могли быть отправлены вне нашего pipeline.
    const sql = `
      SELECT
        t.id, t.tkp_number, t.subject, t.customer_name, t.customer_inn,
        t.contact_person, t.contact_phone, t.contact_email,
        t.total_sum, t.status, t.sent_at, t.created_at,
        t.client_decision, t.client_decision_at, t.client_decision_comment,
        t.link_type, t.tender_id, t.pre_tender_id,
        u.name AS author_name,
        cdec.name AS client_decision_by_name,
        (
          SELECT GREATEST(
            COALESCE(t.sent_at, t.created_at),
            COALESCE((
              SELECT MAX(al.created_at)
              FROM audit_log al
              WHERE al.entity_type = 'tkp'
                AND al.entity_id = t.id
                AND al.action IN ('followup_call','followup_email','followup_meeting','followup_other','client_decision')
            ), TIMESTAMP 'epoch')
          )
        ) AS last_contact_at,
        (
          SELECT json_agg(row_to_json(x)) FROM (
            SELECT al.id, al.action, al.details, al.created_at,
                   COALESCE(au.name, 'system') AS actor_name
            FROM audit_log al
            LEFT JOIN users au ON au.id = al.actor_user_id
            WHERE al.entity_type = 'tkp' AND al.entity_id = t.id
              AND al.action IN ('followup_call','followup_email','followup_meeting','followup_other','client_decision','followup_note')
            ORDER BY al.created_at DESC
            LIMIT 20
          ) x
        ) AS followup_log
      FROM tkp t
      LEFT JOIN users u    ON u.id = t.author_id
      LEFT JOIN users cdec ON cdec.id = t.client_decision_by
      WHERE (t.sent_at IS NOT NULL OR t.status = 'sent')${whereOwner}
      ORDER BY COALESCE(t.sent_at, t.created_at) DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;
    params.push(Math.min(parseInt(limit), 500), parseInt(offset));

    const { rows } = await db.query(sql, params);

    // Постфильтр по «status_filter» (нужен_контакт / в_работе / решение / архив).
    const now = Date.now();
    const STALE_DAYS = 7;
    const enriched = rows.map((r) => {
      const lastTs = r.last_contact_at ? new Date(r.last_contact_at).getTime() : 0;
      const daysSince = lastTs ? Math.floor((now - lastTs) / 86400000) : null;
      // bucket
      let bucket = 'in_progress';
      if (r.client_decision === 'accepted' || r.client_decision === 'rejected') bucket = 'decided';
      else if (r.status === 'expired') bucket = 'archive';
      else if (daysSince != null && daysSince > STALE_DAYS) bucket = 'needs_contact';
      return { ...r, days_since_last_contact: daysSince, followup_bucket: bucket };
    });

    const filtered = status_filter ? enriched.filter((r) => r.followup_bucket === status_filter) : enriched;
    return { items: filtered, stats: {
      total: enriched.length,
      needs_contact: enriched.filter((r) => r.followup_bucket === 'needs_contact').length,
      in_progress:   enriched.filter((r) => r.followup_bucket === 'in_progress').length,
      decided:       enriched.filter((r) => r.followup_bucket === 'decided').length,
      archive:       enriched.filter((r) => r.followup_bucket === 'archive').length
    } };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/tkp/:id/followup
  // Залогировать контакт с клиентом (звонок / письмо / встреча / прочее)
  // или текстовую заметку. Записывается в audit_log.
  // body: { kind: 'call'|'email'|'meeting'|'other'|'note', comment }
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.post('/:id/followup', {
    preHandler: [fastify.requireRoles(EDIT_ROLES)]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const { kind, comment } = request.body || {};
    const VALID_KINDS = ['call', 'email', 'meeting', 'other', 'note'];
    if (!VALID_KINDS.includes(kind)) {
      return reply.code(400).send({ error: `kind должен быть одним из: ${VALID_KINDS.join(', ')}` });
    }
    const { rows: [tkp] } = await db.query('SELECT id, author_id, customer_name, subject FROM tkp WHERE id = $1', [id]);
    if (!tkp) return reply.code(404).send({ error: 'ТКП не найден' });

    // PM — только свои; SEE_ALL_ROLES — любые.
    if (!SEE_ALL_ROLES.includes(request.user.role) && tkp.author_id !== request.user.id) {
      return reply.code(403).send({ error: 'Можно логировать контакт только по своим ТКП' });
    }

    const action = 'followup_' + kind;
    const details = (comment || '').toString().slice(0, 2000);

    try {
      await db.query(
        `INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, details, created_at)
         VALUES ($1, 'tkp', $2, $3, $4, NOW())`,
        [request.user.id, id, action, details]
      );
    } catch (e) {
      return reply.code(500).send({ error: 'Не удалось записать событие: ' + e.message });
    }

    // Сообщим автору, если контакт залогировал не он сам.
    if (tkp.author_id && tkp.author_id !== request.user.id) {
      const labels = { call: '📞 звонок', email: '📧 письмо', meeting: '🤝 встреча', other: '✏️ контакт', note: '📝 заметка' };
      createNotification(db, {
        user_id: tkp.author_id,
        title: `Контакт по ТКП #${id}`,
        message: `${labels[kind] || kind}: ${tkp.customer_name || ''}${details ? ' — ' + details.slice(0, 120) : ''}`,
        type: 'tkp',
        link: `#/tkp-followup`
      });
    }

    return { success: true, kind, logged_at: new Date().toISOString() };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/tkp/:id/followup
  // История followup-событий по конкретному ТКП.
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.get('/:id/followup', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    const { rows: [tkp] } = await db.query('SELECT id, author_id FROM tkp WHERE id = $1', [id]);
    if (!tkp) return reply.code(404).send({ error: 'ТКП не найден' });
    if (!SEE_ALL_ROLES.includes(request.user.role) && tkp.author_id !== request.user.id) {
      return reply.code(403).send({ error: 'Доступ запрещён' });
    }
    const { rows } = await db.query(
      `SELECT al.id, al.action, al.details, al.created_at, u.name AS actor_name
         FROM audit_log al
         LEFT JOIN users u ON u.id = al.actor_user_id
        WHERE al.entity_type = 'tkp' AND al.entity_id = $1
          AND al.action IN ('followup_call','followup_email','followup_meeting','followup_other','followup_note','client_decision')
        ORDER BY al.created_at DESC`,
      [id]
    );
    return { items: rows };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/tkp/:id/attachment
  // Скачать оригинальный прикреплённый файл (только для ТКП с attachment_path).
  // Поддерживает ?token= как GET /:id/pdf.
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.get('/:id/attachment', {
    preHandler: [
      async (request, reply) => {
        if (!request.headers.authorization && request.query.token) {
          request.headers.authorization = 'Bearer ' + request.query.token;
        }
      },
      fastify.authenticate
    ]
  }, async (request, reply) => {
    const { rows: [tkp] } = await db.query('SELECT * FROM tkp WHERE id = $1', [request.params.id]);
    if (!tkp) return reply.code(404).send({ error: 'ТКП не найден' });
    if (!tkp.attachment_path) return reply.code(404).send({ error: 'Файл не прикреплён к этому ТКП' });

    const absPath = pathLib.resolve(UPLOAD_DIR, tkp.attachment_path);
    // Защита path-traversal: проверяем с trailing-sep чтобы /uploads_evil не прошёл как /uploads
    if (!absPath.startsWith(pathLib.resolve(UPLOAD_DIR) + pathLib.sep)) {
      return reply.code(403).send({ error: 'Доступ запрещён' });
    }

    if (!fsLib.existsSync(absPath)) {
      return reply.code(404).send({ error: 'Файл не найден на диске' });
    }

    const mime     = tkp.attachment_mime || 'application/octet-stream';
    const dispName = encodeURIComponent(tkp.attachment_original_name || pathLib.basename(tkp.attachment_path));
    reply.header('Content-Type', mime);
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${dispName}`);
    return reply.send(fsLib.createReadStream(absPath));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // БЛОЧНЫЙ ТКП-КОНСТРУКТОР (V237: tkp_blocks)
  // Был вынесен в отдельный tkp-constructor.js (~853 строки), теперь вмержен
  // обратно в tkp.js, чтобы не плодить файлы. Расширяет существующий /api/tkp.
  // ═══════════════════════════════════════════════════════════════════════════

  // SSE broadcast (мягкая зависимость — если sse.js нет, broadcast = no-op)
  let _sseBroadcast = () => {};
  try {
    const sseMod = require('./sse');
    if (sseMod && typeof sseMod.broadcast === 'function') _sseBroadcast = sseMod.broadcast;
  } catch (_) {}

  // Доступ к ТКП (автор / руководство / директора / ADMIN)
  function _canAccessTkp(user, tkpRow) {
    if (!tkpRow) return false;
    if (['ADMIN','HEAD_PM','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','HEAD_TO'].includes(user.role)) return true;
    return Number(tkpRow.author_id) === Number(user.id);
  }

  // Дефолтные ключи блоков по template_kind (универсальный набор + хим/монтаж/антикор/диагностика/вентиляция)
  function _defaultBlocksForKind(kind) {
    const base = ['title','preamble','smeta','terms','warranty','attach','sign'];
    switch ((kind || 'universal').toLowerCase()) {
      case 'chemcleaning':
        return ['title','preamble','smeta','terms','safety','warranty','logistics','team','attach','sign'];
      case 'assembly':
        return ['title','preamble','smeta','schedule','terms','warranty','logistics','team','safety','attach','sign'];
      case 'anticor':
        return ['title','preamble','smeta','terms','warranty','safety','attach','sign'];
      case 'diagnostics':
        return ['title','preamble','smeta','schedule','terms','warranty','attach','sign'];
      case 'vent':
        return ['title','preamble','smeta','terms','warranty','attach','sign'];
      case 'universal':
      default:
        return base;
    }
  }

  // Заголовок и иконка по ключу блока
  function _blockMeta(key) {
    const m = {
      title:    { title: 'Заголовок и шапка',      icon: '🛡', required: true  },
      preamble: { title: 'Преамбула / приветствие', icon: '📜', required: false },
      smeta:    { title: 'Смета',                   icon: '📊', required: false },
      terms:    { title: 'Условия и оплата',        icon: '💰', required: false },
      warranty: { title: 'Гарантии',                icon: '✅', required: false },
      logistics:{ title: 'Логистика и мобилизация', icon: '🚚', required: false },
      safety:   { title: 'Безопасность',            icon: '⚠️', required: false },
      schedule: { title: 'График работ',            icon: '🗓', required: false },
      team:     { title: 'Команда',                 icon: '👥', required: false },
      attach:   { title: 'Приложения',              icon: '📎', required: false },
      sign:     { title: 'Подпись',                 icon: '✒️', required: true  }
    };
    return m[key] || { title: key, icon: '◆', required: false };
  }

  // Дефолтные данные блока — пустой каркас (JSONB)
  function _defaultBlockData(key, ctx) {
    ctx = ctx || {};
    switch (key) {
      case 'title':
        return {
          company_name: ctx.company_name || 'ООО «Асгард-Сервис»',
          customer_name: ctx.customer_name || '',
          customer_inn: ctx.customer_inn || '',
          subject: ctx.subject || '',
          tkp_number: ctx.tkp_number || '',
          date: new Date().toISOString().slice(0, 10)
        };
      case 'preamble':
        return { text: '' };
      case 'smeta':
        // если есть estimate_draft — подставим items
        return {
          items: Array.isArray(ctx.items) ? ctx.items : [],
          vat_pct: ctx.vat_pct != null ? Number(ctx.vat_pct) : 20,
          subtotal: ctx.subtotal != null ? Number(ctx.subtotal) : null,
          total_with_vat: ctx.total_with_vat != null ? Number(ctx.total_with_vat) : null
        };
      case 'terms':
        return { payment_preset: 'avans_postpay', avans_pct: 30, postpay_days: 14, custom: '' };
      case 'warranty':
        return { months: 12, text: '' };
      case 'logistics':
        return { mobilization_days: null, demobilization_days: null, transport: '' };
      case 'safety':
        return { naks_required: false, snils_required: false, ppe_required: true, text: '' };
      case 'schedule':
        return { start_date: null, end_date: null, milestones: [] };
      case 'team':
        return { lead: '', members: [] };
      case 'attach':
        return { files: [] };
      case 'sign':
        return {
          author_name: ctx.author_name || '',
          author_position: ctx.author_position || 'Руководитель проекта',
          with_signature: false,
          with_stamp: false
        };
      default:
        return {};
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/tkp/from-card/:cardId — создать ТКП из карты канбана + дефолтные блоки
  // body: { template_kind? }
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.post('/from-card/:cardId', {
    preHandler: [fastify.requireRoles(EDIT_ROLES)]
  }, async (request, reply) => {
    const cardId = parseInt(request.params.cardId);
    if (!cardId || isNaN(cardId)) return reply.code(400).send({ error: 'Bad cardId' });
    const template_kind = (request.body && request.body.template_kind) || 'universal';

    // 1) Карта канбана
    const { rows: cardRows } = await db.query(
      `SELECT id, owner_user_id, flow_type, entity_kind, entity_id, current_main_status
         FROM personal_kanban_cards
        WHERE id = $1`,
      [cardId]
    );
    if (!cardRows[0]) return reply.code(404).send({ error: 'Card not found' });
    const card = cardRows[0];

    // 2) Источник: тендер или pre-тендер — для prefill контактов
    let tenderId = null, preTenderId = null, workId = null;
    let prefill = { customer_name: null, customer_inn: null, customer_address: null,
                    contact_person: null, contact_phone: null, contact_email: null,
                    subject: null, work_description: null };
    if (card.entity_kind === 'tender' || card.flow_type === 'tender') {
      tenderId = card.entity_id;
      try {
        const r = await db.query(
          `SELECT customer_name, customer_inn, tender_title, customer_address,
                  contact_name AS contact_person, contact_phone, contact_email
             FROM tenders WHERE id = $1`,
          [tenderId]
        );
        if (r.rows[0]) {
          prefill.customer_name    = r.rows[0].customer_name;
          prefill.customer_inn     = r.rows[0].customer_inn;
          prefill.customer_address = r.rows[0].customer_address;
          prefill.contact_person   = r.rows[0].contact_person;
          prefill.contact_phone    = r.rows[0].contact_phone;
          prefill.contact_email    = r.rows[0].contact_email;
          prefill.subject          = r.rows[0].tender_title;
        }
      } catch (_) {}
    } else if (card.entity_kind === 'pre_tender' || card.flow_type === 'pre_tender') {
      preTenderId = card.entity_id;
      try {
        // FIX B1: реальные колонки pre_tender_requests (V001:1076-1106):
        //   work_description (НЕ request_description), customer_email (НЕТ contact_email).
        const r = await db.query(
          `SELECT customer_name, customer_inn, work_description, work_location,
                  contact_person, contact_phone, customer_email, estimated_sum
             FROM pre_tender_requests WHERE id = $1`,
          [preTenderId]
        );
        if (r.rows[0]) {
          prefill.customer_name    = r.rows[0].customer_name;
          prefill.customer_inn     = r.rows[0].customer_inn;
          prefill.contact_person   = r.rows[0].contact_person;
          prefill.contact_phone    = r.rows[0].contact_phone;
          prefill.contact_email    = r.rows[0].customer_email;
          prefill.subject          = (r.rows[0].work_description || '').slice(0, 200) || null;
          prefill.work_description = r.rows[0].work_description;
          prefill.work_location    = r.rows[0].work_location;
          prefill.estimated_sum    = r.rows[0].estimated_sum;
        }
      } catch (e) { console.warn('[tkp from-card] pre_tender prefill error:', e.message); }
    } else if (card.entity_kind === 'work' || card.flow_type === 'work') {
      workId = card.entity_id;
    }

    // 3) Прежняя сессия tkp_quick_sessions (finalized) → prefill блока smeta
    let smetaPrefill = null;
    try {
      const q = await db.query(
        `SELECT estimate_draft
           FROM tkp_quick_sessions
          WHERE author_id = $1
            AND status = 'finalized'
            AND ( (pre_tender_id IS NOT NULL AND pre_tender_id = $2)
               OR (tender_id     IS NOT NULL AND tender_id     = $3) )
          ORDER BY finalized_at DESC NULLS LAST, id DESC
          LIMIT 1`,
        [request.user.id, preTenderId, tenderId]
      );
      if (q.rows[0] && q.rows[0].estimate_draft) {
        const ed = typeof q.rows[0].estimate_draft === 'string'
          ? JSON.parse(q.rows[0].estimate_draft)
          : q.rows[0].estimate_draft;
        if (ed && (Array.isArray(ed.items) || Array.isArray(ed.rows))) {
          smetaPrefill = {
            items: ed.items || ed.rows || [],
            vat_pct: ed.vat_pct || 20,
            subtotal: ed.subtotal || null,
            total_with_vat: ed.total_with_vat || null
          };
        }
      }
    } catch (_) {}

    // 4) RBAC: PM может создать ТКП только для своего тендера
    try {
      await assertCanCreateTkpForTender(db, request.user, tenderId);
    } catch (err) {
      return reply.code(err.statusCode || 500).send({ error: err.message });
    }

    // 22.06.2026: ANTI-DUPL — если уже есть draft ТКП для этой заявки/тендера
    // от этого автора, возвращаем существующий (а не клепаем новый каждый клик).
    // Раньше каждое нажатие "Конструктор ТКП" создавало дубль (поймано на #968 — 9 дублей).
    try {
      const existing = await db.query(
        `SELECT * FROM tkp
          WHERE author_id = $1
            AND status = 'draft'
            AND ( (pre_tender_id IS NOT NULL AND pre_tender_id = $2)
               OR (tender_id     IS NOT NULL AND tender_id     = $3) )
          ORDER BY id DESC LIMIT 1`,
        [request.user.id, preTenderId, tenderId]);
      if (existing.rows[0]) {
        return { item: existing.rows[0], template_kind: existing.rows[0].template_kind || template_kind, blocks_created: 0, reused: true };
      }
    } catch (_) { /* не критично, идём в insert */ }

    // 5) Транзакция: INSERT tkp + дефолтные блоки
    const client = await db.pool.connect();
    let newTkp;
    try {
      await client.query('BEGIN');

      const subj = prefill.subject || 'Технико-коммерческое предложение';
      const linkType =
        tenderId    ? 'tender'         :
        preTenderId ? 'direct_request' :
        workId      ? 'work'           : 'standalone';

      const insRes = await client.query(`
        INSERT INTO tkp (
          subject, tender_id, work_id, pre_tender_id, link_type,
          customer_name, customer_inn, customer_address, work_description,
          contact_person, contact_phone, contact_email,
          items, total_sum, validity_days,
          author_id, source, status,
          template_kind, constructor_version, last_autosaved_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9,
          $10, $11, $12,
          '{}'::jsonb, 0, 30,
          $13, 'kanban_constructor', 'draft',
          $14, 1, NOW()
        ) RETURNING *
      `, [
        subj, tenderId, workId, preTenderId, linkType,
        prefill.customer_name, prefill.customer_inn, prefill.customer_address, prefill.work_description,
        prefill.contact_person, prefill.contact_phone, prefill.contact_email,
        request.user.id,
        template_kind
      ]);
      newTkp = insRes.rows[0];

      // Дефолтные блоки
      const keys = _defaultBlocksForKind(template_kind);
      let order = 100;
      for (const key of keys) {
        const meta = _blockMeta(key);
        const ctx = {
          company_name: 'ООО «Асгард-Сервис»',
          customer_name: prefill.customer_name,
          customer_inn:  prefill.customer_inn,
          subject:       subj,
          author_name:   request.user.name || '',
          ...(key === 'smeta' && smetaPrefill ? smetaPrefill : {})
        };
        const data = _defaultBlockData(key, ctx);
        await client.query(`
          INSERT INTO tkp_blocks
            (tkp_id, block_key, block_order, block_title, block_icon, block_data, is_required, is_active)
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, TRUE)
        `, [
          newTkp.id, key, order, meta.title, meta.icon,
          JSON.stringify(data), meta.required
        ]);
        order += 100;
      }

      await client.query('COMMIT');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      request.log.error({ err: e }, '[TKP from-card] failed');
      return reply.code(500).send({ error: 'from_card_failed', message: e.message });
    } finally {
      client.release();
    }

    try {
      _sseBroadcast('tkp_constructor:created', {
        tkp_id: newTkp.id, card_id: cardId,
        template_kind, author_id: request.user.id,
        tender_id: tenderId, pre_tender_id: preTenderId
      });
    } catch (_) {}

    return { item: newTkp, template_kind, blocks_created: _defaultBlocksForKind(template_kind).length };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/tkp/:tkpId/blocks — список активных блоков
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.get('/:tkpId/blocks', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const tkpId = parseInt(request.params.tkpId);
    if (!tkpId || isNaN(tkpId)) return reply.code(400).send({ error: 'Bad tkpId' });

    const { rows: tkpRows } = await db.query('SELECT id, author_id FROM tkp WHERE id = $1', [tkpId]);
    if (!tkpRows[0]) return reply.code(404).send({ error: 'TKP not found' });
    if (!_canAccessTkp(request.user, tkpRows[0])) {
      return reply.code(403).send({ error: 'Доступ запрещён' });
    }

    const { rows } = await db.query(
      `SELECT id, tkp_id, block_key, block_order, block_title, block_icon,
              block_data, is_required, is_active, created_at, updated_at
         FROM tkp_blocks
        WHERE tkp_id = $1 AND is_active = TRUE
        ORDER BY block_order ASC, id ASC`,
      [tkpId]
    );
    return { items: rows };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PUT /api/tkp/:tkpId/blocks — UPSERT блоков (autosave)
  // body: { blocks: [ { block_key, block_order?, block_title?, block_icon?, block_data, is_required?, is_active? }, ... ] }
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.put('/:tkpId/blocks', {
    preHandler: [fastify.requireRoles(EDIT_ROLES)]
  }, async (request, reply) => {
    const tkpId = parseInt(request.params.tkpId);
    if (!tkpId || isNaN(tkpId)) return reply.code(400).send({ error: 'Bad tkpId' });

    const blocks = (request.body && Array.isArray(request.body.blocks)) ? request.body.blocks : null;
    if (!blocks) return reply.code(400).send({ error: 'blocks[] required' });

    const { rows: tkpRows } = await db.query('SELECT id, author_id FROM tkp WHERE id = $1', [tkpId]);
    if (!tkpRows[0]) return reply.code(404).send({ error: 'TKP not found' });
    if (!_canAccessTkp(request.user, tkpRows[0])) {
      return reply.code(403).send({ error: 'Доступ запрещён' });
    }

    // Транзакция: для каждого блока — SELECT-then-UPDATE/INSERT (без ON CONFLICT,
    // чтобы корректно работать с partial unique index uq_tkp_blocks_tkp_key_active).
    const client = await db.pool.connect();
    const upserted = [];
    try {
      await client.query('BEGIN');

      for (const b of blocks) {
        const key = String(b.block_key || '').trim();
        if (!key) continue;
        const meta = _blockMeta(key);
        const order = b.block_order != null ? Number(b.block_order) : 1000;
        const title = b.block_title != null ? String(b.block_title) : meta.title;
        const icon  = b.block_icon  != null ? String(b.block_icon)  : meta.icon;
        const data  = b.block_data != null ? b.block_data : {};
        const isReq = b.is_required != null ? !!b.is_required : meta.required;
        const isActive = b.is_active != null ? !!b.is_active : true;

        // Найти существующий активный блок (по partial unique)
        const ex = await client.query(
          `SELECT id FROM tkp_blocks
            WHERE tkp_id = $1 AND block_key = $2 AND is_active = TRUE
            LIMIT 1 FOR UPDATE`,
          [tkpId, key]
        );
        if (ex.rows[0]) {
          const upd = await client.query(
            `UPDATE tkp_blocks
                SET block_order  = $1,
                    block_title  = $2,
                    block_icon   = $3,
                    block_data   = $4::jsonb,
                    is_required  = $5,
                    is_active    = $6,
                    updated_at   = NOW()
              WHERE id = $7
              RETURNING *`,
            [order, title, icon, JSON.stringify(data), isReq, isActive, ex.rows[0].id]
          );
          upserted.push(upd.rows[0]);
        } else {
          const ins = await client.query(
            `INSERT INTO tkp_blocks
               (tkp_id, block_key, block_order, block_title, block_icon, block_data, is_required, is_active)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
             RETURNING *`,
            [tkpId, key, order, title, icon, JSON.stringify(data), isReq, isActive]
          );
          upserted.push(ins.rows[0]);
        }
      }

      // Обновим ТКП: last_autosaved_at и constructor_version++
      const upd = await client.query(
        `UPDATE tkp
            SET last_autosaved_at   = NOW(),
                constructor_version = COALESCE(constructor_version, 1) + 1,
                updated_at          = NOW()
          WHERE id = $1
          RETURNING constructor_version, last_autosaved_at`,
        [tkpId]
      );

      await client.query('COMMIT');

      try {
        _sseBroadcast('tkp_constructor:updated', {
          tkp_id: tkpId,
          version: upd.rows[0] ? upd.rows[0].constructor_version : null,
          last_autosaved_at: upd.rows[0] ? upd.rows[0].last_autosaved_at : null,
          author_id: request.user.id,
          block_keys: upserted.map(x => x.block_key)
        });
      } catch (_) {}

      return {
        items: upserted,
        constructor_version: upd.rows[0] ? upd.rows[0].constructor_version : null,
        last_autosaved_at:   upd.rows[0] ? upd.rows[0].last_autosaved_at   : null
      };
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      request.log.error({ err: e }, '[TKP put blocks] failed');
      return reply.code(500).send({ error: 'blocks_upsert_failed', message: e.message });
    } finally {
      client.release();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/tkp/:tkpId/attach-to-card/:cardId
  // Зарегистрировать PDF-файл ТКП в documents и привязать к тендеру карты.
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.post('/:tkpId/attach-to-card/:cardId', {
    preHandler: [fastify.requireRoles(EDIT_ROLES)]
  }, async (request, reply) => {
    const tkpId  = parseInt(request.params.tkpId);
    const cardId = parseInt(request.params.cardId);
    if (!tkpId || !cardId || isNaN(tkpId) || isNaN(cardId)) {
      return reply.code(400).send({ error: 'Bad ids' });
    }

    const { rows: tkpRows } = await db.query(
      `SELECT id, author_id, pdf_path, subject FROM tkp WHERE id = $1`, [tkpId]
    );
    if (!tkpRows[0]) return reply.code(404).send({ error: 'TKP not found' });
    if (!_canAccessTkp(request.user, tkpRows[0])) {
      return reply.code(403).send({ error: 'Доступ запрещён' });
    }
    const tkp = tkpRows[0];
    if (!tkp.pdf_path) {
      return reply.code(400).send({ error: 'PDF не сгенерирован для этого ТКП. Сначала вызовите /render-pdf' });
    }

    const { rows: cardRows } = await db.query(
      `SELECT id, flow_type, entity_kind, entity_id FROM personal_kanban_cards WHERE id = $1`,
      [cardId]
    );
    if (!cardRows[0]) return reply.code(404).send({ error: 'Card not found' });
    const card = cardRows[0];
    let tenderId = null;
    if (card.entity_kind === 'tender' || card.flow_type === 'tender') {
      tenderId = card.entity_id;
    }

    const pdfBase = pathLib.basename(tkp.pdf_path);
    const downloadUrl = `/uploads/${tkp.pdf_path.replace(/^[\\\/]+/, '')}`;

    // Попытка узнать реальный размер файла на диске (мягко)
    let sizeBytes = 0;
    try {
      const abs = pathLib.resolve(UPLOAD_DIR, tkp.pdf_path);
      if (fsLib.existsSync(abs)) sizeBytes = fsLib.statSync(abs).size;
    } catch (_) {}

    const { rows: docRows } = await db.query(`
      INSERT INTO documents (filename, original_name, mime_type, size, type, tender_id, uploaded_by, download_url, created_at)
      VALUES ($1, $2, 'application/pdf', $3, 'tkp', $4, $5, $6, NOW())
      RETURNING id, filename, download_url
    `, [
      pdfBase,
      `ТКП_${tkpId}.pdf`,
      sizeBytes,
      tenderId,
      request.user.id,
      downloadUrl
    ]);

    try {
      _sseBroadcast('personal_kanban:card_document_added', {
        card_id: cardId,
        owner_user_id: card.entity_id ? null : null,
        document_id: docRows[0] ? docRows[0].id : null,
        tkp_id: tkpId,
        filename: pdfBase
      });
    } catch (_) {}

    return { success: true, document: docRows[0], tender_id: tenderId };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/tkp/:cardId/send-tkp-to-client
  // Отправить ТКП клиенту через crm-mailer + перевод карты в "КП отправлено".
  // body: { tkp_id, to, cc?, subject, body_text, body_html?, attach_pdf, attach_estimate?, extra_files? }
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.post('/:cardId/send-tkp-to-client', {
    preHandler: [fastify.requireRoles(EDIT_ROLES)]
  }, async (request, reply) => {
    const cardId = parseInt(request.params.cardId);
    if (!cardId || isNaN(cardId)) return reply.code(400).send({ error: 'Bad cardId' });

    const b = request.body || {};
    const tkpId = parseInt(b.tkp_id);
    if (!tkpId || isNaN(tkpId)) return reply.code(400).send({ error: 'tkp_id required' });
    const to = b.to;
    if (!to) return reply.code(400).send({ error: 'to required' });
    const subject = String(b.subject || '').trim();
    if (!subject) return reply.code(400).send({ error: 'subject required' });
    const bodyText = String(b.body_text || '').trim();
    const bodyHtml = b.body_html ? String(b.body_html) : null;
    if (!bodyText && !bodyHtml) return reply.code(400).send({ error: 'body_text or body_html required' });

    // ТКП
    const { rows: tkpRows } = await db.query(
      `SELECT id, author_id, pdf_path, attachment_path, tender_id, subject AS tkp_subject
         FROM tkp WHERE id = $1`,
      [tkpId]
    );
    if (!tkpRows[0]) return reply.code(404).send({ error: 'TKP not found' });
    if (!_canAccessTkp(request.user, tkpRows[0])) {
      return reply.code(403).send({ error: 'Доступ запрещён' });
    }
    const tkp = tkpRows[0];

    // Карта
    const { rows: cardRows } = await db.query(
      `SELECT id, owner_user_id, flow_type, entity_kind, entity_id, current_main_status, current_substage_id, version
         FROM personal_kanban_cards WHERE id = $1`,
      [cardId]
    );
    if (!cardRows[0]) return reply.code(404).send({ error: 'Card not found' });
    const card = cardRows[0];

    // Собираем вложения
    const attachments = [];
    const absUploadDir = pathLib.resolve(UPLOAD_DIR);

    // PDF ТКП
    if (b.attach_pdf !== false && tkp.pdf_path) {
      try {
        const abs = pathLib.resolve(absUploadDir, tkp.pdf_path);
        if (abs.startsWith(absUploadDir + pathLib.sep) && fsLib.existsSync(abs)) {
          attachments.push({
            filename: `ТКП_${tkp.id}.pdf`,
            content: fsLib.readFileSync(abs),
            contentType: 'application/pdf'
          });
        }
      } catch (e) {
        request.log.warn(`[TKP send-to-client] pdf read failed: ${e.message}`);
      }
    }

    // Оригинальный attachment (если есть и запрошен в extra_files / attach_estimate)
    if (b.attach_estimate === true && tkp.attachment_path) {
      try {
        const abs = pathLib.resolve(absUploadDir, tkp.attachment_path);
        if (abs.startsWith(absUploadDir + pathLib.sep) && fsLib.existsSync(abs)) {
          attachments.push({
            filename: pathLib.basename(tkp.attachment_path),
            content: fsLib.readFileSync(abs)
          });
        }
      } catch (e) {
        request.log.warn(`[TKP send-to-client] estimate read failed: ${e.message}`);
      }
    }

    // Произвольные файлы (массив относительных путей внутри UPLOAD_DIR)
    if (Array.isArray(b.extra_files)) {
      for (const rel of b.extra_files) {
        if (!rel || typeof rel !== 'string') continue;
        try {
          const abs = pathLib.resolve(absUploadDir, rel);
          // path-traversal guard: с trailing-sep
          if (!abs.startsWith(absUploadDir + pathLib.sep)) {
            request.log.warn(`[TKP send-to-client] path-traversal blocked: ${rel}`);
            continue;
          }
          if (!fsLib.existsSync(abs)) continue;
          attachments.push({
            filename: pathLib.basename(rel),
            content: fsLib.readFileSync(abs)
          });
        } catch (e) {
          request.log.warn(`[TKP send-to-client] extra_file read failed: ${e.message}`);
        }
      }
    }

    // Отправка через CRM Mailer
    const crmMailer = require('../services/crm-mailer');
    try {
      await crmMailer.sendCrmEmail(db.pool || db, request.user.id, {
        to,
        cc: b.cc || undefined,
        subject,
        text: bodyText,
        html: bodyHtml || undefined,
        attachments
      });
    } catch (e) {
      request.log.error({ err: e }, '[TKP send-to-client] mailer failed');
      return reply.code(500).send({ error: 'send_failed', message: e.message });
    }

    // Обновляем ТКП
    await db.query(
      `UPDATE tkp
          SET status        = 'sent',
              sent_at       = COALESCE(sent_at, NOW()),
              sent_by       = $1,
              contact_email = COALESCE(contact_email, $2),
              updated_at    = NOW()
        WHERE id = $3`,
      [request.user.id, Array.isArray(to) ? to[0] : to, tkpId]
    );

    // Если тендер — обновляем tenders.kp_sent_at и tender_status
    if (tkp.tender_id) {
      try {
        await db.query(
          `UPDATE tenders
              SET kp_sent_at    = NOW(),
                  tender_status = 'КП отправлено',
                  updated_at    = NOW()
            WHERE id = $1
              AND tender_status IN ('Готово к отправке КП','ТКП согласовано','Согласование ТКП')`,
          [tkp.tender_id]
        );
      } catch (_) {}
    }

    // Перевод карты в main_status 'КП отправлено' (для tender-flow) — мягко, в отдельной транзакции.
    let cardMoved = false;
    if (card.flow_type === 'tender') {
      try {
        await db.query(
          `UPDATE personal_kanban_cards
              SET current_main_status = 'КП отправлено',
                  current_substage_id = NULL,
                  last_moved_at       = NOW(),
                  version             = version + 1,
                  updated_at          = NOW()
            WHERE id = $1`,
          [cardId]
        );
        // History
        try {
          await db.query(
            `INSERT INTO personal_kanban_card_history
               (card_id, from_substage_id, to_substage_id, from_main_status, to_main_status, moved_by, action)
             VALUES ($1, $2, NULL, $3, 'КП отправлено', $4, 'tkp_sent')`,
            [cardId, card.current_substage_id, card.current_main_status, request.user.id]
          );
        } catch (_) {}
        cardMoved = true;
      } catch (e) {
        request.log.warn(`[TKP send-to-client] card move failed: ${e.message}`);
      }
    }

    try {
      _sseBroadcast('tkp_constructor:sent', {
        tkp_id: tkpId,
        card_id: cardId,
        to: Array.isArray(to) ? to[0] : to,
        sent_by: request.user.id,
        card_moved: cardMoved
      });
    } catch (_) {}

    // Уведомим автора, если отправил не он
    if (tkp.author_id && tkp.author_id !== request.user.id) {
      createNotification(db, {
        user_id: tkp.author_id,
        title: '📨 ТКП отправлено клиенту',
        message: `«${tkp.tkp_subject || ('ТКП #' + tkpId)}» → ${Array.isArray(to) ? to[0] : to}`,
        type: 'tkp',
        link: `#/tkp?id=${tkpId}`
      });
    }

    return { success: true, tkp_id: tkpId, card_id: cardId, card_moved: cardMoved };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/tkp/:tkpId/render-pdf
  // Рендер PDF из блоков (если есть) ИЛИ из items JSONB (обратная совместимость).
  // Сохраняет PDF в uploads/tkp/ и обновляет tkp.pdf_path.
  // body: { signature?, stamp? }
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.post('/:tkpId/render-pdf', {
    preHandler: [fastify.requireRoles(EDIT_ROLES)]
  }, async (request, reply) => {
    const tkpId = parseInt(request.params.tkpId);
    if (!tkpId || isNaN(tkpId)) return reply.code(400).send({ error: 'Bad tkpId' });

    const { rows: tkpRows } = await db.query(
      `SELECT t.*, te.tender_title AS tender_number
         FROM tkp t
         LEFT JOIN tenders te ON t.tender_id = te.id
        WHERE t.id = $1`,
      [tkpId]
    );
    if (!tkpRows[0]) return reply.code(404).send({ error: 'TKP not found' });
    if (!_canAccessTkp(request.user, tkpRows[0])) {
      return reply.code(403).send({ error: 'Доступ запрещён' });
    }
    const tkp = tkpRows[0];

    const b = request.body || {};
    const pdfOpts = {
      signature: b.signature === true || b.signature === '1',
      stamp:     b.stamp     === true || b.stamp     === '1'
    };

    // 1) Проверим — есть ли блоки конструктора?
    const blocksRes = await db.query(
      `SELECT block_key, block_order, block_title, block_icon, block_data
         FROM tkp_blocks
        WHERE tkp_id = $1 AND is_active = TRUE
        ORDER BY block_order ASC, id ASC`,
      [tkpId]
    );
    const blocks = blocksRes.rows;

    let pdfBuffer = null;

    if (blocks.length > 0) {
      // Рендер из блоков: HTML → puppeteer (если доступен), иначе — мерж в items JSONB и старый PDFKit-рендер.
      try {
        const html = _renderBlocksHtml(tkp, blocks);
        if (pdfGenerator && pdfGenerator.htmlToPdfBuffer) {
          // если есть универсальный HTML→PDF — используем
          pdfBuffer = await pdfGenerator.htmlToPdfBuffer(html, { format: 'A4' });
        } else {
          // inline-адаптер: запускаем puppeteer прямо здесь
          pdfBuffer = await _htmlToPdfInline(html, fastify);
        }
      } catch (err) {
        fastify.log.warn(`[TKP render-pdf] blocks→html→pdf failed: ${err.message}, fallback to items-based PDFKit`);
      }

      // Если puppeteer упал — fallback: сольём smeta-блок в tkp.items и сгенерим PDFKit
      if (!pdfBuffer) {
        const smetaBlock = blocks.find(x => x.block_key === 'smeta');
        const synthTkp = Object.assign({}, tkp);
        if (smetaBlock && smetaBlock.block_data) {
          const sd = typeof smetaBlock.block_data === 'string'
            ? JSON.parse(smetaBlock.block_data) : smetaBlock.block_data;
          synthTkp.items = JSON.stringify({
            items: Array.isArray(sd.items) ? sd.items : [],
            vat_pct: sd.vat_pct != null ? sd.vat_pct : 20,
            subtotal: sd.subtotal || null,
            total_with_vat: sd.total_with_vat || null
          });
        }
        pdfBuffer = await generateTkpPdfKit(synthTkp, db, pdfOpts);
      }
    } else {
      // Старый путь: блоков нет — рендерим как раньше (puppeteer → PDFKit fallback)
      if (pdfGenerator) {
        try { pdfBuffer = await pdfGenerator.generateTkpPdf(tkp.id, pdfOpts); }
        catch (err) {
          fastify.log.warn(`[TKP render-pdf] Puppeteer failed for TKP ${tkp.id}: ${err.message}`);
          pdfBuffer = null;
        }
      }
      if (!pdfBuffer) {
        pdfBuffer = await generateTkpPdfKit(tkp, db, pdfOpts);
      }
    }

    // Сохраняем PDF на диск + обновляем tkp.pdf_path
    const pdfDir = pathLib.join(UPLOAD_DIR, 'tkp');
    fsLib.mkdirSync(pdfDir, { recursive: true });
    const filename = `tkp_${tkp.id}_${Date.now()}.pdf`;
    fsLib.writeFileSync(pathLib.join(pdfDir, filename), pdfBuffer);
    await db.query('UPDATE tkp SET pdf_path = $1, updated_at = NOW() WHERE id = $2',
      [`tkp/${filename}`, tkp.id]);

    return {
      success: true,
      tkp_id: tkp.id,
      pdf_path: `tkp/${filename}`,
      download_url: `/uploads/tkp/${filename}`,
      bytes: pdfBuffer.length,
      rendered_from: blocks.length > 0 ? 'blocks' : 'legacy_items'
    };
  });

};

// ═══════════════════════════════════════════════════════════════════════════
// Хелперы блочного рендера (вне routes — чтобы не плодить closure)
// ═══════════════════════════════════════════════════════════════════════════

function _escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _fmtMoneyHtml(n) {
  const v = Number(n || 0);
  return v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// HTML-рендер набора блоков. Возвращает полную страницу для puppeteer.
function _renderBlocksHtml(tkp, blocks) {
  const parts = [];
  for (const b of blocks) {
    const data = (typeof b.block_data === 'string') ? (JSON.parse(b.block_data || '{}')) : (b.block_data || {});
    parts.push(_renderBlock(b.block_key, data, tkp));
  }
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<title>${_escapeHtml(tkp.subject || 'ТКП')}</title>
<style>
  @page { size: A4; margin: 18mm 15mm; }
  body { font-family: 'Segoe UI','DejaVu Sans',Arial,sans-serif; font-size: 10.5pt; color:#1a1a1a; line-height:1.45; }
  h1,h2,h3 { color:#1E4D8C; margin:0 0 8px; }
  h1 { font-size: 18pt; text-align:center; }
  h2 { font-size: 13pt; margin-top: 14px; border-bottom: 1px solid #E5E7EB; padding-bottom: 4px; }
  .muted { color:#6B7280; }
  .row { margin: 4px 0; }
  table { width:100%; border-collapse: collapse; margin: 8px 0; }
  th, td { border:1px solid #D1D5DB; padding: 5px 8px; font-size: 9.5pt; }
  th { background:#1E4D8C; color:#fff; text-align: center; }
  td.num { text-align: right; }
  .totals { width: 50%; margin-left: auto; }
  .totals td { border:none; padding: 3px 8px; }
  .totals .grand { border-top:2px solid #1E4D8C; font-weight:700; color:#1E4D8C; font-size:12pt; }
  .block { margin-top: 14px; }
  .sign { margin-top: 32px; display:flex; justify-content: space-between; }
</style></head><body>
${parts.join('\n')}
</body></html>`;
}

function _renderBlock(key, d, tkp) {
  switch (key) {
    case 'title': {
      const cust = d.customer_name || tkp.customer_name || '';
      const inn  = d.customer_inn  || tkp.customer_inn  || '';
      const subj = d.subject       || tkp.subject       || '';
      const num  = d.tkp_number    || tkp.tkp_number    || ('№ ' + tkp.id);
      const date = d.date          || (tkp.created_at ? new Date(tkp.created_at).toLocaleDateString('ru-RU') : new Date().toLocaleDateString('ru-RU'));
      return `<div class="block">
        <h1>КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ</h1>
        <div class="muted" style="text-align:center;">${_escapeHtml(num)} от ${_escapeHtml(date)}</div>
        <div class="row"><b>Заказчик:</b> ${_escapeHtml(cust)}${inn ? ' (ИНН ' + _escapeHtml(inn) + ')' : ''}</div>
        <div class="row"><b>Предмет:</b> ${_escapeHtml(subj)}</div>
      </div>`;
    }
    case 'preamble':
      return d.text
        ? `<div class="block"><h2>Преамбула</h2><div>${_escapeHtml(d.text).replace(/\n/g, '<br>')}</div></div>`
        : '';
    case 'smeta': {
      const items = Array.isArray(d.items) ? d.items : [];
      const vatPct = d.vat_pct != null ? Number(d.vat_pct) : 20;
      let subtotal = 0;
      const rows = items.map((it, i) => {
        const qty = Number(it.qty || it.quantity || 1);
        const price = Number(it.price || it.unit_price || 0);
        const total = Number(it.total != null ? it.total : (qty * price));
        subtotal += total;
        return `<tr>
          <td style="text-align:center;">${i + 1}</td>
          <td>${_escapeHtml(it.name || '')}</td>
          <td style="text-align:center;">${_escapeHtml(it.unit || 'усл.')}</td>
          <td class="num">${qty.toLocaleString('ru-RU')}</td>
          <td class="num">${_fmtMoneyHtml(price)}</td>
          <td class="num">${_fmtMoneyHtml(total)}</td>
        </tr>`;
      }).join('');
      const subTotal = d.subtotal != null ? Number(d.subtotal) : subtotal;
      const vatSum   = Math.round(subTotal * vatPct) / 100;
      const grand    = d.total_with_vat != null ? Number(d.total_with_vat) : (subTotal + vatSum);
      return `<div class="block">
        <h2>Состав работ и стоимость</h2>
        <table>
          <thead><tr>
            <th style="width:6%;">№</th><th>Наименование</th>
            <th style="width:8%;">Ед.</th><th style="width:9%;">Кол.</th>
            <th style="width:15%;">Цена, ₽</th><th style="width:17%;">Сумма, ₽</th>
          </tr></thead>
          <tbody>${rows || ''}</tbody>
        </table>
        <table class="totals">
          <tr><td>Итого без НДС:</td><td class="num">${_fmtMoneyHtml(subTotal)} ₽</td></tr>
          <tr><td>НДС ${vatPct}%:</td><td class="num">${_fmtMoneyHtml(vatSum)} ₽</td></tr>
          <tr class="grand"><td>ИТОГО:</td><td class="num">${_fmtMoneyHtml(grand)} ₽</td></tr>
        </table>
      </div>`;
    }
    case 'terms': {
      const lines = [];
      if (d.payment_preset || d.avans_pct != null || d.postpay_days != null || d.custom) {
        const parts = [];
        if (d.avans_pct != null) parts.push(`аванс ${d.avans_pct}%`);
        if (d.postpay_days != null) parts.push(`постоплата в течение ${d.postpay_days} дн.`);
        if (d.custom) parts.push(String(d.custom));
        if (parts.length) lines.push(`<div class="row"><b>Условия оплаты:</b> ${_escapeHtml(parts.join(', '))}</div>`);
      }
      if (tkp.validity_days) lines.push(`<div class="row"><b>Срок действия:</b> ${tkp.validity_days} дн.</div>`);
      if (tkp.deadline)      lines.push(`<div class="row"><b>Срок исполнения:</b> ${_escapeHtml(tkp.deadline)}</div>`);
      if (!lines.length) return '';
      return `<div class="block"><h2>Условия</h2>${lines.join('')}</div>`;
    }
    case 'warranty': {
      const months = d.months != null ? Number(d.months) : null;
      const txt = d.text || '';
      if (!months && !txt) return '';
      return `<div class="block"><h2>Гарантии</h2>
        ${months ? `<div class="row">Гарантийный срок: <b>${months} мес.</b></div>` : ''}
        ${txt ? `<div class="row">${_escapeHtml(txt).replace(/\n/g, '<br>')}</div>` : ''}
      </div>`;
    }
    case 'logistics': {
      const lines = [];
      if (d.mobilization_days   != null) lines.push(`<div class="row">Мобилизация: ${Number(d.mobilization_days)} дн.</div>`);
      if (d.demobilization_days != null) lines.push(`<div class="row">Демобилизация: ${Number(d.demobilization_days)} дн.</div>`);
      if (d.transport)                    lines.push(`<div class="row">Транспорт: ${_escapeHtml(d.transport)}</div>`);
      return lines.length ? `<div class="block"><h2>Логистика</h2>${lines.join('')}</div>` : '';
    }
    case 'safety': {
      const flags = [];
      if (d.naks_required) flags.push('Сертификаты НАКС');
      if (d.snils_required) flags.push('СНИЛС/допуска');
      if (d.ppe_required)  flags.push('СИЗ');
      const txt = d.text || '';
      if (!flags.length && !txt) return '';
      return `<div class="block"><h2>Безопасность</h2>
        ${flags.length ? `<div class="row">${_escapeHtml(flags.join(' · '))}</div>` : ''}
        ${txt ? `<div class="row">${_escapeHtml(txt).replace(/\n/g, '<br>')}</div>` : ''}
      </div>`;
    }
    case 'schedule': {
      const ms = Array.isArray(d.milestones) ? d.milestones : [];
      if (!d.start_date && !d.end_date && !ms.length) return '';
      const rows = ms.map(x => `<tr><td>${_escapeHtml(x.title || x.name || '')}</td><td>${_escapeHtml(x.date || '')}</td></tr>`).join('');
      return `<div class="block"><h2>График работ</h2>
        ${d.start_date ? `<div class="row">Начало: ${_escapeHtml(d.start_date)}</div>` : ''}
        ${d.end_date   ? `<div class="row">Окончание: ${_escapeHtml(d.end_date)}</div>` : ''}
        ${ms.length ? `<table><thead><tr><th>Этап</th><th style="width:30%;">Дата</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
      </div>`;
    }
    case 'team': {
      const members = Array.isArray(d.members) ? d.members : [];
      if (!d.lead && !members.length) return '';
      return `<div class="block"><h2>Команда</h2>
        ${d.lead ? `<div class="row"><b>Руководитель:</b> ${_escapeHtml(d.lead)}</div>` : ''}
        ${members.length ? `<ul>${members.map(x => `<li>${_escapeHtml(x.name || x)}${x.role ? ' — ' + _escapeHtml(x.role) : ''}</li>`).join('')}</ul>` : ''}
      </div>`;
    }
    case 'attach': {
      const files = Array.isArray(d.files) ? d.files : [];
      if (!files.length) return '';
      return `<div class="block"><h2>Приложения</h2>
        <ul>${files.map(f => `<li>${_escapeHtml(f.name || f.filename || f)}</li>`).join('')}</ul>
      </div>`;
    }
    case 'sign': {
      const name = d.author_name || '';
      const pos  = d.author_position || 'Руководитель проекта';
      return `<div class="block sign">
        <div><div class="muted">${_escapeHtml(pos)}</div><div>_________________</div></div>
        <div style="text-align:right;"><div class="muted">М.П.</div><div><b>${_escapeHtml(name)}</b></div></div>
      </div>`;
    }
    default:
      return '';
  }
}

// Inline-адаптер HTML→PDF (puppeteer). Используется если у pdf-generator нет
// универсального htmlToPdfBuffer. Запускает свой headless-Chrome.
async function _htmlToPdfInline(html, fastify) {
  let puppeteer;
  try { puppeteer = require('puppeteer'); }
  catch (e) {
    if (fastify && fastify.log) fastify.log.warn('[TKP render-pdf] puppeteer not available: ' + e.message);
    throw new Error('puppeteer_unavailable');
  }
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const buf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '15mm', right: '15mm' }
    });
    return buf;
  } finally {
    try { await browser.close(); } catch (_) {}
  }
}
