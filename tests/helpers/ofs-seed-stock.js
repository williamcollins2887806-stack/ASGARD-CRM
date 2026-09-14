'use strict';
/**
 * Seed 2–3 OFS products with stock so cart preview splits reserve vs procure.
 * Call with admin/warehouse token optional — uses direct PG.
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const ITEMS = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../fixtures/ofs/cart-items.json'), 'utf8')
);

async function seedOfsStock(opts = {}) {
  const pool = opts.pool || new Pool({
    user: 'asgard', password: '123456789', database: process.env.DB_NAME || 'asgard_crm_dev', host: '127.0.0.1',
  });
  const own = !opts.pool;
  const wh = await pool.query(
    `SELECT id FROM warehouses WHERE is_active=true ORDER BY is_main DESC NULLS LAST, id LIMIT 1`
  );
  const warehouseId = wh.rows[0]?.id || 1;
  const loc = await pool.query(
    `SELECT id FROM warehouse_locations WHERE warehouse_id=$1 ORDER BY id LIMIT 1`,
    [warehouseId]
  ).catch(() => ({ rows: [] }));
  const locationId = loc.rows[0]?.id || null;

  const seeded = [];
  // first 2 items → on shelf with qty; rest stay missing for procure
  for (const it of ITEMS.slice(0, 2)) {
    let prod = await pool.query(
      `SELECT id FROM products WHERE lower(name)=lower($1) LIMIT 1`,
      [it.name]
    );
    let productId = prod.rows[0]?.id;
    if (!productId) {
      const ins = await pool.query(
        `INSERT INTO products(name, unit, is_draft, created_from, created_at)
         VALUES($1,$2,false,'ofs-seed',NOW()) RETURNING id`,
        [it.name, it.unit || 'шт']
      );
      productId = ins.rows[0].id;
    }
    const st = await pool.query(
      `SELECT id, quantity FROM stock WHERE product_id=$1 AND warehouse_id=$2 AND location_id IS NOT DISTINCT FROM $3`,
      [productId, warehouseId, locationId]
    );
    if (st.rows[0]) {
      await pool.query(`UPDATE stock SET quantity=GREATEST(quantity, 10), updated_at=NOW() WHERE id=$1`, [st.rows[0].id]);
    } else {
      await pool.query(
        `INSERT INTO stock(product_id, warehouse_id, location_id, quantity, unit)
         VALUES($1,$2,$3,10,$4)`,
        [productId, warehouseId, locationId, it.unit || 'шт']
      );
    }
    seeded.push({ product_id: productId, name: it.name, qty: 10 });
  }
  if (own) await pool.end();
  return { warehouse_id: warehouseId, location_id: locationId, seeded };
}

module.exports = { seedOfsStock, ITEMS };

if (require.main === module) {
  seedOfsStock().then((r) => {
    console.log(JSON.stringify(r, null, 2));
  }).catch((e) => { console.error(e); process.exit(1); });
}
