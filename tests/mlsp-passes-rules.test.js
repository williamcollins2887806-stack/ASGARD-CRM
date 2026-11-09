'use strict';

const assert = require('assert');
const {
  evaluateApplication,
  passportStatus,
  registrySignal,
  findPermit,
  permitCovers,
  defaultPack,
  PERMIT_CODE_ALIASES,
  addDays,
  ymd
} = require('../src/services/mlsp-passes-rules');

/** Канон пакета = коды Дружины (без NAKS — он только по должности) */
const PACK_CODES = defaultPack().map((p) => p.code);

function person(over = {}) {
  return {
    id: 1,
    fio: 'Тестов Тест Тестович',
    birth_date: '1990-01-15',
    passport_date: '2015-02-01',
    passport_series: '1234',
    passport_number: '567890',
    phone: '+79001112233',
    registration_address: 'г. Москва',
    position: 'Слесарь',
    permits: [
      { code: 'MEDCHECK', expiry_date: '2027-01-01', name: 'Медицинский осмотр' },
      { code: 'OFFSHORE_MED', expiry_date: '2027-01-01', name: 'Морской медицинский осмотр' },
      { code: 'PSYCH', expiry_date: '2027-01-01', name: 'Психиатрическое освидетельствование' },
      { code: 'BOSIET', expiry_date: '2027-01-01', name: 'БОСИЕТ' },
      { code: 'HELICOPTER', expiry_date: '2027-01-01', name: 'Вертолётная подготовка (HUET)' },
      { code: 'HEIGHT_1', expiry_date: '2027-01-01', name: 'Работы на высоте (1 группа)' },
      { code: 'PTM', expiry_date: '2027-01-01', name: 'Пожарная безопасность (ПТМ)' },
      { code: 'OT', expiry_date: '2027-01-01', name: 'Охрана труда (ОТ)' },
      { code: 'PMP', expiry_date: '2027-01-01', name: 'Первая медицинская помощь (ПМП)' },
      { code: 'CONFINED', expiry_date: '2027-01-01', name: 'Работа в замкнутых пространствах' },
      { code: 'GAS_HAZARD', expiry_date: '2027-01-01', name: 'Газоопасные работы' },
      { code: 'ICE_CLASS', expiry_date: '2027-01-01', name: 'Ледовый класс' },
      { code: 'FSB', expiry_date: '2027-06-01', name: 'Пропуск ФСБ' },
      { code: 'MLSP_PASS', expiry_date: '2027-06-01', name: 'Пропуск МЛСП' }
    ],
    ...over
  };
}

function testPassportWarnNotBlock() {
  const p = person({ passport_date: '2008-01-01', birth_date: '1980-01-01' });
  const st = passportStatus(p, '2026-11-09');
  assert.strictEqual(st.ok, false, 'просроченный паспорт — статус ok=false');
  const r = evaluateApplication({
    appType: 'flight',
    people: [p],
    dateFrom: '2026-11-20',
    direction: 'inbound'
  });
  assert.strictEqual(r.ok, true, 'Excel не блокируем');
  assert.strictEqual(r.blocks.length, 0, 'blocks пуст');
  assert.ok(r.warnings.some((w) => w.code === 'passport'), 'паспорт — WARN');
}

function testFlightOk() {
  const r = evaluateApplication({
    appType: 'flight',
    people: [person()],
    dateFrom: '2026-11-20',
    dateTo: '2026-11-20',
    direction: 'inbound'
  });
  assert.strictEqual(r.ok, true, 'полный пакет — ok');
  assert.strictEqual(r.blocks.length, 0);
}

function testFlightNoBosietIsWarn() {
  const p = person({
    permits: person().permits.filter((x) => x.code !== 'BOSIET')
  });
  const r = evaluateApplication({
    appType: 'flight',
    people: [p],
    dateFrom: '2026-11-20',
    direction: 'inbound'
  });
  assert.ok(r.warnings.some((w) => w.code === 'BOSIET'), 'нет BOSIET — WARN');
  assert.strictEqual(r.ok, true, 'скачивание разрешено');
  assert.strictEqual(r.blocks.length, 0);
}

function testWelderNaksWarn() {
  const p = person({
    position: 'Сварщик РДС',
    permits: person().permits.filter((x) => x.code !== 'NAKS')
  });
  const r = evaluateApplication({
    appType: 'flight',
    people: [p],
    dateFrom: '2026-11-20',
    direction: 'inbound'
  });
  assert.ok(r.warnings.some((w) => w.code === 'NAKS'), 'сварщик без НАКС — WARN');
  assert.strictEqual(r.ok, true);
}

function testPassDuplicateWarn() {
  const r = evaluateApplication({
    appType: 'pass_mlsp',
    people: [person()],
    dateFrom: '2026-11-20',
    dateTo: '2026-12-20',
    contractMeta: { end_date: '2027-12-31', mvz: '1' },
    contractNumber: 'ГНШ-тест'
  });
  assert.ok(r.warnings.some((w) => w.code === 'pass_duplicate'), 'дубль МЛСП — WARN');
  assert.strictEqual(r.ok, true, JSON.stringify(r.blocks));
}

function testContractEndHint() {
  const r = evaluateApplication({
    appType: 'pass_mlsp',
    people: [person({ permits: [] })],
    dateFrom: '2026-11-20',
    contractMeta: {},
    contractNumber: 'X'
  });
  assert.ok(r.warnings.some((w) => w.code === 'contract_end'), 'нет end_date — WARN с подсказкой');
  assert.strictEqual(r.ok, true);
}

function testRegistryBreach() {
  const sig = registrySignal({
    request_date: '2026-08-17',
    planned_ready: '2026-10-01',
    status: 'В работе'
  }, '2026-11-09');
  assert.strictEqual(sig.signal, 'breach');
}

function testWarnNotBlockFsb() {
  const p = person({
    permits: person().permits.filter((x) => x.code !== 'FSB')
  });
  const r = evaluateApplication({
    appType: 'flight',
    people: [p],
    dateFrom: '2026-11-20',
    direction: 'inbound'
  });
  assert.ok(r.warnings.some((w) => w.code === 'FSB'), 'нет ФСБ — WARN');
  assert.ok(!r.blocks.some((b) => b.code === 'FSB'), 'ФСБ не BLOCK');
  assert.strictEqual(r.ok, true);
}

/** Каждый код пакета: нет → WARN, есть → нет WARN по этому коду, blocks=0 */
function testEachPackCodeMissingIsWarn() {
  for (const code of PACK_CODES) {
    const p = person({
      permits: person().permits.filter((x) => x.code !== code)
    });
    // HELICOPTER закрывается BOSIET — убираем оба
    if (code === 'HELICOPTER') {
      p.permits = p.permits.filter((x) => x.code !== 'BOSIET');
    }
    const r = evaluateApplication({
      appType: 'flight',
      people: [p],
      dateFrom: '2026-11-20',
      direction: 'inbound',
      pack: defaultPack()
    });
    assert.strictEqual(r.ok, true, `${code}: ok`);
    assert.strictEqual(r.blocks.length, 0, `${code}: без блоков`);
    assert.ok(
      r.warnings.some((w) => w.code === code),
      `${code}: нет допуска — WARN. warnings=${r.warnings.map((w) => w.code).join(',')}`
    );
    const w = r.warnings.find((x) => x.code === code);
    assert.ok(/[А-Яа-яЁё]/.test(w.message || ''), `${code}: сообщение на русском: ${w.message}`);
  }
}

function testEachPackCodePresentNoWarn() {
  for (const code of PACK_CODES) {
    const r = evaluateApplication({
      appType: 'flight',
      people: [person()],
      dateFrom: '2026-11-20',
      direction: 'inbound',
      pack: defaultPack()
    });
    assert.ok(
      !r.warnings.some((w) => w.code === code),
      `${code}: полный пакет — без WARN по коду`
    );
  }
}

/** Каждый алиас закрывает канон (только коды справочника) */
function testEveryAliasCoversCanon() {
  const cases = [
    { need: 'HEIGHT_1', have: 'HEIGHT_2', label: 'высота 2 → 1' },
    { need: 'HEIGHT_1', have: 'HEIGHT_3', label: 'высота 3 → 1' },
    { need: 'HEIGHT_1', have: 'OTZP_2', label: 'ОТЗП 2 → высота 1' },
    { need: 'HEIGHT_1', have: 'OTZP_3', label: 'ОТЗП 3 → высота 1' },
    { need: 'HEIGHT_2', have: 'HEIGHT_3', label: 'высота 3 → 2' },
    { need: 'HELICOPTER', have: 'BOSIET', label: 'БОСИЕТ → HUET' },
    { need: 'PMP', have: 'FIRST_AID', label: 'первая помощь → ПМП' },
    { need: 'PTM', have: 'FIRE_SAFETY', label: 'пожарная → ПТМ' },
    { need: 'OT', have: 'OT_A', label: 'ОТ гр.А → ОТ' },
    { need: 'OT', have: 'OT_V', label: 'ОТ гр.В → ОТ' },
    { need: 'OT', have: 'OT_B', label: 'ОТ гр.Б → ОТ' },
    { need: 'NAKS', have: 'WELD_RD', label: 'РДС → НАКС' },
    { need: 'PROMBEZ', have: 'PB_B2', label: 'ПБ Б.2 → промбез' }
  ];
  for (const c of cases) {
    const hit = findPermit([{ code: c.have, expiry_date: '2027-06-01' }], c.need);
    assert.ok(hit, `${c.label}: findPermit`);
    const cover = permitCovers(hit, '2026-11-20', '2026-11-20');
    assert.ok(cover.ok, `${c.label}: покрывает дату`);
  }
}

function testExpiredPermitIsWarnRussian() {
  const p = person({
    permits: person().permits.map((x) =>
      x.code === 'BOSIET' ? { ...x, expiry_date: '2020-01-01' } : x
    )
  });
  const r = evaluateApplication({
    appType: 'flight',
    people: [p],
    dateFrom: '2026-11-20',
    direction: 'inbound',
    pack: defaultPack()
  });
  const w = r.warnings.find((x) => x.code === 'BOSIET');
  assert.ok(w, 'просроченный БОСИЕТ — WARN');
  assert.ok(/просрочен/.test(w.message), w.message);
  assert.strictEqual(r.blocks.length, 0);
}

function testNameGuessingForbidden() {
  // Имя похожее, код чужой — не засчитываем
  const hit = findPermit(
    [{ code: 'OTHER', name: 'БОСИЕТ тренинг', expiry_date: '2027-01-01' }],
    'BOSIET'
  );
  assert.strictEqual(hit, null, 'угадывание по имени запрещено');
}

function testAliasesOnlyCatalogCodes() {
  for (const [canon, aliases] of Object.entries(PERMIT_CODE_ALIASES)) {
    assert.ok(Array.isArray(aliases) && aliases.length, `${canon}: список алиасов`);
    for (const a of aliases) {
      assert.ok(/^[A-Z0-9_]+$/.test(a), `${canon}/${a}: только код справочника`);
    }
  }
  for (const code of PACK_CODES) {
    assert.ok(PERMIT_CODE_ALIASES[code], `${code}: есть в PERMIT_CODE_ALIASES`);
  }
}

function testDefaultPackLabelsRussian() {
  for (const p of defaultPack()) {
    assert.ok(/[А-Яа-яЁё]/.test(p.label), `${p.code}: русская подпись`);
    assert.strictEqual(p.severity, 'warn');
  }
}

testPassportWarnNotBlock();
testFlightOk();
testFlightNoBosietIsWarn();
testWelderNaksWarn();
testPassDuplicateWarn();
testContractEndHint();
testRegistryBreach();
testWarnNotBlockFsb();
testEachPackCodeMissingIsWarn();
testEachPackCodePresentNoWarn();
testEveryAliasCoversCanon();
testExpiredPermitIsWarnRussian();
testNameGuessingForbidden();
testAliasesOnlyCatalogCodes();
testDefaultPackLabelsRussian();
assert.ok(ymd(new Date()));
assert.ok(addDays('2026-01-01', 45) === '2026-02-15');

console.log('mlsp-passes-rules.test.js OK');
console.log(`  pack codes tested: ${PACK_CODES.length}`);
console.log(`  alias canons: ${Object.keys(PERMIT_CODE_ALIASES).length}`);
