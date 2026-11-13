'use strict';
/**
 * Отладка резолва на конкретном звонке: что в client_card, что вернул поиск.
 */
const db = require('./../src/services/db');
const link = require('./../src/services/call-client-link');
const ai = require('./../src/services/ai-provider');

async function main() {
  await ai._loadKeysFromDB();
  const id = parseInt(process.argv[2] || '3244', 10);
  const row = (await db.query(
    'SELECT id, client_number, from_number, ai_lead_data FROM call_history WHERE id=$1', [id]
  )).rows[0];

  let ld = {};
  try { ld = typeof row.ai_lead_data === 'string' ? JSON.parse(row.ai_lead_data) : (row.ai_lead_data || {}); } catch (_) {}
  const card = ld.client_card || {};
  console.log('client_card =', JSON.stringify(card, null, 2));
  console.log('phone =', row.client_number || row.from_number);

  const known = await link.findCustomerByPhone(db, row.client_number || row.from_number);
  console.log('step1 known =', known ? known.inn + ' ' + known.name : 'нет');

  if (card.company_name) {
    const found = await link.findInnViaWeb(card);
    console.log('step3 web =', found ? JSON.stringify({ inn: found.inn, name: found.org && found.org.name }) : 'не найдено');
  }

  await db.pool.end();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
