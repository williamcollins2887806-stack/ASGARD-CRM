'use strict';

/**
 * Генерация Excel-бланков МЛСП.
 * Источник: templates/mlsp/base-generator.xlsx (MD5 = «База и генератор заявок (5).xlsx»).
 * ФСБ: templates/mlsp/fsb-petition.xlsx (Приказ ФСБ 102, прил. 3/5).
 * Предпросмотр = HTML того же заполненного листа (мерджи, ширины, стили).
 */

const path = require('path');
const ExcelJS = require('exceljs');
const { fmtRu, ymd } = require('./mlsp-passes-rules');

const TEMPLATE_PATH = path.join(__dirname, '../../templates/mlsp/base-generator.xlsx');
const FSB_TEMPLATE_PATH = path.join(__dirname, '../../templates/mlsp/fsb-petition.xlsx');

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

const ASGARD_ORG = {
  name: 'ООО «АСГАРД-Сервис»',
  inn: '7736244785',
  kpp: '770101001',
  addr: '105082, г. Москва, ул. Большая Почтовая, д. 55/59, стр. 1, пом. 37',
  phone: '+7(499)322-30-62',
  email: 'hv@asgard-service.com',
  signTitle: 'Генеральный директор ООО «АСГАРД-Сервис»',
  signName: 'О.С. Кудряшов'
};

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
  return `Наименование юр. лица ${ASGARD_ORG.name}, реквизиты (ИНН/КПП ${ASGARD_ORG.inn}/${ASGARD_ORG.kpp}, юр. адрес\n${ASGARD_ORG.addr}, телефон ${ASGARD_ORG.phone}, e-mail: ${ASGARD_ORG.email})`;
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

async function loadFsbWb() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FSB_TEMPLATE_PATH);
  return wb;
}

function excelWidthToPx(w) {
  const n = Number(w);
  if (!Number.isFinite(n) || n <= 0) return 64;
  return Math.round(n * 7.2 + 5);
}

function excelHeightToPx(h) {
  const n = Number(h);
  if (!Number.isFinite(n) || n <= 0) return 20;
  return Math.round(n * 1.33);
}

function argbToCss(argb) {
  if (!argb) return null;
  const s = String(argb);
  if (s.length === 8) return `#${s.slice(2)}`;
  if (s.length === 6) return `#${s}`;
  return null;
}

function cellDisplayValue(cell) {
  let v = cell.value;
  if (v == null) return '';
  if (v instanceof Date) return fmtRu(v);
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text != null) return String(v.text);
    if (v.result != null) {
      if (v.result instanceof Date) return fmtRu(v.result);
      return String(v.result);
    }
    if (v.formula) return '';
    if (v.sharedFormula) return '';
    if (v.error) return '';
    if (typeof v === 'object' && v.hyperlink) return String(v.text || v.hyperlink);
  }
  return String(v);
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cellInlineStyle(cell) {
  const parts = [];
  const font = cell.font || {};
  if (font.bold) parts.push('font-weight:700');
  if (font.italic) parts.push('font-style:italic');
  if (font.size) parts.push(`font-size:${font.size}pt`);
  const color = argbToCss(font.color && font.color.argb);
  if (color) parts.push(`color:${color}`);
  const fill = cell.fill;
  if (fill && fill.type === 'pattern' && fill.pattern === 'solid' && fill.fgColor) {
    const bg = argbToCss(fill.fgColor.argb);
    if (bg) parts.push(`background:${bg}`);
  }
  const al = cell.alignment || {};
  if (al.horizontal) parts.push(`text-align:${al.horizontal}`);
  if (al.vertical) parts.push(`vertical-align:${al.vertical === 'center' ? 'middle' : al.vertical}`);
  if (al.wrapText) parts.push('white-space:pre-wrap');
  else parts.push('white-space:pre');

  const b = cell.border || {};
  const edge = (side, key) => {
    const e = b[key];
    if (!e || !e.style || e.style === 'none') return;
    const c = argbToCss(e.color && e.color.argb) || '#94a3b8';
    const w = e.style === 'medium' || e.style === 'thick' ? '2px' : '1px';
    parts.push(`border-${side}:${w} solid ${c}`);
  };
  edge('top', 'top');
  edge('right', 'right');
  edge('bottom', 'bottom');
  edge('left', 'left');
  return parts.join(';');
}

/**
 * HTML листа 1:1 с заполненным worksheet (мерджи, ширины, высоты, стили ячеек).
 */
function worksheetToHtml(ws) {
  const merges = [];
  const covered = new Set();
  const mergeMaster = new Map();

  (ws.model?.merges || []).forEach((m) => {
    // ExcelJS may expose merges as strings "A1:B2"
    const range = typeof m === 'string' ? m : null;
    if (range) {
      const [a, b] = range.split(':');
      const start = ws.getCell(a);
      const end = ws.getCell(b);
      const r1 = start.row; const c1 = start.col;
      const r2 = end.row; const c2 = end.col;
      merges.push({ r1, c1, r2, c2 });
    }
  });

  // Prefer worksheet._merges / eachCell approach via actual merges collection
  if (ws._merges) {
    Object.values(ws._merges).forEach((range) => {
      if (!range || range.top == null) return;
      merges.push({
        r1: range.top, c1: range.left, r2: range.bottom, c2: range.right
      });
    });
  }

  // Fallback: ExcelJS 4.x model
  if (!merges.length && ws.model && Array.isArray(ws.model.merges)) {
    for (const ref of ws.model.merges) {
      const [a, b] = String(ref).split(':');
      if (!a || !b) continue;
      const ca = ws.getCell(a);
      const cb = ws.getCell(b);
      merges.push({ r1: ca.row, c1: ca.col, r2: cb.row, c2: cb.col });
    }
  }

  for (const m of merges) {
    mergeMaster.set(`${m.r1}:${m.c1}`, m);
    for (let r = m.r1; r <= m.r2; r++) {
      for (let c = m.c1; c <= m.c2; c++) {
        if (r === m.r1 && c === m.c1) continue;
        covered.add(`${r}:${c}`);
      }
    }
  }

  let maxRow = 0;
  let maxCol = 0;
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    maxRow = Math.max(maxRow, rowNumber);
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      maxCol = Math.max(maxCol, colNumber);
    });
  });
  for (const m of merges) {
    maxRow = Math.max(maxRow, m.r2);
    maxCol = Math.max(maxCol, m.c2);
  }
  maxRow = Math.min(Math.max(maxRow, 1), 90);
  maxCol = Math.min(Math.max(maxCol, 1), 16);

  const colgroup = [];
  for (let c = 1; c <= maxCol; c++) {
    const dim = ws.getColumn(c);
    const w = excelWidthToPx(dim.width || 10);
    colgroup.push(`<col style="width:${w}px">`);
  }

  const rowsHtml = [];
  for (let r = 1; r <= maxRow; r++) {
    const row = ws.getRow(r);
    const h = excelHeightToPx(row.height || 15);
    const tds = [];
    for (let c = 1; c <= maxCol; c++) {
      const key = `${r}:${c}`;
      if (covered.has(key)) continue;
      const cell = ws.getCell(r, c);
      const master = mergeMaster.get(key);
      let attrs = '';
      if (master) {
        const rs = master.r2 - master.r1 + 1;
        const cs = master.c2 - master.c1 + 1;
        if (rs > 1) attrs += ` rowspan="${rs}"`;
        if (cs > 1) attrs += ` colspan="${cs}"`;
      }
      const style = cellInlineStyle(cell);
      const text = escHtml(cellDisplayValue(cell)).replace(/\n/g, '<br>');
      tds.push(`<td${attrs} style="${style}">${text}</td>`);
    }
    rowsHtml.push(`<tr style="height:${h}px">${tds.join('')}</tr>`);
  }

  const orient = (ws.pageSetup && ws.pageSetup.orientation) || 'portrait';
  return {
    orientation: orient,
    html: `<table class="mlsp-xsheet" data-orient="${escHtml(orient)}"><colgroup>${colgroup.join('')}</colgroup><tbody>${rowsHtml.join('')}</tbody></table>`
  };
}

/** Оставить только один лист; формулы на нём уже материализованы. */
async function exportSingleSheet(wb, keepName) {
  const keep = wb.getWorksheet(keepName);
  if (!keep) throw new Error('В шаблоне нет листа: ' + keepName);

  if (keep.dataValidations && keep.dataValidations.model) {
    keep.dataValidations.model = [];
  }

  const names = wb.worksheets.map((w) => w.name);
  for (const name of names) {
    if (name !== keepName) wb.removeWorksheet(name);
  }

  if (wb.definedNames && typeof wb.definedNames.model !== 'undefined') {
    try { wb.definedNames.model = []; } catch (_) { /* ignore */ }
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
      ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'M', 'N'].forEach((col) => clearFormula(ws.getCell(`${col}${r}`)));
      setVal(ws, `C${r}`, null);
      setVal(ws, `L${r}`, null);
      if (!p) {
        ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'M', 'N'].forEach((col) => setVal(ws, `${col}${r}`, null));
        continue;
      }
      const contract = p.contract_number || app.contract_number || '';
      setVal(ws, `C${r}`, p.fio || '');
      setVal(ws, `D${r}`, p.org || ASGARD_ORG.name);
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
    setVal(ws, `C${r}`, p.org || ASGARD_ORG.name);
    setVal(ws, `D${r}`, p.position || '');
    setVal(ws, `E${r}`, birthShipLine(p));
    setVal(ws, `F${r}`, passportShipLine(p));
    setVal(ws, `G${r}`, p.contract_number || app.contract_number || '');
  }

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
    setVal(ws, `H${r}`, p ? (p.org || ASGARD_ORG.name) : null);
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
  setVal(ws, 'G12', pDrive ? (pDrive.org || ASGARD_ORG.name) : null);
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

function replacePlaceholders(ws, map) {
  ws.eachRow({ includeEmpty: true }, (row) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      if (typeof cell.value === 'string') {
        let s = cell.value;
        let changed = false;
        for (const [k, v] of Object.entries(map)) {
          if (s.includes(k)) {
            s = s.split(k).join(v == null ? '' : String(v));
            changed = true;
          }
        }
        if (changed) cell.value = s;
      }
    });
  });
}

async function fillFsbWorkbook(app) {
  const wb = await loadFsbWb();
  const collective = app.pass_kind === 'collective' || (app.people || []).length > 1;
  const keepName = collective ? 'ФСБ_прил5' : 'ФСБ_прил3';
  const drop = collective ? 'ФСБ_прил3' : 'ФСБ_прил5';
  if (wb.getWorksheet(drop)) wb.removeWorksheet(drop);

  const ws = wb.getWorksheet(keepName);
  const people = app.people || [];
  const p0 = people[0] || {};
  const map = {
    '{{BORDER_ZONE}}': app.payload?.border_zone ||
      'Ненецкий автономный округ, муниципальный район Заполярный, п. Варандей (пограничная зона)',
    '{{PURPOSE}}': app.purpose_text ||
      `выполнение работ по договору ${app.contract_number || ''} на МЛСП «Приразломная»`,
    '{{DATE_FROM}}': fmtRu(app.date_from) || '',
    '{{DATE_TO}}': fmtRu(app.date_to || app.date_from) || '',
    '{{VEHICLE}}': app.payload?.vehicle || '—',
    '{{FIO}}': p0.fio || '',
    '{{BIRTH}}': birthLine(p0),
    '{{CITIZENSHIP}}': p0.citizenship || 'гражданин Российской Федерации',
    '{{SEX}}': p0.sex || '',
    '{{ADDR_REG}}': p0.registration_address || p0.address || '',
    '{{ADDR_STAY}}': p0.stay_address || '',
    '{{ADDR_FACT}}': p0.fact_address || p0.registration_address || '',
    '{{PHONE}}': p0.phone || '',
    '{{EMAIL}}': p0.email || '',
    '{{PASSPORT}}': passportLine(p0),
    '{{ORG_NAME}}': ASGARD_ORG.name,
    '{{ORG_INN}}': ASGARD_ORG.inn,
    '{{ORG_ADDR}}': ASGARD_ORG.addr,
    '{{ORG_POST}}': ASGARD_ORG.addr,
    '{{ORG_CONTACTS}}': `${ASGARD_ORG.phone} / ${ASGARD_ORG.email}`,
    '{{RECEIVE_KIND}}': app.payload?.receive_kind || 'первичное',
    '{{RECEIVE_MODE}}': app.payload?.receive_mode || 'личное обращение в пограничный орган',
    '{{SIGN_TITLE}}': ASGARD_ORG.signTitle,
    '{{SIGN_NAME}}': ASGARD_ORG.signName
  };
  replacePlaceholders(ws, map);

  if (collective) {
    for (let i = 0; i < 25; i++) {
      const r = 5 + i;
      const p = people[i];
      if (!p) {
        for (let c = 2; c <= 8; c++) setVal(ws, ws.getCell(r, c).address, null);
        continue;
      }
      setVal(ws, `B${r}`, p.fio || '');
      setVal(ws, `C${r}`, birthLine(p));
      setVal(ws, `D${r}`, p.citizenship || 'РФ');
      setVal(ws, `E${r}`, passportLine(p));
      setVal(ws, `F${r}`, p.registration_address || p.address || '');
      setVal(ws, `G${r}`, p.phone || '');
      setVal(ws, `H${r}`, p.note || '');
    }
  }

  return { wb, sheetName: keepName };
}

async function prepareFilledWorkbook(app) {
  if (app.app_type === 'pass_fsb') return fillFsbWorkbook(app);

  const sheetName = SHEET_BY_TYPE[app.app_type];
  if (!sheetName) throw new Error('Неизвестный тип заявки: ' + app.app_type);

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
  return { wb, sheetName };
}

async function buildApplicationExcel(app) {
  const { wb, sheetName } = await prepareFilledWorkbook(app);
  return exportSingleSheet(wb, sheetName);
}

/**
 * Предпросмотр: HTML того же листа, что уйдёт в Excel.
 */
async function buildPreviewDocument(app) {
  const { wb, sheetName } = await prepareFilledWorkbook(app);
  const ws = wb.getWorksheet(sheetName);
  const rendered = worksheetToHtml(ws);
  return {
    sheet: sheetName,
    draft: false,
    source: app.app_type === 'pass_fsb' ? 'fsb-petition.xlsx · пр. 102' : 'base-generator.xlsx',
    orientation: rendered.orientation,
    html: rendered.html
  };
}

/** @deprecated alias — тесты/старый код */
async function buildPreviewMatrix(app) {
  const doc = await buildPreviewDocument(app);
  return {
    sheet: doc.sheet,
    draft: doc.draft,
    cols: 0,
    rows: [],
    html: doc.html,
    orientation: doc.orientation,
    source: doc.source
  };
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
  buildPreviewDocument,
  buildPreviewMatrix,
  prepareFilledWorkbook,
  worksheetToHtml,
  filenameFor,
  outDateRu,
  asgardBlock,
  SHEET_BY_TYPE,
  TEMPLATE_PATH,
  FSB_TEMPLATE_PATH
};
