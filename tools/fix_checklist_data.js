'use strict';
/**
 * Дочистка по чек-листу pipeline_check.js (22.10.2026).
 *  1. #19 «Ситилинк»: позиция «× 2 = 139980» при сумме счёта 114 737,70 — позиции
 *     задвоены (ноутбук 1 шт). Правим количество/сумму по сумме документа.
 *  2. #1594 «Комус»: ставка 21.5% выведена из копеек → ставим ближайшую 22%.
 *  3. #429 «РВБ» (в оплате #29) без файла — ищем скан в письмах, иначе помечаем.
 *  4. #544 / #559: один счёт дважды. Оставляем #544 (живой расход 6023), #559
 *     мягко удаляем (расход 6038 уже rejected).
 *  5. #11 «ТСИ»: нет ответственного — ставим создателя (3474).
 */
const ROOT = '/var/www/asgard-crm';
process.chdir(ROOT);
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { Client } = require(ROOT + '/node_modules/pg');
const fs = require('fs');

const APPLY = process.argv.includes('--apply');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });
  await c.connect();
  const q = (s, p) => c.query(s, p).then((r) => r.rows);
  console.log(`РЕЖИМ: ${APPLY ? 'ПРИМЕНЕНИЕ' : 'dry-run'}\n`);

  // ── 1. #19 позиции задвоены ────────────────────────────────────────────
  console.log('=== 1. ЗАЯВКА #19 «Ситилинк»: позиции больше суммы ===');
  const p19 = (await q(`SELECT id, amount, line_items_json, doc_registry_id FROM payment_invoices WHERE id=19`))[0];
  let lines = Array.isArray(p19.line_items_json) ? p19.line_items_json : [];
  const sum19 = lines.reduce((s, l) => s + (Number(l.sum) || 0), 0);
  console.log(`  сумма счёта=${p19.amount}, сумма позиций=${sum19}, позиций=${lines.length}`);
  if (lines.length === 1 && sum19 > Number(p19.amount) + 0.01) {
    // НЕ ПРАВИМ АВТОМАТИЧЕСКИ: кол-во и цена не сходятся между собой
    // (2 × 25 242,30 = 50 484,60, а сумма позиции 139 980), значит ИИ
    // перепутал поля. Придумывать количество за человека нельзя — это деньги.
    // Помечаем строку на вычитку, чтобы инициатор сверил с бумажным счётом.
    console.log(`  позиция противоречива (${sum19} ≠ ${p19.amount}) — помечаю на ручной сверки`);
    if (APPLY) {
      await q(`UPDATE payment_invoices
                 SET needs_review=true, updated_at=NOW()
               WHERE id=19 AND EXISTS (
                 SELECT 1 FROM information_schema.columns
                  WHERE table_name='payment_invoices' AND column_name='needs_review')`)
        .catch(() => { /* колонки нет — пропускаем */ });
      if (p19.doc_registry_id) {
        await q(`UPDATE doc_registry
                   SET is_incomplete=true,
                       incomplete_reasons=(SELECT array_agg(DISTINCT x) FROM unnest(
                         COALESCE(incomplete_reasons,'{}'::text[]) || ARRAY['items_sum_mismatch']) AS x),
                       comment_text=COALESCE(NULLIF(comment_text,''),
                         'Сумма позиций не сходится с суммой счёта — сверить с оригиналом'),
                       updated_at=NOW()
                 WHERE id=$1`, [p19.doc_registry_id]);
      }
      console.log('  ✓ помечено items_sum_mismatch');
    }
  }

  // ── 2. #1594 ставка НДС ────────────────────────────────────────────────
  console.log('\n=== 2. #1594 «Комус»: ставка 21.5% ===');
  const d = (await q(`SELECT id, amount_gross, amount_net, vat_amount, vat_rate FROM doc_registry WHERE id=1594`))[0];
  const calc = 100 * Number(d.vat_amount) / Number(d.amount_net);
  console.log(`  gross=${d.amount_gross} net=${d.amount_net} vat=${d.vat_amount} ставка=${d.vat_rate} расчётная=${calc.toFixed(2)}%`);
  // Ближайшая допустимая ставка.
  const OK = [0, 5, 7, 10, 20, 22];
  const near = OK.reduce((best, r) => Math.abs(r - calc) < Math.abs(best - calc) ? r : best, 22);
  console.log(`  → ставим ${near}% (фактический НДС 6072.36 не меняем, это сумма из счёта)`);
  if (APPLY) {
    await q(`UPDATE doc_registry SET vat_rate=$1, updated_at=NOW() WHERE id=1594`, [near / 100]);
    await q(`UPDATE payment_invoices SET vat_rate=$1, updated_at=NOW() WHERE id=27`, [near]);
    console.log('  ✓ исправлено');
  }

  // ── 3. #429 без файла ──────────────────────────────────────────────────
  console.log('\n=== 3. #429 «РВБ» в оплате (#29) без файла ===');
  const d429 = (await q(`SELECT id, invoice_number, counterparty_name, payment_invoice_id FROM doc_registry WHERE id=429`))[0];
  const att = (await q(`SELECT a.id, a.filename, a.file_path FROM email_attachments a
      WHERE a.filename ILIKE '%881040%' OR a.filename ILIKE '%РВБ%' LIMIT 3`));
  console.log(`  документ #429 счёт ${d429.invoice_number}, вложений найдено: ${att.length}`);
  for (const a of att) console.log(`   att#${a.id} ${a.filename}`);
  if (att.length && APPLY) {
    await q(`UPDATE doc_registry SET original_path_url=$1, updated_at=NOW() WHERE id=429`, [att[0].file_path]);
    await q(`UPDATE payment_invoices SET file_path=$1, file_name=$2, updated_at=NOW() WHERE id=29`,
      ['/' + String(att[0].file_path).replace(/^\/?uploads\//, 'uploads/'), att[0].filename]);
    console.log('  ✓ файл привязан');
  } else if (!att.length) {
    console.log('  → вложения нет: счёт пришёл по ЭДО без файла, помечаю на ручную загрузку');
    if (APPLY) {
      await q(`UPDATE doc_registry
                 SET is_incomplete=true,
                     incomplete_reasons=(SELECT array_agg(DISTINCT x) FROM unnest(
                       COALESCE(incomplete_reasons,'{}'::text[]) || ARRAY['no_scan']) AS x),
                     updated_at=NOW() WHERE id=429`);
      console.log('  ✓ помечено no_scan');
    }
  }

  // ── 4. Дубль #544 / #559 ───────────────────────────────────────────────
  console.log('\n=== 4. ДУБЛЬ #544 / #559 (счёт №573, 72 000 ₽) ===');
  const pair = await q(`SELECT id, counterparty_name, work_expense_id, deleted_at
      FROM doc_registry WHERE id IN (544,559) ORDER BY id`);
  for (const x of pair) console.log(`  #${x.id} ${x.counterparty_name} расход=${x.work_expense_id} deleted=${x.deleted_at ? 'да' : 'нет'}`);
  console.log('  → оставляю #544 (живой расход 6023), #559 мягко удаляю (расход 6038 уже rejected)');
  if (APPLY) {
    await q(`UPDATE work_expenses SET status='rejected', updated_at=NOW()
              WHERE id IN (SELECT work_expense_id FROM doc_registry WHERE id=559 AND work_expense_id IS NOT NULL)
                AND COALESCE(status,'') <> 'rejected'`);
    await q(`UPDATE doc_registry
                SET deleted_at=NOW(), updated_at=NOW(),
                    comment_text=COALESCE(comment_text,'') || ' [дубль #544, счёт №573]'
              WHERE id=559 AND deleted_at IS NULL`);
    console.log('  ✓ #559 удалён, расход снят');
  }

  // ── 5. #11 ответственный ───────────────────────────────────────────────
  console.log('\n=== 5. #11 «ТСИ»: нет ответственного ===');
  const p11 = (await q(`SELECT id, created_by, doc_registry_id FROM payment_invoices WHERE id=11`))[0];
  const u = (await q(`SELECT id, name, role FROM users WHERE id=$1`, [p11.created_by]))[0];
  console.log(`  заявка #11 создана: ${u ? `#${u.id} ${u.name} [${u.role}]` : p11.created_by}, документ=${p11.doc_registry_id || 'НЕТ'}`);
  if (APPLY && u) {
    if (p11.doc_registry_id) {
      await q(`UPDATE doc_registry SET doc_owner_id=$1, updated_at=NOW()
               WHERE id=$2 AND doc_owner_id IS NULL`, [u.id, p11.doc_registry_id]);
    }
    console.log(`  ✓ ответственный #${u.id} ${u.name}`);
  }

  console.log(`\n${APPLY ? 'ГОТОВО' : 'это dry-run, для применения: --apply'}`);
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
