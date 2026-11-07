'use strict';
/**
 * Назначение документа и отсев мусора перед промптом.
 *
 * Дефект 06.11.2026 (замечание РП): в промпт Мимира уходили договоры,
 * наши ТКП, шаблоны и по 5 копий одного ТЗ из разных архивов —
 * 1,3 млн символов, 60–70 % без объёмов.
 */
const assert = require('assert');
const role = require('../src/services/doc-role');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

// ── 1. Назначение по имени ───────────────────────────────────────────────────
const NAME_CASES = [
  ['ВОР.xlsx', 'vor'],
  ['Ведомость объёмов работ.xlsx', 'vor'],
  ['ТЗ на чистку теплообменного оборудования.docx', 'tz'],
  ['Техническое задание  КА 00020498.xlsx', 'tz'],
  ['Дефектная ведомость.pdf', 'act'],
  ['Локальная смета.xlsx', 'estimate'],
  ['Спецификация оборудования.xlsx', 'spec'],
  ['Договор поставки №17.docx', 'contract'],
  ['Соглашение ПБ БРД_2026 МсНГ.docx', 'contract'],
  ['ТКП Асгард.pdf', 'tkp'],
  ['Коммерческое предложение.pdf', 'tkp'],
  ['Шаблон сметы.xlsx', 'template'],
  ['Счёт на оплату.pdf', 'invoice'],
  ['Приложение 1 к ТЗ.docx', 'tz']
];

check('назначение определяется по имени файла', () => {
  for (const [name, expected] of NAME_CASES) {
    const r = role.detectRole({ name });
    assert.strictEqual(r.role, expected, `${name} → ${r.role}, ожидалось ${expected}`);
  }
});

check('договор и ТКП помечены «не нужен»', () => {
  for (const name of ['Договор поставки.docx', 'ТКП наша.pdf', 'Шаблон.xlsx', 'Счёт.pdf']) {
    assert.strictEqual(role.detectRole({ name }).use, false, name + ' не должен идти в промпт');
  }
});

check('ВОР и ТЗ помечены «нужен» с высоким весом', () => {
  const vor = role.detectRole({ name: 'ВОР.xlsx' });
  const tz = role.detectRole({ name: 'ТЗ.docx' });
  assert.strictEqual(vor.use, true);
  assert.ok(vor.weight >= 4, 'ВОР должен иметь высокий вес, а он ' + vor.weight);
  assert.strictEqual(tz.use, true);
  assert.ok(tz.weight >= 3);
});

check('названия на русском: роль отдаётся человеку', () => {
  assert.strictEqual(role.detectRole({ name: 'ВОР.xlsx' }).title, 'Ведомость объёмов');
  assert.strictEqual(role.detectRole({ name: 'Договор.docx' }).title, 'Договор / контракт');
});

check('неизвестное имя не выбрасывается сразу', () => {
  const r = role.detectRole({ name: 'scan_0001.pdf' });
  assert.strictEqual(r.role, 'unknown');
  assert.strictEqual(r.use, true, 'неизвестный файл может быть ВОРом — не режем без текста');
});

check('назначение по тексту, если имя не говорит', () => {
  const r = role.detectRole({ name: 'scan_0001.pdf', text: 'ТЕХНИЧЕСКОЕ ЗАДАНИЕ\nна выполнение работ' });
  assert.strictEqual(r.role, 'tz');
  assert.strictEqual(r.source, 'text');
});

check('нормативные документы заказчика отсеиваются', () => {
  const CASES = [
    ['Приложение №9 - ПВД 137-2021.doc', 'ПОЛОЖЕНИЕ О Системе Обеспечения безопасности Дорожного движения'],
    ['Приложение №3 - СТО Ч-38-2021.doc', 'СТАНДАРТ ОРГАНИЗАЦИИ Система менеджмента'],
    ['Приложение №7 - Краткое изложение требований.doc', 'Краткое изложение требований в области охраны труда'],
    ['Инструкция по охране труда.doc', 'ИНСТРУКЦИЯ ПО ОХРАНЕ ТРУДА'],
    ['Положение о пропускном режиме.docx', 'ПОЛОЖЕНИЕ О пропускном режиме']
  ];
  for (const [name, text] of CASES) {
    const r = role.detectRole({ name, text });
    assert.strictEqual(r.use, false, `${name} должен быть отсеян, а роль ${r.role}`);
  }
});

check('нормативный документ не путается с ВОРом или ТЗ', () => {
  const r = role.detectRole({ name: 'Приложение №9 - ПВД 137-2021.doc', text: 'ПОЛОЖЕНИЕ' });
  assert.strictEqual(r.role, 'regdoc');
  assert.strictEqual(r.title, 'Нормативный документ заказчика');
});

check('бланки пропусков и допусков отсеиваются', () => {
  const CASES = [
    'Оформление разового пропуска.docx',
    'Оформление транспортного пропуска.docx',
    'Согласование разового пропуска.docx',
    'Наряд-допуск на производство работ.docx',
    'Форма по ЛКО ЕАМ_АП-Ч.318-003.docx'
  ];
  for (const name of CASES) {
    const r = role.detectRole({ name });
    assert.strictEqual(r.use, false, `${name} должен быть отсеян, а роль ${r.role}`);
  }
});

check('ВОР с упоминанием ГОСТ не отсеивается', () => {
  const r = role.detectRole({ name: 'ВОР по ГОСТ 8.586.xlsx' });
  assert.strictEqual(r.role, 'vor');
  assert.strictEqual(r.use, true);
});

// ── 2. Схлопывание копий ─────────────────────────────────────────────────────
const SAME_TEXT = 'Ведомость объёмов работ. Зачистка резервуара РВС-5000. Объём 5000 м3.';
const SAME_TEXT_ALT = 'Ведомость  объёмов работ. Зачистка резервуара РВС-5000. Объём 5000 м3.';

check('копии с одинаковым текстом схлопываются', () => {
  const out = role.selectForPrompt([
    { original_name: 'ТЗ.pdf', text: SAME_TEXT },
    { original_name: 'ТЗ (1).pdf', text: SAME_TEXT },
    { original_name: 'ТЗ из архива.pdf', text: SAME_TEXT_ALT }
  ]);
  assert.strictEqual(out.selected.length, 1, 'должна остаться 1 копия, а осталось ' + out.selected.length);
  assert.strictEqual(out.duplicates.length, 2);
  assert.ok(out.duplicates.some((d) => d.copy_of === 'ТЗ.pdf'), 'не указано, чья это копия');
});

check('разные документы не схлопываются', () => {
  const out = role.selectForPrompt([
    { original_name: 'ТЗ.pdf', text: 'Техническое задание на чистку теплообменников, срок 30 суток.' },
    { original_name: 'ВОР.xlsx', text: 'Ведомость объёмов: 12 аппаратов, 3400 м2 поверхности.' }
  ]);
  assert.strictEqual(out.selected.length, 2);
  assert.strictEqual(out.duplicates.length, 0);
});

check('одинаковый текст под разными именами — копия', () => {
  const out = role.selectForPrompt([
    { original_name: 'Приложение 1 к ТЗ.docx', text: SAME_TEXT },
    { original_name: 'Техническое задание.docx', text: SAME_TEXT }
  ]);
  assert.strictEqual(out.selected.length, 1);
});

check('копии с расхождениями OCR схлопываются', () => {
  const base = ('Ведомость объёмов работ по зачистке теплообменников. ' +
    'Позиция 1: аппарат 31Т-01, поверхность 340 м2. '.repeat(6));
  const variant = base.replace('340 м2', '34O м2').replace('31Т-01', '31T-O1');
  const out = role.selectForPrompt([
    { original_name: 'ТЗ.pdf', text: base },
    { original_name: 'ТЗ (2).pdf', text: variant }
  ]);
  assert.strictEqual(out.selected.length, 1, 'копия не схлопнулась');
  assert.strictEqual(out.duplicates[0].match, 'распознано иначе');
});

check('разные документы с общим началом не схлопываются', () => {
  const head = 'Ведомость объёмов работ. Зачистка оборудования. '.repeat(4);
  const out = role.selectForPrompt([
    { original_name: 'ВОР часть 1.xlsx', text: head + 'Аппарат А: 120 м3. Аппарат Б: 340 м3. Ёмкость В: 56 м3.' },
    { original_name: 'ВОР часть 2.xlsx', text: head + 'Котёл Г: 900 м3. Резервуар Д: 5000 м3. Бункер Е: 12 м3.' }
  ]);
  assert.strictEqual(out.selected.length, 2, 'разные части ВОР схлопнулись');
});

// ── 3. Отсев мусора ──────────────────────────────────────────────────────────
check('договоры, ТКП и шаблоны не идут в промпт', () => {
  const out = role.selectForPrompt([
    { original_name: 'ВОР.xlsx', text: SAME_TEXT },
    { original_name: 'Договор поставки.docx', text: 'ДОГОВОР ПОСТАВКИ № 17. Настоящий договор заключён между...' },
    { original_name: 'ТКП Асгард.pdf', text: 'Коммерческое предложение. Стоимость работ составляет...' },
    { original_name: 'Шаблон сметы.xlsx', text: 'Шаблон формы КС-2 для заполнения...' }
  ]);
  assert.strictEqual(out.selected.length, 1, 'в промпт должен уйти только ВОР');
  assert.strictEqual(out.selected[0].original_name, 'ВОР.xlsx');
  assert.strictEqual(out.dropped.length, 3);
  assert.ok(out.dropped.every((d) => d.reason === 'не нужен для объёмов'));
});

check('пустые документы не занимают бюджет', () => {
  const out = role.selectForPrompt([
    { original_name: 'ВОР.xlsx', text: SAME_TEXT },
    { original_name: 'пустой.pdf', text: '   ' }
  ]);
  assert.strictEqual(out.selected.length, 1);
  assert.ok(out.dropped.some((d) => d.reason === 'нет текста'));
});

// ── 4. Экономия ──────────────────────────────────────────────────────────────
check('считает экономию символов', () => {
  // Текст без хвостового пробела: при отборе он обрезается, длина должна совпасть.
  const big = ('Ведомость объёмов работ. '.repeat(100)).trim();
  const contract = 'ДОГОВОР. '.repeat(400);
  const out = role.selectForPrompt([
    { original_name: 'ВОР.xlsx', text: big },
    { original_name: 'Договор.docx', text: contract },
    { original_name: 'Договор (копия).docx', text: contract }
  ]);
  assert.ok(out.stats.saved_pct > 50, 'экономия должна быть больше 50 %, а вышло ' + out.stats.saved_pct);
  assert.strictEqual(out.stats.chars_after, big.length);
});

check('журнал отбора читаем по-русски', () => {
  const out = role.selectForPrompt([
    { original_name: 'ВОР.xlsx', text: SAME_TEXT },
    { original_name: 'ВОР (1).xlsx', text: SAME_TEXT },
    { original_name: 'Договор.docx', text: 'ДОГОВОР. Настоящий договор...' }
  ]);
  const txt = role.describeSelection(out);
  assert.ok(/документов: 3/.test(txt), txt);
  assert.ok(/копий схлопнуто: 1/.test(txt), txt);
  assert.ok(/\(−\d+ %\)/.test(txt), 'нет процента экономии: ' + txt);
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
