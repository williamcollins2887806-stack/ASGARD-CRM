'use strict';

/**
 * Sites (Object Locations) Routes
 * CRUD for physical sites/objects on the map + geocoding proxy
 */

module.exports = async function(fastify, options) {
  const db = fastify.db;

  const MAP_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_PM', 'HEAD_TO'];

  // ─────────────────────────────────────────────────────────────────
  // GET /api/sites — all sites with aggregated stats
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { rows } = await db.query(`
      SELECT s.*,
        s.customer_name as customer_display_name,
        (SELECT COUNT(*) FROM works w WHERE w.site_id = s.id) as works_count,
        (SELECT COUNT(*) FROM tenders t WHERE t.site_id = s.id) as tenders_count,
        (SELECT COUNT(*) FROM works w WHERE w.site_id = s.id
          AND w.work_status IN ('В работе','Мобилизация','На объекте','In Progress')) as active_works
      FROM sites s
      ORDER BY s.updated_at DESC
    `);
    return rows;
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /api/sites/:id — single site with related works and tenders
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { rows: [site] } = await db.query(
      'SELECT * FROM sites WHERE id = $1',
      [request.params.id]
    );
    if (!site) return reply.code(404).send({ error: 'Site not found' });

    const { rows: works } = await db.query(`
      SELECT w.*, u.name as pm_name
      FROM works w
      LEFT JOIN users u ON w.pm_id = u.id
      WHERE w.site_id = $1
      ORDER BY w.created_at DESC
    `, [request.params.id]);

    const { rows: tenders } = await db.query(
      'SELECT * FROM tenders WHERE site_id = $1 ORDER BY created_at DESC',
      [request.params.id]
    );

    return { site, works, tenders };
  });

  // ─────────────────────────────────────────────────────────────────
  // POST /api/sites — create new site
  // ─────────────────────────────────────────────────────────────────
  // SECURITY B3: Role-based access
  fastify.post('/', {
    preHandler: [fastify.requireRoles(['ADMIN', 'PM', 'HEAD_PM', 'DIRECTOR_GEN'])]
  }, async (request) => {
    const { name, short_name, lat, lng, region, site_type, customer_id, customer_name, address, description, geocode_status } = request.body;

    const { rows: [site] } = await db.query(`
      INSERT INTO sites (name, short_name, lat, lng, region, site_type, customer_id, customer_name, address, description, geocode_status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `, [
      name, short_name || null, lat || null, lng || null, region || null,
      site_type || 'object', customer_id || null, customer_name || null,
      address || null, description || null, geocode_status || 'pending'
    ]);
    return site;
  });

  // ─────────────────────────────────────────────────────────────────
  // PUT /api/sites/:id — update site (including manual coordinate placement)
  // ─────────────────────────────────────────────────────────────────
  fastify.put('/:id', {
    preHandler: [fastify.requireRoles(['ADMIN', 'PM', 'HEAD_PM', 'DIRECTOR_GEN'])]
  }, async (request, reply) => {
    const { id } = request.params;
    const data = request.body;

    const allowedFields = ['name', 'short_name', 'lat', 'lng', 'region', 'site_type',
      'customer_id', 'customer_name', 'address', 'description', 'geocode_status', 'photo_url'];

    const updates = [];
    const values = [];
    let idx = 1;

    for (const key of allowedFields) {
      if (data[key] !== undefined) {
        updates.push(`${key} = $${idx}`);
        values.push(data[key]);
        idx++;
      }
    }

    if (!updates.length) {
      return reply.code(400).send({ error: 'No data to update' });
    }

    updates.push('updated_at = NOW()');
    values.push(id);

    const { rows: [site] } = await db.query(
      `UPDATE sites SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (!site) return reply.code(404).send({ error: 'Site not found' });
    return site;
  });

  // ─────────────────────────────────────────────────────────────────
  // DELETE /api/sites/:id
  // ─────────────────────────────────────────────────────────────────
  fastify.delete('/:id', {
    preHandler: [fastify.requireRoles(['ADMIN'])]
  }, async (request, reply) => {
    const result = await db.query(
      'DELETE FROM sites WHERE id = $1 RETURNING id',
      [request.params.id]
    );
    if (!result.rows[0]) return reply.code(404).send({ error: 'Site not found' });
    return { message: 'Site deleted' };
  });

  // ─────────────────────────────────────────────────────────────────
  // POST /api/sites/geocode — server-side geocoding proxy (Nominatim / OpenStreetMap)
  // No API key required
  // ─────────────────────────────────────────────────────────────────
  fastify.post('/geocode', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { address } = request.body;
    if (!address) return reply.code(400).send({ error: 'Address required' });

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&accept-language=ru`;

    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'AsgardCRM/1.0 (admin@asgard-service.ru)' }
      });
      const data = await resp.json();

      if (data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);
        const displayName = data[0].display_name || '';
        const placeClass = data[0].class || '';
        const placeType = data[0].type || '';

        // Determine confidence based on result type and importance
        const importance = parseFloat(data[0].importance || 0);
        const highConfidence = importance > 0.5 ||
          ['building', 'place', 'amenity'].includes(placeClass) ||
          ['house', 'residential', 'city', 'town', 'village'].includes(placeType);

        // Extract region from display_name (typically second-to-last part)
        const parts = displayName.split(', ');
        const region = parts.length >= 3 ? parts[parts.length - 2] : (parts[1] || '');

        return {
          found: true,
          lat,
          lng,
          precision: highConfidence ? 'exact' : 'other',
          highConfidence,
          displayName,
          region
        };
      }

      return { found: false };
    } catch (err) {
      fastify.log.error('Geocode fetch error:', err.message);
      return { found: false, error: 'Geocoding service unavailable', detail: err.message };
    }
  });
};
