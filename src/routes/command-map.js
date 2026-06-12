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
          AND COALESCE(ts.status, '') NOT IN ('done','completed','closed','cancelled')
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

      // активные назначения (ещё не убывшие) + сотрудник (с РЕАЛЬНЫМ досье).
      // Фильтр тест-аккаунтов: не пускаем «тест/test» на боевую карту директора.
      const { rows: assigns } = await db.query(`
        SELECT ea.employee_id, ea.work_id, ea.field_role, ea.shift_type, ea.date_from, ea.date_to,
               e.fio, e.full_name, e.position, e.qualification_name, e.qualification_grade,
               e.is_self_employed, e.day_rate, e.naks_number, e.naks_expiry,
               e.permits, e.gender, e.phone, e.city, e.rating_avg
        FROM employee_assignments ea
        JOIN employees e ON e.id = ea.employee_id
        WHERE ea.work_id = ANY($1::int[])
          AND ea.is_active = true
          AND COALESCE(e.is_active, true) = true
          AND lower(COALESCE(e.fio,'')) NOT LIKE '%тест%'
          AND lower(COALESCE(e.fio,'')) NOT LIKE '%test%'
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
      // V063 stage_type: medical | travel | waiting | warehouse | day_off | object
      // приоритет: medical > waiting > transit > warehouse > home (day_off) > site (object)
      stages.forEach(s => {
        const t = String(s.stage_type || '').toLowerCase();
        const cur = stageByEmp[s.employee_id];
        let mapped = null;
        if (t === 'medical' || t.includes('медос')) mapped = 'medical';
        else if (t === 'waiting' || t.includes('ожида')) mapped = 'waiting';
        else if (t === 'travel' || t === 'transit' || t.includes('доро') || t.includes('переезд') || t.includes('тран')) mapped = 'transit';
        else if (t === 'warehouse' || t.includes('склад')) mapped = 'warehouse';
        else if (t === 'day_off' || t.includes('выход')) mapped = 'home';
        else if (t === 'object' || t.includes('объект')) mapped = 'site';
        if (!mapped) return;
        // приоритет: medical > waiting > transit > warehouse > home > site
        const PRIO = { medical: 6, waiting: 5, transit: 4, warehouse: 3, home: 2, site: 1 };
        if (!cur || (PRIO[mapped] || 0) > (PRIO[cur] || 0)) stageByEmp[s.employee_id] = mapped;
      });

      // собрать: один человек = одна фигура (берём первое назначение) — с РЕАЛЬНЫМ досье
      const seen = new Set();
      const crew = [];
      assigns.forEach(a => {
        if (seen.has(a.employee_id)) return;
        seen.add(a.employee_id);
        const master = ['shift_master', 'senior_master'].includes(a.field_role);
        let status = stageByEmp[a.employee_id]
          || (onShift.has(a.employee_id) ? 'site' : 'rest');
        // допуска — из e.permits (массив/строка) либо НАКС
        let permits = [];
        if (Array.isArray(a.permits)) permits = a.permits.filter(Boolean);
        else if (typeof a.permits === 'string' && a.permits.trim()) permits = a.permits.split(/[;,]/).map(s => s.trim()).filter(Boolean);
        if (a.naks_number) permits.unshift('НАКС ' + a.naks_number);
        crew.push({
          employee_id: a.employee_id,
          name: a.full_name || a.fio || ('Раб. #' + a.employee_id),
          master,
          status,
          // РЕАЛЬНОЕ досье (нет генерации):
          spec: a.qualification_name || a.position || (master ? 'Бригадир / мастер' : 'Рабочий'),
          grade: a.qualification_grade || null,
          employ: a.is_self_employed ? 'Самозанятый' : 'Штат',
          rate: a.day_rate != null ? Number(a.day_rate) : null,
          permits: permits.slice(0, 8),
          shift: a.shift_type || null,
          city: a.city || null,
          phone: a.phone || null,
          rating: a.rating_avg != null ? Number(a.rating_avg) : null,
          on_shift_today: onShift.has(a.employee_id),
          date_from: a.date_from, date_to: a.date_to
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
  // GET /api/command-map/readiness — дружина «дома»: кто ГОТОВ / НЕ ГОТОВ к выезду (field-рабочие).
  //   archive НЕ показываем. Только реальные сотрудники (без тестовых).
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/readiness', { preHandler: [fastify.requireRoles(MAP_ROLES)] }, async (request, reply) => {
    try {
      const { rows } = await db.query(`
        SELECT e.id, COALESCE(e.full_name, e.fio) AS name,
               e.readiness_status, e.readiness_reason, e.is_self_employed,
               e.qualification_name, e.position, e.city
        FROM employees e
        WHERE e.is_active = true
          AND COALESCE(e.readiness_status,'unknown') IN ('ready','not_ready','unknown')
          AND lower(COALESCE(e.fio,'')) NOT LIKE '%тест%'
          AND lower(COALESCE(e.fio,'')) NOT LIKE '%test%'
          -- не на активном объекте (тех, кто на объекте, рисуем у объекта, не «дома»)
          AND NOT EXISTS (
            SELECT 1 FROM employee_assignments ea
            WHERE ea.employee_id = e.id AND ea.is_active = true
              AND (ea.departure_date IS NULL OR ea.departure_date > CURRENT_DATE)
          )
        ORDER BY e.readiness_status, name
        LIMIT 200
      `);
      const people = rows.map(r => ({
        id: r.id, name: r.name,
        ready: r.readiness_status === 'ready',
        not_ready: r.readiness_status === 'not_ready',
        status: r.readiness_status || 'unknown',
        reason: r.readiness_reason || null,
        employ: r.is_self_employed ? 'Самозанятый' : 'Штат',
        spec: r.qualification_name || r.position || 'Рабочий',
        city: r.city || null
      }));
      const summary = {
        ready: people.filter(p => p.ready).length,
        not_ready: people.filter(p => p.not_ready).length,
        unknown: people.filter(p => p.status === 'unknown').length
      };
      return { people, summary };
    } catch (e) {
      request.log.error(e);
      reply.code(500);
      return { error: 'readiness_failed', message: e.message };
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
          -- тестовые/демо аккаунты на карту НЕ показываем (по логину и по имени)
          AND lower(COALESCE(u.login,'')) !~ '^(test|demo|temp|qa|проба|пробн)'
          AND lower(COALESCE(u.name,'')) NOT LIKE '%тест%'
          AND lower(COALESCE(u.name,'')) NOT LIKE '%test%'
          AND lower(COALESCE(u.name,'')) NOT LIKE '%demo%'
        ORDER BY u.name
      `);

      // активность (Фаза 3): idle / текущая страница / самоотметка ☕💨🍖 (in-memory)
      let act = {};
      try { act = require('../services/presence-activity').snapshot(rows.map(r => r.user_id)); } catch (_) {}
      const SELF_ACT_LABEL = { coffee: 'кофе-пауза', smoke: 'перекур', lunch: 'обед' };

      // idle (отошёл от стола) ИМЕЕТ СМЫСЛ только для тех, кто В ОФИСЕ (статус 'оф' или без статуса).
      // Если человек отметился «на объекте»/«удалёнка»/«командировка»/«выходной»/«больничный» —
      // он НЕ «отошёл от стола», и idle не должен перебивать его реальный статус.
      const OFFICE_PRESENT = new Set(['оф', '', null, undefined]);
      const people = rows.map(r => {
        const online = onlineSet.has(Number(r.user_id));
        const a = act[r.user_id] || {};
        const selfAct = a.selfAct || null;        // coffee/smoke/lunch
        const idleEligible = OFFICE_PRESENT.has(r.status_code);   // только офисное присутствие
        const idle = online && a.idle && idleEligible && !r.on_call && !selfAct;
        // что делает (приоритет: самоотметка → на звонке → реальный статус дня (об/уд/км/...) → idle → онлайн → офлайн)
        let doing;
        if (selfAct) doing = SELF_ACT_LABEL[selfAct] || selfAct;
        else if (r.on_call) doing = 'на звонке';
        else if (r.status_code && r.status_code !== 'оф') doing = (PRESENCE_LABELS[r.status_code] || r.status_code); // об/уд/км/вх/бн/сс — показываем как есть
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

  // ─────────────────────────────────────────────────────────────────
  // GET /api/command-map/worker/:id — ПОЛНАЯ карточка рабочего для drawer.
  // Реальные данные: контакты, рейтинг, специальность, оформление, ставка,
  // последняя/текущая работа, история чекинов (часы/смены/зарплата),
  // активный этап поездки, последний рейс, ожидание (дни без работы).
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/worker/:id', { preHandler: [fastify.requireRoles(MAP_ROLES)] }, async (request, reply) => {
    try {
      const empId = parseInt(request.params.id, 10);
      if (!empId) { reply.code(400); return { error: 'bad_id' }; }

      const { rows: empRows } = await db.query(`
        SELECT e.id, COALESCE(e.full_name, e.fio) AS name, e.fio, e.full_name,
               e.phone, e.email, e.position, e.qualification_name, e.qualification_grade,
               e.is_self_employed, e.day_rate, e.naks_number, e.naks_expiry,
               e.city, e.gender, e.rating_avg, e.is_active,
               e.readiness_status, e.readiness_reason, e.readiness_updated_at,
               e.last_work_id, e.last_pm_id,
               e.permits, e.created_at
        FROM employees e
        WHERE e.id = $1
      `, [empId]);
      if (!empRows.length) { reply.code(404); return { error: 'not_found' }; }
      const e = empRows[0];

      // ТЕКУЩЕЕ активное назначение (если есть) — где работает прямо сейчас
      const { rows: curAssign } = await db.query(`
        SELECT ea.work_id, ea.field_role, ea.shift_type, ea.date_from, ea.date_to,
               w.work_title, w.work_status, s.name AS site_name, s.id AS site_id,
               u.name AS pm_name
        FROM employee_assignments ea
        LEFT JOIN works w ON w.id = ea.work_id
        LEFT JOIN sites s ON s.id = w.site_id
        LEFT JOIN users u ON u.id = w.pm_id
        WHERE ea.employee_id = $1
          AND ea.is_active = true
          AND (ea.departure_date IS NULL OR ea.departure_date > CURRENT_DATE)
        ORDER BY ea.date_from DESC NULLS LAST
        LIMIT 1
      `, [empId]);

      // ПОСЛЕДНИЕ 5 работ из назначений (включая текущую) — для истории
      const { rows: assignHist } = await db.query(`
        SELECT ea.work_id, ea.field_role, ea.shift_type, ea.date_from, ea.date_to,
               ea.departure_date, ea.is_active,
               w.work_title, w.work_status, s.name AS site_name, s.short_name AS site_short
        FROM employee_assignments ea
        LEFT JOIN works w ON w.id = ea.work_id
        LEFT JOIN sites s ON s.id = w.site_id
        WHERE ea.employee_id = $1
        ORDER BY ea.date_from DESC NULLS LAST
        LIMIT 5
      `, [empId]);

      // ПОСЛЕДНИЙ чекин и агрегаты по чекинам (всего часов, всего смен, последняя дата)
      const { rows: ckLast } = await db.query(`
        SELECT fc.date, fc.shift, fc.status, fc.hours_worked, fc.hours_paid,
               fc.amount_earned, fc.day_rate, fc.checkin_at, fc.checkout_at,
               w.work_title, s.name AS site_name
        FROM field_checkins fc
        LEFT JOIN works w ON w.id = fc.work_id
        LEFT JOIN sites s ON s.id = w.site_id
        WHERE fc.employee_id = $1
        ORDER BY fc.date DESC, fc.checkin_at DESC NULLS LAST
        LIMIT 1
      `, [empId]);
      const { rows: ckAgg } = await db.query(`
        SELECT COUNT(*)::int AS shifts,
               COALESCE(SUM(hours_worked), 0)::float AS hours,
               COALESCE(SUM(amount_earned), 0)::float AS earned,
               MAX(date) AS last_date
        FROM field_checkins
        WHERE employee_id = $1 AND status = 'active'
      `, [empId]);

      // АКТИВНЫЙ этап поездки (медосмотр/дорога/ожидание/склад/выходной)
      const { rows: stages } = await db.query(`
        SELECT stage_type, status, date_from, date_to,
               (SELECT s.name FROM works w LEFT JOIN sites s ON s.id=w.site_id WHERE w.id=fts.work_id LIMIT 1) AS site_name
        FROM field_trip_stages fts
        WHERE employee_id = $1
          AND COALESCE(status,'') NOT IN ('done','completed','closed','cancelled')
          AND COALESCE(date_to, CURRENT_DATE) >= CURRENT_DATE
        ORDER BY date_from DESC NULLS LAST
        LIMIT 3
      `, [empId]);

      // ПОСЛЕДНИЙ рейс (билет туда/обратно) — если есть
      const { rows: flightRows } = await db.query(`
        SELECT fl.item_type, fl.transport_no, fl.title, fl.status,
               fl.departure_at, fl.arrival_at, fl.date_from, fl.date_to,
               s.name AS site_name
        FROM field_logistics fl
        LEFT JOIN works w ON w.id = fl.work_id
        LEFT JOIN sites s ON s.id = w.site_id
        WHERE fl.employee_id = $1
          AND fl.item_type = ANY($2)
        ORDER BY COALESCE(fl.departure_at, fl.date_from::timestamptz) DESC NULLS LAST
        LIMIT 1
      `, [empId, ['ticket_to','ticket_back','flight','train','transfer']]);

      // ИМЯ последнего РП (если в employees.last_pm_id есть)
      let lastPm = null;
      if (e.last_pm_id) {
        const { rows: pmRows } = await db.query(
          `SELECT id, name FROM users WHERE id = $1`, [e.last_pm_id]);
        if (pmRows.length) lastPm = pmRows[0];
      }

      // АДЁЖИ (допуска) — массив | строка
      let permits = [];
      if (Array.isArray(e.permits)) permits = e.permits.filter(Boolean);
      else if (typeof e.permits === 'string' && e.permits.trim()) {
        permits = e.permits.split(/[;,]/).map(s => s.trim()).filter(Boolean);
      }
      if (e.naks_number) permits.unshift('НАКС ' + e.naks_number);

      // Ожидание: если нет активного назначения и были прошлые работы —
      // считаем дни от последней `date_to` или последнего чекина
      const cur = curAssign[0] || null;
      const agg = ckAgg[0] || { shifts: 0, hours: 0, earned: 0, last_date: null };
      const lastFinish = cur ? null
        : (agg.last_date || (assignHist[0] && (assignHist[0].departure_date || assignHist[0].date_to)) || null);
      let waitingDays = null;
      if (!cur && lastFinish) {
        const ms = Date.now() - new Date(lastFinish).getTime();
        waitingDays = Math.max(0, Math.floor(ms / 86400000));
      }

      // Длительность ТЕКУЩЕЙ вахты: дни от date_from
      let onShiftDays = null;
      if (cur && cur.date_from) {
        const ms = Date.now() - new Date(cur.date_from).getTime();
        onShiftDays = Math.max(0, Math.floor(ms / 86400000));
      }

      return {
        worker: {
          id: e.id,
          name: e.name || ('Раб. #' + e.id),
          phone: e.phone || null,
          email: e.email || null,
          city: e.city || null,
          spec: e.qualification_name || e.position || 'Рабочий',
          grade: e.qualification_grade || null,
          employ: e.is_self_employed ? 'Самозанятый' : 'Штат',
          rate: e.day_rate != null ? Number(e.day_rate) : null,
          rating: e.rating_avg != null ? Number(e.rating_avg) : null,
          gender: e.gender || null,
          is_active: e.is_active === true,
          permits: permits.slice(0, 10),
          naks_expiry: e.naks_expiry || null,
          readiness: {
            status: e.readiness_status || 'unknown',
            reason: e.readiness_reason || null,
            updated_at: e.readiness_updated_at || null
          },
          created_at: e.created_at
        },
        current: cur ? {
          work_id: cur.work_id, work_title: cur.work_title, work_status: cur.work_status,
          site_id: cur.site_id, site_name: cur.site_name,
          pm_name: cur.pm_name, role: cur.field_role,
          shift: cur.shift_type, date_from: cur.date_from, date_to: cur.date_to,
          days_on_shift: onShiftDays
        } : null,
        history: assignHist.map(h => ({
          work_id: h.work_id, work_title: h.work_title, work_status: h.work_status,
          site_name: h.site_name || h.site_short, role: h.field_role, shift: h.shift_type,
          date_from: h.date_from, date_to: h.date_to,
          departure_date: h.departure_date, is_active: h.is_active
        })),
        last_checkin: ckLast[0] || null,
        stats: {
          total_shifts: agg.shifts || 0,
          total_hours: agg.hours || 0,
          total_earned: agg.earned || 0,
          last_shift_date: agg.last_date || null
        },
        stages: stages.map(s => ({
          stage_type: s.stage_type, status: s.status,
          date_from: s.date_from, date_to: s.date_to,
          site_name: s.site_name
        })),
        last_flight: flightRows[0] || null,
        last_pm: lastPm,
        waiting_days: waitingDays
      };
    } catch (err) {
      request.log.error(err);
      reply.code(500);
      return { error: 'worker_failed', message: err.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /api/command-map/office-user/:id — ПОЛНАЯ карточка офисного сотрудника.
  // Реальные данные: контакты, last_login_at, активность в CRM,
  // что отметил сегодня (staff_plan), последние действия (audit_log),
  // role-specific KPI (PM/PROC/BUH/DIR/WAREHOUSE/HEAD_PM).
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/office-user/:id', { preHandler: [fastify.requireRoles(MAP_ROLES)] }, async (request, reply) => {
    try {
      const uid = parseInt(request.params.id, 10);
      if (!uid) { reply.code(400); return { error: 'bad_id' }; }

      const { rows: uRows } = await db.query(`
        SELECT u.id, u.login, u.name, u.role, u.email, u.phone,
               u.is_active, u.last_login_at, u.employment_date, u.created_at,
               u.birth_date, u.patronymic, u.telegram_chat_id
        FROM users u
        WHERE u.id = $1
      `, [uid]);
      if (!uRows.length) { reply.code(404); return { error: 'not_found' }; }
      const u = uRows[0];

      // staff (должность/отдел из staff если есть)
      const { rows: sRows } = await db.query(`
        SELECT position, department FROM staff WHERE user_id = $1 LIMIT 1
      `, [uid]);
      const s = sRows[0] || {};

      // отметка за сегодня (staff_plan)
      const { rows: planRows } = await db.query(`
        SELECT sp.status_code, sp.work_id, w.work_title, s2.name AS site_name
        FROM staff_plan sp
        LEFT JOIN staff st ON st.id = sp.staff_id
        LEFT JOIN works w ON w.id = sp.work_id
        LEFT JOIN sites s2 ON s2.id = w.site_id
        WHERE st.user_id = $1 AND sp.date = CURRENT_DATE
        ORDER BY sp.id DESC
        LIMIT 1
      `, [uid]);

      // последние действия в CRM (audit_log)
      const { rows: actions } = await db.query(`
        SELECT entity_type, entity_id, action, details, created_at
        FROM audit_log
        WHERE actor_user_id = $1
        ORDER BY id DESC
        LIMIT 8
      `, [uid]);

      // снимок presence-activity (idle, текущая страница, самоотметка)
      let act = {};
      try { act = require('../services/presence-activity').snapshot([uid]); } catch (_) {}
      const pa = act[uid] || { idle: false, page: null, selfAct: null, lastSeen: null };

      // онлайн (SSE)
      let onlineSet = new Set();
      try {
        const ids = require('./sse').getOnlineUserIds() || [];
        onlineSet = new Set(ids.map(Number));
      } catch (_) {}

      // непрочитанные уведомления
      const { rows: nUnreadRows } = await db.query(`
        SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND is_read = false
      `, [uid]);
      const unread = (nUnreadRows[0] && nUnreadRows[0].n) || 0;

      // ─── role-specific KPI ───
      const role = String(u.role || '').toUpperCase();
      const kpi = {};

      // PM / HEAD_PM — мои работы
      if (role === 'PM' || role === 'HEAD_PM') {
        const { rows } = await db.query(`
          SELECT
            COUNT(*) FILTER (WHERE work_status = 'В работе')::int  AS in_work,
            COUNT(*) FILTER (WHERE work_status = 'Подготовка')::int AS prep,
            COUNT(*) FILTER (WHERE work_status = 'Мобилизация')::int AS mob,
            COUNT(*) FILTER (WHERE work_status = 'Подписание акта')::int AS signing,
            COUNT(*) FILTER (WHERE work_status = 'На паузе')::int AS paused
          FROM works WHERE pm_id = $1 AND deleted_at IS NULL
        `, [uid]);
        kpi.pm_works = rows[0] || {};
        const { rows: near } = await db.query(`
          SELECT id, work_title, work_status, end_date
          FROM works
          WHERE pm_id = $1 AND deleted_at IS NULL
            AND work_status IN ('В работе','Мобилизация','Подготовка')
            AND end_date IS NOT NULL
          ORDER BY end_date ASC NULLS LAST
          LIMIT 3
        `, [uid]);
        kpi.near_deadlines = near;
      }

      // PROC — открытые заявки закупки
      if (role === 'PROC') {
        const { rows } = await db.query(`
          SELECT status, COUNT(*)::int AS n
          FROM procurement_requests
          WHERE status NOT IN ('closed','dir_rejected','cancelled')
          GROUP BY status
          ORDER BY n DESC
        `);
        kpi.procurement_by_status = rows;
      }

      // BUH — открытые счета/акты
      if (role === 'BUH') {
        try {
          const { rows: inv } = await db.query(`
            SELECT COUNT(*) FILTER (WHERE status IN ('pending','sent'))::int AS pending
            FROM invoices WHERE deleted_at IS NULL
          `);
          kpi.invoices = inv[0] || { pending: 0 };
        } catch (_) {}
      }

      // DIRECTOR — pending согласования из notifications
      if (role.startsWith('DIRECTOR')) {
        try {
          const { rows } = await db.query(`
            SELECT type, COUNT(*)::int AS n
            FROM notifications
            WHERE user_id = $1 AND is_read = false
              AND type IN ('procurement_dir_approve','estimate_approve','tender_approve','contract_approve')
            GROUP BY type
          `, [uid]);
          kpi.pending_approvals = rows;
        } catch (_) {}
      }

      // WAREHOUSE — входящие/исходящие
      if (role === 'WAREHOUSE') {
        try {
          const { rows: inc } = await db.query(`
            SELECT COUNT(*)::int AS pending
            FROM procurement_requests
            WHERE status IN ('paid','partially_delivered')
          `);
          kpi.incoming_pending = (inc[0] && inc[0].pending) || 0;
        } catch (_) {}
      }

      return {
        user: {
          id: u.id, name: u.name, login: u.login, role: u.role,
          email: u.email || null, phone: u.phone || null,
          is_active: u.is_active === true,
          last_login_at: u.last_login_at,
          employment_date: u.employment_date,
          position: s.position || null,
          department: s.department || null,
          telegram: !!u.telegram_chat_id
        },
        presence: {
          online: onlineSet.has(uid),
          idle: !!pa.idle,
          self_act: pa.selfAct || null,
          current_page: pa.page || null,
          last_heartbeat: pa.lastSeen ? new Date(pa.lastSeen).toISOString() : null
        },
        today: planRows[0] ? {
          status_code: planRows[0].status_code,
          work: planRows[0].work_id ? {
            id: planRows[0].work_id, title: planRows[0].work_title, site: planRows[0].site_name
          } : null
        } : null,
        unread_notifications: unread,
        recent_actions: actions.map(a => ({
          entity_type: a.entity_type, entity_id: a.entity_id,
          action: a.action, details: a.details,
          at: a.created_at
        })),
        kpi
      };
    } catch (err) {
      request.log.error(err);
      reply.code(500);
      return { error: 'office_user_failed', message: err.message };
    }
  });
};
