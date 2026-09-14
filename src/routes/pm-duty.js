/**
 * PM Duty routes — дежурства РП, очередь, отчёты, коллабораторы
 */
const path = require('path');
const fs = require('fs').promises;
const {
  getCurrentDuty,
  ensureReview,
  writeReviewLog,
  writeRegistryAudit,
  syncTenderStatus,
  applyRegistryStatus,
  buildRegistryExclusionClause
} = require('../services/tender-registry-helpers');
const { createNotification } = require('../services/notify');
const { notifyToOnReviewReady, notifyDirectorsOnReviewPending, notifyToOnDirectorPending, notifyOnDirectorDecision } = require('../services/rp-review-notify');
const { notifyOnThreadMessage } = require('../services/rp-review-thread-notify');
const { broadcast } = require('./sse');
const {
  resolveFinalOwner,
  ensureAnalysisOwner,
  transferOpenAnalysesToDuty,
  getMyDraft,
  listTeamDrafts,
  enrichDraft
} = require('../services/rp-review-drafts');
const { registerRpReviewCollabRoutes } = require('./rp-review-collab');

const PM_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const TO_DECISION_ROLES = ['ADMIN', 'TO', 'HEAD_TO'];
const DIRECTOR_DECISION_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const ASSIGN_ROLES = ['ADMIN', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const DEFAULT_DIRECTOR_THRESHOLD = 10_000_000;
const VAT_DIVISOR = 1.22;

async function getDirectorThreshold(db) {
  try {
    const r = await db.query(`SELECT value_json FROM settings WHERE key = 'director_tender_threshold_rub'`);
    const raw = r.rows[0]?.value_json;
    if (raw != null && raw !== '') {
      const v = typeof raw === 'number' ? raw : Number(String(raw).replace(/"/g, ''));
      if (Number.isFinite(v) && v > 0) return v;
    }
  } catch (_) { /* settings may be missing */ }
  return DEFAULT_DIRECTOR_THRESHOLD;
}

function computeWorkPriceExVat(workPrice) {
  const n = Number(workPrice);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round((n / VAT_DIVISOR) * 100) / 100;
}

function needsDirectorApproval(workPriceExVat, threshold) {
  return workPriceExVat != null && workPriceExVat >= threshold;
}

// Получатели адресного согласования: ровно 4 допустимых кода.
const APPROVAL_RECIPIENT_CODES = ['DIRECTOR_GEN', 'DIRECTOR_DEV', 'DIRECTOR_COMM', 'HEAD_TO'];

function normalizeApprovalRecipients(raw) {
  if (!Array.isArray(raw)) return null;
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const code = String(item || '').trim().toUpperCase();
    if (!APPROVAL_RECIPIENT_CODES.includes(code) || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out.length ? out : null;
}

function threadOpenDuringDirectorReview(directorReviewStatus) {
  return ['pending', 'approved'].includes(directorReviewStatus || '');
}

function parseReportJson(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch (_) { return {}; }
}

function reportMode(reportJson) {
  const rj = parseReportJson(reportJson);
  return rj.mode === 'analysis' ? 'analysis' : 'calc';
}

function buildAnalysisSnapshot(rj, decision, userId, userName) {
  const at = new Date().toISOString();
  return {
    decision: decision || rj.decision || 'submit',
    feasibility: rj.feasibility || '',
    competition: rj.competition || '',
    price_range_min: rj.price_range_min ?? null,
    price_range_max: rj.price_range_max ?? null,
    summary: rj.summary || '',
    risks: rj.risks || '',
    recommendation: rj.recommendation || '',
    missing_info: Array.isArray(rj.missing_info) ? rj.missing_info : [],
    reject_preset: rj.reject_preset || '',
    points: rj.points || [],
    finalized_at: at,
    finalized_by_user_id: userId,
    finalized_by_name: userName || ''
  };
}

function enrichReviewRow(review, userMap) {
  if (!review) return review;
  const rj = parseReportJson(review.report_json);
  const out = { ...review };
  if (review.started_by_user_id && userMap) {
    out.started_by_name = userMap[review.started_by_user_id] || out.started_by_name;
  }
  if (review.analysis_finalized_by_user_id && userMap) {
    out.analysis_finalized_by_name = userMap[review.analysis_finalized_by_user_id];
  }
  if (review.finalized_by_user_id && userMap) {
    out.finalized_by_name = userMap[review.finalized_by_user_id];
  }
  out.analysis_snapshot = rj.analysis_snapshot || null;
  return out;
}

function fmtRuDate(v) {
  if (!v) return '—';
  const s = String(v).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
}

async function isDutyPm(db, userId) {
  const duty = await getCurrentDuty(db);
  return duty && duty.pm_user_id === userId;
}

async function isCollaborator(db, tenderId, userId) {
  const r = await db.query(`
    SELECT 1 FROM tender_rp_review_collaborators c
    JOIN tender_rp_reviews r ON r.id = c.review_id
    WHERE c.tender_id = $1 AND c.pm_user_id = $2 AND c.revoked_at IS NULL
  `, [tenderId, userId]);
  return r.rows.length > 0;
}

/** Участник ревью: owner / starter / calculator / collab / писал в лог. */
async function isReviewParticipant(db, tenderId, userId) {
  const r = await db.query(`
    SELECT 1
    FROM tender_rp_reviews rev
    JOIN tenders t ON t.id = rev.tender_id
    WHERE rev.tender_id = $1
      AND (
        rev.analysis_owner_user_id = $2
        OR rev.started_by_user_id = $2
        OR rev.calculator_user_id = $2
        OR t.calculator_user_id = $2
        OR EXISTS (
          SELECT 1 FROM tender_rp_review_collaborators c
          WHERE c.review_id = rev.id AND c.pm_user_id = $2 AND c.revoked_at IS NULL
        )
        OR EXISTS (
          SELECT 1 FROM tender_rp_review_log l
          WHERE l.review_id = rev.id AND l.actor_user_id = $2
        )
      )
    LIMIT 1
  `, [tenderId, userId]);
  return r.rows.length > 0;
}

/** SQL: пользователь участвовал в ревью (rev + t уже в FROM). $param — userId. */
function participatedSql(param = '$1') {
  return `(
    rev.analysis_owner_user_id = ${param}
    OR rev.started_by_user_id = ${param}
    OR rev.calculator_user_id = ${param}
    OR t.calculator_user_id = ${param}
    OR EXISTS (
      SELECT 1 FROM tender_rp_review_collaborators c
      WHERE c.review_id = rev.id AND c.pm_user_id = ${param} AND c.revoked_at IS NULL
    )
    OR EXISTS (
      SELECT 1 FROM tender_rp_review_log l
      WHERE l.review_id = rev.id AND l.actor_user_id = ${param}
    )
  )`;
}

/**
 * Доступ к загрузке финальных файлов (смета/отчёт/ТКП).
 * Пока анализ открыт — дежурный + участник; после — хозяин фазы / calc.
 */
function assertFinalFileUploadAccess({
  review, isDuty, isParticipant, collab, isCalc, isWide, isFinalOwner
}) {
  if (review.is_final) {
    return { ok: false, code: 409, body: { error: 'Отчёт уже закрыт' } };
  }
  const analysisOpen = !review.analysis_finalized_at;
  if (analysisOpen) {
    if (isDuty || isParticipant || collab || isCalc || isWide) {
      return { ok: true };
    }
    return { ok: false, code: 403, body: { error: 'Нет доступа к загрузке файла' } };
  }
  if (!isFinalOwner) {
    return {
      ok: false,
      code: 403,
      body: {
        error: 'Файлы финала может грузить только хозяин фазы. Используйте загрузку в личный черновик.',
        use_my_draft: true
      }
    };
  }
  if (!isDuty && !collab && !isCalc && !isWide) {
    return { ok: false, code: 403, body: { error: 'Нет доступа к загрузке файла' } };
  }
  return { ok: true };
}

/** РП/дежурный при работе с отчётом становится считающим (кроме ТО «считаю сам»).
 *  Просчёт всегда закрепляется за ДЕЖУРНЫМ РП, а не за тем, кто открыл форму. */
async function syncCalculatorActor(db, tenderId, userId, userRole, tenderRow, { isDuty }) {
  if (!tenderRow) return;
  const isPmActor = isDuty || ['PM', 'HEAD_PM', 'ADMIN'].includes(userRole);
  const isToSelf = tenderRow.calculator_kind === 'to'
    && Number(tenderRow.calculator_user_id) === userId
    && ['TO', 'HEAD_TO'].includes(userRole);
  if (!isPmActor || isToSelf) return;
  // Дежурный РП — владелец просчёта; если дежурный не назначен, остаётся актор.
  const duty = await getCurrentDuty(db);
  const ownerId = (duty && duty.pm_user_id) ? Number(duty.pm_user_id) : userId;
  await db.query(`
    UPDATE tenders SET calculator_user_id = $1, calculator_kind = 'pm', updated_at = NOW() WHERE id = $2
  `, [ownerId, tenderId]);
  await db.query(`
    UPDATE tender_rp_reviews SET calculator_user_id = $1, updated_at = NOW() WHERE tender_id = $2
  `, [ownerId, tenderId]);
}

async function canAccessReviewThread(db, tenderId, user) {
  const userId = user.id;
  const role = user.role || '';
  // Чат отчёта: все ТО и все РП видят и отвечают (подмена при болезни и т.п.).
  // Письмо на почту — только создателю тендера (см. rp-review-thread-notify).
  if (['ADMIN', 'TO', 'HEAD_TO', 'PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(role)) {
    return true;
  }
  const tRes = await db.query(
    'SELECT created_by, calculator_user_id FROM tenders WHERE id = $1 AND deleted_at IS NULL',
    [tenderId]
  );
  if (!tRes.rows[0]) return false;
  const tender = tRes.rows[0];
  if (Number(tender.created_by) === userId) return true;
  if (Number(tender.calculator_user_id) === userId) return true;
  if (await isCollaborator(db, tenderId, userId)) return true;
  if (await isDutyPm(db, userId)) return true;
  if (await isReviewParticipant(db, tenderId, userId)) return true;
  return false;
}

async function loadThreadUnreadCount(db, tenderId, userId) {
  // Schema-drift safe: V283 tables may be missing on local clones.
  try {
    const seen = await db.query(
      'SELECT last_seen_at FROM tender_rp_review_thread_seen WHERE user_id = $1 AND tender_id = $2',
      [userId, tenderId]
    );
    const seenAt = seen.rows[0]?.last_seen_at;
    const r = await db.query(`
      SELECT COUNT(*)::int AS c FROM tender_rp_review_messages m
      WHERE m.tender_id = $1 AND m.deleted_at IS NULL AND m.user_id != $2
        AND ($3::timestamptz IS NULL OR m.created_at > $3)
    `, [tenderId, userId, seenAt || null]);
    return r.rows[0]?.c || 0;
  } catch (_) {
    return 0;
  }
}

async function markThreadSeen(db, tenderId, userId, lastMessageId) {
  await db.query(`
    INSERT INTO tender_rp_review_thread_seen (user_id, tender_id, last_seen_at, last_seen_message_id)
    VALUES ($1, $2, NOW(), $3)
    ON CONFLICT (user_id, tender_id) DO UPDATE SET
      last_seen_at = NOW(),
      last_seen_message_id = COALESCE($3, tender_rp_review_thread_seen.last_seen_message_id)
  `, [userId, tenderId, lastMessageId || null]);
}

function escPreviewHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resolveThreadDocPath(uploadRoot, doc) {
  const du = String(doc.download_url || '').trim();
  if (du.startsWith('/uploads/')) {
    return path.join(uploadRoot, du.replace(/^\/uploads\//, ''));
  }
  if (du.startsWith('uploads/')) {
    return path.join(uploadRoot, du.replace(/^uploads\//, ''));
  }
  return path.join(uploadRoot, doc.filename);
}

async function loadThreadDocument(db, tenderId, docId) {
  // Чат-вложения + смета/отчёт/ТКП просчёта РП (для предпросмотра директору и РП)
  const r = await db.query(`
    SELECT d.* FROM documents d
    WHERE d.id = $1 AND d.tender_id = $2
      AND (
        d.type IN ('rp_estimate', 'rp_report', 'rp_tkp', 'rp_thread')
        OR EXISTS (
          SELECT 1
          FROM tender_rp_review_message_files mf
          JOIN tender_rp_review_messages m ON m.id = mf.message_id
          WHERE mf.document_id = d.id AND m.tender_id = $2
        )
        OR EXISTS (
          SELECT 1 FROM tender_rp_reviews r
          WHERE r.tender_id = $2
            AND d.id IN (r.estimate_file_id, r.report_file_id, r.tkp_file_id)
        )
      )
  `, [docId, tenderId]);
  return r.rows[0] || null;
}

function wrapPreviewHtml(title, bodyHtml) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escPreviewHtml(title)}</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;padding:16px 20px;line-height:1.55;color:#1a1a1a;background:#fff;max-width:980px;margin:0 auto}
h2{font-size:16px;margin:0 0 14px;font-weight:700}
table{border-collapse:collapse;width:100%;margin:8px 0;font-size:13px}
td,th{border:1px solid #d1d5db;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#f3f4f6}
pre{white-space:pre-wrap;word-break:break-word;font-size:13px;background:#f9fafb;padding:12px;border-radius:8px;border:1px solid #e5e7eb}
img{max-width:100%;height:auto}
p{margin:0 0 8px}
</style></head><body><h2>${escPreviewHtml(title)}</h2>${bodyHtml}</body></html>`;
}

async function buildThreadFilePreviewHtml(buffer, mime, originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  const m = String(mime || '').toLowerCase();

  if (m.includes('word') || ext === '.docx' || ext === '.doc') {
    const mammoth = require('mammoth');
    const result = await mammoth.convertToHtml({ buffer });
    return wrapPreviewHtml(originalName, result.value || '<p>Документ пуст</p>');
  }

  if (ext === '.csv' || m === 'text/csv') {
    const text = buffer.toString('utf8');
    return wrapPreviewHtml(originalName, `<pre>${escPreviewHtml(text)}</pre>`);
  }

  if (m.includes('sheet') || m.includes('excel') || ext === '.xlsx' || ext === '.xls') {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    if (!wb.worksheets.length) return wrapPreviewHtml(originalName, '<p>Книга пуста</p>');
    let html = '';
    for (const ws of wb.worksheets) {
      html += `<h3 style="margin:16px 0 8px;font-size:14px">${escPreviewHtml(ws.name || 'Лист')}</h3>`;
      let table = '<table><tbody>';
      const maxRows = Math.min(ws.rowCount || 0, 200);
      for (let ri = 1; ri <= maxRows; ri++) {
        const row = ws.getRow(ri);
        table += '<tr>';
        const maxCols = Math.min(Math.max(row.cellCount || 0, ws.columnCount || 0), 30);
        for (let ci = 1; ci <= maxCols; ci++) {
          const cell = row.getCell(ci);
          const val = cell.text != null ? String(cell.text) : '';
          table += `<td>${escPreviewHtml(val)}</td>`;
        }
        table += '</tr>';
      }
      table += '</tbody></table>';
      if ((ws.rowCount || 0) > maxRows) {
        table += `<p style="color:#6b7280;font-size:12px">Показаны первые ${maxRows} строк</p>`;
      }
      html += table;
    }
    return wrapPreviewHtml(originalName, html);
  }

  if (m.startsWith('text/') || ext === '.txt' || ext === '.md') {
    return wrapPreviewHtml(originalName, `<pre>${escPreviewHtml(buffer.toString('utf8'))}</pre>`);
  }

  return null;
}

function threadFilePreviewUrl(tenderId, docId) {
  return `/api/tenders/${tenderId}/rp-review/files/${docId}/preview`;
}

function enrichThreadFiles(tenderId, files) {
  return (files || []).map((f) => ({
    ...f,
    preview_url: f.id ? threadFilePreviewUrl(tenderId, f.id) : null
  }));
}

async function routes(fastify) {
  const db = fastify.db;

  // GET /current
  fastify.get('/current', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, async () => {
    const duty = await getCurrentDuty(db);
    return { duty, is_duty: duty ? undefined : false };
  });

  // GET /roster
  fastify.get('/roster', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, async (request) => {
    const limit = Math.min(parseInt(request.query.limit || '50', 10), 200);
    const r = await db.query(`
      SELECT r.*, u.name AS pm_name, ab.name AS assigned_by_name
      FROM pm_duty_roster r
      JOIN users u ON u.id = r.pm_user_id
      JOIN users ab ON ab.id = r.assigned_by_user_id
      ORDER BY r.period_start DESC
      LIMIT $1
    `, [limit]);
    return { items: r.rows };
  });

  // POST /roster
  fastify.post('/roster', {
    preHandler: [fastify.requireRoles(ASSIGN_ROLES)]
  }, async (request, reply) => {
    const { pm_user_id, period_start, period_end } = request.body || {};
    if (!pm_user_id || !period_start || !period_end) {
      return reply.code(400).send({ error: 'pm_user_id, period_start, period_end обязательны' });
    }
    if (period_end < period_start) {
      return reply.code(400).send({ error: 'period_end должен быть >= period_start' });
    }
    const overlap = await db.query(`
      SELECT id FROM pm_duty_roster
      WHERE period_start <= $2::date AND period_end >= $1::date
    `, [period_start, period_end]);
    if (overlap.rows.length) {
      return reply.code(409).send({ error: 'Период пересекается с существующим дежурством' });
    }
    const r = await db.query(`
      INSERT INTO pm_duty_roster (pm_user_id, period_start, period_end, assigned_by_user_id)
      VALUES ($1, $2, $3, $4) RETURNING *
    `, [pm_user_id, period_start, period_end, request.user.id]);
    let handoff = { transferred: 0 };
    try {
      // Если период уже активен (или начинается сегодня) — передать открытые анализы.
      const today = new Date().toISOString().slice(0, 10);
      if (String(period_start).slice(0, 10) <= today && String(period_end).slice(0, 10) >= today) {
        handoff = await transferOpenAnalysesToDuty(db, Number(pm_user_id));
      }
    } catch (e) {
      request.log.warn({ err: e }, 'duty handoff transfer failed');
    }
    return { roster: r.rows[0], analysis_handoff: handoff };
  });

  // PUT /roster/:id
  fastify.put('/roster/:id', {
    preHandler: [fastify.requireRoles(ASSIGN_ROLES)]
  }, async (request, reply) => {
    const { pm_user_id, period_start, period_end } = request.body || {};
    const existing = await db.query('SELECT * FROM pm_duty_roster WHERE id = $1', [request.params.id]);
    if (!existing.rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    const cur = existing.rows[0];
    const nextStart = period_start || cur.period_start;
    const nextEnd = period_end || cur.period_end;
    if (nextEnd < nextStart) {
      return reply.code(400).send({ error: 'period_end должен быть >= period_start' });
    }
    const overlap = await db.query(`
      SELECT id FROM pm_duty_roster
      WHERE id <> $3 AND period_start <= $2::date AND period_end >= $1::date
    `, [nextStart, nextEnd, request.params.id]);
    if (overlap.rows.length) {
      return reply.code(409).send({ error: 'Период пересекается с существующим дежурством' });
    }
    const r = await db.query(`
      UPDATE pm_duty_roster SET
        pm_user_id = COALESCE($1, pm_user_id),
        period_start = COALESCE($2, period_start),
        period_end = COALESCE($3, period_end)
      WHERE id = $4 RETURNING *
    `, [pm_user_id, period_start, period_end, request.params.id]);
    const roster = r.rows[0];
    let handoff = { transferred: 0 };
    try {
      const today = new Date().toISOString().slice(0, 10);
      const ps = String(roster.period_start).slice(0, 10);
      const pe = String(roster.period_end).slice(0, 10);
      if (ps <= today && pe >= today) {
        // Все открытые «рассмотрение» с чужим analysis_owner → новому дежурному
        handoff = await transferOpenAnalysesToDuty(db, Number(roster.pm_user_id));
      }
    } catch (e) {
      request.log.warn({ err: e }, 'duty handoff transfer failed');
    }
    return { roster, analysis_handoff: handoff };
  });

  // DELETE /roster/:id
  fastify.delete('/roster/:id', {
    preHandler: [fastify.requireRoles(ASSIGN_ROLES)]
  }, async (request, reply) => {
    const r = await db.query('DELETE FROM pm_duty_roster WHERE id = $1 RETURNING id', [request.params.id]);
    if (!r.rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    return { ok: true };
  });

  // GET /queue?tab=analysis|calc|mine|archive (calc = просчёты + черновики)
  fastify.get('/queue', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, async (request) => {
    let tab = request.query.tab || 'analysis';
    if (tab === 'need_report') tab = 'analysis';
    if (tab === 'my_reviewed') tab = 'archive';
    if (tab === 'drafts') tab = 'calc';
    const userId = request.user.id;
    const duty = await getCurrentDuty(db);
    const isDuty = duty && duty.pm_user_id === userId;

    const baseSelect = `
      SELECT t.*, rev.decision, rev.is_final, rev.id AS review_id, rev.updated_at AS review_updated_at,
             rev.analysis_finalized_at, rev.analysis_owner_user_id,
             calc.name AS calculator_user_name, cb.name AS created_by_name,
             starter.name AS started_by_name,
             owneru.name AS analysis_owner_name,
             CASE WHEN rev.analysis_finalized_at IS NULL THEN 'analysis' ELSE 'calc' END AS phase,
             CASE
               WHEN rev.started_by_user_id IS NOT NULL AND rev.calculator_user_id IS NOT NULL
                 AND rev.started_by_user_id != rev.calculator_user_id THEN 'Назначил ТО'
               WHEN t.calculator_kind = 'to' THEN 'ТО считает сам'
               WHEN t.calculator_user_id IS NOT NULL AND cb.name IS NOT NULL THEN 'Назначил ТО'
               WHEN t.registry_status = 'рассмотрение' THEN 'Дежурная очередь'
               ELSE '—'
             END AS queue_source
      FROM tenders t
      LEFT JOIN tender_rp_reviews rev ON rev.tender_id = t.id
      LEFT JOIN users calc ON calc.id = COALESCE(rev.calculator_user_id, t.calculator_user_id)
      LEFT JOIN users cb ON cb.id = t.created_by
      LEFT JOIN users starter ON starter.id = rev.started_by_user_id
      LEFT JOIN users owneru ON owneru.id = rev.analysis_owner_user_id
    `;

    const excludeClause = buildRegistryExclusionClause('t', 'cb');

    if (tab === 'archive') {
      const r = await db.query(`
        ${baseSelect}
        WHERE t.deleted_at IS NULL AND rev.is_final = true
          AND (
            rev.started_by_user_id = $1 OR rev.finalized_by_user_id = $1
            OR rev.calculator_user_id = $1 OR t.calculator_user_id = $1
            OR EXISTS (
              SELECT 1 FROM tender_rp_review_log l
              WHERE l.review_id = rev.id AND l.actor_user_id = $1
            )
          )
          ${excludeClause}
        ORDER BY rev.updated_at DESC
        LIMIT 300
      `, [userId]);
      return { items: r.rows, tab, duty, is_duty: isDuty };
    }

    // Cancelled / lost tenders must leave RP working queues (calc + collab analysis).
    const notArchivedStatuses = `AND t.registry_status IS DISTINCT FROM 'отмена'
          AND t.registry_status IS DISTINCT FROM 'проиграли'`;

    if (tab === 'mine') {
      const r = await db.query(`
        ${baseSelect}
        WHERE t.deleted_at IS NULL
          AND rev.id IS NOT NULL
          AND (rev.is_final IS NULL OR rev.is_final = false)
          AND ${participatedSql('$1')}
          ${notArchivedStatuses}
          ${excludeClause}
        ORDER BY rev.updated_at DESC NULLS LAST, t.created_at DESC
        LIMIT 300
      `, [userId]);
      const items = r.rows.map((row) => ({
        ...row,
        // Участник списка «Мои»: править общий отчёт, пока анализ не закрыт
        can_edit: !row.analysis_finalized_at
      }));
      return { items, tab, duty, is_duty: isDuty };
    }

    if (tab === 'calc') {
      const r = await db.query(`
        ${baseSelect}
        WHERE t.deleted_at IS NULL
          AND (rev.is_final IS NULL OR rev.is_final = false)
          AND rev.analysis_finalized_at IS NOT NULL
          AND (
            t.calculator_user_id = $1
            OR EXISTS (
              SELECT 1 FROM tender_rp_review_collaborators c
              WHERE c.review_id = rev.id AND c.pm_user_id = $1 AND c.revoked_at IS NULL
            )
          )
          ${notArchivedStatuses}
          ${excludeClause}
        ORDER BY
          CASE WHEN rev.id IS NOT NULL AND rev.is_final IS NOT TRUE THEN 0 ELSE 1 END,
          t.docs_deadline ASC NULLS LAST,
          rev.updated_at DESC NULLS LAST,
          t.created_at ASC
        LIMIT 300
      `, [userId]);
      return { items: r.rows, tab, duty, is_duty: isDuty };
    }

    // analysis — очередь дежурного / коллабораторов / preview для остальных
    const analysisOnlyClause = `AND COALESCE(t.calculator_kind, '') != 'to'`;
    const userRole = request.user.role || '';
    const oversight = ASSIGN_ROLES.includes(userRole) || userRole === 'HEAD_PM' || userRole === 'ADMIN';
    let items = [];
    let queueMode = 'duty'; // duty | collab | preview | oversight

    const analysisQueueSql = `
      ${baseSelect}
      WHERE t.deleted_at IS NULL
        AND t.registry_status = 'рассмотрение'
        AND (rev.is_final IS NULL OR rev.is_final = false)
        AND rev.analysis_finalized_at IS NULL
        ${analysisOnlyClause}
        ${excludeClause}
      ORDER BY t.docs_deadline ASC NULLS LAST, t.created_at ASC
      LIMIT 500
    `;

    if (isDuty) {
      const r = await db.query(analysisQueueSql);
      items = r.rows.map((row) => ({ ...row, can_report: true, queue_mode: 'duty' }));
      queueMode = 'duty';
    } else if (oversight) {
      const r = await db.query(analysisQueueSql);
      items = r.rows.map((row) => ({
        ...row,
        can_report: true,
        queue_mode: 'oversight',
        queue_source: row.queue_source || 'Дежурная очередь'
      }));
      queueMode = 'oversight';
    } else {
      const collab = await db.query(`
        ${baseSelect}
        JOIN tender_rp_review_collaborators c ON c.review_id = rev.id AND c.revoked_at IS NULL
        WHERE t.deleted_at IS NULL AND c.pm_user_id = $1
          AND (rev.is_final IS NULL OR rev.is_final = false)
          AND rev.analysis_finalized_at IS NULL
          ${notArchivedStatuses}
          ${analysisOnlyClause}
          ${excludeClause}
        ORDER BY t.docs_deadline ASC NULLS LAST, t.created_at ASC
      `, [userId]);
      const collabIds = new Set(collab.rows.map((x) => x.id));

      // Live preview of duty queue so page is never "blind empty"
      const preview = await db.query(analysisQueueSql);
      const byId = new Map();
      preview.rows.forEach((row) => {
        byId.set(row.id, {
          ...row,
          can_report: false,
          queue_mode: 'preview',
          preview: true
        });
      });
      collab.rows.forEach((row) => {
        byId.set(row.id, {
          ...row,
          can_report: true,
          queue_mode: 'collab',
          preview: false,
          queue_source: row.queue_source || 'Приглашён'
        });
      });
      items = Array.from(byId.values()).sort((a, b) => {
        const da = a.docs_deadline ? String(a.docs_deadline).slice(0, 10) : '9999';
        const db_ = b.docs_deadline ? String(b.docs_deadline).slice(0, 10) : '9999';
        if (da !== db_) return da < db_ ? -1 : 1;
        return Number(a.id) - Number(b.id);
      });
      queueMode = collabIds.size ? 'collab+preview' : 'preview';
    }

    const banner = !isDuty && tab === 'analysis' && duty
      ? {
          message: oversight
            ? `Обзор очереди дежурного: ${duty.pm_name}, ${fmtRuDate(duty.period_start)} — ${fmtRuDate(duty.period_end)}.`
            : `Вы не дежурный. Сейчас: ${duty.pm_name} (${fmtRuDate(duty.period_start)} — ${fmtRuDate(duty.period_end)}). Очередь ниже — просмотр; править можно свои приглашения.`
        }
      : (!isDuty && tab === 'analysis' && !duty
        ? { message: oversight
            ? 'Дежурный не назначен. Ниже — полная очередь «рассмотрение».'
            : 'Дежурный не назначен. Очередь «рассмотрение» ниже (просмотр).' }
        : null);

    if (tab === 'analysis' && items.length) {
      const now = Date.now();
      const dayMs = 86400000;
      items = items.map((row) => {
        const ddl = row.docs_deadline ? new Date(String(row.docs_deadline).slice(0, 10) + 'T12:00:00') : null;
        const daysToDdl = ddl && Number.isFinite(ddl.getTime())
          ? Math.round((ddl.getTime() - now) / dayMs)
          : null;
        const touch = row.review_updated_at ? new Date(row.review_updated_at).getTime() : null;
        const idleHours = touch && Number.isFinite(touch)
          ? Math.round((now - touch) / 3600000)
          : null;
        return {
          ...row,
          deadline_hot: daysToDdl != null && daysToDdl <= 2,
          stale_idle: idleHours != null && idleHours >= 24 && !row.analysis_finalized_at
        };
      });
    }

    return {
      items,
      tab,
      duty,
      is_duty: isDuty,
      queue_mode: queueMode,
      banner
    };
  });

  const rating = require('../services/pm-analysis-rating');
  const LEADERBOARD_ROLES = ['ADMIN', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

  function normalizeWindow(q) {
    const w = String(q || 'd30');
    if (w === '90' || w === 'd90') return 'd90';
    if (w === 'duty' || w === 'shift') return 'duty';
    return 'd30';
  }

  async function ensureFreshRating(userId, windowKind) {
    let snap = await rating.getLatestSnapshot(db, userId, windowKind);
    const today = new Date().toISOString().slice(0, 10);
    if (!snap || String(snap.as_of_date).slice(0, 10) !== today) {
      await rating.upsertSnapshots(db, userId, today);
      snap = await rating.getLatestSnapshot(db, userId, windowKind);
    }
    return snap;
  }

  // GET /rating/me?window=duty|30|90
  fastify.get('/rating/me', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, async (request) => {
    const windowKind = normalizeWindow(request.query.window);
    const userId = request.user.id;
    try {
      const snap = await ensureFreshRating(userId, windowKind);
      if (snap) return { rating: rating.snapshotToPayload(snap), live: false };
      const live = await rating.computeUserRating(db, userId, windowKind);
      return { rating: live, live: true };
    } catch (err) {
      // Table may be missing before migration — compute live without persist
      request.log.warn({ err }, 'pm-duty rating/me snapshot failed');
      const live = await rating.computeUserRating(db, userId, windowKind);
      return { rating: live, live: true };
    }
  });

  // GET /rating/leaderboard?window=30|90&limit=
  fastify.get('/rating/leaderboard', {
    preHandler: [fastify.requireRoles(LEADERBOARD_ROLES)]
  }, async (request) => {
    const windowKind = normalizeWindow(request.query.window);
    if (windowKind === 'duty') {
      return replySafeLeaderboardDuty(request);
    }
    const limit = Math.min(parseInt(request.query.limit || '50', 10) || 50, 100);
    const today = new Date().toISOString().slice(0, 10);
    try {
      let r = await db.query(`
        SELECT s.*, u.name AS pm_name, u.role AS pm_role
        FROM pm_analysis_rating_daily s
        JOIN users u ON u.id = s.user_id
        WHERE s.window_kind = $1
          AND s.as_of_date = (
            SELECT MAX(as_of_date) FROM pm_analysis_rating_daily WHERE window_kind = $1
          )
        ORDER BY s.score DESC, u.name ASC
        LIMIT $2
      `, [windowKind, limit]);
      if (!r.rows.length) {
        await rating.recomputeAll(db, today, request.log);
        r = await db.query(`
          SELECT s.*, u.name AS pm_name, u.role AS pm_role
          FROM pm_analysis_rating_daily s
          JOIN users u ON u.id = s.user_id
          WHERE s.window_kind = $1 AND s.as_of_date = $2::date
          ORDER BY s.score DESC, u.name ASC
          LIMIT $3
        `, [windowKind, today, limit]);
      }
      return {
        window: windowKind,
        items: r.rows.map((row, idx) => ({
          rank: idx + 1,
          ...rating.snapshotToPayload(row, { pm_name: row.pm_name, pm_role: row.pm_role })
        }))
      };
    } catch (err) {
      request.log.warn({ err }, 'pm-duty rating/leaderboard failed');
      const ids = await rating.listPmUserIds(db);
      const items = [];
      for (const id of ids.slice(0, limit)) {
        const live = await rating.computeUserRating(db, id, windowKind, today);
        const u = await db.query(`SELECT name, role FROM users WHERE id = $1`, [id]);
        items.push({
          ...live,
          pm_name: u.rows[0]?.name || ('#' + id),
          pm_role: u.rows[0]?.role || null
        });
      }
      items.sort((a, b) => b.score - a.score || String(a.pm_name).localeCompare(String(b.pm_name)));
      return {
        window: windowKind,
        items: items.map((x, idx) => ({ rank: idx + 1, ...x }))
      };
    }
  });

  async function replySafeLeaderboardDuty(request) {
    // Duty leaderboard: latest duty snapshot per user
    const limit = Math.min(parseInt(request.query.limit || '50', 10) || 50, 100);
    try {
      const r = await db.query(`
        SELECT DISTINCT ON (s.user_id) s.*, u.name AS pm_name, u.role AS pm_role
        FROM pm_analysis_rating_daily s
        JOIN users u ON u.id = s.user_id
        WHERE s.window_kind = 'duty'
        ORDER BY s.user_id, s.as_of_date DESC
      `);
      const items = r.rows
        .sort((a, b) => b.score - a.score || String(a.pm_name).localeCompare(String(b.pm_name)))
        .slice(0, limit)
        .map((row, idx) => ({
          rank: idx + 1,
          ...rating.snapshotToPayload(row, { pm_name: row.pm_name, pm_role: row.pm_role })
        }));
      return { window: 'duty', items };
    } catch (err) {
      request.log.warn({ err }, 'pm-duty duty leaderboard failed');
      return { window: 'duty', items: [] };
    }
  }

  // GET /rating/:userId/breakdown?window=
  fastify.get('/rating/:userId/breakdown', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, async (request, reply) => {
    const targetId = parseInt(request.params.userId, 10);
    if (!Number.isFinite(targetId)) return reply.code(400).send({ error: 'userId' });
    const windowKind = normalizeWindow(request.query.window);
    const me = request.user.id;
    const role = request.user.role || '';
    const canSeeOthers = LEADERBOARD_ROLES.includes(role) || role === 'ADMIN';
    if (targetId !== me && !canSeeOthers) {
      return reply.code(403).send({ error: 'Нельзя смотреть чужой рейтинг' });
    }
    try {
      const snap = await ensureFreshRating(targetId, windowKind);
      const u = await db.query(`SELECT id, name, role FROM users WHERE id = $1`, [targetId]);
      const payload = snap
        ? rating.snapshotToPayload(snap)
        : await rating.computeUserRating(db, targetId, windowKind);
      return {
        rating: payload,
        user: u.rows[0] || { id: targetId },
        live: !snap
      };
    } catch (err) {
      request.log.warn({ err }, 'pm-duty rating breakdown failed');
      const live = await rating.computeUserRating(db, targetId, windowKind);
      const u = await db.query(`SELECT id, name, role FROM users WHERE id = $1`, [targetId]);
      return { rating: live, user: u.rows[0] || { id: targetId }, live: true };
    }
  });

  // POST /rating/recompute — ADMIN only (manual refresh)
  fastify.post('/rating/recompute', {
    preHandler: [fastify.requireRoles(['ADMIN'])]
  }, async (request) => {
    const result = await rating.recomputeAll(db, new Date(), request.log);
    return { ok: true, ...result };
  });

  // GET /weekly-report/preview — HTML+JSON дайджеста (ADMIN)
  fastify.get('/weekly-report/preview', {
    preHandler: [fastify.requireRoles(['ADMIN'])]
  }, async (request) => {
    const { buildWeeklyDigest } = require('../services/pm-analysis-weekly-report');
    const { generatePmAnalysisWeeklyEmail } = require('../services/pm-analysis-weekly-email');
    const q = request.query || {};
    const forceWeek = (q.from && q.to)
      ? { start: String(q.from).slice(0, 10), end: String(q.to).slice(0, 10) }
      : { start: '2026-08-31', end: '2026-09-06' };
    const payload = await buildWeeklyDigest(db, { preview: true, forceWeek });
    const html = generatePmAnalysisWeeklyEmail(payload);
    return { ok: true, payload, html };
  });

  // POST /weekly-report/send — ADMIN; body: { to?, from?, to?, kind?, preview? }
  fastify.post('/weekly-report/send', {
    preHandler: [fastify.requireRoles(['ADMIN'])]
  }, async (request) => {
    const weekly = require('../services/pm-analysis-weekly-cron');
    const b = request.body || {};
    const forceWeek = (b.from && b.to)
      ? { start: String(b.from).slice(0, 10), end: String(b.to).slice(0, 10) }
      : (b.preview && b.kind !== 'monthly' ? { start: '2026-08-31', end: '2026-09-06' } : undefined);
    const result = await weekly.runOnce(db, request.log, {
      kind: b.kind === 'monthly' ? 'monthly' : 'weekly',
      preview: b.preview !== false,
      toEmail: b.to || null,
      toName: b.to_name || null,
      forceWeek,
      onlyUserId: b.user_id || null
    });
    return {
      ok: true,
      subject: result.subject,
      results: result.results,
      recipients: result.recipients || null,
      week: { start: result.payload.weekStart, end: result.payload.weekEnd }
    };
  });
}

// RP Review routes mounted on /api/tenders
async function reviewRoutes(fastify) {
  const db = fastify.db;

  fastify.get('/director-review-queue/count', {
    preHandler: [fastify.requireRoles(DIRECTOR_DECISION_ROLES)]
  }, async () => {
    const r = await db.query(`
      SELECT COUNT(*)::int AS c FROM tender_rp_reviews r
      JOIN tenders t ON t.id = r.tender_id AND t.deleted_at IS NULL
      WHERE r.director_review_status = 'pending'
    `);
    return { count: r.rows[0]?.c || 0 };
  });

  fastify.get('/director-review-queue', {
    preHandler: [fastify.requireRoles(DIRECTOR_DECISION_ROLES)]
  }, async (request) => {
    const userId = request.user.id;
    const r = await db.query(`
      SELECT t.id, t.registry_no, t.customer_name, t.tender_title, t.tender_price,
             t.docs_deadline, t.registry_status, t.created_by,
             r.work_price, r.work_price_ex_vat, r.report_json, r.director_review_status,
             r.director_notify_at, r.decision, r.is_final, r.tkp_file_id,
             r.estimate_file_id, r.report_file_id,
             calc.name AS calculator_name,
             owner.name AS created_by_name
      FROM tender_rp_reviews r
      JOIN tenders t ON t.id = r.tender_id AND t.deleted_at IS NULL
      LEFT JOIN users calc ON calc.id = r.calculator_user_id
      LEFT JOIN users owner ON owner.id = t.created_by
      WHERE r.director_review_status = 'pending'
      ORDER BY r.director_notify_at ASC NULLS LAST, r.updated_at ASC
      LIMIT 500
    `);
    const items = [];
    for (const row of r.rows) {
      const rj = parseReportJson(row.report_json);
      const thread_unread = await loadThreadUnreadCount(db, row.id, userId);
      let director_unread = false;
      if (row.director_notify_at) {
        const seen = await db.query(
          'SELECT seen_at FROM tender_registry_director_seen WHERE user_id = $1 AND tender_id = $2',
          [userId, row.id]
        );
        const seenAt = seen.rows[0]?.seen_at;
        director_unread = !seenAt || new Date(seenAt) < new Date(row.director_notify_at);
      }
      items.push({
        ...row,
        duration_days: rj.duration_days ?? null,
        thread_unread,
        director_unread
      });
    }
    return { items };
  });

  fastify.post('/:id/director-review-seen', {
    preHandler: [fastify.requireRoles(DIRECTOR_DECISION_ROLES)]
  }, async (request) => {
    const tenderId = request.params.id;
    await db.query(`
      INSERT INTO tender_registry_director_seen (user_id, tender_id, seen_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id, tender_id) DO UPDATE SET seen_at = NOW()
    `, [request.user.id, tenderId]);
    return { ok: true };
  });

  fastify.get('/:id/rp-review', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, async (request, reply) => {
    const tenderId = request.params.id;
    const userId = request.user.id;
    const userRole = request.user.role || '';
    let review = await ensureReview(db, tenderId, userId);
    const duty = await getCurrentDuty(db);
    try {
      review = await ensureAnalysisOwner(db, review, userId, duty?.pm_user_id);
    } catch (_) { /* V304 may not be applied yet */ }

    const userIds = [
      review.started_by_user_id,
      review.analysis_finalized_by_user_id,
      review.finalized_by_user_id,
      review.analysis_owner_user_id
    ].filter(Boolean);
    let userMap = {};
    if (userIds.length) {
      const ur = await db.query(
        'SELECT id, name FROM users WHERE id = ANY($1::int[])',
        [userIds]
      );
      userMap = Object.fromEntries(ur.rows.map((u) => [u.id, u.name]));
    }
    const logs = await db.query(`
      SELECT l.*, u.name AS actor_name FROM tender_rp_review_log l
      LEFT JOIN users u ON u.id = l.actor_user_id
      WHERE l.review_id = $1 ORDER BY l.created_at DESC LIMIT 100
    `, [review.id]);
    const collabs = await db.query(`
      SELECT c.*, u.name AS pm_name FROM tender_rp_review_collaborators c
      JOIN users u ON u.id = c.pm_user_id
      WHERE c.review_id = $1 AND c.revoked_at IS NULL
    `, [review.id]);
    let estimate_file = null;
    let report_file = null;
    let tkp_file = null;
    if (review.estimate_file_id) {
      const ef = await db.query(
        'SELECT id, original_name, download_url, size, mime_type, created_at FROM documents WHERE id = $1',
        [review.estimate_file_id]
      );
      estimate_file = ef.rows[0] || null;
    }
    if (review.report_file_id) {
      const rf = await db.query(
        'SELECT id, original_name, download_url, size, mime_type, created_at FROM documents WHERE id = $1',
        [review.report_file_id]
      );
      report_file = rf.rows[0] || null;
    }
    if (review.tkp_file_id) {
      const tf = await db.query(
        'SELECT id, original_name, download_url, size, mime_type, created_at FROM documents WHERE id = $1',
        [review.tkp_file_id]
      );
      tkp_file = tf.rows[0] || null;
    }
    const enriched = enrichReviewRow(review, userMap);
    if (review.analysis_owner_user_id) {
      enriched.analysis_owner_name = userMap[review.analysis_owner_user_id] || null;
    }
    const rj = parseReportJson(review.report_json);
    const thread_unread = await loadThreadUnreadCount(db, tenderId, userId);
    const tenderRow = await db.query(`
      SELECT t.id, t.customer_name, t.tender_title, t.tender_price, t.docs_deadline,
             t.registry_status, t.purchase_url, t.calculator_user_id, t.created_by,
             cb.name AS created_by_name,
             calc.name AS calculator_user_name
      FROM tenders t
      LEFT JOIN users cb ON cb.id = t.created_by
      LEFT JOIN users calc ON calc.id = t.calculator_user_id
      WHERE t.id = $1
    `, [tenderId]);
    const tender = tenderRow.rows[0] || null;

    const { phase, ownerUserId } = await resolveFinalOwner(db, review, tender, duty?.pm_user_id);
    const isFinalOwner = ownerUserId != null && Number(ownerUserId) === userId;
    const isToRole = ['TO', 'HEAD_TO'].includes(userRole);
    const isWide = ['ADMIN', 'HEAD_PM', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(userRole);

    let my_draft = null;
    let team_drafts = [];
    try {
      const rawMine = await getMyDraft(db, review.id, userId, phase);
      my_draft = rawMine ? await enrichDraft(db, rawMine) : null;
      // TO sees team drafts only via history labels — not full content in main payload
      if (!isToRole || isWide || isFinalOwner || await isCollaborator(db, tenderId, userId) || (duty && Number(duty.pm_user_id) === userId)) {
        if (!isToRole || isWide) {
          const rawTeam = await listTeamDrafts(db, review.id, phase, { excludeAuthorId: userId });
          team_drafts = await Promise.all(rawTeam.map((d) => enrichDraft(db, d)));
          // Strip draft_json content for pure TO (not wide) — only meta
          if (isToRole && !isWide) {
            team_drafts = team_drafts.map((d) => ({
              id: d.id,
              author_user_id: d.author_user_id,
              author_name: d.author_name,
              phase: d.phase,
              status: d.status,
              updated_at: d.updated_at,
              has_estimate: !!d.estimate_file_id,
              has_report: !!d.report_file_id
            }));
          }
        } else {
          const rawTeam = await listTeamDrafts(db, review.id, phase, { excludeAuthorId: userId });
          team_drafts = await Promise.all(rawTeam.map((d) => enrichDraft(db, d)));
        }
      }
    } catch (err) {
      request.log.warn({ err }, 'rp-review drafts load skipped (migration?)');
    }

    const team_summary = {
      collaborators_count: collabs.rows.length,
      drafts_count: team_drafts.length + (my_draft ? 1 : 0),
      ready_count: [my_draft, ...team_drafts].filter((d) => d && d.status === 'ready').length
    };

    return {
      review: enriched,
      tender,
      analysis_snapshot: rj.analysis_snapshot || null,
      logs: logs.rows,
      collaborators: collabs.rows,
      estimate_file,
      report_file,
      tkp_file,
      thread_unread,
      phase,
      final_owner_user_id: ownerUserId,
      final_owner_name: ownerUserId ? (userMap[ownerUserId] || (Number(tender?.calculator_user_id) === ownerUserId ? tender?.calculator_user_name : null) || null) : null,
      is_final_owner: isFinalOwner || isWide,
      is_real_final_owner: isFinalOwner,
      can_finalize: (isFinalOwner || isWide) && !review.is_final,
      my_draft,
      team_drafts,
      team_summary
    };
  });

  fastify.put('/:id/rp-review', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, async (request, reply) => {
    const tenderId = request.params.id;
    const userId = request.user.id;
    const duty = await getCurrentDuty(db);
    const isDuty = duty && duty.pm_user_id === userId;
    const collab = await isCollaborator(db, tenderId, userId);
    const tenderRow = await db.query(
      'SELECT calculator_user_id, calculator_kind, registry_status FROM tenders WHERE id = $1',
      [tenderId]
    );
    const tender = tenderRow.rows[0];
    const isCalc = tender && Number(tender.calculator_user_id) === userId;
    const userRole = request.user.role || '';
    const isWide = ['ADMIN', 'HEAD_TO', 'HEAD_PM'].includes(userRole);

    let review = await ensureReview(db, tenderId, userId);
    const b = request.body || {};

    // Optimistic lock до любых мутаций — иначе ensureAnalysisOwner ломает токен
    if (b.expected_updated_at && review.updated_at) {
      const cur = new Date(review.updated_at).toISOString();
      const exp = new Date(b.expected_updated_at).toISOString();
      if (cur !== exp) {
        return reply.code(409).send({
          error: 'Отчёт изменился у другого пользователя. Обновите форму и повторите.',
          code: 'REVIEW_CONFLICT',
          updated_at: review.updated_at
        });
      }
    }

    const isParticipant = await isReviewParticipant(db, tenderId, userId);

    try {
      // При записи дежурный/считающий/участник может стать analysis_owner, если ещё не назначен
      review = await ensureAnalysisOwner(db, review, userId, duty?.pm_user_id, {
        allowActorFallback: !!(isDuty || isCalc || isParticipant)
      });
    } catch (_) { /* ignore */ }
    if (review.is_final) {
      return reply.code(409).send({ error: 'Отчёт уже закрыт' });
    }

    const { ownerUserId, phase: ownerPhase } = await resolveFinalOwner(db, review, tender, duty?.pm_user_id);
    const isRealOwner = ownerUserId != null && Number(ownerUserId) === userId;
    // Текущий дежурный всегда может закрыть открытый анализ (handoff при смене смены).
    const isFinalOwner = isRealOwner || isWide
      || (ownerPhase === 'analysis' && isDuty && !review.analysis_finalized_at);

    const isFinal = !!b.finalize;
    const analysisOpen = !review.analysis_finalized_at;
    // Пока анализ открыт — общий отчёт правят дежурный, участник, collab, wide
    const canSharedAnalysisEdit = analysisOpen
      && (isDuty || isParticipant || collab || isWide || isCalc);

    if (isFinal) {
      if (!isFinalOwner) {
        return reply.code(403).send({
          error: 'Вы готовите личный черновик. Сохраняйте через «Мой черновик». Закрыть анализ/отчёт может только хозяин фазы.',
          use_my_draft: true
        });
      }
    } else if (!canSharedAnalysisEdit && !isFinalOwner) {
      return reply.code(403).send({
        error: 'Вы готовите личный черновик. Сохраняйте через «Мой черновик». Закрыть анализ/отчёт может только хозяин фазы.',
        use_my_draft: true
      });
    }

    // ADMIN/HEAD пишет чужой финал — только с явным override_as_admin
    // (для совместного редактирования открытого анализа override не нужен)
    if (isWide && !isRealOwner && ownerUserId && !b.override_as_admin) {
      if (isFinal || !canSharedAnalysisEdit) {
        return reply.code(403).send({
          error: 'Вы не хозяин фазы. Подтвердите перезапись финального отчёта.',
          need_override: true,
          final_owner_user_id: ownerUserId
        });
      }
    }

    let report_json = b.report_json !== undefined ? b.report_json : review.report_json;
    if (typeof report_json === 'string') {
      try { report_json = JSON.parse(report_json); } catch (_) { report_json = {}; }
    }
    const rj = parseReportJson(report_json);
    const mode = rj.mode || 'calc';
    const decision = b.decision || review.decision;

    if (review.analysis_finalized_at && mode === 'calc') {
      const canEditCalc = isCalc || collab || isWide || ['HEAD_PM'].includes(userRole);
      if (!canEditCalc) {
        return reply.code(403).send({
          error: 'Полный просчёт ведёт назначенный РП. Дождитесь назначения от ТО.'
        });
      }
    } else if (!canSharedAnalysisEdit && !isDuty && !collab && !isCalc && !isWide && !isParticipant) {
      return reply.code(403).send({ error: 'Нет доступа к редактированию отчёта' });
    }

    if (review.analysis_finalized_at && mode === 'analysis') {
      return reply.code(409).send({ error: 'Анализ уже закрыт. Откройте вкладку «Просчёты» для полного просчёта.' });
    }

    if (isFinal && !isRealOwner && !isWide) {
      return reply.code(403).send({
        error: ownerPhase === 'analysis'
          ? 'Закрыть анализ может только хозяин анализа (дежурный / инициатор)'
          : 'Закрыть отчёт может только назначенный считающий'
      });
    }

    if (isFinal && decision === 'submit') {
      if (mode === 'analysis') {
        if (!String(rj.summary || '').trim()) {
          return reply.code(400).send({ error: 'Для финализации укажите «Суть для ТО»' });
        }
        if (!rj.feasibility) {
          return reply.code(400).send({ error: 'Укажите выполнимость (да / условно / нет)' });
        }
      } else if (!b.work_price && !review.work_price && !review.estimate_file_id && !b.estimate_file_id) {
        return reply.code(400).send({ error: 'Для финализации «подаём» нужна цена или смета' });
      } else {
        const tkpId = b.tkp_file_id || review.tkp_file_id;
        if (!tkpId) {
          return reply.code(400).send({ error: 'Приложите ТКП к отчёту просчёта' });
        }
      }
    }

    const report_kind = b.report_kind || review.report_kind || (decision === 'reject' ? 'reject' : 'work');
    const work_price = b.work_price !== undefined ? b.work_price : review.work_price;
    const missing_info_flags = b.missing_info_flags || review.missing_info_flags;

    let registry_status = null;
    let setFinal = false;
    let analysisFinalizedAt = review.analysis_finalized_at;
    let analysisFinalizedBy = review.analysis_finalized_by_user_id;
    let logAction = isFinal ? 'finalize' : 'save_draft';
    let notifyToAt = review.to_notify_at;
    let directorReviewStatus = review.director_review_status || null;
    let directorNotifyAt = review.director_notify_at || null;
  let workPriceExVat = review.work_price_ex_vat || null;
  let pendingDirector = false;
  let approvalRecipients = null;

    if (isFinal && mode === 'analysis') {
      const userName = request.user.name || '';
      if (decision === 'reject') {
        // Не кидаем в архив сразу: ТО видит «не подаём» в активном реестре и сам жмёт «В архив».
        // Анализ при этом ЗАКРЫТ — иначе рейтинг/фаза считают отказ «брошенным».
        setFinal = true;
        registry_status = null;
        analysisFinalizedAt = new Date();
        analysisFinalizedBy = userId;
        notifyToAt = new Date();
        logAction = 'finalize_reject';
        report_json = { ...rj, mode: 'analysis' };
      } else {
        const snapshot = buildAnalysisSnapshot(rj, decision, userId, userName);
        report_json = {
          ...rj,
          mode: 'calc',
          analysis_snapshot: snapshot,
          scope: rj.scope || '',
          duration_days: rj.duration_days ?? null,
          resources: rj.resources || '',
          questions_for_customer: rj.questions_for_customer || []
        };
        setFinal = false;
        analysisFinalizedAt = new Date();
        analysisFinalizedBy = userId;
        logAction = 'finalize_analysis';
        notifyToAt = new Date();
      }
    } else if (isFinal) {
      setFinal = true;
      notifyToAt = new Date();
      // Без закрытого анализа is_final=true даёт зомби: API «отчёт закрыт»,
      // а напоминалки/фаза анализа смотрят analysis_finalized_at → вечный черновик.
      if (!analysisFinalizedAt) {
        analysisFinalizedAt = new Date();
        analysisFinalizedBy = userId;
      }
      if (decision === 'reject') {
        // Аналогично: финальный отказ РП → рекомендация ТО, не авто-архив.
        registry_status = null;
        logAction = 'finalize_reject';
      } else if (decision === 'submit') {
        const threshold = await getDirectorThreshold(db);
        workPriceExVat = computeWorkPriceExVat(work_price);
        // Порог 10 млн без НДС — единственный триггер согласования (force_director убран).
        if (needsDirectorApproval(workPriceExVat, threshold)) {
          approvalRecipients = normalizeApprovalRecipients(b.approval_recipients);
          if (!approvalRecipients) {
            return reply.code(400).send({
              error: 'Выберите хотя бы одного получателя согласования (ген. директор / развитие / коммерческий / рук. ТО)'
            });
          }
          directorReviewStatus = 'pending';
          directorNotifyAt = new Date();
          pendingDirector = true;
        } else {
          registry_status = 'готовим';
        }
      }
      report_json = { ...rj, mode: 'calc' };
    }

    // Explicit casts on every $1 use — without them Postgres fails with
    // "inconsistent types deduced for parameter $1" (varchar vs text) when
    // the same param is assigned to a varchar column AND compared to a text literal.
    const expectedAt = b.expected_updated_at
      ? new Date(b.expected_updated_at)
      : null;
    const expectedAtValid = expectedAt && Number.isFinite(expectedAt.getTime()) ? expectedAt : null;
    let r;
    try {
      r = await db.query(`
        UPDATE tender_rp_reviews SET
          decision = $1::varchar,
          report_kind = $2,
          report_json = $3,
          missing_info_flags = $4,
          work_price = $5,
          estimate_file_id = COALESCE($6, estimate_file_id),
          tkp_file_id = COALESCE($13, tkp_file_id),
          is_final = $7,
          analysis_finalized_at = COALESCE($8, analysis_finalized_at),
          analysis_finalized_by_user_id = COALESCE($9, analysis_finalized_by_user_id),
          started_by_user_id = COALESCE(started_by_user_id, $10),
          analysis_started_at = COALESCE(analysis_started_at, NOW()),
          finalized_by_user_id = CASE WHEN $7 THEN $10 ELSE finalized_by_user_id END,
          calculator_user_id = CASE
            WHEN $7 AND $1::text = 'submit' THEN $10
            ELSE calculator_user_id
          END,
          to_notify_at = COALESCE($12, to_notify_at),
          director_review_status = COALESCE($14, director_review_status),
          director_notify_at = COALESCE($15, director_notify_at),
          work_price_ex_vat = COALESCE($16, work_price_ex_vat),
          updated_at = NOW()
        WHERE tender_id = $11
          -- JSON/JS Date only has ms; PG NOW() keeps µs → exact '=' never matches after round-trip
          AND ($17::timestamptz IS NULL
               OR date_trunc('milliseconds', updated_at)
                  = date_trunc('milliseconds', $17::timestamptz))
        RETURNING *
      `, [
        decision, report_kind, JSON.stringify(report_json),
        missing_info_flags, work_price, b.estimate_file_id || null,
        setFinal, analysisFinalizedAt, analysisFinalizedBy,
        userId, tenderId, notifyToAt,
        b.tkp_file_id || null,
        directorReviewStatus,
        directorNotifyAt,
        workPriceExVat,
        expectedAtValid
      ]);
    } catch (err) {
      request.log.error({ err }, 'rp-review save failed');
      return reply.code(500).send({ error: err.message || 'Ошибка сохранения отчёта' });
    }
    if (!r.rows[0]) {
      return reply.code(409).send({
        error: 'Отчёт изменился у другого пользователя. Обновите форму и повторите.',
        code: 'REVIEW_CONFLICT'
      });
    }

    await writeReviewLog(db, {
      reviewId: review.id, tenderId, actorUserId: userId,
      action: logAction,
      payload: { decision, report_kind, mode }
    });

    if (logAction === 'finalize_analysis' && decision !== 'reject') {
      // Анализ закрыт «подаём»: просчёт сразу за дежурным РП — тот же человек продолжает,
      // без ручного назначения. Если дежурный не назначен, оставляем актора владельцем.
      const ownerId = (duty && duty.pm_user_id) ? Number(duty.pm_user_id) : userId;
      await db.query(`
        UPDATE tenders SET calculator_user_id = $1, calculator_kind = 'pm', updated_at = NOW()
        WHERE id = $2
      `, [ownerId, tenderId]);
      await db.query(`
        UPDATE tender_rp_reviews SET calculator_user_id = $1, updated_at = NOW()
        WHERE tender_id = $2
      `, [ownerId, tenderId]);
    } else if (mode === 'calc' && logAction !== 'finalize_analysis') {
      await syncCalculatorActor(db, tenderId, userId, userRole, tender, { isDuty });
    }

    if (registry_status) {
      await applyRegistryStatus(db, tenderId, registry_status, !!analysisFinalizedAt);
    }

    if (notifyToAt && (logAction === 'finalize_analysis' || logAction === 'finalize_reject' || (isFinal && setFinal))) {
      if (pendingDirector) {
        notifyDirectorsOnReviewPending(db, {
          tenderId: parseInt(tenderId, 10),
          actorName: request.user.name || request.user.login,
          workPriceExVat,
          log: request.log
        }).catch(() => {});
        notifyToOnDirectorPending(db, {
          tenderId: parseInt(tenderId, 10),
          actorName: request.user.name || request.user.login,
          log: request.log
        }).catch(() => {});
        try {
          const tenderDirectorMail = require('../services/tender-director-mail');
          // Ждём запись получателей/токенов; SMTP dry_run быстрый. Fire-and-forget ломал адресное согласование.
          await tenderDirectorMail.sendDirectorMail(db, parseInt(tenderId, 10), {
            log: request.log,
            recipients: approvalRecipients
          });
        } catch (e) {
          request.log.warn({ err: e, tenderId }, 'tender director mail failed');
        }
      } else {
        notifyToOnReviewReady(db, {
          tenderId: parseInt(tenderId, 10),
          kind: logAction === 'finalize_analysis' ? 'analysis'
            : (logAction === 'finalize_reject' ? 'reject' : 'report'),
          actorName: request.user.name || request.user.login,
          log: request.log
        }).catch(() => {});
      }
    }

    broadcast('tender:registry:changed', { id: parseInt(tenderId, 10) });
    return { review: r.rows[0] };
  });

  fastify.post('/:id/rp-review/estimate', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, async (request, reply) => {
    const tenderId = request.params.id;
    const userId = request.user.id;
    const duty = await getCurrentDuty(db);
    const isDuty = duty && duty.pm_user_id === userId;
    const collab = await isCollaborator(db, tenderId, userId);
    const isParticipant = await isReviewParticipant(db, tenderId, userId);
    const tenderRow = await db.query('SELECT calculator_user_id FROM tenders WHERE id = $1', [tenderId]);
    const tender = tenderRow.rows[0];
    const isCalc = tender && Number(tender.calculator_user_id) === userId;
    const isWide = ['ADMIN', 'HEAD_TO', 'HEAD_PM'].includes(request.user.role);
    let review = await ensureReview(db, tenderId, userId);
    try {
      review = await ensureAnalysisOwner(db, review, userId, duty?.pm_user_id, {
        allowActorFallback: !!(isDuty || isCalc || isParticipant)
      });
    } catch (_) { /* ignore */ }
    const { ownerUserId } = await resolveFinalOwner(db, review, tender, duty?.pm_user_id);
    const isFinalOwner = (ownerUserId && Number(ownerUserId) === userId) || isWide;
    const access = assertFinalFileUploadAccess({
      review, isDuty, isParticipant, collab, isCalc, isWide, isFinalOwner
    });
    if (!access.ok) return reply.code(access.code).send(access.body);

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: 'Файл обязателен' });
    const buffer = await data.toBuffer();
    const uploadRoot = process.env.UPLOAD_DIR || './uploads';
    const dir = path.join(uploadRoot, 'rp_estimates', String(tenderId));
    await fs.mkdir(dir, { recursive: true });
    const safeName = `${Date.now()}_${String(data.filename || 'estimate').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    await fs.writeFile(path.join(dir, safeName), buffer);
    const downloadUrl = `/uploads/rp_estimates/${tenderId}/${safeName}`;
    const docRes = await db.query(`
      INSERT INTO documents (filename, original_name, mime_type, size, type, tender_id, uploaded_by, download_url, created_at)
      VALUES ($1, $2, $3, $4, 'rp_estimate', $5, $6, $7, NOW())
      RETURNING id, original_name, download_url, size, mime_type, created_at
    `, [safeName, data.filename || safeName, data.mimetype || 'application/octet-stream', buffer.length, tenderId, userId, downloadUrl]);

    const fileId = docRes.rows[0].id;
    await db.query(
      'UPDATE tender_rp_reviews SET estimate_file_id = $1, updated_at = NOW() WHERE id = $2',
      [fileId, review.id]
    );
    await writeReviewLog(db, {
      reviewId: review.id, tenderId, actorUserId: userId,
      action: 'attach_estimate', payload: { file_id: fileId, name: data.filename }
    });
    broadcast('tender:registry:changed', { id: parseInt(tenderId, 10) });
    return { estimate_file_id: fileId, estimate_file: docRes.rows[0] };
  });

  fastify.post('/:id/rp-review/report', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, async (request, reply) => {
    const tenderId = request.params.id;
    const userId = request.user.id;
    const duty = await getCurrentDuty(db);
    const isDuty = duty && duty.pm_user_id === userId;
    const collab = await isCollaborator(db, tenderId, userId);
    const isParticipant = await isReviewParticipant(db, tenderId, userId);
    const tenderRow = await db.query('SELECT calculator_user_id FROM tenders WHERE id = $1', [tenderId]);
    const tender = tenderRow.rows[0];
    const isCalc = tender && Number(tender.calculator_user_id) === userId;
    const isWide = ['ADMIN', 'HEAD_TO', 'HEAD_PM'].includes(request.user.role);
    let review = await ensureReview(db, tenderId, userId);
    try {
      review = await ensureAnalysisOwner(db, review, userId, duty?.pm_user_id, {
        allowActorFallback: !!(isDuty || isCalc || isParticipant)
      });
    } catch (_) { /* ignore */ }
    const { ownerUserId } = await resolveFinalOwner(db, review, tender, duty?.pm_user_id);
    const isFinalOwner = (ownerUserId && Number(ownerUserId) === userId) || isWide;
    const access = assertFinalFileUploadAccess({
      review, isDuty, isParticipant, collab, isCalc, isWide, isFinalOwner
    });
    if (!access.ok) return reply.code(access.code).send(access.body);

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: 'Файл обязателен' });
    const buffer = await data.toBuffer();
    const uploadRoot = process.env.UPLOAD_DIR || './uploads';
    const dir = path.join(uploadRoot, 'rp_reports', String(tenderId));
    await fs.mkdir(dir, { recursive: true });
    const safeName = `${Date.now()}_${String(data.filename || 'report').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    await fs.writeFile(path.join(dir, safeName), buffer);
    const downloadUrl = `/uploads/rp_reports/${tenderId}/${safeName}`;
    const docRes = await db.query(`
      INSERT INTO documents (filename, original_name, mime_type, size, type, tender_id, uploaded_by, download_url, created_at)
      VALUES ($1, $2, $3, $4, 'rp_report', $5, $6, $7, NOW())
      RETURNING id, original_name, download_url, size, mime_type, created_at
    `, [safeName, data.filename || safeName, data.mimetype || 'application/octet-stream', buffer.length, tenderId, userId, downloadUrl]);

    const fileId = docRes.rows[0].id;
    await db.query(
      'UPDATE tender_rp_reviews SET report_file_id = $1, updated_at = NOW() WHERE id = $2',
      [fileId, review.id]
    );
    await writeReviewLog(db, {
      reviewId: review.id, tenderId, actorUserId: userId,
      action: 'attach_report', payload: { file_id: fileId, name: data.filename }
    });
    broadcast('tender:registry:changed', { id: parseInt(tenderId, 10) });
    return { report_file_id: fileId, report_file: docRes.rows[0] };
  });

  fastify.post('/:id/rp-review/tkp', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, async (request, reply) => {
    const tenderId = request.params.id;
    const userId = request.user.id;
    const duty = await getCurrentDuty(db);
    const isDuty = duty && duty.pm_user_id === userId;
    const collab = await isCollaborator(db, tenderId, userId);
    const isParticipant = await isReviewParticipant(db, tenderId, userId);
    const tenderRow = await db.query('SELECT calculator_user_id FROM tenders WHERE id = $1', [tenderId]);
    const tender = tenderRow.rows[0];
    const isCalc = tender && Number(tender.calculator_user_id) === userId;
    const isWide = ['ADMIN', 'HEAD_TO', 'HEAD_PM'].includes(request.user.role);
    let review = await ensureReview(db, tenderId, userId);
    try {
      review = await ensureAnalysisOwner(db, review, userId, duty?.pm_user_id, {
        allowActorFallback: !!(isDuty || isCalc || isParticipant)
      });
    } catch (_) { /* ignore */ }
    const { ownerUserId } = await resolveFinalOwner(db, review, tender, duty?.pm_user_id);
    const isFinalOwner = (ownerUserId && Number(ownerUserId) === userId) || isWide;
    const access = assertFinalFileUploadAccess({
      review, isDuty, isParticipant, collab, isCalc, isWide, isFinalOwner
    });
    if (!access.ok) return reply.code(access.code).send(access.body);

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: 'Файл обязателен' });
    const buffer = await data.toBuffer();
    const uploadRoot = process.env.UPLOAD_DIR || './uploads';
    const dir = path.join(uploadRoot, 'rp_tkp', String(tenderId));
    await fs.mkdir(dir, { recursive: true });
    const safeName = `${Date.now()}_${String(data.filename || 'tkp').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    await fs.writeFile(path.join(dir, safeName), buffer);
    const downloadUrl = `/uploads/rp_tkp/${tenderId}/${safeName}`;
    const docRes = await db.query(`
      INSERT INTO documents (filename, original_name, mime_type, size, type, tender_id, uploaded_by, download_url, created_at)
      VALUES ($1, $2, $3, $4, 'rp_tkp', $5, $6, $7, NOW())
      RETURNING id, original_name, download_url, size, mime_type, created_at
    `, [safeName, data.filename || safeName, data.mimetype || 'application/octet-stream', buffer.length, tenderId, userId, downloadUrl]);

    const fileId = docRes.rows[0].id;
    await db.query(
      'UPDATE tender_rp_reviews SET tkp_file_id = $1, updated_at = NOW() WHERE id = $2',
      [fileId, review.id]
    );
    await writeReviewLog(db, {
      reviewId: review.id, tenderId, actorUserId: userId,
      action: 'attach_tkp', payload: { file_id: fileId, name: data.filename }
    });
    broadcast('tender:registry:changed', { id: parseInt(tenderId, 10) });
    return { tkp_file_id: fileId, tkp_file: docRes.rows[0] };
  });

  fastify.get('/:id/rp-review/history', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, async (request) => {
    const review = await ensureReview(db, request.params.id, request.user.id);
    const logs = await db.query(`
      SELECT l.*, u.name AS actor_name FROM tender_rp_review_log l
      LEFT JOIN users u ON u.id = l.actor_user_id
      WHERE l.review_id = $1 ORDER BY l.created_at ASC
    `, [review.id]);
    return { logs: logs.rows };
  });

  fastify.post('/:id/rp-review/invite', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, async (request, reply) => {
    const tenderId = request.params.id;
    const { pm_user_id } = request.body || {};
    if (!pm_user_id) return reply.code(400).send({ error: 'pm_user_id обязателен' });

    const duty = await getCurrentDuty(db);
    const isDuty = duty && Number(duty.pm_user_id) === request.user.id;
    const tenderRow = await db.query(
      'SELECT calculator_user_id FROM tenders WHERE id = $1',
      [tenderId]
    );
    const isCalc = tenderRow.rows[0] && Number(tenderRow.rows[0].calculator_user_id) === request.user.id;
    const review = await ensureReview(db, tenderId, request.user.id);
    try {
      await ensureAnalysisOwner(db, review, request.user.id, duty?.pm_user_id);
    } catch (_) { /* ignore */ }
    const { ownerUserId } = await resolveFinalOwner(db, review, tenderRow.rows[0], duty?.pm_user_id);
    const isOwner = ownerUserId && Number(ownerUserId) === request.user.id;
    if (!isDuty && !isCalc && !isOwner && !['ADMIN', 'HEAD_TO'].includes(request.user.role)) {
      return reply.code(403).send({ error: 'Приглашать может хозяин фазы, дежурный или считающий' });
    }

    const r = await db.query(`
      INSERT INTO tender_rp_review_collaborators (review_id, tender_id, pm_user_id, invited_by_user_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (review_id, pm_user_id) DO UPDATE SET revoked_at = NULL, invited_at = NOW()
      RETURNING *
    `, [review.id, tenderId, pm_user_id, request.user.id]);

    await writeReviewLog(db, {
      reviewId: review.id, tenderId, actorUserId: request.user.id,
      action: 'invite_collaborator', payload: { pm_user_id }
    });

    const tInfo = await db.query(
      'SELECT id, customer_name, tender_title FROM tenders WHERE id = $1',
      [tenderId]
    );
    const { notifyPmCalcEvent } = require('../services/tender-assign-notify');
    await notifyPmCalcEvent(db, {
      userId: pm_user_id,
      kind: 'invite',
      tender: tInfo.rows[0] || { id: tenderId },
      actorName: request.user.name || 'РП',
      link: '#/pm-calculations',
      log: request.log
    });

    return { collaborator: r.rows[0] };
  });

  fastify.delete('/:id/rp-review/invite/:pmId', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, async (request, reply) => {
    const tenderId = request.params.id;
    const duty = await getCurrentDuty(db);
    const isDuty = duty && Number(duty.pm_user_id) === request.user.id;
    const tenderRow = await db.query('SELECT calculator_user_id FROM tenders WHERE id = $1', [tenderId]);
    const isCalc = tenderRow.rows[0] && Number(tenderRow.rows[0].calculator_user_id) === request.user.id;
    const review = await ensureReview(db, tenderId, request.user.id);
    const { ownerUserId } = await resolveFinalOwner(db, review, tenderRow.rows[0], duty?.pm_user_id);
    const isOwner = ownerUserId && Number(ownerUserId) === request.user.id;
    if (!isDuty && !isCalc && !isOwner && !['ADMIN', 'HEAD_TO'].includes(request.user.role)) {
      return reply.code(403).send({ error: 'Отозвать приглашение может хозяин фазы' });
    }
    await db.query(`
      UPDATE tender_rp_review_collaborators SET revoked_at = NOW()
      WHERE review_id = $1 AND pm_user_id = $2
    `, [review.id, request.params.pmId]);
    await writeReviewLog(db, {
      reviewId: review.id, tenderId, actorUserId: request.user.id,
      action: 'revoke_collaborator', payload: { pm_user_id: Number(request.params.pmId) }
    });
    return { ok: true };
  });

  fastify.post('/:id/rp-review/to-decision', {
    preHandler: [fastify.requireRoles(TO_DECISION_ROLES)]
  }, async (request, reply) => {
    const tenderId = request.params.id;
    const userId = request.user.id;
    const { action, comment, reject_reason } = request.body || {};
    if (!['accept', 'reject', 'rework'].includes(action)) {
      return reply.code(400).send({ error: 'action: accept | reject | rework' });
    }

    const review = await ensureReview(db, tenderId, userId);
    if (!review.is_final) {
      return reply.code(400).send({ error: 'Решение ТО возможно только по закрытому отчёту РП' });
    }
    if (review.director_review_status === 'pending') {
      return reply.code(409).send({ error: 'Ожидает согласования директора' });
    }

    if (action === 'accept') {
      await applyRegistryStatus(db, tenderId, 'готовим', true);
      await writeReviewLog(db, {
        reviewId: review.id, tenderId, actorUserId: userId,
        action: 'to_accept', payload: { comment: comment || null }
      });
    } else if (action === 'reject') {
      await db.query(`
        UPDATE tender_rp_reviews SET updated_at = NOW() WHERE tender_id = $1
      `, [tenderId]);
      await db.query(`
        UPDATE tenders SET registry_status = 'отмена', tender_status = 'Не подходит',
          reject_reason = COALESCE($1, reject_reason), updated_at = NOW()
        WHERE id = $2
      `, [reject_reason || comment || null, tenderId]);
      await writeReviewLog(db, {
        reviewId: review.id, tenderId, actorUserId: userId,
        action: 'to_reject', payload: { comment: comment || null, reject_reason: reject_reason || null }
      });
    } else if (action === 'rework') {
      // Возврат на доработку: отчёт снова черновик, считающий сбрасывается —
      // иначе в реестре «назначьте РП», а в колонке «Считает» остаётся прежний.
      await db.query(`
        UPDATE tender_rp_reviews SET is_final = false, calculator_user_id = NULL, updated_at = NOW()
        WHERE tender_id = $1
      `, [tenderId]);
      await db.query(`
        UPDATE tenders SET registry_status = 'рассмотрение', tender_status = $1,
          calculator_user_id = NULL, calculator_kind = NULL, updated_at = NOW()
        WHERE id = $2
      `, [syncTenderStatus('рассмотрение'), tenderId]);
      await writeReviewLog(db, {
        reviewId: review.id, tenderId, actorUserId: userId,
        action: 'to_rework', payload: { comment: comment || null }
      });
    }

    broadcast('tender:registry:changed', { id: parseInt(tenderId, 10) });
    const updated = await db.query('SELECT * FROM tender_rp_reviews WHERE tender_id = $1', [tenderId]);
    return { review: updated.rows[0], ok: true };
  });

  fastify.post('/:id/rp-review/director-decision', {
    preHandler: [fastify.requireRoles(DIRECTOR_DECISION_ROLES)]
  }, async (request, reply) => {
    const tenderId = request.params.id;
    const userId = request.user.id;
    const { action, comment } = request.body || {};
    if (!['submit', 'reject'].includes(action)) {
      return reply.code(400).send({ error: 'action: submit | reject' });
    }
    if (action === 'reject' && !String(comment || '').trim()) {
      return reply.code(400).send({ error: 'Укажите причину отказа' });
    }

    const review = await ensureReview(db, tenderId, userId);
    if (review.director_review_status !== 'pending') {
      return reply.code(409).send({ error: 'Тендер не ожидает согласования директора' });
    }

    let registry_status = null;
    let director_status = action === 'submit' ? 'approved' : 'rejected';

    if (action === 'submit') {
      registry_status = 'готовим';
      await db.query(`
        UPDATE tender_rp_reviews SET
          director_review_status = $1,
          director_review_at = NOW(),
          director_review_by_user_id = $2,
          director_review_comment = $3,
          updated_at = NOW()
        WHERE tender_id = $4
      `, [director_status, userId, comment || null, tenderId]);
      await applyRegistryStatus(db, tenderId, registry_status, true);
      await writeReviewLog(db, {
        reviewId: review.id, tenderId, actorUserId: userId,
        action: 'director_submit', payload: { comment: comment || null }
      });
    } else {
      registry_status = 'отмена';
      await db.query(`
        UPDATE tender_rp_reviews SET
          director_review_status = $1,
          director_review_at = NOW(),
          director_review_by_user_id = $2,
          director_review_comment = $3,
          updated_at = NOW()
        WHERE tender_id = $4
      `, [director_status, userId, String(comment).trim(), tenderId]);
      {
        const reason = String(comment).trim();
        const archiveReason = `Отказ директора: ${reason}`.slice(0, 500);
        await db.query(`
          UPDATE tenders SET registry_status = 'отмена', tender_status = 'Не подходит',
            reject_reason = $1,
            archived_at = NOW(), archived_by = $2, archive_reason = $3,
            updated_at = NOW()
          WHERE id = $4
        `, [reason, userId, archiveReason, tenderId]);
      }
      await writeReviewLog(db, {
        reviewId: review.id, tenderId, actorUserId: userId,
        action: 'director_reject', payload: { comment: String(comment).trim() }
      });
    }

    notifyOnDirectorDecision(db, {
      tenderId: parseInt(tenderId, 10),
      action,
      comment: comment || null,
      directorName: request.user.name || request.user.login,
      log: request.log
    }).catch(() => {});

    broadcast('tender:registry:changed', { id: parseInt(tenderId, 10) });
    const updated = await db.query('SELECT * FROM tender_rp_reviews WHERE tender_id = $1', [tenderId]);
    return { review: updated.rows[0], ok: true };
  });

  fastify.get('/:id/rp-review/messages', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, async (request, reply) => {
    const tenderId = request.params.id;
    if (!(await canAccessReviewThread(db, tenderId, request.user))) {
      return reply.code(403).send({ error: 'Нет доступа к чату отчёта' });
    }
    const review = await ensureReview(db, tenderId, request.user.id);
    const r = await db.query(`
      SELECT m.*, u.name AS user_name, u.role AS user_role
      FROM tender_rp_review_messages m
      JOIN users u ON u.id = m.user_id
      WHERE m.review_id = $1 AND m.deleted_at IS NULL
      ORDER BY m.created_at ASC
    `, [review.id]);
    const msgIds = r.rows.map((m) => m.id);
    let filesByMsg = {};
    if (msgIds.length) {
      const fr = await db.query(`
        SELECT mf.message_id, d.id, d.original_name, d.download_url, d.size, d.mime_type
        FROM tender_rp_review_message_files mf
        JOIN documents d ON d.id = mf.document_id
        WHERE mf.message_id = ANY($1::int[])
      `, [msgIds]);
      for (const f of fr.rows) {
        if (!filesByMsg[f.message_id]) filesByMsg[f.message_id] = [];
        filesByMsg[f.message_id].push({
          id: f.id,
          original_name: f.original_name,
          download_url: f.download_url,
          preview_url: threadFilePreviewUrl(tenderId, f.id),
          size: f.size,
          mime_type: f.mime_type
        });
      }
    }
    const messages = r.rows.map((m) => ({
      ...m,
      files: enrichThreadFiles(tenderId, filesByMsg[m.id] || [])
    }));
    const lastId = messages.length ? messages[messages.length - 1].id : null;
    await markThreadSeen(db, tenderId, request.user.id, lastId);
    return { messages, thread_unread: 0 };
  });

  fastify.post('/:id/rp-review/messages', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, async (request, reply) => {
    const tenderId = request.params.id;
    const userId = request.user.id;
    if (!(await canAccessReviewThread(db, tenderId, request.user))) {
      return reply.code(403).send({ error: 'Нет доступа к чату отчёта' });
    }
    const review = await ensureReview(db, tenderId, userId);
    if (review.is_final && !threadOpenDuringDirectorReview(review.director_review_status)) {
      return reply.code(409).send({ error: 'Чат закрыт: отчёт финализирован' });
    }

    let bodyText = '';
    const uploadedFiles = [];
    const uploadRoot = process.env.UPLOAD_DIR || './uploads';
    const dir = path.join(uploadRoot, 'rp_thread', String(tenderId));
    await fs.mkdir(dir, { recursive: true });

    if (request.isMultipart && request.isMultipart()) {
      const parts = request.parts();
      for await (const part of parts) {
        if (part.type === 'field' && part.fieldname === 'body') {
          bodyText = String((await part.value) || '').trim();
        } else if (part.type === 'file' && part.file) {
          const buffer = await part.toBuffer();
          const safeName = `${Date.now()}_${String(part.filename || 'file').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
          await fs.writeFile(path.join(dir, safeName), buffer);
          const downloadUrl = `/uploads/rp_thread/${tenderId}/${safeName}`;
          uploadedFiles.push({
            safeName,
            originalName: part.filename || safeName,
            mime: part.mimetype || 'application/octet-stream',
            size: buffer.length,
            downloadUrl
          });
        }
      }
    } else {
      bodyText = String((request.body || {}).body || '').trim();
    }

    if (!bodyText && !uploadedFiles.length) {
      return reply.code(400).send({ error: 'Укажите текст или прикрепите файл' });
    }

    const ins = await db.query(`
      INSERT INTO tender_rp_review_messages (review_id, tender_id, user_id, body)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [review.id, tenderId, userId, bodyText]);

    const message = ins.rows[0];
    const docRows = [];
    for (const f of uploadedFiles) {
      const docRes = await db.query(`
        INSERT INTO documents (filename, original_name, mime_type, size, type, tender_id, uploaded_by, download_url, created_at)
        VALUES ($1, $2, $3, $4, 'rp_thread_file', $5, $6, $7, NOW())
        RETURNING id, original_name, download_url, size, mime_type
      `, [f.safeName, f.originalName, f.mime, f.size, tenderId, userId, f.downloadUrl]);
      const doc = docRes.rows[0];
      await db.query(
        'INSERT INTO tender_rp_review_message_files (message_id, document_id) VALUES ($1, $2)',
        [message.id, doc.id]
      );
      docRows.push(doc);
      await writeReviewLog(db, {
        reviewId: review.id, tenderId, actorUserId: userId,
        action: 'thread_attach', payload: { message_id: message.id, file_id: doc.id, name: f.originalName }
      });
    }

    await writeReviewLog(db, {
      reviewId: review.id, tenderId, actorUserId: userId,
      action: 'thread_message', payload: { message_id: message.id, has_files: docRows.length > 0 }
    });

    const userRow = await db.query('SELECT name, role FROM users WHERE id = $1', [userId]);
    const sender = userRow.rows[0] || {};

    notifyOnThreadMessage(db, {
      tenderId: parseInt(tenderId, 10),
      messageId: message.id,
      senderUserId: userId,
      senderName: sender.name || request.user.name,
      senderRole: sender.role || request.user.role,
      body: bodyText,
      files: docRows,
      log: request.log
    }).catch(() => {});

    broadcast('tender:registry:changed', { id: parseInt(tenderId, 10) });
    broadcast('rp_review_thread', { tender_id: parseInt(tenderId, 10), message_id: message.id });

    return {
      message: {
        ...message,
        user_name: sender.name,
        user_role: sender.role,
        files: enrichThreadFiles(tenderId, docRows)
      }
    };
  });

  fastify.get('/:id/rp-review/files/:docId/preview', {
    preHandler: [fastify.requireRoles(PM_ROLES)]
  }, async (request, reply) => {
    const tenderId = request.params.id;
    const docId = parseInt(request.params.docId, 10);
    if (!Number.isFinite(docId)) {
      return reply.code(400).send({ error: 'Некорректный id файла' });
    }
    if (!(await canAccessReviewThread(db, tenderId, request.user))) {
      return reply.code(403).send({ error: 'Нет доступа к файлу' });
    }
    const doc = await loadThreadDocument(db, tenderId, docId);
    if (!doc) return reply.code(404).send({ error: 'Файл не найден' });

    const uploadRoot = process.env.UPLOAD_DIR || './uploads';
    const filePath = resolveThreadDocPath(uploadRoot, doc);
    let buffer;
    try {
      buffer = await fs.readFile(filePath);
    } catch (_) {
      return reply.code(404).send({ error: 'Файл не найден на диске' });
    }

    const mime = doc.mime_type || 'application/octet-stream';
    const name = doc.original_name || doc.filename || 'file';
    const ext = path.extname(name).toLowerCase();
    const inlineMimes = [
      'application/pdf',
      'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'
    ];
    const isBinaryInline = inlineMimes.includes(mime)
      || mime.startsWith('image/')
      || (mime === 'application/pdf' || ext === '.pdf');

    if (isBinaryInline) {
      return reply
        .header('Content-Type', mime)
        .header('Content-Length', buffer.length)
        .header('Content-Disposition', `inline; filename="${encodeURIComponent(name)}"`)
        .header('Cache-Control', 'private, max-age=600')
        .send(buffer);
    }

    try {
      const html = await buildThreadFilePreviewHtml(buffer, mime, name);
      if (html) {
        return reply
          .header('Content-Type', 'text/html; charset=utf-8')
          .header('Cache-Control', 'private, max-age=600')
          .send(html);
      }
    } catch (err) {
      request.log.warn({ err, docId, tenderId }, 'rp-review thread preview failed');
      return reply.code(500).send({ error: 'Не удалось сформировать предпросмотр' });
    }

    return reply.code(415).send({ error: 'Предпросмотр недоступен для этого типа файла' });
  });

  registerRpReviewCollabRoutes(fastify);
}

module.exports = routes;
module.exports.reviewRoutes = reviewRoutes;
