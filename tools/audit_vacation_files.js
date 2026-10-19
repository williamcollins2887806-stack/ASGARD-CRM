/**
 * Финальная инвентаризация модуля «График отпусков».
 * Проверяет наличие каждого файла, синтаксис, и ключевые связки.
 */
const fs = require('fs');
const { execSync } = require('child_process');

const FILES = {
  'migrations/V417__office_vacations.sql': null,
  'migrations/V417__office_vacations_down.sql': null,
  'migrations/V418__work_calendar_prod_2026_2027.sql': null,
  'migrations/V418__work_calendar_prod_2026_2027_down.sql': null,
  'src/services/vacation-rules.js': 'js',
  'src/services/vacation-sync.js': 'js',
  'src/services/vacation-docx.js': 'js',
  'src/services/vacation-reminders-cron.js': 'js',
  'src/routes/vacations.js': 'js',
  'src/routes/vacation-decision.js': 'js',
  'src/routes/daily-presence.js': 'js',
  'public/assets/js/vacation_schedule.js': 'js',
  'public/assets/css/vacation.css': null,
  'public/assets/js/office_schedule.js': 'js',
  'templates/vacation-application-tpl.docx': null,
  'templates/vacation-order-t6-tpl.docx': null,
  'templates/vacation-schedule-t7-tpl.docx': null,
  'tests/unit/vacation-rules.test.js': 'js',
  'tests/api/vacations.test.js': 'js',
  'tests/api/vacation-decision.test.js': 'js',
  'tests/api/presence-week.test.js': 'js',
  'tests/api/vacation-cron.test.js': 'js',
  'tests/api/vacation-docs.test.js': 'js',
  'tests/helpers/vacation-isolation.js': 'js',
  'tools/vacation_gate.js': 'js',
  'tools/verify_vacation_port.js': 'js',
};

let ok = 0, bad = 0;
console.log('=== ФАЙЛЫ МОДУЛЯ ===');
for (const [p, kind] of Object.entries(FILES)) {
  if (!fs.existsSync(p)) { console.log('MISSING ' + p); bad++; continue; }
  const size = fs.statSync(p).size;
  if (kind === 'js') {
    try { execSync(`node --check "${p}"`, { stdio: 'pipe' }); }
    catch (e) { console.log('SYNTAX  ' + p); console.log(String(e.stderr || '').slice(0, 200)); bad++; continue; }
  }
  console.log(`OK      ${p}  (${size} B)`);
  ok++;
}

// Связки
console.log('\n=== СВЯЗКИ ===');
const links = [
  ['src/index.js регистрирует vacations', 'src/index.js', /vacations\.js|routes\/vacations|require\(.\.\/routes\/vacations/],
  ['src/index.js регистрирует vacation-decision', 'src/index.js', /vacation-decision/],
  ['src/index.js запускает cron', 'src/index.js', /vacation-reminders|vacationReminders/],
  ['index.html подключает vacation.css', 'public/index.html', /vacation\.css/],
  ['index.html подключает vacation_schedule.js', 'public/index.html', /vacation_schedule\.js/],
  ['app.js: роут vacation-schedule', 'public/assets/js/app.js', /vacation-schedule/],
  ['app.js: недельный гейт', 'public/assets/js/app.js', /daily-presence\/week/],
  ['office_schedule.js: кнопка графика', 'public/assets/js/office_schedule.js', /#\/vacation-schedule/],
  ['payment-mail: ctaButtonsDual', 'src/services/payment-mail.js', /ctaButtonsDual/],
];
let linkBad = 0;
for (const [name, file, re] of links) {
  const s = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const has = re.test(s);
  if (!has) linkBad++;
  console.log((has ? 'OK      ' : 'FAIL    ') + name);
}

// Кодировка
console.log('\n=== КОДИРОВКА (U+FFFD) ===');
let encBad = 0;
for (const p of Object.keys(FILES)) {
  if (!fs.existsSync(p) || p.endsWith('.docx')) continue;
  const s = fs.readFileSync(p, 'utf8');
  const n = (s.match(/\uFFFD/g) || []).length;
  if (n) { console.log(`FAIL ${p}: ${n}`); encBad++; }
}
console.log(encBad ? `файлов с U+FFFD: ${encBad}` : 'OK — 0 символов U+FFFD');

const total = bad + linkBad + encBad;
console.log('\n' + (total === 0 ? `ВСЁ НА МЕСТЕ (${ok} файлов, ${links.length} связок)` : `ПРОБЛЕМ: ${total}`));
process.exit(total ? 1 : 0);
