#!/usr/bin/env node
'use strict';
/**
 * Сколько легитимного контекста теряет stripInternal на реальном OCR тендеров.
 * Нужно, чтобы фильтр входа не выбрасывал ТЗ из-за канцелярита заказчика.
 */
const db = require('../src/services/db');
const lint = require('../src/services/client-doc-lint');

(async () => {
  const r = await db.query(`
    SELECT tender_id, original_name, ocr_text
      FROM documents
     WHERE ocr_text IS NOT NULL AND length(ocr_text) > 500
     ORDER BY id DESC LIMIT 40
  `);

  let totalLines = 0;
  let droppedLines = 0;
  const samples = [];

  for (const row of r.rows) {
    const lines = String(row.ocr_text).split(/\r?\n/);
    totalLines += lines.length;
    for (const line of lines) {
      if (!line.trim()) continue;
      const probe = lint.lintText(line, { skipNumbers: true });
      const leak = probe.hits.some((h) => h.kind === 'internal' || h.kind === 'artifact');
      if (leak) {
        droppedLines += 1;
        if (samples.length < 12) {
          samples.push('[' + row.original_name + '] ' + line.trim().slice(0, 110)
            + '  →  ' + probe.hits.map((h) => h.phrase).join(','));
        }
      }
    }
  }

  console.log('документов: ' + r.rows.length);
  console.log('строк всего: ' + totalLines);
  console.log('выброшено: ' + droppedLines + ' (' + Math.round(droppedLines / Math.max(1, totalLines) * 100) + '%)');
  console.log('\nпримеры выброшенных строк:');
  samples.forEach((s) => console.log('  ' + s));
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
