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
const aiAnalyzer = require('./ai-email-analyzer');
const preTenderService = require('./pre-tender-service');
const platformParser = require('./platform-parser');

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
    if (err.message.includes('auth') || err.message.includes('login') || err.message.includes('credentials')) {
      console.error(`[IMAP] ⚠️  Authentication failed for account #${accountId}. Check IMAP_USER/IMAP_PASS or email_accounts credentials.`);
    }
    if (err.message.includes('ECONNREFUSED') || err.message.includes('ETIMEDOUT') || err.message.includes('getaddrinfo')) {
      console.error(`[IMAP] ⚠️  Connection failed for account #${accountId}. Check IMAP_HOST and network access.`);
    }

    await db.query(
      'UPDATE email_accounts SET last_sync_error = $1, updated_at = NOW() WHERE id = $2',
      [err.message, accountId]
    ).catch((dbErr) => { console.error('[IMAP] DB error saving sync error:', dbErr.message); });

    await db.query(
      `UPDATE email_sync_log SET status = 'error', errors_count = $1, error_details = $2,
       duration_ms = $3, completed_at = NOW() WHERE id = $4`,
      [1, JSON.stringify([{ error: err.message }]), Date.now() - startMs, syncLogId]
    ).catch((dbErr) => { console.error('[IMAP] DB error saving sync log:', dbErr.message); });
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

  // AI analysis is now decoupled — runs asynchronously after sync completes
  // (see processUnanalyzedEmails below)

  return { isNew: true, attachmentCount };
}

// ── Async AI processing (decoupled from sync loop) ──────────────────────
const AI_SKIP_TYPES = ['internal', 'spam', 'newsletter', 'notification', 'auto_reply'];
const AI_BATCH_SIZE = 5;       // process N emails concurrently
const AI_PROCESS_INTERVAL = 30000; // run every 30 sec
let aiProcessorTimer = null;
let aiProcessorRunning = false;

/**
 * Process a single email with AI analysis.
 * Updates emails table and creates inbox_application.
 */
async function analyzeOneEmail(email) {
  const emailId = email.id;
  try {
    // Pre-filter: пропускаем bounce, internal, system emails БЕЗ обращения к AI
    const skipCheck = aiAnalyzer.shouldSkipEmail({
      fromEmail: email.from_email,
      subject: email.subject,
      bodyText: email.body_text
    });
    if (skipCheck.skip) {
      console.log(`[IMAP-AI] Skipping email #${emailId}: ${skipCheck.reason} (from: ${email.from_email})`);
      await db.query(
        `UPDATE emails SET ai_processed_at = NOW(), ai_summary = $1, ai_classification = 'other', ai_color = 'red', updated_at = NOW() WHERE id = $2`,
        [`[Пропущено: ${skipCheck.reason}]`, emailId]
      );
      return true; // Считаем обработанным, но НЕ создаём inbox_application
    }

    const attRes = await db.query(
      'SELECT original_filename FROM email_attachments WHERE email_id = $1',
      [emailId]
    );
    const attNames = attRes.rows.map(a => a.original_filename || 'file');

    const analysis = await aiAnalyzer.analyzeEmail({
      emailId,
      subject: email.subject,
      bodyText: email.body_text,
      fromEmail: email.from_email,
      fromName: email.from_name,
      attachmentNames: attNames
    });

    const workload = await aiAnalyzer.getWorkloadData();

    // Update the emails table with AI results
    await db.query(`
      UPDATE emails SET
        ai_classification = $1, ai_color = $2, ai_summary = $3,
        ai_recommendation = $4, ai_processed_at = NOW(), updated_at = NOW()
      WHERE id = $5
    `, [
      analysis.classification, analysis.color,
      analysis.summary, analysis.recommendation,
      emailId
    ]);

    // Create inbox_application ONLY for genuine work proposals/tenders
    const applicationTypes = ['direct_request', 'platform_tender', 'commercial_offer'];
    if (applicationTypes.includes(analysis.classification) && !analysis._skipped) {
      await db.query(`
        INSERT INTO inbox_applications (
          email_id, source, source_email, source_name, subject, body_preview,
          ai_classification, ai_color, ai_summary, ai_recommendation,
          ai_work_type, ai_estimated_budget, ai_estimated_days,
          ai_keywords, ai_confidence, ai_raw_json, ai_analyzed_at, ai_model,
          workload_snapshot, attachment_count, status
        ) VALUES (
          $1, 'email', $2, $3, $4, $5,
          $6, $7, $8, $9,
          $10, $11, $12,
          $13, $14, $15, NOW(), $16,
          $17, $18, 'ai_processed'
        ) ON CONFLICT DO NOTHING
      `, [
        emailId,
        email.from_email || '', email.from_name || '',
        email.subject || '(без темы)', (email.body_text || '').slice(0, 500),
        analysis.classification, analysis.color, analysis.summary, analysis.recommendation,
        analysis.work_type, analysis.estimated_budget, analysis.estimated_days,
        JSON.stringify(analysis.keywords || []), analysis.confidence, JSON.stringify(analysis), analysis._raw?.model || null,
        JSON.stringify(workload), email.attachment_count || 0
      ]);

      console.log(`[IMAP-AI] Created application for email #${emailId}: ${analysis.color} / ${analysis.classification}`);

      // Create pre-tender request
      try {
        await preTenderService.createPreTenderFromEmail(emailId);
      } catch (ptErr) {
        console.error('[IMAP-AI] Pre-tender error:', ptErr.message);
      }

      // Parse platform tenders
      if (email.email_type === 'platform_tender' || analysis.classification === 'platform_tender') {
        try {
          await platformParser.parseAndSave(emailId);
        } catch (ppErr) {
          console.error('[IMAP-AI] Platform parse error:', ppErr.message);
        }
      }
    } else {
      console.log(`[IMAP-AI] Skipped application creation for email #${emailId}: ${analysis.classification} (not a work proposal)`);
    }

    return true;
  } catch (err) {
    console.error(`[IMAP-AI] Error processing email #${emailId}:`, err.message);
    // Mark as failed so we don't retry endlessly
    await db.query(
      `UPDATE emails SET ai_processed_at = NOW(), ai_summary = $1, updated_at = NOW() WHERE id = $2`,
      ['[Ошибка AI-анализа: ' + err.message.slice(0, 200) + ']', emailId]
    ).catch(() => {});
    return false;
  }
}

/**
 * Process unanalyzed emails in batches with concurrency.
 * This runs independently from the IMAP sync loop.
 */
async function processUnanalyzedEmails() {
  if (isShuttingDown || aiProcessorRunning) return;
  aiProcessorRunning = true;

  try {
    // Find emails that need AI analysis
    const typePlaceholders = AI_SKIP_TYPES.map((_, i) => `$${i + 1}`).join(',');
    const res = await db.query(`
      SELECT id, subject, body_text, from_email, from_name, email_type, attachment_count
      FROM emails
      WHERE ai_processed_at IS NULL
        AND direction = 'inbound'
        AND email_type NOT IN (${typePlaceholders})
        AND is_deleted = false
      ORDER BY email_date DESC
      LIMIT $${AI_SKIP_TYPES.length + 1}
    `, [...AI_SKIP_TYPES, AI_BATCH_SIZE]);

    if (res.rows.length === 0) {
      aiProcessorRunning = false;
      return;
    }

    console.log(`[IMAP-AI] Processing ${res.rows.length} unanalyzed emails...`);

    // Process batch concurrently
    const results = await Promise.allSettled(
      res.rows.map(email => analyzeOneEmail(email))
    );

    const ok = results.filter(r => r.status === 'fulfilled' && r.value).length;
    const fail = results.length - ok;
    console.log(`[IMAP-AI] Batch done: ${ok} ok, ${fail} failed`);

    // Also mark skippable types as processed (no AI needed)
    await db.query(`
      UPDATE emails SET ai_processed_at = NOW(), ai_summary = '[Пропущено — тип не требует AI]'
      WHERE ai_processed_at IS NULL
        AND direction = 'inbound'
        AND email_type IN (${typePlaceholders})
    `, AI_SKIP_TYPES).catch(() => {});
  } catch (err) {
    console.error('[IMAP-AI] Batch processor error:', err.message);
  } finally {
    aiProcessorRunning = false;
  }
}

function startAiProcessor() {
  if (aiProcessorTimer) return;
  aiProcessorTimer = setInterval(() => {
    if (!isShuttingDown) processUnanalyzedEmails().catch(() => {});
  }, AI_PROCESS_INTERVAL);
  // Also run once immediately after a short delay
  setTimeout(() => processUnanalyzedEmails().catch(() => {}), 10000);
  console.log(`[IMAP-AI] Background AI processor started (every ${AI_PROCESS_INTERVAL / 1000}s, batch=${AI_BATCH_SIZE})`);
}

function stopAiProcessor() {
  if (aiProcessorTimer) {
    clearInterval(aiProcessorTimer);
    aiProcessorTimer = null;
  }
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
    // Trigger AI processing after sync
    processUnanalyzedEmails().catch(() => {});
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

// ── Auto-provision email account from ENV if none exist ──────────────────
async function autoProvisionFromEnv() {
  const imapHost = process.env.IMAP_HOST;
  const imapUser = process.env.IMAP_USER;
  const imapPass = process.env.IMAP_PASS;

  if (!imapHost || !imapUser || !imapPass) {
    return false;
  }

  // Check if any account already exists
  const existing = await db.query('SELECT id FROM email_accounts LIMIT 1');
  if (existing.rows.length > 0) {
    return false; // accounts exist, don't auto-provision
  }

  console.log(`[IMAP] Auto-provisioning email account from ENV: ${imapUser}@${imapHost}`);

  const smtpHost = process.env.SMTP_HOST || '';
  const smtpUser = process.env.SMTP_USER || imapUser;
  const smtpPass = process.env.SMTP_PASS || imapPass;
  const emailAddress = imapUser.includes('@') ? imapUser : `${imapUser}@${imapHost.replace(/^imap\./, '')}`;

  try {
    await db.query(`
      INSERT INTO email_accounts (
        name, email_address, account_type,
        imap_host, imap_port, imap_user, imap_pass_encrypted, imap_tls, imap_folder,
        smtp_host, smtp_port, smtp_user, smtp_pass_encrypted, smtp_tls, smtp_from_name,
        sync_enabled, sync_interval_sec, sync_max_emails,
        is_active
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
    `, [
      'Основной почтовый ящик', emailAddress, 'primary',
      imapHost,
      parseInt(process.env.IMAP_PORT || '993'),
      imapUser,
      encrypt(imapPass),
      process.env.IMAP_TLS !== 'false',
      process.env.IMAP_FOLDER || 'INBOX',
      smtpHost,
      parseInt(process.env.SMTP_PORT || '587'),
      smtpUser,
      encrypt(smtpPass),
      process.env.SMTP_SECURE === 'true',
      process.env.SMTP_FROM_NAME || 'ООО «Асгард Сервис»',
      true, 120, 200,
      true
    ]);
    console.log('[IMAP] Email account auto-provisioned successfully');
    return true;
  } catch (e) {
    console.error('[IMAP] Auto-provision error:', e.message);
    return false;
  }
}

// ── Init: start polling for all active accounts ─────────────────────────
async function init() {
  try {
    // Auto-provision from ENV if no accounts exist
    await autoProvisionFromEnv();

    const result = await db.query(
      'SELECT id, email_address, imap_host, sync_interval_sec FROM email_accounts WHERE is_active = true AND sync_enabled = true'
    );

    if (result.rows.length === 0) {
      console.log('[IMAP] No active email accounts to sync');
      console.log('[IMAP] To enable: set IMAP_HOST, IMAP_USER, IMAP_PASS in .env or add account via /api/mailbox/accounts');
      return;
    }

    for (const acc of result.rows) {
      console.log(`[IMAP] Starting sync for ${acc.email_address} via ${acc.imap_host}`);
      startPolling(acc.id, acc.sync_interval_sec);
    }

    // Start background AI processor
    startAiProcessor();

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
  stopAiProcessor();

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
  decrypt,
  processUnanalyzedEmails
};
