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

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /conductor/clarification/:id/answer — универсальный ответ на уточнение
  // Принимает один из: answer_text (текст), document_ids[] (привязать файлы как ответ),
  // accept_assumption=true (принять default_assumption). После применения автоматически
  // проверяет блокеры и резумит Conductor если все blocking-вопросы закрыты.
  // ═══════════════════════════════════════════════════════════════════════════
  fastify.post('/conductor/clarification/:id/answer', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const clarId = Number(request.params.id);
    if (!clarId) return reply.code(400).send({ error: 'bad clarification id' });
    const body = request.body || {};
    const answerText = body.answer_text != null ? String(body.answer_text).trim() : null;
    const docIds = Array.isArray(body.document_ids) ? body.document_ids.filter((x) => Number.isInteger(Number(x))).map(Number) : [];
    const acceptAssumption = !!body.accept_assumption;

    const db = fastify.db;
    try {
      // Получаем уточнение + проверяем что run видимо текущему пользователю
      const { rows } = await db.query(
        `SELECT c.id, c.conductor_run_id, c.status, c.channel, c.blocking, c.default_assumption,
                r.tender_id, r.work_id, r.initiated_by
           FROM mimir_clarifications c
           JOIN mimir_conductor_runs r ON r.id = c.conductor_run_id
          WHERE c.id = $1`,
        [clarId]
      );
      const cl = rows[0];
      if (!cl) return reply.code(404).send({ error: 'Уточнение не найдено' });
      if (cl.status !== 'OPEN') return reply.code(409).send({ error: `Уточнение уже ${cl.status}` });

      // RBAC: PM может отвечать только в своих run, директор/админ — везде.
      if (request.user.role === 'PM' && cl.initiated_by && cl.initiated_by !== request.user.id) {
        return reply.code(403).send({ error: 'Нет доступа к чужому просчёту' });
      }

      // Собираем итоговый текст ответа
      let finalAnswer = '';
      let answerSource = 'manual';

      if (acceptAssumption && cl.default_assumption) {
        const asp = typeof cl.default_assumption === 'string' ? cl.default_assumption : JSON.stringify(cl.default_assumption);
        finalAnswer = `[Принято допущение по умолчанию] ${asp}`;
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
        const docList = docs.map((d) => `#${d.id} ${d.original_name} (${d.mime_type}, ${d.kb} КБ)`).join('; ');
        finalAnswer = (finalAnswer ? finalAnswer + '\n\n' : '') + `[Приложены файлы] ${docList}`;
        answerSource = answerSource === 'manual' ? 'document_upload' : 'mixed';
      }

      if (!finalAnswer) {
        return reply.code(400).send({ error: 'Нужен либо answer_text, либо document_ids[], либо accept_assumption' });
      }

      // UPDATE clarification
      await db.query(
        `UPDATE mimir_clarifications
            SET status = 'ANSWERED', answer_text = $1, answered_by = $2,
                answered_at = NOW(), answer_source = $3, updated_at = NOW()
          WHERE id = $4`,
        [finalAnswer, request.user.id, answerSource, clarId]
      );

      // Событие в War Room
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

      // Авто-resume если все блокеры закрыты
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

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /conductor/clarification/:id/answer-with-norms — структурированный ввод
  // нормативов прямо из War Room. РП видит expected_inputs[], заполняет поля,
  // данные пишутся в нужное хранилище (settings.company_profile / field_tariff_grid
  // / settings.reference_norms / tz_summary) и clarification закрывается.
  // Тело: { values: { <expected_input.key>: <значение>, ... } }
  // ═══════════════════════════════════════════════════════════════════════════
  fastify.post('/conductor/clarification/:id/answer-with-norms', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const clarId = Number(request.params.id);
    if (!clarId) return reply.code(400).send({ error: 'bad clarification id' });
    const values = (request.body && request.body.values) || {};
    if (!Object.keys(values).length) return reply.code(400).send({ error: 'values пустой' });

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
      if (!cl) return reply.code(404).send({ error: 'Уточнение не найдено' });
      if (cl.status !== 'OPEN') return reply.code(409).send({ error: `Уточнение уже ${cl.status}` });
      if (request.user.role === 'PM' && cl.initiated_by && cl.initiated_by !== request.user.id) {
        return reply.code(403).send({ error: 'Нет доступа к чужому просчёту' });
      }

      // expected_inputs[] хранится в options_json (как часть clarification)
      const expected = (cl.options_json && Array.isArray(cl.options_json.expected_inputs))
        ? cl.options_json.expected_inputs : [];

      const writes = [];
      const summary = [];
      for (const inp of expected) {
        const v = values[inp.key];
        if (v == null || v === '') {
          if (!inp.optional) {
            return reply.code(400).send({ error: `Поле "${inp.key}" обязательно` });
          }
          continue;
        }
        const value = inp.type === 'number' ? Number(v) : String(v);
        if (inp.type === 'number' && !Number.isFinite(value)) {
          return reply.code(400).send({ error: `Поле "${inp.key}" должно быть числом` });
        }
        writes.push({ target: inp.target, key: inp.key, value, label: inp.label });
      }

      // Применяем каждое write к нужному хранилищу
      await db.transaction(async (client) => {
        for (const w of writes) {
          const t = String(w.target || '');
          if (t.startsWith('company_profile.financial_policy.')) {
            const fpKey = t.replace('company_profile.financial_policy.', '');
            await client.query(
              `INSERT INTO settings (key, value_json, description, updated_at)
               VALUES ('company_profile', jsonb_build_object('financial_policy', jsonb_build_object($1::text, $2::numeric)), 'Mimir Conductor — авто-обновление', NOW())
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
               VALUES ('reference_norms', jsonb_set('{}'::jsonb, $1::text[], to_jsonb($2::numeric), true), 'Mimir Conductor — производственные нормативы (заполняются РП)', NOW())
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
            // Дополняем артефакт tz_summary текущего run — создаём новую версию
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
            // Помечаем старую как superseded и создаём новую
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
            summary.push(`tz_summary.${path.join('.')} = ${w.value} (новый артефакт ${ins.rows[0].id})`);
          } else {
            summary.push(`SKIPPED unknown target: ${t}`);
          }
        }

        // Закрываем clarification
        await client.query(
          `UPDATE mimir_clarifications
              SET status='ANSWERED', answer_text=$1, answered_by=$2, answered_at=NOW(),
                  answer_source='inline_form', updated_at=NOW()
            WHERE id=$3`,
          [`РП заполнил поля: ${summary.join('; ')}`, request.user.id, clarId]
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

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /conductor/run/:id/recheck-blockers — пересмотр блокеров (когда РП
  // загрузил документы через UI работы/тендера, без явного «ответа на вопрос»).
  // Если у run все blocking-clarifications закрыты ИЛИ появились новые документы
  // покрывающие категорию документного вопроса — пометить ANSWERED + resume.
  // ═══════════════════════════════════════════════════════════════════════════
  fastify.post('/conductor/run/:id/recheck-blockers', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const runId = Number(request.params.id);
    if (!runId) return reply.code(400).send({ error: 'bad run id' });
    const db = fastify.db;
    try {
      const { rows } = await db.query(
        `SELECT id, status, tender_id, work_id, initiated_by FROM mimir_conductor_runs WHERE id = $1`,
        [runId]
      );
      const run = rows[0];
      if (!run) return reply.code(404).send({ error: 'Просчёт не найден' });
      if (request.user.role === 'PM' && run.initiated_by !== request.user.id) {
        return reply.code(403).send({ error: 'Нет доступа' });
      }
      // Подсчитаем новые документы тендера/работы, не учтённые в parsed_documents
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

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /conductor/run/:id/recompute-with-feedback — пересчёт по правке РП.
  // Принимает {feedback_text}. Сохраняет правку как pm_feedback-артефакт,
  // переводит run в RUNNING, инициирует runConductorResume — следующая итерация
  // Conductor учтёт обратную связь.
  // ═══════════════════════════════════════════════════════════════════════════
  fastify.post('/conductor/run/:id/recompute-with-feedback', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const runId = Number(request.params.id);
    const feedback = String((request.body && request.body.feedback_text) || '').trim();
    if (!runId) return reply.code(400).send({ error: 'bad run id' });
    if (!feedback) return reply.code(400).send({ error: 'feedback_text обязателен' });

    const db = fastify.db;
    try {
      const { rows } = await db.query(
        `SELECT id, status, initiated_by FROM mimir_conductor_runs WHERE id = $1`,
        [runId]
      );
      const run = rows[0];
      if (!run) return reply.code(404).send({ error: 'Просчёт не найден' });
      if (request.user.role === 'PM' && run.initiated_by !== request.user.id) {
        return reply.code(403).send({ error: 'Нет доступа' });
      }
      // Сохраняем feedback как артефакт типа pm_feedback (Conductor его учтёт)
      const cr = require('../services/mimir-conductor/conductor-run');
      const artifact = {
        summary: 'Обратная связь РП к финальной смете',
        feedback_text: feedback,
        author_user_id: request.user.id,
        created_at: new Date().toISOString()
      };
      try {
        await cr.addArtifact(runId, null, 'pm_feedback', artifact);
      } catch (_) { /* схема может ругаться на тип — не критично */ }

      // Перевод run в RUNNING
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

      // Фоновый resume
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

      return { ok: true, run_id: runId, status: 'RUNNING', message: 'Conductor учтёт правку в следующей итерации' };
    } catch (e) {
      request.log.error(`[recompute-with-feedback] ${e.message}`);
      return reply.code(500).send({ error: e.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /conductor/run/:id/adjust-margin — РП изменяет маржу/прибыль в финальной
  // смете и получает пересчитанные цифры. Создаётся новая версия артефакта
  // final_estimate (старая помечается superseded). Не запускает Conductor —
  // просто математический пересчёт revenue/VAT при той же себестоимости.
  //
  // Body: { new_margin_pct: 22.5 } ИЛИ { new_profit_rub: 5000000 } ИЛИ { new_total_with_margin: 30000000 }
  // ═══════════════════════════════════════════════════════════════════════════
  fastify.post('/conductor/run/:id/adjust-margin', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const runId = Number(request.params.id);
    if (!runId) return reply.code(400).send({ error: 'bad run id' });
    const b = request.body || {};
    const db = fastify.db;
    try {
      const { rows: rRows } = await db.query(
        `SELECT initiated_by FROM mimir_conductor_runs WHERE id = $1`, [runId]
      );
      if (!rRows[0]) return reply.code(404).send({ error: 'Просчёт не найден' });
      if (request.user.role === 'PM' && rRows[0].initiated_by !== request.user.id) {
        return reply.code(403).send({ error: 'Нет доступа' });
      }

      // Берём текущий final_estimate
      const cr = require('../services/mimir-conductor/conductor-run');
      const final = await cr.getArtifact(runId, 'final_estimate');
      if (!final || !final.content || !final.content.ssr) {
        return reply.code(400).send({ error: 'Финальная смета ещё не готова — Conductor не дошёл до неё' });
      }
      const ssr = JSON.parse(JSON.stringify(final.content.ssr));
      const cost = Number(ssr.total_cost) || 0;
      if (cost <= 0) {
        return reply.code(400).send({ error: 'Себестоимость = 0 — нельзя пересчитать маржу' });
      }

      // Определяем новую маржу из любого из трёх полей body
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
        return reply.code(400).send({ error: 'Нужно одно из: new_margin_pct, new_profit_rub, new_total_with_margin' });
      }

      if (!isFinite(newMarginPct) || newMarginPct < 0 || newMarginPct >= 95) {
        return reply.code(400).send({ error: 'Маржа должна быть в диапазоне 0..95%' });
      }

      // Пересчёт
      const marginDec = newMarginPct / 100;
      const newRevenue = cost / (1 - marginDec);
      const newProfit = newRevenue - cost;
      const vatPct = Number(ssr.vat_pct) || 22;
      const newVat = newRevenue * vatPct / 100;
      const newTotalWithVat = newRevenue + newVat;

      // Старые цифры для аудита
      const oldRevenue = Number(ssr.total_with_margin) || 0;
      const oldMargin = Number(ssr.gross_profit_margin_pct) || 0;

      // Обновлённая SSR
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

      // Сохраняем новую версию артефакта (supersede старой)
      const newContent = Object.assign({}, final.content, { ssr });
      try {
        await cr.addArtifact(runId, null, 'final_estimate', newContent);
      } catch (_) { /* schema может ругаться при дубле — best-effort */ }

      // Событие в War Room
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

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /conductor/reference/import — импорт эталона напрямую (РП заполняет
  // фактические данные после завершения работы или загружает старый проект).
  // Принимает полный набор полей mimir_reference_projects. Endpoint минимально
  // умный — структуру эталона формирует РП через UI (либо опциональный AI-extract).
  // ═══════════════════════════════════════════════════════════════════════════
  fastify.post('/conductor/reference/import', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const b = request.body || {};
    const db = fastify.db;
    try {
      if (!b.customer_name || !b.work_type) {
        return reply.code(400).send({ error: 'customer_name и work_type обязательны' });
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

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /conductor/run/:id/save-actuals — после завершения реальной работы
  // РП вносит фактические цифры → создаём эталон автоматически из run+actuals.
  // Это и есть feedback-loop: каждая закрытая работа = +1 эталон в базу.
  // ═══════════════════════════════════════════════════════════════════════════
  fastify.post('/conductor/run/:id/save-actuals', {
    preHandler: [fastify.authenticate, fastify.requireRoles(ALLOWED_ROLES)]
  }, async (request, reply) => {
    const runId = Number(request.params.id);
    const b = request.body || {};
    if (!runId) return reply.code(400).send({ error: 'bad run id' });
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
      if (!run) return reply.code(404).send({ error: 'Просчёт не найден' });
      if (request.user.role === 'PM' && run.initiated_by !== request.user.id) {
        return reply.code(403).send({ error: 'Нет доступа' });
      }

      // Получаем артефакт final_estimate если был (для cost_planned)
      const cr = require('../services/mimir-conductor/conductor-run');
      const finalArt = await cr.getArtifact(runId, 'final_estimate').catch(() => null);
      const costPlanned = (finalArt && finalArt.content && finalArt.content.ssr && finalArt.content.ssr.subtotal_cost) || run.contract_value || null;

      const customerName = b.customer_name || run.w_customer || run.t_customer || 'Неизвестный заказчик';
      const workType = b.work_type || run.work_title || run.tender_title || 'Подрядные работы';

      // Создаём эталон
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
        b.notes || `Эталон создан из Conductor run #${runId} (feedback-loop)`,
        `${workType} ${customerName} ${b.object_name || ''}`.toLowerCase(),
        request.user.id
      ]);
      return { ok: true, reference_id: r2.rows[0].id, message: 'Эталон создан, будет использован в похожих просчётах' };
    } catch (e) {
      request.log.error(`[save-actuals] ${e.message}`);
      return reply.code(500).send({ error: e.message });
    }
  });

  // GET /conductor/references — список эталонов (для UI и админ-панели)
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

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS (внутри файла, не экспортируются)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Попробовать резумнуть run если все blocking-clarifications закрыты.
 * Возвращает { resumed, remaining, reason }.
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

  // Снимаем блок и запускаем resume
  await db.query(
    `UPDATE mimir_conductor_runs SET status='RUNNING', blocked_reason=NULL, updated_at=NOW() WHERE id=$1`,
    [runId]
  );
  try {
    await db.query(
      `INSERT INTO mimir_agent_events (conductor_run_id, agent_run_id, event_type, payload)
       VALUES ($1, NULL, 'status_change', $2::jsonb)`,
      [runId, JSON.stringify({ from: run.status, to: 'RUNNING', reason: 'auto-resume: все блокеры закрыты' })]
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

/** Подсчёт документов работы/тендера, которые можно подцепить к Conductor. */
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
                      ('logistics','паспорт','полис до мсу','полис','счёт','счет','билеты','билет','медполис')`;
  const { rows } = await db.query(sql, params);
  return rows[0].n;
}

module.exports = mimirConductorRoutes;
