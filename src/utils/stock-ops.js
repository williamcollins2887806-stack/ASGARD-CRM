'use strict';
/**
 * АСГАРД CRM — атомарные операции резерва расходников на складе.
 * Реюз в stock.js (HTTP-роуты /reserve, /reserve/:id/release) и warehouse-cart.js (submit-разбивка).
 *
 * Резерв увеличивает агрегат stock.reserved_qty + пишет трекинг-строку в stock_reservations.
 * Движение логируется как 'adjust' (резерв не меняет quantity — только reserved_qty),
 * т.к. CHECK на stock_movements.movement_type не содержит 'reserve'.
 * Все функции работают ВНУТРИ переданной транзакции (client с открытым BEGIN).
 */

async function logMoveAdjust(client, m) {
  // ref_type ограничен CHECK (procurement/assembly/manual/inventory) → используем 'manual';
  // id резерва кладём в reason для трассировки.
  await client.query(
    `INSERT INTO stock_movements(product_id,from_warehouse_id,from_location_id,qty,unit,movement_type,ref_type,ref_id,reason,created_by)
     VALUES($1,$2,$3,$4,$5,'adjust','manual',$6,$7,$8)`,
    [m.product_id, m.warehouse_id || null, m.location_id || null, m.qty, m.unit || 'шт',
     m.ref_id || null, (m.reason || '') + (m.ref_id ? ' (резерв #' + m.ref_id + ')' : ''), m.created_by || null]);
}

/**
 * Зарезервировать qty на складе. Бросает {code:'RESERVED', available} если свободного остатка
 * (quantity − reserved_qty) меньше qty.
 * @returns {Promise<{reservation_id:number, new_reserved:number}>}
 */
async function reserveStock(client, { product_id, warehouse_id, location_id, qty, work_id, reserved_by, procurement_id, notes }) {
  const sel = await client.query(
    `SELECT id, quantity, reserved_qty, unit FROM stock
     WHERE product_id=$1 AND warehouse_id=$2 AND location_id IS NOT DISTINCT FROM $3 FOR UPDATE`,
    [product_id, warehouse_id, location_id || null]);
  const row = sel.rows[0];
  const available = row ? (parseFloat(row.quantity) - parseFloat(row.reserved_qty || 0)) : 0;
  if (!row || available < qty) { const err = new Error('RESERVED'); err.code = 'RESERVED'; err.available = available; throw err; }
  await client.query('UPDATE stock SET reserved_qty = reserved_qty + $1, updated_at=NOW() WHERE id=$2', [qty, row.id]);
  const r = await client.query(
    `INSERT INTO stock_reservations(product_id,warehouse_id,qty,work_id,reserved_by,procurement_id,status,notes)
     VALUES($1,$2,$3,$4,$5,$6,'active',$7) RETURNING id`,
    [product_id, warehouse_id, qty, work_id || null, reserved_by || null, procurement_id || null, notes || null]);
  await logMoveAdjust(client, { product_id, warehouse_id, location_id, qty, unit: row.unit,
    ref_id: r.rows[0].id, reason: notes || 'Резерв из корзины', created_by: reserved_by });
  return { reservation_id: r.rows[0].id, new_reserved: parseFloat(row.reserved_qty || 0) + qty };
}

/**
 * Снять резерв по id. Уменьшает stock.reserved_qty (GREATEST(0,…)) и помечает строку released.
 * Бросает {code:'ALREADY'} если резерв не active.
 */
async function releaseReservation(client, { reservation_id, released_by }) {
  const sel = await client.query(
    `SELECT id, product_id, warehouse_id, qty, status FROM stock_reservations WHERE id=$1 FOR UPDATE`, [reservation_id]);
  const r = sel.rows[0];
  if (!r) { const err = new Error('NOT_FOUND'); err.code = 'NOT_FOUND'; throw err; }
  if (r.status !== 'active') { const err = new Error('ALREADY'); err.code = 'ALREADY'; throw err; }
  await client.query("UPDATE stock_reservations SET status='released', released_at=NOW() WHERE id=$1", [reservation_id]);
  await client.query(
    `UPDATE stock SET reserved_qty = GREATEST(0, reserved_qty - $1), updated_at=NOW()
     WHERE product_id=$2 AND warehouse_id=$3`, [r.qty, r.product_id, r.warehouse_id]);
  await logMoveAdjust(client, { product_id: r.product_id, warehouse_id: r.warehouse_id, qty: r.qty,
    ref_id: r.id, reason: 'Снятие резерва', created_by: released_by });
  return { released: true };
}

module.exports = { reserveStock, releaseReservation };
