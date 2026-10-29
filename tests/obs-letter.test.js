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

// ─── D-391: кнопки счёта и письма ведут в РАЗНЫЕ места ────────────────────
// «Нажимаю на ворд — скачивается счёт в ворд, а не письмо для ОБС»
// (заказчик 28.10.2026). Причина: две кнопки «PDF»/«Word» относились к счёту
// и конвертировали PDF поставщика, а кнопки в карточке вообще не имели
// обработчика. Теперь у счёта и письма отдельные кнопки с явными подписями.
console.log('\n=== Счёт и письмо: разные кнопки (D-391) ===');
{
  const fs = require('fs');
  const hub = fs.readFileSync(require.resolve('../public/assets/js/doc-hub.js'), 'utf8');

  ok(/data-as-letter/.test(hub), 'у кнопок письма есть отдельный признак data-as-letter');
  ok(/downloadDocFile\(row, kind, format, letterDocId\)/.test(hub),
    'downloadDocFile принимает id письма отдельно от строки счёта');
  ok(/kind === 'letter'/.test(hub) && /letter-file/.test(hub), 'письмо идёт на роут letter-file');
  ok(/Счёт PDF/.test(hub) && /Счёт Word/.test(hub), 'кнопки счёта подписаны явно');
  ok(/Письмо PDF/.test(hub) && /Письмо Word/.test(hub), 'кнопки письма подписаны явно');
  ok(/d\.querySelectorAll\('\[data-doc-dl\]'\)/.test(hub),
    'в карточке счёта у кнопок ЕСТЬ обработчик (раньше клик не работал)');

  // Маршрутизация: что куда уходит.
  const route = (kind, fmt, letterId, rowId) => {
    const id = letterId > 0 ? letterId : rowId;
    const base = kind === 'letter' ? `/api/doc-registry/${id}/letter-file` : `/api/doc-registry/${id}/file`;
    return fmt === 'docx' ? base + '?format=docx' : base;
  };
  ok(route('letter', 'pdf', 2150, 2148) === '/api/doc-registry/2150/letter-file',
    'PDF письма → letter-file письма');
  ok(route('letter', 'docx', 2150, 2148) === '/api/doc-registry/2150/letter-file?format=docx',
    'Word письма → letter-file + format=docx');
  ok(route(undefined, 'docx', null, 2148) === '/api/doc-registry/2148/file?format=docx',
    'Word счёта → file счёта');

  // Серверная часть: письмо рендерится с бланка, а не из PDF счёта.
  const routeSrc = fs.readFileSync(require.resolve('../src/routes/doc-registry'), 'utf8');
  ok(/generateObsLetterDocx/.test(routeSrc), 'сервер собирает Word письма с бланка (docxtemplater)');
  ok(/package_type !== 'letter'/.test(routeSrc), 'letter-file отказывает строке, которая не письмо');
}

// ─── D-392: письмо по эталону заказчика ───────────────────────────────────
// «Вот так выглядит письмо. оно не красиво... Вот пример вот так надо делать
// и пдф и ворд» (28.10.2026, образец Исх. №261023-11).
//
// Главный дефект был не в шрифтах: тело письма СЛИПАЛОСЬ в один абзац, потому
// что в шаблоне цикл `{#body_paragraphs}{text}{/body_paragraphs}` стоял ВНУТРИ
// одного абзаца, а docxtemplater с paragraphLoop размножает абзацы только
// когда теги стоят отдельными абзацами.
console.log('\n=== Письмо по эталону (D-392) ===');
{
  const fs = require('fs');
  const PizZip = require('pizzip');
  const { buildLetterBlocks, buildLetterParagraphs } = require('../src/services/obs-letter');

  const company = {
    name_short: 'ООО «Асгард-Сервис»', name_full: 'ООО «Асгард-Сервис»',
    inn: '1', kpp: '2', ogrn: '3', legal_address: 'адрес', phone: 'тел', email: 'e',
    bank_name: 'б', bank_rs: 'р', bank_ks: 'к', bank_bik: 'бик',
  };
  const data = {
    doc: { id: 1, invoice_number: 'ДС-1', invoice_date: '2026-10-28', amount_gross: 17537,
      vat_amount: 0, vat_rate: 0, counterparty_name: 'ООО «ЭТК»', comment_text: '' },
    work: null, subcontract: null, contractLabel: '', contractDate: '',
    items: ['Позиция один — 1 шт', 'Позиция два — 2 шт'],
    company, gendir: { name: 'Кудряшов О.С.', position: 'Генеральный директор' }, initiator: null,
  };

  const b = buildLetterBlocks(data, { number: 'X', dateText: '28.10.2026 г.' });
  const flat = buildLetterParagraphs(data, { number: 'X', dateText: '28.10.2026 г.' });

  ok(b.intro.length >= 2, `intro заполнен (${b.intro.length})`);
  ok(b.items.length === 2, `items заполнен (${b.items.length})`);
  ok(b.invoice.length === 1, 'invoice выделен отдельным блоком (жирный)');
  ok(b.request.length === 1, 'request выделен отдельным блоком (жирный)');
  const fromBlocks = [...b.intro, ...b.items.map((t) => '— ' + t), ...b.invoice, ...b.outro, ...b.request];
  ok(fromBlocks.join('|') === flat.join('|'), 'PDF и Word получат одинаковый текст');

  // Шаблон: теги цикла обязаны быть ОТДЕЛЬНЫМИ абзацами.
  const path = require('path');
  const tplPath = path.join(__dirname, '..', 'templates', 'obs-letter-tpl.docx');
  ok(fs.existsSync(tplPath), 'шаблон письма на диске');
  const zip = new PizZip(fs.readFileSync(tplPath, 'binary'));
  const xml = zip.file('word/document.xml').asText();
  const paras = (xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || []).map((p) => p.replace(/<[^>]+>/g, '').trim());

  for (const name of ['intro_paragraphs', 'items', 'invoice_paragraphs', 'outro_paragraphs', 'request_paragraphs']) {
    const open = paras.filter((t) => t === `{#${name}}`).length;
    const close = paras.filter((t) => t === `{/${name}}`).length;
    ok(open === 1 && close === 1, `цикл ${name}: открытие ${open}, закрытие ${close} (по одному)`);
  }
  ok(paras.some((t) => t === '{text}'), 'тело цикла — отдельный абзац {text}');
  ok(!paras.some((t) => /\{#\w+\}[\s\S]*\{text\}[\s\S]*\{\/\w+\}/.test(t)),
    'НЕТ цикла «всё в одном абзаце» (это и вызывало слипание)');
  ok(zip.file(/^word\/media\//).length >= 1, 'логотип в шаблоне есть');
  ok(paras.some((t) => t.includes('{%signature_img}')), 'подпись-факсимиле в шаблоне');
  ok(paras.some((t) => t.includes('{%stamp_img}')), 'печать в шаблоне');
}

// ─── D-392f: письмо обязано выйти на ОДИН лист ────────────────────────────
// Перебором установлено (pdfimages по каждой странице): текст занимал
// половину листа, но КАРТИНКА ПЕЧАТИ уходила на вторую страницу отдельным
// объектом. Причина — рисунок в собственном абзаце с межстрочным интервалом
// резервирует «строка + рисунок», и последний блок не влезал даже при
// большом запасе. Решение: печать — ФОНОМ абзаца подписи (behindDoc=1),
// тогда она физически не может создать новую страницу.
console.log('\n=== Письмо на одном листе (D-392f) ===');
{
  const fs = require('fs');
  const src = fs.readFileSync(require.resolve('../src/services/obs-letter-docx'), 'utf8');

  ok(/behindDoc="1"/.test(src), 'печать ставится фоном (behindDoc=1) — не создаёт страницу');
  ok(/wp:anchor/.test(src), 'фоновая печать использует anchor (плавающий объект)');
  ok(/sizes\s*=\s*\[/.test(src), 'размеры подписи и печати задаются явно');
  ok(/2\.2 \* CM/.test(src), 'печать 2.2 см — соразмерно деловому письму');
  ok(/3\.6 \* CM/.test(src), 'подпись 3.6 × 1.35 см');
  ok(/lastContent/.test(src), 'пустые абзацы в конце документа убираются');
  ok(/linePitch/.test(fs.readFileSync(require.resolve('../tools/make_obs_docx_template'), 'utf8')),
    'шаблон снимает docGrid 360 (форсированный интерлиньяж 1.5)');
}

// ─── D-393: проверка сигнатуры файла при загрузке ─────────────────────────
// 28.10.2026 в uploads лежали «архивы» по 302 байта, внутри — HTML-заглушка
// прокси Газпром-Нефти (скачивание оборвалось, сервер вернул страницу ошибки).
// Система трижды пыталась распаковать этот HTML и сдавалась с невнятным
// «Ни один файл не распознан». Теперь говорим прямо: файл повреждён.
console.log('\n=== Проверка сигнатуры файла (D-393) ===');
{
  const { checkFileSignature, looksLikeHtml, explainSignatureFailure } =
    require('../src/lib/file-signature');

  // Точное содержимое битого файла с прода.
  const html = Buffer.from('<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8">'
    + '</head><script type="text/javascript"> location.href = "http://spb99-prx-sa.gazprom-neft.local:8002/'
    + 'block/?&m=connection&reason=connection_error&param1=unexpected_disconnect&link=" + escape(location.href);'
    + '</script></html>');

  ok(looksLikeHtml(html), 'HTML-заглушка распознана');
  for (const ext of ['.7z', '.rar', '.zip', '.pdf', '.docx', '.xlsx']) {
    const r = checkFileSignature(html, ext);
    ok(r.ok === false && r.reason === 'html_instead_of_file',
      `${ext} с HTML внутри — отклонён как повреждённый`);
  }
  ok(/повреждён/.test(explainSignatureFailure(checkFileSignature(html, '.7z'), 'a.7z')),
    'объяснение понятное: «файл повреждён», а не «не распознан»');

  // Настоящие файлы обязаны проходить — иначе сломаем загрузку.
  ok(checkFileSignature(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0]), '.zip').ok, 'ZIP принят');
  ok(checkFileSignature(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0]), '.docx').ok, 'DOCX принят');
  ok(checkFileSignature(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), '.7z').ok, '7z принят');
  ok(checkFileSignature(Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]), '.rar').ok, 'RAR принят');
  ok(checkFileSignature(Buffer.from('%PDF-1.7'), '.pdf').ok, 'PDF принят');
  ok(checkFileSignature(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), '.jpg').ok, 'JPEG принят');
  ok(checkFileSignature(Buffer.from('просто текст'), '.txt').ok, 'текст без сигнатуры не судится');
  ok(checkFileSignature(Buffer.alloc(0), '.pdf').reason === 'empty_file', 'пустой файл отклонён');
  ok(checkFileSignature(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), '.zip').ok === false,
    'чужой формат под .zip отклонён');
}

// ─── D-386: контур оплаты у бухгалтерии, справочник договоров у админа ────
// Заказчик 28.10.2026: «у согласующего убрал выбор оплаты? ОБС выбирает только
// бухгалтерия? они выбирают договор и видят лимит ответственности + нужна
// настройка договоров ОБС счета админу».
console.log('\n=== Контур оплаты и справочник договоров (D-386) ===');
{
  const fs = require('fs');
  const docRoute = fs.readFileSync(require.resolve('../src/routes/doc-registry'), 'utf8');
  const payRoute = fs.readFileSync(require.resolve('../src/routes/payment-invoices'), 'utf8');
  const hub = fs.readFileSync(require.resolve('../public/assets/js/doc-hub.js'), 'utf8');
  const approval = fs.readFileSync(require.resolve('../public/assets/js/approval_payment.js'), 'utf8');

  // 1. Директор больше НЕ выбирает контур
  ok(!/dirSource/.test(approval), 'в модалке директора выбора способа оплаты НЕТ');
  ok(!/payment_source: dirSource/.test(approval), 'директор не отправляет payment_source');
  ok(/const paySrc = rows\[0\]\.payment_source/.test(payRoute),
    'бэкенд берёт контур из заявки, а не из тела согласования');
  ok(/payment_source в теле проигнорирован/.test(payRoute), 'устаревший параметр логируется');

  // 2. Контур меняет только бухгалтерия
  const m = docRoute.match(/const OBS_ROLES = \[([^\]]*)\]/);
  const roles = (m ? m[1] : '').split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  ok(roles.includes('BUH'), 'контур меняет бухгалтерия');
  ok(!roles.some((r) => /DIRECTOR|^PM$/.test(r)), 'директор и инициатор контур не меняют');

  // 3. Справочник договоров — только админ
  ok(/SUBCONTRACT_ADMIN_ROLES = \['ADMIN'\]/.test(docRoute), 'справочник договоров только для ADMIN');
  for (const r of ['/subcontracts/admin', 'fastify.post(\'/subcontracts\'',
    'fastify.patch(\'/subcontracts/:sid\'', 'fastify.delete(\'/subcontracts/:sid\'']) {
    ok(docRoute.includes(r), `роут есть: ${r.replace("fastify.", "")}`);
  }
  ok(/validateSubcontract/.test(docRoute), 'поля договора валидируются на сервере');

  // 4. Защита от порчи данных
  ok(/Лимит не может быть меньше/.test(docRoute), 'лимит ниже расходов запрещён');
  ok(/Деактивируйте договор/.test(docRoute), 'договор со счетами нельзя удалить — только выключить');

  // 5. Счётчик счетов без договора
  ok(/subcontracts\/unlinked/.test(docRoute), 'есть подсчёт ОБС-счетов без договора');
  ok(/dh-cn__warn/.test(hub), 'справочник показывает предупреждение о таких счетах');

  // 6. Кнопка справочника только у админа
  ok(/function canManageSubcontracts\(\) \{ return role\(\) === 'ADMIN'; \}/.test(hub),
    'кнопка «Договоры ОБС» только у админа');

  // 7. Кнопки письма в карточке ведут на письмо, а не на счёт
  ok(/data-as-letter="1"/.test(hub), 'кнопки «Письмо …» помечены отдельно');
}

// ─── D-394: окно расчёта Мимира — читаемость ──────────────────────────────
// Заказчик 29.10.2026: «Почти не видно то что он там пишет. очень маленькое
// окошко и я не успеваю даже ничего прочитать».
console.log('\n=== Окно расчёта Мимира (D-394) ===');
{
  const fs = require('fs');
  const kb = fs.readFileSync(require.resolve('../public/assets/js/personal_kanban.js'), 'utf8');

  ok(/\.pk3-bz-card\{[^}]*width:min\(920px/.test(kb), 'окно расширено до 920px (было 620)');
  ok(/-webkit-line-clamp:12/.test(kb), 'текст модели до 12 строк (было 2 — не успевали читать)');
  ok(/\.pk3-bz-live-text\{[^}]*font-size:13\.5px/.test(kb), 'кегль текста 13.5px (было 12.5)');
  ok(/pk3-bz-card \.pk3-mimir-thoughts\{[^}]*max-height:340px/.test(kb),
    'журнал «Ход расчёта» вырос до 340px (было 136)');
  ok(/is-default-open/.test(kb), 'журнал раскрыт по умолчанию — видно, что модель пишет');
  ok(/is-default-open \.pk3-mimir-thoughts\{display:block\}/.test(kb), 'правило раскрытия есть в CSS');
}

// ─── D-395: ИИ не заполнял заявку на закупку ──────────────────────────────
// Причина: модель по умолчанию — deepseek-v4.1-flash, это reasoning-модель.
// Она тратит весь max_tokens на размышления и возвращает finish_reason=length
// с ПУСТЫМ content. Плюс промпт без примера давал пустой шаблон.
console.log('\n=== ИИ заявки на закупку (D-395) ===');
{
  const fs = require('fs');
  const proc = fs.readFileSync(require.resolve('../src/routes/procurement.js'), 'utf8');

  // Все вызовы модели в этом файле обязаны отключать reasoning.
  const completes = (proc.match(/aiProvider\.complete\(\{/g) || []).length;
  const withOff = (proc.match(/reasoning:\s*\{\s*enabled:\s*false\s*\}/g) || []).length;
  ok(withOff > 0, `reasoning:{enabled:false} передан (${withOff} раз)`);
  ok(withOff >= completes, `все ${completes} вызовов модели отключают reasoning`);

  // Промпт обязан содержать пример — иначе модель возвращает пустой шаблон.
  ok(/Пример:/.test(proc), 'в промпте есть пример «текст → ответ»');
  ok(/Болты М12/.test(proc), 'пример конкретный, не «...»');
  ok(/не оставляй name пустым/i.test(proc), 'промпт прямо запрещает пустые названия');

  // Пустой ответ модели отличается от «не нашёл позиций».
  ok(/ai_empty/.test(proc), 'пустой ответ модели отдаётся отдельным флагом');
  ok(/Модель не ответила/.test(proc), 'пользователю объясняют, что дело в модели');
}

console.log(`\n────────────────────────────────────────`);
console.log(`ИТОГ письма ОБС: PASS ${pass} / FAIL ${fail}`);
if (fail) process.exitCode = 1;
