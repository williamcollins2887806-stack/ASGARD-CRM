const path = '/var/www/asgard-crm';
process.chdir(path);
require(path + '/node_modules/dotenv').config({ path: path + '/.env' });
const { Client } = require(path + '/node_modules/pg');
const APPLY = process.argv.includes('--apply');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });
  await c.connect();
  const q = async (s, p) => (await c.query(s, p)).rows;
  const { matchWork } = require(path + '/src/services/contract-match');
  const { extractWorkHintFromSubject } = require(path + '/src/services/doc-email-intake');

  console.log('=== заявки без work_id, но с темой письма ===');
  const rows = await q(`
    SELECT p.id, p.supplier_name, p.amount, p.invoice_number, p.work_hint,
           e.subject,
           (SELECT work_hint FROM doc_email_intake WHERE payment_invoice_id = p.id LIMIT 1) intake_hint
      FROM payment_invoices p
      LEFT JOIN emails e ON e.id = p.source_email_id
     WHERE p.work_id IS NULL
       AND p.status IN ('awaiting_dir','pending_payment','draft')
     ORDER BY p.id`);

  for (const r of rows) {
    const hint = extractWorkHintFromSubject(r.subject || '');
    let m = { found: false };
    if (hint) m = await matchWork(c, hint).catch(() => ({ found: false }));
    const mark = m.found ? `→ #${m.work.id} «${String(m.work.work_title).slice(0, 40)}»` : '(не найдено)';
    console.log(` #${r.id} ${String(r.supplier_name).slice(0, 30)} №${r.invoice_number || '-'}`);
    console.log(`    тема: ${JSON.stringify(String(r.subject || '').slice(0, 62))}`);
    console.log(`    подсказка: ${JSON.stringify(hint)} ${mark}`);
    if (APPLY && m.found) {
      await c.query('UPDATE payment_invoices SET work_id = $2, work_hint = $3, updated_at = NOW() WHERE id = $1',
        [r.id, m.work.id, hint]);
      await c.query(`UPDATE doc_registry SET work_id = $2, updated_at = NOW()
        WHERE id = (SELECT doc_registry_id FROM payment_invoices WHERE id = $1)`, [r.id, m.work.id]).catch(() => {});
      console.log('    → ПРИВЯЗАНО');
    }
  }

  if (!APPLY) console.log('\n(dry-run) --apply для привязки');
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
