#!/usr/bin/env bash
# Проверка патча P1 на реальных данных прода БЕЗ выкатки.
# Кладём исправленные модули в /tmp/verify-p1 и гоняем диагностику с ними.
set -euo pipefail
APP=/var/www/asgard-crm
V=/tmp/verify-p1
mkdir -p "$V/services"
cp /tmp/excel-structure.js "$V/services/excel-structure.js"
cp /tmp/mimir-tender-stages-ai.js "$V/services/mimir-tender-stages-ai.js"

cat > "$V/check.js" <<'EOS'
const APP = '/var/www/asgard-crm';
const V = '/tmp/verify-p1';
process.chdir(APP);
const { Pool } = require(APP + '/node_modules/pg');
const XLSX = require(APP + '/node_modules/xlsx');
const fs = require('fs');
const es = require(V + '/services/excel-structure.js');

const pool = new Pool({
  host: 'localhost', port: 5432, user: 'asgard',
  password: '123456789', database: 'asgard_crm', max: 2
});
const r3 = (v) => Math.round(v * 1000) / 1000;

(async () => {
  const q = await pool.query(
    `SELECT id, original_name AS name, ocr_text AS text,
            COALESCE(file_url, download_url, filename) AS path
       FROM documents WHERE tender_id = 2138
        AND ocr_text IS NOT NULL AND length(trim(ocr_text)) > 20
      ORDER BY id`
  );
  const files = [];
  const seen = new Set();
  for (const d of q.rows) {
    if (!/\.xlsx?$/i.test(d.name)) continue;
    const base = String(d.name || '').replace(/\s+/g, '');
    if (seen.has(base)) continue;
    seen.add(base);
    const rel = String(d.path || '').replace(/^\/+/, '');
    let buf = null;
    for (const c of [d.path, APP + '/public/' + rel, APP + '/' + rel]) {
      try { if (c && fs.existsSync(c)) { buf = fs.readFileSync(c); break; } } catch (_) {}
    }
    if (!buf) { console.log('нет файла', d.id); continue; }
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, cellText: true });
    const p = es.parseWorkbook(XLSX, wb);
    if (!p || !p.stats.positions) continue;
    const sum = p.positions.reduce((s, x) => s + (Number(x.volume) || 0), 0);
    const units = new Map();
    for (const x of p.positions) {
      const u = String(x.unit == null ? '(пусто)' : x.unit);
      units.set(u, (units.get(u) || 0) + 1);
    }
    console.log('#%s %s | %d поз. | Σ volume %s',
      d.id, String(d.name).slice(0, 42), p.stats.positions, r3(sum));
    console.log('    единицы:', JSON.stringify([...units.entries()].slice(0, 6)));
    files.push({ id: d.id, positions: p.positions });
  }

  console.log('\n=== дедуп ===');
  for (let i = 0; i < files.length; i += 1) {
    for (let j = i + 1; j < files.length; j += 1) {
      const c = es.compareLists(files[i].positions, files[j].positions);
      console.log('  #' + files[i].id + ' vs #' + files[j].id,
        '| ratio', c.ratio, '| volume', c.ratio_volume, '| name', c.ratio_name,
        '| sameList', c.sameList);
    }
  }

  // Ожидание: тот же путь, что estimateExpectedForSelection
  const ai = require(V + '/services/mimir-tender-stages-ai.js');
  const est = ai.estimateExpectedForSelection(q.rows);
  console.log('\nestimateExpectedForSelection →', JSON.stringify(est));

  await pool.end();
})().catch(async (e) => { console.log('FAIL', e.message, e.stack); try { await pool.end(); } catch (_) {} process.exit(1); });
EOS
cd "$V" && node check.js
