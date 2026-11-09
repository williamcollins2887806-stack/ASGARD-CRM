'use strict';

const assert = require('assert');
const ExcelJS = require('exceljs');
const fs = require('fs');
const crypto = require('crypto');
const {
  buildApplicationExcel,
  buildPreviewDocument,
  filenameFor,
  SHEET_BY_TYPE,
  TEMPLATE_PATH,
  FSB_TEMPLATE_PATH
} = require('../src/services/mlsp-passes-excel');

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
  assert.ok(fs.existsSync(TEMPLATE_PATH), 'base-generator.xlsx');
  assert.ok(fs.existsSync(FSB_TEMPLATE_PATH), 'fsb-petition.xlsx');

  const md5 = crypto.createHash('md5').update(fs.readFileSync(TEMPLATE_PATH)).digest('hex');
  assert.strictEqual(md5, 'b781eb4a5ede1e8f01a0205c2bba583a', 'шаблон должен быть байт-в-байт «База и генератор заявок (5).xlsx»');

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
      purpose_text: 'работы по договору на МЛСП «Приразломная»',
      pass_kind: app_type === 'pass_fsb' ? 'individual' : 'разовый',
      mvz: '5850374402'
    };
    const buf = await buildApplicationExcel(app);
    assert.ok(Buffer.isBuffer(buf) && buf.length > 3000, app_type + ' too small: ' + buf.length);

    const expected = app_type === 'pass_fsb' ? 'ФСБ_прил3' : SHEET_BY_TYPE[app_type];
    const ws = await assertSingleSheet(buf, expected);

    if (app_type === 'flight') {
      assert.strictEqual(ws.getCell('C15').value, samplePeople[0].fio);
      assert.ok(!String(ws.getCell('D15').value || '').startsWith('='));
    }
    if (app_type === 'pass_mlsp') {
      assert.ok(String(ws.getCell('A5').value || '').includes('141603/02'));
      assert.ok(String(ws.getCell('B14').value || '').includes('Зубань'));
    }
    if (app_type === 'pass_fsb') {
      assert.ok(String(ws.getCell('C14').value || '').includes('Зубань'));
      assert.ok(!String(ws.getCell('C14').value || '').includes('{{'));
    }

    const preview = await buildPreviewDocument(app);
    assert.strictEqual(preview.sheet, expected);
    assert.ok(preview.html && preview.html.includes('<table'), app_type + ' preview html');
    assert.ok(preview.html.includes('mlsp-xsheet'));
    if (app_type === 'pass_mlsp') {
      assert.ok(preview.html.includes('141603/02') || preview.html.includes('Зубань'));
    }
    assert.ok(filenameFor({ app_type, date_from: '2026-11-09' }).endsWith('.xlsx'));
  }

  // коллективный ФСБ → прил. 5
  const colBuf = await buildApplicationExcel({
    app_type: 'pass_fsb',
    pass_kind: 'collective',
    date_from: '2026-11-09',
    date_to: '2026-11-20',
    contract_number: 'ГНШ-24/10000/00056/Р от 01.04.24 г.',
    people: [samplePeople[0], { ...samplePeople[0], fio: 'Иванов Иван Иванович' }]
  });
  await assertSingleSheet(colBuf, 'ФСБ_прил5');

  console.log('mlsp-passes-excel.test.js OK', types.length, '+fsb collective, template md5 locked');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
