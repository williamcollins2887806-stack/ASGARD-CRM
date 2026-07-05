/**
 * Shared helpers: Excel → normalized rows, period from sheet names, CRM matching
 */
const path = require('path');
const fs = require('fs');

const STATUS_MAP = {
  'рассмотрение': 'рассмотрение',
  'готовим': 'готовим',
  'подались': 'подались',
  'проиграли': 'проиграли',
  'отмена': 'отмена',
  'выиграли': 'выиграли'
};

/** Приоритет статуса — не понижаем тендер с работой */
const REGISTRY_STATUS_RANK = {
  'рассмотрение': 1,
  'готовим': 2,
  'подались': 3,
  'проиграли': 4,
  'отмена': 4,
  'выиграли': 6
};

const MONTH_RU = {
  январ: 1, феврал: 2, март: 3, апрел: 4, май: 5, июн: 6,
  июл: 7, август: 8, сентябр: 9, октябр: 10, ноябр: 11, декабр: 12
};

const DEFAULT_XLSX = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  'Downloads',
  'Тендеры_сводная.xlsx'
);

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toPeriod(year, month) {
  if (!year || !month || month < 1 || month > 12) return null;
  return `${year}-${pad2(month)}`;
}

/** Parse sheet name or period column → YYYY-MM */
function parsePeriodFromText(text) {
  if (!text) return null;
  const s = String(text).trim().toLowerCase().replace(/\s+/g, ' ');

  let m = s.match(/^(\d{4})[-_.\/](\d{1,2})$/);
  if (m) return toPeriod(parseInt(m[1], 10), parseInt(m[2], 10));

  m = s.match(/^(\d{1,2})[-_.\/](\d{4})$/);
  if (m) return toPeriod(parseInt(m[2], 10), parseInt(m[1], 10));

  m = s.match(/^(\d{4})(\d{2})$/);
  if (m) return toPeriod(parseInt(m[1], 10), parseInt(m[2], 10));

  for (const [prefix, mo] of Object.entries(MONTH_RU)) {
    if (s.includes(prefix)) {
      const ym = s.match(/(20\d{2})/);
      const yy = s.match(/\b(\d{2})\b/);
      let year = ym ? parseInt(ym[1], 10) : null;
      if (!year && yy) {
        const n = parseInt(yy[1], 10);
        year = n >= 0 && n <= 99 ? 2000 + n : null;
      }
      if (year) return toPeriod(year, mo);
    }
  }
  return null;
}

function normTitle(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40);
}

function normUrl(s) {
  const u = String(s || '').trim();
  return u || null;
}

function parseRegistryStatus(raw) {
  const key = String(raw || 'рассмотрение').trim().toLowerCase();
  return STATUS_MAP[key] || 'рассмотрение';
}

function cellVal(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && v.text) return String(v.text);
  return String(v);
}

function parsePrice(val) {
  if (val == null || val === '') return null;
  const n = Number(String(val).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Безопасный парсинг даты для PostgreSQL date */
function parseDocsDeadline(val) {
  if (val == null || val === '') return null;
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10);
  }
  if (typeof val === 'number' && Number.isFinite(val)) {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = cellVal(val).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  const dmy = s.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
  if (dmy) {
    const [, dd, mm, yy] = dmy;
    return `${yy}-${pad2(parseInt(mm, 10))}-${pad2(parseInt(dd, 10))}`;
  }

  const ru = s.toLowerCase();
  let day = null;
  let year = null;
  let month = null;
  const quoted = ru.match(/[«"'](\d{1,2})[»"']/);
  if (quoted) {
    day = parseInt(quoted[1], 10);
  } else {
    const dm = ru.match(/\b(\d{1,2})\b/);
    if (dm) day = parseInt(dm[1], 10);
  }
  const ym = ru.match(/(20\d{2})/);
  if (ym) year = parseInt(ym[1], 10);
  for (const [prefix, mo] of Object.entries(MONTH_RU)) {
    if (ru.includes(prefix)) {
      month = mo;
      break;
    }
  }
  if (day && month && year) {
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  return null;
}

function normalizeExcelRow(row, ctx = {}) {
  const customer_name = String(
    row['Заказчик'] || row['Компания'] || row.customer_name || ''
  ).trim();
  const tender_title = String(
    row['Наименование'] || row['Тендер'] || row['Название'] || row.tender_title || row.title || ''
  ).trim();
  if (!customer_name && !tender_title) return null;

  const period =
    row.period ||
    parsePeriodFromText(row['Источник (месяц)'] || row['Период'] || row['period']) ||
    parsePeriodFromText(ctx.sheetName) ||
    null;

  const rawStatus = String(row['Статус'] || row.status || 'рассмотрение').trim().toLowerCase();

  return {
    customer_name: customer_name || null,
    tender_title: tender_title || null,
    customer_inn: String(row['ИНН'] || row.customer_inn || '').replace(/\D/g, '') || null,
    registry_status: parseRegistryStatus(rawStatus),
    tender_price: parsePrice(row['НМЦ'] || row['НМЦ, с НДС'] || row.tender_price),
    docs_deadline: parseDocsDeadline(row['Срок подачи'] || row.docs_deadline),
    purchase_url: normUrl(row['Ссылка на площадку'] || row.purchase_url || row.url),
    reject_reason: String(row['Причины отказа'] || row.reject_reason || '').trim() || null,
    comment_to: String(row['Комментарий'] || row.comment_to || '').trim() || null,
    created_by_name: String(
      row['Добавил'] || row['Кто занимается расчетом'] || row.created_by || ''
    ).trim().toLowerCase() || null,
    period,
    source_sheet: ctx.sheetName || null,
    _title_key: normTitle(tender_title)
  };
}

async function loadExceljs() {
  try {
    return require('exceljs');
  } catch (_) {
    throw new Error('Установите exceljs: npm install exceljs');
  }
}

/** Read all sheets; each row gets period from sheet name unless column present */
async function readWorkbookRows(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Файл не найден: ${filePath}`);
  }
  const ExcelJS = await loadExceljs();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const rows = [];
  const byPeriod = {};

  for (const sheet of wb.worksheets) {
    if (!sheet || sheet.rowCount < 2) continue;
    const headerRow = sheet.getRow(1);
    const headers = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
      headers[col] = cellVal(cell.value).trim();
    });

    for (let r = 2; r <= sheet.rowCount; r++) {
      const line = sheet.getRow(r);
      const obj = {};
      line.eachCell({ includeEmpty: true }, (cell, col) => {
        const h = headers[col];
        if (h) obj[h] = cellVal(cell.value);
      });
      const norm = normalizeExcelRow(obj, { sheetName: sheet.name });
      if (!norm) continue;
      rows.push(norm);
      const p = norm.period || 'unknown';
      byPeriod[p] = (byPeriod[p] || 0) + 1;
    }
  }

  return { rows, byPeriod, sheetCount: wb.worksheets.length };
}

/** Одна строка Excel на URL — самый поздний period + высший статус */
function dedupeExcelRowsByUrl(rows) {
  const withoutUrl = [];
  const byUrl = new Map();

  for (const row of rows) {
    const url = normUrl(row.purchase_url);
    if (!url) {
      withoutUrl.push(row);
      continue;
    }
    const cur = byUrl.get(url);
    if (!cur) {
      byUrl.set(url, row);
      continue;
    }
    const curPeriod = cur.period || '';
    const rowPeriod = row.period || '';
    const curRank = REGISTRY_STATUS_RANK[cur.registry_status] || 0;
    const rowRank = REGISTRY_STATUS_RANK[row.registry_status] || 0;
    if (rowPeriod > curPeriod || (rowPeriod === curPeriod && rowRank > curRank)) {
      byUrl.set(url, row);
    }
  }

  return [...withoutUrl, ...byUrl.values()];
}

function buildCrmIndex(tenderRows) {
  const byUrl = new Map();
  const byInnTitle = new Map();
  const byNameTitle = new Map();

  for (const t of tenderRows) {
    if (t.deleted_at) continue;
    const url = normUrl(t.purchase_url);
    if (url) byUrl.set(url, t);
    const tk = normTitle(t.tender_title);
    if (t.customer_inn && tk) {
      byInnTitle.set(`${t.customer_inn}|${tk}`, t);
    }
    if (t.customer_name && tk) {
      byNameTitle.set(`${normTitle(t.customer_name)}|${tk}`, t);
    }
  }
  return { byUrl, byInnTitle, byNameTitle };
}

function fieldsNeedMerge(crm, excel) {
  const patch = {};
  if (!crm.period && excel.period) patch.period = excel.period;
  if (!crm.registry_status && excel.registry_status) patch.registry_status = excel.registry_status;
  if (!crm.tender_price && excel.tender_price) patch.tender_price = excel.tender_price;
  if (!crm.docs_deadline && excel.docs_deadline) patch.docs_deadline = excel.docs_deadline;
  if (!crm.purchase_url && excel.purchase_url) patch.purchase_url = excel.purchase_url;
  if (!crm.customer_inn && excel.customer_inn) patch.customer_inn = excel.customer_inn;
  return patch;
}

function hasConflict(crm, excel) {
  if (crm.registry_status && excel.registry_status &&
      crm.registry_status !== excel.registry_status) return 'registry_status';
  if (crm.tender_price && excel.tender_price &&
      Math.abs(Number(crm.tender_price) - Number(excel.tender_price)) > 1) return 'tender_price';
  return null;
}

/** Excel — источник правды для реестра; не понижаем статус если есть work */
function buildExcelRegistryPatch(crm, excel, { hasWork = false } = {}) {
  const patch = fieldsNeedMerge(crm, excel);

  if (excel.period && excel.period !== crm.period) {
    patch.period = excel.period;
  }

  const excelSt = excel.registry_status;
  const crmSt = crm.registry_status;
  const excelRank = REGISTRY_STATUS_RANK[excelSt] || 0;
  const crmRank = REGISTRY_STATUS_RANK[crmSt] || 0;

  if (excelSt && excelSt !== crmSt) {
    if (hasWork && crmRank >= REGISTRY_STATUS_RANK['выиграли']) {
      /* тендер с работой / выигран — не трогаем статус */
    } else if (hasWork && crmRank > excelRank) {
      /* не понижаем */
    } else {
      patch.registry_status = excelSt;
    }
  }

  if (excel.tender_price && !crm.tender_price) {
    patch.tender_price = excel.tender_price;
  }

  return patch;
}

function resolveImportMatch(m, ctx = {}) {
  const { hasWork = false, strategy = 'excel_registry' } = ctx;

  if (m.action === 'new') return m;

  if (m.action === 'duplicate_skip') return m;

  if (m.action === 'duplicate_merge') return m;

  if (m.action === 'conflict' && strategy === 'excel_registry') {
    const patch = buildExcelRegistryPatch(m.crm, m.row, { hasWork });
    if (Object.keys(patch).length) {
      return {
        action: 'duplicate_merge',
        tender_id: m.tender_id,
        patch,
        crm: m.crm,
        row: m.row,
        resolved_from: 'conflict',
        conflict: m.conflict
      };
    }
    return {
      action: 'duplicate_skip',
      tender_id: m.tender_id,
      crm: m.crm,
      row: m.row,
      resolved_from: 'conflict_skip',
      conflict: m.conflict
    };
  }

  return m;
}

function matchRowToCrm(row, index) {
  const url = normUrl(row.purchase_url);
  if (url && index.byUrl.has(url)) {
    const crm = index.byUrl.get(url);
    const conflict = hasConflict(crm, row);
    if (conflict) return { action: 'conflict', tender_id: crm.id, conflict, crm, row };
    const patch = fieldsNeedMerge(crm, row);
    if (Object.keys(patch).length) {
      return { action: 'duplicate_merge', tender_id: crm.id, patch, crm, row };
    }
    return { action: 'duplicate_skip', tender_id: crm.id, crm, row };
  }

  if (row.customer_inn && row._title_key) {
    const key = `${row.customer_inn}|${row._title_key}`;
    if (index.byInnTitle.has(key)) {
      const crm = index.byInnTitle.get(key);
      const conflict = hasConflict(crm, row);
      if (conflict) return { action: 'conflict', tender_id: crm.id, conflict, crm, row };
      const patch = fieldsNeedMerge(crm, row);
      if (Object.keys(patch).length) {
        return { action: 'duplicate_merge', tender_id: crm.id, patch, crm, row };
      }
      return { action: 'duplicate_skip', tender_id: crm.id, crm, row };
    }
  }

  if (row.customer_name && row._title_key) {
    const key = `${normTitle(row.customer_name)}|${row._title_key}`;
    if (index.byNameTitle.has(key)) {
      const crm = index.byNameTitle.get(key);
      const conflict = hasConflict(crm, row);
      if (conflict) return { action: 'conflict', tender_id: crm.id, conflict, crm, row };
      const patch = fieldsNeedMerge(crm, row);
      if (Object.keys(patch).length) {
        return { action: 'duplicate_merge', tender_id: crm.id, patch, crm, row };
      }
      return { action: 'duplicate_skip', tender_id: crm.id, crm, row };
    }
  }

  return { action: 'new', row };
}

function auditRowsAgainstCrm(excelRows, crmRows) {
  const index = buildCrmIndex(crmRows);
  const summary = { new: 0, duplicate_skip: 0, duplicate_merge: 0, conflict: 0, skipped: 0 };
  const items = [];
  const byPeriod = {};

  for (const row of excelRows) {
    const m = matchRowToCrm(row, index);
    if (summary[m.action] !== undefined) summary[m.action]++;
    else summary.skipped++;
    const p = row.period || 'unknown';
    byPeriod[p] = byPeriod[p] || { new: 0, duplicate_skip: 0, duplicate_merge: 0, conflict: 0 };
    byPeriod[p][m.action] = (byPeriod[p][m.action] || 0) + 1;
    if (items.length < 500) {
      items.push({
        action: m.action,
        tender_id: m.tender_id || null,
        conflict: m.conflict || null,
        period: row.period,
        customer_name: row.customer_name,
        tender_title: row.tender_title?.slice(0, 60)
      });
    }
  }

  return { summary, byPeriod, items, total: excelRows.length };
}

function buildPeriodFilterSql(periodParam, params) {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;

  if (periodParam === 'all' || periodParam === '') {
    return { clause: '', periodLabel: 'all', applied: null };
  }

  if (!periodParam || periodParam === 'current') {
    params.push(currentMonth);
    return {
      clause: ` AND t.period = $${params.length}`,
      periodLabel: currentMonth,
      applied: currentMonth
    };
  }

  if (String(periodParam).startsWith('year:')) {
    const y = String(periodParam).split(':')[1];
    params.push(`${y}-%`);
    return {
      clause: ` AND t.period LIKE $${params.length}`,
      periodLabel: `year:${y}`,
      applied: periodParam
    };
  }

  if (/^\d{4}-\d{2}$/.test(String(periodParam))) {
    params.push(periodParam);
    return {
      clause: ` AND t.period = $${params.length}`,
      periodLabel: periodParam,
      applied: periodParam
    };
  }

  params.push(currentMonth);
  return {
    clause: ` AND t.period = $${params.length}`,
    periodLabel: currentMonth,
    applied: currentMonth
  };
}

function buildRegistryPeriodOptions() {
  const now = new Date();
  const y = now.getFullYear();
  const opts = [
    { value: 'current', label: 'Текущий месяц' },
    { value: '', label: 'Все тендеры' },
    { value: `year:${y}`, label: `За ${y} год` },
    { value: `year:${y - 1}`, label: `За ${y - 1} год` }
  ];
  for (let i = 0; i < 12; i++) {
    const d = new Date(y, now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    opts.push({
      value: ym,
      label: d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
    });
  }
  return opts;
}

module.exports = {
  DEFAULT_XLSX,
  STATUS_MAP,
  REGISTRY_STATUS_RANK,
  parsePeriodFromText,
  parsePrice,
  parseDocsDeadline,
  normalizeExcelRow,
  readWorkbookRows,
  dedupeExcelRowsByUrl,
  buildCrmIndex,
  matchRowToCrm,
  buildExcelRegistryPatch,
  resolveImportMatch,
  auditRowsAgainstCrm,
  buildPeriodFilterSql,
  buildRegistryPeriodOptions,
  normTitle,
  normUrl
};
