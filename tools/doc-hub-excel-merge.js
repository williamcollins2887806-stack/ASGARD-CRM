'use strict';
/**
 * Merge two Excel registries offline → unified JSON + merge-audit.md
 * Usage:
 *   node tools/doc-hub-excel-merge.js path/a.xlsx path/b.xlsx [outDir]
 */
const fs = require('fs');
const path = require('path');
const { readRegistryFile, parseAmount, parseDate, cellStr } = require('./doc-hub-xlsx-read');

function normKey(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function mapRow(raw) {
  const get = (...names) => {
    for (const n of names) {
      for (const k of Object.keys(raw)) {
        if (k.startsWith('_')) continue;
        if (normKey(k) === normKey(n)) return raw[k];
        // fuzzy: header contains name
        if (normKey(k).includes(normKey(n)) && normKey(n).length >= 4) return raw[k];
      }
    }
    return null;
  };
  const amount = parseAmount(get('Сумма', 'Сумма с НДС', 'amount', 'amount_gross') || 0);
  const workTitle = cellStr(get('Объект', 'Работа', 'work', 'work_title'));
  const workPm = cellStr(get('Ответственный за работу', 'Ответственный за объект', 'РП', 'pm', 'work_pm'));
  const docOwner = cellStr(get('Ответственный за документы', 'Отв. док', 'doc_owner'));
  const cp = cellStr(get('Контрагент', 'Поставщик', 'counterparty', 'Наименование'));
  const inv = cellStr(get('№ счёта', 'Счёт', 'invoice_number', 'Номер'));
  const invDate = parseDate(get('Дата счёта', 'Дата', 'invoice_date'));
  const contract = cellStr(get('Договор'));
  const nds = cellStr(get('НДС'));
  const hasVat = /да|yes|true|1/i.test(nds) || nds === '';
  const purposeOffice = boolCell(get('Назначение закупаемых ТМЦ — Расходники', 'Расходники'));
  const purposeAsgard = boolCell(get('Назначение закупаемых ТМЦ — Собственность "АСГАРД"', 'Собственность'));
  const purposeCustomer = boolCell(get('Назначение закупаемых ТМЦ — На объект Заказчика', 'На объект'));
  const officeHint = purposeOffice
    || /офис|канц|хоз/i.test(cellStr(get('Назначение', 'Тип', 'purpose')))
    || /офис/i.test(workTitle);
  return {
    dir: /исход/i.test(cellStr(get('Направление', 'dir'))) ? 'out' : 'in',
    invoice_number: inv || null,
    invoice_date: invDate,
    counterparty_name: cp,
    amount_gross: amount,
    has_vat: hasVat,
    contract_mode: contract ? 'linked' : 'none',
    contract_label: contract || null,
    work_title: workTitle || null,
    work_pm_name: workPm || null,
    doc_owner_name: docOwner || null,
    purpose_consumables: officeHint,
    purpose_asgard: purposeAsgard || (!officeHint && !workTitle && !purposeCustomer),
    purpose_customer: purposeCustomer,
    comment_text: cellStr(get('Комментарий', 'comment', 'Для Вити — Комментарий', 'Для Вити', 'Состояние')),
    _source: raw._source,
    _row: raw._row,
    _sheet: raw._sheet
  };
}

function boolCell(v) {
  const s = cellStr(v).toLowerCase();
  return s === 'да' || s === 'yes' || s === 'true' || s === '1' || s === 'x' || s === '✓' || s === 'v';
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

  const fileA = readRegistryFile(a);
  const fileB = readRegistryFile(b);
  const mapped = [...fileA.rows, ...fileB.rows].map(mapRow);

  // Dedup by invoice_number + counterparty + amount + date
  const seen = new Map();
  const unique = [];
  const dups = [];
  mapped.forEach((r, i) => {
    const key = [
      normKey(r.invoice_number),
      normKey(r.counterparty_name),
      r.amount_gross,
      r.invoice_date || ''
    ].join('|');
    if (r.invoice_number && seen.has(key)) {
      dups.push({ i, key, src: r._source, row: r._row, first: seen.get(key) });
      return;
    }
    if (r.invoice_number) seen.set(key, { i, src: r._source, row: r._row });
    unique.push(r);
  });

  const works = {};
  const issues = [];
  unique.forEach((r, i) => {
    if (!r.counterparty_name) issues.push({ i, issue: 'no_counterparty', src: r._source, row: r._row });
    if (!r.invoice_number) issues.push({ i, issue: 'no_invoice_number', src: r._source, row: r._row });
    if (!r.invoice_date) issues.push({ i, issue: 'no_invoice_date', src: r._source, row: r._row });
    if (!(r.amount_gross > 0)) issues.push({ i, issue: 'no_amount', src: r._source, row: r._row });
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

  fs.writeFileSync(path.join(outDir, 'merged-rows.json'), JSON.stringify(unique, null, 2));
  fs.writeFileSync(path.join(outDir, 'merge-meta.json'), JSON.stringify({
    fileA: fileA.meta, fileB: fileB.meta,
    headersA: fileA.headers, headersB: fileB.headers,
    rawMapped: mapped.length, unique: unique.length, dups: dups.length
  }, null, 2));

  const audit = [
    '# Doc Hub Excel merge-audit',
    '',
    `- File A: \`${a}\` sheet=${fileA.sheet} rows=${fileA.rows.length} headers=${fileA.headers.filter(Boolean).slice(0, 8).join(' | ')}…`,
    `- File B: \`${b}\` sheet=${fileB.sheet} rows=${fileB.rows.length}`,
    `- Raw mapped: ${mapped.length}`,
    `- Unique after dedup: ${unique.length} (dropped dups: ${dups.length})`,
    `- Issues: ${issues.length}`,
    `- Distinct works: ${worksList.length}`,
    '',
    '## Headers A',
    ...fileA.headers.map((h, i) => `- [${i}] ${h}`),
    '',
    '## Works',
    ...worksList.slice(0, 80).map((w) => `- ${w.title} ×${w.count}; РП: ${w.pms.join(', ') || '—'}`),
    ...(worksList.length > 80 ? [`- … +${worksList.length - 80} more`] : []),
    '',
    '## Issues (sample, Excel errors to fix before apply)',
    ...(issues.length
      ? issues.slice(0, 60).map((x) => `- #${x.i} ${x.issue} @ ${x.src}:${x.row}`)
      : ['- none']),
    ...(issues.length > 60 ? [`- … +${issues.length - 60} more`] : []),
    '',
    '## Next',
    '1. Review this audit + FIO report',
    '2. Resolve missing FIO → then dry-run / apply',
    ''
  ];
  fs.writeFileSync(path.join(outDir, 'merge-audit.md'), audit.join('\n'));
  console.log(JSON.stringify({
    merged: unique.length,
    raw: mapped.length,
    dups: dups.length,
    issues: issues.length,
    works: worksList.length,
    outDir,
    headersA: fileA.headers,
    headersB: fileB.headers
  }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
