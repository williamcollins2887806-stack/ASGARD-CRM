/**
 * Гейт D-345: согласованные счета и выплаты можно ОТКРЫТЬ (27.10.2026).
 *
 * Жалоба заказчика: «счета, которые уже согласованы и стоят к оплате, я не могу
 * открыть». Причина: блоки «К ОПЛАТЕ» (`InvoicesToPaySection`) и «К ВЫПЛАТЕ»
 * (`PayoutToPaySection`) выводили строки простыми `<div>` БЕЗ обработчика клика —
 * ни деталки, ни просмотра. Директор видел поставщика и сумму, но не мог
 * посмотреть реквизиты, позиции и файл счёта.
 *
 * Гейт проверяет:
 *   1. обе секции кликабельны (кнопка + onOpen);
 *   2. секции вызывают переданный обработчик, а не игнорируют его;
 *   3. шторка просмотра счёта существует и умеет режим readOnly;
 *   4. в readOnly нет кнопок решения («Согласовать»/«Вернуть») и выбора срока;
 *   5. шторка просмотра выплаты существует и показывает состав суммы;
 *   6. обе шторки реально смонтированы в родителях (иначе клик «в никуда»).
 */
const fs = require('fs');

let fail = 0;
const bad = (m) => { console.log('  FAIL ' + m); fail++; };
const ok = (m) => console.log('  OK   ' + m);

const F = 'public/mobile-app/src/pages/director/Approvals.jsx';
const src = fs.readFileSync(F, 'utf8');

/**
 * Извлекаем тело функции по имени: ищем `function NAME(` и берём до следующего
 * объявления `function XXX(`. Так порядок функций в файле не важен — первая
 * версия гейта резала по другой функции и «не находила» onOpen (ложный FAIL).
 */
function bodyOf(name) {
  const at = src.indexOf(`function ${name}(`);
  if (at < 0) return '';
  const next = src.indexOf('\nfunction ', at + 1);
  return src.slice(at, next > 0 ? next : src.length);
}

// ── 1. Кликабельность секций ──────────────────────────────────────────────
console.log('=== 1. Секции «К оплате» и «К выплате» кликабельны ===');

const invoiceSec = bodyOf('InvoicesToPaySection');
const payoutSec = bodyOf('PayoutToPaySection');

for (const [name, body] of [['InvoicesToPaySection', invoiceSec], ['PayoutToPaySection', payoutSec]]) {
  if (!body) { bad(`${name}: функция не найдена`); continue; }
  if (/onOpen/.test(body)) ok(`${name}: принимает onOpen`);
  else bad(`${name}: нет пропса onOpen — клик невозможен`);
  if (/<button[\s\S]{0,300}onClick=\{\(\) => onOpen/.test(body)) {
    ok(`${name}: карточка — <button> с вызовом onOpen`);
  } else bad(`${name}: карточка не кнопка или не вызывает onOpen`);
}

// ── 2. Шторка счёта: режим просмотра ─────────────────────────────────────
console.log('\n=== 2. Просмотр счёта (readOnly) ===');
if (/function InvoiceDetailSheet\([^)]*readOnly/.test(src)) {
  ok('InvoiceDetailSheet принимает readOnly');
} else bad('InvoiceDetailSheet не умеет режим просмотра');

// В readOnly не должно быть кнопок решения и выбора срока.
const readOnlyBlock = src.slice(
  src.indexOf('{readOnly ? ('),
  src.indexOf('{readOnly ? (') >= 0 ? src.indexOf('{readOnly ? (') + 700 : 0
);
if (/Счёт согласован/.test(readOnlyBlock)) ok('в readOnly показана понятная подпись «Счёт согласован»');
else bad('в readOnly нет пояснения, почему нельзя действовать');

if (/\{!readOnly && \(/.test(src)) ok('выбор срока оплаты скрыт в readOnly');
else bad('выбор срока оплаты показывается даже в просмотре');

// Кнопки решения должны быть только в ветке !readOnly.
const actionsAt = src.indexOf('onClick={() => onDecide(pay.id, \'approve\')}');
const roAt = src.indexOf('{readOnly ? (');
if (actionsAt > roAt && roAt > 0) ok('кнопки «Согласовать»/«Вернуть» только вне readOnly');
else bad('кнопки решения могут показываться в режиме просмотра');

// ── 3. Просмотр выплаты ───────────────────────────────────────────────────
console.log('\n=== 3. Просмотр выплаты ===');
if (/function PayoutViewSheet/.test(src)) ok('PayoutViewSheet существует');
else bad('нет шторки просмотра выплаты');
const pv = src.slice(src.indexOf('function PayoutViewSheet'), src.indexOf('function InvoiceDetailSheet'));
if (/Состав суммы/.test(pv)) ok('показывает состав суммы (перевод, удержание, к получению)');
else bad('не показывает состав суммы — непонятно, откуда цифра');
if (/Выплата согласована/.test(pv)) ok('поясняет, что выплата согласована');
else bad('нет пояснения статуса');
if (!/onDecide/.test(pv)) ok('в просмотре выплаты нет кнопок решения');
else bad('в просмотре выплаты остались кнопки решения');

// ── 4. Шторки смонтированы ────────────────────────────────────────────────
console.log('\n=== 4. Шторки смонтированы в родителях ===');
const invoiceMounts = (src.match(/<InvoiceDetailSheet/g) || []).length;
const payoutMounts = (src.match(/<PayoutViewSheet/g) || []).length;
console.log(`  <InvoiceDetailSheet>: ${invoiceMounts} | <PayoutViewSheet>: ${payoutMounts}`);
if (invoiceMounts >= 2) ok('InvoiceDetailSheet смонтирован и для очереди, и для просмотра');
else bad('InvoiceDetailSheet не смонтирован для просмотра согласованных');
if (payoutMounts >= 2) ok('PayoutViewSheet смонтирован в обеих ветках PayoutsTab');
else bad('PayoutViewSheet не смонтирован во всех ветках');

// Обе секции должны получать onOpen при вызове.
const invoiceUse = (src.match(/<InvoicesToPaySection[^>]*>/g) || []);
const payoutUse = (src.match(/<PayoutToPaySection[^>]*>/g) || []);
const invOk = invoiceUse.length > 0 && invoiceUse.every((x) => /onOpen=/.test(x));
const payOk = payoutUse.length > 0 && payoutUse.every((x) => /onOpen=/.test(x));
if (invOk) ok('все вызовы InvoicesToPaySection передают onOpen');
else bad('есть вызов InvoicesToPaySection без onOpen — клик не сработает');
if (payOk) ok('все вызовы PayoutToPaySection передают onOpen');
else bad('есть вызов PayoutToPaySection без onOpen');

// ── 5. Мёртвые классы (проверка, что новое не внесло долг) ────────────────
console.log('\n=== 5. Нет мёртвых классов ===');
/**
 * Ищем мёртвые классы в КОДЕ, а не в комментариях: `m-card` встречается только
 * в пояснении «как m-card__ic в рендере десктопа» — это не использование класса.
 */
const codeOnly = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const dead = ['m-card', 'btn mini', 'btn ghost', '"muted"', '"inp"', 'className="btn"'];
const hits = dead.filter((d) => codeOnly.includes(d));
if (!hits.length) ok('мёртвых классов в коде нет');
else bad('найдены мёртвые классы: ' + hits.join(', '));

console.log('\n' + (fail === 0
  ? 'ИТОГ: OK — согласованные счета и выплаты открываются на просмотр, без кнопок решения'
  : `ИТОГ: FAIL — ${fail} нарушений`));
process.exit(fail === 0 ? 0 : 1);
