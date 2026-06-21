/**
 * ASGARD CRM — Email Folder Sorter (AI-powered)
 * Автоматическая сортировка писем-копий на CRM-ящике по IMAP-папкам
 * Использует AI для классификации + IMAP MOVE для перемещения
 */

'use strict';

const { ImapFlow } = require('imapflow');
const db = require('./db');
const imapService = require('./imap');
const aiProvider = require('./ai-provider');

// CRM folder structure
const CRM_FOLDERS = {
  'tkp': 'CRM/ТКП',
  'tender': 'CRM/Тендеры',
  'invoice': 'CRM/Счета',
  'act': 'CRM/Акты',
  'contract': 'CRM/Договоры',
  'correspondence': 'CRM/Переписка',
  'other': 'CRM/Прочее'
};

// Rule-based pre-classification (fast, before AI)
function preClassify(email) {
  const subject = (email.subject || '').toLowerCase();
  const body = (email.body_text || '').toLowerCase();
  const combined = subject + ' ' + body;

  if (/коммерческ|ткп|commercial\s*proposal|кп\b/i.test(combined)) return 'tkp';
  if (/тендер|закупк|аукцион|конкурс|котировк/i.test(combined)) return 'tender';
  if (/счёт|счет|invoice|оплат.*счёт/i.test(combined)) return 'invoice';
  if (/(?:^|\s|[^а-яёА-ЯЁ])акт(?:\s|[^а-яёА-ЯЁ]).*(?:выполнен|приёмк|сверк)/i.test(combined)) return 'act';
  if (/договор|контракт|соглашен|contract/i.test(combined)) return 'contract';

  return null; // needs AI classification
}

/**
 * Classify email using AI
 */
async function classifyWithAI(email) {
  const prompt = `Классифицируй деловое письмо в одну из категорий:
- tkp (коммерческое предложение / ТКП)
- tender (тендеры, закупки, аукционы)
- invoice (счета, оплата)
- act (акты выполненных работ, акты сверки)
- contract (договоры, контракты, соглашения)
- correspondence (деловая переписка)
- other (прочее)

Тема: ${(email.subject || '').slice(0, 200)}
От: ${email.from_email || ''}
Текст (начало): ${(email.body_text || '').slice(0, 500)}

Ответь ТОЛЬКО одним словом — названием категории (tkp, tender, invoice, act, contract, correspondence, other).`;

  try {
    const response = await aiProvider.ask(prompt, { maxTokens: 10, temperature: 0.1 });
    const category = (response || '').trim().toLowerCase().replace(/[^a-z]/g, '');

    if (CRM_FOLDERS[category]) return category;
    return 'other';
  } catch (e) {
    console.error('[FolderSorter] AI classification error:', e.message);
    return 'other';
  }
}

/**
 * Create IMAP folder if not exists
 */
async function ensureFolder(client, folderPath) {
  try {
    const list = await client.list();
    const exists = list.some(f => f.path === folderPath || f.name === folderPath);
    if (!exists) {
      await client.mailboxCreate(folderPath);
      console.log(`[FolderSorter] Created IMAP folder: ${folderPath}`);
    }
  } catch (e) {
    // Folder might already exist
    if (!e.message.includes('ALREADYEXISTS')) {
      console.error(`[FolderSorter] Error creating folder ${folderPath}:`, e.message);
    }
  }
}

/**
 * Move email to target folder via IMAP
 */
async function moveToFolder(client, uid, targetFolder) {
  try {
    await ensureFolder(client, targetFolder);
    const lock = await client.getMailboxLock('INBOX');
    try {
      await client.messageMove(uid, targetFolder, { uid: true });
      console.log(`[FolderSorter] Moved UID ${uid} to ${targetFolder}`);
      return true;
    } finally {
      lock.release();
    }
  } catch (e) {
    console.error(`[FolderSorter] Move error UID ${uid}:`, e.message);
    return false;
  }
}

/**
 * Process new CRM-copy emails: classify and sort
 * Called after IMAP sync of the CRM account
 */
async function processNewCrmEmails() {
  try {
    // Get CRM account
    const accRes = await db.query(
      "SELECT * FROM email_accounts WHERE (is_copy_target = true OR account_type = 'primary') AND is_active = true LIMIT 1"
    );
    if (accRes.rows.length === 0) return { processed: 0 };
    const crmAccount = accRes.rows[0];

    // Find unprocessed BCC copies
    const unprocessed = await db.query(`
      SELECT id, subject, from_email, from_name, body_text, imap_uid, account_id
      FROM emails
      WHERE account_id = $1 AND is_crm_copy = true AND imap_folder = 'INBOX'
      AND created_at > NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC
      LIMIT 50
    `, [crmAccount.id]);

    if (unprocessed.rows.length === 0) return { processed: 0 };

    // Connect to CRM mailbox via IMAP
    const client = new ImapFlow({
      host: crmAccount.imap_host,
      port: crmAccount.imap_port || 993,
      secure: crmAccount.imap_tls !== false,
      auth: {
        user: crmAccount.imap_user,
        pass: imapService.decrypt(crmAccount.imap_pass_encrypted)
      },
      logger: false,
      greetingTimeout: 15000,
      socketTimeout: 60000
    });

    await client.connect();
    let processed = 0;

    try {
      // Ensure base CRM folder structure exists
      for (const folder of Object.values(CRM_FOLDERS)) {
        await ensureFolder(client, folder);
      }

      // Process each email
      for (const email of unprocessed.rows) {
        // Try rule-based first
        let category = preClassify(email);

        // Fall back to AI
        if (!category) {
          category = await classifyWithAI(email);
        }

        const targetFolder = CRM_FOLDERS[category] || CRM_FOLDERS.other;

        // Also try to create sender subfolder
        if (email.from_email) {
          // Find sender name in users
          const senderRes = await db.query(
            'SELECT name FROM users WHERE id = (SELECT user_id FROM user_email_accounts WHERE email_address = $1 LIMIT 1)',
            [email.from_email]
          );
          if (senderRes.rows.length > 0) {
            const senderFolder = `CRM/Сотрудники/${senderRes.rows[0].name.replace(/[/\\]/g, '_')}`;
            await ensureFolder(client, senderFolder);
          }
        }

        // Move email
        if (email.imap_uid) {
          const moved = await moveToFolder(client, email.imap_uid, targetFolder);
          if (moved) {
            await db.query(
              "UPDATE emails SET imap_folder = $1, email_type = $2, updated_at = NOW() WHERE id = $3",
              [targetFolder, category === 'other' ? 'unknown' : category, email.id]
            );
            processed++;
          }
        } else {
          // No IMAP UID — just update classification in DB
          await db.query(
            "UPDATE emails SET email_type = $1, updated_at = NOW() WHERE id = $2",
            [category === 'other' ? 'unknown' : category, email.id]
          );
          processed++;
        }
      }
    } finally {
      await client.logout();
    }

    console.log(`[FolderSorter] Processed ${processed} CRM emails`);
    return { processed };
  } catch (error) {
    console.error('[FolderSorter] Error:', error.message);
    return { processed: 0, error: error.message };
  }
}

/**
 * Initialize: create CRM folder structure on first run.
 * IMAP connect иногда flaky (throttle Yandex при гонке с imapService.startPolling
 * на ту же учётку) → retry с backoff. AggregateError разворачиваем для диагностики.
 */
function _formatInitErr(e) {
  if (!e) return 'unknown';
  const parts = [];
  if (e.message) parts.push(e.message);
  if (e.code) parts.push(`code=${e.code}`);
  if (Array.isArray(e.errors) && e.errors.length) {
    parts.push('aggregated: ' + e.errors.map(x => x?.message || x?.code || String(x)).join('; '));
  }
  return parts.length ? parts.join(' | ') : (e.name || 'no message');
}

async function _initCrmFoldersOnce() {
  const accRes = await db.query(
    "SELECT * FROM email_accounts WHERE (is_copy_target = true OR account_type = 'primary') AND is_active = true LIMIT 1"
  );
  if (accRes.rows.length === 0) return 'no_account';
  const crmAccount = accRes.rows[0];

  const client = new ImapFlow({
    host: crmAccount.imap_host,
    port: crmAccount.imap_port || 993,
    secure: crmAccount.imap_tls !== false,
    auth: {
      user: crmAccount.imap_user,
      pass: imapService.decrypt(crmAccount.imap_pass_encrypted)
    },
    logger: false,
    greetingTimeout: 15000,
    socketTimeout: 60000
  });

  await client.connect();
  try {
    for (const folder of Object.values(CRM_FOLDERS)) {
      await ensureFolder(client, folder);
    }
    return 'ok';
  } finally {
    await client.logout().catch(() => {});
  }
}

async function initCrmFolders() {
  const RETRY_DELAYS_MS = [5000, 15000, 45000];
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const result = await _initCrmFoldersOnce();
      if (result === 'no_account') return;
      const suffix = attempt > 0 ? ` (after ${attempt} retr${attempt === 1 ? 'y' : 'ies'})` : '';
      console.log('[FolderSorter] CRM folder structure initialized' + suffix);
      return;
    } catch (e) {
      const detail = _formatInitErr(e);
      if (attempt >= RETRY_DELAYS_MS.length) {
        console.error(`[FolderSorter] Init failed after ${attempt + 1} attempts:`, detail);
        return;
      }
      const delay = RETRY_DELAYS_MS[attempt];
      console.warn(`[FolderSorter] Init attempt ${attempt + 1} failed (${detail}) — retry in ${delay / 1000}s`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

module.exports = {
  processNewCrmEmails,
  classifyWithAI,
  preClassify,
  initCrmFolders,
  CRM_FOLDERS
};
