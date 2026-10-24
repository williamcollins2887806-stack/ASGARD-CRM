#!/usr/bin/env node
'use strict';
/**
 * Деплой мобильной сборки на прод БЕЗ накопления мусора.
 *
 * Зачем (найдено 23.10.2026). Деплой делался руками: `tar czf public/m` →
 * `scp` → `tar xzf` на проде. `tar xzf` ДОБАВЛЯЕТ файлы, но не удаляет
 * прежние, а у ассетов Vite хеш в имени — каждая сборка даёт новые имена.
 * Итог: прод распухал (181 файл локально против 419 на проде), и там
 * накапливались `index-*.js` от старых сборок, которые уже никто не подключает.
 *
 * Что делает скрипт:
 *   1. (при --build) собирает `public/mobile-app` и синхронизирует в `public/m`;
 *   2. ОБЯЗАТЕЛЬНО проходит `shell_guard.py --deploy-gate` перед выкаткой
 *      (требование .cursor/rules/protect-prod-shell.mdc: новые deploy-скрипты
 *      обязаны начинаться с проверки оболочки);
 *   3. заливает tar'ом `public/m` + исходники;
 *   4. на проде переносит ЛИШНИЕ ассеты в карантин (не удаляет — можно вернуть);
 *   5. проверяет результат: количество ассетов, md5 живых `index-*`, health.
 *
 * Использование:
 *   node tools/deploy-mobile.js --dry-run      # только план, ничего не менять
 *   node tools/deploy-mobile.js --build        # собрать и выкатить
 *   node tools/deploy-mobile.js --no-src       # выкатить только public/m
 *
 * Прод не патчим: файлы везём из рабочего дерева (см. protect-prod-shell.mdc).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SSH_KEY = process.env.ASGARD_SSH_KEY
  || path.join(process.env.USERPROFILE || process.env.HOME || '', '.ssh', 'asgard_crm_deploy');
const HOST = process.env.ASGARD_HOST || 'root@92.242.61.184';
const REMOTE = '/var/www/asgard-crm';
const QUARANTINE = '/root/snapshots/orphan-deploy-' + new Date().toISOString().slice(0, 10).replace(/-/g, '');

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const BUILD = args.includes('--build');
const WITH_SRC = !args.includes('--no-src');

const cwd = (p) => path.join(ROOT, p);
const run = (cmd, opts = {}) => execFileSync(cmd, { ...opts, encoding: 'utf8', stdio: opts.stdio || 'pipe', shell: true });
/**
 * Выполнить bash-скрипт на проде.
 *
 * ВАЖНО: скрипт едет ФАЙЛОМ, а не аргументом `ssh "…"`.
 * Через PowerShell многострочная строка портится: кавычки и `$` съедаются,
 * переносы превращаются в литеральные `\n`, и ssh получает мусор
 * («Системе не удаётся найти указанный путь»). Файл + `bash /tmp/x.sh` — надёжно.
 */
const sshScript = (name, script) => {
  const local = path.join(process.env.TEMP || '/tmp', name);
  // LF обязателен: CRLF ломает bash на Linux (аргументы получают \r).
  fs.writeFileSync(local, script.replace(/\r\n/g, '\n'));
  run(`scp -i "${SSH_KEY}" -o BatchMode=yes "${local}" ${HOST}:/tmp/${name}`);
  const out = run(`ssh -i "${SSH_KEY}" -o BatchMode=yes ${HOST} "bash /tmp/${name}"`);
  try { fs.unlinkSync(local); } catch { /* не критично */ }
  return out;
};
const ssh = (script) => run(`ssh -i "${SSH_KEY}" -o BatchMode=yes ${HOST} ${JSON.stringify(script)}`);

const md5 = (f) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');

console.log('=== деплой мобильной сборки ===');
console.log('  режим:', DRY ? 'ПЛАН (--dry-run)' : 'ВЫКАТКА');
console.log('  хост :', HOST, REMOTE);

// ── 1. Сборка (по флагу) ───────────────────────────────────────────────────
if (BUILD && !DRY) {
  console.log('\n[1/5] сборка public/mobile-app');
  run('npm run build', { cwd: cwd('public/mobile-app') });
  console.log('  ok');
}

// ── 2. Синхронизация dist → public/m (чистит старые ассеты ЛОКАЛЬНО) ───────
console.log('\n[2/5] синхронизация dist -> public/m');
const syncOut = run('node tools/sync-mobile-dist.js', { cwd: ROOT });
console.log('  ' + syncOut.trim().split('\n').pop());

// ── 3. Гейт оболочки — ДО любой выкатки ───────────────────────────────────
console.log('\n[3/5] shell_guard --deploy-gate (обязателен перед выкаткой)');
let guardOk = true;
try {
  const g = run('python tools/shell_guard.py --deploy-gate', { cwd: ROOT });
  console.log('  ' + g.trim().split('\n').pop().trim());
} catch (e) {
  guardOk = false;
  const out = ((e.stdout || '') + (e.stderr || '')).toString();
  console.log('  ' + out.trim().split('\n').filter((l) => /FAIL|ИТОГ/.test(l)).join('\n  '));
}
if (!guardOk) {
  console.log('\nСТОП: гейт оболочки красный — выкатка запрещена.');
  process.exit(1);
}

// ── 4. Заливка ────────────────────────────────────────────────────────────
const localAssets = fs.readdirSync(cwd('public/m/assets')).sort();
console.log(`\n[4/5] заливка (ассетов локально: ${localAssets.length})`);
if (DRY) {
  console.log('  план: tar public/m' + (WITH_SRC ? ' + public/mobile-app/src' : '') + ' -> ' + HOST);
  console.log('  план: перенести в карантин лишние ассеты -> ' + QUARANTINE);
  console.log('\n(--dry-run: ничего не менялось)');
  process.exit(0);
}

const stamp = Date.now();
const tgz = path.join(process.env.TEMP || '/tmp', `mobile-deploy-${stamp}.tar.gz`);
const payload = ['public/m'];
if (WITH_SRC) payload.push('public/mobile-app/src');
run(`tar czf "${tgz}" ${payload.join(' ')}`, { cwd: ROOT });
run(`scp -i "${SSH_KEY}" -o BatchMode=yes "${tgz}" ${HOST}:/tmp/mobile-deploy.tar.gz`, { cwd: ROOT });
console.log('  залито:', (fs.statSync(tgz).size / 1048576).toFixed(1), 'МБ');

// Список локальных ассетов — по нему прод чистит лишнее.
const listFile = path.join(process.env.TEMP || '/tmp', `mobile-assets-${stamp}.txt`);
fs.writeFileSync(listFile, localAssets.join('\n'));
run(`scp -i "${SSH_KEY}" -o BatchMode=yes "${listFile}" ${HOST}:/tmp/mobile-assets.txt`, { cwd: ROOT });

// Распаковка + ЧИСТКА лишнего + рестарт.
const remote = [
  `cd ${REMOTE}`,
  'tar xzf /tmp/mobile-deploy.tar.gz',
  'rm -f /tmp/mobile-deploy.tar.gz',
  'chmod 644 public/m/index.html',
  // Ключевой шаг: переносим в карантин всё, чего нет в локальной сборке.
  // Карантин, а не rm: можно вернуть, если сборка окажется неполной.
  `mkdir -p ${QUARANTINE}`,
  'cd public/m/assets',
  'comm -13 <(sort /tmp/mobile-assets.txt) <(ls | sort) > /tmp/orphans.txt',
  'while read -r f; do [ -n "$f" ] && [ -e "$f" ] && mv -f "$f" ' + QUARANTINE + '/ 2>/dev/null || true; done < /tmp/orphans.txt',
  'rm -f /tmp/mobile-assets.txt',
  'systemctl restart asgard-crm',
  'sleep 10',
  'echo "ASSETS=$(ls /var/www/asgard-crm/public/m/assets | wc -l)"',
  'echo "QUARANTINE=$(ls ' + QUARANTINE + ' 2>/dev/null | wc -l)"',
  'echo "SERVICE=$(systemctl is-active asgard-crm)"',
  // md5 живых бандлов. Раньше здесь была вложенная подстановка
  // `$(ls index-*.js ...)` внутри `$(md5sum ...)` — вложенные кавычки ломались,
  // и проверка честно падала с «не удалось получить md5». Пишем проще:
  // фиксированные имена, затем — файл со всеми строками md5.
  'cd /var/www/asgard-crm/public/m/assets',
  'md5sum index-*.js index-*.css 2>/dev/null > /tmp/md5.txt',
  'echo "MD5BEGIN"',
  'cat /tmp/md5.txt',
  'echo "MD5END"',
  'rm -f /tmp/md5.txt',
].join('\n');

console.log('\n[5/5] распаковка, чистка мусора, рестарт');
const raw = sshScript('mobile-deploy.sh', remote);
const res = {};
for (const line of raw.split('\n')) {
  const m = line.match(/^([A-Z]+)=(.*)$/);
  if (m) res[m[1]] = m[2];
}
console.log('  ассетов на проде :', res.ASSETS, '(локально', localAssets.length + ')');
console.log('  в карантине      :', res.QUARANTINE, QUARANTINE);
console.log('  сервис           :', res.SERVICE);

// ── Проверка: живые бандлы совпадают побайтово ────────────────────────────
console.log('\n=== сверка живых бандлов ===');
let mismatch = 0;

// md5 приходит между маркерами MD5BEGIN/MD5END — так вложенные кавычки не мешают.
const md5Text = (() => {
  const m = raw.split('MD5BEGIN')[1];
  return m ? m.split('MD5END')[0] : '';
})();
const remoteMd5 = {};
for (const line of md5Text.split('\n')) {
  const m = line.trim().match(/^([0-9a-f]{32})\s+(\S+)$/);
  if (m) remoteMd5[m[2]] = m[1];
}
for (const [name, hash] of Object.entries(remoteMd5)) {
  const local = cwd('public/m/assets/' + name);
  const localHash = fs.existsSync(local) ? md5(local) : '(нет локально)';
  const same = localHash === hash;
  console.log(`  ${same ? 'OK  ' : 'FAIL'} ${name}${same ? '' : ' ' + localHash + ' != ' + hash}`);
  if (!same) mismatch++;
}
if (!Object.keys(remoteMd5).length) { console.log('  FAIL не удалось получить md5 с прода'); mismatch++; }

const countOk = Number(res.ASSETS) === localAssets.length;
console.log(`  ${countOk ? 'OK  ' : 'FAIL'} количество ассетов: прод ${res.ASSETS} / локально ${localAssets.length}`);

// Health.
try {
  const health = ssh('curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/health');
  const okH = health.trim() === '200';
  console.log(`  ${okH ? 'OK  ' : 'FAIL'} /api/health = ${health.trim()}`);
  if (!okH) mismatch++;
} catch { console.log('  FAIL health не ответил'); mismatch++; }

try { fs.unlinkSync(tgz); fs.unlinkSync(listFile); } catch { /* чистота не критична */ }

const okAll = mismatch === 0 && countOk && res.SERVICE === 'active';
console.log('\n' + (okAll
  ? 'ИТОГ: OK — сборка залита, мусор в карантине, бандлы совпадают, сервис активен'
  : `ИТОГ: FAIL — расхождений ${mismatch}, сервис ${res.SERVICE}`));
process.exit(okAll ? 0 : 1);
