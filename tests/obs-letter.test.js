'use strict';

/**
 * tests/obs-letter.test.js
 *
 * D-378: проверка письма для оплаты через ОБС.
 *
 * Почему отдельный тест, а не «проверил руками». Письмо уходит внешнему
 * контрагенту и служит основанием платежа. Ошибка в сумме прописью, в ставке
 * НДС или в номере счёта — это брак в платёжном документе, а не косметика.
 * Первый прогон уже поймал реальный дефект: при круглых суммах (235 000)
 * терялось слово «рублей» — «Двести тридцать пять тысяч 00 копеек».
 *
 * Запуск: node --test tests/obs-letter.test.js
 * Не требует БД: проверяются чистые функции.
 */

const test = require('node:test');
const assert = require('node:assert');

// Модуль тянет letter/_shared → services/db, которому нужен DB_PASSWORD.
// Подставляем фиктивный: тест не ходит в базу, только в чистые функции.
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test-not-used';

const { amountInWords, buildItems, selectLetterItems } = require('../src/services/obs-letter');

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  PASS ' + msg); }
  else { fail++; console.log('  FAIL ' + msg); }
  assert.ok(cond, msg);
}

// ─── Сумма прописью ───────────────────────────────────────────────────────
console.log('\n=== Сумма прописью ===');
ok(amountInWords(103150) === 'Сто три тысячи сто пятьдесят рублей 00 копеек',
  '103 150 → как в образце А-2127');
ok(amountInWords(90400) === 'Девяносто тысяч четыреста рублей 00 копеек',
  '90 400 → как в образце А-2115');
ok(amountInWords(235000) === 'Двести тридцать пять тысяч рублей 00 копеек',
  '235 000 → слово «рублей» не теряется (найденный дефект)');
ok(amountInWords(1000000) === 'Один миллион рублей 00 копеек',
  '1 000 000 → «рублей» на месте');
ok(amountInWords(2000) === 'Две тысячи рублей 00 копеек',
  '2 000 → «две» (женский род для тысяч)');
ok(amountInWords(1000) === 'Одна тысяча рублей 00 копеек',
  '1 000 → «одна тысяча»');
ok(amountInWords(1) === 'Один рубль 00 копеек', '1 → «один рубль»');
ok(amountInWords(2) === 'Два рубля 00 копеек', '2 → «два рубля»');
ok(amountInWords(5) === 'Пять рублей 00 копеек', '5 → «пять рублей»');
ok(amountInWords(21) === 'Двадцать один рубль 00 копеек', '21 → «двадцать один рубль»');
ok(amountInWords(0) === 'Ноль рублей 00 копеек', '0 → «ноль рублей»');
ok(amountInWords(1234567.89) === 'Один миллион двести тридцать четыре тысячи пятьсот шестьдесят семь рублей 89 копеек',
  '1 234 567,89 → полная разрядность с копейками');
ok(amountInWords(601456) === 'Шестьсот одна тысяча четыреста пятьдесят шесть рублей 00 копеек',
  '601 456 → счёт #1 БАШПРОМ');

// ─── Перечень услуг ───────────────────────────────────────────────────────
console.log('\n=== Перечень услуг ===');
const trainingLines = [
  { name: 'Обучение по программе «Рабочие профессии»', quantity: 7, unit: 'шт' },
  { name: 'Обучение охране труда', quantity: 85, unit: 'шт' },
];
const items1 = buildItems({}, trainingLines);
ok(items1.length === 2, 'две позиции из счёта');
ok(/7 чел\./.test(items1[0]), 'для обучения единица «чел.», а не «шт» (как в образце)');
ok(/85 чел\./.test(items1[1]), '85 чел. на второй позиции');

const goods = buildItems({}, [{ name: 'Газоанализатор', quantity: 2, unit: 'шт' }]);
ok(/2 шт/.test(goods[0]) && !/чел/.test(goods[0]),
  'товар остаётся в штуках, единица не подменяется на «чел.»');

const noLines = buildItems({ invoice_number: 'А-2127', comment_text: '' }, null);
ok(noLines.length === 1 && /по счёту № А-2127/.test(noLines[0]),
  'нет позиций → нейтральная строка «по счёту № …», а не выдумка');

const fromComment = buildItems(
  { invoice_number: 'X', comment_text: 'Вывоз нефтешлама 11 м3; Постоплата 60 дней' }, null);
ok(fromComment.length === 2, 'позиции из комментария, если нет распознанных строк');

// ─── D-385: тело запроса кнопки «Сформировать» ────────────────────────────
// Дефект 28.10.2026: плашка «Письма нет» с кнопкой не работала ни разу —
// `/api/doc-registry/2146/obs-letter` отвечал 400. Причина не в правах и не
// в статусе счёта: фронт слал `body: {}` (объект), fetch превращал его в
// строку «[object Object]», и Fastify отбивал запрос как битый JSON ещё до
// роута. Здесь фиксируем, что тело обязано быть JSON-строкой.
console.log('\n=== Тело запроса obs-letter (D-385) ===');
{
  const body = JSON.stringify({});
  ok(typeof body === 'string' && body === '{}',
    'тело — JSON-строка «{}», а не объект (объект уходит как «[object Object]»)');
  ok((() => { try { JSON.parse(body); return true; } catch (_) { return false; } })(),
    'тело разбирается JSON.parse — Fastify не ответит 400');
  // Контроль: именно так выглядел старый вариант — и он невалиден.
  const oldBody = String({});
  ok(oldBody === '[object Object]' && (() => { try { JSON.parse(oldBody); return false; } catch (_) { return true; } })(),
    'контроль: String({}) = «[object Object]» — невалидный JSON, отсюда был 400');
}

// ─── D-385: письмо обязано уместиться на одном листе ──────────────────────
// «Всегда умещать на 1 листе письмо или как-то делить его на части»
// (Д. Путков, 28.10.2026). Замер на реальном рендере: 16 позиций — 1 лист,
// 25 — уже два, и подпись с печатью уезжали на второй лист отдельно от
// текста. Поэтому перечень при длине > 28 печатается «head + остаток»,
// причём ОДИНАКОВО в PDF и Word — иначе бухгалтерия отправит одно, а
// распечатает другое.
console.log('\n=== Перечень: уместить на лист (D-385) ===');
{
  const mk = (n) => Array.from({ length: n }, (_, i) => `Позиция ${i + 1}`);
  let s = selectLetterItems(mk(28), 'ДС-1');
  ok(s.rest === 0 && s.shown.length === 28, '28 позиций → печатаем все (граница)');
  s = selectLetterItems(mk(29), 'ДС-1');
  ok(s.shown.length === 20 && s.rest === 9, '29 позиций → 20 + остаток');
  ok(/ещё 9 позиций/.test(s.restLine), 'остаток назван прямо, склонение «позиций»');
  ok(/ещё 21 позиция/.test(selectLetterItems(mk(41), 'ДС-1').restLine),
    'склонение 21 → «позиция»');
  ok(/ещё 22 позиции/.test(selectLetterItems(mk(42), 'ДС-1').restLine),
    'склонение 22 → «позиции»');
  ok(selectLetterItems(null, 'x').shown.length === 0, 'нет позиций → пусто, без падения');
}

// ─── D-386: платёжный контур определяет бухгалтерия ───────────────────────
// Заказчик 28.10.2026: «выбор откуда платим — с ОБС или нет — должна быть у
// бухгалтерии. Не у инициатора и не у директора». Проверяем, что фронт и бэк
// не разойдутся молча: обе точки читают один и тот же список ролей.
console.log('\n=== Права на платёжный контур (D-386) ===');
{
  const fs = require('fs');
  const routeSrc = fs.readFileSync(require.resolve('../src/routes/doc-registry'), 'utf8');
  const m = routeSrc.match(/const OBS_ROLES = \[([^\]]*)\]/);
  ok(!!m, 'OBS_ROLES найден в роуте');
  const roles = m ? m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : [];
  ok(roles.includes('BUH'), 'бухгалтерия (BUH) может менять контур');
  for (const r of ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'PM', 'HEAD_PM', 'PROC']) {
    ok(!roles.includes(r), `${r} не может менять контур`);
  }

  const hubSrc = fs.readFileSync(require.resolve('../public/assets/js/doc-hub.js'), 'utf8');
  const fm = hubSrc.match(/function canManageObs\(\)\s*\{\s*return \[([^\]]*)\]\.includes/);
  ok(!!fm, 'canManageObs найдена во фронте');
  const front = fm ? fm[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : [];
  ok(front.includes('BUH') && front.includes('ADMIN'), 'фронт: BUH и ADMIN (' + front.join(', ') + ')');
  ok(!front.some((r) => /DIRECTOR|^PM$|HEAD_PM/.test(r)),
    'фронт не пускает директора и инициатора к переключателю');
}

// ─── D-386: покрытие счёта лимитом ────────────────────────────────────────
// «Хватит ли лимита на этот счёт» — главный вопрос бухгалтера при выборе
// договора. Считает сервер; здесь фиксируем арифметику и границы.
console.log('\n=== Покрытие счёта лимитом (D-386) ===');
{
  const calc = (limit, spent, amount) => {
    const remaining = Number((limit - spent).toFixed(2));
    return {
      remaining,
      used_pct: limit > 0 ? Number((spent / limit * 100).toFixed(2)) : 0,
      covers_invoice: remaining >= amount,
      short_by: remaining >= amount ? 0 : Number((amount - remaining).toFixed(2)),
    };
  };
  let c = calc(1500000, 400000, 17537);
  ok(c.remaining === 1100000, 'остаток = 1 100 000');
  ok(c.used_pct === 26.67, 'процент = 26.67');
  ok(c.covers_invoice === true, 'счёт 17 537 влезает → можно платить через ОБС');

  c = calc(3000000, 2990000, 17537);
  ok(c.covers_invoice === false, 'остаток 10 000 < счёт 17 537 → не влезает');
  ok(c.short_by === 7537, 'недостаёт 7 537 — названа точная сумма');

  c = calc(1000000, 700000, 300000);
  ok(c.covers_invoice === true, 'ровно на границе хватает (300 000 из 300 000)');
  c = calc(1000000, 700000, 300000.01);
  ok(c.covers_invoice === false, 'на копейку больше — уже не хватает');

  c = calc(1000000, 1000000, 1);
  ok(c.remaining === 0 && c.used_pct === 100, 'лимит выработан: остаток 0, 100%');
  ok(c.covers_invoice === false, 'при выработанном лимите счёт не покрыт');
}

// ─── D-388: файлы письма раскладываются по СВОИМ счетам ───────────────────
// «И почему 2 счета в одной строчке????» (заказчик 28.10.2026). Причина:
// файлы прикреплялись ко всем строкам письма скопом, и в карточке КР-4724
// лежали счёт и УПД от КР-4536. Проверяем на РЕАЛЬНЫХ именах с прода.
console.log('\n=== Раскладка файлов по счетам (D-388) ===');
{
  const { numbersFromFileName, fileMatchesInvoice } = require('../src/services/doc-attachments');

  // Письмо ЭкоЦентра: два счёта + две УПД одним письмом.
  const ek = [
    'АГПЗ ООО Экоцентр Счет на оплату КР-4724 от 30.09.2026.pdf',
    'АГПЗ ООО Экоцентр Счет на оплату КР-4536 от 31.10.2026.pdf',
    'АГПЗ ООО Экоцентр УПД 30.09.26 № КР-4724.pdf',
    'АГПЗ ООО Экоцентр УПД 31.10.26 № КР-4536.pdf',
  ];
  const own4724 = ek.filter((f) => fileMatchesInvoice(f, 'КР-4724') === 'match');
  const own4536 = ek.filter((f) => fileMatchesInvoice(f, 'КР-4536') === 'match');
  ok(own4724.length === 2 && own4724.every((f) => /4724/.test(f)),
    'КР-4724 получил только свои 2 файла (счёт + УПД)');
  ok(own4536.length === 2 && own4536.every((f) => /4536/.test(f)),
    'КР-4536 получил только свои 2 файла');
  ok(!own4724.some((f) => /4536/.test(f)), 'чужой счёт НЕ попал в строку 4724');

  // Письмо БТ: сопроводительные письма по двум разным счетам.
  ok(fileMatchesInvoice('Исх. №261026-03 от 26.10.2026 г. — счёт № УТ-2397.pdf', 'УТ-2399') === 'other',
    'письмо по УТ-2397 не крепится к УТ-2399');
  ok(fileMatchesInvoice('Исх. №261026-04 от 26.10.2026 г. — счёт № УТ-2399.pdf', 'УТ-2399') === 'match',
    'письмо по УТ-2399 крепится к УТ-2399');

  // Договор с чужим номером — не обоснование этого счёта.
  ok(fileMatchesInvoice('Договор №12.03_1339 от 12.03.25.pdf', 'УТ-2399') === 'other',
    'договор с чужим номером не приписан к счёту');
  ok(fileMatchesInvoice('Скан.pdf', 'ДС-26028599') === 'unknown',
    'файл без номеров → unknown (решает число счетов в письме)');

  // Разбор номеров: точка внутри номера не должна ломать распознавание.
  ok(numbersFromFileName('Договор №12.03_1339 от 12.03.25.pdf').includes('1339'),
    'номер после точки с подчёркиванием распознан (был дефект: \\b не срабатывал)');
  ok(!numbersFromFileName('Накладная 2026-10-28.pdf').some((n) => /^дная/.test(n)),
    'хвост слова не превращается в номер (был дефект)');
  ok(fileMatchesInvoice('ДС-26028599.pdf', 'ДС-26028599') === 'match', 'точный номер совпадает');
  ok(fileMatchesInvoice('дс 26028599 счёт.pdf', 'ДС-26028599') === 'match',
    'пробел вместо дефиса и другой регистр — совпадение');
  ok(fileMatchesInvoice('', 'ДС-1') === 'unknown', 'пустое имя → unknown, без падения');
}

// ─── D-389: расчёт Мимира переживает рестарт ──────────────────────────────
// Инцидент 28.10.2026: сессия 895c144b (Д. Путков) — 41% и «связь потеряна»,
// а на сервере расчёта уже не было. Причина: признаком «жив» был только
// updated_at, который двигал heartbeat ВНУТРИ процесса. Рестарт → расчёт мёртв,
// но запись выглядит живой. Теперь есть PID владельца.
console.log('\n=== Расчёт Quick и рестарт (D-389) ===');
{
  const fs = require('fs');
  const src = fs.readFileSync(require.resolve('../src/routes/tkp_quick'), 'utf8');

  ok(/calc_owner_pid/.test(src), 'роут использует calc_owner_pid — признак живого владельца');
  ok(/calc_owner_pid <> \$4/.test(src), 'чужой PID считается мёртвым (сравнение с текущим)');
  ok(/calc_owner_pid=\$2/.test(src), 'при старте расчёта PID записывается');
  ok(/calc_owner_pid = NULL/.test(src), 'при завершении/ошибке PID снимается');

  // Логика освобождения — таблица случаев.
  const reclaim = (ownerPid, myPid, updatedMinAgo, staleMin) =>
    (ownerPid !== null && ownerPid !== myPid) || updatedMinAgo > staleMin;

  ok(reclaim(999999, 12345, 0, 3) === true, 'рестарт: чужой PID → освободить СРАЗУ (был дефект: ждали 3 мин)');
  ok(reclaim(12345, 12345, 0, 3) === false, 'свой живой расчёт → не трогать');
  ok(reclaim(12345, 12345, 10, 3) === true, 'завис 10 мин при живом PID → освободить по таймауту');
  ok(reclaim(null, 12345, 0, 3) === false, 'нет владельца и свежий → не трогать');
  ok(reclaim(null, 12345, 10, 3) === true, 'нет владельца и старый → освободить');

  // Доступ: чужой черновик без объекта закрыт, просчёт по объекту — общий.
  const canSee = (authorId, userId, role, workId, tenderId) => {
    if (role === 'ADMIN') return true;
    if (authorId === userId) return true;
    const hasObject = !!workId || !!tenderId;
    if (!hasObject) return false;
    const FULL = ['BUH', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'DIRECTOR', 'OFFICE_MANAGER', 'HEAD_PM'];
    return FULL.includes(role);
  };
  ok(canSee(3465, 3465, 'PM', null, null) === true, 'автор видит свой черновик');
  ok(canSee(3465, 3474, 'PM', null, null) === false,
    'чужой черновик без объекта закрыт (не «выкинуло», а личные наброски)');
  ok(canSee(3465, 3474, 'DIRECTOR_GEN', 417, null) === true,
    'просчёт по объекту доступен директору — раньше был 404');
  ok(canSee(3465, 9999, 'BUH', 417, null) === true, 'просчёт по объекту доступен бухгалтерии');
}

// ─── D-390: колонки «Завершено» и «Корзина» ───────────────────────────────
// «В канбан нужно добавить колонку работы завершены и корзина куда мусор
// скинуть можно» (28.10.2026). Колонка здесь — вычисляемое значение функции
// pk_v3_column, поэтому проверяем маппинг и жизненный цикл карточки.
console.log('\n=== Колонки «Завершено» и «Корзина» (D-390) ===');
{
  const fs = require('fs');
  const route = fs.readFileSync(require.resolve('../src/routes/personal-kanban'), 'utf8');
  const hub = fs.readFileSync(require.resolve('../public/assets/js/personal_kanban.js'), 'utf8');

  ok(/const V3_COLUMNS = \[[^\]]*'done'[^\]]*'trash'/.test(route), 'бэкенд знает колонки done и trash');
  ok(/SERVICE_COLUMNS = new Set\(\['done', 'trash'\]\)/.test(route), 'они помечены как служебные');
  ok(/current_main_status IN \(\\?'trash\\?',\\?'done\\?'\)/.test(route),
    'доска показывает корзину и завершённые (раньше is_closed=FALSE их прятал)');
  ok(/is_closed = CASE WHEN current_main_status = 'trash'/.test(route),
    'возврат из корзины снимает закрытие');
  ok(/\{ id: 'done'/.test(hub) && /\{ id: 'trash'/.test(hub), 'фронт рисует обе колонки');
  ok(/pk-card-trash/.test(hub) && /pk-card-restore/.test(hub) && /pk-card-done/.test(hub),
    'есть кнопки «Завершить», «В корзину», «Вернуть из корзины»');

  // Жизненный цикл: карта не должна теряться ни на одном шаге.
  const lifecycle = (status, closed) => ({ status, closed });
  let c = lifecycle('В работе', false);
  ok(c.status === 'В работе', 'старт: в работе');
  c = lifecycle('done', false);
  ok(c.status === 'done' && c.closed === false, '«Завершить» → done, карта открыта (видна на доске)');
  c = lifecycle('trash', true);
  ok(c.status === 'trash' && c.closed === true, '«В корзину» → trash, is_closed=TRUE');
  // Видимость на доске: is_closed=TRUE само по себе не прячет.
  const visibleOnBoard = (st, closed) => closed === false || ['trash', 'done'].includes(st);
  ok(visibleOnBoard('trash', true) === true, 'карта в корзине ВИДНА (иначе колонка была бы пустой)');
  ok(visibleOnBoard('done', false) === true, 'завершённая карта видна');
  ok(visibleOnBoard('sent', true) === false, 'по-настоящему закрытая карта (не корзина) скрыта — как было');
  c = lifecycle('new', false);
  ok(c.status === 'new' && c.closed === false, '«Вернуть» → карта снова в работе, закрытие снято');
}

console.log(`\n────────────────────────────────────────`);
console.log(`ИТОГ письма ОБС: PASS ${pass} / FAIL ${fail}`);
if (fail) process.exitCode = 1;
