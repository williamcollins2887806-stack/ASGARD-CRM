'use strict';

/**
 * src/routes/letter.js — REST API модуля «Официальная переписка» (Stage 2.4).
 *
 * Prefix: `/api/letter` (зарегистрирован в src/index.js).
 *
 * Эндпоинты (см. _LETTER_CONTRACT.md §4):
 *   GET  /kinds                              — справочник типов писем
 *   GET  /templates/health                   — состояние шаблона customer-letter-tpl.docx
 *   POST /:id/finalize                       — финализация (аллокация номера + snapshot)
 *   POST /:id/new-revision                   — новая редакция
 *   POST /:id/render/:format (docx|pdf)      — генерация документа на лету
 *   POST /:id/send-email                     — отправка финализированного письма
 *
 * RBAC: см. §5. Базовый guard — CORRESPONDENCE_ROLES. Доп. проверки
 * (свои/чужие) делает helper `assertWriteAccess`.
 */

const fs = require('fs');
const path = require('path');

const correspondenceService = require('../services/correspondence');
const letterKinds = require('../services/letter/letter-kinds');
const docxLetter = require('../services/letter/docx-letter');
const pdfLetter = require('../services/letter/pdf-letter');

const CORRESPONDENCE_ROLES = [
  'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV',
  'OFFICE_MANAGER', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO'
];
const MAILBOX_ROLES = [
  'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV',
  'HEAD_TO', 'HEAD_PM', 'PM', 'TO', 'OFFICE_MANAGER'
];
const DIRECTOR_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const WRITE_OVERRIDE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'OFFICE_MANAGER'];

function hasCorrespondenceAccess(user) {
  return !!user && CORRESPONDENCE_ROLES.includes(user.role);
}

function hasMailboxAccess(user) {
  return !!user && MAILBOX_ROLES.includes(user.role);
}

/**
 * Проверка «может ли пользователь финализировать/редактировать/выпустить ревизию»:
 * автор ИЛИ OFFICE_MANAGER ИЛИ DIRECTOR_* ИЛИ ADMIN.
 * (OFFICE_MANAGER по §5 текст редактировать не может — finalize и send отдельно
 * разрешены. Эта функция — общая «write-able» проверка для finalize/new-revision.)
 */
function canWrite(user, correspondence) {
  if (!user || !correspondence) return false;
  if (WRITE_OVERRIDE_ROLES.includes(user.role)) return true;
  return Number(correspondence.created_by) === Number(user.id);
}

const TEMPLATE_REL = path.join('templates', 'customer-letter-tpl.docx');
function resolveTemplatePath() {
  return path.join(process.cwd(), TEMPLATE_REL);
}

function getRenderFlags(query) {
  const q = query || {};
  // ?with_signature=0 → false; иначе — true (default).
  const ws = q.with_signature;
  const wp = q.with_stamp;
  return {
    with_signature: !(ws === '0' || ws === 0 || ws === 'false'),
    with_stamp: !(wp === '0' || wp === 0 || wp === 'false')
  };
}

function inferFileBase(corr, format) {
  const safe = (corr.number || `draft-${corr.id}`).replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${safe}.${format}`;
}

module.exports = async function letterRoutes(fastify) {
  const db = fastify.db;

  // ─── GET /api/letter/kinds ──────────────────────────────────────────
  fastify.get('/kinds', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!hasCorrespondenceAccess(request.user)) {
      return reply.code(403).send({ error: 'Нет доступа к корреспонденции' });
    }
    try {
      const items = await letterKinds.getAllKinds(db);
      return { items };
    } catch (err) {
      fastify.log.error({ err }, 'letter/kinds error');
      return reply.code(500).send({ error: 'Не удалось загрузить типы писем' });
    }
  });

  // ─── GET /api/letter/templates/health ───────────────────────────────
  fastify.get('/templates/health', { preHandler: [fastify.authenticate] }, async (_request, reply) => {
    const templatePath = resolveTemplatePath();
    try {
      if (fs.existsSync(templatePath)) {
        const stat = fs.statSync(templatePath);
        return {
          ok: true,
          path: TEMPLATE_REL.replace(/\\/g, '/'),
          size_bytes: stat.size,
          modified_at: stat.mtime
        };
      }
    } catch (err) {
      fastify.log.error({ err }, 'letter/templates/health stat error');
    }
    return reply.code(503).send({
      ok: false,
      error: 'Шаблон не найден. Положите customer-letter-tpl.docx в templates/ на сервере.',
      expected_path: TEMPLATE_REL.replace(/\\/g, '/')
    });
  });

  // ─── POST /api/letter/:id/finalize ──────────────────────────────────
  fastify.post('/:id/finalize', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!hasCorrespondenceAccess(request.user)) {
      return reply.code(403).send({ error: 'Нет доступа к корреспонденции' });
    }
    const id = parseInt(request.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ error: 'Некорректный id' });
    }
    try {
      const existing = await correspondenceService.getCorrespondenceById(db, id);
      if (!existing) return reply.code(404).send({ error: 'Корреспонденция не найдена' });
      if (!canWrite(request.user, existing)) {
        return reply.code(403).send({ error: 'Финализировать может только автор, OFFICE_MANAGER или DIRECTOR_*' });
      }

      const result = await correspondenceService.finalizeCorrespondence(db, id, {
        userId: request.user.id
      });
      return { success: true, ...result };
    } catch (err) {
      if (err.statusCode) return reply.code(err.statusCode).send({ error: err.message });
      fastify.log.error({ err }, 'letter/finalize error');
      return reply.code(500).send({ error: 'Не удалось финализировать письмо' });
    }
  });

  // ─── POST /api/letter/:id/new-revision ──────────────────────────────
  fastify.post('/:id/new-revision', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!hasCorrespondenceAccess(request.user)) {
      return reply.code(403).send({ error: 'Нет доступа к корреспонденции' });
    }
    const id = parseInt(request.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ error: 'Некорректный id' });
    }
    try {
      const existing = await correspondenceService.getCorrespondenceById(db, id);
      if (!existing) return reply.code(404).send({ error: 'Корреспонденция не найдена' });
      if (!canWrite(request.user, existing)) {
        return reply.code(403).send({ error: 'Создавать редакции может только автор, OFFICE_MANAGER или DIRECTOR_*' });
      }

      const result = await correspondenceService.createNewRevision(db, id, {
        revision_note: request.body?.revision_note
      }, { userId: request.user.id });
      return { success: true, ...result };
    } catch (err) {
      if (err.statusCode) return reply.code(err.statusCode).send({ error: err.message });
      fastify.log.error({ err }, 'letter/new-revision error');
      return reply.code(500).send({ error: 'Не удалось создать новую редакцию' });
    }
  });

  // ─── POST /api/letter/:id/render/:format ────────────────────────────
  // POST (а не GET) — потому что генерация может быть тяжёлой и фронт
  // должен явно «нажать» рендер. Также допускаем GET для curl-удобства.
  const renderHandler = async (request, reply) => {
    if (!hasCorrespondenceAccess(request.user)) {
      return reply.code(403).send({ error: 'Нет доступа к корреспонденции' });
    }
    const id = parseInt(request.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ error: 'Некорректный id' });
    }
    const format = (request.params.format || '').toLowerCase();
    if (!['docx', 'pdf'].includes(format)) {
      return reply.code(400).send({ error: 'format должен быть docx или pdf' });
    }

    try {
      const corr = await correspondenceService.getCorrespondenceById(db, id);
      if (!corr) return reply.code(404).send({ error: 'Корреспонденция не найдена' });

      const flags = getRenderFlags(request.query);
      const renderOpts = { ...flags, db, dadata: request.query?.dadata !== '0' };

      let buf;
      if (format === 'docx') {
        buf = await docxLetter.generateLetterDocx(corr, renderOpts);
      } else {
        buf = await pdfLetter.generateLetterPdf(corr, renderOpts);
      }

      const filename = inferFileBase(corr, format);
      const contentType = format === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/pdf';

      reply
        .header('Content-Type', contentType)
        .header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(buf);
    } catch (err) {
      if (err.statusCode) return reply.code(err.statusCode).send({ error: err.message });
      fastify.log.error({ err }, 'letter/render error');
      return reply.code(500).send({ error: `Не удалось сгенерировать ${format.toUpperCase()}` });
    }
  };
  fastify.post('/:id/render/:format', { preHandler: [fastify.authenticate] }, renderHandler);
  fastify.get('/:id/render/:format',  { preHandler: [fastify.authenticate] }, renderHandler);

  // ─── POST /api/letter/:id/send-email ─────────────────────────────────
  fastify.post('/:id/send-email', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!hasCorrespondenceAccess(request.user) || !hasMailboxAccess(request.user)) {
      return reply.code(403).send({ error: 'Нет доступа к отправке писем (CORRESPONDENCE_ROLES ∩ MAILBOX_ROLES)' });
    }
    const id = parseInt(request.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ error: 'Некорректный id' });
    }

    const body = request.body || {};
    const to = body.to;
    if (!to || (Array.isArray(to) && to.length === 0)) {
      return reply.code(400).send({ error: 'Поле to обязательно (массив или строка)' });
    }

    try {
      const corr = await correspondenceService.getCorrespondenceById(db, id);
      if (!corr) return reply.code(404).send({ error: 'Корреспонденция не найдена' });
      if (corr.direction !== 'outgoing') {
        return reply.code(400).send({ error: 'Отправлять можно только исходящие' });
      }
      if (corr.signing_status !== 'finalized') {
        return reply.code(400).send({
          error: `Письмо должно быть финализировано (текущий статус: ${corr.signing_status})`
        });
      }

      // ─── Собираем attachments ──────────────────────────────────────
      const attachments = [];
      if (body.attach_pdf !== false) {
        try {
          const pdfBuf = await pdfLetter.generateLetterPdf(corr, {
            with_signature: corr.signature_on !== false,
            with_stamp: corr.stamp_on !== false,
            db
          });
          attachments.push({ filename: inferFileBase(corr, 'pdf'), content: pdfBuf, contentType: 'application/pdf' });
        } catch (e) {
          fastify.log.error({ err: e }, 'send-email: pdf generation failed');
          return reply.code(500).send({ error: `Не удалось сгенерировать PDF: ${e.message}` });
        }
      }
      if (body.attach_docx !== false) {
        try {
          const docxBuf = await docxLetter.generateLetterDocx(corr, {
            with_signature: corr.signature_on !== false,
            with_stamp: corr.stamp_on !== false,
            db
          });
          attachments.push({
            filename: inferFileBase(corr, 'docx'),
            content: docxBuf,
            contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          });
        } catch (e) {
          fastify.log.error({ err: e }, 'send-email: docx generation failed');
          return reply.code(500).send({ error: `Не удалось сгенерировать DOCX: ${e.message}` });
        }
      }
      if (body.attach_linked_documents !== false) {
        try {
          const linkedRes = await db.query(
            'SELECT id, file_path, original_filename, mime_type FROM documents WHERE correspondence_id = $1',
            [id]
          );
          for (const d of linkedRes.rows) {
            if (!d.file_path) continue;
            const fpath = path.isAbsolute(d.file_path)
              ? d.file_path
              : path.join(process.cwd(), d.file_path);
            if (fs.existsSync(fpath)) {
              attachments.push({
                filename: d.original_filename || path.basename(fpath),
                path: fpath,
                contentType: d.mime_type || 'application/octet-stream'
              });
            }
          }
        } catch (e) {
          fastify.log.warn({ err: e }, 'send-email: linked documents fetch failed');
        }
      }

      // ─── SMTP transport (reuse паттерн из mailbox.js:432-447) ──────
      const nodemailer = require('nodemailer');
      const imapSvc = require('../services/imap');

      let fromEmail = process.env.SMTP_FROM || '"АСГАРД CRM" <crm@asgard-service.com>';
      let transport = null;

      const personalAccRes = await db.query(
        'SELECT * FROM user_email_accounts WHERE user_id = $1 AND is_active = true LIMIT 1',
        [request.user.id]
      );
      if (personalAccRes.rows[0]) {
        const acc = personalAccRes.rows[0];
        fromEmail = `"${acc.display_name || request.user.name || 'Асгард-Сервис'}" <${acc.email_address}>`;
        transport = nodemailer.createTransport({
          host: acc.smtp_host || 'smtp.yandex.ru',
          port: acc.smtp_port || 465,
          secure: acc.smtp_tls !== false,
          auth: { user: acc.smtp_user, pass: imapSvc.decrypt(acc.smtp_pass_encrypted) },
          connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000
        });
      } else if (body.account_id) {
        const accRes = await db.query(
          'SELECT * FROM email_accounts WHERE id = $1',
          [body.account_id]
        );
        if (accRes.rows[0]) {
          const acc = accRes.rows[0];
          if (acc.email_address) fromEmail = `"${acc.smtp_from_name || 'Асгард-Сервис'}" <${acc.email_address}>`;
          if (acc.smtp_host) {
            transport = nodemailer.createTransport({
              host: acc.smtp_host,
              port: acc.smtp_port || 587,
              secure: acc.smtp_tls !== false,
              auth: { user: acc.smtp_user, pass: imapSvc.decrypt(acc.smtp_pass_encrypted) },
              connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000
            });
          }
        }
      }
      if (!transport) {
        // Прод-fallback: глобальный SMTP из ENV
        transport = nodemailer.createTransport({
          host: process.env.SMTP_HOST || 'smtp.yandex.ru',
          port: parseInt(process.env.SMTP_PORT || '465', 10),
          secure: process.env.SMTP_SECURE !== 'false',
          auth: process.env.SMTP_USER
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined
        });
      }

      const subject = body.subject || corr.subject;
      const bodyHtml = body.body_html || corr.body_html || corr.body || '';
      const bodyText = body.body_text || (corr.body || (corr.body_html || '').replace(/<[^>]+>/g, ''));

      const mailOptions = {
        from: fromEmail,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject,
        html: bodyHtml,
        text: bodyText,
        attachments
      };
      if (body.cc)  mailOptions.cc  = Array.isArray(body.cc)  ? body.cc.join(', ')  : body.cc;
      if (body.bcc) mailOptions.bcc = Array.isArray(body.bcc) ? body.bcc.join(', ') : body.bcc;

      const sendResult = await transport.sendMail(mailOptions);

      // ─── Записать в emails + обновить correspondence ───────────────
      const toEmailsJson = JSON.stringify(
        (Array.isArray(to) ? to : [to]).map(e => ({ address: String(e).trim(), name: '' }))
      );
      const ccEmailsJson = body.cc
        ? JSON.stringify((Array.isArray(body.cc) ? body.cc : [body.cc]).map(e => ({ address: String(e).trim(), name: '' })))
        : '[]';

      let emailId = null;
      try {
        const ins = await db.query(
          `INSERT INTO emails (
             account_id, direction, message_id,
             from_email, from_name, to_emails, cc_emails,
             subject, body_text, body_html, snippet,
             email_type, is_read,
             sent_by_user_id, email_date,
             linked_tender_id, linked_work_id, linked_correspondence_id
           ) VALUES (
             $1, 'outbound', $2,
             $3, '', $4::jsonb, $5::jsonb,
             $6, $7, $8, $9,
             'crm_outbound', true,
             $10, NOW(),
             $11, $12, $13
           ) RETURNING id`,
          [
            body.account_id || null,
            sendResult.messageId || null,
            fromEmail,
            toEmailsJson,
            ccEmailsJson,
            subject,
            bodyText,
            bodyHtml,
            (bodyText || '').slice(0, 200),
            request.user.id,
            corr.tender_id || null,
            corr.work_id || null,
            corr.id
          ]
        );
        emailId = ins.rows[0]?.id || null;
      } catch (e) {
        // Если в emails нет колонки linked_correspondence_id (старый прод) —
        // делаем INSERT без неё, чтобы не падать. Это Finding для S-10 AUD:
        // V252 должен был добавить эту колонку (см. контракт), если нет —
        // добавить в V253 hotfix.
        if (/column "linked_correspondence_id"/i.test(e.message || '')) {
          fastify.log.warn({ err: e }, 'send-email: emails.linked_correspondence_id отсутствует, INSERT без неё');
          const ins2 = await db.query(
            `INSERT INTO emails (
               account_id, direction, message_id,
               from_email, from_name, to_emails, cc_emails,
               subject, body_text, body_html, snippet,
               email_type, is_read,
               sent_by_user_id, email_date,
               linked_tender_id, linked_work_id
             ) VALUES (
               $1, 'outbound', $2, $3, '', $4::jsonb, $5::jsonb,
               $6, $7, $8, $9, 'crm_outbound', true,
               $10, NOW(), $11, $12
             ) RETURNING id`,
            [
              body.account_id || null,
              sendResult.messageId || null,
              fromEmail,
              toEmailsJson,
              ccEmailsJson,
              subject,
              bodyText,
              bodyHtml,
              (bodyText || '').slice(0, 200),
              request.user.id,
              corr.tender_id || null,
              corr.work_id || null
            ]
          );
          emailId = ins2.rows[0]?.id || null;
        } else {
          throw e;
        }
      }

      await db.query(
        `UPDATE correspondence
            SET email_id = $1, signing_status = 'sent', sent_at = NOW(), status = 'sent', updated_at = NOW()
          WHERE id = $2`,
        [emailId, corr.id]
      );

      return {
        success: true,
        messageId: sendResult.messageId || null,
        email_id: emailId,
        attachments_count: attachments.length,
        correspondence: {
          id: corr.id,
          number: corr.number,
          signing_status: 'sent'
        }
      };
    } catch (err) {
      if (err.statusCode) return reply.code(err.statusCode).send({ error: err.message });
      fastify.log.error({ err }, 'letter/send-email error');
      return reply.code(500).send({ error: `Не удалось отправить письмо: ${err.message}` });
    }
  });
};

module.exports.CORRESPONDENCE_ROLES = CORRESPONDENCE_ROLES;
module.exports.MAILBOX_ROLES = MAILBOX_ROLES;
module.exports.DIRECTOR_ROLES = DIRECTOR_ROLES;
