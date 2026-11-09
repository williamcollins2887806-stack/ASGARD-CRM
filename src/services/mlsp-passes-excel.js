'use strict';

/**
 * Генерация Excel-бланков МЛСП из шаблона Хосе (templates/mlsp/base-generator.xlsx).
 * Values-only · один лист · стили/мерджи/ширины шаблона сохраняются.
 * ФСБ — отдельный черновик (в шаблоне листа нет).
 */

const path = require('path');
const ExcelJS = require('exceljs');
const { fmtRu, ymd } = require('./mlsp-passes-rules');

const TEMPLATE_PATH = path.join(__dirname, '../../templates/mlsp/base-generator.xlsx');

const MONTHS_RU = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];

const SHEET_BY_TYPE = {
  flight: 'Заявка_перелет',
  ship: 'Корабль',
  pass_35srz: 'Пропуск_35СРЗ',
  pass_mmrp: 'Пропуск_ММРП',
  pass_mlsp: 'Пропуск_МЛСП'
};

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

function passportMmrp(p) {
  const ser = p.passport_series || '';
  const num = p.passport_number || '';
  const core = ser && num ? `${ser} № ${num}` : (passportLine(p).replace(/^(\d{4})\s+(\d+)/, '$1 № $2'));
  const date = fmtRu(p.passport_date);
  const issued = p.passport_issued || '';
  return [core, date, issued].filter(Boolean).join(', ');
}

function birthLine(p) {
  const b = fmtRu(p.birth_date);
  const place = p.birth_place || '';
  return [b, place].filter(Boolean).join(', ');
}

function birthShipLine(p) {
  const b = fmtRu(p.birth_date);
  const place = p.birth_place || '';
  if (b && place) return `${b}, ${place}`;
  return b || place || '';
}

function passportShipLine(p) {
  const num = [p.passport_series, p.passport_number].filter(Boolean).join(' ') || p.passport || '';
  const date = fmtRu(p.passport_date);
  if (num && date) return `${num} / ${date}`;
  return passportLine(p);
}

function fioPhone(p) {
  return [p.fio, p.phone].filter(Boolean).join('\n');
}

function positionOrderLine(p) {
  return [
    p.position,
    p.order_number && `пр. ${p.order_number}`,
    p.order_date && fmtRu(p.order_date),
    p.labor_term
  ].filter(Boolean).join(', ');
}

function asgardBlock() {
  return 'Наименование юр. лица ООО "АСГАРД-Сервис", реквизиты (ИНН/КПП 7736244785/770101001, юр. адрес\n105082, г. Москва, ул. Большая Почтовая, д. 55/59, стр. 1, пом. 37, телефон +7(499)322-30-62, e-mail: hv@asgard-service.com)';
}

function outDateRu(d) {
  const s = ymd(d) || ymd(new Date());
  const [y, m, day] = s.split('-').map(Number);
  return `«${String(day).padStart(2, '0')}» ${MONTHS_RU[m - 1]} ${y} г.`;
}

function splitPeople(app) {
  const people = app.people || [];
  const inbound = people.filter((p) => (p.leg_direction || app.direction || 'inbound') !== 'outbound');
  const outbound = people.filter((p) => (p.leg_direction || app.direction) === 'outbound');
  if (app.direction === 'outbound') {
    return { inbound: [], outbound: outbound.length ? outbound : people };
  }
  if (app.direction === 'both') {
    return {
      inbound: inbound.length ? inbound : people,
      outbound: outbound.length ? outbound : []
    };
  }
  return {
    inbound: inbound.length ? inbound : people,
    outbound: outbound.length ? outbound : []
  };
}

function clearFormula(cell) {
  if (!cell) return;
  if (typeof cell.value === 'object' && cell.value && cell.value.formula) {
    cell.value = null;
  } else if (typeof cell.value === 'string' && cell.value.startsWith('=')) {
    cell.value = null;
  }
}

function setVal(ws, addr, value) {
  const cell = ws.getCell(addr);
  cell.value = value == null || value === '' ? null : value;
  return cell;
}

async function loadTemplateWb() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE_PATH);
  return wb;
}

/** Оставить только один лист; формулы на нём уже материализованы. */
async function exportSingleSheet(wb, keepName) {
  const keep = wb.getWorksheet(keepName);
  if (!keep) throw new Error('В шаблоне нет листа: ' + keepName);

  // Снять DV, ссылающиеся на удалённые листы
  if (keep.dataValidations && keep.dataValidations.model) {
    keep.dataValidations.model = [];
  }

  const names = wb.worksheets.map((w) => w.name);
  for (const name of names) {
    if (name !== keepName) wb.removeWorksheet(name);
  }

  // Убрать именованные диапазоны шаблона (Список_ФИО и т.п.)
  if (wb.definedNames && typeof wb.definedNames.model !== 'undefined') {
    try {
      wb.definedNames.model = [];
    } catch (_) {
      /* ignore */
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

function fillFlightSheet(ws, app) {
  const { inbound, outbound } = splitPeople(app);
  const dIn = fmtRu(app.date_from);
  const dOut = fmtRu(app.date_to || app.date_from);
  const routeIn = app.route_inbound || (app.direction !== 'outbound'
    ? (app.route_text || `ДАТА: ${dIn} АРХАНГЕЛЬСК - ВАРАНДЕЙ - МЛСП`)
    : `ДАТА: ${dIn} АРХАНГЕЛЬСК - ВАРАНДЕЙ - МЛСП`);
  const routeOut = app.route_outbound ||
    `ДАТА: ${dOut} МЛСП - ВАРАНДЕЙ - АРХАНГЕЛЬСК`;

  setVal(ws, 'B13', routeIn);
  setVal(ws, 'B41', routeOut);

  function fillBlock(startRow, list) {
    for (let i = 0; i < 25; i++) {
      const r = startRow + i;
      const p = list[i];
      // очистить формулы lookup
      ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'M', 'N'].forEach((col) => clearFormula(ws.getCell(`${col}${r}`)));
      setVal(ws, `C${r}`, null);
      setVal(ws, `L${r}`, null);
      if (!p) {
        ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'M', 'N'].forEach((col) => setVal(ws, `${col}${r}`, null));
        continue;
      }
      const contract = p.contract_number || app.contract_number || '';
      setVal(ws, `C${r}`, p.fio || '');
      setVal(ws, `D${r}`, p.org || 'ООО «АСГАРД-Сервис»');
      setVal(ws, `E${r}`, p.position || '');
      setVal(ws, `F${r}`, p.department || '');
      setVal(ws, `G${r}`, p.mvz || app.mvz || '');
      setVal(ws, `H${r}`, fmtRu(p.birth_date) || '');
      setVal(ws, `I${r}`, [p.passport_series, p.passport_number].filter(Boolean).join(' ') || p.passport || '');
      setVal(ws, `J${r}`, p.phone || '');
      setVal(ws, `K${r}`, p.curator || app.curator || '');
      setVal(ws, `L${r}`, contract);
      setVal(ws, `M${r}`, p.permits_text || 'пропуск ФСБ');
      setVal(ws, `N${r}`, p.fsb_doc || '');
    }
  }

  fillBlock(15, inbound);
  fillBlock(46, outbound);
}

function fillShipSheet(ws, app) {
  const people = app.people || [];
  setVal(ws, 'G3', app.ship_curator || app.curator || '');
  const route = app.route_text ||
    `Маршрут: ${app.direction === 'outbound' ? 'МЛСП - Порт' : 'Порт - МЛСП'}\nДата: ${fmtRu(app.date_from)} - ${fmtRu(app.date_to || app.date_from)}`;
  setVal(ws, 'A8', route);

  for (let i = 0; i < 25; i++) {
    const r = 10 + i;
    const p = people[i];
    ['C', 'D', 'E', 'F'].forEach((col) => clearFormula(ws.getCell(`${col}${r}`)));
    setVal(ws, `B${r}`, null);
    setVal(ws, `G${r}`, null);
    if (!p) {
      ['C', 'D', 'E', 'F'].forEach((col) => setVal(ws, `${col}${r}`, null));
      continue;
    }
    setVal(ws, `B${r}`, p.fio || '');
    setVal(ws, `C${r}`, p.org || 'ООО «АСГАРД-Сервис»');
    setVal(ws, `D${r}`, p.position || '');
    setVal(ws, `E${r}`, birthShipLine(p));
    setVal(ws, `F${r}`, passportShipLine(p));
    setVal(ws, `G${r}`, p.contract_number || app.contract_number || '');
  }

  // формула куратора в подписи
  clearFormula(ws.getCell('B38'));
  const cur = app.ship_curator || app.curator || '______________';
  setVal(ws, 'B38', `Куратор договора (ответственный за перевозку) ____________________ (${cur})`);
}

function fillSrzSheet(ws, app) {
  const walk = (app.people || []).filter((p) => (p.mode || app.pass_kind || 'walk') !== 'drive');
  const drive = (app.people || []).filter((p) => (p.mode || app.pass_kind) === 'drive');

  for (let i = 0; i < 4; i++) {
    const r = 2 + i;
    const p = walk[i];
    clearFormula(ws.getCell(`E${r}`));
    clearFormula(ws.getCell(`H${r}`));
    setVal(ws, `B${r}`, p ? (p.fio || '') : null);
    setVal(ws, `E${r}`, p ? passportLine(p) : null);
    setVal(ws, `H${r}`, p ? (p.org || 'ООО «АСГАРД-Сервис»') : null);
  }
  setVal(ws, 'C6', app.purpose_text || 'Выход с корабля');
  setVal(ws, 'C7', `${fmtRu(app.date_from)} – ${fmtRu(app.date_to || app.date_from)}`);
  setVal(ws, 'C8', app.payload?.cargo || null);

  const pDrive = drive[0];
  clearFormula(ws.getCell('F12'));
  clearFormula(ws.getCell('G12'));
  setVal(ws, 'B12', pDrive?.vehicle || null);
  setVal(ws, 'D12', pDrive?.fio || null);
  setVal(ws, 'F12', pDrive ? passportLine(pDrive) : null);
  setVal(ws, 'G12', pDrive ? (pDrive.org || 'ООО «АСГАРД-Сервис»') : null);
  setVal(ws, 'C13', app.payload?.drive_purpose || (pDrive ? (app.purpose_text || '') : null));
  setVal(ws, 'C14', pDrive
    ? `${fmtRu(app.date_from)} – ${fmtRu(app.date_to || app.date_from)}`
    : null);
}

function fillMmrpSheet(ws, app) {
  const people = (app.people || []).slice(0, 4);
  const kind = app.pass_kind || 'разовый';
  const isPerm = kind === 'постоянный';
  setVal(ws, 'E3', isPerm ? '☐' : '☑');
  setVal(ws, 'F3', isPerm ? '☑' : '☐');
  setVal(ws, 'C6', kind);
  setVal(ws, 'E6', `${fmtRu(app.date_from)} – ${fmtRu(app.date_to || app.date_from)}`);
  setVal(ws, 'B8', app.purpose_text ||
    'производства работ на объектах АО «Аврора Логистика» (южный, северный район, угольная база)');

  for (let i = 0; i < 4; i++) {
    const r = 12 + i;
    const p = people[i];
    const picker = `H${5 + i}`;
    setVal(ws, picker, p ? p.fio : null);
    ['B', 'C', 'D', 'E', 'F'].forEach((col) => clearFormula(ws.getCell(`${col}${r}`)));
    if (!p) {
      ['B', 'C', 'D', 'E', 'F'].forEach((col) => setVal(ws, `${col}${r}`, null));
      continue;
    }
    setVal(ws, `B${r}`, [p.fio, p.position].filter(Boolean).join('\n'));
    setVal(ws, `C${r}`, birthLine(p));
    setVal(ws, `D${r}`, passportMmrp(p));
    setVal(ws, `E${r}`, p.registration_address || p.address || '');
    setVal(ws, `F${r}`, p.phone || '');
  }
}

function fillMlspPassSheet(ws, app) {
  const people = (app.people || []).slice(0, 4);
  const outNo = app.outgoing_number || '141603/—';
  const contract = app.contract_number || '';
  const dateFrom = fmtRu(app.date_from);
  const dateTo = fmtRu(app.date_to || app.contract_end || app.date_from);

  setVal(ws, 'K2', contract);
  for (let i = 0; i < 4; i++) {
    setVal(ws, `K${5 + i}`, people[i]?.fio || null);
  }

  clearFormula(ws.getCell('A5'));
  setVal(ws, 'A5', `Исх. № ${outNo} от ${outDateRu(app.date_from || new Date())}`);

  clearFormula(ws.getCell('A9'));
  setVal(ws, 'A9',
    `Прошу оформить допуск на объект транспортной инфраструктуры МЛСП «Приразломная» на период с ${dateFrom} по ${dateTo}`);

  clearFormula(ws.getCell('A10'));
  setVal(ws, 'A10',
    contract
      ? `Для исполнения обязательств по действующему договору ${contract}`
      : '');

  if (app.subject_text) setVal(ws, 'A11', app.subject_text);

  for (let i = 0; i < 4; i++) {
    const r = 14 + i;
    const p = people[i];
    ['B', 'C', 'D', 'E', 'F'].forEach((col) => clearFormula(ws.getCell(`${col}${r}`)));
    if (!p) {
      ['B', 'C', 'D', 'E', 'F', 'G', 'H'].forEach((col) => setVal(ws, `${col}${r}`, null));
      continue;
    }
    setVal(ws, `B${r}`, fioPhone(p));
    setVal(ws, `C${r}`, positionOrderLine(p));
    setVal(ws, `D${r}`, birthLine(p));
    setVal(ws, `E${r}`, passportLine(p));
    setVal(ws, `F${r}`, p.registration_address || p.address || '');
    setVal(ws, `G${r}`, p.access_zones || app.payload?.access_zones || '');
    setVal(ws, `H${r}`, p.note || '');
  }
}

async function buildFromTemplate(app) {
  const sheetName = SHEET_BY_TYPE[app.app_type];
  if (!sheetName) throw new Error('Нет шаблонного листа для ' + app.app_type);

  const wb = await loadTemplateWb();
  const ws = wb.getWorksheet(sheetName);
  if (!ws) throw new Error('Лист не найден: ' + sheetName);

  switch (app.app_type) {
    case 'flight': fillFlightSheet(ws, app); break;
    case 'ship': fillShipSheet(ws, app); break;
    case 'pass_35srz': fillSrzSheet(ws, app); break;
    case 'pass_mmrp': fillMmrpSheet(ws, app); break;
    case 'pass_mlsp': fillMlspPassSheet(ws, app); break;
    default: break;
  }

  return exportSingleSheet(wb, sheetName);
}

async function buildFsbExcel(app) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ASGARD CRM';
  wb.created = new Date();
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

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

async function buildApplicationExcel(app) {
  if (app.app_type === 'pass_fsb') return buildFsbExcel(app);
  if (!SHEET_BY_TYPE[app.app_type]) {
    throw new Error('Неизвестный тип заявки: ' + app.app_type);
  }
  return buildFromTemplate(app);
}

/**
 * Живой предпросмотр листа: матрица ячеек после материализации.
 */
async function buildPreviewMatrix(app) {
  if (app.app_type === 'pass_fsb') {
    const people = app.people || [];
    return {
      sheet: 'Пропуск_ФСБ',
      draft: true,
      cols: 7,
      rows: [
        { cells: [{ v: 'Ходатайство ФСБ · черновик пр. 102', span: 7, bold: true }] },
        { cells: [{ v: `Срок: ${fmtRu(app.date_from)} – ${fmtRu(app.date_to || app.date_from)}`, span: 7 }] },
        { cells: ['№', 'ФИО', 'Рождение', 'Паспорт', 'Адрес', 'Телефон', 'Получение'].map((v) => ({ v, head: true })) },
        ...people.map((p, i) => ({
          cells: [
            { v: i + 1 },
            { v: p.fio || '' },
            { v: birthLine(p) },
            { v: passportLine(p) },
            { v: p.registration_address || '' },
            { v: p.phone || '' },
            { v: 'личное обращение' }
          ]
        }))
      ]
    };
  }

  const sheetName = SHEET_BY_TYPE[app.app_type];
  const wb = await loadTemplateWb();
  const ws = wb.getWorksheet(sheetName);
  switch (app.app_type) {
    case 'flight': fillFlightSheet(ws, app); break;
    case 'ship': fillShipSheet(ws, app); break;
    case 'pass_35srz': fillSrzSheet(ws, app); break;
    case 'pass_mmrp': fillMmrpSheet(ws, app); break;
    case 'pass_mlsp': fillMlspPassSheet(ws, app); break;
    default: break;
  }

  const maxRow = Math.min(ws.actualRowCount || ws.rowCount || 40, 80);
  const maxCol = Math.min(ws.actualColumnCount || ws.columnCount || 14, 14);
  const rows = [];
  for (let r = 1; r <= maxRow; r++) {
    const cells = [];
    let any = false;
    for (let c = 1; c <= maxCol; c++) {
      const cell = ws.getCell(r, c);
      let v = cell.value;
      if (v && typeof v === 'object') {
        if (v.richText) v = v.richText.map((t) => t.text).join('');
        else if (v.text) v = v.text;
        else if (v.result != null) v = v.result;
        else if (v.formula) v = '';
        else if (v instanceof Date) v = fmtRu(v);
        else v = String(v);
      }
      if (v instanceof Date) v = fmtRu(v);
      if (v != null && String(v).trim() !== '') any = true;
      cells.push({
        v: v == null ? '' : String(v),
        bold: !!(cell.font && cell.font.bold)
      });
    }
    if (any) rows.push({ cells });
  }
  return { sheet: sheetName, draft: false, cols: maxCol, rows };
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
  buildPreviewMatrix,
  filenameFor,
  outDateRu,
  asgardBlock,
  SHEET_BY_TYPE,
  TEMPLATE_PATH
};
