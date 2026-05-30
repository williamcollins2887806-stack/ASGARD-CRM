/**
 * ASGARD CRM — Mimir Conductor: HTTP/SSE роуты (Сессия 2, Шаг 2.9)
 * ═══════════════════════════════════════════════════════════════════════════
 * Регистрируется на том же префиксе /api/mimir, что и старый mimir.js, но с
 * непересекающимися путями /conductor/*. Старый Мимир не трогаем.
 *
 *   POST /api/mimir/conductor/start          — запустить просчёт (роль-гейт)
 *   GET  /api/mimir/conductor/events         — SSE-поток War Room (auth ?token=)
 *   GET  /api/mimir/conductor/run/:id        — детали прогона
 *   GET  /api/mimir/conductor/artifact/:id   — один артефакт
 *
 * Фича-флаг ОТМЕНЁН: доступ только по ролям через fastify.requireRoles([...]).
 * AI-вызовы внутри runConductor идут через ai-provider (в dev — stub-режим).
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const cr = require('../services/mimir-conductor/conductor-run');
const { runConductor } = require('../services/mimir-conductor/conductor');

// Роли, которым разрешён запуск Conductor (ADMIN проходит автоматически,
// HEAD_* наследуют — это уже встроено в fastify.requireRoles).
const ALLOWED_ROLES = [
  'PM', 'HEAD_PM', 'TO', 'HEAD_TO',
  'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'
];

// Терминальные статусы прогона — на них SSE закрывает поток.
const TERMINAL_STATUSES = new Set([
  'READY_FOR_REVIEW', 'ERROR', 'APPROVED', 'REJECTED'
]);

async function mimirConductorRoutes(fastify, options) {
  // ═══════════════════════════════════════════════════════════════════════════
  // POST /conductor/start — создать прогон и запустить его (fire-and-forget)
  // ═══════════════════════════════════════════════════════════════════════════
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
        error: 'Нужен хотя бы один из: work_id, tender_id, estimate_id'
      });
    }

    let contractValue = body.contract_value ?? null;

    // Если задан work_id — подтянем контрактную стоимость из works.
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
      return reply.code(500).send({ error: 'Не удалось создать прогон' });
    }

    const runId = run.runId;

    // Fire-and-forget: не блокируем ответ. Ошибки внутри loop → статус ERROR.
    setImmediate(() => {
      runConductor(runId).catch(async (err) => {
        try {
          await cr.updateRunStatus(runId, 'ERROR', {
            errorMessage: String(err && err.message ? err.message : err)
          });
          await cr.addEvent(runId, null, 'error', {
            message: String(err && err.message ? err.message : err),
            stage: 'runConductor'
          });
        } catch (inner) {
          request.log.error(`[conductor] не удалось записать ERROR для run ${runId}: ${inner.message}`);
        }
      });
    });

    return reply.code(202).send({ run_id: runId, status: run.status });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /conductor/events?run_id=&since_event_id= — SSE War Room
  // Авторизация через ?token= (EventSource не шлёт заголовки).
  // ═══════════════════════════════════════════════════════════════════════════
  fastify.get('/conductor/events', async (request, reply) => {
    const token = request.query.token;
    if (!token) return reply.code(401).send({ error: 'Token required' });

    try {
      fastify.jwt.verify(token);
    } catch (err) {
      return reply.code(401).send({ error: 'Invalid token' });
    }

    const runId = Number(request.query.run_id);
    if (!Number.isInteger(runId) || runId <= 0) {
      return reply.code(400).send({ error: 'run_id required' });
    }

    // Проверим, что прогон существует.
    const run = await cr.getRun(runId);
    if (!run) return reply.code(404).send({ error: 'Run not found' });

    const raw = reply.raw;
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

    // Досылка новых событий + закрытие на терминальном статусе.
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

    // Первый catch-up сразу.
    flush();

    // Long-lived: не вызываем reply.send().
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /conductor/run/:id — детали прогона
  // ═══════════════════════════════════════════════════════════════════════════
  fastify.get('/conductor/run/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const runId = Number(request.params.id);
    if (!Number.isInteger(runId) || runId <= 0) {
      return reply.code(400).send({ error: 'Invalid run id' });
    }
    const details = await cr.getFullRunDetails(runId);
    if (!details) return reply.code(404).send({ error: 'Run not found' });
    return details;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /conductor/artifact/:id — один артефакт
  // ═══════════════════════════════════════════════════════════════════════════
  fastify.get('/conductor/artifact/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const artifactId = Number(request.params.id);
    if (!Number.isInteger(artifactId) || artifactId <= 0) {
      return reply.code(400).send({ error: 'Invalid artifact id' });
    }
    const artifact = await cr.getArtifactById(artifactId);
    if (!artifact) return reply.code(404).send({ error: 'Artifact not found' });
    return artifact;
  });
}

module.exports = mimirConductorRoutes;
