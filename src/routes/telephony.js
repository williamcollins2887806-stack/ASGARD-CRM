'use strict';

const MangoService = require('../services/mango');
const { normalizePhone, getCallDirection } = require('../services/mango');
const CallPipeline = require('../services/call-pipeline');
const createNotification = require('../services/notify');
const https = require('https');

// Роли с доступом к телефонии
const TEL_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'BUH'];
const TEL_ADMIN_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM'];
// ── Webhook Rate Limiter ──
const _webhookRateMap = new Map();
const WEBHOOK_RATE_LIMIT = 100;  // max requests per window
const WEBHOOK_RATE_WINDOW = 60000; // 1 minute window

function checkWebhookRate(ip) {
  const now = Date.now();
  const entry = _webhookRateMap.get(ip);
  if (!entry || now - entry.start > WEBHOOK_RATE_WINDOW) {
    _webhookRateMap.set(ip, { start: now, count: 1 });
    return true;
  }
  entry.count++;
  if (entry.count > WEBHOOK_RATE_LIMIT) return false;
  return true;
}

// Clean up rate limiter every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of _webhookRateMap) {
    if (now - entry.start > WEBHOOK_RATE_WINDOW * 2) _webhookRateMap.delete(ip);
  }
}, 300000);

// ── Stats Cache ──
const _statsCache = new Map();
const STATS_CACHE_TTL = 120000; // 2 minutes

function getCachedStats(key) {
  const entry = _statsCache.get(key);
  if (entry && Date.now() - entry.ts < STATS_CACHE_TTL) return entry.data;
  return null;
}

function setCachedStats(key, data) {
  _statsCache.set(key, { data, ts: Date.now() });
}


module.exports = async function telephonyRoutes(fastify, opts) {
  const db = fastify.db;
  // Mango Office sends webhooks as application/x-www-form-urlencoded
  fastify.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, function (req, body, done) {
    try {
      const parsed = Object.fromEntries(new URLSearchParams(body));
      done(null, parsed);
    } catch (e) {
      done(e);
    }
  });
  const mango = new MangoService();
  let pipeline = null;

  // Ленивая инициализация pipeline (нужен ai-provider)
  function getPipeline() {
    if (!pipeline) {
      try {
        const aiProvider = require('../services/ai-provider');
        pipeline = new CallPipeline(db, aiProvider, createNotification);
      } catch (e) {
        console.error('[Telephony] Failed to init pipeline:', e.message);
      }
    }
    return pipeline;
  }

  // SSE helper
  let sseSendToUser = null;
  let sseBroadcast = null;
  let _agiSseCache = null;
  let _agiSseCacheTime = 0;
  try {
    const sse = require('./sse');
    sseSendToUser = sse.sendToUser;
    sseBroadcast = sse.broadcast;
  } catch (e) { /* SSE not available */ }

  // ── GET /status — сводка состояния телефонии для мобильного виджета ──
  fastify.get('/status', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const configured = mango.isConfigured();
    if (!configured) {
      return { connected: false, status: 'not_configured' };
    }

    try {
      const missedRes = await db.query(
        `SELECT COUNT(*)::int AS cnt FROM calls
         WHERE direction = 'inbound' AND status = 'missed'
           AND acknowledged_at IS NULL AND created_at >= NOW() - INTERVAL '24 hours'`
      );
      const lastCallRes = await db.query(
        `SELECT created_at FROM calls ORDER BY created_at DESC LIMIT 1`
      );

      return {
        connected: true,
        status: 'online',
        last_call: lastCallRes.rows[0]?.created_at || null,
        missed_count: missedRes.rows[0]?.cnt || 0
      };
    } catch (e) {
      return { connected: true, status: 'online', last_call: null, missed_count: 0 };
    }
  });

  // ========================================
  //  WEBHOOK ENDPOINTS (публичные, без JWT)
  // ========================================

  // Проверка подписи Mango
  function verifyMangoSignature(request, reply) {
    if (!mango.isConfigured()) {
      reply.code(503).send({ error: 'Telephony not configured' });
      return false;
    }
    const { vpbx_api_key, sign, json } = request.body || {};
    if (!vpbx_api_key || !sign || !json) {
      reply.code(400).send({ error: 'Missing required fields' });
      return false;
    }
    try {
      if (!mango.verifyWebhook(vpbx_api_key, sign, json)) {
        reply.code(403).send({ error: 'Invalid signature' });
        return false;
      }
    } catch (e) {
      reply.code(403).send({ error: 'Signature verification failed' });
      return false;
    }
    return true;
  }

  // Логирование события
  async function logEvent(eventType, payload) {
    try {
      await db.query(
        'INSERT INTO telephony_events_log (event_type, mango_call_id, mango_entry_id, payload) VALUES ($1, $2, $3, $4)',
        [eventType, payload.call_id || null, payload.entry_id || null, JSON.stringify(payload)]
      );
    } catch (e) {
      console.error('[Telephony] Event log error:', e.message);
    }
  }

  // --- events/call ---
  fastify.post('/webhook/events/call', {
    config: { rawBody: true }
  }, async (request, reply) => {
    if (!checkWebhookRate(request.ip)) {
      return reply.code(429).send({ error: 'Too many requests' });
    }
    if (!verifyMangoSignature(request, reply)) return;

    const event = typeof request.body.json === "string" ? JSON.parse(request.body.json) : request.body.json;
    await logEvent('call', event);

    const callState = event.call_state;
    const location = event.location;
    const callId = event.call_id;
    const entryId = event.entry_id;
    const fromNumber = event.from && event.from.number;
    const toNumber = event.to && event.to.number;
    const toExtension = event.to && event.to.extension;

    console.log(`[Telephony] Call event: state=${callState} location=${location} from=${fromNumber} to=${toNumber}`);

    // Входящий звонок — появился у сотрудника (ringing)
    if (callState === 'Appeared' && location === 'abonent') {
      // Ищем пользователя по extension
      const userRes = await db.query(
        'SELECT ucs.user_id, u.name, u.role FROM user_call_status ucs JOIN users u ON u.id = ucs.user_id WHERE ucs.mango_extension = $1',
        [toExtension]
      );
      const assignedUserId = userRes.rows.length ? userRes.rows[0].user_id : null;
      const assignedUserName = userRes.rows.length ? userRes.rows[0].name : null;

      // Ищем клиента
      const normalized = normalizePhone(fromNumber);
      const customerRes = await db.query(
        'SELECT inn, name, contact_person FROM customers WHERE phone LIKE $1 OR phone LIKE $2 LIMIT 1',
        ['%' + (fromNumber || '').slice(-10), '%' + normalized.slice(-10)]
      );
      const client = customerRes.rows[0] || null;

      // Создаём/обновляем active_calls
      await db.query(
        `INSERT INTO active_calls (mango_call_id, mango_entry_id, direction, from_number, to_number,
          caller_name, caller_company, client_inn, assigned_user_id, call_state, started_at)
        VALUES ($1,$2,'inbound',$3,$4,$5,$6,$7,$8,'ringing',NOW())
        ON CONFLICT (mango_call_id) DO UPDATE SET
          call_state = 'ringing', assigned_user_id = $8`,
        [
          callId, entryId, fromNumber, toNumber,
          client ? client.contact_person : null,
          client ? client.name : null,
          client ? client.inn : null,
          assignedUserId
        ]
      );

      // SSE уведомление менеджеру
      if (sseSendToUser && assignedUserId) {
        sseSendToUser(assignedUserId, 'call:incoming', {
          callId,
          entryId,
          fromNumber,
          toNumber,
          clientName: client ? (client.contact_person || client.name) : null,
          clientCompany: client ? client.name : null,
          clientInn: client ? client.inn : null,
          responsibleManager: assignedUserName,
          timestamp: event.timestamp
        });
      }

      // DaData обогащение (async — не блокируем ответ)
      if (fromNumber) {
        setImmediate(() => enrichPhoneData(fromNumber, callId).catch(e =>
          console.error('[Telephony] DaData enrichment error:', e.message)
        ));
      }
    }

    // Звонок принят
    if (callState === 'Connected') {
      await db.query(
        "UPDATE active_calls SET call_state = 'connected', connected_at = NOW() WHERE mango_call_id = $1",
        [callId]
      );

      // Запускаем запись звонка через Mango API
      if (mango.isConfigured()) {
        mango.startRecording(callId, fromNumber).then(() => {
          console.log('[Telephony] Recording started for call ' + callId);
        }).catch(e => {
          console.warn('[Telephony] startRecording failed:', e.message);
        });
      }

      const ac = await db.query('SELECT assigned_user_id FROM active_calls WHERE mango_call_id = $1', [callId]);
      if (sseSendToUser && ac.rows.length && ac.rows[0].assigned_user_id) {
        sseSendToUser(ac.rows[0].assigned_user_id, 'call:connected', { callId });
      }
    }

    // Звонок завершён
    if (callState === 'Disconnected') {
      await db.query("DELETE FROM active_calls WHERE mango_call_id = $1", [callId]);

      const ac = await db.query('SELECT assigned_user_id FROM active_calls WHERE mango_call_id = $1', [callId]);
      if (sseSendToUser && ac.rows.length && ac.rows[0].assigned_user_id) {
        sseSendToUser(ac.rows[0].assigned_user_id, 'call:ended', { callId });
      } else if (sseBroadcast) {
        sseBroadcast('call:ended', { callId });
      }
    }

    reply.send({ status: 'ok' });
  });

  // --- events/summary ---
  fastify.post('/webhook/events/summary', {
    config: { rawBody: true }
  }, async (request, reply) => {
    if (!checkWebhookRate(request.ip)) {
      return reply.code(429).send({ error: 'Too many requests' });
    }
    if (!verifyMangoSignature(request, reply)) return;

    const event = typeof request.body.json === "string" ? JSON.parse(request.body.json) : request.body.json;
    await logEvent('summary', event);

    const entryId = event.entry_id;
    const direction = getCallDirection(event.call_direction);
    const fromNum = event.from && (event.from.number || event.from.extension);
    const toNum = event.to && (event.to.number || event.to.extension);
    const rawTalkTime = parseInt(event.talk_time || '0', 10);
    const rawEndTime = parseInt(event.end_time || '0', 10);
    const talkTime = (rawTalkTime > 1000000000 && rawEndTime > 1000000000) ? (rawEndTime - rawTalkTime) : rawTalkTime;
    const createTime = event.create_time ? new Date(parseInt(event.create_time, 10) * 1000) : new Date();
    const endTime = event.end_time ? new Date(parseInt(event.end_time, 10) * 1000) : new Date();
    const recordingId = event.recording_id || null;
    const lineNumber = event.line_number || null;
    const disconnectReason = event.disconnect_reason || null;

    // Определяем тип
    let callType = direction;
    if (direction === 'inbound' && talkTime === 0) {
      callType = 'missed';
    }

    // Ищем пользователя по extension
    const ext = direction === 'inbound' ? (event.to && event.to.extension) : (event.from && event.from.extension);
    let userId = null;
    if (ext) {
      const u = await db.query('SELECT user_id FROM user_call_status WHERE mango_extension = $1', [ext]);
      if (u.rows.length) userId = u.rows[0].user_id;
    }

    // Fallback: ищем по номеру телефона (для переводов через SIP-транк на мобильный)
    if (!userId) {
      const managerNumber = direction === 'inbound' ? toNum : fromNum;
      if (managerNumber) {
        const normMgr = normalizePhone(managerNumber);
        const phoneSearch = await db.query(
          `SELECT user_id FROM user_call_status WHERE replace(replace(fallback_mobile, '+', ''), '-', '') LIKE $1 LIMIT 1`,
          ['%' + normMgr.slice(-10)]
        );
        if (phoneSearch.rows.length) userId = phoneSearch.rows[0].user_id;
      }
    }

    // Fallback 2: check AGI log for matching call
    if (!userId) {
      try {
        const agiLog = await db.query(
          `SELECT payload FROM telephony_events_log
           WHERE event_type = 'agi_call'
           AND created_at >= NOW() - interval '10 minutes'
           AND payload::text LIKE $1
           ORDER BY created_at DESC LIMIT 1`,
          ['%' + (fromNum || '').slice(-10) + '%']
        );
        if (agiLog.rows.length) {
          const agiPayload = typeof agiLog.rows[0].payload === 'string' ? JSON.parse(agiLog.rows[0].payload) : agiLog.rows[0].payload;
          if (agiPayload.route_to) {
            const routeNorm = normalizePhone(agiPayload.route_to);
            const u2 = await db.query(
              `SELECT user_id FROM user_call_status WHERE replace(replace(fallback_mobile, '+', ''), '-', '') LIKE $1 LIMIT 1`,
              ['%' + routeNorm.slice(-10)]
            );
            if (u2.rows.length) userId = u2.rows[0].user_id;
          }
        }
      } catch (e) { /* non-critical */ }
    }


    // Ищем клиента
    const clientNumber = direction === 'inbound' ? fromNum : toNum;
    const normalized = normalizePhone(clientNumber);
    let clientInn = null;
    const cust = await db.query(
      'SELECT inn FROM customers WHERE phone LIKE $1 OR phone LIKE $2 LIMIT 1',
      ['%' + (clientNumber || '').slice(-10), '%' + normalized.slice(-10)]
    );
    if (cust.rows.length) clientInn = cust.rows[0].inn;

    // Upsert в call_history
    const existing = await db.query(
      'SELECT id FROM call_history WHERE mango_entry_id = $1',
      [entryId]
    );

    let callHistoryId;

    if (existing.rows.length) {
      callHistoryId = existing.rows[0].id;
      await db.query(
        `UPDATE call_history SET
          direction = $1, call_type = $2, from_number = $3, to_number = $4,
          duration = $5, duration_seconds = $5, started_at = $6, ended_at = $7,
          recording_id = $8, user_id = $9, client_inn = $10,
          line_number = $11, disconnect_reason = $12,
          webhook_payload = $13, updated_at = NOW()
        WHERE id = $14`,
        [direction, callType, fromNum, toNum, talkTime, createTime, endTime,
         recordingId, userId, clientInn, lineNumber, disconnectReason,
         JSON.stringify(event), callHistoryId]
      );
    } else {
      const callIdStr = entryId || ('gen_' + Date.now());
      const res = await db.query(
        `INSERT INTO call_history (
          call_id, mango_entry_id, direction, call_type,
          caller_number, called_number, from_number, to_number,
          duration, duration_seconds, started_at, ended_at, timestamp,
          recording_id, user_id, client_inn, customer_id,
          line_number, disconnect_reason, status, webhook_payload, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW())
        RETURNING id`,
        [callIdStr, entryId, direction, callType,
         fromNum, toNum, fromNum, toNum,
         talkTime, talkTime, createTime, endTime, createTime,
         recordingId, userId, clientInn, clientInn,
         lineNumber, disconnectReason, callType === 'missed' ? 'missed' : 'completed',
         JSON.stringify(event)]
      );
      callHistoryId = res.rows[0].id;
    }

    // Удаляем из active_calls
    if (event.call_id) {
      await db.query("DELETE FROM active_calls WHERE mango_entry_id = $1", [entryId]).catch(() => {});
    }

    // Обработка пропущенных
    if (callType === 'missed') {
      const p = getPipeline();
      if (p) {
        setImmediate(() => p.handleMissedCall(callHistoryId).catch(e =>
          console.error('[Telephony] Missed call handling error:', e.message)
        ));
      }
    }

    // DaData enrichment
    const clientNum = direction === "inbound" ? fromNum : toNum;
    if (clientNum) {
      setImmediate(() => enrichPhoneData(clientNum, callHistoryId).catch(e =>
        console.error("[Telephony] DaData enrichment error:", e.message)
      ));
    }

    // Обновляем last_call_at пользователя
    if (userId) {
      await db.query('UPDATE user_call_status SET last_call_at = NOW(), updated_at = NOW() WHERE user_id = $1', [userId]).catch(() => {});
    }

    reply.send({ status: 'ok' });
  });

  // --- events/recording ---
  fastify.post('/webhook/events/recording', {
    config: { rawBody: true }
  }, async (request, reply) => {
    if (!checkWebhookRate(request.ip)) {
      return reply.code(429).send({ error: 'Too many requests' });
    }
    if (!verifyMangoSignature(request, reply)) return;

    const event = typeof request.body.json === "string" ? JSON.parse(request.body.json) : request.body.json;
    await logEvent('recording', event);

    const recordingId = event.recording_id;
    const completionCode = event.completion_code;

    if (completionCode === '1000' || completionCode === 1000) {
      // Находим звонок по recording_id
      const call = await db.query(
        'SELECT id FROM call_history WHERE recording_id = $1',
        [recordingId]
      );

      if (call.rows.length) {
        const p = getPipeline();
        if (p) {
          setImmediate(() => p.processCall(call.rows[0].id).catch(e =>
            console.error('[Telephony] Pipeline error:', e.message)
          ));
        }
      }
    }

    reply.send({ status: 'ok' });
  });

  // --- events/dtmf ---
  fastify.post('/webhook/events/dtmf', {
    config: { rawBody: true }
  }, async (request, reply) => {
    if (!checkWebhookRate(request.ip)) {
      return reply.code(429).send({ error: 'Too many requests' });
    }
    if (!verifyMangoSignature(request, reply)) return;
    const event = typeof request.body.json === "string" ? JSON.parse(request.body.json) : request.body.json;
    await logEvent('dtmf', event);
    reply.send({ status: 'ok' });
  });

  // --- ping ---
  fastify.post('/webhook/ping', async (request, reply) => {
    if (!checkWebhookRate(request.ip)) {
      return reply.code(429).send({ error: 'Too many requests' });
    }
    reply.send({ status: 'ok' });
  });

  // ========================================
  //  PROTECTED API ENDPOINTS
  // ========================================

  // --- DIAGNOSTIC: test endpoint ---
  fastify.get('/ping', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    reply.send({ ok: true, ts: Date.now(), user: request.user.id });
  });

  // --- Журнал звонков ---
  fastify.get('/calls', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    const {
      date_from, date_to,
      direction, call_type, user_id: filterUserId,
      client_inn, has_transcript, is_target, search, sort = 'created_at', order = 'desc'
    } = request.query;

    const page = Math.max(1, parseInt(request.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(request.query.limit) || 20));
    const offset = (page - 1) * limit;
    const params = [];
    const conditions = [];
    let paramIdx = 1;

    // Менеджеры видят только свои звонки, руководство — все
    if (!TEL_ADMIN_ROLES.includes(user.role) && user.role !== 'HEAD_PM') {
      conditions.push(`ch.user_id = $${paramIdx++}`);
      params.push(user.id);
    }

    if (date_from) { conditions.push(`ch.created_at >= $${paramIdx++}`); params.push(date_from); }
    if (date_to) { conditions.push(`ch.created_at <= $${paramIdx++}`); params.push(date_to + 'T23:59:59'); }
    if (direction) { conditions.push(`ch.direction = $${paramIdx++}`); params.push(direction); }
    if (call_type) { conditions.push(`ch.call_type = $${paramIdx++}`); params.push(call_type); }
    if (filterUserId) { conditions.push(`ch.user_id = $${paramIdx++}`); params.push(parseInt(filterUserId)); }
    if (client_inn) { conditions.push(`ch.client_inn = $${paramIdx++}`); params.push(client_inn); }
    if (has_transcript === 'true') { conditions.push("ch.transcript_status = 'done'"); }
    if (is_target === 'true') { conditions.push('ch.ai_is_target = true'); }
    if (is_target === 'false') { conditions.push('(ch.ai_is_target = false OR ch.ai_is_target IS NULL)'); }
    if (search) {
      conditions.push(`(ch.from_number ILIKE $${paramIdx} OR ch.to_number ILIKE $${paramIdx} OR ch.caller_number ILIKE $${paramIdx} OR c.name ILIKE $${paramIdx} OR c.contact_person ILIKE $${paramIdx})`);
      params.push('%' + search + '%');
      paramIdx++;
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const allowedSort = ['created_at', 'duration_seconds', 'call_type'];
    const sortCol = allowedSort.includes(sort) ? sort : 'created_at';
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

    const countRes = await db.query(
      `SELECT COUNT(*) FROM call_history ch LEFT JOIN customers c ON c.inn = ch.client_inn ${where}`,
      params
    );
    const total = parseInt(countRes.rows[0].count);

    const rows = await db.query(
      `SELECT ch.*, c.name as client_name, c.contact_person as client_contact, u.name as manager_name
       FROM call_history ch
       LEFT JOIN customers c ON c.inn = ch.client_inn
       LEFT JOIN users u ON u.id = ch.user_id
       ${where}
       ORDER BY ch.${sortCol} ${sortOrder}
       LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      [...params, limit, offset]
    );

    reply.send({
      items: rows.rows.map(r => ({
        ...r,
        transcript: undefined, // Не отправляем полный транскрипт в списке
        webhook_payload: undefined,
        transcript_preview: r.transcript ? r.transcript.slice(0, 150) + '...' : null
      })),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    });
  });

  // --- Детали звонка ---
  fastify.get('/calls/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const id = parseInt(request.params.id);
    if (!id || id < 1 || isNaN(id)) return reply.code(400).send({ error: 'Invalid call ID' });
    const res = await db.query(
      `SELECT ch.*, c.name as client_name, c.contact_person as client_contact,
        c.phone as client_phone, c.email as client_email,
        u.name as manager_name, t.tender_title as lead_title, t.status as lead_status
       FROM call_history ch
       LEFT JOIN customers c ON c.inn = ch.client_inn
       LEFT JOIN users u ON u.id = ch.user_id
       LEFT JOIN tenders t ON t.id = ch.lead_id
       WHERE ch.id = $1`,
      [id]
    );

    if (!res.rows.length) {
      return reply.code(404).send({ error: 'Call not found' });
    }

    const call = res.rows[0];
    delete call.webhook_payload; // Не отдаём сырые данные клиенту

    reply.send(call);
  });

  // --- Аудиозапись ---
  fastify.get('/calls/:id/record', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const res = await db.query('SELECT record_path, recording_id FROM call_history WHERE id = $1', [id]);
    if (!res.rows.length) return reply.code(404).send({ error: 'Call not found' });

    const call = res.rows[0];

    // Если файл есть локально
    if (call.record_path) {
      const fs = require('fs');
      if (fs.existsSync(call.record_path)) {
        const stat = fs.statSync(call.record_path);
        const ext = call.record_path.split('.').pop();
        const mimeType = ext === 'wav' ? 'audio/wav' : ext === 'ogg' ? 'audio/ogg' : 'audio/mpeg';

        // Поддержка Range requests для seek
        const range = request.headers.range;
        if (range) {
          const parts = range.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
          const chunkSize = end - start + 1;

          reply.code(206).headers({
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            'Content-Type': mimeType
          });
          return reply.send(fs.createReadStream(call.record_path, { start, end }));
        }

        reply.headers({
          'Content-Type': mimeType,
          'Content-Length': stat.size,
          'Accept-Ranges': 'bytes',
          'Content-Disposition': `inline; filename="call_${id}.${ext}"`
        });
        return reply.send(fs.createReadStream(call.record_path));
      }
    }

    // Если нет локально — проксируем из Mango
    if (call.recording_id && mango.isConfigured()) {
      try {
        const linkRes = await mango.getRecordingLink(call.recording_id, 600);
        if (linkRes.recording) {
          return reply.redirect(302, linkRes.recording);
        }
      } catch (e) {
        console.error('[Telephony] Recording proxy error:', e.message);
      }
    }

    reply.code(404).send({ error: 'Recording not available' });
  });

  // --- Перезапуск транскрибации ---
  fastify.post('/calls/:id/transcribe', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const callId = parseInt(request.params.id);
    if (!callId || callId < 1) return reply.code(400).send({ error: 'Invalid call ID' });
    const call = (await db.query('SELECT id,record_path,recording_id FROM call_history WHERE id=',[callId])).rows[0];
    if (!call) return reply.code(404).send({ error: 'Call not found' });
    const { getSpeechKitService } = require('../services/speechkit');
    if (!getSpeechKitService().isConfigured()) return reply.code(503).send({ error: 'Транскрибация недоступна — настройте API ключ' });
    if (!call.record_path && !call.recording_id) return reply.code(400).send({ error: 'Нет записи для транскрибации' });
    await db.query("UPDATE call_history SET transcript_status='none',transcript=NULL,transcript_segments=NULL,updated_at=NOW() WHERE id=", [callId]);
    const p = getPipeline();
    if (p) setImmediate(() => p.processCall(callId).catch(e => console.error('[Telephony] Transcribe err:',e.message)));
    reply.send({ status: 'queued', message: 'Транскрибация запущена' });
  });

  // --- Перезапуск ИИ-анализа ---
  fastify.post('/calls/:id/analyze', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const callId = parseInt(request.params.id);
    if (!callId || callId < 1) return reply.code(400).send({ error: 'Invalid call ID' });
    const call = (await db.query('SELECT id,transcript,transcript_status FROM call_history WHERE id=',[callId])).rows[0];
    if (!call) return reply.code(404).send({ error: 'Call not found' });
    if (!call.transcript || call.transcript_status !== 'done') return reply.code(400).send({ error: 'Транскрипт не готов' });
    await db.query("UPDATE call_history SET ai_summary=NULL,ai_is_target=NULL,ai_lead_data=NULL,ai_sentiment=NULL,updated_at=NOW() WHERE id=", [callId]);
    const p = getPipeline();
    if (p) setImmediate(() => p.processCall(callId).catch(e => console.error('[Telephony] Analyze err:',e.message)));
    reply.send({ status: 'queued', message: 'ИИ-анализ запущен' });
  });

  // --- Создать заявку из звонка ---
  fastify.post('/calls/:id/create-lead', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const call = (await db.query('SELECT * FROM call_history WHERE id = $1', [id])).rows[0];
    if (!call) return reply.code(404).send({ error: 'Call not found' });
    if (call.lead_id) return reply.code(400).send({ error: 'Lead already exists', lead_id: call.lead_id });

    const analysis = call.ai_lead_data ? (typeof call.ai_lead_data === 'string' ? JSON.parse(call.ai_lead_data) : call.ai_lead_data) : {};
    const overrides = request.body || {};

    // Мержим ИИ-данные с пользовательскими правками
    const merged = { ...analysis, ...overrides };
    merged.is_target = true;

    const p = getPipeline();
    if (p) {
      const leadId = await p.analyzer.createDraftLead(merged, parseInt(id), request.user.id);
      if (leadId) {
        return reply.send({ lead_id: leadId });
      }
    }
    reply.code(500).send({ error: 'Failed to create lead' });
  });

  // --- Исходящий звонок (Click-to-Call) ---
  fastify.post('/call/start', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!mango.isConfigured()) {
      return reply.code(503).send({ success: false, error: 'Телефония не настроена. Обратитесь к администратору.' });
    }

    const { to_number, from_extension, line_number } = request.body || {};
    if (!to_number) {
      return reply.code(400).send({ success: false, error: 'Не указан номер для звонка' });
    }

    const cleanNumber = normalizePhone(to_number);
    if (!cleanNumber || cleanNumber.replace(/[^\d]/g, '').length < 6) {
      return reply.code(400).send({ success: false, error: 'Некорректный номер телефона' });
    }

    const ucs = await db.query('SELECT mango_extension, fallback_mobile FROM user_call_status WHERE user_id = $1', [request.user.id]);
    const userExt = ucs.rows.length ? ucs.rows[0].mango_extension : null;
    const ext = from_extension || userExt;

    if (!ext) {
      return reply.code(400).send({ success: false, error: 'У вас не настроен внутренний номер (extension) в Mango Office. Обратитесь к администратору.' });
    }

    const commandId = 'crm_cb_' + request.user.id + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

    let clientInn = null;
    let clientName = null;
    try {
      const normalized = normalizePhone(cleanNumber);
      const digits = normalized.replace(/[^\d]/g, '').slice(-10);
      if (digits.length >= 6) {
        const cust = await db.query('SELECT inn, name, contact_person FROM customers WHERE phone LIKE $1 OR phone LIKE $2 LIMIT 1', ['%' + digits, '%' + normalized.replace(/[^\d]/g, '').slice(-10)]);
        if (cust.rows.length) { clientInn = cust.rows[0].inn; clientName = cust.rows[0].contact_person || cust.rows[0].name; }
      }
    } catch (e) { /* non-critical */ }

    try {
      const result = await mango.callback(ext, cleanNumber, line_number || null, commandId);
      const callIdStr = 'crm_out_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      let callHistoryId = null;
      try {
        const histRes = await db.query(
          `INSERT INTO call_history (call_id, direction, call_type, caller_number, called_number, from_number, to_number, duration, duration_seconds, started_at, timestamp, user_id, client_inn, customer_id, status, line_number, created_at) VALUES ($1, 'outbound', 'outbound', $2, $3, $2, $3, 0, 0, NOW(), NOW(), $4, $5, $5, 'initiated', $6, NOW()) RETURNING id`,
          [callIdStr, ext, cleanNumber, request.user.id, clientInn, line_number || null]
        );
        callHistoryId = histRes.rows[0].id;
      } catch (e) { console.error('[Telephony] Failed to log outbound call:', e.message); }

      await logEvent('crm_outbound_call', { command_id: commandId, from_extension: ext, to_number: cleanNumber, user_id: request.user.id, user_name: request.user.name || request.user.full_name || '', client_inn: clientInn, client_name: clientName, call_history_id: callHistoryId, mango_result: result });
      await db.query('UPDATE user_call_status SET last_call_at = NOW(), updated_at = NOW() WHERE user_id = $1', [request.user.id]).catch(() => {});
      console.log('[Telephony] Outbound call initiated: user=' + request.user.id + ' ext=' + ext + ' to=' + cleanNumber);

      reply.send({ success: true, call_id: callHistoryId, command_id: commandId, extension: ext, to_number: cleanNumber, client_name: clientName, message: 'Звонок инициирован. Ожидайте соединения на вашем телефоне.' });
    } catch (err) {
      console.error('[Telephony] Outbound call error:', err.message, 'code:', err.code);
      await logEvent('crm_outbound_call_error', { command_id: commandId, from_extension: ext, to_number: cleanNumber, user_id: request.user.id, error: err.message, error_code: err.code });

      let errorMsg = 'Не удалось инициировать звонок';
      if (err.code === 1001) errorMsg = 'Неверный API-ключ Mango Office';
      else if (err.code === 1002) errorMsg = 'Неверная подпись запроса';
      else if (err.code === 2001) errorMsg = 'Внутренний номер не найден в Mango Office';
      else if (err.code === 2002) errorMsg = 'Недостаточно средств на балансе Mango Office';
      else if (err.code === 2003) errorMsg = 'Превышен лимит одновременных звонков';
      else if (err.message && err.message.includes('timeout')) errorMsg = 'Mango Office не отвечает. Попробуйте позже.';
      else if (err.message) errorMsg += ': ' + err.message;

      reply.code(500).send({ success: false, error: errorMsg });
    }
  });

  // --- Пропущенные ---
  fastify.get('/missed', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    const { page = 1, limit = 50, acknowledged } = request.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    const conditions = ["ch.call_type = 'missed'"];
    const params = [];
    let paramIdx = 1;

    if (!TEL_ADMIN_ROLES.includes(user.role)) {
      conditions.push(`(ch.user_id = $${paramIdx++} OR ch.user_id IS NULL)`);
      params.push(user.id);
    }
    if (acknowledged === 'false') {
      conditions.push('ch.missed_acknowledged = false');
    }

    const where = 'WHERE ' + conditions.join(' AND ');

    const countRes = await db.query(`SELECT COUNT(*) FROM call_history ch ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    // Группируем повторные звонки с одного номера
    const rows = await db.query(
      `SELECT ch.*, c.name as client_name, c.contact_person as client_contact, u.name as manager_name,
        t.status as task_status
       FROM call_history ch
       LEFT JOIN customers c ON c.inn = ch.client_inn
       LEFT JOIN users u ON u.id = ch.user_id
       LEFT JOIN tasks t ON t.id = ch.missed_task_id
       ${where}
       ORDER BY ch.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      [...params, limit, offset]
    );

    // Счётчик непросмотренных
    const unackParams = [];
    let unackWhere = "WHERE ch.call_type = 'missed' AND ch.missed_acknowledged = false";
    if (!TEL_ADMIN_ROLES.includes(user.role)) {
      unackWhere += ' AND (ch.user_id = $1 OR ch.user_id IS NULL)';
      unackParams.push(user.id);
    }
    const unackRes = await db.query(`SELECT COUNT(*) FROM call_history ch ${unackWhere}`, unackParams);

    reply.send({
      items: rows.rows,
      total,
      unacknowledged: parseInt(unackRes.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit)
    });
  });

  // --- Отметить пропущенный как просмотренный ---
  fastify.post('/missed/:id/acknowledge', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    await db.query(
      'UPDATE call_history SET missed_acknowledged = true, updated_at = NOW() WHERE id = $1',
      [request.params.id]
    );
    reply.send({ status: 'ok' });
  });

  // --- Статистика ---
  fastify.get('/stats', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { date_from, date_to, group_by = 'day' } = request.query;
    const from = date_from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const to = date_to || new Date().toISOString().slice(0, 10);

    // Check stats cache
    const cacheKey = `stats:${from}:${to}:${group_by}`;
    const cached = getCachedStats(cacheKey);
    if (cached) return reply.send(cached);

    // Общие метрики
    const totals = await db.query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE call_type = 'inbound') as inbound,
        COUNT(*) FILTER (WHERE call_type = 'outbound') as outbound,
        COUNT(*) FILTER (WHERE call_type = 'missed') as missed,
        ROUND(AVG(duration_seconds) FILTER (WHERE duration_seconds > 0)) as avg_duration,
        COUNT(*) FILTER (WHERE ai_is_target = true) as target_calls,
        COUNT(*) FILTER (WHERE lead_id IS NOT NULL) as converted_to_leads
      FROM call_history
      WHERE created_at >= $1 AND created_at <= $2::date + interval '1 day'`,
      [from, to]
    );

    // По дням
    const dateFormat = group_by === 'week' ? 'YYYY-IW' : group_by === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD';
    const byPeriod = await db.query(
      `SELECT TO_CHAR(created_at, $3) as period,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE call_type = 'inbound') as inbound,
        COUNT(*) FILTER (WHERE call_type = 'outbound') as outbound,
        COUNT(*) FILTER (WHERE call_type = 'missed') as missed
      FROM call_history
      WHERE created_at >= $1 AND created_at <= $2::date + interval '1 day'
      GROUP BY period ORDER BY period`,
      [from, to, dateFormat]
    );

    const statsResult = {
      period: { from, to },
      totals: totals.rows[0],
      by_period: byPeriod.rows
    };
    setCachedStats(cacheKey, statsResult);
    reply.send(statsResult);
  });

  // --- Статистика по менеджерам ---
  fastify.get('/stats/managers', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { date_from, date_to } = request.query;
    const from = date_from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const to = date_to || new Date().toISOString().slice(0, 10);

    // Check stats cache
    const mgrCacheKey = `stats_managers:${from}:${to}`;
    const mgrCached = getCachedStats(mgrCacheKey);
    if (mgrCached) return reply.send(mgrCached);

    const stats = await db.query(
      `SELECT u.id, u.name,
        COUNT(*) as total_calls,
        COUNT(*) FILTER (WHERE ch.call_type = 'inbound') as inbound,
        COUNT(*) FILTER (WHERE ch.call_type = 'outbound') as outbound,
        COUNT(*) FILTER (WHERE ch.call_type = 'missed') as missed,
        ROUND(AVG(ch.duration_seconds) FILTER (WHERE ch.duration_seconds > 0)) as avg_duration,
        COUNT(*) FILTER (WHERE ch.lead_id IS NOT NULL) as converted
      FROM call_history ch
      JOIN users u ON u.id = ch.user_id
      WHERE ch.created_at >= $1 AND ch.created_at <= $2::date + interval '1 day'
      GROUP BY u.id, u.name
      ORDER BY total_calls DESC`,
      [from, to]
    );

    const mgrResult = { managers: stats.rows };
    setCachedStats(mgrCacheKey, mgrResult);
    reply.send(mgrResult);
  });

  // --- Правила маршрутизации (CRUD) ---
  fastify.get('/routing', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const rules = await db.query(
      'SELECT r.*, u.name as created_by_name FROM call_routing_rules r LEFT JOIN users u ON u.id = r.created_by ORDER BY r.priority DESC, r.id'
    );
    reply.send({ rules: rules.rows });
  });

  fastify.post('/routing', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!TEL_ADMIN_ROLES.includes(request.user.role)) {
      return reply.code(403).send({ error: 'Admin access required' });
    }
    const { name, description, priority, condition_type, condition_value, action_type, action_value, is_active } = request.body;
    if (!name || !condition_type || !action_type) {
      return reply.code(400).send({ error: 'name, condition_type, action_type required' });
    }

    const res = await db.query(
      `INSERT INTO call_routing_rules (name, description, priority, condition_type, condition_value, action_type, action_value, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [name, description || null, priority || 0, condition_type, JSON.stringify(condition_value || {}),
       action_type, JSON.stringify(action_value || {}), is_active !== false, request.user.id]
    );
    reply.send(res.rows[0]);
  });

  fastify.put('/routing/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!TEL_ADMIN_ROLES.includes(request.user.role)) {
      return reply.code(403).send({ error: 'Admin access required' });
    }
    const { id } = request.params;
    const fields = request.body;
    const allowed = ['name', 'description', 'priority', 'condition_type', 'condition_value', 'action_type', 'action_value', 'is_active'];
    const sets = [];
    const params = [];
    let idx = 1;

    for (const key of allowed) {
      if (fields[key] !== undefined) {
        const val = (key === 'condition_value' || key === 'action_value') ? JSON.stringify(fields[key]) : fields[key];
        sets.push(`${key} = $${idx++}`);
        params.push(val);
      }
    }
    if (!sets.length) return reply.code(400).send({ error: 'No fields to update' });

    sets.push('updated_at = NOW()');
    params.push(id);

    const res = await db.query(
      `UPDATE call_routing_rules SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (!res.rows.length) return reply.code(404).send({ error: 'Rule not found' });
    reply.send(res.rows[0]);
  });

  fastify.delete('/routing/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!TEL_ADMIN_ROLES.includes(request.user.role)) {
      return reply.code(403).send({ error: 'Admin access required' });
    }
    const res = await db.query('DELETE FROM call_routing_rules WHERE id = $1 RETURNING id', [request.params.id]);
    if (!res.rows.length) return reply.code(404).send({ error: 'Rule not found' });
    reply.send({ status: 'deleted' });
  });

  // --- Внутренние номера ---
  fastify.get('/extensions', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const res = await db.query(
      `SELECT ucs.*, u.name, u.role FROM user_call_status ucs
       JOIN users u ON u.id = ucs.user_id
       ORDER BY u.name`
    );
    reply.send({ extensions: res.rows });
  });

  fastify.post('/extensions', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!TEL_ADMIN_ROLES.includes(request.user.role)) {
      return reply.code(403).send({ error: 'Admin access required' });
    }
    const { user_id, mango_extension, fallback_user_id, fallback_mobile, work_schedule, is_duty } = request.body;
    if (!user_id || !mango_extension) {
      return reply.code(400).send({ error: 'user_id and mango_extension required' });
    }

    const res = await db.query(
      `INSERT INTO user_call_status (user_id, mango_extension, fallback_user_id, fallback_mobile, work_schedule, is_duty, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         mango_extension = $2, fallback_user_id = $3, fallback_mobile = $4,
         work_schedule = COALESCE($5, user_call_status.work_schedule),
         is_duty = COALESCE($6, user_call_status.is_duty),
         updated_at = NOW()
       RETURNING *`,
      [user_id, mango_extension, fallback_user_id || null, fallback_mobile || null,
       work_schedule ? JSON.stringify(work_schedule) : null, is_duty]
    );
    reply.send(res.rows[0]);
  });

  // --- Активные звонки ---
  fastify.get('/active', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const res = await db.query(
      `SELECT ac.*, u.name as assigned_name
       FROM active_calls ac
       LEFT JOIN users u ON u.id = ac.assigned_user_id
       ORDER BY ac.started_at DESC`
    );
    reply.send({ calls: res.rows });
  });

  // --- Route/Transfer через API ---
  fastify.post('/call/route', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!mango.isConfigured()) return reply.code(503).send({ error: 'Telephony not configured' });
    const { call_id, to_number } = request.body;
    if (!call_id || !to_number) return reply.code(400).send({ error: 'call_id and to_number required' });

    try {
      const result = await mango.route(call_id, to_number);
      reply.send({ status: 'routed', result });
    } catch (err) {
      reply.code(500).send({ error: err.message });
    }
  });

  fastify.post('/call/transfer', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!mango.isConfigured()) return reply.code(503).send({ error: 'Telephony not configured' });
    const { call_id, to_number, method = 'blind' } = request.body;
    if (!call_id || !to_number) return reply.code(400).send({ error: 'call_id and to_number required' });

    const ucs = await db.query('SELECT mango_extension FROM user_call_status WHERE user_id = $1', [request.user.id]);
    const initiator = ucs.rows.length ? ucs.rows[0].mango_extension : '';

    try {
      const result = await mango.transfer(call_id, method, to_number, initiator);
      reply.send({ status: 'transferred', result });
    } catch (err) {
      reply.code(500).send({ error: err.message });
    }
  });

  fastify.post('/call/hangup', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!mango.isConfigured()) return reply.code(503).send({ error: 'Telephony not configured' });
    const { call_id } = request.body;
    if (!call_id) return reply.code(400).send({ error: 'call_id required' });

    try {
      const result = await mango.hangup(call_id);
      reply.send({ status: 'hangup', result });
    } catch (err) {
      reply.code(500).send({ error: err.message });
    }
  });

  // ========================================
  //  HELPERS
  // ========================================

  async function enrichPhoneData(phoneNumber, callId) {
    const token = process.env.DADATA_TOKEN;
    if (!token) return;

    try {
      const body = JSON.stringify([phoneNumber]);
      const data = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'cleaner.dadata.ru',
          path: '/api/v1/clean/phone',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Token ' + token,
            'X-Secret': process.env.DADATA_SECRET_KEY || ''
          },
          timeout: 5000
        }, (res) => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => {
            try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.write(body);
        req.end();
      });

      if (Array.isArray(data) && data.length > 0) {
        const info = data[0];
        // Обновляем ВСЕ звонки с этим номером (через entry_id или call_id)
        const normalized = normalizePhone(phoneNumber);
        await db.query(
          `UPDATE call_history SET
            dadata_region = $1, dadata_operator = $2, dadata_city = $3, updated_at = NOW()
          WHERE from_number = $4 OR from_number = $5 OR caller_number = $4 OR caller_number = $5`,
          [info.region || null, info.provider || null, info.city || info.timezone || null, phoneNumber, normalized]
        );
      }
    } catch (e) {
      // DaData enrichment is non-critical
    }
  }


  // --- Список менеджеров (для фильтра) ---
  fastify.get('/managers', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const res = await db.query(
      `SELECT u.id, u.name, u.role FROM users u
       WHERE u.is_active = true
       AND u.role IN ('PM','HEAD_PM','TO','HEAD_TO','BUH','PROC','CHIEF_ENGINEER','OFFICE_MANAGER','WAREHOUSE')
       ORDER BY u.name`
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

    // Отправляем AGI события ТОЛЬКО диспетчеру (кэш 30с)
    try {
      if (!_agiSseCache || Date.now() - _agiSseCacheTime > 30000) {
        const d = await db.query('SELECT user_id FROM user_call_status WHERE is_call_dispatcher = true');
        _agiSseCache = d.rows.map(r => r.user_id);
        _agiSseCacheTime = Date.now();
      }
      const sse = require('./sse');
      for (const uid of _agiSseCache) {
        sse.sendToUser(uid, 'call:agi_event', event);
      }
    } catch (sseErr) {
      console.error('[Telephony] SSE dispatch error:', sseErr.message);
    }

    if (event.type === 'call_end' && event.caller) {
      try {
        const normCaller = normalizePhone(event.caller);

        // 1. Найти начало этого звонка (call_start)
        const callStartRes = await db.query(
          `SELECT created_at FROM telephony_events_log
           WHERE event_type = 'agi_live' AND payload->>'caller' = $1 AND payload->>'type' = 'call_start'
           ORDER BY created_at DESC LIMIT 1`,
          [event.caller]
        );
        const sinceTime = callStartRes.rows.length
          ? callStartRes.rows[0].created_at
          : new Date(Date.now() - 15 * 60 * 1000);

        // 2. Собрать все речевые события для этого звонка
        const agiEvents = await db.query(
          `SELECT payload, created_at FROM telephony_events_log
           WHERE event_type = 'agi_live' AND payload->>'caller' = $1
             AND payload->>'type' IN ('greeting', 'client_speech', 'ai_response')
             AND created_at >= $2
           ORDER BY created_at ASC`,
          [event.caller, sinceTime]
        );

        // 3. Собрать транскрипт и сегменты
        const segments = [];
        const transcriptLines = [];
        let routeTo = null;
        let routeName = null;

        for (const row of agiEvents.rows) {
          const p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
          let speaker, speakerLabel, text;

          if (p.type === 'greeting') {
            speaker = 1; speakerLabel = 'ИИ';
            text = p.greeting || p.text || '';
          } else if (p.type === 'client_speech') {
            speaker = 0; speakerLabel = 'Клиент';
            text = p.text || '';
          } else if (p.type === 'ai_response') {
            speaker = 1; speakerLabel = 'ИИ';
            text = p.text || '';
            if (p.route_to) { routeTo = p.route_to; routeName = p.route_name || ''; }
          }

          if (!text) continue;
          segments.push({
            speaker, speakerLabel, text,
            startTime: new Date(row.created_at).getTime() / 1000
          });
          transcriptLines.push('[' + speakerLabel + ']: ' + text);
        }

        // 4. Найти user_id по route_to (из call_end или из ai_response)
        let routeUserId = null;
        const rt = event.route_to || routeTo;
        if (rt) {
          const normRoute = normalizePhone(rt);
          const u = await db.query(
            `SELECT user_id FROM user_call_status WHERE replace(replace(fallback_mobile,'+',''),'-','') LIKE $1 LIMIT 1`,
            ['%' + normRoute.slice(-10)]
          );
          if (u.rows.length) routeUserId = u.rows[0].user_id;
        }

        // 5. Собрать UPDATE
        const sets = [];
        const params = [];
        let pi = 1;

        if (routeUserId) { sets.push('user_id = $' + pi++); params.push(routeUserId); }
        if (event.ai_summary) { sets.push('ai_summary = $' + pi++); params.push(event.ai_summary); }
        if (event.intent) { sets.push('ai_is_target = $' + pi++); params.push(!['spam','unknown','silence'].includes(event.intent)); }
        if (event.collected_data) { sets.push('ai_lead_data = $' + pi++); params.push(JSON.stringify(event.collected_data)); }
        if (event.sentiment) { sets.push('ai_sentiment = $' + pi++); params.push(event.sentiment); }

        // MixMonitor recording path
        if (event.recordingPath) {
          sets.push('record_path = $' + pi++); params.push(event.recordingPath);
          sets.push('record_url = $' + pi++); params.push('/api/telephony/calls/{id}/record');
        }

        // Транскрипт из AGI-событий
        if (transcriptLines.length > 0) {
          sets.push('transcript = $' + pi++); params.push(transcriptLines.join('\n'));
          sets.push('transcript_segments = $' + pi++); params.push(JSON.stringify(segments));
          sets.push("transcript_status = 'done'");
        }

        if (sets.length > 0) {
          sets.push('updated_at = NOW()');
          params.push('%' + normCaller.slice(-10));
          const updateRes = await db.query(
            'UPDATE call_history SET ' + sets.join(', ') +
            ' WHERE id = (SELECT id FROM call_history WHERE from_number LIKE $' + pi + ' ORDER BY created_at DESC LIMIT 1) RETURNING id',
            params
          );

          if (updateRes.rows.length) {
            const callHistoryId = updateRes.rows[0].id;

            // Обновить record_url с реальным id
            if (event.recordingPath) {
              await db.query(
                'UPDATE call_history SET record_url = $1 WHERE id = $2',
                ['/api/telephony/calls/' + callHistoryId + '/record', callHistoryId]
              );
            }

            // Запустить AI-анализ по сохранённому транскрипту
            if (transcriptLines.length > 0) {
              console.log('[Telephony] AGI transcript saved: call #' + callHistoryId + ' (' + segments.length + ' segments, ' + transcriptLines.length + ' lines)');
              const pipeline = getPipeline();
              if (pipeline) {
                setImmediate(() => pipeline.processCall(callHistoryId).catch(e =>
                  console.error('[Telephony] AGI pipeline error:', e.message)
                ));
              }
            }

            // Запустить транскрипцию + AI-анализ по MixMonitor записи
            if (event.recordingPath && transcriptLines.length === 0) {
              console.log('[Telephony] MixMonitor recording: call #' + callHistoryId + ', path=' + event.recordingPath);
              const pipeline = getPipeline();
              if (pipeline) {
                setImmediate(() => pipeline.processLocalRecording(callHistoryId).catch(e =>
                  console.error('[Telephony] MixMonitor pipeline error:', e.message)
                ));
              }
            }
          }
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
      `SELECT ucs.user_id, u.name FROM user_call_status ucs
       JOIN users u ON u.id = ucs.user_id
       WHERE ucs.is_call_dispatcher = true LIMIT 1`
    );
    const mySettings = await db.query(
      'SELECT receive_call_push, is_call_dispatcher FROM user_call_status WHERE user_id = $1',
      [request.user.id]
    );
    const isMe = dispatcher.rows.length && dispatcher.rows[0].user_id === request.user.id;
    reply.send({
      active_dispatcher: dispatcher.rows.length ? { user_id: dispatcher.rows[0].user_id, name: dispatcher.rows[0].name } : null,
      current_dispatcher_name: dispatcher.rows.length ? dispatcher.rows[0].name : null,
      is_dispatcher: isMe,
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
        `SELECT ucs.user_id, u.name FROM user_call_status ucs
         JOIN users u ON u.id = ucs.user_id
         WHERE ucs.is_call_dispatcher = true AND ucs.user_id != $1`,
        [userId]
      );
      if (existing.rows.length) {
        return reply.code(409).send({
          error: 'dispatcher_active',
          active_dispatcher: { user_id: existing.rows[0].user_id, name: existing.rows[0].name }
        });
      }
      await db.query(
        `INSERT INTO user_call_status (user_id, is_call_dispatcher, receive_call_push, updated_at)
         VALUES ($1, true, true, NOW())
         ON CONFLICT (user_id) DO UPDATE SET is_call_dispatcher = true, receive_call_push = true, updated_at = NOW()`,
        [userId]
      );
    } else {
      await db.query(
        'UPDATE user_call_status SET is_call_dispatcher = false, updated_at = NOW() WHERE user_id = $1',
        [userId]
      );
    }
    const userName = request.user.name || request.user.full_name || '';
    _agiSseCache = null; // Invalidate cache
    reply.send({ status: 'ok', is_dispatcher: !!enable, dispatcher_name: enable ? userName : '' });
  });

  // --- Список сотрудников для перевода ---
  fastify.get('/employees', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const res = await db.query(
      `SELECT u.id, u.name, u.role, ucs.fallback_mobile
       FROM users u
       LEFT JOIN user_call_status ucs ON ucs.user_id = u.id
       WHERE u.is_active = true AND u.role NOT IN ('ADMIN','HR','HR_MANAGER')
       ORDER BY u.name`
    );
    const employees = res.rows.map(e => ({
      id: e.id,
      name: e.name,
      full_name: e.name,
      role: e.role,
      phone: e.fallback_mobile || '',
      internal_phone: e.fallback_mobile || ''
    }));
    reply.send({ employees });
  });

  // --- AMI helper для управления звонками через Asterisk ---
  const net = require('net');
  const AMI_HOST = '127.0.0.1';
  const AMI_PORT = 5038;
  const AMI_USER = 'asgard';
  const AMI_SECRET = 'AsgardAMI2024Secure';

  function sendAMI(actions) {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host: AMI_HOST, port: AMI_PORT }, () => {
        let buf = '';
        sock.on('data', (d) => { buf += d.toString(); });

        // Login
        sock.write('Action: Login\r\nUsername: ' + AMI_USER + '\r\nSecret: ' + AMI_SECRET + '\r\n\r\n');

        setTimeout(() => {
          if (!buf.includes('Success')) {
            sock.end();
            return reject(new Error('AMI login failed'));
          }
          // Send action
          let cmd = '';
          for (const [k, v] of Object.entries(actions)) {
            cmd += k + ': ' + v + '\r\n';
          }
          cmd += '\r\n';
          sock.write(cmd);

          setTimeout(() => {
            sock.write('Action: Logoff\r\n\r\n');
            setTimeout(() => { sock.end(); resolve(buf); }, 200);
          }, 1000);
        }, 500);
      });
      sock.on('error', (e) => reject(e));
      sock.setTimeout(5000, () => { sock.end(); reject(new Error('AMI timeout')); });
    });
  }

  // Найти активный канал по номеру звонящего
  async function findActiveChannel(callerNumber) {
    try {
      const result = await sendAMI({ Action: 'CoreShowChannels' });
      const norm = callerNumber.replace(/[^0-9]/g, '').slice(-10);
      const lines = result.split('\r\n');
      for (const line of lines) {
        if (line.includes(norm)) {
          const match = line.match(/Channel:\s*(\S+)/);
          if (match) return match[1];
        }
      }
      // Fallback: check channels listing
      const chanMatch = result.match(/Channel:\s*(SIP\/[^\r\n]+)/g);
      if (chanMatch) {
        for (const ch of chanMatch) {
          const channel = ch.replace('Channel: ', '');
          if (channel.includes(norm)) return channel;
        }
      }
    } catch (e) {
      console.error('[Telephony] AMI findChannel error:', e.message);
    }

    // Fallback: check recent AGI log for channel
    try {
      const norm = callerNumber.replace(/[^0-9]/g, '').slice(-10);
      const log = await db.query(
        `SELECT payload FROM telephony_events_log
         WHERE event_type = 'agi_live' AND payload::text LIKE $1
         ORDER BY created_at DESC LIMIT 1`,
        ['%' + norm + '%']
      );
      if (log.rows.length && log.rows[0].payload.channel) {
        return log.rows[0].payload.channel;
      }
    } catch (e) { /* ignore */ }

    return null;
  }

  // --- Перевод звонка на сотрудника ---
  fastify.post('/call-control/transfer', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { call_id, employee_id, employee_phone } = request.body || {};
    const userId = request.user.id;

    // Проверяем что пользователь — диспетчер
    const disp = await db.query(
      'SELECT is_call_dispatcher FROM user_call_status WHERE user_id = $1',
      [userId]
    );
    if (!disp.rows.length || !disp.rows[0].is_call_dispatcher) {
      return reply.code(403).send({ error: 'Только диспетчер может переводить звонки' });
    }

    let targetPhone = employee_phone;
    if (!targetPhone && employee_id) {
      const emp = await db.query(
        'SELECT ucs.fallback_mobile FROM user_call_status ucs WHERE ucs.user_id = $1',
        [employee_id]
      );
      if (emp.rows.length) targetPhone = emp.rows[0].fallback_mobile;
    }
    if (!targetPhone) {
      return reply.code(400).send({ error: 'Не указан телефон сотрудника' });
    }

    const cleanPhone = targetPhone.replace(/[^0-9]/g, '');
    console.log('[Telephony] CRM transfer request: call=' + call_id + ' to=' + cleanPhone + ' by user=' + userId);

    try {
      // Пробуем через AGI HTTP control
      const http = require('http');
      const payload = JSON.stringify({ action: 'transfer', phone: cleanPhone, call_id });
      const result = await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1', port: 4574, path: '/transfer',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
          timeout: 5000
        }, (res) => {
          let data = '';
          res.on('data', (d) => data += d);
          res.on('end', () => {
            try { resolve(JSON.parse(data)); } catch (e) { resolve({ ok: false, error: data }); }
          });
        });
        req.on('error', (e) => reject(e));
        req.write(payload);
        req.end();
      });

      if (result.ok) {
        reply.send({ success: true, message: 'Перевод инициирован' });
      } else {
        reply.send({ success: false, error: result.error || 'Не удалось перевести' });
      }
    } catch (agiErr) {
      // AGI control server not available — try AMI fallback
      console.log('[Telephony] AGI control unavailable, trying AMI...');
      try {
        // Get caller number from recent call
        let callerNumber = null;
        if (call_id) {
          const ch = await db.query('SELECT from_number FROM call_history WHERE id = $1', [call_id]);
          if (ch.rows.length) callerNumber = ch.rows[0].from_number;
        }
        if (!callerNumber) {
          // Get most recent active call
          const recent = await db.query(
            `SELECT payload->>'caller' as caller FROM telephony_events_log
             WHERE event_type = 'agi_live' AND payload->>'type' = 'call_start'
             ORDER BY created_at DESC LIMIT 1`
          );
          if (recent.rows.length) callerNumber = recent.rows[0].caller;
        }

        if (!callerNumber) {
          return reply.send({ success: false, error: 'Не найден активный звонок' });
        }

        // AMI Redirect
        const channel = await findActiveChannel(callerNumber);
        if (channel) {
          await sendAMI({
            Action: 'Redirect',
            Channel: channel,
            Context: 'asgard-transfer',
            Exten: cleanPhone,
            Priority: '1'
          });
          reply.send({ success: true, message: 'Перевод через AMI инициирован' });
        } else {
          reply.send({ success: false, error: 'Канал не найден — возможно звонок уже завершён' });
        }
      } catch (amiErr) {
        console.error('[Telephony] AMI transfer error:', amiErr.message);
        reply.send({ success: false, error: 'Ошибка AMI: ' + amiErr.message });
      }
    }

    await logEvent('crm_transfer', { call_id, employee_id, target_phone: cleanPhone, user_id: userId });
  });

  // --- Перехват звонка на себя (takeover) ---
  fastify.post('/call-control/takeover', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { call_id } = request.body || {};
    const userId = request.user.id;

    // Проверяем что пользователь — диспетчер
    const disp = await db.query(
      'SELECT is_call_dispatcher FROM user_call_status WHERE user_id = $1',
      [userId]
    );
    if (!disp.rows.length || !disp.rows[0].is_call_dispatcher) {
      return reply.code(403).send({ error: 'Только диспетчер может перехватывать звонки' });
    }

    // Получаем телефон диспетчера
    const myPhone = await db.query(
      'SELECT fallback_mobile FROM user_call_status WHERE user_id = $1',
      [userId]
    );
    if (!myPhone.rows.length || !myPhone.rows[0].fallback_mobile) {
      return reply.code(400).send({ error: 'У вас не указан номер телефона в настройках' });
    }
    const cleanPhone = myPhone.rows[0].fallback_mobile.replace(/[^0-9]/g, '');

    console.log('[Telephony] CRM takeover request: call=' + call_id + ' to dispatcher phone=' + cleanPhone + ' by user=' + userId);

    try {
      const http = require('http');
      const payload = JSON.stringify({ action: 'transfer', phone: cleanPhone, call_id });
      const result = await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1', port: 4574, path: '/transfer',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
          timeout: 5000
        }, (res) => {
          let data = '';
          res.on('data', (d) => data += d);
          res.on('end', () => {
            try { resolve(JSON.parse(data)); } catch (e) { resolve({ ok: false, error: data }); }
          });
        });
        req.on('error', (e) => reject(e));
        req.write(payload);
        req.end();
      });

      if (result.ok) {
        reply.send({ success: true, message: 'Звонок переведён на вас' });
      } else {
        reply.send({ success: false, error: result.error || 'Не удалось перехватить' });
      }
    } catch (agiErr) {
      console.log('[Telephony] AGI control unavailable for takeover, trying AMI...');
      try {
        let callerNumber = null;
        const recent = await db.query(
          `SELECT payload->>'caller' as caller FROM telephony_events_log
           WHERE event_type = 'agi_live' AND payload->>'type' = 'call_start'
           ORDER BY created_at DESC LIMIT 1`
        );
        if (recent.rows.length) callerNumber = recent.rows[0].caller;

        if (!callerNumber) {
          return reply.send({ success: false, error: 'Не найден активный звонок' });
        }

        const channel = await findActiveChannel(callerNumber);
        if (channel) {
          await sendAMI({
            Action: 'Redirect',
            Channel: channel,
            Context: 'asgard-transfer',
            Exten: cleanPhone,
            Priority: '1'
          });
          reply.send({ success: true, message: 'Перехват через AMI инициирован' });
        } else {
          reply.send({ success: false, error: 'Канал не найден' });
        }
      } catch (amiErr) {
        console.error('[Telephony] AMI takeover error:', amiErr.message);
        reply.send({ success: false, error: 'Ошибка AMI: ' + amiErr.message });
      }
    }

    await logEvent('crm_takeover', { call_id, target_phone: cleanPhone, user_id: userId });
  });


  // ========================================
  //  HEALTH CHECK (public, no auth)
  // ========================================

  fastify.get("/health", { schema: { hide: true } }, async (request, reply) => {
    const net = require("net");
    const checks = {};
    let overallStatus = "ok";

    // 1. Database check
    try {
      const dbStart = Date.now();
      await db.query("SELECT 1");
      const dbLatency = Date.now() - dbStart;
      checks.database = { status: "ok", latency_ms: dbLatency };
    } catch (err) {
      checks.database = { status: "error", latency_ms: -1 };
      overallStatus = "error";
    }

    // 2. Mango Office API
    const mangoConfigured = Boolean(process.env.MANGO_API_KEY);
    checks.mango = {
      status: mangoConfigured ? "ok" : "not_configured",
      configured: mangoConfigured
    };

    // 3. SpeechKit
    const speechkitConfigured = Boolean(process.env.YANDEX_SPEECHKIT_API_KEY);
    checks.speechkit = {
      status: speechkitConfigured ? "ok" : "not_configured",
      configured: speechkitConfigured
    };
    if (!speechkitConfigured && overallStatus === "ok") overallStatus = "degraded";

    // 4. Job queue
    try {
      const jqResult = await db.query(
        "SELECT" +
        " COUNT(*) FILTER (WHERE status = 'pending')    AS pending," +
        " COUNT(*) FILTER (WHERE status = 'processing') AS processing," +
        " COUNT(*) FILTER (WHERE status = 'failed')     AS failed" +
        " FROM telephony_jobs"
      );
      const row = jqResult.rows[0] || {};
      checks.job_queue = {
        status: "ok",
        pending: parseInt(row.pending || "0", 10),
        processing: parseInt(row.processing || "0", 10),
        failed: parseInt(row.failed || "0", 10)
      };
    } catch (err) {
      checks.job_queue = { status: "error", pending: 0, processing: 0, failed: 0 };
    }

    // 5. Asterisk AMI
    try {
      const asteriskReachable = await new Promise((resolve) => {
        const sock = net.createConnection({ host: "127.0.0.1", port: 5038, timeout: 2000 }, () => {
          sock.destroy();
          resolve(true);
        });
        sock.on("error", () => { sock.destroy(); resolve(false); });
        sock.on("timeout", () => { sock.destroy(); resolve(false); });
      });
      checks.asterisk = { status: asteriskReachable ? "ok" : "error", reachable: asteriskReachable };
      if (!asteriskReachable && overallStatus === "ok") overallStatus = "degraded";
    } catch (err) {
      checks.asterisk = { status: "error", reachable: false };
      if (overallStatus === "ok") overallStatus = "degraded";
    }

    const statusCode = overallStatus === "error" ? 503 : 200;
    return reply.code(statusCode).send({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks
    });
  });
};
