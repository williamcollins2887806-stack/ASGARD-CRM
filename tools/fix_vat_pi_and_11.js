'use strict';
/**
 * D-339a (FAIL верификатора п.3a): НДС исправлен в doc_registry, но НЕ в
 * payment_invoices — заявки #22/#32 уходили с vat_amount == amount.
 * Плюс #11 «ТСИ»: позиций нет.
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

  // ── 1. НДС в заявках ──────────────────────────────────────────────────
  console.log('=== 1. ЗАЯВКИ С НДС == СУММЕ (двойной НДС) ===');
  const bad = await q(`SELECT id, status, amount, vat_amount, amount_net, supplier_name, doc_registry_id
      FROM payment_invoices
     WHERE vat_amount > 0 AND abs(vat_amount - amount) < 0.01`);
  if (!bad.length) console.log('  → нет');
  for (const p of bad) {
    // Берём истину из документа реестра, если там НДС уже верный.
    const d = p.doc_registry_id ? (await q(`SELECT vat_amount, amount_net, has_vat, vat_rate
        FROM doc_registry WHERE id=$1`, [p.doc_registry_id]))[0] : null;
    let vat = 0, net = Number(p.amount), rate = 0;
    if (d && Number(d.vat_amount) !== Number(p.amount)) {
      vat = Number(d.vat_amount); net = Number(d.amount_net); rate = Number(d.vat_rate) || 0;
    }
    console.log(`  #${p.id} ${p.status} сумма=${p.amount}: vat ${p.vat_amount} → ${vat}, net ${p.amount_net} → ${net}`);
    if (APPLY) {
      await q(`UPDATE payment_invoices SET vat_amount=$1, amount_net=$2, updated_at=NOW() WHERE id=$3`,
        [vat, net, p.id]);
      console.log('     ✓ исправлено');
    }
  }

  // ── 2. #11 «ТСИ»: позиции из файла ────────────────────────────────────
  console.log('\n=== 2. ЗАЯВКА #11 «ТСИ»: позиции из файла ===');
  const p11 = (await q(`SELECT id, amount, file_path, file_name, doc_registry_id
      FROM payment_invoices WHERE id=11`))[0];
  console.log(`  сумма=${p11.amount} файл=${p11.file_name || p11.file_path}`);
  let fp = String(p11.file_path || '').replace(/^\/+/, '');
  if (!fp.startsWith('uploads')) fp = 'uploads/' + fp.replace(/^uploads\//, '');
  const full = ROOT + '/' + fp;
  console.log(`  путь: ${full} | есть: ${fs.existsSync(full)}`);
  if (fs.existsSync(full)) {
    const ocr = require(ROOT + '/src/services/pdf-ocr');
    const text = (await ocr.ocrPdfPath(full, p11.file_name || 'c.pdf')).text;
    console.log(`  текст: ${text.length} символов`);
    const aiEx = require(ROOT + '/src/services/invoice-ai-extract');
    const ai = await aiEx.extractByAI(text, {});
    if (ai.ok && (ai.data.lines || []).length) {
      const lines = ai.data.lines;
      const sum = lines.reduce((s, l) => s + (Number(l.sum) || 0), 0);
      console.log(`  позиций=${lines.length}, сумма=${sum} (документ ${p11.amount})`);
      for (const l of lines.slice(0, 3)) console.log(`     • ${String(l.name).slice(0,55)} = ${l.sum}`);
      if (APPLY) {
        await q(`UPDATE payment_invoices SET line_items_json=$1::jsonb, updated_at=NOW() WHERE id=11`,
          [JSON.stringify(lines)]);
        if (p11.doc_registry_id) {
          await q(`UPDATE doc_registry SET parsed_json=$1::jsonb, updated_at=NOW() WHERE id=$2`,
            [JSON.stringify(lines), p11.doc_registry_id]);
        }
        console.log('     ✓ записано');
      }
    } else {
      console.log(`  ИИ позиций не дал (${ai.error || 'пусто'}) — нужен ручной ввод`);
    }
  }

  console.log(`\n${APPLY ? 'ГОТОВО' : 'это dry-run, для применения: --apply'}`);
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
