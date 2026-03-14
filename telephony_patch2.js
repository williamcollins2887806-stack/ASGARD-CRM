const fs = require('fs');
const FILE = '/var/www/asgard-crm/src/routes/telephony.js';

const ENDPOINTS = `
  // --- Список менеджеров (для фильтра) ---
  fastify.get('/managers', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const res = await db.query(
      \`SELECT u.id, u.name, u.role FROM users u
       WHERE u.is_active = true
       AND u.role IN ('PM','HEAD_PM','TO','HEAD_TO','BUH','PROC','CHIEF_ENGINEER','OFFICE_MANAGER','WAREHOUSE')
       ORDER BY u.name\`
    );
    reply.send({ managers: res.rows });
  });

  // --- Внутренний API для AGI-событий (только localhost) ---
  fastify.post('/internal/agi-event', async (request, reply) => {
    const ip = request.ip;
    if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
      return reply.code(403).send({ error: 'Localhost only' });
    }
    const event = request.body;
    if (!event || !event.type) return reply.code(400).send({ error: 'type required' });

    console.log('[Telephony] AGI event:', event.type, 'caller=' + (event.caller || 'unknown'));
    await logEvent('agi_live', event);

    if (sseBroadcast) {
      sseBroadcast('call:agi_event', event);
    }

    if (event.type === 'call_end' && event.caller) {
      try {
        const normCaller = normalizePhone(event.caller);
        let routeUserId = null;
        if (event.route_to) {
          const normRoute = normalizePhone(event.route_to);
          const u = await db.query(
            \`SELECT user_id FROM user_call_status WHERE replace(replace(fallback_mobile,'+',''),'-','') LIKE $1 LIMIT 1\`,
            ['%' + normRoute.slice(-10)]
          );
          if (u.rows.length) routeUserId = u.rows[0].user_id;
        }

        const sets = [];
        const params = [];
        let pi = 1;
        if (routeUserId) { sets.push('user_id = $' + pi++); params.push(routeUserId); }
        if (event.ai_summary) { sets.push('ai_summary = $' + pi++); params.push(event.ai_summary); }
        if (event.intent) { sets.push('ai_is_target = $' + pi++); params.push(!['spam','unknown','silence'].includes(event.intent)); }
        if (event.collected_data) { sets.push('ai_lead_data = $' + pi++); params.push(JSON.stringify(event.collected_data)); }
        if (event.sentiment) { sets.push('ai_sentiment = $' + pi++); params.push(event.sentiment); }
        if (sets.length > 0) {
          sets.push('updated_at = NOW()');
          params.push('%' + normCaller.slice(-10));
          await db.query(
            'UPDATE call_history SET ' + sets.join(', ') +
            ' WHERE id = (SELECT id FROM call_history WHERE from_number LIKE $' + pi + ' ORDER BY created_at DESC LIMIT 1)',
            params
          );
        }
      } catch (e) {
        console.error('[Telephony] AGI call_end update error:', e.message);
      }
    }

    reply.send({ status: 'ok' });
  });

  // --- Настройки мониторинга звонков ---
  fastify.get('/call-control/settings', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const dispatcher = await db.query(
      \`SELECT ucs.user_id, u.name FROM user_call_status ucs
       JOIN users u ON u.id = ucs.user_id
       WHERE ucs.is_call_dispatcher = true LIMIT 1\`
    );
    const mySettings = await db.query(
      'SELECT receive_call_push, is_call_dispatcher FROM user_call_status WHERE user_id = $1',
      [request.user.id]
    );
    reply.send({
      active_dispatcher: dispatcher.rows.length ? { user_id: dispatcher.rows[0].user_id, name: dispatcher.rows[0].name } : null,
      my_settings: mySettings.rows.length ? mySettings.rows[0] : { receive_call_push: false, is_call_dispatcher: false }
    });
  });

  // --- Активация/деактивация диспетчера ---
  fastify.post('/call-control/toggle-dispatcher', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { enable } = request.body;
    const userId = request.user.id;
    if (enable) {
      const existing = await db.query(
        \`SELECT ucs.user_id, u.name FROM user_call_status ucs
         JOIN users u ON u.id = ucs.user_id
         WHERE ucs.is_call_dispatcher = true AND ucs.user_id != $1\`,
        [userId]
      );
      if (existing.rows.length) {
        return reply.code(409).send({
          error: 'dispatcher_active',
          active_dispatcher: { user_id: existing.rows[0].user_id, name: existing.rows[0].name }
        });
      }
      await db.query(
        \`INSERT INTO user_call_status (user_id, is_call_dispatcher, receive_call_push, updated_at)
         VALUES ($1, true, true, NOW())
         ON CONFLICT (user_id) DO UPDATE SET is_call_dispatcher = true, receive_call_push = true, updated_at = NOW()\`,
        [userId]
      );
    } else {
      await db.query(
        'UPDATE user_call_status SET is_call_dispatcher = false, updated_at = NOW() WHERE user_id = $1',
        [userId]
      );
    }
    reply.send({ status: 'ok', is_dispatcher: !!enable });
  });

  // --- Список сотрудников для перевода ---
  fastify.get('/employees', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const res = await db.query(
      \`SELECT u.id, u.name, u.role, ucs.fallback_mobile
       FROM users u
       LEFT JOIN user_call_status ucs ON ucs.user_id = u.id
       WHERE u.is_active = true AND u.role NOT IN ('ADMIN','HR','HR_MANAGER')
       ORDER BY u.name\`
    );
    reply.send({ employees: res.rows });
  });
`;

let code = fs.readFileSync(FILE, 'utf8');

// Check if already patched
if (code.includes("fastify.get('/managers'")) {
  console.log('Endpoints already exist — skipping');
  process.exit(0);
}

const marker = '//  HEALTH CHECK (public, no auth)';
const markerIdx = code.indexOf(marker);
if (markerIdx === -1) {
  console.error('Cannot find HEALTH CHECK marker');
  process.exit(1);
}

// Find the "// ===" separator line before it
let insertIdx = markerIdx;
const before = code.slice(Math.max(0, markerIdx - 200), markerIdx);
const sepIdx = before.lastIndexOf('// ==');
if (sepIdx !== -1) {
  insertIdx = markerIdx - (before.length - sepIdx);
  insertIdx = code.lastIndexOf('\n', insertIdx);
}

code = code.slice(0, insertIdx) + '\n' + ENDPOINTS + '\n' + code.slice(insertIdx);
fs.writeFileSync(FILE, code);
console.log('Patch 2 applied — new endpoints added before HEALTH CHECK');
