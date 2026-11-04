#!/usr/bin/env node
'use strict';

/**
 * Черновик ТКП через ИИ — проверки БЕЗ сети и БЕЗ БД.
 *
 * Что доказываем:
 *  1. Суммы строк всегда сходятся с ценой КП без НДС (до копейки).
 *  2. При узкой наценке / отсутствии сметы — одна сводная строка, никакой
 *     поэлементной расшифровки затрат (главная защита от утечки себестоимости).
 *  3. В клиентские позиции не попадают внутренние статьи (ФОТ, накладные,
 *     командировочные, логистика, аренда, закупка долей).
 *  4. Каждое поле от ИИ валидируется: мусор → шаблон, а не «полуфраза».
 *  5. item_names не той длины → детерминированные названия из сметы.
 *  6. Риски и обязанности заказчика ИИ не пишет никогда (только шаблон).
 *  7. sanitizeManualDraft вырезает утечку из ручных правок.
 *  8. Разбор битого JSON-ответа модели (обёртка ```json, мусор до/после).
 *
 * Запуск: node tests/tkp-ai-draft.test.js
 */

const assert = require('assert');

// Модуль тянет db.js, который требует DB_PASSWORD на этапе загрузки. Сеть и БД
// этим тестам не нужны — подставляем заглушку ДО require. Пул ленивый,
// ни одного запроса не выполняется.
if (!process.env.DB_PASSWORD) process.env.DB_PASSWORD = 'unit-test-no-connection';

const svc = require('../src/services/tkp-ai-draft');
const lint = require('../src/services/client-doc-lint');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (e) {
    failed += 1;
    failures.push({ name, error: e.message });
  }
}

/* ───────── вспомогательные фикстуры ───────── */

function makeSmeta(overrides) {
  const o = overrides || {};
  const rows = o.rows || [
    { kind: 'section', section: 'A', name: 'A. Персонал' },
    { kind: 'line', section: 'A', code: 'A1', name: 'ИТР (РП)', unit: 'чел·смен', qty: 10, price: 9000, sum: 90000 },
    { kind: 'line', section: 'A', code: 'A3', name: 'Рабочий (исполнитель)', unit: 'чел·смен', qty: 30, price: 7000, sum: 210000 },
    { kind: 'rollup', section: 'A', code: 'A_FOT', name: 'ФОТ, итого', sum: 300000 },
    { kind: 'section', section: 'B', name: 'B. Текущие расходы' },
    { kind: 'line', section: 'B', code: 'B1', name: 'СИЗ + спецодежда', unit: 'чел', qty: 6, price: 3500, sum: 21000 },
    { kind: 'line', section: 'B', code: 'B4', name: 'Оборудование (амортизация)', unit: 'компл', qty: 1, price: 40000, sum: 40000 },
    { kind: 'section', section: 'C', name: 'C. Командировочные' },
    { kind: 'line', section: 'C', code: 'C1', name: 'Пайковые', unit: 'чел·дн', qty: 30, price: 700, sum: 21000 },
    { kind: 'line', section: 'C', code: 'C2', name: 'Проживание', unit: 'чел·ночь', qty: 20, price: 3000, sum: 60000 },
    { kind: 'section', section: 'D', name: 'D. Логистика / транспорт' },
    { kind: 'line', section: 'D', code: 'D1', name: 'Доставка оборудования', unit: 'рейс', qty: 2, price: 25000, sum: 50000 },
    { kind: 'section', section: 'E', name: 'E. Материалы и реагенты' },
    { kind: 'line', section: 'E', code: 'E1', name: 'Материалы / реагенты', unit: 'компл', qty: 1, price: 85000, sum: 85000 },
    { kind: 'section', section: 'F', name: 'F. Планируемое оборудование и техника (перечень, справочно)' },
    { kind: 'info', section: 'F', code: 'F1', name: 'АВД высокого давления', unit: 'шт', qty: 1, sum: 0 },
    { kind: 'section', section: 'H', name: 'H. Аренда техники' },
    { kind: 'line', section: 'H', code: 'H1', name: 'Аренда техники (кран, манипулятор и т.п.)', unit: 'смена', qty: 2, price: 30000, sum: 60000 }
  ];
  const totals = Object.assign({
    fot: 300000,
    cost: 416000,
    price_no_vat: 915200,
    vat_amount: 201344,
    price_with_vat: 1116544,
    margin_rub: 499200,
    net_profit: 399360,
    vat_pct: 22,
    markup: 2.2
  }, o.totals || {});
  return { rows, totals, params: { vat: 0.22, markup: 2.2, work_days: 15 }, items: [] };
}

function makePricing(overrides) {
  const smeta = makeSmeta(overrides);
  const t = smeta.totals;
  return {
    priceNoVat: t.price_no_vat,
    priceWithVat: t.price_with_vat,
    vatPct: t.vat_pct,
    cost: t.cost,
    markup: t.markup,
    totals: t,
    smeta,
    durationDays: 15,
    durationNote: '',
    paymentTerms: '',
    scope: '',
    summary: '',
    analysis: {},
    resources: null
  };
}

/* ───────── 1. Позиции сходятся с ценой КП ───────── */

check('сумма строк = цена КП без НДС (до копейки)', () => {
  const pricing = makePricing();
  const items = svc.buildClientItems(pricing, {});
  const sum = items.reduce((s, it) => s + Number(it.total), 0);
  assert.ok(Math.abs(sum - pricing.priceNoVat) < 0.02,
    'сумма ' + sum + ' != цена ' + pricing.priceNoVat);
});

check('сумма сходится и при «неудобной» цене (округление в остаток)', () => {
  const pricing = makePricing({ totals: { price_no_vat: 1000000.03, price_with_vat: 1220000.04 } });
  const items = svc.buildClientItems(pricing, {});
  const sum = items.reduce((s, it) => s + Number(it.total), 0);
  assert.ok(Math.abs(sum - 1000000.03) < 0.02, 'сумма ' + sum);
});

check('количество позиций не разрастается: нет пустых и служебных', () => {
  const items = svc.buildClientItems(makePricing(), {});
  assert.ok(items.length > 0, 'позиции не собраны');
  for (const it of items) {
    assert.ok(String(it.name).trim().length > 0, 'пустое название позиции');
    assert.ok(it.total >= 0, 'отрицательная сумма: ' + it.total);
  }
});

/* ───────── 2. Внутренние статьи не попадают клиенту ───────── */

check('в клиентской таблице НЕТ ни одной статьи затрат (строки сметы клиенту не показываем)', () => {
  const pricing = makePricing();
  const items = svc.buildClientItems(pricing, {});
  assert.strictEqual(items.length, 1, 'ожидали одну сводную позицию, получили ' + items.length);
  const names = items.map((i) => i.name).join(' | ');
  const forbidden = [
    /ФОТ/i, /накладн/i, /пайков/i, /проживан/i, /командировоч/i,
    /доставка оборудования/i, /аренда техники/i, /амортизац/i,
    /СИЗ/i, /материалы/i, /ИТР/i, /рабочий \(исполнитель\)/i
  ];
  const hits = forbidden.filter((re) => re.test(names)).map((re) => re.source);
  assert.deepStrictEqual(hits, [], 'протекло: ' + hits.join(',') + ' → ' + names);
});

check('название сводной позиции можно задать из предмета закупки', () => {
  const items = svc.buildClientItems(makePricing(), { summaryName: 'Очистка кожухотрубных теплообменников' });
  assert.strictEqual(items[0].name, 'Очистка кожухотрубных теплообменников');
  assert.strictEqual(items[0].total, makePricing().priceNoVat);
});

check('итог всегда ровно цена КП без НДС — при любой наценке', () => {
  const cases = [
    { cost: 950000, price_no_vat: 1000000, markup: 1.05 },
    { cost: 1200000, price_no_vat: 1000000, markup: 0.83 },
    { cost: 416000, price_no_vat: 915200, markup: 2.2 },
    { cost: 0, price_no_vat: 750000, markup: 0 }
  ];
  for (const c of cases) {
    const pricing = makePricing({ totals: c });
    const items = svc.buildClientItems(pricing, {});
    assert.strictEqual(items.length, 1, 'наценка ' + c.markup + ': позиций ' + items.length);
    assert.strictEqual(items[0].total, c.price_no_vat, 'наценка ' + c.markup);
  }
});

check('каждое название позиции проходит линтер как клиентский текст', () => {
  const items = svc.buildClientItems(makePricing(), {});
  const bad = [];
  for (const it of items) {
    const r = lint.lintText(it.name, { skipNumbers: true });
    if (r.hits.length) bad.push(it.name + ' → ' + r.hits.map((h) => h.kind).join(','));
  }
  assert.deepStrictEqual(bad, [], bad.join(' | '));
});

/* ───────── 3. Цены/наценка не влияют на корректность ───────── */

check('узкая наценка и убыточная цена не меняют правило «одна позиция = цена КП»', () => {
  const narrow = makePricing({ totals: { cost: 950000, price_no_vat: 1000000, price_with_vat: 1220000, markup: 1.05 } });
  const loss = makePricing({ totals: { cost: 1200000, price_no_vat: 1000000, price_with_vat: 1220000, markup: 0.83 } });
  for (const pricing of [narrow, loss]) {
    const items = svc.buildClientItems(pricing, {});
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].total, pricing.priceNoVat);
  }
});

/* ───────── 4. Валидация полей от ИИ ───────── */

check('мусор в текстовом поле → шаблон, а не обрезок', () => {
  const r = svc.validateTextField('Таким образом в рамках договора себестоимость 350000 руб.', {
    maxLen: 500, fallback: 'ШАБЛОН', allowedNumbers: [], field: 'x'
  });
  assert.strictEqual(r.value, 'ШАБЛОН');
  assert.strictEqual(r.replaced, true);
});

check('слишком длинное поле → шаблон', () => {
  const r = svc.validateTextField('а'.repeat(3000), {
    maxLen: 2000, fallback: 'ШАБЛОН', allowedNumbers: [], field: 'x'
  });
  assert.strictEqual(r.value, 'ШАБЛОН');
});

check('чистое поле принимается как есть', () => {
  const ok = 'Очистка кожухотрубного теплообменника на объекте заказчика.';
  const r = svc.validateTextField(ok, { maxLen: 500, fallback: 'ШАБЛОН', allowedNumbers: [], field: 'x' });
  assert.strictEqual(r.value, ok);
  assert.strictEqual(r.replaced, false);
});

check('выдуманная сумма в тексте → шаблон', () => {
  const r = svc.validateTextField('Стоимость работ 999 000 руб.', {
    maxLen: 500, fallback: 'ШАБЛОН', allowedNumbers: [1250000], field: 'x'
  });
  assert.strictEqual(r.value, 'ШАБЛОН');
});

check('пункт списка с утечкой выбрасывается, чистые остаются', () => {
  const r = svc.validateList(['Очистка аппаратов', 'Оплата пайковых 700 руб', 'Промывка линий'], {
    maxItems: 8, maxLen: 200, allowedNumbers: [], field: 'scope'
  });
  assert.strictEqual(r.value.length, 2, 'получили: ' + JSON.stringify(r.value));
  assert.ok(r.replaced, 'должен быть помечен как исправленный');
});

/* ───────── 5. item_names ───────── */

check('tidyItemName снимает хвостовые скобки и нормализует регистр', () => {
  assert.strictEqual(svc.tidyItemName('очистка теплообменника (АВД)'), 'Очистка теплообменника');
  assert.strictEqual(svc.tidyItemName('  промывка   линий  '), 'Промывка линий');
  assert.strictEqual(svc.tidyItemName(''), 'Выполнение работ');
});

/* ───────── 6. Шаблоны: риски и обязанности не от ИИ ───────── */

check('обязанности заказчика — фиксированный шаблон, без ИИ-штампов', () => {
  const t = svc.CONST.CUSTOMER_DUTIES_DEFAULT;
  assert.ok(t.length > 100, 'шаблон подозрительно короткий');
  const r = lint.lintText(t);
  assert.deepStrictEqual(r.hits.map((h) => h.kind), [], 'в шаблоне мусор');
});

check('гарантия по умолчанию проходит линтер', () => {
  const r = lint.lintText(svc.CONST.WARRANTY_DEFAULT);
  assert.deepStrictEqual(r.hits.map((h) => h.kind), []);
});

check('условия оплаты по умолчанию проходят линтер', () => {
  const r = lint.lintText(svc.CONST.PAYMENT_DEFAULT);
  assert.deepStrictEqual(r.hits.map((h) => h.kind), []);
});

/* ───────── 7. Ручные правки ───────── */

check('sanitizeManualDraft вырезает себестоимость из ручного текста', () => {
  const res = svc.sanitizeManualDraft({
    subject: 'Очистка теплообменника',
    work_description: 'Выполняем очистку. Себестоимость 350 000 руб. Срок 20 дней.',
    items: { items: [{ name: 'Промывка', total: 1000 }] }
  }, { allowedNumbers: [] });
  assert.ok(!/себестоимост/i.test(res.draft.work_description), 'утечка осталась: ' + res.draft.work_description);
  assert.ok(/очистку/i.test(res.draft.work_description), 'полезный текст потерян');
});

check('sanitizeManualDraft блокирует ИИ-штамп и сообщает поле', () => {
  const res = svc.sanitizeManualDraft({
    subject: 'Очистка',
    work_description: 'Таким образом, работы выполняем качественно.'
  }, { allowedNumbers: [] });
  assert.strictEqual(res.ok, false);
  assert.ok(res.hits.some((h) => h.kind === 'ai_cliche'), 'не поймали штамп');
});

/* ───────── 8. Разбор ответа модели ───────── */

check('tryJson понимает ```json-обёртку', () => {
  const v = svc._internal.tryJson('```json\n{"subject":"Тест"}\n```');
  assert.strictEqual(v.subject, 'Тест');
});

check('tryJson понимает мусор до и после JSON', () => {
  const v = svc._internal.tryJson('Вот результат: {"subject":"Тест","scope_included":[]} — готово.');
  assert.strictEqual(v.subject, 'Тест');
});

check('tryJson возвращает null на невалидном ответе', () => {
  assert.strictEqual(svc._internal.tryJson('Извините, не могу.'), null);
  assert.strictEqual(svc._internal.tryJson(''), null);
});

/* ───────── 9. Заголовок и описание по умолчанию ───────── */

check('defaultSubject берёт предмет закупки, а не выдумку', () => {
  const s = svc.defaultSubject({ tender_title: 'Очистка теплообменников котельной' });
  assert.strictEqual(s, 'Очистка теплообменников котельной');
});

check('pickWorkTitle вычищает номер процедуры из автотестового названия', () => {
  assert.strictEqual(svc.pickWorkTitle('TPUI_1789333911272 approved-director'), '');
  assert.strictEqual(svc.pickWorkTitle('TPUI_1789333911272 approved-director Очистка котлов'), 'Очистка котлов');
  assert.strictEqual(svc.pickWorkTitle('Очистка теплообменников'), 'Очистка теплообменников');
  assert.strictEqual(svc.pickWorkTitle(''), '');
});

check('allowedNumbers включает числа из исходных данных (номер закупки)', () => {
  const nums = svc.collectAllowedNumbers({
    tender_title: 'TPUI_1789333911272 approved-director',
    tender_description: 'Объём 8 аппаратов',
    work_names: ''
  }, { priceNoVat: 1000000, priceWithVat: 1200000, vatPct: 20, durationDays: 14 });
  const keys = nums.map((n) => String(n).replace(/\D/g, ''));
  assert.ok(keys.some((k) => k === '1789333911272'), 'номер закупки не попал в допустимые: ' + keys.join(','));
  assert.ok(keys.some((k) => k === '1000000'), 'цена не попала в допустимые');
});

check('defaultDescription собирается из периметра и срока', () => {
  const d = svc.defaultDescription({ tender_title: 'X' }, { scope: 'Очистка двух аппаратов.', durationDays: 14 }, ['Промывка линий']);
  assert.ok(/Очистка двух аппаратов/.test(d), d);
  assert.ok(/14/.test(d), d);
  assert.ok(/Промывка линий/.test(d), d);
});

/* ───────── 10. readPricing: канон D-173 (цена без НДС) ───────── */

check('readPricing: work_price_ex_vat приоритетнее work_price', () => {
  const p = svc.readPricing({ work_price: 1220000, work_price_ex_vat: 1000000, report_json: {} }, { vat_pct: 22 });
  assert.strictEqual(p.priceNoVat, 1000000, 'взяли цену с НДС вместо цены без НДС');
});

check('readPricing: при отсутствии цены берёт смету', () => {
  const smeta = makeSmeta();
  const p = svc.readPricing({ work_price: null, report_json: { asgard_smeta: smeta } }, {});
  assert.strictEqual(p.priceNoVat, smeta.totals.price_no_vat);
  assert.strictEqual(p.priceWithVat, smeta.totals.price_with_vat);
});

check('readPricing: НДС 0% не подменяется на 22', () => {
  const p = svc.readPricing(
    { work_price_ex_vat: 1000000, report_json: { asgard_smeta: { totals: { vat_pct: 0, price_no_vat: 1000000, price_with_vat: 1000000 } } } },
    {}
  );
  assert.strictEqual(p.vatPct, 0);
  assert.strictEqual(p.priceWithVat, 1000000);
});

check('readPricing: легаси 20% → 22% с 2026, withVat пересчитывается', () => {
  const p = svc.readPricing(
    { work_price_ex_vat: 20833333.33, work_price: 25000000, report_json: {} },
    { vat_pct: 20 }
  );
  assert.strictEqual(p.vatPct, 22);
  assert.strictEqual(p.priceNoVat, 20833333.33);
  assert.ok(Math.abs(p.priceWithVat - round2Expected(20833333.33 * 1.22)) < 0.02, String(p.priceWithVat));
});

check('normalizeVatPct: канон 0/5/10/22, прочее → 22', () => {
  assert.strictEqual(svc.normalizeVatPct(0), 0);
  assert.strictEqual(svc.normalizeVatPct(5), 5);
  assert.strictEqual(svc.normalizeVatPct(10), 10);
  assert.strictEqual(svc.normalizeVatPct(22), 22);
  assert.strictEqual(svc.normalizeVatPct(20), 22);
  assert.strictEqual(svc.normalizeVatPct(null), 22);
  assert.strictEqual(svc.normalizeVatPct(18), 22);
});

function round2Expected(v) {
  return Math.round(Number(v) * 100) / 100;
}

check('readPricing: легаси tender.vat_pct=20 нормализуется в 22', () => {
  const p = svc.readPricing({ work_price: 1000000, report_json: {} }, { vat_pct: 20 });
  assert.strictEqual(p.vatPct, 22);
  assert.strictEqual(p.priceWithVat, 1220000);
});

/* ───────── 11. Промпт не содержит внутренних цифр ───────── */

check('buildPromptContext не пропускает себестоимость и маржу в промпт', () => {
  const smeta = makeSmeta();
  const tender = {
    id: 1, customer_name: 'ООО «Ромашка»', tender_title: 'Очистка',
    tender_description: 'Нужна очистка.\nСебестоимость подрядчика 416 000 руб.\nМаржа 2,2.'
  };
  const review = {
    work_price: 915200, is_final: true, decision: 'submit',
    report_json: {
      asgard_smeta: smeta,
      duration_days: 15,
      scope: 'Очистка двух аппаратов. ФОТ бригады 300 000 руб.',
      analysis_snapshot: { summary: 'Работа выполнима.', risks: 'Маржа низкая.' }
    }
  };
  const ctx = svc.buildPromptContext({ tender, review, checklist: null, docs: [], pricing: svc.readPricing(review, tender) });
  const blob = JSON.stringify(ctx);

  const leaks = ['416 000', 'себестоимост', 'Маржа', 'ФОТ бригады', '300 000']
    .filter((s) => blob.toLowerCase().includes(String(s).toLowerCase()));

  assert.deepStrictEqual(leaks, [], 'в промпт протекло: ' + leaks.join(', '));
});

check('buildPromptContext отдаёт работы, но не статьи затрат и не цены', () => {
  const smeta = makeSmeta();
  const tender = { id: 1, customer_name: 'X', tender_title: 'Очистка теплообменников' };
  const review = {
    work_price: 915200,
    report_json: {
      asgard_smeta: smeta,
      scope: 'Очистка кожухотрубных теплообменников\nПромывка трубного пространства'
    }
  };
  const ctx = svc.buildPromptContext({ tender, review, checklist: null, docs: [], pricing: svc.readPricing(review, tender) });

  assert.ok(/Очистка кожухотрубных теплообменников/.test(ctx.work_names), 'нет работ: ' + ctx.work_names);
  assert.ok(!/СИЗ/i.test(ctx.work_names), 'в промпт попала статья затрат СИЗ: ' + ctx.work_names);
  assert.ok(!/ФОТ/i.test(ctx.work_names), 'в промпт попал ФОТ: ' + ctx.work_names);
  assert.ok(!/85000|85 000|40000|40 000|21000|21 000/.test(ctx.work_names), 'в промпт попали цены');
});

check('сам промпт-шаблон загружается и подставляет плейсхолдеры', () => {
  const ctx = { customer_name: 'ООО «Ромашка»', tender_title: 'Очистка', work_names: '1. Промывка линий' };
  const s = svc.buildSystemPrompt(ctx);
  assert.ok(s.indexOf('ООО «Ромашка»') !== -1, 'заказчик не подставлен');
  assert.ok(s.indexOf('1. Промывка линий') !== -1, 'работы не подставлены');
  assert.ok(s.indexOf('{{') === -1, 'остались неподставленные плейсхолдеры');
});

check('в промпте перечислены запреты на внутреннюю кухню и ИИ-штампы', () => {
  const s = svc.buildSystemPrompt({});
  const must = ['себестоимост', 'маржа', 'наценка', 'ФОТ', 'пайковые', 'таким образом', 'позволит', 'является'];
  const missing = must.filter((w) => s.toLowerCase().indexOf(w.toLowerCase()) === -1);
  assert.deepStrictEqual(missing, [], 'в промпте нет запретов: ' + missing.join(', '));
});

/* ───────── 12. Директор: отклонено/ждёт — ТКП не формируется ───────── */

check('assertReviewReady: директор отклонил — отказ director_rejected', () => {
  // Серверный запрет: раньше на отклонённом директором просчёте черновик
  // строился, хотя в реестре для этого состояния рисуется «✕ Отклонено».
  let code = null;
  try {
    svc.assertReviewReady({ is_final: true, decision: 'submit', director_review_status: 'rejected' });
  } catch (e) {
    code = e.code;
  }
  assert.strictEqual(code, 'director_rejected', 'ожидали director_rejected, получили ' + code);
});

check('assertReviewReady: директор ждёт — отказ director_pending', () => {
  let code = null;
  try {
    svc.assertReviewReady({ is_final: true, decision: 'submit', director_review_status: 'pending' });
  } catch (e) {
    code = e.code;
  }
  assert.strictEqual(code, 'director_pending', 'ожидали director_pending, получили ' + code);
});

check('assertReviewReady: согласовано директором — пропускает', () => {
  assert.doesNotThrow(() => {
    svc.assertReviewReady({ is_final: true, decision: 'submit', director_review_status: 'approved' });
  });
});

check('assertReviewReady: просчёт не закрыт — отказ review_not_ready', () => {
  let code = null;
  try {
    svc.assertReviewReady({ is_final: false, decision: 'submit' });
  } catch (e) {
    code = e.code;
  }
  assert.strictEqual(code, 'review_not_ready');
});

check('assertReviewReady: нет просчёта — отказ no_review', () => {
  let code = null;
  try {
    svc.assertReviewReady(null);
  } catch (e) {
    code = e.code;
  }
  assert.strictEqual(code, 'no_review');
});

/* ───────── итог ───────── */

console.log('');
console.log('tkp-ai-draft: ' + passed + '/' + (passed + failed) + ' проверок пройдено');
if (failed) {
  console.log('');
  failures.forEach((f) => {
    console.log('FAIL: ' + f.name);
    console.log('      ' + f.error);
  });
  process.exit(1);
}
console.log('OK');

/* ───────── итог ───────── */

console.log('');
console.log('tkp-ai-draft: ' + passed + '/' + (passed + failed) + ' проверок пройдено');
if (failed) {
  console.log('');
  failures.forEach((f) => {
    console.log('FAIL: ' + f.name);
    console.log('      ' + f.error);
  });
  process.exit(1);
}
console.log('OK');
