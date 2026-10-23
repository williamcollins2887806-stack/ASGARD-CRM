'use strict';
/**
 * D-357: исправить kind у уже привязанных файлов.
 * Наши Исх. письма были помечены 'scan' (будто это скан счёта), а это
 * обоснование. Правило: файл с «счёт/invoice/createPayment» в имени = scan,
 * остальное = justification.
 * Режим: dry-run / --apply.
 */
const ROOT = '/var/www/asgard-crm';
process.chdir(ROOT);
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { Client } = require(ROOT + '/node_modules/pg');

const APPLY = process.argv.includes('--apply');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });
  await c.connect();
  const q = (s, p) => c.query(s, p).then((r) => r.rows);
  console.log(`РЕЖИМ: ${APPLY ? 'ПРИМЕНЕНИЕ' : 'dry-run'}\n`);

  const docs = await q(`SELECT id, invoice_number, attachments
      FROM doc_registry WHERE deleted_at IS NULL
        AND jsonb_array_length(COALESCE(attachments,'[]'::jsonb)) > 0
      ORDER BY id`);

  let changed = 0;
  for (const d of docs) {
    const next = (d.attachments || []).map((a) => {
      const nm = String(a.name || '').toLowerCase();
      // D-357: «Исх. №… — счёт № УТ-2372.pdf» содержит слово «счёт», но это
      // НАШЕ сопроводительное письмо, а не скан счёта поставщика. Приоритет:
      // если в имени есть «исх.» — это всегда обоснование.
      const isOutgoing = /(^|\s)исх\.?\s*№|исходящ/.test(nm);
      const looksInvoice = !isOutgoing && /(сч[её]т|invoice|createpayment)/.test(nm);
      const want = looksInvoice ? 'scan' : 'justification';
      if (a.kind !== want) return { ...a, kind: want, _fix: true };
      return a;
    });
    const fixed = next.filter((a) => a._fix);
    if (!fixed.length) continue;
    changed += fixed.length;
    console.log(`  #${d.id} ${d.invoice_number || '-'}:`);
    for (const a of fixed) console.log(`     ${a.name} → ${a.kind}`);
    if (APPLY) {
      const clean = next.map(({ _fix, ...rest }) => rest);
      await q(`UPDATE doc_registry SET attachments=$1::jsonb, updated_at=NOW() WHERE id=$2`,
        [JSON.stringify(clean), d.id]);
    }
  }

  console.log(`\n  файлов к правке: ${changed}`);
  if (APPLY) {
    console.log('\n=== после ===');
    for (const d of await q(`SELECT id, invoice_number, attachments FROM doc_registry
        WHERE id BETWEEN 1603 AND 1607 ORDER BY id`)) {
      console.log(`  #${d.id} ${d.invoice_number}:`);
      for (const a of (d.attachments || [])) console.log(`     [${a.kind}] ${a.name}`);
    }
  }
  console.log(`\n${APPLY ? 'ГОТОВО' : 'это dry-run, для применения: --apply'}`);
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
