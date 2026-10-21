'use strict';

/**
 * D-324: дозаполнить карточки контрагентов реквизитами из УЖЕ ЗАГРУЖЕННЫХ счетов.
 * ═══════════════════════════════════════════════════════════════════════════
 * Заказчик 21.10.2026: «Нужно сделать так, чтобы в карточку контрагента
 * подгружались сразу реквизиты из счетов».
 *
 * Проблема: 452 из 459 карточек поставщиков без БИК/р-с. Это исторические
 * записи, созданные только по имени. Файлы счетов при этом В БАЗЕ ЕСТЬ
 * (`doc_registry.original_path_url`, `payment_invoices.file_path`) — значит
 * реквизиты можно вытащить повторным проходом, не дожидаясь новых писем.
 *
 * Логика:
 *   1. берём контрагентов без полных реквизитов (нет БИК или р/с);
 *   2. ищем самый свежий счёт этого контрагента с файлом;
 *   3. OCR → extractInvoice → ensureSupplier (дозаполняет только пустое);
 *   4. если контрагент без ИНН — ИНН тоже проставится (это важно: без ИНН
 *      следующие счета не сопоставятся).
 *
 * Запуск: node tools/backfill_supplier_requisites.js [--apply] [--limit N]
 */

const path = process.cwd();
require(path + '/node_modules/dotenv').config({ path: path + '/.env' });
const { Client } = require(path + '/node_modules/pg');

const APPLY = process.argv.includes('--apply');
const li = process.argv.indexOf('--limit');
const LIMIT = li > 0 ? (parseInt(process.argv[li + 1], 10) || 0) : 0;

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });
  await c.connect();
  const q = async (s, p) => (await c.query(s, p)).rows;

  const nodePath = require('node:path');
  const fs = require('fs');
  const ocr = require(path + '/src/services/pdf-ocr');
  const { extractInvoice } = require(path + '/src/services/invoice-extract');
  const { ensureSupplier } = require(path + '/src/services/supplier-resolve');
  const dc = require(path + '/src/services/doc-classifier');
  const ownInn = await dc.ownInn(c).catch(() => '');
  const baseUploads = nodePath.resolve(process.cwd(), 'uploads');

  // Контрагенты без реквизитов. Для каждого — самый свежий документ с файлом.
  const rows = await q(`
    SELECT s.id, s.name, s.inn,
           (SELECT d.original_path_url FROM doc_registry d
             WHERE d.deleted_at IS NULL AND d.supplier_id = s.id
               AND COALESCE(d.original_path_url,'') <> ''
             ORDER BY d.invoice_date DESC NULLS LAST, d.id DESC LIMIT 1) AS doc_file,
           (SELECT d.id FROM doc_registry d
             WHERE d.deleted_at IS NULL AND d.supplier_id = s.id
               AND COALESCE(d.original_path_url,'') <> ''
             ORDER BY d.invoice_date DESC NULLS LAST, d.id DESC LIMIT 1) AS doc_id,
           (SELECT p.file_path FROM payment_invoices p
             WHERE p.supplier_id = s.id AND COALESCE(p.file_path,'') <> ''
             ORDER BY p.id DESC LIMIT 1) AS pay_file
      FROM suppliers s
     WHERE s.deleted_at IS NULL
       AND (s.bik IS NULL OR s.rs IS NULL OR s.inn IS NULL)
       AND (EXISTS (SELECT 1 FROM doc_registry d WHERE d.deleted_at IS NULL AND d.supplier_id = s.id AND COALESCE(d.original_path_url,'') <> '')
         OR EXISTS (SELECT 1 FROM payment_invoices p WHERE p.supplier_id = s.id AND COALESCE(p.file_path,'') <> ''))
     ORDER BY s.id
     ${LIMIT ? 'LIMIT ' + LIMIT : ''}`);

  console.log(`контрагентов без реквизитов, но со счётом: ${rows.length}`);
  if (!APPLY) {
    for (const r of rows.slice(0, 12)) {
      console.log(`  #${r.id} «${String(r.name).slice(0, 42)}» ИНН=${r.inn || '-'} файл=${String(r.doc_file || r.pay_file || '').slice(-40)}`);
    }
    console.log('\n(dry-run) запустите с --apply');
    await c.end();
    return;
  }

  let filled = 0, skipped = 0;
  for (const r of rows) {
    const rawFile = String(r.doc_file || r.pay_file || '');
    if (!rawFile) { skipped++; continue; }
    const rel = rawFile.replace(/^\/?uploads\//i, '').replace(/^[\\/]+/, '');
    const candidates = [
      rawFile,
      nodePath.join(process.cwd(), rawFile.replace(/^\/+/, '')),
      nodePath.join(baseUploads, rel),
      nodePath.join(process.cwd(), 'public', rawFile.replace(/^\/+/, ''))
    ];
    const full = candidates.find((p) => { try { return fs.existsSync(p); } catch (_) { return false; } });
    if (!full) { skipped++; continue; }

    try {
      let text = '';
      if (/\.pdf$/i.test(full)) text = ((await ocr.ocrPdfPath(full, logName(rawFile))) || {}).text || '';
      else if (/\.(png|jpe?g|webp)$/i.test(full)) text = ((await ocr.ocrImageBuffer(fs.readFileSync(full), 'image/jpeg', logName(rawFile))) || {}).text || '';
      if (!String(text).trim()) { skipped++; continue; }

      const parsed = extractInvoice(text, { ownInn });
      if (!parsed.bik && !parsed.rs) {
        console.log(`  #${r.id} «${String(r.name).slice(0, 34)}»: в счёте реквизитов не нашлось — пропуск`);
        skipped++; continue;
      }
      // Сохраняем связь с существующей карточкой: подставляем её имя, чтобы
      // ensureSupplier не создал новую запись с другим написанием.
      parsed.counterparty_name = parsed.counterparty_name || r.name;
      const res = await ensureSupplier(c, parsed, { ownInn });
      if (res.id) {
        filled++;
        console.log(`  #${res.id} «${String(r.name).slice(0, 34)}»: ${res.created ? 'ЗАВЕДЁН' : 'дозаполнен'} — БИК ${parsed.bik || '-'} р/с ${parsed.rs ? 'есть' : '-'} ИНН ${parsed.inn || '-'}`);
      } else {
        console.log(`  #${r.id} «${String(r.name).slice(0, 34)}»: не удалось (${res.reason})`);
        skipped++;
      }
    } catch (e) {
      console.log(`  #${r.id} ошибка: ${e.message}`);
      skipped++;
    }
  }
  console.log(`\nдозаполнено: ${filled}, пропущено: ${skipped}`);

  const left = await q(`SELECT count(*)::int n FROM suppliers WHERE deleted_at IS NULL AND (bik IS NULL OR rs IS NULL)`);
  console.log(`осталось без реквизитов: ${left[0].n}`);
  await c.end();

  function logName(p) { return String(p).split(/[\\/]/).pop(); }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
