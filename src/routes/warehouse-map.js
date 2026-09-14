'use strict';
/**
 * WMS 3D map — floors / objects / location sync.
 * Prefix: /api/warehouse-map
 */

const WMS_WRITE = ['ADMIN', 'WAREHOUSE', 'CHIEF_ENGINEER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const WMS_READ = [...WMS_WRITE, 'PM', 'HEAD_PM', 'PROC', 'BUH'];
const OBJECT_TYPES = ['shelf_light','shelf_pallet','clothing','floor_zone','scrap','workbench','machine','assembly_pallet'];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function placeCode(rackCode, shelfIdx, placeIdx) {
  const letter = LETTERS[shelfIdx] || String(shelfIdx + 1);
  return `${rackCode || 'X'}${letter}${placeIdx + 1}`;
}

async function routes(fastify) {
  const db = fastify.db;
  const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });

  // ── Floors ────────────────────────────────────────────────────────────────
  fastify.get('/floors', { preHandler: [fastify.requireRoles(WMS_READ)] }, async (req) => {
    const { warehouse_id } = req.query;
    let sql = 'SELECT * FROM warehouse_map_floors WHERE 1=1';
    const p = [];
    if (warehouse_id) { sql += ' AND warehouse_id=$1'; p.push(warehouse_id); }
    sql += ' ORDER BY id';
    const { rows } = await db.query(sql, p);
    return { items: rows };
  });

  fastify.get('/floors/:id', { preHandler: [fastify.requireRoles(WMS_READ)] }, async (req, reply) => {
    const { rows } = await db.query('SELECT * FROM warehouse_map_floors WHERE id=$1', [req.params.id]);
    if (!rows[0]) return bad(reply, 'Этаж не найден', 404);
    const objs = await db.query(
      `SELECT * FROM warehouse_map_objects WHERE floor_id=$1 AND deleted_at IS NULL ORDER BY code NULLS LAST, id`,
      [req.params.id]);
    return { floor: rows[0], objects: objs.rows };
  });

  fastify.post('/floors', { preHandler: [fastify.requireRoles(WMS_WRITE)] }, async (req, reply) => {
    const b = req.body || {};
    if (!b.warehouse_id) return bad(reply, 'warehouse_id обязателен');
    const { rows } = await db.query(
      `INSERT INTO warehouse_map_floors(warehouse_id,name,width_m,depth_m,height_m,origin_x,origin_z,rooms_json,meta_json)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb) RETURNING *`,
      [b.warehouse_id, b.name || 'Основной', b.width_m || 28, b.depth_m || 15, b.height_m || 5.5,
       b.origin_x || 0, b.origin_z || 0,
       JSON.stringify(b.rooms_json || []), JSON.stringify(b.meta_json || {})]);
    return { floor: rows[0] };
  });

  fastify.put('/floors/:id', { preHandler: [fastify.requireRoles(WMS_WRITE)] }, async (req, reply) => {
    const b = req.body || {};
    const allowed = ['name','width_m','depth_m','height_m','origin_x','origin_z','rooms_json','meta_json'];
    const upd = [], vals = []; let i = 1;
    for (const k of allowed) {
      if (b[k] === undefined) continue;
      if (k.endsWith('_json')) { upd.push(`${k}=$${i++}::jsonb`); vals.push(JSON.stringify(b[k])); }
      else { upd.push(`${k}=$${i++}`); vals.push(b[k]); }
    }
    if (!upd.length) return bad(reply, 'Нет данных');
    upd.push('updated_at=NOW()'); vals.push(req.params.id);
    const { rows } = await db.query(`UPDATE warehouse_map_floors SET ${upd.join(',')} WHERE id=$${i} RETURNING *`, vals);
    if (!rows[0]) return bad(reply, 'Не найден', 404);
    return { floor: rows[0] };
  });

  // ── Objects ───────────────────────────────────────────────────────────────
  fastify.get('/objects', { preHandler: [fastify.requireRoles(WMS_READ)] }, async (req) => {
    const { floor_id, warehouse_id, object_type } = req.query;
    let sql = `SELECT * FROM warehouse_map_objects WHERE deleted_at IS NULL`;
    const p = []; let i = 1;
    if (floor_id) { sql += ` AND floor_id=$${i++}`; p.push(floor_id); }
    if (warehouse_id) { sql += ` AND warehouse_id=$${i++}`; p.push(warehouse_id); }
    if (object_type) { sql += ` AND object_type=$${i++}`; p.push(object_type); }
    sql += ' ORDER BY code NULLS LAST, id';
    const { rows } = await db.query(sql, p);
    return { items: rows };
  });

  fastify.post('/objects', { preHandler: [fastify.requireRoles(WMS_WRITE)] }, async (req, reply) => {
    const b = req.body || {};
    if (!b.floor_id || !b.object_type) return bad(reply, 'floor_id и object_type обязательны');
    if (!OBJECT_TYPES.includes(b.object_type)) return bad(reply, 'Неизвестный object_type');
    const fl = await db.query('SELECT warehouse_id FROM warehouse_map_floors WHERE id=$1', [b.floor_id]);
    if (!fl.rows[0]) return bad(reply, 'Этаж не найден', 404);
    const wh = fl.rows[0].warehouse_id;
    const { rows } = await db.query(
      `INSERT INTO warehouse_map_objects(
         floor_id,warehouse_id,object_type,code,label,x_m,z_m,rot_deg,
         width_m,depth_m,height_m,params_json,category_tags,load_kg,assembly_id,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16) RETURNING *`,
      [b.floor_id, wh, b.object_type, b.code || null, b.label || null,
       b.x_m ?? 0, b.z_m ?? 0, b.rot_deg ?? 0,
       b.width_m ?? 2.7, b.depth_m ?? 0.95, b.height_m ?? 2.4,
       JSON.stringify(b.params_json || {}), b.category_tags || [],
       b.load_kg ?? null, b.assembly_id || null, req.user.id]);
    let locations = [];
    if (b.sync_locations !== false && ['shelf_light','shelf_pallet','clothing','floor_zone'].includes(b.object_type)) {
      locations = await syncLocationsForObject(db, rows[0], req.user.id);
    }
    return { object: rows[0], locations };
  });

  fastify.put('/objects/:id', { preHandler: [fastify.requireRoles(WMS_WRITE)] }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const b = req.body || {};
    const cur = await db.query('SELECT * FROM warehouse_map_objects WHERE id=$1 AND deleted_at IS NULL', [id]);
    if (!cur.rows[0]) return bad(reply, 'Не найден', 404);
    const allowed = ['object_type','code','label','x_m','z_m','rot_deg','width_m','depth_m','height_m',
      'params_json','category_tags','load_kg','assembly_id','is_active'];
    const upd = [], vals = []; let i = 1;
    for (const k of allowed) {
      if (b[k] === undefined) continue;
      if (k === 'object_type' && !OBJECT_TYPES.includes(b[k])) return bad(reply, 'Неизвестный object_type');
      if (k === 'params_json') { upd.push(`${k}=$${i++}::jsonb`); vals.push(JSON.stringify(b[k])); }
      else { upd.push(`${k}=$${i++}`); vals.push(b[k]); }
    }
    if (!upd.length) return bad(reply, 'Нет данных');
    upd.push('updated_at=NOW()'); vals.push(id);
    const { rows } = await db.query(`UPDATE warehouse_map_objects SET ${upd.join(',')} WHERE id=$${i} RETURNING *`, vals);
    let locations = [];
    if (b.sync_locations) locations = await syncLocationsForObject(db, rows[0], req.user.id);
    return { object: rows[0], locations };
  });

  fastify.delete('/objects/:id', { preHandler: [fastify.requireRoles(WMS_WRITE)] }, async (req, reply) => {
    const { rows } = await db.query(
      `UPDATE warehouse_map_objects SET deleted_at=NOW(), is_active=false, updated_at=NOW()
       WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [req.params.id]);
    if (!rows[0]) return bad(reply, 'Не найден', 404);
    return { success: true };
  });

  // ── Sync locations from object dims ───────────────────────────────────────
  fastify.post('/objects/:id/sync-locations', { preHandler: [fastify.requireRoles(WMS_WRITE)] }, async (req, reply) => {
    const { rows } = await db.query('SELECT * FROM warehouse_map_objects WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
    if (!rows[0]) return bad(reply, 'Не найден', 404);
    const locations = await syncLocationsForObject(db, rows[0], req.user.id);
    return { locations, count: locations.length };
  });

  /** Дозаполнить QR-места для всех объектов этажа (идемпотентно). */
  fastify.post('/floors/:id/sync-locations', { preHandler: [fastify.requireRoles(WMS_WRITE)] }, async (req, reply) => {
    const { rows: floorRows } = await db.query('SELECT id FROM warehouse_map_floors WHERE id=$1', [req.params.id]);
    if (!floorRows[0]) return bad(reply, 'Этаж не найден', 404);
    const objs = await db.query(
      `SELECT o.* FROM warehouse_map_objects o
       WHERE o.floor_id=$1 AND o.deleted_at IS NULL
         AND o.object_type = ANY($2::text[])
         AND NOT EXISTS (
           SELECT 1 FROM warehouse_locations l
           WHERE l.map_object_id=o.id AND l.deleted_at IS NULL)`,
      [req.params.id, ['shelf_light', 'shelf_pallet', 'clothing', 'floor_zone', 'scrap']]);
    let count = 0;
    const locations = [];
    for (const obj of objs.rows) {
      const locs = await syncLocationsForObject(db, obj, req.user.id);
      count += locs.length;
      locations.push(...locs);
    }
    return { synced_objects: objs.rows.length, count, locations };
  });

  // ── Suggest putaway target ────────────────────────────────────────────────
  fastify.get('/suggest-putaway', { preHandler: [fastify.requireRoles(WMS_READ)] }, async (req) => {
    const { warehouse_id, category, heavy, clothing } = req.query;
    let sql = `SELECT o.*, 
      (SELECT COUNT(*) FROM warehouse_locations l WHERE l.map_object_id=o.id AND l.deleted_at IS NULL) AS loc_count
      FROM warehouse_map_objects o
      WHERE o.deleted_at IS NULL AND o.is_active=true`;
    const p = []; let i = 1;
    if (warehouse_id) { sql += ` AND o.warehouse_id=$${i++}`; p.push(warehouse_id); }
    if (clothing === '1' || clothing === 'true') sql += ` AND o.object_type='clothing'`;
    else if (heavy === '1' || heavy === 'true') sql += ` AND o.object_type IN ('shelf_pallet','floor_zone')`;
    else sql += ` AND o.object_type IN ('shelf_light','shelf_pallet','floor_zone','clothing')`;
    if (category) { sql += ` AND $${i++}=ANY(o.category_tags)`; p.push(category); }
    sql += ' ORDER BY o.object_type, o.code NULLS LAST LIMIT 20';
    const { rows } = await db.query(sql, p);
    return { suggestions: rows };
  });

  // ── Find by place code / QR ───────────────────────────────────────────────
  fastify.get('/by-place/:code', { preHandler: [fastify.requireRoles(WMS_READ)] }, async (req, reply) => {
    const code = String(req.params.code || '').trim().toUpperCase();
    const { rows } = await db.query(
      `SELECT l.*, o.object_type, o.code AS object_code, o.label AS object_label, o.x_m, o.z_m, o.width_m, o.depth_m, o.height_m
       FROM warehouse_locations l
       LEFT JOIN warehouse_map_objects o ON o.id=l.map_object_id
       WHERE l.deleted_at IS NULL AND UPPER(COALESCE(l.place_code,l.label,''))=$1
       LIMIT 5`, [code]);
    if (!rows.length) return bad(reply, 'Место не найдено', 404);
    return { items: rows };
  });
}

async function syncLocationsForObject(db, obj, userId) {
  const params = obj.params_json || {};
  const rack = obj.code || `O${obj.id}`;
  const zone = 'MAP';
  const created = [];

  const ensure = async (shelfIdx, placeIdx, shelf, cell, label) => {
    const code = placeCode(rack, shelfIdx, placeIdx);
    const existing = await db.query(
      `SELECT id FROM warehouse_locations WHERE map_object_id=$1 AND shelf_idx=$2 AND place_idx=$3 AND deleted_at IS NULL`,
      [obj.id, shelfIdx, placeIdx]);
    if (existing.rows[0]) {
      const { rows } = await db.query(
        `UPDATE warehouse_locations SET label=$1, place_code=$2, zone=$3, rack=$4, shelf=$5, cell=$6, is_active=true
         WHERE id=$7 RETURNING *`,
        [label || code, code, zone, rack, shelf, cell, existing.rows[0].id]);
      created.push(rows[0]);
      return;
    }
    const { rows } = await db.query(
      `INSERT INTO warehouse_locations(warehouse_id,zone,rack,shelf,cell,label,kind,created_by,map_object_id,shelf_idx,place_idx,place_code)
       VALUES($1,$2,$3,$4,$5,$6,'storage',$7,$8,$9,$10,$11)
       ON CONFLICT (warehouse_id, zone, rack, shelf, cell) DO UPDATE
         SET map_object_id=EXCLUDED.map_object_id, shelf_idx=EXCLUDED.shelf_idx, place_idx=EXCLUDED.place_idx,
             place_code=EXCLUDED.place_code, label=EXCLUDED.label, deleted_at=NULL, is_active=true
       RETURNING *`,
      [obj.warehouse_id, zone, rack, shelf, cell, label || code, userId, obj.id, shelfIdx, placeIdx, code]);
    created.push(rows[0]);
  };

  if (obj.object_type === 'shelf_light') {
    const shelves = parseInt(params.shelf_count || 4, 10);
    const places = parseInt(params.places_per_shelf || 2, 10);
    for (let si = 0; si < shelves; si++) {
      for (let pi = 0; pi < places; pi++) {
        await ensure(si, pi, LETTERS[si], String(pi + 1), placeCode(rack, si, pi));
      }
    }
  } else if (obj.object_type === 'shelf_pallet') {
    const levels = parseInt(params.pallet_levels || 3, 10);
    const slots = parseInt(params.slots_per_level || 2, 10);
    for (let si = 0; si < levels; si++) {
      for (let pi = 0; pi < slots; pi++) {
        await ensure(si, pi, `L${si + 1}`, String(pi + 1), placeCode(rack, si, pi));
      }
    }
  } else if (obj.object_type === 'clothing') {
    const sections = parseInt(params.clothing_sections || 4, 10);
    for (let pi = 0; pi < sections; pi++) {
      await ensure(0, pi, 'H', String(pi + 1), placeCode(rack, 0, pi));
    }
  } else if (obj.object_type === 'floor_zone' || obj.object_type === 'scrap') {
    await ensure(0, 0, 'Z', '1', rack);
  }

  return created;
}

module.exports = routes;
