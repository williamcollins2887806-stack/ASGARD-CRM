'use strict';

const assert = require('assert');
const ExcelJS = require('exceljs');
const {
  buildApplicationExcel,
  buildPreviewMatrix,
  filenameFor,
  SHEET_BY_TYPE,
  TEMPLATE_PATH
} = require('../src/services/mlsp-passes-excel');
const fs = require('fs');

const samplePeople = [{
  fio: 'Зубань Руслан Владимирович',
  phone: '+7 922 071-72-33',
  position: 'Ведущий инженер',
  birth_date: '1979-04-05',
  birth_place: 'г. Киров',
  passport_series: '7124',
  passport_number: '876280',
  passport_date: '2010-01-01',
  passport_issued: 'ОВД',
  registration_address: 'г. Киров',
  org: 'ООО «АСГАРД-Сервис»',
  curator: 'Марков М.В.',
  contract_number: 'ГНШ-24/10000/00056/Р от 01.04.24 г.',
  mvz: '5850374402',
  fsb_doc: '34/И №31763-01',
  permits_text: 'пропуск ФСБ'
}];

async function assertSingleSheet(buf, expectedName) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  assert.strictEqual(wb.worksheets.length, 1, 'должен быть ровно один лист');
  assert.strictEqual(wb.worksheets[0].name, expectedName);
  return wb.worksheets[0];
}

async function run() {
  assert.ok(fs.existsSync(TEMPLATE_PATH), 'шаблон base-generator.xlsx должен лежать в templates/mlsp');

  const types = ['flight', 'ship', 'pass_35srz', 'pass_mmrp', 'pass_mlsp', 'pass_fsb'];
  for (const app_type of types) {
    const app = {
      app_type,
      contract_number: 'ГНШ-24/10000/00056/Р от 01.04.24 г.',
      curator: 'Марков М.В.',
      ship_curator: 'Марков М.В.',
      date_from: '2026-11-09',
      date_to: '2026-11-15',
      direction: 'inbound',
      transport: app_type === 'ship' ? 'ship' : 'plane',
      outgoing_number: '141603/02',
      people: samplePeople,
      purpose_text: 'работы',
      pass_kind: app_type === 'pass_fsb' ? 'individual' : 'разовый',
      mvz: '5850374402'
    };
    const buf = await buildApplicationExcel(app);
    assert.ok(Buffer.isBuffer(buf) && buf.length > 3000, app_type + ' too small: ' + buf.length);
    assert.ok(filenameFor({ app_type, date_from: '2026-11-09' }).endsWith('.xlsx'));

    const expected = app_type === 'pass_fsb' ? 'Пропуск_ФСБ' : SHEET_BY_TYPE[app_type];
    const ws = await assertSingleSheet(buf, expected);

    if (app_type === 'flight') {
      const fio = ws.getCell('C15').value;
      assert.strictEqual(fio, samplePeople[0].fio, 'ФИО в C15');
      const org = ws.getCell('D15').value;
      assert.ok(org && !String(org).startsWith('='), 'организация без формулы');
      assert.ok(String(ws.getCell('B13').value || '').includes('АРХАНГЕЛЬСК'), 'маршрут туда');
    }
    if (app_type === 'ship') {
      assert.strictEqual(ws.getCell('B10').value, samplePeople[0].fio);
      assert.ok(!String(ws.getCell('C10').value || '').startsWith('='));
    }
    if (app_type === 'pass_mlsp') {
      assert.ok(String(ws.getCell('A5').value || '').includes('141603/02'));
      assert.ok(!String(ws.getCell('B14').value || '').startsWith('='));
      assert.ok(String(ws.getCell('B14').value || '').includes('Зубань'));
    }

    const preview = await buildPreviewMatrix(app);
    assert.ok(preview.rows && preview.rows.length > 2, app_type + ' preview rows');
    assert.strictEqual(preview.sheet, expected);
  }

  console.log('mlsp-passes-excel.test.js OK', types.length, 'template-parity');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
