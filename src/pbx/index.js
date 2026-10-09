'use strict';

const http = require('http');
const { Pool } = require('pg');
const { config, amiConfigured } = require('./config');
const { AgiServer } = require('./agi-server');
const { getAmiClient } = require('./ami-client');
const { attachNotifyBridge } = require('./notify-bridge');
const { buildRingPlan, resolveTransferTargets, expandOperatorTargets } = require('./dial-engine');
const { lookupCaller } = require('../services/caller-lookup');
const {
  buildDialVars,
  loadDutyUserIdMsk,
  insertPbxCallHistory,
  insertCallLeg,
  markCallMissed,
  buildRingNotifyPayload,
  normalizePbxConfig,
  targetToDialPart,
} = require('./call-lifecycle');
const { finalizeRecording, finalizeOnHangup, sweepRecordings, saveVoicemail } = require('./recording');
const { runOperatorMaintenance } = require('./operator-lifecycle');
const { ensurePrompt } = require('./prompts');

let pool = null;
let agiServer = null;
let cmdServer = null;
let notifyBridge = null;
let maintenanceTimer = null;
let recordingTimer = null;
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
    `SELECT o.*, u.name,
            COALESCE(NULLIF(BTRIM(o.mobile_phone), ''), NULLIF(BTRIM(u.phone), ''), NULLIF(BTRIM(ucs.fallback_mobile), '')) AS mobile_phone
     FROM pbx_operators o
     JOIN users u ON u.id = o.user_id
     LEFT JOIN user_call_status ucs ON ucs.user_id = o.user_id
     WHERE u.is_active = true`
  );
  return rows;
}

/** РњРѕР±РёР»СЊРЅС‹Р№ РґРµР¶СѓСЂРЅРѕРіРѕ РґР»СЏ С„РѕР»Р±СЌРєР° (РєРѕРіРґР° РЅРёРєС‚Рѕ РЅРµ РЅР° Р»РёРЅРёРё). */
async function loadDutyMobile(client, dutyUserId) {
  if (!dutyUserId) return null;
  try {
    const { rows } = await client.query(
      `SELECT COALESCE(NULLIF(BTRIM(o.mobile_phone), ''), NULLIF(BTRIM(u.phone), ''), NULLIF(BTRIM(ucs.fallback_mobile), '')) AS mobile
         FROM users u
         LEFT JOIN pbx_operators o ON o.user_id = u.id
         LEFT JOIN user_call_status ucs ON ucs.user_id = u.id
        WHERE u.id = $1`,
      [dutyUserId]
    );
    const m = rows[0]?.mobile;
    return m ? String(m).replace(/[^\d]/g, '') : null;
  } catch (_) {
    return null;
  }
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
 * Р РµР°Р»СЊРЅС‹Р№ inbound AGI: dial string + history + legs + NOTIFY.
 * Р­РєСЃРїРѕСЂС‚РёСЂСѓРµС‚СЃСЏ РґР»СЏ integration-С‚РµСЃС‚РѕРІ.
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
      const announce = pbxConfig.greeting_in_crm !== false;
      // РќРµС‚ СЃРІРѕР±РѕРґРЅС‹С… РѕРїРµСЂР°С‚РѕСЂРѕРІ: РЅРµ С‚РµСЂСЏРµРј РІС‹Р·РѕРІ вЂ” РїСЂРёРІРµС‚СЃС‚РІРёРµ в†’ РґРµР¶СѓСЂРЅС‹Р№ РЅР° РјРѕР±РёР»СЊРЅС‹Р№ в†’ РїРѕС‡С‚Р°.
      const dutyMobile = pbxConfig.duty_mobile_fallback !== false
        ? await loadDutyMobile(client, dutyUserId)
        : null;
      if (announce) {
        await session.answer();
        const customText = plan.withinHours ? pbxConfig.greeting_text : pbxConfig.after_hours_text;
        const fallbackFile = plan.withinHours ? 'custom/all-busy' : 'custom/after-hours';
        let played = false;
        try {
          const file = await ensurePrompt(customText);
          if (file) {
            await session.streamFile(file);
            played = true;
          }
        } catch (e) {
          console.warn('[asgard-pbx] prompt synth failed:', e.message);
        }
        if (!played) {
          for (const f of [fallbackFile, 'custom/all-busy', 'beep']) {
            try { await session.streamFile(f); played = true; break; } catch (_) { /* next */ }
          }
        }
      }
      if (dutyMobile) {
        await session.setVariable('ASGARD_DUTY_MOBILE', dutyMobile);
        await session.setVariable('ASGARD_DUTY_MOBILE_TO', String(pbxConfig.mobile_ring_sec ?? 30));
        if (!announce) await session.answer();
        await session.verbose(`Duty mobile fallback ${dutyMobile}`, 1);
        return { ok: true, fallback: 'duty_mobile', plan, hist };
      }
      if (!announce) {
        // РџСЂРёРІРµС‚СЃС‚РІРёРµ РѕР·РІСѓС‡РёРІР°РµС‚ Mango вЂ” СЃСЂР°Р·Сѓ РІ РіРѕР»РѕСЃРѕРІСѓСЋ РїРѕС‡С‚Сѓ.
        await session.hangup();
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

    // РљРѕРЅС‚СЂР°РєС‚ dialplan: Dial + cascade 2..5 + РґРµР¶СѓСЂРЅС‹Р№ + РїРѕС‡С‚Р°
    await session.setVariable('ASGARD_DIAL_STRING', dial.dialString);
    await session.setVariable('ASGARD_RING_TIMEOUT', String(dial.ringTimeout));
    // Р”РµР¶СѓСЂРЅС‹Р№ РЅР° РјРѕР±РёР»СЊРЅС‹Р№ РєР°Рє Р·РІРµРЅРѕ С†РµРїРѕС‡РєРё (РµСЃР»Рё РЅРµ РѕС‚РІРµС‚РёР» РЅРёРєС‚Рѕ РёР· Р±СЂР°СѓР·РµСЂРЅС‹С…).
    if (pbxConfig.duty_mobile_fallback !== false) {
      const dutyMobile = await loadDutyMobile(client, dutyUserId);
      if (dutyMobile) {
        await session.setVariable('ASGARD_DUTY_MOBILE', dutyMobile);
        await session.setVariable('ASGARD_DUTY_MOBILE_TO', String(pbxConfig.mobile_ring_sec ?? 30));
      }
    }
    await session.setVariable('ASGARD_VM_MAX_SEC', String(pbxConfig.voicemail_max_sec ?? 60));

    // РџСЂРёРІРµС‚СЃС‚РІРёРµ РёР· РЅР°СЃС‚СЂРѕРµРє (Silero в†’ 8 kHz WAV) РїРµСЂРµРґ РґРѕР·РІРѕРЅРѕРј РѕРїРµСЂР°С‚РѕСЂР°Рј.
    // greeting_in_crm=false в†’ РїСЂРёРІРµС‚СЃС‚РІРёРµ РѕР·РІСѓС‡РёРІР°РµС‚ Mango IVR, Р·РґРµСЃСЊ РјРѕР»С‡РёРј.
    if (pbxConfig.greeting_in_crm !== false && pbxConfig.greeting_text) {
      try {
        const g = await ensurePrompt(pbxConfig.greeting_text);
        if (g) {
          await session.setVariable('ASGARD_GREETING', g);
          await session.answer();
          await session.streamFile(g);
        }
      } catch (e) {
        console.warn('[asgard-pbx] greeting synth failed:', e.message);
      }
    }
    await session.setVariable('ASGARD_FALLBACK_DIAL', dial.fallbackDial || '');
    await session.setVariable('ASGARD_FALLBACK_TIMEOUT', String(dial.fallbackTimeout || 20));
    await session.setVariable('ASGARD_CASCADE_3', dial.cascade3 || '');
    await session.setVariable('ASGARD_CASCADE_3_TO', String(dial.cascade3Timeout || 20));
    await session.setVariable('ASGARD_CASCADE_4', dial.cascade4 || '');
    await session.setVariable('ASGARD_CASCADE_4_TO', String(dial.cascade4Timeout || 20));
    await session.setVariable('ASGARD_CASCADE_5', dial.cascade5 || '');
    await session.setVariable('ASGARD_CASCADE_5_TO', String(dial.cascade5Timeout || 20));
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

async function notifyTransfer(db, payload) {
  if (!db || !payload) return;
  const c = await db.connect();
  try {
    await notifyRing(c, payload);
  } finally {
    c.release();
  }
}

/**
 * РќРѕСЂРјР°Р»РёР·Р°С†РёСЏ РЅРѕРјРµСЂР° РґР»СЏ Mango trunk: 8XXXXXXXXXX в†’ 7XXXXXXXXXX, +7 в†’ 7.
 */
function normalizeOutboundNumber(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('8')) d = '7' + d.slice(1);
  if (d.length === 11 && d.startsWith('7')) return d;
  return d;
}

/**
 * РЎРµСЂРІРµСЂРЅС‹Р№ РёСЃС…РѕРґСЏС‰РёР№ (РєР»РёРє-С‚Сѓ-РєРѕР»Р»): РїРѕРґРЅСЏС‚СЊ РєР°РЅР°Р» РѕРїРµСЂР°С‚РѕСЂР° Рё СЃРѕРµРґРёРЅРёС‚СЊ СЃ С‚СЂР°РЅРєРѕРј.
 * - WebRTC-РѕРїРµСЂР°С‚РѕСЂ Р·РІРѕРЅРёС‚ РёР· Р±СЂР°СѓР·РµСЂР° СЃР°Рј (JsSIP), СЃСЋРґР° РЅРµ РїРѕРїР°РґР°РµС‚.
 * - GSM-СЂРµР¶РёРј: Р·РІРѕРЅРёРј РЅР° mobile РѕРїРµСЂР°С‚РѕСЂР° С‡РµСЂРµР· Mango, РїРѕСЃР»Рµ РѕС‚РІРµС‚Р° вЂ” РЅР°Р±РёСЂР°РµРј РЅРѕРјРµСЂ
 *   РІ РєРѕРЅС‚РµРєСЃС‚Рµ outbound-crm (СЃРѕРµРґРёРЅРµРЅРёРµ СЃ РІРЅРµС€РЅРёРј РЅРѕРјРµСЂРѕРј С‡РµСЂРµР· С‚РѕС‚ Р¶Рµ С‚СЂР°РЅРє).
 */
async function originateOutbound(db, body) {
  const number = normalizeOutboundNumber(body.number || body.exten);
  if (!number) throw new Error('number required');
  if (!db) throw new Error('DATABASE_URL not set');

  const cfg = await loadPbxConfig(db);
  const line = cfg.outbound_line || '';
  const cli = line ? line.replace(/\D/g, '') : undefined;

  let channel = null;
  let op = null;
  if (body.user_id) {
    const { rows } = await db.query(
      `SELECT o.sip_username, o.webrtc_registered, o.receive_mode,
              COALESCE(NULLIF(BTRIM(o.mobile_phone), ''), NULLIF(BTRIM(u.phone), ''), NULLIF(BTRIM(ucs.fallback_mobile), '')) AS mobile_phone
       FROM pbx_operators o
       JOIN users u ON u.id = o.user_id
       LEFT JOIN user_call_status ucs ON ucs.user_id = o.user_id
       WHERE o.user_id = $1`,
      [body.user_id]
    );
    op = rows[0] || {};
    if (op.webrtc_registered && op.sip_username) {
      // WebRTC Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅ в†’ Р·РІРѕРЅРѕРє РёРґС‘С‚ РёР· Р±СЂР°СѓР·РµСЂР° (JsSIP) РЅР°РїСЂСЏРјСѓСЋ,
      // СЃРµСЂРІРµСЂРЅС‹Р№ originate РѕРїРµСЂР°С‚РѕСЂСѓ РЅРµ РЅСѓР¶РµРЅ (РёРЅР°С‡Рµ В«РґРІРѕР№РЅРѕР№ РЅР°Р±РѕСЂВ»).
      const err = new Error('РћРїРµСЂР°С‚РѕСЂ РЅР° WebRTC вЂ” Р·РІРѕРЅРѕРє РёРЅРёС†РёРёСЂСѓРµС‚СЃСЏ РёР· Р±СЂР°СѓР·РµСЂР°');
      err.statusCode = 409;
      err.via = 'webrtc';
      throw err;
    }
    if (op.mobile_phone) {
      channel = `PJSIP/${String(op.mobile_phone).replace(/[^\d]/g, '')}@mango-trunk`;
    }
  }
  if (!channel) {
    // Р‘РµР· user_id (РёР»Рё Р±РµР· РјРѕР±РёР»СЊРЅРѕРіРѕ) вЂ” РїСЂСЏРјРѕР№ РёСЃС…РѕРґСЏС‰РёР№ С‡РµСЂРµР· С‚СЂР°РЅРє:
    // СЃРѕС‚СЂСѓРґРЅРёРєСѓ РЅРµ РЅСѓР¶РµРЅ РЅРё WebRTC, РЅРё В«РЅР° Р»РёРЅРёРёВ», С‡С‚РѕР±С‹ РїРѕР·РІРѕРЅРёС‚СЊ РёР· CRM.
    channel = `PJSIP/${number}@mango-trunk`;
  }

  const ami = getAmiClient();
  const OriginateUniqueid = `asgard-out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await ami.originate({
    channel,
    context: 'outbound-crm',
    exten: number,
    priority: 1,
    callerId: cli || '',
    async: true,
    timeout: 45000,
    variable: `ASGARD_OUT_UID=${OriginateUniqueid}`,
  });

  if (db) {
    try {
      const c = await db.connect();
      try {
        await notifyRing(c, {
          event: 'call:outbound',
          user_id: body.user_id,
          data: { number, channel, direction: 'outbound' },
        });
      } finally { c.release(); }
    } catch (_) { /* ignore */ }
  }
  // Канал на транк (`…@mango-trunk`) — это GSM-плечо; WebRTC — только `PJSIP/<sip_username>`.
  const via = /@mango-trunk$/.test(channel) ? 'gsm' : 'webrtc';
  return { ok: true, number, channel, via, pbx_uid: OriginateUniqueid };
}

/**
 * Р РµР·РѕР»РІ С†РµР»Рё РїРµСЂРµРІРѕРґР° РІ Dial() tech/resource + return Рє РёРЅРёС†РёР°С‚РѕСЂСѓ.
 */
async function resolveTransferDial(db, body) {
  const empty = {
    dial: '',
    timeout: 30,
    fallback: '',
    fallbackTimeout: 20,
    returnDial: '',
    returnTimeout: 30,
    targets: [],
  };
  if (!db || !body) return empty;
  const targetRaw = body.target;
  if (targetRaw == null || targetRaw === '') return empty;

  const client = await db.connect();
  try {
    const cfg = await loadPbxConfig(client);
    let op = null;
    const asNum = Number(targetRaw);
    if (Number.isFinite(asNum) && asNum > 0 && String(asNum) === String(targetRaw).trim()) {
      const { rows } = await client.query(
        `SELECT o.*, 
                COALESCE(NULLIF(BTRIM(o.mobile_phone), ''), NULLIF(BTRIM(u.phone), ''), NULLIF(BTRIM(ucs.fallback_mobile), '')) AS mobile_phone
         FROM pbx_operators o
         JOIN users u ON u.id = o.user_id
         LEFT JOIN user_call_status ucs ON ucs.user_id = o.user_id
         WHERE o.user_id = $1`,
        [asNum]
      );
      op = rows[0] || null;
    }
    if (!op) {
      const digits = String(targetRaw).replace(/\D/g, '');
      if (digits) {
        const { rows } = await client.query(
          `SELECT o.*,
                  COALESCE(NULLIF(BTRIM(o.mobile_phone), ''), NULLIF(BTRIM(u.phone), ''), NULLIF(BTRIM(ucs.fallback_mobile), '')) AS mobile_phone
           FROM pbx_operators o
           JOIN users u ON u.id = o.user_id
           LEFT JOIN user_call_status ucs ON ucs.user_id = o.user_id
           WHERE o.sip_username = $1
              OR regexp_replace(COALESCE(o.mobile_phone,''), '\\D', '', 'g') = $2
              OR regexp_replace(COALESCE(u.phone,''), '\\D', '', 'g') = $2
           LIMIT 1`,
          [String(targetRaw), digits]
        );
        op = rows[0] || null;
      }
    }

    let targets = [];
    if (op) {
      const fakeOn = { ...op, on_line: true, can_accept: true };
      // Р”Р»СЏ РїРµСЂРµРІРѕРґР° РґРѕРїСѓСЃРєР°РµРј webrtc РґР°Р¶Рµ Р±РµР· heartbeat, РµСЃР»Рё registered;
      // РёРЅР°С‡Рµ GSM. РџРѕРґРЅРёРјР°РµРј last_seen РµСЃР»Рё registered.
      if (op.webrtc_registered && op.sip_username) {
        fakeOn.last_seen_at = new Date().toISOString();
      }
      targets = resolveTransferTargets(fakeOn, cfg, new Date());
      if (!targets.length && op.mobile_phone) {
        targets = expandOperatorTargets(
          { ...fakeOn, receive_mode: 'mobile', webrtc_registered: false },
          cfg,
          Date.now()
        );
      }
    } else if (/^[A-Za-z0-9_.-]+$/.test(String(targetRaw)) && !/^\d+$/.test(String(targetRaw))) {
      // СЃС‹СЂРѕР№ sip username
      targets = [{
        userId: 0,
        targetType: 'webrtc',
        targetAddr: String(targetRaw),
        role: 'ring',
        ringSec: cfg.browser_ring_sec ?? 5,
        sortOrder: 0,
      }];
    } else {
      const digits = String(targetRaw).replace(/\D/g, '');
      if (digits) {
        targets = [{
          userId: 0,
          targetType: 'mobile',
          targetAddr: digits,
          role: 'ring',
          ringSec: cfg.mobile_ring_sec ?? 20,
          sortOrder: 0,
        }];
      }
    }

    const dialVars = buildDialVars(targets, { ...cfg, parallel_ring: false, routing_mode: 'ordered' });
    let returnDial = '';
    if (body.user_id) {
      const { rows: initRows } = await client.query(
        `SELECT o.sip_username, o.webrtc_registered, o.receive_mode,
                COALESCE(NULLIF(BTRIM(o.mobile_phone), ''), NULLIF(BTRIM(u.phone), ''), NULLIF(BTRIM(ucs.fallback_mobile), '')) AS mobile_phone
         FROM pbx_operators o
         JOIN users u ON u.id = o.user_id
         LEFT JOIN user_call_status ucs ON ucs.user_id = o.user_id
         WHERE o.user_id = $1`,
        [body.user_id]
      );
      const init = initRows[0];
      if (init?.sip_username) {
        returnDial = `PJSIP/${init.sip_username}`;
      } else if (init?.mobile_phone) {
        returnDial = targetToDialPart({
          targetType: 'mobile',
          targetAddr: init.mobile_phone,
        }) || '';
      }
    }

    return {
      dial: dialVars.dialString || '',
      timeout: dialVars.ringTimeout || 30,
      fallback: dialVars.fallbackDial || '',
      fallbackTimeout: dialVars.fallbackTimeout || 20,
      returnDial,
      returnTimeout: 30,
      targets,
    };
  } finally {
    client.release();
  }
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
    // Hangup finalize + health: loopback-only, allow without secret вЂ”
    // Asterisk ${ENV(PBX_CMD_SECRET)} С‡Р°СЃС‚Рѕ РЅРµ РІРёРґРёС‚ pbx.env asgard-pbx.
    // РћСЃС‚Р°Р»СЊРЅС‹Рµ CMD (AMI answer/hangup/вЂ¦) вЂ” С‚РѕР»СЊРєРѕ СЃ СЃРѕРІРїР°РґРµРЅРёРµРј secret.
    const openPaths = url.pathname === '/recording/finalize' || url.pathname === '/health';
    if (!openPaths) {
      if (!config.pbxCmdSecret || secret !== config.pbxCmdSecret) {
        res.writeHead(401);
        res.end('Unauthorized');
        return;
      }
    } else if (config.pbxCmdSecret && secret && secret !== config.pbxCmdSecret) {
      // If client sends a wrong secret on open path вЂ” still reject (tamper signal)
      res.writeHead(401);
      res.end('Unauthorized');
      return;
    }

    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };

    // Р”РёР°РіРЅРѕСЃС‚РёРєР°: РІРёРґРµС‚СЊ, РґРѕС…РѕРґСЏС‚ Р»Рё РІРЅСѓС‚СЂРµРЅРЅРёРµ РІС‹Р·РѕРІС‹ (dialplan h-curl, AMI-С…СѓРєРё).
    if (process.env.PBX_CMD_DEBUG === '1') {
      console.log(`[cmd] ${req.method} ${url.pathname} from ${remote}`);
    }

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
        // РљР»РёРє-С‚Сѓ-РєРѕР»Р» РёР· CRM: { number, user_id } в†’ СЃРµСЂРІРµСЂРЅС‹Р№ originate С‡РµСЂРµР· С‚СЂР°РЅРє.
        if (!body.channel && (body.number || body.exten)) {
          const r = await originateOutbound(db, body);
          return send(200, r);
        }
        const r = await ami.originate(body);
        return send(200, { ok: true, ami: r });
      }
      if (req.method === 'POST' && url.pathname === '/call/hangup') {
        if (!amiConfigured()) throw new Error('AMI not configured');
        // РЎР±СЂРѕСЃ РІСЃРµС… РїР»РµС‡ Р·РІРѕРЅРєР°: РёС‰РµРј РєР°РЅР°Р»С‹ РїРѕ pbx_uid (Linkedid/Uniqueid) Рё
        // СЃРЅРёРјР°РµРј РёС…; `channel` вЂ” С‡Р°СЃС‚РЅС‹Р№ СЃР»СѓС‡Р°Р№, РєРѕРіРґР° РєР»РёРµРЅС‚ Р·РЅР°РµС‚ СЃРІРѕС‘ РїР»РµС‡Рѕ.
        const uid = String(body.pbx_uid || body.call_id || '').replace(/^pbx_/, '');
        const wantChannel = String(body.channel || '');
        // WebRTC: клиент шлёт BYE сам, но если сессия зависла — снимаем плечо по
        // SIP-эндпоинту оператора (`PJSIP/<sip_username>`).
        let sipUser = '';
        if (body.user_id && db) {
          try {
            const r = await db.query('SELECT sip_username FROM pbx_operators WHERE user_id = $1', [body.user_id]);
            sipUser = String((r.rows[0] || {}).sip_username || '');
          } catch (_) { /* ignore */ }
        }
        let hung = 0;
        if (uid || wantChannel || sipUser) {
          try {
            const res = await ami.coreShowChannels();
            const channels = (res && res.List && Array.isArray(res.List)) ? res.List : [];
            for (const ch of channels) {
              const name = String(ch.Channel || '');
              const linked = String(ch.Linkedid || '');
              const unique = String(ch.Uniqueid || '');
              const byUid = uid && (linked === uid || unique === uid);
              // Клиент шлёт dial-string («PJSIP/79…@mango-trunk»), а живой канал
              // называется с суффиксом («…-0000001») — сверяем и по префиксу.
              const byChannel = wantChannel && (name === wantChannel || name.indexOf(wantChannel + '-') === 0);
              const bySip = sipUser && (name === 'PJSIP/' + sipUser || name.indexOf('PJSIP/' + sipUser + '-') === 0);
              if (byUid || byChannel || bySip) {
                try { await ami.hangup(name); hung += 1; } catch (_) { /* next */ }
              }
            }
          } catch (_) { /* fall through to single channel */ }
        }
        if (wantChannel && !hung) {
          try { await ami.hangup(wantChannel); hung += 1; } catch (_) { /* ignore */ }
        }
        if (!hung && !body.channel && !uid && !sipUser) {
          return send(200, { ok: true, skipped: true, reason: 'no_channel' });
        }
        return send(200, { ok: true, hung });
      }
      if (req.method === 'POST' && url.pathname === '/call/redirect') {
        if (!amiConfigured()) throw new Error('AMI not configured');
        await ami.redirect(body.channel, body.context || 'transfer', body.exten || 'blind', body.priority || 1);
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/call/bridge') {
        if (!amiConfigured()) throw new Error('AMI not configured');
        // Softphone answer: bridge client channel with agent channel if both given;
        // otherwise Redirect agent session is already bridged by Dial вЂ” just ACK + mark answered.
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
        const resolved = await resolveTransferDial(db, body);
        const xferNotify = {
          event: 'call:transfer',
          user_id: body.user_id,
          data: {
            status: 'trying',
            mode,
            target: body.target,
            dial: resolved.dial,
            return_dial: resolved.returnDial,
          },
        };
        if (mode === 'consult') {
          await ami.redirect(body.channel, 'hold', 's', 1);
          const consultChan = resolved.dial || (body.target
            ? (String(body.target).includes('/') ? body.target : `PJSIP/${body.target}`)
            : null);
          if (consultChan) {
            await ami.originate({
              channel: consultChan,
              context: 'transfer',
              exten: 'consult',
              priority: 1,
              async: true,
              variable: [
                `CONSULT_TARGET=${body.target || ''}`,
                `TRANSFER_DIAL=${resolved.dial || ''}`,
                `TRANSFER_TIMEOUT=${resolved.timeout || 30}`,
              ].join(','),
            });
          }
        } else {
          await ami.setVar(body.channel, 'TRANSFER_TARGET', body.target || '');
          await ami.setVar(body.channel, 'TRANSFER_DIAL', resolved.dial || '');
          await ami.setVar(body.channel, 'TRANSFER_TIMEOUT', String(resolved.timeout || 30));
          await ami.setVar(body.channel, 'TRANSFER_FALLBACK', resolved.fallback || '');
          await ami.setVar(body.channel, 'TRANSFER_FALLBACK_TO', String(resolved.fallbackTimeout || 20));
          await ami.setVar(body.channel, 'TRANSFER_RETURN_DIAL', resolved.returnDial || '');
          await ami.setVar(body.channel, 'TRANSFER_RETURN_TO', String(resolved.returnTimeout || 30));
          await ami.redirect(body.channel, 'transfer', 'blind', 1);
        }
        try { await notifyTransfer(db, xferNotify); } catch (_) { /* ignore */ }
        return send(200, { ok: true, mode, transfer: resolved });
      }
      if (req.method === 'POST' && url.pathname === '/operator/maintenance') {
        if (!db) throw new Error('DATABASE_URL not set');
        const activeIds = [...activeChannels.values()].map((v) => v.userId).filter(Boolean);
        const result = await runOperatorMaintenance(db, {
          now: body.now ? new Date(body.now) : new Date(),
          activeUserIds: activeIds,
        });
        return send(200, { ok: true, ...result });
      }
      if (req.method === 'POST' && url.pathname === '/call/hold') {
        if (!amiConfigured()) throw new Error('AMI not configured');
        if (!body.channel) {
          // GSM-СЂРµР¶РёРј: СѓРґРµСЂР¶РёРІР°С‚СЊ РІ Asterisk РЅРµС‡РµРіРѕ.
          return send(200, { ok: true, skipped: true, reason: 'no_channel' });
        }
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
      if (req.method === 'POST' && url.pathname === '/recording/voicemail') {
        const r = await saveVoicemail(db, body);
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
    const tick = async () => {
      try {
        const activeIds = [...activeChannels.values()].map((v) => v.userId).filter(Boolean);
        await runOperatorMaintenance(db, { activeUserIds: activeIds });
      } catch (e) {
        console.warn('[asgard-pbx] maintenance:', e.message);
      }
    };
    maintenanceTimer = setInterval(tick, 60 * 1000);
    if (typeof maintenanceTimer.unref === 'function') maintenanceTimer.unref();

    // Р“Р°СЂР°РЅС‚РёСЂРѕРІР°РЅРЅР°СЏ РїСЂРёРІСЏР·РєР° Р·Р°РїРёСЃРµР№: h-С…СѓРє/AMI-СЃРѕР±С‹С‚РёРµ РјРѕРіСѓС‚ РЅРµ РґРѕР»РµС‚РµС‚СЊ
    // (MixMonitor СЃР±СЂР°СЃС‹РІР°РµС‚ WAV РїРѕР·Р¶Рµ, curl РёР· dialplan РЅРµ РІСЃРµРіРґР° РїСЂРѕС…РѕРґРёС‚).
    const recTick = async () => {
      try {
        const r = await sweepRecordings(db, { lookbackMinutes: 20, limit: 30 });
        if (r.attached && r.attached.length) {
          console.log('[asgard-pbx] recordings attached:', r.attached.join(','));
        }
      } catch (e) {
        console.warn('[asgard-pbx] recording sweep:', e.message);
      }
    };
    recordingTimer = setInterval(recTick, 45 * 1000);
    if (typeof recordingTimer.unref === 'function') recordingTimer.unref();
    recTick();
  }

  if (amiConfigured()) {
    const ami = getAmiClient();
    ami
      .connect()
      .then(() => {
        console.log('[asgard-pbx] AMI connected');
        // Backup path if dialplan `h`/curl missed: Hangup в†’ finalize by Uniqueid
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
    console.warn('[asgard-pbx] AMI not configured вЂ” dial-engine via API only');
  }
}

async function stop() {
  if (maintenanceTimer) {
    clearInterval(maintenanceTimer);
    maintenanceTimer = null;
  }
  if (recordingTimer) {
    clearInterval(recordingTimer);
    recordingTimer = null;
  }
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
  resolveTransferDial,
  originateOutbound,
  normalizeOutboundNumber,
  runOperatorMaintenance,
  ensurePrompt,
};
