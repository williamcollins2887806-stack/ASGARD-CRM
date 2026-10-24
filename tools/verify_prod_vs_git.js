'use strict';
/**
 * D-374: полная сверка «прод ↔ git» — не потеряли ли правки за 7 дней.
 *
 * Зачем. Заказчик спрашивает: «всё, что создано за последнюю неделю, есть на
 * проде?» Словами это не доказать. Нужен перебор ВСЕХ файлов, которые правились
 * за 7 дней, и построчное сравнение прод-версии с содержимым git HEAD.
 *
 * Что проверяем:
 *   1. Какие файлы менялись за 7 дней (git log --since).
 *   2. Для каждого — скачиваем прод-версию (read-only) и сравниваем с HEAD.
 *   3. Классифицируем: identично / прод старше (нужна заливка) /
 *      на проде есть строки, которых нет в git (потенциальная потеря).
 *
 * Запуск: node tools/verify_prod_vs_git.js [--days=7] [--only=public/assets/js]
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const DAYS = parseInt((process.argv.find((a) => a.startsWith('--days=')) || '--days=7').split('=')[1], 10);
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '--only=').split('=')[1];
const ROOT = process.cwd();
const REPORT = path.join(ROOT, 'tests', 'reports', 'PROD-VS-GIT-7DAYS.json');
const SSH_KEY = path.join(process.env.USERPROFILE || '', '.ssh', 'asgard_crm_deploy');
const HOST = 'root@92.242.61.184';
const REMOTE = '/var/www/asgard-crm';

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** SHA-256 строки/буфера, первые 16 символов. */
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

/** Читает файл с прода по ssh (base64, чтобы не портить кодировку). */
function readRemote(relPath) {
  try {
    const b64 = execFileSync('ssh', [
      '-o', 'BatchMode=yes', '-i', SSH_KEY, HOST,
      `base64 -w0 "${REMOTE}/${relPath}" 2>/dev/null`
    ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    if (!b64.trim()) return null;
    return Buffer.from(b64.trim(), 'base64');
  } catch (_) { return null; }
}

(async () => {
  console.log(`=== D-374: сверка прод ↔ git за ${DAYS} дней ===\n`);

  // 1. Файлы, изменённые за период (только существующие в HEAD).
  const changed = git(['log', `--since=${DAYS} days ago`, '--name-only', '--pretty=format:'])
    .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  let files = [...new Set(changed)];

  // Только те, что имеют смысл для прода (public/, src/, migrations/).
  files = files.filter((f) => /^(public|src|migrations)\//.test(f));
  if (ONLY) files = files.filter((f) => f.startsWith(ONLY));
  // Пропускаем билды, которые деплоятся отдельно/генерируются.
  files = files.filter((f) => !/^public\/(v2|m)\//.test(f));

  console.log(`файлов к сверке: ${files.length}\n`);

  const report = { generatedAt: new Date().toISOString(), days: DAYS, files: [], summary: {} };
  let same = 0, prodOlder = 0, prodNewer = 0, missingOnProd = 0, unknown = 0;
  const losses = [];
  const behind = [];

  for (const f of files) {
    let headBuf;
    try { headBuf = Buffer.from(git(['show', `HEAD:${f}`]), 'utf8'); }
    catch (_) { continue; } // файла нет в HEAD (удалён)

    const prodBuf = readRemote(f);
    if (!prodBuf) { missingOnProd++; report.files.push({ path: f, verdict: 'missing_on_prod' }); continue; }

    const headH = sha(headBuf);
    const prodH = sha(prodBuf);

    if (headH === prodH) { same++; report.files.push({ path: f, verdict: 'identical' }); continue; }

    // Различаются: смотрим, есть ли на проде строки, которых нет в git.
    const headLines = new Set(headBuf.toString('utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 3));
    const prodLines = prodBuf.toString('utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 3);
    const prodOnly = prodLines.filter((l) => !headLines.has(l));
    const headOnly = [...headLines].filter((l) => !prodLines.includes(l));

    let verdict;
    if (prodOnly.length > 0) { verdict = 'prod_has_extra'; prodNewer++; losses.push({ path: f, prodOnly: prodOnly.slice(0, 30), count: prodOnly.length }); }
    else { verdict = 'prod_behind'; prodOlder++; behind.push({ path: f, headOnly: headOnly.length }); }

    report.files.push({
      path: f, verdict, headHash: headH, prodHash: prodH,
      prodOnlyCount: prodOnly.length, headOnlyCount: headOnly.length,
      prodOnlySample: prodOnly.slice(0, 10)
    });
  }

  report.summary = { total: files.length, identical: same, prod_behind: prodOlder, prod_has_extra: prodNewer, missing: missingOnProd };
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');

  console.log('=== РЕЗУЛЬТАТ ===');
  console.log(`  идентичны (прод = git):        ${same}`);
  console.log(`  прод старше (нужна заливка):   ${prodOlder}`);
  console.log(`  НА ПРОДЕ ЕСТЬ ЛИШНЕЕ:          ${prodNewer}   ← проверять!`);
  console.log(`  файла нет на проде:            ${missingOnProd}`);

  if (behind.length) {
    console.log('\n--- прод старше (это файлы, которые ещё не выкачены) ---');
    for (const b of behind.slice(0, 40)) console.log(`  ${b.path}  (в git новее на ${b.headOnly} строк)`);
  }
  if (losses.length) {
    console.log('\n--- НА ПРОДЕ СТРОКИ, КОТОРЫХ НЕТ В GIT ---');
    for (const l of losses) {
      console.log(`  ${l.path}  (${l.count} строк)`);
      for (const s of l.prodOnly) console.log(`      ${s.slice(0, 120)}`);
    }
  }
  console.log('\nотчёт:', REPORT);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
