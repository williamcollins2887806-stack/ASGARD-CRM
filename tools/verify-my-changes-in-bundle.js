/**
 * Проверка: попали ли мои правки в новый бандл перед выкаткой.
 *
 * Контекст: параллельная сессия коммитила в те же минуты, HEAD сменился.
 * Перед заливкой надо убедиться, что мои изменения (журнал прыжков бара,
 * кликабельные согласованные счета) реально в сборке, и не потерялись.
 */
const fs = require('fs');
const path = require('path');

const dir = 'public/m/assets';
const js = fs.readdirSync(dir).filter((f) => /^index-.*\.js$/.test(f));
console.log('бандлов index-*.js:', js.join(', '), '\n');

let fail = 0;
const bad = (m) => { console.log('  FAIL ' + m); fail++; };
const ok = (m) => console.log('  OK   ' + m);

// Читаем все чанки: код разбит, искомое может лежать в любом.
const all = {};
for (const f of fs.readdirSync(dir).filter((x) => /\.js$/.test(x))) {
  all[f] = fs.readFileSync(path.join(dir, f), 'utf8');
}
const joined = Object.values(all).join('\n');

console.log('=== мои правки в сборке ===');

// 1. Журнал прыжков бара (новое, 27.10)
if (/ПРЫЖКИ БАРА/.test(joined)) ok('журнал прыжков бара попал в сборку');
else bad('журнал прыжков бара ОТСУТСТВУЕТ');

// 2. Плоский бар
if (/bottom:0,height:`var\(--tabbar-total\)`/.test(joined)) ok('плоский бар (bottom:0) на месте');
else bad('плоский бар пропал');

// 3. tabbar-lift НЕ вернулся
if (!/--tabbar-lift/.test(joined)) ok('--tabbar-lift отсутствует (сдвига нет)');
else bad('--tabbar-lift ВЕРНУЛСЯ — бар будет обрезаться');

// 4. Кликабельные согласованные счета
if (/одобрен, ждёт оплаты/.test(joined)) ok('подпись согласованного счёта на месте');
else bad('подписи согласованного счёта нет');

// 5. Просмотр выплаты
if (/Состав суммы/.test(joined)) ok('просмотр выплаты (состав суммы) на месте');
else bad('просмотра выплаты нет');

// 6. Первый кадр: инлайн-стиль темы в index.html
const html = fs.readFileSync('public/m/index.html', 'utf8');
const head = html.slice(0, html.indexOf('</head>'));
if (/<style>/.test(head) && /asgard_theme/.test(head)) ok('анти-мигание (первый кадр) на месте');
else bad('анти-мигания нет — гонка 50/50 вернётся');

// 7. Какие чанки содержат новые строки — для контроля
console.log('\n=== где лежат мои строки ===');
for (const [f, t] of Object.entries(all)) {
  const marks = [];
  if (/ПРЫЖКИ БАРА/.test(t)) marks.push('журнал');
  if (/одобрен, ждёт оплаты/.test(t)) marks.push('счёт');
  if (/Состав суммы/.test(t)) marks.push('выплата');
  if (marks.length) console.log(`  ${f}: ${marks.join(', ')}`);
}

console.log('\n' + (fail === 0 ? 'ИТОГ: OK — все правки в сборке' : `ИТОГ: FAIL — ${fail} потеряно`));
process.exit(fail === 0 ? 0 : 1);
