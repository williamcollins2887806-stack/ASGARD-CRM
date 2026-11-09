'use strict';

const assert = require('assert');
const {
  evaluateApplication,
  passportStatus,
  registrySignal,
  addDays,
  ymd
} = require('../src/services/mlsp-passes-rules');

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
    permits: [
      { code: 'MED_EXAM', expiry_date: '2027-01-01', name: 'Медосмотр' },
      { code: 'offshore_med', expiry_date: '2027-01-01', name: 'Шельф мед' },
      { code: 'PSYCH_EXAM', expiry_date: '2027-01-01', name: 'Психиатрия' },
      { code: 'BOSIET', expiry_date: '2027-01-01', name: 'BOSIET' },
      { code: 'helicopter', expiry_date: '2027-01-01', name: 'HUET' },
      { code: 'height_1', expiry_date: '2027-01-01', name: 'Высота' },
      { code: 'fire', expiry_date: '2027-01-01', name: 'Пожарка' },
      { code: 'labor', expiry_date: '2027-01-01', name: 'ОТ' },
      { code: 'first_aid', expiry_date: '2027-01-01', name: 'Первая помощь' },
      { code: 'confined', expiry_date: '2027-01-01', name: 'Закрытые' },
      { code: 'gas_hazard', expiry_date: '2027-01-01', name: 'Газ' },
      { code: 'ice_class', expiry_date: '2027-01-01', name: 'Лёд' },
      { code: 'FSB', expiry_date: '2027-06-01', name: 'ФСБ' },
      { code: 'MLSP_PASS', expiry_date: '2027-06-01', name: 'Пропуск МЛСП' }
    ],
    ...over
  };
}

function testPassportBlock() {
  const p = person({ passport_date: '2008-01-01', birth_date: '1980-01-01' }); // 45+ and old passport
  const st = passportStatus(p, '2026-11-09');
  assert.strictEqual(st.ok, false, 'просроченный паспорт должен блокировать');
}

function testFlightOk() {
  const r = evaluateApplication({
    appType: 'flight',
    people: [person()],
    dateFrom: '2026-11-20',
    dateTo: '2026-11-20',
    direction: 'inbound'
  });
  assert.strictEqual(r.ok, true, 'полный пакет — без блоков: ' + JSON.stringify(r.blocks));
}

function testFlightNoBosiet() {
  const p = person({
    permits: person().permits.filter((x) => x.code !== 'BOSIET')
  });
  const r = evaluateApplication({
    appType: 'flight',
    people: [p],
    dateFrom: '2026-11-20',
    direction: 'inbound'
  });
  assert.ok(r.blocks.some((b) => b.code === 'bosiet'), 'нет BOSIET — BLOCK');
  assert.strictEqual(r.ok, false);
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
  // still may have blocks if pack incomplete — person has full pack
  assert.strictEqual(r.ok, true, JSON.stringify(r.blocks));
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
}

testPassportBlock();
testFlightOk();
testFlightNoBosiet();
testPassDuplicateWarn();
testRegistryBreach();
testWarnNotBlockFsb();
assert.ok(ymd(new Date()));
assert.ok(addDays('2026-01-01', 45) === '2026-02-15');

console.log('mlsp-passes-rules.test.js OK');
