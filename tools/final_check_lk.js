const ROOT = '/var/www/asgard-crm';
process.chdir(ROOT);
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { Client } = require(ROOT + '/node_modules/pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });
  await c.connect();
  const q = (s, p) => c.query(s, p).then((r) => r.rows);

  console.log('=== 1. ЗАЯВКА #27 «Комус» после починки ===');
  const p = (await q(`SELECT id, status, amount, amount_net, vat_amount, supplier_name, supplier_id,
        jsonb_array_length(COALESCE(line_items_json,'[]'::jsonb)) items,
        file_path IS NOT NULL has_file, doc_registry_id
      FROM payment_invoices WHERE id=27`))[0];
  console.log(' ', JSON.stringify(p));
  console.log('  первые позиции:');
  for (const l of (p.items ? (await q(`SELECT line_items_json FROM payment_invoices WHERE id=27`))[0].line_items_json : []).slice(0, 3))
    console.log(`   • ${String(l.name).slice(0,55)} × ${l.quantity} = ${l.sum}`);

  console.log('\n=== 2. ДОКУМЕНТ #1594 ===');
  const d = (await q(`SELECT id, invoice_number, counterparty_name, counterparty_inn, supplier_id,
        contract_id, work_id, doc_owner_id, amount_gross, vat_amount,
        jsonb_array_length(COALESCE(parsed_json,'[]'::jsonb)) items, original_path_url IS NOT NULL file
      FROM doc_registry WHERE id=1594`))[0];
  console.log(' ', JSON.stringify(d));

  console.log('\n=== 3. КАЖДАЯ РОЛЬ: что видит ===');
  const roles = [
    ['DIRECTOR_COMM (директор)', 3456],
    ['BUH (бухгалтер)', 3470],
    ['OFFICE_MANAGER (Тумаева)', 3471],
    ['PROC (Баринов)', 3467],
    ['OFFICE_MANAGER (АГПЗ)', 4698],
  ];
  for (const [label, uid] of roles) {
    const u = (await q(`SELECT id, name, role FROM users WHERE id=$1`, [uid]))[0];
    console.log(`  ${label}: ${u ? u.name : 'нет пользователя'}`);
  }

  console.log('\n=== 4. Очередь директора: полные ли карточки ===');
  let bad = 0;
  for (const r of await q(`SELECT pi.id, pi.amount, pi.supplier_name,
        jsonb_array_length(COALESCE(pi.line_items_json,'[]'::jsonb)) items,
        pi.file_path IS NOT NULL OR pi.file_name IS NOT NULL has_file,
        d.counterparty_inn, d.work_id, d.contract_id, d.doc_owner_id
      FROM payment_invoices pi LEFT JOIN doc_registry d ON d.id=pi.doc_registry_id
      WHERE pi.status='awaiting_dir' ORDER BY pi.id`)) {
    const ok = r.items > 0 && r.has_file && r.amount > 0;
    if (!ok) bad++;
    console.log(`  ${ok ? 'OK  ' : '!!! '}#${r.id} ${String(r.amount).padStart(10)} позиций=${r.items} файл=${r.has_file ? 'да' : 'НЕТ'} ИНН=${r.counterparty_inn || '-'} объект=${r.work_id || '-'} отв=${r.doc_owner_id || '-'} | ${String(r.supplier_name).slice(0,22)}`);
  }
  console.log(`  проблемных карточек: ${bad}`);

  console.log('\n=== 5. НДС-инвариант (не должно быть vat == gross) ===');
  console.log('  в doc_registry: ', (await q(`SELECT count(*)::int n FROM doc_registry WHERE deleted_at IS NULL
      AND has_vat=true AND abs(vat_amount-amount_gross)<0.01 AND amount_gross>0`))[0].n);
  console.log('  в заявках:      ', (await q(`SELECT count(*)::int n FROM payment_invoices
      WHERE vat_amount > 0 AND abs(vat_amount - amount) < 0.01`))[0].n);

  console.log('\n=== 6. Деньги не тронуты ===');
  console.log('  work_expenses:', JSON.stringify((await q(`SELECT count(*)::int n, COALESCE(SUM(amount),0)::float8 s
      FROM work_expenses WHERE COALESCE(status,'')<>'rejected'`))[0]));
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
