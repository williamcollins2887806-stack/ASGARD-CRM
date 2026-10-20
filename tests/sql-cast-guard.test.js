#!/usr/bin/env node
'use strict';

/**
 * Гейт D-308: SQL-типизация и полнота списка миграций.
 *
 * Два класса дефектов, которые дали 19–20.10.2026 ошибки 42804/42P08/42P01/42703
 * и 47 ответов 500:
 *
 *  1) Несовпадение типов в SQL. pg отправляет параметры БЕЗ OID, поэтому
 *     `CASE WHEN $1 THEN $2 ELSE NULL END` выводит тип $2 как text — даже когда
 *     в JS лежит число. При записи в integer-колонку Postgres отвечает
 *     42804. То же с `COALESCE(varchar_col, $N)`, где $N используется ещё и в
 *     `WHERE id=$N` — типы не сводятся, 42804.
 *
 *  2) Отставание `tools/migrate_targeted.js` от каталога migrations/. Список
 *     кончался на V412, код требовал V417/V418 — деплой заливал src и
 *     рестартовал сервис без нужной схемы.
 *
 * Гейт статический: БД не трогает, ничего не выполняет.
 *
 * Запуск: node tests/sql-cast-guard.test.js
 * Выход: 0 — чисто, 1 — регресс.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const failures = [];
const checks = [];

function ok(name, extra) { checks.push({ name, pass: true, extra }); }
function fail(name, extra) {
  checks.push({ name, pass: false, extra });
  failures.push(name + (extra ? ' — ' + extra : ''));
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * Достаём SQL-литералы (шаблонные строки и обычные строки с SQL) из файла.
 * Работать по файлу целиком нельзя: два соседних запроса дают ложные пары
 * «параметр из одного, WHERE из другого».
 */
function extractSqlLiterals(src) {
  const out = [];
  const re = /`([^`]*)`|'((?:[^'\\]|\\.)*)'/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const body = m[1] !== undefined ? m[1] : m[2];
    if (!body) continue;
    if (!/\b(select|update|insert|delete)\b/i.test(body)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    out.push({ sql: body, line });
  }
  return out;
}

/**
 * Ищем `CASE WHEN $N THEN $M` без каста у $M, где ELSE не даёт типа.
 * Именно эта форма выводит text и падает на integer-колонке (done_by,
 * dir_approved_by). Если ELSE — типизированная колонка (`ELSE length_mm`),
 * Postgres выводит тип из неё, и каст не нужен.
 */
function checkCaseWithoutCast() {
  const files = walk(path.join(ROOT, 'src'), []);
  const offenders = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const { sql, line } of extractSqlLiterals(src)) {
      const re = /CASE\s+WHEN\s+\$\d+(?:::\w+)?\s+THEN\s+\$(\d+)(?!\s*::)/g;
      let m;
      while ((m = re.exec(sql)) !== null) {
        // смотрим остаток выражения: если ELSE — имя колонки, тип выводится из неё
        const rest = sql.slice(m.index + m[0].length);
        const elseMatch = /^[^)]*?\bELSE\s+([A-Za-z_][\w.]*)/.exec(rest);
        const elseIsColumn = elseMatch && elseMatch[1].toLowerCase() !== 'null';
        if (elseIsColumn) continue;
        offenders.push(`${path.relative(ROOT, file)}:${line} ($${m[1]})`);
      }
    }
  }
  if (offenders.length) {
    fail('SQL: у $N внутри CASE WHEN есть явный каст', offenders.slice(0, 6).join(', '));
  } else {
    ok('SQL: у $N внутри CASE WHEN есть явный каст', `${files.length} файлов`);
  }
}

/**
 * Один параметр, попавший и в COALESCE(varchar_col, $N), и в `id=$N` того же
 * запроса. Тогда типы не сводятся и Postgres отвечает 42804.
 */
function checkSameParamInCoalesceAndWhere() {
  const files = walk(path.join(ROOT, 'src'), []);
  const offenders = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const { sql, line } of extractSqlLiterals(src)) {
      const coalesceRe = /COALESCE\([^()]*,\s*\$(\d+)\s*\)/g;
      let m;
      while ((m = coalesceRe.exec(sql)) !== null) {
        const num = m[1];
        if (new RegExp(`WHERE\\s+id\\s*=\\s*\\$${num}(\\D|$)`).test(sql)) {
          offenders.push(`${path.relative(ROOT, file)}:${line} ($${num})`);
        }
      }
    }
  }
  if (offenders.length) {
    fail('SQL: параметр не связан между COALESCE(varchar) и WHERE id', offenders.slice(0, 6).join(', '));
  } else {
    ok('SQL: параметр не связан между COALESCE(varchar) и WHERE id', `${files.length} файлов`);
  }
}

/**
 * Список TARGETS в migrate_targeted.js обязан покрывать все миграции выше
 * последней, которая в нём есть. Новая миграция без записи в TARGETS —
 * ровно тот дефект, что дал 42P01/42703 19–20.10.
 */
function checkMigrationTargets() {
  const runnerPath = path.join(ROOT, 'tools', 'migrate_targeted.js');
  const runner = fs.readFileSync(runnerPath, 'utf8');
  const block = runner.slice(runner.indexOf('const TARGETS'), runner.indexOf('];', runner.indexOf('const TARGETS')));
  const listed = new Set();
  const re = /'(V(\d+)__[\w]+)'/g;
  let m;
  let maxListed = 0;
  while ((m = re.exec(block)) !== null) {
    listed.add(m[1]);
    maxListed = Math.max(maxListed, Number(m[2]));
  }
  if (!listed.size) {
    fail('TARGETS: список найден', 'в migrate_targeted.js нет ни одной записи');
    return;
  }

  const migDir = path.join(ROOT, 'migrations');
  const files = fs.readdirSync(migDir).filter((f) => /^V\d+__.+\.sql$/.test(f) && !f.includes('_down'));
  const missing = files.filter((f) => {
    const num = Number(/^V(\d+)__/.exec(f)[1]);
    return num > maxListed;
  });
  if (missing.length) {
    fail('TARGETS: покрывает все миграции новее себя',
      `не хватает ${missing.length}: ${missing.slice(0, 6).join(', ')}`);
  } else {
    ok('TARGETS: покрывает все миграции новее себя', `последняя в списке V${maxListed}, файлов ${files.length}`);
  }

  // И сами записи не должны ссылаться на несуществующие файлы
  const present = new Set(files.map((f) => f.replace(/\.sql$/, '')));
  const ghosts = [...listed].filter((n) => !present.has(n));
  if (ghosts.length) {
    fail('TARGETS: нет ссылок на отсутствующие файлы', ghosts.slice(0, 6).join(', '));
  } else {
    ok('TARGETS: нет ссылок на отсутствующие файлы', `${listed.size} записей`);
  }
}

/**
 * Негативный контроль: гейт обязан ловить эталонный дефект.
 * Без него любая ошибка в регулярке даёт «вечный зелёный».
 */
function checkNegativeControl() {
  const defect = 'UPDATE t SET x = CASE WHEN $1 THEN $2 ELSE NULL END WHERE id = $3';
  const re = /CASE\s+WHEN\s+\$\d+(?:::\w+)?\s+THEN\s+(\$(\d+))(\s|,|\))/g;
  const hit = re.exec(defect);
  if (!hit || hit[2] !== '2') {
    fail('негативный контроль: CASE WHEN $1 THEN $2 детектируется', 'регулярка не сработала');
    return;
  }
  const fixed = 'SET done_by = CASE WHEN $1::boolean THEN $2::int ELSE NULL END';
  const re2 = /CASE\s+WHEN\s+\$\d+(?:::\w+)?\s+THEN\s+(\$(\d+))(\s|,|\))/g;
  if (re2.exec(fixed)) {
    fail('негативный контроль: исправленный вариант не считается дефектом', 'ложное срабатывание');
    return;
  }
  ok('негативный контроль: детектор ловит дефект и не трогает фикс', '2/2');
}

console.log('═══ sql-cast-guard (D-308) ═══');
checkCaseWithoutCast();
checkSameParamInCoalesceAndWhere();
checkMigrationTargets();
checkNegativeControl();

for (const c of checks) {
  console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.extra ? '  — ' + c.extra : ''}`);
}
console.log(`\nитог: ${checks.filter((c) => c.pass).length}/${checks.length}`);
if (failures.length) {
  console.log('FAIL:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('SQL_CAST_GUARD_OK');
