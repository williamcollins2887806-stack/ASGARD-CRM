#!/usr/bin/env node
'use strict';
/**
 * import-norms-workbook.js — переносит verified-нормы в work_norm_rates.
 *
 * Источник: tests/reports/norms-web/verified.jsonl (+ findings.jsonl как второй эшелон).
 * Конверсия: tools/norms-web-metrics.js (метрика → calc_kind/inputs/значение).
 * Запись: applyNormPatch (change_log на каждую норму), значения агрегируются
 * по коду медианой — иначе 16 строк протравки по разным Ду «размазали» бы одну
 * норму серией усреднений.
 *
 * Запуск:
 *   node tools/import-norms-workbook.js                # сухой прогон
 *   node tools/import-norms-workbook.js --write        # запись в БД из .env
 *   node tools/import-norms-workbook.js --write --db=asgard_crm_test
 *   node tools/import-norms-workbook.js --write --only-verified
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const conv = require('./norms-web-metrics');

const REPORTS = path.join(__dirname, '..', 'tests/reports/norms-web');
const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const ONLY_VERIFIED = args.includes('--only-verified');
const DB = (args.find((a) => a.startsWith('--db=')) || '').split('=')[1]
  || process.env.IMPORT_DB || process.env.DB_NAME || 'asgard_crm_test';

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split(/\r?\n/)
    .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } })
    .filter(Boolean);
}

function median(nums) {
  const a = [...nums].sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : Math.round(((a[mid - 1] + a[mid]) / 2) * 1000) / 1000;
}

/**
 * Агрегация значений одного кода.
 * Медиана, а не среднее: единичный «аварийный» источник не должен двигать норму.
 * Отдельно считаем разброс: если max/min > 3 — это конфликт источников,
 * строку нельзя писать молча, она уходит в разбор (A2b).
 */
function aggregate(values) {
  const uniq = [...new Set(values.map((v) => Math.round(Number(v) * 1000) / 1000))]
    .sort((a, b) => a - b);
  const med = median(uniq);
  const min = uniq[0];
  const max = uniq[uniq.length - 1];
  const spread = min > 0 ? max / min : Infinity;
  return {
    median: med,
    min,
    max,
    spread: Number.isFinite(spread) ? Math.round(spread * 100) / 100 : null,
    conflict: spread > 3
  };
}

/** Слоты по отложениям. Несколько источников с разным fouling → разные слоты. */
function slotValues(converted) {
  const slots = { light: [], medium: [], heavy: [] };
  for (const c of converted) {
    const f = String(c.fouling || 'medium').toLowerCase();
    const slot = (f === 'light' || f === 'loose' || f === 'лёгкие' || f === 'легкие') ? 'light'
      : (f === 'heavy' || f === 'hard' || f === 'тяжёлые' || f === 'тяжелые') ? 'heavy'
        : 'medium';
    slots[slot].push(c.value);
  }
  return slots;
}

/** Группируем конвертированные строки по коду нормы. */
function buildPlan(rows) {
  const byCode = new Map();
  const rejected = [];

  for (const row of rows) {
    const res = conv.convert(row);
    if (!res.ok) {
      rejected.push({
        norm_id: row.norm_id || null,
        query_id: row.query_id || null,
        metric: res.metric,
        category: res.category || row.category || null,
        method: res.method || row.method || null,
        reason: res.reason
      });
      continue;
    }
    const key = res.code;
    if (!byCode.has(key)) {
      byCode.set(key, {
        code: res.code,
        target: res.target,
        category: res.category,
        method: res.method,
        calc_kind: res.calc_kind,
        unit: res.unit,
        inputs: res.inputs,
        note: res.note,
        converted: [],
        sources: []
      });
    }
    const b = byCode.get(key);
    b.converted.push({ value: res.value, fouling: res.fouling, by_key: res.by_key });
    b.sources.push({
      query_id: row.query_id || null,
      norm_id: row.norm_id || null,
      url: row.url || null,
      quote_ru: row.quote_ru || null,
      source_type: row.source_type || null,
      source_value: res.source_value,
      source_unit: res.source_unit,
      converted: res.value,
      fouling: res.fouling
    });
  }

  return { byCode, rejected };
}

async function main() {
  const verified = readJsonl(path.join(REPORTS, 'verified.jsonl'));
  const findings = ONLY_VERIFIED ? [] : readJsonl(path.join(REPORTS, 'findings.jsonl'));
  const rows = [...verified, ...findings];

  console.log('=== ИМПОРТ НОРМ В СПРАВОЧНИК ===');
  console.log('БД:', DB, '| запись:', WRITE ? 'да' : 'нет (сухой прогон)');
  console.log('verified:', verified.length, '| findings:', findings.length);

  const { byCode, rejected } = buildPlan(rows);
  const codes = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));

  console.log('конвертировано строк:', rows.length - rejected.length,
    '| отклонено:', rejected.length, '| кодов норм:', codes.length);

  const workNorms = require('../src/services/work-norms');
  const db = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'asgard',
    password: process.env.DB_PASSWORD || '123456789',
    database: DB
  });

  const results = [];
  try {
    await db.connect();

    // Справочник категорий/методов — чтобы не создать норму в несуществующем методе.
    const cats = (await db.query(`SELECT code, methods_json FROM work_norm_categories`)).rows;
    const methodSet = new Set();
    for (const c of cats) {
      const ms = Array.isArray(c.methods_json) ? c.methods_json : [];
      for (const m of ms) methodSet.add(c.code + '|' + m.code);
      methodSet.add(c.code + '|');
    }

    for (const b of codes) {
      const key = b.category + '|' + (b.method || '');
      if (!methodSet.has(key)) {
        results.push({ code: b.code, status: 'skip_unknown_method', key });
        continue;
      }

      // Слоты по отложениям + проверка конфликта источников.
      const slots = slotValues(b.converted);
      const allAgg = aggregate(b.converted.map((c) => c.value));
      const values = {};
      if (slots.light.length) values.rate_loose = aggregate(slots.light).median;
      if (slots.medium.length) values.rate_medium = aggregate(slots.medium).median;
      if (slots.heavy.length) values.rate_hard = aggregate(slots.heavy).median;

      // Диаметры: если правило их различает — пишем by_diameter/by_dn,
      // а не одну усреднённую цифру (иначе Ду15 и Ду325 станут одним числом).
      const byGroups = new Map();
      for (const c of b.converted) {
        if (!c.by_key) continue;
        if (!byGroups.has(c.by_key)) byGroups.set(c.by_key, []);
        byGroups.get(c.by_key).push(c.value);
      }
      let byDiameter = null;
      if (byGroups.size >= 2) {
        byDiameter = {};
        for (const [k, vals] of byGroups) byDiameter[k] = aggregate(vals).median;
      }

      // Конфликт — это когда разброс большой, а развести нечем: нет ни
      // диаметров, ни разных слотов по отложениям. Если слоты разные —
      // это не конфликт, а честные light/medium/heavy.
      const nonEmptySlots = [slots.light, slots.medium, slots.heavy].filter((x) => x.length).length;
      if (allAgg.conflict && !byDiameter && nonEmptySlots < 2) {
        results.push({
          code: b.code, status: 'conflict', spread: allAgg.spread,
          min: allAgg.min, max: allAgg.max, unit: b.unit, kind: b.calc_kind,
          rows: b.converted.length,
          detail: 'разброс источников > 3× и нет признака (диаметр/отложения), по которому развести — в разбор'
        });
        continue;
      }

      const existing = (await db.query(
        `SELECT * FROM work_norm_rates WHERE code = $1 LIMIT 1`, [b.code]
      )).rows[0] || null;

      // rate_default: медиана только по medium-слоту; если его нет — по всем
      // значениям (иначе loose/heavy «подтянут» типичное).
      if (values.rate_medium != null) {
        values.rate_default = values.rate_medium;
      } else if (allAgg.median != null) {
        values.rate_default = allAgg.median;
      }

      const paramsPatch = { inputs_template: b.inputs, web_norm: { sources: b.sources.slice(0, 6) } };
      if (byDiameter) {
        // Ключ зависит от calc_kind: mh_per_unit по Ду — это by_dn,
        // min_per_unit и kg_per_m — by_diameter (см. lookupBySize).
        if (b.calc_kind === 'mh_per_unit' || b.calc_kind === 'kg_per_m') paramsPatch.by_dn = byDiameter;
        else paramsPatch.by_diameter = byDiameter;
      }

      const payload = {
        code: b.code,
        categoryCode: b.category,
        methodCode: b.method,
        name: existing ? existing.name : `Веб-норма · ${b.category}/${b.method} · ${b.unit}`,
        unit: b.unit,
        calcKind: b.calc_kind,
        values,
        paramsPatch,
        mode: 'replace',
        source: 'research',
        force: true,
        comment: `Импорт веб-норм: ${b.converted.length} источник(ов), ` +
          `медиана ${allAgg.median} ${b.unit} (разброс ${allAgg.min}–${allAgg.max})` +
          (byDiameter ? `, по диаметрам: ${Object.keys(byDiameter).join('/')}` : '') + '. ' +
          `Пример: ${b.sources[0]?.quote_ru ? String(b.sources[0].quote_ru).slice(0, 120) : '—'}`,
        user: null
      };

      if (!WRITE) {
        results.push({
          code: b.code, status: existing ? 'update' : 'create',
          from: existing ? existing.rate_default : null,
          to: values.rate_default, slots: values, unit: b.unit, kind: b.calc_kind,
          rows: b.converted.length, spread: allAgg.spread
        });
        continue;
      }

      try {
        const patch = await workNorms.applyNormPatch(db, payload);
        results.push({
          code: b.code, status: patch.created ? 'created' : 'updated',
          from: patch.before ? patch.before.rate_default : null,
          to: patch.after ? patch.after.rate_default : values.rate_default,
          slots: values, unit: b.unit, kind: b.calc_kind, rows: b.converted.length,
          spread: allAgg.spread
        });
      } catch (e) {
        results.push({ code: b.code, status: 'error', error: e.message });
      }
    }
  } finally {
    try { await db.end(); } catch (_) {}
  }

  console.log('\n=== РЕЗУЛЬТАТ ПО КОДАМ ===');
  for (const r of results) {
    if (r.status === 'error') {
      console.log(`FAIL     ${r.code}: ${r.error}`);
    } else if (r.status === 'skip_unknown_method') {
      console.log(`SKIP     ${r.code}: нет метода ${r.key} в справочнике`);
    } else if (r.status === 'conflict') {
      console.log(`CONFLICT ${r.code}: ${r.min}–${r.max} ${r.unit} (×${r.spread}, строк ${r.rows}) — в разбор`);
    } else {
      const slotTxt = r.slots
        ? ` L/M/H=${r.slots.rate_loose ?? '—'}/${r.slots.rate_medium ?? '—'}/${r.slots.rate_hard ?? '—'}`
        : '';
      console.log(`${r.status.padEnd(8)} ${r.code.padEnd(32)} ${String(r.from ?? '—').padStart(8)} → ` +
        `${String(r.to).padStart(8)} ${r.unit || ''} (${r.kind || ''}, строк ${r.rows})${slotTxt}`);
    }
  }

  const out = {
    generated_at: new Date().toISOString(),
    database: DB,
    written: WRITE,
    totals: {
      input_rows: rows.length,
      converted_rows: rows.length - rejected.length,
      rejected_rows: rejected.length,
      codes: codes.length,
      updated: results.filter((r) => r.status === 'updated').length,
      created: results.filter((r) => r.status === 'created' || r.status === 'create').length,
      errors: results.filter((r) => r.status === 'error').length,
      skipped: results.filter((r) => r.status === 'skip_unknown_method').length
    },
    results,
    rejected
  };
  fs.writeFileSync(path.join(REPORTS, 'import-report.json'), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(REPORTS, 'import-rejected.jsonl'),
    rejected.map((r) => JSON.stringify(r)).join('\n') + (rejected.length ? '\n' : ''));

  console.log('\nотчёт: tests/reports/norms-web/import-report.json');
  console.log('отклонённые: tests/reports/norms-web/import-rejected.jsonl');
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
