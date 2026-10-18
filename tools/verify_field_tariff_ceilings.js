#!/usr/bin/env node
'use strict';
/**
 * verify_field_tariff_ceilings.js — гейт сетки ставок полевого модуля (V407).
 *
 * Проверяет на целевой БД (по умолчанию asgard_crm_test):
 *   1) потолки баллов по категориям для базовых ролей достижимы (максимум = потолку);
 *   2) КАЖДАЯ позиция с суффиксом «(Nб)» (их создаёт V407) доводит свою роль
 *      до потолка категории — нет «оборванных» лестниц;
 *   3) сетка сварщика 14…50б без пропусков во всех 4 категориях;
 *   4) арифметика: rate_per_shift == points × 500 (кроме фикса «Пайковые (суточные)»);
 *   5) нет дублей (category, position_name, points) среди активных базовых;
 *   6) нет не-сварщиковых/ПТО позиций выше потолка категории;
 *   7) нет ссылок employee_assignments (tariff_id / combination_tariff_id /
 *      combo_tariff_ids) на НЕАКТИВНЫЕ строки сетки — иначе у людей «пропадёт» тариф.
 *
 * Usage: node tools/verify_field_tariff_ceilings.js [db]
 * Exit 0 — всё зелёно, exit 1 — есть FAIL.
 */
require('dotenv').config();
const { Client } = require('pg');

const DB = process.argv[2] || process.env.TARIFF_VERIFY_DB || 'asgard_crm_test';
const POINT_VALUE = 500;
const CEILINGS = { warehouse: 18, ground: 20, ground_hard: 24, mlsp: 28 };
const WELDER_MIN = 14;
const WELDER_MAX = 50;
const CATS = Object.keys(CEILINGS);
// База роли = имя без хвоста «(Nб)» (лестница V407). «(+N балл)» — отдельные
// надбавки-строки, они в максимум не мешают, т.к. ищем max по базе.
const BASE_EXPR = `regexp_replace(position_name, '\\s*\\(\\d+б\\)\\s*$', '')`;

const fails = [];
const oks = [];
const check = (ok, label, detail) => {
  (ok ? oks : fails).push(label + (detail ? ` — ${detail}` : ''));
};

(async () => {
  const c = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'asgard',
    password: process.env.DB_PASSWORD || 'password',
    database: DB
  });
  await c.connect();
  console.log(`БД: ${DB}\n`);

  // 1) Потолки достижимы по каждой категории
  const fams = (await c.query(`
    SELECT category, ${BASE_EXPR} AS base, max(points)::int AS mx
      FROM field_tariff_grid
     WHERE is_active AND is_combinable = FALSE
       AND (position_name LIKE 'Слесарь%' OR position_name LIKE 'Мастер%')
       AND position_name NOT LIKE 'Мастер ПТО%'
     GROUP BY 1,2`)).rows;
  for (const cat of CATS) {
    const rows = fams.filter((f) => f.category === cat);
    const top = rows.length ? Math.max(...rows.map((r) => r.mx)) : null;
    check(top === CEILINGS[cat], `потолок ${cat} = ${CEILINGS[cat]}б достижим`,
      `факт max=${top}` + (rows.length ? `, ролей=${rows.length}` : ''));
  }

  // 2) Лестницы V407 не оборваны: позиция «(Nб)» ⇒	max её роли = потолок
  const ladders = (await c.query(`
    SELECT category, ${BASE_EXPR} AS base, max(points)::int AS mx, count(1)::int AS n
      FROM field_tariff_grid
     WHERE is_active AND is_combinable = FALSE
       AND (position_name LIKE 'Слесарь%' OR position_name LIKE 'Мастер%')
       AND position_name NOT LIKE 'Мастер ПТО%'
     GROUP BY 1,2
    HAVING bool_or(position_name ~ '\\(\\d+б\\)$')`)).rows;
  const broken = ladders.filter((l) => l.mx !== CEILINGS[l.category]);
  check(broken.length === 0 && ladders.length > 0,
    'все лестницы V407 доводят роль до потолка',
    (ladders.length === 0 ? 'нет ни одной лестницы (V407 не применён?)' :
      (broken.length ? broken.map((b) => `${b.category}/${b.base}=${b.mx}`).join('; ') :
        `проверено ролей: ${ladders.length}`)));

  // 3) Сварщик 14…50 без пропусков
  const welder = (await c.query(`
    SELECT category, count(DISTINCT points)::int AS distinct_pts,
           min(points)::int AS mn, max(points)::int AS mx
      FROM field_tariff_grid
     WHERE is_active AND position_name LIKE 'Сварщик (%'
     GROUP BY 1`)).rows;
  for (const cat of CATS) {
    const row = welder.find((w) => w.category === cat);
    const expected = WELDER_MAX - WELDER_MIN + 1;
    check(!!row && row.mx === WELDER_MAX && row.mn === WELDER_MIN && row.distinct_pts === expected,
      `сварщик ${cat} = ${WELDER_MIN}…${WELDER_MAX} без пропусков`,
      row ? `факт ${row.mn}…${row.mx}, уникальных=${row.distinct_pts} (нужно ${expected})` : 'нет строк');
  }

  // 4) Арифметика
  const badMath = (await c.query(`
    SELECT position_name, points, rate_per_shift FROM field_tariff_grid
     WHERE is_active AND is_combinable = FALSE
       AND rate_per_shift <> points * ${POINT_VALUE}
       AND position_name <> 'Пайковые (суточные)'`)).rows;
  check(badMath.length === 0, 'арифметика rate = points × 500',
    badMath.length ? `${badMath.length} строк: ` + badMath.slice(0, 5).map((b) => `${b.position_name} ${b.points}б/${b.rate_per_shift}`).join('; ') : '');

  // 5) Дубли
  const dup = (await c.query(`
    SELECT count(1)::int n FROM (
      SELECT category, position_name, points FROM field_tariff_grid
       WHERE is_active AND is_combinable = FALSE
       GROUP BY 1,2,3 HAVING count(1) > 1) x`)).rows[0].n;
  check(dup === 0, 'нет дублей (category, position_name, points)', `факт=${dup}`);

  // 6) Ничего не выше потолка (кроме сварщика и ПТО)
  const overC = (await c.query(`
    SELECT category, position_name, points FROM field_tariff_grid
     WHERE is_active AND is_combinable = FALSE
       AND position_name NOT LIKE 'Сварщик (%' AND position_name NOT LIKE 'ПТО (%'
       AND ((category='warehouse' AND points > ${CEILINGS.warehouse})
         OR (category='ground' AND points > ${CEILINGS.ground})
         OR (category='ground_hard' AND points > ${CEILINGS.ground_hard})
         OR (category='mlsp' AND points > ${CEILINGS.mlsp}))`)).rows;
  check(overC.length === 0, 'нет позиций выше потолка категории',
    overC.length ? overC.map((o) => `${o.category}/${o.position_name}=${o.points}`).join('; ') : '');

  // 7) Ссылочная целостность: назначения не должны указывать на неактивные тарифы
  const deadRefs = (await c.query(`
    SELECT src.kind, src.tariff_id, t.category, t.position_name, t.is_active
      FROM (
        SELECT 'tariff_id' AS kind, ea.tariff_id AS tariff_id FROM employee_assignments ea
         WHERE ea.tariff_id IS NOT NULL
        UNION ALL
        SELECT 'combination_tariff_id', ea.combination_tariff_id FROM employee_assignments ea
         WHERE ea.combination_tariff_id IS NOT NULL
        UNION ALL
        SELECT 'combo_tariff_ids', cid FROM employee_assignments ea,
               unnest(COALESCE(ea.combo_tariff_ids, ARRAY[]::int[])) AS cid
      ) src
      JOIN field_tariff_grid t ON t.id = src.tariff_id
     WHERE t.is_active = FALSE`)).rows;
  check(deadRefs.length === 0, 'назначения не ссылаются на неактивные тарифы',
    deadRefs.length ? deadRefs.slice(0, 6).map((d) => `${d.kind}#${d.tariff_id} ${d.position_name}`).join('; ') : '');

  await c.end();

  for (const o of oks) console.log(`  PASS  ${o}`);
  for (const f of fails) console.log(`  FAIL  ${f}`);
  console.log(`\n${oks.length}/${oks.length + fails.length} проверок зелёные`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('Ошибка проверки:', e.message);
  process.exit(1);
});
