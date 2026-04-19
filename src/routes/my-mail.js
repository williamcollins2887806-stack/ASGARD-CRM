/**
 * ASGARD CRM — My Mail Routes v2.0 (Premium)
 * Персональная почта сотрудника
 * Prefix: /api/my-mail
 *
 * Improvements: Schema validation, rate limiting, HTML sanitization,
 * path traversal protection, transport TTL, poll endpoint
 */

'use strict';

const nodemailer = require('nodemailer');
const imapService = require('../services/imap');
const path = require('path');
const fs = require('fs');

// ── HTML Sanitizer (strip dangerous tags/attrs) ─────────────────
function sanitizeHtml(html) {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[\s\S]*?>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')
    .replace(/<input[\s\S]*?>/gi, '')
    .replace(/<button[\s\S]*?<\/button>/gi, '')
    .replace(/<textarea[\s\S]*?<\/textarea>/gi, '')
    .replace(/<link[\s\S]*?>/gi, '')
    .replace(/<meta[\s\S]*?>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, 'blocked:')
    .replace(/vbscript\s*:/gi, 'blocked:');
}

// ── Rate Limiter (in-memory per-user) ───────────────────────────
const rateLimits = new Map();

function checkRateLimit(userId, action, maxPerWindow, windowMs) {
  const key = `${userId}:${action}`;
  const now = Date.now();
  if (!rateLimits.has(key)) rateLimits.set(key, []);

  const timestamps = rateLimits.get(key).filter(t => t > now - windowMs);
  rateLimits.set(key, timestamps);

  if (timestamps.length >= maxPerWindow) return false;
  timestamps.push(now);
  return true;
}

// Clean up rate limits every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of rateLimits.entries()) {
    const fresh = timestamps.filter(t => t > now - 3600000);
    if (fresh.length === 0) rateLimits.delete(key);
    else rateLimits.set(key, fresh);
  }
}, 300000);

// ── Transport Cache with TTL ────────────────────────────────────
const transportCache = new Map();
const TRANSPORT_TTL = 30 * 60 * 1000; // 30 minutes

function getCachedTransport(key) {
  const entry = transportCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TRANSPORT_TTL) {
    try { entry.transport.close(); } catch (e) { /* ignore */ }
    transportCache.delete(key);
    return null;
  }
  return entry.transport;
}

function setCachedTransport(key, transport) {
  transportCache.set(key, { transport, createdAt: Date.now() });
}

function removeCachedTransport(key) {
  const entry = transportCache.get(key);
  if (entry) {
    try { entry.transport.close(); } catch (e) { /* ignore */ }
    transportCache.delete(key);
  }
}

// ── JSON Schemas ────────────────────────────────────────────────
const sendSchema = {
  body: {
    type: 'object',
    required: ['to', 'subject'],
    properties: {
      to: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'array', items: { type: 'string' }, minItems: 1 }] },
      cc: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
      bcc: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
      subject: { type: 'string', minLength: 1, maxLength: 998 },
      body_html: { type: 'string', maxLength: 500000 },
      body_text: { type: 'string', maxLength: 500000 },
      reply_to_email_id: { type: 'integer' },
      forward_of_email_id: { type: 'integer' },
      is_crm_action: { type: 'boolean', default: false },
      attachments: { type: 'array', items: { type: 'object' }, maxItems: 20 }
    }
  }
};

const draftSchema = {
  body: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      to: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
      cc: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
      subject: { type: 'string', maxLength: 998 },
      body_html: { type: 'string', maxLength: 500000 },
      body_text: { type: 'string', maxLength: 500000 },
      reply_to_email_id: { type: 'integer' }
    }
  }
};

const accountUpdateSchema = {
  body: {
    type: 'object',
    properties: {
      display_name: { type: 'string', maxLength: 255 },
      signature_html: { type: 'string', maxLength: 50000 }
    }
  }
};

const patchEmailSchema = {
  body: {
    type: 'object',
    properties: {
      is_read: { type: 'boolean' },
      is_starred: { type: 'boolean' },
      is_archived: { type: 'boolean' },
      is_deleted: { type: 'boolean' },
      is_spam: { type: 'boolean' }
    },
    additionalProperties: false
  }
};

const bulkSchema = {
  body: {
    type: 'object',
    required: ['ids', 'action'],
    properties: {
      ids: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 200 },
      action: { type: 'string', enum: ['mark_read', 'mark_unread', 'archive', 'unarchive', 'delete', 'star', 'unstar', 'spam'] }
    }
  }
};

const moveSchema = {
  body: {
    type: 'object',
    required: ['folder_id'],
    properties: {
      folder_id: { type: 'integer' }
    }
  }
};

// ═════════════════════════════════════════════════════════════════
// ROUTES
// ═════════════════════════════════════════════════════════════════
async function routes(fastify, options) {
  const db = fastify.db;

  // ── Helper: get user email account (cached per request) ──────
  const accountCache = new WeakMap();
  async function getUserAccount(request) {
    if (accountCache.has(request)) return accountCache.get(request);
    const res = await db.query(
      'SELECT * FROM user_email_accounts WHERE user_id = $1 AND is_active = true',
      [request.user.id]
    );
    const account = res.rows[0] || null;
    accountCache.set(request, account);
    return account;
  }

  // ── Helper: SMTP transport ───────────────────────────────────
  async function getUserTransport(account) {
    if (!account) throw new Error('Почтовый аккаунт не настроен');
    const cacheKey = 'personal_' + account.id;

    let transport = getCachedTransport(cacheKey);
    if (transport) return transport;

    transport = nodemailer.createTransport({
      host: account.smtp_host || 'smtp.yandex.ru',
      port: account.smtp_port || 465,
      secure: account.smtp_tls !== false,
      auth: {
        user: account.smtp_user,
        pass: imapService.decrypt(account.smtp_pass_encrypted)
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000
    });

    setCachedTransport(cacheKey, transport);
    return transport;
  }

  // ═══════════════════════════════════════════════════════════════
  // 1. GET /account
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/account', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const account = await getUserAccount(request);
    if (!account) return { account: null, configured: false };

    return {
      configured: true,
      account: {
        id: account.id,
        email_address: account.email_address,
        display_name: account.display_name,
        signature_html: account.signature_html,
        imap_host: account.imap_host,
        smtp_host: account.smtp_host,
        is_active: account.is_active,
        last_sync_at: account.last_sync_at,
        last_sync_error: account.last_sync_error
      }
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // 2. PUT /account
  // ═══════════════════════════════════════════════════════════════
  fastify.put('/account', {
    preHandler: [fastify.authenticate],
    schema: accountUpdateSchema
  }, async (request, reply) => {
    const account = await getUserAccount(request);
    if (!account) return reply.code(404).send({ error: 'Почтовый аккаунт не настроен' });

    const { display_name, signature_html } = request.body;
    const updates = [];
    const params = [];
    let idx = 1;

    if (display_name !== undefined) { updates.push(`display_name = $${idx++}`); params.push(display_name); }
    if (signature_html !== undefined) { updates.push(`signature_html = $${idx++}`); params.push(signature_html); }
    if (updates.length === 0) return reply.code(400).send({ error: 'Нет полей для обновления' });

    updates.push('updated_at = NOW()');
    params.push(account.id);

    await db.query(
      `UPDATE user_email_accounts SET ${updates.join(', ')} WHERE id = $${idx}`,
      params
    );

    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════
  // 3. GET /folders
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/folders', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const account = await getUserAccount(request);
    if (!account) return { folders: [], configured: false };

    const res = await db.query(
      'SELECT * FROM email_folders WHERE user_account_id = $1 ORDER BY sort_order, id',
      [account.id]
    );

    if (res.rows.length === 0) {
      const defaults = [
        { name: 'Входящие', imap_path: 'INBOX', folder_type: 'inbox', sort_order: 0 },
        { name: 'Отправленные', imap_path: 'Sent', folder_type: 'sent', sort_order: 1 },
        { name: 'Черновики', imap_path: 'Drafts', folder_type: 'drafts', sort_order: 2 },
        { name: 'Спам', imap_path: 'Spam', folder_type: 'spam', sort_order: 3 },
        { name: 'Корзина', imap_path: 'Trash', folder_type: 'trash', sort_order: 4 }
      ];

      for (const f of defaults) {
        await db.query(
          'INSERT INTO email_folders (user_account_id, name, imap_path, folder_type, sort_order) VALUES ($1, $2, $3, $4, $5)',
          [account.id, f.name, f.imap_path, f.folder_type, f.sort_order]
        );
      }

      const created = await db.query(
        'SELECT * FROM email_folders WHERE user_account_id = $1 ORDER BY sort_order, id',
        [account.id]
      );
      return { folders: created.rows, configured: true };
    }

    return { folders: res.rows, configured: true };
  });

  // ═══════════════════════════════════════════════════════════════
  // 4. GET /emails (optimized with window function)
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/emails', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const account = await getUserAccount(request);
    if (!account) return { emails: [], total: 0 };

    const {
      folder_id, folder_type,
      direction, is_read, is_starred, is_draft, is_deleted,
      search,
      sort = 'email_date', order = 'DESC',
      limit = 50, offset = 0
    } = request.query;

    const conditions = ['e.user_account_id = $1'];
    const params = [account.id];
    let idx = 2;

    if (is_deleted !== undefined) {
      conditions.push(`e.is_deleted = $${idx++}`); params.push(is_deleted === 'true');
    } else {
      conditions.push('e.is_deleted = false');
    }

    if (is_draft !== undefined) {
      conditions.push(`e.is_draft = $${idx++}`); params.push(is_draft === 'true');
    } else {
      conditions.push('e.is_draft = false');
    }

    if (folder_id) { conditions.push(`e.folder_id = $${idx++}`); params.push(parseInt(folder_id)); }
    if (folder_type) {
      conditions.push(`e.folder_id IN (SELECT id FROM email_folders WHERE user_account_id = $1 AND folder_type = $${idx++})`);
      params.push(folder_type);
    }
    if (direction) { conditions.push(`e.direction = $${idx++}`); params.push(direction); }
    if (is_read !== undefined) { conditions.push(`e.is_read = $${idx++}`); params.push(is_read === 'true'); }
    if (is_starred !== undefined) { conditions.push(`e.is_starred = $${idx++}`); params.push(is_starred === 'true'); }

    if (search) {
      conditions.push(`(e.subject ILIKE $${idx} OR e.from_email ILIKE $${idx} OR e.from_name ILIKE $${idx} OR e.snippet ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const allowedSort = ['email_date', 'from_email', 'subject'];
    const sortCol = allowedSort.includes(sort) ? sort : 'email_date';
    const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const where = conditions.join(' AND ');

    // Single query with COUNT(*) OVER() for optimization
    const limitVal = Math.min(parseInt(limit) || 50, 200);
    const offsetVal = parseInt(offset) || 0;
    params.push(limitVal, offsetVal);

    const dataRes = await db.query(`
      SELECT e.id, e.direction, e.message_id, e.thread_id,
        e.from_email, e.from_name, e.to_emails, e.cc_emails,
        e.subject, e.snippet,
        e.is_read, e.is_starred, e.is_archived, e.is_draft, e.is_deleted,
        e.has_attachments, e.attachment_count,
        e.email_date, e.folder_id,
        ef.name as folder_name, ef.folder_type,
        COUNT(*) OVER() as _total_count
      FROM emails e
      LEFT JOIN email_folders ef ON ef.id = e.folder_id
      WHERE ${where}
      ORDER BY e.${sortCol} ${sortOrder}
      LIMIT $${idx} OFFSET $${idx + 1}
    `, params);

    const total = dataRes.rows.length > 0 ? parseInt(dataRes.rows[0]._total_count) : 0;
    const emails = dataRes.rows.map(r => { delete r._total_count; return r; });

    return { emails, total, limit: limitVal, offset: offsetVal };
  });

  // ═══════════════════════════════════════════════════════════════
  // 5. GET /emails/:id (with HTML sanitization)
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/emails/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const account = await getUserAccount(request);
    if (!account) return reply.code(403).send({ error: 'Почта не настроена' });

    const { id } = request.params;
    const result = await db.query(
      'SELECT * FROM emails WHERE id = $1 AND (user_account_id = $2 OR owner_user_id = $3)',
      [id, account.id, request.user.id]
    );

    if (result.rows.length === 0) return reply.code(404).send({ error: 'Письмо не найдено' });
    const email = result.rows[0];

    // Sanitize HTML body
    if (email.body_html) {
      email.body_html = sanitizeHtml(email.body_html);
    }

    // Mark as read
    if (!email.is_read) {
      await db.query('UPDATE emails SET is_read = true, updated_at = NOW() WHERE id = $1', [id]);
      email.is_read = true;
      if (email.folder_id) {
        await db.query(
          'UPDATE email_folders SET unread_count = GREATEST(unread_count - 1, 0) WHERE id = $1',
          [email.folder_id]
        );
      }
    }

    // Attachments
    const attRes = await db.query(
      'SELECT id, filename, original_filename, mime_type, size, content_id, is_inline FROM email_attachments WHERE email_id = $1 ORDER BY id',
      [id]
    );

    // Raw headers (if requested)
    let rawHeaders = undefined;
    if (request.query.raw_headers === 'true') {
      const hRes = await db.query(
        'SELECT headers_json, raw_headers, message_id, in_reply_to, references_header FROM emails WHERE id = $1',
        [id]
      );
      if (hRes.rows.length > 0) {
        const h = hRes.rows[0];
        rawHeaders = h.raw_headers || h.headers_json || {
          'Message-ID': h.message_id,
          'In-Reply-To': h.in_reply_to,
          'References': h.references_header
        };
      }
    }

    // Thread
    let thread = [];
    if (email.thread_id) {
      const threadRes = await db.query(
        `SELECT id, direction, from_email, from_name, subject, snippet, email_date, is_read
         FROM emails WHERE thread_id = $1 AND id != $2 AND (user_account_id = $3 OR owner_user_id = $4)
         ORDER BY email_date ASC`,
        [email.thread_id, id, account.id, request.user.id]
      );
      thread = threadRes.rows;
    }

    const response = { email, attachments: attRes.rows, thread };
    if (rawHeaders !== undefined) response.email.raw_headers = rawHeaders;
    return response;
  });

  // ═══════════════════════════════════════════════════════════════
  // 6. PATCH /emails/:id
  // ═══════════════════════════════════════════════════════════════
  fastify.patch('/emails/:id', {
    preHandler: [fastify.authenticate],
    schema: patchEmailSchema
  }, async (request, reply) => {
    const account = await getUserAccount(request);
    if (!account) return reply.code(403).send({ error: 'Почта не настроена' });

    const { id } = request.params;
    const allowed = ['is_read', 'is_starred', 'is_archived', 'is_deleted', 'is_spam'];
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
    updates.push('updated_at = NOW()');
    params.push(parseInt(id));
    params.push(account.id);

    const result = await db.query(
      `UPDATE emails SET ${updates.join(', ')} WHERE id = $${idx} AND user_account_id = $${idx + 1} RETURNING id`,
      params
    );

    if (result.rows.length === 0) return reply.code(404).send({ error: 'Письмо не найдено' });
    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════
  // 7. POST /emails/bulk
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/emails/bulk', {
    preHandler: [fastify.authenticate],
    schema: bulkSchema
  }, async (request, reply) => {
    const account = await getUserAccount(request);
    if (!account) return reply.code(403).send({ error: 'Почта не настроена' });

    const { ids, action } = request.body;

    const actionMap = {
      mark_read:    'is_read = true',
      mark_unread:  'is_read = false',
      archive:      'is_archived = true',
      unarchive:    'is_archived = false',
      delete:       'is_deleted = true',
      star:         'is_starred = true',
      unstar:       'is_starred = false',
      spam:         'is_spam = true, is_deleted = true'
    };

    const setClause = actionMap[action];
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');

    const result = await db.query(
      `UPDATE emails SET ${setClause}, updated_at = NOW() WHERE id IN (${placeholders}) AND user_account_id = $${ids.length + 1} RETURNING id`,
      [...ids, account.id]
    );

    return { success: true, affected: result.rowCount };
  });

  // ═══════════════════════════════════════════════════════════════
  // 8. POST /emails/:id/move
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/emails/:id/move', {
    preHandler: [fastify.authenticate],
    schema: moveSchema
  }, async (request, reply) => {
    const account = await getUserAccount(request);
    if (!account) return reply.code(403).send({ error: 'Почта не настроена' });

    const { id } = request.params;
    const { folder_id } = request.body;

    // Verify folder ownership
    const folderRes = await db.query(
      'SELECT id FROM email_folders WHERE id = $1 AND user_account_id = $2',
      [folder_id, account.id]
    );
    if (folderRes.rows.length === 0) return reply.code(404).send({ error: 'Папка не найдена' });

    // Get current state
    const emailRes = await db.query(
      'SELECT folder_id, is_read FROM emails WHERE id = $1 AND user_account_id = $2',
      [id, account.id]
    );
    if (emailRes.rows.length === 0) return reply.code(404).send({ error: 'Письмо не найдено' });

    const oldFolderId = emailRes.rows[0].folder_id;
    const isRead = emailRes.rows[0].is_read;

    await db.query('UPDATE emails SET folder_id = $1, updated_at = NOW() WHERE id = $2', [folder_id, id]);

    // Update counters
    if (oldFolderId) {
      await db.query('UPDATE email_folders SET total_count = GREATEST(total_count - 1, 0) WHERE id = $1', [oldFolderId]);
      if (!isRead) await db.query('UPDATE email_folders SET unread_count = GREATEST(unread_count - 1, 0) WHERE id = $1', [oldFolderId]);
    }
    await db.query('UPDATE email_folders SET total_count = total_count + 1 WHERE id = $1', [folder_id]);
    if (!isRead) await db.query('UPDATE email_folders SET unread_count = unread_count + 1 WHERE id = $1', [folder_id]);

    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════
  // 9. POST /send (rate limited + attachment size check)
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/send', {
    preHandler: [fastify.authenticate],
    schema: sendSchema
  }, async (request, reply) => {
    const account = await getUserAccount(request);
    if (!account) return reply.code(403).send({ error: 'Почтовый аккаунт не настроен. Обратитесь к администратору.' });

    // Rate limit: 30/min, 200/hour
    if (!checkRateLimit(request.user.id, 'send', 30, 60000)) {
      return reply.code(429).send({ error: 'Слишком много писем. Подождите минуту.' });
    }
    if (!checkRateLimit(request.user.id, 'send_hour', 200, 3600000)) {
      return reply.code(429).send({ error: 'Превышен лимит отправки (200 писем/час).' });
    }

    const {
      to, cc, bcc, subject, body_html, body_text,
      reply_to_email_id, forward_of_email_id,
      is_crm_action = false,
      attachments = []
    } = request.body;

    const user = request.user;

    // Check attachment size (max 25MB total)
    let totalAttachSize = 0;
    for (const a of attachments) {
      if (a.content) totalAttachSize += (a.content.length * 3 / 4); // base64 → bytes approx
    }
    if (totalAttachSize > 25 * 1024 * 1024) {
      return reply.code(413).send({ error: 'Суммарный размер вложений превышает 25 МБ' });
    }

    try {
      const transport = await getUserTransport(account);
      const fromEmail = `"${account.display_name || user.name}" <${account.email_address}>`;

      // Threading headers
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

      // Signature
      let finalHtml = body_html || (body_text || '').replace(/\n/g, '<br>');
      if (account.signature_html) {
        finalHtml += '<br><br><div class="email-signature">--<br>' + account.signature_html + '</div>';
      }

      const mailOptions = {
        from: fromEmail,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject,
        html: finalHtml,
        text: body_text || '',
        headers
      };

      if (cc) mailOptions.cc = Array.isArray(cc) ? cc.join(', ') : cc;

      // BCC: CRM action → add copy to CRM mailbox
      let bccList = bcc ? (Array.isArray(bcc) ? [...bcc] : [bcc]) : [];
      if (is_crm_action) {
        const crmAccRes = await db.query(
          "SELECT email_address FROM email_accounts WHERE is_copy_target = true OR account_type = 'primary' ORDER BY is_copy_target DESC LIMIT 1"
        );
        if (crmAccRes.rows.length > 0 && crmAccRes.rows[0].email_address !== account.email_address) {
          bccList.push(crmAccRes.rows[0].email_address);
        }
      }
      if (bccList.length > 0) mailOptions.bcc = bccList.join(', ');

      // Attachments
      if (attachments.length > 0) {
        mailOptions.attachments = attachments.map(a => {
          if (a.content) return { filename: a.filename || a.name || 'attachment', content: a.content, encoding: 'base64' };
          if (a.path) {
            // Path traversal protection
            const resolved = path.resolve(path.join(__dirname, '..', '..'), a.path);
            const baseDir = path.resolve(path.join(__dirname, '..', '..'));
            if (!resolved.startsWith(baseDir)) return null;
            return { filename: a.filename || a.name, path: resolved };
          }
          return null;
        }).filter(Boolean);
      }

      // Forward attachments
      if (forward_of_email_id) {
        const fwdAtts = await db.query('SELECT * FROM email_attachments WHERE email_id = $1 AND is_inline = false', [forward_of_email_id]);
        for (const fa of fwdAtts.rows) {
          const fpath = path.resolve(path.join(__dirname, '..', '..'), fa.file_path);
          const baseDir = path.resolve(path.join(__dirname, '..', '..'));
          if (fpath.startsWith(baseDir) && fs.existsSync(fpath)) {
            if (!mailOptions.attachments) mailOptions.attachments = [];
            mailOptions.attachments.push({ filename: fa.original_filename || fa.filename, path: fpath });
          }
        }
      }

      let result;
      try {
        result = await transport.sendMail(mailOptions);
      } catch (smtpError) {
        // Remove cached transport on SMTP error
        removeCachedTransport('personal_' + account.id);
        throw smtpError;
      }

      // Thread ID
      let threadId = null;
      if (reply_to_email_id) {
        const origRes = await db.query('SELECT thread_id FROM emails WHERE id = $1', [reply_to_email_id]);
        if (origRes.rows.length > 0) threadId = origRes.rows[0].thread_id;
      }

      // Sent folder
      const sentFolder = await db.query(
        "SELECT id FROM email_folders WHERE user_account_id = $1 AND folder_type = 'sent'",
        [account.id]
      );
      const sentFolderId = sentFolder.rows[0]?.id || null;

      // Save sent email
      const toEmails = (Array.isArray(to) ? to : [to]).map(e => ({ address: e.trim(), name: '' }));
      const ccEmails = cc ? (Array.isArray(cc) ? cc : [cc]).map(e => ({ address: e.trim(), name: '' })) : [];

      await db.query(`
        INSERT INTO emails (
          user_account_id, owner_user_id, folder_id,
          direction, message_id, in_reply_to, references_header, thread_id,
          from_email, from_name, to_emails, cc_emails,
          subject, body_text, body_html, snippet,
          email_type, is_read, is_crm_copy,
          sent_by_user_id, reply_to_email_id, forward_of_email_id,
          has_attachments, attachment_count,
          email_date
        ) VALUES (
          $1, $2, $3,
          'outbound', $4, $5, $6, $7,
          $8, $9, $10, $11,
          $12, $13, $14, $15,
          'crm_outbound', true, $16,
          $2, $17, $18,
          $19, $20,
          NOW()
        )
      `, [
        account.id, user.id, sentFolderId,
        result.messageId,
        mailOptions.headers?.['In-Reply-To'] || null,
        mailOptions.headers?.['References'] || null,
        threadId,
        account.email_address, account.display_name || user.name,
        JSON.stringify(toEmails), JSON.stringify(ccEmails),
        subject, body_text || '', finalHtml, (body_text || '').slice(0, 250),
        is_crm_action,
        reply_to_email_id || null, forward_of_email_id || null,
        (mailOptions.attachments?.length || 0) > 0,
        mailOptions.attachments?.length || 0
      ]);

      // Update sent folder counter
      if (sentFolderId) {
        await db.query('UPDATE email_folders SET total_count = total_count + 1 WHERE id = $1', [sentFolderId]);
      }

      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error('[MyMail] Send error:', error.message);
      return reply.code(500).send({ error: 'Ошибка отправки: ' + error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 10. POST /drafts
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/drafts', {
    preHandler: [fastify.authenticate],
    schema: draftSchema
  }, async (request, reply) => {
    const account = await getUserAccount(request);
    if (!account) return reply.code(403).send({ error: 'Почта не настроена' });

    const { id, to, cc, subject, body_html, body_text, reply_to_email_id } = request.body;
    const user = request.user;

    const toEmails = to ? (Array.isArray(to) ? to : [to]).map(e => ({ address: e.trim(), name: '' })) : [];
    const ccEmails = cc ? (Array.isArray(cc) ? cc : [cc]).map(e => ({ address: e.trim(), name: '' })) : [];

    const draftFolder = await db.query(
      "SELECT id FROM email_folders WHERE user_account_id = $1 AND folder_type = 'drafts'",
      [account.id]
    );
    const draftFolderId = draftFolder.rows[0]?.id || null;

    if (id) {
      // Update existing draft
      const result = await db.query(`
        UPDATE emails SET to_emails = $1, cc_emails = $2, subject = $3,
          body_html = $4, body_text = $5, snippet = $6, updated_at = NOW()
        WHERE id = $7 AND is_draft = true AND user_account_id = $8
        RETURNING id
      `, [JSON.stringify(toEmails), JSON.stringify(ccEmails), subject || '',
          body_html || '', body_text || '', (body_text || '').slice(0, 250), id, account.id]);

      if (result.rows.length === 0) return reply.code(404).send({ error: 'Черновик не найден' });
      return { success: true, id: parseInt(id) };
    }

    // New draft
    const res = await db.query(`
      INSERT INTO emails (
        user_account_id, owner_user_id, folder_id,
        direction, to_emails, cc_emails, subject,
        body_html, body_text, snippet, email_type,
        is_draft, is_read, sent_by_user_id, reply_to_email_id, email_date
      ) VALUES ($1, $2, $3, 'outbound', $4, $5, $6, $7, $8, $9, 'draft',
        true, true, $2, $10, NOW())
      RETURNING id
    `, [
      account.id, user.id, draftFolderId,
      JSON.stringify(toEmails), JSON.stringify(ccEmails),
      subject || '', body_html || '', body_text || '', (body_text || '').slice(0, 250),
      reply_to_email_id || null
    ]);

    // Update draft folder counter
    if (draftFolderId) {
      await db.query('UPDATE email_folders SET total_count = total_count + 1 WHERE id = $1', [draftFolderId]);
    }

    return { success: true, id: res.rows[0].id };
  });

  // ═══════════════════════════════════════════════════════════════
  // 11. GET /attachments/:id/download (path traversal protected)
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/attachments/:id/download', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const account = await getUserAccount(request);
    if (!account) return reply.code(403).send({ error: 'Почта не настроена' });

    const { id } = request.params;
    const att = await db.query(
      `SELECT ea.* FROM email_attachments ea
       JOIN emails e ON e.id = ea.email_id
       WHERE ea.id = $1 AND (e.user_account_id = $2 OR e.owner_user_id = $3)`,
      [id, account.id, request.user.id]
    );

    if (att.rows.length === 0) return reply.code(404).send({ error: 'Вложение не найдено' });
    const attachment = att.rows[0];

    // Path traversal protection
    const baseDir = path.resolve(path.join(__dirname, '..', '..'));
    const filePath = path.resolve(path.join(baseDir, attachment.file_path));
    if (!filePath.startsWith(baseDir)) {
      return reply.code(403).send({ error: 'Доступ запрещён' });
    }

    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: 'Файл не найден на диске' });

    const stream = fs.createReadStream(filePath);
    return reply
      .header('Content-Type', attachment.mime_type || 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.original_filename || attachment.filename)}"`)
      .send(stream);
  });

  // ═══════════════════════════════════════════════════════════════
  // 12. GET /stats
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/stats', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const account = await getUserAccount(request);
    if (!account) return { unread: 0, total: 0, folders: [], configured: false };

    const [unreadRes, totalRes, foldersRes] = await Promise.all([
      db.query('SELECT COUNT(*) FROM emails WHERE user_account_id = $1 AND is_read = false AND is_deleted = false AND is_draft = false', [account.id]),
      db.query('SELECT COUNT(*) FROM emails WHERE user_account_id = $1 AND is_deleted = false AND is_draft = false', [account.id]),
      db.query('SELECT id, name, folder_type, unread_count, total_count FROM email_folders WHERE user_account_id = $1 ORDER BY sort_order', [account.id])
    ]);

    return {
      unread: parseInt(unreadRes.rows[0].count),
      total: parseInt(totalRes.rows[0].count),
      folders: foldersRes.rows,
      configured: true
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // 13. POST /sync (rate limited: 1 per 30s)
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/sync', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const account = await getUserAccount(request);
    if (!account) return reply.code(403).send({ error: 'Почта не настроена' });

    if (!checkRateLimit(request.user.id, 'sync', 1, 30000)) {
      return reply.code(429).send({ error: 'Синхронизация доступна раз в 30 секунд' });
    }

    try {
      const result = await imapService.syncUserAccount(account.id);
      return { success: true, ...result };
    } catch (error) {
      return reply.code(500).send({ error: 'Ошибка синхронизации: ' + error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 14. GET /poll — lightweight polling for new mail (A8)
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/poll', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const account = await getUserAccount(request);
    if (!account) return { unread: 0, lastEmailDate: null };

    const [unreadRes, lastRes] = await Promise.all([
      db.query('SELECT COUNT(*) FROM emails WHERE user_account_id = $1 AND is_read = false AND is_deleted = false AND is_draft = false', [account.id]),
      db.query('SELECT email_date FROM emails WHERE user_account_id = $1 AND is_deleted = false ORDER BY email_date DESC LIMIT 1', [account.id])
    ]);

    return {
      unread: parseInt(unreadRes.rows[0].count),
      lastEmailDate: lastRes.rows[0]?.email_date || null
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // 15. GET /contacts — адресная книга (для автодополнения)
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/contacts', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { q } = request.query;
    if (!q || q.length < 2) return { contacts: [] };

    // Search in users + recent email recipients
    const [usersRes, emailsRes] = await Promise.all([
      db.query(`
        SELECT DISTINCT u.name, uea.email_address
        FROM users u
        JOIN user_email_accounts uea ON uea.user_id = u.id AND uea.is_active = true
        WHERE u.name ILIKE $1 OR uea.email_address ILIKE $1
        LIMIT 10
      `, [`%${q}%`]),
      db.query(`
        SELECT DISTINCT from_email as email, from_name as name
        FROM emails
        WHERE (user_account_id IN (SELECT id FROM user_email_accounts WHERE user_id = $1))
          AND (from_email ILIKE $2 OR from_name ILIKE $2)
          AND direction = 'inbound'
        ORDER BY MAX(email_date) DESC
        LIMIT 10
      `, [request.user.id, `%${q}%`])
    ]);

    const contacts = [];
    const seen = new Set();

    for (const u of usersRes.rows) {
      const key = u.email_address.toLowerCase();
      if (!seen.has(key)) { contacts.push({ name: u.name, email: u.email_address }); seen.add(key); }
    }
    for (const e of emailsRes.rows) {
      const key = (e.email || '').toLowerCase();
      if (key && !seen.has(key)) { contacts.push({ name: e.name || '', email: e.email }); seen.add(key); }
    }

    return { contacts };
  });

  // ═══════════════════════════════════════════════════════════════
  // 16. POST /folders — создать пользовательскую папку
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/folders', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 }
        }
      }
    }
  }, async (request, reply) => {
    const account = await getUserAccount(request);
    if (!account) return reply.code(403).send({ error: 'Почта не настроена' });

    const { name } = request.body;

    // Check duplicate
    const existing = await db.query(
      'SELECT id FROM email_folders WHERE user_account_id = $1 AND name = $2',
      [account.id, name]
    );
    if (existing.rows.length > 0) return reply.code(409).send({ error: 'Папка с таким именем уже существует' });

    const maxSort = await db.query(
      'SELECT COALESCE(MAX(sort_order), 10) + 1 as next_sort FROM email_folders WHERE user_account_id = $1',
      [account.id]
    );

    const res = await db.query(
      'INSERT INTO email_folders (user_account_id, name, folder_type, sort_order) VALUES ($1, $2, $3, $4) RETURNING *',
      [account.id, name, 'custom', maxSort.rows[0].next_sort]
    );

    return { success: true, folder: res.rows[0] };
  });

  // ═══════════════════════════════════════════════════════════════
  // 17. DELETE /folders/:id — удалить пользовательскую папку
  // ═══════════════════════════════════════════════════════════════
  fastify.delete('/folders/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const account = await getUserAccount(request);
    if (!account) return reply.code(403).send({ error: 'Почта не настроена' });

    const { id } = request.params;
    const folder = await db.query(
      'SELECT * FROM email_folders WHERE id = $1 AND user_account_id = $2',
      [id, account.id]
    );
    if (folder.rows.length === 0) return reply.code(404).send({ error: 'Папка не найдена' });

    // Don't allow deleting system folders
    const systemTypes = ['inbox', 'sent', 'drafts', 'spam', 'trash'];
    if (systemTypes.includes(folder.rows[0].folder_type)) {
      return reply.code(400).send({ error: 'Нельзя удалить системную папку' });
    }

    // Move emails to inbox
    const inboxFolder = await db.query(
      "SELECT id FROM email_folders WHERE user_account_id = $1 AND folder_type = 'inbox'",
      [account.id]
    );
    if (inboxFolder.rows.length > 0) {
      await db.query('UPDATE emails SET folder_id = $1 WHERE folder_id = $2', [inboxFolder.rows[0].id, id]);
    }

    await db.query('DELETE FROM email_folders WHERE id = $1', [id]);
    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════
  // 18. PUT /folders/:id — переименовать папку
  // ═══════════════════════════════════════════════════════════════
  fastify.put('/folders/:id', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 }
        }
      }
    }
  }, async (request, reply) => {
    const account = await getUserAccount(request);
    if (!account) return reply.code(403).send({ error: 'Почта не настроена' });

    const { id } = request.params;
    const { name } = request.body;

    const result = await db.query(
      'UPDATE email_folders SET name = $1 WHERE id = $2 AND user_account_id = $3 AND folder_type = $4 RETURNING id',
      [name, id, account.id, 'custom']
    );

    if (result.rows.length === 0) return reply.code(404).send({ error: 'Папка не найдена или является системной' });
    return { success: true };
  });
}

module.exports = routes;
