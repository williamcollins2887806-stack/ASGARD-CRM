/**
 * Что видит estimateExpectedForSelection на реальном наборе документов 2138.
 *
 * Печатает: по каждому документу — размер текста, table_positions, signature,
 * удалось ли разобрать структуру из текста, и итог оценки.
 *
 * node .deploy/diag-expected.js --tender=2138
 */
const APP = '/var/www/asgard-crm';
process.chdir(APP);
const { Pool } = require(APP + '/node_modules/pg');
const XLSX = require(APP + '/node_modules/xlsx');
const fs = require('fs');
const es = require(APP + '/src/services/excel-structure');

const arg = process.argv.find((a) => /^--tender=/.test(a));
const TENDER_ID = arg ? Number(arg.split('=')[1]) : Number(process.env.TENDER_ID) || 2138;

const pool = new Pool({
  host: 'localhost', port: 5432, user: 'asgard',
  password: process.env.DB_PASSWORD || '123456789', database: 'asgard_crm', max: 2
});

(async () => {
  const ai = require(APP + '/src/services/mimir-tender-stages-ai');
  const q = await pool.query(
    `SELECT id, original_name AS name, ocr_text AS text,
            COALESCE(file_url, download_url, filename) AS path
       FROM documents
      WHERE tender_id = $1 AND ocr_status = 'done'
        AND ocr_text IS NOT NULL AND length(trim(ocr_text)) > 20
      ORDER BY length(ocr_text) DESC`, [TENDER_ID]
  );

  // Структурный счёт из xlsx, как в analyze-2138.
  const rowsByName = new Map();
  for (const d of q.rows) {
    if (!/\.xlsx?$/i.test(d.name)) continue;
    const rel = String(d.path || '').replace(/^\/+/, '');
    let buf = null;
    for (const c of [d.path, APP + '/public/' + rel, APP + '/' + rel]) {
      try { if (c && fs.existsSync(c)) { buf = fs.readFileSync(c); break; } } catch (_) {}
    }
    if (!buf) continue;
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, cellText: true });
    const p = es.parseWorkbook(XLSX, wb);
    if (p && p.stats.positions) {
      rowsByName.set(d.name, Math.max(rowsByName.get(d.name) || 0, p.stats.positions));
    }
  }
  console.log('structural rows by name:', JSON.stringify([...rowsByName.entries()]));

  const docs = q.rows.map((d) => Object.assign({}, d, {
    table_positions: rowsByName.get(d.name) || 0
  }));

  // Что видит оценка
  const est = ai.estimateExpectedForSelection(docs);
  console.log('\nestimateExpectedForSelection →', JSON.stringify(est));

  // Кто сколько даёт и как дёлется
  for (const d of docs) {
    const text = String(d.text || '');
    if (!text) continue;
    console.log('  doc', d.id, String(d.name).slice(0, 45),
      '| text', text.length, '| table_positions', d.table_positions,
      '| структура из текста:', (() => {
        try { return ai.__diagStructureFromText ? ai.__diagStructureFromText(d) : 'нет экспорта'; }
        catch (e) { return 'err ' + e.message; }
      })());
  }

  // Сколько копий одного текста
  const sigs = new Map();
  for (const d of docs) {
    const text = String(d.text || '');
    if (!text) continue;
    const key = text.length + '|' + text.slice(0, 80);
    if (!sigs.has(key)) sigs.set(key, []);
    sigs.get(key).push(d.id);
  }
  console.log('\nгруппы по (длина+начало текста):', sigs.size);
  for (const [k, ids] of sigs) console.log('  ', k.slice(0, 40), '→', JSON.stringify(ids));

  await pool.end();
})().catch(async (e) => { console.log('FAIL', e.message); try { await pool.end(); } catch (_) {} process.exit(1); });
