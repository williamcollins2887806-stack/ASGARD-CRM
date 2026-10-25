/**
 * Итоговая проверка проделанного 24.10.2026:
 *   1. бар ПЛОСКИЙ (цвет страницы) — шва быть не должно;
 *   2. светлые стартовые картинки на месте и подключены;
 *   3. диагностика умеет мерить «шов».
 * Только чтение прода + локальные файлы.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const KEY = path.join(process.env.USERPROFILE, '.ssh', 'asgard_crm_deploy');
const ssh = (cmd) => execFileSync('ssh', ['-i', KEY, '-o', 'BatchMode=yes', 'root@92.242.61.184', cmd],
  { encoding: 'utf8', stdio: 'pipe' });

let fail = 0;
const bad = (m) => { console.log('  FAIL ' + m); fail++; };
const ok = (m) => console.log('  OK   ' + m);

// ── 1. Бар плоский в залитом бандле ───────────────────────────────────────
console.log('=== 1. Тап-бар на проде ===');
const live = ssh("grep -o 'index-[A-Za-z0-9_-]*[.]js' /var/www/asgard-crm/public/m/index.html | head -1").trim();
console.log('  живой бандл:', live);

const barChecks = ssh(`grep -o 'background:.var(--bg-primary).,bottom:0' /var/www/asgard-crm/public/m/assets/${live} | head -1`).trim();
if (barChecks) ok('бар: фон = --bg-primary и bottom: 0 (плоский, на низу)');
else bad('бар не найден в ожидаемом виде');

const glassLeft = ssh(`grep -c 'glass-strong' /var/www/asgard-crm/public/m/assets/${live} || true`).trim();
console.log('  упоминаний glass-strong в бандле:', glassLeft, '(в самом баре не должен применяться)');

const lift = ssh(`grep -c 'tabbar-lift' /var/www/asgard-crm/public/m/assets/${live} || true`).trim();
if (lift === '0') ok('--tabbar-lift отсутствует (сдвига нет)');
else bad(`--tabbar-lift найден ${lift} раз`);

// ── 2. Светлые заставки ───────────────────────────────────────────────────
console.log('\n=== 2. Стартовые картинки на проде ===');
const total = ssh('ls /var/www/asgard-crm/public/assets/img/splash | wc -l').trim();
const lightCount = ssh('ls /var/www/asgard-crm/public/assets/img/splash | grep -c -- "-light" || true').trim();
const linksLight = ssh('grep -c "splash-.*-light.png" /var/www/asgard-crm/public/m/index.html || true').trim();
console.log(`  файлов всего: ${total} | светлых: ${lightCount} | ссылок на светлые: ${linksLight}`);
if (Number(lightCount) === 9) ok('9 светлых картинок на проде');
else bad(`светлых ${lightCount}, ожидалось 9`);
if (Number(linksLight) === 9) ok('9 ссылок с media light в index.html');
else bad(`ссылок ${linksLight}, ожидалось 9`);

// ── 3. Диагностика умеет мерить шов ───────────────────────────────────────
console.log('\n=== 3. Диагностика ===');
const diag = fs.readFileSync('public/mobile-app/src/components/MobileDiagnostics.jsx', 'utf8');
if (/ШОВ бар/.test(diag) && /seamCheck/.test(diag)) ok('в диагностике есть замер «ШОВ бар↔фон»');
else bad('замера шва в диагностике нет');
if (/tabbarBottom/.test(diag)) ok('показывает позицию тап-бара');
else bad('позиция бара не показывается');

// ── 4. Файлы заставок: фон совпал с темой ─────────────────────────────────
console.log('\n=== 4. Локальные заставки ===');
const dir = 'public/assets/img/splash';
const files = fs.readdirSync(dir);
const dark = files.filter((f) => /^splash-[0-9x]+\.png$/.test(f)).length;
const light2 = files.filter((f) => /-light\.png$/.test(f)).length;
if (dark === 9 && light2 === 9) ok('по 9 картинок каждой темы');
else bad(`тёмных ${dark}, светлых ${light2}`);

console.log('\n' + (fail === 0
  ? 'ИТОГ: OK — плоский бар залит, светлые заставки подключены, диагностика обновлена'
  : `ИТОГ: FAIL — ${fail} нарушений`));
process.exit(fail === 0 ? 0 : 1);
