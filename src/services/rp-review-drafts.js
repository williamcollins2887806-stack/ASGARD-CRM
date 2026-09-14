'use strict';

/**
 * Helpers for RP-review participant drafts + Mimor apply + final-owner checks.
 */

function parseJson(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch (_) { return {}; }
}

function reportMode(reportJson) {
  const rj = parseJson(reportJson);
  return rj.mode === 'analysis' ? 'analysis' : 'calc';
}

function purposeForPhase(phase) {
  return phase === 'calc' ? 'rp_review_calc' : 'rp_review_analysis';
}

/**
 * Хозяин финала текущей фазы.
 * analysis → analysis_owner_user_id || started_by || current duty
 *   (текущий дежурный дополнительно получает право финала в pm-duty PUT —
 *    иначе смена дежурства оставляет чужие черновики без хозяина в очереди)
 * calc → calculator_user_id (tender or review)
 */
async function resolveFinalOwner(db, review, tender, dutyPmUserId) {
  const phase = review.analysis_finalized_at ? 'calc' : 'analysis';
  if (phase === 'analysis') {
    const ownerId = review.analysis_owner_user_id
      || review.started_by_user_id
      || dutyPmUserId
      || null;
    return { phase, ownerUserId: ownerId ? Number(ownerId) : null };
  }
  const calcId = tender?.calculator_user_id || review.calculator_user_id || null;
  return { phase, ownerUserId: calcId ? Number(calcId) : null };
}

/**
 * При смене дежурного: открытые анализы в «рассмотрение», где хозяин не новый
 * дежурный, переводим analysis_owner на нового. Не трогаем финализированные.
 */
async function transferOpenAnalysesToDuty(db, newDutyPmUserId, { fromPmUserId = null } = {}) {
  if (!newDutyPmUserId) return { transferred: 0 };
  const params = [newDutyPmUserId];
  let ownerFilter = 'AND rev.analysis_owner_user_id IS DISTINCT FROM $1';
  if (fromPmUserId) {
    params.push(fromPmUserId);
    ownerFilter = 'AND rev.analysis_owner_user_id = $2';
  }
  const r = await db.query(`
    UPDATE tender_rp_reviews rev
       SET analysis_owner_user_id = $1,
           updated_at = NOW()
      FROM tenders t
     WHERE t.id = rev.tender_id
       AND t.deleted_at IS NULL
       AND t.registry_status = 'рассмотрение'
       AND rev.analysis_finalized_at IS NULL
       AND (rev.is_final IS NULL OR rev.is_final = false)
       AND COALESCE(t.calculator_kind, '') <> 'to'
       ${ownerFilter}
     RETURNING rev.tender_id, rev.id
  `, params);
  return { transferred: r.rowCount || 0, tender_ids: r.rows.map((x) => x.tender_id) };
}

/**
 * Терминальный статус реестра/архива → закрыть висящий анализ, чтобы не копился
 * «открытый черновик» у бывших дежурных.
 */
async function finalizeOpenAnalysisOnTerminal(db, tenderId, actorUserId, reason) {
  if (!tenderId) return { closed: false };
  const reportPatch = {
    auto_closed: true,
    auto_closed_reason: reason || 'terminal_status'
  };
  const r = await db.query(`
    UPDATE tender_rp_reviews
       SET analysis_finalized_at = COALESCE(analysis_finalized_at, NOW()),
           analysis_finalized_by_user_id = COALESCE(analysis_finalized_by_user_id, $2),
           decision = CASE
             WHEN decision IS NULL OR decision = 'pending' THEN 'reject'
             ELSE decision
           END,
           report_kind = CASE
             WHEN decision IS NULL OR decision IN ('pending', 'reject') THEN 'reject'
             ELSE COALESCE(report_kind, 'work')
           END,
           report_json = COALESCE(report_json, '{}'::jsonb) || $3::jsonb,
           updated_at = NOW()
     WHERE tender_id = $1
       AND analysis_finalized_at IS NULL
     RETURNING tender_id, decision
  `, [tenderId, actorUserId || null, JSON.stringify(reportPatch)]);
  return { closed: !!r.rows[0], row: r.rows[0] || null };
}

async function ensureAnalysisOwner(db, review, actorUserId, dutyPmUserId, { allowActorFallback = false } = {}) {
  if (review.analysis_owner_user_id) return review;
  // Не отдаём ownership случайному зрителю GET — только started_by / текущий дежурный,
  // либо actor при явной записи (PUT/start), если allowActorFallback.
  const owner = review.started_by_user_id
    || dutyPmUserId
    || (allowActorFallback ? actorUserId : null)
    || null;
  if (!owner) return review;
  const r = await db.query(`
    UPDATE tender_rp_reviews
    SET analysis_owner_user_id = COALESCE(analysis_owner_user_id, $1),
        started_by_user_id = COALESCE(started_by_user_id, $1)
    WHERE id = $2
      AND analysis_owner_user_id IS NULL
    RETURNING *
  `, [owner, review.id]);
  return r.rows[0] || review;
}

async function upsertMyDraft(db, {
  reviewId, tenderId, authorUserId, phase, draftJson, status,
  estimateFileId, reportFileId, tkpFileId, mimirSessionUid, expectedUpdatedAt
}) {
  const existing = await db.query(`
    SELECT * FROM tender_rp_review_participant_drafts
    WHERE review_id = $1 AND author_user_id = $2 AND phase = $3
  `, [reviewId, authorUserId, phase]);

  if (existing.rows[0] && expectedUpdatedAt) {
    const cur = new Date(existing.rows[0].updated_at).toISOString();
    const exp = new Date(expectedUpdatedAt).toISOString();
    if (cur !== exp) {
      const err = new Error('draft_conflict');
      err.code = 'DRAFT_CONFLICT';
      err.current = existing.rows[0];
      throw err;
    }
  }

  // null draftJson = не трогать существующий JSON (важно для start-quick / file upload).
  // {} на INSERT — пустой черновик; на UPDATE пустой объект НЕ затирает поля.
  const hasDraftPatch = draftJson != null;
  const draftParam = hasDraftPatch ? JSON.stringify(draftJson) : null;
  const emptyPatch = hasDraftPatch && typeof draftJson === 'object'
    && !Array.isArray(draftJson) && Object.keys(draftJson).length === 0;

  const r = await db.query(`
    INSERT INTO tender_rp_review_participant_drafts
      (review_id, tender_id, author_user_id, phase, draft_json, status,
       estimate_file_id, report_file_id, tkp_file_id, mimir_session_uid, updated_at)
    VALUES ($1, $2, $3, $4, COALESCE($5::jsonb, '{}'::jsonb), COALESCE($6, 'working'),
            $7, $8, $9, $10, NOW())
    ON CONFLICT (review_id, author_user_id, phase) DO UPDATE SET
      draft_json = CASE
        WHEN $5::jsonb IS NULL THEN tender_rp_review_participant_drafts.draft_json
        WHEN $11::boolean THEN tender_rp_review_participant_drafts.draft_json
        ELSE $5::jsonb
      END,
      status = COALESCE($6, tender_rp_review_participant_drafts.status),
      estimate_file_id = COALESCE($7, tender_rp_review_participant_drafts.estimate_file_id),
      report_file_id = COALESCE($8, tender_rp_review_participant_drafts.report_file_id),
      tkp_file_id = COALESCE($9, tender_rp_review_participant_drafts.tkp_file_id),
      mimir_session_uid = COALESCE($10, tender_rp_review_participant_drafts.mimir_session_uid),
      updated_at = NOW()
    RETURNING *
  `, [
    reviewId, tenderId, authorUserId, phase,
    draftParam,
    status || null,
    estimateFileId ?? null,
    reportFileId ?? null,
    tkpFileId ?? null,
    mimirSessionUid || null,
    !!emptyPatch
  ]);
  return r.rows[0];
}

async function getMyDraft(db, reviewId, authorUserId, phase) {
  const r = await db.query(`
    SELECT d.*, u.name AS author_name
    FROM tender_rp_review_participant_drafts d
    JOIN users u ON u.id = d.author_user_id
    WHERE d.review_id = $1 AND d.author_user_id = $2 AND d.phase = $3
  `, [reviewId, authorUserId, phase]);
  return r.rows[0] || null;
}

async function listTeamDrafts(db, reviewId, phase, { excludeAuthorId } = {}) {
  const r = await db.query(`
    SELECT d.*, u.name AS author_name
    FROM tender_rp_review_participant_drafts d
    JOIN users u ON u.id = d.author_user_id
    WHERE d.review_id = $1 AND d.phase = $2
      AND ($3::int IS NULL OR d.author_user_id != $3)
    ORDER BY
      CASE WHEN d.status = 'ready' THEN 0 ELSE 1 END,
      d.updated_at DESC
  `, [reviewId, phase, excludeAuthorId || null]);
  return r.rows;
}

async function loadDocMeta(db, fileId) {
  if (!fileId) return null;
  const r = await db.query(
    'SELECT id, original_name, download_url, size, mime_type, created_at FROM documents WHERE id = $1',
    [fileId]
  );
  return r.rows[0] || null;
}

async function enrichDraft(db, draft) {
  if (!draft) return null;
  const [estimate_file, report_file, tkp_file] = await Promise.all([
    loadDocMeta(db, draft.estimate_file_id),
    loadDocMeta(db, draft.report_file_id),
    loadDocMeta(db, draft.tkp_file_id)
  ]);
  return {
    ...draft,
    draft_json: parseJson(draft.draft_json),
    estimate_file,
    report_file,
    tkp_file
  };
}

/** Best-effort field mapping from Mimor estimate + chat markdown into report fields. */
function mapMimirToReportFields(phase, estimate, chatMd) {
  const patch = {};
  const totals = estimate || {};
  const withVat = totals.total_with_vat != null ? Number(totals.total_with_vat)
    : (totals.totals && totals.totals.total_with_vat != null ? Number(totals.totals.total_with_vat) : null);
  const noVat = totals.total_without_vat != null ? Number(totals.total_without_vat)
    : (totals.totals && totals.totals.total_without_vat != null ? Number(totals.totals.total_without_vat) : null);
  const cost = Array.isArray(totals.items)
    ? totals.items.reduce((s, it) => {
        const q = Number(it.qty || it.quantity || 0);
        const p = Number(it.price || it.unit_price || 0);
        return s + (Number.isFinite(q * p) ? q * p : 0);
      }, 0)
    : null;

  if (phase === 'analysis') {
    if (Number.isFinite(noVat) && noVat > 0) {
      patch.price_range_min = Math.round(noVat * 0.9);
      patch.price_range_max = Math.round(noVat * 1.1);
    } else if (Number.isFinite(withVat) && withVat > 0) {
      const ex = Math.round(withVat / 1.22);
      patch.price_range_min = Math.round(ex * 0.9);
      patch.price_range_max = Math.round(ex * 1.1);
    }
  } else {
    if (Number.isFinite(withVat) && withVat > 0) patch.work_price = Math.round(withVat);
    if (Number.isFinite(cost) && cost > 0) patch.cost_without_vat = Math.round(cost);
    else if (Number.isFinite(noVat) && noVat > 0) patch.cost_without_vat = Math.round(noVat);
  }

  const md = String(chatMd || '').trim();
  if (md) {
    const plain = md.replace(/\*\*/g, '').replace(/^#+\s*/gm, '').trim();
    // First substantial paragraph → summary if empty
    const paras = plain.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    if (paras[0] && paras[0].length > 20) {
      patch.summary = paras[0].slice(0, 2000);
    }
    const riskMatch = plain.match(/(?:риски?|risks?)[:\s]+([^\n]{5,400})/i);
    if (riskMatch) patch.risks = riskMatch[1].trim().slice(0, 1500);
    const recMatch = plain.match(/(?:рекомендация|recommendation)[:\s]+([^\n]{5,400})/i);
    if (recMatch) patch.recommendation = recMatch[1].trim().slice(0, 1500);
  }
  return patch;
}

module.exports = {
  parseJson,
  reportMode,
  purposeForPhase,
  resolveFinalOwner,
  ensureAnalysisOwner,
  transferOpenAnalysesToDuty,
  finalizeOpenAnalysisOnTerminal,
  upsertMyDraft,
  getMyDraft,
  listTeamDrafts,
  enrichDraft,
  loadDocMeta,
  mapMimirToReportFields
};
