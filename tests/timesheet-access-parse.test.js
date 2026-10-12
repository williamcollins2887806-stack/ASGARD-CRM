/**
 * Unit: устойчивость парсера списка грантов (src/lib/timesheet-access.js).
 * Битый JSON, строка, число, null, мусорные значения — не должны грантовать.
 */
'use strict';
const { parseIds } = require('../src/lib/timesheet-access.js');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}

// JSON-строка массива (как хранится в settings)
const a = parseIds('[3465]');
check('строка-массив [3465] → содержит 3465', a.has(3465) && a.size === 1);

const b = parseIds('[3465, 3474, 3458]');
check('несколько id', b.has(3465) && b.has(3474) && b.has(3458) && b.size === 3);

const c = parseIds([3465, '3474', 0, -1, null, 'x', 1.9]);
check('числа/строки-числа ок; 0/-1/null/текст отброшены', c.has(3465) && c.has(3474) && c.size === 2);

check('битый JSON → пусто', parseIds('{broken').size === 0);
check('null → пусто', parseIds(null).size === 0);
check('undefined → пусто', parseIds(undefined).size === 0);
check('объект → пусто', parseIds({ a: 1 }).size === 0);
check('пустая строка → пусто', parseIds('').size === 0);
check('[] → пусто', parseIds('[]').size === 0);
check('мусорные значения "0" строкой отброшены', !parseIds('["0","abc",null]').has(0));

console.log(`\nИТОГО: PASS ${pass} / FAIL ${fail}`);
process.exitCode = fail ? 1 : 0;
