'use strict';

/**
 * Command Map — живая карта директора.
 * Объекты (sites) с активными работами и экипажем, рейсы вахты (field_logistics) и медосмотры.
 * Только чтение, агрегаты. Все запросы параметризованы.
 */

module.exports = async function (fastify, options) {
  const db = fastify.db;

  const MAP_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_PM', 'HEAD_TO'];
  const ACTIVE_STATUSES = ['В работе', 'Мобилизация', 'Подготовка', 'На паузе', 'Подписание акта'];

  // ─────────────────────────────────────────────────────────────────
  // GET /api/command-map — объекты с активными работами + счётчиками экипажа
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/', {
    preHandler: [fastify.requireRoles(MAP_ROLES)]
  }, async (request, reply) => {
    try {
      // объекты с координатами
      const { rows: sites } = await db.query(`
        SELECT s.id, s.name, s.short_name, s.lat, s.lng, s.region, s.site_type,
               s.customer_name, s.address
        FROM sites s
        ORDER BY s.name
        LIMIT 500
      `);
      if (!sites.length) return { sites: [] };

      const siteIds = sites.map(s => s.id);

      // активные работы по объектам
      const { rows: works } = await db.query(`
        SELECT w.id, w.site_id, w.work_title, w.work_status, w.pm_id,
               u.name AS pm_name
        FROM works w
        LEFT JOIN users u ON u.id = w.pm_id
        WHERE w.site_id = ANY($1::int[])
          AND w.work_status = ANY($2)
        ORDER BY w.created_at DESC
      `, [siteIds, ACTIVE_STATUSES]);

      const workIds = works.map(w => w.id);

      // экипаж: счётчики рабочих/мастеров по работе (активные назначения, ещё не убывшие)
      let crewByWork = {};
      if (workIds.length) {
        const { rows: crew } = await db.query(`
          SELECT ea.work_id,
                 COUNT(*) FILTER (WHERE ea.field_role = 'worker') AS workers,
                 COUNT(*) FILTER (WHERE ea.field_role IN ('shift_master','senior_master')) AS masters
          FROM employee_assignments ea
          WHERE ea.work_id = ANY($1::int[])
            AND ea.is_active = true
            AND (ea.departure_date IS NULL OR ea.departure_date > CURRENT_DATE)
          GROUP BY ea.work_id
        `, [workIds]);
        crew.forEach(c => { crewByWork[c.work_id] = { workers: +c.workers, masters: +c.masters }; });
      }

      // на смене сегодня (field_checkins активные за сегодня) по работе
      let onShiftByWork = {};
      if (workIds.length) {
        const { rows: cks } = await db.query(`
          SELECT fc.work_id, COUNT(DISTINCT fc.employee_id) AS on_shift
          FROM field_checkins fc
          WHERE fc.work_id = ANY($1::int[])
            AND fc.date = CURRENT_DATE
            AND fc.status = 'active'
          GROUP BY fc.work_id
        `, [workIds]);
        cks.forEach(c => { onShiftByWork[c.work_id] = +c.on_shift; });
      }

      // собрать ответ
      const worksBySite = {};
      works.forEach(w => {
        const cr = crewByWork[w.id] || { workers: 0, masters: 0 };
        (worksBySite[w.site_id] = worksBySite[w.site_id] || []).push({
          id: w.id, work_title: w.work_title, work_status: w.work_status,
          pm_name: w.pm_name || null,
          workers: cr.workers, masters: cr.masters,
          on_shift: onShiftByWork[w.id] || 0
        });
      });

      const result = sites.map(s => {
        const jobs = worksBySite[s.id] || [];
        const workers = jobs.reduce((a, j) => a + j.workers, 0);
        const masters = jobs.reduce((a, j) => a + j.masters, 0);
        const onShift = jobs.reduce((a, j) => a + j.on_shift, 0);
        return {
          id: s.id, name: s.name, short_name: s.short_name,
          lat: s.lat != null ? Number(s.lat) : null,
          lng: s.lng != null ? Number(s.lng) : null,
          region: s.region, site_type: s.site_type,
          customer_name: s.customer_name, address: s.address,
          works: jobs,
          crew: { workers, masters, onShift }
        };
      });

      return { sites: result };
    } catch (e) {
      request.log.error(e);
      reply.code(500);
      return { error: 'command_map_failed', message: e.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /api/command-map/flights — рейсы вахты (на объект / домой) с датами и временем
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/flights', {
    preHandler: [fastify.requireRoles(MAP_ROLES)]
  }, async (request, reply) => {
    try {
      const TRAVEL_TYPES = ['ticket_to', 'ticket_back', 'flight', 'train', 'transfer'];
      const { rows } = await db.query(`
        SELECT fl.id, fl.item_type, fl.item_subtype, fl.transport_no, fl.title, fl.status,
               fl.date_from, fl.date_to, fl.departure_at, fl.arrival_at,
               fl.employee_id, e.fio AS employee_fio,
               fl.work_id, w.work_title, w.site_id,
               s.name AS site_name, s.lat AS site_lat, s.lng AS site_lng
        FROM field_logistics fl
        LEFT JOIN employees e ON e.id = fl.employee_id
        LEFT JOIN works w ON w.id = fl.work_id
        LEFT JOIN sites s ON s.id = w.site_id
        WHERE fl.item_type = ANY($1)
          AND COALESCE(fl.arrival_at::date, fl.date_to, fl.departure_at::date, fl.date_from, CURRENT_DATE)
              >= CURRENT_DATE - INTERVAL '7 days'
        ORDER BY COALESCE(fl.departure_at, fl.date_from::timestamptz) ASC NULLS LAST
        LIMIT 300
      `, [TRAVEL_TYPES]);

      const flights = rows.map(r => ({
        id: r.id,
        item_type: r.item_type,
        transport_no: r.transport_no || null,
        title: r.title,
        status: r.status,
        dir: r.item_type === 'ticket_back' ? 'home' : 'to',
        departAt: r.departure_at || (r.date_from ? new Date(r.date_from).toISOString() : null),
        arriveAt: r.arrival_at || (r.date_to ? new Date(r.date_to).toISOString() : null),
        employee: r.employee_id ? { id: r.employee_id, fio: r.employee_fio } : null,
        work: r.work_id ? { id: r.work_id, title: r.work_title } : null,
        site: r.site_id ? {
          id: r.site_id, name: r.site_name,
          lat: r.site_lat != null ? Number(r.site_lat) : null,
          lng: r.site_lng != null ? Number(r.site_lng) : null
        } : null
      }));
      return { flights };
    } catch (e) {
      request.log.error(e);
      reply.code(500);
      return { error: 'flights_failed', message: e.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /api/command-map/medical — рабочие на медосмотре (перед вылетом)
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/medical', {
    preHandler: [fastify.requireRoles(MAP_ROLES)]
  }, async (request, reply) => {
    try {
      const { rows } = await db.query(`
        SELECT ts.id, ts.employee_id, e.fio AS employee_fio,
               ts.work_id, w.work_title, w.site_id, s.name AS site_name,
               ts.date_from, ts.date_to, ts.referral_at, ts.status
        FROM field_trip_stages ts
        LEFT JOIN employees e ON e.id = ts.employee_id
        LEFT JOIN works w ON w.id = ts.work_id
        LEFT JOIN sites s ON s.id = w.site_id
        WHERE ts.stage_type = 'medical'
          AND COALESCE(ts.date_to, ts.date_from, CURRENT_DATE) >= CURRENT_DATE - INTERVAL '14 days'
        ORDER BY ts.date_from DESC NULLS LAST
        LIMIT 200
      `);
      const medical = rows.map(r => ({
        id: r.id,
        employee: r.employee_id ? { id: r.employee_id, fio: r.employee_fio } : null,
        site: r.site_id ? { id: r.site_id, name: r.site_name } : null,
        date_from: r.date_from, date_to: r.date_to,
        referral_at: r.referral_at, status: r.status
      }));
      return { medical };
    } catch (e) {
      request.log.error(e);
      reply.code(500);
      return { error: 'medical_failed', message: e.message };
    }
  });
};
