'use strict';

const http = require('http');
const { Pool } = require('pg');
const { config, amiConfigured } = require('./config');
const { AgiServer } = require('./agi-server');
const { getAmiClient } = require('./ami-client');
const { attachNotifyBridge } = require('./notify-bridge');
const { buildRingPlan } = require('./dial-engine');
const { lookupCaller } = require('../services/caller-lookup');
const {
  buildDialVars,
  loadDutyUserIdMsk,
  insertPbxCallHistory,
  insertCallLeg,
  markCallMissed,
  buildRingNotifyPayload,
  normalizePbxConfig,
} = require('./call-lifecycle');
const { finalizeRecording, finalizeOnHangup } = require('./recording');

let pool = null;
let agiServer = null;
let cmdServer = null;
let notifyBridge = null;
/** @type {Map<string, { channel: string, pbxUid: string, userId: number }>} */
const activeChannels = new Map();

function setPool(p) {
  pool = p;
}

function getPool() {
  if (!pool && config.databaseUrl) {
    pool = new Pool({ connectionString: config.databaseUrl });
  }
  return pool;
}

async function loadPbxConfig(client) {
  const { rows } = await client.query(
    `SELECT value_json FROM settings WHERE key = 'pbx_config' LIMIT 1`
  );
  let raw = rows[0]?.value_json || {};
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch (_) { raw = {}; }
  }
  return normalizePbxConfig(raw);
}

async function loadOperators(client) {
  const { rows } = await client.query(
    `SELECT o.*, u.name FROM pbx_operators o JOIN users u ON u.id = o.user_id WHERE u.is_active = true`
  );
  return rows;
}

async function notifyRing(client, payload) {
  if (notifyBridge) {
    await notifyBridge.notify(client, payload);
  } else {
    await client.query('SELECT pg_notify($1, $2)', [
      'pbx_call_event',
      JSON.stringify(payload),
    ]);
  }
}

/**
 * Реальный inbound AGI: dial string + history + legs + NOTIFY.
 * Экспортируется для integration-тестов.
 */
async function handleInboundAgi(session) {
  const caller = session.env.agi_callerid || session.env.callerid || '';
  const uniqueId = session.env.agi_uniqueid || session.env.uniqueid || String(Date.now());
  const dnid = session.env.agi_dnid || session.env.agi_extension || session.env.extension || '';
  const channel = session.env.agi_channel || session.env.channel || null;
  const db = getPool();
  if (!db) {
    await session.verbose('PBX: DATABASE_URL not set', 1);
    await session.hangup();
    return { ok: false, reason: 'no_db' };
  }
  const client = await db.connect();
  try {
    const pbxConfig = await loadPbxConfig(client);
    const dutyUserId = await loadDutyUserIdMsk(client);
    const operators = await loadOperators(client);
    const plan = buildRingPlan(operators, dutyUserId, pbxConfig, new Date());
    const lookup = await lookupCaller({ query: (sql, p) => client.query(sql, p) }, caller);

    await client.query(
      `INSERT INTO telephony_events_log (event_type, payload)
       VALUES ('pbx_agi_inbound', $1)`,
      [JSON.stringify({ uniqueId, caller, plan, lookup })]
    );

    const hist = await insertPbxCallHistory(client, {
      pbxUid: uniqueId,
      caller,
      toNumber: dnid,
      lookup,
    });

    if (!plan.withinHours || !plan.targets.length) {
      await session.answer();
      const msgFile = plan.withinHours ? 'custom/all-busy' : 'custom/after-hours';
      try {
        await session.streamFile(msgFile);
      } catch (_) {
        await session.streamFile('beep');
      }
      await markCallMissed(client, uniqueId, plan.withinHours ? 'no_agents' : 'off_hours');
      await notifyRing(client, {
        event: 'call:missed',
        user_id: dutyUserId,
        data: {
          call_id: 'pbx_' + uniqueId,
          pbx_uid: uniqueId,
          reason: plan.withinHours ? 'no_agents' : 'off_hours',
          from_number: caller,
        },
      });
      await session.hangup();
      return { ok: true, missed: true, plan, hist };
    }

    const dial = buildDialVars(plan.targets, pbxConfig);
    if (!dial.dialString) {
      await session.verbose('PBX: empty dial string', 1);
      await markCallMissed(client, uniqueId, 'no_dial');
      await session.hangup();
      return { ok: false, reason: 'empty_dial', plan };
    }

    // Контракт dialplan: Dial(${ASGARD_DIAL_STRING},${ASGARD_RING_TIMEOUT},g)
    await session.setVariable('ASGARD_DIAL_STRING', dial.dialString);
    await session.setVariable('ASGARD_RING_TIMEOUT', String(dial.ringTimeout));
    await session.setVariable('ASGARD_RING_PLAN', JSON.stringify(plan.targets.slice(0, 8)));
    await session.setVariable('ASGARD_CALLER_JSON', JSON.stringify(lookup));
    await session.setVariable('ASGARD_PBX_UID', String(uniqueId));
    await session.setVariable('ASGARD_HISTORY_ID', String(hist.id));

    let legSeq = 1;
    for (const t of plan.targets) {
      await insertCallLeg(client, {
        callId: 'pbx_' + uniqueId,
        legSeq: legSeq++,
        userId: t.userId,
        targetType: t.targetType,
        targetAddr: t.targetAddr,
        role: 'ring',
        ringMs: (t.ringSec || dial.ringTimeout) * 1000,
        meta: { dial: targetDialHint(t) },
      });
    }

    const first = dial.firstTarget;
    const notifyPayload = buildRingNotifyPayload({
      pbxUid: uniqueId,
      caller,
      lookup,
      target: first,
      channel,
      callHistoryId: hist.id,
    });
    await notifyRing(client, notifyPayload);

    if (channel && first?.userId) {
      activeChannels.set(String(uniqueId), {
        channel,
        pbxUid: String(uniqueId),
        userId: first.userId,
      });
    }

    await session.verbose(`Ring dial=${dial.dialString} t=${dial.ringTimeout}`, 1);
    return {
      ok: true,
      plan,
      dial,
      hist,
      notify: notifyPayload,
    };
  } finally {
    client.release();
  }
}

function targetDialHint(t) {
  try {
    const { targetToDialPart } = require('./call-lifecycle');
    return targetToDialPart(t);
  } catch (_) {
    return null;
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function createCmdServer() {
  return http.createServer(async (req, res) => {
    const remote = req.socket.remoteAddress || '';
    if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const url = new URL(req.url, 'http://127.0.0.1');
    const secret = req.headers['x-pbx-secret'];
    // Hangup finalize + health: loopback-only, allow without secret —
    // Asterisk ${ENV(PBX_CMD_SECRET)} часто не видит pbx.env asgard-pbx.
    // Остальные CMD (AMI answer/hangup/…) — только с совпадением secret.
    const openPaths = url.pathname === '/recording/finalize' || url.pathname === '/health';
    if (!openPaths) {
      if (!config.pbxCmdSecret || secret !== config.pbxCmdSecret) {
        res.writeHead(401);
        res.end('Unauthorized');
        return;
      }
    } else if (config.pbxCmdSecret && secret && secret !== config.pbxCmdSecret) {
      // If client sends a wrong secret on open path — still reject (tamper signal)
      res.writeHead(401);
      res.end('Unauthorized');
      return;
    }

    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };

    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(200, {
          ok: true,
          ami: amiConfigured(),
          agi_port: config.agiPort,
        });
      }

      let body = {};
      if (req.method === 'POST' || req.method === 'PUT') {
        body = await parseBody(req);
      }

      const ami = getAmiClient();
      const db = getPool();

      if (req.method === 'POST' && url.pathname === '/call/originate') {
        if (!amiConfigured()) throw new Error('AMI not configured');
        const r = await ami.originate(body);
        return send(200, { ok: true, ami: r });
      }
      if (req.method === 'POST' && url.pathname === '/call/hangup') {
        if (!amiConfigured()) throw new Error('AMI not configured');
        if (!body.channel) throw new Error('channel required');
        await ami.hangup(body.channel);
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/call/redirect') {
        if (!amiConfigured()) throw new Error('AMI not configured');
        await ami.redirect(body.channel, body.context || 'transfer', body.exten || 'blind', body.priority || 1);
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/call/bridge') {
        if (!amiConfigured()) throw new Error('AMI not configured');
        // Softphone answer: bridge client channel with agent channel if both given;
        // otherwise Redirect agent session is already bridged by Dial — just ACK + mark answered.
        if (body.channel1 && body.channel2) {
          await ami.bridge(body.channel1, body.channel2);
        }
        if (body.pbx_uid && body.user_id && db) {
          const { markCallAnswered } = require('./call-lifecycle');
          const c = await db.connect();
          try {
            await markCallAnswered(c, body.pbx_uid, body.user_id);
          } finally {
            c.release();
          }
        }
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/call/answer') {
        // Alias used by CRM API
        if (body.pbx_uid && body.user_id && db) {
          const { markCallAnswered } = require('./call-lifecycle');
          const c = await db.connect();
          try {
            await markCallAnswered(c, body.pbx_uid, body.user_id);
          } finally {
            c.release();
          }
        }
        if (amiConfigured() && body.channel1 && body.channel2) {
          await ami.bridge(body.channel1, body.channel2);
        }
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/call/transfer') {
        if (!amiConfigured()) throw new Error('AMI not configured');
        if (!body.channel) throw new Error('channel required');
        const mode = body.mode || 'blind';
        if (mode === 'consult') {
          await ami.redirect(body.channel, 'hold', 's', 1);
          if (body.target) {
            await ami.originate({
              Channel: body.target.includes('/') ? body.target : `PJSIP/${body.target}`,
              Context: 'transfer',
              Exten: 'consult',
              Priority: 1,
              Async: 'true',
              Variable: `CONSULT_TARGET=${body.target}`,
            });
          }
        } else {
          await ami.setVar(body.channel, 'TRANSFER_TARGET', body.target || '');
          await ami.redirect(body.channel, 'transfer', 'blind', 1);
        }
        return send(200, { ok: true, mode });
      }
      if (req.method === 'POST' && url.pathname === '/call/hold') {
        if (!amiConfigured()) throw new Error('AMI not configured');
        if (!body.channel) throw new Error('channel required');
        if (body.hold === false) {
          await ami.redirect(body.channel, 'from-mango-inbound', 's', 1);
        } else {
          await ami.redirect(body.channel, 'hold', 's', 1);
        }
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/call/setvar') {
        if (!amiConfigured()) throw new Error('AMI not configured');
        await ami.setVar(body.channel, body.variable, body.value);
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/recording/finalize') {
        const r = await finalizeOnHangup(db, body);
        if (!r.ok && r.reason === 'pending_file') {
          return send(202, r);
        }
        if (!r.ok) return send(400, r);
        return send(200, r);
      }
      if (req.method === 'POST' && url.pathname === '/dial/plan') {
        if (!db) throw new Error('DATABASE_URL not set');
        const client = await db.connect();
        try {
          const pbxConfig = await loadPbxConfig(client);
          const dutyUserId = await loadDutyUserIdMsk(client);
          const operators = await loadOperators(client);
          const plan = buildRingPlan(operators, dutyUserId, pbxConfig, new Date());
          const dial = buildDialVars(plan.targets, pbxConfig);
          return send(200, { ...plan, dial });
        } finally {
          client.release();
        }
      }
      if (req.method === 'POST' && url.pathname === '/operator/webrtc') {
        if (!db) throw new Error('DATABASE_URL not set');
        const userId = body.user_id;
        if (!userId) throw new Error('user_id required');
        const registered = !!body.registered;
        await db.query(
          `INSERT INTO pbx_operators (user_id, webrtc_registered, last_seen_at, updated_at)
           VALUES ($1, $2, NOW(), NOW())
           ON CONFLICT (user_id) DO UPDATE SET
             webrtc_registered = $2,
             last_seen_at = NOW(),
             updated_at = NOW()`,
          [userId, registered]
        );
        try {
          const { setOperatorOnline } = require('./ast-db-fallback');
          await setOperatorOnline(userId, registered);
        } catch (_) { /* optional when AMI down */ }
        return send(200, { ok: true, webrtc_registered: registered });
      }

      send(404, { error: 'not_found' });
    } catch (err) {
      send(500, { error: err.message });
    }
  });
}

async function start() {
  agiServer = new AgiServer(config.agiPort, handleInboundAgi);
  await agiServer.start();
  console.log(`[asgard-pbx] AGI listening 127.0.0.1:${config.agiPort}`);

  cmdServer = createCmdServer();
  await new Promise((resolve) => {
    cmdServer.listen(config.cmdPort, config.cmdHost, resolve);
  });
  console.log(`[asgard-pbx] CMD HTTP ${config.cmdHost}:${config.cmdPort}`);

  const db = getPool();
  if (db) {
    notifyBridge = attachNotifyBridge(db);
    notifyBridge.emitter.on('error', (e) => console.error('[asgard-pbx] notify', e.message));
  }

  if (amiConfigured()) {
    const ami = getAmiClient();
    ami
      .connect()
      .then(() => {
        console.log('[asgard-pbx] AMI connected');
        // Backup path if dialplan `h`/curl missed: Hangup → finalize by Uniqueid
        ami.on('event', (msg) => {
          if (!msg || msg.Event !== 'Hangup') return;
          const uid = msg.Uniqueid || msg.Linkedid;
          if (!uid || !db) return;
          finalizeOnHangup(db, { pbxUid: uid, callId: 'pbx_' + uid }).catch((e) => {
            console.warn('[asgard-pbx] hangup finalize:', e.message);
          });
        });
      })
      .catch((e) => console.warn('[asgard-pbx] AMI connect failed:', e.message));
  } else {
    console.warn('[asgard-pbx] AMI not configured — dial-engine via API only');
  }
}

async function stop() {
  if (agiServer) await agiServer.stop();
  if (cmdServer) {
    await new Promise((r) => cmdServer.close(r));
    cmdServer = null;
  }
  if (notifyBridge) await notifyBridge.stop();
  if (pool) await pool.end();
  pool = null;
  getAmiClient().close();
}

if (require.main === module) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
  process.on('SIGINT', () => stop().then(() => process.exit(0)));
  process.on('SIGTERM', () => stop().then(() => process.exit(0)));
}

module.exports = {
  start,
  stop,
  buildRingPlan,
  getPool,
  setPool,
  handleInboundAgi,
  loadPbxConfig,
  activeChannels,
  createCmdServer,
};
