'use strict';
/**
 * Импорт истории перелётов из .deploy/mlsp-plan-extract/flights_seed.json
 * Usage: node tools/import_mlsp_flight_history.js --base http://127.0.0.1:3000 --token <JWT>
 */
const fs = require('fs');
const path = require('path');

async function main() {
  const args = process.argv.slice(2);
  const base = args[args.indexOf('--base') + 1] || process.env.ASGARD_BASE || 'http://127.0.0.1:3000';
  const token = args[args.indexOf('--token') + 1] || process.env.ASGARD_TOKEN;
  if (!token) {
    console.error('Нужен --token или ASGARD_TOKEN');
    process.exit(1);
  }
  const file = path.join(__dirname, '..', '.deploy', 'mlsp-plan-extract', 'flights_seed.json');
  const items = JSON.parse(fs.readFileSync(file, 'utf8'));
  const chunk = 80;
  let total = 0;
  for (let i = 0; i < items.length; i += chunk) {
    const slice = items.slice(i, i + chunk);
    const r = await fetch(base.replace(/\/$/, '') + '/api/mlsp-passes/history/import', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ items: slice })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(j));
    total += j.inserted || 0;
    console.log('chunk', i, '+', j.inserted);
  }
  console.log('done', total);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
