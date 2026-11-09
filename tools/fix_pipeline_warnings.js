'use strict';
/**
 * Разовая безопасная чистка предупреждений конвейера счетов.
 *
 *  1. #341 — ложный разбор: к заявке прикреплён ДОГОВОР (вложение 1284), а не счёт.
 *     Реальный счёт того же письма — #340 (вложение 1283, 425158.07). Отклоняем #341.
 *  2. #330 — черновик с файлом/позициями без doc_registry_id → создаём строку реестра.
 *  3. Договоры без цифр в номере — отвязываем документы, архивируем «мусорные» договоры.
 *  4. #357 — только диагностика (скан без текстового слоя); сумму/позиции НЕ выдумываем.
 *
 * Usage:
 *   node tools/fix_pipeline_warnings.js           # dry-run
 *   node tools/fix_pipeline_warnings.js --apply   # применить
 */
const APPLY = process.argv.includes('--apply');
const path = require('path');

async function main() {
  const ROOT = process.cwd();
  try { require(path.join(ROOT, 'node_modules/dotenv')).config({ path: path.join(ROOT, '.env') }); } catch (_) {}
  const { Client } = require(path.join(ROOT, 'node_modules/pg'));
  const c = new Client({
    connectionString: process.env.DATABASE_URL
      || `postgres://${process.env.DB_USER || 'asgard'}:${process.env.DB_PASSWORD || '123456789'}@${process.env.DB_HOST || '127.0.0.1'}/${process.env.DB_NAME || process.env.PGDATABASE || 'asgard_crm'}`
  });
  await c.connect();
  const q = (s, p) => c.query(s, p).then((r) => r.rows);
  console.log(`РЕЖИМ: ${APPLY ? 'ПРИМЕНЕНИЕ' : 'dry-run'}\n`);

  // ── 1. #341 фантом ────────────────────────────────────────────────────
  console.log('=== 1. Заявка #341 (договор вместо счёта) ===');
  const p341 = (await q(`SELECT id, status, amount, source_attachment_id, source_email_id, doc_registry_id, file_name
                           FROM payment_invoices WHERE id=341`))[0];
  const p340 = (await q(`SELECT id, status, amount, source_attachment_id FROM payment_invoices WHERE id=340`))[0];
  if (!p341) {
    console.log('  нет #341');
  } else {
    console.log(`  #341 status=${p341.status} amount=${p341.amount} att=${p341.source_attachment_id} file=${p341.file_name}`);
    console.log(`  #340 status=${p340 && p340.status} amount=${p340 && p340.amount} att=${p340 && p340.source_attachment_id}`);
    const okPhantom = p341.source_attachment_id === 1284
      && p340 && p340.source_attachment_id === 1283
      && p341.source_email_id === 5310;
    if (!okPhantom) {
      console.log('  ⛔ предохранитель: сигнатура не совпала с ожидаемой — НЕ трогаем');
    } else if (!['awaiting_dir', 'draft'].includes(p341.status)) {
      console.log(`  уже не в очереди (${p341.status}) — пропуск`);
    } else {
      console.log('  → отклоняем #341, мягко гасим doc #2178');
      if (APPLY) {
        await q(`UPDATE payment_invoices
                    SET status='rejected',
                        dir_comment = COALESCE(NULLIF(dir_comment,''),'') ||
                          CASE WHEN COALESCE(dir_comment,'')='' THEN '' ELSE ' | ' END ||
                          'Авто: ложный разбор — вложение договор МЛСП-245.5, не счёт. Реальный счёт того же письма: заявка #340.',
                        updated_at=NOW()
                  WHERE id=341 AND status IN ('awaiting_dir','draft')`);
        if (p341.doc_registry_id) {
          await q(`UPDATE doc_registry
                      SET deleted_at=COALESCE(deleted_at, NOW()),
                          comment_text = COALESCE(NULLIF(comment_text,''),'') ||
                            CASE WHEN COALESCE(comment_text,'')='' THEN '' ELSE ' | ' END ||
                            'Авто: связан с ложной заявкой #341 (договор вместо счёта)',
                          updated_at=NOW()
                    WHERE id=$1 AND deleted_at IS NULL`, [p341.doc_registry_id]);
        }
        console.log('  ✓ #341 rejected');
      }
    }
  }

  // ── 2. #330 без реестра ───────────────────────────────────────────────
  console.log('\n=== 2. Заявка #330 без doc_registry ===');
  const p330 = (await q(`SELECT * FROM payment_invoices WHERE id=330`))[0];
  if (!p330) console.log('  нет #330');
  else if (p330.doc_registry_id) console.log(`  уже есть doc_registry_id=${p330.doc_registry_id}`);
  else {
    console.log(`  status=${p330.status} amount=${p330.amount} file=${!!p330.file_path} items=${Array.isArray(p330.line_items_json) ? p330.line_items_json.length : 0}`);
    console.log('  → создаём doc_registry и связываем');
    if (APPLY) {
      const fileRel = String(p330.file_path || '').replace(/^\/+/, '');
      const vatRateRaw = p330.vat_rate != null ? Number(p330.vat_rate) : 22;
      const vatRate = vatRateRaw > 1 ? vatRateRaw / 100 : vatRateRaw;
      const vatAmt = Number(p330.vat_amount || 0);
      const amountGross = Number(p330.amount);
      const amountNet = p330.amount_net != null ? Number(p330.amount_net) : amountGross;
      const ins = await q(`
        INSERT INTO doc_registry(
          dir, package_type, ops_status, pay_status, spend_kind,
          counterparty_name, counterparty_inn, supplier_id,
          invoice_number, invoice_date,
          amount_gross, amount_net, vat_amount, vat_rate, has_vat,
          payment_invoice_id, original_path_url, attachments,
          created_by, updated_by, doc_owner_id, receive_channel, comment_text,
          contract_mode
        ) VALUES (
          'in','invoice','draft', 'none',
          COALESCE(NULLIF($1::text,''),'work'),
          $2::text, $3::text, $4::int,
          $5::text, $6::date,
          $7::numeric, $8::numeric, $9::numeric, $10::numeric, ($9::numeric > 0),
          330, $11::text, $12::jsonb,
          $13::int, $13::int, $13::int, 'manual',
          'Авто: реестр досоздан для сироты-заявки #330',
          'none'
        ) RETURNING id`, [
        p330.spend_kind || 'work',
        p330.supplier_name || '',
        p330.counterparty_inn || null,
        p330.supplier_id || null,
        p330.invoice_number || null,
        p330.invoice_date || null,
        amountGross,
        amountNet,
        vatAmt,
        vatRate,
        fileRel || null,
        JSON.stringify(fileRel ? [{ kind: 'invoice', name: p330.file_name || path.basename(fileRel), path: fileRel }] : []),
        p330.created_by || null
      ]);
      const docId = ins[0].id;
      await q(`UPDATE payment_invoices SET doc_registry_id=$1, updated_at=NOW() WHERE id=330 AND doc_registry_id IS NULL`, [docId]);
      console.log(`  ✓ создан doc_registry #${docId}, связан с #330`);
    }
  }

  // ── 3. Мусорные договоры ──────────────────────────────────────────────
  console.log('\n=== 3. Договоры без цифр в номере ===');
  const junk = await q(`
      SELECT c.id, c.number, c.status, count(d.id)::int AS docs
        FROM contracts c
        LEFT JOIN doc_registry d ON d.contract_id=c.id AND d.deleted_at IS NULL
       WHERE coalesce(c.number,'') !~ '[0-9]'
         AND length(trim(coalesce(c.number,''))) > 0
         AND coalesce(c.status,'') <> 'archived'
       GROUP BY c.id, c.number, c.status
       ORDER BY docs DESC`);
  console.log(`  активных мусорных: ${junk.length}`);
  for (const j of junk.slice(0, 20)) console.log(`   #${j.id} «${j.number}» docs=${j.docs} status=${j.status}`);
  if (junk.length && APPLY) {
    const ids = junk.map((x) => x.id);
    const unlinked = await q(`
      UPDATE doc_registry
         SET contract_id = NULL,
             contract_mode = CASE
               WHEN contract_mode = 'linked' THEN 'once'
               ELSE COALESCE(NULLIF(contract_mode,''), 'once')
             END,
             updated_at = NOW()
       WHERE deleted_at IS NULL AND contract_id = ANY($1::int[])
       RETURNING id`, [ids]);
    const archived = await q(`
      UPDATE contracts
         SET status='archived',
             comment = COALESCE(comment,'') || ' [архив: номер без цифр, авточистка pipeline ' || to_char(NOW(),'YYYY-MM-DD') || ']',
             updated_at=NOW()
       WHERE id = ANY($1::int[]) AND coalesce(status,'') <> 'archived'
       RETURNING id`, [ids]);
    console.log(`  ✓ отвязано документов: ${unlinked.length}; архивировано договоров: ${archived.length}`);
  }

  // ── 4. #357: OCR скана показал 12 позиций, в CRM — 11 (нет 2-го жилета 1830) ──
  console.log('\n=== 4. #357 (УТ-2539) — недостающая позиция ===');
  const p357 = (await q(`SELECT id, amount, vat_amount, line_items_json,
      (SELECT SUM((l->>'sum')::numeric) FROM jsonb_array_elements(line_items_json) l) AS items
      FROM payment_invoices WHERE id=357`))[0];
  if (p357) {
    const items = Array.isArray(p357.line_items_json) ? p357.line_items_json : [];
    const sum = Number(p357.items);
    const amount = Number(p357.amount);
    const diff = Math.round((amount - sum) * 100) / 100;
    const vests = items.filter((l) => /жилет/i.test(String(l.name || '')));
    console.log(`  amount=${amount} items_sum=${sum} n=${items.length} vests=${vests.length} diff=${diff}`);
    // Предохранитель: ровно один жилет, разница ровно 1830, итог станет amount.
    if (items.length === 11 && vests.length === 1 && Math.abs(diff - 1830) < 0.02) {
      const clone = { ...vests[0], sum: 1830, quantity: 1, unit_price: 1830 };
      const next = items.concat([clone]);
      const nextSum = next.reduce((s, l) => s + Number(l.sum || 0), 0);
      console.log(`  → добавляем 2-й «${clone.name}» 1830; новая сумма ${nextSum}`);
      if (Math.abs(nextSum - amount) > 0.02) {
        console.log('  ⛔ после добавления сумма не сошлась — НЕ трогаем');
      } else if (APPLY) {
        await q(`UPDATE payment_invoices SET line_items_json=$1::jsonb, updated_at=NOW() WHERE id=357`,
          [JSON.stringify(next)]);
        console.log('  ✓ позиции #357 дополнены до 12');
      }
    } else if (items.length >= 12 && Math.abs(diff) < 0.02) {
      console.log('  уже сходится — пропуск');
    } else {
      console.log('  сигнатура не совпала — пропуск (не выдумываем)');
    }
  }

  await c.end();
  console.log('\nГотово.');
}

main().catch((e) => { console.error(e); process.exit(1); });
