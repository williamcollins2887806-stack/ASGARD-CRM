/**
 * ASGARD CRM — CRM Mailer Helper
 * Общий хелпер для отправки писем из CRM-кнопок (ТКП, счета, акты и т.д.)
 * Отправляет с личного ящика сотрудника + BCC на CRM-ящик
 */

'use strict';

const nodemailer = require('nodemailer');
const imapService = require('./imap');

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

  // 3. Fallback — ENV
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

  const options = {
    from,
    to: mailOptions.to,
    subject: mailOptions.subject,
    text: mailOptions.text || '',
    html: mailOptions.html || '',
    attachments: mailOptions.attachments || []
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
  } catch (e) {
    console.error('[CRM-Mailer] Log error:', e.message);
  }

  return { success: true, messageId: result.messageId, from: fromEmail };
}

module.exports = {
  getTransportForUser,
  getCrmBccAddress,
  sendCrmEmail
};
