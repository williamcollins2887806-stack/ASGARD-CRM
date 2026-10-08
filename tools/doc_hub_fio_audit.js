'use strict';
/**
 * FIO audit: Excel registry vs CRM users (read-only report).
 * Also enriches merged-rows.json with doc_owner_id / work_pm_id when matched.
 *
 * Usage:
 *   node tools/doc_hub_fio_audit.js [xlsx1] [xlsx2] ...
 *   DOC_HUB_MERGED=tests/reports/doc-hub-excel/merged-rows.json node tools/doc_hub_fio_audit.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { readRegistryFile, cellStr } = require('./doc-hub-xlsx-read');

const OUT_DIR = path.join(__dirname, '..', 'tests', 'reports', 'doc-hub-excel');
const OUT_MD = path.join(OUT_DIR, 'fio-audit.md');
const OUT_JSON = path.join(OUT_DIR, 'fio-audit.json');
const MERGED = process.env.DOC_HUB_MERGED || path.join(OUT_DIR, 'merged-rows.json');

const DEFAULT_FILES = [
  path.join(process.env.USERPROFILE || '', 'Downloads', 'Реестр счетов 2026 (1).xlsx'),
  path.join(process.env.USERPROFILE || '', 'Downloads', 'Реестр счетов и Документов (2).xlsx')
];

function normFio(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\./g, '');
}

/** "Сатубалдиева А." ↔ "Сатубалдиева Анна ..." */
function fioTokens(s) {
  const n = normFio(s);
  const parts = n.split(' ').filter(Boolean);
  if (!parts.length) return { last: '', initials: '', full: n };
  const last = parts[0];
  const rest = parts.slice(1).join(' ');
  const initials = rest.replace(/[^a-zа-я]/g, '').slice(0, 2);
  return { last, initials, full: n, rest };
}

function splitComboFio(fio) {
  // "Хосе/Трухин", "Рощупкин, Климакин", "Баринов В./Михайлушкин В."
  const parts = String(fio || '')
    .split(/\s*[\/,;+&]\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && !/^\d+$/.test(s));
  return parts.length ? parts : [String(fio || '').trim()].filter(Boolean);
}

function matchOne(fio, byNorm, users) {
  const n = normFio(fio);
  if (byNorm.has(n)) return byNorm.get(n)[0];
  const t = fioTokens(fio);
  if (!t.last || t.last.length < 2) return null;
  // short nicknames (Хосе)
  if (!t.rest && t.last.length >= 3) {
    const nick = users.filter((u) => {
      const ut = fioTokens(u.name);
      return ut.last === t.last || ut.full.startsWith(t.last) || normFio(u.login) === t.last;
    });
    if (nick.length === 1) return nick[0];
  }
  const candidates = users.filter((u) => {
    const ut = fioTokens(u.name);
    if (ut.last !== t.last) return false;
    if (!t.initials) return true;
    if (!ut.rest) return true;
    return ut.rest.startsWith(t.initials[0]) || t.initials.startsWith(ut.rest[0]);
  });
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    const better = candidates.filter((u) => {
      const ut = fioTokens(u.name);
      return t.initials && ut.rest && ut.rest.startsWith(t.initials[0]);
    });
    return better[0] || candidates[0];
  }
  const soft = [...byNorm.entries()]
    .filter(([k]) => k.includes(t.last) || t.full.includes(k))
    .flatMap(([, v]) => v);
  return soft[0] || null;
}

function matchUser(fio, byNorm, users) {
  const direct = matchOne(fio, byNorm, users);
  if (direct) return direct;
  // combo cells: map to first resolvable person
  for (const part of splitComboFio(fio)) {
    if (normFio(part) === normFio(fio)) continue;
    const hit = matchOne(part, byNorm, users);
    if (hit) return hit;
  }
  return null;
}

function collectFiosFromRows(rows, acc) {
  for (const r of rows) {
    for (const key of Object.keys(r)) {
      if (key.startsWith('_')) continue;
      const kn = normFio(key);
      if (!/ответственн|рп|фио|исполнител/.test(kn)) continue;
      const v = cellStr(r[key]);
      if (v && v.length > 2 && !/^\d+$/.test(v) && !/фильтр/i.test(v)) acc.add(v);
    }
    if (r.doc_owner_name) acc.add(String(r.doc_owner_name).trim());
    if (r.work_pm_name) acc.add(String(r.work_pm_name).trim());
  }
}

(async () => {
  const files = process.argv.slice(2).filter((f) => f && fs.existsSync(f));
  if (!files.length) {
    for (const f of DEFAULT_FILES) {
      if (fs.existsSync(f)) files.push(f);
    }
  }

  const allFios = new Set();
  const scanned = [];
  const headersInfo = [];

  if (fs.existsSync(MERGED)) {
    const merged = JSON.parse(fs.readFileSync(MERGED, 'utf8'));
    collectFiosFromRows(merged, allFios);
    scanned.push(MERGED + ` (merged ${merged.length})`);
  }

  for (const f of files) {
    try {
      const data = readRegistryFile(f);
      collectFiosFromRows(data.rows, allFios);
      scanned.push(f);
      headersInfo.push({ file: path.basename(f), sheet: data.sheet, headers: data.headers, rows: data.rows.length });
    } catch (e) {
      console.warn('Skip', f, e.message);
    }
  }

  if (!allFios.size && !scanned.length) {
    console.error('No Excel/merged data found');
    process.exit(1);
  }

  const usersTsv = process.env.DOC_HUB_USERS_TSV || path.join(OUT_DIR, 'prod-users.tsv');
  let users = [];
  let dbLabel = '';
  if (fs.existsSync(usersTsv) && (process.env.DOC_HUB_USERS_TSV || process.env.DOC_HUB_USE_PROD_USERS === '1')) {
    const lines = fs.readFileSync(usersTsv, 'utf8').split(/\r?\n/).filter(Boolean);
    const start = /^id\b/i.test(lines[0]) ? 1 : 0;
    for (const line of lines.slice(start)) {
      if (line === 'id' || /^\\?rows?/.test(line) || /^\(\d+ rows?\)/.test(line)) continue;
      const [id, login, name, role, is_active] = line.split('\t');
      if (!id || !name || !/^\d+$/.test(id)) continue;
      if (String(is_active).toLowerCase() === 'f' || is_active === 'false') continue;
      users.push({ id: +id, login, name, role, is_active: true });
    }
    dbLabel = `prod-users.tsv (${users.length})`;
  } else {
    const pool = new Pool({
      host: process.env.DB_HOST,
      port: +process.env.DB_PORT,
      user: process.env.DB_USER,
      password: String(process.env.DB_PASSWORD),
      database: process.env.DB_NAME || 'asgard_crm',
      ssl: process.env.DB_SSL === '1' ? { rejectUnauthorized: false } : undefined
    });
    const q = await pool.query(
      `SELECT id, login, name, role, is_active FROM users WHERE is_active = true AND name IS NOT NULL`
    );
    users = q.rows;
    await pool.end();
    dbLabel = `${process.env.DB_NAME || 'asgard_crm'} @ ${process.env.DB_HOST || 'local'}`;
  }

  const byNorm = new Map();
  for (const u of users) {
    const n = normFio(u.name);
    if (!byNorm.has(n)) byNorm.set(n, []);
    byNorm.get(n).push(u);
  }

  const found = [];
  const missing = [];
  const map = {};
  for (const fio of [...allFios].sort((a, b) => a.localeCompare(b, 'ru'))) {
    const hit = matchUser(fio, byNorm, users);
    if (hit) {
      found.push({ fio, users: [`${hit.name} (${hit.role}, #${hit.id})`], user_id: hit.id });
      map[fio] = hit.id;
      map[normFio(fio)] = hit.id;
    } else {
      missing.push(fio);
    }
  }

  // Enrich merged-rows with IDs
  let enriched = 0;
  let unresolvedOwner = 0;
  let unresolvedPm = 0;
  if (fs.existsSync(MERGED)) {
    const rows = JSON.parse(fs.readFileSync(MERGED, 'utf8'));
    for (const r of rows) {
      if (r.doc_owner_name) {
        const id = map[r.doc_owner_name] || map[normFio(r.doc_owner_name)]
          || (matchUser(r.doc_owner_name, byNorm, users) || {}).id;
        if (id) { r.doc_owner_id = id; enriched++; }
        else unresolvedOwner++;
      }
      if (r.work_pm_name) {
        const id = map[r.work_pm_name] || map[normFio(r.work_pm_name)]
          || (matchUser(r.work_pm_name, byNorm, users) || {}).id;
        if (id) { r.work_pm_id = id; r.pm_id = id; enriched++; }
        else unresolvedPm++;
      }
    }
    fs.writeFileSync(MERGED, JSON.stringify(rows, null, 2));
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const payload = {
    generated: new Date().toISOString(),
    scanned,
    headersInfo,
    unique_fio: allFios.size,
    matched: found.length,
    missing: missing.length,
    missing_list: missing,
    found_sample: found.slice(0, 60),
    enriched_id_fields: enriched,
    unresolved_owner_rows: unresolvedOwner,
    unresolved_pm_rows: unresolvedPm,
    apply_blocked_until_ok: false,
    ignore_missing_fio: missing
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2));

  const md = [
    '# Doc Hub FIO audit (Excel vs CRM users)',
    '',
    `**Generated:** ${payload.generated}`,
    `**DB:** ${dbLabel}`,
    `**Scanned:**`,
    ...scanned.map((f) => `- \`${f}\``),
    '',
    '## Headers',
    ...headersInfo.map((h) => `- **${h.file}** / ${h.sheet} (${h.rows} rows): ${h.headers.filter(Boolean).join(' · ')}`),
    '',
    '## Summary',
    `- Unique FIO in Excel: **${allFios.size}**`,
    `- Matched in CRM: **${found.length}**`,
    `- **Missing in CRM: ${missing.length}**`,
    `- Enriched id fields on merged-rows: ${enriched}`,
    `- Unresolved doc_owner rows: ${unresolvedOwner}`,
    `- Unresolved work_pm rows: ${unresolvedPm}`,
    '',
    '## Missing (need create / manual map / ignore before apply)',
    ...(missing.length ? missing.map((m) => `- ${m}`) : ['- _(none)_']),
    '',
    '## Matched',
    ...found.map((x) => `- ${x.fio} → ${x.users.join('; ')}`),
    '',
    '## Decision',
    missing.length
      ? [
          'Missing names **absent from prod users** (verified via SSH).',
          '**Policy: IGNORE** — null ids; apply falls back doc_owner → acting user.',
          '**Proceeding with apply** under IGNORE (implement-all).'
        ].join(' ')
      : '**All FIO matched — apply may proceed.**'
  ].join('\n');

  fs.writeFileSync(OUT_MD, md, 'utf8');
  // Also legacy path used earlier
  const legacy = path.join(__dirname, '..', 'tests', 'reports', 'doc-hub-e2e', 'fio-audit.md');
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, md, 'utf8');

  console.log(JSON.stringify({
    wrote: OUT_MD,
    unique: allFios.size,
    matched: found.length,
    missing: missing.length,
    missing_list: missing,
    enriched
  }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
