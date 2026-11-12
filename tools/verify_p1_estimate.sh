#!/usr/bin/env bash
# Проверка estimateExpectedForSelection так же, как в реальном analyze:
# документы несут `structure` (её кладёт selectForPrompt), плюс table_positions.
set -euo pipefail
cat > /tmp/verify-p1/est.js <<'EOS'
const APP = '/var/www/asgard-crm';
const V = '/tmp/verify-p1';
process.chdir(APP);
const { Pool } = require(APP + '/node_modules/pg');
const XLSX = require(APP + '/node_modules/xlsx');
const fs = require('fs');
const es = require(V + '/services/excel-structure.js');
const ai = require(V + '/services/mimir-tender-stages-ai.js');

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
  // Как analyze-2138: разбор ДО отбора, structure и table_positions в документе.
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
  console.log('структура у документов:', docs.filter((d) => d.structure).length);
  console.log('estimate →', JSON.stringify(ai.estimateExpectedForSelection(docs)));
  const built = ai.buildStructuredInput(docs);
  console.log('buildStructuredInput.rows →', built.rows, '| entries', built.entries.length);
  await pool.end();
})().catch(async (e) => {
  console.log('FAIL', e.message);
  try { await pool.end(); } catch (_) {}
  process.exit(1);
});
EOS
cd /tmp/verify-p1 && node est.js 2>&1 | tail -8
