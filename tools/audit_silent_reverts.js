#!/usr/bin/env node
/**
 * audit_silent_reverts.js — детектор тихих откатов и «правок мимо git» на проде.
 *
 * Зачем (tests/reports/_DIFF-LEDGER.md, D-146 / D-149):
 *   git в этом репозитории отставал на ~2 месяца (HEAD от 13.07). Агент, сделавший
 *   `git checkout HEAD -- <файл>`, молча вернул файл на июльскую версию, а прод
 *   продолжал отдавать что-то иное. Слово «проверил» это не ловит — ловит
 *   3-сторонняя сверка + разбор происхождения строк.
 *
 * Что сравнивается для каждого файла public/assets/** (и оболочек):
 *   LOCAL  — рабочее дерево            (sha256, LF-нормализованный)
 *   HEAD   — git blob из HEAD          (sha256, LF-нормализованный)
 *   PROD   — прод-манифест             (sha256, LF-нормализованный)
 *
 * Первичные вердикты (по хешам):
 *   OK             — все три совпали.
 *   DEPLOYED       — local == prod (!!= HEAD): задеплоено, но в HEAD иначе.
 *   NEEDS_DEPLOY?  — prod == HEAD, local != HEAD: прод стоит на версии из HEAD,
 *                    локально есть работа. Лечится заливкой, ничего не теряется.
 *   PROD_DIFFERS?  — local == HEAD, prod иначе: либо (а) просто ждём выкатки,
 *                    либо (б) на проде правка, которой нет ни локально, ни в HEAD.
 *   DIVERGED?      — все три разные: ручное решение.
 *   PROD_MISSING   — файла нет на проде.
 *   UNTRACKED      — файла нет в git (HEAD-версии не существует).
 *
 * Вердикты «?» уточняются разбором ПРОИСХОЖДЕНИЯ prod-only строк (для этого
 * прод-файл скачивается read-only, а его строки сверяются со всеми историческими
 * ревизиями этого пути в git):
 *   PENDING_DEPLOY — КАЖДАЯ прод-only строка встречается в истории git для этого
 *                    пути. Значит, прод = старая/промежуточная версия, которую
 *                    заливка локального не потеряет. ЭТО НЕ ОШИБКА.
 *   PROD_HANDEDIT  — есть прод-only строки, которых НИКОГДА не было в git.
 *                    Значит, на проде правка руками мимо репозитория. Заливка
 *                    её СТЁРЛА БЫ. ЭТО ГЕЙТ.
 *
 * Два режима (разные вопросы — разные гейты):
 *   --pre-deploy  (по умолчанию) — «не потеряем ли мы работу при заливке».
 *                 FAIL только при PROD_HANDEDIT > 0. PENDING_DEPLOY — норма.
 *   --post-deploy                — «дошли ли файлы до прода» (D-146-класс).
 *                 FAIL при любом расхождении local != prod, кроме junk и
 *                 differ_prod_newer, зафиксированных в отчёте sync-скрипта.
 *
 * Код возврата: 0 — чисто, 1 — гейт нарушен.
 * Источник прод-манифеста: tests/reports/ASSET-MANIFESTS.json
 *   (его пишет tools/restore_asset_sync.py plan).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'tests', 'reports', 'ASSET-MANIFESTS.json');
const REPORT = path.join(ROOT, 'tests', 'reports', 'ASSET-SILENT-REVERTS.json');

const SSH_KEY = path.join(os.homedir(), '.ssh', 'asgard_crm_deploy');
const SSH_HOST = 'root@92.242.61.184';
const REMOTE_ROOT = '/var/www/asgard-crm';
const MAX_REVISIONS = 400;

const mode = process.argv.includes('--post-deploy') ? 'post-deploy' : 'pre-deploy';

const C = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' };

if (!fs.existsSync(MANIFEST)) {
  console.error(C.red + `Нет ${path.relative(ROOT, MANIFEST)}. Сначала: python tools/restore_asset_sync.py plan` + C.off);
  process.exit(1);
}

const { local, remote } = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

// ─────────────────────────── хеши ───────────────────────────

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

// ─────────────── происхождение prod-only строк (git history) ───────────────

const historyLineCache = new Map();

/** Множество всех строк, которые КОГДА-ЛИБО были в этом пути (по истории git). */
function historyLines(rel) {
  if (historyLineCache.has(rel)) return historyLineCache.get(rel);
  const lines = new Set();
  let revs = [];
  try {
    revs = execFileSync('git', ['log', '--format=%H', '-n', String(MAX_REVISIONS), '--', rel],
      { cwd: ROOT, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (e) { /* путь не в git */ }

  if (revs.length) {
    // Один процесс cat-file --batch на все ревизии: <rev>:<path> -> содержимое.
    const input = revs.map((r) => `${r}:${rel}`).join('\n') + '\n';
    let out = Buffer.alloc(0);
    try {
      out = execFileSync('git', ['cat-file', '--batch'], {
        cwd: ROOT, input, maxBuffer: 512 * 1024 * 1024,
      });
    } catch (e) { /* частичный вывод при ошибке разбора */ }
    // Формат: "<oid> <type> <size>\n<content>\n" (для отсутствующих: "<expr> missing\n")
    let pos = 0;
    const bufStr = out;
    while (pos < bufStr.length) {
      const nl = bufStr.indexOf(0x0a, pos);
      if (nl < 0) break;
      const header = bufStr.subarray(pos, nl).toString('utf8');
      pos = nl + 1;
      const m = header.match(/^([0-9a-f]{40})\s+(\w+)\s+(\d+)$/);
      if (!m) continue; // "expr missing"
      const size = parseInt(m[3], 10);
      const body = bufStr.subarray(pos, pos + size);
      pos += size + 1; // + перевод строки после содержимого
      body.toString('utf8').replace(/\r\n/g, '\n').split('\n').forEach((l) => lines.add(l));
    }
  }
  historyLineCache.set(rel, lines);
  return lines;
}

/** Скачать прод-версии файлов (read-only) одним ssh-вызовом. */
function fetchProd(paths) {
  if (!paths.length) return {};
  if (!fs.existsSync(SSH_KEY)) {
    console.log(C.yellow + `  ! ssh-ключ не найден (${SSH_KEY}) — разбор происхождения строк пропущен` + C.off);
    return null;
  }
  const quoted = paths.map((p) => `'${p.replace(/'/g, "'\\''")}'`).join(' ');
  const remote = `cd ${REMOTE_ROOT} && for f in ${quoted}; do ` +
    `if [ -f "$f" ]; then echo "===ASGARD=== $f"; base64 -w0 "$f"; echo; fi; done`;
  let stdout;
  try {
    stdout = execFileSync('ssh', ['-i', SSH_KEY, '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=25',
      SSH_HOST, remote], { maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' });
  } catch (e) {
    console.log(C.yellow + `  ! ssh не отдал прод-файлы: ${String(e.message).slice(0, 200)}` + C.off);
    return null;
  }
  const res = {};
  const parts = stdout.split('===ASGARD=== ');
  for (const chunk of parts.slice(1)) {
    const idx = chunk.indexOf('\n');
    if (idx < 0) continue;
    const rel = chunk.slice(0, idx).trim();
    const b64 = chunk.slice(idx + 1).split('\n')[0].trim();
    if (!b64) continue;
    res[rel] = Buffer.from(b64, 'base64');
  }
  return res;
}

/**
 * Нормализация строки для сравнения «та же строка, другое значение».
 * Убирает версии (`?v=20.28.27`) и длинные числа (`20.28.27`, `5000000`),
 * чтобы бамп версии или смена суммы не выглядели как «потерянная прод-строка».
 */
function normLine(s) {
  return s
    .replace(/\?v=[^"'&\s]+/g, '?v=#')
    .replace(/\d+(\.\d+)+/g, '#')
    .replace(/\d{4,}/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

/** prod-only строки: есть в проде, нет в локальной версии (точное сравнение). */
function prodDiff(prodBuf, localPath) {
  const localText = fs.readFileSync(localPath, 'utf8').replace(/\r\n/g, '\n');
  const localLines = localText.split('\n');
  const localSet = new Set(localLines);
  const localNorm = new Set(localLines.map(normLine));
  const only = [];
  const variantOfLocal = [];
  for (const line of prodBuf.toString('utf8').replace(/\r\n/g, '\n').split('\n')) {
    if (line.trim() === '' || localSet.has(line)) continue;
    if (localNorm.has(normLine(line))) variantOfLocal.push(line);
    else only.push(line);
  }
  return { only, variantOfLocal };
}

// ─── журнал разбора прод-строк (обязателен для «чужих» строк) ───
const ACK_PATH = path.join(ROOT, 'tests', 'reports', 'ASSET-PROD-DIFF-ACK.json');
let ack = { files: {} };
try {
  ack = JSON.parse(fs.readFileSync(ACK_PATH, 'utf8'));
} catch (e) { /* файла нет — значит чужих строк быть не должно */ }
const ackFiles = ack.files || {};
function ackOf(rel) {
  const a = ackFiles[rel];
  if (!a) return null;
  const reason = String(a.reason || '').trim();
  const evidence = String(a.evidence || '').trim();
  if (reason.length < 10 || evidence.length < 20) return null;
  return a;
}

// ─────────────────────────── классификация ───────────────────────────

const rows = [];
const buckets = {
  OK: [], DEPLOYED: [], PENDING_DEPLOY: [], PROD_DIFF_ACKED: [], PROD_HANDEDIT: [],
  PROD_MISSING: [], UNTRACKED: [],
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
  else verdict = 'NEEDS_RESOLVE'; // требует разбора происхождения строк

  rows.push({
    path: rel, verdict,
    local: lo.sha256.slice(0, 12), head: head ? head.slice(0, 12) : null, prod: ro ? ro.sha256.slice(0, 12) : null,
    prodOnly: [], variantOfLocal: [], foreignLines: [],
  });
}

const toResolve = rows.filter((r) => r.verdict === 'NEEDS_RESOLVE');
let prodFetchOk = true;
let prodFiles = {};
if (toResolve.length) {
  const fetched = fetchProd(toResolve.map((r) => r.path));
  prodFetchOk = fetched !== null;
  prodFiles = fetched || {};
}

for (const row of rows) {
  if (row.verdict !== 'NEEDS_RESOLVE') {
    buckets[row.verdict].push(row.path);
    continue;
  }
  const prodBuf = prodFiles[row.path];
  if (!prodBuf) {
    // Не смогли достать прод-файл — честно помечаем как непроверенное, это не PASS.
    row.verdict = 'UNREVIEWED';
    buckets.PROD_HANDEDIT.push(row.path);
    row.foreignLines = ['<прод-файл не получен — разбор происхождения строк не выполнен>'];
    continue;
  }
  const { only, variantOfLocal } = prodDiff(prodBuf, path.join(ROOT, row.path));
  row.prodOnly = only.slice(0, 12);
  row.variantOfLocal = variantOfLocal.slice(0, 6);
  if (!only.length) {
    // Прод отличается только отсутствием локальных строк, либо отличается лишь
    // значением/версией строки, которая локально есть. Терять нечего.
    row.verdict = 'PENDING_DEPLOY';
    buckets.PENDING_DEPLOY.push(row.path);
    continue;
  }
  const hist = historyLines(row.path);
  const foreign = only.filter((l) => !hist.has(l));
  if (!foreign.length) {
    row.verdict = 'PENDING_DEPLOY';
    buckets.PENDING_DEPLOY.push(row.path);
    continue;
  }
  row.foreignLines = foreign.slice(0, 12);
  if (ackOf(row.path)) {
    // Разбор сделан и записан с доказательством — это решение, а не молчаливый PASS.
    row.verdict = 'PROD_DIFF_ACKED';
    buckets.PROD_DIFF_ACKED.push(row.path);
  } else {
    row.verdict = 'PROD_HANDEDIT';
    buckets.PROD_HANDEDIT.push(row.path);
  }
}

// ─────────────────────────── вывод ───────────────────────────

console.log(`режим: ${mode}   файлов проверено: ${rows.length}   (манифест: ${path.relative(ROOT, MANIFEST)})`);
console.log('');

const order = ['OK', 'DEPLOYED', 'PENDING_DEPLOY', 'PROD_DIFF_ACKED', 'PROD_HANDEDIT', 'PROD_MISSING', 'UNTRACKED'];
for (const key of order) {
  const list = buckets[key];
  if (!list.length) continue;
  const color = key === 'PROD_HANDEDIT' ? C.red : key === 'PENDING_DEPLOY' ? C.dim : C.yellow;
  const note = key === 'PENDING_DEPLOY'
    ? '  (прод = старая/промежуточная версия; заливка локального безопасна)'
    : key === 'PROD_DIFF_ACKED' ? `  (прод-строки, которых нет в git; разбор записан в ${path.relative(ROOT, ACK_PATH)})`
      : key === 'PROD_HANDEDIT' ? '  (прод-строки без разбора — заливка их СТЁРЛА БЫ; нужна запись в ASSET-PROD-DIFF-ACK.json)' : '';
  console.log(color + `${key} (${list.length})` + note + C.off);
  const show = list.slice(0, 40);
  for (const p of show) {
    const row = rows.find((r) => r.path === p);
    const extra = row && row.prodOnly && row.prodOnly.length
      ? `  [prod-only: ${row.prodOnly.length}${row.foreignLines && row.foreignLines.length ? `, без разбора: ${row.foreignLines.length}` : ''}]` : '';
    console.log(`  ${p}${extra}`);
  }
  if (list.length > show.length) console.log(`  ... и ещё ${list.length - show.length}`);
  console.log('');
}

const acked = rows.filter((r) => r.verdict === 'PROD_DIFF_ACKED');
if (acked.length) {
  console.log(C.yellow + 'Разобранные расхождения (запись в ACK + причина):' + C.off);
  for (const a of acked.slice(0, 20)) {
    const e = ackOf(a.path);
    console.log(`  ${a.path}`);
    console.log(`      причина : ${e.reason}`);
    console.log(`      довод   : ${e.evidence.slice(0, 200)}`);
  }
  console.log('');
}

const hazards = rows.filter((r) => r.verdict === 'PROD_HANDEDIT');
if (hazards.length) {
  console.log(C.red + 'Детали PROD_HANDEDIT (пер-файл, до 8 строк):' + C.off);
  for (const h of hazards.slice(0, 12)) {
    console.log(`  ${h.path}`);
    for (const l of h.foreignLines.slice(0, 8)) console.log(`      ${JSON.stringify(l.slice(0, 160))}`);
  }
  console.log('');
}

fs.writeFileSync(REPORT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  mode,
  prodFetchOk,
  totals: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
  rows,
}, null, 2));

console.log(`отчёт: ${path.relative(ROOT, REPORT)}`);

if (mode === 'post-deploy') {
  const notDeployed = rows.filter((r) => r.verdict === 'PENDING_DEPLOY');
  if (notDeployed.length) {
    console.log(C.red + `ИТОГ: FAIL (post-deploy) — ${notDeployed.length} файл(ов) на проде отличаются от локального: заливка не дошла` + C.off);
    process.exit(1);
  }
  console.log(C.green + `ИТОГ: OK (post-deploy) — прод совпадает с локальным (расхождений: 0)` + C.off);
  process.exit(0);
}

if (buckets.PROD_HANDEDIT.length) {
  console.log(C.red + `ИТОГ: FAIL (pre-deploy) — PROD_HANDEDIT=${buckets.PROD_HANDEDIT.length}: на проде есть строки, которых нет ни локально, ни в истории git. Заливка их потеряет.` + C.off);
  process.exit(1);
}
console.log(C.green + `ИТОГ: OK (pre-deploy) — PROD_HANDEDIT=0 (ничего прод-уникального заливка не потеряет; PENDING_DEPLOY=${buckets.PENDING_DEPLOY.length} — это и есть то, что выкатываем)` + C.off);
process.exit(0);
