'use strict';
/**
 * Восстановление черновика #14 после моих проб.
 *
 * ЧТО СЛОМАНО (проверено на проде):
 *   #14: файл «471 от 10.07.26 ВЕДО.pdf» → в нём ООО «ВЕДО Рус», счёт № 471,
 *        сумма 5 654,00. А в карточке стоит supplier_name «РАДИО-ДУПЛЕКС»,
 *        invoice_number «1460», amount_net 446 721,32 и vat 98 278,68 —
 *        это поля ДРУГОГО счёта (#16). Появились после моих PATCH-проб
 *        23.10.2026 19:45 (audit_log id 636134).
 *
 * КАК ЛЕЧИМ: пересчитываем поля из САМОГО файла (он — источник истины) и
 * записываем в карточку. Сумму из документа тоже берём из парсера.
 *
 * По умолчанию dry-run. С `--apply` записывает.
 */
const path = require('node:path');
const fs = require('node:fs');
const pg = require('/var/www/asgard-crm/node_modules/pg');
require('/var/www/asgard-crm/node_modules/dotenv').config({ path: '/var/www/asgard-crm/.env' });

const APPLY = process.argv.includes('--apply');
const ID = 14;

(async () => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });
  await c.connect();

  const pay = (await c.query('SELECT * FROM payment_invoices WHERE id=$1', [ID])).rows[0];
  if (!pay) throw new Error('счёт #' + ID + ' не найден');

  console.log('=== ДО ===');
  console.log('  ' + JSON.stringify({
    supplier: pay.supplier_name, inn: pay.counterparty_inn, number: pay.invoice_number,
    date: pay.invoice_date, amount: pay.amount, net: pay.amount_net,
    vat: pay.vat_amount, rate: pay.vat_rate, file: pay.file_name
  }));

  // Файл ищем теми же путями, что recognizeAndFill.
  const base = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'));
  const rel = String(pay.file_path || '').replace(/^\/?uploads\//i, '').replace(/^[\\/]+/, '');
  const full = [path.join(base, rel), path.join(process.cwd(), String(pay.file_path || '').replace(/^\/+/, ''))]
    .find((p) => { try { return fs.existsSync(p); } catch (_) { return false; } });
  if (!full) throw new Error('файл не найден: ' + pay.file_path);

  const ocr = require('/var/www/asgard-crm/src/services/pdf-ocr');
  const res = await ocr.ocrPdfPath(full, pay.file_name);
  const text = String((res && res.text) || '');
  if (!text.trim()) throw new Error('пустой текст файла');

  const dc = require('/var/www/asgard-crm/src/services/doc-classifier');
  const ownInn = await dc.ownInn(c).catch(() => '');
  const { extractInvoice } = require('/var/www/asgard-crm/src/services/invoice-extract');
  let parsed = extractInvoice(text, { ownInn });

  // ИИ уточняет — как в штатном распознавании.
  try {
    const aiEx = require('/var/www/asgard-crm/src/services/invoice-ai-extract');
    const ai = await aiEx.extractByAI(text, { db: { query: (s, p) => c.query(s, p) } });
    if (ai && ai.ok && ai.data) parsed = aiEx.mergeWithRegex(ai.data, parsed).parsed;
  } catch (e) { console.log('  (ИИ недоступен: ' + e.message + ')'); }

  console.log('\n=== ИЗ ДОКУМЕНТА ===');
  console.log('  ' + JSON.stringify({
    supplier: parsed.supplier_name || parsed.counterparty_name,
    inn: parsed.inn, number: parsed.invoice_number, date: parsed.invoice_date,
    amount: parsed.amount, net: parsed.amount_net, vat: parsed.vat_amount, rate: parsed.vat_rate
  }));

  // Собираем патч: только то, что реально есть в документе.
  const set = [];
  const vals = [];
  const put = (col, v, cast) => {
    if (v === undefined || v === null || v === '') return;
    vals.push(v); set.push(`${col}=$${vals.length}${cast || ''}`);
  };
  // Сумма: парсер иногда не отдаёт `amount` (берёт из строки «Итого»).
  // Считаем её как нетто + НДС — арифметика самого документа.
  const gross = parsed.amount != null
    ? Number(parsed.amount)
    : (Number(parsed.amount_net || 0) + Number(parsed.vat_amount || 0));

  put('supplier_name', parsed.supplier_name || parsed.counterparty_name);
  put('counterparty_inn', parsed.inn ? String(parsed.inn) : null);
  put('invoice_number', parsed.invoice_number);
  put('invoice_date', parsed.invoice_date, '::date');
  put('amount', gross > 0 ? Math.round(gross * 100) / 100 : null, '::numeric');
  put('amount_net', parsed.amount_net, '::numeric');
  put('vat_amount', parsed.vat_amount, '::numeric');
  put('vat_rate', parsed.vat_rate, '::numeric');
  put('contract_basis_number', parsed.contract_number || (parsed.contract_basis && parsed.contract_basis.number));
  put('comment_text', null); // снимаем мою пометку «проверка D-369»

  if (!set.length) { console.log('\nнечего восстанавливать'); await c.end(); return; }

  if (!APPLY) {
    console.log('\n(dry-run) будет выполнено:');
    console.log('  UPDATE payment_invoices SET ' + set.join(', ') + ' WHERE id=$' + (vals.length + 1));
    console.log('  значения: ' + JSON.stringify(vals));
    console.log('\nчтобы записать: --apply');
    await c.end();
    return;
  }

  vals.push(ID);
  await c.query(`UPDATE payment_invoices SET ${set.join(', ')}, updated_at=NOW() WHERE id=$${vals.length}`, vals);

  const after = (await c.query(`SELECT supplier_name, counterparty_inn, invoice_number, invoice_date,
    amount, amount_net, vat_amount, vat_rate, comment_text FROM payment_invoices WHERE id=$1`, [ID])).rows[0];
  console.log('\n=== ПОСЛЕ ===');
  console.log('  ' + JSON.stringify(after));
  const g = Number(after.amount), n = Number(after.amount_net), v = Number(after.vat_amount);
  console.log('  нетто + НДС = сумма:', Math.abs((n + v) - g) < 0.02 ? 'ДА' : 'НЕТ (' + (n + v) + ' vs ' + g + ')');
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
