'use strict';
/**
 * FIO audit: Excel registry vs CRM users (read-only report).
 * Scans all worksheets; optional DOC_HUB_EXCEL_DIR for alternate manifests.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { Pool } = require('pg');

const DEFAULT_DIR = 'D:\\ASGARD\\01_Проекты\\МЛСП-Оголовок\\Закупка_ОФС_Приразломная_2026';
const EXCEL = process.env.DOC_HUB_EXCEL || path.join(DEFAULT_DIR, 'Сводка_счета_и_СФ.xlsx');
const OUT = path.join(__dirname, '..', 'tests', 'reports', 'doc-hub-e2e', 'fio-audit.md');

function normFio(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');
}

function pickColumns(headers) {
  const h = (headers || [])
    .map((x, i) => ({ i, raw: String(x || ''), n: normFio(x) }))
    .filter((c) => c && typeof c.n === 'string');
  const doc = h.find((c) => /ответственн.*документ/.test(c.n)) || h.find((c) => /ответственн.*док/.test(c.n));
  const obj = h.find((c) => /ответственн.*объект/.test(c.n)) || h.find((c) => /ответственн.*работ/.test(c.n));
  const rp = h.find((c) => /^рп$/.test(c.n) || /руководит.*проект/.test(c.n));
  const fioAny = h.find((c) => /^фио$/.test(c.n) || /ответственн/.test(c.n) || /исполнител/.test(c.n));
  return { doc, obj, rp, fioAny, score: (doc ? 4 : 0) + (obj ? 3 : 0) + (rp ? 2 : 0) + (fioAny ? 1 : 0) };
}

function findHeaderRow(rows) {
  let best = { ri: 0, headers: rows[0] || [], cols: pickColumns(rows[0] || []), score: 0 };
  for (let ri = 0; ri < Math.min(rows.length, 40); ri++) {
    const headers = rows[ri] || [];
    const cols = pickColumns(headers);
    const score = cols.score;
    if (score > best.score) best = { ri, headers, cols, score };
    if (score >= 4) return { ri, headers, cols };
  }
  return best;
}

async function collectFromWorkbook(wb, acc) {
  for (const sheet of wb.worksheets) {
    const rows = [];
    sheet.eachRow((row) => {
      rows.push(row.values.slice(1).map((v) => (v == null ? '' : v)));
    });
    const { ri, headers, cols } = findHeaderRow(rows);
    if (!cols.score) continue;
    for (const row of rows.slice(ri + 1)) {
      for (const c of [cols.doc, cols.obj, cols.rp, cols.fioAny]) {
        if (!c) continue;
        const v = String(row[c.i] || '').trim();
        if (v && v.length > 2 && !/^\d+$/.test(v)) acc.fios.add(v);
      }
    }
    if (cols.score > acc.bestScore) {
      acc.bestScore = cols.score;
      acc.best = { file: acc.file, sheet: sheet.name, ri, headers, cols };
    }
  }
}

async function scanExcelFile(filePath, acc) {
  acc.file = filePath;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  await collectFromWorkbook(wb, acc);
}

(async () => {
  const files = [];
  if (fs.existsSync(EXCEL)) files.push(EXCEL);
  const dir = process.env.DOC_HUB_EXCEL_DIR || DEFAULT_DIR;
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      if (!/\.xlsx$/i.test(name)) continue;
      const p = path.join(dir, name);
      if (!files.includes(p)) files.push(p);
    }
  }
  if (!files.length) {
    console.error('No Excel files found:', EXCEL, dir);
    process.exit(1);
  }

  const acc = { fios: new Set(), best: null, bestScore: 0, scanned: [] };
  for (const f of files) {
    try {
      await scanExcelFile(f, acc);
      acc.scanned.push(f);
    } catch (e) {
      console.warn('Skip', f, e.message);
    }
  }

  const best = acc.best || { file: EXCEL, sheet: '—', ri: 0, headers: [], cols: pickColumns([]) };
  const { headers, cols, ri } = best;
  const fios = acc.fios;

  const pool = new Pool({
    host: process.env.DB_HOST,
    port: +process.env.DB_PORT,
    user: process.env.DB_USER,
    password: String(process.env.DB_PASSWORD),
    database: process.env.DB_NAME || 'asgard_crm'
  });
  const { rows: users } = await pool.query(
    `SELECT id, login, name, role, is_active FROM users WHERE is_active = true AND name IS NOT NULL`
  );
  await pool.end();

  const byNorm = new Map();
  for (const u of users) {
    const n = normFio(u.name);
    if (!byNorm.has(n)) byNorm.set(n, []);
    byNorm.get(n).push(u);
  }

  const found = [];
  const missing = [];
  for (const fio of [...fios].sort((a, b) => a.localeCompare(b, 'ru'))) {
    const n = normFio(fio);
    const hit = byNorm.get(n) || [...byNorm.entries()].filter(([k]) => k.includes(n) || n.includes(k)).flatMap(([, v]) => v);
    if (hit.length) found.push({ fio, users: hit.map((u) => `${u.name} (${u.role}, #${u.id})`) });
    else missing.push(fio);
  }

  const md = [
    '# Doc Hub FIO audit (Excel vs CRM users)',
    '',
    `**Primary Excel:** \`${EXCEL}\``,
    `**Best sheet:** ${best.sheet} (file: \`${path.basename(best.file || EXCEL)}\`)`,
    `**Scanned files:** ${acc.scanned.length}`,
    ...acc.scanned.slice(0, 12).map((f) => `- \`${f}\``),
    ...(acc.scanned.length > 12 ? ['- …'] : []),
    `**Generated:** ${new Date().toISOString()}`,
    `**DB:** ${process.env.DB_NAME || 'asgard_crm'}`,
    '',
    '## Columns used (best sheet)',
    `- doc: ${cols.doc ? headers[cols.doc.i] : '—'}`,
    `- object/work: ${cols.obj ? headers[cols.obj.i] : '—'}`,
    `- rp: ${cols.rp ? headers[cols.rp.i] : '—'}`,
    `- header row: **${ri + 1}**`,
    '',
    ...(fios.size === 0 ? ['> **Note:** колонки «Ответственный…» / «РП» не найдены ни на одном листе просканированных xlsx. Нужен манifest с ФИО или уточнение листа.', ''] : []),
    '## Summary',
    `- Unique FIO in Excel: **${fios.size}**`,
    `- Matched in CRM: **${found.length}**`,
    `- **Missing in CRM: ${missing.length}**`,
    '',
    '## Missing (need create / manual map / ignore before apply)',
    ...(missing.length ? missing.map((m) => `- ${m}`) : ['- _(none)_']),
    '',
    '## Matched sample (first 40)',
    ...found.slice(0, 40).map((x) => `- ${x.fio} → ${x.users.join('; ')}`),
    '',
    '**Apply Excel merge blocked until you confirm missing list.**'
  ].join('\n');

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, md, 'utf8');
  console.log('Wrote', OUT);
  console.log('missing', missing.length);
  if (missing.length) console.log(missing.slice(0, 20).join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
