'use strict';
/**
 * D-355 (23.10.2026): разложить склеенный PDF на отдельные счета и привязать
 * НАШИ Исх. письма как обоснование к строкам реестра.
 *
 * ЧТО УСТАНОВЛЕНО ФАКТАМИ (OCR каждой страницы отдельно):
 *   att#1186 «Счёт №УТ-2373 от 22.10.2026.pdf» — 3 страницы, внутри ТРИ счёта:
 *     стр.1 → УТ-2373 (20 510,00 ₽)
 *     стр.2 → УТ-2374 (23 440,00 ₽)
 *     стр.3 → УТ-2372 (20 147,88 ₽)
 *   att#1187 «Счёт №УТ-2375 от 22.10.2026.pdf» — 1 стр., УТ-2375.
 *
 * ЧТО ДЕЛАЕМ:
 *   1. Режем att#1186 на три PDF (pdfseparate), каждый — со своим номером счёта.
 *   2. Прикрепляем КАЖДЫЙ к своей строке реестра как 'scan'.
 *   3. Прикрепляем наши Исх. письма (PDF + DOCX из #5016 и #5019) к своим
 *      строкам как 'justification' — это обоснование, зачем платим.
 *   4. Убираем из attachments старую ссылку на трёхстраничный файл целиком
 *      (она остаётся на диске как исходник, но в строке теперь верные сканы).
 *
 * Новые файлы кладём в uploads/mail-split/ — отдельно от исходных писем.
 */
const ROOT = '/var/www/asgard-crm';
process.chdir(ROOT);
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { Client } = require(ROOT + '/node_modules/pg');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const APPLY = process.argv.includes('--apply');

// Какая страница какому счёту соответствует (установлено OCR).
const PAGE_TO_INVOICE = { 1: 'УТ-2373', 2: 'УТ-2374', 3: 'УТ-2372' };
const OUT_DIR = path.join(ROOT, 'uploads', 'mail-split');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });
  await c.connect();
  const q = (s, p) => c.query(s, p).then((r) => r.rows);
  console.log(`РЕЖИМ: ${APPLY ? 'ПРИМЕНЕНИЕ' : 'dry-run'}\n`);

  // ── 1. Режем трёхстраничный файл ────────────────────────────────────────
  const src = (await q(`SELECT id, file_path, original_filename FROM email_attachments WHERE id=1186`))[0];
  const srcPdf = ROOT + '/' + String(src.file_path).replace(/^\/?uploads\//, 'uploads/');
  console.log(`=== 1. Режем «${src.original_filename}» (3 стр. = 3 счёта) ===`);
  console.log(`  источник: ${srcPdf}`);

  if (!APPLY) {
    for (const [page, inv] of Object.entries(PAGE_TO_INVOICE))
      console.log(`  стр.${page} → ${inv} → uploads/mail-split/${inv}_p${page}.pdf`);
    console.log('  (режем через pdfseparate)');
  } else {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const [page, inv] of Object.entries(PAGE_TO_INVOICE)) {
      const out = path.join(OUT_DIR, `${inv}_p${page}.pdf`);
      try {
        // pdfseparate -f N -l N <src> <out>
        execFileSync('/usr/bin/pdfseparate', ['-f', page, '-l', page, srcPdf, out], { stdio: 'pipe' });
        const sz = fs.statSync(out).size;
        console.log(`  ✓ ${inv}: ${path.basename(out)} (${Math.round(sz / 1024)} КБ)`);
      } catch (e) {
        console.log(`  ✗ ${inv}: pdfseparate — ${e.message}`);
      }
    }
  }

  // ── 2. Привязки ─────────────────────────────────────────────────────────
  console.log('\n=== 2. Привязка сканов и наших Исх. писем ===');

  // Карта: счёт → { страница в склеенном PDF, наш Исх. att из #5016 и #5019 }
  const MAP = {
    'УТ-2372': { page: 3, outAtt: [1193, 1194], outAtt2: [1203, 1204] },
    'УТ-2373': { page: 1, outAtt: [1195, 1196], outAtt2: [1205, 1206] },
    'УТ-2374': { page: 2, outAtt: [1197, 1198], outAtt2: [1207, 1208] },
    'УТ-2375': { page: null, outAtt: [1199, 1200], outAtt2: [1209, 1210] }
  };

  const docAtt = require(ROOT + '/src/services/doc-attachments');

  for (const [inv, cfg] of Object.entries(MAP)) {
    const d = (await q(`SELECT id, invoice_number, attachments FROM doc_registry
        WHERE deleted_at IS NULL AND invoice_number=$1
          AND regexp_replace(coalesce(counterparty_inn,''),'\\D','','g')='3017052355'
        ORDER BY id LIMIT 1`, [inv]))[0];
    if (!d) { console.log(`  ⚠ ${inv}: строка не найдена`); continue; }
    console.log(`\n  ${inv} → строка #${d.id} (сейчас вложений ${(d.attachments || []).length})`);

    // 2a. Отрезаем старую ссылку на трёхстраничный файл (att#1186).
    if (APPLY) {
      const cleaned = (d.attachments || []).filter((a) => String(a.attachment_id) !== '1186');
      await q(`UPDATE doc_registry SET attachments=$1::jsonb, updated_at=NOW() WHERE id=$2`,
        [JSON.stringify(cleaned), d.id]);
      if (cleaned.length !== (d.attachments || []).length)
        console.log(`     − убрана ссылка на склеенный файл (осталось ${cleaned.length})`);
    }

    // 2b. Свой скан.
    let scanFile = null;
    if (inv === 'УТ-2375') {
      // У УТ-2375 отдельный файл att#1187 — привяжем его напрямую.
      const a = (await q(`SELECT id, original_filename, file_path, mime_type, size FROM email_attachments WHERE id=1187`))[0];
      scanFile = a;
    } else {
      const p = path.join(OUT_DIR, `${inv}_p${cfg.page}.pdf`);
      scanFile = {
        id: null,
        original_filename: `Счёт №${inv} от 22.10.2026.pdf`,
        file_path: 'uploads/mail-split/' + path.basename(p),
        mime_type: 'application/pdf',
        size: fs.existsSync(p) ? fs.statSync(p).size : null
      };
    }
    if (APPLY) {
      const r = await docAtt.attachFilesToDoc(c, d.id, 5011, [scanFile], { kind: 'scan', log: console });
      console.log(`     ✓ скан: +${r.added} (${scanFile.original_filename})`);
    } else {
      console.log(`     скан: ${scanFile.original_filename}`);
    }

    // 2c. Наши Исх. письма (PDF + DOCX) — обоснование.
    // ВАЖНО: #5016 и #5019 содержат ОДНИ И ТЕ ЖЕ наши письма (Путков «дублирую
    // для банка»). Идемпотентность по attachment_id не ловит их (разные id),
    // поэтому берём только ПЕРВЫЙ комплект — из #5016.
    {
      const files = await q(`SELECT id, original_filename, file_path, mime_type, size
          FROM email_attachments WHERE id = ANY($1::int[]) ORDER BY id`, [cfg.outAtt]);
      if (files.length) {
        if (APPLY) {
          const r = await docAtt.attachFilesToDoc(c, d.id, 5016, files, { kind: 'justification', log: console });
          console.log(`     ✓ Исх. (обоснование): +${r.added}`);
        } else {
          console.log(`     Исх.: ${files.map((f) => f.original_filename).join(' | ')}`);
        }
      }
    }
  }

  // ── 3. Итог ─────────────────────────────────────────────────────────────
  if (APPLY) {
    console.log('\n=== 3. ИТОГ ===');
    for (const r of await q(`SELECT id, invoice_number, amount_gross, attachments
        FROM doc_registry WHERE id BETWEEN 1603 AND 1606 ORDER BY id`)) {
      console.log(`\n  #${r.id} ${r.invoice_number} ${r.amount_gross}: ${(r.attachments || []).length} файл(ов)`);
      for (const a of (r.attachments || [])) console.log(`    • [${a.kind}] ${a.name}`);
    }
  }

  console.log(`\n${APPLY ? 'ГОТОВО' : 'это dry-run, для применения: --apply'}`);
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
