'use strict';
/**
 * Аудит класса D-203: «мягко удалённый тендер не должен отдаваться в чтении».
 *
 * Трижды подряд один и тот же дефект всплывал в разных роутах одного ресурса
 * (.docx → GET /:id → история у контрагента): инвариант держался аккуратностью
 * на каждом маршруте, а не общей конструкцией. Этот скрипт находит остальные
 * места того же класса машинно.
 *
 * Что считает:
 *  - ЧТЕНИЕ  — строковые литералы с `FROM tenders` / `JOIN tenders` / `FROM tender_rp_reviews`
 *              / `FROM tender_analysis_checklists` БЕЗ упоминания `deleted_at`.
 *  - ЗАПИСЬ  — `INTO tenders` / `UPDATE tenders` / `DELETE FROM tenders` (фильтр не нужен,
 *              отдельный класс: там своя семантика).
 *
 * Это ФИЛЬТР ВНИМАНИЯ, не приговор: часть чтений законно смотрит и на удалённые
 * (архив, восстановление, миграции, отчёты «включая архив»). Такие помечаются
 * allowlist'ом ниже — с обоснованием, а не молча.
 *
 * Запуск: node tools/audit_tender_deleted_filter.js [--json]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

// Чтения, которым фильтр deleted_at НЕ нужен по смыслу. Обоснование обязательно —
// «молча пропустить» тут запрещено правилом проекта (protect-prod-shell / ledger).
const ALLOW = {
  'src/services/tender-registry-helpers.js': 'хелперы реестра: фильтр deleted_at навешивает вызывающий запрос',
  'src/services/pm-analysis-rating.js': 'рейтинг/аналитика: считает и архивные, чтобы метрика не «прыгала»',
};

const READ_RE = /(?:FROM|JOIN)\s+(tenders|tender_rp_reviews|tender_analysis_checklists)\b/i;
const WRITE_RE = /(?:INTO|UPDATE|DELETE\s+FROM)\s+(tenders|tender_rp_reviews|tender_analysis_checklists)\b/i;

// Класс D-203: чтение КОНКРЕТНОГО объекта тендера по идентификатору. Именно так
// протекали все три найденных дефекта: `WHERE id = $1` / `WHERE tender_id = $1`.
// Это HIGH — отдаёт данные конкретного (возможно удалённого) тендера наружу.
const BY_ID_RE = /\b(?:t\.|rev\.|c\.)?(?:tender_)?id\s*=\s*\$\d/i;
// Агрегаты/подсчёты — LOW: утечки «одной записи» нет, но метрика может учитывать архив.
const AGG_RE = /\b(COUNT|SUM|AVG|MAX|MIN)\s*\(/i;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      walk(p, out);
    } else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** Вытаскивает все строковые литералы (бэктик и одинарные кавычки) с позициями. */
function sqlStrings(src) {
  const out = [];
  const patterns = [/`([^`]*)`/gs, /'((?:[^'\\]|\\.)*)'/gs];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src)) !== null) {
      const body = m[1];
      if (!body || body.length > 20000) continue;
      out.push({ body, index: m.index });
    }
  }
  return out;
}

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

/** Первая содержательная строка SQL — чтобы отчёт читался глазами. */
function summaryLine(body) {
  const line = body.split('\n').map((l) => l.trim()).find((l) => l.length > 8) || body.trim();
  return line.replace(/\s+/g, ' ').slice(0, 110);
}

/** HTTP-глагол хендлера, внутри которого лежит SQL (ближайший fastify.<verb>( выше). */
function handlerVerb(src, index) {
  const before = src.slice(0, index);
  const re = /fastify\.(get|post|put|patch|delete)\s*\(/g;
  let last = null, m;
  while ((m = re.exec(before)) !== null) last = m[1];
  return last || '?';
}

function main() {
  const files = walk(SRC);
  const reads = [];
  const writes = [];
  const allowed = [];

  for (const abs of files) {
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    const src = fs.readFileSync(abs, 'utf8');
    for (const { body, index } of sqlStrings(src)) {
      const isRead = READ_RE.test(body);
      const isWrite = WRITE_RE.test(body);
      if (!isRead && !isWrite) continue;
      const hasDeleted = /deleted_at/i.test(body);
      const rec = {
        file: rel,
        line: lineOf(src, index),
        table: (body.match(READ_RE) || body.match(WRITE_RE) || [])[1],
        has_deleted_filter: hasDeleted,
        snippet: summaryLine(body),
      };
      const verb = handlerVerb(src, index);
      if (isRead && !hasDeleted) {
        // Класс D-203 (HIGH) — читающий хендлер отдаёт наружу данные конкретного тендера
        // по id. Именно так протекали все три найденных дефекта. Агрегаты/GC/POST-перечитки
        // (LOW/MED) утечки записи не дают — их разбирают отдельно, вручную.
        let severity = 'MED';
        if (verb === 'get') severity = BY_ID_RE.test(body) ? 'HIGH' : (AGG_RE.test(body) ? 'LOW' : 'LOW');
        else severity = 'LOW'; // не-GET: путь записи/GC/перечитывание после мутации
        const rec2 = { ...rec, verb, severity };
        if (ALLOW[rel]) allowed.push({ ...rec2, why: ALLOW[rel] });
        else reads.push(rec2);
      } else if (isWrite) {
        writes.push(rec);
      }
    }
  }

  const high = reads.filter((r) => r.severity === 'HIGH');
  const med = reads.filter((r) => r.severity === 'MED');
  const low = reads.filter((r) => r.severity === 'LOW');

  const byFile = {};
  for (const r of high) (byFile[r.file] = byFile[r.file] || []).push(r);

  if (process.argv.includes('--json')) {
    fs.writeFileSync(path.join(ROOT, 'tests', 'reports', 'TENDER-DELETED-AUDIT.json'),
      JSON.stringify({
        high_reads_by_id: high, med, low, by_file_of_high: byFile, allowed, writes,
        generated_for: 'D-203 class audit', generated_at: new Date().toISOString()
      }, null, 1));
    console.log('отчёт: tests/reports/TENDER-DELETED-AUDIT.json');
  }

  console.log('=== HIGH (чтение конкретного тендера/ревью/чек-листа по id) без deleted_at: ' +
    high.length + ', в ' + Object.keys(byFile).length + ' файлах ===');
  for (const file of Object.keys(byFile).sort()) {
    console.log('\n' + file + '  (' + byFile[file].length + ')');
    for (const r of byFile[file].sort((a, b) => a.line - b.line)) {
      console.log('  :' + r.line + '  [' + r.table + ']  ' + r.snippet);
    }
  }
  console.log('\n=== MED (прочие чтения, не агрегат): ' + med.length + ' ===');
  console.log(med.map((r) => '  ' + r.file + ':' + r.line + '  ' + r.snippet).join('\n'));
  console.log('\n=== LOW (агрегаты/подсчёты, могут учитывать архив): ' + low.length + ' ===');
  console.log(low.map((r) => '  ' + r.file + ':' + r.line + '  ' + r.snippet).join('\n'));
  console.log('\n=== Осознанно разрешено (allowlist): ' + allowed.length + ' ===');
  for (const a of allowed) console.log('  ' + a.file + ':' + a.line + '  — ' + a.why);
  console.log('\n=== Записи (фильтр не нужен): ' + writes.length + ' ===');
  console.log('\nИТОГ: HIGH ' + high.length + ', MED ' + med.length + ', LOW ' + low.length + ', записей ' + writes.length);
  process.exit(high.length ? 1 : 0);
}

main();
