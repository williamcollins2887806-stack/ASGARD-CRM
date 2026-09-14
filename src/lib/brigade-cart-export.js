'use strict';

/**
 * Печатный Excel состава бригады (A4) + раздел допусков.
 */

const ExcelJS = require('exceljs');

const KEY_PERMIT_RE = /(BOSIET|РУКАВ|SLEEVE|FSB|ФСБ|MLSP|МЛСП|H2S|ОГНЕ|HEIGHT|ВЫСОТ|ОХРАН|ПРОМБЕЗ|ПБ|НАКС|СВАР)/i;

const COLORS = {
  headerBg: 'FF1F4E79',
  headerFg: 'FFFFFFFF',
  titleBg: 'FF0F2942',
  metaBg: 'FFE8EEF4',
  alt: 'FFF5F8FB',
  border: 'FFCBD5E1',
  ok: 'FFDCFCE7',
  okFg: 'FF166534',
  warn: 'FFFEF3C7',
  warnFg: 'FF92400E',
  err: 'FFFEE2E2',
  errFg: 'FFB91C1C',
  none: 'FFF1F5F9',
  noneFg: 'FF64748B'
};

function ymd(d) {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  try {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch {
    return String(d).slice(0, 10);
  }
}

function fmtRu(d) {
  const s = ymd(d);
  if (!s || s.length < 10) return '';
  return `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
}

function statusRu(code) {
  const map = {
    on_site: 'На объекте',
    approved: 'Согласован',
    ready: 'Готов',
    not_ready: 'Не готов',
    unknown: 'Без статуса',
    archive: 'Архив',
    planned: 'План'
  };
  return map[code] || code || '—';
}

function thinBorder() {
  const s = { style: 'thin', color: { argb: COLORS.border } };
  return { top: s, left: s, bottom: s, right: s };
}

function applyPrintA4(ws, orientation = 'landscape') {
  ws.pageSetup = {
    paperSize: 9, // A4
    orientation,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: {
      left: 0.4,
      right: 0.4,
      top: 0.45,
      bottom: 0.45,
      header: 0.2,
      footer: 0.25
    }
  };
  ws.headerFooter = {
    oddFooter: '&L&A&Cстр. &P из &N&RASGARD CRM'
  };
  ws.properties.defaultRowHeight = 16;
}

function paintTitleBlock(ws, opts) {
  const {
    title,
    subtitle,
    metaLine,
    colCount
  } = opts;
  const lastCol = colCount;

  ws.mergeCells(1, 1, 1, lastCol);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { name: 'Arial', size: 16, bold: true, color: { argb: COLORS.headerFg } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.titleBg } };
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 28;

  ws.mergeCells(2, 1, 2, lastCol);
  const s = ws.getCell(2, 1);
  s.value = subtitle || '';
  s.font = { name: 'Arial', size: 10, color: { argb: 'FF334155' } };
  s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.metaBg } };
  s.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  ws.getRow(2).height = 22;

  if (metaLine) {
    ws.mergeCells(3, 1, 3, lastCol);
    const m = ws.getCell(3, 1);
    m.value = metaLine;
    m.font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF475569' } };
    m.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.metaBg } };
    m.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
    ws.getRow(3).height = 18;
  }
}

function styleTableHeader(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: COLORS.headerFg }, name: 'Arial', size: 9 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = thinBorder();
  });
  row.height = 26;
}

function styleDataCell(cell, opts = {}) {
  cell.font = { name: 'Arial', size: 9, ...(opts.font || {}) };
  cell.alignment = {
    vertical: 'middle',
    horizontal: opts.align || 'left',
    wrapText: !!opts.wrap
  };
  cell.border = thinBorder();
  if (opts.fill) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };
  }
}

function permitStatus(expiryDate, today = new Date()) {
  if (!expiryDate) {
    return { status: 'active', label: 'бесср.', daysLeft: null };
  }
  const daysLeft = Math.ceil((new Date(expiryDate) - today) / 86400000);
  if (daysLeft < 0) {
    return { status: 'expired', label: 'ПРОСРОЧЕН', daysLeft };
  }
  if (daysLeft <= 14) {
    return { status: 'expiring_14', label: fmtRu(expiryDate), daysLeft };
  }
  if (daysLeft <= 30) {
    return { status: 'expiring_30', label: fmtRu(expiryDate), daysLeft };
  }
  return { status: 'active', label: fmtRu(expiryDate), daysLeft };
}

function statusFill(status) {
  if (status === 'expired') return { fill: COLORS.err, fg: COLORS.errFg, bold: true };
  if (status === 'expiring_14' || status === 'expiring_30') {
    return { fill: COLORS.warn, fg: COLORS.warnFg, bold: true };
  }
  if (status === 'none') return { fill: COLORS.none, fg: COLORS.noneFg, bold: false };
  return { fill: COLORS.ok, fg: COLORS.okFg, bold: false };
}

function isKeyPermit(code, name) {
  return KEY_PERMIT_RE.test(String(code || '') + ' ' + String(name || ''));
}

function periodText(from, to) {
  const a = fmtRu(from);
  const b = fmtRu(to);
  if (a && b) return `${a} — ${b}`;
  if (a) return `с ${a}`;
  if (b) return `до ${b}`;
  return '—';
}

function assignmentText(row) {
  if (row.asg_title) return String(row.asg_title);
  return '—';
}

function planText(row) {
  if (!row.plan_title) return '—';
  const p = periodText(row.planned_from, row.planned_to);
  return p !== '—' ? `${row.plan_title} (${p})` : String(row.plan_title);
}

/**
 * @param {object} opts
 * @param {Array} opts.employees — из loadCartRows
 * @param {Array} opts.permitRows — {employee_id, type_id, code, name, category, expiry_date, sort_order}
 * @param {Array} opts.permitTypes — уникальные типы
 * @param {string} opts.userLabel
 * @param {boolean} opts.includePdn
 */
async function buildBrigadeWorkbook(opts) {
  const {
    employees,
    permitRows = [],
    userLabel = '',
    includePdn = false
  } = opts;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'ASGARD CRM';
  wb.created = new Date();
  wb.title = 'Состав бригады';

  const today = new Date();
  const formed = today.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  const count = employees.length;

  // ── permits index ─────────────────────────────────────────────────────────
  const byEmp = new Map();
  for (const p of permitRows) {
    if (!byEmp.has(p.employee_id)) byEmp.set(p.employee_id, []);
    byEmp.get(p.employee_id).push(p);
  }

  const keyTypeMap = new Map();
  for (const p of permitRows) {
    if (!isKeyPermit(p.code, p.name)) continue;
    if (!keyTypeMap.has(p.type_id)) {
      keyTypeMap.set(p.type_id, {
        id: p.type_id,
        code: p.code,
        name: p.name,
        sort_order: p.sort_order
      });
    }
  }
  const keyTypes = [...keyTypeMap.values()].sort((a, b) =>
    (a.sort_order ?? 999) - (b.sort_order ?? 999) || String(a.code || a.name).localeCompare(String(b.code || b.name), 'ru')
  );

  const cellMap = new Map();
  for (const p of permitRows) {
    const key = `${p.employee_id}_${p.type_id}`;
    if (cellMap.has(key)) continue;
    cellMap.set(key, permitStatus(p.expiry_date, today));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Sheet: Состав
  // ═══════════════════════════════════════════════════════════════════════════
  const rosterCols = [
    { key: 'n', title: '№', width: 4, align: 'center' },
    { key: 'fio', title: 'ФИО', width: 26, align: 'left' },
    { key: 'spec', title: 'Специальность', width: 16, align: 'left' },
    { key: 'phone', title: 'Телефон', width: 14, align: 'left' },
    { key: 'city', title: 'Город', width: 11, align: 'left' },
    { key: 'status', title: 'Статус', width: 11, align: 'center' },
    { key: 'site', title: 'Объект сейчас', width: 22, align: 'left' },
    { key: 'period', title: 'Период на объекте', width: 16, align: 'center' },
    { key: 'plan', title: 'План', width: 22, align: 'left' },
    { key: 'rating', title: '★', width: 5, align: 'center' },
    { key: 'sizes', title: 'Одежда / обувь / рост', width: 16, align: 'center' }
  ];

  const ws = wb.addWorksheet('Состав', {
    views: [{ state: 'frozen', ySplit: 4, showGridLines: false }]
  });
  applyPrintA4(ws, 'landscape');
  paintTitleBlock(ws, {
    title: 'СОСТАВ БРИГАДЫ',
    subtitle: `Сформировано: ${formed}   ·   Человек: ${count}   ·   ${userLabel ? `Кто: ${userLabel}` : 'ASGARD CRM'}`,
    metaLine: 'Документ для печати на A4 (альбомная). Допуски — на листах «Допуски» и «Реестр допусков».',
    colCount: rosterCols.length
  });

  const headerRowIdx = 4;
  const hr = ws.getRow(headerRowIdx);
  rosterCols.forEach((c, i) => {
    hr.getCell(i + 1).value = c.title;
    ws.getColumn(i + 1).width = c.width;
  });
  styleTableHeader(hr);

  employees.forEach((r, i) => {
    const sizes = [r.clothing_size, r.shoe_size, r.height]
      .map((x) => (x == null || x === '' ? null : String(x)))
      .filter(Boolean)
      .join(' / ') || '—';
    const vals = [
      i + 1,
      r.fio || '—',
      r.role_tag || r.position || '—',
      r.phone || '—',
      r.city || '—',
      statusRu(r.readiness_status),
      assignmentText(r),
      periodText(r.asg_from || r.mlsp_arrived, r.mlsp_planned || r.asg_dep),
      planText(r),
      r.rating_avg != null ? Number(Number(r.rating_avg).toFixed(1)) : '—',
      sizes
    ];
    const row = ws.getRow(headerRowIdx + 1 + i);
    const zebra = i % 2 === 1 ? COLORS.alt : null;
    vals.forEach((v, ci) => {
      const cell = row.getCell(ci + 1);
      cell.value = v;
      styleDataCell(cell, {
        align: rosterCols[ci].align,
        wrap: true,
        fill: zebra || undefined,
        font: (ci === 9 && r.rating_avg != null && Number(r.rating_avg) < 5)
          ? { bold: true, color: { argb: COLORS.warnFg } }
          : undefined
      });
    });
    row.height = 18;
  });

  // legend footer
  const foot = headerRowIdx + 1 + employees.length + 1;
  ws.mergeCells(foot, 1, foot, rosterCols.length);
  ws.getCell(foot, 1).value = 'Легенда статуса: Готов / Согласован / На объекте / План / Не готов / Без статуса. ★ — средний рейтинг (ниже 5 выделено).';
  ws.getCell(foot, 1).font = { name: 'Arial', size: 8, color: { argb: 'FF64748B' } };

  // ═══════════════════════════════════════════════════════════════════════════
  // Sheet: Допуски (матрица ключевых)
  // ═══════════════════════════════════════════════════════════════════════════
  const mxCols = [
    { title: '№', width: 4 },
    { title: 'ФИО', width: 24 },
    ...keyTypes.map((t) => ({
      title: t.code || String(t.name || '').slice(0, 14),
      width: 11,
      type: t
    })),
    { title: 'Прочие допуски', width: 36 }
  ];

  const mx = wb.addWorksheet('Допуски', {
    views: [{ state: 'frozen', ySplit: 5, xSplit: 2, showGridLines: false }]
  });
  applyPrintA4(mx, 'landscape');
  paintTitleBlock(mx, {
    title: 'ДОПУСКИ БРИГАДЫ',
    subtitle: `Ключевые допуски по людям · ${formed} · ${count} чел.`,
    metaLine: keyTypes.length
      ? 'В колонках — ключевые типы. «Прочие» — остальные действующие/просроченные допуски сотрудника.'
      : 'Ключевых типов в корзине нет — см. лист «Реестр допусков» (полный перечень).',
    colCount: Math.max(mxCols.length, 3)
  });

  // color legend row
  const legRow = 4;
  mx.mergeCells(legRow, 1, legRow, Math.max(mxCols.length, 3));
  mx.getCell(legRow, 1).value = 'Цвета: зелёный — действует · жёлтый — истекает ≤30 дн. · красный — просрочен · серый — нет';
  mx.getCell(legRow, 1).font = { name: 'Arial', size: 8, color: { argb: 'FF475569' } };
  mx.getCell(legRow, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.metaBg } };

  const mxHeaderIdx = 5;
  const mxHr = mx.getRow(mxHeaderIdx);
  mxCols.forEach((c, i) => {
    mxHr.getCell(i + 1).value = c.title;
    mx.getColumn(i + 1).width = c.width;
  });
  styleTableHeader(mxHr);
  // rotate key headers slightly for density
  for (let i = 2; i < mxCols.length - 1; i++) {
    mxHr.getCell(i + 1).alignment = {
      textRotation: 45,
      vertical: 'bottom',
      horizontal: 'center',
      wrapText: true
    };
  }
  mxHr.height = keyTypes.length ? 42 : 26;

  employees.forEach((emp, i) => {
    const row = mx.getRow(mxHeaderIdx + 1 + i);
    const list = byEmp.get(emp.id) || [];
    const keyIds = new Set(keyTypes.map((t) => t.id));

    const others = list
      .filter((p) => !keyIds.has(p.type_id))
      .map((p) => {
        const st = permitStatus(p.expiry_date, today);
        const name = p.code || p.name || 'допуск';
        if (st.status === 'expired') return `${name}: ПРОСРОЧЕН`;
        return `${name}: ${st.label}`;
      });

    const vals = [i + 1, emp.fio || '—'];
    const statuses = ['meta', 'meta'];
    for (const t of keyTypes) {
      const cell = cellMap.get(`${emp.id}_${t.id}`);
      if (!cell) {
        vals.push('—');
        statuses.push('none');
      } else {
        vals.push(cell.label);
        statuses.push(cell.status);
      }
    }
    vals.push(others.length ? others.join('; ') : '—');
    statuses.push('meta');

    vals.forEach((v, ci) => {
      const cell = row.getCell(ci + 1);
      cell.value = v;
      const st = statuses[ci];
      if (st === 'meta') {
        styleDataCell(cell, {
          align: ci === 0 ? 'center' : 'left',
          wrap: true,
          fill: i % 2 === 1 ? COLORS.alt : undefined
        });
      } else {
        const paint = statusFill(st);
        styleDataCell(cell, {
          align: 'center',
          fill: paint.fill,
          font: { bold: paint.bold, color: { argb: paint.fg } }
        });
      }
    });
    row.height = 20;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Sheet: Реестр допусков (длинный список — удобно читать и печатать)
  // ═══════════════════════════════════════════════════════════════════════════
  const regCols = [
    { title: '№', width: 4 },
    { title: 'ФИО', width: 26 },
    { title: 'Допуск', width: 28 },
    { title: 'Код', width: 12 },
    { title: 'Категория', width: 14 },
    { title: 'Действует до', width: 13 },
    { title: 'Статус', width: 14 },
    { title: 'Осталось, дн.', width: 12 }
  ];
  const reg = wb.addWorksheet('Реестр допусков', {
    views: [{ state: 'frozen', ySplit: 4, showGridLines: false }]
  });
  applyPrintA4(reg, 'portrait');
  paintTitleBlock(reg, {
    title: 'РЕЕСТР ДОПУСКОВ',
    subtitle: `Полный перечень по бригаде · ${formed} · ${count} чел.`,
    metaLine: 'Один допуск — одна строка. Удобно сверять и печатать на A4 (книжная).',
    colCount: regCols.length
  });

  const regHr = reg.getRow(4);
  regCols.forEach((c, i) => {
    regHr.getCell(i + 1).value = c.title;
    reg.getColumn(i + 1).width = c.width;
  });
  styleTableHeader(regHr);

  let regIdx = 0;
  employees.forEach((emp) => {
    const list = (byEmp.get(emp.id) || []).slice().sort((a, b) =>
      String(a.name || a.code).localeCompare(String(b.name || b.code), 'ru')
    );
    if (!list.length) {
      regIdx += 1;
      const row = reg.getRow(4 + regIdx);
      const vals = [regIdx, emp.fio || '—', '— нет активных допусков —', '', '', '', 'нет данных', ''];
      vals.forEach((v, ci) => {
        styleDataCell(row.getCell(ci + 1), {
          align: ci === 0 || ci >= 5 ? 'center' : 'left',
          fill: COLORS.none,
          font: ci === 2 ? { italic: true, color: { argb: COLORS.noneFg } } : undefined
        });
        row.getCell(ci + 1).value = v;
      });
      return;
    }
    list.forEach((p) => {
      regIdx += 1;
      const st = permitStatus(p.expiry_date, today);
      const paint = statusFill(st.status);
      let statusLabel = 'Действует';
      if (st.status === 'expired') statusLabel = 'Просрочен';
      else if (st.status === 'expiring_14') statusLabel = '≤14 дней';
      else if (st.status === 'expiring_30') statusLabel = '≤30 дней';
      else if (!p.expiry_date) statusLabel = 'Бессрочно';

      const vals = [
        regIdx,
        emp.fio || '—',
        p.name || p.code || '—',
        p.code || '',
        p.category || '',
        p.expiry_date ? fmtRu(p.expiry_date) : 'бесср.',
        statusLabel,
        st.daysLeft == null ? '—' : st.daysLeft
      ];
      const row = reg.getRow(4 + regIdx);
      vals.forEach((v, ci) => {
        const cell = row.getCell(ci + 1);
        cell.value = v;
        const isStatusCol = ci >= 5;
        styleDataCell(cell, {
          align: ci === 0 || isStatusCol ? 'center' : 'left',
          wrap: true,
          fill: isStatusCol ? paint.fill : (regIdx % 2 === 0 ? COLORS.alt : undefined),
          font: isStatusCol ? { bold: paint.bold, color: { argb: paint.fg } } : undefined
        });
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Sheet: ПДн (опционально)
  // ═══════════════════════════════════════════════════════════════════════════
  if (includePdn) {
    const pdnCols = [
      { title: '№', width: 4 },
      { title: 'ФИО', width: 26 },
      { title: 'Дата рождения', width: 13 },
      { title: 'Паспорт', width: 16 },
      { title: 'ИНН', width: 14 },
      { title: 'СНИЛС', width: 14 },
      { title: 'Адрес', width: 36 }
    ];
    const pdn = wb.addWorksheet('ПДн', {
      views: [{ state: 'frozen', ySplit: 4, showGridLines: false }]
    });
    applyPrintA4(pdn, 'landscape');
    paintTitleBlock(pdn, {
      title: 'ПЕРСОНАЛЬНЫЕ ДАННЫЕ',
      subtitle: `Конфиденциально · ${formed} · ${count} чел.`,
      metaLine: 'Лист включён по запросу. Не передавать третьим лицам без основания.',
      colCount: pdnCols.length
    });
    const ph = pdn.getRow(4);
    pdnCols.forEach((c, i) => {
      ph.getCell(i + 1).value = c.title;
      pdn.getColumn(i + 1).width = c.width;
    });
    styleTableHeader(ph);
    employees.forEach((r, i) => {
      const ser = r.passport_series || r.pass_series || '';
      const num = r.passport_number || r.pass_number || '';
      const vals = [
        i + 1,
        r.fio || '—',
        fmtRu(r.birth_date) || '—',
        [ser, num].filter(Boolean).join(' ') || '—',
        r.inn || '—',
        r.snils || '—',
        r.address || r.registration_address || '—'
      ];
      const row = pdn.getRow(5 + i);
      vals.forEach((v, ci) => {
        styleDataCell(row.getCell(ci + 1), {
          align: ci === 0 ? 'center' : 'left',
          wrap: true,
          fill: i % 2 === 1 ? COLORS.alt : undefined
        });
        row.getCell(ci + 1).value = v;
      });
    });
  }

  return wb;
}

module.exports = {
  buildBrigadeWorkbook,
  ymd,
  fmtRu,
  KEY_PERMIT_RE,
  isKeyPermit,
  permitStatus
};
