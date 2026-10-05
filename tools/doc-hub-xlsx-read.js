'use strict';
/**
 * SheetJS reader for Doc Hub Excel registries (multi-row headers).
 * exceljs fails on some Downloads xlsx (sheetNo) — use this instead.
 */
const path = require('path');
const XLSX = require('xlsx');

function cellStr(v) {
  if (v == null) return '';
  if (v instanceof Date) {
    // Prefer local calendar components: SheetJS cellDates yields local midnight
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v).replace(/\s+/g, ' ').trim();
}

function isFilterRow(cells) {
  const joined = cells.map(cellStr).join(' ').toLowerCase();
  return /фильтр\s*\d/.test(joined) || /^фильтр/.test(joined);
}

function looksLikeHeader(cells) {
  const joined = cells.map(cellStr).join(' ').toLowerCase();
  return /ответственн/.test(joined) || (/сч[её]т/.test(joined) && /контрагент|сумма|номер/.test(joined));
}

function isGroupHeader(t) {
  return /^(сч[её]т|контрагент|договор|для вити|назначение|закрывающ|акт сверки)/i.test(t);
}

function flattenHeaders(top, sub) {
  const n = Math.max(top.length, sub.length);
  let carry = '';
  const headers = [];
  for (let i = 0; i < n; i++) {
    const t = cellStr(top[i]);
    const s = cellStr(sub[i]);
    if (t) carry = t;

    // Top-level person/object columns: always prefer top label, ignore polluted sub
    if (/ответственн.*документ/i.test(t)) {
      headers[i] = 'Ответственный за документы';
      continue;
    }
    if (/ответственн.*(объект|работ)/i.test(t) || /^рп$/i.test(t)) {
      headers[i] = 'Ответственный за работу';
      continue;
    }
    if (/^объект$/i.test(t)) {
      headers[i] = 'Объект';
      continue;
    }
    if (/^ндс$/i.test(t)) {
      headers[i] = 'НДС';
      continue;
    }

    // Sub row sometimes wrongly repeats role labels in col0 — ignore those as group subs
    const subIsRoleNoise = /^ответственн/i.test(s) || /^объект$/i.test(s);

    if (s && carry && isGroupHeader(carry) && !subIsRoleNoise) {
      headers[i] = `${carry} — ${s}`;
    } else if (s && !carry && !subIsRoleNoise) {
      headers[i] = s;
    } else if (carry && !s) {
      headers[i] = carry;
    } else if (s && !subIsRoleNoise) {
      headers[i] = s;
    } else {
      headers[i] = carry || `col_${i}`;
    }
  }

  // Normalize group sub-headers to canonical merge keys
  let invoiceCols = 0;
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (/сч[её]т\s*—\s*номер|^номер$/i.test(h) && invoiceCols === 0) {
      headers[i] = '№ счёта'; invoiceCols++;
    } else if (/сч[её]т\s*—\s*дата|дата сч/i.test(h)) {
      headers[i] = 'Дата счёта';
    } else if (/сч[её]т\s*—\s*сумма|(^|—\s*)сумма$/i.test(h) && i < 8) {
      headers[i] = 'Сумма';
    } else if (/контрагент\s*—\s*наимен|наименован/i.test(h)) {
      headers[i] = 'Контрагент';
    } else if (/договор\s*—\s*номер/i.test(h)) {
      headers[i] = 'Договор';
    } else if (/договор\s*—\s*дата/i.test(h)) {
      headers[i] = 'Дата договора';
    } else if (/^сумма$/i.test(h) && i < 8) {
      headers[i] = 'Сумма';
    }
  }

  // File B quirk: top col2 empty under "Ответственный за объект" group — data col2 is Объект
  // If we still have three identical "Ответственный за работу" at start, fix col2 → Объект
  if (
    headers[0] === 'Ответственный за работу'
    && headers[1] === 'Ответственный за работу'
    && headers[2] === 'Ответственный за работу'
  ) {
    headers[0] = 'Ответственный за документы';
    headers[2] = 'Объект';
  } else if (
    headers[0] === 'Ответственный за документы'
    && !headers[2]
  ) {
    headers[2] = 'Объект';
  } else if (
    /ответственн/i.test(headers[1] || '')
    && (!headers[2] || /ответственн/i.test(headers[2]))
    && /сч[её]т|№ счёта|номер/i.test(headers[3] || '')
  ) {
    // top[2] empty → still Объект column in both files
    headers[2] = 'Объект';
  }
  return headers;
}

function detectHeaderBlock(aoa) {
  let topRi = -1;
  for (let i = 0; i < Math.min(aoa.length, 30); i++) {
    if (looksLikeHeader(aoa[i] || [])) {
      topRi = i;
      break;
    }
  }
  if (topRi < 0) return { topRi: 0, subRi: -1, dataRi: 1, headers: (aoa[0] || []).map(cellStr) };

  const top = aoa[topRi] || [];
  let subRi = -1;
  const next = aoa[topRi + 1] || [];
  const nextJoined = next.map(cellStr).join(' ').toLowerCase();
  if (/номер|дата|сумма|наименован|e-?mail|телефон|скан|оригинал/.test(nextJoined) && !isFilterRow(next)) {
    subRi = topRi + 1;
  }
  const headers = subRi >= 0 ? flattenHeaders(top, aoa[subRi]) : top.map(cellStr);

  let dataRi = (subRi >= 0 ? subRi : topRi) + 1;
  while (dataRi < aoa.length && isFilterRow(aoa[dataRi] || [])) dataRi++;
  return { topRi, subRi, dataRi, headers };
}

function parseAmount(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  let s = cellStr(v)
    .replace(/[₽руб]/gi, '')
    .replace(/\s/g, '')
    .replace(/\.+$/, '');
  if (!s) return 0;
  const neg = /^-/.test(s);
  s = s.replace(/^-/, '');
  // both separators → last is decimal
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (s.includes(',')) {
    // 2200,00 or 2,200
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  }
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}

function parseDate(v) {
  if (v instanceof Date && !isNaN(v)) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    const epoch = Date.UTC(1899, 11, 30);
    const ms = epoch + Math.round(v) * 86400000 + 12 * 3600000;
    const dt = new Date(ms);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  let s = cellStr(v);
  if (!s) return null;
  s = s.replace(/^от\s+/i, '').trim();
  // DD.MM.YYYY / DD/MM/YYYY / DD,MM,YYYY
  let m = s.match(/^(\d{1,2})[./,](\d{1,2})[./,](\d{2,4})$/);
  if (m) {
    let year = m[3];
    if (year.length === 2) year = (parseInt(year, 10) >= 70 ? '19' : '20') + year;
    const iso = `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    const dt = new Date(iso + 'T12:00:00Z');
    if (isNaN(dt.getTime())) return null;
    return iso;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/**
 * @returns {{ sheet: string, headers: string[], rows: object[], meta: object }}
 */
function readRegistryFile(file) {
  const wb = XLSX.readFile(file, { cellDates: false, raw: false });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  const { topRi, subRi, dataRi, headers } = detectHeaderBlock(aoa);
  const rows = [];
  for (let ri = dataRi; ri < aoa.length; ri++) {
    const cells = aoa[ri] || [];
    if (isFilterRow(cells)) continue;
    const obj = { _source: path.basename(file), _row: ri + 1, _sheet: sheetName };
    let empty = true;
    headers.forEach((h, col) => {
      if (!h) return;
      let v = cells[col];
      if (v != null && cellStr(v) !== '') empty = false;
      obj[h] = v;
    });
    if (!empty) rows.push(obj);
  }
  return {
    sheet: sheetName,
    headers,
    rows,
    meta: { file, sheets: wb.SheetNames, topRi, subRi, dataRi, rowCount: rows.length }
  };
}

module.exports = {
  readRegistryFile,
  parseAmount,
  parseDate,
  cellStr,
  detectHeaderBlock
};
