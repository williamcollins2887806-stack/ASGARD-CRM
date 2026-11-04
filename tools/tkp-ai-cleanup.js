#!/usr/bin/env node
'use strict';
/** Убрать следы прогона проверок (клон): ТКП и его файл в документах тендера. */
const db = require('../src/services/db');

const tenderId = parseInt(process.argv[2], 10) || 2042;

(async () => {
  await db.query("DELETE FROM documents WHERE tender_id = $1 AND type = 'tkp'", [tenderId]);
  const r = await db.query('DELETE FROM tkp WHERE tender_id = $1', [tenderId]);
  console.log('cleanup ok: удалено ТКП ' + r.rowCount + ' (тендер ' + tenderId + ')');
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
