/**
 * ASGARD CRM вЂ” Mimir Conductor: HTTP/SSE СЂРѕСѓС‚С‹ (РЎРµСЃСЃРёСЏ 2, РЁР°Рі 2.9)
 * в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
 * Р РµРіРёСЃС‚СЂРёСЂСѓРµС‚СЃСЏ РЅР° С‚РѕРј Р¶Рµ РїСЂРµС„РёРєСЃРµ /api/mimir, С‡С‚Рѕ Рё СЃС‚Р°СЂС‹Р№ mimir.js, РЅРѕ СЃ
 * РЅРµРїРµСЂРµСЃРµРєР°СЋС‰РёРјРёСЃСЏ РїСѓС‚СЏРјРё /conductor/*. РЎС‚Р°СЂС‹Р№ РњРёРјРёСЂ РЅРµ С‚СЂРѕРіР°РµРј.
 *
 *   POST /api/mimir/conductor/start          вЂ” Р·Р°РїСѓСЃС‚РёС‚СЊ РїСЂРѕСЃС‡С‘С‚ (СЂРѕР»СЊ-РіРµР№С‚)
 *   GET  /api/mimir/conductor/events         вЂ” SSE-РїРѕС‚РѕРє War Room (auth ?token=)
 *   GET  /api/mimir/conductor/run/:id        вЂ” РґРµС‚Р°Р»Рё РїСЂРѕРіРѕРЅР°
 *   GET  /api/mimir/conductor/artifact/:id   вЂ” РѕРґРёРЅ Р°СЂС‚РµС„Р°РєС‚
 *
 * Р¤РёС‡Р°-С„Р»Р°Рі РћРўРњР•РќРЃРќ: РґРѕСЃС‚СѓРї С‚РѕР»СЊРєРѕ РїРѕ СЂРѕР»СЏРј С‡РµСЂРµР· fastify.requireRoles([...]).
 * AI-РІС‹Р·РѕРІС‹ РІРЅСѓС‚СЂРё runConductor РёРґСѓС‚ С‡РµСЂРµР· ai-provider (РІ dev вЂ” stub-СЂРµР¶РёРј).
 * в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
 */

'use strict';

const fs = require('fs');
const path = require('path');
const cr = require('../services/mimir-conductor/conductor-run');
const { runConductor } = require('../services/mimir-conductor/conductor');
const { generateClarificationLetter, getLetterById, LETTERS_DIR } = require('../services/mimir-conductor/letter-generator');
const { parseReplyAndMap } = require('../services/mimir-conductor/reply-parser');
const { applyAnswers, resumeConductorIfBlocked } = require('../services/mimir-conductor/apply-answers');
const { generateDirectorReport } = require('../services/mimir-conductor/director-report');

// Р РѕР»Рё, РєРѕС‚РѕСЂС‹Рј СЂР°Р·СЂРµС€С‘РЅ Р·Р°РїСѓСЃРє Conductor (ADMIN РїСЂРѕС…РѕРґРёС‚ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё,
// HEAD_* РЅР°СЃР»РµРґСѓСЋС‚ вЂ” СЌС‚Рѕ СѓР¶Рµ РІСЃС‚СЂРѕРµРЅРѕ РІ fastify.requireRoles).
const ALLOWED_ROLES = [
  'PM', 'HEAD_PM', 'TO', 'HEAD_TO',
  'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'
];

// Р РѕР»Рё В«РІСЃРµРІРёРґСЏС‰РµРіРѕВ» РґРѕСЃС‚СѓРїР°: СЂСѓРєРѕРІРѕРґСЃС‚РІРѕ Рё РґРёСЂРµРєС‚РѕСЂР° С‡РёС‚Р°СЋС‚ Р›Р®Р‘РћР™ РїСЂРѕСЃС‡С‘С‚.
// РћСЃС‚Р°Р»СЊРЅС‹Рµ СЂРѕР»Рё РёР· ALLOWED_ROLES РІРёРґСЏС‚ С‚РѕР»СЊРєРѕ СЃРІРѕРё (initiated_by === user.id).
const SUPERVISOR_ROLES = new Set([
  'ADMIN', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'CHIEF_ENGINEER'
]);

/**
 * РџСЂРѕРІРµСЂРєР° РґРѕСЃС‚СѓРїР° Рє РєРѕРЅРєСЂРµС‚РЅРѕРјСѓ РїСЂРѕРіРѕРЅСѓ: РІР»Р°РґРµР»РµС† РР›Р СЃСѓРїРµСЂРІРёР·РѕСЂСЃРєР°СЏ СЂРѕР»СЊ.
 * @returns {boolean}
 */
function canAccessRun(user, run) {
  if (!user || !run) return false;
  if (SUPERVISOR_ROLES.has(user.role)) return true;
  return Number(run.initiated_by) === Number(user.id);
}

// РўРµСЂРјРёРЅР°Р»СЊРЅС‹Рµ СЃС‚Р°С‚СѓСЃС‹ РїСЂРѕРіРѕРЅР° вЂ” РЅР° РЅРёС… SSE Р·Р°РєСЂС‹РІР°РµС‚ РїРѕС‚РѕРє.
const TERMINAL_STATUSES = new Set([
  'READY_FOR_REVIEW', 'ERROR', 'APPROVED', 'REJECTED'
]);

// РћС‚РІРµС‚ Р·Р°РєР°Р·С‡РёРєР° РЅР° РїРёСЃСЊРјРѕ: РґРѕРїСѓСЃС‚РёРјС‹Рµ MIME Рё Р»РёРјРёС‚ СЂР°Р·РјРµСЂР° (РЎРµСЃСЃРёСЏ 08, fix #3).
// D-220b: СЃР°Рј СЃРїРёСЃРѕРє С‚РµРїРµСЂСЊ РЅРµ СЂРµС€Р°РµС‚ СЃСѓРґСЊР±Сѓ С„Р°Р№Р»Р° вЂ” РєР°РЅРѕРЅРёС‡РЅРѕРµ СЂР°СЃС€РёСЂРµРЅРёРµ РѕРїСЂРµРґРµР»СЏРµС‚
// `safeStoredExt` (СЃРј. РЅРёР¶Рµ), РєРѕС‚РѕСЂС‹Р№ РїРѕРєСЂС‹РІР°РµС‚ СЌС‚Рё Р¶Рµ С‚РёРїС‹ Рё РѕС‚Р±РёРІР°РµС‚ .html/.svg/РїСѓСЃС‚РѕР№ MIME.
const MAX_REPLY_BYTES = 50 * 1024 * 1024; // 50 MB

async function mimirConductorRoutes(fastify, options) {
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // POST /conductor/start вЂ” СЃРѕР·РґР°С‚СЊ РїСЂРѕРіРѕРЅ Рё Р·Р°РїСѓСЃС‚РёС‚СЊ РµРіРѕ (fire-and-forget)
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  fastify.post('/conductor/start', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const user = request.user;
    const body = request.body || {};
    const workId = body.work_id ?? null;
    const tenderId = body.tender_id ?? null;
    const estimateId = body.estimate_id ?? null;
    const profile = body.profile || 'STANDARD';

    if (!workId && !tenderId && !estimateId) {
      return reply.code(400).send({
        error: 'РќСѓР¶РµРЅ С…РѕС‚СЏ Р±С‹ РѕРґРёРЅ РёР·: work_id, tender_id, estimate_id'
      });
    }

    let contractValue = body.contract_value ?? null;

    // Р•СЃР»Рё Р·Р°РґР°РЅ work_id вЂ” РїРѕРґС‚СЏРЅРµРј РєРѕРЅС‚СЂР°РєС‚РЅСѓСЋ СЃС‚РѕРёРјРѕСЃС‚СЊ РёР· works.
    if (workId && contractValue == null) {
      try {
        const wr = await fastify.db.query(
          'SELECT contract_value FROM works WHERE id = $1',
          [workId]
        );
        if (wr.rows.length) contractValue = wr.rows[0].contract_value;
      } catch (e) {
        request.log.warn(`[conductor/start] work lookup failed: ${e.message}`);
      }
    }

    let run;
    try {
      run = await cr.createRun({
        workId, tenderId, estimateId,
        initiatedBy: user.id,
        profile,
        contractValue
      });
    } catch (e) {
      request.log.error(`[conductor/start] createRun failed: ${e.message}`);
      return reply.code(500).send({ error: 'РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕР·РґР°С‚СЊ РїСЂРѕРіРѕРЅ' });
    }

    const runId = run.runId;

    // mode РёР· body вЂ” РјРѕР¶РµС‚ Р±С‹С‚СЊ 'deterministic' (С„РёРєСЃРёСЂРѕРІР°РЅРЅС‹Р№ pipeline 29 С€Р°РіРѕРІ)
    // РёР»Рё 'conductor' / undefined (LLM-orchestrator). РџРµСЂРµРґР°С‘Рј РґР°Р»СЊС€Рµ РІ runConductor.
    const mode = String(request.body?.mode || '').toLowerCase() === 'deterministic'
      ? 'deterministic' : 'conductor';

    // Fire-and-forget: РЅРµ Р±Р»РѕРєРёСЂСѓРµРј РѕС‚РІРµС‚. РћС€РёР±РєРё РІРЅСѓС‚СЂРё loop в†’ СЃС‚Р°С‚СѓСЃ ERROR.
    setImmediate(() => {
      runConductor(runId, { mode }).catch(async (err) => {
        try {
          await cr.updateRunStatus(runId, 'ERROR', {
            errorMessage: String(err && err.message ? err.message : err)
          });
          await cr.addEvent(runId, null, 'error', {
            message: String(err && err.message ? err.message : err),
            stage: 'runConductor'
          });
        } catch (inner) {
          request.log.error(`[conductor] РЅРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РїРёСЃР°С‚СЊ ERROR РґР»СЏ run ${runId}: ${inner.message}`);
        }
      });
    });

    return reply.code(202).send({ run_id: runId, status: run.status });
  });

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // GET /conductor/events?run_id=&since_event_id= вЂ” SSE War Room
  // РђРІС‚РѕСЂРёР·Р°С†РёСЏ С‡РµСЂРµР· ?token= (EventSource РЅРµ С€Р»С‘С‚ Р·Р°РіРѕР»РѕРІРєРё).
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  fastify.get('/conductor/events', async (request, reply) => {
    const token = request.query.token;
    if (!token) return reply.code(401).send({ error: 'token_required', message: 'РўСЂРµР±СѓРµС‚СЃСЏ РІС…РѕРґ РІ СЃРёСЃС‚РµРјСѓ.', hint: 'Р’РѕР№РґРёС‚Рµ Р·Р°РЅРѕРІРѕ Рё РїРѕРІС‚РѕСЂРёС‚Рµ РґРµР№СЃС‚РІРёРµ.' });

    let tokenUser;
    try {
      tokenUser = fastify.jwt.verify(token);
    } catch (err) {
      return reply.code(401).send({ error: 'invalid_token', message: 'РЎРµСЃСЃРёСЏ РЅРµРґРµР№СЃС‚РІРёС‚РµР»СЊРЅР°.', hint: 'Р’РѕР№РґРёС‚Рµ Р·Р°РЅРѕРІРѕ Рё РїРѕРІС‚РѕСЂРёС‚Рµ РґРµР№СЃС‚РІРёРµ.' });
    }

    // Р РѕР»СЊ-РіРµР№С‚ (preHandler Р·РґРµСЃСЊ РЅРµ РїСЂРёРјРµРЅРёРј вЂ” Р°РІС‚РѕСЂРёР·Р°С†РёСЏ С‡РµСЂРµР· ?token=).
    if (!(tokenUser.role === 'ADMIN' || ALLOWED_ROLES.includes(tokenUser.role))) {
      return reply.code(403).send({ error: 'РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РїСЂР°РІ' });
    }

    const runId = Number(request.query.run_id);
    if (!Number.isInteger(runId) || runId <= 0) {
      return reply.code(400).send({ error: 'run_id_required', message: 'РќРµ СѓРєР°Р·Р°РЅ РїСЂРѕСЃС‡С‘С‚.', hint: 'Р’С‹Р±РµСЂРёС‚Рµ РїСЂРѕСЃС‡С‘С‚ РёР· СЃРїРёСЃРєР° Рё РїРѕРІС‚РѕСЂРёС‚Рµ.' });
    }

    // РџСЂРѕРІРµСЂРёРј, С‡С‚Рѕ РїСЂРѕРіРѕРЅ СЃСѓС‰РµСЃС‚РІСѓРµС‚.
    const run = await cr.getRun(runId);
    if (!run) return reply.code(404).send({ error: 'run_not_found', message: 'РџСЂРѕСЃС‡С‘С‚ РЅРµ РЅР°Р№РґРµРЅ.', hint: 'РћР±РЅРѕРІРёС‚Рµ СЃС‚СЂР°РЅРёС†Сѓ вЂ” РІРѕР·РјРѕР¶РЅРѕ, РїСЂРѕСЃС‡С‘С‚ СѓРґР°Р»С‘РЅ.' });

    // Р”РѕСЃС‚СѓРї вЂ” РІР»Р°РґРµР»РµС† РїСЂРѕРіРѕРЅР° РР›Р СЃСѓРїРµСЂРІРёР·РѕСЂСЃРєР°СЏ СЂРѕР»СЊ.
    if (!canAccessRun(tokenUser, run)) {
      return reply.code(403).send({ error: 'РќРµС‚ РґРѕСЃС‚СѓРїР° Рє СЌС‚РѕРјСѓ РїСЂРѕСЃС‡С‘С‚Сѓ' });
    }

    const raw = reply.raw;

    reply.hijack();
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no' // nginx
    });

    let lastEventId = Number(request.query.since_event_id) || 0;
    let closed = false;

    const safeWrite = (str) => {
      if (closed) return false;
      try { raw.write(str); return true; } catch (_) { closed = true; return false; }
    };

    safeWrite(`event: connected\ndata: ${JSON.stringify({ run_id: runId, status: run.status, ts: Date.now() })}\n\n`);

    // Р”РѕСЃС‹Р»РєР° РЅРѕРІС‹С… СЃРѕР±С‹С‚РёР№ + Р·Р°РєСЂС‹С‚РёРµ РЅР° С‚РµСЂРјРёРЅР°Р»СЊРЅРѕРј СЃС‚Р°С‚СѓСЃРµ.
    const flush = async () => {
      if (closed) return;
      try {
        const events = await cr.listEvents(runId, lastEventId, 500);
        for (const ev of events) {
          lastEventId = Number(ev.id);
          const payload = `id: ${ev.id}\nevent: ${ev.event_type}\ndata: ${JSON.stringify(ev)}\n\n`;
          if (!safeWrite(payload)) return;
        }
        const cur = await cr.getRun(runId);
        if (cur && TERMINAL_STATUSES.has(cur.status)) {
          safeWrite(`event: complete\ndata: ${JSON.stringify({ run_id: runId, status: cur.status })}\n\n`);
          cleanup();
        }
      } catch (e) {
        request.log.error(`[conductor/events] flush error run ${runId}: ${e.message}`);
      }
    };

    const poller = setInterval(flush, 500);
    const heartbeat = setInterval(() => {
      safeWrite(`: heartbeat ${Date.now()}\n\n`);
    }, 30000);

    function cleanup() {
      if (closed) return;
      closed = true;
      clearInterval(poller);
      clearInterval(heartbeat);
      try { raw.end(); } catch (_) { /* noop */ }
    }

    request.raw.on('close', cleanup);

    // РџРµСЂРІС‹Р№ catch-up СЃСЂР°Р·Сѓ.
    flush();

    // Long-lived: РЅРµ РІС‹Р·С‹РІР°РµРј reply.send().
  });

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // GET /conductor/run/:id вЂ” РґРµС‚Р°Р»Рё РїСЂРѕРіРѕРЅР°
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  fastify.get('/conductor/run/:id', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const runId = Number(request.params.id);
    if (!Number.isInteger(runId) || runId <= 0) {
      return reply.code(400).send({ error: 'invalid_run_id', message: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ РїСЂРѕСЃС‡С‘С‚Р°.', hint: 'РћР±РЅРѕРІРёС‚Рµ СЃС‚СЂР°РЅРёС†Сѓ Рё РѕС‚РєСЂРѕР№С‚Рµ РїСЂРѕСЃС‡С‘С‚ Р·Р°РЅРѕРІРѕ.' });
    }
    const details = await cr.getFullRunDetails(runId);
    if (!details) return reply.code(404).send({ error: 'run_not_found', message: 'РџСЂРѕСЃС‡С‘С‚ РЅРµ РЅР°Р№РґРµРЅ.', hint: 'РћР±РЅРѕРІРёС‚Рµ СЃС‚СЂР°РЅРёС†Сѓ вЂ” РІРѕР·РјРѕР¶РЅРѕ, РїСЂРѕСЃС‡С‘С‚ СѓРґР°Р»С‘РЅ.' });
    if (!canAccessRun(request.user, details.run)) {
      return reply.code(403).send({ error: 'РќРµС‚ РґРѕСЃС‚СѓРїР° Рє СЌС‚РѕРјСѓ РїСЂРѕСЃС‡С‘С‚Сѓ' });
    }
    // Required-Р°РіРµРЅС‚С‹ РґР»СЏ РїСЂРѕРіСЂРµСЃСЃ-Р±Р°СЂР° UI
    try {
      const hardRules = require('../services/mimir-conductor/hard-rules');
      const tzArt = (details.artifacts || []).find((a) => a.artifact_type === 'tz_summary');
      const tzSummary = tzArt ? tzArt.content : null;
      const required = hardRules.getRequiredAgents(tzSummary, details.run.contract_value, details.run.complexity_flags || {});
      const successAgents = (details.agent_runs || [])
        .filter((ar) => ar.status === 'SUCCESS')
        .map((ar) => ar.agent_name);
      const completedRequired = required.filter((a) => successAgents.includes(a));
      details.progress = {
        required_agents: required,
        completed_required: completedRequired,
        progress_pct: required.length ? Math.round((completedRequired.length / required.length) * 100) : 0
      };
    } catch (e) { /* progress РЅРµ РєСЂРёС‚РёС‡РµРЅ */ }
    return details;
  });

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // РЎР•РЎРЎРРЇ 7 вЂ” Р”РёСЂРµРєС‚РѕСЂСЃРєРёР№ РѕС‚С‡С‘С‚ (PDF)
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

  // POST /conductor/run/:id/generate-report вЂ” СЃРіРµРЅРµСЂРёСЂРѕРІР°С‚СЊ РґРёСЂРµРєС‚РѕСЂСЃРєРёР№ PDF
  fastify.post('/conductor/run/:id/generate-report', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const runId = Number(request.params.id);
    if (!Number.isInteger(runId) || runId <= 0) {
      return reply.code(400).send({ error: 'invalid_run_id', message: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ РїСЂРѕСЃС‡С‘С‚Р°.', hint: 'РћР±РЅРѕРІРёС‚Рµ СЃС‚СЂР°РЅРёС†Сѓ Рё РѕС‚РєСЂРѕР№С‚Рµ РїСЂРѕСЃС‡С‘С‚ Р·Р°РЅРѕРІРѕ.' });
    }
    const run = await cr.getRun(runId);
    if (!run) return reply.code(404).send({ error: 'run_not_found', message: 'РџСЂРѕСЃС‡С‘С‚ РЅРµ РЅР°Р№РґРµРЅ.', hint: 'РћР±РЅРѕРІРёС‚Рµ СЃС‚СЂР°РЅРёС†Сѓ вЂ” РІРѕР·РјРѕР¶РЅРѕ, РїСЂРѕСЃС‡С‘С‚ СѓРґР°Р»С‘РЅ.' });
    // РћС‚С‡С‘С‚ СЃС‚СЂРѕРёС‚СЃСЏ РїРѕ РіРѕС‚РѕРІРѕРјСѓ РїСЂРѕСЃС‡С‘С‚Сѓ.
    if (!['READY_FOR_REVIEW', 'APPROVED', 'REJECTED'].includes(run.status)) {
      return reply.code(409).send({
        error: `РћС‚С‡С‘С‚ РјРѕР¶РЅРѕ СЃРіРµРЅРµСЂРёСЂРѕРІР°С‚СЊ С‚РѕР»СЊРєРѕ РїРѕ Р·Р°РІРµСЂС€С‘РЅРЅРѕРјСѓ РїСЂРѕСЃС‡С‘С‚Сѓ (СЃС‚Р°С‚СѓСЃ: ${run.status})`
      });
    }
    try {
      const { pdfPath } = await generateDirectorReport(runId);
      return { ok: true, run_id: runId, report_path: pdfPath };
    } catch (e) {
      request.log.error(`[conductor/generate-report] run ${runId}: ${e.message}`);
      return reply.code(500).send({ error: `РќРµ СѓРґР°Р»РѕСЃСЊ СЃРіРµРЅРµСЂРёСЂРѕРІР°С‚СЊ РѕС‚С‡С‘С‚: ${e.message}` });
    }
  });

  // GET /conductor/run/:id/report вЂ” СЃРєР°С‡Р°С‚СЊ СЃРіРµРЅРµСЂРёСЂРѕРІР°РЅРЅС‹Р№ PDF
  fastify.get('/conductor/run/:id/report', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const runId = Number(request.params.id);
    if (!Number.isInteger(runId) || runId <= 0) {
      return reply.code(400).send({ error: 'invalid_run_id', message: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ РїСЂРѕСЃС‡С‘С‚Р°.', hint: 'РћР±РЅРѕРІРёС‚Рµ СЃС‚СЂР°РЅРёС†Сѓ Рё РѕС‚РєСЂРѕР№С‚Рµ РїСЂРѕСЃС‡С‘С‚ Р·Р°РЅРѕРІРѕ.' });
    }
    const run = await cr.getRun(runId);
    if (!run) return reply.code(404).send({ error: 'run_not_found', message: 'РџСЂРѕСЃС‡С‘С‚ РЅРµ РЅР°Р№РґРµРЅ.', hint: 'РћР±РЅРѕРІРёС‚Рµ СЃС‚СЂР°РЅРёС†Сѓ вЂ” РІРѕР·РјРѕР¶РЅРѕ, РїСЂРѕСЃС‡С‘С‚ СѓРґР°Р»С‘РЅ.' });
    if (!canAccessRun(request.user, run)) {
      return reply.code(403).send({ error: 'РќРµС‚ РґРѕСЃС‚СѓРїР° Рє СЌС‚РѕРјСѓ РѕС‚С‡С‘С‚Сѓ' });
    }
    const filePath = run.director_report_path;
    if (!filePath || !fs.existsSync(filePath)) {
      return reply.code(404).send({ error: 'РћС‚С‡С‘С‚ РµС‰С‘ РЅРµ СЃРіРµРЅРµСЂРёСЂРѕРІР°РЅ. РЎРЅР°С‡Р°Р»Р° РІС‹Р·РѕРІРёС‚Рµ generate-report.' });
    }
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `inline; filename="director_report_${runId}.pdf"`);
    return reply.send(fs.createReadStream(filePath));
  });

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // GET /conductor/artifact/:id вЂ” РѕРґРёРЅ Р°СЂС‚РµС„Р°РєС‚
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  fastify.get('/conductor/artifact/:id', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const artifactId = Number(request.params.id);
    if (!Number.isInteger(artifactId) || artifactId <= 0) {
      return reply.code(400).send({ error: 'invalid_artifact_id', message: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ С„Р°Р№Р»Р°.', hint: 'РћР±РЅРѕРІРёС‚Рµ СЃС‚СЂР°РЅРёС†Сѓ Рё РѕС‚РєСЂРѕР№С‚Рµ С„Р°Р№Р» Р·Р°РЅРѕРІРѕ.' });
    }
    const artifact = await cr.getArtifactById(artifactId);
    if (!artifact) return reply.code(404).send({ error: 'artifact_not_found', message: 'Р¤Р°Р№Р» РЅРµ РЅР°Р№РґРµРЅ.', hint: 'РћР±РЅРѕРІРёС‚Рµ СЃС‚СЂР°РЅРёС†Сѓ вЂ” РІРѕР·РјРѕР¶РЅРѕ, С„Р°Р№Р» СѓРґР°Р»С‘РЅ.' });
    // Р”РѕСЃС‚СѓРї вЂ” РїРѕ РІР»Р°РґРµР»СЊС†Сѓ РїСЂРѕРіРѕРЅР°, Рє РєРѕС‚РѕСЂРѕРјСѓ РїСЂРёРЅР°РґР»РµР¶РёС‚ Р°СЂС‚РµС„Р°РєС‚.
    const run = await cr.getRun(artifact.conductor_run_id);
    if (!canAccessRun(request.user, run)) {
      return reply.code(403).send({ error: 'РќРµС‚ РґРѕСЃС‚СѓРїР° Рє СЌС‚РѕРјСѓ Р°СЂС‚РµС„Р°РєС‚Сѓ' });
    }
    return artifact;
  });

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // РЎР•РЎРЎРРЇ 5 вЂ” РЈС‚РѕС‡РЅРµРЅРёСЏ, РїРёСЃСЊРјР° Р·Р°РєР°Р·С‡РёРєСѓ, async-РѕС‚РІРµС‚С‹
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

  // POST /conductor/letter/generate вЂ” { run_id, clarification_ids }
  fastify.post('/conductor/letter/generate', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const body = request.body || {};
    const runId = Number(body.run_id);
    const ids = Array.isArray(body.clarification_ids) ? body.clarification_ids.map(Number).filter(Boolean) : [];
    if (!Number.isInteger(runId) || runId <= 0) return reply.code(400).send({ error: 'run_id_required', message: 'РќРµ СѓРєР°Р·Р°РЅ РїСЂРѕСЃС‡С‘С‚.', hint: 'Р’С‹Р±РµСЂРёС‚Рµ РїСЂРѕСЃС‡С‘С‚ РёР· СЃРїРёСЃРєР° Рё РїРѕРІС‚РѕСЂРёС‚Рµ.' });
    if (!ids.length) return reply.code(400).send({ error: 'clarification_ids_required', message: 'РќРµ РІС‹Р±СЂР°РЅС‹ СѓС‚РѕС‡РЅРµРЅРёСЏ.', hint: 'РћС‚РјРµС‚СЊС‚Рµ С…РѕС‚СЏ Р±С‹ РѕРґРЅРѕ СѓС‚РѕС‡РЅРµРЅРёРµ Рё РїРѕРІС‚РѕСЂРёС‚Рµ.' });
    try {
      return await generateClarificationLetter({ runId, clarificationIds: ids, pmUserId: request.user.id });
    } catch (e) {
      request.log.error(`[letter/generate] ${e.message}`);
      return reply.code(400).send({ error: e.message });
    }
  });

  // GET /conductor/letter/:id/download/:format вЂ” format: docx | pdf
  fastify.get('/conductor/letter/:id/download/:format', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const letter = await getLetterById(Number(request.params.id));
    if (!letter) return reply.code(404).send({ error: 'letter_not_found', message: 'РџРёСЃСЊРјРѕ РЅРµ РЅР°Р№РґРµРЅРѕ.', hint: 'РћР±РЅРѕРІРёС‚Рµ СЃС‚СЂР°РЅРёС†Сѓ вЂ” РІРѕР·РјРѕР¶РЅРѕ, РїРёСЃСЊРјРѕ СѓРґР°Р»РµРЅРѕ.' });
    const format = request.params.format === 'pdf' ? 'pdf' : 'docx';
    const filePath = format === 'pdf' ? letter.pdf_path : letter.docx_path;
    if (!filePath || !fs.existsSync(filePath)) return reply.code(404).send({ error: 'Р¤Р°Р№Р» РїРёСЃСЊРјР° РЅРµ РЅР°Р№РґРµРЅ РЅР° РґРёСЃРєРµ' });

    const mime = format === 'pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const fname = `${(letter.letter_number || 'letter').replace(/[\\/]/g, '_')}.${format}`;
    reply.header('Content-Type', mime);
    reply.header('Content-Disposition', `attachment; filename="${fname}"`);
    return reply.send(fs.createReadStream(filePath));
  });

  // POST /conductor/letter/:id/mark-sent вЂ” { sent_at?, channel? }
  fastify.post('/conductor/letter/:id/mark-sent', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const letterId = Number(request.params.id);
    const letter = await getLetterById(letterId);
    if (!letter) return reply.code(404).send({ error: 'letter_not_found', message: 'РџРёСЃСЊРјРѕ РЅРµ РЅР°Р№РґРµРЅРѕ.', hint: 'РћР±РЅРѕРІРёС‚Рµ СЃС‚СЂР°РЅРёС†Сѓ вЂ” РІРѕР·РјРѕР¶РЅРѕ, РїРёСЃСЊРјРѕ СѓРґР°Р»РµРЅРѕ.' });
    const body = request.body || {};
    const sentAt = body.sent_at ? new Date(body.sent_at) : new Date();

    await fastify.db.query(
      "UPDATE mimir_customer_letters SET status = 'SENT', sent_at = $1, sent_by = $2 WHERE id = $3",
      [sentAt, request.user.id, letterId]
    );
    // РћС‚РєСЂС‹С‚С‹Рµ РІРѕРїСЂРѕСЃС‹ РїРёСЃСЊРјР° в†’ Р¶РґСѓС‚ РѕС‚РІРµС‚Р° Р·Р°РєР°Р·С‡РёРєР° (РѕСЃС‚Р°СЋС‚СЃСЏ OPEN+blocking, РЅРѕ
    // РїРѕРјРµС‡Р°РµРј РёСЃС‚РѕС‡РЅРёРє СЃС‚Р°С‚СѓСЃРѕРј РѕР¶РёРґР°РЅРёСЏ С‡РµСЂРµР· СЃРѕР±С‹С‚РёРµ).
    try {
      await cr.addEvent(letter.conductor_run_id, null, 'letter_sent', {
        letter_id: letterId, letter_number: letter.letter_number, channel: body.channel || 'manual'
      });
    } catch (_) { /* noop */ }
    return { ok: true };
  });

  // POST /conductor/letter/:id/upload-reply вЂ” multipart file РР›Р body.text
  fastify.post('/conductor/letter/:id/upload-reply', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const letterId = Number(request.params.id);
    const letter = await getLetterById(letterId);
    if (!letter) return reply.code(404).send({ error: 'letter_not_found', message: 'РџРёСЃСЊРјРѕ РЅРµ РЅР°Р№РґРµРЅРѕ.', hint: 'РћР±РЅРѕРІРёС‚Рµ СЃС‚СЂР°РЅРёС†Сѓ вЂ” РІРѕР·РјРѕР¶РЅРѕ, РїРёСЃСЊРјРѕ СѓРґР°Р»РµРЅРѕ.' });

    let replyPath = null;
    let rawText = null;

    if (request.isMultipart && request.isMultipart()) {
      // Р›РёРјРёС‚ СЂР°Р·РјРµСЂР° РЅР° СѓСЂРѕРІРЅРµ СЃС‚СЂРёРјР°: РїСЂРё РїСЂРµРІС‹С€РµРЅРёРё С„Р°Р№Р» Р±СѓРґРµС‚ В«truncatedВ».
      const file = await request.file({ limits: { fileSize: MAX_REPLY_BYTES } });
      if (file) {
        // MIME-whitelist (fix #3) вЂ” РѕС‚СЃРµРєР°РµРј РґРѕ Р·Р°РїРёСЃРё РЅР° РґРёСЃРє.
        // D-220b (21.09): РїСѓСЃС‚РѕР№ mimetype РѕР±С…РѕРґРёР» РїСЂРѕРІРµСЂРєСѓ (`if (file.mimetype && вЂ¦)`),
        // Р° СЂР°СЃС€РёСЂРµРЅРёРµ Р±СЂР°Р»РѕСЃСЊ РёР· РєР»РёРµРЅС‚СЃРєРѕРіРѕ РёРјРµРЅРё вЂ” `image/png` + РёРјСЏ `evil.html` РґР°РІР°Р» .html.
        const { safeStoredExt } = require('../lib/upload-ext');
        const storedExt = safeStoredExt(file.mimetype, file.filename, { allow: 'doc' });
        if (!storedExt) {
          return reply.code(415).send({
            error: `РўРёРї С„Р°Р№Р»Р° РЅРµ РїРѕРґРґРµСЂР¶РёРІР°РµС‚СЃСЏ: ${file.mimetype || '(РЅРµ СѓРєР°Р·Р°РЅ)'}. Р Р°Р·СЂРµС€РµРЅС‹: PDF, DOCX, XLSX, JPG, PNG, TIFF, TXT.`
          });
        }
        if (!fs.existsSync(LETTERS_DIR)) fs.mkdirSync(LETTERS_DIR, { recursive: true });
        const safe = `reply_${letterId}_${Date.now()}${storedExt}`;
        replyPath = path.join(LETTERS_DIR, safe);
        await new Promise((resolve, rej) => {
          const ws = fs.createWriteStream(replyPath);
          file.file.pipe(ws);
          ws.on('finish', resolve);
          ws.on('error', rej);
        });
        // РџСЂРµРІС‹С€РµРЅРёРµ Р»РёРјРёС‚Р°: РїРѕС‚РѕРє РѕР±СЂРµР·Р°РЅ в†’ СѓРґР°Р»СЏРµРј РѕРіСЂС‹Р·РѕРє Рё РІРѕР·РІСЂР°С‰Р°РµРј 413.
        if (file.file.truncated) {
          try { fs.unlinkSync(replyPath); } catch (_) { /* noop */ }
          return reply.code(413).send({
            error: `Р¤Р°Р№Р» РїСЂРµРІС‹С€Р°РµС‚ Р»РёРјРёС‚ ${Math.floor(MAX_REPLY_BYTES / (1024 * 1024))} РњР‘`
          });
        }
        // РўРµРєСЃС‚РѕРІРѕРµ РїРѕР»Рµ text РјРѕР¶РµС‚ РµС…Р°С‚СЊ СЂСЏРґРѕРј РІ multipart
        if (file.fields && file.fields.text && file.fields.text.value) rawText = file.fields.text.value;
      }
    } else {
      rawText = (request.body && request.body.text) || null;
    }

    if (!replyPath && !rawText) return reply.code(400).send({ error: 'РќСѓР¶РµРЅ С„Р°Р№Р» РёР»Рё С‚РµРєСЃС‚ РѕС‚РІРµС‚Р°' });

    try {
      const mapping = await parseReplyAndMap(letterId, replyPath, rawText);
      return { mapping };
    } catch (e) {
      request.log.error(`[letter/upload-reply] ${e.message}`);
      return reply.code(500).send({ error: e.message });
    }
  });

  // POST /conductor/letter/:id/apply-mapping вЂ” { mapping:[{question_id, answer_text}] }
  fastify.post('/conductor/letter/:id/apply-mapping', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const letterId = Number(request.params.id);
    const body = request.body || {};
    const mapping = Array.isArray(body.mapping) ? body.mapping : [];
    if (!mapping.length) return reply.code(400).send({ error: 'mapping_required', message: 'РќРµ РїРµСЂРµРґР°РЅРѕ СЃРѕРѕС‚РІРµС‚СЃС‚РІРёРµ РѕС‚РІРµС‚РѕРІ Рё РІРѕРїСЂРѕСЃРѕРІ.', hint: 'Р—Р°РїРѕР»РЅРёС‚Рµ СЃРѕРѕС‚РІРµС‚СЃС‚РІРёСЏ Рё РїРѕРІС‚РѕСЂРёС‚Рµ.' });
    try {
      const applied = await applyAnswers(letterId, mapping, request.user.id);
      const resume = await resumeConductorIfBlocked(letterId);
      return { ok: true, applied, resume };
    } catch (e) {
      request.log.error(`[letter/apply-mapping] ${e.message}`);
      return reply.code(500).send({ error: e.message });
    }
  });

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // POST /conductor/clarification/:id/answer вЂ” СѓРЅРёРІРµСЂСЃР°Р»СЊРЅС‹Р№ РѕС‚РІРµС‚ РЅР° СѓС‚РѕС‡РЅРµРЅРёРµ
  // РџСЂРёРЅРёРјР°РµС‚ РѕРґРёРЅ РёР·: answer_text (С‚РµРєСЃС‚), document_ids[] (РїСЂРёРІСЏР·Р°С‚СЊ С„Р°Р№Р»С‹ РєР°Рє РѕС‚РІРµС‚),
  // accept_assumption=true (РїСЂРёРЅСЏС‚СЊ default_assumption). РџРѕСЃР»Рµ РїСЂРёРјРµРЅРµРЅРёСЏ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё
  // РїСЂРѕРІРµСЂСЏРµС‚ Р±Р»РѕРєРµСЂС‹ Рё СЂРµР·СѓРјРёС‚ Conductor РµСЃР»Рё РІСЃРµ blocking-РІРѕРїСЂРѕСЃС‹ Р·Р°РєСЂС‹С‚С‹.
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  fastify.post('/conductor/clarification/:id/answer', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const clarId = Number(request.params.id);
    if (!clarId) return reply.code(400).send({ error: 'invalid_clarification_id', message: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ СѓС‚РѕС‡РЅРµРЅРёСЏ.', hint: 'РћР±РЅРѕРІРёС‚Рµ СЃС‚СЂР°РЅРёС†Сѓ Рё РѕС‚РєСЂРѕР№С‚Рµ СѓС‚РѕС‡РЅРµРЅРёРµ Р·Р°РЅРѕРІРѕ.' });
    const body = request.body || {};
    const answerText = body.answer_text != null ? String(body.answer_text).trim() : null;
    const docIds = Array.isArray(body.document_ids) ? body.document_ids.filter((x) => Number.isInteger(Number(x))).map(Number) : [];
    const acceptAssumption = !!body.accept_assumption;

    const db = fastify.db;
    try {
      // РџРѕР»СѓС‡Р°РµРј СѓС‚РѕС‡РЅРµРЅРёРµ + РїСЂРѕРІРµСЂСЏРµРј С‡С‚Рѕ run РІРёРґРёРјРѕ С‚РµРєСѓС‰РµРјСѓ РїРѕР»СЊР·РѕРІР°С‚РµР»СЋ
      const { rows } = await db.query(
        `SELECT c.id, c.conductor_run_id, c.status, c.channel, c.blocking, c.default_assumption,
                r.tender_id, r.work_id, r.initiated_by
           FROM mimir_clarifications c
           JOIN mimir_conductor_runs r ON r.id = c.conductor_run_id
          WHERE c.id = $1`,
        [clarId]
      );
      const cl = rows[0];
      if (!cl) return reply.code(404).send({ error: 'РЈС‚РѕС‡РЅРµРЅРёРµ РЅРµ РЅР°Р№РґРµРЅРѕ' });
      if (cl.status !== 'OPEN') return reply.code(409).send({ error: `РЈС‚РѕС‡РЅРµРЅРёРµ СѓР¶Рµ ${cl.status}` });

      // RBAC: PM РјРѕР¶РµС‚ РѕС‚РІРµС‡Р°С‚СЊ С‚РѕР»СЊРєРѕ РІ СЃРІРѕРёС… run, РґРёСЂРµРєС‚РѕСЂ/Р°РґРјРёРЅ вЂ” РІРµР·РґРµ.
      if (request.user.role === 'PM' && cl.initiated_by && cl.initiated_by !== request.user.id) {
        return reply.code(403).send({ error: 'РќРµС‚ РґРѕСЃС‚СѓРїР° Рє С‡СѓР¶РѕРјСѓ РїСЂРѕСЃС‡С‘С‚Сѓ' });
      }

      // РЎРѕР±РёСЂР°РµРј РёС‚РѕРіРѕРІС‹Р№ С‚РµРєСЃС‚ РѕС‚РІРµС‚Р°
      let finalAnswer = '';
      let answerSource = 'manual';

      if (acceptAssumption && cl.default_assumption) {
        const asp = typeof cl.default_assumption === 'string' ? cl.default_assumption : JSON.stringify(cl.default_assumption);
        finalAnswer = `[РџСЂРёРЅСЏС‚Рѕ РґРѕРїСѓС‰РµРЅРёРµ РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ] ${asp}`;
        answerSource = 'default_assumption';
      }
      if (answerText) {
        finalAnswer = (finalAnswer ? finalAnswer + '\n\n' : '') + answerText;
        answerSource = answerSource === 'default_assumption' ? 'mixed' : 'manual';
      }
      if (docIds.length) {
        const { rows: docs } = await db.query(
          'SELECT id, original_name, mime_type, ROUND(size/1024.0, 1) AS kb FROM documents WHERE id = ANY($1)',
          [docIds]
        );
        const docList = docs.map((d) => `#${d.id} ${d.original_name} (${d.mime_type}, ${d.kb} РљР‘)`).join('; ');
        finalAnswer = (finalAnswer ? finalAnswer + '\n\n' : '') + `[РџСЂРёР»РѕР¶РµРЅС‹ С„Р°Р№Р»С‹] ${docList}`;
        answerSource = answerSource === 'manual' ? 'document_upload' : 'mixed';
      }

      if (!finalAnswer) {
        return reply.code(400).send({ error: 'РќСѓР¶РµРЅ Р»РёР±Рѕ answer_text, Р»РёР±Рѕ document_ids[], Р»РёР±Рѕ accept_assumption' });
      }

      // UPDATE clarification
      await db.query(
        `UPDATE mimir_clarifications
            SET status = 'ANSWERED', answer_text = $1, answered_by = $2,
                answered_at = NOW(), answer_source = $3, updated_at = NOW()
          WHERE id = $4`,
        [finalAnswer, request.user.id, answerSource, clarId]
      );

      // РЎРѕР±С‹С‚РёРµ РІ War Room
      try {
        await db.query(
          `INSERT INTO mimir_agent_events (conductor_run_id, agent_run_id, event_type, payload)
           VALUES ($1, NULL, 'clarification_answered', $2::jsonb)`,
          [cl.conductor_run_id, JSON.stringify({
            clarification_id: clarId, channel: cl.channel,
            answered_by_user_id: request.user.id, source: answerSource,
            docs_count: docIds.length
          })]
        );
      } catch (_) { /* noop */ }

      // РђРІС‚Рѕ-resume РµСЃР»Рё РІСЃРµ Р±Р»РѕРєРµСЂС‹ Р·Р°РєСЂС‹С‚С‹
      const resumeResult = await _tryResumeRun(fastify, cl.conductor_run_id);

      return {
        ok: true,
        clarification_id: clarId,
        run_id: cl.conductor_run_id,
        resumed: !!resumeResult.resumed,
        remaining_blockers: resumeResult.remaining || 0
      };
    } catch (e) {
      request.log.error(`[clarification/answer] ${e.message}`);
      return reply.code(500).send({ error: e.message });
    }
  });

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // GET /conductor/my-runs вЂ” СЃРїРёСЃРѕРє РїРѕСЃР»РµРґРЅРёС… РїСЂРѕСЃС‡С‘С‚РѕРІ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ СЃРѕ СЃС‚Р°С‚СѓСЃРѕРј.
  // РСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ UI РґР»СЏ "РїСЂРѕРґРѕР»Р¶РёС‚СЊ РїСЂРѕСЃС‡С‘С‚" РїСЂРё РІРѕР·РІСЂР°С‚Рµ РЅР° conductor-estimate.html.
  // PM РІРёРґРёС‚ С‚РѕР»СЊРєРѕ СЃРІРѕРё, РґРёСЂРµРєС‚РѕСЂ/Р°РґРјРёРЅ вЂ” РІСЃРµ. РЎРѕСЂС‚РёСЂРѕРІРєР° РїРѕ updated_at DESC.
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  fastify.get('/conductor/my-runs', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const db = fastify.db;
    const isPM = request.user.role === 'PM';
    const limit = Math.min(Number(request.query.limit) || 20, 100);
    try {
      const params = [];
      let whereClause = '';
      if (isPM) {
        whereClause = 'WHERE initiated_by = $1';
        params.push(request.user.id);
      }
      params.push(limit);
      const { rows } = await db.query(
        `SELECT r.id, r.tender_id, r.work_id, r.status, r.profile,
                r.contract_value, r.total_cost_rub, r.created_at, r.updated_at,
                r.completed_at, r.blocked_reason,
                t.tender_title, t.customer_name,
                w.work_title, w.customer_name AS work_customer,
                (SELECT count(*)::int FROM mimir_agent_runs WHERE conductor_run_id=r.id AND status='SUCCESS') AS agents_done,
                (SELECT count(*)::int FROM mimir_clarifications WHERE conductor_run_id=r.id AND status='OPEN' AND blocking=true) AS open_blockers
           FROM mimir_conductor_runs r
           LEFT JOIN tenders t ON t.id = r.tender_id
           LEFT JOIN works w ON w.id = r.work_id
           ${whereClause}
          ORDER BY r.updated_at DESC NULLS LAST, r.id DESC
          LIMIT $${params.length}`,
        params
      );
      // queue_position РґР»СЏ WAITING_FOR_SLOT (РїРѕ FIFO created_at СЃСЂРµРґРё РѕР¶РёРґР°СЋС‰РёС…)
      const waitingIds = rows.filter((r) => r.status === 'WAITING_FOR_SLOT').map((r) => r.id);
      let queueMap = {};
      if (waitingIds.length) {
        const q = await db.query(
          `SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC)::int AS pos
             FROM mimir_conductor_runs
            WHERE status='WAITING_FOR_SLOT'`
        );
        for (const r of q.rows) queueMap[r.id] = r.pos;
      }
      for (const r of rows) {
        if (r.status === 'WAITING_FOR_SLOT') r.queue_position = queueMap[r.id] || null;
      }
      return { runs: rows };
    } catch (e) {
      request.log.error(`[my-runs] ${e.message}`);
      return reply.code(500).send({ error: e.message });
    }
  });

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // POST /conductor/run/:id/approve вЂ” РґРёСЂРµРєС‚РѕСЂ/HEAD_TO СѓС‚РІРµСЂР¶РґР°РµС‚ Conductor-РїСЂРѕСЃС‡С‘С‚.
  // FEEDBACK-LOOP: СѓС‚РІРµСЂР¶РґС‘РЅРЅС‹Р№ РїСЂРѕСЃС‡С‘С‚ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё РїРѕРїР°РґР°РµС‚ РІ
  // mimir_reference_projects РєР°Рє СЌС‚Р°Р»РѕРЅ РґР»СЏ Р±СѓРґСѓС‰РёС… РїРѕС…РѕР¶РёС… РїСЂРѕРµРєС‚РѕРІ.
  // Р”РѕСЃС‚СѓРї: ADMIN, DIRECTOR_*, HEAD_TO.
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  fastify.post('/conductor/run/:id/approve', {
    preHandler: [fastify.authenticate, fastify.requireRoles(['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_TO'])]
  }, async (request, reply) => {
    const runId = Number(request.params.id);
    if (!runId) return reply.code(400).send({ error: 'invalid_run_id', message: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ РїСЂРѕСЃС‡С‘С‚Р°.', hint: 'РћР±РЅРѕРІРёС‚Рµ СЃС‚СЂР°РЅРёС†Сѓ Рё РѕС‚РєСЂРѕР№С‚Рµ РїСЂРѕСЃС‡С‘С‚ Р·Р°РЅРѕРІРѕ.' });
    const db = fastify.db;
    try {
      const { rows } = await db.query('SELECT id, status, initiated_by, work_id, tender_id FROM mimir_conductor_runs WHERE id=$1', [runId]);
      const run = rows[0];
      if (!run) return reply.code(404).send({ error: 'РџСЂРѕСЃС‡С‘С‚ РЅРµ РЅР°Р№РґРµРЅ' });
      if (!['READY_FOR_REVIEW', 'BLOCKED_BY_CUSTOMER', 'BLOCKED_BY_PM'].includes(run.status)) {
        return reply.code(409).send({ error: `РџСЂРѕСЃС‡С‘С‚ РЅРµР»СЊР·СЏ СѓС‚РІРµСЂРґРёС‚СЊ РёР· СЃС‚Р°С‚СѓСЃР° ${run.status}` });
      }
      await db.query(
        `UPDATE mimir_conductor_runs SET status='APPROVED', completed_at=NOW(), updated_at=NOW() WHERE id=$1`,
        [runId]
      );
      try {
        await db.query(
          `INSERT INTO mimir_agent_events (conductor_run_id, agent_run_id, event_type, payload)
           VALUES ($1, NULL, 'status_change', $2::jsonb)`,
          [runId, JSON.stringify({ from: run.status, to: 'APPROVED', by: request.user.id, role: request.user.role, comment: request.body?.comment || '' })]
        );
      } catch (_) { /* noop */ }

      // FEEDBACK-LOOP: СЌС‚Р°Р»РѕРЅ РІ mimir_reference_projects
      let learnResult = null;
      try {
        const { learnFromConductorRun } = require('../services/mimir-conductor/reference-learner');
        learnResult = await learnFromConductorRun(runId, { createdBy: request.user.id, source: 'conductor_approve' });
        if (learnResult.ok) {
          fastify.log.info(`[conductor/approve] feedback-loop: run #${runId} в†’ reference #${learnResult.reference_id} (${learnResult.created ? 'created' : 'updated'})`);
        } else {
          fastify.log.warn(`[conductor/approve] feedback-loop skipped: ${learnResult.reason || learnResult.error}`);
        }
      } catch (e) {
        fastify.log.warn(`[conductor/approve] learner error: ${e.message}`);
      }

      return {
        ok: true, run_id: runId, status: 'APPROVED', from: run.status,
        feedback_loop: learnResult
      };
    } catch (e) {
      request.log.error(`[conductor/approve] ${e.message}`);
      return reply.code(500).send({ error: e.message });
    }
  });

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // POST /conductor/run/:id/cancel вЂ” Р Рџ РѕСЃС‚Р°РЅР°РІР»РёРІР°РµС‚ СЃРІРѕР№ РїСЂРѕСЃС‡С‘С‚.
  // RBAC: PM С‚РѕР»СЊРєРѕ СЃРІРѕР№, DIRECTOR/ADMIN вЂ” Р»СЋР±РѕР№. РўРµСЂРјРёРЅР°Р»СЊРЅС‹Рµ СЃС‚Р°С‚СѓСЃС‹ РЅРµ
  // РѕС‚РјРµРЅСЏСЋС‚СЃСЏ (READY_FOR_REVIEW, APPROVED, REJECTED, CANCELLED, ERROR, COMPLETED).
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  fastify.post('/conductor/run/:id/cancel', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const runId = Number(request.params.id);
    if (!runId) return reply.code(400).send({ error: 'invalid_run_id', message: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ РїСЂРѕСЃС‡С‘С‚Р°.', hint: 'РћР±РЅРѕРІРёС‚Рµ СЃС‚СЂР°РЅРёС†Сѓ Рё РѕС‚РєСЂРѕР№С‚Рµ РїСЂРѕСЃС‡С‘С‚ Р·Р°РЅРѕРІРѕ.' });
    const db = fastify.db;
    try {
      const { rows } = await db.query('SELECT id, status, initiated_by FROM mimir_conductor_runs WHERE id=$1', [runId]);
      const run = rows[0];
      if (!run) return reply.code(404).send({ error: 'РџСЂРѕСЃС‡С‘С‚ РЅРµ РЅР°Р№РґРµРЅ' });
      if (request.user.role === 'PM' && run.initiated_by && Number(run.initiated_by) !== Number(request.user.id)) {
        return reply.code(403).send({ error: 'РќРµС‚ РґРѕСЃС‚СѓРїР° Рє С‡СѓР¶РѕРјСѓ РїСЂРѕСЃС‡С‘С‚Сѓ' });
      }
      const terminal = new Set(['READY_FOR_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED', 'ERROR', 'COMPLETED']);
      if (terminal.has(run.status)) {
        return reply.code(409).send({ error: `РџСЂРѕСЃС‡С‘С‚ СѓР¶Рµ Р·Р°РІРµСЂС€С‘РЅ (${run.status})` });
      }
      await db.query(
        `UPDATE mimir_conductor_runs
            SET status='CANCELLED', completed_at=NOW(), updated_at=NOW(),
                blocked_reason=COALESCE(blocked_reason, $1)
          WHERE id=$2`,
        [`РћС‚РјРµРЅС‘РЅ РїРѕР»СЊР·РѕРІР°С‚РµР»РµРј #${request.user.id} (${request.user.role})`, runId]
      );
      try {
        await db.query(
          `INSERT INTO mimir_agent_events (conductor_run_id, agent_run_id, event_type, payload)
           VALUES ($1, NULL, 'status_change', $2::jsonb)`,
          [runId, JSON.stringify({ from: run.status, to: 'CANCELLED', reason: 'user_cancel', by: request.user.id })]
        );
      } catch (_) { /* noop */ }
      return { ok: true, run_id: runId, status: 'CANCELLED', from: run.status };
    } catch (e) {
      request.log.error(`[cancel] ${e.message}`);
      return reply.code(500).send({ error: e.message });
    }
  });

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // POST /conductor/clarification/:id/answer-with-norms вЂ” СЃС‚СЂСѓРєС‚СѓСЂРёСЂРѕРІР°РЅРЅС‹Р№ РІРІРѕРґ
  // РЅРѕСЂРјР°С‚РёРІРѕРІ РїСЂСЏРјРѕ РёР· War Room. Р Рџ РІРёРґРёС‚ expected_inputs[], Р·Р°РїРѕР»РЅСЏРµС‚ РїРѕР»СЏ,
  // РґР°РЅРЅС‹Рµ РїРёС€СѓС‚СЃСЏ РІ РЅСѓР¶РЅРѕРµ С…СЂР°РЅРёР»РёС‰Рµ (settings.company_profile / field_tariff_grid
  // / settings.reference_norms / tz_summary) Рё clarification Р·Р°РєСЂС‹РІР°РµС‚СЃСЏ.
  // РўРµР»Рѕ: { values: { <expected_input.key>: <Р·РЅР°С‡РµРЅРёРµ>, ... } }
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  fastify.post('/conductor/clarification/:id/answer-with-norms', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const clarId = Number(request.params.id);
    if (!clarId) return reply.code(400).send({ error: 'invalid_clarification_id', message: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ СѓС‚РѕС‡РЅРµРЅРёСЏ.', hint: 'РћР±РЅРѕРІРёС‚Рµ СЃС‚СЂР°РЅРёС†Сѓ Рё РѕС‚РєСЂРѕР№С‚Рµ СѓС‚РѕС‡РЅРµРЅРёРµ Р·Р°РЅРѕРІРѕ.' });
    const values = (request.body && request.body.values) || {};
    if (!Object.keys(values).length) return reply.code(400).send({ error: 'values РїСѓСЃС‚РѕР№' });

    const db = fastify.db;
    try {
      const { rows } = await db.query(
        `SELECT c.id, c.conductor_run_id, c.status, c.channel, c.blocking,
                c.options_json, r.tender_id, r.work_id, r.initiated_by
           FROM mimir_clarifications c
           JOIN mimir_conductor_runs r ON r.id = c.conductor_run_id
          WHERE c.id = $1`,
        [clarId]
      );
      const cl = rows[0];
      if (!cl) return reply.code(404).send({ error: 'РЈС‚РѕС‡РЅРµРЅРёРµ РЅРµ РЅР°Р№РґРµРЅРѕ' });
      if (cl.status !== 'OPEN') return reply.code(409).send({ error: `РЈС‚РѕС‡РЅРµРЅРёРµ СѓР¶Рµ ${cl.status}` });
      if (request.user.role === 'PM' && cl.initiated_by && cl.initiated_by !== request.user.id) {
        return reply.code(403).send({ error: 'РќРµС‚ РґРѕСЃС‚СѓРїР° Рє С‡СѓР¶РѕРјСѓ РїСЂРѕСЃС‡С‘С‚Сѓ' });
      }

      // expected_inputs[] С…СЂР°РЅРёС‚СЃСЏ РІ options_json (РєР°Рє С‡Р°СЃС‚СЊ clarification)
      const expected = (cl.options_json && Array.isArray(cl.options_json.expected_inputs))
        ? cl.options_json.expected_inputs : [];

      const writes = [];
      const summary = [];
      for (const inp of expected) {
        const v = values[inp.key];
        if (v == null || v === '') {
          if (!inp.optional) {
            return reply.code(400).send({ error: `РџРѕР»Рµ "${inp.key}" РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ` });
          }
          continue;
        }
        const value = inp.type === 'number' ? Number(v) : String(v);
        if (inp.type === 'number' && !Number.isFinite(value)) {
          return reply.code(400).send({ error: `РџРѕР»Рµ "${inp.key}" РґРѕР»Р¶РЅРѕ Р±С‹С‚СЊ С‡РёСЃР»РѕРј` });
        }
        writes.push({ target: inp.target, key: inp.key, value, label: inp.label });
      }

      // РџСЂРёРјРµРЅСЏРµРј РєР°Р¶РґРѕРµ write Рє РЅСѓР¶РЅРѕРјСѓ С…СЂР°РЅРёР»РёС‰Сѓ
      await db.transaction(async (client) => {
        for (const w of writes) {
          const t = String(w.target || '');
          if (t.startsWith('company_profile.financial_policy.')) {
            const fpKey = t.replace('company_profile.financial_policy.', '');
            await client.query(
              `INSERT INTO settings (key, value_json, description, updated_at)
               VALUES ('company_profile', jsonb_build_object('financial_policy', jsonb_build_object($1::text, $2::numeric)), 'Mimir Conductor вЂ” Р°РІС‚Рѕ-РѕР±РЅРѕРІР»РµРЅРёРµ', NOW())
               ON CONFLICT (key) DO UPDATE
                  SET value_json = jsonb_set(COALESCE(settings.value_json, '{}'::jsonb), ARRAY['financial_policy', $1], to_jsonb($2::numeric), true),
                      updated_at = NOW()`,
              [fpKey, w.value]
            );
            summary.push(`company_profile.financial_policy.${fpKey} = ${w.value}`);
          } else if (t.startsWith('reference_norms.')) {
            const path = t.replace('reference_norms.', '').split('.');
            await client.query(
              `INSERT INTO settings (key, value_json, description, updated_at)
               VALUES ('reference_norms', jsonb_set('{}'::jsonb, $1::text[], to_jsonb($2::numeric), true), 'Mimir Conductor вЂ” РїСЂРѕРёР·РІРѕРґСЃС‚РІРµРЅРЅС‹Рµ РЅРѕСЂРјР°С‚РёРІС‹ (Р·Р°РїРѕР»РЅСЏСЋС‚СЃСЏ Р Рџ)', NOW())
               ON CONFLICT (key) DO UPDATE
                  SET value_json = jsonb_set(COALESCE(settings.value_json, '{}'::jsonb), $1::text[], to_jsonb($2::numeric), true),
                      updated_at = NOW()`,
              [path, w.value]
            );
            summary.push(`reference_norms.${path.join('.')} = ${w.value}`);
          } else if (t.startsWith('field_tariff_grid.')) {
            const positionName = t.replace('field_tariff_grid.', '');
            await client.query(
              `INSERT INTO field_tariff_grid (position_name, rate_per_shift, is_active)
               VALUES ($1, $2, true)
               ON CONFLICT (position_name) WHERE is_active DO UPDATE
                  SET rate_per_shift = EXCLUDED.rate_per_shift`,
              [positionName, w.value]
            ).catch(async () => {
              await client.query(
                `INSERT INTO field_tariff_grid (position_name, rate_per_shift, is_active) VALUES ($1, $2, true)`,
                [positionName, w.value]
              );
            });
            summary.push(`field_tariff_grid["${positionName}"].rate_per_shift = ${w.value}`);
          } else if (t.startsWith('tz_summary.')) {
            const path = t.replace('tz_summary.', '').split('.');
            // Р”РѕРїРѕР»РЅСЏРµРј Р°СЂС‚РµС„Р°РєС‚ tz_summary С‚РµРєСѓС‰РµРіРѕ run вЂ” СЃРѕР·РґР°С‘Рј РЅРѕРІСѓСЋ РІРµСЂСЃРёСЋ
            const r = await client.query(
              `SELECT id, content FROM mimir_artifacts
                WHERE conductor_run_id=$1 AND artifact_type='tz_summary' AND superseded_by IS NULL
                ORDER BY id DESC LIMIT 1`,
              [cl.conductor_run_id]
            );
            const prev = r.rows[0];
            const newContent = prev ? JSON.parse(JSON.stringify(prev.content)) : {};
            let cur = newContent;
            for (let i = 0; i < path.length - 1; i++) {
              if (cur[path[i]] == null || typeof cur[path[i]] !== 'object') cur[path[i]] = {};
              cur = cur[path[i]];
            }
            cur[path[path.length - 1]] = w.value;
            // РџРѕРјРµС‡Р°РµРј СЃС‚Р°СЂСѓСЋ РєР°Рє superseded Рё СЃРѕР·РґР°С‘Рј РЅРѕРІСѓСЋ
            if (prev) {
              await client.query(`UPDATE mimir_artifacts SET superseded_by=NULL WHERE id=$1`, [prev.id]);
            }
            const hash = require('crypto').createHash('sha256').update(JSON.stringify(newContent)).digest('hex');
            const ins = await client.query(
              `INSERT INTO mimir_artifacts (conductor_run_id, created_by_agent_run_id, artifact_type, content, content_hash, schema_version, created_at)
               VALUES ($1, NULL, 'tz_summary', $2::jsonb, $3, '1', NOW()) RETURNING id`,
              [cl.conductor_run_id, JSON.stringify(newContent), hash]
            );
            if (prev) {
              await client.query(`UPDATE mimir_artifacts SET superseded_by=$1 WHERE id=$2`, [ins.rows[0].id, prev.id]);
            }
            summary.push(`tz_summary.${path.join('.')} = ${w.value} (РЅРѕРІС‹Р№ Р°СЂС‚РµС„Р°РєС‚ ${ins.rows[0].id})`);
          } else {
            summary.push(`SKIPPED unknown target: ${t}`);
          }
        }

        // Р—Р°РєСЂС‹РІР°РµРј clarification
        await client.query(
          `UPDATE mimir_clarifications
              SET status='ANSWERED', answer_text=$1, answered_by=$2, answered_at=NOW(),
                  answer_source='inline_form', updated_at=NOW()
            WHERE id=$3`,
          [`Р Рџ Р·Р°РїРѕР»РЅРёР» РїРѕР»СЏ: ${summary.join('; ')}`, request.user.id, clarId]
        );

        await client.query(
          `INSERT INTO mimir_agent_events (conductor_run_id, agent_run_id, event_type, payload)
           VALUES ($1, NULL, 'clarification_answered_with_norms', $2::jsonb)`,
          [cl.conductor_run_id, JSON.stringify({
            clarification_id: clarId, channel: cl.channel,
            answered_by_user_id: request.user.id, writes: summary
          })]
        );
      });

      const resumeResult = await _tryResumeRun(fastify, cl.conductor_run_id);
      return {
        ok: true,
        clarification_id: clarId,
        run_id: cl.conductor_run_id,
        writes: summary,
        resumed: !!resumeResult.resumed,
        remaining_blockers: resumeResult.remaining || 0
      };
    } catch (e) {
      request.log.error(`[answer-with-norms] ${e.message}`);
      return reply.code(500).send({ error: e.message });
    }
  });

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // POST /conductor/run/:id/recheck-blockers вЂ” РїРµСЂРµСЃРјРѕС‚СЂ Р±Р»РѕРєРµСЂРѕРІ (РєРѕРіРґР° Р Рџ
  // Р·Р°РіСЂСѓР·РёР» РґРѕРєСѓРјРµРЅС‚С‹ С‡РµСЂРµР· UI СЂР°Р±РѕС‚С‹/С‚РµРЅРґРµСЂР°, Р±РµР· СЏРІРЅРѕРіРѕ В«РѕС‚РІРµС‚Р° РЅР° РІРѕРїСЂРѕСЃВ»).
  // Р•СЃР»Рё Сѓ run РІСЃРµ blocking-clarifications Р·Р°РєСЂС‹С‚С‹ РР›Р РїРѕСЏРІРёР»РёСЃСЊ РЅРѕРІС‹Рµ РґРѕРєСѓРјРµРЅС‚С‹
  // РїРѕРєСЂС‹РІР°СЋС‰РёРµ РєР°С‚РµРіРѕСЂРёСЋ РґРѕРєСѓРјРµРЅС‚РЅРѕРіРѕ РІРѕРїСЂРѕСЃР° вЂ” РїРѕРјРµС‚РёС‚СЊ ANSWERED + resume.
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  fastify.post('/conductor/run/:id/recheck-blockers', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const runId = Number(request.params.id);
    if (!runId) return reply.code(400).send({ error: 'invalid_run_id', message: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ РїСЂРѕСЃС‡С‘С‚Р°.', hint: 'РћР±РЅРѕРІРёС‚Рµ СЃС‚СЂР°РЅРёС†Сѓ Рё РѕС‚РєСЂРѕР№С‚Рµ РїСЂРѕСЃС‡С‘С‚ Р·Р°РЅРѕРІРѕ.' });
    const db = fastify.db;
    try {
      const { rows } = await db.query(
        `SELECT id, status, tender_id, work_id, initiated_by FROM mimir_conductor_runs WHERE id = $1`,
        [runId]
      );
      const run = rows[0];
      if (!run) return reply.code(404).send({ error: 'РџСЂРѕСЃС‡С‘С‚ РЅРµ РЅР°Р№РґРµРЅ' });
      if (request.user.role === 'PM' && run.initiated_by !== request.user.id) {
        return reply.code(403).send({ error: 'РќРµС‚ РґРѕСЃС‚СѓРїР°' });
      }
      // РџРѕРґСЃС‡РёС‚Р°РµРј РЅРѕРІС‹Рµ РґРѕРєСѓРјРµРЅС‚С‹ С‚РµРЅРґРµСЂР°/СЂР°Р±РѕС‚С‹, РЅРµ СѓС‡С‚С‘РЅРЅС‹Рµ РІ parsed_documents
      const docCount = await _countAttachableDocuments(db, run);
      const result = await _tryResumeRun(fastify, runId);
      return {
        ok: true,
        run_id: runId,
        documents_available: docCount,
        resumed: !!result.resumed,
        remaining_blockers: result.remaining || 0,
        reason: result.reason
      };
    } catch (e) {
      request.log.error(`[recheck-blockers] ${e.message}`);
      return reply.code(500).send({ error: e.message });
    }
  });

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // POST /conductor/run/:id/recompute-with-feedback вЂ” РїРµСЂРµСЃС‡С‘С‚ РїРѕ РїСЂР°РІРєРµ Р Рџ.
  // РџСЂРёРЅРёРјР°РµС‚ {feedback_text}. РЎРѕС…СЂР°РЅСЏРµС‚ РїСЂР°РІРєСѓ РєР°Рє pm_feedback-Р°СЂС‚РµС„Р°РєС‚,
  // РїРµСЂРµРІРѕРґРёС‚ run РІ RUNNING, РёРЅРёС†РёРёСЂСѓРµС‚ runConductorResume вЂ” СЃР»РµРґСѓСЋС‰Р°СЏ РёС‚РµСЂР°С†РёСЏ
  // Conductor СѓС‡С‚С‘С‚ РѕР±СЂР°С‚РЅСѓСЋ СЃРІСЏР·СЊ.
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  fastify.post('/conductor/run/:id/recompute-with-feedback', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const runId = Number(request.params.id);
    const feedback = String((request.body && request.body.feedback_text) || '').trim();
    if (!runId) return reply.code(400).send({ error: 'invalid_run_id', message: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ РїСЂРѕСЃС‡С‘С‚Р°.', hint: 'РћР±РЅРѕРІРёС‚Рµ СЃС‚СЂР°РЅРёС†Сѓ Рё РѕС‚РєСЂРѕР№С‚Рµ РїСЂРѕСЃС‡С‘С‚ Р·Р°РЅРѕРІРѕ.' });
    if (!feedback) return reply.code(400).send({ error: 'feedback_text РѕР±СЏР·Р°С‚РµР»РµРЅ' });

    const db = fastify.db;
    try {
      const { rows } = await db.query(
        `SELECT id, status, initiated_by FROM mimir_conductor_runs WHERE id = $1`,
        [runId]
      );
      const run = rows[0];
      if (!run) return reply.code(404).send({ error: 'РџСЂРѕСЃС‡С‘С‚ РЅРµ РЅР°Р№РґРµРЅ' });
      if (request.user.role === 'PM' && run.initiated_by !== request.user.id) {
        return reply.code(403).send({ error: 'РќРµС‚ РґРѕСЃС‚СѓРїР°' });
      }
      // РЎРѕС…СЂР°РЅСЏРµРј feedback РєР°Рє Р°СЂС‚РµС„Р°РєС‚ С‚РёРїР° pm_feedback (Conductor РµРіРѕ СѓС‡С‚С‘С‚)
      const cr = require('../services/mimir-conductor/conductor-run');
      const artifact = {
        summary: 'РћР±СЂР°С‚РЅР°СЏ СЃРІСЏР·СЊ Р Рџ Рє С„РёРЅР°Р»СЊРЅРѕР№ СЃРјРµС‚Рµ',
        feedback_text: feedback,
        author_user_id: request.user.id,
        created_at: new Date().toISOString()
      };
      try {
        await cr.addArtifact(runId, null, 'pm_feedback', artifact);
      } catch (_) { /* СЃС…РµРјР° РјРѕР¶РµС‚ СЂСѓРіР°С‚СЊСЃСЏ РЅР° С‚РёРї вЂ” РЅРµ РєСЂРёС‚РёС‡РЅРѕ */ }

      // РџРµСЂРµРІРѕРґ run РІ RUNNING
      await db.query(
        `UPDATE mimir_conductor_runs SET status = 'RUNNING', blocked_reason = NULL, updated_at = NOW() WHERE id = $1`,
        [runId]
      );
      try {
        await db.query(
          `INSERT INTO mimir_agent_events (conductor_run_id, agent_run_id, event_type, payload)
           VALUES ($1, NULL, 'recompute_requested', $2::jsonb)`,
          [runId, JSON.stringify({ feedback: feedback.substring(0, 500), requested_by: request.user.id })]
        );
      } catch (_) {}

      // Р¤РѕРЅРѕРІС‹Р№ resume
      setImmediate(() => {
        try {
          const { runConductorResume } = require('../services/mimir-conductor/apply-answers');
          runConductorResume(runId, { resumed_from_letter: null, pm_feedback: feedback }).catch((err) => {
            request.log.warn(`[recompute] resume failed: ${err.message}`);
          });
        } catch (e) {
          request.log.warn(`[recompute] start failed: ${e.message}`);
        }
      });

      return { ok: true, run_id: runId, status: 'RUNNING', message: 'Conductor СѓС‡С‚С‘С‚ РїСЂР°РІРєСѓ РІ СЃР»РµРґСѓСЋС‰РµР№ РёС‚РµСЂР°С†РёРё' };
    } catch (e) {
      request.log.error(`[recompute-with-feedback] ${e.message}`);
      return reply.code(500).send({ error: e.message });
    }
  });

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // POST /conductor/run/:id/adjust-margin вЂ” Р Рџ РёР·РјРµРЅСЏРµС‚ РјР°СЂР¶Сѓ/РїСЂРёР±С‹Р»СЊ РІ С„РёРЅР°Р»СЊРЅРѕР№
  // СЃРјРµС‚Рµ Рё РїРѕР»СѓС‡Р°РµС‚ РїРµСЂРµСЃС‡РёС‚Р°РЅРЅС‹Рµ С†РёС„СЂС‹. РЎРѕР·РґР°С‘С‚СЃСЏ РЅРѕРІР°СЏ РІРµСЂСЃРёСЏ Р°СЂС‚РµС„Р°РєС‚Р°
  // final_estimate (СЃС‚Р°СЂР°СЏ РїРѕРјРµС‡Р°РµС‚СЃСЏ superseded). РќРµ Р·Р°РїСѓСЃРєР°РµС‚ Conductor вЂ”
  // РїСЂРѕСЃС‚Рѕ РјР°С‚РµРјР°С‚РёС‡РµСЃРєРёР№ РїРµСЂРµСЃС‡С‘С‚ revenue/VAT РїСЂРё С‚РѕР№ Р¶Рµ СЃРµР±РµСЃС‚РѕРёРјРѕСЃС‚Рё.
  //
  // Body: { new_margin_pct: 22.5 } РР›Р { new_profit_rub: 5000000 } РР›Р { new_total_with_margin: 30000000 }
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  fastify.post('/conductor/run/:id/adjust-margin', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const runId = Number(request.params.id);
    if (!runId) return reply.code(400).send({ error: 'invalid_run_id', message: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ РїСЂРѕСЃС‡С‘С‚Р°.', hint: 'РћР±РЅРѕРІРёС‚Рµ СЃС‚СЂР°РЅРёС†Сѓ Рё РѕС‚РєСЂРѕР№С‚Рµ РїСЂРѕСЃС‡С‘С‚ Р·Р°РЅРѕРІРѕ.' });
    const b = request.body || {};
    const db = fastify.db;
    try {
      const { rows: rRows } = await db.query(
        `SELECT initiated_by FROM mimir_conductor_runs WHERE id = $1`, [runId]
      );
      if (!rRows[0]) return reply.code(404).send({ error: 'РџСЂРѕСЃС‡С‘С‚ РЅРµ РЅР°Р№РґРµРЅ' });
      if (request.user.role === 'PM' && rRows[0].initiated_by !== request.user.id) {
        return reply.code(403).send({ error: 'РќРµС‚ РґРѕСЃС‚СѓРїР°' });
      }

      // Р‘РµСЂС‘Рј С‚РµРєСѓС‰РёР№ final_estimate
      const cr = require('../services/mimir-conductor/conductor-run');
      const final = await cr.getArtifact(runId, 'final_estimate');
      if (!final || !final.content || !final.content.ssr) {
        return reply.code(400).send({ error: 'Р¤РёРЅР°Р»СЊРЅР°СЏ СЃРјРµС‚Р° РµС‰С‘ РЅРµ РіРѕС‚РѕРІР° вЂ” Conductor РЅРµ РґРѕС€С‘Р» РґРѕ РЅРµС‘' });
      }
      const ssr = JSON.parse(JSON.stringify(final.content.ssr));
      const cost = Number(ssr.total_cost) || 0;
      if (cost <= 0) {
        return reply.code(400).send({ error: 'РЎРµР±РµСЃС‚РѕРёРјРѕСЃС‚СЊ = 0 вЂ” РЅРµР»СЊР·СЏ РїРµСЂРµСЃС‡РёС‚Р°С‚СЊ РјР°СЂР¶Сѓ' });
      }

      // РћРїСЂРµРґРµР»СЏРµРј РЅРѕРІСѓСЋ РјР°СЂР¶Сѓ РёР· Р»СЋР±РѕРіРѕ РёР· С‚СЂС‘С… РїРѕР»РµР№ body
      let newMarginPct;
      if (b.new_margin_pct != null) {
        newMarginPct = Number(b.new_margin_pct);
      } else if (b.new_profit_rub != null) {
        const profit = Number(b.new_profit_rub);
        const revenue = cost + profit;
        newMarginPct = revenue > 0 ? (profit / revenue * 100) : 0;
      } else if (b.new_total_with_margin != null) {
        const revenue = Number(b.new_total_with_margin);
        newMarginPct = revenue > cost ? ((revenue - cost) / revenue * 100) : 0;
      } else {
        return reply.code(400).send({ error: 'РќСѓР¶РЅРѕ РѕРґРЅРѕ РёР·: new_margin_pct, new_profit_rub, new_total_with_margin' });
      }

      if (!isFinite(newMarginPct) || newMarginPct < 0 || newMarginPct >= 95) {
        return reply.code(400).send({ error: 'РњР°СЂР¶Р° РґРѕР»Р¶РЅР° Р±С‹С‚СЊ РІ РґРёР°РїР°Р·РѕРЅРµ 0..95%' });
      }

      // РџРµСЂРµСЃС‡С‘С‚
      const marginDec = newMarginPct / 100;
      const newRevenue = cost / (1 - marginDec);
      const newProfit = newRevenue - cost;
      const vatPct = Number(ssr.vat_pct) || 22;
      const newVat = newRevenue * vatPct / 100;
      const newTotalWithVat = newRevenue + newVat;

      // РЎС‚Р°СЂС‹Рµ С†РёС„СЂС‹ РґР»СЏ Р°СѓРґРёС‚Р°
      const oldRevenue = Number(ssr.total_with_margin) || 0;
      const oldMargin = Number(ssr.gross_profit_margin_pct) || 0;

      // РћР±РЅРѕРІР»С‘РЅРЅР°СЏ SSR
      ssr.gross_profit_margin_pct = Number(newMarginPct.toFixed(2));
      ssr.total_with_margin = Math.round(newRevenue);
      ssr.vat = Math.round(newVat);
      ssr.total_with_vat = Math.round(newTotalWithVat);
      ssr._manual_adjustments = ssr._manual_adjustments || [];
      ssr._manual_adjustments.push({
        type: 'margin_adjustment',
        adjusted_by_user_id: request.user.id,
        adjusted_at: new Date().toISOString(),
        from: { margin_pct: oldMargin, total_with_margin: oldRevenue },
        to: { margin_pct: newMarginPct, total_with_margin: ssr.total_with_margin }
      });

      // РЎРѕС…СЂР°РЅСЏРµРј РЅРѕРІСѓСЋ РІРµСЂСЃРёСЋ Р°СЂС‚РµС„Р°РєС‚Р° (supersede СЃС‚Р°СЂРѕР№)
      const newContent = Object.assign({}, final.content, { ssr });
      try {
        await cr.addArtifact(runId, null, 'final_estimate', newContent);
      } catch (_) { /* schema РјРѕР¶РµС‚ СЂСѓРіР°С‚СЊСЃСЏ РїСЂРё РґСѓР±Р»Рµ вЂ” best-effort */ }

      // РЎРѕР±С‹С‚РёРµ РІ War Room
      try {
        await db.query(
          `INSERT INTO mimir_agent_events (conductor_run_id, agent_run_id, event_type, payload)
           VALUES ($1, NULL, 'margin_adjusted', $2::jsonb)`,
          [runId, JSON.stringify({
            from_margin_pct: oldMargin, to_margin_pct: newMarginPct,
            from_revenue: oldRevenue, to_revenue: ssr.total_with_margin,
            adjusted_by_user_id: request.user.id
          })]
        );
      } catch (_) {}

      return {
        ok: true,
        new_ssr: ssr,
        delta: {
          margin_pct: newMarginPct - oldMargin,
          revenue_rub: ssr.total_with_margin - oldRevenue,
          vat_rub: ssr.vat - (Number(final.content.ssr.vat) || 0),
          total_with_vat_rub: ssr.total_with_vat - (Number(final.content.ssr.total_with_vat) || 0)
        }
      };
    } catch (e) {
      request.log.error(`[adjust-margin] ${e.message}`);
      return reply.code(500).send({ error: e.message });
    }
  });

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // POST /conductor/reference/import вЂ” РёРјРїРѕСЂС‚ СЌС‚Р°Р»РѕРЅР° РЅР°РїСЂСЏРјСѓСЋ (Р Рџ Р·Р°РїРѕР»РЅСЏРµС‚
  // С„Р°РєС‚РёС‡РµСЃРєРёРµ РґР°РЅРЅС‹Рµ РїРѕСЃР»Рµ Р·Р°РІРµСЂС€РµРЅРёСЏ СЂР°Р±РѕС‚С‹ РёР»Рё Р·Р°РіСЂСѓР¶Р°РµС‚ СЃС‚Р°СЂС‹Р№ РїСЂРѕРµРєС‚).
  // РџСЂРёРЅРёРјР°РµС‚ РїРѕР»РЅС‹Р№ РЅР°Р±РѕСЂ РїРѕР»РµР№ mimir_reference_projects. Endpoint РјРёРЅРёРјР°Р»СЊРЅРѕ
  // СѓРјРЅС‹Р№ вЂ” СЃС‚СЂСѓРєС‚СѓСЂСѓ СЌС‚Р°Р»РѕРЅР° С„РѕСЂРјРёСЂСѓРµС‚ Р Рџ С‡РµСЂРµР· UI (Р»РёР±Рѕ РѕРїС†РёРѕРЅР°Р»СЊРЅС‹Р№ AI-extract).
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  fastify.post('/conductor/reference/import', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const b = request.body || {};
    const db = fastify.db;
    try {
      if (!b.customer_name || !b.work_type) {
        return reply.code(400).send({ error: 'customer_name Рё work_type РѕР±СЏР·Р°С‚РµР»СЊРЅС‹' });
      }
      const sql = `INSERT INTO mimir_reference_projects (
        customer_name, customer_inn, customer_kpp, object_name, city, region,
        work_type, work_subtype, industry_sector, asset_type,
        contract_number, contract_date,
        contract_value_planned, contract_value_actual,
        vat_rate_pct, contract_value_planned_no_vat, contract_value_actual_no_vat,
        cost_planned, cost_actual, profit_planned, profit_actual,
        margin_planned_pct, margin_actual_pct,
        duration_planned_calendar_days, duration_actual_calendar_days,
        duration_planned_workshifts, duration_actual_workshifts,
        date_start, date_end_planned, date_end_actual,
        crew_size_planned, crew_size_actual, crew_composition_actual, work_regime,
        resources_actual, variance, insights,
        source_work_id, source_tender_id, source_document_ids,
        quality_score, is_active, notes, embedding_text, created_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
        $24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,
        $35::jsonb,$36::jsonb,$37::jsonb,$38,$39,$40,$41,$42,$43,$44,$45
      ) RETURNING id`;
      const params = [
        b.customer_name, b.customer_inn || null, b.customer_kpp || null,
        b.object_name || null, b.city || null, b.region || null,
        b.work_type, b.work_subtype || null, b.industry_sector || null, b.asset_type || null,
        b.contract_number || null, b.contract_date || null,
        b.contract_value_planned || null, b.contract_value_actual || null,
        b.vat_rate_pct || 22,
        b.contract_value_planned_no_vat || null, b.contract_value_actual_no_vat || null,
        b.cost_planned || null, b.cost_actual || null,
        b.profit_planned || null, b.profit_actual || null,
        b.margin_planned_pct || null, b.margin_actual_pct || null,
        b.duration_planned_calendar_days || null, b.duration_actual_calendar_days || null,
        b.duration_planned_workshifts || null, b.duration_actual_workshifts || null,
        b.date_start || null, b.date_end_planned || null, b.date_end_actual || null,
        b.crew_size_planned || null, b.crew_size_actual || null,
        JSON.stringify(b.crew_composition_actual || {}),
        b.work_regime || null,
        JSON.stringify(b.resources_actual || {}),
        JSON.stringify(b.variance || {}),
        JSON.stringify(b.insights || {}),
        b.source_work_id || null, b.source_tender_id || null,
        b.source_document_ids || null,
        b.quality_score || 5, b.is_active !== false,
        b.notes || null, b.embedding_text || null,
        request.user.id
      ];
      const { rows } = await db.query(sql, params);
      return { ok: true, reference_id: rows[0].id };
    } catch (e) {
      request.log.error(`[reference/import] ${e.message}`);
      return reply.code(500).send({ error: e.message });
    }
  });

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // POST /conductor/run/:id/save-actuals вЂ” РїРѕСЃР»Рµ Р·Р°РІРµСЂС€РµРЅРёСЏ СЂРµР°Р»СЊРЅРѕР№ СЂР°Р±РѕС‚С‹
  // Р Рџ РІРЅРѕСЃРёС‚ С„Р°РєС‚РёС‡РµСЃРєРёРµ С†РёС„СЂС‹ в†’ СЃРѕР·РґР°С‘Рј СЌС‚Р°Р»РѕРЅ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё РёР· run+actuals.
  // Р­С‚Рѕ Рё РµСЃС‚СЊ feedback-loop: РєР°Р¶РґР°СЏ Р·Р°РєСЂС‹С‚Р°СЏ СЂР°Р±РѕС‚Р° = +1 СЌС‚Р°Р»РѕРЅ РІ Р±Р°Р·Сѓ.
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  fastify.post('/conductor/run/:id/save-actuals', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const runId = Number(request.params.id);
    const b = request.body || {};
    if (!runId) return reply.code(400).send({ error: 'invalid_run_id', message: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ РїСЂРѕСЃС‡С‘С‚Р°.', hint: 'РћР±РЅРѕРІРёС‚Рµ СЃС‚СЂР°РЅРёС†Сѓ Рё РѕС‚РєСЂРѕР№С‚Рµ РїСЂРѕСЃС‡С‘С‚ Р·Р°РЅРѕРІРѕ.' });
    const db = fastify.db;
    try {
      const { rows: rRows } = await db.query(
        `SELECT r.*, w.work_title, w.customer_name AS w_customer, w.object_name AS w_object,
                t.tender_title, t.customer_name AS t_customer, t.tender_region
           FROM mimir_conductor_runs r
           LEFT JOIN works w ON w.id = r.work_id
           LEFT JOIN tenders t ON t.id = r.tender_id
          WHERE r.id = $1`,
        [runId]
      );
      const run = rRows[0];
      if (!run) return reply.code(404).send({ error: 'РџСЂРѕСЃС‡С‘С‚ РЅРµ РЅР°Р№РґРµРЅ' });
      if (request.user.role === 'PM' && run.initiated_by !== request.user.id) {
        return reply.code(403).send({ error: 'РќРµС‚ РґРѕСЃС‚СѓРїР°' });
      }

      // РџРѕР»СѓС‡Р°РµРј Р°СЂС‚РµС„Р°РєС‚ final_estimate РµСЃР»Рё Р±С‹Р» (РґР»СЏ cost_planned)
      const cr = require('../services/mimir-conductor/conductor-run');
      const finalArt = await cr.getArtifact(runId, 'final_estimate').catch(() => null);
      const costPlanned = (finalArt && finalArt.content && finalArt.content.ssr && finalArt.content.ssr.subtotal_cost) || run.contract_value || null;

      const customerName = b.customer_name || run.w_customer || run.t_customer || 'РќРµРёР·РІРµСЃС‚РЅС‹Р№ Р·Р°РєР°Р·С‡РёРє';
      const workType = b.work_type || run.work_title || run.tender_title || 'РџРѕРґСЂСЏРґРЅС‹Рµ СЂР°Р±РѕС‚С‹';

      // РЎРѕР·РґР°С‘Рј СЌС‚Р°Р»РѕРЅ
      const sql = `INSERT INTO mimir_reference_projects (
        customer_name, object_name, city, work_type, work_subtype, industry_sector,
        contract_value_planned, contract_value_actual,
        cost_planned, cost_actual, profit_actual, margin_actual_pct,
        duration_planned_calendar_days, duration_actual_calendar_days,
        crew_size_planned, crew_size_actual, crew_composition_actual, work_regime,
        resources_actual, variance, insights,
        source_work_id, source_tender_id, quality_score, notes, embedding_text, created_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
        $19::jsonb,$20::jsonb,$21::jsonb,$22,$23,$24,$25,$26,$27
      ) RETURNING id`;
      const r2 = await db.query(sql, [
        customerName, b.object_name || run.w_object || null, b.city || run.tender_region || null,
        workType, b.work_subtype || null, b.industry_sector || null,
        run.contract_value || null, b.contract_value_actual || null,
        costPlanned, b.cost_actual || null,
        b.profit_actual || null, b.margin_actual_pct || null,
        b.duration_planned_calendar_days || null, b.duration_actual_calendar_days || null,
        b.crew_size_planned || null, b.crew_size_actual || null,
        JSON.stringify(b.crew_composition_actual || {}),
        b.work_regime || null,
        JSON.stringify(b.resources_actual || {}),
        JSON.stringify(b.variance || {}),
        JSON.stringify(b.insights || {}),
        run.work_id || null, run.tender_id || null,
        b.quality_score || 7,
        b.notes || `Р­С‚Р°Р»РѕРЅ СЃРѕР·РґР°РЅ РёР· Conductor run #${runId} (feedback-loop)`,
        `${workType} ${customerName} ${b.object_name || ''}`.toLowerCase(),
        request.user.id
      ]);
      return { ok: true, reference_id: r2.rows[0].id, message: 'Р­С‚Р°Р»РѕРЅ СЃРѕР·РґР°РЅ, Р±СѓРґРµС‚ РёСЃРїРѕР»СЊР·РѕРІР°РЅ РІ РїРѕС…РѕР¶РёС… РїСЂРѕСЃС‡С‘С‚Р°С…' };
    } catch (e) {
      request.log.error(`[save-actuals] ${e.message}`);
      return reply.code(500).send({ error: e.message });
    }
  });

  // GET /conductor/references вЂ” СЃРїРёСЃРѕРє СЌС‚Р°Р»РѕРЅРѕРІ (РґР»СЏ UI Рё Р°РґРјРёРЅ-РїР°РЅРµР»Рё)
  fastify.get('/conductor/references', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request) => {
    const db = fastify.db;
    try {
      const { rows } = await db.query(
        `SELECT id, customer_name, object_name, work_type, industry_sector,
                contract_value_actual, cost_actual, margin_actual_pct,
                duration_actual_calendar_days, quality_score, is_active, created_at
           FROM mimir_reference_projects
          WHERE is_active = true
          ORDER BY quality_score DESC, id DESC
          LIMIT 100`
      );
      return { references: rows };
    } catch (e) {
      return { references: [], error: e.message };
    }
  });

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // GET /references/search?q=&work_type=&volume_min=&volume_max=&limit=10
  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  // РџРѕРёСЃРє РїРѕС…РѕР¶РёС… СЌС‚Р°Р»РѕРЅРѕРІ РёР· mimir_reference_projects РґР»СЏ Quick/Conductor.
  // Р Р°Р·РјРµС‰С‘РЅ РІ СЌС‚РѕРј С„Р°Р№Р»Рµ (Р° РЅРµ РІ /conductor/*) РЅР°РјРµСЂРµРЅРЅРѕ: РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ Рё
  // Quick-СЃРµСЃСЃРёРµР№ РўРљРџ (V129), Рё Conductor'РѕРј (V133), Рё РєР°РЅР±Р°РЅ-РІРёС‚СЂРёРЅРѕР№.
  //
  // RBAC: PM/HEAD_PM/TO/HEAD_TO/ADMIN/DIRECTOR_* (С‡РµСЂРµР· requireRoles).
  //
  // Р’РѕР·РІСЂР°С‰Р°РµС‚ РјР°СЃСЃРёРІ Р·Р°РїРёСЃРµР№ СЃ similarity_pct =
  //   100 - abs(volume - target_volume) / target_volume * 100  (РµСЃР»Рё Р·Р°РґР°РЅ target),
  //   РёРЅР°С‡Рµ 100 (РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ РІСЃРµ В«СЃРѕРІРїР°РґР°СЋС‚В»).
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  fastify.get('/references/search', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const db = fastify.db;
    const q = request.query || {};
    const qText = (q.q || '').toString().trim();
    const workType = (q.work_type || '').toString().trim();
    const volMin = q.volume_min != null && q.volume_min !== '' ? Number(q.volume_min) : null;
    const volMax = q.volume_max != null && q.volume_max !== '' ? Number(q.volume_max) : null;
    let limit = parseInt(q.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 10;
    if (limit > 100) limit = 100;

    const where = ['is_active = TRUE', 'COALESCE(quality_score, 0) >= 5'];
    const params = [];
    let idx = 1;

    if (qText) {
      where.push(`(
        object_name   ILIKE $${idx} OR
        customer_name ILIKE $${idx} OR
        work_type     ILIKE $${idx}
      )`);
      params.push(`%${qText}%`);
      idx++;
    }
    if (workType) {
      where.push(`work_type ILIKE $${idx}`);
      params.push(`%${workType}%`);
      idx++;
    }
    if (Number.isFinite(volMin)) {
      where.push(`duration_actual_workshifts >= $${idx}`);
      params.push(volMin);
      idx++;
    }
    if (Number.isFinite(volMax)) {
      where.push(`duration_actual_workshifts <= $${idx}`);
      params.push(volMax);
      idx++;
    }

    params.push(limit);
    const sql = `
      SELECT id, customer_name, object_name, work_type, work_subtype, industry_sector,
             contract_value_planned, contract_value_actual,
             cost_planned, cost_actual,
             margin_planned_pct, margin_actual_pct,
             duration_planned_workshifts, duration_actual_workshifts,
             duration_planned_calendar_days, duration_actual_calendar_days,
             crew_size_planned, crew_size_actual,
             quality_score, notes, created_at
        FROM mimir_reference_projects
       WHERE ${where.join(' AND ')}
       ORDER BY quality_score DESC NULLS LAST,
                contract_value_actual DESC NULLS LAST,
                id DESC
       LIMIT $${idx}
    `;

    try {
      const { rows } = await db.query(sql, params);
      // Р¦РµР»РµРІРѕР№ volume РґР»СЏ similarity: СЃРµСЂРµРґРёРЅР° РґРёР°РїР°Р·РѕРЅР°, Р»РёР±Рѕ РѕРґРЅР° РіСЂР°РЅРёС†Р°.
      let target = null;
      if (Number.isFinite(volMin) && Number.isFinite(volMax)) target = (volMin + volMax) / 2;
      else if (Number.isFinite(volMin)) target = volMin;
      else if (Number.isFinite(volMax)) target = volMax;

      const items = rows.map((r) => {
        let similarity_pct = 100;
        if (target != null && target > 0) {
          const v = Number(r.duration_actual_workshifts);
          if (Number.isFinite(v)) {
            const diffPct = Math.abs(v - target) / target * 100;
            similarity_pct = Math.max(0, Math.round(100 - diffPct));
          }
        }
        return { ...r, similarity_pct };
      });

      // Р•СЃР»Рё Р·Р°РґР°РЅ target вЂ” РїРµСЂРµСЃРѕСЂС‚РёСЂСѓРµРј РїРѕ similarity (Р±РµР· РїРѕС‚РµСЂРё РїРµСЂРІРёС‡РЅРѕРіРѕ ORDER BY РєР°С‡РµСЃС‚РІР°).
      if (target != null) {
        items.sort((a, b) => (b.similarity_pct - a.similarity_pct) ||
                            ((b.quality_score || 0) - (a.quality_score || 0)));
      }

      return { success: true, items, total: items.length };
    } catch (e) {
      request.log.error({ err: e }, '[mimir-conductor] /references/search failed');
      return reply.code(500).send({ error: 'search_failed', message: 'РќРµ СѓРґР°Р»РѕСЃСЊ РІС‹РїРѕР»РЅРёС‚СЊ РїРѕРёСЃРє РёР·-Р·Р° РІРЅСѓС‚СЂРµРЅРЅРµР№ РѕС€РёР±РєРё.', hint: 'РџРѕРІС‚РѕСЂРёС‚Рµ РїРѕРїС‹С‚РєСѓ. Р•СЃР»Рё РїРѕРІС‚РѕСЂСЏРµС‚СЃСЏ вЂ” СЃРѕРѕР±С‰РёС‚Рµ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂСѓ.' });
    }
  });

  // GET /conductor/awaiting-customer вЂ” РїСЂРѕСЃС‡С‘С‚С‹ РІ РѕР¶РёРґР°РЅРёРё Р·Р°РєР°Р·С‡РёРєР° РґР»СЏ PM
  fastify.get('/conductor/awaiting-customer', {
    preHandler: [fastify.authenticate]
  }, async () => {
    const r = await fastify.db.query(
      `SELECT r.id AS run_id, r.status, r.tender_id, r.blocked_since, r.created_at,
              t.tender_title, t.customer_name,
              l.id AS letter_id, l.letter_number, l.status AS letter_status,
              l.sent_at, l.reply_received_at, l.reminders_sent_count,
              (SELECT COUNT(*)::int FROM mimir_clarifications c
                WHERE c.conductor_run_id = r.id AND c.channel = 'CUSTOMER' AND c.status = 'OPEN') AS open_questions
         FROM mimir_conductor_runs r
         LEFT JOIN tenders t ON t.id = r.tender_id
         LEFT JOIN LATERAL (
            SELECT * FROM mimir_customer_letters ml
             WHERE ml.conductor_run_id = r.id
             ORDER BY ml.id DESC LIMIT 1
         ) l ON true
        WHERE r.status = 'BLOCKED_BY_CUSTOMER'
        ORDER BY r.blocked_since ASC NULLS LAST, r.id DESC
        LIMIT 200`
    );
    const now = Date.now();
    const items = r.rows.map((row) => {
      const sinceTs = row.blocked_since || row.sent_at || row.created_at;
      const days = sinceTs ? Math.floor((now - new Date(sinceTs).getTime()) / 86400000) : 0;
      return { ...row, days_waiting: days };
    });
    return { items };
  });
}

// в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
// HELPERS (РІРЅСѓС‚СЂРё С„Р°Р№Р»Р°, РЅРµ СЌРєСЃРїРѕСЂС‚РёСЂСѓСЋС‚СЃСЏ)
// в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

/**
 * РџРѕРїСЂРѕР±РѕРІР°С‚СЊ СЂРµР·СѓРјРЅСѓС‚СЊ run РµСЃР»Рё РІСЃРµ blocking-clarifications Р·Р°РєСЂС‹С‚С‹.
 * Р’РѕР·РІСЂР°С‰Р°РµС‚ { resumed, remaining, reason }.
 */
async function _tryResumeRun(fastify, runId) {
  const db = fastify.db;
  const { rows: rRows } = await db.query(
    `SELECT status FROM mimir_conductor_runs WHERE id = $1`, [runId]
  );
  const run = rRows[0];
  if (!run) return { resumed: false, reason: 'run_not_found', remaining: 0 };
  if (run.status !== 'BLOCKED_BY_CUSTOMER' && run.status !== 'BLOCKED_BY_PM') {
    return { resumed: false, reason: `run_status=${run.status}`, remaining: 0 };
  }
  const { rows: bRows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM mimir_clarifications
      WHERE conductor_run_id = $1 AND status = 'OPEN' AND blocking = true`,
    [runId]
  );
  const remaining = bRows[0].n;
  if (remaining > 0) {
    return { resumed: false, reason: 'has_blocking_open', remaining };
  }

  // РЎРЅРёРјР°РµРј Р±Р»РѕРє Рё Р·Р°РїСѓСЃРєР°РµРј resume
  await db.query(
    `UPDATE mimir_conductor_runs SET status='RUNNING', blocked_reason=NULL, updated_at=NOW() WHERE id=$1`,
    [runId]
  );
  try {
    await db.query(
      `INSERT INTO mimir_agent_events (conductor_run_id, agent_run_id, event_type, payload)
       VALUES ($1, NULL, 'status_change', $2::jsonb)`,
      [runId, JSON.stringify({ from: run.status, to: 'RUNNING', reason: 'auto-resume: РІСЃРµ Р±Р»РѕРєРµСЂС‹ Р·Р°РєСЂС‹С‚С‹' })]
    );
  } catch (_) {}

  setImmediate(() => {
    try {
      const { runConductorResume } = require('../services/mimir-conductor/apply-answers');
      runConductorResume(runId, {}).catch((err) => {
        fastify.log.warn(`[_tryResumeRun] resume failed: ${err.message}`);
      });
    } catch (e) {
      fastify.log.warn(`[_tryResumeRun] start failed: ${e.message}`);
    }
  });

  return { resumed: true, reason: 'all_blockers_closed', remaining: 0 };
}

/** РџРѕРґСЃС‡С‘С‚ РґРѕРєСѓРјРµРЅС‚РѕРІ СЂР°Р±РѕС‚С‹/С‚РµРЅРґРµСЂР°, РєРѕС‚РѕСЂС‹Рµ РјРѕР¶РЅРѕ РїРѕРґС†РµРїРёС‚СЊ Рє Conductor. */
async function _countAttachableDocuments(db, run) {
  const conds = [];
  const params = [];
  let idx = 1;
  if (run.work_id) { conds.push(`work_id = $${idx++}`); params.push(run.work_id); }
  if (run.tender_id) { conds.push(`tender_id = $${idx++}`); params.push(run.tender_id); }
  if (!conds.length) return 0;
  const sql = `SELECT COUNT(*)::int AS n FROM documents
                WHERE (${conds.join(' OR ')})
                  AND lower(COALESCE(type,'')) NOT IN
                      ('logistics','РїР°СЃРїРѕСЂС‚','РїРѕР»РёСЃ РґРѕ РјСЃСѓ','РїРѕР»РёСЃ','СЃС‡С‘С‚','СЃС‡РµС‚','Р±РёР»РµС‚С‹','Р±РёР»РµС‚','РјРµРґРїРѕР»РёСЃ')`;
  const { rows } = await db.query(sql, params);
  return rows[0].n;
}

module.exports = mimirConductorRoutes;
