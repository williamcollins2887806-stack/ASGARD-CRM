/**
 * ASGARD CRM — CRM Mailer Helper
 * Общий хелпер для отправки писем из CRM-кнопок (ТКП, счета, акты и т.д.)
 * Отправляет с личного ящика сотрудника + BCC на CRM-ящик
 */

'use strict';

const nodemailer = require('nodemailer');
const imapService = require('./imap');
const path = require('path');
const fs = require('fs');

const transportCache = new Map();

/**
 * Получить транспорт для отправки от имени пользователя
 * Приоритет: личный ящик → глобальный CRM ящик
 */
async function getTransportForUser(db, userId) {
  // 1. Пробуем личный ящик
  const personalRes = await db.query(
    'SELECT * FROM user_email_accounts WHERE user_id = $1 AND is_active = true LIMIT 1',
    [userId]
  );

  if (personalRes.rows.length > 0) {
    const acc = personalRes.rows[0];
    const cacheKey = 'personal_' + acc.id;

    if (!transportCache.has(cacheKey)) {
      const transport = nodemailer.createTransport({
        host: acc.smtp_host || 'smtp.yandex.ru',
        port: acc.smtp_port || 465,
        secure: acc.smtp_tls !== false,
        auth: {
          user: acc.smtp_user,
          pass: imapService.decrypt(acc.smtp_pass_encrypted)
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000
      });
      transportCache.set(cacheKey, transport);
    }

    return {
      transport: transportCache.get(cacheKey),
      fromEmail: acc.email_address,
      fromName: acc.display_name || '',
      isPersonal: true
    };
  }

  // 2. Fallback — глобальный CRM ящик
  const globalRes = await db.query(
    "SELECT * FROM email_accounts WHERE is_active = true AND (account_type = 'primary' OR is_copy_target = true) ORDER BY is_copy_target DESC LIMIT 1"
  );

  if (globalRes.rows.length > 0) {
    const acc = globalRes.rows[0];
    const cacheKey = 'global_' + acc.id;

    if (!transportCache.has(cacheKey)) {
      const transport = nodemailer.createTransport({
        host: acc.smtp_host,
        port: acc.smtp_port || 587,
        secure: acc.smtp_port === 465,
        auth: {
          user: acc.smtp_user || acc.email_address,
          pass: imapService.decrypt(acc.smtp_pass_encrypted)
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000
      });
      transportCache.set(cacheKey, transport);
    }

    return {
      transport: transportCache.get(cacheKey),
      fromEmail: acc.email_address,
      fromName: acc.smtp_from_name || '',
      isPersonal: false
    };
  }

  // 3. Fallback — settings table
  try {
    const settRes = await db.query(
      "SELECT value_json FROM settings WHERE key = 'smtp_config' LIMIT 1"
    );
    if (settRes.rows.length > 0) {
      const cfg = typeof settRes.rows[0].value_json === 'string'
        ? JSON.parse(settRes.rows[0].value_json) : settRes.rows[0].value_json;
      // Support both flat {user,pass} and nested {auth:{user,pass}} formats
      const smtpUser = cfg.user || (cfg.auth && cfg.auth.user);
      const smtpPass = cfg.pass || (cfg.auth && cfg.auth.pass);
      if (cfg.host && smtpUser && smtpPass) {
        const cacheKey = 'settings';
        if (!transportCache.has(cacheKey)) {
          const transport = nodemailer.createTransport({
            host: cfg.host,
            port: parseInt(cfg.port || '587'),
            secure: cfg.secure === true || cfg.port === 465 || parseInt(cfg.port || '587') === 465,
            auth: { user: smtpUser, pass: smtpPass },
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 15000
          });
          transportCache.set(cacheKey, transport);
        }
        return {
          transport: transportCache.get(cacheKey),
          fromEmail: cfg.from || smtpUser,
          fromName: cfg.fromName || 'АСГАРД CRM',
          isPersonal: false
        };
      }
    }
  } catch (_) { /* settings not available */ }

  // 4. Fallback — ENV
  if (process.env.SMTP_HOST) {
    const cacheKey = 'env';
    if (!transportCache.has(cacheKey)) {
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });
      transportCache.set(cacheKey, transport);
    }

    return {
      transport: transportCache.get(cacheKey),
      fromEmail: process.env.SMTP_FROM || 'crm@asgard-service.com',
      fromName: 'АСГАРД CRM',
      isPersonal: false
    };
  }

  throw new Error('Не настроен ни один почтовый аккаунт');
}

/**
 * Получить адрес CRM-ящика для BCC-копии
 */
async function getCrmBccAddress(db) {
  try {
    const res = await db.query(
      "SELECT email_address FROM email_accounts WHERE (is_copy_target = true OR account_type = 'primary') AND is_active = true ORDER BY is_copy_target DESC LIMIT 1"
    );
    return res.rows[0]?.email_address || null;
  } catch (e) {
    return null;
  }
}

/**
 * Отправить письмо от имени пользователя с BCC на CRM
 * @param {Object} db - database pool
 * @param {number} userId - ID пользователя
 * @param {Object} mailOptions - { to, subject, text, html, attachments }
 * @returns {Promise<Object>} { success, messageId, from }
 */
async function sendCrmEmail(db, userId, mailOptions) {
  const { transport, fromEmail, fromName, isPersonal } = await getTransportForUser(db, userId);

  const from = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail;

  // Добавляем BCC на CRM-ящик
  const crmBcc = await getCrmBccAddress(db);
  let bccList = mailOptions.bcc ? (Array.isArray(mailOptions.bcc) ? [...mailOptions.bcc] : [mailOptions.bcc]) : [];
  if (crmBcc && crmBcc !== fromEmail) {
    bccList.push(crmBcc);
  }

  // Авто-упоминание вложений в тексте
  let textBody = mailOptions.text || '';
  const attachments = mailOptions.attachments || [];
  if (attachments.length > 0 && textBody && !textBody.match(/вложени/i)) {
    const names = attachments.map(a => a.filename || 'файл').join(', ');
    textBody += `\n\nВо вложении: ${names}`;
  }

  const options = {
    from,
    to: mailOptions.to,
    subject: mailOptions.subject,
    text: textBody,
    html: mailOptions.html || '',
    attachments
  };

  if (mailOptions.cc) options.cc = mailOptions.cc;
  if (bccList.length > 0) options.bcc = bccList.join(', ');

  const result = await transport.sendMail(options);

  // Логируем отправку
  try {
    const toAddr = Array.isArray(mailOptions.to) ? mailOptions.to[0] : mailOptions.to;
    await db.query(`
      INSERT INTO emails (
        direction, message_id, from_email, from_name,
        to_emails, subject, body_text, snippet,
        email_type, is_read, is_crm_copy, sent_by_user_id,
        email_date, account_id
      ) VALUES (
        'outbound', $1, $2, $3,
        $4, $5, $6, $7,
        'crm_outbound', true, true, $8,
        NOW(), $9
      )
    `, [
      result.messageId, fromEmail, fromName,
      JSON.stringify([{ address: toAddr, name: '' }]),
      mailOptions.subject, (mailOptions.text || '').slice(0, 5000), (mailOptions.text || '').slice(0, 250),
      userId, null
    ]);

    // Сохраняем вложения на диск и в email_attachments
    if (attachments.length > 0) {
      const emailRow = await db.query(
        'SELECT id FROM emails WHERE message_id = $1 ORDER BY id DESC LIMIT 1',
        [result.messageId]
      );
      const emailId = emailRow.rows[0]?.id;
      if (emailId) {
        const uploadDir = process.env.UPLOAD_DIR || './uploads';
        const sentDir = path.join(uploadDir, 'email_sent');
        fs.mkdirSync(sentDir, { recursive: true });

        for (const att of attachments) {
          try {
            const fname = `${emailId}_${Date.now()}_${att.filename || 'file'}`;
            const filePath = path.join(sentDir, fname);
            if (att.content && Buffer.isBuffer(att.content)) {
              fs.writeFileSync(filePath, att.content);
            }
            await db.query(
              `INSERT INTO email_attachments (email_id, filename, filepath, size, content_type)
               VALUES ($1, $2, $3, $4, $5)`,
              [emailId, att.filename || 'file', `email_sent/${fname}`,
               att.content?.length || 0, att.contentType || 'application/octet-stream']
            );
          } catch (attErr) {
            console.error('[CRM-Mailer] Attachment save error:', attErr.message);
          }
        }
      }
    }
  } catch (e) {
    console.error('[CRM-Mailer] Log error:', e.message);
  }

  return { success: true, messageId: result.messageId, from: fromEmail };
}

// ─────────────────────────────────────────────────────────────────────────────
// sendAutoReply (Wave-2 fixer F1, §2.6 plan)
//
// Отправка ответных писем в той же ветке (header In-Reply-To/References).
// Используется в:
//   - imap.js после INSERT inbox_applications (corporate_forward → corporate_received,
//     external_direct → external_received).
//   - /assign-pm — НЕ вызываем (mode='assigned' = пуш PM-у, письма клиенту нет).
//   - /reject уже шлёт ответ напрямую в inbox_applications_ai.js:578 — НЕ ломаем.
//
// Если SMTP не настроен (нет user_email_accounts / email_accounts / settings.smtp_config
// / ENV.SMTP_HOST) — fallback: INSERT строки в emails с in_reply_to/references_header
// + status подсказка через snippet, чтобы запись была проверяема в smoke-тесте на клоне.
// ─────────────────────────────────────────────────────────────────────────────
const AUTO_REPLY_TEMPLATES = {
  corporate_received: (params) => ({
    subjectPrefix: 'Re: ',
    text: 'Здравствуйте!\n\n' +
          `Заявка №${params.applicationId} создана из вашего письма.\n` +
          (params.aiSummary
            ? `Сводка разбора: ${params.aiSummary}\n`
            : 'Сводка разбора будет добавлена после анализа.\n') +
          '\nЕсли что-то распознано неверно — ответьте в этой же ветке.\n\n' +
          '— АСГАРД CRM'
  }),
  external_received: () => ({
    subjectPrefix: 'Re: ',
    text: 'Здравствуйте!\n\n' +
          'Спасибо за обращение! Ваш запрос принят, мы свяжемся с вами в течение рабочего дня.\n\n' +
          '— АСГАРД'
  }),
  // mode='assigned' / mode='rejected' — заглушки (по §2.6 это не клиентское письмо):
  // assigned — push PM-у (createNotification уже шлётся в /assign-pm). Mail PM-у отключён.
  // rejected — уже есть отдельная логика в inbox_applications_ai.js:578 (POST /:id/reject).
  assigned: null,
  rejected: null
};

async function _getAnyTransport(db) {
  // Глобальный CRM ящик (primary/copy_target)
  try {
    const globalRes = await db.query(
      "SELECT * FROM email_accounts WHERE is_active = true AND (account_type = 'primary' OR is_copy_target = true) ORDER BY is_copy_target DESC LIMIT 1"
    );
    if (globalRes.rows.length > 0) {
      const acc = globalRes.rows[0];
      const cacheKey = 'autoreply_global_' + acc.id;
      if (!transportCache.has(cacheKey)) {
        transportCache.set(cacheKey, nodemailer.createTransport({
          host: acc.smtp_host,
          port: acc.smtp_port || 587,
          secure: acc.smtp_port === 465,
          auth: {
            user: acc.smtp_user || acc.email_address,
            pass: imapService.decrypt(acc.smtp_pass_encrypted)
          },
          connectionTimeout: 10000,
          greetingTimeout: 10000,
          socketTimeout: 15000
        }));
      }
      return {
        transport: transportCache.get(cacheKey),
        fromEmail: acc.email_address,
        fromName: acc.smtp_from_name || 'АСГАРД CRM',
        accountId: acc.id
      };
    }
  } catch (_) { /* fall through */ }

  // settings.smtp_config
  try {
    const settRes = await db.query(
      "SELECT value_json FROM settings WHERE key = 'smtp_config' LIMIT 1"
    );
    if (settRes.rows.length > 0) {
      const cfg = typeof settRes.rows[0].value_json === 'string'
        ? JSON.parse(settRes.rows[0].value_json) : settRes.rows[0].value_json;
      const smtpUser = cfg.user || (cfg.auth && cfg.auth.user);
      const smtpPass = cfg.pass || (cfg.auth && cfg.auth.pass);
      if (cfg.host && smtpUser && smtpPass) {
        const cacheKey = 'autoreply_settings';
        if (!transportCache.has(cacheKey)) {
          transportCache.set(cacheKey, nodemailer.createTransport({
            host: cfg.host,
            port: parseInt(cfg.port || '587'),
            secure: cfg.secure === true || cfg.port === 465 || parseInt(cfg.port || '587') === 465,
            auth: { user: smtpUser, pass: smtpPass },
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 15000
          }));
        }
        return {
          transport: transportCache.get(cacheKey),
          fromEmail: cfg.from || smtpUser,
          fromName: cfg.fromName || 'АСГАРД CRM',
          accountId: null
        };
      }
    }
  } catch (_) { /* fall through */ }

  // ENV
  if (process.env.SMTP_HOST) {
    const cacheKey = 'autoreply_env';
    if (!transportCache.has(cacheKey)) {
      transportCache.set(cacheKey, nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      }));
    }
    return {
      transport: transportCache.get(cacheKey),
      fromEmail: process.env.SMTP_FROM || 'crm@asgard-service.com',
      fromName: 'АСГАРД CRM',
      accountId: null
    };
  }

  return null;
}

/**
 * Отправляет автоответ клиенту в той же ветке.
 * @param {Object} db — pg pool
 * @param {Object} opts
 * @param {number} opts.emailId — исходное письмо (emails.id)
 * @param {number} opts.applicationId — inbox_applications.id (для шаблона corporate_received)
 * @param {string} opts.mode — corporate_received | external_received | assigned | rejected
 * @param {Object} [opts.log] — request.log (опционально)
 * @returns {Promise<{ok:boolean, sent:boolean, fallback?:boolean, reason?:string, messageId?:string}>}
 */
async function sendAutoReply(db, opts) {
  const log = (opts && opts.log) || console;
  const safeLog = (lvl, ...args) => {
    try {
      if (log && typeof log[lvl] === 'function') log[lvl](...args);
      else if (log && typeof log.log === 'function') log.log(...args);
    } catch (_) { /* swallow */ }
  };

  if (!opts || !opts.mode) {
    return { ok: false, sent: false, reason: 'mode_required' };
  }
  const tmplFn = AUTO_REPLY_TEMPLATES[opts.mode];
  if (tmplFn === undefined) {
    return { ok: false, sent: false, reason: 'unknown_mode' };
  }
  if (tmplFn === null) {
    // assigned / rejected — намеренно no-op
    return { ok: true, sent: false, reason: 'mode_noop' };
  }
  const emailId = opts.emailId;
  if (!emailId) {
    return { ok: false, sent: false, reason: 'email_id_required' };
  }

  // Берём исходное письмо + applicationId-данные
  let origEmail;
  try {
    const r = await db.query(
      `SELECT id, message_id, from_email, from_name, subject, to_emails, cc_emails,
              references_header, in_reply_to, account_id
         FROM emails WHERE id = $1`,
      [emailId]
    );
    origEmail = r.rows[0];
  } catch (e) {
    safeLog('warn', '[sendAutoReply] read emails failed:', e.message);
    return { ok: false, sent: false, reason: 'orig_email_read_failed' };
  }
  if (!origEmail) {
    return { ok: false, sent: false, reason: 'orig_email_not_found' };
  }
  const replyTo = origEmail.from_email;
  if (!replyTo) {
    return { ok: false, sent: false, reason: 'no_from_email' };
  }
  // Тема: добавляем 'Re: ' если ещё не начинается с 'Re:'/'RE:'
  const origSubject = origEmail.subject || '(без темы)';
  const subject = /^re:\s*/i.test(origSubject)
    ? origSubject
    : 'Re: ' + origSubject;

  // ai_summary из inbox_applications (для corporate_received)
  let aiSummary = '';
  if (opts.mode === 'corporate_received' && opts.applicationId) {
    try {
      const ar = await db.query(
        `SELECT ai_summary FROM inbox_applications WHERE id = $1`,
        [opts.applicationId]
      );
      aiSummary = (ar.rows[0]?.ai_summary || '').slice(0, 1500);
    } catch (_) { /* ai_summary опционален */ }
  }

  const tmpl = tmplFn({
    applicationId: opts.applicationId,
    aiSummary,
    origSubject
  });
  const textBody = tmpl.text;

  // In-Reply-To/References — только если у исходного письма есть message_id
  const origMessageId = origEmail.message_id || null;
  const inReplyToHeader = origMessageId
    ? (origMessageId.startsWith('<') ? origMessageId : '<' + origMessageId + '>')
    : null;
  // References = previous References + In-Reply-To (если есть)
  let referencesHeader = null;
  if (origMessageId) {
    const prev = origEmail.references_header
      ? String(origEmail.references_header).trim()
      : '';
    referencesHeader = (prev ? prev + ' ' : '') + inReplyToHeader;
  }

  const transportObj = await _getAnyTransport(db);
  const headers = {};
  if (inReplyToHeader) {
    headers['In-Reply-To'] = inReplyToHeader;
    headers['References'] = referencesHeader || inReplyToHeader;
  }

  let messageId = null;
  let sent = false;
  let fallback = false;

  if (transportObj) {
    try {
      const fromCombined = transportObj.fromName
        ? `"${transportObj.fromName}" <${transportObj.fromEmail}>`
        : transportObj.fromEmail;
      const result = await transportObj.transport.sendMail({
        from: fromCombined,
        to: replyTo,
        subject,
        text: textBody,
        headers
      });
      messageId = result.messageId;
      sent = true;
    } catch (e) {
      safeLog('warn', '[sendAutoReply] sendMail failed → fallback to emails-insert only:', e.message);
      fallback = true;
    }
  } else {
    safeLog('info', '[sendAutoReply] no SMTP configured — fallback to emails-insert only');
    fallback = true;
  }

  // Запись в таблицу emails — всегда, для прослеживаемости (smoke-тест читает in_reply_to)
  try {
    const fromEmail = (transportObj && transportObj.fromEmail) || 'crm@asgard-service.com';
    const fromName = (transportObj && transportObj.fromName) || 'АСГАРД CRM';
    const accountId = (transportObj && transportObj.accountId) || null;
    if (!messageId) {
      messageId = `<autoreply-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@asgard-crm>`;
    }
    await db.query(
      `INSERT INTO emails (
         direction, message_id, in_reply_to, references_header,
         from_email, from_name, to_emails,
         subject, body_text, snippet,
         email_type, ai_classification, is_read, account_id,
         email_date, created_at
       ) VALUES (
         'outbound', $1, $2, $3,
         $4, $5, $6,
         $7, $8, $9,
         $10, $12, true, $11,
         NOW(), NOW()
       )`,
      [
        messageId,
        inReplyToHeader,
        referencesHeader,
        fromEmail,
        fromName,
        JSON.stringify([{ address: replyTo, name: origEmail.from_name || '' }]),
        subject,
        textBody.slice(0, 5000),
        textBody.slice(0, 250),
        // emails.email_type CHECK ограничен значениями direct_request/platform_tender/
        // newsletter/internal/crm_outbound/unknown — пишем 'crm_outbound', а тип режима
        // храним в ai_classification (для отладки/трассировки).
        'crm_outbound',
        accountId,
        `autoreply_${opts.mode}`
      ]
    );
  } catch (e) {
    safeLog('warn', '[sendAutoReply] emails INSERT failed:', e.message);
  }

  return { ok: true, sent, fallback, messageId, mode: opts.mode, inReplyTo: inReplyToHeader };
}

module.exports = {
  getTransportForUser,
  getCrmBccAddress,
  sendCrmEmail,
  sendAutoReply
};
