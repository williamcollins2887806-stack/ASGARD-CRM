/**
 * ASGARD CRM — IMAP Mail Collection Service
 * Фоновый сервис сбора входящей почты по IMAP (imapflow)
 */

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const sanitizeHtml = require('sanitize-html');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const classifier = require('./email-classifier');

// ── Encryption helpers (AES-256-CBC, key from ENV) ──────────────────────
const ENC_ALGO = 'aes-256-cbc';
function getEncKey() {
  const raw = process.env.MAIL_ENC_KEY || process.env.DB_PASSWORD || 'asgard-default-enc-key-32ch!';
  return crypto.createHash('sha256').update(raw).digest();
}

function encrypt(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ENC_ALGO, getEncKey(), iv);
  let enc = cipher.update(text, 'utf8', 'hex');
  enc += cipher.final('hex');
  return iv.toString('hex') + ':' + enc;
}

function decrypt(stored) {
  if (!stored || !stored.includes(':')) return stored || '';
  try {
    const [ivHex, enc] = stored.split(':');
    const decipher = crypto.createDecipheriv(ENC_ALGO, getEncKey(), Buffer.from(ivHex, 'hex'));
    let dec = decipher.update(enc, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  } catch (e) {
    console.error('[IMAP] Decrypt error:', e.message);
    return '';
  }
}

// ── State ────────────────────────────────────────────────────────────────
const pollingTimers = new Map();   // accountId → timeoutId
const activeClients = new Map();   // accountId → ImapFlow instance
let isShuttingDown = false;

// ── Uploads path helper ─────────────────────────────────────────────────
const UPLOADS_BASE = path.join(__dirname, '..', '..', 'uploads', 'mail');

function getAttachmentDir() {
  const date = new Date().toISOString().slice(0, 10);
  const uuid = crypto.randomUUID();
  const dir = path.join(UPLOADS_BASE, date, uuid);
  fs.mkdirSync(dir, { recursive: true });
  return { dir, relBase: `uploads/mail/${date}/${uuid}` };
}

function safeName(filename) {
  if (!filename) return 'attachment';
  return filename.replace(/[^\w.\-а-яА-ЯёЁ ]/gi, '_').slice(0, 200);
}

// ── HTML sanitisation ───────────────────────────────────────────────────
function cleanHtml(html) {
  if (!html) return '';
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'style', 'span', 'div', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'br', 'hr', 'font', 'center']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      '*': ['style', 'class', 'id', 'align', 'valign', 'width', 'height', 'bgcolor', 'color', 'border', 'cellpadding', 'cellspacing'],
      img: ['src', 'alt', 'width', 'height', 'style'],
      a: ['href', 'target', 'rel', 'style'],
      font: ['color', 'size', 'face']
    },
    allowedSchemes: ['http', 'https', 'mailto', 'cid']
  });
}

// ── Thread ID computation ───────────────────────────────────────────────
function computeThreadId(messageId, inReplyTo, referencesHeader) {
  // Use first reference as thread root, fallback to inReplyTo, fallback to own messageId
  if (referencesHeader) {
    const refs = referencesHeader.match(/<[^>]+>/g);
    if (refs && refs.length > 0) return refs[0].replace(/[<>]/g, '');
  }
  if (inReplyTo) return inReplyTo.replace(/[<>]/g, '');
  return messageId ? messageId.replace(/[<>]/g, '') : null;
}

// ── Snippet ─────────────────────────────────────────────────────────────
function makeSnippet(text, maxLen = 250) {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

// ── Core: connect & sync one account ────────────────────────────────────
async function createClient(account) {
  const client = new ImapFlow({
    host: account.imap_host,
    port: account.imap_port || 993,
    secure: account.imap_tls !== false,
    auth: {
      user: account.imap_user,
      pass: decrypt(account.imap_pass_encrypted)
    },
    logger: false,
    emitLogs: false,
    greetingTimeout: 15000,
    socketTimeout: 60000
  });
  return client;
}

/**
 * Sync a single IMAP account — fetch new messages since last_sync_uid
 */
async function syncAccount(accountId) {
  if (isShuttingDown) return { fetched: 0, newCount: 0 };

  // Load account from DB
  const accRes = await db.query('SELECT * FROM email_accounts WHERE id = $1 AND is_active = true', [accountId]);
  if (accRes.rows.length === 0) return { fetched: 0, newCount: 0 };
  const account = accRes.rows[0];

  // Create sync log entry
  const logRes = await db.query(
    `INSERT INTO email_sync_log (account_id, sync_type, status) VALUES ($1, 'incremental', 'running') RETURNING id`,
    [accountId]
  );
  const syncLogId = logRes.rows[0].id;
  const startMs = Date.now();
  const errors = [];

  let client;
  let fetched = 0;
  let newCount = 0;
  let updatedCount = 0;
  let attachmentsSaved = 0;

  try {
    client = await createClient(account);
    activeClients.set(accountId, client);
    await client.connect();

    const folder = account.imap_folder || 'INBOX';
    const lock = await client.getMailboxLock(folder);

    try {
      const lastUid = account.last_sync_uid || 0;
      const maxEmails = account.sync_max_emails || 200;

      // Fetch messages with UID > lastSyncUid
      const range = lastUid > 0 ? `${lastUid + 1}:*` : '1:*';
      let maxUid = lastUid;
      let count = 0;

      for await (const msg of client.fetch(range, {
        uid: true,
        flags: true,
        envelope: true,
        source: true,
        bodyStructure: true
      })) {
        if (isShuttingDown) break;
        if (count >= maxEmails) break;
        count++;

        try {
          const parsed = await simpleParser(msg.source);
          const result = await saveEmail(account, msg, parsed);
          fetched++;
          if (result.isNew) newCount++;
          else updatedCount++;
          attachmentsSaved += result.attachmentCount || 0;

          if (msg.uid > maxUid) maxUid = msg.uid;
        } catch (parseErr) {
          errors.push({ uid: msg.uid, error: parseErr.message });
          console.error(`[IMAP] Parse error uid=${msg.uid} account=${accountId}:`, parseErr.message);
        }
      }

      // Update last sync UID
      if (maxUid > lastUid) {
        await db.query(
          'UPDATE email_accounts SET last_sync_uid = $1, last_sync_at = NOW(), last_sync_error = NULL, updated_at = NOW() WHERE id = $2',
          [maxUid, accountId]
        );
      } else {
        await db.query(
          'UPDATE email_accounts SET last_sync_at = NOW(), last_sync_error = NULL, updated_at = NOW() WHERE id = $1',
          [accountId]
        );
      }
    } finally {
      lock.release();
    }

    await client.logout();

    // Update sync log
    await db.query(
      `UPDATE email_sync_log SET status = $1, emails_fetched = $2, emails_new = $3, emails_updated = $4,
       attachments_saved = $5, errors_count = $6, error_details = $7, duration_ms = $8, completed_at = NOW()
       WHERE id = $9`,
      [
        errors.length > 0 ? 'partial' : 'success',
        fetched, newCount, updatedCount, attachmentsSaved,
        errors.length, JSON.stringify(errors), Date.now() - startMs,
        syncLogId
      ]
    );

    console.log(`[IMAP] Sync account #${accountId}: ${newCount} new, ${updatedCount} updated, ${attachmentsSaved} attachments`);
  } catch (err) {
    console.error(`[IMAP] Sync error account #${accountId}:`, err.message);

    await db.query(
      'UPDATE email_accounts SET last_sync_error = $1, updated_at = NOW() WHERE id = $2',
      [err.message, accountId]
    ).catch(() => {});

    await db.query(
      `UPDATE email_sync_log SET status = 'error', errors_count = $1, error_details = $2,
       duration_ms = $3, completed_at = NOW() WHERE id = $4`,
      [1, JSON.stringify([{ error: err.message }]), Date.now() - startMs, syncLogId]
    ).catch(() => {});
  } finally {
    activeClients.delete(accountId);
    if (client) {
      try { await client.logout(); } catch (_) {}
    }
  }

  return { fetched, newCount, updatedCount, attachmentsSaved };
}

/**
 * Save a single parsed email to DB, with deduplication and classification
 */
async function saveEmail(account, msg, parsed) {
  const messageId = parsed.messageId || null;
  const inReplyTo = parsed.inReplyTo || null;
  const referencesHeader = Array.isArray(parsed.references)
    ? parsed.references.join(' ')
    : (parsed.references || '');

  // Deduplication check
  if (messageId) {
    const exists = await db.query('SELECT id FROM emails WHERE message_id = $1', [messageId]);
    if (exists.rows.length > 0) {
      // Update flags only
      const flags = msg.flags ? Array.from(msg.flags).join(',') : '';
      await db.query(
        'UPDATE emails SET imap_flags = $1, updated_at = NOW() WHERE id = $2',
        [flags, exists.rows[0].id]
      );
      return { isNew: false, attachmentCount: 0 };
    }
  }

  // Extract fields
  const fromAddr = parsed.from?.value?.[0] || {};
  const toEmails = (parsed.to?.value || []).map(a => ({ address: a.address, name: a.name || '' }));
  const ccEmails = (parsed.cc?.value || []).map(a => ({ address: a.address, name: a.name || '' }));
  const bccEmails = (parsed.bcc?.value || []).map(a => ({ address: a.address, name: a.name || '' }));
  const replyToEmail = parsed.replyTo?.value?.[0]?.address || null;

  const bodyText = parsed.text || '';
  const bodyHtmlRaw = parsed.html || '';
  const bodyHtml = cleanHtml(bodyHtmlRaw);
  const snippet = makeSnippet(bodyText);
  const threadId = computeThreadId(messageId, inReplyTo, referencesHeader);
  const flags = msg.flags ? Array.from(msg.flags).join(',') : '';
  const isRead = msg.flags?.has('\\Seen') || false;

  // Build raw headers string for classification
  const rawHeaders = parsed.headerLines
    ? parsed.headerLines.map(h => `${h.key}: ${h.line}`).join('\n')
    : '';

  // Classify
  let emailType = 'unknown';
  let classConfidence = 0;
  let classRuleId = null;
  try {
    const cls = await classifier.classify({
      from_email: fromAddr.address || '',
      subject: parsed.subject || '',
      body_text: bodyText,
      raw_headers: rawHeaders
    });
    emailType = cls.type;
    classConfidence = cls.confidence;
    classRuleId = cls.rule_id;
  } catch (e) {
    console.error('[IMAP] Classification error:', e.message);
  }

  // Determine attachments
  const attachments = parsed.attachments || [];
  const hasAttachments = attachments.length > 0;
  const totalAttSize = attachments.reduce((sum, a) => sum + (a.size || 0), 0);

  // Insert email
  const emailRes = await db.query(`
    INSERT INTO emails (
      account_id, direction, message_id, in_reply_to, references_header, thread_id,
      from_email, from_name, to_emails, cc_emails, bcc_emails, reply_to_email,
      subject, body_text, body_html, body_html_raw, snippet,
      email_type, classification_confidence, classification_rule_id,
      is_read, has_attachments, attachment_count, total_attachments_size,
      imap_uid, imap_folder, imap_flags, raw_headers,
      email_date, synced_at
    ) VALUES (
      $1, 'inbound', $2, $3, $4, $5,
      $6, $7, $8, $9, $10, $11,
      $12, $13, $14, $15, $16,
      $17, $18, $19,
      $20, $21, $22, $23,
      $24, $25, $26, $27,
      $28, NOW()
    ) RETURNING id
  `, [
    account.id, messageId, inReplyTo, referencesHeader, threadId,
    fromAddr.address || '', fromAddr.name || '', JSON.stringify(toEmails), JSON.stringify(ccEmails), JSON.stringify(bccEmails), replyToEmail,
    parsed.subject || '(без темы)', bodyText, bodyHtml, bodyHtmlRaw, snippet,
    emailType, classConfidence, classRuleId,
    isRead, hasAttachments, attachments.length, totalAttSize,
    msg.uid, account.imap_folder || 'INBOX', flags, rawHeaders,
    parsed.date || new Date()
  ]);

  const emailId = emailRes.rows[0].id;
  let attachmentCount = 0;

  // Save attachments
  if (hasAttachments) {
    const { dir, relBase } = getAttachmentDir();

    for (const att of attachments) {
      try {
        const safeFn = safeName(att.filename);
        const filePath = path.join(dir, safeFn);
        fs.writeFileSync(filePath, att.content);

        const checksum = crypto.createHash('sha256').update(att.content).digest('hex');

        await db.query(`
          INSERT INTO email_attachments (
            email_id, filename, original_filename, mime_type, size, file_path,
            content_id, content_disposition, is_inline, checksum_sha256
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
          emailId, safeFn, att.filename || safeFn, att.contentType || 'application/octet-stream',
          att.size || 0, `${relBase}/${safeFn}`,
          att.contentId || null, att.contentDisposition || 'attachment',
          !!(att.contentId && att.contentDisposition === 'inline'),
          checksum
        ]);

        attachmentCount++;
      } catch (attErr) {
        console.error(`[IMAP] Attachment save error: ${att.filename}`, attErr.message);
      }
    }
  }

  return { isNew: true, attachmentCount };
}

// ── Polling loop ────────────────────────────────────────────────────────
function startPolling(accountId, intervalSec) {
  if (pollingTimers.has(accountId)) return; // already polling

  const interval = (intervalSec || 120) * 1000;

  async function poll() {
    if (isShuttingDown) return;
    try {
      await syncAccount(accountId);
    } catch (e) {
      console.error(`[IMAP] Poll error account #${accountId}:`, e.message);
    }
    if (!isShuttingDown && pollingTimers.has(accountId)) {
      const timerId = setTimeout(poll, interval);
      pollingTimers.set(accountId, timerId);
    }
  }

  // Start first poll with small delay
  const timerId = setTimeout(poll, 5000);
  pollingTimers.set(accountId, timerId);
  console.log(`[IMAP] Polling started for account #${accountId} every ${intervalSec}s`);
}

function stopPolling(accountId) {
  const timerId = pollingTimers.get(accountId);
  if (timerId) {
    clearTimeout(timerId);
    pollingTimers.delete(accountId);
    console.log(`[IMAP] Polling stopped for account #${accountId}`);
  }
}

function stopAllPolling() {
  for (const [accountId, timerId] of pollingTimers) {
    clearTimeout(timerId);
    console.log(`[IMAP] Polling stopped for account #${accountId}`);
  }
  pollingTimers.clear();
}

// ── Init: start polling for all active accounts ─────────────────────────
async function init() {
  try {
    const result = await db.query(
      'SELECT id, sync_interval_sec FROM email_accounts WHERE is_active = true AND sync_enabled = true'
    );

    if (result.rows.length === 0) {
      console.log('[IMAP] No active email accounts to sync');
      return;
    }

    for (const acc of result.rows) {
      startPolling(acc.id, acc.sync_interval_sec);
    }

    console.log(`[IMAP] Initialized polling for ${result.rows.length} account(s)`);
  } catch (e) {
    console.error('[IMAP] Init error:', e.message);
  }
}

// ── Test connection (for settings UI) ───────────────────────────────────
async function testConnection(config) {
  const client = new ImapFlow({
    host: config.imap_host,
    port: config.imap_port || 993,
    secure: config.imap_tls !== false,
    auth: {
      user: config.imap_user,
      pass: config.imap_pass || decrypt(config.imap_pass_encrypted)
    },
    logger: false,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });

  try {
    await client.connect();
    const status = await client.status(config.imap_folder || 'INBOX', { messages: true, unseen: true });
    await client.logout();
    return { success: true, messages: status.messages, unseen: status.unseen };
  } catch (e) {
    try { await client.logout(); } catch (_) {}
    return { success: false, error: e.message };
  }
}

// ── Manual sync trigger ─────────────────────────────────────────────────
async function manualSync(accountId) {
  // Create a manual sync log
  const logRes = await db.query(
    `UPDATE email_sync_log SET sync_type = 'manual' WHERE id = (
      SELECT id FROM email_sync_log WHERE account_id = $1 ORDER BY started_at DESC LIMIT 1
    ) RETURNING id`, [accountId]
  ).catch(() => null);

  return syncAccount(accountId);
}

// ── Graceful shutdown ───────────────────────────────────────────────────
async function shutdown() {
  console.log('[IMAP] Shutting down...');
  isShuttingDown = true;
  stopAllPolling();

  // Close active IMAP connections
  for (const [accountId, client] of activeClients) {
    try {
      await client.logout();
      console.log(`[IMAP] Closed connection for account #${accountId}`);
    } catch (_) {}
  }
  activeClients.clear();
}

module.exports = {
  init,
  syncAccount,
  manualSync,
  startPolling,
  stopPolling,
  stopAllPolling,
  testConnection,
  shutdown,
  encrypt,
  decrypt
};
