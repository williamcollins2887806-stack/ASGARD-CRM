'use strict';
/**
 * D-369 (23.10.2026): тесты мобильной страницы «Мои заявки».
 * Проверяем ГЛАВНОЕ: мобилка показывает то же, что десктоп, и не теряет поля.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`PASS  ${name}`); pass++; }
  catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); fail++; }
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

console.log('=== 1. Миграция: 4 колонки, идемпотентно ===');
const mig = read('migrations/V436__payment_invoice_spend_fields.sql');
t('spend_kind добавлен', () => assert.ok(/ADD COLUMN IF NOT EXISTS spend_kind/.test(mig)));
t('sf_due_at добавлен', () => assert.ok(/ADD COLUMN IF NOT EXISTS sf_due_at/.test(mig)));
t('service_done_at добавлен', () => assert.ok(/ADD COLUMN IF NOT EXISTS service_done_at/.test(mig)));
t('sf_basis добавлен', () => assert.ok(/ADD COLUMN IF NOT EXISTS sf_basis/.test(mig)));
t('CHECK на допустимые виды расхода', () => assert.ok(/chk_payment_invoices_spend_kind/.test(mig)));
t('CHECK на основание СФ', () => assert.ok(/chk_payment_invoices_sf_basis/.test(mig)));

console.log('\n=== 2. Десктоп: поля больше не теряются ===');
const batch = read('public/assets/js/procurement-batch.js');
t('draftPayload содержит spend_kind', () => assert.ok(/spend_kind:/.test(batch)));
t('draftPayload содержит sf_due_at', () => assert.ok(/sf_due_at:\s*f\.sf_due_at/.test(batch)));
t('draftPayload содержит service_done_at', () => assert.ok(/service_done_at:\s*f\.service_done_at/.test(batch)));
t('draftPayload содержит sf_basis', () => assert.ok(/sf_basis:/.test(batch)));
t('spend_kind валидируется белым списком', () => {
  assert.ok(/spend_kind.*\['work', 'warehouse', 'office', 'other'\]/.test(batch));
});

console.log('\n=== 3. Бэкенд: приём и перенос в реестр ===');
const pi = read('src/routes/payment-invoices.js');
t('PATCH принимает spend_kind', () => assert.ok(/'spend_kind', 'sf_due_at', 'service_done_at', 'sf_basis'/.test(pi)));
t('POST пишет spend_kind', () => assert.ok(/spend_kind, sf_due_at, service_done_at, sf_basis/.test(pi)));
t('при submit переносит в doc_registry', () => assert.ok(/перенос spend_kind\/сроков/.test(pi)));
// ДЕФЕКТ D-369, который верификатор нашёл в первой версии: doc_registry.spend_kind
// объявлен NOT NULL DEFAULT 'work', поэтому COALESCE(NULLIF(d.spend_kind,''), $3)
// НИКОГДА не применял новое значение. Тест должен требовать прямого присваивания.
t('spend_kind применяется напрямую, а не через COALESCE по старому значению', () => {
  // Логика переехала из роута в services/payment-mail.js::applyInvoiceFields —
  // теперь её используют и /submit, и ensureRegistryDoc (одно поведение).
  const pm = read('src/services/payment-mail.js');
  assert.ok(/spend_kind\s*=\s*COALESCE\(\$2,\s*d\.spend_kind\)/.test(pm),
    'должно быть COALESCE($2, d.spend_kind) — новое значение главнее');
  assert.ok(!/spend_kind\s*=\s*COALESCE\(NULLIF\(d\.spend_kind,''\),\s*\$3\)/.test(pm),
    'старая формула не работает: колонка NOT NULL DEFAULT work');
});
t('OFFICE_MANAGER и WAREHOUSE могут создавать счёт', () => {
  assert.ok(/CREATE_ROLES[\s\S]{0,260}'OFFICE_MANAGER',\s*'WAREHOUSE'/.test(pi),
    'иначе мастер даёт 403 на каждом шаге');
});
t('BUH может подать счёт (страница у него открыта)', () => {
  const line = pi.split('\n').find((l) => /const CREATE_ROLES/.test(l))
    || pi.split('\n').slice(0, 40).join('\n');
  const block = pi.match(/const CREATE_ROLES = \[[\s\S]{0,300}?\];/);
  assert.ok(block && /'BUH'/.test(block[0]), 'у BUH кнопка «Загрузить счёт» даёт 403');
});
// ГЛАВНЫЙ СКВОЗНОЙ ТЕСТ. Строка в /submit бесполезна, потому что у черновика
// doc_registry_id = null: строку реестра создаёт ensureRegistryDoc ПОСЛЕ
// согласования. Значит вид расхода обязан проставляться там, а не литералом.
t('ensureRegistryDoc пишет spend_kind из заявки, а не литерал other', () => {
  const pm = read('src/services/payment-mail.js');
  assert.ok(/const sk = String\(pay\.spend_kind \|\| ''\)/.test(pm),
    'ensureRegistryDoc не читает pay.spend_kind');
  assert.ok(/spendKind/.test(pm), 'нет переменной spendKind');
  assert.ok(!/false,'other',\$4/.test(pm), 'литерал \'other\' в INSERT остался — офисный счёт попадёт в «прочее»');
  assert.ok(/\$9,/.test(pm), 'spendKind не передан в INSERT');
});
t('перенос полей работает во ВСЕХ ветках (связана/есть doc_registry_id/антидубль)', () => {
  const pm = read('src/services/payment-mail.js');
  // Считаем вызовы applyInvoiceFields: их должно быть >= 4 (3 «уже есть» + создание)
  const calls = (pm.match(/applyInvoiceFields\(db, pay, /g) || []).length;
  assert.ok(calls >= 3, `applyInvoiceFields вызван ${calls} раз, нужно минимум 3 (все ветки «уже есть строку»)`);
  assert.ok(/async function applyInvoiceFields/.test(pm), 'нет самой функции переноса');
});
t('в реестр переносятся номер, дата, НДС и нетто', () => {
  const pm = read('src/services/payment-mail.js');
  assert.ok(/invoice_number\s*=\s*COALESCE\(NULLIF\(d\.invoice_number,''\), \$7\)/.test(pm),
    'номер счёта не переносится — бухгалтерия не сверит счёт');
  assert.ok(/vat_amount\s*=\s*CASE WHEN/.test(pm), 'НДС не переносится (было 0)');
  assert.ok(/amount_net\s*=\s*CASE WHEN/.test(pm), 'нетто не переносится (было = брутто)');
  assert.ok(/invoice_number, invoice_date,/.test(pm), 'INSERT не передаёт номер/дату');
  assert.ok(/\$4, \$5, \$6, \$7, \$8, \$9,/.test(pm), 'INSERT не передаёт суммы/НДС параметрами');
});
t('причины no_invoice_number ставятся по факту, а не константой', () => {
  const pm = read('src/services/payment-mail.js');
  assert.ok(/if \(!pay\.invoice_number\) reasons\.push\('no_invoice_number'\)/.test(pm),
    'метка «нет номера» ставится даже когда номер есть');
  assert.ok(!/reasons = \['no_invoice_number', 'no_invoice_date'\]/.test(pm),
    'константный массив причин остался');
});
t('метка no_work_for_expense только для работ (не для склада/прочего)', () => {
  const pm = read('src/services/payment-mail.js');
  const pi2 = read('src/routes/payment-invoices.js');
  assert.ok(/if \(spendKind === 'work' && !pay\.work_id\) reasons\.push\('no_work_for_expense'\)/.test(pm)
    || /if \(effKind === 'work' && !row\.work_id/.test(pm),
    'метка ставится не только работам');
  assert.ok(!/COALESCE\(d\.spend_kind,''\) <> 'office'/.test(pi2),
    'старое правило «всем кроме office» осталось — склад получает ложную метку');
});
t('снятие флага не падает на NOT NULL (нет NULLIF по array_agg)', () => {
  // Логика переехала в services/payment-mail.js::applyInvoiceFields, где причины
  // теперь пишутся целиком ($2::text[]), а не через array_agg.
  const pm = read('src/services/payment-mail.js');
  const code = pm.split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  assert.ok(!/NULLIF\(\s*array_agg\(x\),\s*'\{\}'\)/.test(code),
    'NULLIF(array_agg(...),\'{}\') возвращает NULL → 23502 на NOT NULL колонке');
  assert.ok(/incomplete_reasons\s*=\s*\$2::text\[\]/.test(code),
    'причины должны писаться массивом напрямую (пустой массив вместо NULL)');
});
t('/submit использует единую applyInvoiceFields, а не свою копию', () => {
  const pi2 = read('src/routes/payment-invoices.js');
  assert.ok(/applyInvoiceFields\(db, pay, docId\)/.test(pi2), 'submit не вызывает общую функцию');
  assert.ok(!/перенос spend_kind\/сроков[\s\S]{0,300}SET spend_kind/.test(pi2),
    'дублирующий UPDATE spend_kind в submit остался — он расходится с ensureRegistryDoc');
});
t('ИНН сохраняется (колонка + FIELDS)', () => {
  const pi2 = read('src/routes/payment-invoices.js');
  assert.ok(/ADD COLUMN IF NOT EXISTS counterparty_inn/.test(mig));
  assert.ok(/'counterparty_inn'\]/.test(pi2), 'PATCH не принимает ИНН');
});
t('в списке FIELDS нет дублей (иначе PostgreSQL 42601)', () => {
  const pi2 = read('src/routes/payment-invoices.js');
  const block = pi2.match(/const FIELDS = \[[\s\S]*?\];/);
  assert.ok(block, 'не найден блок FIELDS');
  const names = (block[0].match(/'[a-z_]+'/g) || []).map((s) => s.replace(/'/g, ''));
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  assert.deepStrictEqual(dupes, [],
    `дубликаты в FIELDS: ${dupes.join(', ')} — PostgreSQL падает с «multiple assignments to same column»`);
});
t('vat_rate при null не роняет INSERT (колонка NOT NULL)', () => {
  const pm = read('src/services/payment-mail.js');
  assert.ok(!/pay\.vat_rate != null \? Number\(pay\.vat_rate\) : null/.test(pm),
    'vat_rate=null валит вставку 23502 → согласование молча не создаёт строку реестра');
});
// ДЕФЕКТ, найденный верификатором в раунде 4: ставка в payment_invoices —
// ПРОЦЕНТЫ (22), а в doc_registry — ДОЛИ (0.22). Без конвертации Doc Hub
// показывал «НДС 2200%» и пересчитывал нетто 120000 → 5217.
t('ставка НДС конвертируется в доли для реестра', () => {
  const pm = read('src/services/payment-mail.js');
  assert.ok(/function toRegistryVatRate/.test(pm), 'нет функции нормализации ставки');
  assert.ok(/n > 1 \? n \/ 100 : n/.test(pm), 'нет конвертации проценты → доли');
  // Оба места записи должны её использовать.
  const uses = (pm.match(/toRegistryVatRate\(pay\.vat_rate\)/g) || []).length;
  assert.ok(uses >= 2, `конвертация применена ${uses} раз, нужна и в INSERT, и в applyInvoiceFields`);
  assert.ok(!/pay\.vat_rate != null \? Number\(pay\.vat_rate\) : 0,/.test(pm),
    'в INSERT пишутся проценты вместо долей');
});
t('причины неполноты пересчитываются по факту, а не точечно', () => {
  const pm = read('src/services/payment-mail.js');
  assert.ok(/function computeInvoiceReasons/.test(pm), 'нет единой функции расчёта причин');
  assert.ok(/const OWNED = \['no_invoice_number'/.test(pm),
    'нет пересчёта: старые причины остаются при заполненных полях');
  assert.ok(/incomplete_reasons=\$2::text\[\], is_incomplete=\$3/.test(pm),
    'причины не записываются целиком');
  assert.ok(/no_amount/.test(pm), 'нулевая сумма не помечается (в словаре UI есть no_amount)');
});t('POST / сохраняет НДС сразу (не только через PATCH)', () => {
  const pi2 = read('src/routes/payment-invoices.js');
  assert.ok(/\$25::numeric, \$26::numeric, \$27::numeric/.test(pi2),
    'INSERT в POST не принимает vat_amount/vat_rate/amount_net');
  assert.ok(/b\.vat_amount != null \? Number\(b\.vat_amount\) : null/.test(pi2));
});
// ДЕФЕКТ раунда 5 (деньги): в ветках «уже есть строка» не переносилась
// БРУТТО-СУММА. На проде заявка #19 = 114 737,70, карточка 139 980,00 —
// расхождение 25 242 ₽. Бухгалтерия платит по карточке.
t('брутто-сумма заполняется, если в карточке пусто', () => {
  const pm = read('src/services/payment-mail.js');
  assert.ok(/amount_gross\s*=\s*CASE WHEN/.test(pm),
    'amount_gross не в SET — карточка останется с чужой суммой');
  assert.ok(/\$14::numeric, d\.amount_gross\)/.test(pm), 'нет параметра новой суммы');
});
t('пустая карточка получает net/vat, разложенные по ставке', () => {
  const pm = read('src/services/payment-mail.js');
  // Расчёт живёт в ЕДИНОЙ функции splitInvoiceAmounts (раунд 12): раньше копии
  // в создании и переносе разъезжались, и форма #13 лечилась только в одной ветке.
  assert.ok(/function splitInvoiceAmounts/.test(pm), 'нет единой функции расчёта сумм');
  assert.ok(/gross \* rate \/ \(1 \+ rate\)/.test(pm), 'формула НДС «в том числе» отсутствует');
  // Обе ветки обязаны её использовать.
  const uses = (pm.match(/splitInvoiceAmounts\(pay\)/g) || []).length;
  assert.ok(uses >= 2, `splitInvoiceAmounts вызван ${uses} раз — нужен и в создании, и в переносе`);
  assert.ok(/const amounts = splitInvoiceAmounts\(pay\)/.test(pm),
    'ветка создания не использует единый расчёт');
});
t('несогласованность amount vs net+vat внутри заявки диагностируется', () => {
  const pm = read('src/services/payment-mail.js');
  // Живой #14: amount 5654 при НДС 98278.68 — карточка выглядела «заполненной».
  assert.ok(/Math\.abs\(g - \(n \+ \(Number\.isFinite\(v\) \? v : 0\)\)\) >= 0\.02/.test(pm),
    'computeInvoiceReasons не сверяет amount с net+vat');
});
t('несогласованность в самой карточке тоже ловится', () => {
  const pm = read('src/services/payment-mail.js');
  assert.ok(/const cardMismatch =/.test(pm), 'нет проверки карточки после переноса');
  assert.ok(/amount_net, vat_amount,/.test(pm), 'SELECT не читает суммы карточки');
});
t('«отравленная» карточка (gross>0, net=0 или net=gross) лечится', () => {
  const pm = read('src/services/payment-mail.js');
  // Было: SET под условием gross=0 → блок не выполнялся; cardMismatch требовал
  // cn > 0 → метки не было. Строка «45 197 брутто, 0 нетто, ставка 22 %» зелёная.
  // Второй случай — #1598: нетто = брутто, НДС 0, ставка 22 %.
  assert.ok(/COALESCE\(d\.amount_net,0\) IN \(0, d\.amount_gross\)\s*\n\s*AND COALESCE\(d\.vat_amount,0\) < d\.amount_gross/.test(pm),
    'старая карточка с нулевым/равным нетто не заполняется');
  assert.ok(/Number\(row\.amount_net\) \|\| 0/.test(pm),
    'cardMismatch требует net > 0 и молчит на net = 0');
  assert.ok(!/Number\.isFinite\(cn\) && cn > 0/.test(pm), 'условие cn > 0 осталось');
  assert.ok(/Math\.abs\(payNet - grossForSplit\) < 0\.02/.test(pm),
    'нет ветки «нетто = брутто, НДС 0, ставка задана» (#1598)');
});
t('quote_only_reply переведён', () => {
  const hub = read('public/assets/js/doc-hub.js');
  assert.ok(/quote_only_reply:/.test(hub), 'используется в проде, но показывается «требует проверки»');
});
// D-370: сквозной прогон нашёл, что POST / заводил карточку поставщика из
// заглушки «Распознаётся…», и ВСЕ счета с неустановленным контрагентом
// привязывались к ней: в платёжке оказывались реквизиты чужого поставщика.
t('заглушка «Распознаётся…» не создаёт карточку поставщика', () => {
  const sr = read('src/services/supplier-resolve.js');
  assert.ok(/распозна\[её\]тся/i.test(sr), 'нет отсева заглушки');
  assert.ok(/reason:\s*'stub_name'/.test(sr), 'нет понятной причины отказа');
  const pi = read('src/routes/payment-invoices.js');
  assert.ok(/const isStubSupplier =/.test(pi), 'POST / не отсеивает заглушку');
  assert.ok(/!pay\.supplier_id && !isStubSupplier/.test(pi), 'условие не применяется');
});
t('ИНН из распознавания пишется в карточку заявки', () => {
  const pi = read('src/routes/payment-invoices.js');
  assert.ok(/setIf\('counterparty_inn', String\(parsed\.inn\)\)/.test(pi),
    'ИНН остаётся только в suppliers, в заявке пусто');
});
t('мусорная привязка поставщика перепривязывается при распознавании', () => {
  const pi = read('src/routes/payment-invoices.js');
  assert.ok(/stale && sup\.id !== pay\.supplier_id/.test(pi),
    'счёт навсегда останется с поставщиком-заглушкой');
});
t('preview принимает токен и заголовком, и в query', () => {
  const pi = read('src/routes/payment-invoices.js');
  assert.ok(/req\.headers\.authorization/.test(pi), 'preview не читает Authorization');
  assert.ok(/Bearer /.test(pi), 'не разбирает Bearer');
});
t('дубль счёта получает свою строку реестра, а не падает', () => {
  const pm = read('src/services/payment-mail.js');
  // uq_pi_doc_registry: одна строка обслуживает одну заявку. При дубле
  // нужна своя строка, иначе заявка уходит к бухгалтерии без документа.
  assert.ok(/dupWasTaken/.test(pm), 'нет обработки занятой строки');
  assert.ok(/ON CONFLICT DO NOTHING/.test(pm), 'INSERT не защищён от дедупа');
  assert.ok(/insertNumber/.test(pm), 'номер не уточняется — дедуп-индекс не пустит');
});
// D-370: мобильный мастер должен показывать историю по контрагенту.
t('мобилка показывает счётчики контрагента и предупреждения', () => {
  const wiz = read('public/mobile-app/src/pages/my-requests/InvoiceUploadSheet.jsx');
  assert.ok(/loadCard/.test(wiz), 'нет загрузки карточки контрагента');
  assert.ok(/docs_count/.test(wiz) && /contracts_count/.test(wiz), 'нет счётчиков');
  assert.ok(/нет в базе СРМ/.test(wiz), 'нет предложения создать карточку');
  assert.ok(/договора в базе нет/.test(wiz), 'нет предупреждения о договоре');
});
t('десктопный поиск договоров идёт на существующий эндпоинт', () => {
  const batch = read('public/assets/js/procurement-batch.js');
  assert.ok(!/api\/contracts\?/.test(batch), '/api/contracts не существует (404)');
  assert.ok(/contract-search/.test(batch), 'не используется рабочий эндпоинт');
});
t('частичные суммы лечатся (net = gross − vat)', () => {
  const pm = read('src/services/payment-mail.js');
  // Реальная форма заявки #13: amount 45197.04 / net NULL / vat 8150.29.
  assert.ok(/vat > 0 && net === 0/.test(pm), 'нет ветки частичных сумм');
  assert.ok(/net = Math\.round\(\(gross - vat\) \* 100\) \/ 100/.test(pm),
    'нетто не считается как «сумма минус НДС»');
});
t('счёт без НДС не получает ложную метку (регрессия R14)', () => {
  const pm = read('src/services/payment-mail.js');
  // Условие должно быть СТРОГО «больше»: при net = gross, vat = 0, rate = NULL
  // это обычный счёт без НДС, и метка «сумма расходится» — ложный шум
  // (на проде 8 таких счетов, 6 активных).
  assert.ok(!/net >= gross - 0\.02 && vat === 0/.test(pm),
    'нестрогое условие ловит корректные счета без НДС');
});
t('форма #1598 всё ещё раскладывается по ставке', () => {
  const pm = read('src/services/payment-mail.js');
  // Ветка «net > gross» не должна перехватывать net = gross: иначе
  // rate>0, net=gross, vat=0 только помечается, и НДС не выделяется
  // (регрессия 14 прод-карточек из раундов 10-11).
  const bad = pm.indexOf('net > gross + 0.02');
  const good = pm.indexOf('Math.abs(net - gross) < 0.02');
  assert.ok(bad > 0 && good > 0 && bad < good, 'порядок веток должен быть: битое → раскладка #1598');
});
t('метки не дублируются в ветке создания', () => {
  const pm = read('src/services/payment-mail.js');
  assert.ok(/if \(amounts\.miscalc && !reasons\.includes\('amount_mismatch'\)\)/.test(pm),
    'amount_mismatch добавится второй раз → «сумма расходится…, сумма расходится…»');
  assert.ok(/\[\.\.\.new Set\(computeInvoiceReasons/.test(pm), 'нет дедупликации причин');
});
t('нетто больше суммы не даёт отрицательного НДС', () => {
  const pm = read('src/services/payment-mail.js');
  // Раунд 13: net > gross → vat = gross − net = −1000 и это ЗАПИСЫВАЛОСЬ в БД
  // (CHECK на неотрицательность нет, а по vat_amount считаются агрегаты вычета).
  assert.ok(/net > gross \+ 0\.02 && vat === 0/.test(pm),
    'нет защиты от нетто больше суммы');
});
t('правка суммы пересчитывает net/vat (мобилка и десктоп)', () => {
  const wiz = read('public/mobile-app/src/pages/my-requests/InvoiceUploadSheet.jsx');
  const batch = read('public/assets/js/procurement-batch.js');
  assert.ok(/if \(fields\.vat_rate != null && v > 0\)/.test(wiz),
    'мобилка: правка суммы не пересчитывает net/vat — нетто останется от старой суммы');
  assert.ok(/k === 'amount' && it\.fields\.vat_rate != null/.test(batch),
    'десктоп: та же проблема');
});
t('нетто есть, НДС нет, ставка задана → НДС = сумма − нетто', () => {
  const pm = read('src/services/payment-mail.js');
  // Раунд 12: форма net=50000, vat=0, rate=22, gross=79905 не обрабатывалась —
  // Doc Hub дорисовывал НДС, и на одну строку было три разных набора чисел.
  assert.ok(/vat = Math\.round\(\(gross - net\) \* 100\) \/ 100/.test(pm),
    'нет ветки «НДС = сумма − нетто»');
});
t('все формы считаются ЕДИНОЙ функцией (4 ветки)', () => {
  const pm = read('src/services/payment-mail.js');
  // splitInvoiceAmounts используется и в создании, и в переносе (перенос
  // обслуживает 3 ветки: linked / doc_registry_id / антидубль).
  const uses = (pm.match(/splitInvoiceAmounts\(pay\)/g) || []).length;
  assert.ok(uses >= 2, `вызовов ${uses}, нужен минимум 2`);
});
t('отрицательного нетто не бывает (НДС больше суммы)', () => {
  const pm = read('src/services/payment-mail.js');
  // Было: netFromRate = gross − vat без ограничения → −92 624,68 при сумме
  // 5 654 и НДС 98 278,68. CHECK на неотрицательность в doc_registry нет.
  assert.ok(/vat >= gross/.test(pm), 'нет защиты от НДС больше суммы');
  assert.ok(/miscalc = true/.test(pm), 'случай не помечается');
  assert.ok(/Math\.max\(0, Number\(pay && pay\.amount_net\) \|\| 0\)/.test(pm),
    'нетто не ограничено снизу нулём');
});
t('has_vat не ставится без суммы НДС', () => {
  const pm = read('src/services/payment-mail.js');
  // Было: флаг включался, а vat_amount не заполнялась → #1598 имела
  // has_vat=true при vat_amount=0, и Doc Hub дорисовывал 14 409 ₽ НДС.
  assert.ok(/WHEN COALESCE\(d\.vat_amount,0\) > 0 THEN d\.has_vat/.test(pm),
    'флаг НДС не сверяется с фактической суммой');
});
t('has_vat учитывает НДС, вычисленный по ставке', () => {
  const pm = read('src/services/payment-mail.js');
  assert.ok(/COALESCE\(\$16::numeric,0\) > 0/.test(pm),
    'has_vat=false при выделенном НДС — противоречивая карточка');
});
t('мёртвого isGrossAmount нет', () => {
  const pm = read('src/services/payment-mail.js');
  assert.ok(!/function isGrossAmount/.test(pm), 'остался код отброшенного подхода');
});
t('метки amount_mismatch / items_sum_mismatch переведены в UI', () => {
  const hub = read('public/assets/js/doc-hub.js');
  assert.ok(/amount_mismatch:\s*.сумма расходится/.test(hub),
    'бухгалтер увидит «требует проверки» вместо «сумма расходится с заявкой»');
  assert.ok(/items_sum_mismatch:/.test(hub), 'метка items_sum_mismatch не переведена');
});
t('net/vat пересчитываются вместе с brutto (иначе net+vat ≠ gross)', () => {
  const pm = read('src/services/payment-mail.js');
  // Условие лечения (нулевой/равный нетто при ненулевой сумме) должно быть
  // и в amount_net, и в vat_amount — иначе одна колонка обновится без другой.
  const cond = /COALESCE\(d\.amount_net,0\) IN \(0, d\.amount_gross\)\s*\n\s*AND COALESCE\(d\.vat_amount,0\) < d\.amount_gross/;
  const netBlock = pm.slice(pm.indexOf('amount_net      = CASE WHEN'), pm.indexOf('vat_amount      = CASE WHEN'));
  const vatBlock = pm.slice(pm.indexOf('vat_amount      = CASE WHEN'), pm.indexOf('vat_rate        ='));
  assert.ok(cond.test(netBlock), 'условие лечения нетто отсутствует');
  assert.ok(cond.test(vatBlock), 'условие лечения НДС отсутствует — колонки разойдутся');
});
t('заполненная сумма карточки не перезаписывается (кейс #19)', () => {
  const pm = read('src/services/payment-mail.js');
  const grossLine = pm.slice(pm.indexOf('amount_gross    = CASE WHEN'),
    pm.indexOf('amount_net      = CASE WHEN'));
  // На #19 в заявке лежало нетто (114 737,70), в карточке верное брутто
  // (139 980,00). Поэтому gross заполняется ТОЛЬКО при нуле в карточке —
  // никаких OR-веток, иначе занижение на сумму НДС.
  assert.ok(/COALESCE\(d\.amount_gross,0\) = 0/.test(grossLine), 'нет условия «только если пусто»');
  assert.ok(!/OR/.test(grossLine), 'в условии для gross появилась OR-ветка — риск занижения');
});
t('расхождение суммы с заявкой помечается, а не теряется', () => {
  const pm = read('src/services/payment-mail.js');
  assert.ok(/amount_mismatch/.test(pm), 'нет метки расхождения — бухгалтер не узнает о разнице');
  assert.ok(/const mismatch =/.test(pm));
});
t('ставка НДС валидируется белым списком (400, не 500)', () => {
  const pi2 = read('src/routes/payment-invoices.js');
  assert.ok(/const VALID_VAT_RATES = \[0, 5, 7, 10, 20, 22\]/.test(pi2), 'нет белого списка ставок');
  assert.ok(/'Недопустимая ставка НДС'/.test(pi2), 'нет понятной ошибки вместо 500');
});
t('валидация ставки применяется И в POST, И в PATCH', () => {
  const pi2 = read('src/routes/payment-invoices.js');
  const calls = (pi2.match(/validateVatRate\(b\.vat_rate\)/g) || []).length;
  assert.ok(calls >= 2, `validateVatRate вызван ${calls} раз — нужен и в POST, и в PATCH`);
});
// ДЕФЕКТ раунда 6 (деньги): безусловная перезапись суммы затирала правильную.
// Живой случай #19: в заявке 114 737,70 (НЕТТО из PDF), в карточке верно
// 139 980,00 (БРУТТО из строки «Всего на сумму»). Перезапись занижала на НДС.
t('причины считаются ЕДИНОЙ функцией (нет копии условий)', () => {
  const pm = read('src/services/payment-mail.js');
  const calls = (pm.match(/computeInvoiceReasons\(/g) || []).length;
  assert.ok(calls >= 3, `computeInvoiceReasons вызывается ${calls} раз (определение + 2 места)`);
});
t('десктопный openDraft восстанавливает поля мобилки', () => {
  assert.ok(/spend_kind: d\.spend_kind/.test(batch), 'вид расхода угадывается и затирается');
  assert.ok(/comment_text: d\.comment_text/.test(batch), 'комментарий теряется при пересохранении');
  assert.ok(/sf_due_at: d\.sf_due_at/.test(batch));
  assert.ok(/service_done_at: d\.service_done_at/.test(batch));
});
t('OFFICE_MANAGER и WAREHOUSE могут открыть скан', () => {
  assert.ok(/FILE_ROLES[\s\S]{0,300}'OFFICE_MANAGER',\s*'WAREHOUSE'/.test(pi));
});
t('GET /my возвращает decoratePayment (has_file/file_url/status_label)', () => {
  assert.ok(/res\.items\.map\(\(x\) => decoratePayment\(x\)\)/.test(pi),
    'без этого на десктопе пропали «Скачать счёт» и подпись статуса');
});
t('есть рабочий поиск договоров (contract-search)', () => {
  assert.ok(/fastify\.get\('\/contract-search'/.test(pi), 'эндпоинт /api/contracts не существует — 404');
});
t('баг с двумя операторами на одной строке исправлен', () => {
  assert.ok(!/contract_id'\];\s*const sets/.test(pi));
});
t('миграция добавляет comment_text (PATCH падал 503)', () => {
  assert.ok(/ADD COLUMN IF NOT EXISTS comment_text/.test(mig));
});

console.log('\n=== 4. Сервис my-invoices: единый источник ===');
const svc = read('src/services/my-invoices.js');
t('привилегированные роли видят всё', () => assert.ok(/seesAllInvoices/.test(svc)));
t('all=1 уважается только для привилегированных', () => {
  assert.ok(/opts\.all && privileged/.test(svc));
});
t('этапы совпадают с десктопом', () => {
  for (const code of ['dir', 'buh', 'paid', 'rejected', 'draft']) {
    assert.ok(svc.includes(`'${code}'`), `этап ${code} отсутствует`);
  }
});
t('KPI считает плитки, которые мобилка рисует', () => {
  for (const k of ['total', 'dir', 'buh', 'paid', 'draft']) assert.ok(new RegExp(`${k}:`).test(svc));
});
t('мёртвого urgent в KPI нет', () => {
  assert.ok(!/urgent: urgent\.length/.test(svc),
    'initiator_intent не выставляется нигде — KPI всегда был бы 0');
});
t('lines_count добирается из line_items_json у черновиков', () => {
  assert.ok(/line_items_json/.test(svc) && /lines = x\.line_items_json\.length/.test(svc));
});

console.log('\n=== 5. Роут /api/my-requests ===');
const rt = read('src/routes/my-requests.js');
t('роли совпадают с десктопным /my-procurement', () => {
  for (const r of ['PM', 'HEAD_PM', 'WAREHOUSE', 'ADMIN', 'PROC', 'TO', 'HEAD_TO', 'BUH', 'OFFICE_MANAGER',
    'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV']) {
    assert.ok(rt.includes(`'${r}'`), `роль ${r} отсутствует`);
  }
});
t('отдаёт invoices и purchases', () => assert.ok(/invoices,/.test(rt) && /purchases,/.test(rt)));
t('403 для чужих ролей', () => assert.ok(/403.*Нет доступа/.test(rt)));
t('закупки сужаются по роли (READ_ALL)', () => assert.ok(/READ_ALL = \[/.test(rt)));
t('ошибка закупок не валит страницу', () => assert.ok(/purchases = \{ items: \[\], total: 0, available: true, error: true \}/.test(rt)));

console.log('\n=== 6. Мобилка: страница и регистрация ===');
const page = read('public/mobile-app/src/pages/MyRequests.jsx');
const app = read('public/mobile-app/src/App.jsx');
const rbac = read('public/mobile-app/src/config/rbac.js');
const more = read('public/mobile-app/src/pages/More.jsx');
const nav = read('tools/verify-mobile-nav.js');

t('страница обращается к /my-requests', () => assert.ok(/api\.get\('\/my-requests'/.test(page)));
t('две вкладки: счета и закупки', () => {
  assert.ok(/Счета на согласование/.test(page) && /Заявки на закупку/.test(page));
});
t('заглушка закупок: «Раздел в разработке»', () => assert.ok(/Раздел в разработке/.test(page)));
t('KPI-плитки есть', () => assert.ok(/KpiTile/.test(page)));
t('фильтры по этапам есть', () => assert.ok(/STAGE_FILTERS/.test(page)));
t('timeline статусов есть', () => assert.ok(/function Timeline/.test(page)));
t('превью через DocumentPreviewSheet', () => assert.ok(/DocumentPreviewSheet/.test(page)));

t('lazyPage-импорт в App.jsx', () => assert.ok(/MyRequests = lazyPage/.test(app)));
t('Route с ProtectedRoute', () => assert.ok(/path="\/my-requests"/.test(app)));
t('Route под PinGuard', () => assert.ok(/my-requests[\s\S]{0,120}PinGuard/.test(app)));
t('rbac: /my-requests → works', () => assert.ok(/'\/my-requests':\s*'works'/.test(rbac)));
t('пункт в меню More.jsx', () => assert.ok(/path: '\/my-requests'/.test(more)));
t('путь в гейте verify-mobile-nav', () => assert.ok(/'\/my-requests'/.test(nav)));
t('мобилка просит ?all=1 для привилегированных (иначе директор видит пусто)', () => {
  assert.ok(/PRIVILEGED_MOBILE_ROLES/.test(page), 'нет списка привилегированных ролей');
  assert.ok(/my-requests' \+ all/.test(page), 'all=1 не подставляется в запрос');
});
t('страница в секции works, а НЕ finances (иначе эскалация прав TO/склад)', () => {
  assert.ok(/'\/my-requests':\s*'works'/.test(rbac),
    'секция finances открывает TO/складу /invoices и /acts с чужими суммами');
  assert.ok(!/'\/my-requests':\s*'finances'/.test(rbac));
  assert.ok(/section="works"[^>]*>\s*<PinGuard><MyRequests/.test(app.replace(/\n/g, ' ')),
    'Route должен требовать works');
});
t('TO и WAREHOUSE НЕ получили finances целиком', () => {
  for (const role of ['TO', 'WAREHOUSE']) {
    const line = rbac.split('\n').find((l) => new RegExp(`^\\s*${role}:\\s*\\[`).test(l)) || '';
    assert.ok(!/finances/.test(line), `${role} получил finances → видит /invoices и /acts`);
  }
});
t('KPI: есть «Черновики», мёртвой плитки «Срочные» нет', () => {
  assert.ok(/Черновики/.test(page), 'плитки «Черновики» нет');
  assert.ok(!/label="Срочные"/.test(page), 'плитка «Срочные» всегда показывала 0 — поле не выставляется');
});
t('черновик можно продолжить и удалить', () => {
  assert.ok(/Продолжить заполнение/.test(page), 'нет кнопки продолжения');
  assert.ok(/api\.delete/.test(page), 'нет удаления черновика');
});
t('НЕ добавлен в hiddenRoutes (иначе недостижим)', () => {
  const hid = read('public/mobile-app/src/config/hiddenRoutes.js');
  assert.ok(!/'\/my-requests'/.test(hid), 'путь попал в скрытые — страница будет недостижима');
});

console.log('\n=== 7. Мастер загрузки: цепочка как на десктопе ===');
const wiz = read('public/mobile-app/src/pages/my-requests/InvoiceUploadSheet.jsx');
t('POST /upload', () => assert.ok(/payment-invoices\/upload/.test(wiz)));
t('POST / (черновик)', () => assert.ok(/api\.post\('\/payment-invoices'/.test(wiz)));
t('POST /:id/recognize', () => assert.ok(/\/recognize/.test(wiz)));
t('PATCH /:id', () => assert.ok(/api\.patch\(/.test(wiz)));
t('POST /submit', () => assert.ok(/payment-invoices\/submit/.test(wiz)));
t('статус «Распознаётся…» при создании', () => assert.ok(/Распознаётся…/.test(wiz)));
t('смена вида расхода сбрасывает объект', () => {
  assert.ok(/k === 'spend_kind' && v !== 'work'/.test(wiz), 'правило сброса объекта отсутствует');
  assert.ok(/fields\.work_id = null/.test(wiz));
});
t('блок деградации: Повторить / Вручную', () => {
  assert.ok(/Повторить/.test(wiz) && /Вручную/.test(wiz));
});
t('блокировка отправки без поставщика/суммы', () => assert.ok(/isComplete/.test(wiz)));
t('последовательная обработка пачки', () => assert.ok(/for \(const it of created\)/.test(wiz)));
t('денежный формат сумм', () => assert.ok(/moneyDisplay/.test(wiz) && /moneyParse/.test(wiz)));
t('три подвкладки', () => {
  assert.ok(/MainTab/.test(wiz) && /TermsTab/.test(wiz) && /ReviewTab/.test(wiz));
});
t('НДС по допустимым ставкам', () => assert.ok(/VAT_RATES/.test(wiz)));
t('подсказки контрагента читают res.suppliers', () => {
  assert.ok(/res\?\.suppliers/.test(wiz), 'эндпоинт отдаёт {suppliers}, а не {items}');
});
t('поиск договора идёт на существующий эндпоинт', () => {
  assert.ok(/payment-invoices\/contract-search/.test(wiz), '/api/contracts не существует (404)');
  assert.ok(!/api\.get\(`\/contracts/.test(wiz));
});
t('есть поле «Услуга оказана»', () => assert.ok(/Услуга оказана/.test(wiz)));
t('есть поле комментария и оно уходит в payload', () => {
  assert.ok(/Комментарий/.test(wiz) && /comment_text:/.test(wiz));
});
t('черновик можно открыть повторно (draftId)', () => assert.ok(/draftId/.test(wiz)));
t('позиции читаются из line_items_json (иначе всегда 0)', () => {
  assert.ok(/d\.line_items_json/.test(wiz), 'API отдаёт line_items_json, не line_items');
});

console.log(`\n═══ ИТОГ: ${pass} PASS / ${fail} FAIL ═══`);
if (fail) process.exitCode = 1;
