/**
 * ASGARD CRM — Mailbox Routes (Фаза 8)
 * Полная интеграция почты: IMAP, отправка, шаблоны, классификация
 * Prefix: /api/mailbox
 */

const nodemailer = require('nodemailer');
const imapService = require('../services/imap');
const classifier = require('../services/email-classifier');
const letterhead = require('../services/email-letterhead');
const path = require('path');
const fs = require('fs');

const MAILBOX_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_TO'];
const ADMIN_ROLES = ['ADMIN'];
const SETTINGS_ROLES = ['ADMIN', 'DIRECTOR_GEN'];

function hasRole(user, roles) {
  return roles.includes(user.role);
}

async function routes(fastify, options) {
  const db = fastify.db;

  // ── Helpers ─────────────────────────────────────────────────────────
  function checkMailboxAccess(request, reply) {
    if (!hasRole(request.user, MAILBOX_ROLES)) {
      reply.code(403).send({ error: 'Нет доступа к почте' });
      return false;
    }
    return true;
  }

  // SMTP transporter (reuse from existing email.js pattern)
  let smtpTransporter = null;

  async function getSmtpTransporter(accountId) {
    // If specific account requested, use its SMTP settings
    if (accountId) {
      const acc = await db.query('SELECT * FROM email_accounts WHERE id = $1', [accountId]);
      if (acc.rows.length > 0 && acc.rows[0].smtp_host) {
        const a = acc.rows[0];
        return nodemailer.createTransport({
          host: a.smtp_host,
          port: a.smtp_port || 587,
          secure: a.smtp_tls !== false,
          auth: {
            user: a.smtp_user,
            pass: imapService.decrypt(a.smtp_pass_encrypted)
          }
        });
      }
    }

    // Fallback to global SMTP (from settings or ENV)
    if (smtpTransporter) return smtpTransporter;

    try {
      const result = await db.query("SELECT value_json FROM settings WHERE key = 'smtp_config'");
      if (result.rows.length > 0) {
        const config = JSON.parse(result.rows[0].value_json);
        smtpTransporter = nodemailer.createTransport(config);
        return smtpTransporter;
      }
    } catch (e) {}

    if (process.env.SMTP_HOST) {
      smtpTransporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });
      return smtpTransporter;
    }

    // Test mode
    return {
      sendMail: async (opts) => {
        console.log('[Mailbox] Email (test mode):', opts.to, opts.subject);
        return { messageId: 'test_' + Date.now() + '@asgard' };
      }
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // 1. EMAIL LIST (inbox / outbox / all)
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/emails', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!checkMailboxAccess(request, reply)) return;

    const {
      direction, type, is_read, is_starred, is_archived, is_deleted, is_draft,
      search, account_id, folder,
      sort = 'email_date', order = 'DESC',
      limit = 50, offset = 0
    } = request.query;

    const conditions = [];
    const params = [];
    let idx = 1;

    // По умолчанию не показываем удалённые, кроме папки Корзина
    if (is_deleted !== undefined) {
      conditions.push(`e.is_deleted = $${idx++}`); params.push(is_deleted === 'true');
    } else {
      conditions.push('e.is_deleted = false');
    }

    // По умолчанию не показываем черновики в обычных папках
    if (is_draft !== undefined) {
      conditions.push(`e.is_draft = $${idx++}`); params.push(is_draft === 'true');
    } else {
      conditions.push('e.is_draft = false');
    }

    if (direction) { conditions.push(`e.direction = $${idx++}`); params.push(direction); }
    if (type) { conditions.push(`e.email_type = $${idx++}`); params.push(type); }
    if (is_read !== undefined) { conditions.push(`e.is_read = $${idx++}`); params.push(is_read === 'true'); }
    if (is_starred !== undefined) { conditions.push(`e.is_starred = $${idx++}`); params.push(is_starred === 'true'); }
    if (is_archived !== undefined) { conditions.push(`e.is_archived = $${idx++}`); params.push(is_archived === 'true'); }
    if (account_id) { conditions.push(`e.account_id = $${idx++}`); params.push(parseInt(account_id)); }
    if (folder) { conditions.push(`e.imap_folder = $${idx++}`); params.push(folder); }

    if (search) {
      conditions.push(`(e.subject ILIKE $${idx} OR e.from_email ILIKE $${idx} OR e.from_name ILIKE $${idx} OR e.snippet ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const allowedSort = ['email_date', 'from_email', 'subject', 'email_type'];
    const sortCol = allowedSort.includes(sort) ? sort : 'email_date';
    const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const where = conditions.join(' AND ');

    const [countRes, dataRes] = await Promise.all([
      db.query(`SELECT COUNT(*) FROM emails e WHERE ${where}`, params),
      db.query(`
        SELECT e.id, e.direction, e.message_id, e.thread_id,
          e.from_email, e.from_name, e.to_emails, e.cc_emails,
          e.subject, e.snippet,
          e.email_type, e.classification_confidence,
          e.is_read, e.is_starred, e.is_archived, e.is_draft,
          e.has_attachments, e.attachment_count,
          e.linked_tender_id, e.linked_work_id,
          e.email_date, e.account_id,
          ea.name as account_name
        FROM emails e
        LEFT JOIN email_accounts ea ON ea.id = e.account_id
        WHERE ${where}
        ORDER BY e.${sortCol} ${sortOrder}
        LIMIT $${idx} OFFSET $${idx + 1}
      `, [...params, parseInt(limit), parseInt(offset)])
    ]);

    return {
      emails: dataRes.rows,
      total: parseInt(countRes.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. SINGLE EMAIL DETAIL
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/emails/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!checkMailboxAccess(request, reply)) return;

    const { id } = request.params;
    const result = await db.query('SELECT * FROM emails WHERE id = $1', [id]);
    if (result.rows.length === 0) return reply.code(404).send({ error: 'Письмо не найдено' });

    const email = result.rows[0];

    // Mark as read
    if (!email.is_read) {
      await db.query('UPDATE emails SET is_read = true, updated_at = NOW() WHERE id = $1', [id]);
      email.is_read = true;
    }

    // Get attachments
    const attRes = await db.query(
      'SELECT id, filename, original_filename, mime_type, size, content_id, is_inline FROM email_attachments WHERE email_id = $1 ORDER BY id',
      [id]
    );

    // Get thread emails
    let thread = [];
    if (email.thread_id) {
      const threadRes = await db.query(
        `SELECT id, direction, from_email, from_name, subject, snippet, email_date, is_read
         FROM emails WHERE thread_id = $1 AND id != $2 ORDER BY email_date ASC`,
        [email.thread_id, id]
      );
      thread = threadRes.rows;
    }

    return {
      email,
      attachments: attRes.rows,
      thread
    };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. UPDATE EMAIL FLAGS (read, starred, archived, deleted)
  // ═══════════════════════════════════════════════════════════════════
  fastify.patch('/emails/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!checkMailboxAccess(request, reply)) return;

    const { id } = request.params;
    const allowed = ['is_read', 'is_starred', 'is_archived', 'is_deleted', 'is_spam', 'email_type', 'linked_tender_id', 'linked_work_id'];
    const updates = [];
    const params = [];
    let idx = 1;

    for (const [key, val] of Object.entries(request.body || {})) {
      if (allowed.includes(key)) {
        updates.push(`${key} = $${idx++}`);
        params.push(val);
      }
    }

    if (updates.length === 0) return reply.code(400).send({ error: 'Нет полей для обновления' });

    updates.push(`updated_at = NOW()`);
    params.push(parseInt(id));

    await db.query(`UPDATE emails SET ${updates.join(', ')} WHERE id = $${idx}`, params);
    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. BULK UPDATE (mark as read, delete, archive)
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/emails/bulk', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!checkMailboxAccess(request, reply)) return;

    const { ids, action } = request.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return reply.code(400).send({ error: 'Укажите ids' });
    }

    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');

    switch (action) {
      case 'mark_read':
        await db.query(`UPDATE emails SET is_read = true, updated_at = NOW() WHERE id IN (${placeholders})`, ids);
        break;
      case 'mark_unread':
        await db.query(`UPDATE emails SET is_read = false, updated_at = NOW() WHERE id IN (${placeholders})`, ids);
        break;
      case 'archive':
        await db.query(`UPDATE emails SET is_archived = true, updated_at = NOW() WHERE id IN (${placeholders})`, ids);
        break;
      case 'unarchive':
        await db.query(`UPDATE emails SET is_archived = false, updated_at = NOW() WHERE id IN (${placeholders})`, ids);
        break;
      case 'delete':
        await db.query(`UPDATE emails SET is_deleted = true, updated_at = NOW() WHERE id IN (${placeholders})`, ids);
        break;
      case 'star':
        await db.query(`UPDATE emails SET is_starred = true, updated_at = NOW() WHERE id IN (${placeholders})`, ids);
        break;
      case 'unstar':
        await db.query(`UPDATE emails SET is_starred = false, updated_at = NOW() WHERE id IN (${placeholders})`, ids);
        break;
      case 'spam':
        await db.query(`UPDATE emails SET is_spam = true, is_deleted = true, updated_at = NOW() WHERE id IN (${placeholders})`, ids);
        break;
      default:
        return reply.code(400).send({ error: `Неизвестное действие: ${action}` });
    }

    return { success: true, affected: ids.length };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 5. DOWNLOAD ATTACHMENT
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/attachments/:id/download', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!checkMailboxAccess(request, reply)) return;

    const { id } = request.params;
    const att = await db.query('SELECT * FROM email_attachments WHERE id = $1', [id]);
    if (att.rows.length === 0) return reply.code(404).send({ error: 'Вложение не найдено' });

    const attachment = att.rows[0];
    const filePath = path.join(__dirname, '..', '..', attachment.file_path);

    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ error: 'Файл не найден на диске' });
    }

    const stream = fs.createReadStream(filePath);
    return reply
      .header('Content-Type', attachment.mime_type || 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.original_filename || attachment.filename)}"`)
      .send(stream);
  });

  // ═══════════════════════════════════════════════════════════════════
  // 6. SEND EMAIL (compose / reply / forward)
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/send', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!checkMailboxAccess(request, reply)) return;

    const {
      to, cc, bcc, subject, body_html, body_text,
      account_id, template_id,
      reply_to_email_id, forward_of_email_id,
      use_letterhead = false,
      attachments = []
    } = request.body;

    if (!to || !subject) {
      return reply.code(400).send({ error: 'Укажите получателя и тему' });
    }

    const user = request.user;

    try {
      // Get account info for From address
      let fromEmail = process.env.SMTP_FROM || '"АСГАРД CRM" <noreply@asgard-service.ru>';
      let fromName = 'ООО «Асгард Сервис»';
      if (account_id) {
        const accRes = await db.query('SELECT email_address, smtp_from_name FROM email_accounts WHERE id = $1', [account_id]);
        if (accRes.rows.length > 0) {
          fromEmail = `"${accRes.rows[0].smtp_from_name || fromName}" <${accRes.rows[0].email_address}>`;
        }
      }

      // Wrap in letterhead if requested
      let finalHtml = body_html || (body_text || '').replace(/\n/g, '<br>');
      if (use_letterhead) {
        // Get sender info from DB
        const senderRes = await db.query('SELECT fio, full_name, phone, email FROM employees WHERE user_id = $1', [user.id]).catch(() => ({ rows: [] }));
        const sender = senderRes.rows[0] || {};
        finalHtml = letterhead.wrapInLetterhead(finalHtml, {
          senderName: sender.full_name || sender.fio || user.username,
          senderPosition: '',
          senderPhone: sender.phone || '',
          senderEmail: sender.email || ''
        });
      }

      // Build In-Reply-To / References headers
      const headers = {};
      if (reply_to_email_id) {
        const origRes = await db.query('SELECT message_id, references_header FROM emails WHERE id = $1', [reply_to_email_id]);
        if (origRes.rows.length > 0) {
          const orig = origRes.rows[0];
          if (orig.message_id) {
            headers['In-Reply-To'] = orig.message_id;
            headers['References'] = (orig.references_header ? orig.references_header + ' ' : '') + orig.message_id;
          }
        }
      }

      const transport = await getSmtpTransporter(account_id);

      const mailOptions = {
        from: fromEmail,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject,
        html: finalHtml,
        text: body_text || '',
        headers
      };

      if (cc) mailOptions.cc = Array.isArray(cc) ? cc.join(', ') : cc;
      if (bcc) mailOptions.bcc = Array.isArray(bcc) ? bcc.join(', ') : bcc;

      // Attachments (base64 or file path)
      if (attachments.length > 0) {
        mailOptions.attachments = attachments.map(a => {
          if (a.content) {
            return { filename: a.filename || a.name, content: a.content, encoding: 'base64' };
          }
          if (a.path) {
            return { filename: a.filename || a.name, path: path.join(__dirname, '..', '..', a.path) };
          }
          return null;
        }).filter(Boolean);
      }

      // Forward attachments
      if (forward_of_email_id) {
        const fwdAtts = await db.query('SELECT * FROM email_attachments WHERE email_id = $1 AND is_inline = false', [forward_of_email_id]);
        for (const fa of fwdAtts.rows) {
          const fpath = path.join(__dirname, '..', '..', fa.file_path);
          if (fs.existsSync(fpath)) {
            if (!mailOptions.attachments) mailOptions.attachments = [];
            mailOptions.attachments.push({ filename: fa.original_filename || fa.filename, path: fpath });
          }
        }
      }

      const result = await transport.sendMail(mailOptions);

      // Compute thread
      let threadId = null;
      if (reply_to_email_id) {
        const origRes = await db.query('SELECT thread_id FROM emails WHERE id = $1', [reply_to_email_id]);
        if (origRes.rows.length > 0) threadId = origRes.rows[0].thread_id;
      }

      // Save sent email to DB
      const toEmails = (Array.isArray(to) ? to : [to]).map(e => ({ address: e.trim(), name: '' }));
      const ccEmails = cc ? (Array.isArray(cc) ? cc : [cc]).map(e => ({ address: e.trim(), name: '' })) : [];

      await db.query(`
        INSERT INTO emails (
          account_id, direction, message_id, in_reply_to, references_header, thread_id,
          from_email, from_name, to_emails, cc_emails,
          subject, body_text, body_html, snippet,
          email_type, is_read,
          sent_by_user_id, template_id, reply_to_email_id, forward_of_email_id,
          email_date
        ) VALUES (
          $1, 'outbound', $2, $3, $4, $5,
          $6, $7, $8, $9,
          $10, $11, $12, $13,
          'crm_outbound', true,
          $14, $15, $16, $17,
          NOW()
        )
      `, [
        account_id || null,
        result.messageId,
        mailOptions.headers?.['In-Reply-To'] || null,
        mailOptions.headers?.['References'] || null,
        threadId,
        fromEmail, fromName,
        JSON.stringify(toEmails), JSON.stringify(ccEmails),
        subject, body_text || '', finalHtml, (body_text || '').slice(0, 250),
        user.id, template_id || null, reply_to_email_id || null, forward_of_email_id || null
      ]);

      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error('[Mailbox] Send error:', error);
      return reply.code(500).send({ error: 'Ошибка отправки: ' + error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 7. SAVE DRAFT
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/drafts', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!checkMailboxAccess(request, reply)) return;

    const { id, to, cc, subject, body_html, body_text, account_id, reply_to_email_id } = request.body;
    const user = request.user;

    const toEmails = to ? (Array.isArray(to) ? to : [to]).map(e => ({ address: e.trim(), name: '' })) : [];
    const ccEmails = cc ? (Array.isArray(cc) ? cc : [cc]).map(e => ({ address: e.trim(), name: '' })) : [];

    if (id) {
      // Update existing draft
      await db.query(`
        UPDATE emails SET to_emails = $1, cc_emails = $2, subject = $3,
          body_html = $4, body_text = $5, snippet = $6, updated_at = NOW()
        WHERE id = $7 AND is_draft = true
      `, [JSON.stringify(toEmails), JSON.stringify(ccEmails), subject || '', body_html || '', body_text || '', (body_text || '').slice(0, 250), id]);
      return { success: true, id: parseInt(id) };
    }

    // Create new draft
    const res = await db.query(`
      INSERT INTO emails (
        account_id, direction, to_emails, cc_emails, subject,
        body_html, body_text, snippet, email_type, is_draft, is_read,
        sent_by_user_id, reply_to_email_id, email_date
      ) VALUES ($1, 'outbound', $2, $3, $4, $5, $6, $7, 'crm_outbound', true, true, $8, $9, NOW())
      RETURNING id
    `, [
      account_id || null, JSON.stringify(toEmails), JSON.stringify(ccEmails),
      subject || '', body_html || '', body_text || '', (body_text || '').slice(0, 250),
      user.id, reply_to_email_id || null
    ]);

    return { success: true, id: res.rows[0].id };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 8. UNREAD COUNT / STATS
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/stats', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!checkMailboxAccess(request, reply)) return;

    const result = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE NOT is_read AND NOT is_deleted AND NOT is_archived AND direction = 'inbound') AS unread,
        COUNT(*) FILTER (WHERE NOT is_deleted AND NOT is_archived AND direction = 'inbound') AS inbox_total,
        COUNT(*) FILTER (WHERE is_starred AND NOT is_deleted) AS starred,
        COUNT(*) FILTER (WHERE is_draft) AS drafts,
        COUNT(*) FILTER (WHERE direction = 'outbound' AND NOT is_deleted) AS sent,
        COUNT(*) FILTER (WHERE is_archived AND NOT is_deleted) AS archived,
        COUNT(*) FILTER (WHERE email_type = 'direct_request' AND NOT is_read AND NOT is_deleted) AS unread_direct,
        COUNT(*) FILTER (WHERE email_type = 'platform_tender' AND NOT is_read AND NOT is_deleted) AS unread_tender
      FROM emails
    `);

    return result.rows[0];
  });

  // ═══════════════════════════════════════════════════════════════════
  // 9. THREAD VIEW
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/threads/:threadId', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!checkMailboxAccess(request, reply)) return;

    const { threadId } = request.params;
    const result = await db.query(`
      SELECT e.*,
        (SELECT json_agg(json_build_object('id', a.id, 'filename', a.filename, 'original_filename', a.original_filename, 'mime_type', a.mime_type, 'size', a.size))
         FROM email_attachments a WHERE a.email_id = e.id) AS attachments
      FROM emails e
      WHERE e.thread_id = $1 AND NOT e.is_deleted
      ORDER BY e.email_date ASC
    `, [threadId]);

    return { thread: result.rows };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 10. ACCOUNTS — CRUD (ADMIN only)
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/accounts', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!hasRole(request.user, SETTINGS_ROLES)) {
      return reply.code(403).send({ error: 'Только для администратора' });
    }

    const result = await db.query(`
      SELECT id, name, email_address, account_type,
        imap_host, imap_port, imap_user, imap_tls, imap_folder,
        smtp_host, smtp_port, smtp_user, smtp_tls, smtp_from_name,
        sync_enabled, sync_interval_sec, sync_max_emails,
        last_sync_at, last_sync_uid, last_sync_error,
        is_active, is_copy_target, exclude_from_inbox,
        created_at, updated_at
      FROM email_accounts ORDER BY id
    `);

    return { accounts: result.rows };
  });

  fastify.post('/accounts', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!hasRole(request.user, ADMIN_ROLES)) {
      return reply.code(403).send({ error: 'Только для администратора' });
    }

    const b = request.body;
    const result = await db.query(`
      INSERT INTO email_accounts (
        name, email_address, account_type,
        imap_host, imap_port, imap_user, imap_pass_encrypted, imap_tls, imap_folder,
        smtp_host, smtp_port, smtp_user, smtp_pass_encrypted, smtp_tls, smtp_from_name,
        sync_enabled, sync_interval_sec, sync_max_emails,
        is_active, is_copy_target, exclude_from_inbox,
        created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
      RETURNING id
    `, [
      b.name, b.email_address, b.account_type || 'primary',
      b.imap_host, b.imap_port || 993, b.imap_user, imapService.encrypt(b.imap_pass), b.imap_tls !== false, b.imap_folder || 'INBOX',
      b.smtp_host, b.smtp_port || 587, b.smtp_user, imapService.encrypt(b.smtp_pass), b.smtp_tls !== false, b.smtp_from_name || 'ООО «Асгард Сервис»',
      b.sync_enabled !== false, b.sync_interval_sec || 120, b.sync_max_emails || 200,
      b.is_active !== false, b.is_copy_target || false, b.exclude_from_inbox || false,
      request.user.id
    ]);

    // Start polling if enabled
    if (b.sync_enabled !== false && b.is_active !== false) {
      imapService.startPolling(result.rows[0].id, b.sync_interval_sec || 120);
    }

    return { success: true, id: result.rows[0].id };
  });

  fastify.put('/accounts/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!hasRole(request.user, ADMIN_ROLES)) {
      return reply.code(403).send({ error: 'Только для администратора' });
    }

    const { id } = request.params;
    const b = request.body;

    // Build dynamic update
    const fields = [];
    const params = [];
    let idx = 1;

    const directFields = ['name', 'email_address', 'account_type', 'imap_host', 'imap_port', 'imap_user',
      'imap_tls', 'imap_folder', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_tls', 'smtp_from_name',
      'sync_enabled', 'sync_interval_sec', 'sync_max_emails', 'is_active', 'is_copy_target', 'exclude_from_inbox'];

    for (const f of directFields) {
      if (b[f] !== undefined) {
        fields.push(`${f} = $${idx++}`);
        params.push(b[f]);
      }
    }

    // Handle passwords separately (encrypt)
    if (b.imap_pass) {
      fields.push(`imap_pass_encrypted = $${idx++}`);
      params.push(imapService.encrypt(b.imap_pass));
    }
    if (b.smtp_pass) {
      fields.push(`smtp_pass_encrypted = $${idx++}`);
      params.push(imapService.encrypt(b.smtp_pass));
    }

    if (fields.length === 0) return reply.code(400).send({ error: 'Нет полей для обновления' });

    fields.push('updated_at = NOW()');
    params.push(parseInt(id));

    await db.query(`UPDATE email_accounts SET ${fields.join(', ')} WHERE id = $${idx}`, params);

    // Restart polling if needed
    imapService.stopPolling(parseInt(id));
    if (b.sync_enabled !== false && b.is_active !== false) {
      imapService.startPolling(parseInt(id), b.sync_interval_sec || 120);
    }

    // Reset SMTP cache
    smtpTransporter = null;

    return { success: true };
  });

  fastify.delete('/accounts/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!hasRole(request.user, ADMIN_ROLES)) {
      return reply.code(403).send({ error: 'Только для администратора' });
    }

    const { id } = request.params;
    imapService.stopPolling(parseInt(id));
    await db.query('UPDATE email_accounts SET is_active = false, sync_enabled = false, updated_at = NOW() WHERE id = $1', [id]);
    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 11. TEST CONNECTION (IMAP / SMTP)
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/accounts/test-imap', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!hasRole(request.user, SETTINGS_ROLES)) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    const result = await imapService.testConnection(request.body);
    return result;
  });

  fastify.post('/accounts/test-smtp', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!hasRole(request.user, SETTINGS_ROLES)) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    const b = request.body;
    try {
      const transport = nodemailer.createTransport({
        host: b.smtp_host,
        port: b.smtp_port || 587,
        secure: b.smtp_tls !== false,
        auth: { user: b.smtp_user, pass: b.smtp_pass }
      });

      await transport.verify();
      return { success: true, message: 'SMTP подключение успешно' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 12. MANUAL SYNC
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/accounts/:id/sync', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!hasRole(request.user, SETTINGS_ROLES)) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    const { id } = request.params;
    const result = await imapService.manualSync(parseInt(id));
    return { success: true, ...result };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 13. SYNC LOG
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/sync-log', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!hasRole(request.user, SETTINGS_ROLES)) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    const { account_id, limit = 50 } = request.query;
    let query = `SELECT sl.*, ea.name as account_name, ea.email_address
      FROM email_sync_log sl
      LEFT JOIN email_accounts ea ON ea.id = sl.account_id`;
    const params = [];
    let idx = 1;

    if (account_id) {
      query += ` WHERE sl.account_id = $${idx++}`;
      params.push(parseInt(account_id));
    }

    query += ` ORDER BY sl.started_at DESC LIMIT $${idx}`;
    params.push(parseInt(limit));

    const result = await db.query(query, params);
    return { logs: result.rows };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 14. TEMPLATES
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/templates', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!checkMailboxAccess(request, reply)) return;

    const { category } = request.query;
    let query = 'SELECT * FROM email_templates_v2 WHERE is_active = true';
    const params = [];

    if (category) {
      query += ' AND category = $1';
      params.push(category);
    }

    query += ' ORDER BY sort_order, name';
    const result = await db.query(query, params);
    return { templates: result.rows };
  });

  fastify.get('/templates/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!checkMailboxAccess(request, reply)) return;

    const { id } = request.params;
    const result = await db.query('SELECT * FROM email_templates_v2 WHERE id = $1', [id]);
    if (result.rows.length === 0) return reply.code(404).send({ error: 'Шаблон не найден' });
    return { template: result.rows[0] };
  });

  fastify.post('/templates', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!hasRole(request.user, ADMIN_ROLES)) {
      return reply.code(403).send({ error: 'Только для администратора' });
    }

    const b = request.body;
    const result = await db.query(`
      INSERT INTO email_templates_v2 (
        code, name, category, subject_template, body_template,
        variables_schema, use_letterhead, default_cc, auto_attach_files,
        is_system, is_active, sort_order, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING id
    `, [
      b.code, b.name, b.category || 'custom',
      b.subject_template, b.body_template,
      JSON.stringify(b.variables_schema || []),
      b.use_letterhead || false, b.default_cc || null,
      JSON.stringify(b.auto_attach_files || []),
      false, true, b.sort_order || 0, request.user.id
    ]);

    return { success: true, id: result.rows[0].id };
  });

  fastify.put('/templates/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!hasRole(request.user, ADMIN_ROLES)) {
      return reply.code(403).send({ error: 'Только для администратора' });
    }

    const { id } = request.params;
    const b = request.body;
    await db.query(`
      UPDATE email_templates_v2 SET
        name = COALESCE($1, name), category = COALESCE($2, category),
        subject_template = COALESCE($3, subject_template), body_template = COALESCE($4, body_template),
        variables_schema = COALESCE($5, variables_schema), use_letterhead = COALESCE($6, use_letterhead),
        default_cc = $7, is_active = COALESCE($8, is_active),
        sort_order = COALESCE($9, sort_order), updated_at = NOW()
      WHERE id = $10
    `, [
      b.name, b.category, b.subject_template, b.body_template,
      b.variables_schema ? JSON.stringify(b.variables_schema) : null,
      b.use_letterhead, b.default_cc || null, b.is_active,
      b.sort_order, id
    ]);

    return { success: true };
  });

  fastify.delete('/templates/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!hasRole(request.user, ADMIN_ROLES)) {
      return reply.code(403).send({ error: 'Только для администратора' });
    }

    const { id } = request.params;
    // Don't delete system templates, just deactivate
    await db.query('UPDATE email_templates_v2 SET is_active = false, updated_at = NOW() WHERE id = $1', [id]);
    return { success: true };
  });

  // Render template with data
  fastify.post('/templates/:id/render', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!checkMailboxAccess(request, reply)) return;

    const { id } = request.params;
    const { variables = {} } = request.body;

    const tplRes = await db.query('SELECT * FROM email_templates_v2 WHERE id = $1', [id]);
    if (tplRes.rows.length === 0) return reply.code(404).send({ error: 'Шаблон не найден' });

    const tpl = tplRes.rows[0];
    const subject = letterhead.fillTemplate(tpl.subject_template, variables);
    let body = letterhead.fillTemplate(tpl.body_template, variables);

    if (tpl.use_letterhead) {
      body = letterhead.wrapInLetterhead(body, {
        senderName: variables.sender_name || 'ООО «Асгард Сервис»',
        senderPosition: variables.sender_position || '',
        senderPhone: variables.sender_phone || '',
        senderEmail: variables.sender_email || ''
      });
    }

    return { subject, body, use_letterhead: tpl.use_letterhead };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 15. CLASSIFICATION RULES
  // ═══════════════════════════════════════════════════════════════════
  fastify.get('/classification-rules', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!hasRole(request.user, SETTINGS_ROLES)) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    const result = await db.query('SELECT * FROM email_classification_rules ORDER BY priority DESC, id');
    return { rules: result.rows };
  });

  fastify.post('/classification-rules', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!hasRole(request.user, ADMIN_ROLES)) {
      return reply.code(403).send({ error: 'Только для администратора' });
    }

    const b = request.body;
    const result = await db.query(`
      INSERT INTO email_classification_rules (
        rule_type, pattern, match_mode, classification, confidence, priority, is_active, description, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id
    `, [
      b.rule_type, b.pattern, b.match_mode || 'contains',
      b.classification, b.confidence || 80, b.priority || 0,
      b.is_active !== false, b.description || '', request.user.id
    ]);

    classifier.invalidateCache();
    return { success: true, id: result.rows[0].id };
  });

  fastify.put('/classification-rules/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!hasRole(request.user, ADMIN_ROLES)) {
      return reply.code(403).send({ error: 'Только для администратора' });
    }

    const { id } = request.params;
    const b = request.body;

    await db.query(`
      UPDATE email_classification_rules SET
        rule_type = COALESCE($1, rule_type), pattern = COALESCE($2, pattern),
        match_mode = COALESCE($3, match_mode), classification = COALESCE($4, classification),
        confidence = COALESCE($5, confidence), priority = COALESCE($6, priority),
        is_active = COALESCE($7, is_active), description = COALESCE($8, description),
        updated_at = NOW()
      WHERE id = $9
    `, [b.rule_type, b.pattern, b.match_mode, b.classification, b.confidence, b.priority, b.is_active, b.description, id]);

    classifier.invalidateCache();
    return { success: true };
  });

  fastify.delete('/classification-rules/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!hasRole(request.user, ADMIN_ROLES)) {
      return reply.code(403).send({ error: 'Только для администратора' });
    }

    const { id } = request.params;
    await db.query('DELETE FROM email_classification_rules WHERE id = $1', [id]);
    classifier.invalidateCache();
    return { success: true };
  });

  // Test classification on a sample email
  fastify.post('/classification-rules/test', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!hasRole(request.user, SETTINGS_ROLES)) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    const { from_email, subject, body_text } = request.body;
    const result = await classifier.classify({ from_email, subject, body_text, raw_headers: '' });
    return result;
  });

  // ═══════════════════════════════════════════════════════════════════
  // 16. RE-CLASSIFY EMAIL
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/emails/:id/reclassify', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!hasRole(request.user, SETTINGS_ROLES)) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    const { id } = request.params;
    const emailRes = await db.query('SELECT from_email, subject, body_text, raw_headers FROM emails WHERE id = $1', [id]);
    if (emailRes.rows.length === 0) return reply.code(404).send({ error: 'Письмо не найдено' });

    const email = emailRes.rows[0];
    classifier.invalidateCache();
    const cls = await classifier.classify(email);

    await db.query(
      'UPDATE emails SET email_type = $1, classification_confidence = $2, classification_rule_id = $3, updated_at = NOW() WHERE id = $4',
      [cls.type, cls.confidence, cls.rule_id, id]
    );

    return { success: true, ...cls };
  });
}

module.exports = routes;
