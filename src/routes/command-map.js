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

  // ─────────────────────────────────────────────────────────────────
  // GET /api/command-map/site/:id/crew — экипаж объекта ПОИМЁННО, со статусом (для фигур на карте)
  //   status: 'medical' (медосмотр) → 'transit' (в пути) → 'site' (на смене сегодня) → 'rest' (на объекте, не на смене)
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/site/:id/crew', { preHandler: [fastify.requireRoles(MAP_ROLES)] }, async (request, reply) => {
    try {
      const siteId = parseInt(request.params.id, 10);
      if (!siteId) { reply.code(400); return { error: 'bad_site_id' }; }

      // работы этого объекта
      const { rows: works } = await db.query(
        `SELECT id FROM works WHERE site_id = $1 AND deleted_at IS NULL`, [siteId]);
      const workIds = works.map(w => w.id);
      if (!workIds.length) return { site_id: siteId, crew: [] };

      // активные назначения (ещё не убывшие) + сотрудник
      const { rows: assigns } = await db.query(`
        SELECT ea.employee_id, ea.work_id, ea.field_role,
               e.fio, e.full_name
        FROM employee_assignments ea
        JOIN employees e ON e.id = ea.employee_id
        WHERE ea.work_id = ANY($1::int[])
          AND ea.is_active = true
          AND (ea.departure_date IS NULL OR ea.departure_date > CURRENT_DATE)
      `, [workIds]);
      if (!assigns.length) return { site_id: siteId, crew: [] };

      const empIds = [...new Set(assigns.map(a => a.employee_id))];

      // на смене сегодня (field_checkins активные)
      const { rows: cks } = await db.query(`
        SELECT DISTINCT employee_id FROM field_checkins
        WHERE work_id = ANY($1::int[]) AND date = CURRENT_DATE AND status = 'active'
      `, [workIds]);
      const onShift = new Set(cks.map(r => r.employee_id));

      // активные этапы поездки (медосмотр / транзит) по сотруднику
      const { rows: stages } = await db.query(`
        SELECT employee_id, stage_type FROM field_trip_stages
        WHERE work_id = ANY($1::int[])
          AND COALESCE(status,'') NOT IN ('done','completed','closed','cancelled')
          AND COALESCE(date_to, CURRENT_DATE) >= CURRENT_DATE
      `, [workIds]);
      const stageByEmp = {};
      stages.forEach(s => {
        const t = String(s.stage_type || '').toLowerCase();
        // приоритет medical > transit
        const cur = stageByEmp[s.employee_id];
        if (t.includes('medical') || t.includes('медос')) stageByEmp[s.employee_id] = 'medical';
        else if (!cur && (t.includes('transit') || t.includes('travel') || t.includes('доро') || t.includes('переезд'))) stageByEmp[s.employee_id] = 'transit';
      });

      // собрать: один человек = одна фигура (берём первое назначение)
      const seen = new Set();
      const crew = [];
      assigns.forEach(a => {
        if (seen.has(a.employee_id)) return;
        seen.add(a.employee_id);
        const master = ['shift_master', 'senior_master'].includes(a.field_role);
        let status = stageByEmp[a.employee_id]
          || (onShift.has(a.employee_id) ? 'site' : 'rest');
        crew.push({
          employee_id: a.employee_id,
          name: a.full_name || a.fio || ('Раб. #' + a.employee_id),
          master,
          status
        });
      });

      return { site_id: siteId, crew };
    } catch (e) {
      request.log.error(e);
      reply.code(500);
      return { error: 'site_crew_failed', message: e.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /api/command-map/live — живой офис: кто где сегодня (staff_plan) + онлайн (SSE) + на звонке
  // ─────────────────────────────────────────────────────────────────
  const PRESENCE_LABELS = {
    'оф':'В офисе','уд':'Удалёнка','об':'На объекте','км':'Командировка','пг':'Встреча',
    'уч':'Учёба','ск':'Склад','бн':'Больничный','сс':'За свой счёт','вх':'Выходной'
  };
  fastify.get('/live', { preHandler: [fastify.requireRoles(MAP_ROLES)] }, async (request, reply) => {
    try {
      // онлайн прямо сейчас (из SSE-реестра)
      let onlineIds = [];
      try { onlineIds = require('./sse').getOnlineUserIds() || []; } catch (_) {}
      const onlineSet = new Set(onlineIds.map(Number));

      // отметки за сегодня (staff_plan) + кто на звонке (active_calls)
      const { rows } = await db.query(`
        SELECT u.id AS user_id, u.name, u.role,
               sp.status_code, sp.work_id, w.work_title,
               (SELECT 1 FROM active_calls ac WHERE ac.assigned_user_id = u.id
                  AND ac.call_state = 'connected' LIMIT 1) AS on_call
        FROM users u
        LEFT JOIN staff s ON s.user_id = u.id
        LEFT JOIN staff_plan sp ON sp.staff_id = s.id AND sp.date = CURRENT_DATE
          AND sp.status_code IS NOT NULL AND sp.status_code <> ''
        LEFT JOIN works w ON w.id = sp.work_id
        WHERE u.is_active = true
          AND u.role NOT IN ('FIELD_WORKER','BOT')
          AND COALESCE(u.login,'') NOT LIKE 'test_%'
        ORDER BY u.name
      `);

      // активность (Фаза 3): idle / текущая страница / самоотметка ☕💨🍖 (in-memory)
      let act = {};
      try { act = require('../services/presence-activity').snapshot(rows.map(r => r.user_id)); } catch (_) {}
      const SELF_ACT_LABEL = { coffee: 'кофе-пауза', smoke: 'перекур', lunch: 'обед' };

      const people = rows.map(r => {
        const online = onlineSet.has(Number(r.user_id));
        const a = act[r.user_id] || {};
        const selfAct = a.selfAct || null;        // coffee/smoke/lunch
        const idle = online && a.idle && !r.on_call && !selfAct;
        // что делает (приоритет: самоотметка → на звонке → idle(отошёл) → онлайн+статус → статус дня → офлайн)
        let doing;
        if (selfAct) doing = SELF_ACT_LABEL[selfAct] || selfAct;
        else if (r.on_call) doing = 'на звонке';
        else if (idle) doing = 'отошёл';
        else if (online) doing = r.status_code ? (PRESENCE_LABELS[r.status_code] || r.status_code) : 'в СРМ';
        else doing = r.status_code ? (PRESENCE_LABELS[r.status_code] || r.status_code) : null;
        return {
          user_id: r.user_id, name: r.name, role: r.role,
          online,
          on_call: !!r.on_call,
          idle: !!idle,
          self_act: selfAct,
          page: a.page || null,
          status_code: r.status_code || null,
          status_label: r.status_code ? (PRESENCE_LABELS[r.status_code] || r.status_code) : null,
          work: r.work_id ? { id: r.work_id, title: r.work_title } : null,
          doing
        };
      });

      const summary = {
        total: people.length,
        online: people.filter(p => p.online).length,
        on_call: people.filter(p => p.on_call).length,
        idle: people.filter(p => p.idle).length,
        coffee: people.filter(p => p.self_act).length,
        marked: people.filter(p => p.status_code).length
      };
      return { people, summary, server_ts: Date.now() };
    } catch (e) {
      request.log.error(e);
      reply.code(500);
      return { error: 'live_failed', message: e.message };
    }
  });
};
