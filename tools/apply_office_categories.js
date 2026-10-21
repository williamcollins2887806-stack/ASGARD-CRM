'use strict';
/**
 * D-336: РїСЂРёРјРµРЅСЏРµС‚ РєР°С‚РµРіРѕСЂРёР·Р°С†РёСЋ Рє office_expenses, СЃРѕР·РґР°РЅРЅС‹Рј РёР· РёРјРїРѕСЂС‚Р°.
 * Р РµР¶РёРјС‹: dry-run (РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ) / --apply
 * РќРµ С‚СЂРѕРіР°РµС‚ РІСЂСѓС‡РЅСѓСЋ СЃРѕР·РґР°РЅРЅС‹Рµ Р·Р°РїРёСЃРё (source <> 'doc_hub_import').
 */
const path = require('path');
process.chdir('/var/www/asgard-crm');
require('/var/www/asgard-crm/node_modules/dotenv').config({ path: '/var/www/asgard-crm/.env' });
const { Client } = require('/var/www/asgard-crm/node_modules/pg');
const { classifyOfficeCategory } = require('../src/services/office-category');

const APPLY = process.argv.includes('--apply');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });
  await c.connect();

  const { rows } = await c.query(`
    SELECT oe.id, oe.category, oe.counterparty, oe.description, oe.amount, oe.doc_number
      FROM office_expenses oe
     WHERE oe.source = 'doc_hub_import'
     ORDER BY oe.id`);

  console.log(`Р·Р°РїРёСЃРµР№ РёРјРїРѕСЂС‚Р°: ${rows.length}  СЂРµР¶РёРј: ${APPLY ? 'РџР РРњР•РќР•РќРР•' : 'dry-run'}`);

  const dist = {};
  const changes = [];
  for (const r of rows) {
    const cat = classifyOfficeCategory({ counterparty: r.counterparty, description: r.description, amount: r.amount });
    dist[cat] = (dist[cat] || 0) + 1;
    if (cat !== r.category) changes.push({ id: r.id, from: r.category, to: cat, cp: r.counterparty, amt: r.amount });
  }

  console.log('\n=== СЂР°СЃРїСЂРµРґРµР»РµРЅРёРµ РїРѕ РєР°С‚РµРіРѕСЂРёСЏРј ===');
  const LABEL = {
    rent: 'РђСЂРµРЅРґР° РѕС„РёСЃР°', utilities: 'РљРѕРјРјСѓРЅР°Р»СЊРЅС‹Рµ', office_supplies: 'РљР°РЅС†РµР»СЏСЂРёСЏ',
    communication: 'РЎРІСЏР·СЊ Рё РёРЅС‚РµСЂРЅРµС‚', transport: 'РўСЂР°РЅСЃРїРѕСЂС‚/С‚Р°РєСЃРё', household: 'РҐРѕР·С‚РѕРІР°СЂС‹',
    office_equipment: 'РћР±РѕСЂСѓРґРѕРІР°РЅРёРµ РѕС„РёСЃР°', software: 'РџРћ Рё РїРѕРґРїРёСЃРєРё',
    representation: 'РџСЂРµРґСЃС‚Р°РІРёС‚РµР»СЊСЃРєРёРµ', project_expense: 'Р Р°СЃС…РѕРґС‹ РЅР° РѕР±СЉРµРєС‚',
    tools: 'РРЅСЃС‚СЂСѓРјРµРЅС‚С‹/РЎРР—', other: 'РџСЂРѕС‡РµРµ'
  };
  for (const [k, v] of Object.entries(dist).sort((a, b) => b[1] - a[1]))
    console.log(`  ${LABEL[k] || k}: ${v}`);

  console.log(`\nРє РёР·РјРµРЅРµРЅРёСЋ: ${changes.length}`);
  const byMove = {};
  for (const ch of changes) {
    const key = `${ch.from} в†’ ${ch.to}`;
    byMove[key] = (byMove[key] || 0) + 1;
  }
  for (const [k, v] of Object.entries(byMove)) console.log(`  ${k}: ${v}`);

  if (APPLY) {
    let done = 0;
    for (const ch of changes) {
      await c.query('UPDATE office_expenses SET category=$2, updated_at=NOW() WHERE id=$1', [ch.id, ch.to]);
      done++;
    }
    console.log(`\nРѕР±РЅРѕРІР»РµРЅРѕ: ${done}`);
    const after = await c.query(`
      SELECT category, count(*)::int n, COALESCE(SUM(amount),0)::float8 s
        FROM office_expenses GROUP BY 1 ORDER BY 3 DESC`);
    console.log('\n=== РёС‚РѕРі РїРѕ РєР°С‚РµРіРѕСЂРёСЏРј (СЃСѓРјРјС‹) ===');
    for (const r of after.rows) console.log(`  ${LABEL[r.category] || r.category}: ${r.n} РЅР° ${r.s.toLocaleString('ru-RU')} в‚Ѕ`);
  }
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });

