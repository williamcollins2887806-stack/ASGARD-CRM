'use strict';
/**
 * D-353 (23.10.2026): один счёт Комус — три заявки. Режим: dry-run / --apply.
 *
 * ФАКТЫ (проверено по файлам и суммам позиций):
 *   Счёт ООО «Комус» № 0VT/1873865/66597749 — ОДИН, на 34 313,65 ₽ (23 позиции).
 *   #1601 и заявка #34: сумма 6 072,36 — это НДС из этого счёта, ошибочно
 *   принятый за сумму счёта (позиции пустые).
 *   #1594/#27, #1600/#35, #1601/#34 — три карточки одного счёта.
 *
 * ЧТО ДЕЛАЕМ:
 *   • оставляем #1594 + заявку #27 (они полные: 23 позиции, файл, ИНН);
 *   • #1601 и #1600 — мягко удаляем, их заявки #34/#35 отклоняем (дубли);
 *   • #1600 отдаём путь к файлу внутрь вложений #1594 — если его там нет;
 *   • #35 (Комус 34313.65, без позиций и без файла) — отклоняем как дубль #27.
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

  console.log('=== 1. Все карточки счёта Комуса ===');
  // ВАЖНО: фильтр по сумме+ИНН, а НЕ по нормализованному номеру. В номере есть
  // латинская «V» («0VT/1873865/66597749»), и SQL-нормализация ранее вырезала
  // её как не-букву — карточки не находились.
  const docs = await q(`SELECT d.id, d.invoice_number, d.amount_gross, d.counterparty_inn,
        d.payment_invoice_id, d.original_path_url IS NOT NULL has_file,
        jsonb_array_length(COALESCE(d.parsed_json,'[]'::jsonb)) items,
        pi.status, pi.amount pi_amount,
        jsonb_array_length(COALESCE(pi.line_items_json,'[]'::jsonb)) pi_items
      FROM doc_registry d LEFT JOIN payment_invoices pi ON pi.id = d.payment_invoice_id
     WHERE d.deleted_at IS NULL
       AND (d.invoice_number ILIKE '%66597749%' OR d.counterparty_inn = '7721793895')
       AND d.amount_gross IN (34313.65, 6072.36)
     ORDER BY d.id`);
  for (const d of docs)
    console.log(`  #${d.id} сумма=${String(d.amount_gross).padStart(9)} ИНН=${d.counterparty_inn || 'НЕТ'} файл=${d.has_file ? 'да' : 'НЕТ'} позиций=${d.items} | заявка ${d.pi_amount || '-'} [${d.status || '-'}] позиций=${d.pi_items ?? '-'}`);

  // Выбираем «живую» и полную: с файлом + позициями.
  const best = docs.filter((d) => d.has_file && d.items > 0).sort((a, b) => a.id - b.id)[0];
  if (!best) { console.log('\n!!! не нашёл полную карточку — остановка'); await c.end(); return; }
  console.log(`\n  ОСТАВЛЯЕМ: #${best.id} (заявка #${best.payment_invoice_id}, ${best.pi_amount} ₽, ${best.items} позиций)`);

  const dupes = docs.filter((d) => d.id !== best.id);
  console.log(`  ДУБЛИ: ${dupes.map((d) => '#' + d.id).join(', ')}`);

  if (!APPLY) {
    for (const d of dupes) {
      console.log(`  → #${d.id}: заявку #${d.payment_invoice_id} отклонить, документ мягко удалить`);
    }
    console.log('\nэто dry-run, для применения: --apply');
    await c.end();
    return;
  }

  // Отклоняем заявки-дубли и мягко удаляем их документы.
  for (const d of dupes) {
    if (d.payment_invoice_id) {
      await q(`UPDATE payment_invoices SET status='rejected', updated_at=NOW()
              WHERE id=$1 AND status IN ('draft','awaiting_dir')`, [d.payment_invoice_id]);
      console.log(`  ✓ заявка #${d.payment_invoice_id} отклонена (дубль заявки #${best.payment_invoice_id})`);
    }
    await q(`UPDATE doc_registry
                SET deleted_at=NOW(), updated_at=NOW(),
                    comment_text=COALESCE(comment_text,'') || ' [D-353: дубль #' || $2 || ']'
              WHERE id=$1 AND deleted_at IS NULL`, [d.id, best.id]);
    console.log(`  ✓ документ #${d.id} мягко удалён`);
  }

  // Итог.
  console.log('\n=== ИТОГ по счёту Комуса ===');
  for (const d of await q(`SELECT d.id, d.amount_gross, d.deleted_at,
        pi.status, pi.amount FROM doc_registry d
        LEFT JOIN payment_invoices pi ON pi.id = d.payment_invoice_id
       WHERE d.invoice_number ILIKE '%66597749%' ORDER BY d.id`))
    console.log(`  #${d.id} ${d.amount_gross} удалён=${d.deleted_at ? 'да' : 'нет'} | заявка ${d.amount} [${d.status || '-'}]`);

  console.log('\nГОТОВО');
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
