'use strict';
/** Юнит: классификатор групп номенклатуры (без БД). */
const { classifyProductGroup, GROUP_LABELS, SEARCH_GROUPS } =
  require('../src/services/product-category-classify');

let fail = 0;
function assert(cond, msg) {
  if (!cond) { fail++; console.error('FAIL', msg); }
  else console.log('OK', msg);
}

assert(classifyProductGroup({ name: 'Проживание ФАТЬЯНОВ Э. А.', unit: 'сут' }) === 'housing', 'housing by name+unit');
assert(classifyProductGroup({ name: 'Плата за простой номера ЕЖКОВ' }) === 'housing', 'housing simple');
assert(classifyProductGroup({ name: 'Газоанализатор портативный', supplierName: 'ЛидерГазДетектор' }) === 'equipment', 'equipment');
assert(classifyProductGroup({ name: 'Саморез 4,2*13' }) === 'consumable', 'consumable screw');
assert(classifyProductGroup({ name: 'Гипсокартон влагостойкий Knauf' }) === 'materials', 'materials');
assert(classifyProductGroup({ name: 'Перчатки вязаные х/б' }) === 'ppe', 'ppe');
assert(classifyProductGroup({ name: 'Доставка' }) === 'services', 'services delivery');
assert(classifyProductGroup({ name: 'Комплексный обед', supplierName: 'Газпром питание' }) === 'food', 'food');
assert(classifyProductGroup({ name: 'Биты кованые РН2' }) === 'tools', 'tools');
assert(SEARCH_GROUPS.includes('housing') && GROUP_LABELS.housing === 'Жильё', 'labels');

if (fail) { console.error(`\n${fail} FAIL`); process.exit(1); }
console.log('\nALL PASS');
