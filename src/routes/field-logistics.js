/**
 * ASGARD Field — Logistics API
 * ═══════════════════════════════════════════════════════════════
 * POST   /                       — create logistics item (CRM auth)
 * PUT    /:id                    — edit (sync work_expenses)
 * DELETE /:id                    — soft-delete + cascade work_expenses/document
 * POST   /:id/attach             — attach document (CRM auth)
 * POST   /:id/send               — send to employee via SMS+push (CRM auth)
 * POST   /:id/purchased          — mark as purchased (CRM auth)
 * GET    /                       — logistics matrix (CRM auth, has_lk flag)
 * GET    /my                     — employee's logistics (Field auth)
 * GET    /my/history             — employee's logistics history (Field auth)
 * GET    /my/file/:filename      — secure file preview (Field auth)
 */

const MangoService = require('../services/mango');
const { createNotification } = require('../services/notify');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MANGO_SMS_FROM = process.env.MANGO_SMS_EXTENSION || '101';
const UPLOAD_BASE = process.env.UPLOAD_DIR || './uploads';
// Должен совпадать с ALLOWED_ROLES во фронтах (travel.js, Travel/api.js, nav.config.js, app.js).
// HR / HR_MANAGER нужны: офис-кадровики ведут direктивы на МО, обучение, аттестации.
// ADMIN всегда; HEAD_TO — руководитель тендерного, иногда оформляет командировки субподрядчикам.
const LOGISTICS_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'OFFICE_MANAGER', 'HR', 'HR_MANAGER',
                         'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

// ─────────────────────────────────────────────────────────────────────────────
// Шаблоны SMS/push по типам — чтобы рабочий сразу понимал, что пришло.
// Возвращают { sms, pushTitle, pushBody }. `rec` — строка field_logistics
// с присоединёнными полями: work_title, fio, city.
// ─────────────────────────────────────────────────────────────────────────────
function buildMessages(rec) {
  const t = rec.item_type;
  const wt = rec.work_title ? ` (${rec.work_title})` : '';
  const project = rec.work_title ? `Проект "${rec.work_title}"` : null;
  const dateStr = rec.date_from
    ? new Date(rec.date_from).toLocaleDateString('ru-RU')
    : null;
  const timeStr = rec.departure_at
    ? new Date(rec.departure_at).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
    : null;

  // Заголовки/префиксы
  const map = {
    ticket_to:    { icon: '✈️', kind: 'Билет туда' },
    ticket_back:  { icon: '✈️', kind: 'Билет обратно' },
    flight:       { icon: '✈️', kind: 'Авиабилет' },
    train:        { icon: '🚂', kind: 'Ж/Д билет' },
    transfer:     { icon: '🚐', kind: 'Трансфер' },
    hotel:        { icon: '🏨', kind: 'Гостиница' },
    housing:      { icon: '🏠', kind: 'Жильё' },
    hostel:       { icon: '🛏', kind: 'Хостел' },
    directive_mo: { icon: '🩺', kind: 'Направление на медосмотр' },
    training:     { icon: '📚', kind: 'Обучение' },
    certification:{ icon: '🎓', kind: 'Аттестация/допуск' },
    visa:         { icon: '🛂', kind: 'Виза' },
    insurance:    { icon: '🛡', kind: 'Страховка' }
  };
  const m = map[t] || { icon: '📌', kind: 'Документ' };

  // SMS — латиница, лимит ~160 знаков. Telegram/push — кириллица.
  const tail = rec.work_title ? ` po proektu "${tr(rec.work_title)}"` : '';
  let sms;
  if (['ticket_to', 'ticket_back', 'flight', 'train', 'transfer'].includes(t)) {
    const what = t === 'transfer' ? 'transfer' : (t === 'train' ? 'jd bilet' : 'aviabilet');
    sms = `ASGARD: kuplen ${what}${tail}. Detali v razdele "Bilety" v LK`;
    if (timeStr) sms = `ASGARD: ${what} ${tr(timeStr)}${tail}. Detali v LK`;
  } else if (['hotel', 'housing', 'hostel'].includes(t)) {
    sms = `ASGARD: zabronirovano zhilyo${tail}${dateStr ? ' s ' + tr(dateStr) : ''}. Vaucher v LK`;
  } else if (t === 'directive_mo') {
    sms = `ASGARD: vypisano napravlenie na medosmotr${tail}. Skachay v razdele "Bilety" v LK`;
  } else if (t === 'training' || t === 'certification') {
    sms = `ASGARD: ${tr(m.kind.toLowerCase())}${tail}${dateStr ? ' ' + tr(dateStr) : ''}. Detali v LK`;
  } else {
    sms = `ASGARD: ${tr(rec.title || m.kind)}${tail}. Detali v LK: asgard-crm.ru/field`;
  }
  // Безопасный обрез до 160 знаков
  if (sms.length > 158) sms = sms.slice(0, 155) + '...';

  // Push — кратко и понятно
  const pushTitle = `${m.icon} ${m.kind}${wt}`;
  const pushBody = (rec.description && rec.description.trim())
    || rec.title
    || (dateStr ? 'Дата: ' + dateStr : m.kind);

  return { sms, pushTitle, pushBody };
}

// Простая транслитерация рус→лат для SMS (ASCII-only через Mango дешевле).
function tr(s) {
  if (!s) return '';
  const m = {
    А:'A',Б:'B',В:'V',Г:'G',Д:'D',Е:'E',Ё:'E',Ж:'Zh',З:'Z',И:'I',Й:'Y',К:'K',Л:'L',
    М:'M',Н:'N',О:'O',П:'P',Р:'R',С:'S',Т:'T',У:'U',Ф:'F',Х:'Kh',Ц:'Ts',Ч:'Ch',Ш:'Sh',
    Щ:'Sch',Ъ:'',Ы:'Y',Ь:'',Э:'E',Ю:'Yu',Я:'Ya',
    а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',
    м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',
    щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'
  };
  return String(s).split('').map(ch => m[ch] !== undefined ? m[ch] : ch).join('');
}

// expense_type по типу логистики — чтобы расход красиво группировался.
function expenseTypeFor(item_type) {
  if (['ticket_to', 'ticket_back', 'flight', 'train', 'transfer'].includes(item_type)) return 'transport';
  if (['hotel', 'housing', 'hostel'].includes(item_type)) return 'housing';
  if (item_type === 'directive_mo') return 'medical';
  if (item_type === 'training' || item_type === 'certification') return 'training';
  return 'other';
}

async function routes(fastify, options) {
  const db = fastify.db;
  const mango = new MangoService();
  const crmAuth = { preHandler: [fastify.requireRoles(LOGISTICS_ROLES)] };
  const fieldAuth = { preHandler: [fastify.fieldAuthenticate] };

  // ─────────────────────────────────────────────────────────────────────
  // POST / — create logistics item
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/', crmAuth, async (req, reply) => {
    try {
      const userId = req.user.id;
      let {
        work_id, employee_id, item_type, title, description, details,
        date_from, date_to, amount, vat_included, item_subtype,
        departure_at, arrival_at, transport_no,
        referral_at, hotel_address, driver_phone
      } = req.body || {};

      if (!employee_id || !item_type || !title) {
        return reply.code(400).send({ error: 'Укажите employee_id, item_type и title' });
      }

      // если переданы дата+время вылета/прилёта — автозаполняем date_from/date_to датой (совместимость)
      if (departure_at && !date_from) date_from = String(departure_at).slice(0, 10);
      if (arrival_at && !date_to) date_to = String(arrival_at).slice(0, 10);

      const { rows: inserted } = await db.query(`
        INSERT INTO field_logistics (work_id, employee_id, item_type, item_subtype, title, description,
          details, date_from, date_to, amount, vat_included, departure_at, arrival_at, transport_no,
          referral_at, hotel_address, driver_phone,
          status, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'pending', $18)
        RETURNING id, created_at
      `, [
        work_id || null, employee_id, item_type, item_subtype || null, title,
        description || null, details ? JSON.stringify(details) : '{}',
        date_from || null, date_to || null,
        amount ? parseFloat(amount) : null,
        vat_included === true || vat_included === 'true',
        departure_at || null, arrival_at || null, transport_no || null,
        referral_at || null, hotel_address || null, driver_phone || null,
        userId
      ]);

      const logisticsId = inserted[0].id;

      // Auto-create travel stage for ticket_to / ticket_back (Session 12)
      if ((item_type === 'ticket_to' || item_type === 'ticket_back') && date_from) {
        try {
          // Find tariff for travel
          const { rows: tariffRows } = await db.query(
            `SELECT id, points, rate_per_shift FROM field_tariff_grid WHERE category='special' AND position_name ILIKE '%Дорога%' LIMIT 1`
          );
          const tariff = tariffRows[0] || { id: null, points: 6, rate_per_shift: 3000 };
          const tPoints = tariff.points;
          const tRate = parseFloat(tariff.rate_per_shift);
          const d1 = new Date(date_from);
          const d2 = date_to ? new Date(date_to) : d1;
          const days = Math.max(1, Math.round((d2 - d1) / 86400000) + 1);
          const stageAmount = days * tRate;

          await db.query(`
            INSERT INTO field_trip_stages
              (employee_id, work_id, stage_type, date_from, date_to, days_count,
               tariff_id, tariff_points, rate_per_day, amount_earned, details,
               logistics_id, source, status, created_by)
            VALUES ($1,$2,'travel',$3,$4,$5,$6,$7,$8,$9,$10,$11,'auto','planned',$12)
            ON CONFLICT DO NOTHING
          `, [employee_id, work_id, date_from, date_to || null, days,
              tariff.id || null, tPoints, tRate, stageAmount,
              JSON.stringify({ transport: 'auto', route: title }),
              logisticsId, userId]);
        } catch (stErr) {
          fastify.log.warn('[field-logistics] auto-create travel stage:', stErr.message);
        }
      }

      // Auto-create work_expenses record when work_id + amount specified
      if (work_id && amount && parseFloat(amount) > 0) {
        try {
          const expAmount = parseFloat(amount);
          const expAmountVat = vat_included ? expAmount : null;
          const { rows: exp } = await db.query(`
            INSERT INTO work_expenses
              (work_id, amount, amount_vat, description, expense_type, date, created_by, requires_payment)
            VALUES ($1, $2, $3, $4, $5, $6, $7, false)
            RETURNING id
          `, [
            work_id, expAmount, expAmountVat,
            title + (description ? ': ' + description : ''),
            expenseTypeFor(item_type),
            date_from || new Date().toISOString().slice(0,10),
            userId
          ]);
          if (exp[0]) {
            await db.query(
              `UPDATE field_logistics SET expense_linked = true, expense_id = $1 WHERE id = $2`,
              [exp[0].id, logisticsId]
            );
          }
        } catch (expErr) {
          fastify.log.warn('[field-logistics] auto work_expenses:', expErr.message);
        }
      }

      return { logistics_id: logisticsId, created_at: inserted[0].created_at };
    } catch (err) {
      fastify.log.error('[field-logistics] POST / error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // PUT /:id — править рейс + СИНХРОНИЗИРОВАТЬ связанный work_expenses
  // (если сменили сумму/дату/название/НДС — пересчитаем расход проекта).
  // ─────────────────────────────────────────────────────────────────────
  fastify.put('/:id', crmAuth, async (req, reply) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return reply.code(400).send({ error: 'Bad id' });
      const { rows: ex } = await db.query(
        'SELECT id, work_id, item_type, title, description, amount, vat_included, date_from, expense_id FROM field_logistics WHERE id = $1 AND deleted_at IS NULL',
        [id]
      );
      if (!ex.length) return reply.code(404).send({ error: 'Запись не найдена' });
      const prev = ex[0];

      const allow = {
        title: 'title', description: 'description', date_from: 'date_from', date_to: 'date_to',
        amount: 'amount', transport_no: 'transport_no', departure_at: 'departure_at',
        arrival_at: 'arrival_at', item_subtype: 'item_subtype', status: 'status',
        vat_included: 'vat_included',
        referral_at: 'referral_at', hotel_address: 'hotel_address', driver_phone: 'driver_phone'
      };
      const sets = [], vals = [];
      let i = 1;
      const body = req.body || {};
      // авто date_from/date_to из времени, если только время передано
      if (body.departure_at && body.date_from == null) body.date_from = String(body.departure_at).slice(0, 10);
      if (body.arrival_at && body.date_to == null) body.date_to = String(body.arrival_at).slice(0, 10);
      for (const [k, col] of Object.entries(allow)) {
        if (body[k] !== undefined) {
          sets.push(`${col} = $${i++}`);
          if (k === 'amount') {
            vals.push(body[k] == null ? null : parseFloat(body[k]));
          } else if (k === 'vat_included') {
            vals.push(body[k] === true || body[k] === 'true');
          } else {
            vals.push(body[k] || null);
          }
        }
      }
      if (!sets.length) return reply.code(400).send({ error: 'Нет полей для обновления' });
      vals.push(id);
      const { rows } = await db.query(
        `UPDATE field_logistics SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${i} RETURNING *`,
        vals
      );
      const fresh = rows[0];

      // Sync work_expenses
      try {
        const hasWork = !!fresh.work_id;
        const newAmount = fresh.amount ? parseFloat(fresh.amount) : 0;
        const newVat = fresh.vat_included ? newAmount : null;
        const newDesc = (fresh.title || '') + (fresh.description ? ': ' + fresh.description : '');
        const newDate = fresh.date_from || new Date().toISOString().slice(0,10);
        const newType = expenseTypeFor(fresh.item_type);

        if (prev.expense_id) {
          // уже привязан расход
          if (hasWork && newAmount > 0) {
            // Обновляем существующий расход
            await db.query(`
              UPDATE work_expenses
                 SET amount = $1, amount_vat = $2, description = $3,
                     expense_type = $4, date = $5
               WHERE id = $6
            `, [newAmount, newVat, newDesc, newType, newDate, prev.expense_id]);
          } else {
            // Работа отвязана или сумма обнулилась — удаляем расход и отвязываем
            await db.query('DELETE FROM work_expenses WHERE id = $1', [prev.expense_id]);
            await db.query(
              'UPDATE field_logistics SET expense_id = NULL, expense_linked = false WHERE id = $1',
              [id]
            );
          }
        } else if (hasWork && newAmount > 0) {
          // Раньше расхода не было, теперь появилась сумма+работа — создаём.
          const { rows: exp } = await db.query(`
            INSERT INTO work_expenses
              (work_id, amount, amount_vat, description, expense_type, date, created_by, requires_payment)
            VALUES ($1, $2, $3, $4, $5, $6, $7, false)
            RETURNING id
          `, [fresh.work_id, newAmount, newVat, newDesc, newType, newDate, req.user.id]);
          if (exp[0]) {
            await db.query(
              'UPDATE field_logistics SET expense_id = $1, expense_linked = true WHERE id = $2',
              [exp[0].id, id]
            );
          }
        }
      } catch (syncErr) {
        fastify.log.warn('[field-logistics] PUT expense sync:', syncErr.message);
      }

      return { ok: true, logistics: fresh };
    } catch (err) {
      fastify.log.error('[field-logistics] PUT /:id error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // DELETE /:id — доменное soft-delete с каскадом:
  //   • удаляем связанный work_expenses (если был);
  //   • удаляем файл с диска (если был и не используется в других местах);
  //   • помечаем запись deleted_at = NOW().
  // ─────────────────────────────────────────────────────────────────────
  fastify.delete('/:id', crmAuth, async (req, reply) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return reply.code(400).send({ error: 'Bad id' });

      const { rows } = await db.query(
        `SELECT fl.id, fl.expense_id, fl.document_id, d.filename
           FROM field_logistics fl
           LEFT JOIN documents d ON d.id = fl.document_id
          WHERE fl.id = $1 AND fl.deleted_at IS NULL`,
        [id]
      );
      if (!rows.length) return reply.code(404).send({ error: 'Запись не найдена' });
      const rec = rows[0];

      // Удалить расход проекта (если был привязан)
      if (rec.expense_id) {
        try {
          await db.query('DELETE FROM work_expenses WHERE id = $1', [rec.expense_id]);
        } catch (e) {
          fastify.log.warn('[field-logistics] DELETE: work_expenses cleanup:', e.message);
        }
      }

      // Удалить документ из БД и файл с диска (если больше нигде не используется)
      if (rec.document_id) {
        try {
          // Проверка: используется ли документ ещё где-то (другие field_logistics)
          const { rows: dup } = await db.query(
            'SELECT 1 FROM field_logistics WHERE document_id = $1 AND id <> $2 AND deleted_at IS NULL LIMIT 1',
            [rec.document_id, id]
          );
          if (!dup.length) {
            // безопасно удалить
            if (rec.filename) {
              const filePath = path.join(UPLOAD_BASE, 'logistics', rec.filename);
              try { await fs.promises.unlink(filePath); } catch (_) {}
            }
            await db.query('DELETE FROM documents WHERE id = $1', [rec.document_id]);
          }
        } catch (e) {
          fastify.log.warn('[field-logistics] DELETE: document cleanup:', e.message);
        }
      }

      // Удалить авто-этап «Дорога» если он создавался для этой записи
      try {
        await db.query('DELETE FROM field_trip_stages WHERE logistics_id = $1 AND source = $2', [id, 'auto']);
      } catch (e) {
        fastify.log.warn('[field-logistics] DELETE: trip stage cleanup:', e.message);
      }

      // Soft-delete самой записи
      await db.query(
        `UPDATE field_logistics SET deleted_at = NOW(), updated_at = NOW(),
           expense_id = NULL, document_id = NULL
         WHERE id = $1`,
        [id]
      );

      return { ok: true };
    } catch (err) {
      fastify.log.error('[field-logistics] DELETE /:id error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /:id/attach — attach document
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/:id/attach', crmAuth, async (req, reply) => {
    try {
      const logisticsId = parseInt(req.params.id);
      const userId = req.user.id;

      // Check logistics item exists
      const { rows: item } = await db.query(
        `SELECT id, work_id, employee_id FROM field_logistics WHERE id = $1 AND deleted_at IS NULL`, [logisticsId]
      );
      if (item.length === 0) return reply.code(404).send({ error: 'Запись не найдена' });

      const parts = req.parts();
      let file = null;

      for await (const part of parts) {
        if (part.file) {
          file = {
            buffer: await part.toBuffer(),
            filename: part.filename,
            mimetype: part.mimetype,
          };
        }
      }

      if (!file) return reply.code(400).send({ error: 'Файл не загружен' });

      // Save file
      const ext = path.extname(file.filename).toLowerCase();
      const uploadDir = path.join(UPLOAD_BASE, 'logistics');
      await fs.promises.mkdir(uploadDir, { recursive: true });

      const uniqueName = crypto.randomBytes(16).toString('hex') + ext;
      const filePath = path.join(uploadDir, uniqueName);
      await fs.promises.writeFile(filePath, file.buffer);

      // Insert into documents
      const { rows: doc } = await db.query(`
        INSERT INTO documents (filename, original_name, mime_type, size, type, work_id, uploaded_by, download_url, created_at)
        VALUES ($1, $2, $3, $4, 'logistics', $5, $6, $7, NOW())
        RETURNING id
      `, [uniqueName, file.filename, file.mimetype, file.buffer.length,
          item[0].work_id, userId, `/uploads/logistics/${uniqueName}`]);

      // Link to logistics
      await db.query(
        `UPDATE field_logistics SET document_id = $1, status = 'ready', updated_at = NOW() WHERE id = $2`,
        [doc[0].id, logisticsId]
      );

      return { ok: true, document_id: doc[0].id };
    } catch (err) {
      fastify.log.error('[field-logistics] POST /:id/attach error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /:id/send — отправить сотруднику (SMS + push + Telegram)
  // Шаблоны зависят от item_type (МО / обучение / билет / жильё ...).
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/:id/send', crmAuth, async (req, reply) => {
    try {
      const logisticsId = parseInt(req.params.id);
      const userId = req.user.id;

      const { rows: item } = await db.query(`
        SELECT fl.*, e.phone, e.fio, e.user_id, w.work_title
        FROM field_logistics fl
        JOIN employees e ON e.id = fl.employee_id
        LEFT JOIN works w ON w.id = fl.work_id
        WHERE fl.id = $1 AND fl.deleted_at IS NULL
      `, [logisticsId]);

      if (item.length === 0) return reply.code(404).send({ error: 'Запись не найдена' });

      const rec = item[0];
      const { sms, pushTitle, pushBody } = buildMessages(rec);
      let smsSent = false;
      let pushSent = false;

      // SMS
      if (rec.phone) {
        try {
          await mango.sendSms(MANGO_SMS_FROM, rec.phone, sms);
          smsSent = true;
          await db.query(`
            INSERT INTO field_sms_log (employee_id, phone, message_type, message_text, status, work_id, sent_by)
            VALUES ($1, $2, 'logistics', $3, 'sent', $4, $5)
          `, [rec.employee_id, rec.phone, sms, rec.work_id, userId]);
        } catch (smsErr) {
          fastify.log.error('[field-logistics] SMS error:', smsErr.message);
        }
      }

      // Push notification (web-push + Telegram + SSE)
      if (rec.user_id) {
        try {
          await createNotification(db, {
            user_id: rec.user_id,
            title: pushTitle,
            message: pushBody,
            type: 'field_logistics',
            link: '/field/logistics'
          });
          pushSent = true;
        } catch (_) {}
      }

      // Update status
      await db.query(
        `UPDATE field_logistics SET sent_to_employee = true, sent_at = NOW(), status = 'sent', updated_at = NOW() WHERE id = $1`,
        [logisticsId]
      );

      return { ok: true, sms_sent: smsSent, push_sent: pushSent, has_lk: !!rec.user_id };
    } catch (err) {
      fastify.log.error('[field-logistics] POST /:id/send error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /:id/purchased — отметить «Куплено/Оплачено» (офис-менеджер)
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/:id/purchased', crmAuth, async (req, reply) => {
    try {
      const logisticsId = parseInt(req.params.id);
      const userId = req.user.id;
      const { rows } = await db.query(
        `SELECT id, status FROM field_logistics WHERE id = $1 AND deleted_at IS NULL`, [logisticsId]
      );
      if (!rows.length) return reply.code(404).send({ error: 'Запись не найдена' });
      // Не перетираем уже отправленное рабочему (sent — финальнее)
      if (rows[0].status === 'sent') {
        return { ok: true, status: 'sent', note: 'Уже отправлено рабочему' };
      }
      await db.query(
        `UPDATE field_logistics
         SET status = 'purchased', purchased_at = NOW(), purchased_by = $1, updated_at = NOW()
         WHERE id = $2`,
        [userId, logisticsId]
      );
      return { ok: true, status: 'purchased' };
    } catch (err) {
      fastify.log.error('[field-logistics] POST /:id/purchased error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET / — logistics matrix by project (CRM view) + has_lk
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/', crmAuth, async (req, reply) => {
    try {
      const workId = req.query.work_id ? parseInt(req.query.work_id) : null;

      let sql = `
        SELECT fl.*, e.fio, e.phone, (e.user_id IS NOT NULL) AS has_lk,
               w.work_title, w.city,
               d.original_name as document_name, d.download_url
        FROM field_logistics fl
        JOIN employees e ON e.id = fl.employee_id
        LEFT JOIN works w ON w.id = fl.work_id
        LEFT JOIN documents d ON d.id = fl.document_id
        WHERE fl.deleted_at IS NULL
      `;
      const params = [];

      if (workId) {
        sql += ` AND fl.work_id = $1`;
        params.push(workId);
      }
      sql += ` ORDER BY fl.created_at DESC LIMIT 500`;

      const { rows } = await db.query(sql, params);

      if (workId) {
        // Group by employee for project matrix view
        const matrix = {};
        for (const row of rows) {
          if (!matrix[row.employee_id]) {
            matrix[row.employee_id] = { employee_id: row.employee_id, fio: row.fio, phone: row.phone, has_lk: row.has_lk, items: [] };
          }
          matrix[row.employee_id].items.push(row);
        }
        return { logistics: Object.values(matrix), total: rows.length };
      }

      return { logistics: rows, total: rows.length };
    } catch (err) {
      fastify.log.error('[field-logistics] GET / error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /my — employee's current logistics (Field auth)
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/my', fieldAuth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;

      const { rows } = await db.query(`
        SELECT fl.*, w.work_title, w.city,
               d.original_name as document_name, d.download_url,
               COALESCE(d.download_url, fl.details->>'receipt_url') as file_url
        FROM field_logistics fl
        LEFT JOIN works w ON w.id = fl.work_id
        LEFT JOIN documents d ON d.id = fl.document_id
        WHERE fl.employee_id = $1 AND fl.deleted_at IS NULL
        ORDER BY fl.date_from DESC NULLS LAST, fl.created_at DESC
      `, [empId]);

      return { logistics: rows };
    } catch (err) {
      fastify.log.error('[field-logistics] GET /my error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /my/history — employee's logistics history (Field auth)
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/my/history', fieldAuth, async (req, reply) => {
    try {
      const empId = req.fieldEmployee.id;

      const { rows } = await db.query(`
        SELECT fl.*, w.work_title, w.city,
               d.original_name as document_name, d.download_url,
               COALESCE(d.download_url, fl.details->>'receipt_url') as file_url
        FROM field_logistics fl
        LEFT JOIN works w ON w.id = fl.work_id
        LEFT JOIN documents d ON d.id = fl.document_id
        WHERE fl.employee_id = $1 AND fl.deleted_at IS NULL
        ORDER BY fl.created_at DESC
        LIMIT 100
      `, [empId]);

      return { logistics: rows };
    } catch (err) {
      fastify.log.error('[field-logistics] GET /my/history error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /my/file/:filename — preview/download ticket file (Field auth)
  // Serves PDF/images inline, verifies worker owns the logistics record
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/my/file/:filename', async (req, reply) => {
    try {
      // Support token via query param (for opening in new tab)
      const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
      if (!token) return reply.code(401).send({ error: 'Не авторизован' });

      const jwt = require('jsonwebtoken');
      const FIELD_JWT_SECRET = process.env.FIELD_JWT_SECRET || (process.env.JWT_SECRET + '_field');
      let decoded;
      try { decoded = jwt.verify(token, FIELD_JWT_SECRET); } catch { return reply.code(401).send({ error: 'Токен недействителен' }); }
      if (decoded.type !== 'field') return reply.code(401).send({ error: 'Неверный тип токена' });
      const empId = decoded.employee_id;
      const filename = req.params.filename.replace(/[^a-zA-Z0-9._-]/g, '');
      if (!filename) return reply.code(400).send({ error: 'Некорректный файл' });

      // Verify this file belongs to the worker's logistics (via document_id or receipt_url)
      const { rows } = await db.query(
        `SELECT fl.id FROM field_logistics fl
         LEFT JOIN documents d ON d.id = fl.document_id
         WHERE fl.employee_id = $1
           AND fl.deleted_at IS NULL
           AND (d.filename = $2 OR fl.details->>'receipt_url' LIKE $3)
         LIMIT 1`,
        [empId, filename, `%${filename}%`]
      );
      if (!rows.length) return reply.code(403).send({ error: 'Нет доступа' });

      // Find file in documents table
      const { rows: docs } = await db.query(
        'SELECT filename, original_name, mime_type FROM documents WHERE filename = $1 LIMIT 1',
        [filename]
      );
      if (!docs.length) return reply.code(404).send({ error: 'Файл не найден' });

      const doc = docs[0];
      // Файлы из /attach лежат в uploads/logistics/, но исторически некоторые
      // могли быть в корне uploads/ — проверяем оба пути.
      const candidates = [
        path.join(UPLOAD_BASE, 'logistics', doc.filename),
        path.join(UPLOAD_BASE, doc.filename)
      ];
      let filePath = null;
      for (const p of candidates) {
        try { await fs.promises.access(p); filePath = p; break; } catch (_) {}
      }
      if (!filePath) return reply.code(404).send({ error: 'Файл не найден' });

      const buffer = await fs.promises.readFile(filePath);
      const mime = doc.mime_type || 'application/octet-stream';
      const isInline = mime.startsWith('application/pdf') || mime.startsWith('image/');

      reply
        .header('Content-Type', mime)
        .header('Content-Length', buffer.length)
        .header('Content-Disposition', isInline
          ? `inline; filename="${encodeURIComponent(doc.original_name || filename)}"`
          : `attachment; filename="${encodeURIComponent(doc.original_name || filename)}"`)
        .header('Cache-Control', 'private, max-age=3600')
        .send(buffer);
    } catch (err) {
      fastify.log.error('[field-logistics] file preview error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });
}

module.exports = routes;
