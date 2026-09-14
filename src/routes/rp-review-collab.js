'use strict';

/**
 * RP-review collab extensions: participant drafts, Mimor start/apply, import-to-final.
 * Registered inside reviewRoutes on /api/tenders.
 */
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const {
  ensureReview,
  writeReviewLog,
  getCurrentDuty
} = require('../services/tender-registry-helpers');
const {
  purposeForPhase,
  resolveFinalOwner,
  ensureAnalysisOwner,
  upsertMyDraft,
  getMyDraft,
  listTeamDrafts,
  enrichDraft,
  mapMimirToReportFields,
  parseJson
} = require('../services/rp-review-drafts');
const { createNotification } = require('../services/notify');
const { broadcast } = require('./sse');

const PM_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
/** Write override: не включать TO — иначе ТО случайно становится хозяином финала. */
const WIDE_WRITE_ROLES = ['ADMIN', 'HEAD_TO', 'HEAD_PM'];

async function isCollaborator(db, tenderId, userId) {
  const r = await db.query(`
    SELECT 1 FROM tender_rp_review_collaborators c
    WHERE c.tender_id = $1 AND c.pm_user_id = $2 AND c.revoked_at IS NULL
  `, [tenderId, userId]);
  return r.rows.length > 0;
}

async function canTouchReview(db, tenderId, user) {
  const userId = user.id;
  const role = user.role || '';
  const duty = await getCurrentDuty(db);
  const isDuty = duty && Number(duty.pm_user_id) === userId;
  const collab = await isCollaborator(db, tenderId, userId);
  const tenderRow = await db.query(
    'SELECT calculator_user_id, calculator_kind FROM tenders WHERE id = $1',
    [tenderId]
  );
  const tender = tenderRow.rows[0] || null;
  const isCalc = tender && Number(tender.calculator_user_id) === userId;
  const isWide = WIDE_WRITE_ROLES.includes(role);
  const ok = isWide || isDuty || collab || isCalc;
  return { ok, isDuty, collab, isCalc, isWide, tender, duty };
}

async function saveBufferAsDoc(db, {
  tenderId, userId, buffer, originalName, mimeType, docType, subdir
}) {
  const uploadRoot = process.env.UPLOAD_DIR || './uploads';
  const dir = path.join(uploadRoot, subdir, String(tenderId));
  await fs.mkdir(dir, { recursive: true });
  const safeName = `${Date.now()}_${String(originalName || 'file').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  await fs.writeFile(path.join(dir, safeName), buffer);
  const downloadUrl = `/uploads/${subdir}/${tenderId}/${safeName}`;
  const docRes = await db.query(`
    INSERT INTO documents (filename, original_name, mime_type, size, type, tender_id, uploaded_by, download_url, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    RETURNING id, original_name, download_url, size, mime_type, created_at
  `, [
    safeName, originalName || safeName, mimeType || 'application/octet-stream',
    buffer.length, docType, tenderId, userId, downloadUrl
  ]);
  return docRes.rows[0];
}

function registerRpReviewCollabRoutes(fastify) {
  const db = fastify.db;

  // ── GET my-draft ──────────────────────────────────────────────
  fastify.get('/:id/rp-review/my-draft', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, async (request, reply) => {
    const tenderId = request.params.id;
    const access = await canTouchReview(db, tenderId, request.user);
    if (!access.ok) return reply.code(403).send({ error: 'Нет доступа' });
    const review = await ensureReview(db, tenderId, request.user.id);
    const phase = request.query.phase === 'calc' || review.analysis_finalized_at ? 'calc' : 'analysis';
    const draft = await getMyDraft(db, review.id, request.user.id, phase);
    return { draft: draft ? await enrichDraft(db, draft) : null, phase };
  });

  // ── PUT my-draft ──────────────────────────────────────────────
  fastify.put('/:id/rp-review/my-draft', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, async (request, reply) => {
    const tenderId = request.params.id;
    const userId = request.user.id;
    const access = await canTouchReview(db, tenderId, request.user, { needWrite: true });
    if (!access.ok) return reply.code(403).send({ error: 'Нет доступа к черновику' });

    let review = await ensureReview(db, tenderId, userId);
    review = await ensureAnalysisOwner(db, review, userId, access.duty?.pm_user_id, { allowActorFallback: true });
    if (review.is_final) return reply.code(409).send({ error: 'Отчёт уже закрыт' });

    const b = request.body || {};
    const phase = b.phase === 'calc' || review.analysis_finalized_at ? 'calc' : 'analysis';
    if (review.analysis_finalized_at && phase === 'analysis') {
      return reply.code(409).send({ error: 'Анализ уже закрыт' });
    }

    try {
      const draft = await upsertMyDraft(db, {
        reviewId: review.id,
        tenderId: Number(tenderId),
        authorUserId: userId,
        phase,
        draftJson: b.draft_json != null ? b.draft_json : null,
        status: b.status || undefined,
        estimateFileId: b.estimate_file_id,
        reportFileId: b.report_file_id,
        tkpFileId: b.tkp_file_id,
        mimirSessionUid: b.mimir_session_uid,
        expectedUpdatedAt: b.expected_updated_at
      });

      if (b.status === 'ready') {
        await writeReviewLog(db, {
          reviewId: review.id, tenderId, actorUserId: userId,
          action: 'draft_ready', payload: { phase, draft_id: draft.id }
        });
        // Notify final owner
        const { ownerUserId } = await resolveFinalOwner(db, review, access.tender, access.duty?.pm_user_id);
        if (ownerUserId && ownerUserId !== userId) {
          createNotification(db, {
            user_id: ownerUserId,
            type: 'rp_draft_ready',
            title: 'Черновик РП готов',
            message: `${request.user.name || 'РП'} отметил черновик (${phase === 'calc' ? 'просчёт' : 'анализ'}) как готовый`,
            link: `#/pm-calculations?tender=${tenderId}`
          }).catch(() => {});
        }
      } else {
        await writeReviewLog(db, {
          reviewId: review.id, tenderId, actorUserId: userId,
          action: 'save_participant_draft', payload: { phase, status: draft.status }
        });
      }

      broadcast('tender:registry:changed', { id: parseInt(tenderId, 10) });
      return { draft: await enrichDraft(db, draft) };
    } catch (err) {
      if (err.code === 'DRAFT_CONFLICT') {
        return reply.code(409).send({
          error: 'Черновик изменён другим сохранением',
          draft: await enrichDraft(db, err.current)
        });
      }
      request.log.error({ err }, 'my-draft save failed');
      return reply.code(500).send({ error: err.message || 'Ошибка сохранения черновика' });
    }
  });

  // ── POST import draft → final ─────────────────────────────────
  fastify.post('/:id/rp-review/import-draft', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, async (request, reply) => {
    const tenderId = request.params.id;
    const userId = request.user.id;
    const access = await canTouchReview(db, tenderId, request.user);
    if (!access.ok) return reply.code(403).send({ error: 'Нет доступа' });

    let review = await ensureReview(db, tenderId, userId);
    review = await ensureAnalysisOwner(db, review, userId, access.duty?.pm_user_id, { allowActorFallback: true });
    if (review.is_final) return reply.code(409).send({ error: 'Отчёт уже закрыт' });

    const { ownerUserId, phase } = await resolveFinalOwner(db, review, access.tender, access.duty?.pm_user_id);
    const role = request.user.role || '';
    const isOwner = ownerUserId && Number(ownerUserId) === userId;
    if (!isOwner && !WIDE_WRITE_ROLES.includes(role)) {
      return reply.code(403).send({ error: 'Импортировать в финал может только хозяин фазы' });
    }

    const b = request.body || {};
    const draftId = b.draft_id;
    const includeFiles = b.include_files !== false;
    const source = await db.query(
      'SELECT * FROM tender_rp_review_participant_drafts WHERE id = $1 AND review_id = $2 AND phase = $3',
      [draftId, review.id, phase]
    );
    if (!source.rows[0]) return reply.code(404).send({ error: 'Черновик не найден' });
    const draft = source.rows[0];
    const dj = parseJson(draft.draft_json);
    const rj = parseJson(review.report_json);
    const merged = {
      ...rj,
      ...dj,
      mode: phase === 'analysis' ? 'analysis' : 'calc',
      analysis_snapshot: rj.analysis_snapshot || null
    };

    const workPrice = dj.work_price != null ? dj.work_price : review.work_price;
    await db.query(`
      UPDATE tender_rp_reviews SET
        report_json = $1::jsonb,
        work_price = COALESCE($2, work_price),
        estimate_file_id = CASE WHEN $3::boolean THEN COALESCE($4, estimate_file_id) ELSE estimate_file_id END,
        report_file_id = CASE WHEN $3::boolean THEN COALESCE($5, report_file_id) ELSE report_file_id END,
        tkp_file_id = CASE WHEN $3::boolean THEN COALESCE($6, tkp_file_id) ELSE tkp_file_id END,
        updated_at = NOW()
      WHERE id = $7
    `, [
      JSON.stringify(merged),
      workPrice,
      includeFiles,
      draft.estimate_file_id || null,
      draft.report_file_id || null,
      draft.tkp_file_id || null,
      review.id
    ]);

    await writeReviewLog(db, {
      reviewId: review.id, tenderId, actorUserId: userId,
      action: 'import_draft_to_final',
      payload: {
        draft_id: draft.id,
        author_user_id: draft.author_user_id,
        phase: draft.phase,
        include_files: includeFiles
      }
    });
    broadcast('tender:registry:changed', { id: parseInt(tenderId, 10) });
    const updated = await ensureReview(db, tenderId, userId);
    return { review: updated, imported_from: draft.author_user_id };
  });

  // ── POST start-quick for tender RP-review ─────────────────────
  fastify.post('/:id/rp-review/start-quick', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, async (request, reply) => {
    const tenderId = Number(request.params.id);
    const userId = request.user.id;
    const access = await canTouchReview(db, tenderId, request.user);
    if (!access.ok) return reply.code(403).send({ error: 'Нет доступа' });

    let review = await ensureReview(db, tenderId, userId);
    review = await ensureAnalysisOwner(db, review, userId, access.duty?.pm_user_id, { allowActorFallback: true });
    const b = request.body || {};
    const phase = b.phase === 'calc' || review.analysis_finalized_at ? 'calc' : 'analysis';
    const purpose = purposeForPhase(phase);
    const fresh = !!b.fresh;

    // В БД колонка — tender_description (V049); work_description на tenders нет → 500.
    const tRes = await db.query(
      `SELECT id, customer_inn, customer_name, tender_title, tender_description
       FROM tenders WHERE id = $1 AND deleted_at IS NULL`,
      [tenderId]
    );
    if (!tRes.rows[0]) return reply.code(404).send({ error: 'Тендер не найден' });
    const tender = tRes.rows[0];

    // Attachments list for UI (tender documents)
    const docs = await db.query(`
      SELECT id, original_name AS filename, download_url, mime_type, size, type
      FROM documents
      WHERE tender_id = $1 AND type IS DISTINCT FROM 'rp_estimate'
        AND type IS DISTINCT FROM 'rp_report' AND type IS DISTINCT FROM 'rp_tkp'
        AND COALESCE(type,'') NOT IN ('ocr-extract')
      ORDER BY created_at DESC LIMIT 40
    `, [tenderId]);

    if (!fresh) {
      try {
        const exist = await db.query(
          `SELECT id, session_uid, status FROM tkp_quick_sessions
            WHERE author_id = $1 AND tender_id = $2
              AND COALESCE(purpose, 'kanban') = $3
              AND status NOT IN ('finalized','abandoned')
            ORDER BY id DESC LIMIT 1`,
          [userId, tenderId, purpose]
        );
        if (exist.rows[0]) {
          // Link session on draft
          try {
            await upsertMyDraft(db, {
              reviewId: review.id, tenderId, authorUserId: userId, phase,
              draftJson: null, mimirSessionUid: exist.rows[0].session_uid
            });
          } catch (_) { /* ignore */ }
          return {
            success: true,
            session_uid: exist.rows[0].session_uid,
            session_id: Number(exist.rows[0].id),
            status: 'existing',
            session_status: exist.rows[0].status,
            purpose,
            phase,
            tender_attachments: docs.rows,
            customer_name: tender.customer_name,
            customer_inn: tender.customer_inn
          };
        }
      } catch (e) {
        request.log.warn({ err: e }, 'rp start-quick dedupe failed');
      }
    } else {
      try {
        await db.query(
          `UPDATE tkp_quick_sessions
              SET status = 'abandoned', updated_at = NOW()
            WHERE author_id = $1 AND tender_id = $2
              AND COALESCE(purpose, 'kanban') = $3
              AND status NOT IN ('finalized','abandoned')`,
          [userId, tenderId, purpose]
        );
      } catch (_) { /* ignore */ }
    }

    const sessionUid = crypto.randomUUID();
    const tzText = [tender.tender_title, tender.tender_description].filter(Boolean).join('\n\n') || null;
    let ins;
    try {
      ins = await db.query(
        `INSERT INTO tkp_quick_sessions
          (session_uid, author_id, customer_inn, customer_name, tender_id, tz_text, status, purpose)
         VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7)
         RETURNING id, session_uid`,
        [sessionUid, userId, tender.customer_inn, tender.customer_name, tenderId, tzText, purpose]
      );
    } catch (e) {
      // fallback without purpose column
      ins = await db.query(
        `INSERT INTO tkp_quick_sessions
          (session_uid, author_id, customer_inn, customer_name, tender_id, tz_text, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'draft')
         RETURNING id, session_uid`,
        [sessionUid, userId, tender.customer_inn, tender.customer_name, tenderId, tzText]
      );
    }

    try {
      await upsertMyDraft(db, {
        reviewId: review.id, tenderId, authorUserId: userId, phase,
        draftJson: null, mimirSessionUid: sessionUid
      });
    } catch (_) { /* ignore */ }

    return {
      success: true,
      session_uid: ins.rows[0].session_uid,
      session_id: Number(ins.rows[0].id),
      status: 'created',
      purpose,
      phase,
      tender_attachments: docs.rows,
      customer_name: tender.customer_name,
      customer_inn: tender.customer_inn
    };
  });

  // ── POST mimir-apply → draft or final ─────────────────────────
  fastify.post('/:id/rp-review/mimir-apply', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, async (request, reply) => {
    const tenderId = Number(request.params.id);
    const userId = request.user.id;
    const access = await canTouchReview(db, tenderId, request.user);
    if (!access.ok) return reply.code(403).send({ error: 'Нет доступа' });

    let review = await ensureReview(db, tenderId, userId);
    review = await ensureAnalysisOwner(db, review, userId, access.duty?.pm_user_id, { allowActorFallback: true });
    if (review.is_final) return reply.code(409).send({ error: 'Отчёт уже закрыт' });

    const b = request.body || {};
    const sessionUid = b.session_uid;
    if (!sessionUid) return reply.code(400).send({ error: 'session_uid обязателен' });

    const phase = b.phase === 'calc' || review.analysis_finalized_at ? 'calc' : 'analysis';
    const { ownerUserId } = await resolveFinalOwner(db, review, access.tender, access.duty?.pm_user_id);
    const isOwner = (ownerUserId && Number(ownerUserId) === userId) || access.isWide;
    const target = b.target === 'final' && isOwner ? 'final' : 'draft';

    const sess = await db.query(
      `SELECT * FROM tkp_quick_sessions WHERE session_uid = $1 AND author_id = $2`,
      [sessionUid, userId]
    );
    if (!sess.rows[0]) return reply.code(404).send({ error: 'Сессия не найдена' });
    const session = sess.rows[0];
    if (session.tender_id && Number(session.tender_id) !== tenderId) {
      return reply.code(400).send({ error: 'Сессия привязана к другому тендеру' });
    }

    const estimate = session.estimate_draft || {};
    const chatMsgs = Array.isArray(session.chat_messages) ? session.chat_messages : [];
    let chatMd = '';
    for (let i = chatMsgs.length - 1; i >= 0; i--) {
      const m = chatMsgs[i];
      if (m && (m.role === 'assistant' || m.role === 'ai') && (m.content || m.md || m.text)) {
        chatMd = m.content || m.md || m.text;
        break;
      }
    }
    const fieldPatch = mapMimirToReportFields(phase, estimate, chatMd);

    let estimateFile = null;
    let reportFile = null;
    try {
      const mimirTkpQuick = require('../services/mimir-tkp-quick');
      const { xlsxBuf, docxBuf } = await mimirTkpQuick.generatePreviewBuffers({
        estimate_draft: estimate,
        tender_id: tenderId,
        customer_name: session.customer_name,
        customer_inn: session.customer_inn,
        author_id: userId
      });
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      estimateFile = await saveBufferAsDoc(db, {
        tenderId, userId, buffer: xlsxBuf,
        originalName: `mimir_smeta_${stamp}.xlsx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        docType: 'rp_estimate', subdir: 'rp_estimates'
      });
      reportFile = await saveBufferAsDoc(db, {
        tenderId, userId, buffer: docxBuf,
        originalName: `mimir_report_${stamp}.docx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        docType: 'rp_report', subdir: 'rp_reports'
      });
    } catch (e) {
      request.log.warn({ err: e }, 'mimir-apply: doc generation failed — fields only');
    }

    const workPrice = fieldPatch.work_price != null ? fieldPatch.work_price : undefined;

    if (target === 'final') {
      const rj = { ...parseJson(review.report_json), ...fieldPatch, mode: phase === 'analysis' ? 'analysis' : 'calc' };
      await db.query(`
        UPDATE tender_rp_reviews SET
          report_json = $1::jsonb,
          work_price = COALESCE($2, work_price),
          estimate_file_id = COALESCE($3, estimate_file_id),
          report_file_id = COALESCE($4, report_file_id),
          updated_at = NOW()
        WHERE id = $5
      `, [
        JSON.stringify(rj),
        workPrice ?? null,
        estimateFile?.id || null,
        reportFile?.id || null,
        review.id
      ]);
    }

    const existingDraft = await getMyDraft(db, review.id, userId, phase);
    const draftJson = { ...(existingDraft ? parseJson(existingDraft.draft_json) : {}), ...fieldPatch };
    const draft = await upsertMyDraft(db, {
      reviewId: review.id,
      tenderId,
      authorUserId: userId,
      phase,
      draftJson,
      estimateFileId: estimateFile?.id,
      reportFileId: reportFile?.id,
      mimirSessionUid: sessionUid
    });

    await writeReviewLog(db, {
      reviewId: review.id, tenderId, actorUserId: userId,
      action: 'mimir_apply',
      payload: {
        phase, target, session_uid: sessionUid,
        estimate_file_id: estimateFile?.id || null,
        report_file_id: reportFile?.id || null,
        fields: Object.keys(fieldPatch)
      }
    });
    broadcast('tender:registry:changed', { id: tenderId });

    return {
      target,
      phase,
      field_patch: fieldPatch,
      work_price: workPrice ?? null,
      estimate_file: estimateFile,
      report_file: reportFile,
      draft: await enrichDraft(db, draft),
      review: target === 'final' ? (await ensureReview(db, tenderId, userId)) : undefined
    };
  });

  // Upload estimate/report/tkp onto participant draft (not final).
  // НЕ async: иначе draftFileUpload('estimate') вернёт Promise, а не handler → 500 handler.call.
  function draftFileUpload(kind) {
    return async (request, reply) => {
      const tenderId = request.params.id;
      const userId = request.user.id;
      const access = await canTouchReview(db, tenderId, request.user);
      if (!access.ok) return reply.code(403).send({ error: 'Нет доступа' });
      const review = await ensureReview(db, tenderId, userId);
      if (review.is_final) return reply.code(409).send({ error: 'Отчёт уже закрыт' });
      const phase = request.query.phase === 'calc' || review.analysis_finalized_at ? 'calc' : 'analysis';

      const data = await request.file();
      if (!data) return reply.code(400).send({ error: 'Файл обязателен' });
      const buffer = await data.toBuffer();
      const map = {
        estimate: { type: 'rp_estimate', subdir: 'rp_estimates', col: 'estimate_file_id' },
        report: { type: 'rp_report', subdir: 'rp_reports', col: 'report_file_id' },
        tkp: { type: 'rp_tkp', subdir: 'rp_tkp', col: 'tkp_file_id' }
      };
      const cfg = map[kind];
      const file = await saveBufferAsDoc(db, {
        tenderId, userId, buffer,
        originalName: data.filename || kind,
        mimeType: data.mimetype,
        docType: cfg.type,
        subdir: cfg.subdir
      });
      const patch = { [cfg.col]: file.id };
      const draft = await upsertMyDraft(db, {
        reviewId: review.id,
        tenderId: Number(tenderId),
        authorUserId: userId,
        phase,
        draftJson: null,
        estimateFileId: patch.estimate_file_id,
        reportFileId: patch.report_file_id,
        tkpFileId: patch.tkp_file_id
      });
      await writeReviewLog(db, {
        reviewId: review.id, tenderId, actorUserId: userId,
        action: `draft_attach_${kind}`, payload: { file_id: file.id, phase }
      });
      return { draft: await enrichDraft(db, draft), file };
    };
  }

  fastify.post('/:id/rp-review/my-draft/estimate', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, draftFileUpload('estimate'));
  fastify.post('/:id/rp-review/my-draft/report', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, draftFileUpload('report'));
  fastify.post('/:id/rp-review/my-draft/tkp', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, draftFileUpload('tkp'));
}

module.exports = { registerRpReviewCollabRoutes, isCollaborator, canTouchReview };
