'use strict';
/**
 * D-335: бэкфилл office_expenses для счётов spend_kind='office', у которых нет привязки.
 * Идемпотентно: пропускает уже связанные, проверяет дубль по doc_number+amount+date.
 * Запуск: node tools/backfill_office_expenses.js [--apply]
 */
const path = require('path');
process.chdir('/var/www/asgard-crm');
require('/var/www/asgard-crm/node_modules/dotenv').config({ path: '/var/www/asgard-crm/.env' });
const { Client } = require('/var/www/asgard-crm/node_modules/pg');

const APPLY = process.argv.includes('--apply');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });
  await c.connect();
  const db = { query: (s, p) => c.query(s, p) };

  const { rows: docs } = await db.query(`
    SELECT id, invoice_number, invoice_date, counterparty_name, counterparty_inn,
           amount_gross, vat_amount, spend_kind, comment_text, doc_owner_id, work_id
      FROM doc_registry
     WHERE deleted_at IS NULL AND dir='in'
       AND spend_kind='office'
       AND office_expense_id IS NULL
     ORDER BY id`);

  console.log(`офисных счетов без привязки: ${docs.length}  режим: ${APPLY ? 'ПРИМЕНЕНИЕ' : 'dry-run'}`);

  let created = 0, skippedDup = 0, skippedWork = 0, errs = 0, sum = 0;
  for (const d of docs) {
    if (d.work_id) { skippedWork++; continue; }

    const amt = Number(d.amount_gross) || 0;
    if (amt <= 0) { errs++; console.log(`  ! #${d.id} сумма 0 — пропуск`); continue; }

    // Дубль: тот же doc_number + сумма (+ дата, если есть)
    const { rows: dup } = await db.query(
      `SELECT id FROM office_expenses
        WHERE ABS(amount - $1) < 0.01
          AND COALESCE(doc_number,'') = COALESCE($2,'')
          AND ($3::date IS NULL OR date = $3::date)
        LIMIT 1`,
      [amt, d.invoice_number || '', d.invoice_date || null]
    );
    if (dup.length) { skippedDup++; continue; }

    if (!APPLY) { created++; sum += amt; continue; }

    try {
      const ins = await db.query(
        `INSERT INTO office_expenses
           (category, description, amount, total_amount, vat_amount, date, supplier, counterparty,
            status, source, created_by, created_at, doc_number, document_number, work_id)
         VALUES ('consumables', $1, $2, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, $5,
                 'approved', 'doc_hub_import', $6, NOW(), $7, $7, NULL)
         RETURNING id`,
        [
          d.comment_text || `Doc Hub #${d.id}`,
          amt, Number(d.vat_amount) || 0,
          d.invoice_date || null,
          d.counterparty_name || null,
          d.doc_owner_id || null,
          d.invoice_number || null
        ]
      );
      await db.query(`UPDATE doc_registry SET office_expense_id=$2, updated_at=NOW() WHERE id=$1`, [d.id, ins.rows[0].id]);
      created++; sum += amt;
    } catch (e) {
      errs++;
      console.log(`  ! #${d.id} ошибка: ${e.message}`);
    }
  }

  console.log(`\nсоздано: ${created} на ${sum.toLocaleString('ru-RU')} ₽`);
  console.log(`пропущено дублей: ${skippedDup}, с work_id: ${skippedWork}, ошибок: ${errs}`);

  const { rows: chk } = await db.query(`
    SELECT count(*)::int n, COALESCE(SUM(amount),0)::float8 s FROM office_expenses`);
  console.log(`\nИтого в office_expenses: ${chk[0].n} на ${chk[0].s.toLocaleString('ru-RU')} ₽`);
  const { rows: un } = await db.query(`
    SELECT count(*)::int n FROM doc_registry
     WHERE deleted_at IS NULL AND dir='in' AND spend_kind='office' AND office_expense_id IS NULL`);
  console.log(`осталось несвязанных офисных: ${un[0].n}`);
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
