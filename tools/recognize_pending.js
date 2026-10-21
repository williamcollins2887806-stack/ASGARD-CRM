'use strict';

/**
 * D-320: дозаполнить заявки, созданные ДО фонового распознавания.
 * ═══════════════════════════════════════════════════════════════════════════
 * Жалоба заказчика 21.10.2026: «что за "Распознаётся…"? Если счёт не успел
 * распознаться до отправки — распознавать в фоне и добирать данные, а не
 * показывать сырым».
 *
 * Заявки #9-#13 были загружены через «Внести документ» вручную (created_by
 * 3474) и ушли директору с заглушкой/без ИНН. Этот скрипт прогоняет по ним
 * тот же конвейер (OCR → разбор → дозаполнение), что и фоновая очередь.
 *
 * Запуск: node tools/recognize_pending.js [--apply]
 */

const path = process.cwd();
require(path + '/node_modules/dotenv').config({ path: path + '/.env' });
const { Client } = require(path + '/node_modules/pg');

const APPLY = process.argv.includes('--apply');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });
  await c.connect();
  const q = async (s, p) => (await c.query(s, p)).rows;

  const rows = await q(`SELECT id, supplier_name, amount, file_path, file_name, supplier_id, status
      FROM payment_invoices
      WHERE status IN ('awaiting_dir','draft')
        AND (supplier_name ILIKE '%Распознаётся%' OR supplier_name IS NULL
             OR NOT (amount > 0) OR supplier_id IS NULL)
      ORDER BY id`);
  console.log(`к дозаполнению: ${rows.length}`);
  for (const r of rows) console.log(`  #${r.id} «${r.supplier_name}» ${r.amount} ₽ — ${(r.file_name || '-').slice(0, 55)}`);

  if (!APPLY) { console.log('\n(dry-run) запустите с --apply'); await c.end(); return; }

  // Тот же конвейер, что в фоновой очереди: берём функцию из роутера через
  // прямой импорт модулей (роутер регистрируется на fastify, поэтому повторяем
  // шаги здесь явно — без поднятия сервера).
  const nodePath = require('node:path');
  const fs = require('fs');
  const dc = require(path + '/src/services/doc-classifier');
  const { extractInvoice } = require(path + '/src/services/invoice-extract');
  const { matchWork, matchContract } = require(path + '/src/services/contract-match');
  const ownInnStr = await dc.ownInn(c).catch(() => '');
  const baseUploads = nodePath.resolve(process.env.UPLOAD_DIR || process.env.UPLOADS_DIR || nodePath.join(process.cwd(), 'uploads'));

  let done = 0, skipped = 0;
  for (const r of rows) {
    if (!r.file_path) { console.log(`  #${r.id}: нет файла — пропуск`); skipped++; continue; }
    try {
      // D-320: путь в БД может быть АБСОЛЮТНЫМ (/uploads/…), относительным
      // (uploads/…) или вообще без префикса. Раньше абсолютный путь со слэшем
      // превращался в «/uploads/...» на диске и файл «не находился».
      const rawPath = String(r.file_path || '');
      const rel = rawPath.replace(/^\/?uploads\//i, '').replace(/^[\\/]+/, '');
      const candidates = [
        rawPath,                                              // как есть (если реально абсолютный)
        nodePath.join(process.cwd(), rawPath.replace(/^\/+/, '')),  // /uploads/x → <cwd>/uploads/x
        nodePath.join(baseUploads, rel),                      // <uploads>/x
        nodePath.join(process.cwd(), 'public', rawPath.replace(/^\/+/, ''))
      ];
      const full = candidates.find((p) => { try { return fs.existsSync(p); } catch (_) { return false; } });
      if (!full) { console.log(`  #${r.id}: файл не найден (пробовал ${candidates.length} путей) — пропуск`); skipped++; continue; }

      let text = '';
      const ocr = require(path + '/src/services/pdf-ocr');
      const nm = String(r.file_name || '');
      if (/pdf/i.test(nm)) {
        text = ((await ocr.ocrPdfPath(full, nm)) || {}).text || '';
      } else if (/\.(png|jpe?g|webp)$/i.test(nm)) {
        text = ((await ocr.ocrImageBuffer(fs.readFileSync(full), 'image/jpeg', nm)) || {}).text || '';
      }
      if (!String(text).trim()) { console.log(`  #${r.id}: пустой текст — пропуск`); skipped++; continue; }

      const cls = dc.classifyDocument(text, { ownInn: ownInnStr });
      if (cls.kind === 'letter') {
        console.log(`  #${r.id}: это НАШЕ исходящее письмо, не счёт → пропуск (D-319)`);
        skipped++; continue;
      }

      let parsed = extractInvoice(text, { ownInn: ownInnStr });
      try {
        const aiEx = require(path + '/src/services/invoice-ai-extract');
        const ai = await aiEx.extractByAI(text, { db: c });
        if (ai && ai.ok && ai.data) parsed = aiEx.mergeWithRegex(ai.data, parsed).parsed;
      } catch (_) { /* регулярки уже сработали */ }

      const patch = []; const vals = [];
      const setIf = (col, val, cast) => { if (val == null || val === '') return; vals.push(val); patch.push(`${col}=$${vals.length}${cast || ''}`); };
      const isStub = !r.supplier_name || r.supplier_name === 'Распознаётся…';
      if (isStub && parsed.counterparty_name) setIf('supplier_name', parsed.counterparty_name);
      if (!(Number(r.amount) > 0) && parsed.amount_gross != null) setIf('amount', parsed.amount_gross, '::numeric');
      if (parsed.invoice_number) setIf('invoice_number', parsed.invoice_number);
      if (parsed.invoice_date) setIf('invoice_date', parsed.invoice_date, '::date');
      if (parsed.payment_due_at) setIf('due_date', parsed.payment_due_at, '::date');
      if (parsed.vat_amount != null) setIf('vat_amount', parsed.vat_amount, '::numeric');
      if (parsed.vat_rate != null) setIf('vat_rate', parsed.vat_rate, '::numeric');
      if (parsed.contract_basis && parsed.contract_basis.number) setIf('contract_basis_number', parsed.contract_basis.number);
      if (parsed.work_hint && !r.work_id) setIf('work_hint', parsed.work_hint);

      if (parsed.inn && String(parsed.inn) !== ownInnStr) {
        const s = await q(`SELECT id FROM suppliers WHERE inn=$1 AND deleted_at IS NULL LIMIT 1`, [parsed.inn]);
        if (s[0]) setIf('supplier_id', s[0].id, '::int');
      }
      if (parsed.work_hint) {
        const wm = await matchWork(parsed.work_hint).catch(() => ({ found: false }));
        if (wm.found && wm.work) setIf('work_id', wm.work.id, '::int');
      }
      if (parsed.contract_basis && parsed.contract_basis.number) {
        const cm = await matchContract(c, {
          number: parsed.contract_basis.number, counterpartyInn: parsed.inn,
          counterpartyName: parsed.counterparty_name || r.supplier_name
        }).catch(() => ({ found: false }));
        if (cm.found && cm.contract) setIf('contract_id', cm.contract.id, '::int');
      }

      if (patch.length) {
        vals.push(r.id);
        await c.query(`UPDATE payment_invoices SET ${patch.join(', ')}, updated_at=NOW() WHERE id=$${vals.length}`, vals);
        console.log(`  #${r.id}: дозаполнено полей ${patch.length} → «${parsed.counterparty_name || '?'}» ${parsed.amount_gross || 0} ₽ №${parsed.invoice_number || '-'}`);
        done++;
      } else {
        console.log(`  #${r.id}: нечего дозаполнить`);
        skipped++;
      }
    } catch (e) {
      console.log(`  #${r.id}: ОШИБКА ${e.message}`);
      skipped++;
    }
  }
  console.log(`\nдозаполнено: ${done}, пропущено: ${skipped}`);
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
