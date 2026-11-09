'use strict';

const assert = require('assert');
const { buildApplicationExcel, filenameFor } = require('../src/services/mlsp-passes-excel');

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

async function run() {
  const types = ['flight', 'ship', 'pass_35srz', 'pass_mmrp', 'pass_mlsp', 'pass_fsb'];
  for (const app_type of types) {
    const buf = await buildApplicationExcel({
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
      pass_kind: app_type === 'pass_fsb' ? 'individual' : 'разовый'
    });
    assert.ok(Buffer.isBuffer(buf) && buf.length > 2000, app_type + ' too small');
    assert.ok(filenameFor({ app_type, date_from: '2026-11-09' }).endsWith('.xlsx'));
  }
  console.log('mlsp-passes-excel.test.js OK', types.length);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
