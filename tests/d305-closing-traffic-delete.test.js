'use strict';
/**
 * D-305 (заказчик 20.10.2026) — три дефекта Doc Hub.
 * ═══════════════════════════════════════════════════════════════════════════
 * 1) «ПОЧЕМУ ЕСЛИ ЕСТЬ УПД, АКТ ИЛИ ЧЕК СЗ — всё равно пишет что нет СФ?
 *     любой закрывающий документ должен закрывать этот этап».
 *    Причина: этап закрывался ТОЛЬКО флагом sf_received_at. closing_json
 *    (УПД/акт/чек/СЗ) не учитывался ни в светофоре, ни в дайджесте, ни в
 *    колонке таблицы. На проде таких строк 206.
 *
 * 2) «А ГДЕ КНОПКА УДАЛИТЬ СТРОКУ?»
 *    Кнопка была только в карточке (drawer), в строке таблицы её не было.
 *
 * 3) «Я ПРОСИЛ, ЧТОБЫ СТРОКИ ГОРЕЛИ СИНИМ/ЗЕЛЁНЫМ/ЖЁЛТЫМ/КРАСНЫМ...
 *     сделай именно заливку строки, но так чтобы всё было читаемо».
 *    Было: красный/синий/жёлтый — фон 5-6% прозрачности (не видно),
 *    зелёный — ВООБЩЕ без фона.
 */

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; fails.push(name); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

const TRAFFIC = fs.readFileSync(path.join(__dirname, '../src/lib/doc-traffic.js'), 'utf8');
const CRON = fs.readFileSync(path.join(__dirname, '../src/services/reminder-cron.js'), 'utf8');
const JS = fs.readFileSync(path.join(__dirname, '../public/assets/js/doc-hub.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '../public/assets/css/doc-hub.css'), 'utf8');
const MIG = fs.readFileSync(path.join(__dirname, '../migrations/V428__cleanup_closing_and_stamp_sf.sql'), 'utf8');

// ─────────────────────────────────────────────────────────────────────────
console.log('── 1. Любой закрывающий закрывает этап ──');
{
  check('есть общий хелпер hasClosingDoc', /function hasClosingDoc/.test(TRAFFIC));
  check('учитывает closing_json, а не только sf_received_at', /r\.sf_received_at\) return true;[\s\S]{0,300}closing_json/.test(TRAFFIC));
  check('отсекает мусор («нет», «запросила», «в процессе»)', /запросила\?/.test(TRAFFIC) && /в\\s\*процессе/.test(TRAFFIC));
  check('отсекает ФИО вместо номера', /\[А-ЯЁ\]\[а-яё\]\+/.test(TRAFFIC));
  check('светофор использует hasClosingDoc', /!hasClosingDoc\(r\)/.test(TRAFFIC));
  check('SQL-зеркало closingDocSql есть', /function closingDocSql/.test(TRAFFIC));
  check('overdueSfSql использует closingDocSql', /NOT \$\{closingDocSql/.test(TRAFFIC));
  check('дайджест использует closingDocSql', /closingDocSql\('d'\)/.test(CRON));
  check('дайджест импортирует closingDocSql', /require\('\.\.\/lib\/doc-traffic'\)/.test(CRON));
  check('колонка СФ в таблице знает про УПД/акт/чек', /D-305: любой закрывающий документ закрывает этап/.test(JS));
}

// ─────────────────────────────────────────────────────────────────────────
console.log('── 2. Кнопка «Удалить» в строке таблицы ──');
{
  check('кнопка data-qa="del" в строке', /data-qa="del"/.test(JS));
  check('иконка корзины добавлена', /del: `<svg/.test(JS));
  check('обработчик удаления есть', /qa === 'del'/.test(JS));
  check('удаление с подтверждением', /confirm\('Удалить строку\?/.test(JS));
  check('после удаления — refresh', /DELETE'[\s\S]{0,300}refresh\(\)/.test(JS));
  check('CSS: красный только при наведении', /\.dh-qa__del:hover/.test(CSS));
}

// ─────────────────────────────────────────────────────────────────────────
console.log('── 3. Заливка строк светофором (все 4 цвета) ──');
{
  check('красный: заливка на токене', /is-traffic-red \{[\s\S]{0,120}background: var\(--err-bg\)/.test(CSS));
  check('синий: заливка на токене', /is-traffic-blue \{[\s\S]{0,120}background: var\(--info-bg\)/.test(CSS));
  check('жёлтый: заливка на токене', /is-traffic-yellow \{[\s\S]{0,120}background: var\(--warn-bg\)/.test(CSS));
  check('зелёный: заливка ЕСТЬ (раньше не было)', /is-traffic-green \{[\s\S]{0,120}background: var\(--ok-bg\)/.test(CSS));
  check('полоса слева 4px у всех', (CSS.match(/inset 4px 0 0/g) || []).length >= 4);
  check('заливка не спорит с выбранной строкой', /is-selected \{ outline: 2px solid var\(--gold\)/.test(CSS));
  check('нет прежней прозрачности 5-6%', !/color-mix\(in srgb, var\(--red\) 6%, transparent\)/.test(CSS));
}

// ─────────────────────────────────────────────────────────────────────────
console.log('── 4. Миграция чистит мусор и ставит флаг ──');
{
  check('чистит мусорные элементы', /jsonb_agg\(e\)/.test(MIG));
  check('отсекает «нет»/«запросила»/ФИО', /запросила\?/.test(MIG));
  check('ставит sf_received_at там, где документ есть', /SET sf_received_at/.test(MIG));
  check('пустой массив = этап открыт (не врём)', /'\[\]'::jsonb/.test(MIG));
  check('не удаляет строки реестра', !/DELETE\s+FROM\s+doc_registry/i.test(MIG));
}

console.log('\n────────────────────────────────────────');
console.log(`ИТОГ D-305: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log('FAIL:', fails.join(' | ')); process.exit(1); }
