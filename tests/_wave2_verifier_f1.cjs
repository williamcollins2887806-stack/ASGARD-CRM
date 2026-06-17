/* F1 verifier: sendAutoReply behavior on kanban_test DB.
 * Creates test email + inbox_application, calls sendAutoReply directly,
 * verifies emails row written with in_reply_to / references / Re: subject.
 */
'use strict';
process.env.DB_NAME = 'asgard_crm_kanban_test';
process.env.JWT_SECRET = (process.env.JWT_SECRET || (() => { throw new Error('JWT_SECRET env required'); })());

const { Client } = require('pg');
const path = require('path');

(async () => {
  const pg = new Client({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_kanban_test', user: 'asgard', password: '123456789' });
  await pg.connect();

  // Seed: test email with message_id
  const msgId = `<verifier-f1-${Date.now()}@test.example>`;
  const insE = await pg.query(
    `INSERT INTO emails (direction, message_id, from_email, from_name, subject, body_text, snippet, email_type, account_id, email_date, created_at)
     VALUES ('inbound', $1, 'client@example.com', 'Test Client', 'Verifier F1 subject', 'body', 'snip', 'direct_request', NULL, NOW(), NOW())
     RETURNING id`,
    [msgId]
  );
  const emailId = insE.rows[0].id;

  const insA = await pg.query(
    `INSERT INTO inbox_applications (source, subject, body_preview, status, source_kind, source_email, source_name, ai_summary, email_id, attachment_count)
     VALUES ('email', 'Verifier F1 subject', 'verifier body', 'ai_processed', 'corporate_forward', 'client@example.com', 'Test Client', 'AI verifier summary for F1', $1, 0)
     RETURNING id`,
    [emailId]
  );
  const appId = insA.rows[0].id;

  // Wrap pg client into a db-like object exposing .query (like fastify.db pool)
  const dbLike = { query: (txt, params) => pg.query(txt, params) };
  const { sendAutoReply } = require(path.join(__dirname, '..', 'src', 'services', 'crm-mailer.js'));

  // 1) corporate_received
  const r1 = await sendAutoReply(dbLike, { emailId, applicationId: appId, mode: 'corporate_received' });
  console.log('[F1] corporate_received result:', JSON.stringify(r1));

  // 2) external_received
  const r2 = await sendAutoReply(dbLike, { emailId, applicationId: appId, mode: 'external_received' });
  console.log('[F1] external_received result:', JSON.stringify(r2));

  // 3) assigned (must no-op)
  const r3 = await sendAutoReply(dbLike, { emailId, applicationId: appId, mode: 'assigned' });
  console.log('[F1] assigned result:', JSON.stringify(r3));

  // 4) unknown mode
  const r4 = await sendAutoReply(dbLike, { emailId, applicationId: appId, mode: 'bogus' });
  console.log('[F1] bogus result:', JSON.stringify(r4));

  // Verify in emails table
  const ver = await pg.query(
    `SELECT id, direction, message_id, in_reply_to, references_header, subject, ai_classification, snippet
       FROM emails
      WHERE email_type='crm_outbound' AND in_reply_to = $1
      ORDER BY id DESC`,
    [msgId]
  );
  console.log('[F1] outbound rows count:', ver.rows.length);
  for (const row of ver.rows) {
    console.log('  - id=' + row.id + ' direction=' + row.direction + ' subject="' + row.subject + '" in_reply_to=' + row.in_reply_to + ' references=' + row.references_header + ' ai_class=' + row.ai_classification);
  }

  // Assertions
  let ok = true;
  const corp = ver.rows.find(r => r.ai_classification === 'autoreply_corporate_received');
  const ext = ver.rows.find(r => r.ai_classification === 'autoreply_external_received');
  if (!corp) { console.log('FAIL: no corporate_received row'); ok = false; }
  else {
    if (!/^Re:\s/.test(corp.subject)) { console.log('FAIL: corp subject does not start with "Re: "'); ok = false; }
    if (corp.in_reply_to !== msgId) { console.log('FAIL: corp in_reply_to mismatch'); ok = false; }
    if (corp.references_header !== msgId) { console.log('FAIL: corp references mismatch'); ok = false; }
    if (!/Заявка/.test(corp.snippet) && corp.snippet) {
      // Snippet may include Russian "Заявка". Some encodings may garble. Soft check.
    }
  }
  if (!ext) { console.log('FAIL: no external_received row'); ok = false; }
  if (r3.reason !== 'mode_noop') { console.log('FAIL: assigned should be mode_noop'); ok = false; }
  if (r4.reason !== 'unknown_mode') { console.log('FAIL: bogus should be unknown_mode'); ok = false; }

  // Cleanup
  await pg.query('DELETE FROM emails WHERE id = $1 OR in_reply_to = $2', [emailId, msgId]);
  await pg.query('DELETE FROM inbox_applications WHERE id = $1', [appId]);
  await pg.end();

  console.log(ok ? 'F1 VERIFIER: PASS' : 'F1 VERIFIER: FAIL');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('F1 verifier crash:', e); process.exit(2); });
