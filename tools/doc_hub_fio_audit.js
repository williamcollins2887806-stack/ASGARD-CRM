'use strict';
/**
 * FIO audit: Excel registry vs CRM users (read-only report).
 * Default Excel: D:\ASGARD\01_Проекты\МЛСП-Оголовок\Закупка_ОФС_Приразломная_2026\Сводка_счета_и_СФ.xlsx
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { Pool } = require('pg');

const EXCEL = process.env.DOC_HUB_EXCEL || 'D:\\ASGARD\\01_Проекты\\МЛСП-Оголовок\\Закупка_ОФС_Приразломная_2026\\Сводка_счета_и_СФ.xlsx';
const OUT = path.join(__dirname, '..', 'tests', 'reports', 'doc-hub-e2e', 'fio-audit.md');

function normFio(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');
}

function pickColumns(headers) {
  const h = headers.map((x, i) => ({ i, raw: String(x || ''), n: normFio(x) }));
  const doc = h.find((c) => /ответственн.*документ/.test(c.n)) || h.find((c) => /ответственн.*док/.test(c.n));
  const obj = h.find((c) => /ответственн.*объект/.test(c.n)) || h.find((c) => /ответственн.*работ/.test(c.n));
  const rp = h.find((c) => /^рп$/.test(c.n) || /руководит.*проект/.test(c.n));
  return { doc, obj, rp };
}

(async () => {
  if (!fs.existsSync(EXCEL)) {
    console.error('Excel not found:', EXCEL);
    process.exit(1);
  }
  const wb = XLSX.readFile(EXCEL, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const headers = rows[0] || [];
  const cols = pickColumns(headers);
  const fios = new Set();
  for (const row of rows.slice(1)) {
    for (const c of [cols.doc, cols.obj, cols.rp]) {
      if (!c) continue;
      const v = String(row[c.i] || '').trim();
      if (v && v.length > 2) fios.add(v);
    }
  }

  const pool = new Pool({
    host: process.env.DB_HOST,
    port: +process.env.DB_PORT,
    user: process.env.DB_USER,
    password: String(process.env.DB_PASSWORD),
    database: process.env.DB_NAME || 'asgard_crm'
  });
  const { rows: users } = await pool.query(
    `SELECT id, login, full_name, role, is_active FROM users WHERE is_active = true AND full_name IS NOT NULL`
  );
  await pool.end();

  const byNorm = new Map();
  for (const u of users) {
    const n = normFio(u.full_name);
    if (!byNorm.has(n)) byNorm.set(n, []);
    byNorm.get(n).push(u);
  }

  const found = [];
  const missing = [];
  for (const fio of [...fios].sort((a, b) => a.localeCompare(b, 'ru'))) {
    const n = normFio(fio);
    const hit = byNorm.get(n) || [...byNorm.entries()].filter(([k]) => k.includes(n) || n.includes(k)).flatMap(([, v]) => v);
    if (hit.length) found.push({ fio, users: hit.map((u) => `${u.full_name} (${u.role}, #${u.id})`) });
    else missing.push(fio);
  }

  const md = [
    '# Doc Hub FIO audit (Excel vs CRM users)',
    '',
    `**Excel:** \`${EXCEL}\``,
    `**Sheet:** ${wb.SheetNames[0]}`,
    `**Generated:** ${new Date().toISOString()}`,
    `**DB:** ${process.env.DB_NAME || 'asgard_crm'}`,
    '',
    '## Columns used',
    `- doc: ${cols.doc ? headers[cols.doc.i] : '—'}`,
    `- object/work: ${cols.obj ? headers[cols.obj.i] : '—'}`,
    `- rp: ${cols.rp ? headers[cols.rp.i] : '—'}`,
    '',
    `## Summary`,
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
