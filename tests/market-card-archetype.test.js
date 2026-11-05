'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { matchArchetype, listArchetypeDefs } = require('../src/services/market-card-archetype');

test('taxonomy+extra keys stay under 500', () => {
  const n = listArchetypeDefs().length;
  assert.ok(n > 50, `expected many keys, got ${n}`);
  assert.ok(n <= 500, `keys ${n} > 500`);
});

test('cyrillic helmet / gloves / RVD match', () => {
  assert.equal(matchArchetype({ name: 'Каска защитная СОМЗ-55', search_group: 'ppe' }).key, 'ppe_helmet_building');
  assert.equal(matchArchetype({ name: 'Перчатки ХБ с ПВХ', search_group: 'ppe' }).key, 'ppe_gloves_general');
  assert.match(matchArchetype({ name: 'РВД 500бар 10м' }).key, /hose_rvd$/);
});

test('unknown goes to group fallback not other_fallback key', () => {
  const m = matchArchetype({ name: 'xyzzy-unknown-sku-991', search_group: 'ppe' });
  assert.equal(m.key, 'fallback_ppe');
  const o = matchArchetype({ name: 'xyzzy-unknown-sku-992', search_group: 'other' });
  assert.equal(o.key, 'fallback_other');
});

test('pumps split by subtype not one bucket', () => {
  assert.equal(matchArchetype({ name: 'Мембранный насос YARTEK' }).key, 'pump_membrane');
  assert.equal(matchArchetype({ name: 'Насос дренажный' }).key, 'pump_submersible_drain');
  assert.equal(matchArchetype({ name: 'Насос опрессовочный электрический' }).key, 'pump_pressure_test');
  assert.equal(matchArchetype({ name: 'Насосная установка центробежная КМХ' }).key, 'pump_chemical');
  assert.equal(matchArchetype({ name: 'Насос ЭЦВ' }).key, 'pump_centrifugal');
  assert.equal(matchArchetype({ name: 'насос садовый sterwins' }).key, 'equip_garden_pump');
});

test('welding split TIG / MIG / MMA', () => {
  assert.equal(matchArchetype({ name: 'Tig 315 p ac/dc multiweve pro' }).key, 'weld_tig');
  assert.equal(matchArchetype({ name: 'Сварочный полуавтомат Fubag IRMIG 200' }).key, 'weld_mig_mag');
  assert.equal(matchArchetype({ name: 'Сварочный инвертор РЕСАНТА САИ 160' }).key, 'welding_inverter_mma');
  assert.equal(matchArchetype({ name: 'Инвертор сварочный FUBAG INTIG 200' }).key, 'weld_tig');
});
