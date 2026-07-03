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

  // Без этого listener'а async-ошибки TLS-socket (Yandex периодически дропает
  // long-lived IMAP-коннект → ECONNRESET/EPIPE через часы работы) пробрасываются
  // как uncaughtException и кладут весь сервис (21.06.2026 прод лежал 2 часа).
  // Сама ошибка sync уже обрабатывается в syncAccount catch — здесь только
  // глушим bubble-up чтобы процесс не упал.
  client.on('error', (err) => {
    console.error(`[IMAP] Async client error account=${account.id} (handled):`, err.code || err.message);
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

  // Deduplication check (H2: UNIQUE partial-индекс на emails.message_id с V224
  // закрывает гонку; ниже INSERT использует ON CONFLICT DO NOTHING RETURNING id).
  // Сначала — быстрая выборка для UPDATE flags существующих писем.
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
  // H2: гонка между двумя параллельными IMAP-syncами по одному Message-ID
  // закрывается partial UNIQUE-индексом uq_emails_message_id (V224) +
  // ON CONFLICT DO NOTHING RETURNING id. rowCount=0 → дубль уже вставлен.
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
    )
    ON CONFLICT (message_id)
      WHERE message_id IS NOT NULL AND message_id <> ''
      DO NOTHING
    RETURNING id
  `, [
    account.id, messageId, inReplyTo, referencesHeader, threadId,
    fromAddr.address || '', fromAddr.name || '', JSON.stringify(toEmails), JSON.stringify(ccEmails), JSON.stringify(bccEmails), replyToEmail,
    parsed.subject || '(без темы)', bodyText, bodyHtml, bodyHtmlRaw, snippet,
    emailType, classConfidence, classRuleId,
    isRead, hasAttachments, attachments.length, totalAttSize,
    msg.uid, account.imap_folder || 'INBOX', flags, rawHeaders,
    parsed.date || new Date()
  ]);

  // Гонка: другой sync успел вставить раньше — выходим спокойно.
  if (emailRes.rowCount === 0) {
    return { isNew: false, attachmentCount: 0, dedupedByConflict: true };
  }

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

// Self-healing helper: update ai_classification regardless of column type (jsonb, json, or text)
async function updateEmailAiClassification(emailId, classification, color, summary, recommendation) {
  const classStr = String(classification || 'other');
  const jsonVal = JSON.stringify(classStr);
  const params = [(color || 'yellow').slice(0, 50), (summary || '').slice(0, 2000), (recommendation || '').slice(0, 2000), emailId];

  // Try 1: JSONB cast (correct for jsonb column)
  try {
    await db.query(`
      UPDATE emails SET
        ai_classification = $1::jsonb, ai_color = $2, ai_summary = $3,
        ai_recommendation = $4, ai_processed_at = NOW(), updated_at = NOW()
      WHERE id = $5
    `, [jsonVal, ...params]);
    return;
  } catch (e) {
    if (!e.message.includes('invalid input syntax for type json')) throw e;
    console.warn(`[IMAP-AI] JSONB cast failed for email #${emailId}, falling back to text`);
  }

  // Try 2: plain text (for text/varchar column)
  try {
    await db.query(`
      UPDATE emails SET
        ai_classification = $1, ai_color = $2, ai_summary = $3,
        ai_recommendation = $4, ai_processed_at = NOW(), updated_at = NOW()
      WHERE id = $5
    `, [classStr, ...params]);
    return;
  } catch (e2) {
    console.warn(`[IMAP-AI] Text insert also failed for email #${emailId}: ${e2.message}, trying plain string`);
  }

  // Try 3: last resort — store as plain string without JSON wrapping
  await db.query(`
    UPDATE emails SET
      ai_classification = $1, ai_color = $2, ai_summary = $3,
      ai_recommendation = $4, ai_processed_at = NOW(), updated_at = NOW()
    WHERE id = $5
  `, [jsonVal, ...params]);
}

// ── Forward-email detection (§2.5) ──────────────────────────────────────────
// Внутренние домены — для определения «отправитель свой сотрудник переслал» (corporate_forward)
// vs «внешний прямой отправитель» (external_direct).
const INTERNAL_DOMAINS = ['asgard-crm.ru', 'asgard-service.ru', 'asgard-service.com', 'asgard-s.ru', 'асгард.рф'];

function isInternalSender(fromEmail) {
  const f = (fromEmail || '').toLowerCase();
  for (const d of INTERNAL_DOMAINS) {
    if (f.includes(d)) return true;
  }
  return false;
}

/**
 * Эвристика: письмо — это пересланное?
 * Проверяем (а) шапки X-Forwarded-For / Resent-From в raw_headers,
 * (б) типовые маркеры в body: «Forwarded message», «Пересланное сообщение»,
 *    блок «От:/From:» + «Кому:/To:».
 */
function detectForwarded(parsed, bodyText, rawHeaders, bodyHtml) {
  const headers = rawHeaders || '';

  // Заголовки
  if (/X-Forwarded-For:|Resent-From:|Resent-Sender:/i.test(headers)) {
    return true;
  }

  // Если body_text пустой (HTML-only письмо), снимаем теги из HTML.
  let body = bodyText || '';
  if (!body && bodyHtml) {
    body = String(bodyHtml)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?(p|div|tr|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"');
  }

  // Маркеры в теле — typical forwarded blocks (включая Yandex Mail «Пересылаемое сообщение»)
  const reMarker = /^[ \t>]*(?:-{2,}\s*)?(?:Forwarded message|Пересланное сообщение|Пересылаемое сообщение|Begin forwarded message)/im;
  if (reMarker.test(body)) return true;

  // Блок «От:/Кому:» (русский) или «From:/To:» (англ.) в теле (forwarded inline)
  const reRuPair = /^[ \t>]*От:\s.+[\r\n]+[ \t>]*(?:Дата|Sent|Тема|Subject|Кому)/im;
  const reEnPair = /^[ \t>]*From:\s.+[\r\n]+[ \t>]*(?:Sent|Date|Subject|To):/im;
  if (reRuPair.test(body) || reEnPair.test(body)) return true;

  // Yandex inline-format: «Кому: …» + «Тема: …» в теле (после «Пересылаемое сообщение»)
  if (/Кому:\s.+[\r\n]+\s*Тема:/i.test(body)) return true;

  return false;
}

/**
 * Вынуть оригинального отправителя из тела forwarded-письма.
 *
 * Поддерживает многоуровневые цепочки форвардов и возвращает САМОГО ГЛУБОКОГО
 * ВНЕШНЕГО отправителя (= оригинальный клиент), а не первого попавшегося
 * внутреннего форвардера. Текст пересылок Yandex/Outlook/Gmail структурирован
 * сверху-вниз: outer → middle → inner, поэтому «глубже = ниже по тексту».
 *
 * Поддерживаемые форматы:
 *   От: Иван Иванов <ivan@example.com>
 *   From: John Doe <john@example.com>
 *   От: ivan@example.com   (без имени)
 *   Yandex с угловыми:  19.06.2026, 14:30, "Иван Иванов" <i.ivanov@client.ru>:
 *   Yandex bare (HTML-стрип):  23.06.2026, 09:21, karina@eurochem.ru (karina@eurochem.ru):
 *   Yandex bare с именем:      30.06.2026, 11:23, "Иван" ivan@client.ru:
 */
function extractOriginalSender(bodyText, bodyHtml) {
  let body = bodyText || '';
  if (!body && bodyHtml) {
    body = String(bodyHtml)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?(p|div|tr|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"');
  }

  const isInternal = (e) => INTERNAL_DOMAINS.some(d => String(e).toLowerCase().includes(d));
  const candidates = [];
  let m;

  // 1) «От: Имя <email>» / «From: Name <email>»  (все вхождения)
  const reFromAng = /^[ \t>]*(?:От|From):\s*(?:"?([^<\n"]+?)"?\s*)?<([^>\s]+@[^>\s]+)>/gm;
  while ((m = reFromAng.exec(body)) !== null) {
    candidates.push({ name: (m[1] || '').trim() || null, email: m[2].toLowerCase(), pos: m.index });
  }
  // 2) «От: email» (без угловых скобок) — Outlook после HTML-стрипа
  const reFromBare = /^[ \t>]*(?:От|From):\s*([^\s<>"]+@[^\s<>"]+)/gm;
  while ((m = reFromBare.exec(body)) !== null) {
    candidates.push({ name: null, email: m[1].toLowerCase().replace(/[:;,]+$/, ''), pos: m.index });
  }
  // 3) Yandex inline с угловыми: «ДД.ММ.ГГГГ, ЧЧ:ММ, "Имя" <email>:»
  const reYandexAng = /\d{1,2}\.\d{1,2}\.\d{2,4},\s*\d{1,2}:\d{2},\s*"?([^"<\n]+?)"?\s*<([^>\s]+@[^>\s]+)>/g;
  while ((m = reYandexAng.exec(body)) !== null) {
    candidates.push({ name: (m[1] || '').trim() || null, email: m[2].toLowerCase(), pos: m.index });
  }
  // 4) Yandex inline bare (после HTML-стрипа, mailto-ссылки стёрты):
  //    «"Имя" email:»  или  «email (email):»
  const reYandexBare = /\d{1,2}\.\d{1,2}\.\d{2,4},\s*\d{1,2}:\d{2},\s*(?:"([^"\n]+)"\s+)?([^\s\n,()<>:"]+@[^\s\n,()<>:"]+)/g;
  while ((m = reYandexBare.exec(body)) !== null) {
    candidates.push({ name: (m[1] || '').trim() || null, email: m[2].toLowerCase(), pos: m.index });
  }

  if (!candidates.length) return null;

  // Дедуп по email — сохраняем САМУЮ ГЛУБОКУЮ позицию (max pos) и любое
  // найденное имя. Глубокая позиция важна для сортировки «outer→inner».
  const byEmail = new Map();
  for (const c of candidates) {
    const prev = byEmail.get(c.email);
    if (!prev) { byEmail.set(c.email, { ...c }); continue; }
    if (c.pos > prev.pos) prev.pos = c.pos;
    if (!prev.name && c.name) prev.name = c.name;
  }
  const uniq = [...byEmail.values()].sort((a, b) => a.pos - b.pos);

  // Outer (top) → inner (bottom). Берём ПОСЛЕДНЕГО внешнего — он самый
  // глубокий и максимально близок к оригинальному клиенту.
  const externals = uniq.filter(c => !isInternal(c.email));
  if (externals.length) {
    const pick = externals[externals.length - 1];
    return { name: pick.name, email: pick.email };
  }
  // Все форвардеры внутренние — оригинального клиента в теле нет (или
  // не сматчился ни одной regex-эвристикой). Возвращаем null, чтобы AI
  // или ручная проверка могли добить.
  return null;
}

/**
 * Извлечь "чистый" текст ответа из тела письма-ответа в треде.
 * Срезает quoted previous message (Yandex/Outlook/Gmail форматы).
 */
function extractReplyText(bodyText, bodyHtml) {
  let body = bodyText || '';
  if (!body && bodyHtml) {
    body = String(bodyHtml)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?(p|div|tr|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"');
  }
  // Срезаем quoted блок — типичные маркеры начала цитаты предыдущего сообщения.
  const cutMarkers = [
    /^[ \t>]*-{2,}\s*\n[\s\S]*?Forwarded message/im,
    /^[ \t>]*-{2,}\s*Original Message/im,
    /^[ \t>]*Begin forwarded message/im,
    /^[ \t>]*Пересланное сообщение/im,
    /^[ \t>]*Пересылаемое сообщение/im,
    /^[ \t>]*Завершение пересылаемого/im,
    /^\d{1,2}\.\d{1,2}\.\d{2,4},\s*\d{1,2}:\d{2}/m,
    /^[ \t>]*От:\s.+[\r\n]+[ \t>]*(?:Дата|Sent|Тема|Subject|Кому)/im,
    /^[ \t>]*From:\s.+[\r\n]+[ \t>]*(?:Sent|Date|Subject|To):/im,
    /^On\s.+wrote:\s*$/m,
  ];
  for (const marker of cutMarkers) {
    const m = body.match(marker);
    if (m && m.index > 0) {
      body = body.slice(0, m.index);
      break;
    }
  }
  return (body.trim().slice(0, 4000)) || '(пустой ответ)';
}

/**
 * Wave-2.5: обработка ответа в треде на наш автоответ.
 * Если email — это ответ на сообщение с ai_classification LIKE 'autoreply_%',
 * то не создаём новую заявку, а:
 *   - находим оригинальное входящее → inbox_application
 *   - добавляем заметку на карту канбана (если назначен PM) ИЛИ
 *     дописываем в inbox_applications.decision_notes (если ещё не назначен)
 *   - createNotification для PM
 *   - помечаем email как ai_classification='thread_reply'.
 * Возвращает { handled: true, applicationId } если обработано, иначе null.
 */
async function tryHandleThreadReply(email) {
  const emailId = email.id;
  if (!email.in_reply_to) return null;

  // 1. Ищем "родителя" — должен быть наш outbound автоответ.
  const parentRes = await db.query(
    `SELECT id, message_id, in_reply_to, ai_classification, direction
     FROM emails WHERE message_id = $1 LIMIT 1`,
    [email.in_reply_to]
  );
  const parent = parentRes.rows[0];
  if (!parent) return null;

  const cls = (parent.ai_classification || '').toLowerCase();
  if (!cls.includes('autoreply')) return null;
  // Это ответ на наш autoreply.

  // 2. Идём дальше по in_reply_to: автоответ ссылается на оригинальное входящее.
  let originalEmailId = null;
  if (parent.in_reply_to) {
    const grand = await db.query(
      `SELECT id FROM emails WHERE message_id = $1 LIMIT 1`,
      [parent.in_reply_to]
    );
    if (grand.rows[0]) originalEmailId = grand.rows[0].id;
  }

  // 3. Находим inbox_application по оригинальному email (или fallback через References).
  let app = null;
  if (originalEmailId) {
    const r = await db.query(
      `SELECT id, assigned_pm_id FROM inbox_applications WHERE email_id = $1 LIMIT 1`,
      [originalEmailId]
    );
    app = r.rows[0] || null;
  }
  if (!app && email.references_header) {
    // Fallback: ищем по любому message_id из References
    const refs = (email.references_header.match(/<[^>]+>/g) || []).map(s => s.slice(1, -1));
    for (const mid of refs) {
      const r = await db.query(
        `SELECT ia.id, ia.assigned_pm_id FROM inbox_applications ia
         JOIN emails e ON e.id = ia.email_id WHERE e.message_id = $1 LIMIT 1`,
        [mid]
      );
      if (r.rows[0]) { app = r.rows[0]; break; }
    }
  }
  if (!app) return null;

  const replyText = extractReplyText(email.body_text, email.body_html);
  const replyAuthor = (email.from_name || email.from_email || 'неизвестно').toString();

  // 4. Если есть PM — добавляем заметку на карту канбана.
  let cardId = null;
  if (app.assigned_pm_id) {
    const cardRes = await db.query(
      `SELECT id, owner_user_id FROM personal_kanban_cards
       WHERE entity_kind='inbox_application' AND entity_id = $1 AND is_closed = false
       ORDER BY id DESC LIMIT 1`,
      [app.id]
    );
    const card = cardRes.rows[0];
    if (card) {
      cardId = card.id;
      const noteBody = `📨 Ответ в треде заявки от: ${replyAuthor}\n\n${replyText}`;
      await db.query(
        `INSERT INTO personal_kanban_card_notes (card_id, author_id, body)
         VALUES ($1, NULL, $2)`,
        [card.id, noteBody.slice(0, 4000)]
      );
      // Push PM-у
      try {
        const { createNotification } = require('./notify');
        await Promise.resolve(createNotification(db, {
          user_id: card.owner_user_id,
          title: `Ответ в треде заявки №${app.id}`,
          message: `${replyAuthor}: ${replyText.slice(0, 120)}`,
          type: 'personal_kanban_thread_reply',
          link: `#/personal-kanban?card=${card.id}`,
        })).catch(() => {});
      } catch (_) {}
    }
  } else {
    // 5. Нет PM — дописываем в decision_notes заявки.
    await db.query(
      `UPDATE inbox_applications
       SET decision_notes = COALESCE(decision_notes,'') || E'\n\n[Ответ в треде ' || to_char(now(),'YYYY-MM-DD HH24:MI') || E', от ' || $1 || E']\n' || $2,
           updated_at = now()
       WHERE id = $3`,
      [replyAuthor, replyText, app.id]
    );
  }

  // 6. Помечаем email как обработанный.
  await db.query(
    `UPDATE emails SET ai_processed_at = NOW(), ai_classification = $1 WHERE id = $2`,
    ['thread_reply', emailId]
  );

  console.log(`[IMAP-AI] #${emailId}: thread_reply linked to inbox_application #${app.id}` + (cardId ? ` (note added to card #${cardId})` : ' (appended to decision_notes)'));
  return { handled: true, applicationId: app.id, cardId };
}

/**
 * Process a single email with AI analysis.
 * Updates emails table and creates inbox_application.
 */
async function analyzeOneEmail(email) {
  const emailId = email.id;
  try {
    // Wave-2.5: проверка thread-reply ДО любой логики.
    // Если это ответ в треде нашего автоответа — не создаём новую заявку.
    try {
      const threadResult = await tryHandleThreadReply(email);
      if (threadResult && threadResult.handled) return;
    } catch (threadErr) {
      console.error(`[IMAP-AI] #${emailId} tryHandleThreadReply error:`, threadErr.message);
    }

    // Все входящие обрабатываются AI — он сам решает, заявка это или переписка

    const attRes = await db.query(
      'SELECT original_filename FROM email_attachments WHERE email_id = $1',
      [emailId]
    );
    const attNames = attRes.rows.map(a => a.original_filename || 'file');

    // ─── Forward-detect и определение source_kind ───────────────────────
    // Подтягиваем raw_headers (для шапок X-Forwarded-For/Resent-From).
    let rawHeaders = '';
    try {
      const rh = await db.query('SELECT raw_headers FROM emails WHERE id = $1', [emailId]);
      rawHeaders = rh.rows[0]?.raw_headers || '';
    } catch (_) {}

    const internalSender = isInternalSender(email.from_email);
    const forwarded = detectForwarded(null, email.body_text, rawHeaders, email.body_html);

    let sourceKind = 'unknown';
    let needsReview = false;
    let originalSender = null;
    let forwardedFromEmail = null;
    let forwardedByUserId = null;
    // overrides для analyzeEmail если forwarded — реальный клиент в теле
    let analyzeFromEmail = email.from_email;
    let analyzeFromName = email.from_name;

    if (forwarded) {
      // Это пересланное письмо. Источник — corporate_forward (если переслал свой) или
      // external_direct (если внешний прислал и сам же его пометил forwarded — редкость).
      sourceKind = internalSender ? 'corporate_forward' : 'external_direct';
      if (internalSender) {
        forwardedFromEmail = (email.from_email || '').toLowerCase();
        try {
          const u = await db.query(
            `SELECT id FROM users WHERE LOWER(email) = $1 AND is_active = TRUE LIMIT 1`,
            [forwardedFromEmail]);
          forwardedByUserId = u.rows[0]?.id || null;
        } catch (_) {}
      }
      originalSender = extractOriginalSender(email.body_text, email.body_html);
      if (originalSender) {
        analyzeFromEmail = originalSender.email;
        analyzeFromName = originalSender.name || email.from_name;
      }
    } else if (!internalSender) {
      // Прямое внешнее письмо — нужна ручная проверка по умолчанию
      sourceKind = 'external_direct';
      needsReview = true;
    } else {
      // Внутренний sender, не forwarded — оставляем 'unknown' (skipEmail может его отсечь)
      sourceKind = 'unknown';
    }

    console.log(`[IMAP-AI] #${emailId} step 1: calling analyzeEmail... (source_kind=${sourceKind}, forwarded=${forwarded})`);
    // 20.06.2026 фикс: некоторые email-клиенты (Яндекс через Fwd) шлют только HTML,
    // body_text=0. AI получал пустую строку → классифицировал как «other» → терялись заявки.
    // Если body_text пуст — извлекаем чистый текст из body_html (strip tags + decode entities).
    const _stripHtml = (h) => String(h || '')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<\/(div|p|br|h[1-6]|li|tr)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();
    const effectiveBodyText = email.body_text && email.body_text.trim().length > 30
      ? email.body_text
      : _stripHtml(email.body_html || '');
    const analysis = await aiAnalyzer.analyzeEmail({
      emailId,
      subject: email.subject,
      bodyText: effectiveBodyText,
      fromEmail: analyzeFromEmail,
      fromName: analyzeFromName,
      attachmentNames: attNames
    });
    console.log(`[IMAP-AI] #${emailId} step 2: analyzeEmail returned classification=${analysis.classification}, color=${analysis.color}`);

    // Fwd-парсинг: AI зачастую точнее regex-а extractOriginalSender (находит клиента
    // в подписи, ИНН-блоке, многоуровневой цепочке Fwd). Если regex не дал результата
    // ИЛИ дал внутренний домен — берём данные AI (parseAIResponse уже отфильтровал
    // asgard-домены). Если оба нашли — оставляем regex (он надёжнее для типового
    // блока «От: ... <email>», на нём построены все pre-tender-service маршруты).
    const aiHasOriginal = analysis.original_sender_email
      && !INTERNAL_DOMAINS.some(d => String(analysis.original_sender_email).toLowerCase().includes(d));
    if (!originalSender && aiHasOriginal) {
      originalSender = {
        name:  analysis.original_sender_name || null,
        email: String(analysis.original_sender_email).toLowerCase()
      };
      console.log(`[IMAP-AI] #${emailId} AI extracted original_sender (regex was empty): ${originalSender.email}`);
      // Если сорс_кайнд был unknown — это форвард, поднимаем до corporate_forward/external_direct
      if (sourceKind === 'unknown' && analysis.is_forwarded) {
        sourceKind = internalSender ? 'corporate_forward' : 'external_direct';
        if (internalSender && !forwardedFromEmail) {
          forwardedFromEmail = (email.from_email || '').toLowerCase();
        }
      }
    } else if (originalSender && aiHasOriginal
               && originalSender.email !== String(analysis.original_sender_email).toLowerCase()) {
      // Расхождение regex vs AI — логируем для аналитики, но regex имеет приоритет
      console.log(`[IMAP-AI] #${emailId} regex vs AI mismatch: regex="${originalSender.email}" AI="${String(analysis.original_sender_email).toLowerCase()}" — keeping regex`);
    }
    if (analysis._fwd_warning) {
      console.warn(`[IMAP-AI] #${emailId} AI flagged forwarded but did NOT extract original_sender — needs manual review`);
      needsReview = true;
    }

    const workload = await aiAnalyzer.getWorkloadData();
    console.log(`[IMAP-AI] #${emailId} step 3: calling updateEmailAiClassification...`);

    // Update the emails table with AI results
    await updateEmailAiClassification(
      emailId, analysis.classification, analysis.color,
      analysis.summary, analysis.recommendation
    );
    console.log(`[IMAP-AI] #${emailId} step 4: update done`);

    // ════════════════════════════════════════════════════════════════════
    // S-9 (Stage 2.6): addendum_response — продолжение по СУЩЕСТВУЮЩЕМУ
    // тендеру/работе (дозапрос, уточнение, протокол разногласий, ...).
    // Обрабатывается ДО tender_invitation чтобы фразы вроде «дозапрос по
    // тендеру №» не уходили в invitation (там слово «тендер» совпадёт).
    //
    // Match-стратегии (в порядке приоритета):
    //   (а) Thread match    — by in_reply_to → emails.linked_tender_id
    //   (б) Fuzzy match     — customer_inn exact + similarity(title, hint) > 0.4
    //                          в окне 60 дней, статус IN ('КП отправлено','Готово…','В работе')
    //   (в) Sender fallback — customer_email = from_email + 'КП отправлено' в окне 30 дней
    //
    // При match: создаём incoming correspondence (через correspondenceService),
    // опционально переводим тендер 'КП отправлено' → 'Дозапрос', audit_log + notify.
    // При неуспехе — fallthrough на tender_invitation / обычный inbox_application.
    // ════════════════════════════════════════════════════════════════════
    if (analysis.classification === 'addendum_response' && !analysis._skipped) {
      let parentTenderId = null;
      let matchStrategy = null;
      let parentTender = null;
      try {
        // ── (а) Thread match ────────────────────────────────────────────
        if (email.in_reply_to) {
          const tr = await db.query(
            `SELECT linked_tender_id FROM emails
              WHERE message_id = $1 AND linked_tender_id IS NOT NULL
              ORDER BY id DESC LIMIT 1`,
            [email.in_reply_to]
          );
          if (tr.rows[0] && tr.rows[0].linked_tender_id) {
            parentTenderId = tr.rows[0].linked_tender_id;
            matchStrategy = 'thread';
          }
        }

        // ── (б) Fuzzy: ИНН + title similarity ──────────────────────────
        const parentInn = analysis.parent_tender_inn || null;
        const parentHint = analysis.parent_tender_hint || null;
        if (!parentTenderId && parentInn) {
          try {
            const params = [parentInn];
            let sql;
            if (parentHint) {
              params.push(parentHint);
              sql = `SELECT id, tender_title, tender_status, customer_name
                       FROM tenders
                      WHERE customer_inn = $1
                        AND tender_status IN ('КП отправлено','Готово к отправке КП','В работе')
                        AND created_at > NOW() - INTERVAL '60 days'
                        AND similarity(COALESCE(tender_title,''), $2) > 0.4
                      ORDER BY similarity(COALESCE(tender_title,''), $2) DESC, created_at DESC
                      LIMIT 1`;
            } else {
              sql = `SELECT id, tender_title, tender_status, customer_name
                       FROM tenders
                      WHERE customer_inn = $1
                        AND tender_status IN ('КП отправлено','Готово к отправке КП','В работе')
                        AND created_at > NOW() - INTERVAL '60 days'
                      ORDER BY created_at DESC
                      LIMIT 1`;
            }
            const fz = await db.query(sql, params);
            if (fz.rows[0] && fz.rows[0].id) {
              parentTenderId = fz.rows[0].id;
              parentTender = fz.rows[0];
              matchStrategy = 'fuzzy_inn_title';
            }
          } catch (fuzzyErr) {
            // pg_trgm может быть не установлен на старом проде — graceful skip
            console.warn(`[IMAP-AI] addendum fuzzy match failed (pg_trgm?): ${fuzzyErr.message}`);
          }
        }

        // ── (в) Sender fallback: tenders.tender_email = from_email ──────
        // На текущей схеме поле называется tender_email (не customer_email,
        // что было в контракте — Finding для S-10 AUD).
        if (!parentTenderId && email.from_email) {
          const sf = await db.query(
            `SELECT id, tender_title, tender_status, customer_name
               FROM tenders
              WHERE LOWER(COALESCE(tender_email,'')) = LOWER($1)
                AND tender_status = 'КП отправлено'
                AND created_at > NOW() - INTERVAL '30 days'
              ORDER BY created_at DESC
              LIMIT 1`,
            [email.from_email]
          );
          if (sf.rows[0] && sf.rows[0].id) {
            parentTenderId = sf.rows[0].id;
            parentTender = sf.rows[0];
            matchStrategy = 'sender_email';
          }
        }

        if (parentTenderId) {
          // AI-системный пользователь (как в tender_invitation ниже)
          const aiUserRes = await db.query(`
            SELECT COALESCE(
              (SELECT id FROM users WHERE login='mimir_bot' AND is_active=true LIMIT 1),
              (SELECT id FROM users WHERE role='ADMIN' AND is_active=true ORDER BY id LIMIT 1)
            ) AS uid
          `);
          const aiUserId = aiUserRes.rows[0]?.uid || null;

          // INSERT incoming correspondence через сервис (берёт V252 поля + RBAC checks)
          const correspondenceService = require('./correspondence');
          let createdCorrId = null;
          try {
            const cr = await correspondenceService.createCorrespondence(
              db,
              {
                direction: 'incoming',
                date: email.email_date || new Date(),
                doc_type: 'letter',
                subject: (email.subject || '(без темы)').slice(0, 500),
                body: (email.body_text || '').slice(0, 50000),
                body_html: email.body_html || null,
                counterparty: (email.from_name || email.from_email || '').slice(0, 500),
                tender_id: parentTenderId,
                email_id: emailId,
                // letter_kind whitelist (V252): 9 значений включая 'response'.
                // 'addendum_response' — наш intent в AI, но в БД ближайший по
                // смыслу — 'response' (ответ организатора). Match-стратегию
                // фиксируем в audit_log (см. ниже) и в analysis._raw.
                letter_kind: 'response',
                status: 'received'
              },
              { userId: aiUserId }
            );
            createdCorrId = cr.item.id;
            console.log(`[IMAP-AI] addendum_response: создан correspondence #${createdCorrId} → tender #${parentTenderId} (strategy=${matchStrategy})`);
          } catch (corrErr) {
            console.warn(`[IMAP-AI] addendum_response: createCorrespondence упал: ${corrErr.message}`);
          }

          // Тендер 'КП отправлено' → 'Дозапрос' (по контракту §6 — сигнал РП)
          let statusChanged = false;
          try {
            if (!parentTender) {
              const tRes = await db.query('SELECT tender_status FROM tenders WHERE id=$1', [parentTenderId]);
              parentTender = tRes.rows[0] || null;
            }
            if (parentTender && parentTender.tender_status === 'КП отправлено') {
              const upd = await db.query(
                `UPDATE tenders SET tender_status='Дозапрос', updated_at=NOW()
                  WHERE id=$1 AND tender_status='КП отправлено'`,
                [parentTenderId]
              );
              statusChanged = upd.rowCount > 0;
            }
          } catch (updErr) {
            console.warn(`[IMAP-AI] addendum_response: UPDATE tenders.tender_status failed: ${updErr.message}`);
          }

          // Audit log
          try {
            await db.query(
              `INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, details, created_at)
                 VALUES ($1, 'tender', $2, 'ai_addendum_received', $3::jsonb, NOW())`,
              [
                aiUserId,
                parentTenderId,
                JSON.stringify({
                  email_id: emailId,
                  correspondence_id: createdCorrId,
                  classification: 'addendum_response',
                  ai_confidence: parseFloat(analysis.confidence) || 0,
                  ai_model: analysis._raw?.model || null,
                  match_strategy: matchStrategy,
                  parent_tender_inn: parentInn,
                  parent_tender_hint: parentHint,
                  tender_status_changed: statusChanged
                })
              ]
            );
          } catch (auditErr) {
            console.warn(`[IMAP-AI] audit_log addendum_response failed:`, auditErr.message);
          }

          // Notify HEAD_TO + DIRECTOR_COMM + PM тендера (если есть)
          try {
            const { createNotification } = require('./notify');
            const pmRes = await db.query(
              `SELECT responsible_pm_id, pm_id FROM tenders WHERE id=$1`,
              [parentTenderId]
            );
            const pmIds = pmRes.rows[0]
              ? [pmRes.rows[0].responsible_pm_id, pmRes.rows[0].pm_id].filter(Boolean)
              : [];
            const recipients = await db.query(
              `SELECT id FROM users
                 WHERE (role = ANY($1::text[]) OR id = ANY($2::int[]))
                   AND is_active = true`,
              [['HEAD_TO', 'DIRECTOR_COMM'], pmIds]
            );
            const titleLine = `Дозапрос по тендеру #${parentTenderId}`;
            const msgLine = `${(email.from_name || email.from_email || '').slice(0, 100)}: ${(email.subject || '').slice(0, 120)}`;
            for (const u of recipients.rows) {
              Promise.resolve(createNotification(db, {
                user_id: u.id,
                title: titleLine,
                message: msgLine,
                type: 'addendum_response_ai_received',
                link: `#/tenders?id=${parentTenderId}`
              })).catch(err => console.warn(`[IMAP-AI] addendum notify rejection (user #${u.id}):`, err.message));
            }
          } catch (notifyErr) {
            console.warn(`[IMAP-AI] addendum notify error:`, notifyErr.message);
          }

          // Match нашли — НЕ идём дальше в tender_invitation/inbox_applications.
          return;
        }

        // No match → fallthrough к tender_invitation/inbox_application,
        // но пометим что AI пытался (в лог).
        console.log(`[IMAP-AI] addendum_response classified, но parent не найден (inn=${parentInn} hint="${parentHint}" from=${email.from_email}) — fallthrough`);
      } catch (addendumErr) {
        console.error(`[IMAP-AI] addendum_response block error for email #${emailId}:`, addendumErr.message);
        // На любую ошибку — fallthrough, не падаем.
      }
    }

    // S-5: tender_invitation (приглашение в тендер от заказчика напрямую, не с площадки)
    // создаёт тендер СРАЗУ, минуя inbox_applications/pre_tender_requests. На канбане ТО
    // карта появляется в колонке «Новый» (через VIEW v_unified_kanban_cards, V238+V250).
    // Существующий поток inbox_application для другой классификации не затрагивается.
    if (analysis.classification === 'tender_invitation' && !analysis._skipped) {
      try {
        const confidence = parseFloat(analysis.confidence) || 0;

        const customerName = (analysis.extracted_customer_name
          || originalSender?.name
          || email.from_name
          || '(без названия)').slice(0, 500);
        const customerInn = (analysis.extracted_customer_inn || null);
        const tenderTitle = (email.subject || '(без темы)').slice(0, 1000);
        const tenderDescription = ((email.body_text || '').slice(0, 2000)) || null;
        const commentTo = (analysis.summary || '').slice(0, 2000) || null;

        // AI-системный пользователь: mimir_bot если есть, иначе первый активный ADMIN.
        // created_by_user_id в tenders nullable — NULL допустим как фоллбэк.
        const aiUserRes = await db.query(`
          SELECT COALESCE(
            (SELECT id FROM users WHERE login='mimir_bot' AND is_active=true LIMIT 1),
            (SELECT id FROM users WHERE role='ADMIN' AND is_active=true ORDER BY id LIMIT 1)
          ) AS uid
        `);
        const aiUserId = aiUserRes.rows[0]?.uid || null;

        const insRes = await db.query(`
          INSERT INTO tenders (
            customer_name, customer_inn, tender_title, tender_description,
            tender_status, tender_type,
            source, source_kind, platform, link,
            comment_to, ai_report,
            docs_deadline,
            created_by, created_by_user_id, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4,
            'Новый', 'Тендер',
            'email_invitation', 'email_invite', NULL, NULL,
            $5, $6,
            $7,
            $8, $8, NOW(), NOW()
          )
          RETURNING id, customer_name, tender_title
        `, [
          customerName, customerInn, tenderTitle, tenderDescription,
          commentTo,
          (analysis.recommendation || '').slice(0, 4000) || null,
          analysis.extracted_deadline || null,
          aiUserId
        ]);

        const newTenderId = insRes.rows[0].id;
        console.log(`[IMAP-AI] tender_invitation: создан tender #${newTenderId} из email #${emailId} (customer="${insRes.rows[0].customer_name}", confidence=${confidence})`);

        // Audit log
        try {
          await db.query(`
            INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, details, created_at)
            VALUES ($1, 'tender', $2, 'ai_created_from_email_invitation', $3::jsonb, NOW())
          `, [
            aiUserId,
            newTenderId,
            JSON.stringify({
              email_id: emailId,
              classification: 'tender_invitation',
              ai_confidence: confidence,
              ai_model: analysis._raw?.model || null,
              source_kind: 'email_invite',
              extracted_customer_inn: customerInn,
              extracted_deadline: analysis.extracted_deadline || null
            })
          ]);
        } catch (auditErr) {
          console.warn(`[IMAP-AI] audit_log INSERT failed for tender_invitation #${newTenderId}:`, auditErr.message);
        }

        // Уведомление HEAD_TO + DIRECTOR_GEN/COMM
        try {
          const { createNotification } = require('./notify');
          const recipients = await db.query(
            `SELECT id FROM users
               WHERE role = ANY($1::text[]) AND is_active = true`,
            [['HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM']]);
          const titleLine = `AI создал тендер #${newTenderId} из приглашения`;
          const msgLine = `${insRes.rows[0].customer_name}: ${(insRes.rows[0].tender_title || '').slice(0, 120)}`;
          for (const u of recipients.rows) {
            Promise.resolve(createNotification(db, {
              user_id: u.id,
              title: titleLine,
              message: msgLine,
              type: 'tender_invitation_ai_created',
              link: `#/tenders?id=${newTenderId}`
            })).catch(err => console.warn(`[IMAP-AI] tender-invitation notify rejection (user #${u.id}, tender #${newTenderId}):`, err.message));
          }
        } catch (notifyErr) {
          console.warn(`[IMAP-AI] tender-invitation notify error:`, notifyErr.message);
        }
      } catch (tenderErr) {
        console.error(`[IMAP-AI] tender_invitation INSERT error for email #${emailId}:`, tenderErr.message);
        // Не падаем — AI-анализ уже сохранён в updateEmailAiClassification
      }
    }

    // Create inbox_application ONLY for genuine work proposals/tenders
    const applicationTypes = ['direct_request', 'platform_tender', 'commercial_offer'];
    if (applicationTypes.includes(analysis.classification) && !analysis._skipped) {
      try {
        const confidence = parseFloat(analysis.confidence) || 0;
        // §2.5: низкий confidence → needs_review=true
        const needsReviewFinal = needsReview || confidence < 0.5;

        // source_email/name: для forwarded — оригинальный клиент, иначе — sender как есть.
        const sourceEmailFinal = originalSender?.email || email.from_email || '';
        const sourceNameFinal = originalSender?.name || email.from_name || '';

        // H2: UNIQUE partial-индекс uq_inbox_applications_email_id (V224) +
        // ON CONFLICT DO NOTHING закрывает гонку.
        const insRes = await db.query(`
          INSERT INTO inbox_applications (
            email_id, source, source_email, source_name, subject, body_preview,
            ai_classification, ai_color, ai_summary, ai_recommendation,
            ai_work_type, ai_estimated_budget, ai_estimated_days,
            ai_keywords, ai_confidence, ai_raw_json, ai_analyzed_at, ai_model,
            workload_snapshot, attachment_count, status,
            source_kind, needs_review,
            forwarded_by_user_id, forwarded_from_email,
            original_sender_email, original_sender_name,
            extracted_customer_name, extracted_customer_inn,
            extracted_customer_contact_email, extracted_customer_contact_person,
            extracted_customer_phone, extracted_customer_address
          ) VALUES (
            $1, 'email', $2, $3, $4, $5,
            $6, $7, $8, $9,
            $10, $11, $12,
            $13, $14, $15, NOW(), $16,
            $17, $18, 'ai_processed',
            $19, $20,
            $21, $22,
            $23, $24,
            $25, $26,
            $27, $28,
            $29, $30
          )
          ON CONFLICT (email_id) WHERE email_id IS NOT NULL DO NOTHING
          RETURNING id, subject, source_name, source_email
        `, [
          emailId,
          sourceEmailFinal, sourceNameFinal,
          email.subject || '(без темы)', (email.body_text || '').slice(0, 500),
          (analysis.classification || '').slice(0, 100), (analysis.color || '').slice(0, 50), (analysis.summary || '').slice(0, 2000), (analysis.recommendation || '').slice(0, 2000),
          (analysis.work_type || '').slice(0, 100), analysis.estimated_budget ? String(analysis.estimated_budget).slice(0, 100) : null, analysis.estimated_days ? String(analysis.estimated_days).slice(0, 100) : null,
          analysis.keywords || [], confidence, JSON.stringify(analysis), analysis._raw?.model || null,
          JSON.stringify(workload), email.attachment_count || 0,
          sourceKind, needsReviewFinal,
          forwardedByUserId, forwardedFromEmail,
          originalSender?.email || null, originalSender?.name || null,
          // 30.06.2026 bug #3: сохраняем реквизиты клиента, вытащенные AI из
          // тела/фото/подписи — иначе при конвертации в pre_tender заказчиком
          // подставлялся форвардер (наш сотрудник). Колонки добавлены ручным
          // ALTER на проде (schema-drift, в миграциях отсутствуют).
          analysis.extracted_customer_name ? String(analysis.extracted_customer_name).slice(0, 500) : null,
          analysis.extracted_customer_inn || null,
          analysis.extracted_customer_contact_email ? String(analysis.extracted_customer_contact_email).slice(0, 255) : null,
          analysis.extracted_customer_contact_person ? String(analysis.extracted_customer_contact_person).slice(0, 255) : null,
          analysis.extracted_customer_phone ? String(analysis.extracted_customer_phone).slice(0, 100) : null,
          analysis.extracted_customer_address ? String(analysis.extracted_customer_address).slice(0, 500) : null
        ]);

        // §2.7: рассылка директорам/HEAD_PM при создании новой заявки.
        if (insRes.rowCount > 0) {
          const newAppId = insRes.rows[0].id;
          try {
            const { createNotification } = require('./notify');
            const dirs = await db.query(
              `SELECT id FROM users
                WHERE role = ANY($1::text[]) AND is_active = true`,
              [['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_PM']]);
            const subjLine = (insRes.rows[0].source_name || sourceEmailFinal || 'отправитель')
              + ': ' + (insRes.rows[0].subject || '(без темы)').slice(0, 120);
            for (const dir of dirs.rows) {
              // H3 (Wave-2 fixer): ловим promise-rejection из async createNotification
              Promise.resolve(createNotification(db, {
                user_id: dir.id,
                title: `Новая заявка №${newAppId}`,
                message: subjLine,
                type: 'inbox_application_new',
                link: `#/inbox-applications?id=${newAppId}`
              })).catch(err => console.warn(`[IMAP-AI] directors-notify rejection for app #${newAppId}, dir #${dir.id}:`, err.message));
            }
          } catch (notifyErr) {
            console.error(`[IMAP-AI] directors-notify error for app #${newAppId}:`, notifyErr.message);
          }

          // §2.6 / Wave-2 F1: автоответ в той же ветке (corporate_forward → corporate_received,
          // external_direct → external_received). unknown/platform — не наша заявка, без ответа.
          try {
            const { sendAutoReply } = require('./crm-mailer');
            let mode = null;
            if (sourceKind === 'corporate_forward') mode = 'corporate_received';
            else if (sourceKind === 'external_direct') mode = 'external_received';
            if (mode) {
              // Не валит транзакцию — sendAutoReply сам глотает ошибки.
              sendAutoReply(db, { emailId, applicationId: newAppId, mode })
                .then(r => {
                  if (r && r.ok && r.sent) {
                    console.log(`[IMAP-AI] auto-reply sent for app #${newAppId} (mode=${mode}, in_reply_to=${r.inReplyTo || 'none'})`);
                  } else if (r && r.ok && r.fallback) {
                    console.log(`[IMAP-AI] auto-reply fallback (no SMTP) for app #${newAppId} (mode=${mode}, logged in emails table)`);
                  } else if (r && !r.ok) {
                    console.warn(`[IMAP-AI] auto-reply skipped for app #${newAppId}: ${r.reason}`);
                  }
                })
                .catch(e => console.warn('[IMAP-AI] auto-reply failed:', e.message));
            }
          } catch (autoReplyErr) {
            console.warn('[IMAP-AI] auto-reply require failed:', autoReplyErr.message);
          }
        }

        console.log(`[IMAP-AI] Created application for email #${emailId}: ${analysis.color} / ${analysis.classification} (source_kind=${sourceKind}, needs_review=${needsReviewFinal})`);

        // Generate detailed AI report (reads attachment contents: PDF, DOCX, XLSX)
        try {
          const aiReport = await aiAnalyzer.generateReport({
            emailId,
            subject: email.subject,
            bodyText: email.body_text,
            fromEmail: email.from_email,
            fromName: email.from_name,
            attachmentNames: attNames
          });
          if (aiReport) {
            await db.query('UPDATE inbox_applications SET ai_report = $1 WHERE email_id = $2', [aiReport, emailId]);
            console.log(`[IMAP-AI] Generated AI report for email #${emailId} (${aiReport.length} chars)`);
          }
        } catch (reportErr) {
          console.error(`[IMAP-AI] AI report generation error for email #${emailId}:`, reportErr.message);
        }
      } catch (appErr) {
        console.error(`[IMAP-AI] inbox_application INSERT error for email #${emailId}:`, appErr.message);
        // Don't fail the whole email — AI analysis was saved successfully
      }

      // 30.06.2026: Авто-создание pre_tender для прямых заявок и площадочных
      // тендеров → заявка СРАЗУ попадает в маркетплейс РП (assigned_to=NULL,
      // status='new'), любой РП может её забрать. Раньше (Wave B) требовался
      // ручной шаг директора «Завести просчёт», из-за чего заявки с почты
      // не появлялись в маркетплейсе РП и зависали в inbox_applications.
      //
      // createPreTenderFromEmail сам резолвит настоящего клиента из
      // original_sender для corporate_forward (через JOIN inbox_applications),
      // поэтому старый bug «customer_name = переслатель» здесь не повторяется.
      // commercial_offer остаётся ручным — это предложение поставщика, не запрос работ.
      if (analysis.classification === 'direct_request' || analysis.classification === 'platform_tender') {
        try {
          const preTenderService = require('./pre-tender-service');
          const r = await preTenderService.createPreTenderFromEmail(emailId);
          if (r && r.id) {
            console.log(`[IMAP-AI] Auto-created pre_tender #${r.id} from email #${emailId} (${analysis.classification})${r.exists ? ' [already existed]' : ' → marketplace'}`);
          }
        } catch (ptErr) {
          console.error(`[IMAP-AI] auto pre_tender creation error for email #${emailId}:`, ptErr.message);
        }
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
    console.error(`[IMAP-AI] Stack trace:`, err.stack);
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
    // Find ALL inbound emails that need AI analysis (без фильтрации по типу — AI сам решает)
    const res = await db.query(`
      SELECT id, subject, body_text, body_html, from_email, from_name, email_type, attachment_count,
             in_reply_to, references_header
      FROM emails
      WHERE ai_processed_at IS NULL
        AND direction = 'inbound'
        AND is_deleted = false
      ORDER BY email_date DESC
      LIMIT $1
    `, [AI_BATCH_SIZE]);

    if (res.rows.length === 0) {
      // Diagnostic: log why there are 0 emails to process (run every ~5 minutes)
      if (!processUnanalyzedEmails._lastDiag || Date.now() - processUnanalyzedEmails._lastDiag > 300000) {
        processUnanalyzedEmails._lastDiag = Date.now();
        try {
          const diag = await db.query(`
            SELECT
              COUNT(*) FILTER (WHERE direction = 'inbound') as total_inbound,
              COUNT(*) FILTER (WHERE direction = 'inbound' AND is_deleted = false) as inbound_not_deleted,
              COUNT(*) FILTER (WHERE direction = 'inbound' AND is_deleted = false AND ai_processed_at IS NULL) as need_ai,
              COUNT(*) FILTER (WHERE direction = 'inbound' AND is_deleted = false AND ai_processed_at IS NOT NULL) as already_processed,
              COUNT(*) FILTER (WHERE direction = 'inbound' AND is_deleted = false AND ai_summary LIKE '%Пропущено%') as skipped,
              COUNT(*) FILTER (WHERE direction = 'inbound' AND is_deleted = false AND ai_summary LIKE '%Ошибка%') as errored
            FROM emails
          `);
          const d = diag.rows[0];
          console.log(`[IMAP-AI] Diagnostic: total_inbound=${d.total_inbound}, not_deleted=${d.inbound_not_deleted}, need_ai=${d.need_ai}, already_processed=${d.already_processed}, skipped=${d.skipped}, errored=${d.errored}`);
        } catch (diagErr) {
          console.warn('[IMAP-AI] Diagnostic query failed:', diagErr.message);
        }
      }
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
  // On startup: reset skipped/errored emails then start processing
  setTimeout(async () => {
    try {
      const resetCount = await resetSkippedEmails();
      if (resetCount > 0) {
        console.log(`[IMAP-AI] Auto-reset ${resetCount} previously skipped/errored emails on startup`);
      }
    } catch (e) {
      console.warn('[IMAP-AI] Reset skipped emails error:', e.message);
    }
    processUnanalyzedEmails().catch(() => {});
  }, 10000);
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

  // Close active IMAP connections — с таймаутом на каждый logout. Иначе
  // полумёртвое TLS-соединение (напр. account #112 "Failed to establish
  // connection") вешает весь shutdown дольше systemd TimeoutStopSec → SIGKILL,
  // cgroup не убивается → осиротевший процесс продолжает жить (инцидент 30.06:
  // зомби на :3001 21ч, двойные крон-отчёты).
  const withTimeout = (p, ms) => Promise.race([
    p,
    new Promise((resolve) => setTimeout(resolve, ms)),
  ]);
  const closes = [];
  for (const [accountId, client] of activeClients) {
    closes.push(
      withTimeout(Promise.resolve(client.logout()).catch(() => {}), 2000)
        .then(() => console.log(`[IMAP] Closed connection for account #${accountId}`))
    );
  }
  await Promise.allSettled(closes);
  activeClients.clear();
}

/**
 * Reset emails that were skipped or errored during AI processing so they get reprocessed.
 * Clears ai_processed_at for emails with skip/error markers.
 */
async function resetSkippedEmails() {
  const result = await db.query(`
    UPDATE emails SET ai_processed_at = NULL, ai_summary = NULL, ai_classification = NULL, ai_color = NULL, updated_at = NOW()
    WHERE direction = 'inbound'
      AND is_deleted = false
      AND ai_processed_at IS NOT NULL
      AND (
        ai_summary LIKE '%Пропущено%'
        OR ai_summary LIKE '%Ошибка%'
        OR ai_summary LIKE '%skipped%'
        OR ai_classification IS NULL
        OR ai_classification = ''
        OR ai_classification = '"other"'
      )
  `);
  console.log(`[IMAP-AI] Reset ${result.rowCount} skipped/errored emails for reprocessing`);
  return result.rowCount;
}



// ═══════════════════════════════════════════════════════════════════
// PERSONAL USER ACCOUNTS — IMAP sync for user_email_accounts
// ═══════════════════════════════════════════════════════════════════
const personalTimers = new Map();   // userAccountId → timeoutId
const personalClients = new Map();  // userAccountId → ImapFlow

const MAX_PERSONAL_CONNECTIONS = 10;
let activePersonalConnections = 0;

/**
 * Sync a personal user email account
 */
async function syncUserAccount(userAccountId) {
  if (isShuttingDown) return { fetched: 0, newCount: 0 };
  if (activePersonalConnections >= MAX_PERSONAL_CONNECTIONS) {
    console.log(`[IMAP-Personal] Connection pool full, skipping account ${userAccountId}`);
    return { fetched: 0, newCount: 0, skipped: true };
  }

  const accRes = await db.query('SELECT * FROM user_email_accounts WHERE id = $1 AND is_active = true', [userAccountId]);
  if (accRes.rows.length === 0) return { fetched: 0, newCount: 0 };
  const account = accRes.rows[0];

  let client;
  let fetched = 0;
  let newCount = 0;

  try {
    activePersonalConnections++;

    client = new (require('imapflow').ImapFlow)({
      host: account.imap_host || 'imap.yandex.ru',
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

    personalClients.set(userAccountId, client);
    await client.connect();

    // Sync INBOX
    const lock = await client.getMailboxLock('INBOX');
    try {
      const lastUid = account.last_sync_uid || 0;
      const maxEmails = 100;
      const range = lastUid > 0 ? `${lastUid + 1}:*` : '1:*';
      let maxUid = lastUid;
      let count = 0;

      // Get inbox folder id
      const inboxFolder = await db.query(
        "SELECT id FROM email_folders WHERE user_account_id = $1 AND folder_type = 'inbox'",
        [userAccountId]
      );
      const inboxFolderId = inboxFolder.rows[0]?.id || null;

      for await (const msg of client.fetch(range, {
        uid: true, flags: true, envelope: true, source: true
      })) {
        if (isShuttingDown || count >= maxEmails) break;
        count++;

        try {
          const { simpleParser } = require('mailparser');
          const parsed = await simpleParser(msg.source);

          // Check if already exists
          const existing = await db.query(
            'SELECT id FROM emails WHERE message_id = $1 AND user_account_id = $2',
            [parsed.messageId, userAccountId]
          );
          if (existing.rows.length > 0) {
            if (msg.uid > maxUid) maxUid = msg.uid;
            continue;
          }

          // Save email
          const fromAddr = parsed.from?.value?.[0]?.address || '';
          const fromName = parsed.from?.value?.[0]?.name || '';
          const toEmails = (parsed.to?.value || []).map(t => ({ address: t.address, name: t.name || '' }));
          const ccEmails = (parsed.cc?.value || []).map(c => ({ address: c.address, name: c.name || '' }));
          const bodyText = parsed.text || '';
          const bodyHtml = parsed.html || '';
          const snippet = bodyText.replace(/\s+/g, ' ').trim().slice(0, 250);

          // Thread
          const inReplyTo = parsed.inReplyTo || null;
          const refsHeader = parsed.references ? (Array.isArray(parsed.references) ? parsed.references.join(' ') : parsed.references) : null;
          let threadId = null;
          if (refsHeader) {
            const refs = refsHeader.match(/<[^>]+>/g);
            if (refs && refs.length > 0) threadId = refs[0].replace(/[<>]/g, '');
          } else if (inReplyTo) {
            threadId = inReplyTo.replace(/[<>]/g, '');
          }

          // Attachments
          const attachments = parsed.attachments || [];
          const hasAttachments = attachments.length > 0;

          // Classify
          let emailType = 'unknown';
          let confidence = 0;
          try {
            const classResult = await classifier.classify({
              from_email: fromAddr,
              subject: parsed.subject || '',
              body_text: bodyText
            });
            emailType = classResult.type;
            confidence = classResult.confidence;
          } catch (e) { /* ignore */ }

          const insertRes = await db.query(`
            INSERT INTO emails (
              user_account_id, owner_user_id, folder_id,
              direction, message_id, in_reply_to, references_header, thread_id,
              from_email, from_name, to_emails, cc_emails,
              subject, body_text, body_html, snippet,
              email_type, classification_confidence,
              is_read, has_attachments, attachment_count,
              imap_uid, imap_folder,
              email_date, synced_at
            ) VALUES (
              $1, $2, $3,
              'inbound', $4, $5, $6, $7,
              $8, $9, $10, $11,
              $12, $13, $14, $15,
              $16, $17,
              false, $18, $19,
              $20, 'INBOX',
              $21, NOW()
            ) RETURNING id
          `, [
            userAccountId, account.user_id, inboxFolderId,
            parsed.messageId, inReplyTo, refsHeader, threadId,
            fromAddr, fromName, JSON.stringify(toEmails), JSON.stringify(ccEmails),
            parsed.subject || '', bodyText, bodyHtml, snippet,
            emailType, confidence,
            hasAttachments, attachments.length,
            msg.uid,
            parsed.date || new Date()
          ]);

          // Save attachments to disk
          if (hasAttachments && insertRes.rows[0]) {
            const emailId = insertRes.rows[0].id;
            const date = new Date().toISOString().slice(0, 10);
            const uuid = require('crypto').randomUUID();
            const dir = require('path').join(__dirname, '..', '..', 'uploads', 'mail', date, uuid);
            require('fs').mkdirSync(dir, { recursive: true });

            for (const att of attachments) {
              const safeFn = (att.filename || 'attachment').replace(/[^\w.\-а-яА-ЯёЁ ]/gi, '_').slice(0, 200);
              const fpath = require('path').join(dir, safeFn);
              require('fs').writeFileSync(fpath, att.content);
              const relPath = `uploads/mail/${date}/${uuid}/${safeFn}`;

              await db.query(`
                INSERT INTO email_attachments (email_id, filename, original_filename, file_path, mime_type, size, content_id, is_inline)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
              `, [emailId, safeFn, att.filename || safeFn, relPath, att.contentType || 'application/octet-stream', att.size || 0, att.contentId || null, att.contentDisposition === 'inline']);
            }
          }

          newCount++;
          fetched++;
          if (msg.uid > maxUid) maxUid = msg.uid;
        } catch (parseErr) {
          console.error(`[IMAP-Personal] Parse error uid=${msg.uid} account=${userAccountId}:`, parseErr.message);
        }
      }

      // Update last sync UID
      if (maxUid > lastUid) {
        await db.query(
          'UPDATE user_email_accounts SET last_sync_uid = $1, last_sync_at = NOW(), last_sync_error = NULL, updated_at = NOW() WHERE id = $2',
          [maxUid, userAccountId]
        );
      } else {
        await db.query(
          'UPDATE user_email_accounts SET last_sync_at = NOW(), last_sync_error = NULL, updated_at = NOW() WHERE id = $1',
          [userAccountId]
        );
      }

      // Update folder counts
      if (inboxFolderId) {
        const counts = await db.query(
          'SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_read = false) as unread FROM emails WHERE user_account_id = $1 AND folder_id = $2 AND is_deleted = false',
          [userAccountId, inboxFolderId]
        );
        await db.query(
          'UPDATE email_folders SET total_count = $1, unread_count = $2 WHERE id = $3',
          [parseInt(counts.rows[0].total), parseInt(counts.rows[0].unread), inboxFolderId]
        );
      }

    } finally {
      lock.release();
    }

    await client.logout();
  } catch (error) {
    console.error(`[IMAP-Personal] Sync error account=${userAccountId}:`, error.message);
    await db.query(
      'UPDATE user_email_accounts SET last_sync_error = $1, updated_at = NOW() WHERE id = $2',
      [error.message, userAccountId]
    ).catch(() => {});
  } finally {
    activePersonalConnections--;
    personalClients.delete(userAccountId);
    if (client) try { await client.logout(); } catch (e) {}
  }

  return { fetched, newCount };
}

/**
 * Start polling for all active personal accounts
 */
async function startPersonalPolling() {
  try {
    const accounts = await db.query('SELECT id, sync_interval_sec FROM user_email_accounts WHERE is_active = true');
    for (const acc of accounts.rows) {
      schedulePersonalSync(acc.id, (acc.sync_interval_sec || 120) * 1000);
    }
    console.log(`[IMAP-Personal] Started polling for ${accounts.rows.length} personal accounts`);
  } catch (e) {
    console.error('[IMAP-Personal] Failed to start polling:', e.message);
  }
}

function schedulePersonalSync(accountId, intervalMs) {
  if (personalTimers.has(accountId)) clearTimeout(personalTimers.get(accountId));
  if (isShuttingDown) return;

  const timer = setTimeout(async () => {
    try {
      await syncUserAccount(accountId);
    } catch (e) {
      console.error(`[IMAP-Personal] Scheduled sync error for ${accountId}:`, e.message);
    }
    if (!isShuttingDown) schedulePersonalSync(accountId, intervalMs);
  }, intervalMs);

  personalTimers.set(accountId, timer);
}

function stopPersonalPolling() {
  for (const [id, timer] of personalTimers) {
    clearTimeout(timer);
  }
  personalTimers.clear();
  for (const [id, client] of personalClients) {
    try { client.logout(); } catch (e) {}
  }
  personalClients.clear();
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
  processUnanalyzedEmails,
  resetSkippedEmails,
  syncUserAccount,
  startPersonalPolling,
  stopPersonalPolling,
  // S-9: экспортирован для smoke-тестов addendum_response. Не для прод-вызова —
  // принимает email-объект (строку из таблицы emails), вызывает AI + post-AI flow.
  analyzeOneEmail
};
