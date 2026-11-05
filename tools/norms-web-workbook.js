#!/usr/bin/env node
'use strict';
/**
 * norms-web-workbook.js — собирает Excel-канон норм из проверенных источников.
 *
 * Листы:
 *   Queries   — 250–350 запросов (R1) с объёмами
 *   Answers   — заполненные строки (verified + findings) с чел·днями, бригадой,
 *               технологией/оснасткой, URL и цитатой
 *   Rejected  — что не конвертируется и почему (уходит агентам на R4)
 *   ImportMap — что и куда пишется в work_norm_rates
 *   Coverage  — сводка: сколько считает previewCalc
 *
 * Запуск: node tools/norms-web-workbook.js [--db=asgard_crm_test]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { Client } = require('pg');
const conv = require('./norms-web-metrics');

const REPORTS = path.join(__dirname, '..', 'tests/reports/norms-web');
const OUT = path.join(REPORTS, 'NORMS-WORKBOOK.xlsx');
const DB = (process.argv.find((a) => a.startsWith('--db=')) || '').split('=')[1] || 'asgard_crm_test';

/** Технология и оснастка по категории — не «чем мыть», а чем работать. */
const TECH_BY_CATEGORY = {
  plates: {
    chem_cip: 'CIP-станция, кислотный/щелочной реагент с ингибитором, 2–4 цикла, контроль pH и температуры',
    hydro_dis: 'Разборка пакета, АВД 200–300 бар, ванна с реагентом, замена уплотнений при износе'
  },
  tubes: {
    gdo: 'АВД 300–400 бар с гибким шлангом и насадкой, подача воды, ёмкость для стоков',
    gmo: 'Пневмо- или гидроимпульс, ерш, развальцовка при перетрубке',
    chem: 'CIP-контур по трубному пучку, реагент с ингибитором, нейтрализация'
  },
  avo: {
    outer: 'АВД или пароводяная смесь, насадки для оребрения, компрессор для обдува',
    tubes: 'Механическая прочистка трубок ёршом, АВД внутрь секции'
  },
  boilers: {
    chem: 'Кислота с ингибитором, CIP-насос, контроль концентрации, 2–3 цикла, нейтрализация',
    hydro: 'АВД 300 бар, дренаж, ёмкость для стоков',
    mech: 'Скребок, щётки, пылесос промышленный, доступ через люки',
    complex: 'Комбинация: химия по контуру + механика по поверхностям, сушка и опрессовка'
  },
  pipelines: {
    chem_ops: 'Циркуляционная установка, реагент, манометры, дренаж, нейтрализация',
    pickle: 'Насос дозирования, кислота, ингибитор, контроль концентрации, пассивация',
    aspo: 'Растворитель АСПО, циркуляция, нагрев, ёмкости, утилизация',
    hydro: 'АВД высокого давления, насадки, шланги, дренаж',
    hydrotest: 'Опрессовочный насос, манометры, заглушки, вода, журнал испытаний'
  },
  vessels: {
    clean: 'Механическая зачистка, АВД, промышленный пылесос, вентиляция, допуск на работы в ёмкости'
  },
  chem_circuits: {
    cip: 'CIP-станция, реагент, циркуляция, контроль pH/температуры, нейтрализация и сброс'
  },
  towers_hvac: {
    tower: 'АВД, биоцид, механическая чистка оросителя, ёмкость для стоков',
    heating: 'CIP-станция по системе, реагент, дренаж и заполнение, опрессовка после',
    itp: 'CIP по контуру ИТП, реагент, промывка теплообменника, настройка регуляторов',
    pneumo: 'Пневмоимпульсная установка, компрессор, контроль давления'
  },
  vent_sewer: {
    vent: 'Механическая щётка, промышленный пылесос, дезинфектант, доступ через люки',
    disinfect: 'Распылитель, дезинфектант, СИЗ, экспозиция',
    sewer: 'Илосос, АВД, дренажный насос, СИЗ'
  },
  repair_weld: {
    compabloc: 'Набор ключей, прокладки, опрессовка, слесарный инструмент',
    plates_pack: 'Разборка пакета, замена пластин и уплотнений, пресс, опрессовка',
    weld: 'Сварочный инвертор 250–350 А, электроды/проволока, режим по НАКС, зачистка, контроль шва',
    cutting: 'Газорез/плазма, баллоны, СИЗ, ограждение зоны',
    fire_works: 'Газосварочный пост, огнетушитель, наблюдающий, наряд-допуск'
  },
  insulation: {
    insul: 'Маты/цилиндры минваты, стеклоткань, ПВХ-покрытие, каркас из проволоки/сетки, нож, крепёж'
  },
  mount: {
    mount: 'Кран/таль по массе, стропы, домкраты, такелажная оснастка, монтажные шпильки',
    dismount: 'Резка/демонтаж, кран, стропы, тара для узлов',
    rigging: 'Стропы, траверсы, кран, сигнальщик, схема строповки',
    flange: 'Ключи, динамометрический ключ, прокладки, обезжиривание, центровка'
  }
};

function techFor(category, method, extraNote) {
  const byCat = TECH_BY_CATEGORY[category] || {};
  const base = byCat[method] || Object.values(byCat)[0] || '';
  return [base, extraNote].filter(Boolean).join('. ');
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split(/\r?\n/)
    .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } })
    .filter(Boolean);
}

/** Чел·дни из конверсии: значение нормы → сколько суток займёт объём из запроса. */
function personDaysFor(c, inputs, crew, shiftsPerDay, shiftHours) {
  const exec = Number(crew && crew.exec) || 3;
  const master = Number(crew && crew.master) || 1;
  const people = exec + master;
  const v = Number(c.value);
  if (!(v > 0)) return null;
  const perDayHours = shiftHours * shiftsPerDay * 0.82;

  switch (c.calc_kind) {
    case 'hours_per_cycle': {
      const cycles = Number(inputs.cycles) || 1;
      return Math.round(((v * cycles) / (shiftHours * shiftsPerDay)) * 100) / 100;
    }
    case 'min_per_unit': {
      const units = Number(inputs.tubes) || 100;
      return Math.round(((v * units) / (perDayHours * 60 * exec)) * 100) / 100;
    }
    case 'per_unit_shift': {
      const volumeKey = ['tubes', 'joints', 'plates_count', 'surface_m2', 'length_m',
        'circuit_m3', 'volume_m3', 'qty', 'lifts', 'points'].find((k) => Number(inputs[k]) > 0);
      const volume = volumeKey ? Number(inputs[volumeKey]) : 1;
      return Math.round((volume / v) * 100) / 100;
    }
    case 'days_per_unit': {
      const units = Number(inputs.objects || inputs.qty || inputs.boilers || inputs.apparatus || 1);
      return Math.round(v * units * 100) / 100;
    }
    case 'mh_per_unit': {
      const unitKey = ['tubes', 'volume_m3', 'surface_m2', 'length_m', 'apparatus']
        .find((k) => Number(inputs[k]) > 0);
      const units = unitKey ? Number(inputs[unitKey]) : 1;
      const scaled = c.code === 'tubes_chem_100' ? units / 100 : units;
      return Math.round(((v * scaled) / (shiftHours * shiftsPerDay * people)) * 100) / 100;
    }
    case 'fixed_days':
      return Math.round(v * 100) / 100;
    default:
      return null;
  }
}

(async () => {
  const queries = readJsonl(path.join(REPORTS, 'queries-320plus.jsonl'));
  const verified = readJsonl(path.join(REPORTS, 'verified.jsonl'));
  const findings = readJsonl(path.join(REPORTS, 'findings.jsonl'));

  const db = new Client({
    host: 'localhost', port: 5432,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: DB
  });
  await db.connect();
  const rates = (await db.query(
    `SELECT code, category_code, method_code, unit, calc_kind, crew_json, rate_default
       FROM work_norm_rates WHERE is_active`
  )).rows;
  const rateByCode = new Map(rates.map((r) => [r.code, r]));
  const globals = (await db.query(`SELECT key, value_num, value_text FROM work_norm_globals`)).rows;
  const gMap = {};
  for (const g of globals) {
    gMap[g.key] = g.value_num != null ? Number(g.value_num) : g.value_text;
  }
  const shiftHours = Number(gMap.shift_hours) || 12;
  const shiftsPerDay = Number(gMap.shifts_per_day) || 2;

  const queryById = new Map(queries.map((q) => [q.id, q]));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'ASGARD CRM · norms pipeline';
  wb.created = new Date();

  const header = (ws, cols) => {
    ws.addRow(cols);
    const row = ws.getRow(1);
    row.font = { bold: true, color: { argb: 'FF1A1A1A' } };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4A843' } };
    row.alignment = { vertical: 'middle', wrapText: true };
    row.height = 32;
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    cols.forEach((c, i) => { ws.getColumn(i + 1).width = Math.max(12, Math.min(48, String(c).length + 6)); });
  };

  // ── Лист Queries ──────────────────────────────────────────────────────────
  const qs = wb.addWorksheet('Queries');
  header(qs, ['query_id', 'service_id', 'service_name', 'category_code', 'method_code',
    'object_ru', 'volume_value', 'volume_unit', 'diameter_mm', 'fouling', 'circuit_m3', 'question_ru', 'status']);
  for (const q of queries) {
    const inp = q.inputs || {};
    const volKey = ['surface_m2', 'tubes', 'length_m', 'circuit_m3', 'volume_m3', 'qty', 'joints', 'apparatus', 'boilers']
      .find((k) => Number(inp[k]) > 0);
    qs.addRow([
      q.id, q.service_id, q.service_name, q.category, q.method,
      (q.question_ru || '').replace(/«|»/g, '').slice(0, 120),
      volKey ? Number(inp[volKey]) : null, volKey || '', inp.diameter_mm || inp.dn_mm || null,
      inp.fouling || q.complexity || '', inp.circuit_m3 || null,
      q.question_ru || '', 'todo'
    ]);
  }
  qs.getColumn(12).width = 70;

  // ── Лист Answers ──────────────────────────────────────────────────────────
  const as = wb.addWorksheet('Answers');
  header(as, ['query_id', 'norm_id', 'category_code', 'method_code', 'metric',
    'person_days', 'person_shifts', 'man_hours', 'crew_masters', 'crew_exec', 'shifts_per_day', 'shift_hours',
    'tech_equip_ru', 'calc_kind', 'rate_value', 'rate_unit', 'target_code', 'inputs_json',
    'url', 'quote_ru', 'source_type', 'rule_note', 'verdict']);

  let answers = 0;
  let rejected = [];
  const seen = new Set();

  for (const row of [...verified, ...findings]) {
    const c = conv.convert(row);
    const q = queryById.get(row.query_id);
    if (!c.ok) {
      rejected.push({ row, c });
      continue;
    }
    const rate = rateByCode.get(c.code) || null;
    const crew = (rate && rate.crew_json) || { master: 1, exec: rate && c.category === 'plates' ? 2 : 3 };
    const inputs = (q && q.inputs) || c.inputs;
    const pd = personDaysFor(c, inputs, crew, shiftsPerDay, shiftHours);
    const people = (Number(crew.master) || 1) + (Number(crew.exec) || 3);

    // Одинаковые строки одного источника не дублируем в Excel.
    const key = [c.code, row.query_id, row.quote_ru].join('|');
    if (seen.has(key)) continue;
    seen.add(key);

    as.addRow([
      row.query_id || '', row.norm_id || '', c.category, c.method,
      (row.extracted && row.extracted.metric) || row.metric || '',
      pd, pd != null ? Math.round(pd * people * shiftsPerDay * 100) / 100 : null,
      pd != null ? Math.round(pd * people * shiftsPerDay * shiftHours) : null,
      Number(crew.master) || 1, Number(crew.exec) || 3, shiftsPerDay, shiftHours,
      techFor(c.category, c.method, c.note),
      c.calc_kind, c.value, c.unit, c.code,
      JSON.stringify(c.inputs),
      row.url || '', row.quote_ru || '', row.source_type || '',
      c.note || '', 'ok'
    ]);
    answers += 1;
  }
  as.getColumn(13).width = 60;
  as.getColumn(19).width = 42;
  as.getColumn(20).width = 60;

  // ── Лист Rejected ─────────────────────────────────────────────────────────
  const rs = wb.addWorksheet('Rejected');
  header(rs, ['query_id', 'norm_id', 'category_code', 'method_code', 'metric', 'value', 'unit', 'url', 'quote_ru', 'reason', 'next_step']);
  for (const { row, c } of rejected) {
    const ext = row.extracted || row;
    rs.addRow([
      row.query_id || '', row.norm_id || '', row.category || '', row.method || '',
      ext.metric || row.metric || '', ext.productivity != null ? ext.productivity : (ext.value != null ? ext.value : row.value),
      ext.unit || row.unit || '', row.url || '', row.quote_ru || '', c.reason,
      'R4: найти удельную норму (м², трубка, м³, стык) или второй независимый источник'
    ]);
  }
  rs.getColumn(9).width = 55;
  rs.getColumn(10).width = 60;

  // ── Лист ImportMap ────────────────────────────────────────────────────────
  const im = wb.addWorksheet('ImportMap');
  header(im, ['code', 'category_code', 'method_code', 'calc_kind', 'unit', 'target',
    'rate_default', 'rate_loose', 'rate_medium', 'rate_hard', 'inputs_template', 'basis', 'source_count', 'note']);
  const byCode = new Map();
  for (const row of [...verified, ...findings]) {
    const c = conv.convert(row);
    if (!c.ok) continue;
    if (!byCode.has(c.code)) byCode.set(c.code, { c, n: 0, values: [] });
    const b = byCode.get(c.code);
    b.n += 1;
    b.values.push(c.value);
  }
  for (const [, b] of byCode) {
    const rate = rateByCode.get(b.c.code) || {};
    im.addRow([
      b.c.code, b.c.category, b.c.method, b.c.calc_kind, b.c.unit,
      rate.rate_default != null ? 'existing' : 'new',
      rate.rate_default ?? null, rate.rate_loose ?? null, rate.rate_medium ?? null, rate.rate_hard ?? null,
      JSON.stringify(b.c.inputs), 'research', b.n, b.c.note || ''
    ]);
  }
  im.getColumn(11).width = 40;

  // ── Лист Coverage ─────────────────────────────────────────────────────────
  const cov = wb.addWorksheet('Coverage');
  header(cov, ['category_code', 'method_code', 'queries', 'rate_code', 'calc_ok', 'calc_fail', 'note']);
  const covReportPath = path.join(REPORTS, 'coverage-report.json');
  if (fs.existsSync(covReportPath)) {
    const covReport = JSON.parse(fs.readFileSync(covReportPath, 'utf8'));
    for (const m of covReport.per_method || []) {
      const [cat, method] = m.key.split('|');
      cov.addRow([cat, method, m.total, (m.codes || []).join(', '), m.calc_ok, m.calc_err,
        m.calc_err ? 'есть ошибки — см. queries' : 'считается']);
    }
  }
  cov.getColumn(4).width = 40;

  await db.end();
  await wb.xlsx.writeFile(OUT);

  const uniq = new Set([...verified, ...findings]
    .map((r) => { const c = conv.convert(r); return c.ok ? c.code : null; })
    .filter(Boolean));

  console.log('=== EXCEL-КАНОН ===');
  console.log('файл:', OUT);
  console.log('Queries:', queries.length);
  console.log('Answers (ok):', answers);
  console.log('Rejected (в R4):', rejected.length);
  console.log('уникальных кодов норм:', uniq.size);
  console.log('ImportMap строк:', byCode.size);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
