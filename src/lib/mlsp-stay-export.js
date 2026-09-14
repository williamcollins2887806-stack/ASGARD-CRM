'use strict';

/**
 * Excel-график перевахтовки МЛСП за период (один лист: карточка + календарь).
 */

const ExcelJS = require('exceljs');
const { ymd, todayYmdMsk, daysBetween } = require('./mlsp-stay');

const FILL = {
  titleBg: 'FF0B3D5C',
  headerFixed: 'FF1565A8',
  headerDays: 'FF1A7A4C',
  headerCounter: 'FFC45C16',
  shift: 'FF5BA3D9',
  heli: 'FF9B6BD6',
  ship: 'FF2EB8C9',
  road: 'FFB07AD9',
  other: 'FF8A9BAA',
  plan: 'FFF59E0B',
  planSoft: 'FFFFF3CD',
  zebra: 'FFF7FAFC',
  white: 'FFFFFFFF'
};

const BORDER = {
  style: 'thin',
  color: { argb: 'FF334155' }
};
const THIN_BORDER = {
  top: BORDER,
  left: BORDER,
  bottom: BORDER,
  right: BORDER
};

const STAGE_META = {
  helicopter: { label: 'Вертолёт', fill: FILL.heli },
  ship: { label: 'Корабль', fill: FILL.ship },
  travel: { label: 'Дорога', fill: FILL.road },
  remote: { label: 'Удалёнка', fill: FILL.other },
  warehouse: { label: 'Склад', fill: FILL.other },
  medical: { label: 'МО', fill: FILL.other },
  waiting: { label: 'Ожидание', fill: FILL.other },
  training: { label: 'Учёба', fill: FILL.other },
  office: { label: 'Офис', fill: FILL.other }
};

const STAGE_PRIORITY = [
  'helicopter', 'ship', 'travel', 'remote', 'warehouse', 'medical', 'waiting', 'training', 'office'
];

/** Аббревиатуры role_tag → полная подпись как для ГНШ / дружины */
const SPEC_LABELS = {
  'рп': 'Руководитель проекта',
  'пто': 'Инженер ПТО',
  'мастер': 'Мастер',
  'слесарь': 'Слесарь',
  'сварщик': 'Сварщик',
  'альпинист': 'Альпинист'
};

function fmtRu(d) {
  const s = ymd(d);
  if (!s || s.length < 10) return '';
  return `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
}

function fmtRuShort(d) {
  const s = ymd(d);
  if (!s || s.length < 10) return '';
  return `${s.slice(8, 10)}.${s.slice(5, 7)}`;
}

function trLabel(v) {
  if (v === 'helicopter') return 'Вертолёт';
  if (v === 'ship') return 'Корабль';
  return v || '—';
}

function solid(argb) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function eachDayYmd(fromYmd, toYmd) {
  const out = [];
  const start = new Date(fromYmd + 'T12:00:00Z');
  const end = new Date(toYmd + 'T12:00:00Z');
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

function shortTitle(title) {
  const t = String(title || '').trim();
  if (!t) return '—';
  if (t.length <= 56) return t;
  return t.slice(0, 53) + '…';
}

function displaySpecialty(roleTag, position) {
  const tag = String(roleTag || '').trim();
  const pos = String(position || '').trim();
  const key = tag.toLowerCase();
  if (SPEC_LABELS[key]) return SPEC_LABELS[key];
  // Если в position полное название длиннее аббревиатуры — берём его
  if (pos && pos.length >= 8 && (/руководитель|инженер|монтажник|специалист/i.test(pos) || pos.length > tag.length + 3)) {
    return pos;
  }
  if (tag) return tag.charAt(0).toUpperCase() + tag.slice(1);
  if (pos) return pos;
  return '—';
}

async function loadStaysForPeriod(db, fromYmd, toYmd) {
  const { rows } = await db.query(`
    SELECT s.*,
           COALESCE(e.fio, e.full_name) AS fio,
           e.role_tag, e.position
    FROM mlsp_stays s
    JOIN employees e ON e.id = s.employee_id
    WHERE s.arrived_at <= $2::date
      AND COALESCE(s.actual_departed_at, CURRENT_DATE) >= $1::date
    ORDER BY e.fio, s.arrived_at
  `, [fromYmd, toYmd]);
  return rows;
}

async function loadAssignments(db, empIds) {
  const map = {};
  if (!empIds.length) return map;
  const { rows } = await db.query(`
    SELECT ea.employee_id, ea.work_id, w.work_title,
           ea.date_from::text AS date_from,
           ea.departure_date::text AS departure_date
    FROM employee_assignments ea
    JOIN works w ON w.id = ea.work_id AND w.deleted_at IS NULL
    JOIN field_project_settings fps ON fps.work_id = ea.work_id AND fps.site_category = 'mlsp'
    WHERE ea.employee_id = ANY($1::int[])
    ORDER BY ea.id DESC
  `, [empIds]);
  for (const r of rows) {
    if (!map[r.employee_id]) map[r.employee_id] = [];
    map[r.employee_id].push(r);
  }
  return map;
}

function assignmentOnDate(list, dayYmd) {
  if (!list || !list.length || !dayYmd) return null;
  const covering = list.filter((a) => {
    const from = ymd(a.date_from);
    const dep = ymd(a.departure_date);
    if (from && from > dayYmd) return false;
    if (dep && dep < dayYmd) return false;
    return true;
  });
  if (covering.length) return covering[0];
  return list[0] || null;
}

async function loadCheckins(db, empIds, fromYmd, toYmd) {
  const byEmp = {};
  if (!empIds.length) return byEmp;
  const { rows } = await db.query(`
    SELECT fc.employee_id, fc.date::text AS d, fc.shift, fc.work_id
    FROM field_checkins fc
    JOIN field_project_settings fps ON fps.work_id = fc.work_id AND fps.site_category = 'mlsp'
    WHERE fc.employee_id = ANY($1::int[])
      AND fc.date BETWEEN $2::date AND $3::date
      AND fc.status = 'completed'
      AND fc.shift IN ('day', 'night', 'half')
  `, [empIds, fromYmd, toYmd]);
  for (const r of rows) {
    const d = ymd(r.d);
    if (!d) continue;
    if (!byEmp[r.employee_id]) byEmp[r.employee_id] = {};
    byEmp[r.employee_id][d] = { kind: 'shift', label: '11', fill: FILL.shift };
  }
  return byEmp;
}

async function loadStages(db, empIds, fromYmd, toYmd) {
  const byEmp = {};
  if (!empIds.length) return byEmp;
  const { rows } = await db.query(`
    SELECT employee_id, stage_type, direction,
           date_from::text AS d_from, date_to::text AS d_to
    FROM field_trip_stages
    WHERE employee_id = ANY($1::int[])
      AND date_from <= $3::date
      AND COALESCE(date_to, date_from) >= $2::date
      AND COALESCE(status, '') NOT IN ('cancelled', 'rejected')
      AND stage_type = ANY($4::text[])
  `, [empIds, fromYmd, toYmd, Object.keys(STAGE_META)]);

  for (const r of rows) {
    const meta = STAGE_META[r.stage_type];
    if (!meta) continue;
    const d0 = ymd(r.d_from);
    const d1 = ymd(r.d_to) || d0;
    if (!d0) continue;
    const days = eachDayYmd(
      d0 < fromYmd ? fromYmd : d0,
      d1 > toYmd ? toYmd : d1
    );
    if (!byEmp[r.employee_id]) byEmp[r.employee_id] = {};
    const prio = STAGE_PRIORITY.indexOf(r.stage_type);
    for (const d of days) {
      const prev = byEmp[r.employee_id][d];
      if (prev && prev.kind === 'stage') {
        const prevPrio = STAGE_PRIORITY.indexOf(prev.stage_type);
        if (prevPrio >= 0 && prevPrio <= prio) continue;
      }
      byEmp[r.employee_id][d] = {
        kind: 'stage',
        stage_type: r.stage_type,
        direction: r.direction || '',
        label: meta.label,
        fill: meta.fill
      };
    }
  }
  return byEmp;
}

function mergeDayMaps(stagesByEmp, checkinsByEmp, empId) {
  const out = { ...(checkinsByEmp[empId] || {}) };
  const stages = stagesByEmp[empId] || {};
  for (const [d, cell] of Object.entries(stages)) {
    out[d] = cell;
  }
  return out;
}

function inboundTransport(stay, dayMap) {
  if (stay.inbound_transport) return trLabel(stay.inbound_transport);
  const arrived = ymd(stay.arrived_at);
  if (!arrived) return '—';
  const near = [];
  const base = new Date(arrived + 'T12:00:00Z').getTime();
  for (const delta of [-1, 0, 1]) {
    const d = new Date(base + delta * 86400000).toISOString().slice(0, 10);
    const cell = dayMap[d];
    if (cell && (cell.stage_type === 'helicopter' || cell.stage_type === 'ship')) {
      if (cell.direction === 'to_site' || !cell.direction) near.push(cell);
    }
  }
  if (near.length) return near[0].label;
  return '—';
}

function counterAsOf(stay, asOfYmd) {
  const arrived = ymd(stay.arrived_at);
  const departed = ymd(stay.actual_departed_at);
  if (!arrived) return '—';
  if (asOfYmd < arrived) {
    return `планируемый заезд ${fmtRu(arrived)}`;
  }
  if (departed && asOfYmd > departed) {
    return `уехал ${fmtRu(departed)}`;
  }
  return daysBetween(arrived, asOfYmd) + 1;
}

function isOnPlatformAsOf(stay, asOfYmd) {
  const arrived = ymd(stay.arrived_at);
  const departed = ymd(stay.actual_departed_at);
  if (!arrived || asOfYmd < arrived) return false;
  if (departed && asOfYmd > departed) return false;
  return true;
}

function applyBorder(cell) {
  cell.border = THIN_BORDER;
}

function paintTitleBlock(ws, lastCol, fromYmd, toYmd, asOf, formedYmd) {
  ws.mergeCells(1, 1, 1, lastCol);
  const c1 = ws.getCell(1, 1);
  c1.value = 'ООО «АСГАРД СЕРВИС»';
  c1.font = { bold: true, name: 'Arial', size: 16, color: { argb: 'FFFFFFFF' } };
  c1.fill = solid(FILL.titleBg);
  c1.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(1).height = 26;

  ws.mergeCells(2, 1, 2, lastCol);
  const c2 = ws.getCell(2, 1);
  c2.value = 'График перевахтовки';
  c2.font = { bold: true, name: 'Arial', size: 13, color: { argb: 'FFFFFFFF' } };
  c2.fill = solid(FILL.titleBg);
  c2.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(2).height = 22;

  ws.mergeCells(3, 1, 3, lastCol);
  const c3 = ws.getCell(3, 1);
  c3.value = `Сформировано на ${fmtRu(asOf)} · Период ${fmtRu(fromYmd)} – ${fmtRu(toYmd)} · выгрузка ${fmtRu(formedYmd)}`;
  c3.font = { name: 'Arial', size: 10, color: { argb: 'FFE2E8F0' } };
  c3.fill = solid(FILL.titleBg);
  c3.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(3).height = 18;
}

/**
 * Write calendar cells for one person row; merge consecutive stage spans (not shifts).
 */
function writeCalendarRow(ws, excelRowNum, dayStartCol, days, dayMap) {
  let i = 0;
  while (i < days.length) {
    const d = days[i];
    const info = dayMap[d];
    const col = dayStartCol + i;
    const cell = ws.getRow(excelRowNum).getCell(col);
    cell.font = { name: 'Arial', size: 8, bold: true, color: { argb: 'FF0F172A' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    applyBorder(cell);

    if (!info) {
      i += 1;
      continue;
    }

    if (info.kind === 'shift') {
      cell.value = 11;
      cell.fill = solid(info.fill || FILL.shift);
      i += 1;
      continue;
    }

    // Merge consecutive same stage_type
    let j = i;
    while (
      j + 1 < days.length
      && dayMap[days[j + 1]]
      && dayMap[days[j + 1]].kind === 'stage'
      && dayMap[days[j + 1]].stage_type === info.stage_type
    ) {
      j += 1;
    }

    const colEnd = dayStartCol + j;
    if (j > i) {
      ws.mergeCells(excelRowNum, col, excelRowNum, colEnd);
      for (let c = col; c <= colEnd; c++) {
        const mc = ws.getRow(excelRowNum).getCell(c);
        applyBorder(mc);
        mc.fill = solid(info.fill);
      }
    } else {
      cell.fill = solid(info.fill);
    }
    cell.value = info.label;
    cell.fill = solid(info.fill);
    i = j + 1;
  }
}

async function loadPlannedMlsp(db, fromYmd, toYmd, excludeEmpIds) {
  const exclude = (excludeEmpIds && excludeEmpIds.length) ? excludeEmpIds : [0];
  const { rows } = await db.query(`
    SELECT pe.employee_id, pe.work_id,
           pe.planned_from::text AS planned_from,
           pe.planned_to::text AS planned_to,
           pe.note, pe.inbound_transport,
           COALESCE(e.fio, e.full_name) AS fio,
           e.role_tag, e.position,
           w.work_title
    FROM employee_planned_engagements pe
    JOIN employees e ON e.id = pe.employee_id
    JOIN works w ON w.id = pe.work_id AND w.deleted_at IS NULL
    JOIN field_project_settings fps ON fps.work_id = pe.work_id AND fps.site_category = 'mlsp'
    WHERE pe.status = 'active'
      AND COALESCE(e.is_active, true) = true
      AND (pe.planned_from IS NULL OR pe.planned_from <= $2::date)
      AND (pe.planned_to IS NULL OR pe.planned_to >= $1::date)
      AND pe.employee_id <> ALL($3::int[])
    ORDER BY e.fio, pe.planned_from NULLS LAST
  `, [fromYmd, toYmd, exclude]);
  return rows;
}

async function buildMlspPeriodExcel(db, fromYmd, toYmd, asOfYmd) {
  const asOf = ymd(asOfYmd) || toYmd;
  const formed = todayYmdMsk();
  const days = eachDayYmd(fromYmd, toYmd);
  const stays = await loadStaysForPeriod(db, fromYmd, toYmd);
  const empIds = [...new Set(stays.map((s) => s.employee_id))];

  const [assignments, checkinsByEmp, stagesByEmp, plannedRows] = await Promise.all([
    loadAssignments(db, empIds),
    loadCheckins(db, empIds, fromYmd, toYmd),
    loadStages(db, empIds, fromYmd, toYmd),
    loadPlannedMlsp(db, fromYmd, toYmd, empIds)
  ]);

  const enriched = stays.map((s) => {
    const dayMap = mergeDayMaps(stagesByEmp, checkinsByEmp, s.employee_id);
    const asgNow = assignmentOnDate(assignments[s.employee_id], asOf);
    const asgArr = assignmentOnDate(assignments[s.employee_id], ymd(s.arrived_at));
    return {
      kind: 'stay',
      stay: s,
      onPlatform: isOnPlatformAsOf(s, asOf),
      dayMap,
      specialty: displaySpecialty(s.role_tag, s.position),
      projectNow: shortTitle(asgNow?.work_title),
      projectArr: shortTitle(asgArr?.work_title),
      inbound: inboundTransport(s, dayMap),
      counter: counterAsOf(s, asOf)
    };
  });

  enriched.sort((a, b) => {
    if (a.onPlatform !== b.onPlatform) return a.onPlatform ? -1 : 1;
    const fa = String(a.stay.fio || '');
    const fb = String(b.stay.fio || '');
    if (fa !== fb) return fa.localeCompare(fb, 'ru');
    return String(ymd(a.stay.arrived_at) || '').localeCompare(String(ymd(b.stay.arrived_at) || ''));
  });

  for (const p of plannedRows) {
    const fromP = ymd(p.planned_from);
    const toP = ymd(p.planned_to);
    const dayMap = {};
    if (fromP && fromP >= fromYmd && fromP <= toYmd) {
      dayMap[fromP] = {
        kind: 'stage',
        stage_type: 'plan_arrive',
        label: 'План',
        fill: FILL.plan
      };
    }
    if (fromP && toP) {
      for (const d of eachDayYmd(
        fromP < fromYmd ? fromYmd : fromP,
        toP > toYmd ? toYmd : toP
      )) {
        if (d === fromP) continue;
        if (!dayMap[d]) {
          dayMap[d] = {
            kind: 'stage',
            stage_type: 'plan_span',
            label: '',
            fill: FILL.planSoft
          };
        }
      }
    }
    enriched.push({
      kind: 'planned',
      stay: {
        fio: p.fio,
        arrived_at: p.planned_from,
        role_tag: p.role_tag,
        position: p.position
      },
      onPlatform: false,
      dayMap,
      specialty: displaySpecialty(p.role_tag, p.position),
      projectNow: shortTitle(p.work_title),
      projectArr: shortTitle(p.work_title),
      inbound: trLabel(p.inbound_transport),
      counter: fromP ? `план заезд ${fmtRu(fromP)}` : 'в плане'
    });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'ASGARD CRM';
  const ws = wb.addWorksheet('График перевахтовки', {
    views: [{ state: 'normal', showGridLines: true }]
  });

  const fixedHeaders = [
    '№',
    'ФИО',
    'Специальность',
    'Проект (сейчас)',
    'Проект заезда',
    'Дата заезда',
    'Транспорт заезда',
    `На ${fmtRu(asOf)}`
  ];
  const fixedCount = fixedHeaders.length;
  const dayStartCol = fixedCount + 1;
  const lastCol = fixedCount + days.length;

  paintTitleBlock(ws, lastCol, fromYmd, toYmd, asOf, formed);

  const headerRowNum = 4;
  const headerRow = ws.getRow(headerRowNum);
  fixedHeaders.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 9 };
    cell.fill = solid(i === 7 ? FILL.headerCounter : FILL.headerFixed);
    cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    applyBorder(cell);
  });
  days.forEach((d, i) => {
    const cell = headerRow.getCell(dayStartCol + i);
    cell.value = fmtRuShort(d);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 8 };
    cell.fill = solid(FILL.headerDays);
    cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center', textRotation: 90 };
    applyBorder(cell);
  });
  headerRow.height = 42;

  const colWidths = [5, 28, 22, 30, 30, 12, 14, 18];
  colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  days.forEach((_, i) => {
    ws.getColumn(dayStartCol + i).width = 3.8;
  });

  enriched.forEach((row, idx) => {
    const excelRowNum = headerRowNum + 1 + idx;
    const s = row.stay;
    const excelRow = ws.getRow(excelRowNum);
    excelRow.height = 18;
    const isPlan = row.kind === 'planned';
    const values = [
      idx + 1,
      isPlan ? `📋 ${s.fio || ''}` : (s.fio || ''),
      row.specialty,
      row.projectNow,
      row.projectArr,
      fmtRu(s.arrived_at),
      row.inbound,
      row.counter
    ];
    values.forEach((v, i) => {
      const cell = excelRow.getCell(i + 1);
      cell.value = v;
      cell.font = {
        name: 'Arial',
        size: 9,
        italic: isPlan,
        color: { argb: isPlan ? 'FF92400E' : 'FF0F172A' }
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: i === 0 || i >= 5 ? 'center' : 'left',
        wrapText: true
      };
      applyBorder(cell);
      if (isPlan) {
        cell.fill = solid(FILL.planSoft);
      } else if (idx % 2 === 1 && i < fixedCount) {
        cell.fill = solid(FILL.zebra);
      }
    });

    writeCalendarRow(ws, excelRowNum, dayStartCol, days, row.dayMap);
  });

  // Legend: full-width merged rows so text fits
  let legendRow = headerRowNum + enriched.length + 3;
  ws.mergeCells(legendRow, 1, legendRow, Math.min(8, lastCol));
  const lt = ws.getCell(legendRow, 1);
  lt.value = 'Легенда';
  lt.font = { bold: true, name: 'Arial', size: 11 };
  lt.alignment = { vertical: 'middle', horizontal: 'left' };
  legendRow += 1;

  const legendItems = [
    { label: '11 — смена на МЛСП (11 часов), ячейки не объединяются', fill: FILL.shift },
    { label: 'Вертолёт — заезд/перелёт (соседние дни объединяются)', fill: FILL.heli },
    { label: 'Корабль — судно (соседние дни объединяются)', fill: FILL.ship },
    { label: 'Дорога — travel (соседние дни объединяются)', fill: FILL.road },
    { label: 'Учёба / Удалёнка / Склад / МО / Ожидание — этапы (соседние дни объединяются)', fill: FILL.other },
    { label: 'План — планируемое привлечение на МЛСП (ещё не на платформе); ячейка «План» = день заезда', fill: FILL.plan },
    { label: `Счётчик «На ${fmtRu(asOf)}»: число дней на платформе · «уехал ДД.ММ.ГГГГ» · «планируемый заезд …» · «план заезд …» · «—»`, fill: null }
  ];

  for (const item of legendItems) {
    const endMerge = Math.min(8, lastCol);
    ws.mergeCells(legendRow, 1, legendRow, endMerge);
    const cell = ws.getCell(legendRow, 1);
    cell.value = item.label;
    cell.font = { name: 'Arial', size: 9, color: { argb: 'FF0F172A' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    applyBorder(cell);
    if (item.fill) cell.fill = solid(item.fill);
    ws.getRow(legendRow).height = 20;
    legendRow += 1;
  }

  const buf = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(buf), count: enriched.length };
}

module.exports = {
  buildMlspPeriodExcel,
  fmtRu,
  counterAsOf,
  eachDayYmd,
  displaySpecialty
};
