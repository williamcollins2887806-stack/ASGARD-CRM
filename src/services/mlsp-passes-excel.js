'use strict';

/**
 * Генерация Excel-бланков МЛСП (values-only, один лист) — по шаблонам Хосе.
 */

const ExcelJS = require('exceljs');
const { fmtRu, ymd } = require('./mlsp-passes-rules');

const MONTHS_RU = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];

function thin() {
  const s = { style: 'thin', color: { argb: 'FF94A3B8' } };
  return { top: s, left: s, bottom: s, right: s };
}

function styleHeader(cell) {
  cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E4D8C' } };
  cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
  cell.border = thin();
}

function styleCell(cell) {
  cell.font = { size: 10 };
  cell.alignment = { wrapText: true, vertical: 'middle' };
  cell.border = thin();
}

function passportLine(p) {
  const num = [p.passport_series, p.passport_number].filter(Boolean).join(' ') || p.passport || '';
  const issued = p.passport_issued || '';
  const date = fmtRu(p.passport_date);
  return [num, date && `выдан ${date}`, issued].filter(Boolean).join(', ');
}

function birthLine(p) {
  const b = fmtRu(p.birth_date);
  const place = p.birth_place || '';
  return [b, place].filter(Boolean).join(', ');
}

function fioPhone(p) {
  return [p.fio, p.phone].filter(Boolean).join('\n');
}

function asgardBlock() {
  return 'Исполнитель: юр. лицо ООО «АСГАРД-Сервис», реквизиты (ИНН/КПП 7736244785/770101001, юр. адрес: 105082, г. Москва, ул. Большая Почтовая, д. 55/59, стр. 1, пом. 37, телефон +7(499)322-30-62, e-mail: hv@asgard-service.com)';
}

function outDateRu(d) {
  const s = ymd(d) || ymd(new Date());
  const [y, m, day] = s.split('-').map(Number);
  return `«${String(day).padStart(2, '0')}» ${MONTHS_RU[m - 1]} ${y} г.`;
}

async function buildWorkbook(builder) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ASGARD CRM';
  wb.created = new Date();
  await builder(wb);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

async function buildFlightExcel(app) {
  return buildWorkbook(async (wb) => {
    const ws = wb.addWorksheet('Заявка_перелет', {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, paperSize: 9 }
    });
    ws.mergeCells('A1', 'N1');
    ws.getCell('A1').value = 'Приложение № 1 к Регламенту взаимодействия при оказании услуги по авиационному обеспечению между ООО «Газпромнефть-Снабжение» и ООО «Газпром нефть шельф»';
    ws.getCell('A1').alignment = { wrapText: true };
    ws.mergeCells('K6', 'N6');
    ws.getCell('K6').value = 'ООО «ГАЗПРОМНЕФТЬ-СНАБЖЕНИЕ»';
    ws.mergeCells('K7', 'N8');
    ws.getCell('K7').value = 'Начальнику Управления авиационного обеспечения «Сибирь»\nСмагиной С.А.';
    ws.getCell('K7').alignment = { wrapText: true, horizontal: 'right' };

    ws.mergeCells('B11', 'N11');
    ws.getCell('B11').value = 'Заявка на перелет самолетными и вертолетными рейсами';
    ws.getCell('B11').font = { bold: true, size: 14 };

    const inbound = (app.people || []).filter((p) => (p.leg_direction || app.direction || 'inbound') !== 'outbound');
    const outbound = (app.people || []).filter((p) => (p.leg_direction || app.direction) === 'outbound');
    // if direction both/empty — put all in inbound block unless tagged
    const inList = inbound.length ? inbound : (app.direction === 'outbound' ? [] : (app.people || []));
    const outList = outbound.length ? outbound : (app.direction === 'outbound' ? (app.people || []) : []);

    const headers = [
      '№', 'Ф.И.О.', 'Организация', 'Должность', 'отдел/управление/блок', 'МВЗ',
      'Дата рождения', 'Номер паспорта', 'моб. тел.', 'Куратор Договора',
      '№ договора', 'Разрешающие документы', 'Документ погранзоны Варандей (ФСБ)'
    ];

    function writeBlock(startRow, title, list) {
      ws.mergeCells(`B${startRow}`, `N${startRow}`);
      ws.getCell(`B${startRow}`).value = title;
      ws.getCell(`B${startRow}`).font = { bold: true };
      const hr = startRow + 1;
      headers.forEach((h, i) => {
        const cell = ws.getCell(hr, i + 2);
        cell.value = h;
        styleHeader(cell);
      });
      for (let i = 0; i < 25; i++) {
        const p = list[i] || {};
        const r = hr + 1 + i;
        const vals = [
          i + 1,
          p.fio || '',
          p.org || p.organization || 'ООО «АСГАРД-Сервис»',
          p.position || '',
          p.department || '',
          p.mvz || app.mvz || '',
          fmtRu(p.birth_date),
          [p.passport_series, p.passport_number].filter(Boolean).join(' ') || p.passport || '',
          p.phone || '',
          p.curator || app.curator || '',
          p.contract_number || app.contract_number || '',
          p.permits_text || 'пропуск ФСБ',
          p.fsb_doc || ''
        ];
        vals.forEach((v, c) => {
          const cell = ws.getCell(r, c + 2);
          cell.value = v;
          styleCell(cell);
        });
      }
      return hr + 26;
    }

    const routeIn = app.route_inbound || app.route_text ||
      `ДАТА: ${fmtRu(app.date_from)} АРХАНГЕЛЬСК - ВАРАНДЕЙ - МЛСП`;
    const routeOut = app.route_outbound ||
      `ДАТА: ${fmtRu(app.date_to || app.date_from)} МЛСП - ВАРАНДЕЙ - АРХАНГЕЛЬСК`;

    let next = writeBlock(13, routeIn, inList);
    writeBlock(next + 1, routeOut, outList);

    ws.getColumn(2).width = 6;
    ws.getColumn(3).width = 28;
    for (let c = 4; c <= 14; c++) ws.getColumn(c).width = 14;
  });
}

async function buildShipExcel(app) {
  return buildWorkbook(async (wb) => {
    const ws = wb.addWorksheet('Корабль', {
      pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, paperSize: 9 }
    });
    ws.getCell('G3').value = app.ship_curator || app.curator || '';
    ws.mergeCells('A5', 'G5');
    ws.getCell('A5').value = 'Список пассажиров для перевозки на борту';
    ws.getCell('A5').font = { bold: true, size: 14 };
    ws.mergeCells('A8', 'G8');
    ws.getCell('A8').value = app.route_text ||
      `Маршрут: МЛСП - Порт\nДаты: ${fmtRu(app.date_from)} - ${fmtRu(app.date_to || app.date_from)}`;
    ws.getCell('A8').alignment = { wrapText: true };

    const headers = ['№', 'Ф.И.О.', 'Организация', 'Должность', 'Дата и место рождения', 'Номер паспорта / дата выдачи', '№ договора'];
    headers.forEach((h, i) => {
      const cell = ws.getCell(9, i + 1);
      cell.value = h;
      styleHeader(cell);
    });
    for (let i = 0; i < 25; i++) {
      const p = (app.people || [])[i] || {};
      const vals = [
        i + 1,
        p.fio || '',
        p.org || 'ООО «АСГАРД-Сервис»',
        p.position || '',
        birthLine(p),
        passportLine(p),
        p.contract_number || app.contract_number || ''
      ];
      vals.forEach((v, c) => {
        const cell = ws.getCell(10 + i, c + 1);
        cell.value = v;
        styleCell(cell);
      });
    }
    ws.getCell('A37').value = 'Согласовано:';
    ws.getCell('A38').value = 'Администратор ЖМ МЛСП «Приразломная»';
    ws.getCell('A39').value = `Куратор договора: ${app.ship_curator || app.curator || ''}`;
    ws.getCell('A40').value = 'Сотрудник режима и охраны';
    for (let c = 1; c <= 7; c++) ws.getColumn(c).width = c === 2 ? 28 : 16;
  });
}

async function buildSrzExcel(app) {
  return buildWorkbook(async (wb) => {
    const ws = wb.addWorksheet('Пропуск_35СРЗ');
    const walk = (app.people || []).filter((p) => (p.mode || app.pass_kind || 'walk') !== 'drive');
    const drive = (app.people || []).filter((p) => (p.mode || app.pass_kind) === 'drive');

    ws.getCell('A1').value = '№';
    ws.getCell('B1').value = 'Ф.И.О. работника';
    ws.getCell('E1').value = 'Серия, номер паспорта, дата выдачи. Орган, выдавший паспорт';
    ws.getCell('H1').value = 'Наименование организации';
    ['A1', 'B1', 'E1', 'H1'].forEach((a) => styleHeader(ws.getCell(a)));

    for (let i = 0; i < 4; i++) {
      const p = walk[i] || {};
      ws.getCell(2 + i, 1).value = i + 1;
      ws.getCell(2 + i, 2).value = p.fio || '';
      ws.getCell(2 + i, 5).value = passportLine(p);
      ws.getCell(2 + i, 8).value = p.org || 'ООО «АСГАРД-Сервис»';
      [1, 2, 5, 8].forEach((c) => styleCell(ws.getCell(2 + i, c)));
    }
    ws.getCell('A6').value = 'Цель:';
    ws.getCell('C6').value = app.purpose_text || 'Выход с корабля';
    ws.getCell('A7').value = 'Период:';
    ws.getCell('C7').value = `${fmtRu(app.date_from)} – ${fmtRu(app.date_to || app.date_from)}`;
    ws.getCell('A8').value = 'Ввоз / вывоз:';
    ws.getCell('C8').value = app.payload?.cargo || '';
    ws.getCell('A9').value = 'Форма заявки для оформления прохода';

    ws.getCell('A11').value = '№';
    ws.getCell('B11').value = 'Марка и гос.номер ТС';
    ws.getCell('D11').value = 'ФИО сотрудника/ водителя';
    ws.getCell('F11').value = 'Паспорт';
    ws.getCell('G11').value = 'Организация';
    ['A11', 'B11', 'D11', 'F11', 'G11'].forEach((a) => styleHeader(ws.getCell(a)));
    for (let i = 0; i < 2; i++) {
      const p = drive[i] || {};
      ws.getCell(12 + i, 1).value = i + 1;
      ws.getCell(12 + i, 2).value = p.vehicle || '';
      ws.getCell(12 + i, 4).value = p.fio || '';
      ws.getCell(12 + i, 6).value = passportLine(p);
      ws.getCell(12 + i, 7).value = p.org || 'ООО «АСГАРД-Сервис»';
    }
    ws.getCell('A13').value = 'Цель:';
    ws.getCell('C13').value = app.payload?.drive_purpose || app.purpose_text || '';
    ws.getCell('A14').value = 'Период:';
    ws.getCell('C14').value = `${fmtRu(app.date_from)} – ${fmtRu(app.date_to || app.date_from)}`;
    ws.getCell('A16').value = 'Форма заявки для оформления проезда';
    ws.getColumn(2).width = 28;
    ws.getColumn(5).width = 36;
  });
}

async function buildMmrpExcel(app) {
  return buildWorkbook(async (wb) => {
    const ws = wb.addWorksheet('Пропуск_ММРП');
    ws.mergeCells('A2', 'F2');
    ws.getCell('A2').value = 'ЗАЯВКА';
    ws.getCell('A2').font = { bold: true, size: 14 };
    ws.mergeCells('A3', 'D3');
    ws.getCell('A3').value = 'на оформление пропуска для прохода на территорию порта, ПУНКТА ПРОПУСКА';
    ws.getCell('E3').value = (app.pass_kind || 'разовый') === 'постоянный' ? '' : '☑';
    ws.getCell('F3').value = (app.pass_kind || '') === 'постоянный' ? '☑' : '';
    ws.getCell('E4').value = 'ДА';
    ws.getCell('F4').value = 'НЕТ';
    ws.getCell('A6').value = 'Прошу оформить';
    ws.getCell('C6').value = app.pass_kind || 'разовый';
    ws.getCell('E6').value = `${fmtRu(app.date_from)} – ${fmtRu(app.date_to || app.date_from)}`;
    ws.mergeCells('B8', 'F8');
    ws.getCell('B8').value = app.purpose_text ||
      'производства работ на объектах АО «Аврора Логистика» (южный, северный район, угольный терминал)';
    ws.getCell('A10').value = 'Следующему (им) сотруднику (ам):';

    const headers = ['№', 'Ф.И.О. (полностью)\nДолжность', 'Дата и место рождения', 'Паспорт', 'Место жительства', 'Контактный телефон'];
    headers.forEach((h, i) => {
      const cell = ws.getCell(11, i + 1);
      cell.value = h;
      styleHeader(cell);
    });
    for (let i = 0; i < 4; i++) {
      const p = (app.people || [])[i] || {};
      const vals = [
        i + 1,
        [p.fio, p.position].filter(Boolean).join('\n'),
        birthLine(p),
        passportLine(p).replace(/^(\d{4})\s+(\d+)/, '$1 № $2'),
        p.registration_address || p.address || '',
        p.phone || ''
      ];
      vals.forEach((v, c) => {
        const cell = ws.getCell(12 + i, c + 1);
        cell.value = v;
        styleCell(cell);
      });
    }
    for (let c = 1; c <= 6; c++) ws.getColumn(c).width = c === 2 ? 26 : 18;
  });
}

async function buildMlspPassExcel(app) {
  return buildWorkbook(async (wb) => {
    const ws = wb.addWorksheet('Пропуск_МЛСП');
    ws.mergeCells('A2', 'E2');
    ws.getCell('A2').value = asgardBlock();
    ws.getCell('A2').alignment = { wrapText: true };
    ws.mergeCells('F2', 'H2');
    ws.getCell('F2').value = 'Лицу ответственному за обеспечение транспортной безопасности субъекта транспортной инфраструктуры';
    ws.getCell('F2').alignment = { wrapText: true, horizontal: 'right' };

    const outNo = app.outgoing_number || '141603/—';
    ws.mergeCells('A5', 'H5');
    ws.getCell('A5').value = `Исх. № ${outNo} от ${outDateRu(app.date_from || new Date())}`;
    ws.getCell('A5').font = { bold: true };

    ws.mergeCells('A6', 'H6');
    ws.getCell('A6').value = 'ЗАЯВКА';
    ws.getCell('A6').font = { bold: true, size: 14 };
    ws.mergeCells('A7', 'H8');
    ws.getCell('A7').value = 'на оформление пропуска для прохода / проезда на объект транспортной инфраструктуры\nМЛСП «Приразломная»';
    ws.getCell('A7').alignment = { wrapText: true, horizontal: 'center' };

    ws.mergeCells('A9', 'H9');
    ws.getCell('A9').value =
      `Прошу оформить пропуск на период с ${fmtRu(app.date_from)} по ${fmtRu(app.date_to || app.contract_end || app.date_from)}`;
    ws.mergeCells('A10', 'H10');
    ws.getCell('A10').value =
      `для выполнения работ по договору ${app.contract_number || ''}`;
    ws.mergeCells('A11', 'H11');
    ws.getCell('A11').value = app.subject_text ||
      'по восстановительному ремонту огневых подогревателей МЛСП «Приразломная»';
    ws.getCell('A12').value = 'Следующим(им) сотрудникам(ам):';

    const headers = [
      '№', 'Фамилия, имя, отчество,\nконтактный телефон', 'Должность, № приказа,\nсрок ТД',
      'Дата и место рождения', 'Паспорт', 'Адрес', 'Зоны доступа*', 'Примечание'
    ];
    headers.forEach((h, i) => {
      const cell = ws.getCell(13, i + 1);
      cell.value = h;
      styleHeader(cell);
    });
    for (let i = 0; i < 4; i++) {
      const p = (app.people || [])[i] || {};
      const pos = [
        p.position,
        p.order_number && `пр. ${p.order_number}`,
        p.order_date && fmtRu(p.order_date),
        p.labor_term
      ].filter(Boolean).join(', ');
      const vals = [
        i + 1,
        fioPhone(p),
        pos,
        birthLine(p),
        passportLine(p),
        p.registration_address || p.address || '',
        p.access_zones || app.payload?.access_zones || 'на объекте',
        p.note || ''
      ];
      vals.forEach((v, c) => {
        const cell = ws.getCell(14 + i, c + 1);
        cell.value = v;
        styleCell(cell);
      });
    }

    ws.mergeCells('A18', 'H19');
    ws.getCell('A18').value =
      'С требованиями пропускного и внутриобъектового режимов ознакомлен(ы). Обязуюсь(емся) обеспечить возврат пропуска при убытии.';
    ws.getCell('A18').alignment = { wrapText: true };
    ws.getCell('A21').value = 'От подрядчика: Генеральный директор ООО «АСГАРД-Сервис»';
    ws.getCell('G21').value = 'О.С. Кудряшов';
    ws.getCell('A23').value = 'СОГЛАСОВАНО:';
    ws.getCell('A24').value = 'Линейный руководитель / куратор договора / ЛОТБ СТИ / ЛОТБ ОТИ';

    // settings panel note (not for print emphasis)
    ws.getCell('J1').value = 'Служебно';
    ws.getCell('J2').value = 'Договор:';
    ws.getCell('K2').value = app.contract_number || '';
    for (let c = 1; c <= 8; c++) ws.getColumn(c).width = c === 2 ? 24 : 14;
  });
}

async function buildFsbExcel(app) {
  return buildWorkbook(async (wb) => {
    const ws = wb.addWorksheet('Пропуск_ФСБ');
    ws.mergeCells('A1', 'G1');
    ws.getCell('A1').value =
      'Ходатайство на получение пропуска для въезда (прохода) лиц и транспортных средств в пограничную зону';
    ws.getCell('A1').font = { bold: true, size: 13 };
    ws.mergeCells('A2', 'G2');
    ws.getCell('A2').value =
      'Форма-черновик по Приказу ФСБ России от 28.02.2023 № 102 (прил. № 3 / № 5). Подтвердить у режима перед отправкой.';
    ws.getCell('A2').font = { italic: true, color: { argb: 'FFB45309' } };

    ws.getCell('A4').value = 'Пограничная зона:';
    ws.mergeCells('B4', 'G4');
    ws.getCell('B4').value = app.payload?.border_zone ||
      'Ненецкий автономный округ, п. Варандей (пограничная зона)';
    ws.getCell('A5').value = 'Цель:';
    ws.mergeCells('B5', 'G5');
    ws.getCell('B5').value = app.purpose_text ||
      `выполнение работ по договору ${app.contract_number || ''} на МЛСП «Приразломная»`;
    ws.getCell('A6').value = 'Срок:';
    ws.getCell('B6').value = `с ${fmtRu(app.date_from)} по ${fmtRu(app.date_to || app.date_from)}`;
    ws.getCell('A7').value = 'Вид:';
    ws.getCell('B7').value = app.pass_kind === 'collective' ? 'коллективный' : 'индивидуальный';

    ws.mergeCells('A9', 'G9');
    ws.getCell('A9').value = 'Сведения о юридическом лице-заявителе';
    ws.getCell('A9').font = { bold: true };
    ws.getCell('A10').value = 'Заявитель:';
    ws.mergeCells('B10', 'G10');
    ws.getCell('B10').value = 'ООО «АСГАРД-Сервис»';
    ws.getCell('A11').value = 'ИНН / КПП:';
    ws.getCell('B11').value = '7736244785 / 770101001';
    ws.getCell('A12').value = 'Адрес:';
    ws.mergeCells('B12', 'G12');
    ws.getCell('B12').value = '105082, г. Москва, ул. Большая Почтовая, д. 55/59, стр. 1, пом. 37';
    ws.getCell('A13').value = 'Тел. / e-mail:';
    ws.getCell('B13').value = '+7(499)322-30-62 / hv@asgard-service.com';

    const headers = ['№', 'ФИО', 'Дата и место рождения', 'Паспорт', 'Адрес регистрации', 'Телефон', 'Получение'];
    headers.forEach((h, i) => {
      const cell = ws.getCell(15, i + 1);
      cell.value = h;
      styleHeader(cell);
    });
    (app.people || []).forEach((p, i) => {
      const vals = [
        i + 1,
        p.fio || '',
        birthLine(p),
        passportLine(p),
        p.registration_address || p.address || '',
        p.phone || '',
        app.payload?.receive_mode || 'личное обращение в пограничный орган'
      ];
      vals.forEach((v, c) => {
        const cell = ws.getCell(16 + i, c + 1);
        cell.value = v;
        styleCell(cell);
      });
    });
    const foot = 16 + Math.max((app.people || []).length, 1) + 2;
    ws.getCell(`A${foot}`).value = 'Достоверность и полноту сведений подтверждаю.';
    ws.getCell(`A${foot + 1}`).value = 'Заявитель: Генеральный директор ООО «АСГАРД-Сервис»';
    ws.getCell(`E${foot + 1}`).value = 'О.С. Кудряшов';
    for (let c = 1; c <= 7; c++) ws.getColumn(c).width = c === 2 ? 26 : 16;
  });
}

async function buildApplicationExcel(app) {
  switch (app.app_type) {
    case 'flight': return buildFlightExcel(app);
    case 'ship': return buildShipExcel(app);
    case 'pass_35srz': return buildSrzExcel(app);
    case 'pass_mmrp': return buildMmrpExcel(app);
    case 'pass_mlsp': return buildMlspPassExcel(app);
    case 'pass_fsb': return buildFsbExcel(app);
    default: throw new Error('Неизвестный тип заявки: ' + app.app_type);
  }
}

function filenameFor(app) {
  const d = (ymd(app.date_from) || ymd(new Date())).replace(/-/g, '');
  const map = {
    flight: 'Zayavka_perelet',
    ship: 'Korabl',
    pass_35srz: 'Propusk_35SRZ',
    pass_mmrp: 'Propusk_MMRP',
    pass_mlsp: 'Propusk_MLSP',
    pass_fsb: 'Propusk_FSB'
  };
  return `${map[app.app_type] || 'MLSP'}_${d}.xlsx`;
}

module.exports = {
  buildApplicationExcel,
  filenameFor,
  outDateRu,
  asgardBlock
};
