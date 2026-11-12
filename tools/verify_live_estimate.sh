#!/usr/bin/env bash
# Живой код прода: estimateExpectedForSelection должен дать ~675, а не 1348.
set -euo pipefail
cat > /tmp/live-est.js <<'EOS'
const APP = '/var/www/asgard-crm';
process.chdir(APP);
const { Pool } = require(APP + '/node_modules/pg');
const XLSX = require(APP + '/node_modules/xlsx');
const fs = require('fs');
const es = require(APP + '/src/services/excel-structure');
const ai = require(APP + '/src/services/mimir-tender-stages-ai');

const pool = new Pool({
  host: 'localhost', port: 5432, user: 'asgard',
  password: '123456789', database: 'asgard_crm', max: 2
});

(async () => {
  const q = await pool.query(
    "SELECT id, original_name AS name, ocr_text AS text, "
    + "COALESCE(file_url, download_url, filename) AS path "
    + "FROM documents WHERE tender_id = 2138 AND ocr_status = 'done' "
    + "AND ocr_text IS NOT NULL AND length(trim(ocr_text)) > 20 "
    + "ORDER BY length(ocr_text) DESC"
  );
  const byName = new Map();
  const docs = [];
  for (const d of q.rows) {
    const doc = Object.assign({}, d);
    if (/\.xlsx?$/i.test(d.name)) {
      if (!byName.has(d.name)) {
        const rel = String(d.path || '').replace(/^\/+/, '');
        let buf = null;
        for (const c of [d.path, APP + '/public/' + rel, APP + '/' + rel]) {
          try { if (c && fs.existsSync(c)) { buf = fs.readFileSync(c); break; } } catch (_) {}
        }
        let parsed = null;
        if (buf) {
          const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, cellText: true });
          parsed = es.parseWorkbook(XLSX, wb);
        }
        byName.set(d.name, parsed && parsed.stats.positions ? parsed : null);
      }
      const parsed = byName.get(d.name);
      if (parsed) {
        doc.structure = parsed;
        doc.table_positions = parsed.stats.positions;
      }
    }
    docs.push(doc);
  }
  const est = ai.estimateExpectedForSelection(docs);
  const built = ai.buildStructuredInput(docs);
  console.log('ожидание из разбора:', JSON.stringify(est));
  console.log('структурный вход: строк', built.rows, '| блоков', built.entries.length);
  console.log('ОЖИДАНИЕ:', est.rows, '(до фикса было 1348; реально по ведомости 675)');
  await pool.end();
})().catch(async (e) => { console.log('FAIL', e.message); try { await pool.end(); } catch (_) {} process.exit(1); });
EOS
cd /var/www/asgard-crm && node /tmp/live-est.js
