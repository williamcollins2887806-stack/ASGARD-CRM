'use strict';
/**
 * Seed full product + equipment catalog into asgard_crm_dev.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const pool = new Pool({
  host: process.env.PGHOST || '127.0.0.1',
  user: process.env.PGUSER || 'asgard',
  password: process.env.PGPASSWORD || '123456789',
  database: process.env.DB_NAME || 'asgard_crm_dev',
});

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const split = (line) => {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') { cur += '"'; i++; }
        else q = !q;
      } else if (ch === ',' && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const headers = split(lines[0]).map((h) => h.toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = split(lines[i]);
    if (!cols.some((c) => c)) continue;
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = cols[idx] || ''; });
    rows.push(obj);
  }
  return { headers, rows };
}

function pickName(row) {
  return (row['наименование'] || row['название'] || row.name || row['товар'] || '').trim();
}
function pickUnit(row) {
  const u = (row['единица'] || row['ед'] || row['ед.'] || row.unit || 'шт').trim();
  return u || 'шт';
}
function pickSupplier(row) {
  return (row['поставщик'] || row.supplier || '').trim() || null;
}
function pickPrice(row) {
  const raw = row['цена ₽'] || row['цена'] || row.price || '';
  const n = parseFloat(String(raw).replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(n) ? n : null;
}
function pickArticle(row) {
  return (row['артикул'] || row.article || '').trim() || null;
}

async function ensureProduct(client, { name, unit, supplier, price, article, notes }) {
  if (!name || name.length < 2) return null;
  const existing = await client.query(
    `SELECT id FROM products WHERE deleted_at IS NULL AND lower(name)=lower($1) LIMIT 1`,
    [name]
  );
  if (existing.rows[0]) return { id: existing.rows[0].id, created: false };
  const ins = await client.query(
    `INSERT INTO products(name, article, unit, is_active, is_consumable, is_draft, created_from, min_stock_level, notes, created_at, updated_at)
     VALUES($1,$2,$3,true,true,false,'import',0,$4,NOW(),NOW()) RETURNING id`,
    [name, article, unit || 'шт', notes || null]
  );
  const id = ins.rows[0].id;
  if (price != null) {
    try {
      await client.query(
        `INSERT INTO price_records(product_id, item_name, article, unit, supplier_name, unit_price, currency, source, recorded_at)
         VALUES($1,$2,$3,$4,$5,$6,'RUB','csv_import',NOW())`,
        [id, name, article, unit || 'шт', supplier, price]
      );
    } catch (_) { /* ignore */ }
  }
  return { id, created: true };
}

async function ensureEquipment(client, name) {
  if (!name || name.length < 2) return null;
  const existing = await client.query(
    `SELECT id FROM equipment WHERE deleted_at IS NULL AND lower(name)=lower($1) LIMIT 1`,
    [name]
  );
  if (existing.rows[0]) return { id: existing.rows[0].id, created: false };
  const inv = 'IMP-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const ins = await client.query(
    `INSERT INTO equipment(inventory_number, name, status, condition, quantity, unit, warehouse_id, is_active, qr_code, created_at, updated_at)
     VALUES($1,$2,'on_warehouse','good',1,'шт',1,true,$3,NOW(),NOW()) RETURNING id`,
    [inv, name, inv]
  );
  return { id: ins.rows[0].id, created: true };
}

async function main() {
  const client = await pool.connect();
  const stats = { products_created: 0, products_existed: 0, equip_created: 0, equip_existed: 0, errors: 0 };
  try {
    const fullPath = path.join(ROOT, 'Каталог_Асгард_ПОЛНЫЙ.csv');
    if (fs.existsSync(fullPath)) {
      const text = fs.readFileSync(fullPath, 'utf8');
      const { rows, headers } = parseCsv(text);
      console.log('FULL CSV', rows.length, 'headers', headers.slice(0, 8));
      for (const row of rows) {
        try {
          const name = pickName(row);
          const r = await ensureProduct(client, {
            name,
            unit: pickUnit(row),
            supplier: pickSupplier(row),
            price: pickPrice(row),
            article: pickArticle(row),
            notes: ((row['категория'] || '').trim() || null),
          });
          if (!r) { stats.errors++; continue; }
          if (r.created) stats.products_created++; else stats.products_existed++;
        } catch (e) {
          stats.errors++;
          if (stats.errors < 5) console.warn('row fail', e.message);
        }
      }
    }

    const prPath = path.join(ROOT, 'tools', 'uniq_pr_names.csv');
    if (fs.existsSync(prPath)) {
      const { rows } = parseCsv(fs.readFileSync(prPath, 'utf8'));
      for (const row of rows) {
        try {
          const name = (row.name || '').trim();
          const r = await ensureProduct(client, { name, unit: 'шт' });
          if (!r) continue;
          if (r.created) stats.products_created++; else stats.products_existed++;
        } catch (e) { stats.errors++; }
      }
    }

    const eqPath = path.join(ROOT, 'tools', 'uniq_eq_names.csv');
    if (fs.existsSync(eqPath)) {
      const { rows } = parseCsv(fs.readFileSync(eqPath, 'utf8'));
      for (const row of rows) {
        try {
          const name = (row.name || '').trim();
          const r = await ensureEquipment(client, name);
          if (!r) continue;
          if (r.created) stats.equip_created++; else stats.equip_existed++;
        } catch (e) { stats.errors++; if (stats.errors < 8) console.warn('eq fail', e.message); }
      }
    }

    const counts = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM products WHERE deleted_at IS NULL) AS products,
        (SELECT COUNT(*)::int FROM equipment WHERE deleted_at IS NULL) AS equipment`);
    console.log(JSON.stringify({ stats, counts: counts.rows[0] }, null, 2));
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
