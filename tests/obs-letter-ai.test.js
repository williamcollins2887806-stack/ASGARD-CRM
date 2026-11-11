'use strict';
/**
 * Проверка классификатора предмета закупки.
 *
 * Основание — 13 писем Дмитрия: каждая позиция должна попасть в СВОЙ каркас.
 * Особенно важно, что холодильник/шуруповёрт/кулер НЕ попадают в «допуск»
 * (именно на это жаловался заказчик: «шлёпаешь одно и то же про безопасное
 * выполнение работ»).
 */
const assert = require('assert');
const { classify, generate, buildFallback, itemsInline } = require('../src/services/obs-letter-ai');

let n = 0;
function t(name, fn) {
  try { fn(); n += 1; console.log('  \u2713', name); }
  catch (e) { console.error('  \u2717', name); throw e; }
}

console.log('obs-letter-ai · классификатор каркасов');

// ─── 1. Реальные позиции из писем Дмитрия ────────────────────────────────
t('СИЗ (беруши, перчатки х/б) → допуск', () => {
  const r = classify(['Беруши противошумные', 'Перчатки х/б с ПВХ-покрытием']);
  assert.strictEqual(r.scaffold, 'dopusk');
  assert.strictEqual(r.type, 'goods');
});

t('спецодежда (костюмы, полуботинки) → допуск', () => {
  const r = classify(['Костюм «ЛЕГИОНЕР»', 'Полуботинки ProSafe с металлическим подноском']);
  assert.strictEqual(r.scaffold, 'dopusk');
});

t('медосмотр → допуск, услуга', () => {
  const r = classify(['Проведение медицинских осмотров', 'Оформление медицинских документов']);
  assert.strictEqual(r.scaffold, 'dopusk');
  assert.strictEqual(r.type, 'service');
});

t('биотуалеты → допуск, услуга', () => {
  const r = classify(['Аренда и обслуживание мобильных туалетных кабин']);
  assert.strictEqual(r.scaffold, 'dopusk');
  assert.strictEqual(r.type, 'service');
});

t('проживание + прачечная → присутствие', () => {
  const r = classify(['Размещение персонала в гостинице', 'Услуги прачечной']);
  assert.strictEqual(r.scaffold, 'presence');
});

t('автобус, 12 смен → присутствие', () => {
  const r = classify(['Услуги пассажирских перевозок, автобус 50 мест, 12 смен']);
  assert.strictEqual(r.scaffold, 'presence');
  assert.strictEqual(r.type, 'service');
});

t('перевозка груза Саранск–Астрахань → присутствие', () => {
  const r = classify(['Автотранспортные услуги по разовой перевозке груза']);
  assert.strictEqual(r.scaffold, 'presence');
});

t('упор RAS, инструмент → технология', () => {
  const r = classify(['Упор RAS для внутренней отбортовки круглых отверстий']);
  assert.strictEqual(r.scaffold, 'technology');
  assert.strictEqual(r.type, 'goods');
});

t('РТИ (рукава, паронит) → производство', () => {
  const r = classify(['Рукава напорные', 'Техпластина', 'Паронит']);
  assert.strictEqual(r.scaffold, 'production');
});

t('питание → производство', () => {
  const r = classify(['Услуги комплексного питания']);
  assert.strictEqual(r.scaffold, 'production');
  assert.strictEqual(r.type, 'service');
});

// ─── 2. То, на что жаловался заказчик ───────────────────────────────────
t('ХОЛОДИЛЬНИК не попадает в «допуск»', () => {
  const r = classify(['Холодильник бытовой двухкамерный']);
  assert.notStrictEqual(r.scaffold, 'dopusk');
  assert.strictEqual(r.scaffold, 'technology');
});

t('ШУРУПОВЁРТ не попадает в «допуск»', () => {
  const r = classify(['Шуруповёрт аккумуляторный 18В']);
  assert.notStrictEqual(r.scaffold, 'dopusk');
  assert.strictEqual(r.scaffold, 'technology');
});

t('КУЛЕР не попадает в «допуск»', () => {
  const r = classify(['Кулер для воды настольный']);
  assert.notStrictEqual(r.scaffold, 'dopusk');
  assert.strictEqual(r.scaffold, 'technology');
});

t('лицензия ПО → технология, услуга', () => {
  const r = classify(['Лицензионное вознаграждение за право использования программы для ЭВМ — доступ к нейросетям RouterAI']);
  assert.strictEqual(r.scaffold, 'technology');
  assert.strictEqual(r.type, 'service');
});

// ─── 3. Краевые случаи ──────────────────────────────────────────────────
t('пустой список → production, без падения', () => {
  const r = classify([]);
  assert.strictEqual(r.scaffold, 'production');
  assert.strictEqual(r.confidence, 0);
});

t('неизвестная позиция с «услуг» → услуга', () => {
  const r = classify(['Некое оказание услуг по договору']);
  assert.strictEqual(r.type, 'service');
});

t('неизвестная позиция без услуги → товар', () => {
  const r = classify(['Некая штуковина']);
  assert.strictEqual(r.type, 'goods');
});

// ─── 4. Фолбэк без ИИ: текст не содержит «безопасного выполнения» ────────
t('фолбэк для инструмента НЕ говорит про охрану труда', () => {
  const cls = classify(['Шуруповёрт аккумуляторный']);
  const fb = buildFallback(cls, {
    company: 'ООО «Асгард-Сервис»',
    counterparty: 'ООО «ВсеИнструменты.ру»',
    items: 'Шуруповёрт аккумуляторный',
    invoice_no: '123', invoice_date: '11.11.2026',
    contract_label: '12/2026',
  });
  const all = (fb.gist + ' ' + fb.why).toLowerCase();
  assert.ok(!/безопасн/.test(all), 'в тексте про инструмент не должно быть «безопасного выполнения»');
  assert.ok(!/охраны труда/.test(all), 'не должно быть «охраны труда»');
});

t('фолбэк для СИЗ, наоборот, говорит про допуск', () => {
  const cls = classify(['Перчатки х/б']);
  const fb = buildFallback(cls, {
    company: 'ООО «Асгард-Сервис»', counterparty: 'X',
    items: 'Перчатки х/б', invoice_no: '1', invoice_date: '01.01.2026', contract_label: '1',
  });
  assert.ok(/допуск|безопасн|охраны труда/i.test(fb.why + ' ' + fb.gist));
});

// ─── 5. Позиции строкой, без маркеров (как в эталонах Дмитрия) ───────────
t('позиции идут строкой через запятую, без «— »', () => {
  const s = itemsInline(['Беруши', 'Перчатки', 'Каска']);
  assert.strictEqual(s, 'Беруши, Перчатки, Каска');
  assert.ok(!/—/.test(s));
});

// ─── 6. generate() без ИИ не падает и помечает источник ─────────────────
(async () => {
  const r = await generate(
    { items: ['Шуруповёрт'], counterparty: 'X', company: 'ООО «Асгард-Сервис»', invoiceNo: '1' },
    { ai: null });
  assert.strictEqual(r.source, 'fallback');
  assert.strictEqual(r.scaffold, 'technology');
  n += 1;
  console.log('  \u2713 generate() без ИИ → fallback, каркас technology');
  console.log(`\nOK: ${n} проверок`);
})().catch((e) => { console.error(e); process.exit(1); });
