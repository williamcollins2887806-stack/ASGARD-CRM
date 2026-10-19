'use strict';
/**
 * Проверка целостности переноса модуля отпусков в основную ветку.
 *
 * Нужна потому, что при слиянии легко потерять мелкие, но критичные куски:
 * при первом слиянии в main не попали ctaButtonsDual (письма директору падали)
 * и статус «отпуск» в мобильном графике. Теперь это ловится машинно.
 *
 * Запуск: node tools/verify_vacation_port.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (e ? ' :: ' + e : '')); } };
const read = (p) => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch (_) { return ''; } };
const has = (p, re) => re.test(read(p));

// ── Файлы модуля на месте ────────────────────────────────────────────────
const FILES = [
  'src/routes/vacations.js',
  'src/routes/vacation-decision.js',
  'src/services/vacation-rules.js',
  'src/services/vacation-sync.js',
  'src/services/vacation-docx.js',
  'src/services/vacation-reminders-cron.js',
  'public/assets/js/vacation_schedule.js',
  'public/assets/css/vacation.css',
  'migrations/V417__office_vacations.sql',
  'migrations/V418__work_calendar_prod_2026_2027.sql',
  'templates/vacation-order-t6-tpl.docx',
  'templates/vacation-schedule-t7-tpl.docx',
  'tools/vacation_gate.js',
];
const missing = FILES.filter((f) => !fs.existsSync(path.join(ROOT, f)));
check('все файлы модуля на месте', missing.length === 0, missing.join(', '));

// ── Регистрации ──────────────────────────────────────────────────────────
check('роут /api/vacations зарегистрирован', has('src/index.js', /routes\/vacations/));
check('роут /vacation-decision зарегистрирован', has('src/index.js', /routes\/vacation-decision/));
check('cron напоминаний зарегистрирован', has('src/index.js', /vacation-reminders-cron/));
check('страница отпусков подключена в index.html', has('public/index.html', /vacation_schedule\.js/));
check('стили отпусков подключены', has('public/index.html', /vacation\.css/));
check('роут #/vacation-schedule в app.js', has('public/assets/js/app.js', /vacation-schedule/));
check('пункт меню «График отпусков»', has('public/assets/js/app.js', /График отпусков/));

// ── Критичные куски, которые терялись при слиянии ────────────────────────
check('✅ payment-mail экспортирует ctaButtonsDual (письма не падают)',
  has('src/services/payment-mail.js', /ctaButtonsDual/) &&
  /module\.exports[\s\S]*ctaButtonsDual/.test(read('src/services/payment-mail.js')),
  'cron импортирует ctaButtonsDual — без экспорта письмо падает');
check('✅ wrapEmail принимает opts (kicker/footer для отпусков)',
  has('src/services/payment-mail.js', /function wrapEmail\(title, inner, opts\)/));
check('✅ мобильный график офиса знает статус «отпуск»',
  has('public/mobile-app/src/pages/OfficeSchedule.jsx', /code:\s*'отп'/));
check('✅ мобильный гейт присутствия — недельный',
  has('public/mobile-app/src/components/PresenceGateMobile.jsx', /daily-presence\/week/));
check('✅ десктопный гейт присутствия — недельный',
  has('public/assets/js/app.js', /daily-presence\/week/));

// ── Ключевые правила отпусков ────────────────────────────────────────────
check('лимит 14 считается по календарным дням', has('src/services/vacation-rules.js', /calDays > RULES\.SINGLE_MAX/));
check('праздники не входят в оплачиваемые (ст. 120)', has('src/services/vacation-rules.js', /chargedDays|holidaysIn/));
check('перенос не более 12 дней (ст. 124)', has('src/routes/vacations.js', /CARRY_OVER_MAX/));
check('уведомления сотруднику из CRM', has('src/routes/vacations.js', /createNotification/));
check('закрытый график блокирует решения', has('src/routes/vacations.js', /isClosed/));
check('должности в документах на русском', has('src/routes/vacations.js', /positionRu/));
check('T-6 «за период работы» заполняется', has('src/routes/vacations.js', /work_period/));

// ── Миграции не конфликтуют ──────────────────────────────────────────────
// Проверяем только МОИ номера: в истории проекта есть давние дубли (V119, V250,
// V270 и т.п.), они к модулю отпусков отношения не имеют.
const migrDir = path.join(ROOT, 'migrations');
const files = fs.readdirSync(migrDir).filter((f) => f.endsWith('.sql'));
const mine = ['V417', 'V418'];
const mineFiles = files.filter((f) => mine.some((v) => f.startsWith(v + '__')));
check('миграции отпусков на месте (V414/V415)', mineFiles.length === 4, mineFiles.join(', '));
const clash = mine.filter((v) => {
  const same = files.filter((f) => f.startsWith(v + '__')).map((f) => f.replace(/^\d+__/, '').replace(/_down\.sql$|\.sql$/, ''));
  const uniq = [...new Set(same)];
  return uniq.length > 1;
});
check('мои номера миграций не заняты чужими', clash.length === 0, clash.join(', '));

console.log('\n' + (fail ? `FAILS: ${fail}` : 'ALL PASS') + ` (${pass} проверок)`);
process.exit(fail ? 1 : 0);
