'use strict';
/**
 * D-345: пересобрать заявку #27 «Комус» из НАСТОЯЩЕГО PDF (вложение 1179),
 * а не из цитаты ответа. ИИ-разбор даёт 23 позиции и верные реквизиты.
 * Режим: dry-run / --apply.
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

  const att = (await q(`SELECT id, filename, file_path FROM email_attachments WHERE id=1179`))[0];
  const full = ROOT + '/' + String(att.file_path).replace(/^\/?uploads\//, 'uploads/');
  console.log(`источник: вложение #${att.id} «${att.filename}»`);
  console.log(`файл на диске: ${fs.existsSync(full) ? 'ДА' : 'НЕТ'}`);

  const ocr = require(ROOT + '/src/services/pdf-ocr');
  const text = (await ocr.ocrPdfPath(full, att.filename)).text;
  console.log(`текст: ${text.length} символов`);

  const aiEx = require(ROOT + '/src/services/invoice-ai-extract');
  const ai = await aiEx.extractByAI(text, {});
  if (!ai.ok) { console.log('ИИ не сработал:', ai.error); await c.end(); return; }
  const d = ai.data;
  console.log(`\nраспознано: сумма=${d.amount_gross} net=${d.amount_net} vat=${d.vat_amount} has_vat=${d.has_vat}`);
  console.log(`номер=${d.invoice_number} ИНН=${d.supplier_inn} имя=${d.supplier_name}`);
  console.log(`позиций=${(d.lines || []).length}`);
  const linesSum = (d.lines || []).reduce((s, l) => s + (Number(l.sum) || 0), 0);
  console.log(`сумма позиций=${linesSum} (документ ${d.amount_gross}) расхождение=${Math.abs(linesSum - Number(d.amount_gross)).toFixed(2)}`);

  const pi = (await q(`SELECT id, amount, supplier_name, file_path, source_email_id, created_by, doc_registry_id
      FROM payment_invoices WHERE id=27`))[0];
  console.log(`\nзаявка #27 сейчас: сумма=${pi.amount} файл=${pi.file_path ? 'есть' : 'НЕТ'} создана=${pi.created_by}`);

  const doc = (await q(`SELECT id, counterparty_inn, supplier_id, contract_id, work_id, original_path_url
      FROM doc_registry WHERE id=1594`))[0];
  console.log(`документ #1594: ИНН=${doc.counterparty_inn} supplier=${doc.supplier_id} contract=${doc.contract_id} work=${doc.work_id}`);

  if (!APPLY) { console.log('\nэто dry-run, для применения: --apply'); await c.end(); return; }

  // 1. Позиции + суммы + реквизиты в заявку.
  await q(`UPDATE payment_invoices SET
        line_items_json=$1::jsonb,
        amount=$2, vat_amount=$3, amount_net=$4,
        supplier_name=COALESCE($5, supplier_name),
        updated_at=NOW()
      WHERE id=27`,
    [JSON.stringify(d.lines || []), d.amount_gross, d.vat_amount, d.amount_net, d.supplier_name]);
  console.log('  ✓ заявка #27: позиции, суммы, имя поставщика');

  // 2. Документ реестра: ИНН, позиции, суммы, файл.
  await q(`UPDATE doc_registry SET
        counterparty_inn=COALESCE(counterparty_inn,$1),
        parsed_json=$2::jsonb,
        amount_gross=$3, amount_net=$4, vat_amount=$5, vat_rate=COALESCE($6, vat_rate),
        has_vat=$7,
        original_path_url=COALESCE(original_path_url,$8),
        updated_at=NOW()
      WHERE id=1594`,
    [d.supplier_inn, JSON.stringify(d.lines || []), d.amount_gross, d.amount_net, d.vat_amount,
      d.vat_rate, d.has_vat !== false, att.file_path]);
  console.log('  ✓ документ #1594: ИНН, позиции, суммы, файл');

  // 3. Поставщик: привязка по ИНН.
  const sup = (await q(`SELECT id FROM suppliers WHERE regexp_replace(coalesce(inn,''),'\\D','','g')=$1 LIMIT 1`,
    [String(d.supplier_inn || '').replace(/\D/g, '')]))[0];
  if (sup) {
    await q(`UPDATE doc_registry SET supplier_id=$1, updated_at=NOW() WHERE id=1594`, [sup.id]);
    await q(`UPDATE payment_invoices SET supplier_id=$1, updated_at=NOW() WHERE id=27`, [sup.id]);
    console.log(`  ✓ поставщик #${sup.id} привязан`);
  }

  // 4. Ответственный: счёт прислал офис АГПЗ (письмо 4992 → agpz@ = 4698).
  const owner = (await q(`SELECT id, name, role FROM users WHERE lower(email)='agpz@asgard-service.com'`))[0];
  if (owner) {
    await q(`UPDATE doc_registry SET doc_owner_id=$1, updated_at=NOW() WHERE id=1594`, [owner.id]);
    console.log(`  ✓ ответственный: #${owner.id} ${owner.name} [${owner.role}]`);
  }

  console.log('\nГОТОВО');
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
