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
const syncBackoff = new Map();     // accountId → { failures, until }

function noteSyncFailure(accountId) {
  const prev = syncBackoff.get(accountId) || { failures: 0 };
  const failures = prev.failures + 1;
  const delayMs = Math.min(5 * 60 * 1000, 30_000 * Math.pow(2, Math.min(failures - 1, 4)));
  syncBackoff.set(accountId, { failures, until: Date.now() + delayMs });
}

function clearSyncBackoff(accountId) {
  syncBackoff.delete(accountId);
}
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

/**
 * V408: HTML → читаемый текст. Письма от людей часто приходят без plain-части
 * (только HTML) — тогда `parsed.text` пуст, и разбор письма теряет содержание.
 * Здесь: убираем style/script, превращаем блоки и <br> в переносы, снимаем теги,
 * декодируем основные сущности. Тонкость не нужна — нужен текст для разбора.
 */
function htmlToPlainText(html) {
  if (!html) return '';
  let s = String(html);
  s = s.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '');
  // Блочные концы → перенос строки, чтобы «строка = мысль» сохранялась.
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '• ');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&laquo;/gi, '«').replace(/&raquo;/gi, '»').replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–').replace(/&hellip;/gi, '…');
  s = s.replace(/&#(\d+);/g, (_, d) => { try { return String.fromCharCode(parseInt(d, 10)); } catch (_) { return ''; } });
  // Схлопываем пустые строки и отступы.
  s = s.split('\n').map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim()).join('\n');
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s;
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
    greetingTimeout: 20000,
    socketTimeout: 90000
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

  const backoff = syncBackoff.get(accountId);
  if (backoff && Date.now() < backoff.until) {
    return { fetched: 0, newCount: 0, skipped: true, reason: 'backoff' };
  }

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
    clearSyncBackoff(accountId);
  } catch (err) {
    console.error(`[IMAP] Sync error account #${accountId}:`, err.message);
    noteSyncFailure(accountId);
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

  // V408 (живой тест 18.10.2026): письмо от РП пришло ТОЛЬКО в HTML — `body_text`
  // оказался ПУСТЫМ (0 символов), хотя весь текст был в `body_html`. Из-за этого
  // не разобрались ни объект, ни просьба инициатора. Если plain-части нет,
  // извлекаем текст из HTML (убираем теги, склеиваем блоки, декодируем сущности).
  const bodyHtmlRaw = parsed.html || '';
  let bodyText = parsed.text || '';
  if (!bodyText.trim() && bodyHtmlRaw) {
    bodyText = htmlToPlainText(bodyHtmlRaw);
  }
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

  // B2/C4 (плана Часть II): маркируем входящую КОПИЮ CRM по account_id ящика
  // (надёжнее, чем to/cc/bcc — SMTP снимает Bcc). Копии исключаем из общей
  // AI-очереди, чтобы они не порождали ложных заявок.
  try {
    const copyMailboxId = parseInt(process.env.CRM_INTAKE_MAILBOX_ID || '', 10);
    const isCopyAccount = Number(account.id) === (copyMailboxId || 112);
    const crmSelf = String(account.email_address || '').toLowerCase();
    const toSelf = [...(toEmails || []), ...(ccEmails || [])].some((a) => String(a.address || '').toLowerCase() === crmSelf);
    if (isCopyAccount || toSelf) {
      await db.query('UPDATE emails SET is_crm_copy = true WHERE id = $1', [emailId]);
    }
  } catch (e) {
    console.error('[IMAP] is_crm_copy mark failed:', e.message);
  }

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

  // Часть II (V398): если это КОПИЯ на ящик CRM — сразу запускаем intake-контур
  // согласования: письмо+счёт → заявка awaiting_dir + строка реестра. Не ждём
  // общего AI-процессора (он классифицирует, но не создаёт заявок).
  try {
    const isCopy = await db.query('SELECT is_crm_copy, from_email, body_text, thread_id, in_reply_to, references_header FROM emails WHERE id=$1', [emailId]);
    const row = isCopy.rows[0];
    const thr = require('./approval-thread');
    // Кто считается согласующим: основной ящик + заместители из настроек.
    // V407: раньше проверяли ТОЛЬКО users.email основного согласующего — замена
    // через `doc_approver_emails` не работала.
    const allowedApprovers = await thr.approverEmails(db).catch(() => []);
    const senderAddr = thr.extractEmail(row && row.from_email);
    const isApproverSender = !!senderAddr && allowedApprovers.includes(senderAddr);

    // V407 (тест заказчика 18.10.2026): согласующий ОТВЕЧАЕТ, CRM в копии → ответ
    // приходит на ЯЩИК CRM и помечается `is_crm_copy=true`. Прежний код в этом
    // случае шёл в intake и ветку согласования ПРОПУСКАЛ — «Добро» не срабатывало.
    // Поэтому сначала: если отправитель — согласующий, обрабатываем как решение,
    // независимо от того, копия это или нет.
    if (isApproverSender) {
      await thr.handleApprovalReply(db, { id: emailId, ...(row || {}) })
        .then((r) => { if (r && (r.applied || r.needs_manual)) console.log('[IMAP] approval-thread:', JSON.stringify(r)); })
        .catch((e) => console.error('[IMAP] approval-thread failed:', e.message));
    } else if (row && row.is_crm_copy) {
      // Копия письма со счётом (не ответ согласующего) → intake: заявка + реестр.
      await runDocIntakeForEmail(db, emailId).catch((e) => console.error('[IMAP] doc-intake failed:', e.message));
    }
  } catch (_) { /* intake не должен ломать sync */ }

  return { isNew: true, attachmentCount };
}

/**
 * V398: intake-контур для письма-копии CRM.
 * Собирает PDF/PNG/JPEG-вложения, прогоняет OCR (если нужно) и extractInvoice,
 * затем doc-email-intake создаёт заявки/записи. Тело письма тоже проверяем
 * (счёт может быть в тексте). Всё идемпотентно (антидубль по email+attachment).
 * Экспортируется для тестов/ручного вызова.
 */
async function runDocIntakeForEmail(db, emailId) {
  const fd = parseInt(process.env.DOC_INTAKE_ENABLED === '1' ? '1' : '0', 10);
  const cfg = await db.query(`SELECT value_json FROM settings WHERE key='email_intake_enabled' LIMIT 1`).catch(() => ({ rows: [] }));
  let enabled = fd === 1;
  if (cfg.rows[0]) {
    let v = cfg.rows[0].value_json; try { v = JSON.parse(v); } catch (_) {}
    enabled = v === true || v === 'true';
  }
  if (!enabled) return { skipped: 'disabled' };

  const { extractInvoice } = require('./invoice-extract');
  const intake = require('./doc-email-intake');
  // V408 (живой тест 18.10.2026): берём ТЕМУ и HTML-часть — раньше читали только
  // `body_text`, который у HTML-писем пуст, а объект часто указан именно в теме.
  const email = (await db.query(
    `SELECT id, body_text, body_html, subject, from_email FROM emails WHERE id=$1`, [emailId])).rows[0];
  if (!email) return { skipped: 'no_email' };
  // Если plain-части нет — извлекаем текст из HTML (иначе письмо «пустое»).
  if (!String(email.body_text || '').trim() && email.body_html) {
    email.body_text = htmlToPlainText(email.body_html);
  }

  const atts = (await db.query(
    `SELECT id, filename, mime_type, file_path, is_inline FROM email_attachments WHERE email_id=$1`, [emailId])).rows;
  const invoiceAtts = atts.filter((a) => /pdf|image\//i.test(a.mime_type || '') && !a.is_inline);

  // Проверяем: похоже ли хоть одно вложение/тело на счёт (дешёвый пре-фильтр,
  // чтобы не гонять OCR на каждом письме).
  const looksLikeInvoice = (txt) => /сч[её]т|инн|бИК|р\/с|к\/с|к оплате/i.test(String(txt || ''));
  const invoices = [];
  for (const a of invoiceAtts) {
    let text = '';
    try {
      // V408 (живой тест 18.10.2026): раньше здесь стояло `resolveAttachmentPath`,
      // которой в коде НЕТ — условие всегда ложно, в OCR шёл ОТНОСИТЕЛЬНЫЙ путь
      // ('uploads/mail/...'), файл не находился и текст выходил ПУСТЫМ. Счёт при
      // этом классифицировался как «не счёт» (no_bank) — заявка не создавалась.
      // Теперь путь резолвим от базовой папки uploads (как resolveDocumentPath).
      const baseUploads = path.resolve(process.env.UPLOAD_DIR || process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads'));
      const rel = String(a.file_path || '').replace(/^\/?uploads\//i, '').replace(/^[\\/]+/, '');
      const full = path.isAbsolute(String(a.file_path || '')) ? String(a.file_path) : path.join(baseUploads, rel);
      if (/pdf/i.test(a.mime_type || '')) {
        const ocr = require('./pdf-ocr');
        const res = await ocr.ocrPdfPath(full, a.filename);
        text = res && res.text ? res.text : '';
      } else if (/image\//i.test(a.mime_type || '')) {
        // FAIL верификатора 17.10.2026: счета-СКАНЫ (JPEG/PNG) не обрабатывались
        // вовсе — OCR вызывался только для PDF, а картинка молча пропускалась.
        // Часть «ВСЕ счета должны обрабатываться» не выполнялась.
        const ocr = require('./pdf-ocr');
        const fs = require('fs');
        if (full && fs.existsSync(full)) {
          const buf = fs.readFileSync(full);
          const res = await ocr.ocrImageBuffer(buf, a.mime_type || 'image/jpeg', a.filename);
          text = res && res.text ? res.text : '';
        }
      }
      if (!text) console.warn(`[IMAP] intake: нет текста из вложения ${a.filename} (путь ${full})`);
    } catch (e) { console.warn('[IMAP] intake OCR: ' + e.message); }

    // D-337: пустой OCR — это НЕ «не счёт». Файл может быть счётом, который
    // модель не прочитала (блокировка ответа, битый рендер, скан без текста).
    // Молча выбрасывать вложение нельзя — деньги теряются. Такой файл отдаём
    // в intake с пустым текстом: строка создастся с пометкой «требует ручной
    // проверки», и человек увидит её в реестре.
    if (!text && a.mime_type && /pdf|image\//i.test(a.mime_type)) {
      console.warn(`[IMAP] intake: вложение «${a.filename}» не распознано — ставлю на ручной разбор`);
      invoices.push({ attachment: a, text: '[НЕ РАСПОЗНАНО АВТОМАТИЧЕСКИ — проверьте вложение вручную]' });
      continue;
    }

    if (!looksLikeInvoice(text)) continue;
    invoices.push({ attachment: a, text });
  }
  // Счёт в теле письма.
  if (!invoices.length && looksLikeInvoice(email.body_text)) {
    invoices.push({ attachment: null, text: email.body_text });
  }
  if (!invoices.length) {
    // Диагностика: почему письмо не признано счётом (частая причина — пустой текст).
    console.warn(`[IMAP] intake: письмо ${emailId} не признано счётом (вложений ${invoiceAtts.length}, text_len ${String(email.body_text || '').length})`);
    return { skipped: 'no_invoice_like' };
  }
  return intake.intakeEmail(db, { email, invoices, userId: null });
}

// ── Async AI processing (decoupled from sync loop) ──────────────────────
const AI_SKIP_TYPES = ['internal', 'spam', 'newsletter', 'notification', 'auto_reply'];
const AI_BATCH_SIZE = 5;       // process N emails concurrently
const AI_PROCESS_INTERVAL = 30000; // run every 30 sec
// D-204: после стольких неудачных попыток письмо перестаём крутить и отдаём людям.
const AI_MAX_ATTEMPTS = parseInt(process.env.AI_MAX_ATTEMPTS || '3', 10);
// D-347: политика повторов — инфраструктурные сбои (нет денег, 5xx, таймаут)
// НЕ тратят попытки, иначе одно пополнение баланса «съедает» письма навсегда.
const aiRetry = require('./ai-retry-policy');
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

    // Барьер счетов (19.10.2026): имя вложения критично для определения «счёт ли это».
    // `original_filename` часто NULL (загруженные/скан-файлы) — берём `filename` как
    // фолбэк, иначе барьер не видит «Скан_…», «invoice_…» и счёт уходит в маркетплейс.
    const attRes = await db.query(
      'SELECT original_filename, filename FROM email_attachments WHERE email_id = $1',
      [emailId]
    );
    const attNames = attRes.rows.map(a => a.original_filename || a.filename || 'file');

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
    // D-204: та же логика вынесена в общий util email-text.js — её же использует
    // pre-tender-service, чтобы не заполнять work_description пустой строкой.
    const { bestEmailText } = require('./email-text');
    const effectiveBodyText = bestEmailText(email);
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

    // ── D-204 + D-347: сбой разбора JSON/провайдера ──────────────────────
    // НЕ помечаем письмо обработанным (ai_processed_at = NULL), иначе заявка
    // потеряется навсегда.
    //
    // D-347 (23.10.2026): РАЗДЕЛЯЕМ ошибки. Инфраструктурный сбой (нет денег,
    // провайдер 5xx, таймаут, пустой ответ) — НЕ вина письма. Раньше три таких
    // подряд убивали письмо навсегда: закончились деньги → 4 счёта выпали из
    // очереди без возможности восстановления. Теперь инфраструктурные сбои
    // не жгут лимит: письмо ждёт (до 7 суток), остальные считаются как раньше.
    if (analysis._parse_failed) {
      const errClass = aiRetry.classifyAiError(analysis._parse_error);
      const isInfra = errClass === 'infra';
      const attemptRes = await db.query(`
        UPDATE emails
           SET ai_summary = $1,
               ai_color = ${isInfra ? "'amber'" : "'red'"},
               ai_attempts = COALESCE(ai_attempts, 0) + ${isInfra ? '0' : '1'},
               ai_infra_failures = COALESCE(ai_infra_failures, 0) + ${isInfra ? '1' : '0'},
               ai_last_error_class = $3,
               ai_last_error_at = NOW(),
               updated_at = NOW()
         WHERE id = $2
        RETURNING COALESCE(ai_attempts, 0) AS ai_attempts,
                  COALESCE(ai_infra_failures, 0) AS ai_infra_failures
      `, ['[' + (isInfra ? 'Временно не удалось (провайдер ИИ): ' : 'Разбор не удался: ')
        + (analysis._parse_error || 'parse_failed') + ']', emailId, errClass])
        .catch(() => ({ rows: [{ ai_attempts: 0, ai_infra_failures: 0 }] }));

      const attempts = attemptRes.rows?.[0]?.ai_attempts || 0;
      const infraFails = attemptRes.rows?.[0]?.ai_infra_failures || 0;

      if (isInfra) {
        // Попытки НЕ тратятся. Письмо останется в очереди и будет повторено,
        // когда провайдер оживёт. Потолок — по возрасту (7 суток).
        console.warn(`[IMAP-AI] #${emailId} инфраструктурный сбой (${analysis._parse_error}) ` +
          `— попытки НЕ тратятся (инфра-сбоев: ${infraFails}), письмо ждёт восстановления провайдера`);
        return false;
      }

      console.warn(`[IMAP-AI] #${emailId} _parse_failed (${analysis._parse_error}) — ai_processed_at НЕ выставлен, попытка ${attempts}/${AI_MAX_ATTEMPTS}`);

      if (attempts >= AI_MAX_ATTEMPTS) {
        try {
          const { createNotification } = require('./notify');
          // Роли синхронизированы с доступом к странице «Почта и заявки»
          // (public/assets/js/app.js: роут /mailbox, p:"mailbox"). HEAD_PM сюда
          // не входит — у него нет доступа к ящику, уведомление вело бы в 403.
          const recipients = await db.query(
            `SELECT id FROM users WHERE role = ANY($1::text[]) AND is_active = TRUE`,
            [['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_TO']]);
          for (const u of recipients.rows) {
            Promise.resolve(createNotification(db, {
              user_id: u.id,
              title: `Письмо #${emailId} не разобрал AI — нужна ручная проверка`,
              message: `${(email.subject || '(без темы)').slice(0, 120)} — ${attempts} неудачных попыток`,
              type: 'email_ai_needs_review',
              // D-204: раньше здесь был `#/mail?email=...` — такого роута нет
              // (роутер отдаёт /home), а mailbox.js не читает query. Ведём туда,
              // куда реально можно попасть; id и тема письма уже в тексте.
              link: `#/mailbox`
            })).catch(() => {});
          }
        } catch (notifyErr) {
          console.warn(`[IMAP-AI] needs_review notify failed for #${emailId}:`, notifyErr.message);
        }
      }

      return false;
    }

    const workload = await aiAnalyzer.getWorkloadData();
    // D-204 (дефект C): фиксацию «шаг 3» (updateEmailAiClassification) сняли отсюда —
    // она переехала в самый низ функции, ПОСЛЕ создания inbox_application/pre_tender.
    // `workload` остаётся нужен для INSERT inbox_applications ниже.

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
    // ══════════════════════════════════════════════════════════════════════════
    // БАРЬЕР (заказчик 19.10.2026): «письма на почту CRM помимо согласования
    // счетов ещё создают заявки, которые падают в маркетплейс заявок. Сделать
    // так, чтобы в маркетплейс не падали счета».
    //
    // Дефект подтверждён на ПРОДЕ: письмо #4847 «Fwd: Запрос КП: химические
    // реагенты» (вложение Скан_20261013.pdf = счёт «Мир Химии») классифицировано
    // как commercial_offer → создало заявку маркетплейса #31. Классификатор видит
    // «Запрос КП», но не понимает, что во вложении СЧЁТ.
    //
    // Барьер 3 уровня (жёсткий, не полагается на «понимание» ИИ):
    //   1) документ уже разобран intake-контуром (есть строка реестра) — это счёт;
    //   2) вложение похоже на счёт по имени;
    //   3) AI уже классифицировал как invoice_*/approval_*.
    // ══════════════════════════════════════════════════════════════════════════
    const INVOICE_CLASSES = ['invoice_approval_request', 'approval_decision', 'crm_invoice_copy'];
    const invInCls = INVOICE_CLASSES.includes(analysis.classification);
    let isInvoiceDoc = invInCls;
    if (!isInvoiceDoc) {
      try {
        // (1) intake уже создал строку реестра/заявку по этому письму → это счёт.
        const chk = await db.query(
          `SELECT (SELECT 1 FROM doc_registry WHERE created_by IS NOT NULL AND id IN
                     (SELECT doc_id FROM doc_email_intake WHERE email_id=$1 AND doc_id IS NOT NULL) LIMIT 1) AS in_reg,
                  (SELECT 1 FROM payment_invoices WHERE source_email_id=$1 LIMIT 1) AS in_pay,
                  (SELECT 1 FROM doc_email_intake WHERE email_id=$1 AND status IN ('parsed','needs_manual','created') LIMIT 1) AS in_intake`,
          [emailId]);
        const c = chk.rows[0] || {};
        if (c.in_reg || c.in_pay || c.in_intake) isInvoiceDoc = true;
      } catch (_) { /* при ошибке проверки не блокируем заявку рынка */ }
    }
    if (!isInvoiceDoc && Array.isArray(attNames) && attNames.length) {
      // (2) имя вложения похоже на счёт/УПД/платёжный документ.
      // FAIL верификатора 19.10.2026: прежний регексп без границ слов отсекал
      // НАСТОЯЩИЕ заявки («Ра-СЧЁТ-стоимости_работ.xlsx», «ТЗ_СЧЁТ-чики.pdf»,
      // «scan_ТЗ_обмеры.jpg»). Теперь два правила:
      //   • маркеры счёта — ТОЛЬКО целыми словами (границы слов);
      //   • если имя явно про РАБОТЫ (ТЗ/обмер/чертёж/смета/расчёт/ведомость),
      //     это документ заявки, а НЕ счёт — даже если содержит «скан».
      const RE_WORK_DOC = /(^|[^а-яёa-z])(тз|техзадани|обмер|черт[её]ж|смета|расч[её]т|ведомост|спецификац|запрос|проект)/i;
      const RE_INV_TOKEN = /(^|[^а-яёa-z])(сч[её]т|счета|счет|invoice|инвойс|сч[-\s]?фактур|упд|торг[-\s]?12|накладная|квитанц|скан|scan|платежн|payment)([^а-яёa-z]|$)/i;
      const isInvoiceName = attNames.some((n) => {
        const s = String(n || '');
        if (RE_WORK_DOC.test(s)) return false; // ТЗ/расчёт/обмер — документ работ, не счёт
        return RE_INV_TOKEN.test(s);
      });
      if (isInvoiceName) isInvoiceDoc = true;
    }

    if (applicationTypes.includes(analysis.classification) && !analysis._skipped) {
      if (isInvoiceDoc) {
        // Счёт — НЕ заявка маркетплейса. Он живёт в контуре оплаты (реестр + заявка
        // директору). Фиксируем факт отсечения, чтобы это было видно в разборе.
        console.log(`[IMAP-AI] #${emailId} классифицирован как ${analysis.classification}, НО это ДОКУМЕНТ-СЧЁТ (att="${(attNames || []).join(',')}") → заявка маркетплейса НЕ создаётся`);
        try {
          await db.query(
            `UPDATE emails SET ai_summary = COALESCE(ai_summary,'') || ' [счёт: заявка маркетплейса не создаётся]',
                    updated_at = NOW() WHERE id=$1`, [emailId]);
        } catch (_) { /* не критично */ }
      } else {
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
            // D-204 (дефект B, третий потребитель): тот же сырой body_text ломал AI-отчёт
            // у HTML-only писем. Берём уже вычисленный effectiveBodyText (body_text → stripHtml).
            bodyText: effectiveBodyText,
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
          const { resolvePmFromEmailText } = require('./pm-routing-from-email');
          const pmRoute = await resolvePmFromEmailText(
            email.subject,
            email.body_text || email.body_html,
            analysis.suggested_pm_name
          );
          const preTenderService = require('./pre-tender-service');
          const r = await preTenderService.createPreTenderFromEmail(emailId, {
            assignedTo: pmRoute?.pm_user_id || null,
            assignedBy: forwardedByUserId || null,
            assignNote: pmRoute
              ? `🎯 Автоназначение из письма: ${pmRoute.matched_name}`
              : null
          });
          if (r && r.id) {
            const dest = pmRoute ? `→ kanban PM ${pmRoute.matched_name}` : '→ marketplace';
            console.log(`[IMAP-AI] Auto-created pre_tender #${r.id} from email #${emailId} (${analysis.classification})${r.exists ? ' [already existed]' : ' ' + dest}`);
            if (pmRoute && !r.exists) {
              try {
                const { createNotification } = require('./notify');
                const { broadcast } = require('../routes/sse');
                await Promise.resolve(createNotification(db, {
                  user_id: pmRoute.pm_user_id,
                  title: `Заявка №${r.id} назначена вам автоматически`,
                  message: (email.subject || '').slice(0, 120),
                  type: 'pre_tender_auto_assigned',
                  link: `#/personal-kanban`
                })).catch(() => {});
                const dirs = await db.query(
                  `SELECT id FROM users WHERE role = ANY($1::text[]) AND is_active = TRUE`,
                  [['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_PM']]);
                for (const dir of dirs.rows) {
                  Promise.resolve(createNotification(db, {
                    user_id: dir.id,
                    title: `Автоназначение: ${pmRoute.matched_name} ← заявка #${r.id}`,
                    message: (email.subject || '').slice(0, 120),
                    type: 'pre_tender_auto_assigned',
                    link: `#/director-inbox?kind=pre_tender&id=${r.id}`
                  })).catch(() => {});
                }
                broadcast('pre_tender:assigned', { id: r.id, assigned_to: pmRoute.pm_user_id, auto: true });
              } catch (notifyErr) {
                console.warn('[IMAP-AI] auto-assign notify failed:', notifyErr.message);
              }
            }
          }
        } catch (ptErr) {
          // D-204 (дефект C): не глотаем молча. Сбой создания заявки — это ровно тот класс,
          // при котором письмо оставалось «обработанным», но заявки нет. Пробрасываем наверх,
          // чтобы сработала catch-ветка analyzeOneEmail: ai_processed_at НЕ выставится,
          // попытка учтётся, после лимита руководство получит уведомление.
          throw new Error('pre_tender creation failed: ' + (ptErr.message || ptErr));
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
      } // конец ветки «НЕ счёт → обычная заявка маркетплейса» (барьер счетов)
    } else {
      console.log(`[IMAP-AI] Skipped application creation for email #${emailId}: ${analysis.classification} (not a work proposal)`);
    }

    // D-204 (дефект C): фиксируем «обработано» только теперь — заявка/inbox_application
    // уже созданы (или классификация честно не подразумевает заявку). При любом сбое
    // выше ai_processed_at остаётся NULL и письмо вернётся в разбор, а не потеряется молча.
    await updateEmailAiClassification(
      emailId, analysis.classification, analysis.color,
      analysis.summary, analysis.recommendation
    );
    console.log(`[IMAP-AI] #${emailId} step 4: AI-разбор зафиксирован (ai_processed_at установлен)`);

    return true;
  } catch (err) {
    console.error(`[IMAP-AI] Error processing email #${emailId}:`, err.message);
    if (process.env.AI_DEBUG_STACK === '1') console.error('[IMAP-AI] Stack:', err.stack);
    // D-347: класс ошибки определяем по тексту — в catch приходят сетевые сбои,
    // таймауты, 5xx и «нет денег». Это НЕ вина письма: попытки не тратим.
    const rawMsg = String(err.message || '');
    const looksInfra = /(timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|socket hang up|fetch failed|50[0-4]\b|429|402|insufficient|credit|quota|rate.?limit|unauthorized|401)/i.test(rawMsg);
    const errClass = looksInfra ? 'infra' : aiRetry.classifyAiError('provider_error');
    const isInfra = errClass === 'infra';

    const errAttemptRes = await db.query(
      `UPDATE emails
          SET ai_summary = $1,
              ai_color = ${isInfra ? "'amber'" : "'red'"},
              ai_attempts = COALESCE(ai_attempts, 0) + ${isInfra ? '0' : '1'},
              ai_infra_failures = COALESCE(ai_infra_failures, 0) + ${isInfra ? '1' : '0'},
              ai_last_error_class = $3,
              ai_last_error_at = NOW(),
              updated_at = NOW()
        WHERE id = $2
      RETURNING COALESCE(ai_attempts, 0) AS ai_attempts,
                COALESCE(ai_infra_failures, 0) AS ai_infra_failures`,
      ['[' + (isInfra ? 'Временно не удалось (провайдер ИИ): ' : 'Ошибка AI-анализа: ')
        + err.message.slice(0, 200) + ']', emailId, errClass]
    ).catch(() => ({ rows: [] }));

    // D-347: при инфраструктурном сбое письмо остаётся в очереди — попытки не
    // тратятся, уведомление не нужно (это наша проблема, а не потеря письма).
    if (isInfra) {
      const n = errAttemptRes.rows?.[0]?.ai_infra_failures || 0;
      console.warn(`[IMAP-AI] #${emailId} инфраструктурный сбой — попытки НЕ тратятся ` +
        `(инфра-сбоев: ${n}), письмо ждёт восстановления провайдера: ${rawMsg.slice(0, 100)}`);
      return false;
    }

    // D-204 (дефект E): раньше уведомление уходило только из ветки `_parse_failed`.
    // Если письмо исчерпало попытки в этой catch-ветке, оно молча выпадало из выборки
    // (COALESCE(ai_attempts,0) < AI_MAX_ATTEMPTS) — «чёрная дыра» без единого сигнала людям.
    // Теперь лимит в этой ветке тоже эскалируется уведомлением о ручном разборе.
    const errAttempts = errAttemptRes.rows?.[0]?.ai_attempts || 0;
    if (errAttempts >= AI_MAX_ATTEMPTS) {
      try {
        const { createNotification } = require('./notify');
        const recipients = await db.query(
          `SELECT id FROM users WHERE role = ANY($1::text[]) AND is_active = TRUE`,
          [['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_TO']]);
        for (const u of recipients.rows) {
          Promise.resolve(createNotification(db, {
            user_id: u.id,
            title: `Письмо #${emailId} не разобрал AI — нужна ручная проверка`,
            message: `${(email.subject || '(без темы)').slice(0, 120)} — ${errAttempts} неудачных попыток (ошибка разбора)`,
            type: 'email_ai_needs_review',
            link: `#/mailbox`
          })).catch(() => {});
        }
        console.warn(`[IMAP-AI] #${emailId} исчерпал попытки (${errAttempts}/${AI_MAX_ATTEMPTS}) в catch-ветке — руководство уведомлено`);
      } catch (notifyErr) {
        console.warn(`[IMAP-AI] error-branch needs_review notify failed for #${emailId}:`, notifyErr.message);
      }
    }
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
    // D-204: письма, у которых исчерпан лимит попыток, в выборку не попадают —
    // они уже отданы людям (needs_review) и не крутятся бесконечно.
    //
    // D-347 (23.10.2026): лимит тратится ТОЛЬКО контентными сбоями. Письма с
    // инфраструктурными сбоями (нет денег / 5xx / таймаут) остаются в очереди —
    // для них ограничение по ВОЗРАСТУ (AI_INFRA_MAX_AGE_HOURS, 7 суток), а не
    // по числу попыток. Раньше одно «провайдер лёг» лишало нас счетов навсегда.
    const res = await db.query(`
      SELECT id, subject, body_text, body_html, from_email, from_name, email_type, attachment_count,
             in_reply_to, references_header, ai_attempts, ai_infra_failures,
             ai_last_error_class, ai_needs_manual, email_date
      FROM emails
      WHERE ai_processed_at IS NULL
        AND direction = 'inbound'
        AND is_deleted = false
        AND COALESCE(ai_needs_manual, false) = false
        AND (
          -- контентные сбои: до AI_MAX_ATTEMPTS
          (COALESCE(ai_last_error_class, 'infra') <> 'content' OR COALESCE(ai_attempts, 0) < $2)
          OR
          -- инфраструктурные: не старше потолка по возрасту
          (COALESCE(ai_last_error_class, 'infra') <> 'content'
           AND email_date > NOW() - ($3 || ' hours')::interval)
        )
      ORDER BY email_date DESC
      LIMIT $1
    `, [AI_BATCH_SIZE, AI_MAX_ATTEMPTS, String(aiRetry.INFRA_MAX_AGE_HOURS)]);
    // Дополнительная страховка в JS — та же политика, что и в SQL, но
    // переиспользуемая функция (её же используют тесты).
    const filtered = res.rows.filter((r) => aiRetry.canRetry(r, AI_MAX_ATTEMPTS));
    res.rows = filtered;

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
              COUNT(*) FILTER (WHERE direction = 'inbound' AND is_deleted = false AND ai_summary LIKE '%Ошибка%') as failed_ai
            FROM emails
          `);
          const d = diag.rows[0];
          console.log(`[IMAP-AI] Diagnostic: total_inbound=${d.total_inbound}, not_deleted=${d.inbound_not_deleted}, need_ai=${d.need_ai}, already_processed=${d.already_processed}, skipped=${d.skipped}, failed_ai=${d.failed_ai}`);
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
      // D-347: вернуть в очередь письма, потерянные из-за инфраструктурных
      // сбоев (нет денег на ИИ, провайдер лежал). Без этого они висят мёртвыми.
      const revived = await reviveInfraFailedEmails();
      if (revived > 0) {
        console.log(`[IMAP-AI] Revived ${revived} emails lost to provider failures on startup`);
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
    // D-204 / стенд: при IMAP_DISABLED=1 не поднимаем ни polling, ни AI-процессор,
    // ни resetSkippedEmails. Нужно, чтобы локальный сервер можно было поднять
    // на прод-БД только для просмотра UI и он НЕ выкачал почту и НЕ разослал
    // автоответы клиентам.
    if (process.env.IMAP_DISABLED === '1' || process.env.IMAP_DISABLED === 'true') {
      console.log('[IMAP] IMAP_DISABLED=1 — почта и фоновый AI-разбор отключены (режим просмотра)');
      return;
    }

    // D-216: стенд (не-прод БД) не должен выкачивать БОЕВОЙ ящик. Даже если в
    // клоне есть активные email_accounts (они приходят с pg_dump прода), синк
    // опасен: выкачает реальную почту, разошлёт автоответы клиентам. Запускаем
    // только на прод-БД либо при явном ALLOW_IMAP_ON_STAND=1.
    const dbName = String(process.env.DB_NAME || 'asgard_crm');
    const isProdDb = dbName === 'asgard_crm';
    if (!isProdDb && process.env.ALLOW_IMAP_ON_STAND !== '1') {
      console.log(`[IMAP] D-216: стенд (DB=${dbName}) — синк почты выключен, чтобы не выкачать боевой ящик. ALLOW_IMAP_ON_STAND=1 для переопределения.`);
      return;
    }

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
 *
 * D-204: раньше сюда входило условие `ai_classification = '"other"'`, из-за чего
 * любое письмо, честно классифицированное как 'other', при каждом рестарте
 * сбрасывалось заново — бесконечная петля «reset → разбор → other → reset».
 * Теперь сбрасываем только реальные сбои (маркер ошибки/разбора) и не более
 * AI_MAX_ATTEMPTS раз. Явно помеченные 'Пропущено' (bounce/internal) не трогаем —
 * они не сбой, а осознанный skip.
 */
async function resetSkippedEmails() {
  // D-347 (23.10.2026): раньше сброс требовал `ai_attempts < AI_MAX_ATTEMPTS`,
  // то есть письма, исчерпавшие лимит, НЕ оживали никогда. Если лимит был
  // израсходован из-за инфраструктурного сбоя (закончились деньги на ИИ),
  // счета терялись безвозвратно — руками через SQL.
  //
  // Теперь оживляем три категории, кроме явно отданных людям:
  //   1) контентные сбои с остатком попыток;
  //   2) ЛЮБЫЕ инфраструктурные сбои (попытки не тратились, но пусть будет);
  //   3) исчерпавшие лимит, если у них НЕ выставлен ai_needs_manual.
  // Явно помеченные `ai_needs_manual = true` не трогаем — человек уже взял.
  const result = await db.query(`
    UPDATE emails SET ai_processed_at = NULL, ai_summary = NULL, ai_classification = NULL,
           ai_color = NULL, updated_at = NOW()
    WHERE direction = 'inbound'
      AND is_deleted = false
      AND ai_processed_at IS NOT NULL
      AND COALESCE(ai_needs_manual, false) = false
      AND (
        ai_summary LIKE '%Ошибка AI-анализа%'
        OR ai_summary LIKE '%Разбор не удался%'
        OR ai_summary LIKE '%провайдер ИИ%'
        OR ai_summary LIKE '%parse_error%'
        OR (ai_summary LIKE '%Ошибка%' AND ai_summary NOT LIKE '%Пропущено%')
      )
  `);
  console.log(`[IMAP-AI] Reset ${result.rowCount} errored emails for reprocessing`);
  return result.rowCount;
}

/**
 * D-347: разовое «оживление» писем, уже потерянных из-за инфраструктурных
 * сбоев (инцидент 23.10.2026 — кончились деньги на ИИ).
 *
 * Условия: письмо не обработано, стоит маркер ошибки, и это НЕ контентный сбой
 * (контентные честно отдали людям). `ai_attempts` обнуляем — иначе они снова
 * выпадут из выборки.
 *
 * @returns {Promise<number>} сколько писем вернули в очередь
 */
async function reviveInfraFailedEmails() {
  const result = await db.query(`
    UPDATE emails
       SET ai_attempts = 0,
           ai_infra_failures = 0,
           ai_last_error_class = 'infra',
           ai_summary = NULL,
           ai_color = NULL,
           ai_processed_at = NULL,
           updated_at = NOW()
     WHERE direction = 'inbound'
       AND is_deleted = false
       AND ai_processed_at IS NULL
       AND COALESCE(ai_needs_manual, false) = false
       AND (
         COALESCE(ai_last_error_class, '') = 'infra'
         OR ai_summary LIKE '%провайдер ИИ%'
         OR ai_summary LIKE '%provider_error%'
         OR ai_summary LIKE '%empty_response%'
         OR (ai_summary LIKE '%Разбор не удался%'
             AND ai_summary NOT LIKE '%json_parse_error%'
             AND ai_summary NOT LIKE '%missing_classification%')
       )
  `);
  if (result.rowCount) {
    console.log(`[IMAP-AI] Оживлено ${result.rowCount} писем после инфраструктурных сбоев (D-347)`);
  }
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
    // D-204: страховка на уровне сервиса. `index.js` вызывает startPersonalPolling()
    // напрямую (мимо init()), поэтому early-return в init() сам по себе не защищал
    // от выкачивания личной почты пользователей на стенде.
    if (process.env.IMAP_DISABLED === '1' || process.env.IMAP_DISABLED === 'true') {
      console.log('[IMAP-Personal] IMAP_DISABLED=1 — личный polling не запускается (режим просмотра)');
      return;
    }
    // D-216: на не-прод БД личную почту сотрудников тоже НЕ выкачиваем.
    if (String(process.env.DB_NAME || 'asgard_crm') !== 'asgard_crm' && process.env.ALLOW_IMAP_ON_STAND !== '1') {
      console.log('[IMAP-Personal] D-216: стенд — личный polling отключён (не выкачивать боевые ящики). ALLOW_IMAP_ON_STAND=1 для переопределения.');
      return;
    }
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
  runDocIntakeForEmail,
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
  reviveInfraFailedEmails,
  syncUserAccount,
  startPersonalPolling,
  stopPersonalPolling,
  // S-9: экспортирован для smoke-тестов addendum_response. Не для прод-вызова —
  // принимает email-объект (строку из таблицы emails), вызывает AI + post-AI flow.
  analyzeOneEmail
};
