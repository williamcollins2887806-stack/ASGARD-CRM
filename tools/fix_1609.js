'use strict';
/**
 * D-356: новое письмо Ozon (#1609, 1 184 ₽) снова дало «НДС = вся сумма».
 * Плюс att#1186 в чек-листе считается «потерянным», хотя разрезан на 3 PDF.
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

  // ── 1. НДС в #1609 и заявке #42 ────────────────────────────────────────
  console.log('=== 1. #1609 / заявка #42: НДС = всей сумме ===');
  const d = (await q(`SELECT id, invoice_number, amount_gross, amount_net, vat_amount, vat_rate, has_vat
      FROM doc_registry WHERE id=1609`))[0];
  console.log(`  doc #${d.id} ${d.invoice_number}: сумма=${d.amount_gross} net=${d.amount_net} vat=${d.vat_amount} has_vat=${d.has_vat}`);
  console.log('  → счёт Ozon без НДС: net = сумме, vat = 0, has_vat = false');

  const pi = (await q(`SELECT id, status, amount, vat_amount, amount_net FROM payment_invoices WHERE id=42`))[0];
  console.log(`  заявка #${pi.id} [${pi.status}] сумма=${pi.amount} vat=${pi.vat_amount} net=${pi.amount_net}`);
  console.log(`  → станет vat=0, net=${pi.amount}`);

  if (APPLY) {
    await q(`UPDATE doc_registry SET
          vat_amount=0, amount_net=amount_gross, vat_rate=0, has_vat=false, updated_at=NOW()
        WHERE id=1609`);
    await q(`UPDATE payment_invoices SET
          vat_amount=0, amount_net=amount, updated_at=NOW()
        WHERE id=42`);
    console.log('  ✓ исправлено');
  }

  // ── 2. att#1186: записать в intake как «разрезан» ──────────────────────
  console.log('\n=== 2. att#1186: отметить, что файл разрезан на 3 счёта ===');
  const exists = await q(`SELECT id FROM doc_email_intake WHERE attachment_id=1186`);
  console.log(`  запись в intake: ${exists.length ? 'есть' : 'НЕТ (поэтому чек-лист считает потерянным)'}`);
  if (APPLY && !exists.length) {
    // Допустимые статусы (CHECK chk_intake_status): parsed, needs_manual, linked,
    // rejected, failed. «Разрезан и привязан к строкам» = linked.
    await q(`INSERT INTO doc_email_intake(email_id, attachment_id, status, error)
          VALUES (5011, 1186, 'linked', 'splitted_into:УТ-2372,УТ-2373,УТ-2374')
          ON CONFLICT (email_id, attachment_id) WHERE email_id IS NOT NULL AND attachment_id IS NOT NULL
          DO UPDATE SET status='linked'`);
    console.log('  ✓ отмечено linked (3 счёта внутри, разрезан)');
  }

  // ── 3. Проверка ────────────────────────────────────────────────────────
  console.log('\n=== 3. СВЕРКА ===');
  for (const r of await q(`SELECT id, invoice_number, amount_gross, vat_amount, has_vat FROM doc_registry WHERE id=1609`))
    console.log(`  doc #${r.id}: сумма=${r.amount_gross} vat=${r.vat_amount} has_vat=${r.has_vat}`);
  for (const r of await q(`SELECT id, amount, vat_amount, amount_net FROM payment_invoices WHERE id=42`))
    console.log(`  заявка #${r.id}: сумма=${r.amount} vat=${r.vat_amount} net=${r.amount_net}`);
  console.log(`  документов с vat==gross: ${(await q(`SELECT count(*)::int n FROM doc_registry
      WHERE deleted_at IS NULL AND has_vat=true AND amount_gross>0 AND abs(vat_amount-amount_gross)<0.01`))[0].n}`);
  console.log(`  заявок с vat==amount: ${(await q(`SELECT count(*)::int n FROM payment_invoices
      WHERE vat_amount>0 AND abs(vat_amount-amount)<0.01`))[0].n}`);

  console.log(`\n${APPLY ? 'ГОТОВО' : 'это dry-run, для применения: --apply'}`);
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
