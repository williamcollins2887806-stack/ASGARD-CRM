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

const fs = require('fs');
const path = require('path');
const cr = require('../services/mimir-conductor/conductor-run');
const { runConductor } = require('../services/mimir-conductor/conductor');
const { generateClarificationLetter, getLetterById, LETTERS_DIR } = require('../services/mimir-conductor/letter-generator');
const { parseReplyAndMap } = require('../services/mimir-conductor/reply-parser');
const { applyAnswers, resumeConductorIfBlocked } = require('../services/mimir-conductor/apply-answers');
const { generateDirectorReport } = require('../services/mimir-conductor/director-report');

// Роли, которым разрешён запуск Conductor (ADMIN проходит автоматически,
// HEAD_* наследуют — это уже встроено в fastify.requireRoles).
const ALLOWED_ROLES = [
  'PM', 'HEAD_PM', 'TO', 'HEAD_TO',
  'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'
];

// Роли «всевидящего» доступа: руководство и директора читают ЛЮБОЙ просчёт.
// Остальные роли из ALLOWED_ROLES видят только свои (initiated_by === user.id).
const SUPERVISOR_ROLES = new Set([
  'ADMIN', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'CHIEF_ENGINEER'
]);

/**
 * Проверка доступа к конкретному прогону: владелец ИЛИ супервизорская роль.
 * @returns {boolean}
 */
function canAccessRun(user, run) {
  if (!user || !run) return false;
  if (SUPERVISOR_ROLES.has(user.role)) return true;
  return Number(run.initiated_by) === Number(user.id);
}

// Терминальные статусы прогона — на них SSE закрывает поток.
const TERMINAL_STATUSES = new Set([
  'READY_FOR_REVIEW', 'ERROR', 'APPROVED', 'REJECTED'
]);

// Ответ заказчика на письмо: допустимые MIME и лимит размера (Сессия 08, fix #3).
const MAX_REPLY_BYTES = 50 * 1024 * 1024; // 50 MB
const ALLOWED_REPLY_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/msword', // doc (на всякий)
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.ms-excel', // xls
  'image/jpeg',
  'image/png',
  'image/tiff',
  'text/plain'
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

    let tokenUser;
    try {
      tokenUser = fastify.jwt.verify(token);
    } catch (err) {
      return reply.code(401).send({ error: 'Invalid token' });
    }

    // Роль-гейт (preHandler здесь не применим — авторизация через ?token=).
    if (!(tokenUser.role === 'ADMIN' || ALLOWED_ROLES.includes(tokenUser.role))) {
      return reply.code(403).send({ error: 'Недостаточно прав' });
    }

    const runId = Number(request.query.run_id);
    if (!Number.isInteger(runId) || runId <= 0) {
      return reply.code(400).send({ error: 'run_id required' });
    }

    // Проверим, что прогон существует.
    const run = await cr.getRun(runId);
    if (!run) return reply.code(404).send({ error: 'Run not found' });

    // Доступ — владелец прогона ИЛИ супервизорская роль.
    if (!canAccessRun(tokenUser, run)) {
      return reply.code(403).send({ error: 'Нет доступа к этому просчёту' });
    }

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
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const runId = Number(request.params.id);
    if (!Number.isInteger(runId) || runId <= 0) {
      return reply.code(400).send({ error: 'Invalid run id' });
    }
    const details = await cr.getFullRunDetails(runId);
    if (!details) return reply.code(404).send({ error: 'Run not found' });
    if (!canAccessRun(request.user, details.run)) {
      return reply.code(403).send({ error: 'Нет доступа к этому просчёту' });
    }
    return details;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // СЕССИЯ 7 — Директорский отчёт (PDF)
  // ═══════════════════════════════════════════════════════════════════════════

  // POST /conductor/run/:id/generate-report — сгенерировать директорский PDF
  fastify.post('/conductor/run/:id/generate-report', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const runId = Number(request.params.id);
    if (!Number.isInteger(runId) || runId <= 0) {
      return reply.code(400).send({ error: 'Invalid run id' });
    }
    const run = await cr.getRun(runId);
    if (!run) return reply.code(404).send({ error: 'Run not found' });
    // Отчёт строится по готовому просчёту.
    if (!['READY_FOR_REVIEW', 'APPROVED', 'REJECTED'].includes(run.status)) {
      return reply.code(409).send({
        error: `Отчёт можно сгенерировать только по завершённому просчёту (статус: ${run.status})`
      });
    }
    try {
      const { pdfPath } = await generateDirectorReport(runId);
      return { ok: true, run_id: runId, report_path: pdfPath };
    } catch (e) {
      request.log.error(`[conductor/generate-report] run ${runId}: ${e.message}`);
      return reply.code(500).send({ error: `Не удалось сгенерировать отчёт: ${e.message}` });
    }
  });

  // GET /conductor/run/:id/report — скачать сгенерированный PDF
  fastify.get('/conductor/run/:id/report', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const runId = Number(request.params.id);
    if (!Number.isInteger(runId) || runId <= 0) {
      return reply.code(400).send({ error: 'Invalid run id' });
    }
    const run = await cr.getRun(runId);
    if (!run) return reply.code(404).send({ error: 'Run not found' });
    if (!canAccessRun(request.user, run)) {
      return reply.code(403).send({ error: 'Нет доступа к этому отчёту' });
    }
    const filePath = run.director_report_path;
    if (!filePath || !fs.existsSync(filePath)) {
      return reply.code(404).send({ error: 'Отчёт ещё не сгенерирован. Сначала вызовите generate-report.' });
    }
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `inline; filename="director_report_${runId}.pdf"`);
    return reply.send(fs.createReadStream(filePath));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /conductor/artifact/:id — один артефакт
  // ═══════════════════════════════════════════════════════════════════════════
  fastify.get('/conductor/artifact/:id', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const artifactId = Number(request.params.id);
    if (!Number.isInteger(artifactId) || artifactId <= 0) {
      return reply.code(400).send({ error: 'Invalid artifact id' });
    }
    const artifact = await cr.getArtifactById(artifactId);
    if (!artifact) return reply.code(404).send({ error: 'Artifact not found' });
    // Доступ — по владельцу прогона, к которому принадлежит артефакт.
    const run = await cr.getRun(artifact.conductor_run_id);
    if (!canAccessRun(request.user, run)) {
      return reply.code(403).send({ error: 'Нет доступа к этому артефакту' });
    }
    return artifact;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // СЕССИЯ 5 — Уточнения, письма заказчику, async-ответы
  // ═══════════════════════════════════════════════════════════════════════════

  // POST /conductor/letter/generate — { run_id, clarification_ids }
  fastify.post('/conductor/letter/generate', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const body = request.body || {};
    const runId = Number(body.run_id);
    const ids = Array.isArray(body.clarification_ids) ? body.clarification_ids.map(Number).filter(Boolean) : [];
    if (!Number.isInteger(runId) || runId <= 0) return reply.code(400).send({ error: 'run_id required' });
    if (!ids.length) return reply.code(400).send({ error: 'clarification_ids required' });
    try {
      return await generateClarificationLetter({ runId, clarificationIds: ids, pmUserId: request.user.id });
    } catch (e) {
      request.log.error(`[letter/generate] ${e.message}`);
      return reply.code(400).send({ error: e.message });
    }
  });

  // GET /conductor/letter/:id/download/:format — format: docx | pdf
  fastify.get('/conductor/letter/:id/download/:format', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const letter = await getLetterById(Number(request.params.id));
    if (!letter) return reply.code(404).send({ error: 'Letter not found' });
    const format = request.params.format === 'pdf' ? 'pdf' : 'docx';
    const filePath = format === 'pdf' ? letter.pdf_path : letter.docx_path;
    if (!filePath || !fs.existsSync(filePath)) return reply.code(404).send({ error: 'Файл письма не найден на диске' });

    const mime = format === 'pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const fname = `${(letter.letter_number || 'letter').replace(/[\\/]/g, '_')}.${format}`;
    reply.header('Content-Type', mime);
    reply.header('Content-Disposition', `attachment; filename="${fname}"`);
    return reply.send(fs.createReadStream(filePath));
  });

  // POST /conductor/letter/:id/mark-sent — { sent_at?, channel? }
  fastify.post('/conductor/letter/:id/mark-sent', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const letterId = Number(request.params.id);
    const letter = await getLetterById(letterId);
    if (!letter) return reply.code(404).send({ error: 'Letter not found' });
    const body = request.body || {};
    const sentAt = body.sent_at ? new Date(body.sent_at) : new Date();

    await fastify.db.query(
      "UPDATE mimir_customer_letters SET status = 'SENT', sent_at = $1, sent_by = $2 WHERE id = $3",
      [sentAt, request.user.id, letterId]
    );
    // Открытые вопросы письма → ждут ответа заказчика (остаются OPEN+blocking, но
    // помечаем источник статусом ожидания через событие).
    try {
      await cr.addEvent(letter.conductor_run_id, null, 'letter_sent', {
        letter_id: letterId, letter_number: letter.letter_number, channel: body.channel || 'manual'
      });
    } catch (_) { /* noop */ }
    return { ok: true };
  });

  // POST /conductor/letter/:id/upload-reply — multipart file ИЛИ body.text
  fastify.post('/conductor/letter/:id/upload-reply', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const letterId = Number(request.params.id);
    const letter = await getLetterById(letterId);
    if (!letter) return reply.code(404).send({ error: 'Letter not found' });

    let replyPath = null;
    let rawText = null;

    if (request.isMultipart && request.isMultipart()) {
      // Лимит размера на уровне стрима: при превышении файл будет «truncated».
      const file = await request.file({ limits: { fileSize: MAX_REPLY_BYTES } });
      if (file) {
        // MIME-whitelist (fix #3) — отсекаем до записи на диск.
        if (file.mimetype && !ALLOWED_REPLY_MIMES.has(file.mimetype)) {
          return reply.code(415).send({
            error: `Тип файла не поддерживается: ${file.mimetype}. Разрешены: PDF, DOCX, XLSX, JPG, PNG, TIFF, TXT.`
          });
        }
        if (!fs.existsSync(LETTERS_DIR)) fs.mkdirSync(LETTERS_DIR, { recursive: true });
        const safe = `reply_${letterId}_${Date.now()}${path.extname(file.filename || '') || '.bin'}`;
        replyPath = path.join(LETTERS_DIR, safe);
        await new Promise((resolve, rej) => {
          const ws = fs.createWriteStream(replyPath);
          file.file.pipe(ws);
          ws.on('finish', resolve);
          ws.on('error', rej);
        });
        // Превышение лимита: поток обрезан → удаляем огрызок и возвращаем 413.
        if (file.file.truncated) {
          try { fs.unlinkSync(replyPath); } catch (_) { /* noop */ }
          return reply.code(413).send({
            error: `Файл превышает лимит ${Math.floor(MAX_REPLY_BYTES / (1024 * 1024))} МБ`
          });
        }
        // Текстовое поле text может ехать рядом в multipart
        if (file.fields && file.fields.text && file.fields.text.value) rawText = file.fields.text.value;
      }
    } else {
      rawText = (request.body && request.body.text) || null;
    }

    if (!replyPath && !rawText) return reply.code(400).send({ error: 'Нужен файл или текст ответа' });

    try {
      const mapping = await parseReplyAndMap(letterId, replyPath, rawText);
      return { mapping };
    } catch (e) {
      request.log.error(`[letter/upload-reply] ${e.message}`);
      return reply.code(500).send({ error: e.message });
    }
  });

  // POST /conductor/letter/:id/apply-mapping — { mapping:[{question_id, answer_text}] }
  fastify.post('/conductor/letter/:id/apply-mapping', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const letterId = Number(request.params.id);
    const body = request.body || {};
    const mapping = Array.isArray(body.mapping) ? body.mapping : [];
    if (!mapping.length) return reply.code(400).send({ error: 'mapping required' });
    try {
      const applied = await applyAnswers(letterId, mapping, request.user.id);
      const resume = await resumeConductorIfBlocked(letterId);
      return { ok: true, applied, resume };
    } catch (e) {
      request.log.error(`[letter/apply-mapping] ${e.message}`);
      return reply.code(500).send({ error: e.message });
    }
  });

  // GET /conductor/awaiting-customer — просчёты в ожидании заказчика для PM
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

module.exports = mimirConductorRoutes;
