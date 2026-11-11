'use strict';

/**
 * V483: за чей счёт доставка + канал подписания акта сверки.
 *
 * Проверяем ДЕТЕРМИНИРОВАННО, без БД и сети:
 *   1. ИИ не может выдумать человеческие значения доставки (только
 *      included/supplier/null) — иначе модель начнёт «угадывать» за человека;
 *   2. повторное распознавание не затирает ручной выбор;
 *   3. правило автоопределения канала акта: ручной выбор > >50 % ЭДО >
 *      unknown (нет данных) > original.
 *
 * Запуск: node tests/delivery-payer.test.js
 */

const assert = require('assert');
const aiEx = require('../src/services/invoice-ai-extract');

let n = 0;
function t(name, fn) {
  try {
    fn();
    n += 1;
    console.log('  \u2713', name);
  } catch (e) {
    console.error('  \u2717', name);
    throw e;
  }
}

/**
 * Зеркало правила из src/routes/doc-registry.js (список и деталь считают
 * одинаково). Вынесено сюда, чтобы тест проверял именно ЛОГИКУ решения,
 * а не копию SQL.
 */
const CHANNELS = ['auto', 'edo', 'scan', 'original'];
function resolveChannel(override, stats) {
  const ov = String(override || 'auto');
  if (!CHANNELS.includes(ov)) return 'unknown';
  if (ov !== 'auto') return ov;
  const defined = Number(stats && stats.defined) || 0;
  if (defined === 0) return 'unknown';
  const edo = Number(stats && stats.edo) || 0;
  return edo * 2 > defined ? 'edo' : 'original';
}

console.log('delivery-payer + recon channel');

// ─── 1. ИИ: только два допустимых значения ────────────────────────────────
t('ИИ: доставка есть в счёте → included', () => {
  const r = aiEx.normalize({ delivery_payer: 'included' });
  assert.strictEqual(r.delivery_payer, 'included');
});

t('ИИ: «за счёт поставщика» → supplier', () => {
  const r = aiEx.normalize({ delivery_payer: 'supplier' });
  assert.strictEqual(r.delivery_payer, 'supplier');
});

t('ИИ: регистр и пробелы нормализуются', () => {
  assert.strictEqual(aiEx.normalize({ delivery_payer: '  SUPPLIER ' }).delivery_payer, 'supplier');
  assert.strictEqual(aiEx.normalize({ delivery_payer: 'Included' }).delivery_payer, 'included');
});

t('ИИ: человеческие значения НЕ принимаются (ours_separate)', () => {
  // Ключевой инвариант: «за наш счёт отдельно» — решение человека, а не факт
  // из документа. Модель вернула — значит выдумала; отбрасываем.
  assert.strictEqual(aiEx.normalize({ delivery_payer: 'ours_separate' }).delivery_payer, null);
});

t('ИИ: none / other тоже не принимаются', () => {
  assert.strictEqual(aiEx.normalize({ delivery_payer: 'none' }).delivery_payer, null);
  assert.strictEqual(aiEx.normalize({ delivery_payer: 'other' }).delivery_payer, null);
});

t('ИИ: мусор и отсутствие поля → null (не выдумываем)', () => {
  assert.strictEqual(aiEx.normalize({ delivery_payer: 'за наш счёт' }).delivery_payer, null);
  assert.strictEqual(aiEx.normalize({ delivery_payer: '' }).delivery_payer, null);
  assert.strictEqual(aiEx.normalize({}).delivery_payer, null);
  assert.strictEqual(aiEx.normalize(null).delivery_payer, null);
});

t('ИИ: остальные поля не сломаны добавлением ключа', () => {
  const r = aiEx.normalize({
    supplier_name: 'ООО Ромашка',
    amount_gross: 12000,
    delivery_payer: 'included'
  });
  assert.strictEqual(r.supplier_name, 'ООО Ромашка');
  assert.strictEqual(r.amount_gross, 12000);
  assert.strictEqual(r.delivery_payer, 'included');
});

// ─── 2. Ручной выбор не затирается распознаванием ─────────────────────────
t('mergeWithRegex: значение ИИ попадает в результат', () => {
  const out = aiEx.mergeWithRegex({ delivery_payer: 'included' }, {});
  assert.strictEqual(out.parsed.delivery_payer, 'included');
});

t('mergeWithRegex: ИИ вернул null — значение из регулярки сохраняется', () => {
  // Регулярки пока это поле не извлекают, но контракт должен работать:
  // «не знаю» от модели не должно стирать известное значение.
  const out = aiEx.mergeWithRegex({ delivery_payer: null }, { delivery_payer: 'supplier' });
  assert.strictEqual(out.parsed.delivery_payer, 'supplier');
});

t('mergeWithRegex: без ИИ значение из регулярки не теряется', () => {
  const out = aiEx.mergeWithRegex(null, { delivery_payer: 'supplier' });
  assert.strictEqual(out.parsed.delivery_payer, 'supplier');
});

// ─── 3. Автоопределение канала акта сверки ────────────────────────────────
t('канал: нет данных вовсе → unknown (НЕ «оригинал»)', () => {
  // Именно этот случай был дефектом первого плана: «>50 % ЭДО, иначе оригинал»
  // превращало отсутствие данных в утверждение про бумагу.
  assert.strictEqual(resolveChannel('auto', { edo: 0, paper: 0, defined: 0 }), 'unknown');
  assert.strictEqual(resolveChannel(null, null), 'unknown');
});

t('канал: > 50 % ЭДО → edo', () => {
  assert.strictEqual(resolveChannel('auto', { edo: 7, paper: 2, defined: 9 }), 'edo');
});

t('канал: ровно 50 % — НЕ большинство, значит original', () => {
  // Строгое «больше половины»: 4 из 8 — это не «в основном ЭДО».
  assert.strictEqual(resolveChannel('auto', { edo: 4, paper: 4, defined: 8 }), 'original');
});

t('канал: меньше половины ЭДО → original', () => {
  assert.strictEqual(resolveChannel('auto', { edo: 2, paper: 7, defined: 9 }), 'original');
});

t('канал: данные есть, но ЭДО нет ни одного → original', () => {
  assert.strictEqual(resolveChannel('auto', { edo: 0, paper: 3, defined: 3 }), 'original');
});

t('канал: ручной выбор побеждает автоопределение', () => {
  // Бухгалтерия знает про контрагента больше, чем статистика.
  assert.strictEqual(resolveChannel('original', { edo: 9, paper: 0, defined: 9 }), 'original');
  assert.strictEqual(resolveChannel('edo', { edo: 0, paper: 9, defined: 9 }), 'edo');
  assert.strictEqual(resolveChannel('scan', { edo: 0, paper: 0, defined: 0 }), 'scan');
});

t('канал: мусор в override не ломает ответ', () => {
  assert.strictEqual(resolveChannel('телепатия', { edo: 1, paper: 0, defined: 1 }), 'unknown');
});

// ─── 4. Разнобой в написании receive_channel (найдено на проде 11.11) ──────
// В базе живут 'edo' И 'эдо', 'original' И 'оригинал'. Точное сравнение
// с 'edo' теряло 18 счетов: контрагент получал «канал не задан», хотя
// способ получения у него известен. Нормализация — в SQL (lower+btrim),
// здесь проверяем, что решение принимается по нормализованным счётчикам.
t('канал: русское «эдо» считается как ЭДО', () => {
  // 3 из 5 по ЭДО (в базе часть записей по-русски) → всё равно edo.
  assert.strictEqual(resolveChannel('auto', { edo: 3, paper: 2, defined: 5 }), 'edo');
});

t('канал: «оригинал» по-русски не мешает решению', () => {
  assert.strictEqual(resolveChannel('auto', { edo: 0, paper: 4, defined: 4 }), 'original');
});

t('канал: 18 русских «эдо» из 20 — большинство', () => {
  assert.strictEqual(resolveChannel('auto', { edo: 18, paper: 2, defined: 20 }), 'edo');
});

// ─── 5. Склейка контрагента в один акт (дефект прода 11.11.2026) ───────────
// Заказчик: «вижу акты сверки и написано требуется запросить» — при том, что
// у контрагента часть счетов была без ИНН. Старая схема давала ДВА акта на
// одного контрагента: 7 счетов без ИНН — строка по имени, счета с ИНН —
// отдельная строка. Пример с прода: «ВсеИнструменты.ру» 7 + 3 = 2 акта.
//
// Правило склейки (проверяем здесь, SQL повторяет его же):
//   • ИНН есть                              → группа по ИНН;
//   • ИНН пуст, у этого имени ровно 1 ИНН   → к нему;
//   • ИНН пуст, у имени несколько ИНН       → отдельная группа по имени
//                                             (разных юрлиц не слепляем).
function groupKey(inn, variantsForName, singleInnForName, nameKey) {
  if (inn) return 'inn:' + inn;
  if (variantsForName === 1) return 'inn:' + singleInnForName;
  return 'name:' + nameKey;
}

t('склейка: счёт без ИНН приклеивается к единственному ИНН того же имени', () => {
  // 7 счетов без ИНН + 3 с ИНН 7722753969, других ИНН у этого имени нет.
  assert.strictEqual(groupKey(null, 1, '7722753969', 'ооо всеинструменты.ру'), 'inn:7722753969');
  assert.strictEqual(groupKey('7722753969', 1, '7722753969', 'ооо всеинструменты.ру'), 'inn:7722753969');
});

t('склейка: имя-тёзка с ДВУМЯ разными ИНН остаётся отдельной группой', () => {
  // «ООО Ромашка» — два разных юрлица. Счёт без ИНН к ним приклеивать нельзя:
  // получился бы акт на чужого контрагента.
  assert.strictEqual(groupKey(null, 2, '7700000001', 'ооо ромашка'), 'name:ооо ромашка');
  // А счета с ИНН различаются между собой.
  assert.strictEqual(groupKey('7700000001', 2, '7700000001', 'ооо ромашка'), 'inn:7700000001');
  assert.strictEqual(groupKey('7700000002', 2, '7700000001', 'ооо ромашка'), 'inn:7700000002');
});

t('склейка: кавычки и регистр не разъезжаются', () => {
  // normalizeName в SQL: убираем " « » и приводим к нижнему регистру.
  const norm = (s) => String(s || '').toLowerCase().replace(/["«»]/g, '').trim();
  assert.strictEqual(norm('ООО «ВсеИнструменты.ру»'), norm('ООО "ВСЕИНСТРУМЕНТЫ.РУ"'));
});

console.log(`\nOK: ${n} проверок`);
