'use strict';
/**
 * Merge two Excel registries offline → unified JSON + merge-audit.md
 * Usage:
 *   node tools/doc-hub-excel-merge.js path/a.xlsx path/b.xlsx [outDir]
 */
const fs = require('fs');
const path = require('path');

async function readSheet(file) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const headerRow = ws.getRow(1);
  const headers = [];
  headerRow.eachCell((cell, col) => {
    headers[col] = String(cell.value || '').trim();
  });
  const rows = [];
  ws.eachRow((row, rn) => {
    if (rn === 1) return;
    const obj = { _source: path.basename(file), _row: rn };
    let empty = true;
    headers.forEach((h, col) => {
      if (!h) return;
      let v = row.getCell(col).value;
      if (v && typeof v === 'object' && v.result != null) v = v.result;
      if (v && typeof v === 'object' && v.text) v = v.text;
      if (v != null && String(v).trim() !== '') empty = false;
      obj[h] = v;
    });
    if (!empty) rows.push(obj);
  });
  return rows;
}

function normKey(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function mapRow(raw) {
  const get = (...names) => {
    for (const n of names) {
      for (const k of Object.keys(raw)) {
        if (normKey(k) === normKey(n)) return raw[k];
      }
    }
    return null;
  };
  const amount = parseFloat(String(get('Сумма', 'Сумма с НДС', 'amount', 'amount_gross') || '0').replace(/\s/g, '').replace(',', '.')) || 0;
  const workTitle = String(get('Объект', 'Работа', 'work', 'work_title') || '').trim();
  const workPm = String(get('Ответственный за работу', 'РП', 'pm', 'work_pm') || '').trim();
  const docOwner = String(get('Ответственный за документы', 'Отв. док', 'doc_owner') || '').trim();
  const cp = String(get('Контрагент', 'Поставщик', 'counterparty') || '').trim();
  const inv = String(get('№ счёта', 'Счёт', 'invoice_number', 'Номер') || '').trim();
  const officeHint = /офис|канц|хоз/i.test(String(get('Назначение', 'Тип', 'purpose') || ''))
    || /офис/i.test(workTitle);
  return {
    dir: /исход/i.test(String(get('Направление', 'dir') || '')) ? 'out' : 'in',
    invoice_number: inv || null,
    invoice_date: get('Дата счёта', 'Дата', 'invoice_date') || null,
    counterparty_name: cp,
    amount_gross: amount,
    contract_mode: get('Договор') ? 'linked' : 'none',
    contract_label: get('Договор') || null,
    work_title: workTitle || null,
    work_pm_name: workPm || null,
    doc_owner_name: docOwner || null,
    purpose_consumables: officeHint,
    purpose_asgard: !officeHint && !workTitle,
    comment_text: String(get('Комментарий', 'comment') || ''),
    _source: raw._source,
    _row: raw._row,
    _raw: raw
  };
}

(async () => {
  const a = process.argv[2];
  const b = process.argv[3];
  const outDir = process.argv[4] || path.join('tests', 'reports', 'doc-hub-excel');
  if (!a || !b) {
    console.error('Usage: node tools/doc-hub-excel-merge.js a.xlsx b.xlsx [outDir]');
    process.exit(2);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const rowsA = await readSheet(a);
  const rowsB = await readSheet(b);
  const mapped = [...rowsA, ...rowsB].map(mapRow);
  const works = {};
  const issues = [];
  mapped.forEach((r, i) => {
    if (!r.counterparty_name) issues.push({ i, issue: 'no_counterparty', src: r._source, row: r._row });
    if (!r.invoice_number) issues.push({ i, issue: 'no_invoice_number', src: r._source, row: r._row });
    if (r.work_title) {
      const k = normKey(r.work_title);
      works[k] = works[k] || { title: r.work_title, count: 0, pms: new Set() };
      works[k].count++;
      if (r.work_pm_name) works[k].pms.add(r.work_pm_name);
    }
  });
  const worksList = Object.values(works).map((w) => ({
    title: w.title, count: w.count, pms: [...w.pms]
  }));
  fs.writeFileSync(path.join(outDir, 'merged-rows.json'), JSON.stringify(mapped, null, 2));
  const audit = [
    '# Doc Hub Excel merge-audit',
    '',
    `- File A: \`${a}\` rows=${rowsA.length}`,
    `- File B: \`${b}\` rows=${rowsB.length}`,
    `- Merged: ${mapped.length}`,
    `- Issues: ${issues.length}`,
    `- Distinct works: ${worksList.length}`,
    '',
    '## Works',
    ...worksList.map((w) => `- ${w.title} ×${w.count}; РП: ${w.pms.join(', ') || '—'}`),
    '',
    '## Issues (Excel errors to fix before apply)',
    ...(issues.length ? issues.map((x) => `- #${x.i} ${x.issue} @ ${x.src}:${x.row}`) : ['- none']),
    '',
    '## Next',
    '1. Review this audit',
    '2. POST /api/doc-registry/excel/dry-run with merged-rows.json',
    '3. POST .../excel/apply',
    '4. Row-check users/works/office/object → post-apply-fix.md',
    ''
  ];
  fs.writeFileSync(path.join(outDir, 'merge-audit.md'), audit.join('\n'));
  console.log(JSON.stringify({ merged: mapped.length, issues: issues.length, outDir }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
