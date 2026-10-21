'use strict';

/**
 * D-319/D-320: чистка данных, созданных до фикса.
 * ═══════════════════════════════════════════════════════════════════════════
 * 1. Дубль «Безопасность Труда»: заявка #20 и строка реестра #1587 созданы из
 *    НАШЕГО информационного письма (Исх. 261021-03), где ИИ взял наш ИНН.
 *    Верно: заявка #18 и реестр #1585 (настоящий счёт УТ-2360).
 *    Удалять заявку нельзя — по ней ушло письмо директору (есть токен).
 *    Порядок безопасный (подтверждён верификатором): reject → soft-delete реестра.
 *
 * 2. «Распознаётся…» (#13) и заявки без ИНН (#9-#12, #17): дозаполнить
 *    через реальное распознавание их файлов.
 *
 * Запуск: node tools/fix_d319_data.js [--apply]
 */

const path = process.cwd();
require(path + '/node_modules/dotenv').config({ path: path + '/.env' });
const { Client } = require(path + '/node_modules/pg');

const APPLY = process.argv.includes('--apply');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });
  await c.connect();
  const q = async (s, p) => (await c.query(s, p)).rows;

  console.log('=== 1. ДУБЛЬ «Безопасность Труда» ===');
  const dupes = await q(`SELECT p.id pay, p.status, p.amount, p.invoice_number, p.doc_registry_id, p.dir_approved_at,
        (SELECT count(*) FROM payment_mail_tokens t WHERE t.payment_id=p.id) tokens
      FROM payment_invoices p
      WHERE p.supplier_name ILIKE '%Безопасность Труда%' AND p.invoice_number='УТ-2360'
      ORDER BY p.id`);
  for (const r of dupes) {
    console.log(`  заявка #${r.pay} ${r.status} №${r.invoice_number} ${r.amount} ₽ doc=${r.doc_registry_id} токенов=${r.tokens} одобр=${r.dir_approved_at || '-'}`);
  }
  // Дубль = более поздняя заявка с НАШИМ ИНН в строке реестра.
  const ownInn = String((await q(`SELECT (value_json::jsonb)->>'inn' inn FROM settings WHERE key='company_profile'`))[0].inn || '');
  const bad = await q(`SELECT p.id pay, p.doc_registry_id doc
      FROM payment_invoices p JOIN doc_registry d ON d.id = p.doc_registry_id
      WHERE p.supplier_name ILIKE '%Безопасность Труда%' AND p.invoice_number='УТ-2360'
        AND d.deleted_at IS NULL AND d.counterparty_inn = $1
      ORDER BY p.id DESC LIMIT 1`, [ownInn]);
  if (!bad.length) { console.log('  дублей с нашим ИНН нет — править нечего'); }
  else {
    const { pay: dupPay, doc: dupDoc } = bad[0];
    console.log(`\n  ДУБЛЬ: заявка #${dupPay}, строка реестра #${dupDoc} (ИНН = наш ${ownInn})`);
    if (APPLY) {
      // Шаг 1: reject заявки (не DELETE — сохраняем историю и токен).
      await c.query(`UPDATE payment_invoices
          SET status='rejected', dir_comment=COALESCE(dir_comment,'') ||
              ' [D-319 авто: дубль счёта УТ-2360 из нашего исходящего письма, см. верную заявку]',
              updated_at=NOW()
        WHERE id=$1 AND status='awaiting_dir'`, [dupPay]);
      // Шаг 2: погасить токен согласования, чтобы старая ссылка не согласовала дубль.
      await c.query(`UPDATE payment_mail_tokens SET used_at=NOW(), used_action='reject'
        WHERE payment_id=$1 AND used_at IS NULL`, [dupPay]);
      // Шаг 3: soft-delete строки реестра (восстановимо из корзины).
      await c.query(`UPDATE doc_registry SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1`, [dupDoc]);
      // Шаг 4: снять расписание эскалации, если было.
      await c.query(`DELETE FROM approval_escalation WHERE payment_invoice_id=$1`, [dupPay]).catch(() => {});
      console.log(`  СДЕЛАНО: #${dupPay} → rejected, реестр #${dupDoc} → в корзину, токен погашен`);
    } else {
      console.log('  (dry-run) запустите с --apply');
    }
  }

  console.log('\n=== 2. ЗАЯВКИ БЕЗ РАСПОЗНАВАНИЯ (заглушка/нет ИНН) ===');
  const need = await q(`SELECT id, supplier_name, amount, file_path, file_name, supplier_id
      FROM payment_invoices
      WHERE status='awaiting_dir'
        AND (supplier_name ILIKE '%Распознаётся%' OR supplier_name IS NULL
             OR NOT (amount > 0) OR supplier_id IS NULL)
      ORDER BY id`);
  for (const r of need) {
    console.log(`  #${r.id} «${r.supplier_name}» ${r.amount} ₽ ИНН=${r.supplier_id ? 'есть' : 'НЕТ'} файл=${(r.file_name || '-').slice(0, 50)}`);
  }
  console.log(`  всего к дозаполнению: ${need.length}`);
  if (!APPLY) console.log('  (dry-run) распознавание выполнит крон/ручной запуск');

  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
