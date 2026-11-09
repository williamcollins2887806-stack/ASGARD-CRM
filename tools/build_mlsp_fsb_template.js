'use strict';

/**
 * Одноразово собирает templates/mlsp/fsb-petition.xlsx
 * по полям Приказа ФСБ России от 28.02.2023 № 102, прил. № 3 (инд.) / № 5 (коллектив).
 * Не выдумываем структуру — поля с образца ФСБ.
 */

const path = require('path');
const ExcelJS = require('exceljs');

const OUT = path.join(__dirname, '../templates/mlsp/fsb-petition.xlsx');

function borderThin(cell) {
  const s = { style: 'thin', color: { argb: 'FF000000' } };
  cell.border = { top: s, left: s, bottom: s, right: s };
}

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ASGARD CRM';
  wb.created = new Date();

  // ── Прил. 3 · индивидуальное ─────────────────────────────────
  const ind = wb.addWorksheet('ФСБ_прил3', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1 }
  });
  ind.getColumn(1).width = 3;
  ind.getColumn(2).width = 28;
  ind.getColumn(3).width = 22;
  ind.getColumn(4).width = 22;
  ind.getColumn(5).width = 22;
  ind.getColumn(6).width = 22;

  ind.mergeCells('B1', 'F1');
  ind.getCell('B1').value = 'Приложение № 3 к Порядку (пп. 4, 24) · Форма';
  ind.getCell('B1').font = { size: 9, italic: true };

  ind.mergeCells('B3', 'F3');
  ind.getCell('B3').value = 'Ходатайство на получение индивидуального пропуска для въезда (прохода) лиц и транспортных средств в пограничную зону';
  ind.getCell('B3').font = { bold: true, size: 12 };
  ind.getCell('B3').alignment = { wrapText: true, horizontal: 'center' };
  ind.getRow(3).height = 36;

  ind.mergeCells('B5', 'F5');
  ind.getCell('B5').value = 'Прошу выдать индивидуальный пропуск для въезда (прохода) лиц и транспортных средств в пограничную зону';
  ind.getCell('B5').alignment = { wrapText: true };

  ind.getCell('B7').value = 'Место въезда (прохода):';
  ind.mergeCells('C7', 'F7');
  ind.getCell('C7').value = '{{BORDER_ZONE}}';
  ind.getCell('C7').alignment = { wrapText: true };
  borderThin(ind.getCell('C7'));
  ind.getRow(7).height = 32;

  ind.getCell('B8').value = 'с целью';
  ind.mergeCells('C8', 'F8');
  ind.getCell('C8').value = '{{PURPOSE}}';
  borderThin(ind.getCell('C8'));

  ind.getCell('B9').value = 'на срок с';
  ind.getCell('C9').value = '{{DATE_FROM}}';
  borderThin(ind.getCell('C9'));
  ind.getCell('D9').value = 'по';
  ind.getCell('E9').value = '{{DATE_TO}}';
  borderThin(ind.getCell('E9'));

  ind.getCell('B10').value = 'Транспортное средство:';
  ind.mergeCells('C10', 'F10');
  ind.getCell('C10').value = '{{VEHICLE}}';
  borderThin(ind.getCell('C10'));
  ind.getCell('B11').value = '(тип, марка, модель, гос. номер, цвет)';
  ind.getCell('B11').font = { size: 8, italic: true, color: { argb: 'FF666666' } };

  ind.mergeCells('B13', 'F13');
  ind.getCell('B13').value = 'Сведения о гражданине, в отношении которого представляется ходатайство:';
  ind.getCell('B13').font = { bold: true };

  const personHeaders = [
    ['B14', 'Фамилия, имя, отчество'],
    ['B15', 'Дата рождения'],
    ['B16', 'Гражданство'],
    ['B17', 'Пол'],
    ['B18', 'Адрес регистрации по месту жительства'],
    ['B19', 'Адрес регистрации по месту пребывания'],
    ['B20', 'Адрес места фактического проживания'],
    ['B21', 'Абонентский номер телефона'],
    ['B22', 'Адрес электронной почты'],
    ['B23', 'Документ, удостоверяющий личность']
  ];
  const personKeys = [
    '{{FIO}}', '{{BIRTH}}', '{{CITIZENSHIP}}', '{{SEX}}',
    '{{ADDR_REG}}', '{{ADDR_STAY}}', '{{ADDR_FACT}}',
    '{{PHONE}}', '{{EMAIL}}', '{{PASSPORT}}'
  ];
  personHeaders.forEach(([addr, label], i) => {
    ind.getCell(addr).value = label;
    ind.mergeCells(`C${14 + i}`, `F${14 + i}`);
    ind.getCell(`C${14 + i}`).value = personKeys[i];
    borderThin(ind.getCell(`C${14 + i}`));
    ind.getRow(14 + i).height = 22;
  });

  ind.mergeCells('B25', 'F25');
  ind.getCell('B25').value = 'Сведения о юридическом лице / индивидуальном предпринимателе (заявитель):';
  ind.getCell('B25').font = { bold: true };

  const orgRows = [
    [26, 'Заявитель (полное наименование)', '{{ORG_NAME}}'],
    [27, 'ИНН', '{{ORG_INN}}'],
    [28, 'Место нахождения', '{{ORG_ADDR}}'],
    [29, 'Почтовый адрес', '{{ORG_POST}}'],
    [30, 'Телефон / e-mail', '{{ORG_CONTACTS}}']
  ];
  orgRows.forEach(([r, label, key]) => {
    ind.getCell(`B${r}`).value = label;
    ind.mergeCells(`C${r}`, `F${r}`);
    ind.getCell(`C${r}`).value = key;
    borderThin(ind.getCell(`C${r}`));
  });

  ind.getCell('B32').value = 'Получение пропуска:';
  ind.mergeCells('C32', 'F32');
  ind.getCell('C32').value = '{{RECEIVE_KIND}}';
  borderThin(ind.getCell('C32'));

  ind.getCell('B33').value = 'Способ получения пропуска:';
  ind.mergeCells('C33', 'F33');
  ind.getCell('C33').value = '{{RECEIVE_MODE}}';
  borderThin(ind.getCell('C33'));

  ind.mergeCells('B35', 'F35');
  ind.getCell('B35').value = 'К ходатайству прилагаются: копии страниц документа, удостоверяющего личность, с установочными данными; копии страниц о регистрации по месту жительства (при наличии); документ, подтверждающий полномочия представителя.';
  ind.getCell('B35').alignment = { wrapText: true };
  ind.getRow(35).height = 48;

  ind.mergeCells('B37', 'F37');
  ind.getCell('B37').value = 'Достоверность и полноту сведений, указанных в ходатайстве, подтверждаю.';

  ind.getCell('B39').value = 'Заявитель:';
  ind.mergeCells('C39', 'D39');
  ind.getCell('C39').value = '{{SIGN_TITLE}}';
  ind.getCell('E39').value = '{{SIGN_NAME}}';
  borderThin(ind.getCell('E39'));

  ind.getCell('B41').value = 'Источник формы: Приказ ФСБ России от 28.02.2023 № 102, приложение № 3 (образец на fsb.ru).';
  ind.getCell('B41').font = { size: 8, italic: true, color: { argb: 'FF666666' } };

  // ── Прил. 5 · коллективное (список лиц) ──────────────────────
  const col = wb.addWorksheet('ФСБ_прил5', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 }
  });
  for (let c = 1; c <= 8; c++) col.getColumn(c).width = c === 2 ? 28 : 16;
  col.mergeCells('A1', 'H1');
  col.getCell('A1').value = 'Приложение № 5 к Порядку · Ходатайство на получение коллективного пропуска';
  col.getCell('A1').font = { bold: true, size: 12 };
  col.mergeCells('A2', 'H2');
  col.getCell('A2').value = 'Место: {{BORDER_ZONE}} · Цель: {{PURPOSE}} · Срок: {{DATE_FROM}} – {{DATE_TO}}';
  col.getCell('A2').alignment = { wrapText: true };
  col.getRow(2).height = 28;

  const headers = ['№', 'ФИО', 'Дата и место рождения', 'Гражданство', 'Паспорт', 'Адрес регистрации', 'Телефон', 'Примечание'];
  headers.forEach((h, i) => {
    const cell = col.getCell(4, i + 1);
    cell.value = h;
    cell.font = { bold: true, size: 10 };
    cell.alignment = { wrapText: true, horizontal: 'center', vertical: 'middle' };
    borderThin(cell);
  });
  col.getRow(4).height = 36;
  for (let i = 0; i < 25; i++) {
    const r = 5 + i;
    col.getCell(r, 1).value = i + 1;
    for (let c = 1; c <= 8; c++) borderThin(col.getCell(r, c));
  }
  col.getCell('A31').value = 'Заявитель: {{ORG_NAME}}, ИНН {{ORG_INN}}';
  col.getCell('A32').value = 'Подпись: {{SIGN_TITLE}} / {{SIGN_NAME}}';
  col.getCell('A34').value = 'Источник формы: Приказ ФСБ России от 28.02.2023 № 102, приложение № 5.';
  col.getCell('A34').font = { size: 8, italic: true, color: { argb: 'FF666666' } };

  await wb.xlsx.writeFile(OUT);
  console.log('wrote', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
