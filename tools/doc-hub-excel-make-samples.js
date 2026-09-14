'use strict';
/**
 * Build two sample Excel registries for Doc Hub merge/apply dry pipeline.
 * Real twin files from business: pass to tools/doc-hub-excel-merge.js instead.
 */
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const OUT = path.join(__dirname, '..', 'tests', 'reports', 'doc-hub-excel');
fs.mkdirSync(OUT, { recursive: true });

async function writeBook(file, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Реестр');
  ws.addRow(['Направление', '№ счёта', 'Дата счёта', 'Контрагент', 'Сумма с НДС', 'Объект', 'Ответственный за работу', 'Ответственный за документы', 'Назначение', 'Комментарий']);
  rows.forEach((r) => ws.addRow(r));
  await wb.xlsx.writeFile(file);
}

(async () => {
  const stamp = Date.now();
  const a = path.join(OUT, 'sample-a.xlsx');
  const b = path.join(OUT, 'sample-b.xlsx');
  await writeBook(a, [
    ['вх', 'XL-A-OFC-' + stamp, '2026-03-10', 'ООО КанцСэмпл', 1800, '', '', 'Test BUH', 'офис', 'sample A office'],
    ['вх', 'XL-A-WRK-' + stamp, '2026-03-11', 'ООО СнабСэмпл', 33000, 'DocHub Sample Work Alpha', 'Test PM', 'Test BUH', 'объект', 'sample A work']
  ]);
  await writeBook(b, [
    ['вх', 'XL-B-OFC-' + stamp, '2026-03-12', 'ИП Хозмаг', 900, '', '', 'Test OFFICE', 'канц', 'sample B office'],
    ['вх', 'XL-B-WRK-' + stamp, '2026-03-13', 'ООО Трубы', 41000, 'DocHub Sample Work Beta', 'Test PM', 'Test BUH', 'объект', 'sample B work']
  ]);
  console.log(JSON.stringify({ a, b, stamp }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
