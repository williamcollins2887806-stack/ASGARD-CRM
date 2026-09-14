#!/usr/bin/env node
/**
 * audit_silent_reverts.js — детектор тихих откатов ассетов (localhost vs git HEAD vs прод).
 *
 * Зачем (tests/reports/_DIFF-LEDGER.md, D-146):
 *   git в этом репозитории отстаёт на ~2 месяца (HEAD от 13.07). Агент, сделавший
 *   `git checkout HEAD -- <файл>`, молча вернул файл на июльскую версию, а прод
 *   продолжал отдавать что-то иное. Слово «проверил» это не ловит — ловит 3-сторонняя сверка.
 *
 * Что сравнивается для каждого файла public/assets/** (и оболочки):
 *     LOCAL  — рабочее дерево            (sha256, LF-нормализованный)
 *     HEAD   — git blobl из HEAD         (sha256, LF-нормализованный)
 *     PROD   — прод-манифест             (sha256, LF-нормализованный)
 *
 * Вердикты:
 *   OK                — все три совпали.
 *   DEPLOYED          — local == prod (!!= HEAD): задеплоено, но не закоммичено. Не страшно.
 *   PROD_STALE        — prod == HEAD, local != HEAD: прод стоит на июльской версии,
 *                       локально есть работа (класс D-146). Лечится заливкой.
 *   PROD_AHEAD        — local == HEAD, prod иначе: на проде правка, которой нет ни
 *                       локально, ни в HEAD. Загрузка локального её СТЁРЛА БЫ. ГЕЙТ.
 *   DIVERGED          — все три разные: ручное решение.
 *   PROD_MISSING      — файла нет на проде.
 *   UNTRACKED         — файла нет в git (HEAD-версии не существует).
 *
 * Гейт: PROD_AHEAD должен быть пуст ({0}).
 * Код возврата: 0 — чисто, 1 — гейт нарушен.
 *
 * Источник прод-манифеста: tests/reports/ASSET-MANIFESTS.json
 *   (его пишет tools/restore_asset_sync.py plan).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'tests', 'reports', 'ASSET-MANIFESTS.json');
const REPORT = path.join(ROOT, 'tests', 'reports', 'ASSET-SILENT-REVERTS.json');

const C = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' };

if (!fs.existsSync(MANIFEST)) {
  console.error(C.red + `Нет ${path.relative(ROOT, MANIFEST)}. Сначала: python tools/restore_asset_sync.py plan` + C.off);
  process.exit(1);
}

const { local, remote } = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

function hashNorm(buf) {
  const kind = buf.subarray(0, 8192).includes(0) ? 'bin' : 'text';
  const norm = kind === 'text' ? Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1') : buf;
  return { kind, hash: crypto.createHash('sha256').update(norm).digest('hex') };
}

function headHash(rel) {
  try {
    const buf = execFileSync('git', ['show', `HEAD:${rel}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    return hashNorm(buf).hash;
  } catch (e) {
    return null; // нет в HEAD
  }
}

const rows = [];
const buckets = {
  OK: [], DEPLOYED: [], PROD_STALE: [], PROD_AHEAD: [], DIVERGED: [], PROD_MISSING: [], UNTRACKED: [],
};

for (const rel of Object.keys(local).sort()) {
  const lo = local[rel];
  const ro = remote[rel];
  const head = headHash(rel);

  let verdict;
  if (!ro) verdict = 'PROD_MISSING';
  else if (head === null) verdict = 'UNTRACKED';
  else if (lo.sha256 === ro.sha256 && lo.sha256 === head) verdict = 'OK';
  else if (lo.sha256 === ro.sha256) verdict = 'DEPLOYED';
  else if (ro.sha256 === head) verdict = 'PROD_STALE';
  else if (lo.sha256 === head) verdict = 'PROD_AHEAD';
  else verdict = 'DIVERGED';

  buckets[verdict].push(rel);
  rows.push({ path: rel, verdict, local: lo.sha256.slice(0, 12), head: head ? head.slice(0, 12) : null, prod: ro ? ro.sha256.slice(0, 12) : null });
}

const total = rows.length;
console.log(`файлов проверено: ${total}  (источник прод-манифеста: ${path.relative(ROOT, MANIFEST)})`);
console.log('');
for (const key of ['OK', 'DEPLOYED', 'PROD_STALE', 'DIVERGED', 'PROD_MISSING', 'UNTRACKED', 'PROD_AHEAD']) {
  const list = buckets[key];
  if (!list.length) continue;
  const color = key === 'PROD_AHEAD' ? C.red : key === 'PROD_STALE' || key === 'DIVERGED' ? C.yellow : C.dim;
  console.log(color + `${key} (${list.length})` + C.off);
  const show = list.slice(0, 40);
  for (const p of show) console.log(`  ${p}`);
  if (list.length > show.length) console.log(`  ... и ещё ${list.length - show.length}`);
  console.log('');
}

fs.writeFileSync(REPORT, JSON.stringify({ generatedAt: new Date().toISOString(), totals: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])), rows }, null, 2));

const gateFailed = buckets.PROD_AHEAD.length > 0;
console.log(`отчёт: ${path.relative(ROOT, REPORT)}`);
if (gateFailed) {
  console.log(C.red + `ИТОГ: FAIL — PROD_AHEAD=${buckets.PROD_AHEAD.length} (заливка локального стёрла бы правки, которых нет ни локально, ни в HEAD)` + C.off);
  process.exit(1);
}
console.log(C.green + `ИТОГ: OK — PROD_AHEAD=0 (ни один файл не будет «даунгрейжен» вслепую)` + C.off);
process.exit(0);
